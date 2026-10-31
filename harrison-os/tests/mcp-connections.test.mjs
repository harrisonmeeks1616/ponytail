// The Connections card's status words (public/views/connections.js summarize, pure): honest states only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, register } from '../public/views/connections.js';

const ok = (data) => ({ ok: true, status: 200, data });
const missing = { ok: false, status: 404, data: null };
const byName = (rows) => Object.fromEntries(rows.map((r) => [r.name, r]));

test('missing feature routes read "Not available yet", never working', () => {
  const rows = byName(summarize({ ai: missing, calendar: [missing], pm: [missing], mcp: missing }));
  for (const name of ['Ask with AI', 'Calendar', 'Company projects', 'AI clients (MCP)']) assert.equal(rows[name].status, 'Not available yet');
  assert.equal(rows['iPhone Shortcut'].status, 'Not checked here');
});

test('not configured says what is needed; configured MCP is not "working" until a client has called it', () => {
  const blank = byName(summarize({
    ai: ok({ configured: false, consent: { work: false, personal: false } }),
    calendar: [ok({ connections: [] })],
    pm: [ok({ sources: [] })],
    mcp: ok({ configured: false, scopes: ['work'], allow_capture: false, last_call_at: null }),
  }));
  assert.equal(blank['Ask with AI'].status, 'Not set up');
  assert.ok(blank['AI clients (MCP)'].need.includes('docs/MCP.md'));
  assert.ok(blank.Calendar.need);

  const set = byName(summarize({
    ai: ok({ configured: true, consent: { work: true, personal: false } }),
    calendar: [ok({ connections: [{ state: 'ok', sample: 0 }] }), ok({ connections: [{ state: 'error', sample: 0 }] })],
    pm: [ok({ sources: [{ state: 'ok', sample: 1 }] })],
    mcp: ok({ configured: true, scopes: ['work'], allow_capture: false, last_call_at: null }),
  }));
  assert.equal(set['Ask with AI'].detail, 'May read Work records.');
  assert.equal(set.Calendar.status, 'Problem');
  assert.equal(set['Company projects'].status, 'Sample only');
  assert.equal(set['AI clients (MCP)'].status, 'Set up, not used yet');
  assert.match(set['AI clients (MCP)'].detail, /Can read Work records\. Cannot change anything\. No AI client has connected yet\./);

  const used = byName(summarize({ ai: missing, mcp: ok({ configured: true, scopes: ['work', 'personal'], allow_capture: true, last_call_at: '2026-10-31T15:00:00.000Z' }) }));
  assert.equal(used['AI clients (MCP)'].status, 'Set up, used');
  assert.match(used['AI clients (MCP)'].detail, /Work and Personal.*inbox for review/);
});

test('pm placeholder "not_connected" entry is not a source: reads "Not set up", not "Added, not loaded yet"', () => {
  const rows = byName(summarize({ ai: missing, mcp: missing, pm: [ok({ sources: [{ id: 'http', state: 'not_connected', sample: 0 }] })] }));
  assert.equal(rows['Company projects'].status, 'Not set up');
});

test('iPhone Shortcut row follows shortcut_configured and points at a doc that exists', async () => {
  const { existsSync } = await import('node:fs');
  const base = { configured: false, scopes: ['work'], allow_capture: false, last_call_at: null };
  const set = byName(summarize({ mcp: ok({ ...base, shortcut_configured: true }) }))['iPhone Shortcut'];
  assert.equal(set.status, 'Set up');
  assert.notEqual(set.tone, 'good'); // configured is not proof the phone has sent anything
  const unset = byName(summarize({ mcp: ok({ ...base, shortcut_configured: false }) }))['iPhone Shortcut'];
  assert.equal(unset.status, 'Not set up');
  for (const doc of unset.need.match(/docs\/[A-Za-z_.-]+\.md/g)) assert.ok(existsSync(new URL(`../${doc}`, import.meta.url)), doc);
});

test('server not answering reads "Could not check" for every row, never "Not available yet"', () => {
  const rows = summarize({ mcp: { ok: false, status: 0, offline: true, data: null } });
  assert.equal(rows.length, 5);
  for (const r of rows) assert.equal(r.status, 'Could not check');
});

// The card must not request a route the build lacks: each 404 is a browser console error (e2e F9).
async function cardRequests(features, scope) {
  const asked = [];
  let block;
  const kit = {
    h: () => ({}), chip: () => ({}), section: () => ({}), formatAt: (v) => v, state: { scope },
    addMemoryBlock: (fn) => (block = fn),
    api: async (path) => {
      asked.push(path);
      return path === '/api/connections/mcp' ? ok({ configured: false, scopes: ['work'], allow_capture: false, last_call_at: null, features }) : ok({});
    },
  };
  register(kit);
  await block(null, scope);
  return asked.sort();
}

test('card asks only for feature routes the server reports present', async () => {
  assert.deepEqual(await cardRequests({ ai: false, calendar: false, pm: false }, 'all'), ['/api/connections/mcp']);
  assert.deepEqual(await cardRequests(undefined, 'work'), ['/api/connections/mcp']);
  assert.deepEqual(await cardRequests({ ai: true, calendar: true, pm: true }, 'work'),
    ['/api/ai/status', '/api/calendar/connections?scope=work', '/api/connections/mcp', '/api/pm/sources?scope=work']);
  assert.deepEqual(await cardRequests({ ai: false, calendar: true, pm: false }, 'all'),
    ['/api/calendar/connections?scope=personal', '/api/calendar/connections?scope=work', '/api/connections/mcp']);
});
