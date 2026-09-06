/**
 * install.js — the "Install RailOne as an app" button on the profile screen.
 *
 * Chromium fires beforeinstallprompt when the app is installable and lets us
 * stash the event and replay it from a real click; everywhere else (iOS
 * Safari, Firefox) there is no such API, so the button simply never appears
 * and the browser's own install affordance is left to do the job.
 */
import { persistOnEngagement } from './store.js';

const button = document.getElementById('install-app');

let deferredPrompt = null;

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches
    || window.navigator.standalone === true;
}

export function initInstall() {
  if (!button || isInstalled()) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // keep Chrome's mini-infobar out of the way
    deferredPrompt = event;
    button.hidden = false;
  });

  button.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    button.disabled = true;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch (err) {
      console.warn('RailOne: install prompt failed —', err);
    } finally {
      // The event is single-use whatever the rider chose.
      deferredPrompt = null;
      button.hidden = true;
      button.disabled = false;
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    button.hidden = true;
    // An installed app is exactly when browsers are most willing to grant
    // persistent storage, so this is the moment to ask again.
    persistOnEngagement();
  });
}
