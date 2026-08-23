/**
 * bookings-store.js — persists booked tickets to data/bookings.json.
 * Connection (folder picker, IndexedDB handle cache) lives in data-dir.js,
 * shared with profile-store.js so the user is only asked once.
 */
import { files } from './data-dir.js';

export { isSupported, isConnected, tryConnectSilently, connect } from './data-dir.js';

const FILE_NAME = 'bookings.json';

async function readAll() {
  const parsed = await files.readJSON(FILE_NAME, { bookings: [] });
  return Array.isArray(parsed.bookings) ? parsed.bookings : [];
}

/** Appends one record (newest-first) and writes the whole file back. */
export async function saveBooking(record) {
  const bookings = await readAll();
  bookings.unshift(record);
  await files.writeJSON(FILE_NAME, { bookings });
}

/**
 * Reads the file, drops any record whose validTill has passed, rewrites the
 * file only if something was actually removed, and returns what's left
 * (newest-first, same order as stored).
 */
export async function pruneExpired(nowMs = Date.now()) {
  const bookings = await readAll();
  const kept = bookings.filter((b) => new Date(b.validTill + 'T23:59:59').getTime() >= nowMs);
  if (kept.length !== bookings.length) await files.writeJSON(FILE_NAME, { bookings: kept });
  return kept;
}
