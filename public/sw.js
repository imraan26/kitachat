const CACHE_VERSION = 'kitachat-pwa-v13';
const RUNTIME_CACHE = 'kitachat-runtime-v13';
const APP_SHELL = ['/', '/index.html', '/style.css', '/app.js', '/album-upload.js', '/ui-helpers.js', '/manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()).catch(error => console.warn('PWA install failed:', error)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => ![CACHE_VERSION, RUNTIME_CACHE].includes(key)).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

function isBypass(url) { return ['/api/', '/socket.io/', '/uploads/'].some(prefix => url.pathname.startsWith(prefix)); }
function cacheable(response) {
  const control = response?.headers.get('Cache-Control') || '';
  return Boolean(response?.ok && response.type === 'basic') && !/no-store|private/i.test(control);
}
function offlineImage() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120"><rect width="100%" height="100%" fill="#f4f4f4"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="18" fill="#666">Offline mode</text></svg>';
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' } });
}
async function networkFirst(request, fallback, isImage) {
  try {
    const response = await fetch(request);
    if (cacheable(response)) await (await caches.open(RUNTIME_CACHE)).put(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(fallback || request);
    if (cached) return cached;
    if (isImage) return offlineImage();
    return new Response('Service Unavailable', { status: 503 });
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || isBypass(url)) return;
  const navigation = request.mode === 'navigate';
  const asset = ['script', 'style', 'font', 'image'].includes(request.destination);
  if (!navigation && !asset) return;
  event.respondWith(networkFirst(request, navigation ? '/index.html' : undefined, request.destination === 'image'));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
