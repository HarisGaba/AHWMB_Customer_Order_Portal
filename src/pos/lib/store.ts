import { useSyncExternalStore } from "react"
import { format, subDays } from "date-fns"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

export const RETENTION_DAYS = 60
export const CURRENCY = "Rs"

export type Item = { id: string; name: string; rate: number; createdAt: string; archivedAt: string | null }
export type SaleLine = { itemId: string; name: string; qty: number; rate: number }
export type PaymentMethod = "Cash" | "Balance"
export type Sale = {
  id: string
  customerNo: number
  createdAt: string
  lines: SaleLine[]
  total: number
  payment: PaymentMethod
}
/** Sales grouped by local calendar day, keyed "yyyy-MM-dd". */
export type SalesByDay = Record<string, Sale[]>

type Status = "idle" | "loading" | "ready" | "error"
type State = { items: Item[]; sales: SalesByDay; status: Status; error: string | null }

// ---------- Row mapping ----------
type ItemRow = { id: string; name: string; rate: number | string; created_at: string; archived_at?: string | null }
type SaleRow = {
  id: string
  day: string
  customer_no: number
  lines: SaleLine[]
  total: number | string
  payment: PaymentMethod
  created_at: string
}

const toItem = (r: ItemRow): Item => ({
  id: r.id,
  name: r.name,
  rate: Number(r.rate),
  createdAt: r.created_at,
  archivedAt: r.archived_at ?? null,
})
const toSale = (r: SaleRow): Sale => ({
  id: r.id,
  customerNo: r.customer_no,
  createdAt: r.created_at,
  lines: r.lines,
  total: Number(r.total),
  payment: r.payment,
})

// ---------- Tiny external store ----------
let state: State = { items: [], sales: {}, status: "idle", error: null }
const listeners = new Set<() => void>()

function setState(next: Partial<State>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

export const dayKey = (d: Date = new Date()) => format(d, "yyyy-MM-dd")
const sortByName = (items: Item[]) => [...items].sort((a, b) => a.name.localeCompare(b.name))
const cutoffDay = () => dayKey(subDays(new Date(), RETENTION_DAYS))

function upsertItem(item: Item) {
  setState({ items: sortByName([...state.items.filter((i) => i.id !== item.id), item]) })
}

function upsertSale(day: string, sale: Sale) {
  const list = (state.sales[day] ?? []).filter((s) => s.id !== sale.id)
  list.push(sale)
  list.sort((a, b) => a.customerNo - b.customerNo)
  setState({ sales: { ...state.sales, [day]: list } })
}

function removeSale(id: string) {
  const sales: SalesByDay = {}
  for (const [day, list] of Object.entries(state.sales)) {
    const kept = list.filter((s) => s.id !== id)
    if (kept.length) sales[day] = kept
  }
  setState({ sales })
}

function dropOldDays() {
  const cutoff = cutoffDay()
  const kept = Object.fromEntries(Object.entries(state.sales).filter(([d]) => d >= cutoff))
  if (Object.keys(kept).length !== Object.keys(state.sales).length) setState({ sales: kept })
}

/** PostgREST returns at most 1000 rows per request, so page through. */
async function fetchAllSales(since: string) {
  const rows: SaleRow[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("sales")
      .select("*")
      .gte("day", since)
      .order("day")
      .order("customer_no")
      .range(from, from + page - 1)
    if (error) throw error
    rows.push(...(data as SaleRow[]))
    if (data.length < page) return rows
  }
}

async function setArchived(id: string, archivedAt: string | null) {
  const { data, error } = await supabase.from("items").update({ archived_at: archivedAt }).eq("id", id).select().single()
  if (error) {
    if (error.message.includes("archived_at")) throw new Error("Run supabase/migrations/002_archive_items.sql in Supabase first.")
    throw error
  }
  upsertItem(toItem(data as ItemRow))
}

let channel: RealtimeChannel | null = null

export const actions = {
  /** Load everything for the signed-in user and start live sync. */
  async load() {
    setState({ status: "loading", error: null })
    try {
      await supabase.rpc("purge_old_sales", { p_keep_days: RETENTION_DAYS })
      const [itemsRes, saleRows] = await Promise.all([
        supabase.from("items").select("*").order("name"),
        fetchAllSales(cutoffDay()),
      ])
      if (itemsRes.error) throw itemsRes.error
      const sales: SalesByDay = {}
      for (const r of saleRows) (sales[r.day] ??= []).push(toSale(r))
      setState({ items: sortByName((itemsRes.data as ItemRow[]).map(toItem)), sales, status: "ready" })
      actions.listen()
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : String(e) })
    }
  },

  listen() {
    if (channel) supabase.removeChannel(channel)
    channel = supabase
      .channel("pos-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, (p) => {
        if (p.eventType === "DELETE") setState({ items: state.items.filter((i) => i.id !== (p.old as ItemRow).id) })
        else upsertItem(toItem(p.new as ItemRow))
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, (p) => {
        if (p.eventType === "DELETE") removeSale((p.old as SaleRow).id)
        else upsertSale((p.new as SaleRow).day, toSale(p.new as SaleRow))
      })
      .subscribe()
  },

  reset() {
    if (channel) supabase.removeChannel(channel)
    channel = null
    setState({ items: [], sales: {}, status: "idle", error: null })
  },

  async addItem(name: string, rate: number): Promise<Item> {
    const { data, error } = await supabase.from("items").insert({ name: name.trim(), rate }).select().single()
    if (error) throw new Error(error.code === "23505" ? `"${name.trim()}" already exists` : error.message)
    const item = toItem(data as ItemRow)
    upsertItem(item)
    return item
  },

  async updateRate(id: string, rate: number) {
    const { data, error } = await supabase.from("items").update({ rate }).eq("id", id).select().single()
    if (error) throw error
    upsertItem(toItem(data as ItemRow))
  },

  /** Soft delete: hides the item from the POS; it can be restored later. */
  async archiveItem(id: string) {
    await setArchived(id, new Date().toISOString())
  },

  async restoreItem(id: string) {
    await setArchived(id, null)
  },

  /** Permanent delete. Past sales keep their own copy of the name and rate. */
  async deleteItemForever(id: string) {
    const { error } = await supabase.from("items").delete().eq("id", id)
    if (error) throw error
    setState({ items: state.items.filter((i) => i.id !== id) })
  },

  findByName(name: string): Item | undefined {
    const n = name.trim().toLowerCase()
    return state.items.find((i) => i.name.toLowerCase() === n)
  },

  async recordSale(lines: SaleLine[], payment: PaymentMethod): Promise<Sale> {
    const day = dayKey()
    const { data, error } = await supabase.rpc("record_sale", { p_day: day, p_lines: lines, p_payment: payment })
    if (error) throw error
    const sale = toSale(data as SaleRow)
    upsertSale(day, sale)
    return sale
  },

  /** Drop days that fall outside the rolling retention window. */
  purgeOld() {
    dropOldDays()
    if (state.status === "ready") void supabase.rpc("purge_old_sales", { p_keep_days: RETENTION_DAYS })
  },
}

export const lineTotal = (lines: SaleLine[]) => lines.reduce((s, l) => s + l.qty * l.rate, 0)

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmt = (n: number) => `${CURRENCY} ${money.format(n)}`
