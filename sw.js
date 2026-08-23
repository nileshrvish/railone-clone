/**
 * sw.js — RailOne's service worker. Precaches the app shell so the app
 * still opens (and the previously-loaded rail network data still works)
 * without a connection, and keeps the cache fresh in the background.
 *
 * Bump CACHE_NAME whenever the precached file list changes — the old cache
 * is dropped on activate.
 *
 * Deliberately does NOT touch data/bookings.json or data/profile.json:
 * those are never fetched over HTTP at all — they're read/written directly
 * on disk via the File System Access API, so this service worker never
 * sees those requests and can't go stale on real booking/profile data.
 */
const CACHE_NAME = 'railone-v1';

const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './mumbai-rail.js',
  './manifest.json',
  './data/mumbai_suburban_rail.json',
  './logic/autocomplete.js',
  './logic/bookings.js',
  './logic/bookings-store.js',
  './logic/data-dir.js',
  './logic/fare.js',
  './logic/feedback-form.js',
  './logic/greeting.js',
  './logic/profile-form.js',
  './logic/profile-store.js',
  './logic/rail-provider.js',
  './logic/register-sw.js',
  './logic/search-form.js',
  './logic/ticket-render.js',
  './fonts/Montserrat/Montserrat-VariableFont_wght.ttf',
  './fonts/Montserrat/Montserrat-Italic-VariableFont_wght.ttf',
  './image/logo.png',
  './image/Railone1.png',
  './image/Railone2.png',
  './image/Railone3.png',
  './image/map.png',
  './image/booked.png',
  './image/train.png',
  './image/orang-train.png',
  './image/burger.png',
  './image/refund.png',
  './image/hand.png',
  './image/doc.png',
  './image/diamond.png',
  './image/enhanced_qr.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate: answer instantly from cache when we have it, while
// still fetching in the background to keep the cache current for next time.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
