# Progress log (America/New_York)

Times are actual clock or commit times (`git log`, author date converted to EDT). Planned times live only in PLAN.md.

- 10:55 Starting head `c9cf526` on `harrisonmeeks1616/ponytail` main. Read AGENTS.md, BUILD_HANDOFF.md (full), IMPORT_NOTES.md.
- ~10:57 Unit baseline 207/207 on this checkout (Node 22.23, node:sqlite).
- ~10:59 Browser baseline 11/11 after `node scripts/gen-vapid.mjs` (local `.dev.vars`, git-ignored). Chrome headless 390x844 via `channel: 'chrome'`.
- 11:00:32 commit `c294824` M0 seams: `src/http.js` (shared helpers), `src/features.js` (feature routes), pre-numbered migrations 0002-0008, `public/views/*` registry with kit, sw cache v5, path-scoped `.github/workflows/harrison-os.yml`. PLAN.md / ACCEPTANCE.md created.

## Decisions

- Feature modules plug in through registries instead of editing api.js/app.js so seven tracks can run in parallel without merge conflicts. Cost: one small seam each side.
- Feature modules may own SQL for their own tables (relaxes "db.js only" for new tables); core-table writes still go through db.js.
- CI uses the runner's preinstalled Google Chrome via Playwright `channel: 'chrome'`; no browser download.
- 11:05:59 commit `5a69126` track briefs (`docs/build/TRACKS.md`); about 11:06 four workflows launched: T1a+T1b, T2+T3, T4+T5, T6+T7, each implement (own worktree) -> independent adversarial review -> fix.
- 11:07:46 commit `b2276d4` README (fresh checkout), docs/DEPLOY.md, docs/PHONE_TEST.md, e2e `E2E_CHROME_PATH` override.
- 11:09:50 commit `0fd281e` (this log). Observed shortly before: new `harrison-os` CI job green on `5a69126` (unit + browser on a hosted runner). Root `test` job red with 114 fail / 40 cancelled; reproduced identically on the untouched seed `c9cf526` locally (319 pass / 114 fail / 40 cancelled), failures in toolkit/field-app tests (e.g. tests/schwab-sync.test.js). Pre-existing, outside harrison-os; left alone per the handoff (do not change separate field apps). Flagged for Harrison.
- ~11:20 Codex checkpoint. Earlier entries in this log had invented later times (11:20/11:35/11:45/11:50); corrected to commit times. Added `tests/scope-sweep.test.mjs` (enforced scope invariant, see PLAN.md "Scope enforcement"); mutation-checked: an injected search leak and an unscoped table both fail it. PHONE_TEST step 4/6 now app-only session expiry; P0 DST check now has a real pre- and post-transition firing.

## Root CI baseline comparison (exact)

| Commit | `node --test tests/*.test.js` (root toolkit) |
|---|---|
| `c9cf526` seed (before any Harrison OS work) | 473 tests: 319 pass, 114 fail, 40 cancelled |
| `0fd281e` | 473 tests: 319 pass, 114 fail, 40 cancelled |

The repository as a whole is not green; only the `harrison-os` job is.

## Integration log (actual times)

- ~11:27 T6+T7 workflow finished (implement -> review -> fix). Merged `hos/T6-fix`, `hos/T7-fix`. Integration fixes: MCP allowlist test derives contract tools from the real modules (get_weekly_review is live); static SQL test names the table-owning modules from PLAN. 243/243 unit, 11/11 browser. `f67c1f2` on main.
- ~11:29 Codex: sweep counted validation errors as coverage. Rewrote `tests/scope-sweep.test.mjs`: per-route fixtures or stated exemptions (completeness test fails on a new route), own-scope 2xx + canary present, work-scope no canary. Mutation-checked (leak, validation-stopped, empty seed). `46e30a2`.
- ~11:31 Merged `hos/T2-fix` (Ask/AI/briefs), `hos/T5-fix` (PM digest); completeness test caught their unfixtured routes as designed; fixtures added. ~11:33 merged `hos/T3-fix` (drafts/claims) + fixtures; merged `hos/T4-fix` (calendar) + fixtures (work view must return personal events busy-only). 320/320 unit, 11/11 browser. `208c00d` on main.
- Waiting on: T1a (core backend) and T1b (core UI) review/fix stages.

## Usage-limit risk (Codex 11:29: weekly usage at 75%)

- The meter is not visible from inside this session; absolute headroom is unknown. Three completed workflows used roughly 1 M subagent tokens each.
- Mitigation: no further workflows or fan-out. Remaining work (T1 merge, deletion/cron wiring, remaining fixtures, cross-slice e2e, acceptance evidence) is done by the lead in bounded steps, each pushed to main only when unit + browser are green, so a hard stop leaves main coherent and recorded.
- Dropped: the planned M3 adversarial-review workflow. Assurance instead comes from the per-track independent reviews already run and the mutation-checked scope sweep. This reduces review depth, not product scope.
- If capped: last green main is the delivery; PROGRESS/ACCEPTANCE name what remains; resume after the reset (Mon Nov 2, 6 PM per Codex) or continue from this record.
- ~11:40 T1a merged (conflict in the static SQL test resolved to the explicit allowlist); purgers and connector cron jobs wired; flaky calendar tie-break fixed. ~11:43 T1b merged. All eight tracks on main `8672286`: 364/364 unit, 11/11 browser.

## Owner preview checkpoint (Harrison's 11:36 direction)

- 11:36-11:55 Built an in-browser preview: the real app and Worker code on the official SQLite WASM build (FTS5), fictional data, published through the repository's existing GitHub Pages site into a new `docs/harrison-os-demo/` folder (no Field/PM files touched). Walked the owner path at 390px and fixed what it exposed (plain-English Next, Next falls back to the saved place, Save my place prefill, mentioned date on Waiting review cards, labelled Ask button). `13abde8`: 365/365 unit, 11/11 browser, 16/16 preview steps. Published `ccd9b6e`; GitHub Pages deployment of `ccd9b6e` reported success (github.io is not reachable from this container, so not loaded here).
- Owner handoff: `OWNER_PREVIEW.md` (link, walkthrough, comparison, status, recommendation).

## Sonnet continuation (Saturday 2026-10-31, afternoon)

- Merged `hos/T4-fix` (`923e269`) into the working branch; one conflict in `calendar.js` `onScheduled` ORDER BY resolved to T4-fix's `created_at, id` (unique and deterministic). Calendar and ICS tests 29/29, five repeat runs.
- A20: `src/featuredata.js` exports/restores drafts, calendar, PM and weekly rows (feed URL never exported; tombstone-aware; scope-checked). `tests/feature-restore.test.mjs`.
- A18: export, cron, calendar/PM job and weekly-purge canaries added to the scope sweep; mutation-checked.
- Deploy readiness: blank vars in `wrangler.jsonc`; guard refuses `AI_API_KEY` and `PM_DIGEST_TOKEN` in vars; `tests/deploy-guard.test.mjs`.
- Browser F11-F14 (drafts flag, weekly "Not this week" keeps the due date, calendar Busy-only across scope + PM link, Connections honest states). F13 first failed because the test read the "All" render before the Work render, not because of a leak: the server blanks other-scope titles in SQL.
- UX: "Looks right" no longer silently drops an edit accepted with "Use these"; project next step compares `start_on` with the New York date (db test). The floating Ask pill overlapping a Waiting card was not reproduced at scroll end on Today, Waiting or Tasks at 390x844 (no overlap), so no CSS change.
- Preview wording corrected: typed text stays in the browser (CSP `connect-src 'self'`, no keys in the preview env), but fonts load from Google and GitHub Pages sees the page visit. The preview walkthrough now fails if any other request leaves the origin. Service worker cache bumped to `hos-v6`.
- Results on `4a416f4`: 380/380 unit, 15/15 browser, preview walkthrough passed. Not run: real iPhone, deployed Worker, Access, live AI, real calendar or PM, MCP client.

## Design and links pass (2026-11-01, after midnight Eastern)

- "Panel" theme: slate/navy header band with a safety-amber rule and breaker-style mark, Barlow Condensed headings, IBM Plex Sans body, IBM Plex Mono section labels, light card shadows, amber rail on Next. Palette differs from Electrical PM Mastery (copper). All checked pairs meet WCAG AA in light and dark (lowest 5.62:1).
- Navigation: tab bar is now Today, Waiting, Capture, Projects, Memory (the old layout stretched Memory over an empty-looking slot). Ask moved from a floating pill (which covered cards mid-scroll) into the top bar at every width.
- Clarity: Today's waiting "why" and overdue lines use plain dates ("Wed, Oct 28") instead of ISO dates.
- App links: optional `PM_APP_URL` and `FIELD_APP_URL` (https only) show as one-tap buttons on Today ("Your apps") and as rows in Connections. Links only; no data is read from or written to either app. The deploy guard skips only those two values in its other-project scan (tested). Fixed a startup race found on the way: Today could render before the session (carrying the links) loaded.
- Not done, by decision: running the PM app or Field Hub on the same server as Harrison OS. See OWNER_PREVIEW.md section "One hub?".
- Results: 383/383 unit, 15/15 browser, preview walkthrough passed (0 console errors, only font GETs leave the origin).
- 2026-11-01 palette change at Harrison's request: black header band, field green as the main colour (buttons, active tab, Work chips), safety yellow kept as a sparing signal (header rule, H mark, Next rail). Status-bar colour now black. Every checked pair meets WCAG AA (lowest 5.51:1). Today no longer lists the Next item a second time; when it was the only pick, Today says "Nothing else picked for today." 383/383 unit, 15/15 browser.

## First deployment (Codex, 2026-11-01)

- Codex deployed `f41c677` to a new `harrison-os` Worker with its own new D1 database (8 migrations), owner-only Access (exact-email policy, `OWNER_EMAIL` matching), production VAPID keys, minute cron, PM and Field Hub links only, all dev/test flags 0, normal deploy guard passed. Signed-out root and /api redirect to Access. PM Worker/database, Field Hub and the spike untouched. Details and what is still pending: ACCEPTANCE.md "Deployment status".
- Recorded from Codex's report; the build session cannot reach workers.dev, so it did not verify any of it independently. Real-phone checks remain untested.
- 2026-11-01 production checks (Codex) recorded in ACCEPTANCE.md at their stated scope. Live defect: "null" printed under Title, Notes and Project in Open tasks > Edit. Root cause: `field()` passed a missing hint to the native `form.append()`, which stringifies null. Fixed there (and in the one sibling call in `views/pm.js`); static scan test plus browser F15 added, both shown failing on the old code. 385/385 unit, 16/16 browser.
- 2026-11-01 F15 extended to the decision form (4 "null" texts on the old code, none now). Production cron short sample recorded: 00:51:34Z and 00:52:34Z ok, 3 ms / 6 ms CPU, no exceptions (two runs only).
- 2026-10-31 21:02 EDT: Codex deployed `69bed96` and verified it live (details in ACCEPTANCE.md). Correction to a chat statement of mine: the DST P0 window (create a daily 11:00 PM reminder before 10:55 PM New York) was NOT missed; it was judged from the UTC date. At 21:02 EDT it is still open. Times in these records are New York unless marked Z.
- 2026-11-01: Delete for capture rows in Memory search (existing deleteCapture, optional `after` so it stays on Memory); browser F16; cache hos-v12. 385/385 unit, 17/17 browser. Approved live QA cleanup is Codex's to perform; nothing here touched real records.
- 2026-11-01: owner editors finished (Waiting, notes/ideas, projects, reminders screen + PATCH route), Connections grouped by who owns the data, copy/provenance wording for calendar and PM, "Open Electrical PM" link. The static null check caught one new null child in the Reminders screen before it shipped. 389/389 unit, 18/18 browser. Cache hos-v13.
- 2026-11-01 (Codex, production): approved QA cleanup done (3 QA captures + 1 QA task, deployed delete code via Wrangler D1, audited); real restore of the original All backup: "Nothing new to restore. 2 already here, left as they are. 6 you deleted earlier, not brought back." A20 duplicate-skip and tombstone restore verified in production.
- 2026-11-01: capture autosave races, reminder edit/cron atomicity, Add id reuse, held wording and Connections offline groups fixed (details in ACCEPTANCE.md "Race fixes"). Adversarial review run on the race fixes before release.
- 2026-11-01: second race pass after review: atomic insert for captures and photos (two-tab TOCTOU), restore keeps unstored photos and re-keeps fresh-id drafts, compare-and-delete of the consumed draft, reminder editor version on editable fields only with already-saved detection, 8 s storage timeout. Adversarial review: 6 of 8 findings confirmed and fixed, 1 already fixed, 1 judged unlikely (timeout added defensively). 411/411 unit, 21/21 browser. Cache hos-v16.
- 2026-11-01: release fix for the Add double-tap window (id kept for the form's life), F18 held-reload check; 411/411 unit, 21/21 browser; cache hos-v17. Release candidate for root's deploy.
- 2026-11-01: sibling draft-deletion paths closed (startup discard and empty-box autosave now compare-and-delete the observed/owned draft; no plain drafts.del left). 412/412 unit, 21/21 browser; cache hos-v18.
- 2026-11-01: Save's draft delete now matches the exact own-draft snapshot (id, version, words, scope, file refs); the saved-words shortcut is gone. All three draft deletion sites use the same snapshot. F18 waits for the second POST response. 412/412 unit, 21/21 browser; cache hos-v19.

## Release (Codex, 2026-11-01)

- Deployed exact source `1a3e65e` to the existing harrison-os Worker (version ID in the private release record). Independent 412/412 unit, the stale-draft and simultaneous capture/file reproductions, 21/21 browser; CI run 41264222338 success. Live checks: session build `1a3e65e`, testHooks false; anonymous root/session/`capture-core.js` redirect to Access; shell `hos-v19`; all main screens render with no console warnings or errors; local draft keep/restore/clear check with no server record; Reminders at 393x852 without horizontal overflow (not iPhone evidence); first post-release cron tick ok (3 ms CPU, fired 0, errors 0).
- The core editable app is live with no known code blockers from the bounded reviews. Still open and not commissioned: real iPhone install/push/offline/expiry, AI key and consent, a calendar source, a PM digest endpoint that would first have to be built in Electrical PM (new code outside this repository) and then authorized with a token, Shortcut and MCP service tokens, and any long-run runtime observation.

## Phone commissioning round (2026-10-31 evening New York)

- Added Memory > Alerts "Send a test alert": sends one push now and shows only what the server records (push service accepted, phone beacon arrived, opened by tap), resuming after the tap reloads the app; new owner-only `GET /api/deliveries/:id` (states and times, no text). Browser F21 and a route unit test.
- Added `scripts/service-check.mjs` for root: checks the Shortcut and MCP service tokens from a computer (Shortcut default writes nothing; MCP prints tool names and sizes only; never prints secrets; confirms each token is refused on an owner route). `tests/service-check.test.mjs` runs it against the real Worker routes in-process.
- Rewrote `docs/PHONE_TEST.md`: the stale "tonight" step is replaced by a general DST procedure, and each phone step names its server evidence (events, deliveries) and the observed / server only / not tested labels.
- 416/416 unit, 22/22 browser. Not deployed by this session; nothing observed on a phone yet.
- Optional private PM digest connection (Harrison OS side only): `PM_DIGEST_SERVICE` service binding to `harrison-os-pm-digest`, entrypoint `HarrisonOsDigest`, argumentless `getDigest()` returning the same v1 digest; same 1 MB cap, `normalizeDigest`, 10 s timeout, Work scope, hourly cron claim, kept copy on failure; preferred over the link when both exist; status shows a read only after a real one. Deploy guard accepts exactly that one service entry and refuses every other cross-resource binding. Not in the canonical config, not deployed; no PM code touched. 418/418 unit, 22/22 browser; cache hos-v21.
- Shortcut credential scope enforced by the server: `SHORTCUT_SCOPES` (canonical `work`; unset also Work only; a typo grants nothing; shared parser with `MCP_SCOPES`). Another scope gets 403 `scope_not_allowed` before anything is stored; omitted scope means Work. Owner status reports `shortcut_scopes`; Connections shows it. `service-check.mjs shortcut` now probes the boundary (default expectation Work only) and tells a Worker 403 from an Access refusal. Behaviour change: an omitted scope used to mean Personal. 420/420 unit, 22/22 browser; cache hos-v22. Not deployed.
