/* Minimal service worker for PWA install.
 * - Caches same-origin GET requests opportunistically.
 * - Does not implement complex offline flows (DocFlow data is token/api driven).
 */
const CACHE_NAME = 'docflow-pwa-v1';

self.addEventListener('install', (event) => {
  // Activate immediately.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, { ignoreVary: true });
      if (cached) return cached;

      const res = await fetch(req);
      // Cache successful responses.
      if (res && res.ok) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })()
  );
});

