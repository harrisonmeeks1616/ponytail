#!/usr/bin/env node
// Checks the iPhone Shortcut and MCP service tokens against the deployed app from a computer, before the phone
// or an AI client is set up. Secrets come only from environment variables and are never printed or saved.
//
//   HOS_URL=https://<app host> SHORTCUT_CLIENT_ID=... SHORTCUT_CLIENT_SECRET=... node scripts/service-check.mjs shortcut
//   HOS_URL=https://<app host> MCP_CLIENT_ID=... MCP_CLIENT_SECRET=... node scripts/service-check.mjs mcp
//
// shortcut (default, writes nothing): POST /api/shortcut/capture with empty text. A 400 from the Worker proves
// Access accepted the token and the Worker authenticated it; nothing is saved. Add --write to save ONE labelled
// capture ("Service check ... safe to delete", scope personal) and send the same client_ref again, which must
// come back as a duplicate. Both modes also check the token is refused on an owner-only route.
// mcp: initialize, tools/list, then one get_today read for the first allowed scope. Prints tool names and
// counts only, never record text.
import { fileURLToPath } from 'node:url';

/** What an answer means. A login page or a redirect means Access did not accept the token. */
export function classify(status, contentType, bodyText) {
  const type = String(contentType || '');
  if (status >= 300 && status < 400) return { ok: false, why: `redirected (${status}): Access did not accept the token` };
  if (type.includes('text/html')) return { ok: false, why: `HTML page (${status}): Access login or block page, the token was not accepted` };
  if (status === 401 || status === 403) return { ok: false, why: `${status}: refused (token, Access application or Worker audience variable)` };
  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return { ok: false, why: `${status}: not JSON` };
  }
  return { ok: true, status, json };
}

function env(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`${name} is not set`);
  return v.trim();
}

async function send(base, path, { method = 'POST', id, secret, body, extraHeaders = {} }) {
  const res = await fetch(new URL(path, base), {
    method,
    redirect: 'manual',
    headers: { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  return classify(res.status, res.headers.get('content-type'), await res.text());
}

const line = (ok, what) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);

async function checkShortcut(base, write) {
  const id = env('SHORTCUT_CLIENT_ID');
  const secret = env('SHORTCUT_CLIENT_SECRET');
  let pass = true;
  const probe = await send(base, '/api/shortcut/capture', { id, secret, body: { text: '' } });
  const authed = probe.ok && probe.status === 400;
  pass &&= authed;
  line(authed, authed ? 'Shortcut token reaches the Worker (empty text refused with 400, nothing saved)' : `Shortcut token: ${probe.why || `unexpected ${probe.status}`}`);
  const owner = await send(base, '/api/session', { method: 'GET', id, secret });
  const narrow = !owner.ok || owner.status === 403;
  pass &&= narrow;
  line(narrow, narrow ? 'Shortcut token is refused on an owner route (capture-only, as designed)' : `Shortcut token reached /api/session (${owner.status}): too broad`);
  if (write && authed) {
    const ref = `svc-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
    const body = { text: `Service check ${new Date().toISOString()} from service-check.mjs, safe to delete`, scope: 'personal', client_ref: ref, time_zone: 'America/New_York' };
    const first = await send(base, '/api/shortcut/capture', { id, secret, body });
    const saved = first.ok && first.status === 201 && first.json.ok === true;
    pass &&= saved;
    line(saved, saved ? `saved one capture (id ${first.json.id}); it is in Review, scope Personal` : `save: ${first.why || `${first.status} ${JSON.stringify(first.json)}`}`);
    const again = await send(base, '/api/shortcut/capture', { id, secret, body });
    const dup = again.ok && again.json.duplicate === true;
    pass &&= dup;
    line(dup, dup ? 'the same client_ref again is a duplicate (a retry never saves twice)' : `retry: ${again.why || JSON.stringify(again.json)}`);
  }
  return pass;
}

async function checkMcp(base) {
  const id = env('MCP_CLIENT_ID');
  const secret = env('MCP_CLIENT_SECRET');
  let pass = true;
  const rpc = (n, method, params) => send(base, '/api/mcp', { id, secret, body: { jsonrpc: '2.0', id: n, method, params } });
  const init = await rpc(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'service-check', version: '1' } });
  const inited = init.ok && init.json.result && init.json.result.protocolVersion;
  pass &&= !!inited;
  line(!!inited, inited ? `MCP initialize: protocol ${init.json.result.protocolVersion}` : `MCP initialize: ${init.why || JSON.stringify(init.json)}`);
  if (!inited) return false;
  const list = await rpc(2, 'tools/list', {});
  const tools = list.ok && list.json.result ? list.json.result.tools.map((t) => t.name) : [];
  pass &&= tools.length > 0;
  line(tools.length > 0, `MCP tools/list: ${tools.join(', ') || list.why || 'none'}`);
  const scopes = ['work', 'personal'];
  let read = null;
  for (const scope of scopes) {
    const r = await rpc(3, 'tools/call', { name: 'get_today', arguments: { scope } });
    if (r.ok && r.json.result && !r.json.result.isError) {
      read = { scope, size: JSON.stringify(r.json.result.structuredContent || {}).length };
      break;
    }
  }
  pass &&= !!read;
  line(!!read, read ? `MCP get_today read the ${read.scope} scope (${read.size} bytes, content not printed)` : 'MCP get_today: no allowed scope answered (check MCP_SCOPES)');
  const owner = await send(base, '/api/session', { method: 'GET', id, secret });
  const narrow = !owner.ok || owner.status === 403;
  pass &&= narrow;
  line(narrow, narrow ? 'MCP token is refused on an owner route (MCP-only, as designed)' : `MCP token reached /api/session (${owner.status}): too broad`);
  return pass;
}

async function main() {
  const [mode = 'shortcut', ...flags] = process.argv.slice(2);
  const base = new URL(env('HOS_URL'));
  const loopback = base.hostname === '127.0.0.1' || base.hostname === 'localhost';
  if (base.protocol !== 'https:' && !(loopback && base.protocol === 'http:')) throw new Error('HOS_URL must be https:// (http only for a local test server)');
  const ok = mode === 'mcp' ? await checkMcp(base) : mode === 'shortcut' ? await checkShortcut(base, flags.includes('--write')) : null;
  if (ok === null) throw new Error(`unknown mode ${mode} (shortcut or mcp)`);
  console.log(ok ? 'All checks passed. Record the result in ACCEPTANCE.md with the time.' : 'Some checks failed: see above.');
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`service-check: ${e.message}`);
    process.exitCode = 2;
  });
}
