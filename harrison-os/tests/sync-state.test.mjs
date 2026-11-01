// Real application writes and SQL transaction semantics, fictional data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/d1.mjs';
import { contentMutation, withSyncState } from '../src/sync-state.js';
import { createWorker } from '../src/api.js';

test('content classifier recognizes every current write form and ignores operational bookkeeping', () => {
  for (const sql of ['INSERT INTO captures VALUES (?)', 'insert or ignore into pm_records VALUES (?)',
    '/* lease */ UPDATE "pm_sources" SET state=?', '-- snapshot\nREPLACE INTO calendar_events VALUES (?)',
    'DELETE FROM [items] WHERE id=?']) assert.equal(contentMutation(sql), true, sql);
  for (const sql of ['SELECT * FROM items', 'UPDATE events SET detail=?', 'UPDATE sync_state SET version=?']) assert.equal(contentMutation(sql), false, sql);
});

test('single mutations advance the version atomically, preserving RETURNING, changes and no-op behavior', async () => {
  const raw = createTestDb(), DB = withSyncState(raw);
  try {
    assert.equal(withSyncState(DB), DB);
    const version = () => DB.prepare('SELECT version FROM sync_state WHERE id=1').first('version');
    const before = await version();
    const row = await DB.prepare("INSERT INTO preferences(scope,key,value,created_at,updated_at) VALUES ('work','sync-test','one','now','now') RETURNING value").first();
    assert.deepEqual(row, { value: 'one' });
    assert.notEqual(await version(), before);
    const saved = await version();
    const missing = await DB.prepare("UPDATE preferences SET value='absent' WHERE key='missing'").run();
    assert.equal(missing.meta.changes, 0);
    assert.equal(await version(), saved);
    const changed = await DB.prepare("UPDATE preferences SET value=? WHERE key='sync-test'").bind('two').run();
    assert.equal(changed.meta.changes, 1);
    assert.notEqual(await version(), saved);
  } finally { raw.close(); }
});

test('a batch preserves changes() dependencies and each result; failure rolls content AND version back', async () => {
  const raw = createTestDb(), DB = withSyncState(raw);
  try {
    const result = await DB.batch([
      DB.prepare("INSERT INTO preferences(scope,key,value,created_at,updated_at) VALUES ('work','sync-test','one','now','now')"),
      DB.prepare('SELECT changes() AS changed'),
    ]);
    assert.equal(result.length, 2);
    assert.equal(result[0].meta.changes, 1);
    assert.equal(result[1].results[0].changed, 1);
    const before = await DB.prepare('SELECT version FROM sync_state').first('version');
    await assert.rejects(DB.batch([
      DB.prepare("UPDATE preferences SET value='must-roll-back'"),
      DB.prepare("INSERT INTO preferences(scope,key,value,created_at,updated_at) VALUES ('work','sync-test','duplicate','now','now')"),
    ]));
    assert.equal(await DB.prepare('SELECT value FROM preferences').first('value'), 'one');
    assert.equal(await DB.prepare('SELECT version FROM sync_state').first('version'), before);
    assert.throws(() => DB.exec("DELETE FROM preferences"), /prepared content/);
  } finally { raw.close(); }
});

test('sync endpoint is scoped, content-free, and changes after real capture and task routes', async () => {
  const DB = createTestDb(), worker = createWorker();
  const env = { DB, DEV_ALLOW_UNAUTH: '1', SPIKE_TEST_HOOKS: '0' };
  const call = async (method, path, body) => {
    const response = await worker.fetch(new Request('http://127.0.0.1:8899' + path, {
      method, headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    return { status: response.status, data: await response.json() };
  };
  try {
    assert.equal((await call('GET','/api/sync')).status,400);
    assert.equal((await call('GET','/api/sync?scope=wrong')).status,400);
    const before = await call('GET','/api/sync?scope=all');
    assert.equal(before.status,200); assert.deepEqual(Object.keys(before.data), ['version']);
    assert.match(before.data.version,/^[0-9a-f]{32}$/);
    assert.equal((await call('POST','/api/captures',{id:'cap_sync_fixture_001',scope:'personal',text:'Fictional private sync canary',time_zone:'America/New_York'})).status,201);
    const saved = await call('GET','/api/sync?scope=work');
    assert.notEqual(saved.data.version,before.data.version);
    assert.equal(JSON.stringify(saved).includes('canary'),false);
    assert.equal((await call('POST','/api/items',{scope:'work',kind:'task',title:'Fictional sync task'})).status,201);
    assert.notEqual((await call('GET','/api/sync?scope=all')).data.version,saved.data.version);
  } finally { DB.close(); }
});
