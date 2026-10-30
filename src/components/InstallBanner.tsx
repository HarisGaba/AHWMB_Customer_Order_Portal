import { useEffect, useState } from 'react'

export function InstallBanner({ language }: { language: string }) {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [installed, setInstalled] = useState(false)
  const ur = language === 'ur'
  useEffect(() => {
    const available = (event: Event) => {
      event.preventDefault()
      if (!window.matchMedia('(display-mode: standalone)').matches) setPrompt(event as BeforeInstallPromptEvent)
    }
    const complete = () => { setInstalled(true); setPrompt(null) }
    window.addEventListener('beforeinstallprompt', available)
    window.addEventListener('appinstalled', complete)
    return () => {
      window.removeEventListener('beforeinstallprompt', available)
      window.removeEventListener('appinstalled', complete)
    }
  }, [])
  const install = async () => {
    if (!prompt || busy) return
    setBusy(true)
    try { await prompt.prompt(); await prompt.userChoice }
    finally { setPrompt(null); setBusy(false) }
  }
  if (dismissed || (!prompt && !installed)) return null
  return <div className="install-banner" role="status">
    <span aria-hidden="true">📱</span>
    <div className="install-banner-text"><strong>{installed ? (ur ? 'ایپ انسٹال ہو گئی!' : 'App installed successfully!') : (ur ? 'AHWMB ایپ انسٹال کریں' : 'Install AHWMB App')}</strong>
      {!installed && <span>{ur ? 'فوری رسائی کے لیے ہوم اسکرین پر شامل کریں' : 'Add to home screen for quick access'}</span>}</div>
    {prompt && <button type="button" className="btn-install" disabled={busy} onClick={() => void install()}>{ur ? 'انسٹال کریں' : 'Install'}</button>}
    <button type="button" className="install-banner-dismiss" onClick={() => setDismissed(true)} aria-label={ur ? 'بند کریں' : 'Dismiss'}>✕</button>
  </div>
}
