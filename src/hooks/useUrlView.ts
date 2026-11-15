import { useCallback, useEffect, useRef, useState } from 'react'
import { canLeaveScreen } from './useUnsavedChanges'
export function useUrlView<T extends string>(allowed: readonly T[], fallback: T) {
 const read = () => { const v = new URLSearchParams(window.location.search).get('view') as T; return allowed.includes(v) ? v : fallback }
 const [view, update] = useState<T>(read)
 const lastUrl = useRef(window.location.href)
 useEffect(() => { const pop = () => {
  if (window.location.href === lastUrl.current) return
  if (new URL(lastUrl.current).pathname !== window.location.pathname) return
  if (!canLeaveScreen()) { window.history.pushState({}, '', lastUrl.current); return }
  lastUrl.current = window.location.href; update(read())
 }; window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop) }, [fallback, allowed.join(',')])
 const setView = useCallback((next: T) => {
  const url = new URL(window.location.href); url.searchParams.set('view', next)
  if (url.href === window.location.href || !canLeaveScreen()) return
  window.history.pushState({}, '', url); lastUrl.current = url.href; update(next)
 }, [])
 return [view, setView] as const
}
