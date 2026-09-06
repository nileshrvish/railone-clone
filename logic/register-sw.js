/**
 * register-sw.js — registers sw.js so RailOne can be installed as a PWA and
 * opened offline, and owns how updates reach the rider.
 *
 * Update policy, in two cases:
 *  - a worker that has been *waiting since a previous visit* is adopted at
 *    launch. Nothing is in flight that early, so the single reload is invisible.
 *  - a worker that finishes installing *while the app is open* is never forced.
 *    The rider gets a toast and decides when to reload, so an update can't
 *    interrupt a booking half-way through.
 *
 * The URL is resolved against the document, not this module, so the scope
 * stays right whether the app is served from the site root or a subfolder.
 */
import { showToast } from './toast.js';

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first registration fires this too (clients.claim); only a real
    // version swap needs the page reloaded onto the new assets.
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  const offerUpdate = (worker) => {
    showToast('A new version of RailOne is ready.', {
      actionLabel: 'Reload',
      duration: 0, // stays until the rider decides
      onAction: () => worker.postMessage({ type: 'SKIP_WAITING' }),
    });
  };

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');

      // Waiting since a previous session: take it now, before anything is typed.
      if (registration.waiting && hadController) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // "installed" with a controller present means an update is ready and
          // waiting; without one it's just the very first install completing.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            offerUpdate(installing);
          }
        });
      });

      registration.update().catch(() => { /* offline — the cached app is fine */ });
    } catch (err) {
      console.warn('RailOne: service worker registration failed —', err);
    }
  });
}
