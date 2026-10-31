// Shared HTTP helpers for every /api module (src/api.js core routes and the feature modules listed in
// src/features.js). Feature modules import from here, never from api.js, so there is no import cycle.
import { instantToZonedParts } from './time.js';

export const MAX_TEXT = 10000;
export const MAX_BODY_CHARS = 64 * 1024;
export const MAX_TZ_LEN = 64;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SCOPES = new Set(['work', 'personal']);


export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export function apiHeaders(extra) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...(extra || {}),
  };
}

export function json(status, body, extraHeaders) {
  return new Response(JSON.stringify(body), { status, headers: apiHeaders(extraHeaders) });
}

export function apiError(status, code, message, extra) {
  const error = { code, message: message || code };
  if (extra && typeof extra === 'object') Object.assign(error, extra);
  return json(status, { error });
}


export function iso(ms) {
  return new Date(ms).toISOString();
}

export function clampInt(value, { min, max, fallback }) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function readJson(request) {
  const declared = Number(request.headers.get('content-length') || '0');
  if (declared > MAX_BODY_CHARS * 4) throw new HttpError(413, 'too_large', 'Request body is too large');
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) throw new HttpError(413, 'too_large', 'Request body is too large');
  if (!text.trim()) return {};
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad_json', 'Body must be JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'bad_json', 'Body must be a JSON object');
  }
  return body;
}

export async function readJsonLenient(request) {
  try {
    return await readJson(request);
  } catch {
    return {};
  }
}

export function requireText(value, field = 'text', max = MAX_TEXT) {
  if (typeof value !== 'string') throw new HttpError(400, `invalid_${field}`, `${field} must be a string`);
  const t = value.trim();
  if (t.length < 1 || t.length > max) {
    throw new HttpError(400, `invalid_${field}`, `${field} must be 1 to ${max} characters after trim`);
  }
  return t;
}

/**
 * The scope rule. Missing gives 400 scope_required (never a default of 'all'), 'all' where it is not
 * allowed gives 400 scope_all_not_allowed, anything else unknown gives 400 invalid_scope.
 */
export function requireScope(value, { allowAll = false } = {}) {
  if (value === undefined || value === null || value === '') {
    throw new HttpError(400, 'scope_required', allowAll ? "scope must be 'work', 'personal' or 'all'" : "scope must be 'work' or 'personal'");
  }
  if (value === 'all') {
    if (allowAll) return 'all';
    throw new HttpError(400, 'scope_all_not_allowed', "scope 'all' is not allowed here; use 'work' or 'personal'");
  }
  if (!SCOPES.has(value)) throw new HttpError(400, 'invalid_scope', "scope must be 'work' or 'personal'");
  return value;
}

export function queryScope(ctx, opts) {
  return requireScope(ctx.url.searchParams.get('scope'), opts);
}

export function validTimeZone(value, nowMs) {
  if (typeof value !== 'string' || !value || value.length > MAX_TZ_LEN) return null;
  try {
    instantToZonedParts(nowMs, value);
    return value;
  } catch {
    return null;
  }
}
