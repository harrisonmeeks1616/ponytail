// Cross-app actions (Electrical PM, and Field Hub through PM) for MCP clients and Ask, against the confirmed
// contract (docs/CROSS_APP_ACTIONS.md): the owner's separate grant (clients, projects, actions, includeSensitive)
// checked on every call; metadata-declared keys only; whole-section updates merged from PM's complete record so
// nothing (secure values included) is lost; financial types and secure fields hidden unless allowed; request ids;
// PM's receipts, conflicts and refusals passed on; one fenced copy refresh after a saved change. PM is an in-memory
// stand-in for env.PM_COMMANDS_SERVICE.execute. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from './helpers/d1.mjs';
import { createWorker } from '../src/api.js';
import { authorizeRoute } from '../src/auth.js';
import { sampleDigest, refreshHttpSource } from '../src/pm.js';
import { execute, requestIdFor, mergeSections, ACTIONS, READ_ACTIONS } from '../src/crossapp.js';

const BASE = 'http://127.0.0.1:8911';
const NOW = Date.UTC(2026, 10, 1, 16, 0, 0);
const MCP_ID = { kind: 'service', audience: 'mcp', commonName: 'mcp-client.access' };
const OWNER = { kind: 'owner', email: 'owner@example.invalid', emailMasked: 'o***@example.invalid' };
const ALL = [...ACTIONS];
const SECRET_NOTE = 'SECRET-NOTE-4471';

const field = (key, kind, extra = {}) => ({ key, kind, required: false, secure: false, ...extra });
const META = {
  metadataVersion: 'm1',
  valueForms: { text: 'text', longtext: 'text', date: 'date', choice: 'option', money: 'number' },
  recordTypes: [
    {
      id: 'rfi', label: 'RFI', statuses: ['open', 'answered', 'closed'], defaultStatus: 'open', core: true,
      topLevel: [field('title', 'text', { required: true }), field('priority', 'choice', { options: ['low', 'normal', 'high', 'urgent'] }), field('dueDate', 'date'), field('internalNotes', 'longtext', { secure: true })],
      sections: {
        data: [field('question', 'longtext', { required: true }), field('discipline', 'choice', { options: ['electrical', 'mechanical'] })],
        financial: [field('costImpact', 'money', { secure: true })],
        internalData: [field('reviewer', 'text'), field('margin', 'money', { secure: true })],
      },
    },
    { id: 'invoice', label: 'Invoice', statuses: ['draft', 'sent'], defaultStatus: 'draft', core: false, recordVisibility: 'financial', topLevel: [field('title', 'text', { required: true })], sections: { financial: [field('amount', 'money', { required: true, secure: true })] } },
  ],
  field: { kinds: [
    { kind: 'tasks', changeKeys: ['id', 'scope', 'floor', 'area', 'crew', 'crewId', 'date', 'reply', 'followUp', 'review', 'items', 'send'] },
    { kind: 'reports', changeKeys: ['pmReview'] },
    { kind: 'shifts', changeKeys: ['who', 'in', 'out'] },
  ] },
};

// The real registry has 33 types; 31 fillers with 40 fields each make the full schema too large for one answer,
// as it was against the native PM bundle.
for (let i = 0; i < 31; i++) {
  META.recordTypes.push({ id: `type${i}`, label: `Type ${i}`, statuses: ['open', 'closed'], defaultStatus: 'open', core: false,
    topLevel: [field('title', 'text', { required: true })], sections: { data: Array.from({ length: 40 }, (_, j) => field(`field${j}`, 'longtext')) } });
}

// The stand-in PM: its own project allowlist (p1, p2), full owner records, whole-section replace, request-id
// replay and changed-request refusal, conflicts with the full current DTO, Field Hub snapshots and a queue.
function fakePm() {
  const calls = [];
  const records = new Map([
    ['rfi_1', { id: 'rfi_1', type: 'rfi', revision: 3, status: 'open', archived: false, title: 'Panel LP-2 location', priority: 'normal', internalNotes: SECRET_NOTE,
      data: { question: 'Where does LP-2 go?', discipline: 'electrical', legacyKey: 'keep me' }, financial: { costImpact: 1200 }, internalData: { reviewer: 'Sam', margin: 0.12 } }],
    ['inv_1', { id: 'inv_1', type: 'invoice', revision: 1, status: 'draft', archived: false, title: 'Invoice 7', financial: { amount: 9800 } }],
  ]);
  const receipts = new Map();
  const tasks = new Map([['T-100', { rev: 7, record: { uid: 'T-100', scope: 'Pull feeders', review: '' } }]]);
  const fail = (code, message, extra = {}) => ({ ok: false, error: { code, message, ...extra } });
  const st = { calls, records, bumpBeforeUpdate: false };
  st.service = {
    async execute(req) {
      calls.push(structuredClone(req));
      if (!['p1', 'p2'].includes(req.projectId)) return fail('forbidden', 'project not allowed by PM');
      const write = !READ_ACTIONS.includes(req.action);
      if (write) {
        if (!/^[A-Za-z0-9_-]{8,40}$/.test(req.requestId || '')) return fail('invalid', 'requestId required');
        const seen = receipts.get(req.requestId);
        const sig = JSON.stringify([req.action, req.recordId, req.operationId, req.body]);
        if (seen) return seen.sig === sig ? { ...seen.out, receipt: { ...seen.out.receipt, replayed: true } } : fail('request_mismatch', 'requestId reused with a different request');
        st.sig = sig;
      }
      const done = (data, receipt) => {
        const out = { ok: true, data, ...(receipt ? { receipt } : {}) };
        if (write) receipts.set(req.requestId, { sig: st.sig, out: structuredClone(out) });
        return out;
      };
      const rec = req.recordId ? records.get(req.recordId) : null;
      switch (req.action) {
        case 'project.read': return done({
          project: { id: req.projectId, name: 'Sample clinic fit-out', settings: { site: { address: '1 Sample Way', start: '2026-09-01', deadline: '2027-03-01' }, phaseProgress: { rough: 40 } } },
          contacts: [{ id: 'c1', name: 'Jordan Example', role: 'GC', email: 'jordan@example.invalid', phone: '555-0100', notes: 'PRIVATE-CONTACT-NOTE' }],
          lookups: { contacts: [{ id: 'c1', name: 'Jordan Example', email: 'jordan@example.invalid' }], phases: ['rough', 'trim'] },
        });
        case 'metadata.read': {
          // query.types (CSV): the exact schema of just those types; the version stays the full registry's.
          const want = req.query && req.query.types ? req.query.types.split(',') : null;
          const m = structuredClone(META);
          if (want) m.recordTypes = m.recordTypes.filter((t) => want.includes(t.id));
          return done(m);
        }
        case 'records.list': {
          const types = req.query && req.query.types ? req.query.types.split(',') : null;
          const list = [...records.values()].filter((r) => !types || types.includes(r.type));
          return done({ records: structuredClone(list), total: list.length, limit: req.query.limit, offset: req.query.offset || 0 });
        }
        case 'record.read': return rec ? done({ record: structuredClone(rec) }) : fail('not_found', 'no such record');
        case 'record.create': {
          const id = `rfi_${records.size + 1}`;
          const { type, status, data, financial, internalData, ...top } = req.body;
          const r = { id, type, revision: 1, status: status || 'open', archived: false, ...top, ...(data ? { data } : {}), ...(financial ? { financial } : {}), ...(internalData ? { internalData } : {}) };
          records.set(id, r);
          return done({ record: structuredClone(r) }, { status: 'saved', recordId: id, revision: 1, requestId: req.requestId });
        }
        case 'record.update': case 'record.archive': case 'record.restore': {
          if (!rec) return fail('not_found', 'no such record');
          if (st.bumpBeforeUpdate) { rec.revision += 1; st.bumpBeforeUpdate = false; }
          if (rec.revision !== req.body.expectedRevision) return fail('conflict', 'revision moved on', { status: 409, current: structuredClone(rec) });
          const { expectedRevision, ...rest } = req.body;
          if (req.action === 'record.update') Object.assign(rec, rest); // a section given replaces that whole section
          else rec.archived = req.action === 'record.archive';
          rec.revision += 1;
          return done({ record: structuredClone(rec) }, { status: 'saved', recordId: rec.id, revision: rec.revision, requestId: req.requestId });
        }
        case 'field.read': {
          const t = req.query.kind === 'tasks' ? tasks.get(req.query.key) : null;
          return done(t ? { kind: req.query.kind, key: req.query.key, rev: t.rev, record: structuredClone(t.record), base: structuredClone(t.record) } : { kind: req.query.kind, key: req.query.key, rev: 0, record: null, base: null });
        }
        case 'field.edit': {
          const t = tasks.get(req.body.key);
          if ((t ? t.rev : 0) !== req.body.expectedRev) return fail('conflict', 'Field Hub rev moved on', { status: 409, current: { rev: t ? t.rev : 0 } });
          return done({ operation: { operationId: 'op_field_0001', status: 'pending' } }, { status: 'pending', operationId: 'op_field_0001', requestId: req.requestId });
        }
        default: return fail('unsupported', `stand-in has no ${req.action}`);
      }
    },
  };
  return st;
}

function setup({ bind = true, digest = false } = {}) {
  const DB = createTestDb();
  const pm = fakePm();
  const env = { DB, DEV_ALLOW_UNAUTH: '0', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', ...(bind ? { PM_COMMANDS_SERVICE: pm.service } : {}), ...(digest ? { PM_DIGEST_SERVICE: { getDigest: async () => sampleDigest(Date.now()) } } : {}) };
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
  const hosGrant = (mode, scopes) => owner('PUT', '/api/connections/mcp/grant', { mode, scopes });
  const full = async (extra = {}) => {
    await hosGrant('full', ['work']);
    await crossGrant({ clients: ['mcp'], projects: ['p1'], actions: ALL, ...extra });
  };
  return { DB, env, pm, owner, mcp, rpc, call, names, crossGrant, hosGrant, full };
}

const pmWrites = (pm) => pm.calls.filter((c) => !READ_ACTIONS.includes(c.action));
const text = (r) => r.content[0].text;

test('grant route: owner only, nothing allowed by default, strict; project choices are names from the approved copy', async () => {
  const s = setup({ digest: true });
  await refreshHttpSource(s.env, Date.now()); // the approved digest copy, as the cron would load it
  const st = await s.owner('GET', '/api/connections/crossapp');
  assert.equal(st.status, 200);
  assert.deepEqual([st.data.configured, st.data.grant.clients, st.data.grant.projects, st.data.grant.actions, st.data.grant.includeSensitive], [true, [], [], [], false]);
  assert.ok(st.data.projects.length >= 1 && st.data.projects.every((p) => typeof p.id === 'string' && typeof p.name === 'string'), JSON.stringify(st.data.projects));
  for (const bad of [
    { clients: ['ask'], projects: ['p1'] },
    { clients: ['root'], projects: ['p1'], actions: [] },
    { clients: ['ask'], projects: ['bad id!'], actions: [] },
    { clients: ['ask'], projects: ['p1'], actions: ['record.delete'] },
    { clients: ['ask'], projects: ['p1'], actions: [], includeSensitive: 'yes' },
    { clients: ['ask'], projects: ['p1'], actions: [], actor: 'harrison' },
  ]) assert.equal((await s.crossGrant(bad)).status, 400, JSON.stringify(bad));
  assert.equal((await s.mcp('PUT', '/api/connections/crossapp/grant', { clients: ['mcp'], projects: ['p1'], actions: ALL })).status, 403);
  for (const kind of ['mcp_client', 'ask_ai']) {
    assert.equal(authorizeRoute({ kind }, 'PUT', '/api/connections/crossapp/grant'), false);
    assert.equal(authorizeRoute({ kind }, 'GET', '/api/connections/crossapp'), false);
  }
  const saved = await s.crossGrant({ clients: ['mcp'], projects: ['gone-project'], actions: ['record.read', 'project.read'] });
  assert.deepEqual(saved.data.grant.actions, ['project.read', 'record.read'], 'stored in canonical order');
  assert.deepEqual(saved.data.projects.at(-1), { id: 'gone-project', name: null }, 'a granted id not in the copy stays listed so it can be unticked');
});

test('without sensitive data: financial types and secure fields never reach the model, in metadata, lists, reads or conflicts', async () => {
  const s = setup();
  await s.full();
  const meta = (await s.call('pm_get_metadata', { project_id: 'p1', types: ['rfi', 'invoice'] })).structuredContent.result;
  assert.deepEqual(meta.recordTypes.map((t) => t.id), ['rfi'], 'the financial type is withheld even when asked for');
  assert.ok(!(await s.call('pm_get_metadata', { project_id: 'p1' })).structuredContent.result.recordTypes.some((t) => t.id === 'invoice'));
  const rfi = meta.recordTypes[0];
  assert.ok(!rfi.topLevel.some((f) => f.key === 'internalNotes'));
  assert.deepEqual(rfi.sections.financial, []);
  assert.equal(meta.withheld.financialTypes, 1);
  const list = await s.call('pm_list_records', { project_id: 'p1' });
  assert.ok(!s.pm.calls.at(-1).query.types.split(',').includes('invoice') && s.pm.calls.at(-1).query.types.split(',').includes('rfi'), 'PM is asked only for the types AI may see');
  assert.deepEqual(list.structuredContent.result.records.map((r) => r.id), ['rfi_1']);
  assert.match((await s.call('pm_list_records', { project_id: 'p1', types: ['invoice'] })).content[0].text, /types must be among rfi, type0/);
  const rec = (await s.call('pm_get_record', { project_id: 'p1', record_id: 'rfi_1' })).structuredContent.result.record;
  assert.equal(rec.internalNotes, undefined);
  assert.equal(rec.financial.costImpact, undefined);
  assert.equal(rec.internalData.margin, undefined);
  assert.deepEqual(rec.withheld.sort(), ['financial.costImpact', 'internalData.margin', 'internalNotes']);
  assert.equal(rec.data.legacyKey, 'keep me');
  assert.match(text(await s.call('pm_get_record', { project_id: 'p1', record_id: 'inv_1' })), /financial type/);
  // A conflict's full current DTO is redacted the same way before the model sees it.
  s.pm.bumpBeforeUpdate = true;
  const conflict = await s.call('pm_update_record', { project_id: 'p1', record_id: 'rfi_1', expected_revision: 3, top_level: { priority: 'high' } });
  assert.equal(conflict.isError, true);
  assert.match(text(conflict), /Electrical PM answered conflict \(409\)/);
  assert.match(text(conflict), /"revision":4/);
  for (const secret of [SECRET_NOTE, '1200', '0.12']) assert.ok(!text(conflict).includes(secret), `conflict leaked ${secret}`);
  assert.ok(!JSON.stringify((await s.DB.prepare('SELECT detail FROM events').all()).results).includes(SECRET_NOTE));
});

test('writes: declared keys only, whole-section merge keeps every value (secure ones too), stale refused before PM, retry replays, changed retry refused', async () => {
  const s = setup();
  await s.full();
  for (const [args, why] of [
    [{ type: 'rfi', top_level: { title: 'x', color: 'red' }, data: { question: 'q' } }, /unknown top_level key color/],
    [{ type: 'rfi', top_level: { title: 'x' } }, /missing required field question/],
    [{ type: 'rfi', top_level: { title: 'x', internalNotes: 'n' }, data: { question: 'q' } }, /internalNotes is a secure field/],
    [{ type: 'rfi', status: 'void', top_level: { title: 'x' }, data: { question: 'q' } }, /status must be one of: open, answered, closed/],
    [{ type: 'rfi', top_level: { title: 'x', priority: 'asap' }, data: { question: 'q' } }, /must be one of: low, normal, high, urgent/],
    [{ type: 'invoice', top_level: { title: 'x' }, financial: { amount: 1 } }, /no record type invoice that AI may use/],
  ]) {
    const r = await s.call('pm_create_record', { project_id: 'p1', ...args });
    assert.equal(r.isError, true);
    assert.match(text(r), why);
  }
  assert.equal(pmWrites(s.pm).length, 0, 'nothing refused here reached PM');
  const made = await s.call('pm_create_record', { project_id: 'p1', type: 'rfi', status: 'open', top_level: { title: 'Conduit route', priority: 'high' }, data: { question: 'Which route?' } });
  assert.equal(made.isError, false, text(made));
  assert.deepEqual(pmWrites(s.pm)[0].body, { type: 'rfi', status: 'open', title: 'Conduit route', priority: 'high', data: { question: 'Which route?' } });
  assert.deepEqual(Object.keys(pmWrites(s.pm)[0]).sort(), ['action', 'body', 'projectId', 'requestId'], 'no actor or allowlist is sent');
  assert.equal(made.structuredContent.receipt.status, 'saved');

  // Stale: Harrison OS reads the record itself and stops before any update reaches PM.
  const before = s.pm.calls.length;
  assert.match(text(await s.call('pm_update_record', { project_id: 'p1', record_id: 'rfi_1', expected_revision: 2, data: { discipline: 'mechanical' } })), /changed since you read it/);
  assert.deepEqual(s.pm.calls.slice(before).map((c) => [c.action, c.query && c.query.types]), [['record.read', undefined], ['metadata.read', 'rfi']], 'the record first, then only its own type');
  assert.match(text(await s.call('pm_update_record', { project_id: 'p1', record_id: 'rfi_1', expected_revision: 3, internalData: { margin: 0.5 } })), /margin is a secure field/);

  // A data change and an internalData change: each touched section goes whole, with every current value kept.
  const upd = await s.call('pm_update_record', { project_id: 'p1', record_id: 'rfi_1', expected_revision: 3, data: { discipline: 'mechanical' }, internalData: { reviewer: 'Ana' } });
  assert.equal(upd.isError, false, text(upd));
  const sent = pmWrites(s.pm).at(-1);
  assert.deepEqual(sent.body, {
    expectedRevision: 3,
    data: { question: 'Where does LP-2 go?', discipline: 'mechanical', legacyKey: 'keep me' },
    internalData: { reviewer: 'Ana', margin: 0.12 },
  }, 'financial was not touched, so it is not sent; the secure margin the model never saw is kept');
  const stored = s.pm.records.get('rfi_1');
  assert.deepEqual([stored.financial.costImpact, stored.internalData.margin, stored.internalNotes, stored.data.legacyKey], [1200, 0.12, SECRET_NOTE, 'keep me']);
  assert.equal(upd.structuredContent.result.record.internalData.margin, undefined, 'the answer is redacted too');

  // A lost-answer retry: same request_id with its first revision (3, now 4) is not called stale; PM replays it.
  const retry = await s.call('pm_update_record', { project_id: 'p1', record_id: 'rfi_1', expected_revision: 3, data: { discipline: 'mechanical' }, internalData: { reviewer: 'Ana' }, request_id: sent.requestId });
  assert.equal(retry.isError, false, text(retry));
  assert.equal(retry.structuredContent.receipt.replayed, true);
  assert.equal(s.pm.records.get('rfi_1').revision, 4, 'applied once');
  // The same request_id with a different change is PM's refusal, passed on, and nothing changes.
  const changed = await s.call('pm_update_record', { project_id: 'p1', record_id: 'rfi_1', expected_revision: 3, data: { discipline: 'electrical' }, request_id: sent.requestId });
  assert.match(text(changed), /Electrical PM answered request_mismatch/);
  assert.equal(s.pm.records.get('rfi_1').data.discipline, 'mechanical');
});

test('with includeSensitive: financial types and secure fields are visible and writable through the same checks', async () => {
  const s = setup();
  await s.full({ includeSensitive: true });
  const meta = (await s.call('pm_get_metadata', { project_id: 'p1', types: ['rfi', 'invoice'] })).structuredContent.result;
  assert.deepEqual(meta.recordTypes.map((t) => t.id), ['rfi', 'invoice']);
  assert.ok((await s.call('pm_get_metadata', { project_id: 'p1' })).structuredContent.result.recordTypes.some((t) => t.id === 'invoice'));
  assert.equal((await s.call('pm_get_record', { project_id: 'p1', record_id: 'rfi_1' })).structuredContent.result.record.internalNotes, SECRET_NOTE);
  const r = await s.call('pm_update_record', { project_id: 'p1', record_id: 'rfi_1', expected_revision: 3, financial: { costImpact: 1500 } });
  assert.equal(r.isError, false, text(r));
  assert.deepEqual(pmWrites(s.pm).at(-1).body, { expectedRevision: 3, financial: { costImpact: 1500 } });
  assert.match(text(await s.call('pm_update_record', { project_id: 'p1', record_id: 'rfi_1', expected_revision: 4, financial: { costImpact: 'lots' } })), /costImpact must be a number/);
  // Turning it off applies to the very next call.
  await s.crossGrant({ clients: ['mcp'], projects: ['p1'], actions: ALL, includeSensitive: false });
  assert.equal((await s.call('pm_get_record', { project_id: 'p1', record_id: 'rfi_1' })).structuredContent.result.record.internalNotes, undefined);
});

test("the owner's limits hold on every call: project, action, client, revoke, Read only, Work, and PM's own refusals", async () => {
  const s = setup();
  await s.hosGrant('full', ['work']);
  await s.crossGrant({ clients: ['mcp'], projects: ['p1'], actions: ['project.read', 'metadata.read', 'record.read', 'record.create'] });
  const n0 = s.pm.calls.length;
  assert.match(text(await s.call('pm_get_project', { project_id: 'p2' })), /not in the projects Harrison allowed/);
  assert.equal(s.pm.calls.length, n0, 'refused before PM is asked');
  assert.match(text(await s.call('pm_update_record', { project_id: 'p1', record_id: 'rfi_1', expected_revision: 3, data: { discipline: 'mechanical' } })), /has not allowed record.update/);
  assert.ok(!(await s.names()).includes('pm_update_record'), 'an action not granted is not listed');
  await s.crossGrant({ clients: ['mcp'], projects: ['p1', 'p9'], actions: ['project.read'] });
  assert.match(text(await s.call('pm_get_project', { project_id: 'p9' })), /Electrical PM answered forbidden to project.read/);
  await s.crossGrant({ clients: ['ask'], projects: ['p1'], actions: ALL });
  assert.match(text(await s.call('pm_get_project', { project_id: 'p1' })), /has not allowed this AI client/);
  assert.ok(!(await s.names()).some((n) => n.startsWith('pm_')));
  await s.crossGrant({ clients: ['mcp'], projects: ['p1'], actions: ALL });
  await s.hosGrant('read', ['work']);
  assert.equal((await s.call('pm_get_project', { project_id: 'p1' })).isError, false);
  assert.match(text(await s.call('pm_create_record', { project_id: 'p1', type: 'rfi', top_level: { title: 'x' }, data: { question: 'q' } })), /read only/);
  await s.hosGrant('full', ['personal']);
  assert.match(text(await s.call('pm_get_project', { project_id: 'p1' })), /may not use the work scope/);
  await s.hosGrant('full', ['work']);
  await s.crossGrant({ clients: [], projects: [], actions: [] });
  assert.match(text(await s.call('pm_get_project', { project_id: 'p1' })), /has not allowed this AI client/);
  assert.equal(pmWrites(s.pm).length, 0);
});

test('Field Hub through PM: declared change keys only, base sent back as read, rev checked, a new task at rev 0, pending is not saved', async () => {
  const s = setup({ digest: true });
  await s.full();
  assert.match(text(await s.call('field_edit_record', { project_id: 'p1', kind: 'reports', key: '2026-11-01', expected_rev: 0, changes: { decisions: [] }, reason: 'PM answer' })), /only pmReview/);
  assert.match(text(await s.call('field_edit_record', { project_id: 'p1', kind: 'tasks', key: 'T-100', expected_rev: 6, changes: { review: 'ok' }, reason: 'Reviewed' })), /rev 7 now, you sent 6/);
  const r = await s.call('field_edit_record', { project_id: 'p1', kind: 'tasks', key: 'T-100', expected_rev: 7, changes: { review: 'Looks good' }, reason: 'Reviewed the pull' });
  assert.equal(r.isError, false, text(r));
  assert.equal(r.structuredContent.receipt.status, 'pending');
  assert.equal(r.structuredContent.copy_refresh, undefined, 'a pending change is not saved, so no copy refresh is claimed');
  assert.deepEqual(pmWrites(s.pm).at(-1).body, { kind: 'tasks', key: 'T-100', expectedRev: 7, base: { uid: 'T-100', scope: 'Pull feeders', review: '' }, changes: { review: 'Looks good' }, reason: 'Reviewed the pull' });
  const fresh = await s.call('field_edit_record', { project_id: 'p1', kind: 'tasks', key: 'T-200', expected_rev: 0, changes: { scope: 'Set panel LP-2', send: true }, reason: 'New task' });
  assert.equal(fresh.isError, false, text(fresh));
  assert.equal(pmWrites(s.pm).at(-1).body.base, null);
  const read = (await s.call('field_get_record', { project_id: 'p1', kind: 'tasks', key: 'T-100' })).structuredContent.result;
  assert.deepEqual(Object.keys(read).sort(), ['key', 'kind', 'record', 'rev']);
});

test('after a saved change Harrison OS refreshes its copy once through the fenced path, and never writes the copy itself', async () => {
  const s = setup({ digest: true });
  await s.full();
  const made = await s.call('pm_create_record', { project_id: 'p1', type: 'rfi', top_level: { title: 'Conduit route' }, data: { question: 'Which route?' } });
  assert.deepEqual(made.structuredContent.copy_refresh, { ok: true, code: 'ok' });
  const evs = (await s.DB.prepare("SELECT detail FROM events WHERE kind = 'pm_refresh'").all()).results;
  assert.equal(evs.length, 1);
  const s2 = setup();
  await s2.full();
  const made2 = await s2.call('pm_create_record', { project_id: 'p1', type: 'rfi', top_level: { title: 'Conduit route' }, data: { question: 'Which route?' } });
  assert.deepEqual(made2.structuredContent.copy_refresh, { ok: false, code: 'not_connected' });
  assert.equal(Number((await s2.DB.prepare('SELECT COUNT(*) AS n FROM pm_records').first()).n), 0, 'the copy is never written by these tools');
});

test('no PM command connection: no pm_* or field_* tool exists, whatever the grants say', async () => {
  const s = setup({ bind: false });
  await s.full();
  assert.ok(!(await s.names()).some((n) => /^(pm|field)_/.test(n)));
  assert.equal((await s.rpc('tools/call', { name: 'pm_get_project', arguments: { project_id: 'p1' } })).error.code, -32602);
  assert.equal((await s.owner('GET', '/api/connections/crossapp')).data.configured, false);
});

test('execute(): a timeout or a throw is never done; a write says the outcome is unknown and how to retry; odd answers refused', async () => {
  const hang = { PM_COMMANDS_SERVICE: { execute: () => new Promise(() => {}) } };
  const t = await execute(hang, { action: 'record.update', projectId: 'p1', requestId: 'hos_abcdef12' }, { timeoutMs: 20, write: true });
  assert.deepEqual([t.ok, t.code, t.outcome_unknown], [false, 'timeout', true]);
  assert.match(t.message, /retry with request_id hos_abcdef12/);
  assert.equal((await execute({ PM_COMMANDS_SERVICE: { execute: () => { throw new Error('x'); } } }, { action: 'record.read', projectId: 'p1' })).code, 'unavailable');
  assert.equal((await execute({ PM_COMMANDS_SERVICE: { execute: async () => 'done!' } }, { action: 'record.read', projectId: 'p1' })).code, 'bad_answer');
  const base = { actor: 'ask_ai', action: 'record.update', projectId: 'p1', recordId: 'r1', body: { b: 1, a: 2 }, nowMs: NOW };
  assert.equal(await requestIdFor('given_123', base), 'given_123');
  assert.equal(await requestIdFor(undefined, base), await requestIdFor(undefined, { ...base, body: { a: 2, b: 1 } }));
  assert.notEqual(await requestIdFor(undefined, base), await requestIdFor(undefined, { ...base, nowMs: NOW + 60000 }));
  assert.deepEqual(mergeSections({ data: { a: 1, b: 2 }, financial: { c: 3 } }, { data: { b: 9 } }), { data: { a: 1, b: 9 } });
});

test("Ask Full (Work) with the cross-app grant: it creates an Electrical PM record and the answer lists PM's real id and receipt", async () => {
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
      calls.push(JSON.parse(init.body));
      const step = script[Math.min(calls.length - 1, script.length - 1)];
      return new Response(JSON.stringify(step), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      return { calls, answer: (await s.owner('POST', '/api/ask', { scope: 'work', question: 'Open an RFI in p1 about the LP-2 panel location.' })).data.answer };
    } finally {
      globalThis.fetch = orig;
    }
  };
  const off = await run([msg([{ type: 'text', text: 'I cannot reach Electrical PM.' }], 'end_turn')]);
  assert.ok(!off.calls[0].tools.some((t) => t.name.startsWith('pm_')));
  await s.crossGrant({ clients: ['ask'], projects: ['p1'], actions: ALL });
  const on = await run([
    msg([{ type: 'tool_use', id: 'tu1', name: 'pm_create_record', input: { project_id: 'p1', type: 'rfi', top_level: { title: 'LP-2 panel location' }, data: { question: 'Where does LP-2 go?' } } }], 'tool_use'),
    msg([{ type: 'text', text: 'Opened the RFI in Electrical PM.' }], 'end_turn'),
  ]);
  assert.match(on.calls[0].system, /real Electrical PM app/);
  assert.match(on.calls[0].system, /project_id p1/);
  const a = on.answer.actions[0];
  assert.deepEqual([a.tool, a.app, a.ok, a.scope], ['pm_create_record', 'pm', true, 'work']);
  assert.deepEqual(a.ids, ['rfi_3']);
  assert.equal(a.receipt.status, 'saved');
  assert.match(a.request_id, /^hos_/);
  const ev = (await s.DB.prepare("SELECT detail FROM events WHERE kind = 'ask_tool'").all()).results.map((e) => JSON.parse(e.detail));
  assert.deepEqual(ev.map((e) => [e.actor, e.tool, e.ok]), [['ask_ai', 'pm_create_record', true]]);
});

test('metadata: the default answer is a compact catalog that fits; one type on request is complete; writes fetch only their type', async () => {
  const s = setup();
  await s.full();
  const full = JSON.stringify(META).length;
  assert.ok(full > 48 * 1024, `the stand-in registry is realistically large (${full} characters)`);
  const cat = await s.call('pm_get_metadata', { project_id: 'p1' });
  assert.equal(cat.isError, false, text(cat));
  const c = cat.structuredContent.result;
  assert.equal(c.recordTypes.length, 32, 'every type except the financial one');
  assert.equal(c.recordTypes.find((t) => t.id === 'type0').fields, 41);
  assert.ok(!('sections' in c.recordTypes[0]), 'no fields in the catalog');
  assert.match(c.note, /types: \["<type id>"\]/);
  assert.match(c.note, /Financial record types and secure fields are not shown/);
  assert.equal(cat.structuredContent.truncated, undefined, 'nothing shortened');
  const one = (await s.call('pm_get_metadata', { project_id: 'p1', types: ['rfi'] })).structuredContent.result;
  assert.deepEqual(one.recordTypes.map((t) => t.id), ['rfi']);
  assert.deepEqual(one.recordTypes[0].sections.data.map((f) => f.key), ['question', 'discipline']);
  assert.equal(s.pm.calls.at(-1).query.types, 'rfi');
  const n = s.pm.calls.length;
  await s.call('pm_create_record', { project_id: 'p1', type: 'rfi', top_level: { title: 'Conduit route' }, data: { question: 'Which route?' } });
  const meta = s.pm.calls.slice(n).filter((x) => x.action === 'metadata.read');
  assert.deepEqual(meta.map((x) => x.query && x.query.types), ['rfi'], 'a create asks only for its own type');
});

test('project.read: contact emails, phones and notes and the site address are left out unless private details are allowed', async () => {
  const s = setup();
  await s.full();
  const off = (await s.call('pm_get_project', { project_id: 'p1' })).structuredContent;
  const t = JSON.stringify(off);
  for (const secret of ['jordan@example.invalid', '555-0100', 'PRIVATE-CONTACT-NOTE', '1 Sample Way']) assert.ok(!t.includes(secret), secret);
  assert.equal(off.result.contacts[0].name, 'Jordan Example');
  assert.equal(off.result.project.settings.site.deadline, '2027-03-01');
  assert.match(off.result.withheld, /Contact emails/);
  await s.crossGrant({ clients: ['mcp'], projects: ['p1'], actions: ALL, includeSensitive: true });
  const on = (await s.call('pm_get_project', { project_id: 'p1' })).structuredContent.result;
  assert.equal(on.contacts[0].email, 'jordan@example.invalid');
  assert.equal(on.project.settings.site.address, '1 Sample Way');
});

test('Field Hub recovery is field_retry_operation, not a resent edit: no request_id on edits, and a lost answer says so', async () => {
  const s = setup();
  await s.full();
  const r = await s.call('field_edit_record', { project_id: 'p1', kind: 'tasks', key: 'T-100', expected_rev: 7, changes: { review: 'ok' }, reason: 'Reviewed', request_id: 'retry_123456' });
  assert.equal(r.isError, true);
  assert.match(text(r), /unknown argument: request_id/);
  const hang = { PM_COMMANDS_SERVICE: { execute: () => new Promise(() => {}) } };
  const t = await execute(hang, { action: 'field.edit', projectId: 'p1', requestId: 'hos_abcdef12' }, { timeoutMs: 20, write: true, retry: 'operation' });
  assert.match(t.message, /field_list_pending and use field_retry_operation/);
  assert.ok(!/retry with request_id/.test(t.message));
  // The same edit again inside the minute, while nothing changed, is the same request id: PM replays it.
  const a = await s.call('field_edit_record', { project_id: 'p1', kind: 'tasks', key: 'T-100', expected_rev: 7, changes: { review: 'ok' }, reason: 'Reviewed' });
  const b = await s.call('field_edit_record', { project_id: 'p1', kind: 'tasks', key: 'T-100', expected_rev: 7, changes: { review: 'ok' }, reason: 'Reviewed' });
  assert.equal(a.structuredContent.request_id, b.structuredContent.request_id);
  assert.equal(b.structuredContent.receipt.replayed, true);
});

test('pm_list_projects: the allowed projects with names from the approved copy, filtered by the current grant, no PM call', async () => {
  const s = setup({ digest: true });
  await refreshHttpSource(s.env, Date.now());
  await s.hosGrant('full', ['work']);
  assert.ok(!(await s.names()).includes('pm_list_projects'), 'not listed before the cross-app grant');
  await s.crossGrant({ clients: ['mcp'], projects: ['SAMPLE-P1', 'gone-project'], actions: ['project.read'] });
  assert.ok((await s.names()).includes('pm_list_projects'));
  const n = s.pm.calls.length;
  const r = await s.call('pm_list_projects', {});
  assert.equal(r.isError, false, text(r));
  assert.deepEqual(r.structuredContent.projects, [{ id: 'SAMPLE-P1', name: 'Sample: Lobby lighting retrofit' }, { id: 'gone-project', name: null }]);
  assert.equal(s.pm.calls.length, n, 'no PM call');
  await s.crossGrant({ clients: ['ask'], projects: ['SAMPLE-P1'], actions: ['project.read'] });
  assert.match(text(await s.call('pm_list_projects', {})), /has not allowed this AI client/, 'revoked for MCP: refused at once');
});

test('Ask: names in the instructions, one copy refresh after the whole loop (also when the AI fails after a write), Full limits', async () => {
  const s = setup({ digest: true });
  await refreshHttpSource(s.env, Date.now());
  s.env.AI_API_KEY = 'sk-test-not-real';
  s.env.AI_WEB_TOOLS = 'off';
  await s.owner('PUT', '/api/ai/consent', { scope: 'work', allowed: true });
  await s.owner('PUT', '/api/ai/actions', { mode: 'full', scopes: ['work'] });
  await s.crossGrant({ clients: ['ask'], projects: ['p1', 'SAMPLE-P1'], actions: ALL });
  const msg = (content, stop_reason) => ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason, content });
  const create = (id, title) => msg([{ type: 'tool_use', id, name: 'pm_create_record', input: { project_id: 'p1', type: 'rfi', top_level: { title }, data: { question: 'Which route?' } } }], 'tool_use');
  const run = async (script) => {
    const calls = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (_u, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      return new Response(JSON.stringify(script[Math.min(calls.length - 1, script.length - 1)]), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      return { calls, answer: (await s.owner('POST', '/api/ask', { scope: 'work', question: 'Open two RFIs in p1.' })).data.answer };
    } finally {
      globalThis.fetch = orig;
    }
  };
  const refreshes = async () => Number((await s.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'pm_refresh'").first()).n);
  const before = await refreshes();
  const ok = await run([create('tu1', 'Route A'), create('tu2', 'Route B'), msg([{ type: 'text', text: 'Opened both.' }], 'end_turn')]);
  assert.match(ok.calls[0].system, /Sample: Lobby lighting retrofit \(project_id SAMPLE-P1\); project_id p1|project_id p1; Sample: Lobby lighting retrofit \(project_id SAMPLE-P1\)/);
  assert.equal(ok.answer.actions.filter((a) => a.ok).length, 2);
  assert.equal(await refreshes(), before + 1, 'two saved writes, one refresh');
  assert.deepEqual(ok.answer.copy_refresh, { ok: true, code: 'ok' });
  const toolText = ok.calls[1].messages.at(-1).content[0].content;
  assert.match(toolText, /"copy_refresh":\{"code":"after_answer"\}/, 'no refresh inside a model step');
  // The AI fails after a saved write: the answer is Not AI, and still lists the change and the refresh.
  const failed = await run([create('tu3', 'Route C'), msg([], 'refusal')]);
  assert.equal(failed.answer.live_ai, false);
  assert.deepEqual(failed.answer.actions.map((a) => [a.tool, a.ok]), [['pm_create_record', true]]);
  assert.equal(failed.answer.copy_refresh.code, 'ok');
  assert.equal(await refreshes(), before + 2);
  // Nothing saved: no refresh at all.
  const none = await run([msg([{ type: 'text', text: 'Nothing to do.' }], 'end_turn')]);
  assert.equal(none.answer.copy_refresh, undefined);
  assert.equal(await refreshes(), before + 2);
});
