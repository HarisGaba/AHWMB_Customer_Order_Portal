import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, History, Pencil, Plus, Printer, Search, Trash2, Truck, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

const LOCATIONS = ['Site Area Godown', 'Jodia Bazaar Godown', 'Shop'] as const
type Location = (typeof LOCATIONS)[number]
// Stock transfers happen only between godowns (either direction). The Shop is never a transfer
// source or destination. The source is always the godown being viewed.
const GODOWNS: Location[] = ['Site Area Godown', 'Jodia Bazaar Godown']
const isGodown = (l: Location) => GODOWNS.includes(l)
const transferTargets = (from: Location) => (isGodown(from) ? GODOWNS.filter(g => g !== from) : [])
const LOCATION_LABEL: Record<Location, string> = { 'Site Area Godown': 'Site Area Godown', 'Jodia Bazaar Godown': 'Jodia Bazaar Godown', Shop: 'Shop' }
// Older browser-only data used these names.
const LEGACY_LOCATION: Record<string, Location> = { 'Jodia Bazaar': 'Jodia Bazaar Godown', 'Godam Site': 'Site Area Godown' }

type StockRow = { id: string; location: Location; item: string; weight: string; quantity: string; saved: boolean }
type TransferLine = { item: string; weight: number | null; quantity: number; bags: number | null }
type Transfer = { id: string; from_location: Location; to_location: Location; lines: TransferLine[]; total_quantity: number; created_at: string; edited_at?: string | null }
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

/** canEdit = Stock Report permission (add/edit/delete stock); canTransfer = Stock Transfer permission. */
export function StockReport({ canEdit = true, canTransfer = true }: { canEdit?: boolean; canTransfer?: boolean }) {
  const [location, setLocation] = useState<Location>('Site Area Godown')
  const [rows, setRows] = useState<StockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ text: string; type: 'ok' | 'error' } | null>(null)
  const [view, setView] = useState<'stock' | 'transfer' | 'history'>('stock')
  const [transfer, setTransfer] = useState<{ from: Location; to: Location } | null>(null)
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

  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const atLocation = rows.filter(r => r.location === location)
  // Search by item name. Rows still being typed (unsaved) always stay visible.
  const visible = query ? atLocation.filter(r => !r.saved || r.item.toLowerCase().includes(query)) : atLocation

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

  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  const deleteRow = (row: StockRow) => {
    // A blank row that was never saved is just removed.
    if (row.id.startsWith('new-')) { setRows(current => current.filter(r => r.id !== row.id)); return }
    setConfirm({
      title: 'Are you sure you want to delete this item?',
      detail: `${row.item || 'This item'} (${kg(num(row.quantity))}) will be removed from ${LOCATION_LABEL[row.location]}.`,
      onConfirm: async () => {
        const { error } = await supabase!.from('stock_items').delete().eq('id', row.id)
        if (error) throw error
        setRows(current => current.filter(r => r.id !== row.id))
        notify(`✓ Deleted ${row.item} from ${LOCATION_LABEL[row.location]}.`)
      },
    })
  }

  const startTransfer = (to: Location) => {
    // Guard: source = viewed godown, destination = another godown, never the Shop.
    if (!canTransfer || !isGodown(location) || !transferTargets(location).includes(to)) return
    setTransfer({ from: location, to })
    setMessage(null)
    setView('transfer')
  }

  if (view === 'transfer' && transfer) {
    return <TransferForm from={transfer.from} target={transfer.to} rows={rows} onCancel={() => setView('stock')} onDone={async text => { notify(text); setView('stock'); await load(true) }} />
  }
  if (view === 'history') return <TransferHistory canDelete={canEdit} canChange={canTransfer} onBack={() => setView('stock')} />

  return <section className="panel report-panel">
    <div className="report-heading">
      <div><p className="admin-eyebrow">AHWMB</p><h2 className="admin-heading">Stock Report</h2><p className="panel-sub">Stock is saved permanently. Transfers deduct from the source automatically.</p></div>
      <div className="stock-heading-actions">
        <button type="button" className="btn-secondary stock-print-btn" onClick={() => printStockReport(location, atLocation.filter(r => r.saved && r.item.trim()))} disabled={loading}><Printer size={17} /> Print Stock Report</button>
        <select className="stock-location-select" value={location} onChange={e => setLocation(e.target.value as Location)}>
          {/* Only the two godowns; the Shop is not part of the Stock Report. */}
          {GODOWNS.map(l => <option key={l} value={l}>{LOCATION_LABEL[l]}</option>)}
        </select>
      </div>
    </div>
    {message && <p className={`stock-message stock-message--${message.type}`} role="status">{message.text}</p>}
    {legacyCount > 0 && <div className="stock-legacy"><span>{legacyCount} stock items are saved only in this browser.</span><button type="button" className="btn-secondary" onClick={() => void importLegacy()}>Move them to the database</button></div>}
    <div className="site-tabs stock-toolbar">
      <label className="stock-search">
        <Search size={17} aria-hidden="true" />
        <input type="search" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setSearch('') }}
          placeholder={`Search items in ${LOCATION_LABEL[location]}…`} aria-label={`Search items in ${LOCATION_LABEL[location]}`} />
        {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}
      </label>
      {canEdit && <button type="button" className="btn-submit report-add" onClick={addRow}><Plus size={17} /> Add Item</button>}
      {!canTransfer ? null : isGodown(location)
        ? <select className="stock-transfer-select" value="" onChange={e => e.target.value && startTransfer(e.target.value as Location)} aria-label={`Transfer stock from ${LOCATION_LABEL[location]}`}>
          <option value="">⇄ Transfer from {LOCATION_LABEL[location]} to…</option>
          {transferTargets(location).map(to => <option key={to} value={to}>Shifted to {LOCATION_LABEL[to]}</option>)}
        </select>
        : <span className="stock-transfer-note">Transfers are only between godowns — choose a godown above to transfer.</span>}
      <button type="button" className="btn-secondary stock-history-btn" onClick={() => setView('history')}><History size={16} /> Transfer History</button>
    </div>
    <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Item</th><th>Weight (kg / bag)</th><th>Quantity (kg)</th><th>Bags</th><th aria-label="Actions" /></tr></thead><tbody>
      {loading && <tr><td colSpan={5} className="stock-empty">Loading stock…</td></tr>}
      {!loading && visible.length === 0 && <tr><td colSpan={5} className="stock-empty">{query && atLocation.length ? `No item matching “${search.trim()}” in ${LOCATION_LABEL[location]}.` : `No stock in ${LOCATION_LABEL[location]} yet. Click “Add Item”.`}</td></tr>}
      {visible.map(row => <tr key={row.id}>
        <td data-label="Item"><input className="report-cell-input" value={row.item} onChange={e => editRow(row.id, 'item', e.target.value)} onBlur={() => void saveRow(row)} placeholder="e.g. Chana Dal" readOnly={!canEdit} /></td>
        <td data-label="Weight (kg / bag)"><input className="report-cell-input" type="number" min="1" value={row.weight} onChange={e => editRow(row.id, 'weight', e.target.value)} onBlur={() => void saveRow(row)} placeholder="50" readOnly={!canEdit} /></td>
        <td data-label="Quantity (kg)"><input className="report-cell-input" type="number" min="0" value={row.quantity} onChange={e => editRow(row.id, 'quantity', e.target.value)} onBlur={() => void saveRow(row)} placeholder="500" readOnly={!canEdit} /></td>
        <td data-label="Bags"><input className="report-cell-input stock-bags" value={bagsFor(num(row.quantity), num(row.weight) || null) ?? '—'} readOnly aria-label="Auto calculated bags" /></td>
        <td data-label="Actions" className="stock-row-actions">{!row.saved && row.item.trim() ? <span className="stock-unsaved">Saving…</span> : null}{canEdit && <button type="button" className="ledger-delete-btn" onClick={() => deleteRow(row)} aria-label={`Delete ${row.item}`}><Trash2 size={14} /></button>}</td>
      </tr>)}
    </tbody></table></div>
    {confirm && <ConfirmModal request={confirm} onClose={() => setConfirm(null)} />}
  </section>
}

function TransferForm({ from, target, rows, onCancel, onDone }: { from: Location; target: Location; rows: StockRow[]; onCancel: () => void; onDone: (text: string) => void }) {
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
  const validRoute = isGodown(from) && isGodown(target) && from !== target
  const canConfirm = validRoute && !busy && lines.length > 0 && problems.every(p => !p) && !duplicate

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
        <p className="panel-sub">List every item moving from {LOCATION_LABEL[from]} to {LOCATION_LABEL[target]}, then confirm.</p></div>
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

function TransferHistory({ onBack, canDelete, canChange }: { onBack: () => void; canDelete: boolean; canChange: boolean }) {
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
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

  const deleteMonth = () => {
    if (!supabase || !month || !shown.length) return
    setConfirm({
      title: `Delete all ${shown.length} transfer records from ${monthLabel(month)}?`,
      detail: 'This only removes the history. Current stock stays as it is.',
      onConfirm: async () => {
        const start = new Date(`${month}-01T00:00:00`)
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1)
        const { error } = await supabase!.from('stock_transfers').delete().gte('created_at', start.toISOString()).lt('created_at', end.toISOString())
        if (error) throw error
        setMessage(`✓ Deleted transfer history for ${monthLabel(month)}.`)
        await load()
      },
    })
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
        {canDelete && <button type="button" className="btn-secondary btn-danger" onClick={() => void deleteMonth()}><Trash2 size={16} /> Delete {monthLabel(month)}</button>}
      </div>
      <div className="transfer-history">
        {shown.map(t => <TransferCard key={t.id} transfer={t} canChange={canChange} onConfirm={setConfirm} onChanged={text => { setMessage(text); void load() }} />)}
      </div>
    </>}
    {confirm && <ConfirmModal request={confirm} onClose={() => setConfirm(null)} />}
  </section>
}

const when = (iso: string) => new Date(iso).toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** Printable transfer slip (gate pass), printed through a hidden same-origin frame. */
function printTransfer(t: Transfer) {
  const rows = t.lines.map((l, i) => `<tr><td class="n">${i + 1}</td><td>${escapeHtml(l.item)}</td><td class="r">${kg(Number(l.quantity))}</td><td class="r">${l.bags ?? '—'}</td></tr>`).join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Stock Transfer — ${escapeHtml(when(t.created_at))}</title><style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; color: #000; font: 600 14px/1.5 Arial, Helvetica, sans-serif; }
    .sheet { margin: 14mm; border: 2px solid #000; padding: 10mm; }
    .head { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #000; padding-bottom: 6mm; margin-bottom: 6mm; }
    .head img { width: 18mm; height: 18mm; border-radius: 50%; filter: grayscale(1) contrast(1.4); }
    h1 { margin: 0; font-size: 24px; letter-spacing: 1px; }
    .sub { margin: 2px 0 0; font-size: 13px; }
    .route { display: flex; justify-content: space-between; gap: 10px; padding: 4mm 5mm; border: 1.5px solid #000; margin-bottom: 6mm; font-size: 16px; }
    .route b { font-size: 17px; }
    .meta { margin-bottom: 5mm; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #000; padding: 7px 10px; text-align: left; }
    th { background: #000; color: #fff; }
    td.n { width: 12mm; text-align: center; } .r { text-align: right; }
    tfoot td { font-size: 16px; background: #eee; }
    .sign { display: flex; justify-content: space-between; gap: 20mm; margin-top: 22mm; }
    .sign div { flex: 1; border-top: 1.5px solid #000; padding-top: 2mm; text-align: center; font-size: 13px; }
  </style></head><body><div class="sheet">
    <div class="head"><img src="${window.location.origin}/logo.png" alt=""><div><h1>STOCK TRANSFER SLIP</h1><p class="sub">AHWMB · Jodia Bazaar, Karachi</p></div></div>
    <div class="route"><span>From<br><b>${escapeHtml(LOCATION_LABEL[t.from_location] ?? t.from_location)}</b></span><span style="text-align:right">To<br><b>${escapeHtml(LOCATION_LABEL[t.to_location] ?? t.to_location)}</b></span></div>
    <div class="meta">Date: <b>${escapeHtml(when(t.created_at))}</b>${t.edited_at ? ` &nbsp;·&nbsp; Edited: ${escapeHtml(when(t.edited_at))}` : ''} &nbsp;·&nbsp; Ref: <b>${t.id.slice(0, 8).toUpperCase()}</b></div>
    <table><thead><tr><th>#</th><th>Item</th><th class="r">Quantity</th><th class="r">Bags</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td></td><td>Total</td><td class="r">${kg(Number(t.total_quantity))}</td><td class="r">${t.lines.reduce((a, l) => a + (Number(l.bags) || 0), 0) || '—'}</td></tr></tfoot></table>
    <div class="sign"><div>Sent by</div><div>Received by</div></div>
  </div></body></html>`
  printHtml(html)
}

type EditLine = { key: string; item: string; quantity: string }

/** One transfer in the history, with Edit / Delete / Print. Edit and Delete keep stock correct. */
function TransferCard({ transfer: t, canChange, onChanged, onConfirm }: { transfer: Transfer; canChange: boolean; onChanged: (text: string) => void; onConfirm: (request: ConfirmRequest) => void }) {
  const [editing, setEditing] = useState(false)
  const [lines, setLines] = useState<EditLine[]>([])
  const [sourceStock, setSourceStock] = useState<{ item: string; quantity: number }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const startEdit = async () => {
    setError('')
    setLines(t.lines.map(l => ({ key: crypto.randomUUID(), item: l.item, quantity: String(l.quantity) })))
    setEditing(true)
    const { data } = await supabase!.from('stock_items').select('item,quantity').eq('location', t.from_location).order('sort_order')
    setSourceStock((data || []).map(r => ({ item: r.item, quantity: Number(r.quantity) })))
  }

  // What can be sent for an item = what is left at the source + what this transfer already sent.
  const already = (item: string) => t.lines.filter(l => l.item.toLowerCase() === item.toLowerCase()).reduce((a, l) => a + Number(l.quantity), 0)
  const maxFor = (item: string) => (sourceStock.find(r => r.item.toLowerCase() === item.toLowerCase())?.quantity ?? 0) + already(item)
  const problems = lines.map(l => {
    if (!l.item) return 'Choose an item'
    if (num(l.quantity) <= 0) return 'Enter a quantity'
    if (sourceStock.length && num(l.quantity) > maxFor(l.item)) return `Only ${kg(maxFor(l.item))} available`
    return ''
  })
  const duplicate = new Set(lines.map(l => l.item.toLowerCase()).filter(Boolean)).size !== lines.filter(l => l.item).length
  const canSave = !busy && lines.length > 0 && problems.every(p => !p) && !duplicate
  const choices = [...new Set([...t.lines.map(l => l.item), ...sourceStock.filter(r => r.quantity > 0).map(r => r.item)])]

  const save = async () => {
    if (!canSave) return
    setBusy(true); setError('')
    const { error: rpcError } = await supabase!.rpc('edit_transfer', { p_id: t.id, p_lines: lines.map(l => ({ item: l.item, quantity: num(l.quantity) })) })
    setBusy(false)
    if (rpcError) { setError(rpcError.message); return }
    setEditing(false)
    onChanged('✓ Transfer updated. Stock in both godowns was adjusted.')
  }

  const remove = () => {
    const source = LOCATION_LABEL[t.from_location] ?? t.from_location
    onConfirm({
      title: 'Are you sure you want to delete this transfer?',
      detail: `The stock still in ${LOCATION_LABEL[t.to_location] ?? t.to_location} will be moved back to ${source}: ${t.lines.map(l => `${l.item} ${kg(Number(l.quantity))}`).join(', ')}.`,
      onConfirm: async () => {
        setError('')
        const { data, error: rpcError } = await supabase!.rpc('delete_transfer', { p_id: t.id })
        if (rpcError) throw rpcError
        // The record is always removed; report anything that could not be moved back.
        const result = (data || {}) as { returned?: { item: string; quantity: number }[]; not_returned?: { item: string; quantity: number }[] }
        const returned = (result.returned || []).reduce((a, l) => a + Number(l.quantity), 0)
        const missing = result.not_returned || []
        onChanged(`✓ Transfer deleted.${returned ? ` ${kg(returned)} moved back to ${source}.` : ''}${missing.length ? ` Not returned (no longer in stock): ${missing.map(l => `${l.item} ${kg(Number(l.quantity))}`).join(', ')}.` : ''}`)
      },
    })
  }

  return <article className={`transfer-card${editing ? ' transfer-card--editing' : ''}`}>
    <header><strong>{LOCATION_LABEL[t.from_location] ?? t.from_location} <ArrowRight size={14} /> {LOCATION_LABEL[t.to_location] ?? t.to_location}</strong>
      <span>{when(t.created_at)}{t.edited_at ? ` · edited ${when(t.edited_at)}` : ''}</span></header>
    {!editing
      ? <ul>{t.lines.map((l, i) => <li key={`${i}-${l.item}`}><span>{l.item}</span><span>{kg(Number(l.quantity))}{l.bags ? ` · ${l.bags} bags` : ''}</span></li>)}</ul>
      : <div className="transfer-edit">
        {lines.map((l, i) => <div key={l.key} className="transfer-edit-row">
          <select className="report-cell-input" value={l.item} onChange={e => setLines(c => c.map(x => x.key === l.key ? { ...x, item: e.target.value } : x))}>
            <option value="">Select item…</option>
            {choices.map(item => <option key={item} value={item} disabled={lines.some(o => o.key !== l.key && o.item.toLowerCase() === item.toLowerCase())}>{item}</option>)}
          </select>
          <input className="report-cell-input" type="number" min="0" value={l.quantity} onChange={e => setLines(c => c.map(x => x.key === l.key ? { ...x, quantity: e.target.value } : x))} placeholder="kg" aria-label="Quantity (kg)" />
          <button type="button" className="ledger-delete-btn" onClick={() => setLines(c => c.filter(x => x.key !== l.key))} disabled={lines.length === 1} aria-label="Remove line"><X size={14} /></button>
          {problems[i] && l.item && <small className="transfer-problem">{problems[i]}</small>}
        </div>)}
        <button type="button" className="btn-secondary transfer-add" onClick={() => setLines(c => [...c, { key: crypto.randomUUID(), item: '', quantity: '' }])}><Plus size={15} /> Add item</button>
      </div>}
    {error && <p className="stock-message stock-message--error" role="alert">{error}</p>}
    <footer>
      <span className="transfer-total"><Check size={14} /> Total {editing ? kg(lines.reduce((a, l) => a + num(l.quantity), 0)) : kg(Number(t.total_quantity))}</span>
      <span className="transfer-actions">
        {editing ? <>
          <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
          <button type="button" className="btn-submit" onClick={() => void save()} disabled={!canSave}>{busy ? 'Saving…' : 'Save changes'}</button>
        </> : <>
          {canChange && <button type="button" className="ledger-edit-btn" onClick={() => void startEdit()} disabled={busy}><Pencil size={14} /> Edit</button>}
          {canChange && <button type="button" className="ledger-delete-btn" onClick={remove} disabled={busy}><Trash2 size={14} /> Delete</button>}
          <button type="button" className="ledger-print-btn" onClick={() => printTransfer(t)}><Printer size={14} /> Print</button>
        </>}
      </span>
    </footer>
  </article>
}

/**
 * Prints a standalone HTML document through a hidden same-origin frame. Only that
 * document is printed, so no buttons, menus or app headers appear on paper.
 */
function printHtml(html: string) {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0'
  frame.srcdoc = html
  frame.onload = () => {
    const win = frame.contentWindow
    const img = frame.contentDocument?.querySelector('img')
    let printed = false
    const go = () => { if (printed) return; printed = true; win?.focus(); win?.print(); setTimeout(() => frame.remove(), 60_000) }
    if (img && !img.complete) { img.addEventListener('load', go, { once: true }); img.addEventListener('error', go, { once: true }); setTimeout(go, 2500) } else go()
  }
  document.body.appendChild(frame)
}

/** Month-end stock audit sheet for one godown: Item, Weight, Quantity (kg), Bags, with totals. */
function printStockReport(location: Location, rows: StockRow[]) {
  const now = new Date()
  const totalKg = rows.reduce((a, r) => a + num(r.quantity), 0)
  const totalBags = rows.reduce((a, r) => a + (bagsFor(num(r.quantity), num(r.weight) || null) ?? 0), 0)
  const body = rows.length
    ? rows.map((r, i) => {
      const bags = bagsFor(num(r.quantity), num(r.weight) || null)
      return `<tr><td class="n">${i + 1}</td><td>${escapeHtml(r.item)}</td><td class="r">${r.weight ? `${escapeHtml(r.weight)} kg` : '—'}</td><td class="r">${kg(num(r.quantity))}</td><td class="r">${bags ?? '—'}</td></tr>`
    }).join('')
    : '<tr><td colspan="5" class="empty">No stock recorded</td></tr>'
  printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>Stock Report — ${escapeHtml(LOCATION_LABEL[location])}</title><style>
    /* margin 0 removes the browser's own URL/date header and footer; .sheet adds the page margin. */
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; color: #000; font: 600 13px/1.45 Arial, Helvetica, sans-serif; }
    .sheet { margin: 12mm; border: 2px solid #000; padding: 9mm; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
    .head { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #000; padding-bottom: 5mm; margin-bottom: 5mm; }
    .head img { width: 17mm; height: 17mm; border-radius: 50%; filter: grayscale(1) contrast(1.4); }
    h1 { margin: 0; font-size: 23px; letter-spacing: 1px; }
    .sub { margin: 2px 0 0; font-size: 12.5px; }
    .meta { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 5mm; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th, td { border: 1px solid #000; padding: 6px 9px; text-align: left; }
    th { background: #000; color: #fff; font-size: 12.5px; text-transform: uppercase; letter-spacing: .4px; }
    td.n { width: 11mm; text-align: center; } .r { text-align: right; font-variant-numeric: tabular-nums; }
    td.empty { text-align: center; padding: 14px; }
    tr.total td { background: #eee; font-size: 15px; border-top: 2px solid #000; }
    .sign { display: flex; justify-content: space-between; gap: 20mm; margin-top: 18mm; break-inside: avoid; }
    .sign div { flex: 1; border-top: 1.5px solid #000; padding-top: 2mm; text-align: center; font-size: 12.5px; }
  </style></head><body><div class="sheet">
    <div class="head"><img src="${window.location.origin}/logo.png" alt=""><div><h1>STOCK REPORT</h1><p class="sub">AHWMB · Jodia Bazaar, Karachi</p></div></div>
    <div class="meta"><span>Location: <b>${escapeHtml(LOCATION_LABEL[location])}</b></span><span>Date: <b>${escapeHtml(now.toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' }))}</b>, ${escapeHtml(now.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }))}</span></div>
    <table>
      <thead><tr><th>#</th><th>Item Name</th><th class="r">Weight (kg / bag)</th><th class="r">Total Quantity (kg)</th><th class="r">Bags</th></tr></thead>
      <tbody>${body}${rows.length ? `<tr class="total"><td></td><td>Total (${rows.length} item${rows.length === 1 ? '' : 's'})</td><td></td><td class="r">${kg(totalKg)}</td><td class="r">${totalBags || '—'}</td></tr>` : ''}</tbody>
    </table>
    <div class="sign"><div>Checked by</div><div>Approved by</div></div>
  </div></body></html>`)
}

type ConfirmRequest = { title: string; detail?: string; confirmLabel?: string; onConfirm: () => Promise<void> }

/** Cancel / Delete confirmation pop-up. Esc or clicking outside cancels. */
function ConfirmModal({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { cancelRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])
  const confirm = async () => {
    setBusy(true); setError('')
    try { await request.onConfirm(); onClose() }
    catch (e) { setError(errorText(e)); setBusy(false) }
  }
  return <div className="confirm-overlay" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <div className="confirm-modal">
      <div className="confirm-icon" aria-hidden="true"><AlertTriangle size={26} /></div>
      <h3 id="confirm-title">{request.title}</h3>
      {request.detail && <p>{request.detail}</p>}
      {error && <p className="stock-message stock-message--error" role="alert">{error}</p>}
      <div className="confirm-actions">
        <button ref={cancelRef} type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="confirm-delete" onClick={() => void confirm()} disabled={busy}><Trash2 size={16} /> {busy ? 'Deleting…' : request.confirmLabel || 'Delete'}</button>
      </div>
    </div>
  </div>
}
