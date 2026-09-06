/**
 * connectivity.js — the offline/online bar at the top of the app.
 *
 * RailOne is local-first: everything a rider does (booking, profile, tickets)
 * works with no connection at all, so going offline is *information*, not an
 * error. The bar says so plainly, then gets out of the way when the connection
 * is back.
 *
 * navigator.onLine is only ever a hint (it means "there is a network
 * interface", not "the internet works"), which is fine for a message that
 * changes nothing functionally.
 */
const bar = document.getElementById('net-status');

let hideTimer = null;

function render(online, { announceOnline }) {
  if (!bar) return;
  clearTimeout(hideTimer);

  if (!online) {
    bar.textContent = 'Offline — RailOne is running from data saved on this device';
    bar.classList.remove('is-online');
    bar.hidden = false;
    requestAnimationFrame(() => bar.classList.add('is-visible'));
    return;
  }

  if (!announceOnline) {
    bar.classList.remove('is-visible');
    bar.hidden = true;
    return;
  }

  bar.textContent = 'Back online';
  bar.classList.add('is-online');
  bar.hidden = false;
  requestAnimationFrame(() => bar.classList.add('is-visible'));
  hideTimer = setTimeout(() => {
    bar.classList.remove('is-visible');
    // Wait out the slide-up before removing it from the layout entirely.
    hideTimer = setTimeout(() => { bar.hidden = true; }, 300);
  }, 2600);
}

export function initConnectivity() {
  if (!bar) return;
  // Don't greet anyone with "Back online" on a normal online start-up.
  render(navigator.onLine !== false, { announceOnline: false });
  window.addEventListener('online', () => render(true, { announceOnline: true }));
  window.addEventListener('offline', () => render(false, { announceOnline: false }));
}
