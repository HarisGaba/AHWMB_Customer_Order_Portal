import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import { ddmmyyyy } from '../lib/dates'
import { ActivityLog } from './ActivityLog'
import { persistPurchase, purchaseSchemaMissing, readLocalPurchases, samePurchase, saveLocalPurchase, syncLocalPurchases, validPurchase as valid, type Purchase } from '../lib/purchases'

type Row = Purchase & { archived_at?: string | null }
type Deposit = { id: string; purchase_id: string; amount: number; date: string; note: string; archived_at?: string | null }
const today = () => new Date().toLocaleDateString('en-CA')
const blank = (): Purchase => ({ id: crypto.randomUUID(), party: '', area: '', item: '', quantity: '', amount: '', date: today() })
const rs = (n: number) => `Rs. ${(Number(n) || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`
const cents = (n: number) => Math.round((Number(n) || 0) * 100)
const PAGE = 25

/**
 * Purchase Report: Add Supplier (new purchase), Edit Supplier (search → Edit loads the form),
 * date-wise deposits per purchase with automatic remaining balance, and Delete once a bill is
 * settled (remaining 0). Delete only hides the bill; it stays in the database.
 * Older purchases kept only in this browser are shown and can still be imported; they are never changed here.
 */
export function PurchaseReport() {
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
 const [modal, setModal] = useState<{ id: string; kind: 'deposit' | 'details' } | null>(null)
 const [dep, setDep] = useState({ amount: '', date: today() })
 const saving = useRef(false)
 const autoSynced = useRef(false) // one automatic sync per page visit
 const querySequence = useRef(0)
 const formRef = useRef<HTMLFormElement>(null)
 useUnsavedChanges(dirty, 'Discard unsaved purchase changes?')
 const [legacy, setLegacy] = useState<Purchase[]>([])
 const [logRevision, setLogRevision] = useState(0) // refreshes Activity history after each change

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
   const pending = local.filter(l => { const r = remote.find(x => x.id === l.id); return !r || (!samePurchase(r, l) && (l.localRevision ?? 0) > (Date.parse(String((r as { updated_at?: string }).updated_at || '')) || 0)) })
   // Browser-only purchases go to the database automatically (identical copies are skipped; nothing is deleted).
   if (supabase && !missing && pending.length && !autoSynced.current) {
    autoSynced.current = true
    const result = await syncLocalPurchases(supabase, pending, remote)
    if (result.imported || result.updated) setMessage(`${result.imported + result.updated} purchase${result.imported + result.updated === 1 ? '' : 's'} from this browser saved to the database. The browser copy is kept as a backup.`)
    if (result.problems.length) setMessage(`Some browser purchases could not be saved to the database: ${result.problems.join('; ')}. They are kept in this browser.`)
    if (sequence === querySequence.current) void load()
    return
   }
   setLegacy(pending); setDeviceMode(missing); setDeposits(deps.filter(d => !d.archived_at)); setDepositsReady(depsOk)
   const term = search.trim().toLowerCase()
   const matches = [...remote.filter(r => !r.archived_at), ...pending]
    .filter(r => `${r.party || ''} ${r.area || ''} ${r.item || ''}`.toLowerCase().includes(term))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
   setCount(matches.length); setRows(matches.slice(page * PAGE, page * PAGE + PAGE)); setLogRevision(v => v + 1)
  } catch (e) { setMessage(`Purchases could not load: ${friendlyError(e)}. Existing records are preserved.`) }
 }, [page, search])
 useEffect(() => { const timer = setTimeout(() => { void load() }, 250); return () => clearTimeout(timer) }, [load])
 useEffect(() => { const focus = () => { if (!saving.current) void load() }; window.addEventListener('focus', focus); window.addEventListener('storage', focus); return () => { window.removeEventListener('focus', focus); window.removeEventListener('storage', focus); querySequence.current++ } }, [load])

 const paidFor = (id: string) => deposits.filter(d => d.purchase_id === id).reduce((s, d) => s + cents(d.amount), 0) / 100
 const remainingFor = (r: Purchase) => Math.max(0, (cents(Number(r.amount)) - cents(paidFor(r.id))) / 100)
 const modalRow = modal ? rows.find(r => r.id === modal.id) ?? null : null
 const isEditing = draft.version != null || draft.localRevision != null

 const startEdit = (r: Purchase) => {
  if (dirty && !window.confirm('Discard unsaved purchase changes?')) return
  setDraft({ quantity: '', ...r }); setDirty(false); setMessage(`Editing ${r.party}. Change the details above and press Save changes.`)
  formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
 }

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
   setDep({ amount: '', date: today() }); setModal(null)
   setMessage(`Deposit of ${rs(amount)} saved for ${r.party}. Remaining: ${rs(Math.max(0, remainingFor(r) - amount))}.`)
   await load()
  } catch (e) { setMessage(friendlyError(e)) }
  finally { saving.current = false; setBusy(false) }
 }
 const removeDeposit = async (d: Deposit) => {
  if (!supabase || saving.current || !window.confirm(`Remove the deposit of ${rs(d.amount)} on ${ddmmyyyy(d.date)}? (It is kept in the database history.)`)) return
  saving.current = true; setBusy(true)
  try { const { error } = await supabase.rpc('remove_purchase_deposit', { p_id: d.id }); if (error) throw error; setMessage('Deposit removed.'); await load() }
  catch (e) { setMessage(friendlyError(e)) }
  finally { saving.current = false; setBusy(false) }
 }
 const deletePurchase = async (r: Purchase) => {
  const remaining = depositsReady ? remainingFor(r) : 0
  const warn = remaining > 0 ? `

Warning: ${rs(remaining)} is still remaining on this bill.` : ''
  if (!supabase || saving.current || !window.confirm(`Delete ${r.party} (${rs(Number(r.amount))}, ${ddmmyyyy(r.date)}) from the list?${warn}

It stays saved in the database and in Activity history.`)) return
  saving.current = true; setBusy(true)
  try {
   let { error } = await supabase.rpc('archive_purchase', { p_id: r.id })
   // Before 20261128_purchase_quantity.sql is run, only settled bills can be deleted.
   if (error?.code === 'PGRST202') ({ error } = await supabase.rpc('archive_settled_purchase', { p_id: r.id }))
   if (error) throw error
   if (draft.id === r.id) { setDraft(blank()); setDirty(false) }
   setModal(null); setMessage(`${r.party} deleted from the list (kept in the database).`); await load()
  }
  catch (e) { setMessage(friendlyError(e)) }
  finally { saving.current = false; setBusy(false) }
 }

 const migrate = async () => {
  if (!supabase || saving.current || deviceMode) return
  saving.current = true; setBusy(true)
  try {
   const { data, error } = await supabase.from('purchases').select('*')
   if (error) throw error
   const result = await syncLocalPurchases(supabase, legacy, data || [])
   setMessage(result.problems.length ? `Saved ${result.imported + result.updated}. Not saved: ${result.problems.join('; ')}. They stay in this browser.` : `${result.imported + result.updated} purchases saved to the database. Browser copy kept as backup.`)
   await load()
  } catch (e) { setMessage(friendlyError(e)) }
  finally { saving.current = false; setBusy(false) }
 }
 const download = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(legacy, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'purchase-local-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }

 const labels = { party: 'Supplier', area: 'Area', item: 'Item', quantity: 'Quantity', amount: 'Amount (bill total)', date: 'Date' } as const

 return <section className="panel report-panel">
  <h2 className="admin-heading">Purchase Report</h2>
  <p className="panel-sub">{deviceMode ? 'Purchases are saved in this browser only until the database update (20261126_purchase_deposits.sql) is run. Keep a downloaded backup.' : 'Add a supplier purchase, record deposits by date, and see the remaining balance.'}</p>
  {legacy.length > 0 && <div className="notice-card"><strong>{legacy.length} purchase{legacy.length === 1 ? '' : 's'} still only in this browser</strong><p>{deviceMode ? 'The database table is not set up yet, so these stay in this browser for now.' : 'These could not be saved to the database automatically (see the message below). They are kept here.'}</p><button className="btn-secondary" onClick={download}>Download local backup</button><button type="button" className="btn-submit" disabled={busy || deviceMode} onClick={() => void migrate()}>Try saving to database again</button></div>}


  <form ref={formRef} className="purchase-form" onSubmit={e => { e.preventDefault(); void save() }}>
   {(['party', 'item', 'quantity', 'amount', 'date'] as const).map(k => <label className="field" key={k}><span className="field-label">{labels[k]}</span><input className="field-input" disabled={busy} placeholder={k === 'quantity' ? 'e.g. 50 bags / 1200 kg' : undefined} type={k === 'date' ? 'date' : k === 'amount' ? 'number' : 'text'} min={k === 'amount' ? 0 : undefined} step={k === 'amount' ? '.01' : undefined} required={['party', 'amount', 'date'].includes(k)} value={draft[k] ?? ''} onChange={e => { setDraft({ ...draft, [k]: e.target.value }); setDirty(true) }} /></label>)}
   <button type="submit" className="btn-submit" disabled={busy}>{busy ? 'Saving…' : isEditing ? 'Save changes' : 'Add Purchase'}</button>
   {isEditing && <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setDraft(blank()); setDirty(false); setMessage('') }}>Cancel</button>}
  </form>
  {isEditing && <p className="form-message">Editing <strong>{draft.party}</strong> — change the details above and press <strong>Save changes</strong>, or <strong>Cancel</strong>.</p>}
  {message && <p role="status" className="form-message">{message}</p>}

  <label className="field"><span className="field-label">Search supplier</span><input className="field-input" value={search} placeholder="Supplier, area or item" onChange={e => { setSearch(e.target.value); setPage(0) }} /></label>
  <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Supplier</th><th>Item</th><th>Quantity</th><th>Amount</th><th>Deposited</th><th>Remaining</th><th>Date</th><th>Action</th></tr></thead><tbody>
   {rows.map(r => {
    const local = r.localRevision != null
    const paid = paidFor(r.id), remaining = remainingFor(r), settled = !local && depositsReady && remaining === 0
    const canDeposit = !local && depositsReady
    return <tr key={`${r.id}-${local ? 'device' : 'database'}`} className={settled ? 'purchase-settled' : undefined}>
     <td>{r.party}{r.area && <small className="purchase-area">{r.area}</small>}{local && <small> · This device</small>}</td><td>{r.item}</td><td>{r.quantity || '—'}</td>
     <td>{rs(Number(r.amount))}</td>
     <td>{canDeposit ? rs(paid) : '—'}</td>
     <td><strong className={remaining > 0 ? 'money-negative' : 'money-positive'}>{!canDeposit ? '—' : settled ? 'Settled' : rs(remaining)}</strong></td>
     <td>{ddmmyyyy(r.date)}</td>
     <td className="purchase-actions">
      <div className="purchase-actions-row">
       <button className="btn-secondary" onClick={() => startEdit(r)}>Edit</button>
       <button className="ledger-delete-btn" disabled={busy || local} title={local ? 'Import this purchase to the database first' : undefined} onClick={() => void deletePurchase(r)}>Delete</button>
      </div>
      {canDeposit && <div className="purchase-actions-row">
       <button className="btn-submit purchase-small-btn" disabled={busy || settled} title={settled ? 'Bill is fully paid' : undefined} onClick={() => { setDep({ amount: '', date: today() }); setModal({ id: r.id, kind: 'deposit' }) }}>Deposit</button>
       <button className="btn-secondary" onClick={() => setModal({ id: r.id, kind: 'details' })}>Details</button>
      </div>}
     </td>
    </tr>
   })}
  </tbody></table>{!rows.length && <p className="empty-state">No purchases found.</p>}</div>
  {modalRow && (() => {
   const r = modalRow, paid = paidFor(r.id), remaining = remainingFor(r)
   const list = deposits.filter(d => d.purchase_id === r.id)
   const close = () => { if (!busy) setModal(null) }
   return <div className="purchase-modal-backdrop" role="presentation" onClick={close}>
    <div className="purchase-modal" role="dialog" aria-modal="true" aria-labelledby="purchase-modal-title" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') close() }}>
     <div className="purchase-modal-head"><h3 id="purchase-modal-title">{modal!.kind === 'deposit' ? 'Add deposit' : 'Deposit details'} — {r.party}</h3><button type="button" className="btn-secondary" onClick={close} aria-label="Close">✕</button></div>
     <div className="purchase-deposit-summary"><span>Bill <strong>{rs(Number(r.amount))}</strong></span><span>Deposited <strong>{rs(paid)}</strong></span><span>Remaining <strong className={remaining > 0 ? 'money-negative' : 'money-positive'}>{rs(remaining)}</strong></span></div>
     {modal!.kind === 'deposit' ? (remaining > 0 ? <form className="purchase-deposit-form" onSubmit={e => { e.preventDefault(); void addDeposit(r) }}>
      <label className="field"><span className="field-label">Deposit amount</span><input className="field-input" autoFocus type="number" min={0} step=".01" max={remaining} value={dep.amount} onChange={e => setDep({ ...dep, amount: e.target.value })} placeholder={`Up to ${remaining.toLocaleString('en-PK')}`} /></label>
      <label className="field"><span className="field-label">Date</span><input className="field-input" type="date" value={dep.date} onChange={e => setDep({ ...dep, date: e.target.value })} /></label>
      <button type="submit" className="btn-submit" disabled={busy}>{busy ? 'Saving…' : 'Save deposit'}</button>
     </form> : <p className="form-message">This bill is fully paid — remaining balance is 0.</p>)
     : list.length ? <table className="report-table"><thead><tr><th>#</th><th>Date</th><th>Deposit</th><th>Remaining after</th><th aria-label="Remove" /></tr></thead><tbody>
      {list.reduce<{ el: ReactNode[]; left: number }>((acc, d, i) => {
       const left = acc.left - cents(d.amount)
       acc.el.push(<tr key={d.id}><td>{i + 1}</td><td>{ddmmyyyy(d.date)}</td><td>{rs(d.amount)}</td><td>{rs(Math.max(0, left) / 100)}</td><td><button className="ledger-delete-btn" disabled={busy} onClick={() => void removeDeposit(d)}>Remove</button></td></tr>)
       return { el: acc.el, left }
      }, { el: [], left: cents(Number(r.amount)) }).el}
     </tbody></table> : <p className="empty-state">No deposits yet.</p>}
    </div>
   </div>
  })()}
  <div className="pagination"><button className="btn-secondary" disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button><span>{count} purchases · Page {page + 1}</span><button className="btn-secondary" disabled={(page + 1) * PAGE >= count} onClick={() => setPage(p => p + 1)}>Next</button></div>
  {!deviceMode && <ActivityLog entity="purchases" revision={logRevision} />}
 </section>
}
