const CACHE_NAME = 'europa-2026-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './data.json',
  './manifest.json',
  './img/spain.jpg',
  './img/finland.jpg',
  './img/sweden.jpg',
  './img/belgium.jpg',
  './img/germay.jpg',
  './img/czech.jpg',
  './data/country.json',
  './data/spain.json',
  './data/finland.json',
  './data/sweden.json',
  './data/belgium.json',
  './data/germany.json',
  './data/czech.json',
  'https://cdn.tailwindcss.com'
];

// Instalación: Guarda todos los archivos en caché
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

// Activación: Limpia cachés antiguas
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});

// Estrategia de búsqueda: Busca en caché primero, si no hay red responde localmente
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});