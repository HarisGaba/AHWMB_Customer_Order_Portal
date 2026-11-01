const CACHE_NAME = 'ahwmb-static-v2'
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json', '/logo.png',
  '/icons/icon-192.png', '/icons/icon-512.png',
  '/images/ahwmb-hero.png', '/images/ahwmb-hero-desktop.png']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)))
})
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith('ahwmb-static-') && key !== CACHE_NAME).map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})
self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  // Never intercept API calls, third-party security checks or submissions.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  const navigation = request.mode === 'navigate'
  if (navigation && !['/', '/admin', '/login'].includes(url.pathname)) return
  if (!navigation && !['script', 'style', 'image', 'font', 'manifest'].includes(request.destination)) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    try {
      const response = await fetch(request)
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone())
      return response
    } catch {
      return await cache.match(request) || (navigation ? await cache.match('/') : undefined) || Response.error()
    }
  })())
})

// Push notification handler (new-order alerts for the admin)
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data?.json() || {} } catch { data = { body: event.data?.text() } }

  const title = data.title || 'AHWMB — New Order'
  const options = {
    body: data.body || 'A new order has been received.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: data.tag || 'new-order',
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    data: { url: data.url || '/admin', orderId: data.orderId || null },
    actions: [
      { action: 'open', title: '📋 View Order' },
      { action: 'dismiss', title: '✕ Dismiss' },
    ],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// Handle notification click
self.addEventListener('notificationclick', event => {
  event.notification.close()
  if (event.action === 'dismiss') return

  const url = event.notification.data?.url || '/admin'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // If the admin panel is already open, focus it
      for (const client of clientList) {
        if (client.url.includes('/admin') && 'focus' in client) return client.focus()
      }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})
