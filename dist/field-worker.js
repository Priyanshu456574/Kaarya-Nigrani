const cacheName = 'kn-field-shell-v1'

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(cacheName)
  const shell = await fetch('/', { cache: 'reload' })
  if (!shell.ok) throw new Error('App shell unavailable')
  const html = await shell.clone().text()
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1])
  await cache.addAll(assets)
  await cache.put('/', shell)
  await self.skipWaiting()
})()))

self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (event.request.mode === 'navigate' && !/^\/(api|media)(\/|$)/.test(url.pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match('/')))
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(event.request).then(async cached => {
      if (cached) return cached
      const response = await fetch(event.request)
      if (response.ok) {
        const cache = await caches.open(cacheName)
        await cache.put(event.request, response.clone())
      }
      return response
    }))
  }
})
