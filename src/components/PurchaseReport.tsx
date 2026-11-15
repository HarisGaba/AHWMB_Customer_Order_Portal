import { useCallback, useEffect, useRef, useState } from 'react'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import { supabase } from '../lib/supabase'
import { ActivityLog } from './ActivityLog'
type Purchase = { id: string; party: string; area: string; item: string; amount: string; date: string; version?: number }
const blank = (): Purchase => ({ id: crypto.randomUUID(), party: '', area: '', item: '', amount: '', date: new Date().toLocaleDateString('en-CA') })
const valid = (r: Purchase) => typeof r?.party === 'string' && r.party.trim() && /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && String(r.amount ?? '').trim() !== '' && Number.isFinite(Number(r.amount)) && Number(r.amount) >= 0 && Number(r.amount) <= 100000000000
export function PurchaseReport() {
 const [rows, setRows] = useState<Purchase[]>([])
 const [draft, setDraft] = useState<Purchase>(blank)
 const [dirty, setDirty] = useState(false)
 const [busy, setBusy] = useState(false)
 const [message, setMessage] = useState('')
 const [page, setPage] = useState(0)
 const [count, setCount] = useState(0)
 const [search, setSearch] = useState('')
 const querySequence = useRef(0)
 useUnsavedChanges(dirty, 'Discard unsaved purchase changes?')
 const [legacy, setLegacy] = useState<Purchase[]>(() => { try { const v = JSON.parse(localStorage.getItem('ahwmb-purchase-report') || '[]'); return Array.isArray(v) ? v.filter(r => r.party || r.item || r.amount) : [] } catch { return [] } })
 const load = useCallback(async () => {
  if (!supabase) return
  const sequence = ++querySequence.current
  let q = supabase.from('purchases').select('*', { count: 'exact' }).order('date', { ascending: false }).order('id').range(page * 25, page * 25 + 24)
  if (search.trim()) q = q.ilike('party', `%${search.trim().replace(/[%_]/g, '')}%`)
  const { data, error, count } = await q
  if (sequence !== querySequence.current) return
  if (error) { setMessage('Purchases could not load. Your existing local records are preserved.'); return }
  setRows((data || []).map(r => ({ ...r, amount: String(r.amount) }))); setCount(count || 0)
 }, [page, search])
 useEffect(() => { const timer = setTimeout(() => { void load() }, 250); return () => clearTimeout(timer) }, [load])
 useEffect(() => { const focus = () => { void load() }; window.addEventListener('focus', focus); return () => window.removeEventListener('focus', focus) }, [load])
 const save = async () => {
  if (!supabase || busy || !valid(draft)) { setMessage('Enter supplier, date and a nonnegative amount.'); return }
  setBusy(true)
  const { error } = await supabase.rpc('save_purchase', { p_row: draft, p_version: draft.version ?? null })
  setBusy(false)
  if (error) { setMessage(error.message); return }
  setMessage('Purchase saved to database.'); setDirty(false); setDraft(blank()); await load()
 }
 const migrate = async () => {
  if (!supabase || busy) return
  setBusy(true); let imported = 0
  try {
   for (const row of legacy) {
    if (!valid(row)) throw new Error('Some local rows need a supplier, valid date and amount. Download the backup and correct these before importing.')
    const { data: existing, error: readError } = await supabase.from('purchases').select('*').eq('id', row.id).maybeSingle()
    if (readError) throw readError
    if (existing) {
     if (['party','area','item','date'].some(k => String(existing[k]) !== String(row[k as keyof Purchase] || '')) || Number(existing.amount) !== Number(row.amount)) throw new Error('A local purchase differs from its database copy. Neither copy was overwritten; review the backup.')
     continue
    }
    const { error } = await supabase.rpc('save_purchase', { p_row: row, p_version: null }); if (error) throw error
    imported++
   }
   setLegacy([]); setMessage(`${imported} purchases imported. Original browser data kept as backup.`); await load()
  } catch (e) { setMessage(`Import paused after ${imported} rows. ${e instanceof Error ? e.message : String((e as { message?: string }).message || e)} Original data is preserved; retry skips identical rows.`) }
  finally { setBusy(false) }
 }
 const download = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(legacy, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href=url; a.download='purchase-local-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
 return <section className="panel report-panel"><h2 className="admin-heading">Purchase Report</h2><p className="panel-sub">Supplier purchases saved across devices. Edits are protected against concurrent changes.</p>{legacy.length > 0 && <div className="notice-card"><strong>{legacy.length} local purchases found</strong><p>Your original browser records will be kept.</p><button className="btn-secondary" onClick={download}>Download local backup</button><button className="btn-submit" disabled={busy} onClick={() => void migrate()}>Import existing purchases</button></div>}
 <form className="purchase-form" onSubmit={e => { e.preventDefault(); void save() }}>{(['party','area','item','amount','date'] as const).map(k => <label className="field" key={k}><span className="field-label">{{ party:'Supplier', area:'Area', item:'Item', amount:'Amount / deposit', date:'Date' }[k]}</span><input className="field-input" type={k==='date' ? 'date' : k==='amount' ? 'number' : 'text'} min={k==='amount' ? 0 : undefined} step={k==='amount' ? '.01' : undefined} required={['party','amount','date'].includes(k)} value={draft[k]} onChange={e => { setDraft({ ...draft, [k]:e.target.value }); setDirty(true) }} /></label>)}<button className="btn-submit" disabled={busy}>{busy ? 'Saving…' : draft.version ? 'Save changes' : 'Add purchase'}</button><span role="status">{dirty ? 'Unsaved changes' : 'Ready'}</span></form>
 {message && <p role="status" className="form-message">{message}</p>}<label className="field"><span className="field-label">Search supplier</span><input className="field-input" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} /></label><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Supplier</th><th>Area</th><th>Item</th><th>Amount</th><th>Date</th><th>Action</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td>{r.party}</td><td>{r.area}</td><td>{r.item}</td><td>Rs. {Number(r.amount).toLocaleString()}</td><td>{r.date}</td><td><button className="btn-secondary" onClick={() => { if (dirty && !window.confirm('Discard unsaved purchase changes?')) return; setDraft(r); setDirty(false) }}>Edit</button></td></tr>)}</tbody></table>{!rows.length && <p className="empty-state">No purchases found.</p>}</div><div className="pagination"><button className="btn-secondary" disabled={!page} onClick={() => setPage(p=>p-1)}>Previous</button><span>{count} purchases · Page {page+1}</span><button className="btn-secondary" disabled={(page+1)*25>=count} onClick={() => setPage(p=>p+1)}>Next</button></div><ActivityLog entity="purchases" /></section>
}
