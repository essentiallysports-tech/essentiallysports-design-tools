#!/usr/bin/env node
// Video Ads server (netlify/functions/video-ads.js), every network call mocked:
// trends (last 48h, NFL/CFB/MLB only), clip lookup from an X post (fxtwitter
// first, syndication fallback, only video.twimg.com MP4s), auth, the team-colour
// data (video-ads-teams.js), find-clips (cheap web search, verification, cache,
// cost cap, 401/429), copy (lessons, auto-fix, retry), chat, grammar (light
// model, exact-substring / number / brand checks, cache, 401/429), research removed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const adsPath = path.join(fnDir, 'video-ads.js');
const authPath = path.join(fnDir, '_supabase-auth.js');
const trendsPath = path.join(fnDir, 'trend-design.js');

const hoursAgo = h => new Date(Date.now() - h * 3600e3).toISOString();
let signedIn = true;
let fxReply = null;
let synReply = null;
let callsThisHour = 0;
let weeklySpend = 0;
let trendItems = null;
let messagesHandler = null;
let chatHandler = () => { throw new Error('unexpected light-model call'); };
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, callsThisHour);
  if (href.includes('/rest/v1/frameup_ai_usage')) return reply(201, {});
  if (href.includes('/rest/v1/rpc/frameup_my_ai_spend')) return reply(200, [{ total_usd: weeklySpend }]);
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) return messagesHandler(JSON.parse(options.body));
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/chat/completions')) return chatHandler(JSON.parse(options.body));
  if (href.startsWith('https://api.fxtwitter.com/')) {
    const body = typeof fxReply === 'function' ? fxReply(href) : fxReply;
    return body ? reply(200, body) : reply(404, {});
  }
  if (href.startsWith('https://cdn.syndication.twimg.com/')) return synReply ? reply(200, synReply) : reply(404, {});
  if (href.startsWith('https://video.twimg.com/')) throw new Error('the server must never download video bytes');
  throw new Error(`unexpected fetch ${href}`);
};

[adsPath, authPath, trendsPath].forEach(p => delete require.cache[p]);
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: () => 'tok',
  verifyEsUser: async () => (signedIn ? { ok: true, user: { email: 'a@essentiallysports.com' } } : { ok: false, statusCode: 401, error: 'Authentication required.' }),
} };
let trendWindow = '';
require.cache[trendsPath] = { id: trendsPath, filename: trendsPath, loaded: true, exports: {
  getTrends: async (force, options) => {
    trendWindow = options?.window;
    if (trendItems) return { updatedAt: hoursAgo(0), items: trendItems };
    return { updatedAt: hoursAgo(0), items: [
      { id: 'a', category: 'nfl', title: 'Mahomes rallies the Chiefs', publishedAt: hoursAgo(5), related: [] },
      { id: 'b', category: 'mlb', title: 'Skubal hits free agency', publishedAt: hoursAgo(30), related: [] },
      { id: 'c', category: 'cfb', title: 'Old CFB story', publishedAt: hoursAgo(80), related: [] },
      { id: 'd', category: 'golf', title: 'A golf story', publishedAt: hoursAgo(2), related: [] },
    ] };
  },
} };
process.env.AI_GATEWAY_API_KEY = 'gw-test';
// The shared clip library and the extra sources have their own tests
// (test-clip-library.mjs); off here so these keep testing the live search alone.
process.env.CLIPS_LIBRARY = 'off';
process.env.CLIPS_EXTRA_SOURCES = 'off';
const gwPath = path.join(fnDir, '_ai-gateway.js');
delete require.cache[gwPath];
const { handler } = require(adsPath);
const post = body => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) })
  .then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));

// 1. Trends: the 2-day window, ad sports only, nothing older than 48 hours.
let res = await post({ mode: 'trends' });
assert.equal(res.status, 200);
assert.equal(trendWindow, '2d');
assert.deepEqual(res.body.items.map(item => item.id), ['a', 'b']);
assert.equal(res.body.items[0].sport, 'nfl');

// 2. Clip from fxtwitter: MP4s on video.twimg.com only, largest first.
const VIDEO = (w, h) => `https://video.twimg.com/amplify_video/1/vid/avc1/${w}x${h}/clip.mp4`;
// A video with its own X media id (the same id = the same video re-posted).
const VIDEOM = (id, w, h) => `https://video.twimg.com/amplify_video/${id}/vid/avc1/${w}x${h}/clip.mp4`;
fxReply = { code: 200, tweet: { text: 'What a catch', author: { name: 'MLB', screen_name: 'MLB' }, media: { videos: [{
  url: VIDEO(1080, 1920), thumbnail_url: 'https://pbs.twimg.com/thumb.jpg', duration: 21.5, width: 1080, height: 1920,
  formats: [
    { url: VIDEO(320, 568), container: 'mp4', bitrate: 632000 },
    { url: VIDEO(720, 1280), container: 'mp4', bitrate: 2176000 },
    { url: 'https://video.twimg.com/amplify_video/1/pl/playlist.m3u8', container: 'm3u8' },
    { url: 'https://evil.example/clip.mp4', container: 'mp4' },
  ],
}] } } };
res = await post({ mode: 'clip', url: 'https://twitter.com/MLB/status/1234567890?s=20' });
assert.equal(res.status, 200);
assert.equal(res.body.url, 'https://x.com/MLB/status/1234567890');
assert.deepEqual(res.body.variants.map(v => `${v.width}x${v.height}`), ['1080x1920', '720x1280', '320x568']);
assert.ok(res.body.variants.every(v => v.url.startsWith('https://video.twimg.com/')));
assert.equal(res.body.handle, 'MLB');
assert.equal(res.body.durationMs, 21500);

// 3. fxtwitter has nothing: X's syndication feed is used.
fxReply = null;
synReply = { text: 'Walk-off!', user: { name: 'MLB', screen_name: 'MLB' }, mediaDetails: [{ media_url_https: 'https://pbs.twimg.com/t.jpg', video_info: { duration_millis: 9000, variants: [
  { content_type: 'video/mp4', bitrate: 950000, url: VIDEO(480, 852) },
  { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/x/pl/list.m3u8' },
] } }] };
res = await post({ mode: 'clip', url: 'https://x.com/MLB/status/987' });
assert.equal(res.status, 200);
assert.deepEqual(res.body.variants.map(v => v.height), [852]);
assert.equal(res.body.durationMs, 9000);

// 4. A post with no video, a non-X link and a non-post link are refused clearly.
synReply = { text: 'just text', user: {}, mediaDetails: [] };
res = await post({ mode: 'clip', url: 'https://x.com/MLB/status/555' });
assert.equal(res.status, 404);
assert.match(res.body.error, /no downloadable video/);
res = await post({ mode: 'clip', url: 'https://www.youtube.com/watch?v=abc' });
assert.equal(res.status, 400);
res = await post({ mode: 'clip', url: 'https://x.com/MLB' });
assert.equal(res.status, 400);

// 5. Signed out: refused; unknown modes: refused.
signedIn = false;
assert.equal((await post({ mode: 'trends' })).status, 401);
signedIn = true;
assert.equal((await post({ mode: 'publish-everything' })).status, 400);

// 6. Team colours: every NFL and MLB team, ~40+ CFB programs, valid data,
//    primary-family teams first, max 12.
const TEAMS = require(path.resolve('video-ads-teams.js'));
const BRANDS_FOR_TEST = require(path.resolve('video-ads-brands.js'));
const STYLES_FOR_TEST = require(path.resolve('video-ads-styles.js'));
const count = sport => TEAMS.TEAMS.filter(t => t.sport === sport).length;
assert.equal(count('nfl'), 32);
assert.equal(count('mlb'), 30);
assert.ok(count('cfb') >= 40, `CFB programs: ${count('cfb')}`);
const colorIds = TEAMS.COLORS.map(c => c.id);
assert.deepEqual(colorIds, ['red', 'blue', 'green', 'gold', 'orange', 'purple', 'navy', 'maroon', 'black', 'silver', 'teal']);
TEAMS.COLORS.forEach(c => assert.match(c.hex, /^#[0-9A-F]{6}$/));
const names = new Set();
TEAMS.TEAMS.forEach(t => {
  assert.ok(!names.has(`${t.sport}|${t.name}`), `duplicate ${t.name}`);
  names.add(`${t.sport}|${t.name}`);
  assert.equal(t.colors.length, 2, t.name);
  t.colors.forEach(hex => assert.match(hex, /^#[0-9A-F]{6}$/, t.name));
  assert.ok(t.families.length >= 1 && t.families.every(f => colorIds.includes(f)), `${t.name} families`);
  // Every team has a hot-linked ESPN logo (https, the sport's logo path).
  const logoPath = { nfl: 'nfl', mlb: 'mlb', cfb: 'ncaa' }[t.sport];
  assert.match(t.logo, new RegExp(`^https://a\\.espncdn\\.com/i/teamlogos/${logoPath}/500/[a-z0-9]+\\.png$`), `${t.name} logo`);
  assert.equal(TEAMS.logoFor(t), t.logo);
});
assert.equal(new Set(TEAMS.TEAMS.map(t => t.logo)).size, TEAMS.TEAMS.length, 'one logo per team');
assert.equal(TEAMS.logoFor(null), '');
assert.equal(TEAMS.findTeam('Alabama', 'cfb').logo, 'https://a.espncdn.com/i/teamlogos/ncaa/500/333.png');
assert.equal(TEAMS.findTeam('Yankees', 'mlb').logo, 'https://a.espncdn.com/i/teamlogos/mlb/500/nyy.png');
assert.equal(TEAMS.findTeam('Chiefs', 'nfl').logo, 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png');
const chiefs = TEAMS.TEAMS.find(t => t.name === 'Kansas City Chiefs');
assert.deepEqual(chiefs.colors, ['#E31837', '#FFB81C']);
assert.deepEqual(chiefs.families, ['red', 'gold']);
const redNfl = TEAMS.teamsFor({ sport: 'nfl', color: 'red' });
assert.ok(redNfl.length > 3 && redNfl.length <= 12 && redNfl.every(t => t.sport === 'nfl'));
const firstSecondary = redNfl.findIndex(t => t.families[0] !== 'red');
assert.ok(firstSecondary > 0 && redNfl.slice(firstSecondary).every(t => t.families[0] !== 'red'), 'primary-red teams come first');
assert.ok(redNfl.some(t => t.short === 'Bills'), 'secondary red teams follow');
assert.deepEqual(TEAMS.teamsFor({ sport: 'nfl', color: 'purple' }).map(t => t.short), ['Ravens', 'Vikings']);
assert.ok(TEAMS.teamsFor({ sport: 'cfb', color: 'purple' }).some(t => t.short === 'LSU'));
assert.ok(TEAMS.teamsFor({ sport: 'mlb', color: 'red' }).length <= 12);
assert.deepEqual(TEAMS.teamsFor({ sport: 'nfl', color: 'pink' }), []);
assert.equal(TEAMS.findTeam('chiefs', 'nfl').name, 'Kansas City Chiefs');

// 7. Find clips by colour: one x.com-only web search (Haiku, 4 searches max,
//    aimed at verified handles), candidates verified like `clip`, old posts
//    and posts without video dropped, ranked best first, diag counts.
const { _test } = require(adsPath);
let searchCalls = 0;
let searchPrompt = '';
const tid = id => `https://x.com/NFL/status/${id}`;
const clipUsage = { input_tokens: 6000, output_tokens: 300, server_tool_use: { web_search_requests: 2 } };
messagesHandler = body => {
  searchCalls += 1;
  searchPrompt = body.messages[0].content;
  assert.equal(body.model, 'anthropic/claude-haiku-5.5', 'cheapest Claude model for search');
  assert.equal(body.tools?.[0]?.type, 'web_search_20250305');
  assert.equal(body.tools[0].max_uses, 4, 'at most 4 searches');
  assert.deepEqual(body.tools[0].allowed_domains, ['x.com', 'twitter.com'], 'search limited to X');
  assert.ok(body.max_tokens <= 1700, 'short reply');
  return reply(200, { stop_reason: 'end_turn', usage: clipUsage, content: [
    { type: 'web_search_tool_result', content: [{ url: 'https://twitter.com/Chiefs/status/301', title: 'Chiefs' }, { url: 'https://www.espn.com/nfl/story', title: 'ESPN' }] },
    { type: 'text', text: JSON.stringify({ posts: [tid(101), { url: tid(102), date: 'today' }, tid(103), tid(104), { url: tid(105), date: '2026-11-17' }, tid(106), 'https://example.com/not-x', tid(101)] }) },
  ] });
};
const nowSec = Math.floor(Date.now() / 1000);
fxReply = href => {
  const id = href.match(/status\/(\d+)/)[1];
  if (id === '102') return { code: 200, tweet: { text: 'No video here', author: { screen_name: 'NFL' }, media: {} } };
  // 103: 20 days old; 104: 121h old; 105: no timestamp (the model's date is not trusted); 106: throwback; 301: 5h old.
  const created = { 103: nowSec - 20 * 86400, 104: nowSec - 121 * 3600, 105: undefined, 301: nowSec - 5 * 3600 }[id];
  const text = id === '106' ? '#TBT to the 2019 AFC title game' : `Clip ${id}`;
  return { code: 200, tweet: { text, created_timestamp: id in { 103: 1, 104: 1, 105: 1, 301: 1 } ? created : nowSec - 3600, author: { name: 'NFL', screen_name: id === '301' ? 'Chiefs' : 'NFL' }, media: { videos: [{
    url: VIDEOM(id, 720, 1280), thumbnail_url: `https://pbs.twimg.com/${id}.jpg`, duration: 12.3, width: 720, height: 1280,
    formats: [{ url: VIDEOM(id, 720, 1280), container: 'mp4', bitrate: 2176000 }, { url: VIDEOM(id, 320, 568), container: 'mp4', bitrate: 632000 }, { url: 'https://evil.example/x.mp4', container: 'mp4' }],
  }] } } };
};
synReply = null;
res = await post({ mode: 'find-clips', sport: 'nfl', color: 'red' });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(searchCalls, 1);
assert.ok(res.body.teams.length > 3 && res.body.teams[0].name && res.body.teams[0].short && res.body.teams[0].colors.length === 2);
assert.equal(res.body.teams[0].families, undefined, 'teams carry name, short, colors');
assert.match(searchPrompt, /Kansas City Chiefs/, 'the colour teams are in the prompt');
assert.match(searchPrompt, /last 5 days/);
assert.match(searchPrompt, /@Chiefs/, 'the colour teams\' official handles are targeted');
assert.match(searchPrompt, /@NFL\b/, 'league accounts are targeted');
assert.match(searchPrompt, /x\.com\/AZCardinals OR x\.com\/AtlantaFalcons OR x\.com\/Chiefs status video/, 'focused per-handle queries');
assert.match(searchPrompt, /up to 25/, 'asks for 25 candidates');
assert.deepEqual(res.body.clips.map(c => c.url), ['https://x.com/Chiefs/status/301', tid(101)], 'no-video, 20-day-old, 121h-old, untimestamped and throwback posts dropped; duplicates merged; cited posts kept; the official team account ranks first');
assert.deepEqual(res.body.clips.map(c => c.ageHours), [5, 1], 'verified age in hours');
assert.deepEqual(res.body.clips.map(c => c.source), ['official', 'league']);
assert.deepEqual(res.body.clips.map(c => c.quality), ['720p', '720p']);
assert.ok(res.body.clips[0].score > res.body.clips[1].score, 'sorted by score');
assert.equal(res.body.strategy, 'web');
assert.deepEqual(
  (({ searched, listed, nonPost, candidates, noVideo, tooOld, noDate, throwback, kept }) => ({ searched, listed, nonPost, candidates, noVideo, tooOld, noDate, throwback, kept }))(res.body.diag),
  { searched: 2, listed: 9, nonPost: 2, candidates: 7, noVideo: 1, tooOld: 2, noDate: 1, throwback: 1, kept: 2 },
  'diag says where every candidate went');
assert.ok(res.body.clips.every(c => c.postedAt && !Number.isNaN(Date.parse(c.postedAt))));
assert.equal(res.body.note, 'Only 2 clips from the last 5 days.', 'fewer than 3 fresh clips: a note, no padding');
const clip0 = res.body.clips[1];
assert.equal(clip0.handle, 'NFL');
assert.equal(clip0.thumb, 'https://pbs.twimg.com/101.jpg');
assert.equal(clip0.duration, 12.3);
assert.deepEqual(clip0.variants.map(v => v.height), [1280, 568]);
assert.ok(clip0.variants.every(v => v.url.startsWith('https://video.twimg.com/') && v.bitrate >= 0));
assert.equal(res.body.cached, false);
assert.ok(res.body.cost > 0.02 && res.body.cost <= _test.FIND_CLIPS.maxCostUsd, `cost within the cap (${res.body.cost})`);

// 8. Cache: the same (strategy, sport, colour, query) for 30 minutes, free, and served even
//    over the hourly limit; a different colour searches again.
callsThisHour = 500;
res = await post({ mode: 'find-clips', sport: 'nfl', color: 'red' });
assert.equal(res.status, 200);
assert.equal(res.body.cached, true);
assert.equal(res.body.cost, 0);
assert.equal(searchCalls, 1, 'no new search');
assert.equal(res.body.clips.length, 2);
// 429 over the hourly limit on a cache miss, before any AI call.
res = await post({ mode: 'find-clips', sport: 'nfl', color: 'green' });
assert.equal(res.status, 429);
assert.equal(searchCalls, 1);
callsThisHour = 0;
// Expired cache entries search again.
for (const entry of _test.CLIP_CACHE.values()) entry.at -= 29 * 60 * 1000;
res = await post({ mode: 'find-clips', sport: 'nfl', color: 'red' });
assert.equal(res.body.cached, true, 'still cached at 29 minutes');
for (const entry of _test.CLIP_CACHE.values()) entry.at -= 2 * 60 * 1000; // 30-minute TTL
res = await post({ mode: 'find-clips', sport: 'nfl', color: 'red' });
assert.equal(res.body.cached, false);
assert.equal(searchCalls, 2);

// 9. Find clips by moment (query), the hard cost cap (a paused search is not
//    continued once the cap or the 4 searches are used), 401, bad input, AI off.
let pauseCalls = 0;
messagesHandler = body => {
  pauseCalls += 1;
  searchPrompt = body.messages[0].content;
  return reply(200, { stop_reason: 'pause_turn', usage: { input_tokens: 9000, output_tokens: 200, server_tool_use: { web_search_requests: 4 } }, content: [
    { type: 'web_search_tool_result', content: [{ url: tid(101), title: 'NFL' }] },
  ] });
};
res = await post({ mode: 'find-clips', sport: 'nfl', query: 'Mahomes rallies the Chiefs' });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(pauseCalls, 1, 'paused search not continued past the cap');
assert.match(searchPrompt, /Mahomes rallies the Chiefs/);
assert.deepEqual(res.body.teams, []);
assert.deepEqual(res.body.clips.map(c => c.url), [tid(101)], 'cited posts are used when the reply has no text');
assert.ok(res.body.cost <= _test.FIND_CLIPS.maxCostUsd);
assert.equal((await post({ mode: 'find-clips', sport: 'nba', color: 'red' })).status, 400);
assert.equal((await post({ mode: 'find-clips', sport: 'nfl' })).status, 400, 'a colour or a query is required');
res = await post({ mode: 'find-clips', sport: 'cfb', color: 'teal' });
if (TEAMS.teamsFor({ sport: 'cfb', color: 'teal' }).length === 0) {
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.clips, []);
  assert.equal(pauseCalls, 1, 'no teams in that colour: no search');
}
signedIn = false;
assert.equal((await post({ mode: 'find-clips', sport: 'nfl', color: 'red' })).status, 401);
signedIn = true;
messagesHandler = () => reply(500, { error: { message: 'search down' } });
res = await post({ mode: 'find-clips', sport: 'mlb', color: 'blue' });
assert.equal(res.status, 502);
assert.match(res.body.error, /Clip search is unavailable/);
messagesHandler = () => reply(402, { error: { message: 'spend limit reached' } });
res = await post({ mode: 'find-clips', sport: 'mlb', color: 'orange' });
assert.equal(res.status, 503);
assert.equal(res.body.reason, 'budget');
delete process.env.AI_GATEWAY_API_KEY;
res = await post({ mode: 'find-clips', sport: 'mlb', color: 'green' });
assert.equal(res.status, 503);
assert.equal(res.body.reason, 'off');
res = await post({ mode: 'find-clips', sport: 'nfl', color: 'red' });
assert.equal(res.status, 200, 'cached results still served while AI is off');
process.env.AI_GATEWAY_API_KEY = 'gw-test';

// 9b. Find clips for ONE team: team beats colour and query, resolved by
//     findTeam, cached per (sport, team); unknown teams refused; freshness helpers.
let teamPrompt = '';
let teamCalls = 0;
messagesHandler = body => {
  teamCalls += 1;
  teamPrompt = body.messages[0].content;
  return reply(200, { stop_reason: 'end_turn', usage: clipUsage, content: [{ type: 'text', text: JSON.stringify({ posts: [{ url: tid(101), date: '2026-11-17' }, tid(201), tid(202)] }) }] });
};
res = await post({ mode: 'find-clips', sport: 'nfl', team: 'Chiefs', color: 'green', query: 'something else' });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.deepEqual(res.body.teams, [{ name: 'Kansas City Chiefs', short: 'Chiefs', colors: ['#E31837', '#FFB81C'] }]);
assert.match(teamPrompt, /Kansas City Chiefs \(only this team\)/);
assert.doesNotMatch(teamPrompt, /Green Bay|something else/, 'team takes precedence over colour and query');
assert.equal(res.body.clips.length, 3);
assert.deepEqual(res.body.widened, { to: ['league'] }, 'no Chiefs-account clips: the NFL-account clips are labelled as widened');
assert.equal(res.body.note, 'Fewer Chiefs clips this week — showing NFL accounts too.');
assert.ok(res.body.clips.every(c => c.via === 'league'));
assert.match(teamPrompt, /@Chiefs/, 'the team\'s official handle is targeted');
assert.ok(res.body.clips.every(c => typeof c.ageHours === 'number'));
res = await post({ mode: 'find-clips', sport: 'nfl', team: { name: 'Kansas City Chiefs' } });
assert.equal(res.body.cached, true, 'cached per (sport, team), by short or full name');
assert.equal(teamCalls, 1);
assert.ok([..._test.CLIP_CACHE.keys()].includes('web|nfl|team:kansas city chiefs'), 'the cache key includes the strategy and the team');
assert.equal(res.body.note, 'Fewer Chiefs clips this week — showing NFL accounts too.', 'the widened note survives the cache');
res = await post({ mode: 'find-clips', sport: 'nfl', color: 'red' });
assert.notDeepEqual(res.body.teams.length, 1, 'a colour search is cached separately from the team');
res = await post({ mode: 'find-clips', sport: 'nfl', team: 'Toronto Argonauts' });
assert.equal(res.status, 400);
assert.equal(teamCalls, 1);
assert.equal(_test.looksOld('#TBT to this catch'), true);
assert.equal(_test.looksOld('On this day: the Helmet Catch'), true);
assert.equal(_test.looksOld('Mahomes in the 2022 AFC title game', new Date('2026-11-17')), true);
assert.equal(_test.looksOld('What a catch in Week 11. He has 2,024 yards. Final: 20-17', new Date('2026-11-17')), false);
assert.equal(_test.looksOld('2026 is his year', new Date('2026-11-17')), false);
assert.equal(_test.ageHoursOf(''), null);
assert.equal(_test.ageHoursOf('not a date'), null);
assert.equal(_test.ageHoursOf(new Date(Date.now() + 5 * 3600e3).toISOString()), null, 'a future timestamp is not trusted');

// 10. Research was removed.
res = await post({ mode: 'research', trend: { title: 'Skubal hits free agency', sport: 'mlb' } });
assert.equal(res.status, 410);
assert.match(res.body.error, /Research was removed/);

// 11. Copy: no research needed; grounded in brand, sport, team, moment and
//     colour; lessons injected as shipped ads + rules; check failures recorded.
let lessonArgs = null;
const recorded = [];
_test.useLearning({
  lessonsFor: async args => {
    lessonArgs = args;
    return { examples: [{ style: 'condensed', headline: 'Every Chiefs win, explained.', body: ['One free email.'], cta: 'SIGN UP THE HUDDLE' }], rules: ['Keep headlines under 10 words.', 'Never use the word "dynasty".'] };
  },
  recordEvent: async args => { recorded.push(args); return true; },
});
let copyCalls = 0;
let copyAsk = '';
let copyVariants = [];
messagesHandler = body => {
  copyCalls += 1;
  copyAsk = body.messages[0].content;
  assert.ok(String(body.system?.[0]?.text || body.system).includes('newsletter sign-up video ads'), 'copy rules in the (cached) system prompt');
  assert.equal(body.tools, undefined, 'copy never searches');
  const variants = typeof copyVariants === 'function' ? copyVariants(copyCalls) : copyVariants;
  return reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 1500, output_tokens: 500 }, content: [{ type: 'text', text: JSON.stringify({ variants }) }] });
};
const longHeadline = 'The Chiefs are rolling in red and every Sunday brings a new reason to watch this team closely, all season long. Stay with us.';
copyVariants = [
  // Auto-fixed: hype word swapped, over-long headline trimmed, lowercase CTA.
  { style: 'condensed', headline: `An insane run. ${longHeadline}`, body: ['The Huddle brings you every NFL story that matters, free.'], cta: 'sign up the huddle' },
  // Auto-fixed: highlight not in the headline -> the closest headline phrase.
  { style: 'highlight', headline: 'RED SUNDAYS ARE BACK IN KANSAS CITY', highlight: 'red sundays are back', body: ['One free email. Every NFL moment.'] },
  // Auto-fixed: an invented subscriber count is dropped with its sentence; a "Click" paragraph is dropped.
  { style: 'simple', headline: 'Chiefs fans, this one is for you.', body: ['Join 250,000 fans who read The Huddle. It is free.', 'Click the link to join.'] },
];
res = await post({ mode: 'copy', brandId: 'the-huddle', sport: 'nfl', team: 'Chiefs', color: 'red', trend: { title: 'Mahomes rallies the Chiefs', sport: 'nfl' } });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(copyCalls, 1, 'auto-fix repaired everything: no retry');
assert.deepEqual(lessonArgs, { brandId: 'the-huddle', sport: 'nfl', token: 'tok' });
assert.match(copyAsk, /Ads we shipped/);
assert.match(copyAsk, /Every Chiefs win, explained/);
assert.match(copyAsk, /Keep headlines under 10 words/);
assert.match(copyAsk, /Kansas City Chiefs/, 'the team is grounded by its full name');
assert.match(copyAsk, /red teams/, 'the colour theme');
assert.match(copyAsk, /Mahomes rallies the Chiefs/);
assert.doesNotMatch(copyAsk, /What happened|Facts:/, 'no research block');
assert.equal(res.body.variants.length, 3);
// Variants come back best-first by the free rubric checks; find them by style.
const byStyle = st => res.body.variants.find(v => v.style === st);
const [v1, v2, v3] = [byStyle('condensed'), byStyle('highlight'), byStyle('simple')];
const passedOf = v => STYLES_FOR_TEST.copyChecks(v, BRANDS_FOR_TEST.byId('the-huddle')).passed;
res.body.variants.slice(1).forEach((v, i) => assert.ok(passedOf(res.body.variants[i]) >= passedOf(v), 'ranked by the rubric checks'));
assert.doesNotMatch(v1.headline, /insane/i);
assert.match(v1.headline, /^A wild run\./);
assert.ok(v1.headline.split(/\s+/).length <= 22);
assert.equal(v1.cta, 'SIGN UP THE HUDDLE');
assert.equal(v2.highlight, 'RED SUNDAYS ARE BACK', 'exact headline casing');
assert.ok(v2.headline.includes(v2.highlight));
assert.ok(!/250/.test(JSON.stringify(v3)), 'invented number never returned');
assert.deepEqual(v3.body, ['It is free.']);
const kinds = new Set(res.body.autoFixed.map(f => f.kind));
['banned', 'headline_length', 'cta', 'highlight', 'invented_number'].forEach(k => assert.ok(kinds.has(k), `autoFixed has ${k}`));
assert.ok(res.body.autoFixed.every(f => typeof f.note === 'string' && f.note));
assert.deepEqual(res.body.lessons, { examples: 1, rules: 2 });
assert.equal(recorded.length, 1, 'the fixes feed the learning loop');
assert.equal(recorded[0].event.type, 'check_failed');
assert.equal(recorded[0].event.brandId, 'the-huddle');
assert.equal(recorded[0].email, 'a@essentiallysports.com');

// 12. Copy: what can't be fixed in code (an invented number in a one-sentence
//     headline) goes back to the model once; a broken learning module never blocks.
_test.useLearning({ lessonsFor: async () => { throw new Error('db down'); }, recordEvent: async () => { throw new Error('db down'); } });
copyCalls = 0;
copyVariants = n => (n === 1 ? [
  { style: 'condensed', headline: 'Skubal threw 99 mph.', body: ['ES Dugout, free.'] },
  { style: 'simple', headline: 'Skubal is a free agent and 30 teams are calling.', body: ['One email a morning.'] },
] : [
  { style: 'condensed', headline: 'Never miss a move this winter.', body: ['Every MLB story that matters, in one free email.'] },
  { style: 'highlight', headline: 'Skubal is a free agent. Keep up, free.', highlight: 'Keep up, free.', body: ['One email a morning.'] },
]);
res = await post({ mode: 'copy', brandId: 'es-dugout', sport: 'mlb', trend: { title: 'Skubal hits free agency', sport: 'mlb' } });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(copyCalls, 2, 'one retry for problems code cannot fix');
assert.equal(res.body.variants.length, 2);
assert.equal(res.body.variants[0].cta, 'SIGN UP ES DUGOUT', 'the brand default button when none is given');
assert.deepEqual(res.body.lessons, { examples: 0, rules: 0 });

// Nothing passes after the retry: 422 with the issues.
copyCalls = 0;
copyVariants = [{ style: 'condensed', headline: 'Skubal threw 99 mph.', body: ['Free.'] }];
res = await post({ mode: 'copy', brandId: 'es-dugout', sport: 'mlb', trend: { title: 'Skubal hits free agency' } });
assert.equal(res.status, 422);
assert.equal(copyCalls, 2);
assert.match(res.body.issues.join(' '), /the number 99/);
// Nothing to ground the copy in: 400 before any AI call.
copyCalls = 0;
res = await post({ mode: 'copy', brandId: 'es-dugout' });
assert.equal(res.status, 400);
assert.equal(copyCalls, 0);
// The colour theme alone is enough to write from.
copyVariants = [{ style: 'simple', headline: 'Red teams, big moments.', body: ['The Huddle, free every morning.'] }, { style: 'condensed', headline: 'Bleed red every Sunday.', body: ['One free NFL email.'] }];
res = await post({ mode: 'copy', brandId: 'the-huddle', sport: 'nfl', color: 'red' });
assert.equal(res.status, 200);
_test.useLearning({});

// 12b. Copy for the no-footage styles: each style's fields, checked and
//      repaired in code; facts only from the brief; the style suggestion.
{
  const huddle = BRANDS_FOR_TEST.byId('the-huddle');
  const notes = 'Mahomes threw for 412 yards. The Chiefs rallied late.';
  const ctx = _test.copyContext({ brandId: 'the-huddle', sport: 'nfl', notes, trend: { title: 'Mahomes rallies the Chiefs', related: [{ title: 'Chiefs beat the Broncos in overtime' }, { title: 'Bears fire their offensive coordinator' }, { title: 'Lions clinch the NFC North' }] } });
  const facts = ctx.facts;
  assert.ok(facts.claims.length >= 2 && facts.headlines.length === 4 && facts.sources.includes(notes));
  // Today's 3: real stories only, 9 words max.
  let c = _test.checkVariant({ style: 'today3', listTitle: '3 things NFL fans need to know', items: ['Chiefs beat the Broncos in overtime', 'Bears fire their offensive coordinator', 'Lions clinch the NFC North'], offer: 'The stories that matter, in The Huddle. Free.' }, huddle, facts, 'today3');
  assert.deepEqual(c.errors, [], 'the title may say 3');
  c = _test.checkVariant({ style: 'today3', items: ['Chiefs beat the Broncos in overtime', 'Aliens land at Arrowhead stadium tonight', 'Lions clinch the NFC North'], offer: 'Free.' }, huddle, facts, 'today3');
  assert.match(c.errors.join(' '), /headline 2 is not one of the stories/);
  let fixed = _test.autoFix({ style: 'today3', items: ['Chiefs beat the Broncos in overtime in a game nobody will forget for years', 'Aliens land at Arrowhead stadium tonight'], offer: 'Free.' }, huddle, facts, 'today3');
  assert.deepEqual(fixed.raw.items, ['Chiefs beat the Broncos in overtime in a game'], 'cut to 9 words, the made-up story dropped');
  // Us vs Them: generic "them", approved claims only.
  c = _test.checkVariant({ style: 'versus', them: ['Endless hot takes', 'Rumours from ESPN'], us: ['Free to sign up', 'Read by 2 million fans'], offer: 'Switch to The Huddle. It’s free.' }, huddle, facts, 'versus');
  assert.match(c.errors.join(' '), /names someone/);
  assert.match(c.errors.join(' '), /not an approved claim/);
  fixed = _test.autoFix({ style: 'versus', them: ['Endless hot takes', 'Rumours from ESPN', 'Too many apps'], us: ['free to sign up', 'Read by 2 million fans'], offer: 'Switch to The Huddle. It’s free.' }, huddle, facts, 'versus');
  assert.deepEqual(fixed.raw.them, ['Endless hot takes', 'Too many apps']);
  assert.ok(fixed.raw.us.every(u => huddle.verifiedClaims.includes(u)) && fixed.raw.us.length >= 2, 'only approved claims, word for word');
  assert.deepEqual(_test.checkVariant(fixed.raw, huddle, facts, 'versus').errors, []);
  // Extras on a classic variant ride along only when they pass.
  c = _test.checkVariant({ style: 'condensed', headline: 'Mahomes threw for 412 yards.', body: ['The Huddle, free.'], items: ['Aliens land at Arrowhead stadium tonight', 'Bears fire their offensive coordinator'], them: ['Endless hot takes', 'Too many apps'], us: ['Free to sign up', 'Unsubscribe anytime'] }, huddle, facts, 'condensed');
  assert.deepEqual(c.errors, []);
  assert.deepEqual(c.variant.items, [], 'a bad extra is emptied, not an error');
  assert.deepEqual(c.variant.them, ['Endless hot takes', 'Too many apps'], 'a good extra rides along');
  // Removed styles: their fields are no longer read; a removed style is a classic one.
  c = _test.checkVariant({ style: 'stat', headline: 'Every Chiefs win, in one free email.', body: ['The Huddle, free.'], stat: '999', quote: 'made up words here' }, huddle, facts, '');
  assert.equal(c.variant.style, 'condensed', 'stat is not a style any more');
  assert.equal(c.variant.stat, undefined);
  assert.equal(c.variant.quote, undefined);
  // Skip: asked for a style without its facts.
  const bare = _test.copyContext({ brandId: 'the-huddle', notes: 'The Chiefs keep winning.' });
  const brief = STYLES_FOR_TEST.briefFacts({ notes: bare.notes, brand: bare.brand });
  assert.equal(_test.skipReason('stat', brief), null, 'removed styles never skip (they are not asked for)');
  assert.equal(_test.skipReason('today3', brief).skip, 'no headlines');
  assert.equal(_test.skipReason('versus', brief), null);

  // Through the endpoint: Today's 3 with no headlines skips before any AI call.
  _test.useLearning({ styleRankingFor: async () => [{ style: 'versus', score: 1, exports: 4 }] });
  copyCalls = 0;
  res = await post({ mode: 'copy', brandId: 'the-huddle', sport: 'nfl', style: 'today3', notes: 'The Chiefs keep winning.' });
  assert.equal(res.status, 422);
  assert.equal(res.body.reason, 'skip');
  assert.match(res.body.error, /Today’s 3 needs 3 real headlines/);
  assert.equal(copyCalls, 0);
  assert.equal(res.body.suggestion.style, 'highlight', 'placeholder claims are never suggested first');
  // A removed style asked for by an old page: treated as no style (3 classic variants).
  copyVariants = [
    { style: 'condensed', headline: 'Every Chiefs win, in one free email.', body: ['The Huddle, free every morning.'] },
    { style: 'highlight', headline: 'ONE FREE EMAIL FOR CHIEFS FANS', highlight: 'ONE FREE EMAIL', body: ['The Huddle has it.'] },
  ];
  res = await post({ mode: 'copy', brandId: 'the-huddle', sport: 'nfl', style: 'stat', notes, hasClip: false, trend: { title: 'Mahomes rallies the Chiefs', related: [{ title: 'Chiefs beat the Broncos in overtime' }] } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.doesNotMatch(copyAsk, /"stat" style|Stat Card|Quote Card/);
  assert.match(copyAsk, /Approved claims about The Huddle/);
  assert.match(copyAsk, /"bestStyle"/);
  // Daily set: one call asks for 3 angles in mixed styles.
  copyCalls = 0;
  res = await post({ mode: 'copy', brandId: 'the-huddle', sport: 'nfl', set: true, notes: 'A different brief for the set.', trend: { title: 'Mahomes rallies the Chiefs' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(copyCalls, 1);
  assert.match(copyAsk, /today's ad set: write 3 variants, each a clearly different angle/);
  assert.match(copyAsk, /at least two different styles/);
  // The same request again is free (10-minute cache), and skips the AI gates.
  callsThisHour = 500;
  res = await post({ mode: 'copy', brandId: 'the-huddle', sport: 'nfl', set: true, notes: 'A different brief for the set.', trend: { title: 'Mahomes rallies the Chiefs' } });
  callsThisHour = 0;
  assert.equal(res.status, 200);
  assert.equal(res.body.cached, true);
  assert.equal(res.body.cost, 0);
  assert.equal(copyCalls, 1, 'no second model call');
  // suggest-style: no model call, no AI gate.
  copyCalls = 0;
  delete process.env.AI_GATEWAY_API_KEY;
  res = await post({ mode: 'suggest-style', brandId: 'the-huddle', notes: 'Mahomes threw for 412 yards.' });
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  assert.equal(res.status, 200);
  assert.equal(copyCalls, 0);
  assert.ok(!res.body.suggestion.scores.some(x => x.style === 'stat' || x.style === 'quote'), 'removed styles are never suggested');
  _test.useLearning({});
}

// 13. Auto-fix helpers directly.
const huddle = require(path.resolve('video-ads-brands.js')).byId('the-huddle');
assert.equal(_test.trimToWords('One two three four five. Six seven eight nine ten eleven.', 6), 'One two three four five.');
assert.equal(_test.trimToWords('one two three four five six seven and the rest', 8), 'one two three four five six seven.');
assert.equal(_test.swapBanned('BREAKING: An insane catch!! #Chiefs'), 'A wild catch! Chiefs');
let fixed = _test.autoFix({ style: 'highlight', headline: 'The Chiefs are back in red', highlight: 'never miss a move', body: ['Free.'], cta: 'CLICK HERE TO SIGN UP' }, huddle, '', 'highlight');
assert.ok(fixed.raw.headline.includes(fixed.raw.highlight) && fixed.raw.highlight.length > 0);
assert.equal(fixed.raw.cta, huddle.cta, 'a banned CTA falls back to the brand button');
fixed = _test.autoFix({ style: 'simple', headline: 'Short.', body: Array.from({ length: 3 }, () => 'word '.repeat(40).trim() + '.') }, huddle, '', '');
assert.equal(_test.checkVariant(fixed.raw, huddle, '', '').errors.length, 0, 'over-long ads are cut to fit');
assert.ok(fixed.fixes.some(f => f.kind === 'total_length'));

// 14. Chat: a valid change comes back as a patch; an invalid one is refused with a note.
const trend = { id: 't1', title: 'Skubal hits free agency', sport: 'mlb', related: [] };
messagesHandler = () => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 800, output_tokens: 200 }, content: [{ type: 'text', text: JSON.stringify({ reply: 'Made it punchier.', patch: { headline: 'Never miss a move.' } }) }] });
const layout = { style: 'condensed', headline: 'The offseason moves fast.', highlight: '', body: ['One free email.'], cta: 'SIGN UP ES DUGOUT' };
res = await post({ mode: 'chat', brandId: 'es-dugout', trend, layout, messages: [{ role: 'user', content: 'Make the headline punchier' }] });
assert.equal(res.status, 200);
assert.deepEqual(res.body.patch, { headline: 'Never miss a move.' });
messagesHandler = () => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 800, output_tokens: 200 }, content: [{ type: 'text', text: JSON.stringify({ reply: 'Added a stat.', patch: { headline: 'Skubal threw 99 mph.' } }) }] });
res = await post({ mode: 'chat', brandId: 'es-dugout', trend, layout, messages: [{ role: 'user', content: 'Add a stat' }] });
assert.equal(res.body.patch, undefined);
assert.match(res.body.reply, /couldn't apply that change: the number 99/);

// 15. Over the hourly AI limit: 429 before any AI call.
callsThisHour = 500;
messagesHandler = () => { throw new Error('no AI call over the limit'); };
res = await post({ mode: 'copy', brandId: 'es-dugout', trend });
assert.equal(res.status, 429);
callsThisHour = 0;

// 16. Grammar: Haiku (the main tier, "Haiku only"), strict checks on every suggestion, a 10-minute cache.
let grammarCalls = 0;
let grammarReply = [];
let grammarRequest = null;
chatHandler = () => { throw new Error('grammar must not use the light (non-Claude) model'); };
messagesHandler = request => {
  grammarCalls += 1;
  grammarRequest = request;
  return reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 420, output_tokens: 180 }, content: [{ type: 'text', text: JSON.stringify({ issues: grammarReply }) }] });
};
const gCopy = { headline: 'Their back in the the playoffs', highlight: '', body: ['Get every story , free.', 'Skubal threw 99 pitches in ES Dugout'], cta: 'SIGN UP ES DUGOUT' };
grammarReply = [
  { field: 'headline', original: 'Their back', suggestion: "They're back", reason: 'Wrong word: they are' },
  { field: 'headline', original: 'the the', suggestion: 'the', reason: 'Repeated word' },
  { field: 'body', index: 0, original: 'story , free', suggestion: 'story, free', reason: 'No space before comma' },
  // Dropped: not an exact substring of the field.
  { field: 'headline', original: 'There back', suggestion: "They're back", reason: 'Wrong word' },
  // Dropped: changes a number.
  { field: 'body', index: 1, original: 'threw 99 pitches', suggestion: 'threw 98 pitches', reason: 'Typo' },
  // Dropped: changes a brand word.
  { field: 'body', index: 1, original: 'in ES Dugout', suggestion: 'in Es Dugout.', reason: 'Missing period' },
  // Dropped: identical, and lowercasing the ALL-CAPS button.
  { field: 'body', index: 0, original: 'free.', suggestion: 'free.', reason: 'Nothing' },
  { field: 'cta', original: 'SIGN UP', suggestion: 'Sign up', reason: 'Casing' },
];
res = await post({ mode: 'grammar', brandId: 'es-dugout', copy: gCopy });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(grammarCalls, 1);
assert.equal(grammarRequest.model, 'anthropic/claude-haiku-5.5', 'Haiku (main tier)');
assert.match(String(grammarRequest.system), /grammar, spelling and punctuation ONLY/);
assert.deepEqual(res.body.issues.map(i => i.original), ['Their back', 'the the', 'story , free']);
assert.equal(res.body.issues[2].index, 0);
assert.equal(res.body.dropped, 5);
assert.ok(res.body.cost > 0 && res.body.cost < 0.001, `a grammar check costs well under a tenth of a cent (${res.body.cost})`);
// Identical request: served from the cache, no AI call, no cost.
res = await post({ mode: 'grammar', brandId: 'es-dugout', copy: gCopy });
assert.equal(res.status, 200);
assert.equal(res.body.cached, true);
assert.equal(res.body.cost, 0);
assert.equal(grammarCalls, 1);
// Direct checks: substring and number drops.
assert.equal(_test.checkGrammarIssues([{ field: 'headline', original: 'missing', suggestion: 'x', reason: 'r' }], { headline: 'Hello', highlight: '', body: [], cta: '' }).issues.length, 0, 'original must be an exact substring');
assert.equal(_test.checkGrammarIssues([{ field: 'headline', original: 'won 3 games', suggestion: 'won three games', reason: 'r' }], { headline: 'They won 3 games', highlight: '', body: [], cta: '' }).issues.length, 0, 'a number change is dropped');
assert.equal(_test.checkGrammarIssues([{ field: 'body', index: 4, original: 'a', suggestion: 'an', reason: 'r' }], { headline: '', highlight: '', body: ['a'], cta: '' }).issues.length, 0, 'a body index out of range is dropped');
// Clean copy: an empty list.
grammarReply = [];
res = await post({ mode: 'grammar', brandId: 'es-dugout', copy: { headline: 'Never miss a move.', body: ['One free email.'], cta: 'SIGN UP ES DUGOUT' } });
assert.equal(res.status, 200);
assert.deepEqual(res.body.issues, []);
// Nothing to check: 400 before any AI call.
grammarCalls = 0;
res = await post({ mode: 'grammar', brandId: 'es-dugout', copy: { headline: '  ', body: [] } });
assert.equal(res.status, 400);
assert.equal(grammarCalls, 0);
// Signed out: 401.
signedIn = false;
assert.equal((await post({ mode: 'grammar', brandId: 'es-dugout', copy: { headline: 'Fresh copy here' } })).status, 401);
signedIn = true;
// Over the hourly limit on a cache miss: 429 before any AI call.
callsThisHour = 500;
res = await post({ mode: 'grammar', brandId: 'es-dugout', copy: { headline: 'Another new headline' } });
assert.equal(res.status, 429);
assert.equal(grammarCalls, 0);
callsThisHour = 0;
// AI off: 503.
delete process.env.AI_GATEWAY_API_KEY;
assert.equal((await post({ mode: 'grammar', brandId: 'es-dugout', copy: { headline: 'Yet another headline' } })).status, 503);
process.env.AI_GATEWAY_API_KEY = 'gw-test';

// 17. Moments with clips: one capped search for the top trending moments,
//     posts grouped by moment, verified with the 72h + throwback rules, only
//     moments with a clip returned, shared 15-minute cache, 401/429/503.
trendItems = [
  { id: 'm1', category: 'nfl', title: 'Mahomes rallies the Chiefs past the Bills', publishedAt: hoursAgo(3), related: [] },
  { id: 'm2', category: 'nfl', title: 'Old news nobody filmed', publishedAt: hoursAgo(4), related: [] },
  { id: 'm3', category: 'mlb', title: 'Skubal hits free agency', publishedAt: hoursAgo(6), related: [] },
  { id: 'm4', category: 'cfb', title: 'Ohio State routs Michigan', publishedAt: hoursAgo(7), related: [] },
  { id: 'm5', category: 'golf', title: 'A golf story', publishedAt: hoursAgo(2), related: [] },
  ...Array.from({ length: 12 }, (_, k) => ({ id: `x${k}`, category: 'nfl', title: `Filler NFL story ${k}`, publishedAt: hoursAgo(10), related: [] })),
];
const mid = id => `https://x.com/NFL/status/${id}`;
let momentCalls = 0;
let momentPrompt = '';
let momentBody = null;
messagesHandler = body => {
  momentCalls += 1;
  momentBody = body;
  momentPrompt = body.messages[0].content;
  return reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 15000, output_tokens: 600, server_tool_use: { web_search_requests: 3 } }, content: [{ type: 'text', text: JSON.stringify({ moments: [
    { i: 1, posts: [mid(901), mid(902), 'https://example.com/x', mid(903)] }, // fresh, 121h old, not X, throwback
    { i: 2, posts: [mid(904)] }, // no timestamp: dropped, so moment 2 is dropped
    { i: 3, posts: [mid(905), mid(901)] }, // fresh; 901 already counted for moment 1
    { i: 4, posts: [] },
    { i: 99, posts: [mid(906)] }, // no such moment
  ] }) }] });
};
fxReply = href => {
  const id = href.match(/status\/(\d+)/)[1];
  const created = { 901: nowSec - 2 * 3600, 902: nowSec - 121 * 3600, 903: nowSec - 3600, 904: undefined, 905: nowSec - 30 * 3600, 906: nowSec - 3600 }[id];
  const text = id === '903' ? 'On this day in 2019: what a throw' : `Clip ${id}`;
  return { code: 200, tweet: { text, created_timestamp: created, author: { screen_name: 'NFL' }, media: { videos: [{ url: VIDEOM(id, 720, 1280), formats: [{ url: VIDEOM(id, 720, 1280), container: 'mp4', bitrate: 2000000 }] }] } } };
};
res = await post({ mode: 'moments-with-clips', sport: 'all' });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(momentCalls, 1, 'one search for all moments');
assert.equal(momentBody.model, 'anthropic/claude-haiku-5.5');
assert.equal(momentBody.tools[0].max_uses, 3);
assert.deepEqual(momentBody.tools[0].allowed_domains, ['x.com', 'twitter.com']);
assert.match(momentPrompt, /team account @Chiefs/, 'the team named in a title is targeted by its handle');
assert.match(momentPrompt, /@NFL\b/, 'league accounts are targeted');
assert.match(momentPrompt, /1\. \[NFL\] Mahomes rallies the Chiefs past the Bills/);
assert.match(momentPrompt, /last 5 days/);
assert.doesNotMatch(momentPrompt, /golf/i, 'ad sports only');
assert.doesNotMatch(momentPrompt, /Filler NFL story 9/, 'top 10 moments only');
assert.equal(res.body.checked, 10);
assert.deepEqual(res.body.moments.map(m => m.id), ['m1', 'm3'], 'only moments with a fresh, verified clip');
assert.deepEqual(res.body.moments[0].clips.map(c => c.url), [mid(901)], '121h-old and throwback posts dropped');
assert.deepEqual(res.body.moments[1].clips.map(c => c.url), [mid(905)], 'a post counts for its first moment only');
assert.equal(res.body.moments[0].clips[0].ageHours, 2);
assert.equal(res.body.moments[0].clips[0].source, 'league');
assert.equal(res.body.moments[0].clips[0].quality, '720p');
assert.equal(res.body.diag.tooOld, 1);
assert.equal(res.body.diag.noDate, 1);
assert.equal(res.body.diag.throwback, 1);
assert.ok(res.body.moments[0].clips[0].postedAt && res.body.moments[0].clips[0].variants.length);
assert.equal(res.body.moments[0].team.name, 'Kansas City Chiefs', 'the team named in the title');
assert.equal(res.body.moments[1].team, undefined);
assert.equal(res.body.moments[0].sport, 'nfl');
assert.equal(res.body.moments[0].publishedAt, trendItems[0].publishedAt);
assert.equal(res.body.cached, false);
assert.ok(res.body.cost > 0.03 && res.body.cost < 0.04, `cost per refresh ${res.body.cost}`);

// Shared cache: another user, over the hourly limit, gets it free; a sport filter is its own entry.
callsThisHour = 500;
res = await post({ mode: 'moments-with-clips', sport: 'all' });
assert.equal(res.status, 200);
assert.equal(res.body.cached, true);
assert.equal(res.body.cost, 0);
assert.equal(momentCalls, 1);
res = await post({ mode: 'moments-with-clips', sport: 'mlb' });
assert.equal(res.status, 429, 'a cache miss is gated');
callsThisHour = 0;
// While cached, clips that cross 120h are dropped, and so is a moment left empty.
const momentEntry = [..._test.MOMENT_CACHE.values()][0];
momentEntry.value.moments[1].clips[0].postedAt = new Date(Date.now() - 125 * 3600e3).toISOString();
res = await post({ mode: 'moments-with-clips' });
assert.equal(res.body.cached, true, 'no sport = all');
assert.deepEqual(res.body.moments.map(m => m.id), ['m1']);
// A new set of trending moments is a new key; an expired entry searches again.
momentEntry.at -= 31 * 60 * 1000;
res = await post({ mode: 'moments-with-clips', sport: 'all' });
assert.equal(res.body.cached, false);
assert.equal(momentCalls, 2);

// Gates and failures: 401, weekly 429, AI off 503, search down 502, budget 503.
for (const entry of _test.MOMENT_CACHE.values()) entry.at -= 31 * 60 * 1000;
signedIn = false;
assert.equal((await post({ mode: 'moments-with-clips' })).status, 401);
signedIn = true;
weeklySpend = 999;
res = await post({ mode: 'moments-with-clips' });
assert.equal(res.status, 429);
assert.equal(res.body.reason, 'weekly-limit');
weeklySpend = 0;
delete process.env.AI_GATEWAY_API_KEY;
res = await post({ mode: 'moments-with-clips' });
assert.equal(res.status, 503);
assert.equal(res.body.ok, false);
process.env.AI_GATEWAY_API_KEY = 'gw-test';
messagesHandler = () => reply(500, { error: { message: 'search down' } });
res = await post({ mode: 'moments-with-clips' });
assert.equal(res.status, 502);
assert.equal(res.body.ok, false);
assert.match(res.body.error, /Couldn't check which moments have clips/);
messagesHandler = () => reply(402, { error: { message: 'spend limit reached' } });
res = await post({ mode: 'moments-with-clips' });
assert.equal(res.status, 503);
assert.equal(res.body.reason, 'budget');
// No trending moments: nothing searched.
trendItems = [];
momentCalls = 0;
messagesHandler = () => { momentCalls += 1; throw new Error('no search without moments'); };
res = await post({ mode: 'moments-with-clips' });
assert.equal(res.status, 200);
assert.deepEqual(res.body.moments, []);
assert.equal(momentCalls, 0);
trendItems = null;

console.log('Video Ads server tests passed.');
