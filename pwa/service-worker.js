// service-worker.js -- caches the app shell so the controller still LOADS
// offline (it just can't reach the bridge until back on the performance network).

const CACHE_NAME = 'dspm-shell-v4';
const SHELL_FILES = [
  './index.html',
  './app.js',
  './config.js',
  './theme.css',
  './qrcode.min.js',
  './qr-share.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL_FILES)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // network-first for everything, falling back to cached shell when offline
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
