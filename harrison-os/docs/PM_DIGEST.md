# PM digest (Slice 3.1)

Manual and cron refreshes share a 15-second durable lease (`0010_pm_refresh_fence.sql`). A random
attempt token fences every copy replacement and failure update in the same D1 transaction. An active
attempt returns `in_progress` to another caller; an expired lease can be reclaimed, including by cron
before its normal hourly interval. A late reply/failure from the previous owner returns `superseded`
and cannot overwrite the current copy, freshness or lease. Normal completion releases the lease;
database exceptions preserve the last good copy and release only that attempt's token. Missing
configuration returns `not_connected` without creating a source. This changes no PM source permissions.

Canonical project/item IDs are retained in an ID-only `(source, kind, provider ID)` map
(`0012_pm_provider_ids.sql`). Its backfill preserves every existing `pmr` ID. A row absent from a later
snapshot can return or be restored from a source export without breaking citations. The map contains
no source words, is scope-bound, and is purged atomically when its source is deliberately removed.
Adding a deliberately removed source again creates new local identities; removal revokes that copy.

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
Without configuration the source shows "Not connected: needs the approved private PM connection or an authorized digest link". Configured but never
fetched shows "Set up, not checked yet". A failed fetch keeps the previous copy and shows "Last check failed"
with a plain reason. The cron refreshes it at most once every 60 minutes (`onScheduled`); "Refresh now"
fetches immediately. "Clear stored copy" removes the stored data; it returns at the next refresh while the
link stays configured.

## Private connection (optional; waiting for approval)

A Workers service binding instead of a public link: no public endpoint and no bearer secret. The PM side is a
separate private Worker, `harrison-os-pm-digest` (HTTP answers 404, no workers.dev route), whose named
entrypoint `HarrisonOsDigest` has an argumentless `getDigest()` returning the same `harrison-os.pm-digest`
version 1 object as above (a constant SELECT-only projection over an approved project allowlist; financial,
internal and private record bodies are excluded on the PM side). That Worker is not built or deployed from this
repository, and the existing PM Worker is not changed.

Harrison OS side, only after Harrison approves the binding and root has verified the digest Worker: add to the
private `wrangler.local.jsonc` (never to `wrangler.jsonc`):

```jsonc
"services": [
  { "binding": "PM_DIGEST_SERVICE", "service": "harrison-os-pm-digest", "entrypoint": "HarrisonOsDigest" }
]
```

The deploy guard accepts exactly this one entry and refuses any other service (including the PM Worker itself),
a default entrypoint, extra keys, and every other cross-resource binding kind (`tests/deploy-guard.test.mjs`).

Behaviour (`src/pm.js`, `tests/pm.test.mjs`): when the binding is present it is used instead of the link (the
event `pm_refresh` records `via: 'rpc'`). The returned object goes through the same path as the link: turned
into JSON text with the 1 MB cap, parsed and checked by `normalizeDigest`, 10 s timeout, Work scope only, at
most one refresh an hour from the cron, "Refresh now" on demand. Set up but never read shows "Set up, not
checked yet"; it shows a fetch time only after a real successful read. A thrown error (`rpc_error`), a timeout,
an oversize or malformed result keeps the previous copy and shows "Last check failed". The source is labelled
"Company PM digest (private connection)".

## API

| Route | Body / query | Result |
|---|---|---|
| `POST /api/pm/import` | `{ scope, label, format: json\|csv, content, source_id?, system? }` | 201 new / 200 update: `{ source, changes, dropped_urls }`; `source_id` of the sample answers 409 `sample_source` |
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

No real PM source is authorized today. The private connection is implemented and tested here against a stand-in
binding only; it is unverified against the real digest Worker until that Worker exists, the binding is approved
and root adds it. The import path and the sample are what work end to end.
