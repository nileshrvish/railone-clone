/**
 * theme.js — light / dark / system appearance.
 *
 * The *applied* theme is set before first paint by the inline bootstrap in
 * index.html (it reads the same preference key), so this module only owns the
 * switch on the profile screen, the live response to the OS changing its mind,
 * and keeping <meta name="theme-color"> in step with the browser chrome.
 */
import { getPref, setPref } from './prefs.js';

const PREF_KEY = 'theme';
const CHOICES = ['light', 'dark', 'system'];
const THEME_COLORS = { light: '#0056f8', dark: '#101828' };

const media = window.matchMedia('(prefers-color-scheme: dark)');
const meta = document.getElementById('theme-color-meta');
const group = document.getElementById('theme-switch');
const buttons = group ? [...group.querySelectorAll('[data-theme-choice]')] : [];

function currentChoice() {
  const stored = getPref(PREF_KEY, 'system');
  return CHOICES.includes(stored) ? stored : 'system';
}

function resolve(choice) {
  if (choice === 'light' || choice === 'dark') return choice;
  return media.matches ? 'dark' : 'light';
}

function apply(choice) {
  const resolved = resolve(choice);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeChoice = choice;
  if (meta) meta.content = THEME_COLORS[resolved];

  buttons.forEach((button) => {
    const selected = button.dataset.themeChoice === choice;
    button.setAttribute('aria-checked', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
}

function select(choice) {
  setPref(PREF_KEY, choice); // a preference, not user data — localStorage is the right home
  apply(choice);
}

buttons.forEach((button, index) => {
  button.addEventListener('click', () => select(button.dataset.themeChoice));
  // Radio-group keyboard semantics: arrows move and select.
  button.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = buttons[(index + step + buttons.length) % buttons.length];
    select(next.dataset.themeChoice);
    next.focus();
  });
});

// Only meaningful while the choice is "system".
const onSystemChange = () => {
  if (currentChoice() === 'system') apply('system');
};
if (media.addEventListener) media.addEventListener('change', onSystemChange);
else if (media.addListener) media.addListener(onSystemChange); // Safari < 14

apply(currentChoice());
