/**
 * feedback-form.js — the "How was your ticket booking experience?" rating +
 * description form at the bottom of the digital ticket. Purely a UI module:
 * no persistence, nothing asked for it — just the star rating, the live
 * character counter, and the disabled-until-rated Submit button.
 */
const els = {
  stars: document.getElementById('star-rating'),
  starBtns: [...document.querySelectorAll('.star-btn')],
  desc: document.getElementById('feedback-desc'),
  count: document.getElementById('feedback-count'),
  submit: document.getElementById('feedback-submit'),
  note: document.getElementById('feedback-note'),
};

let rating = 0;

function paint(upTo) {
  els.starBtns.forEach((btn) => {
    const value = Number(btn.dataset.value);
    btn.classList.toggle('filled', value <= upTo);
  });
}

function setRating(value) {
  rating = value;
  // A radio group: exactly one option is checked, and only it is tabbable, so
  // Tab moves past the whole group and arrows move within it.
  els.starBtns.forEach((btn) => {
    const isValue = Number(btn.dataset.value) === value;
    btn.setAttribute('aria-checked', String(isValue));
    btn.tabIndex = isValue ? 0 : -1;
  });
  paint(value);
  els.submit.disabled = rating === 0;
}

els.starBtns.forEach((btn, index) => {
  const value = Number(btn.dataset.value);
  btn.addEventListener('click', () => setRating(value));
  btn.addEventListener('mouseenter', () => paint(value));
  btn.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = els.starBtns[(index + step + els.starBtns.length) % els.starBtns.length];
    setRating(Number(next.dataset.value));
    next.focus();
  });
});
els.stars.addEventListener('mouseleave', () => paint(rating));

els.desc.addEventListener('input', () => {
  els.count.textContent = `${els.desc.value.length}/200`;
});

els.submit.addEventListener('click', () => {
  if (rating === 0) return;
  els.note.textContent = 'Thanks for your feedback!';
  els.note.hidden = false;
  els.submit.disabled = true;
  els.desc.disabled = true;
  els.starBtns.forEach((btn) => { btn.disabled = true; });
  els.stars.setAttribute('aria-disabled', 'true');
});
