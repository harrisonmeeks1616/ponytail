// Harrison OS data layer. The ONLY module that writes the core tables (feature modules may own SQL for their
// own tables and read core tables scope-bound, PLAN.md).
//
// Rules (CONTRACT.md):
// - Every read and write takes an explicit scope: 'work', 'personal' or 'all'. 'all' is accepted only by
//   getInbox, listForToday, listProjects, exportData, listPreferences and restoreData; everything else throws
//   ScopeError on it.
// - nowIso is always passed in; nothing here reads a clock.
// - Uses only D1 calls: prepare().bind().first()/all()/run() and batch(). Writes that must land together
//   go in one batch (atomic on D1 and in the test adapter).
// - FTS rows (fts_work / fts_personal) are kept in step by explicit statements here, not triggers.
// - Factual statuses are never upgraded here. claim_status changes only through an explicit user patch.
// - Errors and events never carry user text.
//
// System functions (reminder cron, deliveries, push subscriptions, kv, events) are at the bottom. They serve
// the cron and the spike-derived push routes, which are not per-scope by nature; each is marked SYSTEM.

import { zonedWallTimeToInstant, nextDailyOccurrence, instantToZonedParts } from './time.js';

// ---------------------------------------------------------------- errors

export class ScopeError extends Error {
  constructor(message = 'scope must be work or personal here') {
    super(message);
    this.name = 'ScopeError';
    this.code = 'scope_error';
  }
}

export class ConflictError extends Error {
  constructor(message = 'conflict', reason = 'conflict') {
    super(message);
    this.name = 'ConflictError';
    this.code = 'conflict';
    this.reason = reason;
  }
}

export class NotFoundError extends Error {
  constructor(message = 'not found') {
    super(message);
    this.name = 'NotFoundError';
    this.code = 'not_found';
  }
}

// A create or restore of an id that was deleted on purpose (tombstoned). Mapped to 410 gone.
export class GoneError extends Error {
  constructor(message = 'This was deleted and cannot be created again') {
    super(message);
    this.name = 'GoneError';
    this.code = 'gone';
  }
}

export class ValidationError extends Error {
  constructor(message = 'invalid input', field = null) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'invalid';
    this.field = field;
  }
}

// ---------------------------------------------------------------- constants

export const SCOPES = Object.freeze(['work', 'personal']);
const FTS_TABLE = Object.freeze({ work: 'fts_work', personal: 'fts_personal' });

export const ITEM_KINDS = Object.freeze(['task', 'waiting', 'reference', 'idea', 'decision']);
export const PROPOSAL_KINDS = Object.freeze(['task', 'waiting', 'reminder', 'reference', 'idea', 'decision']);
export const CLAIM_STATUSES = Object.freeze(['requested', 'proposed', 'confirmed', 'reported_complete', 'verified', 'unspecified']);
const PROJECT_STATES = ['active', 'done', 'archived'];
export const RECURRENCES = Object.freeze(['none', 'daily', 'weekdays', 'weekly', 'monthly']);
export const CAPTURE_SOURCES = Object.freeze(['app', 'shortcut', 'mcp', 'share']);
export const ATTACHMENT_MIMES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'text/plain']);
export const MAX_ATTACHMENT_BYTES = 1_000_000;
const DECISION_DETAIL_COLS = ['options_json', 'recommendation', 'assumptions', 'outcome', 'reconsider_when', 'decided_on'];

const ITEM_COLS = [
  'id', 'kind', 'scope', 'project_id', 'title', 'body', 'state', 'due_on', 'today_pick',
  'who', 'claim_status', 'claim_by', 'asked_on', 'promised_on', 'follow_up_on', 'reply_recorded_at',
  'supersedes_id', 'superseded_by_id', 'reason',
  'origin', 'source_capture_id', 'source_quote', 'source_deleted',
  'created_at', 'updated_at', 'done_at', 'sample',
  'recurrence', 'series_id', 'start_on', 'when_text', ...DECISION_DETAIL_COLS,
];
const ATTACHMENT_META_COLS = ['id', 'scope', 'capture_id', 'item_id', 'name', 'mime', 'size', 'sha256', 'created_at', 'sample'];
const PREFERENCE_COLS = ['key', 'scope', 'value', 'note', 'created_at', 'updated_at', 'sample'];
const PROJECT_COLS = ['id', 'name', 'purpose', 'scope', 'state', 'created_at', 'updated_at', 'last_touched_at', 'sample'];
const CHECKPOINT_COLS = ['id', 'project_id', 'scope', 'stopped_at_text', 'open_question', 'next_step', 'source_ref', 'created_at', 'sample'];
const CAPTURE_COLS = ['id', 'text', 'scope', 'source', 'client_created_at', 'received_at', 'receive_count', 'review_state', 'time_zone', 'sample'];
const REMINDER_COLS = ['id', 'text', 'scope', 'time_zone', 'local_date', 'local_time', 'recurrence', 'next_fire_at', 'state', 'created_at', 'sample', 'item_id'];
const DELIVERY_COLUMNS =
  'id, reminder_id, scheduled_for, local_label, state, push_status, attempts, sent_at, received_at, ' +
  'acknowledged_at, ack_via, held_until, error, created_at';

const ENTITY_TABLES = Object.freeze({
  item: { table: 'items', cols: ITEM_COLS },
  project: { table: 'projects', cols: PROJECT_COLS },
});

// Item text that search sees. Kept as one expression so every sync writes the same thing. Attachment names
// are part of their parent's row, so a search for a file name finds the capture or item that holds it.
const ITEM_FTS_BODY =
  "trim(coalesce(body, '') || ' ' || coalesce(reason, '') || ' ' || coalesce(who, '') || ' ' || coalesce(claim_by, '') || ' ' || " +
  "coalesce(recommendation, '') || ' ' || coalesce(assumptions, '') || ' ' || coalesce(outcome, '') || ' ' || " +
  "coalesce(reconsider_when, '') || ' ' || coalesce(options_json, '') || ' ' || " +
  "coalesce((SELECT group_concat(a.name, ' ') FROM attachments a WHERE a.item_id = items.id), ''))";
const CAPTURE_FTS_BODY = "coalesce((SELECT group_concat(a.name, ' ') FROM attachments a WHERE a.capture_id = captures.id), '')";

const CAPTURE_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;
const ENTITY_ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const DATE_ON_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SOURCE_REF_RE = /^(?:(?:capture|item|project):[A-Za-z0-9_.:-]{1,120}|https?:\/\/\S{1,2000})$/;

const DELETED_CAPTURE_KEY = 'deleted_capture:';
const DELETED_ITEM_KEY = 'deleted_item:';
const PREF_KEY_RE = /^[a-z0-9_.-]{1,60}$/;

/**
 * Derived-data purgers: functions (db, ref) -> D1 statements (or a Promise of them) that delete or redact a
 * module's derived rows citing ref ('capture:<id>' or 'item:<id>'). deleteCapture and deleteItem append
 * every purger's statements to their own batch, so the source and its derivatives go together.
 * The integration lead pushes each feature module's purgeRef here.
 */
export const DERIVED_PURGERS = [];

async function purgeStatements(db, ref) {
  const out = [];
  for (const fn of DERIVED_PURGERS) {
    const list = await fn(db, ref);
    if (Array.isArray(list)) out.push(...list);
  }
  return out;
}
const MAX_CAPTURE_TEXT = 20000;
const MAX_TITLE = 2000;
const MAX_BODY = 20000;
const MAX_SHORT = 500;
const MAX_SEARCH_TOKENS = 12;
const MAX_TOKEN_CHARS = 64;
const SEARCH_LIMIT = 50;

// ---------------------------------------------------------------- small helpers

function oneScope(scope) {
  if (scope === 'work' || scope === 'personal') return scope;
  throw new ScopeError(scope === 'all' ? "scope 'all' is not allowed here" : 'scope must be work or personal');
}

function scopesFor(scope) {
  if (scope === 'all') return SCOPES.slice();
  return [oneScope(scope)];
}

function marks(n) {
  return new Array(n).fill('?').join(', ');
}

function stmt(db, sql, ...params) {
  const s = db.prepare(sql);
  return params.length ? s.bind(...params) : s;
}

async function rowsOf(db, sql, ...params) {
  const res = await stmt(db, sql, ...params).all();
  return (res && res.results) || [];
}

async function firstOf(db, sql, ...params) {
  const row = await stmt(db, sql, ...params).first();
  return row || null;
}

function changesOf(res) {
  return (res && res.meta && Number(res.meta.changes)) || 0;
}

function requireNow(nowIso) {
  if (typeof nowIso !== 'string' || Number.isNaN(Date.parse(nowIso))) {
    throw new ValidationError('nowIso must be an ISO-8601 string', 'nowIso');
  }
  return nowIso;
}

function newId() {
  return globalThis.crypto.randomUUID();
}

function isDateOn(value) {
  if (typeof value !== 'string') return false;
  const m = DATE_ON_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(2000, mo - 1, d));
  return mo >= 1 && mo <= 12 && d >= 1 && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && y >= 1000;
}

function addDaysOn(on, n) {
  const m = DATE_ON_RE.exec(on);
  const t = new Date(0);
  t.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n);
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

function norm(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'bigint') return Number(v);
  return v;
}

// Column defaults for rows written before a column existed (old undo history, old exports).
const COLUMN_DEFAULTS = { recurrence: 'none' };

function canon(row, cols) {
  const out = {};
  for (const c of cols) out[c] = norm(row[c]) ?? COLUMN_DEFAULTS[c] ?? null;
  return out;
}

function sameRow(a, b, cols) {
  for (const c of cols) if (norm(a[c]) !== norm(b[c])) return false;
  return true;
}

function optText(value, field, max = MAX_SHORT) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text`, field);
  if (value.length > max) throw new ValidationError(`${field} is too long`, field);
  return value.trim() === '' ? null : value;
}

function reqText(value, field, max) {
  if (typeof value !== 'string' || value.trim() === '') throw new ValidationError(`${field} is required`, field);
  if (value.length > max) throw new ValidationError(`${field} is too long`, field);
  return value;
}

function optDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (!isDateOn(value)) throw new ValidationError(`${field} must be YYYY-MM-DD`, field);
  return value;
}

function sampleFlag(value) {
  if (value === undefined || value === null) return 0;
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  throw new ValidationError('sample must be 0 or 1', 'sample');
}

function optId(value, field = 'id') {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !ENTITY_ID_RE.test(value)) throw new ValidationError(`${field} is not a valid id`, field);
  return value;
}

function parseJson(text) {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pick(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined) return obj[k];
  return undefined;
}

// ---------------------------------------------------------------- FTS statements

function ftsDelete(db, scope, ref) {
  return stmt(db, `DELETE FROM ${FTS_TABLE[oneScope(scope)]} WHERE ref = ?`, ref);
}

// Re-derives the FTS row from the table itself, so it is right whether or not the preceding write applied.
function ftsItemSync(db, scope, id) {
  const t = FTS_TABLE[oneScope(scope)];
  return [
    ftsDelete(db, scope, `item:${id}`),
    stmt(
      db,
      `INSERT INTO ${t} (ref, kind, title, body) SELECT 'item:' || id, kind, title, ${ITEM_FTS_BODY} FROM items WHERE id = ? AND scope = ?`,
      id,
      scope,
    ),
  ];
}

function ftsProjectSync(db, scope, id) {
  const t = FTS_TABLE[oneScope(scope)];
  return [
    ftsDelete(db, scope, `project:${id}`),
    stmt(
      db,
      `INSERT INTO ${t} (ref, kind, title, body) SELECT 'project:' || id, 'project', name, coalesce(purpose, '') FROM projects WHERE id = ? AND scope = ?`,
      id,
      scope,
    ),
  ];
}

function ftsCaptureInsert(db, scope, id) {
  const t = FTS_TABLE[oneScope(scope)];
  return stmt(
    db,
    `INSERT INTO ${t} (ref, kind, title, body) SELECT 'capture:' || id, 'capture', text, ${CAPTURE_FTS_BODY} FROM captures WHERE id = ? AND scope = ?`,
    id,
    scope,
  );
}

function ftsCaptureSync(db, scope, id) {
  return [ftsDelete(db, scope, `capture:${id}`), ftsCaptureInsert(db, scope, id)];
}

function insertStmt(db, table, cols, row) {
  return stmt(db, `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${marks(cols.length)})`, ...cols.map((c) => norm(row[c])));
}

// UPDATE every column except id, guarded by the previous updated_at (optimistic check).
function updateAllStmt(db, table, cols, row, guardUpdatedAt) {
  const set = cols.filter((c) => c !== 'id');
  return stmt(
    db,
    `UPDATE ${table} SET ${set.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND updated_at IS ?`,
    ...set.map((c) => norm(row[c])),
    row.id,
    guardUpdatedAt,
  );
}

// Inserts a changes row only if the statement just before it changed exactly one row.
function changeStmtGuarded(db, { at, entity, entityId, op, before, after, scope }) {
  return stmt(
    db,
    'INSERT INTO changes (at, entity, entity_id, op, before_json, after_json, undone_at, scope) ' +
      'SELECT ?, ?, ?, ?, ?, ?, NULL, ? WHERE changes() = 1',
    at,
    entity,
    entityId,
    op,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    scope,
  );
}

// ---------------------------------------------------------------- captures

export async function saveCapture(db, { id, text, scope, source = 'app', clientCreatedAt = null, timeZone = null, sample = 0 } = {}, nowIso) {
  const s = oneScope(scope);
  requireNow(nowIso);
  if (typeof id !== 'string' || !CAPTURE_ID_RE.test(id)) throw new ValidationError('id must match ^[A-Za-z0-9_-]{8,80}$', 'id');
  reqText(text, 'text', MAX_CAPTURE_TEXT);
  if (!CAPTURE_SOURCES.includes(source)) throw new ValidationError(`source must be one of ${CAPTURE_SOURCES.join(', ')}`, 'source');
  const cca = clientCreatedAt == null ? null : String(clientCreatedAt).slice(0, 64);
  const tz = timeZone == null ? null : optText(timeZone, 'timeZone', 64);
  const smp = sampleFlag(sample);

  // A deleted capture's id is never stored again: a late retry from a phone's outbox must not bring
  // deleted words back. The tombstone holds the id only (kv is never exported).
  if (await firstOf(db, 'SELECT 1 AS x FROM kv WHERE key = ?', DELETED_CAPTURE_KEY + id)) {
    return { capture: null, duplicate: true, deleted: true };
  }
  const existing = await firstOf(db, 'SELECT * FROM captures WHERE id = ?', id);
  if (existing) return duplicateCapture(db, existing, { text, scope: s });

  const row = {
    id, text, scope: s, source, client_created_at: cca, received_at: nowIso, receive_count: 1,
    review_state: 'pending', time_zone: tz, sample: smp,
  };
  try {
    await db.batch([insertStmt(db, 'captures', CAPTURE_COLS, row), ftsCaptureInsert(db, s, id)]);
  } catch (err) {
    const raced = await firstOf(db, 'SELECT * FROM captures WHERE id = ?', id);
    if (raced) return duplicateCapture(db, raced, { text, scope: s });
    throw err;
  }
  return { capture: await firstOf(db, 'SELECT * FROM captures WHERE id = ?', id), duplicate: false };
}

async function duplicateCapture(db, existing, { text, scope }) {
  if (existing.text !== text || existing.scope !== scope) {
    throw new ConflictError('This capture id already exists with different content', 'id_conflict');
  }
  await stmt(db, 'UPDATE captures SET receive_count = receive_count + 1 WHERE id = ?', existing.id).run();
  return { capture: await firstOf(db, 'SELECT * FROM captures WHERE id = ?', existing.id), duplicate: true };
}

export async function getCapture(db, id, scope) {
  const s = oneScope(scope);
  return firstOf(db, 'SELECT * FROM captures WHERE id = ? AND scope = ?', id, s);
}

function proposalOut(row) {
  return { ...row, payload: parseJson(row.payload) };
}

// Idempotent per (capture_id, ordinal): a repeat keeps the first stored proposal.
// scope is optional for contract compatibility; when given, the capture must be in it.
export async function saveProposals(db, captureId, proposals, scope) {
  if (scope !== undefined) oneScope(scope);
  const capture =
    scope !== undefined
      ? await firstOf(db, 'SELECT * FROM captures WHERE id = ? AND scope = ?', captureId, scope)
      : await firstOf(db, 'SELECT * FROM captures WHERE id = ?', captureId);
  if (!capture) throw new NotFoundError('No such capture');
  if (!Array.isArray(proposals)) throw new ValidationError('proposals must be an array', 'proposals');
  const statements = [];
  const seen = new Set();
  for (const p of proposals) {
    if (!p || typeof p !== 'object') throw new ValidationError('proposal must be an object', 'proposals');
    if (!Number.isInteger(p.ordinal) || p.ordinal < 0) throw new ValidationError('ordinal must be a non-negative integer', 'ordinal');
    if (!PROPOSAL_KINDS.includes(p.kind)) throw new ValidationError('unknown proposal kind', 'kind');
    if (seen.has(p.ordinal)) throw new ValidationError('duplicate ordinal', 'ordinal');
    seen.add(p.ordinal);
    statements.push(
      stmt(
        db,
        'INSERT OR IGNORE INTO proposals (id, capture_id, ordinal, kind, payload, state, item_id, scope, sample) ' +
          "VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)",
        `${captureId}:${p.ordinal}`,
        captureId,
        p.ordinal,
        p.kind,
        JSON.stringify(p),
        capture.scope,
        capture.sample,
      ),
    );
  }
  if (statements.length) await db.batch(statements);
  const rows = await rowsOf(db, 'SELECT * FROM proposals WHERE capture_id = ? ORDER BY ordinal', captureId);
  return rows.map(proposalOut);
}

export async function getInbox(db, scope) {
  const scopes = scopesFor(scope);
  const captures = await rowsOf(
    db,
    `SELECT * FROM captures WHERE review_state = 'pending' AND scope IN (${marks(scopes.length)}) ORDER BY received_at DESC, rowid DESC`,
    ...scopes,
  );
  if (!captures.length) return [];
  const ids = captures.map((c) => c.id);
  const props = await rowsOf(
    db,
    `SELECT * FROM proposals WHERE state = 'pending' AND capture_id IN (${marks(ids.length)}) AND scope IN (${marks(scopes.length)}) ORDER BY capture_id, ordinal`,
    ...ids,
    ...scopes,
  );
  const byCapture = new Map();
  for (const p of props) {
    const list = byCapture.get(p.capture_id) || [];
    list.push(proposalOut(p));
    byCapture.set(p.capture_id, list);
  }
  return (await withCaptureAttachments(db, captures)).map((c) => ({ capture: c, proposals: byCapture.get(c.id) || [] }));
}

// ---------------------------------------------------------------- item field handling

const ITEM_FIELD_KEYS = {
  kind: ['kind'],
  project_id: ['projectId', 'project_id'],
  title: ['title'],
  body: ['body'],
  due_on: ['dueOn', 'due_on'],
  today_pick: ['todayPick', 'today_pick'],
  who: ['who'],
  claim_status: ['claimStatus', 'claim_status'],
  claim_by: ['claimBy', 'claim_by'],
  asked_on: ['askedOn', 'asked_on'],
  promised_on: ['promisedOn', 'promised_on'],
  follow_up_on: ['followUpOn', 'follow_up_on'],
  reason: ['reason'],
  recurrence: ['recurrence'],
  start_on: ['startOn', 'start_on'],
  when_text: ['whenText', 'when_text'],
  options_json: ['options', 'optionsJson', 'options_json'],
  recommendation: ['recommendation'],
  assumptions: ['assumptions'],
  outcome: ['outcome'],
  reconsider_when: ['reconsiderWhen', 'reconsider_when'],
  decided_on: ['decidedOn', 'decided_on'],
};
const ALL_ITEM_INPUT_KEYS = new Set(Object.values(ITEM_FIELD_KEYS).flat());

// Maps input (camelCase or column names) to column values for the keys present. Validates each value.
function itemFieldsFrom(input, { extraAllowed = [] } = {}) {
  const out = {};
  if (input == null) return out;
  if (typeof input !== 'object') throw new ValidationError('fields must be an object');
  for (const k of Object.keys(input)) {
    if (input[k] === undefined) continue;
    if (!ALL_ITEM_INPUT_KEYS.has(k) && !extraAllowed.includes(k)) throw new ValidationError(`unknown field ${k}`, k);
  }
  for (const [col, keys] of Object.entries(ITEM_FIELD_KEYS)) {
    const v = pick(input, ...keys);
    if (v === undefined) continue;
    out[col] = v;
  }
  return validateItemValues(out);
}

function validateItemValues(f) {
  const out = { ...f };
  if ('kind' in out && !ITEM_KINDS.includes(out.kind)) throw new ValidationError('unknown item kind', 'kind');
  if ('title' in out) out.title = reqText(out.title, 'title', MAX_TITLE);
  if ('body' in out) out.body = optText(out.body, 'body', MAX_BODY);
  if ('project_id' in out) out.project_id = optId(out.project_id, 'project_id');
  for (const c of ['due_on', 'asked_on', 'promised_on', 'follow_up_on', 'start_on', 'decided_on']) if (c in out) out[c] = optDate(out[c], c);
  if ('recurrence' in out) {
    if (out.recurrence == null) out.recurrence = 'none';
    if (!RECURRENCES.includes(out.recurrence)) throw new ValidationError(`recurrence must be one of ${RECURRENCES.join(', ')}`, 'recurrence');
  }
  if ('when_text' in out) out.when_text = optText(out.when_text, 'when_text');
  for (const c of ['recommendation', 'assumptions', 'outcome']) if (c in out) out[c] = optText(out[c], c, MAX_BODY);
  if ('reconsider_when' in out) out.reconsider_when = optText(out.reconsider_when, 'reconsider_when');
  if ('options_json' in out) out.options_json = optionsJson(out.options_json);
  if ('today_pick' in out) {
    const v = out.today_pick;
    if (v === true || v === 1) out.today_pick = 1;
    else if (v === false || v === 0 || v === null) out.today_pick = 0;
    else throw new ValidationError('today_pick must be true or false', 'today_pick');
  }
  for (const c of ['who', 'claim_by', 'reason']) if (c in out) out[c] = optText(out[c], c, c === 'reason' ? MAX_BODY : MAX_SHORT);
  if ('claim_status' in out && out.claim_status !== null && !CLAIM_STATUSES.includes(out.claim_status)) {
    throw new ValidationError('unknown claim_status', 'claim_status');
  }
  return out;
}

// Decision options: an array (or its JSON text) of up to 10 strings of 1-200 characters. Stored as JSON text.
function optionsJson(value) {
  if (value === null || value === undefined || value === '') return null;
  let list = value;
  if (typeof value === 'string') list = parseJson(value);
  if (!Array.isArray(list) || list.length > 10) throw new ValidationError('options must be a list of up to 10 entries', 'options');
  const clean = list.map((o) => {
    if (typeof o !== 'string' || o.trim() === '' || o.length > 200) throw new ValidationError('each option must be 1 to 200 characters', 'options');
    return o.trim();
  });
  return clean.length ? JSON.stringify(clean) : null;
}

// Rules that span fields, checked on the final row of every create and edit.
function checkItemRow(row) {
  if (row.recurrence !== 'none' && (row.kind !== 'task' || !row.due_on)) {
    throw new ValidationError('Only a task with a due date can repeat', 'recurrence');
  }
  if (row.kind !== 'decision' && DECISION_DETAIL_COLS.some((c) => row[c] != null)) {
    throw new ValidationError('Options, recommendation, assumptions, outcome, reconsider and decided date belong to decisions', 'kind');
  }
  return row;
}

async function itemTombstoned(db, id) {
  return !!(await firstOf(db, 'SELECT 1 AS x FROM kv WHERE key = ?', DELETED_ITEM_KEY + id));
}

async function requireProjectInScope(db, projectId, scope) {
  if (projectId == null) return;
  const p = await firstOf(db, 'SELECT id FROM projects WHERE id = ? AND scope = ?', projectId, scope);
  if (!p) throw new NotFoundError('No such project in this scope');
}

function newItemRow(fields, { id, scope, origin, sourceCaptureId = null, sourceQuote = null, sample = 0, nowIso, supersedesId = null }) {
  const row = {
    id,
    kind: fields.kind,
    scope,
    project_id: fields.project_id ?? null,
    title: fields.title,
    body: fields.body ?? null,
    state: 'open',
    due_on: fields.due_on ?? null,
    today_pick: fields.today_pick ?? 0,
    who: fields.who ?? null,
    claim_status: fields.claim_status ?? null,
    claim_by: fields.claim_by ?? null,
    asked_on: fields.asked_on ?? null,
    promised_on: fields.promised_on ?? null,
    follow_up_on: fields.follow_up_on ?? null,
    reply_recorded_at: null,
    supersedes_id: supersedesId,
    superseded_by_id: null,
    reason: fields.reason ?? null,
    origin,
    source_capture_id: sourceCaptureId,
    source_quote: sourceQuote,
    source_deleted: 0,
    created_at: nowIso,
    updated_at: nowIso,
    done_at: null,
    sample,
    recurrence: fields.recurrence ?? 'none',
    series_id: null,
    start_on: fields.start_on ?? null,
    when_text: fields.when_text ?? null,
    options_json: fields.options_json ?? null,
    recommendation: fields.recommendation ?? null,
    assumptions: fields.assumptions ?? null,
    outcome: fields.outcome ?? null,
    reconsider_when: fields.reconsider_when ?? null,
    decided_on: fields.decided_on ?? null,
  };
  // Ambiguity is stored as 'unspecified', never defaulted to 'requested'.
  if (row.kind === 'waiting' && row.claim_status == null) row.claim_status = 'unspecified';
  return checkItemRow(canon(row, ITEM_COLS));
}

function itemInsertStatements(db, row, nowIso) {
  return [
    insertStmt(db, 'items', ITEM_COLS, row),
    changeStmtGuarded(db, { at: nowIso, entity: 'item', entityId: row.id, op: 'create', before: null, after: row, scope: row.scope }),
    ...ftsItemSync(db, row.scope, row.id),
  ];
}

async function loadItem(db, id, scope) {
  const row = await firstOf(db, 'SELECT * FROM items WHERE id = ? AND scope = ?', id, scope);
  if (!row) throw new NotFoundError('No such item');
  return canon(row, ITEM_COLS);
}

// Writes after over before (guarded), one changes row, FTS resync. Returns { item, changeId }.
async function writeItemChange(db, before, after, op, nowIso) {
  const res = await db.batch([
    updateAllStmt(db, 'items', ITEM_COLS, after, before.updated_at),
    changeStmtGuarded(db, { at: nowIso, entity: 'item', entityId: after.id, op, before, after, scope: after.scope }),
    ...ftsItemSync(db, after.scope, after.id),
  ]);
  if (changesOf(res[0]) !== 1) throw new ConflictError('The item changed while saving', 'concurrent_change');
  return { item: after, changeId: Number(res[1].meta.last_row_id) };
}

// ---------------------------------------------------------------- items

export async function createItem(db, fields, scope, nowIso) {
  const s = oneScope(scope);
  requireNow(nowIso);
  const f = fields || {};
  if (f.scope !== undefined && f.scope !== s) throw new ScopeError('fields.scope does not match scope');
  const values = itemFieldsFrom(f, { extraAllowed: ['id', 'sample', 'scope'] });
  if (!values.kind) throw new ValidationError('kind is required', 'kind');
  if (!values.title) throw new ValidationError('title is required', 'title');
  await requireProjectInScope(db, values.project_id, s);
  const id = optId(f.id) || newId();
  if (await itemTombstoned(db, id)) throw new GoneError();
  const existing = await firstOf(db, 'SELECT * FROM items WHERE id = ?', id);
  if (existing) {
    if (existing.scope === s && existing.kind === values.kind && existing.title === values.title) {
      return { item: canon(existing, ITEM_COLS), changeId: null, duplicate: true };
    }
    throw new ConflictError('This item id already exists with different content', 'id_conflict');
  }
  const row = newItemRow(values, { id, scope: s, origin: 'user', sample: sampleFlag(f.sample), nowIso });
  const res = await db.batch(itemInsertStatements(db, row, nowIso));
  return { item: row, changeId: Number(res[1].meta.last_row_id) };
}

/**
 * Items in one scope, optionally filtered by kind, state and project. Serves the Waiting screen
 * (GET /api/items?kind=waiting&state=open&scope=). Waiting items sort by follow-up date, others newest first.
 */
export async function listItems(db, scope, { kind = null, state = null, projectId = null, limit = 200 } = {}) {
  const s = oneScope(scope);
  if (kind != null && !ITEM_KINDS.includes(kind)) throw new ValidationError('unknown item kind', 'kind');
  if (state != null && !['open', 'done', 'archived'].includes(state)) throw new ValidationError('unknown item state', 'state');
  const pid = optId(projectId, 'project_id');
  const n = Math.max(1, Math.min(500, Number(limit) || 200));
  const where = ['scope = ?'];
  const params = [s];
  if (kind != null) {
    where.push('kind = ?');
    params.push(kind);
  }
  if (state != null) {
    where.push('state = ?');
    params.push(state);
  }
  if (pid != null) {
    where.push('project_id = ?');
    params.push(pid);
  }
  const order =
    kind === 'waiting'
      ? '(follow_up_on IS NULL), follow_up_on, created_at, rowid'
      : 'created_at DESC, rowid DESC';
  const rows = await rowsOf(db, `SELECT * FROM items WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`, ...params, n);
  return withItemAttachments(db, rows.map((r) => canon(r, ITEM_COLS)));
}

export async function getItem(db, id, scope) {
  const s = oneScope(scope);
  const row = await firstOf(db, 'SELECT * FROM items WHERE id = ? AND scope = ?', id, s);
  return row ? canon(row, ITEM_COLS) : null;
}

export async function updateItem(db, id, patch, scope, nowIso) {
  const s = oneScope(scope);
  requireNow(nowIso);
  const p = patch || {};
  if (p.scope !== undefined && p.scope !== s) throw new ValidationError('scope cannot be changed by an edit', 'scope');
  const values = itemFieldsFrom(p, { extraAllowed: ['scope'] });
  const before = await loadItem(db, id, s);
  // The original date phrase is kept from the capture: editing dates never erases it (sending it back
  // unchanged is fine).
  if ('when_text' in values && values.when_text !== before.when_text) {
    throw new ValidationError('when_text keeps the original words and cannot be edited', 'when_text');
  }
  if ('project_id' in values && values.project_id !== before.project_id) await requireProjectInScope(db, values.project_id, s);
  const after = canon({ ...before, ...values, updated_at: nowIso }, ITEM_COLS);
  if (after.kind === 'waiting' && after.claim_status == null) after.claim_status = 'unspecified';
  checkItemRow(after);
  return writeItemChange(db, before, after, 'update', nowIso);
}

async function setItemState(db, id, scope, nowIso, state, op) {
  const s = oneScope(scope);
  requireNow(nowIso);
  const before = await loadItem(db, id, s);
  if (before.state === state) return { item: before, changeId: null };
  const after = canon(
    { ...before, state, done_at: state === 'done' ? nowIso : state === 'open' ? null : before.done_at, updated_at: nowIso },
    ITEM_COLS,
  );
  return writeItemChange(db, before, after, op, nowIso);
}

function dayNumber(on) {
  const m = DATE_ON_RE.exec(on);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

function monthDay(year, month0, anchorDay) {
  const y = year + Math.floor(month0 / 12);
  const m = ((month0 % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(Math.min(anchorDay, last)).padStart(2, '0')}`;
}

/**
 * The next due date of a repeating task: the first occurrence strictly after max(dueOn, todayOn), so a
 * task completed late never leaves a pile of missed occurrences. weekly keeps dueOn's weekday; monthly
 * keeps anchorDay (default dueOn's day), clamped to the month's end (the 31st gives Feb 28, then Mar 31).
 */
export function nextOccurrenceOn(recurrence, dueOn, todayOn, anchorDay = null) {
  if (!isDateOn(dueOn) || !isDateOn(todayOn)) throw new ValidationError('dates must be YYYY-MM-DD', 'due_on');
  const base = dueOn > todayOn ? dueOn : todayOn;
  if (recurrence === 'daily') return addDaysOn(base, 1);
  if (recurrence === 'weekdays') {
    let d = addDaysOn(base, 1);
    while ([0, 6].includes(new Date(dayNumber(d) * 86_400_000).getUTCDay())) d = addDaysOn(d, 1);
    return d;
  }
  if (recurrence === 'weekly') return addDaysOn(dueOn, (Math.floor((dayNumber(base) - dayNumber(dueOn)) / 7) + 1) * 7);
  if (recurrence === 'monthly') {
    const [y, m, d] = dueOn.split('-').map(Number);
    const [by, bm] = base.split('-').map(Number);
    const anchor = anchorDay || d;
    for (let k = Math.max(1, (by - y) * 12 + (bm - m)); ; k++) {
      const on = monthDay(y, m - 1 + k, anchor);
      if (on > base) return on;
    }
  }
  throw new ValidationError('unknown recurrence', 'recurrence');
}

/**
 * Completes an item. A repeating task (recurrence != 'none', with a due_on) is marked done and, in the
 * same batch, its next instance is created with due_on = nextOccurrenceOn(...) unless the series already
 * has an open item. todayOn is the user's local date (the API works it out). Returns { item, next, changeId };
 * Undo of that change reopens the item and deletes the new instance if it is untouched since.
 */
export async function completeItem(db, id, scope, nowIso, { todayOn = null } = {}) {
  const s = oneScope(scope);
  requireNow(nowIso);
  const before = await loadItem(db, id, s);
  const repeats = before.state !== 'done' && before.kind === 'task' && before.recurrence !== 'none' && before.due_on;
  if (!repeats) return { next: null, ...(await setItemState(db, id, s, nowIso, 'done', 'complete')) };
  const today = isDateOn(todayOn) ? todayOn : nowIso.slice(0, 10);
  const seriesId = before.series_id ?? before.id;
  let anchorDay = null;
  if (before.recurrence === 'monthly') {
    const root = await firstOf(db, 'SELECT due_on FROM items WHERE id = ? AND scope = ?', seriesId, s);
    anchorDay = Number((root && isDateOn(root.due_on) ? root.due_on : before.due_on).slice(8));
  }
  const dueOn = nextOccurrenceOn(before.recurrence, before.due_on, today, anchorDay);
  const after = canon({ ...before, state: 'done', done_at: nowIso, updated_at: nowIso, series_id: seriesId }, ITEM_COLS);
  const startOffset = before.start_on ? dayNumber(before.due_on) - dayNumber(before.start_on) : null;
  const next = canon(
    {
      ...before, id: newId(), state: 'open', due_on: dueOn, start_on: startOffset == null ? null : addDaysOn(dueOn, -startOffset),
      today_pick: 0, series_id: seriesId, created_at: nowIso, updated_at: nowIso, done_at: null,
    },
    ITEM_COLS,
  );
  const statements = [
    updateAllStmt(db, 'items', ITEM_COLS, after, before.updated_at),
    changeStmtGuarded(db, { at: nowIso, entity: 'item', entityId: id, op: 'complete', before, after: { ...after, _spawned_id: next.id }, scope: s }),
    ...ftsItemSync(db, s, id),
  ];
  statements.push(
    // At most one open item per series; and only if this completion is the one that landed.
    stmt(
      db,
      `INSERT INTO items (${ITEM_COLS.join(', ')}) SELECT ${marks(ITEM_COLS.length)} ` +
        "WHERE NOT EXISTS (SELECT 1 FROM items WHERE series_id = ? AND state = 'open') " +
        "AND EXISTS (SELECT 1 FROM items WHERE id = ? AND state = 'done' AND updated_at = ?)",
      ...ITEM_COLS.map((c) => next[c]),
      seriesId,
      id,
      nowIso,
    ),
    ...ftsItemSync(db, s, next.id),
  );
  const res = await db.batch(statements);
  if (changesOf(res[0]) !== 1) throw new ConflictError('The item changed while saving', 'concurrent_change');
  // Read back rather than trust meta.changes: on D1 a statement after an FTS5 write can report the FTS
  // table's flushed writes as its own.
  const spawned = await firstOf(db, 'SELECT * FROM items WHERE id = ? AND scope = ?', next.id, s);
  return { item: after, next: spawned ? canon(spawned, ITEM_COLS) : null, changeId: Number(res[1].meta.last_row_id) };
}

/** Sets or clears (null) the "not before" date. Never touches due_on. */
export async function deferItem(db, id, startOn, scope, nowIso) {
  const s = oneScope(scope);
  requireNow(nowIso);
  const on = optDate(startOn, 'start_on');
  const before = await loadItem(db, id, s);
  const after = canon({ ...before, start_on: on, updated_at: nowIso }, ITEM_COLS);
  return writeItemChange(db, before, after, 'defer', nowIso);
}

export function reopenItem(db, id, scope, nowIso) {
  return setItemState(db, id, scope, nowIso, 'open', 'reopen');
}

export function archiveItem(db, id, scope, nowIso) {
  return setItemState(db, id, scope, nowIso, 'archived', 'archive');
}

// Records that a reply arrived. It never changes claim_status or follow_up_on: what the reply said is a
// separate user edit.
export async function recordReply(db, id, scope, nowIso) {
  const s = oneScope(scope);
  requireNow(nowIso);
  const before = await loadItem(db, id, s);
  if (before.kind !== 'waiting') throw new ValidationError('Only waiting items take a reply', 'kind');
  const after = canon({ ...before, reply_recorded_at: nowIso, updated_at: nowIso }, ITEM_COLS);
  return writeItemChange(db, before, after, 'reply', nowIso);
}

export async function snoozeFollowUp(db, id, followUpOn, scope, nowIso) {
  const s = oneScope(scope);
  requireNow(nowIso);
  if (!isDateOn(followUpOn)) throw new ValidationError('followUpOn must be YYYY-MM-DD', 'followUpOn');
  const before = await loadItem(db, id, s);
  if (before.kind !== 'waiting') throw new ValidationError('Only waiting items have a follow-up', 'kind');
  const after = canon({ ...before, follow_up_on: followUpOn, updated_at: nowIso }, ITEM_COLS);
  return writeItemChange(db, before, after, 'snooze', nowIso);
}

// New decision; with supersedesId the old decision gets superseded_by_id. Both stay searchable.
// One changes row (the create). Undoing it deletes the new decision and clears the old one's link.
export async function createDecision(db, fields, scope, nowIso) {
  const s = oneScope(scope);
  requireNow(nowIso);
  const f = { ...(fields || {}) };
  const supersedesId = f.supersedesId ?? f.supersedes_id ?? null;
  delete f.supersedesId;
  delete f.supersedes_id;
  if (f.scope !== undefined && f.scope !== s) throw new ScopeError('fields.scope does not match scope');
  const values = itemFieldsFrom({ ...f, kind: 'decision' }, { extraAllowed: ['id', 'sample', 'scope'] });
  if (!values.title) throw new ValidationError('title is required', 'title');
  await requireProjectInScope(db, values.project_id, s);
  let old = null;
  if (supersedesId != null) {
    old = await firstOf(db, 'SELECT * FROM items WHERE id = ? AND scope = ?', supersedesId, s);
    if (!old || old.kind !== 'decision') throw new NotFoundError('No such decision in this scope');
    if (old.superseded_by_id) throw new ConflictError('That decision is already superseded', 'already_superseded');
  }
  const id = optId(f.id) || newId();
  if (await itemTombstoned(db, id)) throw new GoneError();
  if (await firstOf(db, 'SELECT id FROM items WHERE id = ?', id)) throw new ConflictError('This item id already exists', 'id_conflict');
  const row = newItemRow(values, { id, scope: s, origin: 'user', sample: sampleFlag(f.sample), nowIso, supersedesId: old ? old.id : null });
  const statements = itemInsertStatements(db, row, nowIso);
  if (old) {
    statements.push(
      stmt(db, 'UPDATE items SET superseded_by_id = ?, updated_at = ? WHERE id = ? AND superseded_by_id IS NULL', id, nowIso, old.id),
    );
  }
  const res = await db.batch(statements);
  return { item: row, changeId: Number(res[1].meta.last_row_id), superseded: old ? await getItem(db, old.id, s) : null };
}

// ---------------------------------------------------------------- review

function proposalTargetId(captureId, ordinal) {
  return `cap_${captureId}_${ordinal}`;
}

function whenFrom(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const w = obj.when && typeof obj.when === 'object' ? obj.when : {};
  return {
    on: pick(obj, 'localDate', 'local_date', 'on') ?? (w.kind === 'date' || w.kind === 'datetime' ? w.on : undefined),
    time: pick(obj, 'localTime', 'local_time', 'time') ?? (w.kind === 'datetime' ? w.time : undefined),
  };
}

// Item fields from a proposal payload plus the user's edits. Copies values; never invents any.
function itemValuesFromProposal(payload, edits) {
  const fields = (payload && payload.fields) || {};
  const claim = fields.claim && typeof fields.claim === 'object' ? fields.claim : {};
  const base = {
    kind: payload.kind,
    title: payload.title,
    body: pick(fields, 'body'),
    // A date mentioned in a task sentence (fields.when) is shown in Review for checking; it is not a hard
    // date. Only an explicit dueOn, or the user's own Due date edit, sets due_on.
    due_on: pick(fields, 'dueOn', 'due_on'),
    who: pick(fields, 'who'),
    claim_status: pick(fields, 'claimStatus', 'claim_status') ?? claim.status,
    claim_by: pick(fields, 'claimBy', 'claim_by') ?? claim.by,
    asked_on: pick(fields, 'askedOn', 'asked_on'),
    promised_on: pick(fields, 'promisedOn', 'promised_on'),
    follow_up_on: pick(fields, 'followUpOn', 'follow_up_on'),
    reason: pick(fields, 'reason'),
    project_id: pick(fields, 'projectId', 'project_id'),
    // The original date phrase travels with the item ("by Tuesday"), even when the user sets his own date.
    when_text: fields.when && typeof fields.when.original === 'string' && fields.when.original ? fields.when.original : undefined,
  };
  for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k];
  const e = { ...(edits || {}) };
  for (const k of ['scope', 'localDate', 'local_date', 'localTime', 'local_time', 'on', 'time', 'timeZone', 'time_zone', 'supersedesId', 'supersedes_id']) {
    delete e[k];
  }
  return validateItemValues({ ...base, ...itemFieldsFrom(e) });
}

/**
 * Accepts and drops proposals of one capture. Idempotent on replay: an already accepted proposal returns
 * its existing item or reminder. Pending proposals not named stay pending (the capture stays in the
 * inbox) unless keepAsNote is set, which drops them.
 * Returns { capture, items, reminders, changeIds }.
 */
export async function reviewCapture(db, captureId, { accept = [], drop = [], keepAsNote = false } = {}, scope, nowIso, _retry = true) {
  const s = oneScope(scope);
  requireNow(nowIso);
  const capture = await firstOf(db, 'SELECT * FROM captures WHERE id = ? AND scope = ?', captureId, s);
  if (!capture) throw new NotFoundError('No such capture');
  if (!Array.isArray(accept) || !Array.isArray(drop)) throw new ValidationError('accept and drop must be arrays');
  const proposals = await rowsOf(db, 'SELECT * FROM proposals WHERE capture_id = ? ORDER BY ordinal', captureId);
  const byOrdinal = new Map(proposals.map((p) => [p.ordinal, p]));
  const acceptOrdinals = accept.map((a) => (a && typeof a === 'object' ? a.ordinal : a));
  for (const o of [...acceptOrdinals, ...drop]) {
    if (!byOrdinal.has(o)) throw new ValidationError('unknown proposal ordinal', 'ordinal');
  }
  if (acceptOrdinals.some((o) => drop.includes(o))) throw new ValidationError('an ordinal cannot be both accepted and dropped', 'ordinal');

  const statements = [];
  const changeIndexes = [];
  const newItems = [];
  const existingItemIds = [];
  const reminderIds = [];
  const finalState = new Map(proposals.map((p) => [p.ordinal, p.state]));

  for (const a of accept) {
    const ordinal = a && typeof a === 'object' ? a.ordinal : a;
    const edits = a && typeof a === 'object' ? a.edits || {} : {};
    const p = byOrdinal.get(ordinal);
    if (p.state === 'dropped') throw new ConflictError('That proposal was already dropped', 'state_moved_on');
    const payload = parseJson(p.payload) || {};
    const kind = edits.kind ?? payload.kind;
    const targetId = p.item_id || proposalTargetId(captureId, ordinal);
    if (p.state === 'accepted') {
      // Replay: answer with whatever was created (item or reminder); missing ids are skipped when reading back.
      existingItemIds.push(targetId);
      reminderIds.push(targetId);
      continue;
    }
    // Derived content keeps the more restrictive scope: a work capture may become personal, never the reverse.
    const itemScope = edits.scope === undefined ? s : oneScope(edits.scope);
    if (s === 'personal' && itemScope === 'work') throw new ScopeError('A personal capture cannot produce work items');
    if (kind === 'reminder') {
      const w = { ...whenFrom(payload.fields || {}), ...Object.fromEntries(Object.entries(whenFrom(edits)).filter(([, v]) => v !== undefined)) };
      const timeZone = pick(edits, 'timeZone', 'time_zone') ?? capture.time_zone;
      const title = edits.title ?? payload.title;
      const r = buildReminderRow(
        { id: targetId, text: title, localDate: w.on, localTime: w.time, timeZone, recurrence: 'none', itemId: null, sample: capture.sample },
        itemScope,
        nowIso,
      );
      statements.push(insertStmt(db, 'reminders', REMINDER_COLS, r.row));
      reminderIds.push(targetId);
    } else {
      const values = itemValuesFromProposal({ ...payload, kind }, edits);
      if (!values.title) throw new ValidationError('title is required', 'title');
      await requireProjectInScope(db, values.project_id, itemScope);
      const row = newItemRow(values, {
        id: targetId,
        scope: itemScope,
        origin: 'capture',
        sourceCaptureId: captureId,
        sourceQuote: typeof payload.sourceQuote === 'string' ? payload.sourceQuote : null,
        sample: capture.sample,
        nowIso,
      });
      const ins = itemInsertStatements(db, row, nowIso);
      changeIndexes.push(statements.length + 1);
      statements.push(...ins);
      newItems.push(row);
    }
    statements.push(
      stmt(db, "UPDATE proposals SET state = 'accepted', item_id = ? WHERE id = ? AND state = 'pending'", targetId, p.id),
    );
    finalState.set(ordinal, 'accepted');
  }

  for (const o of drop) {
    const p = byOrdinal.get(o);
    if (p.state === 'accepted') throw new ConflictError('That proposal was already accepted', 'state_moved_on');
    if (p.state === 'pending') {
      statements.push(stmt(db, "UPDATE proposals SET state = 'dropped' WHERE id = ? AND state = 'pending'", p.id));
      finalState.set(o, 'dropped');
    }
  }
  if (keepAsNote) {
    for (const p of proposals) {
      if (finalState.get(p.ordinal) === 'pending') {
        statements.push(stmt(db, "UPDATE proposals SET state = 'dropped' WHERE id = ? AND state = 'pending'", p.id));
        finalState.set(p.ordinal, 'dropped');
      }
    }
  }
  const states = [...finalState.values()];
  let reviewState;
  if (keepAsNote) reviewState = 'note';
  else if (states.includes('pending')) reviewState = 'pending';
  else reviewState = states.includes('accepted') ? 'reviewed' : 'note';
  statements.push(stmt(db, 'UPDATE captures SET review_state = ? WHERE id = ? AND scope = ?', reviewState, captureId, s));

  let res;
  try {
    res = await db.batch(statements);
  } catch (err) {
    // A concurrent replay of the same review inserted the same deterministic ids first: answer from its result.
    if (_retry && /UNIQUE|constraint/i.test(String(err && err.message))) {
      return reviewCapture(db, captureId, { accept, drop, keepAsNote }, scope, nowIso, false);
    }
    throw err;
  }
  const itemIds = [...existingItemIds, ...newItems.map((i) => i.id)];
  const items = [];
  for (const id of itemIds) {
    const row = await firstOf(db, 'SELECT * FROM items WHERE id = ?', id);
    if (row) items.push(canon(row, ITEM_COLS));
  }
  const reminders = [];
  for (const id of reminderIds) {
    const row = await firstOf(db, 'SELECT * FROM reminders WHERE id = ?', id);
    if (row) reminders.push(row);
  }
  const [after] = await withCaptureAttachments(db, [await firstOf(db, 'SELECT * FROM captures WHERE id = ?', captureId)]);
  return {
    capture: after,
    items: await withItemAttachments(db, items),
    reminders,
    changeIds: changeIndexes.map((i) => Number(res[i].meta.last_row_id)),
  };
}

// ---------------------------------------------------------------- undo

// True when before and after (each null or a row) both name the change's entity (by idKey) and scope.
function sidesMatch(change, before, after, idKey) {
  if (before == null && after == null) return false;
  return [before, after].every(
    (v) => v == null || (typeof v === 'object' && !Array.isArray(v) && String(v[idKey]) === String(change.entity_id) && v.scope === change.scope),
  );
}

export async function undoChange(db, changeId, nowIso, scope) {
  requireNow(nowIso);
  const change = await firstOf(db, 'SELECT * FROM changes WHERE id = ?', Number(changeId));
  if (!change) throw new NotFoundError('No such change');
  if (scope !== undefined && change.scope !== oneScope(scope)) throw new NotFoundError('No such change');
  if (change.undone_at) throw new ConflictError('That change was already undone', 'already_undone');
  if (change.entity === 'preference') return undoPreference(db, change, nowIso);
  const spec = ENTITY_TABLES[change.entity];
  if (!spec) throw new ValidationError('This change cannot be undone');
  const before = parseJson(change.before_json);
  const after = parseJson(change.after_json);
  const currentRow = await firstOf(db, `SELECT * FROM ${spec.table} WHERE id = ?`, change.entity_id);
  const current = currentRow ? canon(currentRow, spec.cols) : null;
  const matches = after == null ? current == null : current != null && sameRow(after, current, spec.cols);
  if (!matches) throw new ConflictError('This has changed since; undo would overwrite newer edits', 'state_moved_on');
  // History can arrive in a restore file: each side must be this very row, in the change's scope.
  if (!sidesMatch(change, before, after, 'id')) throw new ValidationError('This change cannot be undone');

  const id = change.entity_id;
  const entityScope = (current || before).scope;
  const markUndone = stmt(db, 'UPDATE changes SET undone_at = ? WHERE id = ? AND undone_at IS NULL AND changes() = 1', nowIso, change.id);
  const statements = [];
  if (before == null) {
    if (change.entity === 'project') {
      const used = await firstOf(
        db,
        'SELECT (SELECT COUNT(*) FROM items WHERE project_id = ?) + (SELECT COUNT(*) FROM checkpoints WHERE project_id = ?) AS n',
        id,
        id,
      );
      if (used && Number(used.n) > 0) throw new ConflictError('This project has items or checkpoints now', 'state_moved_on');
    }
    statements.push(stmt(db, `DELETE FROM ${spec.table} WHERE id = ? AND updated_at IS ?`, id, current.updated_at), markUndone);
    if (change.entity === 'item') {
      // An accepted proposal goes back to pending so the capture returns to the inbox. Every follow-up is
      // guarded on the item really being gone: if a concurrent edit made the DELETE match nothing, the
      // batch must leave the item, its search row, its capture and its proposal exactly as they were.
      const gone = 'NOT EXISTS (SELECT 1 FROM items WHERE id = ?)';
      statements.push(
        stmt(
          db,
          "UPDATE captures SET review_state = 'pending' WHERE id IN (SELECT capture_id FROM proposals WHERE item_id = ? AND state = 'accepted') AND " + gone,
          id,
          id,
        ),
        stmt(db, `UPDATE proposals SET state = 'pending', item_id = NULL WHERE item_id = ? AND state = 'accepted' AND ${gone}`, id, id),
        stmt(db, `UPDATE items SET superseded_by_id = NULL WHERE superseded_by_id = ? AND ${gone}`, id, id),
        stmt(db, `DELETE FROM ${FTS_TABLE[oneScope(entityScope)]} WHERE ref = ? AND ${gone}`, `item:${id}`, id),
      );
    } else {
      statements.push(ftsDelete(db, entityScope, `project:${id}`));
    }
  } else if (current == null) {
    if (change.entity === 'item' && (await itemTombstoned(db, id))) throw new GoneError();
    statements.push(insertStmt(db, spec.table, spec.cols, before), markUndone);
    statements.push(...(change.entity === 'item' ? ftsItemSync(db, before.scope, id) : ftsProjectSync(db, before.scope, id)));
  } else {
    statements.push(updateAllStmt(db, spec.table, spec.cols, canon(before, spec.cols), current.updated_at), markUndone);
    statements.push(...(change.entity === 'item' ? ftsItemSync(db, before.scope, id) : ftsProjectSync(db, before.scope, id)));
    if (change.entity === 'item' && after && typeof after._spawned_id === 'string') {
      // Undo of a repeating task's completion: the instance it created goes too, only if untouched since
      // (never edited, nothing attached or linked) and only if the reopen itself landed.
      const spawned = after._spawned_id;
      statements.push(
        stmt(
          db,
          // The new instance is written without a changes row, so any edit of it leaves one.
          "DELETE FROM items WHERE id = ? AND state = 'open' AND NOT EXISTS (SELECT 1 FROM changes WHERE entity = 'item' AND entity_id = ?) " +
            'AND NOT EXISTS (SELECT 1 FROM attachments WHERE item_id = ?) AND NOT EXISTS (SELECT 1 FROM reminders WHERE item_id = ?) ' +
            'AND EXISTS (SELECT 1 FROM items WHERE id = ? AND updated_at IS ?)',
          spawned,
          spawned,
          spawned,
          spawned,
          id,
          before.updated_at,
        ),
        stmt(db, `DELETE FROM ${FTS_TABLE[oneScope(before.scope)]} WHERE ref = ? AND NOT EXISTS (SELECT 1 FROM items WHERE id = ?)`, `item:${spawned}`, spawned),
      );
    }
  }
  const res = await db.batch(statements);
  if (changesOf(res[0]) !== 1) throw new ConflictError('This changed while undoing', 'concurrent_change');
  return { entity: change.entity, id, row: before ? canon(before, spec.cols) : null, changeId: change.id };
}

// ---------------------------------------------------------------- projects

function projectValuesFrom(input, { requireName }) {
  const out = {};
  const f = input || {};
  for (const k of Object.keys(f)) {
    if (f[k] === undefined) continue;
    if (!['id', 'name', 'purpose', 'state', 'sample', 'scope'].includes(k)) throw new ValidationError(`unknown field ${k}`, k);
  }
  if (f.name !== undefined || requireName) out.name = reqText(f.name, 'name', MAX_SHORT);
  if (f.purpose !== undefined) out.purpose = optText(f.purpose, 'purpose', MAX_BODY);
  if (f.state !== undefined) {
    if (!PROJECT_STATES.includes(f.state)) throw new ValidationError('unknown project state', 'state');
    out.state = f.state;
  }
  return out;
}

export async function createProject(db, fields, scope, nowIso) {
  const s = oneScope(scope);
  requireNow(nowIso);
  const f = fields || {};
  if (f.scope !== undefined && f.scope !== s) throw new ScopeError('fields.scope does not match scope');
  const values = projectValuesFrom(f, { requireName: true });
  const id = optId(f.id) || newId();
  const existing = await firstOf(db, 'SELECT * FROM projects WHERE id = ?', id);
  if (existing) {
    if (existing.scope === s && existing.name === values.name) return { project: canon(existing, PROJECT_COLS), changeId: null, duplicate: true };
    throw new ConflictError('This project id already exists with different content', 'id_conflict');
  }
  const row = canon(
    {
      id, name: values.name, purpose: values.purpose ?? null, scope: s, state: values.state ?? 'active',
      created_at: nowIso, updated_at: nowIso, last_touched_at: nowIso, sample: sampleFlag(f.sample),
    },
    PROJECT_COLS,
  );
  const res = await db.batch([
    insertStmt(db, 'projects', PROJECT_COLS, row),
    changeStmtGuarded(db, { at: nowIso, entity: 'project', entityId: id, op: 'create', before: null, after: row, scope: s }),
    ...ftsProjectSync(db, s, id),
  ]);
  return { project: row, changeId: Number(res[1].meta.last_row_id) };
}

export async function updateProject(db, id, patch, scope, nowIso) {
  const s = oneScope(scope);
  requireNow(nowIso);
  const p = patch || {};
  if (p.scope !== undefined && p.scope !== s) throw new ValidationError('scope cannot be changed by an edit', 'scope');
  if (p.id !== undefined && p.id !== id) throw new ValidationError('id cannot be changed', 'id');
  const values = projectValuesFrom({ ...p, id: undefined, sample: undefined }, { requireName: false });
  const row = await firstOf(db, 'SELECT * FROM projects WHERE id = ? AND scope = ?', id, s);
  if (!row) throw new NotFoundError('No such project');
  const before = canon(row, PROJECT_COLS);
  const after = canon({ ...before, ...values, updated_at: nowIso }, PROJECT_COLS);
  const res = await db.batch([
    updateAllStmt(db, 'projects', PROJECT_COLS, after, before.updated_at),
    changeStmtGuarded(db, { at: nowIso, entity: 'project', entityId: id, op: 'update', before, after, scope: s }),
    ...ftsProjectSync(db, s, id),
  ]);
  if (changesOf(res[0]) !== 1) throw new ConflictError('The project changed while saving', 'concurrent_change');
  return { project: after, changeId: Number(res[1].meta.last_row_id) };
}

export async function listProjects(db, scope) {
  const scopes = scopesFor(scope);
  return rowsOf(
    db,
    `SELECT * FROM projects WHERE scope IN (${marks(scopes.length)}) ` +
      "ORDER BY CASE state WHEN 'active' THEN 0 WHEN 'done' THEN 1 ELSE 2 END, last_touched_at DESC, updated_at DESC, rowid DESC",
    ...scopes,
  );
}

// todayOn: the local date (YYYY-MM-DD) a task's start_on is compared with; a task deferred to tomorrow is not
// startable today. Defaults to the New York date, the app's home zone (the same default the calendar uses).
const nyToday = (nowMs = Date.now()) => instantToZonedParts(nowMs, 'America/New_York').date;

async function nextItemFor(db, projectId, scope, todayOn = nyToday()) {
  const row = await firstOf(
    db,
    "SELECT * FROM items WHERE project_id = ? AND scope = ? AND kind = 'task' AND state = 'open' " +
      "ORDER BY (start_on IS NOT NULL AND start_on > ?), (due_on IS NULL), due_on, today_pick DESC, created_at, rowid LIMIT 1",
    projectId,
    scope,
    todayOn,
  );
  return row ? canon(row, ITEM_COLS) : null;
}

async function latestCheckpoint(db, projectId, scope) {
  return firstOf(db, 'SELECT * FROM checkpoints WHERE project_id = ? AND scope = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', projectId, scope);
}

async function projectCaptures(db, projectId, scope, limit) {
  return rowsOf(
    db,
    'SELECT * FROM captures WHERE scope = ? AND id IN ' +
      '(SELECT source_capture_id FROM items WHERE project_id = ? AND scope = ? AND source_capture_id IS NOT NULL) ' +
      'ORDER BY received_at DESC, rowid DESC LIMIT ?',
    scope,
    projectId,
    scope,
    limit,
  );
}

export async function getProject(db, id, scope, todayOn) {
  const s = oneScope(scope);
  const row = await firstOf(db, 'SELECT * FROM projects WHERE id = ? AND scope = ?', id, s);
  if (!row) return null;
  const waiting = await rowsOf(
    db,
    "SELECT * FROM items WHERE project_id = ? AND scope = ? AND kind = 'waiting' AND state = 'open' ORDER BY (follow_up_on IS NULL), follow_up_on, created_at, rowid",
    id,
    s,
  );
  const decisions = await rowsOf(
    db,
    "SELECT * FROM items WHERE project_id = ? AND scope = ? AND kind = 'decision' ORDER BY (superseded_by_id IS NOT NULL), created_at DESC, rowid DESC",
    id,
    s,
  );
  return {
    project: canon(row, PROJECT_COLS),
    nextItem: await nextItemFor(db, id, s, todayOn),
    waiting: waiting.map((r) => canon(r, ITEM_COLS)),
    decisions: decisions.map((r) => ({ ...canon(r, ITEM_COLS), superseded: r.superseded_by_id != null })),
    checkpoint: await latestCheckpoint(db, id, s),
    recentCaptures: await projectCaptures(db, id, s, 5),
  };
}

// Last sentence ending in '?' from a text, copied exactly (verbatim slice, never rewritten).
function lastQuestionIn(text) {
  if (typeof text !== 'string') return null;
  const parts = text.split(/(?<=[.!?])\s+|\n+/);
  for (let i = parts.length - 1; i >= 0; i--) {
    const t = parts[i].trim();
    if (t.endsWith('?')) return t;
  }
  return null;
}

/**
 * Prefill for "Save my place". Copies text verbatim, never summarises:
 * - stoppedAtText: the newest capture's full text on the project, else the newest item's title.
 * - openQuestion: the newest open item title ending in '?', else the last question sentence of the newest capture.
 * - nextStep: the project's next task title.
 * - sourceRef: where stoppedAtText came from. Any field may be null.
 */
export async function checkpointPrefill(db, projectId, scope) {
  const s = oneScope(scope);
  const project = await firstOf(db, 'SELECT id FROM projects WHERE id = ? AND scope = ?', projectId, s);
  if (!project) throw new NotFoundError('No such project');
  const [capture] = await projectCaptures(db, projectId, s, 1);
  // Where he stopped: the latest finished task says it best; otherwise the latest edited record. Never the
  // same record as the next step (a task that was only deferred is not where he stopped).
  const next0 = await nextItemFor(db, projectId, s);
  const item = await firstOf(
    db,
    "SELECT * FROM items WHERE project_id = ? AND scope = ? AND id IS NOT ? ORDER BY (state = 'done') DESC, updated_at DESC, rowid DESC LIMIT 1",
    projectId,
    s,
    next0 ? next0.id : null,
  );
  const previous = await latestCheckpoint(db, projectId, s);
  const question = await firstOf(
    db,
    "SELECT title FROM items WHERE project_id = ? AND scope = ? AND state = 'open' AND kind != 'decision' AND rtrim(title) LIKE '%?' " +
      'ORDER BY updated_at DESC, rowid DESC LIMIT 1',
    projectId,
    s,
  );
  const next = next0;
  let stoppedAtText = null;
  let sourceRef = null;
  if (capture) {
    stoppedAtText = capture.text;
    sourceRef = `capture:${capture.id}`;
  } else if (item) {
    stoppedAtText = item.state === 'done' ? `Finished: ${item.title}` : item.title;
    sourceRef = `item:${item.id}`;
  }
  return {
    stoppedAtText,
    // A question saved last time stays until he changes it.
    openQuestion: question ? question.title.trim() : (capture && lastQuestionIn(capture.text)) || (previous && previous.open_question) || null,
    nextStep: next ? next.title : null,
    sourceRef,
  };
}

/**
 * Saves a checkpoint. fields === null saves the prefill as it is (one tap). Otherwise each given field
 * replaces the prefill's (an empty string clears it). Touches projects.last_touched_at.
 */
export async function saveCheckpoint(db, projectId, fields, scope, nowIso) {
  const s = oneScope(scope);
  requireNow(nowIso);
  const project = await firstOf(db, 'SELECT * FROM projects WHERE id = ? AND scope = ?', projectId, s);
  if (!project) throw new NotFoundError('No such project');
  const prefill = await checkpointPrefill(db, projectId, s);
  const f = fields == null ? {} : fields;
  if (typeof f !== 'object') throw new ValidationError('fields must be an object or null');
  const val = (camel, snake, current, max) => {
    const v = pick(f, camel, snake);
    return v === undefined ? current : optText(v, camel, max);
  };
  const row = {
    id: optId(f.id) || newId(),
    project_id: projectId,
    scope: s,
    stopped_at_text: val('stoppedAtText', 'stopped_at_text', prefill.stoppedAtText, MAX_CAPTURE_TEXT),
    open_question: val('openQuestion', 'open_question', prefill.openQuestion, MAX_BODY),
    next_step: val('nextStep', 'next_step', prefill.nextStep, MAX_BODY),
    source_ref: val('sourceRef', 'source_ref', prefill.sourceRef, 2100),
    created_at: nowIso,
    sample: project.sample,
  };
  if (row.source_ref != null && !SOURCE_REF_RE.test(row.source_ref)) throw new ValidationError('sourceRef is not valid', 'sourceRef');
  const existing = await firstOf(db, 'SELECT * FROM checkpoints WHERE id = ?', row.id);
  if (existing) {
    if (existing.project_id === projectId && existing.scope === s) return { checkpoint: existing, duplicate: true };
    throw new ConflictError('This checkpoint id already exists', 'id_conflict');
  }
  await db.batch([
    insertStmt(db, 'checkpoints', CHECKPOINT_COLS, row),
    stmt(db, 'UPDATE projects SET last_touched_at = ? WHERE id = ? AND scope = ?', nowIso, projectId, s),
  ]);
  return { checkpoint: canon(row, CHECKPOINT_COLS), duplicate: false };
}

// ---------------------------------------------------------------- today

/**
 * Raw rows for buildToday (src/today.js):
 * { tasks, waiting, waitingCount, hardDates, inboxCount, checkpoints, reminders, unacknowledged }
 * - tasks: open tasks. waiting: ALL open waiting items (never in tasks). hardDates: open non-waiting items
 *   with due_on <= todayOn + 7 (overdue included). checkpoints: latest checkpoint per active project, joined
 *   (id is the checkpoint id; project_name, last_touched_at from the project). reminders: active reminders.
 *   unacknowledged: sent, never acknowledged deliveries joined to their reminder's text and scope.
 */
export async function listForToday(db, scope, todayOn) {
  const scopes = scopesFor(scope);
  if (!isDateOn(todayOn)) throw new ValidationError('todayOn must be YYYY-MM-DD', 'todayOn');
  const inS = `scope IN (${marks(scopes.length)})`;
  const tasks = await rowsOf(
    db,
    `SELECT * FROM items WHERE ${inS} AND kind = 'task' AND state = 'open' ORDER BY (due_on IS NULL), due_on, today_pick DESC, created_at, rowid`,
    ...scopes,
  );
  const waiting = await rowsOf(
    db,
    `SELECT * FROM items WHERE ${inS} AND kind = 'waiting' AND state = 'open' ORDER BY (follow_up_on IS NULL), follow_up_on, created_at, rowid`,
    ...scopes,
  );
  const hardDates = await rowsOf(
    db,
    `SELECT * FROM items WHERE ${inS} AND kind != 'waiting' AND state = 'open' AND due_on IS NOT NULL AND due_on <= ? ORDER BY due_on, created_at, rowid`,
    ...scopes,
    addDaysOn(todayOn, 7),
  );
  const inbox = await firstOf(db, `SELECT COUNT(*) AS n FROM captures WHERE ${inS} AND review_state = 'pending'`, ...scopes);
  const checkpoints = await rowsOf(
    db,
    'SELECT c.id, c.project_id, p.name AS project_name, c.scope, p.last_touched_at, c.created_at, ' +
      'c.stopped_at_text, c.open_question, c.next_step, c.source_ref, c.sample FROM (' +
      '  SELECT *, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at DESC, rowid DESC) AS rn FROM checkpoints' +
      `  WHERE ${inS}` +
      ") c JOIN projects p ON p.id = c.project_id AND p.scope = c.scope WHERE c.rn = 1 AND p.state = 'active' " +
      'ORDER BY p.last_touched_at DESC, c.created_at DESC',
    ...scopes,
  );
  const reminders = await rowsOf(
    db,
    `SELECT * FROM reminders WHERE ${inS} AND state = 'active' ORDER BY (next_fire_at IS NULL), next_fire_at, id`,
    ...scopes,
  );
  const unacknowledged = await rowsOf(
    db,
    'SELECT d.id, d.reminder_id, r.text, r.scope, r.item_id, d.scheduled_for, d.state, d.sent_at, d.acknowledged_at ' +
      'FROM deliveries d JOIN reminders r ON r.id = d.reminder_id ' +
      `WHERE r.scope IN (${marks(scopes.length)}) AND d.acknowledged_at IS NULL AND d.state IN ('sent', 'received_on_device') ` +
      'ORDER BY d.scheduled_for DESC LIMIT 50',
    ...scopes,
  );
  return {
    tasks: tasks.map((r) => canon(r, ITEM_COLS)),
    waiting: waiting.map((r) => canon(r, ITEM_COLS)),
    waitingCount: waiting.length,
    hardDates: hardDates.map((r) => canon(r, ITEM_COLS)),
    inboxCount: inbox ? Number(inbox.n) : 0,
    checkpoints,
    reminders,
    unacknowledged,
  };
}

// ---------------------------------------------------------------- search

/**
 * Turns user text into a safe FTS5 query: each token is double-quoted (inner quotes doubled) and given a
 * prefix star; tokens without a letter or digit are dropped. Operators (AND/OR/NOT/NEAR), column filters,
 * parentheses, stars and carets are therefore only ever literal text. Returns null when nothing is left.
 */
export function ftsQuery(query) {
  if (typeof query !== 'string') return null;
  const tokens = query
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .split(/\s+/u)
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
    .slice(0, MAX_SEARCH_TOKENS)
    .map((t) => `"${Array.from(t).slice(0, MAX_TOKEN_CHARS).join('').replace(/"/g, '""')}"*`);
  return tokens.length ? tokens.join(' ') : null;
}

/**
 * search(db, query, scope): scope must be 'work' or 'personal' (ScopeError on 'all'; the UI runs two queries).
 * Rows: { ref, type: 'capture'|'item'|'project', kind, title, scope, at, state, superseded }.
 * Current rows first, superseded decisions after; each group newest first.
 */
export async function search(db, query, scope) {
  const s = oneScope(scope);
  const q = ftsQuery(query);
  if (!q) return [];
  const t = FTS_TABLE[s];
  const hits = await rowsOf(db, `SELECT ref, kind FROM ${t} WHERE ${t} MATCH ? ORDER BY rank LIMIT 200`, q);
  const ids = { capture: [], item: [], project: [] };
  for (const h of hits) {
    const i = h.ref.indexOf(':');
    const type = h.ref.slice(0, i);
    if (ids[type]) ids[type].push(h.ref.slice(i + 1));
  }
  const out = [];
  // D1 binds at most 100 parameters per statement, so id lists go in chunks.
  const byIds = async (table, list) => {
    const rows = [];
    for (const part of chunks(list)) rows.push(...(await rowsOf(db, `SELECT * FROM ${table} WHERE scope = ? AND id IN (${marks(part.length)})`, s, ...part)));
    return rows;
  };
  if (ids.item.length) {
    const rows = await byIds('items', ids.item);
    for (const r of rows) {
      out.push({
        ref: `item:${r.id}`, type: 'item', kind: r.kind, id: r.id, title: r.title, scope: r.scope, at: r.created_at,
        state: r.state, project_id: r.project_id, superseded: r.superseded_by_id != null,
        source_deleted: r.source_deleted === 1,
      });
    }
  }
  if (ids.capture.length) {
    const rows = await byIds('captures', ids.capture);
    for (const r of rows) {
      out.push({
        ref: `capture:${r.id}`, type: 'capture', kind: 'capture', id: r.id, title: r.text, scope: r.scope, at: r.received_at,
        state: r.review_state, project_id: null, superseded: false,
      });
    }
  }
  if (ids.project.length) {
    const rows = await byIds('projects', ids.project);
    for (const r of rows) {
      out.push({
        ref: `project:${r.id}`, type: 'project', kind: 'project', id: r.id, title: r.name, scope: r.scope, at: r.created_at,
        state: r.state, project_id: r.id, superseded: false,
      });
    }
  }
  out.sort((a, b) => Number(a.superseded) - Number(b.superseded) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || (a.ref < b.ref ? -1 : 1));
  const top = out.slice(0, SEARCH_LIMIT);
  const idx = await attachmentIndex(db, {
    itemIds: top.filter((r) => r.type === 'item').map((r) => r.id),
    captureIds: top.filter((r) => r.type === 'capture').map((r) => r.id),
  });
  return top.map((r) =>
    r.type === 'project' ? r : { ...r, attachments: listFor(r.type === 'item' ? idx.byItem : idx.byCapture, r.id, r.scope) },
  );
}

// ---------------------------------------------------------------- deletion

/**
 * Deletes a capture, its proposals and its FTS row, and leaves an id-only tombstone in kv so saveCapture
 * answers a later save of the same id with { capture: null, duplicate: true, deleted: true } instead of
 * inserting it again. Items it produced that were never accepted are deleted
 * (none exist by construction). Accepted items keep their text: source_deleted = 1, source_capture_id and
 * source_quote are nulled, also inside their Undo history. Saved checkpoints keep their text and lose a
 * source_ref that pointed at the capture. Idempotent: a missing capture returns zero counts.
 */
export async function deleteCapture(db, id, scope, nowIso) {
  const s = oneScope(scope);
  requireNow(nowIso);
  const capture = await firstOf(db, 'SELECT id FROM captures WHERE id = ? AND scope = ?', id, s);
  if (!capture) return { captures: 0, proposals: 0, itemsDeleted: 0, itemsDetached: 0, checkpointsDetached: 0, attachments: 0 };
  const attachmentCount = await firstOf(db, 'SELECT COUNT(*) AS n FROM attachments WHERE capture_id = ?', id);
  const orphanIds = await rowsOf(
    db,
    "SELECT id, scope FROM items WHERE source_capture_id = ? AND origin = 'capture' AND id NOT IN " +
      "(SELECT item_id FROM proposals WHERE capture_id = ? AND state = 'accepted' AND item_id IS NOT NULL)",
    id,
    id,
  );
  const scrub = (col) =>
    `${col} = CASE WHEN ${col} IS NOT NULL AND json_extract(${col}, '$.source_capture_id') = ? ` +
    `THEN json_set(${col}, '$.source_capture_id', NULL, '$.source_quote', NULL, '$.source_deleted', 1) ELSE ${col} END`;
  const statements = [];
  for (const o of orphanIds) {
    statements.push(stmt(db, 'DELETE FROM items WHERE id = ?', o.id), ftsDelete(db, o.scope, `item:${o.id}`));
  }
  const detachIndex = statements.length;
  statements.push(
    stmt(db, 'UPDATE items SET source_deleted = 1, source_capture_id = NULL, source_quote = NULL WHERE source_capture_id = ?', id),
    stmt(db, `UPDATE changes SET ${scrub('before_json')}, ${scrub('after_json')} WHERE entity = 'item'`, id, id),
    // A saved checkpoint keeps the words the user saved (like an accepted item) but loses its link.
    stmt(db, 'UPDATE checkpoints SET source_ref = NULL WHERE source_ref = ?', `capture:${id}`),
  );
  const propIndex = statements.length;
  statements.push(
    stmt(db, 'DELETE FROM proposals WHERE capture_id = ?', id),
    stmt(db, 'DELETE FROM captures WHERE id = ? AND scope = ?', id, s),
    ftsDelete(db, s, `capture:${id}`),
    // Tombstone (id only): saveCapture refuses this id from now on, so an outbox retry cannot re-insert it.
    stmt(db, 'INSERT OR IGNORE INTO kv (key, value) VALUES (?, ?)', DELETED_CAPTURE_KEY + id, nowIso),
    stmt(db, 'DELETE FROM attachments WHERE capture_id = ?', id),
    ...(await purgeStatements(db, `capture:${id}`)),
  );
  const res = await db.batch(statements);
  return {
    captures: changesOf(res[propIndex + 1]),
    proposals: changesOf(res[propIndex]),
    itemsDeleted: orphanIds.length,
    itemsDetached: changesOf(res[detachIndex]),
    checkpointsDetached: changesOf(res[detachIndex + 2]),
    attachments: Number(attachmentCount.n),
  };
}

/**
 * Hard-deletes an item: the row, its search row and its attachments; cancels its reminders and blanks their
 * text; replaces its Undo history with {"deleted":true}; unlinks supersede pointers and checkpoint links to
 * it; leaves an id-only tombstone (a later create or restore of the id is refused); runs DERIVED_PURGERS.
 * Idempotent: a missing item returns { deleted: 0 }.
 */
export async function deleteItem(db, id, scope, nowIso) {
  const s = oneScope(scope);
  requireNow(nowIso);
  const item = await firstOf(db, 'SELECT id FROM items WHERE id = ? AND scope = ?', id, s);
  if (!item) return { deleted: 0, attachments: 0, reminders: 0 };
  const gone = '{"deleted":true}';
  // Counted first: on D1, meta.changes of a statement after an FTS5 write is not reliable.
  const counts = await firstOf(
    db,
    'SELECT (SELECT COUNT(*) FROM attachments WHERE item_id = ?) AS a, (SELECT COUNT(*) FROM reminders WHERE item_id = ?) AS r',
    id,
    id,
  );
  const res = await db.batch([
    stmt(db, 'DELETE FROM items WHERE id = ? AND scope = ?', id, s),
    ftsDelete(db, s, `item:${id}`),
    stmt(db, 'DELETE FROM attachments WHERE item_id = ?', id),
    stmt(
      db,
      "UPDATE reminders SET text = '', state = CASE WHEN state = 'active' THEN 'cancelled' ELSE state END, next_fire_at = NULL WHERE item_id = ?",
      id,
    ),
    stmt(
      db,
      'UPDATE changes SET before_json = CASE WHEN before_json IS NULL THEN NULL ELSE ? END, ' +
        "after_json = CASE WHEN after_json IS NULL THEN NULL ELSE ? END WHERE entity = 'item' AND entity_id = ?",
      gone,
      gone,
      id,
    ),
    stmt(db, 'UPDATE items SET superseded_by_id = NULL WHERE superseded_by_id = ?', id),
    stmt(db, 'UPDATE items SET supersedes_id = NULL WHERE supersedes_id = ?', id),
    stmt(db, 'UPDATE checkpoints SET source_ref = NULL WHERE source_ref = ?', `item:${id}`),
    stmt(db, 'INSERT OR IGNORE INTO kv (key, value) VALUES (?, ?)', DELETED_ITEM_KEY + id, nowIso),
    ...(await purgeStatements(db, `item:${id}`)),
  ]);
  const deleted = changesOf(res[0]);
  return { deleted, attachments: deleted ? Number(counts.a) : 0, reminders: deleted ? Number(counts.r) : 0 };
}

// ---------------------------------------------------------------- attachments

function chunks(list, n = 90) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

function bytesOf(value) {
  if (value == null) return new Uint8Array(0);
  return value instanceof Uint8Array ? value : new Uint8Array(value); // D1 may return an ArrayBuffer or number[]
}

export function b64encode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Strict base64 to bytes, or null when the text is not base64. */
export function b64decode(text) {
  if (typeof text !== 'string' || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  try {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function sha256Hex(bytes) {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('');
}

function attachmentName(name) {
  const n = reqText(name, 'name', 200).replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim();
  if (!n) throw new ValidationError('name is required', 'name');
  return n;
}

function attachmentMeta(row) {
  return { id: row.id, name: row.name, mime: row.mime, size: Number(row.size) };
}

function blobParam(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Stores one attachment on a capture or an item of the same scope. Idempotent by id: the same id with the
 * same bytes returns duplicate: true; different bytes or parent throws ConflictError. A deleted parent
 * throws GoneError, a missing one NotFoundError. The parent's search row is refreshed (names are searchable).
 */
export async function saveAttachment(db, { id, captureId = null, itemId = null, name, mime, bytes, sample = 0 }, scope, nowIso) {
  const s = oneScope(scope);
  requireNow(nowIso);
  if (typeof id !== 'string' || !CAPTURE_ID_RE.test(id)) throw new ValidationError('id must match ^[A-Za-z0-9_-]{8,80}$', 'id');
  if ((captureId == null) === (itemId == null)) throw new ValidationError('Give exactly one of capture_id or item_id', 'parent');
  for (const [v, f] of [[captureId, 'capture_id'], [itemId, 'item_id']]) if (v != null) optId(v, f);
  const cleanName = attachmentName(name);
  if (!ATTACHMENT_MIMES.includes(mime)) throw new ValidationError('This file type is not accepted', 'mime');
  const data = bytesOf(bytes);
  if (data.length < 1 || data.length > MAX_ATTACHMENT_BYTES) throw new ValidationError(`A file must be 1 to ${MAX_ATTACHMENT_BYTES} bytes`, 'size');
  const sha256 = await sha256Hex(data);
  const existing = await firstOf(db, `SELECT ${ATTACHMENT_META_COLS.join(', ')} FROM attachments WHERE id = ?`, id);
  if (existing) {
    if (existing.sha256 === sha256 && existing.scope === s && existing.capture_id === captureId && existing.item_id === itemId) {
      return { attachment: attachmentMeta(existing), duplicate: true };
    }
    throw new ConflictError('This attachment id already exists with different content', 'id_conflict');
  }
  const parentTable = captureId != null ? 'captures' : 'items';
  const parentId = captureId ?? itemId;
  const tomb = (captureId != null ? DELETED_CAPTURE_KEY : DELETED_ITEM_KEY) + parentId;
  if (await firstOf(db, 'SELECT 1 AS x FROM kv WHERE key = ?', tomb)) throw new GoneError('That capture or item was deleted');
  const parent = await firstOf(db, `SELECT id, sample FROM ${parentTable} WHERE id = ? AND scope = ?`, parentId, s);
  if (!parent) throw new NotFoundError('No such capture or item in this scope');
  const row = {
    id, scope: s, capture_id: captureId, item_id: itemId, name: cleanName, mime, size: data.length, sha256,
    created_at: nowIso, sample: sampleFlag(sample) || Number(parent.sample) || 0,
  };
  try {
    await db.batch([
      stmt(
        db,
        `INSERT INTO attachments (${ATTACHMENT_META_COLS.join(', ')}, data) VALUES (${marks(ATTACHMENT_META_COLS.length + 1)})`,
        ...ATTACHMENT_META_COLS.map((c) => row[c]),
        blobParam(data),
      ),
      ...(captureId != null ? ftsCaptureSync(db, s, captureId) : ftsItemSync(db, s, itemId)),
    ]);
  } catch (err) {
    if (await firstOf(db, 'SELECT id FROM attachments WHERE id = ?', id)) {
      return saveAttachment(db, { id, captureId, itemId, name, mime, bytes, sample }, scope, nowIso);
    }
    throw err;
  }
  return { attachment: attachmentMeta(row), duplicate: false };
}

/** One attachment with its bytes (Uint8Array), or null. */
export async function getAttachment(db, id, scope) {
  const s = oneScope(scope);
  const row = await firstOf(db, `SELECT ${ATTACHMENT_META_COLS.join(', ')}, data FROM attachments WHERE id = ? AND scope = ?`, id, s);
  if (!row) return null;
  return { ...canon(row, ATTACHMENT_META_COLS), data: bytesOf(row.data) };
}

// Attachment rows (with scope) for captures and items, keyed by parent id.
async function attachmentIndex(db, { captureIds = [], itemIds = [] }) {
  const byCapture = new Map();
  const byItem = new Map();
  for (const [col, ids, map] of [['capture_id', captureIds, byCapture], ['item_id', itemIds, byItem]]) {
    for (const part of chunks([...new Set(ids)])) {
      const rows = await rowsOf(
        db,
        `SELECT id, scope, name, mime, size, ${col} AS parent FROM attachments WHERE ${col} IN (${marks(part.length)}) ORDER BY created_at, rowid`,
        ...part,
      );
      for (const r of rows) map.set(r.parent, [...(map.get(r.parent) || []), r]);
    }
  }
  return { byCapture, byItem };
}

// Only attachments of the row's own scope are ever listed with it (a personal item filed from a work
// capture does not show the work capture's files, and the reverse cannot happen).
function listFor(map, key, scope) {
  return (map.get(key) || []).filter((a) => a.scope === scope).map(attachmentMeta);
}

/** Adds attachments: [{ id, name, mime, size }] to item rows: their own, then their source capture's. */
export async function withItemAttachments(db, items) {
  if (!items.length) return items;
  const idx = await attachmentIndex(db, {
    itemIds: items.map((i) => i.id),
    captureIds: items.map((i) => i.source_capture_id).filter(Boolean),
  });
  return items.map((i) => ({ ...i, attachments: [...listFor(idx.byItem, i.id, i.scope), ...listFor(idx.byCapture, i.source_capture_id, i.scope)] }));
}

/** Adds attachments: [{ id, name, mime, size }] to capture rows. */
export async function withCaptureAttachments(db, captures) {
  if (!captures.length) return captures;
  const idx = await attachmentIndex(db, { captureIds: captures.map((c) => c.id) });
  return captures.map((c) => ({ ...c, attachments: listFor(idx.byCapture, c.id, c.scope) }));
}

// ---------------------------------------------------------------- preferences (editable memory)

function preferenceKey(key) {
  if (typeof key !== 'string' || !PREF_KEY_RE.test(key)) throw new ValidationError('key must match ^[a-z0-9_.-]{1,60}$', 'key');
  return key;
}

export async function listPreferences(db, scope) {
  const scopes = scopesFor(scope);
  const rows = await rowsOf(db, `SELECT * FROM preferences WHERE scope IN (${marks(scopes.length)}) ORDER BY key, scope`, ...scopes);
  return rows.map((r) => canon(r, PREFERENCE_COLS));
}

function preferenceWrite(db, row, guardUpdatedAt) {
  return guardUpdatedAt == null
    ? stmt(db, `INSERT OR IGNORE INTO preferences (${PREFERENCE_COLS.join(', ')}) VALUES (${marks(PREFERENCE_COLS.length)})`, ...PREFERENCE_COLS.map((c) => row[c]))
    : stmt(
        db,
        'UPDATE preferences SET value = ?, note = ?, updated_at = ? WHERE key = ? AND scope = ? AND updated_at = ?',
        row.value,
        row.note,
        row.updated_at,
        row.key,
        row.scope,
        guardUpdatedAt,
      );
}

/** Creates or replaces one preference. Only an explicit write ever creates one. Undoable. */
export async function putPreference(db, key, { value, note = null, sample = 0 } = {}, scope, nowIso) {
  const s = oneScope(scope);
  requireNow(nowIso);
  const k = preferenceKey(key);
  const v = reqText(value, 'value', 500).trim();
  const n = optText(note, 'note', 500);
  const row = await firstOf(db, 'SELECT * FROM preferences WHERE key = ? AND scope = ?', k, s);
  const before = row ? canon(row, PREFERENCE_COLS) : null;
  if (before && before.value === v && before.note === n) return { preference: before, changeId: null };
  const after = canon(
    { key: k, scope: s, value: v, note: n, created_at: before ? before.created_at : nowIso, updated_at: nowIso, sample: before ? before.sample : sampleFlag(sample) },
    PREFERENCE_COLS,
  );
  const res = await db.batch([
    preferenceWrite(db, after, before ? before.updated_at : null),
    changeStmtGuarded(db, { at: nowIso, entity: 'preference', entityId: k, op: before ? 'update' : 'create', before, after, scope: s }),
  ]);
  if (changesOf(res[0]) !== 1) throw new ConflictError('The preference changed while saving', 'concurrent_change');
  return { preference: after, changeId: Number(res[1].meta.last_row_id) };
}

/** Deletes one preference (undoable). Idempotent: a missing one returns { deleted: 0, changeId: null }. */
export async function deletePreference(db, key, scope, nowIso) {
  const s = oneScope(scope);
  requireNow(nowIso);
  const k = preferenceKey(key);
  const row = await firstOf(db, 'SELECT * FROM preferences WHERE key = ? AND scope = ?', k, s);
  if (!row) return { deleted: 0, changeId: null };
  const before = canon(row, PREFERENCE_COLS);
  const res = await db.batch([
    stmt(db, 'DELETE FROM preferences WHERE key = ? AND scope = ? AND updated_at = ?', k, s, before.updated_at),
    changeStmtGuarded(db, { at: nowIso, entity: 'preference', entityId: k, op: 'delete', before, after: null, scope: s }),
  ]);
  const deleted = changesOf(res[0]);
  return { deleted, changeId: deleted ? Number(res[1].meta.last_row_id) : null };
}

async function undoPreference(db, change, nowIso) {
  const before = parseJson(change.before_json);
  const after = parseJson(change.after_json);
  const k = change.entity_id;
  const s = oneScope(change.scope);
  const row = await firstOf(db, 'SELECT * FROM preferences WHERE key = ? AND scope = ?', k, s);
  const current = row ? canon(row, PREFERENCE_COLS) : null;
  const matches = after == null ? current == null : current != null && sameRow(after, current, PREFERENCE_COLS);
  if (!matches) throw new ConflictError('This has changed since; undo would overwrite newer edits', 'state_moved_on');
  if (!sidesMatch(change, before, after, 'key')) throw new ValidationError('This change cannot be undone');
  const restore = before ? canon(before, PREFERENCE_COLS) : null;
  const first = restore
    ? preferenceWrite(db, restore, current ? current.updated_at : null)
    : stmt(db, 'DELETE FROM preferences WHERE key = ? AND scope = ? AND updated_at = ?', k, s, current.updated_at);
  const res = await db.batch([
    first,
    stmt(db, 'UPDATE changes SET undone_at = ? WHERE id = ? AND undone_at IS NULL AND changes() = 1', nowIso, change.id),
  ]);
  if (changesOf(res[0]) !== 1) throw new ConflictError('This changed while undoing', 'concurrent_change');
  return { entity: 'preference', id: k, row: restore, changeId: change.id };
}

// ---------------------------------------------------------------- export

/**
 * Every user table's rows for the scope ('work', 'personal' or 'all'). push_subscriptions, kv, events and
 * the FTS tables are excluded. Every row carries its scope (deliveries take their reminder's scope).
 * meta (not scoped) is included only with scope 'all'.
 */
export async function exportData(db, scope) {
  const scopes = scopesFor(scope);
  const inS = `scope IN (${marks(scopes.length)})`;
  const ordered = async (table) => rowsOf(db, `SELECT * FROM ${table} WHERE ${inS} ORDER BY rowid`, ...scopes);
  const tables = {
    captures: await ordered('captures'),
    proposals: (await ordered('proposals')).map(proposalOut),
    projects: await ordered('projects'),
    items: await ordered('items'),
    checkpoints: await ordered('checkpoints'),
    changes: await rowsOf(db, `SELECT * FROM changes WHERE ${inS} ORDER BY id`, ...scopes),
    reminders: await ordered('reminders'),
    deliveries: await rowsOf(
      db,
      `SELECT ${DELIVERY_COLUMNS.split(', ').map((c) => 'd.' + c).join(', ')}, r.scope AS scope FROM deliveries d ` +
        `JOIN reminders r ON r.id = d.reminder_id WHERE r.scope IN (${marks(scopes.length)}) ORDER BY d.rowid`,
      ...scopes,
    ),
  };
  tables.attachments = (
    await rowsOf(db, `SELECT ${ATTACHMENT_META_COLS.join(', ')}, data FROM attachments WHERE ${inS} ORDER BY rowid`, ...scopes)
  ).map((r) => ({ ...canon(r, ATTACHMENT_META_COLS), data_b64: b64encode(bytesOf(r.data)) }));
  tables.preferences = await ordered('preferences');
  if (scope === 'all') tables.meta = await rowsOf(db, 'SELECT * FROM meta ORDER BY key');
  return { format: 'harrison-os-export', version: EXPORT_VERSION, scope, tables };
}

// ---------------------------------------------------------------- restore

export const EXPORT_VERSION = 2;

const RESTORE_COLS = {
  projects: PROJECT_COLS,
  captures: CAPTURE_COLS,
  proposals: ['id', 'capture_id', 'ordinal', 'kind', 'payload', 'state', 'item_id', 'scope', 'sample'],
  items: ITEM_COLS,
  checkpoints: CHECKPOINT_COLS,
  reminders: REMINDER_COLS,
  deliveries: DELIVERY_COLUMNS.split(', '),
  attachments: ATTACHMENT_META_COLS,
  preferences: PREFERENCE_COLS,
  changes: ['id', 'at', 'entity', 'entity_id', 'op', 'before_json', 'after_json', 'undone_at', 'scope'],
};
const RESTORE_ORDER = ['projects', 'captures', 'proposals', 'items', 'checkpoints', 'reminders', 'deliveries', 'attachments', 'preferences', 'changes'];

/**
 * Restores an exportData document. Inserts only rows whose ids are absent (never overwrites), never
 * re-inserts a deleted capture or item (nor what hangs off one: proposals, attachments, reminders, undo
 * history; a deleted source capture is scrubbed from items as deleteCapture would have), rejects rows
 * outside scope ('work', 'personal' or 'all') or linked across scopes, rebuilds search rows, and
 * reschedules active reminders from now so missed occurrences never fire (a missed one-off reminder is
 * cancelled and counted in reminders_not_rescheduled).
 * Returns { inserted: { table: n }, skipped_existing, skipped_deleted, rejected, reminders_not_rescheduled }.
 *
 * ponytail: loads every existing id of each restored table into memory and writes one batch per table.
 * Fine for one person's data (thousands of rows); a much larger restore should page through the document.
 */
export async function restoreData(db, data, scope, nowIso) {
  const scopes = scopesFor(scope);
  const nowMs = Date.parse(requireNow(nowIso));
  const tables = data && typeof data === 'object' ? data.tables : null;
  if (!data || data.format !== 'harrison-os-export' || ![1, EXPORT_VERSION].includes(data.version) || !tables || typeof tables !== 'object' || Array.isArray(tables)) {
    throw new ValidationError('This is not a Harrison OS export', 'data');
  }
  for (const name of [...RESTORE_ORDER, 'meta']) {
    if (tables[name] != null && !Array.isArray(tables[name])) throw new ValidationError(`tables.${name} must be a list`, 'data');
  }
  const out = { inserted: {}, skipped_existing: 0, skipped_deleted: 0, rejected: 0, reminders_not_rescheduled: 0 };

  // Known ids -> scope: what the database holds now, plus every row of the document (by its stated scope),
  // so a link to a row of another scope is caught whichever side it is on.
  const known = {};
  const keyOf = (table, r) => (table === 'preferences' ? `${r.key}|${r.scope}` : String(r.id));
  const existing = {};
  for (const table of RESTORE_ORDER) {
    const sql =
      table === 'deliveries' ? 'SELECT id AS k, NULL AS scope FROM deliveries'
        : table === 'preferences' ? "SELECT key || '|' || scope AS k, scope FROM preferences"
          : `SELECT id AS k, scope FROM ${table}`;
    existing[table] = new Map((await rowsOf(db, sql)).map((r) => [String(r.k), r.scope]));
    known[table] = new Map(existing[table]);
    for (const r of tables[table] || []) if (r && typeof r === 'object' && r.id != null && !known[table].has(String(r.id))) known[table].set(String(r.id), r.scope);
  }
  const tomb = new Set((await rowsOf(db, "SELECT key FROM kv WHERE key LIKE 'deleted_%'")).map((r) => r.key));
  const deletedCapture = (id) => id != null && tomb.has(DELETED_CAPTURE_KEY + id);
  const deletedItem = (id) => id != null && tomb.has(DELETED_ITEM_KEY + id);
  const crossScope = (table, id, s) => id != null && known[table].has(String(id)) && known[table].get(String(id)) !== s;
  const deletedRef = (ref) =>
    typeof ref === 'string' && ((ref.startsWith('capture:') && deletedCapture(ref.slice(8))) || (ref.startsWith('item:') && deletedItem(ref.slice(5))));
  const skippedReminders = new Set();
  const accepted = { captures: new Map(), items: new Map() }; // id -> scope of rows this restore inserted
  const scrubSource = (row) =>
    row && deletedCapture(row.source_capture_id) ? { ...row, source_capture_id: null, source_quote: null, source_deleted: 1 } : row;

  // Each rule returns 'ok' (with the row to insert), 'deleted' or 'rejected'.
  const rules = {
    projects: (r) => ['ok', r],
    captures: (r) => (deletedCapture(r.id) ? ['deleted'] : ['ok', r]),
    proposals: (r) =>
      deletedCapture(r.capture_id) ? ['deleted']
        : crossScope('captures', r.capture_id, r.scope) ? ['rejected']
          : ['ok', { ...r, payload: typeof r.payload === 'string' ? r.payload : JSON.stringify(r.payload ?? null) }],
    items: (r) => {
      if (deletedItem(r.id)) return ['deleted'];
      // (source_capture_id may name a work capture for a personal item: review allows the narrower scope.)
      if (crossScope('projects', r.project_id, r.scope)) return ['rejected'];
      if (crossScope('items', r.supersedes_id, r.scope) || crossScope('items', r.superseded_by_id, r.scope)) return ['rejected'];
      let row;
      try {
        // The same field and cross-field rules as a create or edit.
        row = checkItemRow(validateItemValues(scrubSource(canon(r, ITEM_COLS))));
      } catch {
        return ['rejected'];
      }
      return ['ok', { ...row, supersedes_id: deletedItem(r.supersedes_id) ? null : r.supersedes_id, superseded_by_id: deletedItem(r.superseded_by_id) ? null : r.superseded_by_id }];
    },
    checkpoints: (r) => (crossScope('projects', r.project_id, r.scope) ? ['rejected'] : ['ok', { ...r, source_ref: deletedRef(r.source_ref) ? null : r.source_ref }]),
    reminders: (r) => {
      if (deletedItem(r.item_id)) return ['deleted'];
      if (crossScope('items', r.item_id, r.scope)) return ['rejected'];
      const row = { ...r };
      const next = r.next_fire_at == null ? null : Number(r.next_fire_at);
      if (row.state === 'active' && (next == null || !(next > nowMs))) {
        if (row.recurrence === 'daily') {
          try {
            row.next_fire_at = nextDailyOccurrence({ time: row.local_time, timeZone: row.time_zone, afterMs: nowMs }).instantMs;
          } catch {
            return ['rejected'];
          }
        } else {
          row.state = 'cancelled';
          row.next_fire_at = null;
          out.reminders_not_rescheduled++;
        }
      }
      return ['ok', row];
    },
    deliveries: (r) => (skippedReminders.has(String(r.reminder_id)) ? ['deleted'] : known.reminders.get(String(r.reminder_id)) !== r.scope ? ['rejected'] : ['ok', r]),
    attachments: async (r) => {
      if (deletedCapture(r.capture_id) || deletedItem(r.item_id)) return ['deleted'];
      // Exactly one parent, which exists (already, or restored above) in the same scope.
      if ((r.capture_id == null) === (r.item_id == null)) return ['rejected'];
      const [t, pid] = r.capture_id != null ? ['captures', String(r.capture_id)] : ['items', String(r.item_id)];
      if ((existing[t].get(pid) ?? accepted[t].get(pid)) !== r.scope) return ['rejected'];
      const bytes = b64decode(r.data_b64);
      if (!bytes || bytes.length < 1 || bytes.length > MAX_ATTACHMENT_BYTES || !ATTACHMENT_MIMES.includes(r.mime)) return ['rejected'];
      return ['ok', { ...r, size: bytes.length, sha256: await sha256Hex(bytes), bytes }];
    },
    preferences: (r) => (typeof r.key === 'string' && PREF_KEY_RE.test(r.key) && typeof r.value === 'string' && r.value.length <= 500 ? ['ok', r] : ['rejected']),
    changes: (r) => {
      if (r.entity === 'item' && deletedItem(r.entity_id)) return ['deleted'];
      // Undo replays before/after: each side must be the named row in the row's scope (see undoChange).
      if (!['item', 'project', 'preference'].includes(r.entity)) return ['rejected'];
      const [b, a] = [parseJson(r.before_json), parseJson(r.after_json)];
      if ([b, a].some((v) => v?.deleted === true && v.id === undefined)) return ['deleted']; // scrubbed by deleteItem
      if (!sidesMatch(r, b, a, r.entity === 'preference' ? 'key' : 'id')) return ['rejected'];
      const scrub = (j) => {
        const v = parseJson(j);
        return v && deletedCapture(v.source_capture_id) ? JSON.stringify(scrubSource(v)) : j ?? null;
      };
      return ['ok', { ...r, before_json: scrub(r.before_json), after_json: scrub(r.after_json) }];
    },
  };

  const ftsRefresh = [];
  for (const table of RESTORE_ORDER) {
    const cols = RESTORE_COLS[table];
    const statements = [];
    const labels = [];
    for (const r of tables[table] || []) {
      if (!r || typeof r !== 'object' || !scopes.includes(r.scope) || (table !== 'preferences' && r.id == null)) {
        out.rejected++;
        continue;
      }
      if (existing[table].has(keyOf(table, r))) {
        out.skipped_existing++;
        continue;
      }
      const [verdict, row] = await rules[table](r);
      if (verdict !== 'ok') {
        if (table === 'reminders') skippedReminders.add(String(r.id));
        out[verdict === 'deleted' ? 'skipped_deleted' : 'rejected']++;
        continue;
      }
      const values = cols.map((c) => (row[c] === undefined ? (COLUMN_DEFAULTS[c] ?? null) : norm(row[c])));
      if (values.some((v) => v !== null && typeof v === 'object')) {
        out.rejected++;
        continue;
      }
      const extraCol = table === 'attachments' ? ', data' : '';
      const extra = table === 'attachments' ? [blobParam(row.bytes)] : [];
      statements.push(stmt(db, `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}${extraCol}) VALUES (${marks(cols.length + extra.length)})`, ...values, ...extra));
      labels.push(row);
    }
    let results;
    try {
      results = statements.length ? await db.batch(statements) : [];
    } catch {
      // A row the schema refuses (bad state, missing column) fails the whole batch: retry one by one.
      results = [];
      for (const st of statements) {
        try {
          results.push(await st.run());
        } catch {
          results.push(null);
        }
      }
    }
    let n = 0;
    results.forEach((res, i) => {
      const row = labels[i];
      if (res === null) {
        out.rejected++;
        if (table === 'reminders') skippedReminders.add(String(row.id));
      } else if (changesOf(res) === 1) {
        n++;
        accepted[table]?.set(String(row.id), row.scope);
        if (table === 'items') ftsRefresh.push(...ftsItemSync(db, row.scope, row.id));
        if (table === 'projects') ftsRefresh.push(...ftsProjectSync(db, row.scope, row.id));
        if (table === 'captures') ftsRefresh.push(...ftsCaptureSync(db, row.scope, row.id));
      } else {
        out.skipped_existing++;
      }
    });
    if (n) out.inserted[table] = n;
  }
  // Search rows last, so attachment names are part of their parents' rows.
  if (ftsRefresh.length) await db.batch(ftsRefresh);
  if (scope === 'all' && Array.isArray(tables.meta)) {
    const meta = tables.meta.filter((m) => m && typeof m.key === 'string' && (m.value == null || typeof m.value === 'string'));
    if (meta.length) {
      const res = await db.batch(meta.map((m) => stmt(db, 'INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', m.key, m.value ?? null)));
      const n = res.filter((x) => changesOf(x) === 1).length;
      if (n) out.inserted.meta = n;
    }
  }
  return out;
}

// ---------------------------------------------------------------- meta

export async function getMeta(db, key) {
  const row = await firstOf(db, 'SELECT value FROM meta WHERE key = ?', String(key));
  return row ? row.value : null;
}

export async function setMeta(db, key, value) {
  await stmt(
    db,
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    String(key),
    value == null ? null : String(value),
  ).run();
}

// ---------------------------------------------------------------- reminders (scoped)

function buildReminderRow({ id, text, localDate, localTime, timeZone, recurrence = 'none', itemId = null, sample = 0 }, scope, nowIso) {
  const s = oneScope(scope);
  const nowMs = Date.parse(requireNow(nowIso));
  if (typeof id !== 'string' || !ENTITY_ID_RE.test(id)) throw new ValidationError('id is not valid', 'id');
  reqText(text, 'text', 4000);
  if (!isDateOn(localDate) || typeof localTime !== 'string' || !TIME_RE.test(localTime)) {
    throw new ValidationError('A reminder needs a date (YYYY-MM-DD) and a time (HH:MM)', 'when');
  }
  if (typeof timeZone !== 'string' || !timeZone) throw new ValidationError('A reminder needs a time zone', 'timeZone');
  if (recurrence !== 'none' && recurrence !== 'daily') throw new ValidationError("recurrence must be 'none' or 'daily'", 'recurrence');
  let first;
  try {
    const at = zonedWallTimeToInstant({ date: localDate, time: localTime, timeZone });
    if (recurrence === 'none') {
      if (at.instantMs <= nowMs) throw new ValidationError('That local date and time has already passed', 'in_past');
      first = at;
    } else if (at.instantMs > nowMs) {
      first = at;
    } else {
      first = nextDailyOccurrence({ time: localTime, timeZone, afterMs: nowMs });
    }
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError('Date, time or time zone is not valid', 'when');
  }
  const row = canon(
    {
      id, text, scope: s, time_zone: timeZone, local_date: localDate, local_time: localTime, recurrence,
      next_fire_at: first.instantMs, state: 'active', created_at: nowIso, sample: sampleFlag(sample), item_id: optId(itemId, 'itemId'),
    },
    REMINDER_COLS,
  );
  return { row, firstFire: { instantMs: first.instantMs, adjustment: first.adjustment } };
}

/** Idempotent by id (same content returns duplicate: true; different content throws ConflictError). */
export async function createReminder(db, fields, scope, nowIso) {
  const s = oneScope(scope);
  const f = fields || {};
  const id = f.id;
  const existing = typeof id === 'string' ? await firstOf(db, 'SELECT * FROM reminders WHERE id = ?', id) : null;
  if (existing) {
    const same =
      existing.text === f.text && existing.scope === s && existing.local_date === f.localDate && existing.local_time === f.localTime &&
      existing.time_zone === f.timeZone && existing.recurrence === (f.recurrence ?? 'none');
    if (!same) throw new ConflictError('This reminder id already exists with different content', 'id_conflict');
    return { reminder: existing, duplicate: true };
  }
  const itemId = f.itemId ?? f.item_id ?? null;
  if (itemId != null) {
    const item = await firstOf(db, 'SELECT id FROM items WHERE id = ? AND scope = ?', itemId, s);
    if (!item) throw new NotFoundError('No such item in this scope');
  }
  const { row, firstFire } = buildReminderRow({ ...f, itemId }, s, nowIso);
  const res = await stmt(
    db,
    `INSERT OR IGNORE INTO reminders (${REMINDER_COLS.join(', ')}) VALUES (${marks(REMINDER_COLS.length)})`,
    ...REMINDER_COLS.map((c) => row[c]),
  ).run();
  if (changesOf(res) !== 1) return createReminder(db, fields, scope, nowIso);
  return { reminder: row, duplicate: false, firstFire };
}

export async function getReminder(db, id, scope) {
  const s = oneScope(scope);
  return firstOf(db, 'SELECT * FROM reminders WHERE id = ? AND scope = ?', id, s);
}

export async function listReminders(db, scope, { limit = 100 } = {}) {
  const s = oneScope(scope);
  const n = Math.max(1, Math.min(200, Number(limit) || 100));
  const reminders = await rowsOf(db, 'SELECT * FROM reminders WHERE scope = ? ORDER BY created_at DESC, id DESC LIMIT ?', s, n);
  if (!reminders.length) return [];
  const ids = reminders.map((r) => r.id);
  const deliveries = await rowsOf(
    db,
    `SELECT ${DELIVERY_COLUMNS} FROM deliveries WHERE reminder_id IN (${marks(ids.length)}) ORDER BY scheduled_for DESC LIMIT 2000`,
    ...ids,
  );
  const by = new Map();
  for (const d of deliveries) {
    const list = by.get(d.reminder_id) || [];
    if (list.length < 20) list.push(d);
    by.set(d.reminder_id, list);
  }
  return reminders.map((r) => ({ ...r, deliveries: by.get(r.id) || [] }));
}

export async function cancelReminder(db, id, scope) {
  const s = oneScope(scope);
  const row = await firstOf(db, 'SELECT * FROM reminders WHERE id = ? AND scope = ?', id, s);
  if (!row) throw new NotFoundError('No such reminder');
  let cancelled = false;
  if (row.state === 'active') {
    const r = await stmt(db, "UPDATE reminders SET state = 'cancelled', next_fire_at = NULL WHERE id = ? AND state = 'active'", id).run();
    cancelled = changesOf(r) === 1;
  }
  return { reminder: await firstOf(db, 'SELECT * FROM reminders WHERE id = ?', id), cancelled, previousState: row.state };
}

// ---------------------------------------------------------------- SYSTEM: reminder cron and deliveries
// Cross-scope by nature: the cron sends every due reminder. Callers must never expose these rows to a
// scoped view.

/** SYSTEM. Active reminders due at nowMs, oldest first. */
export async function listDueReminders(db, nowMs, limit) {
  return rowsOf(
    db,
    "SELECT * FROM reminders WHERE state = 'active' AND next_fire_at IS NOT NULL AND next_fire_at <= ? ORDER BY next_fire_at, id LIMIT ?",
    nowMs,
    limit,
  );
}

/** SYSTEM. Held deliveries whose hold has ended, with their reminder's text and state. */
export async function listReleasableDeliveries(db, nowMs, limit) {
  return rowsOf(
    db,
    'SELECT d.id, d.reminder_id, d.scheduled_for, d.local_label, d.held_until, r.text AS text, r.state AS reminder_state ' +
      "FROM deliveries d LEFT JOIN reminders r ON r.id = d.reminder_id WHERE d.state = 'held_by_policy' AND d.held_until <= ? " +
      'ORDER BY d.held_until LIMIT ?',
    nowMs,
    limit,
  );
}

/** SYSTEM. One row per occurrence; returns { inserted } (false when UNIQUE(reminder_id, scheduled_for) guarded). */
export async function insertDelivery(db, { id, reminderId, scheduledFor, localLabel }, nowIso) {
  const r = await stmt(
    db,
    'INSERT OR IGNORE INTO deliveries (id, reminder_id, scheduled_for, local_label, state, attempts, created_at) ' +
      "VALUES (?, ?, ?, ?, 'scheduled', 0, ?)",
    id,
    reminderId,
    scheduledFor,
    localLabel,
    requireNow(nowIso),
  ).run();
  return { inserted: changesOf(r) === 1 };
}

/** SYSTEM. scheduled -> held_by_policy until heldUntil (ms). */
export async function holdDelivery(db, id, heldUntil) {
  const r = await stmt(db, "UPDATE deliveries SET state = 'held_by_policy', held_until = ? WHERE id = ? AND state = 'scheduled'", heldUntil, id).run();
  return changesOf(r) === 1;
}

/** SYSTEM. Moves held_until of a still-held delivery; with expectedHeldUntil it is a compare-and-set claim. */
export async function setDeliveryHeldUntil(db, id, heldUntil, expectedHeldUntil) {
  const r =
    expectedHeldUntil === undefined
      ? await stmt(db, 'UPDATE deliveries SET held_until = ? WHERE id = ?', heldUntil, id).run()
      : await stmt(
          db,
          "UPDATE deliveries SET held_until = ? WHERE id = ? AND state = 'held_by_policy' AND held_until = ?",
          heldUntil,
          id,
          expectedHeldUntil,
        ).run();
  return changesOf(r) === 1;
}

/** SYSTEM. Records a send outcome. Never moves state backwards (a beacon or ack that came first is kept). */
export async function recordDeliveryOutcome(db, id, { state, pushStatus = null, attempts = 0, sentAt = null, error = null }) {
  await stmt(
    db,
    "UPDATE deliveries SET state = CASE WHEN state IN ('scheduled', 'held_by_policy') THEN ? ELSE state END, " +
      'push_status = ?, attempts = attempts + ?, sent_at = COALESCE(sent_at, ?), error = ? WHERE id = ?',
    state,
    pushStatus,
    attempts,
    sentAt,
    error,
    id,
  ).run();
}

/** SYSTEM. */
export async function markDeliveryFailed(db, id, error) {
  await stmt(
    db,
    "UPDATE deliveries SET state = CASE WHEN state IN ('scheduled', 'held_by_policy') THEN 'failed' ELSE state END, error = ? WHERE id = ?",
    error,
    id,
  ).run();
}

/** SYSTEM. nextFireAt null marks a one-off reminder done. Guarded on the occurrence that was sent. */
export async function advanceReminder(db, id, scheduledFor, nextFireAt) {
  const r =
    nextFireAt == null
      ? await stmt(db, "UPDATE reminders SET state = 'done', next_fire_at = NULL WHERE id = ? AND state = 'active' AND next_fire_at = ?", id, scheduledFor).run()
      : await stmt(db, "UPDATE reminders SET next_fire_at = ? WHERE id = ? AND state = 'active' AND next_fire_at = ?", nextFireAt, id, scheduledFor).run();
  return changesOf(r) === 1;
}

/** SYSTEM. */
export async function getDelivery(db, id) {
  return firstOf(db, `SELECT ${DELIVERY_COLUMNS} FROM deliveries WHERE id = ?`, id);
}

/** SYSTEM. Device beacon: first receipt time is kept; an acknowledged delivery stays acknowledged. */
export async function markDeliveryReceived(db, id, nowIso) {
  await stmt(
    db,
    'UPDATE deliveries SET received_at = COALESCE(received_at, ?), ' +
      "state = CASE WHEN state IN ('received_on_device', 'acknowledged') THEN state ELSE 'received_on_device' END WHERE id = ?",
    requireNow(nowIso),
    id,
  ).run();
  return getDelivery(db, id);
}

/** SYSTEM. via is 'notification' or 'in_app'. First acknowledgement wins. */
export async function acknowledgeDelivery(db, id, via, nowIso) {
  if (via !== 'notification' && via !== 'in_app') throw new ValidationError("via must be 'notification' or 'in_app'", 'via');
  await stmt(
    db,
    "UPDATE deliveries SET acknowledged_at = COALESCE(acknowledged_at, ?), ack_via = COALESCE(ack_via, ?), state = 'acknowledged' WHERE id = ?",
    requireNow(nowIso),
    via,
    id,
  ).run();
  return getDelivery(db, id);
}

/** SYSTEM. Counts by state for evidence views (no text). */
export async function deliveryStats(db) {
  const d = await rowsOf(db, 'SELECT state, COUNT(*) AS n FROM deliveries GROUP BY state');
  const r = await rowsOf(db, 'SELECT state, COUNT(*) AS n FROM reminders GROUP BY state');
  const toObj = (rows) => Object.fromEntries(rows.map((x) => [x.state, Number(x.n)]));
  return { deliveriesByState: toObj(d), remindersByState: toObj(r), pushSubscriptions: await countPushSubscriptions(db) };
}

// ---------------------------------------------------------------- SYSTEM: push subscriptions

export async function listPushSubscriptions(db, limit = 10) {
  return rowsOf(db, 'SELECT id, endpoint, p256dh, auth FROM push_subscriptions ORDER BY created_at, id LIMIT ?', limit);
}

export async function countPushSubscriptions(db) {
  const row = await firstOf(db, 'SELECT COUNT(*) AS n FROM push_subscriptions');
  return row ? Number(row.n) : 0;
}

/** id is the sha256 hex of the endpoint (computed by the caller). Returns { created }. */
export async function upsertPushSubscription(db, { id, endpoint, p256dh, auth, ua = null }, nowIso) {
  const before = await firstOf(db, 'SELECT id FROM push_subscriptions WHERE id = ?', id);
  await stmt(
    db,
    'INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, ua, created_at) VALUES (?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua',
    id,
    endpoint,
    p256dh,
    auth,
    ua,
    requireNow(nowIso),
  ).run();
  return { created: !before };
}

export async function deletePushSubscription(db, id) {
  return changesOf(await stmt(db, 'DELETE FROM push_subscriptions WHERE id = ?', id).run());
}

export async function updatePushSubscriptionStatus(db, id, status, ok, nowIso) {
  await stmt(
    db,
    'UPDATE push_subscriptions SET last_status = ?, last_ok_at = CASE WHEN ? = 1 THEN ? ELSE last_ok_at END WHERE id = ?',
    status,
    ok ? 1 : 0,
    requireNow(nowIso),
    id,
  ).run();
}

// ---------------------------------------------------------------- SYSTEM: kv

export async function kvGet(db, key, nowMs) {
  const row = await firstOf(db, 'SELECT value, expires_at FROM kv WHERE key = ?', key);
  if (!row) return null;
  if (row.expires_at != null && Number(row.expires_at) <= nowMs) return null;
  return row.value;
}

/** Raw row (value, expires_at) without the expiry check, for the VAPID JWT cache. */
export async function kvGetRow(db, key) {
  return firstOf(db, 'SELECT value, expires_at FROM kv WHERE key = ?', key);
}

export async function kvPut(db, key, value, expiresAt = null) {
  await stmt(
    db,
    'INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at',
    key,
    String(value),
    expiresAt,
  ).run();
}

/** Atomically decrements an integer counter if it is positive. Returns true when it did. */
export async function kvDecrementIfPositive(db, key) {
  const r = await stmt(db, 'UPDATE kv SET value = CAST(CAST(value AS INTEGER) - 1 AS TEXT) WHERE key = ? AND CAST(value AS INTEGER) > 0', key).run();
  return changesOf(r) === 1;
}

// ---------------------------------------------------------------- SYSTEM: events (never user text)

/** detail: IDs, states, counts, timestamps and status codes only. Never item, capture or project text. */
export async function logEvent(db, nowIso, kind, ref = null, detail = null) {
  await stmt(
    db,
    'INSERT INTO events (at, kind, ref, detail) VALUES (?, ?, ?, ?)',
    requireNow(nowIso),
    String(kind),
    ref == null ? null : String(ref),
    detail ? JSON.stringify(detail) : null,
  ).run();
}

export async function listEvents(db, limit = 200) {
  const rows = await rowsOf(db, 'SELECT id, at, kind, ref, detail FROM events ORDER BY id DESC LIMIT ?', limit);
  return rows.map((e) => ({ ...e, detail: parseJson(e.detail) }));
}

export async function pruneEvents(db, keep) {
  return changesOf(await stmt(db, 'DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - ?', keep).run());
}
