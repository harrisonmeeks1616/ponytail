// Deterministic interpretation of a capture into review proposals. Pure: no I/O, no clock reads,
// no logging. A model-backed interpreter can implement the same interpret(text, { now, timeZone })
// signature later.
//
// Output: { proposals: [{ ordinal, kind, title, fields, sourceQuote, needsReview }] }
// - ordinal: 1-based, in sentence order.
// - sourceQuote: the exact sentence from the capture (a substring of `text`).
// - title: always taken verbatim from the sentence (words may be dropped, never added, never
//   re-cased), so it cannot contain a number, name or status word that the sentence lacks. The one
//   exception is a task corrected by the next sentence ("Order 12 sheets for Friday. Actually make that
//   14, and Thursday not Friday."): its title takes the corrected words from that sentence, and
//   fields.replaced / fields.correctionQuote keep what was replaced and the correction itself.
// - A sentence starting with an action verb ("Order ...", "Call ...") is his task. A possibility of his
//   own ("Maybe we should ...", "I might ...") is an idea with claim status 'proposed', never a task and
//   never confirmed. A reported promise ("Mike said he'd send it by Tuesday") is a confirmed Waiting item
//   with who and promisedOn.
//
// fields by kind (every string value is a verbatim substring of sourceQuote, except `when`,
// which is a parseWhen result whose `original` is verbatim):
//   waiting:   { who: string|null, claim: { by: string|null, status }, when?, promisedOn? }
//              promisedOn is set only when the sentence's claim status is 'confirmed' and the sentence
//              states a date (a time alone, "at 7", never makes a promise date).
//   reminder:  { when, relatedOrdinal?, replaced?, correctionQuote? }
//   task:      { claim?: { by, status: 'requested' }, nextStep?, when? }
//              `when` on a task is a date mentioned in the sentence, for review; it is not a due date.
//   reference: { url? }
//   idea:      {}
//   decision:  { reason? }
//
// needsReview reason codes:
//   time_check            the time came from a part of the day or a bare hour (needsTimeCheck)
//   no_time               a reminder has a date but no time
//   when_unclear          a reminder's when-phrase could not be read, its title still holds a day or
//                         month word that was not read ("call Jeff Fri"), or a correction could not be read
//   when_not_stated       a reminder has no when-phrase at all
//   when_in_past          the resolved when is before now
//   next_weekday_reading  "next <weekday>" has two common readings here
//   check_date            a task or waiting sentence mentions a date
//   who_not_stated        a waiting item does not say who from
//   check_who             a "<Word> wants/needs" sentence starts with a capitalised word that may not be a person
//   status_unclear        status words conflict or are negated, so the claim is 'unspecified'
//   corrected             a later "actually/no, <when>" replaced the reminder's when
//   time_kept_from_earlier / date_kept_from_earlier   a correction restated only the date / only the time

import { parseWhenDetail, findWhen, addDaysOn } from './dates.js';
import { instantToZonedParts, zonedWallTimeToInstant } from './time.js';

const ABBREVIATIONS = new Set([
  'a.m', 'p.m', 'e.g', 'i.e', 'mr', 'mrs', 'ms', 'dr', 'st', 'vs', 'approx', 'est',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

// Capitalised words that are not names when they lead a "<Name> asked/said ..." sentence.
const NOT_NAMES = new Set([
  'i', 'we', 'he', 'she', 'they', 'it', 'you', 'the', 'a', 'an', 'this', 'that', 'these', 'those',
  'then', 'so', 'and', 'but', 'also', 'actually', 'today', 'tomorrow', 'tonight', 'yesterday',
  'maybe', 'just', 'still', 'now', 'waiting', 'remind', 'please', 'if', 'when', 'after', 'before',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'my', 'our', 'his',
  'her', 'their', 'someone', 'everyone', 'nobody', 'no', 'yes', 'ok', 'okay', 'note', 'fyi',
]);

const STATUS_WORDS = new Map([
  ['asked', 'requested'],
  ['requested', 'requested'],
  ['proposed', 'proposed'],
  ['suggested', 'proposed'],
  ['maybe', 'proposed'],
  ['might', 'proposed'],
  ['confirmed', 'confirmed'],
  ['agreed', 'confirmed'],
  ['promised', 'confirmed'],
  ['done', 'reported_complete'],
  ['finished', 'reported_complete'],
  ['completed', 'reported_complete'],
  ['installed', 'reported_complete'],
  ['verified', 'verified'],
  ['inspected', 'verified'],
]);

const NEGATION = new Set([
  'not', 'never', 'no', "didn't", "hasn't", "haven't", "hadn't", "isn't", "wasn't", "weren't",
  "aren't", "won't", "can't", 'cannot', "couldn't", "doesn't", "don't", "wouldn't", "shouldn't",
  'didnt', 'hasnt', 'havent', 'isnt', 'wasnt', 'wont', 'cant', 'doesnt', 'dont',
]);

// Words that make a following completion word future or conditional ("will be done", "to get it done").
const NOT_YET_CONTEXT = new Set([
  'be', 'to', 'will', 'should', 'can', 'could', 'must', 'once', 'until', 'when', 'if', 'would', 'get', 'gets',
]);

const NAME_WORD = "[A-Z][A-Za-z'’-]*";
const NAME = `(?:\\[[^\\]\\n]+\\]|${NAME_WORD}(?:\\s+${NAME_WORD})?)`;
const REQUEST_RE = new RegExp(
  `(?<![A-Za-z'’-])(${NAME})\\s+(asked(?:\\s+me)?\\s+(?:for|to)|requested|wants(?!\\s+to\\b)|needs(?!\\s+to\\b))\\s+(.+)$`,
  'y',
);
const STATEMENT_RE = new RegExp(
  `(?<![A-Za-z'’-])(${NAME})\\s+(said|says|told\\s+me|confirmed|agreed|proposed|suggested|promised|will|might|thinks)\\s+(.+)$`,
  'y',
);
const WAITING_RE = /\bwaiting\s+(?:on|for)\s+(.+)$/i;
const WAITING_NAMED_RE = new RegExp(`^(${NAME})\\s+(?:for|to)\\s+(.+)$`);
const REMIND_TO_RE = /\bremind\s+me\s+to\s+(.+)$/i;
const REMIND_WHEN_TO_RE = /\bremind\s+me\s+(.+?)\s+to\s+(.+)$/i;
const REMIND_ANY_RE = /\bremind\s+me\b\s*(.*)$/i;
const TODO_RE = /(?<![A-Za-z])(need\s+to|have\s+to|has\s+to|must|todo:|to-do:|to\s+do:|to\s+do)\s+(.+)$/i;
const IDEA_RE = /\bidea:\s*(.+)$/i;
const DECISION_COLON_RE = /\bdecision:\s*(.+)$/i;
const DECIDED_RE = /\bdecided\b\s*(.*)$/i;
const URL_RE = /https?:\/\/[^\s<>"]+/i;
const LOOKUP_RE = /\blook\s+up\s+(.+)$/i;
const REFERENCE_RE = /\b(?:reference|spec|specs)\b/i;
const CORRECTION_RE = /^\s*(?:actually|no)\b\s*[,:]?\s*(?:make\s+it\s+|it's\s+|it\s+is\s+)?(.+?)[\s.!?]*$/i;
const FOLLOW_UP_ONLY_RE = /^follow[\s-]?up(?:\s+on\s+(?:it|that|this))?$/i;
// A sentence that starts with an action verb is his own task ("Order 12 sheets of drywall for Friday").
const IMPERATIVE_RE =
  /^(?:please\s+)?(?:order|call|email|text|send|buy|book|schedule|pay|fix|submit|return|print|renew|mail|ship|install|replace|finish|prepare|draft|pick\s+up|drop\s+off)\b\s+\S/i;
// A possibility of his own is an idea, never a commitment: "Maybe we should repaint the shop someday",
// "I might call the inspector". (Someone else's "might" is a statement, read as Waiting.)
const POSSIBILITY_RE = /^(?:(maybe|perhaps)\s*,?\s+)?(?:i|we)\s+(should|could|might|may|can|ought\s+to)\s+(.+)$/i;
// "Actually make that 14, and Thursday not Friday": a correction of the task just before it.
const TASK_CORRECTION_RE = /^\s*(?:actually|no|sorry|correction)\b\s*[,:]?\s*(.+?)[\s.!?]*$/i;
// Day and month words that, left in a reminder's title, mean the date was not read from them.
const UNREAD_DAY_RE = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const UNREAD_DAY_ABBR_RE =
  /\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun|January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/;

function stripTrail(s) {
  return s.replace(/[\s.,;:!?]+$/, '');
}

function stripLeadArticle(s) {
  return s.replace(/^(?:the|a|an)\s+/i, '');
}

// The first clause: up to a comma, semicolon or spaced dash.
function firstClause(s) {
  return s.split(/\s*(?:[,;]|\s[-–—]\s)\s*/)[0];
}

function unique(list) {
  return [...new Set(list)];
}

function cleanName(raw) {
  if (raw.startsWith('[')) return raw;
  const words = raw.split(/\s+/);
  while (words.length && NOT_NAMES.has(words[0].toLowerCase())) words.shift();
  if (words.length && NOT_NAMES.has(words[words.length - 1].toLowerCase())) return null;
  return words.length ? words.join(' ') : null;
}

function lowerWords(s) {
  return s.toLowerCase().replace(/’/g, "'").match(/[a-z']+/g) || [];
}

/**
 * Claim status from verbs in a sentence. Distinct statuses or a negated status word give
 * 'unspecified' with unclear=true. No status word gives 'unspecified' with unclear=false.
 */
export function claimStatus(sentence) {
  const words = lowerWords(sentence);
  const found = new Set();
  let negated = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let status = STATUS_WORDS.get(w);
    // Reported promise: "Mike said he'd send it" is Mike's commitment, like "Mike will send it".
    const reported = /^(?:he|she|they|we|i)'d$/.test(w) && ['said', 'says', 'promised', 'me'].includes(words[i - 1]);
    if (!status && (w === 'will' || /^[a-z]+'ll$/.test(w) || reported)) {
      const next = words[i + 1];
      if (!next) continue;
      if (NEGATION.has(next)) {
        negated = true;
        continue;
      }
      status = 'confirmed';
    }
    if (!status) continue;
    if ((status === 'reported_complete' || status === 'verified') &&
        [words[i - 1], words[i - 2], words[i - 3]].some((x) => x !== undefined && NOT_YET_CONTEXT.has(x))) {
      continue;
    }
    if ([words[i - 1], words[i - 2]].some((x) => x !== undefined && NEGATION.has(x))) {
      negated = true;
      continue;
    }
    found.add(status);
  }
  if (negated || found.size > 1) return { status: 'unspecified', unclear: true };
  if (found.size === 1) return { status: [...found][0], unclear: false };
  return { status: 'unspecified', unclear: false };
}

/** Split text into trimmed sentences; each is an exact substring of `text`. */
export function splitSentences(text) {
  const out = [];
  const push = (s) => {
    const t = s.trim();
    if (t && /[A-Za-z0-9]/.test(t)) out.push(t);
  };
  for (const line of text.split(/\r?\n/)) {
    let start = 0;
    for (const m of line.matchAll(/[.!?]+(?=\s|$)/g)) {
      const before = line.slice(start, m.index);
      const lastWord = (before.match(/(\S+)$/) || [null, ''])[1].replace(/^[("'[]+/, '').toLowerCase();
      if (m[0] === '.' && ABBREVIATIONS.has(lastWord)) continue;
      const end = m.index + m[0].length;
      push(line.slice(start, end));
      start = end;
    }
    push(line.slice(start));
  }
  return out;
}

function whenReasons(when, notes, ctx) {
  const reasons = [];
  if (when.kind === 'none') {
    reasons.push(when.original ? 'when_unclear' : 'when_not_stated');
    return reasons;
  }
  if (when.kind === 'date') reasons.push('no_time');
  if (when.needsTimeCheck) reasons.push('time_check');
  for (const n of notes) reasons.push(n);
  if (when.kind === 'datetime') {
    const { instantMs } = zonedWallTimeToInstant({ date: when.on, time: when.time, timeZone: ctx.timeZone });
    if (instantMs <= ctx.now) reasons.push('when_in_past');
  } else if (when.on < ctx.todayOn) {
    reasons.push('when_in_past');
  }
  return reasons;
}

// Returns the whole findWhen result (or null). Callers that store a date must check found.hasDate:
// a time-only phrase ("at 7") gets its day from the today-or-tomorrow rule, not from the sentence.
function mentionedWhen(sentence, ctx, fields, reasons) {
  const found = findWhen(sentence, ctx);
  if (!found) return null;
  fields.when = found.when;
  reasons.push('check_date', ...found.notes);
  return found;
}

// A promise date is stored only when the sentence states a date and the claim is confirmed.
function promisedOnFrom(found, status) {
  return found && found.hasDate && status === 'confirmed' ? found.when.on : null;
}

function idea(s) {
  const m = s.match(IDEA_RE);
  if (m) return { kind: 'idea', title: stripTrail(m[1]), fields: {}, needsReview: [] };
  const p = s.match(POSSIBILITY_RE);
  // "We should order wire" without maybe/perhaps is left to the other rules; might/may/could always count.
  if (!p || (!p[1] && !/^(?:might|may|could)$/i.test(p[2]))) return null;
  const title = stripTrail(p[3]);
  if (!title) return null;
  // Never confirmed: a stated possibility is 'proposed' (by him), and stays that way until he edits it.
  return { kind: 'idea', title, fields: { claim: { by: null, status: 'proposed' } }, needsReview: [] };
}

function imperative(s, ctx) {
  if (!IMPERATIVE_RE.test(s)) return null;
  const title = stripTrail(s);
  const fields = {};
  const reasons = [];
  mentionedWhen(s, ctx, fields, reasons);
  return { kind: 'task', title, fields, needsReview: reasons };
}

// Reads a task correction into edits, or null when any part of it cannot be read (then nothing is applied).
function taskCorrectionEdits(s, ctx) {
  const m = s.match(TASK_CORRECTION_RE);
  if (!m) return null;
  const edits = [];
  for (let clause of m[1].split(/\s*,\s*(?:and\s+)?|\s+and\s+/i).filter(Boolean)) {
    clause = clause.replace(/^(?:make\s+(?:that|it)|change\s+(?:that|it)\s+to|it'?s|it\s+is)\s+/i, '');
    let old = null;
    const not = clause.match(/^(.+?)\s+(?:not|instead\s+of)\s+(.+)$/i);
    if (not) [, clause, old] = not;
    if (/^\d+(?:\.\d+)?$/.test(clause)) {
      edits.push({ type: 'number', value: clause, old });
      continue;
    }
    const detail = parseWhenDetail(clause, ctx);
    if (detail.result.kind === 'none') return null;
    edits.push({ type: 'when', value: clause, old, detail });
  }
  return edits.length ? edits : null;
}

function escapeRe(t) {
  return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Applies a correction to the task proposal: the title takes the corrected words, the when the corrected
// date; the replaced values and the correction sentence are kept in fields. Returns false if it cannot apply.
function applyTaskCorrection(task, edits, sentence) {
  let title = task.title;
  const prevWhen = task.fields.when;
  let when = prevWhen;
  const notes = [];
  for (const e of edits) {
    if (e.type === 'number') {
      // Without "not N" the title must hold exactly one plain quantity ("12 sheets"); sizes like 200A,
      // 12/2 or times like 3:30 are never guessed at.
      const re = new RegExp(`(?<![\\w.:/])${e.old ? escapeRe(e.old) : '\\d+(?:\\.\\d+)?'}(?![\\w.:/])`, 'g');
      const hits = title.match(re) || [];
      if (hits.length !== 1) return false;
      title = title.replace(re, e.value);
    } else {
      const was = e.old || (prevWhen && prevWhen.original);
      if (was) title = title.replace(new RegExp(`\\b${escapeRe(was)}\\b`, 'i'), e.value);
      when = e.detail.result;
      notes.push(...e.detail.notes);
    }
  }
  task.fields = { ...task.fields, replaced: { title: task.title, ...(prevWhen ? { when: prevWhen } : {}) }, correctionQuote: sentence };
  if (when) task.fields.when = when;
  task.title = title;
  task.needsReview = unique([...task.needsReview.filter((r) => r !== 'check_date'), ...(when ? ['check_date'] : []), ...notes, 'corrected']);
  return true;
}

function decision(s) {
  let rest = null;
  const colon = s.match(DECISION_COLON_RE);
  if (colon) {
    rest = colon[1];
  } else {
    const m = s.match(DECIDED_RE);
    if (!m) return null;
    const before = lowerWords(s.slice(0, m.index));
    const prev = before.slice(-2);
    if (prev.some((x) => NEGATION.has(x)) || before.at(-1) === 'yet' && before.length >= 2 && NEGATION.has(before.at(-2))) {
      return null; // "haven't decided" is not a decision
    }
    rest = m[1].replace(/^(?:to|that|on|we'll|we\s+will)\s+/i, '');
  }
  const fields = {};
  const because = rest.match(/,?\s+because\s+(.+)$/i);
  if (because) {
    fields.reason = stripTrail(because[1]);
    rest = rest.slice(0, because.index);
  }
  let title = stripTrail(rest);
  if (!title) title = stripTrail(s);
  return { kind: 'decision', title, fields, needsReview: [] };
}

function waiting(s, ctx) {
  const m = s.match(WAITING_RE);
  if (!m) return null;
  const clause = stripTrail(firstClause(m[1]));
  let who = null;
  let what = clause;
  const fromIdx = clause.toLowerCase().lastIndexOf(' from ');
  if (fromIdx > 0) {
    what = clause.slice(0, fromIdx);
    const rawWho = clause.slice(fromIdx + 6).split(/\s+(?:by|on|until|before|after|since|about|regarding|re)\s+/i)[0];
    who = stripTrail(rawWho.trim()) || null;
  } else {
    const named = clause.match(WAITING_NAMED_RE);
    if (named) {
      const name = cleanName(named[1]);
      if (name && named[1] === name) {
        who = name;
        what = named[2];
      }
    }
  }
  const reasons = [];
  const { status, unclear } = claimStatus(s);
  if (unclear) reasons.push('status_unclear');
  if (!who) reasons.push('who_not_stated');
  const fields = { who, claim: { by: null, status } };
  const promisedOn = promisedOnFrom(mentionedWhen(s, ctx, fields, reasons), status);
  if (promisedOn) fields.promisedOn = promisedOn;
  const title = stripLeadArticle(stripTrail(what)) || stripTrail(what) || stripTrail(s);
  return { kind: 'waiting', title, fields, needsReview: reasons };
}

// A day or month word left in a reminder's title was not read, so the date may not be the one he said.
function titleWhenReasons(title) {
  return UNREAD_DAY_RE.test(title) || UNREAD_DAY_ABBR_RE.test(title) ? ['when_unclear'] : [];
}

function reminder(s, ctx, previous) {
  let title;
  let when;
  let notes = [];
  const toForm = s.match(REMIND_TO_RE);
  const whenToForm = toForm ? null : s.match(REMIND_WHEN_TO_RE);
  if (toForm) {
    const what = stripTrail(toForm[1]);
    const found = findWhen(what, ctx);
    if (found) {
      when = found.when;
      notes = found.notes;
      const before = what.slice(0, found.start).replace(/[\s,]+$/, '');
      const after = what.slice(found.end).replace(/^[\s,]+/, '');
      // Keep the title one contiguous piece of the sentence: drop the when-phrase only when it
      // ends (or starts) the clause, otherwise leave the words as written.
      if (!after) title = before.replace(/\s+(?:on|at|by)$/i, '');
      else if (!before) title = after;
      else title = what;
      title = stripTrail(title);
    } else {
      when = { kind: 'none', needsTimeCheck: false, original: '' };
      title = what;
    }
  } else if (whenToForm) {
    const phrase = whenToForm[1];
    const detail = parseWhenDetail(phrase, ctx);
    when = detail.result;
    notes = detail.notes;
    title = stripTrail(whenToForm[2]);
  } else {
    const m = s.match(REMIND_ANY_RE);
    if (!m) return null;
    const rest = stripTrail(m[1]);
    const found = rest ? findWhen(rest, ctx) : null;
    when = found ? found.when : { kind: 'none', needsTimeCheck: false, original: '' };
    notes = found ? found.notes : [];
    title = rest;
  }
  if (!title) title = stripTrail(s);
  const fields = { when };
  const prev = previous.at(-1);
  if (prev && prev.kind === 'waiting' && FOLLOW_UP_ONLY_RE.test(title)) fields.relatedOrdinal = prev.ordinal;
  return { kind: 'reminder', title, fields, needsReview: [...whenReasons(when, notes, ctx), ...titleWhenReasons(title)] };
}

// Try a sticky "<Name> verb ..." regex at every capitalised word start; first real name wins.
function namedMatch(re, s) {
  for (const start of s.matchAll(/(?<![A-Za-z'’-])[A-Z[]/g)) {
    re.lastIndex = start.index;
    const m = s.match(re); // sticky, non-global: matches only at lastIndex
    if (!m) continue;
    const by = cleanName(m[1]);
    if (by) return { m, by };
  }
  return null;
}

function request(s, ctx) {
  const hit = namedMatch(REQUEST_RE, s);
  if (!hit) return null;
  const { m, by } = hit;
  const reasons = [];
  const verb = m[2].toLowerCase();
  const nameAtStart = s.trimStart().startsWith(by);
  if ((verb.startsWith('wants') || verb.startsWith('needs')) && nameAtStart && !by.startsWith('[')) {
    reasons.push('check_who');
  }
  const rest = m[3];
  const title = stripTrail(firstClause(rest)) || stripTrail(rest);
  const fields = { claim: { by, status: 'requested' } };
  const tail = rest.slice(firstClause(rest).length);
  const todo = tail.match(TODO_RE);
  if (todo) fields.nextStep = stripTrail(todo[2]);
  mentionedWhen(s, ctx, fields, reasons);
  return { kind: 'task', title, fields, needsReview: reasons };
}

function statement(s, ctx) {
  const hit = namedMatch(STATEMENT_RE, s);
  if (!hit) return null;
  const { m, by } = hit;
  const { status, unclear } = claimStatus(s);
  const reasons = [];
  const fields = { who: by, claim: { by, status } };
  const found = mentionedWhen(s, ctx, fields, reasons);
  if (!found && status === 'unspecified' && !unclear) return null; // "Jeff said hi"
  if (unclear) reasons.push('status_unclear');
  const promisedOn = promisedOnFrom(found, status);
  if (promisedOn) fields.promisedOn = promisedOn;
  const rest = m[3].replace(/^that\s+/i, '');
  const title = stripTrail(firstClause(rest)) || stripTrail(rest);
  return { kind: 'waiting', title, fields, needsReview: reasons };
}

function todo(s, ctx) {
  const m = s.match(TODO_RE);
  if (!m) return null;
  const before = s.slice(0, m.index);
  const prevWord = (before.match(/(\S+)\s*$/) || [null, ''])[1];
  if (/^[A-Z]/.test(prevWord) && /[A-Za-z]$/.test(prevWord) && !NOT_NAMES.has(prevWord.toLowerCase())) {
    return null; // "Jeff must send it" is someone else's work, not a task for Harrison
  }
  // "They need to send it", "He must ...", "The inspector has to ...": also someone else's work.
  // "has to" is always third person.
  if (/^(?:he|she|they|it)$/i.test(prevWord) || /^has\s+to$/i.test(m[1])) return null;
  const title = stripTrail(m[2]);
  if (!title) return null;
  const fields = {};
  const reasons = [];
  // "You need to ..." or "the crew needs to ...": may not be Harrison's own task.
  if (/^you$/i.test(prevWord) || /\b(?:the|a|an)\s+[a-z]+\s*$/i.test(before)) reasons.push('check_who');
  mentionedWhen(s, ctx, fields, reasons);
  return { kind: 'task', title, fields, needsReview: reasons };
}

function reference(s) {
  const url = s.match(URL_RE);
  if (url) {
    return {
      kind: 'reference',
      title: stripTrail(s),
      fields: { url: url[0].replace(/[.,;:!?)\]]+$/, '') },
      needsReview: [],
    };
  }
  const look = s.match(LOOKUP_RE);
  if (look) return { kind: 'reference', title: stripTrail(look[1]) || stripTrail(s), fields: {}, needsReview: [] };
  if (REFERENCE_RE.test(s)) return { kind: 'reference', title: stripTrail(s), fields: {}, needsReview: [] };
  return null;
}

const RULES = [
  (s) => idea(s),
  (s) => decision(s),
  (s, ctx) => waiting(s, ctx),
  (s, ctx, prev) => reminder(s, ctx, prev),
  (s, ctx) => request(s, ctx),
  (s, ctx) => statement(s, ctx),
  (s, ctx) => todo(s, ctx),
  (s, ctx) => imperative(s, ctx),
  (s) => reference(s),
];

// A correction sentence for the previous reminder: { detail } when its when-phrase reads, { unread: true }
// when it looks like a correction with a number in it that cannot be read, otherwise null.
function correctionOf(s, ctx, lastReminder) {
  const m = s.match(CORRECTION_RE);
  if (!m) return null;
  let detail = parseWhenDetail(m[1], ctx);
  // "Actually 4." after a timed reminder: a bare hour is read as a time ("at 4"), original kept verbatim.
  if (detail.result.kind === 'none' && /^\d{1,2}(?::[0-5]\d)?$/.test(m[1]) && lastReminder.fields.when?.time) {
    detail = parseWhenDetail(`at ${m[1]}`, ctx);
    if (detail.result.kind !== 'none') detail.result.original = m[1];
  }
  if (detail.result.kind !== 'none') return { detail };
  return /\d/.test(m[1]) ? { unread: true } : null;
}

function applyCorrection(rem, detail, sentence, ctx) {
  const prev = rem.fields.when;
  const corr = detail.result;
  const extra = ['corrected'];
  let next = corr;
  if (prev.kind !== 'none' && !(detail.hasDate && detail.hasTime)) {
    if (detail.hasDate && prev.kind === 'datetime') {
      next = { kind: 'datetime', on: corr.on, time: prev.time, needsTimeCheck: prev.needsTimeCheck, original: corr.original };
      extra.push('time_kept_from_earlier');
    } else if (detail.hasTime && !detail.hasDate) {
      next = { kind: 'datetime', on: prev.on, time: corr.time, needsTimeCheck: corr.needsTimeCheck, original: corr.original };
      extra.push('date_kept_from_earlier');
    }
  }
  rem.fields.when = next;
  rem.fields.replaced = prev;
  rem.fields.correctionQuote = sentence;
  rem.needsReview = unique([...whenReasons(next, detail.notes, ctx), ...titleWhenReasons(rem.title), ...extra]);
}

/**
 * Interpret capture text into proposals. Deterministic for a given (text, now, timeZone).
 * @param {string} text
 * @param {{ now: number, timeZone: string }} opts
 */
export function interpret(text, opts) {
  if (opts === null || typeof opts !== 'object') throw new TypeError('interpret expects { now, timeZone }');
  const { now, timeZone } = opts;
  if (typeof now !== 'number' || !Number.isFinite(now)) throw new TypeError('interpret: now must be milliseconds');
  if (typeof timeZone !== 'string' || timeZone === '') throw new TypeError('interpret: timeZone must be an IANA zone');
  const todayOn = instantToZonedParts(now, timeZone).date;
  const ctx = { now, timeZone, todayOn, tomorrowOn: addDaysOn(todayOn, 1) };
  const proposals = [];
  if (typeof text !== 'string' || text.trim() === '') return { proposals };
  let lastReminder = null;
  for (const sentence of splitSentences(text)) {
    // A correction right after a task replaces that task's quantity or date in place: one proposal, the
    // original sentence kept as sourceQuote, no live proposal left holding the old values.
    const last = proposals.at(-1);
    if (last && last.kind === 'task') {
      const edits = taskCorrectionEdits(sentence, ctx);
      if (edits && applyTaskCorrection(last, edits, sentence)) continue;
    }
    if (lastReminder) {
      const corr = correctionOf(sentence, ctx, lastReminder);
      if (corr && corr.detail) {
        applyCorrection(lastReminder, corr.detail, sentence, ctx);
        continue;
      }
      // A correction that could not be read is never dropped silently: the reminder asks for a check.
      if (corr && corr.unread) lastReminder.needsReview = unique([...lastReminder.needsReview, 'when_unclear']);
    }
    for (const rule of RULES) {
      const p = rule(sentence, ctx, proposals);
      if (!p) continue;
      const proposal = {
        ordinal: proposals.length + 1,
        kind: p.kind,
        title: p.title,
        fields: p.fields,
        sourceQuote: sentence,
        needsReview: unique(p.needsReview),
      };
      proposals.push(proposal);
      if (proposal.kind === 'reminder') lastReminder = proposal;
      break;
    }
  }
  return { proposals };
}
