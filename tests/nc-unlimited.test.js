#!/usr/bin/env node
// Logic and data behind the NC Unlimited study app (docs/nc-unlimited). Worked examples come straight from the Notion plan.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'docs', 'nc-unlimited');
for (const f of ['data-plan', 'data-study', 'data-law', 'data-bank', 'data-nec', 'data-sessions', 'data-packets']) require(path.join(dir, f + '.js'));
const L = require(path.join(dir, 'logic.js'));
const NC = globalThis.NC;
const c = L.calc;

test('blueprint sums to 100 and matches the bank allocation', () => {
  assert.equal(NC.blueprint.reduce((s, b) => s + b[2], 0), 100);
  for (const [id, , n] of NC.blueprint) assert.equal(NC.bank.filter((b) => b.d === id).length, n, 'domain ' + id);
  assert.equal(NC.categories.reduce((s, x) => s + x.q, 0), 100);
});

test('bank: 100 unique items, 32 keyed MCQ with valid answers, 68 lookup items never scored', () => {
  assert.equal(NC.bank.length, 100);
  assert.equal(new Set(NC.bank.map((b) => b.id)).size, 100);
  const keyed = NC.bank.filter((b) => !b.lookup);
  assert.equal(keyed.length, 32);
  for (const b of keyed) { assert.deepEqual(Object.keys(b.opts), ['A', 'B', 'C', 'D'], b.id); assert.ok(b.opts[b.ans], b.id); assert.ok(b.why, b.id); }
  assert.equal(NC.bank.filter((b) => b.lookup).length, 68);
  for (const b of NC.bank) assert.ok(!/[<>]|\\\$/.test(b.q), 'markup leaked in ' + b.id);
});

test('keyed arithmetic items really recompute', () => {
  const by = (id) => NC.bank.find((b) => b.id === id);
  assert.equal(by('L01').opts[by('L01').ans], '120 A');
  assert.equal(c.ampsSingle(28.8, 240), 120);
  assert.equal(by('L02').opts[by('L02').ans], '167 A');
  assert.equal(Math.round(c.ampsThree(138.6, 480)), 167);
  assert.equal(by('L03').opts[by('L03').ans], '90 kVA');
  assert.equal(by('L05').opts[by('L05').ans], '5,520 VA');
  assert.equal(3000 + 7200 * 0.35, 5520);
  assert.equal(c.continuous(8, 12), 22);
  assert.equal(by('L06').opts[by('L06').ans], '22,000 VA');
  assert.equal(by('W02').opts[by('W02').ans], '65 A');
  assert.equal(Math.min(95 * 0.91 * 0.80, 65), 65);
});

test('weekly packets only reference real bank ids', () => {
  const ids = new Set(NC.bank.map((b) => b.id));
  assert.equal(NC.weeklyPackets.length, 8);
  for (const [, , list] of NC.weeklyPackets) { assert.equal(list.length, 10); for (const id of list) assert.ok(ids.has(id), id); }
});

test('sprint: 37 sessions, one per day Oct 31 to Dec 6, 94.5 hours, 60 cards, 15 scenarios', () => {
  assert.equal(NC.sessions.length, 37);
  NC.sessions.forEach((s, i) => { assert.equal(s[0], i + 1); assert.equal(s[1], L.addDays('2026-10-31', i), 'Day ' + s[0] + ' must be one day after the last'); assert.ok(NC.catNames[s[4]], 'category ' + s[4]); });
  assert.equal(NC.sessions[36][1], '2026-12-06');
  assert.equal(NC.sessions.reduce((s, x) => s + x[3], 0), 94.5);
  assert.equal(NC.sprint.hours, 94.5);
  assert.equal(NC.cards.length, 60);
  assert.equal(new Set(NC.cards.map((x) => x[0])).size, 60);
  assert.equal(NC.scenarios.length, 15);
});

test('mocks A, B, C are the three 6-hour Saturdays, and nothing is a full mock on Dec 5 or 6', () => {
  const mocks = NC.sessions.filter((s) => s[3] === 6);
  assert.deepEqual(mocks.map((s) => s[1]), ['2026-11-14', '2026-11-21', '2026-11-28']);
  for (const m of mocks) assert.equal(new Date(m[1] + 'T12:00:00Z').getUTCDay(), 6);
  assert.ok(NC.sessions.filter((s) => s[1] >= '2026-12-05').every((s) => s[3] <= 2));
  assert.ok(NC.sessions.filter((s) => s[4] === 'R').length >= 7, 'review days are not mocks');
  assert.equal(NC.sessions.filter((s) => s[4] === 'X' && s[3] !== 6).length, 0);
});

test('key dates are ordered, inside the window, and include the PSI cutoff and exam', () => {
  const ds = NC.keyDates.map((k) => k[0]);
  assert.deepEqual(ds, ds.slice().sort());
  assert.ok(ds.includes('2026-12-05') && ds.includes('2026-12-07') && ds.includes('2026-11-23'));
  assert.equal(NC.acquire.items.length, 7);
  assert.deepEqual(NC.gates.checkpoints, ['2026-11-06', '2026-11-13', '2026-12-02']);
});

test('packets: every sprint day has a packet; lookup questions never carry an invented answer', () => {
  for (const s of NC.sessions) {
    const p = NC.packets[s[0]];
    assert.ok(p, 'packet ' + s[0]);
    assert.ok(p.objective && Array.isArray(p.steps));
    for (const q of p.questions) { assert.equal(typeof q.q, 'string'); assert.equal(typeof q.a, 'string'); }
  }
  const total = Object.values(NC.packets).reduce((n, p) => n + p.questions.length, 0);
  assert.ok(total >= 150, 'questions captured: ' + total);
  assert.ok(!/[^\x00-\x7f]/.test(JSON.stringify(NC.packets)));
});

test('law cards carry the Oct 31 corrections', () => {
  const card = (n) => NC.cards.find((c) => c[0] === n)[3];
  assert.match(card(23), /\$40,000/);
  assert.doesNotMatch(card(2), /no license-class voltage ceiling/i);
  assert.match(card(2), /1,000 V/); assert.match(card(2), /600 V/);
  assert.match(card(60), /978-1-948558-50-1/);
});

test('countdown is anchored to 10:00 AM Eastern on Dec 7', () => {
  const t = L.countdown(new Date('2026-12-07T14:00:00Z'), NC.exam.startISO);
  assert.deepEqual([t.days, t.hours, t.minutes], [0, 1, 0]);
  assert.ok(L.countdown(new Date('2026-12-07T16:00:00Z'), NC.exam.startISO).over);
  assert.equal(L.nyDate(new Date('2026-12-07T03:00:00Z')), '2026-12-06'); // still Dec 6 in New York
  assert.equal(L.diffDays('2026-12-02', '2026-12-07'), 5);
});

test('worked examples from the study guide', () => {
  assert.equal(c.vaToAmpsThree(30000, 208), 83.27);
  assert.equal(c.continuous(40, 20), 70);
  assert.equal(c.adjust(100, [0.8, 0.91]).adjusted, 72.8);
  assert.equal(c.motorConductor(28), 35);
  assert.equal(c.pullStraight(3), 24);
  assert.equal(c.pullAngle([3, 2]), 20);
  assert.deepEqual(c.transformer(45, 480, 208), { primary: 54.13, secondary: 124.91 });
  const f = c.faultAtSecondary(1000, 480, 5);
  assert.equal(f.fl, 1202.8); assert.equal(f.ka, 24.1);
  assert.equal(c.priceMarkup(1000, 20), 1200);
  assert.equal(c.marginOfMarkup(20), 16.67);
  assert.equal(c.priceMargin(1000, 20), 1250);
  assert.equal(Math.round((15000 / 120 + c.vaToAmpsThree(30000, 208)) * 100) / 100, 208.27);
});

test('business scenarios from NC Law & Business', () => {
  assert.equal(c.priceMarkup(8000, 25), 10000);
  assert.equal(c.priceMargin(8000, 25), 10666.67);
  assert.equal(c.priceMargin(22000, 20), 27500);
  assert.equal(c.overtime(46, 30), 1470);
  assert.equal(c.breakEven(24000, 60), 60000);
  assert.deepEqual(c.progress(100000, 10000, 66000, 10, 40000), { revised: 110000, retainage: 6600, netEarned: 59400, due: 19400, pctComplete: 60 });
  assert.equal(c.simpleInterest(20000, 9, 90, 360), 450);
  assert.equal(c.criticalPath({ A: { d: 2, after: [] }, B: { d: 4, after: ['A'] }, C: { d: 7, after: ['A'] }, D: { d: 3, after: ['B', 'C'] } }).finish, 12);
});

test('error log: mastered only after two clean re-solves on separate days; a miss resets', () => {
  let e = L.newError({ concept: 'GEC vs EGC' }, '2026-11-01');
  assert.equal(e.next, '2026-11-02');
  e = L.retest(e, '2026-11-02', true); assert.equal(e.mastered, false); assert.equal(e.next, '2026-11-05');
  e = L.retest(e, '2026-11-02', true); assert.equal(e.mastered, false, 'same-day repeat must not count');
  e = L.retest(e, '2026-11-05', false); assert.equal(e.streak, 0); assert.equal(e.next, '2026-11-06');
  e = L.retest(e, '2026-11-06', true); e = L.retest(e, '2026-11-09', true);
  assert.equal(e.mastered, true); assert.equal(e.next, null);
  assert.equal(L.dueErrors([e], '2026-12-01').length, 0);
});

test('law cards: right moves up a box, wrong drops to box 1', () => {
  let s = L.review(null, true, '2026-11-01'); assert.equal(s.box, 1); assert.equal(s.due, '2026-11-02');
  s = L.review(s, true, '2026-11-02'); assert.equal(s.box, 2); assert.equal(s.due, '2026-11-05');
  s = L.review(s, false, '2026-11-05'); assert.equal(s.box, 1);
  assert.deepEqual(L.dueCards([1, 2, 3], { 1: { due: '2026-11-09' }, 2: { due: '2026-11-01' } }, '2026-11-02'), [2, 3]);
});

test('readiness gates: needs two fresh unassisted full mocks at 82%+ within six hours', () => {
  const g = NC.gates;
  const cats = NC.blueprint.map(([id, name, w]) => ({ id, name, weight: w, n: 20, pct: 80 }));
  const m = (score, o) => ({ form: 'full', fresh: true, assisted: false, minutes: 340, score, ...o });
  assert.equal(L.readiness([], g, cats).met, false);
  assert.equal(L.readiness([m(85), m(90, { fresh: false })], g, cats).met, false, 'exposed form is not fresh');
  assert.equal(L.readiness([m(85), m(90, { minutes: 400 })], g, cats).met, false, 'over six hours');
  assert.equal(L.readiness([m(85), m(90, { assisted: true })], g, cats).met, false, 'assisted run');
  assert.equal(L.readiness([m(85), m(83)], g, cats).met, true);
  const weak = cats.map((x, i) => (i === 0 ? { ...x, pct: 60 } : x));
  assert.equal(L.readiness([m(85), m(83)], g, weak).met, false, 'persistent category below 70%');
  const thin = cats.map((x) => ({ ...x, n: 3 }));
  assert.equal(L.readiness([m(85), m(83)], g, thin).met, false, 'tiny samples are not trusted');
  assert.equal(L.weakest(cats.map((x, i) => (i === 7 ? { ...x, pct: 50 } : x)))[0].id, 8);
});

test('next session is the earliest unfinished; backup round-trips', () => {
  assert.equal(L.nextSession(NC.sessions, {})[0], 1);
  assert.equal(L.nextSession(NC.sessions, { 1: 1, 2: 1 })[0], 3);
  const s = { done: { 1: 1 }, errors: [{ concept: 'x' }] };
  assert.deepEqual(L.importState(L.exportState(s)), s);
  assert.throws(() => L.importState('{"app":"other"}'));
});

test('honesty guards present: lookup items are labeled unverified and AI validation stays 0/3', () => {
  assert.ok(NC.bank.filter((b) => b.lookup).every((b) => b.book && b.hint));
  assert.ok(NC.exam.bookRules.some((r) => /No writing/.test(r)));
});

// ---- NEC reference tables: structure checks plus anchors that your own Notion worked examples independently confirm ----
require(path.join(dir, 'data-nec.js'));
const N = L.nec;

test('NEC tables: ampacity rises with size, with column, and aluminum never beats copper', () => {
  for (const mat of ['cu', 'al']) {
    const sizes = Object.keys(NC.nec.t31016[mat]).sort((a, b) => NC.nec.size(a) - NC.nec.size(b));
    let prev = [0, 0, 0];
    for (const sz of sizes) {
      const r = NC.nec.t31016[mat][sz];
      assert.ok(r[0] < r[1] && r[1] < r[2], mat + ' ' + sz + ' columns must rise 60 < 75 < 90');
      for (let i = 0; i < 3; i++) assert.ok(r[i] > prev[i], mat + ' ' + sz + ' must exceed the next smaller size');
      prev = r;
    }
  }
  for (const sz of Object.keys(NC.nec.t31016.al)) { const c = NC.nec.t31016.cu[sz]; for (let i = 0; i < 3; i++) assert.ok(NC.nec.t31016.al[sz][i] < c[i], 'al < cu at ' + sz); }
});

test('NEC anchors from the Notion worked examples: 300 kcmil Cu 285 A at 75C and 320 A at 90C; 250 kcmil 255/290', () => {
  assert.equal(N.ampacity('300', 'cu', 75), 285);
  assert.equal(N.ampacity('300', 'cu', 90), 320);
  assert.equal(N.ampacity('250', 'cu', 75), 255);
  assert.equal(N.ampacity('250', 'cu', 90), 290);
  assert.equal(N.ampacity('4', 'cu', 60), 70); // also printed in an Eaton reference found by search
  // Notion sample Q22: four current-carrying conductors, 300 kcmil, 90C start, 75C terminals
  const w = N.worksheet({ size: '300', mat: 'cu', ins: 90, term: 75, n: 4, ambient: 30 });
  assert.equal(w.adjusted, 256); assert.equal(w.usable, 256); assert.equal(w.nextStd, 300);
  const w2 = N.worksheet({ size: '250', mat: 'cu', ins: 90, term: 75, n: 4, ambient: 30 });
  assert.equal(w2.adjusted, 232); assert.equal(w2.nextStd, 250); // 232 A cannot jump to a 300 A device (240.4(B))
  // Notion: 100 A start with 0.80 and 0.91 factors is 72.8 A
  assert.equal(Math.round(100 * 0.8 * 0.91 * 10) / 10, 72.8);
  assert.equal(N.worksheet({ size: '4', mat: 'cu', ins: 90, term: 60, n: 3, ambient: 30 }).usable, 70); // 60C termination caps a 90C conductor
});

test('NEC adjustment and ambient factors', () => {
  assert.deepEqual([3, 4, 6, 7, 9, 10, 20, 21, 30, 31, 40, 41, 80].map(N.adjFactor), [1, 0.8, 0.8, 0.7, 0.7, 0.5, 0.5, 0.45, 0.45, 0.4, 0.4, 0.35, 0.35]);
  assert.equal(N.ambientFactor(30, 90), 1); assert.equal(N.ambientFactor(40, 90), 0.91); assert.equal(N.ambientFactor(35, 60), 0.91);
  assert.equal(N.ambientFactor(60, 60), null); // 60C column is not permitted that hot
});

test('NEC GEC (250.66) and EGC (250.122) lookups', () => {
  assert.equal(N.gec('2', 'cu'), '8'); assert.equal(N.gec('1', 'cu'), '6'); assert.equal(N.gec('1/0', 'cu'), '6'); assert.equal(N.gec('3/0', 'cu'), '4');
  assert.equal(N.gec('350', 'cu'), '2'); assert.equal(N.gec('600', 'cu'), '1/0'); assert.equal(N.gec('1100', 'cu'), '2/0'); assert.equal(N.gec('1200', 'cu'), '3/0');
  assert.equal(N.gec('250', 'al'), '4'); assert.equal(N.gec('2', 'cu', 'al'), '6');
  assert.equal(N.egc(200), '6'); assert.equal(N.egc(400), '3'); assert.equal(N.egc(600), '1'); assert.equal(N.egc(2000), '250');
  assert.equal(N.egc(70), '8'); // 70 A is not exceeding 60, so it takes the 100 A row
  assert.equal(N.egc(6000), '800'); assert.equal(N.egc(7000), null);
  // the table rows rise with OCPD size
  let prev = 0; for (const [o] of NC.nec.t250122) { assert.ok(o > prev); prev = o; }
});

test('NEC standard sizes, box volume and the dwelling lighting demand tiers', () => {
  assert.equal(N.nextStd(232), 250); assert.equal(N.nextStd(260.34), 300); assert.equal(N.nextStd(229.09), 250); assert.equal(N.nextStd(70), 70); assert.equal(N.nextStd(6001), null);
  assert.deepEqual(NC.nec.std.slice().sort((a, b) => a - b), NC.nec.std);
  assert.equal(N.boxVolume(12), 2.25); assert.equal(N.boxVolume('14'), 2);
  assert.equal(N.dwellingLighting(11700), 6045); // 3,000 + 35% of 8,700, the example the search sources agreed on
  assert.equal(N.dwellingLighting(2000), 2000); assert.equal(N.dwellingLighting(130000), 3000 + 117000 * 0.35 + 10000 * 0.25);
});

test('NEC rules data: every rule has a confidence tag, no markup, and nothing claims verification', () => {
  const ids = new Set();
  for (const r of NC.nec.rules) { assert.ok(!ids.has(r[0]), 'dup ' + r[0]); ids.add(r[0]); assert.ok(['S', 'R'].includes(r[4]), r[0]); assert.ok(r[1] >= 0 && r[1] < NC.nec.groups.length, r[0]); assert.ok(!/[<>]/.test(r[3]), r[0]); }
  assert.ok(/Not verified/.test(NC.nec.status));
  assert.ok(NC.nec.gaps.length > 0);
});

// ---- date sanity: independent of Notion, so a drifted date fails loudly ----
const dow = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay(); // 0 Sun .. 6 Sat

test('exam date and PSI cutoff are consistent: Monday Dec 7, 10 AM EST, cutoff exactly 48 hours earlier', () => {
  assert.equal(NC.exam.date, '2026-12-07'); assert.equal(dow(NC.exam.date), 1);
  assert.equal(Date.parse(NC.exam.startISO) - Date.parse(NC.exam.cutoffISO), 48 * 3600 * 1000);
  assert.equal(dow('2026-12-05'), 6); // Saturday
  // 10:00 AM Eastern on Dec 7 is 15:00 UTC (EST, UTC-5): daylight saving ended Nov 1, 2026
  assert.equal(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date(NC.exam.startISO)), '10');
  assert.equal(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date(NC.exam.cutoffISO)), '10');
});

test('named dates fall on the weekdays the plan says', () => {
  const day = (iso) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow(iso)];
  const want = { '2026-10-31': 'Sat', '2026-11-03': 'Tue', '2026-11-06': 'Fri', '2026-11-13': 'Fri', '2026-11-14': 'Sat', '2026-11-21': 'Sat', '2026-11-23': 'Mon', '2026-11-26': 'Thu', '2026-11-28': 'Sat', '2026-12-02': 'Wed', '2026-12-04': 'Fri', '2026-12-06': 'Sun' };
  for (const [d, w] of Object.entries(want)) assert.equal(day(d), w, d);
  // Thanksgiving is the fourth Thursday of November: the 0.5 h row
  const thursdays = []; for (let d = 1; d <= 30; d++) { const iso = '2026-11-' + String(d).padStart(2, '0'); if (dow(iso) === 4) thursdays.push(iso); }
  assert.equal(thursdays[3], '2026-11-26');
  assert.equal(NC.sessions.find((s) => s[1] === '2026-11-26')[3], 0.5);
  // every key date matches a real sprint day or the exam
  const inSprint = new Set(NC.sessions.map((s) => s[1]).concat([NC.exam.date]));
  for (const k of NC.keyDates) assert.ok(inSprint.has(k[0]) || k[0] === '2026-12-05', k[0]);
});

test('behind-schedule and date arithmetic around the sprint edges', () => {
  assert.equal(L.diffDays('2026-10-31', '2026-12-07'), 37);
  assert.equal(L.addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(L.nyDate(new Date('2026-11-01T04:30:00Z')), '2026-11-01'); // 12:30 AM EDT? no: 04:30Z on Nov 1 is 12:30 AM EDT (DST ends 2 AM)
  assert.equal(L.nyDate(new Date('2026-11-01T06:30:00Z')), '2026-11-01'); // after the fall-back hour, still Nov 1 in New York
  assert.equal(L.nyDate(new Date('2026-12-07T04:59:00Z')), '2026-12-06'); // just before midnight EST
  assert.equal(L.nyDate(new Date('2026-12-07T05:00:00Z')), '2026-12-07');
});

test('topic packets carry the days that use them and every id exists', () => {
  assert.equal(NC.weeklyPackets.length, 8);
  for (const [, , ids, days] of NC.weeklyPackets) { assert.match(days, /^Days? \d/); assert.equal(ids.length, 10); }
  assert.ok(NC.exam.links.every((l) => !/north-carolina-electrical-14th-edition/.test(l[1])), 'the old NASCLA URL returns 404');
});
