/**
 * One place that turns any failure (Supabase/PostgREST/Postgres error, network error, thrown Error)
 * into a clear message staff can act on. Messages our own SQL raises on purpose
 * (e.g. "Not enough Chawal in Shop") are already clear and pass through unchanged.
 */
type ErrLike = { message?: unknown; code?: unknown; details?: unknown; hint?: unknown }

const raw = (e: unknown): { message: string; code: string } => {
  if (typeof e === 'string') return { message: e, code: '' }
  if (e && typeof e === 'object') {
    const v = e as ErrLike
    return { message: typeof v.message === 'string' ? v.message : '', code: typeof v.code === 'string' ? v.code : '' }
  }
  return { message: String(e ?? ''), code: '' }
}

export function friendlyError(e: unknown, fallback = 'Something went wrong. Nothing was lost; please try again.'): string {
  const { message } = raw(e)
  const friendly = mapError(e, fallback)
  // Keep the original database text in brackets for troubleshooting.
  return message && friendly !== message && !friendly.includes(message) ? `${friendly} [${message}]` : friendly
}

function mapError(e: unknown, fallback: string): string {
  const { message, code } = raw(e)
  const m = message.toLowerCase()
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/.test(m))
    return 'No internet connection. Your entry is kept on screen — try again when the connection is back.'
  if (code === 'PGRST301' || code === 'PGRST303' || /jwt expired|invalid jwt|refresh token|session.*(missing|expired)|login has expired/.test(m))
    return m.includes('login has expired') ? message : 'Your login has expired. Log in again — nothing on this screen was lost.'
  if (code === 'PGRST116' || m.includes('json object requested') || m.includes('no) rows returned'))
    return 'Not saved: this record was not found or this login may not change it. Refresh the page and try again.'
  if (code === 'PGRST202' || m.includes('could not find the function'))
    return 'The database is missing an update. Run supabase/manual/check_setup.sql in Supabase to see which file to run.'
  if (code === 'PGRST204' || /column .* (does not exist|of .* not found)|could not find the .* column/.test(m))
    return 'The database is missing a column. Run supabase/manual/check_setup.sql in Supabase to see which file to run.'
  if (m.includes('customer prices must be confirmed'))
    return 'Your admin login was not recognised (it may have expired). Log in again and press Submit — the form is kept.'
  if (code === '23505' || m.includes('duplicate key'))
    return 'This already exists (same name or reference). Edit the existing entry or use a different name.'
  if (code === '23503' || m.includes('violates foreign key'))
    return 'This is still linked to other records (for example ledger entries), so it was not removed.'
  if (code === '42501' || m.includes('permission denied') || m.includes('row-level security'))
    return 'This login is not allowed to do that. Log in again with an admin account.'
  if (code === '22P02' || m.includes('invalid input syntax'))
    return 'A field has an invalid value (for example text in a number field). Check the entries and try again.'
  if (code === '57014' || m.includes('timeout') || m.includes('did not confirm'))
    return message || 'The server took too long. Your entry is kept — try again; it will not be saved twice.'
  return message || fallback
}
