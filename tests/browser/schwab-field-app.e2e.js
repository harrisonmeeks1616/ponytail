#!/usr/bin/env node
// Browser end-to-end: the field app (docs/schwab/tasks.html) on the phones of a whole job. A superintendent sets up a
// new phone, builds and sends a task sheet; a crew phone and two workers' phones open it, clock in and out; the daily
// report goes to a new PM phone, which logs and fixes the crew hours and sends them to the accountant; then locking,
// a 320 px phone and Spanish. Also: the first run on each new phone, Undo instead of "are you sure?", the tab bar.
// Fictional data only.
//
// Run (needs Playwright, a Chromium and pdftotext; not part of `npm test`, which is node-only):
//   cd docs/schwab && python3 -m http.server 8765 --bind 127.0.0.1 &        # serve the app
//   BASE=http://127.0.0.1:8765/ node tests/browser/schwab-field-app.e2e.js
//   (if Playwright is installed globally: NODE_PATH=$(npm root -g) ...)
// Screenshots, PDFs and the timesheet files land in $TMPDIR/schwab-field-app/ (SHOTS=dir moves them).
// Exit 0 = all checks passed.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const OUT = (process.env.SHOTS || path.join(os.tmpdir(), 'schwab-field-app')) + '/';
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const fails = [];
const check = (ok, what) => { log(ok ? '  ok  ' : '  FAIL', what); if (!ok) fails.push(what); };

(async () => {
  const browser = await chromium.launch();
  const phone = { ...devices['iPhone 13'] };
  delete phone.defaultBrowserType;
  const errors = [];
  const mk = async (name, opts = {}) => {
    const ctx = await browser.newContext({ ...phone, acceptDownloads: true, ...opts });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    page.on('console', m => m.type() === 'error' && !/ERR_CERT/.test(m.text()) && errors.push(`${name} console: ${m.text()}`)); // a sandbox that blocks outside https is not the app's error
    return page;
  };
  const pad = async (p, code) => { for (const d of code) await p.click(`dialog [data-pin="${d}"]`); await p.waitForTimeout(80); };
  const takeLink = async p => { await p.waitForSelector('dialog .linkbox'); const v = await p.locator('dialog .linkbox').inputValue(); await p.locator('dialog .sheet-x').click(); return v; };
  const payload = (p, url) => p.evaluate(async u => (await import('./shared.mjs')).unpack(new URL(u).hash.slice(3)), url);
  const pdfText = async (p, click) => {
    const [dl] = await Promise.all([p.waitForEvent('download'), click()]);
    const file = OUT + dl.suggestedFilename();
    await dl.saveAs(file);
    return execFileSync('pdftotext', ['-enc', 'UTF-8', '-layout', file, '-']).toString();
  };
  // The emulated phone's real width: under iPhone emulation innerWidth grows to fit wide content, so it can't be the yardstick.
  const noSideScroll = p => p.evaluate(w => document.documentElement.scrollWidth <= w, p.viewportSize().width);
  // A new phone asks its first-run questions (language, who is using it, the name) before anything else.
  const fr = (step, v) => `dialog.firstrun [data-fr=${step}]${v ? `[data-v="${v}"]` : ''}`;
  const firstRun = async (p, role, name, { pick } = {}) => {
    await p.click(fr('lang', 'en'));
    await p.click(fr('role', role));
    if (pick) return p.click(fr('pick', name)); // one tap on a name the phone knows answers
    await p.fill('#frName', name);
    await p.click(fr('next'));
  };
  const tabNames = async p => (await p.locator('#officeTabs a').allTextContents()).map(t => t.trim()).join(' | ');
  const tab = v => `#officeTabs a[href^="#${v}"]`;

  log('1. A new superintendent phone: the first run, then the office passcode');
  const sup = await mk('super');
  await sup.goto(BASE);
  await sup.waitForURL(/tasks\.html/);
  await sup.waitForSelector(fr('lang'));
  check((await sup.textContent('dialog.firstrun h2')).trim() === 'Language · Idioma' && await sup.locator('#app *').count() === 0 && await sup.evaluate(() => !localStorage.getItem('schwab.settings')),
    'a new phone opens on the first run, language first; nothing behind it is drawn and nothing is saved yet');
  await sup.screenshot({ path: OUT + '0-first-run.png' });
  await sup.click(fr('lang', 'en')); await sup.click(fr('role', 'Superintendent'));
  await sup.click(fr('next'));
  check(/Type your name first/.test(await sup.textContent('dialog.firstrun .fr-msg')) && await sup.locator('dialog.pin').count() === 0, 'no name, no next step');
  await sup.fill('#frName', 'Dana Super'); await sup.click(fr('next'));
  await sup.waitForSelector('dialog.pin .keypad');
  check((await sup.textContent('dialog.pin h3')) === 'Create the office passcode', 'an office role asks for a passcode; none yet, so it offers to create one');
  await pad(sup, '4821');
  check(/again/.test(await sup.textContent('dialog .pin-msg')), 'asks to confirm the code');
  await pad(sup, '4822');
  check(/didn't match/.test(await sup.textContent('dialog .pin-msg')), 'a mismatch starts over');
  await sup.screenshot({ path: OUT + '2-pad.png' });
  await pad(sup, '4821'); await pad(sup, '4821');
  await sup.waitForSelector('dialog', { state: 'detached' });
  await sup.waitForSelector('.bar [data-act=new]');
  // The superintendent's Hours tab is their own Time clock, so it carries that screen's name (the PM's says Hours, step 7b).
  check(await sup.isVisible('#officeTabs') && await tabNames(sup) === 'Tasks | Time clock | Report' && await sup.isVisible('#gearBtn'), 'signed in: the tab bar shows Tasks, Time clock and Report; the gear shows: ' + await tabNames(sup));
  check(await sup.getAttribute(tab('day'), 'aria-current') === 'page', 'the Tasks tab is the current one');
  const stored = await sup.evaluate(() => JSON.parse(localStorage.getItem('schwab.settings') || '{}').pin || '');
  check(/^[0-9a-f]{16}:[0-9a-f]{64}$/.test(stored) && !stored.includes('4821'), 'code saved as a salted hash');
  const supS = await sup.evaluate(() => JSON.parse(localStorage.getItem('schwab.settings')));
  check(supS.me === 'Dana Super' && supS.role === 'Superintendent' && supS.lang === 'en', 'the first run saved the name, the role and the language');

  log('1b. Locked: the crew screens only; Settings asks for the code');
  await sup.click('#lockBtn');
  await sup.waitForSelector('.empty');
  // DESIGN.md: signed out there is no Report tab (it was a locked Daily report tab); going to #report still asks for the code (step 3).
  check(await sup.isVisible('#officeTabs') && await tabNames(sup) === 'Today | Time clock' && await sup.locator(tab('report')).count() === 0, 'signed out: Today and Time clock tabs, no Report tab: ' + await tabNames(sup));
  check((await sup.textContent('.brand h1')).trim() === 'H.A. Sack-Electrical' && (await sup.textContent('.brand p')).trim() === 'Sack Company-Electrical', 'both company names in the header');
  check(await sup.locator('[data-act=new]').count() === 0 && await sup.isHidden('#gearBtn'), 'signed out: no New task button and no gear');
  await sup.screenshot({ path: OUT + '1-signed-out.png' });
  await sup.goto(BASE + 'tasks.html#settings');
  await sup.waitForSelector('dialog .keypad');
  check((await sup.textContent('dialog h3')) === 'Office sign-in', 'the office screen asks for the code made on the first run');
  await pad(sup, '4821');
  await sup.waitForSelector('dialog', { state: 'detached' });
  await sup.waitForSelector('[data-k="s.me"]');
  check(await sup.isVisible('#officeTabs') && await sup.inputValue('[data-k="s.me"]') === 'Dana Super', 'signed in: Settings, with the name from the first run');
  await sup.fill('[data-k="s.super"]', 'Dana Super');
  // The people editor: names as chips, a box to add them (several at once with commas), a question before a second person with one name.
  const addPeople = async (p, i, names) => { const box = p.locator('input[data-enter=pAdd]').nth(i); await box.fill(names); await box.press('Enter'); await p.waitForTimeout(150); };
  const roster = p => p.evaluate(() => JSON.parse(localStorage.getItem('schwab.settings')));
  await addPeople(sup, 0, 'Jose L, Luis M');
  check((await sup.locator('.crew-edit').first().locator('[data-act=pEdit]').allTextContents()).join() === 'Jose L,Luis M' && await sup.evaluate(() => document.activeElement?.dataset.enter === 'pAdd'),
    'two names typed with a comma become two chips on Crew A; the keyboard stays in the box');
  await addPeople(sup, 1, 'jose l');
  check(/Jose L is already on Crew A\. Is that the same person\?/.test(await sup.textContent('dialog .ask')), 'a name already on another crew asks first');
  await sup.click('dialog .btn >> text=Someone else: add a second Jose L');
  await sup.waitForTimeout(150);
  let ros = await roster(sup);
  check(ros.people.filter(p => p.name.toLowerCase() === 'jose l').length === 2 && new Set(ros.people.map(p => p.id)).size === ros.people.length && ros.crews[1].members === 'jose l',
    'someone else with the same name: two people, two ids, on their own crews');
  await sup.locator('.crew-edit').nth(1).locator('[data-act=pEdit]').click(); // Remove is in the person sheet, with Undo instead of a question
  await sup.click('dialog [data-act=pDel]');
  await sup.waitForSelector('#toast .toast-undo');
  check((await roster(sup)).people.length === 2 && await sup.locator('dialog .ask').count() === 0, 'Remove takes the person off at once, without a question');
  await sup.click('#toast .toast-undo');
  await sup.waitForTimeout(150);
  ros = await roster(sup);
  check(ros.people.length === 3 && ros.crews[1].members === 'jose l' && await sup.locator('.crew-edit').nth(1).locator('[data-act=pEdit]').count() === 1, 'Undo puts the person back on the crew');
  await sup.locator('.crew-edit').nth(1).locator('[data-act=pEdit]').click();
  await sup.click('dialog [data-act=pDel]');
  await sup.waitForTimeout(150);
  await sup.locator('.crew-edit').first().locator('[data-act=pEdit] >> text=Luis M').click();
  await sup.click('dialog [data-move] >> text=Crew B');
  await sup.waitForTimeout(150);
  ros = await roster(sup);
  const luis = ros.people.find(p => p.name === 'Luis M');
  check(ros.people.length === 2 && ros.crews[0].members === 'Jose L' && ros.crews[1].members === 'Luis M', 'remove takes a person off; tapping a name moves them to another crew');
  await sup.locator('[data-act=pEdit] >> text=Luis M').click();
  await sup.fill('dialog [name=who]', 'Luis Mar'); await sup.click('dialog [data-save]');
  await sup.locator('[data-act=pEdit] >> text=Luis Mar').click();
  await sup.click('dialog [data-move] >> text=Crew A');
  await sup.locator('[data-act=pEdit] >> text=Luis Mar').click();
  await sup.fill('dialog [name=who]', 'Luis M'); await sup.press('dialog [name=who]', 'Enter');
  await sup.waitForTimeout(150);
  ros = await roster(sup);
  check(ros.crews[0].members === 'Jose L, Luis M' && ros.people.find(p => p.name === 'Luis M')?.id === luis.id, 'a rename and a move keep the same person (same id)');

  log('2. Build and send a task sheet');
  await sup.click(tab('day'));
  await sup.evaluate(() => { location.hash = '#day/2026-10-14'; }); // the workers' phones below clock in on Wed Oct 14
  await sup.waitForSelector('.datebar input[data-pick=day][value="2026-10-14"]');
  await sup.click('.bar [data-act=new]');
  await sup.fill('[data-k="t.floor"]', 'Level 3');
  await sup.fill('[data-k="t.area"]', 'East corridor');
  await sup.click('.chip[data-act=crew]:has-text("Crew A")');
  await sup.fill('#newMember', 'Tre W'); await sup.press('#newMember', 'Enter');
  check(/Tre W added to Crew A/.test(await sup.textContent('#toast')) && await sup.evaluate(() => JSON.parse(localStorage.getItem('schwab.settings')).crews[0].members) === 'Jose L, Luis M, Tre W', 'a name added on a task sheet is saved on its crew in Settings');
  await sup.fill('[data-k="t.scope"]', 'Pull 12 AWG for lighting circuits L3-14 to L3-18.');
  for (const st of ['Set boxes', 'Pull wire']) { await sup.fill('#newItem', st); await sup.press('#newItem', 'Enter'); }
  await sup.screenshot({ path: OUT + '3-assign.png', fullPage: true });
  await sup.click('.bar [data-act=sendTask]:has-text("Send to crew")');
  const taskLink = await takeLink(sup);
  const tp = await payload(sup, taskLink);
  check(tp.pin === stored && !('siteCode' in tp) && !JSON.stringify(tp).includes('4821'), 'task link carries the hashed office code, never the code itself or the upload code');

  log('3. Crew phone');
  const crew = await mk('crew', { colorScheme: 'dark' });
  await crew.goto(taskLink);
  await crew.click(fr('lang', 'en')); await crew.click(fr('role', 'Crew member'));
  await crew.waitForSelector(fr('pick'));
  check((await crew.locator(fr('pick')).allTextContents()).join() === 'Jose L,Luis M,Tre W', "a crew phone opened from its link: the name step offers the names on the sheet");
  await crew.click(fr('pick', 'Tre W'));
  await crew.waitForSelector('[data-act=sendResults]');
  // DESIGN.md: the first run asks the language, so a new crew phone no longer gets the "Language · Idioma" sheet.
  check(await crew.isVisible('[data-act=sendResults]') && await crew.locator('dialog[open]').count() === 0, 'crew sees its sheet, with no second question');
  check(await tabNames(crew) === 'Today | Time clock', 'a crew phone has two tabs: Today and Time clock: ' + await tabNames(crew));
  await crew.click(tab('clock'));
  await crew.waitForSelector('[data-k="s.worker"]');
  check(await crew.locator('dialog .keypad').count() === 0 && await crew.inputValue('[data-k="s.worker"]') === 'Tre W', 'time clock opens on a crew phone without the code, under the name picked on the first run');
  // DESIGN.md: a crew phone has no Report tab now; the report's address still asks for the code.
  check(await crew.locator(tab('report')).count() === 0, 'a crew phone shows no Report tab');
  await crew.goto(taskLink.replace(/#.*/, '') + '#report/2026-10-14');
  await crew.waitForSelector('dialog .keypad');
  check((await crew.textContent('dialog h3')) === 'Office sign-in', 'the daily report asks a crew phone for the code');
  await crew.click('dialog .sheet-x');
  await crew.waitForTimeout(150);
  await crew.goBack().catch(() => {});
  await crew.goto(taskLink.replace(/#.*/, '') + '#task/' + tp.task.uid + '/results');
  await crew.waitForSelector('[data-act=sendResults]');
  check(await crew.evaluate(s => JSON.parse(localStorage.getItem('schwab.settings')).pin === s, stored), 'crew phone learned the office code from its sheet');
  await crew.click('#lockBtn');
  await crew.waitForSelector('dialog .keypad');
  check((await crew.textContent('dialog h3')) === 'Office sign-in', 'crew phone asks for the office code instead of offering a new one');
  await pad(crew, '1111');
  check(/Wrong passcode/.test(await crew.textContent('dialog .pin-msg')), 'a wrong code is refused');
  await crew.click('dialog .sheet-x');
  await crew.click('[data-act=clock][data-v=aStart]');
  await crew.click('.tick >> nth=0');
  await crew.click('[data-act=clock][data-v=aStop]');
  await crew.click('[data-act=set][data-v="Partial"]');
  await crew.fill('[data-k="t.doneText"]', 'Set boxes on grid 3 to 7.');
  await crew.screenshot({ path: OUT + '4-crew-dark.png', fullPage: true });
  await crew.click('[data-act=sendResults]');
  const resultLink = await takeLink(crew);

  log('4. Superintendent gets the results');
  await sup.goto(resultLink);
  await sup.waitForSelector('text=Lead / superintendent review');
  check(true, 'results open on the signed-in office phone');
  check((await sup.evaluate(() => JSON.parse(localStorage.getItem('schwab.tasks'))[0])).memberIds.length === 3, 'the sheet keeps an id for each of its people');

  log('4b. Two office phones numbered sheets offline');
  await sup.goto(BASE + 'tasks.html#day/2026-10-14');
  await sup.click('.bar [data-act=new]'); // T1014-02, not sent yet
  await sup.waitForSelector('[data-k="t.id"]');
  check(await sup.inputValue('[data-k="t.id"]') === 'T1014-02', 'a new sheet takes the next number');
  const other = (uid, id, sentAt) => ({ v: 1, kind: 'task', task: { uid, id, date: '2026-10-14', origin: 'mine', crew: 'Crew B', members: ['Ana P'], floor: 'Level 4', scope: 'Other office phone', sentAt } });
  const otherLink = async d => BASE + 'tasks.html#p=' + await sup.evaluate(async x => (await import('./shared.mjs')).pack(x), d);
  await sup.goto(await otherLink(other('otherphone2', 'T1014-02', Date.now())));
  await sup.waitForSelector('.brief');
  check(/Your sheet T1014-02 is now T1014-03: another sheet has that number\./.test(await sup.textContent('#toast')), 'a sheet arriving with the number of an unsent one here renumbers ours, and says so');
  await sup.goto(await otherLink(other('otherphone1', 'T1014-01', Date.now())));
  await sup.waitForSelector('.brief');
  check(await sup.locator('.pill >> text=Same number as another sheet').count() === 1, 'both sent with one number: the sheet says so');
  await sup.goto(BASE + 'tasks.html#day/2026-10-14');
  await sup.waitForSelector('.tcard');
  const ids = await sup.locator('.tcard .tid').allTextContents();
  check(ids.sort().join() === 'T1014-01,T1014-01,T1014-02,T1014-03' && await sup.locator('.tcard:has(.pill:text-is("Same number as another sheet"))').count() === 2, 'the board shows both T1014-01 cards with the warning: ' + ids.join());

  log('5. Workers clock in and out on their own phones');
  const at = t => new Date(`2026-10-${t}`); // Mon Oct 12 to Sun Oct 18, 2026
  const jose = await mk('jose');
  await jose.clock.install({ time: at('14T06:58:00') });
  await jose.goto(taskLink);
  await firstRun(jose, 'Crew member', 'Jose L', { pick: true });
  await jose.waitForSelector('[data-act=sendResults]');
  check(await jose.isVisible('[data-act=sendResults]'), "the worker's phone opens the task sheet that lists him");
  await jose.goto(BASE + 'tasks.html#clock/2026-10-14');
  await jose.waitForSelector('[data-k="s.worker"]');
  check(await jose.locator('dialog .keypad').count() === 0 && (await jose.textContent('[data-act=hTap]')).trim() === 'Clock in' && await jose.inputValue('[data-k="s.worker"]') === 'Jose L',
    'a new phone opens the time clock with no code, under the name picked on the first run');
  check((await jose.textContent('.bar')).trim() === '' && await jose.locator('.clock-hero [data-act=hTap]').count() === 1, 'the clock button is in the hero; the bar under it is empty');
  await jose.fill('[data-k="s.worker"]', ''); // the name box emptied: the clock still won't run nameless
  await jose.click('[data-act=hTap]:has-text("Clock in")');
  await jose.waitForTimeout(150);
  check(/Type your name first/.test(await jose.textContent('#toast')) && await jose.locator('dialog .linkbox').count() === 0, 'no name, no clock-in');
  const offered = await jose.locator('#knownNames option').evaluateAll(os => os.map(o => o.value).join(', '));
  check(offered === 'Jose L, Luis M, Tre W', 'the name box offers the names on the sheets on this phone: ' + offered);
  await jose.fill('[data-k="s.worker"]', 'Jose Q'); await jose.press('[data-k="s.worker"]', 'Tab');
  check(/isn't on a crew list yet/.test(await jose.textContent('#nameHint')) && /No task sheet on this phone has your name today/.test(await jose.textContent('#todayCard')), 'a name no list knows gets a gentle hint, and Today says nothing lists it');
  await jose.fill('[data-k="s.worker"]', 'jose  l');
  await jose.click('[data-act=hTap]:has-text("Clock in")');
  const joseIn = await takeLink(jose);
  const jp = await payload(jose, joseIn);
  check(jp.shifts[0].crew === 'Crew A' && jp.shifts[0].tasks.map(x => x.id).join() === 'T1014-01' && await jose.inputValue('[data-k="s.worker"]') === 'Jose L' && !(await jose.textContent('#nameHint')).trim(), 'the typed name takes the crew list spelling; the clock-in text carries the crew and the task');
  const todayText = (await jose.textContent('#todayCard')).replace(/\s+/g, ' ');
  check(/East corridor T1014-01/.test(todayText) && /Crew A · Level 3/.test(todayText), 'Today card: crew, task, floor and area: ' + todayText.trim());
  await jose.click('#todayCard .tcard');
  await jose.waitForSelector('.brief');
  check(/#task\//.test(jose.url()) && /Jose L \(you\), Luis M, Tre W/.test(await jose.textContent('.tsheet .kv.info')) && await jose.isVisible('[data-act=sendResults]'), "tapping it opens the crew view, which marks him 'you'");
  await jose.goto(BASE + 'tasks.html#clock/2026-10-14');
  await jose.waitForSelector('[data-k="s.worker"]');
  check(jp.kind === 'hours' && jp.shifts.length === 1 && jp.shifts[0].who === 'Jose L' && jp.shifts[0].in === '06:58' && !('pin' in jp), 'clock-in text: the shift, the name, no office code');
  const dev = await jose.evaluate(() => JSON.parse(localStorage.getItem('schwab.device')));
  check(/^[A-Za-z0-9]{32}$/.test(dev.secret) && jp.shifts[0].device === dev.id && !JSON.stringify(jp).includes(dev.secret), "the shift carries the phone's device id, never its secret");
  check(jp.shifts[0].tasks[0].uid === tp.task.uid, 'and links its sheet by uid');
  check(/Clocked in since 6:58 AM/.test(await jose.textContent('.clock-now')) && (await jose.textContent('[data-act=hTap]')).trim() === 'Clock out', 'shows clocked in; the button turns to Clock out');
  check(await jose.locator('input[type=time]').count() === 0, "a worker's phone has no time boxes to type in");
  await jose.clock.setSystemTime(at('14T15:31:00'));
  await jose.click('[data-act=hTap]:has-text("Clock out")');
  const joseOut = await takeLink(jose);
  check((await payload(jose, joseOut)).shifts[0].out === '15:31' && /8\.55 hrs/.test(await jose.textContent('.kv')) && /Week total: 8\.55 hrs/.test(await jose.textContent('main')), 'clock-out: 8.55 hrs for the day and the week');
  await jose.screenshot({ path: OUT + '5-worker.png', fullPage: true });

  const ana = await mk('ana');
  await ana.clock.install({ time: at('13T07:00:00') });
  await ana.goto(BASE + 'tasks.html#clock/2026-10-13');
  await ana.click(fr('lang', 'en')); await ana.click(fr('role', 'Crew member'));
  await ana.waitForSelector('#frName');
  check(await ana.locator(fr('pick')).count() === 0, 'a new phone with no sheets knows no names: she types hers');
  await ana.fill('#frName', 'Ana P'); await ana.press('#frName', 'Enter');
  await ana.waitForSelector('[data-k="s.worker"]');
  check(await ana.inputValue('[data-k="s.worker"]') === 'Ana P' && /#clock\/2026-10-13$/.test(ana.url()), 'the first run then opens the screen it was asked for, with her name on the clock');
  await ana.click('[data-act=hTap]:has-text("Clock in")');
  await takeLink(ana);
  await ana.clock.setSystemTime(at('14T07:05:00')); // forgot to clock out yesterday
  await ana.reload();
  await ana.waitForSelector('[data-k="s.worker"]');
  check((await ana.textContent('[data-act=hTap]')).trim() === 'Clock in' && /No clock-out on Tue, Oct 13/.test(await ana.textContent('main')), 'a missed clock-out: the next tap starts today; the PM is asked to fix it');
  await ana.click('[data-act=hTap]:has-text("Clock in")');
  const anaLink = await takeLink(ana);
  check((await payload(ana, anaLink)).shifts.length === 2, "today's text also carries the open shift from yesterday");
  await ana.click('#langBtn');
  check((await ana.textContent('[data-act=hTap]')).trim() === 'Marcar salida' && /Esta semana/.test(await ana.textContent('main')) && await tabNames(ana) === 'Hoy | Asistencia', 'worker screen in Spanish, its tabs too: ' + await tabNames(ana));
  await ana.setViewportSize({ width: 320, height: 640 });
  check(await noSideScroll(ana), 'worker screen fits at 320px');
  await ana.screenshot({ path: OUT + '5-worker-es-320.png', fullPage: true });

  log('6. Daily report tab');
  await sup.click(tab('report'));
  await sup.waitForSelector('#sec-sum');
  check(await sup.getAttribute(tab('report'), 'aria-current') === 'page' && (await sup.textContent('#title')).trim() === 'Daily report', 'the Report tab opens the Daily report and is marked current');
  check(await sup.locator('a[href^="#clock"]').count() === 1, 'the report no longer carries a time clock (only the tab links there)');
  await sup.click('[data-act=menu]');
  await sup.click('dialog >> text=Fill floors from task sheets');
  await sup.waitForSelector('.floor');
  await sup.click('[data-act=set][data-v="On plan"]');
  await sup.screenshot({ path: OUT + '6-report.png', fullPage: true });
  const repPdf = await pdfText(sup, async () => { await sup.click('[data-act=menu]'); await sup.click('dialog >> text=Save as PDF'); });
  check(/SUPERINTENDENT DAILY REPORT/.test(repPdf) && /H\.A\. Sack-Electrical · Sack Company-Electrical/.test(repPdf) && !/TIME CLOCK/.test(repPdf), 'report PDF: company names, no time clock');
  const taskPdf = await pdfText(sup, async () => { await sup.click(tab('day')); await sup.click('#titleMore [data-act=boardMenu]'); await sup.click("dialog >> text=Save this day's sheets as one PDF"); });
  check(/H\.A\. Sack-Electrical/.test(taskPdf) && /ELECTRICAL TASK SHEETS/.test(taskPdf), 'task sheet PDF carries the company names');
  await sup.click(tab('report'));
  await sup.waitForSelector('#sec-sum');
  // Clear this report: gone at once with Undo (it asked "are you sure?" before; DESIGN.md: Undo, not a question).
  const report14 = () => sup.evaluate(() => JSON.parse(localStorage.getItem('schwab.reports') || '{}')['2026-10-14'] || null);
  const before = await report14();
  await sup.click('[data-act=menu]'); await sup.click('dialog [data-act=clear]');
  await sup.waitForSelector('#toast .toast-undo');
  check(before?.status === 'On plan' && before.floors.length > 0 && !(await report14())?.floors?.length && await sup.locator('dialog .ask').count() === 0 && await sup.locator('.floor').count() === 0, 'Clear this report empties it at once, without a question');
  await sup.click('#toast .toast-undo');
  await sup.waitForSelector('.floor');
  check(JSON.stringify(await report14()) === JSON.stringify(before), 'Undo brings the whole report back');
  await sup.click('.bar [data-act=send]:has-text("Send to PM")');
  const reportLink = await takeLink(sup);
  check(new URL(reportLink).pathname.endsWith('/tasks.html'), 'report links open the one app');

  log('7. PM phone');
  const pm = await mk('pm');
  await pm.goto(reportLink);
  await firstRun(pm, 'Project manager', 'Pat PM');
  await pm.waitForSelector('dialog.pin .keypad');
  check((await pm.textContent('dialog.pin h3')) === 'Office sign-in', 'PM phone learned the code from the report link and asks for it');
  await pad(pm, '4821');
  await pm.waitForSelector('#sec-sum');
  check(/#report\/\d{4}-\d{2}-\d{2}$/.test(pm.url()), 'PM sees the report');
  // The PM picks the role on the first run now (DESIGN.md), so a phone not set to Project manager is the superintendent's.
  await sup.goto(joseOut);
  await sup.waitForTimeout(300);
  check(/logged on the PM's phone/.test(await sup.textContent('#toast')) && await sup.evaluate(() => !localStorage.getItem('schwab.crewHours')), 'hours links change nothing on a phone not set to Project manager');
  await pm.goto(BASE + 'tasks.html#settings');
  await pm.waitForSelector('[data-k="s.role"]');
  check(await pm.inputValue('[data-k="s.role"]') === 'Project manager' && await pm.inputValue('[data-k="s.me"]') === 'Pat PM', 'Settings show the role and the name from the first run');
  await pm.selectOption('[data-k="s.role"]', 'Superintendent');
  await pm.selectOption('[data-k="s.role"]', 'Project manager');
  check((await roster(pm)).role === 'Project manager', 'the role picker on its row still changes the role');
  await addPeople(pm, 0, 'Jose L, Luis M');
  await pm.click(tab('report'));
  await pm.waitForSelector('#sec-sum');
  await pm.click('.bar [data-act=send]:has-text("Send back to Supt.")');
  const backLink = await takeLink(pm);

  log('7b. PM logs and edits the crew hours');
  for (const l of [joseIn, joseOut, anaLink]) { await pm.goto(l); await pm.waitForSelector('.person'); }
  check(/#clock\/2026-10-1[34]$/.test(pm.url()) && (await pm.textContent('#title')) === 'Crew hours' && (await pm.locator(tab('clock')).textContent()).trim() === 'Hours', 'links open the Crew hours timesheet (the Hours tab)');
  check(/Mon, Oct 12/.test(await pm.textContent('.datebar')) && /to Sun, Oct 18/.test(await pm.textContent('#subtitle')) && await pm.locator('.person').count() === 2, 'one card per worker for the Monday to Sunday week');
  const card = n => pm.locator('.person', { hasText: n });
  check((await card('Jose L').locator('.total').textContent()) === '8.55 hrs' && (await card('Ana P').locator('.shift')).count !== undefined, 'Jose: 8.55 hrs');
  check(await card('Ana P').locator('.shift').count() === 2 && /No clock-out/.test(await card('Ana P').textContent()), "Ana's open shifts are flagged");
  const lost = n => card(n).locator('.pill', { hasText: 'Not on a crew list' }).count();
  check(/Crew A/.test(await card('Jose L').locator('.chips').textContent()) && await lost('Jose L') === 0 && /Task T1014-01/.test(await card('Jose L').locator('.shift').first().textContent()), "Jose's card shows his crew, and his shift its task");
  check(await lost('Ana P') === 1, 'a name on no crew list here is flagged');
  await card('Ana P').locator('[data-act=hCrew]').click();
  await pm.click('dialog [data-crew]:has-text("Crew B")');
  await pm.waitForSelector('dialog', { state: 'detached' });
  check(/Ana P added to Crew B/.test(await pm.textContent('#toast')) && /Crew B/.test(await card('Ana P').locator('.chips').textContent()) && await lost('Ana P') === 0
    && await pm.evaluate(() => JSON.parse(localStorage.getItem('schwab.settings')).crews[1].members) === 'Ana P', 'Add to a crew saves her on the crew list, and her card follows');
  const anaId = (await roster(pm)).people.find(p => p.name === 'Ana P')?.id;
  check(anaId && (await pm.evaluate(() => JSON.parse(localStorage.getItem('schwab.crewHours')))).filter(s => s.who === 'Ana P').every(s => s.pid === anaId), 'her shifts take her new id');
  await pm.goto(joseIn); await pm.waitForSelector('.person');
  check(/already logged/.test(await pm.textContent('#toast')) && (await card('Jose L').locator('.total').textContent()) === '8.55 hrs', 'an older text opened again keeps the clock-out');
  const anaTue = card('Ana P').locator('.shift').first();
  await anaTue.locator('input[data-k$=".out"]').fill('15:30');
  check(/8\.50 hrs · edited/.test(await anaTue.textContent()) && (await card('Ana P').locator('.total').textContent()) === '8.50 hrs' && /^2\s*People\s*17\.05\s*Hours\s*1\s*Open shifts/.test((await pm.textContent('#hoursStats')).trim().replace(/\s+/g, ' ').replace(/ /g, ' ')), 'PM fixes the missing out time; totals follow');
  await pm.goto(anaLink); await pm.waitForSelector('.person');
  check((await card('Ana P').locator('input[data-k$=".out"]').first().inputValue()) === '15:30', "the worker's next text doesn't undo the PM's fix");
  await pm.click('#titleMore [data-act=hPmMenu]'); await pm.click('dialog >> text=Add a shift');
  await pm.fill('dialog [name=who]', 'Ray K'); await pm.fill('dialog [name=date]', '2026-10-15'); await pm.fill('dialog [name=in]', '07:00'); await pm.fill('dialog [name=out]', '15:00');
  await pm.click('dialog [data-save]');
  await pm.waitForSelector('.person >> text=Ray K');
  check((await card('Ray K').locator('.total').textContent()) === '8.00 hrs', 'PM adds a shift by hand');
  await pm.screenshot({ path: OUT + '7-crew-hours.png', fullPage: true });
  // Remove a shift: gone at once with Undo (it asked "are you sure?" before; DESIGN.md: Undo, not a question).
  await card('Ray K').locator('[data-act=hDel]').click();
  await pm.waitForSelector('#toast .toast-undo');
  check(await card('Ray K').count() === 0 && await pm.locator('dialog .ask').count() === 0, 'PM removes a shift, at once');
  await pm.screenshot({ path: OUT + '7-undo.png' });
  await pm.click('#toast .toast-undo');
  await pm.waitForSelector('.person >> text=Ray K');
  check((await card('Ray K').locator('.total').textContent()) === '8.00 hrs', 'Undo brings the shift back');
  await card('Ray K').locator('[data-act=hDel]').click();
  await pm.waitForTimeout(150);
  check(await card('Ray K').count() === 0, 'removed again, it stays gone');
  await pm.click('.bar [data-act=hSend]:has-text("Send to accountant")');
  await pm.waitForSelector('dialog .ask');
  check(/1 shift has no clock-out/.test(await pm.textContent('dialog .ask')), 'warns about a shift with no clock-out');
  const files = [];
  pm.on('download', d => files.push(d));
  await pm.click('dialog [data-a="1"]');
  await pm.waitForTimeout(800);
  const csvDl = files.find(d => d.suggestedFilename().endsWith('.csv')), pdfDl = files.find(d => d.suggestedFilename().endsWith('.pdf'));
  check(csvDl && pdfDl && csvDl.suggestedFilename() === 'Timesheet week of 2026-10-12.csv', 'Send to accountant: a spreadsheet and a PDF');
  if (csvDl && pdfDl) {
    await csvDl.saveAs(OUT + 'timesheet.csv'); await pdfDl.saveAs(OUT + 'timesheet.pdf');
    const csv = fs.readFileSync(OUT + 'timesheet.csv', 'utf8');
    check(csv.startsWith('\ufeffName,Crew,Date,Day,Clock in,Clock out,Hours,Tasks,Note\r\n') && csv.includes('Jose L,Crew A,2026-10-14,Wed,6:58 AM,3:31 PM,8.55,T1014-01,') && csv.includes('Ana P,Crew B,2026-10-13,Tue,7:00 AM,3:30 PM,8.50,,Edited by PM') && csv.includes('All crew,,,,,Week total,17.05,,'), 'CSV rows and totals, with crew and tasks');
    const pdf = execFileSync('pdftotext', ['-enc', 'UTF-8', '-layout', OUT + 'timesheet.pdf', '-']).toString();
    check(/WEEKLY TIMESHEET/.test(pdf) && /H\.A\. Sack-Electrical · Sack Company-Electrical/.test(pdf) && /JOSE L · CREW A · 8\.55 HRS/.test(pdf) && /task T1014-01/.test(pdf) && /Pat PM/.test(pdf), 'PDF timesheet: company names, people with crews, tasks, totals, approved by');
  }
  await card('Ana P').locator('[data-act=hRename]').click();
  await pm.fill('dialog [name=who]', ' , ');
  await pm.click('dialog [data-save]');
  await pm.waitForTimeout(150);
  check(/Type the name/.test(await pm.textContent('#toast')) && await pm.locator('dialog [name=who]').count() === 1, 'renaming someone to punctuation alone is refused');
  await pm.fill('dialog [name=who]', 'Ana P');
  await pm.fill('dialog [name=who]', 'Ana Perez');
  await pm.click('dialog [data-save]');
  await pm.waitForSelector('.person h2 >> text=Ana Perez');
  await pm.goto(anaLink); await pm.waitForSelector('.person');
  check(await card('Ana Perez').count() === 1 && await pm.locator('.person').count() === 2 && (await card('Ana Perez').locator('.total').textContent()) === '8.50 hrs', "the PM's rename covers every shift and survives the worker's next text");
  check(/Crew B/.test(await card('Ana Perez').locator('.chips').textContent()) && await lost('Ana Perez') === 0
    && await pm.evaluate(() => JSON.parse(localStorage.getItem('schwab.settings')).crews[1].members) === 'Ana Perez', 'the rename carries to her crew list entry, so she keeps her crew');
  check((await roster(pm)).people.find(p => p.id === anaId)?.name === 'Ana Perez', 'renamed in place: the same person id');
  await pm.click('.datebar [aria-label="Previous week"]');
  await pm.waitForSelector('.empty');
  check(/No hours logged this week/.test(await pm.textContent('.empty')), 'the week before is empty');
  await pm.click('.datebar [aria-label="Next week"]');
  await pm.waitForSelector('.person');
  await sup.goto(backLink);
  await sup.waitForSelector('#sec-sum');
  check(true, "the PM's reply reaches the superintendent");

  log('8. Lock the superintendent phone');
  await sup.click(tab('clock'));
  await sup.waitForSelector('[data-k="s.worker"]');
  await sup.click('#lockBtn');
  await sup.waitForTimeout(150);
  check(/#clock\//.test(sup.url()) && await sup.locator('[data-k="s.worker"]').count() === 1, "locking on the superintendent's own time clock keeps it up");
  await sup.click(tab('day'));
  await sup.waitForSelector('.datebar');
  const lockedIds = await sup.locator('.tcard .tid').allTextContents(); // on Oct 14 only the two sheets other phones sent here
  check(lockedIds.sort().join() === 'T1014-01,T1014-02' && await sup.locator('[data-act=new]').count() === 0, 'locked: office-made sheets and New task hidden: ' + lockedIds.join());
  await sup.click(tab('day'));
  await sup.goto(BASE + 'tasks.html#report/' + await sup.evaluate(() => new Date().toISOString().slice(0, 10)));
  await sup.waitForTimeout(500);
  await sup.waitForSelector('dialog .keypad');
  check((await sup.textContent('dialog h3')) === 'Office sign-in', 'a locked office screen asks for the code');
  await sup.click('dialog .sheet-x');
  await sup.waitForTimeout(200);
  check(/#day\//.test(sup.url()) && await sup.isHidden('#sec-sum'), 'closing the pad stays on the crew board');
  for (let i = 0; i < 5; i++) { await sup.click('#lockBtn'); await sup.waitForSelector('dialog .keypad'); await pad(sup, '0000'); await sup.click('dialog .sheet-x'); await sup.waitForTimeout(80); }
  await sup.click('#lockBtn'); await sup.waitForSelector('dialog .keypad'); await pad(sup, '4821');
  check(/Too many wrong codes/.test(await sup.textContent('dialog .pin-msg')), 'five wrong codes: even the right one waits a minute');
  await sup.click('dialog .sheet-x');

  log('9. Narrow phone (320px) and Spanish');
  for (const [p, name] of [[pm, 'pm-office'], [crew, 'crew']]) {
    await p.setViewportSize({ width: 320, height: 640 });
    await p.waitForTimeout(100);
    const fit = await p.evaluate(() => { const h = document.querySelector('.brand h1'), s = document.querySelector('.brand p'); return [h.scrollWidth <= h.clientWidth, s.scrollWidth <= s.clientWidth]; });
    check(await noSideScroll(p) && fit.every(Boolean), `${name}: no side scroll and both company names fit at 320px`);
    await p.screenshot({ path: OUT + `9-${name}-320.png` });
  }
  await crew.click('#langBtn');
  await crew.waitForSelector('.seg >> text=Bloqueado');
  check(await noSideScroll(crew), 'Spanish crew sheet, Status buttons included, fits at 320px');
  await crew.screenshot({ path: OUT + '9-crew-es-320.png', fullPage: true });
  await pm.click('#langBtn');
  const esTabs = await tabNames(pm);
  check(esTabs === 'Tareas | Horas | Reporte' && (await pm.textContent('#title')) === 'Horas', 'office tabs in Spanish, and the screen title (as the tab says): ' + esTabs);
  await pm.click('#lockBtn');
  await pm.click('#officeTabs a[href^="#clock"]');
  await pm.waitForSelector('dialog .keypad');
  check(await pm.locator('.person').count() === 0, "signed out, the PM's crew hours ask for the code");
  check(await pm.locator('#officeTabs a[href^="#clock"] svg.lock').count() === 1, "signed out, the PM's crew hours tab shows the lock");
  await pm.click('dialog .sheet-x');
  check(await noSideScroll(pm), 'Spanish office tabs fit at 320px');
  await pm.goto(BASE + 'tasks.html#clock/2026-10-14'); await pm.waitForSelector('dialog .keypad'); await pad(pm, '4821'); await pm.waitForSelector('.person'); check(await noSideScroll(pm), 'Spanish crew hours fit at 320px'); check(await pm.$$eval('[data-act=hRename]', bs => bs.every(b => { const r = document.createRange(); r.selectNodeContents(b); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size === 1; })), 'the Rename button never splits mid-word at 320px'); await pm.screenshot({ path: OUT + '9-pm-es-clock-320.png', fullPage: true });

  log('ERRORS:', errors.length ? errors : 'none');
  log(fails.length ? `FAILED: ${fails.length}` : 'ALL CHECKS PASSED');
  await browser.close();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); process.exit(2); });
