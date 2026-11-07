#!/usr/bin/env node
// End to end with the hub: six phones (PM, superintendent, Crew A, Crew B, two workers) against the local hub
// (tests/browser/hub-dev-server.js: docs/schwab/hub/Code.gs on the Google fake in tests/helpers/google-mock.js), through
// the app's real screens. Fictional data only.
//
// Run (needs Playwright and a Chromium; not part of `npm test`, which is node-only; about 10 minutes):
//   cd docs/schwab && python3 -m http.server 8765 --bind 127.0.0.1 &        # serve the app
//   BASE=http://127.0.0.1:8765/ node tests/browser/schwab-hub.e2e.js
//   (if Playwright is installed globally: NODE_PATH=$(npm root -g) ...)
// Screenshots of a crashed step or a screen wider than 320 px land in $TMPDIR/schwab-hub/ (SHOTS=dir moves them).
//
// Starts its own hub-dev-server.js on HUBPORT (default 8780; when that port is taken, the next free one of the nine after it) and
// stops it at the end. Every phone uses the address https://script.google.com/macros/s/TESTHUB/exec; page.route sends
// those requests to the local hub and hands its reply back, so the app runs unchanged. Translation is the hub's own
// (the fake's small en<->es dictionary). Each phone's clock is a Playwright fake clock started at the hub's time, and
// advanceAll() moves every phone and the hub together. Viewport 320 px wide; every screen is checked for side scroll.
// Exit code: 0 all checks passed, 1 a check failed or a page error happened, 2 the run itself crashed.
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE = (process.env.BASE || 'http://127.0.0.1:8765/').replace(/\/*$/, '/');
const HUBURL = 'https://script.google.com/macros/s/TESTHUB/exec';
const HUBPORT = Number(process.env.HUBPORT) || 8780;
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'schwab-hub');
const START = Date.parse('2026-10-19T06:45:00-04:00'); // a Monday, 6:45 AM on the job (America/New_York)
const DAY = '2026-10-19';
const PIN = '2468';
fs.mkdirSync(SHOTS, { recursive: true });

const fails = [], errors = [], phones = [];
let HUB = '', KEYS = null, hubProc = null, current = '';
const log = (...a) => console.log(...a);
const check = (ok, what) => { log(ok ? '  ok  ' : '  FAIL', what); if (!ok) fails.push(`[${current}] ${what}`); return !!ok; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function step(name, fn) {
  current = name;
  log(`\n${name}`);
  try { await fn(); } catch (e) {
    fails.push(`[${name}] crashed: ${String(e.message || e).split('\n')[0]}`);
    log('  FAIL crashed:', String(e.stack || e).split('\n').slice(0, 4).join(' | '));
    for (const p of phones) await p.screenshot({ path: path.join(SHOTS, `crash-${name.replace(/\W+/g, '-').slice(0, 40)}-${p.zq.name}.png`) }).catch(() => {});
  }
}
// Polls fn until it returns something truthy (or the time runs out); returns the last value.
async function until(fn, ms = 35000, every = 400) {
  const end = Date.now() + ms;
  let v;
  for (;;) {
    try { v = await fn(); } catch { v = undefined; }
    if (v || Date.now() > end) return v;
    await sleep(every);
  }
}

// ---------- the local hub ----------

function startHub() {
  const ports = [HUBPORT];
  for (let p = HUBPORT + 1; p <= HUBPORT + 9; p++) ports.push(p);
  const tryPort = port => new Promise(resolve => {
    const proc = spawn(process.execPath, [path.join(__dirname, 'hub-dev-server.js'), String(port)], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
    let out = '', done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    proc.stdout.on('data', d => {
      out += d;
      const line = out.split('\n').find(l => l.startsWith('{"pm"'));
      if (line) finish({ proc, port, keys: JSON.parse(line) });
    });
    proc.stderr.on('data', d => { out += d; });
    proc.on('exit', () => finish(null)); // EADDRINUSE and the like
    setTimeout(() => { if (!done) { proc.kill(); finish(null); } }, 8000);
  });
  return (async () => { for (const port of ports) { const r = await tryPort(port); if (r) return r; } throw new Error(`could not start hub-dev-server.js on ${HUBPORT}-${HUBPORT + 9}`); })();
}
const dev = async (route, body) => (await fetch(HUB + route, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })).json();
const hubNow = async () => (await dev('__clock', {})).now;
const dump = async () => dev('__dump?json=1');
const entities = (d, tab) => { const t = d[tab]; if (!t) return []; const i = t.header.indexOf('data'); return t.rows.map(r => { try { return JSON.parse(r[i]); } catch { return null; } }).filter(Boolean); };
const hubSend = async body => (await fetch(HUB, { method: 'POST', body: JSON.stringify({ v: 1, ...body }), headers: { 'Content-Type': 'text/plain' } })).json();

// ---------- phones ----------

let browser;
async function phone(name, o = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    locale: o.locale || 'en-US', timezoneId: 'America/New_York', serviceWorkers: 'block', acceptDownloads: true,
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(10000);
  p.zq = { name, down: false, log: [] };
  phones.push(p);
  p.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name} console: ${m.text()}`); }); // Google Fonts is aborted on purpose
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route(/script\.google\.com/, r => hubRoute(p, r));
  await p.clock.install({ time: new Date(await hubNow()) }); // the phone's clock starts at the hub's time and runs with it
  await p.addInitScript(() => { globalThis.__SCHWAB_EXPERIMENTAL_REVIEW__ = true; });
  await p.addInitScript(() => {
    window.__toasts = [];
    new MutationObserver(ms => { // every toast text, even one replaced before the test looks
      for (const m of ms) { const el = (m.target.nodeType === 3 ? m.target.parentElement : m.target)?.closest?.('#toast'); if (el && el.textContent && window.__toasts.at(-1) !== el.textContent) window.__toasts.push(el.textContent); }
    }).observe(document, { childList: true, characterData: true, subtree: true });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
  });
  return p;
}
// The fake hub address goes to the local hub; a phone "offline" (p.zq.down) gets no answer. Every exchange is kept per phone.
async function hubRoute(p, r) {
  const req = r.request();
  if (req.url() !== HUBURL) return r.abort();
  if (p.zq.down) return r.abort('internetdisconnected');
  if (p.zq.answer) return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(p.zq.answer) }); // the hub refusing every call
  if (p.zq.slow) { p.zq.waiting = true; await sleep(p.zq.slow); } // a slow answer; a call already on its way gets through even if the signal goes meanwhile
  const body = req.postData() || '';
  let q = {};
  try { q = JSON.parse(body); } catch {}
  if (p.zq.rejectShift && q.action === 'push' && Array.isArray(q.shifts) && q.shifts.length) return r.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify({ok:true,rev:0,shifts:q.shifts.map((s,i)=>({i,key:s.id,status:'rejected',reason:'update_required'}))})});
  if (p.zq.lieShift && q.action === 'push' && Array.isArray(q.shifts) && q.shifts.length) return r.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify({ok:true,rev:0,shifts:q.shifts.map((s,i)=>({i,key:s.id,status:'ok',shift:{...s,workerState:'',workerOut:''}}))})});
  if (p.zq.hold?.action === q.action) { p.zq.hold.seen = true; await p.zq.hold.done; } // an answer held back until the check lets it go
  try {
    const res = await fetch(HUB, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } });
    const text = await res.text();
    p.zq.log.push({ action: q.action, q, at: Date.now(), reply: text });
    return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: text });
  } catch { return r.abort(); }
}
async function advanceAll(ms) {
  await dev('__clock', { advance: ms });
  for (const p of phones) if (!p.isClosed()) await p.clock.fastForward(ms);
}

const nav = async (p, hash) => { await p.evaluate(h => { if (location.hash === h) dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h; }, hash); await p.waitForTimeout(250); };
const pad = async (p, code) => { for (const d of code) { await p.click(`dialog [data-pin="${d}"]`); await p.waitForTimeout(60); } await p.waitForTimeout(300); };
const local = (p, key) => p.evaluate(k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, key);
const toasts = p => p.evaluate(() => window.__toasts.splice(0));
const sawToast = async (p, re, ms = 8000) => !!(await until(async () => { const t = await p.evaluate(() => window.__toasts.slice()); return t.some(x => re.test(x)); }, ms, 200));
const takeLink = async p => { const d = p.locator('dialog[open]:has(.linkbox)'); await d.locator('.linkbox').waitFor(); const v = await d.locator('.linkbox').inputValue(); await d.locator('.sheet-x').click(); await p.waitForTimeout(150); return v; };
const unpack = (p, url) => p.evaluate(async u => (await import('./shared.mjs')).unpack(new URL(u).hash.slice(3)), url);
const hubStatus = p => p.evaluate(() => import('./sync.mjs').then(m => m.hubStatus())); // reads the engine's state; never drives it
const syncNow = p => p.evaluate(() => import('./sync.mjs').then(m => m.cycle())); // that phone's next sync round, now
const blur = p => p.evaluate(() => document.activeElement?.blur?.()); // a tap outside the field
const text = (p, sel) => p.locator(sel).first().textContent().then(t => t.replace(/\s+/g, ' ').trim()).catch(() => ''); // textContent: the screen's CSS upper-cases pills and labels
const dot = p => p.evaluate(() => { const b = document.querySelector('#hubDot .hubdot, #officeTabs .hubdot'); return b ? { state: b.dataset.state, label: b.getAttribute('aria-label') } : null; }); // signed in, on the Live tab (PHONE-UX-13)
const brandSize = p => p.evaluate(() => ['.brand h1', '.brand p'].map(s => getComputedStyle(document.querySelector(s)).fontSize).join(' / ')); // the two company names
// Side scroll at 320 px: the page and any open sheet.
async function narrow(p, screen) {
  const r = await p.evaluate(() => {
    const wide = el => el.scrollWidth > el.clientWidth + 1;
    const d = document.querySelector('dialog[open] .sheet-in') || document.querySelector('dialog[open]');
    const over = [...document.querySelectorAll('#app *, dialog[open] *, .top *, .bar *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed' && el.offsetParent !== null && !el.closest('.chips.scroll, .scroll'))
      .slice(0, 3).map(el => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(el.getBoundingClientRect().right)}`);
    return { doc: document.documentElement.scrollWidth, width: innerWidth, dialog: d ? wide(d) : false, over };
  });
  const ok = r.doc <= 320 && !r.dialog;
  check(ok, `320 px, no side scroll: ${screen}` + (ok ? '' : ` (scrollWidth ${r.doc}, dialog wide ${r.dialog}, ${r.over.join('; ')})`));
  if (!ok) await p.screenshot({ path: path.join(SHOTS, `wide-${screen.replace(/\W+/g, '-').slice(0, 50)}.png`), fullPage: true }).catch(() => {});
}
// The Live board as the PM sees it: every sheet card.
const liveCards = p => p.evaluate(() => [...document.querySelectorAll('.live-card, .live-done')].map(c => ({
  id: c.querySelector('.tid')?.textContent.trim(), pills: [...c.querySelectorAll('.pill, .stage')].map(x => x.textContent.trim()), meta: [...c.querySelectorAll('.meta')].map(x => x.textContent.replace(/\s+/g, ' ')).join(' | '),
  note: (() => { const t = c.querySelector('.live-note .tx'); return t ? { state: t.dataset.state, view: t.dataset.view, tr: t.querySelector('.tx-t')?.textContent || '', orig: t.querySelector('.tx-o')?.textContent || '', cap: t.querySelector('.tx-cap')?.textContent || '' } : { plain: c.querySelector('.live-note')?.textContent || '' }; })(),
  review: !!c.querySelector('[data-act=liveReview]'), uid: c.querySelector('[data-u]')?.dataset.u || '',
})));
const card = async (p, id) => (await liveCards(p)).find(c => c.id === id);
const daySum = p => p.evaluate(() => document.querySelector('.day-sum')?.textContent.replace(/\s+/g, ' ').trim() || ''); // Live's quiet line (shared.mjs daySummary)
const taskOf = async (p, uid) => (await local(p, 'schwab.tasks') || []).find(t => t.uid === uid);
const sinceMark = p => p.evaluate(() => window.__mark === 1); // set once; a reload would clear it

// A brand new phone opens a hub invite link: the language question on a new crew phone, then the join sheet.
async function join(p, link, o = {}) {
  await p.goto(link);
  await p.waitForFunction(() => window.appStarted === true);
  await p.waitForSelector('dialog.firstrun [data-fr=lang]'); // a new phone: the first run asks the language, the invite says who uses the phone
  await p.click(`dialog.firstrun [data-fr=lang][data-v=${o.lang || 'en'}]`);
  await p.waitForSelector('dialog [data-join]');
  const sheetText = await text(p, 'dialog[open]');
  const chips = await p.locator('dialog [data-crew]').allTextContents(), who = await p.locator('dialog [data-who]').allTextContents();
  if (o.name !== undefined) await p.fill('dialog [name=who]', o.name);
  if (o.pick) await p.click(`dialog [data-who="${o.pick}"]`); // a name the invite carries
  if (o.crew) await p.click(`dialog [data-crew="${o.crew}"]`);
  await narrow(p, `join sheet (${p.zq.name})`);
  await p.click('dialog [data-join]');
  const ok = await sawToast(p, /^(Connected as (the superintendent|a crew phone( for .+)?)|Conectado como (superintendente|teléfono de cuadrilla( de .+)?))$/, 10000); // it says which (OWNER3)
  return { ok, sheetText, chips: chips.map(c => c.trim()), who: who.map(c => c.trim()), toast: (await p.evaluate(() => window.__toasts.slice())).at(-1) };
}

(async () => {
  const h = await startHub();
  hubProc = h.proc; HUB = `http://127.0.0.1:${h.port}/`; KEYS = h.keys;
  log(`local hub on port ${h.port}${h.port !== HUBPORT ? ` (${HUBPORT} was taken by another process)` : ''}`);
  await dev('__clock', { real: true });
  await dev('__clock', { advance: START - Date.now() }); // the hub's clock runs from the job's morning, like every phone's
  browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}); // PW_CHANNEL=chrome: the system Chrome where no bundled Chromium is installed
  let pm, sup, ca, cb, w1, w2, make; // make: a new sheet from the superintendent phone (step 3)
  const links = {}, S = {}; // invite links; the sheets' uids and ids

  await step('1. PM connects in Settings > Hub, the test passes, invites are made', async () => {
    pm = await phone('PM');
    await pm.goto(BASE + 'tasks.html#settings');
    await pm.click('dialog.firstrun [data-fr=lang][data-v=en]'); // the first run: language, who uses the phone, name, then the passcode
    await pm.click('dialog.firstrun [data-fr=role][data-v="Project manager"]');
    await pm.fill('#frName', 'Pat PM');
    await pm.click('dialog.firstrun [data-fr=next]');
    await pm.waitForSelector('dialog .keypad');
    await pad(pm, PIN); await pad(pm, PIN);
    await pm.waitForSelector('[data-k="s.me"]');
    await pm.selectOption('select[data-k="s.role"]', 'Project manager');
    await pm.waitForTimeout(200);
    await pm.fill('[data-k="s.me"]', 'Pat PM');
    const addPeople = async (i, names) => { const box = pm.locator('input[data-enter=pAdd]').nth(i); await box.fill(names); await box.press('Enter'); await pm.waitForTimeout(200); };
    await addPeople(0, 'Jose L, Ana R');
    await addPeople(1, 'Luis M, Rosa P');
    await pm.fill('[data-k="s.crews.2.name"]', 'Low voltage'); // crews get real names on a job
    await blur(pm);
    check(!(await dot(pm)), 'no hub yet: no status dot in the header');
    const names0 = await brandSize(pm);
    await pm.fill('#hubUrl', HUBURL);
    await pm.fill('#hubKey', KEYS.pm);
    await narrow(pm, 'Settings, hub not connected');
    await pm.click('[data-act=hubConnect]');
    check(await sawToast(pm, /^Connected as Project manager$/), 'Connect: "Connected as Project manager"');
    check(await until(async () => (await dot(pm))?.state === 'live', 15000), 'the header dot turns Live');
    check(await brandSize(pm) === names0 && !(await pm.locator('#hubDot .hubdot').count()) && await pm.locator('#officeTabs a[href="#live"] .hubdot').count() === 1,
      `PHONE-UX-13: signed in at 320 px the dot rides on the Live tab, and both company names keep their no-hub size (${names0} without the hub, ${await brandSize(pm)} with it)`);
    const tabs = await pm.locator('#officeTabs a').allTextContents();
    check(tabs.includes('Live') && tabs.includes('Records') && tabs.includes('Hours'), `office tabs gain Live and Records (${tabs.join(', ')})`);
    await pm.click('[data-act=hubTest]');
    await pm.waitForSelector('.checks li', { timeout: 30000 });
    const results = await pm.$$eval('.checks li', ls => ls.map(l => [l.dataset.ok, l.textContent.replace(/\s+/g, ' ').trim()]));
    check(results.length >= 5 && results.every(([ok]) => ok === 'true') && /Everything works/.test(await text(pm, '#app')), `Test the hub: every check passes (${results.map(r => r[1]).join(' / ')})`);
    await narrow(pm, 'Settings, hub connected, test results');
    const cfg = await until(async () => entities(await dump(), 'Config')[0], 15000);
    check(cfg && cfg.people?.length === 4 && cfg.crews?.some(c => c.name === 'Low voltage') && /^[0-9a-f]{16}:/.test(cfg.pin), 'the PM roster, crews and the passcode hash reach the hub config');
    await pm.click('[data-act=hubInvite][data-v=super]');
    await pm.waitForSelector('dialog .linkbox');
    const invText = await text(pm, 'dialog[open]');
    check(/Send it only to the person it is for/.test(invText) && !/work details/.test(invText), `OWNER3-05: the invite sheet says the link carries the hub key, not that work details are inside it (${invText.slice(0, 160)})`);
    links.super = await takeLink(pm);
    const invite = async crew => { await pm.click('[data-act=hubInvite][data-v=crew]'); await pm.waitForSelector('dialog [data-crew]'); await narrow(pm, 'Invite crew: which crew'); await pm.click(`dialog [data-crew="${crew}"]`); return takeLink(pm); };
    links.a = await invite('Crew A'); links.b = await invite('Crew B'); links.w1 = await invite('Crew A'); links.pick = await invite('');
    // PHONE-UX-14: on a slow hub the Invite crew row shows it is working once the crew is picked, and a second tap makes no second link
    const k0 = pm.zq.log.filter(x => x.action === 'keys').length;
    pm.zq.slow = 3000;
    await pm.click('[data-act=hubInvite][data-v=crew]'); await pm.waitForSelector('dialog [data-crew]'); await pm.click('dialog [data-crew="Crew A"]');
    await pm.waitForTimeout(600);
    const working = await pm.evaluate(() => document.querySelector('[data-act=hubInvite][data-v=crew]')?.getAttribute('aria-busy'));
    await pm.click('[data-act=hubInvite][data-v=crew]', { force: true });
    await takeLink(pm);
    pm.zq.slow = 0;
    await pm.waitForTimeout(400);
    const keyCalls = pm.zq.log.filter(x => x.action === 'keys').length - k0, left = await pm.locator('dialog[open]').count();
    check(working === 'true' && keyCalls === 1 && !left, `PHONE-UX-14: while the hub answers, Invite crew shows it is working (aria-busy ${working}); a second tap makes no second link (${keyCalls} keys calls, ${left} sheets left open)`);
    const ps = await unpack(pm, links.super), pa = await unpack(pm, links.a), pk = await unpack(pm, links.pick);
    check(ps.kind === 'join' && ps.role === 'super' && ps.hub.key === KEYS.super && pa.role === 'crew' && pa.crew === 'Crew A' && pa.hub.key === KEYS.crew && !pk.crew,
      'invite links: the superintendent link carries the super key, crew links the crew key and their crew ("they pick" carries none)');
    check(pa.people?.map(x => x.name).join() === 'Jose L,Ana R' && pk.people?.length === 4 && !ps.people, `a crew invite carries its crew's people to tap (${JSON.stringify(pa.people)}); "they pick" every person; the superintendent's none`);
    check(![links.super, links.a, links.pick].some(l => l.includes(KEYS.pm)) && ![ps, pa, pk].some(d => JSON.stringify(d).includes(KEYS.pm)), 'no invite carries the PM key');
    // The PM opens a crew invite it just made, to check it: the PM key is shown only once, at setup, so it is never traded away.
    await pm.goto(links.a);
    const own = await sawToast(pm, /^This is the PM phone\. Send the invite to the person it is for\.$/) && await pm.locator('dialog[open]').count() === 0;
    if (await pm.locator('dialog[open] [data-a="0"]').count()) await pm.click('dialog[open] [data-a="0"]'); // the old question ("Use this invite instead?"): Cancel
    const hb = await local(pm, 'schwab.hub');
    check(own && hb.hubRole === 'pm' && hb.hubKey === KEYS.pm, `the PM phone opening its own crew invite is told so, asked nothing, and keeps its PM key (role ${hb.hubRole})`);
  });

  await step('2. Each phone joins by opening its link', async () => {
    sup = await phone('Super');
    const s = await join(sup, links.super, { name: 'Dana Super' });
    check(s.ok && /as the superintendent/.test(s.sheetText) && !s.chips.length, 'superintendent: the join sheet says what it does, Join connects');
    await sup.waitForTimeout(400);
    check(s.toast === 'Connected as the superintendent' && /set up for the superintendent\. Sign in with the office passcode the PM gives you/.test(await text(sup, '#app')),
      `OWNER3-04: after joining, the superintendent is told he is set up as the superintendent and the passcode comes from the PM (toast "${s.toast}")`);
    const sst = await local(sup, 'schwab.settings');
    check(sst?.me === 'Dana Super' && sst.worker === 'Dana Super', `PHONE-UX-07: the superintendent's join asks the name, for the sheets they assign and their own time clock (me ${sst?.me}, worker ${sst?.worker})`);
    ca = await phone('Crew A');
    const a = await join(ca, links.a, { lang: 'en', name: 'Ana R' });
    check(a.ok && /task sheets arrive by themselves/.test(a.sheetText) && !a.chips.length, 'Crew A phone: language first, then name; the crew comes from the link');
    check(a.who.join() === 'Jose L,Ana R', `PHONE-UX-11: the join sheet offers Crew A's people to tap (${a.who.join(', ')})`);
    cb = await phone('Crew B');
    const b = await join(cb, links.b, { lang: 'es', name: 'rosa  p' }); // typed another way: saved as the roster spells it
    check(b.ok && /Unirse/.test(b.sheetText), 'Crew B phone: picks Español; the join sheet is in Spanish');
    w1 = await phone('Worker 1');
    const j1 = await join(w1, links.w1, { lang: 'en', pick: 'Jose L' });
    check(j1.ok, 'worker 1 (Jose L, Crew A) taps his name and joins');
    w2 = await phone('Worker 2');
    await w2.goto(links.pick); await w2.waitForFunction(() => window.appStarted === true);
    await w2.click('dialog.firstrun [data-fr=lang][data-v=en]'); await w2.waitForSelector('dialog [data-join]');
    await w2.fill('dialog [name=who]', 'Luis Martinez');
    await w2.click('dialog [data-join]');
    check(/not on the crew list/.test(await text(w2, 'dialog [data-err]')), `worker 2: a typed name the roster does not have is questioned once (${await text(w2, 'dialog [data-err]')})`);
    await w2.click('dialog [data-join]');
    check(/Pick your crew/.test(await text(w2, 'dialog [data-err]')), 'worker 2: an invite with no crew asks the person to pick one first');
    const chips = (await w2.locator('dialog [data-crew]').allTextContents()).map(c => c.trim());
    check(chips.includes('Low voltage') && !chips.includes('Crew C'), `worker 2: the crew choices are the job's crews (Crew A, Crew B, Low voltage, Crew D); shown: ${chips.join(', ')}`);
    await w2.click('dialog [data-who="Luis M"]');
    const picked = await w2.evaluate(() => [document.querySelector('dialog [name=who]').value, document.querySelector('dialog [data-crew="Crew B"]').getAttribute('aria-pressed')]);
    check(picked.join() === 'Luis M,true', `worker 2: tapping Luis M fills the name as the roster spells it and picks his crew, Crew B (${picked})`);
    await w2.click('dialog [data-join]');
    check(await sawToast(w2, /^Connected as a crew phone for Crew B$/), 'worker 2 (Luis M) joins on Crew B, and the toast names the crew');
    for (const [p, role, crew, worker] of [[sup, 'super', '', ''], [ca, 'crew', 'Crew A', 'Ana R'], [cb, 'crew', 'Crew B', 'Rosa P'], [w1, 'crew', 'Crew A', 'Jose L'], [w2, 'crew', 'Crew B', 'Luis M']]) {
      const hb = await local(p, 'schwab.hub'), st = await local(p, 'schwab.settings');
      check(hb?.hubUrl === HUBURL && hb.hubRole === role && hb.hubCrew === crew && (!worker || st.worker === worker), `${p.zq.name}: saved as ${role}${crew ? ' on ' + crew : ''}${worker ? ', named ' + worker : ''}`);
      check(await until(async () => (await dot(p))?.state === 'live', 20000), `${p.zq.name}: the header dot shows Live`);
    }
    check(await until(async () => (await local(sup, 'schwab.settings'))?.people?.length === 4, 20000), 'the superintendent phone takes the roster from the hub');
    check(await until(async () => /^[0-9a-f]{16}:/.test(await local(sup, 'schwab.pin') || ''), 20000), 'the superintendent phone learns the office passcode from the hub');
    // OWNER3-03: someone signed in on Ana's crew phone to fix a setting (a sign-in lasts 12 hours); she opens her crew invite again
    check(await until(async () => /^[0-9a-f]{16}:/.test(await local(ca, 'schwab.pin') || ''), 20000), 'the Crew A phone learns the office passcode from the hub');
    await ca.click('#lockBtn'); await ca.waitForSelector('dialog .keypad'); await pad(ca, PIN);
    await ca.evaluate(() => { window.__toasts = []; }); // only what this opening says
    await ca.goto(links.a); await ca.waitForSelector('dialog[open] .ask');
    const signedQ = await text(ca, 'dialog[open] .ask');
    await ca.click('dialog[open] [data-a="1"]'); await ca.waitForSelector('dialog [data-join]'); await ca.click('dialog [data-join]');
    const rejoined = await sawToast(ca, /^Connected as a crew phone for Crew A$/), cahb = await local(ca, 'schwab.hub');
    check(/signed in to the office screens\. Sign out and join the hub as a crew phone\?/.test(signedQ) && rejoined && !(await ca.evaluate(() => document.body.classList.contains('office'))) && cahb.hubRole === 'crew' && cahb.hubCrew === 'Crew A',
      `OWNER3-03: a signed-in crew phone opening its crew invite is offered to sign out and join ("${signedQ}"), and joins signed out on Crew A`);
    await nav(ca, '#day/' + DAY);
    await nav(cb, '#hub');
    check(/Cuadrilla/.test(await text(cb, '#app')) && /Crew B/.test(await text(cb, '#app')), 'Crew B hub page: shows its crew, in Spanish');
    await narrow(cb, 'crew hub page (Spanish)');
    await nav(cb, '#day/' + DAY);
  });

  await step('Clock save refusal and retry', async () => {
    await nav(w1,'#clock/'+DAY); await w1.waitForSelector('[data-act=hTap]');
    await w1.evaluate(()=>{window.__toasts=[];window.__beforeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='schwab.settings')throw new DOMException('full','QuotaExceededError');return window.__beforeSet.call(this,k,v)};});
    await w1.click('[data-act=hTap]');
    check(await sawToast(w1,/This phone wouldn't save/,5000),'settings quota: warning shown');
    check((await local(w1,'schwab.hours')||[]).length===0 && /Clock in/.test(await text(w1,'[data-act=hTap]')),'settings quota: no shift or false success');
    await w1.evaluate(()=>{Storage.prototype.setItem=window.__beforeSet;window.__toasts=[];window.__beforeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='schwab.hours')throw new DOMException('full','QuotaExceededError');return window.__beforeSet.call(this,k,v)};});
    await w1.click('[data-act=hTap]');
    check(await sawToast(w1,/This phone wouldn't save/,5000),'clock-in quota: warning shown');
    check((await local(w1,'schwab.hours')||[]).length===0 && /Clock in/.test(await text(w1,'[data-act=hTap]')) && !(await w1.locator('dialog[open]:has(.linkbox)').count()),'clock-in quota: no shift or false send');
    await w1.evaluate(()=>{Storage.prototype.setItem=window.__beforeSet;window.__toasts=[];});await w1.click('[data-act=hTap]');
    check(await sawToast(w1,/Your hours go to the PM through the hub/,15000),'clock in succeeds after storage recovers');
    const sh=(await local(w1,'schwab.hours'))[0];
    await w1.evaluate(()=>{window.__toasts=[];window.__beforeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='schwab.hours')throw new DOMException('full','QuotaExceededError');return window.__beforeSet.call(this,k,v)};});
    await w1.click('[data-act=hTap]');
    check(await sawToast(w1,/This phone wouldn't save/,5000),'clock-out quota: warning shown');
    check(!(await local(w1,'schwab.hours')).find(s=>s.id===sh.id)?.out && /Clock out/.test(await text(w1,'[data-act=hTap]')) && !(await w1.locator('dialog[open]:has(.linkbox)').count()),'clock-out quota: open shift retained and nothing sent');
    await w1.evaluate(()=>{Storage.prototype.setItem=window.__beforeSet;window.__toasts=[];});await w1.click('[data-act=hTap]');
    check(await sawToast(w1,/Your hours go to the PM through the hub/,15000),'clock out succeeds after storage recovers');
    await nav(pm,'#clock/'+DAY);await pm.waitForSelector(`input[data-k="h.${sh.id}.out"]`,{timeout:40000});
    const before=(await local(pm,'schwab.crewHours')).find(s=>s.id===sh.id).out;
    await pm.evaluate(()=>{window.__toasts=[];window.__beforeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='schwab.crewHours')throw new DOMException('full','QuotaExceededError');return window.__beforeSet.call(this,k,v)};});
    const field=pm.locator(`input[data-k="h.${sh.id}.out"]`);await field.fill('17:00');
    check(await sawToast(pm,/This phone wouldn't save/,5000),'PM edit quota: warning shown');
    check(await field.inputValue()==='17:00' && await field.getAttribute('aria-invalid')==='true' && !(await field.evaluate(el=>el.closest('.field').classList.contains('edited'))) && (await local(pm,'schwab.crewHours')).find(s=>s.id===sh.id).out===before,'PM edit quota: typed value remains visible and underlying shift remains unchanged');
    await pm.evaluate(()=>{Storage.prototype.setItem=window.__beforeSet;window.__toasts=[];});await field.fill('18:00');
    check((await local(pm,'schwab.crewHours')).find(s=>s.id===sh.id).out==='18:00' && await field.getAttribute('aria-invalid')===null,'PM edit: retry saves and clears error');
    await pm.locator('[data-act="hAdd"]').first().click();const add=pm.locator('dialog[open]:has([name="who"])');await add.waitFor();await add.locator('[name="who"]').fill('Fictional Retry');await add.locator('[name="in"]').fill('07:00');
    await pm.evaluate(()=>{window.__toasts=[];window.__beforeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='schwab.crewHours')throw new DOMException('full','QuotaExceededError');return window.__beforeSet.call(this,k,v)};});
    await add.locator('[data-save]').click();check(await sawToast(pm,/This phone wouldn't save/,5000),'PM add quota: warning shown');
    check(await add.count()===1 && await add.locator('[name="who"]').inputValue()==='Fictional Retry' && await add.locator('[name="in"]').inputValue()==='07:00','PM add quota: form and input retained');
    await pm.evaluate(()=>{Storage.prototype.setItem=window.__beforeSet;window.__toasts=[];});await add.locator('.sheet-x').click();
    await pm.evaluate(()=>{window.__toasts=[];window.__beforeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='schwab.crewHours')throw new DOMException('full','QuotaExceededError');return window.__beforeSet.call(this,k,v)};});
    await pm.locator(`[data-act="hDel"][data-id="${sh.id}"]`).click();check(await sawToast(pm,/This phone wouldn't save/,5000),'PM removal quota: warning shown');
    check(!(await local(pm,'schwab.crewHours')).find(s=>s.id===sh.id)?.gone && await pm.locator(`[data-act="hDel"][data-id="${sh.id}"]`).count()===1,'PM removal quota: shift stays and no false removal');
    await pm.evaluate(()=>{Storage.prototype.setItem=window.__beforeSet;window.__toasts=[];});
    await pm.locator(`[data-act="hDel"][data-id="${sh.id}"]`).click();await pm.locator('#toast .toast-undo').waitFor();
    await pm.evaluate(()=>{window.__toasts=[];window.__beforeSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='schwab.crewHours')throw new DOMException('full','QuotaExceededError');return window.__beforeSet.call(this,k,v)};});
    await pm.locator('#toast .toast-undo').click();
    check(await sawToast(pm,/This phone wouldn't save/,5000) && await pm.locator('#toast.show').count()===1,'PM removal undo quota: warning remains visible');
    check((await local(pm,'schwab.crewHours')).find(s=>s.id===sh.id)?.gone===true && await pm.locator(`[data-act="hDel"][data-id="${sh.id}"]`).count()===0,'PM removal undo quota: stored removal remains, no false restoration');
    await pm.evaluate(()=>{Storage.prototype.setItem=window.__beforeSet;});
  });
  log('\nPAGE ERRORS:', errors.length ? '\n  '+[...new Set(errors)].join('\n  '):'none');
  log(fails.length ? `\nFAILED: ${fails.length}\n  ${fails.join('\n  ')}` : '\nALL CHECKS PASSED');
  await browser.close(); hubProc.kill(); process.exit(fails.length || errors.length ? 1:0);
})().catch(async e=>{console.error('CRASHED',e);try{await browser?.close();}catch{}hubProc?.kill();process.exit(2);});
