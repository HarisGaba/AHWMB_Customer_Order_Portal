import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

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
