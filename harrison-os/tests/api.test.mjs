// HTTP API tests: the Worker's fetch handler driven in-process, with the node:sqlite D1 adapter as env.DB
// and DEV_ALLOW_UNAUTH on a loopback URL. Sample data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from './helpers/d1.mjs';
import worker from '../src/worker.js';
import { authorizeRoute } from '../src/auth.js';
import { createWorker, CSP, runScheduled, CRON_BATCH_CAP, STALE_SEND_MS } from '../src/api.js';
import * as db from '../src/db.js';

const BASE = 'http://127.0.0.1:8899';
const TZ = 'America/New_York';
// Thursday 2026-10-29 08:00 in New York.
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const TODAY = '2026-10-29';
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

const SAMPLE =
  'Need to order panel labels for the lobby. Waiting on the alternate light quote from Sam. ' +
  'Remind me tomorrow at 3pm to call the inspector. The gate code is 4417.';

function setup({ now = NOW, authenticateImpl, env: extraEnv = {} } = {}) {
  const DB = createTestDb();
  let clock = now;
  const worker = createWorker({ now: () => clock, ...(authenticateImpl ? { authenticateImpl } : {}) });
  const env = {
    DB,
    BUILD_ID: 'test',
    DEV_ALLOW_UNAUTH: '1',
    SPIKE_TEST_HOOKS: '0',
    ALLOW_TEST_PUSH_ENDPOINT: '0',
    ACCESS_TEAM_DOMAIN: '',
    ACCESS_AUD: '',
    ACCESS_AUD_SHORTCUT: '',
    VAPID_PUBLIC_KEY: '',
    VAPID_SUBJECT: '',
    ...extraEnv,
  };
  async function call(method, path, { body, headers = {}, csrf = true, base = BASE } = {}) {
    const h = { ...headers };
    if (csrf && method !== 'GET') h['X-Requested-With'] = 'XMLHttpRequest';
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await worker.fetch(
      new Request(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }),
      env,
    );
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return { status: res.status, headers: res.headers, data, text };
  }
  return { DB, env, worker, call, setNow: (ms) => (clock = ms), now: () => clock };
}

async function capture(call, { id, text, scope, tz = TZ, at = NOW }) {
  return call('POST', '/api/captures', {
    body: { id, text, scope, client_created_at: new Date(at).toISOString(), time_zone: tz },
  });
}

const q = (o) => new URLSearchParams(o).toString();

// ---------------------------------------------------------------- the main flow

test('capture -> proposals -> review -> today -> complete -> undo', async () => {
  const { call, DB } = setup();

  const c1 = await capture(call, { id: 'cap-flow-0001', text: SAMPLE, scope: 'work' });
  assert.equal(c1.status, 201);
  assert.equal(c1.headers.get('cache-control'), 'no-store');
  assert.match(c1.headers.get('content-type'), /application\/json/);
  assert.equal(c1.data.duplicate, false);
  assert.equal(c1.data.capture.text, SAMPLE);
  assert.equal(c1.data.capture.review_state, 'pending');
  assert.equal(c1.data.capture.time_zone, TZ);
  assert.deepEqual(c1.data.proposals.map((p) => p.kind), ['task', 'waiting', 'reminder']);
  assert.ok(c1.data.proposals.every((p) => p.state === 'pending'));

  // A retry of the same capture (lost response) is a duplicate with the same proposals, never a second capture.
  const c2 = await capture(call, { id: 'cap-flow-0001', text: SAMPLE, scope: 'work' });
  assert.equal(c2.status, 200);
  assert.equal(c2.data.duplicate, true);
  assert.equal(c2.data.capture.receive_count, 2);
  assert.equal(c2.data.proposals.length, 3);
  // Same id, different words: refused.
  const c3 = await capture(call, { id: 'cap-flow-0001', text: 'Different words.', scope: 'work' });
  assert.equal(c3.status, 409);
  assert.equal(c3.data.error.code, 'id_conflict');

  const inboxWork = await call('GET', `/api/inbox?${q({ scope: 'work' })}`);
  assert.equal(inboxWork.status, 200);
  assert.equal(inboxWork.data.captures.length, 1);
  assert.equal(inboxWork.data.captures[0].id, 'cap-flow-0001');
  assert.equal(inboxWork.data.captures[0].proposals.length, 3);
  const inboxPersonal = await call('GET', `/api/inbox?${q({ scope: 'personal' })}`);
  assert.equal(inboxPersonal.data.captures.length, 0);
  const inboxAll = await call('GET', `/api/inbox?${q({ scope: 'all' })}`);
  assert.equal(inboxAll.data.captures.length, 1);

  // Review: the task gets a hard date of today (an explicit user edit); the reminder uses the UI's
  // remind_on / remind_time keys.
  const [task, waiting, reminder] = c1.data.proposals;
  const rev = await call('POST', '/api/captures/cap-flow-0001/review', {
    body: {
      scope: 'work',
      accept: [
        { ordinal: task.ordinal, edits: { due_on: TODAY } },
        { ordinal: waiting.ordinal, edits: {} },
        { ordinal: reminder.ordinal, edits: { remind_on: '2026-10-30', remind_time: '15:30' } },
      ],
      drop: [],
      keepAsNote: false,
    },
  });
  assert.equal(rev.status, 200, rev.text);
  assert.equal(rev.data.capture.review_state, 'reviewed');
  assert.equal(rev.data.items.length, 2);
  assert.equal(rev.data.reminders.length, 1);
  assert.equal(rev.data.reminders[0].local_time, '15:30');
  assert.equal(rev.data.reminders[0].scope, 'work');
  const taskItem = rev.data.items.find((i) => i.kind === 'task');
  const waitItem = rev.data.items.find((i) => i.kind === 'waiting');
  assert.equal(taskItem.title, 'order panel labels for the lobby');
  assert.equal(taskItem.due_on, TODAY);
  assert.equal(taskItem.source_quote, 'Need to order panel labels for the lobby.');
  // Ambiguity stays unspecified; no status was invented.
  assert.equal(waitItem.claim_status, 'unspecified');
  assert.equal(waitItem.who, 'Sam');
  assert.equal(waitItem.promised_on, null);
  assert.equal((await call('GET', `/api/inbox?${q({ scope: 'work' })}`)).data.captures.length, 0);

  // Waiting route (the UI's Waiting screen).
  const w = await call('GET', `/api/items?${q({ kind: 'waiting', state: 'open', scope: 'work' })}`);
  assert.equal(w.status, 200);
  assert.deepEqual(w.data.items.map((i) => i.id), [waitItem.id]);
  assert.equal((await call('GET', `/api/items?${q({ kind: 'waiting', state: 'open', scope: 'personal' })}`)).data.items.length, 0);

  // Today: the task due today is next; the waiting item has no follow-up date, so it is not.
  const t1 = await call('GET', `/api/today?${q({ scope: 'work', tz: TZ })}`);
  assert.equal(t1.status, 200, t1.text);
  assert.equal(t1.data.todayOn, TODAY);
  assert.equal(t1.data.next.ref, `item:${taskItem.id}`);
  assert.equal(t1.data.next.why, `Hard date is today (${TODAY}).`);
  assert.ok(t1.data.today.some((e) => e.ref === `item:${taskItem.id}`));
  assert.equal(t1.data.waiting.count, 1);
  assert.equal(t1.data.needsYou.inboxCount, 0);
  assert.equal(t1.data.returnView, null);
  assert.equal(await db.getMeta(DB, 'last_open_at'), new Date(NOW).toISOString());
  const tAll = await call('GET', `/api/today?${q({ scope: 'all', tz: TZ })}`);
  assert.equal(tAll.status, 200);
  const tPersonal = await call('GET', `/api/today?${q({ scope: 'personal', tz: TZ })}`);
  assert.equal(tPersonal.data.next, null);

  // Complete, then Undo.
  const done = await call('POST', `/api/items/${taskItem.id}/complete`, { body: { scope: 'work' } });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.data.item.state, 'done');
  assert.ok(Number.isInteger(done.data.changeId));
  const t2 = await call('GET', `/api/today?${q({ scope: 'work', tz: TZ })}`);
  assert.notEqual(t2.data.next && t2.data.next.ref, `item:${taskItem.id}`);

  const undo = await call('POST', `/api/undo/${done.data.changeId}`, { body: {} });
  assert.equal(undo.status, 200, undo.text);
  assert.equal(undo.data.undone.row.state, 'open');
  const again = await call('POST', `/api/undo/${done.data.changeId}`, { body: {} });
  assert.equal(again.status, 409);
  assert.equal(again.data.error.code, 'already_undone');
  const t3 = await call('GET', `/api/today?${q({ scope: 'work', tz: TZ })}`);
  assert.equal(t3.data.next.ref, `item:${taskItem.id}`);

  // Undo refuses a change whose entity moved on since.
  const done2 = await call('POST', `/api/items/${taskItem.id}/complete`, { body: { scope: 'work' } });
  await call('POST', `/api/items/${taskItem.id}/reopen`, { body: { scope: 'work' } });
  const stale = await call('POST', `/api/undo/${done2.data.changeId}`, { body: {} });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error.code, 'state_moved_on');
  // A scope that does not match the change is not found.
  const wrongScope = await call('POST', `/api/undo/${done2.data.changeId}`, { body: { scope: 'personal' } });
  assert.equal(wrongScope.status, 404);

  // Waiting actions: reply never changes the claim status; a status change is an explicit edit with Undo.
  const reply = await call('POST', `/api/items/${waitItem.id}/reply`, { body: { scope: 'work' } });
  assert.equal(reply.status, 200);
  assert.equal(reply.data.item.claim_status, 'unspecified');
  assert.ok(reply.data.item.reply_recorded_at);
  const snooze = await call('POST', `/api/items/${waitItem.id}/snooze`, { body: { scope: 'work', follow_up_on: '2026-11-02' } });
  assert.equal(snooze.status, 200);
  assert.equal(snooze.data.item.follow_up_on, '2026-11-02');
  const badSnooze = await call('POST', `/api/items/${waitItem.id}/snooze`, { body: { scope: 'work', follow_up_on: 'Friday' } });
  assert.equal(badSnooze.status, 400);
  const patch = await call('PATCH', `/api/items/${waitItem.id}`, { body: { scope: 'work', claim_status: 'confirmed' } });
  assert.equal(patch.status, 200, patch.text);
  assert.equal(patch.data.item.claim_status, 'confirmed');
  const badPatch = await call('PATCH', `/api/items/${waitItem.id}`, { body: { scope: 'work', claim_status: 'probably' } });
  assert.equal(badPatch.status, 400);
  assert.equal(badPatch.data.error.code, 'invalid');
  const moveScope = await call('PATCH', `/api/items/${waitItem.id}`, { body: { scope: 'personal', title: 'x' } });
  assert.equal(moveScope.status, 404);

  // No event carries user text.
  const events = JSON.stringify(await db.listEvents(DB, 500));
  for (const word of ['panel', 'lobby', 'Sam', 'inspector', '4417', 'alternate']) assert.ok(!events.includes(word), word);
});

test('a capture with no known time zone is saved, with no proposals and none invented', async () => {
  const { call } = setup();
  const r = await call('POST', '/api/captures', { body: { id: 'cap-notz-0001', text: 'Remind me tomorrow at 3pm to call.', scope: 'personal' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.capture.time_zone, null);
  assert.deepEqual(r.data.proposals, []);
  // Once the app has reported a zone, later captures use it.
  await call('GET', `/api/today?${q({ scope: 'all', tz: TZ })}`);
  const r2 = await call('POST', '/api/captures', { body: { id: 'cap-notz-0002', text: 'Remind me tomorrow at 3pm to call.', scope: 'personal' } });
  assert.equal(r2.data.capture.time_zone, TZ);
  assert.equal(r2.data.proposals.length, 1);
  // Today without tz falls back to the remembered zone; with a bad tz it is refused.
  assert.equal((await call('GET', `/api/today?${q({ scope: 'all' })}`)).status, 200);
  assert.equal((await call('GET', `/api/today?${q({ scope: 'all', tz: 'Mars/Base' })}`)).status, 400);
});

test('an offline capture is read relative to when it was captured', async () => {
  const { call } = setup({ now: NOW + 2 * DAY });
  // Captured Thursday, synced Saturday: "tomorrow" is Friday.
  const r = await capture(call, { id: 'cap-offline-01', text: 'Remind me tomorrow at 3pm to call the office.', scope: 'work', at: NOW });
  assert.equal(r.status, 201);
  assert.equal(r.data.proposals[0].payload.fields.when.on, '2026-10-30');
});

test('keep as a note, drop, and the review validation', async () => {
  const { call } = setup();
  await capture(call, { id: 'cap-note-0001', text: SAMPLE, scope: 'personal' });
  const bad = await call('POST', '/api/captures/cap-note-0001/review', { body: { scope: 'personal', accept: [{ ordinal: 99 }] } });
  assert.equal(bad.status, 400);
  const wrongScope = await call('POST', '/api/captures/cap-note-0001/review', { body: { scope: 'work', accept: [], keepAsNote: true } });
  assert.equal(wrongScope.status, 404);
  // A personal capture can never produce a work item.
  const up = await call('POST', '/api/captures/cap-note-0001/review', {
    body: { scope: 'personal', accept: [{ ordinal: 1, edits: { scope: 'work' } }] },
  });
  assert.equal(up.status, 400);
  assert.equal(up.data.error.code, 'scope_not_allowed');
  const note = await call('POST', '/api/captures/cap-note-0001/review', {
    body: { scope: 'personal', accept: [], drop: [1, 2, 3], keepAsNote: true },
  });
  assert.equal(note.status, 200);
  assert.equal(note.data.capture.review_state, 'note');
  assert.equal(note.data.items.length, 0);
});

// ---------------------------------------------------------------- CSRF and scope rules

test('CSRF: a change without X-Requested-With is refused with 403', async () => {
  const { call } = setup();
  const r = await call('POST', '/api/captures', { csrf: false, body: { id: 'cap-csrf-0001', text: 'hello', scope: 'work', time_zone: TZ } });
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, 'csrf');
  const wrongValue = await call('POST', '/api/projects', {
    csrf: false,
    headers: { 'X-Requested-With': 'fetch' },
    body: { name: 'x', scope: 'work' },
  });
  assert.equal(wrongValue.status, 403);
  await capture(call, { id: 'cap-csrf-0002', text: 'Need to keep this.', scope: 'work' });
  const del = await call('DELETE', `/api/captures/cap-csrf-0002?${q({ scope: 'work' })}`, { csrf: false });
  assert.equal(del.status, 403);
  assert.equal((await call('GET', `/api/inbox?${q({ scope: 'work' })}`)).data.captures.length, 1);
  // Reads do not need it.
  assert.equal((await call('GET', '/api/session')).status, 200);
});

test('scope is required, never defaulted to all, and all is refused where forbidden', async () => {
  const { call } = setup();
  const cases = [
    ['GET', '/api/inbox', 'scope_required'],
    ['GET', `/api/today?${q({ tz: TZ })}`, 'scope_required'],
    ['GET', '/api/projects', 'scope_required'],
    ['GET', '/api/export', 'scope_required'],
    ['GET', `/api/search?${q({ q: 'x' })}`, 'scope_required'],
    ['GET', `/api/search?${q({ q: 'x', scope: 'all' })}`, 'scope_all_not_allowed'],
    ['GET', `/api/items?${q({ scope: 'all' })}`, 'scope_all_not_allowed'],
    ['GET', `/api/projects/p1?${q({ scope: 'all' })}`, 'scope_all_not_allowed'],
    ['GET', `/api/projects/p1/checkpoint/prefill?${q({ scope: 'all' })}`, 'scope_all_not_allowed'],
    ['GET', `/api/reminders?${q({ scope: 'all' })}`, 'scope_all_not_allowed'],
    ['GET', `/api/inbox?${q({ scope: 'everything' })}`, 'invalid_scope'],
    ['DELETE', '/api/captures/cap-scope-0001', 'scope_required'],
    ['DELETE', `/api/captures/cap-scope-0001?${q({ scope: 'all' })}`, 'scope_all_not_allowed'],
  ];
  for (const [method, path, code] of cases) {
    const r = await call(method, path);
    assert.equal(r.status, 400, `${method} ${path}`);
    assert.equal(r.data.error.code, code, `${method} ${path}`);
  }
  const bodies = [
    ['/api/captures', { id: 'cap-scope-0002', text: 'x', time_zone: TZ }, 'scope_required'],
    ['/api/captures', { id: 'cap-scope-0003', text: 'x', scope: 'all', time_zone: TZ }, 'scope_all_not_allowed'],
    ['/api/items', { kind: 'task', title: 'x' }, 'scope_required'],
    ['/api/items', { kind: 'task', title: 'x', scope: 'all' }, 'scope_all_not_allowed'],
    ['/api/projects', { name: 'x', scope: 'all' }, 'scope_all_not_allowed'],
    ['/api/items/i1/complete', {}, 'scope_required'],
    ['/api/captures/cap-scope-0001/review', { accept: [] }, 'scope_required'],
  ];
  for (const [path, body, code] of bodies) {
    const r = await call('POST', path, { body });
    assert.equal(r.status, 400, path);
    assert.equal(r.data.error.code, code, path);
  }
  // 'all' works where the contract allows it.
  for (const path of ['/api/inbox', '/api/projects', '/api/export']) {
    assert.equal((await call('GET', `${path}?${q({ scope: 'all' })}`)).status, 200, path);
  }
  assert.equal((await call('GET', `/api/today?${q({ scope: 'all', tz: TZ })}`)).status, 200);
});

// ---------------------------------------------------------------- search, export, deletion

test('search runs per scope and never crosses scopes', async () => {
  const { call } = setup();
  await capture(call, { id: 'cap-srch-w001', text: 'Need to check ZZWORKWORD conduit fill.', scope: 'work' });
  await capture(call, { id: 'cap-srch-p001', text: 'Waiting on ZZPERSONALWORD refund from the bank.', scope: 'personal' });
  const s = (term, scope) => call('GET', `/api/search?${q({ q: term, scope })}`);
  const ww = await s('zzworkword', 'work');
  assert.equal(ww.status, 200);
  assert.equal(ww.data.scope, 'work');
  assert.equal(ww.data.results.length, 1);
  assert.equal(ww.data.results[0].ref, 'capture:cap-srch-w001');
  assert.equal((await s('zzworkword', 'personal')).data.results.length, 0);
  assert.equal((await s('ZZPERSONALWORD', 'work')).data.results.length, 0);
  assert.equal((await s('ZZPERSONALWORD', 'personal')).data.results.length, 1);
  // Hostile FTS syntax is only ever literal text.
  const hostile = await s('" OR * NEAR( title: ^x', 'work');
  assert.equal(hostile.status, 200);
  assert.deepEqual(hostile.data.results, []);
  assert.equal((await s('x'.repeat(501), 'work')).status, 400);
});

test('export is an attachment and keeps to its scope', async () => {
  const { call } = setup();
  await capture(call, { id: 'cap-exp-w0001', text: 'Need to check ZZWORKWORD conduit fill.', scope: 'work' });
  await capture(call, { id: 'cap-exp-p0001', text: 'Waiting on ZZPERSONALWORD refund from the bank.', scope: 'personal' });
  const work = await call('GET', `/api/export?${q({ scope: 'work' })}`);
  assert.equal(work.status, 200);
  assert.match(work.headers.get('content-disposition'), /^attachment; filename="harrison-os-work-2026-10-29\.json"$/);
  assert.equal(work.headers.get('cache-control'), 'no-store');
  assert.equal(work.data.format, 'harrison-os-export');
  assert.equal(work.data.scope, 'work');
  assert.ok(work.text.includes('ZZWORKWORD'));
  assert.ok(!work.text.includes('ZZPERSONALWORD'));
  assert.equal(work.data.tables.meta, undefined);
  const all = await call('GET', `/api/export?${q({ scope: 'all' })}`);
  assert.ok(all.text.includes('ZZWORKWORD') && all.text.includes('ZZPERSONALWORD'));
  assert.ok(all.data.tables.captures.every((c) => c.scope === 'work' || c.scope === 'personal'));
});

test('deleting a capture removes its words and keeps filed items, marked as from a deleted capture', async () => {
  const { call } = setup();
  const c = await capture(call, { id: 'cap-del-00001', text: SAMPLE, scope: 'work' });
  const rev = await call('POST', '/api/captures/cap-del-00001/review', {
    body: { scope: 'work', accept: [{ ordinal: 1 }], drop: [2, 3] },
  });
  assert.equal(rev.status, 200);
  const itemId = rev.data.items[0].id;
  assert.equal(c.data.proposals.length, 3);

  const del = await call('DELETE', `/api/captures/cap-del-00001?${q({ scope: 'work' })}`);
  assert.equal(del.status, 200, del.text);
  assert.equal(del.data.deleted.captures, 1);
  assert.equal(del.data.deleted.proposals, 3);
  assert.equal(del.data.deleted.itemsDetached, 1);

  const items = await call('GET', `/api/items?${q({ scope: 'work' })}`);
  const item = items.data.items.find((i) => i.id === itemId);
  assert.equal(item.title, 'order panel labels for the lobby');
  assert.equal(item.source_deleted, 1);
  assert.equal(item.source_capture_id, null);
  assert.equal(item.source_quote, null);

  // The capture's own words are gone from search and export, including Undo history.
  assert.equal((await call('GET', `/api/search?${q({ q: '4417', scope: 'work' })}`)).data.results.length, 0);
  assert.equal((await call('GET', `/api/search?${q({ q: 'labels', scope: 'work' })}`)).data.results.length, 1);
  const exp = await call('GET', `/api/export?${q({ scope: 'all' })}`);
  for (const word of ['4417', 'gate code', 'inspector', 'Need to order']) assert.ok(!exp.text.includes(word), word);
  assert.equal(exp.data.tables.captures.length, 0);

  // Deleting again is harmless; deleting from the wrong scope does nothing.
  const again = await call('DELETE', `/api/captures/cap-del-00001?${q({ scope: 'work' })}`);
  assert.equal(again.data.deleted.captures, 0);
  await capture(call, { id: 'cap-del-00002', text: 'Need to keep this one.', scope: 'personal' });
  const wrong = await call('DELETE', `/api/captures/cap-del-00002?${q({ scope: 'work' })}`);
  assert.equal(wrong.data.deleted.captures, 0);
  assert.equal((await call('GET', `/api/inbox?${q({ scope: 'personal' })}`)).data.captures.length, 1);
});

test('an undated task is listed as open, counted on Today, and can be picked for today and unpicked with Undo', async () => {
  const { call } = setup();
  await capture(call, { id: 'cap-open-0001', text: 'Need to order panel labels for the sample lobby.', scope: 'work' });
  const rev = await call('POST', '/api/captures/cap-open-0001/review', { body: { scope: 'work', accept: [{ ordinal: 1 }] } });
  assert.equal(rev.status, 200, rev.text);
  const id = rev.data.items[0].id;
  assert.equal(rev.data.items[0].due_on, null);
  assert.equal(rev.data.items[0].today_pick, 0);

  const today = async () => (await call('GET', `/api/today?${q({ scope: 'all', tz: TZ })}`)).data;
  let t = await today();
  assert.deepEqual(t.tasks, { openCount: 1 }, 'Today counts the undated task');
  assert.deepEqual(t.today, []);
  const open = await call('GET', `/api/items?${q({ scope: 'work', kind: 'task', state: 'open' })}`);
  assert.deepEqual(open.data.items.map((i) => i.id), [id], 'Open tasks lists it');

  const pick = await call('PATCH', `/api/items/${id}`, { body: { scope: 'work', today_pick: true } });
  assert.equal(pick.status, 200, pick.text);
  assert.ok(pick.data.changeId);
  t = await today();
  assert.deepEqual(t.today.map((r) => [r.ref, r.meta, r.picked]), [[`item:${id}`, 'Picked for today', true]]);
  assert.equal(t.next.kind, 'task');
  assert.equal(t.next.why, 'You picked this for today.');

  const undo = await call('POST', `/api/undo/${pick.data.changeId}`, { body: {} });
  assert.equal(undo.status, 200, undo.text);
  t = await today();
  assert.deepEqual(t.today, []);
  assert.equal(t.tasks.openCount, 1);
  const bad = await call('PATCH', `/api/items/${id}`, { body: { scope: 'work', today_pick: 'yes' } });
  assert.equal(bad.status, 400);
});

test('a late outbox retry of a deleted capture is answered 200 and never stores the words again', async () => {
  const { call } = setup();
  // The phone's POST committed but its response was lost, so the outbox still holds the capture.
  await capture(call, { id: 'cap-ghost-0001', text: 'Call Zelda about the 4417 gate.', scope: 'work' });
  const del = await call('DELETE', `/api/captures/cap-ghost-0001?${q({ scope: 'work' })}`);
  assert.equal(del.data.deleted.captures, 1);

  const retry = await capture(call, { id: 'cap-ghost-0001', text: 'Call Zelda about the 4417 gate.', scope: 'work' });
  assert.equal(retry.status, 200, 'the outbox treats 200 as synced and stops retrying');
  assert.equal(retry.data.deleted, true);
  assert.equal(retry.data.duplicate, true);
  assert.equal(retry.data.capture, null);
  assert.deepEqual(retry.data.proposals, []);
  assert.equal((await call('GET', `/api/inbox?${q({ scope: 'work' })}`)).data.captures.length, 0);
  assert.equal((await call('GET', `/api/search?${q({ q: 'Zelda', scope: 'work' })}`)).data.results.length, 0);
  const exp = await call('GET', `/api/export?${q({ scope: 'all' })}`);
  assert.ok(!exp.text.includes('Zelda'), 'deleted words are not in the export');
  assert.ok(!exp.text.includes('deleted_capture'), 'the tombstone (kv) is not exported');

  // The Shortcut route honours the same tombstone.
  const sc1 = await call('POST', '/api/shortcut/capture', { body: { text: 'Shortcut sample note', client_ref: 'ghost-ref-01', scope: 'work' } });
  assert.equal(sc1.status, 201);
  await call('DELETE', `/api/captures/sc_ghost-ref-01?${q({ scope: 'work' })}`);
  const sc2 = await call('POST', '/api/shortcut/capture', { body: { text: 'Shortcut sample note', client_ref: 'ghost-ref-01', scope: 'work' } });
  assert.equal(sc2.status, 200);
  assert.equal(sc2.data.deleted, true);
  assert.equal((await call('GET', `/api/inbox?${q({ scope: 'work' })}`)).data.captures.length, 0);
});

// ---------------------------------------------------------------- identities

test('shortcut identity: allowed only on POST /api/shortcut/capture, without the CSRF header', async () => {
  // authorizeRoute itself.
  const service = { kind: 'service', commonName: 'shortcut-token' };
  assert.equal(authorizeRoute(service, 'POST', '/api/shortcut/capture'), true);
  for (const [m, p] of [
    ['GET', '/api/shortcut/capture'],
    ['POST', '/api/captures'],
    ['GET', '/api/inbox'],
    ['GET', '/api/export'],
    ['POST', '/api/undo/1'],
  ]) {
    assert.equal(authorizeRoute(service, m, p), false, `${m} ${p}`);
  }
  assert.equal(authorizeRoute({ kind: 'owner' }, 'GET', '/api/inbox'), true);
  assert.equal(authorizeRoute({ kind: 'stranger' }, 'GET', '/api/inbox'), false);

  // And the handler wiring: an identity source that yields the service identity.
  const svc = setup({ authenticateImpl: async () => ({ ...service }) });
  const ok = await svc.call('POST', '/api/shortcut/capture', { csrf: false, body: { text: 'Need to buy filters.', client_ref: 'ref-000001' } });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.data.id, 'sc_ref-000001');
  assert.equal(ok.data.duplicate, false);
  assert.ok(!('text' in ok.data));
  const dup = await svc.call('POST', '/api/shortcut/capture', { csrf: false, body: { text: 'Need to buy filters.', client_ref: 'ref-000001' } });
  assert.equal(dup.status, 200);
  assert.equal(dup.data.duplicate, true);
  for (const [m, p, body] of [
    ['GET', `/api/inbox?${q({ scope: 'personal' })}`],
    ['GET', `/api/export?${q({ scope: 'all' })}`],
    ['POST', '/api/captures', { id: 'cap-svc-00001', text: 'x', scope: 'work' }],
    ['GET', '/api/session'],
  ]) {
    const r = await svc.call(m, p, { body, csrf: false });
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(r.data.error.code, 'forbidden');
  }
  // The shortcut capture landed in Personal (the spike's default) for the owner to review.
  const ownerView = await db.getInbox(svc.DB, 'personal');
  assert.equal(ownerView.length, 1);
  assert.equal(ownerView[0].capture.source, 'shortcut');

  // An owner (cookie) identity on the shortcut route still needs the CSRF header.
  const owner = setup({ authenticateImpl: async () => ({ kind: 'owner', email: 'x', emailMasked: 'x***' }) });
  const noHeader = await owner.call('POST', '/api/shortcut/capture', { csrf: false, body: { text: 'hi' } });
  assert.equal(noHeader.status, 403);
  assert.equal(noHeader.data.error.code, 'csrf');
});

test('auth fails closed: dev bypass only on loopback, and no Access config means 503', async () => {
  const { call } = setup();
  const remote = await call('GET', '/api/session', { base: 'https://harrison-os.example.workers.dev' });
  assert.equal(remote.status, 503);
  assert.equal(remote.data.error.code, 'misconfigured');
  const local = await call('GET', '/api/session');
  assert.equal(local.status, 200);
  assert.equal(local.data.identity.kind, 'dev');

  const closed = setup({ env: { DEV_ALLOW_UNAUTH: '0' } });
  const r = await closed.call('GET', '/api/session');
  assert.equal(r.status, 503);
  assert.equal(r.data.error.code, 'not_configured');
  // Test hooks are off unless enabled, and never off loopback.
  assert.equal((await call('POST', '/api/test/chaos', { body: { mode: 'commit_then_503', count: 1 } })).status, 404);
});

// ---------------------------------------------------------------- projects

test('projects: create, read in scope only, Save my place with prefill', async () => {
  const { call } = setup();
  const p = await call('POST', '/api/projects', { body: { name: 'Lobby lighting', purpose: null, scope: 'work' } });
  assert.equal(p.status, 201, p.text);
  const id = p.data.project.id;
  assert.ok(Number.isInteger(p.data.changeId));
  const list = await call('GET', `/api/projects?${q({ scope: 'all' })}`);
  assert.deepEqual(list.data.projects.map((x) => x.id), [id]);
  assert.equal((await call('GET', `/api/projects?${q({ scope: 'personal' })}`)).data.projects.length, 0);
  assert.equal((await call('GET', `/api/projects/${id}?${q({ scope: 'personal' })}`)).status, 404);

  const item = await call('POST', '/api/items', { body: { kind: 'task', title: 'Order the fixtures', projectId: id, scope: 'work' } });
  assert.equal(item.status, 201, item.text);
  const got = await call('GET', `/api/projects/${id}?${q({ scope: 'work' })}`);
  assert.equal(got.status, 200);
  assert.equal(got.data.project.name, 'Lobby lighting');
  assert.equal(got.data.nextItem.title, 'Order the fixtures');
  assert.equal(got.data.checkpoint, null);

  const pre = await call('GET', `/api/projects/${id}/checkpoint/prefill?${q({ scope: 'work' })}`);
  assert.equal(pre.status, 200);
  assert.equal(pre.data.prefill.nextStep, 'Order the fixtures');
  const save = await call('POST', `/api/projects/${id}/checkpoint`, { body: { scope: 'work', fields: null } });
  assert.equal(save.status, 201, save.text);
  assert.equal(save.data.checkpoint.next_step, 'Order the fixtures');
  const edited = await call('POST', `/api/projects/${id}/checkpoint`, {
    body: { scope: 'work', fields: { stoppedAtText: 'Halfway through the takeoff', nextStep: 'Finish the takeoff' } },
  });
  assert.equal(edited.status, 201);
  const after = await call('GET', `/api/projects/${id}?${q({ scope: 'work' })}`);
  assert.equal(after.data.checkpoint.stopped_at_text, 'Halfway through the takeoff');
  const renamed = await call('PATCH', `/api/projects/${id}`, { body: { scope: 'work', name: 'Lobby lights' } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.project.name, 'Lobby lights');
  const unknown = await call('POST', '/api/items', { body: { kind: 'task', title: 'x', colour: 'red', scope: 'work' } });
  assert.equal(unknown.status, 400);

  // Decisions: a superseding decision keeps both.
  const d1 = await call('POST', '/api/items', { body: { kind: 'decision', title: 'Use LED strips', projectId: id, scope: 'work' } });
  const d2 = await call('POST', '/api/items', {
    body: { kind: 'decision', title: 'Use LED panels', supersedesId: d1.data.item.id, projectId: id, scope: 'work' },
  });
  assert.equal(d2.status, 201, d2.text);
  assert.equal(d2.data.superseded.superseded_by_id, d2.data.item.id);
});

// ---------------------------------------------------------------- return view

test('Today: returnView appears after more than 3 days away, and last_open_at is set after it', async () => {
  const { call, setNow } = setup();
  const first = await call('GET', `/api/today?${q({ scope: 'all', tz: TZ })}`);
  assert.equal(first.data.returnView, null);
  setNow(NOW + 3 * DAY);
  assert.equal((await call('GET', `/api/today?${q({ scope: 'all', tz: TZ })}`)).data.returnView, null);
  setNow(NOW + 7 * DAY + MIN);
  const back = await call('GET', `/api/today?${q({ scope: 'all', tz: TZ })}`);
  assert.ok(back.data.returnView);
  assert.equal(back.data.returnView.daysAway, 4);
  const next = await call('GET', `/api/today?${q({ scope: 'all', tz: TZ })}`);
  assert.equal(next.data.returnView, null);
});

// ---------------------------------------------------------------- reminders and the cron

test('reminders: item_id and scope, cron cap of 3, no route without a subscription', async () => {
  const { call, DB, env } = setup();
  const item = await call('POST', '/api/items', { body: { kind: 'task', title: 'Call the inspector', scope: 'work' } });
  const body = (n, extra = {}) => ({
    id: `rem-cap-0000${n}`,
    text: `Sample reminder ${n}`,
    scope: 'work',
    local_date: '2026-10-29',
    local_time: '09:00',
    time_zone: TZ,
    ...extra,
  });
  const r1 = await call('POST', '/api/reminders', { body: body(1, { item_id: item.data.item.id }) });
  assert.equal(r1.status, 201, r1.text);
  assert.equal(r1.data.reminder.item_id, item.data.item.id);
  assert.equal(r1.data.reminder.scope, 'work');
  assert.equal(r1.data.first_fire.instantMs, Date.UTC(2026, 9, 29, 13, 0, 0));
  assert.equal(r1.data.route.push_subscriptions, 0);
  const dup = await call('POST', '/api/reminders', { body: body(1, { item_id: item.data.item.id }) });
  assert.equal(dup.status, 200);
  assert.equal(dup.data.duplicate, true);
  // An item from another scope cannot be linked.
  const cross = await call('POST', '/api/reminders', { body: body(9, { scope: 'personal', item_id: item.data.item.id }) });
  assert.equal(cross.status, 404);
  const past = await call('POST', '/api/reminders', { body: body(8, { local_time: '07:00' }) });
  assert.equal(past.status, 422);
  for (let n = 2; n <= 5; n++) assert.equal((await call('POST', '/api/reminders', { body: body(n) })).status, 201);

  const at = Date.UTC(2026, 9, 29, 13, 1, 0);
  const s1 = await runScheduled(env, at);
  assert.equal(CRON_BATCH_CAP, 3);
  assert.equal(s1.fired, 3);
  const s2 = await runScheduled(env, at + MIN);
  assert.equal(s2.fired, 2);
  const s3 = await runScheduled(env, at + 2 * MIN);
  assert.equal(s3.fired, 0);
  const list = await call('GET', `/api/reminders?${q({ scope: 'work' })}`);
  assert.equal(list.status, 200);
  assert.equal(list.data.items.length, 5);
  for (const rem of list.data.items) {
    assert.equal(rem.state, 'done');
    assert.equal(rem.deliveries.length, 1);
    assert.equal(rem.deliveries[0].state, 'no_route');
    assert.equal(rem.deliveries[0].outcome_unknown, false);
  }
  assert.equal((await call('GET', `/api/reminders?${q({ scope: 'personal' })}`)).data.items.length, 0);
  const events = JSON.stringify(await db.listEvents(DB, 500));
  assert.ok(!events.includes('Sample reminder'));
});

test('reminders: a send that never recorded its outcome is outcome unknown and is never sent again', async () => {
  const { call, DB, env, setNow } = setup();
  const r = await call('POST', '/api/reminders', {
    body: { id: 'rem-unk-00001', text: 'Sample', scope: 'personal', local_date: '2026-10-29', local_time: '09:00', time_zone: TZ },
  });
  const fireAt = r.data.reminder.next_fire_at;
  // A run that inserted the delivery and was then stopped mid-send: the row stays 'scheduled'.
  await db.insertDelivery(DB, { id: 'dl_killed_0001', reminderId: 'rem-unk-00001', scheduledFor: fireAt, localLabel: 'x' }, new Date(fireAt).toISOString());
  setNow(fireAt + MIN);
  let list = await call('GET', `/api/reminders?${q({ scope: 'personal' })}`);
  assert.equal(list.data.items[0].deliveries[0].state, 'scheduled');
  assert.equal(list.data.items[0].deliveries[0].outcome_unknown, false);
  // The next run finds the reminder still due: the occurrence guard stops a second send.
  const s = await runScheduled(env, fireAt + 2 * MIN);
  assert.equal(s.guarded, 1);
  assert.equal(s.fired, 0);
  setNow(fireAt + STALE_SEND_MS + MIN);
  list = await call('GET', `/api/reminders?${q({ scope: 'personal' })}`);
  const rem = list.data.items[0];
  assert.equal(rem.state, 'done');
  assert.equal(rem.deliveries.length, 1);
  assert.equal(rem.deliveries[0].state, 'scheduled');
  assert.equal(rem.deliveries[0].outcome_unknown, true);
});

test('deliveries: beacon and acknowledgement keep their first values', async () => {
  const { call, DB } = setup();
  await call('POST', '/api/reminders', {
    body: { id: 'rem-ack-00001', text: 'Sample', scope: 'work', local_date: '2026-10-29', local_time: '09:00', time_zone: TZ },
  });
  await db.insertDelivery(DB, { id: 'dl_ack_000001', reminderId: 'rem-ack-00001', scheduledFor: NOW, localLabel: 'x' }, new Date(NOW).toISOString());
  await db.recordDeliveryOutcome(DB, 'dl_ack_000001', { state: 'sent', pushStatus: 201, attempts: 1, sentAt: new Date(NOW).toISOString() });
  const rec = await call('POST', '/api/deliveries/dl_ack_000001/received', { body: { sent_at_ms: NOW } });
  assert.equal(rec.status, 200);
  assert.equal(rec.data.delivery.state, 'received_on_device');
  assert.equal((await call('POST', '/api/deliveries/dl_ack_000001/ack', { body: { via: 'carrier-pigeon' } })).status, 400);
  const ack = await call('POST', '/api/deliveries/dl_ack_000001/ack', { body: { via: 'in_app' } });
  assert.equal(ack.data.delivery.state, 'acknowledged');
  const again = await call('POST', '/api/deliveries/dl_ack_000001/received', { body: {} });
  assert.equal(again.data.delivery.state, 'acknowledged');
  assert.equal((await call('POST', '/api/deliveries/dl_missing_01/ack', { body: { via: 'in_app' } })).status, 404);
  assert.equal((await call('GET', '/api/push/public-key')).status, 503);
});

// ---------------------------------------------------------------- the entry module

test('src/worker.js exports only the default handler, and it serves the API', async () => {
  // workerd treats every named export of the main module as an entrypoint, so there must be none.
  const mod = await import('../src/worker.js');
  assert.deepEqual(Object.keys(mod), ['default']);
  assert.equal(typeof worker.fetch, 'function');
  assert.equal(typeof worker.scheduled, 'function');
  const DB = createTestDb();
  const res = await worker.fetch(new Request(`${BASE}/api/session`), { DB, DEV_ALLOW_UNAUTH: '1' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).identity.kind, 'dev');
});

// ---------------------------------------------------------------- assets and routing

test('static assets get the CSP (Google Fonts allowed), and unknown routes answer JSON errors', async () => {
  const { worker, env, call } = setup();
  env.ASSETS = { fetch: async () => new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }) };
  const res = await worker.fetch(new Request(`${BASE}/`), env);
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.equal(csp, CSP);
  assert.match(csp, /style-src 'self' https:\/\/fonts\.googleapis\.com/);
  assert.match(csp, /font-src https:\/\/fonts\.gstatic\.com/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self';/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const sw = await worker.fetch(new Request(`${BASE}/sw.js`), env);
  assert.equal(sw.headers.get('cache-control'), 'no-cache');

  const nf = await call('GET', '/api/nothing-here');
  assert.equal(nf.status, 404);
  assert.deepEqual(Object.keys(nf.data.error).sort(), ['code', 'message']);
  const method = await call('PUT', '/api/inbox');
  assert.equal(method.status, 405);
  const badJson = await worker.fetch(
    new Request(`${BASE}/api/projects`, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' }, body: '{nope' }),
    env,
  );
  assert.equal(badJson.status, 400);
  assert.equal((await badJson.json()).error.code, 'bad_json');
});
