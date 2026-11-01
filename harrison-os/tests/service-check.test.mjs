// scripts/service-check.mjs run as a child process against the real Worker routes in-process. Only the Access
// step is simulated: known token ids become the Shortcut or MCP service identity, anything else gets an HTML
// block page (as Access would answer). Sample data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createTestDb } from './helpers/d1.mjs';
import { createWorker } from '../src/api.js';
import { classify } from '../scripts/service-check.mjs';

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL('../scripts/service-check.mjs', import.meta.url));

async function withServer(fn, extraEnv = {}) {
  const DB = createTestDb();
  const env = { DB, BUILD_ID: 'test', DEV_ALLOW_UNAUTH: '0', SPIKE_TEST_HOOKS: '0', ALLOW_TEST_PUSH_ENDPOINT: '0', ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com', ACCESS_AUD: 'aud-owner', ACCESS_AUD_SHORTCUT: 'aud-shortcut', ACCESS_AUD_MCP: 'aud-mcp', MCP_SCOPES: 'work', VAPID_PUBLIC_KEY: '', VAPID_SUBJECT: '', ...extraEnv };
  const ids = { 'sc-id': 'shortcut', 'mcp-id': 'mcp' };
  const worker = createWorker({ authenticateImpl: async (req) => ({ kind: 'service', audience: ids[req.headers.get('CF-Access-Client-Id')], commonName: 'sample', expMs: Date.now() + 60_000 }) });
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const id = req.headers['cf-access-client-id'];
    if (!ids[id] || req.headers['cf-access-client-secret'] !== 'right-secret') {
      res.writeHead(403, { 'content-type': 'text/html' }).end('<html>Access blocked</html>');
      return;
    }
    const r = await worker.fetch(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, DB);
  } finally {
    server.close();
  }
}

const go = (args, extra) => run(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...extra } }).then((r) => ({ code: 0, out: r.stdout }), (e) => ({ code: e.code, out: `${e.stdout}${e.stderr}` }));

test('shortcut: default writes nothing; --write saves one capture and the retry is a duplicate; a wrong secret fails', async () => {
  await withServer(async (url, DB) => {
    const ok = await go(['shortcut'], { HOS_URL: url, SHORTCUT_CLIENT_ID: 'sc-id', SHORTCUT_CLIENT_SECRET: 'right-secret' });
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /PASS {2}Shortcut token reaches the Worker/);
    assert.match(ok.out, /PASS {2}Shortcut token is refused on an owner route/);
    assert.match(ok.out, /PASS {2}the server refuses personal for this credential \(403 scope_not_allowed, nothing saved\)/);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM captures').first('n')), 0, 'the default check saved nothing');
    const w = await go(['shortcut', '--write'], { HOS_URL: url, SHORTCUT_CLIENT_ID: 'sc-id', SHORTCUT_CLIENT_SECRET: 'right-secret' });
    assert.equal(w.code, 0, w.out);
    assert.match(w.out, /same client_ref again is a duplicate/);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM captures').first('n')), 1);
    const bad = await go(['shortcut'], { HOS_URL: url, SHORTCUT_CLIENT_ID: 'sc-id', SHORTCUT_CLIENT_SECRET: 'wrong' });
    assert.equal(bad.code, 1);
    assert.match(bad.out, /FAIL {2}Shortcut token: HTML page \(403\)/);
    assert.ok(!bad.out.includes('wrong') && !ok.out.includes('right-secret'), 'secrets are never printed');
  });
});

test('mcp: initialize, tools/list and one read pass; the token is refused on an owner route', async () => {
  await withServer(async (url) => {
    const r = await go(['mcp'], { HOS_URL: url, MCP_CLIENT_ID: 'mcp-id', MCP_CLIENT_SECRET: 'right-secret' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /PASS {2}MCP initialize: protocol 2025-11-25/);
    assert.match(r.out, /PASS {2}MCP tools\/list: .*search_memory/);
    assert.match(r.out, /PASS {2}MCP get_today read the work scope/);
    assert.match(r.out, /PASS {2}MCP token is refused on an owner route/);
  });
});

test('classify: redirects, HTML and 401/403 are never taken for success', () => {
  assert.equal(classify(302, 'text/html', '').ok, false);
  assert.equal(classify(200, 'text/html; charset=utf-8', '<html>').ok, false);
  assert.equal(classify(403, 'text/plain', 'Forbidden').ok, false, 'a non-JSON 403 is Access refusing');
  assert.deepEqual([classify(403, 'application/json', '{"error":{"code":"scope_not_allowed"}}').status, classify(403, 'application/json', '{}').ok], [403, true], 'a JSON 403 is the Worker answering; the caller judges it');
  assert.deepEqual(classify(400, 'application/json', '{"error":{}}').status, 400);
});

test('shortcut scope boundary: a credential the server lets write Personal fails the default Work-only expectation', async () => {
  await withServer(async (url, DB) => {
    const r = await go(['shortcut'], { HOS_URL: url, SHORTCUT_CLIENT_ID: 'sc-id', SHORTCUT_CLIENT_SECRET: 'right-secret' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL {2}the server accepted personal \(201\): the credential is broader than expected; that probe saved one capture/);
    assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM captures WHERE scope = 'personal'").first('n'), 1);
    const both = await go(['shortcut', '--expect-scopes=work,personal'], { HOS_URL: url, SHORTCUT_CLIENT_ID: 'sc-id', SHORTCUT_CLIENT_SECRET: 'right-secret' });
    assert.equal(both.code, 0, both.out);
  }, { SHORTCUT_SCOPES: 'work,personal' });
});
