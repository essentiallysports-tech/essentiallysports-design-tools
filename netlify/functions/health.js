'use strict';
// GET /api/health: is FrameUp up? For uptime monitors (no sign-in needed).
//
// Answers 200 when Supabase (login and data) is reachable, 503 when it isn't:
//   { ok, checks: { supabase: { ok, ms }, aiGateway: { configured } }, checkedAt }
// No secrets, no versions, no user data: only booleans and a timing.
// aiGateway.configured says whether the AI key is set (true/false), never the key.
//
// Alerts (optional): when called by the scheduled check with
// Authorization: Bearer <CRON_SECRET> (Vercel cron sends this automatically
// when CRON_SECRET is set) and SLACK_OPS_WEBHOOK_URL is set, an unhealthy
// result posts one Slack message, and a recovery posts one more. Anonymous
// callers can never trigger Slack. See project-docs/uptime-and-errors.md.
const { authConfig } = require('./_supabase-auth.js');
const { gatewayConfigured } = require('./_ai-gateway.js');

const TIMEOUT_MS = 3000;
const ALERT_REPEAT_MS = 60 * 60 * 1000; // a still-down service re-alerts hourly
let lastAlert = { state: 'ok', at: 0 };

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
    body: JSON.stringify(body),
  };
}

async function checkSupabase() {
  const config = authConfig();
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // The auth service's own health route, with the public (publishable) key.
    const response = await fetch(`${config.url}/auth/v1/health`, {
      headers: { apikey: config.publishableKey, Accept: 'application/json' },
      signal: controller.signal,
    });
    return { ok: response.ok, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function readHeader(headers, name) {
  const key = Object.keys(headers || {}).find(candidate => candidate.toLowerCase() === name);
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function isScheduledCaller(event, env = process.env) {
  const secret = String(env.CRON_SECRET || '');
  if (!secret) return false;
  return readHeader(event.headers, 'authorization') === `Bearer ${secret}`;
}

async function maybeAlert(result, env = process.env, now = Date.now()) {
  const webhook = String(env.SLACK_OPS_WEBHOOK_URL || '').trim();
  if (!/^https:\/\/hooks\.slack\.com\//.test(webhook)) return false;
  const state = result.ok ? 'ok' : 'down';
  const changed = state !== lastAlert.state;
  const repeat = state === 'down' && now - lastAlert.at >= ALERT_REPEAT_MS;
  if (!changed && !repeat) return false;
  const text = result.ok
    ? ':white_check_mark: FrameUp is healthy again (Supabase reachable).'
    : `:rotating_light: FrameUp health check failed: Supabase is not reachable (${result.checks.supabase.ms} ms). Login and saving may be down. https://frameup.essentiallysports.com/api/health`;
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) return false;
    lastAlert = { state, at: now };
    return true;
  } catch (error) {
    return false;
  }
}

async function handler(event = {}, env = process.env) {
  if (event.httpMethod && !['GET', 'HEAD'].includes(event.httpMethod)) return json(405, { ok: false, error: 'GET only.' });
  const supabase = await checkSupabase();
  const result = {
    ok: supabase.ok,
    checks: {
      supabase,
      aiGateway: { configured: gatewayConfigured() },
    },
    checkedAt: new Date().toISOString(),
  };
  if (isScheduledCaller(event, env)) result.alerted = await maybeAlert(result, env);
  const response = json(result.ok ? 200 : 503, result);
  if (event.httpMethod === 'HEAD') response.body = '';
  return response;
}

module.exports = { handler, checkSupabase, maybeAlert, isScheduledCaller, _resetAlerts: () => { lastAlert = { state: 'ok', at: 0 }; } };
