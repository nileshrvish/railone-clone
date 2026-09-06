/**
 * fare.js — pure formatting/derivation helpers layered on top of MumbaiRail's
 * quote() output. No DOM, no fetch: safe to import from the browser UI and
 * from the Node test suite alike.
 */

export const ID_TYPES = ['Aadhaar Card', 'PAN Card', 'Driving Licence', 'Voter ID', 'Passport'];

export const TICKET_TYPE_LABELS = {
  single: 'SINGLE',
  return: 'RETURN',
  season_monthly: 'MONTHLY',
  season_quarterly: 'QUARTERLY',
  season_half_yearly: 'HALF YEARLY',
  season_yearly: 'YEARLY',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SERIAL_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';

function pad2(n) { return String(n).padStart(2, '0'); }

/** A ticket serial in the shape already used on the ticket ('X0' + 8 chars). */
export function randomSerial() {
  let s = 'X0';
  for (let i = 0; i < 8; i++) s += SERIAL_CHARS[Math.floor(Math.random() * SERIAL_CHARS.length)];
  return s;
}

/** 'Journey Ticket' for single/return, 'Season Ticket' for any season_* pass. */
export function ticketCategoryLabel(ticketType) {
  return ticketType.startsWith('season') ? 'Season Ticket' : 'Journey Ticket';
}

/** classMinimum for a class, per fare_rules.minimum_fares. */
export function classMinimum(fareRules, cls) {
  return fareRules.minimum_fares[cls];
}

/**
 * total = adults * fare + children * max(fare/2, classMinimum)
 * Returns null (never 0/NaN) when the single-adult fare itself is unpriced.
 */
export function computeTotal(fareInr, adults, children, classMin) {
  if (fareInr == null) return null;
  return adults * fareInr + children * Math.max(fareInr / 2, classMin);
}

/** '------' when the route needs no routing points (direct journey). */
export function viaDisplay(via) {
  return via && via.length ? via : '------';
}

export function passengerLine(adults, children) {
  return `${adults} Adult, ${children} Child`;
}

/** Today's calendar date as YYYY-MM-DD, in local time. */
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Add whole days to a YYYY-MM-DD date, UTC-anchored to dodge DST drift. */
export function addDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isoToDDMMYYYY(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** '14 Aug 2026, 09:52' — the dark-box "Ticket Booking Date & Time" style. */
export function formatBookedLong(d) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** '14/08/2026 09:52' — the ticket-body "Booked on" style. */
export function formatBookedShort(d) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 'Sun, 23 Aug 26' — the My Bookings ticket-card style. */
export function formatCardDate(d) {
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
}

/**
 * *Valid Till date, as YYYY-MM-DD, per fare_rules.ticket_types[*].validity_rule:
 *  - single: same day
 *  - return: booked_on.date + 1 day
 *  - season_*: quote.validTill (already computed by MumbaiRail.quote when a
 *    startDate was passed for a season ticket type)
 */
export function validTillISO({ ticketType, bookedDate, quote }) {
  if (ticketType === 'single') return todayISO(bookedDate);
  if (ticketType === 'return') return addDaysISO(todayISO(bookedDate), 1);
  if (ticketType.startsWith('season')) {
    if (!quote?.validTill) throw new Error('quote.validTill missing for a season ticket');
    return quote.validTill;
  }
  throw new Error(`Unknown ticket type: ${ticketType}`);
}

/**
 * The validity footer printed under a journey ticket, worded per ticket type:
 *
 *  - single: the journey must start within the hour (or on the first train
 *    out), so there is no date to print;
 *  - return: valid until midnight of the *Valid Till date, which is derived
 *    from the booking date by validTillISO() — never a fixed date.
 *
 * Season passes return null: their validity is already printed as the
 * Valid From / *Valid Till rows above, so a footer would repeat it.
 */
export function journeyValidityNote({ ticketType, validTillIso }) {
  if (ticketType === 'single') {
    return '*Valid for start of journey within 1 hour or until departure of the first train.';
  }
  if (ticketType === 'return') {
    return `Valid for one ret. jrny. till midnight of ${isoToDDMMYYYY(validTillIso)}`;
  }
  return null;
}

/**
 * Journey tickets: "{CLASS} | {TRAIN_TYPE} | {TICKET_TYPE} | ₹{total}"
 * Season tickets:  "{TICKET_TYPE} | {TRAIN_TYPE} | {CLASS} | ₹{total}"
 * (order confirmed from real RailOne journey vs. season tickets — they
 * genuinely differ). Explicit unavailable state instead of ₹0/₹null/₹NaN
 * when total is null.
 */
export function fareLine({ cls, trainType, ticketType, total }) {
  const label = TICKET_TYPE_LABELS[ticketType] ?? ticketType.toUpperCase();
  const fareText = total == null ? 'Fare not available' : `₹${total.toFixed(2)}`;
  const parts = ticketType.startsWith('season') ? [label, trainType, cls] : [cls, trainType, label];
  return `${parts.join(' | ')} | ${fareText}`;
}
