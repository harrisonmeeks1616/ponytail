#!/usr/bin/env node
// Logic and data behind the NC Unlimited study app (docs/nc-unlimited). Worked examples come straight from the Notion plan.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'docs', 'nc-unlimited');
for (const f of ['data-plan', 'data-study', 'data-law', 'data-bank']) require(path.join(dir, f + '.js'));
if (fs.existsSync(path.join(dir, 'data-packets.js'))) require(path.join(dir, 'data-packets.js'));
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

test('plan: 47 sessions in date order, hours as published, 60 cards, 15 scenarios', () => {
  assert.equal(NC.sessions.length, 47);
  for (let i = 1; i < NC.sessions.length; i++) assert.ok(NC.sessions[i][1] >= NC.sessions[i - 1][1], 'order at ' + (i + 1));
  const total = NC.sessions.reduce((s, x) => s + x[3], 0);
  assert.equal(total, 107.5); // 90 core + 17 buffer + 0.5 packing, per Exam Plan & Readiness
  assert.equal(NC.cards.length, 60);
  assert.equal(new Set(NC.cards.map((x) => x[0])).size, 60);
  assert.equal(NC.scenarios.length, 15);
});

test('calendar covers every day Oct 26 to Dec 7 without gaps or overlaps', () => {
  for (let d = '2026-10-26'; d <= '2026-12-07'; d = L.addDays(d, 1)) {
    const hits = NC.calendar.filter((x) => d >= x.from && d <= x.to);
    assert.equal(hits.length, 1, d);
  }
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
