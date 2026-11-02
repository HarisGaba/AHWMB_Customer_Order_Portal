import { useSyncExternalStore } from "react"
import { format, subDays } from "date-fns"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

export const RETENTION_DAYS = 60
export const CURRENCY = "Rs"

/** unitWeight = kg in one unit of quantity (1 = sold by the kg). */
export type Item = { id: string; name: string; nameUr: string | null; rate: number; unitWeight: number; createdAt: string; archivedAt: string | null }
/** Lines keep their own copy of names and unit weight so old bills never change. */
export type SaleLine = { itemId: string; name: string; nameUr?: string | null; qty: number; rate: number; weight?: number }
export type PaymentMethod = "Cash" | "Balance"
export type Sale = {
  id: string
  customerNo: number
  createdAt: string
  lines: SaleLine[]
  total: number
  payment: PaymentMethod
  customerName: string | null
}
/** Sales grouped by local calendar day, keyed "yyyy-MM-dd". */
export type SalesByDay = Record<string, Sale[]>

type Status = "idle" | "loading" | "ready" | "error"
type State = { items: Item[]; sales: SalesByDay; status: Status; error: string | null }

// ---------- Row mapping ----------
type ItemRow = { id: string; name: string; name_ur?: string | null; rate: number | string; unit_weight?: number | string | null; created_at: string; archived_at?: string | null }
type SaleRow = {
  id: string
  day: string
  customer_no: number
  lines: SaleLine[]
  total: number | string
  payment: PaymentMethod
  customer_name?: string | null
  created_at: string
}

const toItem = (r: ItemRow): Item => ({
  id: r.id,
  name: r.name,
  nameUr: r.name_ur?.trim() || null,
  rate: Number(r.rate),
  unitWeight: Number(r.unit_weight ?? 1) || 1,
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
  customerName: r.customer_name ?? null,
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
    throw error
  }
  upsertItem(toItem(data as ItemRow))
}

let channel: RealtimeChannel | null = null
let subscribedOnce = false
let watching = false

async function fetchAll() {
  const [itemsRes, saleRows] = await Promise.all([supabase.from("items").select("*").order("name"), fetchAllSales(cutoffDay())])
  if (itemsRes.error) throw itemsRes.error
  const sales: SalesByDay = {}
  for (const r of saleRows) (sales[r.day] ??= []).push(toSale(r))
  return { items: sortByName((itemsRes.data as ItemRow[]).map(toItem)), sales }
}

/** Re-fetch in the background; live events can be missed while offline or asleep. */
let resyncing = false
async function resync() {
  if (state.status !== "ready" || resyncing) return
  resyncing = true
  try {
    setState(await fetchAll())
  } catch {
    // Still offline; the next reconnect/visibility event will retry.
  } finally {
    resyncing = false
  }
}

function watchConnection() {
  if (watching) return
  watching = true
  window.addEventListener("online", () => {
    void resync()
    actions.listen()
  })
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void resync()
  })
}

export const actions = {
  /** Load everything for the signed-in user and start live sync. */
  async load() {
    setState({ status: "loading", error: null })
    try {
      await supabase.rpc("purge_old_sales", { p_keep_days: RETENTION_DAYS })
      setState({ ...(await fetchAll()), status: "ready" })
      actions.listen()
      watchConnection()
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
      .subscribe((status) => {
        // A reconnect means events may have been missed in between: catch up.
        if (status === "SUBSCRIBED") {
          if (subscribedOnce) void resync()
          subscribedOnce = true
        }
      })
  },

  reset() {
    if (channel) supabase.removeChannel(channel)
    channel = null
    subscribedOnce = false
    setState({ items: [], sales: {}, status: "idle", error: null })
  },

  async addItem(name: string, rate: number, nameUr = "", unitWeight = 1): Promise<Item> {
    const { data, error } = await supabase
      .from("items")
      .insert({ name: name.trim(), rate, name_ur: nameUr.trim() || null, unit_weight: unitWeight })
      .select()
      .single()
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

  async updateDetails(id: string, details: { nameUr?: string; unitWeight?: number }) {
    const patch: Record<string, unknown> = {}
    if (details.nameUr !== undefined) patch.name_ur = details.nameUr.trim() || null
    if (details.unitWeight !== undefined) patch.unit_weight = details.unitWeight
    const { data, error } = await supabase.from("items").update(patch).eq("id", id).select().single()
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

  async recordSale(lines: SaleLine[], payment: PaymentMethod, customerName = ""): Promise<Sale> {
    const day = dayKey()
    const { data, error } = await supabase.rpc("record_sale", {
      p_day: day,
      p_lines: lines,
      p_payment: payment,
      p_customer_name: customerName.trim() || null,
    })
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
/** Total kg on a bill, to match against the weighing scale. */
export const lineWeight = (l: SaleLine) => l.qty * (l.weight ?? 1)
export const totalWeight = (lines: SaleLine[]) => lines.reduce((s, l) => s + lineWeight(l), 0)
const kgFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 })
export const fmtKg = (n: number) => `${kgFmt.format(n)} kg`

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmt = (n: number) => `${CURRENCY} ${money.format(n)}`
