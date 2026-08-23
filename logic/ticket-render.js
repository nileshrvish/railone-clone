/**
 * ticket-render.js — fills the *existing* #view-ticket markup with real
 * quote data. Touches only the id'd slots added for this wiring; leaves the
 * countdown timer, booking reference, GSTIN/IR line text and non-transferable
 * notice exactly as they were.
 *
 * Journey tickets (single/return) and season tickets print genuinely
 * different layouts on the real app (confirmed from two real RailOne
 * tickets, not assumed):
 *  - journey: Via | Passenger, then Booked on | *Valid Till, then
 *    "{CLASS} | {TRAIN_TYPE} | {TICKET_TYPE} | fare", then the IR line, then
 *    (return only) the "valid for one ret. jrny." footer.
 *  - season: Via | Booked on, then Valid From | *Valid Till, then
 *    "{TICKET_TYPE} | {TRAIN_TYPE} | {CLASS} | fare", then a Name/Age and
 *    ID Type/ID Number block (from the rider's profile) — no Passenger
 *    line, no IR line, no return footer.
 */
import {
  viaDisplay, passengerLine, formatBookedLong, formatBookedShort,
  validTillISO, isoToDDMMYYYY, returnFooterNote, fareLine, ticketCategoryLabel,
} from './fare.js';
import { isProfileComplete } from './profile-store.js';

/**
 * `serial` is generated once, at booking time (see search-form.js), and
 * passed in here rather than generated fresh on every render — the same
 * ticket must show the same serial whether it's opened right after booking
 * or reopened later from My Bookings. `passenger`, by contrast, is never
 * stored — callers fetch it fresh from the profile every time a ticket is
 * rendered, including a ticket reopened from My Bookings, so it always
 * reflects the current profile rather than whatever it was at booking time.
 */
export function renderTicket({ quote, ticketType, cls, trainType, adults, children, total, bookedAt, serial, passenger }) {
  const $ = (id) => document.getElementById(id);
  const isSeason = ticketType.startsWith('season');

  $('dt-heading').textContent = ticketCategoryLabel(ticketType);
  $('dt-serial').textContent = serial;
  $('dt-origin').textContent = quote.from.name.toUpperCase();
  $('dt-dest').textContent = quote.to.name.toUpperCase();
  $('dt-km').textContent = `—${quote.chargeableKm} km—`;
  $('dt-via').textContent = viaDisplay(quote.via);
  $('dt-booked-long').textContent = formatBookedLong(bookedAt);

  const bookedText = formatBookedShort(bookedAt);
  const validIso = validTillISO({ ticketType, bookedDate: bookedAt, quote });
  $('dt-validtill').textContent = `${isoToDDMMYYYY(validIso)} 23:59`;

  if (isSeason) {
    $('dt-row1b-label').textContent = 'Booked on';
    $('dt-row1b-value').textContent = bookedText;
    $('dt-row2a-label').textContent = 'Valid From';
    $('dt-row2a-value').textContent = isoToDDMMYYYY(quote.validFrom);
  } else {
    $('dt-row1b-label').textContent = 'Passenger';
    $('dt-row1b-value').textContent = passengerLine(adults, children);
    $('dt-row2a-label').textContent = 'Booked on';
    $('dt-row2a-value').textContent = bookedText;
  }

  $('dt-fare-line').textContent = fareLine({ cls, trainType, ticketType, total });
  $('dt-ir-line').hidden = isSeason;

  const identityEl = $('dt-identity');
  if (isSeason && isProfileComplete(passenger)) {
    $('dt-p-name').textContent = passenger.name.toUpperCase();
    $('dt-p-age').textContent = `${passenger.age} years`;
    $('dt-p-idtype').textContent = passenger.idType;
    $('dt-p-idnumber').textContent = passenger.idNumber;
    identityEl.hidden = false;
  } else {
    identityEl.hidden = true;
  }

  const noteEl = $('dt-valid-note');
  if (ticketType === 'return') {
    noteEl.textContent = returnFooterNote(validIso);
    noteEl.hidden = false;
  } else {
    noteEl.hidden = true;
  }

  // Header "Mobile: …" and "Thank You {name}, Happy Journey!" — only
  // overwritten when we actually have a name/mobile to show, so a ticket
  // booked without a profile leaves whatever was already there untouched.
  if (passenger?.mobile) $('dt-mobile').textContent = `Mobile: ${passenger.mobile}`;
  if (passenger?.name) $('dt-thankyou-name').textContent = passenger.name;
}
