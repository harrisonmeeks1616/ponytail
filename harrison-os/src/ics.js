// Read-only iCalendar (RFC 5545) parsing and recurrence expansion. Pure functions, no I/O, no dependencies.
//
// parseIcs(text, { fromMs, toMs, defaultTimeZone }) -> { events, stats }
//
// Supported: line unfolding; VEVENT (nested VALARM etc. ignored); DTSTART/DTEND/RECURRENCE-ID/EXDATE as
// UTC (Z), TZID (IANA, validated with Intl; common Windows names mapped), floating (read in the calendar's
// X-WR-TIMEZONE or defaultTimeZone) and VALUE=DATE (date-only stays date-only); DURATION; RRULE with
// FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, COUNT, UNTIL, WKST, BYDAY for WEEKLY, BYDAY (with ordinal,
// e.g. 2TU, -1FR) and BYMONTHDAY for MONTHLY; EXDATE; RECURRENCE-ID overrides; STATUS:CANCELLED skipped;
// CLASS:PRIVATE|CONFIDENTIAL -> busy_only (title and location dropped, never stored); TRANSP:TRANSPARENT
// -> shows_as 'free'.
//
// Recurrences are anchored to wall-clock time in the event's zone (src/time.js), so a weekly 09:00 New York
// meeting stays at 09:00 across a DST change. A rule with parts outside the subset (BYSETPOS, BYHOUR, ...)
// yields only its first occurrence and is counted in stats.unsupported_rules so the UI can say so.
//
// The text is untrusted: it only ever becomes inert titles, locations and times. DESCRIPTION, ATTENDEE,
// URL, ATTACH and X- properties are never read.

import { zonedWallTimeToInstant, instantToZonedParts } from './time.js';

export const MAX_ICS_BYTES = 2 * 1024 * 1024;
export const MAX_EVENTS = 2000;
const MAX_TEXT = 200;
// Hard ceiling on occurrences collected before sorting and trimming to MAX_EVENTS, and on rule periods
// walked per VEVENT. Both only bind on hostile or degenerate input.
const MAX_COLLECT = 20000;
const MAX_PERIODS = 10000;
const DAY_MS = 86_400_000;

export class IcsError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

// Outlook / Exchange publish Windows zone names. Only the common ones; anything else falls back.
const WINDOWS_TZ = {
  'eastern standard time': 'America/New_York',
  'central standard time': 'America/Chicago',
  'mountain standard time': 'America/Denver',
  'us mountain standard time': 'America/Phoenix',
  'pacific standard time': 'America/Los_Angeles',
  'alaskan standard time': 'America/Anchorage',
  'hawaiian standard time': 'Pacific/Honolulu',
  'atlantic standard time': 'America/Halifax',
  'gmt standard time': 'Europe/London',
  'w. europe standard time': 'Europe/Berlin',
  'utc': 'UTC',
  'coordinated universal time': 'UTC',
};

const WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const SUPPORTED_RULE_PARTS = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'WKST', 'BYDAY', 'BYMONTHDAY']);

// ---------------------------------------------------------------- date helpers (YYYY-MM-DD, proleptic UTC)

const pad2 = (n) => String(n).padStart(2, '0');

function dateMs(date) {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

function msDate(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDays(date, n) {
  return msDate(dateMs(date) + n * DAY_MS);
}

function daysBetween(a, b) {
  return Math.round((dateMs(b) - dateMs(a)) / DAY_MS);
}

function weekday(date) {
  return new Date(dateMs(date)).getUTCDay();
}

function makeDate(year, month, day) {
  // month 1-12; returns null for a date that does not exist (Feb 30, Feb 29 in a common year).
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return null;
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validTz(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- content lines

export function unfold(text) {
  return String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

// name *(";" param) ":" value. Parameter values may be quoted and contain ':' or ';'.
function parseLine(line) {
  let inQuote = false;
  const cuts = [];
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (!inQuote && c === ';') cuts.push(i);
    else if (!inQuote && c === ':') {
      colon = i;
      break;
    }
  }
  if (colon < 1) return null;
  const head = line.slice(0, colon);
  const bounds = [-1, ...cuts, colon];
  const name = head.slice(0, bounds[1] === colon ? colon : bounds[1]).toUpperCase();
  const params = {};
  for (let i = 1; i < bounds.length - 1; i++) {
    const part = line.slice(bounds[i] + 1, bounds[i + 1]);
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/"/g, '');
  }
  return { name, params, value: line.slice(colon + 1) };
}

function unescapeText(value) {
  const s = String(value).replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? ' ' : c));
  // Control characters (including newlines) become spaces; titles are one line.
  const clean = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, MAX_TEXT) : null;
}

// ---------------------------------------------------------------- date-time values

const DT_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/;

/**
 * One DATE or DATE-TIME value -> { date } (date-only) or { date, time: 'HH:MM', sec, tz }, or null.
 * ctx: { floatingTz, stats }.
 */
function parseDateValue(raw, params, ctx) {
  const m = DT_RE.exec(String(raw).trim());
  if (!m) return null;
  const date = makeDate(Number(m[1]), Number(m[2]), Number(m[3]));
  if (!date) return null;
  if (m[4] === undefined || params.VALUE === 'DATE') return { date };
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const sec = Math.min(59, Number(m[6] || 0));
  if (hour > 23 || minute > 59) return null;
  const time = `${pad2(hour)}:${pad2(minute)}`;
  if (m[7]) return { date, time, sec, tz: 'UTC' };
  if (params.TZID) return { date, time, sec, tz: resolveTz(params.TZID, ctx) };
  return { date, time, sec, tz: ctx.floatingTz };
}

function resolveTz(tzid, ctx) {
  const raw = String(tzid).trim().replace(/^\/+/, '');
  if (raw && validTz(raw)) return raw;
  const mapped = WINDOWS_TZ[raw.toLowerCase()];
  if (mapped) return mapped;
  // A TZID with no IANA meaning (a custom VTIMEZONE name). Read in the calendar's zone and count it.
  ctx.stats.tz_fallbacks++;
  return ctx.floatingTz;
}

// Wall time -> instant through src/time.js, memoised per parse: the Intl round trips dominate CPU time.
function instantOf(dv, ctx) {
  const tz = dv.time ? dv.tz : ctx.viewTz;
  const time = dv.time || '00:00';
  const k = `${tz}|${dv.date}|${time}`;
  let ms = ctx.memo.get(k);
  if (ms === undefined) {
    // Fast path: when the zone's offset is the same two days either side, no transition can touch this
    // wall time (real zones change offset months apart), so wall time minus that offset is exact.
    // Otherwise src/time.js resolves it, including the DST gap and overlap policy.
    const before = offsetOn(tz, addDays(dv.date, -2), ctx);
    const local = dateMs(dv.date) + (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))) * 60_000;
    ms = before === offsetOn(tz, addDays(dv.date, 2), ctx)
      ? local - before * 60_000
      : zonedWallTimeToInstant({ date: dv.date, time, timeZone: tz }).instantMs;
    ctx.memo.set(k, ms);
  }
  return ms + (dv.time ? dv.sec * 1000 : 0);
}

function offsetOn(tz, date, ctx) {
  const k = `o|${tz}|${date}`;
  let o = ctx.memo.get(k);
  if (o === undefined) {
    o = instantToZonedParts(dateMs(date) + DAY_MS / 2, tz).offsetMinutes;
    ctx.memo.set(k, o);
  }
  return o;
}

// Occurrence identity: date-only by date, timed by instant. Matches RECURRENCE-ID and EXDATE to occurrences.
function keyOf(dv, ctx) {
  return dv.time ? `T:${instantOf(dv, ctx)}` : `D:${dv.date}`;
}

// DURATION: [+-]P(nW | nD T nH nM nS). Returns { days, ms } or null.
const DUR_RE = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
function parseDuration(raw) {
  const m = DUR_RE.exec(String(raw).trim());
  if (!m || raw.trim() === 'P' || /T$/.test(raw.trim())) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const days = (Number(m[2] || 0) * 7 + Number(m[3] || 0)) * sign;
  const ms = ((Number(m[4] || 0) * 60 + Number(m[5] || 0)) * 60 + Number(m[6] || 0)) * 1000 * sign;
  return { days, ms };
}

// ---------------------------------------------------------------- RRULE

function parseRrule(value) {
  const parts = {};
  for (const kv of String(value).split(';')) {
    const eq = kv.indexOf('=');
    if (eq > 0) parts[kv.slice(0, eq).trim().toUpperCase()] = kv.slice(eq + 1).trim().toUpperCase();
  }
  const freq = parts.FREQ;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return { unsupported: true };
  for (const k of Object.keys(parts)) if (!SUPPORTED_RULE_PARTS.has(k)) return { unsupported: true };
  const rule = { freq, interval: 1, count: null, until: null, wkst: 1, byday: null, bymonthday: null };
  if (parts.INTERVAL !== undefined) {
    const n = Number(parts.INTERVAL);
    if (!Number.isInteger(n) || n < 1 || n > 1000) return { unsupported: true };
    rule.interval = n;
  }
  if (parts.COUNT !== undefined) {
    const n = Number(parts.COUNT);
    if (!Number.isInteger(n) || n < 1) return { unsupported: true };
    rule.count = n;
  }
  if (parts.UNTIL !== undefined) rule.until = parts.UNTIL;
  if (parts.WKST !== undefined) {
    if (!(parts.WKST in WEEKDAYS)) return { unsupported: true };
    rule.wkst = WEEKDAYS[parts.WKST];
  }
  if (parts.BYDAY !== undefined) {
    if (freq !== 'WEEKLY' && freq !== 'MONTHLY') return { unsupported: true };
    rule.byday = [];
    for (const tok of parts.BYDAY.split(',')) {
      const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(tok);
      if (!m) return { unsupported: true };
      const nth = m[1] ? Number(m[1]) : 0;
      if (freq === 'WEEKLY' && nth !== 0) return { unsupported: true };
      if (nth === 0 && freq === 'MONTHLY') return { unsupported: true }; // "every Tuesday of the month": not in the subset
      if (Math.abs(nth) > 5) return { unsupported: true };
      rule.byday.push({ nth, day: WEEKDAYS[m[2]] });
    }
  }
  if (parts.BYMONTHDAY !== undefined) {
    if (freq !== 'MONTHLY' || rule.byday) return { unsupported: true };
    rule.bymonthday = parts.BYMONTHDAY.split(',').map(Number);
    if (rule.bymonthday.some((n) => !Number.isInteger(n) || n === 0 || Math.abs(n) > 31)) return { unsupported: true };
  }
  return rule;
}

function monthIndex(date) {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

// Candidate dates (sorted) for period k of a rule anchored at start date.
function periodDates(rule, startDate, k) {
  const step = k * rule.interval;
  if (rule.freq === 'DAILY') return [addDays(startDate, step)];
  if (rule.freq === 'WEEKLY') {
    if (!rule.byday) return [addDays(startDate, 7 * step)];
    const weekStart = addDays(startDate, -((weekday(startDate) - rule.wkst + 7) % 7) + 7 * step);
    return rule.byday.map((b) => addDays(weekStart, (b.day - rule.wkst + 7) % 7)).sort();
  }
  if (rule.freq === 'MONTHLY') {
    const mi = monthIndex(startDate) + step;
    const year = Math.floor(mi / 12);
    const month = (mi % 12) + 1;
    const dim = daysInMonth(year, month);
    let days;
    if (rule.bymonthday) days = rule.bymonthday.map((n) => (n > 0 ? n : dim + n + 1));
    else if (rule.byday) {
      days = rule.byday.map(({ nth, day }) => {
        if (nth > 0) {
          const first = (day - weekday(makeDate(year, month, 1)) + 7) % 7 + 1;
          return first + (nth - 1) * 7;
        }
        const last = dim - ((weekday(makeDate(year, month, dim)) - day + 7) % 7);
        return last + (nth + 1) * 7;
      });
    } else days = [Number(startDate.slice(8, 10))];
    return [...new Set(days.filter((d) => d >= 1 && d <= dim))].sort((a, b) => a - b).map((d) => makeDate(year, month, d));
  }
  // YEARLY: same month and day; Feb 29 only in leap years (RFC 5545: invalid dates are ignored).
  const d = makeDate(Number(startDate.slice(0, 4)) + step, Number(startDate.slice(5, 7)), Number(startDate.slice(8, 10)));
  return d ? [d] : [];
}

// First period index worth walking for a window starting at windowStartDate (only used without COUNT).
function firstPeriod(rule, startDate, windowStartDate) {
  const days = daysBetween(startDate, windowStartDate);
  if (days <= 0) return 0;
  let periods;
  if (rule.freq === 'DAILY') periods = days;
  else if (rule.freq === 'WEEKLY') periods = Math.floor(days / 7);
  else if (rule.freq === 'MONTHLY') periods = monthIndex(windowStartDate) - monthIndex(startDate);
  else periods = Number(windowStartDate.slice(0, 4)) - Number(startDate.slice(0, 4));
  return Math.max(0, Math.floor(periods / rule.interval) - 1);
}

// ---------------------------------------------------------------- components

function readComponents(lines) {
  const events = [];
  const cal = {};
  let current = null;
  let nested = 0;
  let sawCalendar = false;
  for (const line of lines) {
    if (!line) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      const what = p.value.trim().toUpperCase();
      if (what === 'VCALENDAR') sawCalendar = true;
      else if (what === 'VEVENT' && !current) {
        current = {};
        nested = 0;
      } else if (current) nested++;
      continue;
    }
    if (p.name === 'END') {
      const what = p.value.trim().toUpperCase();
      if (current && nested > 0) nested--;
      else if (current && what === 'VEVENT') {
        events.push(current);
        current = null;
      }
      continue;
    }
    if (current) {
      if (nested === 0) (current[p.name] ||= []).push(p);
    } else if (p.name === 'X-WR-TIMEZONE') cal.tz = p.value.trim();
  }
  if (!sawCalendar) throw new IcsError('not_ics', 'This is not a calendar file');
  return { events, cal };
}

const first = (ev, name) => (ev[name] ? ev[name][0] : null);

// Date-level pre-check, so the years of past one-off events in a typical feed cost no time-zone math.
// Only for single events: a series or a RECURRENCE-ID instance always goes through expansion.
function clearlyOutside(ev, ctx) {
  if (ev.RRULE || ev['RECURRENCE-ID']) return false;
  const s = DT_RE.exec(String(first(ev, 'DTSTART')?.value || '').trim());
  if (!s) return false;
  const startDate = `${s[1]}-${s[2]}-${s[3]}`;
  const e = DT_RE.exec(String(first(ev, 'DTEND')?.value || '').trim());
  let endDate = e ? `${e[1]}-${e[2]}-${e[3]}` : startDate;
  const du = first(ev, 'DURATION');
  if (!e && du) {
    const d = parseDuration(du.value);
    if (!d) return false;
    endDate = addDays(startDate, d.days + Math.ceil(d.ms / DAY_MS));
  }
  return endDate < ctx.windowStartDate || startDate > ctx.windowEndDate;
}

function eventBase(ev, ctx) {
  const ds = first(ev, 'DTSTART');
  const start = ds ? parseDateValue(ds.value, ds.params, ctx) : null;
  if (!start) return null;
  const cls = (first(ev, 'CLASS')?.value || '').trim().toUpperCase();
  const busyOnly = cls === 'PRIVATE' || cls === 'CONFIDENTIAL';
  const transp = (first(ev, 'TRANSP')?.value || '').trim().toUpperCase();
  // Duration: date-only events in whole days; timed events in exact milliseconds.
  let durDays = 1;
  let durMs = 0;
  const de = first(ev, 'DTEND');
  const du = first(ev, 'DURATION');
  const end = de ? parseDateValue(de.value, de.params, ctx) : null;
  if (end) {
    if (!start.time) durDays = end.time ? 1 : Math.max(1, daysBetween(start.date, end.date));
    else durMs = Math.max(0, instantOf(end, ctx) - instantOf(start, ctx));
  } else if (du) {
    const d = parseDuration(du.value);
    if (d && !start.time) durDays = Math.max(1, d.days + Math.floor(d.ms / DAY_MS));
    else if (d) {
      // Nominal days follow wall-clock time (RFC 5545 3.3.6); hours, minutes and seconds are exact.
      const s = instantOf(start, ctx);
      const dayShifted = d.days ? instantOf({ ...start, date: addDays(start.date, d.days) }, ctx) : s;
      durMs = Math.max(0, dayShifted - s + d.ms);
    }
  }
  return {
    uid: (first(ev, 'UID')?.value || '').trim() || null,
    status: (first(ev, 'STATUS')?.value || '').trim().toUpperCase(),
    title: busyOnly ? null : unescapeText(first(ev, 'SUMMARY')?.value || ''),
    location: busyOnly ? null : unescapeText(first(ev, 'LOCATION')?.value || ''),
    busy_only: busyOnly ? 1 : 0,
    shows_as: transp === 'TRANSPARENT' ? 'free' : 'busy',
    start,
    durDays,
    durMs,
  };
}

function occurrence(base, dv, ctx, recurring) {
  const allDay = !dv.time;
  let startMs;
  let endMs;
  let startOn = null;
  let endOn = null;
  if (allDay) {
    startOn = dv.date;
    endOn = addDays(dv.date, base.durDays);
    startMs = instantOf({ date: startOn }, ctx);
    endMs = instantOf({ date: endOn }, ctx);
  } else {
    startMs = instantOf(dv, ctx);
    endMs = startMs + base.durMs;
  }
  return {
    uid: base.uid,
    key: allDay ? `D:${dv.date}` : `T:${startMs}`,
    title: base.title,
    location: base.location,
    all_day: allDay ? 1 : 0,
    start_at: allDay ? null : new Date(startMs).toISOString(),
    end_at: allDay ? null : new Date(endMs).toISOString(),
    start_on: startOn,
    end_on: endOn,
    time_zone: allDay ? null : dv.tz,
    busy_only: base.busy_only,
    shows_as: base.shows_as,
    recurring: recurring ? 1 : 0,
    start_ms: startMs,
    end_ms: endMs,
  };
}

function inWindow(o, fromMs, toMs) {
  if (o.end_ms === o.start_ms) return o.start_ms >= fromMs && o.start_ms < toMs;
  return o.start_ms < toMs && o.end_ms > fromMs;
}

function untilCheck(rule, base, ctx) {
  if (!rule.until) return () => true;
  const u = parseDateValue(rule.until, {}, ctx);
  if (!u) return () => true;
  if (!u.time || !base.start.time) return (dv) => dv.date <= u.date;
  // A floating UNTIL on a zoned event is read in the event's zone.
  const untilMs = instantOf(/Z$/.test(rule.until) ? u : { ...u, tz: base.start.tz }, ctx);
  return (dv) => instantOf(dv, ctx) <= untilMs;
}

function expandMaster(ev, base, ctx, out, overriddenKeys) {
  const rrule = first(ev, 'RRULE');
  if (!rrule) {
    out.push(occurrence(base, base.start, ctx, false));
    return;
  }
  const rule = parseRrule(rrule.value);
  const excluded = new Set();
  const excludedDates = new Set();
  for (const p of ev.EXDATE || []) {
    for (const v of p.value.split(',')) {
      const dv = parseDateValue(v, p.params, ctx);
      if (!dv) continue;
      if (!dv.time && base.start.time) excludedDates.add(dv.date);
      else excluded.add(keyOf(dv, ctx));
    }
  }
  const keep = (dv) => {
    const key = keyOf(dv, ctx);
    return !excluded.has(key) && !excludedDates.has(dv.date) && !overriddenKeys.has(key);
  };
  if (rule.unsupported) {
    ctx.stats.unsupported_rules++;
    if (keep(base.start)) out.push(occurrence(base, base.start, ctx, true));
    return;
  }
  const withinUntil = untilCheck(rule, base, ctx);
  const startDate = base.start.date;
  const windowStartDate = msDate(ctx.fromMs - base.durMs - (base.durDays + 2) * DAY_MS);
  const windowEndDate = msDate(ctx.toMs + 2 * DAY_MS);
  let produced = 0;
  const k0 = rule.count ? 0 : firstPeriod(rule, startDate, windowStartDate);
  const emit = (date) => {
    const dv = { ...base.start, date };
    if (!withinUntil(dv)) return false;
    produced++;
    if (keep(dv)) {
      const o = occurrence(base, dv, ctx, true);
      if (inWindow(o, ctx.fromMs, ctx.toMs)) out.push(o);
    }
    return true;
  };
  // DTSTART is always the first occurrence (RFC 5545 3.8.5.3).
  if (k0 === 0 && !emit(startDate)) return;
  for (let k = k0, walked = 0; ; k++, walked++) {
    if (walked >= MAX_PERIODS || out.length >= MAX_COLLECT) {
      ctx.stats.truncated = true;
      return;
    }
    const dates = periodDates(rule, startDate, k);
    if (dates.length && dates[0] > windowEndDate) return;
    for (const date of dates) {
      if (date <= startDate) continue;
      if (date > windowEndDate) return;
      if (rule.count && produced >= rule.count) return;
      if (!emit(date)) return;
    }
    if (rule.count && produced >= rule.count) return;
  }
}

/**
 * Parses ICS text and returns the occurrences that overlap [fromMs, toMs), sorted by start, at most
 * MAX_EVENTS. Throws IcsError('too_large' | 'not_ics').
 * @returns {{ events: object[], stats: { vevents, cancelled, unsupported_rules, tz_fallbacks, truncated } }}
 */
export function parseIcs(text, { fromMs, toMs, defaultTimeZone = 'America/New_York' } = {}) {
  if (typeof text !== 'string') throw new IcsError('not_ics', 'Calendar text is missing');
  if (text.length > MAX_ICS_BYTES || new TextEncoder().encode(text).length > MAX_ICS_BYTES) {
    throw new IcsError('too_large', 'The calendar file is larger than 2 MB');
  }
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) throw new RangeError('a valid window is required');
  const { events: raw, cal } = readComponents(unfold(text));
  const viewTz = validTz(defaultTimeZone) ? defaultTimeZone : 'UTC';
  const stats = { vevents: raw.length, cancelled: 0, unsupported_rules: 0, tz_fallbacks: 0, truncated: false };
  const floatingTz = cal.tz && validTz(cal.tz) ? cal.tz : viewTz;
  const ctx = {
    floatingTz, viewTz, stats, fromMs, toMs, memo: new Map(),
    windowStartDate: msDate(fromMs - 2 * DAY_MS),
    windowEndDate: msDate(toMs + 2 * DAY_MS),
  };

  // Masters first; RECURRENCE-ID instances replace the matching occurrence of their master.
  const overrides = new Map(); // uid -> [{ ev, base, key }]
  const masters = [];
  for (const ev of raw) {
    if (clearlyOutside(ev, ctx)) continue;
    const rid = first(ev, 'RECURRENCE-ID');
    let base;
    try {
      base = eventBase(ev, ctx);
    } catch {
      base = null; // a date the zone cannot represent: skip the event, never the file
    }
    if (!base) continue;
    if (rid) {
      const dv = parseDateValue(rid.value, rid.params, ctx);
      if (dv && base.uid) {
        if (!overrides.has(base.uid)) overrides.set(base.uid, []);
        overrides.get(base.uid).push({ base, key: keyOf(dv, ctx) });
        continue;
      }
    }
    masters.push({ ev, base });
  }

  const out = [];
  const cancelledSeries = new Set();
  for (const { ev, base } of masters) {
    if (base.status === 'CANCELLED') {
      stats.cancelled++;
      if (base.uid) cancelledSeries.add(base.uid);
      continue;
    }
    const ov = (base.uid && overrides.get(base.uid)) || [];
    try {
      expandMaster(ev, base, ctx, out, new Set(ov.map((o) => o.key)));
    } catch {
      // one malformed event never sinks the whole calendar
    }
  }
  // Overrides stand on their own (one may move an occurrence into or out of the window). An override
  // without a master in this file is shown as a single event.
  for (const [uid, list] of overrides) {
    for (const { base } of list) {
      if (base.status === 'CANCELLED' || cancelledSeries.has(uid)) {
        stats.cancelled++;
        continue;
      }
      try {
        const o = occurrence(base, base.start, ctx, true);
        if (inWindow(o, fromMs, toMs)) out.push(o);
      } catch {
        // skip
      }
    }
  }

  out.sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
  if (out.length > MAX_EVENTS) stats.truncated = true;
  return { events: out.slice(0, MAX_EVENTS), stats };
}
