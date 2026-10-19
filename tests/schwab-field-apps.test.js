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

    // Every upload says which edit it is, so the folder keeps the newest.
    queue({ date: '2026-10-03', name: 'T2', pdf: 'JVBERi0z', v: 7 });
    await flush(s);
    assert.equal(sent.at(-1).v, 7);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.localStorage;
  }
});

test('review uploads reject other destinations without sending PDF data or the code', async () => {
  const { queue, flush } = await lib;
  const store = new Map(), sent = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, o) => { sent.push([url, JSON.parse(o.body)]); return { status: 200, json: async () => ({ ok: true }) }; };
  try {
    queue({ date: '2026-10-04', name: 'Fictional test', pdf: 'JVBERi0=' });
    for (const folderUrl of ['https://example.invalid/exec', 'https://script.google.com.evil.invalid/macros/s/x/exec', 'https://script.google.com@evil.invalid/macros/s/x/exec', 'https://script.google.com/macros/s/x/dev', 'https://script.google.com/macros/s/x/exec?redirect=elsewhere']) {
      const r = await flush({ folderUrl, siteCode: 'fictional-code' });
      assert.equal(r.left, 1);
      assert.match(r.error, /Apps Script/);
    }
    assert.equal(sent.length, 0);
    assert.equal((await flush({ folderUrl: ' https://script.google.com/macros/s/x/exec ', siteCode: 'fictional-code' })).left, 0);
    assert.equal(sent[0][0], 'https://script.google.com/macros/s/x/exec');
  } finally { globalThis.fetch = realFetch; delete globalThis.localStorage; }
});

test('a newer queued PDF survives completion of an older upload', async () => {
  const { queue, flush } = await lib;
  const store = new Map(), sent = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } });
  const realFetch = globalThis.fetch, s = { folderUrl: 'https://script.google.com/macros/s/x/exec', siteCode: 'fictional-code' };
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  globalThis.fetch = async (url, o) => {
    sent.push(JSON.parse(o.body));
    started();
    await new Promise(resolve => { release = resolve; });
    return { status: 200, json: async () => ({ ok: true }) };
  };
  try {
    queue({ date: '2026-10-04', name: 'Fictional test', pdf: 'older', v: 1 });
    const uploading = flush(s);
    await began;
    queue({ date: '2026-10-04', name: 'Fictional test', pdf: 'newer', v: 2 });
    release();
    assert.deepEqual(await uploading, { left: 1, error: '' });
    globalThis.fetch = async (url, o) => { sent.push(JSON.parse(o.body)); return { status: 200, json: async () => ({ ok: true }) }; };
    assert.equal((await flush(s)).left, 0);
    assert.deepEqual(sent.map(x => x.pdf), ['older', 'newer']);
  } finally { globalThis.fetch = realFetch; delete globalThis.localStorage; }
});

test('Spanish mode has a Spanish version of every on-screen phrase', async () => {
  const fs = require('fs');
  const path = require('path');
  const ES = (await import('../docs/schwab/es.mjs')).default;
  const dir = path.join(__dirname, '..', 'docs', 'schwab');
  const used = new Set(['Complete', 'Partial', 'Blocked', 'Accepted', 'Follow-up needed', 'Superintendent', 'Project manager', 'Crew lead', '1 person', '{n} people']); // looked up from data, not literals
  for (const f of ['tasks.html', 'shared.mjs', 'report.mjs', 'sync.mjs', 'live.mjs']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/\b(?:L|x)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g)) used.add(m[2].replace(/\\(.)/g, '$1'));
  }
  const holes = s => (s.match(/\{\w+\}/g) || []).sort().join(' ');
  for (const en of used) {
    assert.ok(Object.hasOwn(ES, en), `missing Spanish for: ${en}`);
    assert.equal(holes(ES[en]), holes(en), `placeholders differ in: ${en}`);
  }
  for (const en of Object.keys(ES)) assert.ok(used.has(en), `Spanish entry no longer used: ${en}`);
});

test('Spanish labels, safe placeholders, and notes printed as typed', async () => {
  const { L, setLang, makePdf, normTask, mergeTask } = await lib;
  assert.equal(L('Task {id}', { id: 'T1' }, 'es'), 'Tarea T1');
  assert.equal(L('Task {id}', { id: '$& pay' }, 'en'), 'Task $& pay', 'typed text is inserted literally');
  setLang('es');
  assert.equal(L('Status'), 'Estado');
  setLang('en');
  assert.equal(L('Status'), 'Status');

  // The PDF is an English form; a note typed in Spanish prints as typed, accents included.
  const pdf = Buffer.from(makePdf('Electrical task sheet', 'Site', [['4 Crew comments / concerns', [['Comments', 'Señal débil en el sótano']]]], 'Site')).toString('latin1');
  assert.match(pdf, /\(Comments\) Tj/);
  assert.match(pdf, /Se\\361al d\\351bil en el s\\363tano/);
  assert.match(pdf, /Page 1 of 1\) Tj/);

  const office = normTask({ uid: 'u', items: [] }), crew = normTask({ uid: 'u', status: 'Partial', cLang: 'es', items: [] });
  assert.equal(mergeTask(office, crew, 'crew').cLang, 'es', 'the crew language travels with the results');
});

test('upload queue: newer edits survive, refusals cannot block or flood, dead records clear', async () => {
  const { queue, flush, queued } = await lib;
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } });
  const realFetch = globalThis.fetch, sent = [];
  const s = { folderUrl: 'https://script.google.com/macros/s/x/exec', siteCode: 'sparky' };
  const answer = decide => async (url, o) => {
    const b = JSON.parse(o.body);
    sent.push(b.pdf);
    return { status: 200, json: async () => decide(b) };
  };
  try {
    // The superintendent edits a sheet while an earlier upload is running.
    queue({ date: '2026-10-03', name: 'A', pdf: 'a' });
    queue({ date: '2026-10-03', name: 'T1', pdf: 'old', v: 1 });
    globalThis.fetch = answer(b => {
      if (b.pdf === 'a') queue({ date: '2026-10-03', name: 'T1', pdf: 'new', v: 2 });
      return { ok: true };
    });
    assert.equal((await flush(s)).left, 1, 'the newer copy is still waiting');
    assert.deepEqual(sent, ['a'], 'the replaced copy is never sent');
    await flush(s);
    assert.deepEqual(sent, ['a', 'new']);
    assert.equal(queued(), 0);

    // A refused record goes to the back of the line: the next try sends what is behind it.
    sent.length = 0;
    queue({ date: '2026-10-04', name: 'Bad', pdf: 'bad' });
    queue({ date: '2026-10-04', name: 'Good', pdf: 'good' });
    globalThis.fetch = answer(b => (b.pdf === 'bad' ? { ok: false, error: 'Not a field app PDF' } : { ok: true }));
    assert.deepEqual(await flush(s), { left: 2, error: 'Not a field app PDF' }, 'one refused post per try, not one per record');
    assert.deepEqual(await flush(s), { left: 1, error: 'Not a field app PDF' });
    assert.deepEqual(sent, ['bad', 'good', 'bad']);

    // A record saved with a blank date before the fix can never upload; it is dropped, not retried forever.
    store.set('schwab.outbox', JSON.stringify([{ date: '', name: 'T9', pdf: 'x' }, ...JSON.parse(store.get('schwab.outbox'))]));
    assert.equal(queued(), 1);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.localStorage;
  }
});

test('a crafted link cannot inject markup, crash a report, or hide a sheet', async () => {
  const { normTask, normReport, today } = await lib;
  const evil = '"><img src=x onerror=alert(1)>';
  const before = today();
  const t = normTask({ uid: evil, date: evil, pStart: evil, aStart: evil, aStop: '07:30', checkIn: '7:05', pStop: '99:99', filedAt: 5 });
  const after = today();
  assert.equal(t.uid, '');
  assert.deepEqual([t.pStart, t.aStart, t.aStop, t.checkIn, t.pStop], ['', '', '07:30', '', ''], 'only real HH:MM times survive');
  assert.ok([before, after].includes(t.date), 'a sheet with no usable date lands on today instead of vanishing');
  assert.equal(t.filedAt, 0, 'a re-dated sheet is filed again under its new date');
  const ok = normTask({ uid: 'mfq1a2b3c', date: '2026-10-03', filedAt: 5 });
  assert.deepEqual([ok.uid, ok.date, ok.filedAt], ['mfq1a2b3c', '2026-10-03', 5]);
  // A sheet saved with a cleared or impossible date comes back on the day it was last edited.
  const edited = new Date(2026, 9, 2, 15).getTime();
  assert.equal(normTask({ uid: 'u', date: '', updatedAt: edited }).date, '2026-10-02');
  assert.equal(normTask({ uid: 'u', date: '2026-02-30', updatedAt: edited }).date, '2026-10-02');
  assert.match(normTask({ uid: 'u', date: '', updatedAt: 1e15 }).date, /^\d{4}-\d{2}-\d{2}$/, 'a wild edit time still gives a real day');

  assert.equal(normReport({ status: '<b>Done</b>' }).status, '', 'an unknown status is dropped, not rendered');
  assert.equal(normReport({ status: 'At risk' }).status, 'At risk');
});

test('a crew on several floors is billed its sheets once, and a later fill widens the work window', async () => {
  const { normTask, normReport, fillFromTasks } = await lib;
  const sheet = (id, floor, aStart, aStop, delay = 0) => normTask({ id, floor, crew: 'Crew A', size: 2, aStart, aStop, delay });
  const tasks = [sheet('T1', 'Level 3', '07:00', '09:00'), sheet('T2', 'Level 4', '09:00', '12:00', 30), sheet('T3', 'Level 3', '13:00', '15:00')];
  const rep = normReport({});
  fillFromTasks(rep, tasks, ['Crew A']);
  const [l3, l4] = rep.floors.map(f => f.crews[0]);
  assert.equal([l3.start, l3.stop].join('-'), '07:00-15:00');
  assert.equal(l3.labor, 8, '2 + 2 hours worked by 2 people, not 07:00 to 15:00 by 2');
  assert.equal(l4.labor, 5, 'delays are not billed');

  l3.start = '06:30'; // typed by the superintendent
  tasks.push(sheet('T4', 'Level 3', '15:00', '16:30'));
  fillFromTasks(rep, tasks, ['Crew A']);
  assert.equal([l3.start, l3.stop].join('-'), '06:30-16:30', 'a later fill only widens the window');
  assert.equal(l3.labor, 11);
});

test('merges keep the send and result stamps an older link is checked against', async () => {
  const { normTask, mergeTask } = await lib;
  const crew = normTask({ uid: 'u', sentAt: 1, scope: 'first' });
  mergeTask(crew, normTask({ uid: 'u', sentAt: 2, scope: 'resent' }), 'assign');
  assert.equal(crew.sentAt, 2, 'reopening the first text is then seen as older');
  const office = normTask({ uid: 'u', sentAt: 2 });
  mergeTask(office, normTask({ uid: 'u', sentAt: 2, status: 'Partial', resultAt: 9 }), 'crew');
  assert.equal(office.resultAt, 9);
});

test('a restored file with the wrong shape cannot crash the apps', async () => {
  const { load, KEYS } = await lib;
  const store = new Map([[KEYS.tasks, '{"not":"a list"}'], [KEYS.settings, '{"me":"H"}']]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } });
  try {
    assert.deepEqual(load(KEYS.tasks, []), []);
    assert.deepEqual(load(KEYS.settings, null), { me: 'H' });
  } finally { delete globalThis.localStorage; }
});

test('a short crafted link cannot expand into a huge list or carry an impossible report date', async () => {
  const { normTask, normReport } = await lib;
  assert.equal(normTask({ items: Array(1e5).fill({}) }).items.length, 500);
  assert.equal(normReport({ date: '2026-02-30' }).date, '', 'the review folder would refuse it forever');
  assert.equal(normReport({ date: '2026-02-28' }).date, '2026-02-28');
});

test('office passcode: stored hashed, a 12-hour sign-in, a wait after 5 wrong codes, links only fill a missing code', async () => {
  const { pinHash, tryPin, unlocked, signOut, waitLeft, adoptPin, PIN_FORMAT } = await lib;
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } });
  try {
    const office = { pin: await pinHash('4821') };
    assert.match(office.pin, PIN_FORMAT);
    assert.ok(!office.pin.includes('4821'), 'never kept as typed');
    assert.notEqual(await pinHash('4821'), office.pin, 'salted, so the same code hashes differently on each phone');
    const t0 = 1.8e12;
    assert.equal(await tryPin(office, '4821', t0), 'ok');
    assert.ok(unlocked(t0 + 11 * 36e5) && !unlocked(t0 + 13 * 36e5), 'signed in for a work shift, then locked again');
    signOut();
    assert.equal(unlocked(t0), false);
    for (let i = 1; i < 5; i++) assert.equal(await tryPin(office, '0000', t0), 'wrong');
    assert.equal(await tryPin(office, '0000', t0), 'wait', 'the fifth wrong code starts the wait');
    assert.equal(await tryPin(office, '4821', t0 + 30e3), 'wait', 'even the right code waits it out');
    assert.equal(waitLeft(t0 + 30e3), 30e3);
    assert.equal(await tryPin(office, '4821', t0 + 61e3), 'ok');
    assert.equal(await tryPin({ pin: 'tampered' }, '0000', t0 + 62e3), 'wrong', 'a damaged stored code opens nothing');

    const crew = { pin: '' };
    assert.equal(adoptPin(crew, 'not-a-code'), false);
    assert.equal(adoptPin(crew, office.pin), true, 'the first sheet teaches a crew phone the office code');
    assert.equal(crew.pin, office.pin);
    assert.equal(adoptPin(crew, await pinHash('1111')), false, 'a later link never replaces it');
    assert.equal(crew.pin, office.pin);
  } finally { delete globalThis.localStorage; }
});

test('time clock: only real shifts are kept, weeks run Monday to Sunday, overnight shifts count', async () => {
  const { normShift } = await lib;
  const { shiftMin, monday, byPerson } = await import('../docs/schwab/report.mjs');
  const ok = { id: 'k1abc', device: 'dev1', who: '  José L ', date: '2026-10-14', in: '07:00', out: '15:45' };
  assert.deepEqual(normShift(ok), { ...ok, who: 'José L', pid: '', crew: '', crewId: '', tasks: [], edited: { who: false, in: false, out: false }, gone: false, at: 0 });
  for (const bad of [{ ...ok, id: '<b>' }, { ...ok, date: '2026-02-30' }, { ...ok, in: '7:5' }, 'junk', null]) assert.equal(normShift(bad), null, 'not loggable: ' + JSON.stringify(bad));
  assert.equal(normShift({ ...ok, out: '"><script>' }).out, '', 'a bad clock-out is dropped, the shift stays open');
  assert.equal(normShift({ ...ok, device: 'x y' }).device, '');
  assert.equal(shiftMin(normShift(ok)), 525);
  assert.equal(shiftMin({ date: '2026-10-14', in: '22:00', out: '06:30' }), 510, 'a night shift');
  assert.equal(shiftMin({ date: '2026-10-14', in: '07:00', out: '' }), 0, 'still on the clock');
  const tz = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    assert.equal(shiftMin({ date: '2026-10-31', in: '22:00', out: '06:00' }), 540, 'the night clocks fall back: 9 real hours');
    assert.equal(shiftMin({ date: '2026-03-07', in: '22:00', out: '06:00' }), 420, 'the night clocks spring forward: 7 real hours');
  } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
  assert.deepEqual(['2026-10-12', '2026-10-14', '2026-10-18', '2026-10-19', '2026-03-08'].map(monday), ['2026-10-12', '2026-10-12', '2026-10-12', '2026-10-19', '2026-03-02'], 'Sunday ends the week, across a clock change too');
  const people = byPerson([normShift(ok), normShift({ ...ok, id: 'k2', who: 'josé l', date: '2026-10-15', in: '06:30', out: '15:00' }), normShift({ ...ok, id: 'k3', who: 'Ana P' })]);
  assert.deepEqual(people.map(p => [p.who, p.shifts.length, p.hours]), [['Ana P', 1, 875], ['José L', 2, 1725]], 'one timesheet per person, any capitalization, in hundredths of an hour');
  const thirds = byPerson(['a', 'b', 'c'].map(id => normShift({ ...ok, id, in: '07:00', out: '14:20' })));
  assert.equal(thirds[0].hours, 3 * 733, 'three 7.33 hr shifts total 21.99, so the rows add up to the total');
});

test('time clock: worker links add and complete shifts, but never undo the PM', async () => {
  const { normShift } = await lib;
  const { importShifts } = await import('../docs/schwab/report.mjs');
  const shift = (id, set = {}) => normShift({ id, device: 'dana1', who: 'Dana R', date: '2026-10-14', in: '07:00', ...set });
  const log = [];
  assert.deepEqual(importShifts(log, [shift('a')], 1), { added: 1, updated: 0, skipped: 0 }, 'clock-in text');
  const out = [shift('a', { out: '15:30' }), shift('b', { date: '2026-10-15', in: '06:45' })];
  assert.deepEqual(importShifts(log, out, 2), { added: 1, updated: 1, skipped: 0 }, 'the clock-out text completes it and brings the next day');
  assert.deepEqual(importShifts(log, out, 2), { added: 0, updated: 0, skipped: 0 }, 'the same text again changes nothing');
  assert.deepEqual(importShifts(log, [shift('a', { who: 'Dana Typo' })], 1), { added: 0, updated: 0, skipped: 0 }, 'an older text opened late keeps the clock-out and the newer name');
  importShifts(log, [shift('a', { out: '15:30', who: 'Dana Ruiz' })], 3);
  assert.equal(log[0].who, 'Dana Ruiz', 'a name fixed in a newer text follows');
  Object.assign(log[0], { out: '15:00', edited: { who: false, in: false, out: true } }); // the PM fixes the out time
  log[1].gone = true; // and removes the second shift
  importShifts(log, [shift('a', { out: '15:30' }), shift('b', { out: '14:00' })], 4);
  assert.deepEqual(log.map(s => [s.who, s.out, s.gone]), [['Dana R', '15:00', false], ['Dana R', '', true]], "the PM's time and removal stick");
  log[0].edited.who = true; log[0].who = 'Dana Ruiz'; // the PM renames
  importShifts(log, [shift('a')], 5);
  assert.equal(log[0].who, 'Dana Ruiz', "the PM's rename sticks too");
  assert.deepEqual(importShifts(log, [shift('a', { device: 'other', out: '23:00' }), shift('c', { device: '' })], 6), { added: 0, updated: 0, skipped: 0 }, "a link can't touch another phone's shift or add one with no phone");
  importShifts(log, [{ ...shift('d'), edited: { who: true, in: true, out: true }, gone: true }], 6);
  assert.deepEqual([log.at(-1).edited, log.at(-1).gone], [{ who: false, in: false, out: false }, false], 'a link cannot mark its own shifts as the PM\'s');
  const byHand = [normShift({ id: 'pm1', who: 'ana p', date: '2026-10-12', in: '07:00', out: '15:30', edited: { who: true, in: true, out: true } })];
  assert.deepEqual(importShifts(byHand, [shift('e', { who: 'Ana P', date: '2026-10-12', out: '15:35' }), shift('f', { who: 'Ana P', date: '2026-10-13', out: '15:00' })], 7), { added: 1, updated: 0, skipped: 1 }, 'a day the PM added by hand is not doubled by the late text');
  assert.deepEqual(byHand.map(s => [s.date, s.gone]), [['2026-10-12', false], ['2026-10-12', true], ['2026-10-13', false]]);
});

test('time clock: the accountant spreadsheet totals each week and cannot run formulas', async () => {
  const { normShift } = await lib;
  const { byPerson, timesheetCsv } = await import('../docs/schwab/report.mjs');
  const s = (id, who, date, inn, out, edited, more) => normShift({ id, device: 'd1', who, date, in: inn, out, edited: { in: false, out: !!edited }, ...more });
  const csv = timesheetCsv(byPerson([s('a', 'Dana R', '2026-10-12', '07:00', '15:45', false, { crew: 'Crew A', tasks: ['T1012-01', 'T1012-02'] }), s('b', 'Dana R', '2026-10-13', '22:00', '06:30', true),
    s('c', '=HYPERLINK("x")', '2026-10-13', '07:00', '', false, { crew: '@SUM(A1)', tasks: ['-1'] })]));
  const rows = csv.trim().split('\r\n');
  assert.equal(rows[0], 'Name,Crew,Date,Day,Clock in,Clock out,Hours,Tasks,Note');
  assert.ok(rows.includes('"\'=HYPERLINK(""x"")",\'@SUM(A1),2026-10-13,Tue,7:00 AM,,,\'-1,No clock-out'), 'a typed formula stays text in the name, the crew and the tasks; an open shift is flagged');
  assert.ok(rows.includes('Dana R,Crew A,2026-10-12,Mon,7:00 AM,3:45 PM,8.75,T1012-01; T1012-02,') && rows.includes('Dana R,Crew A,2026-10-13,Tue,10:00 PM,6:30 AM,8.50,,Edited by PM'),
    "each shift's crew (the person's when the shift names none) and task ids");
  assert.ok(rows.includes('Dana R,Crew A,,,,Week total,17.25,,') && rows.at(-1) === 'All crew,,,,,Week total,17.25,,', 'person and crew totals, to two decimals');
});

test('people: one roster in Settings, names matched however typed', async () => {
  const { nameKey, normSettings, people, findPerson, addPerson } = await lib;
  assert.equal(nameKey('  José   L '), 'jose l');
  assert.equal(nameKey('JOSÉ L'), nameKey('jose\tl'), 'case, accents and any spacing');
  assert.equal(nameKey('Zoë Ñúñez'), 'zoe nunez');
  assert.equal(nameKey('Lopez, Jose'), 'lopez jose', 'a comma counts as a space');
  assert.equal(nameKey('Mike O’Neil'), nameKey("Mike O'Neil"), "an iPhone's curly apostrophe is an Android's straight one");
  assert.equal(nameKey('José L.'), nameKey('Jose L'), 'so is a period');
  assert.equal(nameKey('Hernández-Ruiz'), nameKey('hernandez ruiz'), 'and a hyphen');
  for (const empty of ['', '   ', null, undefined, '\u0301']) assert.equal(nameKey(empty), '');
  const S = normSettings({ crews: [{ name: 'Crew A', lead: '', members: 'José L, Luis M' }, { name: 'Crew B', lead: '', members: 'Ana P,  jose l ,' }, { name: 'Crew C', lead: '', members: '' }] });
  const [A, B, C] = S.crews;
  assert.deepEqual(people(S).map(p => [p.name, p.crew]), [['José L', 'Crew A'], ['Luis M', 'Crew A'], ['Ana P', 'Crew B']], 'a name on two crew lists from before ids is one person, on the first');
  assert.ok(people(S).every(p => /^[\w-]{1,40}$/.test(p.id) && S.crews.some(c => c.id === p.crewId)));
  assert.deepEqual([findPerson(S, 'JOSE  l').name, findPerson(S, 'JOSE  l').crewId], ['José L', A.id]);
  for (const nobody of ['', '  ', null, 'Ray K', 'José', '.,']) assert.equal(findPerson(S, nobody), undefined, 'no match for ' + nobody);
  assert.equal(findPerson(S, 'José L.').name, 'José L', 'punctuation does not make a second person');
  assert.equal(addPerson(S, '  ', C.id), undefined, 'no name, no person');
  assert.equal(addPerson(S, '  Ray   K ', C.id).name, 'Ray K');
  assert.equal(C.members, 'Ray K', "a crew's member list follows the roster, for older versions");
  assert.equal(addPerson(S, 'Kim, T', A.id).name, 'Kim T');
  assert.equal(A.members, 'José L, Luis M, Kim T', 'the list keeps its "A, B" form; a comma cannot split a name in two');
  assert.equal(addPerson(S, 'Lee W', 'no-such-crew').crewId, '', 'an unknown crew: on the roster, on no crew');
  assert.equal(addPerson(S, 'x'.repeat(200), C.id).name.length, 60, 'a name is kept to 60 characters, like the time clock');
  assert.equal(B.members, 'Ana P');
});

test('people: settings from before ids migrate the same way on every phone, on reload and after an old tab saves', async () => {
  const { normSettings, loadSettings, people, KEYS } = await lib;
  const old = { me: 'Dana', crews: [{ name: 'Crew A', lead: 'Mike R', members: 'José L, Luis M, José  L.' }, { name: 'Crew B', lead: '', members: 'Ana P, jose l, Zoë Ñúñez' }] };
  const a = normSettings(structuredClone(old)), b = normSettings(structuredClone(old));
  assert.deepEqual(people(a).map(p => [p.name, p.crew]), [['José L', 'Crew A'], ['Luis M', 'Crew A'], ['Ana P', 'Crew B'], ['Zoë Ñúñez', 'Crew B']], 'one person per name, accents and all');
  const ids = [...a.crews, ...a.people].map(x => x.id);
  assert.ok(ids.every(id => /^[\w-]{1,40}$/.test(id)) && new Set(ids).size === ids.length, 'every crew and person has its own id');
  assert.deepEqual([a.crews, a.people], [b.crews, b.people], 'two phones migrating the same lists agree on the ids');
  assert.deepEqual(a.crews.map(c => [c.name, c.lead, c.members]), [['Crew A', 'Mike R', 'José L, Luis M'], ['Crew B', '', 'Ana P, Zoë Ñúñez']]);
  const store = new Map([[KEYS.settings, JSON.stringify(a)]]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } });
  try {
    assert.deepEqual(loadSettings().people, a.people, 'a reload keeps the ids');
    const oldTab = JSON.parse(store.get(KEYS.settings));
    delete oldTab.people; oldTab.crews = oldTab.crews.map(({ id, ...c }) => c); // the old version's save drops both
    store.set(KEYS.settings, JSON.stringify(oldTab));
    const again = loadSettings();
    assert.deepEqual([again.crews, again.people], [a.crews, a.people], 'and so does a tab still running the old version');
  } finally { delete globalThis.localStorage; }
  const bad = normSettings({ crews: [{ id: 'c1', name: 'A' }, { id: 'c1', name: 'B' }, { id: '<b>', name: 'C' }],
    people: [{ id: 'p1', name: 'X', crewId: 'nope' }, { id: 'p1', name: 'Y', crewId: 'c1' }, { id: 'p3', name: ' , ', crewId: 'c1' }, { id: 'p4', name: 'X', crewId: 'c1' }] });
  const cids = bad.crews.map(c => c.id);
  assert.ok(new Set(cids).size === 3 && cids.every(id => /^[\w-]+$/.test(id)) && cids[0] === 'c1', 'a crafted copy: duplicate and bad crew ids are replaced');
  assert.deepEqual(bad.people.map(p => [p.name, p.crewId]), [['X', ''], ['Y', 'c1'], ['X', 'c1']], 'unknown crews cleared, a blank name dropped, two people named X kept');
  assert.equal(new Set(bad.people.map(p => p.id)).size, 3);
});

test('people: two people with one name stay two on sheets, the time clock and the timesheet', async () => {
  const { normSettings, addPerson, findPerson, people, normTask, normShift, assignmentFor } = await lib;
  const { byPerson, importShifts } = await import('../docs/schwab/report.mjs');
  const S = normSettings({ crews: [{ name: 'Crew A', members: 'Jose L' }, { name: 'Crew B', members: '' }] });
  const [A, B] = S.crews, j1 = findPerson(S, 'Jose L'), j2 = addPerson(S, 'Jose L', B.id);
  assert.notEqual(j1.id, j2.id);
  assert.deepEqual(people(S).map(p => [p.name, p.crew]), [['Jose L', 'Crew A'], ['Jose L', 'Crew B']]);
  assert.equal(findPerson(S, 'jose l', B.id).id, j2.id, 'among people sharing a name, the one on the given crew');
  assert.equal(findPerson(S, 'jose l').id, j1.id, 'else the first on the roster');
  const day = '2026-10-14';
  const sA = normTask({ uid: 'sa', id: 'T1014-01', date: day, crew: 'Crew A', crewId: A.id, members: ['Jose L'], memberIds: [j1.id] });
  const sB = normTask({ uid: 'sb', id: 'T1014-02', date: day, crew: 'Crew B', crewId: B.id, members: ['Jose L'], memberIds: [j2.id] });
  assert.deepEqual(assignmentFor([sA, sB], 'Jose L', day, j1.id), { crew: 'Crew A', crewId: A.id, tasks: [{ uid: 'sa', id: 'T1014-01' }], sheets: [sA] });
  assert.deepEqual(assignmentFor([sA, sB], 'Jose L', day, j2.id).tasks, [{ uid: 'sb', id: 'T1014-02' }], 'each finds only their own sheet');
  assert.equal(assignmentFor([sA, sB], 'Jose L', day).tasks.length, 2, 'a phone that cannot tell them apart matches the name');
  const sh = (id, pid, crew, crewId, inn = '07:00', out = '15:00') => normShift({ id, device: 'dev' + id, who: 'Jose L', pid, crew, crewId, date: day, in: inn, out });
  const ps = byPerson([sh('a', j1.id, 'Crew A', A.id), sh('b', j2.id, 'Crew B', B.id, '06:00', '14:30')], 'en', S);
  assert.deepEqual(ps.map(p => [p.who, p.crew, p.hours, p.pid]), [['Jose L', 'Crew A', 800, j1.id], ['Jose L', 'Crew B', 850, j2.id]], 'two timesheets, each with its crew next to the name');
  assert.notEqual(ps[0].key, ps[1].key, "each card's buttons act on its own person");
  assert.equal(byPerson([sh('c', '', 'Crew B', '')], 'en', S)[0].pid, j2.id, 'a text from a phone with no roster lands by the crew its sheets named');
  const log = [normShift({ id: 'pm1', who: 'Jose L', pid: j1.id, date: day, in: '07:00', out: '15:00', edited: { who: true, in: true, out: true } })];
  assert.deepEqual(importShifts(log, [sh('d', j2.id, 'Crew B', B.id)], 1), { added: 1, updated: 0, skipped: 0 }, "a day the PM added for one is not the other's");
  assert.deepEqual(importShifts(log, [sh('e', j1.id, 'Crew A', A.id)], 1), { added: 0, updated: 0, skipped: 1 }, 'but it is still the same day for the same person');
});

test('renaming a person or a crew keeps the id, so sheets and hours stay with them', async () => {
  const { normSettings, findPerson, personById, crewById, renamePerson, renameCrew, normTask, normShift, assignmentFor } = await lib;
  const { byPerson, attachPeople, personKey } = await import('../docs/schwab/report.mjs');
  const S = normSettings({ crews: [{ name: 'Crew A', members: 'Jose L, Ana P' }] });
  const [A] = S.crews, id = findPerson(S, 'Jose L').id, day = '2026-10-14';
  const sheet = normTask({ uid: 's1', id: 'T1014-01', date: day, crew: 'Crew A', crewId: A.id, members: ['Jose L'], memberIds: [id] });
  const shifts = [normShift({ id: 'a', device: 'd1', who: 'Jose L', pid: id, crew: 'Crew A', crewId: A.id, date: day, in: '07:00', out: '15:00' }),
    normShift({ id: 'b', device: 'd1', who: 'jose l', date: '2026-10-13', in: '07:00', out: '11:00' })]; // from before ids: a name, no person
  assert.equal(attachPeople(S, shifts), 1, 'the shift from before ids takes the person its name is, once');
  assert.equal(shifts[1].pid, id);
  assert.equal(renamePerson(S, id, '  José   López '), true);
  assert.equal(renamePerson(S, id, ' , '), false, 'punctuation alone is no name');
  assert.equal(renameCrew(S, A.id, 'Electricians'), true);
  assert.deepEqual([personById(S, id).name, personById(S, id).crew, crewById(S, A.id).name, A.members], ['José López', 'Electricians', 'Electricians', 'José López, Ana P']);
  assert.deepEqual(assignmentFor([sheet], 'José López', day, id).tasks, [{ uid: 's1', id: 'T1014-01' }], 'the sheet, made under the old name, still lists them');
  assert.deepEqual(assignmentFor([sheet], 'José López', day, id).sheets[0].members, ['Jose L'], 'and keeps the name it was made with');
  const ps = byPerson(shifts, 'en', S);
  assert.deepEqual(ps.map(p => [p.who, p.crew, p.shifts.length, p.hours]), [['José López', 'Electricians', 2, 1200]], "one timesheet under the current names, the week's hours together");
  assert.ok(shifts.every(s => personKey(S, s) === id));
  assert.deepEqual(shifts.map(s => s.who), ['Jose L', 'jose l'], 'each shift keeps the label it was made with');
});

test('two office phones numbered sheets offline: every shift still points at its own sheet', async () => {
  const { normTask, normShift, assignmentFor, renumberClashes, sameNumber } = await lib;
  const { importShifts } = await import('../docs/schwab/report.mjs');
  const day = '2026-10-19';
  // Phones A and B each made a T1019-02 with no signal and texted it to their crews.
  const a = normTask({ uid: 'phoneA-2', origin: 'mine', id: 'T1019-02', date: day, crew: 'Crew A', members: ['Mike R'], memberIds: ['pmike'], sentAt: 5 });
  const b = normTask({ uid: 'phoneB-2', origin: 'mine', id: 'T1019-02', date: day, crew: 'Crew B', members: ['Ana P'], memberIds: ['pana'], sentAt: 6 });
  const clockIn = (id, who, pid, sheets) => normShift({ id, device: 'd' + id, who, pid, date: day, in: '07:00', tasks: assignmentFor(sheets, who, day, pid).tasks });
  const mike = clockIn('s1', 'Mike R', 'pmike', [a]), ana = clockIn('s2', 'Ana P', 'pana', [b]); // each crew phone holds its own sheet
  // Phone A receives B's sheet: both were sent, so neither is renumbered and both say so.
  const onA = [a, normTask(JSON.parse(JSON.stringify({ ...b, origin: 'link' })))];
  assert.deepEqual(renumberClashes(onA, onA[1]), [], 'a sent sheet keeps its number');
  assert.ok(sameNumber(onA, onA[0]) && sameNumber(onA, onA[1]), 'both show "Same number as another sheet"');
  const sheetOf = s => onA.filter(t => s.tasks.some(x => x.uid === t.uid)).map(t => t.crew);
  assert.deepEqual([sheetOf(mike), sheetOf(ana)], [['Crew A'], ['Crew B']], 'each shift finds its own sheet by uid though the numbers match');
  // The PM logs both texts, then an older phone's text names the sheet by number only.
  const log = [];
  importShifts(log, [JSON.parse(JSON.stringify(mike)), JSON.parse(JSON.stringify(ana))].map(normShift), 1);
  importShifts(log, [normShift({ ...mike, tasks: ['T1019-02'], out: '15:00' })], 2);
  assert.deepEqual(log.map(s => s.tasks), [[{ uid: 'phoneA-2', id: 'T1019-02' }], [{ uid: 'phoneB-2', id: 'T1019-02' }]], 'the uid survives; a bare number already known by uid is not added twice');
});

test('a sheet that arrives with the number of an unsent sheet here renumbers ours', async () => {
  const { normTask, renumberClashes, sameNumber } = await lib;
  const day = '2026-10-19', T = [
    normTask({ uid: 'a1', origin: 'mine', id: 'T1019-01', date: day, sentAt: 1 }),
    normTask({ uid: 'a2', origin: 'mine', id: 'T1019-02', date: day }), // made here, not sent yet
    normTask({ uid: 'a3', origin: 'mine', id: 'T1019-02', date: '2026-10-20' }), // another day
  ];
  const inc = normTask({ uid: 'b2', origin: 'mine', id: 'T1019-02', date: day, sentAt: 9 });
  T.push(inc);
  assert.deepEqual(renumberClashes(T, inc).map(([t, old]) => [t.uid, old, t.id]), [['a2', 'T1019-02', 'T1019-03']], "only this phone's unsent sheet of that day, to the next free number");
  assert.equal(T[2].id, 'T1019-02', 'a sheet on another day keeps its number');
  assert.ok(T[1].updatedAt > 0 && !sameNumber(T, inc), 'saved as an edit; no warning left');
  const inc2 = normTask({ uid: 'b1', origin: 'link', id: 'T1019-01', date: day, sentAt: 3 });
  T.push(inc2);
  assert.deepEqual(renumberClashes(T, inc2), [], 'ours was sent: it keeps its number');
  assert.ok(sameNumber(T, T[0]) && sameNumber(T, inc2));
  assert.deepEqual(renumberClashes(T, normTask({ ...T[1] })), [], 'the same sheet coming back is no clash');
  const crewPhone = [normTask({ uid: 'x', origin: 'link', id: 'T1', date: day }), normTask({ uid: 'y', origin: 'link', id: 'T1', date: day })];
  assert.deepEqual(renumberClashes(crewPhone, crewPhone[1]), [], "a crew phone's sheets are never renumbered");
});

test('every new field survives normalizing, a reload and a JSON round trip', async () => {
  const { normTask, normShift, normReport, normSettings, loadSettings, mergeTask, cloneTask, KEYS } = await lib;
  const task = { uid: 'u1', id: 'T1', date: '2026-10-19', crew: 'Crew A', crewId: 'c1', members: ['Mike R', 'Ana P'], memberIds: ['p1', ''], aLang: 'es', cLang: 'es',
    assignAt: 11, crewAt: 12, reply: 'Traer la plataforma', replyAt: 13, replyBy: 'Pat PM', review: 'Accepted' };
  const t2 = normTask(JSON.parse(JSON.stringify(normTask(task))));
  for (const k of Object.keys(task)) assert.deepEqual(t2[k], task[k], 'task ' + k);
  assert.deepEqual(normTask({ members: ['a', 'b', 'c'], memberIds: ['p1', '<b>'] }).memberIds, ['p1', '', ''], 'one id per member, a bad one blank');
  const crewCopy = normTask({ uid: 'u1', status: 'Partial' });
  mergeTask(crewCopy, t2, 'assign');
  for (const k of ['crewId', 'memberIds', 'aLang', 'reply', 'replyAt', 'replyBy']) assert.deepEqual(crewCopy[k], task[k], 'a re-sent sheet brings ' + k);
  assert.equal(crewCopy.status, 'Partial');
  const c = cloneTask(t2, '2026-10-20');
  assert.deepEqual([c.reply, c.replyAt, c.replyBy, c.assignAt, c.crewAt, c.crewId, c.memberIds], ['', 0, '', 0, 0, 'c1', ['p1', '']], 'a copy starts without the message or stamps, same crew and people');
  const rep = { date: '2026-10-19', status: 'On plan', lang: 'es', pmAt: 21, pmReview: 'ok', updatedAt: 20 };
  const r2 = normReport(JSON.parse(JSON.stringify(normReport(rep))));
  for (const k of Object.keys(rep)) assert.deepEqual(r2[k], rep[k], 'report ' + k);
  const sh = { id: 's1', device: 'd1', who: 'Mike R', pid: 'p1', crew: 'Crew A', crewId: 'c1', tasks: [{ uid: 'u1', id: 'T1' }], date: '2026-10-19', in: '07:00', out: '15:00', edited: { who: false, in: false, out: false }, gone: false, at: 3 };
  assert.deepEqual(normShift(JSON.parse(JSON.stringify(normShift(sh)))), sh);
  assert.deepEqual(normShift({ ...sh, tasks: ['T7', { uid: 'u2', id: 'T2' }, { uid: '<b>', id: 'T3' }] }).tasks, [{ uid: '', id: 'T7' }, { uid: 'u2', id: 'T2' }, { uid: '', id: 'T3' }], 'a bare id from an older phone is a link without a uid');
  const set = { hubUrl: 'https://script.google.com/macros/s/x/exec', hubKey: 'A'.repeat(32), hubRole: 'pm', hubCrew: 'Crew A', workerId: 'p1', worker: 'Mike R',
    crews: [{ id: 'c1', name: 'Crew A', lead: 'Mike R', members: '' }], people: [{ id: 'p1', name: 'Mike R', crewId: 'c1' }] };
  const store = new Map([[KEYS.settings, JSON.stringify(normSettings(set))]]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } });
  try {
    const s2 = loadSettings();
    for (const k of ['hubUrl', 'hubKey', 'hubRole', 'hubCrew', 'workerId', 'worker', 'people']) assert.deepEqual(s2[k], set[k], 'settings ' + k);
    assert.deepEqual(s2.crews, [{ id: 'c1', name: 'Crew A', lead: 'Mike R', members: 'Mike R' }]);
  } finally { delete globalThis.localStorage; }
});

test('a backup carries people, ids, stamps, replies, shift links and the device secret, never the hub key', async () => {
  const { KEYS, normSettings, loadSettings, normTask, normShift, normReport, load, save, backupData, restoreData, isBackup, ensureDevice, deviceId, deviceSecret } = await lib;
  const crypto = require('node:crypto');
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } });
  try {
    const id = await ensureDevice();
    assert.match(id, /^[0-9a-f]{32}$/);
    assert.match(deviceSecret(), /^[A-Za-z0-9]{32}$/);
    assert.equal(id, crypto.createHash('sha256').update(deviceSecret()).digest('hex').slice(0, 32), 'the id is the first 32 hex characters of SHA-256(secret)');
    assert.equal(await ensureDevice(), id, 'made once');
    assert.equal(deviceId(), id);
    const hubKey = 'K'.repeat(32);
    save(KEYS.settings, normSettings({ hubUrl: 'https://script.google.com/macros/s/x/exec', hubKey, hubRole: 'super', crews: [{ name: 'Crew A', members: 'Mike R, Ana P' }] }));
    const S = loadSettings(), mike = S.people[0];
    save(KEYS.tasks, [normTask({ uid: 'u1', id: 'T1019-01', date: '2026-10-19', crew: 'Crew A', crewId: S.crews[0].id, members: ['Mike R'], memberIds: [mike.id], reply: 'Call me', replyAt: 9, replyBy: 'Pat', assignAt: 8, crewAt: 7, aLang: 'es' })]);
    save(KEYS.reports, { '2026-10-19': normReport({ date: '2026-10-19', pmAt: 5, lang: 'es' }) });
    save(KEYS.crewHours, [normShift({ id: 's1', device: id, who: 'Mike R', pid: mike.id, crewId: S.crews[0].id, date: '2026-10-19', in: '07:00', tasks: [{ uid: 'u1', id: 'T1019-01' }] })]);
    const file = JSON.parse(JSON.stringify(backupData()));
    assert.equal(file[KEYS.settings].hubKey, '', 'the hub key is left out');
    assert.ok(!JSON.stringify(file).includes(hubKey));
    assert.equal(load(KEYS.settings, {}).hubKey, hubKey, 'only the file leaves it out; this phone keeps it');
    assert.deepEqual(file[KEYS.device], { secret: deviceSecret(), id }, 'the device secret goes along');
    store.clear(); // a new phone
    assert.ok(isBackup(file) && restoreData(file));
    const S2 = loadSettings(), t = load(KEYS.tasks, []).map(normTask)[0], r = normReport(load(KEYS.reports, {})['2026-10-19']), s = load(KEYS.crewHours, []).map(normShift)[0];
    assert.deepEqual([S2.people, S2.crews], [S.people, S.crews], 'people and crews with their ids');
    assert.deepEqual([S2.hubUrl, S2.hubRole, S2.hubKey], [S.hubUrl, 'super', ''], 'the hub address stays; the key is asked for again');
    assert.deepEqual([t.memberIds, t.crewId, t.reply, t.replyAt, t.replyBy, t.assignAt, t.crewAt, t.aLang], [[mike.id], S.crews[0].id, 'Call me', 9, 'Pat', 8, 7, 'es']);
    assert.deepEqual([r.pmAt, r.lang], [5, 'es']);
    assert.deepEqual([s.pid, s.crewId, s.tasks, s.device], [mike.id, S.crews[0].id, [{ uid: 'u1', id: 'T1019-01' }], id]);
    assert.equal(deviceId(), id, 'the restored phone is the same device');
  } finally { delete globalThis.localStorage; }
});

test('time clock: a shift carries its crew and task ids, in a safe shape', async () => {
  const { normShift } = await lib;
  const ok = { id: 'k1', device: 'd1', who: 'Jose L', date: '2026-10-14', in: '07:00' };
  const ids = s => s.tasks.map(x => x.id);
  const n = normShift({ ...ok, crew: '  Crew A ', tasks: ['T1014-01', 'T1014-01', 'T1014-02'] });
  assert.deepEqual([n.crew, ids(n)], ['Crew A', ['T1014-01', 'T1014-02']], 'trimmed; each id once');
  const hostile = normShift({ ...ok, crew: '<b>' + 'x'.repeat(5000), pid: '"><b>', crewId: 'c 1', tasks: ['<img src=x onerror=alert(1)>', 'a b', '', 'x'.repeat(21), 42, null, { id: 'T1' }, ['T1'], '../etc', '"><', 'T1014-03', ...Array.from({ length: 20 }, (_, i) => 'T' + i)] });
  assert.equal(hostile.crew.length, 60, 'a crew name is kept to 60 characters (and shown escaped)');
  assert.deepEqual([hostile.pid, hostile.crewId], ['', ''], 'ids keep their exact format');
  assert.deepEqual(ids(hostile), ['a b', 'T1', '../etc', 'T1014-03', 'T0', 'T2', 'T3', 'T4', 'T5', 'T6'], 'only plain text ids of up to 20 characters, each once, at most 10 (no markup or quotes)');
  assert.deepEqual(normShift({ ...ok, tasks: [{ uid: 'u1', id: '<img>' }, { uid: '"><', id: 'T9' }, { uid: 'u1', id: 'T8' }] }).tasks, [{ uid: 'u1', id: '' }, { uid: '', id: 'T9' }], 'a bad uid or label is blanked, a uid kept once');
  assert.deepEqual(normShift({ ...ok, tasks: ['L3 East-14', 'T1014.02', 'Baño-2', 'E-301/4', ' T7 ', '#12', '=1+1', '@SUM', '+1', "O'1", '   '] }).tasks.map(x => x.id),
    ['L3 East-14', 'T1014.02', 'Baño-2', 'E-301/4', 'T7', '#12'], 'an id typed on the sheet with a space, dot, accent or slash goes with the hours; = + @ and quotes do not');
  const wrongTypes = normShift({ ...ok, crew: { evil: 1 }, tasks: 'T1' });
  assert.deepEqual([wrongTypes.crew, wrongTypes.tasks], ['', []]);
  assert.deepEqual(normShift({ ...ok, tasks: Array(5000).fill('T1') }).tasks, [{ uid: '', id: 'T1' }]);
});

test('time clock: the sheets that list a worker that day give the crew and task ids', async () => {
  const { normTask, assignmentFor } = await lib;
  let n = 0;
  const t = (id, date, crew, members) => normTask({ uid: 'u' + ++n, id, date, crew, members });
  const tasks = [t('T2', '2026-10-14', '', ['jose  l']), t('T1', '2026-10-14', 'Crew A', ['José L', 'Luis M']), t('T3', '2026-10-14', 'Crew B', ['JOSE L']),
    t('T4', '2026-10-15', 'Crew C', ['Jose L']), t('T5', '2026-10-14', 'Crew D', ['Ana P', '']), t('T1', '2026-10-14', 'Crew A', ['Jose L']), t('', '2026-10-14', 'Crew E', ['Jose L'])];
  const a = assignmentFor(tasks, 'Jose L', '2026-10-14');
  assert.deepEqual([a.crew, a.tasks], ['Crew A', [{ uid: 'u1', id: 'T2' }, { uid: 'u2', id: 'T1' }, { uid: 'u3', id: 'T3' }, { uid: 'u6', id: 'T1' }, { uid: 'u7', id: '' }]],
    "every sheet that day, whatever the case, accents or spacing; the first sheet's crew that names one; each sheet by uid, so two with one number are both there");
  assert.equal(a.sheets.length, 5, 'the sheets themselves, for the Today card');
  assert.deepEqual(assignmentFor(tasks, 'jose l', '2026-10-15'), { crew: 'Crew C', crewId: '', tasks: [{ uid: 'u4', id: 'T4' }], sheets: [tasks[3]] }, 'another day, its own sheet');
  assert.deepEqual(assignmentFor(tasks, 'Jose L', '2026-10-16'), { crew: '', crewId: '', tasks: [], sheets: [] }, 'a day with no sheets');
  assert.deepEqual(assignmentFor(tasks, 'Ray K', '2026-10-14'), { crew: '', crewId: '', tasks: [], sheets: [] }, 'a name on no sheet');
  for (const blank of ['', '  ', null]) assert.deepEqual(assignmentFor(tasks, blank, '2026-10-14').tasks, [], 'no name matches nothing, not even an empty member');
});

test("time clock: crew and task ids follow the worker's texts and never undo the PM", async () => {
  const { normShift } = await lib;
  const { importShifts, byPerson } = await import('../docs/schwab/report.mjs');
  const shift = (set = {}) => normShift({ id: 'a', device: 'dana1', who: 'Dana R', date: '2026-10-14', in: '07:00', ...set });
  const log = [];
  const ids = s => s.tasks.map(x => x.id);
  importShifts(log, [shift({ tasks: [{ uid: 'u1', id: 'T1' }] })], 1);
  assert.deepEqual([log[0].crew, ids(log[0])], ['', ['T1']], 'the clock-in text: on one sheet, no crew yet');
  Object.assign(log[0], { out: '15:00', who: 'Dana Ruiz', edited: { who: true, in: false, out: true } }); // the PM fixes the out time and the name
  assert.deepEqual(importShifts(log, [shift({ out: '15:30', crew: 'Crew A', crewId: 'ca', pid: 'pdana', tasks: [{ uid: 'u1', id: 'T1' }, { uid: 'u2', id: 'T2' }] })], 2), { added: 0, updated: 1, skipped: 0 }, 'the clock-out text brings the crew and a sheet assigned since');
  assert.deepEqual([log[0].who, log[0].pid, log[0].out, log[0].crew, log[0].crewId, ids(log[0])], ['Dana Ruiz', '', '15:00', 'Crew A', 'ca', ['T1', 'T2']], "and the PM's name (and so the person) and out time stay");
  assert.deepEqual(importShifts(log, [shift({ tasks: ['T1'] })], 1), { added: 0, updated: 0, skipped: 0 }, 'the clock-in text opened late takes nothing away');
  assert.deepEqual([log[0].crew, log[0].tasks], ['Crew A', [{ uid: 'u1', id: 'T1' }, { uid: 'u2', id: 'T2' }]]);
  importShifts(log, [shift({ device: 'other', crew: 'Crew Z', tasks: ['T9'] })], 3);
  log[0].gone = true;
  importShifts(log, [shift({ crew: 'Crew Z', tasks: ['T9'] })], 4);
  assert.deepEqual([log[0].crew, ids(log[0])], ['Crew A', ['T1', 'T2']], "another phone's link, or one for a shift the PM removed, changes nothing");
  const byHand = [normShift({ id: 'pm1', who: 'Ana P', date: '2026-10-12', in: '07:00', edited: { who: true, in: true, out: true } })];
  importShifts(byHand, [shift({ id: 'e', who: 'ána p', date: '2026-10-12', crew: 'Crew B' })], 5);
  assert.deepEqual(byHand.map(s => s.gone), [false, true], 'a day the PM added by hand matches the late text whatever its accents');

  const S = (await lib).normSettings({ crews: [{ name: 'Crew B', lead: '', members: 'Ana P' }] });
  const ps = byPerson([shift({ id: 'p1', who: 'José L', date: '2026-10-12', crew: 'Crew A' }), shift({ id: 'p2', who: 'jose l', date: '2026-10-14', crew: 'Crew C' }), shift({ id: 'p3', who: 'Jose  L', date: '2026-10-15' }),
    shift({ id: 'p4', who: 'ana p', date: '2026-10-13' }), shift({ id: 'p5', who: 'Ray K', date: '2026-10-13' })], 'en', S);
  assert.deepEqual(ps.map(p => [p.who, p.shifts.length, p.crew]), [['Ana P', 1, 'Crew B'], ['José L', 3, 'Crew C'], ['Ray K', 1, '']],
    "one timesheet per person however typed, under the crew list's spelling when it has one; the week's latest crew, else the crew lists, else none");
});

test('a tab still on the old version cannot wipe the passcode', async () => {
  const { KEYS, loadSettings, setPin, pinHash, PIN_FORMAT } = await lib;
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } });
  try {
    const s = loadSettings();
    setPin(s, await pinHash('4821'));
    store.set(KEYS.settings, JSON.stringify({ me: 'Dana', role: 'Superintendent' })); // the old version's save, without the code
    assert.match(loadSettings().pin, PIN_FORMAT, 'the passcode survives');
  } finally { delete globalThis.localStorage; }
});
