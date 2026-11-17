#!/usr/bin/env node
// Video Ads clip source "grok" (netlify/functions/_clip-source-grok.js), every
// network call mocked: config / off switches, handle batching (<= 20 per call),
// the x_search request shape (Gateway and direct xAI), citation parsing (only
// cited status ids count, model-invented URLs are dropped), snowflake dates and
// the freshness / throwback filters, cost (xAI ticks, token + per-post estimate),
// usage logging, the per-search budget, the spend gate, and the Sonar fallback
// when the Gateway does not run x_search.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const srcPath = path.join(fnDir, '_clip-source-grok.js');
const gatewayPath = path.join(fnDir, '_ai-gateway.js');
const authPath = path.join(fnDir, '_supabase-auth.js');

const EPOCH = 1288834974657n;
const idAt = ms => String((BigInt(Math.round(ms)) - EPOCH) << 22n);
const hoursAgoMs = h => Date.now() - h * 3600e3;

let weeklySpend = 0;
let calls = [];
let usageRows = [];
let responsesHandler = () => { throw new Error('unexpected /responses call'); };
let chatHandler = () => { throw new Error('unexpected /chat/completions call'); };
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('/rest/v1/frameup_ai_usage')) { usageRows.push(JSON.parse(options.body)); return reply(201, {}); }
  if (href.includes('/rest/v1/rpc/frameup_my_ai_spend')) return reply(200, [{ total_usd: weeklySpend }]);
  if (href.includes('/rest/v1/rpc/')) return reply(200, 0);
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({ href, body, headers: options.headers || {} });
  if (href === 'https://ai-gateway.vercel.sh/v1/responses' || href === 'https://api.x.ai/v1/responses') return responsesHandler(body, href);
  if (href === 'https://ai-gateway.vercel.sh/v1/chat/completions') return chatHandler(body);
  throw new Error(`unexpected fetch ${href}`);
};

[srcPath, gatewayPath, authPath].forEach(p => delete require.cache[p]);
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: () => 'tok',
  verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }),
} };

const ENV_KEYS = ['AI_GATEWAY_API_KEY', 'XAI_API_KEY', 'CLIPS_GROK', 'CLIPS_GROK_MODEL', 'CLIPS_GROK_MAX_USD', 'CLIPS_GROK_MAX_TURNS', 'CLIPS_GROK_FALLBACK', 'GENERATE_AI', 'AI_DISABLE', 'AI_USER_WEEKLY_LIMIT_USD', 'AI_TEAM_WEEKLY_LIMIT_USD', 'SLACK_AI_ALERTS_WEBHOOK_URL'];
ENV_KEYS.forEach(k => delete process.env[k]);
process.env.AI_GATEWAY_API_KEY = 'gw-test';

const source = require(srcPath);
const T = source._test;
const track = { token: 'tok', email: 'a@essentiallysports.com', feature: 'video-ads-find-clips' };
const reset = () => { calls = []; usageRows = []; weeklySpend = 0; T.reset(); };

// A Responses reply: cited posts (top-level citations + annotations) and the model's JSON.
function xReply({ cited = [], annotated = [], posts = [], usage = {}, toolItems = true } = {}) {
  const text = JSON.stringify({ posts });
  return reply(200, {
    id: 'resp_1',
    citations: cited,
    output: [
      ...(toolItems ? [{ type: 'custom_tool_call', name: 'x_keyword_search', input: '{}', status: 'completed' }] : []),
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: annotated.map((u, i) => ({ type: 'url_citation', url: u, start_index: 0, end_index: 1, title: String(i + 1) })) }] },
    ],
    usage: { input_tokens: 4000, output_tokens: 500, input_tokens_details: { cached_tokens: 1000 }, server_side_tool_usage_details: { x_search_calls: 1, x_posts_fetched: 4 }, ...usage },
  });
}

// ── module shape ───────────────────────────────────────────────────────────
assert.equal(source.id, 'grok');
assert.equal(typeof source.search, 'function');
assert.equal(T.FEATURE, 'video-ads-find-clips-grok');
assert.equal(T.DEFAULT_MODEL, 'spacexai/grok-4.20-non-reasoning');

// ── configured / off switches ──────────────────────────────────────────────
assert.equal(source.configured({}), false, 'no key: off');
assert.equal(source.configured({ AI_GATEWAY_API_KEY: 'k' }), true);
assert.equal(source.configured({ XAI_API_KEY: 'k' }), true, 'direct xAI key alone works');
assert.equal(source.configured({ AI_GATEWAY_API_KEY: 'k', CLIPS_GROK: 'off' }), false);
assert.equal(source.configured({ AI_GATEWAY_API_KEY: 'k', CLIPS_GROK: '0' }), false);
assert.equal(source.configured({ AI_GATEWAY_API_KEY: 'k', GENERATE_AI: 'rules' }), false);

reset();
let out = await source.search({ sport: 'nfl', env: { AI_GATEWAY_API_KEY: 'k', CLIPS_GROK: 'off' }, track, token: 'tok' });
assert.deepEqual(out.candidates, []);
assert.equal(out.cost, 0);
assert.equal(out.diag.mode, 'off');
assert.equal(calls.length, 0, 'disabled: no AI call');
assert.equal(usageRows.length, 0);

process.env.AI_DISABLE = 'video-ads-find-clips';
reset();
out = await source.search({ sport: 'nfl', track, token: 'tok' });
assert.equal(out.diag.mode, 'feature-off', 'AI_DISABLE=video-ads-find-clips covers the grok sub-feature');
assert.equal(calls.length, 0);
delete process.env.AI_DISABLE;

// Spend gate: over the weekly cap -> no call.
process.env.AI_USER_WEEKLY_LIMIT_USD = '20';
reset();
weeklySpend = 25;
out = await source.search({ sport: 'nfl', track, token: 'tok' });
assert.equal(out.diag.mode, 'blocked');
assert.equal(out.diag.blocked, 'weekly-limit');
assert.equal(calls.length, 0);
delete process.env.AI_USER_WEEKLY_LIMIT_USD;

// ── handle batching ────────────────────────────────────────────────────────
const teamPlan = T.handlePlan({ sport: 'nfl', team: { name: 'Kansas City Chiefs' } });
assert.equal(teamPlan[0], 'Chiefs', 'the team account comes first');
assert.ok(teamPlan.includes('NFL') && teamPlan.includes('nflnetwork'), 'league accounts');
assert.ok(teamPlan.includes('ESPNNFL'), 'network accounts');
assert.ok(!teamPlan.includes('Eagles'), 'a team search does not add the other teams');
const nflPlan = T.handlePlan({ sport: 'nfl' });
assert.ok(nflPlan.includes('Eagles') && nflPlan.includes('Chiefs'), 'sport-wide adds every team of the sport');
assert.ok(!nflPlan.includes('Yankees'), 'and no team from another sport');
assert.equal(new Set(nflPlan.map(h => h.toLowerCase())).size, nflPlan.length, 'no duplicate handles');
assert.ok(nflPlan.indexOf('NFL') < nflPlan.indexOf('Eagles'), 'league before teams');
const colorPlan = T.handlePlan({ sport: 'mlb', teams: [{ name: 'New York Yankees' }, 'Los Angeles Dodgers'] });
assert.deepEqual(colorPlan.slice(0, 2), ['Yankees', 'Dodgers'], 'colour-group teams first');
const allPlan = T.handlePlan({});
assert.ok(allPlan.includes('MLB') && allPlan.includes('CFBPlayoff') && allPlan.includes('NFL'), 'no sport: every league');
const groups = T.batches(nflPlan);
assert.ok(groups.length >= 2);
assert.ok(groups.every(g => g.length >= 1 && g.length <= 20), 'x_search takes at most 20 handles');
assert.deepEqual(groups.flat(), nflPlan, 'batches keep every handle in order');
assert.ok(T.batches(nflPlan, 50).every(g => g.length <= 20), 'never above the API limit');

// ── dates ──────────────────────────────────────────────────────────────────
assert.equal(T.fromDateFor(120, Date.UTC(2026, 10, 17, 21, 0)), '2026-11-12');
assert.equal(T.fromDateFor(48, Date.UTC(2026, 10, 17, 1, 0)), '2026-11-15');
const at = Date.UTC(2026, 10, 16, 12, 30, 0, 123);
assert.equal(T.snowflakeTime(idAt(at)), new Date(at).toISOString(), 'post time decoded from the status id');
assert.equal(T.snowflakeTime('12345'), null, 'pre-snowflake / junk ids give no date');
assert.equal(T.snowflakeTime('abc'), null);
// The throwback rule matches video-ads.js looksOld exactly.
const ads = fs.readFileSync(path.join(fnDir, 'video-ads.js'), 'utf8');
const mine = fs.readFileSync(srcPath, 'utf8');
const rule = text => [text.match(/const THROWBACK = .*$/m)?.[0], text.match(/function looksOld[\s\S]*?\n}\n/)?.[0]].join('\n');
assert.equal(rule(mine), rule(ads), 'looksOld is a copy of video-ads.js');

// ── citation parsing ───────────────────────────────────────────────────────
assert.deepEqual(T.statusLinks('see https://x.com/Chiefs/status/1990000000000000001 and https://twitter.com/i/web/status/1990000000000000002'), [
  { id: '1990000000000000001', handle: 'Chiefs' }, { id: '1990000000000000002', handle: '' },
]);
assert.deepEqual(T.statusLinks('https://x.com/Chiefs (profile)'), [], 'profile pages are not posts');

// ── Gateway x_search call ──────────────────────────────────────────────────
const fresh = idAt(hoursAgoMs(3));
const fresh2 = idAt(hoursAgoMs(30));
const iLink = idAt(hoursAgoMs(10));
const old = idAt(hoursAgoMs(200));
const tbt = idAt(hoursAgoMs(5));
const invented = idAt(hoursAgoMs(2));
reset();
responsesHandler = () => xReply({
  cited: [`https://x.com/Chiefs/status/${fresh}`, `https://x.com/NFL/status/${old}`, `https://x.com/i/status/${iLink}`, `https://x.com/Chiefs/status/${tbt}`, 'https://www.espn.com/nfl/story'],
  annotated: [`https://x.com/ESPNNFL/status/${fresh2}`, `https://x.com/Chiefs/status/${fresh}`],
  posts: [
    { url: `https://x.com/Chiefs/status/${fresh}`, handle: 'Chiefs', text: 'Mahomes to Kelce for six' },
    { url: `https://x.com/i/status/${iLink}`, handle: 'nflnetwork', text: 'Highlights' },
    { url: `https://x.com/Chiefs/status/${tbt}`, handle: 'Chiefs', text: '#TBT to the 2019 comeback' },
    { url: `https://x.com/Chiefs/status/${invented}`, handle: 'Chiefs', text: 'made up' },
  ],
  usage: { cost_in_usd_ticks: 250000000 },
});
out = await source.search({ sport: 'nfl', team: { name: 'Kansas City Chiefs' }, track, token: 'tok' });
assert.equal(calls.length, 1, 'one call for a team (<= 20 handles)');
const req = calls[0];
assert.equal(req.href, 'https://ai-gateway.vercel.sh/v1/responses');
assert.equal(req.headers.authorization, 'Bearer gw-test', 'Gateway key in the header, never the URL');
assert.equal(req.body.model, 'spacexai/grok-4.20-non-reasoning');
assert.equal(req.body.tools.length, 1);
assert.equal(req.body.tools[0].type, 'x_search');
assert.equal(req.body.tools[0].allowed_x_handles[0], 'Chiefs');
assert.ok(req.body.tools[0].allowed_x_handles.length <= 20);
assert.ok(req.body.tools[0].allowed_x_handles.every(h => !h.startsWith('@')), 'handles without @');
assert.match(req.body.tools[0].from_date, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(req.body.tools[0].from_date, T.fromDateFor(120));
assert.equal(req.body.tools[0].excluded_x_handles, undefined, 'allowed and excluded cannot be combined');
assert.equal(req.body.max_turns, 1);
assert.match(req.body.input[1].content, /native video/);
assert.equal(out.diag.mode, 'gateway');
const urls = out.candidates.map(c => c.url);
assert.ok(urls.includes(`https://x.com/Chiefs/status/${fresh}`));
assert.ok(urls.includes(`https://x.com/ESPNNFL/status/${fresh2}`), 'annotation citations count');
assert.ok(urls.includes(`https://x.com/nflnetwork/status/${iLink}`), 'an /i/ link takes a searched handle from the hint');
assert.ok(!urls.some(u => u.includes(old)), 'older than 120 h (by the status id) is dropped');
assert.ok(!urls.some(u => u.includes(tbt)), 'throwback text is dropped');
assert.ok(!urls.some(u => u.includes(invented)), 'a model-written URL with no citation is never used');
assert.equal(out.diag.invented, 1);
assert.equal(out.diag.tooOld, 1);
assert.equal(out.diag.throwback, 1);
assert.equal(out.diag.found, 3);
const chiefs = out.candidates.find(c => c.url.includes(fresh));
assert.deepEqual(Object.keys(chiefs).sort(), ['durationMs', 'handle', 'height', 'mediaUrl', 'platform', 'postedAt', 'sourceKind', 'text', 'thumb', 'url', 'width'].sort());
assert.equal(chiefs.platform, 'x');
assert.equal(chiefs.mediaUrl, null, 'X clips are verified downstream by clipFromPost');
assert.equal(chiefs.handle, 'Chiefs');
assert.equal(chiefs.sourceKind, 'official');
assert.equal(chiefs.postedAt, T.snowflakeTime(fresh));
assert.equal(chiefs.text, 'Mahomes to Kelce for six');
assert.equal(out.candidates[0].sourceKind, 'official', 'official first');
assert.equal(out.candidates.find(c => c.url.includes(fresh2)).sourceKind, 'media');
// Cost: xAI-reported ticks (1 USD = 1e10 ticks).
assert.equal(out.cost, 0.025);
assert.equal(usageRows.length, 1);
assert.equal(usageRows[0].feature, 'video-ads-find-clips-grok');
assert.equal(usageRows[0].model, 'spacexai/grok-4.20-non-reasoning');
assert.equal(usageRows[0].ok, true);
assert.equal(usageRows[0].cost_usd, 0.025);
assert.equal(usageRows[0].input_tokens, 3000);
assert.equal(usageRows[0].cache_read_tokens, 1000);
assert.equal(usageRows[0].output_tokens, 500);

// Estimated cost when no provider figure: tokens at list price + $0.005 per X post fetched.
const est = T.callCost('spacexai/grok-4.20-non-reasoning', { usage: { input_tokens: 4000, output_tokens: 500, input_tokens_details: { cached_tokens: 1000 }, server_side_tool_usage_details: { x_posts_fetched: 4, x_users_fetched: 1 } } });
assert.ok(Math.abs(est - (3000 * 1.25 / 1e6 + 1000 * 0.2 / 1e6 + 500 * 2.5 / 1e6 + 4 * 0.005 + 0.01)) < 1e-9);

// ── budget across batches (sport-wide = several handle batches) ────────────
const cheap = { usage: { input_tokens: 2000, output_tokens: 300, server_side_tool_usage_details: { x_search_calls: 1, x_posts_fetched: 3 } } };
responsesHandler = body => xReply({ cited: [`https://x.com/${body.tools[0].allowed_x_handles[0]}/status/${idAt(hoursAgoMs(1 + calls.length))}`], ...cheap });
reset();
out = await source.search({ sport: 'nfl', track, token: 'tok' });
assert.equal(out.diag.batches, 1, 'default $0.03 budget: the second batch would pass it');
assert.equal(calls.length, 1);
assert.ok(out.cost > 0.015 && out.cost < 0.03);
reset();
out = await source.search({ sport: 'nfl', track, token: 'tok', env: { ...process.env, CLIPS_GROK_MAX_USD: '0.2' } });
assert.ok(out.diag.batches >= 2, 'a bigger budget searches more handle batches');
assert.equal(new Set(calls.flatMap(c => c.body.tools[0].allowed_x_handles)).size, calls.flatMap(c => c.body.tools[0].allowed_x_handles).length, 'no handle searched twice');
assert.equal(usageRows.length, calls.length, 'every call is logged');
assert.ok(out.candidates.length >= 2);
reset();
out = await source.search({ sport: 'nfl', track, token: 'tok', sinceHours: 48, limit: 5, env: { ...process.env, CLIPS_GROK_MODEL: 'spacexai/grok-4.3', CLIPS_GROK_MAX_TURNS: '2' } });
assert.equal(calls[0].body.model, 'spacexai/grok-4.3', 'CLIPS_GROK_MODEL');
assert.equal(calls[0].body.max_turns, 2);
assert.equal(calls[0].body.tools[0].from_date, T.fromDateFor(48));

// A failed call is logged and does not throw.
responsesHandler = () => reply(500, { error: { message: 'upstream' } });
reset();
out = await source.search({ sport: 'mlb', track, token: 'tok' });
assert.deepEqual(out.candidates, []);
assert.equal(out.diag.failed, 1);
assert.equal(usageRows[0].ok, false);
assert.equal(usageRows[0].feature, 'video-ads-find-clips-grok');

// ── Gateway without x_search -> Sonar fallback, remembered ─────────────────
const sonarId = idAt(hoursAgoMs(6));
chatHandler = body => reply(200, {
  choices: [{ message: { role: 'assistant', content: JSON.stringify({ posts: [{ url: `https://x.com/Yankees/status/${sonarId}`, text: 'Judge walk-off' }, { url: `https://x.com/Yankees/status/${invented}` }] }) } }],
  citations: [`https://x.com/Yankees/status/${sonarId}`, 'https://www.mlb.com/news'],
  search_results: [{ url: `https://x.com/MLB/status/${old}`, title: 'old' }],
  usage: { prompt_tokens: 800, completion_tokens: 200 },
});
responsesHandler = () => reply(400, { error: { message: 'Unsupported tool type: x_search' } });
reset();
out = await source.search({ sport: 'mlb', team: { name: 'New York Yankees' }, track, token: 'tok' });
assert.equal(out.diag.unsupported, 'HTTP 400');
assert.equal(out.diag.mode, 'sonar');
assert.equal(calls.length, 2);
assert.equal(calls[1].href, 'https://ai-gateway.vercel.sh/v1/chat/completions');
assert.equal(calls[1].body.model, 'perplexity/sonar');
assert.deepEqual(calls[1].body.providerOptions.perplexity.search_domain_filter, ['x.com']);
assert.deepEqual(out.candidates.map(c => c.url), [`https://x.com/Yankees/status/${sonarId}`]);
assert.equal(out.candidates[0].text, 'Judge walk-off');
assert.equal(out.diag.invented, 1);
assert.equal(out.diag.tooOld, 1);
assert.ok(Math.abs(out.cost - (800 * 0.25 / 1e6 + 200 * 2.5 / 1e6 + 0.005)) < 1e-6);
assert.ok(usageRows.every(r => r.feature === 'video-ads-find-clips-grok'));
assert.equal(usageRows.length, 2, 'the rejected call and the fallback are both logged');
// Remembered: the next search goes straight to Sonar.
calls = [];
out = await source.search({ sport: 'mlb', track, token: 'tok' });
assert.equal(calls.length, 1);
assert.equal(calls[0].href, 'https://ai-gateway.vercel.sh/v1/chat/completions');
// CLIPS_GROK_FALLBACK=off: nothing.
calls = [];
out = await source.search({ sport: 'mlb', track, token: 'tok', env: { ...process.env, CLIPS_GROK_FALLBACK: 'off' } });
assert.equal(calls.length, 0);
assert.deepEqual(out.candidates, []);

// A 200 where the tool silently did not run (no X usage, nothing cited) also counts as unsupported.
reset();
responsesHandler = () => xReply({ cited: [], posts: [{ url: `https://x.com/Chiefs/status/${fresh}` }], usage: { server_side_tool_usage_details: {} }, toolItems: false });
out = await source.search({ sport: 'nfl', team: { name: 'Kansas City Chiefs' }, track, token: 'tok' });
assert.equal(out.diag.unsupported, 'tool ignored');
assert.equal(out.diag.mode, 'sonar');
assert.ok(!out.candidates.some(c => c.url.includes(fresh)), 'an uncited model URL never becomes a candidate');

// ── direct xAI route (XAI_API_KEY) ────────────────────────────────────────
reset();
responsesHandler = (body, href) => xReply({ cited: [`https://x.com/Chiefs/status/${fresh}`] });
out = await source.search({ sport: 'nfl', team: 'Kansas City Chiefs', track, token: 'tok', env: { ...process.env, XAI_API_KEY: 'xai-test' } });
assert.equal(calls[0].href, 'https://api.x.ai/v1/responses');
assert.equal(calls[0].headers.authorization, 'Bearer xai-test');
assert.equal(calls[0].body.model, 'grok-4.20-0309-non-reasoning');
assert.equal(out.diag.mode, 'xai');
assert.equal(out.candidates.length, 1);

console.log('test-clip-source-grok: ok');
