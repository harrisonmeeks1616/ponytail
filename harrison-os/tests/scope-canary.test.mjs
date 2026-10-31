// Scope canary: personal rows carry ZZ-PERSONAL-CANARY, work rows ZZ-WORK-CANARY. No work-scope read may
// return the personal canary, and no personal-scope read the work canary. Sample data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from './helpers/d1.mjs';
import * as db from '../src/db.js';

const CANARY = { personal: 'ZZ-PERSONAL-CANARY', work: 'ZZ-WORK-CANARY' };
const OTHER = { work: 'personal', personal: 'work' };
const T0 = '2026-10-30T12:00:00.000Z';
const T1 = '2026-10-30T12:01:00.000Z';
const T2 = '2026-10-30T12:02:00.000Z';
const TODAY = '2026-10-30';

async function seed(d, scope) {
  const c = CANARY[scope];
  const tag = scope === 'work' ? 'w' : 'p';
  const ids = {};
  const project = await db.createProject(d, { name: `${c} project`, purpose: `${c} purpose`, sample: 1 }, scope, T0);
  ids.project = project.project.id;

  // A capture that stays in the inbox, and one accepted into the project (so it is the project's capture).
  await db.saveCapture(d, { id: `cap-${tag}-inbox-01`, text: `${c} inbox capture`, scope, source: 'app', sample: 1 }, T0);
  await db.saveProposals(d, `cap-${tag}-inbox-01`, [
    { ordinal: 0, kind: 'task', title: `${c} pending proposal`, fields: {}, sourceQuote: `${c} inbox capture` },
  ]);
  await db.saveCapture(
    d,
    { id: `cap-${tag}-proj-01`, text: `${c} stopped here. ${c} open question?`, scope, source: 'shortcut', timeZone: 'America/New_York', sample: 1 },
    T0,
  );
  await db.saveProposals(d, `cap-${tag}-proj-01`, [
    { ordinal: 0, kind: 'task', title: `${c} accepted task`, fields: {}, sourceQuote: `${c} stopped here.` },
    { ordinal: 1, kind: 'reminder', title: `${c} reminder from capture`, fields: { when: { kind: 'datetime', on: '2026-10-31', time: '09:00' } }, sourceQuote: 'x' },
  ]);
  await db.reviewCapture(
    d,
    `cap-${tag}-proj-01`,
    { accept: [{ ordinal: 0, edits: { projectId: ids.project, todayPick: true } }, { ordinal: 1 }] },
    scope,
    T1,
  );

  // Items of each kind, all on the project and all due or picked so Today sees them.
  for (const kind of ['task', 'reference', 'idea']) {
    await db.createItem(d, { kind, title: `${c} ${kind}`, body: `${c} body`, dueOn: TODAY, projectId: ids.project, sample: 1 }, scope, T0);
  }
  await db.createItem(
    d,
    { kind: 'waiting', title: `${c} waiting`, who: `${c} person`, askedOn: '2026-10-20', followUpOn: TODAY, projectId: ids.project, sample: 1 },
    scope,
    T0,
  );
  const d1 = await db.createDecision(d, { title: `${c} decision one`, reason: `${c} reason`, projectId: ids.project, sample: 1 }, scope, T0);
  await db.createDecision(d, { title: `${c} decision two`, supersedesId: d1.item.id, projectId: ids.project, sample: 1 }, scope, T1);

  await db.saveCheckpoint(d, ids.project, null, scope, T2);
  const rem = await db.createReminder(
    d,
    { id: `rem-${tag}-01`, text: `${c} reminder`, localDate: '2026-10-31', localTime: '08:00', timeZone: 'America/New_York', sample: 1 },
    scope,
    T0,
  );
  await db.insertDelivery(d, { id: `del-${tag}-01`, reminderId: rem.reminder.id, scheduledFor: rem.reminder.next_fire_at, localLabel: 'label' }, T0);
  await db.recordDeliveryOutcome(d, `del-${tag}-01`, { state: 'sent', pushStatus: 201, attempts: 1, sentAt: T1 });
  // Attachments on a capture and on the accepted task (names and bytes carry the canary), and a preference.
  const bytes = new TextEncoder().encode(`${c} attachment bytes`);
  await db.saveAttachment(d, { id: `att-${tag}-cap-01`, captureId: `cap-${tag}-proj-01`, name: `${c} photo.jpg`, mime: 'image/jpeg', bytes }, scope, T1);
  await db.saveAttachment(d, { id: `att-${tag}-item-01`, itemId: `cap_cap-${tag}-proj-01_0`, name: `${c} note.txt`, mime: 'text/plain', bytes }, scope, T1);
  await db.putPreference(d, 'site.arrival', { value: `${c} preference`, note: `${c} note` }, scope, T1);
  return ids;
}

async function seeded() {
  const d = createTestDb();
  const ids = { work: await seed(d, 'work'), personal: await seed(d, 'personal') };
  return { d, ids };
}

function text(value) {
  return JSON.stringify(value);
}

for (const scope of ['work', 'personal']) {
  const mine = CANARY[scope];
  const theirs = CANARY[OTHER[scope]];

  test(`${scope} reads never return the ${OTHER[scope]} canary`, async () => {
    const { d, ids } = await seeded();

    const inbox = await db.getInbox(d, scope);
    assert.equal(inbox.length, 1);
    assert.ok(text(inbox).includes(mine));
    assert.equal(text(inbox).includes(theirs), false, 'inbox');

    const today = await db.listForToday(d, scope, TODAY);
    assert.ok(today.tasks.length >= 2 && today.waiting.length === 1 && today.checkpoints.length === 1 && today.reminders.length >= 1);
    assert.equal(today.unacknowledged.length, 1);
    assert.ok(text(today).includes(mine));
    assert.equal(text(today).includes(theirs), false, 'listForToday');

    for (const q of [theirs, 'ZZ', 'canary', 'zz canary', 'decision', 'reminder', 'project', 'body', 'person']) {
      const hits = await db.search(d, q, scope);
      assert.equal(text(hits).includes(theirs), false, `search ${q}`);
      assert.ok(hits.every((h) => h.scope === scope), `search ${q} rows are ${scope}`);
    }
    assert.equal((await db.search(d, theirs, scope)).length, 0);
    const own = await db.search(d, mine, scope);
    assert.ok(own.length >= 9, 'own canary is searchable across captures, items and the project');

    const project = await db.getProject(d, ids[scope].project, scope);
    assert.ok(project.nextItem && project.waiting.length === 1 && project.decisions.length === 2 && project.checkpoint);
    assert.ok(project.recentCaptures.length >= 1);
    assert.equal(text(project).includes(theirs), false, 'getProject');
    assert.equal(await db.getProject(d, ids[OTHER[scope]].project, scope), null, 'other scope project is not found');

    const prefill = await db.checkpointPrefill(d, ids[scope].project, scope);
    assert.equal(text(prefill).includes(theirs), false, 'prefill');
    await assert.rejects(db.checkpointPrefill(d, ids[OTHER[scope]].project, scope), db.NotFoundError);

    assert.equal(text(await db.listProjects(d, scope)).includes(theirs), false, 'listProjects');
    assert.equal(text(await db.listReminders(d, scope)).includes(theirs), false, 'listReminders');
    assert.equal(text(await db.listPreferences(d, scope)).includes(theirs), false, 'listPreferences');
    const items = await db.listItems(d, scope);
    assert.ok(items.some((i) => i.attachments.length === 2), 'the accepted task shows its own file and its capture photo');
    assert.equal(text(items).includes(theirs), false, 'listItems with attachments');
    const otherTag = scope === 'work' ? 'p' : 'w';
    assert.equal(await db.getAttachment(d, `att-${otherTag}-cap-01`, scope), null, 'the other scope attachment is not found');
    const mineAtt = await db.getAttachment(d, `att-${scope === 'work' ? 'w' : 'p'}-cap-01`, scope);
    assert.ok(new TextDecoder().decode(mineAtt.data).includes(mine));
    assert.equal(text((await db.search(d, 'photo', scope)).map((h) => h.attachments)).includes(theirs), false, 'search by file name');

    const exp = await db.exportData(d, scope);
    assert.ok(text(exp).includes(mine));
    assert.equal(text(exp).includes(theirs), false, `export ${scope}`);
    for (const [name, rows] of Object.entries(exp.tables)) {
      assert.ok(rows.every((r) => r.scope === scope), `export ${scope} ${name} rows`);
    }
  });

  test(`${scope} writes cannot reach ${OTHER[scope]} rows by id`, async () => {
    const { d, ids } = await seeded();
    const other = OTHER[scope];
    const otherItem = (await db.listForToday(d, other, TODAY)).tasks[0];
    assert.equal(await db.getItem(d, otherItem.id, scope), null);
    await assert.rejects(db.updateItem(d, otherItem.id, { title: 'x' }, scope, T2), db.NotFoundError);
    await assert.rejects(db.completeItem(d, otherItem.id, scope, T2), db.NotFoundError);
    await assert.rejects(db.updateProject(d, ids[other].project, { name: 'x' }, scope, T2), db.NotFoundError);
    await assert.rejects(db.saveCheckpoint(d, ids[other].project, null, scope, T2), db.NotFoundError);
    await assert.rejects(db.createItem(d, { kind: 'task', title: 'x', projectId: ids[other].project }, scope, T2), db.NotFoundError);
    const tag = other === 'work' ? 'w' : 'p';
    await assert.rejects(db.reviewCapture(d, `cap-${tag}-inbox-01`, { accept: [{ ordinal: 0 }] }, scope, T2), db.NotFoundError);
    assert.equal((await db.deleteCapture(d, `cap-${tag}-inbox-01`, scope, T2)).captures, 0);
    await assert.rejects(db.cancelReminder(d, `rem-${tag}-01`, scope), db.NotFoundError);
    // Nothing of the other scope changed.
    assert.equal(text(await db.exportData(d, other)).includes(CANARY[scope]), false);
    assert.equal((await db.getInbox(d, other)).length, 1);
  });
}

test('export all includes both canaries, every row carrying its scope', async () => {
  const { d } = await seeded();
  const all = await db.exportData(d, 'all');
  const s = text(all);
  assert.ok(s.includes(CANARY.work));
  assert.ok(s.includes(CANARY.personal));
  for (const [name, rows] of Object.entries(all.tables)) {
    if (name === 'meta') continue;
    assert.ok(rows.length > 0, `${name} has rows`);
    for (const row of rows) {
      assert.ok(row.scope === 'work' || row.scope === 'personal', `${name} row carries scope`);
      const json = text(row);
      if (json.includes(CANARY.work)) assert.equal(row.scope, 'work', `${name} work canary row is work`);
      if (json.includes(CANARY.personal)) assert.equal(row.scope, 'personal', `${name} personal canary row is personal`);
    }
  }
  const inboxAll = await db.getInbox(d, 'all');
  assert.equal(inboxAll.length, 2);
  const todayAll = await db.listForToday(d, 'all', TODAY);
  assert.equal(todayAll.checkpoints.length, 2);
  assert.deepEqual(new Set(todayAll.tasks.map((t) => t.scope)), new Set(['work', 'personal']));
});

test('the FTS tables themselves hold one scope each', async () => {
  const { d } = await seeded();
  const work = await d.prepare('SELECT title, body FROM fts_work').all();
  const personal = await d.prepare('SELECT title, body FROM fts_personal').all();
  assert.ok(work.results.length > 0 && personal.results.length > 0);
  assert.equal(text(work.results).includes(CANARY.personal), false);
  assert.equal(text(personal.results).includes(CANARY.work), false);
});
