// Capture persistence races (public/capture-core.js) with deferred and failing stores. Each case was a
// reproduced loss in the previous app.js; where useful the old ordering is replayed to show the test tells
// the two apart. Sample data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeDraftWhenReady, putCaptureOnce, queueFiles, mergeBack, sameCapture, captureTextOf, unstoredFiles, draftConsumedBy, settleWithin } from '../public/capture-core.js';
import { createMemoryStores } from '../public/idb.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

// A keyed store (outbox/attachments shape) with an optional put hook that can throw.
function keyed({ onPut } = {}) {
  const m = new Map();
  return {
    map: m,
    async get(id) { return m.has(id) ? structuredClone(m.get(id)) : undefined; },
    async put(item) {
      if (onPut) onPut(item);
      m.set(item.id, structuredClone(item));
    },
    async insert(item) {
      if (onPut) onPut(item);
      if (m.has(item.id)) return false;
      m.set(item.id, structuredClone(item));
      return true;
    },
  };
}

// A store where the first get/insert/put calls wait at a barrier until `parties` of them are waiting, then all
// are released together: two tabs that both read before either writes. insert stays atomic once released
// (like IndexedDB add() in one transaction); get-then-put is not.
function racing(parties) {
  const m = new Map();
  let waiting = [];
  let open = false; // only the first round is held; later calls (the loser's follow-up) pass straight through
  const gate = () => (open ? Promise.resolve() : new Promise((resolve) => {
    waiting.push(resolve);
    if (waiting.length >= parties) {
      open = true;
      waiting.forEach((r) => r());
    }
  }));
  return {
    map: m,
    async get(id) { await gate(); return m.has(id) ? structuredClone(m.get(id)) : undefined; },
    async put(item) { await gate(); m.set(item.id, structuredClone(item)); },
    async insert(item) {
      await gate();
      if (m.has(item.id)) return false;
      m.set(item.id, structuredClone(item));
      return true;
    },
  };
}
function draftsStore() {
  const m = new Map();
  return { map: m, drafts: { async get(k) { return m.get(k); }, async put(k, v) { m.set(k, structuredClone(v)); }, async del(k) { m.delete(k); } } };
}
const capture = (id, text, scope = 'work') => ({ id, kind: 'capture', body: { id, text, scope } });
const file = (id, name = `${id}.jpg`) => ({ id, name, mime: 'image/jpeg', data_b64: 'AAEC' });
const att = (f, captureId) => ({ id: f.id, capture_id: captureId, name: f.name, data_b64: f.data_b64 });

test('draft autosave started during a slow startup restore stores the merged box, not the earlier new-only text', async () => {
  const d = draftsStore();
  d.map.set('capture', { id: 'cap-stored-0001', text: 'Old stored draft', scope: 'work', files: [] });
  const restored = deferred();
  const box = { id: null, text: 'New typing', scope: 'work', files: [] };
  // Typing during startup: the autosave starts while the restore is still pending.
  const write = writeDraftWhenReady({
    storesReady: Promise.resolve(d),
    restored: restored.promise,
    gen: 0,
    currentGen: () => 0,
    key: 'capture',
    read: () => ({ id: box.id, text: box.text, scope: box.scope, files: box.files }),
  });
  // The restore finishes: it merges the stored draft above the new typing and adopts the stored id.
  box.text = `Old stored draft\n${box.text}`;
  box.id = 'cap-stored-0001';
  restored.resolve();
  assert.equal(await write, 'written');
  assert.deepEqual(
    { id: d.map.get('capture').id, text: d.map.get('capture').text },
    { id: 'cap-stored-0001', text: 'Old stored draft\nNew typing' },
  );

  // The previous order (read the box first, then wait) stored the earlier snapshot: the old draft was lost.
  const d2 = draftsStore();
  const box2 = { text: 'New typing' };
  const r2 = deferred();
  const old = (async () => {
    const text = box2.text;
    await r2.promise;
    await d2.drafts.put('capture', { text });
  })();
  box2.text = `Old stored draft\n${box2.text}`;
  r2.resolve();
  await old;
  assert.equal(d2.map.get('capture').text, 'New typing', 'old ordering loses the restored words');
});

test('a draft write superseded by a Save is skipped', async () => {
  const d = draftsStore();
  let gen = 0;
  const restored = deferred();
  const write = writeDraftWhenReady({ storesReady: Promise.resolve(d), restored: restored.promise, gen: 0, currentGen: () => gen, key: 'capture', read: () => ({ id: 'x', text: 'saved already', scope: 'work', files: [] }) });
  gen = 1;
  restored.resolve();
  assert.equal(await write, 'skipped');
  assert.equal(d.map.size, 0);
});

test('a failed save while new typing is in the box keeps both texts and both sets of files, under the current draft id', () => {
  const failed = { id: 'cap-failed-0001', text: 'Old capture words', files: [file('att-old-00001')] };
  const back = mergeBack({ boxText: 'New typing since', draftId: 'cap-current-01', sheetFiles: [file('att-new-00001'), file('att-old-00001')] }, failed);
  assert.equal(back.text, 'Old capture words\nNew typing since');
  assert.equal(back.draftId, 'cap-current-01', 'the failed id was never stored; the current draft keeps its id');
  assert.deepEqual(back.files.map((f) => f.id), ['att-old-00001', 'att-new-00001'], 'no file lost, none twice');
  assert.equal(back.merged, true);
  // Empty box: the capture comes back as it was, with its own id (a retry stays idempotent).
  const empty = mergeBack({ boxText: '  ', draftId: 'cap-current-01', sheetFiles: [] }, failed);
  assert.deepEqual([empty.text, empty.draftId, empty.merged], ['Old capture words', 'cap-failed-0001', false]);
});

test('outbox write rejected: nothing is stored, so the caller restores (and the earlier check finds no saved copy)', async () => {
  const outbox = keyed({ onPut: () => { throw new Error('QuotaExceededError'); } });
  await assert.rejects(putCaptureOnce(outbox, { id: 'cap-q-000001', text: 'Words', scope: 'work' }, (id) => capture(id, 'Words'), () => 'cap-q-000002'));
  assert.equal(sameCapture(await outbox.get('cap-q-000001'), 'Words', 'work'), false);
});

test('photos: file 2 fails after file 1 was stored; only file 2 goes back, and the retry binds it to the new capture', async () => {
  let fail = true;
  const store = keyed({ onPut: (item) => { if (fail && item.id === 'att-two-0001') throw new Error('QuotaExceededError'); } });
  const f1 = file('att-one-0001');
  const f2 = file('att-two-0001');
  const first = await queueFiles(store, 'cap-orig-0001', [f1, f2], (f) => att(f, 'cap-orig-0001'));
  assert.deepEqual(first.stored.map((x) => x.id), ['att-one-0001']);
  assert.deepEqual(first.failed.map((x) => x.id), ['att-two-0001'], 'only the unstored file goes back to the box');
  fail = false;
  const retry = await queueFiles(store, 'cap-retry-001', first.failed, (f) => att(f, 'cap-retry-001'));
  assert.deepEqual(retry.stored.map((x) => [x.id, x.capture_id]), [['att-two-0001', 'cap-retry-001']]);
  assert.deepEqual([...store.map.values()].map((x) => [x.id, x.capture_id]).sort(), [['att-one-0001', 'cap-orig-0001'], ['att-two-0001', 'cap-retry-001']]);

  // Even if every file came back to the box (the previous behaviour), file 1 is not re-advertised under the
  // retry: it is reported where storage really has it.
  const all = await queueFiles(store, 'cap-retry-002', [f1, f2], (f) => att(f, 'cap-retry-002'));
  assert.deepEqual(all.stored, []);
  assert.deepEqual(all.elsewhere.map((x) => [x.id, x.capture_id]), [['att-one-0001', 'cap-orig-0001'], ['att-two-0001', 'cap-retry-001']]);
  assert.equal(store.map.size, 2, 'no duplicates');
});

test('two tabs save the same restored draft with different words: both captures are kept', async () => {
  const outbox = keyed();
  const make = (text) => (id) => capture(id, text);
  const a = await putCaptureOnce(outbox, { id: 'cap-draft-0001', text: 'First tab saved words', scope: 'work' }, make('First tab saved words'), () => 'cap-fresh-0001');
  assert.equal(a.status, 'stored');
  const b = await putCaptureOnce(outbox, { id: 'cap-draft-0001', text: 'Second tab edited words', scope: 'work' }, make('Second tab edited words'), () => 'cap-fresh-0002');
  assert.equal(b.status, 'renamed');
  assert.equal(b.item.id, 'cap-fresh-0002');
  assert.equal(b.item.body.id, 'cap-fresh-0002');
  assert.deepEqual([...outbox.map.values()].map((x) => x.body.text).sort(), ['First tab saved words', 'Second tab edited words']);
  // A real retry (same words and scope) reuses the row and writes nothing new.
  const c = await putCaptureOnce(outbox, { id: 'cap-draft-0001', text: 'First tab saved words', scope: 'work' }, make('First tab saved words'), () => 'cap-fresh-0003');
  assert.equal(c.status, 'same');
  assert.equal(outbox.map.size, 2);
  // Same words, other scope is not the same capture.
  const d = await putCaptureOnce(outbox, { id: 'cap-draft-0001', text: 'First tab saved words', scope: 'personal' }, make('First tab saved words'), () => 'cap-fresh-0004');
  assert.equal(d.status, 'renamed');
});

test('a stored draft whose id was saved by another tab with different words is not discarded', () => {
  const saved = capture('cap-draft-0001', 'First tab saved words');
  assert.equal(sameCapture(saved, captureTextOf('First tab saved words\n', []), 'work'), true, 'same words: the draft is stale');
  assert.equal(sameCapture(saved, captureTextOf('Second tab edited words', []), 'work'), false, 'different words: keep the draft');
  assert.equal(captureTextOf('', [file('att-x-000001', 'site.jpg')]), 'Attached: site.jpg');
});

test('two tabs save the same restored draft id at the same moment: both reads see nothing, both texts survive', async () => {
  const outbox = racing(2);
  const make = (text) => (id) => capture(id, text);
  const [a, b] = await Promise.all([
    putCaptureOnce(outbox, { id: 'cap-draft-0009', text: 'First tab words', scope: 'work' }, make('First tab words'), () => 'cap-fresh-a001'),
    putCaptureOnce(outbox, { id: 'cap-draft-0009', text: 'Second tab words', scope: 'work' }, make('Second tab words'), () => 'cap-fresh-b001'),
  ]);
  assert.deepEqual([a.status, b.status].sort(), ['renamed', 'stored']);
  assert.notEqual(a.item.id, b.item.id);
  assert.deepEqual([...outbox.map.values()].map((x) => x.body.text).sort(), ['First tab words', 'Second tab words']);
  for (const r of [a, b]) assert.equal(outbox.map.get(r.item.id).body.text, r.item.body.text, 'each caller holds the row that is really stored');

  // The previous order (read, then write) under the same barrier: both read "absent", the second write wins.
  const old = racing(2);
  const oldPut = async (id, text) => {
    const existing = await old.get(id);
    if (!existing) await old.put(capture(id, text));
    return existing ? 'same' : 'stored';
  };
  const both = await Promise.all([oldPut('cap-draft-0009', 'First tab words'), oldPut('cap-draft-0009', 'Second tab words')]);
  assert.deepEqual(both, ['stored', 'stored']);
  assert.equal(old.map.size, 1, 'old ordering: one capture lost though both said stored');
});

test('the same capture retried from two tabs at once is stored once', async () => {
  const outbox = racing(2);
  const make = (id) => capture(id, 'Same words');
  const rs = await Promise.all([1, 2].map(() => putCaptureOnce(outbox, { id: 'cap-draft-0010', text: 'Same words', scope: 'work' }, make, () => 'cap-unused-01')));
  assert.deepEqual(rs.map((r) => r.status).sort(), ['same', 'stored']);
  assert.equal(outbox.map.size, 1);
});

test('two tabs queue the same photo id for different captures at once: it is stored once and each reports the real binding', async () => {
  const store = racing(2);
  const f = file('att-shared-001');
  const [a, b] = await Promise.all([
    queueFiles(store, 'cap-tab-a-001', [f], (x) => att(x, 'cap-tab-a-001')),
    queueFiles(store, 'cap-tab-b-001', [f], (x) => att(x, 'cap-tab-b-001')),
  ]);
  const owner = store.map.get('att-shared-001').capture_id;
  assert.equal(store.map.size, 1);
  const winner = owner === 'cap-tab-a-001' ? a : b;
  const loser = owner === 'cap-tab-a-001' ? b : a;
  assert.deepEqual(winner.stored.map((x) => x.capture_id), [owner]);
  assert.deepEqual(loser.stored, [], 'the loser does not claim the file');
  assert.deepEqual(loser.elsewhere.map((x) => [x.id, x.capture_id]), [['att-shared-001', owner]], 'the loser reports where it really is');

  // Previous order under the same barrier: both report the file as theirs, only the last write is stored.
  const old = racing(2);
  const oldQueue = async (cap) => {
    if (!(await old.get(f.id))) await old.put(att(f, cap));
    return cap;
  };
  const claimed = await Promise.all([oldQueue('cap-tab-a-001'), oldQueue('cap-tab-b-001')]);
  assert.equal(claimed.length, 2);
  assert.equal(old.map.size, 1, 'old ordering: both claimed it, one binding is false');
});

test('after a Save, only the draft that Save consumed is removed: never another tab\'s words under the same id', async () => {
  const saved = { id: 'cap-draft-0020', text: 'A words', scope: 'work' };
  const own = { id: 'cap-draft-0020', text: 'A wor', scope: 'work', files: [], updated_at: '2026-11-01T01:00:00.000Z' };
  assert.equal(draftConsumedBy(own, saved, { updated_at: own.updated_at, text: own.text }), true, "this tab's own draft, a few keystrokes behind");
  assert.equal(draftConsumedBy({ ...own, text: 'A words' }, saved, null), true, 'the saved words');
  const otherTab = { id: 'cap-draft-0020', text: 'B words', scope: 'work', files: [], updated_at: '2026-11-01T00:59:00.000Z' };
  assert.equal(draftConsumedBy(otherTab, saved, { updated_at: own.updated_at, text: own.text }), false, 'another tab wrote different words earlier');
  assert.equal(draftConsumedBy(otherTab, saved, null), false);
  assert.equal(draftConsumedBy({ ...own, id: 'cap-draft-other' }, saved, { updated_at: own.updated_at, text: own.text }), false, 'a newer draft under a new id');

  // delIf is one step in the store: the predicate sees what is stored at that moment.
  const st = createMemoryStores();
  await st.drafts.put('capture', otherTab);
  assert.equal(await st.drafts.delIf('capture', (d) => draftConsumedBy(d, saved, { updated_at: own.updated_at, text: own.text })), false);
  assert.equal((await st.drafts.get('capture')).text, 'B words');
  await st.drafts.put('capture', own);
  assert.equal(await st.drafts.delIf('capture', (d) => draftConsumedBy(d, saved, { updated_at: own.updated_at, text: own.text })), true);
  assert.equal(await st.drafts.get('capture'), undefined);
});

test('a saved draft whose second photo never reached storage is not discarded: that photo is found missing', async () => {
  const store = keyed();
  const f1 = file('att-kept-0001');
  const f2 = file('att-lost-0001');
  await store.insert(att(f1, 'cap-x-000001'));
  assert.deepEqual((await unstoredFiles(store, [f1, f2])).map((f) => f.id), ['att-lost-0001']);
  assert.deepEqual(await unstoredFiles(store, [f1]), []);
});

test('storage that never answers becomes a visible failure, and a draft write reports what it wrote', async () => {
  await assert.rejects(settleWithin(new Promise(() => {}), 20), /storage_timeout/);
  assert.equal(await settleWithin(Promise.resolve(7), 20), 7);
  const d = draftsStore();
  let seen = null;
  await writeDraftWhenReady({ storesReady: Promise.resolve(d), restored: Promise.resolve(), gen: 0, currentGen: () => 0, key: 'capture', read: () => ({ id: 'cap-w-000001', text: 'Hi', scope: 'work', files: [] }), onWritten: (r) => (seen = r) });
  assert.equal(seen.text, 'Hi');
  assert.equal(d.map.get('capture').updated_at, seen.updated_at);
});
