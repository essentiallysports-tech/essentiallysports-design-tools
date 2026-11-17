'use strict';
// POST /api/client-errors: error reports from frameup-errors.js.
//   body: { errors: [{ kind, message, stack, page, source, line, col, status, fingerprint, occurrences }] }
//
// - Signed-in ES users only (401 otherwise); bodies over 8 KB get 413.
// - Each report is scrubbed again here (never trust the browser to have done
//   it), then written to frameup_client_errors with the person's own session
//   (RLS: insert own, admins read). Before that table exists the reports are
//   accepted and dropped, so nothing breaks.
// - When SENTRY_DSN is set, each report is also forwarded to Sentry from the
//   server (the DSN never reaches the browser). The person is a short hash of
//   their email, never the email itself.
const crypto = require('node:crypto');
const { verifyEsUser, bearerToken, authConfig } = require('./_supabase-auth.js');
const { scrub, scrubUrl, scrubStack } = require('../../frameup-errors.js');

const TABLE = 'frameup_client_errors';
const MAX_BODY_BYTES = 8 * 1024;
const MAX_ITEMS = 5;
const KINDS = new Set(['error', 'rejection', 'api', 'resource']);
// Per server instance: a burst from one person is cut off (the browser
// already limits itself to 5 a minute; this is the backstop).
const USER_LIMIT_PER_MINUTE = 20;
const recentByUser = new Map();

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function overUserLimit(userId, now = Date.now()) {
  const times = (recentByUser.get(userId) || []).filter(t => now - t < 60000);
  if (times.length >= USER_LIMIT_PER_MINUTE) { recentByUser.set(userId, times); return true; }
  times.push(now);
  recentByUser.set(userId, times);
  if (recentByUser.size > 500) recentByUser.delete(recentByUser.keys().next().value);
  return false;
}

function intOrNull(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(max, Math.round(number)));
}

function releaseTag(env = process.env) {
  return String(env.VERCEL_GIT_COMMIT_SHA || env.COMMIT_REF || '').trim().slice(0, 12);
}

function cleanReport(item, { email, userAgent, release }) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const kind = KINDS.has(item.kind) ? item.kind : 'error';
  const message = scrub(item.message || '', 500);
  if (!message) return null;
  return {
    user_email: email,
    kind,
    message,
    stack: scrubStack(item.stack || ''),
    page: scrubUrl(item.page || '', 'https://frameup.invalid').slice(0, 200) || '/',
    source: scrubUrl(item.source || '', 'https://frameup.invalid').slice(0, 300),
    line: intOrNull(item.line, 10_000_000),
    col: intOrNull(item.col, 10_000_000),
    status: intOrNull(item.status, 999),
    fingerprint: String(item.fingerprint || '').replace(/[^a-f0-9]/gi, '').slice(0, 64),
    occurrences: Math.max(1, intOrNull(item.occurrences, 1000) || 1),
    release,
    user_agent: scrub(userAgent, 200),
  };
}

function isMissingTable(status, text) {
  return status === 404 || /PGRST205|42P01|does not exist|could not find the table/i.test(String(text || ''));
}

// ─── Sentry (optional, server-side only) ─────────────────────────────────────
function parseDsn(dsn) {
  try {
    const url = new URL(String(dsn || '').trim());
    const projectId = url.pathname.replace(/^\/+|\/+$/g, '').split('/').pop();
    if (!url.username || !projectId || !/^https?:$/.test(url.protocol)) return null;
    const prefix = url.pathname.replace(/\/?[^/]+\/?$/, '');
    return {
      publicKey: decodeURIComponent(url.username),
      envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
      dsn: `${url.protocol}//${url.username}@${url.host}${url.pathname}`,
    };
  } catch (error) {
    return null;
  }
}

function hashedUser(email) {
  return crypto.createHash('sha256').update(`frameup:${email}`).digest('hex').slice(0, 16);
}

function sentryEnvelope(row, dsn, env = process.env) {
  const eventId = crypto.randomUUID().replace(/-/g, '');
  const sentAt = new Date().toISOString();
  const [type, ...rest] = row.message.split(': ');
  const event = {
    event_id: eventId,
    timestamp: sentAt,
    platform: 'javascript',
    level: 'error',
    logger: 'frameup-client',
    release: row.release || undefined,
    environment: String(env.VERCEL_ENV || env.CONTEXT || 'production'),
    user: { id: hashedUser(row.user_email) },
    tags: { kind: row.kind, page: row.page, status: row.status == null ? undefined : String(row.status) },
    fingerprint: row.fingerprint ? [row.fingerprint] : undefined,
    exception: { values: [{ type: rest.length ? type : row.kind, value: rest.length ? rest.join(': ') : row.message }] },
    extra: { stack: row.stack, source: row.source, line: row.line, col: row.col, occurrences: row.occurrences },
  };
  return [
    JSON.stringify({ event_id: eventId, sent_at: sentAt, dsn: dsn.dsn }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
}

async function forwardToSentry(rows, env = process.env) {
  const dsn = parseDsn(env.SENTRY_DSN);
  if (!dsn || !rows.length) return 0;
  let sent = 0;
  await Promise.all(rows.map(async row => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const response = await fetch(dsn.envelopeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=frameup-client-errors/1.0`,
        },
        body: sentryEnvelope(row, dsn, env),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (response.ok) sent += 1;
    } catch (error) {
      // Sentry being down never fails the report.
    }
  }));
  return sent;
}

async function handler(event = {}) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  // Cheap checks first: no token, or too big, never reaches Supabase.
  const token = bearerToken(event.headers);
  if (!token) return json(401, { ok: false, error: 'Authentication required.' });
  const raw = String(event.body || '');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return json(413, { ok: false, error: 'Error report too large (8 KB max).' });

  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error });

  let body;
  try { body = JSON.parse(raw || '{}'); } catch (error) { return json(400, { ok: false, error: 'Invalid JSON.' }); }
  const items = Array.isArray(body?.errors) ? body.errors : (body && typeof body === 'object' && body.message ? [body] : null);
  if (!items) return json(400, { ok: false, error: 'Send { errors: [...] }.' });
  if (overUserLimit(auth.user.id)) return json(429, { ok: false, error: 'Too many error reports. Try again in a minute.' });

  const headers = event.headers || {};
  const userAgent = String(headers['user-agent'] || headers['User-Agent'] || '');
  const rows = items.slice(0, MAX_ITEMS)
    .map(item => cleanReport(item, { email: auth.user.email, userAgent, release: releaseTag() }))
    .filter(Boolean);
  if (!rows.length) return json(400, { ok: false, error: 'No usable error reports.' });

  const sentryPromise = forwardToSentry(rows);
  let stored = false;
  try {
    const config = authConfig();
    const response = await fetch(`${config.url}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (response.ok) stored = true;
    else {
      const text = await response.text().catch(() => '');
      if (!isMissingTable(response.status, text)) console.warn('[client-errors] insert failed', response.status, String(text).slice(0, 200));
    }
  } catch (error) {
    console.warn('[client-errors] insert failed', error?.message || error);
  }
  const forwarded = await sentryPromise;
  return json(202, { ok: true, accepted: rows.length, stored, forwarded });
}

module.exports = { handler, cleanReport, parseDsn, sentryEnvelope, forwardToSentry, hashedUser, MAX_BODY_BYTES, _resetLimits: () => recentByUser.clear() };
