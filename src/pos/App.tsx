import { useUrlView } from "../hooks/useUrlView"
import { ConnectionStatus } from "../components/ConnectionStatus"
import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { useTheme } from "next-themes"
import { BarChart3Icon, BookUserIcon, BoxesIcon, KeyboardIcon, LogOutIcon, MoonIcon, PackagePlusIcon, ShoppingCartIcon, SunIcon, TagIcon, NotebookPenIcon, ReceiptTextIcon, ChevronRightIcon, LayoutDashboardIcon } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ShortcutsDialog } from "@/components/shortcuts-dialog"
import { SHOP } from "@/lib/config"
import { useClock, useToday } from "@/hooks/use-today"
import { fmt, useStore } from "@/lib/store"
import { signOutToLogin, supabase as posDb } from "@/lib/supabase"
import { openPortalFromPos } from "../lib/supabase"
import { AddItemPage } from "@/pages/add-item-page"
import { PosPage } from "@/pages/pos-page"
import { RatesPage } from "@/pages/rates-page"
import { usePosAccess } from "@/components/auth-gate"
import { can, hasPosDataAccess, type Access, type Permission } from "../lib/access"

// Summary pulls in the charting library; load it only when opened.
const SummaryPage = lazy(() => import("@/pages/summary-page").then((m) => ({ default: m.SummaryPage })))

// Admin System pages (reports & management, moved here from the order portal); loaded on demand.
const sys = (name: "DailyReportPage" | "StockReportPage" | "CustomerReportPage" | "PurchaseReportPage" | "ActivityPage") =>
  lazy(() => import("@/pages/system-pages").then((m) => ({ default: m[name] })))

const anyOf = (...perms: Permission[]) => (a: Access | null) => perms.some((p) => can(a, p))
// Set future to false when a module is ready to join the main sidebar menu.
const ALL_NAV = [
  { id: "daily", label: "Daily Report", icon: NotebookPenIcon, page: sys("DailyReportPage"), allow: anyOf("daily_report"), future: false, hidden: false },
  { id: "stock", label: "Stock Report", icon: BoxesIcon, page: sys("StockReportPage"), allow: anyOf("stock_report", "stock_transfer"), future: false, hidden: false },
  { id: "customers", label: "Customer Report", icon: BookUserIcon, page: sys("CustomerReportPage"), allow: anyOf("customer_report"), future: false, hidden: false },
  { id: "purchase", label: "Purchase Report", icon: ReceiptTextIcon, page: sys("PurchaseReportPage"), allow: anyOf("purchase_report"), future: false, hidden: false },
  { id: "pos", label: "Point of Sale", icon: ShoppingCartIcon, page: PosPage, allow: anyOf("pos_billing"), future: true, hidden: false },
  { id: "rates", label: "Rate Changing", icon: TagIcon, page: RatesPage, allow: anyOf("pos_items"), future: true, hidden: false },
  { id: "add", label: "Item Addition", icon: PackagePlusIcon, page: AddItemPage, allow: anyOf("pos_items"), future: true, hidden: false },
  { id: "summary", label: "Total Summary", icon: BarChart3Icon, page: SummaryPage, allow: anyOf("pos_summary"), future: true, hidden: false },
  { id: "activity", label: "Activity History", icon: ReceiptTextIcon, page: sys("ActivityPage"), allow: anyOf("orders", "stock_report", "purchase_report", "customer_report", "pos_summary"), future: false, hidden: false },
] as const

type PageId = (typeof ALL_NAV)[number]["id"]

export default function App() {
  const access = usePosAccess()
  // Only the pages this user was given appear in the menu (the database enforces the same rules).
  const NAV = useMemo(() => ALL_NAV.filter((n) => !n.hidden && n.allow(access)), [access])
  const MAIN = useMemo(() => NAV.filter((n) => !n.future), [NAV])
  const FUTURE = useMemo(() => NAV.filter((n) => n.future), [NAV])
  const [showFuture, setShowFuture] = useState(false)
  // Ahmed's home is the Customer Order Portal: in the POS he always gets the "Admin Panel" button.
  // The main admin (ahwmb1965) never sees it.
  const [userEmail, setUserEmail] = useState("")
  useEffect(() => { void posDb?.auth.getSession().then(({ data }) => setUserEmail((data.session?.user.email || "").toLowerCase())) }, [])
  const showAdminPanel = userEmail === "ahwmb1965@gmail.com" || userEmail === "ahmedyounus1978@gmail.com"
  const [page, setPage] = useUrlView<PageId>(NAV.map(n => n.id), (MAIN[0] ?? NAV[0])?.id ?? "pos")
  // AuthGate only lets users with at least one POS page in, so NAV is never empty.
  const current = (NAV.find((n) => n.id === page) ?? NAV[0])!
  // If a page is taken away while it is open, move to the first page still allowed.
  useEffect(() => {
    if (NAV.length && !NAV.some((n) => n.id === page)) setPage(NAV[0].id)
  }, [NAV, page])
  const Page = current.page
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      if (e.key === "F1" || (e.key === "?" && !typing)) {
        e.preventDefault()
        setHelpOpen(true)
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        const target = NAV[Number(e.key) - 1]
        if (!target) return
        e.preventDefault()
        if (target.future) setShowFuture(true)
        setPage(target.id)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [NAV])

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" className="pointer-events-none">
                <div className="flex aspect-square size-9 items-center justify-center overflow-hidden rounded-xl bg-sidebar-primary/15 ring-1 ring-sidebar-primary/40">
                  <img src="/logo.png" alt="" className="size-full object-cover" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold tracking-wide">{SHOP.name} <span className="text-sidebar-primary">POS</span></span>
                  <span className="truncate text-xs text-sidebar-foreground/60">Jodia Bazaar · Karachi</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/50 tracking-wider uppercase">Menu</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {MAIN.map((n, i) => (
                  <SidebarMenuItem key={n.id}>
                    <SidebarMenuButton isActive={page === n.id} tooltip={n.label} onClick={() => setPage(n.id)} className="h-11 rounded-xl font-medium text-sidebar-foreground/80 transition-colors hover:text-sidebar-accent-foreground data-active:bg-sidebar-primary data-active:font-semibold data-active:text-sidebar-primary-foreground data-active:shadow-md data-active:hover:bg-sidebar-primary data-active:hover:text-sidebar-primary-foreground">
                      <n.icon />
                      <span>{n.label}</span>
                      <span className="ml-auto rounded-md bg-black/15 px-1.5 py-0.5 font-mono text-[10px] opacity-70">Alt+{NAV.indexOf(n) + 1}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {FUTURE.length > 0 && (
            <SidebarGroup>
              {/* Future modules remain fully usable inside this collapsed group. */}
              <button type="button" onClick={() => setShowFuture((v) => !v)} aria-label="In Future" title="In Future" aria-expanded={showFuture} aria-controls="future-modules"
                className="flex h-11 items-center gap-2 rounded-xl px-2 text-left text-sm font-semibold text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                <ChevronRightIcon className={`size-3.5 shrink-0 transition-transform ${showFuture ? "rotate-90" : ""}`} /> <span className="group-data-[collapsible=icon]:hidden">In Future</span>
              </button>
              {showFuture && (
                <SidebarMenu id="future-modules" className="mt-1 border-l border-sidebar-border pl-3 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:pl-0">
                  {FUTURE.map((n) => (
                    <SidebarMenuItem key={n.id}>
                      <SidebarMenuButton tooltip={n.label} isActive={page === n.id} onClick={() => setPage(n.id)} className="h-10 rounded-xl text-sidebar-foreground/80 data-active:bg-sidebar-primary data-active:text-sidebar-primary-foreground">
                        <n.icon />
                        <span>{n.label}</span>
                        <span className="ml-auto font-mono text-[10px] opacity-70">Alt+{NAV.indexOf(n) + 1}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              )}
            </SidebarGroup>
          )}
        </SidebarContent>
        <SidebarFooter>
          {hasPosDataAccess(access) && <TodayCard />}

        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-h-svh md:h-[calc(100svh-1rem)] md:min-h-0">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-card/80 px-4 backdrop-blur md:rounded-t-xl">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-1 h-4!" />
          <span className="flex items-center gap-2 text-sm font-semibold"><current.icon className="size-4 text-primary" />{current.label}</span>
          <div className="ml-auto flex items-center gap-2">
            {/* Both owner accounts can switch to the Customer Order Portal with the same login. */}
            {showAdminPanel && (
              <a href="/admin" onClick={(e) => { e.preventDefault(); openPortalFromPos() }} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 text-sm font-semibold text-primary hover:bg-primary/20">
                <LayoutDashboardIcon className="size-4" /> Admin Panel
              </a>
            )}
            <ConnectionStatus />
            <Clock />
            <Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (F1)" onClick={() => setHelpOpen(true)}>
              <KeyboardIcon />
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="icon-sm" aria-label="Sign out" title="Sign out" onClick={() => void signOutToLogin()}>
              <LogOutIcon />
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
          {/* POS stays mounted so an in-progress cart survives switching modules. */}
          {can(access, "pos_billing") && (
            <div className="h-full" hidden={current.id !== "pos"}>
              <PosPage active={current.id === "pos"} />
            </div>
          )}
          {current.id !== "pos" && (
            <Suspense fallback={<div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
              <Page />
            </Suspense>
          )}
        </div>
      </SidebarInset>
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </SidebarProvider>
  )
}

function TodayCard() {
  const today = useToday()
  const sales = useStore((s) => s.sales[today])
  const total = (sales ?? []).reduce((a, s) => a + s.total, 0)
  return (
    <div className="rounded-xl border border-sidebar-primary/25 bg-gradient-to-br from-sidebar-accent to-sidebar p-4 group-data-[collapsible=icon]:hidden">
      <div className="text-[11px] font-semibold tracking-wider text-sidebar-foreground/60 uppercase">Today’s sales</div>
      <div className="mt-1 font-mono text-xl font-bold text-sidebar-primary tabular-nums">{fmt(total)}</div>
      <div className="text-xs text-sidebar-foreground/60">{sales?.length ?? 0} customers</div>
    </div>
  )
}

function Clock() {
  const now = useClock()
  return (
    <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:inline">
      {format(now, "EEE d MMM · h:mm:ss a")}
    </span>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme === "dark"
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}
