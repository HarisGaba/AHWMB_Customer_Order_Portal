import { useCallback, useEffect, useRef, useState } from 'react'
export type DraftOrderRow = { id: string; itemName: string; quantityValue: string; unitType: string }
export type DraftOrderLanguage = 'en' | 'ur'
export type DraftOrder = { savedAt: string; name: string; phone: string; address: string; locationLink: string; notes: string; rows: DraftOrderRow[]; language: DraftOrderLanguage }
const LEGACY = 'ahwmb_order_draft'
const MIGRATED = 'ahwmb-customer-legacy-dismissed'
// sessionStorage isolates active drafts between tabs and survives a reload.
export function useDraftOrder(current: Omit<DraftOrder, 'savedAt'>) {
 const [key] = useState('ahwmb-customer-draft-v2')
 const [hasDraft, setHasDraft] = useState(() => { try { return !!(sessionStorage.getItem(key) || (!sessionStorage.getItem(MIGRATED) && localStorage.getItem(LEGACY))) } catch { return false } })
 const [savedNotice, setSavedNotice] = useState(false)
 const latest = useRef(current); latest.current = current
 const blocked = useRef(hasDraft); blocked.current = hasDraft
 const suppressed = useRef(false)
 const serialized = JSON.stringify(current)
 const saveDraft = useCallback(() => {
  if (blocked.current || suppressed.current) return
  const value = latest.current
  if (!value.name.trim() && !value.phone.trim() && !value.address.trim() && !value.notes.trim() && !value.locationLink.trim() && !value.rows.some(r => r.itemName.trim() || r.quantityValue.trim())) {
   try { sessionStorage.removeItem(key) } catch { /* storage unavailable */ }
   setSavedNotice(false); return
  }
  try { sessionStorage.setItem(key, JSON.stringify({ ...value, savedAt: new Date().toISOString() })); setSavedNotice(true) } catch { setSavedNotice(false) }
 }, [key])
 useEffect(() => {
  suppressed.current = false; setSavedNotice(false)
  const timer = setTimeout(saveDraft, 800)
  return () => clearTimeout(timer)
 }, [serialized, saveDraft])
 useEffect(() => {
  const flush = () => saveDraft()
  window.addEventListener('pagehide', flush)
  const interval = setInterval(flush, 5000)
  return () => { window.removeEventListener('pagehide', flush); clearInterval(interval) }
 }, [saveDraft])
 const restoreDraft = useCallback(() => { try {
  const value = JSON.parse(sessionStorage.getItem(key) || localStorage.getItem(LEGACY) || 'null')
  return value && ['name','phone','address','locationLink','notes'].every(k => typeof value[k] === 'string') && ['en','ur'].includes(value.language) && Array.isArray(value.rows) && value.rows.every((r: DraftOrderRow) => r && ['id','itemName','quantityValue','unitType'].every(k => typeof r[k as keyof DraftOrderRow] === 'string')) ? value as DraftOrder : null
 } catch { return null } }, [key])
 const clearDraft = useCallback(() => {
  suppressed.current = true
  try { sessionStorage.removeItem(key); sessionStorage.setItem(MIGRATED, '1') } catch { /* no stored draft */ }
  // Keep the old localStorage copy as a migration backup; don't delete another tab's data.
  setHasDraft(false); setSavedNotice(false)
 }, [key])
 return { hasDraft, setHasDraft, savedNotice, saveDraft, restoreDraft, clearDraft }
}
