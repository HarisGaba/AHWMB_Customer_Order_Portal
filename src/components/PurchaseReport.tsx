import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import { ActivityLog } from './ActivityLog'
import { persistPurchase, purchaseSchemaMissing, readLocalPurchases, saveLocalPurchase, validPurchase as valid, type Purchase } from '../lib/purchases'

type Row = Purchase & { archived_at?: string | null }
type Deposit = { id: string; purchase_id: string; amount: number; date: string; note: string; archived_at?: string | null }
const today = () => new Date().toLocaleDateString('en-CA')
const blank = (): Purchase => ({ id: crypto.randomUUID(), party: '', area: '', item: '', amount: '', date: today() })
const rs = (n: number) => `Rs. ${(Number(n) || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`
const cents = (n: number) => Math.round((Number(n) || 0) * 100)
const PAGE = 25
// The database trims the supplier name, so compare it trimmed ("leela foods " = "leela foods").
const sameField = (k: string, a: unknown, b: unknown) => k === 'party' ? String(a ?? '').trim() === String(b ?? '').trim() : String(a ?? '') === String(b ?? '')

/**
 * Purchase Report: Add Supplier (new purchase), Edit Supplier (search → Edit loads the form),
 * date-wise deposits per purchase with automatic remaining balance, and Delete once a bill is
 * settled (remaining 0). Delete only hides the bill; it stays in the database.
 * Older purchases kept only in this browser are shown and can still be imported; they are never changed here.
 */
export function PurchaseReport() {
 const [mode, setMode] = useState<'add' | 'edit'>('add')
 const [rows, setRows] = useState<Row[]>([])
 const [deposits, setDeposits] = useState<Deposit[]>([])
 const [depositsReady, setDepositsReady] = useState(false)
 const [draft, setDraft] = useState<Purchase>(blank)
 const [dirty, setDirty] = useState(false)
 const [busy, setBusy] = useState(false)
 const [message, setMessage] = useState('')
 const [page, setPage] = useState(0)
 const [count, setCount] = useState(0)
 const [search, setSearch] = useState('')
 const [deviceMode, setDeviceMode] = useState(!supabase)
 const [open, setOpen] = useState<string | null>(null)
 const [dep, setDep] = useState({ amount: '', date: today() })
 const saving = useRef(false)
 const querySequence = useRef(0)
 const formRef = useRef<HTMLFormElement>(null)
 useUnsavedChanges(dirty, 'Discard unsaved purchase changes?')
 const [legacy, setLegacy] = useState<Purchase[]>([])

 const load = useCallback(async () => {
  const sequence = ++querySequence.current
  try {
   const local = readLocalPurchases(localStorage)
   const remote: Row[] = []
   let missing = !supabase
   if (supabase) for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('purchases').select('*').order('date', { ascending: false }).order('id').range(offset, offset + 999)
    if (sequence !== querySequence.current) return
    if (error) { if (purchaseSchemaMissing(error)) { missing = true; break }; throw error }
    remote.push(...(data || []).map(r => ({ ...r, amount: String(r.amount) })))
    if (!data || data.length < 1000) break
   }
   // Deposits (needs 20261126_purchase_deposits.sql). Without it the page still works, without deposits.
   const deps: Deposit[] = []
   let depsOk = false
   if (supabase && !missing) {
    for (let offset = 0; ; offset += 1000) {
     const { data, error } = await supabase.from('purchase_deposits').select('*').order('date').order('created_at').range(offset, offset + 999)
     if (error) break
     deps.push(...(data || []).map(d => ({ ...d, amount: Number(d.amount) })))
     if (!data || data.length < 1000) { depsOk = true; break }
    }
   }
   if (sequence !== querySequence.current) return
   const pending = local.filter(l => !remote.some(r => r.id === l.id && ['party','area','item','date'].every(k => sameField(k, r[k as keyof Purchase], l[k as keyof Purchase])) && Number(r.amount) === Number(l.amount)))
   setLegacy(pending); setDeviceMode(missing); setDeposits(deps.filter(d => !d.archived_at)); setDepositsReady(depsOk)
   const term = search.trim().toLowerCase()
   const matches = [...remote.filter(r => !r.archived_at), ...pending]
    .filter(r => `${r.party || ''} ${r.area || ''} ${r.item || ''}`.toLowerCase().includes(term))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
   setCount(matches.length); setRows(matches.slice(page * PAGE, page * PAGE + PAGE))
  } catch (e) { setMessage(`Purchases could not load: ${friendlyError(e)}. Existing records are preserved.`) }
 }, [page, search])
 useEffect(() => { const timer = setTimeout(() => { void load() }, 250); return () => clearTimeout(timer) }, [load])
 useEffect(() => { const focus = () => { if (!saving.current) void load() }; window.addEventListener('focus', focus); window.addEventListener('storage', focus); return () => { window.removeEventListener('focus', focus); window.removeEventListener('storage', focus); querySequence.current++ } }, [load])

 const paidFor = (id: string) => deposits.filter(d => d.purchase_id === id).reduce((s, d) => s + cents(d.amount), 0) / 100
 const remainingFor = (r: Purchase) => Math.max(0, (cents(Number(r.amount)) - cents(paidFor(r.id))) / 100)
 const isEditing = draft.version != null || draft.localRevision != null

 const switchMode = (next: 'add' | 'edit') => {
  if (dirty && !window.confirm('Discard unsaved purchase changes?')) return
  setMode(next); setDraft(blank()); setDirty(false); setMessage('')
 }
 const startEdit = (r: Purchase) => {
  if (dirty && !window.confirm('Discard unsaved purchase changes?')) return
  setMode('edit'); setDraft(r); setDirty(false); setMessage(`Editing ${r.party}. Change the details above and press Save changes.`)
  formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
 }

 const save = async () => {
  if (saving.current) return
  if (mode === 'edit' && !isEditing) { setMessage('Search for the supplier below and press Edit on the purchase you want to change.'); return }
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
   setDirty(false); setDraft(blank())
   setMessage(result.destination === 'device' ? 'Purchase saved on this device. Not synced to other devices; keep a downloaded backup.' : isEditing ? 'Changes saved to database.' : 'Purchase saved to database.')
   void load()
  } catch (e) { setMessage(friendlyError(e, 'Purchase could not save. Your form is preserved; please retry.')) }
  finally { saving.current = false; setBusy(false) }
 }

 const addDeposit = async (r: Purchase) => {
  if (!supabase || saving.current) return
  const amount = Number(dep.amount)
  if (!Number.isFinite(amount) || amount <= 0 || !dep.date) { setMessage('Enter a deposit amount above 0 and its date.'); return }
  if (cents(amount) > cents(remainingFor(r))) { setMessage(`This deposit is more than the remaining balance (${rs(remainingFor(r))}).`); return }
  saving.current = true; setBusy(true); setMessage('')
  try {
   const { error } = await supabase.rpc('add_purchase_deposit', { p_purchase: r.id, p_amount: amount, p_date: dep.date, p_note: '' })
   if (error) throw error
   setDep({ amount: '', date: today() })
   setMessage(`Deposit of ${rs(amount)} saved for ${r.party}. Remaining: ${rs(Math.max(0, remainingFor(r) - amount))}.`)
   await load()
  } catch (e) { setMessage(friendlyError(e)) }
  finally { saving.current = false; setBusy(false) }
 }
 const removeDeposit = async (d: Deposit) => {
  if (!supabase || saving.current || !window.confirm(`Remove the deposit of ${rs(d.amount)} on ${d.date}? (It is kept in the database history.)`)) return
  saving.current = true; setBusy(true)
  try { const { error } = await supabase.rpc('remove_purchase_deposit', { p_id: d.id }); if (error) throw error; setMessage('Deposit removed.'); await load() }
  catch (e) { setMessage(friendlyError(e)) }
  finally { saving.current = false; setBusy(false) }
 }
 const deleteSettled = async (r: Purchase) => {
  if (!supabase || saving.current || !window.confirm(`${r.party}: this bill is fully paid. Delete it from the list? (It stays saved in the database.)`)) return
  saving.current = true; setBusy(true)
  try { const { error } = await supabase.rpc('archive_settled_purchase', { p_id: r.id }); if (error) throw error; setOpen(null); setMessage(`${r.party} — settled bill deleted from the list.`); await load() }
  catch (e) { setMessage(friendlyError(e)) }
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
     if (['party','area','item','date'].some(k => !sameField(k, existing[k], row[k as keyof Purchase])) || Number(existing.amount) !== Number(row.amount)) throw new Error('A local purchase differs from its database copy. Neither copy was overwritten; review the backup.')
     continue
    }
    const { error } = await supabase.rpc('save_purchase', { p_row: row, p_version: null }); if (error) throw error
    imported++
   }
   setLegacy([]); setMessage(`${imported} purchases imported. Original browser data kept as backup.`); await load()
  } catch (e) { setMessage(`Import paused after ${imported} rows. ${friendlyError(e)} Original data is preserved; retry skips identical rows.`) }
  finally { saving.current = false; setBusy(false) }
 }
 const download = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(legacy, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'purchase-local-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }

 const labels = { party: 'Supplier', area: 'Area', item: 'Item', amount: 'Amount (bill total)', date: 'Date' } as const

 return <section className="panel report-panel">
  <h2 className="admin-heading">Purchase Report</h2>
  <p className="panel-sub">{deviceMode ? 'Purchases are saved in this browser only until the database update (20261126_purchase_deposits.sql) is run. Keep a downloaded backup.' : 'Add a supplier purchase, record deposits by date, and see the remaining balance.'}</p>
  {legacy.length > 0 && <div className="notice-card"><strong>{legacy.length} purchases saved only in this browser</strong><p>They are kept as they are. Import them to the database to add deposits and see them on every device.</p><button className="btn-secondary" onClick={download}>Download local backup</button><button type="button" className="btn-submit" disabled={busy || deviceMode} onClick={() => void migrate()}>Import existing purchases</button></div>}

  <div className="purchase-mode" role="tablist" aria-label="Purchase mode">
   <button type="button" role="tab" aria-selected={mode === 'add'} className={`purchase-mode-tab${mode === 'add' ? ' is-active' : ''}`} onClick={() => switchMode('add')}><strong>Add Supplier</strong><small>New purchase entry</small></button>
   <button type="button" role="tab" aria-selected={mode === 'edit'} className={`purchase-mode-tab${mode === 'edit' ? ' is-active' : ''}`} onClick={() => switchMode('edit')}><strong>Edit Supplier</strong><small>Search below, then press Edit</small></button>
  </div>

  <form ref={formRef} className="purchase-form" onSubmit={e => { e.preventDefault(); void save() }}>
   {(['party', 'area', 'item', 'amount', 'date'] as const).map(k => <label className="field" key={k}><span className="field-label">{labels[k]}</span><input className="field-input" disabled={busy || (mode === 'edit' && !isEditing)} type={k === 'date' ? 'date' : k === 'amount' ? 'number' : 'text'} min={k === 'amount' ? 0 : undefined} step={k === 'amount' ? '.01' : undefined} required={['party', 'amount', 'date'].includes(k)} value={draft[k]} onChange={e => { setDraft({ ...draft, [k]: e.target.value }); setDirty(true) }} /></label>)}
   <button type="submit" className="btn-submit" disabled={busy || (mode === 'edit' && !isEditing)}>{busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add Purchase'}</button>
   {mode === 'edit' && isEditing && <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setDraft(blank()); setDirty(false); setMessage('') }}>Cancel</button>}
  </form>
  {mode === 'edit' && !isEditing && <p className="form-message">Search the supplier below and press <strong>Edit</strong> — the purchase opens in the form above.</p>}
  {message && <p role="status" className="form-message">{message}</p>}

  <label className="field"><span className="field-label">Search supplier</span><input className="field-input" value={search} placeholder="Supplier, area or item" onChange={e => { setSearch(e.target.value); setPage(0) }} /></label>
  <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Supplier</th><th>Area</th><th>Item</th><th>Amount</th><th>Deposited</th><th>Remaining</th><th>Date</th><th>Action</th></tr></thead><tbody>
   {rows.map(r => {
    const local = r.localRevision != null
    const paid = paidFor(r.id), remaining = remainingFor(r), settled = !local && depositsReady && remaining === 0
    const list = deposits.filter(d => d.purchase_id === r.id)
    const expanded = open === r.id
    return <Fragment key={`${r.id}-${local ? 'device' : 'database'}`}>
     <tr className={settled ? 'purchase-settled' : undefined}>
      <td>{r.party}{local && <small> · This device</small>}</td><td>{r.area}</td><td>{r.item}</td>
      <td>{rs(Number(r.amount))}</td>
      <td>{local || !depositsReady ? '—' : rs(paid)}</td>
      <td><strong className={remaining > 0 ? 'money-negative' : 'money-positive'}>{local || !depositsReady ? '—' : settled ? 'Settled' : rs(remaining)}</strong></td>
      <td>{r.date}</td>
      <td className="purchase-actions">
       <button className="btn-secondary" onClick={() => startEdit(r)}>Edit</button>
       {!local && depositsReady && <button className="btn-secondary" onClick={() => { setOpen(expanded ? null : r.id); setDep({ amount: '', date: today() }) }}>{expanded ? 'Close' : `Deposits (${list.length})`}</button>}
       {settled && <button className="ledger-delete-btn" disabled={busy} onClick={() => void deleteSettled(r)}>Delete</button>}
      </td>
     </tr>
     {expanded && <tr className="purchase-deposits-row"><td colSpan={8}>
      <div className="purchase-deposits">
       <div className="purchase-deposit-summary"><span>Bill <strong>{rs(Number(r.amount))}</strong></span><span>Deposited <strong>{rs(paid)}</strong></span><span>Remaining <strong className={remaining > 0 ? 'money-negative' : 'money-positive'}>{rs(remaining)}</strong></span></div>
       {list.length ? <table className="report-table"><thead><tr><th>Date</th><th>Deposit</th><th>Remaining after</th><th aria-label="Remove" /></tr></thead><tbody>
        {list.reduce<{ el: ReactNode[]; left: number }>((acc, d) => {
         const left = acc.left - cents(d.amount)
         acc.el.push(<tr key={d.id}><td>{d.date}</td><td>{rs(d.amount)}</td><td>{rs(Math.max(0, left) / 100)}</td><td><button className="ledger-delete-btn" disabled={busy} onClick={() => void removeDeposit(d)}>Remove</button></td></tr>)
         return { el: acc.el, left }
        }, { el: [], left: cents(Number(r.amount)) }).el}
       </tbody></table> : <p className="empty-state">No deposits yet.</p>}
       {remaining > 0 ? <form className="purchase-deposit-form" onSubmit={e => { e.preventDefault(); void addDeposit(r) }}>
        <label className="field"><span className="field-label">Deposit amount</span><input className="field-input" type="number" min={0} step=".01" max={remaining} value={dep.amount} onChange={e => setDep({ ...dep, amount: e.target.value })} placeholder={`Up to ${remaining.toLocaleString('en-PK')}`} /></label>
        <label className="field"><span className="field-label">Date</span><input className="field-input" type="date" value={dep.date} onChange={e => setDep({ ...dep, date: e.target.value })} /></label>
        <button type="submit" className="btn-submit" disabled={busy}>Add deposit</button>
       </form> : <p className="form-message">Bill settled — remaining balance is 0. You can delete it from the list.</p>}
      </div>
     </td></tr>}
    </Fragment>
   })}
  </tbody></table>{!rows.length && <p className="empty-state">No purchases found.</p>}</div>
  <div className="pagination"><button className="btn-secondary" disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button><span>{count} purchases · Page {page + 1}</span><button className="btn-secondary" disabled={(page + 1) * PAGE >= count} onClick={() => setPage(p => p + 1)}>Next</button></div>
  {!deviceMode && <ActivityLog entity="purchases" />}
 </section>
}
