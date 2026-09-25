const CACHE_VERSION = 'kitachat-pwa-v11';
const RUNTIME_CACHE = 'kitachat-runtime-v11';
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/album-upload.js',
  '/ui-helpers.js',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(error => {
        console.warn('PWA install failed, continuing anyway:', error);
      })
  );
});

self.addEventListener('activate', event => {
  const allowedCaches = [CACHE_VERSION, RUNTIME_CACHE];

  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(cacheName => !allowedCaches.includes(cacheName))
            .map(cacheName => caches.delete(cacheName))
        );
      })
      .then(() => self.clients.claim())
  );
});

function isCacheableResponse(response) {
  return !!response &&
    response.ok &&
    response.type === 'basic' &&
    !response.headers.get('Cache-Control')?.includes('no-store') &&
    !response.headers.get('Cache-Control')?.includes('private');
}

function isBypassRequest(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/') ||
    url.pathname.startsWith('/uploads/')
  );
}

function offlineFallbackResponse() {
  return new Response(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120">' +
      '<rect width="100%" height="100%" fill="#f4f4f4"/>' +
      '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" ' +
      'font-family="Arial, sans-serif" font-size="18" fill="#666">Offline mode</text>' +
      '</svg>',
    {
      headers: { 'Content-Type': 'image/svg+xml' }
    }
  );
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (isBypassRequest(url)) return;

  const isNavigation = request.mode === 'navigate';
  const isImageRequest = request.destination === 'image';
  const isScriptOrStyle = ['script', 'style', 'font'].includes(request.destination);

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            event.waitUntil(
              caches.open(CACHE_VERSION).then(cache => cache.put(request, clone))
            );
          }
          return response;
        })
        .catch(async () => {
          const cachedHtml = await caches.match('/index.html');
          return cachedHtml || Response.redirect('/');
        })
    );
    return;
  }

  // Cache-first for static assets
  if (isScriptOrStyle || isImageRequest) {
    event.respondWith(
      caches.match(request).then(cached => {
        const networkFetch = fetch(request)
          .then(response => {
            if (isCacheableResponse(response)) {
              const clone = response.clone();
              event.waitUntil(
                caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone))
              );
            }
            return response;
          })
          .catch(() => {
            if (cached) return cached;
            if (isImageRequest) return offlineFallbackResponse();
            return new Response('Service Unavailable', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
          });

        return cached || networkFetch;
      })
    );
    return;
  }

  // Default: stale-while-revalidate
  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request)
        .then(response => {
          if (isCacheableResponse(response)) {
            const clone = response.clone();
            event.waitUntil(
              caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone))
            );
          }
          return response;
        })
        .catch(() => {
          if (cached) return cached;
          return new Response('Service Unavailable', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });

      return cached || networkFetch;
    })
  );
});
