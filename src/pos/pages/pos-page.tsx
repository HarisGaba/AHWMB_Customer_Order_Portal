import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
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
  const [cart, setCart] = useState<SaleLine[]>([])
  const [customer, setCustomer] = useState("")
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
    if (!(q > 0)) return toast.error("Enter a valid quantity")
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
      const sale = await actions.recordSale(cart, method, customer)
      setLastSale(sale)
      setPrinted(false)
      setCart([])
      setCustomer("")
      setStage("done")
    } catch (e) {
      toast.error("Sale not saved", { description: e instanceof Error ? e.message : "Check your internet connection and try again." })
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

      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(300px,400px)_1fr]">
        <ItemCommand
          inputRef={searchRef}
          search={search}
          onSearchChange={setSearch}
          onPick={pick}
          onKeyDown={onSearchKey}
          selectedId={picked?.id}
          className="min-h-80 rounded-2xl! shadow-panel"
          placeholder="Search items…  (Enter on empty = checkout)"
        />

        <Card className="flex min-h-0 flex-col gap-0 overflow-hidden rounded-2xl py-0 shadow-panel">
          {/* Customer */}
          <div className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
              <UserRoundIcon className="size-4" />
            </div>
            <label htmlFor="pos-customer" className="shrink-0 text-[11px] font-semibold tracking-wider text-primary uppercase">
              Customer Name
            </label>
            <Input
              id="pos-customer"
              list="pos-customers"
              autoComplete="off"
              placeholder="Type or select customer (optional)"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  focusSearch()
                }
              }}
              className="h-10 min-w-48 flex-1 rounded-xl text-base"
            />
            <datalist id="pos-customers">
              {knownCustomers.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            {customer && (
              <Button variant="ghost" size="icon-sm" aria-label="Clear customer" onClick={() => setCustomer("")}>
                <XIcon />
              </Button>
            )}
          </div>

          {/* Quantity entry bar */}
          <div className={cn("flex flex-wrap items-center gap-3 border-b bg-gradient-to-r from-accent/70 to-card p-4 transition-colors", picked && "from-gold/20")}>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold tracking-wider text-primary uppercase">Selected item</div>
              {picked ? (
                <div className="truncate text-base font-semibold">
                  {picked.name} <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">@ {fmt(picked.rate)}</span>
                </div>
              ) : (
                <div className="text-base text-muted-foreground">Pick an item from the list</div>
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
              className="h-11 w-28 rounded-xl bg-card text-right font-mono text-base"
            />
            <Button size="lg" className="h-11 rounded-xl px-5 shadow-sm" disabled={!picked} onClick={addLine}>
              Add <EnterKbd inverted />
            </Button>
          </div>

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
