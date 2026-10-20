// The task sheet's and the daily report's filing marker, on the real review-folder queue (shared.mjs fileAway) with
// storage, fetch and the toast faked. The report runs its real module; the task's fileTask/fileIfChanged are cut from
// tasks.html (an inline module). Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DAY = '2026-10-19', OUTBOX = 'schwab.outbox';
const S = { folderUrl: 'https://script.google.com/macros/s/TEST/exec', siteCode: 'fictional', project: 'Fictional job', site: 'Test site' };
const store = new Map();
let full = false, writes = 0, posts = 0, answer = null;
globalThis.localStorage = {
  getItem: k => store.get(k) ?? null,
  setItem: (k, v) => {
    if (k === OUTBOX) { if (full) throw new Error('QuotaExceededError'); writes++; }
    store.set(k, String(v));
  },
  removeItem: k => store.delete(k),
};
globalThis.fetch = () => { posts++; return new Promise(res => { answer = () => res({ json: async () => ({ ok: true }) }); }); }; // held until answer()
const toastEl = { classList: { add() {}, remove() {} }, dataset: {}, setAttribute() {} };

async function kinds() {
  const lib = await import('../docs/schwab/shared.mjs'), rep = await import('../docs/schwab/report.mjs');
  globalThis.document = { getElementById: () => toastEl, querySelector: () => null, body: { append() {} } };
  const html = fs.readFileSync(path.join(__dirname, '../docs/schwab/tasks.html'), 'utf8');
  const chunk = html.slice(html.search(/(?:async )?function fileTask\(t\)/)).split(/\r?\n\/\/ -{5,} office passcode/)[0];
  assert.match(chunk, /const fileIfChanged = /, 'find the actual task filing code');
  const ctx = vm.createContext({ S, fileAway: lib.fileAway, load: lib.load, save: lib.save, normTask: lib.normTask, KEYS: lib.KEYS,
    fileName: () => 'T1 Crew A Level 1', record: () => new Uint8Array([37, 80, 68, 70, 45]) }); // "%PDF-"
  // As in tasks.html: T is reloaded from storage when a sync (or another tab) changes it.
  vm.runInContext(`let T = []; const find = u => T.find(t => t.uid === u); const persist = () => save(KEYS.tasks, T);\n${chunk}
    this.api = { leave: () => fileIfChanged(find('u1')), swap: () => { T = load(KEYS.tasks, []).map(normTask); }, now: () => find('u1') };`, ctx);
  return {
    task: { ...ctx.api, stored: () => lib.load(lib.KEYS.tasks, [])[0],
      seed: () => { lib.save(lib.KEYS.tasks, [lib.normTask({ uid: 'u1', id: 'T1', date: DAY, status: 'Complete', updatedAt: 100 })]); ctx.api.swap(); } },
    report: { leave: () => rep.fileReportIfChanged(S, DAY), swap: rep.reloadReports, now: () => rep.reportsNow()[DAY], stored: () => lib.load(lib.KEYS.reports, {})[DAY],
      seed: () => { lib.save(lib.KEYS.reports, { [DAY]: lib.normReport({ date: DAY, status: 'On track', submittedAt: 90, updatedAt: 100 }) }); rep.reloadReports(); } },
    queued: lib.queued,
  };
}
const ready = kinds();

for (const kind of ['task', 'report']) test(kind + ' PDF: marked filed once queued, so leaving mid-upload or a sync reload files nothing twice; a failed queue write stays unfiled', async () => {
  const k = await ready, a = k[kind];
  store.clear(); writes = 0; posts = 0; a.seed();

  full = true; // the phone is out of space: nothing is queued
  await a.leave();
  assert.equal(k.queued(), 0);
  assert.equal(a.now().filedAt, 0, 'a failed queue write must not mark the PDF filed');
  assert.equal(a.stored().filedAt, 0, 'the failed attempt does not persist a false filing marker');
  full = false;

  const first = a.leave(); // leave the screen: queued, the upload in flight
  assert.equal(writes, 1);
  assert.equal(a.stored().filedAt, 100, 'marked and saved when queued, before the upload (a closed page keeps it)');
  assert.ok(!a.leave(), 'leaving again mid-upload queues nothing new');
  assert.equal(writes, 1); assert.equal(posts, 1);
  a.swap(); // a sync onChange reloads the records mid-upload
  assert.equal(a.now().filedAt, 100, 'the marker survives the reload');
  a.now().updatedAt = 200; // an edit made during the upload
  answer(); assert.equal(await first, true);
  assert.equal(k.queued(), 0, 'delivered');
  assert.equal(a.now().filedAt, 100, 'an edit made during upload is still eligible for filing');
  const w = writes, again = a.leave();
  assert.equal(writes, w + 1, 'the edited version is queued');
  assert.equal(a.now().filedAt, 200);
  answer(); await again;
  clearTimeout(toastEl.timer);
});
