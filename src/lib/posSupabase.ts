import { supabase } from './supabase'

// The POS shares the order portal's Supabase project. POS tables are locked to the
// POS user by RLS (public.is_ahwmb_pos_user), so portal admins cannot see them.
export const isPosConfigured = Boolean(supabase)
export const posSupabase = supabase

/** Emails that sign in to the POS instead of the portal admin panel. */
const POS_EMAILS = (import.meta.env.VITE_POS_EMAILS || 'ahmedyounus1978@gmail.com')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean)

export const isPosEmail = (email: string) => POS_EMAILS.includes(email.trim().toLowerCase())
