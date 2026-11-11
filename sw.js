/* Service worker : fait marcher l'app hors connexion
   et installe automatiquement les nouvelles versions.
   ⚠️ Augmenter VERSION à chaque mise à jour (même numéro que app.js). */
const VERSION = '2.5.0';
const CACHE = 'mon-systeme-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './style.css?v=' + VERSION,
  './app.js?v=' + VERSION,
  './holo.js?v=' + VERSION,
  './vendor/three.module.min.js',
  './assets/corps.bin',
  './data/ciqual.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('mon-systeme-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages : d'abord Internet (pour avoir la dernière version), sinon la copie locale
  if (req.mode === 'navigate') {
    event.respondWith(
      Promise.race([fetch(req, { cache: 'no-store' }), timeout(4000)])
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html', { cacheName: CACHE }).then(r => r || caches.match('./')))
    );
    return;
  }

  // Fichiers (style, script, icônes) : copie locale d'abord, sinon Internet
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
