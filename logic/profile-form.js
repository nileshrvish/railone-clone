/**
 * profile-form.js — the "You" tab: create, edit and delete the rider's
 * profile, stored on the device via profile-store.js (IndexedDB). Loads
 * whatever is already saved as soon as the app opens — no prompt, no connect
 * step. Module entry point loaded directly by index.html.
 */
import * as store from './profile-store.js';
import { onChange } from './store.js';
import { ID_TYPES } from './fare.js';
import { updateGreeting } from './greeting.js';

const els = {
  form: document.getElementById('profile-form'),
  name: document.getElementById('profile-name'),
  mobile: document.getElementById('profile-mobile'),
  age: document.getElementById('profile-age'),
  idType: document.getElementById('profile-id-type'),
  idNumber: document.getElementById('profile-id-number'),
  formError: document.getElementById('profile-form-error'),
  formNote: document.getElementById('profile-form-note'),
  submit: document.getElementById('profile-submit'),
  deleteBtn: document.getElementById('profile-delete'),
};

function fillForm(profile) {
  if (!profile) {
    els.form.reset();
    els.idType.value = ID_TYPES[0];
    return;
  }
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
    if (els.deleteBtn) els.deleteBtn.hidden = !profile;
  } catch (err) {
    console.warn('RailOne: could not read the saved profile —', err);
    showError('Could not read your saved profile on this device.');
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
    await store.saveProfile(result.profile);
    updateGreeting(result.profile);
    if (els.deleteBtn) els.deleteBtn.hidden = false;
    showNote('Profile saved on this device.');
  } catch (err) {
    console.warn('RailOne: could not save the profile —', err);
    showError(err?.code === 'QUOTA_EXCEEDED'
      ? 'There is no room left on this device to save the profile.'
      : 'Could not save the profile on this device. See the console for details.');
  } finally {
    els.submit.disabled = false;
  }
});

els.deleteBtn?.addEventListener('click', async () => {
  if (!window.confirm('Delete the profile saved on this device? Your booked tickets are kept.')) return;
  els.deleteBtn.disabled = true;
  try {
    await store.deleteProfile();
    fillForm(null);
    els.deleteBtn.hidden = true;
    showNote('Profile deleted from this device.');
  } catch (err) {
    console.warn('RailOne: could not delete the profile —', err);
    showError('Could not delete the profile. See the console for details.');
  } finally {
    els.deleteBtn.disabled = false;
  }
});

// Another tab edited or deleted the profile: show what's actually stored.
onChange((message) => {
  if (message.kind === 'profile') loadAndFill();
});

loadAndFill();
