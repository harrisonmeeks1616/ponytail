#!/usr/bin/env node
// Browser check: Quick Find, the Things 3 search of the field app (docs/schwab: shared.mjs findSheet, daysNamed, pullDown;
// tasks.html quickFind). It opens from the search button in the title row, a pull down past the top on a touch phone and
// "/" on a computer. It finds a sheet by a word of its scope in English and on a Spanish phone (accents and capitals
// ignored, a cached translation too), a person and a day; every typed word must match; no match says so; an empty box
// shows the sheets opened last; a crew phone finds only what it has. Fictional data only.
//
// Run (needs Playwright and a Chromium; not part of `npm test`, which is node-only):
//   cd docs/schwab && python3 -m http.server 8765 --bind 127.0.0.1 &        # serve the app
//   BASE=http://127.0.0.1:8765/ node tests/browser/schwab-things-find.e2e.js
//   (if Playwright is installed globally: NODE_PATH=$(npm root -g) ...)
// Screenshots of the search sheet (390 and 320 px, light and dark, English and Spanish: empty, results, no match) land in
// $TMPDIR/schwab-things-find/ (SHOTS=dir moves them).
// Exit 0 = all checks passed.
const { chromium, devices } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const OUT = (process.env.SHOTS || path.join(os.tmpdir(), 'schwab-things-find')) + '/';
fs.mkdirSync(OUT, { recursive: true });
const fails = [], check = (ok, what) => { console.log(ok ? '  ok  ' : '  FAIL', what); if (!ok) fails.push(what); };

const NOW = '2026-10-20T09:00:00', TODAY = '2026-10-20'; // a Tuesday
const salt = '0123456789abcdef', PIN = `${salt}:${crypto.createHash('sha256').update(`${salt}:4821`).digest('hex')}`;
const settings = o => ({
  lang: 'en', me: 'Dana Super', role: 'Superintendent', super: 'Dana Super', pm: 'Pat Manager', project: 'Charles Schwab Building', site: 'Charlotte, NC',
  floors: ['Level 1', 'Level 2', 'Level 3'], crews: [{ id: 'ca', name: 'Crew A', lead: '', members: '' }, { id: 'cb', name: 'Crew B', lead: '', members: '' }],
  people: [{ id: 'pjose', name: 'José Luis Ortega', crewId: 'ca' }, { id: 'pana', name: 'Ana Pérez', crewId: 'cb' }, { id: 'pdana', name: 'Dana Super', crewId: '' }],
  checks: ['Labeling'], worker: 'Dana Super', workerId: 'pdana', pin: PIN, ...o,
});
const task = o => ({ origin: 'mine', by: 'Dana Super', members: [], memberIds: [], items: [], checks: [], updatedAt: 1, ...o });
const TASKS = [
  task({ uid: 'u1', id: 'T1020-01', date: TODAY, floor: 'Level 3', area: 'Elec room 3E', crew: 'Crew A', crewId: 'ca', members: ['José Luis Ortega'], memberIds: ['pjose'],
    scope: 'Pull and terminate 12 AWG for the lighting circuits', items: [{ id: 'i1', text: 'Mount the panel', done: true, at: 1 }, { id: 'i2', text: 'Label the breakers' }] }),
  task({ uid: 'u2', id: 'T1021-01', date: '2026-10-21', floor: 'Level 2', area: 'Baño de hombres', crew: 'Crew B', crewId: 'cb', members: ['Ana Pérez'], memberIds: ['pana'],
    scope: 'Instalar tubería eléctrica en el baño', aLang: 'es', items: [{ id: 'i3', text: 'Colocar cajas' }], comments: 'Falta material' }),
  task({ uid: 'u3', id: 'T1019-01', date: '2026-10-19', floor: 'Level 3', area: 'East corridor', crew: 'Crew A', crewId: 'ca', scope: 'Lighting rough-in along the east corridor', origin: 'link' }),
  ...Array.from({ length: 10 }, (_, i) => task({ uid: 'c' + i, id: `T1022-${String(i + 1).padStart(2, '0')}`, date: '2026-10-22', floor: 'Level 1', area: `Stair ${i + 1}`, crew: 'Crew B', crewId: 'cb', scope: 'Conduit run to the riser' })),
];
const REPORTS = { '2026-10-19': { date: '2026-10-19', super: 'Dana Super', status: 'At risk', results: 'Switchgear delivery slipped to Thursday', updatedAt: 5, submittedAt: 5 } };

(async () => {
  const browser = await chromium.launch();
  const iphone = { ...devices['iPhone 13'] }; delete iphone.defaultBrowserType;
  const errors = [];
  // A phone with these stores. signedIn: the office passcode was entered (an office phone); out: a crew phone.
  const open = async ({ s = {}, signedIn = true, recent, hash = `#day/${TODAY}`, device = iphone, scheme = 'light' } = {}) => {
    const ctx = await browser.newContext({ ...device, locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block', colorScheme: scheme });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.clock.install({ time: new Date(NOW) });
    const seed = { 'schwab.settings': settings(s), 'schwab.pin': PIN, 'schwab.tasks': TASKS, 'schwab.reports': REPORTS, ...(recent ? { 'schwab.recent': recent } : {}),
      ...(signedIn ? { 'schwab.unlock': { until: Date.parse(NOW) + 12 * 36e5, fails: 0, wait: 0 } } : {}) };
    await p.addInitScript(x => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(x)) localStorage.setItem(k, JSON.stringify(v)); sessionStorage.setItem('seeded', '1'); } }, seed);
    await p.goto(BASE + 'tasks.html' + hash);
    await p.waitForFunction(() => window.appStarted === true);
    await p.waitForTimeout(250);
    return p;
  };
  const isOpen = p => p.locator('dialog.find[open]').count().then(n => n === 1);
  const find = async (p, q) => {
    if (!await isOpen(p)) { await p.click('[data-act=find]'); await p.waitForSelector('dialog.find[open]'); }
    await p.fill('dialog.find input', q);
    await p.waitForTimeout(220); // results come 80 ms after the last keystroke
  };
  // { heading: [row titles] } of what the sheet shows now
  const groups = p => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('dialog.find .find-h')].map(h => [h.textContent, [...h.nextElementSibling.querySelectorAll('.row')].map(r => r.querySelector('.row-title').textContent)])));
  const bold = p => p.evaluate(() => [...document.querySelectorAll('dialog.find .find-out b')].map(b => b.textContent));
  const none = p => p.locator('dialog.find .find-none').textContent().catch(() => '');
  const rowOf = (p, title) => p.locator('dialog.find .row', { has: p.locator('.row-title', { hasText: title }) }).first();
  const pick = (p, title) => rowOf(p, title).click();
  const settle = p => p.waitForTimeout(300);
  const noSideScroll = p => p.evaluate(w => document.documentElement.scrollWidth <= w && [...document.querySelectorAll('dialog[open]')].every(d => d.scrollWidth <= d.clientWidth), p.viewportSize().width);

  console.log('1. An office phone in English: the search button, then a sheet, a person, a day');
  const sup = await open();
  const btn = await sup.locator('#findBtn').boundingBox();
  check(await sup.isVisible('#findBtn[data-act=find]') && await sup.getAttribute('#findBtn', 'aria-label') === 'Search' && btn.width >= 44 && btn.height >= 44,
    'the board has a 44 px search button in its title row, labelled Search');
  await sup.click('#findBtn');
  await sup.waitForSelector('dialog.find[open]');
  check(await sup.evaluate(() => document.activeElement?.matches('dialog.find input[type=search]')), 'the sheet opens with the search box focused (the phone keyboard opens)');
  check(/Try a room, a name or a day/.test(await none(sup)) && Object.keys(await groups(sup)).length === 0, 'an empty box with nothing opened yet: one quiet hint');
  await find(sup, 'lighting');
  let g = await groups(sup);
  check(JSON.stringify(g) === JSON.stringify({ 'Task sheets': ['Elec room 3E T1020-01', 'East corridor T1019-01'] }), 'a word of the scope finds both sheets, today first: ' + JSON.stringify(g));
  check((await bold(sup)).some(b => /^lighting$/i.test(b)), 'the matched word is shown in bold, in the line of scope it was found in');
  await find(sup, 'lighting EAST');
  check(JSON.stringify(await groups(sup)) === JSON.stringify({ 'Task sheets': ['East corridor T1019-01'] }), 'every word must match (AND), whatever the capitals');
  await find(sup, 'lighting zzq');
  check(await none(sup) === 'No matches for “lighting zzq”' && await sup.locator('dialog.find .row').count() === 0, 'no match: No matches for “lighting zzq”');
  await find(sup, 'jose');
  g = await groups(sup);
  check(JSON.stringify(g.People) === '["José Luis Ortega"]' && g['Task sheets']?.[0] === 'Elec room 3E T1020-01' && (await bold(sup)).includes('José'), 'jose finds José (accents ignored, in bold), and the sheet he is on: ' + JSON.stringify(g));
  await pick(sup, 'José Luis Ortega');
  await settle(sup);
  check(!await isOpen(sup) && new URL(sup.url()).hash === `#day/${TODAY}` && await sup.getAttribute('.crew-filter [aria-pressed=true]', 'data-v') === 'Crew A',
    "on the superintendent's phone a person opens today's board on their crew");
  await sup.click('.crew-filter [data-v=""]');
  await find(sup, 'tomorrow');
  const day1 = await sup.locator('dialog.find .row').first().textContent();
  check(/Wed, Oct 21/.test(day1) && /Tomorrow · 1 task sheet/.test(day1), 'tomorrow finds the day, with its sheets counted: ' + day1.trim());
  await find(sup, 'oct 21');
  check((await groups(sup)).Days?.[0] === 'Wed, Oct 21', 'so does "oct 21"');
  await pick(sup, 'Wed, Oct 21');
  await settle(sup);
  check(new URL(sup.url()).hash === '#day/2026-10-21' && /Wed, Oct 21/.test(await sup.textContent('#title')), "tapping the day opens that day's board");
  await find(sup, 'switchgear');
  check(JSON.stringify(await groups(sup)) === '{"Days":["Daily report"]}', "a word of a daily report finds the report under Days");
  await pick(sup, 'Daily report');
  await settle(sup);
  check(new URL(sup.url()).hash === '#report/2026-10-19' && !await isOpen(sup), 'and opens it');
  await sup.goto(BASE + `tasks.html#day/${TODAY}`); await settle(sup);
  await find(sup, 'conduit');
  check((await groups(sup))['Task sheets'].length === 8 && (await sup.textContent('dialog.find .find-all')).trim() === 'Show all (10)', 'at most 8 a group, then Show all (10)');
  await sup.click('dialog.find .find-all');
  check((await groups(sup))['Task sheets'].length === 10 && await sup.evaluate(() => document.activeElement?.dataset.find === '8'), 'Show all shows the other 2, and focus moves on to the first of them');
  await find(sup, 'lighting');
  await pick(sup, 'Elec room 3E');
  await settle(sup);
  check(new URL(sup.url()).hash === '#task/u1/assign' && !await isOpen(sup), 'tapping a sheet closes the search and opens the sheet');
  check(await sup.isHidden('#findBtn'), 'a task sheet has no search button (it is on the main screens)');
  await sup.goto(BASE + `tasks.html#day/${TODAY}`); await settle(sup);
  await find(sup, 'baño');
  await sup.press('dialog.find input', 'Enter');
  await settle(sup);
  check(new URL(sup.url()).hash === '#task/u2/assign', 'Enter opens the first result');
  await sup.goto(BASE + `tasks.html#day/${TODAY}`); await settle(sup);
  await find(sup, '');
  check(JSON.stringify(await groups(sup)) === JSON.stringify({ 'Recent sheets': ['Baño de hombres T1021-01', 'Elec room 3E T1020-01'] }), 'an empty box shows the sheets opened last, newest first');
  await sup.keyboard.press('Escape');
  check(!await isOpen(sup), 'Escape closes it');

  console.log('2. The PM: a person opens their hours');
  const pm = await open({ s: { role: 'Project manager', me: 'Pat Manager', worker: '', workerId: '' } });
  await find(pm, 'ana');
  check((await rowOf(pm, /^Ana Pérez$/).textContent()).includes('Crew B · Crew hours'), "the PM's person row says it opens Crew hours");
  await pick(pm, 'Ana Pérez');
  await settle(pm);
  check(new URL(pm.url()).hash === `#clock/${TODAY}` && (await pm.textContent('#title')) === 'Crew hours', 'tapping it opens Crew hours');

  console.log('3. A Spanish phone: the Spanish it sees, and the original');
  const es = await open({ s: { lang: 'es' } });
  await es.click('[data-act=find]'); await es.waitForSelector('dialog.find[open]');
  check(await es.getAttribute('#findBtn', 'aria-label') === 'Buscar' && await es.getAttribute('dialog.find input', 'placeholder') === 'Hojas, personas y días', 'the button and the box are in Spanish');
  await find(es, 'tuberia');
  check(JSON.stringify(await groups(es)) === '{"Hojas de tareas":["Baño de hombres T1021-01"]}' && (await bold(es)).includes('tubería'), 'tuberia (no accent) finds the sheet whose scope says tubería, in bold');
  await find(es, 'BAÑO');
  check((await groups(es))['Hojas de tareas']?.[0] === 'Baño de hombres T1021-01' && (await bold(es)).includes('Baño'), 'BAÑO finds Baño');
  await find(es, 'mañana');
  const dayEs = await es.locator('dialog.find .row').first().textContent();
  check(/mié, 21 (de )?oct/.test(dayEs) && /Mañana/.test(dayEs), 'mañana finds tomorrow, in Spanish: ' + dayEs.trim());
  await find(es, 'lighting');
  check((await groups(es))['Hojas de tareas']?.[0] === 'Elec room 3E T1020-01', 'the English original still finds its sheet');
  await es.evaluate(async () => { // the hub translated the scope earlier in this session (a fake translator stands in for it)
    const live = await import('./live.mjs'), ctx = { sync: { hubStatus: () => ({ state: 'live' }), translate: async ts => ts.map(() => 'Tender y conectar cable 12 AWG para los circuitos de alumbrado') } };
    const box = document.createElement('div');
    box.innerHTML = live.txView(ctx, 'Pull and terminate 12 AWG for the lighting circuits', 'en', 'es');
    await live.txApply(ctx, box);
  });
  await es.keyboard.press('Escape'); await find(es, 'alumbrado');
  check((await groups(es))['Hojas de tareas']?.[0] === 'Elec room 3E T1020-01' && (await bold(es)).includes('alumbrado'), 'a cached translation is searched too: alumbrado finds the English sheet');
  await find(es, 'zzq');
  check(await none(es) === 'No hay resultados para “zzq”', 'no match, in Spanish');
  await es.keyboard.press('Escape');

  console.log('4. A crew phone finds only what it has');
  const crew = await open({ signedIn: false, s: { role: 'Crew member', me: '', worker: 'José Luis Ortega', workerId: 'pjose' } });
  await find(crew, 'lighting');
  check(JSON.stringify(await groups(crew)) === '{"Task sheets":["East corridor T1019-01"]}', 'its own sheet only, not the office sheet with the same word');
  await find(crew, 'ana');
  check(await crew.locator('dialog.find .row').count() === 0, 'no one else from the roster');
  await find(crew, 'switchgear');
  check(await crew.locator('dialog.find .row').count() === 0, 'no daily reports');
  await find(crew, 'jose');
  check((await rowOf(crew, /^José Luis Ortega$/).textContent()).includes('Time clock'), 'its own person, which opens its time clock');
  await pick(crew, 'José Luis Ortega');
  await settle(crew);
  check(new URL(crew.url()).hash === `#clock/${TODAY}` && await crew.isVisible('#findBtn'), 'tapped: the time clock (a main screen, with the search button)');

  console.log('5. Pull down on a touch phone');
  const t = await open();
  const cdp = await t.context().newCDPSession(t);
  const pull = async (p, dy, at = 300) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: at }] });
    for (let y = 8; y <= dy; y += 8) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y: at + y }] });
    const armed = await p.locator('#findBtn.armed').count();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(250);
    return armed;
  };
  await pull(t, 32);
  check(!await isOpen(t), 'a short pull (32 px) does not open it');
  const armed = await pull(t, 96);
  check(armed === 1 && await isOpen(t) && await t.evaluate(() => document.activeElement?.matches('dialog.find input')), 'past about 64 px the search button fills in, and letting go opens Quick Find with the box focused');
  await t.keyboard.press('Escape');
  await t.click('[data-act=boardMenu]'); await t.waitForSelector('dialog .menu');
  await pull(t, 96, 120); // on the open sheet that pull is its own swipe down, which may close it
  check(!await isOpen(t), 'not while another sheet is open');
  if (await t.isVisible('dialog .menu')) await t.click('dialog .sheet-x');
  await t.goto(BASE + `tasks.html#clock/${TODAY}`); await settle(t);
  await t.focus('[data-k="s.worker"]');
  await pull(t, 96, 160);
  check(!await isOpen(t), 'not while a text box is focused (the time clock name)');
  await t.evaluate(() => document.activeElement.blur());
  await pull(t, 96, 160);
  check(await isOpen(t), 'on the time clock otherwise');
  await t.keyboard.press('Escape');

  console.log('6. "/" on a computer');
  const desk = await open({ device: { viewport: { width: 1280, height: 800 } } });
  await desk.keyboard.press('/');
  await desk.waitForTimeout(150);
  check(await isOpen(desk) && await desk.inputValue('dialog.find input') === '', '"/" opens it, and the slash is not typed into the box');
  await desk.keyboard.press('Escape');
  await desk.goto(BASE + `tasks.html#clock/${TODAY}`); await settle(desk);
  await desk.focus('[data-k="s.worker"]'); await desk.keyboard.press('/');
  await desk.waitForTimeout(150);
  check(!await isOpen(desk) && (await desk.inputValue('[data-k="s.worker"]')).includes('/'), 'not while typing in a text box: the slash is typed');

  console.log('7. 320 px, both themes and languages: no side scroll; screenshots');
  const se = { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: iphone.userAgent };
  for (const [w, device] of [[390, iphone], [320, se]]) for (const scheme of ['light', 'dark']) for (const lang of ['en', 'es']) {
    const p = await open({ device, scheme, s: { lang }, recent: ['u1', 'u2', 'u3'] });
    const name = state => `${OUT}find-${lang}-${w}-${scheme}-${state}.png`;
    await p.click('#findBtn'); await p.waitForSelector('dialog.find[open]'); await p.waitForTimeout(400);
    await p.screenshot({ path: name('empty') });
    await find(p, lang === 'es' ? 'baño' : 'lighting'); await p.screenshot({ path: name('results') });
    if (w === 320) {
      const rows = await p.evaluate(() => [...document.querySelectorAll('dialog.find .row')].map(r => r.getBoundingClientRect().height));
      check(await noSideScroll(p) && rows.length && rows.every(h => h >= 44), `320 px ${scheme} ${lang}: no side scroll, every result at least 44 px tall`);
    }
    await find(p, 'zzq'); await p.screenshot({ path: name('nomatch') });
    await p.context().close();
  }
  console.log(`  shots in ${OUT}`);

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
