/**
 * data-dir.js — the shared File System Access connection to the project's
 * data/ folder. Both bookings-store.js and profile-store.js read/write
 * their own file through this one connection, so the user is only ever
 * asked to grant folder access once, no matter which feature asks first.
 *
 * Two things the API itself requires, not a design choice made here:
 *  - showDirectoryPicker()/requestPermission() must run inside a real user
 *    gesture (a click) — a page can never silently pop the folder picker.
 *  - the only place a FileSystemDirectoryHandle can be kept *across page
 *    loads* is IndexedDB (structured-clone storage). That's just a cache
 *    for the permission grant — actual data lives only in the JSON files
 *    themselves, never in IndexedDB.
 *
 * Chromium-only (Chrome/Edge) — Firefox and Safari don't implement this API.
 */

const DB_NAME = 'railone-fs-handles';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'data-dir';

let connectedHandle = null;

export function isSupported() {
  return typeof window.showDirectoryPicker === 'function';
}

export function isConnected() {
  return connectedHandle != null;
}

function openHandleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getSavedHandle() {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function persistHandle(handle) {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Reuse a previously-granted folder handle WITHOUT prompting. Only works
 * when the browser still reports 'granted' for it outright — safe to call
 * on every page load, gesture or not.
 */
export async function tryConnectSilently() {
  if (connectedHandle) return true;
  if (!isSupported()) return false;
  const handle = await getSavedHandle().catch(() => null);
  if (!handle) return false;
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') return false;
  connectedHandle = handle;
  return true;
}

/**
 * Must be called from inside a user gesture. Reuses a saved handle if its
 * permission can be re-requested; otherwise shows the native folder picker.
 */
export async function connect() {
  if (connectedHandle) return;
  if (!isSupported()) throw new Error('FS_ACCESS_UNSUPPORTED');

  let handle = await getSavedHandle().catch(() => null);
  if (handle) {
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted' || (await handle.requestPermission({ mode: 'readwrite' })) === 'granted') {
      connectedHandle = handle;
      return;
    }
  }

  handle = await window.showDirectoryPicker({ id: 'railone-data', mode: 'readwrite' });
  // If the user picked the project root (or anywhere with a "data" subfolder
  // already in it) rather than data/ itself, descend into it automatically.
  try {
    handle = await handle.getDirectoryHandle('data', { create: false });
  } catch { /* they picked data/ directly, or a folder with no such child — use as-is */ }

  await persistHandle(handle);
  connectedHandle = handle;
}

async function readJSON(fileName, fallback) {
  if (!connectedHandle) throw new Error('STORAGE_NOT_CONNECTED');
  try {
    const fileHandle = await connectedHandle.getFileHandle(fileName, { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    return text.trim() ? JSON.parse(text) : fallback;
  } catch (err) {
    if (err.name === 'NotFoundError') return fallback;
    throw err;
  }
}

async function writeJSON(fileName, data) {
  if (!connectedHandle) throw new Error('STORAGE_NOT_CONNECTED');
  const fileHandle = await connectedHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

export const files = { readJSON, writeJSON };
