/**
 * db.js — RailOne's local storage engine.
 *
 * IndexedDB is the primary driver: it needs no permission prompt, no user
 * gesture, survives reloads and browser restarts, and holds structured
 * records. When it isn't available at all (private windows, storage disabled,
 * an old WebKit bug where open() never settles) we transparently fall back to
 * a localStorage-backed driver, and finally to memory, so the app keeps
 * working instead of throwing.
 *
 * This module knows nothing about bookings or profiles — see store.js for the
 * app-level wiring, and bookings-store.js / profile-store.js for the domain
 * APIs. Nothing stored here ever leaves the device.
 */

const DB_NAME = 'railone';
const DB_VERSION = 1;
const OPEN_TIMEOUT_MS = 4000;

export const STORES = {
  META: 'meta',         // bookkeeping: seed flags, data version, timestamps
  PROFILE: 'profile',   // the rider's profile, a single record under 'me'
  BOOKINGS: 'bookings',
  DATASETS: 'datasets', // local copy of the static rail-network JSON
};

/**
 * keyPath: null means out-of-line keys — the caller passes the key to put().
 * The fallback driver reads this too, so both drivers agree on how a record
 * is addressed.
 */
const STORE_CONFIG = {
  [STORES.META]: { keyPath: null },
  [STORES.PROFILE]: { keyPath: null },
  [STORES.BOOKINGS]: { keyPath: 'serial', indexes: { byValidTill: 'validTill' } },
  [STORES.DATASETS]: { keyPath: null },
};

/**
 * Schema migrations, one per database version, run inside onupgradeneeded.
 * To evolve the schema: append a function here and bump DB_VERSION — never
 * edit an existing entry, because browsers that already ran it won't run it
 * again. Records already on the device are left untouched unless a migration
 * moves them (see DATA_MIGRATIONS in store.js for record-shape changes).
 */
const SCHEMA_MIGRATIONS = [
  // v0 -> v1: initial schema
  (db) => {
    for (const [name, config] of Object.entries(STORE_CONFIG)) {
      const store = db.createObjectStore(name, config.keyPath ? { keyPath: config.keyPath } : undefined);
      for (const [indexName, path] of Object.entries(config.indexes ?? {})) {
        store.createIndex(indexName, path);
      }
    }
  },
];

/** Normalises whatever a driver threw into an Error carrying a stable `code`. */
export function storageError(err, message) {
  const quota = err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_FILE_NO_DEVICE_SPACE');
  const error = new Error(message ?? (quota ? 'Device storage is full.' : 'Local storage failed.'), { cause: err });
  error.code = quota ? 'QUOTA_EXCEEDED' : 'STORAGE_ERROR';
  return error;
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }

    // Guards the rare case where open() never settles at all.
    const timer = setTimeout(() => reject(new Error('IDB_OPEN_TIMEOUT')), OPEN_TIMEOUT_MS);

    request.onupgradeneeded = (event) => {
      for (let version = event.oldVersion; version < DB_VERSION; version++) {
        SCHEMA_MIGRATIONS[version](request.result, request.transaction, event.oldVersion);
      }
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      // Another tab is upgrading the schema: close so it isn't blocked.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error);
    };
    // Not fatal: an older tab still holds the DB open. Its onversionchange
    // (above) closes it, and onsuccess follows — so stop the timeout rather
    // than falling back to a second driver while the real one is on its way.
    request.onblocked = () => {
      clearTimeout(timer);
      console.warn('RailOne: storage upgrade is waiting on another tab.');
    };
  });
}

function putRequest(objectStore, value, key) {
  return key === undefined ? objectStore.put(value) : objectStore.put(value, key);
}

function createIdbDriver(db) {
  function run(storeName, mode, work) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(storeName, mode);
      } catch (err) {
        reject(err);
        return;
      }
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('TRANSACTION_ABORTED'));
      Promise.resolve(work(tx.objectStore(storeName)))
        .then((value) => { result = value; })
        .catch((err) => {
          try { tx.abort(); } catch { /* already finished */ }
          reject(err);
        });
    });
  }

  return {
    name: 'indexeddb',
    get: (store, key) => run(store, 'readonly', (os) => requestAsPromise(os.get(key))),
    getAll: (store) => run(store, 'readonly', (os) => requestAsPromise(os.getAll())),
    count: (store) => run(store, 'readonly', (os) => requestAsPromise(os.count())),
    // put(value, key) is a DataError on a store with a keyPath, so only pass
    // the key when there actually is one.
    put: (store, value, key) => run(store, 'readwrite', (os) => requestAsPromise(putRequest(os, value, key))),
    // One transaction for the whole batch: either every record lands or none does.
    putMany: (store, entries) => run(store, 'readwrite', (os) => Promise.all(
      entries.map(({ value, key }) => requestAsPromise(putRequest(os, value, key)))
    )),
    del: (store, key) => run(store, 'readwrite', (os) => requestAsPromise(os.delete(key))),
    clear: (store) => run(store, 'readwrite', (os) => requestAsPromise(os.clear())),
  };
}

function localStorageUsable() {
  try {
    const probe = 'railone.probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * The same interface as the IndexedDB driver, backed by one JSON blob per
 * store in localStorage (or plain memory when even that is blocked). Small
 * data only — which is exactly what this app keeps — so "IndexedDB is
 * unavailable" degrades to "still works", not to a broken app.
 */
function createFallbackDriver() {
  const cache = new Map();
  const persistent = localStorageUsable();
  const lsKey = (store) => `railone.fallback.${store}`;

  function read(store) {
    if (!cache.has(store)) {
      let parsed = {};
      if (persistent) {
        try { parsed = JSON.parse(localStorage.getItem(lsKey(store)) || '{}'); } catch { parsed = {}; }
      }
      cache.set(store, parsed);
    }
    return cache.get(store);
  }

  function write(store, records) {
    cache.set(store, records);
    if (persistent) localStorage.setItem(lsKey(store), JSON.stringify(records));
  }

  const keyFor = (store, value, key) => String(key ?? value?.[STORE_CONFIG[store].keyPath]);

  return {
    name: persistent ? 'localstorage' : 'memory',
    async get(store, key) { return read(store)[String(key)]; },
    async getAll(store) { return Object.values(read(store)); },
    async count(store) { return Object.keys(read(store)).length; },
    async put(store, value, key) {
      write(store, { ...read(store), [keyFor(store, value, key)]: value });
    },
    async putMany(store, entries) {
      const records = { ...read(store) };
      for (const { value, key } of entries) records[keyFor(store, value, key)] = value;
      write(store, records);
    },
    async del(store, key) {
      const records = { ...read(store) };
      delete records[String(key)];
      write(store, records);
    },
    async clear(store) { write(store, {}); },
  };
}

let driverPromise = null;

/** Resolves to the active driver, opening (and if needed downgrading) once. */
export function getDriver() {
  if (!driverPromise) {
    driverPromise = (async () => {
      if (typeof indexedDB === 'undefined') return createFallbackDriver();
      try {
        return createIdbDriver(await openDatabase());
      } catch (err) {
        console.warn('RailOne: IndexedDB unavailable, using fallback storage —', err);
        return createFallbackDriver();
      }
    })();
  }
  return driverPromise;
}

export async function driverName() {
  return (await getDriver()).name;
}

/**
 * Runs one operation against the live driver. If the connection was closed
 * under us — which is exactly what happens when another tab upgrades the
 * schema — reopen and try once more before giving up.
 */
async function withDriver(operation) {
  try {
    return await operation(await getDriver());
  } catch (err) {
    if (err?.name !== 'InvalidStateError') throw err;
    driverPromise = null;
    return operation(await getDriver());
  }
}

// ---- Thin pass-throughs so callers never juggle the driver themselves ----

export async function get(store, key) {
  try { return await withDriver((driver) => driver.get(store, key)); }
  catch (err) { throw storageError(err, `Could not read ${store}.`); }
}

export async function getAll(store) {
  try { return await withDriver((driver) => driver.getAll(store)); }
  catch (err) { throw storageError(err, `Could not read ${store}.`); }
}

export async function count(store) {
  try { return await withDriver((driver) => driver.count(store)); }
  catch (err) { throw storageError(err, `Could not read ${store}.`); }
}

export async function put(store, value, key) {
  try { return await withDriver((driver) => driver.put(store, value, key)); }
  catch (err) { throw storageError(err, `Could not save to ${store}.`); }
}

export async function putMany(store, entries) {
  if (!entries.length) return undefined;
  try { return await withDriver((driver) => driver.putMany(store, entries)); }
  catch (err) { throw storageError(err, `Could not save to ${store}.`); }
}

export async function del(store, key) {
  try { return await withDriver((driver) => driver.del(store, key)); }
  catch (err) { throw storageError(err, `Could not delete from ${store}.`); }
}

export async function clear(store) {
  try { return await withDriver((driver) => driver.clear(store)); }
  catch (err) { throw storageError(err, `Could not clear ${store}.`); }
}
