# Cross-app actions: Harrison OS AI -> Electrical PM (and Field Hub through PM)

Status: **version 1, confirmed by root** (with the native details folded in below). The PM side (`PM_COMMANDS_SERVICE`) is root's: its native RPC passed an in-process workerd proof; it is not deployed or granted. The Harrison OS side is `src/crossapp.js`, the `pm_*` and `field_*` tools in `src/mcp.js` and `tests/crossapp.test.mjs` (against an in-memory stand-in). Nothing is enabled: no binding, no grant, no consent.

## 1. Transport

`await env.PM_COMMANDS_SERVICE.execute(request)` over a private Workers service binding. No public route, no token in Harrison OS, no Field Hub credential in Harrison OS (the Field Hub bridge credential stays in PM's secrets).

Binding (private config only, never the repository config), written exactly so: `{ "binding": "PM_COMMANDS_SERVICE", "service": "harrison-electrical-pm", "entrypoint": "HarrisonOsCommands" }`. `scripts/deploy-guard.mjs` accepts exactly this entry and the digest one, each at most once, and nothing else (never PM's default HTTP entrypoint).

## 2. Request (exactly what Harrison OS sends)

```
{ action, projectId, recordId?, operationId?, requestId?, body?, query? }
```

- `action`: one of `metadata.read`, `project.read`, `records.list`, `record.read`, `record.create`, `record.update`, `record.archive`, `record.restore`, `field.status`, `field.read`, `field.pending`, `field.edit`, `field.retry`.
- `requestId` on every write: the caller's id when it is retrying (`[A-Za-z0-9_-]{8,40}`), else `hos_` + 32 hex characters (36 in all), made from the client, action, target and exact body per UTC minute, so a lost-answer retry is the same id.
- Never sent: an actor, a user, a project allowlist or any credential. PM's server config decides those.

## 3. Response envelope (what Harrison OS accepts)

```
success: { ok: true, data: <per action, below>, receipt?: Receipt }
failure: { ok: false, error: { code: string, message: string, status?: number, current?: object } }
Receipt: { status: 'saved' | 'pending', requestId: string, revision?: number, recordId?: string,
           operationId?: string, rev?: number, replayed?: boolean }
```

- `saved`: PM (or Field Hub, confirmed) committed it. `pending`: queued or sent, not confirmed. Harrison OS never calls `pending` saved.
- A conflict is a failure with `code: 'conflict'` and `current` holding at least the current `revision` (records) or `rev` (Field Hub). Harrison OS shows `current` to the model so it can re-read and decide.
- `replayed: true` when the `requestId` was already done: the stored result is returned, nothing applied twice.
- Any other shape (no boolean `ok`) is reported as "unexpected answer, not done". A throw or no answer within 15 s is "unavailable" and, for a write, "outcome unknown: read again or retry with the same requestId".

## 4. `metadata.read`: exact response

Request: `{ action: 'metadata.read', projectId, query?: { types: 'id1,id2' } }`. With `types`, PM returns the exact schema of just those types (`metadataVersion` stays the full registry's). The full registry (33 types) is too large for one answer to the model, so:

- `pm_get_metadata` without `types` gives the model a compact catalog (each type's id, label, statuses, default status, core, visibility, field count; the value forms; the Field Hub kinds) with the instruction to ask for one type; with `types` (up to 5) it gives those types complete.
- `pm_create_record` asks PM for its own type only; `pm_update_record`, archive and restore read the record first, then ask for that record's type only.
- `pm_list_records` (it needs every type's visibility) and `field_edit_record` (it needs the Field Hub kinds) read the full registry inside Harrison OS; it is not passed to the model.

```
data: {
  metadataVersion: string,                 // changes whenever the compiled registry changes (a hash is fine)
  valueForms: { <kind>: 'string' | 'text' | 'number' | 'integer' | 'boolean' | 'date' | 'datetime'
                        | 'option' | 'options' | 'object' | 'array' },
                                           // every field kind the registry uses, mapped to the JSON value it takes
                                           // on the wire. Harrison OS refuses a field whose kind is not listed here.
  recordTypes: [ {
    id: string,                            // the registry type id, sent as body.type on create
    label: string,
    statuses: [string],
    defaultStatus: string | null,
    core: <as the registry has it>,        // passed through to the model unchanged; Harrison OS does not rely on it
    topLevel: [ WireField ],               // camelCase top-level keys record.create / record.update accept for this
                                           // type, other than type, status, expectedRevision and the three sections
    sections: { data?: [ WireField ], financial?: [ WireField ], internalData?: [ WireField ] }
                                           // exactly the registry fields, grouped where they live on the wire
  } ],
  field: { kinds: [ { kind: 'tasks' | 'reports' | 'shifts', changeKeys?: [string] } ] } | null
                                           // null when the project has no Field Hub job. changeKeys: the change keys the
                                           // adapter accepts for that kind, if it has such a list (else omit it)
}
WireField: { key: string, label?: string, kind: string, required: boolean, secure: boolean, options?: [string] }
                                           // key: the exact wire key; options: allowed values for option kinds
```

Native facts (root): the compiled registry has 20 types; financial types carry `recordVisibility: 'financial'`; financial and internal fields carry `secure: true`; top-level camelCase keys include `title`, `body`, `priority` (`low`/`normal`/`high`/`urgent`), `assigneeLabel`, `assigneeContactId`, `dueDate`, `followUpDate`, `eventDate`, `locationId`, `systemId`, `phaseId`, `costCodeId` and the secure `internalNotes`; `status` is separate; Field Hub change keys are tasks: `id scope floor area crew crewId date reply followUp review items send`, reports: `pmReview`, shifts: `who in out`.

How Harrison OS uses it: the model is told to read it before any change; `pm_create_record` and `pm_update_record` read it again themselves in the same call and refuse, before PM is asked, any key not declared for the type and section, a missing `required` key on create, a value not of the declared value form, a status not in `statuses`, and (unless sensitive data is allowed) a financial type or a `secure` field. Field names are never guessed. PM validates everything again.

## 5. Per-action data

| action | request extras | data on success |
|---|---|---|
| `project.read` | | PM's project answer (settings: site, phase progress, notes, weekly report, upload limit; contacts; lookups). Unless sensitive data is allowed, every `contacts` entry loses `email`, `phone` and `notes`, and `site` loses `address`, at any depth |
| `records.list` | `query: { types? (CSV), status?, q?, archived? (1 or 0), limit (1..50), offset? }` (native keys) | `{ records: [Record], total, limit, offset }` |
| `record.read` | `recordId` | `{ record: Record }` |
| `record.create` | `requestId`, `body: { type, status?, <topLevel keys>, data?, financial?, internalData? }` | `{ record: Record }`, receipt `saved` |
| `record.update` | `recordId`, `requestId`, `body: { expectedRevision, status?, <topLevel keys>, data?, financial?, internalData? }` | `{ record: Record }`, receipt `saved`; `conflict` with `current.revision` |
| `record.archive`, `record.restore` | `recordId`, `requestId`, `body: { expectedRevision }` | `{ record: Record }`, receipt `saved` |
| `field.status` | | passed through |
| `field.read` | `query: { kind, key }` (key: task uid, shift id, report date) | `{ kind, key, rev, record, base }`; `base` is the native snapshot (`record`); a task not created yet is `record: null, base: null, rev: 0` |
| `field.pending` | `query: { cursor? }` | `{ operations: [ { operationId, status: 'pending', ... } ], nextCursor? }` |
| `field.edit` | `requestId`, `body: { kind, key, expectedRev, base, changes, reason }` | receipt `saved` or `pending` with `operationId`; `conflict` with `current.rev` |
| `field.retry` | `operationId`, `requestId` | receipt `saved` or `pending`; `conflict` as above |

`Record`: `{ id, type, revision: number, status, archived: boolean, <topLevel keys>, data?, financial?, internalData? }`.

- **Updates send whole sections.** PM's edit API replaces a section it is given, so `pm_update_record` reads the complete current record in the same call (PM's owner read includes financial, internal and secure values), checks `revision` against the model's `expected_revision` (unless it is a `requestId` retry, which PM replays), merges the model's changes into each touched section and sends the full section. Sections not touched are not sent and stay as they are. A secure value the model never saw is therefore kept, not wiped.
- **Field Hub edits.** `field_edit_record` reads `field.read` in the same call, checks `rev`, and sends `base` back exactly as `field.read` returned it, with the model's `changes` and a required `reason` (1 to 1000 characters). The adapter owns the Field Hub `opId`. It takes no `request_id`: PM hashes the base too, so an edit resent after a lost answer (with a newer base) is not a replay. The supported recovery is `field_list_pending` then `field_retry_operation` with the pending `operationId`; an identical edit inside the same minute with nothing changed gets the same derived request id and is replayed, and one sent after Field Hub saved the first is refused by the rev check ("if that was this change, it is already made").
- **Record retries.** `pm_update_record` with the first attempt's `request_id` and `expected_revision` skips Harrison OS's revision check (its own change moved it on) and rebuilds the same merged body, which PM replays. If someone changed that section in between, the body differs and PM refuses it as a changed request; nothing is applied twice.
- **Outcomes.** A write whose answer was lost (timeout, throw, unknown shape) is reported as "Outcome unknown", never "Not done", and Ask lists it as "Not confirmed". A change PM saved whose answer is too large to show is still reported as done, without the record. A text value made from a copy shortened to fit an earlier answer (ending "…") is refused, because it would replace the full text (for `pm_update_record` against PM's current value; under Ask for every write tool).
- **Sensitive data (`includeSensitive`, owner-only, default off).** Off: financial record types (`recordVisibility: 'financial'`) and every `secure` field are removed from metadata, lists, reads, write answers and a conflict's `current` before the model sees them, and writes to them are refused. On: the same validated native operations may read and change them. Re-read on every call with the rest of the grant.
- **Conflicts.** PM maps its native `data.error.details.current` (the full current DTO) to `error.current` plus `status`; Harrison OS shows it to the model redacted as above.

## 6. Harrison OS side (rules it keeps)

- **Owner grant, separate from everything else** (Memory > Connections > "AI actions in Electrical PM and Field Hub", owner-only `PUT /api/connections/crossapp/grant` with `{ clients, projects, actions, includeSensitive }`): which AI clients (Ask, MCP clients), which projects, which actions, and whether sensitive data is included. Projects are ticked by name from the approved PM digest copy (the provider ids stay internal; nobody types ids). Default: nothing. Read fresh on every call; no tool, record or web page can reach it.
- On top of it: Electrical PM and Field Hub count as Work, so the client's own grant must include Work; writes need Full (Ask: "What Ask may do" Full for Work plus Work consent; MCP: the MCP grant Full for Work).
- The copied company-project table (`pm_records`) is never written by these tools. After a `saved` write, Harrison OS asks for one copy refresh through the existing fenced path, `pm.refreshHttpSource(env, Date.now(), { timeoutMs: 5000 })` (the lease is taken at the real time of the refresh), and reports its outcome (`ok`, `in_progress`, `not_connected`, ...). An MCP call refreshes right away and reports it as `copy_refresh`. Ask refreshes once, after its whole tool loop (whether the answer was written or the AI failed after a change), so no model step waits on it: each tool result says `copy_refresh: { code: 'after_answer' }` and the answer carries the real `copy_refresh`. It never edits the copy itself; clients see the change when the refresh commits and the sync version moves.
- **Which project is which:** `pm_list_projects` (no PM call) lists the projects the current grant allows this client, each `{ id, name }` with the name from the approved PM copy (`name: null` for an allowed id the copy does not list). Ask's instructions list them the same way ("Name (project_id id)"). The copy is only used for these labels.
- **Ask's limits in Full:** 30 s and up to 8 model calls whether or not web is on (a cross-app change takes several steps); Read only keeps 20 s (30 s with web) and 6 calls.
- Audit: one `mcp_tool` or `ask_tool` event per call (actor, tool, ok/code, PM record ids), never field values. Ask's answer lists each change with the app, PM's ids and the receipt status.

## 7. Known limits

- With sensitive data off, a `records.list` word search (`q`) runs in PM over whatever PM searches; if PM's search covers secure fields, which records match could hint at secure text. PM can exclude secure fields from `q` for this caller.
- A grant with change actions but no read actions still shows record contents in write answers and conflict messages (redacted as above).
- A conflict's `current` is passed on redacted; an answer of a shape Harrison OS does not recognise is reduced to its revision and status.

## 8. Answered by root (kept for the record)

Binding pair, numeric revisions, native `records.list` keys, conflict DTO mapping, owner reads include financial and internal data, whole-section merge, `includeSensitive` instead of a permanent exclusion, `field.read` snapshot and `base`, Field Hub change keys, receipts `saved` / `pending`. Open: whether `project.read` can carry financial values (Harrison OS passes it through; if it can, mark them or omit them for this caller).
