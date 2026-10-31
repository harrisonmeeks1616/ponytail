import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildToday, addDaysOn } from '../src/today.js';

// Sample data only. All titles below are sample text.
const TZ = 'America/New_York';
const TODAY = '2026-10-30';
const NOW = Date.parse('2026-10-30T14:00:00Z'); // 10:00 EDT
const OPTS = { todayOn: TODAY, nowMs: NOW, timeZone: TZ, lastOpenAt: '2026-10-30T12:00:00Z' };

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

let seq = 0;
function task(over = {}) {
  seq += 1;
  return {
    id: `t${seq}`,
    kind: 'task',
    scope: 'work',
    title: `Sample task ${seq}`,
    state: 'open',
    due_on: null,
    today_pick: 0,
    created_at: `2026-10-01T00:00:${String(seq % 60).padStart(2, '0')}Z`,
    ...over,
  };
}
function waitingItem(over = {}) {
  seq += 1;
  return {
    id: `w${seq}`,
    kind: 'waiting',
    scope: 'work',
    title: `Sample waiting ${seq}`,
    state: 'open',
    who: null,
    asked_on: null,
    follow_up_on: null,
    reply_recorded_at: null,
    claim_status: 'unspecified',
    created_at: '2026-10-01T00:00:00Z',
    ...over,
  };
}
function checkpoint(over = {}) {
  seq += 1;
  return {
    id: `c${seq}`,
    project_id: `p${seq}`,
    project_name: `Sample project ${seq}`,
    scope: 'work',
    last_touched_at: '2026-10-28T15:00:00Z',
    created_at: '2026-10-28T15:00:00Z',
    stopped_at_text: null,
    open_question: null,
    next_step: null,
    ...over,
  };
}
function build(rows, opts = {}) {
  return buildToday(deepFreeze(rows), deepFreeze({ ...OPTS, ...opts }));
}

test('addDaysOn does calendar arithmetic across month and year ends', () => {
  assert.equal(addDaysOn('2026-10-30', 7), '2026-11-06');
  assert.equal(addDaysOn('2026-12-28', 7), '2027-01-04');
  assert.equal(addDaysOn('2028-02-28', 1), '2028-02-29');
});

test('empty rows give an empty Today', () => {
  const out = build({ inboxCount: 0 });
  assert.deepEqual(out, {
    fixed: [],
    next: null,
    today: [],
    needsYou: { inboxCount: 0 },
    waiting: { count: 0, dueCount: 0 },
    tasks: { openCount: 0, deferredCount: 0 },
    resume: [],
    returnView: null,
  });
});

test('next.kind: waiting for a due follow-up (never a task to tick), task for dated or picked, project for resume', () => {
  const w = waitingItem({ follow_up_on: TODAY });
  assert.equal(build({ waiting: [w], tasks: [task({ due_on: TODAY })] }).next.kind, 'waiting');
  assert.equal(build({ tasks: [task({ due_on: '2026-10-25' })] }).next.kind, 'task');
  assert.equal(build({ tasks: [task({ today_pick: 1 })] }).next.kind, 'task');
  assert.equal(build({ checkpoints: [checkpoint()] }).next.kind, 'project');
});

test('tasks.openCount counts every open task, undated and unpicked ones included; today rows carry picked', () => {
  const undated = task();
  const later = task({ due_on: '2026-12-01' });
  const picked = task({ today_pick: 1 });
  const due = task({ due_on: TODAY, today_pick: 1 });
  const done = task({ state: 'done', today_pick: 1 });
  const out = build({ tasks: [undated, later, picked, due, done], waiting: [waitingItem({ follow_up_on: TODAY })] });
  assert.deepEqual(out.tasks, { openCount: 4, deferredCount: 0 });
  assert.deepEqual(out.today.map((t) => [t.ref, t.picked]), [
    [`item:${due.id}`, true],
    [`item:${picked.id}`, true],
    [`item:${done.id}`, true],
  ]);
  assert.ok(!out.today.some((t) => t.ref === `item:${undated.id}` || t.ref === `item:${later.id}`), 'unpicked, undated tasks are not on Today');
});

test('next: a due follow-up wins over overdue, due-today and picked tasks', () => {
  const w = waitingItem({ who: 'Sample Person', asked_on: '2026-10-20', follow_up_on: TODAY });
  const out = build({
    tasks: [task({ due_on: '2026-10-25' }), task({ due_on: TODAY }), task({ today_pick: 1 })],
    waiting: [w],
    checkpoints: [checkpoint()],
  });
  assert.equal(out.next.ref, `item:${w.id}`);
  assert.equal(out.next.title, w.title);
  assert.equal(out.next.scope, 'work');
  assert.equal(out.next.why, 'You asked Sample Person on 2026-10-20. Follow-up is today. No reply recorded.');
});

test('next why: missing who and asked_on say "someone" and "date not stated", never invented', () => {
  const w = waitingItem({ follow_up_on: TODAY });
  const out = build({ waiting: [w] });
  assert.equal(out.next.why, 'You asked someone on date not stated. Follow-up is today. No reply recorded.');
  // only text from fields or fixed wording: no digits beyond the stated fields
  assert.doesNotMatch(out.next.why, /\d/);
});

test('next why: a follow-up date already passed states that date', () => {
  const w = waitingItem({ who: 'Sample Person', follow_up_on: '2026-10-27' });
  const out = build({ waiting: [w] });
  assert.equal(out.next.why, 'You asked Sample Person on date not stated. Follow-up was 2026-10-27. No reply recorded.');
});

test('next: earliest due follow-up first; future follow-ups are not due', () => {
  const later = waitingItem({ follow_up_on: TODAY });
  const earlier = waitingItem({ follow_up_on: '2026-10-29' });
  const future = waitingItem({ follow_up_on: '2026-10-31' });
  const out = build({ waiting: [later, future, earlier] });
  assert.equal(out.next.ref, `item:${earlier.id}`);
  assert.deepEqual(out.waiting, { count: 3, dueCount: 2 });
});

test('next: overdue hard-dated task, earliest due_on first, beats due today and picks', () => {
  const o1 = task({ due_on: '2026-10-28' });
  const o2 = task({ due_on: '2026-10-21' });
  const out = build({
    tasks: [task({ due_on: TODAY }), o1, task({ today_pick: 1 }), o2],
    waiting: [waitingItem({ follow_up_on: '2026-11-02' })],
  });
  assert.equal(out.next.ref, `item:${o2.id}`);
  assert.equal(out.next.why, 'It was due Wed, Oct 21 and is still open.');
});

test('next: task due today beats a today_pick', () => {
  const d = task({ due_on: TODAY });
  const out = build({ tasks: [task({ today_pick: 1 }), d] });
  assert.equal(out.next.ref, `item:${d.id}`);
  assert.equal(out.next.why, 'It is due today.');
});

test('next: today_pick task when nothing is dated', () => {
  const p = task({ today_pick: 1 });
  const out = build({ tasks: [task({ due_on: '2026-11-03' }), p], checkpoints: [checkpoint()] });
  assert.equal(out.next.ref, `item:${p.id}`);
  assert.equal(out.next.why, 'You picked this for today.');
});

test('next: resume falls back to the most recently touched stale checkpoint', () => {
  const older = checkpoint({ last_touched_at: '2026-10-20T15:00:00Z', stopped_at_text: 'Sample older place' });
  const newer = checkpoint({ last_touched_at: '2026-10-29T15:00:00Z', stopped_at_text: 'Sample stop', next_step: 'Sample step' });
  // touched today (local) is not stale
  const fresh = checkpoint({ last_touched_at: '2026-10-30T13:00:00Z', stopped_at_text: 'Sample fresh' });
  const out = build({ tasks: [task()], checkpoints: [older, fresh, newer] });
  assert.equal(out.next.ref, `project:${newer.project_id}`);
  assert.equal(out.next.title, newer.project_name);
  assert.equal(out.next.why, 'You stopped at: Sample stop · Next step: Sample step');
  assert.deepEqual(
    out.resume.map((r) => r.projectId),
    [fresh.project_id, newer.project_id, older.project_id],
  );
  assert.deepEqual(out.resume[1], {
    projectId: newer.project_id,
    name: newer.project_name,
    lastTouchedAt: newer.last_touched_at,
    scope: 'work',
  });
});

test('next: resume why with empty checkpoint text uses only the saved date', () => {
  const c = checkpoint({ last_touched_at: '2026-10-25T02:00:00Z', created_at: '2026-10-25T02:00:00Z' });
  const out = build({ checkpoints: [c] });
  // 02:00Z on the 25th is the 24th in New York
  assert.equal(out.next.why, 'Place saved on 2026-10-24.');
});

test('nothing due or picked: next is the latest saved place; with no saved place, next is null', () => {
  const rows = {
    tasks: [task(), task({ due_on: '2026-11-04' })],
    waiting: [waitingItem({ follow_up_on: '2026-11-01' })],
  };
  const out = build({ ...rows, checkpoints: [checkpoint({ last_touched_at: '2026-10-30T12:00:00Z' })] });
  assert.equal(out.next.kind, 'project');
  assert.equal(build(rows).next, null);
});

test('done tasks are never next', () => {
  const out = build({ tasks: [task({ due_on: '2026-10-01', state: 'done' }), task({ today_pick: 1, state: 'done' })] });
  assert.equal(out.next, null);
});

test('today: picks and due-today tasks, capped at 5', () => {
  const picks = Array.from({ length: 7 }, () => task({ today_pick: 1 }));
  const out = build({ tasks: picks });
  assert.equal(out.today.length, 5);
  assert.deepEqual(out.today.map((t) => t.ref), picks.slice(0, 5).map((t) => `item:${t.id}`));
  assert.deepEqual(out.today[0], { ref: `item:${picks[0].id}`, title: picks[0].title, meta: 'Picked for today', done: false, picked: true, scope: 'work' });
});

test('today: the cap never drops hard-dated items', () => {
  const due = Array.from({ length: 6 }, () => task({ due_on: TODAY }));
  const overdue = task({ due_on: '2026-10-29' });
  const picks = Array.from({ length: 4 }, () => task({ today_pick: 1 }));
  const out = build({ tasks: [...picks, ...due, overdue] });
  const refs = out.today.map((t) => t.ref);
  for (const t of [...due, overdue]) assert.ok(refs.includes(`item:${t.id}`), `hard-dated ${t.id} kept`);
  assert.equal(out.today.length, 7);
  for (const p of picks) assert.ok(!refs.includes(`item:${p.id}`));
  assert.equal(out.today.find((t) => t.ref === `item:${overdue.id}`).meta, 'Overdue · due 2026-10-29');
  assert.equal(out.today.find((t) => t.ref === `item:${due[0].id}`).meta, 'Due today');
});

test('today: with 2 hard-dated items, 3 picks fill the rest of the cap', () => {
  const due = [task({ due_on: TODAY }), task({ due_on: TODAY, today_pick: 1 })];
  const picks = Array.from({ length: 5 }, () => task({ today_pick: 1 }));
  const out = build({ tasks: [...picks, ...due] });
  assert.equal(out.today.length, 5);
  assert.deepEqual(out.today.slice(0, 2).map((t) => t.ref), due.map((t) => `item:${t.id}`));
  // a pick that is also hard-dated appears once
  assert.equal(out.today.filter((t) => t.ref === `item:${due[1].id}`).length, 1);
});

test('today: future-dated tasks without a pick are not listed', () => {
  const out = build({ tasks: [task({ due_on: '2026-11-02' }), task()] });
  assert.deepEqual(out.today, []);
});

test('today: a done task shows as done', () => {
  const d = task({ today_pick: 1, state: 'done' });
  const out = build({ tasks: [d] });
  assert.equal(out.today.length, 1);
  assert.equal(out.today[0].done, true);
});

test('waiting items never appear in the today list, even with a pick or due date', () => {
  const w1 = waitingItem({ follow_up_on: TODAY, today_pick: 1, due_on: TODAY });
  const w2 = waitingItem({ due_on: '2026-10-01' });
  const out = build({ tasks: [w1, w2], waiting: [w1, w2], hardDates: [w1, w2] });
  assert.deepEqual(out.today, []);
  assert.deepEqual(out.fixed, []);
  assert.ok(!out.today.some((t) => t.ref.startsWith('item:w')));
  assert.equal(out.next.ref, `item:${w1.id}`); // surfaces only as a due follow-up
  assert.deepEqual(out.waiting, { count: 2, dueCount: 1 });
});

test('fixed: reminders firing today (local) and items due today', () => {
  const due = task({ due_on: TODAY });
  const ref = { ...task({ due_on: TODAY }), kind: 'reference' };
  const out = build({
    tasks: [due],
    hardDates: [ref, task({ due_on: '2026-11-01' })],
    reminders: [
      { id: 'r1', text: 'Sample reminder late', scope: 'work', item_id: null, next_fire_at: Date.parse('2026-10-30T21:00:00Z'), state: 'active' },
      { id: 'r2', text: 'Sample reminder early', scope: 'work', item_id: null, next_fire_at: Date.parse('2026-10-30T13:00:00Z'), state: 'active' },
      // 03:00Z on the 31st is 23:00 on the 30th in New York: still today
      { id: 'r3', text: 'Sample reminder night', scope: 'work', item_id: null, next_fire_at: Date.parse('2026-10-31T03:00:00Z'), state: 'active' },
      // 03:00Z on the 30th is the 29th locally: not today
      { id: 'r4', text: 'Sample reminder yesterday', scope: 'work', item_id: null, next_fire_at: Date.parse('2026-10-30T03:00:00Z'), state: 'active' },
      { id: 'r5', text: 'Sample cancelled', scope: 'work', item_id: null, next_fire_at: Date.parse('2026-10-30T15:00:00Z'), state: 'cancelled' },
    ],
  });
  assert.deepEqual(out.fixed.map((f) => f.ref), ['reminder:r2', 'reminder:r1', 'reminder:r3', `item:${due.id}`, `item:${ref.id}`]);
  assert.deepEqual(out.fixed[0], { label: 'Sample reminder early', at: '2026-10-30T13:00:00.000Z', ref: 'reminder:r2', scope: 'work' });
  assert.deepEqual(out.fixed[3], { label: due.title, on: TODAY, ref: `item:${due.id}`, scope: 'work' });
});

test('scope: scope=all keeps both scopes; work or personal drops the other scope', () => {
  const wTask = task({ today_pick: 1, scope: 'work' });
  const pTask = task({ today_pick: 1, scope: 'personal' });
  const pDue = task({ due_on: '2026-10-29', scope: 'personal' });
  const wWait = waitingItem({ follow_up_on: '2026-11-05', scope: 'work' });
  const pWait = waitingItem({ follow_up_on: TODAY, scope: 'personal' });
  const bogus = task({ today_pick: 1, scope: 'shared' });
  const rows = {
    tasks: [wTask, pTask, pDue, bogus],
    waiting: [wWait, pWait],
    inboxCount: { work: 2, personal: 3 },
    checkpoints: [checkpoint({ scope: 'personal' }), checkpoint({ scope: 'work' })],
    reminders: [
      { id: 'rw', text: 'Sample w', scope: 'work', item_id: null, next_fire_at: Date.parse('2026-10-30T16:00:00Z'), state: 'active' },
      { id: 'rp', text: 'Sample p', scope: 'personal', item_id: null, next_fire_at: Date.parse('2026-10-30T17:00:00Z'), state: 'active' },
    ],
  };

  const all = build(rows, { scope: 'all' });
  assert.deepEqual(new Set(all.today.map((t) => t.scope)), new Set(['work', 'personal']));
  assert.ok(!all.today.some((t) => t.ref === `item:${bogus.id}`), 'unknown scope fails closed');
  assert.equal(all.next.ref, `item:${pWait.id}`);
  assert.equal(all.next.scope, 'personal');
  assert.equal(all.needsYou.inboxCount, 5);
  assert.deepEqual(all.waiting, { count: 2, dueCount: 1 });
  assert.equal(all.fixed.length, 2);
  assert.equal(all.resume.length, 2);

  const work = build(rows, { scope: 'work' });
  for (const list of [work.today, work.fixed, work.resume]) for (const e of list) assert.equal(e.scope, 'work');
  assert.equal(work.next.ref, `item:${wTask.id}`);
  assert.equal(work.needsYou.inboxCount, 2);
  assert.deepEqual(work.waiting, { count: 1, dueCount: 0 });

  const personal = build(rows, { scope: 'personal' });
  for (const list of [personal.today, personal.fixed, personal.resume]) for (const e of list) assert.equal(e.scope, 'personal');
  assert.equal(personal.next.ref, `item:${pWait.id}`);
  assert.equal(personal.needsYou.inboxCount, 3);

  // no scope option behaves like all; but every output entry still carries its own scope
  const dflt = build(rows, { scope: undefined });
  assert.deepEqual(dflt.today, all.today);
});

test('invalid options throw', () => {
  assert.throws(() => buildToday({}, { ...OPTS, scope: 'everything' }), TypeError);
  assert.throws(() => buildToday({}, { ...OPTS, todayOn: '10/30/2026' }), TypeError);
  assert.throws(() => buildToday({}, { ...OPTS, nowMs: undefined }), TypeError);
  assert.throws(() => buildToday({}, { ...OPTS, timeZone: '' }), TypeError);
  assert.throws(() => buildToday({}, { ...OPTS, lastOpenAt: 'not a date' }), TypeError);
});

test('waitingCount from the data layer overrides the row count', () => {
  const out = build({ waiting: [waitingItem({ follow_up_on: TODAY })], waitingCount: { work: 4, personal: 9 } }, { scope: 'work' });
  assert.deepEqual(out.waiting, { count: 4, dueCount: 1 });
});

test('returnView is null at exactly 3 days away and when lastOpenAt is null', () => {
  assert.equal(build({}, { lastOpenAt: new Date(NOW - 3 * 86_400_000).toISOString() }).returnView, null);
  assert.equal(build({}, { lastOpenAt: null }).returnView, null);
  assert.equal(build({}, { lastOpenAt: '2026-10-28T14:00:00Z' }).returnView, null);
});

test('returnView after more than 3 days lists hard dates, follow-ups, unacknowledged reminders, inbox and one next', () => {
  const overdue = task({ due_on: '2026-10-27' });
  const today = task({ due_on: TODAY });
  const in7 = task({ due_on: '2026-11-06' });
  const in8 = task({ due_on: '2026-11-07' });
  const decision = { ...task({ due_on: '2026-11-02' }), kind: 'decision' };
  const doneDated = task({ due_on: '2026-11-01', state: 'done' });
  const fu = waitingItem({ who: 'Sample Person', follow_up_on: '2026-10-28', asked_on: '2026-10-14' });
  const notYet = waitingItem({ follow_up_on: '2026-11-03' });
  const rows = {
    tasks: [in8, today, overdue, doneDated],
    hardDates: [in7, decision, today],
    waiting: [fu, notYet],
    inboxCount: 6,
    unacknowledged: [
      { id: 'd1', reminder_id: 'r1', text: 'Sample missed', scope: 'work', scheduled_for: Date.parse('2026-10-27T12:00:00Z'), acknowledged_at: null },
      { id: 'd2', reminder_id: 'r2', text: 'Sample acked', scope: 'work', scheduled_for: Date.parse('2026-10-27T13:00:00Z'), acknowledged_at: '2026-10-27T13:05:00Z' },
      { id: 'd3', reminder_id: 'r3', text: 'Sample future', scope: 'work', scheduled_for: NOW + 60_000, acknowledged_at: null },
    ],
  };
  const out = build(rows, { lastOpenAt: '2026-10-25T13:00:00Z' });
  const rv = out.returnView;
  assert.ok(rv);
  assert.equal(rv.daysAway, 5);
  assert.deepEqual(rv.hardDates7d.map((h) => h.ref), [overdue, today, decision, in7].map((t) => `item:${t.id}`));
  assert.deepEqual(rv.hardDates7d[0], { ref: `item:${overdue.id}`, title: overdue.title, on: '2026-10-27', overdue: true, scope: 'work' });
  assert.equal(rv.hardDates7d[1].overdue, false);
  assert.deepEqual(rv.passedFollowUps, [{ ref: `item:${fu.id}`, title: fu.title, who: 'Sample Person', followUpOn: '2026-10-28', scope: 'work' }]);
  assert.deepEqual(rv.unacknowledgedReminders, [{ ref: 'reminder:r1', label: 'Sample missed', at: '2026-10-27T12:00:00.000Z', scope: 'work' }]);
  assert.equal(rv.inboxCount, 6);
  assert.deepEqual(rv.oneNext, out.next);
  assert.equal(rv.oneNext.ref, `item:${fu.id}`);
  assert.notEqual(rv.oneNext, out.next, 'oneNext is a copy, not a shared object');
});

test('returnView respects scope', () => {
  const rows = {
    tasks: [task({ due_on: TODAY, scope: 'personal' }), task({ due_on: TODAY, scope: 'work' })],
    waiting: [waitingItem({ follow_up_on: TODAY, scope: 'personal' })],
    unacknowledged: [{ id: 'd1', reminder_id: 'r1', text: 'Sample p', scope: 'personal', scheduled_for: NOW - 1000, acknowledged_at: null }],
    inboxCount: { work: 1, personal: 2 },
  };
  const rv = build(rows, { scope: 'work', lastOpenAt: '2026-10-20T00:00:00Z' }).returnView;
  assert.equal(rv.hardDates7d.length, 1);
  assert.equal(rv.hardDates7d[0].scope, 'work');
  assert.deepEqual(rv.passedFollowUps, []);
  assert.deepEqual(rv.unacknowledgedReminders, []);
  assert.equal(rv.inboxCount, 1);
  assert.equal(rv.oneNext.scope, 'work');
});

test('nothing is mutated: frozen inputs, identical before and after, outputs are fresh objects', () => {
  const rows = {
    tasks: [task({ today_pick: 1 }), task({ due_on: TODAY }), task({ due_on: '2026-10-20' }), task({ due_on: '2026-11-01' })],
    waiting: [waitingItem({ follow_up_on: '2026-10-29', who: 'Sample Person' }), waitingItem({ follow_up_on: TODAY })],
    hardDates: [task({ due_on: '2026-11-03' })],
    checkpoints: [checkpoint(), checkpoint({ last_touched_at: '2026-10-01T00:00:00Z' })],
    reminders: [{ id: 'r1', text: 'Sample', scope: 'work', item_id: null, next_fire_at: NOW + 3_600_000, state: 'active' }],
    unacknowledged: [{ id: 'd1', reminder_id: 'r1', text: 'Sample', scope: 'work', scheduled_for: NOW - 1000, acknowledged_at: null }],
    inboxCount: { work: 1, personal: 1 },
  };
  const snapshot = structuredClone(rows);
  const opts = { ...OPTS, lastOpenAt: '2026-10-01T00:00:00Z', scope: 'all' };
  const optsSnap = structuredClone(opts);
  deepFreeze(rows);
  deepFreeze(opts);
  const a = buildToday(rows, opts); // would throw in strict mode on any write to a frozen object
  const b = buildToday(rows, opts);
  assert.deepEqual(rows, snapshot);
  assert.deepEqual(opts, optsSnap);
  assert.deepEqual(a, b, 'deterministic');
  assert.ok(a.returnView);
  // the input arrays' order was not changed by sorting
  assert.deepEqual(rows.waiting.map((w) => w.id), snapshot.waiting.map((w) => w.id));
  // outputs do not alias input rows
  const inputs = new Set([...rows.tasks, ...rows.waiting, ...rows.hardDates, ...rows.checkpoints]);
  for (const e of [...a.today, ...a.fixed, ...a.resume, a.next]) assert.ok(!inputs.has(e));
});
