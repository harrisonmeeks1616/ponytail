// Review of the cross-app actions (src/crossapp.js, the pm_* / field_* tools in src/mcp.js, Ask's actions list
// and the Connections words). Each test asserts the behaviour the contract asks for and FAILS against the code it
// was written for (commit 2faa979), demonstrating one finding. PM is an in-memory stand-in for
// env.PM_COMMANDS_SERVICE.execute (same pattern as tests/crossapp.test.mjs) with a few switches for the failure
// modes under test. Synthetic data only; nothing leaves the process.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from './helpers/d1.mjs';
import { createWorker } from '../src/api.js';
import { askToolkit } from '../src/mcp.js';
import { ACTIONS, READ_ACTIONS } from '../src/crossapp.js';
import { actionWords } from '../public/views/ask.js';
import { summarize } from '../public/views/connections.js';

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

// The stand-in PM, as in tests/crossapp.test.mjs, plus switches:
// loseAnswer: the next write commits, then its answer is lost (the call throws).
// fieldSaves: field.edit is confirmed by Field Hub at once (receipt saved; rev, record and base move on).
// retryReceipt: what field.retry answers as its receipt (undefined: none at all).
function fakePm() {
  const calls = [];
  const rfi = (id) => ({ id, type: 'rfi', revision: 3, status: 'open', archived: false, title: 'Panel LP-2 location', priority: 'normal', internalNotes: SECRET_NOTE,
    data: { question: 'Where does LP-2 go?', discipline: 'electrical', legacyKey: 'keep me' }, financial: { costImpact: 1200 }, internalData: { reviewer: 'Sam', margin: 0.12 } });
  const records = new Map([
    ['rfi_1', rfi('rfi_1')],
    ['inv_1', { id: 'inv_1', type: 'invoice', revision: 1, status: 'draft', archived: false, title: 'Invoice 7', financial: { amount: 9800 } }],
  ]);
  const receipts = new Map();
  const tasks = new Map([['T-100', { rev: 7, record: { uid: 'T-100', scope: 'Pull feeders', review: '' } }]]);
  const fail = (code, message, extra = {}) => ({ ok: false, error: { code, message, ...extra } });
  const st = { calls, records, tasks, rfi, bumpBeforeUpdate: false, loseAnswer: false, fieldSaves: false, retryReceipt: undefined };
  const answer = (req, out) => {
    if (st.loseAnswer && !READ_ACTIONS.includes(req.action)) {
      st.loseAnswer = false;
      throw new Error('connection reset after commit');
    }
    return out;
  };
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
        return answer(req, out);
      };
      const rec = req.recordId ? records.get(req.recordId) : null;
      switch (req.action) {
        case 'project.read': return done({ project: { id: req.projectId, name: 'Sample clinic fit-out' } });
        case 'metadata.read': return done(structuredClone(META));
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
          return done({ record: structuredClone(rec) }, { status: 'saved', recordId: String(rec.id), revision: rec.revision, requestId: req.requestId });
        }
        case 'field.read': {
          const t = req.query.kind === 'tasks' ? tasks.get(req.query.key) : null;
          return done(t ? { kind: req.query.kind, key: req.query.key, rev: t.rev, record: structuredClone(t.record), base: structuredClone(t.record) } : { kind: req.query.kind, key: req.query.key, rev: 0, record: null, base: null });
        }
        case 'field.edit': {
          const t = tasks.get(req.body.key);
          if ((t ? t.rev : 0) !== req.body.expectedRev) return fail('conflict', 'Field Hub rev moved on', { status: 409, current: { rev: t ? t.rev : 0 } });
          if (st.fieldSaves && t) {
            Object.assign(t.record, req.body.changes);
            t.rev += 1;
            return done({ operation: { operationId: 'op_field_0002', status: 'saved' } }, { status: 'saved', operationId: 'op_field_0002', rev: t.rev, requestId: req.requestId });
          }
          return done({ operation: { operationId: 'op_field_0001', status: 'pending' } }, { status: 'pending', operationId: 'op_field_0001', requestId: req.requestId });
        }
        case 'field.retry':
          return done({ operation: { operationId: req.operationId, status: 'queued' } }, st.retryReceipt);
        default: return fail('unsupported', `stand-in has no ${req.action}`);
      }
    },
  };
  return st;
}

function setup() {
  const DB = createTestDb();
  const pm = fakePm();
  const env = { DB, DEV_ALLOW_UNAUTH: '0', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', PM_COMMANDS_SERVICE: pm.service };
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
  const crossGrant = (g) => owner('PUT', '/api/connections/crossapp/grant', g);
  const full = async (extra = {}) => {
    await owner('PUT', '/api/connections/mcp/grant', { mode: 'full', scopes: ['work'] });
    await crossGrant({ clients: ['mcp', 'ask'], projects: ['p1'], actions: ALL, ...extra });
  };
  // Ask's Full-mode toolkit exactly as src/api.js builds it; grantOf stands in for Ask's own re-read grant
  // (owner setting Full for Work, Work consent on).
  const askKit = () => askToolkit({ env, nowMs: NOW, dispatch: null, maxChars: 19000, grantOf: async () => ({ mode: 'full', scopes: ['work'] }) });
  return { DB, env, pm, owner, call, crossGrant, full, askKit };
}

const text = (r) => r.content[0].text;
const ok = (data) => ({ ok: true, status: 200, data });

test('F1 a saved PM change whose answer is large is still reported as saved, not as a failed tool call', async () => {
  const s = setup();
  await s.full();
  // A long-lived record: many keys PM keeps in its data section (legacy or not in the registry any more).
  const rec = s.pm.records.get('rfi_1');
  for (let i = 0; i < 1000; i++) rec.data[`k${String(i).padStart(4, '0')}`] = 'x'.repeat(40);
  const r = await s.call('pm_update_record', { project_id: 'p1', record_id: 'rfi_1', expected_revision: 3, data: { discipline: 'mechanical' } });
  const stored = s.pm.records.get('rfi_1');
  assert.deepEqual([stored.revision, stored.data.discipline], [4, 'mechanical'], 'PM saved the change');
  assert.equal(r.isError, false, `PM saved it, but the tool answered: ${text(r)}`);
  // Ask: the same change shows as "Not done" in the answer's list of changes.
  const s2 = setup();
  await s2.full();
  for (let i = 0; i < 400; i++) s2.pm.records.get('rfi_1').data[`k${i}`] = 'x'.repeat(40);
  const kit = await s2.askKit();
  await kit.handlers.pm_update_record({ project_id: 'p1', record_id: 'rfi_1', expected_revision: 3, data: { discipline: 'mechanical' } });
  assert.equal(s2.pm.records.get('rfi_1').revision, 4, 'PM saved the change');
  assert.doesNotMatch(actionWords(kit.actions[0]), /^Not done/, JSON.stringify(kit.actions[0]));
});

test('F2 a write whose answer was lost after PM committed is reported as outcome unknown, never "Not done"', async () => {
  const s = setup();
  await s.full();
  s.pm.loseAnswer = true;
  const kit = await s.askKit();
  const res = await kit.handlers.pm_create_record({ project_id: 'p1', type: 'rfi', top_level: { title: 'Conduit route' }, data: { question: 'Which route?' } });
  assert.equal(s.pm.records.size, 3, 'PM created the record; only its answer was lost');
  assert.doesNotMatch(res.content, /^Not done\./, 'the tool result opens with "Not done." although the outcome is unknown');
  assert.doesNotMatch(actionWords(kit.actions[0]), /^Not done/, `Ask's list says: ${actionWords(kit.actions[0])}`);
});

test('F3 a conflict whose current DTO has a numeric record id reaches the model unredacted (secure values) with includeSensitive off', async () => {
  const s = setup();
  await s.full();
  s.pm.records.set('101', { ...s.pm.rfi(101) }); // PM's DTO id is a number; the tool's record_id is its text
  const read = await s.call('pm_get_record', { project_id: 'p1', record_id: '101' });
  assert.ok(!text(read).includes(SECRET_NOTE), 'a plain read is redacted');
  s.pm.bumpBeforeUpdate = true;
  const conflict = await s.call('pm_update_record', { project_id: 'p1', record_id: '101', expected_revision: 3, top_level: { priority: 'high' } });
  assert.equal(conflict.isError, true);
  for (const secret of [SECRET_NOTE, '"costImpact":1200', '"margin":0.12']) assert.ok(!text(conflict).includes(secret), `conflict leaked ${secret}: ${text(conflict).slice(0, 400)}`);
});

test('F4 a cross-app write with no "saved" receipt is not shown as Done in Ask', async () => {
  const s = setup();
  await s.full();
  for (const receipt of [undefined, { status: 'queued', operationId: 'op_field_0009', requestId: 'x' }]) {
    s.pm.retryReceipt = receipt;
    const kit = await s.askKit();
    await kit.handlers.field_retry_operation({ project_id: 'p1', operation_id: 'op_field_0009' });
    const a = kit.actions[0];
    assert.equal(a.ok, true);
    assert.doesNotMatch(actionWords(a), /^Done/, `receipt ${JSON.stringify(receipt)} is shown as: ${actionWords(a)}`);
  }
});

test('F5 the Connections rows do not say Field Hub may be read and changed when only Electrical PM actions are granted', () => {
  const rows = (actions) => Object.fromEntries(summarize({
    ai: ok({ configured: false, consent: { work: false, personal: false } }),
    mcp: ok({ configured: true, scopes: ['work'], allow_capture: false, last_call_at: null }),
    apps: { pm: 'https://pm.example.invalid', field_hub: 'https://field.example.invalid' },
    crossapp: ok({ configured: true, grant: { clients: ['ask'], projects: ['p1'], actions, includeSensitive: false } }),
  }).map((r) => [r.name, r]));
  const pmOnly = rows(['project.read', 'metadata.read', 'records.list', 'record.read', 'record.create', 'record.update', 'record.archive', 'record.restore']);
  assert.doesNotMatch(pmOnly['Field Hub'].detail, /may read and change it/, pmOnly['Field Hub'].detail);
  const fieldWriteOnly = rows(['field.edit']);
  assert.doesNotMatch(fieldWriteOnly['Electrical PM app'].detail, /may read and change it/, fieldWriteOnly['Electrical PM app'].detail);
});

test('F8 Ask: text shortened in the one-record read cannot be written back to Electrical PM', async () => {
  const s = setup();
  await s.full();
  s.pm.records.get('rfi_1').data.question = 'Q'.repeat(19000); // a long RFI question (text fields allow 20000)
  const kit = await s.askKit();
  const seen = JSON.parse((await kit.handlers.pm_get_record({ project_id: 'p1', record_id: 'rfi_1' })).content);
  assert.equal(seen.truncated, true, 'pm_get_record, the one-record read, is itself shortened under Ask\'s limit');
  assert.match(seen.truncated_note, /get_item/, 'and the note sends the model to a Harrison OS tool, not to anything that shows the whole PM text');
  // The model does what Harrison asked ("add 'Which panel?' to the question") with the only text it was shown.
  await kit.handlers.pm_update_record({ project_id: 'p1', record_id: 'rfi_1', expected_revision: 3, data: { question: `${seen.result.record.data.question} Which panel?` } });
  assert.ok(s.pm.records.get('rfi_1').data.question.length >= 19000, `PM now holds ${s.pm.records.get('rfi_1').data.question.length} characters of the 19000`);
});

test('F6 field_edit_record: after a lost answer the tool points to field_retry_operation, and a resent edit cannot apply twice', async () => {
  // Revised after review with root: PM hashes the base too, so a resent edit with a fresh base is not a replay.
  // The supported recovery is field_retry_operation with the pending operationId; field_edit_record takes no request_id.
  const s = setup();
  await s.full();
  s.pm.fieldSaves = true;
  s.pm.loseAnswer = true;
  const args = { project_id: 'p1', kind: 'tasks', key: 'T-100', expected_rev: 7, changes: { review: 'Looks good' }, reason: 'Reviewed the pull' };
  const lost = await s.call('field_edit_record', args);
  assert.equal(lost.isError, true);
  assert.match(text(lost), /^Outcome unknown\./);
  assert.match(text(lost), /field_list_pending and use field_retry_operation/);
  assert.equal(s.pm.tasks.get('T-100').rev, 8, 'Field Hub saved it; the answer was lost');
  const again = await s.call('field_edit_record', args);
  assert.equal(again.isError, true);
  assert.match(text(again), /rev 8 now, you sent 7\). If that was this change, it is already made/);
  assert.equal(s.pm.tasks.get('T-100').rev, 8, 'not applied twice');
  assert.match(text(await s.call('field_edit_record', { ...args, request_id: 'retry_12345678' })), /unknown argument: request_id/);
});

test('F7 with includeSensitive off, a record whose type PM metadata does not describe is not archived (it cannot be classified)', async () => {
  const s = setup();
  await s.full();
  s.pm.records.set('old_1', { id: 'old_1', type: 'legacy_cost', revision: 1, status: 'open', archived: false, title: 'Old cost line', financial: { amount: 5000 } });
  const read = (await s.call('pm_get_record', { project_id: 'p1', record_id: 'old_1' })).structuredContent.result.record;
  assert.deepEqual(read.withheld, ['every field: Electrical PM did not describe this record type'], 'reads withhold it');
  assert.equal((await s.call('pm_update_record', { project_id: 'p1', record_id: 'old_1', expected_revision: 1, top_level: { title: 'x' } })).isError, true, 'updates refuse it');
  const arch = await s.call('pm_archive_record', { project_id: 'p1', record_id: 'old_1', expected_revision: 1 });
  assert.equal(s.pm.records.get('old_1').archived, false, `archive went through: ${text(arch).slice(0, 200)}`);
});
