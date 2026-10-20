#!/usr/bin/env node
// Browser check: Spanish completeness of the field app (docs/schwab/tasks.html). Exit 0 = nothing untranslated.
//
// Run (needs Playwright and a Chromium; not part of `npm test`, which is node-only):
//   cd docs/schwab && python3 -m http.server 8765 --bind 127.0.0.1 &        # serve the app
//   BASE=http://127.0.0.1:8765/ node tests/browser/schwab-spanish-audit.e2e.js [--only=screen name] [--list] [--dump] [--hub]
//   (if Playwright is installed globally: NODE_PATH=$(npm root -g) ...)
//   --only runs the screens whose name contains the text; --list prints the screen names; --dump prints every string
//   with how it was accounted for (to check the audit itself). AUDIT_JSON=path moves the JSON copy of the results
//   (default: $TMPDIR/schwab-spanish-audit.json).
//   --hub adds the hub screens (Live, Records, joining, hub settings). They need a local hub dev server running
//   (node tests/browser/hub-dev-server.js 8780; HUBDEV, default http://127.0.0.1:8780/). Their phones use the address
//   https://script.google.com/macros/s/TESTHUB/exec, which the audit forwards to the local hub; a translation comes back
//   as the typed token with ZQtr in front (typed data, so it is accounted for like any typed text).
//
// Puts the app in Spanish mode, visits every screen and state as the right role, and collects every
// piece of text a person could see or hear: visible text nodes; the attributes aria-label, placeholder,
// title, alt and button values; option labels; dialog and sheet contents; toast texts. Each string is
// then accounted for or reported as UNTRANSLATED:
//   1. it matches a Spanish value in es.mjs (a regex per value, {name} turned into a wildcard; whatever the
//      wildcard captured is checked again, so English hidden inside a Spanish sentence is still found);
//   2. what is left is stripped of seeded typed data (any token containing the marker ZQ), the allowlist
//      below, URLs, Spanish dates and AM/PM; digits and punctuation carry no words;
//   3. if two or more letters in a row remain, the string is UNTRANSLATED.
// Typed data must therefore be seeded as single tokens that contain ZQ (ZQscope, not "ZQ scope").
//
// One function per screen, listed in SCREENS at the bottom: a later phase adds a screen by adding a function.
// Exit code: 0 clean, 1 untranslated text found, 2 a screen could not be visited (never reported as clean).
//
// Limits: native pickers (date, time, share and file dialogs) are browser UI, not page text, and are not
// read; text the app writes into form fields (the Fill button's "2/3 steps") is a field value, not
// screen text; PDFs, CSV and the message bodies sent to the office are English by design and not audited
// (message previews are listed separately); the no-JavaScript fallback links in index.html and
// report.html, and the "app didn't finish loading" notice, are never on screen in a working browser.

'use strict';
const { chromium, devices } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.env.BASE || 'http://127.0.0.1:8765/').replace(/\/*$/, '/');
const HUBDEV = (process.env.HUBDEV || 'http://127.0.0.1:8780/').replace(/\/*$/, '/');
const HUBURL = 'https://script.google.com/macros/s/TESTHUB/exec';
let HUBKEYS = null; // from the local hub at the start of the run
const ARG = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const ONLY = ARG('only').toLowerCase();
const HUB = process.argv.includes('--hub');
const OUT_JSON = process.env.AUDIT_JSON || path.join(os.tmpdir(), 'schwab-spanish-audit.json');

// ---------------------------------------------------------------------------------------------
// What counts as accounted for besides es.mjs. Every entry says why it is allowed.
// ---------------------------------------------------------------------------------------------
const ALLOW = [
  'H.A. Sack-Electrical', 'Sack Company-Electrical', // company names: proper nouns, same in every language
  'Charles Schwab Building', 'Charlotte, NC', // project and site from the default settings data
  /Level [1-5]/, 'Basement', 'Roof', // default floors from the default settings data (people rename them)
  /Crew [A-F]/, // default crew names from the default settings data
  'Supports / strapping', 'Labeling', 'Terminations / torque', 'Testing', 'Covers / plates', 'Cleanup', // default finish checks, settings data
  'English', 'Español', 'ES', 'EN', // language names and buttons are shown in their own language on purpose
  'Language · Idioma', // the first-open chooser is bilingual on purpose: no language is chosen yet
  'Close · Cerrar', // the same chooser's close button label, bilingual for the same reason
  'Mike R, Jose L, Tre W', // example names in a placeholder; names need no translation
];

// By design the text messages to the office are English (README): snapshots of their previews pass { office: true }; they are listed, not counted.

// ---------------------------------------------------------------------------------------------
// Fixtures: fictional data, every typed value is a single token containing the marker ZQ.
// ---------------------------------------------------------------------------------------------
const NOW = '2026-10-14T10:00:00Z'; // a Wednesday; the week runs Mon Oct 12 to Sun Oct 18
const TODAY = '2026-10-14', YEST = '2026-10-13', TOMO = '2026-10-15', LASTWK = '2026-10-07', NEXTWK = '2026-10-21';
const TS = Date.parse('2026-10-14T09:30:00Z');
const PIN = '1234', SALT = '0123456789abcdef';
const PIN_HASH = `${SALT}:${crypto.createHash('sha256').update(`${SALT}:${PIN}`).digest('hex')}`;
const FLOORS = ['Basement', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Roof'];
const CHECKS = ['Supports / strapping', 'Labeling', 'Terminations / torque', 'Testing', 'Covers / plates', 'Cleanup'];

const CREWS = ['A', 'B', 'C', 'D'].map(x => ({ name: 'Crew ' + x, lead: 'ZQLead' + x, members: `ZQJose${x}, ZQLuis${x}` }));
const settings = (o = {}) => ({
  lang: 'es', me: 'ZQDana', role: 'Superintendent', super: 'ZQDana', pm: 'ZQPat', pin: PIN_HASH,
  project: 'Charles Schwab Building', site: 'Charlotte, NC', floors: FLOORS, checks: CHECKS,
  crews: CREWS,
  folderUrl: '', siteCode: '', worker: '', device: 'zqdev', ...o,
});
// Roles: who the phone belongs to and whether the office passcode is open on it.
const ROLES = {
  crew: { s: { me: '', super: '', pm: '' }, in: false }, // a crew phone: sheets sent to it, signed out
  super: { s: {}, in: true },
  pm: { s: { me: 'ZQPat', role: 'Project manager' }, in: true },
  worker: { s: { me: '', super: '', pm: '', worker: 'ZQJose' }, in: false }, // a laborer's own phone
  member: { s: { me: '', super: '', pm: '', worker: 'ZQJose', role: 'Crew member' }, in: false }, // a phone the first run set up for a crew member
};

const items = xs => xs.map(([text, done], i) => ({ id: 'zi' + i, text, done: !!done, at: done ? TS : 0 }));
let seq = 0;
const task = (o = {}) => {
  const n = ++seq;
  return {
    uid: 'zqt' + n, origin: 'mine', from: '', id: 'T1014-0' + n, date: TODAY, by: 'ZQDana', floor: 'Level 3', area: 'ZQeastcorridor', crew: 'Crew A', lead: 'ZQLeadA',
    members: ['ZQJoseA', 'ZQLuisA'], size: 2, scope: 'ZQpull12AWG', refs: 'ZQE301', items: items([['ZQsetboxes', 1], ['ZQpullwire', 0], ['ZQterminate', 0]]),
    checks: items([['Labeling', 1], ['Testing', 0]]), allot: 8, allotNote: 'ZQallot', est: 7.5, estNote: 'ZQest', pStart: '07:00', pStop: '15:30', checkIn: '06:45',
    aStart: '07:05', aStop: '14:00', delay: 30, status: 'Partial', doneText: 'ZQdone', remain: 'ZQremain', comments: 'ZQcomments', cLang: 'es', review: '', reviewer: '', followUp: '',
    sentAt: TS, resultAt: TS, gotAt: TS, updatedAt: TS, filedAt: TS, ...o,
  };
};
// One sheet in each stage the board can show, so every pill, group and summary appears.
const boardTasks = (origin = 'mine') => [
  task({ origin, id: 'T1014-01', status: 'Partial' }),
  task({ origin, id: 'T1014-02', crew: 'Crew B', floor: 'Level 4', status: 'Complete', est: 6, aStart: '07:00', aStop: '13:00', delay: 0 }),
  task({ origin, id: 'T1014-03', crew: 'Crew C', floor: 'Level 1', status: 'Blocked', comments: 'ZQblocked', size: 1, members: ['ZQJoseC'] }),
  task({ origin, id: 'T1014-04', crew: 'Crew D', floor: 'Basement', status: '', aStart: '', aStop: '', delay: 0, resultAt: 0, gotAt: 0 }), // sent, not started
  task({ origin, id: 'T1014-05', crew: 'Crew A', floor: 'Level 2', status: '', aStop: '', delay: 0, resultAt: 0, gotAt: 0 }), // working
  task({ origin, id: 'T1014-06', crew: '', floor: '', area: '', size: 0, members: [], status: '', aStart: '', aStop: '', delay: 0, sentAt: 0, resultAt: 0, gotAt: 0, est: 0, pStart: '', pStop: '' }), // draft, no crew or floor
  task({ origin, id: 'T1014-07', crew: 'Crew B', floor: 'Level 5', status: 'Complete', review: 'Accepted', reviewer: 'ZQDana' }), // folded away under Accepted
  task({ origin, id: 'T1014-08', crew: 'Crew C', floor: 'Level 5', status: 'Partial', review: 'Follow-up needed', reviewer: 'ZQDana', followUp: 'ZQfollowup' }),
  task({ origin, id: '', uid: 'zqnoid', crew: 'Crew D', floor: 'Level 2', status: '', aStart: '', aStop: '', delay: 0, sentAt: 0, resultAt: 0, gotAt: 0 }), // no id yet: "New task"
];
const yesterdayOpen = () => [task({ id: 'T1013-01', date: YEST, status: 'Partial', remain: 'ZQleft' }), task({ id: 'T1013-02', date: YEST, crew: 'Crew B', status: 'Complete' })];

const CREWREP = (o = {}) => ({ name: 'Crew A', na: false, lead: 'ZQLeadA', workers: 3, labor: 0, laborFromTasks: false, members: 'ZQJoseA,ZQLuisA', area: 'ZQarea', ref: 'ZQref', start: '07:00', stop: '15:00', done: 'ZQdone', quality: 'ZQquality', holdups: 'ZQholdups', good: 'ZQgood', ...o });
// Every list populated; the forecast shows late (days, one day, hours), on track (days, hours) and no dates.
const report = (o = {}) => ({
  date: TODAY, super: 'ZQDana', shiftStart: '06:30', shiftEnd: '15:30', submittedAt: TS, status: 'At risk',
  results: 'ZQresults', wins: 'ZQwins', issues: 'ZQissues', notified: 'ZQnotified',
  needs: [{ item: 'ZQemt', qty: 'ZQ40', where: 'Level 3', confirmed: false, by: '2026-10-15T08:00' }, { item: 'ZQlift', qty: 'ZQ1', where: 'Roof', confirmed: true, by: '' }],
  decisions: [{ q: 'ZQquestion1', rec: 'ZQrec', by: '2026-10-13T08:00', pm: '', pmNote: '' }, // waiting and past due
    { q: 'ZQquestion2', rec: 'ZQrec', by: '2026-10-16T08:00', pm: 'Approved', pmNote: 'ZQok' }, { q: 'ZQquestion3', rec: '', by: '', pm: 'Declined', pmNote: '' },
    { q: 'ZQquestion4', rec: '', by: '', pm: 'Discuss', pmNote: '' }],
  floors: [{ floor: 'Level 3', crews: [CREWREP({ name: 'Crew A', laborFromTasks: true, labor: 12 }), CREWREP({ name: 'Crew B' }), CREWREP({ name: 'Crew C', na: true }), CREWREP({ name: 'Crew D', done: '', start: '', stop: '', workers: 0 })] },
    { floor: 'Roof', crews: [CREWREP({ name: 'Crew A', start: '', stop: '' }), CREWREP({ name: 'ZQcrewname', labor: 4 })] }],
  next: [
    { step: 'ZQstep1', prereq: 'ZQpre', start: '2026-10-15T07:00', dur: 'ZQ2days', finish: '2026-10-19T08:00', deadline: '2026-10-17T08:00', lead: 'ZQlead', checkin: '2026-10-15T07:00' }, // late, 2 days
    { step: 'ZQstep2', prereq: '', start: '', dur: '', finish: '2026-10-16T08:00', deadline: '2026-10-15T08:00', lead: '', checkin: '' }, // late, exactly 1 day
    { step: 'ZQstep3', prereq: '', start: '', dur: '', finish: '2026-10-15T13:00', deadline: '2026-10-15T08:00', lead: '', checkin: '' }, // late, 5 hours
    { step: 'ZQstep4', prereq: '', start: '', dur: '', finish: '2026-10-15T08:00', deadline: '2026-10-18T08:00', lead: '', checkin: '' }, // on track, 3 days
    { step: 'ZQstep5', prereq: '', start: '', dur: '', finish: '2026-10-15T08:00', deadline: '2026-10-15T14:00', lead: '', checkin: '' }, // on track, 6 hours
    { step: 'ZQstep6', prereq: '', start: '', dur: '', finish: '', deadline: '', lead: '', checkin: '' }, // no dates
  ],
  risks: [{ risk: 'ZQrisk1', impact: 'ZQimpact', prevent: 'ZQprevent', fallback: 'ZQfallback', owner: 'ZQowner', by: '2026-10-15T08:00' }, { risk: 'ZQrisk2', impact: '', prevent: '', fallback: '', owner: '', by: '' }],
  preparedBy: 'ZQDana', pmReview: 'ZQpmnote', updatedAt: TS, filedAt: TS, ...o,
});

const shift = (o = {}) => ({ id: 'zs' + ++seq, device: 'zqdev', who: 'ZQJose', date: TODAY, in: '06:58', out: '15:31', edited: { who: false, in: false, out: false }, gone: false, at: TS, ...o });
// The PM's timesheet: several people, edited and open shifts, a removed shift, one with no name.
const crewShifts = () => [
  shift({ id: 'zsana1', who: 'ZQAna', date: YEST, in: '07:00', out: '' }), // open
  shift({ who: 'ZQAna', date: TODAY, in: '07:05', out: '15:30', edited: { who: false, in: false, out: true } }), // edited
  shift({ who: 'ZQJose', date: TODAY, device: 'zqdev2' }), shift({ who: 'ZQJose', date: TOMO, in: '07:00', out: '15:00', device: 'zqdev2' }),
  shift({ who: 'ZQRay', date: TODAY, in: '07:00', out: '15:00', device: '', edited: { who: true, in: true, out: true } }), // added by hand
  shift({ who: 'ZQLuis', date: TODAY, in: '22:00', out: '06:00', device: 'zqdev3' }), // overnight
  shift({ id: 'zsnameless', who: '', date: TODAY, in: '08:00', out: '', device: 'zqdev4' }), // no name, open
  shift({ who: 'ZQGone', date: TODAY, gone: true }),
];
const closedShifts = () => crewShifts().filter(s => s.out && !s.gone);

// ---------------------------------------------------------------------------------------------
// Page side: collect everything a person could see or hear. Serialized into the page, so it is self-contained.
// ---------------------------------------------------------------------------------------------
function COLLECT(scopeSel) {
  const root = scopeSel ? document.querySelector(scopeSel) : document.body;
  const out = [];
  if (!root) return out;
  const clean = s => s.replace(/\s+/g, ' ').trim();
  const add = (kind, text) => { text = kind === 'message' ? (text || '').trim() : clean(text || ''); if (text) out.push({ kind, text }); }; // a message keeps its line breaks: they separate the languages
  // Closed <details> show only their summary; a dialog that isn't open shows nothing.
  const shut = el => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      if (e.tagName === 'DETAILS' && !e.open) { const sum = [...e.children].find(c => c.tagName === 'SUMMARY'); if (!(sum && sum.contains(el))) return true; }
      if (e.tagName === 'DIALOG' && !e.open) return true;
    }
    return false;
  };
  const shown = el => !shut(el) && el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
  const silent = el => !!el.closest('[aria-hidden="true"]'); // seen but not read out: text counts, attributes don't
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'TITLE', 'DATALIST']);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    const p = n.parentElement;
    if (!p || SKIP.has(p.tagName) || p.closest('#toast, datalist, textarea') || !shown(p)) continue; // toasts come from the observer
    add(p.closest('.preview') ? 'message' : 'text', n.nodeValue);
  }
  const ATTRS = ['aria-label', 'placeholder', 'title', 'alt', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'aria-placeholder'];
  for (const el of root.querySelectorAll('*')) {
    if (el.closest('#toast, datalist') || !shown(el) || silent(el)) continue;
    for (const a of ATTRS) if (el.hasAttribute(a)) add(a, el.getAttribute(a));
    if (el.matches('input[type=button],input[type=submit],input[type=reset],button[value]')) add('value', el.getAttribute('value'));
    if (el.tagName === 'SELECT') for (const o of el.options) add('option', o.label);
  }
  if (!scopeSel) add('document-title', document.title);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Node side: decide whether a string is accounted for.
// ---------------------------------------------------------------------------------------------
const SENT = '\u0000'; // a Spanish phrase already accounted for (a placeholder may hold it)
const GAP = '\u0001'; // typed data, allowlist, dates: also fine inside a placeholder
const norm = s => String(s).normalize('NFC').replace(/[    ]/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const esc = s => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
const WORD = String.raw`[\p{L}\p{N}]`;

let PATTERNS = [], ALLOW_RE, DATE_RE;
function build(ES) {
  PATTERNS = Object.entries(ES).map(([en, es], id) => {
    const parts = norm(es).split(/\{\w+\}/), n = parts.length - 1;
    let src = '';
    parts.forEach((lit, i) => {
      let pre = '', post = '';
      // A placeholder at the very start or end may be empty, and then the text loses the space next to it.
      if (i === 1 && parts[0] === '' && lit.startsWith(' ')) { lit = lit.slice(1); pre = `(?:\\s+|(?<!${WORD}))`; }
      if (i === n - 1 && n >= 1 && parts[n] === '' && lit.endsWith(' ')) { lit = lit.slice(0, -1); post = `(?:\\s+|(?!${WORD}))`; }
      src += pre + esc(lit) + post;
      if (i < n) src += i === n - 1 && parts[n] === '' ? '([\\s\\S]*)' : '([\\s\\S]*?)'; // a trailing placeholder takes the rest; any may be empty
    });
    if (/^[\p{L}\p{N}]/u.test(parts[0])) src = `(?<!${WORD})` + src;
    if (/[\p{L}\p{N}]$/u.test(parts[n])) src += `(?!${WORD})`;
    return { id, en, n, es: norm(es), lit: parts.join('').length, re: new RegExp(src, 'gu') };
  }).sort((a, b) => b.lit - a.lit); // most specific first; a phrase already matched can sit inside a later placeholder
  const allow = ALLOW.map(a => (a instanceof RegExp ? a.source : esc(norm(a)))).sort((a, b) => b.length - a.length);
  ALLOW_RE = new RegExp(`(?<!${WORD})(?:${allow.join('|')})(?!${WORD})`, 'gu');
  // Spanish dates exactly as the phone prints them ("mié, 14 de oct"), from the same ICU the browser uses.
  const names = new Set();
  for (let i = 0; i < 7; i++) for (const weekday of ['short', 'long']) names.add(new Date(Date.UTC(2026, 9, 11 + i, 12)).toLocaleDateString('es-US', { timeZone: 'UTC', weekday }));
  for (let i = 0; i < 12; i++) for (const month of ['short', 'long']) for (const l of ['es-US', 'es']) names.add(new Date(Date.UTC(2026, i, 5, 12)).toLocaleDateString(l, { timeZone: 'UTC', month }).replace(/\.$/, ''));
  const alt = [...names].map(x => esc(norm(x.toLowerCase()))).sort((a, b) => b.length - a.length).join('|');
  DATE_RE = new RegExp(`(?<!${WORD})(?:\\d{1,2} de )?(?:${alt})\\.?(?!${WORD})`, 'giu');
}
const AMPM_RE = /(?<=\d)\s*(?:[ap]\.\s?m\.?|[ap]m)(?![\p{L}])/giu; // only right after a time
const URL_RE = /[^\s\u0000\u0001]*:\/\/[^\s\u0000\u0001]*/g;
const ZQ_RE = /[^\s\u0000\u0001]*ZQ[^\s\u0000\u0001]*/g;

// Returns the words that no rule accounts for. `via` collects which rules did the accounting.
function strip(s, via) {
  const bad = [];
  s = s.replace(ALLOW_RE, () => { via.add('allow'); return GAP; }); // first: the bilingual chooser heading holds a Spanish word of its own
  for (const p of PATTERNS) {
    s = s.replace(p.re, (...m) => {
      via.add('es');
      for (const cap of m.slice(1, 1 + p.n)) bad.push(...strip(cap, via)); // what the wildcard took must be fine too
      return SENT;
    });
  }
  s = s.replace(ZQ_RE, () => { via.add('typed'); return GAP; });
  s = s.replace(URL_RE, GAP).replace(DATE_RE, GAP).replace(AMPM_RE, GAP);
  for (const m of s.matchAll(/\p{L}{2,}/gu)) bad.push(m[0]);
  return bad;
}
const cache = new Map();
function analyse(text) {
  if (!cache.has(text)) { const via = new Set(), bad = strip(norm(text), via); cache.set(text, { bad, via }); }
  return cache.get(text);
}

// The matcher checks itself on a made-up phrase book before every run: if it ever passes English or flags Spanish, the run stops.
function selfTest() {
  build({ 'Cancel': 'Cancelar', 'Task {id}': 'Tarea {id}', '{n} people': '{n} personas', 'Review folder said: {error}': 'La carpeta respondió: {error}', 'Language': 'Idioma', '{n} hrs': '{n} h' });
  const ok = ['Cancelar', 'Tarea', 'Tarea T1014-01', 'Idioma', 'ZQa personas', '3 personas', '4 personas · Cancelar', 'La carpeta respondió: ZQerr', 'La carpeta respondió: Tarea T1', 'ZQjose', 'mié, 14 de oct', '9:30 a. m.', '6:58 AM', 'Crew A', 'H.A. Sack-Electrical', 'Language · Idioma', '12.5 h', '✕', 'https://x.example/exec'];
  const bad = { 'Cancel': 'Cancel', 'Tarea T1 Open': 'Open', 'La carpeta respondió: Wrong site code': 'Wrong', 'Wed, Oct 14': 'Wed', '8.55 hrs': 'hrs', 'ZQjose clocked in': 'clocked', 'Cancelar all': 'all', 'Hola': 'Hola' };
  const fails = [...ok.filter(t => analyse(t).bad.length).map(t => `should pass: ${t}`), ...Object.entries(bad).filter(([t, w]) => !analyse(t).bad.includes(w)).map(([t, w]) => `should flag "${w}" in: ${t}`)];
  if (fails.length) { console.error('AUDIT SELF-TEST FAILED\n  ' + fails.join('\n  ')); process.exit(2); }
  cache.clear();
}

// ---------------------------------------------------------------------------------------------
// Harness: sessions (one browser context per phone and state), snapshots, results.
// ---------------------------------------------------------------------------------------------
const PHONE = { ...devices['iPhone 13'] };
delete PHONE.defaultBrowserType;

const found = []; // { screen, kind, text, order }
const messages = []; // previews of office messages, by design English
const crashes = [], pageErrors = [];
const seenKey = new Set();
const settle = (p, ms = 220) => p.waitForTimeout(ms);
const nav = async (p, hash) => {
  await p.evaluate(h => { if (location.hash === h) dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h; }, hash);
  await settle(p);
};
const pad = async (p, code) => { for (const d of code) await p.click(`dialog [data-pin="${d}"]`); await settle(p, 350); };
const esc1 = p => p.keyboard.press('Escape').then(() => settle(p, 150));
const openAll = async p => { await p.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; })); await settle(p, 120); };
const click = async (p, sel) => { await p.locator(sel).first().click(); await settle(p); };

function makeHarness(browser, order) {
  const contexts = [];
  const h = {
    browser,
    // Opens a phone. o: role, hash, tasks, reports, hours, crewHours, outbox, settings, folder ('ok' | 'down' | error text),
    // clip ('ok' | 'fail'), noSubtle, signedIn, seed (false: a brand new phone), lang ('' leaves the phone's language unchosen).
    async open(o = {}) {
      const role = ROLES[o.role || 'super'], now = o.now || NOW;
      const ctx = await browser.newContext({ ...PHONE, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block', acceptDownloads: true });
      contexts.push(ctx);
      const page = await ctx.newPage();
      page.setDefaultTimeout(5000);
      page.zq = { folder: o.folder || 'down', hub: o.hubMode || 'up' };
      page.on('pageerror', e => pageErrors.push(`${o.role || 'super'} ${o.hash || ''}: ${e.message}`));
      await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await ctx.route(/script\.google\.com/, r => {
        if (r.request().url() === HUBURL) return hubReply(page, r);
        const m = page.zq.folder, cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
        if (m === 'down') return r.abort();
        if (m === 'ok') return r.fulfill({ status: 200, headers: cors, body: '{"ok":true}' });
        if (m === 'noerror') return r.fulfill({ status: 200, headers: cors, body: '{}' });
        return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: false, error: m }) });
      });
      await page.clock.install({ time: new Date(now) });
      const tasks = o.tasks || [], seed = o.seed === false ? null : {
        'schwab.settings': settings({ ...role.s, ...(o.lang === '' ? { lang: '' } : {}), ...o.settings }), 'schwab.pin': o.settings?.pin ?? PIN_HASH,
        'schwab.tasks': tasks, 'schwab.reports': o.reports || {}, 'schwab.hours': o.hours || [], 'schwab.crewHours': o.crewHours || [], 'schwab.outbox': o.outbox || [],
        ...((o.signedIn ?? role.in) ? { 'schwab.unlock': { until: Date.parse(now) + 12 * 36e5, fails: 0, wait: 0 } } : {}),
      };
      if (seed && o.noPin) { delete seed['schwab.pin']; seed['schwab.settings'].pin = ''; }
      if (seed && o.hub) seed['schwab.hub'] = o.hub; // a phone on the hub (hubOf)
      await page.addInitScript(({ seed, flags }) => {
        try { if (seed && !sessionStorage.getItem('zq-seeded')) { for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v)); sessionStorage.setItem('zq-seeded', '1'); } } catch {}
        window.__toasts = [];
        new MutationObserver(ms => { // every toast text, even one replaced before we look
          for (const m of ms) { // a toast with Undo: its message and the button, as two words apart
            const el = (m.target.nodeType === 3 ? m.target.parentElement : m.target)?.closest?.('#toast'), txt = el && (el.children.length ? [...el.children].map(c => c.textContent).join(' ') : el.textContent);
            if (txt && window.__toasts.at(-1) !== txt) window.__toasts.push(txt);
          }
        }).observe(document, { childList: true, characterData: true, subtree: true });
        navigator.share = async () => {}; // so the Share… button shows, as on a phone
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { if (window.__clipFail) throw new Error('blocked'); } } });
        window.__clipFail = flags.clip === 'fail';
        if (flags.noSubtle) Object.defineProperty(crypto, 'subtle', { configurable: true, get: () => undefined });
      }, { seed, flags: { clip: o.clip, noSubtle: !!o.noSubtle } });
      await page.goto(BASE + 'tasks.html' + (o.hash === undefined ? `#day/${TODAY}` : o.hash));
      await page.waitForFunction(() => window.appStarted === true);
      await settle(page, 350);
      return page;
    },
    // Takes a snapshot of what is on screen now, plus the toasts shown since the last one.
    // o.scope limits it to one element; o.office: the message previews are English by design (texts to the office).
    async snap(p, screen, o = {}) {
      // With a sheet open the page behind it was covered by an earlier snapshot; read only the sheet.
      const scope = o.scope || (await p.evaluate(() => (document.querySelector('dialog[open]') ? 'dialog[open]' : null)));
      const items = await p.evaluate(COLLECT, scope);
      const toasts = o.scope ? [] : await p.evaluate(() => window.__toasts.splice(0));
      for (const it of [...items, ...toasts.map(text => ({ kind: 'toast', text }))]) {
        const key = `${screen}|${it.kind}|${it.text}`;
        if (seenKey.has(key)) continue;
        seenKey.add(key);
        if (it.kind === 'message') { messages.push({ screen, text: it.text, office: !!o.office }); continue; } // judged below, not as one string
        found.push({ screen, kind: it.kind, text: it.text, order });
      }
      if (o.lang !== false) {
        const lang = await p.evaluate(() => document.documentElement.lang);
        const key = `${screen}|html-lang|${lang}`;
        if (lang !== 'es' && !seenKey.has(key)) { seenKey.add(key); found.push({ screen, kind: 'html-lang', text: `<html lang="${lang}"> in Spanish mode`, order, forced: true }); }
      }
    },
    // A step that may fail on its own without losing the rest of the screen.
    async step(label, fn) { try { await fn(); } catch (e) { crashes.push({ screen: label, error: String(e.message || e).split('\n').slice(0, 3).join(' ').replace(/\s+/g, ' ') }); } },
    // Collect toasts and the screen after a trigger.
    async after(p, screen, o) { await settle(p, 250); await h.snap(p, screen, o); },
    async close() { for (const c of contexts) await c.close().catch(() => {}); },
    // A link as the app packs it, built by the app's own codec.
    link: (p, payload) => p.evaluate(d => import('./shared.mjs').then(m => m.pack(d)), payload),
  };
  return h;
}

// The fake hub address goes to the local hub; page.zq.hub: 'up', 'down' (no signal) or 'quota' (translation used up).
// Translations are made here: the typed token with ZQtr in front, so they count as typed data.
async function hubReply(page, r) {
  const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, m = page.zq.hub, body = r.request().postData() || '{}';
  if (m === 'down') return r.abort();
  let req = {};
  try { req = JSON.parse(body); } catch {}
  if (req.action === 'translate') return r.fulfill({ status: 200, headers: cors, body: JSON.stringify(m === 'quota' ? { ok: false, error: 'quota' } : { ok: true, items: (req.items || []).map(t => 'ZQtr' + t) }) });
  try {
    const res = await fetch(HUBDEV, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } });
    return r.fulfill({ status: 200, headers: cors, body: await res.text() });
  } catch { return r.abort(); }
}
// A phone's hub settings (their own key, schwab.hub): the role's key from the local hub.
const hubOf = (role, o = {}) => ({ hubUrl: HUBURL, hubKey: HUBKEYS[role], hubRole: role, hubCrew: role === 'crew' ? 'Crew A' : '', ...o });
// One sync round on the page's own sync engine (the same module the app imported), then let the screen redraw.
const synced = async (p, ms = 400) => { await p.evaluate(() => import('./sync.mjs').then(m => m.cycle())); await settle(p, ms); };

// In a share sheet: copy once (works), then open it again and copy with the clipboard refused (the fallback toast).
async function copyBoth(h, p, sendSel, screen, o) {
  await click(p, 'dialog [data-s=copy]'); await h.after(p, `${screen}, after Copy link`, o); // the sheet closes; the page behind is read
  await click(p, sendSel); await p.waitForSelector('dialog .linkbox');
  await p.evaluate(() => { window.__clipFail = true; });
  await click(p, 'dialog [data-s=copy]'); await h.after(p, screen, o);
  await p.evaluate(() => { window.__clipFail = false; });
}

// Open a menu (or any dialog-making button), snapshot it, close it.
async function peek(h, p, sel, screen, o) {
  await click(p, sel);
  await p.waitForSelector('dialog[open]');
  await h.snap(p, screen, o);
  await esc1(p);
}

// ---------------------------------------------------------------------------------------------
// Screens. One function each; add a function and a line in SCREENS to cover a new screen.
// ---------------------------------------------------------------------------------------------

async function crewBoardEmpty(h) {
  const p = await h.open({ role: 'crew' });
  await h.snap(p, 'Crew board, empty');
  await peek(h, p, '[data-act=boardMenu]', 'Board menu, crew phone, no sheets');
  await click(p, '.empty [data-act=paste]');
  await h.snap(p, 'Paste a link sheet');
  await click(p, 'dialog [data-open]'); // nothing pasted
  await h.after(p, 'Paste a link sheet');
  await p.fill('dialog textarea', 'not a link');
  await click(p, 'dialog [data-open]');
  await h.after(p, 'Paste a link sheet');
  await esc1(p);
  await nav(p, `#day/${YEST}`); await h.snap(p, 'Crew board, empty, past day');
  await nav(p, `#day/${TOMO}`); await h.snap(p, 'Crew board, empty, planning ahead');
  await nav(p, '#p=notalink'); await h.snap(p, 'Crew board, damaged link'); // toast: damaged link
}

async function crewBoardSheets(h) {
  const p = await h.open({ role: 'crew', tasks: boardTasks('link') });
  await openAll(p);
  await h.snap(p, 'Crew board, with sheets');
  await click(p, '.chip[data-act=filter][data-v="Crew B"]'); await h.snap(p, 'Crew board, filtered to one crew');
  await peek(h, p, '[data-act=boardMenu]', 'Board menu, crew phone, with sheets');
  await nav(p, `#day/${YEST}`); await h.snap(p, 'Crew board, past day');
  await nav(p, `#day/${TOMO}`); await h.snap(p, 'Crew board, planning ahead');
}

async function crewBoardFilterNone(h) {
  // A crew phone only offers the crews it has sheets from (one crew: no chips at all); the office can pick any crew,
  // so its board is where "no sheets for this crew" still shows.
  let p = await h.open({ role: 'crew', tasks: [task({ origin: 'link', crew: 'Crew A' })] });
  await h.snap(p, 'Crew board, sheets from one crew');
  p = await h.open({ role: 'super', tasks: [task({ crew: 'Crew A' })] });
  await click(p, '.chip[data-act=filter][data-v="Crew C"]'); // a crew with no sheet today
  await h.snap(p, 'Office board, a crew with no sheets');
}

async function crewTaskScreens(h) {
  const fresh = task({ origin: 'link', uid: 'zqfresh', id: 'T1014-11', status: '', comments: '', aStart: '', aStop: '', delay: 0, items: items([['ZQsetboxes', 0], ['ZQpullwire', 0]]), checks: items([['Labeling', 0]]) });
  const started = task({ origin: 'link', uid: 'zqstart', id: 'T1014-12', status: '', aStop: '', delay: 0 });
  const done = task({ origin: 'link', uid: 'zqdone', id: 'T1014-13', status: 'Partial' });
  const lean = task({ origin: 'link', uid: 'zqlean', id: 'T1014-14', refs: '', allot: 0, est: 0, allotNote: '', estNote: '', pStart: '', pStop: '', checkIn: '', members: [], area: '', floor: '', by: '', items: [], checks: [], scope: '', status: '' });
  const told = task({ origin: 'link', uid: 'zqtold', id: 'T1014-15', reply: 'ZQbringlift', replyBy: 'ZQPat', replyAt: TS, status: '' }); // the office's message on top
  const p = await h.open({ role: 'crew', tasks: [fresh, started, done, lean, told], hash: '#task/zqfresh/assign' });
  await h.snap(p, 'Crew task sheet, not started');
  await h.step('crew task: menu', async () => { await peek(h, p, '[data-act=crewMenu]', 'Crew task menu'); });
  await nav(p, '#task/zqstart/assign'); await h.snap(p, 'Crew task sheet, started');
  await nav(p, '#task/zqdone/assign'); await h.snap(p, 'Crew task sheet, finished with delays');
  await nav(p, '#task/zqlean/assign'); await h.snap(p, 'Crew task sheet, only the basics');
  await nav(p, '#task/zqtold/assign'); await h.snap(p, 'Crew task sheet, a message from the office');
  // Toasts and hints.
  await nav(p, '#task/zqfresh/assign');
  await click(p, '[data-act=sendResults]'); await h.after(p, 'Crew task sheet, not started'); // pick a status first
  await click(p, '[data-act=set][data-k="t.status"][data-v="Blocked"]'); await h.after(p, 'Crew task sheet, not started'); // say what blocks
  await click(p, '[data-act=set][data-k="t.status"][data-v="Blocked"]'); // back to none
  await click(p, '[data-act=clock][data-v=aStart]'); await click(p, '[data-act=clock][data-v=aStop]'); await h.snap(p, 'Crew task sheet, started and stopped');
  for (const i of [0, 1]) await click(p, `.tick[data-list=items][data-i="${i}"]`);
  await click(p, '.tick[data-list=checks][data-i="0"]'); await h.after(p, 'Crew task sheet, everything checked'); // everything is checked off
  await click(p, '[data-act=delay][data-v="15"]'); await click(p, '[data-act=delay][data-v="-15"]');
  await click(p, '[data-act=set][data-k="t.status"][data-v="Complete"]');
  // Send results: the Spanish line first, then the English one.
  await click(p, '[data-act=sendResults]'); await p.waitForSelector('dialog .linkbox');
  await h.snap(p, 'Share sheet: crew results');
  await copyBoth(h, p, '[data-act=sendResults]', 'Share sheet: crew results');
  await esc1(p);
  await nav(p, '#task/zqdone/assign'); // worked time and a comment ride in the results message
  await click(p, '[data-act=sendResults]'); await p.waitForSelector('dialog .linkbox'); await h.snap(p, 'Share sheet: crew results, with worked time'); await esc1(p);
  await h.step('crew task: delete, Undo', async () => { await click(p, '[data-act=crewMenu]'); await click(p, 'dialog [data-act=del]'); await p.waitForSelector('#toast .toast-undo'); await h.snap(p, 'Board after Delete, Undo toast, crew phone'); await click(p, '#toast .toast-undo'); });
}

async function officeBoard(h) {
  const p = await h.open({ role: 'super', tasks: [...boardTasks('mine'), ...yesterdayOpen()] });
  await openAll(p);
  await h.snap(p, 'Office board, with sheets');
  await click(p, '.chip[data-act=filter][data-v="Crew B"]'); await h.snap(p, 'Office board, filtered to one crew');
  await click(p, '.chip[data-act=filter][data-v=""]'); // all crews again
  await peek(h, p, '[data-act=boardMenu]', 'Board menu, office');
  await click(p, '[data-act=boardMenu]'); await click(p, 'dialog [data-act=sendDay]'); await p.waitForSelector('dialog .linkbox');
  await h.snap(p, 'Share sheet: day plan');
  await esc1(p);
  await nav(p, `#day/${YEST}`); await h.snap(p, 'Office board, past day');
  await nav(p, `#day/${TOMO}`); await h.snap(p, 'Office board, empty day with earlier sheets');
  await click(p, '[data-act=carryDay]'); await h.after(p, 'Office board, empty day with earlier sheets'); // sheets copied
}

async function officeBoardNothingOpen(h) {
  const p = await h.open({ role: 'super', tasks: [task({ date: YEST, id: 'T1013-01', status: 'Complete' })], hash: `#day/${TODAY}` });
  await h.snap(p, 'Office board, empty day');
  await click(p, '[data-act=carryDay]'); await h.after(p, 'Office board, empty day'); // nothing left open
  await click(p, '[data-act=new]'); await h.snap(p, 'Task sheet, new and empty (Assign)'); // a brand new task
  await h.step('new task: send without a crew', async () => { await click(p, '[data-act=sendTask]'); await h.after(p, 'Task sheet, new and empty (Assign)'); });
}

async function officeTask(h) {
  const full = task({ uid: 'zqfull', id: 'T1014-21', review: 'Follow-up needed', reviewer: 'ZQDana', followUp: 'ZQfollowup' });
  const working = task({ uid: 'zqwork', id: 'T1014-23', status: '', aStop: '', delay: 0, resultAt: 0 });
  const bare = task({ uid: 'zqbare', id: 'T1014-22', status: '', aStart: '', aStop: '', delay: 0, resultAt: 0, gotAt: 0, sentAt: 0, items: [], checks: [], scope: '' });
  const p = await h.open({ role: 'super', tasks: [full, bare, working], hash: '#task/zqfull/assign' });
  await h.snap(p, 'Task sheet, Assign tab, filled in');
  await nav(p, '#task/zqfull/results'); await h.snap(p, 'Task sheet, Crew results tab, filled in');
  await nav(p, '#task/zqfull/review'); await h.snap(p, 'Task sheet, Review tab, filled in');
  await click(p, '[data-act=set][data-k="t.review"][data-v="Accepted"]'); await h.snap(p, 'Task sheet, Review tab, accepted');
  await nav(p, '#task/zqbare/assign'); await h.snap(p, 'Task sheet, Assign tab, sent for the first time');
  await nav(p, '#task/zqbare/results'); await h.snap(p, 'Task sheet, Crew results tab, empty');
  await nav(p, '#task/zqbare/review'); await h.snap(p, 'Task sheet, Review tab, no results yet');
  await nav(p, '#task/zqwork/review'); await h.snap(p, 'Task sheet, Review tab, work in progress');
  await nav(p, '#task/zqfull/assign');
  await peek(h, p, '[data-act=taskMenu]', 'Task menu');
  await click(p, '[data-act=sendTask]'); await p.waitForSelector('dialog .linkbox');
  await h.snap(p, 'Share sheet: task to the crew');
  await copyBoth(h, p, '[data-act=sendTask]', 'Share sheet: task to the crew');
  await esc1(p);
  await click(p, '[data-act=taskMenu]'); await click(p, 'dialog [data-act=dup]'); await h.after(p, 'Task sheet, after Duplicate');
  await nav(p, '#task/zqfull/assign');
  await click(p, '[data-act=taskMenu]'); await click(p, 'dialog [data-act=carry]'); await h.after(p, 'Task sheet, after Carry open work');
  await nav(p, '#task/zqfull/assign');
  // Delete: gone at once with Undo (no ask); Undo brings the sheet back.
  await click(p, '[data-act=taskMenu]'); await click(p, 'dialog [data-act=del]'); await p.waitForSelector('#toast .toast-undo');
  await h.snap(p, 'Board after Delete, Undo toast, office'); await click(p, '#toast .toast-undo');
  await nav(p, '#task/zqfull/assign');
  await click(p, '[data-act=delItem][data-i="0"]'); await h.after(p, 'Task sheet, a step removed, Undo toast'); await click(p, '#toast .toast-undo');
  await h.step('task: add rows', async () => {
    await p.fill('#newMember', 'ZQMiguel'); await click(p, '[data-act=addMember]');
    await p.fill('#newItem', 'ZQstepx'); await click(p, '[data-act=addItem]');
    await p.fill('#newCheck', 'ZQcheckx'); await click(p, '[data-act=addCheck]');
    await h.snap(p, 'Task sheet, Assign tab, filled in');
  });
}

async function longLink(h) {
  // A sheet with a lot of text makes a long link, and the share sheet says so.
  const big = 'ZQ' + crypto.randomBytes(1500).toString('hex'); // random, so it doesn't compress
  const p = await h.open({ role: 'super', tasks: [task({ uid: 'zqbig', id: 'T1014-61', scope: big })], hash: '#task/zqbig/assign' });
  await click(p, '[data-act=sendTask]'); await p.waitForSelector('dialog .linkbox'); await h.snap(p, 'Share sheet: a long link');
}

async function officeTaskWithFolder(h) {
  const t = task({ uid: 'zqfold', id: 'T1014-31', filedAt: 0 });
  const p = await h.open({ role: 'super', tasks: [t, task({ uid: 'zqfold2', id: 'T1014-32' })], settings: { folderUrl: 'https://script.google.com/macros/s/ZQabc/exec', siteCode: 'ZQsite' }, hash: '#task/zqfold/assign', folder: 'ok' });
  await peek(h, p, '[data-act=taskMenu]', 'Task menu, with the review folder set');
  await nav(p, '#task/zqfold/review');
  await click(p, '[data-act=set][data-k="t.review"][data-v="Accepted"]'); await h.after(p, 'Review folder: saved'); // Saved to the review folder
  await nav(p, '#task/zqfold2/review'); p.zq.folder = 'down';
  await click(p, '[data-act=set][data-k="t.review"][data-v="Accepted"]'); await h.after(p, 'Review folder: no signal');
  await nav(p, '#task/zqfold2/review'); p.zq.folder = 'Wrong site code';
  await click(p, '[data-act=set][data-k="t.review"][data-v="Accepted"]'); await click(p, '[data-act=set][data-k="t.review"][data-v="Follow-up needed"]'); await h.after(p, 'Review folder: refused');
  await p.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
  await click(p, '[data-act=set][data-k="t.review"][data-v="Accepted"]'); await h.after(p, 'Phone out of space'); // also: this phone wouldn't save
}

async function settingsScreen(h) {
  const p = await h.open({ role: 'super', hash: '#settings', outbox: [{ date: TODAY, name: 'ZQfile', pdf: 'AAAA', v: 1 }], settings: { crews: [...CREWS, { name: '', lead: '', members: '' }], folderUrl: 'https://script.google.com/macros/s/ZQabc/exec', siteCode: 'ZQsite' }, folder: 'ok' });
  await h.snap(p, 'Settings');
  await click(p, '[data-act=addCrew]'); await h.snap(p, 'Settings, crew added');
  await click(p, '[data-act=delCrew][data-i="5"]'); await p.waitForSelector('#toast .toast-undo'); await h.snap(p, 'Crew removed, with Undo'); await click(p, '#toast .toast-undo'); // removed at once; Undo brings it back
  // The review folder answers: connected, then every refusal the receiver can give, then silence.
  await click(p, '[data-act=testFolder]'); await h.after(p, 'Settings, Test the connection');
  for (const e of ['Invalid request', 'Upload integration not configured', 'Wrong site code', 'Invalid date or PDF', 'Invalid record version', 'Busy; try again shortly', 'Daily upload limit reached; ask the owner', 'Upload failed; owner must review Drive setup', 'ZQcustom', 'noerror']) {
    p.zq.folder = e; await click(p, '[data-act=testFolder]'); await h.after(p, 'Settings, Test the connection');
  }
  p.zq.folder = 'down'; await click(p, '[data-act=testFolder]'); await h.after(p, 'Settings, Test the connection');
  await p.fill('[data-k="s.folderUrl"]', 'https://example.com/nope'); await click(p, '[data-act=testFolder]'); await h.after(p, 'Settings, Test the connection');
  await click(p, '[data-act=backup]'); await h.after(p, 'Settings, backup');
  // Restore: not a backup, then a real one (asks first), then no room.
  await p.setInputFiles('[data-restore]', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('nope') }); await h.after(p, 'Settings, Restore from backup');
  const backup = Buffer.from(JSON.stringify({ 'schwab.settings': settings() }));
  await p.setInputFiles('[data-restore]', { name: 'b.json', mimeType: 'application/json', buffer: backup }); await p.waitForSelector('dialog .ask');
  await h.snap(p, 'Restore ask'); await click(p, 'dialog [data-a="0"]');
  await p.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
  await p.setInputFiles('[data-restore]', { name: 'b2.json', mimeType: 'application/json', buffer: backup }); await p.waitForSelector('dialog .ask');
  await click(p, 'dialog [data-a="1"]'); await h.after(p, 'Restore ask');
  await click(p, '[data-act=addCrew]'); await h.after(p, 'Phone out of space');
}

async function settingsEmpty(h) {
  const p = await h.open({ role: 'pm', hash: '#settings' });
  await h.snap(p, 'Settings, PM phone, nothing waiting to upload');
}

async function languageChooser(h) {
  // A brand new crew phone opens its first sheet: the first run asks the language, who is using it, the name; once.
  const p = await h.open({ role: 'crew', seed: false, lang: '' });
  const code = await h.link(p, { v: 1, kind: 'task', pin: PIN_HASH, task: task({ uid: 'zqfirst', origin: 'mine', id: 'T1014-41', sentAt: TS }) });
  await nav(p, '#p=' + code);
  await p.waitForSelector('dialog.firstrun [data-fr=lang]');
  await h.snap(p, 'First run: language (a new phone)', { scope: 'dialog.firstrun', lang: false });
  await click(p, 'dialog.firstrun [data-fr=lang][data-v=es]');
  await h.snap(p, 'First run: who is using this phone', { scope: 'dialog.firstrun' });
  await click(p, 'dialog.firstrun [data-fr=role][data-v="Crew member"]');
  await p.waitForSelector('dialog.firstrun [data-fr=pick]');
  await click(p, 'dialog.firstrun [data-fr=next]'); // no name yet
  await h.snap(p, 'First run: the name, crew member, from the link', { scope: 'dialog.firstrun' });
  await click(p, 'dialog.firstrun [data-fr=pick]');
  await p.waitForSelector('[data-act=sendResults]');
  await h.snap(p, 'Crew task sheet, just opened from a link');
  // A new office phone: the name, then the passcode.
  const q = await h.open({ role: 'super', seed: false, lang: '' });
  await q.waitForSelector('dialog.firstrun [data-fr=lang]');
  await click(q, 'dialog.firstrun [data-fr=lang][data-v=es]');
  await click(q, 'dialog.firstrun [data-fr=role][data-v="Project manager"]');
  await h.snap(q, 'First run: the name, office', { scope: 'dialog.firstrun' });
  await q.fill('#frName', 'ZQPat'); await click(q, 'dialog.firstrun [data-fr=next]');
  await q.waitForSelector('dialog.pin .keypad');
  await h.snap(q, 'First run: office passcode', { scope: 'dialog.firstrun' });
  await h.snap(q, 'First run: office passcode pad', { scope: 'dialog.pin' });
  await click(p, '#langBtn'); // to English and back
  await click(p, '#langBtn'); await h.snap(p, 'Header, language button');
}

// A phone the first run set up for a crew member: its board, menus, clock and the sign-in pad.
async function crewMemberPhone(h) {
  const p = await h.open({ role: 'member' });
  await h.snap(p, 'Crew member phone, board, empty');
  await peek(h, p, '[data-act=boardMenu]', 'Board menu, crew member phone');
  await nav(p, `#clock/${TODAY}`); await h.snap(p, 'Crew member phone, time clock');
  await peek(h, p, '[data-act=hMenu]', 'Time clock menu, crew member phone');
  await click(p, '#lockBtn'); await p.waitForSelector('dialog .keypad'); await h.snap(p, 'Passcode pad, enter'); await esc1(p);
}

// An older phone with settings but no language chosen opens its first sheet: the bilingual language sheet, once.
async function olderPhoneLanguage(h) {
  const p = await h.open({ role: 'crew', lang: '' });
  const code = await h.link(p, { v: 1, kind: 'task', pin: PIN_HASH, task: task({ uid: 'zqolder', origin: 'mine', id: 'T1014-42', sentAt: TS }) });
  await nav(p, '#p=' + code);
  await p.waitForSelector('dialog [data-act=lang]');
  await h.snap(p, 'Language sheet, an older phone', { lang: false });
  await click(p, 'dialog [data-act=lang][data-v=es]');
  await h.snap(p, 'Crew task sheet, just opened from a link');
}

async function officeHeaderAndTabs(h) {
  const p = await h.open({ role: 'crew', tasks: [task({ origin: 'link' })] });
  await h.snap(p, 'Header and tabs, signed out'); // lock icons on the office tabs, aria-labels
  const q = await h.open({ role: 'super' });
  await h.snap(q, 'Header and tabs, signed in');
  await click(q, '#lockBtn'); await h.after(q, 'Header and tabs, signed in'); // Office screens locked
}

async function passcodeCreate(h) {
  const p = await h.open({ role: 'crew', noPin: true, hash: '#settings' });
  await p.waitForSelector('dialog .keypad');
  await h.snap(p, 'Passcode pad, create');
  await pad(p, '1234'); await h.snap(p, 'Passcode pad, create (confirm)');
  await pad(p, '4321'); await h.snap(p, 'Passcode pad, create (codes differ)');
  await pad(p, '1234'); await pad(p, '1234'); await h.after(p, 'Passcode pad, create (done)');
}

async function passcodeEnter(h) {
  const p = await h.open({ role: 'crew', hash: '#settings' });
  await p.waitForSelector('dialog .keypad');
  await h.snap(p, 'Passcode pad, enter');
  await pad(p, '9999'); await h.snap(p, 'Passcode pad, wrong code');
  for (let i = 0; i < 4; i++) await pad(p, '9999');
  await h.snap(p, 'Passcode pad, too many wrong codes');
  await pad(p, '1234'); await h.snap(p, 'Passcode pad, too many wrong codes');
  const q = await h.open({ role: 'crew', hash: '#settings' });
  await q.waitForSelector('dialog .keypad');
  await pad(q, '1234'); await h.after(q, 'Passcode pad, entered'); // no toast on success; the Settings screen opens
  await h.snap(q, 'Settings, just signed in');
  const r = await h.open({ role: 'crew', hash: '#settings', noSubtle: true });
  await r.waitForSelector('dialog .keypad'); await pad(r, '1234'); await h.snap(r, 'Passcode pad, no https');
}

async function passcodeChange(h) {
  const p = await h.open({ role: 'super', hash: '#settings' });
  await click(p, '[data-act=changePin]'); await p.waitForSelector('dialog .keypad');
  await h.snap(p, 'Passcode pad, change (current code)');
  await pad(p, '0000'); await h.snap(p, 'Passcode pad, change (wrong current code)');
  await pad(p, '1234'); await h.snap(p, 'Passcode pad, change (new code)');
  await pad(p, '1111'); await h.snap(p, 'Passcode pad, change (confirm)');
  await pad(p, '2222'); await h.snap(p, 'Passcode pad, change (codes differ)');
  await pad(p, '1111'); await pad(p, '1111'); await h.after(p, 'Passcode pad, change (done)');
  const q = await h.open({ role: 'crew', noPin: true, hash: '#settings' });
  await q.waitForSelector('dialog .keypad'); await pad(q, '1234'); await pad(q, '1234');
  await q.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
  await h.step('passcode: no room', async () => { await nav(q, '#settings'); await h.snap(q, 'Passcode pad, no room to save'); });
}

async function timeClockWorker(h) {
  const mine = [
    shift({ id: 'zsm1', date: '2026-10-12', in: '06:58', out: '15:31' }), shift({ id: 'zsm2', date: YEST, in: '07:00', out: '15:00' }),
    shift({ id: 'zsm0', date: '2026-10-06', in: '07:00', out: '15:30' }), // last week
  ];
  // Not clocked in, no name, nothing yet.
  let p = await h.open({ role: 'worker', settings: { worker: '' }, hash: `#clock/${TODAY}` });
  await h.snap(p, 'Time clock, not clocked in');
  await click(p, '[data-act=hTap]'); await h.after(p, 'Time clock, not clocked in'); // type your name first
  await click(p, '[data-act=hMenu]'); await h.snap(p, 'Time clock menu, signed out, no hours');
  await click(p, 'dialog [data-act=lockBtn]'); await p.waitForSelector('dialog .keypad'); await h.snap(p, 'Passcode pad, enter'); await esc1(p);
  await p.fill('[data-k="s.worker"]', 'ZQJose'); await click(p, '[data-act=hTap]'); await p.waitForSelector('dialog .linkbox');
  await h.snap(p, 'Share sheet: hours to the PM (clock in)', { office: true });
  await click(p, 'dialog [data-s=copy]'); await h.after(p, 'Share sheet: hours to the PM (clock in), after Copy link', { office: true });
  await h.snap(p, 'Time clock, on the clock');
  // On the clock with a full week behind.
  p = await h.open({ role: 'worker', hours: [...mine, shift({ id: 'zsm3', date: TODAY, in: '06:58', out: '' })], hash: `#clock/${TODAY}` });
  await h.snap(p, 'Time clock, on the clock, with hours');
  await peek(h, p, '[data-act=hMenu]', 'Time clock menu, with hours');
  await click(p, '[data-act=hMenu]'); await click(p, 'dialog [data-act=hResend]'); await p.waitForSelector('dialog .linkbox');
  await h.snap(p, 'Share sheet: hours to the PM (all)', { office: true }); await esc1(p);
  await click(p, '[data-act=hTap]'); await p.waitForSelector('dialog .linkbox');
  await h.snap(p, 'Share sheet: hours to the PM (clock out)', { office: true }); await esc1(p);
  await h.snap(p, 'Time clock, clocked out');
  // Missed clock-out: yesterday still open, today not started.
  p = await h.open({ role: 'worker', hours: [shift({ id: 'zsm4', date: YEST, in: '07:00', out: '' })], hash: `#clock/${TODAY}`, now: '2026-10-14T07:05:00Z' });
  await h.snap(p, 'Time clock, missed clock-out');
  p = await h.open({ role: 'worker', settings: { worker: '' }, hash: `#clock/${TODAY}` });
  await p.fill('[data-k="s.worker"]', ''); await click(p, '[data-act=hMenu]'); await h.snap(p, 'Time clock menu, signed out, no hours');
  // A stale screen: asleep past the 16-hour cutoff (no timer ran), and a button drawn before another tab changed the clock.
  p = await h.open({ role: 'worker', hours: [shift({ id: 'zsm5', date: TODAY, in: '06:58', out: '' })], hash: `#clock/${TODAY}`, now: '2026-10-14T07:30:00Z' });
  await p.clock.setSystemTime(new Date('2026-10-14T23:30:00Z'));
  await click(p, '[data-act=hTap]'); await h.after(p, 'Time clock, a tap after the 16-hour cutoff');
  await p.evaluate(() => { document.querySelector('[data-act=hTap]').dataset.v = 'out:zqelsewhere'; }); // as if another tab clocked out
  await click(p, '[data-act=hTap]'); await h.after(p, 'Time clock, a tap on an out-of-date screen');
  // Signed-in office phone on its own clock (no lock item in the menu).
  p = await h.open({ role: 'super', hours: mine, hash: `#clock/${TODAY}` });
  await h.snap(p, 'Time clock, superintendent phone');
  await peek(h, p, '[data-act=hMenu]', 'Time clock menu, signed in');
}

// One list of people: the worker's Today card and name hint, the crew view's "you", names joining crews from a sheet.
async function rosterWorker(h) {
  const mine = task({ origin: 'link', uid: 'zqmine', id: 'T1014-71', members: ['ZQJose', 'ZQLuisA'] });
  const bare = task({ origin: 'link', uid: 'zqbare2', id: '', crew: '', floor: '', area: '', members: ['zqjose'] }); // no id, crew or floor yet
  const other = task({ origin: 'link', uid: 'zqother', id: 'T1014-73', members: ['ZQAnaB'] });
  const p = await h.open({ role: 'worker', tasks: [mine, bare, other], hash: `#clock/${TODAY}` });
  await h.snap(p, 'Time clock, Today card with sheets');
  await click(p, '#todayCard .tcard'); await h.snap(p, 'Crew task sheet, opened from the Today card');
  await nav(p, `#clock/${TODAY}`);
  await p.fill('[data-k="s.worker"]', 'ZQNobody'); await p.press('[data-k="s.worker"]', 'Tab'); await h.after(p, 'Time clock, a name on no list, sheets today');
  await p.fill('[data-k="s.worker"]', 'zqjose'); await p.press('[data-k="s.worker"]', 'Tab'); await h.after(p, 'Time clock, Today card with sheets'); // takes the known spelling
  // Names typed onto a sheet before its crew is picked join that crew.
  const q = await h.open({ role: 'super', tasks: [task({ uid: 'zqnocrew', id: 'T1014-74', crew: '', members: [] })], hash: '#task/zqnocrew/assign' });
  for (const n of ['ZQPedro', 'ZQPaco']) { await q.fill('#newMember', n); await click(q, '[data-act=addMember]'); }
  await click(q, '.chip[data-act=crew]:has-text("Crew B")'); await h.after(q, 'Task sheet, names join the crew picked');
}

// The PM's crew hours: each person's crew, task ids on shifts, names on no crew list, and putting one on a crew.
async function rosterPM(h) {
  const hours = [
    shift({ who: 'ZQJoseA', date: TODAY, device: 'zqdev5', crew: 'Crew A', tasks: ['T1014-01'] }), // on a crew list here
    shift({ who: 'ZQMara', date: TODAY, device: 'zqdev6', crew: 'Crew B', tasks: ['T1014-02', 'T1014-03'] }), // a crew from the sheets, no crew list here
    shift({ who: 'ZQNew', date: TODAY, device: 'zqdev7' }), // no crew anywhere
  ];
  const p = await h.open({ role: 'pm', crewHours: hours, hash: `#clock/${TODAY}` });
  await h.snap(p, 'Crew hours, crews and crew lists');
  await click(p, '.person:has(h2:text-is("ZQNew")) [data-act=hCrew]'); await p.waitForSelector('dialog [data-crew]'); await h.snap(p, 'Add to a crew sheet');
  await click(p, 'dialog [data-crew]:has-text("Crew C")'); await h.after(p, 'Crew hours, crews and crew lists');
  await click(p, '.person:has(h2:text-is("ZQMara")) [data-act=hCrew][data-crew]'); await h.after(p, 'Crew hours, one tap onto the crew her sheets named'); // "Add to Crew B"
  await click(p, '[data-act=hPmMenu]'); await click(p, 'dialog [data-act=hAdd]'); await p.waitForSelector('dialog [data-save]');
  await p.fill('dialog [name=who]', 'zqluisa'); await p.fill('dialog [name=in]', '07:00'); await click(p, 'dialog [data-save]'); await h.after(p, 'Crew hours, crews and crew lists'); // a name from the crew lists
  const q = await h.open({ role: 'pm', crewHours: hours, settings: { crews: [] }, hash: `#clock/${TODAY}` });
  await h.snap(q, 'Crew hours, no crews set up');
}

async function crewHoursPM(h) {
  const p = await h.open({ role: 'pm', crewHours: crewShifts(), hash: `#clock/${TODAY}` });
  await h.snap(p, 'Crew hours, with shifts');
  await peek(h, p, '[data-act=hPmMenu]', 'Crew hours menu');
  // Add a shift: from the menu, then for one person.
  await click(p, '[data-act=hPmMenu]'); await click(p, 'dialog [data-act=hAdd]'); await p.waitForSelector('dialog [data-save]');
  await h.snap(p, 'Add a shift sheet');
  await click(p, 'dialog [data-save]'); await h.after(p, 'Add a shift sheet'); // add the name, the date and the time
  await esc1(p);
  await click(p, '.person:has(h2:text-is("ZQAna")) [data-act=hAdd]'); await p.waitForSelector('dialog [data-save]'); await h.snap(p, 'Add a shift sheet, for one person');
  await p.fill('dialog [name=in]', '07:00'); await p.fill('dialog [name=out]', '15:00'); await click(p, 'dialog [data-save]'); await h.after(p, 'Crew hours, with shifts');
  // Rename.
  await click(p, '.person:has(h2:text-is("ZQAna")) [data-act=hRename]'); await p.waitForSelector('dialog [data-save]'); await h.snap(p, 'Rename sheet');
  await p.fill('dialog [name=who]', ''); await click(p, 'dialog [data-save]'); await h.after(p, 'Rename sheet'); // type the name
  await esc1(p);
  // Remove: gone at once with Undo (no ask): a named shift and the shift with no name, each put back.
  await click(p, '[data-act=hDel][data-id="zsana1"]'); await p.waitForSelector('#toast .toast-undo'); await h.snap(p, 'Shift removed, with Undo'); await click(p, '#toast .toast-undo');
  await click(p, '[data-act=hDel][data-id="zsnameless"]'); await p.waitForSelector('#toast .toast-undo'); await h.snap(p, 'Shift removed, with Undo, shift with no name'); await click(p, '#toast .toast-undo');
  await h.snap(p, 'Crew hours, with shifts');
  // Send to the accountant: with open shifts it asks first.
  await click(p, '[data-act=hSend]'); await p.waitForSelector('dialog .ask'); await h.snap(p, 'Accountant warning ask, shifts without clock-out');
  await click(p, 'dialog [data-a="1"]'); await h.after(p, 'Crew hours, with shifts');
}

async function crewHoursVariants(h) {
  // Exactly one open shift: the warning is singular.
  let p = await h.open({ role: 'pm', crewHours: [...closedShifts(), shift({ who: 'ZQAna', date: YEST, in: '07:00', out: '' })], hash: `#clock/${TODAY}` });
  await click(p, '[data-act=hSend]'); await p.waitForSelector('dialog .ask'); await h.snap(p, 'Accountant warning ask, one shift without clock-out'); await click(p, 'dialog [data-a="0"]');
  // All shifts closed: no warning, files download.
  p = await h.open({ role: 'pm', crewHours: closedShifts(), hash: `#clock/${TODAY}` });
  await h.snap(p, 'Crew hours, all shifts closed');
  await click(p, '[data-act=hSend]'); await h.after(p, 'Crew hours, all shifts closed');
  // Weeks with nothing in them.
  await nav(p, `#clock/${LASTWK}`); await h.snap(p, 'Crew hours, empty week (past)'); // no Send to accountant: Add a shift is the one action
  await nav(p, `#clock/${NEXTWK}`); await h.snap(p, 'Crew hours, empty week (ahead)');
  // Signed-out PM phone: the crew hours tab is locked.
  p = await h.open({ role: 'pm', signedIn: false, hash: `#clock/${TODAY}` });
  await h.snap(p, 'Crew hours, PM phone signed out');
  await esc1(p); await h.snap(p, 'Board and tabs, PM phone signed out'); // the Time clock tab: locked, and says so
}

// The daily report with every section open, as the superintendent and as the PM.
async function reportAs(h, role, label) {
  const p = await h.open({ role, reports: { [TODAY]: report() }, tasks: [task({ origin: 'mine' })], hash: `#report/${TODAY}` });
  await p.waitForSelector('#sec-sum');
  await openAll(p);
  await h.snap(p, `Daily report, every section open (${label})`);
  for (const st of ['On plan', 'Behind plan', 'No work today', 'At risk']) { await click(p, `[data-act=set][data-k="r.status"][data-v="${st}"]`); await h.snap(p, `Daily report, every section open (${label})`); }
  await click(p, '[data-act=set][data-k="r.status"][data-v="At risk"]'); // clears the status
  await click(p, '[data-act=send]'); await h.after(p, `Daily report, every section open (${label})`); // set the overall status first
  await click(p, '[data-act=set][data-k="r.status"][data-v="At risk"]');
  await peek(h, p, '[data-act=menu]', `Report menu (${label})`);
  await click(p, '[data-act=send]'); await p.waitForSelector('dialog .linkbox');
  await h.snap(p, `Share sheet: daily report (${label})`, { office: true });
  await copyBoth(h, p, '[data-act=send]', `Share sheet: daily report (${label})`, { office: true });
  await esc1(p);
  await h.step(`report ${label}: a section row`, async () => { await click(p, '#sec-risks > summary'); await h.snap(p, `Daily report, a section folded (${label})`); await click(p, '#sec-risks > summary'); });
  if (role === 'pm') { await click(p, '[data-act=stampPM]'); await h.snap(p, `Daily report, every section open (${label})`); }
  // Remove and clear: gone at once with Undo (no ask), each put back. One entry from every list, so every toast shows.
  const undone = async (sel, screen) => { await click(p, sel); await p.waitForSelector('#toast .toast-undo'); await h.snap(p, screen); await click(p, '#toast .toast-undo'); await openAll(p); };
  for (const list of ['needs', 'decisions', 'next', 'risks']) await undone(`[data-act=del][data-list=${list}][data-i="0"]`, `Entry removed, with Undo (${label})`);
  await undone('[data-act=delFloor][data-i="0"]', `Floor removed, with Undo (${label})`);
  await click(p, '[data-act=add][data-v=needs]'); await click(p, '[data-act=add][data-v=decisions]'); await click(p, '[data-act=add][data-v=next]'); await click(p, '[data-act=add][data-v=risks]');
  await click(p, '[data-act=addFloor]'); await click(p, '[data-act=addCrewTo][data-i="0"]'); await click(p, '[data-act=na][data-f="0"][data-c="2"]');
  await h.snap(p, `Daily report, rows just added (${label})`);
  await undone('[data-act=delFloor][data-i="2"]', `Floor removed, with Undo, unnamed floor (${label})`);
  await click(p, '[data-act=menu]'); await click(p, 'dialog [data-act=clear]'); await p.waitForSelector('#toast .toast-undo');
  await h.snap(p, `Report cleared, with Undo (${label})`); await click(p, '#toast .toast-undo'); await openAll(p);
  await h.snap(p, `Daily report, every section open (${label})`);
}
const reportSuper = h => reportAs(h, 'super', 'superintendent');
const reportPM = h => reportAs(h, 'pm', 'PM');

async function reportMore(h) {
  // Review folder note on the report, fill and copy toasts, the empty report.
  let p = await h.open({ role: 'super', reports: {}, tasks: [], settings: { folderUrl: 'https://script.google.com/macros/s/ZQabc/exec' }, hash: `#report/${TODAY}`, folder: 'ok' });
  await openAll(p);
  await h.snap(p, 'Daily report, empty, with the review folder set');
  await click(p, '[data-act=menu]'); await click(p, 'dialog [data-act=fill]'); await h.after(p, 'Daily report, empty, with the review folder set'); // no task sheets
  await click(p, '[data-act=menu]'); await click(p, 'dialog [data-act=carry]'); await h.after(p, 'Daily report, empty, with the review folder set'); // no earlier report
  await peek(h, p, '[data-act=menu]', 'Report menu, with the review folder set');
  await p.fill('[data-k="r.results"]', 'ZQresults'); await click(p, '[data-act=set][data-k="r.status"][data-v="On plan"]');
  await click(p, '[data-act=send]'); await p.waitForSelector('dialog .linkbox'); await h.after(p, 'Share sheet: daily report (empty)', { office: true }); await esc1(p);
  await nav(p, `#report/${YEST}`); await h.snap(p, 'Daily report, another day');
  // Fill from one task sheet, then from several (singular and plural), with a sheet that has no crew.
  p = await h.open({ role: 'super', reports: {}, tasks: [task()], hash: `#report/${TODAY}` });
  await click(p, '[data-act=menu]'); await click(p, 'dialog [data-act=fill]'); await h.after(p, 'Daily report, after Fill from task sheets (one sheet)'); await openAll(p); await h.snap(p, 'Daily report, after Fill from task sheets (one sheet)');
  p = await h.open({ role: 'super', reports: {}, tasks: boardTasks('mine'), hash: `#report/${TODAY}` });
  await click(p, '[data-act=menu]'); await click(p, 'dialog [data-act=fill]'); await h.after(p, 'Daily report, after Fill from task sheets (several sheets)'); await openAll(p); await h.snap(p, 'Daily report, after Fill from task sheets (several sheets)');
  // Copy from the last report.
  p = await h.open({ role: 'super', reports: { [YEST]: report({ date: YEST }) }, tasks: [], hash: `#report/${TODAY}` });
  await click(p, '[data-act=menu]'); await click(p, 'dialog [data-act=carry]'); await h.after(p, 'Daily report, after Copy from last report');
}

async function openedLinks(h) {
  const q = (o) => h.open({ hash: `#day/${TODAY}`, ...o });
  // The superintendent receives crew results (with and without a crew name), an older copy, a day plan.
  let p = await q({ role: 'super', tasks: [task({ uid: 'zqres', origin: 'mine', id: 'T1014-51', resultAt: 0 })] });
  const res = (t) => h.link(p, { v: 1, kind: 'result', pin: PIN_HASH, task: t });
  await nav(p, '#p=' + await res(task({ uid: 'zqres', id: 'T1014-51', resultAt: TS, status: 'Partial' }))); await h.after(p, 'Link: crew results received');
  await nav(p, '#p=' + await res(task({ uid: 'zqres', id: 'T1014-51', resultAt: TS - 5000 }))); await h.after(p, 'Link: older results');
  await nav(p, '#p=' + await res(task({ uid: 'zqres2', id: 'T1014-52', crew: '', resultAt: TS }))); await h.after(p, 'Link: crew results received, no crew name');
  await nav(p, '#p=' + await h.link(p, { v: 1, kind: 'task', pin: PIN_HASH, task: { uid: '' } })); await h.after(p, 'Link: no task sheet in it');
  await nav(p, '#p=' + await h.link(p, { v: 1, kind: 'day', pin: PIN_HASH, date: TOMO, tasks: [task({ uid: 'zqd1', id: 'T1015-01', date: TOMO }), task({ uid: 'zqres', id: 'T1014-51', date: TOMO })] }));
  await p.waitForSelector('dialog .ask'); await h.snap(p, 'Load the task plan ask'); await click(p, 'dialog [data-a="1"]'); await h.after(p, 'Link: task plan loaded');
  // A crew phone: a re-sent sheet that is older than the one it has.
  p = await q({ role: 'crew', tasks: [task({ uid: 'zqc1', origin: 'link', id: 'T1014-53', sentAt: TS })] });
  await nav(p, '#p=' + await h.link(p, { v: 1, kind: 'task', pin: PIN_HASH, task: task({ uid: 'zqc1', id: 'T1014-53', sentAt: TS - 9000 }) })); await h.after(p, 'Link: older sheet on a crew phone');
  // Reports reach the PM and the superintendent.
  p = await q({ role: 'pm', reports: { [TODAY]: report({ updatedAt: TS - 1000 }) } });
  await nav(p, '#p=' + await h.link(p, { v: 1, kind: 'report', from: 'Superintendent', pin: PIN_HASH, report: report({ updatedAt: TS }) })); await h.after(p, 'Link: report from the superintendent, to the PM');
  p = await q({ role: 'super', reports: { [TODAY]: report({ updatedAt: TS - 1000 }) } });
  await nav(p, '#p=' + await h.link(p, { v: 1, kind: 'report', from: 'Project manager', pin: PIN_HASH, report: report({ updatedAt: TS }) })); await h.after(p, 'Link: PM answers, to the superintendent');
  await nav(p, '#p=' + await h.link(p, { v: 1, kind: 'report', from: 'Superintendent', pin: PIN_HASH, report: report({ updatedAt: TS + 1 }) }));
  await p.waitForSelector('dialog .ask'); await h.snap(p, 'Replace your copy of the report ask'); await click(p, 'dialog [data-a="1"]'); await h.after(p, 'Link: report replaced');
  p = await q({ role: 'super' });
  await nav(p, '#p=' + await h.link(p, { v: 1, kind: 'report', from: 'Superintendent', pin: PIN_HASH, report: report() })); await h.after(p, 'Link: report loaded');
  await nav(p, '#p=' + await h.link(p, { v: 1, kind: 'report', from: 'Superintendent', pin: PIN_HASH, report: {} })); await h.after(p, 'Link: no report in it');
}

async function openedHoursLinks(h) {
  const pm = await h.open({ role: 'pm', crewHours: [shift({ who: 'ZQRay', date: TODAY, device: '', in: '07:00', out: '15:00', edited: { who: true, in: true, out: true } })], hash: `#clock/${TODAY}` });
  const hours = shifts => h.link(pm, { v: 1, kind: 'hours', at: TS, shifts });
  const fresh = [shift({ id: 'zsh1', who: 'ZQJose', date: TODAY, device: 'zqdev9' })];
  await nav(pm, '#p=' + await hours(fresh)); await h.after(pm, 'Link: hours from a worker, new');
  await nav(pm, '#p=' + await hours(fresh)); await h.after(pm, 'Link: hours from a worker, already logged');
  await nav(pm, '#p=' + await hours([{ ...fresh[0], out: '16:00' }])); await h.after(pm, 'Link: hours from a worker, updated');
  await nav(pm, '#p=' + await hours([shift({ id: 'zsh2', who: 'ZQRay', date: TODAY, device: 'zqdev8' })])); await h.after(pm, 'Link: hours from a worker, already added by hand');
  await nav(pm, '#p=' + await hours([])); await h.after(pm, 'Link: no hours in it');
  await nav(pm, '#p=' + await hours([shift({ id: 'zsh3', who: '', date: TODAY, device: 'zqdev7' })])); await h.after(pm, 'Link: hours from a worker, no name');
  const w = await h.open({ role: 'worker', hash: `#clock/${TODAY}` });
  await nav(w, '#p=' + await h.link(w, { v: 1, kind: 'hours', at: TS, shifts: fresh })); await h.after(w, 'Link: hours link on a worker phone');
}

// People and crews with ids: the Settings people editor, its questions, and the same name on two people.
const IDCREWS = CREWS.map((c, i) => ({ ...c, id: 'zqc' + 'abcd'[i] }));
const ROSTER = [['zqp1', 'ZQJose', 'zqca'], ['zqp2', 'ZQLuis', 'zqca'], ['zqp3', 'ZQJose', 'zqcb'], ['zqp4', 'ZQAna', 'zqcb'], ['zqp5', 'ZQLoose', '']].map(([id, name, crewId]) => ({ id, name, crewId }));
async function peopleEditor(h) {
  const p = await h.open({ role: 'super', hash: '#settings', settings: { crews: IDCREWS, people: ROSTER } });
  await h.snap(p, 'Settings, people editor'); // chips, Add people, Not on a crew
  const add = async (i, name) => { await p.locator('input[data-enter=pAdd]').nth(i).fill(name); await click(p, `[data-act=pAdd][data-crew="${IDCREWS[i].id}"]`); };
  await add(2, 'zqana'); await p.waitForSelector('dialog .ask'); await h.snap(p, 'Add a person ask, a name on another crew');
  await click(p, 'dialog [data-a="1"]'); await h.after(p, 'Settings, people editor'); // moved
  await add(1, 'ZQAna'); await p.waitForSelector('dialog .ask'); await h.snap(p, 'Add a person ask, a name on another crew'); // her new crew
  await click(p, 'dialog [data-a="2"]'); await h.after(p, 'Settings, people editor'); // someone else
  await add(0, 'zqjose'); await p.waitForSelector('dialog .ask'); await h.snap(p, 'Add a person ask, a name already on this crew');
  await click(p, 'dialog [data-a="0"]');
  await add(0, 'ZQLoose'); await p.waitForSelector('dialog .ask'); await h.snap(p, 'Add a person ask, a name on no crew'); await click(p, 'dialog [data-a="0"]');
  await click(p, '[data-act=pEdit][data-pid=zqp2]'); await p.waitForSelector('dialog [data-move]'); await h.snap(p, 'Person sheet: rename or move');
  await p.fill('dialog [name=who]', ' , '); await click(p, 'dialog [data-save]'); await h.after(p, 'Person sheet: rename or move'); // type the name
  await click(p, 'dialog [data-move="zqcc"]'); await h.after(p, 'Settings, people editor');
  await click(p, '[data-act=pEdit][data-pid=zqp1]'); await click(p, 'dialog [data-act=pDel]'); await h.after(p, 'Settings, a person taken off the list, with Undo'); // Remove is in the person sheet
  await click(p, '[data-act=delCrew][data-i="3"]'); await h.after(p, 'Settings, a crew removed: its people on no crew');
}

// Two office phones numbered sheets offline: the warning on both, and an unsent sheet renumbered when one arrives.
async function sameNumbers(h) {
  const twins = [task({ uid: 'zqsame1', id: 'T1014-61' }), task({ uid: 'zqsame2', origin: 'link', id: 'T1014-61', crew: 'Crew B' })];
  let p = await h.open({ role: 'super', tasks: twins });
  await h.snap(p, 'Office board, two sheets with one number');
  await nav(p, '#task/zqsame1/assign'); await h.snap(p, 'Task sheet, same number as another (office)');
  await nav(p, '#task/zqsame2/assign'); await h.snap(p, 'Task sheet, same number as another (sent here)');
  p = await h.open({ role: 'crew', tasks: twins.map(t => ({ ...t, origin: 'link' })), hash: '#task/zqsame1/assign' });
  await h.snap(p, 'Crew task sheet, same number as another');
  const unsent = () => task({ uid: 'zqmine62', id: 'T1014-62', sentAt: 0, status: '', aStart: '', aStop: '', resultAt: 0 });
  const from = (o = {}) => task({ uid: 'zqother62', id: 'T1014-62', crew: 'Crew C', sentAt: TS, ...o });
  p = await h.open({ role: 'super', tasks: [unsent()], hash: `#day/${TODAY}` });
  await nav(p, '#p=' + await h.link(p, { v: 1, kind: 'task', pin: PIN_HASH, task: from({ status: '', aStart: '', aStop: '', resultAt: 0 }) })); await h.after(p, 'Link: a sheet with our unsent number');
  p = await h.open({ role: 'super', tasks: [unsent()], hash: `#day/${TODAY}` });
  await nav(p, '#p=' + await h.link(p, { v: 1, kind: 'result', pin: PIN_HASH, task: from() })); await h.after(p, 'Link: results with our unsent number');
  p = await h.open({ role: 'super', tasks: [unsent()], hash: `#day/${TODAY}` });
  await nav(p, '#p=' + await h.link(p, { v: 1, kind: 'day', pin: PIN_HASH, date: TODAY, tasks: [from()] }));
  await p.waitForSelector('dialog .ask'); await click(p, 'dialog [data-a="1"]'); await h.after(p, 'Link: a day plan with our unsent number');
}

// The same name on two people: the worker taps which one; the PM renames a timesheet to a name someone has.
async function sameNames(h) {
  const mine = task({ origin: 'link', uid: 'zqtwin', id: 'T1014-81', crew: 'Crew B', members: ['ZQJose'], memberIds: ['zqp3'] });
  const p = await h.open({ role: 'worker', tasks: [mine], hash: `#clock/${TODAY}`, settings: { crews: IDCREWS, people: ROSTER, worker: 'ZQJose' } });
  await h.snap(p, 'Time clock, two people with one name');
  await click(p, '[data-act=hWho][data-v=zqp3]'); await h.after(p, 'Time clock, two people with one name, one tapped');
  const hours = [shift({ who: 'ZQMara', date: TODAY, device: 'zqdev8' }), shift({ who: 'ZQAna', pid: 'zqp4', crew: 'Crew B', crewId: 'zqcb', date: TODAY, device: 'zqdev9' })];
  const q = await h.open({ role: 'pm', crewHours: hours, hash: `#clock/${TODAY}`, settings: { crews: IDCREWS, people: ROSTER } });
  for (const pick of ['1', '2']) {
    await click(q, '.person:has(h2:text-is("ZQMara")) [data-act=hRename]'); await q.waitForSelector('dialog [data-save]');
    await q.fill('dialog [name=who]', 'ZQana'); await click(q, 'dialog [data-save]'); await q.waitForSelector('dialog .ask');
    await h.snap(q, 'Rename ask, a name someone else has');
    await click(q, pick === '1' ? 'dialog [data-a="0"]' : 'dialog [data-a="2"]'); await h.after(q, 'Crew hours, two people with one name');
  }
}

async function hoursStorageFull(h) {
  const p = await h.open({ role: 'worker', hash: `#clock/${TODAY}` });
  await p.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
  await click(p, '[data-act=hTap]'); await h.after(p, 'Time clock, phone out of space', { office: true });
  const r = await h.open({ role: 'super', reports: { [TODAY]: report() }, hash: `#report/${TODAY}` });
  await openAll(r);
  await r.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
  await click(r, '[data-act=add][data-v=needs]'); await h.after(r, 'Daily report, phone out of space');
}

// ---------- the hub (live.mjs screens and the app's hub wiring) ----------

const OLD = '2026-08-05'; // older than the 60 days an office phone keeps: it stays on the hub only
// A PM phone's data on the hub: every kind of sheet, people on site (13, so the list folds), English crew notes to translate.
const hubData = () => {
  const sheets = boardTasks('mine').map((t, i) => ({ ...t, uid: 'zqh' + i, cLang: 'en', aLang: 'en' }));
  sheets[0].reply = 'ZQbringlift'; sheets[0].replyAt = TS; sheets[0].replyBy = 'ZQPat';
  const site = Array.from({ length: 13 }, (_, i) => shift({ id: 'zqsite' + i, who: 'ZQSite' + i, crew: ['Crew A', 'Crew B', ''][i % 3], date: TODAY, in: '07:00', out: '', device: 'zqdev' + i }));
  return { tasks: [...sheets, task({ uid: 'zqold', id: 'T0805-01', date: OLD, cLang: 'en', aLang: 'en' })], crewHours: [...crewShifts(), ...site, shift({ id: 'zqoldshift', who: 'ZQJose', date: OLD, in: '07:00', out: '15:00' })],
    reports: { [TODAY]: report({ lang: 'en' }), [YEST]: report({ date: YEST, status: 'On plan', pmReview: '' }), [OLD]: report({ date: OLD }) } };
};

async function hubSettings(h) {
  // No hub: the office phone's connect form and each thing it can say; a crew phone's hub page.
  const p = await h.open({ role: 'pm', hash: '#settings' });
  await h.snap(p, 'Settings, hub not connected');
  await click(p, '[data-act=hubConnect]'); await h.after(p, 'Settings, hub connect errors'); // both boxes first
  await p.fill('#hubUrl', 'https://example.com/ZQnope'); await p.fill('#hubKey', 'ZQkey'); await click(p, '[data-act=hubConnect]'); await h.after(p, 'Settings, hub connect errors');
  await p.fill('#hubUrl', HUBURL); await click(p, '[data-act=hubConnect]'); await h.after(p, 'Settings, hub connect errors');
  await p.fill('#hubKey', 'ZQ' + 'x'.repeat(30)); await click(p, '[data-act=hubConnect]'); await settle(p, 600); await h.after(p, 'Settings, hub connect errors'); // a key the hub does not know
  await p.fill('#hubKey', HUBKEYS.pm); await click(p, '[data-act=hubConnect]'); await settle(p, 800); await h.after(p, 'Settings, hub connected (PM)');
  await synced(p); await h.snap(p, 'Settings, hub connected (PM)');
  await click(p, '[data-act=hubTest]'); await p.waitForSelector('.checks li', { timeout: 20000 }); await h.snap(p, 'Settings, Test the hub');
  await click(p, '[data-act=hubSync]'); await settle(p, 800); await h.after(p, 'Settings, hub connected (PM)');
  await click(p, '[data-act=hubInvite][data-v=crew]'); await p.waitForSelector('dialog [data-crew]'); await h.snap(p, 'Invite crew: which crew');
  await click(p, 'dialog [data-crew="Crew A"]'); await p.waitForSelector('dialog .linkbox'); await h.snap(p, 'Share sheet: hub invite for a crew'); await esc1(p);
  await click(p, '[data-act=hubInvite][data-v=super]'); await p.waitForSelector('dialog .linkbox'); await h.snap(p, 'Share sheet: hub invite for the superintendent', { office: true }); await esc1(p);
  for (const v of ['crew', 'super']) { await click(p, `[data-act=hubRotate][data-v=${v}]`); await p.waitForSelector('dialog .ask'); await h.snap(p, 'Replace a hub key ask'); await click(p, 'dialog [data-a="0"]'); }
  await click(p, '[data-act=hubDisconnect]'); await p.waitForSelector('dialog .ask'); await h.snap(p, 'Disconnect from the hub ask'); await click(p, 'dialog [data-a="1"]'); await h.after(p, 'Settings, the PM key copied'); // the PM's: copy the key first
  const c = await h.open({ role: 'crew', hash: '#hub' });
  await h.snap(c, 'Hub page, crew phone, not connected');
  // The hub down, and a key it refuses: the status line, the dot and the message.
  const off = await h.open({ role: 'pm', hash: '#settings', hub: hubOf('pm'), hubMode: 'down', tasks: [task({ uid: 'zqoff1' })] });
  await synced(off); await h.snap(off, 'Settings, hub offline');
  await nav(off, '#live'); await h.snap(off, 'Live, offline');
  const bad = await h.open({ role: 'pm', hash: '#settings', hub: hubOf('pm', { hubKey: 'ZQ' + 'y'.repeat(30) }) });
  await synced(bad); await h.snap(bad, 'Settings, hub problem');
  await nav(bad, '#live'); await h.snap(bad, 'Live, hub problem');
}

async function liveBoard(h) {
  const p = await h.open({ role: 'pm', hash: '#live', hub: hubOf('pm'), ...hubData() });
  await synced(p); await synced(p, 900);
  await h.snap(p, 'Live, with data');
  await h.step('live: on site list', async () => { await click(p, '[data-act=liveSite]'); await h.snap(p, 'Live, everyone on site'); await click(p, '[data-act=liveSite]'); });
  await h.step('live: original text', async () => { await click(p, '.live-note [data-act=txToggle]'); await h.snap(p, 'Live, a note shown as typed'); });
  await h.step('live: message', async () => {
    await click(p, '[data-act=liveMsg][data-u=zqh0]'); await p.waitForSelector('dialog textarea'); await h.snap(p, 'Live, message to a crew');
    await click(p, 'dialog [data-send]'); await h.after(p, 'Live, message to a crew'); // type a message first
    await p.fill('dialog textarea', 'ZQmessage'); await click(p, 'dialog [data-send]'); await h.after(p, 'Live, message sent');
  });
  await h.step('live: review', async () => {
    await click(p, '[data-act=liveReview]'); await p.waitForSelector('dialog [data-r]'); await settle(p, 500); await h.snap(p, 'Live, review a sheet');
    await click(p, 'dialog [data-r="Follow-up needed"]:not([data-go-save])'); await h.snap(p, 'Live, review a sheet, follow-up');
    await p.fill('dialog textarea', 'ZQnext'); await click(p, 'dialog [data-go-save]'); await h.after(p, 'Live, review saved');
  });
  await h.step('live: refresh', async () => { await click(p, '[data-act=liveRefresh]'); await settle(p, 900); await h.after(p, 'Live, with data'); });
  const s = await h.open({ role: 'super', hash: '#live', hub: hubOf('super'), tasks: hubData().tasks });
  await synced(s); await h.snap(s, 'Live, superintendent');
  await h.step('a sheet the hub has: the superintendent cannot delete it', async () => {
    await nav(s, '#task/zqh0/assign'); await click(s, '#titleMore [data-act=taskMenu]'); await click(s, 'dialog [data-act=del]'); await h.after(s, 'Delete on the hub, superintendent');
  });
  const none = await h.open({ role: 'pm', hash: '#live', tasks: hubData().tasks.slice(0, 3) });
  await h.snap(none, 'Live, no hub');
  const empty = await h.open({ role: 'pm', hash: '#live', now: '2026-12-01T10:00:00Z' });
  await h.snap(empty, 'Live, no sheets and no hub');
}

async function recordsScreens(h) {
  const p = await h.open({ role: 'pm', hash: '#records/people', hub: hubOf('pm'), ...hubData() });
  await synced(p); await synced(p, 900);
  await h.snap(p, 'Records, by person');
  await p.fill('#recQ', 'zzzz'); await settle(p); await h.snap(p, 'Records, by person, no match'); await p.fill('#recQ', ''); await settle(p);
  await click(p, '[data-act=recPerson]'); await h.snap(p, 'Records, one person');
  await click(p, '[data-act=recOlder]'); await settle(p, 900); await h.snap(p, 'Records, one person, older hours from the hub');
  await click(p, '[data-act=recPerson][data-v=""]');
  await nav(p, '#records/sheets'); await h.snap(p, 'Records, task sheets');
  for (const v of ['review', 'Blocked', 'Accepted', 'Follow-up needed']) { await click(p, `[data-act=recFilter][data-f=status][data-v="${v}"]`); await h.snap(p, 'Records, task sheets, filtered'); }
  await click(p, '[data-act=recFilter][data-f=status][data-v=""]'); await click(p, '[data-act=recFilter][data-f=crew][data-v="Crew B"]'); await h.snap(p, 'Records, task sheets, filtered');
  await click(p, '[data-act=recFilter][data-f=crew][data-v=""]'); // all crews again: this phone's own sheets have no Crew B one, so the sheet menu below needs the filter off (else it waits on what earlier screens left on the hub)
  await p.fill('#recQ', 'zzzz'); await settle(p); await h.snap(p, 'Records, task sheets, no match'); await p.fill('#recQ', ''); await settle(p);
  await click(p, '[data-act=recOlder]'); await settle(p, 900); await openAll(p); await settle(p, 600); await h.snap(p, 'Records, older task sheets from the hub');
  await click(p, '.rec-more[data-kind=task]'); await p.waitForSelector('dialog [data-del]'); await h.snap(p, 'Records, sheet menu');
  await click(p, 'dialog [data-del]'); await p.waitForSelector('#toast .toast-undo'); await h.snap(p, 'Sheet deleted, with Undo, on the hub'); await click(p, '#toast .toast-undo'); // gone at once with Undo, no ask (DESIGN.md)
  await nav(p, '#records/reports'); await h.snap(p, 'Records, reports');
  await p.fill('#recQ', 'zzzz'); await settle(p); await h.snap(p, 'Records, reports, no match'); await p.fill('#recQ', ''); await settle(p);
  await click(p, '[data-act=recOlder]'); await settle(p, 900); await openAll(p); await h.snap(p, 'Records, older reports from the hub');
  await click(p, '.rec-more[data-kind=report]'); await p.waitForSelector('dialog [data-del]'); await h.snap(p, 'Records, report menu');
  await click(p, 'dialog [data-del]'); await p.waitForSelector('#toast .toast-undo'); await h.snap(p, 'Report deleted, with Undo, on the hub'); await click(p, '#toast .toast-undo');
  await click(p, '[data-act=recStats]'); await settle(p, 900); await h.snap(p, 'Records, hub storage');
  await p.fill('#recArch', TODAY); await click(p, '[data-act=recArchive]'); await h.after(p, 'Records, archive');
  await p.fill('#recArch', '2026-07-01'); await click(p, '[data-act=recArchive]'); await p.waitForSelector('dialog .ask'); await h.snap(p, 'Archive older records ask'); await click(p, 'dialog [data-a="0"]');
  await click(p, '[data-act=recExport]'); await h.after(p, 'Records, download all');
  // No hub: the same screens from this phone alone; empty; the superintendent's two.
  const local = await h.open({ role: 'pm', hash: '#records/people', ...hubData() });
  await h.snap(local, 'Records, no hub, by person');
  for (const sub of ['sheets', 'reports']) { await nav(local, '#records/' + sub); await h.snap(local, 'Records, no hub, ' + sub); }
  const empty = await h.open({ role: 'pm', hash: '#records/people' });
  for (const sub of ['people', 'sheets', 'reports']) { await nav(empty, '#records/' + sub); await h.snap(empty, 'Records, nothing on this phone'); }
  const sup = await h.open({ role: 'super', hash: '#records', hub: hubOf('super'), tasks: hubData().tasks, reports: hubData().reports });
  await synced(sup); await h.snap(sup, 'Records, superintendent');
  await nav(sup, '#records/reports'); await h.snap(sup, 'Records, superintendent');
}

async function joinScreens(h) {
  const p = await h.open({ role: 'crew' });
  const invite = o => h.link(p, { v: 1, kind: 'join', hub: { url: HUBURL, key: HUBKEYS.crew }, role: 'crew', ...o });
  await nav(p, '#p=' + await invite({ crew: 'Crew A' })); await p.waitForSelector('dialog [data-join]');
  await h.snap(p, 'Join sheet, crew');
  await click(p, 'dialog [data-join]'); await h.after(p, 'Join sheet, crew'); // type your name first
  await p.fill('dialog [name=who]', 'ZQJose'); await click(p, 'dialog [data-join]'); await settle(p, 900); await h.after(p, 'Joined the hub');
  await synced(p); await nav(p, '#day/2026-11-20'); await h.snap(p, 'Crew board on the hub, no sheets');
  await nav(p, '#hub'); await h.snap(p, 'Hub page, crew phone, connected');
  await nav(p, '#p=' + await h.link(p, { v: 1, kind: 'join', hub: { url: HUBURL, key: HUBKEYS.super }, role: 'super' })); await p.waitForSelector('dialog .ask');
  await h.snap(p, 'Join ask, already on a hub'); await click(p, 'dialog [data-a="0"]');
  const q = await h.open({ role: 'crew' });
  await nav(q, '#p=' + await invite({})); await q.waitForSelector('dialog [data-join]');
  await h.snap(q, 'Join sheet, crew to pick');
  await q.fill('dialog [name=who]', 'ZQAna'); await click(q, 'dialog [data-join]'); await h.after(q, 'Join sheet, crew to pick'); // pick your crew
  const r = await h.open({ role: 'crew' }); // a "they pick" invite carries the job's crews
  await nav(r, '#p=' + await invite({ crews: ['ZQLighting', 'ZQPower'] })); await r.waitForSelector('dialog [data-join]');
  await h.snap(r, 'Join sheet, crews from the invite');
  const n = await h.open({ role: 'crew' }); // a crew invite carries its people: a name to tap, and a typed one the list lacks is questioned once
  await nav(n, '#p=' + await invite({ crew: 'Crew A', people: [{ name: 'ZQAna', crew: 'Crew A' }, { name: 'ZQJose', crew: 'Crew A' }] })); await n.waitForSelector('dialog [data-who]');
  await h.snap(n, 'Join sheet, names from the invite');
  await n.fill('dialog [name=who]', 'ZQAnaRodriguez'); await click(n, 'dialog [data-join]'); await h.after(n, 'Join sheet, names from the invite'); // not on the crew list
  const own = await h.open({ role: 'pm', hub: hubOf('pm') }); // the PM opens the crew invite it just made
  await nav(own, '#p=' + await invite({ crew: 'Crew A' })); await h.after(own, 'Join: the PM phone opens its own invite');
  const s = await h.open({ role: 'super' });
  await nav(s, '#p=' + await h.link(s, { v: 1, kind: 'join', hub: { url: HUBURL, key: HUBKEYS.super }, role: 'super' })); await s.waitForSelector('dialog [data-join]');
  await h.snap(s, 'Join sheet, superintendent');
  const x = await h.open({ role: 'super' });
  await nav(x, '#p=' + await h.link(x, { v: 1, kind: 'join', hub: { url: HUBURL, key: 'ZQ' + 'z'.repeat(30) }, role: 'super' })); await x.waitForSelector('dialog [data-join]');
  await click(x, 'dialog [data-join]'); await settle(x, 900); await h.after(x, 'Join sheet, a key the hub does not know');
}

async function hubSheets(h) {
  // A crew sheet on the hub: the office's message and review on the brief, English typed text in Spanish.
  const ban = task({ origin: 'link', uid: 'zqban', id: 'T1014-91', aLang: 'en', cLang: 'en', reply: 'ZQreply', replyAt: TS, replyBy: 'ZQPat', review: 'Follow-up needed', reviewer: 'ZQDana', followUp: 'ZQfollow', status: 'Partial' });
  const ok = task({ origin: 'link', uid: 'zqban2', id: 'T1014-92', aLang: 'en', review: 'Accepted', reviewer: 'ZQDana', status: 'Complete' });
  const p = await h.open({ role: 'crew', hub: hubOf('crew'), tasks: [ban, ok], hash: '#task/zqban/assign' });
  await synced(p, 900); await h.snap(p, 'Crew sheet on the hub: message, review, translated text');
  await click(p, '.brief [data-act=txToggle]'); await h.snap(p, 'Crew sheet on the hub, as typed');
  await nav(p, '#task/zqban2/assign'); await synced(p, 600); await h.snap(p, 'Crew sheet on the hub, accepted');
  // The office: the crew's English words on the Review and Crew results tabs, the report's previews.
  const mine = task({ uid: 'zqoff', id: 'T1014-93', cLang: 'en', aLang: 'en' });
  const o = await h.open({ role: 'super', hub: hubOf('super'), tasks: [mine], reports: { [TODAY]: report({ lang: 'en' }) }, hash: '#task/zqoff/review' });
  await synced(o, 900); await h.snap(o, 'Review tab on the hub, crew words translated');
  await nav(o, '#task/zqoff/results'); await settle(o, 900); await h.snap(o, 'Crew results on the hub, translated previews');
  await o.fill('[data-k="t.doneText"]', 'ZQtyped'); await settle(o, 1500); await h.snap(o, 'Crew results on the hub, translated previews');
  await nav(o, `#report/${TODAY}`); await openAll(o); await settle(o, 900); await h.snap(o, 'Daily report on the hub, translated previews');
  // The time clock: through the hub when it answers, the text when it does not.
  const w = await h.open({ role: 'worker', hub: hubOf('crew'), hash: `#clock/${TODAY}` });
  await synced(w); await h.snap(w, 'Time clock on the hub');
  await click(w, '[data-act=hTap]'); await h.after(w, 'Time clock on the hub', { office: true }); // were the hub slow, the text to the PM (English by design)
  const wd = await h.open({ role: 'worker', hub: hubOf('crew'), hubMode: 'down', hash: `#clock/${TODAY}` });
  await synced(wd); await click(wd, '[data-act=hTap]'); await wd.waitForSelector('dialog .linkbox'); await h.snap(wd, 'Share sheet: hours to the PM, no signal for the hub', { office: true });
  // Translation used up, and no signal for it.
  const qp = await h.open({ role: 'crew', hub: hubOf('crew'), hubMode: 'quota', tasks: [ban], hash: '#task/zqban/assign' });
  await settle(qp, 1200); await h.after(qp, 'Crew sheet on the hub, translation used up');
  const dn = await h.open({ role: 'crew', hub: hubOf('crew'), hubMode: 'down', tasks: [ban], hash: '#task/zqban/assign' });
  await synced(dn, 1200); await nav(dn, '#task/zqban2/assign'); await nav(dn, '#task/zqban/assign'); await settle(dn, 1200); await h.after(dn, 'Crew sheet on the hub, no signal');
}

const SCREENS = [
  ['Crew board, empty', crewBoardEmpty],
  ['Crew board, with sheets', crewBoardSheets],
  ['Crew board, filtered to a crew with none', crewBoardFilterNone],
  ['Crew task sheets', crewTaskScreens],
  ['Office board', officeBoard],
  ['Office board, nothing open, new task', officeBoardNothingOpen],
  ['Task sheet tabs, menus, asks, share', officeTask],
  ['Share sheet, long link', longLink],
  ['Task sheet with the review folder', officeTaskWithFolder],
  ['Settings', settingsScreen],
  ['Settings, PM phone', settingsEmpty],
  ['Language chooser', languageChooser],
  ['Language sheet, older phone', olderPhoneLanguage],
  ['Crew member phone', crewMemberPhone],
  ['Header and tabs', officeHeaderAndTabs],
  ['Passcode pad, create', passcodeCreate],
  ['Passcode pad, enter', passcodeEnter],
  ['Passcode pad, change', passcodeChange],
  ['Time clock (worker)', timeClockWorker],
  ['Crew hours (PM)', crewHoursPM],
  ['Crew hours variants', crewHoursVariants],
  ['People: worker, Today card, crew view', rosterWorker],
  ['People: crew hours and crew lists', rosterPM],
  ['Daily report (superintendent)', reportSuper],
  ['Daily report (PM)', reportPM],
  ['Daily report, fill, copy, empty', reportMore],
  ['Opened links', openedLinks],
  ['Opened hours links', openedHoursLinks],
  ['Storage full', hoursStorageFull],
  ['People editor in Settings', peopleEditor],
  ['Two sheets with one number', sameNumbers],
  ['Two people with one name', sameNames],
  ...(HUB ? [ // only once the hub is wired into the app (see the top of this file)
    ['Hub settings, connect, invite, states', hubSettings],
    ['Live board', liveBoard],
    ['Records: people, sheets, reports', recordsScreens],
    ['Join links', joinScreens],
    ['Sheets, report and clock on the hub', hubSheets],
  ] : []),
];

// ---------------------------------------------------------------------------------------------
// Run and report.
// ---------------------------------------------------------------------------------------------
(async () => {
  if (process.argv.includes('--list')) { SCREENS.forEach(([n]) => console.log(n)); return; }
  selfTest();
  const es = await (await fetch(BASE + 'es.mjs')).text();
  const ES = (await import('data:text/javascript;base64,' + Buffer.from(es).toString('base64'))).default;
  build(ES);
  if (HUB) try { // the hub screens' keys; their screens fail (never pass) if the local hub is not running
    HUBKEYS = await (await fetch(HUBDEV + '__reset', { method: 'POST' })).json();
    await fetch(HUBDEV + '__clock', { method: 'POST', body: JSON.stringify({ real: true }) });
    await fetch(HUBDEV + '__clock', { method: 'POST', body: JSON.stringify({ advance: Date.parse(NOW) - Date.now() }) }); // the hub's day is the audit's day
  } catch { console.error(`The local hub is not answering at ${HUBDEV}. The hub screens will fail.`); HUBKEYS = {}; }
  const browser = await chromium.launch();
  const todo = SCREENS.map(([name, fn], order) => ({ name, fn, order })).filter(s => !ONLY || s.name.toLowerCase().includes(ONLY));
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const { name, fn, order } = todo[next++], h = makeHarness(browser, order);
      try { await fn(h); } catch (e) { crashes.push({ screen: name, error: String(e.message || e).split('\n').slice(0, 3).join(' ').replace(/\s+/g, ' ') }); } finally { await h.close(); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  await browser.close();

  // Judge every string.
  const bad = [], tally = new Map();
  for (const f of found) {
    const row = tally.get(f.screen) || { order: f.order, checked: 0, es: 0, typed: 0, allow: 0, neutral: 0, bad: 0 };
    tally.set(f.screen, row);
    row.checked++;
    if (f.forced) { row.bad++; bad.push({ ...f, words: [] }); continue; }
    const a = analyse(f.text);
    if (a.bad.length) { row.bad++; bad.push({ ...f, words: [...new Set(a.bad)] }); }
    else row[a.via.has('es') ? 'es' : a.via.has('typed') ? 'typed' : a.via.has('allow') ? 'allow' : 'neutral']++;
  }
  // Crew-facing message previews hold a Spanish line next to the English one.
  const msgBad = [];
  for (const m of messages.filter(m => !m.office)) {
    const blocks = m.text.split(/\n\s*\n/).filter(Boolean);
    if (!blocks.some(b => !analyse(b).bad.length)) msgBad.push(m);
  }
  for (const m of msgBad) bad.push({ screen: m.screen, kind: 'message', text: m.text, words: ['(no Spanish line in the message)'], order: 999 });

  if (process.argv.includes('--dump')) { // every string and how it was accounted for, for checking the audit itself
    for (const f of found) { const a = analyse(f.text); console.log(`${f.screen} | ${a.bad.length ? 'BAD ' : [...a.via].join('+') || 'num'} | [${f.kind}] ${f.text}`); }
  }
  // Coverage by source: every literal L('...') key in the app's own files, seen on some screen in English or Spanish?
  const srcKeys = new Set(['Complete', 'Partial', 'Blocked', 'Accepted', 'Follow-up needed', 'Superintendent', 'Project manager']); // looked up from data (see the repo test)
  const FILES = ['tasks.html', 'shared.mjs', 'report.mjs', ...(HUB ? ['sync.mjs', 'live.mjs'] : [])];
  for (const f of FILES) {
    const src = await (await fetch(BASE + f)).text();
    for (const m of src.matchAll(/\b(?:L|x)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g)) srcKeys.add(m[2].replace(/\\(.)/g, '$1'));
  }
  const corpus = [...new Set([...found.map(f => norm(f.text)), ...messages.flatMap(m => m.text.split(/\n+/).map(norm))])];
  // A key is seen if some string holds it as whole words, in English or Spanish. Keys with almost no fixed words ("{n} h") fit anything, so they are skipped.
  const fits = t => {
    const parts = norm(t).split(/\{\w+\}/), fixed = parts.join('').length;
    if (parts.length > 1 && fixed < 4) return null;
    const body = parts.map(esc).join('[\\s\\S]+?');
    return new RegExp(`(?<!${WORD})${body}(?!${WORD})`, 'u');
  };
  const testable = [...srcKeys].filter(k => fits(k));
  const keyUnseen = testable.filter(k => { const res = [fits(k), ES[k] && fits(ES[k])].filter(Boolean); return !corpus.some(c => res.some(r => r.test(c))); });
  const rows = [...tally.entries()].sort((a, b) => a[1].order - b[1].order);
  console.log(`\nSpanish audit of ${BASE}   (${ES && Object.keys(ES).length} phrases in es.mjs)\n`);
  console.log('screen'.padEnd(66), 'strings'.padStart(8), 'es'.padStart(5), 'typed'.padStart(6), 'allow'.padStart(6), 'num'.padStart(5), 'UNTRANSLATED'.padStart(13));
  for (const [screen, r] of rows) console.log(screen.slice(0, 65).padEnd(66), String(r.checked).padStart(8), String(r.es).padStart(5), String(r.typed).padStart(6), String(r.allow).padStart(6), String(r.neutral).padStart(5), String(r.bad || '').padStart(13));
  const grouped = new Map();
  for (const b of bad) { if (!grouped.has(b.screen)) grouped.set(b.screen, []); grouped.get(b.screen).push(b); }
  if (bad.length) {
    console.log('\nUNTRANSLATED, by screen\n');
    for (const [screen, list] of [...grouped.entries()].sort((a, b) => (tally.get(a[0])?.order ?? 999) - (tally.get(b[0])?.order ?? 999))) {
      console.log(`== ${screen}  (${list.length})`);
      for (const b of list) console.log(`   [${b.kind}] ${JSON.stringify(b.text)}${b.words.length && b.words.join(' ') !== b.text ? `   <- ${b.words.slice(0, 8).join(' ')}` : ''}`);
    }
  }
  const spanish = [...new Set(PATTERNS.map(p => p.es))].filter(t => fits(t));
  const unseen = spanish.filter(t => !corpus.some(c => fits(t).test(c)));
  console.log(`\nCOVERAGE: ${spanish.length - unseen.length} of ${spanish.length} Spanish phrases in es.mjs appeared on a screen.`);
  if (unseen.length) console.log('Never seen on any screen (a screen or state this audit does not reach, or a phrase that is unused):\n' + unseen.map(t => '   ' + JSON.stringify(t)).join('\n'));
  console.log(`SOURCE COVERAGE: ${testable.length - keyUnseen.length} of ${testable.length} L('...') keys in ${FILES.join(', ')} appeared on a screen (in either language).`);
  if (keyUnseen.length) console.log('Never seen (a screen or state this audit does not reach, or text used only in a PDF or message):\n' + keyUnseen.map(k => '   ' + JSON.stringify(k)).join('\n'));
  if (messages.length) console.log(`\nMESSAGE PREVIEWS (${messages.filter(m => m.office).length} English by design, not counted; ${messages.filter(m => !m.office).length} crew-facing, checked for a Spanish line).`);
  if (pageErrors.length) console.log('\nPAGE ERRORS (not counted):\n' + [...new Set(pageErrors)].map(e => '   ' + e).join('\n'));
  if (crashes.length) console.log('\nSCREENS NOT VISITED (the audit itself failed, so the result is incomplete):\n' + crashes.map(c => `   ${c.screen}: ${c.error}`).join('\n'));
  const distinct = new Set(bad.map(b => b.text)).size;
  console.log(`\n${bad.length ? 'FAIL' : 'PASS'}: ${bad.length} untranslated strings (${distinct} distinct) on ${grouped.size} of ${rows.length} screens; ${found.length} strings checked; ${crashes.length} steps failed.`);
  fs.writeFileSync(OUT_JSON, JSON.stringify({ base: BASE, keysUnseen: keyUnseen, untranslated: bad, crashes, strings: found.length, screens: rows.map(([s, r]) => ({ screen: s, ...r })), unseen }, null, 1));
  process.exitCode = crashes.length ? 2 : bad.length ? 1 : 0;
})().catch(e => { console.error('AUDIT CRASHED', e); process.exit(2); });
