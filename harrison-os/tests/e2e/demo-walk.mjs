// Preview walkthrough check: builds nothing, serves ../docs/ at /ponytail/ (as GitHub Pages does) and taps
// through the four-step owner path in headless Chrome at 390x844 against the real app + Worker code
// running in the page. Run after `node scripts/build-demo.mjs`:  npm run demo:check
// Screenshots go to $DEMO_SHOTS (default .wrangler/demo-shots). Chrome/headless evidence, not iPhone evidence.
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DOCS = path.resolve(ROOT, '..', 'docs');
const require = createRequire(process.env.PLAYWRIGHT_PKG || path.join(ROOT, 'package.json'));
const { chromium } = require('playwright');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.sql': 'text/plain', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (!u.pathname.startsWith('/ponytail/')) return res.writeHead(404).end();
  let p = path.join(DOCS, decodeURIComponent(u.pathname.slice('/ponytail/'.length)));
  if (!p.startsWith(DOCS)) return res.writeHead(403).end();
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/ponytail/harrison-os-demo/`;
const shots = process.env.DEMO_SHOTS || path.join(ROOT, '.wrangler', 'demo-shots');
fs.mkdirSync(shots, { recursive: true });
let failures = 0;

  const launch = process.env.E2E_CHROME_PATH ? { executablePath: process.env.E2E_CHROME_PATH } : { channel: 'chrome' };
  const browser = await chromium.launch({ ...launch, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'America/New_York', isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('dialog', (d) => d.accept());
  const log = (...a) => console.log(...a);
  const shot = async (n) => page.screenshot({ path: `${shots}/${n}.png` });
  const step = async (name, fn) => { try { await fn(); log('OK  ', name); } catch (e) { failures++; log('FAIL', name, '::', e.message.split('\n')[0]); await shot('fail-' + name.replace(/\W+/g, '_')); } };

  await page.goto(URL_, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor();
  await page.getByText('Maple Street clinic fit-out').first().waitFor({ timeout: 15000 });
  await shot('01-today');

  // 1. Capture
  await step('1 capture opens', async () => { await page.getByRole('link', { name: 'Capture' }).click(); await page.locator('#capture-text').waitFor({ state: 'visible' }); });
  await step('1 type and save', async () => {
    await page.locator('#capture-text').fill('Call Rivera Supply about the 3/4 inch EMT delivery tomorrow');
    await page.locator('label.seg-work').click();
    await shot('02-capture');
    await page.locator('#capture-save').click();
    await page.getByText(/Synced|Saved/).first().waitFor({ timeout: 10000 });
    await shot('03-capture-saved');
  });
  await step('1 close sheet', async () => { await page.locator('#capture-close').click(); });
  await step('1 review opens from Today', async () => {
    await page.getByRole('link', { name: /to review/ }).click();
    await page.getByRole('heading', { name: 'Review', level: 1 }).waitFor();
    await page.locator('#screen-review .row-link').first().click();
    await page.getByRole('button', { name: 'Looks right' }).first().waitFor();
    await shot('04-review');
  });
  await step('1 file it', async () => {
    for (const b of await page.locator('#screen-review').getByRole('button', { name: 'Looks right' }).all()) {
      if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
    }
    await page.getByRole('button', { name: 'File these' }).click();
    await page.waitForTimeout(1200);
    await shot('05-filed');
  });

  // 2. Today: mark one done, defer another
  await step('2 back to Today', async () => { await page.getByRole('link', { name: 'Today' }).first().click(); await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor(); await page.waitForTimeout(800); await shot('06-today-after-capture'); });
  await step('2 check off the Next task', async () => {
    const box = page.locator('#screen-today input[type=checkbox]').first();
    await box.check();
    await page.locator('#toast-text').filter({ hasText: /./ }).waitFor({ timeout: 5000 });
    log('     toast:', await page.locator('#toast-text').innerText());
    await shot('07-checked-off');
  });
  await step('2 open tasks and defer one', async () => {
    await page.getByRole('link', { name: /All open tasks/ }).click();
    await page.getByRole('heading', { name: 'Open tasks', level: 1 }).waitFor();
    await page.getByRole('button', { name: /Edit: Order 14 sheets/ }).click();
    await page.getByRole('button', { name: /^Tomorrow/ }).click();
    await page.locator('#toast-text').filter({ hasText: /Not before/ }).waitFor({ timeout: 5000 });
    log('     toast:', await page.locator('#toast-text').innerText());
    await shot('08-deferred');
  });

  // 3. Waiting-on tied to the project
  await step('3 capture a waiting-on', async () => {
    await page.getByRole('link', { name: 'Capture' }).click();
    await page.locator('#capture-text').fill('Waiting on Jordan Example for the corrected fixture count, he said by Tuesday');
    await page.locator('label.seg-work').click();
    await page.locator('#capture-save').click();
    await page.getByText(/Synced|Saved/).first().waitFor({ timeout: 10000 });
    await page.locator('#capture-close').click();
  });
  await step('3 review, attach to project, file', async () => {
    await page.goto(URL_ + '#/review');
    await page.locator('#screen-review .row-link').first().click();
    await page.locator('#screen-review').getByRole('button', { name: 'Edit' }).first().waitFor();
    await shot('09-review-waiting');
    log('     proposals:', (await page.locator('.proposal').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').slice(0, 140)));
    await page.locator('#screen-review').getByRole('button', { name: 'Edit' }).first().click();
    const sel = page.locator('#screen-review').getByLabel('Project').first();
    await sel.selectOption({ label: 'Maple Street clinic fit-out' });
    await shot('10-review-edit');
    // Fill the date the sentence mentioned as the promise, as Harrison would after reading the card.
    const promised = page.locator('#screen-review').getByLabel('Promised by').first();
    if (await promised.count()) await promised.fill('2026-11-03');
    await page.locator('#screen-review').getByRole('button', { name: 'Use these' }).click();
    for (const b of await page.locator('#screen-review').getByRole('button', { name: 'Looks right' }).all()) {
      if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
    }
    await page.getByRole('button', { name: 'File these' }).click();
    await page.waitForTimeout(1200);
  });
  await step('3 project shows waiting', async () => {
    await page.goto(URL_ + '#/projects');
    await page.locator('#screen-projects').getByRole('link', { name: /Maple Street clinic fit-out/ }).first().click();
    await page.locator('#screen-project').getByText(/Jordan Example/).first().waitFor({ timeout: 8000 });
    await shot('11-project-waiting');
  });

  // 4. Save my place, go away a week, come back
  await step('4 save my place', async () => {
    await page.getByRole('button', { name: 'Save my place' }).first().click();
    await page.waitForTimeout(1000);
    await shot('12-saved-place');
  });
  await step('4 reload keeps everything', async () => {
    await page.reload();
    await page.locator('#screen-project').getByText(/Jordan Example/).first().waitFor({ timeout: 15000 });
    await page.goto(URL_ + '#/waiting');
    await page.locator('#screen-waiting').getByText(/corrected fixture count/).first().waitFor({ timeout: 15000 });
    await page.goto(URL_ + '#/tasks');
    await page.locator('#screen-tasks').getByText(/3\/4 inch EMT|Rivera Supply/).first().waitFor({ timeout: 15000 });
    await page.goto(URL_ + '#/today');
  });
  await step('4 simulate a week away', async () => {
    await page.getByRole('button', { name: 'Skip ahead a week' }).click();
    await page.waitForLoadState('load');
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor();
    await page.waitForTimeout(1500);
    await shot('13-welcome-back');
    log('     today:', (await page.locator('#screen-today').innerText()).replace(/\s+/g, ' ').slice(0, 700));
  });
  await step('4 resume the project', async () => {
    await page.locator('#screen-today').getByRole('link', { name: /Maple Street clinic fit-out/ }).first().click();
    await page.locator('#screen-project .place-card').waitFor();
    await shot('14-resume');
    log('     place:', (await page.locator('#screen-project .place-card').innerText()).replace(/\s+/g, ' ').slice(0, 500));
  });
  await step('extra: Ask (Not AI)', async () => {
    await page.locator('#ask-open').click();
    await page.locator('#ask-question').fill('What is open on Maple Street?');
    await page.locator('#ask-submit').click();
    await page.locator('#ask-result').getByText(/Not AI/).first().waitFor({ timeout: 8000 });
    await shot('15-ask');
  });
  log('console errors:', errors.length ? JSON.stringify(errors) : 'none');
  await browser.close();
  server.close();
  if (errors.length) failures++;
  log(failures ? `${failures} step(s) failed` : 'all preview steps passed');
  process.exit(failures ? 1 : 0);
