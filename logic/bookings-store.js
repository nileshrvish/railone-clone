/**
 * bookings-store.js — booked tickets, kept on the device in IndexedDB
 * (see db.js) under the 'bookings' store, keyed by the ticket serial.
 *
 * Records are the same shape that used to be written to data/bookings.json,
 * so nothing downstream had to change: serial, ticketType, cls, trainType,
 * adults, children, total, bookedAt (ISO), validTill (ISO date), quote.
 * Passenger identity is deliberately never stored on a ticket — it is read
 * live from the profile every time a ticket is rendered.
 */
import { STORES, getAll, put, del, clear } from './db.js';
import { ready, emitChange, persistOnEngagement } from './store.js';

/** Newest first, matching the order the UI renders and prepends in. */
function newestFirst(records) {
  return records.sort((a, b) => String(b.bookedAt).localeCompare(String(a.bookedAt)));
}

function isExpired(record, nowMs) {
  const till = new Date(record.validTill + 'T23:59:59').getTime();
  return Number.isFinite(till) && till < nowMs;
}

export async function listBookings() {
  await ready();
  return newestFirst(await getAll(STORES.BOOKINGS));
}

/** Adds (or replaces, by serial) one booking. */
export async function saveBooking(record) {
  await ready();
  await put(STORES.BOOKINGS, record);
  emitChange('bookings');
  persistOnEngagement(); // a booked ticket is worth asking to keep for good
}

export async function deleteBooking(serial) {
  await ready();
  await del(STORES.BOOKINGS, serial);
  emitChange('bookings');
}

/**
 * Drops every record whose validity has passed and returns what's left,
 * newest first. Writes only when something actually expired.
 */
export async function pruneExpired(nowMs = Date.now()) {
  await ready();
  const all = await getAll(STORES.BOOKINGS);
  const expired = all.filter((record) => isExpired(record, nowMs));

  if (expired.length) {
    await Promise.all(expired.map((record) => del(STORES.BOOKINGS, record.serial)));
    emitChange('bookings');
  }
  return newestFirst(all.filter((record) => !isExpired(record, nowMs)));
}

export async function clearBookings() {
  await ready();
  await clear(STORES.BOOKINGS);
  emitChange('bookings');
}
