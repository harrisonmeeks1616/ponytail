// Cross-app actions: AI clients (Ask in Full mode, MCP clients) acting on Electrical PM, and on Field Hub
// through PM, by calling PM's own private command entrypoint. Contract: docs/CROSS_APP_ACTIONS.md.
//
// GET /api/connections/crossapp          owner only: { configured, grant, actions, read_actions }
// PUT /api/connections/crossapp/grant    owner only: { clients, projects, actions } -> same shape
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
import { HttpError, json, apiError, iso, readJson } from './http.js';

export const ACTIONS = Object.freeze([
  'project.read', 'project.schema', 'records.list', 'record.read', 'record.create', 'record.update', 'record.archive', 'record.restore',
  'field.status', 'field.read', 'field.pending', 'field.edit', 'field.retry',
]);
export const READ_ACTIONS = Object.freeze(['project.read', 'project.schema', 'records.list', 'record.read', 'field.status', 'field.read', 'field.pending']);
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

const EMPTY = Object.freeze({ clients: [], projects: [], actions: [], updated_at: null });

function checkGrant(body) {
  const bad = (code, message) => new HttpError(400, code, message);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('invalid_grant', 'Send { clients, projects, actions }');
  if (Object.keys(body).some((k) => !['clients', 'projects', 'actions'].includes(k))) throw bad('invalid_grant', 'Only clients, projects and actions can be set');
  const list = (v, name, ok, max) => {
    if (!Array.isArray(v) || v.length > max || new Set(v).size !== v.length || !v.every(ok)) throw bad(`invalid_${name}`, `${name} must list distinct valid entries (at most ${max})`);
    return v;
  };
  const clients = list(body.clients, 'clients', (c) => CLIENTS.includes(c), CLIENTS.length);
  const projects = list(body.projects, 'projects', (p) => typeof p === 'string' && PROJECT_ID_RE.test(p), MAX_PROJECTS);
  const actions = list(body.actions, 'actions', (a) => ACTIONS.includes(a), ACTIONS.length);
  return { clients: CLIENTS.filter((c) => clients.includes(c)), projects, actions: ACTIONS.filter((a) => actions.includes(a)) };
}

/** The grant in force, read fresh. No row, or one that cannot be read, allows nothing. */
export async function readCrossGrant(env, nowMs = Date.now()) {
  try {
    const raw = env.DB ? await db.kvGet(env.DB, GRANT_KEY, nowMs) : null;
    if (raw === null) return { ...EMPTY };
    const stored = JSON.parse(raw);
    return { ...checkGrant({ clients: stored.clients, projects: stored.projects, actions: stored.actions }), updated_at: typeof stored.updated_at === 'string' ? stored.updated_at : null };
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

// ---------------------------------------------------------------- fields against PM's declared schema

/**
 * Checks fields against PM's declared field list (project.schema): every name known, editable for an update,
 * required ones present on create, values of the declared kind. -> error text, or null. PM validates again.
 */
export function checkFields(defs, fields, { create = false } = {}) {
  if (!Array.isArray(defs)) return 'Electrical PM did not describe these fields, so Harrison OS will not guess them.';
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return 'fields must be an object of field names and values';
  if (JSON.stringify(fields).length > MAX_FIELDS_CHARS) return `fields are larger than ${MAX_FIELDS_CHARS} characters`;
  const byName = new Map(defs.filter((d) => d && typeof d.name === 'string').map((d) => [d.name, d]));
  for (const [name, value] of Object.entries(fields)) {
    const d = byName.get(name);
    if (!d) return `unknown field ${clip(name, 60)} (known: ${[...byName.keys()].slice(0, 40).join(', ')})`;
    if (d.editable === false) return `field ${name} cannot be changed`;
    const bad = valueProblem(d, value);
    if (bad) return `field ${name}: ${bad}`;
  }
  if (create) {
    for (const d of byName.values()) if (d.required && (fields[d.name] === undefined || fields[d.name] === null || fields[d.name] === '')) return `missing required field ${d.name}`;
  } else if (!Object.keys(fields).length) return 'give at least one field to change';
  return null;
}

function valueProblem(d, v) {
  if (v === null) return d.required ? 'is required' : null;
  const max = Number.isInteger(d.maxLength) ? d.maxLength : 20000;
  switch (d.kind) {
    case 'string':
    case 'text':
      return typeof v !== 'string' ? 'must be text' : v.length > max ? `is longer than ${max} characters` : null;
    case 'integer':
      return Number.isInteger(v) ? null : 'must be a whole number';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? null : 'must be a number';
    case 'boolean':
      return typeof v === 'boolean' ? null : 'must be true or false';
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'must be a date YYYY-MM-DD';
    case 'enum':
      return Array.isArray(d.values) && d.values.includes(v) ? null : `must be one of: ${Array.isArray(d.values) ? d.values.slice(0, 30).join(', ') : '(none declared)'}`;
    default:
      return 'has a kind Harrison OS does not know, so it is not sent';
  }
}

// ---------------------------------------------------------------- owner routes

const ownerOnly = (ctx) => ['owner', 'dev'].includes(ctx.identity && ctx.identity.kind);
const forbidden = () => apiError(403, 'forbidden', 'This identity may not call this route');

async function statusBody(env, nowMs) {
  const g = await readCrossGrant(env, nowMs);
  return { configured: commandsConfigured(env), grant: g, actions: ACTIONS, read_actions: READ_ACTIONS };
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
