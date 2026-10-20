#!/usr/bin/env node
// Shipped v7 -> v9 migration, real service workers and fictional data in isolated iPhone-sized Chromium.
// NODE_PATH=<bundled Playwright modules> node tests/browser/schwab-upgrade-v7.e2e.js
// SCHWAB_UPGRADE_TARGET=<reviewed commit> overrides the assigned target, still requiring matching working-tree bytes.
// Starts/stops its own dynamic-port 127.0.0.1 server; no Google, existing servers, installs or production writes.
// Prints assertion counts and JSON OPEN_SEQUENCE/NETWORK records. Historical bytes are unmodified git blobs.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium, devices } = require('playwright');
const root = path.resolve(__dirname, '../..'), app = path.join(root, 'docs/schwab');
const OLD = '5c65b7d2130089c0aad02f36aade797bb9fa6306', TARGET = process.env.SCHWAB_UPGRADE_TARGET || '69553e948db00bf939b84e3edf1e042437384ecd';
const files = ['index.html', 'tasks.html', 'report.html', 'report.mjs', 'shared.mjs', 'sync.mjs', 'live.mjs', 'es.mjs', 'shared.css', 'sw.js'];
const blob = (commit, file) => execFileSync('git', ['show', `${commit}:docs/schwab/${file}`], { cwd: root });
const old = Object.fromEntries(files.map(f => [f, blob(OLD, f)]));
const current = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(app, f))]));
for (const f of files) assert.deepEqual(current[f], blob(TARGET, f), 'target must be exact checked-in release: ' + f);
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const hashes = Object.fromEntries(files.map(f => [f, { v7: hash(old[f]), v9: hash(current[f]) }]));
const cacheName = current['sw.js'].toString().match(/const CACHE = '([^']+)'/)[1];
const core = new Function(current['sw.js'].toString().match(/const FILES = (\[[^;]+\])/)[1].replace(/^/, 'return '))();
const oldCore = new Function(old['sw.js'].toString().match(/const FILES = (\[[^;]+\])/)[1].replace(/^/, 'return '))();
const dictionaries = [old, current].map(src => new Function(src['es.mjs'].toString().replace('export default', 'return'))());
const norm = s => String(s).replace(/\s+/g, ' ').trim();
const english = [...new Set(dictionaries.flatMap(es => Object.keys(es).filter(k => k !== es[k] && k.length > 3 && !k.includes('{'))))];
const DAY = '2026-10-20', TS = Date.parse(DAY + 'T10:00:00-04:00');
const salt = '0123456789abcdef', pin = `${salt}:${hash(salt + ':1234')}`;
const deviceSecret = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
const people = [{ id: 'person-a', name: 'Álex Prueba', crewId: 'crew-a' }, { id: 'person-b', name: 'Álex Prueba', crewId: 'crew-b' }];
const crew = (id, name) => ({ id, name, lead: 'Álex Prueba', members: 'Álex Prueba' });
const task = (uid, crewId, personId) => ({
  uid, origin: 'mine', id: 'T1020-' + uid, date: DAY, by: 'Oficina Prueba', floor: 'Nivel 1', area: 'Sala ficticia',
  crew: crewId === 'crew-a' ? 'Cuadrilla Uno' : 'Cuadrilla Dos', crewId, members: ['Álex Prueba'], memberIds: [personId], size: 1,
  scope: 'Instalar conducto ficticio', items: [{ id: 'item-' + uid, text: 'Medir conducto', done: true, at: TS }],
  checks: [{ id: 'check-' + uid, text: 'Comprobar soporte', done: false, at: 0 }], est: 3, aStart: '07:00', aStop: '09:00', delay: 5,
  status: 'Partial', doneText: 'Avance guardado sin señal', remain: 'Terminar mañana', comments: 'Nota ficticia', sentAt: TS - 1000, updatedAt: TS,
});
const shift = (id, device, pid, gone = false) => ({
  id, device, who: 'Álex Prueba', pid, crew: pid === 'person-a' ? 'Cuadrilla Uno' : 'Cuadrilla Dos', crewId: pid === 'person-a' ? 'crew-a' : 'crew-b',
  tasks: [{ uid: 'uno', id: 'T1020-uno' }], date: DAY, in: '07:00', out: '09:15', edited: { who: false, in: false, out: true }, gone, at: TS,
});
const seed = {
  'schwab.settings': { lang: 'es', me: 'Oficina Prueba', role: 'Project manager', project: 'Proyecto de prueba', site: 'Lugar ficticio', super: 'Oficina Prueba', pm: 'Gerente Prueba', worker: 'Álex Prueba', workerId: 'person-a', device: 'old-device', floors: ['Nivel 1', 'Nivel 2'], crews: [crew('crew-a', 'Cuadrilla Uno'), crew('crew-b', 'Cuadrilla Dos')], people, checks: ['Comprobar soporte'], pin, folderUrl: '', siteCode: '' },
  'schwab.roster': { crews: [{ id: 'crew-a', name: 'Cuadrilla Uno' }, { id: 'crew-b', name: 'Cuadrilla Dos' }], people },
  'schwab.tasks': [task('uno', 'crew-a', 'person-a'), task('dos', 'crew-b', 'person-b')],
  'schwab.hours': [shift('my-shift', 'old-device', 'person-a')],
  'schwab.crewHours': [shift('crew-shift', 'other-device', 'person-b'), shift('gone-shift', 'other-device', 'person-b', true)],
  'schwab.reports': { [DAY]: { date: DAY, super: 'Oficina Prueba', status: 'At risk', results: 'Trabajo ficticio conservado', wins: 'Buen avance',
    decisions: [{ q: '¿Comprar soporte?', rec: 'Sí', by: DAY + 'T12:00', pm: 'Approved', pmNote: 'Compra ficticia autorizada' }],
    floors: [{ floor: 'Nivel 1', crews: [{ name: 'Cuadrilla Uno', na: false, workers: 1, labor: 2.25, done: 'Conducto ficticio' }] }],
    preparedBy: 'Oficina Prueba', pmReview: 'Revisado sin conexión', updatedAt: TS, lang: 'es', pmLang: 'es' } },
  'schwab.pin': pin, 'schwab.unlock': { until: TS + 12 * 36e5, fails: 0, wait: 0 },
  'schwab.device': { secret: deviceSecret, id: hash(deviceSecret).slice(0, 32) },
};
let mode = 'v7', subset = new Set(), cut = false, base, checks = 0, scenario = '';
const failures = [], sequence = [], network = [], cases = [];
const check = (condition, message) => { checks++; if (!condition) failures.push({ scenario, message }); console.log(`${condition ? 'ok' : 'FAIL'} ${checks}: ${message}`); };
function finishCase(completed = true) {
  const row = { scenario, completed, failures: failures.filter(f => f.scenario === scenario) };
  cases.push(row); console.log('CASE_RESULT ' + JSON.stringify(row));
}
const server = http.createServer((req, res) => {
  const file = new URL(req.url, 'http://127.0.0.1').pathname.slice(1) || 'index.html';
  const entry = { scenario, mode, file, outcome: 'served' }; network.push(entry);
  if (!files.includes(file)) { res.writeHead(404); return res.end(); }
  if (mode === 'subset' && file !== 'sw.js' && !subset.has(file)) { entry.outcome = 'network-cut'; return req.socket.destroy(); }
  const version = mode === 'v7' || (mode === 'subset' && file === 'sw.js') ? 'v7' : 'v9';
  const body = version === 'v7' ? old[file] : current[file];
  res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
    'cache-control': 'no-store', 'content-length': body.length, 'x-fixture-version': version });
  if (mode === 'cut-install' && file === 'report.mjs') {
    cut = true; entry.outcome = 'body-truncated'; res.write(body.subarray(0, 40));
    return setTimeout(() => res.destroy(), 100); // headers and part of a core body arrived; install must still reject.
  }
  res.end(body);
});
const poll = async (fn, label, timeout = 10000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); }
  throw Error('Timed out: ' + label);
};
function includes(actual, expected, label) {
  if (Array.isArray(expected)) { assert.ok(Array.isArray(actual), label); assert.equal(actual.length, expected.length, label + ' length'); expected.forEach((v, i) => includes(actual[i], v, label + '[' + i + ']')); }
  else if (expected && typeof expected === 'object') { assert.ok(actual && typeof actual === 'object', label); for (const [k, v] of Object.entries(expected)) includes(actual[k], v, label + '.' + k); }
  else assert.deepEqual(actual, expected, label);
}
async function records(p, expected) {
  const actual = await p.evaluate(keys => Object.fromEntries(keys.map(k => [k, JSON.parse(localStorage.getItem(k))])), Object.keys(expected));
  try { includes(actual, expected, 'saved records'); check(true, 'all seeded records, edits, roster relationships, PIN and device identity survive'); }
  catch (e) { check(false, e.message); }
}
async function context(browser) {
  const { defaultBrowserType, ...phone } = devices['iPhone 13'];
  const c = await browser.newContext({ ...phone, locale: 'es-US', timezoneId: 'America/New_York', serviceWorkers: 'allow' });
  c.versions = new Map(); c.oldVersion = ''; c.expected = JSON.parse(JSON.stringify(seed)); c.pagesOpened = 0;
  await c.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  await c.addInitScript(data => { if (location.hostname === '127.0.0.1' && !localStorage.getItem('v7-fixture-seeded')) {
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v));
    localStorage.setItem('v7-fixture-seeded', 'yes'); // never reseed when opening another tab or offline.
  } }, seed);
  return c;
}
async function page(c) {
  const p = await c.newPage(); p.assets = []; p.pending = []; p.errors = []; p.consoleErrors = []; p.openNumber = ++c.pagesOpened;
  p.setDefaultTimeout(10000);
  await p.clock.install({ time: new Date(TS) });
  p.on('pageerror', e => p.errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') p.consoleErrors.push(m.text()); });
  p.on('response', r => {
    const file = new URL(r.url()).pathname.slice(1) || 'index.html';
    if (!files.includes(file)) return;
    p.pending.push((async () => {
      try { const sha256 = hash(await r.body()); p.assets.push({ file, sha256, version: Object.entries(hashes[file]).filter(([, h]) => h === sha256).map(([v]) => v).join('+') || 'unknown', fromServiceWorker: r.fromServiceWorker() }); }
      catch (e) { p.assets.push({ file, bodyError: e.message.split('\n')[0], fromServiceWorker: r.fromServiceWorker() }); }
    })());
  });
  p.cdp = await c.newCDPSession(p);
  p.target = (await p.cdp.send('Target.getTargetInfo')).targetInfo.targetId;
  p.cdp.on('ServiceWorker.workerVersionUpdated', e => { for (const v of e.versions) c.versions.set(v.versionId, v); });
  await p.cdp.send('ServiceWorker.enable');
  return p;
}
async function snapshot(p, label) {
  await Promise.allSettled(p.pending);
  const state = await p.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration(), cachesOut = {};
    for (const key of await caches.keys()) {
      const c = await caches.open(key); cachesOut[key] = {};
      for (const req of await c.keys()) {
        const buf = await (await c.match(req)).arrayBuffer(), digest = await crypto.subtle.digest('SHA-256', buf);
        cachesOut[key][new URL(req.url).pathname.slice(1) || './'] = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
      }
    }
    return { controlled: !!navigator.serviceWorker.controller, controllerIsActive: !!r?.active && navigator.serviceWorker.controller === r.active, controllerURL: navigator.serviceWorker.controller?.scriptURL, active: r?.active?.state, waiting: r?.waiting?.state, installing: r?.installing?.state,
      appStarted: !!window.appStarted, title: document.querySelector('#title')?.textContent, appText: document.querySelector('#app')?.innerText.slice(0, 150), lang: document.documentElement.lang, caches: cachesOut };
  });
  // A service-worker client id changes on navigation. Match the active version only after the page
  // proves its controller is registration.active; scriptURL alone cannot distinguish releases.
  const v = state.controllerIsActive && [...p.context().versions.values()].find(v => v.status === 'activated');
  const controlling = v ? (v.versionId === p.context().oldVersion ? 'v7' : p.context().oldVersion ? 'v9' : 'unclassified') : 'unobserved';
  const assets = [...p.assets], versions = new Set(assets.filter(x => x.version && !x.version.includes('+')).map(x => x.version));
  const row = { scenario, label, openNumber: p.openNumber, mode, controllerVersionId: v?.versionId, controlling, loadedBuild: versions.size > 1 ? 'mixed' : [...versions][0] || 'unknown', assets, errors: [...p.errors], consoleErrors: [...p.consoleErrors], ...state };
  sequence.push(row); console.log('OPEN_SEQUENCE ' + JSON.stringify(row));
  return row;
}
async function usable(p, label) {
  await p.waitForFunction(() => (window.appStarted && document.querySelector('#app')?.childElementCount) ||
    /La app no terminó de cargar/.test(document.querySelector('#app')?.textContent || ''), null, { timeout: 8500 }).catch(() => {});
  const result = await p.evaluate(() => {
    const app = document.querySelector('#app'), fallback = /La app no terminó de cargar/.test(app?.textContent || '');
    const visible = !!app && [...app.children].some(el => el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true }) && el.getBoundingClientRect().height > 0);
    return { working: !!window.appStarted && !!app?.childElementCount, fallback: fallback && [...app.querySelectorAll('button')].some(b => b.textContent === 'Recargar'), visible, text: app?.innerText || '' };
  });
  check(result.visible && (result.working || result.fallback), label + ': usable app or built-in Spanish reload recovery, never blank');
  if (result.fallback) check(!/didn.t finish|Get signal|Reload/.test(result.text), label + ': fallback instructions are Spanish');
  return result;
}
async function spanish(p, label) {
  const strings = await p.evaluate(() => {
    const out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const shown = el => el?.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true }) && !el.closest('script,style,textarea,datalist,select,[hidden]');
    for (let n; (n = w.nextNode());) if (shown(n.parentElement)) out.push(n.textContent.replace(/\s+/g, ' ').trim());
    for (const el of document.querySelectorAll('[aria-label],[placeholder]')) if (shown(el)) for (const a of ['aria-label', 'placeholder']) if (el.hasAttribute(a)) out.push(el.getAttribute(a));
    return out;
  });
  const found = [...new Set(strings.filter(s => english.includes(norm(s))))];
  check(found.length === 0, label + ': visible labels/accessibility strings have no untranslated English dictionary key: ' + JSON.stringify(found));
}
async function open(p, label, reload = false) {
  p.assets = []; p.pending = []; p.errors = []; p.consoleErrors = [];
  if (reload) await p.reload({ waitUntil: 'load' }); else await p.goto(base + 'tasks.html#day/' + DAY, { waitUntil: 'load' });
  const state = await usable(p, label);
  await p.waitForTimeout(150); // let the old worker's background response bodies finish; never simulates activation.
  check(!state.working || p.errors.length === 0, label + ': running UI has no JavaScript exception: ' + JSON.stringify(p.errors));
  await records(p, p.context().expected);
  const row = await snapshot(p, label);
  if (state.working) await spanish(p, label);
  return row;
}
async function boot(c) {
  mode = 'v7';
  const p = await page(c); await open(p, 'v7 first open');
  await p.waitForFunction(() => !!navigator.serviceWorker.controller);
  await poll(() => [...c.versions.values()].some(v => v.controlledClients?.includes(p.target)), 'CDP v7 controller');
  c.oldVersion = [...c.versions.values()].find(v => v.controlledClients?.includes(p.target)).versionId;
  // Preserve legitimate one-time normalization of identity/defaults; original semantic seed must still be present.
  c.expected['schwab.device'] = await p.evaluate(() => JSON.parse(localStorage.getItem('schwab.device')));
  const row = await open(p, 'v7 cached reopen', true);
  check(row.controlling === 'v7' && row.loadedBuild === 'v7', 'exact historical v7 worker controls exact historical app responses');
  check(oldCore.every(f => row.caches['schwab-field-apps-v7']?.[f] === hashes[f === './' ? 'index.html' : f].v7), 'initial v7 cache contains every historical core byte');
  return p;
}
async function update(p) {
  return p.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    if (r.waiting) return 'already-waiting';
    const wait = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('worker install did not settle')), 12000);
      const observe = w => {
        const done = () => { if (['installed', 'redundant'].includes(w.state)) { clearTimeout(timer); resolve(w.state); } };
        w.addEventListener('statechange', done); done();
      };
      if (r.installing) observe(r.installing);
      else r.addEventListener('updatefound', () => observe(r.installing), { once: true });
    });
    await r.update(); return wait;
  });
}
async function complete(c, p, label) {
  mode = 'v9'; console.log('EXPLICIT_UPDATE ' + JSON.stringify({ scenario, label, reason: 'bounded install check; not evidence of automatic second-open timing' }));
  check(['installed', 'already-waiting'].includes(await update(p)), label + ': complete target finishes installing');
  await snapshot(p, label + ' before close');
  await Promise.all(c.pages().map(p => p.close()));
  await poll(async () => (await Promise.all(c.serviceWorkers().map(w => w.evaluate(() => typeof CACHE !== 'undefined' && CACHE === 'schwab-field-apps-v9' && !self.registration.waiting && self.registration.active?.state === 'activated').catch(() => false)))).some(Boolean), 'v9 activates after all copies close');
  p = await page(c); const row = await open(p, label + ' reopened after all copies closed');
  check(row.controlling === 'v9' && row.controlled, label + ': v9 controls the reopened document (CDP client/version)');
  check(row.appStarted && row.title === 'Hoy' && row.errors.length === 0, label + ': completed v9 is running its Spanish board, not a fallback');
  check(row.loadedBuild === 'v9' && row.assets.filter(a => a.file !== 'sw.js').every(a => a.version?.includes('v9') && a.fromServiceWorker), label + ': every loaded core response is target bytes from the worker');
  check(core.every(f => row.caches[cacheName]?.[f] === hashes[f === './' ? 'index.html' : f].v9), label + ': complete target core cache matches every release byte');
  check(!row.caches['schwab-field-apps-v7'], label + ': activation retired v7 cache');
  await c.setOffline(true); const offline = await open(p, label + ' offline reopen', true);
  check(offline.controlling === 'v9' && offline.loadedBuild === 'v9', label + ': offline reopen stays wholly on v9');
  await p.evaluate(() => { location.hash = '#task/uno/results'; });
  await p.waitForSelector('[data-k="t.doneText"]');
  await p.fill('[data-k="t.doneText"]', 'Edición nueva sin señal');
  c.expected['schwab.tasks'][0].doneText = 'Edición nueva sin señal';
  delete c.expected['schwab.tasks'][0].updatedAt; // a real user edit changes its stamp.
  await open(p, label + ' offline edit reload', true);
  check(await p.inputValue('[data-k="t.doneText"]') === 'Edición nueva sin señal' && await p.locator('[data-act="tab"][data-v="results"]').textContent() === 'Resultados', label + ': saved offline task is rendered with its Spanish results tab');
  await c.setOffline(false);
  for (const [route, selector, title] of [['report/' + DAY, '[data-k="r.results"]', 'Reporte diario'], ['clock/' + DAY, '[data-k^="h."]', 'Horas'], ['settings', '[data-k="s.project"]', 'Ajustes']]) {
    await p.evaluate(h => { location.hash = '#' + h; }, route); await p.waitForSelector(selector); await spanish(p, label + ' ' + route);
    check(await p.locator('#title').textContent() === title, label + ': translated screen heading ' + title);
  }
  await records(p, c.expected);
  check(p.errors.length === 0, label + ': task, report, hours and settings have no JavaScript exception: ' + JSON.stringify(p.errors));
  return p;
}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    let c, p;
    for (const [label, list] of [['dictionary only', ['es.mjs']], ['shared plus dictionary', ['shared.mjs', 'es.mjs']], ['new document with old modules', ['tasks.html']], ['new report with old shared module', ['report.mjs']]]) {
      scenario = 'partial-v7-refresh: ' + label;
      c = await context(browser); p = await boot(c);
      mode = 'subset'; subset = new Set(list);
      await open(p, label + ' background refresh', true);
      await poll(() => p.evaluate(async expected => {
        const c = await caches.open('schwab-field-apps-v7');
        for (const [file, wanted] of expected) {
          const r = await c.match(file); if (!r) return false;
          const digest = await crypto.subtle.digest('SHA-256', await r.arrayBuffer());
          if ([...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('') !== wanted) return false;
        }
        return true;
      }, list.map(f => [f, hashes[f].v9])), label + ': selected target bytes reach the actual v7 cache');
      check(true, label + ': every selected partial download is verified in v7 cache before going offline');
      await c.setOffline(true);
      const mixed = await open(p, label + ' mixed cached offline reopen', true);
      check(mixed.loadedBuild === 'mixed' && mixed.controlling === 'v7', label + ': the intended old/new asset mixture actually loaded under v7');
      await c.setOffline(false);
      await complete(c, p, label + ' migration recovered'); await c.close(); finishCase();
    }

    scenario = 'normal-publish-open-sequence';
    c = await context(browser); p = await boot(c); mode = 'v9';
    for (let n = 1; n <= 3; n++) await open(p, 'natural online reopen ' + n, true);
    await complete(c, p, 'normal publish'); await c.close(); finishCase();

    scenario = 'two-v7-tabs';
    c = await context(browser); p = await boot(c);
    const second = await page(c); await open(second, 'second v7 tab'); mode = 'v9';
    check(['installed', 'already-waiting'].includes(await update(p)), 'v9 installed while two v7 tabs remain');
    await snapshot(p, 'two old tabs, target waiting');
    await second.evaluate(() => { location.hash = '#settings'; }); await second.waitForSelector('[data-k="s.project"]');
    await second.fill('[data-k="s.project"]', 'Proyecto editado en pestaña antigua'); await second.locator('[data-k="s.project"]').blur();
    c.expected['schwab.settings'].project = 'Proyecto editado en pestaña antigua';
    await records(second, c.expected);
    await p.close();
    check(await second.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), 'closing only one old tab does not activate target');
    await open(second, 'remaining v7 tab reload while target waits', true);
    await complete(c, second, 'two-tab migration'); await c.close(); finishCase();

    scenario = 'interrupted-first-install';
    c = await context(browser); p = await boot(c); mode = 'cut-install'; cut = false;
    check(await update(p) === 'redundant', 'truncated first target core body rejects installation');
    check(cut, 'server actually cut a core response after headers and initial bytes');
    const broken = await open(p, 'old phone after interrupted first install', true);
    check(broken.controlling === 'v7', 'failed target installation leaves v7 controlling');
    await complete(c, p, 'interrupted download recovered'); await c.close(); finishCase();
  } catch (e) {
    failures.push({ scenario, fatal: true, message: e.stack || e.message }); finishCase(false); console.error(e);
  } finally {
    await browser.close(); await new Promise(r => server.close(r));
    console.log('NETWORK ' + JSON.stringify(network));
    console.log('RESULT ' + JSON.stringify({ fixture: OLD, target: TARGET, completed: cases.length === 7 && cases.every(c => c.completed), cases, checks, failures, opens: sequence.length }));
  }
  if (failures.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
