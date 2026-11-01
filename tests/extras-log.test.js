#!/usr/bin/env node
// Rules behind the Extras Log page (docs/extras): numbering, notice deadlines, the notice text, the Friday line,
// what a signature freezes, and the backup-file trust boundary. Synthetic data only: this repo is public.

process.env.TZ = 'America/New_York';
const test = require('node:test');
const assert = require('node:assert/strict');
const X = import('../docs/extras/extras.mjs');

const TZ = 'America/New_York';
const job = { name: 'Sample Tower', noticeDays: 2, clauseRef: 'Subcontract 7.2', updatedAt: '2026-11-01T12:00:00.000Z' };
const ev = (o = {}) => ({
  id: 'e1', job: 'Sample Tower', no: 1, kind: 'directive', at: '2026-11-02T12:00:00.000Z', byRole: 'GC super', byName: 'Pat Sample',
  area: 'Level 3 east', what: 'Relocate four fixtures to clear new duct', refs: 'RFI 12', labor: [], material: [], equipment: [], photos: [],
  sig: null, noticeSentAt: null, createdAt: '2026-11-02T12:05:00.000Z', updatedAt: '2026-11-02T12:05:00.000Z', ...o,
});
const H = 36e5;

test('numbers are per job and never reused after a void or an import', async () => {
  const { nextNo, reissue, merge } = await X;
  const list = [ev(), ev({ id: 'e2', no: 2 }), ev({ id: 'o1', job: 'Other', no: 9 })];
  assert.equal(nextNo(list, 'Sample Tower'), 3);
  assert.equal(nextNo(list, 'New job'), 1);
  const { voided, fresh } = reissue(list[1], list, 'wrong area', 'e3');
  const after = [list[0], voided, fresh, list[2]];
  assert.equal(fresh.no, 3);
  assert.equal(nextNo(after, 'Sample Tower'), 4, 'the voided number stays taken');
  const imported = merge(after, [ev({ id: 'e9', no: 7 })], 'id').list;
  assert.equal(nextNo(imported, 'Sample Tower'), 8);
});

test('notice deadline keeps the wall-clock time across the DST change and flags late, soon, unset and done', async () => {
  const { deadline, flag } = await X;
  const at = '2026-10-31T21:00:00.000Z'; // Sat Oct 31, 5:00 PM EDT
  const d = deadline(ev({ at }), job);
  assert.equal(d.toISOString(), '2026-11-02T22:00:00.000Z', 'Mon Nov 2, 5:00 PM EST');
  const e = ev({ at });
  assert.equal(flag(e, job, d - 30 * H), 'ok');
  assert.equal(flag(e, job, d - 5 * H), 'soon');
  assert.equal(flag(e, job, d.getTime() + 1), 'late');
  assert.equal(flag(e, { ...job, noticeDays: null }, d - 30 * H), 'unset', 'no window: never a false green');
  assert.equal(flag(ev({ at, noticeSentAt: '2026-11-03T00:00:00.000Z' }), job, d.getTime() + 1), 'done');
  assert.equal(flag(ev({ at, coSubmittedAt: '2026-11-03T00:00:00.000Z' }), job, d.getTime() + 1), 'done', 'a CO submission is written notice');
  assert.equal(flag(ev({ at, voidedAt: '2026-11-01T00:00:00.000Z' }), job, d.getTime() + 1), 'void');
  assert.equal(flag(e, { ...job, noticeDays: 0 }, Date.parse(at) + 1), 'late', '"prior to proceeding" windows are entered as 0 days');
});

test('the notice has all four parts and says "to be determined" when nothing is priced', async () => {
  const { notice } = await X;
  const { subject, body } = notice(ev({ labor: [{ who: 'Crew A', st: 6, ot: 2 }] }), job, TZ);
  assert.equal(subject, 'Notice of change: Sample Tower, item 001');
  for (const part of ['1. Event: Directed extra work. Relocate four fixtures', '2. Cause or direction: Directed by Pat Sample (GC super).',
    '3. Impact on cost and schedule: to be determined. Recorded so far: 6 regular and 2 overtime labor hours.', '4. Reservation of rights:',
    'When: Mon, Nov 2, 7:00 AM', 'References: RFI 12', 'Contract reference: Subcontract 7.2']) assert.ok(body.includes(part), part);
  const bare = notice(ev({ kind: 'delay', area: '', refs: '', byName: '', byRole: 'GC PM' }), { ...job, clauseRef: '' }, TZ).body;
  assert.ok(bare.includes('2. Cause or direction: Caused by (GC PM).'));
  assert.ok(bare.includes('References: none'));
  assert.ok(!bare.includes('Where:') && !bare.includes('Contract reference') && !/\n\n\n/.test(bare), 'empty fields leave no blank lines');
  assert.ok(!/—/.test(bare), 'no em dashes in text he sends');
});

test('the Friday line counts open, unnoticed, late and pending COs per job', async () => {
  const { fridayLine } = await X;
  const now = Date.parse('2026-11-06T20:00:00.000Z');
  const list = [
    ev({ id: 'a', no: 1, at: '2026-11-02T12:00:00.000Z' }), // late
    ev({ id: 'b', no: 2, at: '2026-11-06T12:00:00.000Z' }), // ok
    ev({ id: 'c', no: 3, noticeSentAt: '2026-11-03T12:00:00.000Z' }),
    ev({ id: 'd', no: 4, noticeSentAt: '2026-11-03T12:00:00.000Z', coSubmittedAt: '2026-11-04T12:00:00.000Z', coAmount: 4200 }),
    ev({ id: 'e', no: 5, coSubmittedAt: '2026-11-04T12:00:00.000Z', coAmount: 800, decision: 'approved', decidedAt: '2026-11-05T12:00:00.000Z' }),
    ev({ id: 'f', no: 6, voidedAt: '2026-11-03T12:00:00.000Z', voidReason: 'duplicate' }),
    ev({ id: 'g', no: 1, job: 'Other' }),
  ];
  assert.equal(fridayLine(list, job, now),
    'Extras, Sample Tower: 4 open, 2 without written notice (1 past the notice window), 3 not yet submitted as a CO, 1 CO awaiting a decision ($4,200).');
  assert.equal(fridayLine([], { name: 'Empty', noticeDays: null }, now),
    'Extras, Empty: 0 open, 0 without written notice (notice window not set), 0 not yet submitted as a CO, 0 COs awaiting a decision.');
});

test('a signature or refusal freezes what the rep was shown; tracking stays editable; void freezes all', async () => {
  const { canEdit } = await X;
  const open = ev();
  for (const f of ['what', 'labor', 'photos', 'coNo', 'noticeSentAt']) assert.equal(canEdit(open, f), true, f);
  assert.equal(canEdit(open, 'job'), false, 'the job owns the number');
  for (const sig of [{ name: 'Pat Sample', at: '2026-11-02T13:00:00.000Z', strokes: [[0.1, 0.2, 0.3, 0.4]] }, { refused: true, reason: 'needs PM', at: '2026-11-02T13:00:00.000Z' }]) {
    const s = ev({ sig });
    for (const f of ['what', 'at', 'labor', 'material', 'photos']) assert.equal(canEdit(s, f), false, f);
    for (const f of ['coNo', 'coAmount', 'noticeSentAt', 'decision']) assert.equal(canEdit(s, f), true, f);
  }
  assert.equal(canEdit(ev({ voidedAt: '2026-11-03T12:00:00.000Z' }), 'coNo'), false);
});

test('re-issuing keeps the original, links the copy, and the notice already sent still counts', async () => {
  const { reissue, flag, status } = await X;
  const signed = ev({ sig: { name: 'Pat Sample', at: '2026-11-02T13:00:00.000Z', strokes: [] }, noticeSentAt: '2026-11-02T14:00:00.000Z' });
  const { voided, fresh } = reissue(signed, [signed], 'wrong level', 'e2', '2026-11-05T12:00:00.000Z');
  assert.equal(status(voided), 'void');
  assert.equal(voided.voidReason, 'wrong level');
  assert.deepEqual([fresh.no, fresh.replaces, fresh.sig, fresh.noticeSentAt], [2, 'e1', null, '2026-11-02T14:00:00.000Z']);
  assert.equal(flag(fresh, job, Date.parse('2026-11-30T00:00:00Z')), 'done');
});

test('the Todoist line has no Quick Add symbols and a date Quick Add understands', async () => {
  const { todoistLine } = await X;
  const e = ev({ job: 'Lot #4 @ Main/2nd', at: '2026-11-01T22:30:00.000Z' }); // Sun Nov 1, 5:30 PM EST
  const line = todoistLine(e, { ...job, name: e.job }, Date.parse('2026-11-01T23:00:00Z'), TZ);
  assert.equal(line, 'Send written notice: Lot 4 Main 2nd extra 001 (directed extra work) Nov 3 at 5:30pm p1');
  assert.match(todoistLine(e, { ...job, name: e.job }, Date.parse('2026-12-01T00:00:00Z'), TZ), / today p1$/, 'past the deadline: today');
});

test('a backup file is checked field by field before anything is merged', async () => {
  const { cleanImport, merge, validEvent } = await X;
  assert.throws(() => cleanImport({ app: 'other', version: 1, jobs: [], events: [] }), /not an Extras Log backup/);
  const good = ev({ photos: ['data:image/jpeg;base64,AAAA'] });
  const bad = [
    ev({ id: 'k1', kind: 'bribe' }),
    ev({ id: 'k2', photos: ['javascript:alert(1)'] }),
    ev({ id: 'k3', sig: { name: 'x', at: '2026-11-02T13:00:00Z', strokes: [[2]] } }),
    ev({ id: 'k4', what: '   ' }),
    ev({ id: 'k5', labor: [{ who: 'A', st: -3 }] }),
    ev({ id: 'k6', at: 'yesterday' }),
  ];
  for (const b of bad) assert.equal(validEvent(b), false, b.id);
  const r = cleanImport({ app: 'extras-log', version: 1, jobs: [job, { name: '' }], events: [good, ...bad] });
  assert.deepEqual([r.jobs.length, r.events.length, r.dropped], [1, 1, 7]);
  const older = ev({ what: 'old words', updatedAt: '2026-11-01T00:00:00.000Z' });
  const newer = ev({ what: 'new words', updatedAt: '2026-11-03T00:00:00.000Z' });
  assert.equal(merge([newer], [older], 'id').list[0].what, 'new words', 'an old backup never undoes newer work');
  const m = merge([older], [newer, ev({ id: 'e2', no: 2 })], 'id');
  assert.deepEqual([m.list.find(e => e.id === 'e1').what, m.added, m.updated, m.kept], ['new words', 1, 1, 0]);
});
