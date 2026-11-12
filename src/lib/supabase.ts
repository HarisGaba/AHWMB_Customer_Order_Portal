import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || __SUPABASE_URL__
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || __SUPABASE_ANON_KEY__

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

/**
 * Two independent logins in the same browser:
 *  - Customer Order Portal (/, /admin): the original storage key, so existing logins are kept.
 *  - POS / Admin System (/pos): its own key.
 * Signing in or out of one never touches the other, so e.g. ahwmb1965 can stay in the portal
 * while Ahmed is signed in to the POS. Both are kept in localStorage (not sessionStorage), so
 * they survive closing the app and restarting the phone until "Logout" is pressed.
 */
const POS_STORAGE_KEY = 'ahwmb-pos-auth'

const make = (storageKey?: string): SupabaseClient | null =>
  isSupabaseConfigured
    ? createClient(supabaseUrl!, supabasePublishableKey!, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storage: typeof window !== 'undefined' ? window.localStorage : undefined,
          ...(storageKey ? { storageKey } : {}),
        },
      })
    : null

const loginNextIsPos = () => typeof window !== 'undefined' && window.location.pathname === '/login' && new URLSearchParams(window.location.search).get('next') === '/pos'
/** True on the POS pages, and on the login page when it was opened from the POS. */
export const isPosContext = () => typeof window !== 'undefined' && (/^\/pos(\/|$)/.test(window.location.pathname) || loginNextIsPos())

// Only the client for the current page refreshes its tokens in the background.
let portal: SupabaseClient | null | undefined
let pos: SupabaseClient | null | undefined
export const portalClient = () => (portal === undefined ? (portal = make()) : portal)
export const posClient = () => (pos === undefined ? (pos = make(POS_STORAGE_KEY)) : pos)
/** The client for the login that belongs to this page. */
export const clientFor = (target: '/admin' | '/pos') => (target === '/pos' ? posClient() : portalClient())

export const supabase = isPosContext() ? posClient() : portalClient()

/** A throw-away client (nothing saved) to check an account before choosing which portal to sign in to. */
export const checkClient = (): SupabaseClient | null =>
  isSupabaseConfigured
    ? createClient(supabaseUrl!, supabasePublishableKey!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'ahwmb-login-check' } })
    : null
