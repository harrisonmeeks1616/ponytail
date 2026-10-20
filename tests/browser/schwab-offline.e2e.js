#!/usr/bin/env node
// Real service-worker regression: a fictional task remains usable after an offline reload, in both languages.
// Serve docs/schwab locally, then BASE=http://127.0.0.1:8767/ node tests/browser/schwab-offline.e2e.js.
// Uses an isolated Chromium context; no hub, upload endpoint, workforce records or external messages.
'use strict';
const assert = require('node:assert/strict');
const { chromium, devices } = require('playwright');
const BASE = (process.env.BASE || 'http://127.0.0.1:8767/').replace(/\/*$/, '/');
const taskId = 'offline-fixture', route = '#task/' + taskId + '/results';
(async () => {
  const browser = await chromium.launch();
  try {
    const phone = { ...devices['iPhone 13'] }; delete phone.defaultBrowserType;
    const context = await browser.newContext({ ...phone, serviceWorkers: 'allow' });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(id => {
      if (sessionStorage.getItem('offline-seeded')) return;
      localStorage.setItem('schwab.settings', JSON.stringify({ lang: 'en', role: 'Crew member', me: 'Offline Test', worker: 'Offline Test' }));
      localStorage.setItem('schwab.tasks', JSON.stringify([{ uid: id, id: 'T-OFFLINE', origin: 'link', date: '2026-10-19',
        crew: 'Fictional crew', floor: 'Test floor', members: ['Offline Test'], size: 1, scope: 'Fictional offline check',
        items: [{ id: 'step-offline', text: 'Fictional check', done: false }], updatedAt: 1 }]));
      sessionStorage.setItem('offline-seeded', 'yes');
    }, taskId);
    await page.goto(BASE + 'tasks.html' + route);
    await page.waitForSelector('[data-k="t.doneText"]');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller); // bounded failure if install or activation breaks
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // the installed worker now controls every core module request
    await page.waitForSelector('[data-k="t.doneText"]');
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'the app is controlled by its real service worker');
    assert.equal(await page.getAttribute('html', 'lang'), 'en');
    await page.fill('[data-k="t.doneText"]', 'Saved while online.');
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('[data-k="t.doneText"]');
    assert.equal(await page.inputValue('[data-k="t.doneText"]'), 'Saved while online.');
    await page.fill('[data-k="t.doneText"]', 'Edited with no signal.');
    await page.locator('[data-act="clock"][data-v="aStart"]').click();
    await page.locator('.tick').first().click();
    await page.reload();
    await page.waitForSelector('[data-k="t.doneText"]');
    assert.equal(await page.inputValue('[data-k="t.doneText"]'), 'Edited with no signal.');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('schwab.tasks'))[0]);
    assert.ok(stored.aStart && stored.items[0].done, 'offline time and checklist edits persist');
    const assets = await page.evaluate(async () => {
      const files = ['./', 'index.html', 'tasks.html', 'report.html', 'report.mjs', 'shared.mjs', 'sync.mjs', 'live.mjs', 'es.mjs', 'shared.css'];
      return Promise.all(files.map(async file => { const r = await fetch(file, { cache: 'reload' }); return [file, r.ok, (await r.text()).length]; }));
    });
    assert.ok(assets.every(([, ok, size]) => ok && size > 0), 'all precached entry points, modules, Spanish strings and styles remain available offline');
    await page.click('#langBtn');
    await page.waitForFunction(() => document.documentElement.lang === 'es');
    assert.match(await page.textContent('[data-act="sendResults"]'), /Enviar/);
    await page.fill('[data-k="t.doneText"]', 'Cambio ficticio sin conexión.');
    await page.reload();
    await page.waitForSelector('[data-k="t.doneText"]');
    assert.equal(await page.getAttribute('html', 'lang'), 'es');
    assert.equal(await page.inputValue('[data-k="t.doneText"]'), 'Cambio ficticio sin conexión.');
    await page.goto(BASE + 'index.html' + route); // the cached legacy entry redirects while still offline
    await page.waitForSelector('[data-k="t.doneText"]');
    assert.equal(await page.inputValue('[data-k="t.doneText"]'), 'Cambio ficticio sin conexión.');
    assert.deepEqual(errors, [], 'no page errors across controlled/offline English and Spanish loads');
    console.log('PASS: service worker controls the app; all core assets and English/Spanish task edits survive offline reloads.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
