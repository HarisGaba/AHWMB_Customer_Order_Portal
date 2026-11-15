import { useEffect } from 'react'

// Used by both portal routers before changing the active screen.
export const canLeaveScreen = () => window.dispatchEvent(new Event('ahwmb:before-navigate', { cancelable: true }))
export function useUnsavedChanges(dirty: boolean, message: string) {
 useEffect(() => {
  const navigate = (event: Event) => { if (dirty && !window.confirm(message)) event.preventDefault() }
  const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
  window.addEventListener('ahwmb:before-navigate', navigate)
  window.addEventListener('beforeunload', unload)
  return () => { window.removeEventListener('ahwmb:before-navigate', navigate); window.removeEventListener('beforeunload', unload) }
 }, [dirty, message])
}
