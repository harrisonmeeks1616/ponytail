#!/usr/bin/env node
// Fictional isolated phones: Settings role changes never upgrade a connected key's permissions.
// Run with the app server BASE and the disposable local hub HUBDEV (never a real Google deployment).
// Start: python -m http.server 8767 --bind 127.0.0.1 --directory docs/schwab
// Start separately: node tests/browser/hub-dev-server.js 8788
// Run: node tests/browser/schwab-role-guard.e2e.js (needs Playwright/Chromium; NODE_PATH may point to bundled modules).
// Defaults are those two local ports; BASE/HUBDEV can override. The test resets HUBDEV: use a dedicated disposable hub.
// Fake script.google.com requests are intercepted and sent only to that local hub; no real account or workforce data.
'use strict';
const { chromium, devices } = require('playwright');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const BASE = (process.env.BASE || 'http://127.0.0.1:8767/').replace(/\/*$/, '/');
const HUBDEV = (process.env.HUBDEV || 'http://127.0.0.1:8788/').replace(/\/*$/, '/');
const HUBURL = 'https://script.google.com/macros/s/TESTHUB/exec';
const DAY = '2026-10-14', NOW = new Date(DAY + 'T10:00:00-04:00'), TS = +NOW;
const salt = '0123456789abcdef', pin = `${salt}:${crypto.createHash('sha256').update(salt + ':1234').digest('hex')}`;
const shift = id => ({ id, device: '', who: 'Fictional Worker', pid: '', crew: 'Crew A', crewId: '', tasks: [], date: DAY, in: '07:00', out: '09:00', edited: { who: false, in: false, out: false }, gone: false, at: TS });
const errors = [];
let browser, keys, checks = 0;
function check(ok, msg) { assert.ok(ok, msg); console.log('  ok ', msg); checks++; }
async function phone(lang, hubRole, localRole = 'Project manager') {
  const { defaultBrowserType, ...device } = devices['iPhone 13'];
  const ctx = await browser.newContext({ ...device, locale: 'en-US', timezoneId: 'America/New_York', serviceWorkers: 'block' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route(/script\.google\.com/, async r => {
    if (r.request().url() !== HUBURL) return r.abort();
    const res = await fetch(HUBDEV, { method: 'POST', body: r.request().postData() || '{}', headers: { 'Content-Type': 'text/plain' } });
    return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: await res.text() });
  });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  p.on('pageerror', e => errors.push(e.message));
  await p.clock.install({ time: NOW });
  const seed = {
    'schwab.settings': { lang, role: localRole, me: 'Fictional Office', super: 'Fictional Office', pm: 'Fictional PM', worker: 'Fictional Worker', project: 'Role guard test', site: '', pin, floors: ['Level 1'], crews: [{ name: 'Crew A', lead: '', members: '' }] },
    'schwab.pin': pin, 'schwab.unlock': { until: TS + 12 * 36e5, fails: 0, wait: 0 },
    'schwab.tasks': [], 'schwab.hours': [], 'schwab.crewHours': [shift('guard-' + lang + '-' + (hubRole || 'local'))],
    'schwab.reports': { [DAY]: { date: DAY, super: 'Fictional Office', decisions: [{ q: 'Fictional decision', rec: '', by: '', pm: '', pmNote: '' }], pmReview: '', updatedAt: TS } },
    ...(hubRole ? { 'schwab.hub': { hubUrl: HUBURL, hubKey: keys[hubRole], hubRole, hubCrew: '' } } : {}),
  };
  await p.addInitScript(seed => { if (!sessionStorage.seeded) { for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v)); sessionStorage.seeded = '1'; } }, seed);
  await p.goto(BASE + 'tasks.html#settings');
  await p.waitForSelector('[data-k="s.role"]');
  if (hubRole) await p.evaluate(() => import('./sync.mjs').then(m => m.cycle()));
  return p;
}
async function nav(p, hash, sel) {
  await p.evaluate(h => { location.hash = h; }, hash);
  if (sel) await p.waitForSelector(sel, { state: 'attached' });
}
const local = (p, key) => p.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
const code = (p, data) => p.evaluate(d => import('./shared.mjs').then(m => m.pack(d)), data);
const hoursLink = p => code(p, { v: 1, kind: 'hours', at: TS, shifts: [{ ...shift('imported'), device: 'fictional-device', who: 'Fictional Import' }] });
async function importHours(p) {
  await nav(p, '#p=' + await hoursLink(p));
  await p.waitForFunction(() => location.hash.startsWith('#clock/'));
  await p.waitForSelector('[data-act="hSend"]');
}
(async () => {
  keys = await (await fetch(HUBDEV + '__reset', { method: 'POST' })).json();
  await fetch(HUBDEV + '__clock', { method: 'POST', body: JSON.stringify({ set: TS }) });
  browser = await chromium.launch();
  try {
    for (const lang of ['en', 'es']) {
      console.log(lang + ': superintendent key remains read-only after Settings changes to PM');
      const p = await phone(lang, 'super', 'Superintendent');
      await nav(p, '#clock/' + DAY, '[data-act="hTap"]');
      await p.click('[data-act="hTap"]');
      await p.waitForFunction(() => JSON.parse(localStorage.getItem('schwab.hours') || '[]').length === 1);
      check((await local(p, 'schwab.hours'))[0].in === '10:00', lang + ': ordinary worker clock-in still saves');
      await nav(p, '#settings', '[data-k="s.role"]');
      await p.selectOption('[data-k="s.role"]', 'Project manager');
      const banner = lang === 'en' ? 'This phone is not connected with the PM key' : 'Este teléfono no está conectado con la clave del gerente de proyecto';
      await p.getByText(banner, { exact: true }).waitFor();
      check(await p.getByText(banner, { exact: true }).count() === 1, lang + ': role mismatch is visible immediately in Settings');
      await nav(p, '#clock/' + DAY, '[data-k^="h."]');
      check(await p.getByText(banner, { exact: true }).count() === 1, lang + ': Crew hours carries the mismatch banner');
      check(await p.locator('[data-k^="h."]').evaluateAll(es => es.length > 0 && es.every(e => e.disabled)), lang + ': Crew hours times are disabled');
      check(await p.locator('[data-act="hAdd"],[data-act="hRename"],[data-act="hDel"],[data-act="hCrew"]').count() === 0, lang + ': add, rename, remove, roster-link controls are absent');
      check(await p.locator('[data-act="hSend"]').isVisible(), lang + ': accountant export remains available');
      const before = await local(p, 'schwab.crewHours');
      await importHours(p);
      check(JSON.stringify(await local(p, 'schwab.crewHours')) === JSON.stringify(before), lang + ': opening a worker hours link cannot import with a superintendent key');
      await nav(p, '#report/' + DAY, '[data-k="r.pmReview"]');
      check(await p.getByText(banner, { exact: true }).count() === 1, lang + ': Daily report carries the mismatch banner');
      check(await p.locator('[data-k="r.pmReview"],[data-k$=".pmNote"],[data-k$=".pm"]').evaluateAll(es => es.length >= 2 && es.every(e => e.disabled)), lang + ': PM review, note and response controls are disabled');
      check(await p.locator('[data-act="stampPM"]').count() === 0, lang + ': PM review stamp is absent');
      await p.context().close();

      for (const role of ['pm', null]) {
        const q = await phone(lang, role);
        await nav(q, '#clock/' + DAY, '[data-k^="h."]');
        const input = q.locator('[data-k^="h."][data-k$=".in"]').first();
        check(await input.isEnabled(), `${lang}: ${role || 'no-hub'} times remain editable`);
        await input.fill('08:15'); await input.blur();
        check((await local(q, 'schwab.crewHours')).some(s => s.in === '08:15'), `${lang}: ${role || 'no-hub'} time correction persists`);
        await importHours(q);
        check((await local(q, 'schwab.crewHours')).some(s => s.id === 'imported'), `${lang}: ${role || 'no-hub'} hours-link import remains available`);
        await nav(q, '#report/' + DAY, '[data-k="r.pmReview"]');
        check(await q.locator('[data-k="r.pmReview"]').isEnabled(), `${lang}: ${role || 'no-hub'} PM report review remains editable`);
        if (!role) {
          const invite = await code(q, { v: 1, kind: 'join', role: 'super', hub: { url: HUBURL, key: keys.super } });
          await nav(q, '#p=' + invite); // refused at once, with no Join sheet first (GATE4-01)
          await q.waitForFunction(() => document.getElementById('toast')?.textContent?.trim());
          const message = await q.locator('#toast').textContent();
          check(!(await q.locator('dialog [data-join]').count()), lang + ': a PM tablet gets no Join sheet for a superintendent invite');
          check(lang === 'en' ? /superintendent invite/i.test(message) && !/not the PM key/.test(message) : /invitación para el superintendente/i.test(message), lang + ': a PM tablet identifies the refused superintendent invite correctly: ' + message.trim());
          check(!(await local(q, 'schwab.settings'))?.hubKey, lang + ': no key is stored from the refused invite');
          check(await q.evaluate(() => import('./sync.mjs').then(m => m.hubStatus().state)) === 'off', lang + ': refusing the wrong invite leaves the tablet disconnected');
        }
        await q.context().close();
      }
    }
    check(errors.length === 0, 'no browser runtime errors: ' + JSON.stringify(errors));
    console.log(`PASS ${checks} checks`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
