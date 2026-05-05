/* Minimal service worker for PWA install.
 * - Caches same-origin GET requests opportunistically.
 * - Does not implement complex offline flows (DocFlow data is token/api driven).
 */
const CACHE_NAME = 'docflow-pwa-v2';

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

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && typeof data === 'object' && data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // For documents (HTML navigations), always try network first so users
  // don't get stuck on stale index.html that points to old hashed bundles.
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cachedDoc = await cache.match(req, { ignoreVary: true });
          if (cachedDoc) return cachedDoc;
          throw new Error('offline_document_unavailable');
        }
      })()
    );
    return;
  }

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

