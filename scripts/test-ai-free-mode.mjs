#!/usr/bin/env node
// AI budget policy and free mode (netlify/functions/_ai-gateway.js, every AI
// handler, frameup-ai-mode.js). Every network call is mocked: no AI, no
// Supabase, no Slack.
//   1. budget math: $20 a person, $45 the team, "$50"-style parsing, env only lowers
//   2. a Gateway budget reply (402, or 429 with budget words) -> free mode, never a raw error
//   3. every AI feature over a budget returns { ok: true, mode: 'free' } (table-driven)
//      with its no-AI result, and makes no AI call
//   4. annotateFree: the reply shape
//   5. /api/ai-status: the budget shape, resetsAt = next Monday 00:00 UTC
//   6. cron jobs: the team cap through the service role, never failing
//   7. the client helper: one /api/ai-status read a minute, the reply watcher
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const authPath = path.join(fnDir, '_supabase-auth.js');

for (const name of ['GENERATE_AI', 'AI_USER_WEEKLY_LIMIT_USD', 'AI_TEAM_WEEKLY_LIMIT_USD', 'AI_DISABLE', 'AI_DISABLE_FEATURES', 'AI_ECONOMY', 'AI_FAIL_CLOSED',
  'SLACK_AI_ALERTS_WEBHOOK_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'ES_MCP_ACCESS_TOKEN', 'ES_MCP_REFRESH_TOKEN',
  'ES_MCP_CLIENT_ID', 'REELS_TRANSCRIBE', 'XAI_API_KEY', 'X_BEARER_TOKEN']) delete process.env[name];
process.env.AI_GATEWAY_API_KEY = 'gw-test';

// ── Fetch mock ─────────────────────────────────────────────────────────────
let mySpend = 0;
let teamSpend = 0;
let summaryTotal = 0;
let gatewayReply = null; // () => { status, body }
let calls = [];
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  calls.push(href);
  if (href.endsWith('/rpc/frameup_my_ai_spend')) return reply(200, [{ total_usd: mySpend, by_feature: {}, calls: 1 }]);
  if (href.endsWith('/rpc/frameup_team_ai_spend')) return reply(200, [{ total_usd: teamSpend }]);
  if (href.endsWith('/rpc/frameup_ai_budget_summary')) return reply(200, { total_usd: summaryTotal, users: [] });
  if (href.endsWith('/rpc/frameup_my_ai_calls_last_hour')) return reply(200, 0);
  if (href.endsWith('/rpc/is_es_designer_admin')) return reply(200, true);
  if (href.includes('/rest/v1/')) return reply(200, []);
  if (href.startsWith('https://ai-gateway.vercel.sh/')) {
    if (!gatewayReply) throw new Error('stop: AI reached');
    const r = gatewayReply(options);
    return reply(r.status || 200, r.body);
  }
  throw new Error(`offline in tests: ${href}`);
};
const aiCalls = () => calls.filter(h => h.startsWith('https://ai-gateway.vercel.sh/') || h.includes('api.openai.com') || h.includes('api.groq.com')).length;

const realAuth = require(authPath);
require.cache[authPath].exports = {
  ...realAuth,
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  verifyEsUser: async () => ({ ok: true, user: { id: 'u1', email: 'designer@essentiallysports.com' } }),
};
const quiet = { warn: console.warn, error: console.error, log: console.log };
console.warn = () => {};
console.error = () => {};
const gw = require(path.join(fnDir, '_ai-gateway.js'));

// ── 1. Budget math ─────────────────────────────────────────────────────────
{
  assert.deepEqual({ ...gw.POLICY }, { userWeeklyUsd: 20, teamWeeklyUsd: 45, gatewayWeeklyUsd: 50 }, 'the owner policy, in code');
  assert.equal(gw.userWeeklyLimitUsd(), 20, '$20 a person with no env');
  assert.equal(gw.teamWeeklyLimitUsd(), 45, '$45 the team with no env');
  assert.equal(gw.USER_WEEKLY_LIMIT_USD, 20, 'the old export still reads the limit');
  for (const [raw, want] of [['50', 50], ['$50', 50], ['$ 50', 50], ['50 USD', 50], ['50.00', 50], ['1,000', 1000], ['12.5 dollars', 12.5], ['', null], ['abc', NaN]]) {
    const got = gw.parseUsd(raw);
    if (Number.isNaN(want)) assert.ok(Number.isNaN(got), `"${raw}" is unreadable`); else assert.equal(got, want, `"${raw}" parses`);
  }
  const cases = [
    ['AI_USER_WEEKLY_LIMIT_USD', '10', 10, false], ['AI_USER_WEEKLY_LIMIT_USD', '$15.50', 15.5, false], ['AI_USER_WEEKLY_LIMIT_USD', '20', 20, false],
    ['AI_USER_WEEKLY_LIMIT_USD', '$50', 20, true], ['AI_USER_WEEKLY_LIMIT_USD', '0', 20, true], ['AI_USER_WEEKLY_LIMIT_USD', 'lots', 20, true],
    ['AI_TEAM_WEEKLY_LIMIT_USD', '30', 30, false], ['AI_TEAM_WEEKLY_LIMIT_USD', '$45', 45, false], ['AI_TEAM_WEEKLY_LIMIT_USD', '50', 45, true],
    ['AI_TEAM_WEEKLY_LIMIT_USD', '-1', 45, true],
  ];
  for (const [name, value, want, ignored] of cases) {
    process.env[name] = value;
    const got = name.includes('TEAM') ? gw.teamWeeklyLimitUsd() : gw.userWeeklyLimitUsd();
    assert.equal(got, want, `${name}=${value} -> $${want}`);
    assert.equal(gw.aiGuardConfig().envIgnored.includes(name), ignored, `${name}=${value} ${ignored ? 'is' : 'is not'} reported as ignored`);
    delete process.env[name];
  }
  assert.equal(gw.weeklyLimitMessage(), "You've reached this week's $20 AI limit. It resets Monday.");
  // The gate: under, at the person cap, at the team cap.
  mySpend = 19.99; teamSpend = 44.99;
  assert.equal(await gw.aiSpendGate('tok', { feature: 'generate' }), null, 'under both caps');
  mySpend = 20;
  assert.equal((await gw.aiSpendGate('tok', { feature: 'generate' })).free, 'user-limit', '$20 spent -> free (user-limit)');
  mySpend = 1; teamSpend = 45;
  assert.equal((await gw.aiSpendGate('tok', { feature: 'generate' })).free, 'team-limit', '$45 team -> free (team-limit)');
  teamSpend = 0; mySpend = 0;
}

// ── 2. Gateway budget reply -> free mode ───────────────────────────────────
{
  assert.equal(gw.isGatewayBudgetReply(402, ''), true, '402 is always the budget');
  assert.equal(gw.isGatewayBudgetReply(429, 'Monthly quota exceeded'), true, '429 with quota words');
  assert.equal(gw.isGatewayBudgetReply(429, 'Your budget has been reached'), true);
  assert.equal(gw.isGatewayBudgetReply(403, 'insufficient credit'), true);
  assert.equal(gw.isGatewayBudgetReply(429, 'Too many requests, slow down'), false, 'a plain rate limit is not the budget');
  assert.equal(gw.isGatewayBudgetReply(500, 'budget'), false);

  calls = [];
  gatewayReply = () => ({ status: 402, body: { error: { message: 'Spend limit reached for this API key' } } });
  const track = { feature: 'generate', email: 'd@essentiallysports.com', token: 'tok' };
  const handler = gw.withAiMode(async () => {
    let first = null;
    try { await gw.aiText({ messages: [{ role: 'user', content: 'hi' }], track }); } catch (error) { first = error; }
    assert.equal(first.code, 'free-mode', 'the budget reply becomes a free-mode error');
    assert.equal(first.reason, 'gateway-budget');
    assert.equal(gw.isBudgetError(first), true, 'old budget fallbacks still fire');
    assert.equal(gw.inFreeMode(), true, 'the rest of the request is in free mode');
    assert.equal(gw.gatewayConfigured(), false, 'so no-AI paths take over');
    const before = aiCalls();
    await assert.rejects(gw.aiText({ messages: [{ role: 'user', content: 'again' }], track }), { code: 'free-mode' });
    await assert.rejects(gw.aiImage({ prompt: 'x', track }), { code: 'free-mode' });
    await assert.rejects(gw.aiWebResearch({ prompt: 'x', track }), { code: 'free-mode' });
    await assert.rejects(gw.aiTranscribe({ audio: 'AA==', track }), { code: 'free-mode' });
    assert.equal(aiCalls(), before, 'no more Gateway calls in this request');
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, designs: [1] }) };
  });
  const res = await handler({});
  const body = JSON.parse(res.body);
  assert.deepEqual([body.ok, body.mode, body.reason, body.designs], [true, 'free', 'gateway-budget', [1]], 'the reply says free mode and keeps its result');
  assert.match(body.notice, /^The team's AI budget for this week is used up, so FrameUp is in free mode\. AI features come back Monday\.$/);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  // The cost of the refused call is logged as a failed row (cost 0).
  assert.ok(calls.some(h => h.includes('/rest/v1/frameup_ai_usage')), 'the refused call is still logged');
  // The next request tries the Gateway again (AI comes back with the budget).
  gatewayReply = () => ({ status: 200, body: { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } } });
  const next = await gw.withAiMode(async () => {
    const r = await gw.aiText({ tier: 'main', messages: [{ role: 'user', content: 'hi' }], track });
    return { statusCode: 200, body: JSON.stringify({ ok: true, text: r.text }) };
  })({});
  assert.equal(JSON.parse(next.body).mode, undefined, 'a later request runs with AI again');
  assert.equal(gw.gatewayBudgetRecent(), true, '/api/ai-status still says gateway-budget for a while');
  gw._resetFreeMode();
  gatewayReply = null;
  // Outside a request nothing sticks.
  assert.equal(gw.inFreeMode(), false);
}

// ── 3. Every feature, over a budget ────────────────────────────────────────
process.env.GROQ_API_KEY = 'groq-test'; // a transcription provider is set up
const handlers = {
  generate: require(path.join(fnDir, 'es-generate.js')).handler,
  image: require(path.join(fnDir, 'es-generate-image.js')).handler,
  trend: require(path.join(fnDir, 'trend-design.js')).handler,
  rating: require(path.join(fnDir, 'ad-rating.js')).handler,
  videoAds: require(path.join(fnDir, 'video-ads.js')).handler,
  reels: require(path.join(fnDir, 'reel-maker.js')).handler,
  captions: require(path.join(fnDir, 'es-video-intelligence.js')).handler,
  removeBg: require(path.join(fnDir, 'remove-bg.js')).handler,
  assets: require(path.join(fnDir, 'gen-assets.js')).handler,
};
require(path.join(fnDir, 'video-ads.js'))._test.useLearning({});
const call = (handler, body) => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body), queryStringParameters: {} })
  .then(r => ({ status: r.statusCode, body: JSON.parse(r.body || '{}') }));
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ' + 'A'.repeat(200);
const CONTEXT = { brandId: 'essentially-cfb', brandLabel: 'Essentially CFB', sport: 'cfb', objective: 'newsletter_signup', placement: '9x16', headline: 'Never miss a CFB upset', body: ['Daily college football, free.'], cta: 'SIGN UP ES CFB', frameTimes: [0.5] };
const AD = { brandId: 'essentially-cfb', sport: 'cfb', trend: { title: 'Alabama stuns Georgia in Tuscaloosa' }, teams: ['Alabama'] };
// [name, handler, body, skipped?, check(body)]
const FEATURES = [
  ['Generate: ES template designs (rules)', handlers.generate, { brief: 'Caitlin Clark scores 30 in the Fever win over the Sky' }, false, b => assert.ok(Array.isArray(b.designs) && b.designs.length, 'designs from the rules')],
  ['Generate: directions step -> no director', handlers.generate, { mode: 'direct', brief: 'Caitlin Clark scores 30 in the Fever win' }, false, b => assert.deepEqual(b.directions, [])],
  ['Generate: judge -> rule-check picks and critique', handlers.generate, { mode: 'creative-judge', brief: 'x', sets: [{ direction: 'd1', archetype: 'big-number', items: [{ id: 'a', image: JPEG }, { id: 'b', image: JPEG }] }], heuristics: { a: { score: 3 }, b: { score: 7, fix: 'contrast' } } }, false, b => { assert.equal(b.source, 'heuristic'); assert.equal(b.directions[0].best, 'b'); }],
  ['Generate: assistant -> free local edits only', handlers.generate, { mode: 'creative-assist', instruction: 'rewrite this in the style of a poem', scene: { kind: 'composed', size: { w: 1080, h: 1350 }, archetype: 'big-number', layers: [] } }, true],
  ['Generate: AI rewrite', handlers.generate, { mode: 'rewrite', brief: 'Clark', spec: { postType: 'cover', fields: {} }, instruction: 'shorter' }, true],
  ['Generate: on-brand (vision)', handlers.generate, { mode: 'onbrand', images: [JPEG] }, true],
  ['Generate: AI scene image', handlers.image, { scene: 'empty football stadium at night' }, true],
  ['Gen assets: AI background', handlers.assets, { op: 'background', prompt: 'stadium lights', style: 'photo', size: '1080x1350' }, true],
  ['Video Ads: copy from rule-based templates', handlers.videoAds, { mode: 'copy', ...AD }, false, b => { assert.equal(b.source, 'template'); assert.ok(b.variants.length >= 2, 'template variants'); assert.equal(b.cost, 0); }],
  ['Video Ads: clip search = library + free sources', handlers.videoAds, { mode: 'find-clips', sport: 'cfb', query: 'alabama upset' }, false, b => assert.ok(Array.isArray(b.clips))],
  ['Video Ads: grammar check', handlers.videoAds, { mode: 'grammar', ...AD, copy: { headline: 'Big upset', body: ['Read it free.'] } }, true],
  ['Video Ads: assistant chat', handlers.videoAds, { mode: 'chat', ...AD, messages: [{ role: 'user', content: 'shorter please' }] }, true],
  ['Video Ads: ad rating', handlers.rating, { frames: [JPEG], context: CONTEXT }, true],
  ['Trends: AI angles -> rule-based ideas', handlers.trend, { mode: 'enrich', items: [{ id: 't1', title: 'Caitlin Clark breaks the scoring record', related: [], sport: 'WNBA' }] }, false, b => { assert.equal(b.ai, false); assert.ok(b.items.t1.titles.length, 'rule ideas'); }],
  ['Trends: headline ideas -> rules', handlers.trend, { mode: 'titles', title: 'Caitlin Clark breaks the scoring record', related: [] }, false, b => { assert.equal(b.ai, false); assert.ok(b.titles.length); }],
  ['Reels: plan = code plan, no director', handlers.reels, { mode: 'plan', brief: 'Josh Allen threw for 5,477 yards in 2025, the most in Bills history.', format: 'stat' }, false, b => { assert.equal(b.source, 'draft'); assert.ok(b.plan.beats.length >= 3); assert.equal(b.cost, 0); }],
  ['Reels: voice off (captions only)', handlers.reels, { mode: 'voice', text: 'Josh Allen did it again.', beat: 'b1' }, true],
  ['Reels: clip judge -> code ranking', handlers.reels, { mode: 'clip-judge', clips: [], subjects: [] }, true],
  ['Reels: transcription off', handlers.captions, { action: 'transcribe', fileName: 'a.wav', mimeType: 'audio/wav', data: Buffer.from('fake').toString('base64') }, true],
  ['Editor: remove background', handlers.removeBg, { image: JPEG }, true],
];
process.env.OPENAI_API_KEY = 'sk-test'; // remove-bg is set up
for (const [reason, set] of [['user-limit', () => { mySpend = 20.5; teamSpend = 0; }], ['team-limit', () => { mySpend = 1; teamSpend = 45.01; }]]) {
  for (const [name, handler, body, skipped, check] of FEATURES) {
    set();
    calls = [];
    const res = await call(handler, body);
    const label = `${name} (${reason})`;
    assert.equal(res.status, 200, `${label}: 200, not an error (${JSON.stringify(res.body).slice(0, 200)})`);
    assert.equal(res.body.ok, true, `${label}: ok`);
    assert.equal(res.body.mode, 'free', `${label}: mode free`);
    assert.equal(res.body.reason, reason, `${label}: reason`);
    assert.equal(res.body.notice, gw.freeModeNotice(reason), `${label}: the one note`);
    assert.equal(res.body.error, undefined, `${label}: no raw error`);
    assert.equal(Boolean(res.body.skipped), skipped, `${label}: ${skipped ? 'skipped (AI-only)' : 'the no-AI result'}`);
    assert.equal(aiCalls(), 0, `${label}: no AI call`);
    if (check) check(res.body);
  }
}
mySpend = 0; teamSpend = 0;
// Under both caps nothing is free mode.
{
  calls = [];
  const res = await call(handlers.trend, { mode: 'titles', title: 'Caitlin Clark breaks the scoring record', related: [] });
  assert.notEqual(res.body.mode, 'free', 'under the caps: not free mode');
}
// Non-AI work is never blocked, even over both caps.
{
  mySpend = 50; teamSpend = 60;
  const res = await call(handlers.videoAds, { mode: 'suggest-style', brandId: 'essentially-cfb', sport: 'cfb' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  mySpend = 0; teamSpend = 0;
}

// ── 4. annotateFree ────────────────────────────────────────────────────────
{
  const make = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }, body: JSON.stringify(body) });
  let out = gw.annotateFree(make(200, { ok: true, mode: 'direct', directions: [] }), { free: 'user-limit' });
  let body = JSON.parse(out.body);
  assert.deepEqual([body.mode, body.requestMode, body.reason], ['free', 'direct', 'user-limit'], 'a reply\'s own mode is kept as requestMode');
  assert.equal(out.headers['Cache-Control'], 'no-store', 'a free reply is never cached by the CDN');
  out = gw.annotateFree(make(503, { error: 'AI is off', reason: 'off' }), { free: 'team-limit' });
  body = JSON.parse(out.body);
  assert.deepEqual([out.statusCode, body.ok, body.skipped, body.error], [200, true, true, undefined], 'an AI-only reply becomes skipped');
  out = gw.annotateFree(make(400, { error: 'Write a brief.' }), { free: 'team-limit' });
  assert.equal(out.statusCode, 400, 'a bad request stays a bad request');
  out = gw.annotateFree(make(429, { error: "You've reached this week's $20 AI limit.", reason: 'weekly-limit' }), {});
  assert.equal(JSON.parse(out.body).reason, 'user-limit', 'an old weekly-limit reply converts');
  out = gw.annotateFree(make(503, { error: 'This image would cost more than the run allows.', reason: 'budget' }), {});
  assert.equal(out.statusCode, 503, 'a per-run cost cap is not the weekly budget');
  out = gw.annotateFree(make(429, { error: 'Lots this hour.', reason: 'limit' }), {});
  assert.equal(out.statusCode, 429, 'the hourly limit is not free mode');
  gw._resetFreeMode();
}

// ── 5. /api/ai-status ──────────────────────────────────────────────────────
{
  const status = require(path.join(fnDir, 'ai-status.js'));
  mySpend = 12.3456; teamSpend = 30;
  let got = JSON.parse((await status.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer tok' } })).body);
  assert.deepEqual(
    { mode: got.mode, reason: got.reason, userLimitUsd: got.userLimitUsd, userSpentUsd: got.userSpentUsd, teamLimitUsd: got.teamLimitUsd, teamSpentUsd: got.teamSpentUsd, gatewayBudgetUsd: got.gatewayBudgetUsd, admin: got.admin },
    { mode: 'ai', reason: null, userLimitUsd: 20, userSpentUsd: 12.3456, teamLimitUsd: 45, teamSpentUsd: 30, gatewayBudgetUsd: 50, admin: true },
  );
  const reset = new Date(got.resetsAt);
  assert.equal(reset.getUTCDay(), 1, 'resets on a Monday');
  assert.equal(reset.toISOString().slice(11), '00:00:00.000Z', 'at 00:00 UTC');
  assert.ok(reset > new Date() && reset - new Date() <= 7 * 864e5, 'the next one');
  assert.equal(gw.nextWeekStartUtc(new Date('2026-11-18T10:00:00Z')).toISOString(), '2026-11-23T00:00:00.000Z');
  assert.equal(gw.nextWeekStartUtc(new Date('2026-11-23T00:00:00Z')).toISOString(), '2026-11-30T00:00:00.000Z', 'Monday 00:00 -> the following Monday');
  mySpend = 20;
  got = JSON.parse((await status.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer tok' } })).body);
  assert.deepEqual([got.mode, got.reason], ['free', 'user-limit']);
  assert.equal(got.notice, gw.FREE_NOTES.user);
  mySpend = 1; teamSpend = 45;
  got = JSON.parse((await status.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer tok' } })).body);
  assert.deepEqual([got.mode, got.reason], ['free', 'team-limit']);
  teamSpend = 0;
  gw.markGatewayBudget();
  got = JSON.parse((await status.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer tok' } })).body);
  assert.deepEqual([got.mode, got.reason], ['free', 'gateway-budget'], 'a recent Gateway budget reply shows');
  gw._resetFreeMode();
  mySpend = 0;
}

// ── 6. Cron jobs ───────────────────────────────────────────────────────────
{
  assert.equal(await gw.cronSpendGate({ feature: 'clips-classify' }), null, 'no service key: the job goes ahead (its own per-run cap holds)');
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  summaryTotal = 44;
  assert.equal(await gw.cronSpendGate({ feature: 'clips-classify' }), null, 'under the team cap');
  summaryTotal = 45;
  const gate = await gw.cronSpendGate({ feature: 'clips-classify' });
  assert.equal(gate.free, 'team-limit', 'at the team cap: skip the AI work');
  const prefetch = require(path.join(fnDir, 'clips-prefetch.js'))._test;
  const out = await prefetch.classifyPass({ capUsd: 0.3, runId: 'r' });
  assert.equal(out.off, 'team-limit', 'the classify pass is skipped, not failed');
  assert.equal(out.classified, 0);
  summaryTotal = 0;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// ── 7. Client helper ───────────────────────────────────────────────────────
{
  const AI = require(path.resolve('frameup-ai-mode.js'));
  let now = 1_000_000;
  let statusReads = 0;
  let statusBody = { ok: true, mode: 'free', reason: 'team-limit', userLimitUsd: 20, userSpentUsd: 3, teamLimitUsd: 45, teamSpentUsd: 45.2 };
  const store = new Map();
  const fakeWin = {
    sessionStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    ESAuth: { fetchWithAuth: async url => { assert.equal(url, '/api/ai-status'); statusReads += 1; return reply(200, statusBody); } },
  };
  AI._test.reset(fakeWin, () => now);
  const seen = [];
  AI.onChange(next => seen.push(next.mode));
  assert.equal(AI.mode, 'unknown');
  const first = await AI.status();
  assert.equal(first.mode, 'free');
  assert.equal(AI.mode, 'free');
  assert.equal(AI.notice, AI.NOTES.team);
  assert.deepEqual(seen, ['free'], 'listeners hear the change once');
  await AI.status();
  await Promise.all([AI.status(), AI.status()]);
  assert.equal(statusReads, 1, 'one read within 60 s');
  now += 30_000;
  await AI.status();
  assert.equal(statusReads, 1, 'still cached at 30 s');
  now += 31_000;
  statusBody = { ok: true, mode: 'ai', reason: null, userLimitUsd: 20 };
  await AI.status();
  assert.equal(statusReads, 2, 'read again after a minute');
  assert.equal(AI.mode, 'ai');
  await AI.status({ force: true });
  assert.equal(statusReads, 3, 'force skips the cache');
  // A new page in the same tab uses the session cache.
  AI._test.reset(fakeWin, () => now);
  await AI.status();
  assert.equal(statusReads, 3, 'sessionStorage carries the minute across pages');
  // The reply watcher.
  assert.equal(AI.isOwnApi('/api/video-ads', 'https://frameup.test/video-ads.html'), true);
  assert.equal(AI.isOwnApi('/api/ai-status', 'https://frameup.test/'), false, 'the status call itself is not watched');
  assert.equal(AI.isOwnApi('https://api.cloudinary.com/v1_1/x', 'https://frameup.test/'), false);
  const plain = reply(200, { ok: true, variants: [1] });
  assert.equal(await AI.adaptResponse(plain), plain, 'an AI reply passes through untouched');
  const freeOk = reply(200, { ok: true, mode: 'free', reason: 'user-limit', variants: [1] });
  assert.equal(await AI.adaptResponse(freeOk), freeOk, 'a free reply with a result passes through');
  assert.equal(AI.mode, 'free', '...and switches the page to free mode');
  assert.equal(AI.reason, 'user-limit');
  const skipped = await AI.adaptResponse(reply(200, { ok: true, mode: 'free', reason: 'user-limit', skipped: true, notice: AI.NOTES.user }));
  assert.equal(skipped.status, 503, 'a skipped AI-only reply reaches old code as an error...');
  const data = await skipped.json();
  assert.equal(data.error, AI.NOTES.user, '...whose message is the one friendly note');
  assert.equal(data.reason, 'user-limit');
  assert.equal(AI.noteFor('gateway-budget'), AI.NOTES.team);
  assert.equal(AI.NOTES.user, gw.FREE_NOTES.user, 'client and server use the same words');
  assert.equal(AI.NOTES.team, gw.FREE_NOTES.team);
}

console.warn = quiet.warn;
console.error = quiet.error;
console.log('test-ai-free-mode: all checks passed');
