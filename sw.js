// Offline cache for the app shell. Bump VERSION on every release.
const VERSION = 'tt-v2.2.0';
const MEDIA = 'tt-media'; // photos rarely change, so this cache survives releases
const FILES = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './src/app.js', './src/engine.js', './src/store.js', './vendor/preact-htm.js',
  './fonts/barlow-latin-400-normal.woff2', './fonts/barlow-latin-500-normal.woff2', './fonts/barlow-latin-600-normal.woff2',
  './fonts/barlow-semi-condensed-latin-500-normal.woff2', './fonts/barlow-semi-condensed-latin-600-normal.woff2',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== MEDIA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Exercise photos shipped with the app: cache on first view so they work offline afterwards.
  if (url.origin === self.location.origin && url.pathname.includes('/media/')) {
    e.respondWith(caches.open(MEDIA).then((c) => c.match(e.request).then((hit) => hit
      || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }))));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // App files: network first so a new release shows up on the next open; the cache is the offline fallback.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(e.request, { cache: 'no-cache', signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return (await cache.match(e.request, { ignoreSearch: true })) || Response.error();
    }
  })());
});
