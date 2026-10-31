// Scope sweep: an enforced invariant, not a convention.
//
// 1. Schema: every table outside a short system allowlist has `scope TEXT NOT NULL CHECK (scope IN
//    ('work','personal'))`. A new feature table without it fails here, whoever wrote it.
// 2. Routes: every registered route (core ROUTES plus FEATURE_ROUTES, read from the router itself) must have
//    a FIXTURE below or an EXEMPT entry with a reason; a new route with neither fails the completeness test.
//    Each fixture makes two valid requests against seeded personal records carrying a canary:
//      cross: a work-scope request aimed at the personal records -> must not be 2xx-with-canary, must not
//             contain the canary at all;
//      own:   the same request as the personal scope -> must be 2xx (proves the handler and its query were
//             reached, not stopped by validation) and, for reads, must contain the canary (proves the seed
//             is visible, so an empty table cannot pass for a filtered one).
//
// Coverage limits, stated so nobody over-reads a green run: this checks HTTP responses only. Provider
// prompts (AI), MCP tool results (identity-bound route), cron jobs, notification payloads and derived-data
// deletion are covered by each feature's own canary tests (see PLAN.md "Scope enforcement"). Sample data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/d1.mjs';
import { createWorker, ROUTES } from '../src/api.js';

const BASE = 'http://127.0.0.1:8899';
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0); // Thursday 08:00 New York
const TODAY = '2026-10-29';
const TZ = 'America%2FNew_York';
const CANARY = 'ZZ-SWEEP-PERSONAL-CANARY';
const NO_SCOPE_ALLOWED = new Set(['changes', 'deliveries', 'push_subscriptions', 'events', 'kv', 'meta', 'd1_migrations', 'sqlite_sequence']);

// Routes with no scoped user content, each with the reason. Anything else needs a fixture.
const EXEMPT = {
  'GET /api/session': 'identity and build info only',
  'POST /api/shortcut/capture': 'service-token identity only; same saveCapture path as POST /api/captures',
  'GET /api/push/public-key': 'public VAPID key',
  'POST /api/push/subscriptions': 'device push endpoint, not user content',
  'DELETE /api/push/subscriptions': 'device push endpoint, not user content',
  'POST /api/push/test': 'fixed test text, no records',
  'POST /api/deliveries/([A-Za-z0-9_.:-]{1,120})/received': 'returns delivery ids/states/timestamps only (serialiseDelivery has no text)',
  'POST /api/deliveries/([A-Za-z0-9_.:-]{1,120})/ack': 'returns delivery ids/states/timestamps only (serialiseDelivery has no text)',
  'GET /api/evidence': 'events carry ids/states/counts only (logging rule, tests/api X1)',
  'GET /api/settings/test-quiet-hours': 'test setting, no content',
  'PUT /api/settings/test-quiet-hours': 'test setting, no content',
  'POST /api/mcp': 'service identity only (owner gets 403); scope canary in tests/mcp.test.mjs',
  'GET /api/connections/mcp': 'configuration flags only',
};

// P: seeded personal ids. Each entry: { cross: [method, path, body], own: [method, path, body], reads }.
// Order matters only for the mutating fixtures, which run after the reads (see LATE).
const FIXTURES = {
  'POST /api/captures': (P) => ({
    cross: ['POST', '/api/captures', { id: P.capture, scope: 'work', text: 'sweep other words' }],
    own: ['POST', '/api/captures', { id: 'cap-sweep-own-002', scope: 'personal', text: `${CANARY} second capture`, time_zone: 'America/New_York' }],
  }),
  'GET /api/inbox': () => ({ cross: ['GET', '/api/inbox?scope=work'], own: ['GET', '/api/inbox?scope=personal'], reads: true }),
  'GET /api/today': () => ({ cross: ['GET', `/api/today?scope=work&tz=${TZ}`], own: ['GET', `/api/today?scope=personal&tz=${TZ}`], reads: true }),
  'GET /api/items': () => ({ cross: ['GET', '/api/items?scope=work'], own: ['GET', '/api/items?scope=personal'], reads: true }),
  'POST /api/items': (P) => ({
    cross: ['POST', '/api/items', { scope: 'work', kind: 'task', title: 'sweep work task', project_id: P.project }],
    own: ['POST', '/api/items', { scope: 'personal', kind: 'task', title: `${CANARY} own task`, project_id: P.project }],
    reads: true,
  }),
  'PATCH /api/items/([A-Za-z0-9_.:-]{1,120})': (P) => ({
    cross: ['PATCH', `/api/items/${P.task}`, { scope: 'work', body: 'sweep' }],
    own: ['PATCH', `/api/items/${P.task}`, { scope: 'personal', body: `${CANARY} edited` }],
    reads: true,
  }),
  'POST /api/items/([A-Za-z0-9_.:-]{1,120})/(complete|reopen|archive|reply|snooze)': (P) => ({
    cross: ['POST', `/api/items/${P.waiting}/reply`, { scope: 'work' }],
    own: ['POST', `/api/items/${P.waiting}/reply`, { scope: 'personal' }],
    reads: true,
  }),
  'GET /api/projects': () => ({ cross: ['GET', '/api/projects?scope=work'], own: ['GET', '/api/projects?scope=personal'], reads: true }),
  'POST /api/projects': () => ({
    cross: ['POST', '/api/projects', { scope: 'work', name: 'sweep work project' }],
    own: ['POST', '/api/projects', { scope: 'personal', name: `${CANARY} own project` }],
    reads: true,
  }),
  'GET /api/projects/([A-Za-z0-9_.:-]{1,120})': (P) => ({ cross: ['GET', `/api/projects/${P.project}?scope=work`], own: ['GET', `/api/projects/${P.project}?scope=personal`], reads: true }),
  'PATCH /api/projects/([A-Za-z0-9_.:-]{1,120})': (P) => ({
    cross: ['PATCH', `/api/projects/${P.project}`, { scope: 'work', purpose: 'sweep' }],
    own: ['PATCH', `/api/projects/${P.project}`, { scope: 'personal', purpose: `${CANARY} purpose edited` }],
    reads: true,
  }),
  'GET /api/projects/([A-Za-z0-9_.:-]{1,120})/checkpoint/prefill': (P) => ({
    cross: ['GET', `/api/projects/${P.project}/checkpoint/prefill?scope=work`],
    own: ['GET', `/api/projects/${P.project}/checkpoint/prefill?scope=personal`],
    reads: true,
  }),
  'POST /api/projects/([A-Za-z0-9_.:-]{1,120})/checkpoint': (P) => ({
    cross: ['POST', `/api/projects/${P.project}/checkpoint`, { scope: 'work', fields: { next_step: 'sweep' } }],
    own: ['POST', `/api/projects/${P.project}/checkpoint`, { scope: 'personal', fields: { next_step: `${CANARY} next` } }],
    reads: true,
  }),
  'GET /api/search': () => ({
    cross: ['GET', `/api/search?scope=work&q=${encodeURIComponent(CANARY)}`],
    own: ['GET', `/api/search?scope=personal&q=${encodeURIComponent(CANARY)}`],
    reads: true,
  }),
  'GET /api/export': () => ({ cross: ['GET', '/api/export?scope=work'], own: ['GET', '/api/export?scope=personal'], reads: true }),
  'POST /api/reminders': (P) => ({
    cross: ['POST', '/api/reminders', { id: 'rem-sweep-cross-01', scope: 'work', text: 'sweep', local_date: '2026-10-30', local_time: '09:00', time_zone: 'America/New_York', item_id: P.task }],
    own: ['POST', '/api/reminders', { id: 'rem-sweep-own-001', scope: 'personal', text: `${CANARY} own reminder`, local_date: '2026-10-30', local_time: '09:00', time_zone: 'America/New_York', item_id: P.task }],
    reads: true,
  }),
  'GET /api/reminders': () => ({ cross: ['GET', '/api/reminders?scope=work'], own: ['GET', '/api/reminders?scope=personal'], reads: true }),
  'POST /api/reminders/([A-Za-z0-9_.:-]{1,120})/cancel': (P) => ({
    cross: ['POST', `/api/reminders/${P.reminder}/cancel`, { scope: 'work' }],
    own: ['POST', `/api/reminders/${P.reminder}/cancel`, { scope: 'personal' }],
    reads: true,
  }),
  'GET /api/review/weekly': () => ({ cross: ['GET', `/api/review/weekly?scope=work&tz=${TZ}`], own: ['GET', `/api/review/weekly?scope=personal&tz=${TZ}`], reads: true }),
  'GET /api/review/weekly/status': () => ({ cross: ['GET', `/api/review/weekly/status?scope=work&tz=${TZ}`], own: ['GET', `/api/review/weekly/status?scope=personal&tz=${TZ}`] }),
  'POST /api/review/weekly/select': (P) => ({
    cross: ['POST', `/api/review/weekly/select?tz=${TZ}`, { scope: 'work', refs: [`item:${P.task}`] }],
    own: ['POST', `/api/review/weekly/select?tz=${TZ}`, { scope: 'personal', refs: [`item:${P.task}`] }],
  }),
  'POST /api/review/weekly/defer': (P) => ({
    cross: ['POST', `/api/review/weekly/defer?tz=${TZ}`, { scope: 'work', ref: `item:${P.waiting}`, follow_up_on: '2026-11-05' }],
    own: ['POST', `/api/review/weekly/defer?tz=${TZ}`, { scope: 'personal', ref: `item:${P.waiting}`, follow_up_on: '2026-11-05' }],
  }),
  'POST /api/review/weekly/complete': () => ({
    cross: ['POST', `/api/review/weekly/complete?tz=${TZ}`, { scope: 'work' }],
    own: ['POST', `/api/review/weekly/complete?tz=${TZ}`, { scope: 'personal' }],
  }),
  // Mutations that remove or rewrite the seed run last.
  'POST /api/captures/([A-Za-z0-9_-]{8,80})/review': (P) => ({
    cross: ['POST', `/api/captures/${P.capture}/review`, { scope: 'work', keepAsNote: true }],
    own: ['POST', `/api/captures/${P.capture}/review`, { scope: 'personal', keepAsNote: true }],
    reads: true,
  }),
  'POST /api/undo/([^/]{1,40})': (P) => ({
    cross: ['POST', `/api/undo/${P.undoChange}`, { scope: 'work' }],
    own: ['POST', `/api/undo/${P.undoChange}`, { scope: 'personal' }],
  }),
  'DELETE /api/captures/([A-Za-z0-9_-]{8,80})': (P) => ({
    cross: ['DELETE', `/api/captures/${P.capture}?scope=work`],
    own: ['DELETE', `/api/captures/${P.capture}?scope=personal`],
  }),
};
const LATE = new Set(['POST /api/captures/([A-Za-z0-9_-]{8,80})/review', 'POST /api/undo/([^/]{1,40})', 'DELETE /api/captures/([A-Za-z0-9_-]{8,80})']);

function routeKey(method, re) {
  return `${method} ${re.source.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/')}`;
}

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
  const j = async (p) => {
    const r = await p;
    assert.ok(r.status >= 200 && r.status < 300, `seed failed ${r.status} ${r.text.slice(0, 200)}`);
    return JSON.parse(r.text);
  };
  const P = {};
  P.project = (await j(call('POST', '/api/projects', { scope: 'personal', name: `${CANARY} project`, purpose: CANARY }))).project.id;
  P.task = (await j(call('POST', '/api/items', { scope: 'personal', kind: 'task', title: `${CANARY} task`, project_id: P.project, due_on: TODAY, today_pick: true }))).item.id;
  P.waiting = (await j(call('POST', '/api/items', { scope: 'personal', kind: 'waiting', title: `${CANARY} waiting`, who: CANARY, asked_on: '2026-10-20', follow_up_on: TODAY, project_id: P.project }))).item.id;
  P.decision = (await j(call('POST', '/api/items', { scope: 'personal', kind: 'decision', title: `${CANARY} decision`, project_id: P.project }))).item.id;
  P.undoChange = (await j(call('POST', '/api/items', { scope: 'personal', kind: 'idea', title: `${CANARY} idea for undo` }))).changeId;
  P.capture = 'cap-sweep-personal-01';
  await j(call('POST', '/api/captures', { id: P.capture, scope: 'personal', text: `${CANARY} capture text. Call the plumber tomorrow.`, time_zone: 'America/New_York' }));
  await j(call('POST', `/api/projects/${P.project}/checkpoint`, { scope: 'personal', fields: { stopped_at_text: CANARY, next_step: CANARY } }));
  P.reminder = 'rem-sweep-personal-01';
  await j(call('POST', '/api/reminders', { id: P.reminder, scope: 'personal', text: `${CANARY} reminder`, local_date: '2026-10-30', local_time: '09:00', time_zone: 'America/New_York' }));
  return P;
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

test('completeness: every registered route has a scope fixture or a stated exemption', () => {
  const unaccounted = [];
  for (const [method, re] of ROUTES) {
    const key = routeKey(method, re);
    if (key.includes(' /api/test/')) continue;
    if (!FIXTURES[key] && !EXEMPT[key]) unaccounted.push(key);
  }
  assert.deepEqual(unaccounted, [], `routes without a scope fixture or exemption (add one in tests/scope-sweep.test.mjs):\n${unaccounted.join('\n')}`);
  const live = new Set(ROUTES.map(([m, re]) => routeKey(m, re)));
  const stale = [...Object.keys(FIXTURES), ...Object.keys(EXEMPT)].filter((k) => !live.has(k));
  assert.deepEqual(stale, [], `fixtures for routes that no longer exist: ${stale.join(', ')}`);
});

test('routes: every fixture reaches its handler for its own scope and never shows personal content to work', async () => {
  const { call } = setup();
  const P = await seedPersonal(call);
  const keys = ROUTES.map(([m, re]) => routeKey(m, re)).filter((k) => FIXTURES[k]);
  const ordered = [...keys.filter((k) => !LATE.has(k)), ...keys.filter((k) => LATE.has(k))];
  const problems = [];
  for (const key of ordered) {
    const fx = FIXTURES[key](P);
    const cross = await call(...fx.cross);
    if (cross.text.includes(CANARY)) problems.push(`LEAK ${key}: work request returned personal content (${cross.status})`);
    const own = await call(...fx.own);
    if (own.status < 200 || own.status >= 300) problems.push(`UNREACHED ${key}: own-scope request got ${own.status} ${own.text.slice(0, 160)}`);
    else if (fx.reads && !own.text.includes(CANARY)) problems.push(`EMPTY ${key}: own-scope response lacks the seeded canary, so the cross check proves nothing`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});
