// CHANGE THIS NUMBER EVERY TIME YOU UPDATE THE APP CODE
const CACHE_NAME = 'field-app-v1.3'; 

const ASSETS = [
    './',
    './index.html',
    './app.js',
    './manifest.json'
];

// Step 1: Install new cache
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('Opened cache');
            return cache.addAll(ASSETS);
        })
    );
    // Force the new version to take over immediately
    self.skipWaiting(); 
});

// Step 2: Clear old caches (THIS is what saves your data!)
// It deletes the old HTML/JS cache, but NEVER touches localStorage
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    // Take control of the browser immediately
    self.clients.claim();
});

// Step 3: Serve from cache, fallback to network
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});
