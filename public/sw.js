const CACHE_NAME = 'kitachat-pwa-v10.4'; // Versi dinaikkan untuk memastikan cache bersih total
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

// Install Service Worker dan Cache Aset Statis
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// Aktivasi dan Bersihkan Cache Lama (Logika aman & lolos linter editor)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(cacheName => cacheName !== CACHE_NAME)
          .map(cacheName => {
            console.log('Menghapus cache versi lama:', cacheName);
            return caches.delete(cacheName);
          })
      );
    })
  );
  // Mengambil kendali client PWA secara instan
  self.clients.claim(); 
});

// Tangani Permintaan Fetch (Logika Bypass & Offline Fallback yang Solid)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Cek apakah permintaan ditujukan untuk API, Socket, atau Uploads
  const isBypassRoute = url.pathname.startsWith('/api/') || 
                        url.pathname.startsWith('/socket.io/') || 
                        url.pathname.startsWith('/uploads/');

  // 2. JIKA BUKAN rute bypass, tangani lewat Service Worker / Cache
  if (!isBypassRoute) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          // STRATEGI OPTIMASI: Network-First untuk Aset Statis agar PWA Selalu Terupdate
          // Jika berhasil mengambil dari jaringan dan statusnya OK, update cache secara background
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Fallback ke Cache jika Jaringan Gagal/Offline
          return caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) return cachedResponse;

            // Jika rute navigasi utama gagal total dan tidak ada di cache
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            
            // PERBAIKAN: Validasi URL Namespace SVG W3C agar gambar offline berhasil merender sempurna
            if (event.request.destination === 'image') {
              return new Response(
                '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="100%" height="100%" fill="#e0e0e0"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#666666">Offline</text></svg>',
                {
                  headers: {
                    'Content-Type': 'image/svg+xml'
                  }
                }
              );

            // Kirim respons error HTTP yang valid alih-alih membiarkannya crash
            return new Response('Service Unavailable', { status: 503 });
          });
        })
    );
  }
});
