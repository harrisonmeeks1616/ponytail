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
