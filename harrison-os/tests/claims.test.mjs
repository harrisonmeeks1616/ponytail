// Claim extraction and the draft tripwire (src/claims.js). Synthetic text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractClaims, compareClaims, FLAG_TYPES } from '../src/claims.js';

const types = (flags) => flags.map((f) => f.type);

function only(flags, type) {
  assert.deepEqual(types(flags), [type], JSON.stringify(flags, null, 1));
  const f = flags[0];
  assert.ok(FLAG_TYPES.includes(f.type));
  assert.equal(typeof f.message, 'string');
  return f;
}

test('requested resources becoming confirmed is flagged even with unchanged names and numbers', () => {
  const f = only(compareClaims('We requested 2 lifts from Sunbelt for Monday', 'Sunbelt confirmed 2 lifts for Monday'), 'status_upgraded');
  assert.equal(f.source_quote, 'We requested 2 lifts from Sunbelt for Monday');
  assert.equal(f.draft_quote, 'Sunbelt confirmed 2 lifts for Monday');
  assert.equal(f.source_value, 'requested');
  assert.equal(f.draft_value, 'confirmed');
  assert.equal(f.message, 'Your notes say requested; the draft says confirmed.');
});

test('12 vs 14 sheets is a changed quantity', () => {
  const f = only(compareClaims('Order 12 sheets of drywall for Friday', 'Order 14 sheets of drywall for Friday'), 'changed_quantity');
  assert.equal(f.source_value, '12 sheets');
  assert.equal(f.draft_value, '14 sheets');
});

test("Mike's job becoming ours is a changed actor", () => {
  const f = only(compareClaims('Mike will send the RFI', 'We will send the RFI'), 'changed_actor');
  assert.equal(f.source_value, 'Mike');
  assert.equal(f.draft_value, 'we');
});

test('a dropped "if" is an omitted condition', () => {
  const f = only(compareClaims('If the inspector passes it, we pour Thursday', 'We pour Thursday'), 'condition_omitted');
  assert.equal(f.source_value, 'If the inspector passes it');
});

test('"probably Friday" vs "Friday" removes certainty', () => {
  only(compareClaims('probably Friday', 'Friday'), 'certainty_removed');
  only(compareClaims('The drywall delivery is probably Friday.', 'The drywall delivery is Friday.'), 'certainty_removed');
});

test('a faithful rewrite has no flags', () => {
  const notes =
    'We requested 2 lifts from Sunbelt for Monday. Mike will send the RFI answer by Tuesday. ' +
    'If the inspector passes it, we pour Thursday. The delivery is probably Friday.';
  const draft =
    'Hi Dana,\n\nQuick update: we requested two lifts from Sunbelt for Monday. Mike will send the RFI answer by Tuesday. ' +
    'If the inspector passes it, we pour Thursday. The delivery is probably Friday.\n\nThanks,';
  assert.deepEqual(compareClaims(notes, draft), []);
});

test('changed dates, added promises, omitted and invented facts', () => {
  only(compareClaims('Order 12 sheets of drywall for Friday', 'Order 12 sheets of drywall for Thursday'), 'changed_date');
  assert.ok(types(compareClaims('Sunbelt might deliver the lifts Monday', 'Sunbelt will deliver the lifts Monday')).includes('commitment_added'));
  const omitted = compareClaims('Order 12 sheets of drywall. Call the inspector about the slab.', 'Order 12 sheets of drywall.');
  assert.deepEqual(types(omitted), ['fact_omitted']);
  assert.equal(omitted[0].source_quote, 'Call the inspector about the slab.');
  assert.equal(omitted[0].draft_quote, null);
  const invented = compareClaims('Order 12 sheets of drywall.', 'Order 12 sheets of drywall. The crane rental is approved.');
  assert.deepEqual(types(invented), ['unsupported_claim']);
  assert.deepEqual(types(compareClaims('Order 12 sheets of drywall.', 'Order 12 sheets of drywall. We will cover the overtime.')), ['commitment_added']);
});

test('a negated status is not a confirmation, and a question is not a fact', () => {
  only(compareClaims('Sunbelt has not confirmed the lifts', 'Sunbelt confirmed the lifts'), 'status_upgraded');
  only(compareClaims('Did Sunbelt confirm the lifts for Monday?', 'Sunbelt confirmed the lifts for Monday.'), 'unsupported_claim');
});

test('extractClaims: atomic fields, verbatim text, no upgrade without a cue', () => {
  const [a, b, c, d] = extractClaims(
    'If the inspector passes it, we pour Thursday. Waiting on Mike: RFI answer (requested). ' +
      'Order $4,500 of 2x4s and a dozen boxes at 7am Nov. 3rd. Maybe the crew finishes around 5 rooms.',
  );
  assert.equal(a.actor, 'we');
  assert.equal(a.action, 'pour');
  assert.deepEqual(a.dates, ['Thursday']);
  assert.deepEqual(a.conditions, ['If the inspector passes it']);
  assert.equal(a.status, 'unspecified');
  assert.equal(b.actor, 'Mike');
  assert.equal(b.status, 'requested');
  assert.deepEqual(c.quantities.map((q) => [q.value, q.unit]), [[4500, '$'], [12, 'boxes']]);
  assert.deepEqual(c.dates, ['7am', 'Nov. 3rd']);
  assert.ok(d.hedges.includes('maybe') && d.hedges.includes('around'));
  for (const claim of [a, b, c, d]) assert.ok(claim.text.length > 0);
  assert.deepEqual(extractClaims('We need 3 lifts.').map((x) => x.status), ['requested']);
  assert.deepEqual(extractClaims('We could pour Thursday.').map((x) => x.status), ['proposed']);
  assert.deepEqual(extractClaims('Mike said it is done.').map((x) => x.status), ['reported_complete']);
  assert.deepEqual(extractClaims('The panel was inspected.').map((x) => x.status), ['verified']);
});

test('greetings, sign-offs and headings never hide a claim', () => {
  const S = 'We requested 2 lifts from Sunbelt for Monday.';
  assert.ok(types(compareClaims(S, `Hi Dana, Sunbelt confirmed 2 lifts for Monday.\n${S}`)).includes('status_upgraded'));
  assert.ok(types(compareClaims(S, `${S} Thanks to Sunbelt, the lifts are confirmed for Monday.`)).includes('status_upgraded'));
  assert.ok(types(compareClaims(S, `Thanks, Sunbelt confirmed 2 lifts for Monday!\n${S}`)).includes('status_upgraded'));
  assert.ok(types(compareClaims(S, `${S}\nSunbelt confirmed 4 lifts for Monday:`)).includes('changed_quantity'));
  assert.ok(compareClaims('Order 12 sheets of drywall.', 'Order 12 sheets of drywall. Best case we need 40 sheets by Friday.').length > 0);
  only(compareClaims('Best case we pour Thursday if the inspector passes it.', 'We pour Thursday.'), 'condition_omitted');
  // Plain framing, and labels with numbers in them, stay silent.
  assert.deepEqual(compareClaims(S, `Hey team, quick update:\n${S}\n\nBest, Sam`), []);
  assert.deepEqual(compareClaims(S, `Lot 12 update for Unit 4 crew:\n${S}`, { labels: ['Lot 12', 'Unit 4 crew'] }), []);
  assert.deepEqual(compareClaims(S, `Hi Dana Smith, Project Manager,\n${S}`, { labels: ['Dana Smith, Project Manager'] }), []);
  assert.ok(compareClaims(S, `Hi Dana, Sunbelt confirmed 2 lifts for Monday.\n${S}`, { labels: ['Dana'] }).length > 0);
});

test('dropping requested or proposed states it as settled', () => {
  const S = 'We requested 2 lifts from Sunbelt for Monday.';
  const f = only(compareClaims(S, 'Sunbelt has delivered 2 lifts for Monday.'), 'status_upgraded');
  assert.equal(f.source_value, 'requested');
  for (const d of ['2 lifts from Sunbelt are booked for Monday.', 'Sunbelt is sending 2 lifts for Monday.']) {
    only(compareClaims(S, d), 'status_upgraded');
  }
  assert.equal(compareClaims('We could pour Thursday.', 'We pour Thursday.')[0].message, 'Your notes say proposed; the draft states it as settled.');
});
