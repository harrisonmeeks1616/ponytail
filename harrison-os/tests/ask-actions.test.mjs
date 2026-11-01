// Ask's Full mode: the owner's actions grant, the shared MCP action registry through the real /api/ask route,
// real ids and changeIds in the answer, refusals (read only, scope, revoked mid-question) and no self-escalation.
// The provider is a scripted fake fetch (no network, no real key). Synthetic sample data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from './helpers/d1.mjs';
import { createWorker } from '../src/api.js';
import { authorizeRoute } from '../src/auth.js';

const BASE = 'http://127.0.0.1:8899';
const NOW = Date.UTC(2026, 10, 1, 15, 0, 0);

function setup() {
  const DB = createTestDb();
  const worker = createWorker({ now: () => NOW });
  const env = { DB, BUILD_ID: 'test', DEV_ALLOW_UNAUTH: '1', SPIKE_TEST_HOOKS: '0', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', AI_API_KEY: 'sk-test-not-real', AI_WEB_TOOLS: 'off' };
  async function call(method, path, body) {
    const headers = method === 'GET' ? {} : { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' };
    const res = await worker.fetch(new Request(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const text = await res.text();
    return { status: res.status, data: JSON.parse(text), text };
  }
  return { DB, env, call };
}

const msg = (content, stop_reason = 'end_turn') => ({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason, content });
const use = (id, name, input) => msg([{ type: 'tool_use', id, name, input }], 'tool_use');
// The tool results the app sent back in the latest user turn, parsed.
const results = (body) => body.messages[body.messages.length - 1].content.map((r) => ({ is_error: !!r.is_error, text: r.content, data: (() => { try { return JSON.parse(r.content); } catch { return null; } })() }));

// Runs one /api/ask with globalThis.fetch replaced by the scripted provider (step n answers request n).
async function askWith(call, script, body = { scope: 'work', question: 'Add a task to order 3 filters, then rename it, then undo the rename.' }) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const req = JSON.parse(init.body);
    calls.push(req);
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    const out = typeof step === 'function' ? await step(req) : step;
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const r = await call('POST', '/api/ask', body);
    return { r, calls, answer: r.data.answer };
  } finally {
    globalThis.fetch = orig;
  }
}

test('actions setting: owner-only route, Read only by default, strict validation', async () => {
  const { call } = setup();
  assert.deepEqual((await call('GET', '/api/ai/status')).data.actions, { mode: 'read', scopes: [] });
  for (const [bad, code] of [
    [{ mode: 'all', scopes: ['work'] }, 'invalid_actions'],
    [{ mode: 'full', scopes: [] }, 'invalid_actions'],
    [{ mode: 'full', scopes: ['work', 'work'] }, 'invalid_actions'],
    [{ mode: 'full', scopes: ['all'] }, 'invalid_actions'],
    [{ mode: 'full', scopes: ['work'], consent: true }, 'invalid_actions'],
  ]) assert.equal((await call('PUT', '/api/ai/actions', bad)).data.error.code, code, JSON.stringify(bad));
  const s = (await call('PUT', '/api/ai/actions', { mode: 'full', scopes: ['work'] })).data;
  assert.deepEqual(s.actions, { mode: 'full', scopes: ['work'] });
  assert.deepEqual((await call('PUT', '/api/ai/actions', { mode: 'read', scopes: ['work'] })).data.actions, { mode: 'read', scopes: [] });
  // The internal AI identities can never reach the settings, consent, grants, Ask itself or a brief.
  for (const kind of ['ask_ai', 'mcp_client']) {
    for (const [m, p] of [['PUT', '/api/ai/actions'], ['PUT', '/api/ai/consent'], ['PUT', '/api/connections/mcp/grant'], ['POST', '/api/ask'], ['GET', '/api/projects/p1/brief'], ['POST', '/api/captures'], ['GET', '/api/export'], ['POST', '/api/restore'], ['POST', '/api/mcp']]) {
      assert.equal(authorizeRoute({ kind }, m, p), false, `${kind} ${m} ${p}`);
    }
    assert.equal(authorizeRoute({ kind }, 'POST', '/api/items'), true);
  }
});

test('Read only (the default): Ask gets no action tools, and its system prompt says it cannot change anything', async () => {
  const { call } = setup();
  await call('PUT', '/api/ai/consent', { scope: 'work', allowed: true });
  const { calls, answer } = await askWith(call, [msg([{ type: 'text', text: 'I cannot change records.' }])]);
  assert.deepEqual(calls[0].tools.map((t) => t.name), ['search_records']);
  assert.match(calls[0].system, /cannot change anything/);
  assert.equal(answer.actions_mode, 'read');
  assert.deepEqual(answer.actions, []);
});

test('Full (Work): Ask creates, edits and undoes through the app routes, and the answer lists the real ids and changeIds', async () => {
  const { DB, call } = setup();
  await call('PUT', '/api/ai/consent', { scope: 'work', allowed: true });
  await call('PUT', '/api/ai/actions', { mode: 'full', scopes: ['work'] });
  let itemId = null;
  let renameChange = null;
  const script = [
    use('tu_1', 'create_item', { scope: 'work', kind: 'task', title: 'Order 3 filters' }),
    (req) => {
      const [r] = results(req);
      assert.equal(r.is_error, false, r.text);
      itemId = r.data.item.id;
      assert.ok(Number.isInteger(Number(r.data.changeId)));
      return use('tu_2', 'update_item', { scope: 'work', item_id: itemId, title: 'Order 3 furnace filters' });
    },
    (req) => {
      const [r] = results(req);
      renameChange = String(r.data.changeId);
      return use('tu_3', 'undo_change', { scope: 'work', change_id: renameChange });
    },
    (req) => {
      assert.equal(results(req)[0].is_error, false);
      return msg([{ type: 'text', text: `Created ${itemId}, renamed it, then undid change ${renameChange}.` }]);
    },
  ];
  const { r, calls, answer } = await askWith(call, script);
  assert.equal(r.status, 200, r.text);
  const names = calls[0].tools.map((t) => t.name);
  for (const n of ['search_records', 'create_item', 'update_item', 'undo_change', 'get_item', 'review_capture']) assert.ok(names.includes(n), n);
  assert.ok(!names.some((n) => /grant|consent|setting|export|restore|push/.test(n)), 'no tool touches access or settings');
  assert.deepEqual(calls[0].tools.filter((t) => t.cache_control).map((t) => t.name), ['weekly_review_complete'], 'one cache breakpoint after the action tools');
  assert.match(calls[0].system, /Full access to his Work records/);
  assert.match(calls[0].system, /delete_item, delete_capture and delete_draft are permanent/);
  assert.equal(answer.live_ai, true);
  assert.equal(answer.actions_mode, 'full');
  assert.deepEqual(answer.actions.map((a) => [a.tool, a.ok, a.scope]), [['create_item', true, 'work'], ['update_item', true, 'work'], ['undo_change', true, 'work']]);
  assert.deepEqual(answer.actions[0].ids, [itemId]);
  assert.deepEqual(answer.actions[2].change_ids, [renameChange]);
  // The change really happened through the app: the item exists with its original title (the rename was undone).
  const item = (await call('GET', `/api/items/${itemId}?scope=work`)).data.item;
  assert.equal(item.title, 'Order 3 filters');
  // Each call is audited as Ask's, with the ids it touched and no record text.
  const events = (await DB.prepare("SELECT detail FROM events WHERE kind = 'ask_tool' ORDER BY id").all()).results.map((e) => JSON.parse(e.detail));
  assert.deepEqual(events.map((e) => [e.actor, e.tool, e.ok]), [['ask_ai', 'create_item', true], ['ask_ai', 'update_item', true], ['ask_ai', 'undo_change', true]]);
  assert.deepEqual(events[0].ids, [itemId]);
  assert.ok(!JSON.stringify(events).includes('filters'), 'no record text in the audit');
});

test('Full refuses outside its grant: another scope, a scope without consent, and a grant revoked mid-question', async () => {
  const { call } = setup();
  await call('PUT', '/api/ai/consent', { scope: 'work', allowed: true });
  await call('PUT', '/api/ai/actions', { mode: 'full', scopes: ['work', 'personal'] }); // personal has no consent
  const script = [
    use('tu_1', 'create_item', { scope: 'personal', kind: 'task', title: 'Planted personal task' }),
    async (req) => {
      const [r] = results(req);
      assert.equal(r.is_error, true);
      assert.match(r.text, /may not use the personal scope/);
      // The owner turns Full off while the question is running: the very next call is refused.
      await call('PUT', '/api/ai/actions', { mode: 'read', scopes: [] });
      return use('tu_2', 'create_item', { scope: 'work', kind: 'task', title: 'After revoke' });
    },
    (req) => {
      const [r] = results(req);
      assert.equal(r.is_error, true);
      assert.match(r.text, /read only/);
      return msg([{ type: 'text', text: 'Nothing was changed.' }]);
    },
  ];
  const { answer } = await askWith(call, script, { scope: 'all', question: 'Add a personal task, then a work task.' });
  assert.deepEqual(answer.actions.map((a) => [a.tool, a.ok]), [['create_item', false], ['create_item', false]]);
  for (const scope of ['work', 'personal']) assert.equal((await call('GET', `/api/items?scope=${scope}`)).data.items.length, 0, `nothing was created in ${scope}`);
});

test('a write made before the AI fails is still reported on the Not AI fallback', async () => {
  const { call } = setup();
  await call('PUT', '/api/ai/consent', { scope: 'work', allowed: true });
  await call('PUT', '/api/ai/actions', { mode: 'full', scopes: ['work'] });
  const { answer } = await askWith(call, [use('tu_1', 'create_item', { scope: 'work', kind: 'task', title: 'Kept task' }), msg([], 'refusal')]);
  assert.equal(answer.live_ai, false);
  assert.equal(answer.fallback_reason, 'refused');
  assert.deepEqual(answer.actions.map((a) => [a.tool, a.ok]), [['create_item', true]]);
});
