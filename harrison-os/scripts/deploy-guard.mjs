#!/usr/bin/env node
// Deploy guard for Harrison OS (Slice 1 and later). Adapted from the spike's guard. Run before any
// `wrangler deploy`:
//   node scripts/deploy-guard.mjs [--pre-access] [path/to/wrangler.jsonc]
// Exits 1 (and prints every reason) unless the config is unmistakably the isolated harrison-os Worker
// with real Access settings and no local-only flags. It never contacts Cloudflare.
// It refuses any reference to electrical-pm, field-hub or the harrison-os-spike Worker/database.
// --pre-access is only for a first deploy before the Access app exists: empty ACCESS_TEAM_DOMAIN /
// ACCESS_AUD become warnings; every other check stays fatal.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const EXPECTED_NAME = 'harrison-os';
export const PLACEHOLDER_DB_ID = '00000000-0000-4000-8000-000000000000';
// Sanitized snapshot placeholder. Keep existing-resource names forbidden; configure any extra private ID guard outside source.
const SPIKE_DB_ID = '11111111-1111-4111-8111-111111111111';
export const FORBIDDEN_REFERENCES = [
  'harrison-electrical-pm',
  'electrical-pm',
  'electrical_pm',
  'field-hub',
  'field_hub',
  'harrison-os-spike',
  'harrison_os_spike',
  SPIKE_DB_ID,
];
const OTHER_CONFIG_FILES = ['wrangler.json', 'wrangler.toml'];

// Removes // and /* */ comments outside strings, then trailing commas outside strings.
// String contents (including "https://..." values) are copied untouched.
export function stripJsonc(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === '"') break;
        j++;
      }
      if (j >= n) throw new SyntaxError('unterminated string in JSONC');
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && next === '/') {
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i++;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new SyntaxError('unterminated block comment in JSONC');
      out += ' ';
      i = end + 2;
    } else {
      out += c;
      i++;
    }
  }
  // Trailing commas: a comma followed only by whitespace and then } or ], outside strings.
  let result = '';
  i = 0;
  const m = out.length;
  while (i < m) {
    const c = out[i];
    if (c === '"') {
      let j = i + 1;
      while (j < m) {
        if (out[j] === '\\') {
          j += 2;
          continue;
        }
        if (out[j] === '"') break;
        j++;
      }
      result += out.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === ',') {
      let k = i + 1;
      while (k < m && /\s/.test(out[k])) k++;
      if (out[k] === '}' || out[k] === ']') {
        i++;
        continue;
      }
    }
    result += c;
    i++;
  }
  return result;
}

export function parseJsonc(text) {
  return JSON.parse(stripJsonc(text.replace(/^﻿/, '')));
}

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

// Returns { errors: string[], warnings: string[] }. errors.length === 0 means deploy may proceed.
// { preAccess: true } turns only the missing ACCESS_TEAM_DOMAIN / ACCESS_AUD errors into warnings.
export function checkConfig(rawText, { preAccess = false } = {}) {
  const errors = [];
  const warnings = [];

  const lower = rawText.toLowerCase();
  for (const ref of FORBIDDEN_REFERENCES) {
    if (lower.includes(ref)) errors.push(`config references "${ref}"; harrison-os must not touch other projects`);
  }

  let cfg;
  try {
    cfg = parseJsonc(rawText);
  } catch (err) {
    errors.push(`wrangler.jsonc does not parse: ${err.message}`);
    return { errors, warnings };
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    errors.push('wrangler.jsonc is not an object');
    return { errors, warnings };
  }

  if (cfg.name !== EXPECTED_NAME) errors.push(`name must be exactly "${EXPECTED_NAME}" (found ${JSON.stringify(cfg.name)})`);
  if (cfg.env !== undefined) errors.push('named environments ("env") are not allowed; they can override the checked settings');
  if (cfg.main !== 'src/worker.js') errors.push(`main must be "src/worker.js" (found ${JSON.stringify(cfg.main)})`);

  const dbs = Array.isArray(cfg.d1_databases) ? cfg.d1_databases : [];
  if (dbs.length === 0) errors.push(`d1_databases must declare the ${EXPECTED_NAME} database`);
  if (dbs.length > 1) errors.push('d1_databases must declare exactly one database');
  for (const db of dbs) {
    const label = db && db.binding ? `d1 binding ${db.binding}` : 'd1 database';
    if (!db || db.database_name !== EXPECTED_NAME) {
      errors.push(`${label}: database_name must be "${EXPECTED_NAME}" (found ${JSON.stringify(db && db.database_name)})`);
    }
    const id = db && db.database_id;
    if (!nonEmpty(id)) {
      errors.push(`${label}: database_id is empty`);
    } else if (id.trim().toLowerCase() === PLACEHOLDER_DB_ID || /^[0-]+$/.test(id.replace(/4000-8000/, '0000-0000'))) {
      errors.push(`${label}: database_id is still the all-zero placeholder; Harrison creates the ${EXPECTED_NAME} database first`);
    }
  }

  const vars = cfg.vars && typeof cfg.vars === 'object' ? cfg.vars : {};
  // --pre-access: a first deploy may run before the Access app exists, so the two
  // Access values can't be known yet. They become warnings; the Worker fails closed (503 not_configured)
  // until they are set. Every other check stays fatal.
  const accessIssues = preAccess ? warnings : errors;
  const preNote = preAccess ? ' (allowed by --pre-access; /api answers 503 not_configured until it is)' : '';
  if (!nonEmpty(vars.ACCESS_TEAM_DOMAIN)) {
    accessIssues.push(`vars.ACCESS_TEAM_DOMAIN must be set (https://<team>.cloudflareaccess.com)${preNote}`);
  }
  if (!nonEmpty(vars.ACCESS_AUD)) accessIssues.push(`vars.ACCESS_AUD must be set (the Access application AUD tag)${preNote}`);
  if (String(vars.DEV_ALLOW_UNAUTH ?? '').trim() === '1') errors.push('vars.DEV_ALLOW_UNAUTH must not be "1" for a deploy');
  if (String(vars.SPIKE_TEST_HOOKS ?? '').trim() === '1') errors.push('vars.SPIKE_TEST_HOOKS must not be "1" for a deploy');
  if (String(vars.ALLOW_TEST_PUSH_ENDPOINT ?? '').trim() === '1') {
    errors.push('vars.ALLOW_TEST_PUSH_ENDPOINT must not be "1" for a deploy');
  }
  for (const secret of ['VAPID_PRIVATE_JWK', 'OWNER_EMAIL']) {
    if (vars[secret] !== undefined) errors.push(`vars.${secret} must not be in wrangler.jsonc; set it with wrangler secret put`);
  }

  if (nonEmpty(vars.ACCESS_TEAM_DOMAIN) && !/^https:\/\//i.test(vars.ACCESS_TEAM_DOMAIN.trim())) {
    warnings.push('vars.ACCESS_TEAM_DOMAIN does not start with https://');
  }
  if (!nonEmpty(vars.VAPID_PUBLIC_KEY)) warnings.push('vars.VAPID_PUBLIC_KEY is empty; push routes will answer push_not_configured');
  if (!nonEmpty(vars.VAPID_SUBJECT) || !/^https:\/\//i.test(vars.VAPID_SUBJECT.trim())) {
    warnings.push('vars.VAPID_SUBJECT should be the Worker\'s own https:// origin; pushes fail until it is');
  }

  return { errors, warnings };
}

function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const root = resolve(scriptDir, '..');
  const args = process.argv.slice(2);
  const preAccess = args.includes('--pre-access');
  const unknownFlags = args.filter((a) => a.startsWith('--') && a !== '--pre-access');
  if (unknownFlags.length) {
    console.error(`deploy-guard: REFUSED. Unknown option(s): ${unknownFlags.join(', ')}`);
    process.exit(1);
  }
  const positional = args.filter((a) => !a.startsWith('--'));
  const configPath = positional[0] ? resolve(positional[0]) : join(root, 'wrangler.jsonc');
  const errors = [];
  if (!existsSync(configPath)) {
    console.error(`deploy-guard: REFUSED. ${configPath} does not exist.`);
    process.exit(1);
  }
  const configDir = dirname(configPath);
  for (const other of OTHER_CONFIG_FILES) {
    if (existsSync(join(configDir, other))) errors.push(`${other} exists next to wrangler.jsonc; wrangler could read it instead`);
  }
  const result = checkConfig(readFileSync(configPath, 'utf8'), { preAccess });
  errors.push(...result.errors);
  for (const w of result.warnings) console.warn(`deploy-guard: warning: ${w}`);
  if (errors.length) {
    console.error('deploy-guard: REFUSED.');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `deploy-guard: OK${preAccess ? ' (pre-Access)' : ''}. ${configPath} is the isolated ${EXPECTED_NAME} Worker.` +
      (preAccess ? ' Rerun without --pre-access once ACCESS_TEAM_DOMAIN and ACCESS_AUD are set.' : ''),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
