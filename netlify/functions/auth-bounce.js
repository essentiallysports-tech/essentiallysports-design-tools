'use strict';
// POST /api/auth-bounce: anonymous report of a trip back to the login page
// (es-auth.js recordAuthEvent). People stuck in a login loop are signed out,
// so /api/client-errors (signed-in only) never hears about them.
//   body: { reason, page, diag: { storageWritable, storageUsedKb, ... } }
//
// - No auth. Small (2 KB max), whitelisted fields only, numbers clamped,
//   strings cut short. Never tokens, never addresses (the domain is only
//   "essentiallysports.com" or "other").
// - Always logged as one structured line ([auth-bounce] {...}) in the
//   function logs.
// - When SUPABASE_SERVICE_ROLE_KEY is set, also stored in
//   frameup_client_errors (kind 'error', user "auth-bounce (<domain>)") so it
//   shows on Dashboard → Errors. Off when the env var is missing.
// - Per-IP limit: 10 a minute per server instance.

const { authConfig } = require('./_supabase-auth.js');

const MAX_BODY_BYTES = 2 * 1024;
const PER_IP_PER_MINUTE = 10;
const recentByIp = new Map();

const REASONS = new Set([
  'no-session', 'check-failed', 'not-approved', 'session-expired',
  'check-failed-used-stored', 'login-not-saved', 'unknown',
]);
const BOOLEAN_FIELDS = ['storageWritable', 'sessionFallback', 'storedSession', 'storedSessionExpired', 'sdkLoaded', 'locks', 'online'];
const NUMBER_FIELDS = { storageUsedKb: 100000, secondsSinceLogin: 86400, clockSkewMinutes: 100000 };
const SDK_SOURCES = new Set(['local', 'cdn', 'page', 'none']);

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function header(headers, name) {
  const key = Object.keys(headers || {}).find(candidate => candidate.toLowerCase() === name);
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function overLimit(ip, now = Date.now()) {
  const key = ip || 'unknown';
  const times = (recentByIp.get(key) || []).filter(time => now - time < 60000);
  if (times.length >= PER_IP_PER_MINUTE) { recentByIp.set(key, times); return true; }
  times.push(now);
  recentByIp.set(key, times);
  if (recentByIp.size > 1000) recentByIp.delete(recentByIp.keys().next().value);
  return false;
}

// Only known fields survive; anything else (tokens, addresses, free text) is dropped.
function cleanBounce(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const reason = REASONS.has(body.reason) ? body.reason : 'unknown';
  const page = String(body.page || '/').replace(/[?#].*$/, '').replace(/[^a-zA-Z0-9/._-]/g, '').slice(0, 80) || '/';
  const diag = {};
  const source = body.diag && typeof body.diag === 'object' && !Array.isArray(body.diag) ? body.diag : {};
  BOOLEAN_FIELDS.forEach(field => {
    if (typeof source[field] === 'boolean') diag[field] = source[field];
  });
  Object.entries(NUMBER_FIELDS).forEach(([field, max]) => {
    if (source[field] === null || source[field] === undefined || source[field] === '') return;
    const value = Number(source[field]);
    if (Number.isFinite(value)) diag[field] = Math.max(-max, Math.min(max, Math.round(value)));
  });
  if (SDK_SOURCES.has(source.sdkSource)) diag.sdkSource = source.sdkSource;
  diag.emailDomain = source.emailDomain === 'essentiallysports.com' ? 'essentiallysports.com' : (source.emailDomain ? 'other' : '');
  return { reason, page, diag };
}

function summary(report) {
  const facts = Object.entries(report.diag).map(([key, value]) => `${key}=${value}`).join(' ');
  return `auth-bounce: ${report.reason} on ${report.page} · ${facts}`.slice(0, 500);
}

async function store(report, userAgent, env = process.env) {
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!serviceKey) return false;
  const config = authConfig();
  try {
    const response = await fetch(`${config.url}/rest/v1/frameup_client_errors`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify([{
        user_email: `auth-bounce (${report.diag.emailDomain || 'unknown'})`,
        kind: 'error',
        message: summary(report),
        page: report.page,
        fingerprint: '',
        occurrences: 1,
        user_agent: String(userAgent || '').slice(0, 200),
      }]),
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function handler(event = {}, env = process.env) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });
  const raw = String(event.body || '');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return json(413, { ok: false, error: 'Too large.' });
  const headers = event.headers || {};
  const ip = header(headers, 'x-forwarded-for').split(',')[0].trim() || header(headers, 'x-real-ip');
  if (overLimit(ip)) return json(429, { ok: false, error: 'Too many reports.' });
  let body;
  try { body = JSON.parse(raw || '{}'); } catch (error) { return json(400, { ok: false, error: 'Invalid JSON.' }); }
  const report = cleanBounce(body);
  if (!report) return json(400, { ok: false, error: 'Send { reason, page, diag }.' });
  console.info('[auth-bounce]', JSON.stringify(report));
  const stored = await store(report, header(headers, 'user-agent'), env);
  return json(202, { ok: true, stored });
}

module.exports = { handler, cleanBounce, summary, store, _resetLimits: () => recentByIp.clear() };
