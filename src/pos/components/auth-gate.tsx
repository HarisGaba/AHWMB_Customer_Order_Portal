import { createContext, useContext, useEffect } from "react"
import { DatabaseIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { actions, useStore } from "@/lib/store"
import { hasPortalAccess, hasPosAccess, hasPosDataAccess, NO_ACCESS, useLiveAccess, type Access } from "../../lib/access"
import { signOutToLogin, supabase, supabaseConfigured } from "@/lib/supabase"

/** The signed-in user's page permissions, for the POS menu and page guards. */
const PosAccessContext = createContext<Access>(NO_ACCESS)
export const usePosAccess = () => useContext(PosAccessContext)

/**
 * Sends visitors without POS pages away (to the admin panel if they have portal pages,
 * otherwise to the login), then loads the shop data and renders the app.
 * Permissions are live: if the admin removes this user's POS access, they leave at once.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { access, email } = useLiveAccess(supabaseConfigured ? supabase : null)
  const status = useStore((s) => s.status)
  const error = useStore((s) => s.error)

  const allowed = hasPosAccess(access)
  const posData = hasPosDataAccess(access)
  useEffect(() => {
    if (allowed && posData) void actions.load()
    else if (allowed) actions.skip() // Admin System pages only: no sales/items to load
    else actions.reset()
  }, [allowed, posData, email])

  if (!supabaseConfigured) return <NotConfigured />
  if (access === null) return <FullScreenLoader label="Starting…" />
  if (!allowed) return hasPortalAccess(access) ? <Redirect to="/admin" /> : <RedirectToLogin />
  if (status === "error")
    return (
      <Centered>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TriangleAlertIcon className="size-4 text-destructive" /> Couldn’t load data</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button onClick={() => void actions.load()}>Retry</Button>
            <Button variant="outline" onClick={() => void signOutToLogin()}>Sign out</Button>
          </CardContent>
        </Card>
      </Centered>
    )
  if (status !== "ready") return <AppSkeleton />
  return <PosAccessContext.Provider value={access}>{children}</PosAccessContext.Provider>
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">{children}</div>
}

function FullScreenLoader({ label }: { label: string }) {
  return (
    <Centered>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" /> {label}
      </div>
    </Centered>
  )
}

function RedirectToLogin() {
  return <Redirect to="/login" label="Redirecting to sign in…" />
}

function Redirect({ to, label = "Opening your pages…" }: { to: string; label?: string }) {
  useEffect(() => {
    window.location.replace(to)
  }, [to])
  return <FullScreenLoader label={label} />
}

function NotConfigured() {
  return (
    <Centered>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><DatabaseIcon className="size-4" /> Database not connected</CardTitle>
          <CardDescription>
            Set <code className="font-mono">VITE_POS_SUPABASE_URL</code> and <code className="font-mono">VITE_POS_SUPABASE_ANON_KEY</code> in
            <code className="font-mono"> .env.local</code> (local) or in Vercel → Settings → Environment Variables, then rebuild.
          </CardDescription>
        </CardHeader>
      </Card>
    </Centered>
  )
}

/** App-shaped placeholder shown while the shop data loads. */
function AppSkeleton() {
  return (
    <div className="flex min-h-svh bg-sidebar" aria-busy="true" aria-label="Loading">
      <div className="hidden w-64 shrink-0 flex-col gap-2 p-4 md:flex">
        <div className="mb-4 flex items-center gap-2">
          <Skeleton className="size-8 rounded-lg" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
        <Skeleton className="mt-auto h-20 w-full" />
      </div>
      <div className="m-2 flex flex-1 flex-col gap-6 rounded-xl bg-background p-6 shadow-sm">
        <div className="grid gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="grid gap-3 rounded-xl border p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-32" />
            </div>
          ))}
        </div>
        <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(300px,400px)_1fr]">
          <div className="grid content-start gap-2 rounded-xl border p-3">
            <Skeleton className="h-9 w-full" />
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-1 py-1.5">
                <Skeleton className="size-7 rounded-md" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
          <div className="grid content-start gap-3 rounded-xl border p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
