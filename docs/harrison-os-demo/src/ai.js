// The one AI provider adapter: Claude through the Anthropic Messages API (POST /v1/messages).
//
// Raw fetch, not the SDK: this is a Cloudflare Worker with no runtime dependencies, and one bounded call
// needs nothing the SDK adds. Configuration is Worker secrets/vars only:
//   AI_API_KEY      secret. Unset or blank = "not set up" (aiConfigured false); nothing is ever sent.
//   AI_MODEL        optional model id. Default DEFAULT_MODEL.
//   AI_TIMEOUT_MS   optional overall deadline per call, clamped to 2000..30000. Default 20000.
//
// Rules: one attempt plus at most one retry on 429/529/5xx inside the same deadline; the caller's
// AbortSignal is honoured; https only; response size capped; model output is typed-validated by the
// caller. Logs carry states, codes and durations only: never prompts, responses or the key.
// Each call builds its own fetch: no in-flight promise is shared across requests (see src/auth.js).

import * as db from './db.js';
import { clampInt } from './http.js';

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2026-10-21';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_TIMEOUT_MS = 20000;
export const MAX_RESPONSE_CHARS = 200_000;
const MAX_PROMPT_CHARS = 120_000;
const RETRY_STATUSES = new Set([429, 529]);
const RETRY_DELAY_MS = 800;
const MODEL_RE = /^[a-z0-9][a-z0-9.@:_-]{1,99}$/i;
const SCOPES = new Set(['work', 'personal']);

export function aiConfigured(env) {
  return !!env && typeof env.AI_API_KEY === 'string' && env.AI_API_KEY.trim().length > 0;
}

export function aiModel(env) {
  const m = env && typeof env.AI_MODEL === 'string' ? env.AI_MODEL.trim() : '';
  return MODEL_RE.test(m) ? m : DEFAULT_MODEL;
}

export function aiTimeoutMs(env) {
  return clampInt(env && env.AI_TIMEOUT_MS, { min: 2000, max: 30000, fallback: DEFAULT_TIMEOUT_MS });
}

// ---------------------------------------------------------------- consent
// Stored through db.js's kv helpers (key ai_consent:<scope>, value JSON { allowed, updated_at }): src/db.js
// stays the only module that runs SQL (tests/db.test.mjs enforces it). No row = not allowed.

const CONSENT_KEY = 'ai_consent:';

/** True only when the owner explicitly allowed sending this scope's text to the provider. Default false. */
export async function aiConsent(DB, scope) {
  if (!SCOPES.has(scope)) return false;
  try {
    return JSON.parse(await db.kvGet(DB, CONSENT_KEY + scope, Date.now())).allowed === true;
  } catch {
    return false;
  }
}

export async function consentState(DB) {
  return { work: await aiConsent(DB, 'work'), personal: await aiConsent(DB, 'personal') };
}

export async function setAiConsent(DB, scope, allowed, nowIso) {
  if (!SCOPES.has(scope)) throw new TypeError('scope must be work or personal');
  await db.kvPut(DB, CONSENT_KEY + scope, JSON.stringify({ allowed: allowed === true, updated_at: nowIso }));
}

// ---------------------------------------------------------------- the call

function log(entry) {
  console.log(JSON.stringify({ evt: 'ai_call', ...entry }));
}

function wait(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

function textOf(body) {
  if (!body || !Array.isArray(body.content)) return null;
  const parts = body.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
  return parts.length ? parts.join('') : null;
}

/**
 * complete(env, { system, prompt, maxTokens, timeoutMs, signal, expectJson, schema, fetchImpl })
 * -> { ok: true, text, data?, model } | { ok: false, reason, status? }
 * reason: 'not_configured' | 'timeout' | 'cancelled' | 'provider_error' | 'invalid_output'.
 * expectJson parses the text as JSON into data (invalid_output when it isn't); schema, when given, is sent
 * as output_config.format so the provider constrains the shape (the caller still validates it).
 */
export async function complete(env, opts = {}) {
  const { system = '', prompt, maxTokens = 2048, signal, expectJson = false, schema = null } = opts;
  if (!aiConfigured(env)) return { ok: false, reason: 'not_configured' };
  if (typeof prompt !== 'string' || !prompt || prompt.length > MAX_PROMPT_CHARS || String(system).length > MAX_PROMPT_CHARS) {
    return { ok: false, reason: 'invalid_output' };
  }
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const timeoutMs = opts.timeoutMs ? clampInt(opts.timeoutMs, { min: 1, max: 30000, fallback: DEFAULT_TIMEOUT_MS }) : aiTimeoutMs(env);
  const model = aiModel(env);
  const started = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onCancel = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onCancel, { once: true });
  }
  const stopReason = () => (timedOut ? 'timeout' : 'cancelled');
  const body = {
    model,
    max_tokens: clampInt(maxTokens, { min: 64, max: 8192, fallback: 2048 }),
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: 'low', ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
  };
  if (system) body.system = system;
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.AI_API_KEY.trim(), 'anthropic-version': API_VERSION },
    body: JSON.stringify(body),
    signal: controller.signal,
  };
  let attempts = 0;
  const run = async () => {
    for (;;) {
      if (controller.signal.aborted) return { ok: false, reason: stopReason() };
      attempts++;
      let res;
      try {
        res = await fetchImpl(API_URL, init);
      } catch {
        if (controller.signal.aborted) return { ok: false, reason: stopReason() };
        return { ok: false, reason: 'provider_error', status: 0 };
      }
      if (!res.ok) {
        const retryable = RETRY_STATUSES.has(res.status) || res.status >= 500;
        try { await res.body?.cancel(); } catch { /* ignore */ }
        if (retryable && attempts === 1 && timeoutMs - (Date.now() - started) > RETRY_DELAY_MS + 1000) {
          await wait(RETRY_DELAY_MS, controller.signal);
          continue;
        }
        return { ok: false, reason: 'provider_error', status: res.status };
      }
      const declared = Number(res.headers.get('content-length') || '0');
      if (declared > MAX_RESPONSE_CHARS) return { ok: false, reason: 'invalid_output', status: res.status };
      let raw;
      try {
        raw = await res.text();
      } catch {
        if (controller.signal.aborted) return { ok: false, reason: stopReason() };
        return { ok: false, reason: 'provider_error', status: res.status };
      }
      if (raw.length > MAX_RESPONSE_CHARS) return { ok: false, reason: 'invalid_output', status: res.status };
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { ok: false, reason: 'invalid_output', status: res.status };
      }
      // A refusal or a cut-off answer is not a usable answer.
      if (parsed && (parsed.stop_reason === 'refusal' || parsed.stop_reason === 'max_tokens')) return { ok: false, reason: 'invalid_output', status: res.status };
      const text = textOf(parsed);
      if (!text || !text.trim()) return { ok: false, reason: 'invalid_output', status: res.status };
      const out = { ok: true, text, model: typeof parsed.model === 'string' ? parsed.model : model };
      if (expectJson) {
        try {
          out.data = JSON.parse(text);
        } catch {
          return { ok: false, reason: 'invalid_output', status: res.status };
        }
      }
      return out;
    }
  };
  let result;
  try {
    result = await run();
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onCancel);
  }
  log({ ok: result.ok, reason: result.reason || null, status: result.status ?? null, attempts, ms: Date.now() - started });
  return result;
}
