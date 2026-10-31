// Deterministic "when" phrase parsing. Pure: no I/O, no clock reads, no logging.
// Zone math goes through src/time.js; calendar arithmetic on YYYY-MM-DD strings is local here.
//
// parseWhen(phrase, { now, timeZone }) ->
//   { kind: 'date', on, needsTimeCheck: false, original }
//   { kind: 'datetime', on, time, needsTimeCheck, original }
//   { kind: 'none', needsTimeCheck: false, original }
//
// Resolution rules (all relative to `now` in `timeZone`):
// - today / tomorrow (tmrw, tmr) / tonight (= today, evening 18:00, needsTimeCheck).
// - Bare weekday ("friday", "on friday"): the next occurrence strictly after today.
//   Said on a Thursday, "thursday" means a week from today.
// - "this <weekday>": the occurrence within the next 7 days, today included.
// - "next <weekday>": that weekday in the following Monday-start week. When this differs from the
//   very next occurrence (e.g. "next friday" said on a Thursday), whenNotes() reports
//   'next_weekday_reading' so a reviewer can check it.
// - Month-name and numeric (M/D, US order) dates without a year: this year if on or after today,
//   otherwise next year. A two-digit year ("10/31/26") is ambiguous and gives 'none'.
//   Dates that do not exist (Feb 30) give 'none'.
// - Times: "3pm", "3:30 pm", "3 p.m.", "15:00", "08:00", "noon" are exact (needsTimeCheck false).
//   Ambiguity rule for a bare hour without am/pm ("at 3", "at 3:30", "3:30"):
//     1-6 -> pm (13:00-18:00), 7-11 -> am, 12 -> 12:00 (noon), always needsTimeCheck true.
//   A part of the day settles a bare hour: "at 3 in the afternoon" -> 15:00, "at 8 in the morning"
//   -> 08:00, both needsTimeCheck false. Contradictions ("3am in the afternoon") give 'none'.
// - Parts of the day: morning 08:00, afternoon 13:00, evening 18:00, each needsTimeCheck true.
//   "this morning" etc. mean today.
// - A time with no date: today if that wall time is still ahead of now, otherwise tomorrow.
// - A weekday next to an explicit date must agree with it ("friday oct 30"), otherwise 'none'.
// - Anything left over that is not a connector word (on, at, by, the, in) makes the whole phrase
//   'none', and the original phrase is kept: "next week", "end of day", "around 3", "asap".

import { instantToZonedParts } from './time.js';

const DAY_MS = 86_400_000;

const WEEKDAY_FULL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_ABBR = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };

const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const PART_TIMES = { morning: '08:00', afternoon: '13:00', evening: '18:00' };
const FILLER = new Set(['on', 'at', 'by', 'the', 'in']);

const byLengthDesc = (a, b) => b.length - a.length;
const MONTH_ALT = Object.keys(MONTHS).sort(byLengthDesc).join('|');
const WEEKDAY_ALT_ALL = [...WEEKDAY_FULL, ...Object.keys(WEEKDAY_ABBR)].sort(byLengthDesc).join('|');
const WEEKDAY_ALT_FULL = [...WEEKDAY_FULL].sort(byLengthDesc).join('|');

const NUMERIC_DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d+))?\b/g;
const MONTH_DAY_RE = new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`, 'g');
const DAY_MONTH_RE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})\\b\\.?(?:,?\\s+(\\d{4})\\b)?`, 'g');
const RELATIVE_RE = /\b(today|tonight|tomorrow|tmrw|tmr)\b/g;
const WEEKDAY_ALT_ABBR = Object.keys(WEEKDAY_ABBR).sort(byLengthDesc).join('|');
const WEEKDAY_RE = new RegExp(`\\b(?:(this|next)\\s+)?(${WEEKDAY_ALT_ALL})\\b`, 'g');
// Strict (free text): full names anywhere; an abbreviation only right after on/this/next ("on Mon"), so
// "sat" or "wed" in a sentence is not read as a day.
const WEEKDAY_STRICT_RE = new RegExp(
  `\\b(?:(this|next)\\s+)?(${WEEKDAY_ALT_FULL})\\b|\\b(this|next|on)\\s+(${WEEKDAY_ALT_ABBR})\\b`,
  'g',
);
// Words that make a bare M/D in free text a date ("by 10/31"). Without one, "12/2" is likely a wire size.
const NUMERIC_DATE_LEAD = new Set(['on', 'by', 'due', 'until', 'before', 'for']);
const TRADE_DENOMINATORS = new Set([2, 4, 8, 16]);
const AMPM_RE = /\b(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\b\.?/g;
const NOON_RE = /\bnoon\b/g;
const COLON_RE = /\b(\d{1,2}):([0-5]\d)\b/g;
const AT_HOUR_RE = /\bat\s+(\d{1,2})\b(?![:/])/g;
const PART_RE = /\b(?:(in\s+the|this)\s+)?(morning|afternoon|evening)\b/g;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymd(year, month, day) {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

// Returns 'YYYY-MM-DD' if the calendar date exists, else null.
function validDate(year, month, day) {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return ymd(year, month, day);
}

function dateToUtcMs(on) {
  const [y, m, d] = on.split('-').map(Number);
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  return t.getTime();
}

export function addDaysOn(on, n) {
  const t = new Date(dateToUtcMs(on) + n * DAY_MS);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function weekdayOf(on) {
  return new Date(dateToUtcMs(on)).getUTCDay();
}

function weekdayIndex(word) {
  const full = WEEKDAY_FULL.indexOf(word);
  return full >= 0 ? full : Object.hasOwn(WEEKDAY_ABBR, word) ? WEEKDAY_ABBR[word] : undefined;
}

// Remove the single match of `re` from the working string. Two or more matches make the phrase
// ambiguous (state.bad). Matched text is replaced by spaces so word boundaries survive.
function take(state, re) {
  if (state.bad) return null;
  const matches = [...state.w.matchAll(re)];
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    state.bad = true;
    return null;
  }
  const m = matches[0];
  state.w = state.w.slice(0, m.index) + ' '.repeat(m[0].length) + state.w.slice(m.index + m[0].length);
  return m;
}

function hourValue(raw) {
  return Number(raw);
}

// Core parser. Returns null for anything it cannot read unambiguously.
// strict: free-text mode (findWhen). prevWord: the source word just before the phrase, lowercased.
function parseCore(phrase, now, timeZone, strict, prevWord = '') {
  if (typeof phrase !== 'string') return null;
  const w = phrase
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.!?()"']+|[\s,;:.!?()"']+$/g, '');
  if (w === '') return null;
  const st = { w, bad: false };

  let explicitDate = null; // { month, day, year|null }
  let relative = null; // 'today' | 'tomorrow'
  let weekday = null; // { dow, qualifier }
  let time = null; // { hour, minute, bare }
  let part = null; // 'morning' | 'afternoon' | 'evening'
  let thisPart = false;

  let m = take(st, NUMERIC_DATE_RE);
  if (m) {
    if (m[3] !== undefined && m[3].length !== 4) return null;
    if (strict && m[3] === undefined) {
      // Free text: 1/2, 3/4, 3/8 are conduit and fitting sizes, and 12/2 is a wire size. Without a year a
      // bare M/D counts as a date only after a word like "on" or "by".
      const num = Number(m[1]);
      const den = Number(m[2]);
      if (num < den && TRADE_DENOMINATORS.has(den)) return null;
      const lead = st.w.slice(0, m.index).trim().split(' ').pop().replace(/[^a-z]/g, '') || prevWord;
      if (!NUMERIC_DATE_LEAD.has(lead) && weekdayIndex(lead) === undefined) return null;
    }
    explicitDate = { month: Number(m[1]), day: Number(m[2]), year: m[3] ? Number(m[3]) : null };
  }
  m = take(st, MONTH_DAY_RE);
  if (m) {
    if (explicitDate) return null;
    explicitDate = { month: MONTHS[m[1]], day: Number(m[2]), year: m[3] ? Number(m[3]) : null };
  }
  m = take(st, DAY_MONTH_RE);
  if (m) {
    if (explicitDate) return null;
    explicitDate = { month: MONTHS[m[2]], day: Number(m[1]), year: m[3] ? Number(m[3]) : null };
  }
  m = take(st, RELATIVE_RE);
  if (m) {
    if (m[1] === 'tonight') {
      relative = 'today';
      part = 'evening';
    } else {
      relative = m[1] === 'today' ? 'today' : 'tomorrow';
    }
  }
  m = take(st, strict ? WEEKDAY_STRICT_RE : WEEKDAY_RE);
  if (m) {
    // Strict mode has a second alternative: (this|next|on) + abbreviation in groups 3 and 4.
    const lead = m[1] ?? (m[3] === 'on' ? null : m[3]);
    weekday = { dow: weekdayIndex(m[2] ?? m[4]), qualifier: lead || null };
  }

  // Times: at most one time expression in total.
  let timeCount = 0;
  m = take(st, AMPM_RE);
  if (m) {
    timeCount++;
    const h = hourValue(m[1]);
    if (h < 1 || h > 12) return null;
    time = { hour: (h % 12) + (m[3] === 'p' ? 12 : 0), minute: m[2] ? Number(m[2]) : 0, bare: false };
  }
  m = take(st, NOON_RE);
  if (m) {
    timeCount++;
    time = { hour: 12, minute: 0, bare: false };
  }
  m = take(st, COLON_RE);
  if (m) {
    timeCount++;
    const h = hourValue(m[1]);
    if (h > 23) return null;
    const explicit24 = h === 0 || h >= 13 || m[1].length === 2 && m[1][0] === '0';
    time = { hour: h, minute: Number(m[2]), bare: !explicit24 };
  }
  m = take(st, AT_HOUR_RE);
  if (m) {
    timeCount++;
    const h = hourValue(m[1]);
    if (h < 1 || h > 23) return null;
    time = { hour: h, minute: 0, bare: h <= 12 };
  }
  if (timeCount > 1) return null;

  m = take(st, PART_RE);
  if (m) {
    if (part) return null; // "tonight" plus another part of the day
    part = m[2];
    if (m[1] === 'this') thisPart = true;
  }

  if (st.bad) return null;

  // Leftovers must be connector words only.
  const leftover = st.w.replace(/,/g, ' ').split(' ').filter(Boolean);
  if (leftover.some((x) => !FILLER.has(x))) return null;

  if (thisPart) {
    if (explicitDate || relative || weekday) return null;
    relative = 'today';
  }
  if (explicitDate && relative) return null;

  const hasDate = Boolean(explicitDate || relative || weekday);
  const hasTime = Boolean(time || part);
  if (!hasDate && !hasTime) return null;

  const nowParts = instantToZonedParts(now, timeZone);
  const todayOn = nowParts.date;
  const todayDow = weekdayOf(todayOn);
  const notes = [];

  let on = null;
  if (explicitDate) {
    const year = explicitDate.year ?? Number(todayOn.slice(0, 4));
    on = validDate(year, explicitDate.month, explicitDate.day);
    if (!on) return null;
    if (explicitDate.year === null && on < todayOn) {
      on = validDate(year + 1, explicitDate.month, explicitDate.day);
      if (!on) return null;
    }
  }
  if (relative) on = relative === 'today' ? todayOn : addDaysOn(todayOn, 1);
  if (weekday) {
    if (on) {
      if (weekdayOf(on) !== weekday.dow) return null;
    } else {
      const coming = (weekday.dow - todayDow + 7) % 7 || 7;
      let delta;
      if (weekday.qualifier === 'this') {
        delta = (weekday.dow - todayDow + 7) % 7;
      } else if (weekday.qualifier === 'next') {
        const isoToday = todayDow === 0 ? 7 : todayDow;
        const isoTarget = weekday.dow === 0 ? 7 : weekday.dow;
        delta = 8 - isoToday + (isoTarget - 1);
        if (delta !== coming) notes.push('next_weekday_reading');
      } else {
        delta = coming;
      }
      on = addDaysOn(todayOn, delta);
    }
  }

  let hhmm = null;
  let needsTimeCheck = false;
  if (time && part) {
    let h = time.hour;
    if (time.bare) {
      if (part === 'morning') {
        if (h === 12) return null;
      } else if (h < 12) {
        h += 12;
      }
    } else if (part === 'morning' ? h >= 12 : h < 12) {
      return null;
    }
    hhmm = `${pad2(h)}:${pad2(time.minute)}`;
  } else if (time) {
    let h = time.hour;
    if (time.bare) {
      if (h >= 1 && h <= 6) h += 12;
      needsTimeCheck = true;
    }
    hhmm = `${pad2(h)}:${pad2(time.minute)}`;
  } else if (part) {
    hhmm = PART_TIMES[part];
    needsTimeCheck = true;
  }

  if (hhmm && !on) on = hhmm > nowParts.time ? todayOn : addDaysOn(todayOn, 1);

  return { on, time: hhmm, needsTimeCheck, hasDate, hasTime, notes };
}

function assertOptions(opts, fnName) {
  if (opts === null || typeof opts !== 'object') throw new TypeError(`${fnName} expects { now, timeZone }`);
  if (typeof opts.now !== 'number' || !Number.isFinite(opts.now)) {
    throw new TypeError(`${fnName}: now must be a finite number of milliseconds`);
  }
  if (typeof opts.timeZone !== 'string' || opts.timeZone === '') {
    throw new TypeError(`${fnName}: timeZone must be an IANA zone name`);
  }
}

function toResult(core, original) {
  if (!core) return { kind: 'none', needsTimeCheck: false, original };
  if (core.time) {
    return { kind: 'datetime', on: core.on, time: core.time, needsTimeCheck: core.needsTimeCheck, original };
  }
  return { kind: 'date', on: core.on, needsTimeCheck: false, original };
}

/**
 * Parse a when-phrase. See the header for the rules.
 * @param {string} phrase
 * @param {{ now: number, timeZone: string }} opts
 */
export function parseWhen(phrase, opts) {
  assertOptions(opts, 'parseWhen');
  return toResult(parseCore(phrase, opts.now, opts.timeZone, false), phrase);
}

/**
 * parseWhen plus which parts the phrase stated and review notes.
 * @returns {{ result, hasDate: boolean, hasTime: boolean, notes: string[] }}
 */
export function parseWhenDetail(phrase, opts) {
  assertOptions(opts, 'parseWhenDetail');
  const core = parseCore(phrase, opts.now, opts.timeZone, false);
  return {
    result: toResult(core, phrase),
    hasDate: core ? core.hasDate : false,
    hasTime: core ? core.hasTime : false,
    notes: core ? core.notes : [],
  };
}

/** Review notes for a phrase, e.g. ['next_weekday_reading']. Empty when none apply. */
export function whenNotes(phrase, opts) {
  return parseWhenDetail(phrase, opts).notes;
}

const SPAN_LEAD_PUNCT = /^[("'[‘“]+/;
const SPAN_TRAIL_PUNCT = /[,;:.!?)"'\]’”]+$/;
const MAX_SPAN_WORDS = 6;

/**
 * Find the longest when-phrase inside free text. Strict mode: full weekday names, or an abbreviation
 * right after on/this/next ("on Mon"), so words like "sat" or "wed" in a sentence are not read as days;
 * a bare M/D needs a lead word (on, by, due, until, before, for) and trade sizes (1/2, 3/4) are never
 * dates, so "pull 12/2 at 3" reads only "at 3". Ties go to the latest span, since a when-phrase
 * usually ends the clause ("order 3 spools of 12/2 by 10/31" -> "by 10/31").
 * @returns {null | { start: number, end: number, phrase: string, when, hasDate, hasTime, notes }}
 */
export function findWhen(text, opts) {
  assertOptions(opts, 'findWhen');
  if (typeof text !== 'string') return null;
  const tokens = [...text.matchAll(/\S+/g)].map((m) => ({ s: m.index, e: m.index + m[0].length }));
  let best = null;
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i; j < Math.min(tokens.length, i + MAX_SPAN_WORDS); j++) {
      let s = tokens[i].s;
      let e = tokens[j].e;
      const raw = text.slice(s, e);
      s += raw.match(SPAN_LEAD_PUNCT)?.[0].length ?? 0;
      e -= raw.match(SPAN_TRAIL_PUNCT)?.[0].length ?? 0;
      if (e <= s) continue;
      const phrase = text.slice(s, e);
      const words = phrase.toLowerCase().split(/\s+/);
      if (FILLER.has(words[words.length - 1].replace(/,$/, '')) || words[0] === 'the') continue;
      const prevWord = (text.slice(0, s).match(/([A-Za-z]+)\W*$/) || [null, ''])[1].toLowerCase();
      const core = parseCore(phrase, opts.now, opts.timeZone, true, prevWord);
      if (!core) continue;
      const count = j - i + 1;
      if (!best || count >= best.count) {
        best = { count, start: s, end: e, phrase, core };
      }
    }
  }
  if (!best) return null;
  return {
    start: best.start,
    end: best.end,
    phrase: best.phrase,
    when: toResult(best.core, best.phrase),
    hasDate: best.core.hasDate,
    hasTime: best.core.hasTime,
    notes: best.core.notes,
  };
}
