'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createHub } = require('./helpers/google-mock');
const jobs = import('../docs/schwab/jobs.mjs');
const NOW = Date.parse('2026-10-24T12:00:00-04:00');
const ADDRESS = 'https://example.test/schwab/tasks.html';
function memory() {
  const values = new Map();
  return { values, get length() { return values.size; }, key: i => [...values.keys()][i], getItem: k => values.get(k) ?? null,
    setItem(k, v) { values.set(k, String(v)); }, removeItem: k => values.delete(k),
    get(k, d = null) { const value = values.get(k); return value == null ? d : JSON.parse(value); },
    set(k, v) { values.set(k, JSON.stringify(v)); return true; } };
}
test('denied browser storage still loads the legacy app and reports failed saves', () => {
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    Object.defineProperty(globalThis, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
    const app = await import('./docs/schwab/shared.mjs');
    assert.equal(app.jobScope.id, '');
    assert.equal(app.KEYS.tasks, 'schwab.tasks');
    assert.deepEqual(app.load(app.KEYS.tasks, []), []);
    assert.equal(app.save(app.KEYS.tasks, []), false);
  `], { cwd: require('node:path').join(__dirname, '..'), stdio: 'pipe' });
});
test('scope is pinned across navigation and late saves; IDs, keys, PM origin and open-shift return paths are isolated', async () => {
  const { createJobScope } = await jobs, storage = memory(); let next;
  const a = createJobScope({ href: ADDRESS + '?jobId=job-A', storage, navigate: url => { next = url; } });
  a.register('job-A', 'First'); a.register('job-B', 'Second');
  const b = createJobScope({ href: ADDRESS + '?jobId=job-B', storage });
  assert.notEqual(a.key('schwab.tasks'), b.key('schwab.tasks'));
  assert.notEqual(a.key('schwab.device'), b.key('schwab.device'), 'restoring a job cannot replace another job’s clock identity');
  let finish; const late = new Promise(r => { finish = r; }).then(() => storage.set(a.key('schwab.tasks'), [{ uid: 'late-A' }]));
  a.switchTo('job-B'); finish(); await late;
  assert.equal(new URL(next).searchParams.get('jobId'), 'job-B');
  assert.equal(storage.get(b.key('schwab.tasks')), null);
  assert.equal(storage.get(a.key('schwab.tasks'))[0].uid, 'late-A');
  storage.set(a.key('schwab.hours'), [{ id: 'open-A', date: '2026-10-24', in: '07:00', out: '' }]);
  assert.equal(new URL(b.openShifts()[0].url).searchParams.get('jobId'), 'job-A');
  assert.equal(new URL(b.openShifts()[0].url).hash, '#clock/2026-10-24');
  assert.equal(a.pmUrl(), 'https://harrison-electrical-pm.clever-tern-3085.chatgpt.site/projects/job-A/pm-records');
  const invalid = createJobScope({ href: ADDRESS + '?jobId=..%2Fsecret', storage });
  assert.equal(invalid.status(), 'invalid_job'); assert.equal(invalid.pmUrl(), '');
  assert.notEqual(invalid.key('schwab.tasks'), 'schwab.tasks');
});
test('explicit original-job migration copies raw bytes, verifies, retains originals and rejects nonempty destinations or a second binding', async () => {
  const { createJobScope } = await jobs, storage = memory();
  storage.setItem('schwab.tasks', ' [ {"uid":"historic"} ] '); storage.set('schwab.settings', { project: 'Schwab', hubKey: 'old-key' });
  const legacy = createJobScope({ href: ADDRESS, storage });
  assert.equal(legacy.key('schwab.tasks'), 'schwab.tasks');
  assert.throws(() => legacy.migrate('original', 'Schwab'), /confirm_original/);
  storage.set('fieldHub.job.occupied.tasks', [{ uid: 'other-job' }]);
  assert.throws(() => legacy.migrate('occupied', 'Other', true), /destination_not_empty/);
  const before = storage.getItem('schwab.tasks'); legacy.migrate('original', 'Schwab', true);
  const scoped = createJobScope({ href: ADDRESS + '?jobId=original', storage });
  assert.equal(storage.getItem(scoped.key('schwab.tasks')), before); assert.equal(storage.getItem('schwab.tasks'), before);
  assert.equal(scoped.status(), ''); assert.equal(scoped.needsConnection(), true);
  assert.throws(() => legacy.migrate('different', 'Wrong', true), /original_already_bound/);
  assert.equal(legacy.key('schwab.tasks'), 'schwab.tasks', 'existing phone stays on legacy namespace');
});
test('old-tab changes pause the copy; explicit unchanged-destination reconciliation works; edits on both sides stop', async () => {
  const { createJobScope } = await jobs, storage = memory();
  storage.set('schwab.tasks', [{ uid: 'old' }]);
  const legacy = createJobScope({ href: ADDRESS, storage }); legacy.migrate('original', 'Original', true);
  const scoped = createJobScope({ href: ADDRESS + '?jobId=original', storage });
  storage.set('schwab.tasks', [{ uid: 'old-tab-change' }]);
  assert.equal(scoped.status(), 'legacy_changed'); assert.throws(() => scoped.assertWritable(), /legacy_changed/);
  legacy.migrate('original', 'Original', true);
  assert.equal(scoped.status(), ''); assert.equal(storage.get(scoped.key('schwab.tasks'))[0].uid, 'old-tab-change');
  storage.set(scoped.key('schwab.tasks'), [{ uid: 'new-side' }]); storage.set('schwab.tasks', [{ uid: 'old-side' }]);
  assert.throws(() => legacy.migrate('original', 'Original', true), /both_changed/);
  assert.equal(scoped.status(), 'legacy_changed'); assert.equal(storage.get(scoped.key('schwab.tasks'))[0].uid, 'new-side');
});

test('removing a legacy store cannot silently commit a stale migrated copy', async () => {
  const { createJobScope } = await jobs, storage = memory();
  storage.set('schwab.tasks', [{ uid: 'old' }]); storage.set('schwab.hours', []);
  const legacy = createJobScope({ href: ADDRESS, storage }); legacy.migrate('original', 'Original', true);
  storage.removeItem('schwab.tasks');
  assert.throws(() => legacy.migrate('original', 'Original', true), /both_changed/);
  assert.equal(storage.get('fieldHub.job.original.tasks')[0].uid, 'old');
});
test('interrupted copying is blocked and resumable without deleting original data', async () => {
  const { createJobScope } = await jobs, storage = memory(), set = storage.setItem;
  storage.set('schwab.tasks', [{ uid: 'historic' }]); storage.set('schwab.reports', {});
  let fail = true;
  storage.setItem = function(k, v) { if (fail && k === 'fieldHub.job.original.tasks') { fail = false; throw Error('full'); } set.call(this, k, v); };
  const legacy = createJobScope({ href: ADDRESS, storage });
  assert.throws(() => legacy.migrate('original', 'Original', true), /full/);
  const scoped = createJobScope({ href: ADDRESS + '?jobId=original', storage });
  assert.equal(scoped.status(), 'migration_incomplete'); assert.equal(storage.get('schwab.tasks')[0].uid, 'historic');
  legacy.migrate('original', 'Original', true); assert.equal(scoped.status(), '');
});

async function syncFixture() {
  const { createJobScope } = await jobs, { makeSync } = await import('../docs/schwab/sync.mjs');
  const { normTask } = await import('../docs/schwab/shared.mjs');
  const server = createHub({ now: NOW }); server.setup();
  const credentials = Object.fromEntries(['crew', 'super', 'pm', 'bridge'].map(r => [r + 'Key', crypto.createHash('sha256').update('client-' + r).digest('hex').slice(0, 32)]));
  server.props.FH_SETUP = JSON.stringify({ jobId: 'job-A', label: 'A', legacy: false, ...credentials });
  const job = server.run('configureFieldHubJob');
  const storage = memory(), scope = createJobScope({ href: ADDRESS + '?jobId=job-A', storage });
  const secret = 'd'.repeat(32), device = crypto.createHash('sha256').update(secret).digest('hex').slice(0, 32);
  storage.set(scope.key('schwab.device'), { id: device, secret });
  storage.set(scope.key('schwab.settings'), { role: 'Superintendent', me: 'Owner', project: 'A', floors: [], crews: [], people: [], checks: [], hubRole: 'super', hubUrl: 'https://script.google.com/macros/s/test/exec', hubKey: credentials.superKey });
  storage.set(scope.key('schwab.tasks'), [normTask({ uid: 'task-A', date: '2026-10-24', id: 'A1', origin: 'mine', scope: 'First version', assignAt: NOW - 1000, updatedAt: NOW - 1000, sentAt: NOW - 1000 })]);
  const requests = [], control = { lose: false, delay: null, reply: null };
  const fetchImpl = async (_url, init) => {
    const req = JSON.parse(init.body); requests.push(req);
    if (control.delay) await control.delay(req);
    const response = server.send(req);
    if (control.lose && req.action === 'push' && response.ok) { control.lose = false; throw Error('lost response'); }
    return { status: 200, json: async () => control.reply ? control.reply(response, req) : response };
  };
  const newSync = () => makeSync({ scope, storage, fetchImpl, now: () => NOW, ensureDevice: async () => device, timers: { set: () => 1, clear: () => {} } });
  return { server, job, credentials, storage, scope, requests, control, newSync };
}
test('v2 lost push response replays the exact durable request after reload and preserves newer offline edits', async () => {
  const f = await syncFixture(); f.control.lose = true;
  await f.newSync().cycle();
  const first = f.requests.find(r => r.action === 'push');
  assert.equal(first.v, 2); assert.equal(first.jobId, 'job-A'); assert.match(first.opId, /^[A-Za-z0-9_-]{8,80}$/); assert.equal(Number.isInteger(first.expectedRev), true);
  assert.ok(f.storage.get(f.scope.key('schwab.hubPending')));
  const tasks = f.storage.get(f.scope.key('schwab.tasks')); tasks[0].scope = 'Edited after timeout'; tasks[0].assignAt = NOW + 1; tasks[0].updatedAt = NOW + 1; f.storage.set(f.scope.key('schwab.tasks'), tasks);
  await f.newSync().cycle();
  const pushes = f.requests.filter(r => r.action === 'push');
  assert.deepEqual(pushes[1], first, 'retry recovers receipt before scanning a changed local record');
  assert.equal(f.storage.get(f.scope.key('schwab.hubPending')), null);
  assert.equal(f.storage.get(f.scope.key('schwab.tasks'))[0].scope, 'Edited after timeout');
  assert.ok(pushes.slice(2).some(r => r.opId !== first.opId), 'later edit receives its own operation');
  const sheetId = f.job.sheetUrl.split('/')[5];
  assert.equal(f.server.entities('Tasks', sheetId).length, 1);
  assert.equal(f.server.entities('Tasks', sheetId)[0].scope, 'Edited after timeout');
});
test('a delayed job-A sync response cannot write job-B records after full-navigation selection', async () => {
  const f = await syncFixture(); let release, started;
  const waiting = new Promise(r => { started = r; });
  f.control.delay = async req => { if (req.action === 'pull') { f.control.delay = null; started(); await new Promise(r => { release = r; }); } };
  const run = f.newSync().cycle(); await waiting;
  const { createJobScope } = await jobs;
  const b = createJobScope({ href: ADDRESS + '?jobId=job-B', storage: f.storage });
  f.storage.set(b.key('schwab.tasks'), [{ uid: 'B-only' }]); release(); await run;
  assert.deepEqual(f.storage.get(b.key('schwab.tasks')), [{ uid: 'B-only' }]);
  assert.ok(f.requests.every(r => r.jobId === 'job-A'));
});

test('wrong job and changed instance replies are rejected; bridge credentials never enter browser settings', async () => {
  const f = await syncFixture(), settingsKey = f.scope.key('schwab.settings');
  f.control.reply = (reply, req) => req.action === 'pull' ? { ...reply, jobId: 'job-B' } : reply;
  assert.equal((await f.newSync().cycle()).state, 'error');
  assert.equal(f.requests.some(r => r.action === 'push'), false);
  f.control.reply = null;
  await f.newSync().cycle();
  const pin = f.storage.get(f.scope.key('schwab.hubInstance'));
  assert.match(pin.instanceId, /^[0-9a-f]{32}$/);
  f.control.reply = reply => ({ ...reply, instanceId: 'f'.repeat(32) });
  const changed = await f.newSync().cycle();
  assert.equal(changed.state, 'error'); assert.match(changed.message, /different Hub instance/);
  assert.deepEqual(f.storage.get(f.scope.key('schwab.hubInstance')), pin);
  f.control.reply = null;
  const prior = f.storage.get(settingsKey).hubKey;
  const bridge = await f.newSync().connect(f.storage.get(settingsKey).hubUrl, f.credentials.bridgeKey);
  assert.equal(bridge.ok, false); assert.equal(bridge.error, 'forbidden');
  assert.equal(f.storage.get(settingsKey).hubKey, prior);
});

test('a stale v2 revision clears the rejected attempt and pulls before creating a new operation', async () => {
  const f = await syncFixture(); let raced = false;
  f.control.delay = async req => {
    if (req.action !== 'push' || raced) return;
    raced = true;
    const accepted = f.server.send({ ...req, opId: 'concurrent-writer' });
    assert.equal(accepted.ok, true);
  };
  const result = await f.newSync().cycle();
  assert.equal(result.state, 'error'); assert.match(result.message, /changed on the hub/i);
  assert.equal(f.storage.get(f.scope.key('schwab.hubPending')), null);
  const n = f.requests.length;
  const next = await f.newSync().cycle();
  assert.equal(next.state, 'live'); assert.equal(f.requests[n].action, 'pull');
  const pushes = f.requests.filter(r => r.action === 'push');
  assert.equal(new Set(pushes.map(r => r.opId)).size, pushes.length);
});

test('an old-tab change while a response is in flight stops the scoped response before local writes', async () => {
  const f = await syncFixture();
  const { MIGRATION_KEY } = await jobs;
  f.storage.set(MIGRATION_KEY, { jobId: 'job-A', phase: 'committed', source: {}, connected: true });
  f.control.reply = reply => { f.storage.set('schwab.tasks', [{ uid: 'old-tab' }]); return reply; };
  const before = f.storage.get(f.scope.key('schwab.tasks'));
  assert.equal((await f.newSync().cycle()).state, 'error');
  assert.equal(f.scope.status(), 'legacy_changed');
  assert.deepEqual(f.storage.get(f.scope.key('schwab.tasks')), before);
  assert.equal(f.storage.get(f.scope.key('schwab.hubInstance')), null);
  assert.equal(f.requests.some(r => r.action === 'push'), false);
});

test('new canonical jobs have empty templates and scoped backups reject other jobs, changed instances and uncertain restores', () => {
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const values = new Map();
    globalThis.location = { href: '${ADDRESS}?jobId=job-B' };
    globalThis.localStorage = { get length() { return values.size; }, key: i => [...values.keys()][i], getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,String(v)), removeItem: k => values.delete(k) };
    const app = await import('./docs/schwab/shared.mjs');
    const s = app.normSettings(null);
    for (const k of ['floors', 'crews', 'people', 'checks']) assert.deepEqual(s[k], []);
    assert.equal(s.project, 'job-B');
    assert.equal(app.save(app.KEYS.tasks, [{ uid: 'B-only' }]), true);
    const backup = app.backupData();
    assert.equal(backup.__fieldHub.jobId, 'job-B');
    assert.equal(Object.keys(backup).some(k => k.startsWith('schwab.')), false);
    assert.equal(app.isBackup({ ...backup, __fieldHub: { v:2, jobId:'job-A' } }), false);
    const pinKey = app.jobKey('schwab.hubInstance');
    app.save(pinKey, { url:'hub', instanceId:'one' });
    assert.equal(app.isBackup({ ...backup, [pinKey]: { url:'hub', instanceId:'two' } }), false);
    app.save(app.jobKey('schwab.hubPending'), { opId:'uncertain' });
    assert.equal(app.restoreData(backup), false);
    assert.deepEqual(app.load(app.KEYS.tasks, []), [{ uid:'B-only' }]);
  `], { cwd: require('node:path').join(__dirname, '..'), stdio: 'pipe' });
});
