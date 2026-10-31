// Claim checking for drafts. Pure and deterministic: no I/O, no clock, no model.
//
// extractClaims(text)            -> atomic claims { text, actor, action, quantities, dates, status, conditions, hedges }
// compareClaims(source, draft, { labels }) -> flags [{ type, message, source_quote, draft_quote, source_value?, draft_value? }]
//
// This is a tripwire, not proof. It catches the common ways a rewrite changes meaning (a requested lift
// becoming a confirmed one, 12 sheets becoming 14, Mike's job becoming ours, a dropped "if", a dropped
// "probably", an added promise, a missing or invented fact). It cannot prove a draft true, and a draft with
// no flags can still be wrong. Status words are not a confidence ladder and are never upgraded here: a claim
// with no status cue is 'unspecified'. The status vocabulary is interpret.js's claimStatus (the same words
// the rest of the app uses), plus a few drafting cues it lacks (need, could, propose, suggest).

import { claimStatus, splitSentences } from './interpret.js';

export const FLAG_TYPES = Object.freeze([
  'changed_quantity', 'changed_date', 'changed_actor', 'status_upgraded', 'certainty_removed',
  'commitment_added', 'condition_omitted', 'fact_omitted', 'unsupported_claim',
]);

// Statuses a draft must not reach unless the notes already say so.
const FIRM = new Set(['confirmed', 'reported_complete', 'verified']);
const STATUS_WORDS = {
  requested: 'requested',
  proposed: 'proposed',
  confirmed: 'confirmed',
  reported_complete: 'reported done',
  verified: 'verified',
  unspecified: 'not stated',
};

const EXTRA_CUES = [
  [/\b(?:need|needs|needed|please)\b/i, 'requested'],
  [/\b(?:could|propose|proposes|suggest|suggests)\b/i, 'proposed'],
  [/\b(?:booked|approved|scheduled|locked in)\b/i, 'confirmed'],
  [/\b(?:delivered|arrived)\b/i, 'reported_complete'],
];

const HEDGE_RE =
  /\b(?:probably|maybe|perhaps|possibly|likely|unlikely|hopefully|tentative(?:ly)?|might|i think|we think|should be|not sure|unclear|tbd|if possible|or so|ish)\b|\bmay\b(?!\s+\d)|\b(?:about|around|approximately|roughly|approx\.?)(?=\s*\$?\d)|~(?=\s*\d)/gi;
const CONDITION_RE =
  /\b(?:if|unless|once|provided(?: that)?|as long as|assuming|pending|subject to|weather permitting|depending on|only after)\b[^,;.]*/gi;
const COMMITMENT_RE =
  /\b(?:will|shall|won't|we'll|i'll|they'll|he'll|she'll|promise[sd]?|guarantee[sd]?|commit(?:s|ted)?|going to|definitely|for sure|make sure|ensure)\b/i;
// Greeting prefix ("Hi Dana, ...") is stripped and the rest of the line is checked. A sign-off counts as
// framing only when it stands alone ("Thanks," / "Best, Sam"), never as a prefix ("Best case we ...").
const GREETING_RE = /^(?:hi|hello|hey|dear|good (?:morning|afternoon|evening))\b[^,!:;.?]{0,40}(?:[,!:]\s*|$)/i;
const SIGNOFF_RE =
  /^(?:thanks|thank you|many thanks|best|regards|best regards|kind regards|warm regards|cheers|sincerely|talk soon)(?:\s*,\s*[^,.!?:;]{1,40})?\s*[,!.]?$/i;

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_ABBR = { mon: 'monday', tue: 'tuesday', tues: 'tuesday', wed: 'wednesday', thu: 'thursday', thur: 'thursday', thurs: 'thursday', fri: 'friday', sat: 'saturday', sun: 'sunday' };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_ABBR = { jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_WORD = '(?:january|february|march|april|may|june|july|august|september|october|november|december|(?:jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\.?)';
// "sat", "sun" and "wed" are ordinary words too, so their abbreviations need the dot.
const DAY_WORD = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|(?:mon|tues|tue|thurs|thur|thu|fri)\\.?|(?:wed|sat|sun)\\.)';
const DATE_RE = new RegExp(
  [
    '\\d{4}-\\d{2}-\\d{2}',
    '\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?',
    `${MONTH_WORD}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`,
    `\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_WORD}`,
    `(?:next|this|last)\\s+(?:${DAY_WORD}|week|month|weekend)`,
    DAY_WORD,
    'today|tomorrow|tonight|yesterday|end of (?:the )?(?:day|week|month)|eod|eow',
    '\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)',
    'noon|midnight',
  ].map((p) => `\\b(?:${p})(?![A-Za-z0-9])`).join('|'),
  'gi',
);

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, hundred: 100, dozen: 12,
};
const QTY_RE = new RegExp(
  `(\\$\\s?\\d[\\d,]*(?:\\.\\d+)?|(?<![\\w.$])\\d[\\d,]*(?:\\.\\d+)?%?(?![A-Za-z0-9])|\\b(?:a\\s+)?(?:${Object.keys(NUMBER_WORDS).join('|')})\\b)(?:\\s+([A-Za-z][A-Za-z'-]*))?`,
  'gi',
);

const STOP = new Set(
  ('a an the and or but so to of in on at by for from with without into onto over under up down out about as is are was were be been ' +
    'being am do does did done have has had having it its it\'s this that these those there here then than i we you he she they me us him ' +
    'her them my our your his their what which who whom when where why how all any some no not never also just still now very really ' +
    'can could would should will shall may might must need needs needed please let lets get got gets go going say said says told ' +
    'hi hello hey dear thanks thank regards best cheers team update quick note notes fyi summary status following below re subject ' +
    'per via etc today tomorrow tonight yesterday week month weekend next last end day eod eow am pm noon midnight ' +
    'probably maybe perhaps possibly likely unlikely hopefully tentative tentatively think sure unclear tbd approximately roughly approx around ' +
    'if unless once provided long assuming pending subject depending only after before until ' +
    'asked ask requested request proposed propose suggested suggest confirmed confirm agreed agree verified verify inspected ' +
    'finished completed reported promised promise guarantee committed commit definitely ensure make waiting decided idea ' +
    'one two three four five six seven eight nine ten eleven twelve dozen').split(/\s+/),
);
for (const d of DAYS) STOP.add(d);
for (const m of MONTHS) STOP.add(m);
for (const k of [...Object.keys(DAY_ABBR), ...Object.keys(MONTH_ABBR)]) STOP.add(k);

const PRONOUN_ACTORS = new Set(['i', 'we', 'you', 'he', 'she', 'they']);
const OWNER = new Set(['i', 'we', 'us', 'me', 'our team', 'my team']);
// Capitalised words that start a sentence without naming who acts.
const NOT_ACTOR = new Set(
  ('the a an this that these those it there here if when once unless then so and but also actually maybe probably perhaps please ' +
    'need order call send email text pick get buy check ask confirm schedule book follow remind waiting decided decision idea note ' +
    'update finish start review pay submit bring drop meet talk tell let make install verify fyi our my their your his her').split(/\s+/),
);
const VERBISH = new Set(
  ('is are was were be been has have had do does did will would shall should can could may might must ' +
    'said says told asked requested confirmed agreed proposed suggested promised verified inspected finished completed ' +
    'needs need wants want thinks').split(/\s+/),
);
const SKIP_LEAD = /^(?:(?:also|then|and|but|so|actually|fyi|note|probably|maybe|perhaps|possibly|hopefully|likely)\b[\s,:]*)+/i;

function words(s) {
  return String(s).toLowerCase().replace(/[’‘]/g, "'").match(/[a-z0-9$%][a-z0-9'$%.-]*[a-z0-9%]|[a-z0-9$%]/g) || [];
}

// Crude suffix stemmer: the same on both sides, so "lifts" matches "lift" and "scheduled" matches "schedule".
function stem(w) {
  let s = w.replace(/'s$/, '');
  if (s.length > 4 && s.endsWith('ies')) s = `${s.slice(0, -3)}y`;
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

function normDate(phrase) {
  return phrase
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/\b[a-z]+\b/g, (w) => DAY_ABBR[w] || (MONTH_ABBR[w] !== undefined ? MONTHS[MONTH_ABBR[w]] : w))
    .replace(/,/g, '')
    .trim();
}

function findDates(text) {
  return [...String(text).matchAll(DATE_RE)].map((m) => ({ raw: m[0], index: m.index }));
}

function findQuantities(text, dates) {
  // Blank out date phrases first so "Nov 3" or "7am" never read as quantities.
  let masked = String(text);
  for (const d of dates) masked = masked.slice(0, d.index) + ' '.repeat(d.raw.length) + masked.slice(d.index + d.raw.length);
  const out = [];
  for (const m of masked.matchAll(QTY_RE)) {
    const numText = m[1].trim();
    const word = numText.toLowerCase().replace(/^a\s+/, '');
    let value;
    if (NUMBER_WORDS[word] !== undefined) value = NUMBER_WORDS[word];
    else value = Number(numText.replace(/[$,%\s]/g, ''));
    if (!Number.isFinite(value)) continue;
    let unit = numText.startsWith('$') ? '$' : numText.endsWith('%') ? '%' : null;
    const next = m[2] ? m[2].toLowerCase() : null;
    if (!unit && next && !STOP.has(next) && !PRONOUN_ACTORS.has(next)) unit = next;
    const text = unit && unit !== '$' && unit !== '%' && m[2] ? `${numText} ${m[2]}` : numText;
    out.push({ value, unit, text });
  }
  return out;
}

function claimStatusOf(text) {
  const base = claimStatus(text);
  if (base.status !== 'unspecified' || base.unclear) return base.status;
  // Drafting cues claimStatus does not know. Earliest cue wins; a negated cue gives nothing.
  let best = null;
  for (const [re, status] of EXTRA_CUES) {
    const m = re.exec(text);
    if (!m) continue;
    const before = words(text.slice(0, m.index)).slice(-2);
    if (before.some((w) => /^(?:not|never|no)$|n't$/.test(w))) continue;
    if (!best || m.index < best.index) best = { index: m.index, status };
  }
  return best ? best.status : 'unspecified';
}

function actorOf(text) {
  const waiting = /^\s*waiting\s+(?:on|for)\s+([^:,(]+?)(?:\s*[:,(]|\s+(?:for|to)\s|$)/i.exec(text);
  if (waiting) return waiting[1].trim();
  // Drop a leading condition clause ("If the inspector passes it, we pour Thursday").
  let s = String(text).replace(/^\s*[-*•]\s*/, '');
  const lead = /^\s*(?:if|unless|once|assuming|provided|as long as|pending|depending on)\b[^,]*,\s*/i.exec(s);
  if (lead) s = s.slice(lead[0].length);
  s = s.replace(SKIP_LEAD, '');
  const toks = s.match(/[A-Za-z][A-Za-z'’&.-]*/g) || [];
  if (!toks.length) return null;
  const first = toks[0].replace(/[’]/g, "'");
  const low = first.toLowerCase();
  if (PRONOUN_ACTORS.has(low)) return low === 'i' ? 'I' : low;
  if (/^(?:we'll|we're|we've|i'll|i'm|i've|they'll|they're)$/.test(low)) return low.startsWith('i') ? 'I' : low.split("'")[0];
  if (/^(?:the|our|their|my|your)$/.test(low)) {
    const rest = [];
    for (const t of toks.slice(1, 3)) {
      if (VERBISH.has(t.toLowerCase()) || STOP.has(t.toLowerCase())) break;
      rest.push(t);
    }
    return rest.length ? `${first} ${rest.join(' ')}`.toLowerCase() : null;
  }
  const name = [];
  for (const t of toks) {
    if (!/^[A-Z]/.test(t) || NOT_ACTOR.has(t.toLowerCase()) || STOP.has(t.toLowerCase()) || name.length >= 3) break;
    name.push(t.replace(/[.]+$/, ''));
  }
  return name.length ? name.join(' ') : null;
}

function actionOf(text, actor) {
  let ws = words(text);
  if (actor) {
    const a = words(actor);
    const at = ws.findIndex((w, i) => a.every((x, j) => ws[i + j] === x));
    if (at >= 0) ws = ws.slice(at + a.length);
  }
  const SKIP = new Set(['will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'has', 'have', 'had', 'is', 'are', 'was', 'were', 'be', 'been', 'not', 'probably', 'maybe', 'also', 'just', 'still', 'already', 'to']);
  const w = ws.find((x) => !SKIP.has(x) && /^[a-z]/.test(x));
  return w || null;
}

// Clauses: sentences (interpret.js rules), then semicolons and ", and/but/so" joins.
function clauses(text) {
  const out = [];
  for (const sentence of splitSentences(String(text || ''))) {
    for (const part of sentence.split(/;\s*|,\s*(?:and|but|so)\s+|\s+but\s+/i)) {
      const t = part.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
      if (t && /[A-Za-z0-9]/.test(t)) out.push(t);
    }
  }
  return out;
}

/** Split text into atomic claims. Every claim's text is taken verbatim from the input. */
export function extractClaims(text) {
  return clauses(text).map((t) => {
    const dates = findDates(t);
    const actor = actorOf(t);
    return {
      text: t,
      actor,
      action: actionOf(t, actor),
      quantities: findQuantities(t, dates).map(({ value, unit, text: qt }) => ({ value, unit, text: qt })),
      dates: dates.map((d) => d.raw),
      status: claimStatusOf(t),
      conditions: (t.match(CONDITION_RE) || []).map((c) => c.trim()),
      hedges: [...new Set((t.match(HEDGE_RE) || []).map((x) => x.trim().toLowerCase()))],
    };
  });
}

function keyWords(claim) {
  const set = new Set();
  for (const w of words(claim.text)) {
    if (STOP.has(w) || /^\d/.test(w) || w.length < 2) continue;
    set.add(stem(w));
  }
  return set;
}

function matchKeys(claim) {
  const set = keyWords(claim);
  for (const q of claim.quantities) set.add(`#${q.value}`);
  for (const d of claim.dates) set.add(`@${normDate(d)}`);
  return set;
}

function isQuestion(claim) {
  return /\?\s*$/.test(claim.text);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Anything that could carry meaning: a number, a date, a status, a promise, a hedge or a condition.
function checkable(text) {
  const dates = findDates(text);
  return dates.length > 0 || findQuantities(text, dates).length > 0 || claimStatusOf(text) !== 'unspecified' ||
    COMMITMENT_RE.test(text) || new RegExp(HEDGE_RE.source, 'i').test(text) || new RegExp(CONDITION_RE.source, 'i').test(text);
}

// Greetings, sign-offs and headings ("Waiting on:", "Riverside update for Dana:") are framing, not claims,
// but only when they carry nothing checkable once the known labels (recipient, project name) are removed.
// A greeting prefix is cut off and the rest of the line is checked as a claim.
// ponytail: labels are trusted (the user typed them); a heading that only repeats a label is never checked.
function prepClaims(text, labels) {
  const out = [];
  const strip = (t) => labels.reduce((acc, l) => acc.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRe(l)}(?![A-Za-z0-9])`, 'gi'), ' '), t).replace(/\s+([,!:])/g, '$1').trim();
  for (const c of extractClaims(text)) {
    let claim = c;
    const bare = strip(c.text);
    const whole = GREETING_RE.exec(bare);
    const greetingOnly = !!whole && whole[0].length >= bare.length;
    const g = GREETING_RE.exec(c.text);
    if (!greetingOnly && g && g[0].length < c.text.length) {
      claim = extractClaims(c.text.slice(g[0].length))[0];
      if (!claim) continue;
    }
    const keys = matchKeys(claim);
    if (keys.size === 0) continue;
    const shaped = greetingOnly || SIGNOFF_RE.test(claim.text) || /:\s*$/.test(claim.text);
    if (shaped && !checkable(strip(claim.text))) continue;
    out.push({ claim, keys });
  }
  return out;
}

function score(a, b) {
  let shared = 0;
  for (const k of a) if (b.has(k)) shared++;
  if (!shared) return { score: 0, shared, jaccard: 0 };
  return { score: shared / Math.min(a.size, b.size), shared, jaccard: shared / (a.size + b.size - shared) };
}

// Best candidate by overlap (shared keys over the smaller set), then by Jaccard, so a claim's exact twin
// wins over a longer claim that merely contains the same words.
function bestMatch(keys, pool) {
  let best = null;
  for (const cand of pool) {
    const s = score(keys, cand.keys);
    if (s.score < 0.5) continue;
    if (!best || s.score > best.score || (s.score === best.score && s.jaccard > best.jaccard)) best = { ...s, entry: cand };
  }
  return best ? best.entry : null;
}

function qtyKey(q) {
  return `${q.value}|${q.unit ? stem(q.unit) : ''}`;
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]);
}

function normActor(a) {
  const low = String(a).toLowerCase();
  return OWNER.has(low) ? 'we' : low;
}

function mentions(text, phrase) {
  const t = ` ${words(text).join(' ')} `;
  return t.includes(` ${words(phrase).join(' ')} `);
}

function list(xs) {
  return xs.length ? xs.join(', ') : 'nothing';
}

function flag(type, message, src, dft, extra) {
  return { type, message, source_quote: src ? src.text : null, draft_quote: dft ? dft.text : null, ...(extra || {}) };
}

function pairFlags(src, dft) {
  const out = [];
  const sq = src.quantities.map(qtyKey);
  const dq = dft.quantities.map(qtyKey);
  if (!sameSet(sq, dq)) {
    const sv = list(src.quantities.map((q) => q.text));
    const dv = list(dft.quantities.map((q) => q.text));
    out.push(flag('changed_quantity', `The amount changed: your notes say ${sv}; the draft says ${dv}.`, src, dft, { source_value: sv, draft_value: dv }));
  }
  if (!sameSet(src.dates.map(normDate), dft.dates.map(normDate))) {
    const sv = list(src.dates);
    const dv = list(dft.dates);
    out.push(flag('changed_date', `The date changed: your notes say ${sv}; the draft says ${dv}.`, src, dft, { source_value: sv, draft_value: dv }));
  }
  if (src.actor && dft.actor && normActor(src.actor) !== normActor(dft.actor) && !mentions(src.text, dft.actor)) {
    out.push(flag('changed_actor', `Who is responsible changed: your notes say ${src.actor}; the draft says ${dft.actor}.`, src, dft, { source_value: src.actor, draft_value: dft.actor }));
  }
  if (dft.status !== src.status && FIRM.has(dft.status)) {
    const said = src.status === 'unspecified' ? "Your notes don't say it is settled" : `Your notes say ${STATUS_WORDS[src.status]}`;
    out.push(flag('status_upgraded', `${said}; the draft says ${STATUS_WORDS[dft.status]}.`, src, dft, { source_value: src.status, draft_value: dft.status }));
  } else if (dft.status === 'unspecified' && (src.status === 'requested' || src.status === 'proposed')) {
    // Dropping "requested"/"proposed" states the thing as fact ("Sunbelt has delivered 2 lifts").
    out.push(flag('status_upgraded', `Your notes say ${STATUS_WORDS[src.status]}; the draft states it as settled.`, src, dft, { source_value: src.status, draft_value: dft.status }));
  }
  if (src.hedges.length && !dft.hedges.length) {
    out.push(flag('certainty_removed', `Your notes say "${src.hedges.join('", "')}"; the draft states it as certain.`, src, dft, { source_value: src.hedges.join(', ') }));
  }
  if (COMMITMENT_RE.test(dft.text) && !COMMITMENT_RE.test(src.text)) {
    out.push(flag('commitment_added', "The draft adds a promise your notes don't make.", src, dft));
  }
  for (const c of src.conditions) {
    const kept = dft.conditions.some((d) => score(keyWords({ text: c }), keyWords({ text: d })).score >= 0.5) || mentions(dft.text, c);
    if (!kept) {
      out.push(flag('condition_omitted', `Your notes say this depends on "${c}"; the draft drops that condition.`, src, dft, { source_value: c }));
    }
  }
  return out;
}

/**
 * Compares a draft against the notes it was written from. Returns flags, each with the source quote and
 * the draft quote it is about. Matching pairs each draft claim with its most similar source claim (shared
 * key words, numbers and dates); unmatched source facts are fact_omitted and unmatched draft statements
 * are unsupported_claim (or commitment_added when they promise something). labels are names the draft's
 * greeting and headings may carry without them counting as claims (recipient label, project name).
 */
export function compareClaims(sourceText, draftText, { labels = [] } = {}) {
  const known = labels.filter((l) => typeof l === 'string' && l.trim()).map((l) => l.trim());
  const source = prepClaims(sourceText, known);
  const draft = prepClaims(draftText, known);
  const flags = [];
  const seen = new Set();
  const push = (f) => {
    const k = `${f.type}|${f.source_quote}|${f.draft_quote}`;
    if (!seen.has(k)) {
      seen.add(k);
      flags.push(f);
    }
  };

  for (const d of draft) {
    const m = bestMatch(d.keys, source);
    if (!m) {
      if (isQuestion(d.claim)) continue;
      if (COMMITMENT_RE.test(d.claim.text)) push(flag('commitment_added', "The draft adds a promise your notes don't make.", null, d.claim));
      else push(flag('unsupported_claim', "The draft says something your notes don't.", null, d.claim));
      continue;
    }
    if (isQuestion(m.claim) && !isQuestion(d.claim)) {
      push(flag('unsupported_claim', 'Your notes ask this as a question; the draft states it as fact.', m.claim, d.claim));
      continue;
    }
    for (const f of pairFlags(m.claim, d.claim)) push(f);
  }
  for (const s of source) {
    if (isQuestion(s.claim)) continue;
    if (!bestMatch(s.keys, draft)) push(flag('fact_omitted', 'This fact from your notes is not in the draft.', s.claim, null));
  }
  return flags;
}
