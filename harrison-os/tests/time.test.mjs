import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zonedWallTimeToInstant,
  instantToZonedParts,
  nextDailyOccurrence,
  formatLocal,
} from '../src/time.js';

const NY = 'America/New_York';
const Z = (iso) => Date.parse(iso);

test('07:00 New York maps to 11:00Z before fall-back and 12:00Z after', () => {
  const before = zonedWallTimeToInstant({ date: '2026-10-31', time: '07:00', timeZone: NY });
  assert.deepEqual(before, { instantMs: Z('2026-10-31T11:00:00Z'), offsetMinutes: -240, adjustment: 'none' });
  const after = zonedWallTimeToInstant({ date: '2026-11-02', time: '07:00', timeZone: NY });
  assert.deepEqual(after, { instantMs: Z('2026-11-02T12:00:00Z'), offsetMinutes: -300, adjustment: 'none' });
});

test('ambiguous 01:30 on 2026-11-01 takes the earlier instant (EDT)', () => {
  const r = zonedWallTimeToInstant({ date: '2026-11-01', time: '01:30', timeZone: NY });
  assert.deepEqual(r, { instantMs: Z('2026-11-01T05:30:00Z'), offsetMinutes: -240, adjustment: 'overlap_earlier' });
});

test('times next to the overlap are unambiguous', () => {
  const a = zonedWallTimeToInstant({ date: '2026-11-01', time: '00:59', timeZone: NY });
  assert.equal(a.instantMs, Z('2026-11-01T04:59:00Z'));
  assert.equal(a.adjustment, 'none');
  const b = zonedWallTimeToInstant({ date: '2026-11-01', time: '02:00', timeZone: NY });
  assert.equal(b.instantMs, Z('2026-11-01T07:00:00Z'));
  assert.equal(b.offsetMinutes, -300);
  assert.equal(b.adjustment, 'none');
  const c = zonedWallTimeToInstant({ date: '2026-11-01', time: '01:00', timeZone: NY });
  assert.equal(c.instantMs, Z('2026-11-01T05:00:00Z'));
  assert.equal(c.adjustment, 'overlap_earlier');
});

test('nonexistent 02:30 on 2027-03-14 shifts forward to 03:30 EDT', () => {
  const r = zonedWallTimeToInstant({ date: '2027-03-14', time: '02:30', timeZone: NY });
  assert.deepEqual(r, { instantMs: Z('2027-03-14T07:30:00Z'), offsetMinutes: -240, adjustment: 'gap_shifted_forward' });
  assert.deepEqual(instantToZonedParts(r.instantMs, NY), { date: '2027-03-14', time: '03:30', offsetMinutes: -240 });
  const edge = zonedWallTimeToInstant({ date: '2027-03-14', time: '02:00', timeZone: NY });
  assert.equal(edge.instantMs, Z('2027-03-14T07:00:00Z'));
  assert.equal(edge.adjustment, 'gap_shifted_forward');
  const after = zonedWallTimeToInstant({ date: '2027-03-14', time: '03:00', timeZone: NY });
  assert.equal(after.instantMs, Z('2027-03-14T07:00:00Z'));
  assert.equal(after.adjustment, 'none');
});

test('daily 07:00 is anchored to wall time across fall-back', () => {
  let afterMs = Z('2026-10-31T10:00:00Z'); // 06:00 EDT, before 07:00 local
  const first = nextDailyOccurrence({ time: '07:00', timeZone: NY, afterMs });
  assert.deepEqual(first, { instantMs: Z('2026-10-31T11:00:00Z'), date: '2026-10-31', adjustment: 'none' });
  afterMs = first.instantMs;
  const second = nextDailyOccurrence({ time: '07:00', timeZone: NY, afterMs });
  assert.deepEqual(second, { instantMs: Z('2026-11-01T12:00:00Z'), date: '2026-11-01', adjustment: 'none' });
  afterMs = second.instantMs;
  const third = nextDailyOccurrence({ time: '07:00', timeZone: NY, afterMs });
  assert.deepEqual(third, { instantMs: Z('2026-11-02T12:00:00Z'), date: '2026-11-02', adjustment: 'none' });
});

test('nextDailyOccurrence is strictly after afterMs', () => {
  const at = Z('2026-10-31T11:00:00Z');
  assert.equal(nextDailyOccurrence({ time: '07:00', timeZone: NY, afterMs: at }).instantMs, Z('2026-11-01T12:00:00Z'));
  assert.equal(nextDailyOccurrence({ time: '07:00', timeZone: NY, afterMs: at - 1 }).instantMs, at);
});

test('daily 01:30 fires once on the fall-back day (earlier instant)', () => {
  const fires = [];
  let afterMs = Z('2026-10-31T12:00:00Z');
  for (let i = 0; i < 3; i++) {
    const r = nextDailyOccurrence({ time: '01:30', timeZone: NY, afterMs });
    fires.push(r);
    afterMs = r.instantMs;
  }
  assert.deepEqual(fires.map((f) => f.date), ['2026-11-01', '2026-11-02', '2026-11-03']);
  assert.equal(fires[0].instantMs, Z('2026-11-01T05:30:00Z'));
  assert.equal(fires[0].adjustment, 'overlap_earlier');
  assert.equal(fires[1].instantMs, Z('2026-11-02T06:30:00Z'));
  assert.equal(fires.filter((f) => f.date === '2026-11-01').length, 1);
  // Starting inside the repeated hour, after the earlier 01:30, must not fire again that day.
  const inside = nextDailyOccurrence({ time: '01:30', timeZone: NY, afterMs: Z('2026-11-01T05:45:00Z') });
  assert.equal(inside.date, '2026-11-02');
});

test('daily 02:30 on spring-forward day fires at 03:30 EDT', () => {
  const r = nextDailyOccurrence({ time: '02:30', timeZone: NY, afterMs: Z('2027-03-13T12:00:00Z') });
  assert.deepEqual(r, { instantMs: Z('2027-03-14T07:30:00Z'), date: '2027-03-14', adjustment: 'gap_shifted_forward' });
  const next = nextDailyOccurrence({ time: '02:30', timeZone: NY, afterMs: r.instantMs });
  assert.deepEqual(next, { instantMs: Z('2027-03-15T06:30:00Z'), date: '2027-03-15', adjustment: 'none' });
  assert.equal(formatLocal(r.instantMs, NY), 'Sun Mar 14, 3:30 AM EDT');
});

test('Asia/Kolkata (no DST) round-trips', () => {
  const tz = 'Asia/Kolkata';
  const r = zonedWallTimeToInstant({ date: '2026-11-01', time: '07:00', timeZone: tz });
  assert.deepEqual(r, { instantMs: Z('2026-11-01T01:30:00Z'), offsetMinutes: 330, adjustment: 'none' });
  assert.deepEqual(instantToZonedParts(r.instantMs, tz), { date: '2026-11-01', time: '07:00', offsetMinutes: 330 });
  const d = nextDailyOccurrence({ time: '07:00', timeZone: tz, afterMs: r.instantMs });
  assert.equal(d.instantMs - r.instantMs, 86_400_000);
});

test('UTC round-trips', () => {
  const r = zonedWallTimeToInstant({ date: '2026-03-08', time: '02:30', timeZone: 'UTC' });
  assert.deepEqual(r, { instantMs: Z('2026-03-08T02:30:00Z'), offsetMinutes: 0, adjustment: 'none' });
  assert.deepEqual(instantToZonedParts(r.instantMs, 'UTC'), { date: '2026-03-08', time: '02:30', offsetMinutes: 0 });
  assert.equal(formatLocal(r.instantMs, 'UTC'), 'Sun Mar 8, 2:30 AM UTC');
});

test('date boundaries 23:59 and 00:00 stay on the intended day', () => {
  const cases = [
    [NY, '2026-11-01', '00:00'],
    [NY, '2026-11-01', '23:59'],
    [NY, '2026-10-31', '23:59'],
    [NY, '2027-03-14', '00:00'],
    [NY, '2027-03-14', '23:59'],
    [NY, '2026-12-31', '23:59'],
    [NY, '2027-01-01', '00:00'],
    ['Asia/Kolkata', '2026-10-31', '00:00'],
    ['Asia/Kolkata', '2026-10-31', '23:59'],
    ['UTC', '2026-02-28', '23:59'],
    ['UTC', '2028-02-29', '00:00'],
    ['Pacific/Kiritimati', '2026-06-01', '00:00'],
    ['Pacific/Pago_Pago', '2026-06-01', '23:59'],
  ];
  for (const [timeZone, date, time] of cases) {
    const r = zonedWallTimeToInstant({ date, time, timeZone });
    assert.equal(r.adjustment, 'none', `${timeZone} ${date} ${time}`);
    const back = instantToZonedParts(r.instantMs, timeZone);
    assert.equal(back.date, date, `${timeZone} ${date} ${time}`);
    assert.equal(back.time, time, `${timeZone} ${date} ${time}`);
    assert.equal(back.offsetMinutes, r.offsetMinutes);
    const occ = nextDailyOccurrence({ time, timeZone, afterMs: r.instantMs - 1 });
    assert.equal(occ.date, date, `daily ${timeZone} ${date} ${time}`);
    assert.equal(occ.instantMs, r.instantMs);
  }
});

test('southern hemisphere and half-hour DST zones resolve gaps and overlaps', () => {
  // Australia/Sydney: spring forward 2026-10-04 02:00 -> 03:00 (AEST +10 -> AEDT +11).
  const syd = zonedWallTimeToInstant({ date: '2026-10-04', time: '02:15', timeZone: 'Australia/Sydney' });
  assert.equal(syd.adjustment, 'gap_shifted_forward');
  assert.equal(syd.offsetMinutes, 660);
  assert.deepEqual(instantToZonedParts(syd.instantMs, 'Australia/Sydney').time, '03:15');
  // Australia/Lord_Howe: fall back 2026-04-05 02:00 -> 01:30 (+11 -> +10:30), 30-minute overlap.
  const lh = zonedWallTimeToInstant({ date: '2026-04-05', time: '01:45', timeZone: 'Australia/Lord_Howe' });
  assert.equal(lh.adjustment, 'overlap_earlier');
  assert.equal(lh.offsetMinutes, 660);
  assert.equal(lh.instantMs, Z('2026-04-04T14:45:00Z'));
});

test('formatLocal shows EDT vs EST', () => {
  assert.equal(formatLocal(Z('2026-10-31T11:00:00Z'), NY), 'Sat Oct 31, 7:00 AM EDT');
  assert.equal(formatLocal(Z('2026-11-02T12:00:00Z'), NY), 'Mon Nov 2, 7:00 AM EST');
  assert.equal(formatLocal(Z('2026-11-01T05:30:00Z'), NY), 'Sun Nov 1, 1:30 AM EDT');
  assert.equal(formatLocal(Z('2026-11-01T06:30:00Z'), NY), 'Sun Nov 1, 1:30 AM EST');
  assert.equal(formatLocal(Z('2026-11-01T17:05:00Z'), NY), 'Sun Nov 1, 12:05 PM EST');
  assert.match(formatLocal(Z('2026-11-01T01:30:00Z'), 'Asia/Kolkata'), /^Sun Nov 1, 7:00 AM \S+$/);
});

test('instantToZonedParts reports the offset on each side of fall-back', () => {
  assert.deepEqual(instantToZonedParts(Z('2026-11-01T05:30:00Z'), NY), { date: '2026-11-01', time: '01:30', offsetMinutes: -240 });
  assert.deepEqual(instantToZonedParts(Z('2026-11-01T06:30:00Z'), NY), { date: '2026-11-01', time: '01:30', offsetMinutes: -300 });
  assert.deepEqual(instantToZonedParts(Z('2026-11-01T04:00:00Z'), NY), { date: '2026-11-01', time: '00:00', offsetMinutes: -240 });
});

test('bad inputs throw RangeError', () => {
  const ok = { date: '2026-11-01', time: '07:00', timeZone: NY };
  const bad = [
    { ...ok, date: '2026-02-30' },
    { ...ok, date: '2026-13-01' },
    { ...ok, date: '2026-00-10' },
    { ...ok, date: '2026-1-01' },
    { ...ok, date: '20261101' },
    { ...ok, date: '' },
    { ...ok, date: 20261101 },
    { ...ok, date: '2027-02-29' },
    { ...ok, date: '0999-12-31' },
    { ...ok, time: '24:00' },
    { ...ok, time: '07:60' },
    { ...ok, time: '7:00' },
    { ...ok, time: '07:00:00' },
    { ...ok, time: null },
    { ...ok, timeZone: 'Mars/Olympus_Mons' },
    { ...ok, timeZone: '' },
    { ...ok, timeZone: undefined },
    { ...ok, timeZone: 42 },
  ];
  for (const args of bad) {
    assert.throws(() => zonedWallTimeToInstant(args), RangeError, JSON.stringify(args));
  }
  assert.throws(() => zonedWallTimeToInstant(), RangeError);
  assert.throws(() => zonedWallTimeToInstant(null), RangeError);
  assert.throws(() => nextDailyOccurrence(), RangeError);
  assert.throws(() => nextDailyOccurrence({ time: '07:00', timeZone: NY, afterMs: NaN }), RangeError);
  assert.throws(() => nextDailyOccurrence({ time: '07:00', timeZone: NY, afterMs: '1700000000000' }), RangeError);
  assert.throws(() => nextDailyOccurrence({ time: '25:00', timeZone: NY, afterMs: 0 }), RangeError);
  assert.throws(() => nextDailyOccurrence({ time: '07:00', timeZone: 'Nope/Nowhere', afterMs: 0 }), RangeError);
  assert.throws(() => instantToZonedParts(Infinity, NY), RangeError);
  assert.throws(() => instantToZonedParts(0, 'Bad/Zone'), RangeError);
  assert.throws(() => instantToZonedParts(8.64e15, NY), RangeError);
  assert.throws(() => formatLocal(undefined, NY), RangeError);
  assert.throws(() => formatLocal(0, 'Bad/Zone'), RangeError);
});

test('valid leap day accepted', () => {
  const r = zonedWallTimeToInstant({ date: '2028-02-29', time: '12:00', timeZone: NY });
  assert.equal(r.instantMs, Z('2028-02-29T17:00:00Z'));
});
