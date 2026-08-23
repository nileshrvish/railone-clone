/**
 * register-sw.js — registers sw.js so RailOne can be installed as a PWA.
 * Root-absolute path so scope/resolution never depends on where this
 * module itself happens to be loaded from.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('RailOne: service worker registration failed —', err);
    });
  });
}
