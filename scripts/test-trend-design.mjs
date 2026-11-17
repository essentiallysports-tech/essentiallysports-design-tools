// Trend Design (netlify/functions/trend-design.js), offline, every network
// call mocked:
//   1. sport classifier and RSS parsing
//   2. freshness: real publish times, 48 h news / 24 h search cutoffs
//   3. the same story from several sources is merged (title similarity)
//   4. ranking: recency × momentum × ES relevance
//   5. cache: fresh, stale-while-revalidate, stale on failure, forced refresh
//   6. AI enrichment: lazy, batched, cached per trend id, gated, logged
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const authPath = path.join(fnDir, '_supabase-auth.js');

// ── Mocks ──────────────────────────────────────────────────────────────────
const NOW = Date.now();
const hoursAgo = h => new Date(NOW - h * 3600e3).toUTCString();
let feeds = {};
let rssCalls = 0;
let failRss = false;
let aiCalls = [];
let aiReply = null;
let usageRows = [];
let hourlyCount = 0;
let weeklyUsd = 0;
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.startsWith('https://trends.google.com/') || href.startsWith('https://news.google.com/')) {
    rssCalls += 1;
    if (failRss) throw new Error('offline');
    const id = href.includes('trends.google.com') ? 'trends' : href.includes('/topic/SPORTS') ? 'sports' : (Object.keys(feeds).find(k => href.includes(`q=${encodeURIComponent(k)}`)) || '');
    return reply(200, feeds[id] || '<rss><channel></channel></rss>');
  }
  if (href.startsWith('https://en.wikipedia.org/')) return reply(200, { pages: [] });
  if (href.endsWith('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, hourlyCount);
  if (href.endsWith('/rest/v1/rpc/frameup_my_ai_spend')) return reply(200, [{ total_usd: weeklyUsd }]);
  if (href.includes('/rest/v1/frameup_ai_usage')) { usageRows.push(JSON.parse(options.body)); return reply(201, {}); }
  if (href.startsWith('https://ai-gateway.vercel.sh/')) {
    const body = JSON.parse(options.body);
    aiCalls.push(body);
    return reply(200, aiReply ? aiReply(body) : { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0 } });
  }
  throw new Error(`unexpected fetch ${href}`);
};
process.env.AI_GATEWAY_API_KEY = 'gw-test';
delete process.env.GENERATE_AI;
delete process.env.GROQ_API_KEY;
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: headers => String(headers?.authorization || '').replace(/^Bearer\s+/i, ''),
  verifyEsUser: async event => (event.headers?.authorization ? { ok: true, user: { id: 'u1', email: 'designer@essentiallysports.com' } } : { ok: false, statusCode: 401, error: 'Sign in.' }),
} };
const trend = require(path.join(fnDir, 'trend-design.js'));
const { _test: T, handler, getTrends } = trend;
const { classify, parseNews, parseTrends } = T;

// ── 1. Classifier and RSS parsing ─────────────────────────────────────────
const cases = [
  ['Scottie Scheffler wins at Memorial', 'golf'],
  ['McIlroy and Rahm favourites for DP World Tour Championship title', 'golf'],
  ['Sinner beats Alcaraz in ATP Finals', 'tennis'],
  ['Coco Gauff reaches WTA Finals semis', 'tennis'],
  ['Chiefs rivals won\'t finalize deal made at NFL trade deadline', 'nfl'],
  ['Giants quarterback benched after loss', 'nfl'],
  ['Giants pitcher signs extension', 'mlb'],
  ['Yankees eye Juan Soto reunion', 'mlb'],
  ['Jeremiah Smith Ohio State Football News', 'cfb'],
  ['College Football Playoff rankings: Tennessee climbs', 'cfb'],
  ['Stephen Curry injured versus Rockets', 'others'],
  ['Lakers win 7th straight', 'others'],
];
for (const [text, expected] of cases) assert.equal(classify(text).category, expected, `${text} → ${expected}`);
for (const text of ['Game Of Thrones', 'Cathay Pacific', 'Kylie Jenner lawsuit', 'PS6 release date']) {
  assert.equal(classify(text).category, null, `${text} should not be a sport`);
}

const news = parseNews(`<rss><channel><item><title>Brewers’ Misiorowski wins NL Cy Young - ESPN</title><link>https://news.google.com/articles/abc</link><pubDate>${hoursAgo(2)}</pubDate><source url="https://espn.com">ESPN</source></item></channel></rss>`);
assert.equal(news.length, 1);
assert.equal(news[0].title, 'Brewers’ Misiorowski wins NL Cy Young');
assert.equal(news[0].source, 'ESPN');
assert.equal(news[0].type, 'news');

const trends = parseTrends(`<rss><channel><item><title>jeremiah smith</title><ht:approx_traffic>200+</ht:approx_traffic><pubDate>${hoursAgo(3)}</pubDate><ht:picture>https://encrypted-tbn2.gstatic.com/x</ht:picture><ht:news_item><ht:news_item_title>Ohio State launches Heisman campaign</ht:news_item_title><ht:news_item_url>https://example.com/a</ht:news_item_url><ht:news_item_source>Eleven Warriors</ht:news_item_source></ht:news_item></item></channel></rss>`);
assert.equal(trends[0].title, 'Jeremiah Smith');
assert.equal(trends[0].traffic, '200+');
assert.equal(trends[0].type, 'search');
assert.equal(trends[0].related[0].source, 'Eleven Warriors');
assert.match(trends[0].image, /^https:/);

// ── 2. Freshness: real dates and hard cutoffs ──────────────────────────────
{
  assert.equal(T.publishTime(''), '', 'no date → no time (never "just now")');
  assert.equal(T.publishTime('not a date'), '', 'bad date → no time');
  assert.equal(T.publishTime(new Date(NOW + 3 * 3600e3).toUTCString(), NOW), '', 'far future date is not trusted');
  assert.equal(T.publishTime(new Date(NOW + 5 * 60e3).toISOString(), NOW), new Date(NOW).toISOString(), 'small clock skew is clamped to now');
  const missing = parseNews('<rss><channel><item><title>Chiefs sign a kicker - ESPN</title><link>https://news.google.com/x</link></item></channel></rss>');
  assert.equal(missing[0].publishedAt, '', 'an item without pubDate has no publish time');
  const at = h => new Date(NOW - h * 3600e3).toISOString();
  assert.equal(T.withinCutoff({ type: 'news', publishedAt: at(47) }, NOW), true, 'news at 47 h is kept');
  assert.equal(T.withinCutoff({ type: 'news', publishedAt: at(49) }, NOW), false, 'news at 49 h is dropped');
  assert.equal(T.withinCutoff({ type: 'search', publishedAt: at(23) }, NOW), true, 'search at 23 h is kept');
  assert.equal(T.withinCutoff({ type: 'search', publishedAt: at(25) }, NOW), false, 'search at 25 h is dropped');
  assert.equal(T.withinCutoff({ type: 'search', publishedAt: at(25) }, NOW, T.MAX_AGE_H['2d']), true, 'Video Ads (2 d) keeps search up to 48 h');
  assert.equal(T.withinCutoff({ type: 'news', publishedAt: '' }, NOW), false, 'no date → dropped');
}

// ── 3. Same story, several sources ──────────────────────────────────────────
{
  const a = { type: 'news', title: 'Chiefs beat Bills 27-24 as Mahomes throws 3 TDs', source: 'ESPN', sourceDomain: 'espn.com', url: 'https://a', related: [] };
  const b = { type: 'news', title: 'Mahomes throws three TDs as Chiefs top Bills', source: 'CBS Sports', sourceDomain: 'cbssports.com', url: 'https://b', related: [] };
  const c = { type: 'news', title: 'Chiefs sign veteran kicker to practice squad', source: 'NFL.com', sourceDomain: 'nfl.com', url: 'https://c', related: [] };
  const s = { type: 'search', title: 'Jeremiah Smith', query: 'jeremiah smith', source: 'Google Trends', sourceDomain: 'trends.google.com', url: 'https://s', related: [] };
  const n = { type: 'news', title: 'Jeremiah Smith makes another one-handed catch for Ohio State', source: 'On3', sourceDomain: 'on3.com', url: 'https://n', related: [] };
  assert.equal(T.sameStory(a, b), true, 'reworded headline is the same story');
  assert.equal(T.sameStory(a, c), false, 'same team, different story');
  assert.equal(T.sameStory(s, n), true, 'a search trend absorbs a story that names it');
  assert.equal(T.sameStory({ type: 'search', query: 'chiefs', title: 'Chiefs' }, c), false, 'a one-word search never swallows stories');
  const merged = T.dedupe([s, a, b, c, n]);
  assert.equal(merged.length, 3, 'five items, three stories');
  const chiefs = merged.find(m => m.url === 'https://a');
  assert.equal(chiefs.coverage, 2, 'two sources for the Chiefs win');
  assert.equal(chiefs.related[0].url, 'https://b', 'the second source becomes a related link');
  assert.equal(merged.find(m => m.type === 'search').coverage, 2);
}

// ── 4. Ranking ───────────────────────────────────────────────────────────────
{
  const at = h => new Date(NOW - h * 3600e3).toISOString();
  const r = item => T.rankScore({ category: 'nfl', score: 12, coverage: 1, ...item }, NOW);
  assert.ok(r({ type: 'news', publishedAt: at(1) }) > r({ type: 'news', publishedAt: at(10) }), 'newer news ranks higher');
  assert.ok(r({ type: 'search', traffic: '50K+', publishedAt: at(4) }) > r({ type: 'search', traffic: '200+', publishedAt: at(4) }), 'more searches rank higher');
  assert.ok(r({ type: 'news', publishedAt: at(3), coverage: 3 }) > r({ type: 'news', publishedAt: at(3), coverage: 1 }), 'more sources rank higher');
  assert.ok(r({ type: 'news', publishedAt: at(2) }) > T.rankScore({ type: 'news', publishedAt: at(2), category: 'others', score: 12 }, NOW), 'ES core sports outrank Others');
  assert.ok(r({ type: 'search', traffic: '100K+', publishedAt: at(6) }) > r({ type: 'news', publishedAt: at(2) }), 'a big search trend beats a slightly newer story');
  assert.equal(T.trafficValue('1M+'), 1e6);
  assert.equal(T.trafficValue('20K+'), 2e4);
  assert.equal(T.trendId('Chiefs beat Bills!'), T.trendId('chiefs beat bills'), 'ids are stable across punctuation and case');
}

// ── 5. Build + cache ─────────────────────────────────────────────────────────
const item = (title, h, source = 'ESPN', domain = 'espn.com') => `<item><title>${title} - ${source}</title><link>https://news.google.com/articles/${encodeURIComponent(title)}</link>${h == null ? '' : `<pubDate>${hoursAgo(h)}</pubDate>`}<source url="https://${domain}">${source}</source></item>`;
feeds = {
  trends: `<rss><channel><item><title>travis kelce</title><ht:approx_traffic>100K+</ht:approx_traffic><pubDate>${hoursAgo(5)}</pubDate><ht:news_item><ht:news_item_title>Travis Kelce leads Chiefs past Bills</ht:news_item_title><ht:news_item_url>https://example.com/k</ht:news_item_url><ht:news_item_source>ESPN</ht:news_item_source></ht:news_item><ht:news_item><ht:news_item_title>Chiefs tight end Travis Kelce scores twice in NFL win</ht:news_item_title><ht:news_item_url>https://example.com/k2</ht:news_item_url><ht:news_item_source>CBS</ht:news_item_source></ht:news_item></item>`
    + `<item><title>old nfl trend chiefs</title><ht:approx_traffic>1M+</ht:approx_traffic><pubDate>${hoursAgo(30)}</pubDate><ht:news_item><ht:news_item_title>NFL Chiefs quarterback news</ht:news_item_title><ht:news_item_url>https://example.com/o</ht:news_item_url><ht:news_item_source>ESPN</ht:news_item_source></ht:news_item></item></channel></rss>`,
  'NFL when:1d': `<rss><channel>${item('Chiefs beat Bills 27-24 as Mahomes throws 3 TDs', 2)}${item('Mahomes throws three TDs as Chiefs top Bills', 3, 'CBS Sports', 'cbssports.com')}${item('Steelers fire coordinator after NFL loss', 1, 'NFL.com', 'nfl.com')}${item('Week 9 NFL quarterback rankings from last season', 60, 'NFL.com', 'nfl.com')}${item('Cowboys quarterback news with no date', null, 'NFL.com', 'nfl.com')}</channel></rss>`,
};
{
  T.reset();
  rssCalls = 0;
  const data = await getTrends(false);
  assert.ok(rssCalls >= 7, 'every source fetched once');
  const nfl = data.items.filter(i => i.category === 'nfl');
  const titles = nfl.map(i => i.title);
  assert.ok(!titles.some(t => /last season/.test(t)), 'news older than 48 h is dropped');
  assert.ok(!titles.some(t => /no date/.test(t)), 'news without a date is dropped');
  assert.ok(!titles.some(t => /^Old Nfl/i.test(t)), 'a search trend older than 24 h is dropped');
  assert.equal(data.freshness.dropped >= 3, true, 'dropped items are counted');
  assert.equal(titles.filter(t => /Mahomes/.test(t)).length, 1, 'the Mahomes story shows once');
  assert.equal(nfl[0].title, 'Travis Kelce', 'the big, fresh search trend ranks first');
  assert.ok(nfl.every((x, i) => i === 0 || nfl[i - 1].rank >= x.rank), 'sorted by rank');
  assert.equal(nfl.find(i => /Mahomes/.test(i.title)).coverage, 2);
  assert.equal(nfl.find(i => /Steelers/.test(i.title)).team?.name, 'Pittsburgh Steelers', 'team found for the logo');
  assert.match(nfl.find(i => /Steelers/.test(i.title)).team.logo, /^https:\/\/a\.espncdn\.com\/.+pit\.png$/);
  assert.ok(nfl.every(i => /^t-[a-z0-9]+$/.test(i.id)), 'stable ids');
  assert.equal(data.refreshSeconds, 600, 'fresh for 10 minutes');

  // Fresh: served from memory, no fetch.
  rssCalls = 0;
  await getTrends(false);
  assert.equal(rssCalls, 0, 'under 10 minutes: no refetch');

  // 10–60 minutes: served at once, rebuilt in the background.
  T.setCacheAge('1d', T.FRESH_MS + 60e3);
  const before = data.updatedAt;
  const swr = await getTrends(false);
  assert.equal(swr.updatedAt, before, 'stale copy served immediately');
  assert.equal(swr.revalidating, true);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(rssCalls >= 7, 'background rebuild ran');
  const after = await getTrends(false);
  assert.ok(!after.revalidating, 'next request gets the rebuilt copy');

  // Older than 60 minutes and every source fails: the request waits for the
  // rebuild, which fails, so the last good copy comes back marked stale.
  T.setCacheAge('1d', T.STALE_MAX_MS + 60e3);
  failRss = true;
  const failed = await getTrends(false);
  failRss = false;
  assert.equal(failed.stale, true, 'marked stale');
  assert.equal(failed.updatedAt, after.updatedAt, 'the real age is kept');
  assert.ok(failed.items.length > 0, 'trends are not wiped by an outage');
  // No copy at all and every source fails: the request fails (502).
  T.reset();
  failRss = true;
  const quiet = console.error;
  console.error = () => {};
  const down = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: {} });
  console.error = quiet;
  failRss = false;
  assert.equal(down.statusCode, 502);
  assert.equal(down.headers['Cache-Control'], 'no-store', 'an error is never cached');
  await getTrends(false);

  // Forced refresh: rebuilds only data older than 2 minutes.
  rssCalls = 0;
  await getTrends(true);
  assert.equal(rssCalls, 0, 'a fresh copy is not rebuilt by Refresh');
  T.setCacheAge('1d', 3 * 60e3);
  await getTrends(true);
  assert.ok(rssCalls >= 7, 'Refresh rebuilds a 3-minute-old copy');

  // GET: CDN header, and ?fresh=1 is never stored by the CDN.
  const res = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: {} });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Cache-Control'], /s-maxage=300/);
  assert.match(res.headers['Cache-Control'], /stale-while-revalidate/);
  const forced = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { fresh: '1' } });
  assert.equal(forced.headers['Cache-Control'], 'no-store');
}

// ── 6. AI enrichment ─────────────────────────────────────────────────────────
{
  const data = await getTrends(false);
  const nfl = data.items.filter(i => i.category === 'nfl').slice(0, 3);
  const post = (body, auth = true) => handler({ httpMethod: 'POST', headers: auth ? { authorization: 'Bearer tok' } : {}, body: JSON.stringify(body) })
    .then(r => ({ status: r.statusCode, body: JSON.parse(r.body || '{}') }));
  aiReply = body => {
    const ids = [...body.messages.at(-1).content.matchAll(/^id: (\S+)/gm)].map(m => m[1]);
    return {
      choices: [{ message: { content: JSON.stringify({ items: ids.map(id => ({ id, why: 'Fans want to know if this changes the playoff race.', titles: ['Chiefs edge Bills again', 'Mahomes does it again', 'Is this Chiefs team back?', 'A fourth idea is dropped'] })) }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 760, completion_tokens: 1150 },
    };
  };

  // Nothing is asked of the AI by loading trends.
  aiCalls = [];
  await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: {} });
  assert.equal(aiCalls.length, 0, 'GET never calls the AI');

  assert.equal((await post({ mode: 'enrich', items: [{ id: nfl[0].id }] }, false)).status, 401, 'sign-in required');
  assert.equal((await post({ mode: 'enrich', items: [] })).status, 400);

  // One batched call for several trends, light tier, logged with its feature.
  usageRows = [];
  const res = await post({ mode: 'enrich', items: nfl.map(i => ({ id: i.id, title: 'ignored: the server copy wins', related: [] })) });
  assert.equal(res.status, 200);
  assert.equal(res.body.ai, true);
  assert.equal(aiCalls.length, 1, 'one call covers every requested trend');
  assert.equal(aiCalls[0].model, 'openai/gpt-oss-20b', 'light tier');
  assert.ok(aiCalls[0].max_tokens <= 3000, 'output is capped');
  assert.ok(!aiCalls[0].messages.at(-1).content.includes('ignored'), 'prompt uses the server copy of a known trend');
  assert.equal(Object.keys(res.body.items).length, nfl.length);
  const first = res.body.items[nfl[0].id];
  assert.equal(first.titles.length, 3, 'three headlines');
  assert.match(first.why, /playoff race/);
  assert.equal(usageRows.length, 1);
  assert.equal(usageRows[0].feature, 'trend-enrich', 'usage logged under its feature name');
  assert.ok(usageRows[0].cost_usd > 0 && usageRows[0].cost_usd < 0.001, `cost per batch is tiny (${usageRows[0].cost_usd})`);

  // Cached per trend id, for everyone: no second call.
  aiCalls = [];
  const again = await post({ mode: 'enrich', items: [{ id: nfl[1].id }, { id: nfl[0].id }] });
  assert.equal(aiCalls.length, 0, 'cached trends cost nothing');
  assert.equal(again.body.items[nfl[1].id].cached, true);
  const withAi = JSON.parse((await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: {} })).body);
  assert.equal(withAi.items.find(i => i.id === nfl[0].id).ai.titles.length, 3, 'GET carries cached enrichment for free');

  // Batch limit: at most 6 trends per call.
  T.reset();
  await getTrends(false);
  aiCalls = [];
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `t-x${i}`, title: `Chiefs story number ${i} about the NFL`, related: [] }));
  const big = await post({ mode: 'enrich', items: many });
  assert.equal(aiCalls.length, 1);
  assert.equal(Object.keys(big.body.items).length, T.ENRICH_BATCH, 'six per call');

  // Cache expires after its TTL.
  assert.ok(T.cachedEnrichment('t-x0'));
  assert.equal(T.cachedEnrichment('t-x0', Date.now() + T.ENRICH_TTL_MS + 1000), null, 'expired after the TTL (6 h)');

  // Gates: hourly → free rules, no call; weekly → 429 with free rules.
  T.reset();
  await getTrends(false);
  aiCalls = [];
  hourlyCount = 500;
  const hourly = await post({ mode: 'enrich', items: [{ id: nfl[0].id }] });
  assert.equal(hourly.status, 200);
  assert.equal(hourly.body.limited, 'hourly');
  assert.equal(hourly.body.items[nfl[0].id].ai, false);
  assert.equal(aiCalls.length, 0, 'no AI over the hourly limit');
  hourlyCount = 0;
  weeklyUsd = 25;
  const weekly = await post({ mode: 'enrich', items: [{ id: nfl[0].id }] });
  assert.equal(weekly.status, 429);
  assert.equal(weekly.body.reason, 'weekly-limit');
  assert.ok(Array.isArray(weekly.body.items[nfl[0].id].titles), 'rule-based ideas still returned');
  assert.equal(aiCalls.length, 0, 'no AI over the weekly limit');
  weeklyUsd = 0;

  // A bad AI reply falls back to rule-based ideas, and is not cached.
  aiReply = () => ({ choices: [{ message: { content: 'not json' }, finish_reason: 'stop' }], usage: {} });
  const bad = await post({ mode: 'enrich', items: [{ id: nfl[0].id }] });
  assert.equal(bad.status, 200);
  assert.equal(bad.body.ai, false);
  assert.equal(T.cachedEnrichment(nfl[0].id), null, 'failures are not cached');

  // parseEnrichment ignores unknown ids and over-long headlines.
  const parsed = T.parseEnrichment('{"items":[{"id":"t-a","why":"Why fans care: big game","titles":["Short one here","This headline is far far far too long to fit in the pill at all"]},{"id":"t-zzz","why":"x","titles":["a b"]}]}', ['t-a']);
  assert.deepEqual(Object.keys(parsed), ['t-a']);
  assert.equal(parsed['t-a'].why, 'big game');
  assert.deepEqual(parsed['t-a'].titles, ['Short one here']);
}

console.log(`trend-design: ${cases.length + 4} classifier cases, parsing, freshness, dedupe, ranking, cache and AI enrichment passed`);
