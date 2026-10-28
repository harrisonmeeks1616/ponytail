'use strict';
// Daily logs on the hub server (docs/schwab/hub/Code.gs, HUB.md "Log"): one entry per phone per day, written only by that
// phone, read by the office; the Daily log tab added lazily to a Sheet made before it existed. Fake Google services only.
process.env.TZ = 'America/New_York';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createHub } = require('./helpers/google-mock');

const T0 = Date.parse('2026-10-19T12:00:00-04:00'), DAY = '2026-10-19';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const secretOf = label => sha('device secret ' + label).slice(0, 32);
const ID = label => sha(secretOf(label)).slice(0, 32);
const uidOf = (label, date = DAY) => 'wl-' + ID(label).slice(0, 12) + '-' + date;
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r; };

function setup() { const hub = createHub({ now: T0 }); return { hub, k: hub.setup() }; }
function phone(env, role, label = role + '-dev') {
  const p = { role, label, secret: secretOf(label), dev: ID(label), key: env.k[role] };
  p.call = (action, extra = {}) => env.hub.call(p.key, action, { devSecret: p.secret, ...extra });
  p.push = body => p.call('push', body);
  p.pull = extra => p.call('pull', { since: 0, ...extra });
  return p;
}
// A phone's entry for the day: the device it claims is ignored, the hub forces the proven one.
const log = (label, o = {}) => ({ uid: uidOf(label, o.date || DAY), date: DAY, device: 'claimed-' + label, pid: 'p-' + label, who: 'Dana R', crewId: 'c-a', crew: 'Crew A', body: 'Pulled feeders to E-301 on L3', hours: 8, at: T0 - 4000, ...o });
const task = (o = {}) => ({ uid: 'u1', id: 'T1019-01', date: DAY, by: 'Sam', crew: 'Crew A', scope: 'Pull 12 AWG', assignAt: T0 - 5000, sentAt: T0 - 5000, ...o });
function rowsOf(hub, title, id) {
  const head = hub.header(title, id);
  return hub.table(title, id).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
}
const dropLogsTab = hub => { // the live Sheet, made before the Daily log existed
  const wb = hub.workbook();
  wb.sheets.splice(wb.sheets.findIndex(s => s.title === 'Daily log'), 1);
  delete hub.props.LOGS_TAB;
  assert.ok(!hub.tabs().includes('Daily log'));
};
// v2 jobs, as tests/schwab-hub-jobs.test.js provisions them.
const keys = job => Object.fromEntries(['crew', 'super', 'pm', 'bridge'].map(r => [r + 'Key', sha(job + r).slice(0, 32)]));
function provision(hub, jobId, legacy = false) {
  const secret = keys(jobId);
  hub.props.FH_SETUP = JSON.stringify({ jobId, label: jobId, legacy, ...secret });
  const job = hub.run('configureFieldHubJob');
  return { ...job, ...secret, sheetId: job.sheetUrl.split('/')[5] };
}
function environment() {
  const hub = createHub({ now: T0 }), old = hub.setup(), a = provision(hub, 'pm-schwab', true), b = provision(hub, 'pm-new');
  const call = (j, role, action, more = {}) => hub.send({ v: 2, jobId: j.jobId, key: j[role + 'Key'], action, ...more });
  return { hub, old, a, b, call };
}

test('setupHub makes the Daily log tab with its header, and a new v2 job has it too', () => {
  const { hub } = setup();
  assert.ok(hub.tabs().includes('Daily log'));
  assert.deepEqual(hub.header('Daily log'), ['Date', 'Name', 'Crew', 'Hours', 'Entry', 'Updated', 'key', 'rev', 'data']);
  const f = hub.format('Daily log');
  assert.deepEqual([f.frozenRows, f.bold, Object.keys(f.widths).length], [1, true, 9]);
  assert.equal(hub.props.LOGS_TAB, '1');
  const b = provision(hub, 'pm-new');
  assert.ok(hub.tabs(b.sheetId).includes('Daily log'));
  assert.equal(Object.entries(hub.props).find(([k]) => k.endsWith(':LOGS_TAB'))[1], '1');
});

test('a crew phone writes its own day: the device is forced, one log.created, autosaves after it are silent, an older stamp changes nothing', () => {
  const env = setup(), crew = phone(env, 'crew'), { hub } = env;
  let r = ok(crew.push({ logs: [log('crew-dev')] }));
  assert.equal(r.logs[0].status, 'ok');
  assert.deepEqual([r.logs[0].key, r.logs[0].log.device, r.logs[0].log.uid.length], [uidOf('crew-dev'), crew.dev, 26]);
  assert.ok(r.logs[0].log.rev > 0);
  assert.equal(hub.entities('Daily log')[0].device, crew.dev, 'stored with the proven device, not the claimed one');
  const ev = hub.entities('Activity').filter(e => e.kind === 'log.created');
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].who, ev[0].text, ev[0].ref], ['Dana R', 'Dana R started a daily log for 2026-10-19', uidOf('crew-dev')]);
  assert.equal(rowsOf(hub, 'Activity')[0].Ref, 'Dana R', 'the readable Ref cell names the worker');
  let row = rowsOf(hub, 'Daily log')[0];
  assert.deepEqual([row.Date, row.Name, row.Crew, row.Hours, row.Entry, row.Updated, row.key], [DAY, 'Dana R', 'Crew A', 8, 'Pulled feeders to E-301 on L3', '2026-10-19 12:00', uidOf('crew-dev')]);
  // A newer autosave replaces the entry without a second event.
  const events = hub.table('Activity').length, rev1 = r.logs[0].log.rev;
  r = ok(crew.push({ logs: [log('crew-dev', { body: 'Pulled feeders, set LP-1A', hours: 9.5, at: T0 - 2000 })] }));
  assert.deepEqual([r.logs[0].status, r.logs[0].log.body, r.logs[0].log.hours], ['ok', 'Pulled feeders, set LP-1A', 9.5]);
  assert.ok(r.logs[0].log.rev > rev1);
  assert.equal(hub.table('Activity').length, events, 'no event for an edit');
  assert.equal(hub.table('Daily log').length, 1, 'the same day is one row');
  // An older stamp (a phone that was offline) is ignored: nothing written, the reply carries the stored copy.
  const rev2 = r.logs[0].log.rev;
  r = ok(crew.push({ logs: [log('crew-dev', { body: 'stale', at: T0 - 9000 })] }));
  assert.deepEqual([r.logs[0].status, r.logs[0].log.body, r.logs[0].log.rev], ['ok', 'Pulled feeders, set LP-1A', rev2]);
  assert.equal(hub.entities('Daily log')[0].body, 'Pulled feeders, set LP-1A');
  assert.equal(hub.table('Activity').length, events);
  // Validation: hours clamped to a day in hundredths, text trimmed, ids checked.
  r = ok(crew.push({ logs: [log('crew-dev', { hours: 30, at: T0 - 1000 }), log('crew-dev', { date: '2026-10-18', hours: 7.456, who: '  Dana R  ', pid: 'bad id', at: T0 - 1000 }), { uid: 'wl-x', date: '2026-13-45' }, log('crew-dev', { date: '2026-10-17', hours: -2, at: T0 - 1000 })] }));
  assert.deepEqual(r.logs.map(x => x.status), ['ok', 'ok', 'rejected', 'ok']);
  assert.deepEqual([r.logs[0].log.hours, r.logs[1].log.hours, r.logs[1].log.who, r.logs[1].log.pid, r.logs[2].reason, r.logs[3].log.hours], [24, 7.46, 'Dana R', '', 'invalid', 0]);
  assert.equal(rowsOf(hub, 'Daily log').find(x => x.Date === '2026-10-17').Hours, '', 'no hours shows blank');
});

test('a phone never writes another phone\'s day: a foreign uid or a mismatched date is forbidden, no device secret is device', () => {
  const env = setup(), crew = phone(env, 'crew'), other = phone(env, 'crew', 'other-dev'), sup = phone(env, 'super', 'sup-dev');
  ok(other.push({ logs: [log('other-dev')] }));
  let r = ok(crew.push({ logs: [log('other-dev'), log('crew-dev', { uid: uidOf('crew-dev', '2026-10-18') }), { ...log('crew-dev'), uid: uidOf('crew-dev').toUpperCase() }] }));
  assert.deepEqual(r.logs.map(x => x.reason), ['forbidden', 'forbidden', 'forbidden']);
  assert.deepEqual(env.hub.entities('Daily log').map(l => l.uid), [uidOf('other-dev')], 'nothing else landed');
  r = ok(env.hub.call(env.k.crew, 'push', { logs: [log('crew-dev')] })); // no devSecret at all
  assert.equal(r.logs[0].reason, 'device');
  r = ok(sup.push({ logs: [log('other-dev', { body: 'office rewrite' })] })); // an office key is still only its own phone
  assert.equal(r.logs[0].reason, 'forbidden');
  r = ok(env.hub.call(env.k.pm, 'push', { devSecret: secretOf('other-dev'), logs: [log('other-dev', { body: 'same phone, PM key', at: T0 - 1000 })] }));
  assert.equal(r.logs[0].status, 'ok', 'the phone decides, not the key');
  assert.equal(r.logs[0].log.device, ID('other-dev'));
});

test('pull: a crew phone sees its own logs only, the office every log; records by device id; since paging as for every kind', () => {
  const env = setup(), a = phone(env, 'crew', 'a-dev'), b = phone(env, 'crew', 'b-dev'), sup = phone(env, 'super', 'sup-dev'), pm = phone(env, 'pm', 'pm-dev');
  ok(a.push({ logs: [log('a-dev', { who: 'Ana P' }), log('a-dev', { date: '2026-10-18', who: 'Ana P' })] }));
  ok(b.push({ logs: [log('b-dev', { who: 'Eli M', crew: 'Crew B' })] }));
  ok(sup.push({ tasks: [task()] }));
  const uids = r => r.logs.map(l => l.uid).sort();
  assert.deepEqual(uids(a.pull()), [uidOf('a-dev', '2026-10-18'), uidOf('a-dev')].sort());
  assert.deepEqual(uids(b.pull()), [uidOf('b-dev')]);
  assert.deepEqual(uids(ok(env.hub.call(env.k.crew, 'pull', { since: 0 }))), [], 'no secret, no logs');
  const all = [uidOf('a-dev', '2026-10-18'), uidOf('a-dev'), uidOf('b-dev')].sort();
  assert.deepEqual(uids(sup.pull()), all);
  assert.deepEqual(uids(pm.pull()), all);
  assert.ok(pm.pull().logs.every(l => typeof l.rev === 'number' && l.rev > 0));
  assert.deepEqual(a.pull().tasks.map(t => t.uid), ['u1'], 'the rest of the pull is as before');
  // records: one phone's entries by its device id; the superintendent may browse logs, as tasks and reports.
  const q = { kind: 'logs', from: '2026-10-01', to: '2026-10-31' };
  assert.deepEqual(ok(pm.call('records', { ...q, who: ID('a-dev') })).items.map(l => l.uid).sort(), [uidOf('a-dev', '2026-10-18'), uidOf('a-dev')].sort());
  assert.deepEqual(ok(sup.call('records', { ...q, who: ID('b-dev') })).items.map(l => l.who), ['Eli M']);
  assert.deepEqual(ok(pm.call('records', { kind: 'log', from: '2026-10-19', to: '2026-10-19' })).items.length, 2);
  assert.equal(ok(sup.call('records', { ...q, who: 'ana' })).items.length, 2, 'or by name');
  assert.equal(a.call('records', q).error, 'forbidden');
  // since: a phone past the head gets same; after an autosave it gets only the changed entry.
  const head = pm.pull().rev;
  assert.equal(ok(pm.call('pull', { since: head })).same, true);
  ok(b.push({ logs: [log('b-dev', { who: 'Eli M', body: 'more', at: T0 - 1000 })] }));
  const delta = ok(pm.call('pull', { since: head }));
  assert.deepEqual(delta.logs.map(l => [l.uid, l.body]), [[uidOf('b-dev'), 'more']]);
  assert.deepEqual([delta.tasks.length, delta.same], [0, undefined]);
  // stats counts the tab.
  assert.equal(ok(pm.call('stats')).rows.logs, 3);
});

test('v2 bridge: a log-only push may carry expectedRev -1; receipts replay, a changed payload conflicts, anything else with -1 is bad_request', () => {
  const { hub, b, call } = environment();
  const devSecret = secretOf('worker-1'), entry = log('worker-1', { who: 'Eli M' });
  const req = { opId: 'log-only-0001', expectedRev: -1, devSecret, logs: [entry] };
  const first = ok(call(b, 'bridge', 'push', req));
  assert.deepEqual([first.logs[0].status, first.logs[0].log.device, first.logs[0].log.who], ['ok', ID('worker-1'), 'Eli M']);
  assert.equal(hub.table('Operations', b.sheetId)[0][2], 'done');
  assert.equal(hub.entities('Activity', b.sheetId).find(e => e.kind === 'log.created').role, 'bridge');
  assert.deepEqual(ok(call(b, 'bridge', 'push', req)), first, 'the receipt answers a replay');
  assert.equal(hub.table('Daily log', b.sheetId).length, 1);
  assert.equal(call(b, 'bridge', 'push', { ...req, logs: [{ ...entry, body: 'changed' }] }).error, 'conflict');
  assert.equal(call(b, 'bridge', 'push', { opId: 'log-task-0001', expectedRev: -1, devSecret, tasks: [task()] }).error, 'bad_request');
  assert.equal(call(b, 'bridge', 'push', { opId: 'log-two-00001', expectedRev: -1, devSecret, logs: [entry], tasks: [task()] }).error, 'bad_request');
  assert.equal(call(b, 'bridge', 'push', { opId: 'log-two-00002', expectedRev: first.rev, devSecret, logs: [entry], tasks: [task()] }).error, 'bad_request', 'the bridge sends one entity');
  assert.equal(call(b, 'pm', 'push', { opId: 'pm-minus-0001', expectedRev: -1, devSecret, logs: [entry, { ...entry, date: '2026-10-18', uid: uidOf('worker-1', '2026-10-18') }] }).error, 'bad_request', 'two logs is not log-only');
  assert.equal(call(b, 'pm', 'push', { opId: 'pm-minus-0002', expectedRev: -1, devSecret, logs: [entry], config: { project: 'x' } }).error, 'bad_request');
  assert.equal(call(b, 'bridge', 'push', { opId: 'log-stale-001', expectedRev: 0, devSecret, logs: [entry] }).error, 'conflict', 'a real expectedRev is still checked');
  assert.equal(call(b, 'bridge', 'push', { opId: 'log-minus-two', expectedRev: -2, devSecret, logs: [entry] }).error, 'bad_request');
  // A later autosave from the same phone, without knowing the head.
  const again = ok(call(b, 'bridge', 'push', { opId: 'log-only-0002', expectedRev: -1, devSecret, logs: [{ ...entry, body: 'and then some', at: T0 - 1000 }] }));
  assert.equal(again.logs[0].log.body, 'and then some');
  assert.equal(ok(call(b, 'pm', 'pull', { since: 0 })).logs[0].body, 'and then some');
  assert.equal(hub.table('Daily log', b.sheetId).length, 1);
  assert.equal(call(b, 'bridge', 'push', { opId: 'log-foreign-01', expectedRev: -1, devSecret: secretOf('worker-2'), logs: [entry] }).logs[0].reason, 'forbidden');
});

test('the live Sheet without the tab: pulls work and ask Google nothing about it; the first log push adds it, under the lock', () => {
  const { hub, old, a, call } = environment();
  dropLogsTab(hub);
  const pulled = ok(call(a, 'pm', 'pull', { since: 0 }));
  assert.deepEqual(pulled.logs, []);
  assert.deepEqual(ok(hub.call(old.crew, 'pull', { since: 0, devSecret: secretOf('worker-1') })).logs, []);
  assert.deepEqual(ok(call(a, 'bridge', 'records', { kind: 'logs', from: '2026-10-01', to: '2026-10-31' })).items, []);
  assert.equal(ok(hub.call(old.pm, 'stats')).rows.logs, undefined);
  assert.ok(!hub.tabs().includes('Daily log'), 'reading never adds the tab');
  assert.equal(ok(hub.call(old.pm, 'push', { tasks: [task()] })).tasks[0].status, 'ok');
  assert.ok(!hub.tabs().includes('Daily log'), 'nor does a push without logs');
  const devSecret = secretOf('worker-1'), entry = log('worker-1', { who: 'Eli M' });
  const r = ok(call(a, 'bridge', 'push', { opId: 'first-log-0001', expectedRev: -1, devSecret, logs: [entry] }));
  assert.equal(r.logs[0].status, 'ok');
  assert.deepEqual(hub.tabs().slice(-1), ['Daily log']);
  assert.deepEqual(hub.header('Daily log'), ['Date', 'Name', 'Crew', 'Hours', 'Entry', 'Updated', 'key', 'rev', 'data']);
  assert.equal(hub.format('Daily log').bold, true);
  assert.equal(hub.props.LOGS_TAB, '1', 'the legacy job\'s property, in the root store');
  assert.deepEqual(rowsOf(hub, 'Daily log').map(x => [x.Name, x.key]), [['Eli M', uidOf('worker-1')]]);
  assert.equal(hub.table('Operations')[0][2], 'done');
  assert.equal(ok(call(a, 'pm', 'pull', { since: 0 })).logs[0].who, 'Eli M');
  assert.equal(ok(call(a, 'pm', 'pull', { since: pulled.rev })).logs[0].who, 'Eli M', 'a phone that pulled before the tab existed gets it from its revision');
  assert.equal(ok(hub.call(old.pm, 'stats')).rows.logs, 1);
  // v1 as well: a crew phone's first log on such a Sheet.
  const env = setup(), crew = phone(env, 'crew');
  dropLogsTab(env.hub);
  assert.deepEqual(crew.pull().logs, []);
  assert.equal(ok(crew.push({ logs: [log('crew-dev')] })).logs[0].status, 'ok');
  assert.deepEqual([env.hub.tabs().slice(-1), env.hub.props.LOGS_TAB, env.hub.table('Daily log').length], [['Daily log'], '1', 1]);
  assert.equal(crew.pull().logs[0].uid, uidOf('crew-dev'));
  assert.equal(ok(crew.push({ logs: [log('crew-dev', { at: T0 - 1000 })] })).logs[0].status, 'ok', 'and the next push finds it there');
});

test('archive moves logs by date; a push of an archived log is refused; a PM purge leaves a tombstone every phone receives', () => {
  const env = setup(), crew = phone(env, 'crew'), pm = phone(env, 'pm', 'pm-dev'), { hub } = env;
  ok(crew.push({ logs: [log('crew-dev', { date: '2026-09-10', body: 'old' }), log('crew-dev', { date: '2026-10-06', body: 'kept' }), log('crew-dev', { body: 'today' })] }));
  const r = ok(pm.call('archive', { before: '2026-10-01' }));
  assert.deepEqual(r.moved, { tasks: 0, shifts: 0, reports: 0, events: 0, logs: 1 });
  const [arch] = hub.archives();
  assert.ok(hub.tabs(arch.id).includes('Daily log'));
  assert.deepEqual(hub.header('Daily log', arch.id), hub.header('Daily log'));
  assert.deepEqual(rowsOf(hub, 'Daily log', arch.id).map(x => [x.Date, x.Entry]), [['2026-09-10', 'old']]);
  assert.deepEqual(rowsOf(hub, 'Daily log').map(x => x.Entry).sort(), ['kept', 'today']);
  assert.match(hub.entities('Activity').at(-1).text, /^Archived 1 rows older than 2026-10-01$/);
  assert.equal(ok(crew.push({ logs: [log('crew-dev', { date: '2026-09-10', body: 'late edit', at: T0 - 1000 })] })).logs[0].reason, 'archived');
  // purge: PM only, by kind log or logs; the tombstone reaches the crew phone, and a stale copy cannot come back.
  assert.equal(crew.call('purge', { kind: 'logs', target: uidOf('crew-dev', '2026-10-06') }).error, 'forbidden');
  assert.equal(ok(crew.push({ deleted: [{ kind: 'logs', key: uidOf('crew-dev', '2026-10-06') }] })).deleted[0].reason, 'forbidden');
  const head = crew.pull().rev;
  ok(pm.call('purge', { kind: 'log', target: uidOf('crew-dev', '2026-10-06') }));
  assert.deepEqual(rowsOf(hub, 'Daily log').map(x => x.Entry), ['today']);
  const p = ok(crew.call('pull', { since: head }));
  assert.deepEqual(p.deleted.map(d => [d.kind, d.key]), [['logs', uidOf('crew-dev', '2026-10-06')]]);
  assert.equal(ok(crew.push({ logs: [log('crew-dev', { date: '2026-10-06', body: 'back?', at: T0 - 1000 })] })).logs[0].reason, 'deleted');
  assert.equal(hub.table('Daily log').length, 1);
});
