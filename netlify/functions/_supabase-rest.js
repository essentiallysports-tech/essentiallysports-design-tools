'use strict';

// Minimal PostgREST calls for serverless functions.
// - As the signed-in user: the publishable key + their own JWT, so RLS and
//   the RPCs' own checks apply exactly as in the browser.
// - As the service role: only when SUPABASE_SERVICE_ROLE_KEY is set (used by
//   the Slack slash command, which has no FrameUp session). Never sent to
//   the browser.

const { authConfig } = require('./_supabase-auth.js');

function serviceRoleKey(env = process.env) {
  return String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

function headersFor(token, { service = false } = {}) {
  const config = authConfig();
  const key = service ? serviceRoleKey() : config.publishableKey;
  return {
    apikey: key,
    Authorization: `Bearer ${service ? key : token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

class SupabaseRestError extends Error {
  constructor(message, { status = 500, code = '', details = '' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Map PostgREST / Postgres errors to something a person can read and an HTTP
// status. PGRST202 = function missing (migration not applied yet).
function toRestError(status, data) {
  const code = String(data?.code || '');
  const message = String(data?.message || data?.error || `Supabase request failed (${status})`);
  if (code === 'PGRST202' || code === '42883' || code === 'PGRST205' || code === '42P01') {
    return new SupabaseRestError('Request tracking is not switched on yet.', { status: 503, code: 'not_installed' });
  }
  if (code === '42501') return new SupabaseRestError(message, { status: 403, code });
  if (code === 'P0002') return new SupabaseRestError(message, { status: 404, code });
  if (code === '22023' || code === '23514') return new SupabaseRestError(message, { status: 400, code });
  return new SupabaseRestError(message, { status: status >= 400 && status < 600 ? status : 500, code });
}

async function request(path, { method = 'GET', token = '', service = false, body, prefer = '' } = {}, fetchImpl = fetch) {
  const { url } = authConfig();
  const headers = headersFor(token, { service });
  if (prefer) headers.Prefer = prefer;
  const response = await fetchImpl(`${url}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (error) { data = { message: text }; }
  if (!response.ok) throw toRestError(response.status, data);
  return data;
}

function rpc(name, args, options = {}, fetchImpl = fetch) {
  return request(`rpc/${name}`, { ...options, method: 'POST', body: args || {} }, fetchImpl);
}

module.exports = {
  SupabaseRestError,
  serviceRoleKey,
  request,
  rpc,
  toRestError,
};
