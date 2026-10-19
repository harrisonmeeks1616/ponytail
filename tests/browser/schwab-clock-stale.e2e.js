#!/usr/bin/env node
// Browser regression: a Time clock left open across the 16-hour cutoff must never turn a "Clock out" tap into a
// silent clock-in (docs/schwab/report.mjs: the hTap guard that compares the button's data-v with the open shift,
// the cutoff timer in clockView, and the foreground redraw in tasks.html's visibilitychange handler).
//
// Run (needs Playwright and a Chromium; not part of `npm test`, which is node-only):
//   cd docs/schwab && python3 -m http.server 8765 --bind 127.0.0.1 &        # serve the app
//   BASE=http://127.0.0.1:8765/ node tests/browser/schwab-clock-stale.e2e.js
//   (if Playwright is installed globally: NODE_PATH=$(npm root -g) ...)
// Exit 0 = all checks passed.
//
// What it proves, on a fake clock (page.clock):
//   1. Asleep past the cutoff (time jumps from 15h59m to 16h01m and no timer runs): tapping the still-displayed
//      "Clock out" neither clocks out nor starts a new shift, opens no clock-in text, tells the worker why, and
//      the button then shows "Clock in"; tapping that on purpose starts the new shift.
//   2. With the screen open, the cutoff timer redraws the button to "Clock in" by itself.
//   3. Returning to the foreground after the cutoff redraws the clock.
//   4. A real overnight shift (22:00 to 06:00) still clocks out across midnight.
// Negative evidence (2026-10-19, against 46a3f26 copies served on another port): with the hTap guard disabled
// ("if (shown && shown !== now)" made false), case 1 failed: the stale tap started a new shift and opened a
// clock-in text. With only the foreground redraw disabled, case 3 failed. With the fix in place: 11 of 11 pass.
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const fails = [], check = (ok, what) => { console.log(ok ? '  ok  ' : '  FAIL', what); if (!ok) fails.push(what); };
(async () => {
  const browser = await chromium.launch();
  const phone = { ...devices['iPhone 13'] }; delete phone.defaultBrowserType;
  const errors = [];
  const worker = async (name, start) => {
    const ctx = await browser.newContext(phone), p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    await p.clock.install({ time: new Date(start) });
    await p.goto(BASE + 'tasks.html#clock/' + start.slice(0, 10));
    // A new phone asks its first-run questions first: English, a crew member, the worker's name.
    await p.click('dialog.firstrun [data-fr=lang][data-v=en]');
    await p.click('dialog.firstrun [data-fr=role][data-v="Crew member"]');
    await p.fill('#frName', name);
    await p.click('dialog.firstrun [data-fr=next]');
    await p.waitForSelector('[data-k="s.worker"]');
    check(await p.inputValue('[data-k="s.worker"]') === name, `${name}: the first run's name is the time clock name`);
    return p;
  };
  const label = p => p.textContent('[data-act=hTap]').then(t => t.trim());
  const shifts = p => p.evaluate(() => JSON.parse(localStorage.getItem('schwab.hours') || '[]'));
  const clockIn = async p => { await p.click('[data-act=hTap]:has-text("Clock in")'); await p.waitForSelector('dialog .linkbox'); await p.locator('dialog .sheet-x').click(); };

  console.log('1. Asleep past the cutoff: no timer ran, the screen still says Clock out');
  const a = await worker('Raul Q', '2026-10-14T05:00:00');
  await clockIn(a);
  await a.clock.setSystemTime(new Date('2026-10-14T20:59:00')); // 15h59m: still on the clock
  check(await label(a) === 'Clock out', 'at 15h59m the button says Clock out');
  await a.clock.setSystemTime(new Date('2026-10-14T21:01:00')); // 16h01m, and no timer has fired (the phone slept)
  check(await label(a) === 'Clock out', 'stale screen: the button still shows Clock out (setup)');
  await a.click('[data-act=hTap]:has-text("Clock out")');
  await a.waitForTimeout(200);
  const after = await shifts(a);
  check(after.length === 1 && !after[0].out, 'the stale tap neither clocked out nor started a new shift');
  check(await a.locator('dialog .linkbox').count() === 0, 'no clock-in text was opened');
  check(/passed 16 hours/.test(await a.textContent('#toast')), 'the worker is told the shift passed 16 hours');
  check(await label(a) === 'Clock in', 'the screen now shows the truth: Clock in');
  await clockIn(a);
  check((await shifts(a)).length === 2, 'tapping Clock in now, on purpose, starts the new shift');

  console.log('2. The cutoff timer redraws the screen while it is open');
  const b = await worker('Lena V', '2026-10-14T05:00:00');
  await clockIn(b);
  await b.clock.runFor(16 * 36e5 + 2000); // timers fire as time passes
  await b.waitForTimeout(150);
  check(await label(b) === 'Clock in', 'at the cutoff the button turns to Clock in by itself');

  console.log('3. Back to the foreground after the cutoff');
  const c = await worker('Omar T', '2026-10-14T05:00:00');
  await clockIn(c);
  await c.clock.setSystemTime(new Date('2026-10-14T21:30:00')); // no timers
  await c.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
  await c.waitForTimeout(150);
  check(await label(c) === 'Clock in', 'coming back to the app redraws the clock');

  console.log('4. A real overnight shift still clocks out across midnight');
  const d = await worker('Night W', '2026-10-14T22:00:00');
  await clockIn(d);
  await d.clock.setSystemTime(new Date('2026-10-15T06:00:00'));
  await d.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))); // the new day redraws today's clock
  await d.waitForTimeout(150);
  check(await label(d) === 'Clock out', 'after midnight the overnight shift still shows Clock out');
  await d.click('[data-act=hTap]:has-text("Clock out")');
  await d.waitForSelector('dialog .linkbox');
  const s = (await shifts(d))[0];
  check(s.date === '2026-10-14' && s.out === '06:00' && (await shifts(d)).length === 1, 'clocked out 06:00 on the shift that began 22:00 the day before');

  console.log('ERRORS:', errors.length ? errors : 'none');
  console.log(fails.length ? `FAILED: ${fails.length}` : 'ALL CHECKS PASSED');
  await browser.close();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); process.exit(2); });
