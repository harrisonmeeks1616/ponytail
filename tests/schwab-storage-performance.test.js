// Complete native-shaped Storage fixture; assertions count backing operations, not machine speed.
const test = require('node:test');
const assert = require('node:assert/strict');
const restore = import('../docs/schwab/restore-store.mjs');
function memory(entries = []) {
  const values = new Map(entries), calls = { get: 0, key: 0 };
  let keys = [...values.keys()];
  const refresh = () => { keys = [...values.keys()]; };
  return { values, calls, reset() { calls.get = 0; calls.key = 0; },
    get length() { return values.size; }, key(i) { calls.key++; return keys[i] ?? null; },
    getItem(k) { calls.get++; return values.get(String(k)) ?? null; },
    setItem(k, v) { values.set(String(k), String(v)); refresh(); },
    removeItem(k) { values.delete(String(k)); refresh(); }, clear() { values.clear(); refresh(); } };
}
const notes = n => Array.from({ length: n }, (_, i) => ['schwab.note/' + i, JSON.stringify({ uid: String(i), body: 'Synthetic' })]);

test('normal scoped reads do not scan every stored record', async () => {
  const { createRestoreStorage } = await restore;
  const raw = memory([['schwab.settings', '{"project":"Synthetic"}'], ...notes(1000)]);
  const view = createRestoreStorage(raw, 'schwab.');
  view.status(); raw.reset();
  assert.equal(view.getItem('schwab.settings'), '{"project":"Synthetic"}');
  assert.ok(raw.calls.get <= 2, `one key read used ${raw.calls.get} backing value reads`);
  assert.equal(raw.calls.key, 0);
});

test('the real shared note enumeration and reads use linear backing operations', async () => {
  const raw = memory([['schwab.settings', '{}'], ...notes(1000)]);
  globalThis.localStorage = raw;
  try {
    const { keysWith, load } = await import('../docs/schwab/shared.mjs');
    raw.reset();
    const found = keysWith('schwab.note/');
    assert.equal(found.length, 1000);
    for (const key of found) assert.ok(load(key, null)?.body);
    assert.ok(raw.calls.get <= 2100, `note read used ${raw.calls.get} backing value reads`);
    assert.ok(raw.calls.key <= 2100, `note enumeration used ${raw.calls.key} backing key reads`);
  } finally { delete globalThis.localStorage; }
});

test('one-shot key enumeration retains restore visibility, other jobs, overlays and originals', async () => {
  const { createRestoreStorage } = await restore;
  const raw = memory([['schwab.settings', '{"project":"Original"}'], ['fieldHub.job.other.settings', '{}'], ...notes(2)]);
  const original = [...raw.values];
  const view = createRestoreStorage(raw, 'schwab.');
  assert.equal(view.stage(new Map([['schwab.settings', '{"project":"Restored"}'], ['schwab.note/0', null], ['schwab.note/new', '{}']])), true);
  view.setItem('schwab.note/overlay', '{}');
  assert.deepEqual(view.keys(), ['fieldHub.job.other.settings', 'schwab.note/1', 'schwab.note/new', 'schwab.note/overlay', 'schwab.settings']);
  assert.deepEqual(Array.from({ length: view.length }, (_, i) => view.key(i)), view.keys());
  assert.equal(view.getItem('schwab.settings'), '{"project":"Restored"}');
  assert.equal(raw.getItem('schwab.settings'), '{"project":"Original"}');
  assert.equal(view.returnToParent(), true);
  assert.deepEqual(view.keys(), original.map(([k]) => k).sort(), 'retained generation metadata stays out of ordinary storage keys');
  for (const [key, value] of original) assert.equal(raw.getItem(key), value);
});
