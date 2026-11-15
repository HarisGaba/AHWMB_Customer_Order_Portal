type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  remove: (id: string) => void
}

// The Edge Function verifies this token before it can create an order.
export function requestTurnstileToken(): Promise<string> {
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY
  const api = (window as Window & { turnstile?: TurnstileApi }).turnstile
  if (!api || !sitekey) return Promise.reject(new Error('Online ordering is temporarily unavailable. Please contact the shop.'))
  return new Promise((resolve, reject) => {
    const container = document.createElement('div')
    container.id = 'turnstile-widget'
    container.setAttribute('aria-label', 'Security verification')
    document.body.appendChild(container)
    let id: string | undefined
    const finish = (token?: string) => {
      clearTimeout(timer)
      if (id) api.remove(id)
      container.remove()
      if (token) resolve(token)
      else reject(new Error('Security check failed. Please refresh and try again.'))
    }
    const timer = window.setTimeout(() => finish(), 120000)
    try {
      id = api.render(container, {
        sitekey, action: 'customer-order', theme: 'light', appearance: 'interaction-only',
        callback: (token: string) => finish(token),
        'error-callback': () => finish(),
        'expired-callback': () => finish(),
        'timeout-callback': () => finish(),
      })
    } catch { finish() }
  })
}
