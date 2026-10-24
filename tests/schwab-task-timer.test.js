// Exercise the real task-screen action without a browser. Do not duplicate its clock logic here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('task Stop before Start writes nothing; normal and overnight work still count', async () => {
  const { normTask, worked } = await import('../docs/schwab/shared.mjs');
  const source = fs.readFileSync(path.join(__dirname, '../docs/schwab/tasks.html'), 'utf8');
  const action = source.match(/async function act\(a, el\) \{[\s\S]*?\r?\n\}\r?\n\r?\ndocument\.addEventListener\('click'/);
  assert.ok(action, 'find the actual task action');
  const task = normTask({ uid: 'timer-test', origin: 'link', date: '2026-10-19', size: 3 });
  let time = '09:00', saves = 0, blocked = '';
  const context = vm.createContext({
    jobsAct: () => false, jobScope: { status: () => blocked },
    current: () => task, nowHM: () => time,
    persist: () => { saves++; }, render: () => {},
  });
  vm.runInContext(action[0].slice(0, action[0].lastIndexOf('document.addEventListener')) + '\nthis.run = act;', context);
  const tap = key => context.run('clock', { dataset: { v: key } });

  await tap('aStop');
  assert.equal(task.aStop, '', 'an out-of-order Stop must not seed an almost-24-hour task');
  assert.equal(saves, 0, 'the ignored tap does not save or stamp the sheet');
  time = '09:01'; await tap('aStart');
  time = '09:31'; await tap('aStop');
  assert.equal(worked(task), 30);
  assert.equal(saves, 2);
  assert.equal(worked(normTask({ aStart: '22:00', aStop: '06:00' })), 480, 'manual overnight times stay valid');
  blocked = 'legacy_changed'; time = '10:00'; await tap('aStop');
  assert.equal(task.aStop, '09:31', 'a migration pause stops the actual task action');
  assert.equal(saves, 2);
});
