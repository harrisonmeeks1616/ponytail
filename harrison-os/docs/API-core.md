# Core API (Slice 1 completion, track T1a)

Every route is under `/api`, JSON in and out unless noted, `Cache-Control: no-store`. Errors are
`{ "error": { "code", "message", "field"? } }`. Every change (non-GET) needs `X-Requested-With: XMLHttpRequest`.
Writes name one scope (`work` | `personal`); `all` is accepted only where noted. This page lists what is
new or changed in migration `0002_core_completion.sql`; existing routes behave as before.

Common status codes: `400 invalid` (with `field`), `400 scope_required` / `scope_all_not_allowed` /
`scope_not_allowed`, `404 not_found` (also for a row in the other scope), `409` conflict (`id_conflict`,
`concurrent_change`, `state_moved_on`), `410 gone` (a deliberately deleted id), `413 too_large`.

## Items: new fields

Every item row (lists, Today rows, project detail, review results, create/patch/action responses) carries:

| Field | Meaning |
|---|---|
| `recurrence` | `none` (default) \| `daily` \| `weekdays` \| `weekly` \| `monthly`. Only a `task` with a `due_on` may repeat (else 400, field `recurrence`). |
| `series_id` | Id of the first item of a repeating series (set on first completion). |
| `start_on` | Date-only "not before". Never changes `due_on`. `null` clears. |
| `when_text` | The original date phrase from the capture ("by Tuesday"), set at review acceptance (or on create). Never erased by date edits; `PATCH when_text` is 400. |
| `options_json` | Decision only: **JSON text** of an array of up to 10 strings, each 1-200 characters. Send `options` as an array (or JSON text); read `JSON.parse(item.options_json)`. |
| `recommendation`, `assumptions`, `outcome` | Decision only, text up to 20,000. |
| `reconsider_when` | Decision only, text up to 500. |
| `decided_on` | Decision only, `YYYY-MM-DD`. |

Decision fields on any other kind give 400 (field `kind`). All decision fields are searchable.

Responses that return items (`GET /api/items`, `GET /api/items/:id`, `PATCH`, item actions, review) add
`attachments: [{ id, name, mime, size }]`: the item's own files, then the files of the capture it came from
(same scope only).

## Items: new and changed routes

### `GET /api/items/:id?scope=` (new)
`200 { item }` with attachments. 404 when missing or in the other scope.

### `POST /api/items/:id/complete { scope, today_on? }` (changed)
`200 { item, next, changeId }`. For a repeating task, `item` is done and `next` is the new open instance
with `due_on` = the first occurrence strictly after max(old due_on, local today), so a late completion never
leaves missed occurrences. `weekly` keeps the weekday; `monthly` keeps the series' day of month, clamped to
the month's end (31st -> Feb 28 -> Mar 31). `next` is `null` for a non-repeating item, an item already done,
or when the series already has an open item (at most one open per series). Local today is `today_on`
(`YYYY-MM-DD`) when it is within one day of the server's UTC date, else the last known time zone's date, else
the UTC date. A `start_on` moves with the new instance (same offset before its due date).

**Undo** of that change (`POST /api/undo/:changeId`) reopens the item and deletes the new instance if it is
untouched (no edits, files or reminders on it). A touched instance is kept.

### `POST /api/items/:id/defer { scope, start_on }` (new)
`start_on` is `YYYY-MM-DD` or `null` (clears). `200 { item, changeId }` (undoable). `400 invalid_start_on`.
`PATCH /api/items/:id { scope, start_on }` does the same.

Today (`GET /api/today`) leaves a task out of `today` and `next` while `start_on` is after today, **unless**
its `due_on` is today or past (hard dates stay visible). `tasks` is now `{ openCount, deferredCount }`;
`openCount` still counts every open task, deferred ones included.

### `DELETE /api/items/:id?scope=` (new)
Hard delete: the item, its search row, its attachments; its reminders are cancelled and their text blanked;
its undo history becomes `{"deleted":true}`; supersede pointers and checkpoint links to it are cleared; an
id-only tombstone is kept; derived data is purged (`db.DERIVED_PURGERS`). Downloaded exports are not changed.
`200 { deleted: 1, attachments: n, reminders: n }`; a repeat (or the wrong scope) is `200 { deleted: 0, ... }`.
A later `POST /api/items` (or decision) with that id is `410 gone`; restore skips it (`skipped_deleted`).

### `POST /api/items` (changed)
Accepts the new fields (`recurrence`, `start_on`, `when_text`, decision details). A tombstoned id is `410 gone`.

## Captures

- `POST /api/captures` accepts `source: 'app' | 'share'` (default `app`; anything else `400 invalid_source`).
  The response's `capture` carries `attachments`. `mcp` captures are written by the MCP module through
  `db.saveCapture({ source: 'mcp' })`; the Shortcut route stores `shortcut`.
- **Late retries (changed):** a `POST /api/captures` or `POST /api/shortcut/capture` whose id was deleted
  is `410 { error: { code: 'capture_deleted' } }` (was 200). Nothing is stored. The outbox must treat 410 as
  terminal ("Deleted, not resent") and never retry it.
- `GET /api/inbox` captures and `POST /api/captures/:id/review` (`capture` and `items`) carry `attachments`.
- `DELETE /api/captures/:id` also deletes the capture's attachments and purges derived data; the response's
  `deleted` gains `attachments: n`.

## Attachments (new)

### `POST /api/attachments`
Body (up to 1.5 M characters): `{ id, scope, capture_id | item_id, name, mime, data_b64 }`.
- `id`: `^[A-Za-z0-9_-]{8,80}$` (client-made, so retries are idempotent).
- exactly one of `capture_id` / `item_id` (else `400 invalid_parent`); the parent must exist in the same
  scope (`404`), and a deleted parent is `410 gone` (drop the pending upload).
- `mime`: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `application/pdf`, `text/plain`
  (else `415 unsupported_type`).
- `data_b64`: standard base64, decoded size 1 to 1,000,000 bytes (`400 invalid_data`, `413 too_large`).
- `name`: 1-200 characters; control characters and slashes become `_`.

`201 { attachment: { id, name, mime, size }, duplicate: false }`; the same id with the same bytes is
`200 { ..., duplicate: true }`; the same id with other bytes or parent is `409 id_conflict`.
The parent's search row includes file names, so search finds the capture or item by file name.

### `GET /api/attachments/:id?scope=`
The bytes with the stored `Content-Type`, `Content-Security-Policy: default-src 'none'; sandbox`,
`X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and
`Content-Disposition: inline` for images, `attachment` otherwise (with `filename` and `filename*`).
404 when missing or in the other scope. (The app's CSP already allows `img-src 'self'`.)

## Preferences (new, editable memory)

Key `^[a-z0-9_.-]{1,60}$` (part of the route: another key is 404). Only explicit writes create preferences:
reviewing or correcting a capture never does.

- `GET /api/preferences?scope=work|personal|all` -> `200 { scope, preferences: [{ key, scope, value, note, created_at, updated_at, sample }] }`.
- `PUT /api/preferences/:key { scope, value (1-500), note? (<=500) }` -> `200 { preference, changeId }`
  (`changeId` null when nothing changed). Undoable.
- `DELETE /api/preferences/:key?scope=` -> `200 { deleted: 1, changeId }` or `{ deleted: 0, changeId: null }`. Undoable.

## Export and restore

`GET /api/export` is now `version: 2` and adds `tables.attachments` (metadata plus `data_b64`) and
`tables.preferences`; items carry the new columns.

### `POST /api/restore { scope: 'work' | 'personal' | 'all', data }` (new)
`data` is an export document (`format: 'harrison-os-export'`, version 1 or 2); body up to 8 M characters.
- Inserts only rows whose ids are absent; never overwrites (`skipped_existing`).
- Never re-inserts a deleted capture or item, nor its proposals, attachments, reminders, deliveries or undo
  history (`skipped_deleted`); items and undo history citing a deleted capture are scrubbed as delete does.
- Rejects rows outside the requested scope, rows linked across scopes, and rows the schema refuses
  (`rejected`). `meta` is restored only with scope `all`.
- Keeps relationships (proposals, items -> projects, checkpoints, reminders -> items, deliveries, supersede
  links, attachments with bytes) and rebuilds search rows for inserted rows.
- Active reminders are rescheduled from now: a daily one gets its next occurrence after now; a one-off whose
  time has passed is cancelled, never fired late (`reminders_not_rescheduled`).

`200 { inserted: { table: n }, skipped_existing, skipped_deleted, rejected, reminders_not_rescheduled }`.
`400 invalid` (field `data`) for a document that is not an export. Export -> fresh database -> restore ->
export is equal apart from `exported_at` (tests/core-restore.test.mjs).

## Interpretation (A4)

- A correction right after a task ("Order 12 sheets of drywall for Friday. Actually make that 14, and
  Thursday not Friday.") gives one task proposal with the corrected quantity and day in its title and
  `fields.when`, `fields.replaced` (old title and when) and `fields.correctionQuote`; `sourceQuote` and the
  capture keep the original words. An unreadable or ambiguous correction is not applied.
- A sentence starting with an action verb (order, call, email, send, buy, book, schedule, pay, fix, ...) is a task.
- A possibility of his own ("Maybe we should ...", "I might ...") is an `idea` with claim status `proposed`.
- "Mike said he'd send the RFI answer by Tuesday" is Waiting: who Mike, claim `confirmed`, `promisedOn`.

## For other modules

- `db.DERIVED_PURGERS`: push `(db, ref) => statements[]` (or a Promise of them); `ref` is `capture:<id>` or
  `item:<id>`. Their statements run in the same batch as the delete.
- `db.saveCapture(db, { source: 'mcp' | 'share' | 'app' | 'shortcut', ... }, nowIso)`.
- `db.withItemAttachments(db, items)` / `db.withCaptureAttachments(db, captures)` add `attachments`.
- `db.nextOccurrenceOn(recurrence, dueOn, todayOn, anchorDay?)` is pure.
- D1 note: a statement's `meta.changes` is not reliable after an FTS5 write in the same batch; read back
  or count first.
