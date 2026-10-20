#!/usr/bin/env node
// Browser check: Magic Plus on the office board (docs/schwab/tasks.html), as in Things 3. Drag the floating + onto a
// floor heading ([data-floor]) and a new sheet starts on that floor (with the crew filter's crew); onto an Upcoming day
// heading ([data-day]) and it starts on that day; let go anywhere else, or just tap it, and it is the + as before.
// Fictional data only.
//
// Run (needs Playwright and a Chromium; not part of `npm test`, which is node-only):
//   cd docs/schwab && python3 -m http.server 8765 --bind 127.0.0.1 &        # serve the app
//   BASE=http://127.0.0.1:8765/ node tests/browser/schwab-things-plus.e2e.js
//   (if Playwright is installed globally: NODE_PATH=$(npm root -g) ...)
// Screenshots of the lifted + over a lit heading (390 and 320 px, light and dark) land in $TMPDIR/schwab-things-plus/
// (SHOTS=dir moves them). Exit 0 = all checks passed.
//
// A finger is driven through Chromium's touch input (CDP Input.dispatchTouchEvent), so touch-action and scrolling are
// the browser's own: the same drag that starts on a row scrolls the page (checked), so "the page did not scroll" means
// something. The mouse drag runs on a desktop-sized window without touch.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const OUT = (process.env.SHOTS || path.join(os.tmpdir(), 'schwab-things-plus')) + '/';
fs.mkdirSync(OUT, { recursive: true });
const fails = [], check = (ok, what) => { console.log(ok ? '  ok  ' : '  FAIL', what); if (!ok) fails.push(what); };

const D = '2026-10-22'; // the board's day (planning ahead, so the real date doesn't matter)
const FLOORS = ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5'];
const TASKS = [
  ...FLOORS.flatMap((floor, i) => ['Crew A', 'Crew B', 'Crew C'].map((crew, j) => ({ uid: `s${i}${j}`, origin: 'mine', id: `T1022-${String(i * 3 + j + 1).padStart(2, '0')}`, date: D, floor, crew,
    area: `Room ${i + 1}${'ABC'[j]}`, scope: 'Work', pStart: '07:00', est: 4, size: 2, items: [{ id: `i${i}${j}`, text: 'Step', done: j === 0, at: 0 }] }))),
  { uid: 'nofloor', origin: 'mine', id: 'T1022-16', date: D, floor: '', crew: 'Crew D', area: 'Yard', scope: 'Work' },
  { uid: 'up1', origin: 'mine', id: 'T1024-01', date: '2026-10-24', floor: 'Level 2', crew: 'Crew A', area: 'Hall', scope: 'Work' },
  { uid: 'up2', origin: 'mine', id: 'T1027-01', date: '2026-10-27', floor: 'Level 4', crew: 'Crew B', area: 'Shaft', scope: 'Work' },
];

(async () => {
  const browser = await chromium.launch();
  const iphone = { ...devices['iPhone 13'] }, small = { ...devices['iPhone SE'] };
  delete iphone.defaultBrowserType; delete small.defaultBrowserType;
  const errors = [];
  // A signed-in superintendent phone with the sheets above; navigator.vibrate is recorded; pointerup and hashchange times kept.
  const open = async (device = iphone, opts = {}, hash = `day/${D}`) => {
    const ctx = await browser.newContext({ ...device, serviceWorkers: 'block', ...opts });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text()));
    await p.addInitScript(seed => {
      if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v)); sessionStorage.setItem('seeded', '1'); }
      window.__buzz = [];
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: n => { window.__buzz.push(n); return true; } });
      addEventListener('pointerup', () => { window.__up = performance.now(); }, true);
      addEventListener('hashchange', () => { window.__hash = performance.now(); });
    }, { 'schwab.settings': { lang: 'en', role: 'Superintendent', me: 'Dana R', super: 'Dana R', crews: ['A', 'B', 'C', 'D'].map(x => ({ id: '', name: 'Crew ' + x, lead: '', members: '' })) }, 'schwab.tasks': TASKS, 'schwab.unlock': { until: Date.now() + 12 * 36e5, fails: 0, wait: 0 } });
    await p.goto(BASE + 'tasks.html#' + hash);
    await p.waitForSelector('.bar .fab[data-act=new]');
    return p;
  };
  const tasks = p => p.evaluate(() => JSON.parse(localStorage.getItem('schwab.tasks')));
  const added = async (p, before) => (await tasks(p)).filter(t => !before.some(b => b.uid === t.uid));
  const center = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const heading = f => `h3[data-floor="${f}"]`;
  const toMiddle = (p, sel) => p.locator(sel).first().evaluate(el => el.scrollIntoView({ block: 'center' }));
  const state = p => p.evaluate(() => {
    const fab = document.querySelector('.fab'), cs = fab && getComputedStyle(fab), on = [...document.querySelectorAll('.plus-on')];
    return { lifted: !!fab?.classList.contains('lift'), scale: cs?.scale, translate: cs?.translate, on: on.map(h => h.dataset.floor ?? h.dataset.day), onColor: on[0] && getComputedStyle(on[0]).color,
      tint: getComputedStyle(document.documentElement).getPropertyValue('--tint').trim(), y: scrollY, buzz: [...window.__buzz], wide: document.documentElement.scrollWidth };
  });
  const rgb = hex => `rgb(${hex.match(/\w\w/g).map(h => parseInt(h, 16)).join(', ')})`;
  // One finger: down at a, through steps moves to b, then hold() runs while it is still down, then up.
  const finger = async (p, a, b, { steps = 14, hold, up = true } = {}) => {
    const cdp = p.cdp ||= await p.context().newCDPSession(p), send = (type, pt) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pt ? [{ x: pt.x, y: pt.y, id: 1 }] : [] });
    await send('touchStart', a);
    for (let i = 1; i <= steps; i++) { await send('touchMove', { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }); await p.waitForTimeout(16); }
    const held = hold ? await hold() : null;
    if (up) await send('touchEnd');
    return held;
  };
  const toFloor = async (p, f, opts) => finger(p, await center(p, '.fab'), { x: 120, y: (await center(p, heading(f))).y }, opts);
  const opened = async p => { await p.waitForURL(/#task\//); await p.waitForTimeout(150); return p.url().split('#')[1]; };

  console.log('1. Touch: drag the + onto a floor heading');
  const a = await open();
  await a.click('.crew-filter [data-v=""]'); // a tap first, as on a phone in use (a vibration needs one)
  await toMiddle(a, heading('Level 3'));
  check(await a.locator('h3[data-floor]').count() >= FLOORS.length + 1, 'every floor heading carries data-floor (the board agent\'s hook): ' + await a.locator('h3[data-floor]').count());
  let before = await tasks(a), y0 = (await state(a)).y;
  const mid = await toFloor(a, 'Level 3', { hold: async () => { await a.waitForTimeout(250); return state(a); } }); // past the 180 ms fade
  check(mid.lifted && mid.scale === '1.1' && mid.translate !== 'none', `while dragging the + is lifted (scale ${mid.scale}) and follows the finger (translate ${mid.translate})`);
  check(mid.on.join() === 'Level 3' && mid.onColor === rgb(mid.tint), `only the heading under the finger lights up, in the accent: ${mid.on} ${mid.onColor}`);
  check(mid.y === y0, `the page did not scroll during the drag (${y0} then ${mid.y})`);
  const fly = await state(a);
  check(!fly.lifted && fly.on.length === 0 && await a.locator('.fab.fly').count() === 1, 'let go: the + flies back to its corner and the heading goes quiet');
  await opened(a);
  let got = await added(a, before);
  check(got.length === 1 && got[0].floor === 'Level 3' && got[0].date === D && got[0].crew === '' && /#task\/.+\/assign$/.test(a.url()), `one new sheet on Level 3 for ${D}, open on Assign: ${JSON.stringify(got.map(t => [t.floor, t.date, t.crew]))}`);
  check(await a.inputValue('[data-k="t.floor"]') === 'Level 3', 'its Floor box already says Level 3');
  check(mid.buzz.join() === '8' && (await state(a)).buzz.join() === '8,8', `a tiny vibration on lift and on drop: ${(await state(a)).buzz}`);
  check(await a.evaluate(() => window.__hash - window.__up) >= 170, `the sheet opens after the 180 ms fly back (${Math.round(await a.evaluate(() => window.__hash - window.__up))} ms)`);

  console.log('2. The crew filter\'s crew comes along; "Floor not set" makes a sheet with no floor');
  await a.goto(BASE + `tasks.html#day/${D}`); await a.waitForSelector('.fab');
  await a.click('.crew-filter [data-v="Crew B"]'); await a.waitForSelector('.crew-filter [data-v="Crew B"][aria-pressed=true]');
  await toMiddle(a, heading('Level 2'));
  before = await tasks(a);
  await toFloor(a, 'Level 2');
  await opened(a);
  got = await added(a, before);
  check(got.length === 1 && got[0].floor === 'Level 2' && got[0].crew === 'Crew B', `dropped on Level 2 with Crew B chosen: ${JSON.stringify(got.map(t => [t.floor, t.crew]))}`);
  await a.goto(BASE + `tasks.html#day/${D}`); await a.waitForSelector('.fab');
  await a.click('.crew-filter [data-v=""]');
  await toMiddle(a, heading(''));
  before = await tasks(a);
  await toFloor(a, '');
  await opened(a);
  got = await added(a, before);
  check(got.length === 1 && got[0].floor === '' && got[0].date === D, `dropped on "Floor not set": a sheet with no floor: ${JSON.stringify(got.map(t => [t.floor, t.date]))}`);

  console.log('3. A plain tap, a fast double tap, and a drag let go elsewhere are the + as before');
  const plain = async (p, how) => { await p.goto(BASE + `tasks.html#day/${D}`); await p.waitForSelector('.fab'); const b = await tasks(p); await how(); await opened(p); return added(p, b); };
  const tapAt = async (p, n) => { const c = await center(p, '.fab'); for (let i = 0; i < n; i++) { await p.touchscreen.tap(c.x, c.y); await p.waitForTimeout(150); } };
  const next = async () => `T1022-${(await tasks(a)).filter(t => t.date === D).length + 1}`, id = await next(), buzz0 = (await state(a)).buzz.length;
  got = await plain(a, () => tapAt(a, 1));
  check(got.length === 1 && got[0].floor === '' && got[0].date === D && got[0].id === id && (await state(a)).buzz.length === buzz0, `a tap: one new sheet for ${D}, no floor, the next number, no lift or vibration: ${JSON.stringify(got.map(t => [t.id, t.floor]))}`);
  got = await plain(a, () => tapAt(a, 2));
  check(got.length === 1 && await a.locator('#toast.show[data-tone=bad]').count() === 0, `a fast double tap: still one sheet, and the second tap does not land on Send to crew (${got.length})`);
  got = await plain(a, async () => { const row = await center(a, '.tcard >> nth=1'); await finger(a, await center(a, '.fab'), row); }); // the second row under Level 1: no heading near
  check(got.length === 1 && got[0].floor === '' && got[0].date === D && got[0].crew === '', `a drag let go on a row, away from any heading: the plain + (${JSON.stringify(got.map(t => [t.floor, t.date]))})`);
  await a.goto(BASE + `tasks.html#day/${D}`); await a.waitForSelector('.fab');
  before = await tasks(a);
  await finger(a, await center(a, '.fab'), await center(a, heading('Level 1')), { up: false });
  await (a.cdp).send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); // the phone took the touch away (a call)
  await a.waitForTimeout(500);
  check((await added(a, before)).length === 0 && /#day\//.test(a.url()) && await a.locator('.fab.lift, .fab.fly, .plus-on').count() === 0, 'a drag the phone cancels makes nothing, and the + is back in its corner');

  console.log('4. The page never scrolls under a drag of the +, and still scrolls under a drag of the list');
  await a.evaluate(() => scrollTo(0, 0));
  const listDrag = await finger(a, { x: 150, y: 520 }, { x: 150, y: 220 }, { hold: () => a.evaluate(() => scrollY) });
  await a.waitForTimeout(300);
  check(listDrag > 100 && await a.locator('.fab.lift').count() === 0, `a finger dragged up the list scrolls the page (to ${listDrag}): Magic Plus leaves it alone`);
  await a.evaluate(() => scrollTo(0, 0)); await a.waitForTimeout(100);
  before = await tasks(a);
  const fc = await center(a, '.fab'), still = await finger(a, fc, { x: fc.x - 120, y: fc.y - 300 }, { hold: () => state(a) });
  check(still.lifted && still.y === 0, `the same drag started on the + lifts it and the page stays put (scrollY ${still.y})`);
  await opened(a);

  console.log('5. Near an edge the list scrolls slowly; then drop on a heading that scrolled into view');
  await a.goto(BASE + `tasks.html#day/${D}`); await a.waitForSelector('.fab');
  await a.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await a.waitForTimeout(100);
  before = await tasks(a);
  const bottomY = (await state(a)).y, top = await a.evaluate(() => document.querySelector('.top').getBoundingClientRect().bottom);
  const cdp = a.cdp ||= await a.context().newCDPSession(a), touch = (type, pt) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pt ? [{ ...pt, id: 1 }] : [] });
  const s = await center(a, '.fab');
  await touch('touchStart', s);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', { x: s.x - 10 * i, y: s.y - (s.y - 330) * i / 10 }); await a.waitForTimeout(16); }
  const calm = (await state(a)).y;
  for (let i = 1; i <= 6; i++) { await touch('touchMove', { x: s.x - 100, y: 330 - (330 - top - 12) * i / 6 }); await a.waitForTimeout(16); }
  await a.waitForTimeout(500);
  const y1 = (await state(a)).y;
  check(calm === bottomY && y1 < bottomY && bottomY - y1 < 600, `with the finger by the top edge the list scrolls up, slowly (${bottomY} to ${y1} in half a second; it stayed at ${calm} until then)`);
  await touch('touchMove', { x: s.x - 100, y: 400 }); await a.waitForTimeout(150);
  const y2 = (await state(a)).y; await a.waitForTimeout(300);
  check((await state(a)).y === y2, 'back in the middle of the list, the scrolling stops');
  await touch('touchMove', { x: s.x - 100, y: top + 12 }); // up again until Level 1 comes into view
  await a.waitForFunction(t => document.querySelector('h3[data-floor="Level 1"]').getBoundingClientRect().top > t + 70, top, { timeout: 8000 });
  const l1 = await center(a, heading('Level 1'));
  await touch('touchMove', { x: 120, y: l1.y }); await a.waitForTimeout(50);
  check((await state(a)).on.join() === 'Level 1', 'the finger on Level 1, now in view, lights it');
  await touch('touchEnd');
  await opened(a);
  got = await added(a, before);
  check(got.length === 1 && got[0].floor === 'Level 1', `dropped there: a sheet on Level 1 (${JSON.stringify(got.map(t => t.floor))})`);

  console.log('6. Upcoming: drop on a day heading');
  const u = await open();
  await u.click('.crew-filter [data-v="Crew B"]'); // chosen on the board; Upcoming shows every crew, so it is not carried there
  await u.goto(BASE + `tasks.html#upcoming/${D}`); await u.waitForSelector('.board.upcoming');
  const days = await u.locator('h3[data-day]').evaluateAll(hs => hs.map(h => h.dataset.day));
  check(days.includes('2026-10-24') && days.includes('2026-10-27'), 'Upcoming has its day headings with data-day (the Upcoming agent\'s hook): ' + days.join());
  if (days.includes('2026-10-27')) {
    await toMiddle(u, 'h3[data-day="2026-10-27"]');
    before = await tasks(u);
    const um = await finger(u, await center(u, '.fab'), { x: 270, y: (await center(u, 'h3[data-day="2026-10-27"]')).y }, { hold: async () => { await u.waitForTimeout(250); await u.screenshot({ path: OUT + 'plus-upcoming-390-light.png' }); return state(u); } });
    check(um.on.join() === '2026-10-27' && um.lifted && um.onColor === rgb(um.tint), `the day under the finger lights up in the accent: ${um.on} ${um.onColor}`);
    await opened(u);
    got = await added(u, before);
    check(got.length === 1 && got[0].date === '2026-10-27' && got[0].id === 'T1027-02' && got[0].floor === '' && got[0].crew === '', `one new sheet on Tue, Oct 27, numbered for that day, no crew: ${JSON.stringify(got.map(t => [t.date, t.id, t.crew]))}`);
  }

  console.log('7. Reduced motion: no lift, no fly, just the result');
  const r = await open(iphone, { reducedMotion: 'reduce' });
  await toMiddle(r, heading('Level 4'));
  before = await tasks(r);
  const rm = await toFloor(r, 'Level 4', { hold: () => state(r) });
  check(rm.scale === 'none' && rm.on.join() === 'Level 4', `the + does not grow (scale ${rm.scale}); the heading still lights`);
  await opened(r);
  got = await added(r, before);
  check(got.length === 1 && got[0].floor === 'Level 4', 'dropped: the sheet on Level 4');
  check(await r.evaluate(() => window.__hash - window.__up) < 120, `it opens at once, with no fly back (${Math.round(await r.evaluate(() => window.__hash - window.__up))} ms)`);

  console.log('8. A mouse on a computer');
  const m = await open({ viewport: { width: 1280, height: 800 } });
  await toMiddle(m, heading('Level 5'));
  before = await tasks(m);
  const ms = await center(m, '.fab'), mt = await center(m, heading('Level 5'));
  await m.mouse.move(ms.x, ms.y); await m.mouse.down();
  for (let i = 1; i <= 12; i++) { await m.mouse.move(ms.x + (mt.x - ms.x) * i / 12, ms.y + (mt.y - ms.y) * i / 12); await m.waitForTimeout(16); }
  const md = await state(m);
  check(md.lifted && md.on.join() === 'Level 5', `the + lifts under the mouse and Level 5 lights: ${md.on}`);
  await m.mouse.up();
  await opened(m);
  got = await added(m, before);
  check(got.length === 1 && got[0].floor === 'Level 5', `let go: exactly one sheet, on Level 5 (the click after the drag is not a second +): ${JSON.stringify(got.map(t => t.floor))}`);
  await m.goto(BASE + `tasks.html#day/${D}`); await m.waitForSelector('.fab');
  before = await tasks(m);
  await m.click('.fab'); await opened(m);
  got = await added(m, before);
  check(got.length === 1 && got[0].floor === '', 'a mouse click on + is the plain + as before');
  await m.goto(BASE + `tasks.html#day/${D}`); await m.waitForSelector('.fab');
  before = await tasks(m);
  await m.focus('.fab'); await m.keyboard.press('Enter'); await opened(m);
  check((await added(m, before)).length === 1, 'and Enter on it from the keyboard too');

  console.log('9. Screenshots: the lifted + over a lit heading (390 and 320 px, light and dark)');
  for (const [name, dev] of [['390', iphone], ['320', small]]) for (const scheme of ['light', 'dark']) {
    const p = await open(dev, { colorScheme: scheme });
    await toMiddle(p, heading('Level 2'));
    const f = await center(p, '.fab'), h = await center(p, heading('Level 2'));
    const st = await finger(p, f, { x: Math.min(f.x - 40, dev.viewport.width * .6), y: h.y }, { up: false, hold: async () => { await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}plus-${name}-${scheme}.png` }); return state(p); } });
    check(st.lifted && st.on.join() === 'Level 2' && st.wide <= dev.viewport.width, `${name} px ${scheme}: lifted, Level 2 lit, no side scroll (${st.wide} px)`);
    await p.context().close();
  }

  check(!errors.length, 'no page errors ' + errors.join(' | '));
  await browser.close();
  console.log(fails.length ? `${fails.length} FAILED` : 'all passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); process.exit(2); });
