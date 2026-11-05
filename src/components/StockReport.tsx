import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, History, Plus, Trash2, Truck, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

// Stock moves one way only: Site Area Godown (bulk) -> Jodia Bazaar Godown -> Shop (final sale point).
const LOCATIONS = ['Site Area Godown', 'Jodia Bazaar Godown', 'Shop'] as const
type Location = (typeof LOCATIONS)[number]
// Each destination has exactly one source.
const SOURCE_FOR: Partial<Record<Location, Location>> = { 'Jodia Bazaar Godown': 'Site Area Godown', Shop: 'Jodia Bazaar Godown' }
const LOCATION_LABEL: Record<Location, string> = { 'Site Area Godown': 'Site Area Godown', 'Jodia Bazaar Godown': 'Jodia Bazaar Godown', Shop: 'Shop' }
// Older browser-only data used these names.
const LEGACY_LOCATION: Record<string, Location> = { 'Jodia Bazaar': 'Jodia Bazaar Godown', 'Godam Site': 'Site Area Godown' }

type StockRow = { id: string; location: Location; item: string; weight: string; quantity: string; saved: boolean }
type TransferLine = { item: string; weight: number | null; quantity: number; bags: number | null }
type Transfer = { id: string; from_location: Location; to_location: Location; lines: TransferLine[]; total_quantity: number; created_at: string }
type DraftLine = { key: string; item: string; quantity: string; bags: string }

const num = (v: string) => Number(v || 0)
const kg = (n: number) => `${n.toLocaleString('en-PK', { maximumFractionDigits: 2 })} kg`
const bagsFor = (quantity: number, weight: number | null) => (weight && weight > 0 ? Math.ceil(quantity / weight) : null)
const monthKey = (iso: string) => iso.slice(0, 7)
const monthLabel = (key: string) => new Date(`${key}-01T00:00:00`).toLocaleDateString('en-PK', { month: 'long', year: 'numeric' })
const newDraftLine = (): DraftLine => ({ key: crypto.randomUUID(), item: '', quantity: '', bags: '' })
const errorText = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e))

/**
 * Calls onChange when any of the tables change (Supabase Realtime), and again when the tab
 * becomes visible or the device comes back online, in case live events were missed.
 * Bursts (a transfer touches several rows) are collapsed into one refresh.
 */
function useLiveTable(tables: string[], onChange: () => void) {
  const key = tables.join(',')
  const callback = useRef(onChange)
  callback.current = onChange
  useEffect(() => {
    if (!supabase) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => callback.current(), 250) }
    let channel = supabase.channel(`live-${key}-${crypto.randomUUID()}`)
    for (const table of key.split(',')) channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh)
    channel.subscribe()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', refresh)
      void supabase?.removeChannel(channel)
    }
  }, [key])
}

export function StockReport() {
  const [location, setLocation] = useState<Location>('Site Area Godown')
  const [rows, setRows] = useState<StockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ text: string; type: 'ok' | 'error' } | null>(null)
  const [view, setView] = useState<'stock' | 'transfer' | 'history'>('stock')
  const [target, setTarget] = useState<Location>('Jodia Bazaar Godown')
  const [legacyCount, setLegacyCount] = useState(0)

  const notify = (text: string, type: 'ok' | 'error' = 'ok') => setMessage({ text, type })

  // Rows come back in the order they were entered / transferred (sort_order), never re-sorted A-Z.
  // Rows the user is still editing (unsaved) are kept as typed, so a live update never wipes them.
  const load = useCallback(async (quiet = false) => {
    if (!supabase) return
    if (!quiet) setLoading(true)
    const { data, error } = await supabase.from('stock_items').select('id,location,item,weight,quantity,sort_order').order('sort_order').order('created_at')
    if (!quiet) setLoading(false)
    if (error) { if (!quiet) notify(`Could not load stock: ${error.message}`, 'error'); return }
    const fresh: StockRow[] = (data || []).map(r => ({ id: r.id, location: r.location, item: r.item, weight: r.weight == null ? '' : String(r.weight), quantity: String(r.quantity), saved: true }))
    setRows(current => {
      const editing = new Map(current.filter(r => !r.saved).map(r => [r.id, r]))
      const merged = fresh.map(r => editing.get(r.id) ?? r)
      const unsavedNew = current.filter(r => !r.saved && r.id.startsWith('new-'))
      return [...merged, ...unsavedNew]
    })
  }, [])

  useEffect(() => { void load() }, [load])

  // Live sync: any change on any device (stock edits or transfers) refreshes this screen.
  useLiveTable(['stock_items', 'stock_transfers'], () => void load(true))

  // Offer a one-time import of stock that was only saved in this browser before.
  useEffect(() => {
    try {
      const legacy = JSON.parse(localStorage.getItem('ahwmb-stock-report') || '{}') as Record<string, { item: string }[]>
      setLegacyCount(Object.values(legacy).flat().filter(r => r.item?.trim()).length)
    } catch { setLegacyCount(0) }
  }, [])

  const importLegacy = async () => {
    if (!supabase) return
    try {
      const legacy = JSON.parse(localStorage.getItem('ahwmb-stock-report') || '{}') as Record<string, { item: string; weight: string; quantity: string }[]>
      const payload = Object.entries(legacy).flatMap(([site, list]) => list
        .filter(r => r.item?.trim())
        .map(r => ({ location: LEGACY_LOCATION[site] || 'Site Area Godown', item: r.item.trim(), weight: num(r.weight) > 0 ? num(r.weight) : null, quantity: Math.max(0, num(r.quantity)) })))
      let imported = 0, skipped = 0
      for (const row of payload) {
        const { error } = await supabase.from('stock_items').insert(row)
        if (!error) imported++
        else if (error.code === '23505') skipped++ // already in the database
        else throw error
      }
      localStorage.removeItem('ahwmb-stock-report')
      setLegacyCount(0)
      notify(`Imported ${imported} items into the database${skipped ? ` (${skipped} already existed)` : ''}.`)
      await load()
    } catch (e) { notify(`Import failed: ${errorText(e)}`, 'error') }
  }

  const visible = rows.filter(r => r.location === location)

  const editRow = (id: string, key: 'item' | 'weight' | 'quantity', value: string) =>
    setRows(current => current.map(r => (r.id === id ? { ...r, [key]: value, saved: false } : r)))

  const saveRow = async (row: StockRow) => {
    if (!supabase || row.saved) return
    if (!row.item.trim()) return
    const payload = { location: row.location, item: row.item.trim(), weight: num(row.weight) > 0 ? num(row.weight) : null, quantity: Math.max(0, num(row.quantity)), updated_at: new Date().toISOString() }
    const isNew = row.id.startsWith('new-')
    const { data, error } = isNew
      ? await supabase.from('stock_items').insert(payload).select('id').single()
      : await supabase.from('stock_items').update(payload).eq('id', row.id).select('id').single()
    if (error) {
      notify(error.code === '23505' ? `${row.item} already exists in ${LOCATION_LABEL[row.location]}.` : `Could not save ${row.item}: ${error.message}`, 'error')
      return
    }
    setRows(current => current.map(r => (r.id === row.id ? { ...r, id: data.id, item: payload.item, saved: true } : r)))
  }

  const addRow = () => setRows(current => [...current, { id: `new-${crypto.randomUUID()}`, location, item: '', weight: '', quantity: '', saved: false }])

  const deleteRow = async (row: StockRow) => {
    if (!row.id.startsWith('new-')) {
      if (!window.confirm(`Delete ${row.item || 'this item'} from ${LOCATION_LABEL[row.location]}?`)) return
      const { error } = await supabase!.from('stock_items').delete().eq('id', row.id)
      if (error) { notify(`Could not delete: ${error.message}`, 'error'); return }
    }
    setRows(current => current.filter(r => r.id !== row.id))
  }

  const startTransfer = (to: Location) => { setTarget(to); setMessage(null); setView('transfer') }

  if (view === 'transfer') {
    return <TransferForm target={target} rows={rows} onCancel={() => setView('stock')} onDone={async text => { notify(text); setView('stock'); await load(true) }} />
  }
  if (view === 'history') return <TransferHistory onBack={() => setView('stock')} />

  return <section className="panel report-panel">
    <div className="report-heading">
      <div><p className="admin-eyebrow">AHWMB</p><h2 className="admin-heading">Stock Report</h2><p className="panel-sub">Stock is saved permanently. Transfers deduct from the source automatically.</p></div>
      <select className="stock-location-select" value={location} onChange={e => setLocation(e.target.value as Location)}>
        {LOCATIONS.map(l => <option key={l} value={l}>{LOCATION_LABEL[l]}</option>)}
      </select>
    </div>
    {message && <p className={`stock-message stock-message--${message.type}`} role="status">{message.text}</p>}
    {legacyCount > 0 && <div className="stock-legacy"><span>{legacyCount} stock items are saved only in this browser.</span><button type="button" className="btn-secondary" onClick={() => void importLegacy()}>Move them to the database</button></div>}
    <div className="site-tabs stock-toolbar">
      <span className="stock-location-label">Viewing: <strong>{LOCATION_LABEL[location]}</strong></span>
      <button type="button" className="btn-submit report-add" onClick={addRow}><Plus size={17} /> Add Item</button>
      <select className="stock-transfer-select" value="" onChange={e => e.target.value && startTransfer(e.target.value as Location)} aria-label="Transfer stock">
        <option value="">⇄ Transfer stock…</option>
        <option value="Jodia Bazaar Godown">Site Area Godown → Jodia Bazaar Godown</option>
        <option value="Shop">Jodia Bazaar Godown → Shop</option>
      </select>
      <button type="button" className="btn-secondary stock-history-btn" onClick={() => setView('history')}><History size={16} /> Transfer History</button>
    </div>
    <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Item</th><th>Weight (kg / bag)</th><th>Quantity (kg)</th><th>Bags</th><th aria-label="Actions" /></tr></thead><tbody>
      {loading && <tr><td colSpan={5} className="stock-empty">Loading stock…</td></tr>}
      {!loading && visible.length === 0 && <tr><td colSpan={5} className="stock-empty">No stock in {LOCATION_LABEL[location]} yet. Click “Add Item”.</td></tr>}
      {visible.map(row => <tr key={row.id}>
        <td data-label="Item"><input className="report-cell-input" value={row.item} onChange={e => editRow(row.id, 'item', e.target.value)} onBlur={() => void saveRow(row)} placeholder="e.g. Chana Dal" /></td>
        <td data-label="Weight (kg / bag)"><input className="report-cell-input" type="number" min="1" value={row.weight} onChange={e => editRow(row.id, 'weight', e.target.value)} onBlur={() => void saveRow(row)} placeholder="50" /></td>
        <td data-label="Quantity (kg)"><input className="report-cell-input" type="number" min="0" value={row.quantity} onChange={e => editRow(row.id, 'quantity', e.target.value)} onBlur={() => void saveRow(row)} placeholder="500" /></td>
        <td data-label="Bags"><input className="report-cell-input stock-bags" value={bagsFor(num(row.quantity), num(row.weight) || null) ?? '—'} readOnly aria-label="Auto calculated bags" /></td>
        <td data-label="Actions" className="stock-row-actions">{!row.saved && row.item.trim() ? <span className="stock-unsaved">Saving…</span> : null}<button type="button" className="ledger-delete-btn" onClick={() => void deleteRow(row)} aria-label={`Delete ${row.item}`}><Trash2 size={14} /></button></td>
      </tr>)}
    </tbody></table></div>
  </section>
}

function TransferForm({ target, rows, onCancel, onDone }: { target: Location; rows: StockRow[]; onCancel: () => void; onDone: (text: string) => void }) {
  const from = SOURCE_FOR[target]!
  const [lines, setLines] = useState<DraftLine[]>([newDraftLine()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const available = useMemo(() => rows.filter(r => r.location === from && r.saved && num(r.quantity) > 0), [rows, from])
  const stockOf = (item: string) => available.find(r => r.item === item)

  const setLine = (key: string, patch: Partial<DraftLine>) => setLines(current => current.map(l => {
    if (l.key !== key) return l
    const next = { ...l, ...patch }
    const weight = num(stockOf(next.item)?.weight || '') || null
    // Keep quantity (kg) and bags in sync when the item has a bag weight.
    if ('quantity' in patch) next.bags = weight ? String(bagsFor(num(next.quantity), weight) ?? '') : ''
    if ('bags' in patch && weight) next.quantity = next.bags ? String(num(next.bags) * weight) : ''
    if ('item' in patch) { next.quantity = ''; next.bags = '' }
    return next
  }))

  const problems = lines.map(l => {
    if (!l.item) return 'Choose an item'
    const stock = stockOf(l.item)
    if (!stock) return 'Not available here'
    if (num(l.quantity) <= 0) return 'Enter a quantity'
    if (num(l.quantity) > num(stock.quantity)) return `Only ${kg(num(stock.quantity))} available`
    return ''
  })
  const duplicate = new Set(lines.map(l => l.item).filter(Boolean)).size !== lines.filter(l => l.item).length
  const total = lines.reduce((s, l) => s + num(l.quantity), 0)
  const canConfirm = !busy && lines.length > 0 && problems.every(p => !p) && !duplicate

  const confirm = async () => {
    if (!supabase || !canConfirm) return
    setBusy(true); setError('')
    const { error: rpcError } = await supabase.rpc('transfer_stock', { p_from: from, p_to: target, p_lines: lines.map(l => ({ item: l.item, quantity: num(l.quantity) })) })
    setBusy(false)
    if (rpcError) { setError(rpcError.message); return }
    onDone(`✓ ${lines.length} item${lines.length === 1 ? '' : 's'} (${kg(total)}) shifted from ${LOCATION_LABEL[from]} to ${LOCATION_LABEL[target]}.`)
  }

  return <section className="panel report-panel">
    <div className="report-heading">
      <div><p className="admin-eyebrow">STOCK TRANSFER</p><h2 className="admin-heading">{LOCATION_LABEL[from]} → {LOCATION_LABEL[target]}</h2>
        <p className="panel-sub">{target === 'Shop' ? 'Shop is the final sale point — items moved here cannot be shifted again.' : 'List every item moving from the Site Area Godown, then confirm.'}</p></div>
      <button type="button" className="btn-secondary" onClick={onCancel}><X size={16} /> Cancel</button>
    </div>
    <div className="transfer-route">
      <label>From<span className="transfer-source">{LOCATION_LABEL[from]}</span></label>
      <ArrowRight size={22} aria-hidden="true" />
      <label>To<span className="transfer-target">{LOCATION_LABEL[target]}</span></label>
    </div>
    {available.length === 0
      ? <p className="stock-empty">There is no stock in {LOCATION_LABEL[from]} to shift. Add stock there first.</p>
      : <>
        <div className="report-table-wrap"><table className="report-table transfer-table"><thead><tr><th>Item</th><th>Available</th><th>Quantity (kg)</th><th>Bags</th><th aria-label="Remove" /></tr></thead><tbody>
          {lines.map((l, i) => {
            const stock = stockOf(l.item)
            const weight = num(stock?.weight || '') || null
            return <tr key={l.key}>
              <td data-label="Item"><select className="report-cell-input" value={l.item} onChange={e => setLine(l.key, { item: e.target.value })}>
                <option value="">Select item…</option>
                {available.map(r => <option key={r.id} value={r.item} disabled={lines.some(o => o.key !== l.key && o.item === r.item)}>{r.item}</option>)}
              </select></td>
              <td data-label="Available" className="transfer-available">{stock ? `${kg(num(stock.quantity))}${weight ? ` · ${bagsFor(num(stock.quantity), weight)} bags` : ''}` : '—'}</td>
              <td data-label="Quantity (kg)"><input className="report-cell-input" type="number" min="0" value={l.quantity} disabled={!l.item} onChange={e => setLine(l.key, { quantity: e.target.value })} placeholder="kg" />
                {problems[i] && l.item && l.quantity && <small className="transfer-problem">{problems[i]}</small>}</td>
              <td data-label="Bags"><input className="report-cell-input" type="number" min="0" value={l.bags} disabled={!weight} onChange={e => setLine(l.key, { bags: e.target.value })} placeholder={weight ? 'bags' : '—'} /></td>
              <td data-label="Remove" className="stock-row-actions"><button type="button" className="ledger-delete-btn" disabled={lines.length === 1} onClick={() => setLines(c => c.filter(x => x.key !== l.key))} aria-label="Remove line"><X size={14} /></button></td>
            </tr>
          })}
        </tbody></table></div>
        <button type="button" className="btn-secondary transfer-add" onClick={() => setLines(c => [...c, newDraftLine()])} disabled={lines.length >= available.length}><Plus size={16} /> Add another item</button>
      </>}
    {error && <p className="stock-message stock-message--error" role="alert">{error}</p>}
    <div className="transfer-confirm-bar">
      <div><span>Total moving</span><strong>{kg(total)}</strong><small>{LOCATION_LABEL[from]} → {LOCATION_LABEL[target]}</small></div>
      <button type="button" className="btn-submit" disabled={!canConfirm} onClick={() => void confirm()}><Truck size={18} /> {busy ? 'Shifting…' : 'Confirm Transfer'}</button>
    </div>
  </section>
}

function TransferHistory({ onBack }: { onBack: () => void }) {
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [month, setMonth] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    const all: Transfer[] = []
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from('stock_transfers').select('*').order('created_at', { ascending: false }).range(offset, offset + 999)
      if (error) { setMessage(`Could not load history: ${error.message}`); break }
      all.push(...(data as Transfer[]))
      if (!data || data.length < 1000) break
    }
    setTransfers(all)
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])
  useLiveTable(['stock_transfers'], () => void load())

  const months = useMemo(() => [...new Set(transfers.map(t => monthKey(t.created_at)))], [transfers])
  useEffect(() => { if (!months.includes(month)) setMonth(months[0] || '') }, [months, month])
  const shown = transfers.filter(t => monthKey(t.created_at) === month)

  const deleteMonth = async () => {
    if (!supabase || !month || !shown.length) return
    if (!window.confirm(`Delete all ${shown.length} transfer records from ${monthLabel(month)}?\n\nThis only removes the history. Current stock stays as it is.`)) return
    const start = new Date(`${month}-01T00:00:00`)
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1)
    const { error } = await supabase.from('stock_transfers').delete().gte('created_at', start.toISOString()).lt('created_at', end.toISOString())
    if (error) { setMessage(`Could not delete: ${error.message}`); return }
    setMessage(`✓ Deleted transfer history for ${monthLabel(month)}.`)
    await load()
  }

  return <section className="panel report-panel">
    <div className="report-heading">
      <div><p className="admin-eyebrow">STOCK</p><h2 className="admin-heading">Transfer History</h2><p className="panel-sub">Every confirmed transfer, saved permanently until you delete a month.</p></div>
      <button type="button" className="btn-secondary" onClick={onBack}>← Back to Stock</button>
    </div>
    {message && <p className="stock-message stock-message--ok" role="status">{message}</p>}
    {loading ? <p className="stock-empty">Loading…</p> : months.length === 0 ? <p className="stock-empty">No transfers yet.</p> : <>
      <div className="site-tabs stock-toolbar">
        <select className="stock-location-select" value={month} onChange={e => setMonth(e.target.value)} aria-label="Month">
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <span className="stock-location-label">{shown.length} transfer{shown.length === 1 ? '' : 's'}</span>
        <button type="button" className="btn-secondary btn-danger" onClick={() => void deleteMonth()}><Trash2 size={16} /> Delete {monthLabel(month)}</button>
      </div>
      <div className="transfer-history">
        {shown.map(t => <article key={t.id} className="transfer-card">
          <header><strong>{LOCATION_LABEL[t.from_location]} <ArrowRight size={14} /> {LOCATION_LABEL[t.to_location]}</strong>
            <span>{new Date(t.created_at).toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></header>
          <ul>{t.lines.map((l, i) => <li key={`${i}-${l.item}`}><span>{l.item}</span><span>{kg(Number(l.quantity))}{l.bags ? ` · ${l.bags} bags` : ''}</span></li>)}</ul>
          <footer><Check size={14} /> Total {kg(Number(t.total_quantity))}</footer>
        </article>)}
      </div>
    </>}
  </section>
}
