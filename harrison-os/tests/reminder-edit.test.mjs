// PATCH /api/reminders/:id: edit words, date, time, zone, recurrence of an active reminder. Sample data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/d1.mjs';
import { createWorker, runScheduled } from '../src/api.js';

const BASE = 'http://127.0.0.1:8899';
const TZ = 'America/New_York';

function setup(nowMs) {
  const DB = createTestDb();
  let clock = nowMs;
  const worker = createWorker({ now: () => clock });
  const env = { DB, BUILD_ID: 'test', DEV_ALLOW_UNAUTH: '1', SPIKE_TEST_HOOKS: '0', ALLOW_TEST_PUSH_ENDPOINT: '0', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', ACCESS_AUD_SHORTCUT: '', VAPID_PUBLIC_KEY: '', VAPID_SUBJECT: '' };
  async function call(method, path, body) {
    const headers = { 'X-Requested-With': 'XMLHttpRequest' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await worker.fetch(new Request(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, data: await res.json().catch(() => null) };
  }
  return { call, env, setNow: (ms) => (clock = ms) };
}

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0); // Thu Oct 29, 08:00 New York (EDT)
const make = (call, over = {}) =>
  call('POST', '/api/reminders', { id: 'rem-edit-00001', scope: 'personal', text: 'Sample reminder', local_date: '2026-10-30', local_time: '09:00', time_zone: TZ, ...over });

test('edit moves the next firing by wall-clock time in its zone, and a list reload shows it', async () => {
  const { call } = setup(NOW);
  assert.equal((await make(call)).status, 201);
  const r = await call('PATCH', '/api/reminders/rem-edit-00001', { scope: 'personal', text: 'Sample reminder, edited', local_time: '15:30' });
  assert.equal(r.status, 200);
  assert.equal(r.data.reminder.text, 'Sample reminder, edited');
  assert.equal(r.data.reminder.next_fire_at, Date.UTC(2026, 9, 30, 19, 30)); // 15:30 EDT
  const list = await call('GET', '/api/reminders?scope=personal');
  assert.equal(list.data.items[0].local_time, '15:30');
  assert.equal(list.data.items[0].next_fire_at, Date.UTC(2026, 9, 30, 19, 30));
});

test('daily across the DST change keeps 23:00 local; a one-off in the past is refused and nothing changes', async () => {
  const { call } = setup(NOW);
  await make(call);
  const d = await call('PATCH', '/api/reminders/rem-edit-00001', { scope: 'personal', local_date: '2026-11-01', local_time: '23:00', recurrence: 'daily' });
  assert.equal(d.status, 200);
  assert.equal(d.data.reminder.next_fire_at, Date.UTC(2026, 10, 2, 4, 0)); // Sun Nov 1 23:00 EST = 04:00Z
  const past = await call('PATCH', '/api/reminders/rem-edit-00001', { scope: 'personal', local_date: '2026-10-28', recurrence: 'none' });
  assert.equal(past.status, 422); // validation: 'That local date and time has already passed'
  const list = await call('GET', '/api/reminders?scope=personal');
  assert.equal(list.data.items[0].recurrence, 'daily');
  assert.equal(list.data.items[0].next_fire_at, Date.UTC(2026, 10, 2, 4, 0));
});

test('a reminder that already fired cannot be edited; other scope gets 404; bad fields are 400', async () => {
  const { call, env, setNow } = setup(NOW);
  await make(call);
  assert.equal((await call('PATCH', '/api/reminders/rem-edit-00001', { scope: 'work', text: 'x' })).status, 404);
  assert.equal((await call('PATCH', '/api/reminders/rem-edit-00001', { scope: 'personal', local_time: '9am' })).status, 400);
  assert.equal((await call('PATCH', '/api/reminders/rem-edit-00001', { scope: 'personal', recurrence: 'weekly' })).status, 400);
  const fireAt = Date.UTC(2026, 9, 30, 13, 1);
  setNow(fireAt);
  assert.equal((await runScheduled(env, fireAt)).fired, 1);
  const r = await call('PATCH', '/api/reminders/rem-edit-00001', { scope: 'personal', local_date: '2026-11-02' });
  assert.equal(r.status, 409);
});

test('an edit based on a stale next firing is refused, not applied to the wrong occurrence', async () => {
  const db = await import('../src/db.js');
  const DB = createTestDb();
  const T = new Date(NOW).toISOString();
  await db.createReminder(DB, { id: 'rem-edit-00002', text: 'Sample', localDate: '2026-10-30', localTime: '09:00', timeZone: TZ, recurrence: 'daily' }, 'work', T);
  // Simulate the cron advancing the daily reminder between the load and the write.
  const realFirst = DB.prepare.bind(DB);
  let advanced = false;
  DB.prepare = (sql) => {
    if (!advanced && sql.startsWith('UPDATE reminders SET text')) {
      advanced = true;
      realFirst('UPDATE reminders SET next_fire_at = next_fire_at + 86400000 WHERE id = ?').bind('rem-edit-00002').run();
    }
    return realFirst(sql);
  };
  await assert.rejects(db.updateReminder(DB, 'rem-edit-00002', { localTime: '10:00' }, 'work', T), (e) => e instanceof db.ConflictError);
});
