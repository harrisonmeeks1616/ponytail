import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhen, parseWhenDetail, whenNotes, findWhen } from '../src/dates.js';

const NY = 'America/New_York';
// Thursday 2026-10-29, 08:00 EDT.
const NOW = Date.parse('2026-10-29T12:00:00Z');
const opts = { now: NOW, timeZone: NY };
const at = (iso, timeZone = NY) => ({ now: Date.parse(iso), timeZone });

const date = (on, original) => ({ kind: 'date', on, needsTimeCheck: false, original });
const dt = (on, time, needsTimeCheck, original) => ({ kind: 'datetime', on, time, needsTimeCheck, original });
const none = (original) => ({ kind: 'none', needsTimeCheck: false, original });

test('today and tomorrow use the date in the zone, not UTC', () => {
  assert.deepEqual(parseWhen('today', opts), date('2026-10-29', 'today'));
  assert.deepEqual(parseWhen('Tomorrow', opts), date('2026-10-30', 'Tomorrow'));
  assert.deepEqual(parseWhen('tmrw', opts), date('2026-10-30', 'tmrw'));
  // 2026-10-30T02:00Z is still Thursday evening in New York.
  assert.deepEqual(parseWhen('today', at('2026-10-30T02:00:00Z')), date('2026-10-29', 'today'));
  assert.deepEqual(parseWhen('tomorrow', at('2026-10-30T02:00:00Z')), date('2026-10-30', 'tomorrow'));
  // Same instant in Tokyo is already Friday.
  assert.deepEqual(parseWhen('today', at('2026-10-30T02:00:00Z', 'Asia/Tokyo')), date('2026-10-30', 'today'));
});

test('bare weekday is the next occurrence strictly after today', () => {
  assert.deepEqual(parseWhen('Friday', opts), date('2026-10-30', 'Friday'));
  assert.deepEqual(parseWhen('on Saturday', opts), date('2026-10-31', 'on Saturday'));
  assert.deepEqual(parseWhen('monday', opts), date('2026-11-02', 'monday'));
  assert.deepEqual(parseWhen('wednesday', opts), date('2026-11-04', 'wednesday'));
  // Today is Thursday: "Thursday" means a week from today.
  assert.deepEqual(parseWhen('Thursday', opts), date('2026-11-05', 'Thursday'));
  assert.deepEqual(parseWhen('fri', opts), date('2026-10-30', 'fri'));
  assert.deepEqual(parseWhen('Thurs', opts), date('2026-11-05', 'Thurs'));
});

test('"this" weekday includes today; "next" weekday is in the following Monday-start week', () => {
  assert.deepEqual(parseWhen('this Thursday', opts), date('2026-10-29', 'this Thursday'));
  assert.deepEqual(parseWhen('this Friday', opts), date('2026-10-30', 'this Friday'));
  assert.deepEqual(parseWhen('this Monday', opts), date('2026-11-02', 'this Monday'));
  assert.deepEqual(parseWhen('next Friday', opts), date('2026-11-06', 'next Friday'));
  assert.deepEqual(parseWhen('next Wednesday', opts), date('2026-11-04', 'next Wednesday'));
  assert.deepEqual(parseWhen('next Thursday', opts), date('2026-11-05', 'next Thursday'));
  assert.deepEqual(parseWhen('next Sunday', opts), date('2026-11-08', 'next Sunday'));
});

test('"next <weekday>" flags the reading only when the two common readings differ', () => {
  assert.deepEqual(whenNotes('next Friday', opts), ['next_weekday_reading']); // Oct 30 vs Nov 6
  assert.deepEqual(whenNotes('next Wednesday', opts), []); // Nov 4 either way
  assert.deepEqual(whenNotes('next Thursday', opts), []);
  assert.deepEqual(whenNotes('Friday', opts), []);
  // Sunday Nov 1: "next Monday" is tomorrow either way.
  const sunday = at('2026-11-01T15:00:00Z');
  assert.deepEqual(parseWhen('next Monday', sunday), date('2026-11-02', 'next Monday'));
  assert.deepEqual(whenNotes('next Monday', sunday), []);
  // Saturday Oct 31: "next Sunday" is Nov 8, not tomorrow, and is flagged.
  const saturday = at('2026-10-31T15:00:00Z');
  assert.deepEqual(parseWhen('next Sunday', saturday), date('2026-11-08', 'next Sunday'));
  assert.deepEqual(whenNotes('next Sunday', saturday), ['next_weekday_reading']);
});

test('month-name dates, with and without a year', () => {
  assert.deepEqual(parseWhen('Oct 31', opts), date('2026-10-31', 'Oct 31'));
  assert.deepEqual(parseWhen('October 31', opts), date('2026-10-31', 'October 31'));
  assert.deepEqual(parseWhen('Oct. 31st', opts), date('2026-10-31', 'Oct. 31st'));
  assert.deepEqual(parseWhen('31 October', opts), date('2026-10-31', '31 October'));
  assert.deepEqual(parseWhen('October 31, 2027', opts), date('2027-10-31', 'October 31, 2027'));
  assert.deepEqual(parseWhen('Nov 2', opts), date('2026-11-02', 'Nov 2'));
  assert.deepEqual(parseWhen('Sept 3', opts), date('2027-09-03', 'Sept 3'));
});

test('numeric dates are month/day (US order)', () => {
  assert.deepEqual(parseWhen('10/31', opts), date('2026-10-31', '10/31'));
  assert.deepEqual(parseWhen('10/31/2026', opts), date('2026-10-31', '10/31/2026'));
  assert.deepEqual(parseWhen('11/2', opts), date('2026-11-02', '11/2'));
  assert.deepEqual(parseWhen('on 12/1', opts), date('2026-12-01', 'on 12/1'));
});

test('year rollover: a yearless date before today is next year; today stays today', () => {
  assert.deepEqual(parseWhen('Jan 5', opts), date('2027-01-05', 'Jan 5'));
  assert.deepEqual(parseWhen('1/5', opts), date('2027-01-05', '1/5'));
  assert.deepEqual(parseWhen('Oct 29', opts), date('2026-10-29', 'Oct 29'));
  assert.deepEqual(parseWhen('Oct 28', opts), date('2027-10-28', 'Oct 28'));
  // An explicit year is kept even when it is in the past.
  assert.deepEqual(parseWhen('10/28/2026', opts), date('2026-10-28', '10/28/2026'));
  // Dec 31 -> Jan 1 rollover.
  assert.deepEqual(parseWhen('1/1', at('2026-12-31T17:00:00Z')), date('2027-01-01', '1/1'));
  assert.deepEqual(parseWhen('tomorrow', at('2026-12-31T17:00:00Z')), date('2027-01-01', 'tomorrow'));
});

test('dates that do not exist or are ambiguous give none', () => {
  assert.deepEqual(parseWhen('Feb 30', opts), none('Feb 30'));
  assert.deepEqual(parseWhen('13/1', opts), none('13/1'));
  assert.deepEqual(parseWhen('31/10', opts), none('31/10'));
  assert.deepEqual(parseWhen('10/31/26', opts), none('10/31/26'));
  // Feb 29 without a year resolves to the next Feb 29 only if this rollover year has one.
  assert.deepEqual(parseWhen('Feb 29', opts), none('Feb 29')); // 2027 is not a leap year
  assert.deepEqual(parseWhen('2/29/2028', opts), date('2028-02-29', '2/29/2028'));
  // A weekday that disagrees with the explicit date.
  assert.deepEqual(parseWhen('Friday Oct 31', opts), none('Friday Oct 31'));
  assert.deepEqual(parseWhen('Saturday Oct 31', opts), date('2026-10-31', 'Saturday Oct 31'));
  assert.deepEqual(parseWhen('tomorrow Friday', opts), date('2026-10-30', 'tomorrow Friday'));
  assert.deepEqual(parseWhen('tomorrow Saturday', opts), none('tomorrow Saturday'));
  assert.deepEqual(parseWhen('Friday or Saturday', opts), none('Friday or Saturday'));
  assert.deepEqual(parseWhen('today Oct 31', opts), none('today Oct 31'));
});

test('explicit times: am/pm and 24-hour are exact (no time check)', () => {
  assert.deepEqual(parseWhen('3pm', opts), dt('2026-10-29', '15:00', false, '3pm'));
  assert.deepEqual(parseWhen('3:30 pm', opts), dt('2026-10-29', '15:30', false, '3:30 pm'));
  assert.deepEqual(parseWhen('3 p.m.', opts), dt('2026-10-29', '15:00', false, '3 p.m.'));
  assert.deepEqual(parseWhen('15:00', opts), dt('2026-10-29', '15:00', false, '15:00'));
  assert.deepEqual(parseWhen('12pm', opts), dt('2026-10-29', '12:00', false, '12pm'));
  assert.deepEqual(parseWhen('noon', opts), dt('2026-10-29', '12:00', false, 'noon'));
  assert.deepEqual(parseWhen('Friday at 9am', opts), dt('2026-10-30', '09:00', false, 'Friday at 9am'));
  assert.deepEqual(parseWhen('Oct 31 at 15:00', opts), dt('2026-10-31', '15:00', false, 'Oct 31 at 15:00'));
  assert.deepEqual(parseWhen('at 3pm on 11/2', opts), dt('2026-11-02', '15:00', false, 'at 3pm on 11/2'));
});

test('a time with no date is today if still ahead of now, else tomorrow', () => {
  // now is 08:00 local.
  assert.deepEqual(parseWhen('9am', opts), dt('2026-10-29', '09:00', false, '9am'));
  assert.deepEqual(parseWhen('7am', opts), dt('2026-10-30', '07:00', false, '7am'));
  assert.deepEqual(parseWhen('8am', opts), dt('2026-10-30', '08:00', false, '8am'));
  // 12am is midnight, already passed today.
  assert.deepEqual(parseWhen('12am', opts), dt('2026-10-30', '00:00', false, '12am'));
});

test('ambiguity rule: a bare hour 1-6 is pm, 7-11 is am, 12 is noon, always with a time check', () => {
  assert.deepEqual(parseWhen('at 3', opts), dt('2026-10-29', '15:00', true, 'at 3'));
  assert.deepEqual(parseWhen('at 1', opts), dt('2026-10-29', '13:00', true, 'at 1'));
  assert.deepEqual(parseWhen('at 6', opts), dt('2026-10-29', '18:00', true, 'at 6'));
  assert.deepEqual(parseWhen('at 9', opts), dt('2026-10-29', '09:00', true, 'at 9'));
  assert.deepEqual(parseWhen('at 7', opts), dt('2026-10-30', '07:00', true, 'at 7')); // 7am passed
  assert.deepEqual(parseWhen('at 11', opts), dt('2026-10-29', '11:00', true, 'at 11'));
  assert.deepEqual(parseWhen('at 12', opts), dt('2026-10-29', '12:00', true, 'at 12'));
  assert.deepEqual(parseWhen('at 3:30', opts), dt('2026-10-29', '15:30', true, 'at 3:30'));
  assert.deepEqual(parseWhen('Friday at 3', opts), dt('2026-10-30', '15:00', true, 'Friday at 3'));
  // A 24-hour value after "at" is not ambiguous.
  assert.deepEqual(parseWhen('at 15', opts), dt('2026-10-29', '15:00', false, 'at 15'));
  assert.deepEqual(parseWhen('at 08:00', opts), dt('2026-10-30', '08:00', false, 'at 08:00'));
  assert.deepEqual(parseWhen('at 24', opts), none('at 24'));
  assert.deepEqual(parseWhen('3', opts), none('3'));
});

test('a part of the day settles a bare hour; contradictions give none', () => {
  assert.deepEqual(parseWhen('at 3 in the afternoon', opts), dt('2026-10-29', '15:00', false, 'at 3 in the afternoon'));
  assert.deepEqual(parseWhen('Friday at 8 in the morning', opts), dt('2026-10-30', '08:00', false, 'Friday at 8 in the morning'));
  assert.deepEqual(parseWhen('tonight at 8', opts), dt('2026-10-29', '20:00', false, 'tonight at 8'));
  assert.deepEqual(parseWhen('at 3 this afternoon', opts), dt('2026-10-29', '15:00', false, 'at 3 this afternoon'));
  assert.deepEqual(parseWhen('3am in the afternoon', opts), none('3am in the afternoon'));
  assert.deepEqual(parseWhen('at 12 in the morning', opts), none('at 12 in the morning'));
  assert.deepEqual(parseWhen('tonight in the morning', opts), none('tonight in the morning'));
});

test('morning / afternoon / evening give 08:00 / 13:00 / 18:00 with needsTimeCheck', () => {
  assert.deepEqual(parseWhen('Friday morning', opts), dt('2026-10-30', '08:00', true, 'Friday morning'));
  assert.deepEqual(parseWhen('tomorrow afternoon', opts), dt('2026-10-30', '13:00', true, 'tomorrow afternoon'));
  assert.deepEqual(parseWhen('Saturday evening', opts), dt('2026-10-31', '18:00', true, 'Saturday evening'));
  assert.deepEqual(parseWhen('this afternoon', opts), dt('2026-10-29', '13:00', true, 'this afternoon'));
  assert.deepEqual(parseWhen('this evening', opts), dt('2026-10-29', '18:00', true, 'this evening'));
  assert.deepEqual(parseWhen('tonight', opts), dt('2026-10-29', '18:00', true, 'tonight'));
  assert.deepEqual(parseWhen('on Oct 31 in the morning', opts), dt('2026-10-31', '08:00', true, 'on Oct 31 in the morning'));
  // No date: today if 08:00 is still ahead, otherwise tomorrow (now is exactly 08:00).
  assert.deepEqual(parseWhen('in the morning', opts), dt('2026-10-30', '08:00', true, 'in the morning'));
  assert.deepEqual(parseWhen('afternoon', opts), dt('2026-10-29', '13:00', true, 'afternoon'));
  assert.deepEqual(parseWhen('this morning Friday', opts), none('this morning Friday'));
});

test('unparseable phrases give kind none and keep the original phrase exactly', () => {
  for (const phrase of ['next week', 'end of day', 'EOD', 'asap', 'around 3', 'soon', 'after lunch',
    'Friday-ish', 'in two days', '', '   ', 'the 30th', 'midnight', 'Friday Friday', 'at 3 at 4']) {
    assert.deepEqual(parseWhen(phrase, opts), none(phrase), phrase);
  }
  assert.deepEqual(parseWhen(undefined, opts), none(undefined));
});

test('trailing punctuation and case do not matter; original is untouched', () => {
  assert.deepEqual(parseWhen('FRIDAY MORNING.', opts), dt('2026-10-30', '08:00', true, 'FRIDAY MORNING.'));
  assert.deepEqual(parseWhen('  Friday,  at 3pm ', opts), dt('2026-10-30', '15:00', false, '  Friday,  at 3pm '));
});

test('parseWhenDetail reports which parts were stated', () => {
  const d = parseWhenDetail('Saturday', opts);
  assert.equal(d.hasDate, true);
  assert.equal(d.hasTime, false);
  const t = parseWhenDetail('3pm', opts);
  assert.equal(t.hasDate, false);
  assert.equal(t.hasTime, true);
  const n = parseWhenDetail('whenever', opts);
  assert.deepEqual(n, { result: none('whenever'), hasDate: false, hasTime: false, notes: [] });
});

test('findWhen picks the longest phrase inside a sentence, full weekday names only', () => {
  const f = findWhen('Jeff asked for two more electricians Friday, need to check.', opts);
  assert.equal(f.phrase, 'Friday');
  assert.deepEqual(f.when, date('2026-10-30', 'Friday'));
  const g = findWhen('call the supplier tomorrow at 3pm about fixtures', opts);
  assert.equal(g.phrase, 'tomorrow at 3pm');
  assert.deepEqual(g.when, dt('2026-10-30', '15:00', false, 'tomorrow at 3pm'));
  assert.equal(findWhen('I sat down with the crew', opts), null);
  assert.equal(findWhen('two more electricians', opts), null);
});

test('findWhen reads an abbreviated weekday only after on/this/next', () => {
  // Thursday 08:00: "on Mon" is Monday Nov 2, not today or tomorrow.
  const f = findWhen('call Jeff on Mon at 7', opts);
  assert.equal(f.phrase, 'on Mon at 7');
  assert.deepEqual(f.when, dt('2026-11-02', '07:00', true, 'on Mon at 7'));
  assert.deepEqual(findWhen('call Jeff next Fri', opts).when, date('2026-11-06', 'next Fri'));
  assert.deepEqual(findWhen('call Jeff this Sat', opts).when, date('2026-10-31', 'this Sat'));
  // Without a lead word an abbreviation is just a word: only the time is read.
  assert.equal(findWhen('call Jeff Fri at 2pm', opts).phrase, 'at 2pm');
  assert.equal(findWhen('I sat on the tailgate', opts), null);
});

test('findWhen: trade sizes are never dates; a bare M/D needs a lead word', () => {
  assert.equal(findWhen('order 3/4 EMT', opts), null);
  assert.equal(findWhen('order 1/2 inch flex', opts), null);
  assert.equal(findWhen('order 3/8 rod by Friday', opts).phrase, 'by Friday');
  const g = findWhen('pull 12/2 at 3', opts);
  assert.equal(g.phrase, 'at 3', 'the wire size is not part of the when-phrase');
  assert.deepEqual(findWhen('order 3 spools of 12/2 by 11/4', opts).when, date('2026-11-04', 'by 11/4'));
  assert.deepEqual(findWhen('inspection due 11/4', opts).when, date('2026-11-04', '11/4'));
  assert.deepEqual(findWhen('walkthrough on 12/2', opts).when, date('2026-12-02', 'on 12/2'));
  assert.equal(findWhen('check 3 spools of 12/2 10/31', opts), null);
  // Explicit phrases (parseWhen) are unchanged.
  assert.deepEqual(parseWhen('11/2', opts), date('2026-11-02', '11/2'));
  assert.deepEqual(parseWhen('1/5', opts), date('2027-01-05', '1/5'));
});

test('deterministic: same input, same output', () => {
  const a = parseWhen('next Friday at 3', opts);
  const b = parseWhen('next Friday at 3', opts);
  assert.deepEqual(a, b);
});

test('rejects missing options', () => {
  assert.throws(() => parseWhen('today'), TypeError);
  assert.throws(() => parseWhen('today', { now: NOW }), TypeError);
  assert.throws(() => parseWhen('today', { now: 'x', timeZone: NY }), TypeError);
});
