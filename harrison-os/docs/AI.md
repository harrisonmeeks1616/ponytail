# Ask, AI and resume briefs

Code: `src/ai.js` (provider adapter, consent), `src/ask.js` (routes, context assembly, briefs), `public/views/ask.js` (drawer, Memory card, project block). Tests: `tests/ai.test.mjs`, `tests/ask.test.mjs`.

## Configuration (Worker secrets and vars; nothing in source)

| Name | Kind | Default | Meaning |
|---|---|---|---|
| `AI_API_KEY` | secret (`wrangler secret put AI_API_KEY`) | unset | Anthropic API key. Unset or blank = "Not set up"; nothing is ever sent. |
| `AI_MODEL` | var | `claude-sonnet-5-5` | Model id for the Messages API. Invalid values fall back to the default. |
| `AI_TIMEOUT_MS` | var | `20000` | Whole-call deadline, clamped to 2000..30000 ms. |

Local example for `.dev.vars` (git-ignored): `AI_API_KEY=` (leave blank unless you are testing a real key).

Provider call: `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2026-10-21`, body `{ model, max_tokens, system, messages: [{ role: 'user', content }], output_config: { effort: 'low', format: { type: 'json_schema', schema } } }`. Raw `fetch` (the Worker has no runtime dependencies). One attempt plus at most one retry on 429, 529 or 5xx, inside the same deadline. The browser request's AbortSignal is passed through, so closing the drawer or tapping Cancel stops the provider call. A `refusal` or `max_tokens` stop, a non-JSON reply or an oversize reply (over 200,000 characters) is `invalid_output`. Logs carry `{ ok, reason, status, attempts, ms }` only: never prompts, answers or the key. No server-side refusal fallback is configured, because `AI_MODEL` is configurable and the deterministic answer already covers a refusal.

## Consent

Per scope, default off. Stored in the existing `kv` table (`ai_consent:work`, `ai_consent:personal`, JSON `{ allowed, updated_at }`) through `db.kvPut`, so `src/db.js` remains the only module that runs SQL (enforced by `tests/db.test.mjs`). Migration `0003_assist.sql` therefore has no schema change.

Live AI is used only when the key is set AND consent is on for every scope whose text would be sent. In the All view the question itself may be either scope's text, so All needs both Work and Personal on; otherwise the answer is the deterministic one with `fallback_reason: 'consent_off'`.

## API

| Method and path | Body / query | Response |
|---|---|---|
| `GET /api/ai/status` | | `200 { configured, consent: { work, personal } }` |
| `PUT /api/ai/consent` | `{ scope: 'work'\|'personal', allowed: boolean }` | `200` same shape as status. `400 scope_required / scope_all_not_allowed / invalid_scope / invalid_allowed` |
| `POST /api/ask` | `{ scope: 'work'\|'personal'\|'all', question (1..1000), mode?: 'retrieve'\|'plan'\|'resume'\|'write', context?: { project_id?, item_id? }, tz? }` | `200 { answer: { text, sources: [{ ref, title, scope, kind, project_id, sample }], live_ai, label, fallback_reason?, mode, scope } }`. `400 invalid_question / invalid_mode / invalid_context / invalid_project_id / invalid_item_id / invalid_time_zone`, `404 not_found` (context record not in scope) |
| `GET /api/projects/:id/brief` | `?scope=work\|personal&tz=&ai=1` | `200 { brief }` (below). `404 not_found` when the project is not in that scope |

`fallback_reason`: `not_configured`, `consent_off`, `timeout`, `cancelled`, `provider_error`, `invalid_output`. `label` is `AI answer` or `Not AI. Matched from your saved records.`

Ask has no tools and no write path. Questions and answers are not stored; the `events` row for an Ask holds `{ scope, mode, live_ai, fallback_reason, sources }` only.

### Context assembly (deterministic, in-scope only)

In order, deduplicated by ref, at most 40 records: the focus project (with its saved place, next task, Waiting, decisions) or item; full-text matches (one `db.search` per keyword, at most 6 keywords, ranked by keywords matched); Today's hard dates, open tasks, Waiting and saved places; calendar events (`calendar.listEvents`, busy-only rows skipped) and PM digest projects (`pm.listDigest`) when those modules export them. Records go to the model as a JSON array inside `<records>` tags, framed as untrusted quoted data. Each record carries `sample` (0 or 1) and the system prompt tells the model to call sample records sample data. The model must return `{ answer, cited_refs }`; any cited ref that was not provided, no cited ref at all when records were provided (an ungrounded reply, e.g. a model obeying injected text), a missing field or an answer over 6,000 characters is `invalid_output`, and the deterministic answer is returned instead. Deterministic text marks sample records `(sample data)`; the drawer shows a Sample chip on each sample source.

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

Every assertion carries a ref listed in `sources`. Saved-place text is cited to its project (the saved place is stored under it); the record it was prefilled from is `saved_from`. `?ai=1` adds `brief.ai`: `{ live_ai: true, label, text, sources }` (citations validated against the brief's refs; at least one required) or `{ live_ai: false, fallback_reason }`.

## Deletion

Ask and briefs store no derived rows; `purgeRef()` returns `[]`. Consent rows hold no user content.

## Not verified here

No real provider call has been made from this repository: tests use a fake fetch. A real call needs `AI_API_KEY` set as a Worker secret and Work or Personal consent turned on in Memory.
