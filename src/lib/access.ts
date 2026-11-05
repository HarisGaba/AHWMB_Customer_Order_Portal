import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

// Page permissions. Keys must match the has_perm() checks in the database
// (supabase/migrations/20261107_user_permissions.sql) and the manage-users function.
export const PERMISSIONS = [
  { key: 'orders', label: 'Orders (New & View)', area: 'Portal' },
  { key: 'daily_report', label: 'Daily Report (Expenses)', area: 'Portal' },
  { key: 'customer_report', label: 'Customer Ledger', area: 'Portal' },
  { key: 'add_customer', label: 'Add Customer', area: 'Portal' },
  { key: 'stock_report', label: 'Stock Report', area: 'Portal' },
  { key: 'stock_transfer', label: 'Stock Transfer', area: 'Portal' },
  { key: 'purchase_report', label: 'Purchase Report', area: 'Portal' },
  { key: 'products', label: 'Add Products', area: 'Portal' },
  { key: 'pos_billing', label: 'POS Billing', area: 'POS' },
  { key: 'pos_items', label: 'POS Items & Rates', area: 'POS' },
  { key: 'pos_summary', label: 'POS Total Summary (Financial Totals)', area: 'POS' },
] as const
export type Permission = (typeof PERMISSIONS)[number]['key']
export const PORTAL_PERMISSIONS = PERMISSIONS.filter(p => p.area === 'Portal').map(p => p.key) as Permission[]
export const POS_PERMISSIONS = PERMISSIONS.filter(p => p.area === 'POS').map(p => p.key) as Permission[]
export const permissionLabel = (key: string) => PERMISSIONS.find(p => p.key === key)?.label ?? key

/**
 * admin = the main admin (ahwmb1965@gmail.com): every admin-panel page plus Users.
 * The POS is separate: only users explicitly given POS pages (e.g. Ahmed) can open it.
 */
export type Access = { admin: boolean; active: boolean; name: string; permissions: Permission[] }
export const NO_ACCESS: Access = { admin: false, active: false, name: '', permissions: [] }

const isPosPermission = (perm: Permission) => POS_PERMISSIONS.includes(perm)
export const can = (access: Access | null | undefined, perm: Permission) =>
  !!access && ((access.admin && !isPosPermission(perm)) || (access.active && access.permissions.includes(perm)))
export const hasPortalAccess = (access: Access | null | undefined) => !!access && (access.admin || PORTAL_PERMISSIONS.some(p => can(access, p)))
export const hasPosAccess = (access: Access | null | undefined) => POS_PERMISSIONS.some(p => can(access, p))
/** Where a user lands after login: the admin panel if they have any portal page, else the POS. */
export const homePathFor = (access: Access | null | undefined) =>
  hasPortalAccess(access) ? '/admin' : hasPosAccess(access) ? '/pos' : '/login'

export async function fetchAccess(client: SupabaseClient | null): Promise<Access> {
  if (!client) return NO_ACCESS
  const { data: session } = await client.auth.getSession()
  if (!session.session) return NO_ACCESS
  const { data, error } = await client.rpc('my_access')
  if (error || !data) return NO_ACCESS
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
    const refresh = async () => {
      const next = await fetchAccess(client)
      if (!cancelled) setAccess(next)
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
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
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
