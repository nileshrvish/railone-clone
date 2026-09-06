/**
 * sw.js — RailOne's service worker.
 *
 * Two caches, on purpose:
 *  - PRECACHE holds the app shell for one exact version of the app and is
 *    served cache-first. Because every shell file in a given version comes
 *    from the same cache, a running app can never end up with new HTML calling
 *    into old modules (the classic stale-while-revalidate hazard).
 *  - RUNTIME holds whatever else the app asks for at runtime (images that
 *    aren't in the shell, for instance), stale-while-revalidate and capped.
 *
 * Bump CACHE_VERSION whenever any precached file changes. Old caches are
 * dropped on activate; the new worker only takes over when the page says so
 * (see logic/register-sw.js), so an update never swaps files mid-session.
 *
 * The rider's data (profile, bookings) is not this file's business: it lives
 * in IndexedDB (logic/db.js), is never fetched over HTTP, and so survives
 * every cache change and every app update untouched.
 */
const CACHE_VERSION = 'v8';
const PRECACHE = `railone-precache-${CACHE_VERSION}`;
const RUNTIME = `railone-runtime-${CACHE_VERSION}`;
const RUNTIME_MAX_ENTRIES = 60;

/** The shell. A failure here fails the install, which is what we want. */
const CORE_URLS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './mumbai-rail.js',
  './manifest.json',
  './data/mumbai_suburban_rail.json',
  './logic/app-chrome.js',
  './logic/app-lock.js',
  './logic/autocomplete.js',
  './logic/badge.js',
  './logic/bookings.js',
  './logic/bookings-store.js',
  './logic/connectivity.js',
  './logic/db.js',
  './logic/fare.js',
  './logic/feedback-form.js',
  './logic/greeting.js',
  './logic/install.js',
  './logic/prefs.js',
  './logic/profile-form.js',
  './logic/profile-store.js',
  './logic/rail-provider.js',
  './logic/register-sw.js',
  './logic/search-form.js',
  './logic/seed.js',
  './logic/store.js',
  './logic/theme.js',
  './logic/ticket-render.js',
  './logic/toast.js',
  './logic/wake-lock.js',
];

/**
 * Wanted offline, but a missing one must not abandon the install.
 * The italic font is deliberately absent: nothing in the app renders italics,
 * so precaching it would cost 700KB of the rider's data for nothing.
 */
const ASSET_URLS = [
  './data/profile.json',
  './data/bookings.json',
  './fonts/Montserrat/Montserrat-VariableFont_wght.ttf',
  './image/logo.png',
  './image/maskable-icon.svg',
  './image/icon.png',
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
  './image/alert.png',
  './image/back.png',
  './image/filter.png',
  './image/translate.png',
  './image/ticket-hole.svg',
];

const PRECACHED_PATHS = new Set(
  [...CORE_URLS, ...ASSET_URLS].map((url) => new URL(url, self.location).pathname)
);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    await cache.addAll(CORE_URLS);
    // allSettled, not addAll: one missing image shouldn't fail the install.
    await Promise.allSettled(ASSET_URLS.map((url) => cache.add(url)));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Navigation preload is deliberately left off: navigations are answered
    // from the precache below, so a preload fetch would be bandwidth the
    // rider pays for and we then throw away. Disable any left over from an
    // earlier version of this worker.
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.disable().catch(() => {});
    }
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key !== PRECACHE && key !== RUNTIME).map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

// Sent by the page once the rider accepts an update — never taken on our own,
// so a new version can't swap the app out from under someone mid-booking.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function trimRuntime() {
  const cache = await caches.open(RUNTIME);
  const keys = await cache.keys();
  // Oldest first — cache.keys() preserves insertion order.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - RUNTIME_MAX_ENTRIES)).map((k) => cache.delete(k)));
}

/**
 * Navigations are answered from the precached shell, for two reasons:
 *
 *  - consistency: the HTML and every module it imports then come from the same
 *    version of the precache, so a running app can never mix new markup with
 *    old code. A new version arrives only when a new worker activates, which
 *    the page controls (logic/register-sw.js).
 *  - speed: launching the installed app costs no network round trip at all,
 *    online or offline.
 *
 * index.html answers every in-scope URL, which is also what makes the hash
 * routes (#/bookings, and the manifest's app shortcuts) work offline.
 * A hard reload bypasses the worker entirely, so fresh files are always one
 * shift-reload away during development.
 */
async function handleNavigation(event) {
  const cache = await caches.open(PRECACHE);
  const shell = await cache.match('./index.html');
  if (shell) return shell;

  // Nothing precached yet (first visit, install still running).
  try {
    return await fetch(event.request);
  } catch {
    return new Response('Offline, and the app shell is not cached yet.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/** Shell files: cache-first, so one version's assets always agree with each other. */
async function handlePrecached(request) {
  const cached = await caches.match(request, { cacheName: PRECACHE, ignoreSearch: true });
  if (cached) return cached;
  // Not in this version's precache yet (a fresh install still filling up).
  try {
    return await fetch(request);
  } catch {
    return Response.error();
  }
}

/** Everything else same-origin: answer from cache, refresh in the background. */
async function handleRuntime(event) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(event.request);

  const network = fetch(event.request)
    .then(async (response) => {
      if (response.ok) {
        await cache.put(event.request, response.clone()).catch(() => {});
        await trimRuntime();
      }
      return response;
    })
    .catch(() => cached);

  if (cached) {
    // Keep the worker alive long enough to finish the refresh.
    event.waitUntil(network);
    return cached;
  }
  return (await network) ?? Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Range requests (media seeking) must not be answered from a full cached body.
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }
  event.respondWith(
    PRECACHED_PATHS.has(url.pathname) ? handlePrecached(request) : handleRuntime(event)
  );
});
