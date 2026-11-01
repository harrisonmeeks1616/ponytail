// The one AI provider adapter: Claude through the Anthropic Messages API (POST /v1/messages).
//
// Raw fetch, not the SDK: this is a Cloudflare Worker with no runtime dependencies, and a bounded call or a
// short tool loop needs nothing the SDK adds. Configuration is Worker secrets/vars only:
//   AI_API_KEY      secret. Unset or blank = "not set up" (aiConfigured false); nothing is ever sent.
//   AI_MODEL        optional model id. Default DEFAULT_MODEL.
//   AI_TIMEOUT_MS   optional overall deadline per call or loop, clamped to 2000..30000. Default 20000
//                   (Ask with web tools defaults to 30000).
//   AI_WEB_TOOLS    optional; 'off' removes the web search and web fetch server tools everywhere.
//   AI_WORKSPACE_ID optional Anthropic workspace id (wrkspc_...), sent as the anthropic-workspace-id header.
//                   Needed only when the key is not scoped to one workspace. A malformed value is not sent.
//
// Rules: each request is one attempt plus at most one retry on 429/529/5xx inside the same deadline; the
// caller's AbortSignal is honoured; https only; response size capped; model output is typed-validated by the
// caller. Logs carry states, codes, counts and durations only: never prompts, responses, URLs or the key.
// Each call builds its own fetch: no in-flight promise is shared across requests (see src/auth.js).

import * as db from './db.js';
import { clampInt } from './http.js';

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2026-10-21';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_TIMEOUT_MS = 20000;
export const MAX_RESPONSE_CHARS = 200_000;
// One loop response may carry web search results with their encrypted_content, so its cap is larger.
export const MAX_TURN_RESPONSE_CHARS = 1_000_000;
export const MAX_CALLS = 6; // the default loop
export const MAX_CALLS_FULL = 8; // the most a caller may ask for (Ask with Full access)
const MAX_PROMPT_CHARS = 120_000;
const MAX_TOOL_RESULT_CHARS = 20_000;
const RETRY_STATUSES = new Set([429, 529]);
// Statuses the owner can act on; any other failure is provider_error. 401/403 are never retried.
const STATUS_REASONS = { 401: 'auth_rejected', 403: 'permission_denied', 429: 'rate_limited' };
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

const WORKSPACE_RE = /^wrkspc_[A-Za-z0-9]{1,100}$/;

/** The workspace header value, or null (unset or malformed: never sent as given). */
export function aiWorkspaceId(env) {
  const w = env && typeof env.AI_WORKSPACE_ID === 'string' ? env.AI_WORKSPACE_ID.trim() : '';
  return WORKSPACE_RE.test(w) ? w : null;
}

export function aiTimeoutMs(env, fallback = DEFAULT_TIMEOUT_MS) {
  return clampInt(env && env.AI_TIMEOUT_MS, { min: 2000, max: 30000, fallback });
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

// ---------------------------------------------------------------- web tools: owner setting and server switch
// Stored like consent (key ai_web, JSON { allowed, updated_at }). No row = allowed, because Harrison asked for
// internet answers. An unreadable row or a database error reads as not allowed. AI_WEB_TOOLS=off beats both.

const WEB_KEY = 'ai_web';

export function webToolsEnabled(env) {
  return !(env && typeof env.AI_WEB_TOOLS === 'string' && env.AI_WEB_TOOLS.trim().toLowerCase() === 'off');
}

export async function aiWebAllowed(DB) {
  try {
    const v = await db.kvGet(DB, WEB_KEY, Date.now());
    return v === null ? true : JSON.parse(v).allowed === true;
  } catch {
    return false;
  }
}

export async function setAiWebAllowed(DB, allowed, nowIso) {
  await db.kvPut(DB, WEB_KEY, JSON.stringify({ allowed: allowed === true, updated_at: nowIso }));
}

/** Web is available only when the key is set, the server does not turn it off and the owner allows it. */
export async function webState(env) {
  const allowed = await aiWebAllowed(env.DB);
  const serverOff = !webToolsEnabled(env);
  return { web_allowed: allowed, web_server_off: serverOff, web_available: aiConfigured(env) && !serverOff && allowed };
}

// ---------------------------------------------------------------- what Ask may do: the owner's actions grant
// Stored like consent (key ai_actions, JSON { mode, scopes, updated_at }). No row, or one that cannot be read,
// is read: Ask only reads. full: Ask may change records through the app's validated actions (src/mcp.js
// askToolkit) in these scopes, and only where AI consent is also on. Only the owner's PUT /api/ai/actions writes it.

const ACTIONS_KEY = 'ai_actions';
export const ACTION_MODES = Object.freeze(['read', 'full']);

export async function aiActions(DB) {
  try {
    const v = JSON.parse(await db.kvGet(DB, ACTIONS_KEY, Date.now()));
    const scopes = Array.isArray(v.scopes) ? [...SCOPES].filter((s) => v.scopes.includes(s)) : [];
    return v.mode === 'full' && scopes.length ? { mode: 'full', scopes, updated_at: typeof v.updated_at === 'string' ? v.updated_at : null } : { mode: 'read', scopes: [], updated_at: null };
  } catch {
    return { mode: 'read', scopes: [], updated_at: null };
  }
}

export async function setAiActions(DB, { mode, scopes }, nowIso) {
  if (!ACTION_MODES.includes(mode)) throw new TypeError('mode must be read or full');
  if (!Array.isArray(scopes) || !scopes.every((s) => SCOPES.has(s)) || new Set(scopes).size !== scopes.length) throw new TypeError('scopes must list work and/or personal once each');
  if (mode === 'full' && !scopes.length) throw new TypeError('full needs at least one scope');
  await db.kvPut(DB, ACTIONS_KEY, JSON.stringify({ mode, scopes: mode === 'full' ? scopes : [], updated_at: nowIso }));
}

// The dynamic-filtering versions need Claude 4.6 or later; older ids get the basic versions. An id that does
// not parse is treated as current (every model this app defaults to is).
function dynamicWebModel(model) {
  const m = /^claude-[a-z]+-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(model);
  if (!m) return true;
  const major = Number(m[1]);
  return major > 4 || (major === 4 && Number(m[2] || 0) >= 6);
}

/**
 * The two server tools, with small max_uses (search is billed per use). Fetch may open only URLs from the
 * owner's message or from earlier web results: url_sources stops it opening links seen only in app tool results.
 * allowed_callers ['direct']: on the _20260209+ versions the default runs search and fetch inside code execution
 * (dynamic filtering), where results reach the model as code output rather than citable sources, and live answers
 * came back with bare URLs and no citation blocks. Called directly, results are sources the provider cites
 * (web_search_result_location, char_location). It costs more input tokens; honest citations are the point here.
 */
export function webTools(env, { timeZone } = {}) {
  const dynamic = dynamicWebModel(aiModel(env));
  const direct = dynamic ? { allowed_callers: ['direct'] } : {};
  return [
    { type: dynamic ? 'web_search_20260318' : 'web_search_20250305', name: 'web_search', max_uses: 5, ...direct, ...(timeZone ? { user_location: { type: 'approximate', timezone: timeZone } } : {}) },
    { type: dynamic ? 'web_fetch_20260318' : 'web_fetch_20250910', name: 'web_fetch', max_uses: 3, ...direct, citations: { enabled: true }, max_content_tokens: 10000, url_sources: { client_tool_results: { type: 'none' } } },
  ];
}

const isWebTool = (t) => !!t && typeof t.type === 'string' && /^web_(search|fetch)_/.test(t.type);

// ---------------------------------------------------------------- one request

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

// One deadline for a whole call or loop: the timer and the caller's signal both abort it.
function deadline(timeoutMs, signal) {
  const controller = new AbortController();
  const started = Date.now();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onCancel = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onCancel, { once: true });
  }
  return {
    signal: controller.signal,
    started,
    reason: () => (timedOut ? 'timeout' : 'cancelled'),
    left: () => timeoutMs - (Date.now() - started),
    done: () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onCancel);
    },
  };
}

const callTimeout = (opts, env) => (opts.timeoutMs ? clampInt(opts.timeoutMs, { min: 1, max: 30000, fallback: DEFAULT_TIMEOUT_MS }) : aiTimeoutMs(env));

/**
 * One Messages API request, with at most one retry on 429/529/5xx when the deadline leaves room.
 * -> { ok: true, body, status } | { ok: false, reason, status?, message? }. message is the provider's 400
 * error text, for the caller to inspect; it is never logged or returned to the browser.
 */
async function post(env, body, dl, fetchImpl, stats, maxChars) {
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.AI_API_KEY.trim(), 'anthropic-version': API_VERSION, ...(aiWorkspaceId(env) ? { 'anthropic-workspace-id': aiWorkspaceId(env) } : {}) },
    body: JSON.stringify(body),
    signal: dl.signal,
  };
  for (let tries = 1; ; tries++) {
    if (dl.signal.aborted) return { ok: false, reason: dl.reason() };
    stats.attempts++;
    let res;
    try {
      res = await fetchImpl(API_URL, init);
    } catch {
      if (dl.signal.aborted) return { ok: false, reason: dl.reason() };
      return { ok: false, reason: 'provider_error', status: 0 };
    }
    if (!res.ok) {
      const retryable = RETRY_STATUSES.has(res.status) || res.status >= 500;
      let message = null;
      if (res.status === 400) {
        try {
          const err = JSON.parse((await res.text()).slice(0, 20_000));
          if (err && err.error && typeof err.error.message === 'string') message = err.error.message;
        } catch { /* not JSON */ }
      } else {
        try { await res.body?.cancel(); } catch { /* ignore */ }
      }
      if (retryable && tries === 1 && dl.left() > RETRY_DELAY_MS + 1000) {
        await wait(RETRY_DELAY_MS, dl.signal);
        continue;
      }
      return { ok: false, reason: STATUS_REASONS[res.status] || 'provider_error', status: res.status, ...(message ? { message } : {}) };
    }
    const declared = Number(res.headers.get('content-length') || '0');
    if (declared > maxChars) return { ok: false, reason: 'invalid_output', status: res.status };
    let raw;
    try {
      raw = await res.text();
    } catch {
      if (dl.signal.aborted) return { ok: false, reason: dl.reason() };
      return { ok: false, reason: 'provider_error', status: res.status };
    }
    if (raw.length > maxChars) return { ok: false, reason: 'invalid_output', status: res.status };
    try {
      return { ok: true, body: JSON.parse(raw), status: res.status };
    } catch {
      return { ok: false, reason: 'invalid_output', status: res.status };
    }
  }
}

/**
 * complete(env, { system, prompt, maxTokens, timeoutMs, signal, expectJson, schema, fetchImpl })
 * -> { ok: true, text, data?, model } | { ok: false, reason, status? }
 * reason: 'not_configured' | 'timeout' | 'cancelled' | 'auth_rejected' (401) | 'permission_denied' (403) |
 * 'rate_limited' (429 after the retry) | 'provider_error' | 'invalid_output'.
 * expectJson parses the text as JSON into data (invalid_output when it isn't); schema, when given, is sent
 * as output_config.format so the provider constrains the shape (the caller still validates it).
 */
export async function complete(env, opts = {}) {
  const { system = '', prompt, maxTokens = 2048, signal, expectJson = false, schema = null } = opts;
  if (!aiConfigured(env)) return { ok: false, reason: 'not_configured' };
  if (typeof prompt !== 'string' || !prompt || prompt.length > MAX_PROMPT_CHARS || String(system).length > MAX_PROMPT_CHARS) {
    return { ok: false, reason: 'invalid_output' };
  }
  const model = aiModel(env);
  const dl = deadline(callTimeout(opts, env), signal);
  const stats = { attempts: 0 };
  const body = {
    model,
    max_tokens: clampInt(maxTokens, { min: 64, max: 8192, fallback: 2048 }),
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: 'low', ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
  };
  if (system) body.system = system;
  let result;
  try {
    const r = await post(env, body, dl, opts.fetchImpl || globalThis.fetch, stats, MAX_RESPONSE_CHARS);
    if (!r.ok) {
      result = { ok: false, reason: r.reason, ...(r.status !== undefined ? { status: r.status } : {}) };
    } else {
      const parsed = r.body;
      const text = textOf(parsed);
      // A refusal or a cut-off answer is not a usable answer.
      if (parsed && (parsed.stop_reason === 'refusal' || parsed.stop_reason === 'max_tokens')) result = { ok: false, reason: 'invalid_output', status: r.status };
      else if (!text || !text.trim()) result = { ok: false, reason: 'invalid_output', status: r.status };
      else {
        result = { ok: true, text, model: typeof parsed.model === 'string' ? parsed.model : model };
        if (expectJson) {
          try {
            result.data = JSON.parse(text);
          } catch {
            result = { ok: false, reason: 'invalid_output', status: r.status };
          }
        }
      }
    }
  } finally {
    dl.done();
  }
  log({ ok: result.ok, reason: result.reason || null, status: result.status ?? null, attempts: stats.attempts, ms: Date.now() - dl.started });
  return result;
}

// ---------------------------------------------------------------- the tool loop

const WEB_OFF_RE = /\bnot (?:enabled|allowed|available)\b|\bdisabled\b/i;
const WEB_SEARCH_RE = /\bweb[ _]?search\b/i;
const WEB_FETCH_RE = /\bweb[ _]?fetch\b/i;

/** An http(s) URL as a normalised href, else null (never a javascript: or data: link). */
export function webHref(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null;
  } catch {
    return null;
  }
}

const clipText = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
// Fixed telemetry vocabulary: never turn arbitrary provider strings into log keys.
const CITATION_LOG_TYPES = new Set(['web_search_result_location', 'char_location', 'page_location', 'content_block_location', 'search_result_location']);

async function runTool(handlers, use) {
  const fn = handlers && Object.prototype.hasOwnProperty.call(handlers, use.name) ? handlers[use.name] : null;
  const result = (content, isError) => ({ type: 'tool_result', tool_use_id: use.id, content: String(content).slice(0, MAX_TOOL_RESULT_CHARS), ...(isError ? { is_error: true } : {}) });
  if (typeof fn !== 'function') return result(`Unknown tool: ${String(use.name).slice(0, 60)}.`, true);
  try {
    const out = await fn(use.input);
    return typeof out === 'string' ? result(out, false) : result(out && out.content !== undefined ? out.content : '', !!(out && out.is_error));
  } catch {
    return result('The tool failed.', true);
  }
}

/**
 * converse(env, { system, messages, tools, toolHandlers, maxTokens, effort, timeoutMs, signal, fetchImpl, maxCalls })
 * A manual Messages API loop, at most maxCalls (default 6, at most 8) requests inside one deadline. pause_turn: the paused
 * assistant content is sent back unchanged and the call repeated, with no extra user message. tool_use: the
 * client tools in toolHandlers run and every call is answered in one user message of tool_result blocks.
 * Server tools (web search, web fetch) run on the provider's side. The full content of every response is kept
 * in the history. An org admin can turn web search and web fetch off separately: when the provider rejects a
 * request with HTTP 400 saying a named web tool is not enabled, only the tool(s) it names are dropped and the
 * request is repeated; web_rejected lists their names ('web_search', 'web_fetch').
 * -> { ok: true, text, content, citations, model, web, web_rejected, calls }
 *  | { ok: false, reason, status?, web, web_rejected, calls }
 * reason: complete()'s, plus 'refused' (stop_reason refusal) and 'incomplete' (max_tokens or too many steps).
 * text joins the text blocks after the last client tool round (pause_turn continuations included).
 * citations: [{ url, title, cited_text, kind: 'search' | 'fetch' }] from those blocks' citation blocks (a search
 * result location, or a location in a fetched document), http(s) only, one per url.
 * web: { used, search, fetch, errors, results: [{ url, title, searched, fetched }] }; used and the counts cover
 * results that actually came back (an error result is not a use). results are every page a search returned or a
 * fetch read, so a URL the answer names can be checked against what really came back.
 */
export async function converse(env, opts = {}) {
  const { system = '', messages, tools = [], toolHandlers = {}, maxTokens = 4096, effort = 'low', signal } = opts;
  const web = { used: false, search: 0, fetch: 0, errors: [], results: [] };
  if (!aiConfigured(env)) return { ok: false, reason: 'not_configured', web, web_rejected: [], calls: 0 };
  if (!Array.isArray(messages) || !messages.length || JSON.stringify(messages).length > MAX_PROMPT_CHARS || String(system).length > MAX_PROMPT_CHARS) {
    return { ok: false, reason: 'invalid_output', web, web_rejected: [], calls: 0 };
  }
  const maxCalls = clampInt(opts.maxCalls, { min: 1, max: MAX_CALLS_FULL, fallback: MAX_CALLS });
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const model = aiModel(env);
  const dl = deadline(callTimeout(opts, env), signal);
  const stats = { attempts: 0, calls: 0 };
  const history = messages.slice();
  let toolList = Array.isArray(tools) ? tools.slice() : [];
  const webRejected = [];
  const fetched = []; // fetched documents in order: char_location citations name them by document_index
  const byHref = new Map();
  const note = (url, title, how) => {
    const href = webHref(url);
    if (!href) return null;
    let r = byHref.get(href);
    if (!r) {
      r = { url: href, title: clipText(title, 300), searched: false, fetched: false };
      byHref.set(href, r);
      web.results.push(r);
    }
    if (!r.title && title) r.title = clipText(title, 300);
    r[how] = true;
    return href;
  };
  const scan = (content) => {
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'web_search_tool_result') {
        // Success is a list of results (possibly empty); an error is one object with error_code.
        if (Array.isArray(b.content)) {
          web.used = true;
          web.search++;
          for (const r of b.content) if (r && r.type === 'web_search_result') note(r.url, r.title, 'searched');
        } else if (b.content && typeof b.content.error_code === 'string') web.errors.push(b.content.error_code.slice(0, 60));
      } else if (b.type === 'web_fetch_tool_result') {
        const c = b.content;
        if (c && c.type === 'web_fetch_result') {
          web.used = true;
          web.fetch++;
          const title = c.content && typeof c.content.title === 'string' ? c.content.title : null;
          fetched.push({ url: note(c.url, title, 'fetched'), title });
        } else if (c && typeof c.error_code === 'string') web.errors.push(c.error_code.slice(0, 60));
      }
    }
  };
  // Citation types seen in the answer, counted for the log (types and counts only, never URLs or text).
  const citeTypes = Object.create(null);
  const citationsOf = (blocks) => {
    const out = [];
    const cited = new Set();
    for (const b of blocks) {
      for (const c of Array.isArray(b.citations) ? b.citations : []) {
        if (!c || typeof c !== 'object') continue;
        const type = CITATION_LOG_TYPES.has(c.type) ? c.type : 'other';
        citeTypes[type] = (citeTypes[type] || 0) + 1;
        // A location in a fetched document (characters, or pages of a PDF) names it by document_index.
        const doc = (type === 'char_location' || type === 'page_location') && Number.isInteger(c.document_index) ? fetched[c.document_index] : null;
        const url = type === 'web_search_result_location' ? webHref(c.url) : doc ? doc.url : null;
        if (!url || cited.has(url)) continue;
        cited.add(url);
        out.push({ url, title: clipText(doc ? c.document_title || doc.title : c.title, 300), cited_text: clipText(c.cited_text, 300), kind: doc ? 'fetch' : 'search' });
      }
    }
    return out;
  };
  let segment = [];
  let result;
  try {
    for (;;) {
      if (stats.calls >= maxCalls) {
        result = { ok: false, reason: 'incomplete' };
        break;
      }
      stats.calls++;
      const body = { model, max_tokens: clampInt(maxTokens, { min: 64, max: 16000, fallback: 4096 }), messages: history, output_config: { effort } };
      if (system) body.system = system;
      if (toolList.length) body.tools = toolList;
      const r = await post(env, body, dl, fetchImpl, stats, MAX_TURN_RESPONSE_CHARS);
      if (!r.ok) {
        const named = r.status === 400 && r.message && WEB_OFF_RE.test(r.message)
          ? toolList.filter((t) => isWebTool(t) && (t.name === 'web_fetch' ? WEB_FETCH_RE : WEB_SEARCH_RE).test(r.message))
          : [];
        if (named.length) {
          webRejected.push(...named.map((t) => t.name));
          toolList = toolList.filter((t) => !named.includes(t));
          continue; // each retry drops a tool, so this repeats at most twice
        }
        result = { ok: false, reason: r.reason, ...(r.status !== undefined ? { status: r.status } : {}) };
        break;
      }
      const msg = r.body && typeof r.body === 'object' ? r.body : {};
      const content = Array.isArray(msg.content) ? msg.content : [];
      scan(content);
      // The stop reason is checked before anything in the output is used.
      if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') {
        result = { ok: false, reason: msg.stop_reason === 'refusal' ? 'refused' : 'incomplete', status: r.status };
        break;
      }
      history.push({ role: 'assistant', content });
      segment.push(...content);
      if (msg.stop_reason === 'pause_turn') continue;
      if (msg.stop_reason === 'tool_use') {
        const uses = content.filter((b) => b && b.type === 'tool_use' && typeof b.id === 'string');
        if (!uses.length) {
          result = { ok: false, reason: 'invalid_output', status: r.status };
          break;
        }
        const results = await Promise.all(uses.map((u) => runTool(toolHandlers, u)));
        if (dl.signal.aborted) {
          result = { ok: false, reason: dl.reason() };
          break;
        }
        history.push({ role: 'user', content: results });
        segment = [];
        continue;
      }
      // Adjacent text blocks are one run (citations split sentences); runs separated by tool blocks get a break.
      const blocks = [];
      let text = '';
      let gap = false;
      for (const b of segment) {
        if (b && b.type === 'text' && typeof b.text === 'string') {
          if (gap && text && !/\s$/.test(text)) text += '\n\n';
          text += b.text;
          blocks.push(b);
          gap = false;
        } else if (text) gap = true;
      }
      result = text.trim()
        ? { ok: true, text, content: segment, citations: citationsOf(blocks), model: typeof msg.model === 'string' ? msg.model : model }
        : { ok: false, reason: 'invalid_output', status: r.status };
      break;
    }
  } finally {
    dl.done();
  }
  log({ kind: 'converse', ok: result.ok, reason: result.reason || null, status: result.status ?? null, attempts: stats.attempts, calls: stats.calls, web_search: web.search, web_fetch: web.fetch, web_errors: web.errors.length, web_rejected: webRejected.length, cites: citeTypes, ms: Date.now() - dl.started });
  return { ...result, web, web_rejected: webRejected, calls: stats.calls };
}
