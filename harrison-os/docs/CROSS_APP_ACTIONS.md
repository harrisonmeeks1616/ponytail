# Cross-app actions: Harrison OS AI -> Electrical PM (and Field Hub through PM)

Status: **contract proposal for root, version 1.** The PM side (`PM_COMMANDS_SERVICE`) is root's and is not deployed or granted. The Harrison OS side exists on branch `claude/epic-rubin-dd1qio` (`src/crossapp.js`, the `pm_*` and `field_*` tools in `src/mcp.js`, `tests/crossapp.test.mjs`). It was written before this contract and will be changed to match it once root confirms the names below. Nothing here is enabled: no binding, no grant, no consent.

## 1. Transport

`await env.PM_COMMANDS_SERVICE.execute(request)` over a private Workers service binding. No public route, no token in Harrison OS, no Field Hub credential in Harrison OS (the Field Hub bridge credential stays in PM's secrets).

Root to supply for `scripts/deploy-guard.mjs`: the exact `service` and `entrypoint` of the `PM_COMMANDS_SERVICE` binding. The guard currently accepts only `PM_DIGEST_SERVICE`; it will accept this one exact pair as well and nothing else.

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

## 4. `metadata.read` (new, needed): exact response

Request: `{ action: 'metadata.read', projectId }`.

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

How Harrison OS uses it: the model is told to read it before any change; `pm_create_record` and `pm_update_record` read it again themselves in the same call and refuse, before PM is asked, any key not declared for the type and section, a missing `required` key on create, a value not of the declared value form, a status not in `statuses`, and any `secure` field. Field names are never guessed. PM validates everything again.

## 5. Per-action data

| action | request extras | data on success |
|---|---|---|
| `project.read` | | `{ project }` (PM's own project object, passed through) |
| `records.list` | `query: { type?, status?, includeArchived?, text?, limit (1..50), cursor? }` | `{ records: [Record], cursor? }` |
| `record.read` | `recordId` | `{ record: Record }` |
| `record.create` | `requestId`, `body: { type, status?, <topLevel keys>, data?, financial?, internalData? }` | `{ record: Record }`, receipt `saved` |
| `record.update` | `recordId`, `requestId`, `body: { expectedRevision, status?, <topLevel keys>, data?, financial?, internalData? }` | `{ record: Record }`, receipt `saved`; `conflict` with `current.revision` |
| `record.archive`, `record.restore` | `recordId`, `requestId`, `body: { expectedRevision }` | `{ record: Record }`, receipt `saved` |
| `field.status` | | passed through |
| `field.read` | `query: { kind, key }` | `{ kind, key, rev: number, record: object, base: object \| null }` |
| `field.pending` | | `{ operations: [ { operationId, kind, key, status: 'pending' \| 'conflict' \| 'saved', ... } ] }` |
| `field.edit` | `requestId`, `body: { kind, key, expectedRev, base, changes, reason }` | receipt `saved` or `pending` with `operationId`; `conflict` with `current.rev` |
| `field.retry` | `operationId`, `requestId` | receipt `saved` or `pending`; `conflict` as above |

`Record`: `{ id, type, revision: number, status, archived: boolean, <topLevel keys>, data?, financial?, internalData? }`.

- **Updates send whole sections.** PM's edit API replaces a section it is given, so `pm_update_record` reads the complete current record in the same call, checks `revision` against the model's `expected_revision` (unless it is a `requestId` retry, which PM replays), merges the model's changes into that section and sends the full section. Sections the model did not touch are not sent.
- **Field Hub edits.** `field_edit_record` reads `field.read` in the same call, checks `rev`, and sends `base` back exactly as `field.read` returned it, with the model's `changes` and a required `reason` (1 to 1000 characters). The adapter owns the Field Hub `opId`.
- **Secure fields.** Harrison OS drops every `secure` field from what the model sees and refuses to write a section that has a `secure` field, because a whole-section replace would need values the model never saw. If PM preserves secure values on a section replace, or omits them on `record.read` for this caller, say so and this rule can narrow.

## 6. Harrison OS side (rules it keeps)

- **Owner grant, separate from everything else** (Memory > Connections > "AI actions in Electrical PM and Field Hub", owner-only `PUT /api/connections/crossapp/grant`): which AI clients (Ask, MCP clients), which project ids, which actions. Default: nothing. Read fresh on every call; no tool, record or web page can reach it.
- On top of it: Electrical PM and Field Hub count as Work, so the client's own grant must include Work; writes need Full (Ask: "What Ask may do" Full for Work plus Work consent; MCP: the MCP grant Full for Work).
- The copied company-project table (`pm_records`) is never read or written by these tools. After a `saved` write, Harrison OS asks for one immediate copy refresh through the existing fenced path, `pm.refreshHttpSource(env, nowMs, { timeoutMs: 5000 })`, and reports its outcome (`ok`, `in_progress`, `not_connected`, ...). It never edits the copy itself; clients see the change when the refresh commits and the sync version moves.
- Audit: one `mcp_tool` or `ask_tool` event per call (actor, tool, ok/code, PM record ids), never field values. Ask's answer lists each change with the app, PM's ids and the receipt status.

## 7. Questions for root

1. `PM_COMMANDS_SERVICE` binding: exact `service` and `entrypoint` for the deploy guard.
2. Record revision key: `revision` on `Record` and `expectedRevision` on update, both numbers? Conflict `current` key names?
3. `records.list` query keys: are `type`, `status`, `includeArchived`, `text`, `limit`, `cursor` acceptable, or PM's names?
4. Secure fields over this RPC: returned, omitted or masked by `record.read`? Does a section replace keep secure values not sent?
5. `valueForms`: can the registry's kinds be mapped as above? A kind with no clean JSON form can be left out; Harrison OS will then refuse fields of that kind rather than guess.
6. `field.read`: is `base` exactly what `field.edit` wants back for that `rev`? Does the adapter have `changeKeys` per kind?
