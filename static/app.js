/* MAC Admin Portal — front end */
'use strict';

var TOKEN = null, ME = null, BOOT = null;
var UNREAD = 0;
var INVOICE_NOTES = '';
try { TOKEN = localStorage.getItem('mac_token'); } catch (e) { TOKEN = null; }

/* ------------------------------------------------------------- intro */
/* The passport animation plays once per browser session. Staff signing in and
   out through the day should not sit through it every time, and it must never
   stand between them and the form — so it is removed on click, on Escape, and
   on a timer regardless of whether the animation finished. */
(function () {
  var el = document.getElementById('intro');
  if (!el) return;
  var seen = false;
  try { seen = sessionStorage.getItem('mac_intro') === '1'; } catch (e) { }
  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (seen || reduced) { el.parentNode.removeChild(el); return; }
  try { sessionStorage.setItem('mac_intro', '1'); } catch (e) { }
  var drop = function () { if (el.parentNode) el.parentNode.removeChild(el); };
  el.addEventListener('click', drop);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.key === 'Enter') drop();
  });
  setTimeout(drop, 2900);
})();

/* ------------------------------------------------------------- helpers */
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function val(id) { var e = $(id); return e ? String(e.value || '').trim() : ''; }
function num(id) { var e = $(id); return e ? Number(e.value || 0) : 0; }
function checked(id) { var e = $(id); return !!(e && e.checked); }

function money(n, cur) {
  var v = Number(n || 0);
  var code = cur || (BOOT && BOOT.org && BOOT.org.currency) ||
    (BOOT && BOOT.base_currency) || 'USD';
  var n = v.toLocaleString(undefined,
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var sym = '';
  if (BOOT && BOOT.currencies) {
    for (var i = 0; i < BOOT.currencies.length; i++) {
      if (BOOT.currencies[i].code === code) { sym = BOOT.currencies[i].symbol; break; }
    }
  }
  return (sym && sym.length <= 2) ? sym + n : code + ' ' + n;
}
function dt(s) {
  if (!s) return '—';
  var d = new Date(String(s).replace(' ', 'T') + (String(s).length <= 10 ? '' : 'Z'));
  if (isNaN(d)) return esc(s);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
function dtm(s) {
  if (!s) return '—';
  var d = new Date(String(s).replace(' ', 'T') + (String(s).length <= 10 ? '' : 'Z'));
  if (isNaN(d)) return esc(s);
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}
function ago(s) {
  if (!s) return '';
  var d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (isNaN(d)) return '';
  var mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  if (mins < 1440) return Math.round(mins / 60) + ' h ago';
  var days = Math.round(mins / 1440);
  if (days < 31) return days + (days === 1 ? ' day ago' : ' days ago');
  return dt(s);
}
function today() { return new Date().toISOString().slice(0, 10); }
function plusDays(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}
function initials(name) {
  return String(name || '?').split(/\s+/).map(function (w) { return w[0]; })
    .slice(0, 2).join('').toUpperCase();
}
/* A dropdown must never quietly discard a value it does not recognise.
   Records created before a list changed — or typed straight into the website
   form — keep whatever they hold, shown as an extra option, so opening a file
   and pressing Save cannot erase it. */
function optsKeeping(list, selected, blank) {
  var sel = String(selected === null || selected === undefined ? '' : selected);
  var known = (list || []).some(function (o) {
    return String(typeof o === 'object' ? o.value : o) === sel;
  });
  if (sel && !known) list = [sel].concat(list || []);
  return opts(list, selected, blank);
}

function opts(list, selected, blank) {
  var out = blank ? '<option value="">' + esc(blank) + '</option>' : '';
  (list || []).forEach(function (o) {
    var v = (typeof o === 'object') ? o.value : o;
    var l = (typeof o === 'object') ? o.label : o;
    out += '<option value="' + esc(v) + '"' +
      (String(v) === String(selected === null || selected === undefined ? '' : selected)
        ? ' selected' : '') + '>' + esc(l) + '</option>';
  });
  return out;
}
/* Same rule as the server, so a typo is caught before the request is sent. */
function emailProblem(value, required) {
  var v = String(value || '').trim();
  if (!v) return required ? 'An email address is required.' : null;
  if (v.length > 200) return 'That email address is too long.';
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v)) {
    return 'That email address does not look right — check for a typo.';
  }
  return null;
}

/* ---- dates -------------------------------------------------------------
   A native date box gives a real calendar and the operating system's own
   typing rules, which is what people are used to. What it does not give is
   certainty about whether 05/09 means September or May, so every date field
   echoes the choice back in words underneath. */
function dateField(id, label, value, hint) {
  return '<div class="field"><label class="lbl" for="' + id + '">' + esc(label) +
    '</label><input class="inp date-in" id="' + id + '" type="date" value="' +
    esc(value || '') + '" data-echo="' + id + '_e">' +
    '<div class="date-echo" id="' + id + '_e"></div>' +
    (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>';
}

function longDate(iso) {
  if (!iso) return '';
  var d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function wireDates(root) {
  (root || document).querySelectorAll('.date-in').forEach(function (el) {
    var echo = document.getElementById(el.dataset.echo);
    if (!echo) return;
    var show = function () {
      echo.textContent = el.value ? longDate(el.value) : '';
    };
    el.addEventListener('input', show);
    el.addEventListener('change', show);
    show();
  });
}

/* ---- "Other" always asks what ------------------------------------------
   A dropdown that stops at "Other" throws away the answer. Choosing it opens
   a box to say what, and what is typed is what gets stored — so a file reads
   "Special permit under s.12", not "Other". */
function selectOther(id, list, value, blank) {
  var known = (list || []).some(function (o) {
    return String(typeof o === 'object' ? o.value : o) ===
           String(value === null || value === undefined ? '' : value);
  });
  var isOther = !!value && !known;
  return '<select class="inp" id="' + id + '" data-other="' + id + '_o">' +
    opts(list, isOther ? 'Other' : value, blank) + '</select>' +
    '<input class="inp other-in" id="' + id + '_o" placeholder="Please say what"' +
    (isOther ? ' value="' + esc(value) + '"' : '') +
    (isOther ? '' : ' hidden') + '>';
}

function wireOthers(root) {
  (root || document).querySelectorAll('[data-other]').forEach(function (sel) {
    var box = document.getElementById(sel.dataset.other);
    if (!box) return;
    var sync = function () {
      var other = /^other$/i.test(sel.value);
      box.hidden = !other;
      if (!other) box.value = '';
      else setTimeout(function () { box.focus(); }, 40);
    };
    sel.addEventListener('change', sync);
  });
}

/* The typed answer wins over the word "Other". */
function valOther(id) {
  var sel = $(id), box = $(id + '_o');
  if (!sel) return '';
  var v = String(sel.value || '').trim();
  if (/^other$/i.test(v) && box && String(box.value || '').trim()) {
    return String(box.value).trim();
  }
  return v;
}

function toast(msg, kind) {
  var el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(function () { el.remove(); }, 4200);
}

/* ------------------------------------------------------- loading overlay */
function showLoading(word, note) {
  hideLoading();
  var el = document.createElement('div');
  el.className = 'loading-veil';
  el.id = 'loadingVeil';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<div class="loading-ring" aria-hidden="true"></div>' +
    '<div class="loading-word">' + esc(word || 'Please wait') + '</div>' +
    (note ? '<div class="loading-note">' + esc(note) + '</div>' : '');
  document.body.appendChild(el);
}
function hideLoading() {
  var el = $('loadingVeil');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

/* ------------------------------------------------------------- api */
/* Every button and the sign-in form go through here.

   The portal always answers in JSON. So a reply that is not JSON did not come
   from the portal at all — it came from the hosting platform in front of it,
   which serves its own error page while the service is asleep, redeploying or
   restarting. That was surfacing to staff as "Request failed (404)" at random
   moments on any button.

   Because such a reply proves the request never reached the portal, retrying
   is safe even for a payment or a new client: nothing was processed. Only
   platform replies are retried; a genuine refusal from the portal is passed
   straight back with its own message. */
var WAKE_WAITS = [700, 1600, 3200];        // three retries, then give up

function isJson(r) {
  return (r.headers.get('content-type') || '').indexOf('application/json') >= 0;
}

function api(path, body, method) {
  var opt = {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' }
  };
  if (TOKEN) opt.headers.Authorization = 'Bearer ' + TOKEN;
  if (body) opt.body = JSON.stringify(body);

  function attempt(n) {
    return fetch(path, opt).then(function (r) {
      if (!isJson(r)) {
        if (n < WAKE_WAITS.length) {
          return new Promise(function (go) { setTimeout(go, WAKE_WAITS[n]); })
            .then(function () { return attempt(n + 1); });
        }
        throw new Error(unreachableMessage(r.status));
      }
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 401 && TOKEN) {
          signOut(true);
          throw new Error(d.error || 'Your session has expired. Please sign in again.');
        }
        if (!r.ok) throw new Error(d.error || 'That did not work. Please try again.');
        return d;
      });
    }, function () {
      // the network itself failed: no reply at all, so retrying is safe
      if (n < WAKE_WAITS.length) {
        return new Promise(function (go) { setTimeout(go, WAKE_WAITS[n]); })
          .then(function () { return attempt(n + 1); });
      }
      throw new Error('No connection to the portal. Check your internet and try again.');
    });
  }
  return attempt(0);
}

function unreachableMessage(status) {
  if (status === 502 || status === 503 || status === 504) {
    return 'The portal is starting up. This can take up to a minute when it ' +
      'has been idle. Please try again in a moment.';
  }
  return 'The portal is not responding yet — it may be waking up or ' +
    'redeploying. Please wait a moment and try again.';
}

/* ------------------------------------------------------------- sign in */
var CHALLENGE = null;          // set when the account asks for a code

function askForCode(recoveryAvailable) {
  CHALLENGE = CHALLENGE || null;
  $('codePill').hidden = false;
  $('codeHint').hidden = false;
  $('loginBtn').textContent = 'Verify';
  $('email').readOnly = true;
  $('password').readOnly = true;
  if (!recoveryAvailable) {
    $('codeHint').innerHTML = 'Open your authenticator app and enter the code ' +
      'for <b>Migration Advisory Centre</b>.';
  }
  setTimeout(function () { $('code').focus(); }, 60);
}

function resetSignIn() {
  CHALLENGE = null;
  $('codePill').hidden = true;
  $('codeHint').hidden = true;
  $('code').value = '';
  $('email').readOnly = false;
  $('password').readOnly = false;
  $('loginBtn').textContent = 'Sign In';
}

$('loginForm').addEventListener('submit', function (ev) {
  ev.preventDefault();
  var btn = $('loginBtn'), msg = $('loginMsg');
  msg.hidden = true;

  // second step: we already have a challenge, so send the code
  if (CHALLENGE) {
    if (!val('code')) { toast('Enter the code from your app.', 'bad'); return; }
    btn.disabled = true; btn.textContent = 'Checking…';
    showLoading('Checking your code');
    api('/api/login/verify', { challenge: CHALLENGE, code: val('code') })
      .then(function (d) {
        CHALLENGE = null;
        TOKEN = d.token;
        try { localStorage.setItem('mac_token', TOKEN); } catch (e) { }
        $('password').value = ''; $('code').value = '';
        return start().then(function () {
          if (d.notice) toast(d.notice, 'ok');
        });
      })
      .catch(function (err) {
        msg.textContent = err.message;
        msg.hidden = false;
        if (/expired|start again/i.test(err.message)) resetSignIn();
        $('code').value = '';
      })
      .then(function () {
        hideLoading();
        btn.disabled = false;
        btn.textContent = CHALLENGE ? 'Verify' : 'Sign In';
      });
    return;
  }

  btn.disabled = true; btn.textContent = 'Signing in…';
  showLoading('Signing in',
    'The portal sleeps when it is not in use. The first sign in of the day ' +
    'can take up to a minute to wake it.');
  api('/api/login', { email: val('email'), password: $('password').value })
    .then(function (d) {
      if (d.twofa_required) {
        CHALLENGE = d.challenge;
        askForCode(d.recovery_available);
        return;
      }
      TOKEN = d.token;
      try { localStorage.setItem('mac_token', TOKEN); } catch (e) { }
      $('password').value = '';
      return start();
    })
    .catch(function (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    })
    .then(function () {
      hideLoading();
      btn.disabled = false;
      btn.textContent = CHALLENGE ? 'Verify' : 'Sign In';
    });
});

function signOut(silent) {
  var done = function () {
    TOKEN = null; ME = null;
    hideLoading();
    if (typeof resetSignIn === 'function') resetSignIn();
    try { localStorage.removeItem('mac_token'); } catch (e) { }
    $('app').hidden = true;
    $('signin').style.display = '';
    if (!silent) toast('Signed out.');
  };
  if (TOKEN && !silent) { api('/api/logout', {}).catch(function () { }).then(done); }
  else done();
}

/* ------------------------------------------------- background photograph */
/* login.png is optional. Only dress the page for a photograph once one has
   actually loaded — otherwise the pale veil flattens the brand gradient into
   plain grey and the dark text on it is hard to read. */
(function () {
  var panel = $('signin');
  if (!panel || typeof fetch !== 'function') return;
  fetch('/login.png', { method: 'HEAD' }).then(function (r) {
    var type = r.headers.get('content-type') || '';
    if (r.ok && type.indexOf('image/') === 0) panel.classList.add('has-photo');
  }).catch(function () { /* no photograph: the gradient stands alone */ });
})();

/* ------------------------------------------------ show / hide password */
(function () {
  var btn = $('pwToggle'), input = $('password');
  if (!btn || !input) return;
  btn.onclick = function () {
    var showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.classList.toggle('on', !showing);
    btn.setAttribute('aria-pressed', String(!showing));
    btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    input.focus();
  };
})();

/* ------------------------------------------------------------- chrome */
var NAV = [
  ['Daily work', [
    ['dashboard', '▤', 'Dashboard'],
    ['enquiries', '✉', 'Enquiries'],
    ['tasks', '✓', 'Tasks'],
    ['calendar', '◷', 'Consultations']
  ]],
  ['Casework', [
    ['clients', '👤', 'Clients'],
    ['cases', '🗂', 'Cases'],
    ['services', '📋', 'Requirements & fees'],
    ['forms', '📎', 'Forms'],
    ['expiries', '⏳', 'Renewals'],
    ['payments', '₤', 'Payments'],
    ['accounts', '🧾', 'Accounts'],
    ['analytics', '🌍', 'Analytics']
  ]],
  ['Office', [
    ['reports', '📄', 'Reports'],
    ['users', '👥', 'Staff'],
    ['settings', '⚙', 'Settings'],
    ['system', '🩺', 'System'],
    ['audit', '🕘', 'Activity log']
  ], 'owner']
];

function paintChrome() {
  $('avatar').textContent = initials(ME.name);
  $('whoName').textContent = ME.name;
  $('whoRole').textContent = ME.role === 'owner' ? 'Account owner' : 'Administrator';
  $('verLabel').textContent = 'MAC Portal · ' + BOOT.version;
  var html = '';
  NAV.forEach(function (group) {
    // a group can be limited to one role; Office is owner-only
    if (group[2] && ME.role !== group[2]) return;
    html += '<div class="nav-label">' + esc(group[0]) + '</div>';
    group[1].forEach(function (it) {
      var pill = (it[0] === 'enquiries' && UNREAD)
        ? '<span class="pill" id="navUnread">' + UNREAD + '</span>' : '';
      html += '<a href="#/' + it[0] + '" data-k="' + it[0] + '"><span class="ic">' +
        it[1] + '</span>' + esc(it[2]) + pill + '</a>';
    });
  });
  html += '<div class="nav-label">Account</div>' +
    '<a href="#/profile" data-k="profile"><span class="ic">⚙</span>My profile</a>' +
    '<a href="#" id="navOut"><span class="ic">⎋</span>Sign out</a>';
  $('nav').innerHTML = html;
  $('navOut').onclick = function (e) { e.preventDefault(); signOut(); };
}

function setActive(key, title) {
  var links = document.querySelectorAll('#nav a');
  for (var i = 0; i < links.length; i++) {
    links[i].classList.toggle('active', links[i].dataset.k === key);
  }
  $('pageTitle').textContent = title;
  document.title = title + ' · MAC Admin Portal';
  $('sidebar').classList.remove('open');
  $('backdrop').classList.remove('show');
}
function loading(msg) {
  $('view').innerHTML = '<div class="loading">' + esc(msg || 'Loading…') + '</div>';
}
function failed(err) {
  $('view').innerHTML = '<div class="notice">' + esc(err.message || String(err)) + '</div>';
}
$('burger').onclick = function () {
  $('sidebar').classList.add('open'); $('backdrop').classList.add('show');
};
$('backdrop').onclick = function () {
  $('sidebar').classList.remove('open'); $('backdrop').classList.remove('show');
};

/* ------------------------------------------------------------- modal */
var modalOnClose = null;
function modal(title, bodyHtml, footHtml, wide) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = bodyHtml;
  $('modalFoot').innerHTML = footHtml === undefined
    ? '<button class="btn" onclick="closeModal()">Close</button>' : footHtml;
  document.querySelector('.modal').classList.toggle('wide', !!wide);
  $('modalRoot').hidden = false;
  wireDates($('modalBody'));
  wireOthers($('modalBody'));
}
function closeModal() {
  $('modalRoot').hidden = true;
  $('modalBody').innerHTML = '';
  if (modalOnClose) { var f = modalOnClose; modalOnClose = null; f(); }
}
$('modalX').onclick = closeModal;
$('modalBack').onclick = closeModal;
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && !$('modalRoot').hidden) closeModal();
});

function confirmAction(title, message, label, fn) {
  modal(title, '<p>' + esc(message) + '</p>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-danger" id="confirmGo">' + esc(label) + '</button>');
  $('confirmGo').onclick = function () { closeModal(); fn(); };
}

/* ------------------------------------------------------------- search */
var searchTimer = null;
$('globalSearch').addEventListener('input', function () {
  var q = this.value.trim();
  clearTimeout(searchTimer);
  if (q.length < 3) { $('searchResults').hidden = true; return; }
  searchTimer = setTimeout(function () {
    api('/api/search?q=' + encodeURIComponent(q)).then(function (d) {
      var box = $('searchResults');
      if (!d.results.length) {
        box.innerHTML = '<a href="#" onclick="return false"><b>No matches</b>' +
          '<small>Try a reference, surname or passport number.</small></a>';
      } else {
        box.innerHTML = d.results.map(function (r) {
          var href = r.type === 'client' ? '#/client/' + r.id
            : r.type === 'case' ? '#/case/' + r.id : '#/enquiries';
          return '<a href="' + href + '" onclick="document.getElementById(\'searchResults\').hidden=true">' +
            '<b>' + esc(r.label) + '</b><small>' + esc(r.ref) + ' · ' +
            esc(r.sub || r.type) + '</small></a>';
        }).join('');
      }
      box.hidden = false;
    }).catch(function () { });
  }, 260);
});
document.addEventListener('click', function (e) {
  if (!e.target.closest('.search-wrap')) $('searchResults').hidden = true;
});

/* ------------------------------------------------------------- router */
var OWNER_ONLY = ['reports', 'users', 'settings', 'system', 'audit'];

var ROUTES = {
  dashboard: viewDashboard, enquiries: viewEnquiries, clients: viewClients,
  cases: viewCases, services: viewServices, payments: viewPayments,
  accounts: viewAccounts, analytics: viewAnalytics, forms: viewForms,
  tasks: viewTasks,
  calendar: viewCalendar, expiries: viewExpiries, reports: viewReports,
  users: viewUsers, settings: viewSettings, system: viewSystem,
  audit: viewAudit, profile: viewProfile
};

function router() {
  if (!ME) return;
  var hash = (location.hash || '#/dashboard').slice(2);
  var parts = hash.split('/');
  var key = parts[0] || 'dashboard';
  if (key === 'client' && parts[1]) return viewClient(parts[1]);
  if (key === 'case' && parts[1]) return viewCase(parts[1]);
  var fn = ROUTES[key];
  if (!fn) { location.hash = '#/dashboard'; return; }
  if (OWNER_ONLY.indexOf(key) >= 0 && ME.role !== 'owner') {
    location.hash = '#/dashboard';
    toast('That section is for the account owner.', 'bad');
    return;
  }
  fn();
}
window.addEventListener('hashchange', router);

function refreshUnread() {
  api('/api/bootstrap').then(function (d) {
    UNREAD = d.unread; BOOT = d; INVOICE_NOTES = d.invoice_notes || '';
    paintChrome();
    setActive((location.hash || '#/dashboard').slice(2).split('/')[0], $('pageTitle').textContent);
  }).catch(function () { });
}

/* ------------------------------------------------------------- boot */
function start() {
  return api('/api/bootstrap').then(function (d) {
    BOOT = d; ME = d.user; UNREAD = d.unread;
    INVOICE_NOTES = d.invoice_notes || '';
    $('signin').style.display = 'none';
    $('app').hidden = false;
    paintChrome();
    if (!location.hash) location.hash = '#/dashboard';
    router();
    if (ME.must_change) openPasswordModal(true);
  });
}

if (TOKEN) {
  // A returning visitor with a live session: show the same overlay rather
  // than a blank page while the portal wakes and the first data arrives.
  showLoading('Opening the portal');
  start()
    .catch(function () {
      TOKEN = null;
      try { localStorage.removeItem('mac_token'); } catch (e) { }
    })
    .then(hideLoading, hideLoading);
}
fetch('/healthz').then(function (r) { return r.json(); })
  .then(function (d) { $('signinVer').textContent = 'MAC Admin Portal · ' + d.version; })
  .catch(function () { });

/* ============================================================ DASHBOARD */
function viewDashboard() {
  setActive('dashboard', 'Dashboard');
  loading('Reading the case book…');
  api('/api/dashboard').then(function (d) {
    var k = d.kpis, cur = d.currency;
    var kpi = function (n, label, cls, href) {
      return '<div class="kpi ' + (cls || '') + (href ? ' clickable' : '') + '"' +
        (href ? ' onclick="location.hash=\'' + href + '\'"' : '') +
        '><b>' + n + '</b><span>' + esc(label) + '</span></div>';
    };
    var html = '<div class="kpis">' +
      kpi(k.unread_enquiries, 'New enquiries waiting',
        k.unread_enquiries ? 'attn' : '', '#/enquiries') +
      kpi(k.open_cases, 'Open cases', '', '#/cases') +
      kpi(k.appts_today, 'Consultations today', '', '#/calendar') +
      kpi(k.tasks_overdue, 'Tasks overdue',
        k.tasks_overdue ? 'alert' : '', '#/tasks') +
      kpi(k.approved_month, 'Approved this month') +
      kpi(money(k.collected_month, cur), 'Collected this month', '', '#/payments') +
      '</div>';

    html += '<div class="cols"><div class="stack">';

    /* trend */
    html += '<div class="card"><h3>Enquiries and cases, last 12 months</h3>' +
      trendSvg(d.trend) +
      '<div class="legend"><span><i style="background:var(--brand-accent)"></i>Enquiries</span>' +
      '<span><i style="background:var(--brand-deep)"></i>Cases opened</span></div></div>';

    /* pipeline */
    var maxStage = Math.max.apply(null, d.by_stage.map(function (s) { return s.n; }).concat([1]));
    html += '<div class="card"><h3>Open cases by stage' +
      '<span class="right small"><a href="#/cases">See all cases</a></span></h3><div class="bars">' +
      d.by_stage.map(function (s) {
        return '<div class="bar-row"><div><span class="lab">' + esc(s.stage) + '</span>' +
          '<div class="track"><i style="width:' + (s.n / maxStage * 100) + '%"></i></div></div>' +
          '<span class="num">' + s.n + '</span></div>';
      }).join('') + '</div></div>';

    /* recent enquiries */
    html += '<div class="card"><h3>Latest from the website' +
      '<span class="right small"><a href="#/enquiries">Open inbox</a></span></h3>' +
      (d.recent_enquiries.length ? '<div class="tbl-wrap"><table><thead><tr>' +
        '<th>Reference</th><th>Name</th><th>Service</th><th>Received</th><th>Status</th>' +
        '</tr></thead><tbody>' + d.recent_enquiries.map(function (e) {
          return '<tr class="rowlink" onclick="openEnquiry(' + e.id + ')">' +
            '<td class="mono">' + esc(e.ref) + '</td>' +
            '<td>' + esc(e.first_name + ' ' + e.last_name) +
            '<span class="sub">' + esc(e.nationality || '') + '</span></td>' +
            '<td>' + esc(shortService(e.service)) + '</td>' +
            '<td>' + ago(e.created_at) + '</td>' +
            '<td>' + enqBadge(e.status) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : '<div class="empty"><b>No enquiries yet</b>Submissions from maclesotho.com will appear here.</div>') +
      '</div>';

    html += '</div><div class="stack">';

    /* expiries */
    html += '<div class="card"><h3>Expiring soon' +
      '<span class="right small"><a href="#/expiries">All renewals</a></span></h3>' +
      (d.expiries.length ? '<ul class="docs">' + d.expiries.slice(0, 8).map(function (x) {
        var cls = x.days < 0 ? 'bad' : (x.days <= 30 ? 'warn' : 'grey');
        var txt = x.days < 0 ? 'expired' : x.days + ' days';
        return '<li><div class="doc-name"><b>' + esc(x.first_name + ' ' + x.last_name) +
          '</b><span class="sub">' + esc(x.what) + ' · ' + dt(x.expires) + '</span></div>' +
          '<span class="badge ' + cls + '">' + txt + '</span></li>';
      }).join('') + '</ul>'
        : '<div class="empty">Nothing expiring in the warning window.</div>') + '</div>';

    /* appointments */
    html += '<div class="card"><h3>Next consultations' +
      '<span class="right small"><a href="#/calendar">Calendar</a></span></h3>' +
      (d.upcoming.length ? '<ul class="docs">' + d.upcoming.map(function (a) {
        return '<li><div class="doc-name"><b>' + esc(a.title) + '</b><span class="sub">' +
          esc((a.first_name || '') + ' ' + (a.last_name || '')) + ' · ' +
          dtm(a.starts_at) + '</span></div></li>';
      }).join('') + '</ul>' : '<div class="empty">No consultations booked.</div>') + '</div>';

    /* tasks */
    html += '<div class="card"><h3>Open tasks' +
      '<span class="right small"><a href="#/tasks">All tasks</a></span></h3>' +
      (d.my_tasks.length ? '<ul class="docs">' + d.my_tasks.map(function (t) {
        var late = t.due_date && t.due_date < today();
        return '<li><div class="doc-name"><b>' + esc(t.title) + '</b><span class="sub">' +
          (t.first_name ? esc(t.first_name + ' ' + t.last_name) + ' · ' : '') +
          (t.due_date ? 'due ' + dt(t.due_date) : 'no due date') + '</span></div>' +
          (late ? '<span class="badge bad">overdue</span>' : '') + '</li>';
      }).join('') + '</ul>' : '<div class="empty">Nothing outstanding.</div>') + '</div>';

    /* nationality mix */
    if (d.by_nationality.length) {
      var mx = Math.max.apply(null, d.by_nationality.map(function (r) { return r.n; }));
      html += '<div class="card"><h3>Clients by nationality</h3><div class="bars">' +
        d.by_nationality.map(function (r) {
          return '<div class="bar-row"><div><span class="lab">' + esc(r.nationality) +
            '</span><div class="track"><i style="width:' + (r.n / mx * 100) + '%"></i></div></div>' +
            '<span class="num">' + r.n + '</span></div>';
        }).join('') + '</div></div>';
    }

    html += '</div></div>';
    $('view').innerHTML = html;
  }).catch(failed);
}

function trendSvg(trend) {
  var W = 640, H = 132, pad = 22;
  var maxV = Math.max(1, Math.max.apply(null, trend.map(function (t) {
    return Math.max(t.enquiries, t.cases);
  })));
  var step = (W - pad * 2) / Math.max(1, trend.length - 1);
  var pts = function (field) {
    return trend.map(function (t, i) {
      return (pad + i * step).toFixed(1) + ',' +
        (H - pad - (t[field] / maxV) * (H - pad * 2)).toFixed(1);
    }).join(' ');
  };
  var area = 'M' + pad + ',' + (H - pad) + ' L' + pts('enquiries').replace(/ /g, ' L') +
    ' L' + (pad + (trend.length - 1) * step).toFixed(1) + ',' + (H - pad) + ' Z';
  return '<svg class="trend" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" ' +
    'role="img" aria-label="Monthly enquiries and cases">' +
    '<path class="area" d="' + area + '"/>' +
    '<polyline class="line" points="' + pts('enquiries') + '"/>' +
    '<polyline class="line2" points="' + pts('cases') + '"/>' +
    '<line class="ax" x1="' + pad + '" y1="' + (H - pad) + '" x2="' + (W - pad) +
    '" y2="' + (H - pad) + '"/>' +
    '<text x="' + pad + '" y="' + (H - 5) + '" font-size="10" fill="#6B7280">' +
    esc(trend[0] ? trend[0].month : '') + '</text>' +
    '<text x="' + (W - pad) + '" y="' + (H - 5) + '" font-size="10" fill="#6B7280" ' +
    'text-anchor="end">' + esc(trend.length ? trend[trend.length - 1].month : '') + '</text>' +
    '<text x="' + pad + '" y="12" font-size="10" fill="#6B7280">peak ' + maxV + '</text></svg>';
}

function shortService(s) {
  return String(s || '—').split('—')[0].trim();
}

/* ============================================================ ENQUIRIES */
var enqFilter = { status: 'new', q: '' };

function viewEnquiries() {
  setActive('enquiries', 'Enquiries from the website');
  loading('Opening the inbox…');
  var qs = '?status=' + enqFilter.status + '&q=' + encodeURIComponent(enqFilter.q);
  api('/api/enquiries' + qs).then(function (d) {
    var c = d.counts || {};
    var tabs = [['new', 'New', c['new'] || 0], ['reviewed', 'Reviewed', c.reviewed || 0],
    ['converted', 'Converted', c.converted || 0], ['archived', 'Archived', c.archived || 0],
    ['all', 'Everything', d.total]];
    var html = '<div class="tabs">' + tabs.map(function (t) {
      return '<button data-s="' + t[0] + '" class="' + (enqFilter.status === t[0] ? 'on' : '') +
        '">' + esc(t[1]) + ' <span class="muted">' + t[2] + '</span></button>';
    }).join('') + '</div>' +
      '<div class="filters"><input class="inp" id="enqQ" placeholder="Name, email, phone or reference" value="' +
      esc(enqFilter.q) + '"><button class="btn" id="enqSearch">Search</button>' +
      (enqFilter.q ? '<button class="btn" id="enqClear">Clear</button>' : '') +
      '<span class="row-end small muted">Submissions arrive here the moment someone ' +
      'sends the form on maclesotho.com.</span></div>';

    html += '<div class="card">' + (d.enquiries.length
      ? '<div class="tbl-wrap"><table><thead><tr><th>Reference</th><th>Name</th>' +
      '<th>Nationality</th><th>Service</th><th>Received</th><th>Status</th><th></th>' +
      '</tr></thead><tbody>' + d.enquiries.map(function (e) {
        return '<tr class="' + (e.status === 'new' ? 'unread ' : '') + 'rowlink" ' +
          'onclick="openEnquiry(' + e.id + ')">' +
          '<td class="mono">' + esc(e.ref) + '</td>' +
          '<td><b>' + esc((e.first_name + ' ' + e.last_name).trim() || '—') + '</b>' +
          '<span class="sub">' + esc(e.email || e.phone || '') + '</span></td>' +
          '<td>' + esc(e.nationality || '—') + '</td>' +
          '<td>' + esc(shortService(e.service)) +
          (e.destination ? '<span class="sub">to ' + esc(e.destination) + '</span>' : '') + '</td>' +
          '<td>' + ago(e.created_at) + '</td>' +
          '<td>' + enqBadge(e.status) + '</td>' +
          '<td class="num"><span class="muted">Open ›</span>' +
          ' <button class="btn btn-sm btn-danger" data-enqdel="' + e.id +
          '" title="Remove this enquiry">✕</button></td></tr>';
      }).join('') + '</tbody></table></div>'
      : emptyBox('No enquiries in this view',
        'When a visitor submits the consultation form on the website, their details ' +
        'land here straight away.')) + '</div>';

    $('view').innerHTML = html;
    var btns = document.querySelectorAll('.tabs button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].onclick = function () { enqFilter.status = this.dataset.s; viewEnquiries(); };
    }
    document.querySelectorAll('[data-enqdel]').forEach(function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();          // the row itself opens the enquiry
        confirmAction('Remove this enquiry?',
          'Meant for spam, duplicates and test submissions. If this is a real ' +
          'person, convert them to a client instead — that keeps the record.',
          'Remove', function () {
            api('/api/enquiries/' + b.dataset.enqdel, {}, 'DELETE')
              .then(function () { toast('Enquiry removed.'); viewEnquiries(); })
              .catch(function (e) { toast(e.message, 'bad'); });
          });
      };
    });
    $('enqSearch').onclick = function () { enqFilter.q = val('enqQ'); viewEnquiries(); };
    $('enqQ').onkeydown = function (e) { if (e.key === 'Enter') $('enqSearch').click(); };
    if ($('enqClear')) $('enqClear').onclick = function () { enqFilter.q = ''; viewEnquiries(); };
  }).catch(failed);
}

function enqBadge(s) {
  var m = { 'new': ['gold', 'New'], reviewed: ['info', 'Reviewed'],
            converted: ['ok', 'Converted'], archived: ['grey', 'Archived'],
            spam: ['grey', 'Spam'] };
  var x = m[s] || ['grey', s];
  return '<span class="badge ' + x[0] + '">' + esc(x[1]) + '</span>';
}
function emptyBox(title, msg) {
  return '<div class="empty"><b>' + esc(title) + '</b>' + esc(msg) + '</div>';
}

function openEnquiry(id) {
  api('/api/enquiries/' + id).then(function (d) {
    var e = d.enquiry;
    var row = function (k, v) {
      return v ? '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>' : '';
    };
    var body = '<dl class="kv">' +
      row('Reference', e.ref) +
      row('Received', dtm(e.created_at)) +
      row('Name', (e.first_name + ' ' + e.last_name).trim()) +
      row('Email', e.email) + row('Phone', e.phone) +
      row('Occupation', e.occupation) + row('Address', e.address) +
      row('Nationality', e.nationality) +
      row('Country of residence', e.country_residence) +
      row('Service requested', e.service) +
      row('Destination', e.destination) +
      row('Current permit', e.permit_status) +
      row('Years in Lesotho', e.years_in_lesotho) +
      row('Criminal record', e.criminal_record) +
      row('Previous rejection', e.prior_rejection) +
      row('Consent given', e.consent ? 'Yes' : 'Not recorded') +
      row('Source', e.source) +
      '</dl>' +
      (e.message ? '<div class="field" style="margin-top:14px"><span class="lbl">' +
        'Their situation</span><div class="code">' + esc(e.message) + '</div></div>' : '');

    var foot = '<span class="left">' + enqBadge(e.status) + '</span>';
    if (e.status !== 'converted') {
      foot += '<button class="btn" id="enqArchive">Archive</button>' +
        '<button class="btn btn-gold" id="enqConvert">Create client and case</button>';
    } else {
      foot += '<button class="btn btn-primary" onclick="closeModal();location.hash=\'#/client/' +
        e.client_id + '\'">Open the client</button>';
    }
    modal('Enquiry ' + e.ref, body, foot, true);
    modalOnClose = function () { refreshUnread(); if (location.hash.indexOf('enquir') > 0) viewEnquiries(); };

    if ($('enqArchive')) {
      $('enqArchive').onclick = function () {
        api('/api/enquiries/' + id + '/status', { status: 'archived' }).then(function () {
          toast('Enquiry archived.'); closeModal();
        }).catch(function (err) { toast(err.message, 'bad'); });
      };
    }
    if ($('enqConvert')) $('enqConvert').onclick = function () { convertForm(e); };
  }).catch(function (err) { toast(err.message, 'bad'); });
}

function convertForm(e) {
  modal('Create a client from ' + e.ref,
    '<p class="muted small">A client record is created from the submitted details, and a ' +
    'case is opened with the document checklist for the service below.</p>' +
    '<div class="field"><label class="lbl" for="cvService">Service</label>' +
    '<select class="inp" id="cvService">' + optsKeeping(BOOT.services, e.service) +
    '</select></div>' +
    '<div class="grid-2"><div class="field"><label class="lbl" for="cvDest">Destination country</label>' +
    '<input class="inp" id="cvDest" value="' + esc(e.destination || '') + '"></div>' +
    '<div class="field"><label class="lbl" for="cvAdvisor">Assigned advisor</label>' +
    '<select class="inp" id="cvAdvisor">' + opts(BOOT.advisors.map(function (a) {
      return { value: a.id, label: a.name };
    }), ME.id) + '</select></div></div>' +
    '<label class="small"><input type="checkbox" id="cvOpen" checked> Open a case now</label>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-gold" id="cvGo">Create client</button>');
  $('cvGo').onclick = function () {
    this.disabled = true;
    api('/api/enquiries/' + e.id + '/convert', {
      service: val('cvService'), destination: val('cvDest'),
      advisor_id: val('cvAdvisor'), open_case: checked('cvOpen')
    }).then(function (d) {
      modalOnClose = null; closeModal(); refreshUnread();
      toast('Client ' + d.ref + ' created.', 'ok');
      location.hash = '#/client/' + d.client_id;
    }).catch(function (err) { toast(err.message, 'bad'); $('cvGo').disabled = false; });
  };
}

/* ============================================================== CLIENTS */
var clientFilter = { q: '', status: 'all', nationality: '' };

function viewClients() {
  setActive('clients', 'Clients');
  loading('Fetching the client register…');
  var qs = '?q=' + encodeURIComponent(clientFilter.q) + '&status=' + clientFilter.status +
    '&nationality=' + encodeURIComponent(clientFilter.nationality);
  api('/api/clients' + qs).then(function (d) {
    var html = '<div class="filters">' +
      '<input class="inp" id="clQ" placeholder="Name, reference, passport, phone" value="' +
      esc(clientFilter.q) + '">' +
      '<select class="inp" id="clStatus">' + opts([
        { value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' },
        { value: 'dormant', label: 'Dormant' }, { value: 'closed', label: 'Closed' }
      ], clientFilter.status) + '</select>' +
      '<select class="inp" id="clNat">' + opts(d.nationalities, clientFilter.nationality,
        'All nationalities') + '</select>' +
      '<button class="btn" id="clGo">Apply</button>' +
      '<button class="btn btn-gold row-end" id="clAdd">Add a client</button></div>';

    html += '<div class="card">' + (d.clients.length
      ? '<div class="tbl-wrap"><table><thead><tr><th>Reference</th><th>Name</th>' +
      '<th>Nationality</th><th>Permit expires</th><th>Cases</th><th class="num">Paid</th>' +
      '<th>Status</th></tr></thead><tbody>' + d.clients.map(function (c) {
        var dayz = c.permit_expiry ? daysTo(c.permit_expiry) : null;
        return '<tr class="rowlink" onclick="location.hash=\'#/client/' + c.id + '\'">' +
          '<td class="mono">' + esc(c.ref) + '</td>' +
          '<td><b>' + esc(c.first_name + ' ' + c.last_name) + '</b>' +
          '<span class="sub">' + esc(c.email || c.phone || '') + '</span></td>' +
          '<td>' + esc(c.nationality || '—') + '</td>' +
          '<td>' + (c.permit_expiry ? dt(c.permit_expiry) +
            (dayz !== null && dayz <= 60 ? ' <span class="badge ' +
              (dayz < 0 ? 'bad">expired' : 'warn">' + dayz + 'd') + '</span>' : '') : '—') + '</td>' +
          '<td>' + c.open_cases + ' open<span class="sub">' + c.case_count + ' total</span></td>' +
          '<td class="num">' + money(c.paid) + '</td>' +
          '<td><span class="badge ' + (c.status === 'active' ? 'ok' : 'grey') + '">' +
          esc(c.status) + '</span></td></tr>';
      }).join('') + '</tbody></table></div>'
      : emptyBox('No clients match', 'Adjust the filters, or add a client directly.')) +
      '</div>';
    $('view').innerHTML = html;
    $('clGo').onclick = function () {
      clientFilter = { q: val('clQ'), status: val('clStatus'), nationality: val('clNat') };
      viewClients();
    };
    $('clQ').onkeydown = function (e) { if (e.key === 'Enter') $('clGo').click(); };
    $('clAdd').onclick = function () { clientForm(); };
  }).catch(failed);
}

function daysTo(d) {
  if (!d) return null;
  return Math.round((new Date(d + 'T00:00:00Z') - new Date(today() + 'T00:00:00Z')) / 86400000);
}

function clientFields(c) {
  c = c || {};
  var f = function (id, label, value, type) {
    return '<div class="field"><label class="lbl" for="' + id + '">' + esc(label) +
      '</label><input class="inp" id="' + id + '" type="' + (type || 'text') +
      '" value="' + esc(value || '') + '"></div>';
  };
  return '<div class="grid-2">' +
    f('cfFirst', 'First name', c.first_name) + f('cfLast', 'Last name', c.last_name) +
    f('cfEmail', 'Email', c.email, 'email') + f('cfPhone', 'Phone', c.phone) +
    f('cfAlt', 'Alternative phone', c.alt_phone) + f('cfOcc', 'Occupation', c.occupation) +
    '<div class="field"><label class="lbl" for="cfNat">Nationality</label>' +
    '<select class="inp" id="cfNat">' + optsKeeping(BOOT.nationalities,
      c.nationality, 'Select a nationality') + '</select></div>' +
    '<div class="field"><label class="lbl" for="cfRes">Country of residence</label>' +
    '<select class="inp" id="cfRes">' + optsKeeping(BOOT.countries,
      c.country_residence, 'Select a country') + '</select></div>' +
    dateField('cfDob', 'Date of birth', c.date_of_birth) +
    '<div class="field"><label class="lbl" for="cfGender">Gender</label>' +
    selectOther('cfGender', ['Female', 'Male', 'Other', 'Prefer not to say'],
      c.gender, '—') + '</div>' +
    f('cfPass', 'Passport number', c.passport_no) +
    dateField('cfPassExp', 'Passport expires', c.passport_expiry) +
    '<div class="field"><label class="lbl" for="cfPermit">Current permit or visa</label>' +
    selectOther('cfPermit', BOOT.permit_statuses, c.permit_status, '—') +
    '</div>' +
    '<div class="field"><label class="lbl" for="cfPermitExp">' +
    'Permit or visa expires</label>' +
    '<input class="inp date-in" id="cfPermitExp" type="date" data-echo="cfPermitExp_e" value="' +
    esc(c.permit_expiry || '') + '">' +
    '<div class="date-echo" id="cfPermitExp_e"></div>' +
    '<input class="inp" id="cfPermitNA" value="n/a" disabled hidden>' +
    '<div class="hint" id="cfPermitHint" hidden>Nothing to expire while there ' +
    'is no current permit.</div></div>' +
    f('cfYears', 'Years in Lesotho', c.years_in_lesotho) +
    '<div class="field"><label class="lbl" for="cfStatus">Record status</label>' +
    '<select class="inp" id="cfStatus">' + opts(['active', 'dormant', 'closed'],
      c.status || 'active') + '</select></div>' +
    '</div>' +
    '<div class="field"><label class="lbl" for="cfAddr">Physical address</label>' +
    '<input class="inp" id="cfAddr" value="' + esc(c.address || '') + '"></div>' +
    '<div class="field"><label class="lbl" for="cfNotes">Notes</label>' +
    '<textarea class="inp" id="cfNotes">' + esc(c.notes || '') + '</textarea></div>';
}

function readClientFields() {
  return {
    first_name: val('cfFirst'), last_name: val('cfLast'), email: val('cfEmail'),
    phone: val('cfPhone'), alt_phone: val('cfAlt'), occupation: val('cfOcc'),
    nationality: val('cfNat'), country_residence: val('cfRes'),
    date_of_birth: val('cfDob'), gender: valOther('cfGender'),
    passport_no: val('cfPass'),
    passport_expiry: val('cfPassExp'), permit_status: valOther('cfPermit'),
    permit_expiry: val('cfPermitExp'), years_in_lesotho: val('cfYears'),
    status: val('cfStatus'), address: val('cfAddr'), notes: val('cfNotes')
  };
}

function syncPermitExpiry() {
  var status = val('cfPermit');   // the chosen option, not the typed detail
  var none = (BOOT.no_permit_statuses || ['No current permit'])
    .indexOf(status) >= 0;
  var real = $('cfPermitExp'), na = $('cfPermitNA'), hint = $('cfPermitHint');
  if (!real || !na) return;
  real.hidden = none;
  real.disabled = none;
  na.hidden = !none;
  hint.hidden = !none;
  if (none) real.value = '';
}

function clientForm(existing) {
  modal(existing ? 'Edit ' + existing.first_name + ' ' + existing.last_name : 'Add a client',
    clientFields(existing),
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="cfSave">' +
    (existing ? 'Save changes' : 'Create client') + '</button>', true);
  $('cfPermit').onchange = syncPermitExpiry;
  syncPermitExpiry();
  $('cfSave').onclick = function () {
    var btn = this;
    if (!val('cfFirst') || !val('cfLast')) {
      toast('A first and last name are needed.', 'bad'); return;
    }
    var bad = emailProblem(val('cfEmail'));
    if (bad) { toast(bad, 'bad'); $('cfEmail').focus(); return; }
    btn.disabled = true;
    var body = readClientFields();
    var p = existing ? api('/api/clients/' + existing.id, body)
      : api('/api/clients', body);
    p.then(function (d) {
      closeModal();
      toast(existing ? 'Client updated.' : 'Client ' + d.ref + ' created.', 'ok');
      if (existing) viewClient(existing.id); else location.hash = '#/client/' + d.id;
    }).catch(function (err) { toast(err.message, 'bad'); btn.disabled = false; });
  };
}

function viewClient(id) {
  setActive('clients', 'Client');
  loading('Opening the file…');
  api('/api/clients/' + id).then(function (d) {
    var c = d.client;
    $('pageTitle').textContent = c.first_name + ' ' + c.last_name;
    var paid = d.payments.reduce(function (a, p) { return a + (p.voided ? 0 : p.amount); }, 0);

    var html = '<div class="row" style="margin-bottom:14px">' +
      '<a href="#/clients" class="small">‹ All clients</a>' +
      '<span class="badge">' + esc(c.ref) + '</span>' +
      '<span class="badge ' + (c.status === 'active' ? 'ok' : 'grey') + '">' + esc(c.status) + '</span>' +
      '<span class="row-end"><button class="btn btn-sm" id="cEdit">Edit details</button> ' +
      '<button class="btn btn-sm btn-gold" id="cNewCase">Open a case</button></span></div>';

    (d.alerts || []).forEach(function (a) {
      html += '<div class="notice ' + (a.level === 'critical' ? '' : 'warn') + '">' +
        esc(a.text) + '</div>';
    });

    html += '<div class="cols"><div class="stack">';

    /* cases */
    html += '<div class="card"><h3>Cases</h3>' + (d.cases.length
      ? '<div class="tbl-wrap"><table><thead><tr><th>Reference</th><th>Service</th>' +
      '<th>Stage</th><th class="num">Fee</th><th class="num">Paid</th></tr></thead><tbody>' +
      d.cases.map(function (k) {
        return '<tr class="rowlink" onclick="location.hash=\'#/case/' + k.id + '\'">' +
          '<td class="mono">' + esc(k.ref) + '</td>' +
          '<td>' + esc(shortService(k.service)) +
          (k.destination ? '<span class="sub">to ' + esc(k.destination) + '</span>' : '') + '</td>' +
          '<td>' + stageBadge(k) + '</td>' +
          '<td class="num">' + money(k.fee_total, k.currency) + '</td>' +
          '<td class="num">' + money(k.paid, k.currency) + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      : emptyBox('No cases open', 'Open a case to start a document checklist and track progress.')) +
      '</div>';

    /* timeline */
    html += '<div class="card"><h3>Activity' +
      '<span class="right"><button class="btn btn-sm" id="cNote">Log activity</button></span></h3>' +
      timeline(d.events) + '</div>';

    html += '</div><div class="stack">';

    /* details */
    html += '<div class="card"><h3>Details</h3><dl class="kv">' +
      kvRow('Email', c.email) + kvRow('Phone', c.phone) + kvRow('Alt. phone', c.alt_phone) +
      kvRow('Nationality', c.nationality) + kvRow('Residence', c.country_residence) +
      kvRow('Occupation', c.occupation) + kvRow('Address', c.address) +
      kvRow('Date of birth', c.date_of_birth ? dt(c.date_of_birth) : '') +
      kvRow('Passport', c.passport_no) +
      kvRow('Passport expires', c.passport_expiry ? dt(c.passport_expiry) : '') +
      kvRow('Current permit', c.permit_status) +
      kvRow('Permit expires', c.permit_expiry ? dt(c.permit_expiry) : '') +
      kvRow('Years in Lesotho', c.years_in_lesotho) +
      kvRow('Client since', dt(c.created_at)) +
      '</dl>' + (c.notes ? '<div class="code" style="margin-top:12px">' + esc(c.notes) +
        '</div>' : '') + '</div>';

    /* money */
    html += '<div class="card"><h3>Payments' +
      '<span class="right"><button class="btn btn-sm" id="cPay">Record</button></span></h3>' +
      '<div class="row" style="margin-bottom:10px"><b style="font-size:19px" class="mono">' +
      money(paid) + '</b><span class="muted small">received in total</span></div>' +
      (d.payments.length ? '<ul class="docs">' + d.payments.slice(0, 8).map(function (p) {
        return '<li><div class="doc-name"><b class="mono">' + money(p.amount, p.currency) +
          '</b><span class="sub">' + esc(kindLabel(p.kind)) + ' · ' + dt(p.paid_on) +
          (p.reference ? ' · ' + esc(p.reference) : '') + '</span></div>' +
          (p.voided ? '<span class="badge bad">void</span>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="muted small">Nothing recorded yet.</p>') + '</div>';

    /* appointments + tasks */
    html += '<div class="card"><h3>Consultations' +
      '<span class="right"><button class="btn btn-sm" id="cAppt">Book</button></span></h3>' +
      (d.appointments.length ? '<ul class="docs">' + d.appointments.slice(0, 6).map(function (a) {
        return '<li><div class="doc-name"><b>' + esc(a.title) + '</b><span class="sub">' +
          dtm(a.starts_at) + ' · ' + esc(a.location || '') + '</span></div>' +
          apptBadge(a.status) + '</li>';
      }).join('') + '</ul>' : '<p class="muted small">None booked.</p>') + '</div>';

    html += '<div class="card"><h3>Tasks' +
      '<span class="right"><button class="btn btn-sm" id="cTask">Add</button></span></h3>' +
      (d.tasks.length ? taskList(d.tasks) : '<p class="muted small">Nothing outstanding.</p>') +
      '</div>';

    if (ME.role === 'owner') {
      html += '<div class="card"><h3>Danger zone</h3><p class="muted small">Deleting removes ' +
        'the client, their cases, documents, payments and history. This cannot be undone.</p>' +
        '<button class="btn btn-danger btn-sm" id="cDel">Delete this client</button></div>';
    }
    html += '</div></div>';
    $('view').innerHTML = html;

    wireTimelineDelete(function () { viewClient(id); });
    $('cEdit').onclick = function () { clientForm(c); };
    $('cNewCase').onclick = function () { caseForm(c); };
    $('cNote').onclick = function () { eventForm({ client_id: c.id }, function () { viewClient(id); }); };
    $('cPay').onclick = function () { paymentForm({ client_id: c.id, cases: d.cases }, function () { viewClient(id); }); };
    $('cAppt').onclick = function () {
      apptForm({ client_id: c.id, cases: d.cases,
                 client_name: c.first_name + ' ' + c.last_name },
               function () { viewClient(id); });
    };
    $('cTask').onclick = function () { taskForm({ client_id: c.id }, function () { viewClient(id); }); };
    if ($('cDel')) {
      $('cDel').onclick = function () {
        confirmAction('Delete ' + c.first_name + ' ' + c.last_name + '?',
          'Everything attached to this client will be removed permanently.',
          'Delete permanently', function () {
            api('/api/clients/' + c.id, {}, 'DELETE').then(function () {
              toast('Client deleted.'); location.hash = '#/clients';
            }).catch(function (err) { toast(err.message, 'bad'); });
          });
      };
    }
  }).catch(failed);
}

function kvRow(k, v) { return v ? '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>' : ''; }
function kindLabel(k) {
  var f = (BOOT.payment_kinds || []).filter(function (x) { return x.key === k; })[0];
  return f ? f.label : k;
}
function apptBadge(s) {
  var m = { scheduled: ['info', 'booked'], held: ['ok', 'held'],
            no_show: ['bad', 'no show'], cancelled: ['grey', 'cancelled'] };
  var x = m[s] || ['grey', s];
  return '<span class="badge ' + x[0] + '">' + x[1] + '</span>';
}
function stageBadge(k) {
  if (k.closed) {
    var good = k.outcome === 'Approved';
    return '<span class="badge ' + (good ? 'ok' : 'bad') + '">' + esc(k.outcome || 'closed') + '</span>';
  }
  return '<span class="badge">' + esc(k.stage) + '</span>';
}
function timeline(events) {
  if (!events || !events.length) {
    return '<p class="muted small">No activity recorded yet.</p>';
  }
  return '<ul class="tl">' + events.map(function (e) {
    return '<li class="' + esc(e.kind) + '"><div class="tl-meta">' +
      esc(e.kind) + ' · ' + esc(e.user_name || 'System') + ' · ' + dtm(e.created_at) +
      (ME.role === 'owner'
        ? '<button class="btn btn-sm btn-danger tl-x" data-evdel="' + e.id +
          '" title="Remove this entry">✕</button>' : '') +
      '</div><div class="tl-body">' + esc(e.body) + '</div></li>';
  }).join('') + '</ul>';
}

/* The history of a file is worth protecting, so only the owner may remove an
   entry, and the removal itself is written to the activity log. */
function wireTimelineDelete(refresh) {
  document.querySelectorAll('[data-evdel]').forEach(function (b) {
    b.onclick = function () {
      confirmAction('Remove this entry?',
        'It disappears from the file\'s history. The removal is recorded in ' +
        'the activity log.', 'Remove', function () {
          api('/api/events/' + b.dataset.evdel, {}, 'DELETE').then(function () {
            toast('Entry removed.'); refresh();
          }).catch(function (e) { toast(e.message, 'bad'); });
        });
    };
  });
}
function taskList(tasks) {
  return '<ul class="docs">' + tasks.map(function (t) {
    var late = t.status === 'open' && t.due_date && t.due_date < today();
    return '<li><div class="doc-name"><b' + (t.status === 'done'
      ? ' style="text-decoration:line-through;color:var(--muted)"' : '') + '>' +
      esc(t.title) + '</b><span class="sub">' +
      (t.due_date ? 'due ' + dt(t.due_date) : 'no due date') +
      (t.assignee ? ' · ' + esc(t.assignee) : '') + '</span></div>' +
      (late ? '<span class="badge bad">overdue</span>' : '') +
      (t.status === 'open'
        ? '<button class="btn btn-sm" onclick="completeTask(' + t.id + ')">Done</button>' : '') +
      '</li>';
  }).join('') + '</ul>';
}
function completeTask(id) {
  api('/api/tasks/' + id, { status: 'done' }).then(function () {
    toast('Task completed.', 'ok'); router();
  }).catch(function (err) { toast(err.message, 'bad'); });
}

/* ================================================================ CASES */
var caseFilter = { stage: 'all', q: '', open: '1' };

function viewCases() {
  setActive('cases', 'Cases');
  loading('Loading the case register…');
  var qs = '?stage=' + encodeURIComponent(caseFilter.stage) + '&q=' +
    encodeURIComponent(caseFilter.q) + (caseFilter.open === '1' ? '&open=1' :
      caseFilter.open === '0' ? '&closed=1' : '');
  api('/api/cases' + qs).then(function (d) {
    var html = '<div class="filters">' +
      '<select class="inp" id="csOpen">' + opts([
        { value: '1', label: 'Open cases' }, { value: '0', label: 'Closed cases' },
        { value: '', label: 'All cases' }], caseFilter.open) + '</select>' +
      '<select class="inp" id="csStage">' + opts(
        [{ value: 'all', label: 'Every stage' }].concat(BOOT.stages.map(function (s) {
          return { value: s, label: s + (d.by_stage[s] ? ' (' + d.by_stage[s] + ')' : '') };
        })), caseFilter.stage) + '</select>' +
      '<input class="inp" id="csQ" placeholder="Reference or client name" value="' +
      esc(caseFilter.q) + '">' +
      '<button class="btn" id="csGo">Apply</button>' +
      '<button class="btn btn-gold row-end" id="csAdd">Open a case</button></div>';

    html += '<div class="card">' + (d.cases.length
      ? '<div class="tbl-wrap"><table><thead><tr><th>Reference</th><th>Client</th>' +
      '<th>Service</th><th>Stage</th><th>Documents</th><th class="num">Balance</th>' +
      '<th>Advisor</th></tr></thead><tbody>' + d.cases.map(function (k) {
        var bal = (k.fee_total || 0) - (k.paid || 0);
        var pct = k.doc_total ? Math.round(k.doc_done / k.doc_total * 100) : 0;
        return '<tr class="rowlink" onclick="location.hash=\'#/case/' + k.id + '\'">' +
          '<td class="mono">' + esc(k.ref) + '<span class="sub">' + dt(k.opened_at) + '</span></td>' +
          '<td><b>' + esc(k.first_name + ' ' + k.last_name) + '</b>' +
          '<span class="sub">' + esc(k.nationality || '') + '</span></td>' +
          '<td>' + esc(shortService(k.service)) +
          (k.destination ? '<span class="sub">to ' + esc(k.destination) + '</span>' : '') + '</td>' +
          '<td>' + stageBadge(k) + '</td>' +
          '<td style="min-width:96px">' + k.doc_done + '/' + k.doc_total +
          '<div class="meter" style="margin-top:4px"><i style="width:' + pct + '%"></i></div></td>' +
          '<td class="num">' + (bal > 0 ? '<span class="badge warn">' + money(bal, k.currency) +
            '</span>' : '<span class="muted">settled</span>') + '</td>' +
          '<td>' + esc(k.advisor_name || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      : emptyBox('No cases here', 'Change the filters above, or open a case from a client file.')) +
      '</div>';
    $('view').innerHTML = html;
    $('csGo').onclick = function () {
      caseFilter = { stage: val('csStage'), q: val('csQ'), open: val('csOpen') };
      viewCases();
    };
    $('csQ').onkeydown = function (e) { if (e.key === 'Enter') $('csGo').click(); };
    $('csAdd').onclick = function () { caseForm(null); };
  }).catch(failed);
}

function caseForm(client) {
  var pickClient = client
    ? '<input type="hidden" id="kClient" value="' + client.id + '">' +
    '<p class="muted small">For <b>' + esc(client.first_name + ' ' + client.last_name) +
    '</b> (' + esc(client.ref) + ').</p>'
    : '<div class="field"><label class="lbl" for="kClientSearch">Client</label>' +
    '<input class="inp" id="kClientSearch" placeholder="Type a surname or reference">' +
    '<input type="hidden" id="kClient"><div class="hint" id="kClientHint">' +
    'Search and pick the client this case belongs to.</div></div>';

  modal('Open a case', pickClient +
    '<div class="field"><label class="lbl" for="kService">Service</label>' +
    selectOther('kService', BOOT.services, '') + '</div>' +
    '<div class="grid-2">' +
    '<div class="field"><label class="lbl" for="kDest">Destination country</label>' +
    '<select class="inp" id="kDest">' + optsKeeping(BOOT.countries, '',
      'Select a country') + '</select></div>' +
    '<div class="field"><label class="lbl" for="kAdvisor">Advisor</label>' +
    '<select class="inp" id="kAdvisor">' + opts(BOOT.advisors.map(function (a) {
      return { value: a.id, label: a.name };
    }), ME.id) + '</select></div>' +
    '<div class="field"><label class="lbl" for="kCurrency">Currency</label>' +
    '<select class="inp" id="kCurrency">' + opts(BOOT.currencies.map(function (c) {
      return { value: c.code, label: c.code + ' — ' + c.name };
    }), BOOT.base_currency) + '</select></div>' +
    '<div class="field"><label class="lbl" for="kFee">Agreed fee</label>' +
    '<input class="inp" id="kFee" type="number" step="0.01" min="0" value="0"></div>' +
    dateField('kTarget', 'Target date', '') +
    '<div class="field"><label class="lbl" for="kPriority">Priority</label>' +
    '<select class="inp" id="kPriority">' + opts(['low', 'normal', 'high', 'urgent'],
      'normal') + '</select></div></div>' +
    '<div class="field"><label class="lbl" for="kNotes">Notes</label>' +
    '<textarea class="inp" id="kNotes"></textarea></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-gold" id="kGo">Open case</button>', true);

  if (!client) {
    var t = null;
    $('kClientSearch').oninput = function () {
      var q = this.value.trim();
      clearTimeout(t);
      if (q.length < 3) return;
      t = setTimeout(function () {
        api('/api/clients?q=' + encodeURIComponent(q)).then(function (d) {
          $('kClientHint').innerHTML = d.clients.length
            ? d.clients.slice(0, 6).map(function (c) {
              return '<a href="#" onclick="pickClient(' + c.id + ',\'' +
                esc(c.first_name + ' ' + c.last_name).replace(/'/g, '') +
                '\');return false">' + esc(c.first_name + ' ' + c.last_name) +
                ' · ' + esc(c.ref) + '</a>';
            }).join('<br>')
            : 'No client matches. Create the client first.';
        });
      }, 250);
    };
  }
  $('kGo').onclick = function () {
    if (!val('kClient')) { toast('Pick a client first.', 'bad'); return; }
    this.disabled = true;
    api('/api/cases', {
      client_id: val('kClient'), service: valOther('kService'), destination: val('kDest'),
      advisor_id: val('kAdvisor'), fee_total: num('kFee'),
      currency: val('kCurrency'), target_date: val('kTarget'),
      priority: val('kPriority'), notes: val('kNotes')
    }).then(function (d) {
      closeModal(); toast('Case opened.', 'ok'); location.hash = '#/case/' + d.id;
    }).catch(function (err) { toast(err.message, 'bad'); $('kGo').disabled = false; });
  };
}
function pickClient(id, name) {
  $('kClient').value = id;
  $('kClientSearch').value = name;
  $('kClientHint').textContent = 'Selected.';
}

function viewCase(id) {
  setActive('cases', 'Case');
  loading('Opening the case…');
  api('/api/cases/' + id).then(function (d) {
    var k = d.case, m = d.money;
    $('pageTitle').textContent = k.ref;

    var html = '<div class="row" style="margin-bottom:14px">' +
      '<a href="#/cases" class="small">‹ All cases</a>' +
      '<a href="#/client/' + k.client_id + '"><b>' + esc(k.first_name + ' ' + k.last_name) +
      '</b></a>' + stageBadge(k) +
      (k.priority !== 'normal' ? '<span class="badge warn">' + esc(k.priority) + '</span>' : '') +
      '<span class="row-end"><button class="btn btn-sm" id="kEdit">Edit case</button> ' +
      '<button class="btn btn-sm btn-gold" id="kMove">Move stage</button></span></div>';

    /* rail */
    html += '<div class="card"><div class="rail">' + d.progress.pipeline.map(function (s, i) {
      var cls = '';
      if (d.progress.index === -1) cls = '';
      else if (i < d.progress.index) cls = 'done';
      else if (i === d.progress.index) cls = d.progress.closed ? 'done' : 'current';
      return '<div class="rail-step ' + cls + '"><span class="n">' + esc(s) + '</span></div>';
    }).join('') + (d.progress.index === -1
      ? '<div class="rail-step lost"><span class="n">' + esc(d.progress.outcome) + '</span></div>'
      : '') + '</div>' +
      (k.closed ? '<div class="notice ' + (k.outcome === 'Approved' ? 'ok' : 'warn') +
        '">This case is closed — ' + esc(k.outcome) + ' on ' + dt(k.decision_at) +
        '. <button class="btn btn-sm" id="kReopen">Reopen</button></div>' : '') +
      '</div>';

    html += '<div class="cols"><div class="stack">';

    /* documents */
    var done = d.documents.filter(function (x) {
      return x.status === 'received' || x.status === 'verified' || x.status === 'waived';
    }).length;
    html += '<div class="card"><h3>Document checklist ' +
      '<span class="badge">' + done + ' of ' + d.documents.length + '</span>' +
      '<span class="right"><button class="btn btn-sm" id="dAdd">Add a document</button></span></h3>' +
      (d.documents.length ? '<ul class="docs" id="docList">' + d.documents.map(function (x) {
        var exp = x.expiry ? daysTo(x.expiry) : null;
        return '<li><div class="doc-name"><b>' + esc(x.name) + '</b>' +
          '<span class="sub">' + (x.required ? 'required' : 'optional') +
          (x.expiry ? ' · expires ' + dt(x.expiry) +
            (exp !== null && exp < 60 ? ' (' + (exp < 0 ? 'expired' : exp + ' days') + ')' : '')
            : '') + (x.note ? ' · ' + esc(x.note) : '') + '</span></div>' +
          '<select class="inp" data-doc="' + x.id + '">' + opts([
            { value: 'pending', label: 'Pending' }, { value: 'received', label: 'Received' },
            { value: 'verified', label: 'Verified' }, { value: 'rejected', label: 'Rejected' },
            { value: 'waived', label: 'Waived' }], x.status) + '</select>' +
          '<button class="btn btn-sm" data-docedit="' + x.id + '">…</button></li>';
      }).join('') + '</ul>'
        : '<p class="muted small">No checklist for this case.</p>') + '</div>';

    /* activity */
    html += '<div class="card"><h3>Activity' +
      '<span class="right"><button class="btn btn-sm" id="kNote">Log activity</button></span></h3>' +
      timeline(d.events) + '</div>';

    html += '</div><div class="stack">';

    /* summary */
    html += '<div class="card"><h3>Case details</h3><dl class="kv">' +
      kvRow('Service', k.service) + kvRow('Destination', k.destination) +
      kvRow('Advisor', k.advisor_name) +
      kvRow('Opened', dt(k.opened_at)) +
      kvRow('Target date', k.target_date ? dt(k.target_date) : '') +
      kvRow('Submitted', k.submitted_at ? dt(k.submitted_at) : '') +
      kvRow('Decision', k.decision_at ? dt(k.decision_at) : '') +
      kvRow('Authority reference', k.authority_ref) +
      kvRow('Passport', k.passport_no) +
      kvRow('Permit expires', k.permit_expiry ? dt(k.permit_expiry) : '') +
      '</dl>' + (k.notes ? '<div class="code" style="margin-top:12px">' + esc(k.notes) +
        '</div>' : '') + '</div>';

    /* money */
    var pct = m.fee_total > 0 ? Math.min(100, m.paid / m.fee_total * 100) : 0;
    html += '<div class="card"><h3>Fees' +
      '<span class="right"><button class="btn btn-sm" id="kInvoice">Invoice</button> ' +
      '<button class="btn btn-sm" id="kPay">Record payment</button></span></h3>' +
      '<dl class="kv"><dt>Agreed fee</dt><dd class="mono">' + money(m.fee_total, k.currency) +
      '</dd><dt>Received</dt><dd class="mono">' + money(m.paid, k.currency) +
      '</dd><dt>Balance</dt><dd class="mono"><b>' + money(m.balance, k.currency) +
      '</b></dd></dl>' +
      '<div class="meter" style="margin-top:10px"><i class="' +
      (pct >= 100 ? '' : 'warn') + '" style="width:' + pct + '%"></i></div>' +
      (d.payments.length ? '<ul class="docs" style="margin-top:10px">' +
        d.payments.map(function (p) {
          return '<li><div class="doc-name"><b class="mono">' + money(p.amount, p.currency) +
            '</b><span class="sub">' + esc(kindLabel(p.kind)) + ' · ' + dt(p.paid_on) + '</span></div>' +
            (p.voided ? '<span class="badge bad">void</span>'
              : '<button class="btn btn-sm" data-void="' + p.id + '">Void</button>') + '</li>';
        }).join('') + '</ul>' : '') + '</div>';

    html += '<div class="card"><h3>Tasks' +
      '<span class="right"><button class="btn btn-sm" id="kTask">Add</button></span></h3>' +
      (d.tasks.length ? taskList(d.tasks) : '<p class="muted small">Nothing outstanding.</p>') +
      '</div>';

    if (ME.role === 'owner') {
      html += '<div class="card"><h3>Danger zone</h3>' +
        '<button class="btn btn-danger btn-sm" id="kDel">Delete this case</button></div>';
    }
    html += '</div></div>';
    $('view').innerHTML = html;

    /* wiring */
    $('kEdit').onclick = function () { caseEditForm(k); };
    $('kMove').onclick = function () { stageForm(k); };
    if ($('kReopen')) {
      $('kReopen').onclick = function () {
        api('/api/cases/' + k.id + '/reopen', {}).then(function () {
          toast('Case reopened.'); viewCase(id);
        }).catch(function (e) { toast(e.message, 'bad'); });
      };
    }
    wireTimelineDelete(function () { viewCase(id); });
    $('kNote').onclick = function () {
      eventForm({ case_id: k.id, client_id: k.client_id }, function () { viewCase(id); });
    };
    $('kPay').onclick = function () {
      paymentForm({ client_id: k.client_id, case_id: k.id, cases: [k] },
        function () { viewCase(id); });
    };
    $('kTask').onclick = function () {
      taskForm({ case_id: k.id, client_id: k.client_id }, function () { viewCase(id); });
    };
    if ($('kInvoice')) {
      $('kInvoice').onclick = function () {
        invoiceForm({ id: k.client_id, first_name: k.first_name,
                      last_name: k.last_name }, { id: k.id });
      };
    }
    $('dAdd').onclick = function () { docForm(k.id, null, function () { viewCase(id); }); };
    if ($('kDel')) {
      $('kDel').onclick = function () {
        confirmAction('Delete case ' + k.ref + '?',
          'The checklist, tasks and history for this case will be removed. ' +
          'Payments stay on the client record.', 'Delete case', function () {
            api('/api/cases/' + k.id, {}, 'DELETE').then(function () {
              toast('Case deleted.'); location.hash = '#/client/' + k.client_id;
            }).catch(function (e) { toast(e.message, 'bad'); });
          });
      };
    }
    document.querySelectorAll('[data-doc]').forEach(function (sel) {
      sel.onchange = function () {
        api('/api/documents/' + this.dataset.doc, { status: this.value })
          .then(function () { toast('Checklist updated.', 'ok'); viewCase(id); })
          .catch(function (e) { toast(e.message, 'bad'); });
      };
    });
    document.querySelectorAll('[data-docedit]').forEach(function (b) {
      b.onclick = function () {
        var doc = d.documents.filter(function (x) {
          return String(x.id) === b.dataset.docedit;
        })[0];
        docForm(k.id, doc, function () { viewCase(id); });
      };
    });
    document.querySelectorAll('[data-void]').forEach(function (b) {
      b.onclick = function () {
        api('/api/payments/' + b.dataset.void + '/void', {}).then(function () {
          toast('Payment voided.'); viewCase(id);
        }).catch(function (e) { toast(e.message, 'bad'); });
      };
    });
  }).catch(failed);
}

function caseEditForm(k) {
  modal('Edit ' + k.ref,
    '<div class="field"><label class="lbl" for="keService">Service</label>' +
    selectOther('keService', BOOT.services, k.service) + '</div>' +
    '<div class="grid-2">' +
    '<div class="field"><label class="lbl" for="keDest">Destination</label>' +
    '<select class="inp" id="keDest">' + optsKeeping(BOOT.countries,
      k.destination, 'Select a country') + '</select></div>' +
    '<div class="field"><label class="lbl" for="keAdvisor">Advisor</label>' +
    '<select class="inp" id="keAdvisor">' + opts(BOOT.advisors.map(function (a) {
      return { value: a.id, label: a.name };
    }), k.advisor_id) + '</select></div>' +
    '<div class="field"><label class="lbl" for="keCurrency">Currency</label>' +
    '<select class="inp" id="keCurrency">' + opts(BOOT.currencies.map(function (c) {
      return { value: c.code, label: c.code + ' — ' + c.name };
    }), k.currency || BOOT.base_currency) + '</select></div>' +
    '<div class="field"><label class="lbl" for="keFee">Agreed fee</label>' +
    '<input class="inp" id="keFee" type="number" step="0.01" value="' +
    (k.fee_total || 0) + '"></div>' +
    '<div class="field"><label class="lbl" for="kePriority">Priority</label>' +
    '<select class="inp" id="kePriority">' + opts(['low', 'normal', 'high', 'urgent'],
      k.priority) + '</select></div>' +
    dateField('keTarget', 'Target date', k.target_date) +
    '<div class="field"><label class="lbl" for="keAuth">Authority reference</label>' +
    '<input class="inp" id="keAuth" value="' + esc(k.authority_ref || '') + '"></div>' +
    dateField('keSub', 'Submitted on', k.submitted_at) +
    dateField('keDec', 'Decision on', k.decision_at) +
    '</div><div class="field"><label class="lbl" for="keNotes">Notes</label>' +
    '<textarea class="inp" id="keNotes">' + esc(k.notes || '') + '</textarea></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="keSave">Save changes</button>', true);
  $('keSave').onclick = function () {
    this.disabled = true;
    api('/api/cases/' + k.id, {
      service: valOther('keService'), destination: val('keDest'),
      advisor_id: val('keAdvisor'),
      fee_total: num('keFee'), currency: val('keCurrency'),
      priority: val('kePriority'), target_date: val('keTarget'),
      authority_ref: val('keAuth'), submitted_at: val('keSub'), decision_at: val('keDec'),
      notes: val('keNotes')
    }).then(function () {
      closeModal(); toast('Case updated.', 'ok'); viewCase(k.id);
    }).catch(function (e) { toast(e.message, 'bad'); $('keSave').disabled = false; });
  };
}

function stageForm(k) {
  var choices = BOOT.stages.concat(BOOT.outcomes.filter(function (o) {
    return BOOT.stages.indexOf(o) === -1;
  }));
  modal('Move ' + k.ref + ' forward',
    '<div class="field"><label class="lbl" for="stStage">New stage or outcome</label>' +
    '<select class="inp" id="stStage">' + opts(choices, k.stage) + '</select>' +
    '<div class="hint">Choosing Rejected, Withdrawn or Referred out closes the case.</div></div>' +
    '<div class="field"><label class="lbl" for="stNote">Note for the file</label>' +
    '<textarea class="inp" id="stNote" placeholder="What changed, and what happens next"></textarea></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-gold" id="stGo">Save</button>');
  $('stGo').onclick = function () {
    this.disabled = true;
    api('/api/cases/' + k.id + '/stage', { stage: val('stStage'), note: val('stNote') })
      .then(function () { closeModal(); toast('Stage updated.', 'ok'); viewCase(k.id); })
      .catch(function (e) { toast(e.message, 'bad'); $('stGo').disabled = false; });
  };
}

function docForm(caseId, doc, after) {
  modal(doc ? 'Edit document' : 'Add a document',
    '<div class="field"><label class="lbl" for="dName">Name</label>' +
    '<input class="inp" id="dName" value="' + esc(doc ? doc.name : '') + '"></div>' +
    '<div class="grid-2">' +
    dateField('dExpiry', 'Expires', doc ? doc.expiry : '') +
    '<div class="field"><label class="lbl" for="dStatus">Status</label>' +
    '<select class="inp" id="dStatus">' + opts(['pending', 'received', 'verified',
      'rejected', 'waived'], doc ? doc.status : 'pending') + '</select></div></div>' +
    '<div class="field"><label class="lbl" for="dNote">Note</label>' +
    '<input class="inp" id="dNote" value="' + esc(doc ? doc.note : '') + '"></div>' +
    '<label class="small"><input type="checkbox" id="dReq"' +
    (!doc || doc.required ? ' checked' : '') + '> Required for submission</label>',
    (doc ? '<button class="btn btn-danger left" id="dDel">Remove</button>' : '') +
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="dSave">Save</button>');
  $('dSave').onclick = function () {
    var body = {
      name: val('dName'), expiry: val('dExpiry'), status: val('dStatus'),
      note: val('dNote'), required: checked('dReq')
    };
    if (!body.name) { toast('Give the document a name.', 'bad'); return; }
    var p = doc ? api('/api/documents/' + doc.id, body)
      : api('/api/cases/' + caseId + '/documents', body);
    p.then(function () { closeModal(); toast('Saved.', 'ok'); after(); })
      .catch(function (e) { toast(e.message, 'bad'); });
  };
  if ($('dDel')) {
    $('dDel').onclick = function () {
      api('/api/documents/' + doc.id, {}, 'DELETE').then(function () {
        closeModal(); toast('Removed.'); after();
      }).catch(function (e) { toast(e.message, 'bad'); });
    };
  }
}

/* ============================================================== SHARED FORMS */
function eventForm(link, after) {
  modal('Log activity',
    '<div class="grid-2">' +
    '<div class="field"><label class="lbl" for="evKind">Type</label>' +
    '<select class="inp" id="evKind">' + opts(BOOT.event_kinds.filter(function (k) {
      return k !== 'stage' && k !== 'system' && k !== 'payment';
    }), 'note') + '</select></div>' +
    dateField('evFollow', 'Follow up on', '') + '</div>' +
    '<div class="field"><label class="lbl" for="evBody">What happened</label>' +
    '<textarea class="inp" id="evBody" placeholder="Called the client to confirm the police clearance is ready"></textarea></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="evGo">Save note</button>');
  $('evGo').onclick = function () {
    if (!val('evBody')) { toast('Write what happened.', 'bad'); return; }
    this.disabled = true;
    api('/api/events', {
      kind: val('evKind'), body: val('evBody'), follow_up: val('evFollow'),
      client_id: link.client_id, case_id: link.case_id
    }).then(function () { closeModal(); toast('Logged.', 'ok'); after(); })
      .catch(function (e) { toast(e.message, 'bad'); $('evGo').disabled = false; });
  };
}

function paymentForm(link, after) {
  var caseOpts = (link.cases || []).map(function (k) {
    return { value: k.id, label: k.ref + ' — ' + shortService(k.service) };
  });
  modal('Record a payment',
    '<div class="grid-2">' +
    '<div class="field"><label class="lbl" for="pAmount">Amount</label>' +
    '<input class="inp" id="pAmount" type="number" step="0.01" min="0.01"></div>' +
    dateField('pDate', 'Received on', today()) +
    '<div class="field"><label class="lbl" for="pKind">What it is for</label>' +
    '<select class="inp" id="pKind">' + opts(BOOT.payment_kinds.map(function (k) {
      return { value: k.key, label: k.label };
    })) + '</select></div>' +
    '<div class="field"><label class="lbl" for="pCase">Case</label>' +
    '<select class="inp" id="pCase">' + opts(caseOpts, link.case_id, 'Not case specific') +
    '</select></div>' +
    '<div class="field"><label class="lbl" for="pMethod">Method</label>' +
    selectOther('pMethod', ['Cash', 'M-Pesa', 'EcoCash', 'Bank transfer',
      'Card', 'Other'], 'Cash') + '</div>' +
    '<div class="field"><label class="lbl" for="pRef">Receipt number</label>' +
    '<input class="inp" id="pRef"></div></div>' +
    '<div class="field"><label class="lbl" for="pNote">Note</label>' +
    '<input class="inp" id="pNote"></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="pGo">Record payment</button>');
  /* The same money can reach the ledger twice — recorded here, and again as
     a receipt in Accounts. The server spots a likely duplicate and refuses
     it; this turns that refusal into a question rather than a dead end. */
  /* The same money can reach the ledger twice — recorded here, and again as
     a receipt in Accounts. The server spots a likely duplicate and refuses
     it; this turns that refusal into a question rather than a dead end.

     The payload is read once, up front: asking the question replaces this
     dialog, so by the time an answer comes back the fields are gone. */
  function savePayment(body, allowDuplicate) {
    var btn = $('pGo');
    if (btn) btn.disabled = true;
    body.allow_duplicate = !!allowDuplicate;
    api('/api/payments', body)
      .then(function () { closeModal(); toast('Payment recorded.', 'ok'); after(); })
      .catch(function (e) {
        var b = $('pGo');
        if (b) b.disabled = false;
        if (/already records/.test(e.message) && !allowDuplicate) {
          confirmAction('This looks like it is already recorded',
            e.message, 'Save it anyway',
            function () { savePayment(body, true); });
          return;
        }
        toast(e.message, 'bad');
      });
  }

  $('pGo').onclick = function () {
    if (num('pAmount') <= 0) { toast('Enter an amount.', 'bad'); return; }
    savePayment({
      client_id: link.client_id, case_id: val('pCase') || null,
      amount: num('pAmount'), kind: val('pKind'), method: valOther('pMethod'),
      reference: val('pRef'), paid_on: val('pDate'), note: val('pNote')
    }, false);
  };
}


/* ---- choosing a client (and then one of their cases) -------------------
   Used by the task and consultation forms. Typing searches; choosing fills
   the case list with that client's own cases, so a task cannot be filed
   against somebody else's matter. */
function clientPickerHtml(idBase, presetName, withCases) {
  return '<div class="field"><label class="lbl" for="' + idBase + 'Q">' +
    'Client</label>' +
    '<input class="inp" id="' + idBase + 'Q" autocomplete="off" ' +
    'placeholder="Start typing their name" value="' + esc(presetName || '') + '">' +
    '<select class="inp" id="' + idBase + 'List" size="4" hidden></select>' +
    '<div class="hint" id="' + idBase + 'Hint">Search by name, reference or ' +
    'passport number. Leave blank for a task that belongs to nobody in ' +
    'particular.</div></div>' +
    (withCases
      ? '<div class="field" id="' + idBase + 'CaseWrap" hidden>' +
        '<label class="lbl" for="' + idBase + 'Case">Case</label>' +
        '<select class="inp" id="' + idBase + 'Case"></select></div>'
      : '');
}

function wireClientPicker(idBase, state, withCases) {
  var box = $(idBase + 'Q'), list = $(idBase + 'List'),
      hint = $(idBase + 'Hint'), timer;
  if (!box) return;

  function loadCases(clientId, selectCase) {
    if (!withCases) return;
    var wrap = $(idBase + 'CaseWrap'), sel = $(idBase + 'Case');
    if (!clientId) { wrap.hidden = true; return; }
    api('/api/clients/' + clientId).then(function (d) {
      var rows = (d.cases || []).map(function (k) {
        return { value: k.id, label: k.ref + ' — ' + k.service };
      });
      if (!rows.length) { wrap.hidden = true; return; }
      sel.innerHTML = opts(rows, selectCase || '', 'Not about a particular case');
      wrap.hidden = false;
    }).catch(function () { wrap.hidden = true; });
  }

  box.oninput = function () {
    state.client_id = null;
    if (withCases && $(idBase + 'CaseWrap')) $(idBase + 'CaseWrap').hidden = true;
    clearTimeout(timer);
    var q = box.value.trim();
    if (q.length < 2) { list.hidden = true; return; }
    timer = setTimeout(function () {
      api('/api/clients?q=' + encodeURIComponent(q)).then(function (r) {
        var found = (r.clients || []).slice(0, 8);
        if (!found.length) {
          list.hidden = true;
          hint.textContent = 'Nobody by that name yet.';
          return;
        }
        list.innerHTML = found.map(function (c) {
          return '<option value="' + c.id + '">' +
            esc(c.first_name + ' ' + c.last_name) + ' — ' + esc(c.ref) + '</option>';
        }).join('');
        list.hidden = false;
        hint.textContent = 'Choose one from the list.';
      }).catch(function () { list.hidden = true; });
    }, 220);
  };
  list.onchange = function () {
    state.client_id = list.value;
    box.value = list.options[list.selectedIndex].textContent.split(' — ')[0];
    list.hidden = true;
    hint.textContent = 'Filed against ' + box.value + '.';
    loadCases(state.client_id, null);
  };
  if (state.client_id) loadCases(state.client_id, state.case_id);
}

function taskForm(link, after, existing) {
  var t = existing || {};
  var state = {
    client_id: t.client_id || link.client_id || null,
    case_id: t.case_id || link.case_id || null
  };
  var presetName = t.client_name ||
    (link.client_name || '') ||
    ((t.first_name || '') + ' ' + (t.last_name || '')).trim();

  modal(existing ? 'Edit task' : 'Add a task',
    '<div class="field"><label class="lbl" for="tTitle">Task</label>' +
    '<input class="inp" id="tTitle" placeholder="Chase the police clearance" ' +
    'value="' + esc(t.title || '') + '"></div>' +
    clientPickerHtml('tCl', presetName, true) +
    '<div class="grid-3">' +
    dateField('tDue', 'Due', t.due_date || plusDays(3)) +
    '<div class="field"><label class="lbl" for="tPri">Priority</label>' +
    '<select class="inp" id="tPri">' + opts(['low', 'normal', 'high', 'urgent'],
      t.priority || 'normal') + '</select></div>' +
    '<div class="field"><label class="lbl" for="tWho">Assign to</label>' +
    '<select class="inp" id="tWho">' + opts(BOOT.advisors.map(function (a) {
      return { value: a.id, label: a.name };
    }), t.assigned_to || ME.id) + '</select></div></div>' +
    (existing
      ? '<div class="field" style="max-width:200px">' +
        '<label class="lbl" for="tStatus">Status</label>' +
        '<select class="inp" id="tStatus">' + opts([
          { value: 'open', label: 'Open' }, { value: 'done', label: 'Done' },
          { value: 'cancelled', label: 'Cancelled' }], t.status || 'open') +
        '</select></div>'
      : '') +
    '<div class="field"><label class="lbl" for="tDetail">Detail</label>' +
    '<textarea class="inp" id="tDetail">' + esc(t.detail || '') + '</textarea></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="tGo">' +
    (existing ? 'Save changes' : 'Add task') + '</button>', true);

  wireClientPicker('tCl', state, true);

  $('tGo').onclick = function () {
    if (!val('tTitle')) { toast('Give the task a name.', 'bad'); return; }
    this.disabled = true;
    var caseSel = $('tClCase');
    var body = {
      title: val('tTitle'), detail: val('tDetail'), due_date: val('tDue'),
      priority: val('tPri'), assigned_to: val('tWho'),
      client_id: state.client_id || null,
      case_id: (caseSel && !$('tClCaseWrap').hidden ? caseSel.value : '') || null
    };
    if (existing) body.status = val('tStatus');
    var p = existing ? api('/api/tasks/' + t.id, body) : api('/api/tasks', body);
    p.then(function () {
      closeModal();
      toast(existing ? 'Task saved.' : 'Task added.', 'ok');
      after();
    }).catch(function (e) { toast(e.message, 'bad'); $('tGo').disabled = false; });
  };
}

function apptForm(link, after) {
  var caseOpts = (link.cases || []).map(function (k) {
    return { value: k.id, label: k.ref + ' — ' + shortService(k.service) };
  });
  /* Booked from a client file the person is already known. Booked from the
     diary, nobody had asked who it was for, so the entry read "no client". */
  var needsClient = !link.client_id;
  modal('Book a consultation',
    (needsClient
      ? clientPickerHtml('aCl', '', false)
      : '<p class="muted small">For <b>' + esc(link.client_name || '') + '</b>.</p>') +
    '<div class="field"><label class="lbl" for="aTitle">Title</label>' +
    '<input class="inp" id="aTitle" value="Initial consultation"></div>' +
    '<div class="grid-3">' +
    '<div class="field"><label class="lbl" for="aWhen">Date and time</label>' +
    '<input class="inp" id="aWhen" type="datetime-local"></div>' +
    '<div class="field"><label class="lbl" for="aMins">Minutes</label>' +
    '<input class="inp" id="aMins" type="number" value="45" min="15" step="15"></div>' +
    '<div class="field"><label class="lbl" for="aWho">Advisor</label>' +
    '<select class="inp" id="aWho">' + opts(BOOT.advisors.map(function (a) {
      return { value: a.id, label: a.name };
    }), ME.id) + '</select></div></div>' +
    (caseOpts.length ? '<div class="field"><label class="lbl" for="aCase">Case</label>' +
      '<select class="inp" id="aCase">' + opts(caseOpts, link.case_id, 'Not case specific') +
      '</select></div>' : '') +
    '<div class="field"><label class="lbl" for="aMode">Where it happens</label>' +
    '<select class="inp" id="aMode">' + opts([
      { value: 'office', label: 'At the office' },
      { value: 'virtual', label: 'Online' }], 'office') + '</select></div>' +
    '<div class="field"><label class="lbl" for="aWhere" id="aWhereLbl">Address</label>' +
    '<input class="inp" id="aWhere" value="' + esc(BOOT.org.org_address || '') + '"></div>' +
    '<div class="field"><label class="lbl" for="aNote">Note</label>' +
    '<input class="inp" id="aNote"></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="aGo">Book</button>');
  /* An address makes no sense for an online meeting, and a joining link makes
     none for an office one, so the field changes with the choice. */
  var syncMode = function () {
    var virtual = val('aMode') === 'virtual';
    $('aWhereLbl').textContent = virtual ? 'Joining link' : 'Address';
    $('aWhere').placeholder = virtual
      ? 'https://meet.google.com/…' : 'Where to come';
    if (virtual && $('aWhere').value === (BOOT.org.org_address || '')) {
      $('aWhere').value = '';
    }
    if (!virtual && !$('aWhere').value) {
      $('aWhere').value = BOOT.org.org_address || '';
    }
  };
  $('aMode').onchange = syncMode;
  syncMode();

  var picked = { client_id: link.client_id || null, case_id: link.case_id || null };
  if (needsClient) wireClientPicker('aCl', picked, false);

  $('aGo').onclick = function () {
    if (needsClient && !picked.client_id) {
      toast('Choose who the consultation is for.', 'bad');
      return;
    }
    if (!val('aWhen')) { toast('Pick a date and time.', 'bad'); return; }
    this.disabled = true;
    api('/api/appointments', {
      client_id: picked.client_id,
      case_id: ($('aCase') ? val('aCase') : link.case_id) || null,
      title: val('aTitle'), starts_at: val('aWhen'), duration_min: num('aMins'),
      mode: val('aMode'), location: val('aWhere'), advisor_id: val('aWho'),
      note: val('aNote')
    }).then(function () { closeModal(); toast('Consultation booked.', 'ok'); after(); })
      .catch(function (e) { toast(e.message, 'bad'); $('aGo').disabled = false; });
  };
}

/* ============================================================== PAYMENTS */
function viewPayments() {
  setActive('payments', 'Payments');
  loading('Adding up…');
  var frm = plusDays(-90), to = today();
  api('/api/payments?from=' + frm + '&to=' + to).then(function (d) {
    var html = '<div class="filters">' +
      '<label class="small muted">From</label><input class="inp" id="pyFrom" type="date" value="' +
      frm + '">' +
      '<label class="small muted">To</label><input class="inp" id="pyTo" type="date" value="' +
      to + '">' +
      '<button class="btn" id="pyGo">Apply</button>' +
      (ME.role === 'owner'
        ? '<a class="btn row-end" href="/export/payments?from=' + frm + '&to=' +
          to + '" id="pyCsv">Download CSV</a>'
        : '') + '</div>';
    html += '<div class="kpis"><div class="kpi"><b>' + money(d.total) +
      '</b><span>Received in this period</span></div>' +
      '<div class="kpi"><b>' + d.payments.length + '</b><span>Payments recorded</span></div></div>';
    html += '<div class="card">' + (d.payments.length
      ? '<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Client</th><th>Case</th>' +
      '<th>For</th><th>Method</th><th>Receipt</th><th class="num">Amount</th><th></th>' +
      '</tr></thead><tbody>' + d.payments.map(function (p) {
        return '<tr' + (p.voided ? ' style="opacity:.5"' : '') + '>' +
          '<td>' + dt(p.paid_on) + '</td>' +
          '<td><a href="#/client/' + p.client_id + '">' +
          esc(p.first_name + ' ' + p.last_name) + '</a></td>' +
          '<td class="mono">' + (p.case_ref ? '<a href="#/case/' + p.case_id + '">' +
            esc(p.case_ref) + '</a>' : '—') + '</td>' +
          '<td>' + esc(kindLabel(p.kind)) + '</td>' +
          '<td>' + esc(p.method || '—') + '</td>' +
          '<td>' + (String(p.reference || '').indexOf('Receipt') === 0
            ? '<span class="badge">' + esc(p.reference) + '</span>'
            : esc(p.reference || '—')) + '</td>' +
          '<td class="num">' + money(p.amount, p.currency) + '</td>' +
          '<td class="num">' + (p.voided
            ? '<span class="badge bad">void</span> ' +
              '<button class="btn btn-sm" data-unvoid="' + p.id + '">Restore</button>'
            : '<button class="btn btn-sm" data-void="' + p.id + '">Void</button>') +
          (ME.role === 'owner'
            ? ' <button class="btn btn-sm btn-danger" data-pdel="' + p.id + '">✕</button>'
            : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      : emptyBox('No payments in this period', 'Change the dates, or record one from a client file.')) +
      '</div>';
    $('view').innerHTML = html;
    document.querySelectorAll('[data-unvoid]').forEach(function (b) {
      b.onclick = function () {
        api('/api/payments/' + b.dataset.unvoid + '/void', {}).then(function () {
          toast('Payment restored.', 'ok'); viewPayments();
        }).catch(function (e) { toast(e.message, 'bad'); });
      };
    });
    document.querySelectorAll('[data-pdel]').forEach(function (b) {
      b.onclick = function () {
        confirmAction('Remove this payment for good?',
          'Voiding is usually better — it keeps the entry visible and out of ' +
          'the totals, so the books still explain themselves. Deleting leaves ' +
          'no trace on the file, only in the activity log.',
          'Delete it anyway', function () {
            api('/api/payments/' + b.dataset.pdel, {}, 'DELETE').then(function () {
              toast('Payment removed.'); viewPayments();
            }).catch(function (e) { toast(e.message, 'bad'); });
          });
      };
    });
    $('pyGo').onclick = function () {
      var f = val('pyFrom'), t = val('pyTo');
      loading('Adding up…');
      api('/api/payments?from=' + f + '&to=' + t).then(function () { viewPayments(); });
    };
    document.querySelectorAll('[data-void]').forEach(function (b) {
      b.onclick = function () {
        api('/api/payments/' + b.dataset.void + '/void', {}).then(function () {
          toast('Updated.'); viewPayments();
        }).catch(function (e) { toast(e.message, 'bad'); });
      };
    });
  }).catch(failed);
}

/* ================================================================ TASKS */
var taskFilter = 'open';
function viewTasks() {
  setActive('tasks', 'Tasks');
  loading('Checking what is outstanding…');
  api('/api/tasks?status=' + taskFilter).then(function (d) {
    var html = '<div class="tabs">' + [['open', 'Open'], ['done', 'Completed'],
    ['all', 'Everything']].map(function (t) {
      return '<button data-s="' + t[0] + '" class="' + (taskFilter === t[0] ? 'on' : '') +
        '">' + t[1] + '</button>';
    }).join('') + '</div>';
    html += '<div class="row" style="margin-bottom:13px">' +
      '<button class="btn btn-gold row-end" id="tAdd">Add a task</button></div>';
    html += '<div class="card">' + (d.tasks.length
      ? '<div class="tbl-wrap"><table><thead><tr><th>Task</th><th>Client</th><th>Case</th>' +
      '<th>Due</th><th>Assigned to</th><th>Priority</th><th></th></tr></thead><tbody>' +
      d.tasks.map(function (t) {
        var late = t.status === 'open' && t.due_date && t.due_date < d.today;
        return '<tr>' +
          '<td><b>' + esc(t.title) + '</b>' +
          (t.detail ? '<span class="sub">' + esc(t.detail) + '</span>' : '') + '</td>' +
          '<td>' + (t.client_id ? '<a href="#/client/' + t.client_id + '">' +
            esc((t.first_name || '') + ' ' + (t.last_name || '')) + '</a>' : '—') + '</td>' +
          '<td class="mono">' + (t.case_id ? '<a href="#/case/' + t.case_id + '">' +
            esc(t.case_ref) + '</a>' : '—') + '</td>' +
          '<td>' + (t.due_date ? dt(t.due_date) : '—') +
          (late ? ' <span class="badge bad">overdue</span>' : '') + '</td>' +
          '<td>' + esc(t.assignee || '—') + '</td>' +
          '<td>' + (t.priority === 'normal' ? '<span class="muted">normal</span>'
            : '<span class="badge warn">' + esc(t.priority) + '</span>') + '</td>' +
          '<td class="num">' + (t.status === 'open'
            ? '<button class="btn btn-sm" onclick="completeTask(' + t.id + ')">Done</button>'
            : '<span class="badge ok">' + esc(t.status) + '</span>') +
          ' <button class="btn btn-sm" data-tedit="' + t.id + '">Edit</button>' +
          ' <button class="btn btn-sm btn-danger" data-tdel="' + t.id + '">✕</button></td></tr>';
      }).join('') + '</tbody></table></div>'
      : emptyBox('Nothing here', 'Tasks you create from a client or case file appear in this list.')) +
      '</div>';
    $('view').innerHTML = html;
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.onclick = function () { taskFilter = b.dataset.s; viewTasks(); };
    });
    $('tAdd').onclick = function () { taskForm({}, viewTasks); };
    document.querySelectorAll('[data-tedit]').forEach(function (b) {
      b.onclick = function () {
        var t = d.tasks.filter(function (x) {
          return String(x.id) === b.dataset.tedit; })[0];
        if (t) taskForm({}, viewTasks, t);
      };
    });
    document.querySelectorAll('[data-tdel]').forEach(function (b) {
      b.onclick = function () {
        confirmAction('Remove this task?', 'It goes for good.', 'Remove',
          function () {
            api('/api/tasks/' + b.dataset.tdel, {}, 'DELETE').then(function () {
              toast('Task removed.'); viewTasks();
            }).catch(function (e) { toast(e.message, 'bad'); });
          });
      };
    });
  }).catch(failed);
}

/* ============================================================= CALENDAR */
function viewCalendar() {
  setActive('calendar', 'Consultations');
  loading('Opening the diary…');
  var frm = plusDays(-7), to = plusDays(60);
  api('/api/appointments?from=' + frm + '&to=' + to).then(function (d) {
    var groups = {};
    d.appointments.forEach(function (a) {
      var day = String(a.starts_at).slice(0, 10);
      (groups[day] = groups[day] || []).push(a);
    });
    var days = Object.keys(groups).sort();
    var html = '<div class="row" style="margin-bottom:13px"><span class="muted small">' +
      'Showing ' + dt(frm) + ' to ' + dt(to) + '</span>' +
      '<button class="btn btn-gold row-end" id="apAdd">Book a consultation</button></div>';
    html += days.length ? days.map(function (day) {
      return '<div class="card"><h3>' + dt(day) +
        (day === today() ? ' <span class="badge gold">today</span>' : '') + '</h3>' +
        '<ul class="docs">' + groups[day].map(function (a) {
          var who = ((a.first_name || '') + ' ' + (a.last_name || '')).trim();
          return '<li><div class="doc-name"><b>' +
            (a.client_id
              ? '<a href="#/client/' + a.client_id + '">' + esc(who) + '</a>'
              : '<span class="muted">No client attached</span>') + '</b>' +
            '<span class="badge ' + (a.mode === 'virtual' ? 'info' : 'grey') + '">' +
            (a.mode === 'virtual' ? 'online' : 'at the office') + '</span>' +
            '<span class="sub">' +
            String(a.starts_at).slice(11, 16) + ' · ' + a.duration_min + ' min · ' +
            esc(a.title) + ' · ' + esc(a.advisor_name || '') +
            (a.case_ref ? ' · ' + esc(a.case_ref) : '') +
            (a.location ? '<br>' + (a.mode === 'virtual'
              ? '<a href="' + esc(a.location) + '" target="_blank" ' +
                'rel="noopener noreferrer">' + esc(a.location) + '</a>'
              : esc(a.location)) : '') +
            '</span></div>' +
            '<select class="inp" data-appt="' + a.id + '">' + opts([
              { value: 'scheduled', label: 'Booked' }, { value: 'held', label: 'Held' },
              { value: 'no_show', label: 'No show' }, { value: 'cancelled', label: 'Cancelled' }
            ], a.status) + '</select>' +
            '<button class="btn btn-sm" data-apdel="' + a.id + '">✕</button></li>';
        }).join('') + '</ul></div>';
    }).join('') : '<div class="card">' + emptyBox('Nothing in the diary',
      'Book a consultation from a client file, or with the button above.') + '</div>';
    $('view').innerHTML = html;
    $('apAdd').onclick = function () { apptForm({}, viewCalendar); };
    document.querySelectorAll('[data-appt]').forEach(function (s) {
      s.onchange = function () {
        api('/api/appointments/' + s.dataset.appt, { status: s.value }).then(function () {
          toast('Updated.', 'ok');
        }).catch(function (e) { toast(e.message, 'bad'); });
      };
    });
    document.querySelectorAll('[data-apdel]').forEach(function (b) {
      b.onclick = function () {
        api('/api/appointments/' + b.dataset.apdel, {}, 'DELETE').then(function () {
          toast('Removed.'); viewCalendar();
        });
      };
    });
  }).catch(failed);
}

/* ============================================================= EXPIRIES */
function viewExpiries() {
  setActive('expiries', 'Renewals and expiries');
  loading('Scanning permits and passports…');
  api('/api/expiries?days=120').then(function (d) {
    var html = '<div class="card"><h3>Expiring within 120 days</h3>' +
      '<p class="muted small">Permits, passports and dated documents already on file. ' +
      'Contact the client well before the date to start a renewal.</p>' +
      (d.expiries.length
        ? '<div class="tbl-wrap"><table><thead><tr><th>Client</th><th>What</th>' +
        '<th>Expires</th><th>Time left</th><th></th></tr></thead><tbody>' +
        d.expiries.map(function (x) {
          var cls = x.days < 0 ? 'bad' : (x.days <= 30 ? 'warn' : 'grey');
          return '<tr><td><b>' + esc((x.first_name || '') + ' ' + (x.last_name || '')) +
            '</b><span class="sub">' + esc(x.ref || '') + '</span></td>' +
            '<td>' + esc(x.what) + '</td><td>' + dt(x.expires) + '</td>' +
            '<td><span class="badge ' + cls + '">' +
            (x.days < 0 ? 'expired ' + Math.abs(x.days) + ' days ago' : x.days + ' days') +
            '</span></td>' +
            '<td class="num">' + (x.client_id || x.id
              ? '<a href="#/client/' + (x.client_id || x.id) + '">Open file ›</a>' : '') +
            '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : emptyBox('Nothing expiring soon',
          'Record passport and permit expiry dates on client files to use this view.')) +
      '</div>';
    $('view').innerHTML = html;
  }).catch(failed);
}

/* ============================================================== REPORTS */
function viewReports() {
  setActive('reports', 'Reports');
  loading('Preparing…');
  api('/api/reports').then(function (d) {
    var html = '<div class="card"><h3>Build a report</h3>' +
      '<div class="filters">' +
      '<select class="inp" id="rpKey">' + opts(d.reports.map(function (r) {
        return { value: r.key, label: r.title };
      })) + '</select>' +
      '<label class="small muted">From</label>' +
      '<input class="inp" id="rpFrom" type="date" value="' + plusDays(-180) + '">' +
      '<label class="small muted">To</label>' +
      '<input class="inp" id="rpTo" type="date" value="' + today() + '">' +
      '<button class="btn btn-primary" id="rpGo">Run</button>' +
      '<a class="btn" id="rpCsv" href="#">Download CSV</a>' +
      '<button class="btn" onclick="window.print()">Print</button></div>' +
      '<div id="rpOut">' + emptyBox('Pick a report',
        'Choose a report and a date range, then run it.') + '</div></div>';
    $('view').innerHTML = html;
    var run = function () {
      var key = val('rpKey'), f = val('rpFrom'), t = val('rpTo');
      $('rpCsv').href = '/export/' + key + '?from=' + f + '&to=' + t;
      $('rpOut').innerHTML = '<div class="loading">Running…</div>';
      api('/api/reports/' + key + '?from=' + f + '&to=' + t).then(function (r) {
        if (!r.rows.length) {
          $('rpOut').innerHTML = emptyBox('No rows', 'Nothing matches that period.');
          return;
        }
        $('rpOut').innerHTML = '<div class="row" style="margin:6px 0 10px">' +
          '<b>' + esc(r.title) + '</b><span class="muted small">' + r.count +
          ' rows · ' + dt(r.from) + ' to ' + dt(r.to) + '</span></div>' +
          reportChart(r) +
          '<div class="tbl-wrap"><table><thead><tr>' +
          r.columns.map(function (c) {
            return '<th>' + esc(c.replace(/_/g, ' ')) + '</th>';
          }).join('') + '</tr></thead><tbody>' +
          r.rows.slice(0, 300).map(function (row) {
            return '<tr>' + r.columns.map(function (c) {
              var v = row[c];
              if (typeof v === 'number' && c.indexOf('amount') === -1 &&
                c.indexOf('fee') === -1) v = String(v);
              return '<td>' + esc(v === null || v === undefined ? '' : v) + '</td>';
            }).join('') + '</tr>';
          }).join('') + '</tbody></table></div>' +
          (r.count > 300 ? '<p class="muted small">Showing the first 300 rows. ' +
            'Download the CSV for everything.</p>' : '');
      }).catch(function (e) {
        $('rpOut').innerHTML = '<div class="notice">' + esc(e.message) + '</div>';
      });
    };
    $('rpGo').onclick = run;
    $('rpKey').onchange = function () {
      $('rpCsv').href = '/export/' + val('rpKey') + '?from=' + val('rpFrom') +
        '&to=' + val('rpTo');
    };
  }).catch(failed);
}

/* ================================================================ STAFF */
function viewUsers() {
  setActive('users', 'Staff access');
  loading('Loading accounts…');
  api('/api/users').then(function (d) {
    var html = '<div class="row" style="margin-bottom:13px">' +
      '<span class="muted small">Only these accounts can sign in to the portal.</span>' +
      (ME.role === 'owner'
        ? '<button class="btn btn-gold row-end" id="uAdd">Add a staff member</button>' : '') +
      '</div>';
    html += '<div class="card"><div class="tbl-wrap"><table><thead><tr><th>Name</th>' +
      '<th>Email</th><th>Role</th><th>Last signed in</th><th>Status</th><th></th>' +
      '</tr></thead><tbody>' + d.users.map(function (u) {
        return '<tr><td><b>' + esc(u.name) + '</b>' +
          (u.id === ME.id ? ' <span class="badge">you</span>' : '') + '</td>' +
          '<td>' + esc(u.email) + '</td>' +
          '<td><span class="badge ' + (u.role === 'owner' ? 'gold' : 'grey') + '">' +
          esc(u.role === 'owner' ? 'owner' : 'administrator') + '</span></td>' +
          '<td>' + (u.last_login ? dtm(u.last_login) : '<span class="muted">never</span>') +
          '</td>' +
          '<td>' + (u.active ? '<span class="badge ok">active</span>'
            : '<span class="badge bad">disabled</span>') +
          (u.must_change ? ' <span class="badge warn">temp password</span>' : '') +
          (u.totp_enabled ? ' <span class="badge ok">two-step</span>' : '') + '</td>' +
          '<td class="num">' + (ME.role === 'owner'
            ? '<button class="btn btn-sm" data-uedit="' + u.id + '">Edit</button> ' +
            '<button class="btn btn-sm" data-ureset="' + u.id + '">Reset password</button>' +
            (u.totp_enabled
              ? ' <button class="btn btn-sm" data-u2fa="' + u.id +
                '">Clear two-step</button>' : '') +
            (u.id === ME.id ? ''
              : ' <button class="btn btn-sm btn-danger" data-udel="' + u.id +
                '">Remove</button>')
            : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    $('view').innerHTML = html;
    if ($('uAdd')) $('uAdd').onclick = function () { userForm(); };
    document.querySelectorAll('[data-uedit]').forEach(function (b) {
      b.onclick = function () {
        userForm(d.users.filter(function (u) {
          return String(u.id) === b.dataset.uedit;
        })[0]);
      };
    });
    document.querySelectorAll('[data-udel]').forEach(function (b) {
      b.onclick = function () {
        var who = d.users.filter(function (x) {
          return String(x.id) === b.dataset.udel; })[0];
        confirmAction('Remove ' + (who ? who.name : 'this person') + '?',
          'Their sign in is removed. Every client, case and note they worked ' +
          'on stays exactly as it is — the record belongs to the practice, ' +
          'not to the account.', 'Remove the account', function () {
            api('/api/users/' + b.dataset.udel, {}, 'DELETE').then(function () {
              toast('Account removed.'); viewUsers();
            }).catch(function (e) { toast(e.message, 'bad'); });
          });
      };
    });
    document.querySelectorAll('[data-u2fa]').forEach(function (b) {
      b.onclick = function () {
        confirmAction('Clear two-step sign in?',
          'Use this when someone has lost their phone and their recovery ' +
          'codes. They will sign in with their password alone until they set ' +
          'it up again.', 'Clear it', function () {
            api('/api/users/' + b.dataset.u2fa + '/reset-2fa', {}).then(function () {
              toast('Cleared. Ask them to set it up again.', 'ok'); viewUsers();
            }).catch(function (e) { toast(e.message, 'bad'); });
          });
      };
    });
    document.querySelectorAll('[data-ureset]').forEach(function (b) {
      b.onclick = function () {
        confirmAction('Reset password?',
          'A temporary password is generated. The person must change it when they sign in.',
          'Reset', function () {
            api('/api/users/' + b.dataset.ureset + '/reset-password', {}).then(function (r) {
              modal('Temporary password',
                '<p>Send this to them over a channel you trust. It works once — they will be ' +
                'asked to set their own password on sign in.</p><div class="code">' +
                esc(r.temp_password) + '</div>');
              viewUsers();
            }).catch(function (e) { toast(e.message, 'bad'); });
          });
      };
    });
  }).catch(failed);
}

function userForm(u) {
  modal(u ? 'Edit ' + u.name : 'Add a staff member',
    '<div class="grid-2">' +
    '<div class="field"><label class="lbl" for="uName">Full name</label>' +
    '<input class="inp" id="uName" value="' + esc(u ? u.name : '') + '"></div>' +
    '<div class="field"><label class="lbl" for="uEmail">Work email</label>' +
    '<input class="inp" id="uEmail" type="email" value="' + esc(u ? u.email : '') + '"' +
    (u ? ' disabled' : '') + '></div>' +
    '<div class="field"><label class="lbl" for="uRole">Role</label>' +
    '<select class="inp" id="uRole">' + opts([
      { value: 'admin', label: 'Administrator — clients, cases and money' },
      { value: 'owner', label: 'Owner — everything, including the office section' }
    ], u ? (u.role === 'advisor' ? 'admin' : u.role) : 'admin') + '</select></div>' +
    '<div class="field"><label class="lbl" for="uPhone">Phone</label>' +
    '<input class="inp" id="uPhone" value="' + esc(u ? u.phone : '') + '"></div></div>' +
    (u ? '<label class="small"><input type="checkbox" id="uActive"' +
      (u.active ? ' checked' : '') + '> Account is active</label>' : ''),
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="uGo">' + (u ? 'Save' : 'Create account') +
    '</button>');
  $('uGo').onclick = function () {
    if (!val('uName')) { toast('Enter their name.', 'bad'); return; }
    if (!u) {
      var bad = emailProblem(val('uEmail'), true);
      if (bad) { toast(bad, 'bad'); $('uEmail').focus(); return; }
    }
    this.disabled = true;
    var body = { name: val('uName'), role: val('uRole'), phone: val('uPhone') };
    if (u) body.active = checked('uActive');
    else body.email = val('uEmail');
    var p = u ? api('/api/users/' + u.id, body) : api('/api/users', body);
    p.then(function (r) {
      closeModal();
      if (r.temp_password) {
        modal('Account created',
          '<p>Give <b>' + esc(val('uName')) + '</b> this temporary password over a channel ' +
          'you trust. They will set their own on first sign in.</p>' +
          '<div class="code">' + esc(r.temp_password) + '</div>');
      } else { toast('Saved.', 'ok'); }
      viewUsers();
    }).catch(function (e) { toast(e.message, 'bad'); $('uGo').disabled = false; });
  };
}

/* ============================================================= SETTINGS */
function viewSettings() {
  setActive('settings', 'Settings');
  loading('Loading settings…');
  api('/api/settings').then(function (d) {
    var s = d.settings;
    var ro = ME.role !== 'owner';
    var f = function (id, label, key, hint) {
      return '<div class="field"><label class="lbl" for="' + id + '">' + esc(label) +
        '</label><input class="inp" id="' + id + '" value="' + esc(s[key] || '') + '"' +
        (ro ? ' disabled' : '') + '>' +
        (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>';
    };
    var html = (ro ? '<div class="notice info">Only the account owner can change these.</div>' : '') +
      '<div class="card"><h3>Organisation</h3><div class="grid-2">' +
      f('sName', 'Name', 'org_name') + f('sParent', 'Parent company', 'org_parent') +
      f('sEmail', 'Email', 'org_email') + f('sPhone', 'Telephone', 'org_phone') +
      f('sPhone2', 'Alternative telephone', 'org_phone_alt') +
      f('sAddr', 'Address', 'org_address') +
      f('sCur', 'Currency code', 'currency', 'Shown against every amount, for example LSL.') +
      f('sFee', 'Standard consultation fee', 'consultation_fee') +
      f('sWarn', 'Expiry warning window (days)', 'expiry_warn_days',
        'How far ahead the dashboard flags expiring permits.') +
      '</div></div>';

    html += '<div class="card"><h3>Website connection</h3>' +
      '<p class="muted small">The consultation form on maclesotho.com posts to this portal. ' +
      'These are the two settings that make that work.</p>' +
      f('sOrigins', 'Websites allowed to submit', 'allowed_origins',
        'Comma separated. Anything not on this list is refused by the browser.') +
      (s.intake_api_key
        ? '<div class="field"><span class="lbl">Intake key</span>' +
        '<div class="code" id="keyBox">' + esc(s.intake_api_key) + '</div>' +
        '<div class="hint">Paste this into the website snippet. Rotating it stops the old ' +
        'key working immediately, so update the website in the same sitting.</div></div>' +
        '<button class="btn btn-sm" id="sCopy">Copy key</button> ' +
        '<button class="btn btn-sm btn-danger" id="sRotate">Rotate key</button>'
        : '<p class="muted small">Only the account owner can see the intake key.</p>') +
      '</div>';

    /* ---- consultation reminders by email ---- */
    html += '<div class="card"><h3>Consultation reminders' +
      (s.reminders_enabled === '1'
        ? ' <span class="badge ok">on</span>'
        : ' <span class="badge grey">off</span>') + '</h3>' +
      '<p class="muted small">A message to the office inbox before each ' +
      'booked consultation. Zoho\'s server is filled in already; the password ' +
      'is an <b>app password</b> from Zoho, not your mailbox password.</p>' +
      '<div class="grid-2">' +
      f('sSmtpHost', 'Mail server', 'smtp_host') +
      f('sSmtpPort', 'Port', 'smtp_port', '465 for SSL, 587 for TLS.') +
      f('sSmtpUser', 'Username', 'smtp_user', 'Usually the full address.') +
      f('sSmtpFrom', 'Send from', 'smtp_from', 'Leave blank to use the username.') +
      f('sRemindMins', 'Minutes before', 'reminder_minutes') +
      '<div class="field"><label class="lbl" for="sRemindOn">Reminders</label>' +
      '<select class="inp" id="sRemindOn"' + (ro ? ' disabled' : '') + '>' +
      opts([{ value: '1', label: 'On' }, { value: '0', label: 'Off' }],
        s.reminders_enabled || '0') + '</select></div></div>' +
      (ro ? '' :
        '<div class="field"><label class="lbl" for="sSmtpPass">App password</label>' +
        '<input class="inp" id="sSmtpPass" type="password" placeholder="' +
        (s.smtp_pass_set ? 'stored — type a new one to replace it' : 'not set yet') +
        '"><div class="hint">Stored once and never shown again. Leave blank to ' +
        'keep the current one.</div></div>' +
        '<button class="btn btn-sm" id="sSmtpSave">Save the password</button> ' +
        '<button class="btn btn-sm" id="sTestMail">Send a test message</button> ' +
        '<button class="btn btn-sm" id="sRunRemind">Send any due now</button>') +
      '</div>';

    /* ---- money and exchange rates ---- */
    html += '<div class="card"><h3>Money</h3>' +
      '<p class="muted small">Everything is kept in the currency it was agreed ' +
      'in, and converted to <b>' + esc(s.base_currency || 'USD') + '</b> so the ' +
      'books add up across a file quoted in three of them.</p>' +
      '<div class="grid-2">' +
      '<div class="field"><label class="lbl" for="sBase">Primary currency</label>' +
      '<select class="inp" id="sBase"' + (ro ? ' disabled' : '') + '>' +
      opts(BOOT.currencies.map(function (c) {
        return { value: c.code, label: c.code + ' — ' + c.name };
      }), s.base_currency || 'USD') + '</select>' +
      '<div class="hint">The currency the books are kept in. Changing it ' +
      'clears the stored exchange rates, because they were all relative to ' +
      'the old one — press Refresh rates afterwards.</div></div>' +
      f('sTax', 'Standard tax rate (%)', 'tax_rate') +
      f('sInvNext', 'Next invoice number', 'invoice_next',
        'Carries on from your paper book. Only used before the first one is raised.') +
      f('sBankNo', 'Account number', 'bank_account_no') +
      f('sBankName', 'Account name', 'bank_account_name') +
      f('sBank', 'Bank', 'bank_name') + '</div>' +
      '<div class="field"><label class="lbl" for="sInvNotes">Standard invoice ' +
      'wording</label><textarea class="inp" id="sInvNotes"' + (ro ? ' disabled' : '') +
      '>' + esc(s.invoice_notes || '') + '</textarea></div>' +
      '<div class="field"><label class="lbl" for="sRecNotes">Standard receipt ' +
      'wording</label><textarea class="inp" id="sRecNotes"' + (ro ? ' disabled' : '') +
      '>' + esc(s.receipt_notes || '') + '</textarea></div>' +
      (ro ? '' :
        '<div class="field"><label class="lbl" for="sFxKey">exchangerate-api.com key</label>' +
        '<input class="inp" id="sFxKey" type="password" placeholder="' +
        (s.exchange_key_set ? 'stored — type a new one to replace it' : 'not set yet') +
        '"><div class="hint">' +
        (s.exchange_key_from_env
          ? 'A key is already coming from the EXCHANGE_API_KEY setting on ' +
            'Render. Typing one here replaces it, and can be changed without ' +
            'a redeploy.'
          : 'Without it amounts stay in their own currency and are left out ' +
            'of the converted totals, which the Accounts page says plainly ' +
            'rather than guessing.') + '</div></div>' +
        '<button class="btn btn-sm" id="sFxSave">Save the key</button> ' +
        '<button class="btn btn-sm" id="sFxRefresh">Refresh rates</button>') +
      '<div id="fxRates" class="small muted" style="margin-top:12px">Loading rates…</div>' +
      '</div>';

    /* ---- the public tracking page ---- */
    var trackUrl = location.origin + '/track';
    html += '<div class="card"><h3>Client case tracking' +
      (s.tracking_enabled === '1'
        ? ' <span class="badge ok">on</span>'
        : ' <span class="badge grey">off</span>') + '</h3>' +
      '<p class="muted small">A page where a client checks their own progress ' +
      'with their passport number and surname. It shows the stage and what is ' +
      'needed next — never a name, contact details, money or notes. Link to it ' +
      'from maclesotho.com.</p>' +
      '<div class="field"><span class="lbl">The address to link to</span>' +
      '<div class="code" id="trackUrl">' + esc(trackUrl) + '</div></div>' +
      '<div class="grid-2">' +
      '<div class="field"><label class="lbl" for="sTrackOn">Tracking</label>' +
      '<select class="inp" id="sTrackOn"' + (ro ? ' disabled' : '') + '>' +
      opts([{ value: '1', label: 'On' }, { value: '0', label: 'Off' }],
        s.tracking_enabled || '1') + '</select></div>' +
      '<div class="field"><label class="lbl" for="sTrackStrict">What a client must enter</label>' +
      '<select class="inp" id="sTrackStrict"' + (ro ? ' disabled' : '') + '>' +
      opts([{ value: '1', label: 'Passport number and surname' },
            { value: '0', label: 'Passport number alone' }],
        s.tracking_require_surname || '1') + '</select>' +
      '<div class="hint">' + (s.tracking_require_surname === '0'
        ? '<b>Passport number alone.</b> A passport number is not a secret — ' +
          'an employer, an agent or a relative may have it, and anyone who ' +
          'does can see that client\'s progress. Only the stage is shown, ' +
          'never a name or contact detail, but consider asking for the ' +
          'surname as well.'
        : 'Two facts mean a passport number on its own cannot open ' +
          'somebody\'s file.') + '</div></div></div>' +
      '<div class="field"><span class="lbl">To put it on maclesotho.com, add ' +
      'this where you want it to appear</span>' +
      '<div class="code" id="trackSnippet">&lt;div data-mac-track&gt;&lt;/div&gt;\n' +
      '&lt;script src="' + esc(location.origin) + '/track.js" defer&gt;&lt;/script&gt;</div>' +
      '<div class="hint">The client checks their progress without leaving ' +
      'your website. Nothing else on the page is touched.</div></div>' +
      '<button class="btn btn-sm" id="sTrackOpen">Open the page</button> ' +
      '<button class="btn btn-sm" id="sTrackCopy">Copy the address</button> ' +
      '<button class="btn btn-sm" id="sTrackSnip">Copy the snippet</button></div>';

    if (!ro) {
      html += '<div class="row"><button class="btn btn-primary" id="sSave">Save settings</button></div>';
    }
    $('view').innerHTML = html;
    if ($('sSave')) {
      $('sSave').onclick = function () {
        this.disabled = true;
        api('/api/settings', {
          org_name: val('sName'), org_parent: val('sParent'), org_email: val('sEmail'),
          org_phone: val('sPhone'), org_phone_alt: val('sPhone2'), org_address: val('sAddr'),
          currency: val('sCur'), consultation_fee: val('sFee'),
          expiry_warn_days: val('sWarn'), allowed_origins: val('sOrigins'),
          smtp_host: val('sSmtpHost'), smtp_port: val('sSmtpPort'),
          smtp_user: val('sSmtpUser'), smtp_from: val('sSmtpFrom'),
          reminder_minutes: val('sRemindMins'),
          reminders_enabled: val('sRemindOn'),
          tracking_enabled: val('sTrackOn'),
          tracking_require_surname: val('sTrackStrict'),
          base_currency: val('sBase'),
          tax_rate: val('sTax'), invoice_next: val('sInvNext'),
          bank_account_no: val('sBankNo'),
          bank_account_name: val('sBankName'), bank_name: val('sBank'),
          invoice_notes: val('sInvNotes'), receipt_notes: val('sRecNotes')
        }).then(function () {
          toast('Settings saved.', 'ok'); refreshUnread(); viewSettings();
        }).catch(function (e) { toast(e.message, 'bad'); $('sSave').disabled = false; });
      };
    }
    api('/api/fx').then(function (fx) {
      var host = $('fxRates');
      if (!host) return;
      var known = fx.rates.filter(function (r) { return r.rate; });
      host.innerHTML = known.length
        ? '<b>' + known.length + ' of ' + fx.rates.length + ' rates loaded.</b> ' +
          known.slice(0, 8).map(function (r) {
            return esc(r.code) + ' ' + Number(r.rate).toFixed(2);
          }).join(' · ') + (known.length > 8 ? ' …' : '')
        : 'No rates loaded yet.';
    }).catch(function () { });
    if ($('sFxSave')) {
      $('sFxSave').onclick = function () {
        var k = $('sFxKey').value;
        if (!k) { toast('Paste the key first.', 'bad'); return; }
        api('/api/settings/exchange-key', { key: k }).then(function () {
          $('sFxKey').value = '';
          toast('Key saved. Now press Refresh rates.', 'ok'); viewSettings();
        }).catch(function (e) { toast(e.message, 'bad'); });
      };
    }
    if ($('sFxRefresh')) {
      $('sFxRefresh').onclick = function () {
        var b = this; b.disabled = true; b.textContent = 'Fetching…';
        api('/api/fx/refresh', {}).then(function (r) {
          toast(r.saved + ' rates loaded' +
            (r.documents_converted ? ', ' + r.documents_converted +
             ' document(s) converted' : '') + '.', 'ok');
          viewSettings();
        }).catch(function (e) { toast(e.message, 'bad'); })
          .then(function () { b.disabled = false; b.textContent = 'Refresh rates'; });
      };
    }
    if ($('sSmtpSave')) {
      $('sSmtpSave').onclick = function () {
        var pw = $('sSmtpPass').value;
        if (!pw) { toast('Type the app password first.', 'bad'); return; }
        api('/api/settings/smtp-password', { password: pw }).then(function () {
          $('sSmtpPass').value = '';
          toast('Password saved.', 'ok'); viewSettings();
        }).catch(function (e) { toast(e.message, 'bad'); });
      };
    }
    if ($('sTestMail')) {
      $('sTestMail').onclick = function () {
        var b = this; b.disabled = true; b.textContent = 'Sending…';
        api('/api/settings/test-email', {}).then(function (r) {
          toast('Test message sent to ' + r.sent_to + '.', 'ok');
        }).catch(function (e) { toast(e.message, 'bad'); })
          .then(function () { b.disabled = false; b.textContent = 'Send a test message'; });
      };
    }
    if ($('sRunRemind')) {
      $('sRunRemind').onclick = function () {
        api('/api/reminders/run', {}).then(function (r) {
          toast(r.skipped ? r.skipped
            : (r.sent ? r.sent + ' reminder(s) sent.' : 'Nothing is due yet.'),
            r.sent ? 'ok' : '');
        }).catch(function (e) { toast(e.message, 'bad'); });
      };
    }
    if ($('sTrackOpen')) {
      $('sTrackOpen').onclick = function () { window.open('/track', '_blank'); };
    }
    if ($('sTrackSnip')) {
      $('sTrackSnip').onclick = function () {
        navigator.clipboard.writeText(
          '<div data-mac-track></div>\n<script src="' + location.origin +
          '/track.js" defer></' + 'script>').then(function () {
            toast('Snippet copied. Paste it into your page.', 'ok');
          }).catch(function () { toast('Select and copy it by hand.', 'bad'); });
      };
    }
    if ($('sTrackCopy')) {
      $('sTrackCopy').onclick = function () {
        navigator.clipboard.writeText(location.origin + '/track').then(function () {
          toast('Address copied.', 'ok');
        }).catch(function () { toast('Select and copy it by hand.', 'bad'); });
      };
    }
    if ($('sCopy')) {
      $('sCopy').onclick = function () {
        navigator.clipboard.writeText(s.intake_api_key).then(function () {
          toast('Key copied.', 'ok');
        }).catch(function () { toast('Select and copy it by hand.', 'bad'); });
      };
    }
    if ($('sRotate')) {
      $('sRotate').onclick = function () {
        confirmAction('Rotate the intake key?',
          'The website stops sending enquiries until you paste the new key into it.',
          'Rotate', function () {
            api('/api/settings/rotate-key', {}).then(function () {
              toast('Key rotated. Update the website now.', 'ok'); viewSettings();
            }).catch(function (e) { toast(e.message, 'bad'); });
          });
      };
    }
  }).catch(failed);
}

/* =============================================================== SYSTEM */

/* ---- small charts, drawn as plain SVG so there is nothing to load ------- */
function barChart(rows, opts) {
  opts = opts || {};
  rows = (rows || []).filter(function (r) { return r.value || opts.keepZero; });
  if (!rows.length) return '<p class="muted small">Nothing to chart yet.</p>';
  var most = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
  return '<div class="bars">' + rows.map(function (r) {
    return '<div class="bar-row"><div><span class="lab">' + esc(r.label) +
      '</span><div class="track"><i style="width:' + (r.value / most * 100) +
      '%' + (r.colour ? ';background:' + r.colour : '') + '"></i></div></div>' +
      '<span class="num">' + esc(r.display === undefined ? r.value : r.display) +
      '</span></div>';
  }).join('') + '</div>';
}

function donutChart(rows, opts) {
  opts = opts || {};
  rows = (rows || []).filter(function (r) { return r.value > 0; });
  var total = rows.reduce(function (a, r) { return a + r.value; }, 0);
  if (!total) return '<p class="muted small">Nothing to chart yet.</p>';
  var palette = ['#F97316', '#1A1A2E', '#B45309', '#2C2C4A', '#EA6A05',
                 '#6B7280', '#15803D', '#B91C1C'];
  var r = 52, c = 2 * Math.PI * r, at = 0;
  var ring = rows.map(function (row, i) {
    var frac = row.value / total, dash = frac * c;
    var seg = '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="' +
      (row.colour || palette[i % palette.length]) + '" stroke-width="22" ' +
      'stroke-dasharray="' + dash + ' ' + (c - dash) + '" ' +
      'stroke-dashoffset="' + (-at) + '" transform="rotate(-90 70 70)"></circle>';
    at += dash;
    return seg;
  }).join('');
  return '<div class="donut-wrap">' +
    '<svg viewBox="0 0 140 140" class="donut" role="img" aria-label="' +
    esc(opts.label || 'Breakdown') + '">' + ring +
    '<text x="70" y="70" text-anchor="middle" dominant-baseline="central" ' +
    'class="donut-mid">' + esc(opts.middle === undefined ? total : opts.middle) +
    '</text></svg>' +
    '<ul class="donut-key">' + rows.map(function (row, i) {
      return '<li><i style="background:' +
        (row.colour || palette[i % palette.length]) + '"></i>' +
        esc(row.label) + ' <b>' + row.value + '</b> <span class="muted">' +
        Math.round(row.value / total * 100) + '%</span></li>';
    }).join('') + '</ul></div>';
}


/* A report is a table of rows. Where those rows have a label and a number, or
   repeat a category, there is a picture in them worth drawing — so the shape
   of the answer is visible before anyone reads the figures. */
function reportChart(r) {
  var cols = r.columns || [], rows = r.rows || [];
  if (!cols.length || rows.length < 2) return '';

  var isMoney = function (c) {
    return /amount|fee|total|paid|balance|value/i.test(c);
  };
  var numeric = cols.filter(function (c) {
    var seen = 0;
    for (var i = 0; i < rows.length && i < 40; i++) {
      var v = rows[i][c];
      if (typeof v === 'number') seen++;
    }
    return seen > rows.length / 2 && !/^id$|_id$|year|month$/i.test(c);
  });
  var texty = cols.filter(function (c) {
    return numeric.indexOf(c) < 0 &&
      typeof (rows[0] || {})[c] === 'string' && !/date|_at$/i.test(c);
  });

  /* money or another measure against a label */
  var measure = numeric.filter(isMoney)[0] || numeric[0];
  if (measure && texty.length) {
    var by = {};
    rows.forEach(function (row) {
      var label = String(row[texty[0]] || '—');
      by[label] = (by[label] || 0) + (Number(row[measure]) || 0);
    });
    var data = Object.keys(by).map(function (k) {
      return { label: k, value: Math.round(by[k] * 100) / 100 };
    }).sort(function (a, b) { return b.value - a.value; }).slice(0, 12);
    if (data.length > 1) {
      return '<div class="card rp-chart"><h3>' +
        esc(measure.replace(/_/g, ' ')) + ' by ' +
        esc(texty[0].replace(/_/g, ' ')) + '</h3>' +
        barChart(data.map(function (d) {
          return { label: d.label,
                   value: d.value,
                   display: isMoney(measure)
                     ? money(d.value, r.currency) : d.value };
        })) + '</div>';
    }
  }

  /* no measure: count how the rows fall across a category */
  if (texty.length) {
    var tally = {};
    rows.forEach(function (row) {
      var label = String(row[texty[0]] || '—');
      tally[label] = (tally[label] || 0) + 1;
    });
    var keys = Object.keys(tally);
    if (keys.length > 1 && keys.length <= 8) {
      return '<div class="card rp-chart"><h3>How the ' + r.count +
        ' rows break down by ' + esc(texty[0].replace(/_/g, ' ')) + '</h3>' +
        donutChart(keys.map(function (k) {
          return { label: k, value: tally[k] };
        }), { middle: r.count }) + '</div>';
    }
    if (keys.length > 1) {
      return '<div class="card rp-chart"><h3>By ' +
        esc(texty[0].replace(/_/g, ' ')) + '</h3>' +
        barChart(keys.map(function (k) {
          return { label: k, value: tally[k] };
        }).sort(function (a, b) { return b.value - a.value; }).slice(0, 12)) +
        '</div>';
    }
  }
  return '';
}

function viewSystem() {
  setActive('system', 'System');
  loading('Checking the databases…');
  api('/api/system').then(function (d) {
    var p = d.primary, sb = d.standby, m = d.mirror;
    var rows = function (counts) {
      return Object.keys(counts || {}).map(function (t) {
        return '<dt>' + esc(t.replace(/_/g, ' ')) + '</dt><dd class="mono">' +
          (counts[t] === null ? '—' : counts[t]) + '</dd>';
      }).join('');
    };
    var html = '<div class="db-grid">' +
      '<div class="db-card"><h4><span class="dot ok"></span>Primary — ' + esc(p.engine) +
      '</h4><div class="host">' + esc(p.host || 'local file') + '</div>' +
      (p.used_mb !== undefined
        ? '<div class="meter"><i class="' + (p.used_mb / 512 > .8 ? 'crit' : '') +
        '" style="width:' + Math.min(100, p.used_mb / 512 * 100) + '%"></i></div>' +
        '<div class="hint">' + p.used_mb + ' MB used of about 512 MB on the Neon free plan.</div>'
        : '') +
      '<dl class="kv" style="margin-top:12px">' + rows(p.counts) + '</dl></div>';

    /* what the database is actually holding */
    var counts = p.counts || {};
    var interesting = ['clients', 'cases', 'case_documents', 'payments',
                       'enquiries', 'events', 'tasks', 'appointments',
                       'invoices', 'forms', 'audit'];
    var held = interesting.filter(function (t) { return counts[t]; })
      .map(function (t) {
        return { label: t.replace(/_/g, ' '), value: counts[t] };
      }).sort(function (a, b) { return b.value - a.value; });

    if (!sb.configured) {
      html += '<div class="db-card"><h4><span class="dot off"></span>Backup — not configured' +
        '</h4><p class="muted small">Set <b>MIRROR_DATABASE_URL</b> in Render to your ' +
        'Supabase connection string and redeploy. The primary keeps every read and write; ' +
        'the backup receives a full copy on a timer.</p></div>';
    } else {
      html += '<div class="db-card"><h4><span class="dot ' + (sb.reachable ? 'ok' : 'bad') +
        '"></span>Backup — Supabase</h4><div class="host">' + esc(sb.host || '') + '</div>' +
        (sb.reachable
          ? '<div class="hint">' + (sb.used_mb || 0) + ' MB stored.</div>' +
          '<dl class="kv" style="margin-top:12px">' + rows(sb.counts) + '</dl>'
          : '<div class="notice">' + esc(sb.error || 'Not reachable.') + '</div>') +
        '<div class="row" style="margin-top:12px">' +
        '<span class="small muted">Copies every ' + d.mirror_every_min + ' minutes.' +
        (m.last_run ? ' Last run ' + esc(m.last_run) + ' — ' +
          (m.last_ok ? m.rows + ' rows copied.' : 'failed.') : ' Not run yet.') + '</span>' +
        (ME.role === 'owner'
          ? '<button class="btn btn-sm row-end" id="mirrorNow">Copy now</button>' : '') +
        '</div>' +
        (m.last_error ? '<div class="notice" style="margin-top:10px">' + esc(m.last_error) +
          '</div>' : '') + '</div>';
    }
    html += '</div>';

    /* charts: what is stored, and how the backup compares */
    var sbCounts = (sb && sb.counts) || {};
    var behind = interesting.filter(function (t) {
      return counts[t] !== undefined && sbCounts[t] !== undefined &&
             counts[t] !== sbCounts[t];
    });
    html += '<div class="cols" style="margin-top:16px"><div class="card">' +
      '<h3>What the database is holding</h3>' +
      barChart(held) +
      '<p class="muted small" style="margin-top:10px">Row counts, largest first.</p>' +
      '</div><div class="card"><h3>Primary against backup</h3>' +
      (sb && sb.reachable
        ? barChart(interesting.filter(function (t) { return counts[t]; })
            .map(function (t) {
              return { label: t.replace(/_/g, ' ') + ' — backup',
                       value: sbCounts[t] || 0,
                       display: (sbCounts[t] || 0) + ' of ' + counts[t],
                       colour: (sbCounts[t] === counts[t])
                         ? 'var(--ok)' : 'var(--brand-accent-2)' };
            }), { keepZero: true }) +
          (behind.length
            ? '<p class="muted small" style="margin-top:10px">' +
              esc(behind.join(', ')) + ' differ. A few rows behind is normal ' +
              'between copies — the activity log grows as you use the portal.</p>'
            : '<p class="muted small" style="margin-top:10px">Every table matches ' +
              'the primary.</p>')
        : '<p class="muted small">No backup is configured, so there is nothing ' +
          'to compare.</p>') + '</div></div>';

    /* how the website form is faring */
    var okCount = d.ingest.filter(function (r) { return r.ok; }).length;
    var badCount = d.ingest.length - okCount;
    if (d.ingest.length) {
      html += '<div class="card" style="margin-top:16px">' +
        '<h3>Website submissions, accepted against refused</h3>' +
        donutChart([
          { label: 'Accepted', value: okCount, colour: '#15803D' },
          { label: 'Refused', value: badCount, colour: '#B91C1C' }
        ], { middle: d.ingest.length, label: 'Website submissions' }) +
        '<p class="muted small">Refusals are usually the honeypot catching a bot, ' +
        'or someone checking a passport number too often.</p></div>';
    }

    html += '<div class="card" style="margin-top:16px"><h3>Website submissions received</h3>' +
      '<p class="muted small">Every attempt to post the consultation form, accepted or not.</p>' +
      (d.ingest.length ? '<div class="tbl-wrap"><table><thead><tr><th>When</th>' +
        '<th>Result</th><th>Detail</th><th>From</th></tr></thead><tbody>' +
        d.ingest.map(function (r) {
          return '<tr><td>' + dtm(r.created_at) + '</td>' +
            '<td>' + (r.ok ? '<span class="badge ok">accepted</span>'
              : '<span class="badge bad">refused</span>') + '</td>' +
            '<td>' + esc(r.reason || '') + '</td>' +
            '<td class="mono small">' + esc(r.ip || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : emptyBox('Nothing yet', 'Submit the form on the website to test the connection.')) +
      '</div>';
    $('view').innerHTML = html;
    if ($('mirrorNow')) {
      $('mirrorNow').onclick = function () {
        this.disabled = true; this.textContent = 'Copying…';
        api('/api/system/mirror-now', {}).then(function (r) {
          toast(r.rows + ' rows copied to the backup in ' + r.seconds + 's.', 'ok');
          viewSystem();
        }).catch(function (e) { toast(e.message, 'bad'); viewSystem(); });
      };
    }
  }).catch(failed);
}

/* ================================================================ AUDIT */
function viewAudit() {
  setActive('audit', 'Activity log');
  loading('Reading the log…');
  api('/api/audit').then(function (d) {
    $('view').innerHTML = '<div class="card"><h3>Everything staff have done' +
      '<span class="right small"><a href="/export/audit?from=2000-01-01&to=' + today() +
      '">Download CSV</a></span></h3>' +
      (d.audit.length ? '<div class="tbl-wrap"><table><thead><tr><th>When</th><th>Who</th>' +
        '<th>Action</th><th>Detail</th><th>From</th></tr></thead><tbody>' +
        d.audit.map(function (a) {
          return '<tr><td>' + dtm(a.created_at) + '</td><td>' + esc(a.user_email || '—') +
            '</td><td><span class="badge grey">' + esc(a.action) + '</span></td>' +
            '<td>' + esc(a.detail || '') + '</td>' +
            '<td class="mono small">' + esc(a.ip || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : emptyBox('Empty', 'Nothing logged yet.')) +
      '</div>';
  }).catch(failed);
}


/* ================================================== REQUIREMENTS AND FEES */
var svcPick = null;

function viewServices() {
  setActive('services', 'Requirements and fees');
  loading('Opening the service list…');
  api('/api/services').then(function (d) {
    if (!svcPick) svcPick = d.services[0] && d.services[0].service;
    var html = '<p class="muted small" style="margin:0 0 13px">' +
      'What each permit or visa needs, and what it costs. Staff can read this ' +
      'out when a client asks, and a new case starts with exactly this ' +
      'checklist.</p><div class="svc-layout"><div class="card"><h3>Services</h3>' +
      '<div class="svc-list">' + d.services.map(function (s) {
        return '<button data-svc="' + esc(s.service) + '" class="' +
          (s.service === svcPick ? 'on' : '') + '">' + esc(s.service) +
          '<span class="svc-meta">' + s.requirements + ' requirement' +
          (s.requirements === 1 ? '' : 's') + ' · ' + s.fees + ' fee' +
          (s.fees === 1 ? '' : 's') +
          (s.cases ? ' · ' + s.cases + ' case' + (s.cases === 1 ? '' : 's') : '') +
          '</span></button>';
      }).join('') + '</div></div><div id="svcDetail"><div class="loading">Loading…</div></div></div>';
    $('view').innerHTML = html;
    document.querySelectorAll('[data-svc]').forEach(function (b) {
      b.onclick = function () { svcPick = b.dataset.svc; viewServices(); };
    });
    if (svcPick) loadServiceDetail(svcPick);
  }).catch(failed);
}

function loadServiceDetail(service) {
  api('/api/services/detail?service=' + encodeURIComponent(service))
    .then(function (d) {
      var html = '<div class="card"><h3>Documents the client must bring' +
        '<span class="right"><button class="btn btn-sm btn-gold" id="reqAdd">' +
        'Add a requirement</button></span></h3>' +
        (d.requirements.length ? '<ul class="docs">' + d.requirements.map(function (r) {
          return '<li><div class="doc-name"><b>' + esc(r.item) + '</b>' +
            '<span class="sub">' + (r.required ? 'required' : 'optional') +
            (r.detail ? ' · ' + esc(r.detail) : '') + '</span></div>' +
            '<button class="btn btn-sm" data-reqedit="' + r.id + '">Edit</button>' +
            '<button class="btn btn-sm btn-danger" data-reqdel="' + r.id + '">✕</button>' +
            '</li>';
        }).join('') + '</ul>'
          : emptyBox('Nothing listed yet',
            'Add what a client must bring for this service.')) + '</div>';

      html += '<div class="card"><h3>What it costs' +
        '<span class="right"><button class="btn btn-sm btn-gold" id="feeAdd">' +
        'Add a fee</button></span></h3>' +
        (d.fees.length ? '<div class="tbl-wrap"><table><thead><tr><th>Fee</th>' +
          '<th>When it is payable</th><th class="num">Amount</th><th></th></tr>' +
          '</thead><tbody>' + d.fees.map(function (f) {
            return '<tr><td><b>' + esc(f.label) + '</b>' +
              (f.note ? '<span class="sub">' + esc(f.note) + '</span>' : '') + '</td>' +
              '<td>' + esc(f.payable || '—') + '</td>' +
              '<td class="num">' + money(f.amount, f.currency) + '</td>' +
              '<td class="num"><button class="btn btn-sm" data-feeedit="' + f.id +
              '">Edit</button> <button class="btn btn-sm btn-danger" data-feedel="' +
              f.id + '">✕</button></td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="fee-total"><span class="muted">Total if every fee applies</span>' +
          '<b class="row-end mono">' + money(d.total, d.currency) + '</b></div>'
          : emptyBox('No fees listed yet',
            'Add the consultation fee and the stages you charge at.')) + '</div>';
      $('svcDetail').innerHTML = html;

      $('reqAdd').onclick = function () { reqForm(service, null); };
      $('feeAdd').onclick = function () { feeForm(service, null); };
      document.querySelectorAll('[data-reqedit]').forEach(function (b) {
        b.onclick = function () {
          reqForm(service, d.requirements.filter(function (r) {
            return String(r.id) === b.dataset.reqedit; })[0]);
        };
      });
      document.querySelectorAll('[data-feeedit]').forEach(function (b) {
        b.onclick = function () {
          feeForm(service, d.fees.filter(function (f) {
            return String(f.id) === b.dataset.feeedit; })[0]);
        };
      });
      document.querySelectorAll('[data-reqdel]').forEach(function (b) {
        b.onclick = function () {
          confirmAction('Remove this requirement?',
            'It stays on any case already open — only new cases change.',
            'Remove', function () {
              api('/api/services/requirements/' + b.dataset.reqdel, {}, 'DELETE')
                .then(function () { toast('Removed.'); viewServices(); })
                .catch(function (e) { toast(e.message, 'bad'); });
            });
        };
      });
      document.querySelectorAll('[data-feedel]').forEach(function (b) {
        b.onclick = function () {
          api('/api/services/fees/' + b.dataset.feedel, {}, 'DELETE')
            .then(function () { toast('Removed.'); viewServices(); })
            .catch(function (e) { toast(e.message, 'bad'); });
        };
      });
    }).catch(function (e) {
      $('svcDetail').innerHTML = '<div class="notice">' + esc(e.message) + '</div>';
    });
}

function reqForm(service, r) {
  modal(r ? 'Edit requirement' : 'Add a requirement',
    '<p class="muted small">For <b>' + esc(service) + '</b>.</p>' +
    '<div class="field"><label class="lbl" for="rqItem">What the client brings</label>' +
    '<input class="inp" id="rqItem" placeholder="Valid passport" value="' +
    esc(r ? r.item : '') + '"></div>' +
    '<div class="field"><label class="lbl" for="rqDetail">Any detail worth saying</label>' +
    '<input class="inp" id="rqDetail" placeholder="Certified, not older than three months" value="' +
    esc(r ? r.detail : '') + '"></div>' +
    '<label class="small"><input type="checkbox" id="rqReq"' +
    (!r || r.required ? ' checked' : '') + '> Required, not optional</label>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="rqGo">Save</button>');
  $('rqGo').onclick = function () {
    if (!val('rqItem')) { toast('Say what the client must bring.', 'bad'); return; }
    this.disabled = true;
    var body = { service: service, item: val('rqItem'), detail: val('rqDetail'),
                 required: checked('rqReq') };
    var p = r ? api('/api/services/requirements/' + r.id, body)
              : api('/api/services/requirements', body);
    p.then(function () { closeModal(); toast('Saved.', 'ok'); viewServices(); })
     .catch(function (e) { toast(e.message, 'bad'); $('rqGo').disabled = false; });
  };
}

function feeForm(service, f) {
  modal(f ? 'Edit fee' : 'Add a fee',
    '<p class="muted small">For <b>' + esc(service) + '</b>.</p>' +
    '<div class="grid-2">' +
    '<div class="field"><label class="lbl" for="feLabel">Fee</label>' +
    '<input class="inp" id="feLabel" placeholder="Consultation" value="' +
    esc(f ? f.label : '') + '"></div>' +
    '<div class="field"><label class="lbl" for="feAmount">Amount</label>' +
    '<input class="inp" id="feAmount" type="number" step="0.01" min="0" value="' +
    (f ? f.amount : '') + '"></div></div>' +
    '<div class="field"><label class="lbl" for="fePayable">When it is payable</label>' +
    '<input class="inp" id="fePayable" placeholder="50% on commencement" value="' +
    esc(f ? f.payable : '') + '"></div>' +
    '<div class="field"><label class="lbl" for="feNote">Note</label>' +
    '<input class="inp" id="feNote" value="' + esc(f ? f.note : '') + '"></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="feGo">Save</button>');
  $('feGo').onclick = function () {
    if (!val('feLabel')) { toast('Give the fee a name.', 'bad'); return; }
    this.disabled = true;
    var body = { service: service, label: val('feLabel'), amount: num('feAmount'),
                 payable: val('fePayable'), note: val('feNote') };
    var p = f ? api('/api/services/fees/' + f.id, body)
              : api('/api/services/fees', body);
    p.then(function () { closeModal(); toast('Saved.', 'ok'); viewServices(); })
     .catch(function (e) { toast(e.message, 'bad'); $('feGo').disabled = false; });
  };
}


/* ============================================================== ACCOUNTS */
var acctFilter = { kind: '', status: 'all', q: '' };

function viewAccounts() {
  setActive('accounts', 'Accounts');
  loading('Adding up the books…');
  var from = today().slice(0, 4) + '-01-01', to = today();
  Promise.all([
    api('/api/accounts?from=' + from + '&to=' + to),
    api('/api/invoices?kind=' + acctFilter.kind + '&status=' + acctFilter.status +
        '&q=' + encodeURIComponent(acctFilter.q))
  ]).then(function (r) {
    var books = r[0], list = r[1];
    var base = books.base;
    var usd = function (n) { return '$' + Number(n || 0).toLocaleString(undefined,
      { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

    var html = '';
    if (books.unconverted && books.unconverted.length) {
      html += '<div class="notice warn">Amounts in ' +
        esc(books.unconverted.join(', ')) + ' are not counted in the totals ' +
        'below, because no exchange rate is loaded for them. Add your ' +
        'exchangerate-api.com key in Settings and press Refresh rates.</div>';
    }
    html += '<div class="kpis">' +
      '<div class="kpi"><b>' + usd(books.billed) + '</b><span>Billed this year (' +
      esc(base) + ')</span></div>' +
      '<div class="kpi"><b>' + usd(books.received) + '</b><span>Received</span></div>' +
      '<div class="kpi' + (books.outstanding ? ' attn' : '') + '"><b>' +
      usd(books.outstanding) + '</b><span>Still owed</span></div>' +
      '<div class="kpi"><b>' + usd(books.ledger_total) +
      '</b><span>Payments recorded</span></div></div>';

    /* month by month */
    if (books.by_month.length) {
      var mx = Math.max.apply(null, books.by_month.map(function (m) {
        return Math.max(m.billed, m.received); }).concat([1]));
      html += '<div class="cols"><div class="card"><h3>Month by month</h3>' +
        '<div class="bars">' + books.by_month.map(function (m) {
          return '<div class="bar-row"><div><span class="lab">' + esc(m.month) +
            ' <span class="muted">billed ' + usd(m.billed) + ' · received ' +
            usd(m.received) + '</span></span>' +
            '<div class="track"><i style="width:' + (m.billed / mx * 100) + '%"></i></div>' +
            '<div class="track" style="margin-top:3px"><i style="width:' +
            (m.received / mx * 100) + '%;background:var(--ok)"></i></div></div>' +
            '<span class="num"></span></div>';
        }).join('') + '</div></div>';

      html += '<div class="card"><h3>By currency</h3>' +
        (books.by_currency.length
          ? '<div class="tbl-wrap"><table><thead><tr><th>Currency</th>' +
            '<th class="num">Billed</th><th class="num">Received</th></tr></thead><tbody>' +
            books.by_currency.map(function (c) {
              return '<tr><td>' + esc(c.currency) + '</td>' +
                '<td class="num">' + money(c.billed, c.currency) + '</td>' +
                '<td class="num">' + money(c.received, c.currency) + '</td></tr>';
            }).join('') + '</tbody></table></div>'
          : '<p class="muted small">Nothing raised yet.</p>') + '</div></div>';
    }

    /* the documents */
    html += '<div class="filters">' +
      '<select class="inp" id="acKind">' + opts([
        { value: '', label: 'Invoices and receipts' },
        { value: 'invoice', label: 'Invoices only' },
        { value: 'receipt', label: 'Receipts only' }], acctFilter.kind) + '</select>' +
      '<select class="inp" id="acStatus">' + opts([
        { value: 'all', label: 'Any status' }, { value: 'draft', label: 'Draft' },
        { value: 'sent', label: 'Sent' }, { value: 'paid', label: 'Paid' },
        { value: 'cancelled', label: 'Cancelled' }], acctFilter.status) + '</select>' +
      '<input class="inp" id="acQ" placeholder="Number or name" value="' +
      esc(acctFilter.q) + '">' +
      '<button class="btn" id="acGo">Apply</button>' +
      '<button class="btn btn-gold row-end" id="acNew">Raise an invoice</button></div>';

    html += '<div class="card">' + (list.invoices.length
      ? '<div class="tbl-wrap"><table><thead><tr><th>Number</th><th>For</th>' +
        '<th>Date</th><th class="num">Amount</th><th class="num">In ' + esc(base) +
        '</th><th>Status</th><th></th></tr></thead><tbody>' +
        list.invoices.map(function (v) {
          return '<tr><td class="mono"><b>' + esc(v.number) + '</b>' +
            '<span class="sub">' + esc(v.kind) + '</span></td>' +
            '<td>' + esc(v.bill_name) +
            (v.case_ref ? '<span class="sub">' + esc(v.case_ref) + '</span>' : '') + '</td>' +
            '<td>' + dt(v.issue_date) + '</td>' +
            '<td class="num">' + money(v.total, v.currency) + '</td>' +
            '<td class="num">' + (v.total_usd ? usd(v.total_usd)
              : '<span class="badge warn">no rate</span>') + '</td>' +
            '<td>' + invStatus(v) + '</td>' +
            '<td class="num"><button class="btn btn-sm" data-inv="' + v.id +
            '">Open</button></td></tr>';
        }).join('') + '</tbody></table></div>'
      : emptyBox('Nothing raised yet',
          'Raise an invoice from here, or from a case.')) + '</div>';

    $('view').innerHTML = html;
    $('acGo').onclick = function () {
      acctFilter = { kind: val('acKind'), status: val('acStatus'), q: val('acQ') };
      viewAccounts();
    };
    $('acNew').onclick = function () { invoiceForm(null); };
    document.querySelectorAll('[data-inv]').forEach(function (b) {
      b.onclick = function () { openInvoice(b.dataset.inv); };
    });
  }).catch(failed);
}

function invStatus(v) {
  var m = { draft: ['grey', 'draft'], sent: ['info', 'sent'],
            paid: ['ok', 'paid'], cancelled: ['bad', 'cancelled'] };
  var x = m[v.status] || ['grey', v.status];
  return '<span class="badge ' + x[0] + '">' + esc(x[1]) + '</span>';
}

function itemRows(items) {
  return (items && items.length ? items : [{ description: '', qty: 1, price: '' }])
    .map(function (it, i) { return itemRow(it, i); }).join('');
}

function itemRow(it, i) {
  return '<div class="item-row" data-row="' + i + '">' +
    '<input class="inp" data-f="description" placeholder="Consulting Fee" value="' +
    esc(it.description || '') + '">' +
    '<input class="inp" data-f="qty" type="number" step="0.01" min="0" value="' +
    (it.qty === undefined ? 1 : it.qty) + '">' +
    '<input class="inp" data-f="price" type="number" step="0.01" min="0" value="' +
    (it.price === undefined || it.price === '' ? '' : it.price) + '">' +
    '<button type="button" class="btn btn-sm btn-danger" data-drop="' + i + '">✕</button>' +
    '</div>';
}

function readItems() {
  var out = [];
  document.querySelectorAll('.item-row').forEach(function (row) {
    var get = function (f) {
      var el = row.querySelector('[data-f="' + f + '"]');
      return el ? el.value : '';
    };
    if (String(get('description')).trim()) {
      out.push({ description: get('description'),
                 qty: Number(get('qty') || 1), price: Number(get('price') || 0) });
    }
  });
  return out;
}

function wireItems() {
  var host = $('invItems');
  if (!host) return;
  host.querySelectorAll('[data-drop]').forEach(function (b) {
    b.onclick = function () {
      var rows = readItems();
      rows.splice(Number(b.dataset.drop), 1);
      host.innerHTML = itemRows(rows);
      wireItems();
      invTotals();
    };
  });
  host.querySelectorAll('input').forEach(function (el) { el.oninput = invTotals; });
}

function invTotals() {
  var rows = readItems();
  var sub = rows.reduce(function (a, r) { return a + r.qty * r.price; }, 0);
  var taxRate = Number(val('invTax') || 0);
  var tax = sub * taxRate / 100;
  var cur = val('invCurrency') || 'USD';
  if ($('invSub')) $('invSub').textContent = money(sub, cur);
  if ($('invTaxAmt')) $('invTaxAmt').textContent = money(tax, cur);
  if ($('invTotal')) $('invTotal').textContent = money(sub + tax, cur);
}

function invoiceForm(client, caseRow) {
  var cur = (BOOT.base_currency || 'USD');
  modal('Raise an invoice',
    (client ? '<input type="hidden" id="invClient" value="' + client.id + '">' +
      (caseRow ? '<input type="hidden" id="invCase" value="' + caseRow.id + '">' : '')
      : '') +
    '<div class="field"><label class="lbl" for="invName">Bill to</label>' +
    '<input class="inp" id="invName" placeholder="Their name" value="' +
    esc(client ? ((client.first_name || '') + ' ' + (client.last_name || '')).trim() : '') +
    '"></div>' +
    '<div class="grid-2">' +
    '<div class="field"><label class="lbl" for="invEmail">Email</label>' +
    '<input class="inp" id="invEmail" type="email" value="' +
    esc((client && client.email) || '') + '"></div>' +
    '<div class="field"><label class="lbl" for="invPhone">Telephone</label>' +
    '<input class="inp" id="invPhone" value="' +
    esc((client && client.phone) || '') + '"></div></div>' +
    '<div class="grid-3">' +
    '<div class="field"><label class="lbl" for="invCurrency">Currency</label>' +
    '<select class="inp" id="invCurrency">' + opts(BOOT.currencies.map(function (c) {
      return { value: c.code, label: c.code + ' — ' + c.name };
    }), cur) + '</select></div>' +
    dateField('invDate', 'Date', today()) +
    '<div class="field"><label class="lbl" for="invTax">Tax %</label>' +
    '<input class="inp" id="invTax" type="number" step="0.01" min="0" value="0"></div>' +
    '</div>' +
    '<span class="lbl">Lines</span>' +
    '<div class="item-head"><span>Description</span><span>Qty</span><span>Price</span><span></span></div>' +
    '<div id="invItems">' + itemRows(null) + '</div>' +
    '<button type="button" class="btn btn-sm" id="invAdd">Add a line</button>' +
    '<div class="inv-sums"><div><span>Sub total</span><b id="invSub">—</b></div>' +
    '<div><span>Tax</span><b id="invTaxAmt">—</b></div>' +
    '<div><span>Total</span><b id="invTotal">—</b></div></div>' +
    '<div class="field" style="margin-top:12px"><label class="lbl" for="invNotes">Notes</label>' +
    '<textarea class="inp" id="invNotes">' + esc(INVOICE_NOTES) + '</textarea>' +
    '<div class="hint">This is the standard wording from Settings. Edit it ' +
    'here for this one invoice.</div></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="invGo">Raise it</button>', true);
  wireItems();
  invTotals();
  $('invAdd').onclick = function () {
    var rows = readItems();
    rows.push({ description: '', qty: 1, price: '' });
    $('invItems').innerHTML = itemRows(rows);
    wireItems(); invTotals();
  };
  $('invCurrency').onchange = invTotals;
  $('invTax').oninput = invTotals;
  $('invGo').onclick = function () {
    var items = readItems();
    if (!items.length) { toast('Add at least one line.', 'bad'); return; }
    if (!val('invName')) { toast('Say who this is for.', 'bad'); return; }
    var badEmail = emailProblem(val('invEmail'));
    if (badEmail) { toast(badEmail, 'bad'); $('invEmail').focus(); return; }
    this.disabled = true;
    api('/api/invoices', {
      client_id: $('invClient') ? val('invClient') : null,
      case_id: $('invCase') ? val('invCase') : null,
      bill_name: val('invName'), bill_email: val('invEmail'),
      bill_phone: val('invPhone'),
      currency: val('invCurrency'), issue_date: val('invDate'),
      tax_rate: Number(val('invTax') || 0), notes: val('invNotes'), items: items
    }).then(function (d) {
      closeModal(); toast('Invoice ' + d.number + ' raised.', 'ok');
      openInvoice(d.id);
    }).catch(function (e) { toast(e.message, 'bad'); $('invGo').disabled = false; });
  };
}

function openInvoice(id) {
  api('/api/invoices/' + id).then(function (d) {
    var v = d.invoice;
    var body = '<dl class="kv">' +
      kvRow('Number', v.number) + kvRow('Type', v.kind) +
      kvRow('For', v.bill_name) + kvRow('Email', v.bill_email) +
      kvRow('Case', v.case_ref) + kvRow('Date', dt(v.issue_date)) +
      kvRow('Currency', v.currency) +
      kvRow('Sub total', money(v.subtotal, v.currency)) +
      kvRow('Tax', money(v.tax, v.currency)) +
      kvRow('Total', money(v.total, v.currency)) +
      (v.total_usd ? kvRow('In ' + (BOOT.base_currency || 'USD'),
        '$' + Number(v.total_usd).toFixed(2)) : '') +
      kvRow('Status', v.status) + kvRow('Paid on', v.paid_on) +
      '</dl>' +
      (v.total_usd ? '' : '<div class="notice warn">No exchange rate is loaded ' +
        'for ' + esc(v.currency) + ', so this is left out of the totals on the ' +
        'Accounts page.</div>') +
      '<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr>' +
      '<th>Description</th><th class="num">Qty</th><th class="num">Price</th>' +
      '<th class="num">Total</th></tr></thead><tbody>' +
      v.items.map(function (i) {
        return '<tr><td>' + esc(i.description) + '</td>' +
          '<td class="num">' + i.qty + '</td>' +
          '<td class="num">' + money(i.price, v.currency) + '</td>' +
          '<td class="num">' + money(i.line_total, v.currency) + '</td></tr>';
      }).join('') + '</tbody></table></div>';

    var foot = '<button class="btn left" id="invPrint">Open to print or save as PDF</button>';
    if (v.kind === 'invoice' && v.status !== 'paid' && v.status !== 'cancelled') {
      foot += '<button class="btn" id="invEdit">Edit</button>' +
        '<button class="btn btn-gold" id="invPaid">Mark paid and raise a receipt</button>';
    }
    foot += '<button class="btn" onclick="closeModal()">Close</button>';
    modal((v.kind === 'receipt' ? 'Receipt ' : 'Invoice ') + v.number, body, foot, true);

    $('invPrint').onclick = function () {
      window.open('/print/' + v.id + '?t=' + encodeURIComponent(TOKEN), '_blank');
    };
    if ($('invPaid')) {
      $('invPaid').onclick = function () {
        this.disabled = true;
        api('/api/invoices/' + v.id + '/receipt', { method: '' })
          .then(function (r) {
            closeModal();
            toast(r.payment_id
              ? 'Receipt ' + r.number + ' raised and the payment recorded.'
              : 'Receipt ' + r.number + ' raised. No payment was added to the ' +
                'ledger because this is not attached to a client.', 'ok');
            viewAccounts();
          }).catch(function (e) { toast(e.message, 'bad'); });
      };
    }
    if ($('invEdit')) {
      $('invEdit').onclick = function () { editInvoice(v); };
    }
  }).catch(function (e) { toast(e.message, 'bad'); });
}

function editInvoice(v) {
  modal('Edit invoice ' + v.number,
    '<div class="grid-3">' +
    '<div class="field"><label class="lbl" for="invCurrency">Currency</label>' +
    '<select class="inp" id="invCurrency">' + opts(BOOT.currencies.map(function (c) {
      return { value: c.code, label: c.code + ' — ' + c.name };
    }), v.currency) + '</select></div>' +
    dateField('invDate', 'Date', v.issue_date) +
    '<div class="field"><label class="lbl" for="invTax">Tax %</label>' +
    '<input class="inp" id="invTax" type="number" step="0.01" min="0" value="' +
    (v.tax_rate || 0) + '"></div></div>' +
    '<div class="field"><label class="lbl" for="invName">Bill to</label>' +
    '<input class="inp" id="invName" value="' + esc(v.bill_name) + '"></div>' +
    '<div class="grid-2">' +
    '<div class="field"><label class="lbl" for="invEmail">Email</label>' +
    '<input class="inp" id="invEmail" type="email" value="' +
    esc(v.bill_email) + '"></div>' +
    '<div class="field"><label class="lbl" for="invPhone">Telephone</label>' +
    '<input class="inp" id="invPhone" value="' + esc(v.bill_phone) + '"></div></div>' +
    '<span class="lbl">Lines</span>' +
    '<div class="item-head"><span>Description</span><span>Qty</span><span>Price</span><span></span></div>' +
    '<div id="invItems">' + itemRows(v.items) + '</div>' +
    '<button type="button" class="btn btn-sm" id="invAdd">Add a line</button>' +
    '<div class="inv-sums"><div><span>Sub total</span><b id="invSub">—</b></div>' +
    '<div><span>Tax</span><b id="invTaxAmt">—</b></div>' +
    '<div><span>Total</span><b id="invTotal">—</b></div></div>' +
    '<div class="field" style="margin-top:12px"><label class="lbl" for="invNotes">Notes</label>' +
    '<textarea class="inp" id="invNotes">' + esc(v.notes) + '</textarea></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="invSave">Save</button>', true);
  wireItems(); invTotals();
  $('invAdd').onclick = function () {
    var rows = readItems();
    rows.push({ description: '', qty: 1, price: '' });
    $('invItems').innerHTML = itemRows(rows);
    wireItems(); invTotals();
  };
  $('invCurrency').onchange = invTotals;
  $('invTax').oninput = invTotals;
  $('invSave').onclick = function () {
    this.disabled = true;
    api('/api/invoices/' + v.id, {
      bill_name: val('invName'), bill_email: val('invEmail'),
      bill_phone: val('invPhone'), currency: val('invCurrency'),
      issue_date: val('invDate'), tax_rate: Number(val('invTax') || 0),
      notes: val('invNotes'), items: readItems()
    }).then(function () {
      closeModal(); toast('Saved.', 'ok'); openInvoice(v.id);
    }).catch(function (e) { toast(e.message, 'bad'); $('invSave').disabled = false; });
  };
}


/* ============================================================= ANALYTICS */
var LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
var LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
var ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/' +
  'World_Imagery/MapServer/tile/{z}/{y}/{x}';
/* Satellite imagery alone has no borders or names on it, which makes a
   circle hard to read. Esri publish a transparent reference layer of
   boundaries and place names that sits on top of it. */
var ESRI_LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/' +
  'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
var mapsReady = null;

/* Leaflet is fetched only when this page is opened, and only once. If it
   cannot be reached the page still works — every map falls back to the same
   figures as a ranked list, so the analysis is never lost behind a blank
   rectangle. */
function loadMaps() {
  if (mapsReady) return mapsReady;
  mapsReady = new Promise(function (resolve, reject) {
    if (window.L) { resolve(window.L); return; }
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = LEAFLET_CSS;
    document.head.appendChild(css);
    var s = document.createElement('script');
    s.src = LEAFLET_JS;
    s.onload = function () { window.L ? resolve(window.L) : reject(new Error('no L')); };
    s.onerror = function () { reject(new Error('Leaflet could not be loaded')); };
    document.head.appendChild(s);
    setTimeout(function () {
      if (!window.L) reject(new Error('Leaflet took too long'));
    }, 8000);
  });
  return mapsReady;
}

function drawMap(hostId, points, key, colour) {
  var host = $(hostId);
  if (!host) return;
  loadMaps().then(function (L) {
    host.innerHTML = '';
    var map = L.map(host, { scrollWheelZoom: false, worldCopyJump: true })
      .setView([-10, 25], 2);
    L.tileLayer(ESRI_TILES, {
      maxZoom: 16,
      attribution: 'Imagery &copy; Esri'
    }).addTo(map);
    L.tileLayer(ESRI_LABELS, { maxZoom: 16, pane: 'overlayPane' }).addTo(map);

    var most = Math.max.apply(null, points.map(function (p) { return p[key]; })
      .concat([1]));
    var bounds = [];
    points.forEach(function (p) {
      var r = 8 + Math.sqrt(p[key] / most) * 22;
      L.circleMarker([p.lat, p.lon], {
        radius: r, color: colour, weight: 2,
        fillColor: colour, fillOpacity: .45
      }).addTo(map).bindPopup(
        '<b>' + esc(p.country) + '</b><br>' + p[key] + ' ' +
        (p[key] === 1 ? key.replace(/s$/, '') : key) +
        (p.names.length && p.names[0] !== p.country
          ? '<br><span style="color:#6B7280">' + esc(p.names.join(', ')) + '</span>'
          : ''));
      bounds.push([p.lat, p.lon]);
    });
    if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 5 });
    setTimeout(function () { map.invalidateSize(); }, 120);
  }).catch(function () {
    host.classList.add('map-fallback');
    host.innerHTML = '<div class="notice warn" style="margin:0 0 10px">' +
      'The map could not be loaded, so the same figures are listed instead.' +
      '</div>' + rankList(points, key);
  });
}

function rankList(points, key) {
  if (!points.length) return '<p class="muted small">Nothing to show yet.</p>';
  var most = Math.max.apply(null, points.map(function (p) { return p[key]; }));
  return '<div class="bars">' + points.slice(0, 12).map(function (p) {
    return '<div class="bar-row"><div><span class="lab">' + esc(p.country) +
      '</span><div class="track"><i style="width:' + (p[key] / most * 100) +
      '%"></i></div></div><span class="num">' + p[key] + '</span></div>';
  }).join('') + '</div>';
}

function unplacedNote(block, key) {
  if (!block.unplaced.length) return '';
  return '<p class="muted small" style="margin-top:10px">Not shown on the map: ' +
    block.unplaced.map(function (u) {
      return esc(u.name) + ' (' + u[key] + ')';
    }).join(', ') + '. These are counted in the totals — the map simply has no ' +
    'point for them.</p>';
}

function viewAnalytics() {
  setActive('analytics', 'Analytics');
  loading('Working out where the practice stands…');
  api('/api/analytics').then(function (d) {
    var t = d.totals;
    var html = '<div class="kpis">' +
      '<div class="kpi"><b>' + t.clients + '</b><span>Clients</span></div>' +
      '<div class="kpi"><b>' + t.open_cases + '</b><span>Open cases</span></div>' +
      '<div class="kpi"><b>' + t.cases + '</b><span>Cases all told</span></div>' +
      '<div class="kpi"><b>' + (d.approval_rate === null ? '—'
        : d.approval_rate + '%') + '</b><span>Approved, of ' + d.decided +
        ' decided</span></div>' +
      '<div class="kpi"><b>' + (d.turnaround.median === null ? '—'
        : d.turnaround.median + ' days') +
        '</b><span>Typical wait for a decision</span></div>' +
      '</div>';

    html += '<div class="card"><h3>Where clients come from ' +
      '<span class="badge">' + d.origins.total + '</span></h3>' +
      '<div class="map" id="mapOrigins"><div class="loading">Loading the map…</div></div>' +
      unplacedNote(d.origins, 'clients') + '</div>';

    html += '<div class="card"><h3>Where they are going ' +
      '<span class="badge">' + d.destinations.total + '</span></h3>' +
      '<div class="map" id="mapDest"><div class="loading">Loading the map…</div></div>' +
      unplacedNote(d.destinations, 'cases') + '</div>';

    html += '<div class="cols"><div class="stack">' +
      '<div class="card"><h3>Enquiries, clients and cases over twelve months</h3>' +
      trendSvg(d.trend) +
      '<div class="legend"><span><i style="background:var(--brand-accent)"></i>Enquiries</span>' +
      '<span><i style="background:var(--brand-deep)"></i>Cases opened</span></div></div>';

    var svcMax = Math.max.apply(null, d.by_service.map(function (s) {
      return s.n; }).concat([1]));
    html += '<div class="card"><h3>Which services</h3>' +
      (d.by_service.length ? '<div class="bars">' + d.by_service.map(function (s) {
        return '<div class="bar-row"><div><span class="lab">' +
          esc(shortService(s.name)) + '</span><div class="track"><i style="width:' +
          (s.n / svcMax * 100) + '%"></i></div></div><span class="num">' +
          s.n + '</span></div>';
      }).join('') + '</div>' : '<p class="muted small">No cases yet.</p>') + '</div>';

    html += '</div><div class="stack">';

    var stMax = Math.max.apply(null, d.by_stage.map(function (s) {
      return s.n; }).concat([1]));
    html += '<div class="card"><h3>Open cases by stage</h3><div class="bars">' +
      d.by_stage.map(function (s) {
        return '<div class="bar-row"><div><span class="lab">' + esc(s.name) +
          '</span><div class="track"><i style="width:' + (s.n / stMax * 100) +
          '%"></i></div></div><span class="num">' + s.n + '</span></div>';
      }).join('') + '</div></div>';

    html += '<div class="card"><h3>How they ended</h3>' +
      (d.outcomes.length ? '<div class="bars">' + d.outcomes.map(function (o) {
        var mx = Math.max.apply(null, d.outcomes.map(function (x) { return x.n; }));
        return '<div class="bar-row"><div><span class="lab">' + esc(o.name) +
          '</span><div class="track"><i style="width:' + (o.n / mx * 100) +
          '%;background:' + (o.name === 'Approved' ? 'var(--ok)' : 'var(--bad)') +
          '"></i></div></div><span class="num">' + o.n + '</span></div>';
      }).join('') + '</div>' : '<p class="muted small">Nothing decided yet.</p>') +
      '</div>';

    if (d.turnaround.samples) {
      html += '<div class="card"><h3>Time from submission to decision</h3>' +
        '<dl class="kv"><dt>Quickest</dt><dd>' + d.turnaround.fastest + ' days</dd>' +
        '<dt>Typical</dt><dd><b>' + d.turnaround.median + ' days</b></dd>' +
        '<dt>Longest</dt><dd>' + d.turnaround.slowest + ' days</dd>' +
        '<dt>Based on</dt><dd>' + d.turnaround.samples + ' decided case' +
        (d.turnaround.samples === 1 ? '' : 's') + '</dd></dl></div>';
    }

    html += '</div></div>';
    $('view').innerHTML = html;
    drawMap('mapOrigins', d.origins.points, 'clients', '#F97316');
    drawMap('mapDest', d.destinations.points, 'cases', '#1A1A2E');
  }).catch(failed);
}


/* ================================================================= FORMS */
var formFilter = { service: '', authority: '', q: '', retired: false };

function niceSize(n) {
  n = Number(n || 0);
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function viewForms() {
  setActive('forms', 'Forms');
  loading('Fetching the forms…');
  api('/api/forms?service=' + encodeURIComponent(formFilter.service) +
      '&authority=' + encodeURIComponent(formFilter.authority) +
      '&q=' + encodeURIComponent(formFilter.q) +
      '&include_retired=' + (formFilter.retired ? '1' : '0')).then(function (d) {
    var html = '<p class="muted small" style="margin:0 0 13px">' +
      'Blank government forms, kept in one place so nobody hunts through an ' +
      'inbox for the current version. Files live in the database, so they ' +
      'survive a redeploy and are copied to the standby with everything else.' +
      '</p>';

    html += '<div class="filters">' +
      '<select class="inp" id="fmService">' + opts(
        [{ value: '', label: 'Every service' }].concat(
          (d.services || []).map(function (s) {
            return { value: s, label: shortService(s) }; })),
        formFilter.service) + '</select>' +
      '<select class="inp" id="fmAuth">' + opts(
        [{ value: '', label: 'Every authority' }].concat(
          (d.authorities || []).map(function (a) {
            return { value: a, label: a }; })),
        formFilter.authority) + '</select>' +
      '<input class="inp" id="fmQ" placeholder="Search" value="' +
      esc(formFilter.q) + '">' +
      '<label class="small"><input type="checkbox" id="fmRetired"' +
      (formFilter.retired ? ' checked' : '') + '> Include retired</label>' +
      '<button class="btn" id="fmGo">Apply</button>' +
      '<button class="btn btn-gold row-end" id="fmAdd">Add a form</button></div>';

    var groups = {};
    (d.forms || []).forEach(function (f) {
      (groups[f.authority || 'Not attributed'] =
        groups[f.authority || 'Not attributed'] || []).push(f);
    });
    var names = Object.keys(groups).sort();

    html += names.length ? names.map(function (auth) {
      return '<div class="card"><h3>' + esc(auth) + '</h3><ul class="docs">' +
        groups[auth].map(function (f) {
          return '<li><div class="doc-name"><b>' + esc(f.title) + '</b>' +
            (f.active ? '' : ' <span class="badge grey">retired</span>') +
            '<span class="sub">' +
            (f.service ? esc(shortService(f.service)) + ' · ' : '') +
            (f.version ? 'version ' + esc(f.version) + ' · ' : '') +
            (f.has_file ? esc(f.filename || 'file') + ' ' + niceSize(f.size_bytes)
                        : 'link only') +
            (f.downloads ? ' · taken ' + f.downloads + ' time' +
              (f.downloads === 1 ? '' : 's') : '') +
            (f.description ? '<br>' + esc(f.description) : '') +
            '</span></div>' +
            (f.has_file
              ? '<button class="btn btn-sm btn-gold" data-fdl="' + f.id +
                '">Download</button>'
              : '') +
            (f.source_url
              ? '<a class="btn btn-sm" target="_blank" rel="noopener noreferrer" ' +
                'href="' + esc(f.source_url) + '">Open the source</a>'
              : '') +
            '<button class="btn btn-sm" data-fedit="' + f.id + '">Edit</button>' +
            (ME.role === 'owner'
              ? '<button class="btn btn-sm btn-danger" data-fdel="' + f.id +
                '">✕</button>' : '') +
            '</li>';
        }).join('') + '</ul></div>';
    }).join('')
      : '<div class="card">' + emptyBox('No forms yet',
          'Add the blank papers your clients have to complete.') + '</div>';

    $('view').innerHTML = html;
    $('fmGo').onclick = function () {
      formFilter = { service: val('fmService'), authority: val('fmAuth'),
                     q: val('fmQ'), retired: checked('fmRetired') };
      viewForms();
    };
    $('fmAdd').onclick = function () { formEditor(null, d); };
    document.querySelectorAll('[data-fdl]').forEach(function (b) {
      b.onclick = function () {
        window.open('/forms/' + b.dataset.fdl + '/download?t=' +
                    encodeURIComponent(TOKEN), '_blank');
      };
    });
    document.querySelectorAll('[data-fedit]').forEach(function (b) {
      b.onclick = function () {
        formEditor(d.forms.filter(function (f) {
          return String(f.id) === b.dataset.fedit; })[0], d);
      };
    });
    document.querySelectorAll('[data-fdel]').forEach(function (b) {
      b.onclick = function () {
        confirmAction('Remove this form?',
          'The file goes with it. Retiring it instead keeps it for reference ' +
          'but hides it from the list.', 'Remove', function () {
            api('/api/forms/' + b.dataset.fdel, {}, 'DELETE').then(function () {
              toast('Removed.'); viewForms();
            }).catch(function (e) { toast(e.message, 'bad'); });
          });
      };
    });
  }).catch(failed);
}

function formEditor(f, meta) {
  modal(f ? 'Edit form' : 'Add a form',
    '<div class="field"><label class="lbl" for="fmTitle">What the form is called</label>' +
    '<input class="inp" id="fmTitle" placeholder="Work Permit Application Form" value="' +
    esc(f ? f.title : '') + '"></div>' +
    '<div class="grid-2">' +
    '<div class="field"><label class="lbl" for="fmAuthority">Which authority</label>' +
    '<input class="inp" id="fmAuthority" placeholder="Ministry of Home Affairs" value="' +
    esc(f ? f.authority : '') + '"></div>' +
    '<div class="field"><label class="lbl" for="fmSvc">Which service</label>' +
    '<select class="inp" id="fmSvc">' + opts(
      [{ value: '', label: 'Any' }].concat((meta.services || []).map(function (s) {
        return { value: s, label: s }; })),
      f ? f.service : '') + '</select></div></div>' +
    '<div class="field"><label class="lbl" for="fmDesc">Anything worth saying about it</label>' +
    '<input class="inp" id="fmDesc" placeholder="Client completes and signs in black ink" value="' +
    esc(f ? f.description : '') + '"></div>' +
    '<div class="grid-2">' +
    '<div class="field"><label class="lbl" for="fmVer">Version</label>' +
    '<input class="inp" id="fmVer" placeholder="2026 rev 2" value="' +
    esc(f ? f.version : '') + '"></div>' +
    '<div class="field"><label class="lbl" for="fmUrl">Or a link to it</label>' +
    '<input class="inp" id="fmUrl" placeholder="https://…" value="' +
    esc(f ? f.source_url : '') + '"></div></div>' +
    '<div class="field"><label class="lbl" for="fmFile">The file</label>' +
    '<input class="inp" id="fmFile" type="file" ' +
    'accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.txt,.rtf,.zip">' +
    '<div class="hint" id="fmFileHint">' +
    (f && f.has_file
      ? esc(f.filename || 'a file') + ' ' + niceSize(f.size_bytes) +
        ' is stored. Choose another only to replace it.'
      : 'Up to ' + (meta.max_mb || 6) + ' MB. PDF, Word, Excel or an image.') +
    '</div></div>' +
    (f ? '<label class="small"><input type="checkbox" id="fmActive"' +
      (f.active ? ' checked' : '') + '> In use (uncheck to retire it)</label>' : ''),
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="fmSave">Save</button>', true);

  var picked = null;
  $('fmFile').onchange = function () {
    var file = this.files && this.files[0];
    picked = null;
    if (!file) return;
    var maxBytes = (meta.max_mb || 6) * 1024 * 1024;
    if (file.size > maxBytes) {
      toast('That file is too large. Keep it under ' + (meta.max_mb || 6) + ' MB.', 'bad');
      this.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      picked = { name: file.name, data: String(reader.result) };
      $('fmFileHint').textContent = file.name + ' ' + niceSize(file.size) +
        ' ready to upload.';
    };
    reader.onerror = function () { toast('That file could not be read.', 'bad'); };
    reader.readAsDataURL(file);
  };

  $('fmSave').onclick = function () {
    if (!val('fmTitle')) { toast('Give the form a name.', 'bad'); return; }
    if (!f && !picked && !val('fmUrl')) {
      toast('Attach the form, or give a link to where it lives.', 'bad');
      return;
    }
    var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
    var body = {
      title: val('fmTitle'), authority: val('fmAuthority'),
      service: val('fmSvc'), description: val('fmDesc'),
      version: val('fmVer'), source_url: val('fmUrl')
    };
    if (f) body.active = checked('fmActive');
    if (picked) { body.content_base64 = picked.data; body.filename = picked.name; }
    var p = f ? api('/api/forms/' + f.id, body) : api('/api/forms', body);
    p.then(function () { closeModal(); toast('Saved.', 'ok'); viewForms(); })
     .catch(function (e) {
       toast(e.message, 'bad');
       btn.disabled = false; btn.textContent = 'Save';
     });
  };
}

/* ============================================================== PROFILE */
function viewProfile() {
  setActive('profile', 'My profile');
  $('view').innerHTML = '<div class="card" style="max-width:520px"><h3>Your details</h3>' +
    '<div class="field"><label class="lbl" for="prName">Name</label>' +
    '<input class="inp" id="prName" value="' + esc(ME.name) + '"></div>' +
    '<div class="field"><label class="lbl" for="prPhone">Phone</label>' +
    '<input class="inp" id="prPhone" value="' + esc(ME.phone || '') + '"></div>' +
    '<div class="field"><span class="lbl">Email</span><div class="code">' + esc(ME.email) +
    '</div><div class="hint">Ask the account owner to change your email address.</div></div>' +
    '<div class="row"><button class="btn btn-primary" id="prSave">Save</button>' +
    '<button class="btn" id="prPw">Change password</button></div></div>' +
    '<div class="card" style="max-width:520px" id="twoFactor"></div>';
  $('prSave').onclick = function () {
    api('/api/profile', { name: val('prName'), phone: val('prPhone') }).then(function () {
      ME.name = val('prName'); ME.phone = val('prPhone');
      paintChrome(); setActive('profile', 'My profile'); toast('Saved.', 'ok');
    }).catch(function (e) { toast(e.message, 'bad'); });
  };
  $('prPw').onclick = function () { openPasswordModal(false); };
  renderTwoFactor();
}

/* -------------------------------------------------- two-step sign in panel */
function renderTwoFactor() {
  var host = $('twoFactor');
  if (!host) return;
  host.innerHTML = '<div class="loading">Checking…</div>';
  api('/api/2fa/status').then(function (d) {
    if (d.enabled) {
      host.innerHTML = '<h3>Two-step sign in ' +
        '<span class="badge ok">on</span></h3>' +
        '<p class="muted small">Signing in asks for a six-digit code from your ' +
        'authenticator app. You have <b>' + d.recovery_left + '</b> recovery ' +
        (d.recovery_left === 1 ? 'code' : 'codes') + ' left for the day you ' +
        'lose your phone.</p>' +
        '<button class="btn btn-danger btn-sm" id="tfOff">Turn it off</button>';
      $('tfOff').onclick = twoFactorOff;
    } else {
      host.innerHTML = '<h3>Two-step sign in ' +
        '<span class="badge grey">off</span></h3>' +
        '<p class="muted small">Add a six-digit code from your phone on top of ' +
        'your password. This portal holds passport numbers and immigration ' +
        'histories, so it is worth the extra few seconds.</p>' +
        '<button class="btn btn-gold btn-sm" id="tfOn">Set it up</button>';
      $('tfOn').onclick = twoFactorSetup;
    }
  }).catch(function (e) {
    host.innerHTML = '<div class="notice">' + esc(e.message) + '</div>';
  });
}

function twoFactorSetup() {
  showLoading('Preparing your code');
  api('/api/2fa/setup', {}).then(function (d) {
    hideLoading();
    modal('Set up two-step sign in',
      '<div class="qr-wrap">' +
      (d.qr_svg ? '<div class="qr-box">' + d.qr_svg + '</div>' : '') +
      '<div class="qr-side"><ol class="qr-steps">' +
      '<li>Install an authenticator app if you do not have one — Google ' +
      'Authenticator, Microsoft Authenticator and Authy all work.</li>' +
      '<li>Scan this square with it.</li>' +
      '<li>Type the six digits it shows below.</li></ol>' +
      '<span class="lbl">Cannot scan? Type this key into the app instead</span>' +
      '<div class="secret-line">' + esc(d.secret) + '</div></div></div>' +
      '<div class="field" style="margin-top:16px;max-width:230px">' +
      '<label class="lbl" for="tfCode">The six digits from the app</label>' +
      '<input class="inp" id="tfCode" inputmode="numeric" maxlength="6" ' +
      'placeholder="000000"></div>',
      '<button class="btn" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" id="tfGo">Turn it on</button>', true);
    $('tfCode').onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('tfGo').click(); }
    };
    $('tfGo').onclick = function () {
      if (!val('tfCode')) { toast('Enter the code from your app.', 'bad'); return; }
      this.disabled = true;
      api('/api/2fa/enable', { code: val('tfCode') }).then(function (r) {
        showRecoveryCodes(r.recovery_codes);
      }).catch(function (e) {
        toast(e.message, 'bad');
        $('tfGo').disabled = false;
        $('tfCode').value = '';
      });
    };
  }).catch(function (e) { hideLoading(); toast(e.message, 'bad'); });
}

function showRecoveryCodes(codes) {
  modal('Two-step sign in is on',
    '<p>Keep these somewhere safe and away from your phone. Each one signs you ' +
    'in <b>once</b> if you lose the app. Without them, only the account owner ' +
    'can let you back in.</p>' +
    '<div class="codes-grid">' + (codes || []).map(function (c) {
      return '<span>' + esc(c) + '</span>';
    }).join('') + '</div>' +
    '<p class="muted small">This is the only time they are shown.</p>',
    '<button class="btn left" id="rcCopy">Copy them</button>' +
    '<button class="btn" onclick="window.print()">Print</button>' +
    '<button class="btn btn-primary" id="rcDone">I have saved them</button>');
  $('rcCopy').onclick = function () {
    navigator.clipboard.writeText((codes || []).join('\n')).then(function () {
      toast('Copied.', 'ok');
    }).catch(function () { toast('Select and copy them by hand.', 'bad'); });
  };
  $('rcDone').onclick = function () {
    closeModal();
    ME.totp_enabled = true;
    renderTwoFactor();
    toast('Two-step sign in is on.', 'ok');
  };
}

function twoFactorOff() {
  modal('Turn off two-step sign in',
    '<p class="muted small">Your password and a current code, so nobody can ' +
    'switch this off on a screen you left unlocked.</p>' +
    '<div class="field"><label class="lbl" for="tfPw">Your password</label>' +
    '<input class="inp" id="tfPw" type="password" autocomplete="current-password"></div>' +
    '<div class="field" style="max-width:230px"><label class="lbl" for="tfOffCode">' +
    'Code from your app, or a recovery code</label>' +
    '<input class="inp" id="tfOffCode" maxlength="9" placeholder="000000"></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-danger" id="tfOffGo">Turn it off</button>');
  $('tfOffGo').onclick = function () {
    this.disabled = true;
    api('/api/2fa/disable', { password: $('tfPw').value, code: val('tfOffCode') })
      .then(function () {
        closeModal();
        ME.totp_enabled = false;
        renderTwoFactor();
        toast('Two-step sign in is off.');
      })
      .catch(function (e) { toast(e.message, 'bad'); $('tfOffGo').disabled = false; });
  };
}

function openPasswordModal(forced) {
  modal(forced ? 'Set your own password' : 'Change password',
    (forced ? '<p class="muted small">You are signed in with a temporary password. ' +
      'Choose your own before you continue.</p>' : '') +
    '<div class="field"><label class="lbl" for="pwOld">Current password</label>' +
    '<input class="inp" id="pwOld" type="password" autocomplete="current-password"></div>' +
    '<div class="field"><label class="lbl" for="pwNew">New password</label>' +
    '<input class="inp" id="pwNew" type="password" autocomplete="new-password">' +
    '<div class="hint">At least 10 characters, mixing letters with numbers or symbols.</div></div>' +
    '<div class="field"><label class="lbl" for="pwNew2">Repeat new password</label>' +
    '<input class="inp" id="pwNew2" type="password" autocomplete="new-password"></div>',
    (forced ? '' : '<button class="btn" onclick="closeModal()">Cancel</button>') +
    '<button class="btn btn-primary" id="pwGo">Save password</button>');
  $('pwGo').onclick = function () {
    if ($('pwNew').value !== $('pwNew2').value) {
      toast('The two new passwords do not match.', 'bad'); return;
    }
    this.disabled = true;
    api('/api/change-password', {
      current_password: $('pwOld').value, new_password: $('pwNew').value
    }).then(function () {
      closeModal(); ME.must_change = false; toast('Password changed.', 'ok');
    }).catch(function (e) { toast(e.message, 'bad'); $('pwGo').disabled = false; });
  };
}
