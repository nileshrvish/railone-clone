/**
 * search-form.js — station search form: autocomplete, a live fare preview,
 * and wiring the result into the existing digital ticket. This is the module
 * entry point loaded by index.html.
 */
import { getRail } from './rail-provider.js';
import { bindAutocomplete } from './autocomplete.js';
import { classMinimum, computeTotal, viaDisplay, todayISO, randomSerial } from './fare.js';
import { renderTicket } from './ticket-render.js';
import { addBooking } from './bookings.js';
import * as profileStore from './profile-store.js';

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
  preview: document.getElementById('search-preview'),
  previewKm: document.getElementById('preview-km'),
  previewVia: document.getElementById('preview-via'),
  previewFare: document.getElementById('preview-fare'),
  formError: document.getElementById('search-form-error'),
  submit: document.getElementById('search-submit'),
};

const state = { from: null, to: null };
let rail = null;

getRail().then((r) => {
  rail = r;
  if (!els.passDate.value) els.passDate.value = todayISO();
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

els.ticketType.addEventListener('change', () => {
  els.passDateField.hidden = !els.ticketType.value.startsWith('season');
  updatePreview();
});
[els.cls, els.trainType, els.adults, els.children, els.passDate].forEach((el) => {
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

function currentQuote() {
  if (!rail || !state.from || !state.to) return null;
  const ticketType = els.ticketType.value;
  const cls = els.cls.value;
  const startDate = ticketType.startsWith('season') ? (els.passDate.value || todayISO()) : null;
  try {
    return rail.quote(state.from.code, state.to.code, { ticketType, cls, startDate });
  } catch (err) {
    return { error: err.message };
  }
}

function currentTotal(quote) {
  const adults = clampInt(els.adults.value, 1, 6, 1);
  const children = clampInt(els.children.value, 0, 6, 0);
  const minFare = classMinimum(rail.data.fare_rules, els.cls.value);
  return { adults, children, total: computeTotal(quote.fareInr, adults, children, minFare) };
}

function updatePreview() {
  showFormError('');
  const q = currentQuote();

  if (!q) {
    els.preview.hidden = true;
    els.submit.disabled = true;
    return;
  }
  if (q.error) {
    els.preview.hidden = true;
    els.submit.disabled = true;
    showFormError('No route found between these two stations.');
    return;
  }

  els.preview.hidden = false;
  els.previewKm.textContent = `${q.chargeableKm} km`;
  els.previewVia.textContent = viaDisplay(q.via);

  const { total } = currentTotal(q);
  els.previewFare.textContent = total == null
    ? 'Fare not available yet — this route isn’t priced'
    : `₹${total.toFixed(2)}`;

  els.submit.disabled = !q.fareAvailable;
}

function showFormError(msg) {
  els.formError.textContent = msg;
  els.formError.hidden = !msg;
}

// Season passes must carry the rider's identity (see ticket-render.js) — the
// real RailOne season ticket this was modeled on prints Name/Age/ID Type/ID
// Number, and won't exist without a profile. Journey tickets (single/return)
// don't need one; if a profile happens to already be connected, its
// name/mobile are used to personalize the ticket header, but it's never
// required and never forces a folder-picker prompt on its own.
async function getProfileForBooking(isSeason) {
  if (!profileStore.isSupported()) return { profile: null, blocked: isSeason ? 'UNSUPPORTED' : null };

  if (!profileStore.isConnected()) {
    if (!isSeason) return { profile: null, blocked: null };
    try {
      await profileStore.connect(); // the submit click is a real gesture, so this may show the picker
    } catch (err) {
      return { profile: null, blocked: err?.name === 'AbortError' ? 'CANCELLED' : 'CONNECT_FAILED' };
    }
  }

  try {
    return { profile: await profileStore.loadProfile(), blocked: null };
  } catch {
    return { profile: null, blocked: isSeason ? 'LOAD_FAILED' : null };
  }
}

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!rail) return;

  if (!state.from) { setFieldError('from', 'Pick a "From" station.'); els.from.focus(); return; }
  if (!state.to) { setFieldError('to', 'Pick a "To" station.'); els.to.focus(); return; }

  const q = currentQuote();
  if (!q || q.error) { showFormError('No route found between these two stations.'); return; }
  if (!q.fareAvailable) { showFormError('This route isn’t priced yet, so it can’t be booked.'); return; }

  const ticketType = els.ticketType.value;
  const isSeason = ticketType.startsWith('season');

  els.submit.disabled = true;
  const { profile, blocked } = await getProfileForBooking(isSeason);
  els.submit.disabled = false;

  if (isSeason) {
    if (blocked === 'UNSUPPORTED') {
      showFormError('Season passes need a saved profile, and this browser doesn’t support the storage RailOne uses (try Chrome or Edge).');
      return;
    }
    if (blocked === 'CANCELLED') {
      showFormError('Folder access was cancelled, so your profile couldn’t be checked.');
      return;
    }
    if (blocked === 'CONNECT_FAILED' || blocked === 'LOAD_FAILED') {
      showFormError('Could not read your profile. Please try again.');
      return;
    }
    if (!profileStore.isProfileComplete(profile)) {
      showFormError('Season passes need a complete profile — go to "You" and fill in your name, mobile, age and ID.');
      return;
    }
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
