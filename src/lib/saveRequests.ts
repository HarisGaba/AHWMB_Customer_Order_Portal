import type { SupabaseClient } from '@supabase/supabase-js'

export function saveError(error: unknown) {
 return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : 'The server did not confirm the save. Keep this bill and retry.'
}
export async function boundedRequest<T>(request: PromiseLike<T>, ms = 30000): Promise<T> {
 let timer: ReturnType<typeof setTimeout> | undefined
 try { return await Promise.race([Promise.resolve(request), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The server did not confirm the save in time. Your entry is preserved. Retry to check its status.')), ms) })]) }
 finally { clearTimeout(timer) }
}

type SaleArgs = { p_day: string; p_lines: { name: string; qty: number; rate: number }[]; p_payment: string; p_customer_name: string | null; p_request_id: string }
/** Legacy RPC retains JSON line snapshots, so a request marker can be recovered
 * without adding columns or modifying any existing receipt. Never resubmit an
 * uncertain legacy write: check history first to avoid duplicate sales.
 */
export async function savePosSale(db: SupabaseClient, args: SaleArgs, storage: Storage) {
 if (!args.p_lines.length || args.p_lines.some(l => !l.name.trim() || !Number.isFinite(l.qty) || l.qty <= 0 || !Number.isFinite(l.rate) || l.rate < 0)) throw new Error('Every sale item needs a name, positive quantity and a valid rate.')
 const modern = await boundedRequest(db.rpc('record_sale_v2', args))
 if (!modern.error) { if (!modern.data?.id) throw new Error('The server did not confirm this sale. Keep the bill and retry.'); return modern.data }
 if (modern.error.code !== 'PGRST202') throw new Error(saveError(modern.error))
 const key = `ahwmb-sale-attempt:${args.p_request_id}`
 const lines = args.p_lines.map((line, index) => index ? line : { ...line, _checkout_request_id: args.p_request_id })
 const found = await boundedRequest(db.from('sales').select('*').contains('lines', [{ _checkout_request_id: args.p_request_id }]).limit(1).maybeSingle())
 if (found.error) throw new Error(saveError(found.error))
 if (found.data) {
  if (JSON.stringify(found.data.lines.map((l: Record<string, unknown>) => { const { _checkout_request_id, ...rest } = l; return rest })) !== JSON.stringify(args.p_lines)) {
   // JSONB object key order is not significant; compare via a canonical encoding.
   if (canonical(found.data.lines.map((l: Record<string, unknown>) => { const { _checkout_request_id, ...rest } = l; return rest })) !== canonical(args.p_lines)) throw new Error('This bill was already saved with different items. Check its receipt before starting another bill.')
  }
  if (found.data.payment !== args.p_payment || (found.data.customer_name || '') !== (args.p_customer_name || '')) throw new Error('This bill was already saved with different payment/customer details. Check its receipt.')
  return found.data
 }
 if (storage.getItem(key)) throw new Error('The previous save is not yet confirmed. Check Total Summary before creating another bill. Your cart is preserved; retry checks for the original receipt.')
 storage.setItem(key, 'pending')
 const { p_request_id, ...legacyArgs } = args
 const legacy = await boundedRequest(db.rpc('record_sale', { ...legacyArgs, p_lines: lines }))
 if (legacy.error) {
  // SQL/permission validation errors confirm that the statement failed. Network
  // and gateway errors may follow a commit, so keep their pending marker.
  if (/^(22|23|42|P0001|PGRST202)/.test(legacy.error.code || '')) storage.removeItem(key)
  throw new Error(saveError(legacy.error))
 }
 if (!legacy.data?.id) throw new Error('The server did not confirm this sale. Keep the bill and retry to check for its receipt.')
 return legacy.data
}
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)

export type OrderArgs = { p_order_ref: string; p_customer_name: string; p_customer_phone: string; p_customer_address: string; p_location_link: string | null; p_notes: string; p_items: { total: number }[] }
/** Customer submission uses the existing insert-only RPC. It never selects or
 * updates customer/order tables and needs no Edge Function or bot-verification key.
 */
export async function saveCustomerOrder(db: SupabaseClient, args: OrderArgs) {
 let result = await boundedRequest(db.rpc('submit_order', args))
 if (result.error?.code === 'PGRST202') {
  const { p_notes, ...oldArgs } = args
  result = await boundedRequest(db.rpc('submit_order', { ...oldArgs, p_customer_address: p_notes ? `${args.p_customer_address}\nNotes: ${p_notes}`.trim() : args.p_customer_address }))
 }
 if (result.error) {
  // A reference is generated once per draft and retained on uncertain responses.
  // Only the order-reference uniqueness error confirms that earlier submission.
  if (result.error.code === '23505' && /orders_order_ref_key/.test(result.error.message || '')) return args.p_order_ref
  throw new Error(saveError(result.error))
 }
 if (!result.data) throw new Error('The server did not confirm the order. Your form is preserved; please retry.')
 return result.data as string
}
export async function saveStaffOrder(db: SupabaseClient, args: OrderArgs) {
 let result = await boundedRequest(db.rpc('submit_order', args))
 let legacy = false
 if (result.error?.code === 'PGRST202') {
  legacy = true
  const { p_notes, ...oldArgs } = args
  result = await boundedRequest(db.rpc('submit_order', { ...oldArgs, p_customer_address: p_notes ? `${args.p_customer_address}\nNotes: ${p_notes}`.trim() : args.p_customer_address }))
 }
 let id = result.data
 if (result.error?.code === '23505') {
  const found = await boundedRequest(db.from('orders').select('id,items,customer_name,customer_phone,customer_address').eq('order_ref', args.p_order_ref).maybeSingle())
  if (found.error) throw new Error(saveError(found.error))
  const expectedAddress = legacy && args.p_notes ? `${args.p_customer_address}\nNotes: ${args.p_notes}`.trim() : args.p_customer_address
  if (!found.data || canonical(found.data.items) !== canonical(args.p_items) || found.data.customer_name !== args.p_customer_name || found.data.customer_phone !== args.p_customer_phone || found.data.customer_address !== expectedAddress) throw new Error('This reference already exists with different details. Your form was kept; review the existing order.')
  id = found.data.id
 } else if (result.error) throw new Error(saveError(result.error))
 if (!id) throw new Error('The server did not confirm the order. Your form is preserved.')
 if (legacy) {
  const total = Math.round(args.p_items.reduce((sum, l) => sum + l.total, 0) * 100) / 100
  // Only finalize the newly created/recovered pending order; never overwrite a
  // completed invoice another user has already processed.
  const update = await boundedRequest(db.from('orders').update({ grand_total: total, total_amount: total, total_balance: total, remaining_balance: total }).eq('id', id).eq('status', 'pending'))
  if (update.error) throw new Error(`Order ${args.p_order_ref} exists, but its totals could not be finalized: ${saveError(update.error)}. Retry this same form; do not create it again.`)
 }
 return id as string
}
