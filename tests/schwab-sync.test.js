#!/usr/bin/env node
// The hub sync engine (docs/schwab/sync.mjs) against a small in-process fake hub that applies the rules in
// docs/schwab/HUB.md. The fake is written here, independent of hub/Code.gs, so a misreading on either side shows up.

process.env.TZ = 'America/New_York'; // the job's zone; the real hub's hours math (and its test double) require it, and the dates below are local days

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const lib = import('../docs/schwab/shared.mjs');
const syncLib = import('../docs/schwab/sync.mjs');

const KEYS = { crew: 'c'.repeat(32), super: 's'.repeat(32), pm: 'p'.repeat(32) };
const URL_A = 'https://script.google.com/macros/s/AKfycbTEST/exec';
const T0 = new Date(2026, 9, 19, 12, 0, 0).getTime(); // local noon, so every date below is the same local day the engine computes
const pad = n => String(n).padStart(2, '0');
const dayOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const DAY = dayOf(T0);
const ago = days => { const d = new Date(T0); d.setDate(d.getDate() - days); return dayOf(d.getTime()); };
const settle = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const clone = x => JSON.parse(JSON.stringify(x));
const O_KEYS = ['id', 'date', 'by', 'floor', 'area', 'crew', 'crewId', 'members', 'memberIds', 'size', 'scope', 'refs', 'allot', 'allotNote', 'est', 'estNote', 'pStart', 'pStop', 'checkIn', 'review', 'reviewer', 'followUp', 'reply', 'replyAt', 'replyBy', 'aLang', 'aLangs', 'sentAt'];
const C_KEYS = ['lead', 'aStart', 'aStop', 'delay', 'status', 'doneText', 'remain', 'comments', 'cLang', 'cLangs', 'resultAt'];
// A phone is its device secret; the device id is the first 32 hex characters of its SHA-256 (HUB.md, Identity).
const devOf = secret => (typeof secret === 'string' && /^[A-Za-z0-9]{32}$/.test(secret) ? nodeCrypto.createHash('sha256').update(secret).digest('hex').slice(0, 32) : '');
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const newSecret = () => Array.from(nodeCrypto.randomBytes(32), b => ALNUM[b % 62]).join('');
// What shared.mjs ensureDevice does, in a phone's own storage: makes the secret once and answers the id.
const ensureIn = storage => async () => { let d = storage.get('schwab.device'); if (!d?.secret) storage.set('schwab.device', d = { secret: newSecret(), id: '' }); if (d.id !== devOf(d.secret)) storage.set('schwab.device', d = { ...d, id: devOf(d.secret) }); return d.id; };

// ---------- the fake hub ----------

class FakeHub {
  constructor(clock) {
    Object.assign(this, { clock, rev: 0, tasks: new Map(), shifts: new Map(), reports: new Map(), config: null, tomb: [], events: [], calls: [], violations: [], down: false, offset: 0, fail: null, before: null, ignoreDays: false, tr: [], quotaAfter: Infinity, rejectIf: null });
    this.keys = { ...KEYS };
  }
  now() { return this.clock() + this.offset; }
  roleOf(key) { return Object.keys(this.keys).find(r => this.keys[r] === key) || null; }
  fetch = async (url, init) => {
    if (this.down) throw new TypeError('network down');
    const req = JSON.parse(init.body);
    this.calls.push({ url, init, action: req.action, body: clone(req) });
    await this.before?.(req);
    if (this.down) throw new TypeError('network down');
    const rep = this.fail?.(req) || this.handle(req);
    return { ok: true, status: 200, json: async () => clone(rep) };
  };
  count(action) { return this.calls.filter(c => c.action === action).length; }
  err(error) { return { ok: false, error, message: 'hub says: ' + error }; }
  handle(req) {
    const role = this.roleOf(req.key);
    if (!role) return this.err('unauthorized');
    if ('dev' in req) this.violations.push(`${req.action} named a device`); // the phone proves itself with its secret, never says who it is
    const dev = devOf(req.devSecret), A = req.action === 'keys' ? this.keysAction : this[req.action];
    if (typeof A !== 'function' || ['handle', 'fetch', 'bump', 'now', 'roleOf', 'err', 'count'].includes(req.action)) return this.err('bad_request');
    return A.call(this, role, dev, req);
  }
  bump() { return ++this.rev; }
  whoami(role) { return { ok: true, role, rev: this.rev, now: this.now(), tz: 'America/New_York', version: 1, ...(role === 'pm' && { sheetUrl: 'https://docs.google.com/spreadsheets/d/x' }) }; }
  keysAction(role) { return role === 'pm' ? { ok: true, crew: this.keys.crew, super: this.keys.super } : this.err('forbidden'); }
  stats(role) { return role === 'pm' ? { ok: true, rows: { tasks: 3 }, cells: 1, cellLimit: 10e6, sheetUrl: 'https://docs.google.com/spreadsheets/d/abc/edit' } : this.err('forbidden'); }
  rotate(role, dev, req) { if (role !== 'pm') return this.err('forbidden'); this.keys[req.role] = (req.role === 'crew' ? 'n' : 'm').repeat(32); return { ok: true, key: this.keys[req.role] }; }
  records(role, dev, req) { return role === 'crew' ? this.err('forbidden') : { ok: true, items: [{ kind: req.kind }], cursor: '' }; }
  selftest(role) { return role === 'pm' ? { ok: true, checks: [{ name: 'write', ok: true }] } : this.err('forbidden'); }
  archive(role, dev, req) { return role === 'pm' ? { ok: true, sheetUrl: 'https://evil.example/phish', moved: { tasks: 4 } } : this.err('forbidden'); }
  purge(role, dev, req) {
    if (role !== 'pm') return this.err('forbidden');
    const map = { task: this.tasks, report: this.reports, shift: this.shifts }[req.kind.replace(/s$/, '')];
    if (!map || !map.delete(req.target)) return this.err('bad_request');
    const rev = this.bump();
    this.tomb.push({ kind: req.kind.replace(/s$/, '') + 's', key: req.target, rev });
    return { ok: true, rev };
  }
  translate(role, dev, req) {
    this.tr.push(req.items.length);
    if (this.tr.length > this.quotaAfter) return this.err('quota');
    if (req.items.length > 25 || req.items.some(t => typeof t !== 'string' || t.length > 2000)) return this.err('bad_request');
    return { ok: true, items: req.items.map(t => (req.to === 'es' ? '~' : '^') + t) };
  }
  clamp(at) { at = Math.floor(num(at)); return at > this.now() + 5 * 60e3 ? this.now() : at; }

  // tasks: a record keeps the assign part (a, items, aAt) and the crew part (c, ticks, cAt) apart, as HUB.md says
  taskView(r) {
    const tick = (l, id) => r.ticks[l][id] || { done: false, at: 0 };
    return { uid: r.uid, ...r.a, ...r.c, assignAt: r.aAt, crewAt: r.cAt, rev: r.rev,
      items: r.items.map(i => ({ ...i, ...tick('items', i.id) })), checks: r.checks.map(i => ({ ...i, ...tick('checks', i.id) })) };
  }
  pushTask(role, w) {
    if (!/^[\w-]{1,40}$/.test(w.uid || '') || !/^\d{4}-\d{2}-\d{2}$/.test(w.date || '')) return { key: /^[\w-]{1,40}$/.test(w.uid || '') ? w.uid : '', status: 'rejected', reason: 'invalid' };
    if (this.rejectIf?.(w)) return { key: w.uid, status: 'rejected', reason: 'invalid' };
    if (this.tomb.some(t => t.kind === 'tasks' && t.key === w.uid)) return { key: w.uid, status: 'rejected', reason: 'deleted' };
    if (JSON.stringify(w).length > 45000) return { key: w.uid, status: 'rejected', reason: 'too_large' };
    const sentOffice = O_KEYS.some(k => k !== 'date' && k in w) || arrOf(w.items).concat(arrOf(w.checks)).some(i => 'text' in i);
    if (role === 'crew' && sentOffice) this.violations.push(`crew ${w.uid} sent office fields`);
    const office = role !== 'crew';
    let r = this.tasks.get(w.uid), applied = false;
    if (!r) {
      if (!office) return { key: w.uid, status: 'rejected', reason: 'forbidden' };
      r = { uid: w.uid, rev: 0, a: {}, c: {}, items: [], checks: [], ticks: { items: {}, checks: {} }, aAt: 0, cAt: 0 };
      this.tasks.set(w.uid, r);
      r.fresh = true;
    }
    if (office && (r.fresh || this.clamp(w.assignAt) >= r.aAt)) {
      r.a = Object.fromEntries(O_KEYS.map(k => [k, w[k] ?? (k === 'date' ? w.date : undefined)]));
      r.items = arrOf(w.items).map(i => ({ id: i.id, text: i.text })); r.checks = arrOf(w.checks).map(i => ({ id: i.id, text: i.text }));
      r.aAt = this.clamp(w.assignAt); applied = true;
    }
    const newer = office ? this.clamp(w.crewAt) > r.cAt : this.clamp(w.crewAt) >= r.cAt, b = !r.fresh && num(w.crewAt) > 0 && w.crewBase; // the office needs a strictly newer stamp: a tie never wipes crew results
    if (b) { // crewBase: only what the phone changed since it goes in; a value both sides changed goes to the newer stamp
      const j = JSON.stringify, take = (mine, was, cur) => j(mine) !== j(was) && (newer || j(cur) === j(was));
      for (const k of C_KEYS) if (take(w[k], b[k], r.c[k])) { r.c[k] = w[k]; applied = true; }
      for (const l of ['items', 'checks']) for (const i of arrOf(w[l])) {
        const was = arrOf(b[l]).find(x => x.id === i.id) || { done: false, at: 0 }, cur = r.ticks[l][i.id] || { done: false, at: 0 };
        if (take([!!i.done, num(i.at)], [!!was.done, num(was.at)], [cur.done, cur.at])) { r.ticks[l][i.id] = { done: !!i.done, at: num(i.at) }; applied = true; }
      }
      if (this.clamp(w.crewAt) > r.cAt) { r.cAt = this.clamp(w.crewAt); applied = true; }
    } else if (newer) {
      r.c = Object.fromEntries(C_KEYS.map(k => [k, w[k]]));
      for (const l of ['items', 'checks']) r.ticks[l] = Object.fromEntries(arrOf(w[l]).map(i => [i.id, { done: !!i.done, at: num(i.at) }]));
      r.cAt = this.clamp(w.crewAt); applied = true;
    }
    delete r.fresh;
    if (applied) r.rev = this.bump();
    return { key: w.uid, status: 'ok', task: this.taskView(r) };
  }
  // shifts: worker rules for the phone the device secret proves (its device is forced), PM rules for the pm key
  pushShift(role, dev, w) {
    if (!/^[\w-]{1,40}$/.test(w.id || '') || !/^\d{4}-\d{2}-\d{2}$/.test(w.date || '') || !/^\d\d:\d\d/.test(w.in || '')) return { key: w.id, status: 'rejected', reason: 'invalid' };
    if (this.tomb.some(t => t.kind === 'shifts' && t.key === w.id)) return { key: w.id, status: 'rejected', reason: 'deleted' };
    const cur = this.shifts.get(w.id), plain = dev && w.device === dev && !w.gone && !(w.edited && (w.edited.who || w.edited.in || w.edited.out));
    if (role !== 'pm' || plain) {
      if (!dev) return { key: w.id, status: 'rejected', reason: 'device' };
      if (!w.device) return { key: w.id, status: 'rejected', reason: 'forbidden' };
      if (cur && cur.device !== dev) return { key: w.id, status: 'rejected', reason: 'device' };
      if (!cur) {
        this.shifts.set(w.id, { ...w, device: dev, edited: { who: false, in: false, out: false }, gone: false, rev: this.bump() }); // kept even over a day the PM added by hand
      } else if (!cur.gone) {
        const before = JSON.stringify(cur);
        if (num(w.at) > num(cur.at) && !cur.edited.who) { cur.who = w.who; cur.at = w.at; }
        if (!cur.edited.in) cur.in = w.in;
        if (!cur.edited.out && w.out) cur.out = w.out;
        if (!(cur.edited.who || cur.edited.in || cur.edited.out)) Object.assign(cur, { pid: w.pid, crew: w.crew, crewId: w.crewId, tasks: w.tasks });
        if (JSON.stringify(cur) !== before) cur.rev = this.bump();
      }
    } else { // PM rules: as sent, but a shift never changes phones and a clock-out is not erased by a phone that has not pulled it
      const s = { ...w, rev: this.bump() };
      if (cur) { s.device = cur.device; if (!s.out && !s.edited.out && cur.out) s.out = cur.out; s.at = Math.max(num(cur.at), num(w.at)); }
      this.shifts.set(w.id, s);
    }
    return { key: w.id, status: 'ok', shift: clone(this.shifts.get(w.id)) };
  }
  pushReport(role, w) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w.date || '')) return { key: '', status: 'rejected', reason: 'invalid' };
    const pm = role === 'pm', inc = { ...w, decisions: arrOf(w.decisions).map(d => ({ q: d.q || '', rec: d.rec || '', by: d.by || '', pm: d.pm || '', pmNote: d.pmNote || '' })), updatedAt: this.clamp(w.updatedAt), pmAt: this.clamp(w.pmAt), pmReview: w.pmReview || '' };
    let r = this.reports.get(w.date), applied = false;
    if (!r) this.reports.set(w.date, r = { date: w.date, decisions: [], updatedAt: 0, pmAt: 0, pmReview: '', rev: 0, fresh: true });
    if (r.fresh || (pm ? inc.updatedAt > r.updatedAt : inc.updatedAt >= r.updatedAt)) {
      const answers = r.decisions;
      for (const k of Object.keys(inc)) if (!['decisions', 'pmReview', 'pmAt'].includes(k)) r[k] = inc[k];
      const kept = inc.decisions.map(d => { const a = d.q ? answers.find(x => x.q === d.q) : null; return { q: d.q, rec: d.rec, by: d.by, pm: a ? a.pm : '', pmNote: a ? a.pmNote : '' }; });
      for (const a of answers) if ((a.pm || a.pmNote) && !kept.some(k => k.q === a.q)) kept.push(a); // an answer is never dropped
      r.decisions = kept; applied = true;
    }
    if (pm && inc.pmAt >= r.pmAt) {
      for (const d of inc.decisions) { const m = d.q ? r.decisions.find(x => x.q === d.q) : null; if (m) { m.pm = d.pm; m.pmNote = d.pmNote; } else if (d.pm || d.pmNote) r.decisions.push({ ...d }); }
      r.pmReview = inc.pmReview; r.pmAt = inc.pmAt; applied = true;
    }
    delete r.fresh;
    if (applied) r.rev = this.bump();
    return { key: w.date, status: 'ok', report: this.reportView(r) };
  }
  reportView(r) { return { ...r, decisions: r.decisions.map(d => ({ ...d })) }; }
  push(role, dev, req) {
    if (this.fail?.push) return this.err('server');
    if ((req.tasks || []).length + (req.shifts || []).length + (req.reports || []).length > 200) return this.err('too_large');
    const out = { ok: true, tasks: [], shifts: [], reports: [] };
    for (const w of req.tasks || []) out.tasks.push(this.pushTask(role, w));
    for (const w of req.shifts || []) out.shifts.push(this.pushShift(role, dev, w));
    for (const w of req.reports || []) out.reports.push(role === 'crew' ? { key: w.date, status: 'rejected', reason: 'forbidden' } : this.pushReport(role, w));
    if (req.config) {
      if (role === 'crew') { out.configStatus = 'rejected'; out.configReason = 'forbidden'; }
      else {
        const at = this.clamp(req.config.at) || this.now();
        if (!this.config || at >= this.config.at) { this.config = { ...clone(req.config), at }; this.configRev = this.bump(); }
        out.config = { ...this.config, rev: this.configRev }; out.configStatus = 'ok';
      }
    }
    out.rev = this.rev;
    return this.mute ? { ok: true, rev: this.rev } : out;
  }
  pull(role, dev, req) {
    let since = num(req.since); if (since < 0 || since > this.rev) since = 0;
    const days = Math.min(Math.max(num(req.days) || 14, 1), 90), cut = (() => { const d = new Date(this.now()); d.setDate(d.getDate() - days); return dayOf(d.getTime()); })();
    const inWin = d => this.ignoreDays || d >= cut;
    const ours = r => role !== 'crew' || !req.crews || req.crews.includes(r.a.crew), changed = [...this.tasks.values()].filter(r => r.rev > since && inWin(r.a.date));
    const other = r => !ours(r) && (this.config?.crews || []).some(c => c.name && c.name === r.a.crew); // a sheet moved to another crew on the roster leaves this one's phones
    const tasks = changed.filter(ours).map(r => this.taskView(r)), left = changed.filter(other).map(r => ({ kind: 'tasks', key: r.uid, rev: r.rev, moved: true }));
    const shifts = [...this.shifts.values()].filter(s => s.rev > since && inWin(s.date) && (role === 'pm' || (dev && s.device === dev))).map(clone); // no proven device: no hours
    const reports = role === 'crew' ? [] : [...this.reports.values()].filter(r => r.rev > since && inWin(r.date)).map(r => this.reportView(r));
    const config = this.config && this.configRev > since ? this.config : undefined;
    const deleted = [...this.tomb.filter(t => t.rev > since && (role !== 'crew' || t.kind !== 'reports')), ...left], events = role === 'crew' ? [] : this.events.filter(e => e.rev > since);
    if (since && since === this.rev) return { ok: true, rev: this.rev, now: this.now(), same: true };
    const out = { rev: this.rev, more: false };
    for (const l of [tasks, shifts, reports]) { l.sort((a, b) => a.rev - b.rev); if (this.cap && l.length > this.cap) { l.length = this.cap; out.rev = Math.min(out.rev, l[this.cap - 1].rev); out.more = true; } }
    return { ok: true, rev: out.rev, ...(out.more && { more: true }), now: this.now(), tasks, shifts, reports, ...(config && { config: { ...config, rev: this.configRev } }), events, ...(role !== 'crew' && { onsite: [...this.shifts.values()].filter(x => !x.out && !x.gone).map(x => ({ who: x.who, in: x.in, date: x.date })) }), deleted };
  }
}
const num = x => (Number.isFinite(+x) ? +x : 0);
const arrOf = x => (Array.isArray(x) ? x : []);

// ---------- a fake phone ----------

function memStorage() {
  const m = new Map();
  return { m, failOn: new Set(),
    get: (k, fb) => { try { const v = m.get(k); const x = v === undefined ? fb : JSON.parse(v); return Array.isArray(fb) && !Array.isArray(x) ? fb : x; } catch { return fb; } },
    set(k, v) { if (this.failOn.has(k)) return false; m.set(k, JSON.stringify(v)); return true; } };
}
function manualTimers(advance = () => {}) {
  let id = 0, list = []; const t = { delays: [], now: 0 };
  return Object.assign(t, { set(fn, ms) { list.push({ id: ++id, fn, at: t.now + ms }); t.delays.push(ms); return id; }, clear(i) { list = list.filter(x => x.id !== i); },
    pending: () => list.map(x => x.at - t.now), async fire() { list.sort((a, b) => a.at - b.at); const x = list.shift(); if (!x) return false; if (x.at > t.now) advance(x.at - t.now); t.now = Math.max(t.now, x.at); x.fn(); await settle(); return true; } });
}

let seq = 0;
async function makePhone(hub, role, o = {}) {
  const { makeSync } = await syncLib, shared = await lib;
  const storage = o.storage || memStorage(), timers = manualTimers(ms => tick(ms));
  const p = { k: 0, hub, role, storage, timers, changes: [], toasts: [], statuses: [], offset: o.offset || 0, n: ++seq };
  p.now = () => hub.clock() + p.offset;
  if (!o.storage && !o.noDevice) { storage.set('schwab.device', { secret: o.secret || newSecret(), id: '' }); await ensureIn(storage)(); } // an up to date phone
  Object.defineProperties(p, { secret: { get: () => storage.get('schwab.device')?.secret || '' }, dev: { get: () => storage.get('schwab.device')?.id || '' } });
  const settings = { lang: '', worker: o.worker || '', device: o.device ?? p.dev, role: role === 'pm' ? 'Project manager' : 'Superintendent', crews: [{ name: 'Crew A', lead: '', members: '' }], floors: ['Level 1'], checks: [], project: 'P', site: 'S', super: '', pm: '', pin: '',
    hubUrl: o.url ?? URL_A, hubKey: o.key ?? KEYS[role], hubRole: o.noRole ? '' : role, hubCrew: o.crew || '' };
  if (!o.storage) storage.set('schwab.settings', settings);
  p.net = { down: false };
  p.attempts = 0;
  p.fetch = async (url, init) => { p.attempts++; if (p.net.down) throw new TypeError('down'); return hub.fetch(url, init); };
  const norm = o.norm || {};
  p.sync = makeSync({ fetchImpl: o.fetchImpl || p.fetch, now: p.now, storage, timers, hidden: o.hidden || (() => false), norm, S: o.S, ensureDevice: o.ensureDevice || ensureIn(storage),
    onChange: kinds => p.changes.push({ kinds, tasks: clone(storage.get('schwab.tasks', [])) }), onStatus: s => p.statuses.push(s.state), toast: (m, tone) => p.toasts.push(m + (tone ? ` [${tone}]` : '')), linkTo: (pg, code) => `https://app.test/${pg}#p=${code}` });
  Object.assign(p, {
    tasks: () => storage.get('schwab.tasks', []),
    task: uid => storage.get('schwab.tasks', []).find(t => t.uid === uid),
    save: (key, v) => storage.set(key, v),
    cycle: () => p.sync.cycle(),
    addTask(over = {}) {
      const t = shared.normTask({ uid: `u${p.n}x${++p.k}`, origin: role === 'crew' ? 'link' : 'mine', id: 'T1019-01', date: DAY, crew: 'Crew A', scope: 'Pull 12 AWG', updatedAt: p.now(),
        items: [{ id: 'i1', text: 'Step one' }, { id: 'i2', text: 'Step two' }], checks: [{ id: 'k1', text: 'Labeling' }], ...over });
      storage.set('schwab.tasks', [...storage.get('schwab.tasks', []), t]);
      return t.uid;
    },
    editTask(uid, fn) { const l = storage.get('schwab.tasks', []), t = l.find(x => x.uid === uid); fn(t); t.updatedAt = p.now(); storage.set('schwab.tasks', l); return t; },
    tick(uid, id, list = 'items') { return p.editTask(uid, t => { const i = t[list].find(x => x.id === id); i.done = !i.done; i.at = i.done ? p.now() : 0; }); },
    hours: () => storage.get('schwab.hours', []), crewHours: () => storage.get('schwab.crewHours', []), reports: () => storage.get('schwab.reports', {}),
    clockIn(who, over = {}) { // as report.mjs labels a shift: the derived device id, else the older settings.device
      const s = shared.normShift({ id: `s${p.n}x${++p.k}`, device: p.dev || storage.get('schwab.settings').device, who, date: DAY, in: '07:00', ...over });
      storage.set('schwab.hours', [...p.hours(), s]); return s.id; },
    editHours(id, fn) { const l = p.hours(); fn(l.find(s => s.id === id)); storage.set('schwab.hours', l); },
    editCrewHours(id, fn) { const l = p.crewHours(); fn(l.find(s => s.id === id)); storage.set('schwab.crewHours', l); },
    editReport(date, fn) { const r = p.reports(); r[date] ||= shared.normReport({ date }); fn(r[date]); r[date].updatedAt = p.now(); storage.set('schwab.reports', r); },
    settings: () => storage.get('schwab.settings'),
    hubSync: () => storage.get('schwab.hubSync'),
  });
  return p;
}
const stable = async (...phones) => { for (let i = 0; i < 6; i++) for (const p of phones) await p.cycle(); };

let clockMs = T0;
const clock = () => clockMs;
const tick = ms => { clockMs += ms; };
const fresh = () => { clockMs = T0; seq = 0; return new FakeHub(clock); };

test('a task is pushed once, only its changed part goes up, and an idle phone sends nothing', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super');
  const uid = sp.addTask();
  await sp.cycle();
  assert.equal(hub.count('push'), 1);
  const rec = hub.tasks.get(uid);
  assert.ok(rec.aAt > 0 && rec.cAt > 0, 'both parts stamped');
  assert.equal(rec.a.scope, 'Pull 12 AWG');
  const body = hub.calls.find(c => c.action === 'push').body;
  assert.equal(body.tasks.length, 1);
  assert.equal(sp.changes.length, 0, 'the echo of its own push changes nothing and tells the app nothing');
  tick(30e3);
  await sp.cycle(); await sp.cycle();
  assert.equal(hub.count('push'), 1, 'nothing changed: no push');
  // change one part only
  tick(1000);
  sp.editTask(uid, t => { t.lead = 'Mike'; });
  await sp.cycle();
  assert.equal(hub.count('push'), 2);
  const b2 = hub.calls.filter(c => c.action === 'push')[1].body.tasks[0];
  assert.ok('crewAt' in b2 && !('assignAt' in b2) && !('scope' in b2) && b2.date === DAY, 'only the crew part is sent, with the day');
  assert.equal(hub.tasks.get(uid).c.lead, 'Mike');
  assert.equal(hub.tasks.get(uid).aAt, rec.aAt, 'the assign part kept its stamp');
});

test('ownership: a crew phone sends only its own part, and the office part reaches it as a read-only copy', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super'), cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  const uid = sp.addTask({ lead: 'Mike' });
  await sp.cycle(); await cp.cycle();
  const mine = cp.task(uid);
  assert.equal(mine.origin, 'link', 'crew phones show hub sheets as received');
  assert.equal(mine.scope, 'Pull 12 AWG');
  assert.deepEqual(hub.calls.find(c => c.action === 'pull' && c.init && c.body.crews)?.body.crews, ['Crew A'], 'a crew phone asks for its own crew');
  tick(5000);
  cp.tick(uid, 'i1'); cp.editTask(uid, t => { t.status = 'Partial'; t.doneText = 'Pulled 4 of 12'; t.comments = 'Need a lift'; });
  cp.editTask(uid, t => { t.scope = 'MALICIOUS EDIT'; t.est = 99; t.review = 'Accepted'; }); // an office field changed on a crew phone
  await cp.cycle();
  assert.deepEqual(hub.violations, [], 'no office field ever leaves a crew phone');
  const w = hub.calls.filter(c => c.action === 'push').at(-1).body.tasks[0];
  assert.deepEqual(Object.keys(w).sort(), ['checks', 'crewAt', 'crewBase', 'date', 'items', 'uid', ...C_KEYS].sort(), 'ticks and results, plus the day the hub needs to validate a sheet and the crew part it started from');
  assert.ok(w.items.every(i => Object.keys(i).sort().join() === 'at,done,id'), 'ticks only, never wording');
  const rec = hub.tasks.get(uid);
  assert.equal(rec.a.scope, 'Pull 12 AWG');
  assert.equal(rec.c.status, 'Partial');
  assert.equal(rec.ticks.items.i1.done, true);
  tick(5000);
  await sp.cycle();
  const seen = sp.task(uid);
  assert.deepEqual([seen.status, seen.doneText, seen.items[0].done, seen.scope, seen.est], ['Partial', 'Pulled 4 of 12', true, 'Pull 12 AWG', 0], 'the office sees the crew part; its own part is untouched');
  assert.equal(seen.origin, 'mine');
});

test('an office edit never clobbers a newer unsynced crew edit, and the other way round', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super'), cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  const uid = sp.addTask();
  await stable(sp, cp);
  // crew works with no signal
  cp.net.down = true; tick(10e3);
  cp.tick(uid, 'i1'); cp.editTask(uid, t => { t.doneText = 'crew words'; });
  await cp.cycle();
  assert.equal(cp.sync.hubStatus().state, 'offline');
  // meanwhile the office changes the assignment: new wording, a new step, one removed
  tick(10e3);
  sp.editTask(uid, t => { t.scope = 'office words'; t.items = [t.items[0], { id: 'i3', text: 'Step three', done: false, at: 0 }]; });
  await sp.cycle();
  // the crew phone gets signal back: its edit goes up, the new assignment comes down, nobody loses anything
  tick(10e3); cp.net.down = false;
  await cp.cycle();
  const c = cp.task(uid);
  assert.equal(c.scope, 'office words');
  assert.equal(c.doneText, 'crew words');
  assert.deepEqual(c.items.map(i => [i.id, i.done]), [['i1', true], ['i3', false]], 'structure from the office, ticks from the crew, by item id');
  await stable(sp, cp);
  const s = sp.task(uid);
  assert.equal(s.doneText, 'crew words');
  assert.deepEqual(s.items.map(i => [i.id, i.done]), [['i1', true], ['i3', false]]);
  // and the other way: an office edit made offline, a crew edit lands on the hub first
  sp.net.down = true; tick(10e3);
  sp.editTask(uid, t => { t.followUp = 'office offline edit'; });
  await sp.cycle();
  tick(10e3);
  cp.tick(uid, 'k1', 'checks');
  await cp.cycle();
  tick(10e3); sp.net.down = false;
  await stable(sp, cp);
  assert.equal(sp.task(uid).followUp, 'office offline edit');
  assert.equal(sp.task(uid).checks[0].done, true, 'the crew tick reached the office phone');
  assert.equal(cp.task(uid).followUp, 'office offline edit');
  assert.equal(hub.tasks.get(uid).a.followUp, 'office offline edit');
});

test('stamps: the newest edit wins a part, a tie goes to whoever pushes last, and a wrong clock is corrected', async () => {
  let hub = fresh();
  const sp = await makePhone(hub, 'super'), a = await makePhone(hub, 'crew', { crew: 'Crew A' }), b = await makePhone(hub, 'crew', { crew: 'Crew A' });
  const uid = sp.addTask();
  await stable(sp, a, b);
  // two crew phones edit the same part offline; the later edit wins whichever reaches the hub first
  for (const [round, order] of [[a, b], [b, a]].entries()) {
    a.net.down = b.net.down = true; tick(60e3);
    a.editTask(uid, t => { t.comments = 'from A' + round; }); await a.cycle();
    tick(30e3);
    b.editTask(uid, t => { t.comments = 'from B' + round; }); await b.cycle();
    tick(30e3); a.net.down = b.net.down = false;
    for (const p of order) await p.cycle();
    await stable(sp, a, b);
    assert.deepEqual([a.task(uid).comments, b.task(uid).comments, hub.tasks.get(uid).c.comments], Array(3).fill('from B' + round));
  }
  // an exact tie still converges
  a.net.down = b.net.down = true; tick(60e3);
  a.editTask(uid, t => { t.comments = 'tie A'; }); await a.cycle();
  b.editTask(uid, t => { t.comments = 'tie B'; }); await b.cycle();
  a.net.down = b.net.down = false;
  await stable(sp, a, b);
  assert.equal(a.task(uid).comments, b.task(uid).comments);
  assert.equal(hub.tasks.get(uid).c.comments, a.task(uid).comments);
  // a phone clock an hour fast stamps in hub time, so it neither jumps the queue nor gets clamped away
  const fast = await makePhone(hub, 'crew', { crew: 'Crew A', offset: 3600e3 });
  await fast.cycle(); tick(60e3);
  fast.editTask(uid, t => { t.remain = 'fast edit'; }); await fast.cycle();
  assert.ok(hub.tasks.get(uid).cAt <= hub.now() + 5e3, 'the stamp is in hub time');
  tick(60e3);
  a.editTask(uid, t => { t.remain = 'later real edit'; }); await a.cycle();
  await stable(sp, a, b, fast);
  assert.equal(hub.tasks.get(uid).c.remain, 'later real edit', 'a later edit wins over a fast clock');
  assert.equal(fast.task(uid).remain, 'later real edit');
  // two edits in the same millisecond still get rising stamps
  const before = hub.tasks.get(uid).cAt;
  a.editTask(uid, t => { t.remain = 'one'; }); await a.cycle();
  a.editTask(uid, t => { t.remain = 'two'; }); await a.cycle();
  assert.ok(hub.tasks.get(uid).cAt > before + 1 && hub.tasks.get(uid).c.remain === 'two');
});

test('first contact: an old copy on a new phone cannot overwrite a newer hub copy, a newer local edit still goes up', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super'), a = await makePhone(hub, 'crew', { crew: 'Crew A' });
  const uid = sp.addTask();
  await stable(sp, a);
  tick(60e3); a.tick(uid, 'i1'); a.editTask(uid, t => { t.comments = 'newest on the hub'; }); await stable(sp, a);
  const stamp = hub.tasks.get(uid).cAt;
  // a phone that got the sheet by link a while ago, with older results, joins the hub
  tick(60e3);
  const old = await makePhone(hub, 'crew', { crew: 'Crew A' });
  const copy = clone(sp.task(uid)); Object.assign(copy, { origin: 'link', comments: 'old stale words', updatedAt: T0 - 3600e3, crewAt: T0 - 7200e3, items: copy.items.map(i => ({ ...i, done: false, at: 0 })) });
  old.save('schwab.tasks', [copy]);
  await old.cycle();
  assert.equal(hub.tasks.get(uid).cAt, stamp, 'the hub copy was not replaced');
  assert.equal(hub.tasks.get(uid).c.comments, 'newest on the hub');
  assert.equal(old.task(uid).comments, 'newest on the hub', 'the phone took the newer hub copy');
  assert.equal(old.task(uid).items[0].done, true);
  // another joining phone whose local edit is newer than the hub's copy
  const fresher = await makePhone(hub, 'crew', { crew: 'Crew A' });
  tick(60e3);
  const copy2 = clone(sp.task(uid)); Object.assign(copy2, { origin: 'link', comments: 'newer than the hub', updatedAt: T0 + 1000 * 3600 });
  clockMs = T0 + 1000 * 3600 + 5e3;
  fresher.save('schwab.tasks', [copy2]);
  await fresher.cycle();
  assert.equal(hub.tasks.get(uid).c.comments, 'newer than the hub');
});

test('hours: workers push their own shifts, only the PM phone pushes the timesheet, and PM edits come back to the worker', async () => {
  const hub = fresh(), shared = await lib;
  const w = await makePhone(hub, 'crew', { crew: 'Crew A', worker: 'Jose L' }), pm = await makePhone(hub, 'pm'), sp = await makePhone(hub, 'super');
  const id = w.clockIn('Jose L', { pid: 'p-jose', crew: 'Crew A', crewId: 'c-a', tasks: [{ uid: 'u-t2', id: 'T1019-02' }] });
  await w.cycle();
  const first = hub.shifts.get(id);
  assert.deepEqual([first.who, first.pid, first.in, first.crew, first.crewId, first.tasks, first.edited, first.device], ['Jose L', 'p-jose', '07:00', 'Crew A', 'c-a', [{ uid: 'u-t2', id: 'T1019-02' }], { who: false, in: false, out: false }, w.dev]);
  assert.equal(hub.calls.filter(c => c.action === 'push')[0].body.shifts[0].gone, false, 'a phone never sets gone or edited for itself');
  await pm.cycle();
  assert.deepEqual(pm.crewHours().map(s => [s.id, s.who, s.crew]), [[id, 'Jose L', 'Crew A']], 'the timesheet fills from the hub');
  // the PM fixes the in time
  tick(60e3);
  pm.editCrewHours(id, s => { s.in = '07:30'; s.edited.in = true; });
  await pm.cycle();
  assert.deepEqual([hub.shifts.get(id).in, hub.shifts.get(id).edited.in], ['07:30', true]);
  // the worker clocks out later; his push carries the old in time, which the hub ignores
  tick(8 * 3600e3);
  w.editHours(id, s => { s.out = '15:30'; });
  await w.cycle();
  assert.deepEqual([hub.shifts.get(id).in, hub.shifts.get(id).out], ['07:30', '15:30']);
  assert.deepEqual([w.hours()[0].in, w.hours()[0].out], ['07:30', '15:30'], "the PM's fix reached the worker's own clock");
  await pm.cycle();
  assert.deepEqual([pm.crewHours()[0].in, pm.crewHours()[0].out], ['07:30', '15:30']);
  // only the PM phone pushes the timesheet
  const bogus = shared.normShift({ id: 'bogus1', device: 'someone-else', who: 'Nobody', date: DAY, in: '06:00' });
  w.save('schwab.crewHours', [bogus]); sp.save('schwab.crewHours', [bogus]);
  await w.cycle(); await sp.cycle();
  assert.equal(hub.shifts.has('bogus1'), false);
  assert.ok(hub.calls.every(c => !c.init.body.includes('bogus1')), 'the timesheet is not even offered by a phone that is not the PM');
  // a shift the PM adds by hand is pushed as sent; the worker's own punches for that day stay on the worker's clock, and reach the PM as a second row (DATA2-03)
  const manual = shared.normShift({ id: 'pmadd1', device: '', who: 'Tre W', date: DAY, in: '08:00', out: '16:00', edited: { who: true, in: true, out: true } });
  pm.save('schwab.crewHours', [...pm.crewHours(), manual]);
  await pm.cycle();
  assert.deepEqual([hub.shifts.get('pmadd1').device, hub.shifts.get('pmadd1').edited.out], ['', true]);
  const tre = await makePhone(hub, 'crew', { crew: 'Crew A', worker: 'tre w' });
  const treId = tre.clockIn('tre w');
  await tre.cycle(); await tre.cycle(); await pm.cycle();
  assert.deepEqual([hub.shifts.get(treId).gone, tre.hours().map(s => s.id), pm.crewHours().filter(s => s.date === DAY && /tre w/i.test(s.who)).map(s => s.id).sort()], [false, [treId], ['pmadd1', treId].sort()]);
  // the PM removes a shift: it leaves the worker's phone too
  pm.editCrewHours(id, s => { s.gone = true; });
  await pm.cycle(); await w.cycle();
  assert.equal(hub.shifts.get(id).gone, true);
  assert.equal(w.hours().length, 0);
});

test('first contact on the PM phone keeps a worker clock-out the hub already has', async () => {
  const hub = fresh(), shared = await lib;
  const w = await makePhone(hub, 'crew', { worker: 'Jose L' });
  const id = w.clockIn('Jose L'); w.editHours(id, s => { s.out = '15:00'; });
  await w.cycle();
  const pm = await makePhone(hub, 'pm');
  pm.save('schwab.crewHours', [shared.normShift({ id, device: w.dev, who: 'Jose L', date: DAY, in: '07:00' })]); // an old text opened on the PM phone: no clock-out yet
  await stable(pm);
  assert.equal(hub.shifts.get(id).out, '15:00', 'the PM-ruled push did not wipe the clock-out');
  assert.equal(pm.crewHours()[0].out, '15:00');
});

test('purge: the PM removes a sheet everywhere, even over an unsynced edit; no one else may', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super'), cp = await makePhone(hub, 'crew', { crew: 'Crew A' }), pm = await makePhone(hub, 'pm');
  const uid = sp.addTask(), keep = sp.addTask({ id: 'T1019-02' });
  await stable(sp, cp, pm);
  assert.ok(cp.task(uid) && pm.task(uid));
  const denied = await cp.sync.purge('task', keep);
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'forbidden');
  assert.ok(hub.tasks.has(keep) && cp.task(keep));
  cp.net.down = true; tick(5000);
  cp.tick(uid, 'i1'); await cp.cycle();
  const gone = await pm.sync.purge('task', uid);
  assert.equal(gone.ok, true);
  assert.equal(pm.task(uid), undefined, 'gone from the purging phone at once');
  assert.deepEqual(pm.changes.at(-1).kinds, ['tasks']);
  assert.equal(hub.tasks.has(uid), false);
  cp.net.down = false;
  await stable(cp, sp, pm);
  assert.equal(cp.task(uid), undefined, 'the tombstone beat the crew phone unsynced tick');
  assert.equal(sp.task(uid), undefined);
  assert.equal(hub.tasks.has(uid), false, 'and nothing brought it back');
  assert.ok(cp.task(keep) && sp.task(keep));
});

test('DATA-09: a PM delete still reaches the hub when the app is closed during its Undo; an Undo takes it back; onHub tells a sheet or report the hub has', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super'), pm = await makePhone(hub, 'pm');
  const a = sp.addTask(), b = sp.addTask({ id: 'T1019-02' }), c = sp.addTask({ id: 'T1019-03' });
  const draft = sp.addTask({ id: 'T1019-04' });
  sp.editReport(DAY, r => { r.results = 'All good'; });
  await stable(sp, pm);
  assert.deepEqual([sp.sync.onHub(a), sp.sync.onHub(DAY, 'report'), sp.sync.onHub('nope'), sp.sync.onHub('2026-01-01', 'report')], [true, true, false, false]);
  // a stored purge on a phone whose key may not purge (a superintendent's) is dropped once the hub says no, not retried for ever
  sp.sync.purgeLater('task', b, 1);
  const sp2 = await makePhone(hub, 'super', { storage: sp.storage, fetchImpl: sp.fetch });
  await sp2.cycle(); await sp2.cycle();
  assert.deepEqual([hub.count('purge'), sp2.hubSync().del, hub.tasks.has(b)], [1, {}, true]);
  // the PM deletes a (the app stores the purge, takes the sheet off), and the app is closed 2 s later, inside the 6 s Undo
  const drop = (p, uid) => p.save('schwab.tasks', p.tasks().filter(t => t.uid !== uid));
  pm.sync.purgeLater('task', a, pm.now() + 6000); drop(pm, a);
  tick(2000); await pm.cycle();
  assert.ok(hub.tasks.has(a), 'nothing goes while the Undo is offered');
  const pm2 = await makePhone(hub, 'pm', { storage: pm.storage, fetchImpl: pm.fetch }); // opened again: a new engine on the same storage
  await pm2.cycle();
  assert.ok(hub.tasks.has(a), 'not before the Undo would have run out');
  tick(5000); await pm2.cycle();
  assert.equal(hub.tasks.has(a), false, 'the stored delete went with the next cycle');
  await stable(pm2, sp2);
  assert.deepEqual([hub.count('purge'), sp2.task(a), pm2.task(a), pm2.hubSync().del], [2, undefined, undefined, {}], 'once, everywhere, and nothing is left stored');
  // Undo: taken back before it was due, so it never goes
  pm2.sync.purgeLater('task', b, pm2.now() + 6000); drop(pm2, b);
  pm2.sync.purgeLater('task', b, 0);
  tick(7000); await stable(pm2);
  assert.ok(hub.tasks.has(b));
  // the page that holds the Undo offer sends its own purge when the offer ends: the cycle does not send it a second time
  pm2.sync.purgeLater('task', c, pm2.now() + 6000); drop(pm2, c);
  tick(7000); await pm2.cycle();
  assert.equal(hub.count('purge'), 2);
  assert.equal((await pm2.sync.purge('task', c)).ok, true);
  await stable(pm2);
  assert.deepEqual([hub.count('purge'), hub.tasks.has(c), pm2.hubSync().del], [3, false, {}]);
  assert.ok(hub.tasks.has(draft) && hub.tasks.has(b));
});

test('window: old synced sheets leave the phone; unsynced or refused ones never do; an old hub sheet is not stored', async () => {
  const hub = fresh(); hub.ignoreDays = true;
  const sp = await makePhone(hub, 'super'), other = await makePhone(hub, 'super');
  const old = sp.addTask({ date: ago(70), id: 'OLD' }), mid = sp.addTask({ date: ago(30), id: 'MID' }), now1 = sp.addTask({ id: 'NEW' });
  await sp.cycle();
  assert.equal(sp.task(old), undefined, 'older than 60 days and on the hub: dropped from the phone');
  assert.ok(hub.tasks.has(old), 'but kept on the hub');
  assert.ok(sp.task(mid) && sp.task(now1));
  // edited while the pull is in flight: dirty, so it stays
  const edit = sp.addTask({ date: ago(70), id: 'EDIT' });
  hub.before = async req => { if (req.action === 'pull' && hub.tasks.has(edit)) { hub.before = null; sp.editTask(edit, t => { t.scope = 'typed meanwhile'; }); } };
  await sp.cycle();
  assert.equal(sp.task(edit)?.scope, 'typed meanwhile', 'an unsynced edit is never dropped');
  await sp.cycle();
  assert.equal(hub.tasks.get(edit).a.scope, 'typed meanwhile');
  assert.equal(sp.task(edit), undefined, 'once the hub has it, it can go');
  // refused by the hub: kept
  hub.rejectIf = w => w.scope === 'REFUSE';
  const refused = sp.addTask({ date: ago(70), id: 'NO', scope: 'REFUSE' });
  await sp.cycle();
  assert.ok(sp.task(refused), 'a sheet the hub refused stays on the phone');
  // an old sheet that comes down in a pull is not stored
  const ancient = other.addTask({ date: ago(100), id: 'ANCIENT' });
  await other.cycle(); await sp.cycle();
  assert.ok(hub.tasks.has(ancient));
  assert.equal(sp.task(ancient), undefined);
  // crews keep 14 days
  const cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  const d10 = sp.addTask({ date: ago(10), id: 'D10' }), d20 = sp.addTask({ date: ago(20), id: 'D20' });
  cp.save('schwab.tasks', [{ ...clone(hub.tasks.size ? sp.task(d10) : {}), origin: 'link' }]);
  await stable(sp, cp);
  assert.ok(cp.task(d10), '10 days old stays on a crew phone');
  assert.equal(cp.task(d20), undefined, '20 days old is not kept on a crew phone');
  assert.ok(sp.task(d20), 'a superintendent phone keeps 60 days');
});

test('offline for a day and a restart: nothing is lost, and the stamps are the time of each edit', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super'), cp = await makePhone(hub, 'crew', { crew: 'Crew A', worker: 'Jose L' });
  const ids = [sp.addTask(), sp.addTask({ id: 'T1019-02' }), sp.addTask({ id: 'T1019-03' })];
  await stable(sp, cp);
  cp.net.down = true;
  const edits = [];
  for (let i = 0; i < 3; i++) {
    tick(20 * 60e3);
    cp.tick(ids[i], 'i1'); cp.editTask(ids[i], t => { t.doneText = 'work ' + i; t.status = i === 2 ? 'Complete' : 'Partial'; });
    edits.push(cp.now());
    await cp.cycle();
    assert.equal(cp.sync.hubStatus().state, 'offline');
  }
  const sh = cp.clockIn('Jose L'); tick(3600e3); cp.editHours(sh, s => { s.out = '15:30'; });
  // the app is closed and reopened: a new engine on the same storage
  const { makeSync } = await syncLib;
  const cp2 = await makePhone(hub, 'crew', { crew: 'Crew A', storage: cp.storage, fetchImpl: cp.fetch });
  cp.net.down = false;
  await stable(cp2);
  for (let i = 0; i < 3; i++) {
    const rec = hub.tasks.get(ids[i]);
    assert.deepEqual([rec.c.doneText, rec.ticks.items.i1.done], ['work ' + i, true]);
    assert.ok(rec.cAt >= edits[i] - 1 && rec.cAt < edits[i] + 5e3, 'stamped when the edit was seen, not when the signal came back');
  }
  assert.equal(hub.shifts.get(sh).out, '15:30');
  assert.equal(cp2.sync.hubStatus().pending, 0);
  assert.deepEqual(hub.violations, []);
  assert.equal(typeof makeSync, 'function');
});

test('retry: 5, 10, 20, 40, 60, 60 seconds; a busy hub waits a minute; a wrong key is rechecked in 10 minutes; a good cycle resets', async () => {
  const hub = fresh(), cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  cp.net.down = true;
  cp.sync.start();
  const waits = [];
  for (let i = 0; i < 7; i++) { await cp.timers.fire(); waits.push(cp.timers.pending()[0]); }
  assert.deepEqual(waits, [5e3, 10e3, 20e3, 40e3, 60e3, 60e3, 60e3]);
  assert.equal(cp.sync.hubStatus().state, 'offline');
  // a poke inside the wait does not hammer the hub; coming back online does retry at once
  const tries = cp.attempts;
  cp.sync.poke(); await cp.timers.fire();
  assert.equal(cp.attempts, tries, 'the 1.5 second poke timer is held back by the backoff');
  cp.net.down = false;
  cp.sync.wake('online'); await settle();
  assert.equal(cp.sync.hubStatus().state, 'live');
  assert.equal(cp.timers.pending().at(-1), 20e3, 'a good cycle goes back to the 20 second beat');
  // busy
  const b = await makePhone(hub, 'crew'), u = await makePhone(hub, 'crew');
  hub.fail = req => hub.err('busy');
  b.sync.start(); await b.timers.fire();
  assert.equal(b.timers.pending()[0], 60e3);
  assert.equal(b.sync.hubStatus().state, 'offline', 'busy and quota behave like offline');
  hub.fail = () => hub.err('unauthorized');
  u.sync.start(); await u.timers.fire();
  assert.equal(u.timers.pending()[0], 600e3);
  assert.equal(u.sync.hubStatus().state, 'error');
});

test('events: one cycle 1.5 seconds after the first poke however many follow, and wake-ups are not stampedes', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super');
  sp.addTask();
  for (let i = 0; i < 20; i++) sp.sync.poke();
  assert.equal(sp.timers.delays.filter(d => d === 1500).length, 1);
  await sp.timers.fire();
  assert.equal(hub.count('push'), 1);
  const n = sp.attempts;
  sp.sync.wake('focus'); sp.sync.wake('visible'); await settle();
  assert.equal(sp.attempts, n, 'focus right after a cycle does nothing');
  tick(6e3); sp.sync.wake('visible'); await settle();
  assert.ok(sp.attempts > n);
  const n2 = sp.attempts;
  sp.sync.wake('hidden'); await settle();
  assert.ok(sp.attempts > n2, 'leaving the app flushes at once');
  // a hidden page does not run the 20 second beat
  const h = await makePhone(hub, 'super', { hidden: () => true });
  h.sync.start(); await h.timers.fire();
  assert.equal(h.attempts, 0);
  assert.equal(h.timers.pending()[0], 20e3);
});

test('a refused sheet is reported once and left alone until it changes', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super');
  hub.rejectIf = w => String(w.scope || '').includes('BAD');
  const bad = sp.addTask({ scope: 'BAD words' }), good = sp.addTask({ id: 'T1019-02', scope: 'fine' });
  await sp.cycle();
  const told = () => sp.toasts.filter(t => t.includes('did not accept')).length;
  assert.equal(told(), 1);
  assert.match(sp.toasts[0], /did not accept: 1\./);
  assert.ok(hub.tasks.has(good) && !hub.tasks.has(bad), 'one refusal does not hold up the others');
  const pushes = hub.count('push');
  tick(30e3); await sp.cycle(); await sp.cycle();
  assert.equal(hub.count('push'), pushes, 'left alone');
  assert.equal(told(), 1);
  sp.editTask(bad, t => { t.scope = 'BAD again'; });
  await sp.cycle();
  assert.equal(hub.count('push'), pushes + 1, 'changed: tried again');
  assert.equal(told(), 2);
  sp.editTask(bad, t => { t.scope = 'now fine'; });
  await sp.cycle();
  assert.equal(hub.tasks.get(bad).a.scope, 'now fine');
  assert.equal(told(), 2);
});

test('joining: an invite link sets a phone up only when the hub agrees, never replaces another hub, and never echoes a key', async () => {
  const hub = fresh(), { unpack } = await lib;
  const link = (over = {}) => ({ v: 1, kind: 'join', hub: { url: URL_A, key: KEYS.crew }, role: 'crew', crew: 'Crew A', ...over });
  const blank = () => makePhone(hub, 'crew', { url: '', key: '', noRole: true, noDevice: true }); // a phone that has never made its device secret
  let p = await blank();
  assert.equal(p.sync.hubStatus().state, 'off');
  const ok = await p.sync.joinFrom(link());
  assert.deepEqual([ok.ok, ok.role, ok.crew, ok.needsName, ok.needsCrew], [true, 'crew', 'Crew A', true, false]);
  const s = p.settings();
  assert.deepEqual([s.hubUrl, s.hubKey, s.hubRole, s.hubCrew], [URL_A, KEYS.crew, 'crew', 'Crew A']);
  assert.ok(p.secret && hub.calls.find(c => c.action === 'whoami').body.devSecret === p.secret, 'the device secret exists before the first request and goes with it');
  await p.cycle();
  assert.equal(p.sync.hubStatus().state, 'live');
  // bad links change nothing and ask nothing of the network
  for (const [why, data, code] of [
    ['version', link({ v: 2 }), 'bad_join'], ['kind', link({ kind: 'task' }), 'bad_join'], ['a pm link', link({ role: 'pm' }), 'bad_join'],
    ['http', link({ hub: { url: URL_A.replace('https', 'http'), key: KEYS.crew } }), 'bad_url'], ['another host', link({ hub: { url: 'https://evil.example/macros/s/x/exec', key: KEYS.crew } }), 'bad_url'],
    ['short key', link({ hub: { url: URL_A, key: 'short' } }), 'bad_key'], ['not an object', 'junk', 'bad_join'],
  ]) {
    const q = await blank(), r = await q.sync.joinFrom(data);
    assert.deepEqual([why, r.ok, r.error], [why, false, code]);
    assert.equal(q.settings().hubUrl, '', why);
    assert.equal(q.attempts, 0, why);
  }
  const wrong = await blank(), w1 = await wrong.sync.joinFrom(link({ hub: { url: URL_A, key: 'x'.repeat(32) } }));
  assert.deepEqual([w1.ok, w1.error], [false, 'unauthorized']);
  assert.equal(wrong.settings().hubKey, '');
  assert.ok(!JSON.stringify(w1).includes('x'.repeat(32)), 'a key never appears in an answer');
  // PHONE-UX-09: a wrong key pasted in Settings > Hub says what is wrong for who is connecting: the PM has no invite to ask for
  const typo = async role => (await (await makePhone(hub, role, { url: '', key: '', noRole: true })).sync.connect(URL_A, 'y'.repeat(32))).message;
  assert.deepEqual([await typo('pm'), await typo('super')], ['The hub did not accept this PM key. Copy it again from the Execution log of the hub script and paste all of it. If it is lost, run resetPmKey there.',
    'The hub did not accept this phone. Ask the PM for a new invite link.']);
  const mism = await blank(), m1 = await mism.sync.joinFrom(link({ role: 'super' })); // the link says super, the key is a crew key
  assert.deepEqual([m1.ok, m1.error], [false, 'mismatch']);
  assert.equal(mism.settings().hubUrl, '');
  // a phone that already uses a hub is not moved by a link
  const other = 'https://script.google.com/macros/s/OTHER/exec';
  const calls = hub.calls.length;
  const stay = await p.sync.joinFrom(link({ hub: { url: other, key: KEYS.crew } }));
  assert.deepEqual([stay.ok, stay.error], [false, 'already']);
  assert.equal(p.settings().hubUrl, URL_A);
  assert.equal(hub.calls.length, calls);
  const moved = await p.sync.joinFrom(link({ hub: { url: other, key: KEYS.crew } }), { replace: true });
  assert.equal(moved.ok, true);
  assert.equal(p.settings().hubUrl, other);
  assert.equal(p.hubSync()?.rev ?? 0, 0, 'a different hub knows none of what was synced');
  // the PM makes the invites
  const pm = await makePhone(hub, 'pm'), sp = await makePhone(hub, 'super');
  const inv = await pm.sync.invite('crew', 'Crew B');
  assert.equal(inv.ok, true);
  assert.match(inv.url, /^https:\/\/app\.test\/tasks\.html#p=[\w-]+$/);
  const data = await unpack(inv.url.split('#p=')[1]);
  assert.deepEqual(data, { v: 1, kind: 'join', hub: { url: URL_A, key: KEYS.crew }, role: 'crew', crew: 'Crew B' });
  assert.ok(!JSON.stringify(data).includes(KEYS.pm), 'the PM key never travels');
  assert.equal((await pm.sync.invite('pm')).ok, false);
  assert.equal((await sp.sync.invite('crew')).error, 'forbidden');
  // rotate: the old crew key stops working, the new link restores the phone
  const lost = await makePhone(hub, 'crew', { crew: 'Crew A' });
  await lost.cycle();
  assert.equal((await pm.sync.rotate('crew')).ok, true);
  await lost.cycle();
  assert.equal(lost.sync.hubStatus().state, 'error');
  await lost.cycle();
  assert.deepEqual(lost.toasts, ['The hub did not accept this phone. Ask the PM for a new invite link. [bad]'], 'PHONE-UX-15: the crew is told what to do, once, not only by a red dot');
  const fresh2 = await pm.sync.invite('crew', 'Crew A'), again = await lost.sync.joinFrom(await unpack(fresh2.url.split('#p=')[1]));
  assert.equal(again.ok, true);
  await lost.cycle();
  assert.equal(lost.sync.hubStatus().state, 'live');
  // disconnect
  p = lost; p.changes.length = 0;
  p.sync.disconnect();
  assert.equal(p.sync.hubStatus().state, 'off');
  assert.deepEqual([p.settings().hubUrl, p.settings().hubKey, p.settings().hubRole, p.hubSync().url, p.hubSync().away], ['', '', '', URL_A, true], 'what it had of that hub stays, for a rejoin (DATA2-04)');
  assert.deepEqual(p.changes.at(-1).kinds, ['settings']);
  p.sync.poke(); await settle();
  assert.equal(p.timers.pending().length, 0);
});

test('status: off, syncing, live, offline after a minute of silence, error with a message that never carries the key', async () => {
  const hub = fresh(), cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  await cp.cycle();
  assert.deepEqual(cp.statuses.slice(0, 2), ['syncing', 'live']);
  const st = cp.sync.hubStatus();
  assert.deepEqual([st.state, st.message, st.role, st.crew], ['live', '', 'crew', 'Crew A']);
  tick(59e3); assert.equal(cp.sync.hubStatus().state, 'live');
  tick(2e3); assert.equal(cp.sync.hubStatus().state, 'offline', 'a minute without a good cycle is no longer live');
  hub.down = true;
  await cp.cycle();
  assert.deepEqual([cp.sync.hubStatus().state, cp.sync.hubStatus().message], ['offline', 'No signal. Your work is saved on this phone and goes to the hub when you are back online.']);
  hub.down = false; cp.sync.wake('online'); await settle();
  assert.equal(cp.sync.hubStatus().state, 'live');
  hub.fail = req => ({ ok: false, error: 'server', message: 'trace ' + req.key });
  await cp.cycle();
  const e = cp.sync.hubStatus();
  assert.equal(e.state, 'error');
  assert.ok(!e.message.includes(KEYS.crew) && !e.message.includes('trace'), "the hub's own words are never shown");
  hub.fail = null; cp.sync.wake('online'); await settle();
  assert.equal(cp.sync.hubStatus().state, 'live');
  hub.keys.crew = 'z'.repeat(32);
  await cp.cycle();
  assert.deepEqual([cp.sync.hubStatus().state, cp.sync.hubStatus().message], ['error', 'The hub did not accept this phone. Ask the PM for a new invite link.']);
});

test('translate: cached, batched by 25, long text split, concurrent calls share one request', async () => {
  const hub = fresh(), cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  const texts = Array.from({ length: 60 }, (_, i) => `Pull 12 AWG in room ${i}, drawing E-301`);
  const out = await cp.sync.translate(texts, 'en', 'es');
  assert.deepEqual(out, texts.map(t => '~' + t));
  assert.deepEqual(hub.tr, [25, 25, 10]);
  assert.deepEqual(hub.calls.filter(c => c.action === 'translate').flatMap(c => c.body.items), texts, 'the text goes up exactly as typed');
  assert.deepEqual(hub.calls.filter(c => c.action === 'translate').map(c => [c.body.from, c.body.to]).flat().slice(0, 2), ['en', 'es']);
  hub.tr.length = 0;
  assert.deepEqual(await cp.sync.translate(texts, 'en', 'es'), out);
  assert.deepEqual(hub.tr, [], 'the second time costs nothing');
  assert.deepEqual(await cp.sync.translate(['Hello there', '', '  ', 'Hello there', 5, null], 'en', 'es'), ['~Hello there', '', '  ', '~Hello there', '', '']);
  assert.deepEqual(hub.tr, [1], 'a repeated text and blanks are not sent twice');
  hub.tr.length = 0;
  assert.deepEqual(await cp.sync.translate(['Hello there'], 'es', 'en'), ['^Hello there'], 'each direction has its own cache entry');
  assert.deepEqual(await cp.sync.translate(['Hello there'], 'en', 'en'), ['Hello there']);
  assert.deepEqual(await cp.sync.translate(['Hello there'], 'en', 'fr'), ['Hello there']);
  assert.deepEqual(hub.tr, [1]);
  // a long note is cut under the hub's 2,000 character limit and put back together
  const long = 'word '.repeat(450).trim() + '\n' + 'x'.repeat(4500);
  hub.tr.length = 0;
  const [tl] = await cp.sync.translate([long], 'en', 'es');
  assert.ok(hub.calls.filter(c => c.action === 'translate').at(-1).body.items.every(t => t.length <= 2000));
  assert.equal(tl.replaceAll('~', ''), long);
  // two screens asking for the same words at once make one request
  let release;
  hub.before = req => (req.action === 'translate' ? new Promise(r => (release = r)) : null);
  hub.tr.length = 0;
  const a = cp.sync.translate(['Share me'], 'en', 'es'), b = cp.sync.translate(['Share me'], 'en', 'es');
  await settle(); release(); hub.before = null;
  assert.deepEqual(await Promise.all([a, b]), [['~Share me'], ['~Share me']]);
  assert.deepEqual(hub.tr, [1]);
});

test('translate: a screen asking for hundreds of new texts costs 100 at most; the rest follow on the next ask', async () => {
  const hub = fresh(), cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  const texts = Array.from({ length: 150 }, (_, i) => `many ${i}`);
  const out = await cp.sync.translate(texts, 'en', 'es');
  assert.deepEqual(hub.tr, [25, 25, 25, 25]);
  assert.deepEqual([out[99], out[100]], ['~many 99', 'many 100']);
  assert.deepEqual((await cp.sync.translate(texts, 'en', 'es')).slice(98, 102), ['~many 98', '~many 99', '~many 100', '~many 101']);
  assert.deepEqual(hub.tr, [25, 25, 25, 25, 25, 25]);
});

test('translate: the cache keeps 800, oldest out, and survives a restart', async () => {
  const hub = fresh(), cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  const all = Array.from({ length: 850 }, (_, i) => `note number ${i}`);
  for (let i = 0; i < all.length; i += 100) await cp.sync.translate(all.slice(i, i + 100), 'en', 'es');
  const tr = cp.storage.get('schwab.tr');
  assert.equal(Object.keys(tr).length, 800);
  assert.ok(Object.keys(tr).every(k => /^en\|es\|[0-9a-z]+$/.test(k)));
  hub.tr.length = 0;
  const { makeSync } = await syncLib;
  const again = makeSync({ fetchImpl: cp.fetch, now: cp.now, storage: cp.storage });
  await again.translate(all.slice(-10), 'en', 'es');
  assert.deepEqual(hub.tr, [], 'newest are still cached after a restart');
  await again.translate(all.slice(0, 3), 'en', 'es');
  assert.deepEqual(hub.tr, [3], 'oldest were evicted');
});

test('translate: quota, no signal and no hub give the original text with one hint each', async () => {
  const hub = fresh(), cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  const texts = Array.from({ length: 60 }, (_, i) => `text ${i}`);
  hub.quotaAfter = 1;
  const out = await cp.sync.translate(texts, 'en', 'es');
  assert.deepEqual(out.slice(0, 25), texts.slice(0, 25).map(t => '~' + t));
  assert.deepEqual(out.slice(25), texts.slice(25), 'what could not be translated comes back as typed');
  assert.deepEqual(hub.tr, [25, 25]);
  const quotaHints = () => cp.toasts.filter(t => t.includes('limit reached')).length;
  assert.equal(quotaHints(), 1);
  hub.tr.length = 0;
  await cp.sync.translate(texts, 'en', 'es'); await cp.sync.translate(texts, 'en', 'es');
  assert.deepEqual(hub.tr, [], 'no more tries today');
  assert.equal(quotaHints(), 1, 'one hint per session');
  hub.quotaAfter = Infinity; tick(26 * 3600e3);
  assert.equal((await cp.sync.translate(['text 59'], 'en', 'es'))[0], '~text 59', 'tomorrow it works again');
  // no signal
  cp.net.down = true;
  assert.deepEqual(await cp.sync.translate(['fresh words'], 'en', 'es'), ['fresh words']);
  const tries = cp.attempts;
  await cp.sync.translate(['fresh words'], 'en', 'es');
  assert.equal(cp.attempts, tries, 'after a failure it waits before trying again');
  await cp.sync.translate(['more words'], 'es', 'en');
  assert.equal(cp.toasts.filter(t => t.includes('not available right now')).length, 1);
  // no hub
  const blank = await makePhone(hub, 'crew', { url: '', key: '', noRole: true });
  assert.deepEqual(await blank.sync.translate(['hello'], 'en', 'es'), ['hello']);
  assert.equal(blank.toasts.filter(t => t.includes('needs the hub')).length, 1);
  assert.equal(blank.attempts, 0);
});

test('whatever the hub sends is normalized: hostile or damaged data cannot break a phone', async () => {
  const hub = fresh(), cp = await makePhone(hub, 'super');
  const evil = JSON.parse(`{"uid":"__proto__","date":"${DAY}","scope":"x","size":"9","items":[{"id":"a","text":"t"},{"id":"a","text":"dup"},{"id":"","text":"noid"}],"__proto__":{"polluted":1},"zzz":1}`);
  hub.fail = req => (req.action === 'pull' ? { ok: true, rev: 5, now: hub.now(),
    tasks: [evil, { uid: 'bad uid!', date: DAY }, { uid: 'ok1', date: '2026-02-30', scope: 'bad date', crewAt: 'soon', items: 'nope' }, 'junk', null],
    reports: [{ date: 'nope' }, { date: DAY, status: 'Hacked', decisions: 'x' }],
    shifts: [{ id: 's1', device: cp.dev, who: 'x', date: DAY, in: '25:99' }, { id: 's2', device: cp.dev, who: 'Zed', date: DAY, in: '07:00', edited: 'yes', tasks: ['T1', { uid: 'bad uid!', id: '<b>' }, 7], pid: { x: 1 } }],
    config: { floors: 'no', crews: [{ name: 5 }], project: { a: 1 }, pin: 'not a pin' }, deleted: [null, { kind: 'task' }, { kind: 'galaxy', key: 'x' }] } : null);
  await cp.cycle();
  assert.equal(cp.sync.hubStatus().state, 'live');
  assert.equal({}.polluted, undefined);
  for (const k of ['assign', 'crew', 'sup', 'pm', 's', 'v', 'vh', 'p', 'at', 'x']) assert.equal({}[k], undefined, `Object.prototype.${k} untouched by a sheet called __proto__`);
  const ts = cp.tasks();
  assert.deepEqual(ts.map(t => t.uid).sort(), ['__proto__', 'ok1']);
  const e = ts.find(t => t.uid === '__proto__');
  assert.deepEqual([e.size, e.zzz, e.items.map(i => i.id)], [0, undefined, ['a']]);
  assert.match(ts.find(t => t.uid === 'ok1').date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Object.keys(cp.reports()), [DAY]);
  assert.equal(cp.reports()[DAY].status, '');
  assert.deepEqual(cp.hours().map(s => [s.id, s.pid, s.tasks]), [['s2', '', [{ uid: '', id: 'T1' }]]]);
  assert.equal(cp.settings().pin, '', 'a pin that is not a salted hash is never adopted');
  assert.equal(cp.settings().project, 'P');
});

test('transport: a plain-text post to the hub address, the key only in the body, no credentials, errors in our own words', async () => {
  const hub = fresh(), cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  await cp.cycle();
  for (const c of hub.calls) {
    assert.equal(c.url, URL_A, 'the key is never in the address');
    assert.match(c.init.headers['Content-Type'], /^text\/plain/);
    assert.equal(c.init.method, 'POST');
    assert.equal(c.init.credentials, 'omit');
    assert.deepEqual([c.body.v, c.body.key, c.body.devSecret, 'dev' in c.body], [1, KEYS.crew, cp.secret, false], 'the device secret goes with every request, a device id never does');
    assert.ok(!c.url.includes(KEYS.crew));
  }
  // a reply that is a web page: when connecting, or a page not found, the address is wrong (or access is not set to anyone);
  // Google's error page from a hub that answered before (a script timeout, a daily limit) is the hub's problem, not the link
  const html = status => async () => ({ ok: status < 300, status, json: async () => { throw new SyntaxError('<html>'); } });
  const page = await makePhone(hub, 'crew', { fetchImpl: html(200) });
  await page.cycle();
  assert.deepEqual([page.sync.hubStatus().state, page.sync.hubStatus().message], ['error', 'The hub had a problem. Trying again shortly.']);
  assert.equal((await page.sync.connect(URL_A, KEYS.crew)).message, 'That address did not answer like the hub. Check the hub link.');
  const gone = await makePhone(hub, 'crew', { fetchImpl: html(404) });
  await gone.cycle();
  assert.equal(gone.sync.hubStatus().message, 'That address did not answer like the hub. Check the hub link.');
  // a request that never answers is cut off by the timeout
  const slow = await makePhone(hub, 'crew', { fetchImpl: (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))) });
  const run = slow.cycle();
  await settle();
  assert.deepEqual(slow.timers.pending(), [30e3]);
  await slow.timers.fire(); await run;
  assert.equal(slow.sync.hubStatus().state, 'offline');
  // hub.fail with a server message that echoes the key: never shown
  hub.fail = req => ({ ok: false, error: 'bad_request', message: req.key });
  const echo = await makePhone(hub, 'crew');
  await echo.cycle();
  assert.ok(!JSON.stringify([echo.statuses, echo.sync.hubStatus(), echo.toasts]).includes(KEYS.crew));
  // the thin wrappers answer with ok:false instead of throwing
  hub.fail = null; hub.down = true;
  const r = await cp.sync.stats();
  assert.deepEqual([r.ok, r.error], [false, 'offline']);
  hub.down = false;
  assert.equal((await cp.sync.records({ kind: 'tasks' })).error, 'forbidden');
  assert.equal((await cp.sync.rotate('pm')).ok, false);
  assert.equal((await cp.sync.archive('yesterday')).ok, false);
  const pm = await makePhone(hub, 'pm');
  assert.equal((await pm.sync.records({ kind: 'tasks', from: DAY, to: DAY, q: 'E-301', who: 'x'.repeat(500) })).ok, true);
  assert.equal(hub.calls.at(-1).body.who.length, 60, 'queries are clipped before they go out');
  assert.equal((await pm.sync.archive(ago(90))).ok, true);
  assert.equal((await pm.sync.selftest()).ok, true);
  assert.equal((await pm.sync.stats()).ok, true);
});

test('a phone that is full stops the merge cleanly, keeps nothing half-done, and catches up when there is room', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super'), cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  const uid = sp.addTask();
  await sp.cycle();
  cp.storage.failOn.add('schwab.tasks');
  await cp.cycle();
  const st = cp.sync.hubStatus();
  assert.deepEqual([st.state, st.message], ['error', 'This phone is out of space, so hub updates could not be saved. Download a backup and free some space.']);
  assert.equal(cp.task(uid), undefined);
  assert.equal(cp.hubSync()?.rev || 0, 0, 'not recorded as pulled');
  cp.storage.failOn.clear();
  cp.sync.wake('online'); await settle();
  assert.equal(cp.sync.hubStatus().state, 'live');
  assert.equal(cp.task(uid).scope, 'Pull 12 AWG');
});

test('shared settings: the office pushes them, every phone adopts them, secrets and personal settings stay put', async () => {
  const hub = fresh(), pinA = '0123456789abcdef:' + 'a'.repeat(64), pinB = 'fedcba9876543210:' + 'b'.repeat(64);
  const sp = await makePhone(hub, 'super');
  sp.save('schwab.settings', { ...sp.settings(), floors: ['Basement', 'Level 1'], crews: [{ name: 'Crew A', lead: 'Mike', members: 'Mike, Jose' }], checks: ['Labeling'], pin: pinA,
    folderUrl: 'https://script.google.com/macros/s/FOLDER/exec', siteCode: 'SITESECRET'.padEnd(32, 'x'), me: 'Sue', worker: 'Sue' });
  await sp.cycle();
  assert.deepEqual(Object.keys(hub.config).sort(), ['at', 'checks', 'crews', 'floors', 'people', 'pin', 'pm', 'project', 'site', 'super']);
  assert.ok(!JSON.stringify(hub.config).includes('SITESECRET') && !JSON.stringify(hub.config).includes(KEYS.super), 'folder code and hub key never leave a phone');
  const S = {}, cp = await makePhone(hub, 'crew', { crew: 'Crew A', S, worker: 'Jose L' });
  await cp.cycle();
  const c = cp.settings();
  assert.deepEqual([c.floors, c.crews[0].lead, c.checks, c.pin], [['Basement', 'Level 1'], 'Mike', ['Labeling'], pinA]);
  assert.deepEqual([c.hubKey, c.worker, c.device, c.hubRole], [KEYS.crew, 'Jose L', c.device, 'crew'], 'personal and hub settings are untouched');
  assert.equal(cp.storage.get('schwab.pin'), pinA);
  assert.ok(cp.changes.some(x => x.kinds.includes('settings')));
  assert.deepEqual(S.floors, ['Basement', 'Level 1'], "the app's own settings object follows");
  // a phone with its own passcode keeps it
  const own = await makePhone(hub, 'crew', { crew: 'Crew A' });
  own.save('schwab.settings', { ...own.settings(), pin: pinB }); own.save('schwab.pin', pinB);
  await own.cycle();
  assert.equal(own.settings().pin, pinB);
  assert.equal(own.settings().floors[1], 'Level 1');
  // a new office phone joining adopts the hub's settings instead of pushing its defaults
  const sp2 = await makePhone(hub, 'super');
  const before = JSON.stringify(hub.config);
  await sp2.cycle();
  assert.equal(JSON.stringify(hub.config), before);
  assert.deepEqual(sp2.settings().floors, ['Basement', 'Level 1']);
  // and a later edit goes up and comes down
  tick(30e3);
  sp2.save('schwab.settings', { ...sp2.settings(), floors: ['Roof'] });
  await stable(sp2, cp, sp);
  assert.deepEqual([hub.config.floors, cp.settings().floors, sp.settings().floors], [['Roof'], ['Roof'], ['Roof']]);
});

test('daily report: the super part and the PM part are separate and each side keeps its own words', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super'), pm = await makePhone(hub, 'pm'), cp = await makePhone(hub, 'crew');
  sp.editReport(DAY, r => { Object.assign(r, { status: 'On plan', results: 'Pulled wire', submittedAt: sp.now(), decisions: [{ q: 'Saturday OT?', rec: 'Yes', by: DAY, pm: '', pmNote: '' }] }); });
  await stable(sp, pm, cp);
  assert.equal(hub.reports.get(DAY).results, 'Pulled wire');
  assert.equal(pm.reports()[DAY].results, 'Pulled wire');
  assert.deepEqual(cp.reports(), {}, 'a crew phone neither gets nor sends reports');
  tick(60e3);
  pm.editReport(DAY, r => { r.decisions[0].pm = 'Approved'; r.decisions[0].pmNote = 'ok'; r.pmReview = 'PM 5 PM'; });
  await pm.cycle();
  const w = hub.calls.filter(c => c.action === 'push').at(-1).body.reports[0];
  assert.ok(w.pmAt > 0 && w.updatedAt === 0 && !('results' in w), 'a PM answer sends only the PM part');
  assert.equal(hub.reports.get(DAY).decisions.find(d => d.q === 'Saturday OT?').pm, 'Approved');
  await sp.cycle();
  const seen = sp.reports()[DAY];
  assert.deepEqual([seen.decisions[0].pm, seen.decisions[0].pmNote, seen.pmReview, seen.results], ['Approved', 'ok', 'PM 5 PM', 'Pulled wire']);
  // the PM edits a note offline while the superintendent rewords the question and adds wins
  pm.net.down = true; tick(30e3);
  pm.editReport(DAY, r => { r.decisions[0].pmNote = 'changed note'; }); await pm.cycle();
  tick(30e3);
  sp.editReport(DAY, r => { r.wins = 'new wins'; r.decisions[0].q = 'Saturday overtime?'; });
  await sp.cycle();
  pm.net.down = false;
  await stable(pm, sp);
  const mine = pm.reports()[DAY];
  assert.equal(mine.wins, 'new wins');
  assert.ok(mine.decisions.some(d => d.q === 'Saturday overtime?' && d.rec === 'Yes'));
  assert.ok(mine.decisions.some(d => d.q === 'Saturday OT?' && d.pm === 'Approved' && d.pmNote === 'changed note'), 'an answer to a reworded question is kept as its own entry');
  assert.equal(hub.reports.get(DAY).wins, 'new wins');
  assert.equal(hub.reports.get(DAY).decisions.find(d => d.q === 'Saturday OT?').pmNote, 'changed note');
  // stable: nothing more to send
  const pushes = hub.count('push');
  await stable(sp, pm);
  assert.equal(hub.count('push'), pushes);
});

test('live data: events newest first, capped, and the on-site list', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super'), w = await makePhone(hub, 'crew', { worker: 'Jose L' });
  w.clockIn('Jose L');
  await w.cycle();
  for (let i = 0; i < 60; i++) hub.events.push({ rev: hub.bump(), ts: T0 + i, who: 'Jose L', role: 'crew', kind: 'clock in', text: 'Jose L clocked in', ref: '' });
  await sp.cycle();
  const live = sp.sync.liveData();
  assert.equal(live.events.length, 50);
  assert.ok(live.events[0].rev > live.events[1].rev);
  assert.deepEqual(live.onsite.map(x => x.who), ['Jose L']);
  assert.equal(live.info.role, undefined, 'info only fills after a whoami');
});

test('the app hears about every change after it is saved, and a first-time role gets a full pull', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super'), cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  const uid = sp.addTask();
  await sp.cycle();
  await cp.cycle();
  assert.equal(cp.changes.length, 1);
  assert.deepEqual(cp.changes[0].kinds, ['tasks']);
  assert.equal(cp.changes[0].tasks[0].uid, uid, 'the store already holds the new data when onChange runs');
  assert.deepEqual(hub.calls.filter(c => c.action === 'pull' && c.body.devSecret === cp.secret).map(c => c.body.since), [0, hub.rev], 'first contact: a full pull, then (after the push) only what changed');
  await cp.cycle();
  assert.ok(hub.calls.filter(c => c.action === 'pull').at(-1).body.since > 0, 'then only what changed');
  assert.equal(cp.changes.length, 1);
  // a hub that was rebuilt (its counter went back) is pulled in full again
  hub.rev = 1;
  await cp.cycle(); await cp.cycle();
  assert.ok(hub.calls.filter(c => c.action === 'pull').slice(-3).some(c => c.body.since === 0));
});

test('every phrase sync.mjs shows has Spanish with the same placeholders, and no Spanish entry is left over', async () => {
  const dir = path.join(__dirname, '..', 'docs', 'schwab'), src = fs.readFileSync(path.join(dir, 'sync.mjs'), 'utf8');
  const file = process.env.ES_SYNC_JSON || '/tmp/claude-0/-home-user-ponytail/a49885c6-54fd-5839-a3da-110b17505f82/scratchpad/es/es-sync.json'; // until integration folds it into es.mjs
  const idFile = file.replace(/es-sync\.json$/, 'es-identity-client.json'); // this round's new phrases, the same way
  const read = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}), extra = read(file);
  const ES = { ...(await import('../docs/schwab/es.mjs')).default, ...read(idFile), ...extra };
  const used = new Set();
  for (const m of src.matchAll(/\b(?:L|x)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g)) used.add(m[2].replace(/\\(.)/g, '$1'));
  assert.ok(used.size >= 15, 'the scan found the phrases');
  const holes = s => (s.match(/\{\w+\}/g) || []).sort().join(' '), DASH = String.fromCharCode(8212);
  for (const en of used) {
    assert.ok(Object.hasOwn(ES, en), `missing Spanish for: ${en}`);
    assert.equal(holes(ES[en]), holes(en), `placeholders differ in: ${en}`);
    assert.ok(!ES[en].includes(DASH), 'no em dash');
  }
  for (const en of Object.keys(extra)) assert.ok(used.has(en), `Spanish entry no longer used: ${en}`);
  for (const f of [path.join(dir, 'sync.mjs'), __filename]) assert.ok(!fs.readFileSync(f, 'utf8').includes(DASH), `no em dash in ${path.basename(f)}`);
});

// ---------- many phones, random edits, random signal gaps ----------

const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const view = t => ({ scope: t.scope, followUp: t.followUp, doneText: t.doneText, status: t.status, comments: t.comments, items: t.items.map(i => [i.id, i.text, !!i.done]), checks: t.checks.map(i => [i.id, i.text, !!i.done]) });

async function crowd(seed, { shared }) {
  const R = rng(seed), pickOne = l => l[Math.floor(R() * l.length)], hub = fresh();
  const sp = await makePhone(hub, 'super', { offset: 0 }), pm = await makePhone(hub, 'pm', { offset: 40e3 });
  const a1 = await makePhone(hub, 'crew', { crew: 'Crew A', worker: 'Ann A', offset: -90e3 }), a2 = await makePhone(hub, 'crew', { crew: 'Crew A', worker: 'Al A', offset: 20e3 });
  const b = await makePhone(hub, 'crew', { crew: 'Crew B', worker: 'Bo B', offset: 100e3 });
  const all = [sp, pm, a1, a2, b], crewOf = { [a1.n]: 'Crew A', [a2.n]: 'Crew A', [b.n]: 'Crew B' };
  const uids = [sp.addTask({ crew: 'Crew A', id: 'T1' }), sp.addTask({ crew: 'Crew A', id: 'T2' }), sp.addTask({ crew: 'Crew B', id: 'T3' })];
  const crewUids = c => uids.filter(u => sp.task(u).crew === c);
  sp.editReport(DAY, r => { Object.assign(r, { status: 'On plan', decisions: [{ q: 'Q1', rec: 'r', by: DAY, pm: '', pmNote: '' }] }); });
  const model = { scope: {}, follow: {}, added: {}, done: {}, status: {}, ticks: {}, shiftIn: {}, shiftOut: {}, pmIn: {}, pmOut: {}, results: '', answer: '', review: '' };
  const writer = c => (c === 'Crew A' ? (shared ? pickOne([a1, a2]) : a1) : b);
  const shifts = new Map(); // phone.n -> shift id
  for (let step = 0; step < 70; step++) {
    const op = R(), t = pickOne(uids);
    if (op < 0.12) { const v = `S${step}`; sp.editTask(t, x => { x.scope = v; }); model.scope[t] = v; }
    else if (op < 0.2) { const v = `F${step}`, who = shared ? pickOne([sp, pm]) : sp; if (who.task(t)) { who.editTask(t, x => { x.followUp = v; }); model.follow[t] = v; } }
    else if (op < 0.26) { const id = `n${step}`; sp.editTask(t, x => { x.items.push({ id, text: 'added ' + step, done: false, at: 0 }); }); (model.added[t] ||= []).push(id); }
    else if (op < 0.42) { const w = writer(sp.task(t).crew), loc = w.task(t); if (loc) { const id = pickOne(loc.items).id; const r = w.tick(t, id); (model.ticks[t] ||= {})[id] = r.items.find(i => i.id === id).done; } }
    else if (op < 0.52) { const w = writer(sp.task(t).crew); if (w.task(t)) { const v = `C${step}`, st = pickOne(['Partial', 'Complete', 'Blocked']); w.editTask(t, x => { x.doneText = v; x.status = st; }); model.done[t] = v; model.status[t] = st; } }
    else if (op < 0.6) { const w = pickOne([a1, a2, b]); if (!shifts.has(w.n)) shifts.set(w.n, w.clockIn(w.settings().worker)); else { const id = shifts.get(w.n), v = `1${step % 10}:${String(step % 60).padStart(2, '0')}`; if (!w.hours().find(s => s.id === id).out) { w.editHours(id, s => { s.out = v; }); model.shiftOut[id] = v; } } }
    else if (op < 0.68) { const s = pickOne(pm.crewHours()); if (s && !s.gone) { const f = R() < 0.5 ? 'in' : 'out', v = `0${step % 10}:${String((step * 7) % 60).padStart(2, '0')}`; pm.editCrewHours(s.id, x => { x[f] = v; x.edited[f] = true; }); model['pm' + (f === 'in' ? 'In' : 'Out')][s.id] = v; } }
    else if (op < 0.74) { const v = `R${step}`; sp.editReport(DAY, r => { r.results = v; }); model.results = v; }
    else if (op < 0.8) { const v = `P${step}`; if (pm.reports()[DAY]?.decisions[0]) { pm.editReport(DAY, r => { r.decisions[0].pm = v; r.pmReview = 'rev' + step; }); model.answer = v; model.review = 'rev' + step; } }
    else if (op < 0.9) { const p = pickOne(all); p.net.down = !p.net.down; }
    tick(Math.floor(R() * 90e3) + 1000);
    for (let k = 0; k < 1 + Math.floor(R() * 3); k++) await pickOne(all).cycle();
  }
  for (const p of all) p.net.down = false;
  for (let i = 0; i < 8; i++) { for (const p of all) { tick(2000); await p.cycle(); } }
  return { hub, sp, pm, a1, a2, b, all, uids, crewUids, model, shifts, crewOf };
}

test('many phones, random edits and signal gaps: every phone ends equal to the hub and no single-writer edit is lost', async () => {
  for (let seed = 1; seed <= 30; seed++) {
    const { hub, sp, pm, a1, a2, b, all, uids, model, shifts, crewOf } = await crowd(seed, { shared: false });
    const tag = `seed ${seed}`;
    assert.deepEqual(hub.violations, [], tag);
    for (const u of uids) {
      const rec = hub.tasks.get(u), hv = view(hub.taskView(rec)), crew = rec.a.crew;
      if (model.scope[u]) assert.equal(rec.a.scope, model.scope[u], `${tag} scope ${u}`);
      if (model.follow[u]) assert.equal(rec.a.followUp, model.follow[u], `${tag} followUp ${u}`);
      assert.deepEqual(rec.items.map(i => i.id), ['i1', 'i2', ...(model.added[u] || [])], `${tag} steps ${u}`);
      if (model.done[u]) assert.deepEqual([rec.c.doneText, rec.c.status], [model.done[u], model.status[u]], `${tag} results ${u}`);
      for (const [id, d] of Object.entries(model.ticks[u] || {})) assert.equal(!!rec.ticks.items[id]?.done, d, `${tag} tick ${u}/${id}`);
      for (const p of all) {
        const sees = p === sp || p === pm || crewOf[p.n] === crew;
        assert.deepEqual(p.task(u) ? view(p.task(u)) : null, sees ? hv : p.task(u) ? view(p.task(u)) : null, `${tag} ${p.role}${p.n} copy of ${u}`);
        if (sees) assert.ok(p.task(u), `${tag} ${p.role}${p.n} has ${u}`);
      }
    }
    for (const [pn, id] of shifts) {
      const hs = hub.shifts.get(id), w = [a1, a2, b].find(x => x.n === pn);
      assert.equal(hs.in, model.pmIn[id] || '07:00', `${tag} in ${id}`);
      if (model.pmOut[id] || model.shiftOut[id]) assert.equal(hs.out, model.pmOut[id] || model.shiftOut[id], `${tag} out ${id}`);
      const mine = w.hours().find(s => s.id === id), theirs = pm.crewHours().find(s => s.id === id);
      assert.deepEqual([mine.in, mine.out], [hs.in, hs.out], `${tag} worker copy ${id}`);
      assert.deepEqual([theirs.in, theirs.out, theirs.edited, theirs.gone], [hs.in, hs.out, hs.edited, hs.gone], `${tag} pm copy ${id}`);
    }
    const hr = hub.reports.get(DAY);
    const q1 = hr.decisions.find(d => d.q === 'Q1');
    if (model.results) assert.equal(hr.results, model.results, `${tag} report`);
    if (model.answer) assert.deepEqual([q1.pm, hr.pmReview], [model.answer, model.review], `${tag} answer`);
    for (const p of [sp, pm]) assert.deepEqual([p.reports()[DAY].results, p.reports()[DAY].decisions[0].pm, p.reports()[DAY].pmReview], [hr.results ?? '', q1?.pm ?? '', hr.pmReview], `${tag} ${p.role} report`);
    const pushes = hub.count('push');
    for (const p of all) await p.cycle();
    assert.equal(hub.count('push'), pushes, `${tag} nothing left to send`);
    for (const p of all) assert.equal(p.sync.hubStatus().pending, 0, `${tag} pending`);
  }
});

test('two phones writing the same part, two office phones writing the same sheet: they still end identical to the hub', async () => {
  for (let seed = 101; seed <= 130; seed++) {
    const { hub, sp, pm, a1, a2, b, all, uids, crewOf } = await crowd(seed, { shared: true });
    for (const u of uids) {
      const hv = view(hub.taskView(hub.tasks.get(u)));
      for (const p of all) if (p === sp || p === pm || crewOf[p.n] === hub.tasks.get(u).a.crew) assert.deepEqual(view(p.task(u)), hv, `seed ${seed} ${p.role}${p.n} ${u}`);
    }
    assert.deepEqual(hub.violations, []);
  }
});

test('large and awkward pushes: chunks under the hub caps, one bad sheet cannot block the rest, an oversize sheet is set aside, a lost request is not repeated in full', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super');
  const ids = Array.from({ length: 250 }, (_, i) => sp.addTask({ id: `T${i}`, scope: `job ${i}` }));
  const poison = sp.addTask({ id: 'POISON', scope: 'POISON' }), huge = sp.addTask({ id: 'HUGE', scope: 'x'.repeat(50000) });
  hub.fail = req => (req.action === 'push' && JSON.stringify(req.tasks).includes('POISON') ? hub.err('bad_request') : null);
  await sp.cycle();
  const pushes = hub.calls.filter(c => c.action === 'push');
  assert.ok(pushes.every(c => c.body.tasks.length <= 100 && c.init.body.length < 1e6), 'no request goes past the hub caps');
  assert.ok(ids.every(u => hub.tasks.has(u)), 'every good sheet arrived');
  assert.ok(!hub.tasks.has(poison) && !hub.tasks.has(huge));
  assert.equal(sp.toasts.filter(t => t.includes('did not accept')).length, 1);
  assert.match(sp.toasts[0], /accept: 2\./, 'the poisoned sheet and the oversize one, in one notice');
  hub.fail = null;
  const n = hub.count('push');
  await sp.cycle(); await sp.cycle();
  assert.equal(hub.count('push'), n, 'the two refused sheets are left alone');
  assert.equal(sp.sync.hubStatus().state, 'live');
  // a request lost half way: the batch that did go through is not sent again
  const more = Array.from({ length: 150 }, (_, i) => sp.addTask({ id: `M${i}`, scope: 'more ' + i }));
  let seen = 0;
  hub.before = async req => { if (req.action === 'push' && ++seen === 2) hub.down = true; };
  await sp.cycle();
  assert.equal(sp.sync.hubStatus().state, 'offline');
  hub.before = null; hub.down = false;
  const before = hub.count('push');
  await sp.cycle();
  const resent = hub.calls.filter(c => c.action === 'push').slice(before).flatMap(c => c.body.tasks);
  assert.equal(resent.length, 50, 'only the 50 that never arrived go again');
  assert.ok(more.every(u => hub.tasks.has(u)));
  // a big sheet the hub already has: with its office part as last had (assignBase) it would pass the cap, so it goes without it
  const big = more[0];
  sp.editTask(big, t => { t.scope = 'y'.repeat(25000); }); await sp.cycle();
  tick(1000); sp.editTask(big, t => { t.scope = 'z'.repeat(25000); }); await sp.cycle();
  const last = hub.calls.filter(c => c.action === 'push').at(-1).body.tasks[0];
  assert.deepEqual([last.uid, 'assignBase' in last, hub.tasks.get(big).a.scope[0]], [big, false, 'z']);
});

test('a hub that answers a push with no per-sheet list is taken at its ok; a request-level refusal makes the phone ask for its role again', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super');
  sp.addTask();
  hub.mute = true;
  await sp.cycle();
  const n = hub.count('push');
  await sp.cycle(); await sp.cycle();
  assert.equal(hub.count('push'), n, 'not pushed again and again');
  hub.mute = false;
  sp.editTask(sp.tasks()[0].uid, t => { t.lead = 'Mike'; });
  hub.fail = req => (req.action === 'push' ? hub.err('forbidden') : null);
  await sp.cycle();
  assert.equal(sp.sync.hubStatus().state, 'error');
  assert.equal(sp.settings().hubRole, '', 'the role will be asked again');
  hub.fail = null;
  sp.sync.wake('online'); await settle();
  assert.equal(sp.settings().hubRole, 'super');
  assert.equal(sp.sync.hubStatus().state, 'live');
  assert.equal(hub.tasks.get(sp.tasks()[0].uid).c.lead, 'Mike');
});

test('answers to the thin wrappers are normalized before they reach a screen', async () => {
  const hub = fresh(), pm = await makePhone(hub, 'pm');
  hub.records = () => ({ ok: true, cursor: 'c'.repeat(500), items: [{ uid: 'a1', date: DAY, scope: 'old sheet', size: 'x', zzz: 1 }, { uid: 'bad uid!' }, 'junk'] });
  const r = await pm.sync.records({ kind: 'tasks', from: DAY, to: DAY });
  assert.deepEqual(r.items.map(t => [t.uid, t.scope, t.size, t.zzz]), [['a1', 'old sheet', 0, undefined]]);
  assert.equal(r.cursor.length, 200);
  hub.records = () => ({ ok: true, items: [{ x: 1 }] });
  assert.deepEqual((await pm.sync.records({ kind: 'galaxies' })).items, [], 'a kind this app does not know shows nothing');
  hub.stats = () => ({ ok: true, rows: { tasks: '5', evil: 1 }, cells: 12, cellLimit: 'lots', sheetUrl: 'javascript:alert(1)' });
  assert.deepEqual(await pm.sync.stats(), { ok: true, rows: { tasks: 0, shifts: 0, reports: 0, events: 0 }, cells: 12, cellLimit: 0, sheetUrl: '' });
  const a = await pm.sync.archive(ago(90));
  assert.deepEqual([a.ok, a.sheetUrl, a.moved], [true, '', { tasks: 4 }], 'only a Google Sheet link is passed on');
  assert.equal((await pm.sync.rotate('crew')).key, 'n'.repeat(32));
  hub.rotate = () => ({ ok: true, key: '<script>' });
  assert.equal((await pm.sync.rotate('super')).key, '');
  const c = await pm.sync.connect(URL_A, KEYS.pm);
  assert.equal(c.sheetUrl, 'https://docs.google.com/spreadsheets/d/x');
  hub.selftest = () => ({ ok: true, checks: [{ name: 'write', ok: true, detail: 5 }, 'junk'] });
  assert.deepEqual((await pm.sync.selftest()).checks.map(x => [x.name, x.ok, x.detail]), [['write', true, ''], ['', false, '']]);
});

test('timers alone carry an edit from one phone to another', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super'), cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  sp.sync.start(); cp.sync.start();
  await sp.timers.fire(); await cp.timers.fire();
  const uid = sp.addTask();
  sp.sync.poke();
  await sp.timers.fire(); // the 1.5 second poke (earlier than the 20 second beat)
  assert.ok(hub.tasks.has(uid));
  await cp.timers.fire();
  assert.ok(cp.task(uid), 'and the other phone has it on its next beat');
  assert.deepEqual(cp.changes.at(-1).kinds, ['tasks']);
});

test('connect keeps the shared settings object the app holds in step', async () => {
  const hub = fresh(), S = {}, p = await makePhone(hub, 'crew', { url: '', key: '', noRole: true, S });
  const r = await p.sync.connect(URL_A, KEYS.crew);
  assert.equal(r.ok, true);
  assert.deepEqual([S.hubUrl, S.hubKey, S.hubRole], [URL_A, KEYS.crew, 'crew']);
  p.sync.disconnect();
  assert.deepEqual([S.hubUrl, S.hubKey, S.hubRole], ['', '', '']);
});

test('the PM phone keeps a clock-out it holds that the hub does not have yet', async () => {
  const hub = fresh(), shared = await lib, pm = await makePhone(hub, 'pm'), w = await makePhone(hub, 'crew', { worker: 'Jose L' });
  const id = w.clockIn('Jose L');
  await w.cycle();
  assert.equal(hub.shifts.get(id).out, '');
  pm.save('schwab.crewHours', [shared.normShift({ id, device: w.dev, who: 'Jose L', date: DAY, in: '07:00', out: '15:00' })]); // the clock-out text was opened on the PM phone first
  await stable(pm, w);
  assert.equal(hub.shifts.get(id).out, '15:00', 'the clock-out reached the hub through the PM phone');
  assert.equal(w.hours()[0].out, '15:00');
});

test('a slow phone clock still ranks edits in real time', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super'), a = await makePhone(hub, 'crew', { crew: 'Crew A' }), slow = await makePhone(hub, 'crew', { crew: 'Crew A', offset: -10 * 60e3 });
  const uid = sp.addTask();
  await stable(sp, a, slow);
  tick(60e3);
  a.editTask(uid, t => { t.comments = 'A earlier'; }); await a.cycle();
  tick(60e3);
  slow.editTask(uid, t => { t.comments = 'slow phone, later in real time'; }); await slow.cycle();
  await stable(sp, a, slow);
  assert.equal(hub.tasks.get(uid).c.comments, 'slow phone, later in real time');
  assert.equal(a.task(uid).comments, 'slow phone, later in real time');
});

test('a disconnect during a cycle: the reply that arrives afterwards is ignored', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super'), cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  const uid = sp.addTask();
  await sp.cycle();
  hub.before = async req => { if (req.action === 'pull') { hub.before = null; cp.sync.disconnect(); } };
  await cp.cycle();
  assert.equal(cp.task(uid), undefined);
  assert.deepEqual([cp.hubSync().rev, cp.hubSync().sig, cp.hubSync().t], [0, '', {}], 'the late reply writes nothing for a hub the phone has left');
  assert.equal(cp.sync.hubStatus().state, 'off');
  assert.equal(cp.settings().hubUrl, '');
});

test('a big hub is read in pages and nothing between them is skipped', async () => {
  const hub = fresh(); hub.cap = 3;
  const sp = await makePhone(hub, 'super'), cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  const ids = Array.from({ length: 8 }, (_, i) => sp.addTask({ id: `P${i}` }));
  await sp.cycle();
  await cp.cycle();
  assert.deepEqual(cp.tasks().map(t => t.uid).sort(), ids.slice().sort());
  const pulls = hub.calls.filter(c => c.action === 'pull' && c.body.devSecret === cp.secret);
  assert.ok(pulls.length >= 3 && pulls.every(c => c.body.since >= 0));
  assert.ok(pulls[1].body.since > 0 && pulls[1].body.since < hub.rev, 'the next page starts where the last stopped');
});

test('refusals that fix themselves stay quiet: a deleted sheet, an archived one', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super'), pm = await makePhone(hub, 'pm');
  const uid = sp.addTask({ id: 'GONE' });
  await stable(sp, pm);
  sp.net.down = true; tick(5000);
  sp.editTask(uid, t => { t.scope = 'edited while the PM deleted it'; }); await sp.cycle();
  assert.equal((await pm.sync.purge('task', uid)).ok, true);
  sp.net.down = false;
  await stable(sp, pm);
  assert.equal(sp.task(uid), undefined);
  assert.deepEqual(sp.toasts, [], 'no notice for a sheet that was deleted on purpose');
  // an old sheet the hub has already moved to an archive sheet counts as filed
  const old = sp.addTask({ date: ago(100), id: 'OLD' });
  const push = hub.push;
  hub.push = function (role, dev, req) { const out = push.call(this, role, dev, req); out.tasks = out.tasks.map(t => (t.key === old ? { key: old, status: 'rejected', reason: 'archived' } : t)); return out; };
  await sp.cycle();
  assert.deepEqual(sp.toasts, []);
  assert.equal(sp.task(old), undefined, 'archived counts as on the hub, so the window can drop it');
});

test('settings: a stale offline edit does not beat a newer one, a newer one does', async () => {
  const hub = fresh(), a = await makePhone(hub, 'super'), b = await makePhone(hub, 'super');
  await stable(a, b);
  const floors = (p, f) => p.save('schwab.settings', { ...p.settings(), floors: f });
  b.net.down = true; tick(10e3);
  floors(b, ['stale offline']); await b.cycle();
  tick(30e3);
  floors(a, ['newer']); await a.cycle();
  b.net.down = false; tick(10e3);
  await stable(a, b);
  assert.deepEqual([hub.config.floors, a.settings().floors, b.settings().floors], [['newer'], ['newer'], ['newer']]);
  tick(30e3);
  floors(b, ['latest']); await stable(b, a);
  assert.deepEqual([hub.config.floors, a.settings().floors], [['latest'], ['latest']]);
});

test('the PM can take an answer back and the hub and the superintendent see it', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super'), pm = await makePhone(hub, 'pm');
  sp.editReport(DAY, r => { Object.assign(r, { status: 'On plan', decisions: [{ q: 'Q1', rec: 'r', by: DAY, pm: '', pmNote: '' }] }); });
  await stable(sp, pm);
  tick(30e3); pm.editReport(DAY, r => { r.decisions[0].pm = 'Approved'; }); await stable(pm, sp);
  assert.equal(sp.reports()[DAY].decisions[0].pm, 'Approved');
  tick(30e3); pm.editReport(DAY, r => { r.decisions[0].pm = ''; }); await stable(pm, sp);
  assert.equal(hub.reports.get(DAY).decisions[0].pm, '');
  assert.equal(sp.reports()[DAY].decisions[0].pm, '');
});

test('initHub: the browser events run cycles, a second call replaces the first, and the module helpers follow the instance', async () => {
  const mod = await syncLib, hub = fresh(), storage = memStorage(), timers = manualTimers(ms => tick(ms)), on = {};
  storage.set('schwab.settings', { device: 'dev-init', hubUrl: URL_A, hubKey: KEYS.crew, hubRole: 'crew', hubCrew: 'Crew A' });
  const g = globalThis, saved = { document: g.document, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener };
  g.document = { hidden: false, addEventListener: (t, f) => (on['d:' + t] = f), removeEventListener: (t, f) => { if (on['d:' + t] === f) delete on['d:' + t]; } };
  g.addEventListener = (t, f) => (on['w:' + t] = f); g.removeEventListener = (t, f) => { if (on['w:' + t] === f) delete on['w:' + t]; };
  try {
    const opts = { storage, fetchImpl: hub.fetch, now: clock, timers, hidden: () => g.document.hidden, ensureDevice: ensureIn(storage) };
    mod.initHub(opts);
    assert.deepEqual(Object.keys(on).sort(), ['d:visibilitychange', 'w:focus', 'w:online']);
    await timers.fire(); // start(): the first cycle
    assert.equal(mod.hubStatus().state, 'live');
    const n = hub.calls.length;
    tick(6e3); on['w:focus'](); await settle();
    assert.ok(hub.calls.length > n, 'focus runs a cycle');
    const m = hub.calls.length;
    g.document.hidden = true; on['d:visibilitychange'](); await settle();
    assert.ok(hub.calls.length > m, 'hiding the page flushes');
    g.document.hidden = false;
    mod.poke(); assert.ok(timers.pending().includes(1500));
    assert.deepEqual(await mod.translate(['hello'], 'en', 'es'), ['~hello']);
    assert.equal((await mod.stats()).error, 'forbidden');
    const first = on['d:visibilitychange'];
    mod.initHub(opts);
    assert.notEqual(on['d:visibilitychange'], first, 'the old listeners were taken off before the new ones went on');
    assert.equal(Object.keys(on).length, 3);
    mod.disconnect();
    assert.equal(mod.hubStatus().state, 'off');
  } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete g[k]; else g[k] = saved[k]; } }
});

test('against the real hub/Code.gs (through the Google mock): a crew, a superintendent and the PM through a working day', async () => {
  const { createHub } = require('./helpers/google-mock'), shared = await lib, { unpack } = shared;
  const mock = createHub({ now: T0 }), k = mock.setup();
  let pushes = 0;
  const real = { clock: () => mock.now(), fetch: async (url, init) => { if (JSON.parse(init.body).action === 'push') pushes++; const text = mock.raw(init.body); return { ok: true, status: 200, json: async () => JSON.parse(text) }; } };
  const rowsOf = title => { const head = mock.header(title); return mock.table(title).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))); };
  const sp = await makePhone(real, 'super', { key: k.super }), pm = await makePhone(real, 'pm', { key: k.pm }), cp = await makePhone(real, 'crew', { key: k.crew, crew: 'Crew A', worker: 'Jose L' });
  const settleAll = async (...ps) => { for (let i = 0; i < 3; i++) for (const p of ps) { mock.advance(25e3); await p.cycle(); } };
  // the superintendent sets up the project and sends a sheet (a draft never reaches a crew phone)
  sp.save('schwab.settings', { ...sp.settings(), floors: ['Basement', 'Level 3'], crews: [{ name: 'Crew A', lead: 'Mike', members: 'Mike, Jose L' }] });
  const uid = sp.addTask({ id: 'T1019-01', floor: 'Level 3', scope: 'Pull 12 AWG to E-301', lead: 'Mike', sentAt: sp.now() });
  await sp.cycle();
  assert.equal(sp.sync.hubStatus().state, 'live', sp.sync.hubStatus().message);
  assert.deepEqual(rowsOf('Tasks').map(r => [r['Task ID'], r.Scope]), [['T1019-01', 'Pull 12 AWG to E-301']]);
  // the crew phone gets the sheet and the project settings, then works
  mock.advance(60e3); await cp.cycle();
  assert.equal(cp.task(uid)?.origin, 'link');
  assert.deepEqual(cp.settings().floors, ['Basement', 'Level 3']);
  const roster = p => { const s = shared.normSettings(clone(p.settings())); return [s.crews.map(c => [c.id, c.name]), s.people.map(x => [x.id, x.name, x.crewId])]; };
  assert.deepEqual(roster(cp), roster(sp), 'the roster came through the real hub with its ids');
  assert.deepEqual(roster(cp)[1].map(x => x[1]), ['Mike', 'Jose L']);
  cp.tick(uid, 'i1'); cp.editTask(uid, t => { t.aStart = '07:00'; t.status = 'Partial'; t.doneText = 'Pulled 4 of 12'; });
  mock.advance(20e3); await cp.cycle();
  assert.equal(cp.sync.hubStatus().state, 'live', cp.sync.hubStatus().message);
  const row = rowsOf('Tasks')[0];
  assert.deepEqual([row.Status, row['Steps done'], row.Completed], ['Partial', '1/2', 'Pulled 4 of 12']);
  assert.ok(mock.col('Activity', 'What').some(w => w.includes('T1019-01 marked Partial')));
  await settleAll(sp, pm);
  assert.deepEqual([sp.task(uid).status, sp.task(uid).items[0].done, sp.task(uid).scope], ['Partial', true, 'Pull 12 AWG to E-301']);
  assert.ok(pm.sync.liveData().events.some(e => e.text.includes('marked Partial')), 'the PM feed has it');
  // hours: the worker clocks in, the PM fixes the time, the worker clocks out
  const id = cp.clockIn('Jose L', { crew: 'Crew A', tasks: [{ uid, id: 'T1019-01' }] });
  await settleAll(cp, pm);
  assert.equal(pm.crewHours().length, 1);
  pm.editCrewHours(id, s => { s.in = '07:30'; s.edited.in = true; });
  await settleAll(pm, cp);
  assert.equal(cp.hours()[0].in, '07:30');
  cp.editHours(id, s => { s.out = '15:30'; });
  await settleAll(cp, pm);
  const h = rowsOf('Hours')[0];
  assert.deepEqual([h.Name, h.Hours, h.Crew, h.Tasks], ['Jose L', 8, 'Crew A', 'T1019-01']);
  assert.ok(h['Edited by PM']);
  assert.deepEqual(rowsOf('Weekly totals').map(r => [r.Name, r.Hours, r.Shifts]), [['Jose L', 8, 1]]);
  assert.equal(pm.crewHours()[0].out, '15:30');
  // the daily report: super part and PM part
  sp.editReport(DAY, r => { Object.assign(r, { status: 'On plan', results: 'Good day', submittedAt: sp.now(), decisions: [{ q: 'Saturday OT?', rec: 'Yes', by: DAY, pm: '', pmNote: '' }] }); });
  await settleAll(sp, pm);
  pm.editReport(DAY, r => { r.decisions[0].pm = 'Approved'; r.pmReview = 'PM reviewed'; });
  await settleAll(pm, sp);
  assert.deepEqual([sp.reports()[DAY].decisions[0].pm, sp.reports()[DAY].pmReview, sp.reports()[DAY].results], ['Approved', 'PM reviewed', 'Good day']);
  assert.equal(rowsOf('Reports')[0]['PM review'], 'PM reviewed');
  // translation on the real service double: the drawing number survives, the second ask is free
  const [es] = await cp.sync.translate(['Pull wire to E-301 on Level 3'], 'en', 'es');
  assert.ok(es.includes('E-301') && es !== 'Pull wire to E-301 on Level 3' && !/[<>]/.test(es), es);
  const spent = mock.translateLog.length;
  assert.deepEqual(await cp.sync.translate(['Pull wire to E-301 on Level 3'], 'en', 'es'), [es]);
  assert.equal(mock.translateLog.length, spent);
  // the PM's tools: stats, selftest, an invite, a rotation that locks the old key out
  assert.equal((await pm.sync.stats()).ok, true);
  assert.ok((await pm.sync.selftest()).checks.every(c => c.ok), 'the hub self test passes');
  assert.equal((await pm.sync.records({ kind: 'tasks', from: DAY, to: DAY })).items.length, 1);
  const inv = await pm.sync.invite('crew', 'Crew A');
  assert.equal((await unpack(inv.url.split('#p=')[1])).hub.key, k.crew);
  assert.equal((await pm.sync.rotate('crew')).ok, true);
  mock.advance(30e3); await cp.cycle();
  assert.equal(cp.sync.hubStatus().state, 'error');
  const again = await cp.sync.joinFrom(await unpack((await pm.sync.invite('crew', 'Crew A')).url.split('#p=')[1]));
  assert.equal(again.ok, true);
  await settleAll(cp);
  assert.equal(cp.sync.hubStatus().state, 'live');
  // the PM deletes the sheet: gone from the Sheet and from every phone
  assert.equal((await pm.sync.purge('task', uid)).ok, true);
  await settleAll(sp, cp, pm);
  assert.deepEqual([sp.task(uid), cp.task(uid), pm.task(uid)], [undefined, undefined, undefined]);
  assert.equal(rowsOf('Tasks').length, 0);
  assert.equal(rowsOf('Deleted').length, 1);
  // and everything is quiet: nothing left to send, no refusals anywhere
  const before = pushes;
  await settleAll(sp, cp, pm);
  assert.equal(pushes, before);
  assert.deepEqual([sp.toasts, pm.toasts, cp.toasts], [[], [], ['The hub did not accept this phone. Ask the PM for a new invite link. [bad]']], 'no refusals; the crew phone was told once when its key was replaced');
  for (const p of [sp, pm, cp]) assert.equal(p.sync.hubStatus().pending, 0);
});

test('edits tapped while a pull is in flight are kept: a clock-out over a PM edit, a settings change over a hub one', async () => {
  const hub = fresh(), pm = await makePhone(hub, 'pm'), w = await makePhone(hub, 'crew', { crew: 'Crew A', worker: 'Jose L' });
  const a = await makePhone(hub, 'super'), b = await makePhone(hub, 'super');
  const id = w.clockIn('Jose L', { crew: 'Crew A', tasks: [{ uid: 'u-t1', id: 'T1' }] });
  await stable(w, pm, a, b);
  tick(60e3);
  pm.editCrewHours(id, s => { s.in = '07:30'; s.edited.in = true; s.crew = 'Crew B'; });
  await pm.cycle();
  a.save('schwab.settings', { ...a.settings(), floors: ['from the other office phone'] });
  await a.cycle();
  tick(60e3);
  // while the worker's and b's pulls are on the wire, each person taps something
  hub.before = async req => {
    if (req.action !== 'pull') return;
    if (req.devSecret === w.secret) { hub.before = null; w.editHours(id, s => { s.out = '15:30'; s.crew = 'Crew A'; }); }
  };
  await w.cycle();
  assert.deepEqual([w.hours()[0].in, w.hours()[0].out], ['07:30', '15:30'], "the PM's fix and the clock-out both stand");
  assert.equal(w.hours()[0].crew, 'Crew B', "the PM touched the shift: its crew is the PM's");
  await stable(w, pm);
  assert.deepEqual([hub.shifts.get(id).in, hub.shifts.get(id).out, hub.shifts.get(id).crew], ['07:30', '15:30', 'Crew B']);
  hub.before = async req => { if (req.action === 'pull' && req.devSecret === b.secret) { hub.before = null; b.save('schwab.settings', { ...b.settings(), floors: ['typed on b meanwhile'] }); } };
  tick(10e3);
  await b.cycle();
  assert.deepEqual(b.settings().floors, ['typed on b meanwhile'], 'a newer unsynced edit is not replaced by the hub copy');
  await stable(b, a);
  assert.deepEqual([hub.config.floors, a.settings().floors], [['typed on b meanwhile'], ['typed on b meanwhile']]);
  // a worker picks which Jose they are and the sheet they are on while their clock-out's echo is on the wire: both are kept
  const j = w.clockIn('Jose L', { crew: 'Crew A' });
  await stable(w);
  tick(60e3);
  w.editHours(j, s => { s.out = '16:00'; });
  hub.before = async req => { if (req.action === 'pull' && req.devSecret === w.secret) { hub.before = null; w.editHours(j, s => Object.assign(s, { pid: 'p2', crewId: 'cA', tasks: [{ uid: 'u-late', id: 'T9' }] })); } };
  await w.cycle();
  assert.deepEqual([w.hours().find(s => s.id === j).out, w.hours().find(s => s.id === j).pid, w.hours().find(s => s.id === j).tasks], ['16:00', 'p2', [{ uid: 'u-late', id: 'T9' }]]);
  await stable(w);
  assert.deepEqual([hub.shifts.get(j).pid, hub.shifts.get(j).tasks], ['p2', [{ uid: 'u-late', id: 'T9' }]]);
});

// ---------- identity (HUB.md, Identity): devices by secret, people and crews by id, sheets by uid ----------

// shared.mjs keeps its own storage (ensureDevice, backupData, restoreData read and write localStorage): point it at a phone's.
async function withLocal(storage, fn) {
  globalThis.localStorage = { getItem: k => (storage.m.has(k) ? storage.m.get(k) : null), setItem: (k, v) => { storage.m.set(k, String(v)); }, removeItem: k => { storage.m.delete(k); } };
  try { return await fn(); } finally { delete globalThis.localStorage; }
}

test('a phone from before device secrets makes one when it connects, and its own shifts take the id the hub derives', async () => {
  const hub = fresh(), shared = await lib;
  const w = await makePhone(hub, 'crew', { crew: 'Crew A', worker: 'Jose L', noDevice: true, device: 'oldrandom1', ensureDevice: shared.ensureDevice });
  const today = w.clockIn('Jose L'), before = w.clockIn('Jose L', { date: ago(1), out: '15:00' });
  assert.deepEqual(w.hours().map(s => s.device), ['oldrandom1', 'oldrandom1'], 'clocked in under the older random id');
  await withLocal(w.storage, () => w.cycle());
  const d = w.storage.get('schwab.device');
  assert.match(d.secret, /^[A-Za-z0-9]{32}$/);
  assert.equal(d.id, devOf(d.secret), 'the id is the first 32 hex characters of SHA-256 of the secret (shared.mjs ensureDevice)');
  assert.deepEqual(w.hours().map(s => s.device), [d.id, d.id], "the phone's own shifts are relabeled");
  assert.equal(w.settings().device, d.id);
  assert.ok(w.changes.some(x => x.kinds.includes('hours')), 'the app is told to reload its time clock');
  assert.deepEqual([hub.shifts.get(today)?.device, hub.shifts.get(before)?.device], [d.id, d.id], "they reach the hub as this phone's");
  assert.equal(hub.calls[0].body.devSecret, d.secret, 'from the very first request');
  assert.deepEqual([w.sync.hubStatus().state, w.toasts], ['live', []]);
  // an old tab that still holds the old id saves a shift with it: the next cycle relabels that one too, and nothing else changes
  const n = w.changes.length;
  w.save('schwab.settings', { ...w.settings(), device: 'oldrandom1' });
  w.save('schwab.hours', [...w.hours(), shared.normShift({ id: 'oldtab1', device: 'oldrandom1', who: 'Jose L', date: DAY, in: '12:00' })]);
  await withLocal(w.storage, () => w.cycle());
  assert.equal(w.storage.get('schwab.device').secret, d.secret, 'the secret is made once');
  assert.deepEqual([w.hours().every(s => s.device === d.id), hub.shifts.get('oldtab1')?.device], [true, d.id]);
  assert.ok(w.changes.slice(n).some(x => x.kinds.includes('hours')));
  const m = w.changes.length;
  await withLocal(w.storage, () => w.cycle());
  assert.equal(w.changes.length, m, 'then nothing more to relabel');
});

test('against the real hub/Code.gs: a crew phone that sends another phone\'s device id can neither read nor change its hours; its own sync and the PM\'s edits still work', async () => {
  const { createHub } = require('./helpers/google-mock');
  const mock = createHub({ now: T0 }), k = mock.setup();
  const real = { clock: () => mock.now(), fetch: async (url, init) => { const text = mock.raw(init.body); return { ok: true, status: 200, json: async () => JSON.parse(text) }; } };
  const b = await makePhone(real, 'crew', { key: k.crew, crew: 'Crew A', worker: 'Ben B' }), pm = await makePhone(real, 'pm', { key: k.pm });
  // phone A puts B's device id on every request (it is no secret: it is in texts and in the Sheet)
  const forged = (url, init) => real.fetch(url, { ...init, body: JSON.stringify({ ...JSON.parse(init.body), dev: b.dev }) });
  const a = await makePhone(real, 'crew', { key: k.crew, crew: 'Crew A', worker: 'Al A', fetchImpl: forged });
  const step = async (...ps) => { for (let i = 0; i < 2; i++) for (const p of ps) { mock.advance(25e3); await p.cycle(); } };
  const sb = b.clockIn('Ben B', { crew: 'Crew A', tasks: [{ uid: 'u-b', id: 'T1019-01' }] });
  await step(b, pm);
  const onHub = id => pm.crewHours().find(s => s.id === id);
  assert.equal(onHub(sb)?.device, b.dev);
  const sa = a.clockIn('Al A', { crew: 'Crew A' });
  await step(a);
  assert.equal(a.sync.hubStatus().state, 'live', a.sync.hubStatus().message);
  assert.deepEqual(a.hours().map(s => s.id), [sa], "A holds its own shift and none of B's");
  // by hand, every way of naming B's phone: with A's secret, with no secret, with B's id on the shift itself
  const send = body => mock.send({ v: 1, key: k.crew, tasks: [], shifts: [], reports: [], deleted: [], ...body });
  const theirs = onHub(sb);
  for (const creds of [{ devSecret: a.secret, dev: b.dev }, { dev: b.dev }, {}]) {
    const tag = Object.keys(creds).join('+') || 'nothing';
    mock.advance(2e3);
    const pull = send({ action: 'pull', since: 0, days: 14, ...creds });
    assert.equal(pull.ok, true, tag);
    assert.ok(!pull.shifts.some(s => s.id === sb || s.device === b.dev), `${tag}: a pull shows none of B's hours`);
    const push = send({ action: 'push', ...creds, shifts: [{ ...theirs, out: '23:59', who: 'Changed by A', at: mock.now() }] });
    assert.deepEqual([tag, push.ok, push.shifts[0].status, push.shifts[0].reason], [tag, true, 'rejected', 'device'], `${tag}: B's shift cannot be changed`);
  }
  const claim = send({ action: 'push', devSecret: a.secret, dev: b.dev, shifts: [{ id: 'claimed1', device: b.dev, who: 'Ben B', date: DAY, in: '06:00', out: '', crew: 'Crew A', tasks: [], edited: { who: false, in: false, out: false }, gone: false, at: mock.now() }] });
  assert.equal(claim.shifts[0].status, 'ok');
  await step(pm, b);
  assert.deepEqual([onHub(sb).out, onHub(sb).who], ['', 'Ben B'], "B's shift is as B left it");
  assert.equal(onHub('claimed1').device, a.dev, "a shift A sends is A's, whatever device it names");
  assert.ok(!b.hours().some(s => s.id === 'claimed1'), "and it never shows on B's clock");
  // the PM edits both, both phones get the edit, and their clock-outs still go up
  pm.editCrewHours(sb, s => { s.in = '07:15'; s.edited.in = true; });
  pm.editCrewHours(sa, s => { s.in = '07:20'; s.edited.in = true; });
  await step(pm, a, b);
  assert.deepEqual([b.hours().find(s => s.id === sb).in, a.hours().find(s => s.id === sa).in], ['07:15', '07:20']);
  b.editHours(sb, s => { s.out = '15:00'; });
  a.editHours(sa, s => { s.out = '15:30'; });
  await step(a, b, pm);
  assert.deepEqual([onHub(sb).in, onHub(sb).out, onHub(sa).in, onHub(sa).out], ['07:15', '15:00', '07:20', '15:30']);
  assert.deepEqual(onHub(sb).tasks, [{ uid: 'u-b', id: 'T1019-01' }], 'the task link came through by uid');
  assert.deepEqual([a.toasts, b.toasts, pm.toasts], [[], [], []], 'no refusals for anything a phone did with its own hours');
});

test('two office phones offline give two sheets one number: every phone ends with both, and every shift points at its own sheet', async () => {
  const hub = fresh(), shared = await lib, { duplicateShortIds } = await syncLib;
  const s1 = await makePhone(hub, 'super'), pm = await makePhone(hub, 'pm');
  const ca = await makePhone(hub, 'crew', { crew: 'Crew A', worker: 'Jose L' }), cb = await makePhone(hub, 'crew', { crew: 'Crew B', worker: 'Jose L' });
  await stable(s1, pm, ca, cb);
  s1.net.down = pm.net.down = true;
  tick(60e3);
  const no = shared.nextId(s1.tasks(), DAY);
  const a = s1.addTask({ id: no, crew: 'Crew A', crewId: 'cA', members: ['Jose L'], memberIds: ['pA'], sentAt: s1.now() });
  const b = pm.addTask({ id: shared.nextId(pm.tasks(), DAY), crew: 'Crew B', crewId: 'cB', members: ['Jose L'], memberIds: ['pB'], sentAt: pm.now() });
  assert.equal(pm.task(b).id, no, 'the same number on both phones');
  // each sheet was texted to its crew, and each Jose clocks in on his own crew's phone (assignmentFor finds his sheet by his id)
  ca.save('schwab.tasks', [{ ...s1.task(a), origin: 'link' }]);
  cb.save('schwab.tasks', [{ ...pm.task(b), origin: 'link' }]);
  const on = (p, pid) => { const x = shared.assignmentFor(p.tasks(), 'Jose L', DAY, pid); return { pid, crew: x.crew, crewId: x.crewId, tasks: x.tasks }; };
  const ja = ca.clockIn('Jose L', on(ca, 'pA')), jb = cb.clockIn('Jose L', on(cb, 'pB'));
  // and tomorrow's plan, made on both phones and never texted: the same number again
  const TOM = shared.addDays(DAY, 1), no2 = shared.nextId(s1.tasks(), TOM);
  const c2 = s1.addTask({ id: no2, date: TOM, crew: 'Crew A' }), d2 = pm.addTask({ id: shared.nextId(pm.tasks(), TOM), date: TOM, crew: 'Crew B' });
  tick(60e3);
  s1.net.down = pm.net.down = false;
  await stable(s1, pm, ca, cb);
  // back online, each office phone reads the hub before it pushes a sheet the hub has not had (HUB.md, Identity): the PM phone
  // finds the superintendent's sheet with that day and number, so its own, never texted, takes the next free one
  const no3 = pm.task(d2).id;
  assert.notEqual(no3, no2);
  assert.deepEqual([s1.task(c2).id, pm.task(c2).id, hub.tasks.get(c2).a.id, s1.task(d2).id, hub.tasks.get(d2).a.id], [no2, no2, no2, no3, no3]);
  assert.deepEqual([duplicateShortIds(pm.tasks()).has(c2), s1.toasts, pm.toasts], [false, [], [`Your sheet ${no2} is now ${no3}: another sheet has that number.`]]);
  // both were sent, so both keep the number; every office phone holds both, as the hub does, and marks them
  assert.deepEqual([hub.tasks.get(a).a.id, hub.tasks.get(b).a.id], [no, no]);
  for (const p of [s1, pm]) {
    for (const u of [a, b]) assert.deepEqual(view(p.task(u)), view(hub.taskView(hub.tasks.get(u))), `${p.role} has ${u} as the hub does`);
    assert.deepEqual([...duplicateShortIds(p.tasks().filter(t => t.date === DAY))].sort(), [[a, [b]], [b, [a]]].sort(), `${p.role}: both are marked`);
  }
  for (const [id, u, crew, pid] of [[ja, a, 'Crew A', 'pA'], [jb, b, 'Crew B', 'pB']]) {
    const mine = [ca, cb].flatMap(p => p.hours()).find(s => s.id === id), timesheet = pm.crewHours().find(s => s.id === id);
    for (const [where, s] of [['hub', hub.shifts.get(id)], ['worker', mine], ['timesheet', timesheet]]) assert.deepEqual([s.tasks, s.pid, s.crewId], [[{ uid: u, id: no }], pid, crew === 'Crew A' ? 'cA' : 'cB'], `${where} ${id}`);
    assert.equal(pm.task(timesheet.tasks[0].uid).crew, crew, "the PM's timesheet opens this Jose's sheet, not the other one");
  }
  // an office phone that made a sheet before it ever connected: its number never got out, so it takes the next free one
  const s3 = await makePhone(hub, 'super');
  const c = s3.addTask({ id: no, crew: 'Crew A' }), e = s3.addTask({ id: no2, date: TOM, crew: 'Crew A', sentAt: s3.now() }); // e was texted: its crew has that number
  await s3.cycle();
  assert.deepEqual([s3.task(e).id, duplicateShortIds(s3.tasks()).get(e)], [no2, [c2]], 'a texted sheet keeps its number and is marked');
  const moved = s3.task(c).id;
  assert.notEqual(moved, no);
  assert.equal(moved, shared.nextId([s1.task(a), s1.task(b)], DAY));
  assert.equal(hub.tasks.get(c).a.id, moved, 'the hub only ever had the new number');
  assert.deepEqual(s3.toasts, [`Your sheet ${no} is now ${moved}: another sheet has that number.`]);
  await stable(s1, pm, s3);
  for (const p of [s1, pm, s3]) assert.deepEqual([p.task(c).id, duplicateShortIds(p.tasks()).has(c)], [moved, false]);
  const pushes = hub.count('push');
  await stable(s1, pm, ca, cb, s3);
  assert.equal(hub.count('push'), pushes, 'and it all settles: nothing renumbers back and forth');
});

test('a phone that connects again reads its own sheets back before it judges a number taken, however many pages that takes', async () => {
  const hub = fresh(); hub.cap = 1;
  const s1 = await makePhone(hub, 'super'), pm = await makePhone(hub, 'pm');
  await stable(s1, pm);
  s1.net.down = pm.net.down = true;
  const x = s1.addTask({ id: 'T1019-01' }), t = pm.addTask({ id: 'T1019-01' }); // neither texted
  s1.net.down = pm.net.down = false;
  hub.before = async req => { if (req.action === 'push' && req.devSecret === pm.secret) { hub.before = null; await s1.cycle(); } }; // both read the hub, then both push: neither saw the other's
  await pm.cycle();
  await stable(s1, pm);
  assert.deepEqual([hub.tasks.get(x).a.id, hub.tasks.get(t).a.id, hub.tasks.get(x).rev < hub.tasks.get(t).rev], ['T1019-01', 'T1019-01', true]);
  pm.sync.disconnect(); // forgets what it synced
  assert.equal((await pm.sync.connect(URL_A, KEYS.pm)).ok, true);
  await stable(pm);
  assert.ok(hub.calls.filter(c => c.action === 'pull' && c.body.devSecret === pm.secret).some(c => c.body.since > 0 && c.body.since < hub.rev), 'read in pages');
  assert.deepEqual([pm.task(t).id, hub.tasks.get(t).a.id, pm.toasts], ['T1019-01', 'T1019-01', []], 'its own sheet, on the hub all along, keeps its number');
});

test('people and crews keep their ids through the hub and a reload; a rename keeps the id everywhere, and a crew phone follows its crew', async () => {
  const hub = fresh(), shared = await lib;
  const roster = { crews: [{ id: 'cA', name: 'Crew A', lead: '', members: '' }, { id: 'cB', name: 'Crew B', lead: '', members: '' }],
    people: [{ id: 'p1', name: 'Jose L', crewId: 'cA' }, { id: 'p2', name: 'Jose L', crewId: 'cB' }, { id: 'p3', name: 'Ann R', crewId: 'cA' }] };
  const sp = await makePhone(hub, 'super');
  sp.save('schwab.settings', { ...sp.settings(), ...roster });
  await sp.cycle();
  assert.deepEqual(hub.config.people, roster.people, 'the roster with its ids, two people sharing a name included');
  assert.deepEqual(hub.config.crews.map(c => [c.id, c.name, c.members]), [['cA', 'Crew A', 'Jose L, Ann R'], ['cB', 'Crew B', 'Jose L']], 'member lists rebuilt from the roster for older phones');
  const S = {}, cp = await makePhone(hub, 'crew', { crew: 'Crew B', S }), sp2 = await makePhone(hub, 'super');
  await stable(cp, sp2);
  const reload = p => shared.normSettings(JSON.parse(JSON.stringify(p.settings()))); // what loadSettings makes of the stored copy
  for (const p of [cp, sp2]) {
    const s = reload(p);
    assert.deepEqual(s.people, roster.people, `${p.role}: every person keeps their id`);
    assert.deepEqual(s.crews.map(c => c.id), ['cA', 'cB']);
    assert.deepEqual(shared.people(s).filter(x => x.name === 'Jose L').map(x => [x.id, x.crew]), [['p1', 'Crew A'], ['p2', 'Crew B']], 'two people, told apart by crew');
  }
  // the second office phone renames a person and a crew
  tick(30e3);
  const s2 = reload(sp2);
  assert.ok(shared.renamePerson(s2, 'p2', 'José Luis') && shared.renameCrew(s2, 'cB', 'Crew Bravo'));
  sp2.save('schwab.settings', { ...sp2.settings(), crews: s2.crews, people: s2.people });
  await stable(sp2, sp, cp);
  for (const p of [sp, cp, sp2]) {
    const s = reload(p);
    assert.deepEqual(s.people.map(x => [x.id, x.name, x.crewId]), [['p1', 'Jose L', 'cA'], ['p2', 'José Luis', 'cB'], ['p3', 'Ann R', 'cA']], `${p.role}: same ids, new name`);
    assert.equal(shared.crewById(s, 'cB').name, 'Crew Bravo');
  }
  assert.deepEqual([cp.settings().hubCrew, S.hubCrew], ['Crew Bravo', 'Crew Bravo'], 'the crew phone follows its crew by id');
  assert.deepEqual(hub.calls.filter(c => c.action === 'pull' && c.body.devSecret === cp.secret).at(-1).body.crews, ['Crew Bravo'], 'and asks for its sheets by the new name');
  // a tab still on an older version saves the settings with no roster: the roster is rebuilt from the member lists, never emptied
  tick(30e3);
  const { people, ...oldTab } = reload(sp);
  sp.save('schwab.settings', { ...oldTab, crews: oldTab.crews.map(({ id, ...c }) => c) });
  await stable(sp, sp2, cp);
  assert.deepEqual(hub.config.people.map(p => p.name).sort(), ['Ann R', 'Jose L', 'José Luis']);
  // a hub config an older office phone wrote (the hub stores its missing roster as none at all) rebuilds it from the member lists
  tick(30e3);
  hub.config = { ...hub.config, people: [], crews: [{ id: 'cA', name: 'Crew A', lead: '', members: 'Jose L, Ann R' }, { id: 'cB', name: 'Crew Bravo', lead: '', members: 'Kim T' }], at: hub.now() };
  hub.configRev = hub.bump();
  await cp.cycle();
  assert.deepEqual(shared.people(reload(cp)).map(p => [p.name, p.crew]), [['Jose L', 'Crew A'], ['Ann R', 'Crew A'], ['Kim T', 'Crew Bravo']], 'never an empty roster');
});

test('every synced field survives the hub, a reload and a backup restored on another phone: hub settings, merge stamps, replies, shift links', async () => {
  const hub = fresh(), shared = await lib;
  const sp = await makePhone(hub, 'super'), pm = await makePhone(hub, 'pm'), cp = await makePhone(hub, 'crew', { crew: 'Crew A', worker: 'Jose L' });
  sp.save('schwab.settings', { ...sp.settings(), crews: [{ id: 'cA', name: 'Crew A', lead: 'Mike', members: '' }], people: [{ id: 'p1', name: 'Jose L', crewId: 'cA' }] });
  const uid = sp.addTask({ crewId: 'cA', members: ['Jose L'], memberIds: ['p1'], aLang: 'es', by: 'Sue', floor: 'Level 1', area: 'East', size: 2, scope: 'Jale cable', refs: 'E-301',
    allot: 90, allotNote: 'noon', est: 2, estNote: 'two', pStart: '07:00', pStop: '15:00', checkIn: '11:00', sentAt: sp.now() });
  await stable(sp, cp, pm);
  tick(60e3);
  cp.tick(uid, 'i1');
  cp.editTask(uid, t => Object.assign(t, { lead: 'Mike', aStart: '07:05', aStop: '14:00', delay: 15, status: 'Partial', doneText: 'Medio', remain: 'Resto', comments: 'Falta material', cLang: 'es', resultAt: cp.now() }));
  const sid = cp.clockIn('Jose L', { pid: 'p1', crew: 'Crew A', crewId: 'cA', tasks: [{ uid, id: 'T1019-01' }] });
  sp.editReport(DAY, r => Object.assign(r, { status: 'On plan', results: 'Bien', lang: 'es', submittedAt: sp.now(), decisions: [{ q: 'OT?', rec: 'Yes', by: DAY, pm: '', pmNote: '' }] }));
  await stable(cp, sp, pm);
  tick(60e3);
  pm.editTask(uid, t => Object.assign(t, { reply: 'Bring the lift', replyAt: pm.now(), replyBy: 'Pat', review: 'Follow-up needed', reviewer: 'Pat', followUp: 'Finish Monday' }));
  pm.editReport(DAY, r => { r.decisions[0].pm = 'Approved'; r.decisions[0].pmNote = 'ok'; r.pmReview = 'Seen'; });
  await stable(pm, sp, cp);
  // the phone that wrote a part keeps that part's stamp in its sync state (so its own push coming back changes nothing);
  // every other phone holds the hub's stamp on the sheet itself
  const local = ['origin', 'from', 'gotAt', 'filedAt', 'updatedAt', 'news'], strip = (t, also = []) => Object.fromEntries(Object.entries(t).filter(([k]) => !local.includes(k) && !also.includes(k)));
  const want = strip(pm.task(uid), ['assignAt', 'crewAt']), hubT = hub.taskView(hub.tasks.get(uid));
  assert.deepEqual([want.reply, want.replyBy, want.aLang, want.cLang, want.crewId, want.memberIds, want.items[0].done], ['Bring the lift', 'Pat', 'es', 'es', 'cA', ['p1'], true]);
  assert.ok(want.replyAt > 0 && want.resultAt > 0 && hubT.assignAt > 0 && hubT.crewAt > 0);
  for (const p of [sp, cp]) assert.deepEqual(strip(p.task(uid), ['assignAt', 'crewAt']), want, `${p.role} holds every field of the sheet`);
  assert.deepEqual([sp.task(uid).assignAt, cp.task(uid).assignAt, sp.task(uid).crewAt, pm.task(uid).crewAt], [hubT.assignAt, hubT.assignAt, hubT.crewAt, hubT.crewAt], "the hub's merge stamps");
  const shiftWant = { pid: 'p1', crew: 'Crew A', crewId: 'cA', tasks: [{ uid, id: 'T1019-01' }] }, shiftOf = s => ({ pid: s.pid, crew: s.crew, crewId: s.crewId, tasks: s.tasks });
  assert.deepEqual([shiftOf(cp.hours()[0]), shiftOf(pm.crewHours().find(s => s.id === sid))], [shiftWant, shiftWant]);
  const rep = sp.reports()[DAY];
  assert.deepEqual([rep.lang, rep.decisions[0].pm, rep.decisions[0].pmNote, rep.pmReview, rep.pmAt > 0], ['es', 'Approved', 'ok', 'Seen', true]);
  // a reload: what each phone's load makes of its stores is what is stored
  for (const p of [sp, pm, cp]) {
    for (const t of p.tasks()) assert.deepEqual(shared.normTask(clone(t)), t, `${p.role} task`);
    for (const s of [...p.hours(), ...p.crewHours()]) assert.deepEqual(shared.normShift(clone(s)), s, `${p.role} shift`);
    for (const r of Object.values(p.reports())) assert.deepEqual(shared.normReport(clone(r)), r, `${p.role} report`);
    const s = shared.normSettings(clone(p.settings()));
    assert.deepEqual([s.hubUrl, s.hubKey, s.hubRole, s.hubCrew, s.people], [URL_A, KEYS[p.role], p.role, p.role === 'crew' ? 'Crew A' : '', [{ id: 'p1', name: 'Jose L', crewId: 'cA' }]], `${p.role} settings`);
  }
  // a backup of the PM phone (shared.mjs backupData) restored on another phone (restoreData): all of it but the hub key
  const data = clone(await withLocal(pm.storage, () => shared.backupData())), other = memStorage();
  assert.equal(await withLocal(other, () => shared.restoreData(data)), true);
  for (const key of ['schwab.tasks', 'schwab.hours', 'schwab.crewHours', 'schwab.reports', 'schwab.device']) assert.deepEqual(other.get(key), pm.storage.get(key), key);
  const rs = other.get('schwab.settings');
  assert.deepEqual([rs.hubUrl, rs.hubRole, rs.hubCrew, rs.hubKey, rs.people], [URL_A, 'pm', '', '', [{ id: 'p1', name: 'Jose L', crewId: 'cA' }]], 'the hub key stays behind, the rest comes along');
  // with the key typed in again it is the same phone: its device, every field and stamp, its record of what the hub has, nothing to send again
  const back = await makePhone(hub, 'pm', { storage: other }), pushes = hub.count('push');
  assert.equal((await back.sync.connect(URL_A, KEYS.pm)).ok, true);
  await stable(back);
  assert.deepEqual([back.secret, back.sync.hubStatus().state, hub.count('push'), back.toasts], [pm.secret, 'live', pushes, []]);
  assert.deepEqual(back.task(uid), pm.task(uid));
  assert.deepEqual(back.crewHours(), pm.crewHours());
  assert.deepEqual(back.reports()[DAY].decisions, pm.reports()[DAY].decisions);
});

test('a restored backup knows what the hub had then: work that reached the hub after the backup is not rolled back, unsynced work in it still goes up', async () => {
  const hub = fresh(), shared = await lib, pm = await makePhone(hub, 'pm'), cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  const uid = pm.addTask();
  await stable(pm, cp);
  cp.net.down = true; tick(60e3); cp.tick(uid, 'i1'); cp.editTask(uid, t => { t.status = 'Complete'; }); await cp.cycle(); // the crew finishes with no signal
  pm.net.down = true; tick(60e3); pm.editTask(uid, t => { t.scope = 'Pull 10 AWG'; }); await pm.cycle(); // later, the PM edits the sheet with no signal
  const data = clone(await withLocal(pm.storage, () => shared.backupData())); // and downloads a backup
  cp.net.down = false; tick(60e3); await stable(cp);
  tick(60e3);
  assert.equal(await withLocal(pm.storage, () => shared.restoreData(data)), true);
  const back = await makePhone(hub, 'pm', { storage: pm.storage }); // the page reloads after a restore, and the hub key is typed in again
  assert.equal((await back.sync.connect(URL_A, KEYS.pm)).ok, true);
  await stable(back, cp);
  const h = hub.taskView(hub.tasks.get(uid));
  assert.deepEqual([h.status, h.items[0].done, h.scope], ['Complete', true, 'Pull 10 AWG'], "the hub keeps the crew's work and gets the PM's edit");
  for (const p of [back, cp]) assert.deepEqual([p.task(uid).status, p.task(uid).items[0].done, p.task(uid).scope], ['Complete', true, 'Pull 10 AWG'], `${p.role} phone`);
});

test('the field lists here are the lists in hub/Code.gs, so the two cannot drift apart unnoticed', () => {
  const dir = path.join(__dirname, '..', 'docs', 'schwab'), mine = fs.readFileSync(path.join(dir, 'sync.mjs'), 'utf8'), hubSrc = fs.readFileSync(path.join(dir, 'hub', 'Code.gs'), 'utf8');
  const list = (src, name) => { const m = new RegExp(`const ${name} = (\\[[^\\]]*\\])`).exec(src); assert.ok(m, `${name} found`); return JSON.parse(m[1].replace(/'/g, '"')); };
  assert.deepEqual(list(mine, 'A_KEYS'), [...list(hubSrc, 'ASSIGN'), ...list(hubSrc, 'OFFICE_EXTRA')], 'office part');
  assert.deepEqual(list(mine, 'C_KEYS'), list(hubSrc, 'CREW'), 'crew part');
  // every key of a template object literal, nested ones too ({ a: [{ b: '' }] } gives a, b): the source is the judge, so a field
  // named in one file and missing from the other fails here
  const keysOf = (src, name) => { const i = src.indexOf(`const ${name} = {`); assert.ok(i >= 0, `${name} found`); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { d += src[j] === '{' ? 1 : src[j] === '}' ? -1 : 0; if (!d) break; } return [...new Set([...src.slice(i, j).matchAll(/(\w+):/g)].map(x => x[1]))].sort(); };
  const shared = fs.readFileSync(path.join(dir, 'shared.mjs'), 'utf8'), hubTask = new Set(keysOf(hubSrc, 'TASK')), tpl = new Set(keysOf(shared, 'TASK_TPL'));
  for (const k of [...list(mine, 'A_KEYS'), ...list(mine, 'C_KEYS'), 'assignAt', 'crewAt']) {
    assert.ok(hubTask.has(k), `the hub stores task field ${k}`);
    assert.ok(tpl.has(k), `TASK_TPL keeps task field ${k}, so no normTask strips it`);
  }
  assert.deepEqual(keysOf(mine, 'CFG_TPL'), keysOf(hubSrc, 'CONFIG').filter(k => k !== 'at'), 'settings the hub shares, crews and people with their ids');
  const sTpl = new Set(keysOf(shared, 'SETTINGS_TPL'));
  for (const k of keysOf(mine, 'CFG_TPL')) assert.ok(sTpl.has(k), `SETTINGS_TPL keeps ${k}`);
  assert.deepEqual(keysOf(shared, 'SHIFT_TPL'), keysOf(hubSrc, 'SHIFT'), 'a shift has the same fields on both sides');
  const wire = /const wireShift = [^\n]*\n[^\n]*/.exec(mine)[0];
  for (const k of keysOf(shared, 'SHIFT_TPL')) if (k !== 'uid') assert.match(wire, new RegExp(`\\b${k}:`), `a pushed shift carries ${k}`); // uid: inside tasks
  for (const k of ['lang', 'pmAt']) assert.ok(new Set(keysOf(shared, 'REPORT_TPL')).has(k) && new Set(keysOf(hubSrc, 'REPORT')).has(k), `both sides store report ${k}`);
});

test('the hub fields have a key of their own: an older tab saving settings cannot disconnect or reconnect the phone', async () => {
  const hub = fresh(), p = await makePhone(hub, 'crew', { url: '', key: '', noRole: true }), sp = await makePhone(hub, 'super');
  assert.equal(sp.sync.hubStatus().state, 'offline', 'a hub is set: before its first round the status is not off (screens translate and show hub parts from the first draw)');
  assert.equal((await p.sync.connect(URL_A, KEYS.crew)).ok, true);
  assert.deepEqual(p.storage.get('schwab.hub'), { hubUrl: URL_A, hubKey: KEYS.crew, hubRole: 'crew', hubCrew: '' });
  const { hubUrl, hubKey, hubRole, hubCrew, ...old } = p.settings();
  p.save('schwab.settings', old); // a tab on the older version saves its settings, which never had the hub fields
  const uid = sp.addTask();
  await stable(sp, p);
  assert.ok(p.task(uid), 'still syncing');
  assert.equal(p.sync.hubStatus().state, 'live');
  assert.equal(p.sync.onHub(uid), true, 'the sheet is known to be on the hub');
  assert.equal(sp.sync.onHub('never-synced'), false);
  p.sync.disconnect();
  p.save('schwab.settings', { ...old, hubUrl: URL_A, hubKey: KEYS.crew, hubRole: 'crew' }); // and an old tab still holding them saves again
  assert.equal(p.sync.hubStatus().state, 'off', 'a disconnect stays a disconnect');
  const before = hub.calls.length;
  await p.cycle();
  assert.equal(hub.calls.length, before, 'nothing goes to the hub');
});

test('another job, an older tab, a texted sheet, a one-off failure: nothing stale goes up, and nobody is promised a retry', async () => {
  // A phone moving to another hub (another job) does not upload what it synced with the old one; an edit made after still goes up.
  const a = fresh(), b = new FakeHub(clock), URL_B = 'https://script.google.com/macros/s/OTHERJOB/exec', URL_C = 'https://script.google.com/macros/s/THIRDJOB/exec', hubs = { [URL_B]: b };
  const sp = await makePhone(a, 'super', { fetchImpl: (url, init) => (hubs[url] || a).fetch(url, init) });
  b.pushReport('super', { date: DAY, results: 'job B results', updatedAt: clock() }); // job B's own daily report for today
  tick(60e3);
  const old = sp.addTask({ scope: 'job A sheet' });
  sp.editReport(DAY, r => { r.results = 'job A results'; });
  await sp.cycle();
  assert.ok(a.tasks.has(old) && a.reports.has(DAY));
  assert.equal((await sp.sync.connect(URL_B, KEYS.super)).ok, true);
  tick(30e3); await sp.cycle();
  assert.deepEqual([b.tasks.size, b.reports.get(DAY).results], [0, 'job B results'], "job A's sheet and report stay off job B's hub");
  sp.editTask(old, t => { t.scope = 'edited after the move'; });
  tick(30e3); await sp.cycle();
  assert.equal(b.tasks.get(old)?.a.scope, 'edited after the move', 'an edit made after the move is new work');
  sp.sync.disconnect(); hubs[URL_C] = new FakeHub(clock); // a disconnect, then another job's invite: the same
  assert.equal((await sp.sync.connect(URL_C, KEYS.super)).ok, true);
  tick(30e3); await sp.cycle();
  assert.equal(hubs[URL_C].tasks.size + hubs[URL_C].reports.size, 0, 'nothing synced before the disconnect goes to the next hub');
  // Disconnected and connected again: an edit made while away is ranked by when it was made, not by when the phone came back.
  const h2 = fresh(), s1 = await makePhone(h2, 'super'), s2 = await makePhone(h2, 'super'), x = s1.addTask({ scope: 'first' });
  await s1.cycle(); await s2.cycle();
  s1.sync.disconnect();
  s1.editTask(x, t => { t.scope = 'older edit, made away'; });
  tick(60e3); s2.editTask(x, t => { t.scope = 'newer edit on the hub'; }); await s2.cycle();
  tick(60e3); assert.equal((await s1.sync.connect(URL_A, KEYS.super)).ok, true); await s1.cycle();
  assert.deepEqual([h2.tasks.get(x).a.scope, s1.task(x).scope], ['newer edit on the hub', 'newer edit on the hub']);
  // A tab on a version before the hub saves a sheet without the office fields: they are not wiped on the hub, and come back here.
  const hub = fresh(), pm = await makePhone(hub, 'pm');
  const u = pm.addTask({ reply: 'Bring the lift', replyBy: 'Pat' });
  await pm.cycle();
  const { reply, replyAt, replyBy, aLang, crewId, memberIds, assignAt, crewAt, ...was } = pm.tasks()[0];
  pm.save('schwab.tasks', [{ ...was, floor: 'Level 3' }]);
  tick(30e3); await pm.cycle();
  assert.deepEqual([hub.tasks.get(u).a.reply, pm.task(u).reply], ['Bring the lift', 'Bring the lift'], 'the office message survives an older tab');
  // A crew phone working a sheet texted by an office phone that is not on the hub: not pushed, not reported on every tick.
  const cp = await makePhone(hub, 'crew', { crew: 'Crew A' }), texted = cp.addTask({ id: 'T1019-09' });
  for (const i of ['i1', 'i2']) { cp.tick(texted, i); tick(30e3); await cp.cycle(); }
  assert.deepEqual([cp.toasts.filter(t => t.includes('did not accept')).length, cp.sync.hubStatus().pending, hub.tasks.has(texted)], [0, 1, false]);
  // One-off actions that nothing retries never say the hub will try again.
  hub.fail = req => (['purge', 'rotate'].includes(req.action) ? hub.err('busy') : null);
  for (const r of [await pm.sync.purge('task', u), await pm.sync.rotate('crew')]) assert.deepEqual([r.ok, r.error, r.message], [false, 'busy', 'That did not work. Try again.']);
  hub.fail = null;
  // A "they pick" crew invite lists the job's crews: a new phone knows only its own defaults.
  const inv = await pm.sync.invite('crew', '', ['Lighting', 'Power', 7]);
  assert.deepEqual((await (await lib).unpack(inv.url.split('#p=')[1])).crews, ['Lighting', 'Power']);
});

// ---------- shared work: two phones on one crew, a sheet that changes crew, an Undo, texts on hub phones ----------

test('against the real hub/Code.gs: two phones on one crew keep each other\'s taps, and a sheet moved to another crew leaves the old crew\'s phones', async () => {
  const { createHub } = require('./helpers/google-mock');
  const mock = createHub({ now: T0 }), k = mock.setup();
  const real = { clock: () => mock.now(), fetch: async (url, init) => { const text = mock.raw(init.body); return { ok: true, status: 200, json: async () => JSON.parse(text) }; } };
  const sp = await makePhone(real, 'super', { key: k.super }), ana = await makePhone(real, 'crew', { key: k.crew, crew: 'Crew A', worker: 'Ana R' });
  const jose = await makePhone(real, 'crew', { key: k.crew, crew: 'Crew A', worker: 'Jose L' }), rosa = await makePhone(real, 'crew', { key: k.crew, crew: 'Crew B', worker: 'Rosa P' });
  const step = async (...ps) => { for (const p of ps) { mock.advance(5e3); await p.cycle(); } };
  sp.save('schwab.settings', { ...sp.settings(), crews: [{ name: 'Crew A', lead: '', members: 'Ana R, Jose L' }, { name: 'Crew B', lead: '', members: 'Rosa P' }] });
  const uid = sp.addTask({ sentAt: sp.now(), items: [{ id: 'i1', text: 'Pull wire' }, { id: 'i2', text: 'Install box' }, { id: 'i3', text: 'Label' }] });
  await step(sp, ana, jose, rosa);
  assert.deepEqual([!!ana.task(uid), !!jose.task(uid), !!rosa.task(uid)], [true, true, false]);
  // Ana starts, ticks two steps and writes what is left; Jose, who has not pulled since, ticks the third
  ana.tick(uid, 'i1'); ana.tick(uid, 'i2'); ana.editTask(uid, t => Object.assign(t, { aStart: '06:45', status: 'Partial', remain: 'Labels tomorrow, ran out' }));
  await step(ana);
  jose.tick(uid, 'i3');
  await step(jose);
  const onHub = () => mock.entities('Tasks').find(t => t.uid === uid), view = t => [t.aStart, t.status, t.remain, t.items.map(i => i.done)];
  const both = ['06:45', 'Partial', 'Labels tomorrow, ran out', [true, true, true]];
  assert.deepEqual(view(onHub()), both, "Jose's tap does not wipe Ana's work");
  await step(ana, jose);
  assert.deepEqual([view(ana.task(uid)), view(jose.task(uid))], [both, both], 'and both phones end with both');
  // the superintendent moves the sheet to Crew B: it leaves Crew A's phones on their next round and reaches Crew B's
  sp.editTask(uid, t => { t.crew = 'Crew B'; });
  await step(sp, ana, jose, rosa);
  assert.deepEqual([ana.task(uid), jose.task(uid), rosa.task(uid)?.crew], [undefined, undefined, 'Crew B']);
  assert.deepEqual([ana.toasts, jose.toasts, rosa.toasts], [[], [], []]);
});

test("the PM's Undo of a removed shift stands, even tapped while the removal's round is on the wire", async () => {
  const hub = fresh(), w = await makePhone(hub, 'crew', { crew: 'Crew A', worker: 'Jose L' }), pm = await makePhone(hub, 'pm');
  const id = w.clockIn('Jose L', { crew: 'Crew A' });
  await stable(w, pm);
  tick(60e3);
  pm.editCrewHours(id, s => { s.gone = true; });
  hub.before = async req => { if (req.action === 'pull' && req.devSecret === pm.secret) { hub.before = null; pm.editCrewHours(id, s => { s.gone = false; }); } }; // Undo, after the removal went up
  await pm.cycle();
  await stable(pm, w);
  assert.deepEqual([pm.crewHours()[0].gone, hub.shifts.get(id).gone, w.hours().map(s => s.id)], [false, false, [id]]);
});

test('a text opened on a hub phone never undoes newer work the hub has; a newer text is merged and ranked by its own time', async () => {
  const hub = fresh(), shared = await lib, sp = await makePhone(hub, 'super'), pm = await makePhone(hub, 'pm'), cp = await makePhone(hub, 'crew', { crew: 'Crew A' });
  const s2 = await makePhone(hub, 'super'); // a second office phone, about to lose signal
  const uid = sp.addTask({ sentAt: sp.now(), items: [{ id: 'i1', text: 'Pull wire' }, { id: 'i2', text: 'Install box' }, { id: 'i3', text: 'Label' }] });
  await stable(sp, pm, cp, s2);
  s2.net.down = true;
  const taskText = clone(sp.task(uid)); // Send to crew: the text keeps the sheet as sent
  // the crew sends results (a text), then keeps working through the hub; the office adds a step and a message
  tick(10e3);
  cp.tick(uid, 'i1'); const resultText = clone(cp.editTask(uid, t => Object.assign(t, { status: 'Partial', remain: 'Box and labels left', resultAt: cp.now() })));
  await cp.cycle();
  tick(10e3);
  cp.tick(uid, 'i2'); cp.editTask(uid, t => { t.remain = 'Only labels left'; });
  await cp.cycle();
  sp.editTask(uid, t => { t.items.push({ id: 'i4', text: 'Label circuits', done: false, at: 0 }); t.reply = 'Use the red tape'; });
  await stable(sp, pm, cp);
  // the PM and the crew open the texts: both phones already hold newer copies, which stay
  assert.equal(pm.sync.fromText('t', uid, 'crew', resultText.resultAt), false);
  assert.equal(cp.sync.fromText('t', uid, 'assign', taskText.sentAt), false);
  // the second office phone, offline since before the results, opens the results text: newer than its copy, so merged;
  // back online, the text's change goes up as old as the text, and the newer crew work on the hub stands everywhere
  tick(60e3);
  assert.equal(s2.sync.fromText('t', uid, 'crew', resultText.resultAt), true);
  s2.editTask(uid, t => shared.mergeTask(t, shared.normTask(clone(resultText)), 'crew'));
  assert.equal(s2.task(uid).remain, 'Box and labels left');
  await s2.cycle();
  tick(10e3); s2.net.down = false;
  await stable(s2, sp, pm, cp);
  const view = t => [t.status, t.remain, t.items.map(i => i.done)], now = ['Partial', 'Only labels left', [true, true, false, false]];
  assert.deepEqual([s2, sp, pm, cp].map(p => view(p.task(uid))), [now, now, now, now], 'the older text lost to the newer hub copy everywhere');
  assert.deepEqual(view(hub.taskView(hub.tasks.get(uid))), now);
  assert.equal(cp.task(uid).reply, 'Use the red tape');
  // the daily report: the superintendent sends it, then corrects it through the hub; the PM opens the old text
  sp.editReport(DAY, r => Object.assign(r, { status: 'On plan', results: 'Crew A pulled wire on level 3', submittedAt: sp.now() }));
  const reportText = clone(sp.reports()[DAY]);
  await stable(sp, pm);
  tick(10e3); sp.editReport(DAY, r => { r.results += '. CORRECTION: only half of level 3'; });
  await stable(sp, pm);
  assert.equal(pm.sync.fromText('r', DAY, 'sup', reportText.updatedAt), false);
});

// ---------- merges: the office part of a sheet, the shared settings, a sheet that left the crew (against the real hub) ----------

const realHub = () => {
  const { createHub } = require('./helpers/google-mock');
  const mock = createHub({ now: T0 }), k = mock.setup();
  return { mock, k, real: { clock: () => mock.now(), fetch: async (url, init) => { const text = mock.raw(init.body); return { ok: true, status: 200, json: async () => JSON.parse(text) }; } } };
};

test('against the real hub/Code.gs: the superintendent and the PM keep each other\'s office edits on one sheet, online or offline (assignBase)', async () => {
  const { mock, k, real } = realHub();
  const sp = await makePhone(real, 'super', { key: k.super }), pm = await makePhone(real, 'pm', { key: k.pm }), cp = await makePhone(real, 'crew', { key: k.crew, crew: 'Crew A' });
  const step = async (...ps) => { for (const p of ps) { mock.advance(5e3); await p.cycle(); } };
  const uid = sp.addTask({ sentAt: sp.now(), items: [{ id: 'i1', text: 'Pull wire' }] });
  await step(sp, pm, cp);
  const onHub = () => mock.entities('Tasks').find(t => t.uid === uid), view = t => [t.floor, t.scope, t.reply, t.review, t.items.map(i => i.text)];
  // online: the PM sends a message; the superintendent, whose phone has not pulled it, fixes the floor a moment later
  pm.editTask(uid, t => Object.assign(t, { reply: 'Stop at grid line 7', replyAt: pm.now(), replyBy: 'PM' }));
  await step(pm);
  sp.editTask(uid, t => { t.floor = 'Level 3 east'; });
  await step(sp);
  const one = ['Level 3 east', 'Pull 12 AWG', 'Stop at grid line 7', '', ['Pull wire']];
  assert.deepEqual(view(onHub()), one, "the floor fix does not wipe the PM's message");
  await step(pm, cp, sp);
  assert.deepEqual([view(sp.task(uid)), view(pm.task(uid)), view(cp.task(uid))], [one, one, one], 'and every phone ends with both');
  // offline: the superintendent rewrites the scope and adds a step with no signal; the PM sends another message and a review
  sp.net.down = true;
  sp.editTask(uid, t => { t.scope = 'Pull wire level 3 and 4'; t.items.push({ id: 'i2', text: 'Pull wire level 4', done: false, at: 0 }); });
  await step(sp);
  const draft = sp.addTask({ id: 'T1019-09' }); // then starts a new sheet, which goes up after the next pull (renumber)
  pm.editTask(uid, t => Object.assign(t, { reply: 'Inspector at 2', replyAt: pm.now(), review: 'Looks good' }));
  await step(pm);
  sp.net.down = false;
  await step(sp, pm, cp, sp);
  const two = ['Level 3 east', 'Pull wire level 3 and 4', 'Inspector at 2', 'Looks good', ['Pull wire', 'Pull wire level 4']];
  assert.deepEqual([view(onHub()), view(sp.task(uid)), view(pm.task(uid)), view(cp.task(uid))], [two, two, two, two], 'the offline edits and the newer message both stand');
  assert.equal(pm.task(draft)?.id, 'T1019-09');
  // both change the same field: the newer edit wins it, everywhere
  sp.editTask(uid, t => { t.scope = 'Older scope'; }); await step(sp);
  mock.advance(5e3); pm.editTask(uid, t => { t.scope = 'Newer scope'; }); await step(pm, sp, cp);
  assert.deepEqual([onHub().scope, sp.task(uid).scope, cp.task(uid).scope], ['Newer scope', 'Newer scope', 'Newer scope']);
  assert.deepEqual([sp.toasts, pm.toasts], [[], []]);
});

test('against the real hub/Code.gs: two office phones adding people at once both keep theirs, online or offline (settings base)', async () => {
  const { mock, k, real } = realHub();
  const sp = await makePhone(real, 'super', { key: k.super }), pm = await makePhone(real, 'pm', { key: k.pm });
  const step = async (...ps) => { for (const p of ps) { mock.advance(5e3); await p.cycle(); } };
  sp.save('schwab.settings', { ...sp.settings(), crews: [{ id: 'cA', name: 'Crew A', lead: '', members: '' }, { id: 'cB', name: 'Crew B', lead: '', members: '' }], people: [{ id: 'p1', name: 'Ana R', crewId: 'cA' }] });
  await step(sp, pm, sp);
  const add = (p, id, name, crewId) => p.save('schwab.settings', { ...p.settings(), people: [...p.settings().people, { id, name, crewId }] });
  const names = c => c.people.map(x => x.name).sort().join(', ');
  // the PM adds Maria; the superintendent, whose phone has not pulled her, adds Carlos
  add(pm, 'p2', 'Maria G', 'cB'); await step(pm);
  add(sp, 'p3', 'Carlos T', 'cA'); await step(sp);
  assert.equal(names(mock.entities('Config')[0]), 'Ana R, Carlos T, Maria G');
  await step(pm, sp);
  assert.deepEqual([names(pm.settings()), names(sp.settings())], ['Ana R, Carlos T, Maria G', 'Ana R, Carlos T, Maria G']);
  // offline: the superintendent adds a floor and Luis; meanwhile the PM takes Ana off the list and adds Rosa
  sp.net.down = true;
  sp.save('schwab.settings', { ...sp.settings(), floors: [...sp.settings().floors, 'Level 4'] }); add(sp, 'p4', 'Luis M', 'cB'); await step(sp);
  pm.save('schwab.settings', { ...pm.settings(), people: pm.settings().people.filter(x => x.id !== 'p1') }); add(pm, 'p5', 'Rosa P', 'cB'); await step(pm);
  sp.net.down = false;
  await step(sp, pm, sp);
  const want = 'Carlos T, Luis M, Maria G, Rosa P';
  assert.deepEqual([names(mock.entities('Config')[0]), names(pm.settings()), names(sp.settings())], [want, want, want], 'every addition stands, and a removal too');
  assert.deepEqual([pm.settings().floors.includes('Level 4'), sp.toasts, pm.toasts], [true, [], []]);
});

test('against the real hub/Code.gs: a passcode the PM changes holds, even when the superintendent, who kept the old one, saves settings (DATA2-09)', async () => {
  const { mock, k, real } = realHub(), pinA = '0123456789abcdef:' + 'a'.repeat(64), pinB = 'fedcba9876543210:' + 'b'.repeat(64);
  const pm = await makePhone(real, 'pm', { key: k.pm }), sp = await makePhone(real, 'super', { key: k.super });
  const step = async (...ps) => { for (const p of ps) { mock.advance(5e3); await p.cycle(); } };
  pm.save('schwab.settings', { ...pm.settings(), pin: pinA }); pm.save('schwab.pin', pinA);
  await step(pm, sp);
  assert.equal(sp.settings().pin, pinA, 'the superintendent learns the first code');
  pm.save('schwab.settings', { ...pm.settings(), pin: pinB }); pm.save('schwab.pin', pinB); // Change the passcode
  await step(pm, sp);
  assert.deepEqual([mock.entities('Config')[0].pin, sp.settings().pin], [pinB, pinA], 'the hub has the new code; the superintendent keeps the one it learned');
  sp.save('schwab.settings', { ...sp.settings(), floors: [...sp.settings().floors, 'Level 6'] });
  await step(sp, pm);
  assert.deepEqual([mock.entities('Config')[0].pin, mock.entities('Config')[0].floors.includes('Level 6')], [pinB, true], 'the floor goes up, the old code does not');
  const cp = await makePhone(real, 'crew', { key: k.crew, crew: 'Crew A' });
  await step(cp);
  assert.equal(cp.settings().pin, pinB, 'a phone set up afterwards learns the new code');
  // a deliberate change on the superintendent's phone still goes up
  const pinC = '00112233445566ff:' + 'c'.repeat(64);
  sp.save('schwab.settings', { ...sp.settings(), pin: pinC }); sp.save('schwab.pin', pinC);
  await step(sp);
  assert.equal(mock.entities('Config')[0].pin, pinC);
});

test('against the real hub/Code.gs: a phone that taps Disconnect and joins the same hub again keeps the work it had not sent (DATA2-04)', async () => {
  const { mock, k, real } = realHub(), { unpack } = await lib;
  const sp = await makePhone(real, 'super', { key: k.super }), pm = await makePhone(real, 'pm', { key: k.pm });
  const ana = await makePhone(real, 'crew', { key: k.crew, crew: 'Crew A', worker: 'Ana R' }), jose = await makePhone(real, 'crew', { key: k.crew, crew: 'Crew A', worker: 'Jose L' });
  const step = async (...ps) => { for (const p of ps) { mock.advance(5e3); await p.cycle(); } };
  sp.save('schwab.settings', { ...sp.settings(), crews: [{ name: 'Crew A', lead: '', members: 'Ana R, Jose L' }] });
  const uid = sp.addTask({ sentAt: sp.now(), items: [{ id: 'i1', text: 'Pull wire' }, { id: 'i2', text: 'Install box' }, { id: 'i3', text: 'Label' }] });
  await step(sp, pm, ana, jose, ana, jose); // a second round: each crew phone has found its person on the roster
  assert.equal((await pm.sync.rotate('crew')).ok, true); // the PM replaces the crew key; both crew phones are refused and keep ticking
  ana.tick(uid, 'i1'); await step(ana);
  mock.advance(5 * 60e3); jose.tick(uid, 'i2'); await step(jose);
  const join = async p => (await p.sync.joinFrom(await unpack((await pm.sync.invite('crew', 'Crew A')).url.split('#p=')[1]))).ok;
  assert.equal(await join(jose), true); await step(jose);
  ana.sync.disconnect(); // "Your work stays on this phone"
  assert.equal(ana.task(uid).items[0].done, true);
  assert.equal(await join(ana), true); await step(ana, jose, ana);
  const done = t => t.items.map(i => i.done), want = [true, true, false];
  assert.deepEqual([done(mock.entities('Tasks').find(t => t.uid === uid)), done(ana.task(uid)), done(jose.task(uid))], [want, want, want], 'both ticks, everywhere');
});

test('against the real hub/Code.gs: two PM devices fixing one shift keep both fixes, and a time both changed goes to the newer fix (DATA2-05)', async () => {
  const { mock, k, real } = realHub();
  const w = await makePhone(real, 'crew', { key: k.crew, crew: 'Crew A', worker: 'Ana R' }), ph = await makePhone(real, 'pm', { key: k.pm }), lap = await makePhone(real, 'pm', { key: k.pm });
  const step = async (...ps) => { for (const p of ps) { mock.advance(5e3); await p.cycle(); } };
  const id = w.clockIn('Ana R', { in: '06:45' }); w.editHours(id, s => { s.out = '14:45'; });
  await step(w, ph, lap);
  const fix = (p, f, v) => p.editCrewHours(id, s => { s[f] = v; s.edited[f] = true; });
  const hubS = () => mock.entities('Hours').find(s => s.id === id), view = s => [s.in, s.out, s.edited.in, s.edited.out];
  lap.net.down = true; fix(lap, 'in', '06:30'); await step(lap); // the laptop, offline, fixes the clock-in
  fix(ph, 'out', '15:45'); await step(ph); // later the phone, online, fixes the clock-out
  lap.net.down = false; await step(lap, ph, w, lap);
  const want = ['06:30', '15:45', true, true];
  assert.deepEqual([view(hubS()), view(ph.crewHours()[0]), view(lap.crewHours()[0])], [want, want, want], 'both fixes stand');
  assert.deepEqual([w.hours()[0].in, w.hours()[0].out, rowsOfTotals(mock)], ['06:30', '15:45', 9.25]);
  // both fix the clock-out: the newer fix wins, everywhere
  lap.net.down = true; fix(lap, 'out', '15:00'); await step(lap);
  mock.advance(60e3); fix(ph, 'out', '16:00'); await step(ph);
  lap.net.down = false; await step(lap, ph, lap);
  assert.deepEqual([hubS().out, ph.crewHours()[0].out, lap.crewHours()[0].out], ['16:00', '16:00', '16:00']);
  assert.deepEqual([w.toasts, ph.toasts, lap.toasts], [[], [], []]);
});
const rowsOfTotals = mock => { const head = mock.header('Weekly totals'); return mock.table('Weekly totals').map(r => r[head.indexOf('Hours')])[0]; };

test('against the real hub/Code.gs: the PM typing in a daily report keeps the superintendent\'s words, offline or within one sync (supBase, DATA2-01)', async () => {
  const { mock, k, real } = realHub();
  const sp = await makePhone(real, 'super', { key: k.super }), pm = await makePhone(real, 'pm', { key: k.pm });
  const step = async (...ps) => { for (const p of ps) { mock.advance(5e3); await p.cycle(); } };
  await step(sp, pm);
  const view = r => r && [r.status, r.results, r.wins, r.issues], all = () => [view(mock.entities('Reports').find(r => r.date === DAY)), view(sp.reports()[DAY]), view(pm.reports()[DAY])];
  // the superintendent writes the day with no signal; the PM, online, types one line into the same day
  sp.net.down = true;
  sp.editReport(DAY, r => Object.assign(r, { status: 'At risk', results: 'Crew A pulled wire on level 3', wins: 'Level 3 east a day early' }));
  await step(sp);
  pm.editReport(DAY, r => { r.issues = 'Inspector coming Tuesday 2 pm'; }); await step(pm);
  sp.net.down = false;
  await step(sp, pm, sp);
  const one = ['At risk', 'Crew A pulled wire on level 3', 'Level 3 east a day early', 'Inspector coming Tuesday 2 pm'];
  assert.deepEqual(all(), [one, one, one], 'the hub, the superintendent and the PM all keep both');
  // online: the superintendent corrects the results; the PM, whose phone has not pulled that yet, edits Site issues
  sp.editReport(DAY, r => { r.results += '. CORRECTION: only half of level 3'; }); await step(sp);
  pm.editReport(DAY, r => { r.issues = 'Inspector moved to Wednesday'; }); await step(pm);
  await step(sp, pm, sp);
  const two = ['At risk', 'Crew A pulled wire on level 3. CORRECTION: only half of level 3', 'Level 3 east a day early', 'Inspector moved to Wednesday'];
  assert.deepEqual(all(), [two, two, two]);
  assert.deepEqual([sp.toasts, pm.toasts, sp.sync.hubStatus().pending, pm.sync.hubStatus().pending], [[], [], 0, 0]);
});

test('against the real hub/Code.gs: after the PM clears a day\'s report the real one still reaches everyone, and a record the hub calls deleted leaves the phone (DATA2-02)', async () => {
  const { mock, k, real } = realHub();
  const sp = await makePhone(real, 'super', { key: k.super }), pm = await makePhone(real, 'pm', { key: k.pm });
  const step = async (...ps) => { for (const p of ps) { mock.advance(5e3); await p.cycle(); } };
  const onHub = () => mock.entities('Reports').find(r => r.date === DAY), view = r => r && [r.status, r.results, r.issues];
  sp.editReport(DAY, r => Object.assign(r, { status: 'On plan', results: 'Typed on the wrong day by mistake' }));
  await step(sp, pm);
  assert.equal(onHub()?.results, 'Typed on the wrong day by mistake');
  assert.equal((await pm.sync.purge('report', DAY)).ok, true);
  await step(sp, pm);
  assert.deepEqual([onHub(), sp.reports()[DAY], pm.reports()[DAY]], [undefined, undefined, undefined]);
  // the superintendent writes the day's real report, then the PM types on that day too
  sp.editReport(DAY, r => Object.assign(r, { status: 'At risk', results: 'The real report: inspection failed on level 2' }));
  await step(sp, pm);
  pm.editReport(DAY, r => { r.issues = 'Inspection again Thursday'; });
  await step(pm, sp);
  const want = ['At risk', 'The real report: inspection failed on level 2', 'Inspection again Thursday'];
  assert.deepEqual([view(onHub()), view(sp.reports()[DAY]), view(pm.reports()[DAY])], [want, want, want]);
  // a sheet the PM deleted, back on the PM phone from a crew's results text: the hub refuses it as deleted, and it leaves the
  // phone (no pull would remove it: this phone is past the tombstone) instead of staying there unsent for good
  const uid = sp.addTask({ sentAt: sp.now() });
  await step(sp, pm);
  const copy = clone(pm.task(uid));
  assert.equal((await pm.sync.purge('task', uid)).ok, true);
  await step(pm, sp);
  pm.save('schwab.tasks', [...pm.tasks(), { ...copy, status: 'Complete', crewAt: pm.now() }]);
  await step(pm, pm);
  assert.deepEqual([pm.task(uid), mock.entities('Tasks').some(t => t.uid === uid), pm.sync.hubStatus().pending], [undefined, false, 0]);
  assert.deepEqual([sp.toasts, pm.toasts], [[], []]);
});

test('against the real hub/Code.gs: a crew phone keeps a sheet texted to it for another crew, and work on a sheet that left its crew until that work went up', async () => {
  const { mock, k, real } = realHub();
  const sp = await makePhone(real, 'super', { key: k.super }), a = await makePhone(real, 'crew', { key: k.crew, crew: 'Crew A' }), b = await makePhone(real, 'crew', { key: k.crew, crew: 'Crew B' });
  const a2 = await makePhone(real, 'crew', { key: k.crew, crew: 'Crew A' }); // a second Crew A phone
  const step = async (...ps) => { for (const p of ps) { mock.advance(5e3); await p.cycle(); } };
  sp.save('schwab.settings', { ...sp.settings(), crews: [{ name: 'Crew A', lead: '', members: '' }, { name: 'Crew B', lead: '', members: '' }] });
  const items = [{ id: 'i1', text: 'Pull wire' }, { id: 'i2', text: 'Install box' }, { id: 'i3', text: 'Label' }];
  const ub = sp.addTask({ crew: 'Crew B', sentAt: sp.now(), items }), ua = sp.addTask({ id: 'T1019-02', crew: 'Crew A', sentAt: sp.now(), items });
  await step(sp, a, b, a2);
  // Crew B's sheet is texted to Crew A's lead to help out; Crew A works it on the phone, Crew B ticks through the hub
  a.save('schwab.tasks', [...a.tasks(), { ...sp.task(ub), origin: 'link' }]);
  a.tick(ub, 'i1'); a.editTask(ub, t => Object.assign(t, { status: 'Partial', remain: 'Box and labels left, Crew A helped' }));
  b.tick(ub, 'i3');
  await step(b, a, a);
  const work = t => t && [t.status, t.remain, t.items.map(i => i.done)];
  assert.deepEqual(work(a.task(ub)), ['Partial', 'Box and labels left, Crew A helped', [true, false, false]], 'the texted sheet and its work stay on the phone');
  // Crew A ticks its own sheet with no signal; then the phone is invited to Crew B, so its first round reads before it pushes
  a.net.down = true; a.tick(ua, 'i2'); await step(a);
  a2.tick(ua, 'i3'); await step(a2); // the other Crew A phone ticks later, so the hub's crew part is newer than this tick
  a.net.down = false;
  assert.equal((await a.sync.joinFrom({ v: 1, kind: 'join', role: 'crew', crew: 'Crew B', hub: { url: URL_A, key: k.crew } })).ok, true);
  await step(a);
  assert.deepEqual(mock.entities('Tasks').find(t => t.uid === ua).items.map(i => i.done), [false, true, true], 'the tick made before the move went up');
  await step(a);
  assert.equal(a.task(ua), undefined, 'then the old crew\'s sheet leaves the phone');
  assert.deepEqual(a.toasts, []);
});

test('against the real hub/Code.gs: a crew phone follows its person: put on another crew\'s sheet, or moved to another crew, they get those sheets (PHONE-UX-04)', async () => {
  const { mock, k, real } = realHub();
  const sp = await makePhone(real, 'super', { key: k.super }), ana = await makePhone(real, 'crew', { key: k.crew, crew: 'Crew A', worker: 'Ana R' });
  const step = async (...ps) => { for (const p of ps) { mock.advance(5e3); await p.cycle(); } };
  const crews = [{ id: 'cA', name: 'Crew A', lead: '', members: '' }, { id: 'cB', name: 'Crew B', lead: '', members: '' }, { id: 'cC', name: 'Crew C', lead: '', members: '' }];
  const roster = anaOn => sp.save('schwab.settings', { ...sp.settings(), crews, people: [{ id: 'pA', name: 'Ana R', crewId: anaOn }, { id: 'pL', name: 'Luis M', crewId: 'cB' }] });
  roster('cA');
  const ua = sp.addTask({ crew: 'Crew A', crewId: 'cA', sentAt: sp.now() });
  const uc = sp.addTask({ id: 'T1019-03', crew: 'Crew C', crewId: 'cC', members: ['Ana R'], memberIds: ['pA'], sentAt: sp.now() }); // Ana lent to Crew C today
  await step(sp, ana, ana);
  assert.deepEqual([!!ana.task(ua), !!ana.task(uc)], [true, true], "her crew's sheet, and Crew C's sheet with her name on it");
  // the PM moves Ana to Crew B in Settings, then sends Crew B a sheet: her phone follows her
  roster('cB');
  const ub = sp.addTask({ id: 'T1019-02', crew: 'Crew B', crewId: 'cB', members: ['Luis M'], memberIds: ['pL'], sentAt: sp.now() });
  await step(sp, ana, ana);
  assert.deepEqual([!!ana.task(ub), ana.sync.hubStatus().crew, !!ana.task(uc), ana.task(ua)], [true, 'Crew B', true, undefined], "Crew B's sheet arrives, the Hub page says Crew B, Crew C's sheet with her name stays, and Crew A's leaves");
  // taken off Crew C's sheet, it leaves her phone too
  sp.editTask(uc, t => { t.members = []; t.memberIds = []; });
  await step(sp, ana);
  assert.equal(ana.task(uc), undefined);
  assert.deepEqual(ana.toasts, []);
});

test('a text from a phone on the hub is read in hub time: a sender clock running ahead does not make an old text win', async () => {
  const hub = fresh(), sp = await makePhone(hub, 'super'), pm = await makePhone(hub, 'pm'), cp = await makePhone(hub, 'crew', { crew: 'Crew A', offset: 10 * 60e3 }); // its clock 10 minutes fast
  const uid = sp.addTask({ sentAt: sp.now() });
  await stable(sp, pm, cp);
  cp.tick(uid, 'i1'); const text = clone(cp.editTask(uid, t => Object.assign(t, { status: 'Partial', resultAt: cp.now() }))), skew = cp.sync.hubStatus().skew;
  await cp.cycle();
  tick(60e3); cp.tick(uid, 'i2'); cp.editTask(uid, t => { t.status = 'Complete'; }); await stable(cp, pm); // a minute later, newer work through the hub
  assert.ok(skew < -9 * 60e3, `the crew phone knows its clock is ahead of the hub (${skew})`);
  assert.equal(pm.sync.fromText('t', uid, 'crew', text.resultAt, skew), false, 'the results text is older than what the hub sent the PM');
});

test('a results text for a sheet the office phone does not hold goes up as old as the copy it is, so it never undoes a newer office edit', async () => {
  const hub = fresh(), shared = await lib, sp = await makePhone(hub, 'super'), cp = await makePhone(hub, 'crew', { crew: 'Crew A' }), s2 = await makePhone(hub, 'super');
  await stable(sp, cp, s2);
  s2.net.down = true; // a second office phone with no signal since before the sheet was made
  const uid = sp.addTask({ sentAt: sp.now(), items: [{ id: 'i1', text: 'Pull wire' }] });
  await stable(sp, cp);
  tick(10e3); sp.editTask(uid, t => { t.reply = 'Use the red tape'; }); await sp.cycle(); // the office writes after the crew last pulled
  tick(10e3); cp.tick(uid, 'i1'); const text = clone(cp.editTask(uid, t => Object.assign(t, { status: 'Complete', resultAt: cp.now() })));
  // the offline phone opens the crew's results text (tasks.html openCode: a sheet it does not hold), then gets signal back
  assert.equal(s2.sync.fromText('t', uid, 'assign', text.assignAt || text.sentAt), true);
  s2.save('schwab.tasks', [...s2.tasks(), { ...shared.normTask(text), origin: 'mine' }]);
  await s2.cycle(); s2.net.down = false;
  await stable(s2, sp);
  assert.equal(s2.task(uid).status, 'Complete', 'the results it brought stay');
  assert.deepEqual([hub.tasks.get(uid).a.reply, s2.task(uid).reply, sp.task(uid).reply], ['Use the red tape', 'Use the red tape', 'Use the red tape']);
});
