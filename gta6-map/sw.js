/* Service worker « Carte GTA 6 » : pré-cache de tous les fichiers, stratégie cache d'abord.
   VERSION et PRECACHE sont réécrits par `python3 build_data.py --finalize`. */
const VERSION = '186a36150d';
const CACHE = 'carte-gta6-' + VERSION;
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/fonts.css',
  './data/anchors.json',
  './data/blips.json',
  './data/categories.json',
  './data/groups.json',
  './data/labels.json',
  './data/land.json',
  './data/landuse.json',
  './data/markers.json',
  './data/roads.json',
  './data/routes.json',
  './data/zones.json',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './js/app.js',
  './js/basemap.js',
  './js/icons.js',
  './js/mybg.js',
  './vendor/leaflet/LICENSE',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/markercluster/MarkerCluster.css',
  './vendor/markercluster/leaflet.markercluster.js',
  './vendor/ocr/eng.traineddata.gz',
  './vendor/ocr/fra.traineddata.gz',
  './vendor/ocr/tesseract-core-simd-lstm.js',
  './vendor/ocr/tesseract-core-simd-lstm.wasm',
  './vendor/ocr/tesseract.min.js',
  './vendor/ocr/worker.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // fichier par fichier : un fichier manquant ne bloque pas l'installation
    await Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('carte-gta6-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true }) ||
      (req.mode === 'navigate' ? await cache.match('./index.html') || await cache.match('./') : null);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (e) {
      return new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
