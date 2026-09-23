const CACHE_NAME = 'kitachat-pwa-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

// Menginstal Service Worker dan menyimpan file ke cache lokal
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Membuka cache PWA');
        return cache.addAll(urlsToCache);
      })
  );
});

// Mengambil file dari cache jika tersedia, atau mengunduhnya jika belum ada
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Jika file ada di cache, gunakan itu
        if (response) {
          return response;
        }
        // Jika tidak, ambil dari jaringan/internet
        return fetch(event.request);
      })
  );
});