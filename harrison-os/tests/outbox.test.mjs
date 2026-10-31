import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyResponse,
  backoffMs,
  createSyncEngine,
  createMemoryStore,
  newClientId,
  createOutboxItem,
  SYNCED_CAP,
} from '../public/outbox-core.js';
import { openStores } from '../public/idb.js';

const ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const T0 = Date.parse('2026-10-29T12:00:00.000Z');

function clock(start = T0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
    set: (v) => { t = v; },
  };
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function html(status = 200) {
  return new Response('<!doctype html><title>Sign in</title>', {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function opaqueRedirect() {
  return { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers(), bodyUsed: false, body: null };
}

// script: array of (call) => Response | Promise<Response> | throws; last entry repeats.
function fakeFetch(script) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    return step(calls.length);
  };
  fn.calls = calls;
  return fn;
}

function item(id, nowMs = T0, extra = {}) {
  return {
    ...createOutboxItem({
      id,
      kind: 'capture',
      url: '/api/captures',
      body: { id, text: 'sample text', scope: 'personal', client_created_at: new Date(nowMs).toISOString() },
      nowMs,
    }),
    ...extra,
  };
}

function engineFor(store, fetchImpl, c, opts = {}) {
  return createSyncEngine({ store, fetchImpl, now: c.now, rand: () => 0.5, ...opts });
}

// ---------------------------------------------------------------------------

test('classifyResponse covers the contract table', () => {
  const J = 'application/json';
  assert.equal(classifyResponse({ type: 'basic', status: 201, contentType: J }), 'synced');
  assert.equal(classifyResponse({ type: 'basic', status: 200, contentType: J }), 'synced');
  assert.equal(classifyResponse({ type: 'opaqueredirect', status: 0, contentType: null }), 'auth_required');
  assert.equal(classifyResponse({ type: 'basic', status: 302, contentType: null }), 'auth_required');
  assert.equal(classifyResponse({ type: 'basic', status: 401, contentType: J }), 'auth_required');
  assert.equal(classifyResponse({ type: 'basic', status: 403, contentType: 'text/html' }), 'auth_required');
  assert.equal(classifyResponse({ type: 'basic', status: 200, contentType: 'text/html; charset=utf-8' }), 'auth_required');
  assert.equal(classifyResponse({ type: 'error', status: 0 }), 'retry');
  assert.equal(classifyResponse({ type: 'basic', status: 408, contentType: J }), 'retry');
  assert.equal(classifyResponse({ type: 'basic', status: 429, contentType: J }), 'retry');
  assert.equal(classifyResponse({ type: 'basic', status: 500, contentType: J }), 'retry');
  assert.equal(classifyResponse({ type: 'basic', status: 503, contentType: 'text/html' }), 'retry');
  assert.equal(classifyResponse({ type: 'basic', status: 409, contentType: J }), 'conflict');
  assert.equal(classifyResponse({ type: 'basic', status: 400, contentType: J }), 'rejected');
  assert.equal(classifyResponse({ type: 'basic', status: 422, contentType: J }), 'rejected');
  assert.equal(classifyResponse({ type: 'basic', status: 404, contentType: J }), 'rejected');
});

test('backoffMs: 2 s * 2^n, capped at 60 s, +/- 20% jitter', () => {
  const mid = () => 0.5;
  assert.equal(backoffMs(0, mid), 2000);
  assert.equal(backoffMs(1, mid), 4000);
  assert.equal(backoffMs(2, mid), 8000);
  assert.equal(backoffMs(4, mid), 32000);
  assert.equal(backoffMs(5, mid), 60000);
  assert.equal(backoffMs(50, mid), 60000);
  assert.equal(backoffMs(0, () => 0), 1600);
  assert.equal(backoffMs(0, () => 1), 2400);
  assert.equal(backoffMs(9, () => 0), 48000);
  assert.equal(backoffMs(9, () => 1), 72000);
  for (let i = 0; i < 200; i++) {
    const v = backoffMs(3);
    assert.ok(v >= 12800 && v <= 19200, `jittered value ${v} in range`);
  }
});

test('newClientId: prefixed by kind, matches the id pattern, unique', () => {
  const a = newClientId('capture');
  const b = newClientId('reminder');
  assert.match(a, ID_RE);
  assert.match(b, ID_RE);
  assert.ok(a.startsWith('cap_'));
  assert.ok(b.startsWith('rem_'));
  assert.match(newClientId('weird kind!'), ID_RE);
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(newClientId('capture'));
  assert.equal(seen.size, 500);
});

test('every request: POST, X-Requested-With, redirect manual, credentials same-origin', async () => {
  const c = clock();
  const store = createMemoryStore([item('cap_req_00000001')]);
  const f = fakeFetch([() => json(201, { id: 'cap_req_00000001', duplicate: false })]);
  const engine = engineFor(store, f, c, { headers: { 'X-Requested-With': 'nope', 'X-Extra': '1' } });
  await engine.syncOnce();
  assert.equal(f.calls.length, 1);
  const { url, init, body } = f.calls[0];
  assert.equal(url, '/api/captures');
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'manual');
  assert.equal(init.credentials, 'same-origin');
  assert.equal(init.headers['X-Requested-With'], 'XMLHttpRequest');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.headers['X-Extra'], '1');
  assert.equal(body.id, 'cap_req_00000001');
});

test('offline: fetch throws TypeError -> retry_wait with backoff, item kept, later succeeds', async () => {
  const c = clock();
  const store = createMemoryStore([item('cap_off_00000001', T0), item('cap_off_00000002', T0 + 1)]);
  let online = false;
  const f = fakeFetch([() => {
    if (!online) throw new TypeError('Failed to fetch');
    return json(201, { duplicate: false });
  }]);
  const engine = engineFor(store, f, c);

  const r1 = await engine.syncOnce();
  assert.equal(r1.stopped, 'offline');
  assert.equal(f.calls.length, 1, 'stops after the first network error');
  const a = await store.get('cap_off_00000001');
  assert.equal(a.state, 'retry_wait');
  assert.equal(a.attempts, 1);
  assert.equal(a.last_error, 'network');
  assert.equal(a.next_attempt_at, T0 + 2000);
  const b = await store.get('cap_off_00000002');
  assert.equal(b.state, 'saved_on_device', 'untried item stays saved on device');
  assert.equal(await engine.pendingCount(), 2);

  // Second failure doubles the wait.
  c.advance(2000);
  await engine.syncOnce();
  const a2 = await store.get('cap_off_00000001');
  assert.equal(a2.attempts, 2);
  assert.equal(a2.next_attempt_at, T0 + 2000 + 4000);

  // Back online but not yet due: only the never-tried item goes.
  online = true;
  const before = f.calls.length;
  const r3 = await engine.syncOnce();
  assert.equal(f.calls.length - before, 1);
  assert.equal(f.calls.at(-1).body.id, 'cap_off_00000002');
  assert.equal(r3.skipped_not_due, 1);
  assert.equal((await store.get('cap_off_00000001')).state, 'retry_wait');

  c.advance(4000);
  await engine.syncOnce();
  assert.equal((await store.get('cap_off_00000001')).state, 'synced');
  assert.equal(await engine.pendingCount(), 0);
});

test('201 -> synced with synced_at; 200 duplicate -> synced', async () => {
  const c = clock();
  const store = createMemoryStore([item('cap_new_00000001', T0), item('cap_dup_00000001', T0 + 1)]);
  const f = fakeFetch([
    () => json(201, { id: 'cap_new_00000001', duplicate: false, received_at: 'x' }),
    () => json(200, { id: 'cap_dup_00000001', duplicate: true, received_at: 'x' }),
  ]);
  const engine = engineFor(store, f, c);
  const r = await engine.syncOnce();
  assert.equal(r.synced, 2);
  for (const id of ['cap_new_00000001', 'cap_dup_00000001']) {
    const it = await store.get(id);
    assert.equal(it.state, 'synced');
    assert.equal(it.synced_at, new Date(T0).toISOString());
    assert.equal(it.last_error, null);
  }
});

test('commit_then_503, then 200 duplicate on retry -> synced once, same id both times', async () => {
  const c = clock();
  const store = createMemoryStore([item('cap_lost_0000001')]);
  const f = fakeFetch([
    () => json(503, { error: { code: 'chaos', message: 'committed then 503' } }),
    () => json(200, { id: 'cap_lost_0000001', duplicate: true }),
  ]);
  const changes = [];
  const engine = engineFor(store, f, c, { onChange: (it) => changes.push(it.state) });

  await engine.syncOnce();
  let it = await store.get('cap_lost_0000001');
  assert.equal(it.state, 'retry_wait');
  assert.equal(it.last_error, 'http_503');
  assert.equal(it.next_attempt_at, T0 + 2000);

  c.advance(2000);
  await engine.syncOnce();
  it = await store.get('cap_lost_0000001');
  assert.equal(it.state, 'synced');

  // Further syncs never resend a synced item.
  c.advance(120000);
  await engine.syncOnce();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].body.id, 'cap_lost_0000001');
  assert.equal(f.calls[1].body.id, 'cap_lost_0000001');
  assert.deepEqual(f.calls[0].body, f.calls[1].body);
  assert.equal(changes.filter((s) => s === 'synced').length, 1);
  assert.deepEqual(changes, ['sending', 'retry_wait', 'sending', 'synced']);
});

test('opaqueredirect -> auth_required, items kept, run paused, next sync after auth succeeds', async () => {
  const c = clock();
  const store = createMemoryStore([item('cap_auth_0000001', T0), item('cap_auth_0000002', T0 + 1)]);
  let signedIn = false;
  const f = fakeFetch([() => (signedIn ? json(201, { duplicate: false }) : opaqueRedirect())]);
  const engine = engineFor(store, f, c);

  const r1 = await engine.syncOnce();
  assert.equal(r1.stopped, 'auth_required');
  assert.equal(f.calls.length, 1, 'run pauses on auth');
  const a = await store.get('cap_auth_0000001');
  assert.equal(a.state, 'auth_required');
  assert.equal(a.last_error, 'auth_opaqueredirect');
  assert.equal(a.next_attempt_at, null);
  assert.equal((await store.get('cap_auth_0000002')).state, 'saved_on_device');
  assert.equal(await engine.pendingCount(), 2, 'auth never makes an item terminal');

  // Still signed out: still kept, still not terminal.
  await engine.syncOnce();
  assert.equal((await store.get('cap_auth_0000001')).state, 'auth_required');

  signedIn = true;
  const r3 = await engine.syncOnce();
  assert.equal(r3.stopped, null);
  assert.equal((await store.get('cap_auth_0000001')).state, 'synced');
  assert.equal((await store.get('cap_auth_0000002')).state, 'synced');
  assert.equal(await engine.pendingCount(), 0);
});

test('401 and HTML 200 -> auth_required', async () => {
  for (const [resp, code] of [[() => json(401, { error: { code: 'expired' } }), 'auth_401'], [() => html(200), 'auth_html']]) {
    const c = clock();
    const store = createMemoryStore([item('cap_401_00000001')]);
    const f = fakeFetch([resp]);
    const engine = engineFor(store, f, c);
    const r = await engine.syncOnce();
    assert.equal(r.auth_required, 1);
    const it = await store.get('cap_401_00000001');
    assert.equal(it.state, 'auth_required');
    assert.equal(it.last_error, code);
    assert.equal(it.attempts, 0, 'auth does not burn backoff attempts');
  }
});

test('409 -> conflict, 400 -> rejected; terminal, never resent', async () => {
  const c = clock();
  const store = createMemoryStore([item('cap_409_00000001', T0), item('cap_400_00000001', T0 + 1)]);
  const f = fakeFetch([
    () => json(409, { error: { code: 'id_conflict' } }),
    () => json(400, { error: { code: 'bad_request' } }),
  ]);
  const engine = engineFor(store, f, c);
  await engine.syncOnce();
  assert.equal((await store.get('cap_409_00000001')).state, 'conflict');
  assert.equal((await store.get('cap_409_00000001')).last_error, 'http_409');
  assert.equal((await store.get('cap_400_00000001')).state, 'rejected');
  assert.equal((await store.get('cap_400_00000001')).last_error, 'http_400');
  c.advance(600000);
  await engine.syncOnce();
  assert.equal(f.calls.length, 2);
  assert.equal(await engine.pendingCount(), 0);
});

test('concurrent syncOnce calls share one in-flight run (fetch once per item)', async () => {
  const c = clock();
  const ids = ['cap_cc_000000001', 'cap_cc_000000002', 'cap_cc_000000003'];
  const store = createMemoryStore(ids.map((id, i) => item(id, T0 + i)));
  const f = fakeFetch([async () => {
    await new Promise((r) => setTimeout(r, 5));
    return json(201, { duplicate: false });
  }]);
  const engine = engineFor(store, f, c);
  const p1 = engine.syncOnce();
  const p2 = engine.syncOnce();
  const p3 = engine.syncOnce();
  assert.equal(p1, p2);
  assert.equal(p2, p3);
  const [r1, r2] = await Promise.all([p1, p2, p3]);
  assert.equal(r1, r2);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls.map((x) => x.body.id).sort(), ids);
  // A fresh call after the run starts a new run.
  const p4 = engine.syncOnce();
  assert.notEqual(p4, p1);
  await p4;
  assert.equal(f.calls.length, 3);
});

test('items not yet due are skipped', async () => {
  const c = clock();
  const store = createMemoryStore([
    item('cap_due_00000001', T0, { state: 'retry_wait', attempts: 1, next_attempt_at: T0 + 5000 }),
    item('cap_due_00000002', T0 + 1, { state: 'retry_wait', attempts: 1, next_attempt_at: T0 }),
  ]);
  const f = fakeFetch([() => json(201, {})]);
  const engine = engineFor(store, f, c);
  const r = await engine.syncOnce();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.id, 'cap_due_00000002');
  assert.equal(r.skipped_not_due, 1);
  assert.equal((await store.get('cap_due_00000001')).state, 'retry_wait');
  c.advance(5000);
  await engine.syncOnce();
  assert.equal((await store.get('cap_due_00000001')).state, 'synced');
});

test('syncOnce({ ignoreBackoff: true }) sends retry_wait items before their backoff ends (back online)', async () => {
  const c = clock();
  const store = createMemoryStore([
    item('cap_bko_00000001', T0, { state: 'retry_wait', attempts: 5, next_attempt_at: T0 + 60000, last_error: 'network' }),
    item('cap_bko_00000002', T0 + 1, { state: 'conflict', last_error: 'http_409' }),
  ]);
  const f = fakeFetch([() => json(201, {})]);
  const engine = engineFor(store, f, c);
  const r = await engine.syncOnce({ ignoreBackoff: true });
  assert.equal(f.calls.length, 1, 'terminal items are still never resent');
  assert.equal(f.calls[0].body.id, 'cap_bko_00000001');
  assert.equal(r.synced, 1);
  assert.equal((await store.get('cap_bko_00000001')).state, 'synced');
});

test('synced items are retained and capped at 200 (newest kept)', async () => {
  const c = clock();
  const seed = [];
  for (let i = 0; i < 205; i++) {
    const id = `cap_old_${String(i).padStart(8, '0')}`;
    seed.push(item(id, T0 - 1e6 + i, { state: 'synced', synced_at: new Date(T0 - 1e6 + i).toISOString() }));
  }
  seed.push(item('cap_fresh_000001', T0));
  const store = createMemoryStore(seed);
  const f = fakeFetch([() => json(201, {})]);
  const engine = engineFor(store, f, c);
  await engine.syncOnce();
  assert.equal(f.calls.length, 1, 'already-synced items are not resent');
  const all = await store.list();
  const synced = all.filter((x) => x.state === 'synced');
  assert.equal(SYNCED_CAP, 200);
  assert.equal(synced.length, 200);
  assert.ok(all.some((x) => x.id === 'cap_fresh_000001'));
  for (let i = 0; i <= 5; i++) {
    assert.ok(!all.some((x) => x.id === `cap_old_${String(i).padStart(8, '0')}`), `oldest ${i} pruned`);
  }
  assert.ok(all.some((x) => x.id === 'cap_old_00000006'));
});

test('stale "sending" item from a closed page is resent; items enqueued mid-run are picked up', async () => {
  const c = clock();
  const store = createMemoryStore([item('cap_stale_000001', T0, { state: 'sending' })]);
  let enqueued = false;
  const f = fakeFetch([async () => {
    if (!enqueued) {
      enqueued = true;
      await store.put(item('cap_mid_00000001', T0 + 5));
    }
    return json(201, {});
  }]);
  const engine = engineFor(store, f, c);
  const r = await engine.syncOnce();
  assert.equal(r.synced, 2);
  assert.deepEqual(f.calls.map((x) => x.body.id), ['cap_stale_000001', 'cap_mid_00000001']);
});

test('a hung fetch times out into retry_wait instead of blocking the single flight', async () => {
  const c = clock();
  const store = createMemoryStore([item('cap_hang_0000001')]);
  let aborted = false;
  const f = (url, init) => new Promise(() => {
    init.signal.addEventListener('abort', () => { aborted = true; });
  });
  const engine = createSyncEngine({ store, fetchImpl: f, now: c.now, rand: () => 0.5, timeoutMs: 20 });
  const r = await engine.syncOnce();
  assert.equal(r.stopped, 'offline');
  assert.ok(aborted);
  const it = await store.get('cap_hang_0000001');
  assert.equal(it.state, 'retry_wait');
  assert.equal(it.last_error, 'timeout');
});

test('stored items never hold server response text; onChange errors do not break sync', async () => {
  const c = clock();
  const store = createMemoryStore([item('cap_txt_00000001', T0), item('cap_txt_00000002', T0 + 1)]);
  const f = fakeFetch([
    () => json(400, { error: { code: 'bad', message: 'SERVER-SECRET-TEXT' } }),
    () => html(200),
  ]);
  const engine = engineFor(store, f, c, { onChange: () => { throw new Error('ui broke'); } });
  await engine.syncOnce();
  const dump = JSON.stringify(await store.list());
  assert.ok(!dump.includes('SERVER-SECRET-TEXT'));
  assert.ok(!dump.includes('Sign in'));
  assert.equal((await store.get('cap_txt_00000001')).state, 'rejected');
  assert.equal((await store.get('cap_txt_00000002')).state, 'auth_required');
});

test('createOutboxItem validates and fills body.id', () => {
  const it = createOutboxItem({ id: 'rem_abcdefgh', kind: 'reminder', url: '/api/reminders', body: { text: 'x' }, nowMs: T0 });
  assert.equal(it.body.id, 'rem_abcdefgh');
  assert.equal(it.state, 'saved_on_device');
  assert.equal(it.attempts, 0);
  assert.throws(() => createOutboxItem({ id: 'short', kind: 'capture', url: '/api/captures', body: {} }), RangeError);
  assert.throws(() => createOutboxItem({ id: 'cap_abcdefgh', kind: 'capture', url: '/api/captures', body: { id: 'cap_other123' } }), RangeError);
});

test('idb.openStores falls back to memory with a warning when IndexedDB is unavailable', async () => {
  const s = await openStores({ indexedDB: undefined });
  assert.equal(s.persistent, false);
  assert.equal(typeof s.warning, 'string');
  assert.ok(s.warning.length > 0);

  await s.drafts.put('capture', { text: 'draft', scope: 'work' });
  assert.deepEqual(await s.drafts.get('capture'), { text: 'draft', scope: 'work' });
  await s.drafts.del('capture');
  assert.equal(await s.drafts.get('capture'), undefined);

  await s.log.add({ kind: 'sync', ref: 'cap_1' });
  await s.log.add({ kind: 'sync', ref: 'cap_2' });
  const logs = await s.log.list(1);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].ref, 'cap_2');
  assert.equal((await s.log.list(10)).length, 2);

  // The memory outbox satisfies the engine store interface.
  const c = clock();
  await s.outbox.put(item('cap_mem_00000001'));
  const engine = engineFor(s.outbox, fakeFetch([() => json(201, {})]), c);
  await engine.syncOnce();
  assert.equal((await s.outbox.get('cap_mem_00000001')).state, 'synced');
});

test('idb.openStores falls back with a warning when open() throws', async () => {
  const broken = { open() { const e = new Error('nope'); e.name = 'SecurityError'; throw e; } };
  const s = await openStores({ indexedDB: broken });
  assert.equal(s.persistent, false);
  assert.match(s.warning, /SecurityError/);
});
