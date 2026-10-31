// T1b: 410 from a capture POST is terminal, and the attachment upload queue (idempotent by id, waits
// for its capture, drops on a deleted capture, keeps bytes after a refusal, keeps scope).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSyncEngine,
  createMemoryStore,
  createOutboxItem,
  createAttachmentItem,
  syncAttachments,
  isTerminal,
  isPending,
  MAX_ATTACHMENT_BYTES,
} from '../public/outbox-core.js';
import { createMemoryStores } from '../public/idb.js';

const T0 = Date.parse('2026-10-31T15:00:00.000Z');
const CANARY = 'PERSONAL-CANARY-7731 pharmacy pickup';
const B64 = Buffer.from('synthetic image bytes').toString('base64');

function json(status, obj = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

function fakeFetch(script) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    return step(calls.length);
  };
  fn.calls = calls;
  return fn;
}

function capture(id, { scope = 'personal', text = CANARY, state } = {}) {
  const it = createOutboxItem({ id, kind: 'capture', url: '/api/captures', body: { id, text, scope }, nowMs: T0 });
  if (state) it.state = state;
  return it;
}

function attachment(id, captureId, scope = 'personal') {
  return createAttachmentItem({ id, capture_id: captureId, scope, name: 'site photo.jpg', mime: 'image/jpeg', data_b64: B64, nowMs: T0 });
}

test('410 on a capture POST: terminal "deleted", never resent, words removed from the phone', async () => {
  const store = createMemoryStore([capture('cap_deleted01')]);
  const fetchImpl = fakeFetch([() => json(410, { error: { code: 'capture_deleted' } })]);
  const engine = createSyncEngine({ store, fetchImpl, now: () => T0 });
  const s1 = await engine.syncOnce();
  assert.equal(s1.deleted, 1);
  const it = await store.get('cap_deleted01');
  assert.equal(it.state, 'deleted');
  assert.ok(isTerminal('deleted') && !isPending(it));
  assert.equal(it.last_error, 'http_410');
  assert.ok(!JSON.stringify(it).includes('CANARY'), 'deleted capture text left on the phone');
  assert.deepEqual(it.body, { id: 'cap_deleted01', scope: 'personal' });
  await engine.syncOnce({ ignoreBackoff: true });
  assert.equal(fetchImpl.calls.length, 1, 'a deleted capture was sent again');
});

test('other 4xx stay "rejected" with the text kept (not treated as deleted)', async () => {
  const store = createMemoryStore([capture('cap_reject01')]);
  const engine = createSyncEngine({ store, fetchImpl: fakeFetch([() => json(400)]), now: () => T0 });
  await engine.syncOnce();
  const it = await store.get('cap_reject01');
  assert.equal(it.state, 'rejected');
  assert.equal(it.body.text, CANARY);
});

test('attachment waits for its capture, then uploads once with its capture scope and id', async () => {
  const outbox = createMemoryStore([capture('cap_waits001', { scope: 'personal' })]);
  const store = createMemoryStore([attachment('att_waits001', 'cap_waits001', 'personal')]);
  const fetchImpl = fakeFetch([() => json(201, { attachment: { id: 'att_waits001' } })]);
  const s1 = await syncAttachments({ store, outbox, fetchImpl, now: () => T0 });
  assert.equal(s1.waiting, 1);
  assert.equal(fetchImpl.calls.length, 0, 'uploaded before the capture synced');
  assert.equal((await store.get('att_waits001')).state, 'waiting');

  await outbox.put({ ...(await outbox.get('cap_waits001')), state: 'synced' });
  const s2 = await syncAttachments({ store, outbox, fetchImpl, now: () => T0 });
  assert.equal(s2.uploaded, 1);
  const call = fetchImpl.calls[0];
  assert.equal(call.url, '/api/attachments');
  assert.deepEqual(Object.keys(call.body).sort(), ['capture_id', 'data_b64', 'id', 'mime', 'name', 'scope']);
  assert.equal(call.body.scope, 'personal');
  assert.equal(call.body.capture_id, 'cap_waits001');
  assert.equal(call.headers['X-Requested-With'], 'XMLHttpRequest');
  const done = await store.get('att_waits001');
  assert.equal(done.state, 'uploaded');
  assert.equal(done.data_b64, undefined, 'bytes kept after upload');

  await syncAttachments({ store, outbox, fetchImpl, now: () => T0 });
  assert.equal(fetchImpl.calls.length, 1, 'an uploaded attachment was sent again');
});

test('a capture pruned from the outbox counts as synced; retries resend the same id and bytes', async () => {
  const outbox = createMemoryStore([]);
  const store = createMemoryStore([attachment('att_retry001', 'cap_pruned01', 'work')]);
  let t = T0;
  const fetchImpl = fakeFetch([
    () => { throw new TypeError('Failed to fetch'); },
    () => json(503),
    () => json(200, { duplicate: true }),
  ]);
  const s1 = await syncAttachments({ store, outbox, fetchImpl, now: () => t, rand: () => 0.5 });
  assert.equal(s1.stopped, 'offline');
  let it = await store.get('att_retry001');
  assert.equal(it.state, 'retry_wait');
  assert.equal(it.data_b64, B64, 'bytes lost while offline');

  const s2 = await syncAttachments({ store, outbox, fetchImpl, now: () => t });
  assert.equal(s2.attempted, 0, 'retried before its backoff');
  t += 3000;
  await syncAttachments({ store, outbox, fetchImpl, now: () => t, rand: () => 0.5 });
  assert.equal((await store.get('att_retry001')).last_error, 'http_503');
  await syncAttachments({ store, outbox, fetchImpl, now: () => t, ignoreBackoff: true });
  it = await store.get('att_retry001');
  assert.equal(it.state, 'uploaded');
  assert.equal(fetchImpl.calls.length, 3);
  assert.ok(fetchImpl.calls.every((c) => c.body.id === 'att_retry001' && c.body.data_b64 === B64 && c.body.scope === 'work'));
});

test('capture deleted: attachment dropped (from the outbox state, or a 404/410 answer) and bytes removed', async () => {
  const outbox = createMemoryStore([capture('cap_gone0001', { state: 'deleted' }), capture('cap_gone0002', { state: 'synced' }), capture('cap_gone0003', { state: 'synced' })]);
  const store = createMemoryStore([attachment('att_gone0001', 'cap_gone0001'), attachment('att_gone0002', 'cap_gone0002'), attachment('att_gone0003', 'cap_gone0003')]);
  const changes = [];
  const fetchImpl = fakeFetch([() => json(410, { error: { code: 'capture_deleted' } }), () => json(404)]);
  const s = await syncAttachments({ store, outbox, fetchImpl, now: () => T0, onChange: (i) => changes.push(i.state) });
  assert.equal(s.dropped, 3);
  assert.equal(fetchImpl.calls.length, 2, 'an attachment of a locally known deleted capture was sent');
  for (const id of ['att_gone0001', 'att_gone0002', 'att_gone0003']) {
    const it = await store.get(id);
    assert.equal(it.state, 'dropped');
    assert.equal(it.last_error, 'capture_deleted');
    assert.equal(it.data_b64, undefined);
  }
  assert.ok(changes.includes('dropped'));
});

test('sign-in lost stops the run; 409 is a conflict; a refused capture holds its photos with their bytes', async () => {
  const outbox = createMemoryStore([capture('cap_auth0001', { state: 'synced' }), capture('cap_refu0001', { state: 'rejected' })]);
  const store = createMemoryStore([attachment('att_auth0001', 'cap_auth0001'), attachment('att_refu0001', 'cap_refu0001')]);
  const auth = await syncAttachments({ store, outbox, fetchImpl: fakeFetch([() => json(401)]), now: () => T0 });
  assert.equal(auth.stopped, 'auth_required');
  assert.equal((await store.get('att_auth0001')).state, 'auth_required');
  assert.equal((await store.get('att_refu0001')).state, 'waiting', 'the run went on after sign-in was lost');

  await syncAttachments({ store, outbox, fetchImpl: fakeFetch([() => json(409)]), now: () => T0 });
  const c = await store.get('att_auth0001');
  assert.equal(c.state, 'conflict');
  assert.equal(c.data_b64, B64);
  const r = await store.get('att_refu0001');
  assert.equal(r.state, 'rejected');
  assert.equal(r.last_error, 'capture_not_saved');
  assert.equal(r.data_b64, B64);
});

test('createAttachmentItem: allowed types only, 1 MB cap, safe names, one scope', () => {
  const big = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64');
  assert.throws(() => createAttachmentItem({ id: 'att_big00001', capture_id: 'cap_big00001', scope: 'work', name: 'x.jpg', mime: 'image/jpeg', data_b64: big }), /too_large/);
  assert.throws(() => createAttachmentItem({ id: 'att_html0001', capture_id: 'cap_html0001', scope: 'work', name: 'x.html', mime: 'text/html', data_b64: B64 }), /bad_mime/);
  assert.throws(() => createAttachmentItem({ id: 'att_all00001', capture_id: 'cap_all00001', scope: 'all', name: 'x.jpg', mime: 'image/jpeg', data_b64: B64 }), /bad_scope/);
  const ok = createAttachmentItem({ id: 'att_name0001', capture_id: 'cap_name0001', scope: 'work', name: '../../etc/\u0007passwd.txt', mime: 'text/plain', data_b64: B64 });
  assert.equal(ok.name, 'passwd.txt');
  assert.equal(ok.size, Buffer.from(B64, 'base64').length);
});

test('memory fallback stores include an attachments store with the engine interface', async () => {
  const stores = createMemoryStores();
  const a = attachment('att_mem00001', 'cap_mem00001');
  await stores.attachments.put(a);
  assert.equal((await stores.attachments.list()).length, 1);
  assert.equal((await stores.attachments.get('att_mem00001')).id, 'att_mem00001');
  await stores.attachments.remove('att_mem00001');
  assert.equal(await stores.attachments.get('att_mem00001'), undefined);
});
