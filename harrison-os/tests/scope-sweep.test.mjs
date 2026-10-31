// Scope sweep: an enforced invariant, not a convention. Two checks cover every module by construction:
//  1. Schema: every table that is not on the short system allowlist has a NOT NULL `scope` column limited
//     to 'work'/'personal'. A new feature table without scope fails here, whoever wrote it.
//  2. Routes: every registered route (core ROUTES plus FEATURE_ROUTES, read from the router itself) is
//     called as a work-scope request, with each personal record id substituted into its path, and the
//     response must not contain the personal canary. A forgotten `WHERE scope = ?` in any module fails here.
// Feature-specific paths (AI prompts, MCP tool results, jobs, derived-data deletion) have their own canary
// tests in their modules; this file is the floor every route must clear. Sample data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/d1.mjs';
import { createWorker, ROUTES } from '../src/api.js';

const BASE = 'http://127.0.0.1:8899';
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const CANARY = 'ZZ-SWEEP-PERSONAL-CANARY';
// Tables with no user content, or whose rows only point at scoped rows (scope is derived through the parent).
const NO_SCOPE_ALLOWED = new Set(['changes', 'deliveries', 'push_subscriptions', 'events', 'kv', 'meta', 'd1_migrations', 'sqlite_sequence']);

function setup() {
  const DB = createTestDb();
  const worker = createWorker({ now: () => NOW });
  const env = { DB, BUILD_ID: 'test', DEV_ALLOW_UNAUTH: '1', SPIKE_TEST_HOOKS: '0', ALLOW_TEST_PUSH_ENDPOINT: '0', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', ACCESS_AUD_SHORTCUT: '', VAPID_PUBLIC_KEY: '', VAPID_SUBJECT: '' };
  async function call(method, path, body) {
    const headers = { 'X-Requested-With': 'XMLHttpRequest' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await worker.fetch(new Request(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, text: await res.text() };
  }
  return { DB, call };
}

async function seedPersonal(call) {
  const ids = [];
  const j = (r) => JSON.parse(r.text);
  const p = j(await call('POST', '/api/projects', { scope: 'personal', name: `${CANARY} project`, purpose: CANARY }));
  ids.push(p.project.id);
  for (const kind of ['task', 'waiting', 'reference', 'idea', 'decision']) {
    const r = j(await call('POST', '/api/items', { scope: 'personal', kind, title: `${CANARY} ${kind}`, body: CANARY, project_id: p.project.id, due_on: '2026-10-29', who: kind === 'waiting' ? CANARY : undefined }));
    ids.push(r.item.id);
  }
  const capId = 'cap-sweep-personal-01';
  await call('POST', '/api/captures', { id: capId, scope: 'personal', text: `${CANARY} capture text`, time_zone: 'America/New_York' });
  ids.push(capId);
  await call('POST', `/api/projects/${p.project.id}/checkpoint`, { scope: 'personal', fields: { stopped_at_text: CANARY, next_step: CANARY } });
  return ids;
}

test('schema: every content table has a NOT NULL work/personal scope column', async () => {
  const { DB } = setup();
  const tables = (await DB.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all()).results;
  const missing = [];
  for (const t of tables) {
    if (NO_SCOPE_ALLOWED.has(t.name) || t.name.startsWith('fts_') || t.name.startsWith('_cf_') || t.name.startsWith('sqlite_')) continue;
    const cols = (await DB.prepare(`PRAGMA table_info(${t.name})`).all()).results;
    const scope = cols.find((c) => c.name === 'scope');
    const constrained = scope && /scope\s+TEXT[^,]*CHECK\s*\(\s*scope\s+IN\s*\(\s*'work'\s*,\s*'personal'\s*\)\s*\)/i.test(t.sql);
    if (!scope || !(scope.notnull || scope.pk) || !constrained) missing.push(t.name);
  }
  assert.deepEqual(missing, [], `tables without an enforced scope column: ${missing.join(', ')}`);
});

test('routes: no registered route returns personal content to a work-scope request', async () => {
  const { call } = setup();
  const ids = await seedPersonal(call);
  // Sanity: the canary is really there for a personal read.
  const own = await call('GET', `/api/search?scope=personal&q=${encodeURIComponent(CANARY)}`);
  assert.ok(own.text.includes(CANARY), 'seed failed: personal search should find the canary');

  const leaks = [];
  let calls = 0;
  for (const [method, re] of ROUTES) {
    const src = re.source.replace(/^\^/, '').replace(/\$$/, '');
    if (src.startsWith('/api/test')) continue;
    const groups = (src.match(/\((?!\?)/g) || []).length;
    // Fill every capture group with each personal id; an alternation group gets its first literal option.
    const fills = groups === 0 ? [null] : ids;
    for (const id of fills) {
      let path = src;
      for (let g = 0; g < groups; g++) {
        path = path.replace(/\((?!\?)([^()]*)\)/, (_, inner) => (inner.includes('|') && !inner.includes('[') ? inner.split('|')[0] : id));
      }
      path = path.replace(/\\\//g, '/').replace(/\\\./g, '.');
      const qs = 'scope=work&tz=America%2FNew_York&q=' + encodeURIComponent(CANARY);
      const body = method === 'GET' || method === 'DELETE' ? undefined : { scope: 'work', q: CANARY, question: CANARY, query: CANARY, text: 'sweep', refs: [`item:${id}`], source_refs: [`item:${id}`], project_id: id, item_id: id };
      if (method === 'DELETE') continue; // deletion across scopes is covered by db tests; never delete here
      const r = await call(method, `${path}?${qs}`, body);
      calls++;
      if (r.text.includes(CANARY)) leaks.push(`${method} ${path} -> ${r.status}`);
    }
  }
  assert.ok(calls > 20, `expected to sweep the router, made ${calls} calls`);
  assert.deepEqual(leaks, [], `personal canary leaked to work scope:\n${leaks.join('\n')}`);
});

test('export: work export carries no personal content', async () => {
  const { call } = setup();
  await seedPersonal(call);
  const r = await call('GET', '/api/export?scope=work');
  assert.equal(r.status, 200);
  assert.ok(!r.text.includes(CANARY));
});
