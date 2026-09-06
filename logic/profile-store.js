/**
 * profile-store.js — the rider's profile (name, mobile, age, ID), kept on the
 * device in IndexedDB (see db.js) as a single record under the key 'me'.
 *
 * Same record shape as the old data/profile.json, which is what a first launch
 * imports it from (see seed.js).
 */
import { STORES, get, put, del } from './db.js';
import { ready, emitChange, persistOnEngagement } from './store.js';

const KEY = 'me';

/** Returns the saved profile, or null if none has been saved yet. */
export async function loadProfile() {
  await ready();
  return (await get(STORES.PROFILE, KEY)) ?? null;
}

export async function saveProfile(profile) {
  await ready();
  await put(STORES.PROFILE, { ...profile, updatedAt: new Date().toISOString() }, KEY);
  emitChange('profile');
  persistOnEngagement();
}

export async function deleteProfile() {
  await ready();
  await del(STORES.PROFILE, KEY);
  emitChange('profile');
}

/** Has everything a ticket needs to print (name/mobile/age/idType/idNumber). */
export function isProfileComplete(profile) {
  return !!(profile && profile.name && profile.mobile && profile.age && profile.idType && profile.idNumber);
}

/**
 * Best-effort read for rendering — never throws. Used whenever a ticket is
 * displayed (booking one, or reopening one already booked) so it always
 * reflects the *current* profile, live.
 */
export async function loadProfileSafe() {
  try {
    return await loadProfile();
  } catch (err) {
    console.warn('RailOne: could not read the saved profile —', err);
    return null;
  }
}
