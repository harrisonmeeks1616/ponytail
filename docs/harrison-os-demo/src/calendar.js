// Read-only calendar (Slice 2.6): ICS links and imported .ics files, shown on Today with freshness, time
// zone, privacy and connection health. Harrison OS never writes to a calendar and ICS is never an alert route.
//
// Owns calendar_connections and calendar_events (migrations/0005_calendar.sql).
// - The feed URL is a secret link. It is stored server-side only, never returned (the API shows its host),
//   never logged. Events keep only title, location and times; private (CLASS:PRIVATE|CONFIDENTIAL) events
//   keep no text at all.
// - Scope: a connection and its events have one scope. listEvents(db, 'work') returns personal events as
//   busy blocks with title and location removed in SQL (and the other way round); free (transparent)
//   events of the other scope are left out. 'all' is the private all-life view.
// - ICS content is untrusted: it only becomes inert titles and times (src/ics.js). It can never change a
//   connection's scope, sample flag or anything outside these two tables.
// - Fetches: https only, 8 s budget per refresh (redirects and body included), 2 MB cap, at most 3
//   redirects each re-checked for https. One AbortController per refresh; nothing is shared across requests.
//
// ponytail: parsing a 2 MB feed costs roughly 60-110 ms of CPU in Node (measured with a synthetic
// 6000-event feed). That is over the Workers Free plan's 10 ms CPU budget; small feeds fit, large ones need
// the Paid plan or a smaller feed. The cron refreshes at most one connection per run to keep it bounded.

import { HttpError, json, iso, requireText, requireScope, queryScope, readJson, validTimeZone, DATE_RE } from './http.js';
import { logEvent as dbLogEvent } from './db.js';
import { parseIcs, IcsError, MAX_ICS_BYTES } from './ics.js';
import { zonedWallTimeToInstant, instantToZonedParts } from './time.js';

const DAY_MS = 86_400_000;
const WINDOW_PAST_MS = 14 * DAY_MS;
const WINDOW_FUTURE_MS = 180 * DAY_MS;
export const STALE_MS = 2 * 60 * 60 * 1000;
export const REFRESH_EVERY_MS = 30 * 60 * 1000;
export const FETCH_TIMEOUT_MS = 8000;
export const MAX_REDIRECTS = 3;
const MAX_URL = 2000;
const MAX_LABEL = 80;
const MAX_CONNECTIONS = 20;
const MAX_RANGE_MS = 92 * DAY_MS;
const MAX_LIST = 1000;
const INSERT_CHUNK = 400;
const DEFAULT_TZ = 'America/New_York';
const ID = '[A-Za-z0-9_-]{1,80}';

// ---------------------------------------------------------------- helpers

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

async function eventId(connectionId, uid, key) {
  const bytes = new TextEncoder().encode(`${connectionId}\n${uid}\n${key}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `ev_${[...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function log(db, nowMs, kind, ref, detail) {
  try {
    await dbLogEvent(db, iso(nowMs), kind, ref, detail);
  } catch (err) {
    console.error(JSON.stringify({ evt: 'event_write_failed', kind, err: err && err.name }));
  }
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * A pasted calendar link -> the https URL to fetch. webcal:// (what Apple and Google hand out) is the same
 * feed over https. Refuses anything else, credentials in the URL, and loopback/IP-literal hosts.
 */
export function checkFeedUrl(raw) {
  if (typeof raw !== 'string') throw new HttpError(400, 'invalid_url', 'url must be a string');
  let s = raw.trim();
  if (!s || s.length > MAX_URL) throw new HttpError(400, 'invalid_url', `url must be 1 to ${MAX_URL} characters`);
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:/i, 'https:');
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new HttpError(400, 'invalid_url', 'That is not a web link');
  }
  if (u.protocol !== 'https:') throw new HttpError(400, 'invalid_url', 'Use an https:// or webcal:// calendar link');
  if (u.username || u.password) throw new HttpError(400, 'invalid_url', 'Links with a user name or password are not supported');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || IPV4_RE.test(host) || host.startsWith('[') || !host.includes('.')) {
    throw new HttpError(400, 'invalid_url', 'Use the calendar provider’s public link');
  }
  if (u.href.length > MAX_URL) throw new HttpError(400, 'invalid_url', `url must be 1 to ${MAX_URL} characters`);
  return u.href;
}

async function readCapped(res, maxBytes) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * GET one feed. Never throws; returns { ok: true, status, text } or { ok: false, code, status }.
 * code: timeout | network | too_large | too_many_redirects | insecure_redirect | denied | not_found | http_error
 */
export async function fetchFeed(url, { fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_ICS_BYTES } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status = null;
  try {
    let current = url;
    for (let hop = 0; ; hop++) {
      const res = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'text/calendar, text/plain;q=0.5, */*;q=0.1' },
      });
      status = res.status;
      if (status >= 300 && status < 400) {
        if (res.body) await res.body.cancel().catch(() => {});
        const loc = res.headers.get('location');
        if (!loc) return { ok: false, code: 'http_error', status };
        if (hop >= MAX_REDIRECTS) return { ok: false, code: 'too_many_redirects', status };
        try {
          current = checkFeedUrl(new URL(loc, current).href);
        } catch {
          return { ok: false, code: 'insecure_redirect', status };
        }
        continue;
      }
      if (!res.ok) {
        if (res.body) await res.body.cancel().catch(() => {});
        const code = status === 401 || status === 403 ? 'denied' : status === 404 || status === 410 ? 'not_found' : 'http_error';
        return { ok: false, code, status };
      }
      if (Number(res.headers.get('content-length') || 0) > maxBytes) {
        if (res.body) await res.body.cancel().catch(() => {});
        return { ok: false, code: 'too_large', status };
      }
      const text = await readCapped(res, maxBytes);
      if (text === null) return { ok: false, code: 'too_large', status };
      return { ok: true, status, text };
    }
  } catch {
    return { ok: false, code: controller.signal.aborted ? 'timeout' : 'network', status };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- storage

const CONN_COLS =
  'id, scope, label, kind, host, state, last_fetch_at, last_ok_at, last_error_code, last_status, event_count, unsupported_count, truncated, sample, created_at';

function publicConnection(row, nowMs) {
  const lastOk = row.last_ok_at ? Date.parse(row.last_ok_at) : null;
  return {
    id: row.id,
    scope: row.scope,
    label: row.label,
    kind: row.kind,
    host: row.host || null,
    state: row.state,
    last_fetch_at: row.last_fetch_at || null,
    last_ok_at: row.last_ok_at || null,
    last_error_code: row.last_error_code || null,
    last_status: row.last_status == null ? null : Number(row.last_status),
    event_count: Number(row.event_count || 0),
    unsupported_count: Number(row.unsupported_count || 0),
    truncated: Number(row.truncated || 0) === 1,
    sample: Number(row.sample || 0),
    created_at: row.created_at,
    refreshable: row.kind === 'ics_url',
    // Imports never refresh, so they are never called stale: the UI says when the file was imported.
    stale: row.kind === 'ics_url' && (lastOk === null || nowMs - lastOk > STALE_MS),
  };
}

async function listConnections(db, scope) {
  const where = scope === 'all' ? '' : 'WHERE scope = ?';
  const stmt = db.prepare(`SELECT ${CONN_COLS} FROM calendar_connections ${where} ORDER BY created_at, id`);
  const { results } = await (scope === 'all' ? stmt : stmt.bind(scope)).all();
  return results;
}

async function getConnection(db, id, scope) {
  const row = await db.prepare('SELECT * FROM calendar_connections WHERE id = ? AND scope = ?').bind(id, scope).first();
  if (!row) throw new HttpError(404, 'not_found', 'Calendar not found');
  return row;
}

function windowFor(nowMs) {
  return { fromMs: nowMs - WINDOW_PAST_MS, toMs: nowMs + WINDOW_FUTURE_MS, defaultTimeZone: DEFAULT_TZ };
}

/** Statements that replace a connection's events with `events` (from parseIcs) in one batch. */
async function replaceEventStatements(db, conn, events, nowIso) {
  const seen = new Map();
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const id = await eventId(conn.id, e.uid || `nouid:${i}`, e.key);
    seen.set(id, {
      id, title: e.title, location: e.location, start_at: e.start_at, end_at: e.end_at, start_on: e.start_on, end_on: e.end_on,
      all_day: e.all_day, time_zone: e.time_zone, busy_only: e.busy_only, shows_as: e.shows_as, start_ms: e.start_ms, end_ms: e.end_ms,
    });
  }
  const rows = [...seen.values()];
  const out = [db.prepare('DELETE FROM calendar_events WHERE connection_id = ?').bind(conn.id)];
  // One statement per chunk via json_each: a refresh costs a handful of D1 queries, not one per event.
  // The EXISTS guard stops a refresh that finishes after the connection was removed from writing orphans.
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    out.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO calendar_events (id, connection_id, scope, title, location, start_at, end_at, start_on, end_on,
             all_day, time_zone, busy_only, shows_as, start_ms, end_ms, sample, fetched_at)
           SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.title'), json_extract(value, '$.location'),
             json_extract(value, '$.start_at'), json_extract(value, '$.end_at'), json_extract(value, '$.start_on'),
             json_extract(value, '$.end_on'), json_extract(value, '$.all_day'), json_extract(value, '$.time_zone'),
             json_extract(value, '$.busy_only'), json_extract(value, '$.shows_as'), json_extract(value, '$.start_ms'),
             json_extract(value, '$.end_ms'), ?, ?
           FROM json_each(?) WHERE EXISTS (SELECT 1 FROM calendar_connections WHERE id = ?)`,
        )
        .bind(conn.id, conn.scope, Number(conn.sample || 0), nowIso, JSON.stringify(rows.slice(i, i + INSERT_CHUNK)), conn.id),
    );
  }
  return { statements: out, count: rows.length };
}

function okUpdate(db, connId, nowIso, status, count, stats) {
  return db
    .prepare(
      `UPDATE calendar_connections SET state = 'ok', last_fetch_at = ?, last_ok_at = ?, last_error_code = NULL, last_status = ?,
         event_count = ?, unsupported_count = ?, truncated = ? WHERE id = ?`,
    )
    .bind(nowIso, nowIso, status, count, stats.unsupported_rules, stats.truncated ? 1 : 0, connId);
}

/**
 * Fetches, parses and stores one ICS-link connection (a full row including url). On failure the previous
 * events stay (shown with their age) and the connection records the error in plain codes.
 */
export async function refreshConnection(db, conn, { nowMs, fetchImpl } = {}) {
  const nowIso = iso(nowMs);
  const r = await fetchFeed(conn.url, { fetchImpl });
  let code = r.ok ? null : r.code;
  if (r.ok) {
    try {
      const parsed = parseIcs(r.text, windowFor(nowMs));
      const { statements, count } = await replaceEventStatements(db, conn, parsed.events, nowIso);
      await db.batch([...statements, okUpdate(db, conn.id, nowIso, r.status, count, parsed.stats)]);
      await log(db, nowMs, 'calendar_refreshed', conn.id, { state: 'ok', status: r.status, count, truncated: parsed.stats.truncated });
      return;
    } catch (err) {
      if (!(err instanceof IcsError)) throw err;
      code = err.code;
    }
  }
  await db
    .prepare('UPDATE calendar_connections SET state = ?, last_fetch_at = ?, last_error_code = ?, last_status = ? WHERE id = ?')
    .bind('error', nowIso, code, r.status ?? null, conn.id)
    .run();
  await log(db, nowMs, 'calendar_refreshed', conn.id, { state: 'error', code, status: r.status ?? null });
}

async function importText(db, { scope, label, text, sample = 0 }, nowMs) {
  let parsed;
  try {
    parsed = parseIcs(text, windowFor(nowMs));
  } catch (err) {
    if (err instanceof IcsError && err.code === 'too_large') throw new HttpError(413, 'too_large', 'The calendar file is larger than 2 MB');
    if (err instanceof IcsError) throw new HttpError(422, 'not_ics', 'That file is not a calendar (.ics) file');
    throw err;
  }
  const nowIso = iso(nowMs);
  const conn = { id: newId('cal'), scope, sample };
  const insert = db
    .prepare(
      `INSERT INTO calendar_connections (id, scope, label, kind, url, host, state, sample, created_at)
       VALUES (?, ?, ?, 'ics_import', NULL, NULL, 'never', ?, ?)`,
    )
    .bind(conn.id, scope, label, sample, nowIso);
  const { statements, count } = await replaceEventStatements(db, conn, parsed.events, nowIso);
  await db.batch([insert, ...statements, okUpdate(db, conn.id, nowIso, null, count, parsed.stats)]);
  await log(db, nowMs, 'calendar_imported', conn.id, { scope, sample, count, truncated: parsed.stats.truncated });
  return conn.id;
}

async function countConnections(db) {
  return Number(await db.prepare('SELECT COUNT(*) AS n FROM calendar_connections').first('n'));
}

// ---------------------------------------------------------------- events (cross-track contract)

/**
 * Events overlapping [fromMs, toMs) for a view scope. With 'work' (or 'personal'), the other scope's events
 * come back busy-only: title and location are removed in SQL, so they never leave the database for that
 * view; its free (transparent) events are left out. 'all' returns everything.
 * @returns {Promise<Array<{ id, connection_id, scope, title, location, start_at, end_at, start_on, end_on,
 *   all_day, time_zone, busy_only, shows_as, sample, source_ref, fetched_at }>>}
 */
export async function listEvents(db, viewScope, { fromMs, toMs, limit = MAX_LIST } = {}) {
  requireScope(viewScope, { allowAll: true });
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) throw new HttpError(400, 'invalid_range', 'from must be before to');
  const all = viewScope === 'all';
  const own = viewScope;
  const sql = `SELECT id, connection_id, scope,
      ${all ? 'title' : 'CASE WHEN scope = ? THEN title ELSE NULL END AS title'},
      ${all ? 'location' : 'CASE WHEN scope = ? THEN location ELSE NULL END AS location'},
      start_at, end_at, start_on, end_on, all_day, time_zone,
      ${all ? 'busy_only' : 'CASE WHEN scope = ? THEN busy_only ELSE 1 END AS busy_only'},
      shows_as, sample, fetched_at
    FROM calendar_events
    WHERE start_ms < ? AND (end_ms > ? OR (end_ms = start_ms AND start_ms >= ?))
      ${all ? '' : "AND (scope = ? OR shows_as = 'busy')"}
    ORDER BY start_ms, end_ms, id LIMIT ?`;
  const n = Math.min(MAX_LIST, Math.max(1, Number(limit) || MAX_LIST));
  const binds = all ? [toMs, fromMs, fromMs, n] : [own, own, own, toMs, fromMs, fromMs, own, n];
  const { results } = await db.prepare(sql).bind(...binds).all();
  return results.map((e) => ({
    id: e.id,
    connection_id: e.connection_id,
    scope: e.scope,
    title: e.title ?? null,
    location: e.location ?? null,
    start_at: e.start_at ?? null,
    end_at: e.end_at ?? null,
    start_on: e.start_on ?? null,
    end_on: e.end_on ?? null,
    all_day: Number(e.all_day) === 1,
    time_zone: e.time_zone ?? null,
    busy_only: Number(e.busy_only) === 1,
    shows_as: e.shows_as,
    sample: Number(e.sample || 0),
    source_ref: `event:${e.id}`,
    fetched_at: e.fetched_at,
  }));
}

/** Calendar rows never cite captures or items, so a deleted source has nothing to purge here. */
export function purgeRef() {
  return [];
}

/** Cron: refresh at most one ICS link whose last attempt is older than 30 minutes (oldest first). */
export async function onScheduled(env, nowMs, { fetchImpl } = {}) {
  if (!env || !env.DB) return { refreshed: null };
  const row = await env.DB
    .prepare(
      `SELECT * FROM calendar_connections WHERE kind = 'ics_url' AND (last_fetch_at IS NULL OR last_fetch_at < ?)
       ORDER BY last_fetch_at IS NOT NULL, last_fetch_at, created_at, rowid LIMIT 1`,
    )
    .bind(iso(nowMs - REFRESH_EVERY_MS))
    .first();
  if (!row) return { refreshed: null };
  await refreshConnection(env.DB, row, { nowMs, fetchImpl });
  return { refreshed: row.id };
}

// ---------------------------------------------------------------- sample calendar (synthetic, labelled)

function sampleIcs(nowMs, scope) {
  const today = instantToZonedParts(nowMs, DEFAULT_TZ).date;
  const d = (offset) => {
    const t = new Date(Date.parse(`${today}T12:00:00Z`) + offset * DAY_MS).toISOString();
    return t.slice(0, 10).replace(/-/g, '');
  };
  const titles =
    scope === 'work'
      ? ['Crew stand-up', 'Site walk with the electrical lead', 'Inspection window', 'Optional supplier webinar', 'Trailer 2', 'North stair']
      : ['Morning run', 'Pick up the bike from the shop', 'Library books due', 'Neighbourhood open house', 'Park loop', 'Main Street'];
  const tz = 'TZID=America/New_York';
  const ev = (uid, ...lines) => ['BEGIN:VEVENT', `UID:${uid}@sample.harrison-os.invalid`, ...lines, 'END:VEVENT'];
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Harrison OS//Sample calendar//EN',
    'X-WR-TIMEZONE:America/New_York',
    ...ev('s1', `DTSTART;${tz}:${d(-7)}T083000`, `DTEND;${tz}:${d(-7)}T084500`, 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', `SUMMARY:${titles[0]}`, `LOCATION:${titles[4]}`),
    ...ev('s2', `DTSTART;${tz}:${d(0)}T140000`, `DTEND;${tz}:${d(0)}T150000`, `SUMMARY:${titles[1]}`, `LOCATION:${titles[5]}`),
    ...ev('s3', `DTSTART;${tz}:${d(0)}T120000`, `DTEND;${tz}:${d(0)}T130000`, 'CLASS:PRIVATE', 'SUMMARY:Private'),
    ...ev('s4', `DTSTART;VALUE=DATE:${d(1)}`, `DTEND;VALUE=DATE:${d(2)}`, `SUMMARY:${titles[2]}`),
    ...ev('s5', `DTSTART;${tz}:${d(1)}T160000`, `DTEND;${tz}:${d(1)}T170000`, 'TRANSP:TRANSPARENT', `SUMMARY:${titles[3]}`),
    'END:VCALENDAR',
  ].join('\r\n');
}

// ---------------------------------------------------------------- routes

async function getConnectionsRoute(ctx) {
  const scope = queryScope(ctx, { allowAll: true });
  const rows = await listConnections(ctx.env.DB, scope);
  return json(200, { connections: rows.map((r) => publicConnection(r, ctx.nowMs)) });
}

async function postConnection(ctx) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope);
  const label = requireText(body.label, 'label', MAX_LABEL);
  const url = checkFeedUrl(body.url);
  const db = ctx.env.DB;
  if ((await countConnections(db)) >= MAX_CONNECTIONS) throw new HttpError(409, 'too_many', `At most ${MAX_CONNECTIONS} calendars`);
  const id = newId('cal');
  const nowIso = iso(ctx.nowMs);
  await db
    .prepare(
      `INSERT INTO calendar_connections (id, scope, label, kind, url, host, state, sample, created_at)
       VALUES (?, ?, ?, 'ics_url', ?, ?, 'never', 0, ?)`,
    )
    .bind(id, scope, label, url, new URL(url).hostname, nowIso)
    .run();
  await log(db, ctx.nowMs, 'calendar_connected', id, { scope, kind: 'ics_url' });
  return json(201, { connection: publicConnection(await getConnection(db, id, scope), ctx.nowMs) });
}

async function postRefresh(ctx, id) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope);
  const db = ctx.env.DB;
  const conn = await getConnection(db, id, scope);
  if (conn.kind !== 'ics_url') throw new HttpError(409, 'not_refreshable', 'An imported file does not refresh. Import a newer file instead.');
  await refreshConnection(db, conn, { nowMs: ctx.nowMs });
  return json(200, { connection: publicConnection(await getConnection(db, id, scope), ctx.nowMs) });
}

// The import body carries a whole .ics file, so it has its own size limit instead of readJson's 64 KB.
async function readImportBody(request) {
  const limit = MAX_ICS_BYTES + 64 * 1024;
  if (Number(request.headers.get('content-length') || 0) > limit * 2) throw new HttpError(413, 'too_large', 'The calendar file is larger than 2 MB');
  const text = await request.text();
  if (text.length > limit * 2) throw new HttpError(413, 'too_large', 'The calendar file is larger than 2 MB');
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad_json', 'Body must be JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'bad_json', 'Body must be a JSON object');
  return body;
}

async function postImport(ctx) {
  const body = await readImportBody(ctx.request);
  const scope = requireScope(body.scope);
  const label = requireText(body.label, 'label', MAX_LABEL);
  if (typeof body.ics_text !== 'string' || !body.ics_text.trim()) throw new HttpError(400, 'invalid_ics_text', 'ics_text must be the file contents');
  const db = ctx.env.DB;
  if ((await countConnections(db)) >= MAX_CONNECTIONS) throw new HttpError(409, 'too_many', `At most ${MAX_CONNECTIONS} calendars`);
  const id = await importText(db, { scope, label, text: body.ics_text }, ctx.nowMs);
  return json(201, { connection: publicConnection(await getConnection(db, id, scope), ctx.nowMs) });
}

async function postSample(ctx) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope);
  const db = ctx.env.DB;
  // One sample calendar per scope: loading it again replaces it with one built for today.
  await db.batch([
    db.prepare('DELETE FROM calendar_events WHERE connection_id IN (SELECT id FROM calendar_connections WHERE scope = ? AND sample = 1)').bind(scope),
    db.prepare('DELETE FROM calendar_connections WHERE scope = ? AND sample = 1').bind(scope),
  ]);
  const id = await importText(db, { scope, label: 'Sample calendar', text: sampleIcs(ctx.nowMs, scope), sample: 1 }, ctx.nowMs);
  return json(201, { connection: publicConnection(await getConnection(db, id, scope), ctx.nowMs) });
}

async function deleteConnectionRoute(ctx, id) {
  const scope = queryScope(ctx);
  const db = ctx.env.DB;
  await getConnection(db, id, scope);
  await db.batch([
    db.prepare('DELETE FROM calendar_events WHERE connection_id = ?').bind(id),
    db.prepare('DELETE FROM calendar_connections WHERE id = ? AND scope = ?').bind(id, scope),
  ]);
  await log(db, ctx.nowMs, 'calendar_removed', id, { scope });
  return json(200, { deleted: true });
}

// from/to: ISO instants, or YYYY-MM-DD read as midnight in tz (default America/New_York).
function boundary(value, fallback, tz) {
  if (value === null || value === '') return fallback;
  if (DATE_RE.test(value)) {
    try {
      return zonedWallTimeToInstant({ date: value, time: '00:00', timeZone: tz }).instantMs;
    } catch {
      throw new HttpError(400, 'invalid_range', 'from and to must be dates or ISO times');
    }
  }
  const ms = /T/.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) throw new HttpError(400, 'invalid_range', 'from and to must be dates or ISO times');
  return ms;
}

async function getEventsRoute(ctx) {
  const scope = queryScope(ctx, { allowAll: true });
  const p = ctx.url.searchParams;
  const tz = p.get('tz') ? validTimeZone(p.get('tz'), ctx.nowMs) : DEFAULT_TZ;
  if (!tz) throw new HttpError(400, 'invalid_time_zone', 'tz must be an IANA time zone');
  const fromMs = boundary(p.get('from'), ctx.nowMs, tz);
  const toMs = boundary(p.get('to'), fromMs + 7 * DAY_MS, tz);
  if (toMs <= fromMs) throw new HttpError(400, 'invalid_range', 'from must be before to');
  if (toMs - fromMs > MAX_RANGE_MS) throw new HttpError(400, 'range_too_long', 'Ask for at most 92 days');
  const db = ctx.env.DB;
  const [events, rows] = await Promise.all([listEvents(db, scope, { fromMs, toMs }), listConnections(db, scope)]);
  return json(200, {
    events,
    connections: rows.map((r) => publicConnection(r, ctx.nowMs)),
    from: iso(fromMs),
    to: iso(toMs),
  });
}

const r = (pattern) => new RegExp(`^${pattern}$`);

export const ROUTES = [
  ['GET', r('/api/calendar/connections'), getConnectionsRoute],
  ['POST', r('/api/calendar/connections'), postConnection],
  ['POST', r(`/api/calendar/connections/(${ID})/refresh`), postRefresh],
  ['DELETE', r(`/api/calendar/connections/(${ID})`), deleteConnectionRoute],
  ['POST', r('/api/calendar/import'), postImport],
  ['POST', r('/api/calendar/sample'), postSample],
  ['GET', r('/api/calendar/events'), getEventsRoute],
];
