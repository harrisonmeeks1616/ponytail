# Acceptance status (BUILD_HANDOFF.md section 7)

Labels are not interchangeable: **implemented** (code exists), **locally verified** (unit/API or local browser test passed on this checkout, commit named), **integrated** (on main with the other slices), **deployed** (hosted Worker), **device verified** (real iPhone), **proven in use** (pilot). A blocked case names its exact prerequisite.

Baseline commit `c9cf526`: 207/207 unit, 11/11 local browser (F1-F10, X1) rerun 10:58-11:05 EDT on this cloud checkout. Imported historical reports are not counted.

| ID | Status | Evidence (commit, test) | Remaining / blocked on |
|---|---|---|---|
| A1 | locally verified (text); attachments not yet implemented | baseline F1, api tests | T1 attachments; real-phone acknowledgement time |
| A2 | locally verified (browser) | baseline F2 + outbox tests | installed-iPhone offline scenario (device) |
| A3 | locally verified (simulated expiry) | baseline auth tests, F-series auth hooks | real Access login on installed app (deploy + device) |
| A4 | locally verified (interpretation) | interpret tests, F1 | correction-supersedes adversarial set (T1) |
| A5 | partial | F3, db tests | recurrence, defer, archive/search UI pass (T1) |
| A6 | locally verified | db/today tests, F10 | |
| A7 | partial | today tests | calendar events on Today (T4), override evidence |
| A8 | partial (synthetic 8-day return view) | F8 | resume briefs (T2); longitudinal evidence later |
| A9 | implemented; local push receiver only | webpush/api tests | named live route: deployed Worker + real iPhone locked-phone observation |
| A10 | locally verified (deterministic DST fixtures) | time/dates tests | real Nov 1 phone observation (device, needs deploy today) |
| A11 | locally verified (pending ack retained) | outbox tests | real notification tap after expiry (device) |
| A12 | partial | F5, F7 | preferences editing, decision options/assumptions (T1) |
| A13 | not started | | T3 |
| A14 | not started | | T2; live run needs an API key and work-text consent decision |
| A15 | not started | | T4/T5; live needs a real ICS URL and PM source authorization |
| A16 | not started | | T6; real client interoperability separate |
| A17 | not started | | T7 |
| A18 | partial | scope-canary tests, F5 | Ask, drafts, calendar, digest, MCP canary paths |
| A19 | not started | | injection case across Ask/drafts/MCP |
| A20 | partial (delete + export) | F6, db tests | restore path, attachments, outbox-retry resurrection test (T1) |
| A21 | partial (390px, 0 console/CSP errors) | F9 | 360-430px, 200% zoom, reduced motion, screen-reader labels audit; real phone |
| A22 | in progress | root CI untouched; app isolated in harrison-os/ | final diff/resource/privacy inspection |
| A23 | in progress | path-scoped CI job added | deploy runbook, guarded resources; actual deploy needs Cloudflare account steps |
