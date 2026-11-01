// Cross-app actions (Electrical PM, and Field Hub through PM) for MCP clients and Ask: the owner's separate
// grant (clients, projects, actions) checked on every call, read-before-change, PM's declared fields, request
// ids, and PM's own receipts and refusals passed on as they are. PM is an in-memory stand-in for
// env.PM_COMMANDS_SERVICE.execute that follows docs/CROSS_APP_ACTIONS.md. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from './helpers/d1.mjs';
import { createWorker } from '../src/api.js';
import { authorizeRoute } from '../src/auth.js';
import { execute, requestIdFor, checkFields, ACTIONS, READ_ACTIONS } from '../src/crossapp.js';

const BASE = 'http://127.0.0.1:8911';
const NOW = Date.UTC(2026, 10, 1, 16, 0, 0);
const MCP_ID = { kind: 'service', audience: 'mcp', commonName: 'mcp-client.access' };
const OWNER = { kind: 'owner', email: 'owner@example.invalid', emailMasked: 'o***@example.invalid' };
const ALL = [...ACTIONS];

const SCHEMA = {
  schemaVersion: 1,
  recordTypes: [{
    type: 'rfi',
    fields: [
      { name: 'subject', kind: 'string', required: true, maxLength: 200 },
      { name: 'status', kind: 'enum', values: ['open', 'answered', 'closed'] },
      { name: 'due', kind: 'date' },
      { name: 'number', kind: 'integer', editable: false },
    ],
  }],
  field: { kinds: [{ kind: 'task', fields: [{ name: 'review', kind: 'text' }, { name: 'reply', kind: 'text' }], intents: ['review', 'reply'] }] },
};

// The stand-in: PM's own project allowlist (p1, p2), records with revisions, request-id replay, Field Hub queue.
function fakePm() {
  const calls = [];
  const records = new Map();
  const receipts = new Map();
  const field = new Map([['task:t-100', { kind: 'task', key: 't-100', revision: 7, fields: { scope: 'Pull feeders', review: '' } }]]);
  let next = 1;
  const fail = (code, message, extra = {}) => ({ ok: false, error: { code, message, ...extra } });
  const service = {
    async execute(req) {
      calls.push(structuredClone(req));
      if (!['p1', 'p2'].includes(req.projectId)) return fail('forbidden', 'project not allowed by PM');
      const write = !READ_ACTIONS.includes(req.action);
      if (write) {
        if (!/^[A-Za-z0-9_-]{8,40}$/.test(req.requestId || '')) return fail('invalid', 'requestId required');
        if (receipts.has(req.requestId)) return { ...receipts.get(req.requestId), receipt: { ...receipts.get(req.requestId).receipt, replayed: true } };
      }
      const done = (data, receipt) => {
        const out = { ok: true, data, ...(receipt ? { receipt } : {}) };
        if (write) receipts.set(req.requestId, out);
        return out;
      };
      switch (req.action) {
        case 'project.read': return done({ project: { id: req.projectId, name: 'Sample clinic fit-out' } });
        case 'project.schema': return done(SCHEMA);
        case 'records.list': return done({ records: [...records.values()] });
        case 'record.read': {
          const r = records.get(req.recordId);
          return r ? done({ record: r }) : fail('not_found', 'no such record');
        }
        case 'record.create': {
          const id = `rfi_${next++}`;
          const rec = { id, type: req.body.type, revision: 1, fields: { ...req.body.fields, number: next } };
          records.set(id, rec);
          return done({ record: rec }, { status: 'applied', recordId: id, revision: 1, requestId: req.requestId });
        }
        case 'record.update': {
          const r = records.get(req.recordId);
          if (!r) return fail('not_found', 'no such record');
          if (r.revision !== req.body.expectedRevision) return fail('conflict', 'revision moved on', { status: 409, current: { revision: r.revision } });
          r.fields = { ...r.fields, ...req.body.fields };
          r.revision += 1;
          return done({ record: r }, { status: 'applied', recordId: r.id, revision: r.revision, requestId: req.requestId });
        }
        case 'field.read': {
          const f = field.get(`${req.query.kind}:${req.query.key}`);
          return f ? done({ record: f }) : fail('not_found', 'no such field record');
        }
        case 'field.edit': return done({ operation: { id: 'op_field_0001', state: 'pending' } }, { status: 'pending', operationId: 'op_field_0001', requestId: req.requestId });
        default: return fail('unsupported', `stand-in has no ${req.action}`);
      }
    },
  };
  return { service, calls, records };
}

function setup({ bind = true } = {}) {
  const DB = createTestDb();
  const pm = fakePm();
  const env = { DB, DEV_ALLOW_UNAUTH: '0', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', ...(bind ? { PM_COMMANDS_SERVICE: pm.service } : {}) };
  const as = (identity) => {
    const worker = createWorker({ now: () => NOW, authenticateImpl: async () => ({ ...identity }) });
    return async (method, path, body) => {
      const headers = { 'Content-Type': 'application/json' };
      if (identity.kind !== 'service') headers['X-Requested-With'] = 'XMLHttpRequest';
      const res = await worker.fetch(new Request(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
      const text = await res.text();
      return { status: res.status, data: text ? JSON.parse(text) : null };
    };
  };
  const owner = as(OWNER);
  const mcp = as(MCP_ID);
  let n = 0;
  const rpc = async (method, params) => (await mcp('POST', '/api/mcp', { jsonrpc: '2.0', id: ++n, method, params })).data;
  const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result;
  const names = async () => (await rpc('tools/list', {})).result.tools.map((t) => t.name);
  const crossGrant = (g) => owner('PUT', '/api/connections/crossapp/grant', g);
  return { DB, env, pm, owner, mcp, rpc, call, names, crossGrant, hosGrant: (mode, scopes) => owner('PUT', '/api/connections/mcp/grant', { mode, scopes }) };
}

const pmWrites = (pm) => pm.calls.filter((c) => !READ_ACTIONS.includes(c.action));

test('grant route: owner only, nothing allowed by default, strict validation; AI identities never reach it', async () => {
  const s = setup();
  const st = await s.owner('GET', '/api/connections/crossapp');
  assert.equal(st.status, 200);
  assert.deepEqual([st.data.configured, st.data.grant.clients, st.data.grant.projects, st.data.grant.actions], [true, [], [], []]);
  for (const bad of [
    { clients: ['ask'], projects: ['p1'] },
    { clients: ['root'], projects: ['p1'], actions: [] },
    { clients: ['ask'], projects: ['bad id!'], actions: [] },
    { clients: ['ask'], projects: ['p1'], actions: ['record.delete'] },
    { clients: ['ask', 'ask'], projects: ['p1'], actions: [] },
    { clients: ['ask'], projects: ['p1'], actions: [], actor: 'harrison' },
  ]) assert.equal((await s.crossGrant(bad)).status, 400, JSON.stringify(bad));
  assert.equal((await s.mcp('PUT', '/api/connections/crossapp/grant', { clients: ['mcp'], projects: ['p1'], actions: ALL })).status, 403);
  for (const kind of ['mcp_client', 'ask_ai']) {
    assert.equal(authorizeRoute({ kind }, 'PUT', '/api/connections/crossapp/grant'), false);
    assert.equal(authorizeRoute({ kind }, 'GET', '/api/connections/crossapp'), false);
  }
  const saved = await s.crossGrant({ clients: ['mcp'], projects: ['p1'], actions: ['record.read', 'project.read'] });
  assert.deepEqual(saved.data.grant.actions, ['project.read', 'record.read'], 'stored in canonical order');
});

test('MCP Full + cross grant: create in PM, read it back, a stale revision is refused before PM is asked, an update applies once with its request id', async () => {
  const s = setup();
  await s.hosGrant('full', ['work']);
  assert.ok(!(await s.names()).some((n) => n.startsWith('pm_')), 'nothing listed before the cross-app grant');
  await s.crossGrant({ clients: ['mcp'], projects: ['p1'], actions: ALL });
  const listed = await s.names();
  for (const n of ['pm_get_schema', 'pm_create_record', 'pm_update_record', 'field_edit_record']) assert.ok(listed.includes(n), n);

  // Undeclared or missing fields never reach PM.
  for (const [fields, why] of [[{ subject: 'Panel LP-2 location', color: 'red' }, /unknown field color/], [{ status: 'open' }, /missing required field subject/], [{ subject: 'x', due: 'Friday' }, /must be a date/]]) {
    const r = await s.call('pm_create_record', { project_id: 'p1', type: 'rfi', fields });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, why);
  }
  assert.equal(pmWrites(s.pm).length, 0);

  const made = await s.call('pm_create_record', { project_id: 'p1', type: 'rfi', fields: { subject: 'Panel LP-2 location', status: 'open' } });
  assert.equal(made.isError, false, made.content[0].text);
  const id = made.structuredContent.result.record.id;
  assert.equal(made.structuredContent.receipt.status, 'applied');
  assert.match(made.structuredContent.request_id, /^hos_[0-9a-f]{32}$/);
  const write = pmWrites(s.pm)[0];
  assert.deepEqual(Object.keys(write).sort(), ['action', 'body', 'projectId', 'requestId'], 'no actor or allowlist is sent: PM config decides those');

  const read = await s.call('pm_get_record', { project_id: 'p1', record_id: id });
  assert.equal(read.structuredContent.result.record.revision, 1);
  // Stale revision: Harrison OS reads the record itself and stops before any update reaches PM.
  const before = s.pm.calls.length;
  const stale = await s.call('pm_update_record', { project_id: 'p1', record_id: id, expected_revision: 0, fields: { status: 'answered' } });
  assert.equal(stale.isError, true);
  assert.match(stale.content[0].text, /changed since you read it/);
  assert.deepEqual(s.pm.calls.slice(before).map((c) => c.action), ['record.read']);
  // A non-editable field is refused.
  assert.match((await s.call('pm_update_record', { project_id: 'p1', record_id: id, expected_revision: 1, fields: { number: 9 } })).content[0].text, /cannot be changed/);

  const upd = await s.call('pm_update_record', { project_id: 'p1', record_id: id, expected_revision: 1, fields: { status: 'answered' } });
  assert.equal(upd.isError, false, upd.content[0].text);
  assert.equal(upd.structuredContent.result.record.revision, 2);
  const sent = pmWrites(s.pm).at(-1);
  assert.deepEqual(sent.body, { expectedRevision: 1, fields: { status: 'answered' } });
  // A client retry after a lost answer sends the same request id with the revision it first sent (1, now 2):
  // Harrison OS does not call that stale, and PM replays the stored result instead of applying it again.
  const retry = await s.call('pm_update_record', { project_id: 'p1', record_id: id, expected_revision: 1, fields: { status: 'answered' }, request_id: sent.requestId });
  assert.equal(retry.isError, false, retry.content[0].text);
  assert.equal(retry.structuredContent.receipt.replayed, true);
  assert.equal(s.pm.records.get(id).revision, 2, 'applied once');

  // The audit names the PM record; the Harrison OS copy of company projects is never touched.
  const audit = (await s.DB.prepare("SELECT detail FROM events WHERE kind = 'mcp_tool'").all()).results.map((e) => JSON.parse(e.detail)).filter((d) => d.tool === 'pm_create_record' && d.ok);
  assert.deepEqual(audit[0].ids, [id]);
  assert.deepEqual(audit[0].change_ids, []);
  assert.equal(Number((await s.DB.prepare('SELECT COUNT(*) AS n FROM pm_records').first()).n), 0);
});

test("the owner's limits hold on every call: project, action, client, revoke, Read only, and PM's own refusals pass through", async () => {
  const s = setup();
  await s.hosGrant('full', ['work']);
  await s.crossGrant({ clients: ['mcp'], projects: ['p1'], actions: ['project.read', 'record.read', 'record.create'] });
  const n0 = s.pm.calls.length;
  assert.match((await s.call('pm_get_project', { project_id: 'p2' })).content[0].text, /not in the projects Harrison allowed/);
  assert.equal(s.pm.calls.length, n0, 'refused before PM is asked');
  const upd = await s.call('pm_update_record', { project_id: 'p1', record_id: 'rfi_1', expected_revision: 1, fields: { status: 'open' } });
  assert.match(upd.content[0].text, /has not allowed record.update/);
  assert.ok(!(await s.names()).includes('pm_update_record'), 'an action not granted is not listed');
  // PM's own allowlist is separate: a project Harrison allowed but PM does not is PM's refusal, passed on.
  await s.crossGrant({ clients: ['mcp'], projects: ['p1', 'p9'], actions: ['project.read'] });
  assert.match((await s.call('pm_get_project', { project_id: 'p9' })).content[0].text, /Electrical PM answered forbidden to project.read/);
  // Only Ask allowed: the MCP client is refused and sees no PM tools.
  await s.crossGrant({ clients: ['ask'], projects: ['p1'], actions: ALL });
  assert.match((await s.call('pm_get_project', { project_id: 'p1' })).content[0].text, /has not allowed this AI client/);
  assert.ok(!(await s.names()).some((n) => n.startsWith('pm_')));
  // MCP Read only: reads work, writes are refused by the Harrison OS grant even with a cross-app write grant.
  await s.crossGrant({ clients: ['mcp'], projects: ['p1'], actions: ALL });
  await s.hosGrant('read', ['work']);
  assert.equal((await s.call('pm_get_project', { project_id: 'p1' })).isError, false);
  assert.match((await s.call('pm_create_record', { project_id: 'p1', type: 'rfi', fields: { subject: 'x' } })).content[0].text, /read only/);
  // Personal-only grant: Electrical PM is Work.
  await s.hosGrant('full', ['personal']);
  assert.match((await s.call('pm_get_project', { project_id: 'p1' })).content[0].text, /may not use the work scope/);
  // Revoked: the very next call is refused.
  await s.hosGrant('full', ['work']);
  await s.crossGrant({ clients: [], projects: [], actions: [] });
  assert.match((await s.call('pm_get_project', { project_id: 'p1' })).content[0].text, /has not allowed this AI client/);
});

test('Field Hub through PM: the record is read first, intents come from PM, and a pending receipt is reported as pending', async () => {
  const s = setup();
  await s.hosGrant('full', ['work']);
  await s.crossGrant({ clients: ['mcp'], projects: ['p1'], actions: ALL });
  const bad = await s.call('field_edit_record', { project_id: 'p1', kind: 'task', key: 't-100', expected_revision: 7, fields: { review: 'Looks good' }, intent: 'assign' });
  assert.match(bad.content[0].text, /intent must be one of review, reply/);
  const r = await s.call('field_edit_record', { project_id: 'p1', kind: 'task', key: 't-100', expected_revision: 7, fields: { review: 'Looks good' }, intent: 'review' });
  assert.equal(r.isError, false, r.content[0].text);
  assert.equal(r.structuredContent.app, 'field');
  assert.equal(r.structuredContent.receipt.status, 'pending');
  const edit = pmWrites(s.pm).at(-1);
  assert.deepEqual(edit.body, { kind: 'task', key: 't-100', expectedRevision: 7, fields: { review: 'Looks good' }, intent: 'review' });
  assert.ok(s.pm.calls.findIndex((c) => c.action === 'field.read') < s.pm.calls.findIndex((c) => c.action === 'field.edit'));
});

test('no PM command connection: no pm_* or field_* tool exists, whatever the grants say', async () => {
  const s = setup({ bind: false });
  await s.hosGrant('full', ['work']);
  await s.crossGrant({ clients: ['mcp'], projects: ['p1'], actions: ALL });
  assert.ok(!(await s.names()).some((n) => /^(pm|field)_/.test(n)));
  assert.equal((await s.rpc('tools/call', { name: 'pm_get_project', arguments: { project_id: 'p1' } })).error.code, -32602);
  assert.equal((await s.owner('GET', '/api/connections/crossapp')).data.configured, false);
});

test('execute(): a timeout or a throw is never "done"; a write says the outcome is unknown and how to retry safely; odd answers are refused', async () => {
  const hang = { PM_COMMANDS_SERVICE: { execute: () => new Promise(() => {}) } };
  const t = await execute(hang, { action: 'record.update', projectId: 'p1', requestId: 'hos_abcdef12' }, { timeoutMs: 20, write: true });
  assert.deepEqual([t.ok, t.code, t.outcome_unknown], [false, 'timeout', true]);
  assert.match(t.message, /retry with request_id hos_abcdef12/);
  const boom = await execute({ PM_COMMANDS_SERVICE: { execute: () => { throw new Error('x'); } } }, { action: 'record.read', projectId: 'p1' });
  assert.equal(boom.code, 'unavailable');
  assert.equal((await execute({ PM_COMMANDS_SERVICE: { execute: async () => 'done!' } }, { action: 'record.read', projectId: 'p1' })).code, 'bad_answer');
  // Request ids: the caller's when valid; otherwise stable for the same request within a minute, different otherwise.
  const base = { actor: 'ask_ai', action: 'record.update', projectId: 'p1', recordId: 'r1', body: { b: 1, a: 2 }, nowMs: NOW };
  assert.equal(await requestIdFor('given_123', base), 'given_123');
  assert.equal(await requestIdFor(undefined, base), await requestIdFor(undefined, { ...base, body: { a: 2, b: 1 } }));
  assert.notEqual(await requestIdFor(undefined, base), await requestIdFor(undefined, { ...base, nowMs: NOW + 60000 }));
  assert.equal(checkFields(null, { a: 1 }), 'Electrical PM did not describe these fields, so Harrison OS will not guess them.');
});

test('Ask Full (Work) with the cross-app grant: it creates an Electrical PM record and the answer lists PM\'s real id and receipt', async () => {
  const s = setup();
  s.env.AI_API_KEY = 'sk-test-not-real';
  s.env.AI_WEB_TOOLS = 'off';
  await s.owner('PUT', '/api/ai/consent', { scope: 'work', allowed: true });
  await s.owner('PUT', '/api/ai/actions', { mode: 'full', scopes: ['work'] });
  const msg = (content, stop_reason) => ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason, content });
  const run = async (script) => {
    const calls = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (_u, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      const step = script[Math.min(calls.length - 1, script.length - 1)];
      return new Response(JSON.stringify(typeof step === 'function' ? step(body) : step), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      return { calls, answer: (await s.owner('POST', '/api/ask', { scope: 'work', question: 'Open an RFI in p1 about the LP-2 panel location.' })).data.answer };
    } finally {
      globalThis.fetch = orig;
    }
  };
  // Without the cross-app grant, Ask is offered no PM tools.
  const off = await run([msg([{ type: 'text', text: 'I cannot reach Electrical PM.' }], 'end_turn')]);
  assert.ok(!off.calls[0].tools.some((t) => t.name.startsWith('pm_')));
  await s.crossGrant({ clients: ['ask'], projects: ['p1'], actions: ALL });
  const on = await run([
    msg([{ type: 'tool_use', id: 'tu1', name: 'pm_create_record', input: { project_id: 'p1', type: 'rfi', fields: { subject: 'LP-2 panel location', status: 'open' } } }], 'tool_use'),
    msg([{ type: 'text', text: 'Opened the RFI in Electrical PM.' }], 'end_turn'),
  ]);
  assert.match(on.calls[0].system, /real Electrical PM app/);
  assert.match(on.calls[0].system, /\(p1\)/);
  const a = on.answer.actions[0];
  assert.deepEqual([a.tool, a.app, a.ok, a.scope], ['pm_create_record', 'pm', true, 'work']);
  assert.deepEqual(a.ids, [[...s.pm.records.keys()][0]]);
  assert.equal(a.receipt.status, 'applied');
  assert.match(a.request_id, /^hos_/);
  const ev = (await s.DB.prepare("SELECT detail FROM events WHERE kind = 'ask_tool'").all()).results.map((e) => JSON.parse(e.detail));
  assert.deepEqual(ev.map((e) => [e.actor, e.tool, e.ok]), [['ask_ai', 'pm_create_record', true]]);
});
