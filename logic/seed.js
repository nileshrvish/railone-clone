/**
 * seed.js — first-launch import of the bundled data/*.json files into local
 * storage.
 *
 * The rules that matter:
 *  - a source is imported at most once, ever. A `seed:<source>` marker in the
 *    meta store records that decision, so a rider who edits or deletes their
 *    data never gets the shipped sample JSON pushed back on top of it on the
 *    next launch;
 *  - a store that already holds records is never touched — it's marked as
 *    seeded and skipped;
 *  - a network failure leaves no marker, so an install that first ran offline
 *    can still pick the JSON up on a later launch. A 404 does leave one: the
 *    file is gone on purpose, there is nothing to wait for.
 */
import { STORES, get, put, putMany, count } from './db.js';

const markerKey = (source) => `seed:${source}`;

async function alreadyDecided(source) {
  try {
    return (await get(STORES.META, markerKey(source))) != null;
  } catch {
    return true; // can't read storage — don't risk importing on top of data
  }
}

function mark(source, outcome, imported = 0) {
  return put(STORES.META, { source, outcome, imported, at: new Date().toISOString() }, markerKey(source));
}

/** Reads a bundled JSON file. null = fetched but unusable, undefined = offline/failed. */
async function readBundledJson(url) {
  let response;
  try {
    response = await fetch(url);
  } catch {
    return undefined; // offline or blocked — retry on a later launch
  }
  if (!response.ok) return null; // 404 and friends: a definitive "nothing here"
  try {
    return await response.json();
  } catch {
    return null; // malformed file — no point retrying it
  }
}

async function seedSource(source, storeName, url, importer) {
  if (await alreadyDecided(source)) return;

  if (await count(storeName) > 0) {
    await mark(source, 'skipped-existing');
    return;
  }

  const json = await readBundledJson(url);
  if (json === undefined) return;                       // try again next launch
  if (json === null) return void mark(source, 'unusable');

  const imported = await importer(json);
  await mark(source, 'imported', imported);
}

async function importProfile(json) {
  const profile = json?.profile;
  if (!profile || typeof profile !== 'object') return 0;
  await put(STORES.PROFILE, { ...profile, updatedAt: new Date().toISOString() }, 'me');
  return 1;
}

async function importBookings(json) {
  const records = Array.isArray(json?.bookings) ? json.bookings.filter((b) => b && b.serial) : [];
  await putMany(STORES.BOOKINGS, records.map((value) => ({ value })));
  return records.length;
}

/**
 * Records a "don't ever import this again" marker for every source. Used when
 * the rider deletes their data on purpose — without it, the next launch would
 * see empty stores and helpfully restore the shipped sample data.
 */
export async function markSourcesConsumed(outcome = 'cleared-by-user') {
  await Promise.allSettled([mark('profile', outcome), mark('bookings', outcome)]);
}

/**
 * Runs once per launch, right after the database opens. Errors are swallowed
 * deliberately: a failed seed must never stop the app from starting.
 */
export async function seedIfNeeded() {
  const jobs = [
    seedSource('profile', STORES.PROFILE, './data/profile.json', importProfile),
    seedSource('bookings', STORES.BOOKINGS, './data/bookings.json', importBookings),
  ];
  for (const result of await Promise.allSettled(jobs)) {
    if (result.status === 'rejected') console.warn('RailOne: initial data import skipped —', result.reason);
  }
}
