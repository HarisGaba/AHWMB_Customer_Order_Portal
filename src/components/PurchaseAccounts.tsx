import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import { ddmmyyyy } from '../lib/dates'
import { multiplyCurrency } from '../lib/pricing'
import { PurchaseReport } from './PurchaseReport'

type Account = { id: string; name: string; area: string }
type Line = { id: string; account_id: string; date: string; item: string; quantity: number | null; rate: number | null; bags: number | null; amount: number; note: string }
type Deposit = { id: string; account_id: string; date: string; amount: number; method: string }
const METHODS = ['Cash', 'Cheque', 'Online'] as const
const today = () => new Date().toLocaleDateString('en-CA')
const rs = (n: number) => `Rs. ${(Number(n) || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`
const cents = (n: number) => Math.round((Number(n) || 0) * 100)
const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + cents(x.amount), 0) / 100
const missingTable = (e: { code?: string } | null) => !!e && ['PGRST205', '42P01', 'PGRST202'].includes(e.code || '')
const blankLine = () => ({ date: today(), item: '', quantity: '', rate: '', bags: '', amount: '' })

/** Fetch every active row of a table (PostgREST returns at most 1000 per request). */
async function fetchAll<T>(table: string): Promise<{ rows: T[]; error: { code?: string; message?: string } | null }> {
  const rows: T[] = []
  for (let offset = 0; ; offset += 1000) {
    let q = supabase!.from(table).select('*').is('archived_at', null).order('created_at').range(offset, offset + 999)
    if (table !== 'purchase_accounts') q = q.is('cleared_at', null)
    const { data, error } = await q
    if (error) return { rows, error }
    rows.push(...((data || []) as T[]))
    if (!data || data.length < 1000) return { rows, error: null }
  }
}

/**
 * Purchase Report as supplier accounts. Each party has one ledger sheet: bill lines (date, item,
 * quantity, rate, bags, amount) and deposits (date, amount, Cash/Cheque/Online). Remaining =
 * total bill − total deposited. "Clear Bills" starts a fresh cycle for one account (old rows kept).
 */
/** Purchase Report: the normal purchase list, with an "Accounts" button that opens supplier accounts. */
export function PurchaseSection() {
  const [view, setView] = useState<'report' | 'accounts'>('report')
  if (view === 'accounts') return <PurchaseAccounts onBack={() => setView('report')} />
  return <>
    <div className="purchase-top-bar"><button type="button" className="btn-submit purchase-accounts-btn" onClick={() => setView('accounts')}>Accounts →</button></div>
    <PurchaseReport />
  </>
}

export function PurchaseAccounts({ onBack }: { onBack: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [deposits, setDeposits] = useState<Deposit[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [newAcc, setNewAcc] = useState({ name: '', area: '' })
  const [line, setLine] = useState(blankLine)
  const [dep, setDep] = useState<{ date: string; amount: string; method: typeof METHODS[number] }>({ date: today(), amount: '', method: 'Cash' })
  const [confirmClear, setConfirmClear] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) { setState('error'); setMessage('Database unavailable.'); return }
    const [a, l, d] = await Promise.all([fetchAll<Account>('purchase_accounts'), fetchAll<Line>('purchase_lines'), fetchAll<Deposit>('purchase_account_deposits')])
    const err = a.error || l.error || d.error
    if (err) { if (missingTable(err)) setState('missing'); else { setState('error'); setMessage(friendlyError(err)) }; return }
    setAccounts(a.rows.sort((x, y) => x.name.localeCompare(y.name, 'en', { sensitivity: 'base' })))
    setLines(l.rows.map(r => ({ ...r, amount: Number(r.amount), quantity: r.quantity == null ? null : Number(r.quantity), rate: r.rate == null ? null : Number(r.rate), bags: r.bags == null ? null : Number(r.bags) })))
    setDeposits(d.rows.map(r => ({ ...r, amount: Number(r.amount) })))
    setState('ready')
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { const f = () => void load(); window.addEventListener('focus', f); return () => window.removeEventListener('focus', f) }, [load])

  const totals = useMemo(() => {
    const m = new Map<string, { bill: number; paid: number }>()
    for (const a of accounts) m.set(a.id, { bill: sum(lines.filter(x => x.account_id === a.id)), paid: sum(deposits.filter(x => x.account_id === a.id)) })
    return m
  }, [accounts, lines, deposits])
  const open = accounts.find(a => a.id === openId) ?? null

  const run = async (fn: () => PromiseLike<{ error: unknown } | void>, ok: string) => {
    if (busy || !supabase) return false
    setBusy(true); setMessage('')
    try {
      const r = await fn()
      if (r && r.error) throw r.error
      setMessage(ok); await load(); return true
    } catch (e) { setMessage(friendlyError(e)); return false }
    finally { setBusy(false) }
  }

  const addAccount = async () => {
    const name = newAcc.name.trim()
    if (!name) return setMessage('Enter the supplier / party name.')
    if (accounts.some(a => a.name.trim().toLowerCase() === name.toLowerCase())) return setMessage(`${name} already has an account.`)
    if (await run(() => supabase!.from('purchase_accounts').insert({ name, area: newAcc.area.trim() }), `✓ Account ${name} added.`)) setNewAcc({ name: '', area: '' })
  }

  // Amount = quantity × rate when both are filled (still editable).
  const setLineField = (k: keyof ReturnType<typeof blankLine>, v: string) => setLine(cur => {
    const next = { ...cur, [k]: v }
    if ((k === 'quantity' || k === 'rate') && Number(next.quantity) > 0 && Number(next.rate) >= 0 && next.rate.trim() !== '') next.amount = String(multiplyCurrency(Number(next.quantity), Number(next.rate)))
    return next
  })
  const addLine = async () => {
    if (!open) return
    const amount = Number(line.amount)
    if (!line.date || !line.item.trim() || !Number.isFinite(amount) || amount < 0 || line.amount.trim() === '') return setMessage('Enter date, item and amount (or quantity and rate).')
    const num = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v))
    if (await run(() => supabase!.from('purchase_lines').insert({ account_id: open.id, date: line.date, item: line.item.trim(), quantity: num(line.quantity), rate: num(line.rate), bags: num(line.bags), amount }), `✓ ${line.item.trim()} added to ${open.name}.`)) setLine(blankLine())
  }
  const removeLine = (l: Line) => {
    if (!window.confirm(`Remove "${l.item}" (${rs(l.amount)}, ${ddmmyyyy(l.date)}) from this sheet? It stays saved in the database history.`)) return
    void run(() => supabase!.from('purchase_lines').update({ archived_at: new Date().toISOString() }).eq('id', l.id), 'Line removed.')
  }
  const addDeposit = async () => {
    if (!open) return
    const amount = Number(dep.amount)
    if (!dep.date || !Number.isFinite(amount) || amount <= 0) return setMessage('Enter a deposit amount above 0 and its date.')
    if (await run(() => supabase!.from('purchase_account_deposits').insert({ account_id: open.id, date: dep.date, amount, method: dep.method }), `✓ Deposit ${rs(amount)} (${dep.method}) saved for ${open.name}.`)) setDep({ date: today(), amount: '', method: 'Cash' })
  }
  const removeDeposit = (d: Deposit) => {
    if (!window.confirm(`Remove the deposit of ${rs(d.amount)} on ${ddmmyyyy(d.date)}? It stays saved in the database history.`)) return
    void run(() => supabase!.from('purchase_account_deposits').update({ archived_at: new Date().toISOString() }).eq('id', d.id), 'Deposit removed.')
  }
  const printLedger = async (acc: Account, ls: Line[], ds: Deposit[], t: { bill: number; paid: number }) => {
    setBusy(true); setMessage('')
    try {
      const [{ buildLedgerPdf }, { printPdfBlob }] = await Promise.all([import('../lib/ledgerPdf'), import('../lib/print')])
      const blob = await buildLedgerPdf({ account: acc.name, area: acc.area, lines: ls, deposits: ds, totalBill: t.bill, totalDeposited: t.paid })
      await printPdfBlob(blob, `${acc.name.replace(/[^w -]+/g, '').replace(/s+/g, '_')}_Ledger.pdf`)
    } catch (e) { setMessage(`Ledger could not print: ${friendlyError(e)}`) }
    finally { setBusy(false) }
  }
  const clearBills = async () => {
    if (!open) return
    const ok = await run(() => supabase!.rpc('clear_purchase_account', { p_account: open.id }), `✓ ${open.name}: bills cleared — fresh cycle started. Old entries are kept in the database.`)
    if (ok) setConfirmClear(false)
  }

  const backBar = <div className="purchase-top-bar"><button type="button" className="btn-secondary" onClick={onBack}>← Back to Purchase Report</button></div>
  if (state === 'missing') return <>{backBar}<p className="notice-card">Accounts need a database update: run <strong>supabase/migrations/20261201_purchase_accounts.sql</strong> (then <strong>20261202_accounts_start_empty.sql</strong>) in Supabase.</p></>

  // ── One account's ledger sheet ──
  if (open) {
    const t = totals.get(open.id) ?? { bill: 0, paid: 0 }
    const remaining = Math.round((t.bill - t.paid) * 100) / 100
    const myLines = lines.filter(l => l.account_id === open.id).sort((a, b) => a.date.localeCompare(b.date))
    const myDeps = deposits.filter(d => d.account_id === open.id).sort((a, b) => a.date.localeCompare(b.date))
    return <>{backBar}<section className="panel report-panel">
      <div className="report-heading">
        <div><button type="button" className="btn-secondary" onClick={() => { setOpenId(null); setMessage('') }}>← All accounts</button><h2 className="admin-heading" style={{ marginTop: 10 }}>{open.name}</h2>{open.area && <p className="panel-sub">{open.area}</p>}</div>
        <div className="acct-summary"><span>Total Bill <strong>{rs(t.bill)}</strong></span><span>Deposited <strong>{rs(t.paid)}</strong></span><span>Remaining <strong className={remaining > 0 ? 'money-negative' : 'money-positive'}>{rs(remaining)}</strong></span></div>
      </div>
      {message && <p className="form-message" role="status">{message}</p>}

      <h3 className="panel-title">Bill lines</h3>
      <form className="acct-line-form" onSubmit={e => { e.preventDefault(); void addLine() }}>
        <label className="field"><span className="field-label">Date</span><input className="field-input" type="date" value={line.date} onChange={e => setLineField('date', e.target.value)} /></label>
        <label className="field acct-item"><span className="field-label">Item name</span><input className="field-input" value={line.item} onChange={e => setLineField('item', e.target.value)} placeholder="e.g. Chana Dal" /></label>
        <label className="field"><span className="field-label">Quantity (kg)</span><input className="field-input" type="number" min={0} step="any" value={line.quantity} onChange={e => setLineField('quantity', e.target.value)} /></label>
        <label className="field"><span className="field-label">Rate</span><input className="field-input" type="number" min={0} step="any" value={line.rate} onChange={e => setLineField('rate', e.target.value)} /></label>
        <label className="field"><span className="field-label">Bags</span><input className="field-input" type="number" min={0} step="any" value={line.bags} onChange={e => setLineField('bags', e.target.value)} /></label>
        <label className="field"><span className="field-label">Amount</span><input className="field-input" type="number" min={0} step="any" value={line.amount} onChange={e => setLineField('amount', e.target.value)} /></label>
        <button type="submit" className="btn-submit" disabled={busy}>{busy ? 'Saving…' : 'Add line'}</button>
      </form>
      <div className="report-table-wrap"><table className="report-table"><thead><tr><th>#</th><th>Date</th><th>Item Name</th><th>Quantity</th><th>Rate</th><th>Bags</th><th>Amount</th><th aria-label="Remove" /></tr></thead><tbody>
        {myLines.map((l, i) => <tr key={l.id}><td>{i + 1}</td><td>{ddmmyyyy(l.date)}</td><td>{l.item}{l.note && <small className="purchase-area">{l.note}</small>}</td><td>{l.quantity ?? '—'}</td><td>{l.rate == null ? '—' : rs(l.rate)}</td><td>{l.bags ?? '—'}</td><td><strong>{rs(l.amount)}</strong></td><td><button type="button" className="ledger-delete-btn" disabled={busy} onClick={() => removeLine(l)}>Remove</button></td></tr>)}
      </tbody><tfoot><tr><td colSpan={6}><strong>Total Amount</strong></td><td colSpan={2}><strong>{rs(t.bill)}</strong></td></tr></tfoot></table>{!myLines.length && <p className="empty-state">No bill lines in this cycle yet.</p>}</div>

      <h3 className="panel-title" style={{ marginTop: 20 }}>Deposits</h3>
      <form className="acct-line-form" onSubmit={e => { e.preventDefault(); void addDeposit() }}>
        <label className="field"><span className="field-label">Date</span><input className="field-input" type="date" value={dep.date} onChange={e => setDep({ ...dep, date: e.target.value })} /></label>
        <label className="field"><span className="field-label">Amount</span><input className="field-input" type="number" min={0} step="any" value={dep.amount} onChange={e => setDep({ ...dep, amount: e.target.value })} placeholder={remaining > 0 ? `Remaining ${remaining.toLocaleString('en-PK')}` : ''} /></label>
        <div className="field"><span className="field-label">Payment method</span><div className="deposit-methods" role="radiogroup" aria-label="Payment method">{METHODS.map(m => <button key={m} type="button" role="radio" aria-checked={dep.method === m} className={`deposit-method${dep.method === m ? ' is-active' : ''}`} onClick={() => setDep({ ...dep, method: m })}>{m}</button>)}</div></div>
        <button type="submit" className="btn-submit" disabled={busy}>{busy ? 'Saving…' : 'Add deposit'}</button>
      </form>
      <div className="report-table-wrap"><table className="report-table"><thead><tr><th>#</th><th>Date</th><th>Amount</th><th>Method</th><th aria-label="Remove" /></tr></thead><tbody>
        {myDeps.map((d, i) => <tr key={d.id}><td>{i + 1}</td><td>{ddmmyyyy(d.date)}</td><td>{rs(d.amount)}</td><td>{d.method}</td><td><button type="button" className="ledger-delete-btn" disabled={busy} onClick={() => removeDeposit(d)}>Remove</button></td></tr>)}
      </tbody><tfoot><tr><td colSpan={2}><strong>Total Deposited</strong></td><td colSpan={3}><strong>{rs(t.paid)}</strong></td></tr></tfoot></table>{!myDeps.length && <p className="empty-state">No deposits in this cycle yet.</p>}</div>

      <div className="acct-totals"><span>Total Amount <strong>{rs(t.bill)}</strong></span><span>Total Deposited <strong>{rs(t.paid)}</strong></span><span>Remaining Balance <strong className={remaining > 0 ? 'money-negative' : 'money-positive'}>{rs(remaining)}</strong></span>
        <button type="button" className="btn-secondary acct-print" disabled={busy} onClick={() => void printLedger(open, myLines, myDeps, t)}>🖨 Print Ledger</button>
        <button type="button" className="ledger-delete-btn" disabled={busy || (!myLines.length && !myDeps.length)} onClick={() => setConfirmClear(true)}>Clear Bills (fresh cycle)</button></div>

      {confirmClear && createPortal(<div className="portal-embed purchase-portal"><div className="purchase-modal-backdrop" role="presentation" onClick={() => { if (!busy) setConfirmClear(false) }}>
        <div className="purchase-modal" role="alertdialog" aria-modal="true" aria-labelledby="clear-title" onClick={e => e.stopPropagation()}>
          <div className="purchase-modal-head"><h3 id="clear-title">Clear {open.name}'s bills?</h3></div>
          <p>All {myLines.length} bill line(s) and {myDeps.length} deposit(s) of this cycle will be cleared from the sheet, so a fresh cycle starts at Rs. 0. They stay saved in the database history. Other accounts are not affected.</p>
          {remaining !== 0 && <p className="money-negative"><strong>Warning: remaining balance is {rs(remaining)} — it is not settled yet.</strong></p>}
          <div className="product-actions"><button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirmClear(false)}>Cancel</button><button type="button" className="ledger-delete-btn" disabled={busy} onClick={() => void clearBills()}>{busy ? 'Clearing…' : 'Yes, clear bills'}</button></div>
        </div>
      </div></div>, document.body)}
    </section></>
  }

  // ── Accounts list ──
  const shown = accounts.filter(a => `${a.name} ${a.area}`.toLowerCase().includes(search.trim().toLowerCase()))
  return <>{backBar}<section className="panel report-panel">
    <div className="report-heading"><div><p className="admin-eyebrow">AHWMB</p><h2 className="admin-heading">Accounts</h2><p className="panel-sub">Supplier / party accounts — add an account, then open it to add bill lines and deposits.</p></div></div>
    <form className="acct-add" onSubmit={e => { e.preventDefault(); void addAccount() }}>
      <input className="field-input" value={newAcc.name} onChange={e => setNewAcc({ ...newAcc, name: e.target.value })} placeholder="New account: supplier / party name" />
      <input className="field-input" value={newAcc.area} onChange={e => setNewAcc({ ...newAcc, area: e.target.value })} placeholder="Area (optional)" />
      <button type="submit" className="btn-submit" disabled={busy}>+ Add Account</button>
    </form>
    {message && <p className="form-message" role="status">{message}</p>}
    <input className="report-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search accounts…" />
    {state === 'loading' && <p className="empty-state">Loading accounts…</p>}
    {state === 'error' && <p className="form-message" role="alert">{message}</p>}
    <div className="acct-grid">
      {shown.map(a => {
        const t = totals.get(a.id) ?? { bill: 0, paid: 0 }
        const remaining = Math.round((t.bill - t.paid) * 100) / 100
        return <button type="button" key={a.id} className="acct-card" onClick={() => { setOpenId(a.id); setMessage(''); setLine(blankLine()) }}>
          <strong className="acct-name">{a.name}</strong>{a.area && <small>{a.area}</small>}
          <span className="acct-row"><span>Total Bill</span><b>{rs(t.bill)}</b></span>
          <span className="acct-row"><span>Remaining</span><b className={remaining > 0 ? 'money-negative' : 'money-positive'}>{rs(remaining)}</b></span>
        </button>
      })}
    </div>
    {state === 'ready' && !shown.length && <p className="empty-state">{accounts.length ? 'No account matches.' : 'No accounts yet — add your first account above.'}</p>}
  </section></>
}
