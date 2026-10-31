// The deploy guard: the checked-in config passes, and secrets placed in vars are refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkConfig } from '../scripts/deploy-guard.mjs';

const cfgText = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const withVar = (name) => cfgText.replace('"vars": {', `"vars": {\n "${name}": "x",`);

test('checked-in config has no errors except the documented placeholders', () => {
  const { errors } = checkConfig(cfgText, { preAccess: true });
  assert.deepEqual(errors, ['d1 binding DB: database_id is still the all-zero placeholder; Harrison creates the harrison-os database first']);
});

test('every secret is refused when placed in vars', () => {
  for (const name of ['VAPID_PRIVATE_JWK', 'OWNER_EMAIL', 'AI_API_KEY', 'PM_DIGEST_TOKEN']) {
    const { errors } = checkConfig(withVar(name), { preAccess: true });
    assert.ok(errors.some((e) => e.includes(`vars.${name}`)), name);
  }
});

test('new blank vars are present and safe by default', () => {
  const vars = JSON.parse(cfgText.replace(/^\s*\/\/.*$/gm, '')).vars;
  assert.equal(vars.MCP_SCOPES, 'work');
  assert.equal(vars.MCP_ALLOW_CAPTURE, '0');
  for (const k of ['ACCESS_AUD_MCP', 'AI_MODEL', 'AI_TIMEOUT_MS', 'PM_DIGEST_URL']) assert.equal(vars[k], '', k);
});
