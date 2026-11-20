import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { DownloadIcon, FileUpIcon, ListIcon, PlusIcon, PrinterIcon, SearchIcon, Trash2Icon } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { SHOP } from "@/lib/config"
import { supabase } from "@/lib/supabase"
import { calculateCommission, decimal, ratePercentLabel, readOrderTag, rupees, type CommissionLine } from "../../lib/commission"
import { friendlyError } from "../../lib/errors"
import { multiplyCurrency } from "../../lib/pricing"

type Row = { id: string; name: string; quantity: string; rate: string; total: string }
type OrderHit = { id: string; order_ref: string; customer_name: string; created_at: string; items: { name?: string; quantity?: string; unit_price?: number; rate?: number; total?: number }[] | null }

const newId = () => crypto.randomUUID()
const blankRow = (): Row => ({ id: newId(), name: "", quantity: "", rate: "", total: "" })
const toRows = (lines: CommissionLine[]): Row[] =>
  [...lines.map((l) => ({ id: newId(), name: l.name, quantity: l.quantity, rate: l.rate ? String(l.rate) : "", total: String(l.total) })), blankRow()]
const num = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(/,/g, "")))
const isBlank = (r: Row) => !r.name.trim() && !r.quantity.trim() && !r.rate.trim() && !r.total.trim()

/**
 * Add Commission: load an order (from its PDF or straight from Orders), set a commission %,
 * check every line, then download / print the commission invoice. Nothing is written to the
 * database here, so no existing order, sale or customer record can change.
 */
export function CommissionPage() {
  const [customer, setCustomer] = useState("")
  const [date, setDate] = useState(format(new Date(), "dd-MM-yyyy"))
  const [rate, setRate] = useState("5.5")
  const [balance, setBalance] = useState("")
  const [deposit, setDeposit] = useState("")
  const [rows, setRows] = useState<Row[]>([blankRow()])
  const [source, setSource] = useState("")
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Orders picker
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [hits, setHits] = useState<OrderHit[]>([])
  const [searching, setSearching] = useState(false)

  const used = rows.filter((r) => !isBlank(r))
  const problems = used.map((r) => (!r.name.trim() ? "Item name missing" : !Number.isFinite(num(r.total)) || num(r.total) < 0 ? "Enter the total price" : ""))
  const rateNum = num(rate)
  const rateOk = Number.isFinite(rateNum) && rateNum >= 0 && rateNum <= 100
  const lines: CommissionLine[] = used.map((r) => ({ name: r.name.trim(), quantity: r.quantity.trim(), rate: Number.isFinite(num(r.rate)) ? num(r.rate) : 0, total: Number.isFinite(num(r.total)) ? num(r.total) : 0 }))
  const optional = (v: string) => (v.trim() === "" || !Number.isFinite(num(v)) ? null : num(v))
  const result = useMemo(() => calculateCommission(lines, rateOk ? rateNum : 0, optional(balance) ?? 0, optional(deposit) ?? 0), [JSON.stringify(lines), rateNum, rateOk, balance, deposit]) // eslint-disable-line react-hooks/exhaustive-deps
  const pct = ratePercentLabel(rateOk ? rateNum : 0)
  const ready = lines.length > 0 && problems.every((p) => !p) && rateOk

  function load(next: { customer: string; date: string; lines: CommissionLine[] }, from: string) {
    if (used.length && !window.confirm("Replace the rows on screen with this order?")) return
    setCustomer(next.customer)
    setDate(next.date || format(new Date(), "dd-MM-yyyy"))
    setRows(toRows(next.lines))
    setSource(from)
    toast.success(`Loaded ${next.lines.length} item${next.lines.length === 1 ? "" : "s"}`, { description: from })
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    try {
      const order = readOrderTag(await file.arrayBuffer())
      if (!order) {
        toast.error("This PDF has no order data", {
          description: "Only order PDFs downloaded from Orders after this update carry it. Use “Pick from Orders” instead, or type the items below.",
          duration: 10000,
        })
        return
      }
      load(order, `From PDF: ${file.name}`)
    } catch (e) {
      toast.error("Could not read the PDF", { description: friendlyError(e) })
    } finally {
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  async function findOrders(q = search) {
    setSearching(true)
    try {
      let query = supabase.from("orders").select("id,order_ref,customer_name,created_at,items").order("created_at", { ascending: false }).limit(30)
      const term = q.trim().replace(/[%,()]/g, " ").trim()
      if (term) query = query.or(`customer_name.ilike.%${term}%,order_ref.ilike.%${term}%`)
      const { data, error } = await query
      if (error) throw error
      setHits((data ?? []) as OrderHit[])
    } catch (e) {
      toast.error("Orders could not load", { description: friendlyError(e) })
    } finally {
      setSearching(false)
    }
  }

  function pickOrder(o: OrderHit) {
    const items = (o.items ?? []).filter((i) => (i.name ?? "").trim())
    load({
      customer: o.customer_name,
      date: format(new Date(o.created_at), "dd-MM-yyyy"),
      lines: items.map((i) => ({ name: String(i.name).trim(), quantity: String(i.quantity ?? ""), rate: Number(i.unit_price ?? i.rate) || 0, total: Number(i.total) || 0 })),
    }, `From Orders: ${o.order_ref}`)
    setPickerOpen(false)
  }

  const update = (id: string, field: keyof Row, value: string) =>
    setRows((curr) => {
      const next = curr.map((r) => {
        if (r.id !== id) return r
        const row = { ...r, [field]: value }
        // Typing a rate on a row that has a numeric quantity fills the total (still editable).
        if (field === "rate") {
          const qty = Number((row.quantity.match(/[\d.]+/) || [""])[0])
          const isGrams = /gram/i.test(row.quantity)
          if (Number.isFinite(qty) && qty > 0 && Number.isFinite(num(value))) row.total = String(multiplyCurrency(qty, num(value), isGrams ? 1000 : 1))
        }
        return row
      })
      return isBlank(next[next.length - 1]) ? next : [...next, blankRow()] // always one empty row at the bottom
    })

  async function exportPdf(print: boolean) {
    if (!ready) return void toast.error("Check the items", { description: !lines.length ? "Add at least one item." : !rateOk ? "Enter a commission rate between 0 and 100." : "Every used row needs an item name and a total price." })
    const tab = print ? window.open("", "_blank") : null
    setBusy(true)
    try {
      const { buildCommissionInvoice } = await import("../../lib/commissionPdf")
      const blob = await buildCommissionInvoice({ customer: customer.trim(), date: date.trim(), ratePercent: rateNum, lines, balance: optional(balance), deposit: optional(deposit), logoUrl: SHOP.logo })
      const url = URL.createObjectURL(blob)
      const name = `${(customer.trim() || "Customer").replace(/[^\w؀-ۿ -]+/g, "").replace(/\s+/g, "_")}_Commission_Invoice_${date.trim() || "date"}.pdf`
      if (tab) tab.location.href = url
      else {
        const a = document.createElement("a")
        a.href = url; a.download = name; a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      tab?.close()
      toast.error("PDF not created", { description: friendlyError(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Add Commission" description="Load an order, set the commission %, check the lines, then download or print the invoice. Nothing here changes saved orders.">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void exportPdf(true)} disabled={busy}><PrinterIcon /> Print</Button>
          <Button onClick={() => void exportPdf(false)} disabled={busy}><DownloadIcon /> {busy ? "Creating…" : "Download PDF"}</Button>
        </div>
      </PageHeader>

      {/* Step 1 — load */}
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>1. Load the order</CardTitle>
          <CardDescription>Upload the order PDF from Orders, or pick the order directly. You can also type the items yourself.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()}><FileUpIcon /> Upload order PDF</Button>
            <Button variant="outline" onClick={() => { setPickerOpen((v) => !v); if (!hits.length) void findOrders("") }}><ListIcon /> Pick from Orders</Button>
            {source && <span className="self-center text-sm text-muted-foreground">{source}</span>}
          </div>
          {pickerOpen && (
            <div className="rounded-xl border p-3">
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void findOrders() }}>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Customer name or order reference" />
                <Button type="submit" variant="outline" disabled={searching}><SearchIcon /> Search</Button>
              </form>
              <div className="mt-2 max-h-72 overflow-auto">
                {searching && <p className="p-3 text-sm text-muted-foreground">Searching…</p>}
                {!searching && !hits.length && <p className="p-3 text-sm text-muted-foreground">No orders found.</p>}
                {hits.map((o) => (
                  <button key={o.id} type="button" onClick={() => pickOrder(o)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent">
                    <span className="min-w-0"><span className="block truncate font-medium">{o.customer_name || "—"}</span><span className="text-xs text-muted-foreground">{o.order_ref} · {(o.items ?? []).length} items</span></span>
                    <span className="shrink-0 text-xs text-muted-foreground">{format(new Date(o.created_at), "dd MMM yyyy")}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="grid gap-1.5 text-sm lg:col-span-2">Customer Name<Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="e.g. Qapas Altaf Company" /></label>
            <label className="grid gap-1.5 text-sm">Date<Input value={date} onChange={(e) => setDate(e.target.value)} placeholder="dd-mm-yyyy" /></label>
            <label className="grid gap-1.5 text-sm">Balance (optional)<Input type="number" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="Leave blank to write by hand" /></label>
            <label className="grid gap-1.5 text-sm">Deposit (optional)<Input type="number" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="Leave blank to write by hand" /></label>
          </div>
        </CardContent>
      </Card>

      {/* Step 2 — rate + lines */}
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>2. Commission rate and items</CardTitle>
          <CardDescription>Totals update as you type. Empty rows are ignored.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1.5 text-sm">Commission Rate (%)
              <Input className="w-40 font-mono text-lg" type="number" inputMode="decimal" step="any" min={0} max={100} value={rate} onChange={(e) => setRate(e.target.value)} aria-invalid={!rateOk} />
            </label>
            {!rateOk && <span className="pb-2 text-sm text-destructive">Enter a rate between 0 and 100.</span>}
          </div>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-foreground text-background">
                <tr>
                  <th className="px-2 py-2 text-center">S.No</th><th className="px-2 py-2 text-left">Item Name</th><th className="px-2 py-2">Quantity</th>
                  <th className="px-2 py-2">Per Unit Price (Rs.)</th><th className="px-2 py-2">Total Price (Rs.)</th><th className="px-2 py-2">Percent ({pct})</th>
                  <th className="px-2 py-2">After Percentage (Rs.)</th><th className="px-2 py-2" aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const idx = used.indexOf(r)
                  const calc = idx >= 0 ? result.lines[idx] : null
                  const problem = idx >= 0 ? problems[idx] : ""
                  return (
                    <tr key={r.id} className="border-t odd:bg-muted/40">
                      <td className="px-2 py-1 text-center font-semibold">{idx >= 0 ? idx + 1 : ""}</td>
                      <td className="px-1 py-1"><Input value={r.name} onChange={(e) => update(r.id, "name", e.target.value)} placeholder={i === rows.length - 1 ? "Add item…" : ""} aria-invalid={!!problem && !r.name.trim()} /></td>
                      <td className="px-1 py-1"><Input className="w-28" value={r.quantity} onChange={(e) => update(r.id, "quantity", e.target.value)} placeholder="10 kg" /></td>
                      <td className="px-1 py-1"><Input className="w-28 text-right font-mono" inputMode="decimal" value={r.rate} onChange={(e) => update(r.id, "rate", e.target.value)} /></td>
                      <td className="px-1 py-1"><Input className="w-32 text-right font-mono" inputMode="decimal" value={r.total} onChange={(e) => update(r.id, "total", e.target.value)} aria-invalid={!!problem && !!r.name.trim()} /></td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums">{calc ? decimal(calc.commission, 3) : ""}</td>
                      <td className="px-2 py-1 text-right font-mono font-semibold tabular-nums">{calc ? rupees(calc.after) : problem ? <span className="font-sans text-xs font-normal text-destructive">{problem}</span> : ""}</td>
                      <td className="px-1 py-1 text-center">
                        {!isBlank(r) && <Button variant="ghost" size="icon-sm" aria-label={`Remove row ${idx + 1}`} onClick={() => setRows((curr) => curr.filter((x) => x.id !== r.id))}><Trash2Icon /></Button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Button variant="outline" className="self-start" onClick={() => setRows((curr) => [...curr, blankRow()])}><PlusIcon /> Add row</Button>
        </CardContent>
      </Card>

      {/* Step 3 — totals (same blocks as the printed invoice) */}
      <div className="grid gap-3 md:grid-cols-3">
        {[
          ["GRAND TOTAL", `Without Total ${pct} (Additional)`, result.grandTotal],
          [`TOTAL ${pct}`, "Additional", result.totalCommission],
          ["GRAND TOTAL", `After Total ${pct} (Additional)`, result.grandAfter],
        ].map(([title, sub, value], i) => (
          <div key={i} className="rounded-2xl bg-foreground p-4 text-center text-background">
            <div className="text-sm font-bold tracking-wide">{title}</div>
            <div className="text-[11px] opacity-75">{sub}</div>
            <div className="mt-2 font-mono text-2xl font-bold">Rs. {rupees(value as number)}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[["Balance", optional(balance)], ["Deposit", optional(deposit)], ["Remaining Balance", optional(balance) == null && optional(deposit) == null ? null : result.remaining]].map(([label, v]) => (
          <div key={label as string} className="rounded-xl border p-3 text-center">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="mt-1 font-mono text-lg font-semibold">{v == null ? "—" : `Rs. ${rupees(v as number)}`}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{used.length} item{used.length === 1 ? "" : "s"} · Remaining balance = Grand total after {pct} + Balance − Deposit.</p>
    </div>
  )
}
