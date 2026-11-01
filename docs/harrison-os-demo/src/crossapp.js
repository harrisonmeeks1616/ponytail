// Cross-app actions: AI clients (Ask in Full mode, MCP clients) acting on Electrical PM, and on Field Hub
// through PM, by calling PM's own private command entrypoint. Contract: docs/CROSS_APP_ACTIONS.md.
//
// GET /api/connections/crossapp          owner only: { configured, grant, actions, read_actions, projects }
// PUT /api/connections/crossapp/grant    owner only: { clients, projects, actions, includeSensitive? } -> same shape
//
// Authority:
// - The only path is env.PM_COMMANDS_SERVICE.execute({ action, projectId, recordId?, operationId?, requestId?,
//   body?, query? }), a private Workers service binding. PM's native API does the work: validation, record
//   schema, expectedRevision, Field Hub operation intent, conflicts, history. PM's own server config decides the
//   projects and actor it accepts; nothing here can widen that. Harrison OS never holds a Field Hub credential.
// - This module adds Harrison's own narrower limits on top: which AI clients, which projects and which actions.
//   The grant is read fresh on every call; no tool, record or web page can reach these routes (authorizeRoute
//   keeps the AI identities on record routes). Default: nothing is allowed.
// - Results are PM's own answer (data, receipt, conflict state), passed on bounded and labelled untrusted.
//   The copied pm_records table (src/pm.js) is never read or written here: it is a copy, not the source.

import * as db from './db.js';
import * as pm from './pm.js';
import { HttpError, json, apiError, iso, readJson } from './http.js';

export const ACTIONS = Object.freeze([
  'project.read', 'metadata.read', 'records.list', 'record.read', 'record.create', 'record.update', 'record.archive', 'record.restore',
  'field.status', 'field.read', 'field.pending', 'field.edit', 'field.retry',
]);
export const READ_ACTIONS = Object.freeze(['project.read', 'metadata.read', 'records.list', 'record.read', 'field.status', 'field.read', 'field.pending']);
export const CLIENTS = Object.freeze(['ask', 'mcp']);
export const PROJECT_ID_PATTERN = '^[A-Za-z0-9_.:-]{1,120}$';
const PROJECT_ID_RE = new RegExp(PROJECT_ID_PATTERN);
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_PROJECTS = 20;
const GRANT_KEY = 'crossapp_grant';
export const CALL_TIMEOUT_MS = 15000;
export const MAX_FIELDS_CHARS = 32 * 1024;

export function commandsConfigured(env) {
  return !!(env && env.PM_COMMANDS_SERVICE && typeof env.PM_COMMANDS_SERVICE.execute === 'function');
}

// ---------------------------------------------------------------- the owner's cross-app grant

// includeSensitive (default false): financial record types and secure fields. Off, they never reach the model
// and writes to them are refused; on, the validated native operations may use them too.
const EMPTY = Object.freeze({ clients: [], projects: [], actions: [], includeSensitive: false, updated_at: null });

function checkGrant(body) {
  const bad = (code, message) => new HttpError(400, code, message);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('invalid_grant', 'Send { clients, projects, actions, includeSensitive }');
  if (Object.keys(body).some((k) => !['clients', 'projects', 'actions', 'includeSensitive'].includes(k))) throw bad('invalid_grant', 'Only clients, projects, actions and includeSensitive can be set');
  if (body.includeSensitive !== undefined && typeof body.includeSensitive !== 'boolean') throw bad('invalid_include_sensitive', 'includeSensitive must be true or false');
  const list = (v, name, ok, max) => {
    if (!Array.isArray(v) || v.length > max || new Set(v).size !== v.length || !v.every(ok)) throw bad(`invalid_${name}`, `${name} must list distinct valid entries (at most ${max})`);
    return v;
  };
  const clients = list(body.clients, 'clients', (c) => CLIENTS.includes(c), CLIENTS.length);
  const projects = list(body.projects, 'projects', (p) => typeof p === 'string' && PROJECT_ID_RE.test(p), MAX_PROJECTS);
  const actions = list(body.actions, 'actions', (a) => ACTIONS.includes(a), ACTIONS.length);
  return { clients: CLIENTS.filter((c) => clients.includes(c)), projects, actions: ACTIONS.filter((a) => actions.includes(a)), includeSensitive: body.includeSensitive === true };
}

/** The grant in force, read fresh. No row, or one that cannot be read, allows nothing. */
export async function readCrossGrant(env, nowMs = Date.now()) {
  try {
    const raw = env.DB ? await db.kvGet(env.DB, GRANT_KEY, nowMs) : null;
    if (raw === null) return { ...EMPTY };
    const stored = JSON.parse(raw);
    return { ...checkGrant({ clients: stored.clients, projects: stored.projects, actions: stored.actions, includeSensitive: stored.includeSensitive === true }), updated_at: typeof stored.updated_at === 'string' ? stored.updated_at : null };
  } catch {
    return { ...EMPTY };
  }
}

/** Does the grant let this client use this action at all (for listing tools)? */
export function allowsAction(g, client, action) {
  return !!g && g.clients.includes(client) && g.actions.includes(action) && g.projects.length > 0;
}

/** Why the grant refuses one call, or null. */
export function refusal(g, client, action, projectId) {
  if (!g.clients.includes(client)) return { code: 'crossapp_off', message: 'Harrison has not allowed this AI client to act on Electrical PM or Field Hub. Nothing was read or changed.' };
  if (!g.actions.includes(action)) return { code: 'action_not_allowed', message: `Harrison has not allowed ${action} for AI clients. Nothing was read or changed.` };
  if (!g.projects.includes(projectId)) return { code: 'project_not_allowed', message: `Project ${projectId} is not in the projects Harrison allowed. Nothing was read or changed. Allowed: ${g.projects.join(', ') || 'none'}.` };
  return null;
}

// ---------------------------------------------------------------- one call to PM

/**
 * A request id for a write: the caller's (a retry of an earlier attempt), else one made from who asks, the
 * action, the target and the exact body, per UTC minute. The same request within the minute is the same id, so
 * PM replays it instead of applying it twice. ponytail: a deliberate repeat of an identical write inside one
 * minute is deduplicated too; a different request_id is the way to say "again".
 */
export async function requestIdFor(given, { actor, action, projectId, recordId = null, body = null, nowMs }) {
  if (typeof given === 'string' && REQUEST_ID_RE.test(given)) return given;
  const text = JSON.stringify([actor, action, projectId, recordId, canonical(body), Math.floor(nowMs / 60000)]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `hos_${[...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}

const clip = (v, n) => String(v ?? '').slice(0, n);

/**
 * Calls PM once, with a deadline. -> { ok: true, data, receipt } | { ok: false, code, message, status?, current? }.
 * A timeout or a thrown call is 'unavailable' with outcome_unknown for a write: the write may have happened, so
 * the answer says to read the record again or retry with the same requestId (PM replays, never applies twice).
 */
export async function execute(env, request, { timeoutMs = CALL_TIMEOUT_MS, write = false } = {}) {
  if (!commandsConfigured(env)) return { ok: false, code: 'not_configured', message: 'The private Electrical PM command connection is not set up on this server.' };
  let timer;
  let res;
  try {
    res = await Promise.race([
      Promise.resolve().then(() => env.PM_COMMANDS_SERVICE.execute(request)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
  } catch (err) {
    const timedOut = err && err.message === 'timeout';
    return {
      ok: false,
      code: timedOut ? 'timeout' : 'unavailable',
      message: `${timedOut ? 'Electrical PM did not answer in time.' : 'Electrical PM could not be reached.'}${write ? ` The change may or may not have been made: read it again, or retry with request_id ${request.requestId} (PM will not apply it twice).` : ''}`,
      outcome_unknown: write,
    };
  } finally {
    clearTimeout(timer);
  }
  if (!res || typeof res !== 'object' || typeof res.ok !== 'boolean') {
    return { ok: false, code: 'bad_answer', message: 'Electrical PM answered in a shape Harrison OS does not know, so nothing is reported as done.', outcome_unknown: write };
  }
  if (res.ok) return { ok: true, data: res.data === undefined ? null : res.data, receipt: res.receipt && typeof res.receipt === 'object' ? res.receipt : null };
  const e = res.error && typeof res.error === 'object' ? res.error : {};
  return {
    ok: false,
    code: clip(e.code || 'refused', 60),
    message: clip(e.message || 'Electrical PM refused the request.', 500),
    ...(Number.isInteger(e.status) ? { status: e.status } : {}),
    ...(e.current !== undefined ? { current: e.current } : {}),
  };
}

// ---------------------------------------------------------------- records against PM's declared metadata
// metadata.read (docs/CROSS_APP_ACTIONS.md section 4) declares, per record type, its statuses, its top-level wire
// keys and its data / financial / internalData fields, each with a kind, and maps every kind to a JSON value form.
// Nothing is guessed: an undeclared key, a kind without a value form, or a secure field is refused here, before
// PM is asked. PM validates everything again.

export const SECTIONS = Object.freeze(['data', 'financial', 'internalData']);
const FORMS = new Set(['string', 'text', 'number', 'integer', 'boolean', 'date', 'datetime', 'option', 'options', 'object', 'array']);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function typeOf(meta, typeId) {
  return (meta && Array.isArray(meta.recordTypes) && meta.recordTypes.find((t) => t && t.id === typeId)) || null;
}

function valueProblem(form, d, v) {
  if (v === null) return d.required ? 'is required' : null;
  const opts = Array.isArray(d.options) ? d.options : null;
  switch (form) {
    case 'string':
    case 'text':
      return typeof v !== 'string' ? 'must be text' : v.length > 20000 ? 'is longer than 20000 characters' : null;
    case 'integer':
      return Number.isInteger(v) ? null : 'must be a whole number';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? null : 'must be a number';
    case 'boolean':
      return typeof v === 'boolean' ? null : 'must be true or false';
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'must be a date YYYY-MM-DD';
    case 'datetime':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)) ? null : 'must be an ISO date and time';
    case 'option':
      return opts ? (opts.includes(v) ? null : `must be one of: ${opts.slice(0, 30).join(', ')}`) : typeof v === 'string' ? null : 'must be text';
    case 'options':
      return Array.isArray(v) && v.every((x) => (opts ? opts.includes(x) : typeof x === 'string')) ? null : `must be a list${opts ? ` of: ${opts.slice(0, 30).join(', ')}` : ' of text'}`;
    case 'object':
      return isObj(v) ? null : 'must be an object';
    case 'array':
      return Array.isArray(v) ? null : 'must be a list';
    default:
      return 'has no declared value form';
  }
}

/** A financial record type (recordVisibility 'financial'): hidden and read-only for AI unless includeSensitive. */
export const isFinancialType = (t) => !!t && t.recordVisibility === 'financial';

/**
 * Checks one write against the record type's metadata. write: { status?, topLevel, sections: { data?, ... } }.
 * Only the keys given are checked (an update sends each touched section whole, merged by mergeSections from the
 * complete record PM just returned, so keys not given, secure ones included, keep their current values).
 * sensitive false: a financial type or a secure key is refused. -> error text, or null.
 */
export function checkRecordWrite(meta, typeId, write, { create = false, sensitive = false } = {}) {
  const t = typeOf(meta, typeId);
  if (!t || (!sensitive && isFinancialType(t))) return `Electrical PM declares no record type ${clip(typeId, 60)} that AI may use for this project (see pm_get_metadata)`;
  if (JSON.stringify(write).length > MAX_FIELDS_CHARS) return `the change is larger than ${MAX_FIELDS_CHARS} characters`;
  if (write.status !== undefined && !(Array.isArray(t.statuses) && t.statuses.includes(write.status))) {
    return `status must be one of: ${Array.isArray(t.statuses) ? t.statuses.join(', ') : '(none declared)'}`;
  }
  const forms = isObj(meta.valueForms) ? meta.valueForms : {};
  const check = (defs, values, where) => {
    if (!isObj(values)) return `${where} must be an object`;
    for (const [k, v] of Object.entries(values)) {
      const d = defs.find((x) => x && x.key === k);
      if (!d) return `unknown ${where} key ${clip(k, 60)} for ${typeId} (declared: ${defs.map((x) => x.key).slice(0, 40).join(', ') || 'none'})`;
      if (d.secure && !sensitive) return `${where}.${k} is a secure field, and Harrison has not allowed AI to use secure fields`;
      const form = forms[d.kind];
      if (!FORMS.has(form)) return `${where}.${k} has kind ${clip(d.kind, 40)}, which has no declared value form, so it is not sent`;
      const bad = valueProblem(form, d, v);
      if (bad) return `${where}.${k} ${bad}`;
    }
    return null;
  };
  const top = Array.isArray(t.topLevel) ? t.topLevel : [];
  let bad = check(top, write.topLevel || {}, 'top_level');
  if (bad) return bad;
  const secs = isObj(t.sections) ? t.sections : {};
  for (const sec of SECTIONS) {
    if (write.sections[sec] === undefined) continue;
    const defs = secs[sec];
    if (!Array.isArray(defs)) return `${typeId} has no ${sec} section`;
    bad = check(defs, write.sections[sec], sec);
    if (bad) return bad;
  }
  if (create) {
    const missing = (defs, values) => defs.find((d) => d && d.required && (values[d.key] === undefined || values[d.key] === null || values[d.key] === ''));
    const m = missing(top, write.topLevel || {}) || SECTIONS.map((sec) => Array.isArray(secs[sec]) && missing(secs[sec], write.sections[sec] || {})).find(Boolean);
    if (m) return m.secure && !sensitive ? `${typeId} needs the secure field ${m.key}, which AI may not set (Harrison has not allowed secure fields): create it in Electrical PM` : `missing required field ${m.key}`;
  } else if (write.status === undefined && !Object.keys(write.topLevel || {}).length && !SECTIONS.some((sec) => write.sections[sec] !== undefined)) {
    return 'give at least one change';
  }
  return null;
}

/** The whole sections to send for an update: each touched section of the current record with the changes on top. */
/** The metadata as the model may see it: without financial types and secure fields unless sensitive. */
export function metadataForModel(meta, { sensitive = false } = {}) {
  if (!isObj(meta) || sensitive) return meta;
  const strip = (defs) => (Array.isArray(defs) ? defs.filter((d) => !(d && d.secure)) : defs);
  const hidden = [];
  const recordTypes = (Array.isArray(meta.recordTypes) ? meta.recordTypes : []).filter((t) => {
    if (isFinancialType(t)) {
      hidden.push(t.id);
      return false;
    }
    return true;
  }).map((t) => ({
    ...t,
    topLevel: strip(t.topLevel),
    sections: isObj(t.sections) ? Object.fromEntries(Object.entries(t.sections).map(([k, v]) => [k, strip(v)])) : t.sections,
  }));
  return { ...meta, recordTypes, withheld: { note: 'Harrison has not allowed AI to use financial record types or secure fields; they are not shown and cannot be changed.', financialTypes: hidden.length } };
}

/**
 * Anything PM sent back that may hold a record (a conflict's current DTO, a create or update answer) as the model
 * may see it: a record-shaped object (id and type) is redacted; anything else that is not sensitive-safe is dropped.
 */
export function redactValue(meta, value, opts) {
  if (opts && opts.sensitive) return value;
  if (isObj(value) && typeof value.id === 'string' && typeof value.type === 'string') return redactRecord(meta, value, opts);
  if (isObj(value) && isObj(value.record)) return { ...value, record: redactRecord(meta, value.record, opts) };
  if (isObj(value) && Array.isArray(value.records)) return { ...value, records: value.records.map((r) => redactRecord(meta, r, opts)).filter((r) => r !== null) };
  return value;
}

export function mergeSections(current, sections) {
  const out = {};
  for (const sec of SECTIONS) if (sections[sec] !== undefined) out[sec] = { ...(isObj(current && current[sec]) ? current[sec] : {}), ...sections[sec] };
  return out;
}

/**
 * A record as the model may see it. sensitive true: as PM returned it. Otherwise a financial type is null (not
 * shown at all) and every secure field is removed and listed in withheld. An undescribed type shows only its
 * identity: nothing is passed on that the metadata did not describe.
 */
export function redactRecord(meta, rec, { sensitive = false } = {}) {
  if (!isObj(rec) || sensitive) return rec;
  const t = typeOf(meta, rec.type);
  if (t && isFinancialType(t)) return null;
  if (!t) {
    const { id, type, revision, status, archived } = rec;
    return { id, type, revision, status, archived, withheld: ['every field: Electrical PM did not describe this record type'] };
  }
  const out = { ...rec };
  const withheld = [];
  for (const d of Array.isArray(t.topLevel) ? t.topLevel : []) if (d && d.secure && d.key in out) { delete out[d.key]; withheld.push(d.key); }
  for (const sec of SECTIONS) {
    const defs = isObj(t.sections) && Array.isArray(t.sections[sec]) ? t.sections[sec] : [];
    if (!isObj(out[sec])) continue;
    out[sec] = { ...out[sec] };
    for (const d of defs) if (d && d.secure && d.key in out[sec]) { delete out[sec][d.key]; withheld.push(`${sec}.${d.key}`); }
  }
  return withheld.length ? { ...out, withheld } : out;
}

// ---------------------------------------------------------------- owner routes

const ownerOnly = (ctx) => ['owner', 'dev'].includes(ctx.identity && ctx.identity.kind);
const forbidden = () => apiError(403, 'forbidden', 'This identity may not call this route');

// Project names for the owner's checkboxes, from the approved live PM digest copy (labels only; never used as the
// source for a change). Ids the grant holds that the copy does not list stay listed, so they can be unticked.
async function projectChoices(env, nowMs, granted) {
  let live = [];
  try {
    const digest = await pm.listDigest(env.DB, 'work', { nowMs, env });
    live = digest.projects.filter((p) => p.source_id === pm.HTTP_SOURCE_ID && !p.sample && typeof p.provider_id === 'string' && PROJECT_ID_RE.test(p.provider_id))
      .map((p) => ({ id: p.provider_id, name: clip(p.name, 200) }));
  } catch {
    live = [];
  }
  const seen = new Set(live.map((p) => p.id));
  return [...live, ...granted.filter((id) => !seen.has(id)).map((id) => ({ id, name: null }))];
}

async function statusBody(env, nowMs) {
  const g = await readCrossGrant(env, nowMs);
  return { configured: commandsConfigured(env), grant: g, actions: ACTIONS, read_actions: READ_ACTIONS, projects: await projectChoices(env, nowMs, g.projects) };
}

async function getStatus(ctx) {
  if (!ownerOnly(ctx)) return forbidden();
  return json(200, await statusBody(ctx.env, ctx.nowMs));
}

// Stored as given, in force from the next call. The event carries the choice (ids and action names) only.
async function putGrant(ctx) {
  if (!ownerOnly(ctx)) return forbidden();
  const g = checkGrant(await readJson(ctx.request));
  const nowIso = iso(ctx.nowMs);
  await db.kvPut(ctx.env.DB, GRANT_KEY, JSON.stringify({ ...g, updated_at: nowIso }));
  await db.logEvent(ctx.env.DB, nowIso, 'crossapp_grant_set', null, g);
  return json(200, await statusBody(ctx.env, ctx.nowMs));
}

export const ROUTES = [
  ['GET', /^\/api\/connections\/crossapp$/, getStatus],
  ['PUT', /^\/api\/connections\/crossapp\/grant$/, putGrant],
];
