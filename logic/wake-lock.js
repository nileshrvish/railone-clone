/**
 * wake-lock.js — keeps the screen awake while a digital ticket is on screen.
 *
 * This is the one place in RailOne where it genuinely matters: the rider holds
 * the phone up for a ticket check, and a screen that dims or locks mid-check
 * is the whole problem. The lock is taken only for the ticket view and dropped
 * the moment they navigate away.
 *
 * The API is Chromium/Safari-16.4+ only and can reject at any time (low
 * battery, OS policy) — every path here is best-effort and silent on failure.
 */
const supported = 'wakeLock' in navigator;

let sentinel = null;
let wanted = false;

async function acquire() {
  if (!supported || sentinel || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    // The OS can drop it on its own; forget the stale sentinel if it does.
    sentinel.addEventListener('release', () => { sentinel = null; });
  } catch {
    sentinel = null; // denied — the ticket is still perfectly readable
  }
}

async function release() {
  if (!sentinel) return;
  const held = sentinel;
  sentinel = null;
  try { await held.release(); } catch { /* already gone */ }
}

export function initWakeLock() {
  if (!supported) return;

  window.addEventListener('railone:viewchange', (event) => {
    wanted = event.detail?.view === 'ticket';
    if (wanted) acquire(); else release();
  });

  // A wake lock is always released when the page is hidden; take it again on
  // the way back if the ticket is still the view in front of the rider.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted) acquire();
  });
}
