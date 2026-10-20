const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const kind of ['task', 'report']) test(kind + ' PDF stays retryable when queue storage fails, and later edits remain unfiled', async () => {
  const filename = kind === 'task' ? 'tasks.html' : 'report.mjs';
  const source = fs.readFileSync(path.join(__dirname, '../docs/schwab', filename), 'utf8');
  const start = kind === 'task' ? /(?:async )?function fileTask\(t\)/ : /const fileReport = /;
  const chunk = source.slice(source.search(start)).split(/\r?\n\/\/ A (?:finished sheet|sent report)/)[0];
  assert.ok(source.search(start) >= 0, 'find the actual PDF filing caller');
  const settings = { folderUrl: 'configured' };
  const record = { date: '2026-10-19', updatedAt: 100, filedAt: 0 };
  let accept = false, saves = 0, finish;
  const context = vm.createContext({
    S: settings, persist: () => { saves++; }, fileName: () => 'Task 1', record: () => new Uint8Array([1]),
    fileAway: async () => typeof accept === 'boolean' ? accept : new Promise(resolve => { finish = resolve; }),
  });
  vm.runInContext(chunk + '\nthis.run = ' + (kind === 'task' ? 'fileTask' : 'fileReport') + ';', context);
  const file = () => kind === 'task' ? context.run(record) : context.run(settings, record);
  await file();
  assert.equal(record.filedAt, 0, 'a failed queue write must not mark the PDF filed');
  assert.equal(saves, 0, 'the failed attempt does not persist a false filing marker');
  accept = true;
  await file();
  assert.equal(record.filedAt, 100, 'accepted queue entry marks only its captured record version');
  assert.equal(saves, 1);
  accept = 'pending';
  const pending = file();
  record.updatedAt = 200;
  finish(true); await pending;
  assert.equal(record.filedAt, 100, 'an edit made during upload is still eligible for filing');
  const older = file();
  record.updatedAt = 300; record.filedAt = 300;
  finish(true); await older;
  assert.equal(record.filedAt, 300, 'older upload completion cannot move the filing marker backwards');
});
