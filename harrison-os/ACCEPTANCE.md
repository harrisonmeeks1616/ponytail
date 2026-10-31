# Acceptance status (BUILD_HANDOFF.md section 7)

Labels are not interchangeable: **implemented** (code exists), **locally verified** (unit/API or local browser test passed on this checkout, commit named), **integrated** (on main with the other slices), **deployed** (hosted Worker), **device verified** (real iPhone), **proven in use** (pilot). A blocked case names its exact prerequisite.

Current evidence commit `13abde8` (all eight tracks merged): 365/365 unit, 11/11 local browser, 16/16 preview walkthrough. Baseline commit `c9cf526`: 207/207 unit, 11/11 local browser (F1-F10, X1) rerun 10:58-11:05 EDT on this cloud checkout. Imported historical reports are not counted.

| ID | Status | Evidence (commit, test) | Remaining / blocked on |
|---|---|---|---|
| A1 | locally verified (text + attachments API) | F1; core-api attachments tests; preview walkthrough step 1 (`13abde8`) | real-phone acknowledgement time; photo capture UI on a real phone |
| A2 | locally verified (browser) | baseline F2 + outbox tests | installed-iPhone offline scenario (device) |
| A3 | locally verified (simulated expiry) | baseline auth tests, F-series auth hooks | real Access login on installed app (deploy + device) |
| A4 | locally verified | tests/core-interpret.test.mjs (correction 12->14/Fri->Thu, possibility = idea, other person's promise = Waiting); preview: mentioned dates shown, never filed as commitments | |
| A5 | locally verified | tests/core-api.test.mjs (recurrence without piles, defer, delete, undo); F3/F10; preview steps 2 | |
| A6 | locally verified | db/today tests, F10 | |
| A7 | locally verified | today tests (plain-English why; deferred task off Today while hard date stays); preview step 2 defer toast 'Due date unchanged' | real calendar events (sample only) |
| A8 | locally verified (synthetic) | tests/ask.test.mjs 7-day-gap brief; F8; preview step 4 (week away -> one thing to start with -> project resume); tests/prefill.test.mjs | longitudinal real use |
| A9 | implemented; local push receiver only | webpush/api tests | named live route: deployed Worker + real iPhone locked-phone observation |
| A10 | locally verified (deterministic DST fixtures) | time/dates tests | real Nov 1 phone observation (device, needs deploy today) |
| A11 | locally verified (pending ack retained) | outbox tests | real notification tap after expiry (device) |
| A12 | locally verified | F5, F7; decision details + preferences tests (core-api) | |
| A13 | locally verified | tests/claims.test.mjs (requested->confirmed with same names/numbers, quantity, actor, omitted condition, certainty); drafts tests | real drafts from real notes |
| A14 | implemented, fake-provider verified | tests/ai.test.mjs, tests/ask.test.mjs (shape, timeout, cancel, retries, invented-ref fallback) | blocked: no AI_API_KEY; work-text consent decision is Harrison's |
| A15 | implemented, locally verified with labelled samples/imports | tests/calendar.test.mjs, tests/ics.test.mjs, tests/pm.test.mjs | blocked: no real ICS link; no PM digest source authorization |
| A16 | implemented, server verified | tests/mcp.test.mjs (401/403 matrix, allowlist, scope errors, capture off by default) | real MCP client run; deploy + Access service token |
| A17 | locally verified | tests/review.test.mjs | real weekly use |
| A18 | partial | `tests/scope-sweep.test.mjs`: schema invariant; route completeness (every route has a fixture or a stated exemption); per-route own-scope 2xx + canary-present and work-scope no-canary over seeded personal records, mutation-checked (leak, validation-stopped, empty seed each fail). Covers core + weekly routes on `f67c1f2`+ | not passed until: fixtures for T1a/T2/T3/T4/T5 routes land with them, and each feature's non-HTTP canary (AI prompt body, MCP tool results [done in tests/mcp.test.mjs], jobs, derived deletion, export) is green on integrated main |
| A19 | locally verified (Ask, MCP) | injection tests in tests/ask.test.mjs and tests/mcp.test.mjs: row counts unchanged | drafts/attachments injection case not separately tested |
| A20 | locally verified | tests/core-restore.test.mjs round trip; delete + tombstone; scope-sweep derived deletion (draft removed with its item) | restore of a real export file on a phone |
| A21 | partial | F9 (390px, 0 console/CSP errors); preview walkthrough at 390x844, 0 console errors; T1b reduced-motion/zoom work | real phone, VoiceOver, 200% zoom audit |
| A22 | in progress | app isolated in harrison-os/; root `test` job was already red at seed c9cf526 (114 fail, identical before and after) | final diff/resource/privacy inspection |
| A23 | in progress | path-scoped CI job added | deploy runbook, guarded resources; actual deploy needs Cloudflare account steps |
