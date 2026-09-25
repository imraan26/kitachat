const CACHE_NAME = 'kitachat-pwa-v10.6';
const RUNTIME_CACHE = 'kitachat-runtime-v10.6';

const urlsToCache = [
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
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  const cachePrefixes = ['kitachat-pwa-', 'kitachat-runtime-'];
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(cacheName => 
              cachePrefixes.some(prefix => cacheName.startsWith(prefix)) &&
              cacheName !== CACHE_NAME &&
              cacheName !== RUNTIME_CACHE
            )
            .map(cacheName => caches.delete(cacheName))
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  const isBypassRoute = url.pathname.startsWith('/api/') || 
                        url.pathname.startsWith('/socket.io/') || 
                        url.pathname.startsWith('/uploads/');

  if (request.method !== 'GET' || isBypassRoute) return;

  const cacheableDestinations = ['style', 'script', 'font', 'image'];
  const shouldCache = cacheableDestinations.includes(request.destination) || request.mode === 'navigate';

  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (request.mode === 'navigate') {
        return fetch(request)
          .then(networkResponse => {
            if (networkResponse && networkResponse.ok) {
              const responseClone = networkResponse.clone();
              event.waitUntil(
                caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone))
              );
            }
            return networkResponse;
          })
          .catch(() => cachedResponse || caches.match('/index.html'));
      }

      const fetchPromise = fetch(request).then(networkResponse => {
        const cacheControl = networkResponse.headers.get('Cache-Control') || '';
        const isCacheable = networkResponse &&
                            networkResponse.ok &&
                            networkResponse.type === 'basic' &&
                            !cacheControl.includes('no-store') &&
                            !cacheControl.includes('private');

        if (isCacheable && shouldCache) {
          const responseToCache = networkResponse.clone();
          event.waitUntil(
            caches.open(RUNTIME_CACHE).then(cache => cache.put(request, responseToCache))
          );
        }
        return networkResponse;
      }).catch(() => {
        if (cachedResponse) return cachedResponse;
        if (request.destination === 'image') {
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="100%" height="100%" fill="#e0e0e0"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#666666">Offline</text></svg>',
            { headers: { 'Content-Type': 'image/svg+xml' } }
          );
        }
        return new Response('Service Unavailable', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      });

      return cachedResponse || fetchPromise;
    })
  );
});
