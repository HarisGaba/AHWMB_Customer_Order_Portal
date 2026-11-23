import { useEffect, useMemo, useRef, useState } from "react"
import { usePosEmail } from "@/components/auth-gate"
import { toast } from "sonner"
import { friendlyError as saveError } from '../../lib/errors'
import {
  BanknoteIcon,
  CheckCircle2Icon,
  CornerDownLeftIcon,
  Loader2Icon,
  PrinterIcon,
  ReceiptIcon,
  ScaleIcon,
  ShoppingCartIcon,
  Trash2Icon,
  UserRoundIcon,
  WalletIcon,
  XIcon,
} from "lucide-react"
import { ItemCommand } from "@/components/item-command"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { printReceipt } from "@/lib/receipt"
import { actions, fmt, fmtKg, lineTotal, lineWeight, totalWeight, useStore, type Item, type PaymentMethod, type Sale, type SaleLine } from "@/lib/store"
import { cn } from "@/lib/utils"

type Stage = null | "total" | "pay" | "done"

const EnterKbd = ({ inverted }: { inverted?: boolean }) => (
  <Kbd className={cn(inverted && "bg-primary-foreground/15 text-primary-foreground")}>
    <CornerDownLeftIcon />
  </Kbd>
)

export function PosPage({ active = true }: { active?: boolean }) {
  const email = usePosEmail()
  const draftKey = `ahwmb-pos-cart-v2:${email}`
  const [recovered] = useState(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(draftKey) || 'null')
      if (value && Array.isArray(value.cart) && value.cart.every((l: SaleLine) => typeof l.name === 'string' && Number.isFinite(l.qty) && l.qty > 0 && Number.isFinite(l.rate) && l.rate >= 0)) return value as { cart: SaleLine[]; customer: string; requestId: string }
    } catch { /* invalid draft: leave stored copy untouched */ }
    return null
  })
  const [cart, setCart] = useState<SaleLine[]>(recovered?.cart || [])
  const [customer, setCustomer] = useState(recovered?.customer || "")
  const requestId = useRef(recovered?.requestId || crypto.randomUUID())
  const [draftMessage, setDraftMessage] = useState(recovered?.cart.length ? "Unfinished bill recovered from this tab." : "")
  const currentDraft = useRef({ cart, customer, requestId: requestId.current })
  currentDraft.current = { cart, customer, requestId: requestId.current }
  useEffect(() => {
    const save = () => { try { sessionStorage.setItem(draftKey, JSON.stringify(currentDraft.current)) } catch { setDraftMessage("Draft could not be saved on this device. Keep this page open.") } }
    save(); window.addEventListener('pagehide', save)
    return () => window.removeEventListener('pagehide', save)
  }, [cart, customer, draftKey])
  // Suggest customers from earlier bills.
  const allSales = useStore((s) => s.sales)
  const knownCustomers = useMemo(
    () => [...new Set(Object.values(allSales).flat().map((s) => s.customerName?.trim()).filter(Boolean) as string[])].sort(),
    [allSales],
  )
  const [search, setSearch] = useState("")
  const [picked, setPicked] = useState<Item | null>(null)
  const [qty, setQty] = useState("")
  const [stage, setStage] = useState<Stage>(null)
  const [payment, setPayment] = useState<PaymentMethod>("Cash")
  // Optional cash received now on a Balance (credit) sale; the rest stays as remaining balance.
  const [paidNow, setPaidNow] = useState("")
  const [lastSale, setLastSale] = useState<Sale | null>(null)
  const [printed, setPrinted] = useState(false)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)

  const total = lineTotal(cart)
  const units = cart.reduce((s, l) => s + l.qty, 0)
  const weight = totalWeight(cart)
  const focusSearch = () => setTimeout(() => searchRef.current?.focus(), 0)

  useEffect(() => {
    if (active) searchRef.current?.focus()
  }, [active])

  function pick(item: Item) {
    setPicked(item)
    setSearch("")
    setQty("1")
    setTimeout(() => qtyRef.current?.select(), 0)
  }

  function addLine() {
    const q = parseFloat(qty)
    if (!picked) return focusSearch()
    if (!Number.isFinite(q) || !(q > 0) || q > 1000000) return toast.error("Enter a valid quantity")
    setCart((c) => {
      const i = c.findIndex((l) => l.itemId === picked.id)
      if (i === -1) return [...c, { itemId: picked.id, name: picked.name, nameUr: picked.nameUr, rate: picked.rate, qty: q, weight: picked.unitWeight }]
      return c.map((l, k) => (k === i ? { ...l, qty: l.qty + q } : l))
    })
    setPicked(null)
    setQty("")
    focusSearch()
  }

  function setLineQty(itemId: string, q: number) {
    setCart((c) => (q > 0 ? c.map((l) => (l.itemId === itemId ? { ...l, qty: q } : l)) : c.filter((l) => l.itemId !== itemId)))
  }

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key !== "Enter" || search.trim()) return
    e.preventDefault()
    if (!cart.length) return void toast.error("Cart is empty", { description: "Add at least one item first." })
    setStage("total")
  }

  async function complete(method: PaymentMethod) {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    try {
      let sale = await actions.recordSale(cart, method, customer, requestId.current)
      requestId.current = crypto.randomUUID()
      const part = Number(paidNow)
      if (method === "Balance" && paidNow.trim() && Number.isFinite(part) && part > 0) {
        // The sale is already saved; a failure here only skips the part-payment, never the sale.
        try {
          sale = await actions.editSalePayment(sale, "Balance", Math.min(part, sale.total))
        } catch (err) {
          toast.warning("Sale saved, cash received not recorded", { description: `${saveError(err)} Use Total Summary → Edit to add it.`, duration: 10000 })
        }
      }
      setPaidNow("")
      setDraftMessage("Sale saved. Ready for the next customer.")
      setLastSale(sale)
      setPrinted(false)
      setCart([])
      setCustomer("")
      setStage("done")
    } catch (e) {
      toast.error("Sale not confirmed", { description: saveError(e), duration: 10000 })
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  function closeDialogs() {
    if (saving.current) return
    setStage(null)
    focusSearch()
  }

  function print(sale: Sale) {
    printReceipt(sale)
    setPrinted(true)
  }

  // One keyboard handler for the whole checkout, in the capture phase, so the keys work
  // whichever button has focus (no Tab needed):
  //   Total:   Enter = continue to payment
  //   Payment: ←/→ or 1/2 (C/B) = choose Cash/Balance, Enter = complete sale
  //   Done:    Enter or P = print bill · N = new sale without a bill · after printing, Enter = new sale
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e: KeyboardEvent) => {
    if (!stage || e.ctrlKey || e.metaKey || e.altKey) return
    // Typing in the "cash received" box: digits are amounts, not shortcuts. Enter still completes.
    if (e.target instanceof HTMLInputElement && e.key !== "Enter") return
    const k = e.key.toLowerCase()
    const handled = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (stage === "total" && e.key === "Enter") {
      handled()
      setPayment("Cash")
      setStage("pay")
    } else if (stage === "pay") {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab"].includes(e.key)) {
        handled()
        setPayment((p) => (p === "Cash" ? "Balance" : "Cash"))
      } else if (k === "1" || k === "c") {
        handled()
        setPayment("Cash")
      } else if (k === "2" || k === "b") {
        handled()
        setPayment("Balance")
      } else if (e.key === "Enter") {
        handled()
        void complete(payment)
      }
    } else if (stage === "done" && lastSale) {
      if (k === "n") {
        handled()
        closeDialogs()
      } else if (k === "p" || (e.key === "Enter" && !printed)) {
        handled()
        print(lastSale)
      } else if (e.key === "Enter") {
        handled()
        closeDialogs()
      }
    }
  }
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [active])

  return (
    <div className="flex h-full flex-col gap-6">
      <PageHeader title="Point of Sale" description="Search an item, enter quantity, press Enter. Enter on an empty search to check out.">
        <div className="hidden items-center gap-1.5 text-xs text-muted-foreground xl:flex">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> select <span className="mx-1">·</span>
          <EnterKbd /> confirm <span className="mx-1">·</span>
          <Kbd>Esc</Kbd> back <span className="mx-1">·</span>
          <Kbd>F1</Kbd> all shortcuts
        </div>
      </PageHeader>

      {draftMessage && <p role="status" className="rounded-xl border bg-muted/40 px-4 py-2 text-sm">{draftMessage}</p>}
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {/* Search + selected item + qty + add — one row above the full-width cart */}
        <div className={cn("relative z-20 flex flex-wrap items-center gap-3 rounded-2xl border bg-gradient-to-r from-accent/60 to-card p-3 shadow-panel transition-colors", picked && "from-gold/20")}>
          <ItemCommand
            dropdown
            inputRef={searchRef}
            search={search}
            onSearchChange={setSearch}
            onPick={pick}
            onKeyDown={onSearchKey}
            selectedId={picked?.id}
            className="min-w-64 flex-[2] rounded-xl!"
            placeholder="Search items…  (Enter on empty = checkout)"
          />
          <div className="min-w-40 flex-1">
            <div className="text-[11px] font-semibold tracking-wider text-primary uppercase">Selected item</div>
            {picked ? (
              <div className="truncate text-base font-semibold">
                {picked.name} <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">@ {fmt(picked.rate)}</span>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Type to search, ↑ ↓ to choose, Enter</div>
            )}
          </div>
          <Input
            ref={qtyRef}
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            placeholder="Qty"
            value={qty}
            disabled={!picked}
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addLine()
              if (e.key === "Escape") {
                setPicked(null)
                focusSearch()
              }
            }}
            className="h-12 w-32 rounded-xl bg-card text-right font-mono text-lg"
          />
          <Button size="lg" className="h-12 min-w-40 rounded-xl px-6 text-base shadow-sm" disabled={!picked} onClick={addLine}>
            Add to cart <EnterKbd inverted />
          </Button>
        </div>

        <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden rounded-2xl py-0 shadow-panel">
          {/* Cart */}
          <div className="min-h-0 flex-1 overflow-auto">
            {cart.length ? (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="w-10 pl-4">#</TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cart.map((l, i) => (
                    <TableRow key={l.itemId} className="group/row">
                      <TableCell className="pl-4 text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>
                        <div className="font-medium">{l.name}</div>
                        {l.nameUr && <div dir="rtl" lang="ur" className="font-urdu text-left text-sm text-muted-foreground">{l.nameUr}</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        <QtyCell value={l.qty} onCommit={(q) => setLineQty(l.itemId, q)} onDone={focusSearch} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground tabular-nums">{fmt(l.rate)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground tabular-nums">{fmtKg(lineWeight(l))}</TableCell>
                      <TableCell className="text-right font-mono font-medium tabular-nums">{fmt(l.qty * l.rate)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${l.name}`}
                          className="opacity-50 group-hover/row:opacity-100"
                          onClick={() => {
                            setCart((c) => c.filter((x) => x.itemId !== l.itemId))
                            focusSearch()
                          }}
                        >
                          <XIcon />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex h-full min-h-60 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-gold/25 text-primary ring-1 ring-primary/10">
                  <ShoppingCartIcon className="size-7" />
                </div>
                <div>
                  <div className="text-base font-semibold text-foreground">Cart is empty</div>
                  <div className="text-sm">Items you add will appear here.</div>
                </div>
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="flex flex-wrap items-center gap-4 border-t bg-sidebar p-4 text-sidebar-foreground md:px-5">
            <div className="text-sm text-sidebar-foreground/70">
              {cart.length} line{cart.length === 1 ? "" : "s"} · {units} units
              {cart.length > 0 && <span className="hidden sm:inline"> · click a quantity to edit</span>}
            </div>
            {cart.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                onClick={() => {
                  setCart([])
                  focusSearch()
                }}
              >
                <Trash2Icon /> Clear
              </Button>
            )}
            <div className="ml-auto text-right">
              <div className="text-[11px] font-semibold tracking-wider text-sidebar-foreground/60 uppercase">Total</div>
              <div className="font-mono text-3xl font-bold tracking-tight text-gold tabular-nums md:text-4xl">{fmt(total)}</div>
            </div>
            <div className="text-right">
              <div className="flex items-center justify-end gap-1 text-[11px] font-semibold tracking-wider text-sidebar-foreground/60 uppercase">
                <ScaleIcon className="size-3" /> Total Weight
              </div>
              <div className="font-mono text-2xl font-bold tracking-tight text-sidebar-foreground tabular-nums">{fmtKg(weight)}</div>
            </div>
            <Button size="lg" className="h-13 rounded-xl bg-gold px-7 text-base font-bold text-gold-foreground shadow-lg hover:bg-gold/90 disabled:bg-sidebar-accent disabled:text-sidebar-foreground/50 disabled:opacity-100" disabled={!cart.length} onClick={() => setStage("total")}>
              <ReceiptIcon /> Checkout
            </Button>
          </div>
        </Card>
      </div>

      {/* Step 1: total amount */}
      <Dialog open={stage === "total"} onOpenChange={(o) => !o && closeDialogs()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Total Amount</DialogTitle>
            <DialogDescription>
              {customer.trim() ? `${customer.trim()} · ` : ""}
              {cart.length} items · {units} units
            </DialogDescription>
          </DialogHeader>
          <div className="pt-6 text-center font-mono text-5xl font-semibold tracking-tight tabular-nums">{fmt(total)}</div>
          <div className="flex items-center justify-center gap-2 pb-4 text-muted-foreground">
            <ScaleIcon className="size-4" /> Total Weight <span className="font-mono font-semibold text-foreground">{fmtKg(weight)}</span>
          </div>
          {/* Customer name is entered here, at checkout (optional). Enter continues to payment. */}
          <label htmlFor="pos-customer" className="grid gap-1.5 text-sm font-medium">
            <span className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-primary uppercase"><UserRoundIcon className="size-3.5" /> Customer Name</span>
            <div className="flex items-center gap-2">
              <Input id="pos-customer" list="pos-customers" autoComplete="off" autoFocus placeholder="Type or select customer (optional)"
                value={customer} onChange={(e) => setCustomer(e.target.value)} className="h-11 flex-1 rounded-xl text-base" />
              {customer && <Button variant="ghost" size="icon-sm" aria-label="Clear customer" onClick={() => setCustomer("")}><XIcon /></Button>}
            </div>
            <datalist id="pos-customers">{knownCustomers.map((n) => <option key={n} value={n} />)}</datalist>
          </label>
          <Button
            size="lg"
            className="h-11"
            onClick={() => {
              setPayment("Cash")
              setStage("pay")
            }}
          >
            Continue to payment <EnterKbd inverted />
          </Button>
        </DialogContent>
      </Dialog>

      {/* Step 2: payment method */}
      <Dialog open={stage === "pay"} onOpenChange={(o) => !o && closeDialogs()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Payment Method</DialogTitle>
            <DialogDescription>
              Amount due <span className="font-mono font-medium text-foreground">{fmt(total)}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-sm">
            <UserRoundIcon className="size-4 text-primary" />
            <span className="text-muted-foreground">Customer:</span>
            <span className="font-semibold">{customer.trim() || "Walk-in (no name)"}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 py-2">
            {(
              [
                ["Cash", BanknoteIcon, "1"],
                ["Balance", WalletIcon, "2"],
              ] as const
            ).map(([method, Icon, key]) => (
              <button
                key={method}
                type="button"
                disabled={busy}
                onClick={() => void complete(method)}
                onMouseEnter={() => setPayment(method)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border-2 p-5 outline-none transition-all disabled:opacity-60",
                  payment === method ? "border-primary bg-primary/10 text-primary shadow-md" : "border-border hover:border-primary/40 hover:bg-accent",
                )}
              >
                {busy && payment === method ? <Loader2Icon className="size-7 animate-spin" /> : <Icon className="size-7" />}
                <span className="text-base font-semibold">{method}</span>
                <Kbd>{key}</Kbd>
              </button>
            ))}
          </div>
          {payment === "Balance" && (
            <label className="grid gap-1.5 text-sm">
              Cash received now (optional)
              <Input type="number" inputMode="decimal" min={0} max={total} step="any" value={paidNow} disabled={busy}
                onChange={(e) => setPaidNow(e.target.value)} placeholder="0" />
              <span className="text-xs text-muted-foreground">Remaining balance: <span className="font-mono">{fmt(Math.max(0, total - (Number(paidNow) || 0)))}</span></span>
            </label>
          )}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              <Kbd>←</Kbd> <Kbd>→</Kbd> switch
            </span>
            {payment === "Balance" && <Badge variant="secondary">Recorded as credit</Badge>}
            <span>{busy ? "Saving…" : <><EnterKbd /> complete sale</>}</span>
          </div>
        </DialogContent>
      </Dialog>

      {/* Step 3: sale complete */}
      <Dialog open={stage === "done"} onOpenChange={(o) => !o && closeDialogs()}>
        <DialogContent className="sm:max-w-sm">
          {lastSale && (
            <>
              <div className="flex flex-col items-center gap-3 pt-4 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2Icon className="size-8" />
                </div>
                <DialogTitle className="text-lg">Sale complete</DialogTitle>
                <DialogDescription>
                  {lastSale.customerName ? `${lastSale.customerName} · ` : ""}Customer #{lastSale.customerNo} · paid by {lastSale.payment}
                  <br />
                  Total Weight {fmtKg(totalWeight(lastSale.lines))}
                </DialogDescription>
                <div className="font-mono text-4xl font-semibold tracking-tight tabular-nums">{fmt(lastSale.total)}</div>
              </div>
              <div className="grid gap-2 pt-2">
                <Button
                  size="lg"
                  variant={printed ? "outline" : "default"}
                  className="h-12 text-base"
                  autoFocus
                  onClick={() => print(lastSale)}
                >
                  <PrinterIcon /> {printed ? "Print again" : "Print bill"} {printed ? <Kbd>P</Kbd> : <><EnterKbd inverted /> <Kbd className="bg-primary-foreground/15 text-primary-foreground">P</Kbd></>}
                </Button>
                <Button size="lg" variant={printed ? "default" : "outline"} className="h-12 text-base" onClick={closeDialogs}>
                  {printed ? "New sale" : "New sale — no bill"} {printed ? <><EnterKbd inverted /> <Kbd className="bg-primary-foreground/15 text-primary-foreground">N</Kbd></> : <Kbd>N</Kbd>}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  {printed ? "Press Enter or N to start the next sale." : "Press Enter to print, or N to skip the bill."}
                </p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Quantity that turns into an input on click; commits on Enter/blur, Esc cancels, 0 removes. */
function QtyCell({ value, onCommit, onDone }: { value: number; onCommit: (q: number) => void; onDone: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")

  if (!editing)
    return (
      <button
        type="button"
        title="Click to edit quantity"
        onClick={() => {
          setDraft(String(value))
          setEditing(true)
        }}
        className="rounded-md border border-transparent px-2 py-1 font-mono tabular-nums transition-colors hover:border-border hover:bg-muted"
      >
        {value}
      </button>
    )

  const commit = () => {
    const q = parseFloat(draft)
    if (draft.trim() !== "" && q >= 0) onCommit(q)
    setEditing(false)
  }

  return (
    <Input
      autoFocus
      type="number"
      min={0}
      step="any"
      inputMode="decimal"
      value={draft}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit()
          onDone()
        } else if (e.key === "Escape") {
          setEditing(false)
          onDone()
        }
      }}
      className="ml-auto h-8 w-24 text-right font-mono"
    />
  )
}
