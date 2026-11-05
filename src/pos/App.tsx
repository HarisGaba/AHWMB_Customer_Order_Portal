import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { useTheme } from "next-themes"
import { BarChart3Icon, KeyboardIcon, LogOutIcon, MoonIcon, PackagePlusIcon, ShoppingCartIcon, SunIcon, TagIcon } from "lucide-react"
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
import { signOutToLogin } from "@/lib/supabase"
import { AddItemPage } from "@/pages/add-item-page"
import { PosPage } from "@/pages/pos-page"
import { RatesPage } from "@/pages/rates-page"
import { usePosAccess } from "@/components/auth-gate"
import { can } from "../lib/access"

// Summary pulls in the charting library; load it only when opened.
const SummaryPage = lazy(() => import("@/pages/summary-page").then((m) => ({ default: m.SummaryPage })))

const ALL_NAV = [
  { id: "pos", label: "Point of Sale", icon: ShoppingCartIcon, page: PosPage, perm: "pos_billing" },
  { id: "rates", label: "Rate Changing", icon: TagIcon, page: RatesPage, perm: "pos_items" },
  { id: "add", label: "Item Addition", icon: PackagePlusIcon, page: AddItemPage, perm: "pos_items" },
  { id: "summary", label: "Total Summary", icon: BarChart3Icon, page: SummaryPage, perm: "pos_summary" },
] as const

type PageId = (typeof ALL_NAV)[number]["id"]

export default function App() {
  const access = usePosAccess()
  // Only the pages this user was given appear in the menu (the database enforces the same rules).
  const NAV = useMemo(() => ALL_NAV.filter((n) => can(access, n.perm)), [access])
  const [page, setPage] = useState<PageId>(() => NAV[0]?.id ?? "pos")
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
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-4]$/.test(e.key)) {
        const target = NAV[Number(e.key) - 1]
        if (!target) return
        e.preventDefault()
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
                {NAV.map((n, i) => (
                  <SidebarMenuItem key={n.id}>
                    <SidebarMenuButton isActive={page === n.id} tooltip={n.label} onClick={() => setPage(n.id)} className="h-11 rounded-xl font-medium text-sidebar-foreground/80 transition-colors hover:text-sidebar-accent-foreground data-active:bg-sidebar-primary data-active:font-semibold data-active:text-sidebar-primary-foreground data-active:shadow-md data-active:hover:bg-sidebar-primary data-active:hover:text-sidebar-primary-foreground">
                      <n.icon />
                      <span>{n.label}</span>
                      <span className="ml-auto rounded-md bg-black/15 px-1.5 py-0.5 font-mono text-[10px] opacity-70">Alt+{i + 1}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <TodayCard />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-h-svh md:h-[calc(100svh-1rem)] md:min-h-0">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-card/80 px-4 backdrop-blur md:rounded-t-xl">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-1 h-4!" />
          <span className="flex items-center gap-2 text-sm font-semibold"><current.icon className="size-4 text-primary" />{current.label}</span>
          <div className="ml-auto flex items-center gap-2">
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
