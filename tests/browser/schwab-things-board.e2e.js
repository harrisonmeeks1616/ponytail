#!/usr/bin/env node
// Browser check: the Things 3 design package, board part (docs/schwab, DESIGN-PKG sections 1 to 3). The day in one quiet
// line on the office board and on Live (shared.mjs daySummary), a progress pie on each floor heading (data-floor) and on
// each Upcoming day heading (data-day), and Upcoming itself (#upcoming/<day>: the 7 days after the board's day, empty
// days folded into one line). Also: Spanish, reduced motion, 320 px with no side scroll, no page errors. Fictional data.
//
// Run (needs Playwright and a Chromium; not part of `npm test`, which is node-only):
//   cd docs/schwab && python3 -m http.server 8765 --bind 127.0.0.1 &        # serve the app
//   node tests/browser/hub-dev-server.js 8780 &                             # the Live line needs a hub (HUBDEV)
//   BASE=http://127.0.0.1:8765/ HUBDEV=http://127.0.0.1:8780/ node tests/browser/schwab-things-board.e2e.js
//   (if Playwright is installed globally: NODE_PATH=$(npm root -g) ...)
// Screenshots of the board, Upcoming and Live (390 and 320 px, light and dark, English and Spanish) land in
// $TMPDIR/schwab-things-board/ (SHOTS=dir moves them). Exit 0 = all checks passed.
'use strict';
const { chromium, devices } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.env.BASE || 'http://127.0.0.1:8765/').replace(/\/*$/, '/');
const HUBDEV = (process.env.HUBDEV || 'http://127.0.0.1:8780/').replace(/\/*$/, '/');
const HUBURL = 'https://script.google.com/macros/s/TESTHUB/exec';
const OUT = (process.env.SHOTS || path.join(os.tmpdir(), 'schwab-things-board')) + '/';
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const fails = [], errors = [];
const check = (ok, what) => { log(ok ? '  ok  ' : '  FAIL', what); if (!ok) fails.push(what); return !!ok; };

// ---------- fixtures: a Wednesday on the job ----------
const NOW = '2026-10-14T10:00:00-04:00', DAY = '2026-10-14', TS = Date.parse(NOW);
const PIN = '1234', SALT = '0123456789abcdef', PIN_HASH = `${SALT}:${crypto.createHash('sha256').update(`${SALT}:${PIN}`).digest('hex')}`;
const FLOORS = ['Basement', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Roof'];
const settings = o => ({ lang: 'en', me: 'Dana Super', role: 'Superintendent', super: 'Dana Super', pm: 'Pat PM', pin: PIN_HASH, project: 'Charles Schwab Building', site: 'Charlotte, NC',
  floors: FLOORS, crews: ['A', 'B', 'C'].map(x => ({ name: 'Crew ' + x, lead: '', members: '' })), worker: '', ...o });
const steps = (n, done) => Array.from({ length: n }, (_, i) => ({ id: 'i' + i, text: 'Step ' + (i + 1), done: i < done, at: i < done ? TS : 0 }));
const task = (uid, o) => ({ uid, origin: 'mine', id: 'T' + uid, date: DAY, by: 'Dana Super', floor: 'Level 3', area: 'East corridor', crew: 'Crew A', members: [], size: 1, scope: 'Pull wire',
  items: [], checks: [], est: 0, aStart: '', aStop: '', delay: 0, status: '', review: '', sentAt: TS, updatedAt: TS, assignAt: 0, crewAt: 0, ...o }); // the stamps: saved by this version (sync.mjs takes a sheet without them for an old tab's)
// The board of Oct 14: 9 sheets, 3 crews, A2 and B1 finished (ready for review, B1 blocked), C1 accepted, D1 done with a follow-up.
// Crew-hrs: estimated 4x2 + 2 + 3 + 2 + 1 = 16; worked 4h x2 + 2h + 1h = 11.
const board = () => [
  task('A1', { floor: 'Level 3', items: steps(3, 1), est: 4, size: 2, aStart: '07:00', aStop: '11:00' }),
  task('A2', { floor: 'Level 3', items: steps(3, 3), est: 2, aStart: '07:00', aStop: '09:00', status: 'Complete' }),
  task('B3', { floor: 'Level 3', crew: 'Crew B', items: steps(2, 0) }),
  task('B1', { floor: 'Level 4', crew: 'Crew B', items: steps(3, 0), est: 3, status: 'Blocked', comments: 'No power' }),
  task('B2', { floor: 'Level 4', crew: 'Crew B', est: 2 }),
  task('E1', { floor: 'Roof', crew: 'Crew B' }), // no steps: an empty ring on its floor
  task('D1', { floor: 'Level 2', items: steps(2, 2), status: 'Complete', review: 'Follow-up needed' }), // every sheet on Level 2 done: a check
  task('C1', { floor: 'Level 5', crew: 'Crew C', items: steps(2, 2), est: 1, aStart: '07:00', aStop: '08:00', status: 'Complete', review: 'Accepted' }),
  task('C2', { floor: '', crew: 'Crew C', items: steps(1, 0) }),
];
// The week after: Thu 15 two sheets, Mon 19 one, Wed 21 one accepted; Thu 22 is past the 7 days.
const week = () => [
  task('U1', { date: '2026-10-15', floor: 'Level 1', items: steps(2, 1) }), task('U2', { date: '2026-10-15', floor: 'Level 2', crew: 'Crew B', items: steps(2, 0) }),
  task('U3', { date: '2026-10-19', floor: 'Basement', crew: 'Crew C' }),
  task('U4', { date: '2026-10-21', floor: 'Roof', items: steps(1, 1), status: 'Complete', review: 'Accepted' }),
  task('U5', { date: '2026-10-22', floor: 'Roof' }),
];
const shift = (id, who, crew) => ({ id, device: 'dev' + id, who, pid: '', crew, crewId: '', tasks: [], date: DAY, in: '07:00', out: '', edited: { who: false, in: false, out: false }, gone: false, at: TS });

// ---------- phones ----------
const phone = { ...devices['iPhone 13'] };
delete phone.defaultBrowserType;
let browser, hubKeys = null;
async function open({ tasks = [], s = {}, signedIn = true, hub = null, hash = `#day/${DAY}`, crewHours = [], ...ctxOpts } = {}) {
  const ctx = await browser.newContext({ ...phone, locale: 'en-US', timezoneId: 'America/New_York', serviceWorkers: 'block', ...ctxOpts });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  p.on('pageerror', e => errors.push(`${hash}: ${e.message}`));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route(/script\.google\.com/, async r => { // the hub address goes to the local hub
    if (r.request().url() !== HUBURL) return r.abort();
    try { const res = await fetch(HUBDEV, { method: 'POST', body: r.request().postData() || '{}', headers: { 'Content-Type': 'text/plain' } }); return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: await res.text() }); } catch { return r.abort(); }
  });
  await p.clock.install({ time: new Date(NOW) });
  const seed = { 'schwab.settings': settings(s), 'schwab.pin': PIN_HASH, 'schwab.tasks': tasks, 'schwab.reports': {}, 'schwab.hours': [], 'schwab.crewHours': crewHours,
    ...(signedIn ? { 'schwab.unlock': { until: TS + 12 * 36e5, fails: 0, wait: 0 } } : {}), ...(hub ? { 'schwab.hub': hub } : {}) };
  await p.addInitScript(seed => { try { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v)); sessionStorage.setItem('seeded', '1'); } } catch {} }, seed);
  await p.goto(BASE + 'tasks.html' + hash);
  await p.waitForTimeout(400);
  return p;
}
const nav = async (p, hash) => { await p.evaluate(h => { if (location.hash === h) dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h; }, hash); await p.waitForTimeout(250); };
const text = (p, sel) => p.locator(sel).first().textContent().then(t => t.replace(/\s+/g, ' ').trim()).catch(() => '');
const noSideScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const heads = (p, attr) => p.$$eval(`h3[data-${attr}]`, (hs, a) => hs.map(h => ({ key: h.dataset[a], html: h.outerHTML.slice(0, h.outerHTML.indexOf('>') + 1), name: h.querySelector('.head-name')?.textContent.replace(/\s+/g, ' ').trim(),
  shown: [...h.querySelector('.head-name').childNodes].filter(n => !n.classList?.contains('sr')).map(n => n.textContent).join('').trim(), n: h.querySelector('small')?.textContent,
  pie: (() => { const e = h.querySelector('.pie'); return !e ? 'none' : e.classList.contains('full') ? 'check' : e.classList.contains('none') ? 'ring' : getComputedStyle(e).getPropertyValue('--p').trim(); })(),
  w: Math.round(h.querySelector('.pie')?.getBoundingClientRect().width || 0) })), attr);
const synced = async p => { await p.evaluate(() => import('./sync.mjs').then(m => m.cycle())).catch(() => {}); await p.waitForTimeout(500); };

(async () => {
  browser = await chromium.launch();
  try {
    hubKeys = await (await fetch(HUBDEV + '__reset', { method: 'POST' })).json();
    await fetch(HUBDEV + '__clock', { method: 'POST', body: JSON.stringify({ set: TS }) });
  } catch { log(`  (no hub answering at ${HUBDEV}: the Live checks fail)`); }
  const pmHub = () => ({ hubUrl: HUBURL, hubKey: hubKeys?.pm || 'none', hubRole: 'pm', hubCrew: '' });

  log('1. The day summary on the office board');
  const sup = await open({ tasks: [...board(), ...week()] });
  await sup.waitForSelector('.day-sum');
  check(await text(sup, '.day-sum') === '9 sheets · 3 crews · 2 ready for review · 1 blocked · 11 of 16 crew-hrs', `one quiet line, only non-zero parts: "${await text(sup, '.day-sum')}"`);
  check(await sup.locator('.board-stats, .board .stat').count() === 0, 'the four stat tiles are gone');
  const tones = await sup.$$eval('.day-sum .sum-go', bs => bs.map(b => `${b.dataset.tone}:${b.textContent}:${Math.round(b.getBoundingClientRect().height)}`));
  check(tones.join() === 'warn:2 ready for review:24,bad:1 blocked:24' || (tones.length === 2 && /^warn:2 ready/.test(tones[0]) && /^bad:1 blocked/.test(tones[1])), `ready for review and blocked are buttons in their status color (${tones.join(' | ')})`);
  const hit = await sup.$eval('.day-sum [data-tone=bad]', b => { const s = getComputedStyle(b, '::after'), r = b.getBoundingClientRect(); return r.height - parseFloat(s.top) - parseFloat(s.bottom); });
  check(hit >= 44, `the tap parts reach 44 px (${hit})`);
  await sup.click('.day-sum [data-tone=bad]');
  await sup.waitForTimeout(400);
  const landed = await sup.evaluate(() => ({ href: document.activeElement?.getAttribute('href') || '', glow: [...document.querySelectorAll('.row.glow')].map(r => r.getAttribute('href')) }));
  check(/^#task\/B1\//.test(landed.href) && landed.glow.length === 1 && landed.glow[0].startsWith('#task/B1/'), `tapping "1 blocked" goes to the blocked sheet, which glows (${JSON.stringify(landed)})`);
  check(/#day\/2026-10-14$/.test(sup.url()), 'and stays on the board');
  await sup.click('.day-sum [data-tone=warn]'); await sup.waitForTimeout(300);
  const rv = await sup.evaluate(() => [...document.querySelectorAll('.row.glow')].map(r => r.getAttribute('href').split('/')[1]).sort().join());
  check(rv === 'A2,B1', `tapping "2 ready for review" lights both sheets (${rv})`);

  log('2. Floor progress pies');
  const floors = await heads(sup, 'floor');
  log('  ', JSON.stringify(floors.map(f => [f.key, f.name, f.n, f.pie, f.w])));
  check(floors.map(f => f.key).join('|') === 'Level 2|Level 3|Level 4|Roof|', `a heading per floor with data-floor, "" for Floor not set (${floors.map(f => JSON.stringify(f.key)).join(' ')})`);
  check(floors.every(f => f.html === `<h3 class="section-h" data-floor="${f.key}">`), `the shared hook exactly: ${floors[1].html}`);
  const f = Object.fromEntries(floors.map(x => [x.key, x]));
  check(f['Level 3'].pie === '0.500' && f['Level 3'].name === 'Level 3: 4 of 8 steps done' && f['Level 3'].shown === 'Level 3' && f['Level 3'].n === '2', `Level 3: done steps of every Level 3 sheet on screen, review group included; screen reader "${f['Level 3'].name}"; the count stays (${f['Level 3'].n})`);
  check(f['Level 2'].pie === 'check' && /All sheets done/.test(f['Level 2'].name), 'Level 2: a check once every sheet on it is done');
  check(f.Roof.pie === 'ring' && f.Roof.name === 'Roof', 'Roof: no steps, an empty ring and no words');
  check(f[''].shown === 'Floor not set' && f[''].pie === '0.000', 'Floor not set: its own heading, 0 of 1');
  check(floors.every(x => x.w === 18), `the pies are 18 px (${floors.map(x => x.w).join()})`);
  const align = await sup.evaluate(() => { const h = document.querySelector('h3[data-floor="Level 3"]'), r = h.nextElementSibling.querySelector('.row'); const x = e => Math.round(e.getBoundingClientRect().left); const c = e => Math.round(e.getBoundingClientRect().left + e.getBoundingClientRect().width / 2);
    return { name: x(h.querySelector('.head-name')), text: x(r.querySelector('.row-main')), pie: c(h.querySelector('.pie')), rowPie: c(r.querySelector('.pie')) }; });
  check(Math.abs(align.name - align.text) <= 1 && Math.abs(align.pie - align.rowPie) <= 1, `heading pie over the row pies, the name over the row text (${JSON.stringify(align)})`);
  await sup.click('.chip[data-act=filter][data-v="Crew A"]'); await sup.waitForTimeout(250);
  const fa = Object.fromEntries((await heads(sup, 'floor')).map(x => [x.key, x]));
  check(fa['Level 3'].pie === '0.667' && fa['Level 3'].name === 'Level 3: 4 of 6 steps done' && fa['Level 3'].n === '1' && !fa['Level 4'], 'the crew filter: Level 3 counts only Crew A sheets (4 of 6)');
  check(await text(sup, '.day-sum') === '3 sheets · 1 crew · 1 ready for review · 10 of 10 crew-hrs', `the line follows the filter too: "${await text(sup, '.day-sum')}"`);
  await sup.click('.chip[data-act=filter][data-v=""]'); await sup.waitForTimeout(200);

  log('3. Upcoming');
  check(await text(sup, '.datebar .up-btn') === 'Upcoming' && await sup.getAttribute('.datebar .up-btn', 'data-go') === 'upcoming/2026-10-14', 'an Upcoming chip in the date switcher');
  await sup.click('.datebar .up-btn'); await sup.waitForTimeout(300);
  check(/#upcoming\/2026-10-14$/.test(sup.url()) && await text(sup, '#title') === 'Upcoming' && await text(sup, '#subtitle') === 'Thu, Oct 15 to Wed, Oct 21', `title Upcoming, the range under it (${await text(sup, '#subtitle')})`);
  const days = await heads(sup, 'day');
  log('  ', JSON.stringify(days.map(d => [d.key, d.name, d.n, d.pie])));
  check(days.map(d => d.key).join() === '2026-10-15,2026-10-19,2026-10-21', `a heading for each day with sheets, none past the 7 days (${days.map(d => d.key)})`);
  check(days.every(d => d.html === `<h3 class="section-h day-h" data-day="${d.key}">`), `the shared hook exactly: ${days[0]?.html}`);
  check(days[0]?.shown === 'Tomorrow' && days[0].name === 'Tomorrow: 1 of 4 steps done' && days[0].pie === '0.250' && days[0].n === '2' && days[1]?.shown === 'Mon, Oct 19' && days[1].pie === 'ring' && days[2]?.pie === 'check',
    'Tomorrow, then dates; each with its pie and count');
  const quiet = await sup.locator('.day-none').allTextContents();
  check(quiet.join(' | ') === 'Fri to Sun · nothing planned | Tue · nothing planned', `empty days fold into one quiet line between headings (${quiet.join(' | ')})`);
  check((await sup.locator('.upcoming .tcard .tid').allTextContents()).join() === 'TU1,TU2,TU3,TU4', 'the sheets as board rows');
  check(await sup.locator('.bar .fab[data-act=new]').count() === 1, 'the + is here too (Magic Plus drops on the day headings)');
  check(await noSideScroll(sup), 'Upcoming fits at 390 px');
  await sup.click('.upcoming .tcard:has-text("TU3")'); await sup.waitForURL(/#task\/U3\//); await sup.waitForSelector('#headBack button');
  check(await text(sup, '#headBack button') === 'Upcoming', `a sheet opened from Upcoming says "‹ Upcoming" (${await text(sup, '#headBack button')})`);
  await sup.click('#headBack button'); await sup.waitForTimeout(300);
  check(/#upcoming\/2026-10-14$/.test(sup.url()) && (await heads(sup, 'day')).map(d => d.key).join() === '2026-10-15,2026-10-19,2026-10-21', 'and Back returns to the same 7 days');
  await sup.click('h3[data-day="2026-10-19"] a'); await sup.waitForTimeout(300);
  check(/#day\/2026-10-19$/.test(sup.url()) && await text(sup, '#title') === 'Mon, Oct 19', 'tapping a day heading opens that day\'s board');
  await nav(sup, '#upcoming/2026-10-14');
  check(await text(sup, '#headBack button') === 'Today', 'Back on Upcoming says Today');
  await sup.click('#headBack button'); await sup.waitForTimeout(300);
  check(/#day\/2026-10-14$/.test(sup.url()) && await sup.locator('.day-sum').count() === 1, 'and returns to the board');
  await sup.click('#titleMore [data-act=boardMenu]'); await sup.click('dialog [data-act=upcoming]'); await sup.waitForTimeout(300);
  check(/#upcoming\/2026-10-14$/.test(sup.url()), "the board's ⋯ menu opens Upcoming too");
  await nav(sup, '#upcoming/2026-10-22');
  check(await sup.locator('.upcoming .empty h2').count() === 1 && await text(sup, '.upcoming .empty h2') === 'Nothing planned for the next 7 days' && await text(sup, '.upcoming .empty [data-act=new]') === 'New sheet for Fri, Oct 23',
    `an empty week: one friendly sentence and one button (${await text(sup, '.upcoming .empty')})`);
  await nav(sup, `#day/${DAY}`);
  await nav(sup, '#day/2026-10-30');
  check(await sup.locator('.day-sum').count() === 0 && await sup.locator('.empty').count() === 1, 'zero sheets: no summary line');

  const quietPhone = await open({ tasks: [task('Q1', {})], hash: `#upcoming/${DAY}` });
  await quietPhone.waitForSelector('.upcoming .empty');
  check(await text(quietPhone, '.upcoming .empty [data-act=new]') === 'New sheet for tomorrow', 'from today the button says tomorrow');
  await quietPhone.click('.upcoming .empty [data-act=new]'); await quietPhone.waitForSelector('[data-k="t.date"]');
  check(await quietPhone.inputValue('[data-k="t.date"]') === '2026-10-15', 'and makes a sheet for tomorrow');
  await quietPhone.context().close();

  const crew = await open({ tasks: board().map(t => ({ ...t, origin: 'link' })), signedIn: false, s: { role: 'Crew member', me: '', worker: 'Jose L' } });
  await crew.waitForSelector('.datebar');
  check(await crew.locator('.up-btn, .day-sum').count() === 0, 'a crew phone: no Upcoming chip and no summary line');
  check((await heads(crew, 'floor')).length > 0, 'its floor headings still show their pies');
  await nav(crew, `#upcoming/${DAY}`);
  check(await crew.locator('dialog .keypad').count() === 1 && await crew.locator('.upcoming').count() === 0, 'Upcoming asks a crew phone for the office passcode');
  await crew.context().close();

  log('4. Spanish');
  await nav(sup, `#day/${DAY}`);
  await sup.click('#langBtn'); await sup.waitForTimeout(250);
  check(await text(sup, '.day-sum') === '9 hojas · 3 cuadrillas · 2 listas para revisar · 1 bloqueada · 11 de 16 horas-cuadrilla', `the line in Spanish: "${await text(sup, '.day-sum')}"`);
  check((await heads(sup, 'floor')).find(x => x.key === 'Level 3')?.name === 'Level 3: 4 de 8 pasos hechos', 'the floor pie words in Spanish');
  await nav(sup, `#upcoming/${DAY}`);
  check(await text(sup, '#title') === 'Próximos días' && (await heads(sup, 'day'))[0]?.shown === 'Mañana' && (await sup.locator('.day-none').allTextContents())[0] === 'vie a dom · nada planeado', `Upcoming in Spanish (${await text(sup, '#title')}, ${(await sup.locator('.day-none').allTextContents()).join(' | ')})`);
  await sup.click('#langBtn'); await sup.waitForTimeout(200);

  log('5. Live (hub): the same line, with who is on site');
  const pm = await open({ tasks: board(), hub: pmHub(), hash: '#live', s: { role: 'Project manager', me: 'Pat PM' },
    crewHours: [shift('s1', 'Jose L', 'Crew A'), shift('s2', 'Luis M', 'Crew A'), shift('s3', 'Ana P', 'Crew B'), shift('s4', 'Tre W', '')] });
  await synced(pm); await synced(pm);
  await pm.waitForSelector('.day-sum').catch(() => {});
  check(await text(pm, '.day-sum') === 'On site now: 4 people in 2 crews · 1 working · 2 ready for review · 1 blocked', `Live: "${await text(pm, '.day-sum')}"`);
  check(await pm.locator('.live-stats, #app .stat').count() === 0, 'the Live tiles are gone');
  check(await pm.locator('.live-head + .day-sum').count() === 1, 'the line sits at the top, under the hub status');
  await pm.click('.day-sum [data-tone=bad]'); await pm.waitForTimeout(400);
  check(/^#task\/B1\//.test(await pm.evaluate(() => document.activeElement?.getAttribute('href') || '')), 'tapping "1 blocked" on Live goes to that sheet');
  await pm.click('#langBtn'); await pm.waitForTimeout(250);
  check(await text(pm, '.day-sum') === 'En la obra ahora: 4 personas en 2 cuadrillas · 1 trabajando · 2 listas para revisar · 1 bloqueada', `Live in Spanish: "${await text(pm, '.day-sum')}"`);
  await pm.click('#langBtn'); await pm.waitForTimeout(150);

  log('6. Reduced motion, 320 px');
  const still = await open({ tasks: board(), reducedMotion: 'reduce' });
  await still.waitForSelector('.day-sum');
  await still.click('.day-sum [data-tone=bad]'); await still.waitForTimeout(150);
  const anim = await still.evaluate(() => { const r = document.querySelector('.row.glow'); return r ? getComputedStyle(r).animationName : 'no row'; });
  check(anim === 'none' && /^#task\/B1\//.test(await still.evaluate(() => document.activeElement?.getAttribute('href') || '')), `reduced motion: no glow, the focus still lands on the sheet (${anim})`);
  await still.context().close();
  // the summary keeps to the 16 px gutter: a part longer than the line wraps rather than run past it
  const inGutter = p => p.evaluate(() => [...document.querySelectorAll('.day-sum > span')].every(s => s.getBoundingClientRect().right <= innerWidth - 15));
  for (const [p, screens] of [[sup, [`#day/${DAY}`, `#upcoming/${DAY}`, '#upcoming/2026-10-22']], [pm, ['#live']]]) {
    await p.setViewportSize({ width: 320, height: 640 });
    for (const lang of ['English', 'Spanish']) {
      for (const h of screens) { await nav(p, h); check(await noSideScroll(p) && await inGutter(p), `320 px, no side scroll, the line inside the gutter: ${h} (${lang})`); }
      await p.click('#langBtn'); await p.waitForTimeout(150);
    }
    await p.setViewportSize({ width: 390, height: 664 });
  }
  await sup.context().close(); await pm.context().close();

  log('7. Screenshots: board, Upcoming, Live; 390 and 320 px; light and dark; English and Spanish');
  for (const lang of ['en', 'es']) for (const scheme of ['light', 'dark']) {
    const p = await open({ tasks: [...board(), ...week()], hub: pmHub(), s: { role: 'Project manager', me: 'Pat PM', lang }, colorScheme: scheme,
      crewHours: [shift('s1', 'Jose L', 'Crew A'), shift('s2', 'Luis M', 'Crew A'), shift('s3', 'Ana P', 'Crew B')] });
    await synced(p);
    for (const w of [390, 320]) {
      await p.setViewportSize({ width: w, height: w === 390 ? 844 : 640 });
      for (const [name, h] of [['board', `#day/${DAY}`], ['upcoming', `#upcoming/${DAY}`], ['upcoming-empty', '#upcoming/2026-10-22'], ['live', '#live']]) {
        await nav(p, h); await p.waitForTimeout(150);
        await p.screenshot({ path: `${OUT}${name}-${w}-${scheme}-${lang}.png`, fullPage: true });
      }
    }
    await p.context().close();
  }
  log(`  shots in ${OUT}`);

  log('ERRORS:', errors.length ? errors : 'none');
  check(!errors.length, 'no page errors');
  log(fails.length ? `FAILED: ${fails.length}` : 'ALL CHECKS PASSED');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); process.exit(2); });
