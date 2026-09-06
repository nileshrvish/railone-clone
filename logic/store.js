/**
 * store.js — the app-level front door to local storage.
 *
 * Owns the one-time start-up sequence (open the database, run any data
 * migrations, import the bundled JSON on a first launch, ask for persistent
 * storage), plus the cross-tab change notifications and the small maintenance
 * helpers. Domain reads and writes live in bookings-store.js and
 * profile-store.js; both await ready() before touching anything.
 *
 * Nothing here talks to a network except the one-time seed read of the app's
 * own bundled data/*.json files.
 */
import { STORES, get, put, clear, driverName } from './db.js';
import { seedIfNeeded, markSourcesConsumed } from './seed.js';
import { getPref, setPref } from './prefs.js';

/**
 * Version of the *record shapes* (as opposed to the database schema, which
 * db.js versions). Bump it and append a migration below whenever a stored
 * record needs rewriting; migrations run in order, on the device, exactly
 * once, and never discard data they don't understand.
 */
const DATA_VERSION = 1;
const DATA_VERSION_KEY = 'dataVersion';

const DATA_MIGRATIONS = {
  // Example of the shape future changes take:
  // 1: async () => { /* rewrite v1 records into v2 */ },
};

const CHANNEL_NAME = 'railone-store';
const PING_KEY = 'railone.change-ping';

let readyPromise = null;
let channel = null;
const listeners = new Set();

// ------------------------------------------------------------- change events

function setUpChannel() {
  if (typeof BroadcastChannel === 'function') {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => notify(event.data);
      return;
    } catch { /* fall through to the storage-event route */ }
  }
  // Older browsers: a localStorage write fires `storage` in *other* tabs only,
  // which is exactly the semantics BroadcastChannel gives us.
  window.addEventListener('storage', (event) => {
    if (event.key !== PING_KEY || !event.newValue) return;
    try { notify(JSON.parse(event.newValue)); } catch { /* ignore malformed ping */ }
  });
}

function notify(message) {
  if (!message || !message.kind) return;
  for (const listener of listeners) {
    try { listener(message); } catch (err) { console.warn('RailOne: change listener failed —', err); }
  }
}

/**
 * Tells other tabs/windows that `kind` ('bookings' | 'profile') changed.
 * Deliberately does not fire in the tab that made the change — that tab has
 * already updated its own DOM.
 */
export function emitChange(kind) {
  const message = { kind, at: Date.now() };
  if (channel) {
    try { channel.postMessage(message); return; } catch { /* fall through */ }
  }
  try { localStorage.setItem(PING_KEY, JSON.stringify(message)); } catch { /* no cross-tab sync then */ }
}

/** Subscribe to changes made in other tabs. Returns an unsubscribe function. */
export function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ------------------------------------------------------------ persistence

/**
 * Asks the browser to make this origin's storage persistent, so it isn't
 * evicted under pressure. Asked at most once per install: some browsers show
 * a permission prompt for it, and the app works fine either way.
 * Returns 'persisted' | 'best-effort' | 'unsupported'.
 */
export async function ensurePersistentStorage({ force = false } = {}) {
  if (!navigator.storage?.persist || !navigator.storage?.persisted) return 'unsupported';
  try {
    if (await navigator.storage.persisted()) {
      setPref('persistence', 'persisted');
      return 'persisted';
    }
    if (!force && getPref('persistence') != null) return getPref('persistence');

    const granted = await navigator.storage.persist();
    const outcome = granted ? 'persisted' : 'best-effort';
    setPref('persistence', outcome);
    return outcome;
  } catch {
    return 'unsupported'; // never fatal: eviction is unlikely and recoverable
  }
}

let engagementAttempt = null;

/**
 * Re-asks for persistent storage after a strong engagement signal — a saved
 * booking or profile, or the app being installed. Browsers weigh engagement
 * and installation when deciding, so the answer at first launch is often "no"
 * while the answer after a real action is "yes". Once per session, and never
 * when it is already granted.
 */
export function persistOnEngagement() {
  if (!engagementAttempt) {
    engagementAttempt = (async () => {
      if (getPref('persistence') === 'persisted') return 'persisted';
      return ensurePersistentStorage({ force: true });
    })().catch(() => 'unsupported');
  }
  return engagementAttempt;
}

// ------------------------------------------------------------- start-up

async function runDataMigrations() {
  const from = (await get(STORES.META, DATA_VERSION_KEY)) ?? null;
  if (from === DATA_VERSION) return;

  // A brand-new install has nothing to migrate — it is current by definition.
  for (let version = from ?? DATA_VERSION; version < DATA_VERSION; version++) {
    const migrate = DATA_MIGRATIONS[version];
    if (migrate) await migrate();
  }
  await put(STORES.META, DATA_VERSION, DATA_VERSION_KEY);
}

async function init() {
  setUpChannel();
  await driverName();          // opens the database (or picks the fallback)
  await runDataMigrations();
  await seedIfNeeded();        // first launch only; a no-op afterwards

  const now = new Date().toISOString();
  if (!getPref('installedAt')) setPref('installedAt', now);
  setPref('lastOpenedAt', now);

  // Not awaited: nothing downstream depends on the answer.
  ensurePersistentStorage().catch(() => {});
}

/**
 * Resolves once local storage is open, migrated and seeded. Safe to await from
 * anywhere, any number of times — the work happens once. It resolves even when
 * storage is degraded; callers get their errors from the individual reads and
 * writes instead.
 */
export function ready() {
  if (!readyPromise) {
    readyPromise = init().catch((err) => {
      console.warn('RailOne: local storage start-up problem —', err);
    });
  }
  return readyPromise;
}

// ------------------------------------------------------------- maintenance

/** Diagnostics: which driver is live, whether storage is persistent, usage. */
export async function storageStatus() {
  const status = {
    driver: await driverName().catch(() => 'unavailable'),
    persisted: false,
    usage: null,
    quota: null,
    installedAt: getPref('installedAt'),
  };
  try {
    if (navigator.storage?.persisted) status.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      status.usage = estimate.usage ?? null;
      status.quota = estimate.quota ?? null;
    }
  } catch { /* estimates are a nicety */ }
  return status;
}

/**
 * Deletes everything the rider owns, and marks the bundled JSON as consumed so
 * the next launch doesn't cheerfully restore it.
 */
export async function clearAllData() {
  await ready();
  await clear(STORES.PROFILE);
  await clear(STORES.BOOKINGS);
  await markSourcesConsumed();
  emitChange('profile');
  emitChange('bookings');
}

// A small, deliberate handle for inspecting or clearing local data from the
// console — no UI depends on it, and nothing is sent anywhere.
if (typeof window !== 'undefined') {
  window.RailOneStorage = { ready, storageStatus, clearAllData, ensurePersistentStorage };
}

ready();
