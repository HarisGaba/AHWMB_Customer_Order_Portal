import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ddmmyyyy, ddmmyyyyTime } from '../lib/dates'

type Data = Record<string, unknown> | null
type Entry = { id: number; entity: string; action: string; actor_email: string | null; record_id: string; created_at: string; before_data: Data; after_data: Data }

// Related records shown together (a purchase page also shows its deposits).
const GROUPS: Record<string, string[]> = { purchases: ['purchases', 'purchase_deposits'], stock_transfers: ['stock_transfers', 'stock_items'] }
const rs = (v: unknown) => `Rs. ${(Number(v) || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`
const s = (v: unknown) => String(v ?? '').trim()

/** One plain-language line per change, e.g. "Deposit added — Rs. 50,000 on 2026-11-21". */
function describe(e: Entry): { title: string; detail: string } {
  const a = e.after_data, b = e.before_data, d = a || b || {}
  const verb = e.action === 'INSERT' ? 'added' : e.action === 'DELETE' ? 'deleted' : 'edited'
  if (e.entity === 'purchases') {
    if (a?.archived_at && !b?.archived_at) return { title: 'Settled bill deleted', detail: `${s(d.party)} · ${rs(d.amount)}` }
    const changes = e.action === 'UPDATE' && a && b ? (['party', 'area', 'item', 'amount', 'date'] as const).filter(k => s(a[k]) !== s(b[k])).map(k => `${k === 'party' ? 'supplier' : k}: ${k === 'amount' ? `${rs(b[k])} → ${rs(a[k])}` : `${s(b[k]) || '—'} → ${s(a[k]) || '—'}`}`) : []
    return { title: `Purchase ${verb}`, detail: changes.length ? `${s(d.party)} · ${changes.join(', ')}` : `${s(d.party)} · ${s(d.item)} · ${rs(d.amount)} · ${ddmmyyyy(s(d.date))}` }
  }
  if (e.entity === 'purchase_deposits') {
    if (a?.archived_at && !b?.archived_at) return { title: 'Deposit removed', detail: `${rs(d.amount)} on ${ddmmyyyy(s(d.date))}` }
    return { title: `Deposit ${verb}`, detail: `${rs(d.amount)} on ${ddmmyyyy(s(d.date))}` }
  }
  if (e.entity === 'stock_transfers') return { title: a?.cancelled_at && !b?.cancelled_at ? 'Transfer reversed' : `Transfer ${verb}`, detail: `${s(d.from_location)} → ${s(d.to_location)} · ${(Number(d.total_quantity) || 0).toLocaleString()} kg` }
  if (e.entity === 'stock_items') return { title: `Stock item ${verb}`, detail: `${s(d.item)} · ${s(d.location)} · ${(Number(d.quantity) || 0).toLocaleString()} kg` }
  if (e.entity === 'orders') return { title: `Order ${verb}`, detail: `${d.order_no ? `#${d.order_no} · ` : ''}${s(d.customer_name)}` }
  if (e.entity === 'sales') return { title: a?.reversed_at && !b?.reversed_at ? `Sale ${s(a.reversal_kind) || 'reversed'}` : `Sale ${verb}`, detail: `${s(d.customer_name) || `Customer ${s(d.customer_no)}`} · ${rs(d.total)} · ${s(d.payment)}` }
  if (e.entity === 'customer_ledger') return { title: `Ledger entry ${verb}`, detail: `${s(d.customer_name)} · ${rs(d.amount)} · ${s(d.type)}` }
  return { title: `${e.entity.replace(/_/g, ' ')} ${verb}`, detail: '' }
}

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
    if (entity) q = q.in('entity', GROUPS[entity] ?? [entity])
    if (recordId) q = q.eq('record_id', recordId)
    void q.then(({ data, error, count }) => {
      if (!alive) return
      setError(error ? 'Activity history is not switched on yet. Run supabase/migrations/20261127_activity_log.sql in Supabase.' : '')
      setRows(data || []); setTotal(count || 0); setLoading(false)
    })
    return () => { alive = false }
  }, [entity, recordId, page, revision])

  return <section className="panel activity-panel">
    <h3 className="panel-title">Activity history</h3>
    <p className="panel-sub">Every add, edit and delete — who did it and when. Recorded from the day activity tracking was switched on.</p>
    {error && <p role="alert">{error}</p>}
    {loading ? <p role="status">Loading activity…</p> : !rows.length ? (!error && <p className="empty-state">No changes recorded yet. New changes will appear here.</p>) : <ol className="activity-list">{rows.map(r => {
      const { title, detail } = describe(r)
      return <li key={r.id}>
        <strong>{title}</strong>
        {detail && <span>{detail}</span>}
        <small>{r.actor_email || 'System / customer submission'} · {ddmmyyyyTime(r.created_at)}</small>
        <details><summary>View full details</summary><pre>{JSON.stringify({ before: r.before_data, after: r.after_data }, null, 2)}</pre></details>
      </li>
    })}</ol>}
    <div className="pagination"><button type="button" className="btn-secondary" disabled={loading || page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><span>{total} changes · Page {page + 1}</span><button type="button" className="btn-secondary" disabled={loading || (page + 1) * 20 >= total} onClick={() => setPage(p => p + 1)}>Next</button></div>
  </section>
}
