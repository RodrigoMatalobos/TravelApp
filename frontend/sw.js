const CACHE_NAME = 'europa-2026-v1.0.28';
const APP_SHELL = [
  './',
  './index.html',
  './img/earth-blue-marble.jpg',
  './manifest.json',
  './img/spain.jpg',
  './img/finland.jpg',
  './img/sweden.jpg',
  './img/belgium.jpg',
  './img/germany.jpg',
  './img/czech.jpg',
  './icon/icon.png',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.core.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const localAssets = APP_SHELL.filter(asset => !asset.startsWith('https://'));
      const externalAssets = APP_SHELL.filter(asset => asset.startsWith('https://'));
      await cache.addAll(localAssets);
      await Promise.all(externalAssets.map(asset => cache.add(asset).catch(error => {
        console.warn('No se pudo precargar el recurso externo:', asset, error);
      })));
      await self.skipWaiting();
    })
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

  const isExternalLibrary = url.href.startsWith('https://cdn.tailwindcss.com')
    || url.href === 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js'
    || url.href === 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.core.js';
  if (!isLocalAsset && !isExternalLibrary) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(new Request(request, { cache: 'reload' }))
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  const isDynamicData = url.pathname.endsWith('.js') || url.pathname.endsWith('.json');
  if (isDynamicData) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => caches.match(request))
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