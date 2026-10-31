# Harrison OS

A personal capture, follow-through and resumption app: **Today, Projects, Memory**, with Capture everywhere and a contextual Ask drawer. One Cloudflare Worker (static PWA + `/api`), one D1 database, Cloudflare Access for sign-in, Web Push for reminders.

This directory is independent of the Ponytail toolkit in the rest of the repository. Assignment: `BUILD_HANDOFF.md`. Plan and contracts: `PLAN.md`. Status per acceptance case: `ACCEPTANCE.md`. Log: `PROGRESS.md`.

## Fresh checkout

Needs Node 22 or later (tests use `node:sqlite`) and, for browser workflows, Google Chrome.

```bash
cd harrison-os
npm ci
npm test
```

Browser workflows (local Worker via `wrangler dev --local`, headless Chrome at 390x844):

```bash
node scripts/gen-vapid.mjs
npm install --no-save playwright@1
npm run e2e
```

`gen-vapid.mjs` writes throwaway keys and loopback-only test flags to `.dev.vars` (git-ignored). If Google Chrome is not installed, set `E2E_CHROME_PATH` to any Chromium binary. `E2E_ONLY=F1,F2` runs a subset.

Local app for manual use:

```bash
npx wrangler d1 migrations apply harrison-os --local
npm run dev
```

Then open http://127.0.0.1:8899. The unauthenticated dev identity works only on loopback.

## Layout

- `src/worker.js` entry; `src/api.js` core routes and the reminder cron; `src/http.js` shared HTTP helpers; `src/features.js` registers the Slice 2/3 modules (`ask`, `ai`, `drafts`, `claims`, `calendar`, `ics`, `pm`, `review`, `mcp`).
- `src/db.js` is the only writer of core tables. Feature modules own their own tables.
- `migrations/` D1 schema, applied in order.
- `public/` the PWA: `app.js` core screens, `views/*.js` feature views registered through a small kit, `sw.js` shell cache and push.
- `tests/` node:test unit/API tests; `tests/e2e/run.mjs` browser workflows.
- `docs/` deploy runbook, phone test batch, and per-feature notes.

## Deploying

See `docs/DEPLOY.md`. Deployment needs Harrison's Cloudflare login and Access configuration; nothing in this repository contains account identifiers or secrets.
