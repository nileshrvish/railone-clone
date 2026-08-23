(function () {
  'use strict';

  var views = {
    home: document.getElementById('view-home'),
    bookings: document.getElementById('view-bookings'),
    search: document.getElementById('view-search'),
    profile: document.getElementById('view-profile'),
    ticket: document.getElementById('view-ticket')
  };

  function showView(name) {
    Object.keys(views).forEach(function (key) {
      views[key].classList.toggle('active', key === name);
    });
    var scrollEl = views[name].querySelector('.scroll');
    if (scrollEl) scrollEl.scrollTop = 0;

    if (name === 'ticket') {
      startCountdown();
    } else {
      stopCountdown();
    }
  }

  // ---- Home bottom nav ----
  document.querySelectorAll('.nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-nav');
      if (target === 'bookings') {
        showView('bookings');
      } else if (target === 'you') {
        showView('profile');
      }
      // "menu" is intentionally not implemented per scope.
    });
  });

  // ---- Back buttons ----
  document.querySelectorAll('[data-back]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      showView(btn.getAttribute('data-back'));
    });
  });

  // ---- View Details -> Digital Ticket ----
  document.querySelectorAll('[data-open-ticket]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      showView('ticket');
    });
  });

  // ---- Unreserved planner card -> Search form ----
  document.querySelectorAll('[data-open-search]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      showView('search');
    });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showView('search');
      }
    });
  });

  // ---- My Bookings status tabs ----
  var tabButtons = document.querySelectorAll('.tab-item');
  var bookingsList = document.getElementById('bookings-list');
  var bookingsEmpty = document.getElementById('bookings-empty');
  var bookingsCount = document.getElementById('bookings-count');

  tabButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      tabButtons.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var tab = btn.getAttribute('data-tab-switch');
      var hasData = tab === 'upcoming';
      bookingsList.hidden = !hasData;
      bookingsEmpty.hidden = hasData;
      var label = tab.charAt(0).toUpperCase() + tab.slice(1);
      bookingsCount.textContent = hasData
        ? 'Upcoming (' + bookingsList.querySelectorAll('.ticket-card').length + ')'
        : label + ' (0)';
    });
  });

  // ================= Countdown with per-digit flip =================
  var COUNTDOWN_START = 4 * 60 + 59; // 05:00

  var slots = {
    m1: makeDigit('m1'),
    m2: makeDigit('m2'),
    s1: makeDigit('s1'),
    s2: makeDigit('s2')
  };

  function makeDigit(name) {
    var el = document.querySelector('.digit[data-slot="' + name + '"]');
    return {
      el: el,
      cur: el.querySelector('.d-cur'),
      next: el.querySelector('.d-next')
    };
  }

  function setDigit(slot, value) {
    if (slot.cur.textContent === value) return;

    // reset to a clean (non-transitioning) state
    slot.el.classList.remove('animate', 'shift');
    slot.next.textContent = value;
    // force reflow so the class removal above is committed before we re-add
    void slot.el.offsetWidth;

    slot.el.classList.add('animate');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        slot.el.classList.add('shift');
      });
    });

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      slot.cur.textContent = value;
      slot.el.classList.remove('animate', 'shift');
      slot.cur.removeEventListener('transitionend', finish);
    }
    slot.cur.addEventListener('transitionend', finish);
    // safety fallback in case transitionend doesn't fire
    setTimeout(finish, 400);
  }

  var remaining = COUNTDOWN_START;
  var timerId = null;
  var progressFill = document.querySelector('.dt-in-progress');

  function renderProgress(seconds) {
    if (!progressFill) return;
    var pct = ((COUNTDOWN_START - seconds) / COUNTDOWN_START) * 100;
    progressFill.style.width = pct + '%';
  }

  function render(seconds) {
    var mm = Math.floor(seconds / 60);
    var ss = seconds % 60;
    var mmStr = String(mm).padStart(2, '0');
    var ssStr = String(ss).padStart(2, '0');
    setDigit(slots.m1, mmStr[0]);
    setDigit(slots.m2, mmStr[1]);
    setDigit(slots.s1, ssStr[0]);
    setDigit(slots.s2, ssStr[1]);
    renderProgress(seconds);
  }

  function startCountdown() {
    stopCountdown();
    remaining = COUNTDOWN_START;
    renderInstant(remaining);
    timerId = setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) {
        remaining = 0;
        render(remaining);
        stopCountdown();
        return;
      }
      render(remaining);
    }, 1000);
  }

  function renderInstant(seconds) {
    var mm = Math.floor(seconds / 60);
    var ss = seconds % 60;
    var mmStr = String(mm).padStart(2, '0');
    var ssStr = String(ss).padStart(2, '0');
    [['m1', mmStr[0]], ['m2', mmStr[1]], ['s1', ssStr[0]], ['s2', ssStr[1]]].forEach(function (pair) {
      var slot = slots[pair[0]];
      slot.el.classList.remove('animate', 'shift');
      slot.cur.textContent = pair[1];
      slot.next.textContent = pair[1];
    });
    if (progressFill) {
      progressFill.style.transition = 'none';
      renderProgress(seconds);
      void progressFill.offsetWidth;
      progressFill.style.transition = '';
    }
  }

  function stopCountdown() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  // ================= QR-style placeholder graphic =================
  function drawQr() {
    var canvas = document.getElementById('qr-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var size = 29; // modules per side
    var cell = canvas.width / size;
    var seed = 987654321;
    function rand() {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return ((seed < 0 ? ~seed + 1 : seed) % 1000) / 1000;
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1a1a2e';

    var grid = [];
    for (var y = 0; y < size; y++) {
      grid[y] = [];
      for (var x = 0; x < size; x++) {
        grid[y][x] = rand() > 0.55 ? 1 : 0;
      }
    }

    function drawFinder(ox, oy) {
      for (var y = -1; y <= 7; y++) {
        for (var x = -1; x <= 7; x++) {
          var gx = ox + x, gy = oy + y;
          if (gx < 0 || gy < 0 || gx >= size || gy >= size) continue;
          var on = (x >= 0 && x <= 6 && y >= 0 && y <= 6) &&
            (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
          grid[gy][gx] = on ? 1 : 0;
        }
      }
    }
    drawFinder(0, 0);
    drawFinder(size - 7, 0);
    drawFinder(0, size - 7);

    for (var yy = 0; yy < size; yy++) {
      for (var xx = 0; xx < size; xx++) {
        if (grid[yy][xx]) {
          ctx.fillRect(xx * cell, yy * cell, cell, cell);
        }
      }
    }
  }

  drawQr();

  // Minimal hook for logic/search-form.js (an ES module, loaded separately)
  // to navigate to the digital ticket view once it has rendered real data.
  window.RailOneApp = { showView: showView };
})();
