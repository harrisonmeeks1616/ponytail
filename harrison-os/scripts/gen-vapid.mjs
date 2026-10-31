#!/usr/bin/env node
// Generates local VAPID keys for Harrison OS and writes them into .dev.vars (git-ignored).
//   node scripts/gen-vapid.mjs           keep existing keys and flags, fill in anything missing
//   node scripts/gen-vapid.mjs --force   replace the keys and reset the local flags
// Prints only the public key. The private JWK goes to .dev.vars and nowhere else.
// For production, Harrison runs `wrangler secret put VAPID_PRIVATE_JWK` himself.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const devVarsPath = join(root, '.dev.vars');
const force = process.argv.includes('--force');

const LOCAL_DEFAULTS = {
  VAPID_SUBJECT: 'http://127.0.0.1:8899',
  DEV_ALLOW_UNAUTH: '1',
  SPIKE_TEST_HOOKS: '1',
  ALLOW_TEST_PUSH_ENDPOINT: '1',
};

function parseValue(raw) {
  const v = raw.trim();
  if (v.length >= 2 && ((v[0] === "'" && v.endsWith("'")) || (v[0] === '"' && v.endsWith('"')))) return v.slice(1, -1);
  return v;
}

// Keeps every existing line (comments included) and its order; returns key -> line index too.
function readDevVars() {
  if (!existsSync(devVarsPath)) return { lines: [], index: new Map(), values: new Map() };
  const lines = readFileSync(devVarsPath, 'utf8').replace(/\r\n/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const index = new Map();
  const values = new Map();
  lines.forEach((line, i) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m) {
      index.set(m[1], i);
      values.set(m[1], parseValue(m[2]));
    }
  });
  return { lines, index, values };
}

function setVar(state, key, line) {
  if (state.index.has(key)) {
    state.lines[state.index.get(key)] = line;
  } else {
    state.index.set(key, state.lines.length);
    state.lines.push(line);
  }
}

function warnIfNotIgnored() {
  try {
    const gi = readFileSync(join(root, '.gitignore'), 'utf8');
    if (!gi.split(/\r?\n/).some((l) => l.trim() === '.dev.vars')) {
      console.warn('gen-vapid: warning: .dev.vars is not listed in .gitignore');
    }
  } catch {
    console.warn('gen-vapid: warning: no .gitignore found; make sure .dev.vars is never committed');
  }
}

async function main() {
  const webpushUrl = pathToFileURL(join(root, 'src', 'webpush.js')).href;
  const { generateVapidKeys } = await import(webpushUrl);

  const state = readDevVars();
  const hasPublic = !!state.values.get('VAPID_PUBLIC_KEY');
  const hasPrivate = !!state.values.get('VAPID_PRIVATE_JWK');

  if (!force && hasPublic !== hasPrivate) {
    console.error('gen-vapid: .dev.vars has only one of VAPID_PUBLIC_KEY / VAPID_PRIVATE_JWK. Re-run with --force to replace both.');
    process.exit(1);
  }

  let publicKey;
  let generated = false;
  if (force || !hasPublic) {
    const keys = await generateVapidKeys();
    publicKey = keys.publicKey;
    const jwkLine = JSON.stringify(keys.privateJwk);
    if (jwkLine.includes("'") || jwkLine.includes('\n')) throw new Error('unexpected characters in JWK');
    setVar(state, 'VAPID_PUBLIC_KEY', `VAPID_PUBLIC_KEY=${publicKey}`);
    setVar(state, 'VAPID_PRIVATE_JWK', `VAPID_PRIVATE_JWK='${jwkLine}'`);
    generated = true;
  } else {
    publicKey = state.values.get('VAPID_PUBLIC_KEY');
  }

  for (const [key, value] of Object.entries(LOCAL_DEFAULTS)) {
    if (force || !state.values.has(key)) setVar(state, key, `${key}=${value}`);
  }

  writeFileSync(devVarsPath, state.lines.join('\n') + '\n', { encoding: 'utf8' });
  warnIfNotIgnored();

  console.log(generated ? 'gen-vapid: wrote new VAPID keys to .dev.vars' : 'gen-vapid: kept existing VAPID keys (use --force to replace)');
  console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
}

main().catch((err) => {
  console.error(`gen-vapid: failed: ${err && err.message}`);
  process.exit(1);
});
