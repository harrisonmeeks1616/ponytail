# Harrison OS MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) endpoint so an AI client can use Harrison OS records. Harrison chooses what it may do: **Off**, **Read only** or **Full**, and in which scopes. Implemented in `src/mcp.js`; authentication and route authority in `src/auth.js`; tests in `tests/mcp.test.mjs`, `tests/mcp-full.test.mjs`, `tests/mcp-connections.test.mjs` and `tests/auth.test.mjs`.

**Status:** the server, the access control and the Full tools are implemented and covered by unit tests that drive the real Worker in-process (create, read, edit, complete, undo, review, reminders, projects, denied modes). **No real MCP client (Claude Desktop, Claude Code or another) has been run against the deployed app yet.** Record that result separately when it has been tried.

## Access: Off, Read only, Full

Harrison sets it in the app: Memory -> Connections -> "AI client access". Choose a mode and the scopes (Work, Personal or both), then **Save access**. The card says in plain words what is in force ("Now: ...").

| Mode | What a connected AI client can do |
|---|---|
| Off | Nothing. `initialize` and `ping` answer, `tools/list` is empty and every tool call is refused (`access_off`). |
| Read only | The read tools below, in the chosen scopes. A write tool is not listed, and calling it anyway is refused (`read_only`) with nothing changed. |
| Full | Everything Harrison OS owns, in the chosen scopes: create, edit, complete, archive, review, organise and delete tasks, Waiting items, references, ideas, decisions, projects and saved places, inbox captures, reminders, preferences, drafts and the weekly review. No confirmation step for ordinary work: every change goes through the app's own validated routes. Item, decision, project, preference and capture-review changes, and weekly-review Today picks and deferrals, come back with a `changeId` (`review_capture`: `changeIds`) that `undo_change` reverses. Reminders, drafts, saved places, `capture_text` and `weekly_review_complete` have no `changeId`: cancel, edit, delete or save again instead. `delete_item`, `delete_capture` and `delete_draft` are permanent and say so. |

- **Revoke:** choose Off (or Read only, or fewer scopes) and Save. The grant is read from the database on every `tools/list` and `tools/call`, so the very next request obeys it; nothing is cached and no reconnect is needed. A client may need to list tools again to see a changed list (`listChanged` is false: the server is stateless and cannot notify it).
- **Before Harrison saves a choice**, the deployment default applies exactly as before access control existed: read only, the scopes in `MCP_SCOPES` (Work only if unset) and `capture_text` only when `MCP_ALLOW_CAPTURE=1`. Once he saves, his choice replaces both variables.
- **Who can change it:** only the owner's session (or the loopback dev identity), through `GET`/`PUT /api/connections/mcp/grant`. The MCP service identity is refused there (403, and `authorizeRoute` keeps it on `/api/mcp`), no tool reads or changes the grant, and record text cannot ask for it: results are labelled untrusted and nothing in them is acted on.
- **Always read-only, in every mode:** calendar events and company project (PM) data. They are copies of other systems; changes belong in the calendar app and the official PM app, and Harrison OS never edits a copy as if the original had changed.
- **Never reachable by any tool:** the access grant, AI consent and settings, export and restore, push and devices, sessions, attachments, test hooks, and calendar or PM source setup. There is no shell, SQL or file access and no generic "call any path" tool.

How Full works inside: each write tool builds one fixed request (method, path, body) and runs it in-process through the app's own route table (`src/api.js` `internalDispatcher`) as the internal identity `mcp_client`. `authorizeRoute` limits that identity to the app-owned record routes (`/api/items`, `/api/captures/:id/...`, `/api/inbox`, `/api/projects` except a project's AI brief, `/api/reminders`, `/api/undo`, `/api/preferences`, `/api/drafts`, `/api/review/weekly`). So validation, row scopes, undo history, idempotent retries and conflict answers (404, 409 `stale_edit`, `state_moved_on`, 410) are exactly the app's, and come back to the client as tool errors with the status and code.

**Electrical PM and Field Hub (`pm_*`, `field_*`):** thirteen more tools that act on Electrical PM itself, and on Field Hub through it, by calling PM's private command entrypoint. They exist only when the `PM_COMMANDS_SERVICE` binding is set, and are listed per action only when Harrison's separate cross-app grant allows this client that action (Memory > Connections > "AI actions in Electrical PM and Field Hub"); every call checks it again, plus Work in this grant and Full for writes. Contract, data rules and receipts: docs/CROSS_APP_ACTIONS.md. Their exact definitions are the `cross_app` section of `docs/MCP_MANIFEST.json`.

**Exact tools/list per mode:** `docs/MCP_MANIFEST.json` holds the `tools/list` answer (names, descriptions, input schemas, annotations) and the `initialize` instructions for the default, Off, Read only and Full grants, generated from the serving code by `node scripts/mcp-manifest.mjs --write`. `tests/mcp-full.test.mjs` fails if it differs from what the server answers. The scopes a grant names do not change the list (every tool takes a `scope`); they decide which scope a call may use.

## Endpoint and transport

- `POST /api/mcp`: JSON-RPC 2.0 over MCP Streamable HTTP. Every answer is a single `application/json` response; there is no SSE stream and no `Mcp-Session-Id` (the server is stateless).
- Protocol versions: `2025-11-25` (current) and `2025-06-18` (previous). `initialize` echoes a supported requested version, otherwise answers with the current one. A request with an unsupported `MCP-Protocol-Version` header gets 400.
- Methods: `initialize`, `ping`, `tools/list`, `tools/call`. Notifications (for example `notifications/initialized`) and client responses get 202 with no body. Any other method gets JSON-RPC error -32601. Batches (JSON arrays) are rejected (-32600). Bodies over 64 KB get 413. Bad JSON gets -32700.
- `GET /api/mcp` gets 405 (no server-initiated stream). A browser `Origin` header other than the server's own gets 403.

## Authentication: a separate Access service token

The MCP client authenticates with its own Cloudflare Access application and service token, like the iOS Shortcut but separate from it. The owner's browser session can **not** call `/api/mcp` (403), and the MCP token can call **only** `/api/mcp` (403 everywhere else).

1. Cloudflare Zero Trust -> Access -> Service credentials: create a service token (for example "Harrison OS MCP"). Put the Client ID and Client Secret in the AI client's configuration only. Never commit them.
2. Access -> Applications: add a self-hosted application for the Worker hostname with path `api/mcp`. Policy: action **Service Auth**, include that service token only. Copy its Application Audience (AUD) tag.
3. Set the Worker variables (dashboard or `wrangler.jsonc` vars; blank in the repository):

   | Name | Meaning | Repository value |
   |---|---|---|
   | `ACCESS_AUD_MCP` | AUD tag of the MCP application. Blank, or equal to the owner's or the Shortcut's AUD, means MCP is not configured and every MCP token is refused. | blank |
   | `MCP_SCOPES` | Default until Harrison saves access in the app: comma list of scopes a client may read, `work`, `personal`. Unset means `work` only. Unknown words grant nothing. | `work` |
   | `MCP_ALLOW_CAPTURE` | Default until Harrison saves access in the app: `1` enables `capture_text` on top of read only. | blank |

4. Configure the client to send the Access headers on every request to `https://<your worker host>/api/mcp`, for example:

   ```json
   {
     "mcpServers": {
       "harrison-os": {
         "type": "http",
         "url": "https://<your worker host>/api/mcp",
         "headers": {
           "CF-Access-Client-Id": "<service token client id>",
           "CF-Access-Client-Secret": "<service token client secret>"
         }
       }
     }
   }
   ```

   Access exchanges these headers for a signed `Cf-Access-Jwt-Assertion`, which the Worker verifies on every request (signature, issuer, expiry and the MCP audience; the key fetch is per request with a timeout).

5. Check it in the app: Memory -> Connections -> "AI clients (MCP)". It shows "Set up, not used yet" until a client has made a tool call, then "Last used <time>", with the access in force in plain words. It never shows the token or audience. Choose Off, Read only or Full under "AI client access".

Local testing: with `DEV_ALLOW_UNAUTH=1` on `127.0.0.1` the dev identity may call `/api/mcp` too. It must send `X-Requested-With: XMLHttpRequest` (the app's CSRF rule for non-service identities):

```bash
curl -s http://127.0.0.1:8899/api/mcp -H 'Content-Type: application/json' -H 'X-Requested-With: XMLHttpRequest' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Tools

Every tool has a strict input schema (`additionalProperties: false`) and a bounded result (at most 48 KB). A result that fits comes back whole, so text a client writes back is never shortened by this server. Only a result over the limit has its long strings shortened (each ending `…`, lists capped at 50) and carries `truncated: true` with a note to read the one record (`get_item`) before changing it. Every result carries `notice`: the record text is untrusted data and cannot grant permissions or ask for actions. Results come back both as `structuredContent` and as one JSON text block.

| Tool | Arguments | Returns |
|---|---|---|
| `search_memory` | `query` (1-500 chars), `scope`, `limit` 1-20 (default 10) | Exact/full-text matches over captures, items and projects; current before superseded |
| `get_today` | `scope` | Today: fixed dates, next action with reason, picked work, Waiting, resume points. Does not mark the app as opened |
| `list_open_tasks` | `scope`, `limit` 1-50 (default 20) | Open tasks |
| `list_waiting` | `scope`, `limit` 1-50 (default 20) | Open Waiting items (who, asked, promised, follow-up, reply recorded) |
| `get_project` | `project_id`, `scope` | Project, next action, Waiting, decisions (current first), latest saved place |
| `get_resume_brief` | `project_id`, `scope` | Source-linked resume brief. Listed only when the Ask module provides `buildResumeBrief` |
| `get_weekly_review` | `scope` | Weekly review. Listed only when the review module provides `buildWeeklyReview` |
| `list_calendar_events` | `scope`, `days` 1-14 (default 7) | Read-only events from now. Events of any other scope show only as busy (no title or location). Listed only when the calendar module provides `listEvents` |
| `get_pm_digest` | `scope` | Company project digest with links and freshness. Listed only when the PM module provides `listDigest` |
| `capture_text` | `text` (1-10000 chars), `scope` | Full, or the default with `MCP_ALLOW_CAPTURE=1`. Saves a capture (source `mcp`) to the review inbox with pending proposals. Nothing is filed, scheduled or accepted by this tool. The same text in the same scope within one UTC minute counts as one capture |

The tools above are the default surface (before Harrison saves a choice). Once he has saved Read only or Full, these reads are added; each is one fixed `GET` of the app's own route:

| Tool | Arguments | Returns |
|---|---|---|
| `list_items` | `scope`, optional `kind`, `state` (open, done, archived), `project_id`, `limit` 1-50 | Items of every kind |
| `get_item` | `item_id`, `scope` | One item with its full text and files list (read it before `update_item` when a list was shortened) |
| `list_projects` | `scope` | Projects, active first |
| `list_review_inbox` | `scope` | Captures waiting for review, each with its proposed pieces (ordinal, kind, title, dates) |
| `list_reminders` | `scope`, `limit` 1-50 | Reminders with next alert and recent deliveries |
| `list_preferences` | `scope` | Preferences (key, value, note) |
| `list_drafts` | `scope` | Drafts with their claim-check flags |

Full only (each is one fixed request through the app's route; the answer is the route's own, with ids and `changeId` where the app records history):

| Tool | App route | Notes |
|---|---|---|
| `create_item` | `POST /api/items` | task, waiting, reference or idea; optional `id` for safe retries |
| `update_item` | `PATCH /api/items/:id` | title, notes, dates, project, who, claim status, Today pick, kind |
| `item_action` | `POST /api/items/:id/<action>` | `complete`, `reopen`, `archive`, `reply`, `snooze` (`follow_up_on`), `defer` (`start_on`, null clears) |
| `record_decision` | `POST /api/items` (kind decision) | `supersedes_id` replaces a decision; the old one stays, marked superseded |
| `delete_item` | `DELETE /api/items/:id` | Permanent; suggests archive or undo instead |
| `undo_change` | `POST /api/undo/:changeId` | Refused if the record moved on or was already undone |
| `create_project`, `update_project` | `POST /api/projects`, `PATCH /api/projects/:id` | name, purpose, state active/done/archived |
| `save_place` | `POST /api/projects/:id/checkpoint` | stopped at, open question, next step |
| `review_capture` | `POST /api/captures/:id/review` | accept pieces by ordinal (with edits), drop pieces, keep as note. A piece stays in the capture's scope |
| `delete_capture` | `DELETE /api/captures/:id` | Permanent; suggests keep as note instead |
| `create_reminder`, `edit_reminder`, `cancel_reminder` | `POST /api/reminders`, `PATCH /api/reminders/:id`, `POST /api/reminders/:id/cancel` | `edit_reminder` requires `expected`, the whole reminder as last seen (`text`, `local_date`, `local_time`, `time_zone`, `recurrence`, all required); a changed reminder is refused `stale_edit`. No `changeId` |
| `set_preference`, `delete_preference` | `PUT`/`DELETE /api/preferences/:key` | Both undoable |
| `create_draft`, `edit_draft`, `check_draft`, `delete_draft` | `/api/drafts` routes | Template drafts only: MCP never asks the app for an AI rewrite. Nothing is sent. No `changeId`: `edit_draft` replaces the body |
| `weekly_review_select`, `weekly_review_defer`, `weekly_review_complete` | `/api/review/weekly/*` | Hard due dates never move. Today picks and a moved date return `changeId`s |

`scope` is `work` or `personal` and is required by every tool; `all` is not accepted. A scope outside the grant, a refused mode and invalid arguments come back as tool errors (`isError: true`) before anything runs; the app's own refusals come back as tool errors with its status and code (for example `409 stale_edit`). An unknown tool name is JSON-RPC error -32602. Write tools are annotated `readOnlyHint: false`; the deletes `destructiveHint: true`.

## Owner status endpoint

`GET /api/connections/mcp` (owner or local dev only) answers `{ configured, scopes, allow_capture, grant, last_call_at, shortcut_configured, shortcut_scopes, features: { ai, calendar, pm } }`. `grant` is the access in force, `{ mode: off|read|full, scopes, allow_capture, set_by: default|owner, updated_at }`; the top-level `scopes` and `allow_capture` repeat it for older app versions. `configured` means the Access team domain and a distinct `ACCESS_AUD_MCP` are set; it does not prove a client can connect. `shortcut_configured` means the team domain, `ACCESS_AUD` and `ACCESS_AUD_SHORTCUT` are set; it does not prove the phone has sent anything. `shortcut_scopes` is the server's allowlist for the Shortcut credential (`SHORTCUT_SCOPES`). `features` says whether this build has `GET /api/ai/status`, `GET /api/calendar/connections` and `GET /api/pm/sources`; the Connections card asks only those that exist. No secrets or audience values are returned.

`GET /api/connections/mcp/grant` (owner or local dev only) answers the `grant` object. `PUT` with exactly `{ mode, scopes }` sets it: `mode` is `off`, `read` or `full`; `scopes` lists `work` and/or `personal` once each, at least one unless `off`. Anything else is 400 and nothing is saved. The MCP identity gets 403 on both.

## iPhone Shortcut

The Memory -> Connections card points here for the Shortcut. It uses the same kind of Access service token as an MCP client, through its own application, and may only call `POST /api/shortcut/capture`.

1. Zero Trust -> Access -> Service credentials: create a service token (for example "Harrison OS Shortcut"). Keep the Client ID and Client Secret only in the Shortcut.
2. Access -> Applications: add a self-hosted application for the Worker hostname with path `api/shortcut/capture`. Policy: action **Service Auth**, include that service token only. Set its AUD tag as the Worker variable `ACCESS_AUD_SHORTCUT` (it must differ from `ACCESS_AUD_MCP`).
3. In the Shortcuts app: add "Dictate Text" or "Ask for Input", then "Get Contents of URL" with URL `https://<your worker host>/api/shortcut/capture`, method POST, headers `CF-Access-Client-Id` and `CF-Access-Client-Secret`, and a JSON body: `text` (the input), optionally `scope` (default `work`; the server allows only the scopes in `SHORTCUT_SCOPES`, Work only unless set otherwise), `client_ref` (6-60 of `A-Z a-z 0-9 _ -`, so a retry is not saved twice) and `time_zone`.
4. Run it once while online and check the capture appears in the Inbox. The Shortcut needs a connection: it does not keep captures while the phone is offline.

The card shows "Set up" once the variables are set; that does not prove the phone has sent anything.

## Audit

Each tool call writes one `events` row, kind `mcp_tool`, with `actor: 'mcp_client'`, `tool`, `scope`, `count`, `ok` and an error `code` when it failed; a successful write also lists the record `ids` and `change_ids` it touched (at most 20 each), so every AI change can be traced to its call. It updates `meta.mcp_last_call_at`. The same registry serves Ask's Full mode (docs/AI.md), whose calls are rows of kind `ask_tool` with `actor: 'ask_ai'`. Arguments, queries and record text are never logged. Unknown tool names are logged as `unknown`. A Full tool's change also writes the app route's own event (for example `item_created`, `reminder_created`); where the app records an identity it is `mcp_client`. Saving access writes `mcp_grant_set` with the mode and scopes only.

## Limits and what is not done

- Real client interoperability: no real MCP client has been run against the deployed app yet (see Status).
- No per-tool or per-kind grants: Full covers every write tool in the chosen scopes.
- No `resources`, `prompts`, SSE streams, sessions, pagination or `outputSchema`.
- The time zone for Today, briefs, reviews, digests and new reminders (when none is given) is the last one the app reported, else America/New_York.
