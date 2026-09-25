const CACHE_NAME = 'kitachat-pwa-v6'; // Versi dinaikkan
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

// Aktivasi dan Bersihkan Cache Lama
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Menghapus cache versi lama:', cacheName);
            return caches.delete(cacheName);
          }
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
      caches.match(event.request)
        .then(response => {
          // Gunakan cache jika ada, jika tidak ambil dari jaringan
          return response || fetch(event.request);
        })
        .catch(() => {
          // Fallback jika jaringan gagal (Offline) agar tidak memicu uncaught error
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          
          // Jika gambar luar gagal dimuat saat offline
          if (event.request.destination === 'image') {
            return new Response(
              '<svg xmlns="http://w3.org" width="40" height="40" viewBox="0 0 40 40"><rect width="100%" height="100%" fill="#e0e0e0"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#666666">Offline</text></svg>',
              { headers: { 'Content-Type': 'image/svg+xml' } }
            );
          }

          // Kirim respons error HTTP yang valid alih-alih membiarkannya crash
          return new Response('Service Unavailable', { status: 503 });
        })
    );
  }
});
