#!/usr/bin/env node
// Competitor ads (netlify/functions/meta-ads.js + video-ads-competitors.js),
// every network call mocked (no Apify, no AI, no Supabase):
//   actor input + Ad Library URLs, target parsing (name / Page URL / ID),
//   normalization of actor-shaped fixtures (VIDEO / IMAGE / CAROUSEL / DPA /
//   flat camelCase, dedupe, bad items), days running, summary + Page matching,
//   the missing-token state, auth, input caps, the weekly Apify cap, the
//   30-minute cache, Apify 401 / 402 / 429 / timeout, cost logging
//   (meta-ads-fetch), analyze (prompt, JSON parsing, known ids only, the
//   no-invented-numbers check, free mode, cache), and "Use this idea" mapping.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const modPath = path.join(fnDir, 'meta-ads.js');
const authPath = path.join(fnDir, '_supabase-auth.js');
const gwPath = path.join(fnDir, '_ai-gateway.js');
const fixture = JSON.parse(fs.readFileSync('scripts/fixtures/meta-ads-apify.json', 'utf8'));
const NOW = Date.parse('2026-11-21T12:00:00Z');

// ─── Mocks ────────────────────────────────────────────────────────────────
let signedIn = true;
let apify = () => reply(200, fixture.items);
let apifyCalls = [];
let usageRows = [];
let spendRows = [];
let callsThisHour = 0;
let weeklySpend = 0;
let messagesHandler = () => { throw new Error('unexpected AI call'); };
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.startsWith('https://api.apify.com/v2/acts/')) { apifyCalls.push({ href, options, input: JSON.parse(options.body) }); return apify(href, options); }
  if (href.includes('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, callsThisHour);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_spend') || href.includes('/rest/v1/rpc/frameup_team_ai_spend')) return reply(200, [{ total_usd: weeklySpend }]);
  if (href.includes('/rest/v1/frameup_ai_usage?select=cost_usd')) return reply(200, spendRows);
  if (href.includes('/rest/v1/frameup_ai_usage')) { usageRows.push(JSON.parse(options.body)); return reply(201, {}); }
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) return messagesHandler(JSON.parse(options.body));
  throw new Error(`unexpected fetch ${href}`);
};
[modPath, authPath, gwPath].forEach(p => delete require.cache[p]);
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: () => 'tok',
  verifyEsUser: async () => (signedIn ? { ok: true, user: { email: 'a@essentiallysports.com' } } : { ok: false, statusCode: 401, error: 'Authentication required.' }),
} };
delete process.env.APIFY_TOKEN;
delete process.env.APIFY_WEEKLY_LIMIT_USD;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.AI_DISABLE;
process.env.AI_GATEWAY_API_KEY = 'test-gateway-key';
const { handler, _test: M } = require(modPath);
const call = async (body, { method = 'POST', raw } = {}) => {
  const res = await handler({ httpMethod: method, headers: { authorization: 'Bearer tok' }, body: raw ?? JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; };

// ─── Actor input, URLs, targets ───────────────────────────────────────────
await test('actor input (lite actor shape)', () => {
  assert.equal(M.ACTOR, 'igolaizola~facebook-ad-library-scraper');
  assert.deepEqual(M.actorInput({ query: 'Morning Brew' }, { country: 'US', limit: 50 }), { maxItems: 50, query: 'Morning Brew', country: 'US', mediaType: 'all', activeStatus: 'active', fetchDetails: true });
  assert.deepEqual(M.actorInput({ pageId: '123456789' }, { country: 'GB', limit: 20, status: 'all' }), { maxItems: 20, pageId: '123456789', country: 'GB', mediaType: 'all', activeStatus: 'all', fetchDetails: true });
  const url = new URL(M.adLibraryUrl({ pageId: '123456789' }, { country: 'US' }));
  assert.equal(url.searchParams.get('view_all_page_id'), '123456789');
  assert.equal(url.searchParams.get('search_type'), 'page');
  assert.equal(new URL(M.adLibraryUrl({ query: 'the hustle' })).searchParams.get('q'), 'the hustle');
});
await test('targets: name, Page URL, Ad Library URL, ID, profile.php, vanity', () => {
  assert.deepEqual(M.parseTarget({ query: 'The Athletic' }), { query: 'The Athletic', label: 'The Athletic' });
  assert.equal(M.parseTarget({ query: '123456789' }).pageId, '123456789');
  assert.equal(M.parseTarget({ pageId: '987654321' }).pageId, '987654321');
  assert.equal(M.parseTarget({ query: 'https://www.facebook.com/ads/library/?active_status=active&view_all_page_id=123456789' }).pageId, '123456789');
  assert.equal(M.parseTarget({ query: 'https://www.facebook.com/ads/library/?q=morning%20brew' }).query, 'morning brew');
  assert.equal(M.parseTarget({ query: 'https://www.facebook.com/ads/library/?id=1000000000000001' }), null, 'an ad id is not a Page');
  assert.equal(M.parseTarget({ query: 'facebook.com/profile.php?id=1234567' }).pageId, '1234567');
  assert.equal(M.parseTarget({ query: 'https://www.facebook.com/Some-Page-123456789012/' }).pageId, '123456789012');
  assert.equal(M.parseTarget({ query: 'https://www.facebook.com/TheAthletic' }).query, 'The Athletic');
  assert.equal(M.parseTarget({ query: '   ' }), null);
  assert.equal(M.parseTarget({ query: 'x'.repeat(500) }).query.length, M.LIMITS.query, 'input capped');
});

// ─── Normalization + days running ─────────────────────────────────────────
const ads = M.normalizeAll(fixture.items, NOW);
const byId = Object.fromEntries(ads.map(a => [a.id, a]));
await test('normalize: dedupe and drop bad items', () => {
  assert.equal(ads.length, 5, 'duplicate, id-less and non-object items dropped');
  assert.equal(byId['1000000000000001'].pageName, 'Sample Sports Daily', 'first copy of a duplicate kept');
});
await test('normalize: video ad (Meta shape passed through)', () => {
  const a = byId['1000000000000001'];
  assert.equal(a.mediaType, 'video');
  assert.equal(a.body, 'The 5 stories every fan needs before work. Free, every morning.', 'copy envelope unwrapped');
  assert.equal(a.title, 'Sports news in 5 minutes');
  assert.equal(a.ctaText, 'Sign up');
  assert.equal(a.ctaType, 'SIGN_UP');
  assert.equal(a.linkUrl, 'https://www.samplesportsdaily.com/subscribe?utm_source=fb', 'l.facebook.com redirect unwrapped');
  assert.equal(a.linkDomain, 'samplesportsdaily.com');
  assert.match(a.thumbnailUrl, /preview1\.jpg/);
  assert.match(a.videoUrl, /sd\.mp4/, 'SD preferred for a preview');
  assert.deepEqual(a.platforms, ['Facebook', 'Instagram', 'Audience Network']);
  assert.equal(a.startDate, '2025-09-21');
  assert.equal(a.variants, 3);
  assert.equal(a.adLibraryUrl, 'https://www.facebook.com/ads/library/?id=1000000000000001');
  assert.equal(a.pageUrl, 'https://www.facebook.com/samplesportsdaily/');
});
await test('normalize: image, carousel, DPA, flat camelCase', () => {
  assert.equal(byId['1000000000000002'].mediaType, 'image');
  assert.match(byId['1000000000000002'].thumbnailUrl, /s600x600_2/, 'resized image preferred');
  assert.equal(byId['1000000000000002'].startDate, '2025-11-15', 'digit-string seconds');
  const c = byId['1000000000000003'];
  assert.equal(c.mediaType, 'carousel');
  assert.equal(c.cardCount, 3);
  assert.equal(c.linkUrl, 'https://gridironbrief.example/1', 'first card link when the ad has none');
  const d = byId['1000000000000004'];
  assert.equal(d.mediaType, 'image', 'single-card DPA is an image');
  assert.equal(d.thumbnailUrl, '', 'non-https / non-Meta image dropped');
  assert.equal(d.isActive, false);
  const f = byId['1000000000000005'];
  assert.equal(f.pageName, 'Sample Morning Letter');
  assert.equal(f.pageId, '200000000003');
  assert.equal(f.mediaType, 'text');
  assert.equal(f.ctaText, 'Subscribe');
  assert.equal(f.startDate, '2026-11-19');
  assert.deepEqual(f.platforms, ['Facebook', 'Instagram']);
});
await test('days running', () => {
  assert.equal(byId['1000000000000001'].daysRunning, 426, 'active: start to now (end date ignored)');
  assert.equal(byId['1000000000000003'].daysRunning, 20, 'total_active_time wins');
  assert.equal(byId['1000000000000004'].daysRunning, 4, 'stopped: start to end');
  assert.equal(byId['1000000000000005'].daysRunning, 2);
  assert.equal(M.daysRunning({ start: '' }), null);
  assert.equal(M.daysRunning({ start: '2026-11-21' }, NOW), 0);
  assert.equal(M.daysRunning({ start: '2026-12-01' }, NOW), 0, 'never negative');
  assert.equal(M.isoDate(1763726400000), '2025-11-21', 'milliseconds tolerated');
  assert.equal(M.isoDate('2026-11-19T10:00:00Z'), '2026-11-19');
  assert.equal(M.isoDate(0), undefined);
});
await test('summary, advertisers, Page matching', () => {
  const s = M.summarize(ads);
  assert.deepEqual(s.media, { video: 1, image: 2, carousel: 1, text: 1 });
  assert.equal(s.medianDays, 20);
  assert.equal(s.longRunning, 2);
  assert.equal(s.newThisWeek, 2);
  assert.equal(s.total, 5);
  const advs = M.advertisersFrom(ads);
  assert.equal(advs[0].adCount, 2);
  assert.equal(M.matchPage('sample sports daily', advs).pageId, '200000000001');
  assert.equal(M.matchPage('Gridiron', advs).pageId, '200000000002', 'prefix match');
  assert.equal(M.matchPage('ESPN', advs), null);
  assert.equal(M.matchPage('ab', advs), null, 'too short to match');
});

// ─── Handler: auth, not set up, caps, cache, errors ───────────────────────
await test('auth and method', async () => {
  signedIn = false;
  assert.equal((await call({ mode: 'status' })).status, 401);
  signedIn = true;
  assert.equal((await call({}, { method: 'GET' })).status, 405);
  assert.equal((await call(null, { raw: '{bad' })).status, 400);
  assert.equal((await call(null, { raw: 'x'.repeat(M.LIMITS.body + 1) })).status, 413);
  assert.equal((await call({ mode: 'nope' })).status, 400);
});
await test('missing APIFY_TOKEN: a clear "not set up" answer, no Apify call', async () => {
  M.resetCache(); apifyCalls = [];
  const st = await call({ mode: 'status' });
  assert.equal(st.status, 200);
  assert.equal(st.body.configured, false);
  assert.equal(st.body.capUsd, 4);
  assert.match(st.body.notice, /APIFY_TOKEN in Vercel/);
  for (const mode of ['ads', 'advertisers']) {
    const r = await call({ mode, query: 'Morning Brew' });
    assert.equal(r.status, 503);
    assert.equal(r.body.reason, 'not-set-up');
    assert.match(r.body.error, /Ask an admin to add APIFY_TOKEN in Vercel/);
  }
  assert.equal(apifyCalls.length, 0);
  assert.equal((await call({ mode: 'ads', query: '' })).body.reason, 'input', 'empty input explained first');
});
process.env.APIFY_TOKEN = 'apify-test-token-not-real';
await test('ads: runs the actor, logs the cost, caches 30 minutes', async () => {
  M.resetCache(); apifyCalls = []; usageRows = [];
  const r = await call({ mode: 'ads', query: 'Sample Sports Daily', limit: 500, country: 'zz' });
  assert.equal(r.status, 200);
  assert.equal(apifyCalls.length, 1);
  const c = apifyCalls[0];
  assert.match(c.href, /\/acts\/igolaizola~facebook-ad-library-scraper\/run-sync-get-dataset-items\?timeout=\d+&maxItems=60/);
  assert.ok(!c.href.includes('apify-test-token'), 'token never in the URL');
  assert.equal(c.options.headers.Authorization, 'Bearer apify-test-token-not-real');
  assert.ok(c.options.signal, 'request has a timeout');
  assert.equal(c.input.maxItems, M.LIMITS.maxAds, 'limit capped');
  assert.equal(c.input.country, 'US', 'unknown country -> US');
  assert.equal(c.input.query, 'Sample Sports Daily');
  assert.equal(r.body.matchedPage.pageName, 'Sample Sports Daily');
  assert.ok(r.body.ads.every(a => a.pageId === '200000000001'), 'only the matched Page');
  assert.ok(r.body.ads[0].daysRunning >= r.body.ads[1].daysRunning, 'longest-running first');
  assert.equal(r.body.cost.results, 8, 'raw result count (what Apify bills)');
  assert.equal(r.body.cost.usd, M.costFor(8));
  assert.equal(M.costFor(1000), 0.3);
  const row = usageRows.find(x => x.feature === 'meta-ads-fetch');
  assert.ok(row, 'logged under meta-ads-fetch');
  assert.equal(row.cost_usd, M.costFor(8));
  assert.equal(row.ok, true);
  assert.equal(row.user_email, 'a@essentiallysports.com');
  assert.match(row.model, /^apify\//);
  const again = await call({ mode: 'ads', query: 'sample sports daily', limit: 60 });
  assert.equal(apifyCalls.length, 1, 'repeat check served from cache');
  assert.equal(again.body.cost.cached, true);
  assert.equal(again.body.cost.usd, 0);
  // Expired after 30 minutes.
  for (const v of M.CACHE.values()) v.at -= M.CACHE_TTL_MS + 1;
  await call({ mode: 'ads', query: 'sample sports daily', limit: 60 });
  assert.equal(apifyCalls.length, 2, 'cache expires after 30 minutes');
});
await test('ads: keyword with no matching Page keeps all and offers advertisers', async () => {
  M.resetCache();
  const r = await call({ mode: 'ads', query: 'free newsletter' });
  assert.equal(r.body.matchedPage, null);
  assert.equal(r.body.ads.length, 5);
  assert.ok(r.body.advertisers.length >= 3);
  const byPage = await call({ mode: 'ads', url: 'https://www.facebook.com/ads/library/?view_all_page_id=200000000002' });
  assert.equal(apifyCalls.at(-1).input.pageId, '200000000002');
});
await test('advertisers mode', async () => {
  M.resetCache(); apifyCalls = [];
  const r = await call({ mode: 'advertisers', query: 'sample' });
  assert.equal(r.status, 200);
  assert.equal(apifyCalls[0].input.maxItems, M.LIMITS.advertisers);
  assert.equal(r.body.advertisers.length, 3);
  const id = await call({ mode: 'advertisers', query: '123456789' });
  assert.equal(apifyCalls.length, 1, 'a Page ID needs no run');
  assert.equal(id.body.advertisers[0].pageId, '123456789');
});
await test('Apify errors: 401 / 402 / 429 / 403 plan / timeout, logged as failed', async () => {
  const cases = [
    [() => reply(401, {}), 502, 'apify-auth', /APIFY_TOKEN/],
    [() => reply(402, {}), 503, 'apify-credit', /out of credit/],
    [() => reply(429, {}), 429, 'apify-busy', /busy/],
    [() => reply(403, 'public-actor-disabled'), 503, 'apify-plan', /plan/],
    [() => reply(408, {}), 504, 'timeout', /too long/],
    [() => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }, 504, 'timeout', /too long/],
    [() => reply(500, 'boom'), 502, 'apify', /didn't work/],
  ];
  for (const [fn, status, reason, msg] of cases) {
    M.resetCache(); usageRows = []; apify = fn;
    const r = await call({ mode: 'ads', query: 'Morning Brew' });
    assert.equal(r.status, status, reason);
    assert.equal(r.body.reason, reason);
    assert.match(r.body.error, msg);
    assert.ok(!JSON.stringify(r.body).includes('apify-test-token'), 'token never echoed');
    assert.equal(usageRows.find(x => x.feature === 'meta-ads-fetch')?.ok, false);
    assert.equal(usageRows.find(x => x.feature === 'meta-ads-fetch')?.cost_usd, 0);
  }
  apify = () => reply(200, fixture.items);
});
await test('hourly limit and AI budget gate apply to checks', async () => {
  M.resetCache();
  callsThisHour = 999;
  const r = await call({ mode: 'ads', query: 'Morning Brew' });
  assert.equal(r.status, 429);
  assert.equal(r.body.reason, 'limit');
  callsThisHour = 0;
  weeklySpend = 999;
  const g = await call({ mode: 'ads', query: 'Morning Brew' });
  assert.equal(g.status, 429);
  assert.equal(g.body.reason, 'over-budget', 'not turned into a free-mode success');
  assert.match(g.body.error, /week/i);
  weeklySpend = 0;
  process.env.AI_DISABLE = 'meta-ads';
  const off = await call({ mode: 'ads', query: 'Morning Brew' });
  assert.equal(off.status, 503);
  assert.match(off.body.error, /Competitor ads is switched off/);
  delete process.env.AI_DISABLE;
});
await test('weekly Apify cap: $4 default, env only lowers, friendly message', async () => {
  assert.equal(M.weeklyCapUsd({}), 4);
  assert.equal(M.weeklyCapUsd({ APIFY_WEEKLY_LIMIT_USD: '2' }), 2);
  assert.equal(M.weeklyCapUsd({ APIFY_WEEKLY_LIMIT_USD: '50' }), 4, 'cannot raise');
  assert.equal(M.weeklyCapUsd({ APIFY_WEEKLY_LIMIT_USD: 'abc' }), 4);
  M.resetCache(); apifyCalls = [];
  M.noteSpend(3.995);
  const r = await call({ mode: 'ads', query: 'Morning Brew' });
  assert.equal(r.status, 429);
  assert.equal(r.body.reason, 'over-cap');
  assert.match(r.body.error, /\$4 budget for competitor checks is used up/);
  assert.equal(apifyCalls.length, 0, 'no run over the cap');
  // Team-wide spend from the usage table (service role) when it is readable.
  M.resetCache();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  spendRows = [{ cost_usd: 2.5 }, { cost_usd: '1.49' }];
  assert.equal((await M.weekSpendUsd()).usd, 3.99);
  assert.equal((await call({ mode: 'ads', query: 'Morning Brew' })).body.reason, 'over-cap');
  spendRows = [{ cost_usd: 0.1 }];
  assert.equal((await call({ mode: 'ads', query: 'Morning Brew' })).status, 200);
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  spendRows = [];
  // A cached result is still served over the cap.
  M.noteSpend(10);
  assert.equal((await call({ mode: 'ads', query: 'Morning Brew' })).body.cost.cached, true);
});

// ─── Analyze ──────────────────────────────────────────────────────────────
const clientAds = M.normalizeAll(fixture.items, NOW);
const good = {
  headline: 'They lean on short video that promises to save fans time.',
  working: [{ id: '1000000000000001', why: 'Leads with "5 stories" and free in the first line.' }, { id: '1000000000000003', why: 'Not a long-runner: must be dropped.' }, { id: '999', why: 'Unknown id: dropped.' }],
  testing: [{ id: '1000000000000005', what: 'A social-proof headline.' }],
  trends: [{ label: 'Formats', detail: 'Short vertical video leads.' }, { label: 'Offers', detail: 'Every ad says free; one claims 80% of fans read it.' }],
  notWorking: [{ id: '1000000000000004', pattern: 'Discount urgency', why: 'Stopped quickly.' }],
  ideas: [
    { brand: 'the-huddle', angle: 'Save time', headline: 'Every NFL story you need, in one short email. Free.', highlight: 'in one short email.', body: ['Skip the endless scroll.'], cta: 'SIGN UP THE HUDDLE', inspiredBy: ['1000000000000001', '42'] },
    { brand: 'es-dugout', angle: 'Explained', headline: 'Missed the game? We explain it before breakfast.', highlight: 'not in the headline', body: 'ES Dugout in plain words.', cta: '' },
    { brand: 'essentially-cfb', angle: 'Numbers', headline: 'Join 100,000 fans. Free.', highlight: 'Free.', body: ['College football daily.'], cta: 'SIGN UP ES CFB' },
    { brand: 'somebody-else', headline: 'x', body: ['y'] },
  ],
};
await test('analyze prompt: buckets in code, ids only, no numbers rule', () => {
  const groups = M.buckets(M.cleanAds(clientAds));
  assert.deepEqual(groups.working.map(a => a.id), ['1000000000000001', '1000000000000002']);
  assert.deepEqual(groups.testing.map(a => a.id), ['1000000000000005', '1000000000000004']);
  assert.deepEqual(groups.stopped.map(a => a.id), ['1000000000000004']);
  const prompt = M.analyzePrompt(M.cleanAds(clientAds), 'Sample Sports Daily', groups);
  assert.match(prompt, /Long-running ad ids \(30\+ days\): 1000000000000001, 1000000000000002/);
  assert.match(prompt, /Essentially|essentially-cfb\|es-dugout\|the-huddle/);
  assert.match(M.ANALYZE_SYSTEM, /Do not write any number/);
  assert.match(M.ANALYZE_SYSTEM, /Essentially CFB.*ES Dugout.*The Huddle/s);
  assert.equal(M.ANALYZE_TIER, 'main', 'cheapest tier that writes usable copy');
});
await test('invented numbers: allowed only when in the ads', () => {
  const allowed = M.allowedNumbers(M.cleanAds(clientAds));
  assert.deepEqual(M.inventedNumbers('Leads with "5 stories"', allowed), []);
  assert.deepEqual(M.inventedNumbers('80% of fans', allowed), ['80']);
  assert.deepEqual(M.inventedNumbers('runs 30+ days', allowed), [], 'stated thresholds');
  assert.deepEqual(M.inventedNumbers('4 million people', allowed), [], '"4 million" is in an ad title');
  assert.deepEqual(M.inventedNumbers('ran 426 days', allowed), ['426'], 'the page shows days; the AI must not');
});
await test('analyze: parse, keep known ids, drop invented numbers, fix highlights', async () => {
  M.resetCache(); usageRows = [];
  let sent = null;
  messagesHandler = body => { sent = body; return reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 6000, output_tokens: 1500 }, content: [{ type: 'text', text: '```json\n' + JSON.stringify(good) + '\n```' }] }); };
  const r = await call({ mode: 'analyze', target: 'Sample Sports Daily', ads: clientAds });
  assert.equal(r.status, 200);
  assert.match(sent.model, /haiku/);
  const A = r.body.analysis;
  assert.deepEqual(A.working.map(w => w.id), ['1000000000000001'], 'only long-running, known ids');
  assert.deepEqual(A.testing.map(w => w.id), ['1000000000000005']);
  assert.deepEqual(A.trends.map(t => t.label), ['Formats'], 'the invented 80% trend is dropped');
  assert.equal(A.notWorking[0].inferred, true);
  assert.equal(A.ideas.length, 2, 'numbers and unknown brands dropped');
  assert.equal(A.ideas[0].highlight, 'in one short email.');
  assert.deepEqual(A.ideas[0].inspiredBy, ['1000000000000001'], 'unknown inspiration ids dropped');
  assert.equal(A.ideas[1].highlight, 'We explain it before breakfast.', 'a highlight not in the headline falls back to its last short sentence');
  assert.deepEqual(A.ideas[1].body, ['ES Dugout in plain words.']);
  assert.equal(A.ideas[1].cta, 'SIGN UP ES DUGOUT', 'empty CTA -> brand CTA');
  assert.ok(A.dropped >= 2);
  assert.ok(r.body.cost.usd > 0 && r.body.cost.usd < 0.01, 'about a tenth of a cent');
  assert.ok(usageRows.some(x => x.feature === 'meta-ads-analyze' && x.ok), 'logged as meta-ads-analyze');
  const again = await call({ mode: 'analyze', target: 'Sample Sports Daily', ads: clientAds });
  assert.equal(again.body.cost.cached, true, 'analysis cached');
});
await test('analyze: garbled reply, no ads, AI error, free mode', async () => {
  M.resetCache();
  assert.equal((await call({ mode: 'analyze', ads: [] })).status, 400);
  messagesHandler = () => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'not json' }] });
  assert.equal((await call({ mode: 'analyze', ads: clientAds })).status, 502);
  messagesHandler = () => reply(500, { error: { message: 'down' } });
  const e = await call({ mode: 'analyze', ads: clientAds, target: 'x' });
  assert.equal(e.status, 502);
  assert.match(e.body.error, /still work/);
  M.resetCache();
  weeklySpend = 999; // over the person's weekly AI budget -> free mode: counted facts only
  messagesHandler = () => { throw new Error('no AI in free mode'); };
  const f = await call({ mode: 'analyze', ads: clientAds, target: 'y' });
  assert.equal(f.status, 200);
  assert.equal(f.body.ai, false);
  assert.equal(f.body.mode, 'free');
  assert.deepEqual(f.body.analysis.working.map(w => w.id), ['1000000000000001', '1000000000000002']);
  assert.deepEqual(f.body.analysis.ideas, []);
  weeklySpend = 0;
  // cleanAds caps what the browser can send.
  const many = Array.from({ length: 200 }, (_, i) => ({ id: String(1e15 + i), body: 'x'.repeat(5000), mediaType: 'evil' }));
  const cleaned = M.cleanAds(many);
  assert.equal(cleaned.length, M.LIMITS.analyzeAds);
  assert.equal(cleaned[0].body.length, 400);
  assert.equal(cleaned[0].mediaType, 'text');
});

// ─── Client helpers ───────────────────────────────────────────────────────
const C = require('../video-ads-competitors.js');
const BR = require('../video-ads-brands.js');
await test('"Use this idea" mapping', () => {
  const out = C.ideaToCopy({ brand: 'the-huddle', headline: 'Every NFL story you need, in one short email. Free.', highlight: 'IN ONE SHORT EMAIL.', body: ['Skip the scroll.', 'Second.'], cta: 'SIGN UP THE HUDDLE' }, BR.AD_BRANDS);
  assert.equal(out.brandId, 'the-huddle');
  assert.deepEqual(out.fields, { style: 'highlight', headline: 'Every NFL story you need, in one short email. Free.', highlight: 'in one short email.', body: ['Skip the scroll.', 'Second.', ''], cta: '' }, 'brand default CTA -> empty (the placeholder shows it)');
  const custom = C.ideaToCopy({ brand: 'es-dugout', headline: 'A', highlight: 'B', body: 'One', cta: 'Get it free' }, BR.AD_BRANDS);
  assert.equal(custom.fields.highlight, '', 'highlight must be in the headline');
  assert.deepEqual(custom.fields.body, ['One', '', '']);
  assert.equal(custom.fields.cta, 'Get it free');
  assert.equal(C.ideaToCopy({ brand: 'nope', headline: 'h', body: [] }, BR.AD_BRANDS).brandId, '');
});
await test('client: cost, labels, quick picks, sample-data hosts', () => {
  assert.equal(C.estimateCost(50), 0.015);
  assert.equal(C.fmtUsd(0), '$0');
  assert.equal(C.fmtUsd(0.0004), '<$0.001');
  assert.equal(C.fmtUsd(0.015), '$0.015');
  assert.equal(C.fmtUsd(0.0024), '$0.002');
  assert.equal(C.fmtUsd(1.5), '$1.50');
  assert.equal(C.daysLabel(1), '1 day running');
  assert.equal(C.daysLabel(null), 'Start date unknown');
  const labels = C.QUICK_PICKS.flatMap(g => g.items.map(i => i.label));
  ['The Athletic', 'Front Office Sports', 'Bleacher Report', 'Barstool Sports', 'ESPN', 'Yahoo Sports', 'On3', '247Sports', 'Morning Brew', '1440', 'The Hustle'].forEach(l => assert.ok(labels.includes(l), l));
  const mem = new Map(); const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.deepEqual(C.readPicks(storage), []);
  C.writePicks(storage, ['Axios', 'Semafor']);
  assert.deepEqual(C.readPicks(storage), ['Axios', 'Semafor']);
  assert.deepEqual(C.readPicks({ getItem: () => { throw new Error('blocked'); } }), [], 'blocked storage is fine');
  const loc = (hostname, search = '') => ({ hostname, search });
  assert.equal(C.isDemo(loc('localhost')), true);
  assert.equal(C.isDemo(loc('127.0.0.1')), true);
  assert.equal(C.isDemo(loc('localhost', '?demo=off')), false);
  assert.equal(C.isDemo(loc('frameup.essentiallysports.com')), false);
  assert.equal(C.isDemo(loc('frameup.essentiallysports.com', '?demo=ads')), false, 'never sample data in production');
  assert.equal(C.isDemo(loc('essentiallysports-design-tools-git-x.vercel.app', '?demo=ads')), true);
});
await test('sample data: made-up brands, no numbers in ideas, server-shaped', () => {
  const sandbox = {};
  new Function('self', fs.readFileSync('video-ads-competitors-demo.js', 'utf8'))(sandbox);
  const D = sandbox.VideoAdsCompetitorsDemo;
  assert.ok(D.brands.every(b => /^Sample /.test(b)), 'sample brands only');
  const r = D.ads('Sample Gridiron Brief');
  assert.equal(r.matchedPage.pageName, 'Sample Gridiron Brief');
  assert.equal(r.cost.sample, true);
  assert.ok(r.ads.every(a => a.id && a.mediaType && 'daysRunning' in a && a.adLibraryUrl));
  const an = D.analysis(r).analysis;
  assert.equal(an.ideas.length, 5);
  assert.ok(an.ideas.every(i => !/\d/.test(`${i.headline} ${i.body.join(' ')}`) && i.headline.includes(i.highlight)));
  assert.deepEqual(new Set(an.ideas.map(i => i.brand)), new Set(['the-huddle', 'essentially-cfb', 'es-dugout']));
  assert.equal(D.ads('x', { empty: true }).ads.length, 0);
});
await test('wiring: adapter, vercel.json, page, credit', () => {
  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  assert.equal(vercel.functions['api/meta-ads.js'].maxDuration, 120);
  assert.match(fs.readFileSync('api/meta-ads.js', 'utf8'), /netlify\/functions\/meta-ads\.js/);
  const html = fs.readFileSync('video-ads.html', 'utf8');
  assert.match(html, /video-ads-competitors\.js\?v=/);
  assert.match(html, /video-ads-competitors\.css\?v=/);
  assert.ok(html.indexOf('video-ads-competitors.js') > html.indexOf('video-ads.js?v='), 'loads after video-ads.js');
  const src = fs.readFileSync('netlify/functions/meta-ads.js', 'utf8');
  assert.match(src, /MIT License/);
  assert.match(src, /process\.env|env\.APIFY_TOKEN/);
  assert.doesNotMatch(src, /require\('(?!\.\/|node:)/, 'no new npm dependencies');
});

console.log(`meta-ads: ${passed} checks passed`);
