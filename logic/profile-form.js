/**
 * profile-form.js — the "You" tab: create/edit the rider's profile, stored
 * via profile-store.js (File System Access — data/profile.json), same
 * connection and no-localStorage rule as bookings. Module entry point
 * loaded directly by index.html.
 */
import * as store from './profile-store.js';
import { ID_TYPES } from './fare.js';
import { updateGreeting } from './greeting.js';

const els = {
  connectBtn: document.getElementById('profile-connect'),
  form: document.getElementById('profile-form'),
  name: document.getElementById('profile-name'),
  mobile: document.getElementById('profile-mobile'),
  age: document.getElementById('profile-age'),
  idType: document.getElementById('profile-id-type'),
  idNumber: document.getElementById('profile-id-number'),
  formError: document.getElementById('profile-form-error'),
  formNote: document.getElementById('profile-form-note'),
  submit: document.getElementById('profile-submit'),
};

function fillForm(profile) {
  if (!profile) return;
  els.name.value = profile.name ?? '';
  els.mobile.value = profile.mobile ?? '';
  els.age.value = profile.age ?? '';
  els.idType.value = ID_TYPES.includes(profile.idType) ? profile.idType : ID_TYPES[0];
  els.idNumber.value = profile.idNumber ?? '';
}

async function loadAndFill() {
  try {
    const profile = await store.loadProfile();
    fillForm(profile);
    updateGreeting(profile);
  } catch (err) {
    console.warn('RailOne: could not read data/profile.json —', err);
  }
}

function showError(msg) {
  els.formError.textContent = msg;
  els.formError.hidden = !msg;
  els.formNote.hidden = true;
}

function showNote(msg) {
  els.formNote.textContent = msg;
  els.formNote.hidden = !msg;
  els.formError.hidden = true;
}

function validate() {
  const name = els.name.value.trim();
  const mobile = els.mobile.value.trim();
  const age = parseInt(els.age.value, 10);
  const idNumber = els.idNumber.value.trim();

  if (!name) return { error: 'Enter your full name.', field: els.name };
  if (!/^\d{10}$/.test(mobile)) return { error: 'Enter a valid 10-digit mobile number.', field: els.mobile };
  if (!Number.isFinite(age) || age < 5 || age > 120) return { error: 'Enter a valid age.', field: els.age };
  if (!idNumber) return { error: 'Enter your ID number.', field: els.idNumber };

  return {
    profile: { name, mobile, age, idType: els.idType.value, idNumber },
  };
}

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');

  const result = validate();
  if (result.error) {
    showError(result.error);
    result.field.focus();
    return;
  }

  els.submit.disabled = true;
  try {
    if (store.isSupported()) {
      if (!store.isConnected()) await store.connect(); // click is a real gesture — may show the folder picker
      await store.saveProfile(result.profile);
      els.connectBtn.hidden = true;
      updateGreeting(result.profile);
      showNote('Profile saved to data/profile.json.');
    } else {
      updateGreeting(result.profile);
      showNote('Profile saved for this session (this browser doesn’t support saving it to a file).');
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      showError('Folder access was cancelled, so the profile wasn’t saved.');
    } else {
      console.warn('RailOne: could not save data/profile.json —', err);
      showError('Could not save the profile. See the console for details.');
    }
  } finally {
    els.submit.disabled = false;
  }
});

if (store.isSupported()) {
  store.tryConnectSilently().then((connected) => {
    if (connected) loadAndFill();
    else els.connectBtn.hidden = false;
  });

  els.connectBtn.addEventListener('click', async () => {
    els.connectBtn.disabled = true;
    try {
      await store.connect();
      await loadAndFill();
      els.connectBtn.hidden = true;
    } catch (err) {
      if (err?.name !== 'AbortError') console.warn('RailOne: could not connect profile storage —', err);
    } finally {
      els.connectBtn.disabled = false;
    }
  });
}
