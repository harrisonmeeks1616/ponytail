// IANA wall-clock <-> instant conversion, DST policy and daily recurrence.
// Pure, Intl only, no dependencies. Runs in Node 22 and Cloudflare Workers.
//
// DST policy matches Temporal `disambiguation: 'compatible'`:
// - A wall time inside a spring-forward gap shifts forward by the gap length
//   (02:30 on 2027-03-14 America/New_York becomes 03:30 EDT).
// - A wall time inside a fall-back overlap takes the earlier instant
//   (01:30 on 2026-11-01 America/New_York is 01:30 EDT, 05:30Z).

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

// Supported instant range: 1000-01-02T00:00Z .. 9999-12-30T23:59:59.999Z.
// Keeps Intl year formatting to plain 4-digit years (no eras, no 2-digit year quirks).
const MIN_INSTANT_MS = Date.UTC(1000, 0, 2);
const MAX_INSTANT_MS = Date.UTC(9999, 11, 30, 23, 59, 59, 999);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const partsFormatters = new Map();
const labelFormatters = new Map();

function utcMs(year, month, day, hour = 0, minute = 0, second = 0) {
  // Date.UTC maps years 0..99 to 1900..1999; setUTCFullYear does not.
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, 0);
  return d.getTime();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function assertTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    throw new RangeError('timeZone must be a non-empty IANA time zone string');
  }
  if (partsFormatters.has(timeZone)) return partsFormatters.get(timeZone);
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    throw new RangeError(`Invalid time zone: ${String(timeZone).slice(0, 64)}`);
  }
  partsFormatters.set(timeZone, fmt);
  return fmt;
}

function parseDate(date) {
  const m = typeof date === 'string' ? DATE_RE.exec(date) : null;
  if (!m) throw new RangeError('date must be YYYY-MM-DD');
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1) {
    throw new RangeError('date is out of range');
  }
  const check = new Date(utcMs(year, month, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new RangeError('date does not exist in the calendar');
  }
  return { year, month, day };
}

function parseTime(time) {
  const m = typeof time === 'string' ? TIME_RE.exec(time) : null;
  if (!m) throw new RangeError('time must be HH:MM (24-hour)');
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function assertInstant(ms, name) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    throw new RangeError(`${name} must be a finite number of milliseconds`);
  }
  if (ms < MIN_INSTANT_MS || ms > MAX_INSTANT_MS) {
    throw new RangeError(`${name} is outside the supported range`);
  }
}

function assertArgs(args, fnName) {
  if (args === null || typeof args !== 'object') {
    throw new RangeError(`${fnName} expects an options object`);
  }
}

// Wall-clock fields of an instant in a zone, at second precision.
function zonedFields(ms, fmt) {
  const out = {};
  for (const p of fmt.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  let hour = Number(out.hour);
  if (hour === 24) hour = 0; // defensive: some older engines emit 24 at midnight
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour,
    minute: Number(out.minute),
    second: Number(out.second),
  };
}

// Zone offset (minutes east of UTC) in effect at an instant.
function offsetAt(ms, fmt) {
  const f = zonedFields(ms, fmt);
  const asUtc = utcMs(f.year, f.month, f.day, f.hour, f.minute, f.second);
  const flooredToSecond = ms - (((ms % 1000) + 1000) % 1000);
  return Math.round((asUtc - flooredToSecond) / MINUTE_MS);
}

function resolveWallTime(year, month, day, hour, minute, fmt) {
  const localMs = utcMs(year, month, day, hour, minute);
  // Candidate offsets: in effect a day before, at, and a day after the wall time.
  // Real-world transitions are far more than a day apart, so a valid instant uses one of these.
  const before = offsetAt(localMs - DAY_MS, fmt);
  const offsets = [before, offsetAt(localMs, fmt), offsetAt(localMs + DAY_MS, fmt)];
  const valid = [];
  for (const o of new Set(offsets)) {
    const t = localMs - o * MINUTE_MS;
    if (offsetAt(t, fmt) === o && !valid.includes(t)) valid.push(t);
  }
  if (valid.length === 0) {
    // Gap: interpret with the offset in effect before the transition, which lands the
    // instant after the transition, shifted forward by the gap length ('compatible').
    const instantMs = localMs - before * MINUTE_MS;
    return { instantMs, offsetMinutes: offsetAt(instantMs, fmt), adjustment: 'gap_shifted_forward' };
  }
  valid.sort((a, b) => a - b);
  const instantMs = valid[0];
  return {
    instantMs,
    offsetMinutes: offsetAt(instantMs, fmt),
    adjustment: valid.length > 1 ? 'overlap_earlier' : 'none',
  };
}

function addDays(date, n) {
  const { year, month, day } = parseDate(date);
  const d = new Date(utcMs(year, month, day) + n * DAY_MS);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Wall-clock date and time in an IANA zone -> UTC instant.
 * @returns {{ instantMs: number, offsetMinutes: number, adjustment: 'none'|'gap_shifted_forward'|'overlap_earlier' }}
 */
export function zonedWallTimeToInstant(args) {
  assertArgs(args, 'zonedWallTimeToInstant');
  const { date, time, timeZone } = args;
  const fmt = assertTimeZone(timeZone);
  const { year, month, day } = parseDate(date);
  const { hour, minute } = parseTime(time);
  const result = resolveWallTime(year, month, day, hour, minute, fmt);
  assertInstant(result.instantMs, 'resulting instant');
  return result;
}

/**
 * UTC instant -> wall-clock parts in an IANA zone (minute precision for `time`).
 * @returns {{ date: string, time: string, offsetMinutes: number }}
 */
export function instantToZonedParts(instantMs, timeZone) {
  const fmt = assertTimeZone(timeZone);
  assertInstant(instantMs, 'instantMs');
  const f = zonedFields(instantMs, fmt);
  return {
    date: `${String(f.year).padStart(4, '0')}-${pad2(f.month)}-${pad2(f.day)}`,
    time: `${pad2(f.hour)}:${pad2(f.minute)}`,
    offsetMinutes: offsetAt(instantMs, fmt),
  };
}

/**
 * First occurrence of local wall `time` strictly after `afterMs`. Anchored to wall time:
 * 07:00 stays 07:00 across DST, so the UTC instant moves by the DST shift.
 * @returns {{ instantMs: number, date: string, adjustment: string }}
 */
export function nextDailyOccurrence(args) {
  assertArgs(args, 'nextDailyOccurrence');
  const { time, timeZone, afterMs } = args;
  const fmt = assertTimeZone(timeZone);
  const { hour, minute } = parseTime(time);
  assertInstant(afterMs, 'afterMs');
  const startDate = instantToZonedParts(afterMs, timeZone).date;
  // Start a day early: a gap-shifted occurrence of the previous local date can land after afterMs.
  for (let i = -1; i <= 3; i++) {
    const date = addDays(startDate, i);
    const { year, month, day } = parseDate(date);
    const r = resolveWallTime(year, month, day, hour, minute, fmt);
    if (r.instantMs > afterMs) {
      assertInstant(r.instantMs, 'resulting instant');
      return { instantMs: r.instantMs, date, adjustment: r.adjustment };
    }
  }
  // Unreachable for real zones (one occurrence per local day).
  throw new RangeError('no daily occurrence found');
}

/**
 * Human label in en-US, e.g. 'Sat Oct 31, 7:00 AM EDT'.
 */
export function formatLocal(instantMs, timeZone) {
  assertTimeZone(timeZone);
  assertInstant(instantMs, 'instantMs');
  let fmt = labelFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    });
    labelFormatters.set(timeZone, fmt);
  }
  const p = {};
  for (const part of fmt.formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  // Built from parts so the separators are plain ASCII spaces on every ICU version.
  return `${p.weekday} ${p.month} ${p.day}, ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`;
}
