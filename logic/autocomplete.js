/**
 * autocomplete.js — a small keyboard-accessible combobox binder.
 * Arrow keys move the active option, Enter selects it, Escape closes the
 * list, and the active option gets a visible focus style (see
 * .search-suggest-item.active in style.css) while focus stays on the input.
 *
 * Purely a UI binder: it knows nothing about stations or the rail engine —
 * `search` and `onPick` are supplied by the caller.
 */
export function bindAutocomplete(input, listEl, { search, onPick, limit = 8 }) {
  let items = [];
  let activeIndex = -1;

  function renderItems(results) {
    items = results;
    activeIndex = -1;
    listEl.innerHTML = '';
    results.forEach((item, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.id = `${listEl.id}-opt-${i}`;
      li.className = 'search-suggest-item';
      const name = document.createElement('span');
      name.className = 'search-suggest-name';
      name.textContent = item.name;
      const code = document.createElement('span');
      code.className = 'search-suggest-code';
      code.textContent = item.code;
      li.append(name, code);
      li.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep input focus so blur doesn't close the list first
        pick(item);
      });
      listEl.appendChild(li);
    });
    const open = results.length > 0;
    listEl.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    input.removeAttribute('aria-activedescendant');
  }

  function setActive(i) {
    const opts = listEl.querySelectorAll('.search-suggest-item');
    opts.forEach((el) => el.classList.remove('active'));
    activeIndex = i;
    if (i >= 0 && i < opts.length) {
      opts[i].classList.add('active');
      opts[i].scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', opts[i].id);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function close() {
    listEl.hidden = true;
    listEl.innerHTML = '';
    items = [];
    activeIndex = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function pick(item) {
    onPick(item);
    close();
  }

  input.addEventListener('input', () => {
    onPick(null); // typing invalidates any prior selection
    const q = input.value.trim();
    if (!q) { close(); return; }
    renderItems(search(q, limit));
  });

  input.addEventListener('keydown', (e) => {
    if (listEl.hidden) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const q = input.value.trim();
        if (q) renderItems(search(q, limit));
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0) { e.preventDefault(); pick(items[activeIndex]); }
      else if (items.length === 1) { e.preventDefault(); pick(items[0]); }
    } else if (e.key === 'Escape') {
      close();
    }
  });

  input.addEventListener('blur', () => {
    // Deferred so a mousedown-triggered pick() above still lands first.
    setTimeout(close, 100);
  });

  return { close };
}
