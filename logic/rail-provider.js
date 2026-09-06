/**
 * rail-provider.js — builds MumbaiRail exactly once, at module scope, and
 * shares that single instance with anyone who imports getRail(). MumbaiRail
 * builds an index + graph on construction, so it must not be constructed per
 * render or per request.
 *
 * The network JSON is read from local storage first and only fetched when the
 * device doesn't have it yet, so the planner works offline even if the service
 * worker's cache has been evicted. It's static app data, not the rider's, so a
 * newer bundled version (data/mumbai_suburban_rail.json, meta.version) quietly
 * replaces the stored copy in the background and is picked up next launch.
 */
import { MumbaiRail } from '../mumbai-rail.js';
import { STORES, get, put } from './db.js';
import { ready } from './store.js';

const DATASET_KEY = 'mumbai-rail';
const SOURCE_URL = './data/mumbai_suburban_rail.json';

let railPromise = null;

async function readStored() {
  try {
    await ready();
    return (await get(STORES.DATASETS, DATASET_KEY)) ?? null;
  } catch {
    return null; // storage unavailable — the fetch below still works
  }
}

async function fetchSource() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`Failed to load network data: ${response.status}`);
  return response.json();
}

async function store(data) {
  try {
    await put(STORES.DATASETS, { version: data?.meta?.version ?? null, savedAt: new Date().toISOString(), data }, DATASET_KEY);
  } catch (err) {
    console.warn('RailOne: could not cache the rail network locally —', err);
  }
}

function refreshInBackground(storedVersion) {
  fetchSource()
    .then((fresh) => ((fresh?.meta?.version ?? null) === storedVersion ? null : store(fresh)))
    .catch(() => { /* offline, or the file is gone: the stored copy stands */ });
}

async function loadNetworkData() {
  const stored = await readStored();
  if (stored?.data) {
    refreshInBackground(stored.version ?? null);
    return stored.data;
  }
  const fresh = await fetchSource();
  await store(fresh);
  return fresh;
}

export function getRail() {
  if (!railPromise) {
    railPromise = loadNetworkData().then((data) => MumbaiRail.fromJSON(data));
  }
  return railPromise;
}
