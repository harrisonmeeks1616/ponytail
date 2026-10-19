#!/usr/bin/env node
// The hub screens (docs/schwab/live.mjs): relative time, sheet relevance, crew grouping, who is on site, per-person weekly
// hours (the same hundredths as report.mjs), the accountant's CSV, search, the activity sentences, the header dot, the
// typed-text translation helpers, every view's markup (escaping, who sees what, speed with 12 crews and 60 events) and the
// taps that change things (delete asks first and goes to the hub first, connect, archive, rotate). No DOM and no network:
// a few fake elements and a fake sync stand in for them. ROOT=/path/to/docs/schwab runs it against another copy of the app.
//   node --test tests/schwab-live.test.js

process.env.TZ = 'America/New_York'; // the job's zone: weeks, DST and "today" below are local days

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = process.env.ROOT || path.join(__dirname, '..', 'docs', 'schwab');
const load = f => import(pathToFileURL(path.join(ROOT, f)).href);
const libP = load('shared.mjs'), liveP = load('live.mjs'), repP = load('report.mjs'), esP = load('es.mjs');

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const NOW = new Date(2026, 9, 19, 14, 0, 0).getTime(); // Monday 2026-10-19, 2 pm
const DAY = '2026-10-19', MON = '2026-10-19', LASTMON = '2026-10-12';
const at = (day, hm) => new Date(`${day}T${hm}`).getTime();
const min = n => n * 6e4, hour = n => n * 36e5;
const KEY = 'k'.repeat(32);

let lib, L, live, rep, ES, SP;
test.before(async () => {
  [lib, live, rep, ES] = [await libP, await liveP, await repP, (await esP).default];
  L = lib.L;
  SP = Object.hasOwn(ES, '{n} min ago'); // false until es-live.json is merged into es.mjs: the Spanish checks wait for it
});
test.beforeEach(() => { live.resetUi(); lib.setLang('en'); });
const es = (name, fn) => test(name, t => (SP ? fn(t) : t.skip('es-live.json is not merged into es.mjs yet')));

// ---------- builders ----------
const HUB_FIELDS = { reply: '', replyAt: 0, replyBy: '', aLang: '', assignAt: 0 }; // sync.mjs keeps these beside the template's own
const task = (o = {}) => Object.assign(lib.normTask({ uid: 'u' + Math.random().toString(36).slice(2, 8), id: 'T1019-01', date: DAY, crew: 'Crew A', items: [{ id: 'a', text: 'Pull' }, { id: 'b', text: 'Test' }], sentAt: NOW - hour(1), ...o }),
  Object.fromEntries(Object.entries(HUB_FIELDS).map(([k, v]) => [k, o[k] ?? v])));
const shift = (o = {}) => lib.normShift({ id: 's' + Math.random().toString(36).slice(2, 8), device: 'dev1', who: 'Mike R', crew: 'Crew A', date: DAY, in: '07:00', out: '15:30', tasks: [], ...o });
const report = (o = {}) => lib.normReport({ date: DAY, super: 'Dana', status: 'On plan', results: 'All good', updatedAt: NOW, ...o });

function mkSync(over = {}) {
  const calls = [];
  const s = {
    calls, status: { state: 'live', message: '', at: NOW - 45e3, pending: 0, role: 'pm', crew: '', rev: 1 }, data: { events: [], onsite: [], at: NOW - 45e3, info: { sheetUrl: 'https://docs.google.com/spreadsheets/d/abc/edit' } },
    hubStatus() { return this.status; }, liveData() { return this.data; },
    async cycle() { calls.push(['cycle']); return this.status; }, async translate(items, from, to) { calls.push(['translate', items, from, to]); return items.map(x => 'T:' + x); },
    async records(q) { calls.push(['records', q]); return { ok: true, items: [], cursor: '' }; }, async stats() { return { ok: true, rows: {}, cells: 7.5e6, cellLimit: 1e7, sheetUrl: '' }; },
    async purge(kind, key) { calls.push(['purge', kind, key]); return { ok: true, rev: 2 }; }, async rotate(role) { calls.push(['rotate', role]); return { ok: true, key: KEY }; },
    async archive(before) { calls.push(['archive', before]); return { ok: true, sheetUrl: 'https://docs.google.com/spreadsheets/d/arch/edit', moved: { tasks: 3 } }; },
    async selftest() { return { ok: true, checks: [{ name: 'write', ok: true, detail: 'ok' }] }; },
    async connect(url, key) { calls.push(['connect', url, key]); return { ok: true, role: 'pm' }; }, disconnect() { calls.push(['disconnect']); },
    async joinFrom(d) { calls.push(['joinFrom', d]); return { ok: true, role: d.role, crew: d.crew || '' }; }, async invite(role, crew) { calls.push(['invite', role, crew]); return { ok: true, url: 'https://x.test/#p=abc' }; },
    ...over,
  };
  return s;
}
function mkCtx(o = {}) {
  const calls = [], sync = o.sync || mkSync();
  const S = structuredClone(lib.DEFAULT_SETTINGS);
  S.crews = ['A', 'B', 'C', 'D'].map(x => ({ name: 'Crew ' + x, lead: '', members: `Mike R ${x}, Jose L ${x}` }));
  S.me = 'Harrison';
  const ctx = { S, tasks: () => [], shifts: () => [], reports: () => [], role: 'pm', day: DAY, sync, now: () => NOW, calls, saved: [], removed: [],
    go: h => calls.push(['go', h]), render: () => calls.push(['render']), toast: (m, tone) => calls.push(['toast', m, tone]),
    saveTask: t => ctx.saved.push(t), remove: async (k, key) => { ctx.removed.push([k, key]); return true; }, ask: async () => true, ...o };
  return ctx;
}
const toasts = ctx => ctx.calls.filter(c => c[0] === 'toast');
const names = calls => calls.map(c => c[0]);

// ---------- relative time ----------

test('ago: just now, minutes, hours, yesterday, days, then the date', () => {
  const a = ts => live.ago(ts, NOW, 'en');
  assert.equal(a(0), '');
  assert.equal(a(NOW - 20e3), 'just now');
  assert.equal(a(NOW - min(1)), '1 min ago');
  assert.equal(a(NOW - min(5)), '5 min ago');
  assert.equal(a(NOW - min(59)), '59 min ago');
  assert.equal(a(NOW - min(60)), '1 h ago');
  assert.equal(a(NOW - hour(23)), '23 h ago');
  assert.equal(a(NOW - hour(26)), 'yesterday');
  assert.equal(a(NOW - hour(24 * 3)), '3 days ago');
  assert.equal(a(NOW - hour(24 * 10)), lib.niceDate(ymd(new Date(NOW - hour(24 * 10))), 'en'));
  assert.equal(a(NOW + min(3)), 'just now', 'a phone clock a little ahead never says "in 3 minutes"');
});
test('ago counts calendar days across a clock change', () => {
  const now = new Date(2026, 10, 2, 10, 0).getTime(); // the day after the clocks went back
  assert.equal(live.ago(new Date(2026, 10, 1, 9, 0).getTime(), now, 'en'), 'yesterday');
  const spring = new Date(2026, 2, 9, 10, 0).getTime();
  assert.equal(live.ago(new Date(2026, 2, 8, 9, 0).getTime(), spring, 'en'), 'yesterday');
});
es('ago in Spanish', () => {
  assert.equal(live.ago(NOW - 20e3, NOW, 'es'), 'ahora mismo');
  assert.equal(live.ago(NOW - min(5), NOW, 'es'), 'hace 5 min');
  assert.equal(live.ago(NOW - hour(2), NOW, 'es'), 'hace 2 h');
  assert.equal(live.ago(NOW - hour(26), NOW, 'es'), 'ayer');
  assert.equal(live.ago(NOW - hour(72), NOW, 'es'), 'hace 3 días');
});

// ---------- sheets: status, relevance, grouping ----------

const states = {
  blocked: () => task({ id: 'B', aStart: '07:30', status: 'Blocked', resultAt: at(DAY, '09:00') }),
  review: () => task({ id: 'R', aStart: '07:30', aStop: '09:00', status: 'Complete', resultAt: at(DAY, '09:05') }),
  working: () => task({ id: 'W', aStart: '07:30' }),
  followup: () => task({ id: 'F', status: 'Partial', review: 'Follow-up needed' }),
  sent: () => task({ id: 'S' }),
  draft: () => task({ id: 'D', sentAt: 0 }),
  accepted: () => task({ id: 'A', status: 'Complete', review: 'Accepted' }),
};
test('rank puts what needs the office first, accepted last', () => {
  const order = ['blocked', 'review', 'working', 'followup', 'sent', 'draft', 'accepted'];
  assert.deepEqual(order.map(k => live.rank(states[k]())), [0, 1, 2, 3, 4, 5, 6]);
  const shuffled = [...order].reverse().map(k => states[k]());
  assert.deepEqual(live.sortSheets(shuffled).map(t => t.id), ['B', 'R', 'W', 'F', 'S', 'D', 'A']);
});
test('rank: a blocked sheet that was reviewed drops out of the blocked group', () => {
  assert.equal(live.rank(task({ status: 'Blocked', review: 'Follow-up needed' })), 3);
  assert.equal(live.rank(task({ status: 'Blocked', review: 'Accepted' })), 6);
});
test('sortSheets: same rank, newest crew activity first, then by id', () => {
  const old = task({ id: 'T-1', aStart: '07:00' }), fresh = task({ id: 'T-2', aStart: '07:00', items: [{ id: 'a', text: 'x', done: true, at: at(DAY, '13:00') }] });
  const none1 = task({ id: 'T-4' }), none2 = task({ id: 'T-3' });
  assert.deepEqual(live.sortSheets([old, fresh]).map(t => t.id), ['T-2', 'T-1']);
  assert.deepEqual(live.sortSheets([none1, none2]).map(t => t.id), ['T-3', 'T-4']);
  const input = [none1, none2];
  live.sortSheets(input);
  assert.deepEqual(input.map(t => t.id), ['T-4', 'T-3'], 'the input is not reordered');
});
test('lastActivity: ticks, results, start and stop (a stop before the start is the next morning)', () => {
  assert.equal(live.lastActivity(task()), 0);
  assert.equal(live.lastActivity(task({ aStart: '07:30' })), at(DAY, '07:30'));
  assert.equal(live.lastActivity(task({ aStart: '07:30', aStop: '10:00' })), at(DAY, '10:00'));
  assert.equal(live.lastActivity(task({ aStart: '22:00', aStop: '02:00' })), at(DAY, '02:00') + 864e5);
  assert.equal(live.lastActivity(task({ aStart: '07:30', resultAt: NOW - 5 })), NOW - 5);
  assert.equal(live.lastActivity(task({ items: [{ id: 'a', text: 'x', done: true, at: 123456 }], checks: [{ id: 'c', text: 'y', done: true, at: 999999999999 }] })), 999999999999);
});
test('groupByCrew: the crew with the most urgent sheet first, then the crew list order, no crew last', () => {
  const sheets = [task({ crew: 'Crew A', id: '1', status: 'Complete', review: 'Accepted' }), task({ crew: 'Crew B', id: '2' }), task({ crew: '', id: '3', status: 'Blocked' }),
    task({ crew: 'Crew C', id: '4' }), task({ crew: 'Crew D', id: '5', status: 'Blocked' }), task({ crew: 'Crew B', id: '6', aStart: '08:00' })];
  const g = live.groupByCrew(sheets, ['Crew A', 'Crew B', 'Crew C', 'Crew D']);
  assert.deepEqual(g.map(x => x.crew), ['Crew D', 'Crew B', 'Crew C', 'Crew A', ''], 'blocked first, then working, then sent, then accepted; no crew last even when blocked');
  assert.deepEqual(g.find(x => x.crew === 'Crew B').sheets.map(t => t.id), ['6', '2']);
  const tie = live.groupByCrew([task({ crew: 'Crew C' }), task({ crew: 'Crew A' }), task({ crew: 'Zed' })], ['Crew A', 'Crew C']);
  assert.deepEqual(tie.map(x => x.crew), ['Crew A', 'Crew C', 'Zed'], 'equal urgency keeps the crew list order, unknown crews after');
});
test('filterSheets: words, accents, case, crew, status, newest day first', () => {
  const a = task({ id: 'T1-01', date: '2026-10-19', crew: 'Crew A', scope: 'Instalar tubería en el sótano', status: 'Complete' });
  const b = task({ id: 'T1-02', date: '2026-10-18', crew: 'Crew B', scope: 'Pull wire to E-301', status: 'Blocked', comments: 'No power' });
  const c = task({ id: 'T1-03', date: '2026-10-18', crew: 'Crew B', scope: 'Cleanup', review: 'Accepted', status: 'Complete' });
  const d = task({ id: 'T1-04', date: '2026-10-17', crew: 'Crew A', review: 'Follow-up needed', status: 'Partial' });
  const all = [d, b, c, a];
  const ids = q => live.filterSheets(all, q).map(t => t.id);
  assert.deepEqual(ids({}), ['T1-01', 'T1-02', 'T1-03', 'T1-04'], 'newest day first, then relevance');
  assert.deepEqual(ids({ q: 'TUBERIA sotano' }), ['T1-01'], 'accents and case ignored, every word must match');
  assert.deepEqual(ids({ q: 'e-301 power' }), ['T1-02']);
  assert.deepEqual(ids({ q: 'nothing like this' }), []);
  assert.deepEqual(ids({ crew: 'Crew B' }), ['T1-02', 'T1-03']);
  assert.deepEqual(ids({ status: 'review' }), ['T1-01', 'T1-02'], 'finished and not yet reviewed');
  assert.deepEqual(ids({ status: 'Blocked' }), ['T1-02']);
  assert.deepEqual(ids({ status: 'Accepted' }), ['T1-03']);
  assert.deepEqual(ids({ status: 'Follow-up needed' }), ['T1-04']);
  assert.deepEqual(ids({ q: '2026-10-18', crew: 'Crew B', status: 'Accepted' }), ['T1-03']);
});

// ---------- who is on site ----------

test('onSite: open shifts under 16 hours, one line per person, newest shift wins', () => {
  const e = (who, date, inn, crew = '') => ({ who, date, in: inn, crew });
  const got = live.onSite([e('Mike R', DAY, '07:00'), e('mike  r', DAY, '08:00'), e('José L', DAY, '06:00'), e('Old Timer', '2026-10-18', '07:00'), e('Soon', DAY, '14:03'), e('Later', DAY, '15:00'), e('', DAY, '07:00'), e('NoTime', DAY, '')], NOW);
  assert.deepEqual(got.map(p => [p.who, p.in]), [['José L', '06:00'], ['mike  r', '08:00'], ['Soon', '14:03']], 'a missed clock-out from yesterday is not "on site"; 3 minutes ahead is clock difference, an hour ahead is not');
  assert.equal(live.onSite([e('Night', '2026-10-18', '23:00')], NOW).length, 1, 'an overnight shift started 15 hours ago still counts');
  assert.equal(live.onSite([e('Night', '2026-10-18', '21:59')], NOW).length, 0, '16 hours and over was a missed clock-out');
});
test('openShifts keeps open shifts that were not removed', () => {
  const got = live.openShifts([shift({ out: '' }), shift({ out: '15:00' }), shift({ out: '', gone: true })]);
  assert.equal(got.length, 1);
  assert.deepEqual(Object.keys(got[0]).sort(), ['crew', 'crewId', 'date', 'in', 'pid', 'who']);
});

// ---------- hours by person ----------

test('peopleWeeks: per person per Monday to Sunday week, hundredths rounded per shift like report.mjs', async () => {
  const S = structuredClone(lib.DEFAULT_SETTINGS);
  const shifts = [
    shift({ id: 'a1', who: 'Mike R', date: '2026-10-12', in: '07:00', out: '14:45' }),     // 7h 45m = 7.75
    shift({ id: 'a2', who: 'mike r', date: '2026-10-18', in: '07:00', out: '07:01' }),     // Sunday: 1 min = 2 hundredths (rounded per shift)
    shift({ id: 'a3', who: 'Míke R'.replace('í', 'i'), date: '2026-10-18', in: '08:00', out: '08:01' }), // another 2, not round(3.33)=3
    shift({ id: 'a4', who: 'Mike R', date: '2026-10-19', in: '07:00', out: '15:00' }),     // Monday: the next week
    shift({ id: 'a5', who: 'Ana P', date: '2026-10-13', in: '07:00', out: '15:30', crew: '' }),
    shift({ id: 'a6', who: 'Mike R', date: '2026-10-13', in: '07:00', out: '15:30', gone: true }),
  ];
  const ps = live.peopleWeeks(shifts, S, NOW);
  assert.deepEqual(ps.map(p => p.who), ['Ana P', 'Mike R']);
  const mike = ps[1];
  assert.deepEqual(mike.weeks.map(w => [w.mon, w.hours]), [[MON, 800], [LASTMON, 775 + 2 + 2]], 'newest week first; the removed shift is not counted');
  assert.equal(mike.hours, 800 + 779);
  assert.equal(live.h2(779), '7.79');
  // the same numbers report.mjs gives for the same shifts
  const ref = rep.byPerson(shifts.filter(s => !s.gone), undefined, S).find(p => p.who === 'Mike R');
  assert.equal(mike.hours, ref.hours);
  for (const w of mike.weeks) assert.equal(w.hours, rep.byPerson(w.shifts, undefined, S)[0].hours, 'each week matches the timesheet screen');
  assert.equal(rep.monday('2026-10-18'), LASTMON, 'a Sunday belongs to the week that began the Monday before');
});
test('peopleWeeks: nights across a clock change are real hours', () => {
  const S = structuredClone(lib.DEFAULT_SETTINGS);
  const fall = live.peopleWeeks([shift({ date: '2026-10-31', in: '22:00', out: '06:00' })], S, NOW)[0];   // the night the hour repeats: 9 real hours
  const spring = live.peopleWeeks([shift({ date: '2026-03-07', in: '22:00', out: '06:00' })], S, NOW)[0]; // the night the hour vanishes: 7 real hours
  assert.equal(fall.hours, 900);
  assert.equal(spring.hours, 700);
});
test('peopleWeeks: no clock-out is flagged once it is past a real shift, a current shift is "live"', () => {
  const S = structuredClone(lib.DEFAULT_SETTINGS);
  const p = live.peopleWeeks([shift({ id: 'o1', date: '2026-10-15', in: '07:00', out: '' }), shift({ id: 'o2', date: DAY, in: '07:00', out: '' })], S, NOW)[0];
  assert.deepEqual(p.weeks.map(w => [w.mon, w.open, w.live]), [[MON, 0, 1], [LASTMON, 1, 0]]);
  assert.equal(p.hours, 0, 'an open shift counts 0 hours, as on the timesheet');
});
test('weekCsv is the accountant spreadsheet for that week (or one person)', () => {
  const S = structuredClone(lib.DEFAULT_SETTINGS);
  const shifts = [shift({ id: 'c1', who: 'Mike R', date: '2026-10-12', in: '07:00', out: '14:45', crew: 'Crew A' }), shift({ id: 'c2', who: 'Ana P', date: '2026-10-13', in: '07:00', out: '15:30', crew: 'Crew B' }),
    shift({ id: 'c3', who: 'Mike R', date: '2026-10-19', in: '07:00', out: '15:00' }), shift({ id: 'c4', who: 'Gone G', date: '2026-10-14', in: '07:00', out: '15:00', gone: true }), shift({ id: 'c5', who: '=cmd|calc', date: '2026-10-14', in: '07:00', out: '15:00' })];
  const csv = live.weekCsv(shifts, LASTMON, S);
  const week = shifts.filter(s => !s.gone && s.date >= LASTMON && s.date <= '2026-10-18').sort((a, b) => a.date.localeCompare(b.date));
  assert.equal(csv, rep.timesheetCsv(rep.byPerson(week, 'en', S)), 'the same file Send to accountant makes');
  assert.match(csv, /^Name,Crew,Date,Day,Clock in,Clock out,Hours,Tasks,Note\r\n/);
  assert.match(csv, /Mike R,Crew A,2026-10-12,Mon,7:00 AM,2:45 PM,7.75/);
  assert.ok(!csv.includes('Gone G') && !csv.includes('2026-10-19'), 'removed shifts and other weeks stay out');
  assert.ok(csv.includes("'=cmd|calc") && !/(^|,)=cmd/m.test(csv), 'a name that looks like a formula is quoted');
  const one = live.weekCsv(shifts, LASTMON, S, live.peopleWeeks(shifts, S, NOW).find(p => p.who === 'Ana P').key);
  assert.ok(one.includes('Ana P') && !one.includes('Mike R'), 'one person: the timesheet the By person screen shows');
  assert.match(one, /All crew,,,,,Week total,8.50/);
});

// ---------- the activity feed ----------

test('eventLine rebuilds the hub English into a sentence', () => {
  const E = (kind, who, text, ref) => ({ kind, who, text, ref, rev: 1, ts: 1, role: 'crew' });
  const line = e => live.eventLine(e, 'en');
  assert.equal(line(E('task.created', 'Harrison', 'New task T1019-02 for Crew A', 'T1019-02')), 'Harrison created T1019-02');
  assert.equal(line(E('task.started', 'Mike R', 'Crew A started T1019-02 at 7:31 AM', 'T1019-02')), 'Mike R started T1019-02');
  assert.equal(line(E('task.started', '', 'x', 'T1019-02')), 'Started T1019-02');
  assert.equal(line(E('task.status', 'Mike R', 'T1019-02 marked Blocked', 'T1019-02')), 'T1019-02 marked Blocked');
  assert.equal(line(E('task.reviewed', 'Harrison', 'T1019-02 reviewed: Follow-up needed', 'T1019-02')), 'T1019-02 reviewed: Follow-up needed');
  assert.equal(line(E('task.replied', 'Harrison', 'Message sent on T1019-02', 'T1019-02')), 'Message sent on T1019-02');
  assert.equal(line(E('clock.in', 'Jose L', 'Jose L clocked in at 7:02 AM, 2026-10-19', 's1')), 'Jose L clocked in');
  assert.equal(line(E('clock.out', 'Jose L', '...', 's1')), 'Jose L clocked out');
  assert.equal(line(E('report.sent', 'Dana', 'Daily report for 2026-10-19 sent by Dana', '2026-10-19')), `Daily report for ${lib.niceDate('2026-10-19', 'en')} sent`);
  assert.equal(line(E('purge', 'PM', 'Deleted task xyz', 'xyz')), 'A task sheet was deleted', 'a deleted sheet is never named by its uid');
  assert.equal(line(E('purge', 'PM', 'Deleted report 2026-10-19', '2026-10-19')), `The ${lib.niceDate('2026-10-19', 'en')} report was deleted`);
  assert.equal(line(E('pm.add', 'PM', 'PM added a shift for Jose L, 2026-10-19', 's1')), `PM added a shift for Jose L on ${lib.niceDate('2026-10-19', 'en')}`);
  assert.equal(line({ ...E('pm.edit', 'PM', 'PM edited Jose L, 2026-10-19', 's1'), name: 'José Luis' }), `PM changed the hours of José Luis on ${lib.niceDate('2026-10-19', 'en')}`, 'the roster name when the app knows the shift');
  assert.equal(line(E('pm.remove', 'PM', 'PM removed a shift for a worker, 2026-10-19', 's1')), `PM removed a shift for a worker on ${lib.niceDate('2026-10-19', 'en')}`);
  assert.equal(line(E('key.rotated', 'PM', 'Crew key replaced', '')), 'The crew key was replaced');
  assert.equal(line(E('archive', 'PM', 'Archived 12 rows older than 2026-07-01', '2026-07-01')), `12 rows older than ${lib.niceDate('2026-07-01', 'en')} archived`);
  assert.equal(line(E('purge', 'PM', 'Purged something', 'x')), 'Purged something', 'words the app does not know: the hub words');
  assert.equal(line(E('task.status', 'x', 'odd text', 'T1')), 'odd text', 'a status it does not know falls back to the hub words');
  assert.equal(line(E('mystery', '', '', '')), 'mystery');
});
es('eventLine in Spanish keeps names and ids', () => {
  const E = (kind, who, text, ref) => ({ kind, who, text, ref });
  assert.equal(live.eventLine(E('task.status', 'Mike R', 'T1019-02 marked Blocked', 'T1019-02'), 'es'), 'T1019-02: estado Bloqueado');
  assert.equal(live.eventLine(E('clock.in', 'Jose L', '', ''), 'es'), 'Jose L marcó entrada');
  assert.equal(live.eventLine(E('task.reviewed', 'H', 'T1 reviewed: Accepted', 'T1'), 'es'), 'T1 revisada: Aceptado');
});

// ---------- the header dot ----------

test('statusDot: nothing without a hub, an accessible label with one', () => {
  assert.equal(live.statusDot({ state: 'off' }, 'en'), '');
  assert.equal(live.statusDot(undefined, 'en'), '');
  assert.equal(live.statusDot({ state: '"><img>' }, 'en'), '', 'only the four states draw');
  for (const [state, word] of [['live', 'Live'], ['syncing', 'Syncing'], ['offline', 'Offline'], ['error', 'Problem']]) {
    const h = live.statusDot({ state, pending: 0 }, 'en', 'live');
    assert.match(h, new RegExp(`aria-label="Hub: ${word}"`));
    assert.match(h, new RegExp(`data-state="${state}"`));
    assert.match(h, /data-go="live"/);
  }
  assert.match(live.statusDot({ state: 'offline', pending: 3 }, 'en'), /aria-label="Hub: Offline, 3 not sent yet"/);
  assert.doesNotMatch(live.statusDot({ state: 'live', pending: 3 }, 'en'), /not sent/, 'a live hub has nothing waiting that matters');
});
es('statusDot in Spanish', () => assert.match(live.statusDot({ state: 'live' }, 'es'), /aria-label="Sistema central: En vivo"/));

// ---------- typed text in the reader's language ----------

const ctxHub = (state = 'live', sync = mkSync()) => { sync.status.state = state; return mkCtx({ sync }); };
function fakeEl(text, from, to, mode = 'view', extra = {}) {
  return { dataset: { state: 'pending', mode, from, to, ...extra }, innerHTML: '', hidden: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, querySelector: sel => (sel === '.tx-o' ? { textContent: text } : null) };
}
const rootOf = els => ({ querySelectorAll: sel => (sel === '.tx[data-state="pending"]' ? els.filter(e => e.dataset.state === 'pending') : []) });
const EVIL = `<img src=x onerror=alert(1)> "quoted" 'single' & <script>`;

test('txView: nothing changes without a hub, for the same language, or for empty text', () => {
  assert.equal(live.txView(ctxHub('off'), 'Hola <b>', 'es', 'en'), 'Hola &lt;b&gt;', 'no hub: exactly the escaped text, as before');
  assert.equal(live.txView(ctxHub('live'), 'Hello', 'en', 'en'), 'Hello');
  assert.equal(live.txView(ctxHub('live'), 'Hello', '', 'en'), 'Hello', 'no language means English');
  assert.equal(live.txView(ctxHub('live'), 'Hello', 'fr', 'en'), 'Hello', 'an unknown language means English too');
  assert.equal(live.txView(ctxHub('live'), '   ', 'es', 'en'), '   ');
  assert.equal(live.txView(ctxHub('live'), null, 'es', 'en'), '');
});
test('txView: the original is drawn at once, waiting to be translated; never raw markup', () => {
  const h = live.txView(ctxHub('live'), EVIL, 'es', 'en');
  assert.match(h, /data-state="pending"/);
  assert.match(h, /data-from="es" data-to="en"/);
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;') && h.includes('&quot;quoted&quot;'));
  assert.ok(!h.includes('<img') && !h.includes('<script'));
});
test('txApply: one request per language pair, answers escaped, caption and toggle, remembered for the next draw', async () => {
  const sync = mkSync(), ctx = ctxHub('live', sync);
  sync.translate = async (items, from, to) => { sync.calls.push(['translate', items, from, to]); return items.map(x => (x === 'same text' ? x : `<b>${x}</b> "${from}->${to}"`)); };
  const a = fakeEl('Hola', 'es', 'en'), b = fakeEl('Adiós', 'es', 'en'), c = fakeEl('Hello', 'en', 'es'), d = fakeEl('same text', 'es', 'en');
  const root = rootOf([a, b, c, d]);
  await live.txApply(ctx, root);
  const calls = sync.calls.filter(x => x[0] === 'translate');
  assert.equal(calls.length, 2, 'es to en together, en to es on its own');
  assert.deepEqual(calls.find(x => x[3] === 'en')[1], ['Hola', 'Adiós', 'same text']);
  assert.deepEqual(calls.find(x => x[3] === 'es').slice(1), [['Hello'], 'en', 'es']);
  assert.equal(a.dataset.state, 'done');
  assert.ok(a.innerHTML.includes('&lt;b&gt;Hola&lt;/b&gt; &quot;es-&gt;en&quot;') && !a.innerHTML.includes('<b>Hola'), 'the translation is escaped like everything else');
  assert.match(a.innerHTML, /Auto-translated/);
  assert.match(a.innerHTML, /data-act="txToggle"/);
  assert.ok(a.innerHTML.includes('class="tx-o">Hola<'), 'the original stays one tap away');
  assert.equal(d.dataset.state, 'same', 'a name or number that comes back unchanged is not captioned');
  assert.doesNotMatch(d.innerHTML, /Auto-translated/);
  assert.equal(a.attrs['aria-busy'], undefined);
  // a second call finds nothing waiting; the next draw already has the answers and does not ask again
  await live.txApply(ctx, root);
  assert.equal(sync.calls.filter(x => x[0] === 'translate').length, 2);
  const again = live.txView(ctx, 'Hola', 'es', 'en');
  assert.match(again, /data-state="done"/);
  assert.equal(sync.calls.filter(x => x[0] === 'translate').length, 2, 'no request for a text already translated this session');
});
test('txApply: two calls at once do not translate the same text twice', async () => {
  const sync = mkSync(), ctx = ctxHub('live', sync), el = fakeEl('Una vez', 'es', 'en'), root = rootOf([el]);
  await Promise.all([live.txApply(ctx, root), live.txApply(ctx, root)]);
  assert.equal(sync.calls.filter(x => x[0] === 'translate').length, 1);
});
test('txApply: offline, an error or quota show the original and say so; it never throws', async () => {
  const sync = mkSync({ async translate(items) { return items; } }), ctx = ctxHub('offline', sync);
  const a = fakeEl('Hola', 'es', 'en');
  await live.txApply(ctx, rootOf([a]));
  assert.equal(a.dataset.state, 'na');
  assert.match(a.innerHTML, /Translation is not available right now/);
  assert.ok(a.innerHTML.includes('class="tx-o">Hola<'));
  const boom = mkSync({ async translate() { throw new Error('network'); } }), b = fakeEl('Hola', 'es', 'en');
  await live.txApply(ctxHub('live', boom), rootOf([b]));
  assert.equal(b.dataset.state, 'same', 'a live hub that gave nothing back (its daily limit, said once by the hub itself): just the original');
  const junk = mkSync({ async translate() { return 'not a list'; } }), c = fakeEl('Hola', 'es', 'en');
  await live.txApply(ctxHub('live', junk), rootOf([c]));
  assert.equal(c.dataset.state, 'same');
  await live.txApply({ sync: null }, rootOf([fakeEl('x', 'es', 'en')]));
  await live.txApply(ctxHub('live'), null);
});
test('txView with toggle off (inside a dialog, where a tap on any button closes it) has no button', async () => {
  const sync = mkSync(), ctx = ctxHub('live', sync), h = live.txView(ctx, 'Hola', 'es', 'en', { toggle: false });
  assert.match(h, /data-toggle="0"/);
  const el = fakeEl('Hola', 'es', 'en', 'view', { toggle: '0' });
  await live.txApply(ctx, rootOf([el]));
  assert.equal(el.dataset.state, 'done');
  assert.doesNotMatch(el.innerHTML, /<button/);
  assert.match(el.innerHTML, /Auto-translated/);
});
test('txField: the field keeps its text; a translated preview waits under it, hidden until it has something', async () => {
  const ctx = ctxHub('live'), h = live.txField(ctx, 'Completed', 't.doneText', EVIL, { rows: 3 }, 'es', 'en');
  assert.match(h, /<textarea[^>]*data-k="t.doneText"/);
  assert.match(h, /class="tx tx-pre hint"[^>]*data-for="t.doneText"[^>]*hidden/);
  assert.ok(!h.includes('<img') && !h.includes('<script'));
  assert.equal(live.txField(ctx, 'Completed', 'k', 'same lang', {}, 'en', 'en'), lib.field('Completed', 'k', 'same lang', {}), 'same language: just the field');
  assert.equal(live.txField(ctxHub('off'), 'Completed', 'k', 'Hola', {}, 'es', 'en'), lib.field('Completed', 'k', 'Hola', {}), 'no hub: just the field');
  const pre = fakeEl('Hola', 'es', 'en', 'pre');
  pre.hidden = true;
  await live.txApply(ctx, rootOf([pre]));
  assert.equal(pre.hidden, false);
  assert.match(pre.innerHTML, /Auto-translated:<\/b> <span class="tx-t">T:Hola<\/span>/);
  const keep = fakeEl('Name 12', 'es', 'en', 'pre');
  await live.txApply(ctxHub('live', mkSync({ async translate(i) { return i; } })), rootOf([keep]));
  assert.equal(keep.hidden, true, 'nothing to show when the translation is the same');
});
es('translation captions in Spanish', async () => {
  lib.setLang('es');
  const ctx = ctxHub('live'), el = fakeEl('Hello', 'en', 'es');
  await live.txApply(ctx, rootOf([el]));
  assert.match(el.innerHTML, /Traducido automáticamente/);
  assert.match(el.innerHTML, /Ver original/);
});

// ---------- views ----------

const crewNames = Array.from({ length: 12 }, (_, i) => 'Crew ' + 'ABCDEFGHIJKL'[i]);
function bigCtx(over = {}) {
  const S = structuredClone(lib.DEFAULT_SETTINGS);
  S.crews = crewNames.map(name => ({ name, lead: '', members: '' }));
  S.me = 'Harrison';
  const tasks = crewNames.flatMap((crew, ci) => Array.from({ length: 5 }, (_, i) => task({ uid: `u${ci}-${i}`, id: `T1019-${ci * 5 + i}`, crew, floor: 'Level ' + (i + 1), area: 'East corridor', scope: 'Pull and terminate 12 AWG',
    ...[{}, { aStart: '07:30' }, { aStart: '07:30', aStop: '10:00', status: 'Complete', resultAt: NOW - min(5), doneText: 'Hecho', cLang: 'es' }, { status: 'Blocked', comments: 'No hay energía', cLang: 'es' }, { status: 'Complete', review: 'Accepted' }][i] })));
  const events = Array.from({ length: 60 }, (_, i) => ({ rev: 100 - i, ts: NOW - min(i * 3), who: 'Mike R', role: 'crew', kind: ['task.started', 'task.status', 'clock.in'][i % 3], text: i % 3 === 1 ? `T1019-${i} marked Blocked` : 'x', ref: `T1019-${i}` }));
  const people = Array.from({ length: 40 }, (_, i) => shift({ id: 'p' + i, who: `Worker ${i}`, crew: crewNames[i % 12], in: '07:00', out: '' }));
  const sync = mkSync();
  sync.data.events = events.slice(0, 50);
  sync.data.onsite = [{ who: 'Visitor V', date: DAY, in: '08:10' }];
  return mkCtx({ S, tasks: () => tasks, shifts: () => people, sync, ...over });
}

test('liveView: 12 crews, 60 events and 40 people stay fast and small', () => {
  const ctx = bigCtx(), t0 = process.hrtime.bigint();
  const html = live.liveView(ctx);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 400, `took ${ms}ms`);
  assert.ok(html.length < 600e3, `html is ${html.length} characters`);
  assert.equal((html.match(/class="live-crew"/g) || []).length, 12);
  assert.equal((html.match(/<li><small>/g) || []).length, 50, 'the feed shows 50 events, newest first');
  assert.equal((html.match(/data-act="liveMsg"/g) || []).length, 48, 'one Message button per sheet that is not accepted');
  assert.equal((html.match(/class="live-done"/g) || []).length, 12, 'accepted sheets are one quiet line');
  assert.equal((html.match(/data-act="liveReview"/g) || []).length, 24, 'Review only where the crew has sent results and nobody has reviewed');
  assert.match(html, /<div class="stat"><b>41<\/b><span>On site<\/span>/, '40 on the timesheet and a visitor the hub lists');
  assert.match(html, /data-act="liveRefresh"/);
  assert.match(html, /Updated just now/);
  assert.ok(html.indexOf('T1019-3') > -1);
});
test('liveView: what needs the office comes first in a crew, crews are grouped, today only', () => {
  const tasks = [task({ id: 'OLD', date: '2026-10-18', crew: 'Crew A' }), task({ id: 'ACC', crew: 'Crew A', status: 'Complete', review: 'Accepted' }), task({ id: 'WORK', crew: 'Crew A', aStart: '08:00' }), task({ id: 'BLK', crew: 'Crew A', status: 'Blocked', comments: 'Sin luz', cLang: 'es' })];
  const html = live.liveView(mkCtx({ tasks: () => tasks, sync: mkSync({ hubStatus: () => ({ state: 'off' }), liveData: () => ({ events: [], onsite: [], at: 0, info: {} }) }) }));
  assert.ok(!html.includes('OLD'), 'only today');
  const at = id => html.indexOf(`>${id}<`);
  assert.ok(at('BLK') > 0 && at('BLK') < at('WORK') && at('WORK') < at('ACC'), 'blocked, working, accepted');
  assert.match(html, /1 of 3 done/);
  assert.ok(html.includes('Sin luz'), 'with no hub the crew note is shown as written');
  assert.doesNotMatch(html, /class="tx"/);
});
test('liveView with no hub works from this phone and offers to set it up', () => {
  const ctx = mkCtx({ sync: mkSync({ hubStatus: () => ({ state: 'off', message: '', at: 0, pending: 0, role: '', crew: '', rev: 0 }) }), shifts: () => [shift({ out: '', in: '13:00' })], tasks: () => [task()] });
  const html = live.liveView(ctx);
  assert.match(html, /Not connected to a hub/);
  assert.match(html, /data-go="settings"/);
  assert.doesNotMatch(html, /liveRefresh/);
  assert.match(html, /Mike R/, 'who is clocked in comes from the local timesheet');
  assert.match(html, /Connect the hub to see crews/);
  const none = live.liveView(mkCtx({ sync: undefined, tasks: () => [] }));
  assert.match(none, /No task sheets for today yet/, 'even a phone with no sync object draws');
});
test('liveView: offline says so, with what is waiting and the hub message', () => {
  const sync = mkSync();
  Object.assign(sync.status, { state: 'offline', pending: 2, message: 'No signal. Saved on this phone.' });
  const html = live.liveView(mkCtx({ sync }));
  assert.match(html, /data-state="offline"/);
  assert.match(html, /2 not sent yet/);
  assert.match(html, /No signal. Saved on this phone./);
});
test('liveView: "Updated" follows the last good round trip, not only the last change', () => {
  const sync = mkSync();
  sync.data.at = NOW - min(25);       // the last pull that carried news
  sync.status.at = NOW - 30e3;        // the hub has answered every 20 seconds since, "nothing new"
  assert.match(live.liveView(mkCtx({ sync })), /Updated just now/);
  Object.assign(sync.status, { state: 'offline', at: NOW - min(7) });
  assert.match(live.liveView(mkCtx({ sync })), /Updated 7 min ago/);
});
test('liveView: only the office sees it; the superintendent sees it too', () => {
  assert.match(live.liveView(mkCtx({ role: 'crew' })), /for the office/);
  assert.doesNotMatch(live.liveView(mkCtx({ role: 'super', tasks: () => [task()] })), /for the office/);
});
test('every view escapes what people typed', () => {
  const bad = 'X"onmouseover="alert(1)<img src=x><script>alert(2)</script>';
  const S = structuredClone(lib.DEFAULT_SETTINGS);
  S.crews = [{ name: bad, lead: bad, members: bad }];
  S.project = bad; S.me = bad;
  const tasks = [task({ id: bad, crew: bad, floor: bad, area: bad, scope: bad, comments: bad, doneText: bad, remain: bad, status: 'Blocked', reply: bad, replyAt: NOW - 1, members: [bad], followUp: bad })];
  const shifts = [shift({ who: bad, crew: bad, out: '' }), shift({ who: bad, crew: bad, date: '2026-10-14' })];
  const sync = mkSync();
  sync.data.events = [{ rev: 1, ts: NOW, who: bad, role: bad, kind: 'purge', text: bad, ref: bad }];
  sync.data.onsite = [{ who: bad, date: DAY, in: '09:00' }];
  const ctx = mkCtx({ S, tasks: () => tasks, shifts: () => shifts, reports: () => [report({ super: bad, results: bad, pmReview: bad })], sync });
  const all = [live.liveView(ctx), live.recordsView(ctx, 'people'), live.recordsView(ctx, 'sheets'), live.recordsView(ctx, 'reports'), live.hubSettingsView(ctx)];
  live.resetUi();
  live.recordsView(ctx, 'people');
  Object.assign(ctx, {});
  all.push(live.recordsView(ctx, 'people'));
  for (const html of all) {
    assert.ok(!html.includes('<img') && !html.includes('<script'), 'raw markup in: ' + html.slice(0, 80));
    assert.ok(!html.includes('"onmouseover="'), 'an attribute broken out of');
  }
  assert.match(all[0], /X&quot;onmouseover=&quot;alert\(1\)&lt;img src=x&gt;/);
});

test('recordsView: the PM sees three tabs and the tools, the superintendent sees sheets and reports only', () => {
  const pm = live.recordsView(bigCtx(), 'people');
  assert.equal((pm.match(/<a href="#records\//g) || []).length, 3);
  assert.match(pm, /data-act="recExport"/);
  assert.match(pm, /Download all \(JSON\)/);
  const sup = live.recordsView(bigCtx({ role: 'super' }), 'people');
  assert.equal((sup.match(/<a href="#records\//g) || []).length, 2);
  assert.doesNotMatch(sup, /recExport|recMenu|recCsv|recArchive|recPerson/, 'no export, delete, hours or archive for the superintendent');
  assert.match(sup, /aria-current="page">Task sheets/, 'People is not theirs: they land on sheets');
  assert.match(live.recordsView(mkCtx({ role: 'crew' }), 'sheets'), /for the office/);
});
test('recordsView people: people, then weeks with totals, then shifts, and the way to edit', () => {
  const shifts = [shift({ id: 'h1', who: 'Mike R', date: '2026-10-12', in: '07:00', out: '14:45', tasks: ['T1019-02'] }), shift({ id: 'h2', who: 'Mike R', date: '2026-10-19', in: '07:00', out: '' }), shift({ id: 'h3', who: 'Ana P', crew: 'Crew B', date: '2026-10-05', in: '07:00', out: '' })];
  const ctx = mkCtx({ shifts: () => shifts });
  const list = live.recordsView(ctx, 'people');
  assert.match(list, /<h2 class="group-h"><span>Hours by person<\/span><span>2<\/span><\/h2>/, 'the list says what it is');
  const key = who => live.peopleWeeks(shifts, ctx.S, NOW).find(p => p.who === who).key;
  assert.match(list, new RegExp(`data-act="recPerson" data-v="${key('Ana P')}"`));
  assert.match(list, /On the clock/);
  assert.match(list, /No clock-out/, "Ana's shift from two weeks ago was never closed");
  assert.match(list, /<b>0.00<\/b><small>This week<\/small>/);
  live.act(ctx, 'recPerson', { dataset: { v: key('Mike R') } });
  const detail = live.recordsView(ctx, 'people');
  assert.match(detail, /<h2>Mike R<\/h2><b class="total">7.75 hrs<\/b>/);
  assert.match(detail, /Mon, Oct 12 to Sun, Oct 18/);
  assert.match(detail, /data-go="clock\/2026-10-12"/, 'the PM can jump to the week to edit it');
  assert.match(detail, /data-act="recWeekCsv" data-mon="2026-10-12"/);
  assert.match(detail, /7:00 AM to 2:45 PM/);
  assert.match(detail, /Task T1019-02/);
  assert.match(detail, /<details class="card rec-week" open>/, 'the newest week is open');
  assert.equal((detail.match(/<details class="card rec-week"/g) || []).length, 2);
  const removed = live.recordsView(mkCtx({ shifts: () => [], role: 'pm' }), 'people');
  assert.match(removed, /No hours logged yet/);
});
test('recordsView people: a shift names its tasks as ids or as {uid, id}', () => {
  const mk = tasks => { const ctx = mkCtx({ shifts: () => [Object.assign(shift({ id: 'h1', who: 'Mike R', date: '2026-10-12', out: '15:00' }), { tasks })] }); live.resetUi(); live.recordsView(ctx, 'people'); live.act(ctx, 'recPerson', { dataset: { v: live.peopleWeeks(ctx.shifts(), ctx.S, NOW)[0].key } }); return live.recordsView(ctx, 'people'); };
  assert.match(mk(['T1019-02', 'T1019-03']), /Tasks T1019-02, T1019-03/);
  assert.match(mk([{ uid: 'u1', id: 'T1019-02' }]), /Task T1019-02/);
  assert.doesNotMatch(mk([{ uid: 'u1', id: 'T1019-02' }, null, { uid: 'u2' }]), /object|undefined|null/);
});
test('recordsView sheets: search, crew and status filters, delete only for the PM, paged', async () => {
  const tasks = Array.from({ length: 130 }, (_, i) => task({ uid: 'q' + i, id: 'T-' + i, date: ymd(new Date(2026, 9, 19 - (i % 20))), crew: i % 2 ? 'Crew A' : 'Crew B', scope: i === 7 ? 'special wire' : 'ordinary', status: i % 5 === 0 ? 'Blocked' : '' }));
  const ctx = mkCtx({ tasks: () => tasks });
  let html = live.recordsView(ctx, 'sheets');
  assert.equal((html.match(/class="rec-row"/g) || []).length, 100, 'a hundred at a time');
  assert.match(html, /Show more \(30\)/);
  assert.match(html, /data-act="recMenu" data-kind="task"/);
  await live.act(ctx, 'recMore', { dataset: {} });
  assert.equal((live.recordsView(ctx, 'sheets').match(/class="rec-row"/g) || []).length, 130);
  live.resetUi();
  live.recordsView(ctx, 'sheets');
  await live.act(ctx, 'recFilter', { dataset: { f: 'crew', v: 'Crew A' } });
  html = live.recordsView(ctx, 'sheets');
  assert.ok(!html.includes('>T-0<') && html.includes('>T-1<'));
  assert.match(html, /data-f="crew" data-v="Crew A" aria-pressed="true"/);
  await live.act(ctx, 'recFilter', { dataset: { f: 'status', v: 'Blocked' } });
  assert.ok(live.recordsView(ctx, 'sheets').includes('>T-5<') && !live.recordsView(ctx, 'sheets').includes('>T-3<'));
  live.resetUi();
  live.recordsView(ctx, 'sheets');
  const box = { innerHTML: '' }, prev = globalThis.document;
  globalThis.document = { getElementById: id => (id === 'recList' ? box : null), querySelectorAll: () => [] };
  try { assert.equal(live.onInput(ctx, { dataset: { lv: 'q' }, value: 'SPECIAL' }), true); } finally { globalThis.document = prev; }
  assert.ok(box.innerHTML.includes('>T-7<') && !box.innerHTML.includes('>T-8<'), 'typing filters the list in place');
  assert.equal(live.onInput(ctx, { dataset: { k: 't.scope' }, value: 'x' }), false, 'other fields are left to the app');
});
test('recordsView reports: newest first, waiting decisions, no delete for the superintendent', () => {
  const rs = [report({ date: '2026-10-18', status: 'At risk', decisions: [{ q: 'Breaker?', pm: '' }, { q: 'Done', pm: 'Approved' }] }), report({ date: DAY, pmReview: 'H' }), lib.normReport({ date: '2026-10-01', super: 'untouched' })];
  const html = live.recordsView(mkCtx({ reports: () => rs }), 'reports');
  assert.ok(html.indexOf('href="#report/2026-10-19"') < html.indexOf('href="#report/2026-10-18"'));
  assert.ok(!html.includes('2026-10-01'), 'an empty day nobody touched is not a record');
  assert.match(html, /1 waiting/);
  assert.match(html, /PM reviewed: H/);
  assert.match(live.recordsView(mkCtx({ reports: () => ({ [DAY]: rs[1] }) }), 'reports'), /href="#report\/2026-10-19"/, 'the date-keyed object works too');
  assert.doesNotMatch(live.recordsView(mkCtx({ role: 'super', reports: () => rs }), 'reports'), /recMenu/);
});
test('recordsView: older records and storage appear only with a hub the role may use', () => {
  const off = mkSync({ hubStatus: () => ({ state: 'off' }) });
  assert.doesNotMatch(live.recordsView(mkCtx({ sync: off }), 'sheets'), /Older records on the hub|Hub storage|recArchive/);
  const hubPm = live.recordsView(mkCtx({}), 'sheets');
  assert.match(hubPm, /Older records on the hub/);
  assert.match(hubPm, /data-act="recOlder" data-kind="tasks"/);
  assert.match(hubPm, /Hub storage/);
  assert.match(hubPm, /Open the Google Sheet/);
  assert.match(hubPm, /id="recArch" value="2026-07-21" max="2026-09-19"/, 'archive defaults to 90 days back and cannot pick the last 30');
  const sync = mkSync();
  sync.status.role = 'super';
  const sup = live.recordsView(mkCtx({ sync, role: 'super' }), 'sheets');
  assert.match(sup, /Older records on the hub/);
  assert.doesNotMatch(sup, /Hub storage|recArchive/);
  const crewKey = mkSync();
  crewKey.status.role = 'crew';
  assert.doesNotMatch(live.recordsView(mkCtx({ sync: crewKey }), 'reports'), /Older records on the hub/);
  const peopleSuper = mkSync();
  peopleSuper.status.role = 'super';
  assert.doesNotMatch(live.recordsView(mkCtx({ sync: peopleSuper, role: 'pm' }), 'people'), /recOlder/, "a superintendent's hub key cannot read hours");
});
test('recordsView only draws the storage meter once the hub has answered, and warns at 70 percent', async () => {
  const ctx = mkCtx();
  let html = live.recordsView(ctx, 'sheets');
  assert.match(html, /Checking…/);
  live.after(ctx, null);
  await new Promise(r => setImmediate(r));
  assert.ok(ctx.calls.some(c => c[0] === 'render'), 'redraws when the numbers arrive');
  html = live.recordsView(ctx, 'sheets');
  assert.match(html, /75% used \(7,500,000 of 10,000,000 cells\)/);
  assert.match(html, /progress meter warn/);
  assert.match(html, /Almost full/);
  assert.deepEqual([live.meter({ cells: 6.9e6, cellLimit: 1e7 }).warn, live.meter({ cells: 7e6, cellLimit: 1e7 }).warn, live.meter({ cells: 1, cellLimit: 0 }).pct, live.meter({ cells: 2e7, cellLimit: 1e7 }).pct], [false, true, 0, 100]);
});
test('recordsView: only a Google Sheet link is ever drawn as a link', () => {
  const sync = mkSync();
  sync.data.info.sheetUrl = 'https://evil.example/phish';
  assert.doesNotMatch(live.recordsView(mkCtx({ sync }), 'sheets'), /evil\.example/);
  assert.doesNotMatch(live.hubSettingsView(mkCtx({ sync })), /evil\.example/);
  sync.data.info.sheetUrl = 'https://docs.google.com/spreadsheets/d/abc/edit#gid=1';
  const h = live.hubSettingsView(mkCtx({ sync }));
  assert.match(h, /href="https:\/\/docs\.google\.com\/spreadsheets\/d\/abc\/edit#gid=1" target="_blank" rel="noopener noreferrer"/);
});

test('hubSettingsView: who sees what', () => {
  const off = mkSync({ hubStatus: () => ({ state: 'off', message: '', at: 0, pending: 0, role: '', crew: '', rev: 0 }) });
  const connect = live.hubSettingsView(mkCtx({ sync: off }));
  assert.match(connect, /id="hubUrl"/);
  assert.match(connect, /id="hubKey" type="password"/);
  assert.match(connect, /data-act="hubConnect"/);
  const crewOff = live.hubSettingsView(mkCtx({ sync: off, role: 'crew' }));
  assert.doesNotMatch(crewOff, /hubKey|hubConnect/);
  assert.match(crewOff, /data-act="paste"/);
  const mk = (role, crew = '') => { const s = mkSync(); Object.assign(s.status, { role, crew }); return live.hubSettingsView(mkCtx({ sync: s, role })); };
  const pm = mk('pm');
  for (const a of ['hubSync', 'hubTest', 'hubInvite" data-v="crew', 'hubInvite" data-v="super', 'hubRotate" data-v="crew', 'hubRotate" data-v="super', 'hubDisconnect']) assert.ok(pm.includes(`data-act="${a}"`), a);
  const sup = mk('super');
  assert.match(sup, /hubDisconnect/);
  assert.doesNotMatch(sup, /hubInvite|hubRotate|hubTest/);
  const crew = mk('crew', 'Crew B');
  assert.match(crew, /<dt>Crew<\/dt><dd>Crew B<\/dd>/);
  assert.match(crew, /hubSync/);
  assert.match(crew, /hubDisconnect/);
  assert.doesNotMatch(crew, /hubInvite|hubRotate|hubTest|Open the Google Sheet/, 'crew phones see only status, their crew and disconnect');
});
test('hubSettingsView never draws a key', () => {
  const ctx = mkCtx();
  Object.assign(ctx.S, { hubKey: KEY, hubUrl: 'https://script.google.com/macros/s/x/exec' });
  const html = live.hubSettingsView(ctx);
  assert.ok(!html.includes(KEY) && !html.includes('script.google.com'));
});
test('hubSettingsView: the self test is a checklist in plain words', async () => {
  const sync = mkSync({ async selftest() { return { ok: true, checks: [{ name: 'write', ok: true, detail: 'ok' }, { name: 'translate', ok: false, detail: 'quota' }, { name: 'future check', ok: true, detail: 'ok' }] }; } });
  const ctx = mkCtx({ sync });
  await live.act(ctx, 'hubTest', { dataset: {} });
  const html = live.hubSettingsView(ctx);
  assert.match(html, /<li data-ok="true"><span aria-hidden="true">✓<\/span><span class="sr">Passed<\/span> Write a record<\/li>/);
  assert.match(html, /<li data-ok="false">.*Translate a sentence with a drawing number <small>quota<\/small>/);
  assert.match(html, /future check/);
  assert.match(html, /Something failed/);
  assert.equal(names(ctx.calls).filter(n => n === 'render').length, 2, 'drawn once while running and once with the answer');
});

// ---------- what a message or a review writes ----------

test('withMessage and withReview stamp the office part so the newest wins, and keep the rest', () => {
  const t = task({ assignAt: 5000, updatedAt: 5000, comments: 'crew text', status: 'Complete', followUp: 'old note' });
  const m = live.withMessage(t, '  Call me  ', 4000, 'Harrison');
  assert.deepEqual([m.reply, m.replyBy, m.replyAt, m.assignAt], ['Call me', 'Harrison', 5001, 5001], 'a stamp never goes backwards');
  assert.equal(live.withMessage(t, 'x', NOW, 'H').assignAt, NOW);
  assert.equal(live.withMessage(t, 'y'.repeat(5000), NOW, 'H').reply.length, 1000);
  assert.equal(m.comments, 'crew text');
  assert.equal(t.reply, '', 'the sheet it was given is not changed');
  const acc = live.withReview(t, 'Accepted', 'ignored', NOW, 'Harrison');
  assert.deepEqual([acc.review, acc.reviewer, acc.followUp, acc.assignAt, acc.updatedAt], ['Accepted', 'Harrison', 'old note', NOW, NOW]);
  const fu = live.withReview(t, 'Follow-up needed', '  Label L3-17  ', NOW, 'Harrison');
  assert.equal(fu.followUp, 'Label L3-17');
  assert.equal(live.withReview(t, 'Follow-up needed', '   ', NOW, 'H').followUp, 'old note', 'an empty note keeps the old one');
  assert.equal(fu.status, 'Complete');
});

// ---------- delete ----------

test('deleteRecord: PM only, asks first, the hub first, nothing deleted if the hub fails', async () => {
  const t = task({ uid: 'del1', id: 'T9-09' });
  // not the PM
  let ctx = mkCtx({ role: 'super', tasks: () => [t] });
  assert.equal(await live.deleteRecord(ctx, 'task', 'del1'), false);
  assert.deepEqual([ctx.removed.length, ctx.sync.calls.length], [0, 0]);
  // unknown record, unknown kind: no question, no change
  ctx = mkCtx({ tasks: () => [t] });
  assert.equal(await live.deleteRecord(ctx, 'task', 'nope'), false);
  assert.equal(await live.deleteRecord(ctx, 'shift', 'del1'), false, 'hours are removed on the Crew hours screen, not here');
  // says no
  const asked = [];
  ctx = mkCtx({ tasks: () => [t], ask: async (msg, yes, tone) => { asked.push([msg, yes, tone]); return false; } });
  assert.equal(await live.deleteRecord(ctx, 'task', 'del1'), false);
  assert.equal(asked.length, 1);
  assert.deepEqual([asked[0][1], asked[0][2]], ['Delete', 'danger']);
  assert.match(asked[0][0], /Delete task T9-09\? This can't be undone\. It is also removed from the hub\./);
  assert.deepEqual([ctx.removed.length, ctx.sync.calls.filter(c => c[0] === 'purge').length], [0, 0]);
  // yes, with a hub: purge, then remove
  const order = [];
  const sync = mkSync({ async purge(kind, key) { order.push('purge ' + kind + ' ' + key); return { ok: true, rev: 3 }; } });
  ctx = mkCtx({ tasks: () => [t], sync, remove: async (k, key) => { order.push('remove ' + k + ' ' + key); return true; } });
  assert.equal(await live.deleteRecord(ctx, 'task', 'del1'), true);
  assert.deepEqual(order, ['purge task del1', 'remove task del1']);
  assert.ok(ctx.calls.some(c => c[0] === 'render'));
  // the hub says no (offline): nothing is deleted anywhere
  const down = mkSync({ async purge() { return { ok: false, error: 'offline', message: 'No signal.' }; } });
  ctx = mkCtx({ tasks: () => [t], sync: down });
  assert.equal(await live.deleteRecord(ctx, 'task', 'del1'), false);
  assert.equal(ctx.removed.length, 0);
  assert.deepEqual(toasts(ctx)[0].slice(1), ['No signal.', 'bad']);
  // no hub: this phone only, and the question does not mention a hub
  const q = [];
  ctx = mkCtx({ tasks: () => [t], reports: () => [report({ date: '2026-10-17' })], sync: mkSync({ hubStatus: () => ({ state: 'off' }) }), ask: async m => (q.push(m), true) });
  assert.equal(await live.deleteRecord(ctx, 'report', '2026-10-17'), true);
  assert.deepEqual(ctx.removed, [['report', '2026-10-17']]);
  assert.ok(!/hub/.test(q[0]) && /report/.test(q[0]));
  assert.equal(ctx.sync.calls.length, 0);
  // a superintendent's hub key cannot purge: treated as no hub for the PM's own phone
  const superKey = mkSync();
  superKey.status.role = 'super';
  ctx = mkCtx({ tasks: () => [t], sync: superKey, ask: async m => (q.push(m), true) });
  await live.deleteRecord(ctx, 'task', 'del1');
  assert.equal(superKey.calls.filter(c => c[0] === 'purge').length, 0);
});

// ---------- taps ----------

test('owns and act: only this file\'s actions, nothing else answered', async () => {
  for (const a of ['liveMsg', 'recMenu', 'hubConnect', 'txToggle']) assert.equal(live.owns(a), true);
  for (const a of ['set', 'del', 'paste', 'hTap', undefined, '__proto__', 'constructor']) assert.equal(live.owns(a), false, String(a));
  assert.equal(await live.act(mkCtx(), 'del', { dataset: {} }), false);
});
test('txToggle flips between the translation and the original', async () => {
  const box = { dataset: { view: 't' } }, btn = { dataset: {}, closest: sel => (sel === '.tx' ? box : null) };
  await live.act(mkCtx(), 'txToggle', btn);
  assert.equal(box.dataset.view, 'o');
  await live.act(mkCtx(), 'txToggle', btn);
  assert.equal(box.dataset.view, 't');
});
function withDoc(fields, fn) {
  const prev = globalThis.document;
  globalThis.document = { getElementById: id => fields[id] || null, querySelectorAll: () => [], activeElement: null };
  return Promise.resolve().then(fn).finally(() => { globalThis.document = prev; });
}
test('connect: both boxes first, errors stay on the form, success redraws', () => withDoc({ hubUrl: { value: '' }, hubKey: { value: '' }, hubErr: { textContent: '' } }, async () => {
  const ctx = mkCtx(), btn = { dataset: {}, disabled: false }, err = globalThis.document.getElementById('hubErr');
  await live.act(ctx, 'hubConnect', btn);
  assert.equal(err.textContent, 'Paste the hub link and the key.');
  assert.equal(ctx.sync.calls.length, 0);
  Object.assign(globalThis.document.getElementById('hubUrl'), { value: ' https://script.google.com/macros/s/X/exec ' });
  Object.assign(globalThis.document.getElementById('hubKey'), { value: KEY });
  ctx.sync.connect = async (url, key) => { ctx.sync.calls.push(['connect', url, key]); return { ok: false, error: 'unauthorized', message: 'The hub did not accept this phone.' }; };
  await live.act(ctx, 'hubConnect', btn);
  assert.equal(err.textContent, 'The hub did not accept this phone.');
  assert.equal(btn.disabled, false);
  assert.ok(!names(ctx.calls).includes('render'), 'the form keeps what was typed');
  ctx.sync.connect = async (url, key) => { ctx.sync.calls.push(['connect', url, key]); return { ok: true, role: 'pm' }; };
  await live.act(ctx, 'hubConnect', btn);
  assert.deepEqual(ctx.sync.calls.at(-1), ['connect', ' https://script.google.com/macros/s/X/exec ', KEY]);
  assert.ok(names(ctx.calls).includes('render'));
  assert.equal(toasts(ctx).at(-1)[1], 'Connected as Project manager');
}));
test('disconnect and rotate ask first', async () => {
  let ctx = mkCtx({ ask: async () => false });
  await live.act(ctx, 'hubDisconnect', { dataset: {} });
  await live.act(ctx, 'hubRotate', { dataset: { v: 'crew' } });
  assert.equal(ctx.sync.calls.length, 0);
  ctx = mkCtx();
  await live.act(ctx, 'hubDisconnect', { dataset: {} });
  await live.act(ctx, 'hubRotate', { dataset: { v: 'super' } });
  await live.act(ctx, 'hubRotate', { dataset: { v: 'pm' } });
  assert.deepEqual(ctx.sync.calls, [['disconnect'], ['rotate', 'super'], ['rotate', 'crew']], 'a role it does not know is the crew key, never the PM key');
});
test('archive: a real date, at least 30 days back, asked first', () => withDoc({ recArch: { value: '' } }, async () => {
  const box = globalThis.document.getElementById('recArch'), ctx = mkCtx(), el = { dataset: {} };
  for (const bad of ['', 'soon', '2026-02-30', '2026-09-20', '2026-10-19']) {
    box.value = bad;
    await live.act(ctx, 'recArchive', el);
  }
  assert.equal(ctx.sync.calls.length, 0);
  assert.equal(toasts(ctx).length, 5);
  box.value = '2026-09-19';
  const no = mkCtx({ ask: async () => false });
  await live.act(no, 'recArchive', el);
  assert.equal(no.sync.calls.length, 0);
  await live.act(ctx, 'recArchive', el);
  assert.deepEqual(ctx.sync.calls, [['archive', '2026-09-19']]);
  assert.match(live.recordsView(ctx, 'sheets'), /Rows archived: 3/);
}));
test('refresh and sync now run a cycle and redraw; a failure turns the button back on', async () => {
  const ctx = mkCtx(), btn = { dataset: {}, disabled: false };
  await live.act(ctx, 'liveRefresh', btn);
  assert.deepEqual(names(ctx.calls), ['render']);
  assert.equal(ctx.sync.calls[0][0], 'cycle');
  const boom = mkCtx({ sync: mkSync({ async cycle() { throw new Error('x'); } }) }), b2 = { dataset: {}, disabled: false };
  const keep = console.error;
  console.error = () => {};
  try { await live.act(boom, 'hubSync', b2); } finally { console.error = keep; }
  assert.equal(b2.disabled, false);
  assert.equal(toasts(boom)[0][1], 'That did not work. Try again.');
});
test('older records: paged from the hub, before what this phone has, never stored', async () => {
  const sync = mkSync();
  const pages = [{ ok: true, items: [lib.normTask({ uid: 'o1', date: '2026-08-01', id: 'T0801-01' })], cursor: '200' }, { ok: true, items: [lib.normTask({ uid: 'o2', date: '2026-07-01', id: 'T0701-01' })], cursor: '' }];
  sync.records = async q => { sync.calls.push(['records', q]); return pages.shift(); };
  const ctx = mkCtx({ sync, tasks: () => [task({ date: '2026-10-05' }), task({ date: '2026-09-20' })] });
  live.recordsView(ctx, 'sheets');
  await live.act(ctx, 'recOlder', { dataset: { kind: 'tasks' } });
  let html = live.recordsView(ctx, 'sheets');
  assert.deepEqual(sync.calls[0][1], { kind: 'tasks', from: '2000-01-01', to: '2026-09-19', q: '', who: '', cursor: '' }, 'everything before the oldest sheet on this phone');
  assert.match(html, /T0801-01/);
  assert.match(html, /Load more/);
  await live.act(ctx, 'recOlder', { dataset: { kind: 'tasks' } });
  assert.equal(sync.calls[1][1].cursor, '200');
  html = live.recordsView(ctx, 'sheets');
  assert.ok(html.includes('T0701-01') && html.includes('T0801-01') && html.includes('That is everything the hub has.'));
  assert.ok(!html.includes('Load more'));
  assert.ok(html.indexOf('T0801-01') < html.indexOf('T0701-01'), 'newest first');
  await live.act(ctx, 'recOlder', { dataset: { kind: 'shifts' } }); // a kind the page does not have a card for still stays inside the allowed list
  await live.act(ctx, 'recOlder', { dataset: { kind: 'events' } });
  assert.ok(sync.calls.every(c => ['tasks', 'shifts'].includes(c[1].kind)), 'only tasks, shifts or reports are ever asked for');
});
test('older records: a hub error is shown, and the button stays so it can be tried again', async () => {
  const sync = mkSync({ async records() { return { ok: false, error: 'offline', message: 'No signal.' }; } });
  const ctx = mkCtx({ sync });
  live.recordsView(ctx, 'reports');
  await live.act(ctx, 'recOlder', { dataset: { kind: 'reports' } });
  const html = live.recordsView(ctx, 'reports');
  assert.match(html, /role="alert">No signal\./);
  assert.match(html, /data-act="recOlder" data-kind="reports">Load more/);
});
test('exportData merges what the hub has with this phone, this phone winning, reports only if touched', () => {
  const mine = task({ uid: 'm1', scope: 'mine' }), theirs = task({ uid: 'm1', scope: 'hub copy' }), other = task({ uid: 'm2' });
  const ctx = mkCtx({ tasks: () => [mine], shifts: () => [shift({ id: 's1' })], reports: () => [report(), lib.normReport({ date: '2026-10-01' })] });
  const out = live.exportData(ctx, NOW, { tasks: [theirs, other], shifts: [shift({ id: 's1' }), shift({ id: 's2' })], reports: [report({ date: '2026-09-01' })] });
  assert.deepEqual(out.tasks.map(t => [t.uid, t.scope]), [['m1', 'mine'], ['m2', other.scope]]);
  assert.deepEqual(out.shifts.map(s => s.id), ['s1', 's2']);
  assert.deepEqual(out.reports.map(r => r.date), [DAY, '2026-09-01']);
  assert.equal(out.exportedAt, new Date(NOW).toISOString());
  assert.ok(!JSON.stringify(out).includes('hubKey'), 'no settings, so no keys');
});

// ---------- the sheets that open ----------

test('messageSheet and reviewSheet act on the sheet as it is now', async () => {
  // the dialogs need a browser; their pure parts are withMessage and withReview above. Here: the action finds the live copy.
  const t = task({ uid: 'live1' });
  const ctx = mkCtx({ tasks: () => [t] });
  const prev = globalThis.document;
  const opened = [];
  globalThis.document = { getElementById: () => null, createElement: () => { const d = { innerHTML: '', addEventListener() {}, showModal() { opened.push(this); }, querySelector: () => ({ focus() {}, onclick: null, hidden: false, value: '' }), querySelectorAll: () => [] }; return d; }, body: { append() {} } };
  try {
    await live.act(ctx, 'liveMsg', { dataset: { u: 'live1' } });
    assert.equal(opened.length, 1);
    assert.match(opened[0].innerHTML, /Message to Crew A/);
    assert.match(opened[0].innerHTML, /maxlength="1000"/);
    await live.act(ctx, 'liveMsg', { dataset: { u: 'gone' } });
    assert.equal(opened.length, 1, 'a sheet that is no longer there opens nothing');
    await live.act(ctx, 'liveReview', { dataset: { u: 'live1' } });
    assert.match(opened[1].innerHTML, /Review T1019-01/);
    assert.match(opened[1].innerHTML, /data-r="Accepted"/);
  } finally { globalThis.document = prev; }
});

// ---------- identity: people by id, sheets by uid (HUB.md, Identity) ----------

// Two people named Jose L, one on each crew, and the hours of each.
function twoJoses() {
  const ctx = mkCtx();
  Object.assign(ctx.S, { crews: [{ id: 'cA', name: 'Crew A', lead: '', members: 'Jose L' }, { id: 'cB', name: 'Crew B', lead: '', members: 'Jose L' }],
    people: [{ id: 'p1', name: 'Jose L', crewId: 'cA' }, { id: 'p2', name: 'Jose L', crewId: 'cB' }] });
  const shifts = [shift({ id: 'j1', who: 'Jose L', pid: 'p1', crew: 'Crew A', crewId: 'cA', date: '2026-10-13', in: '07:00', out: '15:00' }),
    shift({ id: 'j2', who: 'Jose L', pid: 'p1', crew: 'Crew A', crewId: 'cA', date: '2026-10-14', in: '07:00', out: '11:00' }),
    shift({ id: 'j3', who: 'jose l', pid: 'p2', crew: 'Crew B', crewId: 'cB', date: '2026-10-13', in: '06:00', out: '16:00' })];
  ctx.shifts = () => shifts;
  return { ctx, shifts };
}
const personRows = html => [...html.matchAll(/data-act="recPerson" data-v="([^"]+)"[^>]*><span class="rec-main"><b class="tid">([^<]+)<\/b>\s*<small>(.*?)<\/small>/gs)]
  .map(m => [m[1], m[2], (/<\/i> ([^<]+)<\/span>/.exec(m[3]) || [])[1] || '']);

test('By person: two people with one name are two people, each with their crew and only their own hours', () => {
  const { ctx } = twoJoses();
  assert.deepEqual(personRows(live.recordsView(ctx, 'people')), [['p1', 'Jose L', 'Crew A'], ['p2', 'Jose L', 'Crew B']]);
  live.act(ctx, 'recPerson', { dataset: { v: 'p2' } });
  const d = live.recordsView(ctx, 'people');
  assert.match(d, /<h2>Jose L<\/h2><b class="total">10.00 hrs<\/b>/, 'the second Jose: his 10 hours, not 22');
  assert.match(d, /Crew B/);
  assert.doesNotMatch(d, /Crew A/);
  assert.match(d, /data-act="recWeekCsv" data-mon="2026-10-12" data-v="p2" data-name="Jose L"/);
  const csv = live.weekCsv(ctx.shifts(), LASTMON, ctx.S, 'p2');
  assert.ok(csv.includes('Jose L,Crew B') && !csv.includes('Crew A'), "the week's file for him is his alone");
  assert.equal(live.peopleWeeks(ctx.shifts(), ctx.S, NOW).length, 2);
});
test('By person: renaming a person or a crew keeps the history together under the new names; a shift keeps its own label', () => {
  const { ctx, shifts } = twoJoses();
  assert.ok(lib.renamePerson(ctx.S, 'p1', 'José Luis') && lib.renameCrew(ctx.S, 'cB', 'Crew Bravo'));
  assert.deepEqual(live.peopleWeeks(shifts, ctx.S, NOW).map(p => [p.key, p.who, p.crew, p.shifts, p.hours]), [['p2', 'Jose L', 'Crew Bravo', 1, 1000], ['p1', 'José Luis', 'Crew A', 2, 1200]]);
  assert.deepEqual(personRows(live.recordsView(ctx, 'people')), [['p2', 'Jose L', 'Crew Bravo'], ['p1', 'José Luis', 'Crew A']]);
  live.act(ctx, 'recPerson', { dataset: { v: 'p1' } });
  assert.match(live.recordsView(ctx, 'people'), /<h2>José Luis<\/h2><b class="total">12.00 hrs<\/b>/, 'both of his shifts, clocked in as Jose L');
  assert.equal(shifts[0].who, 'Jose L', 'the shift itself keeps the name it was made with');
});
test('On site and the activity feed name people as the roster has them now, with their crew, and never merge two people', () => {
  const { ctx } = twoJoses();
  const open = [shift({ id: 'o1', who: 'Jose L', pid: 'p1', crewId: 'cA', crew: 'Crew A', in: '07:00', out: '' }), shift({ id: 'o2', who: 'Jose L', pid: 'p2', crewId: 'cB', crew: 'Crew B', in: '07:30', out: '' })];
  const hubList = [{ who: 'Jose L', in: '07:30', date: DAY }]; // the hub's own list names people only
  ctx.shifts = () => open;
  ctx.sync.data.onsite = hubList;
  assert.deepEqual(live.onSite([...live.openShifts(open), ...hubList], NOW, ctx.S).map(p => [p.key, p.who, p.crew]), [['p1', 'Jose L', 'Crew A'], ['p2', 'Jose L', 'Crew B']], 'two people; the line with a name only is one of them');
  lib.renamePerson(ctx.S, 'p1', 'José Luis');
  lib.renameCrew(ctx.S, 'cB', 'Crew Bravo');
  assert.deepEqual(live.onSite([...live.openShifts(open), ...hubList], NOW, ctx.S).map(p => [p.who, p.crew]), [['Jose L', 'Crew Bravo'], ['José Luis', 'Crew A']]);
  ctx.sync.data.events = [{ rev: 2, ts: NOW - min(5), who: 'Jose L', role: 'crew', kind: 'clock.in', text: '', ref: 'o1' }, { rev: 1, ts: NOW - min(9), who: 'Jose L', role: 'crew', kind: 'clock.in', text: '', ref: 'o2' }];
  const v = live.liveView(ctx);
  assert.match(v, /<b>José Luis<\/b>/);
  assert.match(v, /Crew Bravo · 1/);
  assert.match(v, /José Luis clocked in <span class="feed-crew">· Crew A<\/span>/, 'the feed line follows the roster through the shift it is about');
  assert.match(v, /Jose L clocked in <span class="feed-crew">· Crew Bravo<\/span>/);
});
test('sheets go by uid: two sheets with one number both show, each opens itself, both say so; a shift opens the sheet it was on', () => {
  const a = task({ uid: 'ua', id: 'T1019-01', crew: 'Crew A' }), b = task({ uid: 'ub', id: 'T1019-01', crew: 'Crew B' }), c = task({ uid: 'uc', id: 'T1019-02' }), old = task({ uid: 'uo', id: 'T1019-03', date: '2026-10-12' });
  const ctx = mkCtx({ tasks: () => [a, b, c, old] });
  const rec = live.recordsView(ctx, 'sheets');
  for (const u of ['ua', 'ub', 'uc', 'uo']) assert.match(rec, new RegExp(`href="#task/${u}/assign"`));
  assert.equal((rec.match(/Same number as another sheet/g) || []).length, 2, 'the two sheets that share a number, and no other');
  assert.equal((live.liveView(ctx).match(/Same number as another sheet/g) || []).length, 2, 'the live board says so too');
  // the feed: a uid opens that sheet (shown by its number); a number two sheets of the day share opens neither; one only one has opens it
  ctx.sync.data.events = [{ rev: 3, ts: NOW, kind: 'task.started', who: 'Mike', ref: 'ub', text: '' }, { rev: 2, ts: NOW, kind: 'task.started', who: 'Mike', ref: 'T1019-01', text: '' }, { rev: 1, ts: NOW, kind: 'task.started', who: 'Mike', ref: 'T1019-02', text: '' }];
  const feed = live.liveView(ctx).split('class="feed"')[1];
  assert.deepEqual([...feed.matchAll(/href="#task\/(\w+)\//g)].map(m => m[1]), ['ub', 'uc']);
  assert.match(feed, /Mike started T1019-01/);
  assert.doesNotMatch(feed, /started ub/, 'a uid is never shown as the number');
  ctx.sync.data.events = [{ rev: 5, ts: NOW, kind: 'task.created', who: 'Dana', ref: 'gone7', text: '' }, { rev: 4, ts: NOW, kind: 'task.created', who: 'Dana', ref: 'unum', text: '' }];
  const nonum = task({ uid: 'unum', id: '' });
  const feed2 = live.liveView({ ...ctx, tasks: () => [a, b, c, old, nonum] }).split('class="feed"')[1];
  assert.match(feed2, /Dana created a task sheet/, 'a sheet not on this phone: no uid');
  assert.match(feed2, /Dana created New task/, 'a sheet with no number yet');
  assert.doesNotMatch(feed2, /gone7|created unum/);
  const s = shift({ id: 'h1', who: 'Mike R', date: '2026-10-12', out: '15:00', tasks: [{ uid: 'uo', id: 'T1019-09' }, { uid: 'gone', id: 'T1019-07' }] });
  const pctx = mkCtx({ tasks: () => [old], shifts: () => [s] });
  live.recordsView(pctx, 'people'); // on the By person tab first, as a tap would be
  live.act(pctx, 'recPerson', { dataset: { v: live.peopleWeeks([s], pctx.S, NOW)[0].key } });
  assert.match(live.recordsView(pctx, 'people'), /Tasks <a href="#task\/uo\/assign">T1019-03<\/a>, T1019-07/, 'the number the sheet has now; one not on this phone keeps its label');
});

// ---------- house rules ----------

test('live.mjs imports where there is no DOM and writes no em dashes', () => {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'live.mjs')).href)}); if (typeof document !== 'undefined' || typeof localStorage !== 'undefined') throw new Error('a DOM is here'); console.log(typeof m.liveView)`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'function');
  for (const f of [path.join(ROOT, 'live.mjs'), __filename]) assert.ok(!fs.readFileSync(f, 'utf8').includes(String.fromCharCode(0x2014)), `${path.basename(f)} has an em dash`);
});
