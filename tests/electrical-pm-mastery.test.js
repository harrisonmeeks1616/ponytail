#!/usr/bin/env node
// Logic behind the Electrical PM Mastery app (docs/electrical-pm-mastery): the 365-day
// curriculum, spaced-repetition scheduling, and the field calculators PMs price and claim with.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'docs', 'electrical-pm-mastery');
const E = require(path.join(dir, 'plan.js'));
const c = E.calc;
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('curriculum expands to 365 consecutive, filled days', () => {
  const days = E.buildDays();
  assert.equal(E.WEEKS.length, 52);
  assert.equal(days.length, 365);
  days.forEach((d, i) => {
    assert.equal(d.n, i + 1);
    assert.ok(d.task.length > 40, `day ${d.n} task too short`);
    d.res.forEach(r => assert.ok(E.RESOURCES[r], `day ${d.n} unknown resource ${r}`));
  });
  E.WEEKS.forEach((w, i) => {
    assert.equal(w.days.length, 6, `week ${i + 1} needs 6 day tasks`);
    assert.equal(w.quiz.length, 2, `week ${i + 1} needs 2 quiz items`);
  });
  assert.equal(E.buildCards().length, 104);
  assert.equal(E.phaseOfWeek(4).name, 'Re-Entry');
  assert.equal(E.phaseOfWeek(52).name, 'Mastery');
});

test('shipped text has no em dashes (owner style rule)', () => {
  for (const f of ['plan.js', 'index.html', 'README.md']) {
    assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes('—'), `em dash in ${f}`);
  }
});

test('day numbers clamp and Leitner boxes space reviews', () => {
  assert.equal(E.dayNumber('2026-10-05', '2026-10-05'), 1);
  assert.equal(E.dayNumber('2026-10-05', '2026-10-11'), 7);
  assert.equal(E.dayNumber('2026-10-05', '2026-10-01'), 1);
  assert.equal(E.dayNumber('2026-10-05', '2028-01-01'), 365);
  assert.deepEqual(E.review({ box: 2 }, true, '2026-10-05'), { box: 3, due: '2026-10-09' });
  assert.deepEqual(E.review({ box: 4 }, false, '2026-10-05'), { box: 1, due: '2026-10-06' });
});

test('labor earned value, WIP, and change order pricing match the quiz answers', () => {
  const lab = c.labor({ budgetHrs: 1000, pct: 40, actualHrs: 520, rate: 100 });
  near(lab.pf, 0.769, 0.001); near(lab.eac, 1300); near(lab.variance, -300); near(lab.varianceCost, -30000);
  assert.equal(c.labor({ budgetHrs: 1000, pct: 0, actualHrs: 10 }).pf, null);

  const w = c.wip({ contract: 2e6, estCost: 1.7e6, costToDate: 850e3, billed: 1.1e6 });
  near(w.pct, 0.5); near(w.earned, 1e6); near(w.overUnder, 100e3); near(w.margin, 0.15);
  const loss = c.wip({ contract: 1e6, estCost: 1.1e6, costToDate: 1.2e6, billed: 9e5 });
  assert.equal(loss.pct, 1); assert.equal(loss.overrun, true); near(loss.loss, 1e5);

  near(c.changeOrder({ hours: 12, rate: 100, material: 800, taxPct: 8, markupPct: 15, bondPct: 1 }).total, 2397.34);
});

test('voltage drop, ampacity, and kVA math', () => {
  const vd = c.voltageDrop({ phase: 1, material: 'cu', size: '12', amps: 16, feet: 100, volts: 120 });
  near(vd.vd, 6.32); near(vd.pct, 5.27);
  // Sizes must stay in electrical order; Object.keys would put '14' and '250' before '1/0'.
  assert.equal(c.minSizeForDrop({ phase: 3, material: 'cu', amps: 200, feet: 300, volts: 480, maxPct: 2 }), '3/0');
  assert.equal(c.minSizeForDrop({ phase: 3, material: 'cu', amps: 20, feet: 50, volts: 480, maxPct: 3 }), '14');
  assert.equal(c.minSizeForAmps({ material: 'cu', amps: 160 }), '2/0');
  assert.equal(c.minSizeForAmps({ material: 'al', amps: 160 }), '4/0');
  assert.equal(c.minSizeForAmps({ material: 'cu', amps: 900 }), null);
  near(c.amps({ kva: 75, volts: 208, phase: 3 }), 208.2, 0.1);
  near(c.amps({ kva: 75, volts: 208, phase: '3' }), 208.2, 0.1); // form values arrive as strings
  near(c.amps({ kva: 1500, volts: 480, phase: 3 }), 1804.2, 0.1);
  near(c.kva({ amps: 208.2, volts: 208, phase: 3 }), 75, 0.05);
});

test('measured mile, crew size, submit-by, break-even, and their guards', () => {
  const mm = c.measuredMile({ baseQty: 2000, baseHrs: 400, impQty: 1500, impHrs: 450, rate: 95 });
  near(mm.expected, 300); near(mm.lost, 150); near(mm.pctLoss, 1 / 3); near(mm.cost, 14250);
  assert.equal(c.measuredMile({ baseQty: 2000, baseHrs: 0, impQty: 1500, impHrs: 450 }).lost, null);

  assert.equal(c.crew({ remainingHrs: 4000, weeks: 10, hrsPerWeek: 40 }).crewRounded, 10);
  assert.equal(c.crew({ remainingHrs: 4000, weeks: 10, hrsPerWeek: 40, productivityPct: 80 }).crewRounded, 13);
  assert.equal(c.crew({ remainingHrs: 4000, weeks: 0, hrsPerWeek: 40 }).crew, null);

  assert.deepEqual(c.submitBy({ needDate: '2027-08-01', leadWeeks: 40, reviewWeeks: 3, releaseWeeks: 1 }), { totalWeeks: 44, date: '2026-09-27' });
  assert.equal(c.submitBy({ needDate: '', leadWeeks: 40, reviewWeeks: 3, releaseWeeks: 1 }).date, null);
  assert.equal(c.breakEven({ overhead: 3e6, marginPct: 15 }), 20e6);
});

test('progress copies merge instead of the newer one wiping the other', () => {
  const cloud = { v: 1, start: '2026-10-05', done: { 1: 'a', 2: 'b' }, notes: { 1: 'phone note' }, cards: { w1q1: { box: 3, due: '2026-10-09' } }, skills: { base: { code: 2 }, now: { code: 3 } }, updated: 100 };
  // A fresh device that marked day 3 while the cloud copy was still loading.
  const fresh = { v: 1, start: '2026-10-12', done: { 3: 'c' }, notes: {}, cards: {}, skills: { base: {}, now: {} }, updated: 200 };
  const m = E.mergeProgress(cloud, fresh);
  assert.deepEqual(Object.keys(m.done).sort(), ['1', '2', '3']);
  assert.equal(m.notes[1], 'phone note');
  assert.equal(m.cards.w1q1.box, 3);
  assert.equal(m.skills.now.code, 3);
  assert.equal(m.updated, 200);
  assert.equal(E.canon(E.mergeProgress(fresh, cloud)), E.canon(m), 'same result in either order');
  // A fresh device's default start date never replaces the real one; a start the user chose later does.
  assert.equal(m.start, '2026-10-05');
  assert.equal(E.mergeProgress(cloud, { ...fresh, startAt: 150 }).start, '2026-10-12');
  // A clash goes to the newer copy.
  assert.equal(E.mergeProgress({ ...cloud, notes: { 1: 'old' }, updated: 1 }, { ...cloud, notes: { 1: 'new' }, updated: 2 }).notes[1], 'new');
  // Erase or Restore replaces everything older outright.
  const erased = { v: 1, start: '2026-10-19', done: {}, notes: {}, cards: {}, skills: { base: {}, now: {} }, updated: 300, replacedAt: 300 };
  assert.deepEqual(E.mergeProgress(cloud, erased).done, {});
  // Edits made after a restore elsewhere still merge.
  assert.deepEqual(Object.keys(E.mergeProgress(erased, { ...cloud, updated: 400 }).done).sort(), ['1', '2']);
});

test('aluminum sizing starts at 12 AWG', () => {
  assert.equal(c.minSizeForDrop({ phase: 3, material: 'al', amps: 20, feet: 50, volts: 480, maxPct: 3 }), '12');
});
