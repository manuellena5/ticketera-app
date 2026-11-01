// Service worker. APP_VERSION y CACHE_NAME vienen de js/version.js, así
// suben siempre juntos. Cachea solo los archivos propios de la app:
// las llamadas a Supabase nunca se cachean.
importScripts('js/version.js');

const ARCHIVOS = [
  './',
  'index.html',
  'entrada.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/version.js',
  'js/config.js',
  'js/util.js',
  'js/api.js',
  'js/app.js',
  'js/entrada.js',
  'vendor/supabase/supabase.js',
  'vendor/fonts/figtree-latin-400-normal.woff2',
  'vendor/fonts/figtree-latin-600-normal.woff2',
  'vendor/fonts/figtree-latin-700-normal.woff2',
  'vendor/fonts/figtree-latin-800-normal.woff2',
  'img/icono-192.png',
  'img/icono-512.png',
  'img/icono-maskable-512.png',
  'img/apple-touch-icon.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(self.CACHE_NAME)
      .then((c) => c.addAll(ARCHIVOS.map((a) => new Request(a, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(
        nombres.filter((n) => n.startsWith('entradas-') && n !== self.CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase y cualquier otro: directo a la red

  // Páginas: red primero (para tomar versiones nuevas), caché si no hay señal.
  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req).catch(() =>
        caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
    );
    return;
  }

  // Archivos estáticos: caché primero.
  ev.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
