import type { SupabaseClient } from '@supabase/supabase-js'

type SearchArgs = { p_search: string; p_status: string; p_from: string | null; p_to: string | null; p_page: number }
type SearchRow = { id: string; customer_name: string; customer_phone: string; order_ref: string; order_no?: number | null; status: string; created_at: string }

/** Keep existing deployments readable while the optional search RPC is rolled out.
 * Uses the signed-in client and normal orders RLS; never retries authorization errors.
 */
export async function searchOrders(db: SupabaseClient, args: SearchArgs) {
 const result = await db.rpc('search_orders', args)
 if (!result.error || result.error.code !== 'PGRST202') return result
 const rows: SearchRow[] = []
 for (let offset = 0; ; offset += 1000) {
  let query = db.from('orders').select('*').order('created_at', { ascending: false }).order('id').range(offset, offset + 999)
  if (args.p_from) query = query.gte('created_at', `${args.p_from}T00:00:00+05:00`)
  if (args.p_to) query = query.lt('created_at', new Date(Date.parse(`${args.p_to}T00:00:00+05:00`) + 86400000).toISOString())
  const { data, error } = await query
  if (error) return { data: null, error }
  rows.push(...(data || []))
  if (!data || data.length < 1000) break
 }
 const search = args.p_search.toLowerCase()
 // Order number matches "12" or "#12".
 const number = search.replace(/^#/, '').trim()
 const matches = rows.filter(row => `${row.customer_name || ''} ${row.customer_phone || ''} ${row.order_ref || ''}`.toLowerCase().includes(search) || (/^d+$/.test(number) && String(row.order_no ?? '') === number))
 const cutoff = Date.now() - 86400000
 const urgent = (row: SearchRow) => row.status === 'pending' && Date.parse(row.created_at) < cutoff
 const filtered = matches.filter(row => args.p_status === 'all' || row.status === args.p_status || (args.p_status === 'urgent' && urgent(row)))
 const offset = Math.max(0, args.p_page) * 25
 return { error: null, data: { rows: filtered.slice(offset, offset + 25), total: filtered.length, counts: {
  all: matches.length, pending: matches.filter(row => row.status === 'pending').length,
  urgent: matches.filter(urgent).length, completed: matches.filter(row => row.status === 'completed').length,
 } } }
}
