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
const takeLink = async p => { await p.waitForSelector('dialog .linkbox'); const v = await p.locator('dialog .linkbox').inputValue(); await p.locator('dialog .sheet-x').click(); await p.waitForTimeout(150); return v; };
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
const stat = (p, i) => p.evaluate(n => document.querySelectorAll('.stats .stat b')[n]?.textContent.trim(), i);
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
  const ok = await sawToast(p, /^(Connected to the hub|Conectado al sistema central)$/, 10000);
  return { ok, sheetText, chips: chips.map(c => c.trim()), who: who.map(c => c.trim()) };
}

(async () => {
  const h = await startHub();
  hubProc = h.proc; HUB = `http://127.0.0.1:${h.port}/`; KEYS = h.keys;
  log(`local hub on port ${h.port}${h.port !== HUBPORT ? ` (${HUBPORT} was taken by another process)` : ''}`);
  await dev('__clock', { real: true });
  await dev('__clock', { advance: START - Date.now() }); // the hub's clock runs from the job's morning, like every phone's
  browser = await chromium.launch();
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
    check(s.ok && /as the superintendent/.test(s.sheetText) && !s.chips.length, 'superintendent: the join sheet says what it does, Join connects ("Connected to the hub")');
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
    check(await sawToast(w2, /^Connected to the hub$/), 'worker 2 (Luis M) joins on Crew B');
    for (const [p, role, crew, worker] of [[sup, 'super', '', ''], [ca, 'crew', 'Crew A', 'Ana R'], [cb, 'crew', 'Crew B', 'Rosa P'], [w1, 'crew', 'Crew A', 'Jose L'], [w2, 'crew', 'Crew B', 'Luis M']]) {
      const hb = await local(p, 'schwab.hub'), st = await local(p, 'schwab.settings');
      check(hb?.hubUrl === HUBURL && hb.hubRole === role && hb.hubCrew === crew && (!worker || st.worker === worker), `${p.zq.name}: saved as ${role}${crew ? ' on ' + crew : ''}${worker ? ', named ' + worker : ''}`);
      check(await until(async () => (await dot(p))?.state === 'live', 20000), `${p.zq.name}: the header dot shows Live`);
    }
    check(await until(async () => (await local(sup, 'schwab.settings'))?.people?.length === 4, 20000), 'the superintendent phone takes the roster from the hub');
    check(await until(async () => /^[0-9a-f]{16}:/.test(await local(sup, 'schwab.pin') || ''), 20000), 'the superintendent phone learns the office passcode from the hub');
    await nav(cb, '#hub');
    check(/Cuadrilla/.test(await text(cb, '#app')) && /Crew B/.test(await text(cb, '#app')), 'Crew B hub page: shows its crew, in Spanish');
    await narrow(cb, 'crew hub page (Spanish)');
    await nav(cb, '#day/' + DAY);
  });

  await step('3. The superintendent assigns sheets; crew phones get them with no texted link', async () => {
    await sup.click('#lockBtn');
    await sup.waitForSelector('dialog .keypad');
    check(/Office sign-in/.test(await text(sup, 'dialog h3')), 'the superintendent signs in with the office code from the hub (no new code asked)');
    await pad(sup, PIN);
    // PHONE-ES-01: the superintendent opens the crew invite the PM sent to forward. An office phone never turns into a crew
    // phone on the hub: it is told so, asked nothing, and keeps its superintendent key.
    await sup.goto(links.a);
    const told = await sawToast(sup, /^This phone is for the office, so it does not join as a crew phone\. Send the invite to the person it is for\.$/);
    await sup.waitForTimeout(300);
    const shb = await local(sup, 'schwab.hub'), asked = await sup.locator('dialog[open]').count();
    if (asked) await sup.click('dialog[open] [data-a="0"]'); // the old question ("Use this invite instead?"): Cancel
    check(told && !asked && shb.hubRole === 'super' && shb.hubKey === KEYS.super, `PHONE-ES-01: the superintendent phone opening a crew invite is told it is for the office, asked nothing, and stays the superintendent (role ${shb.hubRole}, ${asked} questions open)`);
    make = async (crew, scope, floor, steps, send = true) => {
      await nav(sup, '#day/' + DAY);
      await sup.click('.bar [data-act=new]');
      await sup.waitForSelector('[data-k="t.scope"]');
      await sup.click(`[data-act=crew] >> text="${crew}"`);
      await sup.fill('[data-k="t.floor"]', floor);
      await sup.fill('[data-k="t.scope"]', scope);
      for (const st of steps) { await sup.fill('#newItem', st); await sup.press('#newItem', 'Enter'); await sup.waitForTimeout(120); }
      await blur(sup);
      const uid = await sup.evaluate(() => location.hash.split('/')[1]);
      if (send) { await sup.click('.bar [data-act=sendTask]'); await sup.waitForSelector('dialog .linkbox'); await narrow(sup, 'send to crew share sheet'); await sup.click('dialog .sheet-x'); }
      const t = await taskOf(sup, uid);
      return { uid, id: t.id };
    };
    S.s1 = await make('Crew A', 'Pull wire to the panel on level 3', 'Level 3', ['Pull wire', 'Install box']);
    await narrow(sup, 'task assign screen');
    S.s2 = await make('Crew B', 'Install conduit in the ceiling', 'Level 2', ['Install conduit', 'Pull wire']);
    S.s3 = await make('Crew A', 'Bring the ladder to level 5', 'Level 5', ['Bring ladder']);
    log('  sheets:', JSON.stringify(S));
    check(S.s1.id && S.s2.id && S.s3.id && new Set([S.s1.id, S.s2.id, S.s3.id]).size === 3, `three sheets with their own numbers (${S.s1.id}, ${S.s2.id}, ${S.s3.id})`);
    const board = p => p.evaluate(() => [...document.querySelectorAll('#app .tcard .tid')].map(x => x.textContent.trim()));
    const aIds = await until(async () => { const b = await board(ca); return b.includes(S.s1.id) && b.includes(S.s3.id) && b; }, 40000);
    check(aIds && !aIds.includes(S.s2.id), `Crew A board shows ${S.s1.id} and ${S.s3.id}, not Crew B's sheet (shows ${await board(ca)})`);
    const bIds = await until(async () => { const b = await board(cb); return b.includes(S.s2.id) && b; }, 40000);
    check(bIds && bIds.length === 1, `Crew B board shows only ${S.s2.id} (shows ${await board(cb)})`);
    check(ca.zq.log.some(x => x.action === 'pull' && x.reply.includes(S.s1.uid)) && !(await ca.evaluate(() => location.hash)).includes('p='), 'the sheet reached Crew A through a hub pull, not a texted link');
    check((await taskOf(ca, S.s1.uid))?.origin === 'link' && (await taskOf(cb, S.s2.uid))?.origin === 'link', 'crew phones hold the sheets as crew sheets (origin link)');
    await narrow(ca, 'crew board with hub sheets');
    // a sheet the superintendent has not sent yet
    S.d = await make('Crew A', 'Draft for later', 'Roof', ['Not ready'], false);
    await sleep(25000);
    const draft = await taskOf(ca, S.d.uid);
    check(!draft, `a draft the superintendent has not sent stays off the crew phone (Crew A has it: ${!!draft}${draft ? ', sentAt ' + draft.sentAt : ''})`);
  });

  await step('4. Crew A ticks, starts, stops and sets status; the PM Live board follows without a reload', async () => {
    await nav(pm, '#live');
    await pm.evaluate(() => { window.__mark = 1; });
    check(!!(await until(() => card(pm, S.s1.id), 30000)), 'the Live board lists the new sheets');
    await narrow(pm, 'Live board');
    await nav(ca, `#task/${S.s1.uid}/assign`);
    await ca.waitForSelector('[data-act=tick]');
    await narrow(ca, 'crew task sheet');
    await ca.click('[data-act=tick][data-list=items][data-i="0"]');
    await ca.click('[data-act=clock][data-v=aStart]');
    const working = await until(async () => { const c = await card(pm, S.s1.id); return c && c.pills.includes('Working') && /1 of 2 steps done/.test(c.meta) && c; }, 40000);
    check(working, `PM Live: ${S.s1.id} shows Working and 1 of 2 steps done (${JSON.stringify(await card(pm, S.s1.id))})`);
    check(await sinceMark(pm), 'the Live board was redrawn in place (no reload)');
    check(await stat(pm, 1) === '2' || await stat(pm, 1) === '1', `Active count moves (${await stat(pm, 1)})`);
    await ca.click('[data-act=clock][data-v=aStop]');
    await ca.click('[data-act=set][data-k="t.status"][data-v=Partial]');
    await ca.fill('[data-k="t.remain"]', 'Install box tomorrow');
    await blur(ca);
    const partial = await until(async () => { const c = await card(pm, S.s1.id); return c && c.pills.includes('Partial') && c.review && c; }, 40000);
    check(partial, `PM Live: ${S.s1.id} shows Partial with a Review button (${JSON.stringify(await card(pm, S.s1.id))})`);
    check(await stat(pm, 2) === '1', `To review shows 1 (${await stat(pm, 2)})`);
    const t = await taskOf(pm, S.s1.uid);
    check(t && t.aStart && t.aStop && t.items[0].done && t.status === 'Partial' && t.remain === 'Install box tomorrow', 'the PM phone holds the crew part: start, stop, tick, status, remaining');
    const feed = await until(async () => { const f = await pm.locator('.feed li').allTextContents(); return f.some(x => x.includes(S.s1.id) && /started/.test(x)) && f.some(x => x.includes(S.s1.id) && /Partial/.test(x)) && f; }, 30000);
    check(feed, `Activity feed: started and marked Partial lines for ${S.s1.id} (${(await pm.locator('.feed li').allTextContents()).slice(0, 5).join(' / ')})`);
    const made = (await pm.locator('.feed li').allTextContents()).find(x => x.includes(S.s1.id) && /created/.test(x)) || '';
    check(/Dana Super created/.test(made) && (await taskOf(pm, S.s1.uid))?.by === 'Dana Super', `PHONE-UX-07: the sheet and the feed name the superintendent who made it (${made})`);
    check(await sinceMark(pm), 'still the same page: no reload');
  });

  await step('5. The PM sends a message and a review; the crew phone shows them', async () => {
    // PHONE-UX-17: a sheet opened from Live goes Back to Live
    await pm.click(`.live-card:has([data-u="${S.s1.uid}"]) a.row`);
    await pm.waitForSelector('#headBack button');
    const backLabel = await text(pm, '#headBack button');
    await pm.click('#headBack button'); await pm.waitForTimeout(300);
    check(backLabel === 'Live' && await pm.evaluate(() => location.hash) === '#live', `PHONE-UX-17: a sheet opened from Live says "‹ Live" and goes back there (said "${backLabel}", went to ${await pm.evaluate(() => location.hash)})`);
    await nav(pm, '#live'); // where the rest of this step starts, whatever Back did
    await nav(ca, '#day/' + DAY); // Crew A is on its board when the office writes
    await toasts(ca);
    await pm.click(`[data-act=liveMsg][data-u="${S.s1.uid}"]`);
    await pm.waitForSelector('dialog textarea');
    await narrow(pm, 'Message sheet');
    await pm.fill('dialog textarea', 'Bring more tape');
    await pm.click('dialog [data-send]');
    check(await sawToast(pm, /^Message sent to Crew A$/), 'Message: "Message sent to Crew A"');
    const marked = () => ca.evaluate(id => [...document.querySelectorAll('#app .tcard')].filter(r => r.querySelector('.tid')?.textContent.trim() === id && r.querySelector('.pill.news')).length, S.s1.id);
    const told = await until(async () => await marked() === 1 && await sawToast(ca, new RegExp(`^Message from the office on sheet ${S.s1.id}$`), 500), 40000);
    check(told, `PHONE-UX-05: the message reaching Crew A's phone says so ("Message from the office on sheet ${S.s1.id}") and marks the sheet's row on the board (toasts: ${(await ca.evaluate(() => window.__toasts.slice())).join(' / ')})`);
    await narrow(ca, 'crew board with a new message');
    await nav(ca, `#task/${S.s1.uid}/assign`);
    await pm.click(`[data-act=liveReview][data-u="${S.s1.uid}"]`);
    await pm.waitForSelector('dialog [data-r]');
    await narrow(pm, 'Review sheet');
    await pm.click('dialog [data-r="Follow-up needed"]:not([data-go-save])');
    await pm.fill('dialog textarea', 'Finish the box today');
    await pm.click('dialog [data-go-save]');
    check(await sawToast(pm, /^Review saved$/), 'Review: "Review saved"');
    const notes = await until(async () => { const n = await ca.locator('.tsheet .banner').allTextContents(); return n.length === 2 && /Bring more tape/.test(n[0]) && /Follow-up needed/.test(n[1]) && /Finish the box today/.test(n[1]) && n; }, 40000);
    check(notes, `Crew A sheet shows the message and the review (${(await ca.locator('.tsheet .banner').allTextContents()).join(' / ')})`);
    check(/Pat PM/.test((notes || []).join(' ')), 'the message and review say who sent them');
    await narrow(ca, 'crew sheet with message and review');
    await nav(ca, '#day/' + DAY);
    check(!(await ca.locator('#app .pill.news').count()) && !(await taskOf(ca, S.s1.uid)).news, 'PHONE-UX-05: once the sheet was opened the board mark is gone');
    await nav(ca, `#task/${S.s1.uid}/assign`);
  });

  await step('6. Translation: the English assignment on the Spanish phone, the Spanish notes on the English PM phone', async () => {
    await nav(cb, `#task/${S.s2.uid}/assign`);
    await cb.waitForSelector('.brief');
    const scope = await until(async () => { const s = await cb.evaluate(() => { const t = document.querySelector('.brief .scope-text .tx'); return t && { state: t.dataset.state, tr: t.querySelector('.tx-t')?.textContent, cap: t.querySelector('.tx-cap')?.textContent }; }); return s?.state === 'done' && s; }, 20000);
    check(scope && scope.tr === 'Instale conducto en el techo' && /Traducido automáticamente/.test(scope.cap), `Crew B sees the English scope in Spanish with "Traducido automáticamente" (${JSON.stringify(scope)})`);
    const steps = await cb.locator('[data-act=tick] .txt').allTextContents();
    check(steps.some(s => /Instale conducto/.test(s)), `Crew B: the steps are translated too (${steps.join(' / ')})`);
    // PHONE-UX-12: at 320 px a ticked step's time sits beside its translated words, never over their "Traducido automáticamente" caption
    await cb.click('[data-act=tick][data-list=items][data-i="0"]');
    const tb = await until(() => cb.evaluate(() => {
      const b = document.querySelector('[data-act=tick][data-list=items][data-i="0"]'), s = b?.querySelector(':scope > small'), c = b?.querySelector('.tx-cap'), w = b?.querySelector('.txt');
      if (!s || !c || !w) return null;
      const rg = document.createRange(); rg.selectNodeContents(c);
      const r = [s.getBoundingClientRect(), rg.getBoundingClientRect(), w.getBoundingClientRect()].map(x => [x.left, x.top, x.right, x.bottom].map(Math.round));
      return { time: r[0], cap: r[1], words: r[2] };
    }), 8000);
    check(tb && tb.cap[2] <= tb.words[2] + 1 && !(tb.cap[0] < tb.time[2] && tb.cap[2] > tb.time[0] && tb.cap[1] < tb.time[3] && tb.cap[3] > tb.time[1]),
      `a ticked step's caption stays inside its words' box, clear of the time (${JSON.stringify(tb)})`);
    await cb.click('.brief .scope-text [data-act=txToggle]');
    const view = await cb.evaluate(() => { const t = document.querySelector('.brief .scope-text .tx'); const o = t.querySelector('.tx-o'); return { view: t.dataset.view, shown: o && getComputedStyle(o).display !== 'none' && o.textContent }; });
    check(view.view === 'o' && view.shown === 'Install conduit in the ceiling', `one tap shows the original (${JSON.stringify(view)})`);
    await narrow(cb, 'Spanish crew sheet, translated');
    await cb.click('[data-act=clock][data-v=aStart]');
    await cb.fill('[data-k="t.comments"]', 'Necesito mas cinta para el techo');
    await blur(cb);
    await cb.click('[data-act=set][data-k="t.status"][data-v=Blocked]');
    const c2 = await until(async () => { const c = await card(pm, S.s2.id); return c?.note?.state === 'done' && c; }, 45000);
    check(c2 && c2.pills.includes('Blocked'), `PM Live: ${S.s2.id} shows Blocked (${JSON.stringify(c2?.pills)})`);
    check(c2 && c2.note.tr === 'Need more tape for the ceiling' && /Auto-translated/.test(c2.note.cap) && /See original/.test(c2.note.cap), `PM Live: the Spanish note shows in English with "Auto-translated · See original" (${JSON.stringify(c2?.note)})`);
    await pm.click(`.live-card:has([data-u="${S.s2.uid}"]) .live-note [data-act=txToggle]`);
    const o = await pm.evaluate(u => { const t = document.querySelector(`.live-card:has([data-u="${u}"]) .live-note .tx`); const x = t.querySelector('.tx-o'); return { view: t.dataset.view, shown: getComputedStyle(x).display !== 'none' && x.textContent, tShown: getComputedStyle(t.querySelector('.tx-t')).display !== 'none' }; }, S.s2.uid);
    check(o.view === 'o' && o.shown === 'Necesito mas cinta para el techo' && !o.tShown, `PM: one tap shows the original Spanish (${JSON.stringify(o)})`);
    check((await taskOf(pm, S.s2.uid))?.cLang === 'es', 'the sheet records that the crew wrote in Spanish (cLang es)');
    await nav(pm, `#task/${S.s2.uid}/review`);
    const rv = await until(async () => { const t = await pm.evaluate(() => [...document.querySelectorAll('.brief .tx')].map(x => [x.dataset.state, x.querySelector('.tx-t')?.textContent])); return t.some(([s, v]) => s === 'done' && v === 'Need more tape for the ceiling') && t; }, 15000);
    check(rv, 'the PM review tab shows the crew notes translated too');
    await narrow(pm, 'PM review tab with translated notes');
    await nav(pm, '#live');
    // PHONE-ES-05: a superintendent working in Spanish picks a finish check from Settings (the defaults are English words):
    // it keeps its own language, so a Spanish crew phone has it translated, while the sheet's typed text stays Spanish
    await sup.click('#langBtn');
    const es = await make('Crew B', 'Instale cajas en el nivel 2', 'Level 2', [], false);
    await sup.click('[data-act=check][data-v="Testing"]');
    await blur(sup);
    const et = await taskOf(sup, es.uid), ck = et.checks.find(c => c.text === 'Testing');
    check(ck && et.aLang === 'es' && et.aLangs.scope === 'es' && et.aLangs[ck.id] === 'en', `PHONE-ES-05: on a sheet typed in Spanish the Settings check "Testing" is kept as English (aLang ${et.aLang}, check ${ck && et.aLangs[ck.id]})`);
    await sup.click('#langBtn');
  });

  let sh1;
  await step('7. Worker clock in and out reach the PM Crew hours with crew and task; PM edits stick', async () => {
    await nav(w1, '#clock/' + DAY);
    await w1.waitForSelector('[data-act=hTap]');
    check(/go to the PM through the hub/.test(await text(w1, '#app')), 'the time clock says taps go through the hub');
    await until(async () => (await taskOf(w1, S.s1.uid)), 30000); // the worker phone has its crew's sheets
    await narrow(w1, 'worker time clock');
    // PHONE-ES-03: the morning. The app is opened again (the last good round stored is from last night) and Clock in is
    // tapped as soon as it shows, while the first round is still on its way to a hub that takes 1.5 s to answer.
    await w1.evaluate(() => { const k = 'schwab.hubSync', s = JSON.parse(localStorage.getItem(k)); s.ok -= 12 * 36e5; localStorage.setItem(k, JSON.stringify(s)); });
    w1.zq.slow = 1500;
    await w1.reload();
    await w1.waitForSelector('[data-act=hTap]');
    await w1.click('[data-act=hTap]');
    check(await sawToast(w1, /Your hours go to the PM through the hub/, 15000), 'Clock in right after the app opens: "Saved. Your hours go to the PM through the hub."');
    w1.zq.slow = 0;
    await w1.waitForTimeout(400);
    check(await w1.locator('dialog .linkbox').count() === 0, 'PHONE-ES-03: Clock in opens no text to the PM, also before the first round after the app opens is back');
    sh1 = (await local(w1, 'schwab.hours'))[0];
    log('  worker 1 shift', JSON.stringify({ id: sh1.id, in: sh1.in, crew: sh1.crew, tasks: sh1.tasks }));
    const dev1 = (await local(w1, 'schwab.device')).id;
    check(sh1.device === dev1 && sh1.crew === 'Crew A' && sh1.tasks.some(x => x.uid === S.s1.uid), 'the shift carries the device id, the crew and the sheet the worker is on');
    await nav(pm, '#clock/' + DAY);
    const row = await until(async () => { const c = await pm.evaluate(() => [...document.querySelectorAll('.card.person')].map(x => ({ who: x.querySelector('h2')?.textContent, text: x.textContent.replace(/\s+/g, ' ') }))); return c.find(x => x.who === 'Jose L'); }, 40000);
    check(row && /Crew A/.test(row.text) && new RegExp(`Tasks? .*${S.s1.id}`).test(row.text), `PM Crew hours: Jose L with Crew A and ${S.s1.id}, no text needed (${row && row.text.replace(/\s+/g, ' ')})`);
    await narrow(pm, 'PM crew hours');
    await nav(pm, '#live');
    const site = await until(async () => { const t = await text(pm, '.live-site'); return /Jose L/.test(t) && t; }, 30000);
    check(site, `Live: On site now lists Jose L (${site && site.replace(/\s+/g, ' ')})`);
    // DATA2-08: the PM types a clock-out on the open shift (the wrong person) and clears the box again: the clock-out
    // stays the worker's to make, so the worker's clock-out below still reaches the hub
    await nav(pm, '#clock/' + DAY);
    await pm.waitForSelector(`input[data-k="h.${sh1.id}.out"]`);
    await pm.fill(`input[data-k="h.${sh1.id}.out"]`, '09:45');
    await blur(pm);
    await until(async () => entities(await dump(), 'Hours').find(s => s.id === sh1.id)?.out === '09:45', 20000);
    await pm.fill(`input[data-k="h.${sh1.id}.out"]`, '');
    await blur(pm);
    const cleared = await until(async () => { const s = entities(await dump(), 'Hours').find(x => x.id === sh1.id); return s && !s.out && s; }, 20000);
    check(cleared && !cleared.edited.out, `DATA2-08: a clock-out box the PM cleared again is not marked edited on the hub (${JSON.stringify(cleared && { out: cleared.out, edited: cleared.edited })})`);
    await nav(pm, '#live');
    // a day of work later: the PM fixes the clock-in while the worker is still on the clock; the worker clocks out at once
    await advanceAll(8 * 36e5);
    await until(async () => { const s = await hubStatus(w1); return s.state === 'live' && s.at > (await w1.evaluate(() => Date.now())) - 30e3; }, 20000);
    await nav(pm, '#clock/' + DAY);
    await pm.waitForSelector(`input[data-k="h.${sh1.id}.in"]`);
    await pm.fill(`input[data-k="h.${sh1.id}.in"]`, '06:30');
    await blur(pm);
    await w1.click('[data-act=hTap]'); // before the worker phone has heard of the edit
    check(await sawToast(w1, /Your hours go to the PM through the hub/), 'Clock out: through the hub, no text');
    const out1 = (await local(w1, 'schwab.hours')).find(s => s.id === sh1.id).out;
    log('  worker 1 clocked out at', out1);
    const hubShift = async () => entities(await dump(), 'Hours').find(s => s.id === sh1.id);
    const both = await until(async () => { const s = await hubShift(); return s && s.in === '06:30' && s.out === out1 && s; }, 40000);
    check(both && both.edited.in, `hub: the PM's 06:30 clock-in stands and the worker's ${out1} clock-out is kept (${JSON.stringify(both && { in: both.in, out: both.out, edited: both.edited })})`);
    const pmView = await until(async () => { const s = (await local(pm, 'schwab.crewHours') || []).find(x => x.id === sh1.id); return s && s.in === '06:30' && s.out === out1 && s; }, 40000);
    check(pmView, 'PM phone: 06:30 in, the clock-out arrived');
    const w1View = await until(async () => { const s = (await local(w1, 'schwab.hours')).find(x => x.id === sh1.id); return s.in === '06:30' && s; }, 40000);
    check(w1View && w1View.out === out1, "worker phone: shows the PM's 06:30 and keeps its clock-out");
    await pm.fill(`input[data-k="h.${sh1.id}.out"]`, '14:45');
    await blur(pm);
    check(await until(async () => (await hubShift())?.out === '14:45', 20000), 'the PM changes the clock-out to 14:45 on the hub');
    const w1n = w1.zq.log.length;
    await until(async () => w1.zq.log.slice(w1n).filter(x => x.action === 'pull').length >= 2, 50000); // two more sync rounds on the worker phone
    const after = await hubShift(), pmS = (await local(pm, 'schwab.crewHours')).find(x => x.id === sh1.id), wS = (await local(w1, 'schwab.hours')).find(x => x.id === sh1.id);
    check(after.in === '06:30' && after.out === '14:45' && pmS.in === '06:30' && pmS.out === '14:45', `after the worker's next syncs the PM's times stand (hub ${after.in}-${after.out}, PM ${pmS.in}-${pmS.out})`);
    check(wS.out === '14:45' && wS.in === '06:30', `the worker phone shows the PM's times (${wS.in}-${wS.out})`);
    await nav(pm, '#clock/' + DAY);
    await pm.waitForTimeout(300);
    const pmText = await text(pm, '#app');
    check(/8\.25 hrs/.test(pmText) && /edited/.test(pmText), 'PM Crew hours: 8.25 hrs (6:30 AM to 2:45 PM), marked edited');
    const hrsTab = (await dump()).Hours;
    const row1 = hrsTab.rows.find(r => r.includes(sh1.id));
    check(row1 && row1[hrsTab.header.indexOf('Edited by PM')] === 'Yes' && /^Jose L$/.test(row1[0]), 'the Google Sheet Hours tab names Jose L, Edited by PM: Yes');
  });

  await step('8. Security: a worker phone with another phone\'s device id cannot see or change its hours', async () => {
    await nav(w2, '#clock/' + DAY);
    await w2.waitForSelector('[data-act=hTap]');
    await w2.click('[data-act=hTap]');
    check(await sawToast(w2, /through the hub/), 'worker 2 clocks in through the hub');
    const dev1 = await local(w1, 'schwab.device'), dev2 = await local(w2, 'schwab.device');
    const before = entities(await dump(), 'Hours').find(s => s.id === sh1.id);
    // Worker 2 copies worker 1's device id (it is in texts and the Sheet) into its own storage, plus a doctored copy of worker 1's
    // shift and a new shift labeled with worker 1's device. A: edited while the app runs, so the sync engine takes worker 1's id for
    // its own. B: the app restarted on the edited storage.
    const tamper = ({ id, sh, out }) => {
      localStorage.setItem('schwab.device', JSON.stringify({ ...JSON.parse(localStorage.getItem('schwab.device')), id }));
      const st = JSON.parse(localStorage.getItem('schwab.settings')); st.device = id; localStorage.setItem('schwab.settings', JSON.stringify(st));
      const hrs = JSON.parse(localStorage.getItem('schwab.hours') || '[]').filter(x => x.id !== sh.id && !String(x.id).startsWith('forged'));
      hrs.push({ ...sh, out, who: 'Jose L', at: Date.now() });
      hrs.push({ ...sh, id: 'forged' + Date.now(), in: '05:00', out: '05:30', who: 'Luis M', pid: '', crew: 'Crew B', crewId: '', tasks: [] });
      localStorage.setItem('schwab.hours', JSON.stringify(hrs));
    };
    const refusals = from => w2.zq.log.slice(from).filter(x => x.action === 'push').flatMap(x => { try { return JSON.parse(x.reply).shifts || []; } catch { return []; } }).filter(r => r.key === sh1.id);
    const nA = w2.zq.log.length;
    await w2.evaluate(tamper, { id: dev1.id, sh: before, out: '23:30' });
    const sentA = await until(async () => w2.zq.log.slice(nA).find(x => x.action === 'push' && (x.q.shifts || []).some(z => z.id === sh1.id)), 40000);
    const healed = await local(w2, 'schwab.device'), stA = await local(w2, 'schwab.settings');
    check(sentA && healed.id === dev2.id && stA.device === dev2.id, 'A: before its next sync the app takes its own device id back from its secret (the copied id never reaches the hub)');
    await until(async () => refusals(nA).length, 10000);
    check(refusals(nA).length && refusals(nA).every(r => r.status === 'rejected' && r.reason === 'device'), `A: the hub refuses it (${JSON.stringify(refusals(nA).map(r => r.reason || r.status))})`);
    check(await sawToast(w2, /Items the hub did not accept: \d/, 3000), 'A: worker 2 is told the hub did not accept it');
    await w2.goto(BASE + 'appsscript.json'); // B: storage edited with the app closed, then the app opens on it
    await w2.evaluate(tamper, { id: dev1.id, sh: before, out: '23:45' }); // a new version, so it is sent again
    const n0 = w2.zq.log.length;
    await w2.goto(BASE + 'tasks.html#clock/' + DAY);
    await w2.waitForFunction(() => window.appStarted === true);
    await until(async () => w2.zq.log.slice(n0).filter(x => x.action === 'pull').length >= 2, 45000);
    check((await local(w2, 'schwab.device')).id === dev2.id, 'B: on start the app works its device id out from its own secret again (the copied id is gone)');
    check(refusals(n0).length && refusals(n0).every(r => r.status === 'rejected'), `B: the doctored shift, now under worker 2's own id, is still refused (${JSON.stringify(refusals(n0).map(r => r.reason || r.status))})`);
    const n1 = w2.zq.log.length;
    await until(async () => w2.zq.log.slice(n1).filter(x => x.action === 'pull').length >= 2, 50000); // two more rounds
    const again = w2.zq.log.slice(n1).filter(x => x.action === 'push' && (x.q.shifts || []).some(z => z.id === sh1.id)).length;
    check(again === 0, `a refused shift is not sent again until it changes (${again} more pushes of it in two rounds)`);
    const now1 = entities(await dump(), 'Hours').find(s => s.id === sh1.id);
    check(now1.out === before.out && now1.in === before.in && now1.device === before.device, `worker 1's shift on the hub is unchanged (${now1.in}-${now1.out})`);
    const forged = entities(await dump(), 'Hours').filter(s => String(s.id).startsWith('forged'));
    check(forged.every(s => s.device === dev2.id || s.device !== dev1.id), `a new shift sent under worker 1's id is filed under worker 2's real device (${forged.map(s => s.device.slice(0, 6)).join(',') || 'none stored'})`);
    const seen = w2.zq.log.filter(x => x.action === 'pull').flatMap(x => { try { return JSON.parse(x.reply).shifts || []; } catch { return []; } });
    check(!seen.some(s => s.device === dev1.id || s.id === sh1.id), `worker 2's pulls never carried worker 1's shifts (${seen.length} shifts seen, all its own)`);
    const direct = await w2.evaluate(async ({ url, dev }) => { const hb = JSON.parse(localStorage.getItem('schwab.hub')); const d = JSON.parse(localStorage.getItem('schwab.device'));
      const r = await fetch(url, { method: 'POST', body: JSON.stringify({ v: 1, key: hb.hubKey, action: 'pull', since: 0, days: 14, dev, devSecret: d.secret }), headers: { 'Content-Type': 'text/plain' } }); return r.json(); }, { url: HUBURL, dev: dev1.id });
    check(direct.ok && !(direct.shifts || []).some(s => s.device === dev1.id), 'a hand-made pull naming worker 1\'s device (dev) still returns none of worker 1\'s hours');
    const direct2 = await w2.evaluate(async ({ url, sh }) => { const hb = JSON.parse(localStorage.getItem('schwab.hub')); const d = JSON.parse(localStorage.getItem('schwab.device'));
      const r = await fetch(url, { method: 'POST', body: JSON.stringify({ v: 1, key: hb.hubKey, action: 'push', dev: sh.device, devSecret: d.secret, shifts: [{ ...sh, out: '23:59', at: Date.now() + 1000 }] }), headers: { 'Content-Type': 'text/plain' } }); return r.json(); }, { url: HUBURL, sh: before });
    check(direct2.ok && direct2.shifts?.[0]?.status === 'rejected' && (entities(await dump(), 'Hours').find(s => s.id === sh1.id)).out === before.out, `a hand-made push of worker 1's shift is refused (${JSON.stringify(direct2.shifts?.[0] && { status: direct2.shifts[0].status, reason: direct2.shifts[0].reason })})`);
    await until(async () => pm.zq.log.filter(x => x.action === 'pull').length > 0, 1000);
    await sleep(22000); // the PM phone syncs again
    const pmS = (await local(pm, 'schwab.crewHours')).find(x => x.id === sh1.id), wS = (await local(w1, 'schwab.hours')).find(x => x.id === sh1.id);
    check(pmS.out === before.out && wS.out === before.out, `PM and worker 1 phones keep worker 1's real hours (PM ${pmS.out}, worker ${wS.out})`);
    // put worker 2 back as it was, so later steps see an honest phone
    await w2.goto(BASE + 'appsscript.json');
    await w2.evaluate(d => { localStorage.setItem('schwab.device', JSON.stringify({ secret: d.secret, id: d.id })); const st = JSON.parse(localStorage.getItem('schwab.settings')); st.device = d.id; localStorage.setItem('schwab.settings', JSON.stringify(st));
      localStorage.setItem('schwab.hours', JSON.stringify(JSON.parse(localStorage.getItem('schwab.hours')).filter(s => s.device === d.id && s.id !== d.drop && !String(s.id).startsWith('forged')))); }, { ...dev2, drop: sh1.id });
    await w2.goto(BASE + 'tasks.html#clock/' + DAY); await w2.waitForFunction(() => window.appStarted === true);
  });

  await step('9. Records: by person, task sheets and reports show the history', async () => {
    await nav(sup, '#report/' + DAY);
    await sup.waitForSelector('[data-k="r.results"]');
    await sup.click('[data-act=set][data-k="r.status"][data-v="On plan"]');
    await sup.fill('[data-k="r.results"]', 'Crew A pulled wire on level 3');
    await blur(sup);
    await narrow(sup, 'daily report');
    check(await until(async () => entities(await dump(), 'Reports').some(r => r.date === DAY && r.results === 'Crew A pulled wire on level 3'), 30000), 'the daily report reaches the hub');
    await nav(pm, '#records/people');
    const people = await until(async () => { const t = await text(pm, '#recList'); return /Jose L/.test(t) && /Luis M/.test(t) && t; }, 30000);
    check(people, `Records by person: Jose L and Luis M (${people && people.replace(/\s+/g, ' ').slice(0, 160)})`);
    await narrow(pm, 'Records by person');
    await pm.click('.rec-row:has-text("Jose L")');
    await pm.waitForTimeout(250);
    const det = await text(pm, '#app');
    check(/8\.25 hrs/.test(det) && new RegExp(S.s1.id).test(det) && /edited/.test(det), `Jose L: the week, 8.25 hrs, the shift with ${S.s1.id}, edited (${det.replace(/\s+/g, ' ').slice(0, 220)})`);
    await narrow(pm, 'Records, one person');
    await nav(pm, '#records/sheets');
    const sheets = await until(async () => { const ids = await pm.locator('#recList .tid').allTextContents(); return [S.s1.id, S.s2.id, S.s3.id].every(i => ids.includes(i)) && ids; }, 20000);
    check(sheets, `Records task sheets: ${S.s1.id}, ${S.s2.id}, ${S.s3.id} (${await pm.locator('#recList .tid').allTextContents()})`);
    const pills = await pm.evaluate(() => [...document.querySelectorAll('#recList .rec-row')].map(r => r.textContent.replace(/\s+/g, ' ')));
    check(pills.some(r => r.includes(S.s1.id) && /Follow-up/.test(r)) && pills.some(r => r.includes(S.s2.id) && /Blocked/.test(r)), 'each sheet shows where it stands (Follow-up, Blocked)');
    await narrow(pm, 'Records task sheets');
    await nav(pm, '#records/reports');
    const reps = await until(async () => { const t = await text(pm, '#recList'); return /On plan/.test(t) && /Crew A pulled wire/.test(t) && t; }, 30000);
    check(reps, `Records reports: today's report, On plan, with its results (${await text(pm, '#recList')})`);
    await narrow(pm, 'Records reports');
    await pm.click('[data-act=recOlder]');
    check(await until(async () => /The hub has nothing older|That is everything/.test(await text(pm, '#app')), 15000), 'Load older records asks the hub and says there is nothing older');
  });

  await step('10. Deleting a sheet on the PM phone removes it from the other phones', async () => {
    for (const p of [sup, ca, w1]) check(!!(await taskOf(p, S.s3.uid)), `${p.zq.name} has ${S.s3.id} before the delete`);
    await nav(pm, '#records/sheets');
    await pm.click(`[data-act=recMenu][data-key="${S.s3.uid}"]`);
    await pm.click('dialog [data-del]');
    // no "are you sure?": the sheet goes at once, the toast offers Undo for 6 seconds, and only then is the hub copy purged
    check(await sawToast(pm, new RegExp(`^Task ${S.s3.id} deleted\\. It is also removed from the hub\\.Undo$`)) && await pm.locator('#toast .toast-undo').count() === 1,
      'the PM can still take it back (Undo), and is told the hub copy goes too');
    await narrow(pm, 'delete with Undo');
    check(!(await taskOf(pm, S.s3.uid)), 'gone from the PM phone at once');
    check(entities(await dump(), 'Tasks').some(t => t.uid === S.s3.uid), 'the hub keeps it while Undo is offered');
    check(await until(async () => !entities(await dump(), 'Tasks').some(t => t.uid === S.s3.uid), 20000), 'gone from the hub once the Undo is over');
    for (const p of [sup, ca, w1]) check(await until(async () => !(await taskOf(p, S.s3.uid)), 45000), `gone from ${p.zq.name} after its next sync`);
    await nav(ca, '#day/' + DAY);
    check(!(await ca.locator('#app .tcard .tid').allTextContents()).includes(S.s3.id), 'Crew A board no longer shows it');
  });

  await step('11. A phone offline keeps working and catches up when back online', async () => {
    await nav(ca, `#task/${S.s1.uid}/assign`);
    await ca.waitForSelector('[data-act=tick]');
    await nav(w2, '#clock/' + DAY);
    await w2.waitForSelector('[data-act=hTap]');
    await until(async () => { const s = await hubStatus(w2); return s.state === 'live' && s.at > (await w2.evaluate(() => Date.now())) - 15e3; }, 30000); // just synced
    for (const p of [ca, w2]) { p.zq.down = true; await p.context().setOffline(true); }
    await w2.evaluate(() => { window.__toasts = []; });
    await w2.click('[data-act=hTap]'); // Clock out, the moment the signal went
    await w2.waitForTimeout(600);
    const w2Text = await w2.locator('dialog .linkbox').count(), w2Toast = (await w2.evaluate(() => window.__toasts.slice())).join(' / ');
    check(w2Text === 1, `offline Clock out right after a good sync: the text to the PM opens as the fallback (text sheet: ${w2Text ? 'yes' : 'no'}; toast: "${w2Toast}")`);
    if (w2Text) await w2.click('dialog .sheet-x');
    await ca.click('[data-act=tick][data-list=items][data-i="1"]');
    check((await taskOf(ca, S.s1.uid)).items[1].done, 'offline: the tick saves on the phone');
    const off = await until(async () => { const d = await dot(ca); return d?.state === 'offline' && d; }, 30000);
    check(off && /1 not sent yet/.test(off.label), `the dot says Offline, 1 not sent yet (${JSON.stringify(off)})`);
    check(await until(async () => (await dot(w2))?.state === 'offline', 30000), 'worker 2: the dot says Offline');
    await w2.click('[data-act=hTap]'); // Clock in again, known offline
    check(await until(() => w2.locator('dialog .linkbox').count(), 5000), 'offline and known to be: Clock in opens the text to the PM');
    if (await w2.locator('dialog .linkbox').count()) await w2.click('dialog .sheet-x');
    await narrow(w2, 'worker time clock offline');
    await sleep(22000);
    check(!(await taskOf(pm, S.s1.uid)).items[1].done, 'the PM does not have it yet');
    for (const p of [ca, w2]) { p.zq.down = false; await p.context().setOffline(false); } // the browser's online event
    const dev2 = (await local(w2, 'schwab.device')).id, mine2 = (await local(w2, 'schwab.hours')).filter(m => m.device === dev2 && m.id !== sh1.id && !String(m.id).startsWith('forged')); // its own real shifts
    const caught = await until(async () => { const crew = await local(pm, 'schwab.crewHours') || []; return mine2.every(m => crew.some(c => c.id === m.id && c.out === m.out)) && crew; }, 45000);
    check(caught, `back online: worker 2's offline clock-out and clock-in reach the PM (${mine2.map(m => m.in + '-' + (m.out || 'open')).join(', ')})`);
    await nav(pm, '#live');
    const back = await until(async () => { const c = await card(pm, S.s1.id); return c && /2 of 2 steps done/.test(c.meta) && c; }, 45000);
    check(back, `back online: the PM Live board shows 2 of 2 steps done (${JSON.stringify(await card(pm, S.s1.id))})`);
    check(await until(async () => (await dot(ca))?.state === 'live', 20000), 'the dot is Live again');
  });

  await step('11b. A pull that lands mid-edit on the PM phone changes no other crew or person', async () => {
    const cycle = p => p.evaluate(() => import('./sync.mjs').then(m => m.cycle())); // this phone's next sync round, now
    const cfgCrews = async () => (entities(await dump(), 'Config')[0]?.crews || []).map(c => c.name);
    // Settings finds a crew's fields by their place in the list. The superintendent removes the crew the PM is typing in,
    // and the PM's pull lands while the cursor is still in that field.
    await nav(pm, '#settings');
    const lv = pm.locator('[data-k="s.crews.2.name"]');
    check(await lv.inputValue() === 'Low voltage', 'PM Settings: the third crew is Low voltage');
    await lv.click(); await pm.keyboard.press('End'); await pm.keyboard.type(' East');
    check(await until(async () => (await cfgCrews()).includes('Low voltage East'), 20000), "the PM's typing reaches the hub");
    await nav(sup, '#settings');
    check(/^Low voltage/.test(await sup.locator('[data-k="s.crews.2.name"]').inputValue()), 'the superintendent has the same crew third');
    await sup.click('[data-act=delCrew][data-i="2"]');
    check(await until(async () => (await cfgCrews()).join() === 'Crew A,Crew B,Crew D', 20000), `the superintendent removes it: the hub has ${(await cfgCrews()).join(', ')}`);
    await cycle(pm);
    const pmCrews = async () => (await local(pm, 'schwab.settings')).crews.map(c => c.name);
    check(await until(async () => (await pmCrews()).join() === 'Crew A,Crew B,Crew D', 20000) && await pm.evaluate(() => document.activeElement?.dataset.k) === 's.crews.2.name',
      'the pull reaches the PM phone while the cursor is still in the field');
    await pm.keyboard.type(' Side');
    await blur(pm);
    await cycle(pm);
    check((await pmCrews()).join() === 'Crew A,Crew B,Crew D' && (await cfgCrews()).join() === 'Crew A,Crew B,Crew D',
      `the next keys rename no other crew: Crew D keeps its name (PM ${(await pmCrews()).join(', ')}; hub ${(await cfgCrews()).join(', ')})`);
    // Crew hours: renaming a timesheet to a name someone else has asks "the same person?". A worker clocks out and the PM
    // phone pulls it while the question is open; the answer still moves the hours.
    await nav(pm, '#clock/' + DAY);
    const jose = (await local(pm, 'schwab.settings')).people.find(p => p.name === 'Jose L');
    const luis = (await local(pm, 'schwab.crewHours')).filter(s => s.who === 'Luis M' && !s.gone).map(s => s.id);
    check(jose && luis.length, `PM Crew hours: Luis M has ${luis.length} shifts`);
    await pm.click('.person:has(h2:text-is("Luis M")) [data-act=hRename]');
    await pm.fill('dialog [name=who]', 'Jose L');
    await pm.click('dialog [data-save]');
    await pm.waitForSelector('dialog .ask');
    check(/^Jose L on Crew A already has that name\. Is that the same person\?$/.test(await text(pm, 'dialog .ask')), 'the PM is asked whether that is the same person');
    await nav(w2, '#clock/' + DAY);
    const open = (await local(w2, 'schwab.hours')).find(s => !s.out && !s.gone);
    await w2.click('[data-act=hTap]'); // Luis M clocks out
    await cycle(w2);
    const out = (await local(w2, 'schwab.hours')).find(s => s.id === open?.id)?.out;
    await cycle(pm);
    check(luis.includes(open?.id) && out && await until(async () => (await local(pm, 'schwab.crewHours')).find(s => s.id === open.id)?.out === out, 20000) && await pm.locator('dialog .ask').count() === 1,
      `Luis M's clock-out (${out}) reaches the PM phone while the question is open`);
    await pm.click('dialog[open] .acts [data-a="1"]'); // Same person: move these hours to Jose L
    await pm.waitForTimeout(300);
    const moved = (await local(pm, 'schwab.crewHours')).filter(s => luis.includes(s.id));
    check(moved.length === luis.length && moved.every(s => s.pid === jose.id && s.who === 'Jose L'), `"Same person" moves every one of those shifts to Jose L (${moved.map(s => s.who + '/' + s.pid).join(', ')})`);
  });

  await step('11c. The hub turns busy or refuses the key at the tap: the text to the PM opens', async () => {
    const round = () => w2.evaluate(() => import('./sync.mjs').then(m => m.cycle()));
    await nav(w2, '#clock/' + DAY);
    await w2.waitForSelector('[data-act=hTap]');
    for (const error of ['busy', 'unauthorized']) { // WB-08: the last good round (seconds ago) says nothing about this tap's round
      check((await round()).state === 'live', `worker 2 had a good round just now (before "${error}")`);
      w2.zq.answer = { ok: false, error };
      await w2.evaluate(() => { window.__toasts = []; });
      await w2.click('[data-act=hTap]');
      const sheet = await until(() => w2.locator('dialog .linkbox').count(), 8000), said = (await w2.evaluate(() => window.__toasts.slice())).join(' / ');
      check(sheet && !/through the hub/.test(said), `the hub answers "${error}" to the tap's round: the text to the PM opens, and no toast says it went through the hub (toast: "${said}")`);
      if (sheet) await w2.click('dialog .sheet-x');
      w2.zq.answer = null;
    }
    // A round already running at the tap (opening the app starts one) read the hours before the tap: the tap's own round is
    // the next one, and that one finds no signal.
    const h0 = await round();
    check(h0.state === 'live' && !h0.pending, `worker 2 had a good round just now and has nothing waiting, so the next round only pulls (${h0.state}, ${h0.pending} waiting)`);
    Object.assign(w2.zq, { slow: 3000, waiting: false });
    await w2.evaluate(() => { window.__toasts = []; import('./sync.mjs').then(m => { m.cycle(); }); });
    await until(() => w2.zq.waiting, 5000, 50);
    w2.zq.down = true; // the signal goes while that round's call is on its way back
    await w2.click('[data-act=hTap]');
    const sheet = await until(() => w2.locator('dialog .linkbox').count(), 12000), said = (await w2.evaluate(() => window.__toasts.slice())).join(' / ');
    check(sheet && !/through the hub/.test(said), `a tap while a round is already running waits for its own round: no signal, so the text to the PM opens (toast: "${said}")`);
    if (sheet) await w2.click('dialog .sheet-x');
    Object.assign(w2.zq, { slow: 0, down: false });
    check(await until(async () => (await round()).state === 'live', 20000), 'the hub answers again: worker 2 is Live');
  });

  // A pull that lands while someone types is saved at once, but the screen waits for the field (tasks.html drawSoon).
  // WB-06, WB-07, WB-14, WB-15: what that waiting screen must never do. WB-02: a round as the office sign-in runs out.
  await step('11d. The office takes out a step while the crew types: the crew\'s next tap ticks no other step', async () => {
    S.t5 = await make('Crew A', 'Mount the boxes on level 4', 'Level 4', ['step one', 'step two', 'step three']);
    await until(() => taskOf(ca, S.t5.uid), 40000);
    await nav(ca, `#task/${S.t5.uid}/assign`);
    await ca.click('[data-k="t.comments"]');
    await ca.keyboard.type('going ok');
    await nav(sup, `#task/${S.t5.uid}/assign`);
    await sup.click('[data-act=delItem][data-i="0"]'); // "step one"
    await syncNow(sup);
    await syncNow(ca); // lands while the cursor is in the note: the screen still shows three steps
    const shown = await ca.locator('[data-act=tick][data-list=items]').count(), held = (await taskOf(ca, S.t5.uid)).items.length;
    const ticks = async () => (await taskOf(ca, S.t5.uid)).items.map(i => i.text + (i.done ? ' (done)' : '')).join(', ');
    await ca.click('[data-act=tick][data-list=items][data-i="1"]'); // "step two" where the old screen shows it
    await ca.waitForTimeout(300);
    const first = await ticks();
    await ca.click('[data-act=tick][data-list=items] >> text="step two"'); // the person taps again on the screen drawn now
    await ca.waitForTimeout(300);
    const second = await ticks();
    check(shown === 3 && held === 2 && first === 'step two, step three' && second === 'step two (done), step three',
      `WB-06: a tap on "step two" drawn before the pull only redraws; the tap after it ticks "step two" (old screen ${shown} steps, stored ${held}; after the first tap: ${first}; after the second: ${second})`);
  });

  await step('11e. The PM deletes a sheet while the crew types in it: no errors, and nothing writes to the gone sheet', async () => {
    await ca.click('[data-act=set][data-k="t.status"][data-v=Partial]');
    await ca.click('[data-k="t.doneText"]');
    await ca.keyboard.type('half the boxes');
    await syncNow(pm);
    await nav(pm, '#records/sheets');
    await pm.click(`[data-act=recMenu][data-key="${S.t5.uid}"]`);
    await pm.click('dialog [data-del]');
    await until(async () => !entities(await dump(), 'Tasks').some(t => t.uid === S.t5.uid), 20000); // purged once the Undo is over
    const e0 = errors.length;
    await syncNow(ca); // the delete lands while the crew is typing
    await ca.keyboard.type(' and the rest tomorrow');
    if (await ca.locator('[data-act=sendResults]').count()) await ca.click('[data-act=sendResults]');
    await ca.waitForTimeout(400);
    const left = await ca.locator('[data-k="t.doneText"], [data-act=sendResults]').count();
    check(errors.length === e0 && !(await taskOf(ca, S.t5.uid)) && !left,
      `WB-07: the keys typed after the delete landed and the Send results tap throw nothing; the sheet's screen is gone (new page errors: ${errors.slice(e0).join(' / ') || 'none'}; fields left: ${left})`);
  });

  await step('11f. Two tabs on a crew phone: a pull saved by one tab leaves the other tab\'s typing alone', async () => {
    S.t6 = await make('Crew A', 'Label the panel on level 4', 'Level 4', ['Label the panel']);
    await until(() => taskOf(ca, S.t6.uid), 40000);
    await nav(ca, '#day/' + DAY);
    const tb = await ca.context().newPage();
    tb.on('pageerror', e => errors.push(`Crew A, second tab: ${e.message}`));
    await tb.goto(BASE + `tasks.html#task/${S.t6.uid}/assign`);
    await tb.waitForFunction(() => window.appStarted === true);
    await tb.click('[data-k="t.comments"]');
    await tb.keyboard.type('typing in tab B');
    await tb.waitForTimeout(2500); // the round its own typing set off (1.5 s later) is over
    await syncNow(pm);
    await nav(pm, '#live');
    await pm.click(`[data-act=liveMsg][data-u="${S.t6.uid}"]`);
    await pm.fill('dialog textarea', 'Use the blue labels');
    await pm.click('dialog [data-send]');
    await syncNow(pm);
    await syncNow(ca); // the first tab saves what it pulled: the second hears of it through a storage event
    await tb.waitForTimeout(300);
    const focus = await tb.evaluate(() => document.activeElement?.dataset?.k || document.activeElement?.tagName);
    await tb.keyboard.type(' MORE');
    await tb.waitForTimeout(200);
    const t = await taskOf(ca, S.t6.uid);
    check(t.reply === 'Use the blue labels' && focus === 't.comments' && t.comments === 'typing in tab B MORE',
      `WB-14: the second tab keeps the cursor and every key typed next (message arrived: ${t.reply === 'Use the blue labels'}; focus: ${focus}; stored: ${JSON.stringify(t.comments)})`);
    await tb.close();
  });

  await step('11g. Records: the storage meter answering while the PM types a search loses no letters', async () => {
    await nav(pm, '#records/people');
    let release;
    pm.zq.hold = { action: 'stats', done: new Promise(r => { release = r; }) };
    await pm.click('[data-act=recStats]'); // Check again: the meter asks the hub, and the answer is slow
    await until(() => pm.zq.hold.seen, 8000, 50);
    const n = pm.zq.log.length;
    await pm.click('#recQ');
    await pm.keyboard.type('Jo');
    release();
    await until(() => pm.zq.log.slice(n).some(x => x.action === 'stats'), 8000, 50);
    await pm.waitForTimeout(300); // the meter's answer is in the page
    await pm.keyboard.type('se');
    const r = await pm.evaluate(() => ({ focus: document.activeElement?.id || document.activeElement?.tagName, value: document.getElementById('recQ')?.value }));
    pm.zq.hold = null;
    check(r.focus === 'recQ' && r.value === 'Jose', `WB-15: the search box keeps the cursor and every letter (${JSON.stringify(r)})`);
    await blur(pm);
  });

  await step('11h. The office sign-in runs out between two sync rounds: the open Daily report goes behind the passcode', async () => {
    await nav(pm, '#report/' + DAY);
    await pm.waitForSelector('[data-k="r.results"]');
    await pm.evaluate(() => { const u = JSON.parse(localStorage.getItem('schwab.unlock')); localStorage.setItem('schwab.unlock', JSON.stringify({ ...u, until: Date.now() - 1000 })); }); // the 12 hours pass: no event says so
    await syncNow(pm); // an ordinary background round
    const padUp = await pm.locator('dialog.pin[open]').count() === 1;
    if (!padUp) { await pm.click('[data-k="r.results"]'); await pm.keyboard.type(' TYPED WHILE LOCKED'); await blur(pm); await pm.waitForTimeout(200); }
    const kept = JSON.stringify(await local(pm, 'schwab.reports')).includes('LOCKED');
    check(padUp && !kept, `WB-02: the passcode pad comes up and nothing typed after the sign-in ran out is saved (pad: ${padUp}; typed text saved: ${kept})`);
    if (padUp) await pad(pm, PIN);
  });

  // PHONE-UX-03, DATA2-03: a day the PM added by hand. The worker's taps are real punches: they are kept for the PM to see and
  // settle, with or without a clock-out on the PM's entry, and the phone calls them saved because the hub has them.
  await step('11i. A day the PM added by hand: the worker\'s taps are always kept, for the PM to settle', async () => {
    const today = await pm.evaluate(() => new Date().toLocaleDateString('en-CA'));
    const rosa = async () => entities(await dump(), 'Hours').filter(s => s.date === today && s.who === 'Rosa P');
    await nav(pm, '#clock/' + today);
    await pm.click('[data-act=hAdd]'); await pm.waitForSelector('dialog [name=who]');
    await pm.fill('dialog [name=who]', 'Rosa P'); await pm.fill('dialog [name=date]', today); await pm.fill('dialog [name=in]', '06:30');
    await pm.click('dialog [data-save]');
    const hand = await until(async () => (await rosa()).find(s => !s.device), 30000);
    check(hand && !hand.out, `the PM adds Rosa P's day by hand at 6:30 AM with no clock-out (${JSON.stringify(hand && [hand.in, hand.out])})`);
    await nav(cb, '#clock/' + today);
    await cb.waitForSelector('[data-act=hTap]');
    await toasts(cb);
    await cb.click('[data-act=hTap]'); // Marcar entrada
    check(await sawToast(cb, /^Guardado\. Sus horas/), 'Rosa (Spanish) taps Marcar entrada: "Guardado" through the hub');
    const tap = await until(async () => (await rosa()).find(s => s.device), 30000);
    check(tap && !tap.gone, `hub: her clock-in is kept for the PM, not filed removed (${JSON.stringify(tap && { in: tap.in, gone: tap.gone })})`);
    await syncNow(cb); await syncNow(cb);
    check(/Marcar salida/.test(await text(cb, '[data-act=hTap]')), `after two more rounds her clock still has her on the clock (${await text(cb, '[data-act=hTap]')})`);
    const pmRows = await until(async () => { const l = (await local(pm, 'schwab.crewHours') || []).filter(s => s.date === today && s.who === 'Rosa P' && !s.gone); return l.length === 2 && l; }, 30000);
    check(pmRows, 'the PM phone holds both: the day added by hand and her tap');
    // the PM finishes the day by hand; her clock-out still goes on her shift; a new clock-in on that whole day is added too
    await nav(pm, '#clock/' + today);
    await pm.fill(`input[data-k="h.${hand.id}.out"]`, '15:00'); await blur(pm);
    check(await until(async () => (await rosa()).find(s => s.id === hand.id)?.out === '15:00', 20000), 'the PM sets 3:00 PM as the clock-out of the day added by hand');
    await toasts(cb);
    await cb.click('[data-act=hTap]'); // Marcar salida
    check(await sawToast(cb, /^Guardado\. Sus horas/), 'her clock-out is saved');
    check(await until(async () => (await rosa()).find(s => s.id === tap.id)?.out, 20000), 'and reaches her shift on the hub');
    await toasts(cb);
    await cb.click('[data-act=hTap]'); // Marcar entrada again, on a day the PM entered whole
    check(await sawToast(cb, /^Guardado\. Sus horas/), 'DATA2-03: a clock-in on a day the PM entered whole is a real punch, and saved');
    check(await until(async () => (await rosa()).filter(s => s.device && !s.gone).length === 2, 20000), 'the hub keeps it, not filed removed, for the PM to settle');
    check(/Marcar salida/.test(await text(cb, '[data-act=hTap]')), 'her clock shows her on the clock');
    await narrow(cb, 'time clock after a second clock-in');
  });

  // A results text for a sheet the PM phone does not hold yet (no signal when it was made): the office part in the text goes
  // up as old as the copy it is, so it cannot undo the superintendent's newer change (round-1 fix2 parked item).
  await step('11j. A results text for a sheet the PM phone does not hold yet never undoes a newer office edit', async () => {
    pm.zq.down = true;
    const nh = await make('Crew A', 'Hang the panel cover on level 6', 'Level 6', ['Hang cover']);
    check(await until(() => taskOf(ca, nh.uid), 40000), 'Crew A gets the new sheet through the hub');
    ca.zq.down = true; // the crew loses signal before the office's next change reaches it
    await nav(sup, `#task/${nh.uid}/assign`);
    await sup.fill('[data-k="t.scope"]', 'Hang the panel cover on level 6 with the gray screws'); await blur(sup);
    check(await until(async () => /gray screws/.test(entities(await dump(), 'Tasks').find(t => t.uid === nh.uid)?.scope), 30000), 'the superintendent changes the scope on the hub');
    await advanceAll(60e3);
    await nav(ca, `#task/${nh.uid}/assign`);
    await ca.waitForSelector('[data-act=tick]');
    await ca.click('[data-act=tick][data-list=items][data-i="0"]');
    await ca.click('[data-act=set][data-k="t.status"][data-v=Complete]');
    await ca.click('[data-act=sendResults]');
    const link = await takeLink(ca);
    await pm.goto(link);
    await pm.waitForFunction(() => window.appStarted === true);
    if (await pm.locator('dialog.pin[open]').count()) await pad(pm, PIN);
    check(await sawToast(pm, /results for .* received/), 'the PM phone, with no signal, takes the results text for a sheet it did not have');
    pm.zq.down = false; ca.zq.down = false;
    await syncNow(pm); await syncNow(pm);
    const hubT = entities(await dump(), 'Tasks').find(t => t.uid === nh.uid), pmT = await taskOf(pm, nh.uid);
    check(/gray screws/.test(hubT.scope) && /gray screws/.test(pmT.scope), `back online, the newer scope stands on the hub and the PM phone (hub "${hubT.scope}", PM "${pmT.scope}")`);
    check(pmT.status === 'Complete' && hubT.status === 'Complete', "and the crew's results stay");
  });

  // Round 2, deletes: DATA-08 (the superintendent's Delete only took that phone's copy and said "deleted"), the report's
  // Clear (the same, for a report), DATA-09 (a PM delete was lost when the app was reloaded during its Undo) and
  // PHONE-UX-16 (the PM's Disconnect did not say the PM key was shown only once).
  await step('11k. Deletes on a hub: only the PM deletes what the hub has, and a PM delete holds through a reload during its Undo', async () => {
    const d1 = await make('Crew A', 'Check the temporary lights', 'Level 7', ['Walk the floor']);
    const d2 = await make('Crew A', 'Sweep the electrical room', 'Level 7', ['Sweep']);
    const onHub = (p, key, kind) => p.evaluate(([k, c]) => import('./sync.mjs').then(m => m.onHub(k, c)), [key, kind]);
    check(await until(async () => { await syncNow(sup); return await onHub(sup, d1.uid) && await taskOf(pm, d2.uid) && await taskOf(ca, d2.uid); }, 45000), 'the two new sheets are on the hub, the PM phone and Crew A');
    await nav(sup, `#task/${d1.uid}/assign`);
    await toasts(sup);
    await sup.click('#titleMore [data-act=taskMenu]'); await sup.click('dialog [data-act=del]');
    check(await sawToast(sup, /^Only the PM can delete what is on the hub\. Ask the PM to delete it\.$/), 'superintendent: Delete on a sheet the hub has says only the PM can delete it');
    await sleep(1000);
    check(!!(await taskOf(sup, d1.uid)) && entities(await dump(), 'Tasks').some(t => t.uid === d1.uid), 'and the sheet stays, on the superintendent phone and on the hub');
    await nav(sup, '#report/' + DAY);
    await sup.waitForSelector('#sec-sum');
    const rep0 = (await local(sup, 'schwab.reports'))?.[DAY];
    await toasts(sup);
    await sup.click('[data-act=menu]'); await sup.click('dialog [data-act=clear]');
    check(rep0?.updatedAt && await onHub(sup, DAY, 'report') && await sawToast(sup, /^Only the PM can delete what is on the hub\./), 'superintendent: Clear this report on a report the hub has says only the PM can delete it');
    check(JSON.stringify((await local(sup, 'schwab.reports'))?.[DAY]) === JSON.stringify(rep0), 'and the report stays as it was');
    await narrow(sup, 'daily report after a Clear the hub keeps');
    // the PM's Clear this report on a hub is a delete like a sheet's: off the hub too once the Undo is over; Undo keeps it
    await nav(pm, '#report/' + DAY);
    await pm.waitForSelector('#sec-sum');
    await toasts(pm);
    await pm.click('[data-act=menu]'); await pm.click('dialog [data-act=clear]');
    check(await sawToast(pm, /report was deleted\. It is also removed from the hub\.Undo$/), 'PM: Clear this report says it leaves the hub too, with Undo');
    await pm.click('#toast .toast-undo');
    await sleep(7000);
    check(entities(await dump(), 'Reports').some(r => r.date === DAY) && (await local(pm, 'schwab.reports'))?.[DAY]?.updatedAt, 'Undo: the report is back on the PM phone and never left the hub');
    // the PM deletes a sheet, and the app is reloaded 2 s later, inside the 6 s Undo
    await nav(pm, `#task/${d2.uid}/assign`);
    await toasts(pm);
    await pm.click('#titleMore [data-act=taskMenu]'); await pm.click('dialog [data-act=del]');
    check(await sawToast(pm, new RegExp(`^Task ${d2.id} deleted\\. It is also removed from the hub\\.Undo$`)), 'PM: the sheet goes at once, with Undo, and leaves the hub too');
    await sleep(2000);
    await pm.reload();
    await pm.waitForFunction(() => window.appStarted === true);
    if (await pm.locator('dialog.pin[open]').count()) await pad(pm, PIN);
    check(await until(async () => !entities(await dump(), 'Tasks').some(t => t.uid === d2.uid), 45000), 'DATA-09: the delete still reaches the hub after the reload');
    check(await until(async () => !(await taskOf(ca, d2.uid)), 45000), 'and Crew A loses the sheet on its next sync');
    check(!(await taskOf(pm, d2.uid)) && !Object.keys((await local(pm, 'schwab.hubSync'))?.del || {}).length, 'it stays off the PM phone and nothing is left waiting');
    // the PM's Disconnect question
    await nav(pm, '#settings');
    await pm.click('[data-act=hubDisconnect]');
    await pm.waitForSelector('dialog .ask');
    const q = await text(pm, 'dialog .ask'), copy = await text(pm, 'dialog [data-a="1"]');
    check(/shown only once/.test(q) && /resetPmKey/.test(q) && copy === 'Copy the PM key', `PHONE-UX-16: the PM's Disconnect says the key was shown only once, names resetPmKey and offers to copy it (${q} | ${copy})`);
    await narrow(pm, 'PM disconnect question');
    await toasts(pm);
    await pm.click('dialog [data-a="1"]');
    check(await sawToast(pm, /^PM key copied\./) && (await local(pm, 'schwab.hub'))?.hubKey === KEYS.pm && (await hubStatus(pm)).state !== 'off', 'Copy the PM key copies it, and the phone stays connected');
  });

  await step('12. Disconnecting returns the app to its no-hub behavior', async () => {
    await nav(sup, '#settings');
    await sup.click('[data-act=hubDisconnect]');
    await sup.waitForSelector('dialog .ask');
    await sup.click('dialog [data-a="1"]');
    await sup.waitForTimeout(400);
    const tabs = await sup.locator('#officeTabs a').allTextContents();
    check(!(await dot(sup)) && !tabs.includes('Live') && !tabs.includes('Records'), `superintendent: no dot, no Live or Records tab (${tabs.join(', ')})`);
    check(await sup.locator('#hubUrl').count() === 1, 'Settings shows the connect form again');
    const hb = await local(sup, 'schwab.hub');
    check(!hb.hubUrl && !hb.hubKey && !hb.hubRole, 'the hub link and key are gone from the phone');
    check(!!(await taskOf(sup, S.s1.uid)), 'the work stays on the phone');
    const n = sup.zq.log.length;
    await nav(sup, '#day/' + DAY);
    await sup.click(`#app .tcard:has-text("${S.s1.id}")`);
    await sup.waitForSelector('.bar [data-act=sendTask]');
    await sup.click('.bar [data-act=sendTask]');
    check(await until(() => sup.locator('dialog .linkbox').count(), 5000) === 1, 'Send to crew still opens the text'); // the link is packed first: the sheet opens a moment after the tap
    await sup.click('dialog .sheet-x');
    await nav(w1, '#hub');
    await w1.click('[data-act=hubDisconnect]');
    await w1.click('dialog [data-a="1"]');
    await w1.waitForTimeout(300);
    await nav(w1, '#clock/' + DAY);
    check(/opens a text to the PM/.test(await text(w1, '#app')), 'worker time clock: back to "Each Clock in and Clock out opens a text to the PM"');
    await w1.click('[data-act=hTap]');
    check(await until(() => w1.locator('dialog .linkbox').count(), 5000), 'Clock in opens the text to the PM again');
    await w1.click('dialog .sheet-x');
    await nav(w1, '#day/' + DAY);
    const w1n = w1.zq.log.length;
    await sleep(25000);
    check(sup.zq.log.length === n && w1.zq.log.length === w1n, `no hub requests after disconnecting (super ${sup.zq.log.length - n}, worker ${w1.zq.log.length - w1n})`);
  });

  await step('13. The hub record and the phones agree at the end', async () => {
    const d = await dump();
    const tasks = entities(d, 'Tasks');
    check(tasks.some(t => t.uid === S.s1.uid && t.reply === 'Bring more tape' && t.review === 'Follow-up needed' && t.items.every(i => i.done)), `hub: ${S.s1.id} has the message, the review and both ticks`);
    check(tasks.some(t => t.uid === S.s2.uid && t.status === 'Blocked' && t.cLang === 'es'), `hub: ${S.s2.id} Blocked, written in Spanish`);
    const act = d.Activity ? d.Activity.rows.map(r => r.join(' | ')) : [];
    check(act.some(r => /clock/i.test(r)) && act.some(r => /PM edited/.test(r)), 'hub Activity: clock in/out and the PM edit are logged');
    check(!JSON.stringify(d).includes(KEYS.pm) && !JSON.stringify(d).includes(KEYS.crew), 'no key is written into the Sheet');
  });

  log('\nPAGE ERRORS:', errors.length ? '\n  ' + [...new Set(errors)].join('\n  ') : 'none');
  log(fails.length ? `\nFAILED: ${fails.length}\n  ${fails.join('\n  ')}` : '\nALL CHECKS PASSED');
  await browser.close();
  hubProc.kill();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch(async e => { console.error('CRASHED', e); try { await browser?.close(); } catch {} hubProc?.kill(); process.exit(2); });
