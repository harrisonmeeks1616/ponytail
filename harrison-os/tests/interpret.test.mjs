import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpret, claimStatus, splitSentences } from '../src/interpret.js';

const NY = 'America/New_York';
// Thursday 2026-10-29, 08:00 EDT.
const opts = { now: Date.parse('2026-10-29T12:00:00Z'), timeZone: NY };
const run = (text, o = opts) => interpret(text, o).proposals;
const one = (text) => {
  const ps = run(text);
  assert.equal(ps.length, 1, `expected one proposal for: ${text}`);
  return ps[0];
};

const SAMPLE = 'Waiting on the alternate light quote from [Supplier]. Remind me Friday morning to follow up. ' +
  'Jeff asked for two more electricians Friday, need to check with the office.';

test('preview sample: waiting, reminder and requested task', () => {
  const ps = run(SAMPLE);
  assert.equal(ps.length, 3);

  const [w, r, t] = ps;
  assert.deepEqual(w, {
    ordinal: 1,
    kind: 'waiting',
    title: 'alternate light quote',
    fields: { who: '[Supplier]', claim: { by: null, status: 'unspecified' } },
    sourceQuote: 'Waiting on the alternate light quote from [Supplier].',
    needsReview: [],
  });

  assert.deepEqual(r, {
    ordinal: 2,
    kind: 'reminder',
    title: 'follow up',
    fields: {
      when: { kind: 'datetime', on: '2026-10-30', time: '08:00', needsTimeCheck: true, original: 'Friday morning' },
      relatedOrdinal: 1,
    },
    sourceQuote: 'Remind me Friday morning to follow up.',
    needsReview: ['time_check'],
  });

  assert.equal(t.ordinal, 3);
  assert.equal(t.kind, 'task');
  assert.equal(t.title, 'two more electricians Friday');
  assert.deepEqual(t.fields.claim, { by: 'Jeff', status: 'requested' });
  assert.equal(t.fields.nextStep, 'check with the office');
  // The mentioned Friday is kept for review only; it is not made a due date.
  assert.deepEqual(t.fields.when, { kind: 'date', on: '2026-10-30', needsTimeCheck: false, original: 'Friday' });
  assert.equal('dueOn' in t.fields, false);
  assert.deepEqual(t.needsReview, ['check_date']);
  assert.equal(t.sourceQuote, 'Jeff asked for two more electricians Friday, need to check with the office.');
});

test('sourceQuote is the exact sentence, a substring of the capture', () => {
  for (const p of run(SAMPLE)) assert.ok(SAMPLE.includes(p.sourceQuote), p.sourceQuote);
  assert.deepEqual(splitSentences(SAMPLE), [
    'Waiting on the alternate light quote from [Supplier].',
    'Remind me Friday morning to follow up.',
    'Jeff asked for two more electricians Friday, need to check with the office.',
  ]);
  assert.deepEqual(splitSentences('Call at 3 p.m. Friday about Oct. 31 delivery! Then lunch?\nNew line'), [
    'Call at 3 p.m. Friday about Oct. 31 delivery!',
    'Then lunch?',
    'New line',
  ]);
});

test('waiting: claim status from verbs; no verb is unspecified', () => {
  const plain = one('Waiting on the panel schedule from Jeff.');
  assert.equal(plain.kind, 'waiting');
  assert.equal(plain.fields.who, 'Jeff');
  assert.deepEqual(plain.fields.claim, { by: null, status: 'unspecified' });

  const noWho = one('Waiting for the fixture submittal.');
  assert.equal(noWho.fields.who, null);
  assert.ok(noWho.needsReview.includes('who_not_stated'));

  const named = one('Waiting on Maria for the revised one-line.');
  assert.equal(named.fields.who, 'Maria');
  assert.equal(named.title, 'revised one-line');

  const maybe = one('Waiting on the switchgear from [Supplier], maybe Friday.');
  assert.equal(maybe.fields.claim.status, 'proposed');
  assert.equal(maybe.fields.when.on, '2026-10-30');
  assert.equal('promisedOn' in maybe.fields, false);

  const confirmed = one('Waiting on the switchgear from [Supplier], they confirmed Friday.');
  assert.equal(confirmed.fields.claim.status, 'confirmed');
  assert.equal(confirmed.fields.promisedOn, '2026-10-30');
});

test('"<Name> said ... maybe" is proposed; "confirmed" is confirmed; neither is upgraded', () => {
  const p = one('Inspector said rough-in next Wednesday, maybe');
  assert.equal(p.kind, 'waiting');
  assert.equal(p.fields.who, 'Inspector');
  assert.deepEqual(p.fields.claim, { by: 'Inspector', status: 'proposed' });
  assert.deepEqual(p.fields.when, { kind: 'date', on: '2026-11-04', needsTimeCheck: false, original: 'next Wednesday' });
  assert.equal('promisedOn' in p.fields, false);
  assert.equal(p.title, 'rough-in next Wednesday');

  const c = one('Inspector confirmed rough-in next Wednesday.');
  assert.deepEqual(c.fields.claim, { by: 'Inspector', status: 'confirmed' });
  assert.equal(c.fields.promisedOn, '2026-11-04');

  const said = one('Inspector said rough-in next Wednesday.');
  assert.deepEqual(said.fields.claim, { by: 'Inspector', status: 'unspecified' });
  assert.equal('promisedOn' in said.fields, false);

  // Small talk with no date and no status word is not a proposal.
  assert.deepEqual(run('Jeff said hi.'), []);
});

test('claimStatus maps verbs to distinct statuses; conflicts and negation are unspecified', () => {
  const s = (x) => claimStatus(x).status;
  assert.equal(s('Jeff asked for it'), 'requested');
  assert.equal(s('Office requested the logs'), 'requested');
  assert.equal(s('They proposed Tuesday'), 'proposed');
  assert.equal(s('He suggested a walkthrough'), 'proposed');
  assert.equal(s('It might ship Friday'), 'proposed');
  assert.equal(s('Supplier agreed to Friday'), 'confirmed');
  assert.equal(s('Jeff will send it Friday'), 'confirmed');
  assert.equal(s("He'll send it Friday"), 'confirmed');
  assert.equal(s('Crew finished the trim'), 'reported_complete');
  assert.equal(s('Fixtures installed on 3'), 'reported_complete');
  assert.equal(s('Inspector verified the bonding'), 'verified');
  assert.equal(s('City inspected the service'), 'verified');
  assert.equal(s('Quote from the supplier'), 'unspecified');
  // Future or conditional completion is not reported complete.
  assert.equal(s('It will be done Friday'), 'confirmed');
  assert.equal(s('Need to get it done'), 'unspecified');
  // Negation and conflicts never pick a status.
  assert.deepEqual(claimStatus("Supplier hasn't confirmed"), { status: 'unspecified', unclear: true });
  assert.deepEqual(claimStatus('Jeff will not send it'), { status: 'unspecified', unclear: true });
  assert.deepEqual(claimStatus('Confirmed Friday, maybe Saturday'), { status: 'unspecified', unclear: true });
  assert.deepEqual(claimStatus('nothing here'), { status: 'unspecified', unclear: false });
});

test('a negated status in a waiting sentence is flagged and stays unspecified', () => {
  const p = one("Waiting on the quote from [Supplier], they haven't confirmed.");
  assert.equal(p.fields.claim.status, 'unspecified');
  assert.ok(p.needsReview.includes('status_unclear'));
});

test('correction "actually Saturday" replaces the reminder when, keeping the superseded value', () => {
  const ps = run('Remind me Friday morning to follow up. Actually Saturday.');
  assert.equal(ps.length, 1);
  const r = ps[0];
  assert.equal(r.kind, 'reminder');
  assert.deepEqual(r.fields.when, { kind: 'datetime', on: '2026-10-31', time: '08:00', needsTimeCheck: true, original: 'Saturday' });
  assert.deepEqual(r.fields.replaced, { kind: 'datetime', on: '2026-10-30', time: '08:00', needsTimeCheck: true, original: 'Friday morning' });
  assert.equal(r.fields.correctionQuote, 'Actually Saturday.');
  assert.equal(r.sourceQuote, 'Remind me Friday morning to follow up.');
  assert.deepEqual(r.needsReview, ['time_check', 'corrected', 'time_kept_from_earlier']);
});

test('corrections: "no, <when>", full replacement, time-only, and the latest reminder only', () => {
  const full = run('Remind me tomorrow at 9am to call Jeff. No, Monday at 10am.')[0];
  assert.deepEqual(full.fields.when, { kind: 'datetime', on: '2026-11-02', time: '10:00', needsTimeCheck: false, original: 'Monday at 10am' });
  assert.deepEqual(full.fields.replaced, { kind: 'datetime', on: '2026-10-30', time: '09:00', needsTimeCheck: false, original: 'tomorrow at 9am' });
  assert.deepEqual(full.needsReview, ['corrected']);

  const timeOnly = run('Remind me Friday at 9am to call Jeff. Actually 3pm.')[0];
  assert.deepEqual(timeOnly.fields.when, { kind: 'datetime', on: '2026-10-30', time: '15:00', needsTimeCheck: false, original: '3pm' });
  assert.ok(timeOnly.needsReview.includes('date_kept_from_earlier'));

  const two = run('Remind me Friday at 9am to call Jeff. Remind me Monday at 9am to order breakers. Actually Tuesday.');
  assert.equal(two.length, 2);
  assert.equal(two[0].fields.when.on, '2026-10-30');
  assert.equal('replaced' in two[0].fields, false);
  assert.equal(two[1].fields.when.on, '2026-11-03');
  assert.equal(two[1].fields.replaced.on, '2026-11-02');

  // "Actually" without a when phrase, or with no reminder before it, is not a correction.
  assert.deepEqual(run('Actually Saturday.'), []);
  const notWhen = run('Remind me Friday at 9am to call Jeff. Actually the crew was great.');
  assert.equal(notWhen.length, 1);
  assert.equal('replaced' in notWhen[0].fields, false);
});

test('reminder forms: "remind me to X <when>", unclear and missing when', () => {
  const a = one('Remind me to call the inspector tomorrow at 3pm.');
  assert.equal(a.title, 'call the inspector');
  assert.deepEqual(a.fields.when, { kind: 'datetime', on: '2026-10-30', time: '15:00', needsTimeCheck: false, original: 'tomorrow at 3pm' });
  assert.deepEqual(a.needsReview, []);

  const b = one('Remind me at 3 to send the RFI.');
  assert.deepEqual(b.fields.when, { kind: 'datetime', on: '2026-10-29', time: '15:00', needsTimeCheck: true, original: 'at 3' });
  assert.deepEqual(b.needsReview, ['time_check']);

  const c = one('Remind me next week to check the lifts.');
  assert.deepEqual(c.fields.when, { kind: 'none', needsTimeCheck: false, original: 'next week' });
  assert.deepEqual(c.needsReview, ['when_unclear']);

  const d = one('Remind me to order wire.');
  assert.equal(d.title, 'order wire');
  assert.equal(d.fields.when.kind, 'none');
  assert.deepEqual(d.needsReview, ['when_not_stated']);

  const e = one('Remind me Friday to sign timesheets.');
  assert.deepEqual(e.needsReview, ['no_time']);

  const f = one('Remind me next Friday at 7am to pull permits.');
  assert.equal(f.fields.when.on, '2026-11-06');
  assert.ok(f.needsReview.includes('next_weekday_reading'));

  const past = one('Remind me today at 7am to call Jeff.');
  assert.ok(past.needsReview.includes('when_in_past'));
});

test('tasks: request verbs and need-to markers', () => {
  const asked = one('Maria asked me to pull the permit.');
  assert.equal(asked.kind, 'task');
  assert.equal(asked.title, 'pull the permit');
  assert.deepEqual(asked.fields.claim, { by: 'Maria', status: 'requested' });

  const wants = one('Jeff wants the panel moved.');
  assert.equal(wants.title, 'the panel moved');
  assert.deepEqual(wants.fields.claim, { by: 'Jeff', status: 'requested' });
  assert.ok(wants.needsReview.includes('check_who'));

  const need = one('Need to order 200A breakers.');
  assert.equal(need.kind, 'task');
  assert.equal(need.title, 'order 200A breakers');
  assert.equal('claim' in need.fields, false);

  assert.equal(one('I have to call the office.').title, 'call the office');
  assert.equal(one('todo: label the panels').title, 'label the panels');

  // Someone else's obligation is not Harrison's task.
  assert.deepEqual(run('Jeff must send the as-builts.'), []);
  // A pronoun is not a name.
  assert.deepEqual(run('He wants a walkthrough.'), []);
});

test('idea: and decided/decision: rules', () => {
  const i = one('Idea: color-code the temp power cords.');
  assert.equal(i.kind, 'idea');
  assert.equal(i.title, 'color-code the temp power cords');

  const d = one('We decided to use LED high-bays because the spec calls for them.');
  assert.equal(d.kind, 'decision');
  assert.equal(d.title, 'use LED high-bays');
  assert.equal(d.fields.reason, 'the spec calls for them');

  const dc = one('Decision: go with option B.');
  assert.equal(dc.kind, 'decision');
  assert.equal(dc.title, 'go with option B');

  // Not deciding is not a decision.
  assert.deepEqual(run("We haven't decided on the fixtures."), []);
  // idea: wins over later rules in the same sentence.
  assert.equal(one('Idea: need to remind Jeff about lockout tags.').kind, 'idea');
});

test('references: URL, look up, spec', () => {
  const u = one('Fixture cut sheet https://example.com/cut-sheet.pdf.');
  assert.equal(u.kind, 'reference');
  assert.equal(u.fields.url, 'https://example.com/cut-sheet.pdf');
  const l = one('Look up the torque values for the lugs.');
  assert.equal(l.kind, 'reference');
  assert.equal(l.title, 'the torque values for the lugs');
  assert.equal(one('Spec section 26 05 19 covers the wire.').kind, 'reference');
});

test('a note-only sentence yields no proposal', () => {
  assert.deepEqual(run('Long day on site, the crew was great.'), []);
  assert.deepEqual(run('Rain held us up this morning.'), []);
  assert.deepEqual(run(''), []);
  assert.deepEqual(run('   \n  '), []);
  // Mixed: only the actionable sentence becomes a proposal.
  const ps = run('Crew was great today. Need to order more wire nuts.');
  assert.equal(ps.length, 1);
  assert.equal(ps[0].ordinal, 1);
  assert.equal(ps[0].sourceQuote, 'Need to order more wire nuts.');
});

// Friday 2026-10-30, 10:00 EDT, and Wednesday 2026-10-28, 10:00 EDT.
const FRI = { now: Date.parse('2026-10-30T14:00:00Z'), timeZone: NY };
const WED = { now: Date.parse('2026-10-28T14:00:00Z'), timeZone: NY };

test('promisedOn needs a stated date: a time alone keeps fields.when for review but no promise date', () => {
  const [a] = run('Jeff will be there at 7.', FRI);
  assert.equal(a.kind, 'waiting');
  assert.equal(a.fields.claim.status, 'confirmed');
  assert.deepEqual(a.fields.when, { kind: 'datetime', on: '2026-10-31', time: '07:00', needsTimeCheck: true, original: 'at 7' });
  assert.ok(!('promisedOn' in a.fields), 'no promise date from a bare hour');
  assert.ok(!('promisedOn' in run('Jeff confirmed delivery for 8am.', FRI)[0].fields));
  assert.ok(!('promisedOn' in run('Waiting on the quote from Jeff, he will send it at 4.', FRI)[0].fields));
  // A stated date still gives one.
  assert.equal(run('Jeff will deliver it Monday at 7.', FRI)[0].fields.promisedOn, '2026-11-02');
});

test('reminder: "on Mon" is read as Monday; an unread day word in the title asks for a date check', () => {
  const [a] = run('Remind me to call Jeff on Mon at 7.', FRI);
  assert.equal(a.title, 'call Jeff');
  assert.deepEqual([a.fields.when.on, a.fields.when.time], ['2026-11-02', '07:00']);
  const [b] = run('Remind me to call Jeff Fri at 2pm.', WED);
  assert.equal(b.title, 'call Jeff Fri');
  assert.ok(b.needsReview.includes('when_unclear'), `needsReview ${JSON.stringify(b.needsReview)}`);
});

test('reminder: wire sizes and trade fractions are not dates', () => {
  const [a] = run('Remind me to pull 12/2 at 3.', FRI);
  assert.equal(a.title, 'pull 12/2');
  assert.deepEqual([a.fields.when.on, a.fields.when.time], ['2026-10-30', '15:00']);
  const [b] = run('Remind me to order 3/4 EMT.', FRI);
  assert.equal(b.fields.when.kind, 'none');
  assert.ok(b.needsReview.includes('when_not_stated'));
  const [c] = run('Need to order 1/2 inch flex.', FRI);
  assert.equal(c.kind, 'task');
  assert.ok(!('when' in c.fields));
});

test('correction with a bare hour replaces the time; an unreadable one is flagged, never dropped', () => {
  const [a] = run('Remind me at 3 to call Jeff. Actually 4.', FRI);
  assert.equal(a.fields.when.time, '16:00');
  assert.equal(a.fields.when.on, '2026-10-30');
  assert.equal(a.fields.when.original, '4');
  assert.equal(a.fields.replaced.time, '15:00');
  assert.equal(a.fields.correctionQuote, 'Actually 4.');
  assert.ok(a.needsReview.includes('corrected') && a.needsReview.includes('time_check'));
  const [b] = run('Remind me at 3 to call Jeff. No, 25.', FRI);
  assert.equal(b.fields.when.time, '15:00');
  assert.ok(b.needsReview.includes('when_unclear'));
});

test("todo: someone else's obligation (pronoun, 'has to') is not Harrison's task; unclear subjects ask who", () => {
  assert.deepEqual(run('They need to send the drawings.', FRI), []);
  assert.deepEqual(run('He must send the revised quote.', FRI), []);
  assert.deepEqual(run('The inspector has to sign off on the rough in.', FRI), []);
  const [mine] = run('I really need to call the GC.', FRI);
  assert.equal(mine.kind, 'task');
  assert.deepEqual(mine.needsReview, []);
  assert.ok(run('You need to call the GC.', FRI)[0].needsReview.includes('check_who'));
  assert.ok(run('The crew need to clean up.', FRI)[0].needsReview.includes('check_who'));
});

test('deterministic: same input and options give identical output', () => {
  assert.deepEqual(interpret(SAMPLE, opts), interpret(SAMPLE, opts));
  assert.throws(() => interpret(SAMPLE), TypeError);
  assert.throws(() => interpret(SAMPLE, { now: Date.now() }), TypeError);
});

// ---------------------------------------------------------------------------------------------
// Property test: titles (and every free-text field) only reuse what the sentence says.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['Jeff', 'Maria', 'Inspector', '[Supplier]', "O'Neil", 'Dana Ruiz', 'GC'];
const THINGS = ['the alternate light quote', 'two more electricians', '200A breakers', 'the revised one-line',
  'conduit for Building 4', 'LED fixtures', 'the as-builts', 'panel LP-2 labels', '3 spools of 12/2', 'a walkthrough'];
const WHENS = ['Friday', 'next Wednesday', 'Oct 31', '10/31', 'tomorrow morning', 'at 3', '3:30 pm',
  'Monday at 9am', 'next week', 'this afternoon', 'Nov 12'];
const HEDGES = ['', ', maybe', ', confirmed', ', they agreed', ", hasn't confirmed", ', finished', ', verified'];
const TEMPLATES = [
  (r) => `Waiting on ${r.thing} from ${r.name}${r.hedge}.`,
  (r) => `Waiting for ${r.name} to send ${r.thing}${r.hedge}.`,
  (r) => `Remind me ${r.when} to follow up on ${r.thing}.`,
  (r) => `Remind me to check ${r.thing} ${r.when}.`,
  (r) => `${r.name} asked for ${r.thing} ${r.when}, need to check with the office.`,
  (r) => `${r.name} asked me to order ${r.thing}.`,
  (r) => `${r.name} wants ${r.thing} ${r.when}.`,
  (r) => `${r.name} said ${r.thing} ${r.when}${r.hedge}.`,
  (r) => `${r.name} will deliver ${r.thing} ${r.when}.`,
  (r) => `Need to order ${r.thing} by ${r.when}.`,
  (r) => `Idea: stage ${r.thing} near the gear.`,
  (r) => `We decided to use ${r.thing} because ${r.name} said so.`,
  (r) => `Look up ${r.thing}.`,
  (r) => `Crew was great with ${r.thing}.`,
  (r) => `Actually ${r.when}.`,
  (r) => `No, ${r.when}.`,
];

const BANNED = ['confirmed', 'approved', 'verified', 'done', 'completed', 'finished', 'agreed', 'promised', 'scheduled', 'installed'];

function wordsOf(s) {
  return s.toLowerCase().match(/[a-z0-9'[\]/-]+/g) || [];
}

function checkVerbatim(label, value, quote) {
  assert.equal(typeof value, 'string', label);
  for (const digits of value.match(/\d+/g) || []) {
    assert.ok(quote.includes(digits), `${label}: digits "${digits}" not in "${quote}"`);
  }
  for (const cap of value.match(/[A-Z][A-Za-z'-]*/g) || []) {
    assert.ok(quote.includes(cap), `${label}: capitalised "${cap}" not in "${quote}"`);
  }
  const quoteWords = new Set(wordsOf(quote));
  for (const w of wordsOf(value)) {
    assert.ok(quoteWords.has(w), `${label}: word "${w}" not in "${quote}"`);
  }
  for (const b of BANNED) {
    if (new RegExp(`\\b${b}\\b`, 'i').test(value)) {
      assert.ok(new RegExp(`\\b${b}\\b`, 'i').test(quote), `${label}: adds "${b}" absent from "${quote}"`);
    }
  }
  assert.ok(quote.includes(value), `${label}: "${value}" is not a verbatim part of "${quote}"`);
}

test('property: no proposal invents digits, capitalised words or status words', () => {
  const rand = mulberry32(20261029);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  let checked = 0;
  for (let i = 0; i < 400; i++) {
    const n = 1 + Math.floor(rand() * 4);
    const sentences = [];
    for (let k = 0; k < n; k++) {
      sentences.push(pick(TEMPLATES)({ name: pick(NAMES), thing: pick(THINGS), when: pick(WHENS), hedge: pick(HEDGES) }));
    }
    const text = sentences.join(' ');
    const out = interpret(text, opts);
    assert.deepEqual(out, interpret(text, opts), 'deterministic');
    out.proposals.forEach((p, idx) => {
      assert.equal(p.ordinal, idx + 1);
      assert.ok(text.includes(p.sourceQuote), 'sourceQuote is verbatim');
      assert.ok(p.title.length > 0, 'title is not empty');
      checkVerbatim('title', p.title, p.sourceQuote);
      const f = p.fields;
      if (f.who != null) checkVerbatim('who', f.who, p.sourceQuote);
      if (f.claim && f.claim.by != null) checkVerbatim('claim.by', f.claim.by, p.sourceQuote);
      if (f.nextStep) checkVerbatim('nextStep', f.nextStep, p.sourceQuote);
      if (f.reason) checkVerbatim('reason', f.reason, p.sourceQuote);
      if (f.url) checkVerbatim('url', f.url, p.sourceQuote);
      if (f.when && f.when.original) {
        const quotes = [p.sourceQuote, f.correctionQuote].filter(Boolean);
        assert.ok(quotes.some((q) => q.includes(f.when.original)), 'when.original is verbatim');
      }
      if (f.claim) {
        assert.ok(['requested', 'proposed', 'confirmed', 'reported_complete', 'verified', 'unspecified'].includes(f.claim.status));
        if (f.claim.status === 'confirmed') assert.match(p.sourceQuote, /\b(confirmed|agreed|will|\w+'ll)\b/i);
      }
      if ('promisedOn' in f) assert.equal(f.claim.status, 'confirmed', 'promisedOn only for confirmed claims');
      checked++;
    });
  }
  assert.ok(checked > 400, `checked ${checked} proposals`);
});
