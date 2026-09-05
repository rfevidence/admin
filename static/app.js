/* MAC Admin Portal — front end */
'use strict';

var TOKEN = null, ME = null, BOOT = null;
var UNREAD = 0;
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
  return (cur || (BOOT && BOOT.org.currency) || 'LSL') + ' ' +
    v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
function toast(msg, kind) {
  var el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(function () { el.remove(); }, 4200);
}

/* ------------------------------------------------------------- api */
function api(path, body, method) {
  var opt = {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' }
  };
  if (TOKEN) opt.headers.Authorization = 'Bearer ' + TOKEN;
  if (body) opt.body = JSON.stringify(body);
  return fetch(path, opt).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (d) {
      if (r.status === 401 && TOKEN) { signOut(true); throw new Error(d.error || 'Session expired.'); }
      if (!r.ok) throw new Error(d.error || ('Request failed (' + r.status + ')'));
      return d;
    });
  });
}

/* ------------------------------------------------------------- sign in */
$('loginForm').addEventListener('submit', function (ev) {
  ev.preventDefault();
  var btn = $('loginBtn'), msg = $('loginMsg');
  msg.hidden = true;
  btn.disabled = true; btn.textContent = 'Signing in…';
  api('/api/login', { email: val('email'), password: $('password').value })
    .then(function (d) {
      TOKEN = d.token;
      try { localStorage.setItem('mac_token', TOKEN); } catch (e) { }
      $('password').value = '';
      return start();
    })
    .catch(function (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    })
    .then(function () { btn.disabled = false; btn.textContent = 'Sign in'; });
});

function signOut(silent) {
  var done = function () {
    TOKEN = null; ME = null;
    try { localStorage.removeItem('mac_token'); } catch (e) { }
    $('app').hidden = true;
    $('signin').style.display = '';
    if (!silent) toast('Signed out.');
  };
  if (TOKEN && !silent) { api('/api/logout', {}).catch(function () { }).then(done); }
  else done();
}

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
    ['expiries', '⏳', 'Renewals'],
    ['payments', '₤', 'Payments']
  ]],
  ['Office', [
    ['reports', '📄', 'Reports'],
    ['users', '👥', 'Staff'],
    ['settings', '⚙', 'Settings'],
    ['system', '🩺', 'System'],
    ['audit', '🕘', 'Activity log']
  ]]
];

function paintChrome() {
  $('avatar').textContent = initials(ME.name);
  $('whoName').textContent = ME.name;
  $('whoRole').textContent = ME.role === 'owner' ? 'Account owner'
    : ME.role === 'advisor' ? 'Advisor' : 'Administrator';
  $('verLabel').textContent = 'MAC Portal · ' + BOOT.version;
  var html = '';
  NAV.forEach(function (group) {
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
var ROUTES = {
  dashboard: viewDashboard, enquiries: viewEnquiries, clients: viewClients,
  cases: viewCases, payments: viewPayments, tasks: viewTasks,
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
  fn();
}
window.addEventListener('hashchange', router);

function refreshUnread() {
  api('/api/bootstrap').then(function (d) {
    UNREAD = d.unread; BOOT = d; paintChrome();
    setActive((location.hash || '#/dashboard').slice(2).split('/')[0], $('pageTitle').textContent);
  }).catch(function () { });
}

/* ------------------------------------------------------------- boot */
function start() {
  return api('/api/bootstrap').then(function (d) {
    BOOT = d; ME = d.user; UNREAD = d.unread;
    $('signin').style.display = 'none';
    $('app').hidden = false;
    paintChrome();
    if (!location.hash) location.hash = '#/dashboard';
    router();
    if (ME.must_change) openPasswordModal(true);
  });
}

if (TOKEN) {
  start().catch(function () { TOKEN = null; try { localStorage.removeItem('mac_token'); } catch (e) { } });
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
          '<td class="num"><span class="muted">Open ›</span></td></tr>';
      }).join('') + '</tbody></table></div>'
      : emptyBox('No enquiries in this view',
        'When a visitor submits the consultation form on the website, their details ' +
        'land here straight away.')) + '</div>';

    $('view').innerHTML = html;
    var btns = document.querySelectorAll('.tabs button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].onclick = function () { enqFilter.status = this.dataset.s; viewEnquiries(); };
    }
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
    '<select class="inp" id="cvService">' + opts(BOOT.services, e.service) + '</select></div>' +
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
    f('cfNat', 'Nationality', c.nationality) +
    f('cfRes', 'Country of residence', c.country_residence) +
    f('cfDob', 'Date of birth', c.date_of_birth, 'date') +
    '<div class="field"><label class="lbl" for="cfGender">Gender</label>' +
    '<select class="inp" id="cfGender">' + opts(['Female', 'Male', 'Other',
      'Prefer not to say'], c.gender, '—') + '</select></div>' +
    f('cfPass', 'Passport number', c.passport_no) +
    f('cfPassExp', 'Passport expires', c.passport_expiry, 'date') +
    '<div class="field"><label class="lbl" for="cfPermit">Current permit or visa</label>' +
    '<select class="inp" id="cfPermit">' + opts(BOOT.permit_statuses, c.permit_status, '—') +
    '</select></div>' +
    f('cfPermitExp', 'Permit or visa expires', c.permit_expiry, 'date') +
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
    date_of_birth: val('cfDob'), gender: val('cfGender'), passport_no: val('cfPass'),
    passport_expiry: val('cfPassExp'), permit_status: val('cfPermit'),
    permit_expiry: val('cfPermitExp'), years_in_lesotho: val('cfYears'),
    status: val('cfStatus'), address: val('cfAddr'), notes: val('cfNotes')
  };
}

function clientForm(existing) {
  modal(existing ? 'Edit ' + existing.first_name + ' ' + existing.last_name : 'Add a client',
    clientFields(existing),
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="cfSave">' +
    (existing ? 'Save changes' : 'Create client') + '</button>', true);
  $('cfSave').onclick = function () {
    var btn = this; btn.disabled = true;
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

    $('cEdit').onclick = function () { clientForm(c); };
    $('cNewCase').onclick = function () { caseForm(c); };
    $('cNote').onclick = function () { eventForm({ client_id: c.id }, function () { viewClient(id); }); };
    $('cPay').onclick = function () { paymentForm({ client_id: c.id, cases: d.cases }, function () { viewClient(id); }); };
    $('cAppt').onclick = function () { apptForm({ client_id: c.id, cases: d.cases }, function () { viewClient(id); }); };
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
      '</div><div class="tl-body">' + esc(e.body) + '</div></li>';
  }).join('') + '</ul>';
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
    '<select class="inp" id="kService">' + opts(BOOT.services) + '</select></div>' +
    '<div class="grid-2">' +
    '<div class="field"><label class="lbl" for="kDest">Destination country</label>' +
    '<input class="inp" id="kDest"></div>' +
    '<div class="field"><label class="lbl" for="kAdvisor">Advisor</label>' +
    '<select class="inp" id="kAdvisor">' + opts(BOOT.advisors.map(function (a) {
      return { value: a.id, label: a.name };
    }), ME.id) + '</select></div>' +
    '<div class="field"><label class="lbl" for="kFee">Agreed fee</label>' +
    '<input class="inp" id="kFee" type="number" step="0.01" min="0" value="0"></div>' +
    '<div class="field"><label class="lbl" for="kTarget">Target date</label>' +
    '<input class="inp" id="kTarget" type="date"></div>' +
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
      client_id: val('kClient'), service: val('kService'), destination: val('kDest'),
      advisor_id: val('kAdvisor'), fee_total: num('kFee'), target_date: val('kTarget'),
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
      '<span class="right"><button class="btn btn-sm" id="kPay">Record payment</button></span></h3>' +
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
    '<select class="inp" id="keService">' + opts(BOOT.services, k.service) + '</select></div>' +
    '<div class="grid-2">' +
    '<div class="field"><label class="lbl" for="keDest">Destination</label>' +
    '<input class="inp" id="keDest" value="' + esc(k.destination || '') + '"></div>' +
    '<div class="field"><label class="lbl" for="keAdvisor">Advisor</label>' +
    '<select class="inp" id="keAdvisor">' + opts(BOOT.advisors.map(function (a) {
      return { value: a.id, label: a.name };
    }), k.advisor_id) + '</select></div>' +
    '<div class="field"><label class="lbl" for="keFee">Agreed fee</label>' +
    '<input class="inp" id="keFee" type="number" step="0.01" value="' +
    (k.fee_total || 0) + '"></div>' +
    '<div class="field"><label class="lbl" for="kePriority">Priority</label>' +
    '<select class="inp" id="kePriority">' + opts(['low', 'normal', 'high', 'urgent'],
      k.priority) + '</select></div>' +
    '<div class="field"><label class="lbl" for="keTarget">Target date</label>' +
    '<input class="inp" id="keTarget" type="date" value="' + esc(k.target_date || '') + '"></div>' +
    '<div class="field"><label class="lbl" for="keAuth">Authority reference</label>' +
    '<input class="inp" id="keAuth" value="' + esc(k.authority_ref || '') + '"></div>' +
    '<div class="field"><label class="lbl" for="keSub">Submitted on</label>' +
    '<input class="inp" id="keSub" type="date" value="' + esc(k.submitted_at || '') + '"></div>' +
    '<div class="field"><label class="lbl" for="keDec">Decision on</label>' +
    '<input class="inp" id="keDec" type="date" value="' + esc(k.decision_at || '') + '"></div>' +
    '</div><div class="field"><label class="lbl" for="keNotes">Notes</label>' +
    '<textarea class="inp" id="keNotes">' + esc(k.notes || '') + '</textarea></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="keSave">Save changes</button>', true);
  $('keSave').onclick = function () {
    this.disabled = true;
    api('/api/cases/' + k.id, {
      service: val('keService'), destination: val('keDest'), advisor_id: val('keAdvisor'),
      fee_total: num('keFee'), priority: val('kePriority'), target_date: val('keTarget'),
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
    '<div class="field"><label class="lbl" for="dExpiry">Expires</label>' +
    '<input class="inp" id="dExpiry" type="date" value="' + esc(doc ? doc.expiry : '') + '"></div>' +
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
    '<div class="field"><label class="lbl" for="evFollow">Follow up on</label>' +
    '<input class="inp" id="evFollow" type="date"></div></div>' +
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
    '<div class="field"><label class="lbl" for="pDate">Received on</label>' +
    '<input class="inp" id="pDate" type="date" value="' + today() + '"></div>' +
    '<div class="field"><label class="lbl" for="pKind">What it is for</label>' +
    '<select class="inp" id="pKind">' + opts(BOOT.payment_kinds.map(function (k) {
      return { value: k.key, label: k.label };
    })) + '</select></div>' +
    '<div class="field"><label class="lbl" for="pCase">Case</label>' +
    '<select class="inp" id="pCase">' + opts(caseOpts, link.case_id, 'Not case specific') +
    '</select></div>' +
    '<div class="field"><label class="lbl" for="pMethod">Method</label>' +
    '<select class="inp" id="pMethod">' + opts(['Cash', 'M-Pesa', 'EcoCash',
      'Bank transfer', 'Card', 'Other'], 'Cash') + '</select></div>' +
    '<div class="field"><label class="lbl" for="pRef">Receipt number</label>' +
    '<input class="inp" id="pRef"></div></div>' +
    '<div class="field"><label class="lbl" for="pNote">Note</label>' +
    '<input class="inp" id="pNote"></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="pGo">Record payment</button>');
  $('pGo').onclick = function () {
    if (num('pAmount') <= 0) { toast('Enter an amount.', 'bad'); return; }
    this.disabled = true;
    api('/api/payments', {
      client_id: link.client_id, case_id: val('pCase') || null, amount: num('pAmount'),
      kind: val('pKind'), method: val('pMethod'), reference: val('pRef'),
      paid_on: val('pDate'), note: val('pNote')
    }).then(function () { closeModal(); toast('Payment recorded.', 'ok'); after(); })
      .catch(function (e) { toast(e.message, 'bad'); $('pGo').disabled = false; });
  };
}

function taskForm(link, after) {
  modal('Add a task',
    '<div class="field"><label class="lbl" for="tTitle">Task</label>' +
    '<input class="inp" id="tTitle" placeholder="Chase the police clearance"></div>' +
    '<div class="grid-3">' +
    '<div class="field"><label class="lbl" for="tDue">Due</label>' +
    '<input class="inp" id="tDue" type="date" value="' + plusDays(3) + '"></div>' +
    '<div class="field"><label class="lbl" for="tPri">Priority</label>' +
    '<select class="inp" id="tPri">' + opts(['low', 'normal', 'high', 'urgent'],
      'normal') + '</select></div>' +
    '<div class="field"><label class="lbl" for="tWho">Assign to</label>' +
    '<select class="inp" id="tWho">' + opts(BOOT.advisors.map(function (a) {
      return { value: a.id, label: a.name };
    }), ME.id) + '</select></div></div>' +
    '<div class="field"><label class="lbl" for="tDetail">Detail</label>' +
    '<textarea class="inp" id="tDetail"></textarea></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="tGo">Add task</button>');
  $('tGo').onclick = function () {
    if (!val('tTitle')) { toast('Give the task a name.', 'bad'); return; }
    this.disabled = true;
    api('/api/tasks', {
      title: val('tTitle'), detail: val('tDetail'), due_date: val('tDue'),
      priority: val('tPri'), assigned_to: val('tWho'),
      client_id: link.client_id, case_id: link.case_id
    }).then(function () { closeModal(); toast('Task added.', 'ok'); after(); })
      .catch(function (e) { toast(e.message, 'bad'); $('tGo').disabled = false; });
  };
}

function apptForm(link, after) {
  var caseOpts = (link.cases || []).map(function (k) {
    return { value: k.id, label: k.ref + ' — ' + shortService(k.service) };
  });
  modal('Book a consultation',
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
    '<div class="field"><label class="lbl" for="aWhere">Location</label>' +
    '<input class="inp" id="aWhere" value="' + esc(BOOT.org.org_address || '') + '"></div>' +
    '<div class="field"><label class="lbl" for="aNote">Note</label>' +
    '<input class="inp" id="aNote"></div>',
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="aGo">Book</button>');
  $('aGo').onclick = function () {
    if (!val('aWhen')) { toast('Pick a date and time.', 'bad'); return; }
    this.disabled = true;
    api('/api/appointments', {
      client_id: link.client_id, case_id: ($('aCase') ? val('aCase') : link.case_id) || null,
      title: val('aTitle'), starts_at: val('aWhen'), duration_min: num('aMins'),
      location: val('aWhere'), advisor_id: val('aWho'), note: val('aNote')
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
      '<a class="btn row-end" href="/export/payments?from=' + frm + '&to=' + to +
      '" id="pyCsv">Download CSV</a></div>';
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
          '<td>' + esc(p.reference || '—') + '</td>' +
          '<td class="num">' + money(p.amount, p.currency) + '</td>' +
          '<td class="num">' + (p.voided ? '<span class="badge bad">void</span>'
            : '<button class="btn btn-sm" data-void="' + p.id + '">Void</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      : emptyBox('No payments in this period', 'Change the dates, or record one from a client file.')) +
      '</div>';
    $('view').innerHTML = html;
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
            : '<span class="badge ok">done</span>') +
          ' <button class="btn btn-sm" data-tdel="' + t.id + '">✕</button></td></tr>';
      }).join('') + '</tbody></table></div>'
      : emptyBox('Nothing here', 'Tasks you create from a client or case file appear in this list.')) +
      '</div>';
    $('view').innerHTML = html;
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.onclick = function () { taskFilter = b.dataset.s; viewTasks(); };
    });
    $('tAdd').onclick = function () { taskForm({}, viewTasks); };
    document.querySelectorAll('[data-tdel]').forEach(function (b) {
      b.onclick = function () {
        api('/api/tasks/' + b.dataset.tdel, {}, 'DELETE').then(function () {
          toast('Task removed.'); viewTasks();
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
          return '<li><div class="doc-name"><b>' + esc(a.title) + '</b><span class="sub">' +
            String(a.starts_at).slice(11, 16) + ' · ' + a.duration_min + ' min · ' +
            (a.client_id ? '<a href="#/client/' + a.client_id + '">' +
              esc((a.first_name || '') + ' ' + (a.last_name || '')) + '</a>' : 'no client') +
            ' · ' + esc(a.advisor_name || '') + '</span></div>' +
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
          esc(u.role) + '</span></td>' +
          '<td>' + (u.last_login ? dtm(u.last_login) : '<span class="muted">never</span>') +
          '</td>' +
          '<td>' + (u.active ? '<span class="badge ok">active</span>'
            : '<span class="badge bad">disabled</span>') +
          (u.must_change ? ' <span class="badge warn">temp password</span>' : '') + '</td>' +
          '<td class="num">' + (ME.role === 'owner'
            ? '<button class="btn btn-sm" data-uedit="' + u.id + '">Edit</button> ' +
            '<button class="btn btn-sm" data-ureset="' + u.id + '">Reset password</button>'
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
      { value: 'advisor', label: 'Advisor — day to day casework' },
      { value: 'admin', label: 'Administrator — full casework access' },
      { value: 'owner', label: 'Owner — settings, staff and deletions' }
    ], u ? u.role : 'admin') + '</select></div>' +
    '<div class="field"><label class="lbl" for="uPhone">Phone</label>' +
    '<input class="inp" id="uPhone" value="' + esc(u ? u.phone : '') + '"></div></div>' +
    (u ? '<label class="small"><input type="checkbox" id="uActive"' +
      (u.active ? ' checked' : '') + '> Account is active</label>' : ''),
    '<button class="btn" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="uGo">' + (u ? 'Save' : 'Create account') +
    '</button>');
  $('uGo').onclick = function () {
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
          expiry_warn_days: val('sWarn'), allowed_origins: val('sOrigins')
        }).then(function () {
          toast('Settings saved.', 'ok'); refreshUnread(); viewSettings();
        }).catch(function (e) { toast(e.message, 'bad'); $('sSave').disabled = false; });
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
    '<button class="btn" id="prPw">Change password</button></div></div>';
  $('prSave').onclick = function () {
    api('/api/profile', { name: val('prName'), phone: val('prPhone') }).then(function () {
      ME.name = val('prName'); ME.phone = val('prPhone');
      paintChrome(); setActive('profile', 'My profile'); toast('Saved.', 'ok');
    }).catch(function (e) { toast(e.message, 'bad'); });
  };
  $('prPw').onclick = function () { openPasswordModal(false); };
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
