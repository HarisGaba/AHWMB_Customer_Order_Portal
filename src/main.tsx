import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const register = () => {
    void navigator.serviceWorker.register('/sw.js').catch(error => console.warn('[AHWMB] Service worker registration failed', error))
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}

// The POS (/pos) and the order portal ship separate stylesheets that must not mix,
// so each route loads only its own bundle. Moving between them is a full page load.
const root = document.getElementById('root')!
const isPosRoute = /^\/pos(\/|$)/.test(window.location.pathname)

if (isPosRoute) {
  void import('./pos/main').then(({ mountPos }) => mountPos(root))
} else {
  void Promise.all([import('./App'), import('./styles.css')]).then(([{ default: App }]) => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
}

window.addEventListener('load', () => {
  setTimeout(() => {
    const splash = document.getElementById('ahwmb-splash')
    if (splash) {
      splash.classList.add('hidden')
      setTimeout(() => splash.remove(), 450)
    }
  }, 800)
})
