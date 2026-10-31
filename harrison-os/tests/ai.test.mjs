// src/ai.js: the provider adapter, driven with a fake fetch. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { complete, aiConfigured, aiModel, aiTimeoutMs, aiConsent, setAiConsent, API_URL, API_VERSION, DEFAULT_MODEL } from '../src/ai.js';
import { createTestDb } from './helpers/d1.mjs';

const KEY = 'sk-test-not-a-real-key';
const env = (extra = {}) => ({ AI_API_KEY: KEY, ...extra });

function reply(body, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const message = (text, extra = {}) => reply({ id: 'msg_1', type: 'message', model: DEFAULT_MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text }], ...extra });

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (typeof next === 'function') return next(init);
    if (!next) throw new Error('no more responses');
    return next;
  };
  return { impl, calls };
}

// A fetch that only ends when its signal aborts, like a provider that never answers.
const hanging = (init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

test('configuration: key, model and timeout clamp', () => {
  assert.equal(aiConfigured({}), false);
  assert.equal(aiConfigured({ AI_API_KEY: '  ' }), false);
  assert.equal(aiConfigured(env()), true);
  assert.equal(aiModel({}), DEFAULT_MODEL);
  assert.equal(aiModel({ AI_MODEL: 'claude-opus-5-5' }), 'claude-opus-5-5');
  assert.equal(aiModel({ AI_MODEL: 'bad model; drop' }), DEFAULT_MODEL);
  assert.equal(aiTimeoutMs({}), 20000);
  assert.equal(aiTimeoutMs({ AI_TIMEOUT_MS: '500' }), 2000);
  assert.equal(aiTimeoutMs({ AI_TIMEOUT_MS: '999999' }), 30000);
});

test('not configured: nothing is sent', async () => {
  const f = fakeFetch([]);
  const r = await complete({}, { prompt: 'hi', fetchImpl: f.impl });
  assert.deepEqual(r, { ok: false, reason: 'not_configured' });
  assert.equal(f.calls.length, 0);
});

test('request shape: Messages API, headers, model, JSON schema, and parsed output', async () => {
  const logs = [];
  const orig = console.log;
  console.log = (s) => logs.push(String(s));
  try {
    const f = fakeFetch([message('{"answer":"ok","cited_refs":[]}')]);
    const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
    const r = await complete(env({ AI_MODEL: 'claude-sonnet-5-5' }), { system: 'SYS-TEXT', prompt: 'PROMPT-TEXT', maxTokens: 900, expectJson: true, schema, fetchImpl: f.impl });
    assert.equal(r.ok, true);
    assert.deepEqual(r.data, { answer: 'ok', cited_refs: [] });
    assert.equal(r.model, DEFAULT_MODEL);
    const [c] = f.calls;
    assert.equal(c.url, API_URL);
    assert.ok(c.url.startsWith('https://'));
    assert.equal(c.init.method, 'POST');
    assert.equal(c.init.headers['x-api-key'], KEY);
    assert.equal(c.init.headers['anthropic-version'], API_VERSION);
    assert.equal(c.init.headers['content-type'], 'application/json');
    assert.ok(c.init.signal instanceof AbortSignal);
    assert.equal(c.body.model, 'claude-sonnet-5-5');
    assert.equal(c.body.max_tokens, 900);
    assert.equal(c.body.system, 'SYS-TEXT');
    assert.deepEqual(c.body.messages, [{ role: 'user', content: 'PROMPT-TEXT' }]);
    assert.deepEqual(c.body.output_config.format, { type: 'json_schema', schema });
    assert.equal(c.body.thinking, undefined);
    // Logs carry codes only: no key, prompt, system or answer text.
    const all = logs.join('\n');
    for (const secret of [KEY, 'PROMPT-TEXT', 'SYS-TEXT', 'cited_refs']) assert.ok(!all.includes(secret), secret);
  } finally {
    console.log = orig;
  }
});

test('429 then success: one retry inside the deadline', async () => {
  const f = fakeFetch([reply({ type: 'error' }, 429), message('fine')]);
  const r = await complete(env(), { prompt: 'p', fetchImpl: f.impl });
  assert.equal(r.ok, true);
  assert.equal(r.text, 'fine');
  assert.equal(f.calls.length, 2);
});

test('500 twice: provider_error after exactly one retry; 400 is not retried', async () => {
  const f = fakeFetch([reply('{}', 500), reply('{}', 529), message('never')]);
  const r = await complete(env(), { prompt: 'p', fetchImpl: f.impl });
  assert.deepEqual(r, { ok: false, reason: 'provider_error', status: 529 });
  assert.equal(f.calls.length, 2);
  const g = fakeFetch([reply('{}', 401), message('never')]);
  assert.deepEqual(await complete(env(), { prompt: 'p', fetchImpl: g.impl }), { ok: false, reason: 'provider_error', status: 401 });
  assert.equal(g.calls.length, 1);
});

test('invalid output: bad JSON body, non-JSON text when JSON expected, refusal, cut off, oversize', async () => {
  const cases = [
    reply('not json at all'),
    message('Sure! Here is your answer.'),
    message('{"answer":"x"}', { stop_reason: 'refusal' }),
    message('{"answer":"x', { stop_reason: 'max_tokens' }),
    reply({ content: [] }),
    reply('x'.repeat(250_000)),
  ];
  for (const res of cases) {
    const f = fakeFetch([res]);
    const r = await complete(env(), { prompt: 'p', expectJson: true, fetchImpl: f.impl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'invalid_output');
  }
});

test('timeout: a provider that never answers ends at the deadline', async () => {
  const f = fakeFetch([hanging]);
  const t0 = Date.now();
  const r = await complete(env(), { prompt: 'p', timeoutMs: 60, fetchImpl: f.impl });
  assert.deepEqual(r, { ok: false, reason: 'timeout' });
  assert.ok(Date.now() - t0 < 1000);
});

test('cancel: the caller signal aborts the call; an already-aborted signal sends nothing', async () => {
  const f = fakeFetch([hanging]);
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 20);
  assert.deepEqual(await complete(env(), { prompt: 'p', signal: ac.signal, fetchImpl: f.impl }), { ok: false, reason: 'cancelled' });
  const g = fakeFetch([message('x')]);
  const done = new AbortController();
  done.abort();
  assert.deepEqual(await complete(env(), { prompt: 'p', signal: done.signal, fetchImpl: g.impl }), { ok: false, reason: 'cancelled' });
  assert.equal(g.calls.length, 0);
});

test('network failure is a provider_error, not a throw', async () => {
  const f = fakeFetch([() => { throw new TypeError('fetch failed'); }]);
  assert.deepEqual(await complete(env(), { prompt: 'p', fetchImpl: f.impl }), { ok: false, reason: 'provider_error', status: 0 });
});

test('consent defaults to not allowed and is per scope', async () => {
  const DB = createTestDb();
  assert.equal(await aiConsent(DB, 'work'), false);
  assert.equal(await aiConsent(DB, 'personal'), false);
  await setAiConsent(DB, 'work', true, '2026-10-31T12:00:00.000Z');
  assert.equal(await aiConsent(DB, 'work'), true);
  assert.equal(await aiConsent(DB, 'personal'), false);
  assert.equal(await aiConsent(DB, 'all'), false);
  await setAiConsent(DB, 'work', false, '2026-10-31T12:01:00.000Z');
  assert.equal(await aiConsent(DB, 'work'), false);
});
