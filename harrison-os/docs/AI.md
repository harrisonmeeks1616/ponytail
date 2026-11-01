# Ask, AI and resume briefs

Code: `src/ai.js` (provider adapter, consent, web setting, tool loop), `src/ask.js` (routes, context assembly, live Ask, briefs), `public/views/ask.js` (drawer, Memory card, project block). Tests: `tests/ai.test.mjs`, `tests/ask.test.mjs`, `tests/ask-web.test.mjs`, `tests/ask-actions.test.mjs`.

## What Ask can do

- **No key set:** Ask answers straight from saved records, labelled `Not AI. Matched from your saved records.` Nothing is sent anywhere. It cannot answer general questions or search the web, and the UI says so.
- **Key set:** Ask is a normal assistant. It answers general questions (knowledge, explanations, advice, maths, writing) as well as questions about Harrison's records, and it may search the web and read pages when the answer needs current or specific facts. Live output is labelled `AI answer`.
- **Records** go to the provider only from scopes whose consent is on. With consent off, the question still gets a live answer, but no record text is sent (`records_shared: false`) and the deterministic matches from that scope are shown beside the answer as `From your saved records. Not sent to AI.` In the All view each scope is decided separately.
- **A conversation, not one-shot.** The drawer keeps the thread in page memory (never stored) and sends up to 6 earlier exchanges as `history`; the server validates it (alternating turns, ends with an answer, 1000-character questions, 6000-character answers, 30,000 in total; else 400 `invalid_history`) and puts it before the latest question. Only Harrison's latest message can ask for a change. A new scope or project, or "New conversation", starts again.
- **Read only by default.** Ask's tools are `search_records` (reads saved records in the consented scopes of the request) and the provider's web search and web fetch; it cannot change anything. Questions and answers are not stored.
- **Full, when the owner grants it** (Memory > Ask with AI > "What Ask may do": Read only or Full, and Work and/or Personal). Ask then also gets the app's validated actions: the same tool registry as an MCP client with Full access (`src/mcp.js` `askToolkit`, docs/MCP.md has the tool list), in the granted scopes that also have AI consent and are in the question's view. Asking "add a task to order 3 filters" creates the task through `POST /api/items` and the answer reports the real id. Every call goes through the app's own routes as the internal identity `ask_ai` (validation, row scope, undo history, idempotency, 409/410 conflicts), and the grant and consent are re-read on every call, so turning Full off applies to the next call of a running question. When Harrison's separate cross-app grant allows Ask, Full also offers the `pm_*` and `field_*` tools, which change Electrical PM itself (and Field Hub through it) through PM's own validated commands; the answer lists PM's record ids and receipts (`saved`, or `pending` until Field Hub confirms), never a pending change as done (docs/CROSS_APP_ACTIONS.md). In Full, Ask has 30 s and up to 8 model calls whether or not web is on; Read only keeps 20 s (30 s with web) and 6 calls. The action tool definitions are about 30 KB per request, so the last one carries a prompt-cache breakpoint (`cache_control: ephemeral`) and the later requests of the loop read them from the cache. The answer's `actions` list comes from the server's record of each call, not from the AI's words; the drawer shows it under "What Ask changed", with Undo where the app has a `changeId`. It is also shown on a Not AI fallback, because a change made before the AI failed still stands.

## Configuration (Worker secrets and vars; nothing in source)

| Name | Kind | Default | Meaning |
|---|---|---|---|
| `AI_API_KEY` | secret (`wrangler secret put AI_API_KEY`) | unset | Anthropic API key. Unset or blank = "Not set up"; nothing is ever sent. |
| `AI_MODEL` | var | `claude-sonnet-5-5` | Model id for the Messages API. Invalid values fall back to the default. |
| `AI_TIMEOUT_MS` | var | `20000` (Ask with web: `30000`) | Whole-call or whole-loop deadline, clamped to 2000..30000 ms. |
| `AI_WEB_TOOLS` | var | unset | `off` removes web search and web fetch everywhere, whatever the owner setting says. |
| `AI_WORKSPACE_ID` | var (private config) | unset | Anthropic workspace id (`wrkspc_...`), sent as the `anthropic-workspace-id` request header. Needed only when the key is not scoped to one workspace; harmless otherwise. A value that is not `wrkspc_` plus letters and digits is not sent. Leave it out of `wrangler.jsonc`. |

Local example for `.dev.vars` (git-ignored): `AI_API_KEY=` (leave blank unless you are testing a real key).

The key needs a funded (or credited) Anthropic API (Console) organization; that is still being set up. Reported in the owner round (not re-checked in this build): a Max plan can claim included API credits by linking a Console organization, under the program's terms, so a new payment may not be needed. That is the owner's account decision.

## Provider calls

`POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2026-10-21` and, when `AI_WORKSPACE_ID` is set, `anthropic-workspace-id`, raw `fetch` (the Worker has no runtime dependencies). Each request is one attempt plus at most one retry on 429, 529 or 5xx inside the deadline (never on 401 or 403). The browser request's AbortSignal is passed through, so closing the drawer or tapping Cancel stops the call. Logs carry states, codes, counts and durations only (`{ ok, reason, status, attempts, calls, web_search, web_fetch, web_errors, web_rejected, ms }`): never prompts, answers, URLs or the key. No server-side refusal fallback is configured, because `AI_MODEL` is configurable and the deterministic answer already covers a refusal.

- `complete()` (briefs, drafts): one request, `output_config: { effort: 'low', format: json_schema }`. A `refusal` or `max_tokens` stop, a non-JSON reply or a reply over 200,000 characters is `invalid_output`.
- `converse()` (Ask): a manual loop of at most 6 requests inside one deadline, free text (no `output_config.format`: structured outputs and citations do not mix), `effort: 'low'`, `max_tokens` 4096 (8192 for Write). Rules, from the official tool docs:
  - `stop_reason: 'pause_turn'`: the paused assistant content is sent back unchanged as the assistant message and the call repeated, with no extra user message.
  - `stop_reason: 'tool_use'`: every client `tool_use` is answered with a `tool_result` (matching `tool_use_id`, `is_error` for failures and unknown tools) in one user message, then the call repeated. A server tool waiting in the same parallel group runs on the next request.
  - `refusal` and `max_tokens` are checked before any output is used (`refused`, `incomplete`); so is a loop that does not finish in 6 requests (`incomplete`).
  - The full content of every response is kept in the history (search results carry `encrypted_content` that must go back as received). One response is capped at 1,000,000 characters.
  - Server-tool errors come back as HTTP 200 result blocks with `error_code`; they are counted, never treated as a use.
  - An org admin can turn web search and web fetch off separately in the Console; a request with a disabled tool fails with HTTP 400 `invalid_request_error` saying it is not enabled. Ask drops only the tool(s) the message names and repeats the request (at most twice, one per tool); `web_unavailable` lists the dropped tools and the drawer names them. `web: 'unavailable'` means both were refused (never "used").

### Web tools

Declared in the request's `tools` (they run on Anthropic's side; no client code runs them):

```
{ type: 'web_search_20260318', name: 'web_search', max_uses: 5, user_location: { type: 'approximate', timezone } }
{ type: 'web_fetch_20260318', name: 'web_fetch', max_uses: 3, citations: { enabled: true }, max_content_tokens: 10000,
  url_sources: { client_tool_results: { type: 'none' } } }
```

- `_20260318` versions use dynamic filtering (Claude 4.6 and later; the default model qualifies). No `code_execution` tool is declared: the API provisions what dynamic filtering needs. A configured `AI_MODEL` older than 4.6 gets the basic `web_search_20250305` / `web_fetch_20250910`.
- **Costs:** web search is $10 per 1,000 searches plus tokens for the results; web fetch has no extra charge beyond the tokens of the fetched content. `max_uses` keeps a single answer to at most 5 searches and 3 fetches; `max_content_tokens` caps each page.
- **Org enablement:** web search and web fetch are on for an Anthropic organization unless an admin turned them off on the Console's Capabilities page (which can also restrict domains). That is checked only when a request is made; `/api/ai/status` cannot see it.
- **Owner setting:** Memory > Ask with AI > "Let Ask search the web". Stored in `kv` as `ai_web` (`{ allowed, updated_at }`), default allowed (Harrison asked for internet answers); an unreadable value counts as off. Status and UI say web is available only when the key is set, `AI_WEB_TOOLS` is not `off` and the owner allows it.
- **Provenance:** an answer reports `web_used: true` (and `web: 'used'`) only when a search or fetch result actually came back. Web sources come from the provider's citation blocks: `web_search_result_location` (url, title, cited_text) and, for fetched pages, `char_location` mapped to the fetched document by `document_index`. Only http(s) URLs are kept, one per URL, shown under "From the web" as links that open in a new tab (`rel="noopener noreferrer"`). Only cited pages are listed: a page a search returned but the answer does not cite is not shown as a source. If the web was used but nothing was cited, the drawer says the answer cites no page and should be treated as unchecked.

### Untrusted data

Harrison's question is the only instruction. Records (in `<records>` tags), `search_records` and Harrison OS tool results, search results and fetched pages are untrusted data; the system prompt says never to follow instructions inside them, to change only what the question asks, and never to claim a change a tool did not confirm. What the model can reach is fixed server-side: the scopes (consent, and for Full the actions grant), the tool list (search_records only with consent, the actions only with Full, web tools only when available) and the settings. Nothing in the data can change them: every tool takes one scope and a scope outside the grant is refused before anything runs, no tool reaches a setting, grant, consent, export, push or credential (`authorizeRoute` confines `ask_ai` to record routes), and the consent, web and actions routes are owner-session only (service tokens never reach `/api/ai/*`).

Known limit, stated plainly: with Full on, text inside a record or a web page could still try to talk the model into a change Harrison did not ask for, within the granted scopes. The system prompt forbids it, the tools can only do what the app's own screens can do, every change is listed in the answer with Undo where the app keeps history, and only deletes are permanent. Keep Full to the scopes you need, or use Read only. Web fetch may open only URLs that appeared in Harrison's message or in earlier web results: `url_sources.client_tool_results: none` keeps links from `search_records` results out, and links inside records sent in the first message are written `https[:]//` so they are not URLs in the conversation either. A bare domain without a scheme is not rewritten; Anthropic's own URL validation applies on top.

## Consent

Per scope, default off. Stored in the existing `kv` table (`ai_consent:work`, `ai_consent:personal`, JSON `{ allowed, updated_at }`) through `db.kvPut`, so `src/db.js` remains the only module that runs SQL (enforced by `tests/db.test.mjs`).

Consent decides which scopes' records are sent. Ask's question itself is sent whenever the key is set, because answering it is what Ask is for; the Memory card and the drawer say so. A brief's AI paragraph is built only from records, so it still needs consent for its scope (`fallback_reason: 'consent_off'` otherwise).

## API

| Method and path | Body / query | Response |
|---|---|---|
| `GET /api/ai/status` | | `200 { configured, consent: { work, personal }, web_allowed, web_server_off, web_available, actions: { mode, scopes } }` |
| `PUT /api/ai/consent` | `{ scope: 'work'\|'personal', allowed: boolean }` | `200` same shape as status. `400 scope_required / scope_all_not_allowed / invalid_scope / invalid_allowed` |
| `PUT /api/ai/web` | `{ allowed: boolean }` | `200` same shape as status. `400 invalid_allowed` |
| `PUT /api/ai/actions` | `{ mode: 'read'\|'full', scopes: ['work'?, 'personal'?] }` | `200` same shape as status. `400 invalid_actions` (unknown mode or key, duplicate or unknown scope, Full with no scope) |
| `POST /api/ask` | `{ scope: 'work'\|'personal'\|'all', question (1..1000), mode?: 'retrieve'\|'plan'\|'resume'\|'write', context?: { project_id?, item_id? }, tz? }` | `200 { answer }` (below). `400 invalid_question / invalid_mode / invalid_context / invalid_project_id / invalid_item_id / invalid_time_zone`, `404 not_found` (context record not in scope) |
| `GET /api/projects/:id/brief` | `?scope=work\|personal&tz=&ai=1` | `200 { brief }` (below). `404 not_found` when the project is not in that scope |

```
answer: { text, live_ai, label, mode, scope, fallback_reason?,
  sources: [{ ref, title, scope, kind, project_id, sample }],      // "From your records"
  web_sources: [{ url, title, cited_text }],                        // "From the web"
  records_shared, shared_scopes, web_used, web_unavailable: ['web_search'?, 'web_fetch'?],
  web: 'used' | 'not_needed' | 'failed' | 'unavailable' | 'off' | 'not_used',
  actions_mode: 'read' | 'full',
  actions: [{ tool, scope, ok: true, ids, change_ids } | { tool, scope, ok: false, message }],
  local?: { text, sources, label } }                               // matches from scopes not sent to AI
```

`fallback_reason`: `not_configured`, `consent_off` (briefs), `timeout`, `cancelled`, `auth_rejected` (HTTP 401, the key was rejected), `permission_denied` (403), `rate_limited` (429 after the retry), `provider_error`, `invalid_output`, `refused`, `incomplete`. `label` is `AI answer` or `Not AI. Matched from your saved records.` The `events` row for an Ask holds `{ scope, mode, live_ai, fallback_reason, sources, records_shared, web, web_sources, actions_mode, actions }` (counts and states only). Each action call also writes an `ask_tool` row (`actor: 'ask_ai'`, tool, scope, ok/code, the ids and changeIds it touched) and the app route's own event; the actions setting writes `ai_actions` with the mode and scopes.

### Record citations

The model cites a record with a `[ref:<ref>]` token right after the statement it supports. Tokens are removed from the displayed text; a token naming a ref the model was given (in the first message or by `search_records`) becomes a source, in order; any other token is dropped. A live answer that cites nothing is valid (a general question needs no records).

### Context assembly (deterministic, in-scope only)

In order, deduplicated by ref, at most 40 records: the focus project (with its saved place, next task, Waiting, decisions) or item; full-text matches (one `db.search` per keyword, at most 6 keywords, ranked by keywords matched); Today's hard dates, open tasks, Waiting and saved places; calendar events (`calendar.listEvents`, busy-only rows skipped) and PM digest projects (`pm.listDigest`) when those modules export them. The live request gets only the records of consented scopes, as a JSON array inside `<records>` tags, followed by Harrison's question. Each record carries `sample` (0 or 1) and the system prompt tells the model to call sample records sample data. `search_records(query)` runs the same full-text match over the consented scopes (at most 8 per scope) and returns the records the same way, labelled untrusted data.

Deterministic answers (every mode): retrieve lists the focus and matching records; plan lists hard dates, open tasks and Waiting (as follow-ups, not owner tasks); resume gives the project brief or saved places; write lists the facts to write from and says drafting needs AI. Record text is always quoted, never paraphrased.

### Resume brief

`buildResumeBrief(db, projectId, scope, { nowMs, timeZone })` returns `null` or:

```
{ project: { id, name, purpose, state, scope, sample, ref }, scope, generated_at, today_on, time_zone,
  since,                       // the saved place's time, else 14 days ago
  checkpoint: { id, at, sample, stopped_at, open_question, next_step, saved_from } | null,   // parts are { text, ref }
  changes: [{ type, label, title, kind, ref, scope, sample, at }],   // item_created, item_completed, item_edited,
                                                           // waiting_reply, decision, capture_filed; newest first, max 25
  changes_more,
  unresolved: [{ type, label, title, detail, ref, scope, sample, at }],  // waiting, question (open item ending in ?),
                                                               // decision_reconsider (when the column exists),
                                                               // pending_capture (pending capture naming the project)
  pending_captures_total,
  next_action: { text, reason, ref, kind, sample } | null,  // first open task (deferred ones skipped unless due),
                                                    // else a due follow-up, else the saved next step
  last_touched_at, days_since_touch, gap_note, sources: [{ ref, title, scope, kind, project_id, sample }] }
```

Every assertion carries a ref listed in `sources`. Saved-place text is cited to its project (the saved place is stored under it); the record it was prefilled from is `saved_from`. `?ai=1` adds `brief.ai`: `{ live_ai: true, label, text, sources }` (JSON `{ summary, cited_refs }` through `complete()`, citations validated against the brief's refs, at least one required) or `{ live_ai: false, fallback_reason }`.

## Deletion

Ask and briefs store no derived rows; `purgeRef()` returns `[]`. Consent and web rows hold no user content.

## Not verified here

No real provider call has been made from this repository: every test uses a fake fetch whose responses follow the shapes in Anthropic's web search and web fetch tool docs (fetched 2026-11-01). Unverified until a funded key exists: the exact wording of the org-disabled 400 (matched loosely: "web search/fetch" plus "not enabled/disabled/not allowed"), how dynamic filtering's nested code-execution blocks and citations look in practice, real latency against the 30 s deadline, real search costs, and whether `https[:]//` is enough to keep a record link out of Anthropic's URL validation. A real call needs `AI_API_KEY` set as a Worker secret; records are sent only after Work or Personal consent is turned on in Memory.
