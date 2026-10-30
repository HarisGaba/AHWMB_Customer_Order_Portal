import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const register = () => {
    void navigator.serviceWorker.register('/sw.js').catch(error => console.warn('[AHWMB] Service worker registration failed', error))
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

window.addEventListener('load', () => {
  setTimeout(() => {
    const splash = document.getElementById('ahwmb-splash')
    if (splash) {
      splash.classList.add('hidden')
      setTimeout(() => splash.remove(), 450)
    }
  }, 800)
})
