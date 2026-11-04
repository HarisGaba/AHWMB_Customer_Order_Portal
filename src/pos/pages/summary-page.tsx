import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { addDays, format, parseISO, subDays } from "date-fns"
import {
  BanknoteIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  PrinterIcon,
  ReceiptIcon,
  SearchIcon,
  Trash2Icon,
  TrendingDownIcon,
  TrendingUpIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToday } from "@/hooks/use-today"
import { exportSalesCsv } from "@/lib/export"
import { printReceipt } from "@/lib/receipt"
import { actions, CURRENCY, dayKey, fmt, receiptNo, RETENTION_DAYS, useStore, type Sale } from "@/lib/store"
import { cn } from "@/lib/utils"

const CHART_DAYS = 14
const sumBy = (sales: Sale[], p?: Sale["payment"]) => sales.filter((s) => !p || s.payment === p).reduce((a, s) => a + s.total, 0)


export function SummaryPage() {
  const today = useToday()
  const salesByDay = useStore((s) => s.sales)
  const [day, setDay] = useState(today)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [topRange, setTopRange] = useState<"day" | "period">("day")

  const sales = salesByDay[day] ?? []
  const selected = sales.find((s) => s.id === selectedId) ?? sales[sales.length - 1] ?? null
  const [toDelete, setToDelete] = useState<Sale | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function confirmDelete() {
    const sale = toDelete
    if (!sale || deleting) return
    setDeleting(true)
    try {
      await actions.deleteSale(sale.id)
      toast.success(`Deleted sale of ${fmt(sale.total)}`, { description: sale.customerName || `Customer ${sale.customerNo}` })
      setSelectedId(null)
      setToDelete(null)
    } catch (e) {
      toast.error("Sale not deleted", { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setDeleting(false)
    }
  }
  const oldest = dayKey(subDays(parseISO(today), RETENTION_DAYS))
  const dateInput = useRef<HTMLInputElement>(null)

  // Find a past receipt by its printed number (or customer name / customer #) across all saved days.
  const [query, setQuery] = useState("")
  const results = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "")
    if (!q) return []
    return Object.values(salesByDay)
      .flat()
      .filter((s) => receiptNo(s).toLowerCase().includes(q) || (s.customerName ?? "").toLowerCase().includes(q) || String(s.customerNo) === q)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8)
  }, [query, salesByDay])

  function openSale(sale: Sale) {
    setDay(dayKey(new Date(sale.createdAt)))
    setSelectedId(sale.id)
    setQuery("")
  }

  function openCalendar() {
    const el = dateInput.current
    if (!el) return
    try {
      el.showPicker()
    } catch {
      el.focus()
      el.click()
    }
  }

  // Window of CHART_DAYS days ending on the selected day.
  const windowDays = useMemo(
    () => Array.from({ length: CHART_DAYS }, (_, i) => dayKey(subDays(parseISO(day), CHART_DAYS - 1 - i))),
    [day],
  )
  const prevDayTotal = sumBy(salesByDay[dayKey(subDays(parseISO(day), 1))] ?? [])
  const dayTotal = sumBy(sales)
  const change = prevDayTotal > 0 ? ((dayTotal - prevDayTotal) / prevDayTotal) * 100 : null

  const topItems = useMemo(() => {
    const source = topRange === "day" ? (salesByDay[day] ?? []) : windowDays.flatMap((d) => salesByDay[d] ?? [])
    const map = new Map<string, { name: string; qty: number; revenue: number }>()
    for (const s of source)
      for (const l of s.lines) {
        const key = l.itemId || l.name
        const e = map.get(key) ?? { name: l.name, qty: 0, revenue: 0 }
        e.qty += l.qty
        e.revenue += l.qty * l.rate
        map.set(key, e)
      }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8)
  }, [topRange, day, windowDays, salesByDay])
  const topMax = topItems[0]?.revenue ?? 0
  const topTotal = topItems.reduce((a, t) => a + t.revenue, 0)

  const history = useMemo(
    () =>
      Object.entries(salesByDay)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([d, list]) => ({ day: d, customers: list.length, total: sumBy(list), cash: sumBy(list, "Cash"), balance: sumBy(list, "Balance") })),
    [salesByDay],
  )
  const periodTotal = history.reduce((a, h) => a + h.total, 0)
  const periodCustomers = history.reduce((a, h) => a + h.customers, 0)

  function goTo(d: string) {
    if (d > today || d < oldest) return
    setDay(d)
    setSelectedId(null)
  }

  function exportRange(days: number | "day") {
    const list =
      days === "day" ? [day] : Array.from({ length: days }, (_, i) => dayKey(subDays(parseISO(today), i))).filter((d) => d >= oldest)
    const name = days === "day" ? `sales-${day}.csv` : `sales-${list[list.length - 1]}-to-${today}.csv`
    const rows = exportSalesCsv(salesByDay, list, name)
    if (rows) toast.success(`Exported ${rows} rows`, { description: name })
    else toast.info("Nothing to export", { description: "No sales in that range." })
  }

  const cashCount = sales.filter((s) => s.payment === "Cash").length
  const stats: { label: string; value: string; icon: typeof UsersIcon; hint?: string; change?: number | null }[] = [
    { label: "Total Customers", value: String(sales.length), icon: UsersIcon, hint: sales.length ? `Avg ${fmt(dayTotal / sales.length)} per customer` : "No customers yet" },
    { label: "Total Sales", value: fmt(dayTotal), icon: ReceiptIcon, change },
    { label: "Cash", value: fmt(sumBy(sales, "Cash")), icon: BanknoteIcon, hint: `${cashCount} sale${cashCount === 1 ? "" : "s"}` },
    { label: "Balance", value: fmt(sumBy(sales, "Balance")), icon: WalletIcon, hint: `${sales.length - cashCount} on credit` },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Total Summary" description={`Daily logs roll over automatically at midnight and are kept for ${RETENTION_DAYS} days.`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border bg-card p-1 shadow-xs">
            <Button variant="ghost" size="icon-sm" onClick={() => goTo(dayKey(addDays(parseISO(day), -1)))} disabled={day <= oldest} aria-label="Previous day">
              <ChevronLeftIcon />
            </Button>
            <div className="relative">
              <button
                type="button"
                onClick={openCalendar}
                title="Pick a date"
                className="flex min-w-44 cursor-pointer items-center justify-center gap-2 rounded-md px-2 py-1 text-sm font-medium transition-colors hover:bg-muted"
              >
                <CalendarDaysIcon className="size-4 text-primary" />
                {format(parseISO(day), "EEE, d MMM yyyy")}
                {day === today && <Badge variant="secondary">Today</Badge>}
              </button>
              <input
                ref={dateInput}
                type="date"
                tabIndex={-1}
                aria-label="Pick a date"
                min={oldest}
                max={today}
                value={day}
                onChange={(e) => e.target.value && goTo(e.target.value)}
                className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
              />
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => goTo(dayKey(addDays(parseISO(day), 1)))} disabled={day >= today} aria-label="Next day">
              <ChevronRightIcon />
            </Button>
            {day !== today && (
              <Button variant="outline" size="sm" className="ml-1" onClick={() => goTo(today)}>
                Today
              </Button>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" className="h-9" />}>
              <DownloadIcon /> Export
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Export sales as CSV</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => exportRange("day")}>{format(parseISO(day), "d MMM yyyy")}</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => exportRange(7)}>Last 7 days</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportRange(30)}>Last 30 days</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportRange(RETENTION_DAYS + 1)}>All ({RETENTION_DAYS} days)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </PageHeader>

      <div className="relative max-w-xl">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) openSale(results[0])
            else if (e.key === "Escape") setQuery("")
          }}
          placeholder="Search receipt no. (e.g. D1C4FC2B), customer name or #"
          className="h-11 rounded-xl bg-card pl-9 font-mono text-base"
          aria-label="Search receipts"
        />
        {query.trim() && (
          <div className="absolute top-full right-0 left-0 z-30 mt-1 overflow-hidden rounded-xl border bg-popover shadow-lg">
            {results.length ? (
              results.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => openSale(s)}
                  className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-muted"
                >
                  <span className="rounded-md bg-gold/15 px-2 py-0.5 font-mono text-xs font-semibold">{receiptNo(s)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.customerName || `Customer ${s.customerNo}`}</span>
                  <span className="text-xs text-muted-foreground">{format(new Date(s.createdAt), "d MMM yyyy, h:mm a")}</span>
                  <span className="font-mono text-sm font-semibold tabular-nums">{fmt(s.total)}</span>
                </button>
              ))
            ) : (
              <div className="px-3 py-3 text-sm text-muted-foreground">No receipt found in the last {RETENTION_DAYS} days.</div>
            )}
          </div>
        )}
      </div>

      {/* KPI tiles */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, hint, change }) => (
          <Card key={label} className="gap-2 rounded-2xl shadow-panel">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardDescription className="font-medium">{label}</CardDescription>
              <Icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="font-mono text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                {change === undefined ? (
                  hint
                ) : change === null ? (
                  "No sales the day before"
                ) : (
                  <>
                    {change >= 0 ? <TrendingUpIcon className="size-3.5" /> : <TrendingDownIcon className="size-3.5" />}
                    <span className="font-medium text-foreground">
                      {change >= 0 ? "+" : ""}
                      {change.toFixed(1)}%
                    </span>
                    vs previous day
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Analytics */}
      <div className="grid gap-6">
        <Card className="rounded-2xl shadow-panel">
          <CardHeader>
            <CardTitle>Top items by revenue</CardTitle>
            <CardDescription>{topRange === "day" ? format(parseISO(day), "d MMM yyyy") : `Last ${CHART_DAYS} days`}</CardDescription>
            <CardAction>
              <Tabs value={topRange} onValueChange={(v) => setTopRange(v as "day" | "period")}>
                <TabsList>
                  <TabsTrigger value="day">Day</TabsTrigger>
                  <TabsTrigger value="period">{CHART_DAYS}d</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardAction>
          </CardHeader>
          <CardContent>
            {topItems.length ? (
              <ol className="flex flex-col gap-3">
                {topItems.map((t, i) => (
                  <li key={t.name} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-x-3 gap-y-1.5" title={`${t.name}: ${fmt(t.revenue)} · ${t.qty} units`}>
                    <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                    <span className="truncate text-sm font-medium">{t.name}</span>
                    <span className="font-mono text-sm tabular-nums">{fmt(t.revenue)}</span>
                    <span />
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-(--chart-1)" style={{ width: `${topMax ? (t.revenue / topMax) * 100 : 0}%` }} />
                    </div>
                    <span className="text-right text-xs text-muted-foreground tabular-nums">
                      {t.qty} units · {topTotal ? Math.round((t.revenue / topTotal) * 100) : 0}%
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">No items sold in this period.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Customers (left) */}
        <Card className="gap-0 py-0 rounded-2xl shadow-panel">
          <CardHeader className="border-b py-4">
            <CardTitle>Customers</CardTitle>
            <CardDescription>{sales.length} transactions on this day</CardDescription>
          </CardHeader>
          <ScrollArea className="h-[420px]">
            <div className="flex flex-col p-2">
              {[...sales].reverse().map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted", selected?.id === s.id && "bg-muted")}
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold">#{s.customerNo}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{s.customerName || `Customer ${s.customerNo}`}</div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(s.createdAt), "h:mm a")} · {s.lines.length} item{s.lines.length === 1 ? "" : "s"} · <span className="font-mono">{receiptNo(s)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-medium tabular-nums">{fmt(s.total)}</div>
                    <Badge variant={s.payment === "Cash" ? "secondary" : "outline"} className="mt-0.5">
                      {s.payment}
                    </Badge>
                  </div>
                </button>
              ))}
              {!sales.length && <div className="py-16 text-center text-sm text-muted-foreground">No sales on this day.</div>}
            </div>
          </ScrollArea>
        </Card>

        {/* Receipt detail */}
        <Card className="gap-0 py-0 rounded-2xl shadow-panel">
          <CardHeader className="border-b py-4">
            <CardTitle>{selected ? selected.customerName || `Customer ${selected.customerNo}` : "Transaction details"}</CardTitle>
            <CardDescription>
              {selected ? `Receipt ${receiptNo(selected)} · ${format(new Date(selected.createdAt), "d MMM yyyy, h:mm a")} · paid by ${selected.payment}` : "Select a customer to view their items."}
            </CardDescription>
            {selected && (
              <CardAction className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => printReceipt(selected)}>
                  <PrinterIcon /> Print receipt
                </Button>
                <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setToDelete(selected)}>
                  <Trash2Icon /> Delete sale
                </Button>
              </CardAction>
            )}
          </CardHeader>
          {selected ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="pr-4 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selected.lines.map((l) => (
                  <TableRow key={l.itemId}>
                    <TableCell className="pl-4 font-medium">{l.name}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{l.qty}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground tabular-nums">{fmt(l.rate)}</TableCell>
                    <TableCell className="pr-4 text-right font-mono tabular-nums">{fmt(l.qty * l.rate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="pl-4 font-semibold">
                    Total
                  </TableCell>
                  <TableCell className="pr-4 text-right font-mono font-semibold tabular-nums">{fmt(selected.total)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          ) : (
            <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">Nothing to show.</div>
          )}
        </Card>
      </div>

      {/* History */}
      <Card className="gap-0 py-0 rounded-2xl shadow-panel">
        <CardHeader className="border-b py-4">
          <CardTitle>Daily history</CardTitle>
          <CardDescription>
            Last {RETENTION_DAYS} days · {periodCustomers} customers · {fmt(periodTotal)} total sales
          </CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Date</TableHead>
              <TableHead className="text-right">Customers</TableHead>
              <TableHead className="text-right">Cash</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="pr-4 text-right">Total Sales ({CURRENCY})</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((h) => (
              <TableRow
                key={h.day}
                className="cursor-pointer"
                data-state={h.day === day ? "selected" : undefined}
                onClick={() => {
                  goTo(h.day)
                  window.scrollTo({ top: 0, behavior: "smooth" })
                }}
              >
                <TableCell className="pl-4 font-medium">
                  {format(parseISO(h.day), "EEE, d MMM yyyy")}
                  {h.day === today && (
                    <Badge variant="secondary" className="ml-2">
                      Today
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{h.customers}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground tabular-nums">{fmt(h.cash)}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground tabular-nums">{fmt(h.balance)}</TableCell>
                <TableCell className="pr-4 text-right font-mono font-medium tabular-nums">{fmt(h.total)}</TableCell>
              </TableRow>
            ))}
            {!history.length && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No sales recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && !deleting && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this sale?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete && `${toDelete.customerName || `Customer ${toDelete.customerNo}`} · ${fmt(toDelete.total)} · ${format(new Date(toDelete.createdAt), "d MMM yyyy, h:mm a")}. `}
              Use this when goods are returned and the money is given back. The sale is removed from all totals and can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={deleting} onClick={(e) => { e.preventDefault(); void confirmDelete() }}>
              {deleting ? "Deleting…" : "Delete sale"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
