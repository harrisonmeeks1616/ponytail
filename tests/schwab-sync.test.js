#!/usr/bin/env node
// The hub sync engine (docs/schwab/sync.mjs) against a small in-process fake hub that applies the rules in
// docs/schwab/HUB.md. The fake is written here, independent of hub/Code.gs, so a misreading on either side shows up.

process.env.TZ = 'America/New_York'; // the job's zone; the real hub's hours math (and its test double) require it, and the dates below are local days

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
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
const O_KEYS = ['id', 'date', 'by', 'floor', 'area', 'crew', 'members', 'size', 'scope', 'refs', 'allot', 'allotNote', 'est', 'estNote', 'pStart', 'pStop', 'checkIn', 'review', 'reviewer', 'followUp', 'reply', 'replyAt', 'replyBy', 'aLang', 'sentAt'];
const C_KEYS = ['lead', 'aStart', 'aStop', 'delay', 'status', 'doneText', 'remain', 'comments', 'cLang', 'resultAt'];

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
    const dev = req.dev, A = req.action === 'keys' ? this.keysAction : this[req.action];
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
    if (office ? this.clamp(w.crewAt) > r.cAt : this.clamp(w.crewAt) >= r.cAt) { // the office needs a strictly newer stamp: a tie never wipes crew results
      r.c = Object.fromEntries(C_KEYS.map(k => [k, w[k]]));
      for (const l of ['items', 'checks']) r.ticks[l] = Object.fromEntries(arrOf(w[l]).map(i => [i.id, { done: !!i.done, at: num(i.at) }]));
      r.cAt = this.clamp(w.crewAt); applied = true;
    }
    delete r.fresh;
    if (applied) r.rev = this.bump();
    return { key: w.uid, status: 'ok', task: this.taskView(r) };
  }
  // shifts: worker rules for the key's own device, PM rules for the pm key
  pushShift(role, dev, w) {
    if (!/^[\w-]{1,40}$/.test(w.id || '') || !/^\d{4}-\d{2}-\d{2}$/.test(w.date || '') || !/^\d\d:\d\d/.test(w.in || '')) return { key: w.id, status: 'rejected', reason: 'invalid' };
    if (this.tomb.some(t => t.kind === 'shifts' && t.key === w.id)) return { key: w.id, status: 'rejected', reason: 'deleted' };
    const cur = this.shifts.get(w.id), own = w.device && w.device === dev && !w.gone && !(w.edited && (w.edited.who || w.edited.in || w.edited.out)) || (role !== 'pm' && w.device === dev);
    if (own) {
      if (!cur) {
        const twin = [...this.shifts.values()].some(s => !s.gone && !s.device && s.who.toLowerCase() === w.who.toLowerCase() && s.date === w.date);
        this.shifts.set(w.id, { ...w, edited: { who: false, in: false, out: false }, gone: twin, rev: this.bump() });
      } else if (cur.device !== w.device) return { key: w.id, status: 'rejected', reason: 'forbidden' };
      else if (!cur.gone) {
        const before = JSON.stringify(cur);
        if (num(w.at) > num(cur.at) && !cur.edited.who) { cur.who = w.who; cur.at = w.at; }
        if (!cur.edited.in) cur.in = w.in;
        if (!cur.edited.out && w.out) cur.out = w.out;
        if (!(cur.edited.who || cur.edited.in || cur.edited.out)) { cur.crew = w.crew; cur.tasks = w.tasks; }
        if (JSON.stringify(cur) !== before) cur.rev = this.bump();
      }
    } else if (role !== 'pm') return { key: w.id, status: 'rejected', reason: 'forbidden' };
    else { // PM rules: as sent, but a shift never changes phones and a clock-out is not erased by a phone that has not pulled it
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
    const tasks = [...this.tasks.values()].filter(r => r.rev > since && inWin(r.a.date) && (role !== 'crew' || !req.crews || req.crews.includes(r.a.crew))).map(r => this.taskView(r));
    const shifts = [...this.shifts.values()].filter(s => s.rev > since && inWin(s.date) && (role === 'pm' || s.device === dev)).map(clone);
    const reports = role === 'crew' ? [] : [...this.reports.values()].filter(r => r.rev > since && inWin(r.date)).map(r => this.reportView(r));
    const config = this.config && this.configRev > since ? this.config : undefined;
    const deleted = this.tomb.filter(t => t.rev > since && (role !== 'crew' || t.kind !== 'reports')), events = role === 'crew' ? [] : this.events.filter(e => e.rev > since);
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
  const settings = { lang: '', worker: o.worker || '', device: o.device ?? `dev${p.n}`, role: role === 'pm' ? 'Project manager' : 'Superintendent', crews: [{ name: 'Crew A', lead: '', members: '' }], floors: ['Level 1'], checks: [], project: 'P', site: 'S', super: '', pm: '', pin: '',
    hubUrl: o.url ?? URL_A, hubKey: o.key ?? KEYS[role], hubRole: o.noRole ? '' : role, hubCrew: o.crew || '' };
  if (!o.storage) storage.set('schwab.settings', settings);
  p.net = { down: false };
  p.attempts = 0;
  p.fetch = async (url, init) => { p.attempts++; if (p.net.down) throw new TypeError('down'); return hub.fetch(url, init); };
  const norm = o.norm || {};
  p.sync = makeSync({ fetchImpl: o.fetchImpl || p.fetch, now: p.now, storage, timers, hidden: o.hidden || (() => false), norm, S: o.S,
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
    clockIn(who, over = {}) { // crew and tasks are on the shift too (HUB.md); the plain template may not know them yet
      const s = Object.assign(shared.normShift({ id: `s${p.n}x${++p.k}`, device: storage.get('schwab.settings').device, who, date: DAY, in: '07:00', ...over }), { crew: over.crew || '', tasks: over.tasks || [] });
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
  assert.deepEqual(Object.keys(w).sort(), ['checks', 'crewAt', 'date', 'items', 'uid', ...C_KEYS].sort(), 'ticks and results, plus the day the hub needs to validate a sheet');
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
  const id = w.clockIn('Jose L', { crew: 'Crew A', tasks: ['T1019-02'] });
  await w.cycle();
  const first = hub.shifts.get(id);
  assert.deepEqual([first.who, first.in, first.crew, first.tasks, first.edited], ['Jose L', '07:00', 'Crew A', ['T1019-02'], { who: false, in: false, out: false }]);
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
  // a shift the PM adds by hand is pushed as sent; a later phone shift for that person and day is filed as gone and never shows on the worker's clock
  const manual = shared.normShift({ id: 'pmadd1', device: '', who: 'Tre W', date: DAY, in: '08:00', out: '16:00', edited: { who: true, in: true, out: true } });
  pm.save('schwab.crewHours', [...pm.crewHours(), manual]);
  await pm.cycle();
  assert.deepEqual([hub.shifts.get('pmadd1').device, hub.shifts.get('pmadd1').edited.out], ['', true]);
  const tre = await makePhone(hub, 'crew', { crew: 'Crew A', worker: 'tre w' });
  tre.clockIn('tre w');
  await tre.cycle();
  assert.equal([...hub.shifts.values()].find(s => s.device === tre.settings().device).gone, true);
  await tre.cycle();
  assert.equal(tre.hours().length, 0, 'the PM entry stands: the twin leaves the worker phone');
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
  pm.save('schwab.crewHours', [shared.normShift({ id, device: w.settings().device, who: 'Jose L', date: DAY, in: '07:00' })]); // an old text opened on the PM phone: no clock-out yet
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
  const blank = () => makePhone(hub, 'crew', { url: '', key: '', noRole: true });
  let p = await blank();
  assert.equal(p.sync.hubStatus().state, 'off');
  const ok = await p.sync.joinFrom(link());
  assert.deepEqual([ok.ok, ok.role, ok.crew, ok.needsName, ok.needsCrew], [true, 'crew', 'Crew A', true, false]);
  const s = p.settings();
  assert.deepEqual([s.hubUrl, s.hubKey, s.hubRole, s.hubCrew], [URL_A, KEYS.crew, 'crew', 'Crew A']);
  assert.ok(s.device, 'a device id exists before the first request');
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
  const fresh2 = await pm.sync.invite('crew', 'Crew A'), again = await lost.sync.joinFrom(await unpack(fresh2.url.split('#p=')[1]));
  assert.equal(again.ok, true);
  await lost.cycle();
  assert.equal(lost.sync.hubStatus().state, 'live');
  // disconnect
  p = lost; p.changes.length = 0;
  p.sync.disconnect();
  assert.equal(p.sync.hubStatus().state, 'off');
  assert.deepEqual([p.settings().hubUrl, p.settings().hubKey, p.settings().hubRole, p.hubSync()], ['', '', '', null]);
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
    shifts: [{ id: 's1', device: cp.settings().device, who: 'x', date: DAY, in: '25:99' }, { id: 's2', device: cp.settings().device, who: 'Zed', date: DAY, in: '07:00', edited: 'yes' }],
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
  assert.deepEqual(cp.hours().map(s => s.id), ['s2']);
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
    assert.deepEqual([c.body.v, c.body.key, c.body.dev], [1, KEYS.crew, cp.settings().device]);
    assert.ok(!c.url.includes(KEYS.crew));
  }
  // a reply that is a web page (wrong address, or access not set to anyone)
  const page = await makePhone(hub, 'crew', { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('<html>'); } }) });
  await page.cycle();
  assert.deepEqual([page.sync.hubStatus().state, page.sync.hubStatus().message], ['error', 'That address did not answer like the hub. Check the hub link.']);
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
  assert.deepEqual(Object.keys(hub.config).sort(), ['at', 'checks', 'crews', 'floors', 'pin', 'pm', 'project', 'site', 'super']);
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
  assert.ok(!hub.calls.some(c => c.action === 'pull' && c.init && c.body.dev === cp.settings().device && false));
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
  assert.deepEqual(hub.calls.filter(c => c.action === 'pull' && c.body.dev === cp.settings().device).map(c => c.body.since), [0, hub.rev], 'first contact: a full pull, then (after the push) only what changed');
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
  const extra = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const ES = { ...(await import('../docs/schwab/es.mjs')).default, ...extra };
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
  assert.deepEqual([S.hubUrl, S.hubKey, S.hubRole, typeof S.device], [URL_A, KEYS.crew, 'crew', 'string']);
  p.sync.disconnect();
  assert.deepEqual([S.hubUrl, S.hubKey, S.hubRole], ['', '', '']);
});

test('the PM phone keeps a clock-out it holds that the hub does not have yet', async () => {
  const hub = fresh(), shared = await lib, pm = await makePhone(hub, 'pm'), w = await makePhone(hub, 'crew', { worker: 'Jose L' });
  const id = w.clockIn('Jose L');
  await w.cycle();
  assert.equal(hub.shifts.get(id).out, '');
  pm.save('schwab.crewHours', [shared.normShift({ id, device: w.settings().device, who: 'Jose L', date: DAY, in: '07:00', out: '15:00' })]); // the clock-out text was opened on the PM phone first
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
  assert.equal(cp.hubSync(), null, 'no state is written for a hub the phone has left');
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
  const pulls = hub.calls.filter(c => c.action === 'pull' && c.body.dev === cp.settings().device);
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
    const opts = { storage, fetchImpl: hub.fetch, now: clock, timers, hidden: () => g.document.hidden };
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
  const { createHub } = require('./helpers/google-mock'), { unpack } = await lib;
  const mock = createHub({ now: T0 }), k = mock.setup();
  let pushes = 0;
  const real = { clock: () => mock.now(), fetch: async (url, init) => { if (JSON.parse(init.body).action === 'push') pushes++; const text = mock.raw(init.body); return { ok: true, status: 200, json: async () => JSON.parse(text) }; } };
  const rowsOf = title => { const head = mock.header(title); return mock.table(title).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))); };
  const sp = await makePhone(real, 'super', { key: k.super }), pm = await makePhone(real, 'pm', { key: k.pm }), cp = await makePhone(real, 'crew', { key: k.crew, crew: 'Crew A', worker: 'Jose L' });
  const settleAll = async (...ps) => { for (let i = 0; i < 3; i++) for (const p of ps) { mock.advance(25e3); await p.cycle(); } };
  // the superintendent sets up the project and a sheet
  sp.save('schwab.settings', { ...sp.settings(), floors: ['Basement', 'Level 3'], crews: [{ name: 'Crew A', lead: 'Mike', members: 'Mike, Jose L' }] });
  const uid = sp.addTask({ id: 'T1019-01', floor: 'Level 3', scope: 'Pull 12 AWG to E-301', lead: 'Mike' });
  await sp.cycle();
  assert.equal(sp.sync.hubStatus().state, 'live', sp.sync.hubStatus().message);
  assert.deepEqual(rowsOf('Tasks').map(r => [r['Task ID'], r.Scope]), [['T1019-01', 'Pull 12 AWG to E-301']]);
  // the crew phone gets the sheet and the project settings, then works
  mock.advance(60e3); await cp.cycle();
  assert.equal(cp.task(uid)?.origin, 'link');
  assert.deepEqual(cp.settings().floors, ['Basement', 'Level 3']);
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
  const id = cp.clockIn('Jose L', { crew: 'Crew A', tasks: ['T1019-01'] });
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
  assert.deepEqual([sp.toasts, pm.toasts, cp.toasts], [[], [], []]);
  for (const p of [sp, pm, cp]) assert.equal(p.sync.hubStatus().pending, 0);
});

test('edits tapped while a pull is in flight are kept: a clock-out over a PM edit, a settings change over a hub one', async () => {
  const hub = fresh(), pm = await makePhone(hub, 'pm'), w = await makePhone(hub, 'crew', { crew: 'Crew A', worker: 'Jose L' });
  const a = await makePhone(hub, 'super'), b = await makePhone(hub, 'super');
  const id = w.clockIn('Jose L', { crew: 'Crew A', tasks: ['T1'] });
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
    if (req.dev === w.settings().device) { hub.before = null; w.editHours(id, s => { s.out = '15:30'; s.crew = 'Crew A'; }); }
  };
  await w.cycle();
  assert.deepEqual([w.hours()[0].in, w.hours()[0].out], ['07:30', '15:30'], "the PM's fix and the clock-out both stand");
  assert.equal(w.hours()[0].crew, 'Crew B', "the PM touched the shift: its crew is the PM's");
  await stable(w, pm);
  assert.deepEqual([hub.shifts.get(id).in, hub.shifts.get(id).out, hub.shifts.get(id).crew], ['07:30', '15:30', 'Crew B']);
  hub.before = async req => { if (req.action === 'pull' && req.dev === b.settings().device) { hub.before = null; b.save('schwab.settings', { ...b.settings(), floors: ['typed on b meanwhile'] }); } };
  tick(10e3);
  await b.cycle();
  assert.deepEqual(b.settings().floors, ['typed on b meanwhile'], 'a newer unsynced edit is not replaced by the hub copy');
  await stable(b, a);
  assert.deepEqual([hub.config.floors, a.settings().floors], [['typed on b meanwhile'], ['typed on b meanwhile']]);
});

test('the field lists here are the lists in hub/Code.gs, so the two cannot drift apart unnoticed', () => {
  const dir = path.join(__dirname, '..', 'docs', 'schwab'), mine = fs.readFileSync(path.join(dir, 'sync.mjs'), 'utf8'), hubSrc = fs.readFileSync(path.join(dir, 'hub', 'Code.gs'), 'utf8');
  const list = (src, name) => { const m = new RegExp(`const ${name} = (\\[[^\\]]*\\])`).exec(src); assert.ok(m, `${name} found`); return JSON.parse(m[1].replace(/'/g, '"')); };
  assert.deepEqual(list(mine, 'A_KEYS'), [...list(hubSrc, 'ASSIGN'), ...list(hubSrc, 'OFFICE_EXTRA')], 'office part');
  assert.deepEqual(list(mine, 'C_KEYS'), list(hubSrc, 'CREW'), 'crew part');
  const keysOf = (src, name) => { const m = new RegExp(`const ${name} = \\{([^}]*)\\}`).exec(src); assert.ok(m, `${name} found`); return [...m[1].matchAll(/(\w+):/g)].map(x => x[1]); };
  assert.deepEqual(keysOf(mine, 'X_TASK').sort(), ['aLang', 'assignAt', 'crewAt', 'reply', 'replyAt', 'replyBy'], 'the task fields shared.mjs still has to learn');
  const hubTask = new Set(keysOf(hubSrc.slice(hubSrc.indexOf('const TASK =')), 'TASK'));
  for (const k of [...list(mine, 'A_KEYS'), ...list(mine, 'C_KEYS'), ...keysOf(mine, 'X_TASK')]) assert.ok(hubTask.has(k), `the hub stores task field ${k}`);
  const cfgMine = keysOf(mine, 'CFG_TPL'), cfgHub = keysOf(hubSrc, 'CONFIG');
  assert.deepEqual(cfgMine.sort(), cfgHub.filter(k => k !== 'at').sort(), 'settings the hub shares');
  assert.deepEqual(keysOf(mine, 'X_REPORT').sort(), ['lang', 'pmAt']);
  assert.ok(/lang: 's', pmAt: 0/.test(hubSrc), 'the hub stores report lang and pmAt');
});
