import { createClient } from '@supabase/supabase-js'

// The POS keeps its data in its own Supabase project, separate from the order portal.
const posUrl = import.meta.env.VITE_POS_SUPABASE_URL?.trim().replace(/\/(rest\/v1\/?)?$/, '')
const posKey = import.meta.env.VITE_POS_SUPABASE_ANON_KEY?.trim()

export const isPosConfigured = Boolean(posUrl && posKey)

export const posSupabase = isPosConfigured
  ? createClient(posUrl!, posKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null

/** Emails that sign in to the POS instead of the portal admin panel. */
const POS_EMAILS = (import.meta.env.VITE_POS_EMAILS || 'ahmedyounus1978@gmail.com')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean)

export const isPosEmail = (email: string) => POS_EMAILS.includes(email.trim().toLowerCase())
