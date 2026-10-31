// Data layer tests: src/db.js against node:sqlite through the D1 adapter. Sample data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTestDb } from './helpers/d1.mjs';
import * as db from '../src/db.js';

const { ScopeError, ConflictError, NotFoundError, ValidationError } = db;

const T0 = '2026-10-30T15:00:00.000Z';
const T1 = '2026-10-30T15:01:00.000Z';
const T2 = '2026-10-30T15:02:00.000Z';
const T3 = '2026-10-30T15:03:00.000Z';
const T4 = '2026-10-30T15:04:00.000Z';

async function capture(d, id, text, scope = 'work', extra = {}) {
  return db.saveCapture(d, { id, text, scope, source: 'app', timeZone: 'America/New_York', sample: 1, ...extra }, T0);
}

async function count(d, sql, ...p) {
  const s = d.prepare(sql);
  const row = await (p.length ? s.bind(...p) : s).first();
  return Number(Object.values(row)[0]);
}

// ---------------------------------------------------------------- adapter

test('adapter: batch is atomic and undefined binds throw like D1', async () => {
  const d = createTestDb();
  await assert.rejects(
    d.batch([
      d.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('a', '1'),
      d.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('a', '2'),
    ]),
  );
  assert.equal(await count(d, 'SELECT COUNT(*) FROM meta'), 0);
  assert.throws(() => d.prepare('SELECT ?').bind(undefined), /D1_TYPE_ERROR/);
  const r = await d.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('b', true).run();
  assert.equal(r.meta.changes, 1);
  assert.equal(await d.prepare('SELECT value FROM meta WHERE key = ?').bind('b').first('value'), '1');
});

// ---------------------------------------------------------------- captures and proposals

test('saveCapture is idempotent by id; same id with different text is a conflict', async () => {
  const d = createTestDb();
  const a = await capture(d, 'cap-idem-01', 'Call the inspector about panel B');
  assert.equal(a.duplicate, false);
  assert.equal(a.capture.review_state, 'pending');
  assert.equal(a.capture.received_at, T0);
  const b = await capture(d, 'cap-idem-01', 'Call the inspector about panel B');
  assert.equal(b.duplicate, true);
  assert.equal(b.capture.receive_count, 2);
  assert.equal(await count(d, 'SELECT COUNT(*) FROM captures'), 1);
  assert.equal(await count(d, "SELECT COUNT(*) FROM fts_work WHERE ref = 'capture:cap-idem-01'"), 1);
  await assert.rejects(capture(d, 'cap-idem-01', 'Different words'), ConflictError);
  await assert.rejects(capture(d, 'cap-idem-01', 'Call the inspector about panel B', 'personal'), ConflictError);
  await assert.rejects(capture(d, 'cap-idem-02', 'x', 'all'), ScopeError);
  await assert.rejects(capture(d, 'bad id!', 'x'), ValidationError);
  await assert.rejects(capture(d, 'cap-idem-03', '   '), ValidationError);
});

test('saveProposals is idempotent per (capture_id, ordinal) and keeps the first payload', async () => {
  const d = createTestDb();
  await capture(d, 'cap-prop-01', 'Need to order breakers. Idea: label the spares.');
  const first = [
    { ordinal: 0, kind: 'task', title: 'order breakers', fields: {}, sourceQuote: 'Need to order breakers.', needsReview: [] },
    { ordinal: 1, kind: 'idea', title: 'label the spares', fields: {}, sourceQuote: 'Idea: label the spares.', needsReview: [] },
  ];
  const a = await db.saveProposals(d, 'cap-prop-01', first);
  assert.equal(a.length, 2);
  const b = await db.saveProposals(d, 'cap-prop-01', [{ ...first[0], title: 'changed' }, first[1]]);
  assert.equal(b.length, 2);
  assert.equal(b[0].payload.title, 'order breakers');
  assert.equal(b[0].scope, 'work');
  assert.equal(await count(d, 'SELECT COUNT(*) FROM proposals'), 2);
  await assert.rejects(db.saveProposals(d, 'cap-missing-1', first), NotFoundError);
  await assert.rejects(db.saveProposals(d, 'cap-prop-01', first, 'personal'), NotFoundError);
  await assert.rejects(db.saveProposals(d, 'cap-prop-01', [{ ordinal: 5, kind: 'nonsense' }]), ValidationError);
});

// ---------------------------------------------------------------- review

async function seedReview(d, id = 'cap-rev-001', scope = 'work') {
  await capture(d, id, 'Mike asked me to send the panel schedule. Waiting on the meter from Duke. Idea: color tags.', scope);
  await db.saveProposals(d, id, [
    { ordinal: 0, kind: 'task', title: 'send the panel schedule', fields: { claim: { by: 'Mike', status: 'requested' } }, sourceQuote: 'Mike asked me to send the panel schedule.' },
    { ordinal: 1, kind: 'waiting', title: 'the meter', fields: { who: 'Duke' }, sourceQuote: 'Waiting on the meter from Duke.' },
    { ordinal: 2, kind: 'idea', title: 'color tags', fields: {}, sourceQuote: 'Idea: color tags.' },
  ]);
}

test('review: accept creates items with provenance, drop and keepAsNote set states, replay is idempotent', async () => {
  const d = createTestDb();
  await seedReview(d);
  let inbox = await db.getInbox(d, 'work');
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].proposals.length, 3);

  const r1 = await db.reviewCapture(d, 'cap-rev-001', { accept: [{ ordinal: 0 }], drop: [] }, 'work', T1);
  assert.equal(r1.items.length, 1);
  const task = r1.items[0];
  assert.equal(task.kind, 'task');
  assert.equal(task.origin, 'capture');
  assert.equal(task.source_capture_id, 'cap-rev-001');
  assert.equal(task.source_quote, 'Mike asked me to send the panel schedule.');
  assert.equal(task.claim_by, 'Mike');
  assert.equal(task.claim_status, 'requested');
  assert.equal(r1.capture.review_state, 'pending', 'other proposals are still pending');
  assert.equal(r1.changeIds.length, 1);

  // Replay of the same request returns the same item and creates nothing new.
  const again = await db.reviewCapture(d, 'cap-rev-001', { accept: [{ ordinal: 0 }], drop: [] }, 'work', T1);
  assert.equal(again.items.length, 1);
  assert.equal(again.items[0].id, task.id);
  assert.equal(await count(d, 'SELECT COUNT(*) FROM items'), 1);

  // Accept the waiting item with an edit; drop the idea.
  const r2 = await db.reviewCapture(
    d,
    'cap-rev-001',
    { accept: [{ ordinal: 1, edits: { followUpOn: '2026-11-02' } }], drop: [2] },
    'work',
    T2,
  );
  const waiting = r2.items[0];
  assert.equal(waiting.kind, 'waiting');
  assert.equal(waiting.who, 'Duke');
  assert.equal(waiting.claim_status, 'unspecified', 'ambiguity is unspecified, never requested');
  assert.equal(waiting.follow_up_on, '2026-11-02');
  assert.equal(r2.capture.review_state, 'reviewed');
  const states = (await d.prepare('SELECT ordinal, state FROM proposals ORDER BY ordinal').all()).results.map((r) => r.state);
  assert.deepEqual(states, ['accepted', 'accepted', 'dropped']);
  inbox = await db.getInbox(d, 'work');
  assert.equal(inbox.length, 0);

  await assert.rejects(db.reviewCapture(d, 'cap-rev-001', { accept: [{ ordinal: 2 }] }, 'work', T3), ConflictError);
  await assert.rejects(db.reviewCapture(d, 'cap-rev-001', { drop: [0] }, 'work', T3), ConflictError);
  await assert.rejects(db.reviewCapture(d, 'cap-rev-001', { accept: [{ ordinal: 9 }] }, 'work', T3), ValidationError);
  await assert.rejects(db.reviewCapture(d, 'cap-rev-001', {}, 'personal', T3), NotFoundError);
});

test('review: keepAsNote, nothing accepted gives note; personal capture cannot produce work items', async () => {
  const d = createTestDb();
  await seedReview(d, 'cap-note-01');
  const r = await db.reviewCapture(d, 'cap-note-01', { accept: [], drop: [], keepAsNote: true }, 'work', T1);
  assert.equal(r.capture.review_state, 'note');
  assert.equal(r.items.length, 0);
  assert.equal(await count(d, "SELECT COUNT(*) FROM proposals WHERE state = 'dropped'"), 3);

  await seedReview(d, 'cap-note-02');
  const r2 = await db.reviewCapture(d, 'cap-note-02', { drop: [0, 1, 2] }, 'work', T1);
  assert.equal(r2.capture.review_state, 'note');

  await seedReview(d, 'cap-note-03', 'personal');
  await assert.rejects(
    db.reviewCapture(d, 'cap-note-03', { accept: [{ ordinal: 2, edits: { scope: 'work' } }] }, 'personal', T1),
    ScopeError,
  );
  // Work capture may become a personal item (more restrictive).
  await seedReview(d, 'cap-note-04');
  const r4 = await db.reviewCapture(d, 'cap-note-04', { accept: [{ ordinal: 2, edits: { scope: 'personal' } }] }, 'work', T1);
  assert.equal(r4.items[0].scope, 'personal');
  assert.equal(await count(d, "SELECT COUNT(*) FROM fts_personal WHERE ref = ?", `item:${r4.items[0].id}`), 1);
  assert.equal(await count(d, "SELECT COUNT(*) FROM fts_work WHERE ref = ?", `item:${r4.items[0].id}`), 0);
});

test('review: a reminder proposal creates a reminder row; without a time it is refused', async () => {
  const d = createTestDb();
  await capture(d, 'cap-remind-1', 'Remind me tomorrow at 3pm to call the supply house.');
  await db.saveProposals(d, 'cap-remind-1', [
    { ordinal: 0, kind: 'reminder', title: 'call the supply house', fields: { when: { kind: 'datetime', on: '2026-10-31', time: '15:00' } }, sourceQuote: 'x' },
    { ordinal: 1, kind: 'reminder', title: 'something', fields: { when: { kind: 'date', on: '2026-10-31' } }, sourceQuote: 'y' },
  ]);
  await assert.rejects(db.reviewCapture(d, 'cap-remind-1', { accept: [{ ordinal: 1 }] }, 'work', T1), ValidationError);
  const r = await db.reviewCapture(d, 'cap-remind-1', { accept: [{ ordinal: 0 }], drop: [1] }, 'work', T1);
  assert.equal(r.reminders.length, 1);
  const rem = r.reminders[0];
  assert.equal(rem.scope, 'work');
  assert.equal(rem.local_date, '2026-10-31');
  assert.equal(rem.local_time, '15:00');
  assert.equal(rem.time_zone, 'America/New_York');
  assert.equal(rem.next_fire_at, Date.parse('2026-10-31T19:00:00.000Z'));
  assert.equal(rem.state, 'active');
  assert.equal(r.capture.review_state, 'reviewed');
});

test('review: a date mentioned in a task sentence is not made a hard date; an explicit Due edit is', async () => {
  const d = createTestDb();
  await capture(d, 'cap-when-01', 'Jeff asked for two more electricians Friday, need to check with the office.');
  const when = { kind: 'date', on: '2026-11-06', needsTimeCheck: false, original: 'Friday' };
  await db.saveProposals(d, 'cap-when-01', [
    { ordinal: 1, kind: 'task', title: 'two more electricians Friday', fields: { claim: { by: 'Jeff', status: 'requested' }, when }, sourceQuote: 'x', needsReview: ['check_date'] },
  ]);
  const r = await db.reviewCapture(d, 'cap-when-01', { accept: [{ ordinal: 1 }] }, 'work', T1);
  assert.equal(r.items[0].due_on, null);
  assert.equal(r.items[0].claim_status, 'requested');

  await capture(d, 'cap-when-02', 'Need to order breakers Friday.');
  await db.saveProposals(d, 'cap-when-02', [{ ordinal: 1, kind: 'task', title: 'order breakers Friday', fields: { when }, sourceQuote: 'y' }]);
  const r2 = await db.reviewCapture(d, 'cap-when-02', { accept: [{ ordinal: 1, edits: { due_on: '2026-11-06' } }] }, 'work', T1);
  assert.equal(r2.items[0].due_on, '2026-11-06');
});

// ---------------------------------------------------------------- items, changes, undo

test('item lifecycle writes one change each; undo restores; undo conflicts when state moved on', async () => {
  const d = createTestDb();
  const c = await db.createItem(d, { kind: 'task', title: 'Pull permit', dueOn: '2026-11-03' }, 'work', T0);
  assert.equal(c.item.state, 'open');
  assert.equal(c.item.origin, 'user');
  assert.ok(c.changeId > 0);

  const u = await db.updateItem(d, c.item.id, { title: 'Pull electrical permit' }, 'work', T1);
  assert.equal(u.item.title, 'Pull electrical permit');
  const done = await db.completeItem(d, c.item.id, 'work', T2);
  assert.equal(done.item.state, 'done');
  assert.equal(done.item.done_at, T2);
  assert.equal(await count(d, 'SELECT COUNT(*) FROM changes WHERE entity_id = ?', c.item.id), 3);

  // Undo the completion.
  const und = await db.undoChange(d, done.changeId, T3);
  assert.equal(und.row.state, 'open');
  const now = await db.getItem(d, c.item.id, 'work');
  assert.equal(now.state, 'open');
  assert.equal(now.done_at, null);
  await assert.rejects(db.undoChange(d, done.changeId, T3), ConflictError, 'already undone');

  // Archive, reopen, then try to undo the old title edit: state moved on -> conflict.
  const arc = await db.archiveItem(d, c.item.id, 'work', T3);
  assert.equal(arc.item.state, 'archived');
  const re = await db.reopenItem(d, c.item.id, 'work', T4);
  assert.equal(re.item.state, 'open');
  await assert.rejects(db.undoChange(d, u.changeId, T4), (e) => e instanceof ConflictError && e.reason === 'state_moved_on');
  assert.equal((await db.getItem(d, c.item.id, 'work')).title, 'Pull electrical permit');

  // Undo the reopen, then the archive, in order: both succeed.
  await db.undoChange(d, re.changeId, T4);
  assert.equal((await db.getItem(d, c.item.id, 'work')).state, 'archived');
  await db.undoChange(d, arc.changeId, T4);
  assert.equal((await db.getItem(d, c.item.id, 'work')).state, 'open');

  // Undo with the wrong scope is not found; unknown change is not found.
  const t = await db.completeItem(d, c.item.id, 'work', T4);
  await assert.rejects(db.undoChange(d, t.changeId, T4, 'personal'), NotFoundError);
  await assert.rejects(db.undoChange(d, 999999, T4), NotFoundError);

  // Completing twice is a no-op without a new change.
  const twice = await db.completeItem(d, c.item.id, 'work', T4);
  assert.equal(twice.changeId, null);
});

test('undo of an edit re-syncs search; undo of an accepted item returns its capture to the inbox', async () => {
  const d = createTestDb();
  const c = await db.createItem(d, { kind: 'reference', title: 'Torque table for lugs' }, 'work', T0);
  const u = await db.updateItem(d, c.item.id, { title: 'Conduit fill chart' }, 'work', T1);
  assert.equal((await db.search(d, 'torque', 'work')).length, 0);
  assert.equal((await db.search(d, 'conduit', 'work')).length, 1);
  await db.undoChange(d, u.changeId, T2);
  assert.equal((await db.search(d, 'torque', 'work')).length, 1);
  assert.equal((await db.search(d, 'conduit', 'work')).length, 0);

  await seedReview(d, 'cap-undo-01');
  const r = await db.reviewCapture(d, 'cap-undo-01', { accept: [{ ordinal: 2 }], drop: [0, 1] }, 'work', T1);
  assert.equal(r.capture.review_state, 'reviewed');
  await db.undoChange(d, r.changeIds[0], T2);
  assert.equal(await db.getItem(d, r.items[0].id, 'work'), null);
  const inbox = await db.getInbox(d, 'work');
  assert.equal(inbox.length, 1);
  assert.deepEqual(inbox[0].proposals.map((p) => p.ordinal), [2]);
});

test('undo of a create that loses a race to an edit changes nothing: item, search row, capture and proposal stay', async () => {
  const d = createTestDb();
  await seedReview(d, 'cap-race-01');
  const r = await db.reviewCapture(d, 'cap-race-01', { accept: [{ ordinal: 0 }], drop: [1, 2] }, 'work', T1);
  const itemId = r.items[0].id;
  // An edit lands between undoChange's read and its batch.
  const realBatch = d.batch.bind(d);
  let raced = false;
  d.batch = async (statements) => {
    if (!raced) {
      raced = true;
      await d.prepare('UPDATE items SET today_pick = 1, updated_at = ? WHERE id = ?').bind(T3, itemId).run();
    }
    return realBatch(statements);
  };
  await assert.rejects(db.undoChange(d, r.changeIds[0], T2), (e) => e instanceof ConflictError && e.reason === 'concurrent_change');
  d.batch = realBatch;
  assert.ok(await db.getItem(d, itemId, 'work'), 'the item still exists');
  assert.equal(await count(d, 'SELECT COUNT(*) FROM fts_work WHERE ref = ?', `item:${itemId}`), 1, 'its search row is kept');
  assert.equal((await db.search(d, 'panel schedule', 'work')).filter((h) => h.ref === `item:${itemId}`).length, 1);
  assert.equal(await count(d, "SELECT COUNT(*) FROM captures WHERE id = 'cap-race-01' AND review_state = 'reviewed'"), 1);
  assert.equal(await count(d, "SELECT COUNT(*) FROM proposals WHERE capture_id = 'cap-race-01' AND state = 'accepted' AND item_id = ?", itemId), 1);
  assert.equal(await count(d, 'SELECT COUNT(*) FROM changes WHERE id = ? AND undone_at IS NULL', r.changeIds[0]), 1);
  assert.equal((await db.getInbox(d, 'work')).length, 0, 'the capture is not back in the inbox');
});

test('updateItem validates and never changes scope; claim_status changes only by explicit edit', async () => {
  const d = createTestDb();
  const w = await db.createItem(d, { kind: 'waiting', title: 'fixture count', who: 'Ana' }, 'work', T0);
  assert.equal(w.item.claim_status, 'unspecified');
  await assert.rejects(db.updateItem(d, w.item.id, { scope: 'personal' }, 'work', T1), ValidationError);
  await assert.rejects(db.updateItem(d, w.item.id, { claimStatus: 'probably' }, 'work', T1), ValidationError);
  await assert.rejects(db.updateItem(d, w.item.id, { state: 'done' }, 'work', T1), ValidationError);
  await assert.rejects(db.updateItem(d, w.item.id, { title: 'x' }, 'personal', T1), NotFoundError);
  await assert.rejects(db.updateItem(d, w.item.id, { dueOn: '2026-02-30' }, 'work', T1), ValidationError);
  const reply = await db.recordReply(d, w.item.id, 'work', T1);
  assert.equal(reply.item.claim_status, 'unspecified', 'a reply never upgrades the status');
  const e = await db.updateItem(d, w.item.id, { claimStatus: 'confirmed' }, 'work', T2);
  assert.equal(e.item.claim_status, 'confirmed');
  const ch = await d.prepare('SELECT op, before_json, after_json FROM changes WHERE id = ?').bind(e.changeId).first();
  assert.equal(ch.op, 'update');
  assert.equal(JSON.parse(ch.before_json).claim_status, 'unspecified');
  assert.equal(JSON.parse(ch.after_json).claim_status, 'confirmed');
});

test('recordReply and snoozeFollowUp on waiting items', async () => {
  const d = createTestDb();
  const w = await db.createItem(
    d,
    { kind: 'waiting', title: 'shop drawings', who: 'Greg', askedOn: '2026-10-20', followUpOn: '2026-10-30' },
    'work',
    T0,
  );
  const r = await db.recordReply(d, w.item.id, 'work', T1);
  assert.equal(r.item.reply_recorded_at, T1);
  assert.equal(r.item.follow_up_on, '2026-10-30');
  assert.ok(r.changeId > 0);
  const s = await db.snoozeFollowUp(d, w.item.id, '2026-11-04', 'work', T2);
  assert.equal(s.item.follow_up_on, '2026-11-04');
  const ch = await d.prepare('SELECT op FROM changes WHERE id = ?').bind(s.changeId).first();
  assert.equal(ch.op, 'snooze');
  await assert.rejects(db.snoozeFollowUp(d, w.item.id, 'next week', 'work', T2), ValidationError);
  const t = await db.createItem(d, { kind: 'task', title: 'a task' }, 'work', T0);
  await assert.rejects(db.recordReply(d, t.item.id, 'work', T1), ValidationError);
  await assert.rejects(db.snoozeFollowUp(d, t.item.id, '2026-11-04', 'work', T1), ValidationError);
  await db.undoChange(d, s.changeId, T3);
  assert.equal((await db.getItem(d, w.item.id, 'work')).follow_up_on, '2026-10-30');
});

test('waiting items never appear in tasks; listForToday rows', async () => {
  const d = createTestDb();
  await db.createItem(d, { kind: 'task', title: 'Order wire', todayPick: true }, 'work', T0);
  await db.createItem(d, { kind: 'task', title: 'Overdue task', dueOn: '2026-10-28' }, 'work', T0);
  await db.createItem(d, { kind: 'task', title: 'Far task', dueOn: '2026-12-01' }, 'work', T0);
  await db.createItem(d, { kind: 'reference', title: 'Dated ref', dueOn: '2026-11-05' }, 'work', T0);
  await db.createItem(d, { kind: 'waiting', title: 'Due follow-up', who: 'Ana', followUpOn: '2026-10-30', promisedOn: '2026-10-29' }, 'work', T0);
  await db.createItem(d, { kind: 'waiting', title: 'Later follow-up', followUpOn: '2026-11-10', dueOn: '2026-10-29' }, 'work', T0);
  await capture(d, 'cap-today-1', 'loose note');
  const rows = await db.listForToday(d, 'work', '2026-10-30');
  assert.deepEqual(rows.tasks.map((t) => t.title).sort(), ['Far task', 'Order wire', 'Overdue task']);
  assert.ok(rows.tasks.every((t) => t.kind === 'task'));
  assert.equal(rows.waiting.length, 2);
  assert.equal(rows.waitingCount, 2);
  assert.deepEqual(rows.hardDates.map((t) => t.title), ['Overdue task', 'Dated ref']);
  assert.ok(rows.hardDates.every((t) => t.kind !== 'waiting'), 'a waiting item is never a hard-dated task');
  assert.equal(rows.inboxCount, 1);
  const all = await db.listForToday(d, 'all', '2026-10-30');
  assert.equal(all.tasks.length, 3);
  await assert.rejects(db.listForToday(d, 'work', '10/30/2026'), ValidationError);
});

// ---------------------------------------------------------------- decisions

test('decisions: supersede keeps both searchable, current first', async () => {
  const d = createTestDb();
  const p = await db.createProject(d, { name: 'Clinic fit-out' }, 'work', T0);
  const a = await db.createDecision(d, { title: 'Use aluminum feeders', reason: 'cost', projectId: p.project.id }, 'work', T0);
  const b = await db.createDecision(
    d,
    { title: 'Use copper feeders', reason: 'inspector preference over aluminum', supersedesId: a.item.id, projectId: p.project.id },
    'work',
    T1,
  );
  assert.equal(b.item.supersedes_id, a.item.id);
  assert.equal(b.superseded.superseded_by_id, b.item.id);
  const hits = await db.search(d, 'feeders', 'work');
  assert.equal(hits.length, 2);
  assert.equal(hits[0].id, b.item.id);
  assert.equal(hits[0].superseded, false);
  assert.equal(hits[1].id, a.item.id);
  assert.equal(hits[1].superseded, true);
  const proj = await db.getProject(d, p.project.id, 'work');
  assert.deepEqual(proj.decisions.map((x) => [x.id, x.superseded]), [[b.item.id, false], [a.item.id, true]]);
  await assert.rejects(db.createDecision(d, { title: 'Third', supersedesId: a.item.id }, 'work', T2), ConflictError);
  // Undoing the new decision restores the old one as current.
  await db.undoChange(d, b.changeId, T2);
  assert.equal((await db.getItem(d, a.item.id, 'work')).superseded_by_id, null);
  const after = await db.search(d, 'feeders', 'work');
  assert.deepEqual(after.map((h) => [h.id, h.superseded]), [[a.item.id, false]]);
});

// ---------------------------------------------------------------- projects and checkpoints

test('projects: getProject, verbatim checkpoint prefill, one-tap save touches last_touched_at', async () => {
  const d = createTestDb();
  const p = await db.createProject(d, { name: 'Warehouse lighting', purpose: 'Retrofit to LED' }, 'work', T0);
  assert.equal(p.project.state, 'active');

  // Empty project: prefill is all null and saving it is allowed.
  const empty = await db.checkpointPrefill(d, p.project.id, 'work');
  assert.deepEqual(empty, { stoppedAtText: null, openQuestion: null, nextStep: null, sourceRef: null });

  const text = 'Stopped at row 14 of the fixture schedule, 3 of 9 bays done.\nDoes bay 7 need emergency heads?  Ask Ana.';
  await capture(d, 'cap-proj-001', text);
  await db.saveProposals(d, 'cap-proj-001', [
    { ordinal: 0, kind: 'task', title: 'finish row 15 of the fixture schedule', fields: {}, sourceQuote: 'Stopped at row 14' },
  ]);
  await db.reviewCapture(d, 'cap-proj-001', { accept: [{ ordinal: 0, edits: { projectId: p.project.id } }] }, 'work', T1);
  await db.createItem(d, { kind: 'waiting', title: 'emergency head spec', who: 'Ana', projectId: p.project.id }, 'work', T1);

  const pre = await db.checkpointPrefill(d, p.project.id, 'work');
  assert.equal(pre.stoppedAtText, text, 'stopped-at text is the capture, verbatim');
  assert.equal(pre.sourceRef, 'capture:cap-proj-001');
  assert.equal(pre.openQuestion, 'Does bay 7 need emergency heads?');
  assert.ok(text.includes(pre.openQuestion), 'open question is copied, not rewritten');
  assert.equal(pre.nextStep, 'finish row 15 of the fixture schedule');

  const saved = await db.saveCheckpoint(d, p.project.id, null, 'work', T3);
  assert.equal(saved.checkpoint.stopped_at_text, text);
  assert.equal(saved.checkpoint.open_question, pre.openQuestion);
  assert.equal(saved.checkpoint.next_step, pre.nextStep);
  assert.equal(saved.checkpoint.source_ref, pre.sourceRef);

  const view = await db.getProject(d, p.project.id, 'work');
  assert.equal(view.project.last_touched_at, T3);
  assert.equal(view.checkpoint.id, saved.checkpoint.id);
  assert.equal(view.nextItem.title, 'finish row 15 of the fixture schedule');
  assert.equal(view.waiting.length, 1);
  assert.equal(view.recentCaptures[0].id, 'cap-proj-001');

  // Edit: given fields replace, missing ones keep the prefill, '' clears.
  const edited = await db.saveCheckpoint(d, p.project.id, { nextStep: 'Order 6 heads', openQuestion: '' }, 'work', T4);
  assert.equal(edited.checkpoint.next_step, 'Order 6 heads');
  assert.equal(edited.checkpoint.open_question, null);
  assert.equal(edited.checkpoint.stopped_at_text, text);
  assert.equal((await db.getProject(d, p.project.id, 'work')).checkpoint.id, edited.checkpoint.id);

  await assert.rejects(db.saveCheckpoint(d, p.project.id, { sourceRef: 'javascript:alert(1)' }, 'work', T4), ValidationError);
  await assert.rejects(db.checkpointPrefill(d, p.project.id, 'personal'), NotFoundError);
  assert.equal(await db.getProject(d, p.project.id, 'personal'), null);
});

test('projects: list, update with change row, undo, items must share the project scope', async () => {
  const d = createTestDb();
  const w = await db.createProject(d, { name: 'Work proj' }, 'work', T0);
  const h = await db.createProject(d, { name: 'Home proj' }, 'personal', T1);
  const u = await db.updateProject(d, w.project.id, { state: 'done' }, 'work', T2);
  assert.equal(u.project.state, 'done');
  assert.deepEqual((await db.listProjects(d, 'work')).map((p) => p.name), ['Work proj']);
  assert.deepEqual((await db.listProjects(d, 'all')).map((p) => p.name), ['Home proj', 'Work proj']);
  await db.undoChange(d, u.changeId, T3);
  assert.equal((await db.getProject(d, w.project.id, 'work')).project.state, 'active');
  await assert.rejects(db.createItem(d, { kind: 'task', title: 't', projectId: h.project.id }, 'work', T3), NotFoundError);
  await db.createItem(d, { kind: 'task', title: 't', projectId: w.project.id }, 'work', T3);
  await assert.rejects(db.undoChange(d, w.changeId, T4), ConflictError, 'project now has items');
  await assert.rejects(db.updateProject(d, w.project.id, { name: 'x' }, 'personal', T4), NotFoundError);
});

// ---------------------------------------------------------------- search

test('search: FTS input is sanitised; operators, quotes, columns and unicode never error or inject', async () => {
  const d = createTestDb();
  await capture(d, 'cap-srch-01', 'Panel schedule for the café — "rev B" NEAR the lobby');
  await db.createItem(d, { kind: 'task', title: 'Send the 日本 spec sheet', body: 'title:secret body' }, 'work', T0);
  await db.createProject(d, { name: 'Lobby refresh', purpose: 'paint and lights' }, 'work', T0);
  const hostile = [
    '"', '""', '"rev', 'rev"', 'NEAR(panel lobby)', 'panel NEAR lobby', 'panel OR nothing', 'NOT panel', 'panel AND',
    '*', 'pan*', '^panel', 'title:panel', 'body:secret', '{title body}:panel', '(panel', 'panel)', '-panel', '+panel',
    "panel'; DROP TABLE items; --", 'café', 'CAFÉ', '日本', '🙂', '', '   ', 'a'.repeat(5000), 'x '.repeat(100),
    '\u0000panel', 'panel​', 'NEAR/2', ':', 'rowid:1', 'fts_work MATCH',
  ];
  for (const q of hostile) {
    const r = await db.search(d, q, 'work');
    assert.ok(Array.isArray(r), `query ${JSON.stringify(q).slice(0, 40)} returns an array`);
  }
  // Quoted tokens: operators are literal words, so "panel OR nothing" needs the word "nothing" and finds nothing.
  assert.equal((await db.search(d, 'panel OR nothing', 'work')).length, 0);
  assert.equal((await db.search(d, 'NOT panel', 'work')).length, 0);
  // Column filter syntax is not honoured: "title:secret" is the phrase "title secret" in any column.
  assert.equal((await db.search(d, 'title:secret', 'work')).length, 1);
  assert.equal((await db.search(d, 'body:secret', 'work')).length, 0);
  // Ordinary searches still work, with prefixes and unicode.
  assert.equal((await db.search(d, 'panel', 'work')).length, 1);
  assert.equal((await db.search(d, 'sched', 'work')).length, 1);
  assert.equal((await db.search(d, 'café', 'work')).length, 1);
  assert.equal((await db.search(d, '日本', 'work')).length, 1);
  assert.equal((await db.search(d, 'lobby', 'work')).length, 2);
  assert.equal(await count(d, 'SELECT COUNT(*) FROM items'), 1, 'injection attempt changed nothing');
  assert.equal(db.ftsQuery('a "b" NEAR(c)'), '"a"* """b"""* "NEAR(c)"*');
  assert.equal(db.ftsQuery('* ^ :'), null);
  await assert.rejects(db.search(d, 'panel', 'all'), ScopeError);
});

test('search: newest first, rows carry scope and type', async () => {
  const d = createTestDb();
  await db.createItem(d, { kind: 'idea', title: 'grounding idea one' }, 'work', T0);
  await db.createItem(d, { kind: 'idea', title: 'grounding idea two' }, 'work', T2);
  await db.saveCapture(d, { id: 'cap-srch-02', text: 'grounding note', scope: 'work', source: 'shortcut' }, T1);
  const r = await db.search(d, 'grounding', 'work');
  assert.deepEqual(r.map((x) => x.title), ['grounding idea two', 'grounding note', 'grounding idea one']);
  assert.ok(r.every((x) => x.scope === 'work'));
  assert.deepEqual(r.map((x) => x.type), ['item', 'capture', 'item']);
});

// ---------------------------------------------------------------- deletion

test('deleteCapture: proposals and FTS row go; accepted items keep text with source_deleted=1', async () => {
  const d = createTestDb();
  await seedReview(d, 'cap-del-001');
  const r = await db.reviewCapture(d, 'cap-del-001', { accept: [{ ordinal: 0 }, { ordinal: 1 }], drop: [2] }, 'work', T1);
  const [task] = r.items;
  const proj = await db.createProject(d, { name: 'Del proj' }, 'work', T1);
  const edit = await db.updateItem(d, task.id, { todayPick: true, projectId: proj.project.id }, 'work', T2);
  const cp = await db.saveCheckpoint(d, proj.project.id, null, 'work', T2);
  assert.equal(cp.checkpoint.source_ref, 'capture:cap-del-001');
  assert.equal(await count(d, "SELECT COUNT(*) FROM fts_work WHERE ref = 'capture:cap-del-001'"), 1);

  const res = await db.deleteCapture(d, 'cap-del-001', 'work', T3);
  assert.deepEqual(res, { captures: 1, proposals: 3, itemsDeleted: 0, itemsDetached: 2, checkpointsDetached: 1 });
  const cpAfter = (await db.getProject(d, proj.project.id, 'work')).checkpoint;
  assert.equal(cpAfter.source_ref, null, 'checkpoint loses the link to the deleted capture');
  assert.equal(cpAfter.stopped_at_text, cp.checkpoint.stopped_at_text, 'the saved words stay (user-saved, like accepted items)');
  assert.equal(await count(d, "SELECT COUNT(*) FROM captures WHERE id = 'cap-del-001'"), 0);
  assert.equal(await count(d, "SELECT COUNT(*) FROM proposals WHERE capture_id = 'cap-del-001'"), 0);
  assert.equal(await count(d, "SELECT COUNT(*) FROM fts_work WHERE ref = 'capture:cap-del-001'"), 0);
  assert.equal((await db.search(d, 'Duke', 'work')).filter((h) => h.type === 'capture').length, 0);

  const kept = await db.getItem(d, task.id, 'work');
  assert.equal(kept.title, 'send the panel schedule');
  assert.equal(kept.source_deleted, 1);
  assert.equal(kept.source_capture_id, null);
  assert.equal(kept.source_quote, null);
  // The deleted words are gone from Undo history too, and undo still works on the scrubbed rows.
  assert.equal(await count(d, "SELECT COUNT(*) FROM changes WHERE before_json LIKE '%asked me to send%' OR after_json LIKE '%asked me to send%'"), 0);
  await db.undoChange(d, edit.changeId, T4);
  const undone = await db.getItem(d, task.id, 'work');
  assert.equal(undone.today_pick, 0);
  assert.equal(undone.source_deleted, 1);
  assert.equal(undone.source_quote, null);

  // Repeat and wrong scope are harmless.
  assert.deepEqual(await db.deleteCapture(d, 'cap-del-001', 'work', T4), {
    captures: 0, proposals: 0, itemsDeleted: 0, itemsDetached: 0, checkpointsDetached: 0,
  });
  await capture(d, 'cap-del-002', 'other');
  assert.equal((await db.deleteCapture(d, 'cap-del-002', 'personal', T4)).captures, 0);
  assert.equal(await count(d, "SELECT COUNT(*) FROM captures WHERE id = 'cap-del-002'"), 1);
});

test('deleteCapture leaves an id-only tombstone: saving the same id again stores nothing', async () => {
  const d = createTestDb();
  await capture(d, 'cap-tomb-01', 'Call Zelda about the gate');
  await db.deleteCapture(d, 'cap-tomb-01', 'work', T1);
  assert.equal(await count(d, "SELECT COUNT(*) FROM kv WHERE key = 'deleted_capture:cap-tomb-01'"), 1);
  assert.equal(await count(d, "SELECT COUNT(*) FROM kv WHERE value LIKE '%Zelda%'"), 0, 'the tombstone holds no text');
  const again = await capture(d, 'cap-tomb-01', 'Call Zelda about the gate');
  assert.deepEqual(again, { capture: null, duplicate: true, deleted: true });
  assert.equal(await count(d, "SELECT COUNT(*) FROM captures WHERE id = 'cap-tomb-01'"), 0);
  assert.equal(await count(d, "SELECT COUNT(*) FROM fts_work WHERE ref = 'capture:cap-tomb-01'"), 0);
  assert.equal((await db.search(d, 'Zelda', 'work')).length, 0);
  // A delete that found nothing (wrong scope) leaves no tombstone.
  await capture(d, 'cap-tomb-02', 'other words', 'personal');
  await db.deleteCapture(d, 'cap-tomb-02', 'work', T1);
  assert.equal(await count(d, "SELECT COUNT(*) FROM kv WHERE key = 'deleted_capture:cap-tomb-02'"), 0);
  assert.equal((await capture(d, 'cap-tomb-02', 'other words', 'personal')).duplicate, true);
  assert.ok(!('tombstone' in (await db.exportData(d, 'all')).tables), 'kv is not exported');
});

test('deleteCapture removes items from the capture that were never accepted (defensive path)', async () => {
  const d = createTestDb();
  await capture(d, 'cap-del-003', 'stray');
  // Simulate a stray capture-origin item with no accepted proposal (cannot happen through the API).
  await d
    .prepare(
      "INSERT INTO items (id, kind, scope, title, state, origin, source_capture_id, created_at, updated_at) VALUES ('stray-1', 'idea', 'work', 'stray', 'open', 'capture', 'cap-del-003', ?, ?)",
    )
    .bind(T0, T0)
    .run();
  await d.prepare("INSERT INTO fts_work (ref, kind, title, body) VALUES ('item:stray-1', 'idea', 'stray', '')").run();
  const res = await db.deleteCapture(d, 'cap-del-003', 'work', T1);
  assert.equal(res.itemsDeleted, 1);
  assert.equal(await count(d, "SELECT COUNT(*) FROM items WHERE id = 'stray-1'"), 0);
  assert.equal(await count(d, "SELECT COUNT(*) FROM fts_work WHERE ref = 'item:stray-1'"), 0);
});

// ---------------------------------------------------------------- export

test('exportData by scope; all carries both scopes on every row; excluded tables absent', async () => {
  const d = createTestDb();
  await capture(d, 'cap-exp-w01', 'work words', 'work');
  await capture(d, 'cap-exp-p01', 'home words', 'personal');
  const wp = await db.createProject(d, { name: 'W' }, 'work', T0);
  await db.createProject(d, { name: 'P' }, 'personal', T0);
  await db.createItem(d, { kind: 'task', title: 'w task' }, 'work', T0);
  await db.createItem(d, { kind: 'task', title: 'p task' }, 'personal', T0);
  await db.saveCheckpoint(d, wp.project.id, null, 'work', T1);
  const rem = await db.createReminder(
    d,
    { id: 'rem-exp-01', text: 'w reminder', localDate: '2026-11-01', localTime: '09:00', timeZone: 'America/New_York' },
    'work',
    T0,
  );
  await db.insertDelivery(d, { id: 'del-exp-01', reminderId: rem.reminder.id, scheduledFor: 1, localLabel: 'x' }, T0);
  await db.logEvent(d, T0, 'test_event', 'ref-1', { n: 1 });
  await db.kvPut(d, 'k', 'v');
  await db.setMeta(d, 'last_open_at', T0);

  const w = await db.exportData(d, 'work');
  assert.equal(w.scope, 'work');
  for (const [name, rows] of Object.entries(w.tables)) {
    for (const row of rows) assert.equal(row.scope, 'work', `${name} row is work`);
  }
  assert.equal(w.tables.captures.length, 1);
  assert.equal(w.tables.items.length, 1);
  assert.equal(w.tables.checkpoints.length, 1);
  assert.equal(w.tables.reminders.length, 1);
  assert.equal(w.tables.deliveries.length, 1);
  assert.ok(w.tables.changes.length >= 2);
  for (const t of ['push_subscriptions', 'subscriptions', 'kv', 'events', 'meta', 'fts_work', 'fts_personal']) {
    assert.equal(t in w.tables, false, `${t} excluded`);
  }
  const p = await db.exportData(d, 'personal');
  assert.equal(p.tables.captures.length, 1);
  assert.equal(p.tables.reminders.length, 0);
  assert.ok(Object.values(p.tables).flat().every((r) => r.scope === 'personal'));

  const all = await db.exportData(d, 'all');
  assert.equal(all.tables.captures.length, 2);
  assert.deepEqual(new Set(all.tables.items.map((r) => r.scope)), new Set(['work', 'personal']));
  for (const [name, rows] of Object.entries(all.tables)) {
    if (name === 'meta') continue;
    for (const row of rows) assert.ok(row.scope === 'work' || row.scope === 'personal', `${name} row carries scope`);
  }
  assert.deepEqual(all.tables.meta, [{ key: 'last_open_at', value: T0 }]);
  assert.equal('events' in all.tables, false);
  assert.equal('kv' in all.tables, false);
  await assert.rejects(db.exportData(d, 'everything'), ScopeError);
});

// ---------------------------------------------------------------- scope rule

test("ScopeError on 'all' everywhere except today, inbox, projects list and export", async () => {
  const d = createTestDb();
  const x = 'some-id';
  const forbidden = {
    saveCapture: () => db.saveCapture(d, { id: 'cap-scope-01', text: 't', scope: 'all' }, T0),
    saveProposals: () => db.saveProposals(d, x, [], 'all'),
    getCapture: () => db.getCapture(d, x, 'all'),
    reviewCapture: () => db.reviewCapture(d, x, {}, 'all', T0),
    createItem: () => db.createItem(d, { kind: 'task', title: 't' }, 'all', T0),
    getItem: () => db.getItem(d, x, 'all'),
    updateItem: () => db.updateItem(d, x, {}, 'all', T0),
    completeItem: () => db.completeItem(d, x, 'all', T0),
    reopenItem: () => db.reopenItem(d, x, 'all', T0),
    archiveItem: () => db.archiveItem(d, x, 'all', T0),
    recordReply: () => db.recordReply(d, x, 'all', T0),
    snoozeFollowUp: () => db.snoozeFollowUp(d, x, '2026-11-01', 'all', T0),
    createDecision: () => db.createDecision(d, { title: 't' }, 'all', T0),
    undoChange: () => db.undoChange(d, 1, T0, 'all'),
    createProject: () => db.createProject(d, { name: 'n' }, 'all', T0),
    updateProject: () => db.updateProject(d, x, {}, 'all', T0),
    getProject: () => db.getProject(d, x, 'all'),
    checkpointPrefill: () => db.checkpointPrefill(d, x, 'all'),
    saveCheckpoint: () => db.saveCheckpoint(d, x, null, 'all', T0),
    search: () => db.search(d, 'q', 'all'),
    deleteCapture: () => db.deleteCapture(d, x, 'all', T0),
    createReminder: () => db.createReminder(d, { id: 'r1', text: 't' }, 'all', T0),
    getReminder: () => db.getReminder(d, x, 'all'),
    listReminders: () => db.listReminders(d, 'all'),
    cancelReminder: () => db.cancelReminder(d, x, 'all'),
  };
  // undoChange needs a change row to reach the scope check.
  await db.createItem(d, { kind: 'task', title: 'seed' }, 'work', T0);
  for (const [name, fn] of Object.entries(forbidden)) {
    await assert.rejects(fn(), ScopeError, `${name} rejects 'all'`);
  }
  for (const bad of [undefined, null, '', 'Work', 'both', 'work ']) {
    await assert.rejects(db.search(d, 'q', bad), ScopeError);
    await assert.rejects(db.getInbox(d, bad), ScopeError);
  }
  // Allowed with 'all'.
  assert.ok(Array.isArray(await db.getInbox(d, 'all')));
  assert.ok(Array.isArray(await db.listProjects(d, 'all')));
  assert.equal(typeof (await db.listForToday(d, 'all', '2026-10-30')).inboxCount, 'number');
  assert.equal((await db.exportData(d, 'all')).scope, 'all');
});

// ---------------------------------------------------------------- reminders and system helpers

test('reminders: create is idempotent, past is refused, cancel, cron helpers guard duplicates', async () => {
  const d = createTestDb();
  const f = { id: 'rem-0001', text: 'check temp power', localDate: '2026-10-31', localTime: '07:00', timeZone: 'America/New_York' };
  const a = await db.createReminder(d, f, 'work', T0);
  assert.equal(a.duplicate, false);
  assert.equal(a.reminder.next_fire_at, Date.parse('2026-10-31T11:00:00.000Z'));
  assert.equal((await db.createReminder(d, f, 'work', T0)).duplicate, true);
  await assert.rejects(db.createReminder(d, { ...f, text: 'other' }, 'work', T0), ConflictError);
  await assert.rejects(db.createReminder(d, { ...f, id: 'rem-0002', localDate: '2026-10-01' }, 'work', T0), ValidationError);
  assert.equal(await db.getReminder(d, 'rem-0001', 'personal'), null);

  const due = await db.listDueReminders(d, Date.parse('2026-10-31T11:00:30.000Z'), 3);
  assert.equal(due.length, 1);
  const first = await db.insertDelivery(d, { id: 'del-1', reminderId: 'rem-0001', scheduledFor: due[0].next_fire_at, localLabel: 'Sat 7:00 AM' }, T1);
  const dup = await db.insertDelivery(d, { id: 'del-2', reminderId: 'rem-0001', scheduledFor: due[0].next_fire_at, localLabel: 'Sat 7:00 AM' }, T1);
  assert.equal(first.inserted, true);
  assert.equal(dup.inserted, false);
  await db.recordDeliveryOutcome(d, 'del-1', { state: 'sent', pushStatus: 201, attempts: 1, sentAt: T1 });
  assert.equal(await db.advanceReminder(d, 'rem-0001', due[0].next_fire_at, null), true);
  assert.equal((await db.getReminder(d, 'rem-0001', 'work')).state, 'done');
  const today = await db.listForToday(d, 'work', '2026-10-31');
  assert.equal(today.unacknowledged.length, 1);
  await db.acknowledgeDelivery(d, 'del-1', 'in_app', T2);
  assert.equal((await db.getDelivery(d, 'del-1')).state, 'acknowledged');
  // A late beacon does not move state backwards.
  await db.markDeliveryReceived(d, 'del-1', T3);
  assert.equal((await db.getDelivery(d, 'del-1')).state, 'acknowledged');
  assert.equal((await db.listForToday(d, 'work', '2026-10-31')).unacknowledged.length, 0);

  const b = await db.createReminder(d, { ...f, id: 'rem-0003' }, 'personal', T0);
  const c = await db.cancelReminder(d, b.reminder.id, 'personal');
  assert.equal(c.cancelled, true);
  assert.equal(c.reminder.state, 'cancelled');
  await assert.rejects(db.cancelReminder(d, b.reminder.id, 'work'), NotFoundError);
});

test('kv, meta and events helpers', async () => {
  const d = createTestDb();
  await db.kvPut(d, 'jwt', 'abc', 1000);
  assert.equal(await db.kvGet(d, 'jwt', 999), 'abc');
  assert.equal(await db.kvGet(d, 'jwt', 1000), null);
  await db.kvPut(d, 'n', '2');
  assert.equal(await db.kvDecrementIfPositive(d, 'n'), true);
  assert.equal(await db.kvDecrementIfPositive(d, 'n'), true);
  assert.equal(await db.kvDecrementIfPositive(d, 'n'), false);
  assert.equal(await db.getMeta(d, 'last_open_at'), null);
  await db.setMeta(d, 'last_open_at', T0);
  await db.setMeta(d, 'last_open_at', T1);
  assert.equal(await db.getMeta(d, 'last_open_at'), T1);
  await db.logEvent(d, T0, 'a', 'r1', { n: 1 });
  await db.logEvent(d, T0, 'b', null, null);
  const ev = await db.listEvents(d, 10);
  assert.deepEqual(ev.map((e) => e.kind), ['b', 'a']);
  assert.deepEqual(ev[1].detail, { n: 1 });
  assert.equal(await db.pruneEvents(d, 1), 1);
});

// ---------------------------------------------------------------- static rule

// Nothing outside src/db.js builds SQL. `.exec(` on a regular expression (a regex literal, or a name such as
// DATE_RE, timeRe, re, ...Regex, ...Pattern) is allowed: the copied src/time.js parses dates that way.
// PLAN.md "Scope enforcement": db.js owns core tables; these feature modules own their own tables. Their
// scope is enforced by tests/scope-sweep.test.mjs and their own canary tests, not by this list.
const SQL_OWNERS = new Set(['db.js', 'ask.js', 'ai.js', 'drafts.js', 'claims.js', 'calendar.js', 'pm.js', 'review.js', 'mcp.js']);
test('static: only db.js and the listed table-owning feature modules call prepare( or .exec(', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(m?js|cjs|ts)$/.test(name)) files.push(p);
    }
  };
  walk(root);
  assert.ok(files.some((f) => f.endsWith('db.js')));
  const regexReceiver = /(?:\/[gimsuyd]*|(?:^|[^A-Za-z0-9_$])(?:re|RE|[A-Za-z0-9_$]*(?:_RE|_re|Re|Regex|REGEX|regex|Pattern|PATTERN|pattern)))\s*$/;
  const offenders = [];
  for (const f of files) {
    if (SQL_OWNERS.has(relative(root, f))) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/\bprepare\s*\(/.test(line)) offenders.push(`${relative(root, f)}:${i + 1} prepare(`);
      const re = /\.\s*exec\s*\(/g;
      let m;
      while ((m = re.exec(line))) {
        if (!regexReceiver.test(line.slice(0, m.index))) offenders.push(`${relative(root, f)}:${i + 1} .exec(`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});

test('static: the receiver rule still catches database calls', () => {
  const regexReceiver = /(?:\/[gimsuyd]*|(?:^|[^A-Za-z0-9_$])(?:re|RE|[A-Za-z0-9_$]*(?:_RE|_re|Re|Regex|REGEX|regex|Pattern|PATTERN|pattern)))\s*$/;
  for (const ok of ['DATE_RE', 'const m = TIME_RE', 'x = /a+/g', 'timeRe', 'const m = re', 'dateRegex']) assert.ok(regexReceiver.test(ok), ok);
  for (const bad of ['env.DB', 'db', 'await db', 'this.store', 'd1']) assert.equal(regexReceiver.test(bad), false, bad);
});
