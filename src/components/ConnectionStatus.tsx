import { useEffect, useState } from 'react'
export function ConnectionStatus({ ur = false }: { ur?: boolean }) {
 const [online, setOnline] = useState(navigator.onLine)
 useEffect(() => { const update = () => setOnline(navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) } }, [])
 if (online) return null // Only warn when offline.
 return <div role="status" className={`connection-status ${online ? 'is-online' : 'is-offline'}`}><span aria-hidden="true">●</span> {online ? (ur ? 'انٹرنیٹ دستیاب' : 'Network connected') : (ur ? 'انٹرنیٹ بند ہے۔ محفوظ کرنے کے لیے دوبارہ جڑیں۔' : 'Offline — reconnect before saving. Keep this page open.')}</div>
}
