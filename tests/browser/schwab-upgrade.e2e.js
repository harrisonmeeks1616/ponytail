#!/usr/bin/env node
// Real cached-upgrade regression, on an ephemeral local server with fictional data.
// NODE_PATH=<bundled Playwright modules> node tests/browser/schwab-upgrade.e2e.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..'), app = path.join(root, 'docs/schwab');
const files = ['index.html', 'tasks.html', 'report.html', 'report.mjs', 'shared.mjs', 'sync.mjs', 'live.mjs', 'es.mjs', 'shared.css', 'sw.js'];
// This is the actual v8 build whose independent background refresh lost retired Spanish phrases.
const old = Object.fromEntries(files.map(f => [f, execFileSync('git', ['show', 'ef0c873:docs/schwab/' + f], { cwd: root }).toString('utf8')]));
const release = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(app, f), 'utf8')]));
const cacheName = release['sw.js'].match(/const CACHE = '([^']+)'/)[1];
const futureName = cacheName + '-test-next';
const future = Object.fromEntries(files.map(f => [f, release[f] + (f.endsWith('.html') ? '\n<!-- next complete release -->\n' : '\n/* next complete release */\n')]));
future['sw.js'] = future['sw.js'].replace(cacheName, futureName);
let mode = 'old';
const requests = [];
const server = http.createServer((req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  requests.push([mode, file]);
  if (!files.includes(file)) { res.writeHead(404); return res.end(); }
  if (mode === 'legacy-partial' && file !== 'es.mjs' && file !== 'sw.js') return req.socket.destroy();
  if (mode === 'future-partial' && file === 'report.mjs') return req.socket.destroy();
  const source = mode === 'old' ? old : mode.startsWith('future') ? future : release;
  const body = mode === 'legacy-partial' && file === 'sw.js' ? old[file] : source[file];
  res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
});
const poll = async check => {
  const until = Date.now() + 10000;
  while (Date.now() < until) { if (await check()) return; await new Promise(r => setTimeout(r, 50)); }
  throw Error('Timed out waiting for service-worker activation');
};
const update = page => page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('No completed worker update')), 10000);
    r.addEventListener('updatefound', () => {
      const worker = r.installing;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' || worker.state === 'redundant') { clearTimeout(timer); resolve(worker.state); }
      });
    }, { once: true });
  });
  await r.update();
  return done;
});
const cached = (page, name) => page.evaluate(async name => {
  const c = await caches.open(name), result = {};
  for (const req of await c.keys()) result[new URL(req.url).pathname.slice(1) || './'] = await (await c.match(req)).text();
  return result;
}, name);
function assertComplete(contents, expected) {
  for (const file of files.filter(f => f !== 'sw.js')) assert.equal(contents[file], expected[file], 'complete cache: ' + file);
  assert.equal(contents['./'], expected['index.html'], 'root entry belongs to the same release');
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: 'allow' }), errors = [];
    context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
    await context.addInitScript(() => {
      if (location.protocol !== 'http:') return;
      if (localStorage.getItem('upgrade-seeded')) return;
      localStorage.setItem('schwab.settings', JSON.stringify({ lang: 'es', role: 'Crew member', me: 'Upgrade Test', worker: 'Upgrade Test' }));
      localStorage.setItem('upgrade-seeded', 'yes');
    });
    let page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(base + 'tasks.html#crew');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.reload();
    await page.waitForSelector('.empty h2');
    assert.match(await page.textContent('.empty h2'), /No hay hojas de tareas/);

    // Existing v8 can still refresh files separately during migration. The retained keys protect it.
    mode = 'legacy-partial';
    await page.reload();
    await page.waitForFunction(async () => {
      const c = await caches.open('schwab-field-apps-v8');
      return (await (await c.match('es.mjs')).text()).includes('v8 upgrade compatibility');
    });
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('.empty h2');
    assert.match(await page.textContent('.empty h2'), /No hay hojas de tareas/, 'partial v8 dictionary refresh stays Spanish offline');
    await context.setOffline(false);
    await page.evaluate(async () => {
      const unrelated = await caches.open('unrelated-app-cache');
      await unrelated.put('tasks.html', new Response('This belongs to another cache.'));
    });

    // Install the complete real release, but leave the already-open v8 page on its old worker.
    mode = 'release';
    let nextWorker = context.waitForEvent('serviceworker');
    assert.equal(await update(page), 'installed');
    let worker = await nextWorker;
    assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), true);
    assertComplete(await cached(page, cacheName), release);
    await page.close();
    await poll(() => worker.evaluate(() => !!self.registration.active && !self.registration.waiting));
    page = await context.newPage();
    await page.goto(base + 'tasks.html#crew');
    await page.waitForSelector('.empty h2');
    assert.equal(await page.getAttribute('html', 'lang'), 'es');
    assertComplete(await cached(page, cacheName), release);
    assert.equal(await page.evaluate(async () => (await fetch('tasks.html?version-check=1#crew')).text()), release['tasks.html'], 'query/hash URLs use this release cache, never another cache');
    assert.equal(await page.evaluate(() => caches.has('schwab-field-apps-v8')), false, 'activated release retires the v8 cache');

    // A later incomplete release must neither activate nor mutate the current core cache on reload.
    mode = 'future-partial';
    assert.equal(await update(page), 'redundant', 'one missing core module rejects the new installation');
    const beforeReload = requests.length;
    await page.reload();
    await page.waitForSelector('.empty h2');
    assertComplete(await cached(page, cacheName), release);
    assert.equal(requests.slice(beforeReload).filter(([, f]) => files.includes(f) && f !== 'sw.js').length, 0, 'controlled core requests never refresh individual files');
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('.empty h2');
    assert.equal(await page.getAttribute('html', 'lang'), 'es', 'failed update retains the translated offline build');
    await context.setOffline(false);

    // A complete update waits for every old tab, then switches all assets together.
    mode = 'future-full';
    nextWorker = context.waitForEvent('serviceworker');
    assert.equal(await update(page), 'installed');
    worker = await nextWorker;
    assertComplete(await cached(page, futureName), future);
    const second = await context.newPage();
    await second.goto(base + 'tasks.html#crew');
    await second.waitForSelector('.empty h2');
    assert.equal(await second.evaluate(async () => (await fetch('tasks.html')).text()), release['tasks.html'], 'new tabs still use the active old release while it is open');
    await page.close();
    assert.equal(await second.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), true, 'the remaining tab prevents activation');
    await second.close();
    await poll(() => worker.evaluate(() => !!self.registration.active && !self.registration.waiting));
    page = await context.newPage();
    await page.goto(base + 'tasks.html#crew');
    await page.waitForSelector('.empty h2');
    assertComplete(await cached(page, futureName), future);
    assert.equal(await page.evaluate(async () => (await fetch('tasks.html')).text()), future['tasks.html']);
    assert.equal(await page.evaluate(name => caches.has(name), cacheName), false);
    assert.deepEqual(errors, [], 'no page errors during partial or complete upgrades');
    console.log('PASS: partial v8 refresh stays Spanish; complete releases wait for closed tabs; failed updates preserve all cached assets; full upgrades activate together.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
