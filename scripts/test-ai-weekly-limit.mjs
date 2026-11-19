#!/usr/bin/env node
// Per-person weekly $ AI cap (netlify/functions/_ai-gateway.js
// userOverWeeklyLimit + frameup_my_ai_spend), every network call mocked:
//   1. week start is Monday 00:00 UTC
//   2. userOverWeeklyLimit: under / at / over the cap, the RPC body and headers,
//      fails open (404, 500, bad JSON, network error), no token, cap turned off
//   3. AI_USER_WEEKLY_LIMIT_USD can lower the cap (never raise it past the $20 policy)
//   4. every AI caller switches to free mode (200, mode 'free', reason
//      'user-limit') before any AI call (es-generate generate + rewrite,
//      es-generate-image, trend-design titles, ad-rating), and goes ahead when
//      the RPC is missing
//   5. the migration and the sidebar card use the same function
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const gwPath = path.join(fnDir, '_ai-gateway.js');
const authPath = path.join(fnDir, '_supabase-auth.js');

// ── Mocks ──────────────────────────────────────────────────────────────────
let spend = { status: 200, body: [{ total_usd: 0, by_feature: {}, calls: 0 }] };
let spendRequests = [];
let aiRequests = 0;
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.endsWith('/rest/v1/rpc/frameup_my_ai_spend')) {
    spendRequests.push({ body: JSON.parse(options.body), headers: options.headers });
    if (spend.throws) throw new Error('network down');
    if (spend.badJson) return { ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } };
    return reply(spend.status, spend.body);
  }
  if (href.endsWith('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, 0);
  if (href.includes('/rest/v1/frameup_ai_usage')) return reply(201, {});
  if (href.startsWith('https://ai-gateway.vercel.sh/')) { aiRequests += 1; throw new Error('stop: AI reached'); }
  throw new Error(`unexpected fetch ${href}`);
};

process.env.AI_GATEWAY_API_KEY = 'gw-test';
delete process.env.GENERATE_AI;
delete process.env.AI_USER_WEEKLY_LIMIT_USD;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: headers => String(headers?.authorization || '').replace(/^Bearer\s+/i, ''),
  verifyEsUser: async () => ({ ok: true, user: { id: 'u1', email: 'designer@essentiallysports.com' } }),
} };
const gw = require(gwPath);
const { userOverWeeklyLimit, weeklyLimitMessage, weekStartUtc } = gw;
const MESSAGE = "You've reached this week's $20 AI limit. It resets Monday.";
const setSpend = usd => { spend = { status: 200, body: [{ total_usd: usd, by_feature: { generate: usd }, calls: 3 }] }; };

// ── 1. Week start ──────────────────────────────────────────────────────────
assert.equal(weekStartUtc(new Date('2026-11-17T10:00:00Z')).toISOString(), '2026-11-16T00:00:00.000Z', 'Tuesday → Monday');
assert.equal(weekStartUtc(new Date('2026-11-16T00:00:00Z')).toISOString(), '2026-11-16T00:00:00.000Z', 'Monday 00:00 is the start');
assert.equal(weekStartUtc(new Date('2026-11-15T23:59:59Z')).toISOString(), '2026-11-09T00:00:00.000Z', 'Sunday night is still last week');
assert.equal(weekStartUtc(new Date('2026-11-22T23:00:00Z')).toISOString(), '2026-11-16T00:00:00.000Z', 'Sunday → previous Monday');
assert.equal(weekStartUtc(new Date('2027-01-01T12:00:00Z')).toISOString(), '2026-12-28T00:00:00.000Z', 'across a year boundary');

// ── 2. userOverWeeklyLimit ─────────────────────────────────────────────────
assert.equal(weeklyLimitMessage(), MESSAGE);
setSpend(0);
assert.equal(await userOverWeeklyLimit('tok'), false, '$0 is under');
setSpend(19.99);
assert.equal(await userOverWeeklyLimit('tok'), false, '$19.99 is under');
setSpend(20);
assert.equal(await userOverWeeklyLimit('tok'), true, '$20 is at the cap');
setSpend('25.123456');
assert.equal(await userOverWeeklyLimit('tok'), true, 'numeric strings from PostgREST count');
spend = { status: 200, body: { total_usd: 30 } };
assert.equal(await userOverWeeklyLimit('tok'), true, 'a single-object reply counts too');
{
  spendRequests = [];
  setSpend(1);
  await userOverWeeklyLimit('tok-123');
  const [request] = spendRequests;
  assert.equal(request.headers.Authorization, 'Bearer tok-123', 'uses the caller\'s own session');
  assert.equal(request.headers.apikey, 'pk');
  assert.equal(request.body.p_since, weekStartUtc().toISOString(), 'asks for spend since Monday 00:00 UTC');
  assert.match(request.body.p_since, /T00:00:00\.000Z$/);
}
// Fails open.
spend = { status: 404, body: { message: 'Could not find the function public.frameup_my_ai_spend' } };
assert.equal(await userOverWeeklyLimit('tok'), false, 'missing function → allowed');
spend = { status: 500, body: {} };
assert.equal(await userOverWeeklyLimit('tok'), false, 'server error → allowed');
spend = { badJson: true };
assert.equal(await userOverWeeklyLimit('tok'), false, 'bad JSON → allowed');
spend = { throws: true };
assert.equal(await userOverWeeklyLimit('tok'), false, 'network error → allowed');
spend = { status: 200, body: [] };
assert.equal(await userOverWeeklyLimit('tok'), false, 'no row → allowed');
spend = { status: 200, body: [{ total_usd: null }] };
assert.equal(await userOverWeeklyLimit('tok'), false, 'null total → allowed');
spendRequests = [];
setSpend(50);
assert.equal(await userOverWeeklyLimit(''), false, 'no token → no check');
assert.equal(await userOverWeeklyLimit('tok', 0), false, 'cap 0 → off');
assert.equal(spendRequests.length, 0, 'no RPC without a token or with the cap off');

// ── 3. Env override (fresh process, the cap is read at load) ───────────────
{
  const probe = `
    const p = require('path'); const auth = p.resolve('netlify/functions/_supabase-auth.js');
    require.cache[auth] = { id: auth, filename: auth, loaded: true, exports: { authConfig: () => ({ url: 'https://db', publishableKey: 'pk' }) } };
    const spent = Number(process.env.PROBE_SPEND || 12);
    globalThis.fetch = async () => ({ ok: true, json: async () => [{ total_usd: spent }] });
    console.warn = () => {};
    const g = require(p.resolve('netlify/functions/_ai-gateway.js'));
    g.userOverWeeklyLimit('tok').then(over => console.log(JSON.stringify({ over, message: g.weeklyLimitMessage() })));`;
  const run = (value, spent = 12) => JSON.parse(execFileSync(process.execPath, ['-e', probe], { env: { ...process.env, AI_USER_WEEKLY_LIMIT_USD: value, PROBE_SPEND: String(spent) }, encoding: 'utf8' }).trim());
  assert.deepEqual(run('10'), { over: true, message: "You've reached this week's $10 AI limit. It resets Monday." }, 'env lowers the cap');
  assert.deepEqual(run('$10'), { over: true, message: "You've reached this week's $10 AI limit. It resets Monday." }, '"$10" parses');
  assert.deepEqual(run('15.5'), { over: false, message: "You've reached this week's $15.50 AI limit. It resets Monday." }, 'cents are shown');
  assert.equal(run('').over, false, 'empty env keeps the $20 default');
  assert.deepEqual(run('', 20), { over: true, message: MESSAGE }, '$20 by default');
  // Policy (owner 2026-11-20): an env value can't raise the person cap past $20.
  assert.deepEqual(run('50', 22), { over: true, message: MESSAGE }, '"50" is above the policy: the cap stays $20');
  assert.deepEqual(run('$50 USD', 22), { over: true, message: MESSAGE }, '"$50 USD" is above the policy too');
  assert.deepEqual(run('0', 22), { over: true, message: MESSAGE }, '0 no longer turns the cap off');
  assert.deepEqual(run('abc', 22), { over: true, message: MESSAGE }, 'garbage keeps $20');
}

// ── 4. Callers ─────────────────────────────────────────────────────────────
const handlers = {
  generate: require(path.join(fnDir, 'es-generate.js')).handler,
  image: require(path.join(fnDir, 'es-generate-image.js')).handler,
  trend: require(path.join(fnDir, 'trend-design.js')).handler,
  rating: require(path.join(fnDir, 'ad-rating.js')).handler,
};
const call = (handler, body) => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) })
  .then(r => ({ status: r.statusCode, body: JSON.parse(r.body || '{}') }));
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ' + 'A'.repeat(200);
const CONTEXT = { brandId: 'essentially-cfb', brandLabel: 'Essentially CFB', sport: 'cfb', objective: 'newsletter_signup', placement: '9x16', headline: 'Never miss a CFB upset', body: ['Daily college football, free.'], cta: 'SIGN UP ES CFB', frameTimes: [0.5] };
const cases = [
  ['es-generate (generate)', handlers.generate, { brief: 'Caitlin Clark scores 30 in the Fever win' }],
  ['es-generate (rewrite)', handlers.generate, { mode: 'rewrite', brief: 'Clark', spec: { postType: 'cover', fields: {} }, instruction: 'shorter' }],
  ['es-generate-image', handlers.image, { scene: 'empty football stadium at night' }],
  ['trend-design (titles)', handlers.trend, { mode: 'titles', title: 'Caitlin Clark breaks the record', related: [] }],
  ['ad-rating', handlers.rating, { frames: [JPEG], context: CONTEXT }],
];
// The fail-open runs reach the (mocked, failing) AI call; keep its error log quiet.
const quietError = console.error;
console.error = () => {};
for (const [name, handler, body] of cases) {
  setSpend(20.01);
  aiRequests = 0;
  const res = await call(handler, body);
  assert.equal(res.status, 200, `${name}: over the weekly cap → free mode, not an error`);
  assert.equal(res.body.ok, true, `${name}: ok`);
  assert.equal(res.body.mode, 'free', `${name}: mode free`);
  assert.equal(res.body.reason, 'user-limit', `${name}: reason`);
  assert.match(res.body.notice, /You've used this week's AI budget, so FrameUp is in free mode/, `${name}: the one friendly note`);
  assert.equal(res.body.error, undefined, `${name}: no raw error`);
  assert.equal(aiRequests, 0, `${name}: no AI call over the cap`);

  // RPC missing (migration not run): the request goes ahead (not a 429).
  spend = { status: 404, body: { message: 'function not found' } };
  const open = await call(handler, body);
  assert.notEqual(open.status, 429, `${name}: fails open when the RPC is missing`);

  // Under the cap: not blocked by the weekly check.
  setSpend(3.2);
  const under = await call(handler, body);
  assert.notEqual(under.status, 429, `${name}: under the cap is allowed`);
  assert.notEqual(under.body.mode, 'free', `${name}: under the cap is not free mode`);
}

console.error = quietError;

// ── 5. One function name everywhere ────────────────────────────────────────
const sql = readFileSync('supabase/migrations/20261117130000_frameup_my_ai_spend.sql', 'utf8');
assert.match(sql, /create or replace function public\.frameup_my_ai_spend\(p_since timestamptz\)/);
assert.match(sql, /returns table \(total_usd numeric, by_feature jsonb, calls integer\)/);
assert.match(sql, /security definer/);
assert.match(sql, /set search_path = public/);
assert.match(sql, /revoke all on function public\.frameup_my_ai_spend\(timestamptz\) from public, anon;/);
assert.match(sql, /grant execute on function public\.frameup_my_ai_spend\(timestamptz\) to authenticated;/);
assert.match(sql, /Undo:/);
const shell = readFileSync('app-shell.js', 'utf8');
assert.match(shell, /AI_WEEKLY_USER_LIMIT_USD = 20\b/, 'the sidebar card cap is one constant');
assert.match(shell, /rpc\('frameup_my_ai_spend'/, 'the sidebar card reads the same function');

console.log('test-ai-weekly-limit: all checks passed');
