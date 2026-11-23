import { useSyncExternalStore } from "react"
import { format, subDays } from "date-fns"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { savePosSale } from '../../lib/saveRequests'

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
  /** Cash received; null on older sales (Cash = fully paid, Balance = nothing paid). */
  paidAmount: number | null
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
  paid_amount?: number | string | null
  created_at: string
  reversed_at?: string | null
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
  paidAmount: r.paid_amount == null ? null : Number(r.paid_amount),
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
    // Older deployments do not have reversed_at yet. SELECT * works with both
    // schemas; filter after fetching, but paginate by the raw page length.
    rows.push(...(data as SaleRow[]).filter(row => !row.reversed_at))
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
let lastVisibleResync = Date.now()
let generation = 0

async function fetchAllItems() {
  const rows: ItemRow[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("items").select("*").order("name").order("id").range(offset, offset + 499)
    if (error) throw error
    rows.push(...data)
    if (data.length < 500) return rows
  }
}
async function fetchAll() {
  const [itemRows, saleRows] = await Promise.all([fetchAllItems(), fetchAllSales(cutoffDay())])
  const sales: SalesByDay = {}
  for (const r of saleRows) (sales[r.day] ??= []).push(toSale(r))
  return { items: sortByName(itemRows.map(toItem)), sales }
}

/** Re-fetch in the background; live events can be missed while offline or asleep. */
let resyncing = false
async function resync() {
  if (state.status !== "ready" || resyncing) return
  resyncing = true
  const started = generation
  try {
    const data = await fetchAll()
    if (started === generation) setState(data)
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
    if (state.status !== "ready" || !channel) return
    void resync()
    actions.listen()
  })
  document.addEventListener("visibilitychange", () => {
    // Live events keep the screen current; a full catch-up on every tab switch slowed billing
    // during rush, so it runs at most once every 30 s. Reconnects (online/SUBSCRIBED) still resync at once.
    if (document.visibilityState === "visible" && Date.now() - lastVisibleResync > 30_000) {
      lastVisibleResync = Date.now()
      void resync()
    }
  })
}

export const actions = {
  /** Load everything for the signed-in user and start live sync. */
  async load() {
    const started = ++generation
    setState({ status: "loading", error: null })
    try {
      const data = await fetchAll()
      if (started !== generation) return
      setState({ ...data, status: "ready" })
      actions.listen()
      watchConnection()
    } catch (e) {
      if (started !== generation) return
      const message = e && typeof e === "object" && "message" in e && typeof e.message === "string" ? e.message : "Unable to load POS data. Please check your connection and retry."
      setState({ status: "error", error: message })
    }
  },

  listen() {
    const started = generation
    if (channel) supabase.removeChannel(channel)
    channel = supabase
      .channel("pos-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, (p) => {
        if (started !== generation) return
        if (p.eventType === "DELETE") setState({ items: state.items.filter((i) => i.id !== (p.old as ItemRow).id) })
        else upsertItem(toItem(p.new as ItemRow))
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, (p) => {
        if (started !== generation) return
        if (p.eventType === "DELETE") removeSale((p.old as SaleRow).id)
        else if ((p.new as SaleRow).reversed_at) removeSale((p.new as SaleRow).id)
        else upsertSale((p.new as SaleRow).day, toSale(p.new as SaleRow))
      })
      .subscribe((status) => {
        if (started !== generation) return
        // A reconnect means events may have been missed in between: catch up.
        if (status === "SUBSCRIBED") {
          if (subscribedOnce) void resync()
          subscribedOnce = true
        }
      })
  },

  /** Admin-System-only users (no POS billing pages): nothing to load. */
  skip() {
    actions.reset()
    setState({ status: "ready" })
  },

  reset() {
    generation++ // Ignore requests that belonged to a previous session.
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

  async updateDetails(id: string, details: { name?: string; nameUr?: string; unitWeight?: number }) {
    const patch: Record<string, unknown> = {}
    if (details.name !== undefined) {
      const name = details.name.trim()
      if (!name) throw new Error("Item name cannot be empty")
      if (state.items.some((i) => i.id !== id && i.name.toLowerCase() === name.toLowerCase())) throw new Error(`An item named "${name}" already exists`)
      patch.name = name // past bills keep their own copy of the old name
    }
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
    const { data: removed, error } = await supabase.from("items").delete().eq("id", id).select("id")
    if (error) throw error
    if (!removed?.length) throw new Error("Item was not deleted: the database did not remove it (no permission, or it was already removed). Refresh and try again.")
    setState({ items: state.items.filter((i) => i.id !== id) })
  },

  findByName(name: string): Item | undefined {
    const n = name.trim().toLowerCase()
    return state.items.find((i) => i.name.toLowerCase() === n)
  },

  async recordSale(lines: SaleLine[], payment: PaymentMethod, customerName: string, requestId: string): Promise<Sale> {
    const day = dayKey()
    const save = () => savePosSale(supabase, {
      p_request_id: requestId,
      p_day: day,
      p_lines: lines,
      p_payment: payment,
      p_customer_name: customerName.trim() || null,
    }, localStorage)
    const data = navigator.locks ? await navigator.locks.request(`ahwmb-checkout:${requestId}`, save) : await save()
    const sale = toSale(data as SaleRow)
    if (!(data as SaleRow).reversed_at) upsertSale((data as SaleRow).day, sale)
    return sale
  },

  /** Preserve the original bill and record a reasoned financial reversal. */
  async reverseSale(id: string, kind: "void" | "refund", reason: string) {
    const { error } = await supabase.rpc("reverse_sale", { p_id: id, p_kind: kind, p_reason: reason.trim() })
    if (error) throw error
    removeSale(id)
  },

  /** Fix the payment mode / cash received on a completed sale. The database keeps a log of the old values. */
  async editSalePayment(sale: Sale, payment: PaymentMethod, paid: number) {
    const { data, error } = await supabase.rpc("edit_sale_payment", { p_id: sale.id, p_payment: payment, p_paid: paid })
    if (error) {
      if (error.code === "PGRST202") throw new Error("Run supabase/migrations/20261120_sale_payment_edit.sql in Supabase first.")
      throw error
    }
    const row = data as SaleRow
    const updated = toSale(row)
    upsertSale(row.day, updated)
    return updated
  },

  /** Hide days outside the on-screen window. Nothing is deleted from the database. */
  purgeOld() {
    dropOldDays()
  },
}

/** Number printed on the receipt (first 8 characters of the sale id). */
export const receiptNo = (sale: Pick<Sale, "id">) => sale.id.slice(0, 8).toUpperCase()

/** Amount still owed on a sale. */
export const remainingBalance = (sale: Pick<Sale, "total" | "payment" | "paidAmount">) =>
  Math.max(0, sale.total - (sale.paidAmount ?? (sale.payment === "Cash" ? sale.total : 0)))

export const lineTotal = (lines: SaleLine[]) => lines.reduce((s, l) => s + l.qty * l.rate, 0)
/** Total kg on a bill, to match against the weighing scale. */
export const lineWeight = (l: SaleLine) => l.qty * (l.weight ?? 1)
export const totalWeight = (lines: SaleLine[]) => lines.reduce((s, l) => s + lineWeight(l), 0)
const kgFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 })
export const fmtKg = (n: number) => `${kgFmt.format(n)} kg`

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmt = (n: number) => `${CURRENCY} ${money.format(n)}`
