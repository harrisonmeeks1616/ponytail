#!/usr/bin/env node
'use strict';
// A local stand-in for the deployed hub, for browser end-to-end tests: docs/schwab/hub/Code.gs running on the
// in-memory Google fake (tests/helpers/google-mock.js). Not Google: it proves the app talks the hub protocol,
// nothing about Apps Script itself.
//
// Run (node only, no packages): node tests/browser/hub-dev-server.js 8780
// tests/browser/schwab-hub.e2e.js starts its own; schwab-spanish-audit.e2e.js --hub needs one running (HUBDEV).
//
//   POST /            body = the hub request JSON (text/plain), answers the hub reply JSON, CORS open
//   GET  /            the health check
//   GET  /__dump      every tab as readable text (add ?json=1 for JSON)
//   GET  /__keys      {pm, crew, super, url, sheetUrl}
//   POST /__reset     start over with a new, empty hub and new keys; answers the same as /__keys
//   POST /__clock     {advance: ms} or {set: ms} or {real: true}: move the hub's clock (default: real time)
//   POST /__mock      {translateQuota: n|null, translateFail: 'text', contended: bool}: make the fake misbehave
//
// Keys are printed at startup (and after /__reset is read from the reply). Listens on 127.0.0.1 only.
//
// Device secrets (HUB.md, Identity): every request should carry devSecret, the phone's own 32 characters of
// [A-Za-z0-9]. The hub derives the device id (the first 32 hex characters of SHA-256(devSecret)) and ignores any `dev`
// sent. Without one a phone has no device: its own-shift writes are refused ('device') and a crew or super pull has no
// shifts. Startup prints a sample secret, its device id and a curl line that uses it. whoami answers `dev`: the id the
// hub derived from the devSecret sent ('' without a valid one), so a phone can check it matches its own.

process.env.TZ = 'America/New_York'; // before any Date use: the hub's hours math is the job's local time
const http = require('node:http');
const crypto = require('node:crypto');
const { createHub } = require('../helpers/google-mock.js');

const port = Number(process.argv[2]) || 8780;

let hub, keys;
function boot() {
  hub = createHub({ reuseContext: true });
  const k = hub.setup();
  keys = { pm: k.pm, crew: k.crew, super: k.super, sheetUrl: k.sheetUrl, url: `http://127.0.0.1:${port}/` };
}
boot();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '600',
};
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { ...CORS, 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const readBody = (req, limit = 2e6) => new Promise((resolve, reject) => {
  let s = '';
  req.setEncoding('utf8');
  req.on('data', c => { s += c; if (s.length > limit) { reject(Object.assign(new Error('too big'), { code: 413 })); req.destroy(); } });
  req.on('end', () => resolve(s));
  req.on('error', reject);
});

function dumpJson() {
  const out = {};
  for (const title of hub.tabs()) out[title] = { header: hub.header(title), rows: hub.table(title) };
  return out;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (url.pathname === '/__keys' && req.method === 'GET') return send(res, 200, keys);
    if (url.pathname === '/__dump' && req.method === 'GET') {
      return url.searchParams.has('json') ? send(res, 200, dumpJson()) : send(res, 200, hub.dump() + '\n', 'text/plain; charset=utf-8');
    }
    if (url.pathname === '/__reset' && req.method === 'POST') { boot(); return send(res, 200, keys); }
    if (url.pathname === '/__clock' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)) || '{}');
      if (b.real) { hub.fixedNow = null; hub.clockOffset = 0; }
      else if (Number.isFinite(b.set)) hub.setNow(b.set);
      else if (Number.isFinite(b.advance)) hub.advance(b.advance);
      return send(res, 200, { ok: true, now: hub.now() });
    }
    if (url.pathname === '/__mock' && req.method === 'POST') {
      const b = JSON.parse((await readBody(req)) || '{}');
      if ('translateQuota' in b) hub.translateQuota = b.translateQuota === null ? Infinity : hub.translateLog.length + Number(b.translateQuota);
      if ('translateFail' in b) hub.translateFail = String(b.translateFail || '');
      if ('contended' in b) hub.contended = !!b.contended;
      return send(res, 200, { ok: true, translateCalls: hub.translateLog.length });
    }
    if (url.pathname.startsWith('/__')) return send(res, 404, { ok: false, error: 'unknown dev route' });
    if (req.method === 'GET') return send(res, 200, hub.get());
    if (req.method === 'POST') {
      const body = await readBody(req);
      return send(res, 200, hub.raw(body)); // the hub answers 200 with {ok:false,...} for its own errors, like Apps Script
    }
    send(res, 405, { ok: false, error: 'method' });
  } catch (err) {
    // Only the fake itself can land here (a shape the real API would refuse, a write outside the lock...). Say so loudly.
    console.error('dev server error:', err && err.message);
    send(res, err && err.code === 413 ? 413 : 500, { ok: false, error: 'server', message: 'dev server: ' + String(err && err.message).slice(0, 300) });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`hub dev server on http://127.0.0.1:${port}/`);
  console.log(`PM_KEY=${keys.pm}`);
  console.log(`CREW_KEY=${keys.crew}`);
  console.log(`SUPER_KEY=${keys.super}`);
  console.log(JSON.stringify({ pm: keys.pm, crew: keys.crew, super: keys.super, url: keys.url }));
  const secret = crypto.randomBytes(16).toString('hex'); // 32 characters of [0-9a-f], within [A-Za-z0-9]
  console.log('Send devSecret with every request (32 characters [A-Za-z0-9], one per phone); the hub derives the device id');
  console.log('as the first 32 hex characters of SHA-256(devSecret) and ignores any dev you send. A sample:');
  console.log(`DEV_SECRET=${secret}`);
  console.log(`DEVICE_ID=${crypto.createHash('sha256').update(secret).digest('hex').slice(0, 32)}`);
  console.log(`curl -s -H 'Content-Type: text/plain' --data '{"v":1,"key":"${keys.crew}","action":"pull","since":0,"devSecret":"${secret}"}' ${keys.url}`);
});
