// Real SQLite/D1 batches, deferred fictional RPC replies; no cloud or real user data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDb } from './helpers/d1.mjs';
import * as pm from '../src/pm.js';

const NOW = Date.parse('2026-10-29T12:00:00.000Z');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/pm/digest-v1.json', import.meta.url), 'utf8'));
function digest(title, at = NOW) {
  const value = structuredClone(fixture);
  value.source.exported_at = new Date(at).toISOString();
  value.projects[0].name = title;
  return value;
}
function setup(t) {
  const DB = createTestDb();
  t.after(() => DB.close());
  const pending = [];
  const env = { DB, PM_DIGEST_SERVICE: { getDigest: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) } };
  const queued = async (count) => {
    for (let i = 0; i < 100; i++) {
      if (pending.length >= count) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error('Fixture RPC did not queue');
  };
  const source = () => DB.prepare('SELECT * FROM pm_sources WHERE id = ?').bind(pm.HTTP_SOURCE_ID).first();
  const title = () => DB.prepare("SELECT title FROM pm_records WHERE source_id = ? AND kind = 'project' AND provider_id = 'P-100'").bind(pm.HTTP_SOURCE_ID).first('title');
  return { DB, env, pending, queued, source, title };
}

test('manual and cron share admission, including requests at the same timestamp', async (t) => {
  const s = setup(t);
  const first = pm.refreshHttpSource(s.env, NOW);
  await s.queued(1);
  const token = (await s.source()).refresh_token;
  assert.equal((await pm.refreshHttpSource(s.env, NOW)).code, 'in_progress');
  assert.equal((await pm.onScheduled(s.env, NOW)).code, 'in_progress');
  assert.equal(s.pending.length, 1, 'contenders do not start extra provider calls');
  assert.equal((await s.source()).refresh_token, token);
  s.pending[0].resolve(digest('Only admitted response'));
  assert.equal((await first).ok, true);
  assert.equal(await s.title(), 'Only admitted response');
  assert.equal((await s.source()).refresh_token, null);
  assert.equal((await pm.onScheduled(s.env, NOW + 1)).code, 'not_due');
});

test('expired attempt cannot overwrite the successor snapshot or freshness', async (t) => {
  const s = setup(t);
  const old = pm.refreshHttpSource(s.env, NOW);
  await s.queued(1);
  const later = NOW + pm.REFRESH_LEASE_MS;
  const next = pm.refreshHttpSource(s.env, later);
  await s.queued(2);
  s.pending[1].resolve(digest('Newer response', later));
  assert.equal((await next).ok, true);
  const expected = await s.source();
  s.pending[0].resolve(digest('Older response'));
  assert.equal((await old).code, 'superseded');
  assert.equal(await s.title(), 'Newer response');
  const after = await s.source();
  assert.equal(after.exported_at, expected.exported_at);
  assert.equal(after.last_import_at, expected.last_import_at);
  assert.equal(after.state, 'ok');
  assert.equal(after.last_error_code, null);
});

test('stale failure cannot clobber success or clear a newer active lease', async (t) => {
  const s = setup(t);
  const old = pm.refreshHttpSource(s.env, NOW);
  await s.queued(1);
  const next = pm.onScheduled(s.env, NOW + pm.REFRESH_LEASE_MS);
  await s.queued(2);
  const token = (await s.source()).refresh_token;
  s.pending[0].reject(new Error('Fictional old failure'));
  assert.equal((await old).code, 'superseded');
  assert.equal((await s.source()).refresh_token, token);
  assert.equal((await s.source()).state, 'never');
  s.pending[1].resolve(digest('Current success', NOW + pm.REFRESH_LEASE_MS));
  assert.equal((await next).ok, true);
  assert.equal((await s.source()).state, 'ok');

  // A different stale failure that arrives AFTER a subsequent success must also be harmless.
  const failing = pm.refreshHttpSource(s.env, NOW + pm.REFRESH_MS);
  await s.queued(3);
  const success = pm.refreshHttpSource(s.env, NOW + pm.REFRESH_MS + pm.REFRESH_LEASE_MS);
  await s.queued(4);
  s.pending[3].resolve(digest('Latest success', NOW + pm.REFRESH_MS + pm.REFRESH_LEASE_MS));
  assert.equal((await success).ok, true);
  s.pending[2].reject(new Error('Fictional stale failure'));
  assert.equal((await failing).code, 'superseded');
  assert.equal(await s.title(), 'Latest success');
  assert.equal((await s.source()).last_error_code, null);
});

test('cron can recover an abandoned lease before the hourly interval; tokens do not depend on timestamps', async (t) => {
  const s = setup(t);
  const abandoned = pm.onScheduled(s.env, NOW);
  await s.queued(1);
  const oldToken = (await s.source()).refresh_token;
  // Simulate a durable lease expiring while the wall-clock request timestamp is unchanged.
  // A timestamp-only fence would collide; an opaque successor token must not.
  await s.DB.prepare('UPDATE pm_sources SET refresh_until_ms = ? WHERE id = ?').bind(NOW, pm.HTTP_SOURCE_ID).run();
  const retry = pm.onScheduled(s.env, NOW);
  await s.queued(2);
  assert.notEqual((await s.source()).refresh_token, oldToken);
  s.pending[1].resolve(digest('Recovered attempt'));
  assert.equal((await retry).ok, true);
  s.pending[0].resolve(digest('Abandoned late response'));
  assert.equal((await abandoned).code, 'superseded');
  assert.equal(await s.title(), 'Recovered attempt');
});

test('a successor between import preparation and batch execution fences ALL copy statements', async (t) => {
  const s = setup(t);
  const old = pm.refreshHttpSource(s.env, NOW);
  await s.queued(1);
  const originalBatch = s.DB.batch.bind(s.DB);
  let intercepted = false;
  s.DB.batch = async (statements) => {
    if (!intercepted) {
      intercepted = true;
      s.DB.batch = originalBatch;
      const next = pm.refreshHttpSource(s.env, NOW + pm.REFRESH_LEASE_MS);
      await s.queued(2);
      s.pending[1].resolve(digest('Batch successor', NOW + pm.REFRESH_LEASE_MS));
      assert.equal((await next).ok, true);
    }
    return originalBatch(statements);
  };
  s.pending[0].resolve(digest('Stale prepared import'));
  assert.equal((await old).code, 'superseded');
  assert.equal(intercepted, true);
  assert.equal(await s.title(), 'Batch successor');
  assert.equal((await s.source()).state, 'ok');
  assert.equal((await s.DB.prepare('SELECT COUNT(*) AS n FROM pm_records WHERE source_id = ?').bind(pm.HTTP_SOURCE_ID).first('n')), 7);
});

test('batch failure rolls back copy and freshness and releases the lease for a manual retry', async (t) => {
  const s = setup(t);
  const initial = pm.refreshHttpSource(s.env, NOW);
  await s.queued(1);
  s.pending[0].resolve(digest('Last good copy'));
  assert.equal((await initial).ok, true);
  const good = await s.source();
  await s.DB.exec("CREATE TRIGGER fail_fixture_insert BEFORE INSERT ON pm_records WHEN NEW.title = 'Fail in transaction' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END;");
  const failed = pm.refreshHttpSource(s.env, NOW + 1);
  await s.queued(2);
  s.pending[1].resolve(digest('Fail in transaction', NOW + 1));
  await assert.rejects(failed, /fixture rollback/);
  assert.equal(await s.title(), 'Last good copy');
  assert.equal((await s.source()).last_import_at, good.last_import_at);
  assert.equal((await s.source()).refresh_token, null);
  await s.DB.exec('DROP TRIGGER fail_fixture_insert;');
  const retry = pm.refreshHttpSource(s.env, NOW + 1);
  await s.queued(3);
  s.pending[2].resolve(digest('Manual retry', NOW + 1));
  assert.equal((await retry).ok, true);
  assert.equal(await s.title(), 'Manual retry');
});

test('not-connected and deleted-source outcomes cannot recreate or replace a stored copy', async (t) => {
  const s = setup(t);
  assert.equal((await pm.refreshHttpSource({ DB: s.DB }, NOW)).code, 'not_connected');
  assert.equal(await s.source(), null);
  const inflight = pm.refreshHttpSource(s.env, NOW);
  await s.queued(1);
  delete s.env.PM_DIGEST_SERVICE;
  s.pending[0].resolve(digest('Disconnected reply'));
  assert.equal((await inflight).code, 'not_connected');
  assert.equal((await s.source()).refresh_token, null);
  assert.equal(await s.title(), null);
  s.env.PM_DIGEST_SERVICE = { getDigest: () => new Promise((resolve, reject) => s.pending.push({ resolve, reject })) };
  const deleted = pm.refreshHttpSource(s.env, NOW + 1);
  await s.queued(2);
  await s.DB.batch([
    s.DB.prepare('DELETE FROM pm_records WHERE source_id = ?').bind(pm.HTTP_SOURCE_ID),
    s.DB.prepare('DELETE FROM pm_sources WHERE id = ?').bind(pm.HTTP_SOURCE_ID),
  ]);
  s.pending[1].resolve(digest('Deleted source reply', NOW + 1));
  assert.equal((await deleted).code, 'superseded');
  assert.equal(await s.source(), null);
  assert.equal(await s.title(), null);
});
