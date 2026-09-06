/**
 * bookings.js — the My Bookings "Upcoming" list: renders ticket-cards using
 * the existing markup/classes exactly (no new styling), restores previously
 * saved tickets from local storage on load, persists new ones there, and
 * removes cards live once their validity has passed.
 *
 * The pre-existing static mock card (BHAYANDAR — GHANSOLI) is never touched;
 * it isn't part of the store (it carries no data-serial) and stays exactly as
 * it was.
 */
import { renderTicket } from './ticket-render.js';
import { getRail } from './rail-provider.js';
import { TICKET_TYPE_LABELS, formatCardDate, validTillISO } from './fare.js';
import * as store from './bookings-store.js';
import { loadProfileSafe } from './profile-store.js';
import { onChange } from './store.js';
import { setTicketBadge } from './badge.js';
import { showToast } from './toast.js';

const bookingsList = document.getElementById('bookings-list');
const bookingsCount = document.getElementById('bookings-count');

const EXPIRY_CHECK_MS = 60 * 1000;

function maskedUts(serial) {
  return `${serial[0]}${'█'.repeat(5)}`;
}

function updateUpcomingCount() {
  const total = bookingsList.querySelectorAll('.ticket-card').length;
  const activeTab = document.querySelector('.tab-item.active');
  if (activeTab && activeTab.getAttribute('data-tab-switch') === 'upcoming') {
    bookingsCount.textContent = `Upcoming (${total})`;
  }
  // Installed app icon carries the live ticket count.
  setTicketBadge(bookingsList.querySelectorAll('.ticket-card[data-serial]').length);
}

function toRecord(ticket) {
  return {
    serial: ticket.serial,
    ticketType: ticket.ticketType,
    cls: ticket.cls,
    trainType: ticket.trainType,
    adults: ticket.adults,
    children: ticket.children,
    total: ticket.total,
    bookedAt: ticket.bookedAt.toISOString(),
    validTill: validTillISO({ ticketType: ticket.ticketType, bookedDate: ticket.bookedAt, quote: ticket.quote }),
    quote: ticket.quote,
    // No passenger/profile fields here, deliberately — a ticket's identity
    // block always reflects the *current* profile, fetched live wherever
    // it's rendered (see the View Details handler below), never a snapshot.
  };
}

function fromRecord(record) {
  return {
    serial: record.serial,
    ticketType: record.ticketType,
    cls: record.cls,
    trainType: record.trainType,
    adults: record.adults,
    children: record.children,
    total: record.total,
    bookedAt: new Date(record.bookedAt),
    quote: record.quote,
  };
}

/**
 * Tickets saved before quotes carried routeCount still deserve the Via prefix.
 * The count depends only on the network, so it can be looked up on reopen
 * rather than migrated into every stored record.
 */
async function withRouteCount(quote) {
  if (Number.isFinite(quote?.routeCount)) return quote;
  try {
    const rail = await getRail();
    return { ...quote, routeCount: rail.routeCount(quote.from.code, quote.to.code) };
  } catch {
    return quote; // no count is better than a wrong one
  }
}

function buildCard(ticket, validTill) {
  const typeLabel = TICKET_TYPE_LABELS[ticket.ticketType] ?? ticket.ticketType.toUpperCase();

  const card = document.createElement('div');
  card.className = 'ticket-card';
  card.setAttribute('data-tab', 'upcoming');
  card.dataset.serial = ticket.serial;
  card.dataset.validTill = validTill;
  card.innerHTML = `
    <div class="ticket-notch left"><img src="image/ticket-hole.svg" alt="hole"></div>
    <div class="ticket-notch right"><img src="image/ticket-hole.svg" alt="hole"></div>
    <div class="ticket-top">
      <span class="pill-unreserved">Unreserved</span>
      <span class="uts-code"><span class="uts-label">UTS:</span> <span class="uts-value">${ticket.serial}</span></span>
    </div>
    <div class="ticket-mid">
      <div>
        <span class="ticket-label">Ticket Type</span>
        <span class="ticket-value">${typeLabel}</span>
      </div>
      <div class="align-right">
        <span class="ticket-label">Booking Date</span>
        <span class="ticket-value">${formatCardDate(ticket.bookedAt)}</span>
      </div>
    </div>
    <div class="ticket-route">
      <span class="route-station">${ticket.quote.from.name.toUpperCase()}</span>
      <span class="route-dist">&mdash; ${ticket.quote.chargeableKm} km &mdash;</span>
      <span class="route-station">${ticket.quote.to.name.toUpperCase()}</span>
    </div>
    <div class="ticket-dashed"></div>
    <div class="ticket-actions">
      <span class="book-again">Book Again</span>
      <span class="action-sep"></span>
      <button class="view-details" type="button">View Details</button>
    </div>
  `;

  card.querySelector('.view-details').addEventListener('click', async () => {
    const passenger = await loadProfileSafe(); // always the current profile, not whatever it was at booking time
    renderTicket({ ...ticket, quote: await withRouteCount(ticket.quote), passenger });
    window.RailOneApp.showView('ticket');
  });

  return card;
}

/** New booking, just made — renders immediately and persists in the background. */
export function addBooking(ticket) {
  const validTill = validTillISO({ ticketType: ticket.ticketType, bookedDate: ticket.bookedAt, quote: ticket.quote });
  bookingsList.prepend(buildCard(ticket, validTill));
  updateUpcomingCount();
  persistNewBooking(ticket);
}

async function persistNewBooking(ticket) {
  try {
    await store.saveBooking(toRecord(ticket));
  } catch (err) {
    // The card is already on screen and the ticket is already valid; only
    // durability is lost. Say so rather than failing the booking, because the
    // rider needs to know this ticket won't be here after a restart.
    const reason = err?.code === 'QUOTA_EXCEEDED' ? 'device storage is full' : 'local storage failed';
    console.warn(`RailOne: this ticket could not be saved for next time (${reason}) —`, err);
    showToast(err?.code === 'QUOTA_EXCEEDED'
      ? 'Ticket issued, but there is no room left on this device to save it.'
      : 'Ticket issued, but it could not be saved on this device.', { duration: 7000 });
  }
}

/** Reads local storage, drops expired records, renders what's left. */
async function renderFromStore() {
  let kept;
  try {
    kept = await store.pruneExpired();
  } catch (err) {
    console.warn('RailOne: could not read saved tickets —', err);
    return;
  }

  // Cards we own carry data-serial; the static sample card doesn't and stays.
  bookingsList.querySelectorAll('.ticket-card[data-serial]').forEach((card) => card.remove());

  const frag = document.createDocumentFragment(); // kept[0] is newest; append in order so it lands on top
  for (const record of kept) {
    frag.appendChild(buildCard(fromRecord(record), record.validTill));
  }
  bookingsList.prepend(frag);
  updateUpcomingCount();
  startExpiryWatch();
}

let watchTimer = null;
function startExpiryWatch() {
  if (watchTimer) return;
  watchTimer = setInterval(async () => {
    const now = Date.now();
    const expiredCards = [...bookingsList.querySelectorAll('.ticket-card[data-valid-till]')]
      .filter((card) => new Date(card.dataset.validTill + 'T23:59:59').getTime() < now);
    if (!expiredCards.length) return;
    expiredCards.forEach((card) => card.remove());
    updateUpcomingCount();
    try { await store.pruneExpired(now); } catch { /* DOM is already correct; storage catches up on the next prune */ }
  }, EXPIRY_CHECK_MS);
}

// Another tab booked, deleted or expired something: re-read and re-render, so
// every open window agrees on what's stored.
onChange((message) => {
  if (message.kind === 'bookings') renderFromStore();
});

// Coming back to a backgrounded PWA can be hours later: re-check expiry then,
// rather than trusting a timer that the browser may have throttled or frozen.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') renderFromStore();
});

renderFromStore();
