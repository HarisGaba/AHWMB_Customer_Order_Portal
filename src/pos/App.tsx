import { lazy, Suspense, useEffect, useState } from "react"
import { format } from "date-fns"
import { useTheme } from "next-themes"
import { BarChart3Icon, KeyboardIcon, LogOutIcon, MoonIcon, PackagePlusIcon, ShoppingCartIcon, StoreIcon, SunIcon, TagIcon } from "lucide-react"
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

// Summary pulls in the charting library; load it only when opened.
const SummaryPage = lazy(() => import("@/pages/summary-page").then((m) => ({ default: m.SummaryPage })))

const NAV = [
  { id: "pos", label: "Point of Sale", icon: ShoppingCartIcon, page: PosPage },
  { id: "rates", label: "Rate Changing", icon: TagIcon, page: RatesPage },
  { id: "add", label: "Item Addition", icon: PackagePlusIcon, page: AddItemPage },
  { id: "summary", label: "Total Summary", icon: BarChart3Icon, page: SummaryPage },
] as const

type PageId = (typeof NAV)[number]["id"]

export default function App() {
  const [page, setPage] = useState<PageId>("pos")
  const current = NAV.find((n) => n.id === page)!
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
        e.preventDefault()
        setPage(NAV[Number(e.key) - 1].id)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" className="pointer-events-none">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <StoreIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">{SHOP.name} POS</span>
                  <span className="truncate text-xs text-muted-foreground">Point of Sale System</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Menu</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((n, i) => (
                  <SidebarMenuItem key={n.id}>
                    <SidebarMenuButton isActive={page === n.id} tooltip={n.label} onClick={() => setPage(n.id)} className="h-10">
                      <n.icon />
                      <span>{n.label}</span>
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground">Alt+{i + 1}</span>
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
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-1 h-4!" />
          <span className="text-sm font-medium">{current.label}</span>
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
          <div className="h-full" hidden={page !== "pos"}>
            <PosPage active={page === "pos"} />
          </div>
          {page !== "pos" && (
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
    <div className="rounded-lg border bg-sidebar-accent/50 p-3 group-data-[collapsible=icon]:hidden">
      <div className="text-xs text-muted-foreground">Today’s sales</div>
      <div className="font-mono text-lg font-semibold tabular-nums">{fmt(total)}</div>
      <div className="text-xs text-muted-foreground">{sales?.length ?? 0} customers</div>
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
