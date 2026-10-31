# Progress log (America/New_York)

- 10:55 Starting head `c9cf526` on `harrisonmeeks1616/ponytail` main. Read AGENTS.md, BUILD_HANDOFF.md (full), IMPORT_NOTES.md.
- 10:58 Unit baseline 207/207 on this checkout (Node 22.23, node:sqlite).
- 11:05 Browser baseline 11/11 after `node scripts/gen-vapid.mjs` (local `.dev.vars`, git-ignored). Chrome headless 390x844 via `channel: 'chrome'`.
- 11:20 M0 seams: `src/http.js` (shared helpers), `src/features.js` (feature routes), pre-numbered migrations 0002-0008, `public/views/*` registry with kit, sw cache v5, path-scoped `.github/workflows/harrison-os.yml`. PLAN.md / ACCEPTANCE.md created.

## Decisions

- Feature modules plug in through registries instead of editing api.js/app.js so seven tracks can run in parallel without merge conflicts. Cost: one small seam each side.
- Feature modules may own SQL for their own tables (relaxes "db.js only" for new tables); core-table writes still go through db.js.
- CI uses the runner's preinstalled Google Chrome via Playwright `channel: 'chrome'`; no browser download.
- 11:35 Track briefs committed (`docs/build/TRACKS.md`, `5a69126`). Four workflows launched: T1a+T1b, T2+T3, T4+T5, T6+T7, each implement (own worktree) -> independent adversarial review -> fix.
- 11:45 README (fresh checkout), docs/DEPLOY.md, docs/PHONE_TEST.md, e2e `E2E_CHROME_PATH` override (`b2276d4`).
- 11:50 GitHub: new `harrison-os` CI job green on `5a69126` (unit + browser on a hosted runner). Root `test` job red with 114 fail / 40 cancelled; reproduced identically on the untouched seed `c9cf526` locally (319 pass / 114 fail / 40 cancelled), failures in toolkit/field-app tests (e.g. tests/schwab-sync.test.js). Pre-existing, outside harrison-os; left alone per the handoff (do not change separate field apps). Flagged for Harrison.
