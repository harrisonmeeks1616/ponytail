# PM digest (Slice 3.1)

A read-only, source-linked, freshness-aware summary of company project status. The company system stays the
official record: Harrison OS never writes to it, never reads its files, and links every project and item back
to it ("Open in <system>"). Code: `src/pm.js`, `migrations/0006_pm.sql`, `public/views/pm.js`. Tests:
`tests/pm.test.mjs` (fixtures in `tests/fixtures/pm/`, synthetic only).

## Where it shows

- **Today** (Work or All): a "Company projects" card with overdue and due-in-7-days counts, linking to `#/pm`.
  Hidden until a source has data.
- **`#/pm`**: per project status, next milestone, overdue items, items due in the next 7 days, items with no
  due date, missing-context indicators (no link, no due date, no owner), "Open in <system>" links, and per
  source freshness and what changed at the last import.
- **Memory**: "Company project sources" card: import a file, import an update into an existing source,
  load the labelled sample, refresh the digest link, remove a source, see status and freshness.

## Import contract, version 1

JSON (`format: "json"`):

```json
{
  "format": "harrison-os.pm-digest",
  "version": 1,
  "source": { "system": "Example PM", "exported_at": "2026-10-29T11:00:00Z", "base_url": "https://pm.example.com/" },
  "projects": [
    {
      "id": "P-100", "name": "Clinic fit-out", "status": "In progress",
      "url": "https://pm.example.com/projects/P-100", "updated_at": "2026-10-28T20:00:00Z",
      "next_milestone": { "title": "Rough-in inspection", "due_on": "2026-11-03" },
      "open_items": [
        { "id": "I-1", "title": "Send device schedule", "status": "Open", "due_on": "2026-10-27",
          "owner_label": "Owner A", "url": "https://pm.example.com/items/I-1", "updated_at": "2026-10-28T20:00:00Z" }
      ]
    }
  ]
}
```

CSV (`format: "csv"`): header `project_id,project_name,item_id,title,status,due_on,owner_label,url,updated_at`
(any column order, RFC 4180 quoting). A row with an empty `item_id` lists a project with no items. CSV states
no export time, so freshness falls back to the import time and the source says "Export time not stated".
An optional `system` in the request names the system for "Open in ...".

Validation (strict; a failed import changes nothing):

- `format` and `version` must match. `source.system` and `source.exported_at` are required for JSON;
  `exported_at` more than an hour in the future is refused (it would look fresh forever).
- Ids are required, at most 120 characters, unique per import. Names and titles are required.
- Dates are `YYYY-MM-DD` and must exist; timestamps are ISO 8601 with a zone. Empty optional fields are null.
- Links must be `https:` without credentials; anything else is dropped (counted in `dropped_urls`), not stored.
- Caps: 200 projects, 300 open items per project, 1500 records per import; request bodies are capped at 64 KB
  by the API (about 60 KB of file), the digest link at 1 MB.
- Text is untrusted: control, zero-width and bidi-override characters are removed, whitespace collapsed,
  long text cut. Unknown keys (for example `scope` or `sample` inside the file) are ignored. Scope and the
  sample flag come only from the request.
- Items whose status is done/closed/complete(d)/resolved/cancel(l)ed/archived are not counted as open.

Re-import (`source_id` in the request) replaces the source's records in one batch, keeps each record's id
per provider id (so `pm:<id>` refs stay valid), and reports what changed since the previous import: new
items and projects, items closed or gone from the export, and moved item or milestone due dates.

"May be out of date" shows when the export (or, without an export time, the import) is over 48 hours old.

## Digest link (http adapter)

Configuration (both needed; blank by default, set by Harrison):

| Name | Kind | Example |
|---|---|---|
| `PM_DIGEST_URL` | Worker var | `https://...` (https only) |
| `PM_DIGEST_TOKEN` | Worker secret (`wrangler secret put PM_DIGEST_TOKEN`) | |

The link must serve the JSON contract above. It is fetched with `Authorization: Bearer <token>`, no redirects
followed (the token never goes to another host), a 10 s timeout and a 1 MB cap. The data is Work scope.
Without configuration the source shows "Not connected: needs an authorized digest link". Configured but never
fetched shows "Set up, not checked yet". A failed fetch keeps the previous copy and shows "Last check failed"
with a plain reason. The cron refreshes it at most once every 60 minutes (`onScheduled`); "Refresh now"
fetches immediately. "Clear stored copy" removes the stored data; it returns at the next refresh while the
link stays configured.

## API

| Route | Body / query | Result |
|---|---|---|
| `POST /api/pm/import` | `{ scope, label, format: json\|csv, content, source_id?, system? }` | 201 new / 200 update: `{ source, changes, dropped_urls }` |
| `POST /api/pm/sample` | `{ scope }` | Synthetic sample, labelled Sample (idempotent per scope) |
| `GET /api/pm/sources` | `?scope=work\|personal\|all` | `{ sources }` with state, freshness, counts, last changes |
| `POST /api/pm/sources/:id/refresh` | `{ scope }` | Digest link only (`pm-http`); imports answer 409 `import_source` |
| `DELETE /api/pm/sources/:id` | `?scope=` | Removes the source and its records |
| `GET /api/pm/digest` | `?scope=&tz=` (tz defaults to America/New_York) | `{ sources, projects, totals, today, due_soon_until }` |

Module exports for other tracks: `listDigest(db, scope, { nowMs, timeZone, env? })`, `listSources`,
`onScheduled(env, nowMs)`, `purgeRef()` (no derived rows cite captures or items, so it returns `[]`).
Every source, project and item entry carries `source_ref: 'pm:<id>'`, `url`, `fetched_at` and `exported_at`.

Events (`pm_import`, `pm_sample_loaded`, `pm_refresh`, `pm_source_deleted`) carry ids, scope, counts, states
and error codes only: never titles, names, links or the token.

## Not live yet

No real PM source is authorized today, so the digest link is unverified against a real system. The import
path and the sample are what work end to end.
