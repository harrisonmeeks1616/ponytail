// Export -> restore: round trip, relationships, attachments with bytes, tombstones, scope, reminders.
// Sample data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from './helpers/d1.mjs';
import { createWorker } from '../src/api.js';
import * as db from '../src/db.js';

const TZ = 'America/New_York';
const T0 = '2026-10-29T12:00:00.000Z';
const T1 = '2026-10-29T12:05:00.000Z';
const T2 = '2026-10-29T12:10:00.000Z';
const bytes = (s) => new TextEncoder().encode(s);

// Every table with rows and every relationship: proposals -> captures, items -> projects, decisions
// superseding each other, checkpoints -> projects, reminders -> items, deliveries -> reminders,
// attachments -> captures and items, preferences, undo history, meta.
async function seed(d) {
  for (const scope of ['work', 'personal']) {
    const tag = scope[0];
    const p = (await db.createProject(d, { id: `proj-${tag}`, name: `Sample ${scope} project` }, scope, T0)).project;
    await db.saveCapture(d, { id: `cap-${tag}-0001`, text: `Need to order 12 sheets for the ${scope} job.`, scope, timeZone: TZ }, T0);
    await db.saveProposals(d, `cap-${tag}-0001`, [{ ordinal: 1, kind: 'task', title: `order 12 sheets ${scope}`, fields: {}, sourceQuote: 'x' }], scope);
    const rv = await db.reviewCapture(d, `cap-${tag}-0001`, { accept: [{ ordinal: 1, edits: { projectId: p.id, dueOn: '2026-11-02', recurrence: 'weekly' } }] }, scope, T0);
    const task = rv.items[0];
    await db.updateItem(d, task.id, { startOn: '2026-10-31' }, scope, T1);
    const d1 = await db.createDecision(d, { id: `dec-${tag}-1`, title: 'Sample fixtures', options: ['A', 'B'], recommendation: 'B', projectId: p.id }, scope, T0);
    await db.createDecision(d, { id: `dec-${tag}-2`, title: 'Sample fixtures v2', supersedesId: d1.item.id, outcome: 'Ordered', projectId: p.id }, scope, T1);
    await db.saveCheckpoint(d, p.id, { stoppedAtText: 'Sample stop', sourceRef: `item:${task.id}` }, scope, T1);
    const rem = await db.createReminder(d, { id: `rem-${tag}-0001`, text: 'Sample reminder', localDate: '2026-11-01', localTime: '09:00', timeZone: TZ, itemId: task.id }, scope, T0);
    await db.insertDelivery(d, { id: `dl-${tag}-0001`, reminderId: rem.reminder.id, scheduledFor: 1, localLabel: 'label' }, T0);
    await db.saveAttachment(d, { id: `att-${tag}-cap-01`, captureId: `cap-${tag}-0001`, name: 'photo.jpg', mime: 'image/jpeg', bytes: new Uint8Array([0, 1, 2, 255, 254]) }, scope, T1);
    await db.saveAttachment(d, { id: `att-${tag}-itm-01`, itemId: task.id, name: 'list.pdf', mime: 'application/pdf', bytes: bytes(`%PDF ${scope}`) }, scope, T1);
    await db.putPreference(d, 'site.arrival', { value: `Arrive early (${scope})`, note: 'Sample' }, scope, T1);
  }
  await db.setMeta(d, 'last_time_zone', TZ);
}

test('round trip: export all -> fresh database -> restore -> export is equal', async () => {
  const a = createTestDb();
  await seed(a);
  const exported = await db.exportData(a, 'all');
  for (const t of ['captures', 'proposals', 'projects', 'items', 'checkpoints', 'changes', 'reminders', 'deliveries', 'attachments', 'preferences', 'meta']) {
    assert.ok(exported.tables[t].length > 0, `${t} has rows`);
  }
  const doc = JSON.parse(JSON.stringify(exported)); // what a downloaded file looks like

  const b = createTestDb();
  const res = await db.restoreData(b, doc, 'all', T2);
  assert.equal(res.rejected, 0);
  assert.equal(res.skipped_existing, 0);
  assert.equal(res.skipped_deleted, 0);
  assert.equal(res.inserted.attachments, 4);
  assert.deepEqual(await db.exportData(b, 'all'), exported);

  // Search works on restored rows, including attachment names; bytes are intact.
  assert.equal((await db.search(b, 'sheets', 'work')).length, 2);
  assert.equal((await db.search(b, 'photo', 'personal'))[0].ref, 'capture:cap-p-0001');
  assert.deepEqual([...(await db.getAttachment(b, 'att-w-cap-01', 'work')).data], [0, 1, 2, 255, 254]);
  // Relationships hold: the project shows its next task, its decisions in order and its checkpoint.
  const proj = await db.getProject(b, 'proj-w', 'work');
  assert.equal(proj.decisions[1].superseded_by_id, 'dec-w-2');
  assert.equal(proj.checkpoint.stopped_at_text, 'Sample stop');

  // Restoring again changes nothing and overwrites nothing.
  await db.putPreference(b, 'site.arrival', { value: 'Edited after restore' }, 'work', T2);
  const again = await db.restoreData(b, doc, 'all', T2);
  assert.deepEqual(again.inserted, {});
  assert.equal(again.rejected, 0);
  assert.ok(again.skipped_existing > 20);
  assert.equal((await db.listPreferences(b, 'work'))[0].value, 'Edited after restore');
});

test('restore never brings back deleted captures or items, nor their words through linked rows', async () => {
  const a = createTestDb();
  await seed(a);
  const doc = JSON.parse(JSON.stringify(await db.exportData(a, 'all')));
  const work = (await db.listItems(a, 'work', { kind: 'task' }))[0];
  await db.deleteCapture(a, 'cap-w-0001', 'work', T2);
  await db.deleteItem(a, 'dec-w-1', 'work', T2);
  // Wipe the rest of the work rows so the old export would re-insert them if it could.
  const res = await db.restoreData(a, doc, 'work', T2);
  assert.equal(res.rejected > 0, true, 'personal rows are rejected from a work restore');
  assert.ok(res.skipped_deleted >= 3, `capture, its proposal and attachment, the decision and its history: ${JSON.stringify(res)}`);
  assert.equal(await db.getCapture(a, 'cap-w-0001', 'work'), null);
  assert.equal(await db.getItem(a, 'dec-w-1', 'work'), null);
  const kept = await db.getItem(a, work.id, 'work');
  assert.equal(kept.source_quote, null, 'the deleted capture stays scrubbed from the item');
  const exp = JSON.stringify(await db.exportData(a, 'all'));
  assert.ok(!exp.includes('for the work job'), 'the deleted capture words are nowhere');
});

test('restore into a fresh database scrubs items whose source capture was deleted after the export', async () => {
  const a = createTestDb();
  await seed(a);
  const doc = JSON.parse(JSON.stringify(await db.exportData(a, 'all')));
  const b = createTestDb();
  // The fresh database already knows the capture was deleted (its tombstone survives there).
  await db.saveCapture(b, { id: 'cap-w-0001', text: 'placeholder', scope: 'work' }, T0);
  await db.deleteCapture(b, 'cap-w-0001', 'work', T0);
  const res = await db.restoreData(b, doc, 'work', T2);
  assert.ok(res.skipped_deleted >= 3);
  const item = (await db.listItems(b, 'work', { kind: 'task' }))[0];
  assert.equal(item.source_capture_id, null);
  assert.equal(item.source_deleted, 1);
  const changes = JSON.stringify((await db.exportData(b, 'work')).tables.changes);
  assert.ok(!changes.includes('"source_capture_id":"cap-w-0001"'));
});

test('restore reschedules reminders from now: a missed one-off never fires, a daily one moves ahead', async () => {
  const a = createTestDb();
  await db.createReminder(a, { id: 'rem-once-001', text: 'Sample once', localDate: '2026-10-30', localTime: '09:00', timeZone: TZ }, 'work', T0);
  await db.createReminder(a, { id: 'rem-daily-01', text: 'Sample daily', localDate: '2026-10-30', localTime: '09:00', timeZone: TZ, recurrence: 'daily' }, 'work', T0);
  const doc = await db.exportData(a, 'work');
  const b = createTestDb();
  const later = '2026-11-05T15:00:00.000Z';
  const res = await db.restoreData(b, doc, 'work', later);
  assert.equal(res.reminders_not_rescheduled, 1);
  const once = await db.getReminder(b, 'rem-once-001', 'work');
  assert.equal(once.state, 'cancelled');
  assert.equal(once.next_fire_at, null);
  const daily = await db.getReminder(b, 'rem-daily-01', 'work');
  assert.ok(Number(daily.next_fire_at) > Date.parse(later), 'the next daily occurrence is after now');
  assert.equal((await db.listDueReminders(b, Date.parse(later), 10)).length, 0, 'nothing is due at once');
});

test('restore rejects rows outside its scope and links across scopes, and refuses a non-export', async () => {
  const a = createTestDb();
  await seed(a);
  const doc = JSON.parse(JSON.stringify(await db.exportData(a, 'all')));
  // A crafted row: a work item pointing at the personal project.
  doc.tables.items.push({ ...doc.tables.items[0], id: 'item-cross-01', scope: 'work', project_id: 'proj-p' });
  // A crafted attachment whose bytes do not decode.
  doc.tables.attachments.push({ ...doc.tables.attachments[0], id: 'att-bad-0001', data_b64: '***' });
  const b = createTestDb();
  const res = await db.restoreData(b, doc, 'personal', T2);
  assert.equal(JSON.stringify(await db.exportData(b, 'work')).includes('Sample'), false, 'nothing of work arrives');
  assert.ok(res.rejected > 10);
  const c = createTestDb();
  const res2 = await db.restoreData(c, doc, 'all', T2);
  assert.equal(await db.getItem(c, 'item-cross-01', 'work'), null, 'cross-scope link rejected');
  assert.equal(await db.getAttachment(c, 'att-bad-0001', 'work'), null);
  assert.equal(res2.rejected, 2);
  await assert.rejects(db.restoreData(c, { format: 'something-else', version: 2, tables: {} }, 'all', T2), db.ValidationError);
  await assert.rejects(db.restoreData(c, { format: 'harrison-os-export', version: 2, tables: { items: 'x' } }, 'all', T2), db.ValidationError);
});

test('POST /api/restore: counts in the response, scope rules, large bodies accepted', async () => {
  const a = createTestDb();
  await seed(a);
  const big = 'x'.repeat(200_000);
  await db.saveCapture(a, { id: 'cap-big-0001', text: big.slice(0, 20000), scope: 'work' }, T0);
  const doc = JSON.parse(JSON.stringify(await db.exportData(a, 'all')));
  const DB = createTestDb();
  const worker = createWorker({ now: () => Date.parse(T2) });
  const env = { DB, DEV_ALLOW_UNAUTH: '1', SPIKE_TEST_HOOKS: '0', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' };
  const post = async (body) => {
    const res = await worker.fetch(
      new Request('http://127.0.0.1:8899/api/restore', {
        method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
      env,
    );
    return { status: res.status, data: await res.json() };
  };
  const r = await post({ scope: 'work', data: doc });
  assert.equal(r.status, 200);
  assert.equal(r.data.inserted.captures, 2);
  assert.ok(r.data.rejected > 0, 'personal rows rejected');
  assert.equal((await post({ data: doc })).status, 400, 'scope required');
  assert.equal((await post({ scope: 'work', data: { format: 'nope' } })).status, 400);
  // The same document again as 'all': the work rows are already there and are not overwritten.
  assert.equal((await post({ scope: 'all', data: doc })).data.skipped_existing > 0, true);
});

test('restored undo history cannot revive a deleted item or cross scopes', async () => {
  const d = createTestDb();
  const made = (await db.createItem(d, { id: 'item-canary-01', kind: 'task', title: 'PCANARY secret' }, 'personal', T0)).item;
  await db.deleteItem(d, made.id, 'personal', T1);
  const crafted = (over) => ({
    id: 999, at: T1, entity: 'item', entity_id: 'innocent-id', op: 'update', before_json: JSON.stringify(made), after_json: null, undone_at: null, scope: 'work', ...over,
  });
  const doc = (rows) => ({ format: 'harrison-os-export', version: 2, tables: { changes: rows } });
  const res = await db.restoreData(d, doc([crafted(), crafted({ id: 998, entity: 'capture' }), crafted({ id: 997, entity_id: made.id })]), 'work', T2);
  assert.deepEqual(res.inserted, {});
  assert.equal(res.skipped_deleted + res.rejected, 3);
  assert.equal((await d.prepare('SELECT COUNT(*) AS n FROM changes WHERE id >= 997').first()).n, 0);

  // Even a history row already in the database cannot do it: a mismatched side is refused, a tombstoned id is gone.
  const put = (over) => {
    const r = crafted(over);
    return d.prepare('INSERT INTO changes (id, at, entity, entity_id, op, before_json, after_json, scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(r.id, r.at, r.entity, r.entity_id, r.op, r.before_json, r.after_json, r.scope).run();
  };
  await put({});
  await assert.rejects(db.undoChange(d, 999, T2, 'work'), db.ValidationError);
  await put({ id: 996, entity_id: made.id, scope: 'personal' });
  await assert.rejects(db.undoChange(d, 996, T2, 'personal'), db.GoneError);
  assert.equal((await d.prepare('SELECT COUNT(*) AS n FROM items WHERE id = ?').bind(made.id).first()).n, 0);
});

test('restore applies the item rules and attachment parent and hash rules', async () => {
  const d = createTestDb();
  const cap = 'cap-w-0001';
  await db.saveCapture(d, { id: cap, text: 'Sample capture', scope: 'work', timeZone: TZ }, T0);
  const item = (over) => ({ id: 'it-ok', kind: 'decision', scope: 'work', title: 'Sample', state: 'open', origin: 'user', created_at: T0, updated_at: T0, sample: 0, source_deleted: 0, today_pick: 0, ...over });
  const att = (over) => ({ id: 'att-ok-0001', scope: 'work', capture_id: cap, item_id: null, name: 'a.txt', mime: 'text/plain', size: 3, sha256: 'bogus', created_at: T0, sample: 0, data_b64: 'YWJj', ...over });
  const res = await db.restoreData(d, {
    format: 'harrison-os-export', version: 2,
    tables: {
      items: [item({ options_json: '["A"," B "]' }), item({ id: 'it-bad-opt', options_json: 'not json' }), item({ id: 'it-bad-rec', recurrence: 'weekly' }), item({ id: 'it-no-title', title: '' })],
      attachments: [att(), att({ id: 'att-orph-0001', capture_id: 'nonexistent-cap' }), att({ id: 'att-x-scope1', scope: 'personal' }), att({ id: 'att-on-item1', capture_id: null, item_id: 'it-ok' }), att({ id: 'att-on-bad01', capture_id: null, item_id: 'it-bad-opt' })],
    },
  }, 'all', T1);
  assert.deepEqual(res.inserted, { items: 1, attachments: 2 });
  assert.equal(res.rejected, 6);
  assert.equal((await db.getItem(d, 'it-ok', 'work')).options_json, '["A","B"]');
  for (const id of ['it-bad-opt', 'it-bad-rec', 'it-no-title']) assert.equal(await db.getItem(d, id, 'work'), null);
  assert.equal(await db.getAttachment(d, 'att-orph-0001', 'work'), null);
  // The stored hash is the bytes' own, so the same upload again is a duplicate, not a conflict.
  const again = await db.saveAttachment(d, { id: 'att-ok-0001', captureId: cap, name: 'a.txt', mime: 'text/plain', bytes: bytes('abc') }, 'work', T2);
  assert.equal(again.duplicate, true);
});
