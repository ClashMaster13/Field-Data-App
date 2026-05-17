const CACHE_NAME = 'field-scorer-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/app.js',
    '/manifest.json'
];

// Install the Service Worker and Cache the files
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS);
        })
    );
});

// Serve from Cache when Offline
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});