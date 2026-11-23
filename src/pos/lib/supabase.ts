import type { SupabaseClient } from "@supabase/supabase-js"
import { isPosConfigured, posSupabase } from "../../lib/posSupabase"
import { signOutEverywhere } from "../../lib/supabase"

// Shared with the portal's login page, so a sign-in there carries over to the POS.
export const supabaseConfigured = isPosConfigured
export const supabase = posSupabase as SupabaseClient

/** Sign out and return to the shared portal login (full reload swaps stylesheets). */
export async function signOutToLogin() {
  await signOutEverywhere()
  window.location.assign("/login?next=/pos")
}
