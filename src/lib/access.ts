import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isPosEmail } from './posSupabase'

// Page permissions. Keys must match the has_perm() checks in the database
// (supabase/migrations/20261107_user_permissions.sql) and the manage-users function.
export const PERMISSIONS = [
  { key: 'orders', label: 'Orders (New & View)', area: 'Portal' },
  { key: 'daily_report', label: 'Daily Report (Expenses)', area: 'Portal' },
  { key: 'purchase_report', label: 'Purchase Report', area: 'Portal' },
  { key: 'stock_report', label: 'Stock Report', area: 'System' },
  { key: 'stock_transfer', label: 'Stock Transfer', area: 'System' },
  { key: 'customer_report', label: 'Customer Ledger', area: 'System' },
  { key: 'add_customer', label: 'Add Customer', area: 'Portal' },
  { key: 'products', label: 'Add Products (Order Catalog)', area: 'Portal' },
  { key: 'pos_billing', label: 'POS Billing', area: 'POS' },
  { key: 'pos_items', label: 'POS Items & Rates', area: 'POS' },
  { key: 'pos_summary', label: 'POS Total Summary (Financial Totals)', area: 'POS' },
] as const
export type Permission = (typeof PERMISSIONS)[number]['key']
export const PORTAL_PERMISSIONS = PERMISSIONS.filter(p => p.area === 'Portal').map(p => p.key) as Permission[]
export const POS_PERMISSIONS = PERMISSIONS.filter(p => p.area === 'POS').map(p => p.key) as Permission[]
/** Reports & management pages that live in the POS / Admin System (/pos). */
export const SYSTEM_PERMISSIONS = PERMISSIONS.filter(p => p.area === 'System').map(p => p.key) as Permission[]
export const permissionLabel = (key: string) => PERMISSIONS.find(p => p.key === key)?.label ?? key

/**
 * Two systems:
 *  - Customer Order Portal (/admin): New Order, View Orders, Daily Report, Purchase Report.
 *  - POS / Admin System (/pos): POS billing, items & rates, summary, plus Stock Report,
 *    Customer Report, Add Customer, Order Catalog and Users.
 * admin = the main admin (ahwmb1965@gmail.com): every portal and system page plus Users.
 * Other users see only the pages given to them in Users.
 */
export type Access = { admin: boolean; active: boolean; name: string; permissions: Permission[] }
export const NO_ACCESS: Access = { admin: false, active: false, name: '', permissions: [] }

// The main admin may open every page, including POS billing in /pos (the database allows it too).
export const can = (access: Access | null | undefined, perm: Permission) =>
  !!access && (access.admin || (access.active && access.permissions.includes(perm)))
/** Can open the Customer Order Portal (/admin). System pages count too: the portal home links to them. */
export const hasPortalAccess = (access: Access | null | undefined) => !!access && (access.admin || [...PORTAL_PERMISSIONS, ...SYSTEM_PERMISSIONS].some(p => can(access, p)))
/** Can open the POS / Admin System at all (POS pages, system pages or Users). */
export const hasPosAccess = (access: Access | null | undefined) => !!access && (access.admin || [...POS_PERMISSIONS, ...SYSTEM_PERMISSIONS].some(p => can(access, p)))
/** Has POS billing data pages (sales/items), which need the POS data loaded. */
export const hasPosDataAccess = (access: Access | null | undefined) => POS_PERMISSIONS.some(p => can(access, p))
/**
 * Where a user lands after login. The portal (/admin) for everyone who has portal pages;
 * the POS only when they came from the POS (next = '/pos') or have nothing but POS billing.
 */
/** Accounts that always open the Customer Order Portal after login. */
const PORTAL_EMAILS = ['ahwmb1965@gmail.com']
export const homePathFor = (access: Access | null | undefined, next?: string | null, email = '') => {
  const e = email.trim().toLowerCase()
  // Fixed homes by account: ahwmb1965 -> portal; POS accounts (ahmedyounus1978) -> POS.
  if (PORTAL_EMAILS.includes(e) && hasPortalAccess(access)) return '/admin'
  if (isPosEmail(e) && hasPosAccess(access)) return '/pos'
  if (next === '/pos' && hasPosAccess(access)) return '/pos'
  return hasPortalAccess(access) ? '/admin' : hasPosAccess(access) ? '/pos' : '/login'
}

export async function fetchAccess(client: SupabaseClient | null): Promise<Access> {
  if (!client) return NO_ACCESS
  const { data: session } = await client.auth.getSession()
  if (!session.session) return NO_ACCESS
  // A network hiccup (phone waking up, weak signal) must never look like "no access",
  // or the user gets signed out. Retry, then throw so callers keep what they had.
  let result = await client.rpc('my_access')
  for (let attempt = 1; result.error && attempt < 3; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 700 * attempt))
    result = await client.rpc('my_access')
  }
  const { data, error } = result
  if (error) throw error
  if (!data) return NO_ACCESS
  return {
    admin: data.admin === true,
    active: data.active === true,
    name: String(data.name || ''),
    permissions: (Array.isArray(data.permissions) ? data.permissions : []) as Permission[],
  }
}

/**
 * The signed-in user's access, kept live: it is re-read on sign-in/out, when the admin
 * changes this user's permissions (Realtime on app_users), and when the tab becomes visible.
 * null while loading.
 */
export function useLiveAccess(client: SupabaseClient | null) {
  const [access, setAccess] = useState<Access | null>(null)
  const [email, setEmail] = useState('')
  useEffect(() => {
    if (!client) { setAccess(NO_ACCESS); return }
    let cancelled = false
    let channel: ReturnType<SupabaseClient['channel']> | null = null
    let busy = false
    const refresh = async () => {
      if (busy) return // one check at a time
      busy = true
      try {
        const next = await fetchAccess(client)
        if (!cancelled) setAccess(next)
      } catch {
        // Temporary error: keep the current access (stay signed in); retry on next focus.
        if (!cancelled) setAccess(prev => prev ?? null)
      } finally { busy = false }
    }
    const watch = (userId: string | undefined) => {
      if (channel) void client.removeChannel(channel)
      channel = null
      if (!userId) return
      channel = client
        .channel(`access-${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'app_users', filter: `user_id=eq.${userId}` }, () => void refresh())
        .subscribe()
    }
    void client.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email || '')
      watch(data.session?.user?.id)
      void refresh()
    })
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED') return
      setEmail(session?.user?.email || '')
      watch(session?.user?.id)
      void refresh()
    })
    // Re-check when the tab comes back, at most once a minute.
    let lastCheck = Date.now()
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 60_000) return
      lastCheck = Date.now()
      void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
      if (channel) void client.removeChannel(channel)
    }
  }, [client])
  return { access, email }
}
