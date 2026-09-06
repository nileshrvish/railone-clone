/**
 * prefs.js — tiny synchronous settings kept in localStorage.
 *
 * Only for values that are a few bytes, need no transaction, and are cheap to
 * lose: the outcome of the persistent-storage request, first-install and
 * last-opened timestamps. Everything the rider actually owns (profile,
 * bookings) lives in IndexedDB via db.js — never here.
 *
 * Every access is guarded: localStorage throws outright in some private
 * browsing modes, and a preference is never worth breaking a page over.
 */

const PREFIX = 'railone.pref.';

export function getPref(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function setPref(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false; // quota, disabled storage, private mode — never fatal
  }
}

export function removePref(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch { /* nothing to do */ }
}
