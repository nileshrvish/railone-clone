/**
 * app-chrome.js — everything around the app's own screens: theme switch,
 * connectivity bar, install button, screen wake lock, the storage line on the
 * profile screen, and handing the splash back to the shell once storage is up.
 *
 * It is the composition root for those pieces so index.html keeps one entry
 * point for app chrome, and so each capability module stays independently
 * testable and feature-detected on its own.
 */
import './theme.js';
import { initConnectivity } from './connectivity.js';
import { initInstall } from './install.js';
import { initWakeLock } from './wake-lock.js';
import { initAppLock } from './app-lock.js';
import { ready, storageStatus } from './store.js';

const statusEl = document.getElementById('storage-status');

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return null;
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return 'under 0.1 MB';
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

const DRIVER_TEXT = {
  indexeddb: 'Your profile and tickets are stored on this device (IndexedDB).',
  localstorage: 'IndexedDB is unavailable here, so RailOne is falling back to this browser’s local storage.',
  memory: 'This browser is blocking storage, so anything you add will only last for this session.',
  unavailable: 'Local storage could not be opened on this device.',
};

async function renderStorageStatus() {
  if (!statusEl) return;
  try {
    const status = await storageStatus();
    const parts = [DRIVER_TEXT[status.driver] ?? DRIVER_TEXT.unavailable];

    const used = formatBytes(status.usage);
    if (used) parts.push(`Using ${used}.`);

    if (status.driver === 'indexeddb' || status.driver === 'localstorage') {
      parts.push(status.persisted
        ? 'Storage is marked persistent, so the browser won’t evict it.'
        : 'The browser may clear it if the device runs very low on space.');
    }
    statusEl.textContent = parts.join(' ');
  } catch {
    statusEl.textContent = 'Could not read the storage status on this device.';
  }
}

initConnectivity();
initInstall();
initWakeLock();
initAppLock();

// Keep the number honest whenever the rider opens the screen it lives on.
window.addEventListener('railone:viewchange', (event) => {
  if (event.detail?.view === 'profile') renderStorageStatus();
});

ready().then(() => {
  renderStorageStatus();
  // Storage is open and seeded — the shell can drop the startup screen. One
  // frame later, so the first real paint happens behind the splash, not after.
  requestAnimationFrame(() => window.RailOneApp?.appReady?.());
});
