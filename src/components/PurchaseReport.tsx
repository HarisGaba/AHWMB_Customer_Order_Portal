import { useCallback, useEffect, useRef, useState } from 'react'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import { ActivityLog } from './ActivityLog'
import { persistPurchase, purchaseSchemaMissing, readLocalPurchases, saveLocalPurchase, validPurchase as valid, type Purchase } from '../lib/purchases'
const blank = (): Purchase => ({ id: crypto.randomUUID(), party: '', area: '', item: '', amount: '', date: new Date().toLocaleDateString('en-CA') })
export function PurchaseReport() {
 const [rows, setRows] = useState<Purchase[]>([])
 const [draft, setDraft] = useState<Purchase>(blank)
 const [dirty, setDirty] = useState(false)
 const [busy, setBusy] = useState(false)
 const [message, setMessage] = useState('')
 const [page, setPage] = useState(0)
 const [count, setCount] = useState(0)
 const [search, setSearch] = useState('')
 const [deviceMode, setDeviceMode] = useState(!supabase)
 const saving = useRef(false)
 const querySequence = useRef(0)
 useUnsavedChanges(dirty, 'Discard unsaved purchase changes?')
 const [legacy, setLegacy] = useState<Purchase[]>([])
 const load = useCallback(async () => {
  const sequence = ++querySequence.current
  try {
   const local = readLocalPurchases(localStorage)
   const remote: Purchase[] = []
   let missing = !supabase
   if (supabase) for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('purchases').select('*').order('date', { ascending: false }).order('id').range(offset, offset + 999)
    if (sequence !== querySequence.current) return
    if (error) { if (purchaseSchemaMissing(error)) { missing = true; break }; throw error }
    remote.push(...(data || []).map(r => ({ ...r, amount: String(r.amount) })))
    if (!data || data.length < 1000) break
   }
   const pending = local.filter(l => !remote.some(r => r.id === l.id && ['party','area','item','date'].every(k => r[k as keyof Purchase] === l[k as keyof Purchase]) && Number(r.amount) === Number(l.amount)))
   setLegacy(pending); setDeviceMode(missing)
   const matches = [...remote, ...pending].filter(r => String(r.party || '').toLowerCase().includes(search.trim().toLowerCase())).sort((a,b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
   setCount(matches.length); setRows(matches.slice(page * 25, page * 25 + 25))
  } catch (e) { setMessage(`Purchases could not load: ${e instanceof Error ? e.message : String((e as { message?: string }).message || e)}. Existing records are preserved.`) }
 }, [page, search])
 useEffect(() => { const timer = setTimeout(() => { void load() }, 250); return () => clearTimeout(timer) }, [load])
 useEffect(() => { const focus = () => { if (!saving.current) void load() }; window.addEventListener('focus', focus); window.addEventListener('storage', focus); return () => { window.removeEventListener('focus', focus); window.removeEventListener('storage', focus); querySequence.current++ } }, [load])
 const save = async () => {
  if (saving.current) return
  if (!valid(draft)) { setMessage('Enter supplier, date and a nonnegative amount.'); return }
  saving.current = true; setBusy(true); setMessage('')
  try {
   const localSave = async (row: Purchase) => {
    const write = () => saveLocalPurchase(localStorage, row)
    if (navigator.locks) return navigator.locks.request('ahwmb-purchases', write)
    if (row.localRevision != null) throw new Error('Please use an updated browser to safely edit this saved purchase. Your form is preserved.')
    return write()
   }
   const result = await persistPurchase(supabase, draft, localSave, deviceMode)
   setRows(current => [result.row, ...current.filter(r => !(r.id === result.row.id && (r.localRevision != null) === (result.row.localRevision != null)))].slice(0, 25))
   setDirty(false); setDraft(blank()); setPage(0); setSearch('')
   setMessage(result.destination === 'device' ? 'Purchase saved on this device. Not synced to other devices; keep a downloaded backup.' : 'Purchase saved to database.')
   void load()
  } catch (e) { setMessage(friendlyError(e, 'Purchase could not save. Your form is preserved; please retry.')) }
  finally { saving.current = false; setBusy(false) }
 }
 const migrate = async () => {
  if (!supabase || saving.current || deviceMode) return
  saving.current = true; setBusy(true); let imported = 0
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
  finally { saving.current = false; setBusy(false) }
 }
 const download = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(legacy, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href=url; a.download='purchase-local-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
 return <section className="panel report-panel"><h2 className="admin-heading">Purchase Report</h2><p className="panel-sub">{deviceMode ? 'Purchases are saved in this browser. Keep a downloaded backup; device records are not synced.' : 'Database purchases and saved device records are shown below.'}</p>{legacy.length > 0 && <div className="notice-card"><strong>{legacy.length} local purchases found</strong><p>Your original browser records will be kept.</p><button className="btn-secondary" onClick={download}>Download local backup</button><button type="button" className="btn-submit" disabled={busy || deviceMode} onClick={() => void migrate()}>Import existing purchases</button></div>}
 <form className="purchase-form" onSubmit={e => { e.preventDefault(); void save() }}>{(['party','area','item','amount','date'] as const).map(k => <label className="field" key={k}><span className="field-label">{{ party:'Supplier', area:'Area', item:'Item', amount:'Amount / deposit', date:'Date' }[k]}</span><input className="field-input" disabled={busy} type={k==='date' ? 'date' : k==='amount' ? 'number' : 'text'} min={k==='amount' ? 0 : undefined} step={k==='amount' ? '.01' : undefined} required={['party','amount','date'].includes(k)} value={draft[k]} onChange={e => { setDraft({ ...draft, [k]:e.target.value }); setDirty(true) }} /></label>)}<button type="submit" className="btn-submit" disabled={busy}>{busy ? 'Saving…' : draft.version != null || draft.localRevision != null ? 'Save changes' : 'Add Purchase'}</button><span role="status">{busy ? 'Saving purchase…' : dirty ? 'Ready to save' : 'Ready'}</span></form>
 {message && <p role="status" className="form-message">{message}</p>}<label className="field"><span className="field-label">Search supplier</span><input className="field-input" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} /></label><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Supplier</th><th>Area</th><th>Item</th><th>Amount</th><th>Date</th><th>Action</th></tr></thead><tbody>{rows.map(r => <tr key={`${r.id}-${r.localRevision != null ? 'device' : 'database'}`}><td>{r.party}{r.localRevision != null && <small> · This device</small>}</td><td>{r.area}</td><td>{r.item}</td><td>Rs. {Number(r.amount).toLocaleString()}</td><td>{r.date}</td><td><button className="btn-secondary" onClick={() => { if (dirty && !window.confirm('Discard unsaved purchase changes?')) return; setDraft(r); setDirty(false) }}>Edit</button></td></tr>)}</tbody></table>{!rows.length && <p className="empty-state">No purchases found.</p>}</div><div className="pagination"><button className="btn-secondary" disabled={!page} onClick={() => setPage(p=>p-1)}>Previous</button><span>{count} purchases · Page {page+1}</span><button className="btn-secondary" disabled={(page+1)*25>=count} onClick={() => setPage(p=>p+1)}>Next</button></div>{!deviceMode && <ActivityLog entity="purchases" />}</section>
}
