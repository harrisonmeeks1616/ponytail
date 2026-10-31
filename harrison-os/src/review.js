// Weekly review (Slice 3.3): a short, source-linked look back over the last 7 days and ahead over the
// next 14, built deterministically from the shared records. It never creates tasks, never touches a hard
// date (due_on) and never turns an idea into a commitment. The only writes are the owner's own choices:
// picks for the week (optionally onto Today), "Not this week" deferrals and "Mark review done".
//
// Reads on core tables are read-only and scope-bound (PLAN.md); core writes go through db.js. This module
// owns weekly_reviews (migrations/0007_review.sql). Calendar and PM entries come in through their module
// contracts when those modules provide them, and are reported as not available otherwise.
import * as db from './db.js';
import * as calendarModule from './calendar.js';
import * as pmModule from './pm.js';
import { HttpError, json, readJson, requireScope, queryScope, iso, validTimeZone, DATE_RE } from './http.js';
import { instantToZonedParts } from './time.js';
import { addDaysOn, weekdayOf } from './dates.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOK_BACK_DAYS = 7;
const HARD_AHEAD_DAYS = 14;
const QUIET_AFTER_DAYS = 14;
const DUE_AFTER_DAYS = 6; // the Today link shows when the last finished review is older than this
const LIST_CAP = 50;
const MAX_REFS = 50;
const META_LAST_TZ = 'last_time_zone'; // written by src/api.js from the device's reported zone
const REF_RE = /^(item|project):([A-Za-z0-9_.:-]{1,120})$/;

// ---------------------------------------------------------------- small helpers

function scopesOf(scope) {
  if (scope === 'all') return ['work', 'personal'];
  if (scope === 'work' || scope === 'personal') return [scope];
  throw new db.ScopeError();
}

function inScopes(scopes, col = 'scope') {
  return `${col} IN (${scopes.map(() => '?').join(', ')})`;
}

async function rows(d1, sql, ...params) {
  const res = await d1.prepare(sql).bind(...params).all();
  return (res && res.results) || [];
}

function parseList(text) {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function isDateOn(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Monday (YYYY-MM-DD) of the local week containing todayOn. */
export function weekOf(todayOn) {
  return addDaysOn(todayOn, -((weekdayOf(todayOn) + 6) % 7));
}

function windowFor(nowMs, timeZone) {
  const todayOn = instantToZonedParts(nowMs, timeZone).date;
  const week = weekOf(todayOn);
  return {
    todayOn,
    week_of: week,
    next_monday: addDaysOn(week, 7),
    follow_up_by: addDaysOn(week, 13), // the Sunday that ends next week
    hard_until: addDaysOn(todayOn, HARD_AHEAD_DAYS),
    since: iso(nowMs - LOOK_BACK_DAYS * DAY_MS),
  };
}

function itemRow(r, date, extra) {
  return {
    ref: `item:${r.id}`,
    kind: r.kind,
    title: r.title,
    scope: r.scope,
    sample: Number(r.sample) ? 1 : 0,
    date,
    project_id: r.project_id ?? null,
    source: r.source_capture_id ? `capture:${r.source_capture_id}` : null,
    ...extra,
  };
}

function projectRow(p, date, extra) {
  return { ref: `project:${p.id}`, kind: 'project', title: p.name, scope: p.scope, sample: Number(p.sample) ? 1 : 0, date, ...extra };
}

// The owner's choices for this week, per scope.
async function loadRecords(d1, scopes, week) {
  const found = await rows(d1, `SELECT * FROM weekly_reviews WHERE week_of = ? AND ${inScopes(scopes)}`, week, ...scopes);
  const out = {};
  for (const s of scopes) {
    const r = found.find((x) => x.scope === s);
    out[s] = {
      week_of: week,
      opened_at: r ? r.opened_at : null,
      completed_at: r ? r.completed_at : null,
      selections: r ? parseList(r.selections).filter((x) => typeof x === 'string') : [],
      deferrals: r ? parseList(r.deferrals).filter((x) => x && typeof x.ref === 'string') : [],
    };
  }
  return out;
}

// ---------------------------------------------------------------- calendar and PM (via their contracts)

async function calendarRows(impl, d1, scope, scopes, nowMs, timeZone) {
  if (!impl || typeof impl.listEvents !== 'function') return { state: 'not_available', rows: [] };
  let events;
  try {
    events = await impl.listEvents(d1, scope, { fromMs: nowMs, toMs: nowMs + HARD_AHEAD_DAYS * DAY_MS });
  } catch {
    return { state: 'error', rows: [] };
  }
  const out = [];
  for (const e of Array.isArray(events) ? events.slice(0, LIST_CAP) : []) {
    if (!e || !scopes.concat(scope === 'work' ? ['personal'] : []).includes(e.scope)) continue;
    // Defence in depth: in a Work review another scope's event is a busy interval, never its title.
    const busy = !!e.busy_only || (scope === 'work' && e.scope !== 'work');
    const startMs = e.start_at ? Date.parse(e.start_at) : NaN;
    const on = e.start_on || (Number.isFinite(startMs) ? instantToZonedParts(startMs, timeZone).date : null);
    out.push({
      ref: typeof e.source_ref === 'string' ? e.source_ref : `event:${e.id}`,
      kind: 'event',
      title: busy ? null : e.title ?? null,
      busy_only: busy,
      scope: e.scope,
      sample: Number(e.sample) ? 1 : 0,
      date: on,
      at: e.all_day ? null : e.start_at ?? null,
      all_day: !!e.all_day,
      fetched_at: e.fetched_at ?? null,
    });
  }
  return { state: 'included', rows: out };
}

// PM due dates from T5's digest: each project's next_milestone (ref = the project's pm:<id>) and its
// overdue / due_soon items. Overdue entries stay in, marked past, like overdue core tasks.
// ponytail: T5's due_soon window is 7 days, so the digest is asked as of today+7: its overdue + due_soon
// then cover every dated item up to today+14, and `past` is recomputed against the real today. Only the
// date classification depends on nowMs there (plus source staleness, unused here). Upgrade path: a
// window option on listDigest.
async function pmRows(impl, d1, scope, scopes, nowMs, timeZone, w) {
  if (!impl || typeof impl.listDigest !== 'function') return { state: 'not_available', rows: [] };
  let digest;
  try {
    digest = await impl.listDigest(d1, scope, { nowMs: nowMs + (HARD_AHEAD_DAYS - 7) * DAY_MS, timeZone });
  } catch {
    return { state: 'error', rows: [] };
  }
  const out = [];
  const add = (x, ref, title, dueOn) => {
    if (!x || typeof x !== 'object' || out.length >= LIST_CAP) return;
    const s = x.scope || (scope === 'all' ? null : scope);
    if (!scopes.includes(s) || typeof ref !== 'string' || !ref.startsWith('pm:') || out.some((r) => r.ref === ref)) return;
    if (!isDateOn(dueOn) || dueOn > w.hard_until) return;
    out.push({
      ref,
      kind: 'pm',
      title: typeof title === 'string' ? title : null,
      scope: s,
      sample: Number(x.sample) ? 1 : 0,
      date: dueOn,
      past: dueOn < w.todayOn,
      url: typeof x.url === 'string' && /^https:\/\//i.test(x.url) ? x.url : null,
      fetched_at: x.fetched_at ?? x.exported_at ?? null,
    });
  };
  for (const p of Array.isArray(digest && digest.projects) ? digest.projects : []) {
    if (!p || typeof p !== 'object') continue;
    const m = p.next_milestone;
    if (m && typeof m === 'object') add(p, p.source_ref, [p.name, m.title].filter((t) => typeof t === 'string').join(': ') || null, m.due_on);
    for (const list of [p.overdue, p.due_soon]) for (const x of Array.isArray(list) ? list : []) add(x, x && x.source_ref, x && x.title, x && x.due_on);
  }
  return { state: 'included', rows: out };
}

// ---------------------------------------------------------------- the review

/**
 * Deterministic weekly review for 'work', 'personal' or 'all' (read-only). Every row carries a source ref
 * and a date. Options: nowMs, timeZone (IANA), and for tests calendar / pm module stand-ins.
 */
export async function buildWeeklyReview(d1, scope, { nowMs, timeZone, calendar = calendarModule, pm = pmModule } = {}) {
  const scopes = scopesOf(scope);
  if (!Number.isFinite(nowMs)) throw new db.ValidationError('nowMs is required', 'nowMs');
  if (!validTimeZone(timeZone, nowMs)) throw new db.ValidationError('timeZone must be an IANA zone name', 'timeZone');
  const w = windowFor(nowMs, timeZone);
  const inS = inScopes(scopes);
  const records = await loadRecords(d1, scopes, w.week_of);
  const nowIso = iso(nowMs);
  const quietBefore = iso(nowMs - QUIET_AFTER_DAYS * DAY_MS);

  const doneItems = await rows(d1, `SELECT * FROM items WHERE ${inS} AND state = 'done' AND done_at >= ? ORDER BY done_at DESC, id LIMIT ${LIST_CAP}`, ...scopes, w.since);
  const doneProjects = await rows(d1, `SELECT * FROM projects WHERE ${inS} AND state = 'done' AND updated_at >= ? ORDER BY updated_at DESC, id LIMIT ${LIST_CAP}`, ...scopes, w.since);
  const decisionsMade = await rows(d1, `SELECT * FROM items WHERE ${inS} AND kind = 'decision' AND created_at >= ? ORDER BY created_at DESC, id LIMIT ${LIST_CAP}`, ...scopes, w.since);
  const replies = await rows(d1, `SELECT * FROM items WHERE ${inS} AND kind = 'waiting' AND reply_recorded_at >= ? ORDER BY reply_recorded_at DESC, id LIMIT ${LIST_CAP}`, ...scopes, w.since);
  const captureCounts = await rows(
    d1,
    `SELECT SUM(CASE WHEN review_state != 'pending' AND received_at >= ? THEN 1 ELSE 0 END) AS sorted, ` +
      `SUM(CASE WHEN review_state = 'pending' THEN 1 ELSE 0 END) AS pending FROM captures WHERE ${inS}`,
    w.since,
    ...scopes,
  );
  // Ideas are never hard commitments, even with a date on them.
  const hardItems = await rows(
    d1,
    `SELECT * FROM items WHERE ${inS} AND kind NOT IN ('waiting', 'idea') AND state = 'open' AND due_on IS NOT NULL AND due_on <= ? ORDER BY due_on, id LIMIT ${LIST_CAP}`,
    ...scopes,
    w.hard_until,
  );
  const reminders = await rows(
    d1,
    `SELECT * FROM reminders WHERE ${inS} AND state = 'active' AND next_fire_at IS NOT NULL AND next_fire_at <= ? ORDER BY next_fire_at, id LIMIT ${LIST_CAP}`,
    ...scopes,
    nowMs + HARD_AHEAD_DAYS * DAY_MS,
  );
  const followUps = await rows(
    d1,
    `SELECT * FROM items WHERE ${inS} AND kind = 'waiting' AND state = 'open' AND follow_up_on IS NOT NULL AND follow_up_on <= ? ORDER BY follow_up_on, id LIMIT ${LIST_CAP}`,
    ...scopes,
    w.follow_up_by,
  );
  const openDecisions = await rows(
    d1,
    `SELECT * FROM items WHERE ${inS} AND kind = 'decision' AND state = 'open' AND superseded_by_id IS NULL ORDER BY created_at DESC, id LIMIT 200`,
    ...scopes,
  );
  const resume = await rows(
    d1,
    'SELECT p.id, p.name, p.scope, p.sample, p.last_touched_at, p.updated_at, c.stopped_at_text, c.open_question, c.next_step, ' +
      'c.source_ref, c.created_at AS checkpoint_at FROM projects p JOIN (' +
      `  SELECT *, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at DESC, rowid DESC) AS rn FROM checkpoints WHERE ${inS}` +
      `) c ON c.project_id = p.id AND c.scope = p.scope AND c.rn = 1 WHERE ${inScopes(scopes, 'p.scope')} AND p.state = 'active' ` +
      `ORDER BY coalesce(p.last_touched_at, p.updated_at) DESC, p.id LIMIT ${LIST_CAP}`,
    ...scopes,
    ...scopes,
  );
  // Last activity = the latest of the project's own touch/update and any of its items' updates.
  const quiet = await rows(
    d1,
    'SELECT * FROM (SELECT p.*, max(coalesce(p.last_touched_at, \'\'), p.updated_at, ' +
      "coalesce((SELECT max(i.updated_at) FROM items i WHERE i.project_id = p.id AND i.scope = p.scope), '')) AS last_activity_at " +
      `FROM projects p WHERE ${inScopes(scopes, 'p.scope')} AND p.state = 'active') WHERE last_activity_at < ? ORDER BY last_activity_at, id LIMIT ${LIST_CAP}`,
    ...scopes,
    quietBefore,
  );
  const ideas = await rows(d1, `SELECT * FROM items WHERE ${inS} AND kind = 'idea' AND state = 'open' ORDER BY created_at DESC, id LIMIT ${LIST_CAP}`, ...scopes);
  const ideaCount = await rows(d1, `SELECT COUNT(*) AS n FROM items WHERE ${inS} AND kind = 'idea' AND state = 'open'`, ...scopes);

  const cal = await calendarRows(calendar, d1, scope, scopes, nowMs, timeZone);
  const pmr = await pmRows(pm, d1, scope, scopes, nowMs, timeZone, w);

  // Selections mark rows; a "Not this week" choice hides a flexible row for this week. Hard dates are
  // never hidden: a deferred hard task still shows, with its unchanged due date.
  const deferral = (row) => {
    const rec = records[row.scope];
    const d = rec && rec.deferrals.find((x) => x.ref === row.ref);
    if (!d || typeof d.until !== 'string' || d.until <= w.todayOn) return null;
    // A deferral that wrote a date counts only while that date is still the live value (Undo restores it).
    if (d.field === 'follow_up_on' && row.date !== d.until) return null;
    if (d.field === 'start_on' && row.start_on !== d.until) return null;
    return d;
  };
  const deferredUntil = (row) => (deferral(row) || {}).until || null;
  const mark = (row) => ({ ...row, selected: !!(records[row.scope] && records[row.scope].selections.includes(row.ref)) });
  const flexible = (list) => list.map(mark).filter((r) => !deferredUntil(r));

  const hard = [
    ...hardItems.map((r) => itemRow(r, r.due_on, { past: r.due_on < w.todayOn, start_on: r.start_on ?? null, deferred_until: null })),
    ...reminders.map((r) => {
      const ms = Number(r.next_fire_at);
      let on = null;
      try {
        on = instantToZonedParts(ms, r.time_zone).date;
      } catch {
        on = instantToZonedParts(ms, timeZone).date;
      }
      return { ref: `reminder:${r.id}`, kind: 'reminder', title: r.text, scope: r.scope, sample: Number(r.sample) ? 1 : 0, date: on, at: iso(ms), item_ref: r.item_id ? `item:${r.item_id}` : null };
    }),
    ...cal.rows,
    ...pmr.rows,
  ]
    .map((r) => {
      const m = mark(r);
      if (m.kind === 'task') {
        // deferred_field null = only set aside in this review: core (Today, Tasks) still shows the task.
        const d = deferral(m);
        m.deferred_until = d ? d.until : null;
        m.deferred_field = d ? d.field || null : null;
      }
      return m;
    })
    .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || String(a.at || '').localeCompare(String(b.at || '')) || a.ref.localeCompare(b.ref));

  const counts = captureCounts[0] || {};
  const sections = {
    completed: [
      ...doneItems.map((r) => itemRow(r, r.done_at)),
      ...doneProjects.map((p) => projectRow(p, p.updated_at)),
    ].sort((a, b) => b.date.localeCompare(a.date) || a.ref.localeCompare(b.ref)),
    changes: {
      decisions: decisionsMade.map((r) =>
        itemRow(r, r.decided_on || r.created_at, {
          supersedes: r.supersedes_id ? `item:${r.supersedes_id}` : null,
          superseded_by: r.superseded_by_id ? `item:${r.superseded_by_id}` : null,
        }),
      ),
      replies: replies.map((r) => itemRow(r, r.reply_recorded_at, { who: r.who ?? null })),
      captures: { sorted: Number(counts.sorted) || 0, pending: Number(counts.pending) || 0, since: w.since },
    },
    hard,
    follow_ups: flexible(
      followUps.map((r) =>
        itemRow(r, r.follow_up_on, { who: r.who ?? null, promised_on: r.promised_on ?? null, reply_recorded_at: r.reply_recorded_at ?? null, past: r.follow_up_on < w.todayOn }),
      ),
    ),
    decisions: flexible(
      openDecisions
        .filter((r) => r.claim_status === 'proposed' || (typeof r.reconsider_when === 'string' && r.reconsider_when.trim() !== ''))
        .slice(0, LIST_CAP)
        .map((r) => itemRow(r, r.decided_on || r.created_at, { claim_status: r.claim_status ?? null, reconsider_when: r.reconsider_when ?? null })),
    ),
    resume: flexible(
      resume.map((p) =>
        projectRow(p, p.checkpoint_at, {
          last_touched_at: p.last_touched_at ?? p.updated_at,
          checkpoint: { stopped_at_text: p.stopped_at_text, open_question: p.open_question, next_step: p.next_step, source_ref: p.source_ref ?? null },
        }),
      ),
    ),
    quiet: flexible(quiet.map((p) => projectRow(p, p.last_activity_at || p.updated_at))),
    ideas: ideas.map((r) => mark(itemRow(r, r.created_at))),
  };

  return {
    scope,
    timeZone,
    generated_at: nowIso,
    ...w,
    records,
    sources: { calendar: cal.state, pm: pmr.state },
    idea_count: Number((ideaCount[0] || {}).n) || 0,
    sections,
  };
}

/** { due, last_completed_at }: due when any scope's last finished review is older than DUE_AFTER_DAYS or missing. */
export async function reviewStatus(d1, scope, nowMs) {
  const scopes = scopesOf(scope);
  const found = await rows(
    d1,
    `SELECT scope, MAX(completed_at) AS at FROM weekly_reviews WHERE ${inScopes(scopes)} AND completed_at IS NOT NULL GROUP BY scope`,
    ...scopes,
  );
  const last = scopes.map((s) => (found.find((r) => r.scope === s) || {}).at || null);
  const oldest = last.includes(null) ? null : last.sort()[0];
  return { due: !oldest || nowMs - Date.parse(oldest) > DUE_AFTER_DAYS * DAY_MS, last_completed_at: oldest };
}

/**
 * Derived-data purge: removes `ref` from every stored selection and deferral. Accepts (db, ref) as in
 * TRACKS.md and (db, scope, ref) as in PLAN.md; the ref is always the last argument.
 */
export function purgeRef(d1, ...args) {
  const ref = args[args.length - 1];
  if (typeof ref !== 'string' || !ref) return [];
  return [
    d1
      .prepare(
        'UPDATE weekly_reviews SET ' +
          'selections = (SELECT json_group_array(value) FROM json_each(weekly_reviews.selections) WHERE value <> ?), ' +
          "deferrals = (SELECT json_group_array(json(value)) FROM json_each(weekly_reviews.deferrals) WHERE json_extract(value, '$.ref') <> ?) " +
          'WHERE EXISTS (SELECT 1 FROM json_each(weekly_reviews.selections) WHERE value = ?) ' +
          "OR EXISTS (SELECT 1 FROM json_each(weekly_reviews.deferrals) WHERE json_extract(value, '$.ref') = ?)",
      )
      .bind(ref, ref, ref, ref),
  ];
}

// ---------------------------------------------------------------- routes

async function zoneFor(ctx, asked) {
  if (asked !== undefined && asked !== null && asked !== '') {
    const tz = validTimeZone(asked, ctx.nowMs);
    if (!tz) throw new HttpError(400, 'invalid_time_zone', 'time zone must be an IANA zone name');
    return tz;
  }
  const last = validTimeZone(await db.getMeta(ctx.env.DB, META_LAST_TZ), ctx.nowMs);
  if (!last) throw new HttpError(400, 'time_zone_required', 'tz is required (an IANA zone name)');
  return last;
}

function ensureRecord(d1, scope, week, nowIso) {
  return d1
    .prepare('INSERT OR IGNORE INTO weekly_reviews (id, scope, week_of, opened_at) VALUES (?, ?, ?, ?)')
    .bind(`${scope}:${week}`, scope, week, nowIso);
}

function parseRefs(value) {
  const list = Array.isArray(value) ? value : [value];
  if (!list.length || list.length > MAX_REFS) throw new HttpError(400, 'invalid_refs', `refs must hold 1 to ${MAX_REFS} refs`);
  const out = new Map();
  for (const ref of list) {
    const m = typeof ref === 'string' ? REF_RE.exec(ref) : null;
    if (!m) throw new HttpError(400, 'invalid_ref', "each ref must be 'item:<id>' or 'project:<id>'");
    out.set(ref, { ref, type: m[1], id: m[2] });
  }
  return [...out.values()];
}

// Every ref must name an existing row in this scope; otherwise 404 without saying which.
async function rowsInScope(d1, scope, refs) {
  const found = new Map();
  for (const [type, table] of [['item', 'items'], ['project', 'projects']]) {
    const ids = refs.filter((r) => r.type === type).map((r) => r.id);
    if (!ids.length) continue;
    for (const row of await rows(d1, `SELECT * FROM ${table} WHERE scope = ? AND id IN (${ids.map(() => '?').join(', ')})`, scope, ...ids)) {
      found.set(`${type}:${row.id}`, row);
    }
  }
  if (found.size !== refs.length) throw new db.NotFoundError('No such item or project in this scope');
  return found;
}

async function getReview(ctx) {
  const scope = queryScope(ctx, { allowAll: true });
  const timeZone = await zoneFor(ctx, ctx.url.searchParams.get('tz'));
  const week = weekOf(instantToZonedParts(ctx.nowMs, timeZone).date);
  await ctx.env.DB.batch(scopesOf(scope).map((s) => ensureRecord(ctx.env.DB, s, week, iso(ctx.nowMs))));
  const review = await buildWeeklyReview(ctx.env.DB, scope, { nowMs: ctx.nowMs, timeZone });
  return json(200, { ...review, status: await reviewStatus(ctx.env.DB, scope, ctx.nowMs) });
}

async function getStatus(ctx) {
  const scope = queryScope(ctx, { allowAll: true });
  return json(200, await reviewStatus(ctx.env.DB, scope, ctx.nowMs));
}

async function postSelect(ctx) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope);
  const refs = parseRefs(body.refs);
  const d1 = ctx.env.DB;
  const found = await rowsInScope(d1, scope, refs);
  const timeZone = await zoneFor(ctx, body.time_zone);
  const week = weekOf(instantToZonedParts(ctx.nowMs, timeZone).date);
  const nowIso = iso(ctx.nowMs);
  // Optional: put picked open tasks on Today. Only tasks; ideas and other kinds stay what they are.
  const changeIds = [];
  if (body.today === true) {
    for (const r of refs) {
      const row = found.get(r.ref);
      if (r.type !== 'item' || row.kind !== 'task' || row.state !== 'open' || Number(row.today_pick)) continue;
      const res = await db.updateItem(d1, r.id, { today_pick: true }, scope, nowIso);
      if (res.changeId != null) changeIds.push(res.changeId);
    }
  }
  const list = JSON.stringify(refs.map((r) => r.ref));
  await d1.batch([
    ensureRecord(d1, scope, week, nowIso),
    d1
      .prepare(
        'UPDATE weekly_reviews SET ' +
          'selections = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(weekly_reviews.selections) UNION SELECT value FROM json_each(?))), ' +
          "deferrals = (SELECT json_group_array(json(value)) FROM json_each(weekly_reviews.deferrals) WHERE json_extract(value, '$.ref') NOT IN (SELECT value FROM json_each(?))) " +
          'WHERE id = ?',
      )
      .bind(list, list, `${scope}:${week}`),
  ]);
  const rec = (await loadRecords(d1, [scope], week))[scope];
  return json(200, { week_of: week, selections: rec.selections, picked_for_today: changeIds.length, changeIds, changeId: changeIds[0] ?? null });
}

async function postDefer(ctx) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope);
  const [target] = parseRefs(typeof body.ref === 'string' ? body.ref : null);
  const asField = body.follow_up_on !== undefined ? 'follow_up_on' : body.start_on !== undefined ? 'start_on' : null;
  const until = asField ? body[asField] : null;
  if (!isDateOn(until)) throw new HttpError(400, 'invalid_date', 'follow_up_on or start_on must be YYYY-MM-DD');
  const d1 = ctx.env.DB;
  const row = (await rowsInScope(d1, scope, [target])).get(target.ref);
  const timeZone = await zoneFor(ctx, body.time_zone);
  const week = weekOf(instantToZonedParts(ctx.nowMs, timeZone).date);
  const nowIso = iso(ctx.nowMs);
  let applied = 'review_only';
  let changeId = null;
  if (target.type === 'item') {
    if (row.state !== 'open') throw new HttpError(409, 'not_open', 'Only open items can be moved to a later week');
    if (row.kind === 'waiting') {
      if (asField !== 'follow_up_on') throw new HttpError(400, 'follow_up_on_required', 'A Waiting item moves by its follow-up date');
      ({ changeId } = await db.snoozeFollowUp(d1, target.id, until, scope, nowIso));
      applied = 'follow_up_on';
    } else if (row.kind === 'task') {
      if (asField !== 'start_on') throw new HttpError(400, 'start_on_required', 'A task moves by its start date');
      // start_on ("not before") is a core column; only the patch below writes it, never due_on.
      try {
        ({ changeId } = await db.updateItem(d1, target.id, { start_on: until }, scope, nowIso));
        applied = 'start_on';
      } catch (err) {
        if (!(err instanceof db.ValidationError) || err.field !== 'start_on') throw err;
        applied = 'review_only'; // core without start_on yet: the review still hides it for this week
      }
    }
  }
  const entry = JSON.stringify({ ref: target.ref, until, field: applied === 'review_only' ? null : applied, at: nowIso });
  await d1.batch([
    ensureRecord(d1, scope, week, nowIso),
    d1
      .prepare(
        'UPDATE weekly_reviews SET ' +
          "deferrals = json_insert((SELECT json_group_array(json(value)) FROM json_each(weekly_reviews.deferrals) WHERE json_extract(value, '$.ref') <> ?), '$[#]', json(?)), " +
          'selections = (SELECT json_group_array(value) FROM json_each(weekly_reviews.selections) WHERE value <> ?) ' +
          'WHERE id = ?',
      )
      .bind(target.ref, entry, target.ref, `${scope}:${week}`),
  ]);
  return json(200, { week_of: week, ref: target.ref, until, applied, changeId });
}

async function postComplete(ctx) {
  const body = await readJson(ctx.request);
  const scope = requireScope(body.scope);
  const timeZone = await zoneFor(ctx, body.time_zone);
  const week = weekOf(instantToZonedParts(ctx.nowMs, timeZone).date);
  const nowIso = iso(ctx.nowMs);
  await ctx.env.DB.batch([
    ensureRecord(ctx.env.DB, scope, week, nowIso),
    ctx.env.DB.prepare('UPDATE weekly_reviews SET completed_at = ? WHERE id = ?').bind(nowIso, `${scope}:${week}`),
  ]);
  return json(200, { week_of: week, completed_at: nowIso, status: await reviewStatus(ctx.env.DB, scope, ctx.nowMs) });
}

export const ROUTES = [
  ['GET', /^\/api\/review\/weekly$/, getReview],
  ['GET', /^\/api\/review\/weekly\/status$/, getStatus],
  ['POST', /^\/api\/review\/weekly\/select$/, postSelect],
  ['POST', /^\/api\/review\/weekly\/defer$/, postDefer],
  ['POST', /^\/api\/review\/weekly\/complete$/, postComplete],
];
