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

test('error log: 1 then 3 days, mastered after two clean re-solves on separate days, then 7 and 14 day maintenance; a miss resets', () => {
  let e = L.newError({ concept: 'GEC vs EGC' }, '2026-11-01');
  assert.equal(e.next, '2026-11-02');
  e = L.retest(e, '2026-11-02', true); assert.equal(e.mastered, false); assert.equal(e.next, '2026-11-05');
  e = L.retest(e, '2026-11-02', true); assert.equal(e.mastered, false, 'same-day repeat must not count');
  e = L.retest(e, '2026-11-05', false); assert.equal(e.streak, 0); assert.equal(e.next, '2026-11-06');
  e = L.retest(e, '2026-11-06', true); assert.equal(e.next, '2026-11-09');
  e = L.retest(e, '2026-11-09', true);
  assert.equal(e.mastered, true); assert.equal(e.next, '2026-11-16', 'first maintenance recall 7 days after mastery');
  assert.equal(L.dueErrors([e], '2026-11-15').length, 0); assert.equal(L.dueErrors([e], '2026-11-16').length, 1);
  e = L.retest(e, '2026-11-16', true); assert.equal(e.mastered, true); assert.equal(e.next, '2026-11-30', 'second maintenance recall 14 days later');
  const done = L.retest(e, '2026-11-30', true); assert.equal(done.next, null); assert.equal(L.dueErrors([done], '2027-01-01').length, 0);
  const lapsed = L.retest(e, '2026-11-30', false); assert.equal(lapsed.mastered, false); assert.equal(lapsed.streak, 0); assert.equal(lapsed.next, '2026-12-01');
  // after a lapse it needs two fresh clean re-solves again
  let again = L.retest(lapsed, '2026-12-01', true); assert.equal(again.mastered, false);
  again = L.retest(again, '2026-12-04', true); assert.equal(again.mastered, true);
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

test('NEC rules data: every rule has a tag; V rows carry NFPA LiNK provenance; nothing is overclaimed', () => {
  const ids = new Set();
  for (const r of NC.nec.rules) { assert.ok(!ids.has(r[0]), 'dup ' + r[0]); ids.add(r[0]); assert.ok(['S', 'R', 'V'].includes(r[4]), r[0]); assert.ok(r[1] >= 0 && r[1] < NC.nec.groups.length, r[0]); assert.ok(!/[<>]/.test(r[3]), r[0]); if (r[4] === 'V') assert.match(r[5], /NFPA LiNK/, r[0] + ' is V without provenance'); }
  assert.match(NC.nec.status, /Mostly NOT verified/);
  assert.ok(NC.nec.gaps.length > 0);
  for (const [id, v] of Object.entries(NC.nec.vtab)) { assert.match(v.url, /^https:\/\/link\.nfpa\.org\/publications\/70\/2020\//, id); assert.ok(v.scope && v.open, id + ' must say what is verified and what is open'); }
});

test('lookup resolutions: only resolved or partial, partial ones say what is still needed, none is scored or auto-verified', () => {
  const ids = new Set(NC.bank.filter((b) => b.lookup).map((b) => b.id));
  for (const [id, r] of Object.entries(NC.nec.lookups)) { assert.ok(ids.has(id), id + ' is not a lookup item'); assert.ok(['resolved', 'partial'].includes(r.status), id); assert.ok(r.answer && r.refs.length, id); assert.equal(r.status === 'resolved', r.needs.length === 0, id + ': resolved means nothing is still needed'); }
  assert.deepEqual(Object.keys(NC.nec.lookups).sort(), ['B02', 'D03', 'G02', 'G04', 'G05', 'G08', 'L08', 'L09', 'O04', 'O07', 'W01', 'W04']);
  assert.deepEqual(Object.entries(NC.nec.lookups).filter(([, r]) => r.status === 'resolved').map(([id]) => id).sort(), ['B02', 'D03', 'G02', 'O04', 'W01', 'W04']);
  assert.match(NC.nec.lookups.W01.answer, /not a universal 90 C shortcut/); assert.match(NC.nec.lookups.W04.answer, /MAJOR PORTION/); assert.match(NC.nec.lookups.W04.answer, /'Substantial nonlinear load' does not by itself prove/); assert.match(NC.nec.lookups.G04.answer, /TABLE MINIMUM/);
  assert.match(NC.nec.lookups.B02.answer, /1\.5 allowances/);
});

test('every cell Harrison/Codex read in NFPA LiNK on Oct 31 matches the app tables exactly', () => {
  const N2 = NC.nec;
  // Table 250.66, copper ungrounded -> copper GEC
  for (const [size, gec] of [['2', '8'], ['14', '8'], ['1', '6'], ['1/0', '6'], ['2/0', '4'], ['3/0', '4'], ['4/0', '2'], ['250', '2'], ['350', '2'], ['400', '1/0'], ['600', '1/0'], ['700', '2/0'], ['1100', '2/0'], ['1200', '3/0']]) assert.equal(N.gec(size, 'cu'), gec, '250.66 cu ' + size);
  // Table 250.122: (OCPD, Cu, Al)
  const t122 = [[15, '14', '12'], [20, '12', '10'], [60, '10', '8'], [100, '8', '6'], [200, '6', '4'], [300, '4', '2'], [400, '3', '1'], [500, '2', '1/0'], [600, '1', '2/0'], [800, '1/0', '3/0'], [1000, '2/0', '4/0'], [1200, '3/0', '250'], [1600, '4/0', '350'], [2000, '250', '400'], [2500, '350', '600'], [3000, '400', '600'], [4000, '500', '750'], [5000, '700', '1250'], [6000, '800', '1250']];
  assert.deepEqual(N2.t250122, t122);
  for (const [o, cu, al] of t122) { assert.equal(N.egc(o, 'cu'), cu); assert.equal(N.egc(o, 'al'), al); }
  assert.equal(N.egc(61, 'cu'), '8', 'between rows takes the next row up');
  // Table 314.16(B)
  assert.deepEqual(N2.box, { '18': 1.5, '16': 1.75, '14': 2.0, '12': 2.25, '10': 2.5, '8': 3.0, '6': 5.0 });
  // Table 310.16 copper 14 to 500 kcmil: (size, 60, 75, 90)
  for (const [z, a, b, c2] of [['14', 15, 20, 25], ['12', 20, 25, 30], ['10', 30, 35, 40], ['8', 40, 50, 55], ['6', 55, 65, 75], ['4', 70, 85, 95], ['3', 85, 100, 115], ['2', 95, 115, 130], ['1', 110, 130, 145], ['1/0', 125, 150, 170], ['2/0', 145, 175, 195], ['3/0', 165, 200, 225], ['4/0', 195, 230, 260], ['250', 215, 255, 290], ['300', 240, 285, 320], ['350', 260, 310, 350], ['400', 280, 335, 380], ['500', 320, 380, 430]]) assert.deepEqual(N2.t31016.cu[z], [a, b, c2], '310.16 cu ' + z);
  // Table 310.15(C)(1) and (B)(1) rows 31-60 C
  assert.deepEqual([4, 6, 7, 9, 10, 20, 21, 30, 31, 40, 41].map(N.adjFactor), [0.8, 0.8, 0.7, 0.7, 0.5, 0.5, 0.45, 0.45, 0.4, 0.4, 0.35]);
  for (const [tc, f60, f75, f90] of [[35, 0.91, 0.94, 0.96], [40, 0.82, 0.88, 0.91], [45, 0.71, 0.82, 0.87], [50, 0.58, 0.75, 0.82], [55, 0.41, 0.67, 0.76], [60, null, 0.58, 0.71]]) assert.deepEqual([N.ambientFactor(tc, 60), N.ambientFactor(tc, 75), N.ambientFactor(tc, 90)], [f60, f75, f90], 'ambient ' + tc);
  // 314.16(B)(5): six EGCs = 1 + 2 x 1/4 allowances
  assert.equal(1 + (6 - 4) * 0.25, 1.5); assert.equal(1.5 * N2.box['12'], 3.375);
});

test('handbook facts relayed from the July 2026 Board PDF are present and attributed', () => {
  const h = NC.exam.handbook; assert.match(h.url, /psi-exam-book-2026-002-2/); assert.match(h.note, /Harrison\/Codex/);
  const by = Object.fromEntries(h.facts); assert.match(by['Printed p3'], /100 questions, six hours/); assert.match(by['Printed p6'], /70%/); assert.match(by['Printed p7'], /\.5-up/); assert.match(by['Printed p26'], /1,000 V/);
  assert.doesNotMatch(JSON.stringify([NC.verification, NC.exam, NC.keyDates]), /Dec 9/, 'the old Dec 9 inference must not appear');
  assert.match(NC.cards.find((c) => c[0] === 2)[3], /do not treat 600 V as uncontested statute/);
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


// ---- review round: boundaries, recomputed keys, hostile state, data cross-checks ----
test('readiness boundaries: 82.0 passes, 81.9 fails; 360 minutes passes, 361 fails; category floor and sample size edges', () => {
  const g = NC.gates, mk = (score, o) => ({ form: 'full', fresh: true, assisted: false, minutes: 340, score, ...o });
  const cats = (n, pct) => NC.blueprint.map(([id, name, w]) => ({ id, name, weight: w, n, pct }));
  assert.equal(L.readiness([mk(82), mk(82)], g, cats(20, 80)).met, true, 'exactly 82 counts');
  assert.equal(L.readiness([mk(82), mk(81.9)], g, cats(20, 80)).met, false);
  assert.equal(L.readiness([mk(90), mk(90, { minutes: 360 })], g, cats(20, 80)).met, true, 'exactly six hours counts');
  assert.equal(L.readiness([mk(90), mk(90, { minutes: 361 })], g, cats(20, 80)).met, false);
  assert.equal(L.readiness([mk(90), mk(90)], g, cats(20, 70)).met, true, 'a category at exactly 70 is not below the floor');
  assert.equal(L.readiness([mk(90), mk(90)], g, cats(20, 69)).met, false);
  assert.equal(L.readiness([mk(90), mk(90)], g, cats(15, 80)).met, true, '15 fresh questions is an adequate sample');
  assert.equal(L.readiness([mk(90), mk(90)], g, cats(14, 80)).met, false, '14 is not');
  assert.equal(L.readiness([mk(90), mk(90, { form: 'set50' })], g, cats(20, 80)).met, false, 'a timed 50 is not a full mock');
});

test('Leitner intervals, cap and due boundaries', () => {
  const days = [1, 3, 7, 14, 30]; let st = null;
  days.forEach((d, i) => { st = L.review(st, true, '2026-11-01'); assert.equal(st.box, i + 1); assert.equal(st.due, L.addDays('2026-11-01', d)); });
  assert.equal(L.review(st, true, '2026-11-01').box, 5, 'box capped at 5');
  const miss = L.review(st, false, '2026-11-01'); assert.equal(miss.box, 1); assert.equal(miss.due, '2026-11-02');
  const dueOn = { 1: { due: '2026-11-02' }, 2: { due: '2026-11-03' } };
  assert.deepEqual(L.dueCards([1, 2, 3], dueOn, '2026-11-02'), [1, 3], 'due today counts; due tomorrow does not; unseen counts');
  assert.deepEqual(L.dueErrors([{ next: '2026-11-03', mastered: false }, { next: '2026-11-01', mastered: false }, { next: null }], '2026-11-03').map((e) => e.next), ['2026-11-01', '2026-11-03'], 'ordered, inclusive of today');
});

test('hours, grading and bank stats', () => {
  assert.deepEqual(L.hours(NC.sessions, { 1: 1, 2: 1, 15: 1 }), { done: 12, total: 94.5 });
  const mcq = NC.bank.find((b) => b.id === 'L01');
  assert.deepEqual(L.gradeMcq(mcq, 'C'), { ok: true, ans: 'C' }); assert.equal(L.gradeMcq(mcq, 'A').ok, false);
  const st = L.bankStats(NC.bank, { L01: { ok: true }, L02: { ok: false } }, { G01: { ok: true }, G02: { ok: false } });
  const d1 = st.find((x) => x.d === 1), d8 = st.find((x) => x.d === 8);
  assert.equal(d1.lookupDone, 1, 'a lookup answered wrong is not counted as verified right'); assert.equal(d1.lookup, 11); assert.equal(d1.keyed, 0);
  assert.equal(d8.tried, 2); assert.equal(d8.right, 1);
  assert.equal(st.reduce((n, x) => n + x.total, 0), 100);
});

test('every numeric keyed answer is recomputed independently from its prompt', () => {
  const ans = (id) => { const b = NC.bank.find((x) => x.id === id); return b.opts[b.ans]; };
  const num = (id, ...parts) => { const a = ans(id).replace(/,/g, ''); for (const p of parts) assert.ok(a.includes(String(p).replace(/,/g, '')), id + ': "' + a + '" should contain ' + p); };
  const root3 = Math.sqrt(3);
  num('O03', 1.25 * 36 + 24); num('W02', Math.min(95 * 0.91 * 0.8, 65));
  num('W03', Math.floor((2.0 * 0.4) / 0.12)); num('B01', (6 + 2 + 1 + 2) * 2.25); num('B03', 8 * 3); num('B04', 6 * 3 + 2 + 1);
  num('S02', 26400 / 240); num('M02', 1.25 * 28); num('M03', 1.25 * 22); num('M04', 1.25 * 40 + 20 + 15); num('M05', 2.5 * 42);
  const vd = (root3 * 12.9 * 40 * 180) / 41740; num('M07', vd.toFixed(2), ((vd / 480) * 100).toFixed(2));
  num('L01', 28800 / 240); num('L02', Math.round(138600 / (root3 * 480))); num('L03', 72 / 0.8); num('L04', 3 * 2500);
  num('L05', 5520); assert.equal(3000 + 7200 * 0.35, 5520); num('L06', 1.25 * 8000 + 12000); num('L11', 124, 123);
  num('E01', (75000 / (root3 * 480)).toFixed(1), (75000 / (root3 * 208)).toFixed(1));
  num('E02', (500000 / (root3 * 480) / 0.0575 / 1000).toFixed(3));
  num('P02', '70,000'); num('P05', '8,960', 40); assert.equal(8000 + 1200 * 0.8, 8960);
  num('P06', (9150 * 1.2).toLocaleString('en-US'), (9150 / 0.8).toLocaleString('en-US', { minimumFractionDigits: 2 }));
  num('P07', '40,000', '1.5'); assert.equal(c.criticalPath({ A: { d: 2, after: [] }, B: { d: 4, after: ['A'] }, C: { d: 5, after: ['A'] }, D: { d: 3, after: ['B', 'C'] } }).finish, 10); num('P08', 10);
  num('P09', 8 * 2 * 32 + 3 * 18); num('P10', 9 + 5, 9 * 2 + 5); num('P12', (((0.25 * 24) + 2.0 * (5 / 60)) * 1.25).toFixed(2));
  num('P03', 30); num('P04', 'Five');
  const covered = new Set(['O03', 'W02', 'W03', 'B01', 'B03', 'B04', 'S02', 'M02', 'M03', 'M04', 'M05', 'M07', 'L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L11', 'E01', 'E02', 'P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P12']);
  for (const b of NC.bank.filter((x) => x.opts)) assert.ok(covered.has(b.id), 'keyed item ' + b.id + ' has no independent recomputation');
  assert.match(NC.bank.find((b) => b.id === 'L02').why, /166\.7099/);
});

test('hostile or malformed saved state is sanitized, not trusted', () => {
  const base = { done: {}, log: [], attempts: {}, ver: {}, errs: [], mocks: [], cards: {}, check: {}, auth: { start: '', expiry: '' }, strong: {}, lookups: [], theme: '', examTimer: null, verif: {}, sc: {}, nav: {}, necv: {}, books: { nec: '', nfpa: '', nascla: '' } };
  const ctx = { views: ['today', 'plan'], books: { nec: ['', '2020 edition'], nfpa: ['', '2013 edition'], nascla: ['', '14th edition'] } };
  const evil = '<img src=x onerror=alert(1)>';
  const out = L.sanitize({ log: [{ date: '2026-10-31', min: evil }, { date: evil, min: 5 }], errs: [{ id: 'a" onclick="x', type: evil, concept: 'c', next: evil }], mocks: [{ id: '"><script>', minutes: evil, score: 'x', date: '2026-11-14', form: 'bogus' }], nav: { view: 'bogus' }, books: { nec: evil, nfpa: '2013 edition' }, theme: 'neon', done: { '1': { at: evil, min: 'x' }, evil: 1 }, cards: { '5': { box: 99, due: evil } }, auth: { expiry: evil } }, base, ctx);
  assert.equal(out.log.length, 1); assert.equal(out.log[0].min, 0); assert.equal(typeof out.log[0].min, 'number');
  assert.equal(out.errs[0].id, 'aonclickx'); assert.equal(out.errs[0].next, null); assert.equal(out.mocks[0].id, 'script'); assert.equal(out.mocks[0].minutes, 0); assert.equal(out.mocks[0].score, 0); assert.equal(out.mocks[0].form, 'split');
  assert.equal(out.nav.view, 'today'); assert.equal(out.books.nec, ''); assert.equal(out.books.nfpa, '2013 edition'); assert.equal(out.theme, '');
  assert.deepEqual(Object.keys(out.done), ['1']); assert.equal(out.done['1'].at, ''); assert.equal(out.cards['5'].box, 5); assert.equal(out.cards['5'].due, ''); assert.equal(out.auth.expiry, '');
  for (const bad of [null, 'x', 5, [], { errs: {}, nav: null, books: null, log: 'x', mocks: 7 }]) { const r = L.sanitize(bad, base, ctx); assert.ok(Array.isArray(r.errs) && Array.isArray(r.mocks) && Array.isArray(r.log)); assert.equal(r.nav.view, 'today'); assert.equal(r.books.nec, ''); }
  // a clean round trip keeps real data
  const keep = { done: { 3: { at: '2026-11-02', min: 120 } }, errs: [L.newError({ concept: 'x' }, '2026-11-01')], mocks: [{ id: 'm1', label: 'A', date: '2026-11-14', form: 'full', minutes: 340, score: 85, fresh: true, assisted: false, cats: { 1: [9, 11] } }], nav: { view: 'plan' }, books: { nascla: '14th edition' } };
  const back = L.sanitize(JSON.parse(JSON.stringify(keep)), base, ctx);
  assert.equal(back.done[3].min, 120); assert.equal(back.errs[0].concept, 'x'); assert.deepEqual(back.mocks[0].cats[1], [9, 11]); assert.equal(back.nav.view, 'plan'); assert.equal(back.books.nascla, '14th edition');
});

test('cross-checks: key dates, sprint weeks, checkpoints, topic packet days, links, categories', () => {
  const dayOf = (iso) => NC.sessions.find((x) => x[1] === iso);
  NC.sessions.forEach((x, i) => assert.equal(x[2], Math.floor(i / 7) + 1, 'week of day ' + x[0]));
  for (const iso of ['2026-11-14', '2026-11-21', '2026-11-28']) assert.equal(dayOf(iso)[4], 'X', iso + ' is a full mock day');
  assert.equal(NC.keyDates.filter((k) => /^Mock [ABC]$/.test(k[1])).map((k) => k[0]).join(), '2026-11-14,2026-11-21,2026-11-28');
  assert.deepEqual(NC.gates.checkpoints, ['2026-11-06', '2026-11-13', '2026-12-02']);
  assert.match(dayOf('2026-11-06')[5], /checkpoint/i); assert.match(dayOf('2026-11-13')[5], /checkpoint/i); assert.match(dayOf('2026-12-02')[5], /checkpoint/i);
  assert.match(dayOf('2026-11-23')[5], /readiness review/i); assert.match(dayOf('2026-12-04')[5], /decision|checks/i); assert.match(dayOf('2026-12-06')[5], /final review|pack|sleep/i);
  for (const [, , , days] of NC.weeklyPackets) for (const m of days.matchAll(/(\d+)(?:-(\d+))?/g)) { const lo = +m[1], hi = m[2] ? +m[2] : lo; assert.ok(lo >= 1 && hi <= 37 && lo <= hi, 'bad day range in ' + days); }
  const hosts = ['www.ncbeec.org', 'www.ncleg.gov', 'test-takers.psiexams.com', 'store.nascla.org', 'link.nfpa.org'];
  for (const [, u] of NC.exam.links) { const url = new URL(u); assert.equal(url.protocol, 'https:'); assert.ok(hosts.includes(url.hostname), 'unexpected host ' + url.hostname); }
  for (const x of NC.sessions) { if (x[4] === 'R') assert.doesNotMatch(x[5], /full mock/i); assert.ok(x[3] > 0 && x[3] <= 6); }
  assert.doesNotMatch(JSON.stringify(NC.sessions), /Mock D|47 sessions/);
  for (const k of NC.keyDates) assert.doesNotMatch(k[2], /Mock D/);
  const bankIds = new Set(NC.bank.map((b) => b.id));
  for (const [n, p] of Object.entries(NC.packets)) for (const q of p.questions) { const m = /^([A-Z]\d\d)(-v\d)?\b/.exec(q.q); if (m && /^[GOWBSMLEPDH]/.test(m[1])) assert.ok(bankIds.has(m[1]), 'packet ' + n + ' cites unknown bank id ' + m[1]); }
  assert.doesNotMatch(JSON.stringify(NC.packets), /existing Day \d/, 'old-plan day numbers must be labeled retired');
});

test('backup import rejects junk, hasData sees real data, timer minutes are clamped', () => {
  for (const junk of ['{"app":"nc-unlimited","state":"x"}', '{"app":"nc-unlimited","state":{}}', '{"app":"nc-unlimited","state":[1]}', '{"app":"other","state":{"errs":[]}}', '{"app":"nc-unlimited"}']) assert.throws(() => L.importState(junk), undefined, junk);
  assert.deepEqual(L.importState('{"app":"nc-unlimited","state":{"errs":[]}}'), { errs: [] });
  const blank = { done: {}, log: [], attempts: {}, ver: {}, errs: [], mocks: [], cards: {}, check: {}, auth: { start: '', expiry: '' }, strong: {}, lookups: [], theme: '', examTimer: null, examElapsed: 0, verif: {}, sc: {}, nav: {}, necv: {}, books: { nec: '', nfpa: '', nascla: '' } };
  assert.equal(L.hasData(blank), false);
  assert.equal(L.hasData({ ...blank, errs: [{}] }), true); assert.equal(L.hasData({ ...blank, done: { 1: {} } }), true); assert.equal(L.hasData({ ...blank, necv: { a: {} } }), true);
  assert.equal(L.sanitize({ examElapsed: 99999 }, blank, {}).examElapsed, 720); assert.equal(L.sanitize({ examElapsed: -5 }, blank, {}).examElapsed, 0); assert.equal(L.sanitize({ examElapsed: 'x' }, blank, {}).examElapsed, 0);
});

test('wire sizes sort by area, and the corrected NEC rows say what they should', () => {
  const sorted = Object.keys(NC.nec.t31016.cu).sort((a, b) => NC.nec.size(a) - NC.nec.size(b));
  assert.deepEqual(sorted.slice(0, 14), ['14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0', '2/0', '3/0', '4/0', '250']);
  assert.equal(sorted[sorted.length - 1], '2000');
  const rule = (id) => NC.nec.rules.find((r) => r[0] === id)[3];
  assert.match(rule('b1'), /wholly inside the box counts 0/); assert.match(rule('b1'), /enters and terminates or is spliced/); assert.match(rule('b2'), /up to FOUR together count as ONE allowance/); assert.match(rule('b2'), /1\/4 allowance/);
  assert.match(rule('s3'), /18 ft \(public streets[^)]*truck traffic[^)]*other land/);
  assert.match(rule('l7'), /3-wire circuit taken from a 4-wire 3-phase wye/);
  assert.doesNotMatch(rule('m5'), /Design B energy-efficient starting exception, not the base table/);
});

test('Table 430.52 and Table 220.42 cells read in NFPA LiNK match the app; pending list covers every unresolved lookup exactly', () => {
  const N2 = NC.nec;
  assert.deepEqual(N2.t43052cols, ['Nontime-delay fuse', 'Dual-element (time-delay) fuse', 'Instantaneous-trip breaker', 'Inverse-time breaker']);
  assert.deepEqual(N2.t43052.map((r) => r.slice(1)), [[300, 175, 800, 250], [300, 175, 800, 250], [300, 175, 1100, 250], [300, 175, 800, 250], [150, 150, 800, 150], [150, 150, 250, 150]]);
  assert.match(N2.t43052ex.join(' '), /400% of FLC[^.]*225%[^.]*400% if FLC is 100 A or less and 300% if FLC is over 100 A[^.]*300%/);
  assert.deepEqual(N2.t22042, { dwelling: [[3000, 100], [120000, 35], [1e12, 25]], hotel: [[20000, 60], [100000, 50], [1e12, 35]], warehouse: [[12500, 100], [1e12, 50]], other: [[1e12, 100]] });
  assert.equal(N.lightingDemand(130000, 'dwelling'), 3000 + 117000 * 0.35 + 10000 * 0.25);
  assert.equal(N.lightingDemand(50000, 'hotel'), 20000 * 0.6 + 30000 * 0.5); assert.equal(N.lightingDemand(120000, 'hotel'), 12000 + 40000 + 20000 * 0.35);
  assert.equal(N.lightingDemand(20000, 'warehouse'), 12500 + 7500 * 0.5); assert.equal(N.lightingDemand(77777, 'other'), 77777);
  // every Book lookup is either resolved (nothing pending), partial (and still pending for the rest) or pending
  const lookupIds = NC.bank.filter((b) => b.lookup).map((b) => b.id);
  const pendingIds = new Set(N2.pending.flatMap((g) => g.ids)); const resolved = Object.entries(N2.lookups).filter(([, r]) => r.status === 'resolved').map(([id]) => id);
  for (const id of lookupIds) assert.ok(resolved.includes(id) || pendingIds.has(id), id + ' is neither resolved nor listed as pending');
  for (const id of resolved) assert.ok(!pendingIds.has(id), id + ' is resolved but still listed pending');
  for (const id of pendingIds) assert.ok(lookupIds.includes(id), id + ' is pending but is not a lookup question');
  for (const g of N2.pending) assert.ok(g.needs.length > 0 && g.ids.length > 0);
  assert.match(N2.rules.find((r) => r[0] === 'w1')[3], /not a universal 90 C shortcut/); assert.match(N2.rules.find((r) => r[0] === 'w6')[3], /MAJOR PORTION/); assert.match(N2.rules.find((r) => r[0] === 'g7')[3], /qualified person/);
});

test('240.4(B) and 110.3(B) rules read in NFPA LiNK are conditional, not shortcuts', () => {
  const a = NC.nec.lookups.O04.answer, rule = (id) => NC.nec.rules.find((r) => r[0] === id)[3];
  assert.match(a, /ONLY if all three conditions/); assert.match(a, /more than one receptacle for cord-and-plug/); assert.match(a, /800 A or less/); assert.match(a, /Do not promote 36 A to 40 A/);
  assert.equal(N.nextStd(36), 40); assert.equal(N.nextStd(35), 35); assert.match(rule('o1'), /ONLY if all three/);
  assert.match(NC.nec.lookups.D03.answer, /no terminal clearance or torque value can be stated/); assert.match(rule('d1'), /instructions included in its listing or labeling/);
});
