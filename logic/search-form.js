/**
 * search-form.js — station search form: autocomplete, a live fare preview,
 * and wiring the result into the existing digital ticket. This is the module
 * entry point loaded by index.html.
 */
import { getRail } from './rail-provider.js';
import { bindAutocomplete } from './autocomplete.js';
import {
  classMinimum, computeTicketTotal, viaDisplay, todayISO, randomSerial,
  isSeasonType, passDurationLabel, pricedPassBands, isoToDDMMYYYY, TICKET_TYPE_LABELS,
  parseManualFare, withManualFare,
} from './fare.js';
import { renderTicket } from './ticket-render.js';
import { addBooking } from './bookings.js';
import * as profileStore from './profile-store.js';
import { onChange } from './store.js';

const els = {
  form: document.getElementById('search-form'),
  from: document.getElementById('search-from'),
  fromList: document.getElementById('search-from-list'),
  fromError: document.getElementById('search-from-error'),
  to: document.getElementById('search-to'),
  toList: document.getElementById('search-to-list'),
  toError: document.getElementById('search-to-error'),
  ticketType: document.getElementById('search-ticket-type'),
  cls: document.getElementById('search-class'),
  trainType: document.getElementById('search-train-type'),
  passDateField: document.getElementById('search-pass-date-field'),
  passDate: document.getElementById('search-pass-date'),
  adults: document.getElementById('search-adults'),
  children: document.getElementById('search-children'),
  bookedAt: document.getElementById('search-booked-at'),
  fareOverride: document.getElementById('search-fare-override'),
  fareOverrideLabel: document.getElementById('search-fare-override-label'),
  preview: document.getElementById('search-preview'),
  previewKm: document.getElementById('preview-km'),
  previewVia: document.getElementById('preview-via'),
  previewFare: document.getElementById('preview-fare'),
  formError: document.getElementById('search-form-error'),
  submit: document.getElementById('search-submit'),

  // Season-pass only: the fields and summary rows that appear for a pass.
  passengerRow: document.getElementById('search-passenger-row'),
  passRow: document.getElementById('preview-pass-row'),
  passValue: document.getElementById('preview-pass'),
  routeRow: document.getElementById('preview-route-row'),
  routeValue: document.getElementById('preview-route'),
  classRow: document.getElementById('preview-class-row'),
  classValue: document.getElementById('preview-class'),
  validFromRow: document.getElementById('preview-validfrom-row'),
  validFromValue: document.getElementById('preview-valid-from'),
  validTillRow: document.getElementById('preview-validtill-row'),
  validTillValue: document.getElementById('preview-valid-till'),
  holderRow: document.getElementById('preview-holder-row'),
  holderValue: document.getElementById('preview-holder'),
};

const state = { from: null, to: null };
let rail = null;

/**
 * A pass is issued to the profile holder, so the summary has to name them.
 * Kept as a snapshot because the preview redraws synchronously on every
 * keystroke; refreshed whenever the profile changes or the screen is opened.
 */
let passHolder = null;

async function refreshPassHolder() {
  passHolder = await profileStore.loadProfileSafe();
  updatePreview();
}

getRail().then((r) => {
  rail = r;
  syncTicketTypeFields();
  updatePreview();
}).catch(() => {
  showFormError('Could not load the station network. Please reload the app.');
  els.submit.disabled = true;
});

function stationSearch(q, limit) {
  return rail ? rail.search(q, limit) : [];
}

bindAutocomplete(els.from, els.fromList, {
  search: stationSearch,
  onPick: (item) => {
    state.from = item;
    if (item) { els.from.value = item.name; setFieldError('from', ''); }
    updatePreview();
  },
});
bindAutocomplete(els.to, els.toList, {
  search: stationSearch,
  onPick: (item) => {
    state.to = item;
    if (item) { els.to.value = item.name; setFieldError('to', ''); }
    updatePreview();
  },
});

// If the user types free text and leaves the field without picking from the
// dropdown, resolve it via rail.search(text, 1)[0] and show what matched.
// If nothing matches, block submission with a message naming the field.
function resolveOnBlur(input, field) {
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (state[field] || !rail) return;
      const text = input.value.trim();
      if (!text) return;
      const hit = rail.search(text, 1)[0];
      if (hit) {
        state[field] = hit;
        input.value = hit.name;
        setFieldNote(field, `Resolved to ${hit.name} (${hit.code})`);
        updatePreview();
      } else {
        setFieldError(field, `We couldn't match "${text}" to a station. Please pick one from the list.`);
      }
    }, 150); // after the autocomplete binder's own blur-close has run
  });
}
resolveOnBlur(els.from, 'from');
resolveOnBlur(els.to, 'to');

function setFieldError(field, msg) {
  const el = field === 'from' ? els.fromError : els.toError;
  el.classList.remove('is-note');
  el.textContent = msg;
  el.hidden = !msg;
}

function setFieldNote(field, msg) {
  const el = field === 'from' ? els.fromError : els.toError;
  el.classList.add('is-note');
  el.textContent = msg;
  el.hidden = !msg;
}

/**
 * Shows only what the selected ticket type actually needs:
 *  - a pass needs a start date, and is issued to one named holder, so the
 *    Adults/Children row does not apply to it;
 *  - a journey ticket needs the passenger counts and no start date.
 * Switching back and forth restores the other type's fields untouched, so
 * nothing carries over stale.
 */
function syncTicketTypeFields() {
  const season = isSeasonType(els.ticketType.value);

  els.passDateField.hidden = !season;
  if (els.passengerRow) els.passengerRow.hidden = season;

  if (season) {
    // A pass cannot start in the past; default to today the first time.
    els.passDate.min = todayISO();
    if (!els.passDate.value) els.passDate.value = todayISO();
  }

  // The override replaces the per-ticket fare, which means something different
  // for a pass (the whole pass) than for a journey ticket (one adult's fare).
  if (els.fareOverrideLabel) {
    els.fareOverrideLabel.textContent = season
      ? 'Pass fare ₹ (optional)'
      : 'Fare per adult ₹ (optional)';
  }
}

els.ticketType.addEventListener('change', () => {
  syncTicketTypeFields();
  updatePreview();
});
[els.cls, els.trainType, els.adults, els.children, els.passDate, els.fareOverride].forEach((el) => {
  el.addEventListener('input', updatePreview);
  el.addEventListener('change', updatePreview);
});

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** The optional "Booking date & time" field — falls back to right now when left blank or unparseable. */
function resolveBookedAt() {
  if (!els.bookedAt.value) return new Date();
  const d = new Date(els.bookedAt.value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** The typed-in fare, or null when the box is empty/invalid. */
function manualFare() {
  return parseManualFare(els.fareOverride?.value).fare;
}

function currentQuote() {
  if (!rail || !state.from || !state.to) return null;
  const ticketType = els.ticketType.value;
  const cls = els.cls.value;
  const startDate = ticketType.startsWith('season') ? (els.passDate.value || todayISO()) : null;
  try {
    // The engine stays the single source of distance, route and validity; only
    // the fare is swapped, and the quote records that a human supplied it.
    return withManualFare(rail.quote(state.from.code, state.to.code, { ticketType, cls, startDate }), manualFare());
  } catch (err) {
    return { error: err.message };
  }
}

function currentTotal(quote) {
  const ticketType = els.ticketType.value;
  // A pass is one document for one holder: the counts don't multiply it.
  const adults = isSeasonType(ticketType) ? 1 : clampInt(els.adults.value, 1, 6, 1);
  const children = isSeasonType(ticketType) ? 0 : clampInt(els.children.value, 0, 6, 0);
  const classMin = classMinimum(rail.data.fare_rules, els.cls.value);
  return {
    adults,
    children,
    total: computeTicketTotal({ ticketType, fareInr: quote.fareInr, adults, children, classMin }),
  };
}

/**
 * The pass-only summary rows. Hidden for single/return, so a journey ticket's
 * preview is exactly the three rows it has always been.
 */
function renderPassSummary(quote, season) {
  for (const row of [els.passRow, els.routeRow, els.classRow,
                     els.validFromRow, els.validTillRow, els.holderRow]) {
    if (row) row.hidden = !season;
  }
  if (!season || !quote) return;

  const duration = passDurationLabel(els.ticketType.value);
  els.passValue.textContent = `${els.ticketType.selectedOptions[0].textContent} · ${duration}`;
  els.routeValue.textContent = `${quote.from.name} → ${quote.to.name}`;
  els.classValue.textContent = els.cls.selectedOptions[0].textContent;
  // Both dates come from the engine (MumbaiRail.validity applies the data's
  // "valid_from + N months − 1 day" rule); nothing is computed here.
  els.validFromValue.textContent = quote.validFrom ? isoToDDMMYYYY(quote.validFrom) : '—';
  els.validTillValue.textContent = quote.validTill ? isoToDDMMYYYY(quote.validTill) : '—';
  els.holderValue.textContent = passHolder?.name || 'Not set — add your profile in “You”';
}

/**
 * What stops this pass from being issued, as a sentence the rider can act on,
 * or null when it's good to go. Journey tickets never reach any of this.
 */
/** Applies to every ticket type: a typed fare has to be a real amount. */
function manualFareProblem() {
  return parseManualFare(els.fareOverride?.value).error;
}

function passProblem(quote) {
  if (!isSeasonType(els.ticketType.value)) return null;

  const start = els.passDate.value;
  if (!start) return 'Pick the date your pass should start from.';
  if (start < todayISO()) return 'A pass can only start today or later — pick a new start date.';

  if (!quote.fareAvailable) {
    const classLabel = els.cls.selectedOptions[0].textContent;
    const bands = pricedPassBands(rail.data.fare_rules, els.cls.value);
    const covered = bands.length
      ? `The fare table currently covers ${bands.join(', ')}.`
      : `The fare table has no ${classLabel} pass fares yet.`;
    return `No published pass fare for ${quote.chargeableKm} km in ${classLabel}. ${covered} Enter the fare yourself in the field above to continue.`;
  }

  if (!profileStore.isProfileComplete(passHolder)) {
    return 'A pass is issued in one person’s name — add your name, mobile, age and ID under “You” first.';
  }
  return null;
}

function updatePreview() {
  showFormError('');
  const q = currentQuote();
  const season = isSeasonType(els.ticketType.value);

  if (!q || q.error) {
    els.preview.hidden = true;
    els.submit.disabled = true;
    renderPassSummary(null, false);
    if (q?.error) showFormError('No route found between these two stations.');
    return;
  }

  els.preview.hidden = false;
  els.previewKm.textContent = `${q.chargeableKm} km`;
  els.previewVia.textContent = viaDisplay(q.via, q.routeCount);
  renderPassSummary(q, season);

  const { total } = currentTotal(q);
  if (total == null) {
    els.previewFare.textContent = 'Fare not available yet — enter one above, or pick another route';
  } else {
    // Never let a typed fare pass itself off as a sourced one.
    els.previewFare.textContent = q.manualFare
      ? `₹${total.toFixed(2)} · entered manually`
      : `₹${total.toFixed(2)}`;
  }

  // A pass has more ways to be invalid than a journey ticket; say which one
  // it is and keep Book Ticket disabled until it's fixed.
  const problem = manualFareProblem() ?? passProblem(q);
  if (problem) showFormError(problem);
  els.submit.disabled = !q.fareAvailable || Boolean(problem);
}

function showFormError(msg) {
  els.formError.textContent = msg;
  els.formError.hidden = !msg;
}

// Season passes must carry the rider's identity (see ticket-render.js) — the
// real RailOne season ticket this was modeled on prints Name/Age/ID Type/ID
// Number, and won't exist without a profile. Journey tickets (single/return)
// don't need one; if a profile is saved on the device its name/mobile are used
// to personalize the ticket header, but it is never required.

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!rail) return;

  if (!state.from) { setFieldError('from', 'Pick a "From" station.'); els.from.focus(); return; }
  if (!state.to) { setFieldError('to', 'Pick a "To" station.'); els.to.focus(); return; }

  const q = currentQuote();
  if (!q || q.error) { showFormError('No route found between these two stations.'); return; }

  const ticketType = els.ticketType.value;
  const isSeason = isSeasonType(ticketType);

  const fareTypo = manualFareProblem();
  if (fareTypo) { showFormError(fareTypo); els.fareOverride.focus(); return; }

  // For a pass, passProblem() below says *why* it isn't priced (which class,
  // which bands the table covers), so don't pre-empt it with the generic line.
  if (!q.fareAvailable && !isSeason) {
    showFormError('This route isn’t priced yet — enter a fare above, or pick another route.');
    return;
  }

  // Re-read the profile at submit time rather than trusting the snapshot the
  // summary was drawn from — it may have been edited in another tab since.
  els.submit.disabled = true;
  passHolder = await profileStore.loadProfileSafe();
  els.submit.disabled = false;
  const profile = passHolder;

  const problem = passProblem(q);
  if (problem) {
    showFormError(problem);
    renderPassSummary(q, isSeason);
    return;
  }

  const { adults, children, total } = currentTotal(q);

  // `passenger` is never stored on the ticket — it's supplied fresh here for
  // this render, and again from the live profile every time this ticket (or
  // any other) is reopened. See ticket-render.js and bookings.js.
  const ticket = {
    quote: q,
    ticketType,
    cls: els.cls.value,
    trainType: els.trainType.value,
    adults,
    children,
    total,
    bookedAt: resolveBookedAt(),
    serial: randomSerial(),
  };

  renderTicket({ ...ticket, passenger: profile });
  addBooking(ticket);
  window.RailOneApp.showView('ticket');
});

// The pass holder shown in the summary must track the profile: refreshed on
// load, when this screen is opened, and when another tab edits it.
syncTicketTypeFields();
refreshPassHolder();

window.addEventListener('railone:viewchange', (event) => {
  if (event.detail?.view === 'search') refreshPassHolder();
});

onChange((message) => {
  if (message.kind === 'profile') refreshPassHolder();
});
