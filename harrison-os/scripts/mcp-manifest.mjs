#!/usr/bin/env node
// The exact MCP tools/list answers, per access mode, generated from src/mcp.js (the code that serves them), for
// a client or bridge manifest. node scripts/mcp-manifest.mjs prints it; --write saves docs/MCP_MANIFEST.json.
// tests/mcp-full.test.mjs fails if the saved file differs from what the code serves.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listTools, defaultGrant, instructionsFor, PROTOCOL_VERSIONS, SERVER_INFO } from '../src/mcp.js';

export function manifest() {
  const owner = (mode, scopes) => ({ mode, scopes, capture: mode === 'full', set_by: 'owner', updated_at: null });
  const modes = [
    ['default', 'No grant saved yet: the deployment default (MCP_SCOPES unset = work, MCP_ALLOW_CAPTURE unset = no capture_text).', defaultGrant({})],
    ['off', 'Owner chose Off.', owner('off', [])],
    ['read', 'Owner chose Read only (scopes shown: work; personal or both list the same tools, the grant decides which scope answers).', owner('read', ['work'])],
    ['full', 'Owner chose Full (scopes shown: work; personal or both list the same tools, the grant decides which scope answers).', owner('full', ['work'])],
  ];
  return {
    generated_from: 'src/mcp.js (scripts/mcp-manifest.mjs)',
    endpoint: 'POST /api/mcp (JSON-RPC 2.0, Streamable HTTP, JSON responses only)',
    protocol_versions: PROTOCOL_VERSIONS,
    server_info: SERVER_INFO,
    notes: [
      'The grant is read on every tools/list and tools/call; a call in a scope outside the grant is a tool error before anything runs.',
      'Every tool takes exactly one scope, work or personal; all is never accepted.',
      "Ask's Full mode offers the same tools (name, description, input_schema) to the model, under Ask's own owner grant.",
    ],
    modes: Object.fromEntries(modes.map(([name, meaning, g]) => [name, { meaning, grant: { mode: g.mode, scopes: g.scopes }, instructions: instructionsFor(g), tools: listTools({}, undefined, g) }])),
    // Added to the read or full list above only when env.PM_COMMANDS_SERVICE is bound AND Harrison's cross-app
    // grant allows that client the action (and the grant includes Work). Writes need Full. docs/CROSS_APP_ACTIONS.md.
    cross_app: {
      meaning: 'Electrical PM (and Field Hub through PM) tools: listed per action only when the private PM command connection is bound and the owner cross-app grant allows it; read actions under Read only or Full, writes under Full.',
      tools: listTools({ PM_COMMANDS_SERVICE: { execute() {} } }, undefined, owner('full', ['work']), () => true).filter((t) => /^(pm|field)_/.test(t.name)),
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = `${JSON.stringify(manifest(), null, 2)}\n`;
  if (process.argv.includes('--write')) writeFileSync(new URL('../docs/MCP_MANIFEST.json', import.meta.url), text);
  else process.stdout.write(text);
}
