# Harrison OS: continuation handoff (builder model transition)

Written Saturday October 31, 2026, about 12:10 PM Eastern, at Harrison's request so a Sonnet session can continue and preserve usage. Self-contained: do not rely on chat memory, private machines or Windows paths. Everything referenced is in this repository.

## 0. Resume here

1. Fresh checkout of `harrisonmeeks1616/ponytail`, branch `main`; app is `harrison-os/`. Read root `AGENTS.md` (applies to you), then this file, then `harrison-os/ACCEPTANCE.md`.
2. Run the setup in section 1 and confirm the baseline numbers below before changing anything.
3. Start with the checklist in section 6, item 1.

Monitoring: one focused review by Codex around 1:30 PM Eastern, then pause. The old 15-minute check loop is obsolete.

## 1. Repository state and setup

| What | Value |
|---|---|
| Repository | `harrisonmeeks1616/ponytail` (public) |
| Destination | `main` (direct fast-forward pushes are allowed and have been used all day; no force pushes, no history rewrites) |
| `main` head when this was written | `8d7c250` (this handoff commit sits on top of it) |
| Cloud working branch | `claude/relaxed-darwin-k6znwr`, same commits as `main` |
| Seed (imported app snapshot) | `c9cf526` |
| App directory | `harrison-os/` (everything else in the repo is the Ponytail toolkit and the separate Field/PM apps: leave it alone) |
| Published preview folder | `docs/harrison-os-demo/` (generated; see section 5) |
| App CI | `.github/workflows/harrison-os.yml`, path-scoped; last run on `8d7c250`: success (run 41217274058) |

**Not on `main`, preserved on GitHub:** branch `hos/T4-fix` at `923e269` ("bounded ICS expansion, cron claim, deterministic cron order"). It is the calendar track's final reviewed fix commit and was committed after the T4 merge. Merge it first (section 6, item 1). Every other track branch (`hos/T1a` … `hos/T7`, `hos/*-fix`) is fully contained in `main`. Local worktrees from the build (`.claude/worktrees/wf_*`, `/tmp/hos-fix-T*`) hold nothing uncommitted except `node_modules` symlinks; they are disposable and are not in a fresh checkout.

Fresh-checkout setup (Node 22 or later, Google Chrome for browser checks):

```bash
cd harrison-os && npm ci && npm test
```

```bash
node scripts/gen-vapid.mjs && npm install --no-save playwright@1 && npm run e2e
```

```bash
npm run demo:build && npm run demo:check
```

`gen-vapid.mjs` writes throwaway keys and loopback-only test flags to `.dev.vars` (git-ignored). If Chrome is missing, set `E2E_CHROME_PATH` to a Chromium binary. Expected at `13abde8` and later: **365/365 unit, 11/11 browser workflows, 16/16 preview steps, 0 console errors.**

### Document map (read the ones your task touches)

| File | Purpose |
|---|---|
| `BUILD_HANDOFF.md` | The full product assignment: scope of Slices 1-3, privacy/authority rules, the 23 acceptance cases. Still the spec. |
| `IMPORT_NOTES.md` | What the seed snapshot is and is not. |
| `PLAN.md` | Architecture rules, track ownership, the scope-enforcement rationale. |
| `PROGRESS.md` | Timestamped log with commits, integration notes, usage-risk record, root CI baseline comparison. |
| `ACCEPTANCE.md` | Status and evidence per acceptance case A1-A23. Keep it current. |
| `OWNER_PREVIEW.md` | Harrison-facing: preview link, 5-minute walkthrough, app comparison, recommendation. |
| `README.md` | Fresh checkout, layout. |
| `docs/DEPLOY.md` | Cloudflare deploy runbook (Harrison's login required). |
| `docs/PHONE_TEST.md` | Real-iPhone check batch, including tonight's DST check and app-only token revocation. |
| `docs/API-core.md` | Core API (items, recurrence, defer, delete, attachments, preferences, restore). |
| `docs/AI.md`, `DRAFTS.md`, `CALENDAR.md`, `PM_DIGEST.md`, `MCP.md`, `WEEKLY_REVIEW.md`, `SHORTCUT.md`, `UI.md` | One per feature: contract, limits, what is unverified. |
| `docs/build/TRACKS.md` | The briefs the eight build tracks worked from (cross-module contracts live here). |

### Code map

- `src/worker.js` entry. `src/api.js` core routes and the cron (`runScheduled`). `src/http.js` shared HTTP helpers. `src/features.js` registers feature modules: routes, `PURGERS` (wired into `db.DERIVED_PURGERS`) and `SCHEDULED` (calendar/PM refresh, run from the cron).
- `src/db.js` the only writer of core tables. Feature modules own their own tables: `ask.js`/`ai.js` (Ask, provider adapter, resume briefs), `drafts.js`/`claims.js`, `calendar.js`/`ics.js`, `pm.js`, `review.js`, `mcp.js`. `src/auth.js` Access JWT verification and route authorization. `src/interpret.js`, `src/today.js`, `src/time.js`, `src/dates.js`, `src/webpush.js`.
- `migrations/0001`-`0008` (D1, applied in order).
- `public/` PWA: `app.js` core screens plus a small kit; `views/*.js` feature views (`ask`, `drafts`, `calendar`, `pm`, `weekly`, `connections`); `sw.js`; `outbox-core.js`, `idb.js`.
- `demo/` preview-only sources (boot, D1-on-SQLite-WASM adapter, banner); `scripts/build-demo.mjs` assembles `docs/harrison-os-demo/`.
- `tests/*.test.mjs` (node:test, in-memory D1 via `tests/helpers/d1.mjs`), `tests/e2e/run.mjs` (wrangler dev + Chrome), `tests/e2e/demo-walk.mjs` (preview walkthrough).

## 2. Product direction (current, from Harrison)

- Harrison wants something he can **use and judge**, and evidence on whether a third app is worth it. Decision taken today: one coherent experience with distinct responsibilities, **not** a three-codebase merger.
- **PM app** (separate Cloudflare Worker, source not in this repo, not inspected) stays the office/project system of record. **Field app / Hub** (`docs/schwab/`, Google Apps Script hub) stays the crew/job/timekeeping system of record. Do not modify, deploy, migrate, reset or read their data or resources. Harrison OS links to them; it never stores crew hours or duplicates official job records.
- **Harrison OS** is the personal command center: capture in seconds, Today with one explained Next, Waiting-on with honest status, Save my place and resume after interruptions, across work and personal life with enforced Work/Personal scopes.
- All built Slices 1-3 capabilities stay: they are real code with tests, not a mockup. The browser preview is a way to try the real code, not a replacement for it.
- Recommendation already given to Harrison (`OWNER_PREVIEW.md` section 6): continue narrowly; pause new connectors until daily use is proven; criteria that would change it are listed there.

## 3. Inventory against the acceptance matrix

Labels: **implemented**, **locally verified** (unit/API or local browser on a named commit), **integrated** (on `main`), **deployed**, **device verified**, **proven in use**. Nothing is deployed, device verified or proven in use. Full evidence per case: `ACCEPTANCE.md`.

| Area | Status | Where | Gaps / blocked |
|---|---|---|---|
| Capture, outbox, draft recovery, idempotent retry, 410 for deleted-capture retries (A1, A2) | locally verified, integrated | `public/outbox-core.js`, `src/api.js`, F1/F2, outbox tests | real iPhone offline/close/reopen (device) |
| Auth: Access JWT, per-request JWKS fetch with timeout, never a shared in-flight promise; owner/Shortcut/MCP audiences separated (A3) | locally verified | `src/auth.js`, `tests/auth.test.mjs` | real Access login and expiry on installed app; use per-application "Revoke existing tokens" only (`docs/PHONE_TEST.md` step 4) |
| Interpretation: corrections supersede, ideas stay ideas, others' promises are Waiting (A4) | locally verified | `src/interpret.js`, `tests/core-interpret.test.mjs` | deterministic patterns: phrasing outside them falls back to review (e.g. "he said by Tuesday" shows as a mentioned date, not a promise) |
| Task lifecycle, recurrence without overdue piles, defer, delete, undo (A5) | locally verified | `src/db.js`, `tests/core-api.test.mjs`, preview | |
| Waiting: who, actual promised date, follow-up, "No reply recorded" (A6) | locally verified | | mailbox never checked: wording must stay "No reply recorded" |
| Today: explained Next in plain English, hard dates kept, saved-place fallback (A7) | locally verified | `src/today.js`, `tests/today.test.mjs` | calendar events on Today are sample-only |
| Save my place, welcome-back, resume briefs (A8) | locally verified (synthetic 7/8-day gap) | `src/db.js` `checkpointPrefill`, `src/ask.js` `buildResumeBrief`, `tests/prefill.test.mjs` | longitudinal use |
| Reminders and push: intent vs schedule vs provider acceptance vs observed alert; outcome-unknown for stalled sends; dedupe; quiet hours (A9, A11) | implemented, local push receiver only | `src/api.js` cron, `src/webpush.js` | **no real alert observed**: API/push acceptance is not delivery; needs deploy + iPhone |
| Time: wall-clock daily reminders across DST, date-only stays date-only (A10) | locally verified (deterministic fixtures) | `src/time.js`, `tests/time.test.mjs` | real Nov 1 observation: daily 11 PM reminder created before 10:55 PM tonight (`docs/PHONE_TEST.md` P0) or label "post-transition first fire only" |
| Memory, decisions with options/assumptions/supersession, preferences (A12) | locally verified | | |
| Drafts and claim check (A13) | locally verified | `src/claims.js`, `tests/claims.test.mjs` | a tripwire, not proof: deterministic cue words; cannot catch every invented commitment (documented in `docs/DRAFTS.md`) |
| AI provider adapter and Ask (A14) | implemented, fake-provider verified | `src/ai.js`, `src/ask.js` | **blocked**: no `AI_API_KEY`; per-scope consent defaults off and is Harrison's decision. No-key path answers labelled "Not AI. Matched from your saved records." Never present fixtures as AI. Default model id is configuration (`AI_MODEL`). |
| Calendar (read-only ICS) and PM digest (A15) | implemented, locally verified with labelled samples/imports | `src/calendar.js`, `src/ics.js`, `src/pm.js` | **blocked**: no real ICS link; no authorized PM digest source. `hos/T4-fix` (bounded expansion) not yet merged; T4 measured 60-110 ms CPU for a 2 MB feed in Node, above the Workers Free 10 ms budget |
| MCP (A16) | implemented, server verified | `src/mcp.js`, `tests/mcp.test.mjs` | no real client run; needs deploy + Access service token (`docs/MCP.md`) |
| Weekly review (A17) | locally verified | `src/review.js` | real weekly use |
| Scope through every output (A18) | **partial, not passed** | see section 3a | |
| Injection cannot trigger privileged actions (A19) | locally verified for Ask and MCP | `tests/ask.test.mjs`, `tests/mcp.test.mjs` | no separate drafts/attachment-text injection case |
| Delete, export, restore (A20) | locally verified for core tables | `tests/core-restore.test.mjs`, scope-sweep derived deletion | **gap**: `exportData`/restore cover core tables only; drafts, calendar, PM and weekly-review rows are not exported or restored |
| Phone/desktop usability, accessibility (A21) | partial | F9, preview at 390 px | real phone, VoiceOver, 200% zoom audit |
| Toolkit and other apps preserved (A22) | in progress | app isolated; root `test` job failing before and after identically | final diff/privacy inspection |
| Fresh checkout and deploy (A23) | partial | README, CI, `docs/DEPLOY.md` | `wrangler.jsonc` lacks new vars; deploy guard secret list incomplete (section 6) |

Semantics that must be preserved in any change: local intent vs pending sync vs confirmed vs provider-accepted vs observed vs acknowledged; source quote, actor, timestamps and claim statuses (requested, proposed, confirmed, reported complete, verified, unspecified) never auto-upgrade; date-only values stay date-only and hard dates are never silently moved; Work/Personal scope on every row and output, `all` read-only; deleted content cannot be resurrected by a late retry or restore; Shortcut identity reaches only `POST /api/shortcut/capture`, MCP identity only `/api/mcp`, MCP capture off unless `MCP_ALLOW_CAPTURE=1` and never auto-accepted.

### 3a. Review items carried forward (Codex), and what was actually fixed

| Item | Status | Where |
|---|---|---|
| Feature SQL outside db.js needs an enforced scope invariant | **fixed** | `tests/scope-sweep.test.mjs` schema test; static SQL allowlist in `tests/db.test.mjs` |
| Sweep must not count validation errors as coverage | **fixed** | per-route fixtures; own-scope request must be 2xx (or a stated expected status like `409 import_source`) |
| Own-scope success, cross-scope negative, populated tables | **fixed** for core, Ask, briefs, drafts, PM, calendar, attachments, preferences, restore, weekly review | personal canary seeded in projects, items, captures, checkpoints, reminders, drafts, PM import, ICS import, attachment, preference; reads must contain it; work requests must not |
| Registry completeness (new route without fixture fails) | **fixed** | `completeness` test; exemptions listed with reasons (`EXEMPT`) |
| Mutation check that the sweep can fail | **done** | injected search leak, unscoped table, validation-stopped and empty-seed cases all failed it (PROGRESS.md) |
| AI prompt canary | **fixed** | `tests/ask.test.mjs` (fake fetch captures outbound prompt) |
| MCP output canary | **fixed** | `tests/mcp.test.mjs` |
| Derived deletion | **partly fixed** | drafts removed with their item (`scope-sweep` test); weekly selections purge exists (`review.js purgeRef`) but has no end-to-end test |
| Jobs (cron) canary | **not done** | calendar/PM `onScheduled` and reminder push payloads have no personal-canary test |
| Export canary for feature tables | **not applicable yet** | feature tables are not exported (A20 gap) |
| A18 marked passed | **no** | pass only when the two "not done" rows above are done |

## 4. Tests, commits and results

| Commit | Result | Where |
|---|---|---|
| `c9cf526` seed | 207/207 unit, 11/11 browser (rerun here) | PROGRESS.md |
| `13abde8` | 365/365 unit, 11/11 browser, 16/16 preview | local runs, PROGRESS.md |
| `ccd9b6e` | app CI success (unit + browser + preview), Pages deploy success | GitHub Actions runs 41217140388 and 41217140268 |
| `8d7c250` | app CI success | run 41217274058 |

Known failure, **not caused by this work**: root `test` job (Ponytail toolkit and field-app tests, e.g. `tests/schwab-sync.test.js`): 473 tests, 319 pass, 114 fail, 40 cancelled, identical at `c9cf526` and `0fd281e`. The repository as a whole is not green; only the `harrison-os` job is. Do not touch those tests or apps to "fix" CI.

Commands: `npm test` (unit), `npm run e2e` (browser; `E2E_ONLY=F1,F2` for a subset), `npm run demo:build && npm run demo:check` (preview), `node --test tests/scope-sweep.test.mjs` (scope invariant).

## 5. The preview

- URL: https://harrisonmeeks1616.github.io/ponytail/harrison-os-demo/ (GitHub Pages, served from `docs/` on `main`, the same site as the Field app; own folder only).
- Build: `npm run demo:build` copies `public/`, `src/`, `migrations/` and `demo/` into `docs/harrison-os-demo/`, swaps the CSP to allow `'wasm-unsafe-eval'` and points the page at `demo/boot.js`. Boot opens the official SQLite WASM build (`@sqlite.org/sqlite-wasm`, FTS5) in localStorage, applies the real migrations, routes the app's `/api` fetches to the real Worker code in the page, and seeds fictional sample data (Maple Street clinic, Jordan Example, all `sample: 1`).
- **Whenever app code changes, rebuild and commit `docs/harrison-os-demo/`, run `npm run demo:check` first.** The published copy is currently built from `13abde8`.
- Simulated or local-only: no sign-in, no sync between devices, no offline queue (the server runs in the tab), no service worker, no push or reminder alerts, no AI model, calendar and company projects are labelled samples. "Skip ahead a week" only moves `last_open_at` back eight days.
- Was it opened? Verified in headless Chrome at 390 x 844 from a local server with the same path layout (16/16 steps, 0 console errors) and in GitHub CI. The live github.io URL was **not opened** from the build environment (its network blocks github.io); GitHub reported the Pages deployment successful. Harrison has not yet reported opening it.
- Walkthrough: `OWNER_PREVIEW.md` section 2.

Never verified anywhere: a real iPhone (install, offline, locked-screen alert, notification tap after expiry, DST), a Cloudflare deployment, Access login, the iOS Shortcut, a live AI call, a real calendar feed, the PM app, an MCP client.

## 6. Next actions, in order

Keep each step small, run the relevant tests, update `ACCEPTANCE.md`/`PROGRESS.md` with real times and commits, push to `main` only when green.

1. **Merge `hos/T4-fix` (`923e269`).** Expect a conflict in `src/calendar.js` around the `onScheduled` `ORDER BY` (main added `created_at, rowid` as a tie-break; T4-fix adds its own deterministic order and a cron claim): keep T4-fix's logic plus a deterministic tie-break. Run `node --test tests/calendar.test.mjs tests/ics.test.mjs` several times (the old test was order-flaky), then the full suite.
2. **A20 export/restore for feature tables.** Add drafts, calendar connections (never the feed URL), calendar events, PM sources/records and weekly reviews to `exportData` and restore in `src/db.js`, or export them from their modules and have the export route merge them. Scope-filtered, tombstone-aware, round-trip test like `tests/core-restore.test.mjs`. Then add the work-export canary for those tables to `tests/scope-sweep.test.mjs`.
3. **A18 remaining canaries.** In `tests/scope-sweep.test.mjs` or feature tests: cron jobs (`runScheduled` with a personal reminder never puts personal text into a work-scoped output; calendar/PM `onScheduled` touch only their own rows) and an end-to-end weekly-selection purge after item delete. Only then mark A18 passed.
4. **Deploy readiness without deploying.** Add blank `ACCESS_AUD_MCP`, `MCP_SCOPES` (`work`), `MCP_ALLOW_CAPTURE` (`0`), `AI_MODEL`, `AI_TIMEOUT_MS`, `PM_DIGEST_URL` to `wrangler.jsonc` vars with comments; add `AI_API_KEY` and `PM_DIGEST_TOKEN` to the deploy guard's forbidden-in-vars secret list (`scripts/deploy-guard.mjs` line ~163) and its test; update `docs/DEPLOY.md` if names differ.
5. **Browser coverage for Slice 2/3 views** in `tests/e2e/run.mjs` (one scenario each, sample data): drafts claim flag visible, weekly review "Not this week" leaves due date, calendar sample on Today shows Busy for the other scope, PM sample digest link, Connections card states. Keep the run under 15 minutes.
6. **Small UX defects seen in the preview:** the floating "Ask" pill can cover the corner of the Waiting card (`public/views/ask.css`, add bottom padding or move it); "Looks right" is a toggle, so tapping it after "Use these" un-accepts (consider making "Use these" leave the choice explicit and saying so); project `nextItem` compares `start_on` with the UTC date (`src/db.js`, `ponytail:` comment).
7. **Rebuild and republish the preview** after 1-6 (`npm run demo:build`, `npm run demo:check`, commit `docs/harrison-os-demo/`), then verify the Pages deployment run.
8. **Prepare, do not perform, Harrison's steps** (one message, batched): Cloudflare deploy per `docs/DEPLOY.md`; tonight's DST reminder (needs the deploy first); phone batch `docs/PHONE_TEST.md`; decisions on an Anthropic API key and whether work text may be sent; an ICS link if wanted; PM digest source authorization or an export file. Record results only when observed.

## 7. Usage and working style

- Usage is constrained (weekly limit was about 75% used around 11:30 AM; reset reported for Monday November 2, 6 PM). Do not start workflows or parallel agents. Work in one session, read only the files a step needs (this map is meant to make that cheap), and run focused tests (`node --test tests/<file>`) before the full suite.
- Never fake evidence: fixtures and headless Chrome are not device, deployment, AI, calendar or PM proof.
- Public repository: no secrets, populated `.dev.vars`/`wrangler.local.jsonc`, real captures, real names, emails, account or resource ids. Synthetic fixtures only.
- Do not change the application's AI-provider configuration because the builder model changed.
- The Opus builder session stopped after committing this file.

## 8. Status after the Sonnet session (2026-10-31, afternoon)

Section 6 items 1 to 7 are done and recorded in `PROGRESS.md` and `ACCEPTANCE.md`; item 8 (Harrison's steps) is in the final message of that session. Still open: everything labelled device, deployed or blocked in section 3.
