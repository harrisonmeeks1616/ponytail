'use strict';
process.env.TZ = 'America/New_York';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createHub } = require('./helpers/google-mock');
const NOW = Date.parse('2026-10-24T12:00:00-04:00');
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const keys = job => Object.fromEntries(['crew', 'super', 'pm', 'bridge'].map(r => [r + 'Key', hash(job + r).slice(0, 32)]));
function provision(hub, jobId, legacy = false) {
  const secret = keys(jobId);
  hub.props.FH_SETUP = JSON.stringify({ jobId, label: jobId, legacy, ...secret });
  const job = hub.run('configureFieldHubJob');
  return { ...job, ...secret, sheetId: job.sheetUrl.split('/')[5] };
}
function environment() {
  const hub = createHub({ now: NOW }), old = hub.setup(), a = provision(hub, 'pm-schwab', true), b = provision(hub, 'pm-new');
  const call = (j, role, action, more = {}) => hub.send({ v: 2, jobId: j.jobId, key: j[role + 'Key'], action, ...more });
  return { hub, old, a, b, call };
}
const task = (scope = 'Pull cable', uid = 'same-id') => ({ uid, id: 'Same label', date: '2026-10-24', crew: 'Same crew', scope, assignAt: NOW - 1000, sentAt: NOW - 1000 });
const accepted = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r; };

test('v1 stays on its original Sheet; identical ids/dates are isolated in two v2 jobs and caches', () => {
  const { hub, old, a, b, call } = environment();
  assert.equal(a.sheetId, hub.sheetId());
  assert.notEqual(a.sheetId, b.sheetId);
  assert.equal(hub.props.PM_KEY_SHA256, hash(old.pm));
  accepted(hub.call(old.super, 'push', { tasks: [task('Legacy Schwab')] }));
  const result = accepted(call(b, 'super', 'push', { opId: 'new-job-0001', expectedRev: 0, tasks: [task('Only new job')] }));
  assert.equal(result.jobId, b.jobId);
  assert.equal(result.instanceId, b.instanceId);
  for (let i = 0; i < 2; i++) {
    assert.equal(accepted(call(a, 'pm', 'pull', { since: 0 })).tasks[0].scope, 'Legacy Schwab');
    assert.equal(accepted(call(b, 'pm', 'pull', { since: 0 })).tasks[0].scope, 'Only new job');
    assert.equal(accepted(hub.call(old.pm, 'pull', { since: 0, jobId: b.jobId })).tasks[0].scope, 'Legacy Schwab');
  }
  assert.equal(hub.table('Tasks', a.sheetId).length, 1);
  assert.equal(hub.table('Tasks', b.sheetId).length, 1);
});

test('wrong-job and legacy credentials cannot select a new Sheet; bridge has no admin, config, or deletion powers', () => {
  const { hub, old, a, b, call } = environment();
  hub.calls.length = 0;
  assert.equal(call(b, 'pm', 'pull', { key: a.pmKey }).error, 'unauthorized');
  assert.equal(call(b, 'pm', 'pull', { key: old.pm }).error, 'unauthorized');
  assert.equal(hub.calls.length, 0, 'authentication failed before a Sheet API call');
  const who = accepted(call(b, 'bridge', 'whoami'));
  assert.equal(who.role, 'bridge');
  assert.ok(who.capabilities.includes('fence'), 'new callers can verify support before relying on a fence');
  assert.equal(who.sheetUrl, undefined);
  for (const action of ['keys', 'rotate', 'purge', 'archive', 'selftest', 'stats', 'translate']) assert.equal(call(b, 'bridge', action).error, 'forbidden');
  for (const extra of [{ config: {} }, { deleted: [{ kind: 'tasks', key: 'x' }] }]) assert.equal(call(b, 'bridge', 'push', { opId: 'forbidden-1', expectedRev: 0, tasks: [task()], ...extra }).error, 'forbidden');
  assert.equal(call(b, 'bridge', 'push', { opId: 'two-records', expectedRev: 0, tasks: [task(), task('', 'other')] }).error, 'bad_request');
  assert.equal(call(b, 'pm', 'keys').error, 'forbidden');
});

test('durable receipt replays exactly once after the atomic write response is lost', () => {
  const { hub, b, call } = environment();
  const req = { opId: 'lost-reply-01', expectedRev: 0, tasks: [task()] };
  hub.failNext('sheets.spreadsheets.batchUpdate:after');
  assert.equal(call(b, 'bridge', 'push', req).error, 'server');
  assert.equal(hub.table('Tasks', b.sheetId).length, 1, 'source write was accepted');
  const events = hub.table('Activity', b.sheetId).length;
  const result = accepted(call(b, 'bridge', 'push', req));
  assert.equal(result.tasks[0].task.scope, 'Pull cable');
  assert.equal(hub.table('Tasks', b.sheetId).length, 1);
  assert.equal(hub.table('Activity', b.sheetId).length, events, 'same activity was not appended twice');
  assert.deepEqual(accepted(call(b, 'bridge', 'push', req)), result);
  assert.equal(call(b, 'bridge', 'push', { ...req, tasks: [task('Different')] }).error, 'conflict');
  assert.equal(call(b, 'bridge', 'push', { ...req, opId: 'stale-new-id' }).error, 'conflict');
  assert.equal(hub.table('Operations', b.sheetId).length, 1);
  assert.equal(hub.table('Operations', b.sheetId)[0][2], 'done');
  assert.equal(hub.entities('Activity', b.sheetId)[0].role, 'bridge');
});

test('v2 bridge revision fence is idempotent, advances an empty job, and rejects stale pushes without changing source rows', () => {
  const { hub, old, a, b, call } = environment();
  const devSecret = 'a'.repeat(32), req = { opId: 'fence-empty-001', expectedRev: 0, devSecret };
  const tabs = ['Tasks', 'Hours', 'Reports', 'Daily log', 'Activity', 'Deleted', 'Config'];
  const before = Object.fromEntries(tabs.map(t => [t, JSON.stringify(hub.table(t, b.sheetId))]));
  const first = accepted(call(b, 'bridge', 'fence', req));
  assert.equal(first.rev, 1);
  assert.deepEqual(accepted(call(b, 'bridge', 'fence', req)), first, 'same receipt, same revision');
  assert.equal(hub.table('Operations', b.sheetId).length, 1);
  assert.equal(call(b, 'bridge', 'push', { opId: 'old-write-001', expectedRev: 0, tasks: [task()] }).error, 'conflict');
  assert.deepEqual(Object.fromEntries(tabs.map(t => [t, JSON.stringify(hub.table(t, b.sheetId))])), before, 'no workforce, config or activity rows changed');
  assert.equal(accepted(call(b, 'pm', 'pull', { since: 0 })).rev, 1);
  assert.equal(accepted(hub.call(old.pm, 'pull', { since: 0 })).rev, accepted(call(a, 'pm', 'pull', { since: 0 })).rev, 'other jobs remain untouched');
  assert.equal(call(b, 'bridge', 'fence', { ...req, expectedRev: 1 }).error, 'conflict', 'opId cannot be reused for another payload');
  assert.equal(call(b, 'pm', 'fence', req).error, 'forbidden');
  assert.equal(call(b, 'super', 'fence', req).error, 'forbidden');
  assert.equal(call(b, 'crew', 'fence', req).error, 'forbidden');
  assert.equal(call(b, 'bridge', 'fence', { ...req, key: a.bridgeKey }).error, 'unauthorized', 'a credential for another job cannot fence this one');
  assert.equal(hub.call(old.pm, 'fence', req).error, 'forbidden');
  assert.equal(call(b, 'bridge', 'fence', { ...req, opId: 'fence-nosecret', devSecret: '' }).error, 'bad_request');
  assert.equal(call(b, 'bridge', 'fence', { ...req, opId: 'fence-shortsecret', devSecret: 'a'.repeat(31) }).error, 'bad_request');
  assert.equal(call(b, 'bridge', 'fence', { ...req, opId: 'fence-badsecret1', devSecret: '!'.repeat(32) }).error, 'bad_request');
  assert.equal(call(b, 'bridge', 'fence', { ...req, opId: 'fence-badrev1', expectedRev: -1 }).error, 'bad_request');
  assert.equal(call(b, 'bridge', 'fence', { ...req, opId: 'fence-malform', expectedRev: 1, logs: [] }).error, 'bad_request');
});

test('v2 revision fence recovers an interrupted or completed atomic receipt before new writes', () => {
  for (const mode of ['sheets.spreadsheets.values.batchUpdate', 'sheets.spreadsheets.batchUpdate', 'sheets.spreadsheets.batchUpdate:after']) {
    const { hub, b, call } = environment();
    const req = { opId: 'fence-crash-001', expectedRev: 0, devSecret: 'a'.repeat(32) };
    hub.failNext(mode);
    assert.equal(call(b, 'bridge', 'fence', req).error, 'server', mode);
    const saved = accepted(call(b, 'bridge', 'fence', req));
    assert.equal(saved.rev, 1, mode);
    assert.deepEqual(accepted(call(b, 'bridge', 'fence', req)), saved, mode);
    assert.equal(call(b, 'bridge', 'push', { opId: 'old-after-crash', expectedRev: 0, tasks: [task()] }).error, 'conflict', mode);
    assert.equal(hub.table('Tasks', b.sheetId).length, 0);
    assert.equal(hub.table('Operations', b.sheetId).length, 1);
  }
});

test('v2 revision fence repairs a failed REV property write before the next reader or writer', () => {
  const { hub, b, call } = environment();
  const req = { opId: 'fence-props-001', expectedRev: 0, devSecret: 'a'.repeat(32) };
  const prop = 'J' + hash(b.jobId).slice(0, 24) + ':REV';
  hub.failNext('properties.setProperty:' + prop, 2); // finish and the lock's final revision write both fail
  assert.equal(call(b, 'bridge', 'fence', req).error, 'server');
  assert.equal(hub.props[prop], '0', 'failed writes did not persist the revision');
  assert.equal(hub.table('Operations', b.sheetId)[0][2], 'done', 'the atomic receipt did land');
  const pull = accepted(call(b, 'pm', 'pull', { since: 0 }));
  assert.equal(pull.rev, 1, 'the next read repairs the receipt before replying');
  assert.equal(accepted(call(b, 'bridge', 'fence', req)).rev, 1, 'replay is the original result');
  assert.equal(call(b, 'bridge', 'push', { opId: 'old-props-001', expectedRev: 0, tasks: [task()] }).error, 'conflict');
});

test('v2 revision fence is recovered by a v1 reader on the shared legacy Hub', () => {
  const { hub, old, a, call } = environment();
  const req = { opId: 'fence-v1-read01', expectedRev: 0, devSecret: 'a'.repeat(32) };
  hub.failNext('sheets.spreadsheets.batchUpdate');
  assert.equal(call(a, 'bridge', 'fence', req).error, 'server');
  assert.equal(accepted(hub.call(old.pm, 'pull', { since: 0 })).rev, 1, 'legacy reader first finishes the pending fence');
  assert.equal(accepted(call(a, 'bridge', 'fence', req)).rev, 1);
});

test('a v2 revision fence serializes against other writers, but a legacy blind log push remains outside its protection', () => {
  const { hub, b, call } = environment();
  const devSecret = 'a'.repeat(32);
  const write = accepted(call(b, 'bridge', 'push', { opId: 'first-writer-01', expectedRev: 0, tasks: [task()] }));
  assert.equal(call(b, 'bridge', 'fence', { opId: 'fence-stale-001', expectedRev: 0, devSecret }).error, 'conflict');
  const fence = accepted(call(b, 'bridge', 'fence', { opId: 'fence-fresh-001', expectedRev: write.rev, devSecret }));
  assert.equal(fence.rev, write.rev + 1);
  assert.equal(call(b, 'bridge', 'push', { opId: 'old-after-fence', expectedRev: write.rev, tasks: [task('Old', 'other')] }).error, 'conflict');
  const worker = hash(devSecret).slice(0, 32), date = '2026-10-24';
  const uid = 'wl-' + worker.slice(0, 12) + '-' + date;
  const blind = call(b, 'bridge', 'push', { opId: 'blind-after-001', expectedRev: -1, devSecret, logs: [{ uid, date, device: worker, who: 'Test', body: 'Fictional', at: NOW }] });
  assert.equal(blind.ok, true, 'the separate -1 drain gate is still required');
  assert.equal(blind.logs[0].status, 'ok');
});

test('old v1 clients continue reading and writing after a legacy-job fence, and their blind writes require a separate gate', () => {
  const { hub, old, a, call } = environment();
  const devSecret = 'a'.repeat(32), worker = hash(devSecret).slice(0, 32), date = '2026-10-24';
  const uid = 'wl-' + worker.slice(0, 12) + '-' + date;
  assert.equal(accepted(call(a, 'bridge', 'fence', { opId: 'fence-legacy-01', expectedRev: 0, devSecret })).rev, 1);
  const read = accepted(hub.call(old.crew, 'pull', { since: 0, devSecret }));
  assert.equal(read.rev, 1);
  const write = accepted(hub.call(old.crew, 'push', { devSecret, logs: [{ uid, date, who: 'Test', body: 'Fictional', at: NOW }] }));
  assert.equal(write.logs[0].status, 'ok', 'old v1 pushes have no expected revision and are not fenced');
  assert.equal(hub.table('Daily log', a.sheetId).length, 1);
});

test('an interrupted intent is recoverable before a later writer can move its rows', () => {
  const { hub, b, call } = environment();
  const req = { opId: 'intent-failed', expectedRev: 0, tasks: [task()] };
  hub.failNext('sheets.spreadsheets.batchUpdate');
  assert.equal(call(b, 'bridge', 'push', req).error, 'server');
  assert.equal(hub.table('Tasks', b.sheetId).length, 0);
  assert.equal(hub.table('Operations', b.sheetId)[0][2], 'prepared');
  const pulled = accepted(call(b, 'pm', 'pull', { since: 0 }));
  assert.equal(pulled.tasks[0].scope, 'Pull cable', 'read repairs the pending atomic operation first');
  accepted(call(b, 'pm', 'push', { opId: 'next-writer-01', expectedRev: pulled.rev, tasks: [task('Second', 'second')] }));
  accepted(call(b, 'bridge', 'push', req));
  assert.equal(hub.table('Tasks', b.sheetId).length, 2);
});

test('missing intent row cannot lose or redirect a subsequent retry', () => {
  const { hub, b, call } = environment();
  const req = { opId: 'no-intent-row', expectedRev: 0, tasks: [task()] };
  hub.failNext('sheets.spreadsheets.values.batchUpdate');
  assert.equal(call(b, 'bridge', 'push', req).error, 'server');
  assert.equal(hub.table('Tasks', b.sheetId).length, 0);
  assert.equal(hub.table('Operations', b.sheetId).length, 0);
  accepted(call(b, 'bridge', 'push', req));
  assert.equal(hub.table('Tasks', b.sheetId).length, 1);
});

test('v2 role batches preserve config, tombstones and merge partitions through retry', () => {
  const { hub, b, call } = environment();
  const req = { opId: 'batch-full-001', expectedRev: 0, tasks: [task(), task('Other', 'other')], config: { project: 'New job', at: NOW, people: [], crews: [] } };
  const saved = accepted(call(b, 'pm', 'push', req));
  assert.equal(saved.tasks.length, 2);
  const del = { opId: 'batch-delete01', expectedRev: saved.rev, deleted: [{ kind: 'tasks', key: 'other' }] };
  hub.failNext('sheets.spreadsheets.batchUpdate:after');
  assert.equal(call(b, 'pm', 'push', del).error, 'server');
  accepted(call(b, 'pm', 'push', del));
  assert.equal(hub.table('Tasks', b.sheetId).length, 1);
  assert.equal(hub.table('Deleted', b.sheetId).length, 1);
  assert.equal(accepted(call(b, 'pm', 'pull', { since: 0 })).config.project, 'New job');
});

test('weekly repair is scoped and a failed derived write recovers without duplicate shift or activity', () => {
  const { hub, a, b, call } = environment();
  const req = { opId: 'weekly-failure', expectedRev: 0, shifts: [{ id: 's1', who: 'Dana', date: '2026-10-24', in: '07:00', out: '08:00', at: NOW }] };
  hub.failNext('sheets.spreadsheets.values.clear');
  assert.equal(call(b, 'bridge', 'push', req).error, 'server');
  assert.equal(hub.props.WEEKLY_DIRTY, undefined, 'new-job dirty marker never touches legacy state');
  accepted(call(a, 'pm', 'pull', { since: 0 }));
  assert.equal(hub.table('Hours', a.sheetId).length, 0);
  accepted(call(b, 'bridge', 'push', req));
  assert.equal(hub.table('Hours', b.sheetId).length, 1);
  assert.equal(hub.table('Weekly totals', b.sheetId)[0][2], 1);
});

test('creation intent prevents duplicate Sheets on uncertain create, with explicit safe recovery', () => {
  const hub = createHub({ now: NOW }); hub.setup();
  const input = { jobId: 'fresh-job', label: 'Fresh', legacy: false, ...keys('fresh-job') };
  hub.props.FH_SETUP = JSON.stringify(input);
  hub.failNext('sheets.spreadsheets.create:after');
  assert.throws(() => hub.run('configureFieldHubJob'));
  assert.equal(hub.spreadsheets.size, 2);
  assert.throws(() => hub.run('configureFieldHubJob'), /Changed on the hub/);
  assert.equal(hub.spreadsheets.size, 2, 'retry did not create another Sheet');
  const recoveryId = [...hub.spreadsheets.keys()].find(id => id !== hub.sheetId());
  hub.props.FH_SETUP = JSON.stringify({ ...input, recoverSheetId: recoveryId });
  const done = hub.run('configureFieldHubJob');
  assert.equal(done.ready, true);
  assert.equal(hub.props.FH_SETUP, undefined);
  hub.props.FH_SETUP = JSON.stringify(input);
  assert.equal(hub.run('configureFieldHubJob').instanceId, done.instanceId);
  assert.equal(hub.spreadsheets.size, 2);
  for (const secret of Object.values(keys('fresh-job'))) assert.ok(!hub.logs.join('\n').includes(secret), 'new credentials never logged');
});

test('archival horizons, translation quota and rate limits are scoped by job', () => {
  const { hub, a, b, call } = environment();
  hub.props.ARCHIVED_BEFORE = '2026-10-25';
  const one = accepted(call(a, 'bridge', 'push', { opId: 'archived-a-01', expectedRev: 0, tasks: [task()] }));
  assert.equal(one.tasks[0].reason, 'archived');
  assert.equal(accepted(call(b, 'bridge', 'push', { opId: 'current-b-01', expectedRev: 0, tasks: [task()] })).tasks[0].status, 'ok');
  accepted(call(b, 'super', 'translate', { from: 'en', to: 'es', items: ['hello'] }));
  assert.equal(hub.props.TR_N, undefined);
  assert.equal(Object.entries(hub.props).find(([k]) => k.endsWith(':TR_N'))[1], '1');
  const rateKeys = [...hub.cache.keys()].filter(k => k.includes(':pk:bridge'));
  assert.equal(rateKeys.length, 2);
});

test('revoking one v2 binding stops its reads and writes without touching another job or legacy keys', () => {
  const { hub, old, a, b, call } = environment();
  hub.props.FH_REVOKE = JSON.stringify({ jobId: b.jobId, credentialHash: hash(b.bridgeKey) });
  assert.equal(hub.run('revokeFieldHubCredential').revoked, true);
  assert.equal(call(b, 'bridge', 'whoami').error, 'unauthorized');
  assert.equal(call(b, 'bridge', 'push', { opId: 'revoked-push', expectedRev: 0, tasks: [task()] }).error, 'unauthorized');
  accepted(call(a, 'bridge', 'whoami'));
  accepted(call(b, 'pm', 'whoami'));
  accepted(hub.call(old.pm, 'whoami'));
});

test('typed atomic cell values keep spreadsheet formula text inert', () => {
  const { hub, b, call } = environment();
  accepted(call(b, 'bridge', 'push', { opId: 'formula-literal', expectedRev: 0, tasks: [task('=HYPERLINK("https://example.invalid","read")')] }));
  assert.equal(hub.formulaCells().length, 0);
  assert.equal(hub.entities('Tasks', b.sheetId)[0].scope, '=HYPERLINK("https://example.invalid","read")');
});
