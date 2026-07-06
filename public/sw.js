/**
 * Pocket Ops Service Worker — Network-First, Cache-Fallback (Module 3).
 * Techs in basements/dead zones still see the last-good copy of their
 * dashboard, job list, and job detail pages.
 */
const CACHE = 'pocketops-v5';
const PRECACHE = ['/dashboard', '/manifest.json', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never cache mutations
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never cache auth or public payment pages
  if (/^\/(login|signup|approve|api)\b/.test(url.pathname)) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const shell = await caches.match('/dashboard');
          if (shell) return shell;
        }
        return new Response('Offline — reconnect to sync.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      }),
  );
});
