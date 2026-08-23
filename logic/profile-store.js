/**
 * profile-store.js — persists the rider's profile (name, mobile, age, ID)
 * to data/profile.json. Same connection as bookings-store.js (see
 * data-dir.js) — connecting once from either My Bookings or the profile
 * form covers both.
 */
import { files, isSupported, isConnected, tryConnectSilently, connect } from './data-dir.js';

export { isSupported, isConnected, tryConnectSilently, connect };

const FILE_NAME = 'profile.json';

/** Returns the saved profile, or null if none has been saved yet. */
export async function loadProfile() {
  const parsed = await files.readJSON(FILE_NAME, { profile: null });
  return parsed.profile ?? null;
}

export async function saveProfile(profile) {
  await files.writeJSON(FILE_NAME, { profile });
}

/** Has everything a ticket needs to print (name/age/idType/idNumber). */
export function isProfileComplete(profile) {
  return !!(profile && profile.name && profile.mobile && profile.age && profile.idType && profile.idNumber);
}

/**
 * Best-effort read for rendering — never prompts (no folder picker), never
 * throws. Used whenever a ticket is displayed (booking or reopening one
 * already booked) so it always reflects the *current* profile, live.
 */
export async function loadProfileSafe() {
  if (!isSupported()) return null;
  try {
    if (!isConnected() && !(await tryConnectSilently())) return null;
    return await loadProfile();
  } catch {
    return null;
  }
}
