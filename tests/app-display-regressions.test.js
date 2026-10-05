const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = app => fs.readFileSync(path.join(__dirname, '..', 'docs', app, 'index.html'), 'utf8');

test('report preserves zero task labor through storage and lets manual hours take over', async () => {
  const lib = await import('../docs/schwab/shared.mjs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'schwab', 'report.html'), 'utf8');
  const r = lib.normReport({ date: '2026-10-05' });
  const task = lib.normTask({ id: 'T1', date: r.date, floor: 'Level 1', crew: 'Crew A', size: 2, aStart: '07:00', aStop: '08:00', delay: 60 });
  lib.fillFromTasks(r, [task], ['Crew A']);
  const restored = lib.normReport(JSON.parse(JSON.stringify(r)));
  const c = restored.floors[0].crews[0];
  const hours = vm.runInNewContext(html.match(/^const crewHours = .*$/m)[0] + '\ncrewHours', { span: lib.span });
  assert.equal(hours(c), 0, 'a full-hour delay is zero productive hours, not two crew-hours');
  assert.equal(hours({ start: '07:00', stop: '08:00', workers: 2, labor: 1.5 }), 1.5, 'older saved positive task labor remains readable');
  const outputs = vm.runInNewContext(html.slice(html.indexOf('const OUT ='), html.indexOf('// ---------- routing:')) + '\nOUT', { crewHours: hours, hrs: lib.hrs, fmtMin: lib.fmtMin, span: lib.span });
  assert.equal(outputs.lh(restored, { f: 0, c: 0 }), 'Total labor-hours: 0 (from the task sheets)');

  // Run the page's actual delegated typing handler, including its clearing of task-derived labor.
  let input;
  const displayed = { dataset: { out: 'lh', f: 0, c: 0 }, textContent: '' };
  vm.runInNewContext(html.slice(html.indexOf("document.addEventListener('input'"), html.indexOf("document.addEventListener('change'")), {
    document: { addEventListener: (_, handler) => { input = handler; }, getElementById: () => ({ innerHTML: '' }) },
    app: { querySelectorAll: () => [displayed] }, rep: () => restored, S: {},
    setPath: lib.setPath, getPath: lib.getPath, readInput: lib.readInput,
    persist() {}, summary: () => '', OUT: outputs,
  });
  for (const [field, type, value, expected] of [['workers', 'number', '3', 3], ['stop', 'time', '09:00', 6], ['start', 'time', '08:00', 3]]) {
    lib.fillFromTasks(restored, [task], ['Crew A']);
    input({ target: { dataset: { k: 'r.floors.0.crews.0.' + field }, type, value } });
    assert.equal(hours(c), expected, field + ' edit uses the manually entered work window');
    assert.equal(c.laborFromTasks, false);
    assert.ok(!displayed.textContent.includes('(from the task sheets)'));
  }
});

test('actual calculator output retains change-order cents and three-digit productivity', () => {
  const html = source('electrical-pm-mastery');
  const E = require('../docs/electrical-pm-mastery/plan.js');
  const declarations = ['money', 'num'].map(name => html.match(new RegExp('^  const ' + name + ' = .*$', 'm'))[0]).join('\n');
  const calculators = html.slice(html.indexOf('  const SIZE_OPTS ='), html.indexOf('  const calcVals ='));
  const calcs = vm.runInNewContext(declarations + '\n' + calculators + '\nCALCS', { E, todayISO: () => '2026-10-05' });
  const co = calcs.find(c => c.id === 'co').run({ hours: 12, rate: 100, material: 800, taxPct: 8, equipment: 0, subs: 0, markupPct: 15, subMarkupPct: 0, bondPct: 1 });
  assert.equal(co.find(row => row[0] === 'Bond')[1], '$23.74');
  assert.equal(co.find(row => row[0] === 'Total change order')[1], '$2,397.34');
  const labor = calcs.find(c => c.id === 'labor').run({ budgetHrs: 1000, pct: 40, actualHrs: 520, rate: 95 });
  assert.equal(labor.find(row => row[0] === 'Productivity factor (earned / actual)')[1], '0.769');
  assert.equal(labor.find(row => row[0] === 'Gain or (fade), dollars')[1], '($28,500)', 'other calculators keep their whole-dollar display');
});


test('Copy backup offers manual selection when clipboard is missing, throws, or rejects', async () => {
  const html = source('electrical-pm-mastery');
  const begin = html.indexOf('          exp.value = JSON.stringify(S);');
  const end = html.indexOf("        } }, 'Copy backup'", begin);
  assert.ok(begin >= 0 && end > begin, 'the actual Copy backup handler is present');
  for (const mode of ['absent', 'throw', 'reject', 'copy']) {
    let selections = 0;
    let focused = false;
    let copied;
    const S = { v: 1, done: { 3: true }, notes: { 3: 'Fictional backup regression' } };
    const exp = { value: 'outdated', focus: () => { focused = true; }, select: () => { assert.equal(focused, true); selections++; } };
    const msg = { textContent: '' };
    const navigator = mode === 'absent' ? {} : { clipboard: { writeText: value => {
      copied = value;
      if (mode === 'throw') throw new Error('clipboard unavailable');
      return mode === 'reject' ? Promise.reject(new Error('copy denied')) : Promise.resolve();
    } } };
    const copy = vm.runInNewContext('(function () {\n' + html.slice(begin, end) + '\n})', { S, exp, msg, navigator });
    await copy();
    assert.equal(exp.value, JSON.stringify(S), mode + ' uses the latest backup');
    assert.equal(selections, mode === 'copy' ? 0 : 1, mode + ' leaves backup text selectable');
    assert.equal(focused, mode !== 'copy', mode + ' focuses only the manual-copy fallback');
    assert.equal(msg.textContent, mode === 'copy' ? 'Backup copied.' : 'Copy blocked here. The text is selected; copy it manually.');
    if (mode !== 'absent') assert.equal(copied, JSON.stringify(S));
  }
});
