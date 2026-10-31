# Harrison OS build plan, October 31, 2026

Assignment: BUILD_HANDOFF.md (complete Slices 1, 2 and 3 today, America/New_York). Progress and evidence: PROGRESS.md. Acceptance status per case: ACCEPTANCE.md.

## Starting point

- Repository `harrisonmeeks1616/ponytail`, starting head `c9cf526` (seed commit, equal to origin/main at 10:55 EDT).
- Baseline rerun on this checkout: 207/207 unit tests, 11/11 local browser scenarios (after generating a git-ignored `.dev.vars`).

## Milestones (Eastern)

| By | Milestone | Observable result |
|---|---|---|
| 11:45 | M0 seams, CI job, record | Feature route/view registries, pre-numbered migrations, path-scoped CI; tests still green; on main |
| 15:30 | M1 parallel tracks | Seven tracks each land module + migration + tests + view, green in isolation |
| 17:30 | M2 integration | All tracks merged; derived-data deletion wired; full unit + browser suites green; on main |
| 20:30 | M3 cross-slice flows + adversarial review | capture→interpret→task/Waiting→reminder→resume→draft/decision→weekly review e2e; canary/injection/MCP negative paths; fixes |
| 22:30 | M4 evidence + handoff | ACCEPTANCE.md complete with labels; phone test batch; deploy runbook; final main push |

Recovery rule if a track slips: integrate what is green, keep its route returning an honest "not available yet" state rather than a dead control, record the gap in ACCEPTANCE.md, and continue the track after M2. No track's slip blocks another.

## Architecture rules for every track

- Backend: each feature is one module in `src/<feature>.js` exporting `ROUTES` (same `[method, RegExp, handler(ctx, ...captures)]` shape as `src/api.js`), registered in `src/features.js`. Handlers import helpers from `src/http.js` (`HttpError`, `json`, `readJson`, `requireScope`, `queryScope`, `requireText`, `iso`, `clampInt`, `validTimeZone`, `DATE_RE`). `handleApi` already authenticates, authorises, applies CSRF and maps `db.js` errors before any handler runs.
- Data: core tables (captures, items, projects, checkpoints, reminders, ...) are written only through `src/db.js`. A feature module may own SQL for its own new tables and may run read-only, scope-bound SQL on core tables. Every content row carries `scope` (`work`|`personal`) and `sample`. `all` is accepted only for read views; writes always name one scope.
- Migrations are pre-numbered: 0002 core completion, 0003 assist (Ask/AI/briefs), 0004 drafts/claims (decision details live in 0002, owned by T1), 0005 calendar, 0006 PM, 0007 weekly review, 0008 MCP. Never edit 0001.
- Derived content (drafts, briefs, digests, Ask answers) stores `source_refs` (`capture:<id>`, `item:<id>`, `project:<id>`, `event:<id>`, `pm:<id>`) and the most restrictive scope of its sources. Each module exports `purgeRef(db, scope, ref)` returning D1 statements that delete or redact its derived rows for a deleted source; integration wires these into capture/item deletion.
- Frontend: each view is `public/views/<name>.js` exporting `register(kit)` plus `public/views/<name>.css`. The kit (see `app.js`) offers `addRoute`, `addTodayBlock`, `addProjectBlock`, `addMemoryBlock`, `addTopbarButton`, `api`, `h`, `section`, chips, formatters, `writeScope()`. Plain language; no hashes, model names, server health or transcripts in routine flows.
- Logging: ids, states, counts and status codes only. Never user text, tokens, feed URLs, keys or emails.
- Public repo: synthetic fixtures only. Secrets are Worker secrets; config examples use blanks.
- Untrusted content (captures, attachments, ICS, PM exports, model output) never grants authority. Permissions, dates, state transitions and execution stay in deterministic code. Model output is typed-validated and may only cite source ids it was given.

## Scope enforcement (why feature tables are not all in db.js, and what enforces scope)

Purpose for Harrison: seven features can be built today in parallel without seven writers colliding in one 1,700-line file. Cost: SQL lives in a few modules instead of one, so a reviewer cannot audit scope in one place. That cost is paid by making scope an enforced invariant instead of an authoring habit:

1. `tests/scope-sweep.test.mjs` (lead-owned, runs in CI): every table outside a short system allowlist must have `scope TEXT NOT NULL CHECK (scope IN ('work','personal'))`; and every registered route, read from the router itself (core and feature), is called as a work-scope request with every seeded personal id substituted into its path, and must not return the personal canary. New routes and tables are covered automatically. Mutation-checked: an injected search leak and an unscoped table both fail it.
2. Per-feature canary tests (in each track brief) for paths a route sweep cannot see: provider prompts (fake fetch captures the outbound body), MCP tool results, cron jobs, derived-data deletion, exports.
3. A18 is marked passed only when 1 and every 2 are green on the integrated main.

A shared scoped-DB wrapper was considered; it would need SQL rewriting or parsing to guarantee anything and would not catch a leak assembled in JS after the query. The sweep checks the observable output, which is what a leak is.

## Tracks (each owns exactly the files listed; nothing else)

| Track | Owns | Burden removed for Harrison | Acceptance |
|---|---|---|---|
| T1 Core completion | `src/db.js`, `src/api.js` core handlers, `src/interpret.js`, `src/today.js`, `migrations/0002`, `public/app.js` core screens, `public/index.html`, `public/styles.css`, core tests | Recurring chores without duplicate overdue piles; defer without losing hard dates; photo/attachment capture; restore after a lost phone or bad import; editable preferences; decisions with options/assumptions/reconsider trigger | A1, A4, A5, A7, A12, A20 |
| T2 Ask + AI + resume briefs | `src/ask.js`, `src/ai.js`, `migrations/0003`, `public/views/ask.*` | One place to ask "what was I doing / what's next" with only in-scope sources; return after a week without cleanup | A8, A14, A18 (Ask), A19 |
| T3 Drafts + claim check | `src/drafts.js`, `src/claims.js`, `migrations/0004`, `public/views/drafts.*` | Professional emails/updates/handoffs from rough facts without the draft silently promising things | A13 |
| T4 Calendar (read-only ICS) | `src/calendar.js`, `src/ics.js`, `migrations/0005`, `public/views/calendar.*` | Real fixed commitments on Today; private events show as busy in Work | A7, A15, A18 |
| T5 PM digest | `src/pm.js`, `migrations/0006`, `public/views/pm.*` | Company project status in one source-linked, freshness-aware summary without touching the PM app | A15 |
| T6 MCP | `src/mcp.js`, `src/auth.js`, `migrations/0008`, MCP docs/tests, `public/views/connections.*` | Use Harrison OS from an AI client safely, read-first, scope-bound | A16, A18, A19 |
| T7 Weekly review | `src/review.js`, `migrations/0007`, `public/views/weekly.*` | A short weekly pass that shows what changed and what is due, without inventing obligations | A17 |

Integration owner (lead): `src/features.js`, `src/http.js`, `public/views/index.js`, `public/sw.js`, CI, PLAN/PROGRESS/ACCEPTANCE, e2e runner, deletion wiring, README/deploy runbook.
