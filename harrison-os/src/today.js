// Today: a pure function over the plain rows that db.listForToday returns.
// No I/O, no clock, no SQL. Inputs are never mutated; every output object is new.
//
// ---------------------------------------------------------------------------
// Expected input: `rows` (what listForToday(db, scope, todayOn) should return)
// ---------------------------------------------------------------------------
// Column names are the `items`, `projects`, `checkpoints`, `reminders` and
// `deliveries` columns from CONTRACT.md, so a plain SELECT can feed this.
// Every array and field is optional; missing arrays are treated as empty.
//
// rows.tasks: open task rows (state 'open'; a row with state 'done' is shown
//   as done and never chosen as next). Rows of any other kind are ignored here.
//   { id, kind: 'task', scope, title, state, due_on: 'YYYY-MM-DD'|null,
//     today_pick: 0|1, created_at, project_id? }
//
// rows.waiting: ALL open waiting rows in scope (not only due ones), so that
//   waiting.count is right. If the data layer returns only due rows, it must
//   also pass rows.waitingCount (below).
//   { id, kind: 'waiting', scope, title, state, who: string|null,
//     asked_on: 'YYYY-MM-DD'|null, follow_up_on: 'YYYY-MM-DD'|null,
//     reply_recorded_at: ISO|null, claim_status, created_at }
//
// rows.waitingCount (optional): number, or { work: n, personal: n }.
//
// rows.hardDates (optional): open non-waiting items with due_on <= todayOn + 7
//   (same shape as tasks; any non-waiting kind). Merged with rows.tasks by id.
//
// rows.inboxCount: number, or { work: n, personal: n }.
//
// rows.checkpoints: the latest checkpoint per ACTIVE project, joined to it.
//   { id /* checkpoint id */, project_id, project_name, scope, last_touched_at: ISO|null,
//     created_at: ISO, stopped_at_text, open_question, next_step }
//
// rows.reminders: active reminders (spike columns + item_id, scope).
//   { id, text, scope, item_id: string|null, next_fire_at: ms|null, state: 'active' }
//
// rows.unacknowledged (optional): deliveries that were sent and never acknowledged,
//   joined to their reminder.
//   { id /* delivery id */, reminder_id, text, scope, scheduled_for: ms, acknowledged_at: null }
//
// ---------------------------------------------------------------------------
// Options: { todayOn: 'YYYY-MM-DD', nowMs, timeZone, lastOpenAt: ISO|null, scope? }
//   scope (optional) is 'work' | 'personal' | 'all'. With 'work' or 'personal',
//   rows of the other scope are dropped here as well (defence in depth). Rows
//   whose scope is not 'work' or 'personal' are always dropped (fail closed).
//
// Output (CONTRACT.md): { fixed, next, today, needsYou, waiting, tasks, resume, returnView }.
//   next.kind is 'waiting' | 'task' | 'project'; today rows carry picked (the stored today_pick);
//   tasks.openCount counts every open task in scope (rows.tasks must hold all of them).
// ---------------------------------------------------------------------------

import { instantToZonedParts } from './time.js';

const DAY_MS = 86_400_000;
const TODAY_CAP = 5;
const RETURN_AFTER_MS = 3 * DAY_MS;
const SCOPES = new Set(['work', 'personal']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' + n days, calendar arithmetic only (no zone involved). */
export function addDaysOn(on, n) {
  const [y, m, d] = on.split('-').map(Number);
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d + n);
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

function isDate(v) {
  return typeof v === 'string' && DATE_RE.test(v);
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function cmpStr(a, b) {
  // null/undefined sort last
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function byKeys(...keys) {
  return (a, b) => {
    for (const k of keys) {
      const c = cmpStr(a[k], b[k]);
      if (c !== 0) return c;
    }
    return 0;
  };
}

function countFor(value, keep) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object') {
    let n = 0;
    for (const s of SCOPES) if (keep(s) && Number.isFinite(value[s])) n += value[s];
    return n;
  }
  return null;
}

function localDateOfIso(iso, timeZone) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return instantToZonedParts(ms, timeZone).date;
}

function waitingWhy(w, todayOn, timeZone) {
  const who = w.who && String(w.who).trim() ? w.who : 'someone';
  const asked = isDate(w.asked_on) ? w.asked_on : 'date not stated';
  const follow = w.follow_up_on === todayOn ? 'Follow-up is today.' : `Follow-up was ${w.follow_up_on}.`;
  let reply = 'No reply recorded.';
  if (w.reply_recorded_at) {
    const on = localDateOfIso(w.reply_recorded_at, timeZone);
    reply = on ? `Reply recorded on ${on}.` : 'Reply recorded.';
  }
  return `You asked ${who} on ${asked}. ${follow} ${reply}`;
}

// 'Thu, Oct 29' for a YYYY-MM-DD date (date-only: formatted in UTC so it never shifts a day).
function plainDate(on) {
  const [y, m, d] = on.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
}

function resumeWhy(c, timeZone) {
  const parts = [];
  if (c.stopped_at_text && String(c.stopped_at_text).trim()) parts.push(`You stopped at: ${c.stopped_at_text}`);
  if (c.next_step && String(c.next_step).trim()) parts.push(`Next step: ${c.next_step}`);
  if (parts.length) return parts.join(' · ');
  const on = c.created_at ? localDateOfIso(c.created_at, timeZone) : null;
  return on ? `Place saved on ${on}.` : 'Place saved; no note recorded.';
}

/**
 * @param {object} rows   see the header comment
 * @param {{ todayOn: string, nowMs: number, timeZone: string, lastOpenAt?: string|null, scope?: string }} opts
 */
export function buildToday(rows, opts) {
  const { todayOn, nowMs, timeZone, lastOpenAt = null, scope = 'all' } = opts || {};
  if (!isDate(todayOn)) throw new TypeError('todayOn must be YYYY-MM-DD');
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be a finite number');
  if (typeof timeZone !== 'string' || !timeZone) throw new TypeError('timeZone is required');
  if (scope !== 'all' && !SCOPES.has(scope)) throw new TypeError('scope must be work, personal or all');
  const r = rows || {};

  const keep = (s) => SCOPES.has(s) && (scope === 'all' || s === scope);
  const inScope = (row) => row && keep(row.scope);

  // ---- tasks and other dated items (never waiting) -------------------------
  const itemsById = new Map();
  for (const row of [...arr(r.tasks), ...arr(r.hardDates)]) {
    if (!inScope(row) || row.kind === 'waiting' || row.id == null) continue;
    if (row.state !== 'open' && row.state !== 'done') continue;
    if (!itemsById.has(row.id)) itemsById.set(row.id, row);
  }
  const items = [...itemsById.values()];
  const tasks = items.filter((t) => t.kind === 'task');
  // A deferred task (start_on after today) stays off Today and out of Next, unless its hard date is
  // today or has passed: a deferral never hides a real deadline. It still counts as open.
  const deferred = (t) => isDate(t.start_on) && t.start_on > todayOn && !(isDate(t.due_on) && t.due_on <= todayOn);
  const allOpenTasks = tasks.filter((t) => t.state === 'open');
  const openTasks = allOpenTasks.filter((t) => !deferred(t));

  const overdue = openTasks.filter((t) => isDate(t.due_on) && t.due_on < todayOn).sort(byKeys('due_on', 'created_at', 'id'));
  const dueToday = openTasks.filter((t) => t.due_on === todayOn).sort(byKeys('created_at', 'id'));
  const picks = openTasks.filter((t) => t.today_pick === 1 || t.today_pick === true).sort(byKeys('created_at', 'id'));

  // ---- waiting --------------------------------------------------------------
  const waitingRows = arr(r.waiting).filter((w) => inScope(w) && w.kind === 'waiting' && w.state === 'open');
  const dueWaiting = waitingRows
    .filter((w) => isDate(w.follow_up_on) && w.follow_up_on <= todayOn)
    .sort(byKeys('follow_up_on', 'asked_on', 'created_at', 'id'));
  const waitingCount = countFor(r.waitingCount, keep);

  // ---- checkpoints / resume -------------------------------------------------
  const checkpoints = arr(r.checkpoints)
    .filter((c) => inScope(c) && c.project_id != null && c.id != null)
    .sort((a, b) => cmpStr(b.last_touched_at ?? b.created_at, a.last_touched_at ?? a.created_at) || cmpStr(a.project_id, b.project_id));
  const resume = checkpoints.map((c) => ({
    projectId: c.project_id,
    name: c.project_name,
    lastTouchedAt: c.last_touched_at ?? null,
    scope: c.scope,
  }));
  // Stale: the project was last touched (or its place saved) before today, local time.
  const stale = checkpoints.filter((c) => {
    const touched = c.last_touched_at ?? c.created_at;
    const on = touched ? localDateOfIso(touched, timeZone) : null;
    return on !== null && on < todayOn;
  });

  // ---- next -----------------------------------------------------------------
  let next = null;
  // kind tells the UI what Next is: a waiting item is someone else's work and gets no "done" checkbox.
  if (dueWaiting.length) {
    const w = dueWaiting[0];
    next = { ref: `item:${w.id}`, kind: 'waiting', title: w.title, why: waitingWhy(w, todayOn, timeZone), scope: w.scope };
  } else if (overdue.length) {
    const t = overdue[0];
    next = { ref: `item:${t.id}`, kind: 'task', title: t.title, why: `It was due ${plainDate(t.due_on)} and is still open.`, scope: t.scope };
  } else if (dueToday.length) {
    const t = dueToday[0];
    next = { ref: `item:${t.id}`, kind: 'task', title: t.title, why: 'It is due today.', scope: t.scope };
  } else if (picks.length) {
    const t = picks[0];
    next = { ref: `item:${t.id}`, kind: 'task', title: t.title, why: 'You picked this for today.', scope: t.scope };
  } else if (stale.length || checkpoints.length) {
    // Nothing due or picked: the most useful move is picking up a saved place (an older one first).
    const c = stale.length ? stale[0] : checkpoints[0];
    next = { ref: `project:${c.project_id}`, kind: 'project', title: c.project_name, why: resumeWhy(c, timeZone), scope: c.scope };
  }

  // ---- today list: hard-dated tasks always kept, picks fill to the cap ------
  const doneTasks = tasks.filter((t) => t.state === 'done');
  const hardDated = [...overdue, ...dueToday, ...doneTasks.filter((t) => t.due_on === todayOn)];
  const hardIds = new Set(hardDated.map((t) => t.id));
  const softPicks = [...picks, ...doneTasks.filter((t) => (t.today_pick === 1 || t.today_pick === true) && !hardIds.has(t.id))]
    .filter((t) => !hardIds.has(t.id));
  const room = Math.max(0, TODAY_CAP - hardDated.length);
  const todayRows = [...hardDated, ...softPicks.slice(0, room)];
  const today = todayRows.map((t) => ({
    ref: `item:${t.id}`,
    title: t.title,
    meta:
      t.due_on === todayOn
        ? 'Due today'
        : isDate(t.due_on) && t.due_on < todayOn
          ? `Overdue · due ${t.due_on}`
          : 'Picked for today',
    done: t.state === 'done',
    picked: t.today_pick === 1 || t.today_pick === true,
    scope: t.scope,
  }));

  // ---- fixed: reminders due today (local) + non-waiting items due today -----
  const fixedTimed = [];
  for (const rem of arr(r.reminders)) {
    if (!inScope(rem) || rem.state !== 'active' || !Number.isFinite(rem.next_fire_at)) continue;
    if (instantToZonedParts(rem.next_fire_at, timeZone).date !== todayOn) continue;
    fixedTimed.push({ label: rem.text, at: new Date(rem.next_fire_at).toISOString(), ref: `reminder:${rem.id}`, scope: rem.scope });
  }
  fixedTimed.sort(byKeys('at', 'ref'));
  const fixedDated = items
    .filter((i) => i.state === 'open' && i.due_on === todayOn)
    .sort(byKeys('created_at', 'id'))
    .map((i) => ({ label: i.title, on: i.due_on, ref: `item:${i.id}`, scope: i.scope }));
  const fixed = [...fixedTimed, ...fixedDated];

  // ---- counts ---------------------------------------------------------------
  const inboxCount = countFor(r.inboxCount, keep) ?? 0;
  const waiting = { count: waitingCount ?? waitingRows.length, dueCount: dueWaiting.length };

  // ---- return view ----------------------------------------------------------
  let returnView = null;
  if (lastOpenAt != null) {
    const lastMs = Date.parse(lastOpenAt);
    if (!Number.isFinite(lastMs)) throw new TypeError('lastOpenAt must be an ISO instant or null');
    if (nowMs - lastMs > RETURN_AFTER_MS) {
      const horizon = addDaysOn(todayOn, 7);
      const hardDates7d = items
        .filter((i) => i.state === 'open' && isDate(i.due_on) && i.due_on <= horizon)
        .sort(byKeys('due_on', 'created_at', 'id'))
        .map((i) => ({ ref: `item:${i.id}`, title: i.title, on: i.due_on, overdue: i.due_on < todayOn, scope: i.scope }));
      const passedFollowUps = dueWaiting.map((w) => ({
        ref: `item:${w.id}`,
        title: w.title,
        who: w.who ?? null,
        followUpOn: w.follow_up_on,
        scope: w.scope,
      }));
      const unacknowledgedReminders = arr(r.unacknowledged)
        .filter((d) => inScope(d) && d.acknowledged_at == null && Number.isFinite(d.scheduled_for) && d.scheduled_for <= nowMs)
        .map((d) => ({ ref: `reminder:${d.reminder_id}`, label: d.text, at: new Date(d.scheduled_for).toISOString(), scope: d.scope }))
        .sort(byKeys('at', 'ref'));
      returnView = {
        daysAway: Math.floor((nowMs - lastMs) / DAY_MS),
        hardDates7d,
        passedFollowUps,
        unacknowledgedReminders,
        inboxCount,
        oneNext: next ? { ...next } : null,
      };
    }
  }

  return {
    fixed,
    next,
    today,
    needsYou: { inboxCount },
    waiting,
    // Every open task, dated or not, picked or not, so Today can link to the full list.
    tasks: { openCount: allOpenTasks.length, deferredCount: allOpenTasks.length - openTasks.length },
    resume,
    returnView,
  };
}
