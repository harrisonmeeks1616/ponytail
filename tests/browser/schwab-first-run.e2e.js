#!/usr/bin/env node
// Browser check: the first run on a new phone, and Undo in place of "are you sure?" (docs/schwab/tasks.html).
//
// Run (needs Playwright and a Chromium; not part of `npm test`, which is node-only):
//   cd docs/schwab && python3 -m http.server 8765 &
//   BASE=http://localhost:8765/ node tests/browser/schwab-first-run.e2e.js
// Exit 0 = all checks passed.
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765/';
const fails = [], check = (ok, what) => { console.log(ok ? '  ok  ' : '  FAIL', what); if (!ok) fails.push(what); };
(async () => {
  const browser = await chromium.launch();
  const phone = { ...devices['iPhone 13'] }; delete phone.defaultBrowserType;
  const errors = [];
  const open = async (url = 'tasks.html') => {
    const p = await (await browser.newContext(phone)).newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE + url);
    return p;
  };
  const settings = p => p.evaluate(() => JSON.parse(localStorage.getItem('schwab.settings')));
  const fr = (fr, v) => `dialog.firstrun [data-fr=${fr}]${v ? `[data-v="${v}"]` : ''}`;

  console.log('1. A crew phone opened from its texted link');
  const maker = await open();
  const code = await maker.evaluate(() => import('./shared.mjs').then(m => m.pack({ v: 1, kind: 'task', task: { uid: 'u1', id: 'T1', date: '2026-10-19', crew: 'Crew A', members: ['Jose L', 'Ana P'], scope: 'Work', items: [{ id: 'i1', text: 'Step' }] } })));
  const crew = await open('tasks.html#p=' + code);
  await crew.waitForSelector(fr('lang'));
  await crew.keyboard.press('Escape');
  check(await crew.isVisible('dialog.firstrun') && !(await settings(crew)), 'it asks the language first; Escape does not skip it and nothing is saved yet');
  await crew.click(fr('lang', 'es'));
  await crew.waitForSelector(fr('role')); // the linked task is decompressed before this screen appears
  check(/Quién usa este teléfono/.test(await crew.textContent('dialog.firstrun h2')) && await crew.locator(fr('role')).count() === 3, 'then, in Spanish, who is using the phone: three buttons');
  await crew.click(fr('role', 'Crew member'));
  await crew.waitForSelector(fr('pick'));
  check((await crew.locator(fr('pick')).allTextContents()).join() === 'Jose L,Ana P', 'the name step offers the names on the sheet');
  await crew.click(fr('next'));
  check(/Primero escriba su nombre/.test(await crew.textContent('dialog.firstrun .fr-msg')), 'no name, no next step');
  await crew.click(fr('pick', 'Jose L'));
  await crew.waitForSelector('[data-act=sendResults]');
  const s = await settings(crew);
  check(s.lang === 'es' && s.role === 'Crew member' && s.worker === 'Jose L' && await crew.locator('dialog[open]').count() === 0, 'answered: saved, and the sheet opens with no second question');
  await crew.reload(); await crew.waitForSelector('[data-act=sendResults]');
  check(await crew.locator('dialog.firstrun').count() === 0, 'it is asked once');
  await crew.goto(BASE + 'tasks.html#day/2026-10-18'); await crew.waitForSelector('.empty');
  check(await crew.locator('.empty [data-act=lockBtn]').count() === 0, 'a crew phone shows no office sign-in words');
  await crew.goto(BASE + 'tasks.html#clock/2026-10-18'); await crew.waitForSelector('[data-act=hMenu]'); await crew.click('[data-act=hMenu]'); await crew.waitForSelector('dialog .menu');
  check(await crew.locator('dialog [data-act=lockBtn]').count() === 0, 'nor in the Time clock menu'); await crew.click('dialog .sheet-x');

  console.log('2. An office phone');
  const sup = await open();
  await sup.click(fr('lang', 'en')); await sup.click(fr('role', 'Superintendent'));
  await sup.fill('#frName', 'Dana R'); await sup.click(fr('next'));
  await sup.waitForSelector('dialog.pin .keypad');
  check((await sup.textContent('dialog.pin h3')) === 'Create the office passcode', 'then it makes the office passcode');
  for (const d of '48214821') await sup.click(`dialog.pin [data-pin="${d}"]`);
  await sup.waitForSelector('.bar [data-act=new]');
  check((await settings(sup)).me === 'Dana R' && /^[0-9a-f]{16}:/.test((await settings(sup)).pin), 'signed in, with the name and the code saved');

  console.log('3. Undo, not "are you sure?"');
  await sup.click('.bar [data-act=new]'); await sup.waitForSelector('#newItem');
  for (const t of ['One', 'Two']) { await sup.fill('#newItem', t); await sup.press('#newItem', 'Enter'); }
  const steps = () => sup.evaluate(() => JSON.parse(localStorage.getItem('schwab.tasks'))[0]?.items.map(i => i.text).join() ?? null);
  await sup.click('[data-act=delItem][data-i="0"]');
  check(await steps() === 'Two', 'a removed step is gone at once');
  await sup.click('#toast .toast-undo');
  check(await steps() === 'One,Two', 'Undo puts it back in its place');
  await sup.click('[data-act=taskMenu]'); await sup.click('dialog [data-act=del]');
  await sup.waitForSelector('#toast .toast-undo');
  check(await steps() === null && await sup.locator('dialog .ask').count() === 0, 'a deleted sheet is gone at once, without a question');
  await sup.click('#toast .toast-undo');
  check(await steps() === 'One,Two' && await sup.locator('.tcard').count() === 1, 'Undo brings the sheet back to the board');

  console.log("4. A finger's double tap is one tap, a stepper counts every tap; Back closes a menu");
  const tap2 = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2; await p.touchscreen.tap(x, y); await p.waitForTimeout(150); await p.touchscreen.tap(x, y); await p.waitForTimeout(500); };
  const fresh = await open(); await fresh.waitForSelector(fr('lang'));
  await tap2(fresh, fr('lang', 'es'));
  check(/Quién usa/.test(await fresh.textContent('#frQ')), 'a double tap on Español answers only the language, not the next question');
  await tap2(sup, '.bar [data-act=new]');
  check(/#task\//.test(sup.url()) && await sup.evaluate(() => JSON.parse(localStorage.getItem('schwab.tasks')).length) === 2 && await sup.locator('#toast.show[data-tone=bad]').count() === 0,
    'a double tap on + opens one new sheet, and the second tap does not land on Send to crew');
  await sup.click('[data-act=taskMenu]'); await sup.waitForSelector('dialog .menu'); await sup.goBack(); await sup.waitForTimeout(300);
  check(/#day\//.test(sup.url()) && await sup.locator('dialog[open]').count() === 0, 'Back with the ⋯ menu open closes the menu with its screen');
  // A control drawn again under the finger is still the same control: fast taps on a stepper or an arrow all count.
  const tap4 = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2; for (let i = 0; i < 4; i++) { await p.touchscreen.tap(x, y); await p.waitForTimeout(200); } await p.waitForTimeout(300); };
  await sup.goto(BASE + 'tasks.html#day/2026-10-19'); await sup.waitForSelector('.datebar .nav-btn');
  await tap4(sup, '.datebar .nav-btn');
  check(sup.url().endsWith('#day/2026-10-15'), 'four fast finger taps on the previous-day arrow go back exactly 4 days: ' + sup.url().split('#')[1]);
  await crew.goto(BASE + 'tasks.html#task/u1/assign'); await crew.waitForSelector('[data-act=delay][data-v="15"]');
  await crew.locator('[data-act=delay][data-v="15"]').scrollIntoViewIfNeeded(); await crew.waitForTimeout(200);
  await tap4(crew, '[data-act=delay][data-v="15"]');
  const delay = await crew.evaluate(() => JSON.parse(localStorage.getItem('schwab.tasks')).find(t => t.uid === 'u1').delay);
  check(delay === 60, 'four fast finger taps on Delay + add exactly 60 minutes: ' + delay);

  check(!errors.length, 'no page errors ' + errors.join(' | '));
  await browser.close();
  console.log(fails.length ? `${fails.length} FAILED` : 'all passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); process.exit(2); });
