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

// Tangani Permintaan Fetch (Abaikan rute API /uploads /socket.io agar tidak error 500/fetch failed)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Jangan cache rute API, Socket.io, atau folder uploads
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/uploads/')) {
    return; // Biarkan berjalan langsung ke jaringan tanpa Service Worker
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request);
      }).catch(() => {
        // Fallback opsional jika offline
      })
  );
});