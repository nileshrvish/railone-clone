/**
 * greeting.js — updates the Home page's "Hi, {name}!" from the rider's
 * profile, and puts the original static text back when the profile is
 * deleted (mirrors how ticket-render.js treats a missing profile).
 */
let fallback = null;

export function updateGreeting(profile) {
  const el = document.getElementById('greeting');
  if (!el) return;
  if (fallback === null) fallback = el.textContent;
  el.textContent = profile?.name ? `Hi, ${profile.name}!` : fallback;
}
