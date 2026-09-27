const CACHE_NAME = 'europa-2026-v1.0.2';
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './img/spain.jpg',
  './img/finland.jpg',
  './img/sweden.jpg',
  './img/belgium.jpg',
  './img/germany.jpg',
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

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  const isLocalAsset = url.origin === self.location.origin;

  if (!isLocalAsset && !url.href.startsWith('https://cdn.tailwindcss.com')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then(response => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          const responseClone = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => cache.put(request, responseClone));

          return response;
        })
        .catch(() => caches.match(request));
    })
  );
});