import type { SupabaseClient } from '@supabase/supabase-js'

export type Purchase = { id: string; party: string; area: string; item: string; quantity?: string; amount: string; date: string; version?: number; localRevision?: number }
const LEGACY_KEY = 'ahwmb-purchase-report'
const PREFIX = 'ahwmb-purchase-snapshot:'
export const validPurchase = (r: Purchase) => typeof r?.party === 'string' && !!r.party.trim() && /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && String(r.amount ?? '').trim() !== '' && Number.isFinite(Number(r.amount)) && Number(r.amount) >= 0 && Number(r.amount) <= 100000000000
export const purchaseSchemaMissing = (error: { code?: string } | null) => !!error && ['PGRST202', 'PGRST205', '42P01'].includes(error.code || '')

/** Read old browser records without modifying them. Invalid storage is not overwritten. */
export function readLocalPurchases(storage: Storage): Purchase[] {
 const original = JSON.parse(storage.getItem(LEGACY_KEY) || '[]')
 if (!Array.isArray(original)) throw new Error('Existing purchase backup could not be read. It has not been changed.')
 const rows = new Map<string, Purchase>()
 for (const row of original) {
  if (row && typeof row.id === 'string' && (row.party || row.item || row.amount)) rows.set(row.id, { ...row, amount: String(row.amount ?? ''), localRevision: 0 })
 }
 for (let i = 0; i < storage.length; i++) {
  const key = storage.key(i)
  if (!key?.startsWith(PREFIX)) continue
  const row = JSON.parse(storage.getItem(key) || 'null') as Purchase | null
  if (!row || !validPurchase(row) || typeof row.localRevision !== 'number') throw new Error('A saved purchase snapshot could not be read. No records were changed.')
  if (!rows.has(row.id) || (rows.get(row.id)?.localRevision ?? 0) < row.localRevision) rows.set(row.id, row)
 }
 return [...rows.values()]
}

/** Each edit appends a new snapshot. Never rewrite the legacy array or delete history. */
export function saveLocalPurchase(storage: Storage, row: Purchase): Purchase {
 if (!validPurchase(row)) throw new Error('Enter supplier, date and a nonnegative amount.')
 if (row.version != null) throw new Error('This database purchase cannot be edited locally. Your form is preserved; please restore database saving.')
 const existing = readLocalPurchases(storage).find(r => r.id === row.id)
 const same = existing && ['party','area','item','quantity','amount','date'].every(k => String(existing[k as keyof Purchase] ?? '') === String(row[k as keyof Purchase] ?? ''))
 if (same) return existing
 if (existing && existing.localRevision !== row.localRevision) throw new Error('This purchase changed in another tab. Reload before editing; your entry has not been overwritten.')
 const saved = { ...row, localRevision: Math.max(Date.now(), (existing?.localRevision ?? 0) + 1) }
 storage.setItem(`${PREFIX}${row.id}:${saved.localRevision}:${crypto.randomUUID()}`, JSON.stringify(saved))
 return saved
}

const FIELDS = ['party', 'area', 'item', 'quantity', 'date'] as const
/** Same values as the database stores them (supplier trimmed; blank quantity = none). */
export const samePurchase = (a: Partial<Purchase>, b: Partial<Purchase>) =>
 FIELDS.every(k => k === 'party' ? String(a[k] ?? '').trim() === String(b[k] ?? '').trim() : String(a[k] ?? '') === String(b[k] ?? '')) && Number(a.amount) === Number(b.amount)
const forDb = (row: Purchase) => { const { localRevision: _l, version: _v, ...rest } = row as Purchase & { archived_at?: unknown }; void _l; void _v; return rest }

/** Database first. A row still kept only in this browser is written to the database (inserted, or
 *  updated if its database copy exists); the browser copy is left untouched as a backup.
 *  The browser is used only when the database table does not exist yet. */
export async function persistPurchase(db: SupabaseClient | null, row: Purchase, localSave: (row: Purchase) => Promise<Purchase>, localMode = false) {
 if (!validPurchase(row)) throw new Error('Enter supplier, date and a nonnegative amount.')
 if (!db || localMode) return { row: await localSave(row), destination: 'device' as const }
 let version = row.version ?? null
 if (row.localRevision != null) {
  const { data: existing, error } = await db.from('purchases').select('version').eq('id', row.id).maybeSingle()
  if (error && !purchaseSchemaMissing(error)) throw new Error(error.message)
  version = existing?.version ?? null
 }
 const { data, error } = await db.rpc('save_purchase', { p_row: forDb(row), p_version: version })
 if (error) {
  if (purchaseSchemaMissing(error)) return { row: await localSave(row), destination: 'device' as const }
  throw new Error(error.message)
 }
 if (!data?.id) throw new Error('The database did not confirm the save. Your form is preserved; please retry.')
 return { row: { ...data, amount: String(data.amount) } as Purchase, destination: 'database' as const }
}

export type SyncResult = { imported: number; updated: number; problems: string[] }
/** Copy browser-only purchases into the database: new ones are inserted; if a database copy differs,
 *  the more recently changed version wins. Nothing is deleted; browser copies stay as a backup. */
export async function syncLocalPurchases(db: SupabaseClient, local: Purchase[], remote: (Purchase & { updated_at?: string })[]): Promise<SyncResult> {
 const result: SyncResult = { imported: 0, updated: 0, problems: [] }
 for (const row of local) {
  if (!validPurchase(row)) { result.problems.push(`${row.party || '(no supplier)'}: needs a supplier, valid date and amount`); continue }
  const existing = remote.find(r => r.id === row.id)
  if (existing && samePurchase(existing, row)) continue
  if (existing) {
   const dbChanged = Date.parse(existing.updated_at || '') || 0
   if ((row.localRevision ?? 0) <= dbChanged) continue // database copy is newer: keep it
  }
  const { error } = await db.rpc('save_purchase', { p_row: forDb(row), p_version: existing ? existing.version ?? null : null })
  if (error) { result.problems.push(`${row.party}: ${error.message}`); continue }
  if (existing) result.updated++; else result.imported++
 }
 return result
}
