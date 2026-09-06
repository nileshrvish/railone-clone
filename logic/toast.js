/**
 * toast.js — the app's one transient message surface (update available, a
 * storage problem, a wake-lock note). Renders into #toast-region, which is an
 * aria-live region, so a toast is announced without stealing focus.
 *
 * Deliberately tiny: one message at a time, an optional single action, and no
 * queue — anything that needs more than that belongs in the view itself.
 */
const region = document.getElementById('toast-region');

let current = null;

function dismiss(toast) {
  if (!toast || toast.dataset.closing === '1') return;
  toast.dataset.closing = '1';
  toast.classList.remove('is-visible');
  setTimeout(() => toast.remove(), 220);
  if (current === toast) current = null;
}

/**
 * @param {string} message
 * @param {{ actionLabel?: string, onAction?: Function, duration?: number }} [options]
 *        duration 0 keeps the toast until its action is used.
 */
export function showToast(message, options = {}) {
  if (!region) return () => {};
  const { actionLabel, onAction, duration = 5000 } = options;

  dismiss(current);

  const toast = document.createElement('div');
  toast.className = 'toast';

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  toast.appendChild(text);

  if (actionLabel && onAction) {
    const button = document.createElement('button');
    button.className = 'toast-action';
    button.type = 'button';
    button.textContent = actionLabel;
    button.addEventListener('click', () => {
      dismiss(toast);
      onAction();
    });
    toast.appendChild(button);
  }

  region.appendChild(toast);
  current = toast;
  // Next frame, so the entry transition actually runs.
  requestAnimationFrame(() => toast.classList.add('is-visible'));

  if (duration > 0) setTimeout(() => dismiss(toast), duration);

  return () => dismiss(toast);
}
