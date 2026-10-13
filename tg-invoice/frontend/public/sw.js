/* TG Invoice service worker — offline app shell + fast repeat visits.
 *
 * Strategy:
 *   • Navigations  → network-first, fall back to the cached shell (works offline)
 *   • Hashed assets → stale-while-revalidate (instant load, refreshed in background)
 *   • /api/*        → network-only (financial data is never cached/stale)
 *
 * Bump CACHE_VERSION to invalidate everything on the next deploy.
 */
const CACHE_VERSION = 'v2';
const SHELL_CACHE = `tg-invoice-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `tg-invoice-assets-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('tg-invoice-') && key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Financial data must always be live.
  if (url.pathname.startsWith('/api/')) return;

  // App shell for page navigations.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const contentType = response.headers.get('content-type') || '';
          if (response.ok && contentType.includes('text/html')) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => {});
            return response;
          }

          if (response.status === 404) {
            return caches.match('/index.html').then((cached) => cached || fetch('/index.html'));
          }

          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || fetch('/index.html')))
    );
    return;
  }

  // Hashed static assets: serve cache immediately, refresh in the background.
  event.respondWith(
    caches.open(ASSET_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    })
  );
});
