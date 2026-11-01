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

// ---------------------------------------------------------------- edit vs cron atomicity

// Runs `during` (a synchronous raw write, i.e. an edit that committed) right before the next SQL statement
// starting with `prefix` is prepared: the cron's read has happened, its claim/advance has not.
function interleave(DB, prefix, during) {
  const prepare = DB.prepare.bind(DB);
  let done = false;
  DB.prepare = (sql) => {
    if (!done && sql.startsWith(prefix)) {
      done = true;
      during(prepare);
    }
    return prepare(sql);
  };
}

const CLAIM = "INSERT OR IGNORE INTO deliveries (id, reminder_id, scheduled_for, local_label, state, attempts, created_at) SELECT";
const T = Date.UTC(2026, 9, 30, 13, 0); // Oct 30 09:00 EDT, the reminder's first firing

test('cron read T, edit re-times to U, cron claims: nothing is sent for T and U fires once at U', async () => {
  const { call, env } = setup(NOW);
  await make(call);
  const U = Date.UTC(2026, 9, 30, 15, 0);
  interleave(env.DB, CLAIM, (prepare) => prepare("UPDATE reminders SET local_time = '11:00', next_fire_at = ? WHERE id = 'rem-edit-00001'").bind(U).run());
  const s1 = await runScheduled(env, T + 60_000);
  assert.equal(s1.fired, 0);
  assert.equal(s1.stale, 1);
  let list = await call('GET', '/api/reminders?scope=personal');
  assert.equal(list.data.items[0].deliveries.length, 0, 'no alert for the old time');
  assert.equal(list.data.items[0].next_fire_at, U, 'the edit was not overwritten by an advance');
  const s2 = await runScheduled(env, U + 60_000);
  assert.equal(s2.fired, 1);
  list = await call('GET', '/api/reminders?scope=personal');
  assert.deepEqual(list.data.items[0].deliveries.map((d) => d.scheduled_for), [U]);
  assert.equal(list.data.items[0].state, 'done');
});

test('cron read T, edit changes only the words (same T), cron claims: the old words are not sent; the next run sends the new ones', async () => {
  const { call, env } = setup(NOW);
  await make(call, { recurrence: 'daily' });
  interleave(env.DB, CLAIM, (prepare) => prepare("UPDATE reminders SET text = 'Sample reminder, new words' WHERE id = 'rem-edit-00001'").run());
  const s1 = await runScheduled(env, T + 60_000);
  assert.equal(s1.stale, 1);
  assert.equal(s1.fired, 0);
  const s2 = await runScheduled(env, T + 120_000);
  assert.equal(s2.fired, 1);
  const list = await call('GET', '/api/reminders?scope=personal');
  const r = list.data.items[0];
  assert.equal(r.text, 'Sample reminder, new words');
  assert.deepEqual(r.deliveries.map((d) => d.scheduled_for), [T], 'one alert for T, with the words current at the claim');
  assert.equal(r.next_fire_at, Date.UTC(2026, 9, 31, 13, 0), 'advanced to the next day');
});

test('claimed T, then an edit (re-time, words, zone or repeat), then advance: the edit is refused until the cron advanced', async () => {
  const db = await import('../src/db.js');
  for (const patch of [{ local_time: '11:00' }, { text: 'Other words' }, { time_zone: 'America/Chicago' }, { recurrence: 'none', local_date: '2026-11-02' }]) {
    const { call, env, setNow } = setup(NOW);
    await make(call, { recurrence: 'daily' });
    setNow(T + 30_000);
    const [rem] = await db.listDueReminders(env.DB, T + 30_000, 5);
    assert.equal(await db.claimDueOccurrence(env.DB, rem, { id: 'dl-claim-0001', localLabel: 'x' }, new Date(T).toISOString()), 'claimed');
    const r = await call('PATCH', '/api/reminders/rem-edit-00001', { scope: 'personal', ...patch });
    assert.equal(r.status, 409, JSON.stringify(patch));
    assert.equal(r.data.error.code, 'firing_now');
    // The cron's guarded advance still applies (the edit changed nothing).
    assert.equal(await db.advanceReminder(env.DB, 'rem-edit-00001', T, Date.UTC(2026, 9, 31, 13, 0)), true);
    const after = await call('PATCH', '/api/reminders/rem-edit-00001', { scope: 'personal', ...patch });
    assert.equal(after.status, 200, `after advance ${JSON.stringify(patch)}`);
  }
});

test('an alert held for quiet hours: editing is refused (no old + new alert); cancelling still works', async () => {
  const db = await import('../src/db.js');
  const { call, env, setNow } = setup(NOW);
  await make(call, { recurrence: 'daily' });
  setNow(T + 30_000);
  const [rem] = await db.listDueReminders(env.DB, T + 30_000, 5);
  await db.claimDueOccurrence(env.DB, rem, { id: 'dl-held-00001', localLabel: 'x' }, new Date(T).toISOString());
  await db.holdDelivery(env.DB, 'dl-held-00001', T + 8 * 3600_000);
  await db.advanceReminder(env.DB, 'rem-edit-00001', T, Date.UTC(2026, 9, 31, 13, 0));
  const r = await call('PATCH', '/api/reminders/rem-edit-00001', { scope: 'personal', local_time: '10:00' });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'alert_held');
  assert.equal((await call('POST', '/api/reminders/rem-edit-00001/cancel', { scope: 'personal' })).status, 200);
});

test('an edit from an outdated view is refused even when the next firing is unchanged; push test still records its delivery', async () => {
  const { call } = setup(NOW);
  const created = (await make(call, { recurrence: 'daily' })).data.reminder;
  const seen = { text: created.text, time_zone: created.time_zone, local_date: created.local_date, local_time: created.local_time, recurrence: created.recurrence, next_fire_at: created.next_fire_at };
  assert.equal((await call('PATCH', '/api/reminders/rem-edit-00001', { scope: 'personal', text: 'Tab one words', expected: seen })).status, 200);
  const stale = await call('PATCH', '/api/reminders/rem-edit-00001', { scope: 'personal', text: 'Tab two words', expected: seen });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error.code, 'stale_edit');
  const list = await call('GET', '/api/reminders?scope=personal');
  assert.equal(list.data.items[0].text, 'Tab one words');
  // The push test has no reminders row; it keeps using the plain insert and still records its delivery.
  const t = await call('POST', '/api/push/test', {});
  assert.equal(t.status, 200);
  assert.match(t.data.reminder_id, /^test-/);
  assert.equal(t.data.state, 'no_route');
});
