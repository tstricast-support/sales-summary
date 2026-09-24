const CACHE = 'summary-v1'
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/manifest.json', '/icon.svg'])))
  self.skipWaiting()
})
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => clients.claim()))
})
// Network-first; fall back to cache when offline (app shell + department/record data)
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url)
  if (req.method !== 'GET') return
  const skip = /\/api\/(export|audit|summary)/.test(url.pathname)
  e.respondWith(fetch(req).then(res => {
    if (res.ok && !skip) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }
    return res
  }).catch(() => caches.match(req).then(m => m || (req.mode === 'navigate' ? caches.match('/') : Response.error()))))
})
