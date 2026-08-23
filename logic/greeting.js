/**
 * greeting.js — updates the Home page's "Hi, {name}!" from the rider's
 * profile. Leaves the existing static text alone when there's no profile
 * name to show yet (mirrors how ticket-render.js treats a missing profile).
 */
export function updateGreeting(profile) {
  const el = document.getElementById('greeting');
  if (el && profile?.name) el.textContent = `Hi, ${profile.name}!`;
}
