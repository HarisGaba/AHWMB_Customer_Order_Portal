type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  remove: (id: string) => void
}

// The Edge Function verifies this token before it can create an order.
export async function requestTurnstileToken(): Promise<string> {
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY
  if (!sitekey) throw new Error('Online ordering security is not configured. Please contact the shop; your order is preserved.')
  const deadline = Date.now() + 10000
  while (!(window as Window & { turnstile?: TurnstileApi }).turnstile && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
  const api = (window as Window & { turnstile?: TurnstileApi }).turnstile
  if (!api) throw new Error('Security verification could not load. Please retry; your order is preserved.')
  return new Promise((resolve, reject) => {
    const container = document.createElement('div')
    container.id = 'turnstile-widget'
    container.setAttribute('aria-label', 'Security verification')
    document.body.appendChild(container)
    let id: string | undefined
    let finished = false
    const finish = (token?: string) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (id) api.remove(id)
      container.remove()
      if (token) resolve(token)
      else reject(new Error('Security check failed. Please refresh and try again.'))
    }
    const timer = window.setTimeout(() => finish(), 45000)
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
