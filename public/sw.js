const CACHE_NAME = 'kitachat-pwa-v10.5';
const RUNTIME_CACHE = 'kitachat-runtime-v10.5';

const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

// 1. Install Service Worker dan Cache Aset Statis Utama
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

// 2. Aktivasi dan Pembersihan Cache Lama secara Aman (Berdasarkan Prefix)
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
            .map(cacheName => {
              console.log('Menghapus cache versi lama:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// 3. Tangani Permintaan Fetch dengan Strategi Cerdas & Validasi Ketat
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Validasi Origin: Abaikan aset pihak luar (CDN/eksternal) agar tidak mencemari cache
  if (url.origin !== self.location.origin) {
    return;
  }

  // Cek apakah permintaan ditujukan untuk API, Socket, atau Uploads
  const isBypassRoute = url.pathname.startsWith('/api/') || 
                        url.pathname.startsWith('/socket.io/') || 
                        url.pathname.startsWith('/uploads/');

  // Abaikan request selain metode GET atau yang masuk rute bypass
  if (request.method !== 'GET' || isBypassRoute) {
    return;
  }

  // Batasi tipe destinasi yang boleh di-cache (Statis & Navigasi)
  const cacheableDestinations = ['style', 'script', 'font', 'image'];
  const shouldCache = cacheableDestinations.includes(request.destination) || request.mode === 'navigate';

  event.respondWith(
    caches.match(request).then(cachedResponse => {
      // Strategi khusus untuk Navigasi (HTML): Network-First agar selalu mendapatkan versi terbaru
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

      // Untuk aset statis (CSS, JS, Font, Gambar)
      const fetchPromise = fetch(request).then(networkResponse => {
        const cacheControl = networkResponse.headers.get('Cache-Control') || '';
        
        // Validasi ketat Cache-Control & tipe respons
        const isCacheable = networkResponse &&
                            networkResponse.ok &&
                            networkResponse.type === 'basic' &&
                            !cacheControl.includes('no-store') &&
                            !cacheControl.includes('private');

        if (isCacheable && shouldCache) {
          const responseToCache = networkResponse.clone();
          event.waitUntil(
            caches.open(RUNTIME_CACHE).then(cache => {
              return cache.put(request, responseToCache);
            }).catch(error => {
              console.warn('Gagal memperbarui runtime cache:', error);
            })
          );
        }
        return networkResponse;
      }).catch(() => {
        // Jika jaringan gagal, gunakan cache jika tersedia
        if (cachedResponse) return cachedResponse;

        // Fallback khusus Gambar: Render SVG Offline dengan Namespace W3C yang Valid
        if (request.destination === 'image') {
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="100%" height="100%" fill="#e0e0e0"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#666666">Offline</text></svg>',
            {
              headers: {
                'Content-Type': 'image/svg+xml'
              }
            }
          );
        }

        // Fallback Universal: Response 503 yang bersih dan valid jika benar-benar offline
        return new Response('Service Unavailable', {
          status: 503,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Retry-After': '60'
          }
        });
      });

      // Kembalikan dari cache langsung jika ada, atau ambil dari fetchPromise
      return cachedResponse || fetchPromise;
    })
  );
});
