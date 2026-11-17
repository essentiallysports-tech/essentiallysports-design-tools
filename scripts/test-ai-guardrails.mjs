#!/usr/bin/env node
// AI guardrails (netlify/functions/_ai-gateway.js, _ai-alerts.js,
// ai-budget-watch.js, ai-status.js, ai-usage-summary.js). Every network call is
// mocked: no AI, no Supabase, no Slack message is ever sent.
//   1. prices: Anthropic list prices, every default model priced, long context, audio
//   2. kill switches (AI_DISABLE): no fetch, feature and task names, prefixes, "all"
//   3. economy mode (AI_ECONOMY=1): best runs on main
//   4. team cap (AI_TEAM_WEEKLY_LIMIT_USD): off when unset, under, at, over
//   5. fail open with a warning event / fail closed with AI_FAIL_CLOSED=1
//   6. every AI handler: team-limit 429, feature-off 503 with no AI call, trend rules
//   7. logUsage: cache tokens, task, run id; works before the migration (PGRST204)
//   8. prompt cache: tiny prompts not marked, rejected hint warns, Video Ads copy, Generate prefix
//   9. alerts with a mocked webhook: thresholds, once per week, user 80%, off without env
//  10. cron secret on /api/ai-budget-watch
//  11. Reels transcription (OpenAI) logs one usage row with the audio cost
//  12. /api/ai-status, the dashboard summary and the migration
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const authPath = path.join(fnDir, '_supabase-auth.js');

// ── Environment: AI on, every guardrail env unset ──────────────────────────
process.env.AI_GATEWAY_API_KEY = 'gw-test';
for (const name of ['GENERATE_AI', 'AI_USER_WEEKLY_LIMIT_USD', 'AI_TEAM_WEEKLY_LIMIT_USD', 'AI_DISABLE', 'AI_DISABLE_FEATURES', 'AI_ECONOMY', 'AI_FAIL_CLOSED',
  'SLACK_AI_ALERTS_WEBHOOK_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'GROQ_API_KEY', 'ES_MCP_ACCESS_TOKEN', 'ES_MCP_REFRESH_TOKEN', 'ES_MCP_CLIENT_ID',
  'AI_LIGHT_MODEL', 'AI_MAIN_MODEL', 'AI_SEARCH_MODEL', 'AI_REVIEW_MODEL', 'AI_BEST_MODEL', 'AI_IMAGE_MODEL']) delete process.env[name];
// Reels: OpenAI is the only transcription provider (read at load).
process.env.OPENAI_API_KEY = 'sk-test-openai';
process.env.OPENAI_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';

// ── Fetch mock ─────────────────────────────────────────────────────────────
const SLACK = 'https://hooks.slack.test/services/T000/B000/fake';
let calls = [];
let mySpend = { status: 200, body: [{ total_usd: 0 }] };
let teamSpend = { status: 200, body: [{ total_usd: 0 }] };
let usageInsert = { status: 201, body: {} };
let gatewayReply = null; // function(body) -> { status, body }
let summary = { total_usd: 0, users: [] };
let adminFlag = false;
const claimed = new Set();
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  const body = typeof options.body === 'string' ? (() => { try { return JSON.parse(options.body); } catch { return options.body; } })() : options.body;
  calls.push({ href, body, headers: options.headers || {} });
  if (href.endsWith('/rpc/frameup_my_ai_spend')) {
    if (mySpend.throws) throw new Error('network down');
    return reply(mySpend.status, mySpend.body);
  }
  if (href.endsWith('/rpc/frameup_team_ai_spend')) {
    if (teamSpend.throws) throw new Error('network down');
    return reply(teamSpend.status, teamSpend.body);
  }
  if (href.endsWith('/rpc/frameup_my_ai_calls_last_hour')) return reply(200, 0);
  if (href.endsWith('/rpc/frameup_ai_budget_summary')) return reply(200, summary);
  if (href.endsWith('/rpc/is_es_designer_admin')) return reply(200, adminFlag);
  if (href.endsWith('/rpc/frameup_ai_alert_claim')) {
    const fresh = !claimed.has(body.p_key);
    claimed.add(body.p_key);
    return reply(200, fresh);
  }
  if (href.includes('/rest/v1/frameup_ai_usage')) return reply(usageInsert.status, usageInsert.body);
  if (href.includes('/rest/v1/')) return reply(200, []);
  if (href === SLACK) return reply(200, 'ok');
  if (href.startsWith('https://ai-gateway.vercel.sh/')) {
    if (!gatewayReply) throw new Error('stop: AI reached');
    const r = gatewayReply(body, href);
    return reply(r.status || 200, r.body);
  }
  if (href === 'https://api.openai.com/v1/audio/transcriptions') {
    return reply(200, { text: 'big shot from deep', language: 'english', duration: 90, segments: [{ start: 0, end: 2, text: 'big shot from deep' }] });
  }
  throw new Error(`unexpected fetch ${href}`);
};
const fetched = test => calls.filter(c => test(c.href));
const aiCalls = () => fetched(h => h.startsWith('https://ai-gateway.vercel.sh/')).length;
const slackPosts = () => calls.filter(c => c.href === SLACK);

// Quiet, captured warnings (guard events are JSON lines).
const warnings = [];
const realWarn = console.warn;
const realError = console.error;
console.warn = (...args) => { warnings.push(args.join(' ')); };
console.error = () => {};
const guardEvents = kind => warnings.filter(w => w.includes('"event":"ai-guard-warning"') && w.includes(`"kind":"${kind}"`));

require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: headers => String(headers?.authorization || headers?.Authorization || '').replace(/^Bearer\s+/i, ''),
  isEsEmail: () => true,
  verifyEsUser: async event => (String(event?.headers?.authorization || '').startsWith('Bearer ')
    ? { ok: true, user: { id: 'u1', email: 'designer@essentiallysports.com' } }
    : { ok: false, statusCode: 401, error: 'Authentication required.' }),
} };
const gw = require(path.join(fnDir, '_ai-gateway.js'));
const alerts = require(path.join(fnDir, '_ai-alerts.js'));
const track = { feature: 'generate', email: 'designer@essentiallysports.com', token: 'tok' };
const okText = text => () => ({ body: { content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 }, stop_reason: 'end_turn' } });
const reset = () => { calls = []; warnings.length = 0; };

// ── 1. Prices ──────────────────────────────────────────────────────────────
{
  const P = gw.PRICES;
  assert.deepEqual([P['anthropic/claude-sonnet-5.5'].input, P['anthropic/claude-sonnet-5.5'].output, P['anthropic/claude-sonnet-5.5'].cacheRead, P['anthropic/claude-sonnet-5.5'].cacheWrite], [2, 10, 0.10, 2.5], 'Sonnet 5.5: $2 / $10, cache read $0.10, write $2.50');
  assert.deepEqual([P['anthropic/claude-haiku-5.5'].input, P['anthropic/claude-haiku-5.5'].output, P['anthropic/claude-haiku-5.5'].cacheRead, P['anthropic/claude-haiku-5.5'].cacheWrite], [0.10, 0.50, 0.01, 0.125], 'Haiku 5.5: $0.10 / $0.50, cache 0.1x / 1.25x');
  assert.deepEqual([P['anthropic/claude-opus-5.5'].input, P['anthropic/claude-opus-5.5'].output, P['anthropic/claude-opus-5.5'].cacheRead, P['anthropic/claude-opus-5.5'].cacheWrite], [4, 20, 0.20, 5], 'Opus 5.5: $4 / $20, cache read $0.20, write $5');
  // Every Anthropic cache write is 1.25x input (5-minute TTL).
  for (const [model, price] of Object.entries(P)) if (price.cacheWrite) assert.equal(Number((price.cacheWrite / price.input).toFixed(3)), 1.25, `${model}: 5-minute write is 1.25x`);
  // Every default text model has a price; the default image model too.
  for (const [tier, model] of Object.entries(gw.MODELS)) {
    if (tier === 'image') assert.ok(gw.IMAGE_PRICES[model] > 0, `image model ${model} is priced`);
    else assert.ok(P[model], `${tier} model ${model} has a PRICES entry`);
  }
  const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
  close(gw.costUsd('anthropic/claude-sonnet-5.5', { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }), 2 + 10 + 0.10 + 2.5, 'Sonnet cost');
  close(gw.costUsd('anthropic/claude-haiku-5.5', { input: 2000, output: 1000, cacheRead: 3000 }), 2000 * 0.10e-6 + 1000 * 0.50e-6 + 3000 * 0.01e-6, 'Haiku cost');
  close(gw.costUsd('anthropic/claude-haiku-5.5', { input: 120000, output: 1000 }), 120000 * 0.50e-6 + 1000 * 2.50e-6, 'Haiku over 100K tokens bills the long-context rate');
  close(gw.costUsd('unknown/model', { input: 50000 }), 0.005, 'unknown models count at main rates');
  close(gw.audioCostUsd('gpt-4o-transcribe', 90), 0.009, '90 s of gpt-4o-transcribe');
  close(gw.audioCostUsd('gpt-4o-mini-transcribe', 60), 0.003, 'a minute of the mini model');
}

// ── 2. Kill switches ───────────────────────────────────────────────────────
{
  process.env.AI_DISABLE = 'video-ads-find-clips, Trend-Enrich ,generate-director';
  assert.equal(gw.featureDisabled('video-ads-find-clips'), true);
  assert.equal(gw.featureDisabled('trend-enrich'), true, 'names are trimmed and case-insensitive');
  assert.equal(gw.featureDisabled('trend-enrich-backup'), true, 'the backup rows of a feature count');
  assert.equal(gw.featureDisabled('generate-director'), true);
  assert.equal(gw.featureDisabled('generate'), false, 'a sub-feature does not switch off its parent');
  assert.equal(gw.featureDisabled('video-ads-copy'), false);
  process.env.AI_DISABLE = 'generate';
  assert.equal(gw.featureDisabled('generate-escalate'), true, 'a parent covers its sub-features');
  assert.equal(gw.featureDisabled('generate-rewrite-best'), true);
  process.env.AI_DISABLE = 'all';
  assert.equal(gw.featureDisabled('video-ads-chat'), true, '"all" switches everything off');
  process.env.AI_DISABLE = '';
  process.env.AI_DISABLE_FEATURES = 'trend-headlines';
  assert.equal(gw.featureDisabled('trend-headlines'), true, 'AI_DISABLE_FEATURES is an alias');
  delete process.env.AI_DISABLE_FEATURES;
  assert.equal(gw.featureDisabled('trend-headlines'), false, 'nothing off by default');

  process.env.AI_DISABLE = 'video-ads-find-clips,generate-scene-image,generate-writer';
  reset();
  await assert.rejects(gw.aiWebResearch({ prompt: 'x', track: { ...track, feature: 'video-ads-find-clips' } }), error => error.code === 'feature-off' && error.status === 503 && /Clip search is switched off/.test(error.message));
  await assert.rejects(gw.aiImage({ prompt: 'x', track: { ...track, feature: 'generate-scene-image' } }), error => error.code === 'feature-off' && /AI scene images is switched off/.test(error.message));
  await assert.rejects(gw.aiText({ tier: 'main', messages: [{ role: 'user', content: 'hi' }], track: { ...track, task: 'generate-writer' } }), error => error.code === 'feature-off', 'a task name switches off too');
  assert.equal(calls.length, 0, 'a switched-off feature makes no fetch at all (no AI call, no usage row)');
  assert.equal(gw.isBudgetError(gw.featureOffError('generate')), false, 'switched off is not a budget error');
  gatewayReply = okText('hello');
  const passed = await gw.aiText({ tier: 'main', messages: [{ role: 'user', content: 'hi' }], track: { ...track, feature: 'video-ads-copy' } });
  assert.equal(passed.text, 'hello', 'other features call through');
  assert.equal(aiCalls(), 1);
  delete process.env.AI_DISABLE;
  assert.match(gw.featureOffMessage('video-ads-chat'), /^The Video Ads assistant is switched off for now\. Everything else in FrameUp still works\.$/);
  assert.match(gw.featureOffMessage('something-new'), /^This AI feature is switched off/);
}

// ── 3. Economy mode ────────────────────────────────────────────────────────
{
  reset();
  gatewayReply = okText('ok');
  const normal = await gw.aiText({ tier: 'best', messages: [{ role: 'user', content: 'hi' }], track });
  assert.equal(normal.model, 'anthropic/claude-sonnet-5.5', 'best is Sonnet by default');
  process.env.AI_ECONOMY = '1';
  const cheap = await gw.aiText({ tier: 'best', messages: [{ role: 'user', content: 'hi' }], track });
  assert.equal(cheap.model, 'anthropic/claude-haiku-5.5', 'economy: best runs on Haiku');
  const sent = fetched(h => h.endsWith('/messages')).map(c => c.body.model);
  assert.deepEqual(sent, ['anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5'], 'the request body names the routed model');
  const logged = fetched(h => h.includes('/frameup_ai_usage')).map(c => c.body.model);
  assert.equal(logged[1], 'anthropic/claude-haiku-5.5', 'the usage row records the model that ran');
  assert.equal(gw.modelFor('review'), gw.MODELS.review, 'economy leaves other tiers alone');
  assert.equal(gw.modelFor('main'), gw.MODELS.main);
  process.env.AI_ECONOMY = 'off';
  assert.equal(gw.modelFor('best'), gw.MODELS.best, 'only 1/true/yes/on turn it on');
  delete process.env.AI_ECONOMY;
}

// ── 4. Team cap ────────────────────────────────────────────────────────────
{
  reset();
  assert.equal(gw.teamWeeklyLimitUsd(), 0, 'off when unset');
  assert.equal(await gw.aiSpendGate('tok', { feature: 'generate' }), null);
  assert.equal(fetched(h => h.endsWith('frameup_team_ai_spend')).length, 0, 'no team RPC while the team cap is off');
  for (const bad of ['', '0', '-5', 'abc']) { process.env.AI_TEAM_WEEKLY_LIMIT_USD = bad; assert.equal(gw.teamWeeklyLimitUsd(), 0, `"${bad}" keeps the team cap off`); }
  process.env.AI_TEAM_WEEKLY_LIMIT_USD = '60';
  teamSpend = { status: 200, body: [{ total_usd: 59.99 }] };
  assert.equal(await gw.aiSpendGate('tok', { feature: 'generate' }), null, 'under the team cap');
  const [request] = fetched(h => h.endsWith('frameup_team_ai_spend'));
  assert.equal(request.headers.Authorization, 'Bearer tok', 'team spend is read with the caller\'s session');
  assert.equal(request.body.p_since, gw.weekStartUtc().toISOString(), 'since Monday 00:00 UTC');
  teamSpend = { status: 200, body: [{ total_usd: '60' }] };
  assert.deepEqual(await gw.aiSpendGate('tok', { feature: 'generate' }), {
    status: 429, reason: 'team-limit',
    error: "The team has used this week's $60 AI budget, so AI features are paused until Monday. Everything else still works.",
  }, 'at the team cap');
  teamSpend = { status: 200, body: { total_usd: 75 } };
  assert.equal((await gw.aiSpendGate('tok', {})).reason, 'team-limit', 'a scalar-object reply counts');
  assert.equal(await gw.teamOverWeeklyLimit('tok'), true);
  // The person's own cap is checked first.
  mySpend = { status: 200, body: [{ total_usd: 25 }] };
  assert.equal((await gw.aiSpendGate('tok', {})).reason, 'weekly-limit', 'the personal cap message wins');
  mySpend = { status: 200, body: [{ total_usd: 0 }] };
  // A switched-off feature beats every cap and reads no spend.
  process.env.AI_DISABLE = 'generate';
  reset();
  assert.equal((await gw.aiSpendGate('tok', { feature: 'generate' })).reason, 'feature-off');
  assert.equal(calls.length, 0, 'switched off: no spend read');
  delete process.env.AI_DISABLE;
  assert.equal(gw.teamLimitMessage(62.5), "The team has used this week's $62.50 AI budget, so AI features are paused until Monday. Everything else still works.");
  teamSpend = { status: 200, body: [{ total_usd: 0 }] };
}

// ── 5. Fail open (warning event) / fail closed ─────────────────────────────
{
  reset();
  mySpend = { status: 404, body: { message: 'function not found' } };
  assert.equal(await gw.aiSpendGate('tok', {}), null, 'fails open by default');
  assert.equal(guardEvents('user-spend-unreadable').length, 1, 'a warning event is logged');
  const event = JSON.parse(guardEvents('user-spend-unreadable')[0]);
  assert.equal(event.why, 'http-404');
  assert.equal(event.failClosed, false);
  await gw.aiSpendGate('tok', {});
  assert.equal(guardEvents('user-spend-unreadable').length, 1, 'the log line is throttled to once a minute');
  assert.ok(gw.aiGuardConfig().warnings['user-spend-unreadable'] >= 2, 'but every miss is counted');
  teamSpend = { throws: true };
  assert.equal(await gw.aiSpendGate('tok', {}), null, 'team spend unreadable: still open');
  assert.equal(guardEvents('team-spend-unreadable').length, 1);

  process.env.AI_FAIL_CLOSED = '1';
  assert.deepEqual(await gw.aiSpendGate('tok', {}), { status: 503, reason: 'limit-unknown', error: "AI spend can't be checked right now, so AI features are paused for a moment. Try again shortly." }, 'AI_FAIL_CLOSED=1 blocks');
  assert.equal(await gw.userOverWeeklyLimit('tok'), true, 'userOverWeeklyLimit fails closed too');
  mySpend = { status: 200, body: [{ total_usd: 1 }] };
  assert.equal((await gw.aiSpendGate('tok', {})).reason, 'limit-unknown', 'the team read alone can close it');
  teamSpend = { status: 200, body: [{ total_usd: 1 }] };
  assert.equal(await gw.aiSpendGate('tok', {}), null, 'both readable: open even when fail-closed');
  mySpend = { status: 200, body: [{ total_usd: null }] };
  assert.equal((await gw.aiSpendGate('tok', {})).reason, 'limit-unknown', 'a null total is unknown');
  delete process.env.AI_FAIL_CLOSED;
  assert.equal(await gw.userOverWeeklyLimit('tok'), false, 'back to failing open');
  delete process.env.AI_TEAM_WEEKLY_LIMIT_USD;
  mySpend = { status: 200, body: [{ total_usd: 0 }] };
  teamSpend = { status: 200, body: [{ total_usd: 0 }] };
}

// ── 6. Every AI handler ────────────────────────────────────────────────────
const handlers = {
  generate: require(path.join(fnDir, 'es-generate.js')).handler,
  image: require(path.join(fnDir, 'es-generate-image.js')).handler,
  trend: require(path.join(fnDir, 'trend-design.js')).handler,
  rating: require(path.join(fnDir, 'ad-rating.js')).handler,
  videoAds: require(path.join(fnDir, 'video-ads.js')).handler,
  reels: require(path.join(fnDir, 'es-video-intelligence.js')).handler,
};
const videoAds = require(path.join(fnDir, 'video-ads.js'))._test;
videoAds.useLearning({});
const call = (handler, body, method = 'POST') => handler({ httpMethod: method, headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body), queryStringParameters: {} })
  .then(r => ({ status: r.statusCode, body: JSON.parse(r.body || '{}') }));
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ' + 'A'.repeat(200);
const CONTEXT = { brandId: 'essentially-cfb', brandLabel: 'Essentially CFB', sport: 'cfb', objective: 'newsletter_signup', placement: '9x16', headline: 'Never miss a CFB upset', body: ['Daily college football, free.'], cta: 'SIGN UP ES CFB', frameTimes: [0.5] };
const AD = { brandId: 'essentially-cfb', sport: 'cfb', trend: { title: 'Upset in Tuscaloosa' }, notes: 'big upset' };
const cases = [
  ['es-generate', handlers.generate, { brief: 'Caitlin Clark scores 30 in the Fever win' }, 'generate'],
  ['es-generate rewrite', handlers.generate, { mode: 'rewrite', brief: 'Clark', spec: { postType: 'cover', fields: {} }, instruction: 'shorter' }, 'generate-rewrite-shorter'],
  ['es-generate-image', handlers.image, { scene: 'empty football stadium at night' }, 'generate-scene-image'],
  ['ad-rating', handlers.rating, { frames: [JPEG], context: CONTEXT }, 'video-ads-rating'],
  ['video-ads copy', handlers.videoAds, { mode: 'copy', ...AD }, 'video-ads-copy'],
  ['video-ads chat', handlers.videoAds, { mode: 'chat', ...AD, messages: [{ role: 'user', content: 'shorter please' }] }, 'video-ads-chat'],
  ['video-ads grammar', handlers.videoAds, { mode: 'grammar', ...AD, copy: { headline: 'Big upset', body: ['Read it free.'] } }, 'video-ads-grammar'],
  ['video-ads find-clips', handlers.videoAds, { mode: 'find-clips', sport: 'cfb', query: 'upset in tuscaloosa' }, 'video-ads-find-clips'],
  ['trend enrich', handlers.trend, { mode: 'enrich', items: [{ id: 't1', title: 'Caitlin Clark breaks the record', related: [], sport: 'WNBA' }] }, 'trend-enrich'],
  ['trend titles', handlers.trend, { mode: 'titles', title: 'Caitlin Clark breaks the record', related: [] }, 'trend-headlines'],
];
gatewayReply = null;
for (const [name, handler, body, feature] of cases) {
  const isTrend = feature.startsWith('trend-');
  // Team over its cap: a calm 429 and no AI call.
  process.env.AI_TEAM_WEEKLY_LIMIT_USD = '40';
  teamSpend = { status: 200, body: [{ total_usd: 41 }] };
  reset();
  const team = await call(handler, body);
  assert.equal(team.status, 429, `${name}: team over the cap → 429`);
  assert.equal(team.body.reason, 'team-limit', `${name}: reason team-limit`);
  assert.match(team.body.error, /team has used this week's \$40 AI budget/, `${name}: team message`);
  assert.equal(aiCalls(), 0, `${name}: no AI call over the team cap`);
  if (isTrend && body.mode === 'enrich') assert.ok(team.body.items?.t1?.titles?.length, `${name}: free ideas still come back`);
  teamSpend = { status: 200, body: [{ total_usd: 0 }] };
  delete process.env.AI_TEAM_WEEKLY_LIMIT_USD;

  // Switched off: a polite reply, no AI call, no spend read.
  process.env.AI_DISABLE = feature;
  reset();
  const off = await call(handler, body);
  assert.equal(aiCalls(), 0, `${name}: switched off → no AI call`);
  if (isTrend) {
    assert.equal(off.status, 200, `${name}: switched off keeps the free ideas`);
    assert.equal(off.body.ai, false);
    if (body.mode === 'titles') { assert.equal(off.body.off, true); assert.ok(off.body.titles.length); } else assert.equal(off.body.limited, 'off');
  } else {
    assert.equal(off.status, 503, `${name}: switched off → 503`);
    assert.equal(off.body.reason, 'feature-off', `${name}: reason feature-off`);
    assert.match(off.body.error, /is switched off for now\. Everything else in FrameUp still works\.$/, `${name}: polite message`);
    assert.equal(fetched(h => h.includes('/rpc/frameup_my_ai_spend')).length, 0, `${name}: no spend read when off`);
  }
  delete process.env.AI_DISABLE;
}
// Reels transcription switched off.
{
  process.env.AI_DISABLE = 'reels-transcription';
  reset();
  const off = await call(handlers.reels, { action: 'transcribe', fileName: 'a.wav', mimeType: 'audio/wav', data: Buffer.from('fake').toString('base64') });
  assert.equal(off.status, 503);
  assert.equal(off.body.reason, 'feature-off');
  assert.match(off.body.error, /^Automatic captions is switched off for now/);
  assert.equal(fetched(h => h.includes('openai.com')).length, 0);
  delete process.env.AI_DISABLE;
}

// ── 7. logUsage measurement columns ────────────────────────────────────────
{
  reset();
  gatewayReply = okText('fine');
  await gw.aiText({ tier: 'main', system: 'S'.repeat(3000), cacheSystem: true, messages: [{ role: 'user', content: 'hi' }], track: { ...track, task: 'generate-writer', runId: 'run-abc' } });
  const [row] = fetched(h => h.includes('/frameup_ai_usage')).map(c => c.body);
  assert.equal(row.cache_read_tokens, 900, 'cache-read tokens are logged');
  assert.equal(row.cache_write_tokens, 0, 'cache-write tokens are logged');
  assert.equal(row.task, 'generate-writer');
  assert.equal(row.run_id, 'run-abc');
  assert.equal(row.model, 'anthropic/claude-haiku-5.5');
  assert.equal(row.feature, 'generate');
  assert.ok(Math.abs(row.cost_usd - (100 * 0.10e-6 + 20 * 0.50e-6 + 900 * 0.01e-6)) < 1e-6, 'the cost includes cached tokens');
  // Before the migration: PostgREST rejects the new columns once, the row is re-sent without them.
  reset();
  usageInsert = { status: 400, body: { code: 'PGRST204', message: "Could not find the 'cache_read_tokens' column of 'frameup_ai_usage' in the schema cache" } };
  await gw.logUsage({ ...track, task: 't', runId: 'r' }, { model: 'm', ok: true, input_tokens: 1, output_tokens: 1, cache_read_tokens: 5, cost_usd: 0 });
  const tries = fetched(h => h.includes('/frameup_ai_usage')).map(c => c.body);
  assert.equal(tries.length, 2, 'one retry');
  assert.equal(tries[0].cache_read_tokens, 5);
  assert.equal('cache_read_tokens' in tries[1] || 'task' in tries[1] || 'run_id' in tries[1], false, 'the retry has only the original columns');
  assert.equal(tries[1].input_tokens, 1);
  reset();
  usageInsert = { status: 201, body: {} };
  await gw.logUsage(track, { model: 'm', ok: true, cache_read_tokens: 5, cost_usd: 0 });
  const later = fetched(h => h.includes('/frameup_ai_usage')).map(c => c.body);
  assert.equal(later.length, 1, 'later rows go in one request');
  assert.equal('cache_read_tokens' in later[0], false, 'and skip the missing columns');
  await gw.logUsage(null, { model: 'm' });
  await gw.logUsage({ email: 'x' }, { model: 'm' });
  assert.equal(fetched(h => h.includes('/frameup_ai_usage')).length, 1, 'no token or email: nothing is logged');
}

// ── 8. Prompt caching ──────────────────────────────────────────────────────
{
  reset();
  gatewayReply = okText('fine');
  await gw.aiText({ tier: 'main', system: 'short system prompt', cacheSystem: true, messages: [{ role: 'user', content: 'hi' }], track });
  await gw.aiText({ tier: 'main', system: 'L'.repeat(gw.CACHE_MIN_CHARS), cacheSystem: true, messages: [{ role: 'user', content: 'hi' }], track });
  const systems = fetched(h => h.endsWith('/messages')).map(c => c.body.system);
  assert.equal(typeof systems[0], 'string', 'a prompt far below the 512-token minimum is not marked cacheable');
  assert.deepEqual(systems[1][0].cache_control, { type: 'ephemeral' }, 'a long prompt is marked');
  // The Gateway rejects the hint: one retry, one warning.
  reset();
  let n = 0;
  gatewayReply = body => (n++ === 0 && Array.isArray(body.system) ? { status: 400, body: { error: { message: 'cache_control not allowed' } } } : okText('plain')());
  const retried = await gw.aiText({ tier: 'main', system: 'L'.repeat(2000), cacheSystem: true, messages: [{ role: 'user', content: 'hi' }], track });
  assert.equal(retried.text, 'plain');
  assert.equal(aiCalls(), 2, 'one plain retry');
  assert.equal(guardEvents('cache-hint-rejected').length, 1, 'the rejected cache hint is logged');
  // Video Ads copy: COPY_SYSTEM is under the minimum, so it is never marked.
  assert.ok(videoAds.COPY_SYSTEM.length < 2048, 'COPY_SYSTEM is short (under ~512 tokens)');
  reset();
  gatewayReply = () => ({ body: { content: [{ type: 'text', text: '{"variants": []}' }], usage: { input_tokens: 10, output_tokens: 10 }, stop_reason: 'end_turn' } });
  await videoAds.copy({ ...AD }, { email: 'designer@essentiallysports.com', token: 'tok' });
  const copySystems = fetched(h => h.endsWith('/messages')).map(c => c.body.system);
  assert.ok(copySystems.length >= 1);
  assert.ok(copySystems.every(system => typeof system === 'string'), 'Video Ads copy sends no cache_control');
  // Generate: the cached prefix is the same whatever formats the editor picks.
  const gen = require(path.join(fnDir, 'es-generate.js'))._test;
  const found = { digest: 'Clark scored 30.' };
  const BREAK = '\n<<<REQUEST>>>\n';
  const prefix = types => gen.buildPrompt('Clark scores 30', found, types, 4, '', []).split(BREAK)[0];
  const all = prefix([]);
  assert.equal(prefix(['cover']), all, 'cover only: same prefix');
  assert.equal(prefix(['player-stats', 'quote']), all, 'two formats: same prefix');
  const asked = gen.buildPrompt('Clark scores 30', found, ['cover'], 4, '', []).split(BREAK)[1];
  assert.match(asked, /Use ONLY these templates \(any other template is rejected\): cover \(/, 'the picked formats come after the break');
  assert.doesNotMatch(gen.buildPrompt('Clark', found, [], 4, '', []).split(BREAK)[1], /Use ONLY these templates/, 'no line when nothing is picked');
  assert.equal(gen.checkSpec({ postType: 'quote', fields: {} }, 0, ['cover']).error, 'design 1: format not requested', 'checkSpec still rejects other templates');
}

// ── 9. Alerts (mocked webhook; nothing real is sent) ───────────────────────
{
  const week = '2026-11-16T00:00:00.000Z';
  alerts._reset();
  claimed.clear();
  reset();
  assert.deepEqual(await alerts.runBudgetWatch({ teamLimit: 60, userLimit: 20, weekStart: week, env: {} }), { ok: true, skipped: 'alerts-off', sent: [] }, 'no webhook: nothing');
  assert.deepEqual(await alerts.runBudgetWatch({ teamLimit: 60, userLimit: 20, weekStart: week, env: { SLACK_AI_ALERTS_WEBHOOK_URL: SLACK } }), { ok: true, skipped: 'no-service-key', sent: [] }, 'no service key: nothing');
  assert.equal(calls.length, 0);
  const env = { SLACK_AI_ALERTS_WEBHOOK_URL: SLACK, SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
  summary = { total_usd: 25, users: [{ email: 'a@essentiallysports.com', total_usd: 10 }] };
  let result = await alerts.runBudgetWatch({ teamLimit: 60, userLimit: 20, weekStart: week, env });
  assert.deepEqual(result.sent, [], '42% of the team cap: no alert');
  summary = { total_usd: 31, users: [{ email: 'a@essentiallysports.com', total_usd: 16 }, { email: 'b@essentiallysports.com', total_usd: 15.99 }] };
  result = await alerts.runBudgetWatch({ teamLimit: 60, userLimit: 20, weekStart: week, env });
  assert.deepEqual(result.sent, ['team:2026-11-16:50', 'user:2026-11-16:a@essentiallysports.com:80'], '50% team + one person at 80%');
  assert.equal(slackPosts().length, 2);
  assert.match(slackPosts()[0].body.text, /team has used 50% of this week's \$60\.00 AI budget \(\$31\.00 so far\)/);
  assert.match(slackPosts()[1].body.text, /a has used 80% of their \$20\.00 weekly AI limit/);
  const summaryCall = fetched(h => h.endsWith('frameup_ai_budget_summary'))[0];
  assert.equal(summaryCall.headers.Authorization, 'Bearer service-test', 'the summary uses the service key');
  assert.equal(summaryCall.body.p_since, week);
  // Same week again: nothing new (claimed once).
  reset();
  result = await alerts.runBudgetWatch({ teamLimit: 60, userLimit: 20, weekStart: week, env });
  assert.deepEqual(result.sent, []);
  assert.equal(slackPosts().length, 0, 'each alert fires once per week');
  // Another server instance (fresh memory) still sends nothing: the database claim holds.
  alerts._reset();
  reset();
  result = await alerts.runBudgetWatch({ teamLimit: 60, userLimit: 20, weekStart: week, env });
  assert.equal(slackPosts().length, 0, 'the claim dedupes across servers');
  // Jump straight to 100%: one message, for the highest threshold.
  reset();
  summary = { total_usd: 66, users: [] };
  result = await alerts.runBudgetWatch({ teamLimit: 60, userLimit: 20, weekStart: week, env });
  assert.deepEqual(result.sent, ['team:2026-11-16:80', 'team:2026-11-16:100']);
  assert.equal(slackPosts().length, 1, 'one message when several thresholds are crossed together');
  assert.match(slackPosts()[0].body.text, /used this week's \$60\.00 AI budget .*paused until Monday/);
  // No team cap: no team alerts; user alerts still work.
  reset();
  summary = { total_usd: 500, users: [{ email: 'c@essentiallysports.com', total_usd: 19 }] };
  result = await alerts.runBudgetWatch({ teamLimit: 0, userLimit: 20, weekStart: week, env });
  assert.deepEqual(result.sent, ['user:2026-11-16:c@essentiallysports.com:80']);
  assert.deepEqual(alerts.reachedThresholds(30, 60), [50]);
  assert.deepEqual(alerts.reachedThresholds(30, 0), []);

  // Real time: the gate sees the team cross 80% and alerts once.
  claimed.clear();
  alerts._reset();
  process.env.SLACK_AI_ALERTS_WEBHOOK_URL = SLACK;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.AI_TEAM_WEEKLY_LIMIT_USD = '100';
  teamSpend = { status: 200, body: [{ total_usd: 85 }] };
  reset();
  assert.equal(await gw.aiSpendGate('tok', { feature: 'generate' }), null, '85%: still allowed');
  assert.equal(slackPosts().length, 1, 'crossing 80% alerts straight away');
  assert.match(slackPosts()[0].body.text, /80% of this week's \$100\.00 AI budget/);
  reset();
  await gw.aiSpendGate('tok', { feature: 'generate' });
  assert.equal(slackPosts().length, 0, 'not again on the next request');
  assert.equal(fetched(h => h.endsWith('frameup_ai_alert_claim')).length, 0, 'and no database call for a threshold already seen');
  delete process.env.SLACK_AI_ALERTS_WEBHOOK_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.AI_TEAM_WEEKLY_LIMIT_USD;
  teamSpend = { status: 200, body: [{ total_usd: 0 }] };
}

// ── 10. Cron secret ────────────────────────────────────────────────────────
{
  const watch = require(path.join(fnDir, 'ai-budget-watch.js'));
  const run = headers => watch.handler({ httpMethod: 'GET', headers }).then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));
  reset();
  assert.equal((await run({ authorization: 'Bearer anything' })).status, 503, 'no CRON_SECRET: refuses everything');
  process.env.CRON_SECRET = 'cron-secret-test-value';
  assert.equal((await run({})).status, 401, 'no header');
  assert.equal((await run({ authorization: 'Bearer wrong' })).status, 401, 'wrong secret');
  assert.equal((await run({ authorization: 'cron-secret-test-value' })).status, 401, 'needs the Bearer scheme');
  assert.equal(calls.length, 0, 'refused calls read nothing');
  const ok = await run({ Authorization: 'Bearer cron-secret-test-value' });
  assert.equal(ok.status, 200, 'Vercel cron header');
  assert.deepEqual(ok.body, { ok: true, skipped: 'alerts-off', sent: [] }, 'alerts off without the webhook');
  assert.equal((await run({ 'x-cron-secret': 'cron-secret-test-value' })).status, 200, 'x-cron-secret also works');
  assert.equal((await watch.handler({ httpMethod: 'DELETE', headers: {} })).statusCode, 405);
  // The Vercel adapter passes the header through.
  const adapter = require(path.resolve('api/ai-budget-watch.js'));
  const res = { statusCode: 0, headers: {}, payload: '', setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, send(p) { this.payload = p; return this; }, json(p) { this.payload = p; return this; } };
  await adapter({ method: 'GET', headers: { authorization: 'Bearer wrong' }, query: {} }, res);
  assert.equal(res.statusCode, 401, 'adapter: wrong secret');
  await adapter({ method: 'GET', headers: { authorization: 'Bearer cron-secret-test-value' }, query: {} }, res);
  assert.equal(res.statusCode, 200, 'adapter: right secret');
  delete process.env.CRON_SECRET;
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.deepEqual(vercel.crons, [{ path: '/api/ai-budget-watch', schedule: '0 13 * * *' }], 'one daily cron');
  assert.ok(vercel.functions['api/ai-budget-watch.js'] && vercel.functions['api/ai-status.js'], 'function entries');
}

// ── 11. Reels transcription logs its OpenAI usage ──────────────────────────
{
  process.env.REELS_TRANSCRIBE = 'openai';
  reset();
  const res = await call(handlers.reels, { action: 'transcribe', fileName: 'a.wav', mimeType: 'audio/wav', data: Buffer.from('fake-audio').toString('base64') });
  assert.equal(res.status, 200, 'transcribed');
  const rows = fetched(h => h.includes('/frameup_ai_usage')).map(c => c.body);
  assert.equal(rows.length, 1, 'one usage row');
  assert.equal(rows[0].feature, 'reels-transcription');
  assert.equal(rows[0].model, 'openai/gpt-4o-transcribe');
  assert.equal(rows[0].user_email, 'designer@essentiallysports.com');
  assert.equal(rows[0].cost_usd, 0.009, '90 s at $0.006 a minute');
  // Over the weekly cap: the paid provider is not called.
  mySpend = { status: 200, body: [{ total_usd: 20 }] };
  reset();
  const capped = await call(handlers.reels, { action: 'transcribe', fileName: 'a.wav', mimeType: 'audio/wav', data: Buffer.from('fake-audio').toString('base64') });
  assert.equal(capped.status, 429);
  assert.equal(capped.body.reason, 'weekly-limit');
  assert.equal(fetched(h => h.includes('openai.com')).length, 0);
  mySpend = { status: 200, body: [{ total_usd: 0 }] };
  delete process.env.REELS_TRANSCRIBE;
}

// ── 12. /api/ai-status, dashboard summary, migration ───────────────────────
{
  const status = require(path.join(fnDir, 'ai-status.js'));
  const denied = await status.handler({ httpMethod: 'GET', headers: {} });
  assert.equal(denied.statusCode, 401, 'signed-in users only');
  process.env.AI_TEAM_WEEKLY_LIMIT_USD = '75';
  process.env.AI_DISABLE = 'video-ads-find-clips';
  process.env.AI_ECONOMY = 'true';
  process.env.SLACK_AI_ALERTS_WEBHOOK_URL = SLACK;
  const got = JSON.parse((await status.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer tok' } })).body);
  assert.equal(got.userWeeklyLimitUsd, 20, '$20 per person by default');
  assert.equal(got.teamWeeklyLimitUsd, 75);
  assert.deepEqual(got.disabled, ['video-ads-find-clips']);
  assert.equal(got.economy, true);
  assert.equal(got.failClosed, false);
  assert.equal(got.alertsConfigured, true);
  assert.ok(!JSON.stringify(got).includes(SLACK), 'never leaks the webhook');
  for (const name of ['AI_TEAM_WEEKLY_LIMIT_USD', 'AI_DISABLE', 'AI_ECONOMY', 'SLACK_AI_ALERTS_WEBHOOK_URL']) delete process.env[name];

  const { summarize, weekStartUtc } = require(path.resolve('ai-usage-summary.js'));
  assert.equal(weekStartUtc(new Date('2026-11-18T09:00:00Z')).toISOString(), '2026-11-16T00:00:00.000Z');
  const rows = [
    { user_email: 'A@essentiallysports.com', feature: 'generate', model: 'anthropic/claude-haiku-5.5', cost_usd: 0.01, input_tokens: 300, cache_read_tokens: 600, cache_write_tokens: 100, run_id: 'r1', ok: true },
    { user_email: 'a@essentiallysports.com', feature: 'generate-director', model: 'anthropic/claude-sonnet-5.5', cost_usd: 0.03, input_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0, run_id: 'r1', ok: true },
    { user_email: 'b@essentiallysports.com', feature: 'generate-backup', model: 'groq/gpt-oss-120b', cost_usd: 0, input_tokens: 500, ok: false },
    { user_email: 'b@essentiallysports.com', feature: 'video-ads-find-clips', model: 'anthropic/claude-haiku-5.5', cost_usd: '0.02', input_tokens: 0, cache_read_tokens: null },
  ];
  const s = summarize(rows, { exports: 4, teamLimit: 0.1, userLimit: 0.05 });
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(s.total, 0.06);
  assert.equal(s.calls, 4);
  assert.equal(s.failed, 1);
  near(s.teamShare, 0.6);
  near(s.costPerExport, 0.015);
  near(s.sonnetShare, 0.5);
  near(s.cacheHitRate, 600 / 2000);
  assert.equal(s.cacheMeasured, true);
  near(s.costPerRun, 0.04);
  assert.equal(s.features[0].key, 'generate-director');
  assert.ok(s.features.some(f => f.key === 'generate' && f.calls === 2), 'backup rows count under their feature');
  assert.equal(s.users[0].key, 'a@essentiallysports.com', 'emails group case-insensitively');
  near(s.users[0].shareOfCap, 0.8);
  assert.equal(s.usersNearCap, 1);
  const empty = summarize([], {});
  assert.equal(empty.costPerExport, null);
  assert.equal(empty.cacheHitRate, null);
  assert.equal(empty.sonnetShare, null);
  assert.equal(empty.teamShare, null);
  assert.equal(summarize([{ model: 'anthropic/claude-haiku-5.5', cost_usd: 1, input_tokens: 10 }]).cacheMeasured, false, 'old rows: cache not measured');

  const sql = readFileSync('supabase/migrations/20261118120000_ai_guardrails.sql', 'utf8');
  for (const column of ['cache_read_tokens integer', 'cache_write_tokens integer', 'task text', 'run_id text']) assert.match(sql, new RegExp(`add column if not exists ${column}`), column);
  assert.doesNotMatch(sql, /not null default 0,?\s*\n?\s*add column/, 'new columns are nullable');
  assert.match(sql, /create or replace function public\.frameup_team_ai_spend\(p_since timestamptz\)\s+returns table \(total_usd numeric\)/);
  assert.match(sql, /frameup_team_ai_spend[\s\S]*security definer[\s\S]*is_es_designer_domain_user\(\)/);
  assert.match(sql, /grant execute on function public\.frameup_team_ai_spend\(timestamptz\) to authenticated;/);
  assert.match(sql, /revoke all on function public\.frameup_ai_budget_summary\(timestamptz\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.frameup_ai_budget_summary\(timestamptz\) to service_role;/);
  assert.match(sql, /grant execute on function public\.frameup_ai_alert_claim\(text\) to service_role;/);
  assert.match(sql, /alter table public\.frameup_ai_alerts enable row level security;/);
  assert.match(sql, /Undo:/);
  assert.match(sql, /create table if not exists/);
}

// ── 13. Everything on the Gateway key: transcription, backups, diagnostics ──
{
  // The order: Groq (free) -> Gateway -> direct OpenAI; REELS_TRANSCRIBE moves one first.
  const names = env => gw.transcriptionPlan(env).map(step => step.provider);
  assert.deepEqual(names({}), ['groq', 'gateway', 'openai'], 'default order');
  assert.deepEqual(names({ REELS_TRANSCRIBE: 'gateway' }), ['gateway', 'groq', 'openai']);
  assert.deepEqual(names({ REELS_TRANSCRIBE: 'OpenAI' }), ['openai', 'groq', 'gateway']);
  assert.deepEqual(names({ REELS_TRANSCRIBE: 'nonsense' }), ['groq', 'gateway', 'openai'], 'an unknown value keeps the default');
  const plan = gw.transcriptionPlan({ GROQ_API_KEY: 'g', AI_GATEWAY_API_KEY: 'k' });
  assert.deepEqual(plan.map(step => step.keyPresent), [true, true, false]);
  assert.equal(plan[1].model, 'elevenlabs/scribe-v2', 'Gateway default model');
  assert.equal(plan[0].perMinuteUsd, 0, 'Groq is free');
  assert.ok(Math.abs(plan[1].perMinuteUsd - 0.0036667) < 1e-9, 'Scribe v2: $0.0000611/s');
  assert.equal(gw.transcriptionPlan({ AI_GATEWAY_API_KEY: 'k', GENERATE_AI: 'rules' })[1].keyPresent, false, 'GENERATE_AI=rules keeps the Gateway off');
  assert.ok(gw.AUDIO_PRICES_PER_MIN[gw.TRANSCRIPTION_MODEL] > 0, 'the default transcription model is priced');

  // aiTranscribe: the documented REST shape, word timings, cost.
  const WORDS = [
    { text: 'Big', type: 'word', start: 0.0, end: 0.3, speaker_id: 's0' }, { text: ' ', type: 'spacing', start: 0.3, end: 0.35 },
    { text: 'shot', type: 'word', start: 0.35, end: 0.7 }, { text: '[cheering]', type: 'audio_event', start: 0.7, end: 1.5 },
    { text: 'from', type: 'word', start: 2.6, end: 2.8 }, { text: 'deep.', type: 'word', start: 2.8, end: 3.2 },
    { text: 'Again', type: 'word', start: 3.4, end: 3.8 },
  ];
  gatewayReply = (body, href) => (href.endsWith('/v4/ai/transcription-model')
    ? { body: { text: 'Big shot from deep. Again', segments: [], language: 'en', durationInSeconds: 60, warnings: [], providerMetadata: { elevenlabs: { words: WORDS } } } }
    : { status: 500, body: { error: { message: 'down' } } });
  reset();
  const audio = Buffer.from('fake-wav').toString('base64');
  const out = await gw.aiTranscribe({ audio, mediaType: 'audio/wav', track: { ...track, feature: 'reels-transcription' } });
  const [request] = fetched(h => h.endsWith('/v4/ai/transcription-model'));
  assert.equal(request.href, 'https://ai-gateway.vercel.sh/v4/ai/transcription-model');
  assert.equal(request.headers.Authorization, 'Bearer gw-test');
  assert.equal(request.headers['ai-model-id'], 'elevenlabs/scribe-v2');
  assert.equal(request.headers['ai-transcription-model-specification-version'], '4');
  assert.equal(request.headers['ai-gateway-protocol-version'], '0.0.1');
  assert.deepEqual(request.body, { audio, mediaType: 'audio/wav' }, 'base64 audio in JSON, no provider options for Scribe');
  assert.deepEqual(out.words.map(w => w.word), ['Big', 'shot', 'from', 'deep.', 'Again'], 'words only (no spacing or audio events)');
  assert.equal(out.durationInSeconds, 60);
  const [row] = fetched(h => h.includes('/frameup_ai_usage')).map(c => c.body);
  assert.equal(row.model, 'elevenlabs/scribe-v2');
  assert.equal(row.feature, 'reels-transcription');
  assert.ok(Math.abs(row.cost_usd - 0.003667) < 1e-6, 'a minute of Scribe v2 costs about $0.0037');
  reset();
  gatewayReply = () => ({ body: { text: 'Big shot', segments: [{ text: 'Big', startSecond: 0, endSecond: 0.3 }, { text: 'shot', startSecond: 0.35, endSecond: 0.7 }] } });
  const whisper = await gw.aiTranscribe({ audio, model: 'openai/whisper-1', track });
  assert.deepEqual(fetched(h => h.endsWith('/transcription-model'))[0].body.providerOptions, { openai: { timestampGranularities: ['word', 'segment'] } }, 'whisper-1 asks for word timestamps');
  assert.deepEqual(whisper.words.map(w => w.word), ['Big', 'shot'], 'one-word segments become words');
  assert.ok(Math.abs(fetched(h => h.includes('/frameup_ai_usage'))[0].body.cost_usd - 0.7 / 60 * 0.006) < 1e-6, 'no duration: cost from the last word');
  process.env.AI_DISABLE = 'reels-transcription';
  reset();
  await assert.rejects(gw.aiTranscribe({ audio, track: { ...track, feature: 'reels-transcription' } }), error => error.code === 'feature-off');
  assert.equal(calls.length, 0, 'switched off: no fetch');
  delete process.env.AI_DISABLE;

  // Reels handler without Groq: Gateway first, captions from word timings, gate + log.
  gatewayReply = (body, href) => ({ body: { text: 'Big shot from deep. Again', language: 'en', durationInSeconds: 30, providerMetadata: { elevenlabs: { words: WORDS } } } });
  reset();
  const reel = await call(handlers.reels, { action: 'transcribe', fileName: 'a.wav', mimeType: 'audio/wav', data: audio });
  assert.equal(reel.status, 200);
  assert.equal(reel.body.provider, 'AI Gateway elevenlabs/scribe-v2');
  assert.deepEqual(reel.body.segments.map(seg => seg.text), ['Big shot', 'from deep.', 'Again'], 'a new caption after a pause or a sentence end');
  assert.deepEqual(reel.body.segments[0].words.map(w => [w.word, w.start, w.end]), [['Big', 0, 0.3], ['shot', 0.35, 0.7]], 'word timings kept');
  assert.equal(reel.body.segments[1].start, 2.6);
  assert.equal(fetched(h => h.includes('/rpc/frameup_my_ai_spend')).length, 1, 'the billed path passes the weekly caps once');
  assert.equal(fetched(h => h.includes('openai.com')).length, 0, 'direct OpenAI not called');
  assert.equal(fetched(h => h.includes('/frameup_ai_usage')).length, 1, 'one usage row');
  // Gateway down: falls back to direct OpenAI.
  gatewayReply = () => ({ status: 500, body: { error: { message: 'down' } } });
  reset();
  const fell = await call(handlers.reels, { action: 'transcribe', fileName: 'a.wav', mimeType: 'audio/wav', data: audio });
  assert.equal(fell.status, 200);
  assert.equal(fell.body.provider, 'OpenAI gpt-4o-transcribe', 'direct OpenAI is the last resort');
  assert.deepEqual(fetched(h => h.includes('/frameup_ai_usage')).map(c => [c.body.model, c.body.ok]), [['elevenlabs/scribe-v2', false], ['openai/gpt-4o-transcribe', true]]);

  // Backup text AI on the Gateway key when Groq isn't configured.
  const gen = require(path.join(fnDir, 'es-generate.js'))._test;
  const provider = gen.pickProvider();
  assert.equal(provider.name, 'gateway');
  assert.deepEqual(provider.backup, { name: 'gateway-backup', model: 'openai/gpt-oss-120b' }, 'no GROQ_API_KEY: a Gateway backup');
  provider.track = { feature: 'generate', email: 'designer@essentiallysports.com', token: 'tok' };
  provider.backup.track = provider.track;
  gatewayReply = (body, href) => (href.endsWith('/messages')
    ? { status: 500, body: { error: { message: 'overloaded' } } }
    : { body: { choices: [{ message: { content: '{"designs": []}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 200 } } });
  reset();
  const written = await gen.chat(provider, [{ role: 'user', content: 'rules\n<<<REQUEST>>>\nBrief: x' }]);
  assert.equal(written, '{"designs": []}', 'the backup wrote the reply');
  const backupCall = fetched(h => h.endsWith('/chat/completions'))[0];
  assert.equal(backupCall.body.model, 'openai/gpt-oss-120b');
  assert.ok(!JSON.stringify(backupCall.body.messages).includes('<<<REQUEST>>>'), 'the cache marker is stripped');
  const backupRow = fetched(h => h.includes('/frameup_ai_usage')).map(c => c.body).find(r => r.feature === 'generate-backup');
  assert.ok(backupRow && backupRow.cost_usd > 0, 'logged as generate-backup with its real cost');
  // Budget gone: no pointless second Gateway call.
  const broke = gen.pickProvider();
  broke.track = provider.track;
  gatewayReply = () => ({ status: 402, body: { error: { message: 'Spending limit reached' } } });
  reset();
  await assert.rejects(gen.chat(broke, [{ role: 'user', content: 'x' }]));
  assert.equal(aiCalls(), 1, 'budget error: the Gateway backup is skipped');

  const trend = require(path.join(fnDir, 'trend-design.js'))._test;
  trend.reset();
  gatewayReply = body => (body.model === 'openai/gpt-oss-20b'
    ? { status: 500, body: { error: { message: 'busy' } } }
    : { body: { choices: [{ message: { content: '{"titles": ["Clark Breaks The Record", "Caitlin Clark Does It Again"]}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 300, completion_tokens: 60 } } });
  reset();
  const titles = await trend.aiTitles({ title: 'Caitlin Clark breaks the record', related: [] }, { feature: 'trend-headlines', email: 'designer@essentiallysports.com', token: 'tok' });
  assert.deepEqual(titles, ['Clark Breaks The Record', 'Caitlin Clark Does It Again'], 'Trends falls back to the Gateway backup model');
  assert.deepEqual(fetched(h => h.endsWith('/chat/completions')).map(c => c.body.model), ['openai/gpt-oss-20b', 'openai/gpt-oss-120b']);
  assert.ok(fetched(h => h.includes('/frameup_ai_usage')).some(c => c.body.feature === 'trend-headlines-backup' && c.body.ok));
  trend.reset();
  gatewayReply = () => ({ status: 402, body: { error: { message: 'budget exhausted' } } });
  reset();
  await assert.rejects(trend.aiTitles({ title: 'Another story here', related: [] }, { feature: 'trend-headlines', email: 'designer@essentiallysports.com', token: 'tok' }));
  assert.equal(aiCalls(), 1, 'Trends: no backup try when the budget is gone');

  // Admin diagnostics: admins only, booleans only.
  const status = require(path.join(fnDir, 'ai-status.js'));
  const diag = () => status.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer tok' }, queryStringParameters: { diag: '1' } });
  adminFlag = false;
  assert.equal((await diag()).statusCode, 403, 'not an admin');
  assert.equal((await status.handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { diag: '1' } })).statusCode, 401, 'signed out');
  adminFlag = true;
  process.env.GROQ_API_KEY = 'gsk-secret-groq';
  process.env.X_BEARER_TOKEN = 'x-secret-token';
  const res = await diag();
  assert.equal(res.statusCode, 200);
  const raw = res.body;
  for (const secret of ['gw-test', 'gsk-secret-groq', 'sk-test-openai', 'x-secret-token']) assert.ok(!raw.includes(secret), `never leaks ${secret}`);
  const jobs = JSON.parse(raw).diagnostics.jobs;
  for (const job of ['text', 'director', 'search', 'transcription', 'tts', 'image']) assert.ok(jobs[job], `diagnostics cover ${job}`);
  assert.deepEqual([jobs.text.provider, jobs.text.model, jobs.text.keyPresent], ['gateway', 'anthropic/claude-haiku-5.5', true]);
  assert.deepEqual(jobs.text.backup, { provider: 'groq', model: 'openai/gpt-oss-120b', keyPresent: true });
  assert.equal(jobs.director.model, 'anthropic/claude-sonnet-5.5');
  assert.equal(jobs.search.xApiKeyPresent, true);
  assert.deepEqual(jobs.transcription.willUse, { provider: 'groq', model: 'whisper-large-v3-turbo' });
  assert.deepEqual(jobs.transcription.order.map(s => [s.provider, s.keyPresent]), [['groq', true], ['gateway', true], ['openai', true]]);
  assert.equal(jobs.image.model, 'bfl/flux-3-image-klein');
  assert.equal(typeof jobs.tts.keyPresent, 'boolean');
  delete process.env.GROQ_API_KEY;
  delete process.env.X_BEARER_TOKEN;
  adminFlag = false;
}

console.warn = realWarn;
console.error = realError;
console.log('test-ai-guardrails: all checks passed');
