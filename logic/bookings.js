/**
 * bookings.js — the My Bookings "Upcoming" list: renders ticket-cards using
 * the existing markup/classes exactly (no new styling), restores previously
 * saved tickets from data/bookings.json on load, persists new ones there,
 * and removes cards live once their validity has passed.
 *
 * The pre-existing static mock card (BHAYANDAR — GHANSOLI) is never touched;
 * it isn't part of the store and stays exactly as it was.
 */
import { renderTicket } from './ticket-render.js';
import { TICKET_TYPE_LABELS, formatCardDate, validTillISO } from './fare.js';
import * as store from './bookings-store.js';
import { loadProfileSafe } from './profile-store.js';

const bookingsList = document.getElementById('bookings-list');
const bookingsCount = document.getElementById('bookings-count');
const connectBtn = document.getElementById('bookings-connect');

const EXPIRY_CHECK_MS = 60 * 1000;

function maskedUts(serial) {
  return `${serial[0]}${'█'.repeat(5)}`;
}

function updateUpcomingCount() {
  const activeTab = document.querySelector('.tab-item.active');
  if (activeTab && activeTab.getAttribute('data-tab-switch') === 'upcoming') {
    bookingsCount.textContent = `Upcoming (${bookingsList.querySelectorAll('.ticket-card').length})`;
  }
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
    renderTicket({ ...ticket, passenger });
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
  if (!store.isSupported()) return; // Firefox/Safari: session-only, no file to write to
  try {
    if (!store.isConnected()) await store.connect(); // may show the folder picker — must run inside the booking click's gesture
    await store.saveBooking(toRecord(ticket));
    if (connectBtn) connectBtn.hidden = true;
  } catch (err) {
    if (err?.name !== 'AbortError') console.warn('RailOne: could not save ticket to data/bookings.json —', err);
  }
}

/** Reads data/bookings.json, drops expired records, renders what's left. */
async function restoreFromStore() {
  let kept;
  try {
    kept = await store.pruneExpired();
  } catch (err) {
    console.warn('RailOne: could not read data/bookings.json —', err);
    return;
  }
  const frag = document.createDocumentFragment(); // kept[0] is newest; append in order so it lands on top
  for (const record of kept) {
    const ticket = fromRecord(record);
    frag.appendChild(buildCard(ticket, record.validTill));
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
    try { await store.pruneExpired(now); } catch { /* DOM is already correct; file will catch up next successful write */ }
  }, EXPIRY_CHECK_MS);
}

if (store.isSupported()) {
  store.tryConnectSilently().then((connected) => {
    if (connected) {
      restoreFromStore();
    } else if (connectBtn) {
      connectBtn.hidden = false;
    }
  });

  connectBtn?.addEventListener('click', async () => {
    connectBtn.disabled = true;
    try {
      await store.connect();
      await restoreFromStore();
      connectBtn.hidden = true;
    } catch (err) {
      if (err?.name !== 'AbortError') console.warn('RailOne: could not connect ticket storage —', err);
    } finally {
      connectBtn.disabled = false;
    }
  });
}
