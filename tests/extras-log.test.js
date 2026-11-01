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

test('numbers are per job and never reused after a void or an import; clashes from a late restore are named', async () => {
  const { nextNo, reissue, merge, clashes } = await X;
  const list = [ev(), ev({ id: 'e2', no: 2 }), ev({ id: 'o1', job: 'Other', no: 9 })];
  assert.equal(nextNo(list, 'Sample Tower'), 3);
  assert.equal(nextNo(list, 'New job'), 1);
  const { voided, fresh } = reissue(list[1], list, 'wrong area', 'e3');
  const after = [list[0], voided, fresh, list[2]];
  assert.equal(fresh.no, 3);
  assert.equal(nextNo(after, 'Sample Tower'), 4, 'the voided number stays taken');
  const imported = merge(after, [ev({ id: 'e9', no: 7 })], 'id').list;
  assert.equal(nextNo(imported, 'Sample Tower'), 8);
  assert.deepEqual(clashes([ev({ id: 'new1' })], [ev(), ev({ id: 'e2', no: 2 })]), ['Sample Tower #001']);
  assert.deepEqual(clashes([ev()], [ev()]), [], 'the same item again is not a clash');
});

test('notice deadline keeps the wall-clock time across the DST change and flags late, soon, unset, done and rejected', async () => {
  const { deadline, flag, lateBy } = await X;
  const at = '2026-10-31T21:00:00.000Z'; // Sat Oct 31, 5:00 PM EDT
  const d = deadline(ev({ at }), job);
  assert.equal(d.toISOString(), '2026-11-02T22:00:00.000Z', 'Mon Nov 2, 5:00 PM EST');
  const e = ev({ at });
  assert.equal(flag(e, job, d - 30 * H), 'ok');
  assert.equal(flag(e, job, d - 5 * H), 'soon');
  assert.equal(flag(e, job, d.getTime() + 1), 'late');
  assert.equal(flag(e, { ...job, noticeDays: null }, d - 30 * H), 'unset', 'no window: never a false green');
  assert.equal(flag(ev({ at, noticeSentAt: '2026-11-02T00:00:00.000Z' }), job, d.getTime() + 1), 'done');
  assert.equal(flag(ev({ at, coSubmittedAt: '2026-11-02T00:00:00.000Z' }), job, d.getTime() + 1), 'done', 'a CO submission is written notice');
  assert.equal(flag(ev({ at, coSubmittedAt: '2026-11-02T00:00:00.000Z', decision: 'rejected', decidedAt: '2026-11-03T00:00:00.000Z' }), job), 'rejected', 'a rejection is not settled');
  assert.equal(flag(ev({ at, voidedAt: '2026-11-01T00:00:00.000Z' }), job, d.getTime() + 1), 'void');
  assert.equal(flag(e, { ...job, noticeDays: 0 }, Date.parse(at) + 1), 'late', '"prior to proceeding" windows are entered as 0 days');
  assert.equal(lateBy(ev({ at, noticeSentAt: '2026-11-03T22:00:00.000Z' }), job), 24 * H, 'a late notice stays visible as late');
  assert.equal(lateBy(ev({ at, noticeSentAt: '2026-11-03T22:00:00.000Z', coSubmittedAt: '2026-11-01T22:00:00.000Z' }), job), 0, 'the first written date counts');
  assert.equal(lateBy(e, job), 0);
  const zero = { ...job, noticeDays: 0 };
  assert.equal(lateBy(ev({ at, noticeSentAt: '2026-10-31T21:15:00.000Z' }), zero), 0, '0-day: a same-day notice is on time');
  assert.ok(lateBy(ev({ at, noticeSentAt: '2026-11-01T14:00:00.000Z' }), zero) > 0, '0-day: the next day is late');
});

test('the notice has all four parts, never blames our foreman or the GC person for a delay, and leaves out empty fields', async () => {
  const { notice, RELAYED } = await X;
  const { subject, body } = notice(ev({ labor: [{ who: 'Crew A', st: 6, ot: 2 }] }), job, TZ);
  assert.equal(subject, 'Notice of change: Sample Tower, item 001');
  for (const part of ['1. Event: Directed extra work. Relocate four fixtures', '2. Cause or direction: Directed by Pat Sample (GC super).',
    '3. Impact on cost and schedule: to be determined. Recorded so far: 6 regular and 2 overtime labor hours.', '4. Reservation of rights:',
    'When: Mon, Nov 2, 7:00 AM', 'References: RFI 12', 'Contract reference: Subcontract 7.2']) assert.ok(body.includes(part), part);
  const delay = notice(ev({ kind: 'delay', area: '', refs: '', byName: '', byRole: 'GC PM' }), { ...job, clauseRef: '' }, TZ);
  assert.equal(delay.subject, 'Notice of delay: Sample Tower, item 001');
  assert.ok(delay.body.includes('2. Cause: as described in item 1. Raised with GC PM.'));
  assert.ok(!/Caused by|References|Where:|Contract reference/.test(delay.body) && !/\n\n\n/.test(delay.body), 'no blame, no empty lines');
  const relayed = notice(ev({ byRole: RELAYED, byName: 'Sam' }), job, TZ).body;
  assert.ok(relayed.includes("2. Cause or direction: Directed by the GC's field staff, as relayed to us by our foreman Sam."));
  assert.ok(!/Directed by Sam/.test(relayed), 'never says our foreman directed it');
  assert.ok(!/—/.test(body + delay.body + relayed), 'no em dashes in text he sends');
});

test('the shared record states facts only: no deadline analysis, and the signed wording travels with the signature', async () => {
  const { record } = await X;
  const open = record(ev(), job, TZ);
  assert.ok(!/due|not sent|window/i.test(open), open);
  const signed = record(ev({ sig: { name: 'Pat Sample', at: '2026-11-02T13:00:00.000Z', strokes: [], text: 'I acknowledge X.' }, noticeSentAt: '2026-11-02T14:00:00.000Z' }), job, TZ);
  assert.ok(signed.includes('Acknowledged: I acknowledge X.\nSigned: Pat Sample, Mon, Nov 2, 8:00 AM\nNotice sent: Mon, Nov 2, 9:00 AM'));
  const { facts, addedSince, reissue } = await X;
  const base = ev({ labor: [{ who: 'Crew A', st: 6, ot: 2 }] });
  const sig = { name: 'Pat Sample', at: '2026-11-02T13:00:00.000Z', strokes: [], text: 'I acknowledge X.', shown: facts(base, TZ) };
  assert.equal(addedSince({ ...base, sig }), false);
  assert.equal(addedSince({ ...base, sig: { ...sig, shown: facts(base, 'America/Denver') } }), false, 'another time zone is not a change');
  const grown = { ...base, sig, labor: [...base.labor, { who: 'Crew B', st: 30, ot: 12 }] };
  const shared = record(grown, job, TZ);
  const snap = shared.indexOf('Added after the signature. What the rep was shown:\n' + sig.shown);
  assert.ok(snap > 0 && snap < shared.indexOf('Acknowledged:'), 'the shared record carries the snapshot, right above the signature');
  const { fresh } = reissue({ ...base, noticeSentAt: '2026-11-02T14:00:00.000Z' }, [base], 'wrong level', 'e2');
  assert.match(record(fresh, job, TZ), /Corrects item 001\.\nNotice sent:/);
  const unsent = reissue(base, [base], 'wrong level', 'e3').fresh;
  assert.ok(record(unsent, job, TZ).endsWith('Corrects item 001.'), 'correcting an unsent item never claims a notice went out');
  const newlySent = { ...unsent, noticeSentAt: '2026-11-05T15:00:00.000Z', noticeText: 'Notice under corrected item 002' };
  assert.doesNotMatch(record(newlySent, job, TZ), /went out under item/, 'a notice sent after correction cannot be attributed to the old item');
  const submitted = reissue({ ...base, coSubmittedAt: '2026-11-02T14:00:00.000Z' }, [base], 'wrong level', 'e4').fresh;
  assert.match(record(submitted, job, TZ), /Corrects item 001\.\nCO .* submitted/, 'a recorded CO submission remains in the corrected record');
});

test('sharing a record requires every photo and never silently falls back to text without attachments', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../docs/extras/app.mjs'), 'utf8');
  const code = source.slice(source.indexOf('async function shareRecord('), source.indexOf('async function sendNotice('));
  const sent = [], copied = [], warnings = [], photos = new Map();
  const navigator = { canShare: () => true, share: payload => { sent.push(payload); return Promise.resolve(); } };
  const share = vm.runInNewContext(`(${code})`, { X: await X, S: { photos }, navigator,
    slug: () => 'sample', dataFile: (data, name) => ({ data, name }), sigPng: () => 'signature',
    copy: text => copied.push(text), toast: text => warnings.push(text) });
  const item = ev({ photos: ['p1', 'p2'] });
  photos.set('p1', 'first photo');
  await share(item, job);
  assert.equal(sent.length, 0, 'a partially loaded record cannot open the share sheet');
  assert.equal(copied.length, 0, 'missing photos are not replaced with a text-only copy');
  assert.match(warnings.pop(), /photo could not be loaded/i);
  photos.set('p2', 'second photo');
  const sharing = share(item, job);
  assert.equal(sent.length, 1, 'the share sheet is opened synchronously in the tap, without awaiting storage');
  await sharing;
  assert.deepEqual(Array.from(sent[0].files, f => f.data), ['first photo', 'second photo']);
  navigator.canShare = () => false;
  await share(item, job);
  assert.equal(sent.length, 1);
  assert.equal(copied.length, 0, 'unsupported file sharing cannot silently drop the files');
  assert.match(warnings.pop(), /cannot share the attachments/);
  navigator.canShare = () => true;
  navigator.share = () => Promise.reject(new Error('file sharing failed'));
  await share(item, job);
  assert.equal(copied.length, 0, 'a failed file share cannot become a text-only success');
  assert.match(warnings.pop(), /attachments were not shared/);
});

test('the Friday line counts open, unnoticed, late, pending, noticed-late and rejected per job', async () => {
  const { fridayLine, usd } = await X;
  const now = Date.parse('2026-11-06T20:00:00.000Z');
  const list = [
    ev({ id: 'a', no: 1, at: '2026-11-02T12:00:00.000Z' }), // late
    ev({ id: 'b', no: 2, at: '2026-11-06T12:00:00.000Z' }), // ok
    ev({ id: 'c', no: 3, noticeSentAt: '2026-11-03T12:00:00.000Z' }),
    ev({ id: 'd', no: 4, noticeSentAt: '2026-11-03T12:00:00.000Z', coSubmittedAt: '2026-11-04T12:00:00.000Z', coAmount: 4200.5 }),
    ev({ id: 'e', no: 5, coSubmittedAt: '2026-11-04T12:00:00.000Z', coAmount: 800, decision: 'approved', decidedAt: '2026-11-05T12:00:00.000Z' }),
    ev({ id: 'f', no: 6, voidedAt: '2026-11-03T12:00:00.000Z', voidReason: 'duplicate' }),
    ev({ id: 'g', no: 1, job: 'Other' }),
    ev({ id: 'h', no: 7, noticeSentAt: '2026-11-05T12:00:00.000Z' }), // noticed a day late
    ev({ id: 'i', no: 8, coSubmittedAt: '2026-11-03T12:00:00.000Z', coAmount: 900, decision: 'rejected', decidedAt: '2026-11-05T12:00:00.000Z' }),
  ];
  assert.equal(fridayLine(list, job, now),
    'Extras, Sample Tower: 5 open, 2 without written notice (1 past the notice window), 4 not yet submitted as a CO, 1 CO awaiting a decision ($4,200.50), 1 noticed after the window, 1 rejected.');
  assert.equal(fridayLine([], { name: 'Empty', noticeDays: null }, now),
    'Extras, Empty: 0 open, 0 without written notice (notice window not set), 0 not yet submitted as a CO, 0 COs awaiting a decision.');
  assert.deepEqual([usd(4500), usd(0.4)], ['$4,500', '$0.40']);
});

test('a signature or refusal fixes the description; hours, material and photos keep accumulating; void freezes all', async () => {
  const { canEdit, ack } = await X;
  const open = ev();
  for (const f of ['what', 'labor', 'photos', 'coNo', 'noticeSentAt']) assert.equal(canEdit(open, f), true, f);
  assert.equal(canEdit(open, 'job'), false, 'the job owns the number');
  for (const sig of [{ name: 'Pat Sample', at: '2026-11-02T13:00:00.000Z', strokes: [[0.1, 0.2, 0.3, 0.4]] }, { refused: true, reason: 'needs PM', at: '2026-11-02T13:00:00.000Z' }]) {
    const s = ev({ sig });
    for (const f of ['what', 'at', 'kind', 'byName', 'area']) assert.equal(canEdit(s, f), false, f);
    for (const f of ['labor', 'material', 'photos', 'coNo', 'noticeSentAt', 'decision']) assert.equal(canEdit(s, f), true, f);
  }
  assert.equal(canEdit(ev({ voidedAt: '2026-11-03T12:00:00.000Z' }), 'coNo'), false);
  assert.match(ack('directive'), /directed on the date shown.*recorded to date.*Cost and time to follow/);
  assert.ok(!/performed/.test(ack('directive')), 'the rep is not asked to confirm work not yet done');
  assert.match(ack('delay'), /condition described in this record occurred/);
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

test('the Todoist line has no Quick Add symbols and is due before the window closes', async () => {
  const { todoistLine } = await X;
  const e = ev({ job: 'Lot #4 @ Main/2nd', at: '2026-11-01T22:30:00.000Z' }); // Sun Nov 1, 5:30 PM EST; window closes Tue 5:30 PM
  const line = todoistLine(e, { ...job, name: e.job }, Date.parse('2026-11-01T23:00:00Z'), TZ);
  assert.equal(line, 'Send written notice: Lot 4 Main 2nd extra 001 (directed extra work) Nov 3 at 5:30am p1', '12 h ahead');
  assert.match(todoistLine(e, { ...job, name: e.job }, Date.parse('2026-11-03T20:30:00Z'), TZ), / Nov 3 at 4:30pm p1$/, 'halfway when under 24 h are left');
  assert.match(todoistLine(e, { ...job, name: e.job }, Date.parse('2026-12-01T00:00:00Z'), TZ), / today p1$/, 'past the deadline: today');
});

test('a backup file is checked field by field before anything is merged', async () => {
  const { cleanImport, merge, validEvent } = await X;
  assert.throws(() => cleanImport({ app: 'other', version: 1, jobs: [], events: [] }), /not an Extras Log backup/);
  const good = ev({ photos: ['data:image/jpeg;base64,AAAA'], sig: { name: 'P', at: '2026-11-02T13:00:00Z', strokes: [[0.1, 0.2]], text: 'I acknowledge', shown: 'Sample' } });
  assert.equal(validEvent(good), true);
  const { labor, ...noLabor } = ev({ id: 'k8' });
  const bad = [
    ev({ id: 'k1', kind: 'bribe' }),
    ev({ id: 'k2', photos: ['javascript:alert(1)'] }),
    ev({ id: 'k3', sig: { name: 'x', at: '2026-11-02T13:00:00Z', strokes: [[2]] } }),
    ev({ id: 'k4', what: '   ' }),
    ev({ id: 'k5', labor: [{ who: 'A', st: -3 }] }),
    ev({ id: 'k6', at: 'yesterday' }),
    ev({ id: 'k7', kind: 'constructor' }),
    noLabor,
    ev({ id: 'k9/void' }),
    ev({ id: 'k10', photos: ['data:image/jpeg;base64,AAAAA'] }),
    ev({ id: 'k11', coSubmittedAt: '2026-11-03T00:00:00Z', decision: 'approved' }),
    ev({ id: 'k12', replaces: '../x' }),
  ];
  for (const b of bad) assert.equal(validEvent(b), false, b.id);
  const r = cleanImport({ app: 'extras-log', version: 1, jobs: [job, { name: '' }], events: [good, ...bad] });
  assert.deepEqual([r.jobs.length, r.events.length, r.dropped], [1, 1, 1 + bad.length]);
  const older = ev({ what: 'old words', updatedAt: '2026-11-01T00:00:00.000Z' });
  const newer = ev({ what: 'new words', updatedAt: '2026-11-03T00:00:00.000Z' });
  assert.equal(merge([newer], [older], 'id').list[0].what, 'new words', 'an old backup never undoes newer work');
  const m = merge([older], [newer, ev({ id: 'e2', no: 2 })], 'id');
  assert.deepEqual([m.list.find(e => e.id === 'e1').what, m.added, m.updated, m.kept], ['new words', 1, 1, 0]);
});
