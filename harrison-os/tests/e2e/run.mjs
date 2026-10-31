// Local end-to-end flows for Harrison OS Slice 1. Sample data only.
//
//   node tests/e2e/run.mjs            (E2E_ONLY=F1,F3 runs a subset while debugging)
//
// 1. Stops leftover harrison-os servers on 8899, deletes .wrangler/e2e-state, applies migrations there.
// 2. Starts `wrangler dev --local` on 127.0.0.1:8899 with --test-scheduled (uses .dev.vars from gen-vapid).
// 3. Drives system Chrome (headless, 390x844) through Playwright from the existing install, runs F1..F10.
// 4. Always tears everything down (PID tree), prints a PASS/FAIL table, exits non-zero on any failure.
//
// These are local Chrome results. They are not iPhone evidence.
// The runner prints ids, states, counts, UI labels and status codes only. It never prints the text of a
// capture, item or project (the sample texts carry a run marker and are checked against server output).

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { freePort, waitPortFree, listeningPids, killTree, spawnLogged, runNodeSync } from './procs.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const HOST = '127.0.0.1';
const APP_PORT = 8899;
const BASE = `http://${HOST}:${APP_PORT}`;
const STATE_DIR = '.wrangler/e2e-state';
const DEV_LOG = path.join(ROOT, '.wrangler', 'e2e-dev.log');
const WRANGLER = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const PLAYWRIGHT_PKG = process.env.PLAYWRIGHT_PKG || path.join(ROOT, 'package.json');
const HARD_TIMEOUT_MS = 12 * 60 * 1000;
const TZ = 'America/New_York';
const VIEWPORT = { width: 390, height: 844 };
// Another site on loopback (host name localhost, port 8897; the app is 127.0.0.1:8899), served by a tiny
// local server during F9. A public origin, or a page made up by a Playwright route, is stopped by Chrome's
// local network access rules before the Worker sees the request, which would test Chrome, not the Worker.
const CROSS_PORT = 8897;
const CROSS_ORIGIN = `http://localhost:${CROSS_PORT}`;

// The preview sample (CONTRACT.md, tests/interpret.test.mjs). Fixed sample text, never printed.
const PREVIEW_SAMPLE =
  'Waiting on the alternate light quote from [Supplier]. Remind me Friday morning to follow up. ' +
  'Jeff asked for two more electricians Friday, need to check with the office.';

const RUN = Date.now().toString(36);
const markers = [PREVIEW_SAMPLE]; // every text this run sends, for the hygiene check
function tok(label) {
  return `${label}${RUN}${Math.random().toString(36).slice(2, 6)}`;
}
function remember(text) {
  markers.push(text);
  return text;
}

const childEnv = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1', FORCE_COLOR: '0' };

// ---------------------------------------------------------------- generic helpers

function say(line) {
  process.stdout.write(`${line}\n`);
}

function check(cond, message) {
  if (!cond) throw new Error(message);
}

async function waitFor(fn, { timeout = 15000, interval = 200, what = 'condition' } = {}) {
  const until = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = `error: ${err && err.message}`;
    }
    if (Date.now() > until) throw new Error(`timed out after ${timeout} ms waiting for ${what}`);
    await sleep(interval);
  }
}

async function api(method, p, body, { xhr = true, contentType } = {}) {
  const headers = {};
  if (xhr) headers['X-Requested-With'] = 'XMLHttpRequest';
  if (body !== undefined) headers['Content-Type'] = contentType || 'application/json';
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data, text, headers: res.headers };
}

async function apiOk(method, p, body) {
  const r = await api(method, p, body);
  check(r.status >= 200 && r.status < 300, `${method} ${p.split('?')[0]} -> ${r.status} ${r.data && r.data.error ? r.data.error.code : ''}`);
  return r.data;
}

function todayOnIn(timeZone, ms = Date.now()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

async function exportAll() {
  const r = await api('GET', '/api/export?scope=all');
  check(r.status === 200, `export -> ${r.status}`);
  return r.data.tables;
}

async function inboxCaptureByText(text) {
  const d = await apiOk('GET', '/api/inbox?scope=all');
  return d.captures.find((c) => c.text === text) || null;
}

async function itemsOf(scope, kind) {
  const d = await apiOk('GET', `/api/items?scope=${scope}${kind ? `&kind=${kind}` : ''}&limit=500`);
  return d.items;
}

function wranglerD1(command, { json = false } = {}) {
  const args = [WRANGLER, 'd1', 'execute', 'DB', '--local', '--persist-to', STATE_DIR, '--command', command];
  if (json) args.push('--json');
  const r = runNodeSync(args, { cwd: ROOT, env: childEnv, timeoutMs: 90000 });
  check(r.ok, `wrangler d1 execute failed: ${String(r.output).slice(-300)}`);
  if (!json) return r.output;
  const start = r.output.indexOf('[');
  return JSON.parse(r.output.slice(start));
}

// ---------------------------------------------------------------- browser helpers

let browser = null;
const pageRecords = [];

async function openApp(name, { offlineExpected = false } = {}) {
  const context = await browser.newContext({
    baseURL: BASE,
    serviceWorkers: 'allow',
    viewport: VIEWPORT,
    timezoneId: TZ,
    locale: 'en-US',
  });
  const rec = { name, offlineExpected, consoleErrors: [], pageErrors: [], cspConsole: [] };
  await context.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text().slice(0, 200);
    rec.consoleErrors.push(t);
    if (/Content Security Policy/i.test(t)) rec.cspConsole.push(t);
  });
  page.on('pageerror', (e) => rec.pageErrors.push(String(e && e.message).slice(0, 200)));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  pageRecords.push(rec);
  return { context, page, rec };
}

async function waitAppReady(page) {
  // init() renders the outbox summary once the local stores are open.
  await page.waitForFunction(
    () => {
      const s = document.getElementById('outbox-summary');
      return !!s && s.textContent !== 'Nothing waiting.';
    },
    null,
    { timeout: 20000 },
  );
}

async function start(page, hash = '#/today') {
  await page.goto(`/${hash}`);
  await waitAppReady(page);
}

async function waitControlled(page) {
  await page.waitForFunction(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller), null, { timeout: 20000 });
  return page.evaluate(async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('hos-') && (await (await caches.open(k)).match('/'))) return k;
    }
    return false;
  });
}

const ROUTE_LOAD = {
  today: { api: '/api/today', body: 'today-body' },
  review: { api: '/api/inbox', body: 'review-body' },
  waiting: { api: '/api/items', body: 'waiting-body' },
  tasks: { api: '/api/items', body: 'tasks-body' },
  projects: { api: '/api/projects', body: 'projects-body' },
  project: { api: '/api/projects/', body: 'project-body' },
};

// Shows a route and waits for its data request and render. The same route again reloads the page,
// because the app keeps a screen as it is when its route did not change.
async function gotoRoute(page, hash) {
  const name = hash.replace(/^#\//, '').split('/')[0];
  const spec = ROUTE_LOAD[name];
  const current = await page.evaluate(() => location.hash);
  const waitResp = spec ? page.waitForResponse((r) => new URL(r.url()).pathname.startsWith(spec.api), { timeout: 15000 }) : null;
  if (current === hash) {
    await page.reload({ waitUntil: 'load' });
    await waitAppReady(page);
  } else {
    await page.evaluate((h) => {
      location.hash = h;
    }, hash);
  }
  if (waitResp) await waitResp;
  if (spec) {
    await page.waitForFunction((id) => document.getElementById(id).getAttribute('aria-busy') === 'false', spec.body, { timeout: 15000 });
  }
  await sleep(150);
}

async function openCaptureSheet(page) {
  await page.click('a.tab-capture');
  await page.waitForSelector('#capture-sheet[open]', { timeout: 10000 });
}

async function closeCaptureSheet(page) {
  await page.click('#capture-close');
  await page.waitForFunction(() => !document.getElementById('capture-sheet').open, null, { timeout: 10000 });
}

async function typeCapture(page, text, scope) {
  await openCaptureSheet(page);
  await page.locator(`#capture-sheet input[name="cscope"][value="${scope}"]`).check();
  await page.fill('#capture-text', text);
  await page.click('#capture-save');
}

// The outbox list shows an excerpt (app.js excerpt(text, 140)).
function excerpt(text, max = 140) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

async function outboxStates(page, text) {
  return page.evaluate(
    (t) =>
      [...document.querySelectorAll('#outbox-list li.outbox-row')]
        .filter((li) => ((li.querySelector('.row-title') || {}).textContent || '') === t)
        .map((li) => (li.querySelector('.chip') || {}).textContent || ''),
    excerpt(text),
  );
}

async function waitOutboxState(page, text, prefix, timeout = 15000) {
  try {
    return await waitFor(
      async () => {
        const s = await outboxStates(page, text);
        return s.length === 1 && s[0].startsWith(prefix) ? s[0] : false;
      },
      { timeout, what: `outbox state "${prefix}"` },
    );
  } catch (err) {
    const s = await outboxStates(page, text).catch(() => []);
    throw new Error(`${err.message}; outbox states now: ${JSON.stringify(s)}`);
  }
}

// Capture through the sheet, wait until it is Synced, close the sheet, return the server capture.
async function captureSynced(page, text, scope) {
  await typeCapture(page, text, scope);
  await waitOutboxState(page, text, 'Synced');
  await closeCaptureSheet(page);
  const c = await waitFor(() => inboxCaptureByText(text), { what: 'capture in the server inbox' });
  return c;
}

async function reviewCards(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#review-body article.proposal')].map((card) => {
      const rows = {};
      for (const div of card.querySelectorAll('dl.rows > div')) {
        rows[(div.querySelector('dt') || {}).textContent || ''] = (div.querySelector('dd') || {}).textContent || '';
      }
      const status = card.querySelector('.chip-status');
      return {
        kind: (card.querySelector('.chip-kind') || {}).textContent || '',
        status: status ? status.textContent.replace(/^Status: /, '') : null,
        rows,
        notes: [...card.querySelectorAll('.note-warn')].map((n) => n.textContent),
        hasQuote: !!card.querySelector('.source'),
      };
    }),
  );
}

async function openReview(page, captureId, expectedCards) {
  await gotoRoute(page, `#/review/${captureId}`);
  await page.waitForFunction(
    (n) => document.querySelectorAll('#review-body article.proposal').length === n,
    expectedCards,
    { timeout: 15000 },
  );
}

function card(page, index) {
  return page.locator('#review-body article.proposal').nth(index);
}

async function fileReview(page, captureId) {
  const btn = page.locator('#review-body').getByRole('button', { name: 'File these' });
  await btn.click();
  await page.waitForFunction((id) => location.hash !== `#/review/${id}`, captureId, { timeout: 15000 });
}

async function lookRightAll(page, captureId, n) {
  for (let i = 0; i < n; i++) await card(page, i).getByRole('button', { name: 'Looks right' }).click();
  await fileReview(page, captureId);
}

async function setScopeSwitch(page, scope) {
  const pressed = await page.getAttribute(`.scope-btn[data-scope="${scope}"]`, 'aria-pressed');
  if (pressed !== 'true') await page.click(`.scope-btn[data-scope="${scope}"]`);
}

async function searchUi(page, q) {
  await page.fill('#search-q', q);
  await page.press('#search-q', 'Enter');
  await page.waitForFunction(
    () => /^\d+ match/.test(document.getElementById('search-summary').textContent) && document.getElementById('search-results').getAttribute('aria-busy') !== 'true',
    null,
    { timeout: 15000 },
  );
  await sleep(500); // the input debounce may run the same query once more
  await page.waitForFunction(() => document.getElementById('search-results').getAttribute('aria-busy') !== 'true', null, { timeout: 15000 });
  return page.evaluate(() => {
    const rowOf = (li) => ({
      title: (li.querySelector('.row-title') || {}).textContent || '',
      chips: [...li.querySelectorAll('.chip')].map((c) => c.textContent),
      superseded: li.classList.contains('is-superseded'),
    });
    const groups = [...document.querySelectorAll('#search-results section.search-group')].map((s) => ({
      heading: (s.querySelector('h2') || {}).textContent || '',
      scope: s.classList.contains('search-group-work') ? 'work' : s.classList.contains('search-group-personal') ? 'personal' : '?',
      rows: [...s.querySelectorAll('li')].map(rowOf),
    }));
    return {
      summaryCount: Number((/^(\d+)/.exec(document.getElementById('search-summary').textContent) || [])[1]),
      groups,
      rows: [...document.querySelectorAll('#search-results li')].map(rowOf),
    };
  });
}

async function todayView(page) {
  return page.evaluate(() => {
    const next = document.querySelector('#today-body .next-card');
    const sec = (id) => {
      const h = document.getElementById(id);
      return h ? h.closest('section') : null;
    };
    const list = sec('today-list-h');
    const resume = sec('today-resume-h');
    return {
      nextTitle: next ? ((next.querySelector('.check-title') || next.querySelector('.next-title') || {}).textContent || null) : null,
      nextWhy: next ? ((next.querySelector('.why') || {}).textContent || null) : null,
      list: list
        ? [...list.querySelectorAll('li.check-row')].map((li) => ({
            title: (li.querySelector('.check-title') || {}).textContent || '',
            meta: (li.querySelector('.check-meta') || {}).textContent || '',
            checked: !!(li.querySelector('input.check') || {}).checked,
            done: li.classList.contains('is-done'),
          }))
        : [],
      links: [...document.querySelectorAll('#today-body a.link-card')].map((a) => ({
        href: a.getAttribute('href'),
        eyebrow: (a.querySelector('.eyebrow') || {}).textContent || '',
        title: (a.querySelector('.link-card-title') || {}).textContent || '',
      })),
      resume: resume ? [...resume.querySelectorAll('.row-title')].map((n) => n.textContent) : [],
      returnCard: !!document.querySelector('#today-body .return-card'),
      nextHasCheckbox: next ? !!next.querySelector('input.check') : false,
      nextLinks: next ? [...next.querySelectorAll('a')].map((a) => `${a.textContent}|${a.getAttribute('href')}`) : [],
      bodyText: document.getElementById('today-body').textContent,
    };
  });
}

// ---------------------------------------------------------------- scenarios

const shared = {}; // values later scenarios need (ids only)

const scenarios = [
  {
    id: 'F1',
    name: 'preview sample -> Review: 3 pieces with honest statuses -> Looks right x3 -> Today; nothing upgraded',
    async run() {
      const { context, page } = await openApp('F1');
      try {
        await start(page);
        const cap = await captureSynced(page, PREVIEW_SAMPLE, 'work');
        check(cap.proposals.length === 3, `server proposals ${cap.proposals.length}, want 3`);
        await openReview(page, cap.id, 3);
        const original = await page.textContent('#review-body blockquote.original-text');
        check(original === PREVIEW_SAMPLE, 'Review does not show the original words exactly');
        const cards = await reviewCards(page);
        const [w, r, t] = cards;
        check(w.kind === 'Waiting on', `card 1 kind "${w.kind}"`);
        check(w.status === 'Unspecified', `waiting status chip "${w.status}", want Unspecified`);
        check(w.rows['Promised by'] === 'not stated', `waiting Promised by "${w.rows['Promised by']}"`);
        check(w.rows.Reply === 'No reply recorded', 'waiting Reply row is not "No reply recorded"');
        check(r.kind === 'Reminder', `card 2 kind "${r.kind}"`);
        check(r.notes.some((n) => /Check the time/.test(n)), `reminder notes ${JSON.stringify(r.notes)} lack a time check`);
        check(t.kind === 'Task', `card 3 kind "${t.kind}"`);
        check(t.status === 'Requested', `task status chip "${t.status}", want Requested`);
        check(t.rows['Asked by'] === 'Jeff', 'task "Asked by" is not the name from the sentence');
        // The mentioned Friday is labelled as not a due date, with an explicit way to use it.
        check(!!t.rows['Date mentioned (not a due date)'] && !('When' in t.rows), `task date row ${JSON.stringify(Object.keys(t.rows))}`);
        check((await card(page, 2).getByRole('button', { name: 'Use as due date' }).count()) === 1, 'task card has no "Use as due date"');
        check(cards.every((c) => c.hasQuote), 'a card lacks its source quote');
        check(!cards.some((c) => c.status === 'Confirmed'), 'a card shows Confirmed');

        await lookRightAll(page, cap.id, 3);

        const waits = (await itemsOf('work', 'waiting')).filter((i) => i.source_capture_id === cap.id);
        const tasks = (await itemsOf('work', 'task')).filter((i) => i.source_capture_id === cap.id);
        const rems = (await apiOk('GET', '/api/reminders?scope=work')).items;
        check(waits.length === 1 && tasks.length === 1, `filed waiting ${waits.length}, tasks ${tasks.length}`);
        const wi = waits[0];
        const ti = tasks[0];
        check(wi.claim_status === 'unspecified', `waiting claim_status ${wi.claim_status}`);
        check(wi.promised_on === null && wi.follow_up_on === null, 'waiting got a promised/follow-up date nobody stated');
        check(ti.claim_status === 'requested' && ti.claim_by === 'Jeff', `task claim_status ${ti.claim_status}, claim_by from sentence: ${ti.claim_by === 'Jeff'}`);
        check(ti.due_on === null, 'task got a due date (the mentioned Friday is for review only)');
        check(rems.length === 1 && rems[0].local_time === '08:00', `reminders ${rems.length}`);
        shared.waitingId = wi.id;
        shared.waitingTitle = wi.title;

        // Today before the follow-up is due: the waiting item is counted, never shown as Harrison's work.
        await gotoRoute(page, '#/today');
        const before = await todayView(page);
        const wLink = before.links.find((l) => l.href === '#/waiting');
        check(before.nextTitle !== wi.title, 'waiting item shown as Next before its follow-up is due');
        check(!before.list.some((x) => x.title === wi.title), 'waiting item listed under Today before due');
        check(wLink && /Waiting on others: 1/.test(wLink.title) && wLink.eyebrow === 'Waiting', `waiting link "${wLink && wLink.title}" / "${wLink && wLink.eyebrow}"`);
        const taskOnToday = before.list.some((x) => x.title === ti.title) || before.nextTitle === ti.title;

        // Set the follow-up to today on the Waiting screen; now it is due and surfaces as Next.
        const todayOn = todayOnIn(TZ);
        await gotoRoute(page, '#/waiting');
        const wcard = page.locator('#waiting-body article.waiting-card', { has: page.locator('h2.card-title', { hasText: wi.title }) });
        check((await wcard.count()) === 1, 'waiting card not found');
        check((await wcard.locator('dd').allTextContents()).includes('No reply recorded'), 'waiting card lacks "No reply recorded"');
        await wcard.locator('summary', { hasText: 'Follow up later' }).click();
        await wcard.locator('input[type="date"]').fill(todayOn);
        await wcard.getByRole('button', { name: 'Save follow-up date' }).click();
        await page.waitForSelector('#toast:not([hidden])', { timeout: 10000 });
        const wAfter = (await itemsOf('work', 'waiting')).find((i) => i.id === wi.id);
        check(wAfter.follow_up_on === todayOn, `follow_up_on ${wAfter.follow_up_on}, want ${todayOn}`);

        await gotoRoute(page, '#/today');
        const after = await todayView(page);
        check(after.nextTitle === wi.title, 'due waiting item is not Next on Today');
        check(
          after.nextWhy === 'You asked [Supplier] on date not stated. Follow-up is today. No reply recorded.',
          'Next why is not the field-built sentence (who from the capture, "date not stated", "Follow-up is today.", "No reply recorded.")',
        );
        const wLink2 = after.links.find((l) => l.href === '#/waiting');
        check(wLink2 && wLink2.eyebrow === '1 to follow up today', `waiting link eyebrow "${wLink2 && wLink2.eyebrow}"`);
        // Someone else's work: Next offers Open Waiting, never a "done" checkbox.
        check(!after.nextHasCheckbox, 'the due follow-up in Next has a done checkbox');
        check(after.nextLinks.includes('Open Waiting|#/waiting'), `Next links ${JSON.stringify(after.nextLinks)}`);

        // Nothing was upgraded by the app.
        const allItems = [...(await itemsOf('work')), ...(await itemsOf('personal'))];
        const wFinal = allItems.find((i) => i.id === wi.id);
        const tFinal = allItems.find((i) => i.id === ti.id);
        check(wFinal.claim_status === 'unspecified' && tFinal.claim_status === 'requested', 'a claim status changed');
        check(!allItems.some((i) => i.claim_status === 'confirmed'), 'some item is confirmed');
        return (
          `proposals 3; cards: Waiting on [Unspecified, Promised by "not stated", "No reply recorded"], ` +
          `Reminder ["Check the time" note], Task [Requested, Asked by = name from sentence]; filed: waiting unspecified ` +
          `(no promised/follow-up date), task requested (due_on null), reminder ${rems[0].local_date} 08:00; ` +
          `task card row "Date mentioned (not a due date)" with "Use as due date" (not tapped); ` +
          `Today before due: waiting not Next, link "Waiting on others: 1"; task on Today: ${taskOnToday ? 'yes' : 'no (no hard date, not picked)'}; ` +
          `after follow-up set to today (${todayOn}) on Waiting: Next = the waiting item, why from fields, "1 to follow up today", no checkbox, "Open Waiting" link; ` +
          `confirmed items 0`
        );
      } finally {
        await context.close();
      }
    },
  },
  {
    id: 'F2',
    name: 'offline capture -> Saved on this phone; offline reload keeps it; online -> Synced; 1 server row',
    async run() {
      const { context, page } = await openApp('F2', { offlineExpected: true });
      try {
        await start(page);
        const cached = await waitControlled(page);
        check(cached, 'service worker controls the page but "/" is not in an hos-* cache');
        const text = remember(`Sample offline note ${tok('of')} for the e2e run.`);
        await context.setOffline(true);
        await typeCapture(page, text, 'personal');
        await sleep(1500);
        const offlineState = (await outboxStates(page, text))[0] || '(missing)';
        check(offlineState.startsWith('Saved on this phone'), `offline item shows "${offlineState}"`);
        const resp = await page.reload({ waitUntil: 'load' });
        await waitAppReady(page);
        const fromSw = resp ? resp.fromServiceWorker() : null;
        const afterReload = await outboxStates(page, text);
        check(afterReload.length === 1, `after offline reload the item is listed ${afterReload.length} times`);
        check(afterReload[0].startsWith('Saved on this phone'), `after offline reload item shows "${afterReload[0]}"`);
        const offlineBanner = await page.isVisible('#offline-banner');
        check(!(await inboxCaptureByText(text)), 'server already has the capture while offline');
        await context.setOffline(false);
        const t0 = Date.now();
        const st = await waitOutboxState(page, text, 'Synced', 20000);
        const ms = Date.now() - t0;
        const all = await exportAll();
        const rows = all.captures.filter((c) => c.text === text);
        check(rows.length === 1, `server rows ${rows.length}, want 1`);
        check(rows[0].receive_count === 1, `receive_count ${rows[0].receive_count}`);
        return (
          `offline UI "${offlineState}"; reload served by SW: ${fromSw}; offline banner visible: ${offlineBanner}; ` +
          `item listed once after reload, still "Saved on this phone"; server rows while offline 0; ` +
          `online -> "${st}" in ${ms} ms; server rows 1 (receive_count 1)`
        );
      } finally {
        await context.setOffline(false).catch(() => {});
        await context.close();
      }
    },
  },
  {
    id: 'F3',
    name: 'check off a task on Today -> Undo -> open again; changes row undone',
    async run() {
      const { context, page } = await openApp('F3');
      try {
        await start(page);
        const text = remember(`Need to order the panel labels for sample ${tok('lb')}.`);
        const cap = await captureSynced(page, text, 'work');
        check(cap.proposals.length === 1, `proposals ${cap.proposals.length}`);
        const todayOn = todayOnIn(TZ);
        await openReview(page, cap.id, 1);
        await card(page, 0).getByRole('button', { name: 'Edit' }).click();
        await card(page, 0).locator('input[name="due_on"]').fill(todayOn);
        await card(page, 0).getByRole('button', { name: 'Use these' }).click();
        await fileReview(page, cap.id);
        const task = (await itemsOf('work', 'task')).find((i) => i.source_capture_id === cap.id);
        check(task && task.due_on === todayOn && task.state === 'open', 'filed task missing or not due today');
        shared.f3TaskId = task.id;
        shared.f3TaskTitle = task.title;

        await gotoRoute(page, '#/today');
        const row = page.locator('section[aria-labelledby="today-list-h"] li.check-row', { has: page.locator('.check-title', { hasText: task.title }) });
        check((await row.count()) === 1, 'task not listed under Today');
        check((await row.locator('.check-meta').textContent()) === 'Due today', 'task meta is not "Due today"');
        await row.locator('label.check-label').click();
        await page.waitForSelector('#toast:not([hidden])', { timeout: 10000 });
        const toastText = await waitFor(async () => (await page.textContent('#toast-text')) || false, { what: 'toast text' });
        check(await page.isVisible('#toast-undo'), 'no Undo on the check-off toast');
        const done = (await itemsOf('work', 'task')).find((i) => i.id === task.id);
        check(done.state === 'done', `after check-off state ${done.state}`);
        await page.click('#toast-undo');
        await page.waitForSelector('#toast', { state: 'hidden', timeout: 10000 });
        const back = (await itemsOf('work', 'task')).find((i) => i.id === task.id);
        check(back.state === 'open' && back.done_at === null, `after Undo state ${back.state}`);
        const changes = (await exportAll()).changes.filter((c) => c.entity === 'item' && c.entity_id === task.id);
        const completeRow = changes.find((c) => c.op === 'complete');
        check(completeRow && completeRow.undone_at, `complete change row ${completeRow ? 'not undone' : 'missing'} (ops: ${changes.map((c) => c.op).join(',')})`);
        const again = await api('POST', `/api/undo/${completeRow.id}`, {});
        check(again.status === 409, `second undo -> ${again.status}`);

        await page.reload({ waitUntil: 'load' });
        await waitAppReady(page);
        await page.waitForFunction(() => document.getElementById('today-body').getAttribute('aria-busy') === 'false', null, { timeout: 15000 });
        const view = await todayView(page);
        const listed = view.list.find((x) => x.title === task.title);
        check(listed && !listed.checked && !listed.done, 'after reload the task is not open on Today');
        return (
          `task filed with due date ${todayOn} via Edit; Today row "Due today"; check-off -> state done, toast "${toastText}" with Undo; ` +
          `Undo -> state open; change ${completeRow.id} op complete undone_at set; second undo -> 409; after reload the row is unchecked`
        );
      } finally {
        await context.close();
      }
    },
  },
  {
    id: 'F4',
    name: 'Project: create, file a capture onto it, one-tap Save my place = prefill verbatim; Today shows Resume',
    async run() {
      const { context, page } = await openApp('F4');
      try {
        await start(page, '#/projects');
        const name = remember(`Sample project ${tok('pj')}`);
        await page.click('#screen-projects details.new-project > summary');
        await page.fill('#project-name', name);
        await page.locator('input[name="pscope"][value="work"]').check();
        await page.click('#project-save');
        await page.waitForFunction(() => location.hash.startsWith('#/project/'), null, { timeout: 15000 });
        const projectId = decodeURIComponent((await page.evaluate(() => location.hash)).split('/')[2]);
        await page.waitForSelector('#project-body .place-card', { timeout: 15000 });
        const emptyPlace = (await page.textContent('#project-body .place-card')).includes('No saved place yet.');

        const text = remember(`Need to confirm the conduit route for sample ${tok('cr')}. Which size does the engineer want?`);
        const cap = await captureSynced(page, text, 'work');
        check(cap.proposals.length === 1, `proposals ${cap.proposals.length}`);
        await openReview(page, cap.id, 1);
        await card(page, 0).getByRole('button', { name: 'Edit' }).click();
        const sel = card(page, 0).locator('select[name="project_id"]');
        check((await sel.count()) === 1, 'the Edit form has no Project choice');
        await sel.selectOption(projectId);
        await card(page, 0).getByRole('button', { name: 'Use these' }).click();
        const projRow = (await reviewCards(page))[0].rows.Project;
        check(projRow === name, 'the card does not show the chosen project');
        await fileReview(page, cap.id);
        const item = (await itemsOf('work', 'task')).find((i) => i.source_capture_id === cap.id);
        check(item && item.project_id === projectId, 'filed task is not on the project');

        const prefill = (await apiOk('GET', `/api/projects/${projectId}/checkpoint/prefill?scope=work`)).prefill;
        check(prefill.stoppedAtText === text, 'prefill stoppedAtText is not the capture text verbatim');
        check(prefill.sourceRef === `capture:${cap.id}`, `prefill sourceRef ${prefill.sourceRef}`);

        await gotoRoute(page, `#/project/${projectId}`);
        await page.locator('#project-body .place-card').getByRole('button', { name: 'Save my place' }).click();
        await page.waitForFunction(() => /Saved /.test((document.querySelector('#project-body .place-card .row-meta') || {}).textContent || ''), null, {
          timeout: 15000,
        });
        const shown = await page.evaluate(() => {
          const out = {};
          for (const div of document.querySelectorAll('#project-body .place-card dl > div')) out[div.querySelector('dt').textContent] = div.querySelector('dd').textContent;
          return out;
        });
        const proj = await apiOk('GET', `/api/projects/${projectId}?scope=work`);
        const cp = proj.checkpoint;
        check(cp, 'no checkpoint saved');
        check(cp.stopped_at_text === prefill.stoppedAtText, 'checkpoint stopped_at_text differs from prefill');
        check(cp.open_question === prefill.openQuestion, 'checkpoint open_question differs from prefill');
        check(cp.next_step === prefill.nextStep, 'checkpoint next_step differs from prefill');
        check(cp.source_ref === prefill.sourceRef, 'checkpoint source_ref differs from prefill');
        check(shown['Stopped at'] === prefill.stoppedAtText, 'card "Stopped at" differs from prefill');
        check(shown['Open question'] === (prefill.openQuestion || 'Not written down'), 'card "Open question" differs');
        check(shown['Next step'] === (prefill.nextStep || 'Not written down'), 'card "Next step" differs');
        const allCps = (await exportAll()).checkpoints.filter((c) => c.project_id === projectId);
        check(allCps.length === 1, `checkpoints for project ${allCps.length}, want 1 (one tap)`);

        await gotoRoute(page, '#/today');
        const view = await todayView(page);
        check(view.resume.includes(name), 'Today has no "Pick up where you left off" row for the project');
        shared.projectId = projectId;
        return (
          `project ${projectId} (work); place card empty at first: ${emptyPlace}; capture filed onto it via Edit > Project; ` +
          `prefill: stoppedAt = capture text verbatim, openQuestion ${prefill.openQuestion ? 'set (last question sentence)' : 'null'}, ` +
          `nextStep ${prefill.nextStep ? 'set (next task title)' : 'null'}, sourceRef capture:${cap.id}; one tap -> 1 checkpoint, ` +
          `all 4 fields equal the prefill, card shows them; Today "Pick up where you left off" lists the project`
        );
      } finally {
        await context.close();
      }
    },
  },
  {
    id: 'F5',
    name: 'Memory: Work search never shows a personal canary; All shows two labelled groups',
    async run() {
      const { context, page } = await openApp('F5');
      try {
        await start(page);
        const canary = tok('cn');
        const workText = remember(`Work sample about ${canary} panel.`);
        const personalText = remember(`Personal sample about ${canary} parcel.`);
        await captureSynced(page, workText, 'work');
        await captureSynced(page, personalText, 'personal');

        await setScopeSwitch(page, 'work');
        await gotoRoute(page, '#/memory');
        const w = await searchUi(page, canary);
        check(w.groups.length === 0, `Work search shows ${w.groups.length} groups, want a single list`);
        check(w.rows.some((r) => r.title === workText), 'Work search misses the work capture');
        check(!w.rows.some((r) => r.title === personalText), 'Work search shows the personal canary');
        const wHtml = await page.textContent('#search-results');
        check(!wHtml.includes('parcel'), 'personal words visible in Work results');

        await setScopeSwitch(page, 'personal');
        const p = await searchUi(page, canary);
        check(p.rows.length >= 1 && p.rows.every((r) => r.title !== workText), 'Personal search shows the work capture');

        await setScopeSwitch(page, 'all');
        const a = await searchUi(page, canary);
        const headings = a.groups.map((g) => g.heading.trim());
        check(a.groups.length === 2, `All shows ${a.groups.length} groups`);
        const gw = a.groups.find((g) => g.scope === 'work');
        const gp = a.groups.find((g) => g.scope === 'personal');
        check(gw && gp, 'All is missing the Work or the Personal group');
        check(/^Work\s+1$/.test(gw.heading.trim()) && /^Personal\s+1$/.test(gp.heading.trim()), `group headings ${JSON.stringify(headings)}`);
        check(gw.rows.length === 1 && gw.rows[0].title === workText, 'Work group content wrong');
        check(gp.rows.length === 1 && gp.rows[0].title === personalText, 'Personal group content wrong');

        const apiWork = (await apiOk('GET', `/api/search?scope=work&q=${encodeURIComponent(canary)}`)).results;
        check(apiWork.every((r) => r.scope === 'work'), 'API work search returned a personal row');
        const allScope = await api('GET', `/api/search?scope=all&q=${encodeURIComponent(canary)}`);
        check(allScope.status === 400, `search scope=all -> ${allScope.status}`);
        return (
          `Work: ${w.summaryCount} match, single list, personal canary absent; Personal: ${p.summaryCount} match, work absent; ` +
          `All: groups ${JSON.stringify(headings)}, each holding only its own scope; API work rows all work; scope=all -> 400`
        );
      } finally {
        await context.close();
      }
    },
  },
  {
    id: 'F6',
    name: 'delete a capture whose piece was accepted -> item stays, source deleted; capture words no longer found',
    async run() {
      const { context, page } = await openApp('F6');
      try {
        await start(page);
        const itemWord = tok('pm');
        const noteWord = tok('kw');
        const text = remember(`Need to renew the ${itemWord} permit sample. Kept note ${noteWord} for later.`);
        const cap = await captureSynced(page, text, 'personal');
        await openReview(page, cap.id, 1);
        await lookRightAll(page, cap.id, 1);
        const item = (await itemsOf('personal', 'task')).find((i) => i.source_capture_id === cap.id);
        check(item && item.source_quote, 'filed item missing or without its source quote');

        await setScopeSwitch(page, 'personal');
        await gotoRoute(page, '#/memory');
        const before = await searchUi(page, noteWord);
        check(before.summaryCount === 1, `before delete: ${before.summaryCount} matches for the capture-only word, want 1`);

        // The UI offers Delete only for captures still waiting for review; a reviewed one is deleted by its API route.
        const del = await apiOk('DELETE', `/api/captures/${cap.id}?scope=personal`);
        check(del.deleted.captures === 1 && del.deleted.itemsDetached === 1 && del.deleted.itemsDeleted === 0, `delete counts ${JSON.stringify(del.deleted)}`);

        const after = (await itemsOf('personal', 'task')).find((i) => i.id === item.id);
        check(after, 'the accepted item was deleted');
        check(after.title === item.title, 'item title changed');
        check(after.source_deleted === 1 && after.source_capture_id === null && after.source_quote === null, 'item source fields not cleared/marked');

        const gone = await searchUi(page, noteWord);
        check(gone.summaryCount === 0, `after delete: ${gone.summaryCount} matches for the capture-only word`);
        const kept = await searchUi(page, itemWord);
        const row = kept.rows.find((r) => r.title === item.title);
        check(row, 'the item is no longer found by its own words');
        check(row.chips.includes('From a deleted capture'), `item row chips ${JSON.stringify(row.chips)}`);
        const exp = JSON.stringify(await exportAll());
        check(!exp.includes(noteWord), 'the deleted words are still in the export');
        return (
          `delete -> captures 1, itemsDetached 1, itemsDeleted 0; item kept with title, source_deleted 1, source_capture_id/source_quote null; ` +
          `capture-only word: 1 match before, 0 after (UI); item still found, chip "From a deleted capture"; deleted words absent from full export`
        );
      } finally {
        await context.close();
      }
    },
  },
  {
    id: 'F7',
    name: 'decision superseded -> Memory search shows the current one first and the old one marked',
    async run() {
      const { context, page } = await openApp('F7');
      try {
        await start(page);
        const word = tok('dc');
        const text = remember(`Decided to use ${word} fixtures in the sample lobby.`);
        const cap = await captureSynced(page, text, 'work');
        check(cap.proposals.length === 1 && cap.proposals[0].kind === 'decision', 'capture did not give one decision');
        await openReview(page, cap.id, 1);
        await lookRightAll(page, cap.id, 1);
        const oldD = (await itemsOf('work', 'decision')).find((i) => i.source_capture_id === cap.id);
        check(oldD, 'decision not filed');
        // No UI control supersedes a decision in Slice 1; the API route does it.
        const newTitle = remember(`use ${word} strips in the sample lobby instead`);
        const created = await apiOk('POST', '/api/items', { kind: 'decision', title: newTitle, scope: 'work', supersedesId: oldD.id });
        check(created.superseded && created.superseded.superseded_by_id === created.item.id, 'old decision not marked superseded');

        await setScopeSwitch(page, 'work');
        await gotoRoute(page, '#/memory');
        const res = await searchUi(page, word);
        const titles = res.rows.map((r) => r.title);
        const iNew = titles.indexOf(newTitle);
        const iOld = titles.indexOf(oldD.title);
        check(iNew === 0, `current decision is at position ${iNew}, want 0`);
        check(iOld > iNew, 'superseded decision is not after the current one');
        const oldRow = res.rows[iOld];
        check(oldRow.superseded && oldRow.chips.includes('Replaced by a later decision'), 'old decision not marked as replaced');
        check(!res.rows[iNew].chips.includes('Replaced by a later decision'), 'current decision marked as replaced');
        const firstSup = res.rows.findIndex((r) => r.superseded);
        check(res.rows.slice(firstSup).every((r) => r.superseded), 'a current row comes after a superseded one');
        return (
          `${res.rows.length} rows; current decision at 0, superseded decision at ${iOld} (last group) with chip ` +
          `"Replaced by a later decision" and row class is-superseded; both still searchable`
        );
      } finally {
        await context.close();
      }
    },
  },
  {
    id: 'F8',
    name: 'return view: last_open_at 8 days back (wrangler d1 execute --local) -> Welcome back, hard dates, one next step; nothing moved',
    async run() {
      check(shared.f3TaskId && shared.waitingId, 'F8 needs F1 and F3 data');
      const snapshot = async () => {
        const t = await exportAll();
        return JSON.stringify({
          items: t.items.map((i) => [i.id, i.state, i.due_on, i.follow_up_on, i.claim_status, i.today_pick, i.superseded_by_id, i.updated_at, i.done_at]),
          reminders: t.reminders.map((r) => [r.id, r.state, r.next_fire_at]),
          captures: t.captures.map((c) => [c.id, c.review_state]),
          projects: t.projects.map((p) => [p.id, p.state, p.last_touched_at]),
          checkpoints: t.checkpoints.length,
          changes: t.changes.map((c) => [c.id, c.undone_at]),
        });
      };
      const before = await snapshot();
      const eightDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString();
      wranglerD1(
        `INSERT INTO meta (key, value) VALUES ('last_open_at', '${eightDaysAgo}') ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      );
      const readBack = wranglerD1("SELECT value FROM meta WHERE key = 'last_open_at'", { json: true });
      const value = readBack[0] && readBack[0].results && readBack[0].results[0] && readBack[0].results[0].value;
      check(value === eightDaysAgo, 'meta last_open_at did not read back as written');

      const { context, page } = await openApp('F8');
      try {
        await start(page);
        await page.waitForFunction(() => document.getElementById('today-body').getAttribute('aria-busy') === 'false', null, { timeout: 15000 });
        await page.waitForSelector('#today-body .return-card', { timeout: 15000 });
        const rv = await page.evaluate(() => {
          const card = document.querySelector('#today-body .return-card');
          const rows = {};
          for (const div of card.querySelectorAll('dl.rows > div')) rows[div.querySelector('dt').textContent] = div.querySelector('dd');
          const hard = rows['Hard dates in the next 7 days'];
          return {
            heading: card.querySelector('h2').textContent,
            reassurance: (card.querySelector('p.subtle') || {}).textContent || '',
            hardItems: hard ? [...hard.querySelectorAll('li')].map((li) => ({ text: li.textContent, date: (li.querySelector('strong') || {}).textContent || '' })) : [],
            followUps: rows['Follow-ups that came due'] ? rows['Follow-ups that came due'].textContent : null,
            nextTitles: [...card.querySelectorAll('.next-title')].map((n) => n.textContent),
            why: (card.querySelector('.why') || {}).textContent || '',
          };
        });
        check(rv.heading === "You've been away 8 days", `heading "${rv.heading}"`);
        check(/Nothing was moved, completed or deleted/.test(rv.reassurance), 'no "nothing moved" line');
        const f3 = rv.hardItems.find((h) => h.text.endsWith(shared.f3TaskTitle));
        check(f3, 'the hard-dated task (F3) is not in the 7-day list');
        check(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}: $/.test(f3.date), `hard date label "${f3.date}" is not a calendar date`);
        check(rv.nextTitles.length === 1, `${rv.nextTitles.length} next steps shown, want 1`);
        check(rv.nextTitles[0] === shared.waitingTitle, 'the one next step is not the due follow-up');
        check(rv.followUps === '1', `follow-ups that came due: ${rv.followUps}`);

        const second = await apiOk('GET', `/api/today?scope=all&tz=${encodeURIComponent(TZ)}`);
        check(second.returnView === null, 'returnView still set on the next open');
        await page.locator('#today-body .return-card').getByRole('button', { name: 'Go to Today' }).click();
        check(!(await page.isVisible('#today-body .return-card')), 'return card still shown after Go to Today');

        // A new time away in the same open session (no reload) brings the Return view back.
        await gotoRoute(page, '#/waiting');
        wranglerD1(
          `INSERT INTO meta (key, value) VALUES ('last_open_at', '${eightDaysAgo}') ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        );
        await gotoRoute(page, '#/today');
        await page.waitForSelector('#today-body .return-card', { timeout: 15000 });
        const again = await page.textContent('#today-body .return-card h2');
        check(again === "You've been away 8 days", `second return view heading "${again}"`);
        await page.locator('#today-body .return-card').getByRole('button', { name: 'Go to Today' }).click();

        const after = await snapshot();
        check(after === before, 'items, reminders, captures, projects or changes moved');
        return (
          `meta set and read back via wrangler d1 execute --local; Today: "${rv.heading}", "Nothing was moved..." line; ` +
          `hard dates ${rv.hardItems.length} (F3 task with label "${f3.date.trim()}"); follow-ups due 1; one next step = the due follow-up; ` +
          `next open returnView null; Go to Today hides it; a second 8-day gap in the same open page shows it again (no reload); ` +
          `snapshot of items/reminders/captures/projects/changes identical`
        );
      } finally {
        await context.close();
      }
    },
  },
  {
    id: 'F9',
    name: 'CSRF: POST without X-Requested-With -> 403 (Node + real cross-origin page); app at 390px: 0 console errors, 0 CSP violations',
    async run() {
      const id = `csrf_${RUN}_${Math.random().toString(36).slice(2, 8)}`;
      const text = remember(`Sample csrf probe ${tok('cs')}.`);
      const formLike = await api('POST', '/api/captures', { id, text, scope: 'personal' }, { xhr: false, contentType: 'text/plain' });
      const jsonNoHdr = await api('POST', '/api/projects', { name: text, scope: 'work' }, { xhr: false });
      const wrong = await fetch(`${BASE}/api/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
        body: JSON.stringify({ kind: 'task', title: text, scope: 'work' }),
      });
      check(formLike.status === 403 && formLike.data.error.code === 'csrf', `text/plain capture -> ${formLike.status}`);
      check(jsonNoHdr.status === 403 && jsonNoHdr.data.error.code === 'csrf', `json project without header -> ${jsonNoHdr.status}`);
      check(wrong.status === 403, `wrong header value -> ${wrong.status}`);

      // A real cross-origin page in Chrome: a simple no-cors POST arrives without the header (403), and adding
      // the header needs a CORS preflight the Worker never approves, so the request is never sent.
      const { context: xctx, page: xpage, rec: xrec } = await openApp('F9-cross-origin');
      let otherSite = null;
      let cross;
      try {
        check(listeningPids(CROSS_PORT).length === 0, `port ${CROSS_PORT} is busy`);
        otherSite = http.createServer((req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end('<!doctype html><title>other site</title><p>other site</p>');
        });
        await new Promise((resolve, reject) => {
          otherSite.once('error', reject);
          otherSite.listen(CROSS_PORT, HOST, resolve);
        });
        let sawResponse = null;
        xpage.on('response', (r) => {
          if (r.url().startsWith(`${BASE}/api/captures`)) sawResponse = r.status();
        });
        await xpage.goto(`${CROSS_ORIGIN}/`);
        cross = await xpage.evaluate(
          async ({ base, body }) => {
            const out = {};
            try {
              const r = await fetch(`${base}/api/captures`, { method: 'POST', mode: 'no-cors', credentials: 'include', headers: { 'Content-Type': 'text/plain' }, body });
              out.simple = r.type;
            } catch (e) {
              out.simple = `error ${e.name}: ${String(e.message).slice(0, 80)}`;
            }
            try {
              await fetch(`${base}/api/captures`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                body,
              });
              out.withHeader = 'sent';
            } catch (e) {
              out.withHeader = `blocked (${e.name})`;
            }
            return out;
          },
          { base: BASE, body: JSON.stringify({ id, text, scope: 'personal' }) },
        );
        await sleep(500);
        cross.simpleStatus = sawResponse;
      } finally {
        await xctx.close();
        if (otherSite) await new Promise((resolve) => otherSite.close(resolve));
      }
      const stored = (await exportAll()).captures.some((c) => c.id === id || c.text === text);
      const projects = (await exportAll()).projects.some((p) => p.name === text);
      check(!stored && !projects, 'a CSRF probe was stored');
      check(
        cross.simple === 'opaque' && cross.simpleStatus === 403,
        `cross-origin simple POST: ${cross.simple}, status ${cross.simpleStatus}; console ${JSON.stringify(xrec.consoleErrors.slice(0, 3))}`,
      );
      check(/^blocked/.test(cross.withHeader), `cross-origin POST with the header was ${cross.withHeader}`);

      // Page health at 390 px.
      const head = await fetch(`${BASE}/`);
      await head.arrayBuffer();
      const csp = head.headers.get('content-security-policy') || '';
      check(/frame-ancestors 'none'/.test(csp) && /fonts\.googleapis\.com/.test(csp) && /fonts\.gstatic\.com/.test(csp), 'CSP header lacks frame-ancestors or the font hosts');
      const { context, page, rec } = await openApp('F9');
      try {
        await start(page);
        await waitControlled(page);
        for (const hash of ['#/projects', '#/memory', '#/waiting', '#/tasks', '#/review', '#/today']) await gotoRoute(page, hash);
        await openCaptureSheet(page);
        await closeCaptureSheet(page);
        await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 10000 }).catch(() => {});
        await sleep(1500);
        const violations = await page.evaluate(() => window.__cspViolations.slice());
        const layout = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          fontsLoaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')),
        }));
        check(rec.consoleErrors.length === 0, `console errors: ${JSON.stringify(rec.consoleErrors.slice(0, 3))}`);
        check(rec.pageErrors.length === 0, `page errors: ${JSON.stringify(rec.pageErrors.slice(0, 3))}`);
        check(violations.length === 0, `CSP violations: ${JSON.stringify(violations.slice(0, 3))}`);
        check(layout.innerWidth === 390, `viewport width ${layout.innerWidth}`);
        check(layout.scrollWidth <= 390, `horizontal overflow: scrollWidth ${layout.scrollWidth} at 390px`);
        const onlineRecs = pageRecords.filter((r) => !r.offlineExpected && r.name !== 'F9-cross-origin');
        const runErrors = onlineRecs.reduce((n, r) => n + r.consoleErrors.length + r.pageErrors.length, 0);
        const runCsp = pageRecords.reduce((n, r) => n + r.cspConsole.length, 0);
        return (
          `text/plain capture -> 403 csrf; JSON project without header -> 403 csrf; wrong header value -> 403; ` +
          `cross-origin page (${CROSS_ORIGIN}): no-cors POST -> ${cross.simple}/${cross.simpleStatus}, POST with the header ${cross.withHeader}; nothing stored; ` +
          `390x844: console errors 0, page errors 0, CSP violations 0, scrollWidth ${layout.scrollWidth}, fonts loaded ${JSON.stringify([...new Set(layout.fontsLoaded)])}; ` +
          `whole run: console/page errors in online contexts ${runErrors}, CSP console messages ${runCsp}`
        );
      } finally {
        await context.close();
      }
    },
  },
  {
    id: 'F10',
    name: 'undated task -> Looks right -> in Open tasks -> Pick for today -> on Today -> check off -> Undo; failures visible; incomplete reminder blocked',
    async run() {
      const { context, page } = await openApp('F10', { offlineExpected: true });
      const openTaskIds = async () => [...(await itemsOf('work', 'task')), ...(await itemsOf('personal', 'task'))].filter((i) => i.state === 'open');
      const tasksView = () =>
        page.evaluate(() =>
          [...document.querySelectorAll('#tasks-body section')].map((s) => ({
            heading: (s.querySelector('h2') || {}).textContent || '',
            rows: [...s.querySelectorAll('li.check-row')].map((li) => ({
              title: (li.querySelector('.check-title') || {}).textContent || '',
              meta: (li.querySelector('.check-meta') || {}).textContent || '',
              buttons: [...li.querySelectorAll('button')].map((b) => b.textContent),
            })),
          })),
        );
      const toast = async () => {
        await page.waitForSelector('#toast:not([hidden])', { timeout: 10000 });
        const text = await waitFor(async () => (await page.textContent('#toast-text')) || false, { what: 'toast text' });
        return { text, undo: await page.isVisible('#toast-undo') };
      };
      const hideToast = () => page.evaluate(() => {
        document.getElementById('toast').hidden = true;
      });
      try {
        await start(page);

        // A reminder with a date but no time cannot be marked Looks right; Edit adds the time.
        const remText = remember(`Remind me Friday to call the sample inspector ${tok('ri')}.`);
        const rcap = await captureSynced(page, remText, 'work');
        check(rcap.proposals.length === 1 && rcap.proposals[0].kind === 'reminder', 'reminder capture did not give one reminder');
        await openReview(page, rcap.id, 1);
        const rcard = (await reviewCards(page))[0];
        check(rcard.notes.includes('Needs a date and a time. Tap Edit.'), `reminder notes ${JSON.stringify(rcard.notes)}`);
        check(await card(page, 0).getByRole('button', { name: 'Looks right' }).isDisabled(), 'Looks right is enabled for a reminder without a time');
        await card(page, 0).getByRole('button', { name: 'Edit' }).click();
        await card(page, 0).locator('input[name="remind_time"]').fill('09:00');
        await card(page, 0).getByRole('button', { name: 'Use these' }).click();
        check(!(await page.locator('#review-body').getByRole('button', { name: 'File these' }).isDisabled()), 'File these disabled after the time was added');
        await fileReview(page, rcap.id);
        const rem = (await apiOk('GET', '/api/reminders?scope=work')).items.find((r) => r.id === `cap_${rcap.id}_1`);
        check(rem && rem.local_time === '09:00', `reminder filed with time ${rem && rem.local_time}`);

        // An undated task: filed with Looks right, so no due date and not picked.
        const text = remember(`Need to order sample conduit straps ${tok('ot')}.`);
        const cap = await captureSynced(page, text, 'work');
        check(cap.proposals.length === 1 && cap.proposals[0].kind === 'task', 'task capture did not give one task');
        await openReview(page, cap.id, 1);
        await lookRightAll(page, cap.id, 1);
        const task = (await itemsOf('work', 'task')).find((i) => i.source_capture_id === cap.id);
        check(task && task.due_on === null && task.today_pick === 0 && task.state === 'open', 'filed task is dated, picked or not open');

        // Today: not on the list, but counted on the Open tasks link.
        await gotoRoute(page, '#/today');
        const before = await todayView(page);
        check(!before.list.some((x) => x.title === task.title) && before.nextTitle !== task.title, 'undated, unpicked task is on Today');
        const nOpen = (await openTaskIds()).length;
        const tLink = before.links.find((l) => l.href === '#/tasks');
        check(tLink && tLink.title === `All open tasks · ${nOpen}`, `tasks link "${tLink && tLink.title}", want ${nOpen}`);

        // The header link is a 44 px target on every screen.
        const hdr = await page.evaluate(() => {
          const a = document.querySelector('.topbar a.topbar-link');
          const r = a.getBoundingClientRect();
          return { href: a.getAttribute('href'), w: r.width, h: r.height, name: a.textContent.replace(/\s+/g, ' ').trim(), topbarH: document.querySelector('.topbar-inner').getBoundingClientRect().height };
        });
        check(hdr.href === '#/tasks' && hdr.w >= 44 && hdr.h >= 44 && hdr.name === 'Open Tasks', `header link ${JSON.stringify(hdr)}`);
        check(hdr.topbarH < 88, `top bar wraps at 390px (height ${hdr.topbarH})`);

        // Open tasks from the Today link: the task is under Anytime with Pick for today.
        const waitTasks = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/items', { timeout: 15000 });
        await page.click('#today-body a.link-card[href="#/tasks"]');
        await waitTasks;
        await page.waitForFunction(() => document.getElementById('tasks-body').getAttribute('aria-busy') === 'false', null, { timeout: 15000 });
        let groups = await tasksView();
        const shownCount = groups.reduce((n, g) => n + g.rows.length, 0);
        check(shownCount === nOpen, `Open tasks shows ${shownCount} rows, API has ${nOpen} open`);
        const anytime = groups.find((g) => g.heading.startsWith('Anytime'));
        const row0 = anytime && anytime.rows.find((r) => r.title === task.title);
        check(row0 && row0.buttons.includes('Pick for today'), `task row in Anytime: ${JSON.stringify(row0)}`);
        const dueGroup = groups.find((g) => g.heading.startsWith('Due'));
        const f3Row = shared.f3TaskTitle && dueGroup ? dueGroup.rows.find((r) => r.title === shared.f3TaskTitle) : null;

        const taskRow = () => page.locator('#tasks-body li.check-row', { has: page.locator('.check-title', { hasText: task.title }) });

        // A failure is visible (toast without Undo), not only announced.
        await context.setOffline(true);
        await taskRow().getByRole('button', { name: /Pick for today/ }).click();
        const failToast = await toast();
        check(/^Could not pick it for today\. No connection\./.test(failToast.text) && !failToast.undo, `failure toast ${JSON.stringify(failToast)}`);
        await context.setOffline(false);
        await hideToast();
        await page.waitForFunction(() => document.getElementById('tasks-body').getAttribute('aria-busy') === 'false', null, { timeout: 15000 });

        // Pick for today: toast with Undo; the row moves to "Picked for today".
        await taskRow().getByRole('button', { name: /Pick for today/ }).click();
        const pickToast = await toast();
        check(pickToast.text === 'Picked for today.' && pickToast.undo, `pick toast ${JSON.stringify(pickToast)}`);
        const picked = (await itemsOf('work', 'task')).find((i) => i.id === task.id);
        check(picked.today_pick === 1, `today_pick ${picked.today_pick}`);
        await waitFor(async () => {
          groups = await tasksView();
          const g = groups.find((x) => x.heading.startsWith('Picked for today'));
          return g && g.rows.some((r) => r.title === task.title && r.buttons.includes('Remove from today'));
        }, { what: 'task under "Picked for today"' });
        await hideToast();

        // On Today with "Picked for today" and Remove from today.
        await gotoRoute(page, '#/today');
        const onToday = await todayView(page);
        const listed = onToday.list.find((x) => x.title === task.title);
        check(listed && listed.meta === 'Picked for today' && !listed.checked, `Today row ${JSON.stringify(listed)}`);
        const todayRow = page.locator('section[aria-labelledby="today-list-h"] li.check-row', { has: page.locator('.check-title', { hasText: task.title }) });
        check((await todayRow.getByRole('button', { name: /Remove from today/ }).count()) === 1, 'no Remove from today on the Today row');

        // Check off, then Undo.
        await todayRow.locator('label.check-label').click();
        const doneToast = await toast();
        check(doneToast.text === 'Marked done.' && doneToast.undo, `check-off toast ${JSON.stringify(doneToast)}`);
        check((await itemsOf('work', 'task')).find((i) => i.id === task.id).state === 'done', 'task not done after check-off');
        await page.click('#toast-undo');
        await page.waitForSelector('#toast', { state: 'hidden', timeout: 10000 });
        const back = (await itemsOf('work', 'task')).find((i) => i.id === task.id);
        check(back.state === 'open' && back.done_at === null && back.today_pick === 1, `after Undo state ${back.state}, today_pick ${back.today_pick}`);
        await gotoRoute(page, '#/today');
        const after = await todayView(page);
        const again = after.list.find((x) => x.title === task.title);
        check(again && !again.checked && !again.done, 'after Undo the task is not open on Today');

        // Remove from today has Undo too.
        await todayRow.getByRole('button', { name: /Remove from today/ }).click();
        const unpickToast = await toast();
        check(unpickToast.text === 'Removed from today.' && unpickToast.undo, `unpick toast ${JSON.stringify(unpickToast)}`);
        check((await itemsOf('work', 'task')).find((i) => i.id === task.id).today_pick === 0, 'still picked after Remove from today');
        await page.click('#toast-undo');
        await page.waitForSelector('#toast', { state: 'hidden', timeout: 10000 });
        check((await itemsOf('work', 'task')).find((i) => i.id === task.id).today_pick === 1, 'Undo of Remove from today did not restore the pick');

        return (
          `reminder "Friday" without a time: note "Needs a date and a time. Tap Edit.", Looks right disabled, Edit 09:00 -> filed (local_time 09:00); ` +
          `undated task filed (due_on null, today_pick 0), not on Today; Today link "All open tasks · ${nOpen}" = API open count; header link #/tasks ` +
          `${Math.round(hdr.w)}x${Math.round(hdr.h)}, top bar one line (${Math.round(hdr.topbarH)}px); Open tasks rows ${shownCount} = API; ` +
          `task under Anytime; F3 task under Due: ${f3Row ? 'yes' : 'n/a'}; offline Pick -> visible toast "${failToast.text}" without Undo; ` +
          `Pick -> "Picked for today." with Undo, today_pick 1, row under "Picked for today"; Today row "Picked for today" + Remove from today; ` +
          `check-off -> done with Undo -> Undo -> open (pick kept); Remove from today -> today_pick 0 -> Undo -> 1`
        );
      } finally {
        await context.setOffline(false).catch(() => {});
        await context.close();
      }
    },
  },
];

// After the scenarios: no sample text in server output or events.
async function hygieneCheck(devOutput) {
  const ev = await api('GET', '/api/evidence?limit=500');
  check(ev.status === 200, `GET /api/evidence -> ${ev.status}`);
  const evText = JSON.stringify(ev.data);
  const pieces = new Set();
  for (const m of markers) {
    pieces.add(m);
    for (const w of m.split(/[\s.,?]+/)) if (w.length >= 8 && /\d/.test(w)) pieces.add(w); // the run tokens
  }
  pieces.add('electricians');
  pieces.add('[Supplier]');
  const inLog = [...pieces].filter((m) => devOutput.includes(m)).length;
  const inEvents = [...pieces].filter((m) => evText.includes(m)).length;
  check(inLog === 0 && inEvents === 0, `sample text found: wrangler dev output ${inLog}, events ${inEvents}`);
  return `${markers.length} sample texts (${pieces.size} strings incl. run tokens) checked; in wrangler dev output 0, in ${ev.data.events.length} events 0`;
}

// ---------------------------------------------------------------- main

async function main() {
  const results = [];
  let dev = null;
  let tornDown = false;

  async function teardown() {
    if (tornDown) return [];
    tornDown = true;
    const notes = [];
    if (browser) await browser.close().catch((e) => notes.push(`browser close: ${e.message}`));
    if (dev && dev.child.pid) {
      killTree(dev.child.pid);
      notes.push(`killed wrangler dev tree ${dev.child.pid}`);
    }
    let free = await waitPortFree(APP_PORT, 10000);
    if (!free) {
      try {
        freePort(APP_PORT);
      } catch (e) {
        notes.push(e.message);
      }
      free = await waitPortFree(APP_PORT, 5000);
    }
    notes.push(`port ${APP_PORT} free: ${free}`);
    if (dev) await dev.closeLog();
    return notes;
  }

  const hard = setTimeout(async () => {
    say(`HARD TIMEOUT after ${HARD_TIMEOUT_MS / 1000}s, tearing down`);
    for (const n of await teardown()) say(`  teardown: ${n}`);
    process.exit(2);
  }, HARD_TIMEOUT_MS);
  process.once('SIGINT', async () => {
    for (const n of await teardown()) say(`  teardown: ${n}`);
    process.exit(130);
  });

  let setupError = null;
  try {
    say('setup: stopping leftover harrison-os servers');
    freePort(APP_PORT, say);
    check(await waitPortFree(APP_PORT), `port ${APP_PORT} still busy`);

    const devVarsPath = path.join(ROOT, '.dev.vars');
    check(fs.existsSync(devVarsPath), '.dev.vars missing: run `node scripts/gen-vapid.mjs` first');
    const vars = Object.fromEntries(
      fs
        .readFileSync(devVarsPath, 'utf8')
        .split(/\r?\n/)
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
    for (const k of ['DEV_ALLOW_UNAUTH', 'SPIKE_TEST_HOOKS']) check(vars[k] === '1', `.dev.vars ${k} is not 1`);

    say(`setup: resetting ${STATE_DIR}`);
    const stateAbs = path.join(ROOT, STATE_DIR);
    for (let i = 0; i < 10 && fs.existsSync(stateAbs); i++) {
      try {
        fs.rmSync(stateAbs, { recursive: true, force: true });
      } catch {
        await sleep(500);
      }
    }
    check(!fs.existsSync(stateAbs), `could not delete ${STATE_DIR}`);
    const mig = runNodeSync([WRANGLER, 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', STATE_DIR], { cwd: ROOT, env: childEnv });
    check(mig.ok && /0001_init\.sql/.test(mig.output), `migrations failed: ${mig.output.slice(-400)}`);
    say('setup: migrations applied (0001_init.sql)');

    fs.mkdirSync(path.dirname(DEV_LOG), { recursive: true });
    dev = spawnLogged(
      [WRANGLER, 'dev', '--local', '--ip', HOST, '--port', String(APP_PORT), '--persist-to', STATE_DIR, '--test-scheduled'],
      { cwd: ROOT, env: childEnv, logPath: DEV_LOG },
    );
    say(`setup: wrangler dev started (PID ${dev.child.pid}), log ${path.relative(ROOT, DEV_LOG)}`);
    let exited = null;
    dev.child.once('exit', (code) => {
      exited = code;
    });
    await waitFor(
      async () => {
        if (exited !== null) throw new Error(`wrangler dev exited with ${exited}`);
        const r = await api('GET', '/api/session');
        return r.status === 200 && r.data.identity.kind === 'dev' && r.data.testHooks === true;
      },
      { timeout: 90000, interval: 500, what: 'wrangler dev ready' },
    ).catch((e) => {
      throw new Error(`${e.message}\n--- wrangler output tail ---\n${dev.output().slice(-1500)}`);
    });
    say('setup: worker ready (identity dev, test hooks on)');

    const require = createRequire(PLAYWRIGHT_PKG);
    const { chromium } = require('playwright');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    say(`setup: Chrome ${browser.version()} (headless, ${VIEWPORT.width}x${VIEWPORT.height}, ${TZ}, Playwright from the existing install)`);
  } catch (err) {
    setupError = err;
  }

  const only = process.env.E2E_ONLY ? new Set(process.env.E2E_ONLY.split(',').map((x) => x.trim())) : null;
  if (!setupError) {
    for (const s of scenarios.filter((x) => !only || only.has(x.id))) {
      const t0 = Date.now();
      say(`run ${s.id}: ${s.name}`);
      try {
        const evidence = await s.run();
        results.push({ id: s.id, name: s.name, pass: true, ms: Date.now() - t0, evidence });
      } catch (err) {
        results.push({ id: s.id, name: s.name, pass: false, ms: Date.now() - t0, evidence: String(err && err.message).split('\n')[0] });
      }
      say(`    ${results.at(-1).pass ? 'PASS' : 'FAIL'} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
    const t0 = Date.now();
    try {
      results.push({ id: 'X1', name: 'no sample text in wrangler dev output or events', pass: true, ms: 0, evidence: await hygieneCheck(dev.output()) });
    } catch (err) {
      results.push({ id: 'X1', name: 'no sample text in wrangler dev output or events', pass: false, ms: Date.now() - t0, evidence: err.message });
    }
  }

  const notes = await teardown();
  clearTimeout(hard);

  say('');
  say('Harrison OS Slice 1, local e2e (wrangler dev --local + headless system Chrome at 390x844). Not iPhone evidence.');
  say('-'.repeat(100));
  say(`${'ID'.padEnd(5)}${'RESULT'.padEnd(8)}${'TIME'.padStart(7)}  SCENARIO`);
  for (const r of results) {
    say(`${r.id.padEnd(5)}${(r.pass ? 'PASS' : 'FAIL').padEnd(8)}${`${(r.ms / 1000).toFixed(1)}s`.padStart(7)}  ${r.name}`);
    say(`${' '.repeat(22)}evidence: ${r.evidence}`);
  }
  say('-'.repeat(100));
  if (setupError) say(`SETUP FAILED: ${setupError.message}`);
  for (const n of notes) say(`teardown: ${n}`);
  const failed = results.filter((r) => !r.pass).length;
  say(`${results.length - failed}/${results.length} passed${setupError ? ', setup failed' : ''}`);
  process.exitCode = failed > 0 || setupError || results.length === 0 ? 1 : 0;
}

main().catch((err) => {
  say(`runner crashed: ${err && err.stack}`);
  process.exitCode = 1;
});
