#!/usr/bin/env node
// Video Ads server (netlify/functions/video-ads.js), every network call mocked:
// trends (last 48h, NFL/CFB/MLB only), clip lookup from an X post (fxtwitter
// first, syndication fallback, only video.twimg.com MP4s), auth.
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
let messagesHandler = null;
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, callsThisHour);
  if (href.includes('/rest/v1/frameup_ai_usage')) return reply(201, {});
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) return messagesHandler(JSON.parse(options.body));
  if (href.startsWith('https://api.fxtwitter.com/')) return fxReply ? reply(200, fxReply) : reply(404, {});
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
    return { updatedAt: hoursAgo(0), items: [
      { id: 'a', category: 'nfl', title: 'Mahomes rallies the Chiefs', publishedAt: hoursAgo(5), related: [] },
      { id: 'b', category: 'mlb', title: 'Skubal hits free agency', publishedAt: hoursAgo(30), related: [] },
      { id: 'c', category: 'cfb', title: 'Old CFB story', publishedAt: hoursAgo(80), related: [] },
      { id: 'd', category: 'golf', title: 'A golf story', publishedAt: hoursAgo(2), related: [] },
    ] };
  },
} };
process.env.AI_GATEWAY_API_KEY = 'gw-test';
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

// 6. Research: Claude with web search; facts, links, and which X posts carry
//    downloadable video. Search fees are part of the cost.
const usage = { input_tokens: 4000, output_tokens: 700, server_tool_use: { web_search_requests: 2 } };
const researchJson = {
  summary: 'Tarik Skubal became a free agent on Nov 3.',
  keyFacts: [{ fact: 'Skubal won the 2025 AL Cy Young.', sourceUrl: 'https://www.mlb.com/news/skubal' }],
  whyFansCare: 'Every contender wants him.',
  angles: ['Hot stove moves fast'],
  xPosts: ['https://x.com/MLB/status/1111', 'https://example.com/not-x'],
  youtube: ['https://www.youtube.com/watch?v=abc123', 'https://vimeo.com/1'],
  searchPhrases: ['Skubal free agency'],
};
messagesHandler = body => {
  assert.equal(body.model, 'anthropic/claude-haiku-5.5');
  assert.equal(body.tools?.[0]?.type, 'web_search_20250305', 'research uses the web search tool');
  assert.equal(body.tools[0].max_uses, 4);
  return reply(200, { stop_reason: 'end_turn', usage, content: [
    { type: 'web_search_tool_result', content: [{ url: 'https://x.com/Tigers/status/2222', title: 'Tigers' }] },
    { type: 'text', text: JSON.stringify(researchJson) },
  ] });
};
fxReply = { code: 200, tweet: { text: 'Skubal', author: { name: 'MLB', screen_name: 'MLB' }, media: { videos: [{ url: VIDEO(720, 1280), formats: [{ url: VIDEO(720, 1280), container: 'mp4' }] }] } } };
const trend = { id: 't1', title: 'Skubal hits free agency', sport: 'mlb', url: 'https://www.mlb.com/news/skubal', related: [] };
res = await post({ mode: 'research', trend });
assert.equal(res.status, 200);
assert.equal(res.body.webSearch, true);
assert.equal(res.body.keyFacts[0].sourceUrl, 'https://www.mlb.com/news/skubal');
assert.deepEqual(res.body.xPosts, ['https://x.com/MLB/status/1111', 'https://x.com/Tigers/status/2222'], 'only X post links, incl. cited ones');
assert.deepEqual(res.body.youtube, ['https://www.youtube.com/watch?v=abc123']);
assert.equal(res.body.verifiedClips.length, 2, 'both X posts have downloadable video');
assert.ok(res.body.cost > 0.02 && res.body.cost < 0.03, `cost includes 2 searches (${res.body.cost})`);
res = await post({ mode: 'research', trend });
assert.equal(res.body.cached, true, 'the same moment is served from cache for 30 minutes');
assert.equal(res.body.cost, 0);

// 7. Web search unavailable: plain answer from the trend, marked as such.
messagesHandler = body => (body.tools ? reply(400, { error: { message: 'tools not supported' } })
  : reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 300 }, content: [{ type: 'text', text: JSON.stringify({ summary: 'Mahomes led a comeback.', keyFacts: [], angles: [] }) }] }));
res = await post({ mode: 'research', trend: { title: 'Mahomes comeback against the Bills', sport: 'nfl' } });
assert.equal(res.status, 200);
assert.equal(res.body.webSearch, false);
assert.equal(res.body.verifiedClips.length, 0);

// 8. Copy: an invented number and a highlight not in the headline are caught,
//    the AI gets one retry with the problems, good variants come back.
let copyCalls = 0;
messagesHandler = body => {
  copyCalls += 1;
  assert.ok(String(body.system?.[0]?.text || body.system).includes('newsletter sign-up video ads'), 'copy rules in the (cached) system prompt');
  const variants = copyCalls === 1 ? [
    { style: 'simple', headline: 'The offseason moves fast.', body: ['Join 250,000 fans who read ES Dugout.'], cta: 'SIGN UP ES DUGOUT' },
    { style: 'highlight', headline: 'Skubal is a free agent. Keep up, free.', highlight: 'Never miss a move', body: ['One email a morning.'] },
  ] : [
    { style: 'simple', headline: 'The offseason moves fast.', body: ['Skubal is a free agent and every contender is calling. ES Dugout keeps you up to speed, free.'] },
    { style: 'highlight', headline: 'Skubal is a free agent. Keep up, free.', highlight: 'Keep up, free.', body: ['One email a morning.'] },
    { style: 'condensed', headline: 'Never miss a move this winter.', body: ['Every MLB story that matters, in one free email.'] },
  ];
  return reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 1500, output_tokens: 500 }, content: [{ type: 'text', text: JSON.stringify({ variants }) }] });
};
res = await post({ mode: 'copy', brandId: 'es-dugout', trend, research: researchJson });
assert.equal(res.status, 200);
assert.equal(copyCalls, 2, 'one retry after the checks failed');
assert.equal(res.body.variants.length, 3);
assert.deepEqual(res.body.variants.map(v => v.style), ['simple', 'highlight', 'condensed']);
assert.equal(res.body.variants[1].highlight, 'Keep up, free.');
assert.equal(res.body.variants[0].cta, 'SIGN UP ES DUGOUT', 'the brand default button when none is given');
assert.ok(res.body.variants.every(v => !/250/.test(JSON.stringify(v))), 'invented subscriber count never returned');

// 9. Chat: a valid change comes back as a patch; an invalid one is refused with a note.
messagesHandler = () => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 800, output_tokens: 200 }, content: [{ type: 'text', text: JSON.stringify({ reply: 'Made it punchier.', patch: { headline: 'Never miss a move.' } }) }] });
const layout = { style: 'condensed', headline: 'The offseason moves fast.', highlight: '', body: ['One free email.'], cta: 'SIGN UP ES DUGOUT' };
res = await post({ mode: 'chat', brandId: 'es-dugout', trend, research: researchJson, layout, messages: [{ role: 'user', content: 'Make the headline punchier' }] });
assert.equal(res.status, 200);
assert.deepEqual(res.body.patch, { headline: 'Never miss a move.' });
messagesHandler = () => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 800, output_tokens: 200 }, content: [{ type: 'text', text: JSON.stringify({ reply: 'Added a stat.', patch: { headline: 'Skubal threw 99 mph.' } }) }] });
res = await post({ mode: 'chat', brandId: 'es-dugout', trend, research: researchJson, layout, messages: [{ role: 'user', content: 'Add a stat' }] });
assert.equal(res.body.patch, undefined);
assert.match(res.body.reply, /couldn't apply that change: the number 99/);

// 10. Over the hourly AI limit: 429 before any AI call.
callsThisHour = 500;
messagesHandler = () => { throw new Error('no AI call over the limit'); };
res = await post({ mode: 'copy', brandId: 'es-dugout', trend });
assert.equal(res.status, 429);
callsThisHour = 0;

console.log('Video Ads server tests passed.');
