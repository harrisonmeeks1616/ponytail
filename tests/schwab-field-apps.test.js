#!/usr/bin/env node
// Logic behind the Schwab field apps (docs/schwab): the link codec that carries task sheets
// between phones, the merge that keeps crew check-offs, and the task-sheet to daily-report roll-up.

const test = require('node:test');
const assert = require('node:assert/strict');
const lib = import('../docs/schwab/shared.mjs');

test('links round-trip a task sheet and reject junk', async () => {
  const { pack, unpack, codeFrom } = await lib;
  const data = { v: 1, kind: 'task', task: { id: 'T1003-01', scope: 'Pull 12 AWG ½" EMT, room 3E ✓' } };
  const code = await pack(data);
  assert.match(code, /^[\w-]+$/, 'code must be URL-safe');
  assert.deepEqual(await unpack(code), data);
  assert.equal(codeFrom(`Crew A results https://x.io/tasks.html#p=${code}`), code);
  await assert.rejects(unpack('not-a-real-code'));
  await assert.rejects(unpack(await pack({ v: 2 })), /Not a field app link/);
});

test('shape keeps known fields and types only', async () => {
  const { normTask } = await lib;
  const t = normTask(JSON.parse('{"__proto__":{"evil":1},"id":"T1","size":"9","items":[{"text":"a","done":"yes"}],"extra":1}'));
  assert.equal(t.id, 'T1');
  assert.equal(t.size, 0, 'wrong type falls back to the default');
  assert.equal(t.items[0].done, false);
  assert.equal(t.extra, undefined);
  assert.equal({}.evil, undefined);
  assert.equal(Object.getPrototypeOf(t), Object.prototype);
});

test('time math handles overnight shifts', async () => {
  const { span, t12, fmtMin } = await lib;
  assert.equal(span('07:00', '15:30'), 510);
  assert.equal(span('22:00', '02:00'), 240);
  assert.equal(span('', '02:00'), 0);
  assert.equal(t12('00:05'), '12:05 AM');
  assert.equal(t12('13:30'), '1:30 PM');
  assert.equal(fmtMin(125), '2h 5m');
});

test('crew results merge without losing either side', async () => {
  const { normTask, mergeTask } = await lib;
  const mine = normTask({ uid: 'u', scope: 'super edit after sending', items: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] });
  const crew = normTask({ uid: 'u', scope: 'old', status: 'Partial', delay: 30, items: [{ id: 'a', text: 'A', done: true, at: 5 }] });
  mergeTask(mine, crew, 'crew');
  assert.equal(mine.scope, 'super edit after sending');
  assert.equal(mine.status, 'Partial');
  assert.equal(mine.delay, 30);
  assert.deepEqual(mine.items.map(i => i.done), [true, false]);

  // Re-sent sheet on the crew phone: new step appears, earlier check-off survives.
  const resent = normTask({ uid: 'u', scope: 'new scope', items: [{ id: 'a', text: 'A' }, { id: 'c', text: 'C' }] });
  mergeTask(crew, resent, 'assign');
  assert.equal(crew.scope, 'new scope');
  assert.deepEqual(crew.items.map(i => [i.id, i.done]), [['a', true], ['c', false]]);
  assert.equal(crew.status, 'Partial');
});

test('PM answers and superintendent edits both survive the round trip', async () => {
  const { normReport, mergeAnswers } = await lib;
  const sup = normReport({ wins: 'added after sending', decisions: [{ q: 'Saturday OT?' }, { q: 'Reworded question' }] });
  const pm = normReport({ wins: '', pmReview: 'H · 5 PM', decisions: [{ q: 'Saturday OT?', pm: 'Approved' }, { q: 'Original question', pm: 'Discuss', pmNote: 'call me' }] });
  mergeAnswers(sup, pm);
  assert.equal(sup.wins, 'added after sending');
  assert.equal(sup.decisions[0].pm, 'Approved');
  assert.equal(sup.decisions.at(-1).pmNote, 'call me', 'an answer to a reworded question is kept, not dropped');
  assert.equal(sup.pmReview, 'H · 5 PM');
});

test('daily report fills from task sheets without overwriting', async () => {
  const { normTask, normReport, fillFromTasks } = await lib;
  const tasks = [
    { id: 'T1', floor: 'Level 3', crew: 'Crew A', lead: 'Mike', size: 3, members: ['Mike', 'Jose', 'Tre'], area: '3E', aStart: '07:00', aStop: '11:00', status: 'Complete', doneText: 'Pulled L3-14..18', items: [{ id: 'x', done: true }], checks: [{ id: 'y', text: 'Labeling', done: true }] },
    { id: 'T2', floor: 'Level 3', crew: 'Crew A', lead: 'Mike', size: 2, members: ['Mike', 'Jose'], area: '3W', aStart: '12:00', aStop: '15:30', status: 'Blocked', delay: 45, comments: 'No ceiling access', followUp: 'Get lift Monday' },
    { id: 'T3', floor: 'Level 4', crew: 'Crew B', size: 2, pStart: '07:00', pStop: '15:00' },
  ].map(normTask);
  const rep = normReport({ floors: [{ floor: 'Level 3', crews: [{ name: 'Crew A', area: 'typed by super' }, { name: 'Crew B' }] }] });

  assert.equal(fillFromTasks(rep, tasks, ['Crew A', 'Crew B']), 2);
  const a = rep.floors[0].crews[0];
  assert.equal(a.na, false);
  assert.equal(a.area, 'typed by super', 'existing text is kept');
  assert.equal(a.workers, 3);
  assert.equal(a.members, 'Mike, Jose, Tre');
  assert.equal([a.start, a.stop].join('-'), '07:00-15:30');
  assert.match(a.done, /T1 \(Complete\) 1\/1 steps: Pulled/);
  assert.match(a.holdups, /T2: Blocked · 45 min delay · No ceiling access/);
  assert.equal(rep.floors[0].crews[1].na, true, 'crew with no sheets on this floor stays N/A');
  assert.equal(rep.floors[1].floor, 'Level 4');
  assert.equal(rep.floors[1].crews[1].start, '', 'planned times are not billed as worked hours');
  assert.equal(rep.next.length, 1);

  fillFromTasks(rep, tasks, ['Crew A', 'Crew B']);
  assert.equal(rep.next.length, 1, 'follow-ups are not duplicated on a second fill');
});

test('PDFs are well-formed and keep the text', async () => {
  const { makePdf } = await lib;
  const rows = Array.from({ length: 90 }, (_, i) => [`Step ${i}`, `Pulled 12 AWG (L3-${i}) \\ crew’s note`]);
  const pdf = Buffer.from(makePdf('Electrical task sheet', 'Charles Schwab Building', [['Steps', rows], ['Empty', [['x', '']]]], 'Footer')).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4\n') && pdf.endsWith('%%EOF\n'));
  const xref = +/startxref\n(\d+)/.exec(pdf)[1];
  assert.ok(pdf.startsWith('xref', xref), 'startxref points at the xref table');
  const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => +m[1]);
  offsets.forEach((at, i) => assert.ok(pdf.startsWith(`${i + 1} 0 obj`, at), `object ${i + 1} sits where the xref says`));
  for (const [, len, body] of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) assert.equal(body.length, +len);
  assert.ok(+/\/Count (\d+)/.exec(pdf)[1] > 1, 'long sheets flow onto more pages');
  assert.match(pdf, /\(Pulled 12 AWG \\\(L3-7\\\) \\\\ crew\\222s note\) Tj/, 'parens, backslash and smart quote are escaped');
  assert.match(pdf, /\(Nothing recorded\) Tj/);
});

test('finished records wait on the phone until the review folder takes them', async () => {
  const { queue, flush, queued } = await lib;
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } });
  const realFetch = globalThis.fetch, sent = [];
  const answer = reply => async (url, o) => ({ status: 200, json: async () => (sent.push(JSON.parse(o.body)), reply) });
  const s = { folderUrl: 'https://script.google.com/macros/s/x/exec', siteCode: 'sparky' };
  try {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); }; // no signal on the floor
    queue({ date: '2026-10-03', name: 'T1', pdf: 'JVBERi0w' });
    queue({ date: '2026-10-03', name: 'T1', pdf: 'JVBERi0x' }); // a re-save replaces, never duplicates
    assert.deepEqual(await flush(s), { left: 1, error: '' });

    globalThis.fetch = answer({ ok: false, error: 'Wrong site code' });
    assert.deepEqual(await flush(s), { left: 1, error: 'Wrong site code' }, 'a refused upload stays queued');

    globalThis.fetch = answer({ ok: true });
    queue({ date: '2026-10-03', name: 'Daily Report 2026-10-03', pdf: 'JVBERi0y' });
    assert.deepEqual(await flush(s), { left: 0, error: '' });
    assert.equal(queued(), 0);
    assert.deepEqual(sent.slice(-2).map(b => [b.name, b.pdf, b.code]), [['T1', 'JVBERi0x', 'sparky'], ['Daily Report 2026-10-03', 'JVBERi0y', 'sparky']]);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.localStorage;
  }
});
