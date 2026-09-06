/**
 * badge.js — shows the number of live tickets on the installed app icon.
 *
 * Chromium on desktop and Android only, and only for an installed app; the
 * calls are no-ops (or reject) elsewhere, which is why every one is guarded.
 */
const supported = 'setAppBadge' in navigator && 'clearAppBadge' in navigator;

export function setTicketBadge(count) {
  if (!supported) return;
  const promise = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
  // Not awaited anywhere: a badge is decoration, never a step in a flow.
  Promise.resolve(promise).catch(() => {});
}
