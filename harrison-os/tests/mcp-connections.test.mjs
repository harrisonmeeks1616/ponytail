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
  assert.equal(rows.length, 7);
  for (const r of rows) assert.equal(r.status, 'Could not check');
});

// The card must not request a route the build lacks: each 404 is a browser console error (e2e F9).
async function cardRequests(features, scope) {
  const asked = [];
  let block;
  const kit = {
    h: () => ({}), chip: () => ({}), section: () => ({}), formatAt: (v) => v, state: { scope, session: { apps: {} } },
    addMemoryBlock: (fn) => (block = fn),
    addTodayBlock: () => {},
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

test('official apps: linked only with an https address, and never described as more than a link', () => {
  const ok = { ok: true, status: 200, data: { features: {}, scopes: ['work'], configured: false } };
  const none = byName(summarize({ ai: null, mcp: ok }));
  assert.equal(none['Electrical PM app'].status, 'Not linked');
  assert.match(none['Field Hub'].need, /FIELD_APP_URL/);
  const linked = byName(summarize({ ai: null, mcp: ok, apps: { pm: 'https://pm.example.com/', field_hub: null } }));
  assert.equal(linked['Electrical PM app'].status, 'Linked');
  assert.equal(linked['Electrical PM app'].url, 'https://pm.example.com/');
  assert.match(linked['Electrical PM app'].detail, /official record/);
  assert.equal(linked['Field Hub'].status, 'Not linked');
});

test('every row has a group on every path, including offline "Could not check"', () => {
  const offline = summarize({ mcp: { ok: false, status: 0, offline: true, data: null } });
  assert.equal(offline.length, 7);
  assert.ok(offline.every((r) => r.group === 'source' || r.group === 'setup'), JSON.stringify(offline.map((r) => [r.name, r.group])));
  assert.deepEqual(offline.filter((r) => r.group === 'source').map((r) => r.name).sort(), ['Calendar', 'Company projects', 'Electrical PM app', 'Field Hub']);
  const ok = { ok: true, status: 200, data: { features: {}, scopes: ['work'], configured: false } };
  assert.ok(summarize({ ai: null, mcp: ok }).every((r) => r.group));
});

test('MCP row says the grant in force in plain words: Off, Read only, Full', () => {
  const base = { configured: true, scopes: ['work'], allow_capture: false, last_call_at: null };
  const row = (grant) => byName(summarize({ ai: missing, mcp: ok({ ...base, grant }) }))['AI clients (MCP)'];
  const full = row({ mode: 'full', scopes: ['work'], allow_capture: true, set_by: 'owner' });
  assert.match(full.detail, /^Full access to Work records: can add, change, review, archive and delete them\. Cannot change this setting\./);
  const off = row({ mode: 'off', scopes: [], allow_capture: false, set_by: 'owner' });
  assert.equal(off.status, 'Set up, turned off');
  assert.match(off.detail, /^Turned off: AI clients cannot read or change anything\./);
  assert.match(row({ mode: 'read', scopes: ['work', 'personal'], allow_capture: false, set_by: 'owner' }).detail, /^Can read Work and Personal records\. Cannot change anything\./);
});

// A recording h(): the card's node tree as plain objects, so the access control can be inspected without a DOM.
async function cardTree(status) {
  let block;
  const h = (tag, props, ...kids) => ({ tag, props: props || {}, kids: kids.flat(Infinity).filter((k) => k != null) });
  const kit = {
    h, chip: () => ({}), section: (title, content) => content, formatAt: (v) => v, state: { scope: 'work', session: { apps: {} } },
    addMemoryBlock: (fn) => (block = fn), addTodayBlock: () => {}, api: async () => status,
  };
  register(kit);
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    out.push(n);
    (n.kids || []).forEach(walk);
  };
  walk(await block(null, 'work'));
  return out;
}

test('access control: shown only when the server reports a grant, with Off, Read only, Full and the honest Full sentence', async () => {
  const data = { configured: true, scopes: ['work'], allow_capture: false, last_call_at: null, features: {} };
  assert.ok(!(await cardTree(ok(data))).some((n) => n.tag === 'form'), 'an older server without the grant route gets no control');
  const nodes = await cardTree(ok({ ...data, grant: { mode: 'read', scopes: ['work'], allow_capture: false, set_by: 'default', updated_at: null } }));
  const form = nodes.find((n) => n.tag === 'form');
  assert.equal(form.props.class, 'conn-grant');
  assert.equal(typeof form.props.onsubmit, 'function');
  const radios = nodes.filter((n) => n.tag === 'input' && n.props.type === 'radio');
  assert.deepEqual(radios.map((r) => [r.props.value, !!r.props.checked]), [['off', false], ['read', true], ['full', false]]);
  const boxes = nodes.filter((n) => n.tag === 'input' && n.props.type === 'checkbox');
  assert.deepEqual(boxes.map((b) => [b.props.value, !!b.props.checked]), [['work', true], ['personal', false]]);
  const texts = nodes.map((n) => n.props && n.props.text).filter(Boolean);
  assert.ok(texts.includes('Now: Can read Work records. Cannot change anything. This is the server default until you save a choice here.'));
  assert.ok(texts.some((t) => t.includes('Full lets a connected AI client add, change, review, archive and delete records in the chosen scopes. It cannot change this setting.')));
  assert.ok(nodes.some((n) => n.tag === 'button' && n.props.type === 'submit' && n.props.text === 'Save access'));
});
