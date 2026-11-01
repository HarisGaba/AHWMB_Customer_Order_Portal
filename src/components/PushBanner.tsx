import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// The VAPID public key is not secret; the fallback lets production work
// even if VITE_VAPID_PUBLIC_KEY is not set in the hosting environment.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY
  || 'BBMQJK5rR64H3MNB1qvAe_UvxMncq2aYysQH4NSEMnieeP5lYyjhD3-2QYWQinOUK0172BTUy53TKMXjwYt590A'

const pushSupported = () =>
  'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

// Subscribes this device and saves it so the send-push-notification function can reach it.
async function saveSubscription(adminEmail: string) {
  if (!supabase) throw new Error('Supabase is not configured')
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
    || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  const sub = subscription.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_email: adminEmail,
    endpoint: sub.endpoint!,
    p256dh: sub.keys!.p256dh,
    auth: sub.keys!.auth,
    user_agent: navigator.userAgent.slice(0, 200),
  }, { onConflict: 'endpoint' })
  if (error) throw error
}

export function PushBanner({ language, adminEmail, onToast }: {
  language: string
  adminEmail: string
  onToast: (message: string, type: 'success' | 'error') => void
}) {
  const ur = language === 'ur'
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    () => pushSupported() ? Notification.permission : 'unsupported')
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)

  // Already allowed on this device: quietly make sure the subscription is saved.
  useEffect(() => {
    if (permission !== 'granted' || !adminEmail) return
    saveSubscription(adminEmail).catch(err => console.warn('[AHWMB] Push subscription failed:', err))
  }, [permission, adminEmail])

  const enable = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result !== 'granted') return
      await saveSubscription(adminEmail)
      onToast(ur ? '🔔 نوٹیفکیشن فعال ہو گئے!' : '🔔 Push notifications enabled!', 'success')
    } catch (err) {
      console.warn('[AHWMB] Push subscription failed:', err)
      onToast(ur ? 'نوٹیفکیشن فعال نہیں ہو سکے' : 'Could not enable notifications', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (dismissed || permission !== 'default') return null
  return <div className="install-banner push-permission-banner" role="status">
    <span aria-hidden="true" className="push-permission-icon">🔔</span>
    <div className="install-banner-text">
      <strong>{ur ? 'نئے آرڈرز کے الرٹس' : 'New order alerts'}</strong>
      <span>{ur ? 'نئے آرڈر پر فوری الرٹ کے لیے نوٹیفکیشن فعال کریں' : 'Enable notifications to get alerts for new orders'}</span>
    </div>
    <button type="button" className="btn-install btn-enable-notifications" disabled={busy} onClick={() => void enable()}>
      {ur ? 'فعال کریں' : 'Enable'}
    </button>
    <button type="button" className="install-banner-dismiss push-banner-dismiss" onClick={() => setDismissed(true)} aria-label={ur ? 'بند کریں' : 'Dismiss'}>✕</button>
  </div>
}
