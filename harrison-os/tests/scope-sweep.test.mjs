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
import { readFileSync } from 'node:fs';
import { createWorker, ROUTES } from '../src/api.js';

const ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//sweep//EN', 'BEGIN:VEVENT', 'UID:sweep-1@example.invalid', 'DTSTAMP:20261028T120000Z',
  'DTSTART:20261029T150000Z', 'DTEND:20261029T160000Z', 'SUMMARY:ZZ-SWEEP-PERSONAL-CANARY appointment', 'LOCATION:ZZ-SWEEP-PERSONAL-CANARY place', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
// A synthetic PM export with the canary in a project name, for the PM digest fixtures.
const PM_CONTENT = readFileSync(new URL('./fixtures/pm/digest-v1.json', import.meta.url), 'utf8').replace('Synthetic clinic fit-out', 'ZZ-SWEEP-PERSONAL-CANARY fit-out');

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
  'GET /api/ai/status': 'configured flag and per-scope consent booleans only',
  'PUT /api/ai/consent': 'sets a per-scope boolean; returns flags only',
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
  'POST /api/items/([A-Za-z0-9_.:-]{1,120})/(complete|reopen|archive|reply|snooze|defer)': (P) => ({
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
  'POST /api/ask': (P) => ({
    cross: ['POST', '/api/ask', { scope: 'work', question: `${CANARY} what is open`, context: { project_id: P.project }, tz: 'America/New_York' }],
    own: ['POST', '/api/ask', { scope: 'personal', question: `${CANARY} what is open`, context: { project_id: P.project }, tz: 'America/New_York' }],
    reads: true,
  }),
  'GET /api/projects/([A-Za-z0-9_.:-]{1,120})/brief': (P) => ({
    cross: ['GET', `/api/projects/${P.project}/brief?scope=work&tz=${TZ}`],
    own: ['GET', `/api/projects/${P.project}/brief?scope=personal&tz=${TZ}`],
    reads: true,
  }),
  'POST /api/pm/import': () => ({
    cross: ['POST', '/api/pm/import', { scope: 'work', label: 'sweep work import', format: 'json', content: PM_CONTENT.replace(CANARY, 'work') }],
    own: ['POST', '/api/pm/import', { scope: 'personal', label: `${CANARY} second import`, format: 'json', content: PM_CONTENT }],
    reads: true,
  }),
  'POST /api/pm/sample': () => ({ cross: ['POST', '/api/pm/sample', { scope: 'work' }], own: ['POST', '/api/pm/sample', { scope: 'personal' }] }),
  'GET /api/pm/sources': () => ({ cross: ['GET', '/api/pm/sources?scope=work'], own: ['GET', '/api/pm/sources?scope=personal'], reads: true }),
  'GET /api/pm/digest': () => ({ cross: ['GET', `/api/pm/digest?scope=work&tz=${TZ}`], own: ['GET', `/api/pm/digest?scope=personal&tz=${TZ}`], reads: true }),
  // File-import sources cannot be refreshed by design: the own request is reached past the scope lookup
  // and answers 409 import_source; the cross request must be 404.
  'POST /api/pm/sources/([A-Za-z0-9_-]{1,120})/refresh': (P) => ({
    cross: ['POST', `/api/pm/sources/${P.pmSource}/refresh`, { scope: 'work' }],
    own: ['POST', `/api/pm/sources/${P.pmSource}/refresh`, { scope: 'personal' }],
    ownOk: (r) => r.status === 409 && r.text.includes('import_source'),
    crossOk: (r) => r.status === 404,
  }),
  'GET /api/drafts': () => ({ cross: ['GET', '/api/drafts?scope=work'], own: ['GET', '/api/drafts?scope=personal'], reads: true }),
  'POST /api/drafts': (P) => ({
    cross: ['POST', '/api/drafts', { scope: 'work', kind: 'update', facts: 'sweep', source_refs: [`item:${P.task}`, `project:${P.project}`] }],
    own: ['POST', '/api/drafts', { scope: 'personal', kind: 'update', facts: `${CANARY} own facts`, source_refs: [`item:${P.task}`] }],
    reads: true,
  }),
  'GET /api/drafts/([A-Za-z0-9_-]{8,80})': (P) => ({ cross: ['GET', `/api/drafts/${P.draft}?scope=work`], own: ['GET', `/api/drafts/${P.draft}?scope=personal`], reads: true, crossOk: (r) => r.status === 404 }),
  'PATCH /api/drafts/([A-Za-z0-9_-]{8,80})': (P) => ({
    cross: ['PATCH', `/api/drafts/${P.draft}`, { scope: 'work', body: 'sweep' }],
    own: ['PATCH', `/api/drafts/${P.draft}`, { scope: 'personal', body: `${CANARY} edited draft. We requested 2 lifts.` }],
    reads: true,
    crossOk: (r) => r.status === 404,
  }),
  'POST /api/drafts/([A-Za-z0-9_-]{8,80})/check': (P) => ({
    cross: ['POST', `/api/drafts/${P.draft}/check`, { scope: 'work' }],
    own: ['POST', `/api/drafts/${P.draft}/check`, { scope: 'personal' }],
    reads: true,
    crossOk: (r) => r.status === 404,
  }),
  'GET /api/calendar/connections': () => ({ cross: ['GET', '/api/calendar/connections?scope=work'], own: ['GET', '/api/calendar/connections?scope=personal'], reads: true }),
  'POST /api/calendar/connections': () => ({
    cross: ['POST', '/api/calendar/connections', { scope: 'work', label: 'sweep work feed', url: 'https://calendar.example.com/work.ics' }],
    own: ['POST', '/api/calendar/connections', { scope: 'personal', label: `${CANARY} feed`, url: 'https://calendar.example.com/personal.ics' }],
    reads: true,
  }),
  // Imported files are not refreshable by design: own answers 409 not_refreshable after the scoped lookup.
  'POST /api/calendar/connections/([A-Za-z0-9_-]{1,80})/refresh': (P) => ({
    cross: ['POST', `/api/calendar/connections/${P.calendar}/refresh`, { scope: 'work' }],
    own: ['POST', `/api/calendar/connections/${P.calendar}/refresh`, { scope: 'personal' }],
    ownOk: (r) => r.status === 409 && r.text.includes('not_refreshable'),
    crossOk: (r) => r.status === 404,
  }),
  'POST /api/calendar/import': () => ({
    cross: ['POST', '/api/calendar/import', { scope: 'work', label: 'sweep work import', ics_text: ICS.replaceAll(CANARY, 'work') }],
    own: ['POST', '/api/calendar/import', { scope: 'personal', label: `${CANARY} second import`, ics_text: ICS }],
    reads: true,
  }),
  'POST /api/calendar/sample': () => ({ cross: ['POST', '/api/calendar/sample', { scope: 'work' }], own: ['POST', '/api/calendar/sample', { scope: 'personal' }] }),
  // Work view shows personal events as busy-only: present, but without title or location.
  'GET /api/calendar/events': () => ({
    cross: ['GET', `/api/calendar/events?scope=work&from=2026-10-29&to=2026-10-31&tz=${TZ}`],
    own: ['GET', `/api/calendar/events?scope=personal&from=2026-10-29&to=2026-10-31&tz=${TZ}`],
    reads: true,
    crossOk: (r) => r.status === 200 && /"busy_only":\s*(true|1)/.test(r.text),
  }),
  'GET /api/items/([A-Za-z0-9_.:-]{1,120})': (P) => ({ cross: ['GET', `/api/items/${P.task}?scope=work`], own: ['GET', `/api/items/${P.task}?scope=personal`], reads: true, crossOk: (r) => r.status === 404 }),
  'POST /api/attachments': (P) => ({
    cross: ['POST', '/api/attachments', { id: 'att-sweep-cross-01', scope: 'work', capture_id: P.capture, name: 'x.txt', mime: 'text/plain', data_b64: btoa('sweep') }],
    own: ['POST', '/api/attachments', { id: 'att-sweep-own-001', scope: 'personal', capture_id: P.capture, name: `${CANARY}.txt`, mime: 'text/plain', data_b64: btoa(CANARY) }],
    reads: true,
    crossOk: (r) => r.status === 404,
  }),
  'GET /api/attachments/([A-Za-z0-9_-]{8,80})': (P) => ({ cross: ['GET', `/api/attachments/${P.attachment}?scope=work`], own: ['GET', `/api/attachments/${P.attachment}?scope=personal`], reads: true, crossOk: (r) => r.status === 404 }),
  'GET /api/preferences': () => ({ cross: ['GET', '/api/preferences?scope=work'], own: ['GET', '/api/preferences?scope=personal'], reads: true }),
  'PUT /api/preferences/([a-z0-9_.-]{1,60})': () => ({
    cross: ['PUT', '/api/preferences/sweep.tone', { scope: 'work', value: 'plain' }],
    own: ['PUT', '/api/preferences/sweep.tone', { scope: 'personal', value: `${CANARY} edited` }],
    reads: true,
  }),
  // Restore of a personal export: into work every row is rejected; into personal every row already exists.
  'POST /api/restore': async (P, call) => {
    const data = JSON.parse((await call('GET', '/api/export?scope=personal')).text);
    return {
      cross: ['POST', '/api/restore', { scope: 'work', data }],
      own: ['POST', '/api/restore', { scope: 'personal', data }],
    };
  },
  // Mutations that remove or rewrite the seed run last.
  'DELETE /api/preferences/([a-z0-9_.-]{1,60})': () => ({ cross: ['DELETE', '/api/preferences/sweep.tone?scope=work'], own: ['DELETE', '/api/preferences/sweep.tone?scope=personal'] }),
  'DELETE /api/items/([A-Za-z0-9_.:-]{1,120})': (P) => ({
    cross: ['DELETE', `/api/items/${P.decision}?scope=work`],
    own: ['DELETE', `/api/items/${P.decision}?scope=personal`],
    ownOk: (r) => r.status === 200 && /"deleted":\s*1/.test(r.text),
  }),
  'DELETE /api/calendar/connections/([A-Za-z0-9_-]{1,80})': (P) => ({
    cross: ['DELETE', `/api/calendar/connections/${P.calendar}?scope=work`],
    own: ['DELETE', `/api/calendar/connections/${P.calendar}?scope=personal`],
    crossOk: (r) => r.status === 404,
  }),
  'DELETE /api/drafts/([A-Za-z0-9_-]{8,80})': (P) => ({
    cross: ['DELETE', `/api/drafts/${P.draft}?scope=work`],
    own: ['DELETE', `/api/drafts/${P.draft}?scope=personal`],
  }),
  'DELETE /api/pm/sources/([A-Za-z0-9_-]{1,120})': (P) => ({
    cross: ['DELETE', `/api/pm/sources/${P.pmSource}?scope=work`],
    own: ['DELETE', `/api/pm/sources/${P.pmSource}?scope=personal`],
    crossOk: (r) => r.status === 404,
  }),
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
const LATE = new Set(['DELETE /api/preferences/([a-z0-9_.-]{1,60})', 'DELETE /api/items/([A-Za-z0-9_.:-]{1,120})', 'DELETE /api/calendar/connections/([A-Za-z0-9_-]{1,80})', 'DELETE /api/drafts/([A-Za-z0-9_-]{8,80})', 'DELETE /api/pm/sources/([A-Za-z0-9_-]{1,120})', 'POST /api/captures/([A-Za-z0-9_-]{8,80})/review', 'POST /api/undo/([^/]{1,40})', 'DELETE /api/captures/([A-Za-z0-9_-]{8,80})']);

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
  P.pmSource = (await j(call('POST', '/api/pm/import', { scope: 'personal', label: `${CANARY} PM import`, format: 'json', content: PM_CONTENT }))).source.id;
  P.draft = (await j(call('POST', '/api/drafts', { scope: 'personal', kind: 'email', facts: `${CANARY} facts. We requested 2 lifts for Monday.`, source_refs: [`project:${P.project}`] }))).draft.id;
  P.calendar = (await j(call('POST', '/api/calendar/import', { scope: 'personal', label: `${CANARY} calendar`, ics_text: ICS }))).connection.id;
  P.attachment = 'att-sweep-personal-01';
  await j(call('POST', '/api/attachments', { id: P.attachment, scope: 'personal', capture_id: P.capture, name: 'note.txt', mime: 'text/plain', data_b64: btoa(`${CANARY} attachment bytes`) }));
  await j(call('PUT', '/api/preferences/sweep.tone', { scope: 'personal', value: `${CANARY} tone` }));
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
    const fx = await FIXTURES[key](P, call);
    const cross = await call(...fx.cross);
    if (cross.text.includes(CANARY)) problems.push(`LEAK ${key}: work request returned personal content (${cross.status})`);
    if (fx.crossOk && !fx.crossOk(cross)) problems.push(`CROSS ${key}: work request on personal record got ${cross.status}`);
    const own = await call(...fx.own);
    if (fx.ownOk) {
      if (!fx.ownOk(own)) problems.push(`UNREACHED ${key}: own-scope request got ${own.status} ${own.text.slice(0, 160)}`);
    } else if (own.status < 200 || own.status >= 300) problems.push(`UNREACHED ${key}: own-scope request got ${own.status} ${own.text.slice(0, 160)}`);
    else if (fx.reads && !own.text.includes(CANARY)) problems.push(`EMPTY ${key}: own-scope response lacks the seeded canary, so the cross check proves nothing`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('wiring: feature purgers and scheduled jobs are registered with the core', async () => {
  const db = await import('../src/db.js');
  const features = await import('../src/features.js');
  assert.ok(features.PURGERS.length >= 2 && features.PURGERS.every((p) => db.DERIVED_PURGERS.includes(p)), 'purgers wired into db.DERIVED_PURGERS');
  assert.ok(features.SCHEDULED.length >= 2, 'calendar and PM refresh jobs registered');
});

test('derived deletion: deleting a personal item removes the draft built from it', async () => {
  const { call, DB } = setup();
  const P = await seedPersonal(call);
  const d = JSON.parse((await call('POST', '/api/drafts', { scope: 'personal', kind: 'update', facts: 'x', source_refs: [`item:${P.task}`] })).text).draft.id;
  assert.equal((await call('GET', `/api/drafts/${d}?scope=personal`)).status, 200);
  assert.equal((await call('DELETE', `/api/items/${P.task}?scope=personal`)).status, 200);
  assert.equal((await call('GET', `/api/drafts/${d}?scope=personal`)).status, 404, 'draft citing the deleted item is gone');
  const left = await DB.prepare('SELECT COUNT(*) AS n FROM drafts WHERE source_refs LIKE ?').bind(`%${P.task}%`).first('n');
  assert.equal(left, 0);
});
