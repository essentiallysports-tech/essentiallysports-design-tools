#!/usr/bin/env node
// /api/health (netlify/functions/health.js), every network call mocked:
//   1. 200 when Supabase answers, 503 when it doesn't (error or timeout path)
//   2. no auth needed, no secrets or versions in the answer, AI flag is boolean
//   3. GET/HEAD only
//   4. Slack alert: only for the scheduled caller (CRON_SECRET), only with a
//      Slack webhook set, once per state change (+ hourly while still down)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let supabase = { ok: true };
let slack = [];
let supabaseCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.endsWith('/auth/v1/health')) {
    supabaseCalls.push(options.headers);
    if (supabase.throws) throw new Error('getaddrinfo ENOTFOUND');
    return { ok: supabase.ok, status: supabase.ok ? 200 : 503 };
  }
  if (href.startsWith('https://hooks.slack.com/')) {
    slack.push(JSON.parse(options.body));
    return { ok: true, status: 200 };
  }
  throw new Error(`unexpected fetch ${href}`);
};

process.env.AI_GATEWAY_API_KEY = 'gw-secret-value';
delete process.env.GENERATE_AI;
delete process.env.CRON_SECRET;
delete process.env.SLACK_OPS_WEBHOOK_URL;
const { handler, _resetAlerts } = require('../netlify/functions/health.js');
const adapter = require('../api/health.js');

// ── 1–2. Healthy / unhealthy, no secrets ────────────────────────────────────
{
  const result = await handler({ httpMethod: 'GET', headers: {} });
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  const body = JSON.parse(result.body);
  assert.equal(body.ok, true);
  assert.equal(body.checks.supabase.ok, true);
  assert.equal(typeof body.checks.supabase.ms, 'number');
  assert.equal(body.checks.aiGateway.configured, true);
  assert.deepEqual(Object.keys(body.checks.aiGateway), ['configured'], 'only a boolean about the AI key');
  assert.ok(!result.body.includes('gw-secret-value'), 'never the key');
  assert.ok(!/sb_publishable|apikey|sha|version|@/i.test(result.body), 'no keys, versions or emails');
  assert.ok(!('alerted' in body), 'anonymous callers never trigger alerts');
  assert.ok(supabaseCalls[0].apikey, 'checks Supabase with the public key');
}
{
  delete process.env.AI_GATEWAY_API_KEY;
  supabase = { ok: false };
  const result = await handler({ httpMethod: 'GET', headers: {} });
  assert.equal(result.statusCode, 503, 'Supabase down: 503 so monitors alert');
  const body = JSON.parse(result.body);
  assert.equal(body.ok, false);
  assert.equal(body.checks.aiGateway.configured, false);
  supabase = { throws: true };
  assert.equal((await handler({ httpMethod: 'GET', headers: {} })).statusCode, 503, 'network error: 503');
  supabase = { ok: true };
}

// ── 3. Methods ──────────────────────────────────────────────────────────────
{
  assert.equal((await handler({ httpMethod: 'POST', headers: {} })).statusCode, 405);
  const head = await handler({ httpMethod: 'HEAD', headers: {} });
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, '');
}

// ── 4. Slack alerts ─────────────────────────────────────────────────────────
{
  _resetAlerts();
  slack = [];
  process.env.SLACK_OPS_WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/XXXX';
  supabase = { ok: false };
  // No CRON_SECRET configured: nobody can trigger Slack.
  await handler({ httpMethod: 'GET', headers: { authorization: 'Bearer anything' } });
  assert.equal(slack.length, 0, 'no CRON_SECRET: never alerts');

  process.env.CRON_SECRET = 'cron-secret';
  await handler({ httpMethod: 'GET', headers: { authorization: 'Bearer wrong' } });
  assert.equal(slack.length, 0, 'wrong secret: no alert');

  const down = JSON.parse((await handler({ httpMethod: 'GET', headers: { authorization: 'Bearer cron-secret' } })).body);
  assert.equal(down.alerted, true);
  assert.equal(slack.length, 1, 'scheduled check alerts when down');
  assert.match(slack[0].text, /health check failed/i);
  await handler({ httpMethod: 'GET', headers: { Authorization: 'Bearer cron-secret' } });
  assert.equal(slack.length, 1, 'still down: not repeated every 5 minutes');

  supabase = { ok: true };
  await handler({ httpMethod: 'GET', headers: { authorization: 'Bearer cron-secret' } });
  assert.equal(slack.length, 2, 'recovery is announced once');
  assert.match(slack[1].text, /healthy again/i);
  await handler({ httpMethod: 'GET', headers: { authorization: 'Bearer cron-secret' } });
  assert.equal(slack.length, 2);

  process.env.SLACK_OPS_WEBHOOK_URL = 'https://evil.example.com/hook';
  supabase = { ok: false };
  await handler({ httpMethod: 'GET', headers: { authorization: 'Bearer cron-secret' } });
  assert.equal(slack.length, 2, 'only Slack webhook URLs are called');
  delete process.env.SLACK_OPS_WEBHOOK_URL;
  delete process.env.CRON_SECRET;
  supabase = { ok: true };
}

// ── Vercel adapter ──────────────────────────────────────────────────────────
{
  const response = { headers: {}, statusCode: 0, payload: null, setHeader(n, v) { this.headers[n.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, send(p) { this.payload = p; return this; }, json(p) { this.payload = p; return this; } };
  await adapter({ method: 'GET', headers: {}, query: {} }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.payload).ok, true);
  assert.equal(response.headers['cache-control'], 'no-store');
}

console.log('health: ok');
