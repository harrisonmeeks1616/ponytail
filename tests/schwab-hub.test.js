'use strict';
// The hub server (docs/schwab/hub/Code.gs) against an in-memory fake of the Google services it uses
// (tests/helpers/google-mock.js). Nothing here touches Google; it checks the rules, not Google's behavior.
// Knobs for debugging: HUB_HISTORIES (random histories, default 300), HUB_SEED (run one history), HUB_TRACE (a shift id to
// print while a history runs), HUB_CODE_PATH (test a modified copy of Code.gs, for mutation runs).
process.env.TZ = 'America/New_York'; // before any Date use: the hours math depends on the job's time zone

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createHub } = require('./helpers/google-mock');

const DIR = path.join(__dirname, '..', 'docs', 'schwab');
const CODE = fs.readFileSync(process.env.HUB_CODE_PATH || path.join(DIR, 'hub', 'Code.gs'), 'utf8');
const T0 = Date.parse('2026-10-19T12:00:00-04:00'); // a Monday, noon
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const ROLES = ['crew', 'super', 'pm'];

// ---------- helpers ----------
function setup(opts = {}) {
  const hub = createHub({ now: T0, ...opts });
  return { hub, k: hub.setup() };
}
// A phone is its device secret: the hub derives the device id from it and ignores any id a request claims (HUB.md,
// Identity). Tests name phones by a label; ID(label) is the device id that phone's shifts carry.
const secretOf = label => sha('device secret ' + label).slice(0, 32);
const ID = label => sha(secretOf(label)).slice(0, 32);
function phone(env, role, label = role + '-dev') {
  const p = {
    role, label, secret: secretOf(label), dev: ID(label), key: env.k[role],
    call: (action, extra = {}) => env.hub.call(p.key, action, { devSecret: p.secret, ...extra }),
    push: body => p.call('push', body),
    pull: extra => p.call('pull', { since: 0, ...extra }),
  };
  return p;
}
const task = (o = {}) => ({ uid: 'u1', id: 'T1019-01', date: '2026-10-19', by: 'Sam', crew: 'Crew A', floor: 'Level 3', scope: 'Pull 12 AWG',
  items: [{ id: 'i1', text: 'Pull' }, { id: 'i2', text: 'Terminate' }], checks: [{ id: 'c1', text: 'Labeling' }], assignAt: T0 - 5000, ...o });
const shift = (o = {}) => ({ id: 's1', device: ID('crew-dev'), who: 'Dana R', date: '2026-10-19', in: '07:00', out: '', at: T0 - 4000, ...o });
const report = (o = {}) => ({ date: '2026-10-19', super: 'Sam', status: 'On plan', results: 'Good day',
  decisions: [{ q: 'Which panel?', rec: 'LP-1' }, { q: 'Fire stop?', rec: 'Yes' }], updatedAt: T0 - 3000, ...o });
const one = (r, kind) => { const x = r[kind + 's'][0]; return x[kind] ? { ...x[kind], _status: x.status } : x; };
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r; };
// Seed many entities through the real push path (200 per call).
function seed(p, kind, list) {
  for (let i = 0; i < list.length; i += 200) ok(p.push({ [kind]: list.slice(i, i + 200) }));
}
// What the owner reads in the Sheet: the readable cells of a tab as header -> value objects.
function rowsOf(hub, title) {
  const head = hub.header(title);
  return hub.table(title).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
}

// ---------- the Sheet, keys, manifest, code hygiene ----------
test('setupHub: every tab labeled, bold frozen headers, narrow data column; keys made and kept the safe way', () => {
  const { hub, k } = setup();
  assert.deepEqual(hub.tabs(), ['Tasks', 'Hours', 'Weekly totals', 'Reports', 'Activity', 'Deleted', 'Config']);
  assert.deepEqual(hub.header('Tasks'), ['Date', 'Task ID', 'Crew', 'Floor', 'Area', 'Status', 'Steps done', 'Minutes worked', 'Scope', 'Completed', 'Remaining', 'Crew comments', 'Review', 'Follow-up', 'Reply', 'Updated', 'key', 'rev', 'data']);
  assert.deepEqual(hub.header('Hours').slice(0, 9), ['Name', 'Week of', 'Date', 'Day', 'Clock in', 'Clock out', 'Hours', 'Edited by PM', 'Note']);
  assert.deepEqual(hub.header('Weekly totals'), ['Name', 'Week of', 'Hours', 'Shifts', 'Open shifts']);
  assert.deepEqual(hub.header('Reports'), ['Date', 'Superintendent', 'Status', 'Results', 'Wins', 'Issues', 'Decisions waiting', 'PM review', 'key', 'rev', 'data']);
  assert.deepEqual(hub.header('Activity'), ['When', 'Who', 'What', 'Ref', 'key', 'rev', 'data']);
  assert.deepEqual(hub.header('Deleted'), ['key', 'kind', 'rev', 'when']);
  for (const title of hub.tabs()) {
    const f = hub.format(title), head = hub.header(title), last = head.length - 1;
    assert.equal(f.frozenRows, 1, title + ' header frozen');
    assert.equal(f.bold, true, title + ' header bold');
    assert.ok(Object.keys(f.widths).length === head.length, title + ' every column sized');
    if (head[last] === 'data') {
      assert.deepEqual(head.slice(-3), ['key', 'rev', 'data'], title + ' machine copy last');
      assert.ok(f.widths[last] <= 60 && f.widths[last] < f.widths[0], title + ' data column narrow');
      assert.ok(f.wrap.some(w => w.col === last && w.wrap === 'CLIP'), title + ' data column clipped');
    }
  }
  // Keys: 32 characters of [A-Za-z0-9], three different ones, shown in the log once.
  for (const r of ROLES) assert.match(k[r], /^[A-Za-z0-9]{32}$/);
  assert.equal(new Set(ROLES.map(r => k[r])).size, 3);
  assert.equal(hub.logs.filter(l => l.includes(k.pm)).length, 1);
  // The PM key is stored only as a SHA-256 hash; crew and super keys are kept so the PM phone can invite.
  assert.equal(hub.props.PM_KEY_SHA256, sha(k.pm));
  assert.ok(!Object.values(hub.props).includes(k.pm), 'PM key is not stored');
  assert.equal(hub.props.CREW_KEY, k.crew);
  assert.equal(hub.props.SUPER_KEY, k.super);
  assert.match(k.sheetUrl, /^https:\/\/docs\.google\.com\/spreadsheets\/d\/\w+\/edit$/);
});

test('setupHub is idempotent: same sheet, same keys, nothing re-logged, a missing tab is put back', () => {
  const { hub, k } = setup();
  const id = hub.sheetId(), before = { ...hub.props };
  hub.logs.length = 0;
  hub.run('setupHub');
  assert.equal(hub.sheetId(), id);
  assert.deepEqual(hub.props, before);
  assert.equal(hub.spreadsheets.size, 1);
  assert.ok(!hub.logs.some(l => /[A-Za-z0-9]{32}/.test(l)), 'a second run prints no key');
  assert.ok(hub.logs.some(l => l.includes(id)), 'but it still shows the Sheet link');
  // Repair: the owner deleted the Deleted tab by hand.
  const wb = hub.workbook();
  wb.sheets.splice(wb.sheets.findIndex(s => s.title === 'Deleted'), 1);
  hub.run('setupHub');
  assert.ok(hub.tabs().includes('Deleted'));
  assert.deepEqual(hub.header('Deleted'), ['key', 'kind', 'rev', 'when']);
  assert.equal(hub.call(k.pm, 'whoami').role, 'pm');
});

test('resetPmKey: a new PM key shown once, the old one dead, crew and super untouched', () => {
  const { hub, k } = setup();
  hub.contended = true; // another run holds the lock: the editor shows a readable message and nothing changed
  assert.throws(() => hub.run('resetPmKey'), /Busy, try again shortly/);
  const first = createHub({ now: T0 });
  first.contended = true;
  assert.throws(() => first.run('setupHub'), /Busy, try again shortly/);
  assert.equal(first.spreadsheets.size, 0, 'and no Sheet was made');
  hub.contended = false;
  hub.logs.length = 0;
  hub.run('resetPmKey');
  const fresh = hub.logs.map(l => /: ([A-Za-z0-9]{32})$/.exec(l)).find(Boolean)[1];
  assert.notEqual(fresh, k.pm);
  assert.equal(hub.call(k.pm, 'whoami').error, 'unauthorized');
  assert.equal(hub.call(fresh, 'whoami').role, 'pm');
  assert.equal(hub.call(k.crew, 'whoami').role, 'crew');
  assert.equal(hub.props.PM_KEY_SHA256, sha(fresh));
});

test('the health check says only that the service is there', () => {
  const { hub } = setup();
  assert.deepEqual(hub.get(), { ok: true, service: 'schwab-field-hub', version: '1.0.0' });
  const bare = createHub({ now: T0 }); // not even set up: same answer, nothing about the state leaks
  assert.deepEqual(bare.get(), hub.get());
});

test('manifest: Sheets v4, exactly two scopes, V8, New York, private until the owner approves', () => {
  const m = JSON.parse(fs.readFileSync(path.join(DIR, 'hub', 'appsscript.json'), 'utf8'));
  assert.equal(m.timeZone, 'America/New_York');
  assert.equal(m.runtimeVersion, 'V8');
  assert.deepEqual(m.oauthScopes, ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/script.external_request']);
  assert.deepEqual(m.dependencies.enabledAdvancedServices, [{ userSymbol: 'Sheets', version: 'v4', serviceId: 'sheets' }]);
  assert.deepEqual(m.webapp, { access: 'MYSELF', executeAs: 'USER_DEPLOYING' });
});

test('code hygiene: only the documented services, V8-safe syntax, plain ASCII punctuation', () => {
  const used = new Set([...CODE.matchAll(/\b(Sheets\.Spreadsheets(?:\.Values)?\.\w+|[A-Z]\w+App|Utilities\.\w+|PropertiesService|LockService|CacheService|ContentService|Logger|Session|DriveApp|UrlFetchApp|MailApp|SpreadsheetApp)\b/g)].map(m => m[1]));
  const allowed = new Set(['Sheets.Spreadsheets.create', 'Sheets.Spreadsheets.get', 'Sheets.Spreadsheets.batchUpdate', 'Sheets.Spreadsheets.Values.get', 'Sheets.Spreadsheets.Values.batchGet',
    'Sheets.Spreadsheets.Values.update', 'Sheets.Spreadsheets.Values.batchUpdate', 'Sheets.Spreadsheets.Values.append', 'Sheets.Spreadsheets.Values.clear',
    'PropertiesService', 'LockService', 'CacheService', 'ContentService', 'Logger', 'LanguageApp', 'Utilities.computeDigest', 'Utilities.getUuid', 'Utilities.base64Encode', 'Utilities.DigestAlgorithm']);
  for (const u of used) assert.ok(allowed.has(u), 'unexpected service: ' + u);
  for (const bad of [/\?\./, /\?\?/, /\.at\(/, /replaceAll\(/, /Object\.hasOwn\(/, /structuredClone/, /\bawait\b/, /\bimport\b.*from/]) {
    assert.ok(!bad.test(CODE.replace(/'[^'\n]*'|"[^"\n]*"|\/\/.*$/gm, '')), 'not safe for Apps Script V8: ' + bad);
  }
  for (const [name, text] of [['Code.gs', CODE], ['mock', fs.readFileSync(path.join(__dirname, 'helpers', 'google-mock.js'), 'utf8')], ['this test', fs.readFileSync(__filename, 'utf8')]]) {
    assert.ok(!text.includes(String.fromCharCode(0x2014)) && !text.includes(String.fromCharCode(0x2013)), name + ' has a long dash');
  }
  // Every Sheets call sits under a comment naming the documented REST method.
  for (const m of CODE.matchAll(/^function (api\w+)_\(.*Sheets\.Spreadsheets(\.Values)?\.(\w+)/gm)) {
    const before = CODE.slice(0, m.index).trimEnd().split('\n').pop();
    assert.match(before, new RegExp('spreadsheets\\.' + (m[2] ? 'values\\.' : '') + m[3] + '$'), 'comment above ' + m[1]);
  }
  assert.ok(!/valueInputOption: '(?!RAW')/.test(CODE), 'every write is RAW');
  assert.ok(!/USER_ENTERED/.test(CODE));
});

// ---------- request handling ----------
test('bad requests: size, JSON, version, action; errors carry a fixed message and never echo input', () => {
  const { hub, k } = setup();
  const msg = { bad_request: 'Bad request', unauthorized: 'Wrong key', forbidden: 'Not allowed for this key', busy: 'Busy, try again shortly', too_large: 'Too large', quota: 'Daily limit reached', not_ready: 'The hub is not set up', server: 'Server error' };
  const SECRET = 'S3CRET-VALUE-9X';
  const cases = [
    [hub.raw('not json ' + SECRET), 'bad_request'],
    [hub.raw('[1,2]'), 'bad_request'],
    [hub.raw('null'), 'bad_request'],
    [hub.raw(JSON.stringify({ v: 2, key: k.pm, action: 'whoami' })), 'bad_request'],
    [hub.raw(JSON.stringify({ key: k.pm, action: 'whoami' })), 'bad_request'],
    [hub.raw(JSON.stringify({ v: 1, key: k.pm })), 'bad_request'],
    [hub.raw(JSON.stringify({ v: 1, key: k.pm, action: SECRET })), 'bad_request'],
    [hub.raw(JSON.stringify({ v: 1, key: k.pm, action: '__proto__' })), 'bad_request'],
    [hub.raw(JSON.stringify({ v: 1, key: k.pm, action: 'constructor' })), 'bad_request'],
    [hub.raw(JSON.stringify({ v: 1, key: SECRET, action: 'whoami' })), 'unauthorized'],
    [hub.raw(JSON.stringify({ v: 1, key: 42, action: 'whoami' })), 'unauthorized'],
    [hub.raw(JSON.stringify({ v: 1, action: 'whoami' })), 'unauthorized'],
    [hub.raw(JSON.stringify({ v: 1, key: '', action: 'whoami' })), 'unauthorized'],
    [hub.raw('x'.repeat(1000001)), 'too_large'],
    [hub.raw(JSON.stringify({ v: 1, key: k.pm, action: 'push', tasks: 'no' })), 'bad_request'],
    [hub.raw(JSON.stringify({ v: 1, key: k.pm, action: 'push', config: 5 })), 'bad_request'],
  ];
  for (const [raw, error] of cases) {
    const r = JSON.parse(raw);
    assert.deepEqual(r, { ok: false, error, message: msg[error] });
    assert.ok(!raw.includes(SECRET), 'no echo');
  }
  assert.ok(!hub.raw(JSON.stringify({ v: 1, key: k.pm, action: 'whoami' })).includes(k.pm), 'a reply never echoes the key');
});

test('an unusual id like "__proto__" is an ordinary key', () => {
  const { hub, k } = setup();
  const sup = phone({ hub, k }, 'super');
  for (const uid of ['__proto__', 'constructor', 'hasOwnProperty']) {
    const items = [{ id: '__proto__', text: 'a' }, { id: '__proto__', text: 'dup' }];
    const first = ok(sup.push({ tasks: [task({ uid, id: uid, items })] }));
    assert.deepEqual(first.tasks[0].task.items.map(i => i.id), ['__proto__'], 'repeated item ids collapse');
    const again = ok(sup.push({ tasks: [task({ uid, id: uid, scope: 'second', items })] }));
    assert.equal(again.tasks[0].task.scope, 'second');
  }
  assert.equal(hub.table('Tasks').length, 3, 'three rows, none doubled');
  assert.equal(sup.pull().tasks.length, 3);
  assert.equal({}.polluted, undefined);
});

// ---------- the role by action matrix ----------
const MINIMAL = {
  whoami: {}, pull: { since: 0 }, push: {}, translate: { items: ['hello'], from: 'en', to: 'es' },
  records: { kind: 'tasks', from: '2026-10-01', to: '2026-10-31' }, purge: { kind: 'tasks', target: 'u1' }, stats: {}, keys: {},
  rotate: { role: 'crew' }, archive: { before: '2026-10-01' }, selftest: {},
};
const MAY = {
  whoami: ROLES, pull: ROLES, push: ROLES, translate: ROLES, records: ['super', 'pm'],
  purge: ['pm'], stats: ['pm'], keys: ['pm'], rotate: ['pm'], archive: ['pm'], selftest: ['pm'],
};
test('permission matrix: every action by every role, allowed or forbidden exactly as HUB.md says', () => {
  for (const action of Object.keys(MINIMAL)) {
    for (const role of ROLES) {
      const env = setup();
      const r = phone(env, role).call(action, MINIMAL[action]);
      if (MAY[action].includes(role)) assert.equal(r.ok, true, `${role} may ${action}: ${JSON.stringify(r)}`);
      else assert.deepEqual([r.ok, r.error], [false, 'forbidden'], `${role} may not ${action}`);
    }
  }
  assert.equal(Object.keys(MINIMAL).length, 11, 'every action in the contract is covered');
});

// The HUB.md role table, row by row. Each probe does the thing as that role and reports whether it took effect.
test('the HUB.md role table, cell by cell: what each key can actually do, judged by the effect', () => {
  const base = () => {
    const env = setup(), sup = office(env), pm = phone(env, 'pm', 'pm-dev');
    ok(sup.push({ tasks: [task()], reports: [report()], config: { project: 'P', floors: ['L1'] } }));
    ok(pm.push({ shifts: [shift({ id: 'by-pm', device: '', who: 'Ana P' })] }));
    for (const role of ROLES) ok(phone(env, role).push({ shifts: [shift({ id: 'own-' + role, device: ID(role + '-dev'), who: role + ' person' })] }));
    ok(phone(env, 'crew', 'other-dev').push({ shifts: [shift({ id: 'other', device: ID('other-dev'), who: 'Someone Else' })] }));
    return env;
  };
  const at = (env, role) => phone(env, role, role + '-dev');
  const stored1 = env => env.hub.entities('Tasks').find(t => t.uid === 'u1');
  const PROBES = {
    'whoami': (env, role) => at(env, role).call('whoami').ok === true,
    'translate': (env, role) => at(env, role).call('translate', { items: ['hello'], from: 'en', to: 'es' }).ok === true,
    'pull tasks': (env, role) => at(env, role).pull().tasks.length === 1,
    'pull config': (env, role) => !!at(env, role).pull().config,
    'pull reports': (env, role) => at(env, role).pull().reports.length === 1,
    'pull events': (env, role) => at(env, role).pull().events.length > 0,
    'pull all hours': (env, role) => at(env, role).pull().shifts.length === 5,
    'pull own hours': (env, role) => at(env, role).pull().shifts.some(s => s.id === 'own-' + role),
    'pull no one else\'s hours': (env, role) => at(env, role).pull().shifts.every(s => s.device === ID(role + '-dev')) && at(env, role).pull().shifts.length === 1,
    'pull who is on site': (env, role) => (at(env, role).pull().onsite || []).length === 5,
    'push crew part of a task': (env, role) => { at(env, role).push({ tasks: [task({ status: 'Partial', crewAt: T0 - 5 })] }); return stored1(env).status === 'Partial'; },
    'push assign part': (env, role) => { at(env, role).push({ tasks: [task({ scope: 'by ' + role, assignAt: T0 - 5 })] }); return stored1(env).scope === 'by ' + role; },
    'push review': (env, role) => { at(env, role).push({ tasks: [task({ review: 'by ' + role, assignAt: T0 - 5 })] }); return stored1(env).review === 'by ' + role; },
    'push reply': (env, role) => { at(env, role).push({ tasks: [task({ reply: 'by ' + role, replyAt: T0 - 5, assignAt: T0 - 5 })] }); return stored1(env).reply === 'by ' + role; },
    'create a task': (env, role) => { at(env, role).push({ tasks: [task({ uid: 'brand-new' })] }); return env.hub.entities('Tasks').some(t => t.uid === 'brand-new'); },
    'push config': (env, role) => { at(env, role).push({ config: { project: 'by ' + role } }); return env.hub.entities('Config')[0].project === 'by ' + role; },
    'push own shifts': (env, role) => { at(env, role).push({ shifts: [shift({ id: 'fresh', device: ID(role + '-dev'), who: 'Fresh' })] }); return !!stored(env.hub, 'fresh'); },
    'PM rules: edit': (env, role) => { at(env, role).push({ shifts: [{ ...stored(env.hub, 'other'), out: '11:00', edited: { who: false, in: false, out: true } }] }); return stored(env.hub, 'other').out === '11:00'; },
    'PM rules: add': (env, role) => { at(env, role).push({ shifts: [shift({ id: 'added', device: '', who: 'Hand' })] }); return !!stored(env.hub, 'added'); },
    'PM rules: rename': (env, role) => { at(env, role).push({ shifts: [{ ...stored(env.hub, 'other'), who: 'Renamed', edited: { who: true, in: false, out: false } }] }); return stored(env.hub, 'other').who === 'Renamed'; },
    'PM rules: remove': (env, role) => { at(env, role).push({ shifts: [{ ...stored(env.hub, 'other'), gone: true }] }); return stored(env.hub, 'other').gone === true; },
    'push report super part': (env, role) => { at(env, role).push({ reports: [report({ results: 'by ' + role, updatedAt: T0 - 5 })] }); return env.hub.entities('Reports')[0].results === 'by ' + role; },
    'push report PM part': (env, role) => { at(env, role).push({ reports: [report({ updatedAt: T0 - 3000, pmReview: 'by ' + role, pmAt: T0 - 5 })] }); return env.hub.entities('Reports')[0].pmReview === 'by ' + role; },
    'records tasks': (env, role) => at(env, role).call('records', { kind: 'tasks', from: '2026-10-01', to: '2026-10-31' }).ok === true,
    'records reports': (env, role) => at(env, role).call('records', { kind: 'reports', from: '2026-10-01', to: '2026-10-31' }).ok === true,
    'records hours': (env, role) => at(env, role).call('records', { kind: 'shifts', from: '2026-10-01', to: '2026-10-31' }).ok === true,
    'purge': (env, role) => { at(env, role).call('purge', { kind: 'tasks', target: 'u1' }); return !stored1(env); },
    'stats': (env, role) => at(env, role).call('stats').ok === true,
    'keys': (env, role) => at(env, role).call('keys').ok === true,
    'rotate': (env, role) => { const k = env.hub.props.CREW_KEY; at(env, role).call('rotate', { role: 'crew' }); return env.hub.props.CREW_KEY !== k; },
    'archive': (env, role) => at(env, role).call('archive', { before: '2026-10-19' }).ok === true,
    'selftest': (env, role) => at(env, role).call('selftest').ok === true,
  };
  // Who may, per row of the HUB.md table (a row of several actions is one entry per action).
  const ALLOW = {
    'whoami': ROLES, 'translate': ROLES, 'pull tasks': ROLES, 'pull config': ROLES,
    'pull all hours': ['pm'], 'pull own hours': ROLES, 'pull no one else\'s hours': ['crew', 'super'], 'pull who is on site': ['super', 'pm'],
    'pull reports': ['super', 'pm'], 'pull events': ['super', 'pm'],
    'push crew part of a task': ROLES, 'push assign part': ['super', 'pm'], 'push review': ['super', 'pm'], 'push reply': ['super', 'pm'], 'create a task': ['super', 'pm'],
    'push config': ['super', 'pm'], 'push own shifts': ROLES,
    'PM rules: edit': ['pm'], 'PM rules: add': ['pm'], 'PM rules: rename': ['pm'], 'PM rules: remove': ['pm'],
    'push report super part': ['super', 'pm'], 'push report PM part': ['pm'],
    'records tasks': ['super', 'pm'], 'records reports': ['super', 'pm'], 'records hours': ['pm'],
    'purge': ['pm'], 'stats': ['pm'], 'keys': ['pm'], 'rotate': ['pm'], 'archive': ['pm'], 'selftest': ['pm'],
  };
  let denied = 0, allowed = 0;
  for (const [row, probe] of Object.entries(PROBES)) {
    for (const role of ROLES) {
      const yes = !!probe(base(), role), want = ALLOW[row].includes(role);
      assert.equal(yes, want, `${role} ${want ? 'can' : 'cannot'}: ${row}`);
      if (want) allowed++; else denied++;
    }
  }
  assert.deepEqual(Object.keys(PROBES).sort(), Object.keys(ALLOW).sort(), 'every row has a probe and a rule');
  assert.ok(denied >= 30 && allowed >= 40, `${denied} denied and ${allowed} allowed cells checked`);
});

test('a forbidden action writes nothing and costs no Sheets call', () => {
  const env = setup();
  for (const [role, action] of [['crew', 'purge'], ['super', 'archive'], ['crew', 'records'], ['super', 'keys'], ['crew', 'selftest'], ['super', 'rotate']]) {
    const before = env.hub.calls.length, props = JSON.stringify(env.hub.props);
    assert.equal(phone(env, role).call(action, MINIMAL[action]).error, 'forbidden');
    assert.equal(env.hub.calls.length, before);
    assert.equal(JSON.stringify(env.hub.props), props);
  }
});

test('records by kind: super reads tasks and reports only; the PM reads hours and the feed too', () => {
  const env = setup();
  const q = { from: '2026-10-01', to: '2026-10-31' };
  for (const kind of ['tasks', 'reports', 'task', 'report']) assert.equal(phone(env, 'super').call('records', { kind, ...q }).ok, true, kind);
  for (const kind of ['shifts', 'events', 'shift']) assert.equal(phone(env, 'super').call('records', { kind, ...q }).error, 'forbidden', kind);
  for (const kind of ['tasks', 'shifts', 'reports', 'events']) assert.equal(phone(env, 'pm').call('records', { kind, ...q }).ok, true, kind);
  for (const bad of [{ kind: 'nope' }, { kind: '__proto__' }, { kind: 'tasks', from: '2026-02-30', to: '2026-03-01' }, { kind: 'tasks', from: '2026-10-05', to: '2026-10-01' }, { from: undefined }]) {
    assert.equal(phone(env, 'pm').call('records', { ...q, ...bad }).error, 'bad_request', JSON.stringify(bad));
  }
});

// ---------- tasks: one writer per field ----------
function office(env) { return phone(env, 'super', 'sup-dev'); }
test('task: the office creates it; a crew key cannot, and only the crew part of an existing one', () => {
  const env = setup(), sup = office(env), crew = phone(env, 'crew', 'crew-dev');
  const denied = crew.push({ tasks: [task()] });
  assert.deepEqual([denied.tasks[0].status, denied.tasks[0].reason, denied.tasks[0].key], ['rejected', 'forbidden', 'u1']);
  assert.equal(env.hub.table('Tasks').length, 0);
  ok(sup.push({ tasks: [task()] }));
  // The crew sends the whole sheet, assignment fields rewritten: only its own part lands.
  const r = ok(crew.push({ tasks: [task({ scope: 'HACKED', crew: 'Crew Z', floor: 'Roof', review: 'Accepted', reply: 'x', items: [{ id: 'i1', text: 'reworded', done: true, at: T0 - 100 }, { id: 'i2', text: 'Terminate' }, { id: 'new', text: 'added by crew', done: true }, ],
    checks: [], status: 'Partial', doneText: 'Pulled half', aStart: '07:05', delay: 20, lead: 'Mike', comments: 'ladder', cLang: 'es', crewAt: T0 - 50 })] }));
  const t = r.tasks[0].task;
  assert.deepEqual([t.scope, t.crew, t.floor, t.review, t.reply], ['Pull 12 AWG', 'Crew A', 'Level 3', '', ''], 'assignment untouched');
  assert.deepEqual(t.items.map(i => [i.id, i.text, i.done]), [['i1', 'Pull', true], ['i2', 'Terminate', false]], 'the crew ticks steps, it cannot reword, add or remove them');
  assert.deepEqual(t.checks.map(i => i.id), ['c1'], 'checks structure untouched');
  assert.deepEqual([t.status, t.doneText, t.aStart, t.delay, t.lead, t.comments, t.cLang, t.crewAt], ['Partial', 'Pulled half', '07:05', 20, 'Mike', 'ladder', 'es', T0 - 50]);
});

test('task: the office assigns and reviews; a crew result is never erased by an office push', () => {
  const env = setup(), sup = office(env), pm = phone(env, 'pm', 'pm-dev'), crew = phone(env, 'crew', 'crew-dev');
  ok(sup.push({ tasks: [task()] }));
  ok(crew.push({ tasks: [task({ status: 'Complete', doneText: 'All done', items: [{ id: 'i1', text: 'x', done: true, at: 5 }, { id: 'i2', text: 'x', done: true, at: 6 }], crewAt: T0 - 1000 })] }));
  // The superintendent's phone still holds the empty crew part (crewAt 0) and edits the assignment.
  let r = ok(sup.push({ tasks: [task({ scope: 'Pull 10 AWG', review: 'Follow-up needed', reviewer: 'Sam', followUp: 'redo L2', reply: 'Call me', replyAt: T0 - 10, replyBy: 'Sam', aLang: 'en', assignAt: T0 - 900 })] }));
  let t = r.tasks[0].task;
  assert.deepEqual([t.scope, t.review, t.reviewer, t.followUp, t.reply, t.replyBy, t.aLang], ['Pull 10 AWG', 'Follow-up needed', 'Sam', 'redo L2', 'Call me', 'Sam', 'en']);
  assert.deepEqual([t.status, t.doneText, t.items.map(i => i.done), t.crewAt], ['Complete', 'All done', [true, true], T0 - 1000], 'crew results survive');
  // Even a tie on the crew stamp cannot wipe crew results when the office is the writer.
  r = ok(pm.push({ tasks: [task({ scope: 'PM scope', assignAt: T0 - 800, status: '', doneText: '', crewAt: T0 - 1000 })] }));
  t = r.tasks[0].task;
  assert.deepEqual([t.scope, t.status, t.doneText], ['PM scope', 'Complete', 'All done']);
  // A strictly newer crew part from an office key does apply (the PM fixing a result remotely).
  r = ok(pm.push({ tasks: [task({ scope: 'PM scope', assignAt: T0 - 800, status: 'Partial', doneText: 'PM fixed', crewAt: T0 - 500, items: [{ id: 'i1', text: 'x', done: true, at: 5 }, { id: 'i2', text: 'x' }] })] }));
  t = r.tasks[0].task;
  assert.deepEqual([t.status, t.doneText, t.items.map(i => i.done)], ['Partial', 'PM fixed', [true, false]]);
});

test('task stamps: older loses, equal wins for the part owner, the future is clamped to server time', () => {
  const env = setup(), sup = office(env), crew = phone(env, 'crew', 'crew-dev');
  ok(sup.push({ tasks: [task({ assignAt: T0 - 1000 })] }));
  let t = ok(sup.push({ tasks: [task({ scope: 'older', assignAt: T0 - 2000 })] })).tasks[0].task;
  assert.equal(t.scope, 'Pull 12 AWG', 'an older assignment is ignored');
  t = ok(sup.push({ tasks: [task({ scope: 'tie', assignAt: T0 - 1000 })] })).tasks[0].task;
  assert.equal(t.scope, 'tie', 'a tie: incoming wins');
  ok(crew.push({ tasks: [task({ status: 'Partial', crewAt: T0 - 300 })] }));
  t = ok(crew.push({ tasks: [task({ status: 'Blocked', crewAt: T0 - 400 })] })).tasks[0].task;
  assert.equal(t.status, 'Partial', 'an older crew part is ignored');
  t = ok(crew.push({ tasks: [task({ status: 'Complete', crewAt: T0 - 300 })] })).tasks[0].task;
  assert.equal(t.status, 'Complete', 'a tie: incoming wins for the crew');
  // More than 5 minutes ahead is clamped to now; a stamp just inside the skew is kept.
  t = ok(sup.push({ tasks: [task({ scope: 'future', assignAt: T0 + 3600e3 })] })).tasks[0].task;
  assert.equal(t.assignAt, T0);
  assert.equal(t.scope, 'future');
  t = ok(sup.push({ tasks: [task({ scope: 'edit after', assignAt: T0 + 60e3 })] })).tasks[0].task;
  assert.equal(t.assignAt, T0 + 60e3);
  t = ok(crew.push({ tasks: [task({ crewAt: T0 + 9e9, items: [{ id: 'i1', done: true, at: T0 + 9e9 }], status: 'Complete' })] })).tasks[0].task;
  assert.equal(t.crewAt, T0);
  assert.equal(t.items[0].at, T0, 'tick times are clamped too');
  assert.ok(![t.sentAt, t.replyAt, t.resultAt].some(x => x > T0));
  // Junk stamps become 0, never NaN or negative; against a stored stamp, 0 is older and applies nothing.
  t = ok(sup.push({ tasks: [task({ scope: 'junk', assignAt: 'now', sentAt: -5, replyAt: NaN })] })).tasks[0].task;
  assert.equal(t.scope, 'edit after');
  t = ok(sup.push({ tasks: [task({ uid: 'fresh', assignAt: 'now', sentAt: -5, replyAt: NaN })] })).tasks[0].task;
  assert.deepEqual([t.assignAt, t.sentAt, t.replyAt], [0, 0, 0]);
});

test('partial pushes, as the app sends them (only the part that changed): the other part is never blanked', () => {
  const env = setup(), sup = office(env), pm = phone(env, 'pm', 'pm-dev'), crew = phone(env, 'crew', 'crew-dev');
  const full = task({ scope: 'The real scope', review: 'Accepted', reply: 'Hello', assignAt: T0 - 9000 });
  ok(sup.push({ tasks: [full] }));
  // crew phone: ticks and results only, no assignment fields at all, no text on the items
  let t = ok(crew.push({ tasks: [{ uid: 'u1', date: '2026-10-19', status: 'Partial', doneText: 'half', crewAt: T0 - 800, items: [{ id: 'i1', done: true, at: T0 - 800 }, { id: 'i2', done: false, at: 0 }], checks: [] }] })).tasks[0].task;
  assert.deepEqual([t.scope, t.review, t.reply, t.items.map(i => [i.text, i.done])], ['The real scope', 'Accepted', 'Hello', [['Pull', true], ['Terminate', false]]]);
  // super phone: assignment only, no crew fields, no ticks on the items
  t = ok(sup.push({ tasks: [{ uid: 'u1', date: '2026-10-19', id: 'T1019-01', scope: 'Reworded scope', assignAt: T0 - 500, items: [{ id: 'i1', text: 'Pull it' }, { id: 'i2', text: 'Terminate it' }], checks: [] }] })).tasks[0].task;
  assert.deepEqual([t.scope, t.status, t.doneText, t.items.map(i => [i.text, i.done])], ['Reworded scope', 'Partial', 'half', [['Pull it', true], ['Terminate it', false]]]);
  assert.equal(t.crew, '', 'the fields that were not sent are the defaults of the part that was sent: it is the whole office part');
  // PM phone fixing a result remotely: a crew part only (assignAt 0). It must not blank the assignment, even where the stored stamp is also 0.
  ok(sup.push({ tasks: [task({ uid: 'u0', scope: 'Never stamped', assignAt: 'x' })] }));
  for (const uid of ['u1', 'u0']) {
    const before = env.hub.entities('Tasks').find(x => x.uid === uid);
    t = ok(pm.push({ tasks: [{ uid, date: '2026-10-19', status: 'Complete', crewAt: T0 - 100, items: [], checks: [] }] })).tasks[0].task;
    assert.deepEqual([t.scope, t.status, t.assignAt], [before.scope, 'Complete', before.assignAt], uid);
  }
  // and a push that says nothing at all about either part changes nothing
  const keep = JSON.stringify(env.hub.entities('Tasks'));
  ok(pm.push({ tasks: [{ uid: 'u1', date: '2026-10-19' }, { uid: 'u0', date: '2026-10-19' }] }));
  ok(crew.push({ tasks: [{ uid: 'u1', date: '2026-10-19' }] }));
  assert.equal(JSON.stringify(env.hub.entities('Tasks')), keep);
  // reports: the PM sends the answers only, the superintendent sends the report with the PM fields blank
  ok(sup.push({ reports: [report()] }));
  let r = ok(pm.push({ reports: [{ date: '2026-10-19', decisions: [{ q: 'Which panel?', pm: 'LP-2', pmNote: 'ok' }, { q: 'Fire stop?', pm: '', pmNote: '' }], pmReview: 'Seen', pmAt: T0 - 400, updatedAt: 0 }] })).reports[0].report;
  assert.deepEqual([r.results, r.decisions.map(d => [d.rec, d.pm]), r.pmReview], ['Good day', [['LP-1', 'LP-2'], ['Yes', '']], 'Seen']);
  r = ok(sup.push({ reports: [report({ results: 'Evening', updatedAt: T0 - 300, decisions: report().decisions.map(d => ({ ...d, pm: '', pmNote: '' })), pmReview: '', pmAt: 0 })] })).reports[0].report;
  assert.deepEqual([r.results, r.decisions.map(d => d.pm), r.pmReview, r.pmAt], ['Evening', ['LP-2', ''], 'Seen', T0 - 400], 'the PM answers survive the superintendent\'s next edit');
  // an unstamped part (stamp 0) is "not sent", even where the stored stamp is also 0
  ok(sup.push({ reports: [report({ date: '2026-10-21', results: 'Unstamped original', updatedAt: 'x' })] }));
  r = ok(sup.push({ reports: [report({ date: '2026-10-21', results: 'Unstamped overwrite', updatedAt: 0 })] })).reports[0].report;
  assert.deepEqual([r.results, r.updatedAt], ['Unstamped original', 0], 'a super part with no stamp does not replace one');
  r = ok(pm.push({ reports: [{ date: '2026-10-21', decisions: [{ q: 'Which panel?', pm: 'sneaky', pmNote: '' }], pmReview: 'Unstamped review', pmAt: 0 }] })).reports[0].report;
  assert.deepEqual([r.pmReview, r.decisions.map(d => d.pm)], ['', ['', '']], 'and neither does a PM part with no stamp');
  // a PM-only report for a day nobody wrote yet makes the report; the superintendent then fills it in
  r = ok(pm.push({ reports: [{ date: '2026-10-20', decisions: [{ q: 'Q', pm: 'A', pmNote: '' }], pmReview: '', pmAt: T0 - 50, updatedAt: 0 }] })).reports[0].report;
  assert.deepEqual([r.decisions.map(d => [d.q, d.pm]), r.results], [[['Q', 'A']], '']);
  r = ok(sup.push({ reports: [report({ date: '2026-10-20', results: 'Filled in', updatedAt: T0 - 40, decisions: [{ q: 'Q', rec: 'r' }] })] })).reports[0].report;
  assert.deepEqual([r.results, r.decisions.map(d => [d.q, d.rec, d.pm])], ['Filled in', [['Q', 'r', 'A']]]);
});

test('task checklist: the office decides which items exist, the crew keeps its ticks, a new item starts not done', () => {
  const env = setup(), sup = office(env), crew = phone(env, 'crew', 'crew-dev');
  ok(sup.push({ tasks: [task()] }));
  ok(crew.push({ tasks: [task({ crewAt: T0 - 100, items: [{ id: 'i1', done: true, at: 77 }, { id: 'i2', done: true, at: 88 }], checks: [{ id: 'c1', done: true, at: 99 }] })] }));
  // Reorder, reword, drop i2, add i3 (sent as done: the server does not believe it), keep c1.
  const t = ok(sup.push({ tasks: [task({ assignAt: T0 - 50, items: [{ id: 'i3', text: 'Label', done: true, at: 5 }, { id: 'i1', text: 'Pull wire', done: false }], checks: [{ id: 'c1', text: 'Labels on' }, { id: 'c2', text: 'Torque' }] })] })).tasks[0].task;
  assert.deepEqual(t.items.map(i => [i.id, i.text, i.done, i.at]), [['i3', 'Label', false, 0], ['i1', 'Pull wire', true, 77]]);
  assert.deepEqual(t.checks.map(i => [i.id, i.text, i.done, i.at]), [['c1', 'Labels on', true, 99], ['c2', 'Torque', false, 0]]);
  // Items without a usable id are dropped; ids repeat once.
  const odd = ok(sup.push({ tasks: [task({ assignAt: T0 - 40, items: [{ id: '', text: 'no id' }, { id: 'a b', text: 'bad id' }, { id: 'ok1', text: 'one' }, { id: 'ok1', text: 'again' }] })] })).tasks[0].task;
  assert.deepEqual(odd.items.map(i => i.text), ['one']);
});

test('task: local-only fields never reach the hub; an unchanged push writes nothing and keeps rev', () => {
  const env = setup(), sup = office(env);
  const first = ok(sup.push({ tasks: [task({ origin: 'mine', from: 'x', gotAt: 9, filedAt: 8, updatedAt: 7, evil: 'x' })] }));
  const t = first.tasks[0].task;
  for (const k of ['origin', 'from', 'gotAt', 'filedAt', 'updatedAt', 'evil']) assert.ok(!(k in t), k);
  const calls = env.hub.calls.length, rev = first.rev;
  const again = ok(sup.push({ tasks: [task({ origin: 'link' })] }));
  assert.equal(again.rev, rev, 'rev did not move');
  assert.equal(again.tasks[0].task.rev, t.rev);
  assert.ok(!env.hub.calls.slice(calls).some(c => /append|batchUpdate|clear/.test(c)), 'no Sheet write for an unchanged entity');
});

test('task validation: bad uid, date, times and types; each rejected alone, the rest of the push still lands', () => {
  const env = setup(), sup = office(env);
  const r = ok(sup.push({ tasks: [task({ uid: 'good1' }), task({ uid: 'bad id' }), task({ uid: 'd2', date: '2026-02-30' }), task({ uid: 'd3', date: '10/19/2026' }), 'junk', null, task({ uid: 't1', pStart: '25:00', aStart: '7:5', checkIn: '07:00', size: -4, delay: 'x', members: 'x' })] }));
  assert.deepEqual(r.tasks.map(x => [x.status, x.reason || '']), [['ok', ''], ['rejected', 'invalid'], ['rejected', 'invalid'], ['rejected', 'invalid'], ['rejected', 'invalid'], ['rejected', 'invalid'], ['ok', '']]);
  assert.deepEqual(r.tasks.map(x => x.i), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(r.tasks.map(x => x.key), ['good1', '', '', '', '', '', 't1'], 'an unsafe key is never echoed');
  const t = r.tasks[6].task;
  assert.deepEqual([t.pStart, t.aStart, t.checkIn, t.size, t.delay, t.members], ['', '', '07:00', 0, 0, []]);
});

test('task text is clipped, control characters become spaces, aLang and cLang are en, es or empty', () => {
  const env = setup(), sup = office(env);
  const t = ok(sup.push({ tasks: [task({ scope: 'x'.repeat(20000), floor: 'L\u0000\u0007evel\n3', by: 'y'.repeat(500), aLang: 'fr', cLang: 'es', members: Array(600).fill('m') })] })).tasks[0].task;
  assert.equal(t.scope.length, 8000);
  assert.equal(t.floor, 'L  evel 3');
  assert.equal(t.by.length, 200);
  assert.equal(t.aLang, '');
  assert.equal(t.members.length, 500);
  assert.equal(t.cLang, '', 'cLang is crew part and the office stamp 0 does not set it');
});

test('push: one rev per row written, entity rows carry theirs, events only for real changes', () => {
  const env = setup(), sup = office(env), crew = phone(env, 'crew', 'crew-dev');
  const a = ok(sup.push({ tasks: [task()] }));
  assert.equal(a.tasks[0].task.rev, 1);
  assert.equal(a.rev, 2, 'task row then the created event');
  const b = ok(crew.push({ tasks: [task({ aStart: '07:05', status: 'Complete', crewAt: T0 - 10 })] }));
  const kinds = env.hub.entities('Activity').map(e => e.kind);
  assert.deepEqual(kinds, ['task.created', 'task.started', 'task.status']);
  assert.equal(b.rev, 5);
  ok(crew.push({ tasks: [task({ aStart: '07:05', status: 'Complete', crewAt: T0 - 10 })] }));
  assert.equal(env.hub.entities('Activity').length, 3, 'a repeat adds no event');
  ok(sup.push({ tasks: [task({ assignAt: T0 - 4, review: 'Accepted', reviewer: 'Sam', reply: 'Nice', replyBy: 'Sam', replyAt: T0 - 4 })] }));
  assert.deepEqual(env.hub.entities('Activity').map(e => e.kind), ['task.created', 'task.started', 'task.status', 'task.reviewed', 'task.replied']);
  const ev = env.hub.entities('Activity')[0];
  assert.deepEqual(Object.keys(ev), ['rev', 'ts', 'who', 'role', 'kind', 'text', 'ref']);
  assert.deepEqual([ev.role, ev.who, ev.ref, ev.ts], ['super', 'Sam', 'u1', T0], 'a task event points at the uid');
  assert.match(ev.text, /^New task T1019-01 for Crew A, Level 3$/);
});

test('push is capped: 200 entities per kind, 45,000 characters per entity, and a hostile entity cannot take the rest down', () => {
  const env = setup(), sup = office(env);
  const many = Array.from({ length: 201 }, (_, i) => task({ uid: 'u' + i }));
  assert.equal(sup.push({ tasks: many }).error, 'too_large');
  assert.equal(sup.push({ shifts: Array(201).fill({}) }).error, 'too_large');
  assert.equal(sup.push({ reports: Array(201).fill({}) }).error, 'too_large');
  assert.equal(sup.push({ deleted: Array(201).fill({}) }).error, 'too_large');
  assert.equal(env.hub.table('Tasks').length, 0, 'nothing written by a refused push');
  ok(sup.push({ tasks: many.slice(0, 200) }));
  assert.equal(env.hub.table('Tasks').length, 200);
  // One entity over 45,000 characters is rejected alone.
  const huge = task({ uid: 'huge', members: Array(3000).fill('m'.repeat(40)) });
  assert.ok(JSON.stringify(huge).length > 45000);
  const r = ok(sup.push({ tasks: [task({ uid: 'fine', scope: 'ok' }), huge] }));
  assert.deepEqual(r.tasks.map(x => [x.status, x.reason || '']), [['ok', ''], ['rejected', 'too_large']]);
  assert.equal(r.tasks[1].key, 'huge');
  const hostile = ok(sup.push({ tasks: [{ ...huge, uid: '<img src=x onerror=alert(1)>' }], shifts: [{ id: 'x'.repeat(41), members: 'm'.repeat(50000) }], reports: [{ date: '<b>', pad: 'z'.repeat(50000) }] }));
  assert.deepEqual([hostile.tasks[0].key, hostile.shifts[0].key, hostile.reports[0].key], ['', '', ''], 'an unsafe key is never echoed back');
  assert.ok(!JSON.stringify(hostile).includes('onerror'));
  // Each part fits on its own (40,000 and 24,000 characters) but the merged task would not fit a cell: refused, never truncated.
  const text = n => 'x'.repeat(n);
  ok(sup.push({ tasks: [task({ uid: 'big', scope: text(8000), refs: text(8000), allotNote: text(8000), estNote: text(8000), followUp: text(8000) })] }));
  const grow = ok(phone(env, 'crew', 'crew-dev').push({ tasks: [{ uid: 'big', date: '2026-10-19', doneText: text(8000), remain: text(8000), comments: text(8000), crewAt: T0 - 5 }] }));
  assert.deepEqual([grow.tasks[0].status, grow.tasks[0].reason], ['rejected', 'too_large']);
  assert.equal(env.hub.entities('Tasks').find(t => t.uid === 'big').doneText, '', 'the stored task is untouched');
  for (const row of env.hub.table('Tasks')) assert.ok(String(row[row.length - 1]).length <= 49000, 'whatever is in the Sheet fits a cell');
});

// ---------- what each role can read ----------
test('pull: crew sees tasks and config; hours of its own phone only; no reports, events or on-site list', () => {
  const env = setup(), sup = office(env), pm = phone(env, 'pm', 'pm-dev'), crew = phone(env, 'crew', 'crew-dev'), other = phone(env, 'crew', 'other-dev');
  ok(sup.push({ tasks: [task()], reports: [report()], config: { project: 'Schwab', site: 'Charlotte', floors: ['L1'], crews: [{ name: 'Crew A', lead: 'Mike', members: 'Mike, Jose' }], checks: ['Labeling'], pin: 'a'.repeat(16) + ':' + 'b'.repeat(64) } }));
  ok(crew.push({ shifts: [shift()] }));
  ok(other.push({ shifts: [shift({ id: 's2', device: other.dev, who: 'Eli T' })] }));
  ok(pm.push({ shifts: [shift({ id: 's3', device: '', who: 'Ana P' })] }));
  const r = crew.pull();
  assert.deepEqual([r.tasks.length, r.reports, r.events, r.onsite], [1, [], [], undefined]);
  assert.deepEqual(r.shifts.map(s => s.id), ['s1']);
  assert.equal(r.config.project, 'Schwab');
  assert.equal(r.config.pin, 'a'.repeat(16) + ':' + 'b'.repeat(64));
  assert.deepEqual(other.pull().shifts.map(s => s.id), ['s2']);
  const stranger = env.hub.call(env.k.crew, 'pull', { since: 0, dev: crew.dev }); // no device secret: no hours at all, whatever id it names
  assert.deepEqual(stranger.shifts, []);
});

test('pull: super reads reports, events, its own hours and who is on site; the PM reads everything', () => {
  const env = setup(), sup = office(env), pm = phone(env, 'pm', 'pm-dev'), crew = phone(env, 'crew', 'crew-dev');
  ok(sup.push({ tasks: [task()], reports: [report()], shifts: [shift({ id: 'mine', device: sup.dev, who: 'Sam S' })] }));
  ok(crew.push({ shifts: [shift({ id: 'open1', in: '06:30' }), shift({ id: 'done1', who: 'Old Done', in: '05:00', out: '06:00', date: '2026-10-18' })] }));
  const s = sup.pull();
  assert.deepEqual([s.reports.length, s.events.length > 0], [1, true]);
  assert.deepEqual(s.shifts.map(x => x.id), ['mine'], 'its own hours only');
  const on = (who, at) => ({ who, in: at, date: '2026-10-19', pid: '', crewId: '', crew: '' });
  assert.deepEqual(s.onsite, [on('Dana R', '06:30'), on('Sam S', '07:00')], 'open shifts of the last 16 hours, earliest first, with no shift ids or devices');
  const p = pm.pull();
  assert.deepEqual(p.shifts.map(x => x.id).sort(), ['done1', 'mine', 'open1']);
  assert.deepEqual(p.onsite.length, 2);
  // An open shift older than 16 hours was a missed clock-out: nobody is on site for it.
  env.hub.advance(11 * 3600e3);
  assert.deepEqual(pm.pull().onsite, []);
});

test('pull: window days, crews filter, cheap same-rev answer, a phone ahead of the hub starts over', () => {
  const env = setup(), sup = office(env), crew = phone(env, 'crew', 'crew-dev');
  const day = n => { const d = new Date(T0 - n * 864e5); return d.toISOString().slice(0, 10); };
  ok(sup.push({ tasks: [task({ uid: 'new' }), task({ uid: 'old20', date: day(20) }), task({ uid: 'old60', date: day(60) }), task({ uid: 'b', crew: 'Crew B' })] }));
  assert.deepEqual(crew.pull().tasks.map(t => t.uid).sort(), ['b', 'new'], 'default window 14 days');
  assert.deepEqual(crew.pull({ days: 30 }).tasks.map(t => t.uid).sort(), ['b', 'new', 'old20']);
  assert.deepEqual(crew.pull({ days: 90 }).tasks.length, 4);
  ok(sup.push({ tasks: [task({ uid: 'old120', date: day(120) })] }));
  assert.deepEqual(crew.pull({ days: 90 }).tasks.map(t => t.uid).includes('old120'), false);
  assert.deepEqual(crew.pull({ days: 9999 }).tasks.map(t => t.uid).includes('old120'), false, 'capped at 90');
  assert.deepEqual(crew.pull({ days: 9999 }).tasks.length, 4);
  assert.deepEqual(crew.pull({ days: 0 }).tasks.map(t => t.uid).sort(), ['b', 'new'], 'at least a day, junk falls back');
  assert.deepEqual(crew.pull({ crews: ['Crew B'] }).tasks.map(t => t.uid), ['b']);
  assert.deepEqual(crew.pull({ crews: ['Crew A', 'Crew B'] }).tasks.length, 2);
  const head = crew.pull();
  const calls = env.hub.calls.length;
  assert.deepEqual(crew.pull({ since: head.rev }), { rev: head.rev, now: T0, same: true, ok: true });
  assert.equal(env.hub.calls.length, calls, 'the cheap path makes no Sheets call at all');
  assert.equal(crew.pull({ since: head.rev + 50 }).tasks.length, 2, 'ahead of the hub: full pull');
  assert.equal(crew.pull({ since: -3 }).tasks.length, 2);
  assert.equal(crew.pull({ since: 'x' }).tasks.length, 2);
  // Only what changed since: after one edit, one task.
  const r1 = ok(sup.push({ tasks: [task({ uid: 'new', scope: 'changed', assignAt: T0 - 1 })] }));
  const inc = crew.pull({ since: head.rev });
  assert.deepEqual(inc.tasks.map(t => [t.uid, t.scope]), [['new', 'changed']]);
  assert.equal(inc.rev, r1.rev);
});

test('config: office phones write it, crew cannot; secrets and personal settings never go in', () => {
  const env = setup(), sup = office(env), pm = phone(env, 'pm', 'pm-dev'), crew = phone(env, 'crew', 'crew-dev');
  const cfg = { project: 'Schwab', site: 'Charlotte', super: 'Sam', pm: 'Pat', floors: ['L1', 'L2'], crews: [{ name: 'Crew A', lead: 'Mike', members: 'Mike, Jose' }], checks: ['Labeling'], pin: '' };
  const denied = ok(crew.push({ config: cfg }));
  assert.deepEqual([denied.configStatus, denied.configReason, denied.config], ['rejected', 'forbidden', undefined]);
  const r = ok(sup.push({ config: { ...cfg, folderUrl: 'https://x', siteCode: 'zzz', hubKey: 'k', me: 'Sam', device: 'd', lang: 'es', role: 'Project manager', worker: 'w' } }));
  assert.equal(r.configStatus, 'ok');
  for (const k of ['folderUrl', 'siteCode', 'hubKey', 'me', 'device', 'lang', 'role', 'worker']) assert.ok(!(k in r.config), k);
  assert.deepEqual(r.config.floors, ['L1', 'L2']);
  assert.ok(!JSON.stringify(env.hub.entities('Config')).includes('zzz'));
  assert.equal(ok(sup.push({ config: { ...cfg, pin: 'not-a-hash' } })).configReason, 'invalid');
  assert.equal(pm.pull().config.project, 'Schwab');
  // An optional stamp orders two office phones; without one the last push wins.
  ok(pm.push({ config: { ...cfg, project: 'Newer', at: T0 + 100 } }));
  assert.equal(ok(sup.push({ config: { ...cfg, project: 'Older', at: T0 - 500 } })).config.project, 'Newer');
  env.hub.advance(1000);
  assert.equal(ok(sup.push({ config: { ...cfg, project: 'Unstamped' } })).config.project, 'Unstamped');
  const row = rowsOf(env.hub, 'Config');
  assert.equal(row.length, 1);
  assert.deepEqual([row[0].Project, row[0].key], ['Unstamped', 'config']);
});

// ---------- shifts ----------
const stored = (hub, id) => hub.entities('Hours').find(s => s.id === id);
test('shift, worker rules: add, complete, never undo a clock-out, own phone only, flags are the server\'s', () => {
  const env = setup(), crew = phone(env, 'crew', 'crew-dev'), pm = phone(env, 'pm', 'pm-dev');
  let r = ok(crew.push({ shifts: [shift({ id: 'a', edited: { who: true, in: true, out: true }, gone: true })] }));
  assert.deepEqual([r.shifts[0].status, r.shifts[0].shift.edited, r.shifts[0].shift.gone], ['ok', { who: false, in: false, out: false }, false], 'the client cannot set edited or gone for itself');
  r = ok(crew.push({ shifts: [shift({ id: 'a', out: '15:30', at: T0 - 3000 })] }));
  assert.equal(r.shifts[0].shift.out, '15:30');
  r = ok(crew.push({ shifts: [shift({ id: 'a', out: '', at: T0 - 9000, who: 'Dana Typo' })] }));
  assert.deepEqual([r.shifts[0].shift.out, r.shifts[0].shift.who], ['15:30', 'Dana R'], 'an older text opened late keeps the clock-out and the newer name');
  r = ok(crew.push({ shifts: [shift({ id: 'a', out: '15:30', at: T0 - 1000, who: 'Dana Ruiz' })] }));
  assert.equal(r.shifts[0].shift.who, 'Dana Ruiz', 'a newer text renames');
  // Another phone cannot touch it, whatever device the shift names (the focused device identity test tries the rest).
  for (const device of [crew.dev, ID('other-dev')]) {
    const x = ok(phone(env, 'crew', 'other-dev').push({ shifts: [shift({ id: 'a', device, out: '23:00', who: 'Evil', at: T0 })] }));
    assert.deepEqual([x.shifts[0].status, x.shifts[0].reason], ['rejected', 'device'], 'other-dev names ' + device);
  }
  assert.deepEqual([stored(env.hub, 'a').out, stored(env.hub, 'a').who], ['15:30', 'Dana Ruiz']);
  // The device a shift names is not believed even from a real phone: a new shift is filed under the phone that sent it.
  r = ok(crew.push({ shifts: [shift({ id: 'claims', device: ID('other-dev') })] }));
  assert.deepEqual([r.shifts[0].status, r.shifts[0].shift.device], ['ok', crew.dev]);
  // A PM-added shift (no device) is the PM's alone.
  r = ok(crew.push({ shifts: [shift({ id: 'hand', device: '' })] }));
  assert.deepEqual([r.shifts[0].status, r.shifts[0].reason], ['rejected', 'forbidden']);
  assert.ok(!stored(env.hub, 'hand'));
  // A removed shift is never revived by a worker text.
  ok(pm.push({ shifts: [{ ...stored(env.hub, 'a'), gone: true }] }));
  r = ok(crew.push({ shifts: [shift({ id: 'a', out: '16:00', at: T0 })] }));
  assert.deepEqual([r.shifts[0].status, r.shifts[0].shift.gone, r.shifts[0].shift.out], ['ok', true, '15:30']);
});

test('shift, PM rules: edits, renames and removals stick; stored as sent; the clock-out is not erased by a stale PM phone', () => {
  const env = setup(), crew = phone(env, 'crew', 'crew-dev'), pm = phone(env, 'pm', 'pm-dev'), sup = office(env);
  ok(crew.push({ shifts: [shift({ id: 'a', pid: 'p-typo', crew: 'Crew B', crewId: 'c-b' })] }));
  ok(crew.push({ shifts: [shift({ id: 'a', out: '15:30', pid: 'p-dana', crew: 'Crew A', crewId: 'c-a', tasks: [{ uid: 'u1', id: 'T1019-01' }] })] }));
  const base = stored(env.hub, 'a');
  assert.deepEqual([base.pid, base.crew, base.crewId, base.tasks], ['p-dana', 'Crew A', 'c-a', [{ uid: 'u1', id: 'T1019-01' }]], 'until the PM touches it, person, crew and tasks follow the phone');
  // The PM fixes the out time and renames.
  let r = ok(pm.push({ shifts: [{ ...base, out: '15:00', who: 'Dana Ruiz', edited: { who: true, in: false, out: true } }] }));
  assert.deepEqual([r.shifts[0].shift.out, r.shifts[0].shift.who, r.shifts[0].shift.edited], ['15:00', 'Dana Ruiz', { who: true, in: false, out: true }]);
  // The worker's phone, with its own newer text, cannot undo either.
  r = ok(crew.push({ shifts: [shift({ id: 'a', out: '15:30', who: 'Dana R', at: T0 + 1000, in: '06:00', pid: 'p-other', crew: 'Crew B', crewId: 'c-b', tasks: [{ uid: 'x', id: 'X' }] })] }));
  const s = r.shifts[0].shift;
  assert.deepEqual([s.out, s.who, s.in], ['15:00', 'Dana Ruiz', '06:00'], 'edited out and who stick, in follows the phone');
  assert.deepEqual([s.pid, s.crew, s.crewId, s.tasks], ['p-dana', 'Crew A', 'c-a', [{ uid: 'u1', id: 'T1019-01' }]], 'once the PM has touched a shift its person, crew and tasks stay');
  // Nor can a PM phone that has not pulled yet undo a newer name from the worker's phone.
  ok(crew.push({ shifts: [shift({ id: 'n1', who: 'Dana R', at: T0 - 800 })] }));
  const stale = stored(env.hub, 'n1');
  ok(crew.push({ shifts: [shift({ id: 'n1', who: 'Dana Ruiz', at: T0 - 100 })] }));
  r = ok(pm.push({ shifts: [{ ...stale, out: '15:00', edited: { who: false, in: false, out: true } }] }));
  assert.deepEqual([r.shifts[0].shift.who, r.shifts[0].shift.out], ['Dana Ruiz', '15:00'], 'the PM\'s out time lands, the newer name stays');
  r = ok(pm.push({ shifts: [{ ...stale, who: 'PM chose', edited: { who: true, in: false, out: false } }] }));
  assert.equal(r.shifts[0].shift.who, 'PM chose', 'but a name the PM really set wins');
  // A PM phone that has not yet pulled the clock-out must not erase it.
  ok(crew.push({ shifts: [shift({ id: 'b', date: '2026-10-18' })] }));
  ok(crew.push({ shifts: [shift({ id: 'b', date: '2026-10-18', out: '14:00', at: T0 - 100 })] }));
  r = ok(pm.push({ shifts: [{ ...shift({ id: 'b', date: '2026-10-18' }), in: '06:45', edited: { who: false, in: true, out: false }, out: '' }] }));
  assert.deepEqual([r.shifts[0].shift.in, r.shifts[0].shift.out], ['06:45', '14:00']);
  // The device never changes after the shift exists.
  r = ok(pm.push({ shifts: [{ ...stored(env.hub, 'b'), device: 'someone-else', who: 'Renamed', edited: { who: true, in: true, out: false } }] }));
  assert.equal(r.shifts[0].shift.device, crew.dev);
  // Remove, then add one by hand, then bring the removed one back: PM rules store what was sent.
  r = ok(pm.push({ shifts: [{ ...stored(env.hub, 'b'), gone: true }, shift({ id: 'hand1', device: '', who: 'Ana P', in: '07:00', out: '15:30', edited: { who: true, in: true, out: true } })] }));
  assert.deepEqual([r.shifts[0].shift.gone, r.shifts[1].shift.device, r.shifts[1].shift.edited.out], [true, '', true]);
  assert.equal(ok(pm.push({ shifts: [{ ...stored(env.hub, 'b'), gone: false }] })).shifts[0].shift.gone, false);
  // Only the PM key gets PM rules: a super sending edited or somebody else's shift is refused.
  for (const bad of [{ ...stored(env.hub, 'a'), out: '01:00' }, shift({ id: 'x1', device: '' }), { ...stored(env.hub, 'a'), gone: true, device: sup.dev }]) {
    const x = ok(sup.push({ shifts: [bad] }));
    assert.equal(x.shifts[0].status, 'rejected', JSON.stringify(bad).slice(0, 80));
  }
  assert.equal(stored(env.hub, 'a').out, '15:00');
  // A super naming the PM's phone on a new shift gets a plain shift of its own phone, never one on the PM's.
  const claimed = ok(sup.push({ shifts: [shift({ id: 'x2', device: pm.dev, edited: { who: true, in: true, out: true } })] })).shifts[0];
  assert.deepEqual([claimed.status, claimed.shift.device, claimed.shift.edited.out], ['ok', sup.dev, false]);
  // The PM's own clock-in goes through worker rules, so a stale copy cannot undo a PM edit.
  ok(pm.push({ shifts: [shift({ id: 'pm1', device: pm.dev, who: 'Pat M', in: '08:00', out: '16:00' })] }));
  ok(pm.push({ shifts: [{ ...stored(env.hub, 'pm1'), out: '16:30', edited: { who: false, in: false, out: true } }] }));
  r = ok(pm.push({ shifts: [shift({ id: 'pm1', device: pm.dev, who: 'Pat M', in: '08:00', out: '16:00' })] }));
  assert.equal(r.shifts[0].shift.out, '16:30');
});

test('shift: a day the PM added by hand is not doubled by a late text', () => {
  const env = setup(), crew = phone(env, 'crew', 'crew-dev'), pm = phone(env, 'pm', 'pm-dev');
  ok(pm.push({ shifts: [shift({ id: 'pm1', device: '', who: 'ana p', date: '2026-10-12', in: '07:00', out: '15:30', edited: { who: true, in: true, out: true } })] }));
  const r = ok(crew.push({ shifts: [shift({ id: 'e', who: 'Ana P', date: '2026-10-12', out: '15:35' }), shift({ id: 'f', who: 'Ana P', date: '2026-10-13', out: '15:00' })] }));
  assert.deepEqual([r.shifts[0].shift.gone, r.shifts[1].shift.gone], [true, false]);
  const w = rowsOf(env.hub, 'Weekly totals');
  assert.deepEqual(w.map(x => [x.Name, x['Week of'], x.Hours, x.Shifts]), [['ana p', '2026-10-12', 16.5, 2]]);
  // A removed twin does not count: the PM's later removal frees the day.
  ok(pm.push({ shifts: [{ ...stored(env.hub, 'pm1'), gone: true }] }));
  const r2 = ok(crew.push({ shifts: [shift({ id: 'g', who: 'ANA P', date: '2026-10-12', out: '15:35' })] }));
  assert.equal(r2.shifts[0].shift.gone, false);
});

test('shift validation: id, device, date, clock-in are required and shaped; names trimmed; times may be HH:MM or HH:MM:SS', () => {
  const env = setup(), crew = phone(env, 'crew', 'crew-dev');
  const r = ok(crew.push({ shifts: [shift({ id: 'ok1', who: '  Jose  L ', out: '15:30:15' }), shift({ id: 'bad id' }), shift({ id: 'x1', date: '2026-02-30' }), shift({ id: 'x2', in: '' }), shift({ id: 'x3', in: '7:5' }), shift({ id: 'x4', out: '"><script>' }), 'junk', shift({ id: 'x5', device: 'bad dev' })] }));
  assert.deepEqual(r.shifts.map(x => x.status), ['ok', 'rejected', 'rejected', 'rejected', 'rejected', 'ok', 'rejected', 'rejected']);
  assert.equal(r.shifts[0].shift.who, 'Jose  L');
  assert.equal(r.shifts[5].shift.out, '', 'a bad clock-out is dropped, the shift stays open');
  assert.equal(r.shifts[7].reason, 'forbidden', 'a bad device id is empty: that is a PM-added shift');
});

test('shift rules match the client importShifts on random histories (worker texts and PM edits)', async () => {
  const { normShift } = await import('../docs/schwab/shared.mjs');
  const { importShifts } = await import('../docs/schwab/report.mjs');
  let seed = 12345;
  const rnd = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  const pick = a => a[rnd(a.length)];
  const people = [{ who: 'Dana R', dev: 'dA' }, { who: 'Eli T', dev: 'dB' }, { who: 'Ana P', dev: 'dC' }];
  const days = ['2026-10-12', '2026-10-13'];
  for (let history = 0; history < 40; history++) {
    const env = setup(), pmPhone = phone(env, 'pm', 'pm-dev'), log = [];
    const device = d => phone(env, 'crew', d);
    const compare = (label) => {
      const server = new Map(env.hub.entities('Hours').map(s => [s.id, s]));
      assert.equal(server.size, log.length, `${label}: same shifts (history ${history})`);
      for (const c of log) {
        const s = server.get(c.id);
        assert.ok(s, `${label}: ${c.id} exists (history ${history})`);
        assert.deepEqual({ id: s.id, device: s.device, who: s.who, date: s.date, in: s.in, out: s.out, edited: s.edited, gone: s.gone, at: s.at },
          { id: c.id, device: c.device, who: c.who, date: c.date, in: c.in, out: c.out, edited: c.edited, gone: c.gone, at: c.at }, `${label}: ${c.id} (history ${history})`);
      }
    };
    for (let step = 0; step < 14; step++) {
      const kind = rnd(10);
      if (kind < 6) { // a worker text: some of that phone's shifts, sent at some time (possibly opened late)
        const p = pick(people), at = 1 + rnd(40);
        const shifts = [];
        for (const date of days) {
          if (rnd(3) === 0) continue;
          const id = `${p.dev}-${date}`;
          shifts.push(normShift({ id, device: rnd(12) === 0 ? ID('intruder') : ID(p.dev), who: rnd(4) === 0 ? pick(['dana r', 'Dana Ruiz', p.who]) : p.who, date, in: pick(['07:00', '06:45']), out: pick(['', '', '15:30', '15:45']) }));
        }
        importShifts(log, shifts, at);
        for (const s of shifts) {
          const r = ok(device(s.device === ID('intruder') ? 'intruder' : p.dev).push({ shifts: [{ ...s, at }] }));
          void r;
        }
      } else if (kind < 9 && log.length) { // the PM edits one entry
        const c = pick(log);
        const op = rnd(4);
        if (op === 0) Object.assign(c, { out: pick(['14:00', '16:15']), edited: { ...c.edited, out: true } });
        else if (op === 1) Object.assign(c, { who: pick(['Renamed Person', 'Dana Typo Fixed']), edited: { ...c.edited, who: true } });
        else if (op === 2) Object.assign(c, { in: '08:10', edited: { ...c.edited, in: true } });
        else c.gone = true;
        ok(pmPhone.push({ shifts: [{ ...c }] }));
      } else { // the PM adds a day by hand
        const p = pick(people), date = pick(days), id = `hand-${p.dev}-${date}`;
        if (!log.some(x => x.id === id)) {
          const s = normShift({ id, device: '', who: rnd(2) ? p.who.toLowerCase() : p.who, date, in: '07:00', out: '15:30', edited: { who: true, in: true, out: true } });
          log.push(s);
          ok(pmPhone.push({ shifts: [s] }));
        }
      }
      compare('step ' + step);
    }
  }
});

// ---------- identity: devices, people, crews, task links (HUB.md, Identity) ----------
test('device identity: phone A cannot read or change phone B\'s hours by naming B\'s device id (as dev, as devSecret, in the shift); A\'s own sync and the PM\'s edits still work', () => {
  const env = setup(), A = phone(env, 'crew', 'phone-A'), B = phone(env, 'crew', 'phone-B'), pm = phone(env, 'pm', 'pm-phone'), sup = phone(env, 'super', 'sup-phone');
  ok(B.push({ shifts: [shift({ id: 'b1', device: B.dev, who: 'Bea B', in: '06:30', pid: 'p-bea', tasks: [{ uid: 'u1', id: 'T1019-01' }] })] }));
  ok(A.push({ shifts: [shift({ id: 'a1', device: A.dev, who: 'Al A', in: '07:00' })] }));
  const bBefore = stored(env.hub, 'b1');
  assert.equal(bBefore.device, B.dev, 'a shift carries the id derived from its phone\'s secret');
  const ids = r => ok(r).shifts.map(s => s.id).sort();
  // Reading: only the phone the secret proves.
  assert.deepEqual(ids(A.pull()), ['a1']);
  assert.deepEqual(ids(B.pull()), ['b1']);
  const asCrew = extra => env.hub.call(env.k.crew, 'pull', { since: 0, ...extra });
  assert.deepEqual(ids(asCrew({ devSecret: A.secret, dev: B.dev })), ['a1'], 'B\'s id as dev, next to A\'s own secret: still A');
  assert.deepEqual(ids(asCrew({ devSecret: B.dev })), [], 'B\'s id as the secret is some other phone, with no hours');
  assert.deepEqual(ids(asCrew({ dev: B.dev })), [], 'B\'s id and no secret: no phone at all');
  for (const bad of ['', 'short', B.dev + 'x', B.dev.slice(0, 31) + '-', 42, null, [A.secret], { s: A.secret }]) assert.deepEqual(ids(asCrew({ devSecret: bad, dev: B.dev })), [], 'a malformed secret is no secret: ' + JSON.stringify(bad));
  assert.deepEqual(ids(env.hub.call(env.k.super, 'pull', { since: 0, devSecret: sup.secret, dev: B.dev })), [], 'the superintendent key does not open it either');
  // Writing: B's shift, sent every way, from A's phone, from no phone, and from the superintendent's key.
  const evil = { ...bBefore, out: '23:00', who: 'Evil', in: '05:00', pid: 'p-evil', crew: 'Evil crew', tasks: [{ uid: 'x', id: 'X' }], at: T0 };
  const tries = [['crew', { devSecret: A.secret, dev: B.dev }], ['crew', { devSecret: B.dev, dev: B.dev }], ['crew', { dev: B.dev }], ['super', { devSecret: sup.secret, dev: B.dev }], ['super', { dev: B.dev }]];
  for (const [role, extra] of tries) {
    const r = ok(env.hub.call(env.k[role], 'push', { ...extra, shifts: [evil, { ...evil, device: A.dev }] }));
    assert.deepEqual(r.shifts.map(x => [x.status, x.reason]), [['rejected', 'device'], ['rejected', 'device']], role + ' sending ' + Object.keys(extra).join(' and '));
  }
  assert.deepEqual(stored(env.hub, 'b1'), bBefore, 'B\'s shift is exactly as B left it');
  // With no secret there is no phone: not even a brand-new shift can be filed (it would look like one the PM added by hand).
  for (const role of ['crew', 'super']) {
    const r = ok(env.hub.call(env.k[role], 'push', { dev: A.dev, shifts: [shift({ id: 'new-' + role, device: A.dev, who: 'Nobody' })] }));
    assert.deepEqual([r.shifts[0].status, r.shifts[0].reason], ['rejected', 'device'], role);
  }
  assert.ok(!env.hub.entities('Hours').some(x => x.who === 'Nobody'));
  assert.ok(!env.hub.entities('Activity').some(e => /Evil/.test(e.who + e.text)), 'and nothing was logged in its name');
  // A new shift that names B's device is A's own: it never shows up on B's phone.
  const claim = ok(A.push({ shifts: [shift({ id: 'a2', device: B.dev, who: 'Al A', date: '2026-10-18' })] })).shifts[0];
  assert.deepEqual([claim.status, claim.shift.device], ['ok', A.dev]);
  assert.deepEqual(ids(B.pull()), ['b1']);
  // A's own sync is untouched: clock out, read it back.
  const out = ok(A.push({ shifts: [{ ...stored(env.hub, 'a1'), out: '15:30', at: T0 - 100 }] })).shifts[0];
  assert.deepEqual([out.status, out.shift.out], ['ok', '15:30']);
  assert.deepEqual(A.pull().shifts.map(s => [s.id, s.out]).sort(), [['a1', '15:30'], ['a2', '']]);
  // The PM still edits B's shift (PM rules); B's phone sees the edit and cannot undo it.
  const fix = ok(pm.push({ shifts: [{ ...bBefore, out: '14:00', edited: { who: false, in: false, out: true } }] })).shifts[0];
  assert.deepEqual([fix.status, fix.shift.out, fix.shift.device, fix.shift.pid, fix.shift.tasks], ['ok', '14:00', B.dev, 'p-bea', [{ uid: 'u1', id: 'T1019-01' }]]);
  assert.deepEqual(B.pull().shifts.map(s => [s.id, s.out, s.edited.out]), [['b1', '14:00', true]]);
  ok(B.push({ shifts: [{ ...bBefore, out: '16:00', at: T0 }] }));
  assert.equal(stored(env.hub, 'b1').out, '14:00');
  // A PM phone with no secret still edits by PM rules (it speaks for no phone, so a plain shift of its own is refused).
  const noPhone = ok(env.hub.call(env.k.pm, 'push', { dev: pm.dev, shifts: [{ ...stored(env.hub, 'b1'), in: '06:15', edited: { who: false, in: true, out: true } }] })).shifts[0];
  assert.deepEqual([noPhone.status, noPhone.shift.in, noPhone.shift.device], ['ok', '06:15', B.dev]);
  // The secrets themselves are kept nowhere: not in the Sheet, the log, the properties, the cache or a reply.
  const everything = JSON.stringify([...env.hub.spreadsheets.values()].map(ss => ss.sheets.map(sh => sh.rows))) + env.hub.logs.join('\n') + JSON.stringify(env.hub.props) + JSON.stringify([...env.hub.cache.values()]);
  for (const p of [A, B, pm, sup]) assert.ok(!everything.includes(p.secret), p.label + ': a device secret is stored nowhere');
  assert.ok(!JSON.stringify(A.pull()).includes(A.secret) && !JSON.stringify(A.push({ shifts: [evil] })).includes(A.secret), 'nor answered');
});

test('task links: two offline office phones make sheets with the same date and short id; every shift still points to its own sheet', () => {
  const env = setup(), office1 = phone(env, 'super', 'office-1'), office2 = phone(env, 'pm', 'office-2'), x = phone(env, 'crew', 'phone-X'), y = phone(env, 'crew', 'phone-Y');
  // Offline, each office phone numbered its new sheet T1019-02 for the same day.
  const a = task({ uid: 'uid-office1', id: 'T1019-02', crew: 'Crew A', crewId: 'c-a', members: ['Jose L'], memberIds: ['p-jose-a'], scope: 'Office 1 sheet' });
  const b = task({ uid: 'uid-office2', id: 'T1019-02', crew: 'Crew B', crewId: 'c-b', members: ['Jose L'], memberIds: ['p-jose-b'], scope: 'Office 2 sheet' });
  // The workers clocked in against them, then everyone came back online in some order.
  const sx = shift({ id: 'sx', device: x.dev, who: 'Jose L', pid: 'p-jose-a', crew: 'Crew A', crewId: 'c-a', tasks: [{ uid: a.uid, id: 'T1019-02' }] });
  const sy = shift({ id: 'sy', device: y.dev, who: 'Jose L', pid: 'p-jose-b', crew: 'Crew B', crewId: 'c-b', tasks: [{ uid: b.uid, id: 'T1019-02' }] });
  ok(x.push({ shifts: [sx] }));
  ok(office2.push({ tasks: [b] }));
  ok(y.push({ shifts: [sy] }));
  ok(office1.push({ tasks: [a] }));
  assert.deepEqual(rowsOf(env.hub, 'Tasks').map(r => [r.key, r['Task ID'], r.Crew]).sort(), [['uid-office1', 'T1019-02', 'Crew A'], ['uid-office2', 'T1019-02', 'Crew B']], 'both sheets, side by side');
  // Whoever reads them resolves each shift's task by uid to the right sheet.
  const view = office2.pull(), byUid = Object.fromEntries(view.tasks.map(t => [t.uid, t]));
  assert.deepEqual(view.shifts.map(s => [s.id, s.tasks]).sort(), [['sx', [{ uid: 'uid-office1', id: 'T1019-02' }]], ['sy', [{ uid: 'uid-office2', id: 'T1019-02' }]]]);
  for (const s of view.shifts) assert.deepEqual([byUid[s.tasks[0].uid].crewId, byUid[s.tasks[0].uid].memberIds], [s.crewId, [s.pid]], s.id + ' points at its own sheet');
  assert.deepEqual(x.pull().tasks.map(t => [t.uid, t.scope]).sort(), [['uid-office1', 'Office 1 sheet'], ['uid-office2', 'Office 2 sheet']]);
  // One office renumbers its sheet: the link does not move; only the label kept next to it is the old one.
  ok(office1.push({ tasks: [{ ...a, id: 'T1019-03', assignAt: T0 - 10 }] }));
  const later = office2.pull();
  assert.deepEqual(Object.fromEntries(later.tasks.map(t => [t.uid, t.id])), { 'uid-office1': 'T1019-03', 'uid-office2': 'T1019-02' });
  assert.deepEqual(later.shifts.find(s => s.id === 'sx').tasks, [{ uid: 'uid-office1', id: 'T1019-02' }]);
  // Each phone's clock-out keeps its own link; the Hours tab shows the crew and the label each shift was made with.
  ok(x.push({ shifts: [{ ...sx, out: '15:30', at: T0 - 100 }] }));
  ok(y.push({ shifts: [{ ...sy, out: '15:00', at: T0 - 100 }] }));
  assert.deepEqual(env.hub.entities('Hours').map(s => [s.id, s.tasks.map(t => t.uid)]).sort(), [['sx', ['uid-office1']], ['sy', ['uid-office2']]]);
  assert.deepEqual(rowsOf(env.hub, 'Hours').map(r => [r.key, r.Crew, r.Tasks]).sort(), [['sx', 'Crew A', 'T1019-02'], ['sy', 'Crew B', 'T1019-02']]);
});

test('shift task links: a short id alone becomes {uid: "", id}; labels are printable, short and never start like a formula', () => {
  const env = setup(), crew = phone(env, 'crew');
  const s = ok(crew.push({ shifts: [shift({ id: 'v1', pid: 'bad pid', crewId: 'c-1', tasks: ['T1019-01', { uid: 'u-2', id: 'T1019-02' }, { uid: 'bad uid', id: 'T3' }, { uid: 'u-2', id: 'dup' }, '=SUM(A1)', '+1', '-2', '@x', 'y'.repeat(60),
    'a\u0000b\u202ec\u200bd', '', '   ', { uid: '', id: '' }, { uid: 'u-9' }, 'T1019-01', 'T1019-02', 7, null, [] ] })] })).shifts[0].shift;
  assert.deepEqual([s.pid, s.crewId], ['', 'c-1'], 'ids keep the uid format or are empty');
  // One link per uid and one per bare number; a bare number also sent with its uid is that link (as taskLinks in shared.mjs).
  assert.deepEqual(s.tasks, [{ uid: '', id: 'T1019-01' }, { uid: 'u-2', id: 'T1019-02' }, { uid: '', id: 'T3' }, { uid: '', id: 'SUM(A1)' }, { uid: '', id: '1' }, { uid: '', id: '2' }, { uid: '', id: 'x' },
    { uid: '', id: 'y'.repeat(40) }, { uid: '', id: 'a bcd' }, { uid: 'u-9', id: '' }]);
  assert.equal(rowsOf(env.hub, 'Hours')[0].Tasks, 'T1019-01, T1019-02, T3, SUM(A1), 1, 2, x, ' + 'y'.repeat(40) + ', a bcd, u-9', 'the Sheet shows the label, else the uid');
  const many = ok(crew.push({ shifts: [shift({ id: 'v2', tasks: Array.from({ length: 60 }, (_, i) => ({ uid: 'u' + i, id: 'T' + i })) })] })).shifts[0].shift;
  assert.equal(many.tasks.length, 50);
});

test('people and crews: ids survive config round trips, two people may share a name, renames keep the ids', () => {
  const env = setup(), sup = office(env), pm = phone(env, 'pm', 'pm-dev'), crew = phone(env, 'crew', 'crew-dev');
  const cfg = { project: 'Schwab', floors: ['L1'], at: T0 - 1000,
    crews: [{ id: 'c-a', name: 'Crew A', lead: 'Mike', members: 'Jose L, Mike' }, { id: 'c-b', name: 'Crew B', lead: '', members: 'Jose L' }],
    people: [{ id: 'p-jose-a', name: 'Jose L', crewId: 'c-a' }, { id: 'p-mike', name: 'Mike', crewId: 'c-a' }, { id: 'p-jose-b', name: 'Jose L', crewId: 'c-b' }] };
  const roster = c => ({ crews: c.crews, people: c.people });
  assert.deepEqual(roster(ok(sup.push({ config: cfg })).config), roster(cfg));
  for (const p of [crew, sup, pm]) assert.deepEqual(roster(p.pull().config), roster(cfg), p.role + ' reads the same roster, ids and all');
  // The copy a phone pulled goes back unchanged: nothing is written.
  const rev = Number(env.hub.props.REV);
  assert.equal(ok(pm.push({ config: pm.pull().config })).rev, rev, 'a round trip writes nothing');
  // Renames keep the ids; a crew phone sees the new names under the same ids.
  ok(pm.push({ config: { ...cfg, at: T0 - 500, crews: [{ ...cfg.crews[0], name: 'Electric A' }, cfg.crews[1]], people: [{ ...cfg.people[0], name: 'Jos\u00e9 Luis' }, cfg.people[1], cfg.people[2]] } }));
  const after = crew.pull().config;
  assert.deepEqual(after.people.map(p => [p.id, p.name, p.crewId]), [['p-jose-a', 'Jos\u00e9 Luis', 'c-a'], ['p-mike', 'Mike', 'c-a'], ['p-jose-b', 'Jose L', 'c-b']]);
  assert.deepEqual(after.crews.map(c => [c.id, c.name]), [['c-a', 'Electric A'], ['c-b', 'Crew B']]);
  // Validation: ids keep their format; a person needs a usable id of their own; names are trimmed and clipped; a crew
  // from an older phone (no id yet) is kept.
  const v = ok(pm.push({ config: { ...cfg, at: T0 - 100,
    crews: [{ id: 'bad id', name: 'X' }, { id: 'c-a', name: 'A' }, { id: 'c-a', name: 'A again' }, { name: 'Old phone crew', members: 'Ana' }],
    people: [{ id: 'p-1', name: '  Ana   P ', crewId: 'bad id' }, { id: 'p-1', name: 'Taken id' }, { id: '', name: 'No id' }, { id: 'p 2', name: 'Bad id' }, { id: 'p-3', name: 'n'.repeat(100), crewId: 'c-a' }, 'junk', { id: '__proto__', name: 'Odd but fine' }] } })).config;
  assert.deepEqual(v.crews.map(c => [c.id, c.name, c.members]), [['', 'X', ''], ['c-a', 'A', ''], ['', 'A again', ''], ['', 'Old phone crew', 'Ana']]);
  assert.deepEqual(v.people.map(p => [p.id, p.name, p.crewId]), [['p-1', 'Ana   P', ''], ['p-3', 'n'.repeat(60), 'c-a'], ['__proto__', 'Odd but fine', '']]);
  const many = ok(pm.push({ config: { ...cfg, at: T0, people: Array.from({ length: 600 }, (_, i) => ({ id: 'p' + i, name: 'P ' + i, crewId: 'c-a' })) } })).config;
  assert.equal(many.people.length, 500, 'capped at 500 like every list');
  assert.equal({}.polluted, undefined);
});

test('Weekly totals go by person id: two people named Jose L stay apart, and a renamed person keeps their hours', () => {
  const env = setup(), pm = phone(env, 'pm', 'pm-dev'), x = phone(env, 'crew', 'phone-X'), y = phone(env, 'crew', 'phone-Y');
  const cfg = { at: T0 - 9000, crews: [{ id: 'c-a', name: 'Crew A', members: 'Jose L' }, { id: 'c-b', name: 'Crew B', members: 'Jose L' }],
    people: [{ id: 'p-a', name: 'Jose L', crewId: 'c-a' }, { id: 'p-b', name: 'Jose L', crewId: 'c-b' }] };
  ok(pm.push({ config: cfg }));
  ok(x.push({ shifts: [shift({ id: 'x1', device: x.dev, who: 'Jose L', pid: 'p-a', crewId: 'c-a', in: '07:00', out: '15:00' }), shift({ id: 'x2', device: x.dev, who: 'jose l', pid: 'p-a', date: '2026-10-20', in: '07:00', out: '11:00' })] }));
  ok(y.push({ shifts: [shift({ id: 'y1', device: y.dev, who: 'Jos\u00e9 L.', pid: 'p-b', crewId: 'c-b', in: '06:00', out: '16:30' })] }));
  ok(pm.push({ shifts: [shift({ id: 'old', device: '', who: 'JOSE  L', date: '2026-10-21', in: '07:00', out: '08:00' })] })); // an older shift with no person id: by name
  const weekly = () => rowsOf(env.hub, 'Weekly totals').map(r => [r.Name, r['Week of'], r.Hours, r.Shifts]);
  assert.deepEqual(weekly(), [['JOSE  L', '2026-10-19', 1, 1], ['Jose L (Crew A)', '2026-10-19', 12, 2], ['Jose L (Crew B)', '2026-10-19', 10.5, 1]], 'the same name, three timesheets; the roster names two of them, with their crews');
  // Rename p-a: the roster push itself rewrites the totals: the new name, the same hours; the other Jose L is alone now.
  ok(pm.push({ config: { ...cfg, at: T0 - 8000, people: [{ ...cfg.people[0], name: 'Jose Luis' }, cfg.people[1]] } }));
  assert.deepEqual(weekly(), [['JOSE  L', '2026-10-19', 1, 1], ['Jose L', '2026-10-19', 10.5, 1], ['Jose Luis', '2026-10-19', 12, 2]]);
  // Shifts keep the name they were made with; a new one under the new name joins the same timesheet.
  assert.deepEqual(rowsOf(env.hub, 'Hours').filter(r => r.key[0] === 'x').map(r => r.Name), ['Jose L', 'jose l']);
  ok(x.push({ shifts: [shift({ id: 'x3', device: x.dev, who: 'Jose Luis', pid: 'p-a', date: '2026-10-22', in: '07:00', out: '09:00' })] }));
  assert.deepEqual(weekly().find(r => r[0] === 'Jose Luis'), ['Jose Luis', '2026-10-19', 14, 3]);
  // Rename a crew: where two people share a name again, the label carries the crew's current name.
  ok(pm.push({ config: { ...cfg, at: T0 - 7000, crews: [{ ...cfg.crews[0], name: 'Electric A' }, cfg.crews[1]] } }));
  assert.deepEqual(weekly().map(r => r[0]), ['JOSE  L', 'Jose L (Crew B)', 'Jose L (Electric A)']);
  // A person the roster does not know (yet) keeps the first spelling seen.
  ok(phone(env, 'crew', 'phone-Z').push({ shifts: [shift({ id: 'z1', device: ID('phone-Z'), who: 'New Guy', pid: 'p-new', in: '07:00', out: '08:00' })] }));
  assert.ok(weekly().some(r => r[0] === 'New Guy'));
});

test('a day the PM added by hand is matched by person id first: a namesake\'s clock-in is kept, the person\'s own is filed removed', () => {
  const env = setup(), pm = phone(env, 'pm', 'pm-dev'), x = phone(env, 'crew', 'phone-X'), y = phone(env, 'crew', 'phone-Y'), old = phone(env, 'crew', 'old-phone');
  ok(pm.push({ shifts: [shift({ id: 'hand', device: '', who: 'Jose L', pid: 'p-a', date: '2026-10-14', in: '07:00', out: '15:00', edited: { who: true, in: true, out: true } })] }));
  const gone = (p, o) => ok(p.push({ shifts: [shift({ date: '2026-10-14', device: p.dev, ...o })] })).shifts[0].shift.gone;
  assert.equal(gone(y, { id: 'y14', who: 'Jose L', pid: 'p-b' }), false, 'another Jose L');
  assert.equal(gone(x, { id: 'x14', who: 'Jose Luis', pid: 'p-a' }), true, 'the same person under a new name');
  assert.equal(gone(old, { id: 'o14', who: 'jos\u00e9  l' }), true, 'a phone with no person id is matched by the name, however typed');
});

test('round trip: every field of every template survives a push and a pull, and sending the pulled copy back writes nothing', () => {
  const env = setup(), pm = phone(env, 'pm', 'pm-dev'), crew = phone(env, 'crew', 'crew-dev');
  const tpl = name => JSON.parse(JSON.stringify(env.hub.eval(name)));
  // Every field set to something that is not its default: text 'x', numbers 5, booleans flipped, lists of one.
  const one = v => (Array.isArray(v) ? [one(v[0])] : v && typeof v === 'object' ? fill(v) : typeof v === 'string' ? 'x' : typeof v === 'number' ? 5 : !v);
  const fill = (t, over = {}) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, k in over ? over[k] : one(v)]));
  const time = '07:00', pin = 'a'.repeat(16) + ':' + 'b'.repeat(64);
  const t = fill(tpl('TASK'), { uid: 'rt-task', date: '2026-10-19', pStart: time, pStop: time, checkIn: time, aStart: time, aStop: time, aLang: 'es', cLang: 'es' });
  const s = fill(tpl('SHIFT'), { id: 'rt-shift', device: ID('crew-dev'), date: '2026-10-19', in: time, out: '15:00' });
  const r = fill(tpl('REPORT'), { date: '2026-10-19', status: 'At risk', lang: 'es' });
  const c = fill(tpl('CONFIG'), { pin });
  const first = ok(pm.push({ tasks: [t], shifts: [s], reports: [r], config: c }));
  assert.deepEqual([first.tasks[0].status, first.shifts[0].status, first.reports[0].status, first.configStatus], ['ok', 'ok', 'ok', 'ok']);
  const got = pm.pull(), strip = ({ rev, ...x }) => x;
  assert.deepEqual(strip(got.tasks[0]), t, 'every task field, both parts, the stamps, the reply and the ids');
  assert.deepEqual(strip(got.shifts[0]), s, 'every shift field: person, crew and task links included');
  assert.deepEqual(strip(got.reports[0]), r, 'every report field, the PM part and its stamp included');
  assert.deepEqual(strip(got.config), c, 'every config field: people and crews with their ids');
  const rev = got.rev;
  assert.equal(ok(pm.push({ tasks: got.tasks, shifts: got.shifts, reports: got.reports, config: got.config })).rev, rev, 'the PM sends it all back: nothing to write');
  const mine = ok(crew.push({ tasks: got.tasks, shifts: got.shifts }));
  assert.deepEqual([mine.rev, mine.shifts[0].status], [rev, 'ok'], 'nor from the phone the shift belongs to');
});

// ---------- hours math ----------
test('hours: server minutes and payroll hundredths equal the client across both clock changes and overnight shifts', async () => {
  const { shiftMin, monday } = await import('../docs/schwab/report.mjs');
  const env = setup(), pm = phone(env, 'pm', 'pm-dev');
  const dates = ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-07-04', '2026-12-31'];
  const ins = ['00:00', '01:30', '02:30', '03:00', '07:00', '22:00', '23:59'], outs = ['', '00:15', '01:45', '02:30', '06:00', '15:30', '22:00', '07:00'];
  const all = [];
  let n = 0;
  for (const date of dates) for (const i of ins) for (const o of outs) all.push({ id: 'h' + n++, device: '', who: 'P' + (n % 4), date, in: i, out: o });
  assert.ok(all.length > 500);
  for (let i = 0; i < all.length; i += 200) ok(pm.push({ shifts: all.slice(i, i + 200) }));
  const rows = rowsOf(env.hub, 'Hours');
  assert.equal(rows.length, all.length);
  const byId = Object.fromEntries(env.hub.table('Hours').map(r => [r[11], r]));
  let nights = 0;
  for (const s of all) {
    const want = s.out ? Math.round(shiftMin(s) * 5 / 3) : null;
    const cell = byId[s.id][6];
    if (want === null) assert.equal(cell, '', 'open shift has no hours');
    else assert.equal(Math.round(cell * 100), want, `${s.date} ${s.in}-${s.out}`);
    if (s.out && s.out < s.in) nights++;
  }
  assert.ok(nights > 100, 'overnight shifts were covered');
  assert.equal(Math.round(rowsOf(env.hub, 'Hours').find(r => r.Date === '2026-10-31' && r['Clock in'] === '22:00' && r['Clock out'] === '06:00').Hours * 100), 900, 'the night clocks fall back: 9 real hours');
  assert.equal(Math.round(rowsOf(env.hub, 'Hours').find(r => r.Date === '2026-03-07' && r['Clock in'] === '22:00' && r['Clock out'] === '06:00').Hours * 100), 700, 'the night clocks spring forward: 7 real hours');
  // Weekly totals add the per-shift hundredths, per person and Monday week, exactly like byPerson.
  const want = new Map();
  for (const s of all) {
    if (!s.out) continue;
    const k = monday(s.date) + '|' + s.who.toLowerCase();
    want.set(k, (want.get(k) || 0) + Math.round(shiftMin(s) * 5 / 3));
  }
  const got = new Map(rowsOf(env.hub, 'Weekly totals').map(r => [r['Week of'] + '|' + r.Name.toLowerCase(), r]));
  assert.equal(got.size, new Set(all.map(s => monday(s.date) + '|' + s.who.toLowerCase())).size);
  for (const [k, cents] of want) assert.equal(Math.round(got.get(k).Hours * 100), cents, k);
  for (const r of got.values()) assert.equal(r['Open shifts'] + 0, all.filter(s => !s.out && monday(s.date) === r['Week of'] && s.who.toLowerCase() === r.Name.toLowerCase()).length);
});

test('weekly totals: three 7h20m shifts are 21.99 hours, one row per person per week, rewritten on every shift write', () => {
  const env = setup(), crew = phone(env, 'crew', 'crew-dev'), pm = phone(env, 'pm', 'pm-dev');
  ok(crew.push({ shifts: ['a', 'b', 'c'].map((id, i) => shift({ id, date: '2026-10-1' + (3 + i), in: '07:00', out: '14:20' })).concat([shift({ id: 'open', date: '2026-10-19', in: '07:00', who: 'dana r' })]) }));
  let w = rowsOf(env.hub, 'Weekly totals');
  assert.deepEqual(w.map(r => [r.Name, r['Week of'], r.Hours, r.Shifts, r['Open shifts']]), [['dana r', '2026-10-19', 0, 1, 1], ['Dana R', '2026-10-12', 21.99, 3, 0]]); // one row per person per week, the first spelling seen in that week
  ok(crew.push({ shifts: [shift({ id: 'open', date: '2026-10-19', in: '07:00', out: '15:00', who: 'dana r' })] }));
  w = rowsOf(env.hub, 'Weekly totals');
  assert.deepEqual(w.map(r => [r['Week of'], r.Hours, r['Open shifts']]), [['2026-10-19', 8, 0], ['2026-10-12', 21.99, 0]], 'newest week first');
  ok(pm.push({ shifts: [{ ...env.hub.entities('Hours').find(s => s.id === 'a'), gone: true }] }));
  assert.deepEqual(rowsOf(env.hub, 'Weekly totals').map(r => [r['Week of'], r.Hours, r.Shifts]), [['2026-10-19', 8, 1], ['2026-10-12', 14.66, 2]], 'a removed shift leaves the totals');
});

// ---------- the field lists the server and the app share ----------
// HUB.md, Round trip: every synced field exists in the templates on both sides, so normalization (a sync, a reload, a
// backup restore) never strips one. The comparison is by field and type, nested lists and objects included.
test('ASSIGN and CREW agree with shared.mjs; the entity templates are the client templates, field for field', async () => {
  const src = fs.readFileSync(path.join(DIR, 'shared.mjs'), 'utf8');
  const list = name => { const m = new RegExp(`const ${name} = (\\[[^\\]]*\\])`).exec(src); assert.ok(m, name + ' found in shared.mjs'); return JSON.parse(m[1].replace(/'/g, '"')); };
  const hub = createHub({ now: T0 });
  const get = expr => JSON.parse(JSON.stringify(hub.eval(expr)));
  const sorted = a => a.slice().sort();
  // The parts are what HUB.md fixes, not how each side splits its lists: the app's assignment fields are the hub's office part.
  const office = get('ASSIGN').concat(get('OFFICE_EXTRA'));
  assert.deepEqual(list('ASSIGN').filter(k => !office.includes(k)), [], 'every field the app treats as the assignment is the office part on the hub');
  assert.deepEqual(list('ASSIGN').filter(k => get('CREW').includes(k)), [], 'and none of them is the crew part');
  for (const k of ['crewId', 'memberIds']) assert.ok(list('ASSIGN').includes(k) && get('ASSIGN').includes(k), k + ' travels with crew and members');
  assert.deepEqual(sorted(get('CREW')), sorted(list('CREW')), 'the crew part of a task');
  const shared = await import('../docs/schwab/shared.mjs');
  // A template's shape: field names and value types, all the way down ('s' and 't' on the server are both strings).
  const sig = t => (Array.isArray(t) ? [sig(t[0])] : t && typeof t === 'object' ? Object.fromEntries(Object.keys(t).sort().map(k => [k, sig(t[k])])) : typeof t);
  const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
  const LOCAL = ['origin', 'from', 'gotAt', 'filedAt', 'updatedAt']; // HUB.md: task fields that never leave a phone
  const server = { TASK: get('TASK'), SHIFT: get('SHIFT'), REPORT: get('REPORT'), CONFIG: get('CONFIG') };
  assert.deepEqual(sig(server.TASK), sig(omit(shared.TASK_TPL, LOCAL)), 'TASK_TPL holds every synced task field: crewId, memberIds, reply, replyAt, replyBy, aLang and the part stamps assignAt, crewAt');
  assert.deepEqual(sig(get('ITEM')), sig(shared.TASK_TPL.items[0]));
  assert.deepEqual(sig(server.SHIFT), sig(shared.SHIFT_TPL), 'SHIFT_TPL: pid, crewId and tasks as [{uid, id}]');
  assert.deepEqual(Object.keys(server.SHIFT.tasks[0]).sort(), ['id', 'uid']);
  assert.deepEqual(sig(server.REPORT), sig(omit(shared.REPORT_TPL, ['filedAt'])), 'REPORT_TPL: lang and the PM part stamp pmAt');
  assert.deepEqual(Object.keys(server.REPORT.floors[0].crews[0]), Object.keys(shared.CREW_TPL));
  // Config is the shared part of the settings: each field has the setting's shape; secrets and personal settings stay out.
  for (const k of Object.keys(server.CONFIG).filter(k => k !== 'at')) assert.deepEqual(sig(server.CONFIG[k]), sig(shared.SETTINGS_TPL[k]), 'config field ' + k + ' is a setting of the same shape');
  assert.deepEqual(Object.keys(server.CONFIG.crews[0]).sort(), ['id', 'lead', 'members', 'name']);
  assert.deepEqual(Object.keys(server.CONFIG.people[0]).sort(), ['crewId', 'id', 'name']);
  for (const k of ['folderUrl', 'siteCode', 'hubKey', 'hubUrl', 'hubRole', 'hubCrew', 'worker', 'device', 'me', 'role', 'lang']) assert.ok(!(k in server.CONFIG), k + ' is never synced');
});

// ---------- what the owner reads in the Sheet ----------
test('the Sheet is labeled per person, week and task: cell by cell', () => {
  const env = setup(), sup = office(env), pm = phone(env, 'pm', 'pm-dev'), crew = phone(env, 'crew', 'crew-dev');
  ok(sup.push({ tasks: [task({ area: 'Room 3E', scope: 'Pull 12 AWG', review: 'Accepted', followUp: 'check L2', reply: 'Thanks' }), task({ uid: 'u2', id: 'T1019-02', date: '2026-10-20', crew: 'Crew B' })], reports: [report({ pmReview: 'Fine' })] }));
  ok(crew.push({ tasks: [task({ status: 'Partial', doneText: 'Half done', remain: 'The rest', comments: 'ladder', aStart: '07:00', aStop: '08:30', delay: 15, crewAt: T0 - 1, items: [{ id: 'i1', done: true, at: 5 }] })] }));
  ok(crew.push({ shifts: [shift({ id: 'a', out: '15:45', crew: 'Crew A', tasks: ['T1019-01', 'T1019-02'] }), shift({ id: 'b', date: '2026-10-13', who: 'Dana R', out: '15:00' })] }));
  ok(pm.push({ shifts: [shift({ id: 'c', device: '', who: 'Ana P', date: '2026-10-14', in: '07:00', out: '', edited: { who: true, in: true, out: false } })], reports: [report({ pmReview: 'Fine', pmAt: T0 - 2 })] }));
  const t = rowsOf(env.hub, 'Tasks');
  assert.deepEqual(t.find(r => r['Task ID'] === 'T1019-01'), { Date: '2026-10-19', 'Task ID': 'T1019-01', Crew: 'Crew A', Floor: 'Level 3', Area: 'Room 3E', Status: 'Partial', 'Steps done': '1/2', 'Minutes worked': 75, Scope: 'Pull 12 AWG', Completed: 'Half done', Remaining: 'The rest', 'Crew comments': 'ladder', Review: 'Accepted', 'Follow-up': 'check L2', Reply: 'Thanks', Updated: '2026-10-19 12:00', key: 'u1', rev: t.find(r => r.key === 'u1').rev, data: t.find(r => r.key === 'u1').data });
  assert.equal(t.find(r => r['Task ID'] === 'T1019-02')['Steps done'], '0/2');
  const h = rowsOf(env.hub, 'Hours');
  const a = h.find(r => r.key === 'a');
  assert.deepEqual([a.Name, a['Week of'], a.Date, a.Day, a['Clock in'], a['Clock out'], a.Hours, a['Edited by PM'], a.Note, a.Crew, a.Tasks], ['Dana R', '2026-10-19', '2026-10-19', 'Mon', '07:00', '15:45', 8.75, '', '', 'Crew A', 'T1019-01, T1019-02']);
  const c = h.find(r => r.key === 'c');
  assert.deepEqual([c.Name, c['Week of'], c.Day, c.Hours, c['Edited by PM'], c.Note], ['Ana P', '2026-10-12', 'Wed', '', 'Yes', 'No clock-out']);
  assert.deepEqual(rowsOf(env.hub, 'Weekly totals').map(r => [r.Name, r['Week of'], r.Hours, r.Shifts, r['Open shifts']]), [['Dana R', '2026-10-19', 8.75, 1, 0], ['Ana P', '2026-10-12', 0, 1, 1], ['Dana R', '2026-10-12', 8, 1, 0]]);
  const r = rowsOf(env.hub, 'Reports')[0];
  assert.deepEqual([r.Date, r.Superintendent, r.Status, r.Results, r['Decisions waiting'], r['PM review']], ['2026-10-19', 'Sam', 'On plan', 'Good day', 2, 'Fine']);
  const act = rowsOf(env.hub, 'Activity').map(x => [x.When, x.Who, x.What, x.Ref]);
  assert.deepEqual(act[0], ['2026-10-19 12:00', 'Sam', 'New task T1019-01 for Crew A, Level 3', 'T1019-01']);
  assert.ok(act.some(x => /^Crew A started T1019-01 at 7:00 AM$/.test(x[2])) && act.some(x => /^Dana R clocked out at 3:45 PM, 2026-10-19$/.test(x[2])), JSON.stringify(act));
  // Dates and times are text, hours are numbers: nothing was reinterpreted.
  assert.equal(typeof env.hub.cell('Hours', 'C2'), 'string');
  assert.equal(typeof env.hub.cell('Hours', 'G2'), 'number');
  assert.equal(env.hub.cell('Tasks', 'G2'), '1/2');
});

test('typed text can never run as a formula: every write is RAW, and the fake knows the difference', () => {
  const env = setup(), sup = office(env), pm = phone(env, 'pm', 'pm-dev'), crew = phone(env, 'crew', 'crew-dev');
  const evil = '=HYPERLINK("http://evil.example","click")';
  ok(sup.push({ tasks: [task({ scope: evil, by: '+1+1', area: '@SUM(1)', floor: '-2+3' })], reports: [report({ results: evil, super: evil })], config: { project: evil } }));
  ok(crew.push({ tasks: [task({ comments: evil, doneText: '=1+1', crewAt: T0 - 1 })], shifts: [shift({ who: evil, crew: evil, tasks: [evil] })] }));
  ok(pm.push({ shifts: [shift({ id: 'p', device: '', who: '=cmd|calc', in: '07:00', out: '08:00' })] }));
  ok(pm.call('translate', { items: [evil], from: 'en', to: 'es' }));
  assert.deepEqual(env.hub.formulaCells(), [], 'no cell anywhere is a formula');
  assert.equal(env.hub.cell('Hours', 'A2'), evil, 'the name is kept as typed, a plain string');
  assert.equal(rowsOf(env.hub, 'Weekly totals').find(r => r.Name === evil).Name, evil);
  assert.equal(rowsOf(env.hub, 'Tasks')[0].Scope, evil);
  assert.equal(pm.pull().shifts.find(s => s.who === evil).who, evil);
  // The fake itself: the same text through USER_ENTERED would have become a formula, and RAW is required.
  const ctx = env.hub.load();
  const id = env.hub.sheetId();
  env.hub.locked = true;
  ctx.Sheets.Spreadsheets.Values.update({ values: [[evil, '3/5', '2026-10-19', '007']] }, id, 'Config!A5', { valueInputOption: 'USER_ENTERED' });
  env.hub.locked = false;
  assert.deepEqual(env.hub.formulaCells().length, 1, 'USER_ENTERED makes a formula in the fake');
  assert.equal(typeof env.hub.cell('Config', 'D5'), 'number', 'and a number');
  assert.equal(typeof env.hub.cell('Config', 'B5'), 'object', 'and a date, not the text 3/5');
});

test('the fake refuses what the real Sheets API refuses: unknown fields, wrong types, bad ranges, missing options, unlocked writes', () => {
  const env = setup();
  const S = env.hub.load().Sheets.Spreadsheets, id = env.hub.sheetId(), sid = S.get(id, { fields: 'sheets.properties(sheetId,title)' }).sheets[0].properties.sheetId;
  const locked = fn => { env.hub.locked = true; try { return fn(); } finally { env.hub.locked = false; } };
  const bad = (fn, re) => assert.throws(() => locked(fn), re);
  bad(() => S.Values.update({ values: [['x']] }, id, 'Tasks!A5'), /valueInputOption/);
  bad(() => S.Values.update({ values: [['x']], bogus: 1 }, id, 'Tasks!A5', { valueInputOption: 'RAW' }), /Unknown name "bogus"/);
  bad(() => S.Values.update({ values: [[{ a: 1 }]] }, id, 'Tasks!A5', { valueInputOption: 'RAW' }), /string, number, boolean/);
  bad(() => S.Values.update({ values: [['x']] }, id, 'Tasks!A5', { valueInputOption: 'raw' }), /expected one of/);
  bad(() => S.Values.update({ values: [['x']] }, id, 'Tasks!A5', { valueInputOption: 'RAW', extra: true }), /Unknown name "extra"/);
  bad(() => S.Values.update({ values: [['x']] }, 'Tasks!A5', id, { valueInputOption: 'RAW' }), /Requested entity was not found|Unable to parse/);
  bad(() => S.Values.update({ values: [['x']] }, id, 'Tasks!A5000', { valueInputOption: 'RAW' }), /exceeds grid limits/);
  bad(() => S.Values.update({ values: [['x']] }, id, 'Tasks!Z5', { valueInputOption: 'RAW' }), /exceeds grid limits/);
  bad(() => S.Values.update({ values: [['x'.repeat(50001)]] }, id, 'Tasks!A5', { valueInputOption: 'RAW' }), /50000 characters/);
  bad(() => S.Values.update({ values: [['a', 'b']] }, id, 'Tasks!A5:A5', { valueInputOption: 'RAW' }), /larger range/);
  bad(() => S.Values.update({ values: [['x']] }, id, 'Nope!A5', { valueInputOption: 'RAW' }), /Unable to parse range/);
  bad(() => S.Values.get(id, 'Tasks!A1', { valueRenderOption: 'UNFORMATTED' }), /expected one of/);
  bad(() => S.Values.batchGet(id, { range: ['Tasks!A1'] }), /Unknown name "range"/);
  bad(() => S.Values.append({ values: [['x']] }, id, 'Tasks!A1', { insertDataOption: 'INSERT_ROWS' }), /valueInputOption/);
  bad(() => S.Values.clear({ range: 'x' }, id, 'Tasks!A2:S'), /Unknown name "range"/);
  bad(() => S.Values.batchUpdate({ data: [{ range: 'Tasks!A5', values: [['x']] }] }, id), /valueInputOption/);
  bad(() => S.Values.batchUpdate({ valueInputOption: 'RAW', data: [{ values: [['x']] }] }, id), /range and values are required/);
  bad(() => S.batchUpdate({ requests: [{ repeatCell: { range: { sheetId: sid }, cell: {}, fields: 'userEnteredFormat.bold' } }] }, id), /unknown field/);
  bad(() => S.batchUpdate({ requests: [{ updateCells: {} }] }, id), /Unknown name "updateCells"/);
  bad(() => S.batchUpdate({ requests: [{ deleteDimension: { range: { sheetId: sid, dimension: 'ROW', startIndex: 1, endIndex: 2 } } }] }, id), /expected one of/);
  bad(() => S.batchUpdate({ requests: [{ deleteDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: 1, endIndex: '2' } } }] }, id), /expected an integer/);
  bad(() => S.batchUpdate({ requests: [{ deleteDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: 1, endIndex: 100000 } } }] }, id), /Invalid dimension range/);
  bad(() => S.batchUpdate({ requests: [{ deleteDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: 1, endIndex: 1000 } } }] }, id), /non-frozen rows/);
  bad(() => S.batchUpdate({ requests: [{ deleteDimension: { range: { sheetId: 7, dimension: 'ROWS', startIndex: 1, endIndex: 2 } } }] }, id), /No grid with id/);
  bad(() => S.batchUpdate({ requests: [{ addSheet: { properties: { title: 'Tasks' } } }] }, id), /already exists/);
  bad(() => S.batchUpdate({ requests: [] }, id, 'x'), /wrong number of arguments/);
  bad(() => S.get(id, { fields: 'sheets.nonsense' }), /Invalid field selection/);
  bad(() => S.create({ properties: { name: 'x' } }), /Unknown name "name"/);
  // Atomic: a good request followed by a bad one changes nothing.
  const before = env.hub.format('Tasks').widths[0];
  bad(() => S.batchUpdate({ requests: [{ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 999 }, fields: 'pixelSize' } }, { deleteDimension: { range: { sheetId: 7, dimension: 'ROWS', startIndex: 1, endIndex: 2 } } }] }, id), /No grid/);
  assert.equal(env.hub.format('Tasks').widths[0], before);
  // Writes outside the script lock fail in the fake.
  assert.throws(() => S.Values.update({ values: [['x']] }, id, 'Tasks!A5', { valueInputOption: 'RAW' }), /outside a LockService/);
  assert.throws(() => env.hub.load().PropertiesService.getScriptProperties().setProperty('A', 'b'), /outside a LockService/);
  // Reads default to text, UNFORMATTED keeps numbers, and trailing empty cells are dropped.
  locked(() => S.Values.update({ values: [[1.5, 'a', '', '']] }, id, 'Config!A9', { valueInputOption: 'RAW' }));
  assert.deepEqual(S.Values.get(id, 'Config!A9:D9').values, [['1.5', 'a']]);
  assert.deepEqual(S.Values.get(id, 'Config!A9:D9', { valueRenderOption: 'UNFORMATTED_VALUE' }).values, [[1.5, 'a']]);
  assert.equal(S.Values.get(id, 'Config!A20:D20').values, undefined, 'an empty range has no values key');
});

// ---------- reports ----------
test('report: the superintendent writes it, the PM answers; each part is replaced only by a newer-or-equal stamp', () => {
  const env = setup(), sup = office(env), pm = phone(env, 'pm', 'pm-dev'), crew = phone(env, 'crew', 'crew-dev');
  const denied = ok(crew.push({ reports: [report()] }));
  assert.deepEqual([denied.reports[0].status, denied.reports[0].reason, denied.reports[0].key], ['rejected', 'forbidden', '2026-10-19']);
  assert.equal(env.hub.table('Reports').length, 0);
  ok(sup.push({ reports: [report({ lang: 'es', submittedAt: T0 - 100 })] }));
  // The superintendent cannot write the PM's part.
  let r = ok(sup.push({ reports: [report({ updatedAt: T0 - 2000, pmReview: 'sneaky', pmAt: T0 - 10, decisions: [{ q: 'Which panel?', rec: 'LP-1', pm: 'LP-9', pmNote: 'x' }, { q: 'Fire stop?', rec: 'Yes' }] })] })).reports[0].report;
  assert.deepEqual([r.pmReview, r.pmAt, r.decisions[0].pm], ['', 0, ''], 'ignored, and an older super part changed nothing');
  r = ok(sup.push({ reports: [report({ results: 'Updated results', updatedAt: T0 - 1500, pmReview: 'sneaky', decisions: [{ q: 'Which panel?', rec: 'LP-1', pm: 'LP-9' }, { q: 'Fire stop?', rec: 'Yes' }] })] })).reports[0].report;
  assert.deepEqual([r.results, r.pmReview, r.decisions.map(d => d.pm), r.lang], ['Updated results', '', ['', ''], ''], 'a newer super part applies, still without any PM field (lang is the super\'s: now empty)');
  // The PM answers; the super's next edit keeps the answers, matched by question.
  const mine = (o = {}) => report({ updatedAt: T0 - 1500, results: 'Updated results', decisions: [{ q: 'Which panel?', rec: 'LP-1', pm: 'LP-2', pmNote: 'use LP-2' }, { q: 'Fire stop?', rec: 'Yes' }], pmReview: 'Looks good', pmAt: T0 - 500, ...o });
  r = ok(pm.push({ reports: [mine()] })).reports[0].report;
  assert.deepEqual([r.decisions.map(d => [d.pm, d.pmNote]), r.pmReview, r.pmAt, r.results], [[['LP-2', 'use LP-2'], ['', '']], 'Looks good', T0 - 500, 'Updated results']);
  r = ok(sup.push({ reports: [report({ updatedAt: T0 - 400, results: 'Evening results', decisions: [{ q: 'Which panel?', rec: 'LP-1b' }, { q: 'Fire stop?', rec: 'Yes' }, { q: 'New question?', rec: 'No' }] })] })).reports[0].report;
  assert.deepEqual(r.decisions.map(d => [d.q, d.rec, d.pm]), [['Which panel?', 'LP-1b', 'LP-2'], ['Fire stop?', 'Yes', ''], ['New question?', 'No', '']]);
  assert.equal(r.pmReview, 'Looks good');
  // A reworded question: the answer is kept as its own entry, never dropped.
  r = ok(sup.push({ reports: [report({ updatedAt: T0 - 300, decisions: [{ q: 'Which panel now?', rec: 'LP-1b' }] })] })).reports[0].report;
  assert.deepEqual(r.decisions.map(d => [d.q, d.pm]), [['Which panel now?', ''], ['Which panel?', 'LP-2']]);
  // PM part: older ignored, tie wins; PM cannot override the super part with a tie, only with a newer stamp.
  r = ok(pm.push({ reports: [mine({ pmReview: 'older', pmAt: T0 - 900, updatedAt: T0 - 300, decisions: [{ q: 'Which panel?', pm: 'LP-5' }] })] })).reports[0].report;
  assert.deepEqual([r.pmReview, r.decisions.find(d => d.q === 'Which panel?').pm], ['Looks good', 'LP-2']);
  r = ok(pm.push({ reports: [mine({ pmReview: 'same stamp', pmAt: T0 - 500, results: 'PM tie edit', updatedAt: T0 - 300, decisions: [{ q: 'Which panel?', pm: 'LP-6' }] })] })).reports[0].report;
  assert.deepEqual([r.pmReview, r.decisions.find(d => d.q === 'Which panel?').pm, r.results], ['same stamp', 'LP-6', 'Good day']);
  r = ok(pm.push({ reports: [mine({ results: 'PM fixed it', updatedAt: T0 - 100, pmAt: T0 - 90, decisions: [{ q: 'Which panel?', pm: 'LP-6' }] })] })).reports[0].report;
  assert.equal(r.results, 'PM fixed it', 'a strictly newer super part from the PM applies');
  // Clearing an answer is a newer PM part too.
  r = ok(pm.push({ reports: [mine({ updatedAt: T0 - 100, pmReview: '', pmAt: T0 - 50, decisions: [{ q: 'Which panel?', pm: '', pmNote: '' }] })] })).reports[0].report;
  assert.deepEqual([r.pmReview, r.decisions.find(d => d.q === 'Which panel?').pm], ['', '']);
});

test('report: status list, impossible dates, events, and the report-sent line', () => {
  const env = setup(), sup = office(env);
  const r = ok(sup.push({ reports: [report({ status: 'Fantastic', submittedAt: T0 - 20 }), report({ date: '2026-02-30' }), report({ date: 'x' }), report({ date: '2026-10-20', status: 'At risk', lang: 'fr' })] }));
  assert.deepEqual(r.reports.map(x => x.status), ['ok', 'rejected', 'rejected', 'ok']);
  assert.deepEqual([r.reports[0].report.status, r.reports[3].report.status, r.reports[3].report.lang], ['', 'At risk', '']);
  assert.deepEqual(env.hub.entities('Activity').map(e => [e.kind, e.text]), [['report.sent', 'Daily report for 2026-10-19 sent by Sam']]);
  ok(sup.push({ reports: [report({ status: 'On plan', submittedAt: T0 - 20 })] }));
  assert.equal(env.hub.entities('Activity').length, 1, 'sending again changes nothing');
  ok(sup.push({ reports: [report({ updatedAt: T0 - 1, submittedAt: T0 - 30 })] }));
  assert.equal(env.hub.entities('Activity').length, 1, 'an older submittedAt is not a new send');
  ok(sup.push({ reports: [report({ updatedAt: T0 - 1, submittedAt: T0 - 10 })] }));
  assert.equal(env.hub.entities('Activity').length, 2, 'a newer one is');
});

// ---------- translation ----------
const tr = (p, items, from = 'en', to = 'es') => p.call('translate', { items, from, to });
test('translate: HTML mode, identifiers wrapped, newlines as breaks, text escaped, result back to plain text', () => {
  const env = setup(), pm = phone(env, 'pm', 'pm-dev');
  const text = 'Pull 12 AWG THHN to panel LP-1A, see E-301 and T1019-02.\nRun 3/4" EMT for 150 ft at 480V and 20 A; GFCI MC cable, 2.5 kVA.';
  const r = ok(tr(pm, [text]));
  const sent = env.hub.translateLog[0];
  assert.deepEqual(sent.opts, { contentType: 'html' });
  assert.deepEqual([sent.from, sent.to], ['en', 'es']);
  for (const token of ['LP-1A', 'E-301', 'T1019-02', '12 AWG', 'THHN', '3/4"', 'EMT', '150 ft', '480V', '20 A', 'GFCI', 'MC', '2.5 kVA']) {
    assert.ok(sent.text.includes(`<span translate="no">${token}</span>`), 'protected: ' + token);
  }
  for (const word of ['Pull', 'panel', 'Run', 'cable', 'and']) assert.ok(!new RegExp(`<span translate="no">[^<]*${word}`).test(sent.text), 'plain word left alone: ' + word);
  assert.ok(sent.text.includes('<br>') && !sent.text.includes('\n'), 'newlines become <br>');
  // The result: dictionary words translated, identifiers intact, tags gone, newline back.
  assert.equal(r.items[0], 'Jale 12 AWG THHN a tablero LP-1A, see E-301 y T1019-02.\nRun 3/4" EMT para 150 ft en 480V y 20 A; GFCI MC cable, 2.5 kVA.', 'words translated, every identifier and quantity intact, the line break back');
});

test('translate: typed markup stays plain text both ways, entities are decoded once, quotes and ampersands survive', () => {
  const env = setup(), pm = phone(env, 'pm', 'pm-dev');
  const hostile = '<script>alert(1)</script> Tom & Jerry "quoted" O\'Neil\'s &amp; &lt;b&gt; <img src=x onerror=1>';
  const r = ok(tr(pm, [hostile]));
  const sent = env.hub.translateLog[0].text;
  assert.ok(!/<(script|img|b)\b/.test(sent), 'nothing typed reaches Google as markup');
  assert.ok(sent.includes('&lt;script&gt;') && sent.includes('Tom &amp; Jerry') && sent.includes('&amp;amp;'));
  assert.equal(r.items[0], hostile, 'comes back exactly as typed (the fake dictionary knows none of these words)');
  // The reply is plain text for the client to escape: no entity or tag survives the round trip of ordinary text.
  const plain = ok(tr(pm, ['Don\'t "touch" the <panel> & ladder'])).items[0];
  assert.ok(!/&#39;|&quot;|&lt;|&gt;|&amp;/.test(plain), plain);
  assert.equal(plain, 'Don\'t "touch" el <tablero> & escalera');
  // Everything before the colon of a line stays; empty and blank items are returned as they came, with no call.
  const calls = env.hub.translateLog.length;
  assert.deepEqual(ok(tr(pm, ['', '   ', '\n'])).items, ['', '   ', '\n']);
  assert.equal(env.hub.translateLog.length, calls);
});

test('translate: cached for six hours per language pair, duplicates once, order kept', () => {
  const env = setup(), crew = phone(env, 'crew', 'crew-dev');
  let r = ok(tr(crew, ['hello crew', 'ladder', 'hello crew']));
  assert.deepEqual(r.items, ['hola cuadrilla', 'escalera', 'hola cuadrilla']);
  assert.equal(r.cached, undefined);
  assert.equal(env.hub.translateLog.length, 2, 'the repeated text was sent once');
  r = ok(tr(crew, ['ladder', 'new words here', 'hello crew']));
  assert.deepEqual([r.items[0], r.cached], ['escalera', 2]);
  assert.equal(env.hub.translateLog.length, 3, 'only the new text went to Google');
  r = ok(tr(crew, ['ladder'], 'es', 'en'));
  assert.equal(r.cached, undefined, 'the other direction is a different entry');
  env.hub.advance(6 * 3600e3 + 1000);
  r = ok(tr(crew, ['ladder']));
  assert.equal(r.cached, undefined, 'entries expire');
  // Another request from another role shares the cache.
  assert.equal(ok(tr(phone(env, 'pm', 'pm-dev'), ['ladder'])).cached, 1);
  // Same language: nothing to do.
  const n = env.hub.translateLog.length;
  assert.deepEqual(ok(tr(crew, ['hola'], 'es', 'es')).items, ['hola']);
  assert.equal(env.hub.translateLog.length, n);
  assert.deepEqual(ok(tr(crew, ['__proto__', 'constructor'])).items, ['__proto__', 'constructor']);
});

test('translate: limits and errors; Google\'s own limit and the daily cap both answer quota; nothing is echoed', () => {
  const env = setup(), pm = phone(env, 'pm', 'pm-dev');
  for (const [body, error] of [
    [{ items: 'x', from: 'en', to: 'es' }, 'bad_request'], [{ items: [1], from: 'en', to: 'es' }, 'bad_request'], [{ items: ['a'], from: 'fr', to: 'es' }, 'bad_request'],
    [{ items: ['a'], from: 'en', to: '__proto__' }, 'bad_request'], [{ items: ['a'] }, 'bad_request'], [{ from: 'en', to: 'es' }, 'bad_request'],
    [{ items: Array(26).fill('a'), from: 'en', to: 'es' }, 'too_large'], [{ items: ['x'.repeat(2001)], from: 'en', to: 'es' }, 'too_large'],
  ]) assert.equal(pm.call('translate', body).error, error, JSON.stringify(body).slice(0, 60));
  assert.equal(ok(tr(pm, Array(25).fill('a').map((a, i) => a + i))).items.length, 25);
  assert.equal(ok(tr(pm, ['x'.repeat(2000)])).items.length, 1);
  // Google says its daily limit is gone.
  env.hub.translateQuota = env.hub.translateLog.length;
  let r = tr(pm, ['one more text']);
  assert.deepEqual(r, { ok: false, error: 'quota', message: 'Daily limit reached' });
  // Any other failure is a server error with a fixed message.
  env.hub.translateQuota = Infinity;
  env.hub.translateFail = 'Exception: ReallySecretDetail 1234';
  r = tr(pm, ['another text']);
  assert.deepEqual([r.error, r.message], ['server', 'Server error']);
  assert.ok(!JSON.stringify(r).includes('Secret') && !JSON.stringify(r).includes('another'));
  assert.ok(!env.hub.logs.some(l => /another text/.test(l)), 'submitted text is not logged');
  env.hub.translateFail = '';
  // Our own per-UTC-day cap, default 1,500 calls (each distinct text is one call), then the next day starts over.
  env.hub.props.TR_CAP = '30';
  const used = Number(env.hub.props.TR_N);
  const room = 30 - used;
  assert.ok(room > 0);
  assert.equal(tr(pm, Array.from({ length: room }, (_, i) => 'cap text ' + i)).ok, true);
  r = tr(pm, ['past the cap']);
  assert.equal(r.error, 'quota');
  assert.equal(tr(pm, ['cap text 0']).ok, true, 'cached answers cost nothing');
  env.hub.advance(24 * 3600e3);
  assert.equal(tr(pm, ['past the cap']).ok, true, 'a new UTC day');
  delete env.hub.props.TR_CAP;
  assert.equal(new Date(T0).toISOString().slice(0, 10) <= env.hub.props.TR_DAY, true);
  assert.equal(env.hub.eval('TR_CAP_DEFAULT'), 1500);
});

test('translate: a refused or failing request leaves the counter and the cache alone where it should', () => {
  const env = setup(), pm = phone(env, 'pm', 'pm-dev');
  ok(tr(pm, ['hello']));
  const n = Number(env.hub.props.TR_N);
  assert.equal(pm.call('translate', { items: [5], from: 'en', to: 'es' }).error, 'bad_request');
  assert.equal(Number(env.hub.props.TR_N), n, 'bad requests are not counted');
  env.hub.translateFail = 'boom';
  assert.equal(tr(pm, ['fail me']).error, 'server');
  env.hub.translateFail = '';
  assert.equal(ok(tr(pm, ['fail me'])).cached, undefined, 'a failed translation was not cached');
  env.hub.contended = true;
  assert.equal(tr(pm, ['needs the counter']).error, 'busy', 'the counter is written under the script lock');
  assert.equal(ok(tr(pm, ['hello'])).cached, 1, 'a cached answer needs no lock at all');
});

// ---------- records ----------
test('records: paging by cursor returns every row once, 200 at a time, with who, q and date filters', () => {
  const env = setup(), pm = phone(env, 'pm', 'pm-dev'), sup = office(env);
  const days = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'];
  seed(sup, 'tasks', Array.from({ length: 450 }, (_, i) => task({ uid: 'r' + i, id: 'R' + i, date: days[i % 5], crew: i % 2 ? 'Crew B' : 'Crew A', scope: i % 60 === 7 ? 'find the NEEDLE here' : 'plain ' + i })));
  const all = [];
  let cursor, pages = 0;
  do {
    const r = ok(pm.call('records', { kind: 'tasks', from: '2026-08-01', to: '2026-08-31', cursor }));
    assert.ok(r.items.length <= 200);
    all.push(...r.items); pages++;
    cursor = r.cursor;
  } while (cursor && pages < 10);
  assert.equal(pages, 3);
  assert.equal(all.length, 450);
  assert.equal(new Set(all.map(t => t.uid)).size, 450, 'no row twice');
  assert.ok(all.every(t => t.rev > 0 && t.date >= '2026-08-01'));
  const narrow = ok(pm.call('records', { kind: 'tasks', from: '2026-08-04', to: '2026-08-05' }));
  assert.equal(narrow.items.length, 180);
  assert.equal(narrow.cursor, undefined);
  assert.equal(ok(pm.call('records', { kind: 'tasks', from: '2026-08-01', to: '2026-08-31', who: 'CREW b' })).items.length, 200, 'a first page of 200 of the 225');
  const byWho = ok(sup.call('records', { kind: 'tasks', from: '2026-08-01', to: '2026-08-31', who: 'crew b', cursor: '2' }));
  assert.ok(byWho.items.length > 0 && byWho.items.every(t => t.crew === 'Crew B'));
  const needle = ok(pm.call('records', { kind: 'tasks', from: '2026-08-01', to: '2026-08-31', q: 'needle' }));
  assert.equal(needle.items.length, 8);
  assert.ok(needle.items.every(t => t.scope.includes('NEEDLE')));
  assert.equal(ok(pm.call('records', { kind: 'tasks', from: '2026-08-01', to: '2026-08-31', cursor: '99999' })).items.length, 0);
  assert.equal(ok(pm.call('records', { kind: 'tasks', from: '2026-08-01', to: '2026-08-31', cursor: 'abc' })).items.length, 200, 'junk cursor starts over');
  // Everything records returns went through the same validation as a pull.
  assert.ok(all.every(t => !('origin' in t)));
  // The window does not apply: a pull of 14 days sees none of these, records sees all.
  assert.equal(pm.pull().tasks.length, 0);
});

test('records: a long quiet stretch hands back an early cursor instead of scanning forever; hours and reports page too', () => {
  const env = setup(), pm = phone(env, 'pm', 'pm-dev'), sup = office(env);
  seed(sup, 'tasks', Array.from({ length: 2300 }, (_, i) => task({ uid: 'q' + i, id: 'Q' + i, date: '2026-07-01', scope: i === 2250 ? 'rare' : 'common' })));
  const first = ok(pm.call('records', { kind: 'tasks', from: '2026-07-01', to: '2026-07-01', q: 'rare' }));
  assert.deepEqual([first.items.length, typeof first.cursor], [0, 'string'], '2000 rows scanned, none matched, keep going');
  const second = ok(pm.call('records', { kind: 'tasks', from: '2026-07-01', to: '2026-07-01', q: 'rare', cursor: first.cursor }));
  assert.deepEqual([second.items.map(t => t.uid), second.cursor], [['q2250'], undefined]);
  seed(pm, 'shifts', Array.from({ length: 300 }, (_, i) => shift({ id: 'h' + i, device: '', who: i < 250 ? 'Ana P' : 'Eli T', date: '2026-06-02' })));
  seed(sup, 'reports', ['2026-06-01', '2026-06-02', '2026-06-03'].map(date => report({ date })));
  assert.equal(ok(pm.call('records', { kind: 'shifts', from: '2026-06-01', to: '2026-06-30', who: 'eli' })).items.length, 50);
  assert.equal(ok(pm.call('records', { kind: 'shifts', from: '2026-06-01', to: '2026-06-30' })).items.length, 200);
  assert.equal(ok(sup.call('records', { kind: 'reports', from: '2026-06-02', to: '2026-06-30' })).items.length, 2);
  const ev = ok(pm.call('records', { kind: 'events', from: '2026-10-01', to: '2026-10-31', who: 'Sam' }));
  assert.ok(ev.items.length > 0 && ev.items.every(e => e.who === 'Sam'));
});

// ---------- delete, tombstones ----------
test('purge: the row is gone from every tab, a tombstone is left, phones learn it on their next pull, stale phones cannot bring it back', () => {
  const env = setup(), pm = phone(env, 'pm', 'pm-dev'), sup = office(env), crew = phone(env, 'crew', 'crew-dev');
  ok(sup.push({ tasks: [task(), task({ uid: 'u2', id: 'T2' })], reports: [report()] }));
  ok(crew.push({ shifts: [shift({ id: 'a', out: '15:30' }), shift({ id: 'b', date: '2026-10-20', out: '15:00' })] }));
  const seen = crew.pull();
  assert.equal(seen.deleted.length, 0);
  assert.equal(rowsOf(env.hub, 'Weekly totals').length, 1);
  // purge takes the key as "target" (the request's own "key" is the auth key)
  let r = ok(pm.call('purge', { kind: 'tasks', target: 'u1' }));
  assert.ok(r.rev > seen.rev);
  assert.deepEqual(env.hub.table('Tasks').map(x => x[x.length - 3]), ['u2'], 'the human row is gone too');
  ok(pm.call('purge', { kind: 'shift', target: 'a' }));
  assert.deepEqual(rowsOf(env.hub, 'Hours').map(x => x.key), ['b']);
  assert.deepEqual(rowsOf(env.hub, 'Weekly totals').map(x => [x['Week of'], x.Hours, x.Shifts]), [['2026-10-19', 8, 1]], 'weekly totals follow');
  ok(pm.call('purge', { kind: 'reports', target: '2026-10-19' }));
  assert.equal(env.hub.table('Reports').length, 0);
  const dead = rowsOf(env.hub, 'Deleted');
  assert.deepEqual(dead.map(x => [x.key, x.kind]), [['u1', 'tasks'], ['a', 'shifts'], ['2026-10-19', 'reports']]);
  assert.ok(dead.every(x => x.rev > 0 && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(x.when)));
  // Tombstones in pull: only what is new since, kinds the role may see.
  const p = ok(crew.call('pull', { since: seen.rev }));
  assert.deepEqual(p.deleted.map(x => [x.kind, x.key]), [['tasks', 'u1'], ['shifts', 'a']], 'a crew phone is not told about reports');
  assert.ok(p.deleted.every(x => x.rev > seen.rev));
  assert.deepEqual(p.tasks, [], 'the deleted task is not sent');
  assert.deepEqual(pm.pull().deleted.map(x => x.key).sort(), ['2026-10-19', 'a', 'u1']);
  assert.deepEqual(ok(crew.call('pull', { since: p.rev })).same, true);
  // A stale phone pushing the purged records back is refused, so a deleted record stays deleted.
  const back = ok(sup.push({ tasks: [task()], reports: [report()] }));
  assert.deepEqual([back.tasks[0].reason, back.reports[0].reason], ['deleted', 'deleted']);
  assert.equal(ok(crew.push({ shifts: [shift({ id: 'a', out: '15:30' })] })).shifts[0].reason, 'deleted');
  assert.equal(env.hub.table('Tasks').length, 1);
  // Purging twice, or something that never existed, still leaves one tombstone each.
  ok(pm.call('purge', { kind: 'tasks', target: 'u1' }));
  ok(pm.call('purge', { kind: 'tasks', target: 'never' }));
  assert.deepEqual(rowsOf(env.hub, 'Deleted').map(x => x.key), ['u1', 'a', '2026-10-19', 'never']);
  // A purge and the same record in one push: the purge wins.
  const both = ok(pm.push({ deleted: [{ kind: 'tasks', key: 'u2' }], tasks: [task({ uid: 'u2', scope: 'again' })] }));
  assert.deepEqual([both.deleted[0].status, both.tasks[0].reason], ['ok', 'deleted']);
  assert.equal(env.hub.table('Tasks').length, 0);
  // Not the PM, or malformed: nothing deleted.
  const sneak = ok(sup.push({ deleted: [{ kind: 'tasks', key: 'u3' }] }));
  assert.deepEqual([sneak.deleted[0].status, sneak.deleted[0].reason], ['rejected', 'forbidden']);
  ok(sup.push({ tasks: [task({ uid: 'u3' })] }));
  for (const bad of [{ kind: 'tasks' }, { kind: 'nope', target: 'u3' }, { kind: 'tasks', target: 'bad id' }, { kind: 'tasks', target: 7 }, {}]) assert.equal(pm.call('purge', bad).error, 'bad_request', JSON.stringify(bad));
  assert.equal(env.hub.table('Tasks').length, 1);
  // Other spellings of the target and the object form work for the PM only.
  ok(pm.call('purge', { kind: 'tasks', id: 'u3' }));
  assert.equal(env.hub.table('Tasks').length, 0);
});

test('tombstones last 90 days: an old one is cleaned up by the next purge', () => {
  const env = setup(), pm = phone(env, 'pm', 'pm-dev');
  ok(pm.call('purge', { kind: 'tasks', target: 'old1' }));
  env.hub.advance(89 * 864e5);
  ok(pm.call('purge', { kind: 'tasks', target: 'mid1' }));
  assert.deepEqual(rowsOf(env.hub, 'Deleted').map(x => x.key), ['old1', 'mid1']);
  env.hub.advance(2 * 864e5);
  ok(pm.call('purge', { kind: 'tasks', target: 'new1' }));
  assert.deepEqual(rowsOf(env.hub, 'Deleted').map(x => x.key), ['mid1', 'new1']);
});

// ---------- paging by rev ----------
test('a pull never claims more than it returned: lists are cut at 500 and the next pull continues from there', () => {
  const env = setup(), sup = office(env), crew = phone(env, 'crew', 'crew-dev');
  seed(sup, 'tasks', Array.from({ length: 620 }, (_, i) => task({ uid: 'p' + i, id: 'P' + i })));
  const a = ok(crew.pull());
  assert.equal(a.tasks.length, 500);
  assert.equal(a.more, true);
  assert.equal(a.rev, a.tasks[499].rev, 'the phone may only claim what it received');
  const b = ok(crew.call('pull', { since: a.rev }));
  assert.equal(b.tasks.length, 120);
  assert.equal(b.more, undefined);
  assert.deepEqual(new Set([...a.tasks, ...b.tasks].map(t => t.uid)).size, 620);
  assert.equal(ok(crew.call('pull', { since: b.rev })).same, true);
});

// ---------- Google's request quota: the pull cache ----------
// Every request runs as the one deploying user, and the Sheets API allows only a few dozen requests a minute per
// user. So a pull reads the Sheet once per revision (index, then changed rows) and every other phone is served from
// CacheService; writers still read the Sheet themselves. The cache is keyed by revision, so it cannot be stale.
const sheetCalls = (hub, from) => hub.calls.slice(from).filter(c => c.startsWith('sheets.')).length;
test('pull cache: the first phone after a change costs one or two Sheets requests, every other phone none', () => {
  const env = setup(), sup = office(env), pm = phone(env, 'pm', 'pm-dev'), a = phone(env, 'crew', 'a'), b = phone(env, 'crew', 'b');
  seed(sup, 'tasks', Array.from({ length: 12 }, (_, i) => task({ uid: 'k' + i, id: 'K' + i })));
  ok(sup.push({ reports: [report()] }));
  ok(a.push({ shifts: [shift({ id: 'sa', device: a.dev })] }));
  let n = env.hub.calls.length;
  const first = a.pull();
  assert.ok(sheetCalls(env.hub, n) <= 2, 'cold, even for 12 tasks plus hours: ' + sheetCalls(env.hub, n));
  n = env.hub.calls.length;
  assert.deepEqual(b.pull().tasks, first.tasks, 'the same answer for the next phone');
  assert.equal(sheetCalls(env.hub, n), 0, 'and not one Sheets request for it');
  n = env.hub.calls.length;
  assert.equal(pm.pull().reports.length, 1);
  assert.ok(sheetCalls(env.hub, n) <= 1, 'the PM also wants reports and the feed: those rows were warmed by the writers');
  n = env.hub.calls.length;
  assert.equal(pm.pull().events.length, 13);
  assert.equal(sheetCalls(env.hub, n), 0);
  // After a change: one index read for the first phone, nothing for the rest.
  ok(sup.push({ tasks: [task({ uid: 'k0', id: 'K0', scope: 'edited', assignAt: T0 - 1 })] }));
  n = env.hub.calls.length;
  const inc = a.call('pull', { since: first.rev });
  assert.deepEqual(inc.tasks.map(t => [t.uid, t.scope]), [['k0', 'edited']]);
  assert.ok(sheetCalls(env.hub, n) <= 1);
  n = env.hub.calls.length;
  assert.deepEqual(b.call('pull', { since: first.rev }).tasks, inc.tasks);
  assert.equal(sheetCalls(env.hub, n), 0);
  // The old revision's entry is still right for an older phone, and the new one is not mixed up with it.
  assert.equal(a.pull().tasks.find(t => t.uid === 'k0').scope, 'edited');
  assert.equal(b.call('pull', { since: 0 }).tasks.find(t => t.uid === 'k1').scope, 'Pull 12 AWG');
  // Nothing is lost when the cache is: same answers from the Sheet, at the cost of two requests.
  const want = JSON.stringify(a.pull());
  env.hub.cache.clear();
  n = env.hub.calls.length;
  assert.equal(JSON.stringify(a.pull()), want);
  assert.ok(sheetCalls(env.hub, n) <= 2);
  n = env.hub.calls.length;
  assert.equal(JSON.stringify(b.pull()), JSON.stringify(b.pull()));
  assert.equal(sheetCalls(env.hub, n), 0, 'what the cold pull read is cached for the next phone');
  // Or when it is broken.
  env.hub.cacheBroken = true;
  assert.equal(JSON.stringify(a.pull()), want);
  assert.equal(ok(sup.push({ tasks: [task({ uid: 'k1', id: 'K1', scope: 'while the cache is down', assignAt: T0 - 1 })] })).tasks[0].status, 'ok');
  assert.equal(a.pull().tasks.find(t => t.uid === 'k1').scope, 'while the cache is down');
  env.hub.cacheBroken = false;
  assert.equal(a.pull().tasks.find(t => t.uid === 'k1').scope, 'while the cache is down', 'and it comes back right');
});

test('request budget: a tick is two reads and one write; a clock-in a handful; a no-change pull none', () => {
  const env = setup(), sup = office(env), crew = phone(env, 'crew', 'crew-dev');
  ok(sup.push({ tasks: [task()] }));
  let n = env.hub.calls.length;
  ok(crew.push({ tasks: [task({ crewAt: T0 - 5, items: [{ id: 'i1', done: true, at: T0 - 5 }] })] }));
  const tick = env.hub.calls.slice(n);
  assert.ok(tick.length <= 3, 'a tick: ' + tick.join(', '));
  assert.equal(tick.filter(c => /values\.(batchUpdate|append|clear)|spreadsheets\.(batchUpdate|create)/.test(c)).length, 1, 'one write');
  n = env.hub.calls.length;
  ok(crew.push({ shifts: [shift()] }));
  assert.ok(env.hub.calls.length - n <= 9, 'a clock-in: ' + env.hub.calls.slice(n).join(', '));
  n = env.hub.calls.length;
  const head = crew.pull();
  crew.call('pull', { since: head.rev });
  assert.ok(sheetCalls(env.hub, n) <= 2, 'one cold pull, then the cheap path');
  // The cache never makes a writer trust a stale row number: a writer reads the Sheet itself.
  const sheet = env.hub.workbook().sheets.find(x => x.title === 'Tasks');
  ok(sup.push({ tasks: [task({ uid: 'u2', id: 'T2' })] }));
  crew.pull(); // warm the cache
  sheet.rows.splice(1, 2, sheet.rows[2], sheet.rows[1]); // the owner sorted the tab by hand
  ok(sup.push({ tasks: [task({ uid: 'u1', scope: 'after the sort', assignAt: T0 - 1 }), task({ uid: 'u2', id: 'T2', scope: 'also', assignAt: T0 - 1 })] }));
  assert.deepEqual(env.hub.entities('Tasks').map(t => [t.uid, t.scope]).sort(), [['u1', 'after the sort'], ['u2', 'also']]);
  assert.deepEqual(rowsOf(env.hub, 'Tasks').map(r => [r.key, r.Scope]).sort(), [['u1', 'after the sort'], ['u2', 'also']], 'readable cells and data stayed together');
});

test('pull cache: rows moved by hand or by a purge are noticed, the Sheet is read again, a damaged row is skipped', () => {
  const env = setup(), sup = office(env), pm = phone(env, 'pm', 'pm-dev'), crew = phone(env, 'crew', 'crew-dev');
  ok(sup.push({ tasks: [task({ uid: 'a1', id: 'A1' }), task({ uid: 'a2', id: 'A2' }), task({ uid: 'a3', id: 'A3' })] }));
  const before = crew.pull().tasks;
  assert.equal(before.length, 3);
  const sheet = env.hub.workbook().sheets.find(x => x.title === 'Tasks');
  const [r1, r2, r3] = [sheet.rows[1], sheet.rows[2], sheet.rows[3]];
  sheet.rows[1] = r3; sheet.rows[2] = r1; sheet.rows[3] = r2; // the owner sorted the tab: the cached row numbers are now wrong
  const after = crew.pull();
  assert.deepEqual(after.tasks.map(t => [t.uid, t.id]).sort(), before.map(t => [t.uid, t.id]).sort(), 'right answer, from a fresh read');
  const n = env.hub.calls.length;
  assert.deepEqual(crew.pull().tasks.map(t => t.uid).sort(), ['a1', 'a2', 'a3']);
  assert.equal(sheetCalls(env.hub, n), 0, 'and the corrected index is what the next phone is served');
  // A purge on another phone shifts rows under a cached index.
  ok(pm.call('purge', { kind: 'tasks', target: 'a2' }));
  assert.deepEqual(crew.pull().tasks.map(t => t.uid).sort(), ['a1', 'a3']);
  // A row whose key cell no longer matches its data: skipped, and the rest of the hub carries on.
  const row = sheet.rows.findIndex(r => r && r[16] === 'a3');
  sheet.rows[row][16] = 'zzz';
  assert.equal(crew.pull().tasks.length, 2, 'a hand edit does not change the revision, so what was cached is still served');
  env.hub.cache.clear();
  const hurt = ok(crew.pull());
  assert.deepEqual(hurt.tasks.map(t => t.uid), ['a1']);
  assert.equal(phone(env, 'crew', 'crew-dev').call('whoami').ok, true);
  sheet.rows[row][16] = 'a3';
  assert.deepEqual(crew.pull().tasks.map(t => t.uid).sort(), ['a1', 'a3']);
  // Unreadable data is skipped the same way.
  sheet.rows[row][18] = '{not json';
  env.hub.cache.clear();
  assert.deepEqual(crew.pull().tasks.map(t => t.uid), ['a1']);
});

test('pull cache: a large index is stored in chunks under the 100 KB value limit and served whole', () => {
  const env = setup(), sup = office(env), crew = phone(env, 'crew', 'crew-dev');
  seed(sup, 'tasks', Array.from({ length: 900 }, (_, i) => task({ uid: 'long-uid-number-' + i, id: 'T' + i, crew: 'Crew ' + (i % 7) })));
  const first = crew.pull({ days: 30 });
  assert.equal(first.tasks.length, 500);
  assert.equal(first.more, true);
  const rev = env.hub.props.REV;
  assert.ok(env.hub.cache.has(`ix:${rev}:1`) && Number(env.hub.cache.get(`ix:${rev}:n`).v) >= 2, 'the index spans several cache values');
  for (const [k, e] of env.hub.cache) assert.ok(e.v.length <= 100 * 1024, k + ' fits a cache value');
  const n = env.hub.calls.length;
  const again = crew.pull({ days: 30 });
  assert.equal(JSON.stringify(again.tasks), JSON.stringify(first.tasks));
  assert.equal(sheetCalls(env.hub, n), 0, 'and 500 rows came from the cache in batches the fake would refuse if they were over 100 keys');
  const rest = crew.call('pull', { since: first.rev, days: 30 });
  assert.equal(rest.tasks.length, 400);
  assert.equal(first.tasks.concat(rest.tasks).map(t => t.uid).filter((u, i, a) => a.indexOf(u) === i).length, 900);
});

// ---------- selftest ----------
test('selftest: write, read, merge rules, a translated drawing number, delete; leaves nothing behind', () => {
  const env = setup(), pm = phone(env, 'pm', 'pm-dev'), crew = phone(env, 'crew', 'crew-dev');
  ok(office(env).push({ tasks: [task({ uid: 'real1' }), task({ uid: 'real2' })] }));
  const seen = crew.pull(); // fills the pull cache
  const before = { events: env.hub.table('Activity').length, tasks: env.hub.table('Tasks').length, dead: env.hub.table('Deleted').length };
  const rev0 = Number(env.hub.props.REV);
  const r = ok(pm.call('selftest'));
  assert.equal(Number(env.hub.props.REV) - rev0, 4, 'three rows written by the checks, then one more revision because deleting moves the rows below up');
  assert.deepEqual(r.checks.map(c => [c.name, c.ok]), [['write', true], ['read', true], ['merge rules', true], ['translate', true], ['delete', true]]);
  assert.ok(r.checks.every(c => c.detail === 'ok'));
  assert.deepEqual({ events: env.hub.table('Activity').length, tasks: env.hub.table('Tasks').length, dead: env.hub.table('Deleted').length }, before);
  assert.deepEqual(crew.pull().tasks.map(t => t.uid), ['real1', 'real2'], 'a pull after the self-test is not served a cached index of the old rows');
  assert.ok(crew.pull().rev > seen.rev);
  const sent = env.hub.translateLog.at(-1);
  assert.ok(sent.text.includes('<span translate="no">E-301</span>') && sent.opts.contentType === 'html');
  // The test task is outside every window while it exists, and it is cleaned up even when a step fails.
  env.hub.translateQuota = env.hub.translateLog.length;
  const bad = ok(pm.call('selftest'));
  assert.deepEqual(bad.checks.map(c => c.ok), [true, true, true, false, true]);
  assert.deepEqual(bad.checks[3], { name: 'translate', ok: false, detail: 'quota' });
  assert.equal(env.hub.table('Tasks').length, 2, 'only the real tasks are left');
  // And it can be run as often as wanted.
  env.hub.translateQuota = Infinity;
  assert.ok(ok(pm.call('selftest')).checks.every(c => c.ok));
});

test('selftest notices a server that stopped following the rules (so a green result means something)', () => {
  const broken = (find, repl) => { assert.ok(CODE.includes(find), find); return createHub({ now: T0, source: CODE.replace(find, repl) }); };
  const run = hub => { const k = hub.setup(); return Object.fromEntries(hub.call(k.pm, 'selftest').checks.map(c => [c.name, c.ok])); };
  // a crew key may now rewrite the assignment
  assert.equal(run(broken("const office = ctx.role !== 'crew';\n  if (!stored", "const office = true;\n  if (!stored"))['merge rules'], false);
  // an office push may now erase crew results
  assert.equal(run(broken("if (ctx.role === 'crew' ? inc.crewAt > 0 && inc.crewAt >= t.crewAt : inc.crewAt > t.crewAt)", "if (true)"))['merge rules'], false);
  // drawing numbers are no longer protected: the translator damages E-301
  assert.equal(run(broken("'\\\\b[A-Z]{1,4}-?\\\\d+(?:[-.]\\\\d+)*[A-Z]?\\\\b',", "'(?!)',"))['translate'], false);
  // the test row is not cleaned up
  assert.equal(run(broken("deleteEntity_(ctx, b, 'tasks', uid, true);\n    flush_(ctx, b);", "flush_(ctx, b);"))['delete'], false);
  // the healthy server passes all of it
  assert.ok(Object.values(run(createHub({ now: T0 }))).every(Boolean));
});

// ---------- archive ----------
test('archive: copies old rows into a new spreadsheet, then deletes them here; hours move in whole weeks', () => {
  const env2 = setup(), pm2 = phone(env2, 'pm', 'pm-dev'), sup2 = office(env2);
  ok(sup2.push({ tasks: [task({ uid: 'sep', id: 'S1', date: '2026-09-10' }), task({ uid: 'old2', id: 'S2', date: '2026-10-04' }), task({ uid: 'keep', id: 'K1', date: '2026-10-07' })], reports: [report({ date: '2026-09-30' }), report({ date: '2026-10-07' })] }));
  // before 2026-10-07 is a Wednesday: hours move up to the Monday before it (2026-10-05), so the week of 10-05 stays whole.
  ok(pm2.push({ shifts: [shift({ id: 'w1', device: '', date: '2026-09-30', in: '07:00', out: '15:00' }), shift({ id: 'w2', device: '', date: '2026-10-04', in: '07:00', out: '15:30' }),
    shift({ id: 'w3', device: '', date: '2026-10-05', in: '07:00', out: '14:00' }), shift({ id: 'w4', device: '', date: '2026-10-07', in: '07:00', out: '15:00' }), shift({ id: 'w5', device: '', date: '2026-10-06', in: '07:00', out: '15:00' })] }));
  const events0 = env2.hub.table('Activity').length;
  const r = ok(pm2.call('archive', { before: '2026-10-07' }));
  assert.deepEqual(r.moved, { tasks: 2, shifts: 2, reports: 1, events: 0 });
  assert.match(r.sheetUrl, /^https:\/\/docs\.google\.com\/spreadsheets\/d\/\w+\/edit$/);
  assert.notEqual(r.sheetUrl, env2.k.sheetUrl);
  const [arch] = env2.hub.archives();
  assert.ok(r.sheetUrl.includes(arch.id));
  assert.deepEqual(env2.hub.tabs(arch.id), ['Tasks', 'Hours', 'Weekly totals', 'Reports', 'Activity']);
  assert.deepEqual(env2.hub.header('Hours', arch.id), env2.hub.header('Hours'));
  assert.equal(env2.hub.format('Tasks', arch.id).bold, true);
  assert.deepEqual(env2.hub.table('Tasks', arch.id).map(x => x[1]).sort(), ['S1', 'S2'], 'old tasks copied with their readable cells');
  assert.deepEqual(env2.hub.entities('Tasks', arch.id).map(t => t.uid).sort(), ['old2', 'sep'], 'and their data');
  assert.deepEqual(env2.hub.table('Hours', arch.id).map(x => [x[0], x[2], x[6]]), [['Dana R', '2026-09-30', 8], ['Dana R', '2026-10-04', 8.5]]);
  assert.deepEqual(env2.hub.table('Weekly totals', arch.id).map(x => [x[1], x[2]]), [['2026-09-28', 16.5]], 'the archived week is whole in the archive');
  assert.deepEqual(env2.hub.table('Reports', arch.id).map(x => x[0]), ['2026-09-30']);
  // Live: only what is newer remains, week totals included.
  assert.deepEqual(rowsOf(env2.hub, 'Tasks').map(x => x.key), ['keep']);
  assert.deepEqual(rowsOf(env2.hub, 'Hours').map(x => x.key), ['w3', 'w4', 'w5'], 'w5 is before the date but in the straddling week, so it stays');
  assert.deepEqual(rowsOf(env2.hub, 'Weekly totals').map(x => [x['Week of'], x.Hours, x.Shifts]), [['2026-10-05', 23, 3]]);
  assert.deepEqual(rowsOf(env2.hub, 'Reports').map(x => x.key), ['2026-10-07']);
  assert.equal(env2.hub.table('Activity').length, events0 + 1, 'one activity line says what was archived');
  assert.match(env2.hub.entities('Activity').at(-1).text, /^Archived 5 rows older than 2026-10-07$/);
  assert.equal(env2.hub.props.ARCHIVED_BEFORE, '2026-10-07');
  assert.equal(env2.hub.props.ARCHIVED_HOURS, '2026-10-05');
  assert.equal(JSON.parse(env2.hub.props.ARCHIVES)[0].url, r.sheetUrl);
  assert.equal(pm2.pull({ days: 90 }).deleted.length, 0, 'archiving leaves no tombstones: the records still exist');
  // A stale phone pushing an archived record is told so, and the live tab stays clean.
  const stale = ok(sup2.push({ tasks: [task({ uid: 'sep', date: '2026-09-10' })], reports: [report({ date: '2026-09-30' })] }));
  assert.deepEqual([stale.tasks[0].reason, stale.reports[0].reason], ['archived', 'archived']);
  const staleShift = ok(pm2.push({ shifts: [shift({ id: 'w1', device: '', date: '2026-09-30' }), shift({ id: 'moved', device: '', date: '2026-10-08' })] }));
  assert.deepEqual(staleShift.shifts.map(x => x.reason || x.status), ['archived', 'ok']);
  const toOld = ok(pm2.push({ shifts: [{ ...env2.hub.entities('Hours').find(s => s.id === 'w3'), date: '2026-10-04' }] }));
  assert.equal(toOld.shifts[0].reason, 'archived', 'a shift cannot be moved into an archived week');
  assert.equal(rowsOf(env2.hub, 'Tasks').length, 1);
  // Nothing to move: no new spreadsheet.
  const n = env2.hub.spreadsheets.size;
  assert.deepEqual(ok(pm2.call('archive', { before: '2026-10-07' })), { sheetUrl: '', moved: { tasks: 0, shifts: 0, reports: 0, events: 0 }, ok: true });
  assert.equal(env2.hub.spreadsheets.size, n);
  // Guards.
  for (const before of ['2026-02-30', 'x', '', undefined, '2026-10-20', '2099-01-01']) assert.equal(pm2.call('archive', { before }).error, 'bad_request', String(before));
});

test('archive: a failure while deleting leaves the rows in both places, never in neither', () => {
  const env = setup(), pm = phone(env, 'pm', 'pm-dev'), sup = office(env);
  ok(sup.push({ tasks: [task({ uid: 'old', date: '2026-09-10' })] }));
  // archive makes two spreadsheets.batchUpdate calls (formatting the new sheet, then deleting here): fail the second
  let seen = 0;
  const real = env.hub.maybeFail;
  env.hub.maybeFail = m => { if (m === 'sheets.spreadsheets.batchUpdate' && ++seen === 2) throw new Error('Exception: Service error: Spreadsheets'); return real(m); };
  const r = pm.call('archive', { before: '2026-10-01' });
  env.hub.maybeFail = real;
  assert.deepEqual([r.ok, r.error, r.message], [false, 'server', 'Server error']);
  assert.equal(env.hub.table('Tasks').length, 1, 'still here');
  const [arch] = env.hub.archives();
  assert.equal(env.hub.table('Tasks', arch.id).length, 1, 'and already copied');
  assert.equal(env.hub.props.ARCHIVED_BEFORE, undefined, 'the horizon moves only after the delete');
});

// ---------- abuse guards ----------
test('bad keys: 30 in a minute and every request answers busy for a minute, then it clears', () => {
  const env = setup(), pm = phone(env, 'pm');
  const wrong = i => 'W' + String(i).padStart(31, '0');
  for (let i = 0; i < 29; i++) assert.equal(env.hub.call(wrong(i), 'whoami').error, 'unauthorized');
  assert.equal(pm.call('whoami').ok, true, 'a right key is not counted and still works');
  assert.equal(env.hub.call(wrong(29), 'whoami').error, 'unauthorized', 'the 30th is still just refused');
  assert.deepEqual(pm.call('whoami'), { ok: false, error: 'busy', message: 'Busy, try again shortly' }, 'then everyone waits, even with the right key');
  assert.equal(env.hub.call(wrong(1), 'whoami').error, 'busy');
  assert.equal(env.hub.raw('not json'), JSON.stringify({ ok: false, error: 'busy', message: 'Busy, try again shortly' }), 'before any parsing');
  env.hub.advance(59e3);
  assert.equal(pm.call('whoami').error, 'busy');
  env.hub.advance(2e3);
  assert.equal(pm.call('whoami').ok, true, 'a minute later it is over');
  // A slow trickle never trips it: the window is a minute.
  for (let i = 0; i < 29; i++) env.hub.call(wrong(i), 'whoami');
  env.hub.advance(61e3);
  for (let i = 0; i < 29; i++) env.hub.call(wrong(i), 'whoami');
  assert.equal(pm.call('whoami').ok, true);
  // Malformed keys count too (anything that is not a right key).
  for (let i = 0; i < 30; i++) env.hub.send({ v: 1, key: i % 2 ? 7 : 'short', action: 'whoami' });
  assert.equal(pm.call('whoami').error, 'busy');
});

test('pushes are capped per minute: 40 per phone, 300 per key; reads are not', () => {
  const env = setup(), crew = phone(env, 'crew', 'dev-a');
  for (let i = 0; i < 40; i++) assert.equal(crew.push({}).ok, true, 'push ' + i);
  assert.equal(crew.push({}).error, 'busy');
  assert.equal(phone(env, 'crew', 'dev-b').push({}).ok, true, 'another phone is not held up');
  assert.equal(crew.pull().ok, true, 'reading is never capped');
  assert.equal(crew.call('translate', { items: ['hi'], from: 'en', to: 'es' }).ok, true);
  env.hub.advance(61e3);
  assert.equal(crew.push({}).ok, true);
  // 300 per key, however many phones it claims.
  const e2 = setup();
  let n = 0;
  for (let i = 0; i < 400; i++) { const r = phone(e2, 'super', 'd' + i).push({}); if (r.ok) n++; else { assert.equal(r.error, 'busy'); break; } }
  assert.equal(n, 300);
  assert.equal(phone(e2, 'pm', 'pm-dev').push({}).ok, true, 'each key has its own count');
});

// ---------- keys ----------
test('keys, rotate: the PM sees crew and super keys; a rotated key stops working at once and the others are untouched', () => {
  const env = setup(), pm = phone(env, 'pm', 'pm-dev');
  assert.deepEqual(pm.call('keys'), { crew: env.k.crew, super: env.k.super, ok: true });
  const r = ok(pm.call('rotate', { role: 'crew' }));
  assert.match(r.key, /^[A-Za-z0-9]{32}$/);
  assert.notEqual(r.key, env.k.crew);
  assert.equal(env.hub.call(env.k.crew, 'whoami').error, 'unauthorized', 'the old key is dead');
  assert.equal(env.hub.call(r.key, 'whoami').role, 'crew');
  assert.equal(env.hub.call(env.k.super, 'whoami').role, 'super');
  assert.equal(pm.call('whoami').role, 'pm');
  assert.equal(pm.call('keys').crew, r.key);
  assert.equal(env.hub.props.CREW_KEY, r.key);
  assert.ok(!Object.values(env.hub.props).includes(env.k.crew));
  const s = ok(pm.call('rotate', { role: 'super' }));
  assert.equal(env.hub.call(env.k.super, 'whoami').error, 'unauthorized');
  assert.equal(env.hub.call(s.key, 'whoami').role, 'super');
  for (const role of ['pm', 'x', undefined, '__proto__']) assert.equal(pm.call('rotate', { role }).error, 'bad_request', String(role));
  assert.deepEqual(env.hub.entities('Activity').map(e => e.text), ['Crew key replaced', 'Superintendent key replaced']);
  // A request that waited for the lock across a rotation is refused when it gets the lock.
  const c = env.hub.load();
  assert.throws(() => c.locked_({ role: 'crew', state: { rev: 0 } }, env.k.crew, () => 'ran'), e => e.code === 'unauthorized');
  assert.equal(env.hub.locked, false, 'and the lock is let go');
  assert.equal(c.locked_({ role: 'crew', state: { rev: 0 } }, r.key, () => 'ran'), 'ran');
});

test('key checks: an unset key matches nothing, not even an empty or short one; comparisons are constant time', () => {
  const env = setup();
  delete env.hub.props.CREW_KEY; // a half-finished setup, or an owner who cleared a property
  delete env.hub.props.SUPER_KEY;
  for (const key of ['', 'x', 'a'.repeat(31), 'a'.repeat(33), undefined, null, 0, [], {}]) {
    assert.equal(env.hub.send({ v: 1, key, action: 'whoami' }).error, 'unauthorized', JSON.stringify(key));
  }
  delete env.hub.props.PM_KEY_SHA256;
  assert.equal(env.hub.call(env.k.pm, 'whoami').error, 'unauthorized', 'with no PM hash stored, no key is the PM');
  // sameStr_ answers like ===, for equal and unequal lengths, and every key comparison goes through it
  const same = (a, b) => env.hub.eval(`sameStr_(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
  for (const [a, b] of [['abc', 'abc'], ['abc', 'abd'], ['abc', 'ab'], ['ab', 'abc'], ['', ''], ['', 'a'], ['a', ''], ['x'.repeat(32), 'x'.repeat(32)], ['x'.repeat(32), 'x'.repeat(31) + 'y']]) {
    assert.equal(same(a, b), a === b, `${a} vs ${b}`);
  }
  const sameStr = CODE.slice(CODE.indexOf('function sameStr_'), CODE.indexOf('function newKey_'));
  assert.ok(/d \|= a\.charCodeAt\(i\) \^/.test(sameStr) && !/===\s*b\b|a\s*===/.test(sameStr.replace('d === 0', '')), 'sameStr_ XORs every character instead of stopping at the first difference');
  const roleOf = CODE.slice(CODE.indexOf('function roleOf_'), CODE.indexOf('// ponytail: cache counters'));
  assert.equal((roleOf.match(/sameStr_\(/g) || []).length, 3, 'all three keys are compared with sameStr_');
  assert.ok(!/===|!==|==/.test(roleOf.replace(/typeof key !== 'string'/, '').replace(/\? 'pm' : su/, '')), 'and never with ===');
});

test('keys never reach the Sheet, an error, or a log; the PM key is only ever a hash', () => {
  const env = setup(), sup = office(env), pm = phone(env, 'pm', 'pm-dev'), crew = phone(env, 'crew', 'crew-dev');
  const setupLogs = env.hub.logs.length;
  ok(sup.push({ tasks: [task()], reports: [report()] }));
  ok(crew.push({ shifts: [shift()] }));
  ok(pm.call('selftest'));
  ok(pm.call('rotate', { role: 'crew' }));
  env.hub.call('Z'.repeat(32), 'whoami');
  env.hub.failNext('sheets.spreadsheets.values.batchGet');
  pm.pull();
  const keys = [env.k.pm, env.k.crew, env.k.super, env.hub.props.CREW_KEY, pm.call('keys').super, sha(env.k.pm)];
  for (const ss of env.hub.spreadsheets.values()) for (const sh of ss.sheets) for (const row of sh.rows) for (const cell of row || []) {
    for (const k of keys) assert.ok(typeof cell !== 'string' || !cell.includes(k), 'a key is in the Sheet');
  }
  const later = env.hub.logs.slice(setupLogs);
  for (const k of keys) assert.ok(!later.join('\n').includes(k), 'a key is in the log');
  assert.ok(!JSON.stringify(env.hub.call('Z'.repeat(32), 'whoami')).includes('Z'.repeat(32)));
  assert.ok(!Object.values(env.hub.props).some(v => v === env.k.pm), 'the PM key itself is not stored');
  // Only the PM can ever read crew and super keys back.
  assert.ok(!JSON.stringify(sup.pull()).includes(env.k.super) && !JSON.stringify(crew.pull()).includes(env.hub.props.CREW_KEY));
  assert.equal(sup.call('keys').error, 'forbidden');
  assert.equal(env.hub.call(env.hub.props.CREW_KEY, 'keys').error, 'forbidden');
});

// ---------- failures and the lock ----------
test('a Sheets failure mid-push: a fixed server error, nothing echoed, the lock let go, rev saved, the next push fine', () => {
  const env = setup(), sup = office(env);
  ok(sup.push({ tasks: [task({ uid: 'keep1' })] }));
  const SECRET = 'TopSecretScopeText';
  env.hub.failNext('sheets.spreadsheets.values.append', 1, 'Service error: Spreadsheets');
  const r = sup.push({ tasks: [task({ uid: 'keep1', scope: SECRET, assignAt: T0 - 10 }), task({ uid: 'new1', scope: SECRET })] });
  assert.deepEqual(r, { ok: false, error: 'server', message: 'Server error' });
  assert.ok(!env.hub.logs.join('\n').includes(SECRET), 'submitted text is never logged');
  assert.ok(env.hub.logs.some(l => l.startsWith('hub error: ')), 'but the owner gets one line to go on');
  assert.ok(!JSON.stringify(r).match(/at |Error|stack|Exception/));
  assert.equal(env.hub.locked, false);
  const maxRev = Math.max(...env.hub.col('Tasks', 'rev'));
  assert.ok(Number(env.hub.props.REV) >= maxRev, 'rev never goes behind a row that was written');
  const again = ok(sup.push({ tasks: [task({ uid: 'keep1', scope: SECRET, assignAt: T0 - 10 }), task({ uid: 'new1', scope: SECRET })] }));
  assert.deepEqual(again.tasks.map(x => x.status), ['ok', 'ok']);
  assert.equal(env.hub.table('Tasks').length, 2);
  assert.equal(again.tasks[0].task.rev, maxRev, 'the update that did land before the failure is not written twice');
  assert.ok(again.tasks[1].task.rev > maxRev, 'new revs are above every earlier row');
  // Reading failures are server errors too, and also leave nothing locked.
  env.hub.failNext('sheets.spreadsheets.values.batchGet');
  assert.equal(sup.pull().error, 'server');
  env.hub.failNext('sheets.spreadsheets.values.batchGet');
  assert.equal(sup.push({ shifts: [shift({ device: sup.dev })] }).error, 'server');
  assert.equal(sup.pull().ok, true);
});

test('lock contention: writes answer busy, reads and cached answers carry on, and once free everything works', () => {
  const env = setup(), pm = phone(env, 'pm', 'pm-dev');
  ok(tr(pm, ['hello']));
  env.hub.contended = true;
  for (const [action, extra] of [['push', { tasks: [task()] }], ['purge', { kind: 'tasks', target: 'x' }], ['rotate', { role: 'crew' }], ['archive', { before: '2026-10-01' }], ['selftest', {}]]) {
    assert.equal(pm.call(action, extra).error, 'busy', action);
  }
  assert.equal(env.hub.table('Tasks').length, 0);
  assert.equal(pm.call('whoami').ok, true);
  assert.equal(pm.pull().ok, true);
  assert.equal(pm.call('records', { kind: 'tasks', from: '2026-10-01', to: '2026-10-31' }).ok, true);
  assert.equal(pm.call('stats').ok, true);
  assert.equal(ok(tr(pm, ['hello'])).cached, 1);
  env.hub.contended = false;
  assert.equal(pm.push({ tasks: [task()] }).ok, true);
});

test('every Sheets and property write happened under the script lock (the fake throws otherwise)', () => {
  const env = setup(), sup = office(env), pm = phone(env, 'pm', 'pm-dev');
  ok(sup.push({ tasks: [task()], reports: [report()], config: { project: 'P' } }));
  ok(pm.push({ shifts: [shift({ id: 'z', device: '' })] }));
  ok(pm.call('purge', { kind: 'tasks', target: 'u1' }));
  ok(pm.call('rotate', { role: 'crew' }));
  ok(pm.call('selftest'));
  ok(pm.call('archive', { before: '2026-10-01' }));
  ok(tr(pm, ['some text']));
  assert.ok(env.hub.writes > 30, 'a real workload: ' + env.hub.writes + ' writes');
  assert.equal(env.hub.allowUnlockedWrites, false);
});

// ---------- the feed, whoami ----------
test('events: newest 50 on a first pull, what is new since after that, none for crew', () => {
  const env = setup(), sup = office(env), crew = phone(env, 'crew', 'crew-dev'), pm = phone(env, 'pm', 'pm-dev');
  seed(sup, 'tasks', Array.from({ length: 70 }, (_, i) => task({ uid: 'e' + i, id: 'E' + i })));
  const first = ok(pm.pull());
  assert.equal(first.events.length, 50);
  assert.deepEqual(first.events.map(e => e.ref), Array.from({ length: 50 }, (_, i) => 'e' + (20 + i)), 'the latest 50, oldest first');
  assert.ok(first.events.every(e => Object.keys(e).join() === 'rev,ts,who,role,kind,text,ref'));
  ok(sup.push({ tasks: [task({ uid: 'e0', id: 'E0', assignAt: T0 - 1, review: 'Accepted', reviewer: 'Sam' })] }));
  const next = ok(pm.call('pull', { since: first.rev }));
  assert.deepEqual(next.events.map(e => e.kind), ['task.reviewed']);
  assert.deepEqual(crew.pull().events, []);
  assert.deepEqual(office(env).call('pull', { since: first.rev }).events.length, 1);
});

test('pull windows apply to reports and hours too', () => {
  const env = setup(), sup = office(env), pm = phone(env, 'pm', 'pm-dev');
  ok(sup.push({ reports: [report({ date: '2026-10-19' }), report({ date: '2026-09-01' })] }));
  ok(pm.push({ shifts: [shift({ id: 'n', device: '' }), shift({ id: 'o', device: '', date: '2026-08-01' })] }));
  assert.deepEqual(pm.pull().reports.map(r => r.date), ['2026-10-19']);
  assert.deepEqual(pm.pull().shifts.map(r => r.id), ['n']);
  assert.deepEqual(pm.pull({ days: 90 }).reports.length, 2);
  assert.deepEqual(pm.pull({ days: 90 }).shifts.length, 2);
});

test('whoami: role, rev, time, zone, version; the Sheet link only for the PM; no key echoed', () => {
  const env = setup();
  const r = phone(env, 'pm').call('whoami');
  assert.deepEqual(Object.keys(r).sort(), ['dev', 'now', 'ok', 'rev', 'role', 'sheetUrl', 'tz', 'version']);
  assert.deepEqual([r.role, r.rev, r.now, r.tz, r.version, r.sheetUrl, r.dev], ['pm', 0, T0, 'America/New_York', '1.0.0', env.k.sheetUrl, ID('pm-dev')]);
  for (const role of ['crew', 'super']) assert.ok(!('sheetUrl' in phone(env, role).call('whoami')));
  ok(office(env).push({ tasks: [task()] }));
  assert.equal(phone(env, 'crew').call('whoami').rev, 2);
  const fresh = createHub({ now: T0 }); // never set up: no keys, so nobody is let in; a partial setup answers not_ready
  assert.equal(fresh.call('A'.repeat(32), 'whoami').error, 'unauthorized');
  const half = setup();
  delete half.hub.props.SHEET_ID;
  assert.equal(phone(half, 'pm').call('whoami').ok, true);
  assert.equal(phone(half, 'pm').call('pull').error, 'not_ready');
});

test('stats: rows per tab, cells against the 10 million limit, the Sheet link', () => {
  const env = setup(), sup = office(env), pm = phone(env, 'pm', 'pm-dev');
  ok(sup.push({ tasks: [task(), task({ uid: 'u2' })], reports: [report()] }));
  ok(pm.push({ shifts: [shift({ id: 'z', device: '' })] }));
  const r = ok(pm.call('stats'));
  assert.deepEqual(r.rows, { tasks: 2, shifts: 1, reports: 1, events: 3 });
  assert.equal(r.cellLimit, 10000000);
  assert.equal(r.cells, env.hub.cells());
  assert.ok(r.cells > 50000 && r.cells < 200000);
  assert.equal(r.sheetUrl, env.k.sheetUrl);
});

// ---------- fuzz: garbage in, a clean refusal out ----------
test('fuzz: corrupted and garbage requests never cause a server error, a stuck lock, a formula or an unreadable row', () => {
  const env = setup();
  const rand = rng(777), pick = a => a[Math.floor(rand() * a.length)];
  const pool = [null, true, false, 0, -1, 1e308, 2 ** 53, 'x', '', ' ', 'a'.repeat(300), '=1+1', '__proto__', 'constructor', '2026-13-45', '25:61', [], {}, [null], [[]], { a: 1 }, { __proto__: null }, [{}], '\u00e9', '\u0000', '\ud800', { uid: 'u9' }, [1, 2, 3], -0, 1.5];
  const seedTask = task({ uid: 'seed1' }), seedShift = shift({ id: 'seed-s', device: ID('pm-dev') }), seedReport = report();
  ok(phone(env, 'super', 'sup-dev').push({ tasks: [seedTask], reports: [seedReport], config: { project: 'P', floors: ['L1'] } }));
  ok(phone(env, 'pm', 'pm-dev').push({ shifts: [seedShift, shift({ id: 'seed-h', device: '' })] }));
  const corrupt = (o, n = 3) => { const c = JSON.parse(JSON.stringify(o)); const ks = Object.keys(c); for (let i = 0; i < n; i++) c[pick(ks)] = pick(pool); return c; };
  const garbageList = () => Array.from({ length: Math.floor(rand() * 4) }, () => (rand() < 0.5 ? pick(pool) : corrupt(pick([seedTask, seedShift, seedReport, { uid: 'f1', date: '2026-10-19' }]), 1 + Math.floor(rand() * 6))));
  const bodies = [
    () => ({ action: 'push', tasks: garbageList(), shifts: garbageList(), reports: garbageList(), config: pick([undefined, null, {}, corrupt({ project: 'x', floors: ['a'], crews: [{ name: 'n' }], checks: ['c'], pin: '', at: 1 }, 2), pick(pool)]), deleted: pick([undefined, [], [{ kind: 'tasks', key: 'seed1' }], [{ kind: pick(pool), key: pick(pool) }], pick(pool)]) }),
    () => ({ action: 'pull', since: pick(pool), days: pick(pool), crews: pick(pool) }),
    () => ({ action: 'translate', items: pick([['hello'], [pick(pool)], pick(pool), ['x'.repeat(2500)]]), from: pick(['en', 'es', pick(pool)]), to: pick(['en', 'es', pick(pool)]) }),
    () => ({ action: 'records', kind: pick(['tasks', 'shifts', 'reports', 'events', pick(pool)]), from: pick(['2026-10-01', pick(pool)]), to: pick(['2026-10-31', pick(pool)]), who: pick(pool), q: pick(pool), cursor: pick(pool) }),
    () => ({ action: 'purge', kind: pick(['tasks', 'shifts', 'reports', pick(pool)]), target: pick(['seed1', 'seed-s', '2026-10-19', pick(pool)]) }),
    () => ({ action: 'archive', before: pick(['2026-09-01', pick(pool)]) }),
    () => ({ action: pick(['whoami', 'stats', 'keys', 'selftest', pick(pool)]) }),
  ];
  const allowed = new Set(['bad_request', 'too_large', 'forbidden', 'busy', 'quota']);
  const seen = new Set();
  for (let i = 0; i < 700; i++) {
    const role = pick(ROLES), devSecret = pick([secretOf(role + '-dev'), secretOf('pm-dev'), secretOf('sup-dev'), secretOf('crew-dev'), ID('crew-dev'), '', 'bad dev', pick(pool)]);
    const body = { v: 1, key: env.k[role], devSecret, dev: pick([ID('pm-dev'), ID('crew-dev'), pick(pool)]), ...pick(bodies)() };
    const raw = JSON.stringify(body);
    const r = JSON.parse(env.hub.raw(raw));
    assert.ok(r.ok === true || allowed.has(r.error), `request ${i} (${role}): ${JSON.stringify(r).slice(0, 200)} <- ${raw.slice(0, 300)}`);
    assert.equal(env.hub.locked, false);
    seen.add(JSON.stringify(body.action).slice(0, 20) + ':' + (r.ok ? 'ok' : r.error));
    if (i % 25 === 24) env.hub.advance(61e3); // stay under the per-minute caps
  }
  assert.ok(seen.size > 12, 'a spread of outcomes: ' + [...seen].join(' '));
  assert.deepEqual(env.hub.formulaCells(), []);
  for (const title of ['Tasks', 'Hours', 'Reports', 'Activity', 'Config']) {
    const di = env.hub.header(title).indexOf('data');
    for (const row of env.hub.table(title)) assert.doesNotThrow(() => JSON.parse(row[di]), title + ' row holds readable data');
    for (const row of env.hub.table(title)) assert.ok(String(row[di]).length <= 49000);
  }
  assert.equal(phone(env, 'pm', 'pm-dev').call('whoami').ok, true);
});

// ---------- convergence: many random histories ----------
// Reference phones keep their own copy of what they may see, edit it offline with real stamps, and sync as the contract
// says (push what changed, then pull). A ledger of every edit and its stamp is the oracle: the final state of each
// part is the copy written at the highest stamp, whatever order the pushes arrived in.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const strip = ({ rev, ...x }) => x;
const J = x => JSON.stringify(x);

function convergence(seed, steps) {
  const rand = rng(seed), pickOf = a => a[Math.floor(rand() * a.length)], chance = p => rand() < p;
  const env = setup({ reuseContext: seed % 2 === 0 }); // odd seeds run every request in a fresh context, even ones share one for speed
  const { hub } = env;
  const get = expr => JSON.parse(JSON.stringify(hub.eval(expr)));
  const blankOf = tpl => (Array.isArray(tpl) ? [] : tpl && typeof tpl === 'object' ? Object.fromEntries(Object.entries(tpl).map(([k, v]) => [k, blankOf(v)])) : typeof tpl === 'string' ? '' : tpl);
  const OFFICE = get('ASSIGN').concat(get('OFFICE_EXTRA')), CREWF = get('CREW'), REPORT_KEYS = Object.keys(get('REPORT')), TASK_TPL = get('TASK'), TASK_BLANK = blankOf(TASK_TPL), REPORT_BLANK = blankOf(get('REPORT'));
  const clients = [['crew', 'cA'], ['crew', 'cB'], ['super', 'sA'], ['pm', 'pA']].map(([role, label]) => {
    const ph = phone(env, role, label);
    return { role, label, dev: ph.dev, ph, tasks: {}, shifts: {}, reports: {}, base: {}, since: 0, online: true };
  });
  const by = role => clients.filter(c => c.role === role);
  const led = { tasks: {}, reports: {}, workerOut: {}, pmOut: {}, pmWho: {}, removed: {}, device: {}, hand: {} };
  const unexpected = [];
  let n = 0;
  const now = () => hub.now();
  const tick = () => hub.advance(1000 + Math.floor(rand() * 20000));
  const hm = () => { const d = new Date(now()); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const today = '2026-10-19';

  const officePart = t => J([OFFICE.map(k => t[k]), t.assignAt, t.items.map(i => [i.id, i.text]), t.checks.map(i => [i.id, i.text])]);
  const tickMap = (t, list) => Object.fromEntries(t[list].map(i => [i.id, [i.done, i.at]]));
  const crewPart = (t, ids) => J([CREWF.map(k => t[k]), t.crewAt, ids.items.map(i => tickMap(t, 'items')[i]), ids.checks.map(i => tickMap(t, 'checks')[i])]);
  const common = (a, b, list) => a[list].map(i => i.id).filter(id => b[list].some(x => x.id === id));
  const serverState = () => ({ tasks: Object.fromEntries(hub.entities('Tasks').map(t => [t.uid, t])), shifts: Object.fromEntries(hub.entities('Hours').map(s => [s.id, s])), reports: Object.fromEntries(hub.entities('Reports').map(r => [r.date, r])) });
  const superPart = r => J([REPORT_KEYS.filter(k => !['decisions', 'pmReview', 'pmAt'].includes(k)).map(k => r[k]), r.decisions.map(d => [d.q, d.rec, d.by])]);
  const pmPart = r => J([r.pmReview, r.pmAt, r.decisions.map(d => [d.q, d.pm, d.pmNote])]);

  const adopt = (c, kind, e) => { const key = { task: e.uid, shift: e.id, report: e.date }[kind], x = strip(e); c[kind + 's'][key] = x; c.base[kind[0] + ':' + key] = J(x); };
  function sync(c) {
    const before = serverState();
    const d = { tasks: [], shifts: [], reports: [] };
    for (const [k, t] of Object.entries(c.tasks)) if (c.base['t:' + k] !== J(t)) d.tasks.push(t);
    for (const [k, s] of Object.entries(c.shifts)) if (c.base['s:' + k] !== J(s) && (c.role === 'pm' || s.device === c.dev)) d.shifts.push(s);
    if (c.role !== 'crew') for (const [k, r] of Object.entries(c.reports)) if (c.base['r:' + k] !== J(r)) d.reports.push(r);
    if (d.tasks.length || d.shifts.length || d.reports.length) {
      const r = ok(c.ph.push(d));
      if (process.env.HUB_TRACE) for (const x of r.shifts) if (x.key === process.env.HUB_TRACE) console.log('PUSH', c.dev, J(d.shifts.find(s => s.id === x.key)), '->', J(x));
      for (const kind of ['task', 'shift', 'report']) for (const x of r[kind + 's']) {
        if (x.status === 'ok') adopt(c, kind, x[kind]); else unexpected.push([c.role, c.dev, kind, x.key, x.reason]);
      }
    }
    for (let since = c.since; ;) {
      const p = ok(c.ph.call('pull', { since }));
      assert.ok(p.rev >= since, 'rev never goes backwards');
      for (const t of p.tasks || []) adopt(c, 'task', t);
      for (const s of p.shifts || []) adopt(c, 'shift', s);
      for (const r of p.reports || []) adopt(c, 'report', r);
      since = c.since = p.rev;
      if (!p.more) break;
    }
    // Ownership invariants over what this one sync changed on the server.
    const after = serverState();
    for (const id of Object.keys(before.shifts)) {
      const b = before.shifts[id], a = after.shifts[id];
      assert.ok(a, 'a shift never disappears');
      assert.equal(a.device, b.device, 'a shift never changes phones');
      if (b.out) assert.ok(a.out, `a clock-out is never undone (${id})`);
      if (b.gone) assert.equal(a.gone, true, 'a removed shift stays removed');
      if (c.role !== 'pm' && b.device !== c.dev) assert.equal(J(a), J(b), 'a worker key leaves other phones\' shifts alone');
      if (c.role !== 'pm') assert.deepEqual([a.edited, a.gone], [b.edited, b.gone], 'only the PM sets edited or gone');
    }
    for (const id of Object.keys(after.shifts)) if (!before.shifts[id] && c.role !== 'pm') assert.equal(after.shifts[id].device, c.dev);
    for (const uid of Object.keys(after.tasks)) {
      const a = after.tasks[uid], b = before.tasks[uid];
      if (!b) { assert.notEqual(c.role, 'crew', 'a crew key never creates a task'); continue; }
      if (c.role === 'crew') assert.equal(officePart(a), officePart(b), 'a crew key never changes the assignment');
      else assert.equal(crewPart(a, { items: common(a, b, 'items'), checks: common(a, b, 'checks') }), crewPart(b, { items: common(a, b, 'items'), checks: common(a, b, 'checks') }), 'an office key never changes crew results');
    }
    for (const date of Object.keys(after.reports)) {
      const a = after.reports[date], b = before.reports[date];
      if (!b) continue;
      if (c.role === 'crew') assert.equal(J(a), J(b), 'a crew key never changes a report');
      if (c.role === 'super') assert.equal(pmPart(a), pmPart(b), 'the superintendent never changes the PM part');
      if (c.role === 'pm') assert.equal(superPart(a), superPart(b), 'the PM never changes the super part');
    }
  }

  const officeSnap = raw => { const t = { ...TASK_BLANK, ...raw }; return {  off: officePart(t), items: t.items.map(i => ({ id: i.id, text: i.text })), checks: t.checks.map(i => ({ id: i.id, text: i.text })), fields: Object.fromEntries(OFFICE.map(k => [k, t[k]])), stamp: t.assignAt }; };
  const crewSnap = t => ({ fields: Object.fromEntries(CREWF.map(k => [k, t[k]])), items: tickMap(t, 'items'), checks: tickMap(t, 'checks'), stamp: t.crewAt });
  const record = (uid, part, snap) => { const L = led.tasks[uid] || (led.tasks[uid] = { office: [], crew: [] }); L[part].push(snap); };

  for (let step = 0; step < steps; step++) {
    tick();
    const c = pickOf(clients), stamp = now();
    const op = rand();
    if (c.role === 'crew' || op < 0.12) { // clock in or out on this phone (the office phones are workers too)
      const open = Object.values(c.shifts).filter(s => s.device === c.dev && !s.out && !s.gone);
      if (open.length && chance(0.6)) { const s = pickOf(open); s.out = hm(); led.workerOut[s.id] = s.out; }
      else if (!open.length || chance(0.3)) {
        const id = `${c.label}-${++n}`;
        c.shifts[id] = { id, device: c.dev, who: pickOf(['Dana R', 'dana r', 'Eli T']), date: today, in: hm(), out: '', crew: pickOf(['Crew A', 'Crew B']), tasks: [], edited: { who: false, in: false, out: false }, gone: false, at: stamp };
        led.device[id] = c.dev;
      }
    }
    if (c.role === 'crew' && chance(0.7)) {
      const mine = Object.values(c.tasks);
      if (mine.length) {
        const t = pickOf(mine);
        if (chance(0.5) && t.items.length) { const it = pickOf(t.items); it.done = !it.done; it.at = it.done ? stamp : 0; }
        else Object.assign(t, { status: pickOf(['Partial', 'Complete', 'Blocked']), doneText: 'D' + ++n, comments: chance(0.5) ? 'C' + n : '', aStart: '07:05' });
        t.crewAt = stamp;
        record(t.uid, 'crew', crewSnap(t));
      }
    } else if (c.role === 'super' || c.role === 'pm') {
      if (chance(0.35) || !Object.keys(c.tasks).length) {
        if (chance(0.5) || !Object.keys(c.tasks).length) {
          const uid = 't' + ++n;
          const t = { uid, id: 'T' + n, date: today, by: 'Sam', crew: pickOf(['Crew A', 'Crew B']), floor: 'L' + (n % 4), scope: 'S' + n, members: [], items: [{ id: 'i' + ++n, text: 'one' }, { id: 'i' + ++n, text: 'two' }], checks: [{ id: 'c' + ++n, text: 'chk' }], assignAt: stamp };
          c.tasks[uid] = t;
          record(uid, 'office', officeSnap(t));
        } else {
          const t = pickOf(Object.values(c.tasks)), which = rand();
          if (which < 0.3) t.scope = 'S' + ++n;
          else if (which < 0.5) t.items.push({ id: 'i' + ++n, text: 'added' + n, done: false, at: 0 });
          else if (which < 0.65 && t.items.length > 1) t.items.splice(Math.floor(rand() * t.items.length), 1);
          else if (which < 0.8) Object.assign(t, { review: pickOf(['Accepted', 'Follow-up needed']), reviewer: 'Sam', followUp: 'F' + ++n });
          else Object.assign(t, { reply: 'M' + ++n, replyAt: stamp, replyBy: 'Sam' });
          t.assignAt = stamp;
          record(t.uid, 'office', officeSnap(t));
        }
      }
      if (c.role === 'super' && chance(0.3)) {
        const r = c.reports[today] || (c.reports[today] = { ...REPORT_BLANK, date: today, super: 'Sam', decisions: [{ q: 'Q1', rec: 'r1', by: 'Sam', pm: '', pmNote: '' }, { q: 'Q2', rec: 'r2', by: 'Sam', pm: '', pmNote: '' }] });
        Object.assign(r, { results: 'R' + ++n, status: pickOf(['On plan', 'At risk']), wins: chance(0.5) ? 'W' + n : '', submittedAt: chance(0.3) ? stamp : r.submittedAt, updatedAt: stamp });
        (led.reports[today] ||= { sup: [], pm: [] }).sup.push({ stamp, part: superPart(r) });
      }
      if (c.role === 'pm') {
        const r = c.reports[today];
        if (r && chance(0.4)) {
          const d = pickOf(r.decisions);
          Object.assign(d, { pm: 'A' + ++n, pmNote: chance(0.5) ? 'N' + n : '' });
          Object.assign(r, { pmReview: chance(0.5) ? 'V' + n : r.pmReview, pmAt: stamp });
          led.reports[today].pm.push({ stamp, part: pmPart(r) });
        }
        const shifts = Object.values(c.shifts);
        if (shifts.length && chance(0.35)) {
          const s = pickOf(shifts), which = rand();
          if (which < 0.3) { s.out = pickOf(['14:00', '16:15']); s.edited.out = true; led.pmOut[s.id] = s.out; }
          else if (which < 0.5) { s.who = 'PM Fixed ' + ++n; s.edited.who = true; led.pmWho[s.id] = s.who; }
          else if (which < 0.6) { s.in = '06:' + String(10 + (n++ % 40)); s.edited.in = true; }
          else if (which < 0.7) { s.gone = true; led.removed[s.id] = true; }
        }
        if (chance(0.1)) {
          const id = `hand-${++n}`;
          c.shifts[id] = { id, device: '', who: pickOf(['Dana R', 'Ana P']), date: today, in: '07:00', out: '15:30', crew: '', tasks: [], edited: { who: true, in: true, out: true }, gone: false, at: 0 };
        }
      }
    }
    if (chance(0.3)) c.online = !c.online;
    if (c.online && chance(0.6)) sync(c);
  }
  // Everyone back online: two rounds so the last push of each reaches everyone.
  for (const c of clients) c.online = true;
  for (let round = 0; round < 2; round++) for (const c of clients) sync(c);
  assert.deepEqual(unexpected, [], `seed ${seed}: no push was refused`);

  // 1. every phone holds exactly what the hub holds for what it may see
  const server = serverState();
  for (const c of clients) {
    assert.deepEqual(Object.keys(c.tasks).sort(), Object.keys(server.tasks).sort(), `seed ${seed}: ${c.dev} sees every task`);
    for (const [uid, t] of Object.entries(c.tasks)) assert.equal(J(t), J(server.tasks[uid]), `seed ${seed}: ${c.dev} task ${uid}`);
    const myShifts = Object.values(server.shifts).filter(s => c.role === 'pm' || s.device === c.dev);
    assert.deepEqual(Object.keys(c.shifts).sort(), myShifts.map(s => s.id).sort(), `seed ${seed}: ${c.dev} shifts`);
    for (const s of myShifts) assert.equal(J(c.shifts[s.id]), J(s), `seed ${seed}: ${c.dev} shift ${s.id}`);
    if (c.role !== 'crew') for (const [d, r] of Object.entries(c.reports)) assert.equal(J(r), J(server.reports[d]), `seed ${seed}: ${c.dev} report`);
    else assert.deepEqual(c.reports, {});
  }
  // 2. the oracle: each part is the copy written at the highest stamp
  for (const [uid, L] of Object.entries(led.tasks)) {
    const t = server.tasks[uid];
    assert.ok(t, `seed ${seed}: task ${uid} exists`);
    const o = L.office.reduce((a, b) => (b.stamp > a.stamp ? b : a));
    for (const k of OFFICE) assert.equal(J(t[k]), J(o.fields[k]), `seed ${seed}: ${uid}.${k} follows the newest assignment`);
    assert.equal(t.assignAt, o.stamp);
    const cr = L.crew.length ? L.crew.reduce((a, b) => (b.stamp > a.stamp ? b : a)) : null;
    for (const k of CREWF) assert.equal(J(t[k]), J(cr ? cr.fields[k] : typeof TASK_TPL[k] === 'number' ? 0 : ''), `seed ${seed}: ${uid}.${k} follows the newest crew result`);
    assert.equal(t.crewAt, cr ? cr.stamp : 0);
    for (const list of ['items', 'checks']) {
      assert.deepEqual(t[list].map(i => [i.id, i.text]), o[list].map(i => [i.id, i.text]), `seed ${seed}: ${uid} ${list} structure is the office's`);
      for (const i of t[list]) {
        // Exact when the newest crew copy knew the item and no office edit ever dropped it. A tick can only go missing
        // when a crew push met a structure without that id (a stale office copy re-adding it later), or the copy never
        // saw the item; then the stored tick is untouched or one some crew phone really wrote, never invented.
        const dropped = L.office.some(o => !o[list].some(x => x.id === i.id));
        if (cr && cr[list][i.id] && !dropped) assert.deepEqual([i.done, i.at], cr[list][i.id], `seed ${seed}: ${uid} ${list} ${i.id} ticks are the newest crew copy's`);
        else {
          const seen = [[false, 0]].concat(L.crew.filter(x => x[list][i.id]).map(x => x[list][i.id])).map(J);
          assert.ok(seen.includes(J([i.done, i.at])), `seed ${seed}: ${uid} ${list} ${i.id} has a tick no crew phone wrote`);
        }
      }
    }
  }
  assert.equal(Object.keys(server.tasks).length, Object.keys(led.tasks).length);
  for (const [d, L] of Object.entries(led.reports)) {
    const r = server.reports[d];
    assert.ok(r, `seed ${seed}: report exists`);
    assert.equal(superPart(r), L.sup.reduce((a, b) => (b.stamp > a.stamp ? b : a)).part, `seed ${seed}: report super part`);
    if (L.pm.length) assert.equal(pmPart(r), L.pm.reduce((a, b) => (b.stamp > a.stamp ? b : a)).part, `seed ${seed}: report PM part`);
  }
  // 3. shifts: the PM's last word and the worker's clock-out stand
  for (const s of Object.values(server.shifts)) {
    if (s.device) assert.equal(s.device, led.device[s.id] || s.device);
    if (led.pmOut[s.id]) assert.deepEqual([s.out, s.edited.out], [led.pmOut[s.id], true], `seed ${seed}: PM out time sticks (${s.id})`);
    else if (led.workerOut[s.id] && !s.edited.out && !s.gone) assert.equal(s.out, led.workerOut[s.id], `seed ${seed}: clock-out stands (${s.id})`);
    if (led.pmWho[s.id]) assert.equal(s.who, led.pmWho[s.id], `seed ${seed}: PM rename sticks`);
    if (led.removed[s.id]) assert.equal(s.gone, true, `seed ${seed}: removed stays removed`);
  }
  return { env, server };
}

const HISTORIES = Number(process.env.HUB_HISTORIES) || 300;
test('convergence: crew, super and PM phones with random offline gaps end equal to the hub and never break an ownership rule', async () => {
  const { shiftMin, monday } = await import('../docs/schwab/report.mjs');
  const started = Date.now();
  let tasks = 0, shifts = 0, syncs = 0;
  for (let seed = Number(process.env.HUB_SEED) || 1; seed <= (Number(process.env.HUB_SEED) || HISTORIES); seed++) {
    const { env, server } = convergence(seed, 40);
    tasks += Object.keys(server.tasks).length; shifts += Object.keys(server.shifts).length;
    syncs += env.hub.calls.length;
    // Weekly totals follow the shifts exactly, as the client would add them up.
    const want = new Map();
    for (const s of Object.values(server.shifts)) {
      if (s.gone) continue;
      const k = monday(s.date) + '|' + s.who.toLowerCase();
      const g = want.get(k) || { cents: 0, n: 0, open: 0 };
      g.n++; if (s.out) g.cents += Math.round(shiftMin(s) * 5 / 3); else g.open++;
      want.set(k, g);
    }
    const got = rowsOf(env.hub, 'Weekly totals');
    assert.equal(got.length, want.size, `seed ${seed}: one row per person per week`);
    for (const r of got) {
      const w = want.get(r['Week of'] + '|' + r.Name.toLowerCase());
      assert.ok(w, `seed ${seed}: ${r.Name}`);
      assert.deepEqual([Math.round(r.Hours * 100), r.Shifts, r['Open shifts']], [w.cents, w.n, w.open], `seed ${seed}: ${r.Name} ${r['Week of']}`);
    }
  }
  assert.ok(tasks > HISTORIES / 2 && shifts > HISTORIES / 2, `histories made real data (${tasks} tasks, ${shifts} shifts)`);
  console.log(`# convergence: ${HISTORIES} histories, ${tasks} tasks, ${shifts} shifts, ${syncs} Sheets calls, ${Date.now() - started} ms`);
});
