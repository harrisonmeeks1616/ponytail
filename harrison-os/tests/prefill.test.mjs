// Save my place prefill: where he stopped is not the same task as the next step; a deferred task is not the
// next step; an open question saved last time carries forward. Sample data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/d1.mjs';
import * as db from '../src/db.js';

test('prefill: finished task is where he stopped, deferred task is not next, question carries forward', async () => {
  const d = createTestDb();
  const T = (m) => `2026-10-29T12:0${m}:00.000Z`;
  const p = (await db.createProject(d, { name: 'Sample project' }, 'work', T(0))).project.id;
  await db.saveCheckpoint(d, p, { stopped_at_text: 'x', open_question: 'Sensors in exam rooms?', next_step: 'y' }, 'work', T(0));
  const done = (await db.createItem(d, { kind: 'task', title: 'Send panel schedule', projectId: p }, 'work', T(1))).item.id;
  await db.createItem(d, { kind: 'task', title: 'Walk level 2', projectId: p }, 'work', T(2));
  const later = (await db.createItem(d, { kind: 'task', title: 'Order drywall', projectId: p, dueOn: '2026-11-02' }, 'work', T(3))).item.id;
  await db.completeItem(d, done, 'work', T(4));
  await db.updateItem(d, later, { start_on: '2999-01-01' }, 'work', T(5));
  const pre = await db.checkpointPrefill(d, p, 'work');
  assert.equal(pre.stoppedAtText, 'Finished: Send panel schedule');
  assert.equal(pre.nextStep, 'Walk level 2');
  assert.equal(pre.openQuestion, 'Sensors in exam rooms?');
});
