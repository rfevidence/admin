/* Loads the real index.html + app.js in jsdom, signs in, and walks every page
   and every dialog against a live server. Any thrown error or "Could not load"
   surfaces as a failure. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = process.argv[2] || 'http://localhost:8500';
const DIR = path.join(__dirname, 'static');
let PASS = 0, FAIL = 0;
const errors = [];

function ok(label, cond, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + label); }
  else { FAIL++; console.log('  FAIL  ' + label + (detail ? '   <-- ' + String(detail).slice(0, 200) : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function () {
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(DIR, 'app.css'), 'utf8');
  const js = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');

  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const dom = new JSDOM(html.replace('<script src="/app.js"></script>', ''), {
    url: BASE + '/', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc
  });
  const w = dom.window;

  // storage + clipboard + print shims
  const store = {};
  w.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  Object.defineProperty(w, 'localStorage', { value: w.localStorage, configurable: true });
  w.navigator.clipboard = { writeText: () => Promise.resolve() };
  const tok = () => (store.mac_token || w.localStorage.getItem('mac_token') || '');
  w.print = () => {};

  // real fetch against the live server
  w.fetch = (url, opt) => {
    const full = url.startsWith('http') ? url : BASE + url;
    return fetch(full, opt);
  };

  // count uncaught errors from event handlers
  w.addEventListener('error', e => errors.push('window error: ' + e.message));
  w.addEventListener('unhandledrejection', e => errors.push('unhandled: ' + (e.reason && e.reason.message)));

  // ---- check every element id app.js reaches for actually exists somewhere
  const shellIds = new Set(
    [...html.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map(m => m[1]));
  const bootIds = ['signin', 'app', 'loginForm', 'loginBtn', 'loginMsg', 'email',
    'password', 'nav', 'view', 'pageTitle', 'avatar', 'whoName', 'whoRole',
    'verLabel', 'sidebar', 'backdrop', 'burger', 'modalRoot', 'modalTitle',
    'modalBody', 'modalFoot', 'modalX', 'modalBack', 'toasts', 'globalSearch',
    'searchResults', 'signinVer'];
  const missing = bootIds.filter(id => !shellIds.has(id));
  ok('every element the script needs at boot is in the page', missing.length === 0, missing);

  // stylesheet sanity: no CSS variable is used without being defined
  const defined = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map(m => m[1]));
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(m => m[1]));
  const undef = [...used].filter(v => !defined.has(v));
  ok('every colour and size token used in the stylesheet is defined', undef.length === 0, undef);

  // ---- run the app exactly as the browser would: a real <script> element,
  // so top-level functions become globals and inline onclick handlers resolve.
  const tag = w.document.createElement('script');
  tag.textContent = js;
  w.document.body.appendChild(tag);
  await sleep(500);
  ok('the script loads at global scope, so inline handlers work',
    typeof w.closeModal === 'function' && typeof w.openEnquiry === 'function',
    typeof w.closeModal);

  console.log('\n[ SIGN IN ]');
  ok('the sign-in panel is shown first',
    w.document.getElementById('signin').style.display !== 'none' &&
    w.document.getElementById('app').hidden === true);

  // wrong password first
  w.document.getElementById('email').value = 'admin@maclesotho.com';
  w.document.getElementById('password').value = 'nope';
  w.document.getElementById('loginForm').dispatchEvent(new w.Event('submit'));
  await sleep(1400);
  ok('a bad password shows a message and stays on the sign-in page',
    !w.document.getElementById('loginMsg').hidden &&
    w.document.getElementById('app').hidden === true,
    w.document.getElementById('loginMsg').textContent);

  w.document.getElementById('email').value = 'admin@maclesotho.com';
  w.document.getElementById('password').value = process.env.ADMIN_PASSWORD || 'TestOnly#2026';
  w.document.getElementById('loginForm').dispatchEvent(new w.Event('submit'));
  await sleep(1600);
  ok('signing in opens the portal', w.document.getElementById('app').hidden === false,
    w.document.getElementById('loginMsg').textContent);
  ok('the sidebar is built', w.document.querySelectorAll('#nav a').length >= 13,
    w.document.querySelectorAll('#nav a').length);
  ok('the signed-in name is shown',
    w.document.getElementById('whoName').textContent.length > 3);

  console.log('\n[ EVERY PAGE RENDERS ]');
  const pages = [
    ['dashboard', 'Dashboard'], ['enquiries', 'Enquiries'], ['tasks', 'Tasks'],
    ['calendar', 'Consultations'], ['clients', 'Clients'], ['cases', 'Cases'],
    ['expiries', 'Renewals'], ['payments', 'Payments'], ['reports', 'Reports'],
    ['users', 'Staff'], ['settings', 'Settings'], ['system', 'System'],
    ['audit', 'Activity log'], ['profile', 'My profile']
  ];
  for (const [key] of pages) {
    errors.length = 0;
    w.location.hash = '#/' + key;
    w.dispatchEvent(new w.Event('hashchange'));
    await sleep(900);
    const body = w.document.getElementById('view').textContent;
    const bad = body.indexOf('Request failed') >= 0 || body.indexOf('undefined') >= 0 ||
      body.trim() === '' || body.indexOf('Loading…') === 0;
    ok(key + ' renders', !bad && errors.length === 0,
      errors[0] || body.slice(0, 110));
  }

  console.log('\n[ DETAIL PAGES ]');
  const r = await (await fetch(BASE + '/api/clients', {
    headers: { Authorization: 'Bearer ' + tok() }
  })).json();
  const clientId = r.clients[0] && r.clients[0].id;
  const rc = await (await fetch(BASE + '/api/cases', {
    headers: { Authorization: 'Bearer ' + tok() }
  })).json();
  const caseId = rc.cases[0] && rc.cases[0].id;

  for (const [label, hash] of [['a client file', '#/client/' + clientId],
                               ['a case file', '#/case/' + caseId]]) {
    errors.length = 0;
    w.location.hash = hash;
    w.dispatchEvent(new w.Event('hashchange'));
    await sleep(1000);
    const body = w.document.getElementById('view').textContent;
    ok(label + ' renders', body.length > 200 && errors.length === 0,
      errors[0] || body.slice(0, 110));
  }

  // the case page has the parts that matter
  const caseHtml = w.document.getElementById('view').innerHTML;
  ok('the case page draws the stage rail', caseHtml.indexOf('rail-step') > 0);
  ok('the case page shows the document checklist', caseHtml.indexOf('data-doc=') > 0);
  ok('the case page shows the fee balance', caseHtml.indexOf('Balance') > 0);

  console.log('\n[ DIALOGS OPEN WITH THEIR FIELDS ]');
  const dialogs = [
    ['Move stage', 'kMove', ['stStage', 'stNote']],
    ['Edit case', 'kEdit', ['keService', 'keFee', 'keAuth']],
    ['Log activity', 'kNote', ['evKind', 'evBody']],
    ['Record payment', 'kPay', ['pAmount', 'pKind', 'pDate']],
    ['Add task', 'kTask', ['tTitle', 'tDue', 'tWho']],
    ['Add a document', 'dAdd', ['dName', 'dExpiry', 'dStatus']]
  ];
  for (const [label, btnId, fields] of dialogs) {
    errors.length = 0;
    const btn = w.document.getElementById(btnId);
    if (!btn) { ok(label + ' button is on the case page', false, 'no #' + btnId); continue; }
    btn.click();
    await sleep(350);
    const have = fields.filter(f => w.document.getElementById(f));
    ok(label + ' opens with its fields', have.length === fields.length && errors.length === 0,
      errors[0] || ('missing ' + fields.filter(f => !w.document.getElementById(f))));
    w.closeModal();
    await sleep(120);
  }

  console.log('\n[ FORMS ACTUALLY SAVE ]');
  // add a client through the dialog
  w.location.hash = '#/clients';
  w.dispatchEvent(new w.Event('hashchange'));
  await sleep(800);
  w.document.getElementById('clAdd').click();
  await sleep(300);
  ok('the add-client dialog opens', !!w.document.getElementById('cfFirst'));
  w.document.getElementById('cfFirst').value = 'Jsdom';
  w.document.getElementById('cfLast').value = 'Tester';
  w.document.getElementById('cfNat').value = 'Nigerian';
  w.document.getElementById('cfPassExp').value = '2026-10-05';
  w.document.getElementById('cfSave').click();
  await sleep(1300);
  const check = await (await fetch(BASE + '/api/clients?q=jsdom', {
    headers: { Authorization: 'Bearer ' + tok() }
  })).json();
  ok('a client created through the dialog is saved', check.clients.length === 1, check);
  ok('the portal navigated to the new client file',
    w.location.hash.indexOf('#/client/') === 0, w.location.hash);

  // move a case stage through the dialog
  w.location.hash = '#/case/' + caseId;
  w.dispatchEvent(new w.Event('hashchange'));
  await sleep(900);
  w.document.getElementById('kMove').click();
  await sleep(300);
  w.document.getElementById('stStage').value = 'Decision pending';
  w.document.getElementById('stNote').value = 'Waiting on the ministry.';
  w.document.getElementById('stGo').click();
  await sleep(1300);
  const kc = await (await fetch(BASE + '/api/cases/' + caseId, {
    headers: { Authorization: 'Bearer ' + tok() }
  })).json();
  ok('moving the stage from the dialog is saved',
    kc.case.stage === 'Decision pending', kc.case.stage);
  ok('the note went onto the timeline',
    kc.events.some(e => e.body.indexOf('ministry') >= 0), kc.events[0]);

  console.log('\n[ SEARCH AND SIGN OUT ]');
  const box = w.document.getElementById('globalSearch');
  box.value = 'tester';
  box.dispatchEvent(new w.Event('input'));
  await sleep(1200);
  ok('the search box returns results',
    w.document.getElementById('searchResults').hidden === false &&
    w.document.getElementById('searchResults').innerHTML.indexOf('Tester') > 0,
    w.document.getElementById('searchResults').innerHTML.slice(0, 120));

  w.signOut();
  await sleep(700);
  ok('signing out returns to the sign-in page',
    w.document.getElementById('app').hidden === true && !tok());

  console.log('\nPASS ' + PASS + '  FAIL ' + FAIL);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('CRASHED: ' + e.stack); process.exit(1); });
