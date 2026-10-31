# Deploying Harrison OS

Only Harrison can run these steps: they need his Cloudflare login and Access settings. Nothing here touches the PM or Field Hub Workers, databases or Access apps; `scripts/deploy-guard.mjs` refuses any config that references them.

Real resource IDs stay out of this public repository. Keep them in `wrangler.local.jsonc`, a git-ignored copy of `wrangler.jsonc`, and deploy with `--config wrangler.local.jsonc`.

## One-time setup (about 20 minutes)

1. Sign in and create the app's own database:

   ```bash
   cd harrison-os
   npm ci
   npx wrangler login
   npx wrangler d1 create harrison-os
   cp wrangler.jsonc wrangler.local.jsonc
   ```

   Put the printed `database_id` into `wrangler.local.jsonc`.

2. Apply the schema to the new database:

   ```bash
   npx wrangler d1 migrations apply harrison-os --remote --config wrangler.local.jsonc
   ```

3. Generate the push keys. The public key goes in `vars.VAPID_PUBLIC_KEY` and the private key becomes a secret:

   ```bash
   node scripts/gen-vapid.mjs --force
   ```

   ```bash
   npx wrangler secret put VAPID_PRIVATE_JWK --config wrangler.local.jsonc
   ```

   Paste the single-line `VAPID_PRIVATE_JWK` value from `.dev.vars`. Then run `node scripts/gen-vapid.mjs --force` again, so local dev never reuses the production key.

4. First deploy, before Access exists (the Worker fails closed with 503 until Access is set):

   ```bash
   node scripts/deploy-guard.mjs --pre-access wrangler.local.jsonc
   ```

   ```bash
   npx wrangler deploy --config wrangler.local.jsonc
   ```

   Note the `https://harrison-os.<subdomain>.workers.dev` origin and set `vars.VAPID_SUBJECT` to it.

5. Cloudflare Zero Trust, Access, Applications:
   - **Owner app**: self-hosted, domain = the Worker origin, policy Allow with your email only. Copy its AUD tag to `vars.ACCESS_AUD` and the team URL (`https://<team>.cloudflareaccess.com`) to `vars.ACCESS_TEAM_DOMAIN`.
   - **Shortcut app** (optional): path `/api/shortcut/capture`, policy Service Auth with a new service token. Its AUD goes in `vars.ACCESS_AUD_SHORTCUT`.
   - **MCP app** (optional): path `/api/mcp`, Service Auth with its own service token. Its AUD goes in `vars.ACCESS_AUD_MCP`. Set `vars.MCP_SCOPES` (default `work`) and `vars.MCP_ALLOW_CAPTURE` (`1` to allow capture).

6. Optional secrets, each enabling one connection. Leaving one out only blocks that connection:

   ```bash
   npx wrangler secret put OWNER_EMAIL --config wrangler.local.jsonc
   ```

   ```bash
   npx wrangler secret put AI_API_KEY --config wrangler.local.jsonc
   ```

   ```bash
   npx wrangler secret put PM_DIGEST_TOKEN --config wrangler.local.jsonc
   ```

   `AI_API_KEY` is an Anthropic API key, which is not a chat subscription. Work text is never sent to the model until "Allow work text" is switched on in Memory > Ask with AI. `PM_DIGEST_URL` (var) plus `PM_DIGEST_TOKEN` enable the live PM digest; without them, use the import. The deploy guard refuses a config that puts `AI_API_KEY` or `PM_DIGEST_TOKEN` under `vars`; they are secrets only.

7. Guarded deploy:

   ```bash
   node scripts/deploy-guard.mjs wrangler.local.jsonc
   ```

   ```bash
   npx wrangler deploy --config wrangler.local.jsonc
   ```

## Every later deploy

```bash
npm test
```

```bash
npx wrangler d1 migrations apply harrison-os --remote --config wrangler.local.jsonc
```

```bash
node scripts/deploy-guard.mjs wrangler.local.jsonc && npx wrangler deploy --config wrangler.local.jsonc
```

## Backups and restore

- Memory > Export downloads a JSON file per scope (records, relationships, attachments, preferences). Memory > Restore merges such a file back: it never overwrites newer rows and never brings back deleted items.
- D1 Time Travel restores the whole database to a minute in the last 30 days: `npx wrangler d1 time-travel restore harrison-os --timestamp <ISO> --config wrangler.local.jsonc`. That is the disaster path; it also brings back anything deleted since then.

## Operating cost and limits

The cron runs every minute and does bounded work per run: at most 3 reminder sends, one calendar refresh and one PM refresh. Hosted CPU was sampled in the earlier spike, not guaranteed. When Workers Free limits are reached, Cloudflare rejects requests: captures stay in the phone's outbox and reminders are late, never silently dropped. No numeric budget setting exists.
