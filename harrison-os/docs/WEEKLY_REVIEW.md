# Weekly review (Slice 3.3)

A short pass over the last 7 days and the next 14, built from the shared records. It never creates
tasks, never moves a hard date (`due_on`), never turns an idea into a commitment and uses no blame
words. It changes nothing unless the owner taps a button.

Code: `src/review.js` (routes, `buildWeeklyReview`, `reviewStatus`, `purgeRef`, `weekOf`),
`migrations/0007_review.sql`, `public/views/weekly.js|css`, tests in `tests/review.test.mjs`.

## What it shows

Every row has `ref` (`item:<id>`, `project:<id>`, `reminder:<id>`, `event:<id>` or `pm:<id>`), `date`,
`scope` and `sample`. Rows the owner picked this week carry `selected: true`.

| Section | Source rule |
|---|---|
| `completed` | items with `state = 'done'` and `done_at` in the last 7 days; projects `done` and updated in the last 7 days |
| `changes.decisions` | decisions recorded in the last 7 days (with `supersedes` / `superseded_by` refs) |
| `changes.replies` | Waiting items whose reply was recorded in the last 7 days |
| `changes.captures` | `{ sorted, pending }`: captures received in the last 7 days that are no longer pending, and all still pending |
| `hard` | open non-Waiting, non-idea items with `due_on` up to today + 14 (earlier ones flagged `past`); active reminders firing within 14 days; calendar events (`calendar.listEvents`) and PM entries with a `due_on` (`pm.listDigest`) when those modules provide them. Never hidden by a deferral. |
| `follow_ups` | open Waiting items with `follow_up_on` up to the Sunday that ends next week |
| `decisions` | open, not superseded decisions with `claim_status = 'proposed'` or a `reconsider_when` |
| `resume` | active projects with their latest checkpoint |
| `quiet` | active projects with no recorded activity (project touch/update or any of its items' updates) for 14+ days, phrased as "No activity recorded since ..." |
| `ideas` | open ideas, newest 50, listed as "Ideas (not commitments)"; `idea_count` is the total |

`sources: { calendar, pm }` is `included`, `not_available` (module has no contract function yet) or
`error` (the connector threw; the rest of the review still loads). In a Work review an event from
another scope always comes back as a busy interval with `title: null`, whatever the calendar module
returned.

Lists are capped at 50 rows each. The review itself is read-only (`buildWeeklyReview` writes nothing).

## Routes

All need the normal owner session; POSTs need `X-Requested-With`. `tz` / `time_zone` is an IANA zone;
when omitted the device zone last reported to `/api/today` is used, otherwise 400 `time_zone_required`.
The week is the local Monday-to-Sunday week (`week_of` = its Monday).

- `GET /api/review/weekly?scope=work|personal|all&tz=` 200: `{ scope, timeZone, generated_at, todayOn,
  week_of, next_monday, follow_up_by, hard_until, since, records: { <scope>: { opened_at, completed_at,
  selections, deferrals } }, sources, idea_count, sections, status }`. Records `opened_at` for the week.
- `GET /api/review/weekly/status?scope=` 200: `{ due, last_completed_at }`. `due` is true when a scope
  has never finished a review or its last one is more than 6 days old (with `all`: either scope).
- `POST /api/review/weekly/select { scope, refs: ['item:<id>'|'project:<id>', ... up to 50], today?, time_zone? }`
  200: `{ week_of, selections, picked_for_today, changeIds, changeId }`. Adds the refs to this week's
  picks. With `today: true`, open tasks among them also get `today_pick` through `db.updateItem`
  (undoable via `changeId`); other kinds are never changed. Errors: 400 `scope_all_not_allowed`,
  `invalid_refs`, `invalid_ref`; 404 when any ref is not in that scope.
- `POST /api/review/weekly/defer { scope, ref, follow_up_on | start_on, time_zone? }` 200:
  `{ week_of, ref, until, applied, changeId }`. "Not this week":
  - Waiting item: needs `follow_up_on`; moves only the follow-up date (`db.snoozeFollowUp`), `applied: 'follow_up_on'`.
  - Task: needs `start_on`; writes only `start_on` through `db.updateItem` (`applied: 'start_on'`).
    If the core does not support `start_on`, nothing on the item changes and `applied: 'review_only'`.
  - Decisions and projects: recorded in the review only (`applied: 'review_only'`).
  `due_on` is never written. The deferral hides the row from the flexible sections for this week while
  the written date is still the live value (an Undo brings the row back); hard-date rows always stay,
  marked `deferred_until`. Deferring removes the ref from this week's picks. Errors: 400
  `invalid_date`, `follow_up_on_required`, `start_on_required`, `invalid_ref`; 404 out of scope; 409
  `not_open`.
- `POST /api/review/weekly/complete { scope, time_zone? }` 200: `{ week_of, completed_at, status }`.
  The view calls it once per scope when the switch shows All.

## Screen

`#/weekly` ("Weekly review"): fixed dates, follow-ups, done, what changed, open decisions, where to
pick up, quiet projects (only when there are any), ideas. Row actions: "Pick for this week", "Not this
week" (moves to next Monday; only on follow-ups, open decisions, quiet projects and hard-dated tasks
due next week or later) and "Open". "Mark review done" at the end. Today shows a "Weekly review" link
only while `status.due` is true.

## Deletion

`purgeRef(db, ref)` (also accepts `(db, scope, ref)`) returns one statement that removes the ref from
every stored `selections` and `deferrals`. Stored rows hold refs, dates and times only, never text.
