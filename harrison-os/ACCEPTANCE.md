# Acceptance status (BUILD_HANDOFF.md section 7)

Labels are not interchangeable: **implemented** (code exists), **locally verified** (unit/API or local browser test passed on this checkout, commit named), **integrated** (on main with the other slices), **deployed** (hosted Worker), **device verified** (real iPhone), **proven in use** (pilot). A blocked case names its exact prerequisite.

Current evidence: the design-and-links commit after `0df24e7` (2026-11-01, Node 22, Chromium 153 headless): 383/383 unit, 15/15 local browser (F1-F14, X1), preview walkthrough all steps passed with 0 console errors and only Google-font GETs leaving the origin. Previous: `4a416f4` 380/380, 15/15. Earlier: `13abde8` 365/365 unit, 11/11 browser, 16/16 preview (that commit only, not reused as evidence for later changes). Baseline commit `c9cf526`: 207/207 unit, 11/11 local browser (F1-F10, X1) rerun 10:58-11:05 EDT on this cloud checkout. Imported historical reports are not counted.

## Deployment status (reported by Codex, 2026-11-01; not independently verified from the build session, whose network cannot reach workers.dev)

- Deployed from `f41c677` (383/383 unit tests rerun by Codex) to a new Worker named `harrison-os` on Harrison's Cloudflare account (`harrison-os.<account-subdomain>.workers.dev`; the exact address, Worker version ID, database ID and Access IDs are kept out of this public repository).
- Own new D1 database `harrison-os`, all 8 migrations applied. Minute cron configured. Production VAPID key pair separate from local keys.
- Owner-only Cloudflare Access application using the existing exact-email policy; `OWNER_EMAIL` matches it. Signed-out requests to the root and `/api` redirect to Access (Codex observation).
- Dev/test flags (`DEV_ALLOW_UNAUTH`, `SPIKE_TEST_HOOKS`, `ALLOW_TEST_PUSH_ENDPOINT`) all `0`; normal (not `--pre-access`) deploy guard passed.
- `PM_APP_URL` and `FIELD_APP_URL` set as links only. The PM Worker and database, the Field Hub and the old spike were not deployed or modified.
- Not configured: AI API key, calendar, live PM digest, iPhone Shortcut, MCP.
- **Pending:** first authenticated sign-in (Harrison's emailed code) and an authenticated save. Until that is observed, nothing below moves past "deployed".
- **Untested on a real iPhone:** install, push alert, offline queue, session expiry. Not passed.

| ID | Status | Evidence (commit, test) | Remaining / blocked on |
|---|---|---|---|
| A1 | locally verified (text + attachments API) | F1; core-api attachments tests; preview walkthrough step 1 (`13abde8`) | real-phone acknowledgement time; photo capture UI on a real phone |
| A2 | locally verified (browser) | baseline F2 + outbox tests | installed-iPhone offline scenario (device) |
| A3 | locally verified (simulated expiry); deployed behind owner-only Access (reported: signed-out root and /api redirect to Access) | baseline auth tests, F-series auth hooks | real Access login on installed app (deploy + device) |
| A4 | locally verified | tests/core-interpret.test.mjs (correction 12->14/Fri->Thu, possibility = idea, other person's promise = Waiting); preview: mentioned dates shown, never filed as commitments | |
| A5 | locally verified | tests/core-api.test.mjs (recurrence without piles, defer, delete, undo); F3/F10; preview steps 2 | |
| A6 | locally verified | db/today tests, F10 | |
| A7 | locally verified | today tests (plain-English why; deferred task off Today while hard date stays); preview step 2 defer toast 'Due date unchanged' | real calendar events (sample only) |
| A8 | locally verified (synthetic) | tests/ask.test.mjs 7-day-gap brief; F8; preview step 4 (week away -> one thing to start with -> project resume); tests/prefill.test.mjs | longitudinal real use |
| A9 | implemented; local push receiver only | webpush/api tests | named live route: deployed Worker + real iPhone locked-phone observation |
| A10 | locally verified (deterministic DST fixtures) | time/dates tests | real Nov 1 phone observation (device, needs deploy today) |
| A11 | locally verified (pending ack retained) | outbox tests | real notification tap after expiry (device) |
| A12 | locally verified | F5, F7; decision details + preferences tests (core-api) | |
| A13 | locally verified | browser F11 (flag shown, tripwire wording); tests/claims.test.mjs (requested->confirmed with same names/numbers, quantity, actor, omitted condition, certainty); drafts tests | real drafts from real notes |
| A14 | implemented, fake-provider verified | tests/ai.test.mjs, tests/ask.test.mjs (shape, timeout, cancel, retries, invented-ref fallback) | blocked: no AI_API_KEY; work-text consent decision is Harrison's |
| A15 | implemented, locally verified with labelled samples/imports | tests/calendar.test.mjs, tests/ics.test.mjs (incl. `hos/T4-fix` bounded expansion + cron claim, merged), tests/pm.test.mjs; browser F13 (other scope's events show Busy only; PM link opens the company system in a new tab) | blocked: no real ICS link; no PM digest source authorization |
| A16 | implemented, server verified | tests/mcp.test.mjs (401/403 matrix, allowlist, scope errors, capture off by default) | real MCP client run; deploy + Access service token |
| A17 | locally verified | tests/review.test.mjs | real weekly use |
| A18 | locally verified (HTTP, export, jobs, derived deletion) | `tests/scope-sweep.test.mjs` on `4a416f4`: schema invariant; route completeness; per-route own-scope 2xx + canary-present / work-scope no-canary (mutation-checked); NEW: export canary for drafts, calendar, PM and weekly rows (personal export has them, work export has none); cron canary (a due personal reminder fires; work reminders, work export, event log and work Today carry no personal text); calendar and PM `onScheduled` touch only their own rows and keep connection scope; weekly selections and deferrals are purged end to end when the item is deleted. Mutation check: unscoping the feature export and disabling the weekly purge both fail the suite (6 tests). AI prompt and MCP output canaries already in ask/mcp tests | Not a proof of every future route: new routes need a fixture (completeness test enforces it). Push payload text cannot be inspected (encrypted in transit); only stored outputs are checked |
| A19 | locally verified (Ask, MCP) | injection tests in tests/ask.test.mjs and tests/mcp.test.mjs: row counts unchanged | drafts/attachments injection case not separately tested |
| A20 | locally verified (core and feature tables) | `tests/core-restore.test.mjs` (core); NEW `tests/feature-restore.test.mjs` + `src/featuredata.js`: drafts, calendar connections and events, PM sources and records, weekly reviews are exported (scope-filtered; calendar feed URL never exported) and restored insert-only; drafts citing deleted records are skipped, deleted refs are scrubbed from weekly reviews, other-scope and orphan rows are rejected; link-based calendars come back as `link_not_restored` (re-add the link) and the cron skips them | Deleting a draft, calendar connection or PM source leaves no tombstone, so restoring an older export re-adds one deleted afterwards (documented `ponytail:` ceiling). Restore of a real export file on a phone |
| A21 | partial | F9 (390px, 0 console/CSP errors); preview walkthrough at 390x844, 0 console errors; T1b reduced-motion/zoom work | real phone, VoiceOver, 200% zoom audit |
| A22 | in progress | app isolated in harrison-os/; root `test` job was already red at seed c9cf526 (114 fail, identical before and after) | final diff/resource/privacy inspection |
| A23 | deployed (reported by Codex, 2026-11-01) | path-scoped CI; `wrangler.jsonc` vars and guard as before; new Worker + new D1 (8 migrations) deployed from `f41c677` with the normal deploy guard passing; private config git-ignored, no real IDs committed | authenticated save on the deployed app not yet observed; real-phone install |
