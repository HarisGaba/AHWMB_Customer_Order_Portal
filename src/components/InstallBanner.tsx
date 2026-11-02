import { useEffect, useState } from 'react'

// iPhone/iPad Safari has no install prompt: the app is added from the Share menu instead.
// iPadOS reports itself as a Mac, so also check for touch.
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const IOS_DISMISS_KEY = 'ahwmb-ios-install-dismissed'
const IOS_DISMISS_DAYS = 7

function iosDismissedRecently() {
  try {
    const at = Number(localStorage.getItem(IOS_DISMISS_KEY) || 0)
    return Date.now() - at < IOS_DISMISS_DAYS * 86400000
  } catch { return false }
}

/** Safari's Share icon (square with an up arrow), drawn inline so it matches what the user sees. */
const ShareIcon = () => <svg className="ios-share-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>

export function InstallBanner({ language }: { language: string }) {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [ios] = useState(() => isIos() && !isInstalled() && !iosDismissedRecently())
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

  if (dismissed) return null

  if (ios && !prompt && !installed) {
    const dismissIos = () => {
      try { localStorage.setItem(IOS_DISMISS_KEY, String(Date.now())) } catch { /* storage unavailable */ }
      setDismissed(true)
    }
    return <div className="install-banner ios-install-banner" role="status">
      <span aria-hidden="true">📱</span>
      <div className="install-banner-text">
        <strong>{ur ? 'AHWMB ایپ iPhone پر انسٹال کریں' : 'Install AHWMB on your iPhone'}</strong>
        <ol className="ios-install-steps">
          <li>{ur ? 'Safari میں نیچے' : 'In Safari, tap'} <ShareIcon /> <b>{ur ? 'شیئر' : 'Share'}</b> {ur ? 'دبائیں' : 'at the bottom'}</li>
          <li>{ur ? 'نیچے اسکرول کر کے' : 'Scroll down and tap'} <b>{ur ? '"Add to Home Screen"' : '“Add to Home Screen”'}</b></li>
          <li>{ur ? 'اوپر' : 'Tap'} <b>{ur ? '"Add"' : '“Add”'}</b> {ur ? 'دبائیں' : 'at the top right'}</li>
        </ol>
      </div>
      <button type="button" className="install-banner-dismiss" onClick={dismissIos} aria-label={ur ? 'بند کریں' : 'Dismiss'}>✕</button>
    </div>
  }

  if (!prompt && !installed) return null
  return <div className="install-banner" role="status">
    <span aria-hidden="true">📱</span>
    <div className="install-banner-text"><strong>{installed ? (ur ? 'ایپ انسٹال ہو گئی!' : 'App installed successfully!') : (ur ? 'AHWMB ایپ انسٹال کریں' : 'Install AHWMB App')}</strong>
      {!installed && <span>{ur ? 'فوری رسائی کے لیے ہوم اسکرین پر شامل کریں' : 'Add to home screen for quick access'}</span>}</div>
    {prompt && <button type="button" className="btn-install" disabled={busy} onClick={() => void install()}>{ur ? 'انسٹال کریں' : 'Install'}</button>}
    <button type="button" className="install-banner-dismiss" onClick={() => setDismissed(true)} aria-label={ur ? 'بند کریں' : 'Dismiss'}>✕</button>
  </div>
}
