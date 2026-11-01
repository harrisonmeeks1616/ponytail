// Optional real local workerd/D1 proof. Fictional tables/RPC responses, no cloud or real data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import * as pm from '../src/pm.js';

const mf = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, modules: true,
  script: 'export default {fetch(){return new Response("fixture");}}', d1Databases: { DB: 'pm-fence-fixture' } });
const NOW = Date.parse('2026-10-29T12:00:00.000Z');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/pm/digest-v1.json', import.meta.url), 'utf8'));
const digest = (title, at) => { const value = structuredClone(fixture); value.source.exported_at = new Date(at).toISOString(); value.projects[0].name = title; return value; };
try {
  const DB = await mf.getD1Database('DB');
  for (const file of ['0006_pm.sql', '0010_pm_refresh_fence.sql']) {
    const statements = readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8').replace(/--[^\n]*/g, '').split(';').map((s) => s.trim()).filter(Boolean);
    await DB.batch(statements.map((sql) => DB.prepare(sql)));
  }
  await DB.prepare('CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, ref TEXT, detail TEXT)').run();
  const pending = [];
  const env = { DB, PM_DIGEST_SERVICE: { getDigest: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) } };
  const queued = async (n) => { for (let i = 0; i < 200; i++) { if (pending.length >= n) return; await new Promise((resolve) => setTimeout(resolve, 2)); } throw new Error('Fixture did not queue'); };
  const old = pm.refreshHttpSource(env, NOW);
  await queued(1);
  assert.equal((await pm.onScheduled(env, NOW)).code, 'in_progress');
  const newer = pm.onScheduled(env, NOW + pm.REFRESH_LEASE_MS);
  await queued(2);
  pending[1].resolve(digest('Current workerd copy', NOW + pm.REFRESH_LEASE_MS));
  assert.equal((await newer).ok, true);
  pending[0].reject(new Error('Late fictional failure'));
  assert.equal((await old).code, 'superseded');
  const stored = await DB.prepare("SELECT title FROM pm_records WHERE source_id = ? AND kind = 'project' AND provider_id = 'P-100'").bind(pm.HTTP_SOURCE_ID).first('title');
  const source = await DB.prepare('SELECT state,refresh_token,last_error_code FROM pm_sources WHERE id = ?').bind(pm.HTTP_SOURCE_ID).first();
  assert.equal(stored, 'Current workerd copy'); assert.equal(source.state, 'ok'); assert.equal(source.last_error_code, null); assert.equal(source.refresh_token, null);
  assert.equal((await pm.onScheduled(env, NOW + pm.REFRESH_LEASE_MS + 1)).code, 'not_due');
  console.log(JSON.stringify({ workerdFence: 'passed', activeLeaseBlocksCron: true, expiredCronRecovers: true, staleFailureHarmless: true, cloudCalls: 0, realDataWrites: 0 }));
} finally { await mf.dispose(); }
