import { useCallback, useEffect, useState } from 'react'

export type DraftOrderRow = { id: string; itemName: string; quantityValue: string; unitType: string }
export type DraftOrderLanguage = 'en' | 'ur'
export type DraftOrder = { savedAt: string; name: string; phone: string; address: string; locationLink: string; notes: string; rows: DraftOrderRow[]; language: DraftOrderLanguage }

const KEY = 'ahwmb_order_draft'
const DAY = 24 * 60 * 60 * 1000

export function useDraftOrder(current: Omit<DraftOrder, 'savedAt'>) {
  const [hasDraft, setHasDraft] = useState(false)
  const [savedNotice, setSavedNotice] = useState(false)
  const hasContent = Boolean(current.name.trim() || current.phone.trim() || current.address.trim() || current.locationLink.trim() || current.notes.trim() || current.rows.some(row => row.itemName.trim() || row.quantityValue.trim()))

  const saveDraft = useCallback(() => {
    if (!hasContent) return
    try { localStorage.setItem(KEY, JSON.stringify({ ...current, savedAt: new Date().toISOString() })); setSavedNotice(true); window.setTimeout(() => setSavedNotice(false), 2000) } catch { /* storage unavailable */ }
  }, [current, hasContent])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return
      const draft = JSON.parse(raw) as DraftOrder
      if (Date.now() - new Date(draft.savedAt).getTime() < DAY) setHasDraft(true)
      else localStorage.removeItem(KEY)
    } catch { localStorage.removeItem(KEY) }
  }, [])

  useEffect(() => { const timer = window.setInterval(saveDraft, 30000); return () => window.clearInterval(timer) }, [saveDraft])
  const restoreDraft = useCallback(() => { try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) as DraftOrder : null } catch { return null } }, [])
  const clearDraft = useCallback(() => { try { localStorage.removeItem(KEY) } catch { /* storage unavailable */ } setHasDraft(false) }, [])
  return { hasDraft, setHasDraft, savedNotice, saveDraft, restoreDraft, clearDraft }
}
