// PM digest (Slice 3.1). A read-only, source-linked, freshness-aware summary of company project status,
// built from user-supplied exports (versioned JSON or CSV, docs/PM_DIGEST.md) or one authorized digest
// link (env PM_DIGEST_URL + secret PM_DIGEST_TOKEN, same JSON format).
//
// Rules:
// - The company system stays the official record. Nothing here writes to it or reads its files; every
//   entry links back ("Open in <system>") and carries source_ref 'pm:<id>', url and fetched/exported times.
// - Export content is untrusted text: strictly validated, capped, control characters removed, never
//   interpreted. Scope and sample come from the request (or the fixed http-source scope), never the file.
// - SQL here touches only pm_sources and pm_records. Events carry ids, states, counts and codes only.
// - The http adapter: https only, Bearer token, no redirects followed, bounded time and size.

import * as db from './db.js';
import { HttpError, json, iso, readJson, requireText, requireScope, queryScope, validTimeZone, DATE_RE } from './http.js';
import { instantToZonedParts } from './time.js';
import { addDaysOn } from './dates.js';

export const FORMAT = 'harrison-os.pm-digest';
export const CSV_HEADER = ['project_id', 'project_name', 'item_id', 'title', 'status', 'due_on', 'owner_label', 'url', 'updated_at'];
export const LIMITS = Object.freeze({ projects: 200, items: 300, records: 1500, fetchBytes: 1_000_000, fetchMs: 10_000 });
export const HTTP_SOURCE_ID = 'pm-http';
export const STALE_MS = 48 * 3600 * 1000;
export const REFRESH_MS = 60 * 60 * 1000;
const HTTP_SCOPE = 'work'; // the authorized digest link is company data
const DEFAULT_TZ = 'America/New_York';
const CHANGE_LIST_CAP = 50;
const ID_MAX = 120;
const CLOSED = new Set(['done', 'closed', 'complete', 'completed', 'resolved', 'cancelled', 'canceled', 'archived']);
// Control, zero-width and bidi-override characters: removed so untrusted text cannot hide or reorder content.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

// ---------------------------------------------------------------- validation (untrusted input)

function bad(message) {
  throw new HttpError(400, 'invalid_import', message);
}

function display(v, path, max, required = false) {
  if (v === undefined || v === null || v === '') {
    if (required) bad(`${path} is required`);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') bad(`${path} must be text`);
  const t = String(v).replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (!t) {
    if (required) bad(`${path} is required`);
    return null;
  }
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function providerId(v, path) {
  const t = display(v, path, ID_MAX + 1, true);
  if (t.length > ID_MAX) bad(`${path} is longer than ${ID_MAX} characters`);
  return t;
}

function dateOn(v, path) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !DATE_RE.test(v) || addDaysOn(v, 0) !== v) bad(`${path} must be a date like 2026-10-31`);
  return v;
}

function timestamp(v, path, required = false) {
  if (v === undefined || v === null || v === '') {
    if (required) bad(`${path} is required`);
    return null;
  }
  const ms = typeof v === 'string' && TS_RE.test(v) ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms)) bad(`${path} must be a timestamp like 2026-10-31T09:00:00Z`);
  return iso(ms);
}

/** https URL or null. Anything else (http:, javascript:, credentials, too long) is dropped, not stored. */
export function safeUrl(v) {
  if (typeof v !== 'string' || !v || v.length > 2048) return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) return null;
    return u.href;
  } catch {
    return null;
  }
}

/**
 * Validates a parsed digest object (the JSON contract, or CSV rows already shaped like it) and returns
 * normalized rows. Throws HttpError 400 invalid_import naming the field path (never the field's text).
 */
export function normalizeDigest(obj, { nowMs, csv = false } = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) bad('the file must be one JSON object');
  if (!csv) {
    if (obj.format !== FORMAT) bad(`format must be "${FORMAT}"`);
    if (obj.version !== 1) bad('version must be 1');
  }
  const src = obj.source && typeof obj.source === 'object' && !Array.isArray(obj.source) ? obj.source : bad('source is required');
  const exportedAt = timestamp(src.exported_at, 'source.exported_at', !csv);
  if (exportedAt && Date.parse(exportedAt) > nowMs + 3600 * 1000) bad('source.exported_at is in the future');
  let dropped = 0;
  const url = (v) => {
    const u = safeUrl(v);
    if (v && !u) dropped++;
    return u;
  };
  const out = {
    system: display(src.system, 'source.system', 60, !csv),
    exported_at: exportedAt,
    base_url: url(src.base_url),
    projects: [],
  };
  if (!Array.isArray(obj.projects)) bad('projects must be a list');
  if (obj.projects.length > LIMITS.projects) bad(`at most ${LIMITS.projects} projects per import`);
  const projectIds = new Set();
  const itemIds = new Set();
  let records = 0;
  obj.projects.forEach((p, i) => {
    const at = `projects[${i}]`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) bad(`${at} must be an object`);
    const id = providerId(p.id, `${at}.id`);
    if (projectIds.has(id)) bad(`${at}.id is a duplicate`);
    projectIds.add(id);
    const m = p.next_milestone;
    if (m !== undefined && m !== null && (typeof m !== 'object' || Array.isArray(m))) bad(`${at}.next_milestone must be an object`);
    const items = p.open_items === undefined || p.open_items === null ? [] : p.open_items;
    if (!Array.isArray(items)) bad(`${at}.open_items must be a list`);
    if (items.length > LIMITS.items) bad(`at most ${LIMITS.items} open items per project`);
    const project = {
      provider_id: id,
      name: display(p.name, `${at}.name`, 200, true),
      status: display(p.status, `${at}.status`, 60),
      url: url(p.url),
      updated_at: timestamp(p.updated_at, `${at}.updated_at`),
      milestone_title: m ? display(m.title, `${at}.next_milestone.title`, 200, true) : null,
      milestone_due_on: m ? dateOn(m.due_on, `${at}.next_milestone.due_on`) : null,
      items: items.map((it, j) => {
        const ia = `${at}.open_items[${j}]`;
        if (!it || typeof it !== 'object' || Array.isArray(it)) bad(`${ia} must be an object`);
        const iid = providerId(it.id, `${ia}.id`);
        if (itemIds.has(iid)) bad(`${ia}.id is a duplicate`);
        itemIds.add(iid);
        return {
          provider_id: iid,
          title: display(it.title, `${ia}.title`, 300, true),
          status: display(it.status, `${ia}.status`, 60),
          due_on: dateOn(it.due_on, `${ia}.due_on`),
          owner_label: display(it.owner_label, `${ia}.owner_label`, 80),
          url: url(it.url),
          updated_at: timestamp(it.updated_at, `${ia}.updated_at`),
        };
      }),
    };
    records += 1 + project.items.length;
    if (records > LIMITS.records) bad(`at most ${LIMITS.records} projects and items per import`);
    out.projects.push(project);
  });
  out.dropped_urls = dropped;
  return out;
}

/** RFC 4180 CSV (quoted fields, "" escapes, CRLF or LF). Returns rows of strings; blank lines skipped. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  const s = String(text).replace(/^\ufeff/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (s[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
      fieldStarted = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStarted = false;
    } else {
      field += c;
      fieldStarted = true;
    }
  }
  if (quoted) bad('the CSV has an unclosed quote');
  if (fieldStarted || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && !r[0].trim()));
}

/** CSV (header CSV_HEADER, any column order) -> the JSON contract's shape, for normalizeDigest(csv: true). */
export function csvToDigest(text, system) {
  const rows = parseCsv(text);
  if (!rows.length) bad('the CSV is empty');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(CSV_HEADER.map((name) => [name, header.indexOf(name)]));
  const missing = CSV_HEADER.filter((name) => col[name] < 0);
  if (missing.length) bad(`the CSV header is missing: ${missing.join(', ')}`);
  if (rows.length - 1 > LIMITS.records) bad(`at most ${LIMITS.records} CSV rows per import`);
  const projects = new Map();
  rows.slice(1).forEach((r, n) => {
    const get = (name) => (r[col[name]] ?? '').trim();
    const pid = get('project_id');
    if (!pid) bad(`CSV row ${n + 2}: project_id is required`);
    if (!projects.has(pid)) projects.set(pid, { id: pid, name: get('project_name'), open_items: [] });
    if (get('item_id')) {
      projects.get(pid).open_items.push({
        id: get('item_id'),
        title: get('title'),
        status: get('status'),
        due_on: get('due_on'),
        owner_label: get('owner_label'),
        url: get('url'),
        updated_at: get('updated_at'),
      });
    }
  });
  return { source: { system: system || null, exported_at: null }, projects: [...projects.values()] };
}

export function parseImport({ format, content, system }, nowMs) {
  if (format === 'csv') return normalizeDigest(csvToDigest(content, system), { nowMs, csv: true });
  if (format !== 'json') throw new HttpError(400, 'invalid_format', "format must be 'json' or 'csv'");
  let obj;
  try {
    obj = JSON.parse(content);
  } catch {
    bad('the file is not valid JSON');
  }
  return normalizeDigest(obj, { nowMs });
}

// ---------------------------------------------------------------- storage (pm_sources, pm_records only)

const isClosed = (status) => CLOSED.has(String(status || '').toLowerCase());
const newId = (prefix) => `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '')}`;

async function getSource(d, id, scope) {
  const sql = scope === 'all' ? 'SELECT * FROM pm_sources WHERE id = ?' : 'SELECT * FROM pm_sources WHERE id = ? AND scope = ?';
  return d.prepare(sql).bind(...(scope === 'all' ? [id] : [id, scope])).first();
}

function pushCapped(list, entry) {
  if (list.length < CHANGE_LIST_CAP) list.push(entry);
}

/** What changed since the previous import: new, closed (or gone from the export) and due date moved. */
export function diffImport(prev, next, firstImport) {
  const counts = { new: 0, closed: 0, moved: 0 };
  const out = { first_import: firstImport, counts, new: [], closed: [], moved: [] };
  if (firstImport) return out;
  const before = new Map(prev.map((r) => [`${r.kind}:${r.provider_id}`, r]));
  const seen = new Set();
  const add = (kind, entry) => {
    counts[kind]++;
    pushCapped(out[kind], entry);
  };
  for (const p of next.projects) {
    const old = before.get(`project:${p.provider_id}`);
    if (!old) add('new', { kind: 'project', provider_id: p.provider_id, title: p.name });
    else if (old.milestone_due_on !== p.milestone_due_on && p.milestone_title) {
      add('moved', { kind: 'milestone', provider_id: p.provider_id, title: p.milestone_title, from: old.milestone_due_on, to: p.milestone_due_on });
    }
    for (const it of p.items) {
      seen.add(it.provider_id);
      const o = before.get(`item:${it.provider_id}`);
      if (!o) {
        if (!isClosed(it.status)) add('new', { kind: 'item', provider_id: it.provider_id, title: it.title, due_on: it.due_on });
      } else if (!isClosed(o.status) && isClosed(it.status)) {
        add('closed', { kind: 'item', provider_id: it.provider_id, title: it.title });
      } else if (!isClosed(it.status) && o.due_on !== it.due_on) {
        add('moved', { kind: 'item', provider_id: it.provider_id, title: it.title, from: o.due_on, to: it.due_on });
      }
    }
  }
  for (const o of prev) {
    if (o.kind === 'item' && !seen.has(o.provider_id) && !isClosed(o.status)) {
      add('closed', { kind: 'item', provider_id: o.provider_id, title: o.title, gone: true });
    }
  }
  return out;
}

/**
 * Replaces one source's records with a normalized import in a single batch (all or nothing). Record ids
 * are kept per provider id, so 'pm:<id>' refs held elsewhere stay valid across re-imports.
 */
export async function importInto(d, { sourceId = null, scope, label, kind = 'import', sample = 0 }, digest, nowIso) {
  requireScope(scope);
  const existing = sourceId ? await getSource(d, sourceId, scope) : null;
  if (sourceId && !existing) throw new db.NotFoundError('source not found');
  if (existing && existing.kind !== kind) throw new HttpError(409, 'wrong_source_kind', 'That source is not an import');
  const id = existing ? existing.id : sourceId || newId('pms');
  const prev = existing
    ? (await d.prepare('SELECT id, kind, provider_id, status, due_on, milestone_due_on FROM pm_records WHERE source_id = ?').bind(id).all()).results
    : [];
  const prevId = new Map(prev.map((r) => [`${r.kind}:${r.provider_id}`, r.id]));
  const changes = diffImport(prev, digest, !existing || !existing.last_import_at);
  const sampleFlag = existing ? Number(existing.sample) : sample ? 1 : 0;
  const stmts = [];
  if (existing) {
    stmts.push(
      d
        .prepare(
          `UPDATE pm_sources SET label = ?, system = ?, base_url = ?, state = 'ok', last_import_at = ?, exported_at = ?,
             last_error_code = NULL, last_changes = ? WHERE id = ?`,
        )
        .bind(label || existing.label, digest.system, digest.base_url, nowIso, digest.exported_at, JSON.stringify(changes), id),
    );
  } else {
    stmts.push(
      d
        .prepare(
          `INSERT INTO pm_sources (id, scope, label, kind, system, base_url, state, last_import_at, exported_at, last_changes, sample, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'ok', ?, ?, ?, ?, ?)`,
        )
        .bind(id, scope, label, kind, digest.system, digest.base_url, nowIso, digest.exported_at, JSON.stringify(changes), sampleFlag, nowIso),
    );
  }
  stmts.push(d.prepare('DELETE FROM pm_records WHERE source_id = ?').bind(id));
  const insert = `INSERT INTO pm_records (id, source_id, scope, provider_id, kind, parent_provider_id, title, status, due_on, owner_label,
    url, updated_at, milestone_title, milestone_due_on, imported_at, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  let items = 0;
  for (const p of digest.projects) {
    stmts.push(
      d
        .prepare(insert)
        .bind(prevId.get(`project:${p.provider_id}`) || newId('pmr'), id, scope, p.provider_id, 'project', null, p.name, p.status, null, null,
          p.url, p.updated_at, p.milestone_title, p.milestone_due_on, nowIso, sampleFlag),
    );
    for (const it of p.items) {
      items++;
      stmts.push(
        d
          .prepare(insert)
          .bind(prevId.get(`item:${it.provider_id}`) || newId('pmr'), id, scope, it.provider_id, 'item', p.provider_id, it.title, it.status,
            it.due_on, it.owner_label, it.url, it.updated_at, null, null, nowIso, sampleFlag),
      );
    }
  }
  await d.batch(stmts);
  return { sourceId: id, projects: digest.projects.length, items, changes };
}

async function logEvent(d, nowMs, kind, ref, detail) {
  try {
    await db.logEvent(d, iso(nowMs), kind, ref, detail);
  } catch (err) {
    console.error(JSON.stringify({ evt: 'event_write_failed', kind, err: err && err.name }));
  }
}

// ---------------------------------------------------------------- http adapter

export function httpConfigured(env) {
  return !!(env && safeUrl(env.PM_DIGEST_URL) && typeof env.PM_DIGEST_TOKEN === 'string' && env.PM_DIGEST_TOKEN.trim());
}

async function readCapped(res, cap) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** One bounded fetch of the digest link. Returns { ok, text } or { ok: false, code }. Never logs the URL or token. */
async function fetchDigest(env, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(safeUrl(env.PM_DIGEST_URL), {
      method: 'GET',
      headers: { Authorization: `Bearer ${env.PM_DIGEST_TOKEN.trim()}`, Accept: 'application/json' },
      redirect: 'manual', // never forward the token to another host
      signal: controller.signal,
    });
    if (res.status !== 200) {
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      return { ok: false, code: res.status >= 300 && res.status < 400 ? 'redirected' : `http_${res.status}`, status: res.status };
    }
    if (Number(res.headers.get('content-length') || 0) > LIMITS.fetchBytes) return { ok: false, code: 'too_large' };
    const text = await readCapped(res, LIMITS.fetchBytes);
    if (text === null) return { ok: false, code: 'too_large' };
    return { ok: true, text };
  } catch {
    return { ok: false, code: controller.signal.aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Refreshes the http source. claimOlderThanMs (cron) claims the attempt so overlapping runs fetch once.
 * On failure the previous copy is kept and marked with the error; it is never wiped.
 */
export async function refreshHttpSource(env, nowMs, { fetchImpl = globalThis.fetch, claimOlderThanMs = null, timeoutMs = LIMITS.fetchMs } = {}) {
  if (!httpConfigured(env)) return { ok: false, code: 'not_connected' };
  const d = env.DB;
  const nowIso = iso(nowMs);
  await d
    .prepare(
      `INSERT INTO pm_sources (id, scope, label, kind, state, sample, created_at) VALUES (?, ?, 'Company PM digest link', 'http', 'never', 0, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(HTTP_SOURCE_ID, HTTP_SCOPE, nowIso)
    .run();
  const claim =
    claimOlderThanMs == null
      ? await d.prepare('UPDATE pm_sources SET last_attempt_at = ? WHERE id = ?').bind(nowIso, HTTP_SOURCE_ID).run()
      : await d
          .prepare('UPDATE pm_sources SET last_attempt_at = ? WHERE id = ? AND (last_attempt_at IS NULL OR last_attempt_at <= ?)')
          .bind(nowIso, HTTP_SOURCE_ID, iso(nowMs - claimOlderThanMs))
          .run();
  if (!claim.meta.changes) return { ok: false, code: 'not_due' };

  const got = await fetchDigest(env, fetchImpl, timeoutMs);
  let result;
  if (got.ok) {
    try {
      let obj;
      try {
        obj = JSON.parse(got.text);
      } catch {
        bad('not JSON');
      }
      const digest = normalizeDigest(obj, { nowMs });
      result = { ok: true, ...(await importInto(d, { sourceId: HTTP_SOURCE_ID, scope: HTTP_SCOPE, kind: 'http' }, digest, nowIso)) };
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      result = { ok: false, code: 'invalid_format' };
    }
  } else {
    result = got;
  }
  if (!result.ok) {
    await d.prepare("UPDATE pm_sources SET state = 'error', last_error_code = ? WHERE id = ?").bind(result.code, HTTP_SOURCE_ID).run();
  }
  await logEvent(d, nowMs, 'pm_refresh', HTTP_SOURCE_ID, result.ok
    ? { state: 'ok', projects: result.projects, items: result.items, ...result.changes.counts }
    : { state: 'error', code: result.code, ...(result.status ? { status: result.status } : {}) });
  return result;
}

/** Cron: at most one digest-link fetch per REFRESH_MS. One bounded unit of work per call. */
export async function onScheduled(env, nowMs = Date.now(), opts = {}) {
  if (!httpConfigured(env)) return { skipped: 'not_connected' };
  return refreshHttpSource(env, nowMs, { ...opts, claimOlderThanMs: REFRESH_MS });
}

// ---------------------------------------------------------------- digest (read)

function sourceEntry(row, nowMs, env) {
  const exportedMs = row.exported_at ? Date.parse(row.exported_at) : null;
  const basisMs = exportedMs ?? (row.last_import_at ? Date.parse(row.last_import_at) : null);
  let state = row.state;
  if (row.kind === 'http' && env && !httpConfigured(env)) state = 'not_connected';
  let changes = null;
  try {
    changes = row.last_changes ? JSON.parse(row.last_changes) : null;
  } catch {
    changes = null;
  }
  return {
    id: row.id,
    source_ref: `pm:${row.id}`,
    scope: row.scope,
    sample: Number(row.sample),
    label: row.label,
    kind: row.kind,
    system: row.system,
    url: row.base_url,
    state,
    last_error_code: row.last_error_code,
    fetched_at: row.last_import_at,
    last_attempt_at: row.last_attempt_at,
    exported_at: row.exported_at,
    export_time_known: !!row.exported_at,
    stale: basisMs == null || nowMs - basisMs > STALE_MS,
    changes,
    projects: 0,
    items: 0,
  };
}

function notConnectedEntry() {
  return {
    id: HTTP_SOURCE_ID,
    source_ref: null,
    scope: HTTP_SCOPE,
    sample: 0,
    label: 'Company PM digest link',
    kind: 'http',
    system: null,
    url: null,
    state: 'not_connected',
    message: 'Not connected: needs an authorized digest link',
    last_error_code: null,
    fetched_at: null,
    last_attempt_at: null,
    exported_at: null,
    export_time_known: false,
    stale: true,
    changes: null,
    projects: 0,
    items: 0,
  };
}

async function scopedRows(d, table, scope, order) {
  const where = scope === 'all' ? '' : ' WHERE scope = ?';
  const res = await d.prepare(`SELECT * FROM ${table}${where} ORDER BY ${order}`).bind(...(scope === 'all' ? [] : [scope])).all();
  return res.results;
}

/** Sources with freshness. With opts.env, the digest link's connection state is included honestly. */
export async function listSources(d, scope, { nowMs, env } = {}) {
  requireScope(scope, { allowAll: true });
  const sources = (await scopedRows(d, 'pm_sources', scope, 'created_at, id')).map((r) => sourceEntry(r, nowMs, env));
  const closed = [...CLOSED];
  const counts = await d
    .prepare(
      `SELECT source_id, SUM(kind = 'project') AS projects,
         SUM(kind = 'item' AND lower(coalesce(status, '')) NOT IN (${closed.map(() => '?').join(', ')})) AS items
       FROM pm_records${scope === 'all' ? '' : ' WHERE scope = ?'} GROUP BY source_id`,
    )
    .bind(...closed, ...(scope === 'all' ? [] : [scope]))
    .all();
  const bySource = new Map(counts.results.map((c) => [c.source_id, c]));
  for (const s of sources) {
    s.projects = Number(bySource.get(s.id)?.projects || 0);
    s.items = Number(bySource.get(s.id)?.items || 0);
  }
  if (env && scope !== 'personal' && !sources.some((s) => s.id === HTTP_SOURCE_ID)) {
    if (httpConfigured(env)) sources.push({ ...notConnectedEntry(), state: 'never', message: 'Set up, not checked yet' });
    else sources.push(notConnectedEntry());
  }
  return sources;
}

/**
 * The digest: per project status, next milestone, overdue and due-in-7-days items, undated items,
 * missing-context indicators and links back to the official system. Every entry carries source_ref
 * 'pm:<id>', url and fetched_at/exported_at. Read-only; scope 'all' allowed.
 */
export async function listDigest(d, scope, { nowMs, timeZone = DEFAULT_TZ, env } = {}) {
  const sources = await listSources(d, scope, { nowMs, env });
  const byId = new Map(sources.map((s) => [s.id, s]));
  const today = instantToZonedParts(nowMs, timeZone || DEFAULT_TZ).date;
  const soon = addDaysOn(today, 7);
  const rows = await scopedRows(d, 'pm_records', scope, "kind DESC, due_on IS NULL, due_on, title, id");
  const projects = new Map();
  const base = (r, s) => ({
    id: r.id,
    source_ref: `pm:${r.id}`,
    source_id: r.source_id,
    scope: r.scope,
    sample: Number(r.sample),
    provider_id: r.provider_id,
    status: r.status,
    url: r.url,
    updated_at: r.updated_at,
    fetched_at: s.fetched_at,
    exported_at: s.exported_at,
  });
  const totals = { projects: 0, overdue: 0, due_soon: 0, undated: 0, stale_sources: sources.filter((s) => s.stale && s.fetched_at).length };
  for (const r of rows) {
    const s = byId.get(r.source_id);
    if (!s) continue;
    if (r.kind === 'project') {
      totals.projects++;
      const m = r.milestone_title ? { title: r.milestone_title, due_on: r.milestone_due_on, overdue: !!r.milestone_due_on && r.milestone_due_on < today } : null;
      projects.set(`${r.source_id}\u0000${r.provider_id}`, {
        ...base(r, s),
        name: r.title,
        system: s.system,
        source_label: s.label,
        stale: s.stale,
        next_milestone: m,
        overdue: [],
        due_soon: [],
        undated: [],
        later_count: 0,
        open_count: 0,
        missing: { link: !r.url, items_without_link: 0, items_without_due: 0, items_without_owner: 0 },
      });
      continue;
    }
    const p = projects.get(`${r.source_id}\u0000${r.parent_provider_id}`);
    if (!p || isClosed(r.status)) continue;
    const missing = [];
    if (!r.url) missing.push('link');
    if (!r.due_on) missing.push('due_date');
    if (!r.owner_label) missing.push('owner');
    const item = { ...base(r, s), title: r.title, due_on: r.due_on, owner_label: r.owner_label, missing };
    p.open_count++;
    if (!r.url) p.missing.items_without_link++;
    if (!r.owner_label) p.missing.items_without_owner++;
    if (!r.due_on) {
      p.missing.items_without_due++;
      p.undated.push(item);
      totals.undated++;
    } else if (r.due_on < today) {
      p.overdue.push({ ...item, state: 'overdue' });
      totals.overdue++;
    } else if (r.due_on <= soon) {
      p.due_soon.push({ ...item, state: 'due_soon' });
      totals.due_soon++;
    } else p.later_count++;
  }
  const list = [...projects.values()].sort((a, b) => b.overdue.length - a.overdue.length || b.due_soon.length - a.due_soon.length || a.name.localeCompare(b.name));
  return { sources, projects: list, totals, today, due_soon_until: soon };
}

/** No derived rows cite captures or items, so deletion has nothing to purge here. */
export function purgeRef() {
  return [];
}

// ---------------------------------------------------------------- sample (synthetic, labelled)

export function sampleDigest(nowMs, timeZone = DEFAULT_TZ) {
  const today = instantToZonedParts(nowMs, timeZone).date;
  const on = (n) => addDaysOn(today, n);
  const link = (path) => `https://pm.example.com/${path}`;
  const at = iso(nowMs - 3600 * 1000);
  return {
    format: FORMAT,
    version: 1,
    source: { system: 'Sample PM', exported_at: iso(nowMs), base_url: link('') },
    projects: [
      {
        id: 'SAMPLE-P1', name: 'Sample: Lobby lighting retrofit', status: 'In progress', url: link('projects/SAMPLE-P1'), updated_at: at,
        next_milestone: { title: 'Fixture submittal approved', due_on: on(5) },
        open_items: [
          { id: 'SAMPLE-I1', title: 'Send revised fixture schedule', status: 'Open', due_on: on(-2), owner_label: 'Sample owner A', url: link('items/SAMPLE-I1'), updated_at: at },
          { id: 'SAMPLE-I2', title: 'Confirm panel label format', status: 'Open', due_on: on(3), owner_label: 'Sample owner B', url: link('items/SAMPLE-I2'), updated_at: at },
          { id: 'SAMPLE-I3', title: 'Collect alternate light quote', status: 'Waiting', due_on: null, owner_label: 'Sample owner A', url: link('items/SAMPLE-I3'), updated_at: at },
        ],
      },
      {
        id: 'SAMPLE-P2', name: 'Sample: Warehouse panel upgrade', status: 'Planning', url: link('projects/SAMPLE-P2'), updated_at: at,
        next_milestone: { title: 'Utility shutdown window', due_on: on(21) },
        open_items: [
          { id: 'SAMPLE-I4', title: 'Request load study', status: 'Open', due_on: on(6), owner_label: null, url: link('items/SAMPLE-I4'), updated_at: at },
          { id: 'SAMPLE-I5', title: 'Walk the site with the inspector', status: 'Open', due_on: on(14), owner_label: 'Sample owner C', url: null, updated_at: at },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------- routes

function tzOf(ctx) {
  const asked = ctx.url.searchParams.get('tz');
  if (!asked) return DEFAULT_TZ;
  const tz = validTimeZone(asked, ctx.nowMs);
  if (!tz) throw new HttpError(400, 'invalid_time_zone', 'tz must be an IANA zone name');
  return tz;
}

async function sourceResponse(ctx, sourceId, scope, status, extra) {
  const sources = await listSources(ctx.env.DB, scope, { nowMs: ctx.nowMs, env: ctx.env });
  return json(status, { source: sources.find((s) => s.id === sourceId) || null, ...extra });
}

async function postImport(ctx) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope);
  const sourceId = body.source_id == null ? null : requireText(body.source_id, 'source_id', ID_MAX);
  const label = body.label == null && sourceId ? null : requireText(body.label, 'label', 80);
  const system = body.system == null ? null : requireText(body.system, 'system', 60);
  const content = requireText(body.content, 'content', 64 * 1024);
  const digest = parseImport({ format: body.format, content, system }, ctx.nowMs);
  const res = await importInto(ctx.env.DB, { sourceId, scope, label, kind: 'import' }, digest, iso(ctx.nowMs));
  await logEvent(ctx.env.DB, ctx.nowMs, 'pm_import', res.sourceId, {
    scope, format: body.format, projects: res.projects, items: res.items, dropped_urls: digest.dropped_urls, ...res.changes.counts,
  });
  return sourceResponse(ctx, res.sourceId, scope, sourceId ? 200 : 201, { changes: res.changes, dropped_urls: digest.dropped_urls });
}

async function postSample(ctx) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope);
  const d = ctx.env.DB;
  const existing = await d.prepare("SELECT id FROM pm_sources WHERE scope = ? AND kind = 'import' AND sample = 1 LIMIT 1").bind(scope).first();
  const digest = normalizeDigest(sampleDigest(ctx.nowMs), { nowMs: ctx.nowMs });
  const res = await importInto(d, { sourceId: existing ? existing.id : null, scope, label: 'Sample company projects', kind: 'import', sample: 1 }, digest, iso(ctx.nowMs));
  await logEvent(d, ctx.nowMs, 'pm_sample_loaded', res.sourceId, { scope, projects: res.projects, items: res.items });
  return sourceResponse(ctx, res.sourceId, scope, existing ? 200 : 201, { changes: res.changes });
}

async function getSources(ctx) {
  const scope = queryScope(ctx, { allowAll: true });
  return json(200, { sources: await listSources(ctx.env.DB, scope, { nowMs: ctx.nowMs, env: ctx.env }), scope });
}

async function postRefresh(ctx, id) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope);
  if (id !== HTTP_SOURCE_ID) {
    const row = await getSource(ctx.env.DB, id, scope);
    if (!row) throw new db.NotFoundError('source not found');
    throw new HttpError(409, 'import_source', 'This source is a file import. Import an updated file to refresh it.');
  }
  if (scope !== HTTP_SCOPE) throw new db.NotFoundError('source not found');
  if (!httpConfigured(ctx.env)) throw new HttpError(409, 'not_connected', 'Not connected: needs an authorized digest link');
  const res = await refreshHttpSource(ctx.env, ctx.nowMs);
  return sourceResponse(ctx, HTTP_SOURCE_ID, scope, 200, { refreshed: res.ok, error_code: res.ok ? null : res.code, changes: res.ok ? res.changes : null });
}

async function deleteSource(ctx, id) {
  const scope = queryScope(ctx);
  const d = ctx.env.DB;
  const row = await getSource(d, id, scope);
  if (!row) throw new db.NotFoundError('source not found');
  const [, recs] = await d.batch([
    d.prepare('DELETE FROM pm_sources WHERE id = ?').bind(id),
    d.prepare('DELETE FROM pm_records WHERE source_id = ?').bind(id),
  ]);
  await logEvent(d, ctx.nowMs, 'pm_source_deleted', id, { scope, kind: row.kind, records: recs.meta.changes });
  return json(200, { deleted: true, id });
}

async function getDigest(ctx) {
  const scope = queryScope(ctx, { allowAll: true });
  const timeZone = tzOf(ctx);
  return json(200, { ...(await listDigest(ctx.env.DB, scope, { nowMs: ctx.nowMs, timeZone, env: ctx.env })), scope, timeZone });
}

const SRC = '[A-Za-z0-9_-]{1,120}';
const r = (pattern) => new RegExp(`^${pattern}$`);

export const ROUTES = [
  ['POST', r('/api/pm/import'), postImport],
  ['POST', r('/api/pm/sample'), postSample],
  ['GET', r('/api/pm/sources'), getSources],
  ['POST', r(`/api/pm/sources/(${SRC})/refresh`), postRefresh],
  ['DELETE', r(`/api/pm/sources/(${SRC})`), deleteSource],
  ['GET', r('/api/pm/digest'), getDigest],
];
