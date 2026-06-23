// Minimal offline shell: cache the app files so the controller opens without a
// network round-trip. The control socket itself is always live.
const CACHE = 'rytm-control-v1';
const ASSETS = ['.', 'index.html', 'app.js', 'config.js', 'manifest.json', '../midi-map.js'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
