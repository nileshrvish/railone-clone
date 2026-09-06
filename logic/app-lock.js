/**
 * app-lock.js — "unlock RailOne with your fingerprint / face / device PIN".
 *
 * There is no browser API for locking an app, so this is built on WebAuthn
 * with a *platform* authenticator, which is what Windows Hello, Touch ID,
 * Face ID and Android's fingerprint reader expose to the web. Enabling the
 * lock registers a credential on this device; opening the app then asks that
 * same authenticator for an assertion with userVerification: 'required', so
 * the OS runs the biometric check.
 *
 * Everything stays on the device, as the rest of the app does: the challenge
 * is generated locally with crypto.getRandomValues, the credential's public
 * key is kept in IndexedDB, and the assertion is verified locally with
 * WebCrypto. Nothing is registered with, or checked against, a server —
 * there isn't one.
 *
 * What this is honestly worth: it stops someone who picks up an unlocked
 * phone from reading your tickets. It is not encryption. The records in
 * IndexedDB are still plain, so anyone with devtools or the device's file
 * system can read them regardless of this setting. Real at-rest protection
 * would need a key derived from the authenticator (the WebAuthn PRF
 * extension), which is not yet available widely enough to rely on.
 *
 * The gate itself is armed pre-paint by the inline script in index.html
 * (data-locked on <html>), so no ticket is ever painted behind the overlay.
 */
import { STORES, get, put, del } from './db.js';
import { ready } from './store.js';
import { getPref, setPref, removePref } from './prefs.js';
import { loadProfileSafe } from './profile-store.js';
import { showToast } from './toast.js';

const RECORD_KEY = 'appLock';  // IndexedDB (meta): the credential this device registered
const PREF_KEY = 'appLock';    // localStorage: read synchronously before first paint

const els = {
  section: document.getElementById('security-settings'),
  toggle: document.getElementById('app-lock-toggle'),
  note: document.getElementById('app-lock-note'),
  overlay: document.getElementById('app-lock'),
  overlayText: document.getElementById('app-lock-text'),
  unlockBtn: document.getElementById('app-lock-unlock'),
};

// ------------------------------------------------------------- primitives

const randomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

function toBase64Url(buffer) {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

/**
 * Is a built-in biometric/PIN authenticator actually usable here? Needs a
 * secure context (https or localhost), the API itself, and a platform
 * authenticator the OS is willing to offer.
 */
export async function isSupported() {
  if (!window.isSecureContext || !window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function isEnabled() {
  return getPref(PREF_KEY, false) === true;
}

// --------------------------------------------------------- enable/disable

async function enable() {
  const profile = await loadProfileSafe();
  const label = profile?.name || 'RailOne rider';

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: 'RailOne' },               // no id: defaults to this origin
      user: { id: randomBytes(16), name: label, displayName: label },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },     // ES256
        { type: 'public-key', alg: -257 },   // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // the device itself, not a security key
        userVerification: 'required',        // biometric or device PIN, not just presence
        residentKey: 'discouraged',
      },
      attestation: 'none',                   // we are not verifying the device's identity
      timeout: 60000,
    },
  });
  if (!credential) throw new Error('NO_CREDENTIAL');

  const publicKey = credential.response.getPublicKey?.();
  await put(STORES.META, {
    credentialId: toBase64Url(credential.rawId),
    publicKey: publicKey ? toBase64Url(publicKey) : null,
    alg: credential.response.getPublicKeyAlgorithm?.() ?? null,
    createdAt: new Date().toISOString(),
  }, RECORD_KEY);

  setPref(PREF_KEY, true);
}

async function disable() {
  removePref(PREF_KEY);
  await del(STORES.META, RECORD_KEY).catch(() => {});
  unlockApp();
}

// ------------------------------------------------------------ verification

/**
 * WebAuthn signs with ECDSA in DER; WebCrypto wants the raw r||s pair.
 * Returns null when the structure isn't what we expect, which the caller
 * treats as "can't check" rather than "failed".
 */
function derToRaw(der) {
  if (der[0] !== 0x30) return null;
  let offset = der[1] & 0x80 ? 2 + (der[1] & 0x7f) : 2;

  const readInteger = () => {
    if (der[offset++] !== 0x02) return null;
    const length = der[offset++];
    let value = der.slice(offset, offset + length);
    offset += length;
    while (value.length > 32 && value[0] === 0) value = value.slice(1); // strip DER sign padding
    if (value.length > 32) return null;
    const padded = new Uint8Array(32);
    padded.set(value, 32 - value.length);
    return padded;
  };

  const r = readInteger();
  const s = readInteger();
  if (!r || !s) return null;

  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

/**
 * Verifies the assertion against the public key stored at registration.
 * A verification that *runs* and says false is a hard fail; one that can't
 * run (unsupported algorithm, unexpected encoding) falls back to the
 * user-verified flag rather than locking someone out of their own tickets.
 */
async function signatureVerifies(record, assertion, authenticatorData) {
  if (!record.publicKey || record.alg !== -7) return true;
  try {
    const key = await crypto.subtle.importKey(
      'spki', fromBase64Url(record.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    );
    const clientHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', assertion.response.clientDataJSON)
    );
    const signedData = new Uint8Array(authenticatorData.length + clientHash.length);
    signedData.set(authenticatorData, 0);
    signedData.set(clientHash, authenticatorData.length);

    const signature = derToRaw(new Uint8Array(assertion.response.signature));
    if (!signature) return true;

    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, signedData);
  } catch {
    return true;
  }
}

/** Runs the OS biometric prompt. Throws whatever WebAuthn throws. */
async function verify() {
  await ready();
  const record = await get(STORES.META, RECORD_KEY);
  if (!record) return false;

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{
        type: 'public-key',
        id: fromBase64Url(record.credentialId),
        transports: ['internal'],
      }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  if (!assertion) return false;
  if (toBase64Url(assertion.rawId) !== record.credentialId) return false;

  // Bit 2 of the flags byte is UV: the authenticator actually verified the
  // user, rather than merely confirming someone was present.
  const authenticatorData = new Uint8Array(assertion.response.authenticatorData);
  if (!(authenticatorData[32] & 0x04)) return false;

  return signatureVerifies(record, assertion, authenticatorData);
}

// -------------------------------------------------------------- the gate

function setOverlayMessage(text) {
  if (els.overlayText) els.overlayText.textContent = text;
}

function unlockApp() {
  delete document.documentElement.dataset.locked;
  document.getElementById('app')?.removeAttribute('inert');
}

async function attemptUnlock({ automatic = false } = {}) {
  if (els.unlockBtn) els.unlockBtn.disabled = true;
  setOverlayMessage('Waiting for your device…');
  try {
    if (await verify()) {
      unlockApp();
      return true;
    }
    setOverlayMessage('That didn’t match. Try again.');
  } catch (err) {
    setOverlayMessage(err?.name === 'NotAllowedError' && automatic
      ? 'Tap Unlock to continue.'          // some browsers need a real tap first
      : 'Could not verify. Tap Unlock to try again.');
  } finally {
    if (els.unlockBtn) {
      els.unlockBtn.disabled = false;
      els.unlockBtn.focus({ preventScroll: true });
    }
  }
  return false;
}

async function runGate() {
  if (!document.documentElement.dataset.locked) return;

  // Nothing behind the overlay should be reachable by keyboard or screen
  // reader while the app is locked.
  document.getElementById('app')?.setAttribute('inert', '');

  // The pref says locked but the credential is gone (data cleared, browser
  // profile moved): there is nothing to check against, so don't strand anyone.
  await ready();
  if (!(await get(STORES.META, RECORD_KEY).catch(() => null))) {
    await disable();
    return;
  }

  els.unlockBtn?.addEventListener('click', () => attemptUnlock());
  attemptUnlock({ automatic: true });
}

// ------------------------------------------------------------- settings UI

function renderToggle(enabled) {
  if (!els.toggle) return;
  els.toggle.setAttribute('aria-checked', String(enabled));
  els.note.textContent = enabled
    ? 'RailOne will ask for your fingerprint, face or device PIN each time it opens. This hides your tickets from someone else picking up your device; it does not encrypt them.'
    : 'Ask for your fingerprint, face or device PIN each time RailOne opens.';
}

export async function initAppLock() {
  runGate();

  if (!els.section || !els.toggle) return;
  if (!(await isSupported())) return; // no platform authenticator — leave the row hidden

  els.section.hidden = false;
  renderToggle(isEnabled());

  els.toggle.addEventListener('click', async () => {
    const turningOn = !isEnabled();
    els.toggle.disabled = true;
    try {
      if (turningOn) {
        await enable();
        renderToggle(true);
        showToast('App lock on. RailOne will ask to verify you next time it opens.');
      } else {
        // No re-verification to switch off: the rider already passed the lock
        // to get here, and a failing sensor must never trap them behind it.
        await disable();
        renderToggle(false);
        showToast('App lock off.');
      }
    } catch (err) {
      renderToggle(isEnabled());
      if (err?.name === 'NotAllowedError') {
        showToast('Setup was cancelled, so the app lock is still off.');
      } else if (err?.name === 'InvalidStateError') {
        showToast('This device already has a RailOne lock registered.');
      } else {
        console.warn('RailOne: could not set up the app lock —', err);
        showToast('Could not set up the app lock on this device.');
      }
    } finally {
      els.toggle.disabled = false;
    }
  });
}
