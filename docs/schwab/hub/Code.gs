// Schwab field app hub: ONE Apps Script web app + ONE Google Sheet (docs/schwab/HUB.md is the contract).
// Copying this source does not authorize or deploy anything. Read the deploy steps below first.
//
// ACTIONS (POST, JSON in a text/plain body):  whoami  pull  push  translate  records
//                                             purge  stats  keys  rotate  archive  selftest
// ROLES (a phone holds one key; whoami says which):
//   crew  : pull tasks + config + own shifts; push the crew part of tasks and own shifts; translate
//   super : crew, plus office part of tasks, config, report super part, pull reports + events, records (tasks, reports)
//   pm    : everything, including shifts with PM rules, report PM part, purge, stats, keys, rotate, archive, selftest
//
// ONE-TIME DEPLOY (same flow and posture as review-folder.gs):
//   1. New Apps Script project. Paste this file; replace appsscript.json with the one next to it
//      (Sheets advanced service, scopes drive.file + script.external_request, web app MYSELF / USER_DEPLOYING).
//   2. Run setupHub() once and approve the two scopes. It creates the Sheet with every tab and prints the three
//      keys and the Sheet link to the execution log (the PM key is stored only as a SHA-256 hash: copy it now,
//      resetPmKey() makes a new one). Running setupHub() again changes nothing.
//   3. Deploy > New deployment > Web app (execute as you). Verify privately, then review and approve anonymous
//      access separately before phones can reach it.
//   4. In the app: Settings > Hub: paste the /exec URL and the PM key, Test the hub, then Invite crew.
// The Sheet is the database. The last column of each tab (data, JSON) is the truth; the readable columns are
// rewritten from it. Edit through the app, not in the Sheet.
// Google lets one user make only a few dozen Sheets requests a minute, and every request here runs as the owner. So a
// pull reads the Sheet once per revision and every other phone is answered from CacheService (see "the pull cache").
//
// DETAILS BEYOND HUB.md (the contract says the rest):
//   - purge sends the record's key as `target`: `key` is already the request's own credential. A push can also carry deleted:[{kind,key}].
//   - kinds are 'tasks' | 'shifts' | 'reports' (records also 'events'); the singular is accepted on input.
//   - every push result carries `i`, its index in the request; `key` is '' when the sent key had an unsafe shape. A refusal
//     has status 'rejected' and a reason: forbidden | invalid | too_large | device | deleted | archived. Config answers with
//     configStatus / configReason. Both limits of 200 entities apply per kind.
//   - a pull cuts each list at 500 and then lowers `rev` to what it really sent and adds more:true; call again from that rev.
//   - a part whose stamp is 0 was not sent: it never replaces an existing one. A key may write the other role's part
//     only with a strictly newer stamp (a tie never wipes someone else's work).
//   - archive moves rows older than `before` (not in the future); hours move in whole Monday-to-Sunday weeks. A later push
//     of an archived record is refused with 'archived'.
//   - a phone is its devSecret (its own 32 characters of [A-Za-z0-9], sent with every request): the device id is the first
//     32 hex characters of SHA-256(devSecret), and a `dev` the caller sends is ignored. A device id is not a secret (it is
//     in texts and the Sheet), so knowing one opens nothing. No valid devSecret: no device, so worker-rule shift writes are
//     refused ('device') and a crew or super pull has no shifts.

const HUB_VERSION = '1.0.0';
const HUB_TZ = 'America/New_York'; // the job's time zone; appsscript.json sets the same, and the hours math depends on it
const MAX_BODY = 1000000, MAX_PER_KIND = 200, MAX_ENTITY = 45000, MAX_CELL = 49000, MAX_LIST = 500;
const MAX_TR_ITEMS = 25, MAX_TR_CHARS = 2000, TR_CACHE_S = 21600, TR_CAP_DEFAULT = 1500;
const SKEW_MS = 5 * 60 * 1000, TOMBSTONE_DAYS = 90, OPEN_SHIFT_MS = 16 * 36e5;
const WINDOW_S = 60, PUSH_CAP_KEY = 300, PUSH_CAP_DEV = 40; // per minute
const CELL_LIMIT = 10000000, SELFTEST_DAY = '2000-01-01';
const FORMAT = {
  uid: /^[\w-]{1,40}$/, date: /^\d{4}-\d{2}-\d{2}$/, time: /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
  key: /^[A-Za-z0-9]{32}$/, pin: /^[0-9a-f]{16}:[0-9a-f]{64}$/,
};

// ---------- the sheet layout ----------
// Readable columns first, then key, rev, data. Weekly totals and Deleted have no data column: the first is derived
// from Hours, the second is only keys. (Which columns a pull reads to find rows is TABS[x].idx, below.)
const HEAD_TASKS = ['Date', 'Task ID', 'Crew', 'Floor', 'Area', 'Status', 'Steps done', 'Minutes worked', 'Scope', 'Completed', 'Remaining', 'Crew comments', 'Review', 'Follow-up', 'Reply', 'Updated', 'key', 'rev', 'data'];
const HEAD_HOURS = ['Name', 'Week of', 'Date', 'Day', 'Clock in', 'Clock out', 'Hours', 'Edited by PM', 'Note', 'Crew', 'Tasks', 'key', 'rev', 'data'];
const TABS = {
  tasks: { title: 'Tasks', head: HEAD_TASKS, width: [85, 85, 80, 85, 110, 80, 70, 80, 260, 220, 220, 220, 110, 200, 220, 120, 90, 50, 60] },
  shifts: { title: 'Hours', head: HEAD_HOURS, width: [140, 85, 85, 50, 70, 70, 60, 80, 100, 90, 140, 90, 50, 60] },
  weekly: { title: 'Weekly totals', head: ['Name', 'Week of', 'Hours', 'Shifts', 'Open shifts'], width: [160, 90, 70, 70, 90] },
  reports: { title: 'Reports', head: ['Date', 'Superintendent', 'Status', 'Results', 'Wins', 'Issues', 'Decisions waiting', 'PM review', 'key', 'rev', 'data'], width: [85, 140, 100, 300, 220, 220, 100, 220, 90, 50, 60] },
  events: { title: 'Activity', head: ['When', 'Who', 'What', 'Ref', 'key', 'rev', 'data'], width: [130, 120, 380, 110, 70, 50, 60] },
  deleted: { title: 'Deleted', head: ['key', 'kind', 'rev', 'when'], width: [120, 70, 60, 130] },
  config: { title: 'Config', head: ['Project', 'Site', 'Superintendent', 'Project manager', 'Updated', 'key', 'rev', 'data'], width: [180, 140, 140, 140, 120, 70, 50, 60] },
};
Object.keys(TABS).forEach(function (n) {
  const t = TABS[n];
  t.key = t.head.indexOf('key'); t.rev = t.head.indexOf('rev'); t.data = t.head.indexOf('data');
  if (n === 'deleted') { t.key = 0; t.rev = 2; }
});
const KINDS = { task: 'tasks', tasks: 'tasks', shift: 'shifts', shifts: 'shifts', report: 'reports', reports: 'reports' };

// ---------- entity templates (what a stored entity looks like) ----------
// 's' = short text (200 chars), 't' = long text (8000), 0 = number >= 0, false/true = boolean (the default is kept).
// Local-only task fields (origin, from, gotAt, filedAt, updatedAt) are not here: they never leave a phone.
const ASSIGN = ['id', 'date', 'by', 'floor', 'area', 'crew', 'crewId', 'members', 'memberIds', 'size', 'scope', 'refs', 'allot', 'allotNote', 'est', 'estNote', 'pStart', 'pStop', 'checkIn'];
const CREW = ['lead', 'aStart', 'aStop', 'delay', 'status', 'doneText', 'remain', 'comments', 'cLang', 'cLangs', 'resultAt'];
const OFFICE_EXTRA = ['review', 'reviewer', 'followUp', 'reply', 'replyAt', 'replyBy', 'aLang', 'aLangs', 'sentAt'];
const ITEM = { id: 's', text: 's', done: false, at: 0 };
const TASK = {
  uid: 's', id: 's', date: 's', by: 's', floor: 's', area: 's', crew: 's', crewId: 's', members: ['s'], memberIds: ['s'], size: 0, scope: 't', refs: 't',
  allot: 0, allotNote: 't', est: 0, estNote: 't', pStart: 's', pStop: 's', checkIn: 's',
  items: [ITEM], checks: [ITEM],
  review: 's', reviewer: 's', followUp: 't', reply: 't', replyAt: 0, replyBy: 's', aLang: 's', aLangs: {}, sentAt: 0, assignAt: 0,
  lead: 's', aStart: 's', aStop: 's', delay: 0, status: 's', doneText: 't', remain: 't', comments: 't', cLang: 's', cLangs: {}, resultAt: 0, crewAt: 0,
};
// aLangs (office part) and cLangs (crew part): the language each typed text is in, by its field or a step's id ({scope: 'es',
// reply: 'en', <step id>: 'es'}), so a PM and a superintendent, or two crew phones, can type in different languages.
const LANG_KEY = /^[A-Za-z0-9][\w-]{0,39}$/;
function langs_(m) {
  const out = {};
  if (isObj_(m)) Object.keys(m).slice(0, 300).forEach(function (k) { if (LANG_KEY.test(k) && (m[k] === 'en' || m[k] === 'es')) out[k] = m[k]; });
  return out;
}
// A shift names the person (pid), the crew (crewId) and the task sheets (uid) by id; who, crew and tasks[].id are the labels
// they had then, for reading.
const SHIFT = { id: 's', device: 's', who: 's', pid: 's', date: 's', in: 's', out: 's', crew: 's', crewId: 's', tasks: [{ uid: 's', id: 's' }], edited: { who: false, in: false, out: false }, gone: false, at: 0 };
const CREW_BLOCK = { name: 's', na: true, lead: 's', workers: 0, labor: 0, laborFromTasks: false, members: 't', area: 's', ref: 's', start: 's', stop: 's', done: 't', quality: 't', holdups: 't', good: 't' };
const REPORT = {
  date: 's', super: 's', shiftStart: 's', shiftEnd: 's', submittedAt: 0, status: 's', results: 't', wins: 't', issues: 't', notified: 't',
  needs: [{ item: 's', qty: 's', where: 's', confirmed: false, by: 's' }],
  decisions: [{ q: 't', rec: 't', by: 's', pm: 't', pmNote: 't' }],
  floors: [{ floor: 's', crews: [CREW_BLOCK] }],
  next: [{ step: 't', prereq: 't', start: 's', dur: 's', finish: 's', deadline: 's', lead: 's', checkin: 's' }],
  risks: [{ risk: 't', impact: 't', prevent: 't', fallback: 't', owner: 's', by: 's' }],
  preparedBy: 's', pmReview: 't', updatedAt: 0, lang: 's', pmLang: 's', pmAt: 0,
};
// people is the roster (the source of truth); crews[].members is the derived name list older phones still read.
const CONFIG = { project: 's', site: 's', super: 's', pm: 's', floors: ['s'], crews: [{ id: 's', name: 's', lead: 's', members: 't' }], people: [{ id: 's', name: 's', crewId: 's' }], checks: ['s'], pin: 's', at: 0 };
const REPORT_STATUS = ['On plan', 'At risk', 'Behind plan', 'No work today'];

// ---------- small helpers ----------
function HubError_(code) { this.name = 'HubError'; this.code = code; this.message = MESSAGES[code]; } // an Error, so the editor shows the message
HubError_.prototype = Object.create(Error.prototype);
function fail_(code) { throw new HubError_(code); }
const MESSAGES = {
  bad_request: 'Bad request', unauthorized: 'Wrong key', forbidden: 'Not allowed for this key', busy: 'Busy, try again shortly',
  too_large: 'Too large', quota: 'Daily limit reached', not_ready: 'The hub is not set up', server: 'Server error',
};
function reply_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function isObj_(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function arr_(x) { if (x === undefined || x === null) return []; if (!Array.isArray(x)) fail_('bad_request'); return x; }
function own_(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function clone_(x) { return JSON.parse(JSON.stringify(x)); }
function dict_() { return Object.create(null); } // a map keyed by user text: ids like "__proto__" must stay plain keys
function pad_(n) { return (n < 10 ? '0' : '') + n; }
function isDay_(d) {
  if (typeof d !== 'string' || !FORMAT.date.test(d)) return false;
  const t = new Date(d + 'T00:00:00Z');
  return !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}
function addDays_(day, n) { const t = new Date(day + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function monday_(day) { return addDays_(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7)); } // weeks run Monday to Sunday
function weekday_(day) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(day + 'T12:00:00Z').getUTCDay()]; }
function today_() { const d = new Date(); return d.getFullYear() + '-' + pad_(d.getMonth() + 1) + '-' + pad_(d.getDate()); } // script time zone
function stampText_(ms) { const d = new Date(ms); return d.getFullYear() + '-' + pad_(d.getMonth() + 1) + '-' + pad_(d.getDate()) + ' ' + pad_(d.getHours()) + ':' + pad_(d.getMinutes()); }
function clampStamp_(v, now) { return typeof v === 'number' && isFinite(v) && v > 0 ? Math.floor(v > now + SKEW_MS ? now : v) : 0; }
function t12_(t) { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); if (!m) return ''; const h = +m[1]; return ((h + 11) % 12 + 1) + ':' + m[2] + (h < 12 ? ' AM' : ' PM'); }
function clip_(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) : s; }
// The same key as nameKey in shared.mjs: case, accents, spacing and punctuation do not matter. Only for matching a
// typed name; once a person has an id, the id is the identity.
function nameKey_(name) { return String(name == null ? '' : name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase(); }
function digestHex_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function sameStr_(a, b) { // constant time for equal lengths; the length itself is not a secret here
  let d = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ (i < b.length ? b.charCodeAt(i) : 0);
  return d === 0;
}
function newKey_() { // 32 characters of [A-Za-z0-9] from random UUIDs, whitened through SHA-256
  let k = '';
  while (k.length < 32) {
    k += Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now()))
      .replace(/[^A-Za-z0-9]/g, '');
  }
  return k.slice(0, 32);
}
function sheetUrl_(id) { return 'https://docs.google.com/spreadsheets/d/' + id + '/edit'; }

// Copy only the keys and types the template knows (like shape() in shared.mjs), clip text, never trust the input.
function shape_(tpl, src) {
  if (Array.isArray(tpl)) return Array.isArray(src) ? src.slice(0, MAX_LIST).map(function (x) { return shape_(tpl[0], x); }) : [];
  if (isObj_(tpl)) {
    const out = {}, s = isObj_(src) ? src : {};
    Object.keys(tpl).forEach(function (k) { out[k] = shape_(tpl[k], own_(s, k) ? s[k] : undefined); });
    return out;
  }
  if (typeof tpl === 'string') { // control characters become spaces; only long text keeps its line breaks and tabs
    return typeof src === 'string' ? src.replace(tpl === 't' ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, ' ').slice(0, tpl === 't' ? 8000 : 200) : '';
  }
  if (typeof tpl === 'number') return typeof src === 'number' && isFinite(src) && src >= 0 ? Math.min(src, 4e12) : 0;
  return typeof src === 'boolean' ? src : tpl;
}

// ---------- hours math: identical to shiftMin / cents in report.mjs ----------
function startedMs_(s) { return new Date(s.date + 'T' + s.in).getTime(); }
// Real minutes from the real times (script time zone): an out before the in is the next morning, and a night
// across a clock change counts the hour gained or lost.
function shiftMin_(s) { return s.in && s.out ? Math.round((new Date((s.out < s.in ? addDays_(s.date, 1) : s.date) + 'T' + s.out) - startedMs_(s)) / 6e4) : 0; }
function cents_(s) { return Math.round(shiftMin_(s) * 5 / 3); } // payroll hundredths of an hour, rounded per shift
function toMin_(t) { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; }
function workedMin_(t) {
  const a = toMin_(t.aStart), b = toMin_(t.aStop);
  return a == null || b == null ? 0 : Math.max(0, (b - a + 1440) % 1440 - t.delay);
}

// ---------- Google Sheets, one wrapper per documented REST method (Advanced Sheets service, valueInputOption RAW) ----------
// spreadsheets.create
function apiCreate_(spreadsheet) { return Sheets.Spreadsheets.create(spreadsheet); }
// spreadsheets.get
function apiGet_(id, fields) { return Sheets.Spreadsheets.get(id, { fields: fields }); }
// spreadsheets.batchUpdate
function apiBatch_(id, requests) { return Sheets.Spreadsheets.batchUpdate({ requests: requests }, id); }
// spreadsheets.values.get
function apiValuesGet_(id, range) { return Sheets.Spreadsheets.Values.get(id, range, { valueRenderOption: 'UNFORMATTED_VALUE' }); }
// spreadsheets.values.batchGet
function apiValuesBatchGet_(id, ranges) { return Sheets.Spreadsheets.Values.batchGet(id, { ranges: ranges, valueRenderOption: 'UNFORMATTED_VALUE' }).valueRanges; }
// spreadsheets.values.batchUpdate
function apiValuesBatchUpdate_(id, data) { return Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: data }, id); }
// spreadsheets.values.append
function apiValuesAppend_(id, range, values) { return Sheets.Spreadsheets.Values.append({ majorDimension: 'ROWS', values: values }, id, range, { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' }); }
// spreadsheets.values.clear
function apiValuesClear_(id, range) { return Sheets.Spreadsheets.Values.clear({}, id, range); }

function colName_(i) { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; }
// A1 range on a tab; rows are 1-based, an omitted end row means "to the bottom".
function a1_(tab, c1, r1, c2, r2) { return "'" + tab.title + "'!" + colName_(c1) + r1 + ':' + colName_(c2) + (r2 || ''); }
function cellText_(v) { return v === undefined || v === null ? '' : String(v); }

function sheetSpec_(names, title) {
  return {
    properties: { title: title },
    sheets: names.map(function (n) {
      return { properties: { title: TABS[n].title, gridProperties: { rowCount: 1000, columnCount: TABS[n].head.length, frozenRowCount: 1 } } };
    }),
  };
}
function sheetIds_(ctx, id) { // title -> sheetId
  const key = 'ids:' + id;
  if (!ctx.memo[key]) {
    const m = {};
    apiGet_(id, 'sheets.properties(sheetId,title)').sheets.forEach(function (s) { m[s.properties.title] = s.properties.sheetId; });
    ctx.memo[key] = m;
  }
  return ctx.memo[key];
}
// Headers, bold, frozen, widths. Safe to repeat. The data column is narrow and clipped.
function formatTabs_(ctx, id, names) {
  const ids = sheetIds_(ctx, id), reqs = [], heads = [];
  names.forEach(function (n) {
    const t = TABS[n], sid = ids[t.title];
    heads.push({ range: a1_(t, 0, 1, t.head.length - 1, 1), values: [t.head] });
    reqs.push({ updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
    reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: t.head.length }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
    t.width.forEach(function (w, i) {
      reqs.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } });
    });
    if (t.data >= 0) {
      reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 1, startColumnIndex: t.data, endColumnIndex: t.data + 1 }, cell: { userEnteredFormat: { wrapStrategy: 'CLIP' } }, fields: 'userEnteredFormat.wrapStrategy' } });
    }
  });
  apiValuesBatchUpdate_(id, heads);
  apiBatch_(id, reqs);
}

// ---------- setup (run by the owner in the editor) ----------
function withScriptLock_(ms, fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(ms)) fail_('busy');
  try { return fn(); } finally { lock.releaseLock(); }
}

function setupHub() {
  return withScriptLock_(30000, function () {
    const props = PropertiesService.getScriptProperties(), ctx = { memo: {} }, P = props.getProperties();
    const names = Object.keys(TABS);
    let id = P.SHEET_ID, first = false;
    if (!id) {
      id = apiCreate_(sheetSpec_(names, 'Schwab field hub')).spreadsheetId;
      props.setProperty('SHEET_ID', id);
      first = true;
    } else { // repair: add any tab that is missing
      const have = apiGet_(id, 'sheets.properties(sheetId,title)').sheets.map(function (s) { return s.properties.title; });
      const add = names.filter(function (n) { return have.indexOf(TABS[n].title) < 0; });
      if (add.length) apiBatch_(id, add.map(function (n) { return { addSheet: { properties: { title: TABS[n].title, gridProperties: { rowCount: 1000, columnCount: TABS[n].head.length, frozenRowCount: 1 } } } }; }));
    }
    formatTabs_(ctx, id, names);
    const out = { sheetUrl: sheetUrl_(id) };
    if (!P.PM_KEY_SHA256) {
      const pm = newKey_();
      props.setProperty('PM_KEY_SHA256', digestHex_(pm));
      Logger.log('PM key (shown once, copy it now): ' + pm);
    }
    ['CREW_KEY', 'SUPER_KEY'].forEach(function (p) {
      if (P[p]) return;
      const k = newKey_();
      props.setProperty(p, k);
      Logger.log((p === 'CREW_KEY' ? 'Crew key: ' : 'Superintendent key: ') + k);
    });
    Logger.log(first ? 'Google Sheet: ' + out.sheetUrl : 'Hub already set up. Google Sheet: ' + out.sheetUrl);
    return out;
  });
}

// Lost the PM key? This makes a new one (the old one stops working) and shows it once.
function resetPmKey() {
  return withScriptLock_(30000, function () {
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty('SHEET_ID')) fail_('not_ready');
    const pm = newKey_();
    props.setProperty('PM_KEY_SHA256', digestHex_(pm));
    Logger.log('New PM key (shown once, copy it now): ' + pm);
  });
}

// ---------- web app entry points ----------
function doGet() { return reply_({ ok: true, service: 'schwab-field-hub', version: HUB_VERSION }); } // health only: nothing else

function doPost(e) {
  try {
    return reply_(handle_(e));
  } catch (err) {
    const code = err instanceof HubError_ ? err.code : 'server';
    // Never echo submitted data or a stack. A server error logs only a clipped, generic line for the owner.
    if (code === 'server') Logger.log('hub error: ' + clip_(err && err.message, 160));
    return reply_({ ok: false, error: code, message: MESSAGES[code] });
  }
}

const ALL = ['crew', 'super', 'pm'], OFFICE = ['super', 'pm'], PM = ['pm'];
// The role-by-action matrix from HUB.md. Finer rules (which part of a task, which shifts) live in the handlers.
const ACTIONS = {
  whoami: { roles: ALL, run: whoami_ },
  pull: { roles: ALL, run: pull_ },
  push: { roles: ALL, run: push_, write: true },
  translate: { roles: ALL, run: translate_ },
  records: { roles: OFFICE, run: records_ },
  purge: { roles: PM, run: purge_, write: true },
  stats: { roles: PM, run: stats_ },
  keys: { roles: PM, run: keys_ },
  rotate: { roles: PM, run: rotate_, write: true },
  archive: { roles: PM, run: archive_, write: true },
  selftest: { roles: PM, run: selftest_, write: true },
};

function roleOf_(key, P) { // all three comparisons always run; the PM key is only ever compared as a hash
  if (typeof key !== 'string' || !FORMAT.key.test(key)) return '';
  const pm = sameStr_(digestHex_(key), P.PM_KEY_SHA256 || '');
  const su = sameStr_(key, P.SUPER_KEY || ''), cr = sameStr_(key, P.CREW_KEY || '');
  return pm ? 'pm' : su ? 'super' : cr ? 'crew' : '';
}

// ponytail: cache counters are not atomic across parallel executions, so the limits are approximate.
// Fine for a throttle; move the counters under the script lock if exact counts ever matter.
// A broken cache fails open (no throttle) rather than taking every request down with it.
function bump_(cache, name, now) {
  try {
    const parts = String(cache.get(name) || '').split(':');
    let start = Number(parts[0]), n = Number(parts[1]);
    if (!(now - start < WINDOW_S * 1000)) { start = now; n = 0; }
    n++;
    cache.put(name, start + ':' + n, WINDOW_S);
    return n;
  } catch (e) { return 0; }
}

// ponytail: wrong keys are not throttled. Apps Script gives no caller address, so a breaker can only be global, and a global
// one let anyone with the link stop every phone with 30 junk requests a minute. A 32-character key cannot be guessed online;
// junk still costs one execution and one properties read, so a big enough flood can use up the daily Properties quota.
// Caching the key hashes in CacheService would make a wrong key cost no properties read.
function handle_(e) {
  const cache = CacheService.getScriptCache(), now = Date.now();
  const body = e && e.postData && e.postData.contents;
  if (typeof body !== 'string') fail_('bad_request');
  if (body.length > MAX_BODY) fail_('too_large');
  let req;
  try { req = JSON.parse(body); } catch (x) { fail_('bad_request'); }
  if (!isObj_(req) || req.v !== 1 || typeof req.action !== 'string') fail_('bad_request');
  const P = PropertiesService.getScriptProperties().getProperties(); // one read: keys, rev, sheet id
  const role = roleOf_(req.key, P);
  if (!role) fail_('unauthorized');
  if (!own_(ACTIONS, req.action)) fail_('bad_request');
  const rule = ACTIONS[req.action];
  if (rule.roles.indexOf(role) < 0) fail_('forbidden');
  if (req.action !== 'whoami' && !P.SHEET_ID) fail_('not_ready');
  // The phone is what its secret proves, never what it says: a `dev` in the request is ignored.
  const dev = typeof req.devSecret === 'string' && FORMAT.key.test(req.devSecret) ? digestHex_(req.devSecret).slice(0, 32) : '';
  const ctx = { req: req, role: role, dev: dev, now: now, P: P, id: P.SHEET_ID, cache: cache, memo: {}, state: { rev: Number(P.REV) || 0 } };
  if (req.action === 'push' && (bump_(cache, 'pk:' + role, now) > PUSH_CAP_KEY || bump_(cache, 'pd:' + role + ':' + dev, now) > PUSH_CAP_DEV)) fail_('busy');
  const out = rule.write ? locked_(ctx, req.key, rule.run) : rule.run(ctx);
  out.ok = true;
  return out;
}

// Every write runs under the script lock, on fresh properties; rev is saved last, even after a failure part way.
// ponytail: one script lock serializes all writes. Fine for one crew; the real ceiling is Google's own request quota.
function locked_(ctx, key, run) {
  return withScriptLock_(20000, function () {
    const props = PropertiesService.getScriptProperties();
    ctx.P = props.getProperties();
    if (roleOf_(key, ctx.P) !== ctx.role) fail_('unauthorized'); // rotated while this request waited
    ctx.state.rev = Number(ctx.P.REV) || 0;
    const rev0 = ctx.state.rev;
    try { return run(ctx); } finally { if (ctx.state.rev !== rev0) props.setProperty('REV', String(ctx.state.rev)); }
  });
}
function nextRev_(ctx) { return ++ctx.state.rev; } // one revision per row written, so paging by rev is exact

function whoami_(ctx) {
  // dev: the device id this request's devSecret proves ('' without a valid one), so a phone can check it is the one it labels its shifts with
  const out = { role: ctx.role, rev: ctx.state.rev, now: ctx.now, tz: HUB_TZ, version: HUB_VERSION, dev: ctx.dev };
  if (ctx.role === 'pm' && ctx.id) out.sheetUrl = sheetUrl_(ctx.id);
  return out;
}

// ---------- reading and writing rows ----------
// Each tab: columns for the index (cheap reads), and the data column read only for the rows we need.
TABS.tasks.idx = { key: TABS.tasks.key, rev: TABS.tasks.rev, date: 0, crew: 2 };
TABS.shifts.idx = { key: TABS.shifts.key, rev: TABS.shifts.rev, date: 2 };
TABS.reports.idx = { key: TABS.reports.key, rev: TABS.reports.rev, date: 0 };
TABS.events.idx = { key: TABS.events.key, rev: TABS.events.rev, date: 0 };
TABS.config.idx = { key: TABS.config.key, rev: TABS.config.rev };
TABS.deleted.idx = { key: 0, kind: 1, rev: 2 };

function indexRanges_(name) { const t = TABS[name]; return Object.keys(t.idx).map(function (n) { return a1_(t, t.idx[n], 2, t.idx[n]); }); }
function parseIndex_(name, cols) { // [{row, key, rev, date?, crew?, kind?}] in sheet order, from this tab's index columns
  const t = TABS[name], names = Object.keys(t.idx);
  const vals = names.map(function (n, i) { return cols[i].values || []; });
  const count = Math.max.apply(null, vals.map(function (v) { return v.length; }).concat([0]));
  const rows = [];
  for (let i = 0; i < count; i++) {
    const r = { row: i + 2 };
    names.forEach(function (n, j) { const c = vals[j][i]; r[n] = cellText_(c && c[0]); });
    if (r.key === '') continue;
    r.rev = Number(r.rev) || 0;
    if (name === 'events') r.date = r.date.slice(0, 10); // When is "YYYY-MM-DD HH:MM"
    rows.push(r);
  }
  return rows;
}
// A writer always reads the Sheet itself (it must see exact row numbers). A pull primes ctx.memo.ixAll first.
function readIndex_(ctx, name) {
  if (ctx.memo.ixAll) return ctx.memo.ixAll[name];
  return parseIndex_(name, apiValuesBatchGet_(ctx.id, indexRanges_(name)));
}
// ponytail: one pass over every index column per revision, O(rows); archive keeps the Sheet small.
// Upgrade: keep the index in the cache and patch it from each write.
function readAllIndex_(ctx) { // every tab's index columns in ONE request: Google allows few requests a minute per user
  const names = Object.keys(TABS).filter(function (n) { return TABS[n].idx; }), ranges = [];
  names.forEach(function (n) { indexRanges_(n).forEach(function (r) { ranges.push(r); }); });
  const vr = apiValuesBatchGet_(ctx.id, ranges), all = {};
  let at = 0;
  names.forEach(function (n) { const k = Object.keys(TABS[n].idx).length; all[n] = parseIndex_(n, vr.slice(at, at + k)); at += k; });
  return all;
}

// ---------- the pull cache ----------
// Every phone pulls after every change, but the answer for one revision is the same for all of them. The first
// pull after a change reads the index (one request) and the changed rows (one request); the rest are served from
// CacheService. Keys carry the revision (index) or the row's own revision (entity), so an entry can never be
// out of date; the cache is only ever a speed-up and any miss or failure falls back to the Sheet.
const IX_CHUNK = 90000, CACHE_BATCH = 50, CACHE_TTL = 21600;
function cacheGetAll_(cache, keys) {
  const out = {};
  try { for (let i = 0; i < keys.length; i += CACHE_BATCH) Object.assign(out, cache.getAll(keys.slice(i, i + CACHE_BATCH))); } catch (e) { /* a miss */ }
  return out;
}
function cachePutAll_(cache, obj, ttl) {
  const keys = Object.keys(obj);
  try {
    for (let i = 0; i < keys.length; i += CACHE_BATCH) {
      const part = {};
      keys.slice(i, i + CACHE_BATCH).forEach(function (k) { part[k] = obj[k]; });
      cache.putAll(part, ttl);
    }
  } catch (e) { /* too big or full: the next reader reads the Sheet */ }
}
function loadAllIndex_(ctx) {
  const base = 'ix:' + ctx.state.rev;
  if (!ctx.memo.noCache) {
    const n = Number(cacheGetAll_(ctx.cache, [base + ':n'])[base + ':n']);
    if (n > 0 && n < 50) {
      const keys = [];
      for (let i = 0; i < n; i++) keys.push(base + ':' + i);
      const got = cacheGetAll_(ctx.cache, keys);
      if (keys.every(function (k) { return typeof got[k] === 'string'; })) {
        try { ctx.memo.ixAll = JSON.parse(keys.map(function (k) { return got[k]; }).join('')); return; } catch (e) { /* rebuild */ }
      }
    }
  }
  const all = readAllIndex_(ctx), json = JSON.stringify(all), put = {};
  let n = 0;
  for (let i = 0; i < json.length; i += IX_CHUNK) put[base + ':' + n++] = json.slice(i, i + IX_CHUNK);
  put[base + ':n'] = String(n);
  if (n < 50) cachePutAll_(ctx.cache, put, 900); // a bigger index is rebuilt each time; archive keeps the Sheet small
  ctx.memo.ixAll = all;
}
// Forget what this request read and read the Sheet itself (rows moved under us: a purge, or someone sorted the tab).
function dropReads_(ctx) {
  Object.keys(ctx.memo).forEach(function (k) { if (k === 'ixAll' || k.indexOf('raw:') === 0) delete ctx.memo[k]; });
  ctx.memo.noCache = true;
}
function runs_(rows) { // row numbers -> [[first, last], ...] of consecutive rows
  const out = [];
  rows.slice().sort(function (a, b) { return a - b; }).forEach(function (r) {
    const l = out[out.length - 1];
    if (l && r === l[1] + 1) l[1] = r; else if (!l || r > l[1]) out.push([r, r]);
  });
  return out;
}
function parseCell_(text) { let o = null; try { o = JSON.parse(text); } catch (x) { o = null; } return isObj_(o) ? o : null; }
// Read the data cells of these rows from the Sheet: {name: {row: cell text}} for several tabs in as few requests as possible.
function readCells_(ctx, wants) {
  const jobs = [], out = {};
  Object.keys(wants).forEach(function (name) {
    out[name] = {};
    runs_(wants[name]).forEach(function (r) { jobs.push({ name: name, r: r }); });
  });
  for (let i = 0; i < jobs.length; i += 40) {
    const part = jobs.slice(i, i + 40);
    const vr = apiValuesBatchGet_(ctx.id, part.map(function (j) { const t = TABS[j.name]; return a1_(t, t.data, j.r[0], t.data, j.r[1]); }));
    part.forEach(function (j, k) {
      const vals = vr[k].values || [];
      for (let row = j.r[0]; row <= j.r[1]; row++) { const c = vals[row - j.r[0]]; out[j.name][row] = cellText_(c && c[0]); }
    });
  }
  return out;
}
function readData_(ctx, name, rows) { // {row: parsed data object} for the rows that hold valid JSON
  const memo = ctx.memo['raw:' + name] || {}, out = {}, miss = [];
  rows.forEach(function (r) { if (memo[r]) out[r] = memo[r]; else miss.push(r); });
  if (miss.length) {
    const w = {};
    w[name] = miss;
    const cells = readCells_(ctx, w)[name];
    Object.keys(cells).forEach(function (r) { const o = parseCell_(cells[r]); if (o) out[r] = o; });
  }
  return out;
}
// A pull knows every row it needs up front: serve them from the cache, and fetch what is missing in ONE request.
function prefetch_(ctx, wants) { // wants: {name: [index entries]}; fills ctx.memo['raw:' + name]
  const ek = function (name, x) { return 'en:' + name + ':' + x.key + ':' + x.rev; };
  const need = [];
  Object.keys(wants).forEach(function (name) {
    const memo = ctx.memo['raw:' + name] || (ctx.memo['raw:' + name] = {}), seen = {};
    wants[name].forEach(function (x) { if (!memo[x.row] && !seen[x.row]) { seen[x.row] = true; need.push({ name: name, x: x }); } });
  });
  const got = ctx.memo.noCache ? {} : cacheGetAll_(ctx.cache, need.map(function (n) { return ek(n.name, n.x); })), miss = {};
  need.forEach(function (n) {
    const o = typeof got[ek(n.name, n.x)] === 'string' ? parseCell_(got[ek(n.name, n.x)]) : null;
    if (o) ctx.memo['raw:' + n.name][n.x.row] = o; else (miss[n.name] = miss[n.name] || []).push(n.x);
  });
  if (!Object.keys(miss).length) return;
  const wantRows = {};
  Object.keys(miss).forEach(function (name) { wantRows[name] = miss[name].map(function (x) { return x.row; }); });
  const cells = readCells_(ctx, wantRows), put = {};
  Object.keys(miss).forEach(function (name) {
    miss[name].forEach(function (x) {
      const text = cells[name][x.row], o = parseCell_(text);
      if (o) { ctx.memo['raw:' + name][x.row] = o; put[ek(name, x)] = text; }
    });
  });
  cachePutAll_(ctx.cache, put, CACHE_TTL);
}

function newBatch_() { return { upd: [], add: {}, del: {}, hours: false }; }
function rowRange_(name, row) { const t = TABS[name]; return a1_(t, 0, row, t.head.length - 1, row); }
function flush_(ctx, b) {
  for (let i = 0; i < b.upd.length; i += 100) apiValuesBatchUpdate_(ctx.id, b.upd.slice(i, i + 100));
  const names = Object.keys(b.del);
  if (names.length) { // one atomic request; each tab's runs go bottom up so the row numbers stay right
    const ids = sheetIds_(ctx, ctx.id), reqs = [];
    names.forEach(function (n) {
      runs_(b.del[n]).reverse().forEach(function (r) {
        reqs.push({ deleteDimension: { range: { sheetId: ids[TABS[n].title], dimension: 'ROWS', startIndex: r[0] - 1, endIndex: r[1] } } });
      });
    });
    apiBatch_(ctx.id, reqs);
  }
  Object.keys(b.add).forEach(function (n) {
    for (let i = 0; i < b.add[n].length; i += 100) apiValuesAppend_(ctx.id, rowRange_(n, 1), b.add[n].slice(i, i + 100));
  });
  if (b.warm) cachePutAll_(ctx.cache, b.warm, CACHE_TTL);
}

// An entry is one stored row: {row (0 = new), obj, rev, json, item}. save_ writes a changed entity once, even
// if the same key shows up twice in one push (the second save replaces the first pending write).
function save_(ctx, b, name, entry, obj, rowFn) {
  const json = JSON.stringify(obj);
  if (entry.row && entry.json === json) return false;
  if (json.length > MAX_CELL) fail_('too_large');
  entry.rev = nextRev_(ctx);
  const values = rowFn(obj, entry.rev, ctx.now, json);
  if (entry.item) {
    if (entry.row) entry.item.values = [values]; else entry.item.splice(0, entry.item.length, ...values);
  } else if (entry.row) {
    entry.item = { range: rowRange_(name, entry.row), values: [values] };
    b.upd.push(entry.item);
  } else {
    entry.item = values;
    (b.add[name] = b.add[name] || []).push(values);
  }
  entry.obj = obj; entry.json = json;
  (b.warm || (b.warm = {}))['en:' + name + ':' + values[TABS[name].key] + ':' + entry.rev] = json; // what the cell now holds, for the first pull
  return true;
}
function appendRow_(ctx, b, name, values) { (b.add[name] = b.add[name] || []).push(values); }

function rowBase_(t, readable, key, rev, json) { // readable cells, then key, rev, data; text clipped so a cell never overflows
  return readable.map(function (v) { return typeof v === 'number' ? v : clip_(v, 2000); }).concat([key, rev, json]);
}
function taskRow_(t, rev, now, json) {
  const done = t.items.filter(function (i) { return i.done; }).length;
  return rowBase_(TABS.tasks, [t.date, t.id, t.crew, t.floor, t.area, t.status, t.items.length ? done + '/' + t.items.length : '', workedMin_(t),
    t.scope, t.doneText, t.remain, t.comments, t.review, t.followUp, t.reply, stampText_(now)], t.uid, rev, json);
}
function shiftRow_(s, rev, now, json) {
  const out = s.gone ? '' : s.out ? cents_(s) / 100 : '';
  return rowBase_(TABS.shifts, [s.who, monday_(s.date), s.date, weekday_(s.date), s.in, s.out, out,
    s.edited.who || s.edited.in || s.edited.out ? 'Yes' : '', s.gone ? 'Removed' : s.out ? '' : 'No clock-out', s.crew, s.tasks.map(function (x) { return x.id || x.uid; }).join(', ')], s.id, rev, json);
}
function reportRow_(r, rev, now, json) {
  const waiting = r.decisions.filter(function (d) { return d.q && !d.pm; }).length;
  return rowBase_(TABS.reports, [r.date, r.super, r.status, r.results, r.wins, r.issues, waiting, r.pmReview], r.date, rev, json);
}
function configRow_(c, rev, now, json) { return rowBase_(TABS.config, [c.project, c.site, c.super, c.pm, stampText_(now)], 'config', rev, json); }

// Server-written, append only. label: what the readable Ref cell shows when the ref is not for people (a task's uid).
function addEvent_(ctx, b, kind, who, text, ref, label) {
  if (ctx.system) return; // the selftest leaves no trace in the feed
  const rev = nextRev_(ctx), ev = { rev: rev, ts: ctx.now, who: clip_(who || ctx.role, 100), role: ctx.role, kind: kind, text: clip_(text, 300), ref: clip_(ref, 60) };
  const json = JSON.stringify(ev);
  appendRow_(ctx, b, 'events', [stampText_(ev.ts), ev.who, ev.text, label ? clip_(label, 60) : ev.ref, String(rev), rev, json]);
  (b.warm || (b.warm = {}))['en:events:' + rev + ':' + rev] = json;
}

// Load the stored rows for these keys as entries.
function loadEntries_(ctx, name, norm, keys) {
  const idx = readIndex_(ctx, name), want = dict_(), byKey = dict_();
  keys.forEach(function (k) { want[k] = true; });
  const rows = idx.filter(function (r) { return want[r.key]; });
  const data = readData_(ctx, name, rows.map(function (r) { return r.row; }));
  rows.forEach(function (r) {
    const raw = data[r.row], obj = raw ? norm(raw, ctx.now) : null;
    // A row whose JSON is unreadable is overwritten by the next valid push for its key.
    byKey[r.key] = { row: r.row, rev: r.rev, obj: obj, json: obj ? JSON.stringify(obj) : '' };
  });
  return byKey;
}
function tombstones_(ctx) { // {"kind|key": row}, or true for one written during this push
  if (!ctx.memo.tombs) {
    const m = dict_();
    readIndex_(ctx, 'deleted').forEach(function (r) { m[r.kind + '|' + r.key] = r.row; });
    ctx.memo.tombs = m;
  }
  return ctx.memo.tombs;
}

// ---------- validation: every inbound (and stored) entity passes through one of these ----------
function listIds_(list, now) { // drop entries without a usable id, and repeated ids
  const seen = dict_();
  return list.filter(function (i) {
    if (!FORMAT.uid.test(i.id) || seen[i.id]) return false;
    seen[i.id] = true; i.at = clampStamp_(i.at, now);
    return true;
  });
}
function normTask_(raw, now) {
  if (!isObj_(raw)) return null;
  const t = shape_(TASK, raw);
  if (!FORMAT.uid.test(t.uid) || !isDay_(t.date)) return null;
  ['pStart', 'pStop', 'checkIn', 'aStart', 'aStop'].forEach(function (k) { if (!FORMAT.time.test(t[k])) t[k] = ''; });
  ['aLang', 'cLang'].forEach(function (k) { if (t[k] !== 'en' && t[k] !== 'es') t[k] = ''; });
  t.aLangs = langs_(raw.aLangs); t.cLangs = langs_(raw.cLangs);
  if (!FORMAT.uid.test(t.crewId)) t.crewId = '';
  t.memberIds = t.memberIds.map(function (id) { return FORMAT.uid.test(id) ? id : ''; }); // '' keeps the places: memberIds may run next to members
  ['assignAt', 'crewAt', 'replyAt', 'sentAt', 'resultAt'].forEach(function (k) { t[k] = clampStamp_(t[k], now); }); // never more than 5 minutes ahead
  t.items = listIds_(t.items, now); t.checks = listIds_(t.checks, now);
  // crewBase and assignBase: a part as the phone last had it from the hub, read like a task (one level deep) and never stored
  ['crewBase', 'assignBase'].forEach(function (k) { if (isObj_(raw[k])) t[k] = normTask_(Object.assign({ date: t.date }, raw[k], { crewBase: null, assignBase: null, uid: t.uid }), now); });
  return t;
}
// A task's short id as typed, kept only as a label: printable, at most 40 characters, never starting like a formula.
function taskLabel_(v) { return clip_(v.replace(/\s+/g, ' ').replace(/[^\p{L}\p{M}\p{N}\p{P}\p{S} ]/gu, '').replace(/^[\s=+\-@]+/, ''), 40).trim(); }
function normShift_(raw, now) {
  if (!isObj_(raw)) return null;
  const s = shape_(SHIFT, raw), seen = dict_(), linked = dict_();
  s.who = s.who.trim().slice(0, 60); s.crew = s.crew.trim().slice(0, 60);
  ['device', 'pid', 'crewId'].forEach(function (k) { if (!FORMAT.uid.test(s[k])) s[k] = ''; });
  // A task is linked by its uid; an older phone sends only the short id, which becomes {uid: '', id} and is dropped once
  // the same number is there with its uid (as taskLinks in shared.mjs does). One link per uid, one per bare number.
  const list = own_(raw, 'tasks') && Array.isArray(raw.tasks) ? raw.tasks.slice(0, MAX_LIST) : [];
  const links = shape_(SHIFT.tasks, list.map(function (x) { return typeof x === 'string' ? { uid: '', id: x } : x; })).map(function (x) {
    return { uid: FORMAT.uid.test(x.uid) ? x.uid : '', id: taskLabel_(x.id) };
  });
  links.forEach(function (x) { if (x.uid) linked[x.id] = true; });
  s.tasks = links.filter(function (x) {
    const k = x.uid || '#' + x.id;
    if (k === '#' || seen[k] || (!x.uid && linked[x.id])) return false;
    seen[k] = true;
    return true;
  }).slice(0, 50);
  ['in', 'out'].forEach(function (k) { if (!FORMAT.time.test(s[k])) s[k] = ''; });
  s.at = clampStamp_(s.at, now);
  s.pmAt = clampStamp_(raw.pmAt, now); // the hub's own merge stamp for PM edits (mergeShift_); phones do not keep it
  if (isObj_(raw.base)) s.base = normShift_(Object.assign({}, raw.base, { id: s.id, base: null }), now); // a PM push's base: read like a shift, never stored
  return FORMAT.uid.test(s.id) && isDay_(s.date) && s.in ? s : null; // no id, day or clock-in: nothing to log
}
function normReport_(raw, now) {
  if (!isObj_(raw)) return null;
  const r = shape_(REPORT, raw);
  if (!isDay_(r.date)) return null;
  if (REPORT_STATUS.indexOf(r.status) < 0) r.status = '';
  ['lang', 'pmLang'].forEach(function (k) { if (r[k] !== 'en' && r[k] !== 'es') r[k] = ''; });
  ['submittedAt', 'updatedAt', 'pmAt'].forEach(function (k) { r[k] = clampStamp_(r[k], now); });
  // supBase, pmBase: the superintendent part and the PM part as the phone last had them from the hub, read like a report and never stored; null: it never had one
  ['supBase', 'pmBase'].forEach(function (k) { if (isObj_(raw[k])) r[k] = normReport_(Object.assign({}, raw[k], { date: r.date, supBase: undefined, pmBase: undefined }), now); else if (raw[k] === null) r[k] = null; });
  return r;
}
function normConfig_(raw, now) {
  if (!isObj_(raw)) return null;
  const c = shape_(CONFIG, raw), crews = dict_(), people = dict_();
  if (c.pin !== '' && !FORMAT.pin.test(c.pin)) return null;
  // Ids are who people and crews are (a rename keeps them). A crew from an older phone has none yet: '' until it gets one.
  c.crews.forEach(function (x) { if (!FORMAT.uid.test(x.id) || crews[x.id]) x.id = ''; else crews[x.id] = true; });
  c.people = c.people.filter(function (p) {
    p.name = p.name.trim().slice(0, 60);
    if (!FORMAT.uid.test(p.crewId)) p.crewId = '';
    if (!FORMAT.uid.test(p.id) || people[p.id]) return false; // a person with no usable id, or someone else's, is dropped
    people[p.id] = true;
    return true;
  });
  c.at = clampStamp_(c.at, now);
  return c;
}

// ---------- merge rules: one writer per field; a part is replaced only by a newer-or-equal stamp ----------
function structure_(incoming, stored) { // the office decides which items exist; done and at stay as the crew left them
  return incoming.map(function (i) {
    const s = stored.find(function (x) { return x.id === i.id; });
    return { id: i.id, text: i.text, done: s ? s.done : false, at: s ? s.at : 0 };
  });
}
// A crew value the phone sends goes in: with no base, always (its newer stamp took the whole part); with a base, only when
// the phone changed it since then, and the stored value is still the base's or the phone's stamp is the newer one.
function takes_(base, newer, mine, was, cur) { const j = JSON.stringify; return !base || (j(mine) !== j(was) && (newer || j(cur) === j(was))); }
// A list the same way (a sheet's steps, the roster, floors): entries the phone added, removed or changed since its base go
// in, field by field as above; the stored list's other entries (another phone's adds and edits) stay, and one another phone
// removed stays removed. Entries match by key_. Without a base the phone's list is taken whole.
function key_(x) { return isObj_(x) ? x.id || '#' + nameKey_(x.name) : String(x); } // an id; a crew from an older phone by name; a floor or check as itself
function list3_(stored, mine, base, newer) {
  if (!base) return mine;
  const by = function (l) { const m = dict_(); l.forEach(function (x) { m[key_(x)] = x; }); return m; }, S = by(stored), B = by(base);
  const out = mine.filter(function (x) { return !(B[key_(x)] !== undefined && S[key_(x)] === undefined); }).map(function (x) {
    const b = B[key_(x)], s = S[key_(x)], o = isObj_(x) && b !== undefined && s !== undefined ? clone_(s) : x;
    if (o !== x) Object.keys(x).forEach(function (f) { if (takes_(base, newer, x[f], b[f], s[f])) o[f] = x[f]; });
    return o;
  });
  const placed = by(out);
  let at = 0;
  stored.forEach(function (x) { // another phone's additions, each after the entry it followed
    const k = key_(x);
    if (placed[k] !== undefined) at = out.indexOf(placed[k]) + 1; else if (B[k] === undefined) out.splice(at++, 0, x);
  });
  return out;
}
function map3_(stored, mine, base, newer) { // a text-language map key by key the same way: each text keeps the language of the phone whose words it has
  if (!base) return mine;
  const out = langs_(stored);
  Object.keys(mine).concat(Object.keys(base)).forEach(function (k) { if (takes_(base, newer, mine[k], base[k], stored[k])) { if (mine[k]) out[k] = mine[k]; else delete out[k]; } });
  return out;
}
function ticks_(stored, incoming, base, newer) { // the crew ticks items that exist; it cannot add, remove or reword one
  return stored.map(function (s) {
    const i = incoming.find(function (x) { return x.id === s.id; }), b = base && (base.find(function (x) { return x.id === s.id; }) || { done: false, at: 0 });
    return i && takes_(base, newer, [i.done, i.at], b && [b.done, b.at], [s.done, s.at]) ? { id: s.id, text: s.text, done: i.done, at: i.at } : s;
  });
}

// Task. A crew key only ever reaches the crew part. An office key writes both parts, but a part belonging to
// the other role needs a strictly newer stamp, so a tie can never wipe results typed on a crew phone.
// A phone sends only the part it changed, so a part with stamp 0 was not sent: it never replaces an existing one.
function mergeTask_(ctx, stored, inc) {
  const office = ctx.role !== 'crew';
  if (!stored && !office) return { reason: 'forbidden' }; // only the office creates a task
  const t = stored ? clone_(stored) : shape_(TASK, { uid: inc.uid }), was = stored ? clone_(stored) : null;
  // Two office phones (assignBase) or two phones on one crew (crewBase): with a base only what this phone changed goes over
  // the stored part, so neither wipes the other's edits; a field or step both changed goes to the newer stamp. Without
  // one, the newer stamp takes the whole part.
  const anew = inc.assignAt > 0 && inc.assignAt >= t.assignAt, abase = stored && inc.assignAt > 0 ? inc.assignBase : null;
  if (office && (!stored || anew || abase)) {
    const langs = map3_(t.aLangs, inc.aLangs, abase && abase.aLangs, anew); // key by key, not as one field
    ASSIGN.concat(OFFICE_EXTRA).forEach(function (k) { if (takes_(abase, anew, inc[k], abase && abase[k], t[k])) t[k] = inc[k]; });
    t.aLangs = langs;
    t.items = structure_(list3_(t.items, inc.items, abase && abase.items, anew), t.items); t.checks = structure_(list3_(t.checks, inc.checks, abase && abase.checks, anew), t.checks);
    t.assignAt = Math.max(t.assignAt, inc.assignAt);
  }
  const newer = ctx.role === 'crew' ? inc.crewAt > 0 && inc.crewAt >= t.crewAt : inc.crewAt > t.crewAt, base = stored && inc.crewAt > 0 ? inc.crewBase : null;
  if (newer || base) {
    const langs = map3_(t.cLangs, inc.cLangs, base && base.cLangs, newer);
    CREW.forEach(function (k) { if (takes_(base, newer, inc[k], base && base[k], t[k])) t[k] = inc[k]; });
    t.cLangs = langs;
    t.items = ticks_(t.items, inc.items, base && base.items, newer); t.checks = ticks_(t.checks, inc.checks, base && base.checks, newer);
    t.crewAt = Math.max(t.crewAt, inc.crewAt);
  }
  // An event points at the sheet by uid (short ids can collide); its text names the short id people read.
  const name = t.id || t.uid, ref = t.uid, ev = [];
  if (!was) ev.push(['task.created', t.by, 'New task ' + name + (t.crew ? ' for ' + t.crew : '') + (t.floor ? ', ' + t.floor : ''), ref]);
  if (t.aStart && !(was && was.aStart)) ev.push(['task.started', t.lead || t.crew, (t.crew || 'Crew') + ' started ' + name + ' at ' + t12_(t.aStart), ref]);
  if (['Complete', 'Partial', 'Blocked'].indexOf(t.status) >= 0 && !(was && was.status === t.status)) ev.push(['task.status', t.lead || t.crew, name + ' marked ' + t.status, ref]);
  if (t.review && !(was && was.review === t.review)) ev.push(['task.reviewed', t.reviewer, name + ' reviewed: ' + t.review, ref]);
  if (t.reply && !(was && was.reply === t.reply && was.replyAt === t.replyAt)) ev.push(['task.replied', t.replyBy, 'Message sent on ' + name, ref]);
  ev.forEach(function (e) { e.push(name); }); // the Activity tab's Ref cell shows the short id
  return { obj: t, events: ev };
}

// Shift. Worker rules for a phone's own plain shift (any key); PM rules for everything the PM touches.
// The phone is ctx.dev, proven by its devSecret: the device a request or a shift claims never picks whose shifts it writes.
const noEdits_ = { who: false, in: false, out: false };
function edited_(s) { return s.edited.who || s.edited.in || s.edited.out; }
function mergeShift_(ctx, stored, inc) {
  const plain = ctx.dev !== '' && inc.device === ctx.dev && !inc.gone && !edited_(inc), base = stored && inc.base;
  delete inc.base; // read, never stored
  const ev = [], line = function (verb, s) { return verb + ' ' + (s.who || 'a worker') + ', ' + s.date; };
  let s;
  if (ctx.role !== 'pm' || plain) { // worker rules
    if (ctx.dev === '') return { reason: 'device' };                       // no device secret: no phone to speak for
    if (inc.device === '') return { reason: 'forbidden' };                 // a PM-added shift is the PM's alone
    if (stored && stored.device !== ctx.dev) return { reason: 'device' };  // a key only speaks for the phone it came from
    if (!stored) { // added even when the PM has entered that day by hand: these are the real punches, for the PM to see and settle
      s = Object.assign({}, inc, { device: ctx.dev, edited: clone_(noEdits_), gone: false, pmAt: 0 }); // the client never sets edited, gone or pmAt for itself
      ev.push([inc.out ? 'clock.out' : 'clock.in', s.who, s.who + (inc.out ? ' clocked out at ' + t12_(s.out) : ' clocked in at ' + t12_(s.in)) + ', ' + s.date, s.id]);
    } else {
      s = clone_(stored);
      if (!s.gone) { // a removed shift is never revived
        if (!s.edited.who && inc.at > s.at) { s.who = inc.who; s.at = inc.at; } // an older text keeps the newer name
        if (!s.edited.in) s.in = inc.in;
        if (!s.edited.out && inc.out) s.out = inc.out;                            // and never undoes a clock-out
        if (!edited_(s)) ['pid', 'crew', 'crewId', 'tasks'].forEach(function (k) { s[k] = inc[k]; }); // once the PM has touched a shift, these stay
        if (s.out && !stored.out) ev.push(['clock.out', s.who, s.who + ' clocked out at ' + t12_(s.out) + ', ' + s.date, s.id]);
      }
    }
  } else { // PM rules
    // pmAt orders two PM devices (the PM phone's edit stamp). base: the shift as that PM phone last had it from the hub. With
    // it only what the phone changed since goes in, a time with its edited flag, as with a sheet's assignBase: a fix on the
    // laptop and one on the phone both stand, a value both changed goes to the newer pmAt, and a phone that has not pulled a
    // clock-out or a newer name yet changes neither. Without one the newer pmAt takes the whole shift, with two guards.
    const newer = !stored || inc.pmAt >= stored.pmAt;
    if (base) {
      s = clone_(stored);
      ['who', 'in', 'out'].forEach(function (f) { if (takes_(base, newer, [inc[f], inc.edited[f]], [base[f], base.edited[f]], [s[f], s.edited[f]])) { s[f] = inc[f]; s.edited[f] = inc.edited[f]; } });
      ['pid', 'crew', 'crewId', 'tasks', 'date', 'gone'].forEach(function (k) { if (takes_(base, newer, inc[k], base[k], s[k])) s[k] = inc[k]; });
    } else if (newer) {
      s = clone_(inc);
      if (stored) {
        s.device = stored.device;                                    // a shift never changes phones
        if (!s.out && !s.edited.out && stored.out) s.out = stored.out; // a PM phone that has not pulled the clock-out yet must not erase it
        if (!s.edited.who && stored.at > inc.at) s.who = stored.who;   // nor undo a newer name from the worker's phone
      }
    } else s = clone_(stored);
    if (stored) { s.at = Math.max(stored.at, inc.at); s.pmAt = Math.max(stored.pmAt, inc.pmAt); }
    ev.push([stored ? (s.gone && !stored.gone ? 'pm.remove' : 'pm.edit') : 'pm.add', 'PM',
      line(!stored ? 'PM added a shift for' : s.gone && !stored.gone ? 'PM removed a shift for' : 'PM edited', s), s.id]);
  }
  return { obj: s, events: ev };
}

// A report's superintendent part three ways (supBase), as takes_ and list3_ do a sheet's assignBase: a value this phone
// changed since its base goes over the stored one; list entries match by their first field (needs by item, decisions by
// question, floors by floor and a floor's crews by name, next steps by step, risks by risk; the nth of a repeated one to the
// nth) and merge the same way; another phone's added entries stay, and so does an entry one phone took out and the other
// changed. ponytail: an entry renamed on one phone and edited on another becomes two entries; nothing typed is lost.
const SUPER_PART = (function () { const t = clone_(REPORT); ['date', 'updatedAt', 'pmReview', 'pmLang', 'pmAt'].forEach(function (k) { delete t[k]; }); t.decisions = [{ q: 't', rec: 't', by: 's' }]; return t; })();
function merge3_(tpl, s, m, b, newer) {
  if (!isObj_(tpl) && !Array.isArray(tpl)) return takes_(true, newer, m, b, s) ? m : s;
  const o = {};
  if (!Array.isArray(tpl)) { Object.keys(tpl).forEach(function (k) { o[k] = merge3_(tpl[k], s[k], m[k], b[k], newer); }); return o; }
  const j = function (x) { return JSON.stringify(shape_(tpl[0], x)); }; // the template's fields only: a decision's PM answer is not the superintendent's part
  const f = Object.keys(tpl[0])[0], keys = function (l) { const n = dict_(); return l.map(function (x) { const t = String(x[f]); n[t] = (n[t] || 0) + 1; return t + '\n' + n[t]; }); };
  const ks = keys(s), kb = keys(b), out = [], put = dict_();
  keys(m).forEach(function (k, i) {
    const si = ks.indexOf(k), bi = kb.indexOf(k);
    if (si < 0 && bi >= 0 && j(m[i]) === j(b[bi])) return; // another phone took it out, and this one did not change it
    out.push(put[k] = si < 0 ? m[i] : merge3_(tpl[0], s[si], m[i], bi < 0 ? shape_(tpl[0], {}) : b[bi], newer));
  });
  let at = 0;
  s.forEach(function (x, i) { // another phone's entries, each after the one it followed; one this phone took out stays out unless the other changed it
    const k = ks[i], bi = kb.indexOf(k);
    if (put[k]) at = out.indexOf(put[k]) + 1; else if (bi < 0 || j(x) !== j(b[bi])) out.splice(at++, 0, x);
  });
  return out;
}

// Report. The superintendent owns everything except the PM's decision answers and review.
// supBase (HUB.md, Report): with it only what this phone changed since goes in (merge3_), so the PM typing one line never
// wipes the superintendent's report; null is a phone that never had the hub's copy, so everything it has, it added.
// Without it the newer stamp takes the whole part.
function mergeReport_(ctx, stored, inc) {
  if (ctx.role === 'crew') return { reason: 'forbidden' };
  const r = stored ? clone_(stored) : shape_(REPORT, { date: inc.date }), was = stored ? clone_(stored) : null, pm = ctx.role === 'pm';
  const newer = pm ? inc.updatedAt > r.updatedAt : inc.updatedAt > 0 && inc.updatedAt >= r.updatedAt;
  const base = stored && inc.updatedAt > 0 && inc.supBase !== undefined ? inc.supBase || shape_(REPORT, { date: inc.date }) : null;
  if (!stored || newer || base) {
    const answers = r.decisions, sup = base ? merge3_(SUPER_PART, r, inc, base, newer) : inc;
    Object.keys(SUPER_PART).forEach(function (k) { if (k !== 'decisions') r[k] = sup[k]; });
    r.updatedAt = Math.max(r.updatedAt, inc.updatedAt);
    const kept = sup.decisions.map(function (d) {
      const a = d.q ? answers.find(function (x) { return x.q === d.q; }) : null;
      return { q: d.q, rec: d.rec, by: d.by, pm: a ? a.pm : '', pmNote: a ? a.pmNote : '' };
    });
    // An answer is never dropped, unless the phone had it (its base's pmAt, the PM part it last had) and took its question out or reworded it.
    // ponytail: by the whole PM part's stamp; an answer to any question since keeps every answered one this push left out, for the next edit.
    if (!base || base.pmAt < r.pmAt) answers.forEach(function (a) { if ((a.pm || a.pmNote) && !kept.some(function (k) { return k.q === a.q; })) kept.push(a); });
    r.decisions = kept;
  }
  // pmBase the same way for the PM part: only the answers (by question) and the review this PM device changed since go in,
  // so a PM phone and a PM laptop answering different decisions both stand; one both changed goes to the newer pmAt.
  const pnew = inc.pmAt >= r.pmAt, pbase = stored && inc.pmAt > 0 && inc.pmBase !== undefined ? inc.pmBase || shape_(REPORT, { date: inc.date }) : null;
  if (pm && (inc.pmAt > 0 || !stored) && (pnew || pbase)) {
    const none = { pm: '', pmNote: '' }, part = function () { return JSON.stringify([r.decisions, r.pmReview, r.pmLang]); }, before = part();
    inc.decisions.forEach(function (d) {
      const m = d.q ? r.decisions.find(function (x) { return x.q === d.q; }) : null, s = m || none;
      const b = pbase && ((d.q && pbase.decisions.find(function (x) { return x.q === d.q; })) || none);
      if (!takes_(pbase, pnew, [d.pm, d.pmNote], b && [b.pm, b.pmNote], [s.pm, s.pmNote])) return;
      if (m) { m.pm = d.pm; m.pmNote = d.pmNote; } else if (d.pm || d.pmNote) r.decisions.push({ q: d.q, rec: d.rec, by: d.by, pm: d.pm, pmNote: d.pmNote });
    });
    ['pmReview', 'pmLang'].forEach(function (k) { if (takes_(pbase, pnew, inc[k], pbase && pbase[k], r[k])) r[k] = inc[k]; });
    // pmAt is the PM part's version: it moves past the stored one whenever the PM part changes, also by an older-stamped
    // answer from a second PM device, so a supBase.pmAt from before that merge reads as not having seen it (GATE2-DATA-02)
    r.pmAt = Math.max(r.pmAt + (part() !== before ? 1 : 0), inc.pmAt);
  }
  const ev = r.submittedAt > (was ? was.submittedAt : 0) ? [['report.sent', r.super, 'Daily report for ' + r.date + ' sent' + (r.super ? ' by ' + r.super : ''), r.date]] : [];
  return { obj: r, events: ev };
}

// ---------- push ----------
const PUSH_KINDS = {
  tasks: { norm: normTask_, key: function (o) { return o.uid; }, rawKey: 'uid', merge: mergeTask_, row: taskRow_, out: 'task', horizon: 'ARCHIVED_BEFORE' },
  shifts: { norm: normShift_, key: function (o) { return o.id; }, rawKey: 'id', merge: mergeShift_, row: shiftRow_, out: 'shift', horizon: 'ARCHIVED_HOURS' },
  reports: { norm: normReport_, key: function (o) { return o.date; }, rawKey: 'date', merge: mergeReport_, row: reportRow_, out: 'report', horizon: 'ARCHIVED_BEFORE' },
};
function echoKey_(K, raw) { // a key is echoed only when it has a safe format; invalid input is never reflected back
  const v = isObj_(raw) ? raw[K.rawKey] : '';
  return typeof v === 'string' && (K.rawKey === 'date' ? FORMAT.date : FORMAT.uid).test(v) ? v : '';
}

function pushKind_(ctx, b, name, list) {
  const K = PUSH_KINDS[name], res = [];
  const prep = list.map(function (raw, i) {
    if (JSON.stringify(raw === undefined ? null : raw).length > MAX_ENTITY) return { i: i, key: echoKey_(K, raw), reason: 'too_large' };
    const n = K.norm(raw, ctx.now);
    return n ? { i: i, n: n, key: K.key(n) } : { i: i, key: '', reason: 'invalid' };
  });
  const good = prep.filter(function (p) { return p.n; });
  const byKey = good.length ? loadEntries_(ctx, name, K.norm, good.map(function (p) { return p.key; })) : dict_();
  prep.forEach(function (p) {
    const rej = function (reason) { res.push({ i: p.i, key: p.key, status: 'rejected', reason: reason }); };
    if (!p.n) return rej(p.reason);
    const entry = byKey[p.key] || (byKey[p.key] = { row: 0, rev: 0, obj: null, json: '' });
    // A purged record is never revived by a stale phone. A report is its day: one sent by a phone that never had the cleared
    // copy (supBase null) is that day's new report, and its tombstone goes, so a phone that missed the clear does not remove it.
    const tk = name + '|' + p.key, tomb = (!entry.obj || ctx.memo.tombs) && tombstones_(ctx)[tk];
    const fresh = tomb && tomb !== true && name === 'reports' && p.n.supBase === null && p.n.updatedAt > 0;
    if (tomb && !fresh) return rej('deleted');
    const horizon = ctx.system ? '' : ctx.P[K.horizon] || '';
    if (horizon && [p.n.date, entry.obj && entry.obj.date].some(function (d) { return d && d < horizon; })) return rej('archived');
    const r = K.merge(ctx, entry.obj, p.n);
    if (r.reason) return rej(r.reason);
    if (JSON.stringify(r.obj).length > MAX_CELL) return rej('too_large');
    if (fresh) { delRow_(b, 'deleted', tomb); delete tombstones_(ctx)[tk]; }
    if (save_(ctx, b, name, entry, r.obj, K.row)) {
      r.events.forEach(function (e) { addEvent_(ctx, b, e[0], e[1], e[2], e[3], e[4]); });
      if (name === 'shifts') b.hours = true;
    }
    const o = clone_(entry.obj), item = { i: p.i, key: p.key, status: 'ok' };
    o.rev = entry.rev; item[K.out] = o;
    res.push(item);
  });
  return res;
}

function pushConfig_(ctx, b, raw) {
  if (ctx.role === 'crew') return { configStatus: 'rejected', configReason: 'forbidden' };
  let n = JSON.stringify(raw).length > MAX_ENTITY ? null : normConfig_(raw, ctx.now);
  if (!n) return { configStatus: 'rejected', configReason: 'invalid' };
  // Config has no stamp in the contract: an optional `at` orders two office phones, otherwise the last push wins.
  n.at = n.at || ctx.now;
  const entry = loadEntries_(ctx, 'config', normConfig_, ['config']).config || { row: 0, rev: 0, obj: null, json: '' };
  if (entry.obj) keepRoster_(n, entry.obj, raw);
  // base: the settings as this phone last had them from the hub. With it only what the phone changed since goes in, as with
  // a sheet's assignBase: two office phones adding people at once both keep theirs.
  const s = entry.obj, base = s && isObj_(raw.base) ? normConfig_(raw.base, ctx.now) : null, newer = !s || n.at >= s.at;
  if (base) {
    const m = clone_(s);
    Object.keys(CONFIG).forEach(function (k) { if (k !== 'at') m[k] = Array.isArray(m[k]) ? list3_(m[k], n[k], base[k], newer) : takes_(base, newer, n[k], base[k], m[k]) ? n[k] : m[k]; });
    m.at = Math.max(s.at, n.at);
    n = m;
  }
  const roster = function (c) { return JSON.stringify(c ? [c.people, c.crews] : [[], []]); }, was = roster(s);
  if ((newer || base) && save_(ctx, b, 'config', entry, n, configRow_) && roster(n) !== was) b.hours = true; // Weekly totals show the roster's names
  const c = clone_(entry.obj);
  c.rev = entry.rev;
  return { config: c, configStatus: 'ok' };
}

// A phone on an older version knows no roster and no crew ids. Its config never wipes them: with no people list the
// stored people stay, and a crew that arrives without an id takes the stored id of the crew with that name (unless
// another crew in the push already has it). Its other edits (project, floors, leads, a new crew) still apply.
function keepRoster_(n, stored, raw) {
  if (!Array.isArray(raw.people)) n.people = clone_(stored.people);
  const taken = dict_();
  n.crews.forEach(function (c) { if (c.id) taken[c.id] = true; });
  n.crews.forEach(function (c) {
    const k = nameKey_(c.name);
    if (c.id || !k) return;
    const s = stored.crews.filter(function (x) { return x.id && !taken[x.id] && nameKey_(x.name) === k; })[0];
    if (s) { c.id = s.id; taken[s.id] = true; }
  });
}

function push_(ctx) {
  const r = ctx.req, b = newBatch_(), out = {};
  const lists = { tasks: arr_(r.tasks), shifts: arr_(r.shifts), reports: arr_(r.reports), deleted: arr_(r.deleted) };
  Object.keys(lists).forEach(function (k) { if (lists[k].length > MAX_PER_KIND) fail_('too_large'); });
  if (r.config !== undefined && r.config !== null && !isObj_(r.config)) fail_('bad_request');
  out.deleted = deleteMany_(ctx, b, lists.deleted); // first, so a purged key cannot be written back in the same push
  out.tasks = pushKind_(ctx, b, 'tasks', lists.tasks);
  out.shifts = pushKind_(ctx, b, 'shifts', lists.shifts);
  out.reports = pushKind_(ctx, b, 'reports', lists.reports);
  if (isObj_(r.config)) Object.assign(out, pushConfig_(ctx, b, r.config));
  flush_(ctx, b);
  if (b.hours) rewriteWeekly_(ctx);
  out.rev = ctx.state.rev;
  return out;
}

// ---------- delete (purge) ----------
function deleteMany_(ctx, b, list) {
  return list.map(function (d, i) {
    const name = isObj_(d) && typeof d.kind === 'string' && own_(KINDS, d.kind) ? KINDS[d.kind] : '';
    const key = name && typeof d.key === 'string' && (name === 'reports' ? FORMAT.date : FORMAT.uid).test(d.key) ? d.key : '';
    if (!name || !key) return { i: i, kind: name, key: '', status: 'rejected', reason: 'invalid' };
    if (ctx.role !== 'pm') return { i: i, kind: name, key: key, status: 'rejected', reason: 'forbidden' };
    deleteEntity_(ctx, b, name, key);
    return { i: i, kind: name, key: key, status: 'ok' };
  });
}
// Remove the row (readable cells and data are the same row) and leave a tombstone so phones drop it too.
function deleteEntity_(ctx, b, name, key, quiet) {
  const idx = ctx.memo['idx:' + name] || (ctx.memo['idx:' + name] = readIndex_(ctx, name));
  idx.filter(function (r) { return r.key === key; }).forEach(function (r) { delRow_(b, name, r.row); });
  if (name === 'shifts') b.hours = true;
  if (quiet) return;
  const tombs = tombstones_(ctx), k = name + '|' + key, at = tombs[k];
  if (at === true) return; // already handled in this push
  const values = [key, name, nextRev_(ctx), stampText_(ctx.now)];
  if (at) b.upd.push({ range: rowRange_('deleted', at), values: [values] }); else appendRow_(ctx, b, 'deleted', values);
  tombs[k] = true;
  addEvent_(ctx, b, 'purge', 'PM', 'Deleted ' + name.slice(0, -1) + ' ' + key, key);
}
function delRow_(b, name, row) { (b.del[name] = b.del[name] || []).push(row); }
function pruneTombstones_(ctx, b) { // tombstones live 90 days
  const cutoff = ctx.now - TOMBSTONE_DAYS * 864e5, t = TABS.deleted;
  const vr = apiValuesGet_(ctx.id, a1_(t, 0, 2, 3));
  (vr.values || []).forEach(function (r, i) { const ms = Date.parse(String(r[3] || '').replace(' ', 'T')); if (r[0] && ms < cutoff) delRow_(b, 'deleted', i + 2); });
}

// ---------- weekly totals: rewritten from the Hours tab after every shift write and every roster change ----------
// Config cells [key, rev, data] -> {person id: the name Weekly totals show}: the roster's current name, and the crew too
// when two people share that name.
function names_(ctx, rows) {
  const out = dict_(), crew = dict_(), count = dict_(), row = rows.filter(function (r) { return cellText_(r[0]) === 'config'; })[0];
  const c = row ? normConfig_(parseCell_(cellText_(row[2])), ctx.now) : null;
  if (!c) return out;
  c.crews.forEach(function (x) { if (x.id) crew[x.id] = x.name; });
  c.people.forEach(function (p) { const k = nameKey_(p.name); count[k] = (count[k] || 0) + 1; });
  c.people.forEach(function (p) { if (p.name) out[p.id] = p.name + (count[nameKey_(p.name)] > 1 && crew[p.crewId] ? ' (' + crew[p.crewId] + ')' : ''); });
  return out;
}
function configCells_() { const t = TABS.config; return a1_(t, t.key, 2, t.data); }
// Hours rows (every column, data last) -> Weekly totals rows: Name, Week of, Hours, Shifts, Open shifts. One row per person
// per week: by person id when the shift has one (a rename keeps it, a shared name does not merge two people), else by the
// name however it was typed. The label is the roster's current name for that id, else the first spelling seen.
function weeklyRows_(hours, names) {
  const m = dict_();
  hours.forEach(function (r) {
    const who = cellText_(r[0]), week = cellText_(r[1]), note = cellText_(r[8]), d = parseCell_(cellText_(r[TABS.shifts.data]));
    if (!week || note === 'Removed') return;
    const pid = d && typeof d.pid === 'string' && FORMAT.uid.test(d.pid) ? d.pid : '';
    const k = week + '|' + (pid ? '#' + pid : nameKey_(who)); // a name key never starts with '#'
    const g = m[k] || (m[k] = { who: names[pid] || who || 'Name not set', week: week, cents: 0, n: 0, open: 0 });
    g.n++;
    if (note === 'No clock-out') g.open++; else g.cents += Math.round(Number(r[6]) * 100) || 0;
  });
  return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) {
    const x = a.who.toLowerCase(), y = b.who.toLowerCase();
    return a.week < b.week ? 1 : a.week > b.week ? -1 : x < y ? -1 : x > y ? 1 : 0;
  }).map(function (g) { return [g.who, g.week, g.cents / 100, g.n, g.open]; });
}
// ponytail: reads the whole Hours tab (with its data column) on every shift write, O(shifts); archive keeps it small.
// Upgrade: recompute only the person-weeks that changed.
function rewriteWeekly_(ctx) {
  const vr = apiValuesBatchGet_(ctx.id, [a1_(TABS.shifts, 0, 2, TABS.shifts.data), configCells_()]); // one request: hours and roster
  const rows = weeklyRows_(vr[0].values || [], names_(ctx, vr[1].values || []));
  apiValuesClear_(ctx.id, a1_(TABS.weekly, 0, 2, 4));
  for (let i = 0; i < rows.length; i += 200) apiValuesAppend_(ctx.id, rowRange_('weekly', 1), rows.slice(i, i + 200));
}

// ---------- pull ----------
const STALE_ = { stale: true };
function pull_(ctx) {
  const rev = ctx.state.rev;
  let since = Math.floor(Number(ctx.req.since)) || 0;
  if (since < 0 || since > rev) since = 0; // a phone ahead of the hub (a reset hub) takes everything again
  if (since && since === rev) return { rev: rev, now: ctx.now, same: true }; // the cheap path: nothing was written
  return retry_(function () { return pullOnce_(ctx, since); }, ctx);
}
function retry_(fn, ctx) { // rows moved under a read (a purge, an archive, a sorted tab): read the Sheet itself and go again
  for (let i = 0; i < 3; i++) {
    ctx.memo.last = i === 2; // the last try skips a row that still does not match, so one damaged row cannot take the hub down
    try { return fn(); } catch (e) { if (e !== STALE_) throw e; dropReads_(ctx); }
  }
  return fail_('busy');
}
function fetchEntities_(ctx, name, rows, norm, keyOf, keep) {
  const data = readData_(ctx, name, rows.map(function (x) { return x.row; })), list = [];
  rows.forEach(function (x) {
    const raw = data[x.row], o = raw ? norm(raw, ctx.now) : null;
    if (!o) return;
    if (keyOf(o) !== x.key) { if (ctx.memo.last) return; throw STALE_; }
    if (keep && !keep(o)) return;
    o.rev = x.rev; list.push(o);
  });
  return list;
}
// Which sheets a pull for these crew names gets. The names are looked up in the stored roster: a sheet whose crew id is
// a roster crew goes by that id, so a renamed crew keeps the sheets made under its old name and a new crew that took
// the old name does not get them. By name only where the id cannot tell: a sheet with no crew id or one the roster no
// longer has, or a name the roster does not know (a phone that has not heard of a rename yet).
// Answers true (these crews' sheet), false (another roster crew's: it moved there) or null (a name the roster does not know).
function crewSheets_(names, cfg) {
  const ids = dict_(), known = dict_(), named = dict_();
  let byId = false;
  (cfg ? cfg.crews : []).forEach(function (c) {
    if (c.name) named[c.name] = true;
    if (!c.id) return;
    known[c.id] = true;
    if (names.indexOf(c.name) >= 0) { ids[c.id] = true; byId = true; }
  });
  return function (t) { return byId && t.crewId && known[t.crewId] ? !!ids[t.crewId] : names.indexOf(t.crew) >= 0 || (named[t.crew] ? false : null); };
}
function pullOnce_(ctx, since) {
  const r = ctx.req, role = ctx.role, rev = ctx.state.rev, office = role !== 'crew', pm = role === 'pm';
  const days = Math.min(90, Math.max(1, Math.floor(Number(r.days)) || 14)), today = today_(), cutoff = addDays_(today, -days);
  const crews = Array.isArray(r.crews) ? r.crews.filter(function (c) { return typeof c === 'string'; }).slice(0, 50) : null;
  const out = { rev: rev, now: ctx.now, tasks: [], shifts: [], reports: [], events: [], deleted: [] };
  let limit = rev;
  const cut = function (list) { // at most 500 per list; a cut list lowers the rev the phone may claim, so the rest comes next pull
    list.sort(function (a, b) { return a.rev - b.rev; });
    if (list.length > MAX_LIST) { list.length = MAX_LIST; limit = Math.min(limit, list[MAX_LIST - 1].rev); }
    return list;
  };
  const fresh = function (rows) { return rows.filter(function (x) { return x.rev > since && x.date >= cutoff; }); };

  loadAllIndex_(ctx); // from the cache when another phone already pulled this revision
  // ponytail: with a crews filter every sheet in the window is read, because a sheet's crew id is only in its data
  // (the cache serves the rows after the first reader). Upgrade: a crew id column in the Tasks index.
  const taskRows = fresh(readIndex_(ctx, 'tasks'));
  const hoursIdx = readIndex_(ctx, 'shifts'), shiftRows = fresh(hoursIdx);
  const reportRows = office ? fresh(readIndex_(ctx, 'reports')) : [];
  const eventRows = office ? readIndex_(ctx, 'events').filter(function (x) { return x.rev > since; }).slice(since ? -100 : -50) : [];
  const openRows = office ? hoursIdx.filter(function (x) { return x.date >= addDays_(today, -1) && x.date <= today; }) : []; // who is on site now
  const cfgAll = readIndex_(ctx, 'config'), cfgRows = cfgAll.filter(function (x) { return x.rev > since; });
  prefetch_(ctx, { tasks: taskRows, shifts: shiftRows.concat(openRows), reports: reportRows, events: eventRows, config: crews ? cfgAll : cfgRows });
  const cfgOf = function (rows) { return fetchEntities_(ctx, 'config', rows, normConfig_, function () { return 'config'; })[0]; };

  const pid = typeof r.pid === 'string' && FORMAT.uid.test(r.pid) ? r.pid : ''; // the person a crew phone is: a sheet that lists them comes too, whatever its crew
  const listed = function (o) { return pid !== '' && o.memberIds.indexOf(pid) >= 0; };
  const crewKeep = crews && crewSheets_(crews, cfgOf(cfgAll)), keep = function (o) { return !crewKeep || crewKeep(o) === true || listed(o); };
  const sent = fetchEntities_(ctx, 'tasks', taskRows, normTask_, function (o) { return o.uid; }, function (o) { return office || o.sentAt > 0; }); // a crew key gets a sheet once it was sent, never a draft
  out.tasks = cut(sent.filter(keep));
  const mine = function (o) { return pm || (ctx.dev !== '' && o.device === ctx.dev); }; // crew and super see their own phone's hours only
  out.shifts = cut(fetchEntities_(ctx, 'shifts', shiftRows, normShift_, function (o) { return o.id; }, mine));
  if (office) {
    out.reports = cut(fetchEntities_(ctx, 'reports', reportRows, normReport_, function (o) { return o.date; }));
    out.events = fetchEntities_(ctx, 'events', eventRows, normEvent_, function (o) { return String(o.rev); });
    out.onsite = fetchEntities_(ctx, 'shifts', openRows, normShift_, function (o) { return o.id; }, function (o) {
      const st = startedMs_(o);
      return !o.gone && !o.out && ctx.now - st < OPEN_SHIFT_MS && st <= ctx.now + SKEW_MS;
    }).sort(function (a, b) { return startedMs_(a) - startedMs_(b); }).map(function (o) { // the person and crew by id, so two people with one name stay apart
      return { who: o.who, in: o.in, date: o.date, pid: o.pid, crewId: o.crewId, crew: o.crew };
    });
  }
  const cfg = cfgOf(cfgRows);
  if (cfg) out.config = cfg;
  // a sent sheet that changed and is now another crew's (moved there) leaves these crews' phones as a deleted one does,
  // marked moved: a phone keeps one it has work on that has not gone up, or got only by text (HUB.md, pull)
  const left = sent.filter(function (o) { return crewKeep && crewKeep(o) === false && !listed(o); }).map(function (o) { return { kind: 'tasks', key: o.uid, rev: o.rev, moved: true }; });
  out.deleted = cut(readIndex_(ctx, 'deleted').filter(function (x) { return x.rev > since && (office || x.kind !== 'reports'); })
    .map(function (x) { return { kind: x.kind, key: x.key, rev: x.rev }; }).concat(left));
  if (limit < rev) { out.rev = limit; out.more = true; }
  return out;
}

// ---------- translate (Google Translate through LanguageApp, HTML mode so identifiers survive) ----------
function ci_(w) { return w.replace(/[a-z]/gi, function (c) { return '[' + c.toLowerCase() + c.toUpperCase() + ']'; }); }
// What must not be translated: drawing / task / panel numbers (E-301, T1019-02, LP-1A), quantities with units
// (12 AWG, 3/4", 480V, 150 ft) and trade abbreviations. The leftmost match wins, so "12 AWG" stays one piece.
const PROTECT = new RegExp([
  '\\b[A-Z]{1,4}-?\\d+(?:[-.]\\d+)*[A-Z]?\\b',
  '\\b\\d+(?:[.,]\\d+)*(?:/\\d+)?(?:\\s?["\\u201d\\u2033\'\\u00b0%]|\\s?(?:' +
    ['inches', 'inch', 'feet', 'foot', 'ft', 'lf', 'ea', 'sf', 'awg', 'amps', 'amp', 'kva', 'kv', 'kw', 'hp', 'mm', 'cm', 'lbs', 'lb', 'psi', 'hz', 'gal', 'pcs', 'mcm', 'kcmil'].map(ci_).join('|') +
    ')\\b|\\s?[AVW]\\b|(?:in|m)\\b)',
  '\\b(?:EMT|AWG|MC|GFCI|AFCI|GFI|RMC|IMC|RGS|PVC|THHN|THWN|XHHW|NEC|UL|LED|VFD|MCC|MDP|ATS|UPS|PDU|MCM|KCMIL|AHJ|BAS|RFI)\\b',
].join('|'), 'g');
function html_(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r\n|\r|\n/g, '<br>'); }
function protect_(text) {
  const re = new RegExp(PROTECT.source, 'g');
  let out = '', last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }
    out += html_(text.slice(last, m.index)) + '<span translate="no">' + html_(m[0]) + '</span>';
    last = m.index + m[0].length;
  }
  return out + html_(text.slice(last));
}
function decode_(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, function (m, g) {
    const k = g.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    if (k === 'nbsp') return ' ';
    const n = k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  });
}
// Tags go first and entities after, so typed "<b>" (sent escaped) comes back as the same plain text.
function unprotect_(html) { return decode_(String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).trim(); }

function translateText_(text, from, to) {
  let out;
  try {
    out = LanguageApp.translate(protect_(text), from, to, { contentType: 'html' });
  } catch (err) { // Google's own daily limit says "too many times"; anything else is a server problem. Never echo either.
    fail_(/too many times|quota|limit/i.test(String(err && err.message)) ? 'quota' : 'server');
  }
  if (typeof out !== 'string') fail_('server');
  return unprotect_(out);
}
function reserveTranslations_(n) { // per UTC day, default 1,500 calls; the counter is written under the script lock
  const props = PropertiesService.getScriptProperties(), P = props.getProperties(), day = new Date().toISOString().slice(0, 10);
  const used = P.TR_DAY === day ? Number(P.TR_N) || 0 : 0, cap = Number(P.TR_CAP) > 0 ? Number(P.TR_CAP) : TR_CAP_DEFAULT;
  if (used + n > cap) fail_('quota');
  props.setProperties({ TR_DAY: day, TR_N: String(used + n) });
}
function translate_(ctx) {
  const r = ctx.req, items = r.items, langs = { en: 1, es: 1 };
  if (!Array.isArray(items) || !own_(langs, r.from) || !own_(langs, r.to)) fail_('bad_request');
  if (items.length > MAX_TR_ITEMS) fail_('too_large');
  items.forEach(function (t) {
    if (typeof t !== 'string') fail_('bad_request');
    if (t.length > MAX_TR_CHARS) fail_('too_large');
  });
  const same = r.from === r.to, key = function (t) { return 'tr:' + r.from + r.to + ':' + digestHex_(t); };
  const need = items.filter(function (t, i) { return !same && t.trim() !== '' && items.indexOf(t) === i; }); // each distinct text once
  const found = need.length ? cacheGetAll_(ctx.cache, need.map(key)) : {}, done = Object.create(null);
  let hits = 0;
  need.forEach(function (t) { const c = found[key(t)]; if (typeof c === 'string') done[t] = c; });
  const miss = need.filter(function (t) { return !(t in done); });
  if (miss.length) {
    withScriptLock_(20000, function () { reserveTranslations_(miss.length); }); // lock only for the counter, not for the slow calls
    const puts = {};
    miss.forEach(function (t) { done[t] = translateText_(t, r.from, r.to); puts[key(t)] = done[t]; });
    cachePutAll_(ctx.cache, puts, TR_CACHE_S);
  }
  const missed = dict_();
  miss.forEach(function (t) { missed[t] = true; });
  const out = items.map(function (t) {
    if (same || t.trim() === '') return t;
    if (!(t in missed)) hits++;
    return done[t];
  });
  const res = { items: out };
  if (hits) res.cached = hits;
  return res;
}

// ---------- records (browse what is older than a phone's window) ----------
const RECORD_KINDS = { task: 'tasks', tasks: 'tasks', shift: 'shifts', shifts: 'shifts', report: 'reports', reports: 'reports', event: 'events', events: 'events' };
function normEvent_(raw) { return shape_({ rev: 0, ts: 0, who: 's', role: 's', kind: 's', text: 't', ref: 's' }, raw); }
const RECORD_FIELDS = {
  tasks: { norm: normTask_, key: function (o) { return o.uid; }, who: function (o) { return [o.crew, o.lead, o.by, o.members.join(' ')].join(' '); } },
  shifts: { norm: normShift_, key: function (o) { return o.id; }, who: function (o) { return o.who; } },
  reports: { norm: normReport_, key: function (o) { return o.date; }, who: function (o) { return o.super + ' ' + o.preparedBy; } },
  events: { norm: normEvent_, key: function (o) { return String(o.rev); }, who: function (o) { return o.who; } },
};
function records_(ctx) {
  const r = ctx.req, name = typeof r.kind === 'string' && own_(RECORD_KINDS, r.kind) ? RECORD_KINDS[r.kind] : '';
  if (!name) fail_('bad_request');
  if (ctx.role === 'super' && name !== 'tasks' && name !== 'reports') fail_('forbidden'); // hours and the feed are the PM's
  if (!isDay_(r.from) || !isDay_(r.to) || r.from > r.to) fail_('bad_request');
  const text = function (v) { return typeof v === 'string' ? v.trim().toLowerCase().slice(0, 100) : ''; };
  const who = text(r.who), q = text(r.q), cursor = Math.floor(Number(r.cursor)) || 0, F = RECORD_FIELDS[name];
  const keep = function (o) { return (!who || F.who(o).toLowerCase().indexOf(who) >= 0) && (!q || JSON.stringify(o).toLowerCase().indexOf(q) >= 0); };
  return retry_(function () {
    const rows = readIndex_(ctx, name).filter(function (x) { return x.date >= r.from && x.date <= r.to && x.row >= cursor; });
    const items = [];
    let pos = 0;
    while (pos < rows.length && items.length < 200 && pos < 2000) { // pages are filled up to 200; a long quiet stretch returns early with a cursor
      const chunk = rows.slice(pos, pos + 200 - items.length);
      fetchEntities_(ctx, name, chunk, F.norm, F.key, keep).forEach(function (o) { items.push(o); });
      pos += chunk.length;
    }
    const out = { items: items };
    if (pos < rows.length) out.cursor = String(rows[pos].row);
    return out;
  }, ctx);
}

// ---------- the PM's housekeeping actions ----------
// HUB.md lists `kind, key`, but `key` is already the auth key of every request, so the record's key travels as
// `target` (id, entity, ref and uid are accepted too). A push can also carry `deleted:[{kind,key}]`.
function purge_(ctx) {
  const r = ctx.req, one = ['target', 'id', 'entity', 'ref', 'uid'].map(function (k) { return r[k]; }).filter(function (v) { return typeof v === 'string'; })[0];
  const t = isObj_(r.target) ? r.target : { kind: r.kind, key: one };
  const b = newBatch_(), res = deleteMany_(ctx, b, [t])[0];
  if (res.status !== 'ok') fail_('bad_request');
  pruneTombstones_(ctx, b);
  flush_(ctx, b);
  if (b.hours) rewriteWeekly_(ctx);
  return { rev: ctx.state.rev };
}
function stats_(ctx) {
  let cells = 0;
  apiGet_(ctx.id, 'sheets.properties(title,gridProperties)').sheets.forEach(function (s) { cells += s.properties.gridProperties.rowCount * s.properties.gridProperties.columnCount; });
  const names = ['tasks', 'shifts', 'reports', 'events'];
  const vr = apiValuesBatchGet_(ctx.id, names.map(function (n) { return a1_(TABS[n], TABS[n].key, 2, TABS[n].key); })), rows = {};
  names.forEach(function (n, i) { rows[n] = (vr[i].values || []).filter(function (r) { return r.length && r[0] !== ''; }).length; });
  return { rows: rows, cells: cells, cellLimit: CELL_LIMIT, sheetUrl: sheetUrl_(ctx.id) };
}
function keys_(ctx) { return { crew: ctx.P.CREW_KEY || '', super: ctx.P.SUPER_KEY || '' }; }
function rotate_(ctx) { // the old key stops working at once: every request reads the keys fresh
  const role = ctx.req.role;
  if (role !== 'crew' && role !== 'super') fail_('bad_request');
  const b = newBatch_();
  addEvent_(ctx, b, 'key.rotated', 'PM', (role === 'crew' ? 'Crew' : 'Superintendent') + ' key replaced', '');
  flush_(ctx, b);
  const key = newKey_();
  PropertiesService.getScriptProperties().setProperty(role === 'crew' ? 'CREW_KEY' : 'SUPER_KEY', key);
  return { key: key, rev: ctx.state.rev };
}

// Move rows older than `before` into a new archive spreadsheet, then delete them here. Copy first, delete after:
// a failure part way leaves rows in both places, never in neither. Hours move in whole weeks (Monday on or before
// the date) so a week's total is never split; a push for a record already archived is rejected as "archived".
function archive_(ctx) {
  const before = ctx.req.before;
  if (!isDay_(before) || before > today_()) fail_('bad_request');
  const hoursCut = monday_(before), cuts = { tasks: before, shifts: hoursCut, reports: before, events: before };
  const moved = { tasks: 0, shifts: 0, reports: 0, events: 0 }, plan = {};
  Object.keys(cuts).forEach(function (n) {
    plan[n] = readIndex_(ctx, n).filter(function (x) { return x.date && x.date < cuts[n]; }).map(function (x) { return x.row; });
    moved[n] = plan[n].length;
  });
  if (!moved.tasks && !moved.shifts && !moved.reports && !moved.events) return { sheetUrl: '', moved: moved };
  const names = ['tasks', 'shifts', 'weekly', 'reports', 'events'];
  const aid = apiCreate_(sheetSpec_(names, 'Schwab field hub archive, before ' + before)).spreadsheetId;
  formatTabs_({ memo: {} }, aid, names);
  let hours = [];
  Object.keys(plan).forEach(function (n) {
    const t = TABS[n], rs = runs_(plan[n]), copy = [];
    for (let i = 0; i < rs.length; i += 40) {
      const part = rs.slice(i, i + 40), vr = apiValuesBatchGet_(ctx.id, part.map(function (r) { return a1_(t, 0, r[0], t.head.length - 1, r[1]); }));
      vr.forEach(function (v) { (v.values || []).forEach(function (row) { copy.push(row); }); });
    }
    for (let i = 0; i < copy.length; i += 200) apiValuesAppend_(aid, rowRange_(n, 1), copy.slice(i, i + 200));
    if (n === 'shifts') hours = copy;
  });
  const wk = weeklyRows_(hours, names_(ctx, apiValuesGet_(ctx.id, configCells_()).values || []));
  for (let i = 0; i < wk.length; i += 200) apiValuesAppend_(aid, rowRange_('weekly', 1), wk.slice(i, i + 200));
  const b = newBatch_();
  Object.keys(plan).forEach(function (n) { plan[n].forEach(function (row) { delRow_(b, n, row); }); });
  pruneTombstones_(ctx, b);
  addEvent_(ctx, b, 'archive', 'PM', 'Archived ' + (moved.tasks + moved.shifts + moved.reports + moved.events) + ' rows older than ' + before, before);
  flush_(ctx, b);
  if (moved.shifts) rewriteWeekly_(ctx);
  const props = PropertiesService.getScriptProperties(), url = sheetUrl_(aid), list = JSON.parse(ctx.P.ARCHIVES || '[]');
  list.push({ url: url, before: before, at: ctx.now });
  props.setProperties({
    ARCHIVED_BEFORE: before > (ctx.P.ARCHIVED_BEFORE || '') ? before : ctx.P.ARCHIVED_BEFORE,
    ARCHIVED_HOURS: hoursCut > (ctx.P.ARCHIVED_HOURS || '') ? hoursCut : ctx.P.ARCHIVED_HOURS,
    ARCHIVES: JSON.stringify(list.slice(-20)),
  });
  return { sheetUrl: url, moved: moved };
}

// ---------- selftest: write, read, merge rules, translate a sentence with a drawing number, delete ----------
function selftest_(ctx) {
  const checks = [], uid = 'selftest-' + ctx.now.toString(36);
  const sub = function (role, dev) { return Object.assign({}, ctx, { role: role, dev: dev || '', system: true }); }; // shares rev and memo; writes no events
  const send = function (c, task) {
    const b = newBatch_(), r = pushKind_(c, b, 'tasks', [task])[0];
    flush_(c, b);
    forget();
    return r;
  };
  const forget = function () { Object.keys(ctx.memo).forEach(function (k) { delete ctx.memo[k]; }); }; // rows changed: forget what was read
  const read = function () {
    const rows = readIndex_(ctx, 'tasks').filter(function (x) { return x.key === uid; });
    const data = rows.length ? readData_(ctx, 'tasks', [rows[0].row])[rows[0].row] : null;
    return data ? normTask_(data, ctx.now) : null;
  };
  const step = function (name, fn) {
    try { const d = fn(); checks.push({ name: name, ok: d === true, detail: d === true ? 'ok' : 'failed' }); }
    catch (e) { checks.push({ name: name, ok: false, detail: e instanceof HubError_ ? e.code : 'error' }); }
  };
  const base = { uid: uid, id: 'SELFTEST', date: SELFTEST_DAY, scope: 'Selftest scope', crew: 'Crew X', items: [{ id: 'i1', text: 'Step one' }], assignAt: ctx.now - 2000 };
  step('write', function () { return send(sub('pm'), base).status === 'ok'; });
  step('read', function () { const t = read(); return !!t && t.scope === 'Selftest scope' && t.items.length === 1; });
  step('merge rules', function () {
    const crew = send(sub('crew', 'selftest-dev'), Object.assign({}, base, { scope: 'tampered', status: 'Partial', doneText: 'Done a bit', crewAt: ctx.now - 1000, items: [{ id: 'i1', text: 'reworded', done: true, at: 1 }] }));
    const a = read();
    const pm = send(sub('pm'), Object.assign({}, base, { scope: 'Selftest scope 2', assignAt: ctx.now - 500, crewAt: 0, status: '', doneText: '' }));
    const c = read();
    return crew.status === 'ok' && pm.status === 'ok' && !!a && !!c &&
      a.scope === 'Selftest scope' && a.status === 'Partial' && a.items[0].done === true && a.items[0].text === 'Step one' && // a crew key cannot change the assignment
      c.scope === 'Selftest scope 2' && c.status === 'Partial' && c.doneText === 'Done a bit' && c.items[0].done === true;       // and the office cannot erase crew results
  });
  step('translate', function () {
    reserveTranslations_(1); // the script lock is already held by this action
    const out = translateText_('Pull wire to E-301 on Level 3', 'en', 'es');
    return out.indexOf('E-301') >= 0 && !/[<>]|&lt;|&amp;/.test(out);
  });
  step('delete', function () {
    const b = newBatch_();
    deleteEntity_(ctx, b, 'tasks', uid, true);
    flush_(ctx, b);
    nextRev_(ctx); // rows moved up: a cached index of the old revision must not be used again
    forget();
    return read() === null;
  });
  return { checks: checks };
}
