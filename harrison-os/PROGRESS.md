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
