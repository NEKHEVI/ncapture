// NCapture : cache minimal pour l'installation sur l'écran d'accueil. Les appels /api ne sont jamais mis en cache.
// Réseau d'abord (toujours la dernière version), cache seulement hors ligne.
const C = 'ncapture-v1';
const COQUE = ['/capture', '/ncapture.css', '/ncapture-ui.js', '/categories.json', '/icon-192.png', '/favicon.svg',
  '/brand/ncapture-marque-fond-sombre.svg', '/brand/ncapture-marque-fond-clair.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(C).then((c) => c.addAll(COQUE))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => { const k = r.clone(); caches.open(C).then((c) => c.put(e.request, k)); return r; })
    .catch(() => caches.match(e.request)));
});
