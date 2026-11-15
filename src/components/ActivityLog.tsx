import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
type Entry = { id: number; entity: string; action: string; actor_email: string | null; record_id: string; created_at: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null }
export function ActivityLog({ entity, recordId, revision }: { entity?: string; recordId?: string; revision?: number }) {
 const [rows, setRows] = useState<Entry[]>([])
 const [page, setPage] = useState(0)
 const [total, setTotal] = useState(0)
 const [error, setError] = useState('')
 const [loading, setLoading] = useState(true)
 useEffect(() => { setPage(0) }, [entity, recordId])
 useEffect(() => {
  let alive = true; setLoading(true)
  if (!supabase) { setError('Database unavailable'); setLoading(false); return }
  let q = supabase.from('activity_log').select('*', { count: 'exact' }).order('id', { ascending: false }).range(page * 20, page * 20 + 19)
  if (entity) q = q.eq('entity', entity)
  if (recordId) q = q.eq('record_id', recordId)
  void q.then(({ data, error, count }) => { if (!alive) return; setError(error ? 'Activity could not load. Please retry after the database update.' : ''); setRows(data || []); setTotal(count || 0); setLoading(false) })
  return () => { alive = false }
 }, [entity, recordId, page, revision])
 return <section className="panel activity-panel"><h3 className="panel-title">Activity history</h3><p className="panel-sub">Changes recorded since activity tracking was enabled.</p>{error && <p role="alert">{error}</p>}{loading ? <p role="status">Loading activity…</p> : !rows.length ? <p className="empty-state">No recorded changes yet.</p> : <ol className="activity-list">{rows.map(r => <li key={r.id}><strong>{r.entity.replace(/_/g, ' ')} · {r.after_data?.reversed_at ? String(r.after_data.reversal_kind) : r.after_data?.cancelled_at ? 'Reversed' : r.action.toLowerCase()}</strong><span>{r.actor_email || 'System / customer submission'} · {new Date(r.created_at).toLocaleString()}</span><small>Record {r.record_id}</small><details><summary>View changes</summary><pre>{JSON.stringify({ before: r.before_data, after: r.after_data }, null, 2)}</pre></details></li>)}</ol>}<div className="pagination"><button type="button" className="btn-secondary" disabled={loading || page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><span>{total} changes · Page {page + 1}</span><button type="button" className="btn-secondary" disabled={loading || (page + 1) * 20 >= total} onClick={() => setPage(p => p + 1)}>Next</button></div></section>
}
