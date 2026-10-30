const CACHE_NAME = 'ahwmb-static-v1'
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
