const CACHE_NAME = 'kitachat-pwa-v2';
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
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clientsClaim();
});

// Tangani Permintaan Fetch
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Periksa apakah permintaan BUKAN untuk API, Socket.io, atau uploads
  const isApiOrUpload = url.pathname.startsWith('/api/') || 
                        url.pathname.startsWith('/socket.io/') || 
                        url.pathname.startsWith('/uploads/');

  if (!isApiOrUpload) {
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          // Kembalikan dari cache jika ada, jika tidak lakukan fetch ke jaringan
          return response || fetch(event.request);
        }).catch(() => {
          // Fallback opsional jika offline dan aset tidak ada di cache
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        })
    );
  }
  // Jika isApiOrUpload bernilai true, event.respondWith() tidak dipanggil.
  // Browser secara otomatis akan langsung mengambil data dari jaringan (Bypass SW).
});
