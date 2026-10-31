// The Connections card's status words (public/views/connections.js summarize, pure): honest states only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../public/views/connections.js';

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
