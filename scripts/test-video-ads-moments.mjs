#!/usr/bin/env node
// Video Ads "By moment" = the last 5 days' trending clips (video-ads-moments.js,
// moments-with-clips in netlify/functions/video-ads.js), plus the clip rules
// that apply to every list: 720p floor, game action only (_clip-classify.js),
// the AI verdict stored per clip, and the prefetch's engagement + classify
// passes. Every network call is mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const M = require(path.resolve('video-ads-moments.js'));
const now = Date.now();
const hAgo = h => new Date(now - h * 3600e3).toISOString();
const VID = (id, w = 1280, h = 720) => [{ url: `https://video.twimg.com/amplify_video/${id}/vid/avc1/${w}x${h}/a.mp4`, width: w, height: h, bitrate: 1 }];
const clip = (id, o = {}) => ({ url: `https://x.com/${o.handle || 'NFL'}/status/${id}`, handle: 'NFL', sport: 'nfl', teams: [], text: `Clip ${id} highlight`, postedAt: hAgo(o.ageH ?? 3), variants: VID(id), sourceKind: 'league', durationMs: 20000, views: 0, likes: 0, ...o });

// ── 1. Velocity and ranking ──────────────────────────────────────────────
assert.equal(M.velocityOf(clip(1, { views: 10000, ageH: 10 }), now), 1000, 'views per hour');
assert.equal(M.velocityOf(clip(1, { likes: 100, ageH: 5 }), now), 500, 'likes count ~25 views each when no view count');
assert.equal(M.velocityOf(clip(1, { views: 600, ageH: 0.1 }), now), 600, 'at least one hour');
assert.equal(M.velocityOf(clip(1, { views: 10000, ageH: 10, checkedAt: hAgo(5) }), now), 2000, 'measured when the numbers were read');
assert.equal(M.velocityOf(clip(1), now), 0);
// A fast, viral play beats a fresher quiet one; a quiet clip beats nothing.
let built = M.buildMoments([
  clip(10, { text: 'Quiet fresh highlight', ageH: 1, views: 50 }),
  clip(11, { text: 'Viral one-handed catch in the end zone', ageH: 20, views: 3000000 }),
  clip(12, { text: 'Steady interception return', ageH: 4, views: 40000 }),
], { now });
assert.deepEqual(built.moments.map(m => m.clips[0].url.split('/').pop()), ['11', '12', '10'], 'trending = velocity + reach + recency');
assert.equal(built.thin, false);
assert.ok(built.moments[0].score > built.moments[1].score);
// Sorts.
assert.deepEqual(M.sortMoments(built.moments, 'newest').map(m => m.clips[0].url.split('/').pop()), ['10', '12', '11']);
assert.deepEqual(M.sortMoments(built.moments, 'views').map(m => m.clips[0].url.split('/').pop()), ['11', '12', '10']);
// Official source and quality count when engagement is equal.
const a = M.trendScore({ velocity: 100, engagement: 1000, ageHours: 5, best: clip(1, { sourceKind: 'official', variants: VID(1, 1920, 1080) }) });
const b = M.trendScore({ velocity: 100, engagement: 1000, ageHours: 5, best: clip(1, { sourceKind: 'fan', variants: VID(1, 1280, 720) }) });
assert.ok(a > b, 'official + 1080p rank above a fan 720p copy');

// ── 2. Clustering ────────────────────────────────────────────────────────
const td1 = clip(20, { handle: 'NFL', text: 'Patrick Mahomes finds Travis Kelce for the go-ahead touchdown! 📺: CBS', teams: ['Kansas City Chiefs'], ageH: 3, views: 900000, sourceKind: 'league' });
const td2 = clip(21, { handle: 'Chiefs', text: 'MAHOMES TO KELCE. GO-AHEAD TOUCHDOWN. #ChiefsKingdom', teams: ['Kansas City Chiefs'], ageH: 3.3, views: 300000, sourceKind: 'official', variants: VID(21, 1920, 1080) });
const td3 = clip(22, { handle: 'NFLonCBS', text: 'Mahomes ➡️ Kelce go-ahead score', teams: ['Kansas City Chiefs'], ageH: 3.1, views: 120000, sourceKind: 'media' });
const repost = clip(23, { handle: 'fan', text: 'wow', variants: VID(20), sourceKind: 'fan', ageH: 2 }); // same media id as td1
const otherGame = clip(24, { handle: 'Lions', text: 'Jahmyr Gibbs breaks loose for a 70-yard touchdown', teams: ['Detroit Lions'], ageH: 3 });
const sameWordsDayLater = clip(25, { handle: 'Chiefs', text: 'Mahomes finds Kelce again in practice', teams: ['Kansas City Chiefs'], ageH: 30 });
const otherTeam = clip(26, { handle: 'Bills', text: 'Mahomes Kelce go-ahead touchdown reaction from Buffalo', teams: ['Buffalo Bills'], ageH: 3 });
const groups = M.clusterClips([td1, td2, td3, repost, otherGame, sameWordsDayLater, otherTeam]);
const groupOf = c => groups.find(g => g.includes(c));
assert.equal(groupOf(td1).length, 4, 'the same TD from @NFL, the team, a network and a re-post of the media is one moment');
assert.ok(groupOf(td1).includes(td2) && groupOf(td1).includes(td3) && groupOf(td1).includes(repost));
assert.equal(groupOf(otherGame).length, 1, 'another play stays apart');
assert.equal(groupOf(sameWordsDayLater).length, 1, 'same words a day later is not the same play');
assert.equal(groupOf(otherTeam).length, 1, 'different teams are never merged');
built = M.buildMoments([td1, td2, td3, repost, otherGame], { now });
const tdMoment = built.moments.find(m => m.clips.length === 4);
assert.equal(tdMoment.angles, 3, '+3 angles');
assert.equal(tdMoment.clips[0].handle, 'Chiefs', 'best version first: official 1080p');
assert.equal(tdMoment.views, 900000 + 300000 + 120000);
assert.ok(built.moments[0] === tdMoment, 'the most-posted, most-viewed play ranks first');

// ── 3. Titles ────────────────────────────────────────────────────────────
assert.equal(M.cleanTitle('Patrick Mahomes finds Travis Kelce for the go-ahead touchdown! 📺: CBS').title, 'Patrick Mahomes finds Travis Kelce for the go-ahead touchdown!');
assert.equal(M.cleanTitle('@NFL WATCH: 🚨 BIJAN ROBINSON 81-YARD TOUCHDOWN 🚨 #RiseUp #Falcons https://t.co/x').title, 'Bijan Robinson 81-yard Touchdown', 'caps calmed, emoji, handles, hashtags and links gone');
assert.equal(M.cleanTitle('Mahomes ➡️ Kelce').title, 'Mahomes to Kelce');
assert.equal(M.cleanTitle('What a grab by #Packers rookie (via @PackersFan)').title, 'What a grab by Packers rookie');
assert.equal(M.cleanTitle('🔥🔥🔥 #NFL').empty, true, 'nothing usable');
const long = M.cleanTitle('Shohei Ohtani crushes a 450-foot home run to center in the bottom of the ninth inning to send the Dodgers to the World Series again');
assert.ok(long.title.length <= 73 && long.cut, 'long text is cut at a word boundary and flagged for an AI title');
assert.equal(M.fallbackTitle({ teams: ['Kansas City Chiefs'], sport: 'nfl' }), 'Chiefs highlight', 'no text: team name, no invented facts');
// Grounding: names and numbers must come from the post.
const src = 'Shohei Ohtani crushes a 450-foot home run to send the Dodgers to the World Series';
assert.equal(M.groundedTitle('Ohtani crushes 450-foot homer for Dodgers', src), 'Ohtani crushes 450-foot homer for Dodgers');
assert.equal(M.groundedTitle('Ohtani hits 3 home runs', src), '', 'a number not in the post');
assert.equal(M.groundedTitle('Judge and Ohtani homer', src), '', 'a name not in the post');
assert.equal(M.groundedTitle('Insane Ohtani home run', src), '', 'hype words');
assert.equal(M.groundedTitle('x', src), '');

// ── 4. Filters, facets, hand-off ─────────────────────────────────────────
const pool = [
  { sport: 'nfl', teams: ['Kansas City Chiefs'] }, // red, gold
  { sport: 'nfl', teams: ['Green Bay Packers'] }, // green, gold
  { sport: 'mlb', teams: ['Los Angeles Dodgers'] }, // blue
  { sport: 'cfb', teams: ['Alabama Crimson Tide'] },
];
assert.equal(M.filterMoments(pool, { sport: 'nfl' }).length, 2);
assert.equal(M.filterMoments(pool, { team: 'Green Bay Packers' }).length, 1, 'team filter');
assert.deepEqual(M.filterMoments(pool, { color: 'gold' }).map(m => m.teams[0]), ['Kansas City Chiefs', 'Green Bay Packers'], 'colour filter uses team colour families');
assert.equal(M.filterMoments(pool, { sport: 'mlb', color: 'gold' }).length, 0);
const facets = M.momentFacets(pool);
assert.equal(facets.teams.length, 4);
assert.ok(facets.colors.find(c => c.id === 'gold').count === 2);
assert.deepEqual(M.handoffFilter({ sport: 'nfl', title: 'Chiefs stun Bills in overtime' }), { sport: 'nfl', team: 'Kansas City Chiefs', color: '', title: 'Chiefs stun Bills in overtime' }, 'hand-off: the team the story names first');
assert.equal(M.handoffFilter({ sport: 'mlb', title: 'Something', team: 'Dodgers' }).team, 'Los Angeles Dodgers', 'a named team wins');
assert.equal(M.handoffFilter({ sport: 'golf', title: 'x' }), null);
assert.equal(M.handoffFilter({ sport: 'cfb', title: 'Coaching carousel news' }).team, '');

// ── 5. Never empty / thin ────────────────────────────────────────────────
built = M.buildMoments([clip(30, { ageH: 5 }), clip(31, { ageH: 1, text: 'Another play highlight' })], { now });
assert.equal(built.thin, true, 'no engagement numbers: rank by newest');
assert.equal(built.moments[0].clips[0].url.endsWith('31'), true);
assert.deepEqual(M.buildMoments([], { now }).moments, []);
assert.equal(M.engagementLabel({ views: 12400 }), '12k views');
assert.equal(M.engagementLabel({ likes: 900 }), '900 likes');
assert.equal(M.engagementLabel({}), '');

// ═══ Server: classification, 720p, AI titles, prefetch ═══════════════════
const fnDir = path.resolve('netlify/functions');
const authPath = path.join(fnDir, '_supabase-auth.js');
const trendsPath = path.join(fnDir, 'trend-design.js');
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => 'application/json' } });
let weeklySpend = 0;
let chatHandler = () => { throw new Error('unexpected light-model call'); };
let messagesHandler = () => { throw new Error('unexpected Claude call'); };
const chatCalls = [];
const messageCalls = [];
let fx = {};
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, 0);
  if (href.includes('/rest/v1/frameup_ai_usage')) return reply(201, {});
  if (href.includes('/rest/v1/rpc/frameup_my_ai_spend')) return reply(200, [{ total_usd: weeklySpend }]);
  if (href.includes('/rest/v1/')) return reply(404, { code: 'PGRST205', message: 'not installed' });
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/chat/completions')) { const b = JSON.parse(options.body); chatCalls.push(b); return chatHandler(b); }
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) { const b = JSON.parse(options.body); messageCalls.push(b); return messagesHandler(b); }
  if (href.startsWith('https://api.fxtwitter.com/')) {
    const id = href.match(/status\/(\d+)/)?.[1];
    return fx[id] ? reply(200, fx[id]) : reply(404, {});
  }
  if (href.startsWith('https://cdn.syndication.twimg.com/')) return reply(404, {});
  throw new Error(`unexpected fetch ${href}`);
};
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: () => 'tok',
  verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }),
} };
require.cache[trendsPath] = { id: trendsPath, filename: trendsPath, loaded: true, exports: { getTrends: async () => ({ updatedAt: new Date().toISOString(), items: [] }) } };
process.env.AI_GATEWAY_API_KEY = 'gw-test';
process.env.CLIPS_EXTRA_SOURCES = 'off';
delete process.env.CLIPS_LIBRARY;
delete process.env.X_BEARER_TOKEN;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const ads = require(path.join(fnDir, 'video-ads.js'));
const LIB = require(path.join(fnDir, '_clip-library.js'));
const CL = require(path.join(fnDir, '_clip-classify.js'));
const T = ads._test;
const post = body => ads.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) }).then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));

// ── 6. The rules (AI off) ────────────────────────────────────────────────
assert.equal(LIB.CLIP_MIN_SHORT_SIDE, 720);
assert.equal(CL.heuristic({ text: 'Full press conference with the head coach', sourceKind: 'official', durationMs: 30000 }).isGameAction, false, 'presser');
assert.equal(CL.heuristic({ text: 'New episode of the podcast is live', sourceKind: 'media', durationMs: 40000 }).isGameAction, false, 'podcast');
assert.equal(CL.heuristic({ text: 'Schedule release graphic', sourceKind: 'official', durationMs: 20000 }).isGameAction, false, 'promo');
assert.equal(CL.heuristic({ text: 'WALK-OFF GRAND SLAM', sourceKind: 'fan', durationMs: 25000 }).isGameAction, true, 'keywords');
assert.equal(CL.heuristic({ text: 'Big moment', sourceKind: 'league', durationMs: 25000 }).isGameAction, true, 'a league account, 6-90 s');
assert.equal(CL.heuristic({ text: 'Big moment', sourceKind: 'league', durationMs: 200000 }).isGameAction, false, 'too long and no keyword');
assert.equal(CL.heuristic({ text: 'lol', sourceKind: 'fan', durationMs: 20000 }).isGameAction, false, 'a fan clip needs game words');
assert.equal(CL.verdictOf({ text: 'Presser', ai: { isGameAction: true, quality: 4, by: 'ai' } }).isGameAction, true, 'a stored AI verdict wins over the rules');
assert.equal(CL.thumbFor({ thumb: 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/a.jpg' }), 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/a.jpg?name=small');
// 720p floor in the library too (an older 480p row never comes back).
LIB._test.reset();
await LIB.write([
  { clip: { url: 'https://x.com/NFL/status/701', handle: 'NFL', text: 'Touchdown catch', postedAt: hAgo(2), durationMs: 20000, variants: VID(701, 854, 480), sourceKind: 'league' }, sport: 'nfl', teams: [] },
  { clip: { url: 'https://x.com/NFL/status/702', handle: 'NFL', text: 'Touchdown catch', postedAt: hAgo(2), durationMs: 20000, variants: VID(702), sourceKind: 'league' }, sport: 'nfl', teams: [] },
]);
assert.deepEqual((await LIB.read({ sport: 'nfl' })).map(c => c.url), ['https://x.com/NFL/status/702'], '480p rows are not read');

// ── 7. classifyClips: batches, budget cap, stored verdicts ───────────────
messagesHandler = body => {
  const n = body.messages[0].content.filter(c => c.type === 'text' && /^\d+\./.test(c.text)).length;
  assert.ok(body.messages[0].content.some(c => c.type === 'image'), 'the thumbnail is sent');
  return reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 9000, output_tokens: 400 }, content: [{ type: 'text', text: JSON.stringify({ clips: Array.from({ length: n }, (_, k) => ({ i: k + 1, isGameAction: k % 2 === 0, quality: 4, subject: ['Chiefs'], label: k % 2 ? 'press conference' : 'touchdown catch' })) }) }] });
};
const many = Array.from({ length: 20 }, (_, i) => ({ url: `https://x.com/NFL/status/${800 + i}`, handle: 'NFL', text: `Play ${i}`, thumb: `https://pbs.twimg.com/${i}.jpg`, durationMs: 20000 }));
let cr = await CL.classifyClips(many, { maxUsd: 0.006 });
assert.equal(cr.calls, 2, 'the budget allows two batches of 8');
assert.equal(cr.verdicts.size, 16);
assert.equal(cr.skipped, 4, 'the rest waits for the next run');
assert.ok(cr.cost > 0 && cr.cost < 0.006, `cost ${cr.cost}`);
assert.equal(cr.verdicts.get(many[1].url).isGameAction, false);
assert.equal(cr.verdicts.get(many[0].url).by, 'ai');
cr = await CL.classifyClips(many.slice(0, 8), { maxUsd: 1 });
assert.equal(cr.calls, 0, 'cached forever per URL: no second call');
process.env.AI_DISABLE = 'clips-classify';
cr = await CL.classifyClips([{ url: 'https://x.com/a/status/1', text: 'x' }], { maxUsd: 1 });
assert.equal(cr.calls, 0, 'AI_DISABLE=clips-classify');
delete process.env.AI_DISABLE;
// A bad image: the batch is retried once as text only.
let tries = 0;
messagesHandler = body => {
  tries += 1;
  if (body.messages[0].content.some(c => c.type === 'image')) return reply(400, { error: { message: 'could not fetch image' } });
  return reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 500, output_tokens: 50 }, content: [{ type: 'text', text: '{"clips":[{"i":1,"isGameAction":true,"quality":5,"subject":[],"label":"home run"}]}' }] });
};
cr = await CL.classifyClips([{ url: 'https://x.com/a/status/2', text: 'Homer', thumb: 'https://pbs.twimg.com/b.jpg' }], { maxUsd: 1 });
assert.equal(tries, 2);
assert.equal(cr.verdicts.get('https://x.com/a/status/2').quality, 5);
// Library: verdicts kept in memory before the migration (no `ai` column).
LIB._test.reset();
await LIB.write([{ clip: { url: 'https://x.com/NFL/status/900', handle: 'NFL', text: 'Touchdown', postedAt: hAgo(2), durationMs: 20000, variants: VID(900), sourceKind: 'league' }, sport: 'nfl', teams: [] }]);
await LIB.setAi(new Map([['https://x.com/NFL/status/900', { isGameAction: false, quality: 1, subject: [], label: 'press conference', by: 'ai' }]]));
const stored = (await LIB.read({ sport: 'nfl' }))[0];
assert.equal(stored.ai.isGameAction, false, 'the verdict comes back with the row');
assert.equal((await T.libraryClips({ sport: 'nfl' })).fresh.length, 0, 'an AI "not game action" clip is hidden from every list');

// ── 8. moments-with-clips: AI titles (light tier, grounded, cached, capped) ──
LIB._test.reset();
T.MOMENT_CACHE.clear();
T.MOMENT_TITLE_CACHE.clear();
const longText = id => (id === 0
  ? 'Shohei Ohtani crushes a 450-foot home run to center in the bottom of the ninth inning and the Dodgers walk it off again'
  : 'Aaron Judge launches a 430-foot home run into the second deck in the eighth inning and the Yankees take the lead again');
await LIB.write(Array.from({ length: 14 }, (_, i) => ({
  clip: { url: `https://x.com/MLB/status/${600 + i}`, handle: 'MLB', text: i < 2 ? longText(i) : `Team ${i} walk-off home run highlight number ${i} for the night`, postedAt: hAgo(2 + i), durationMs: 20000, variants: VID(600 + i), sourceKind: 'league', views: 1000 * (i + 1) },
  sport: 'mlb', teams: [],
})));
chatHandler = body => {
  assert.equal(body.model, 'openai/gpt-oss-20b', 'the light tier');
  const lines = body.messages.at(-1).content.split('\n').filter(l => /^\d+\. /.test(l));
  const titles = lines.map((l, k) => ({ i: k + 1, title: /Ohtani/.test(l) ? 'Ohtani walks it off with 450-foot homer' : 'Judge hits 3 homers' }));
  return reply(200, { choices: [{ message: { content: JSON.stringify({ titles }) } }], usage: { prompt_tokens: 900, completion_tokens: 60 } });
};
let res = await post({ mode: 'moments-with-clips', sport: 'mlb' });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(res.body.strategy, 'library');
assert.equal(chatCalls.length, 1, 'one light-tier call titles the batch');
assert.ok(res.body.cost <= 0.005, `title cost ${res.body.cost}`);
const titled = res.body.moments.filter(m => m.titleBy === 'ai');
assert.equal(titled.length, 1, 'the grounded title is kept; one with invented facts is dropped');
assert.equal(titled[0].title, 'Ohtani walks it off with 450-foot homer');
assert.ok(res.body.moments.some(m => m.titleBy === 'post' && m.title.endsWith('…')), 'the rejected one keeps its cleaned post text');
assert.ok(!('sourceText' in res.body.moments[0]), 'raw post text is not sent twice');
T.MOMENT_CACHE.clear();
res = await post({ mode: 'moments-with-clips', sport: 'mlb' });
assert.equal(chatCalls.length, 1, 'titles cached 6 h');
assert.equal(res.body.moments.filter(m => m.titleBy === 'ai').length, 1);
// Over the weekly limit: no title call, cleaned post text instead.
T.MOMENT_CACHE.clear();
T.MOMENT_TITLE_CACHE.clear();
weeklySpend = 999;
res = await post({ mode: 'moments-with-clips', sport: 'mlb' });
assert.equal(res.status, 200, 'the library still answers');
assert.equal(chatCalls.length, 1, 'the spend gate stops the title call');
assert.equal(res.body.moments.filter(m => m.titleBy === 'ai').length, 0);
weeklySpend = 0;

// ── 9. Prefetch: engagement refresh and the classify pass ─────────────────
const cron = require(path.join(fnDir, 'clips-prefetch.js'));
LIB._test.reset();
CL._test.MEMO.clear();
await LIB.write([1, 2, 3].map(i => ({ clip: { url: `https://x.com/NFL/status/${950 + i}`, handle: 'NFL', text: `Touchdown ${i}`, postedAt: hAgo(5), durationMs: 20000, variants: VID(950 + i), sourceKind: 'league', views: 10, thumb: `https://pbs.twimg.com/${i}.jpg` }, sport: 'nfl', teams: [] })));
LIB._test.memory.forEach(r => { r.last_checked = hAgo(4); });
fx = Object.fromEntries([1, 2, 3].map(i => [String(950 + i), { code: 200, tweet: { text: `Touchdown ${i}`, created_timestamp: Math.floor((now - 5 * 3600e3) / 1000), views: 50000 * i, likes: 100, author: { screen_name: 'NFL' }, media: { videos: [{ url: VID(950 + i)[0].url, formats: [{ url: VID(950 + i)[0].url, container: 'mp4' }] }] } } }]));
const eng = await cron._test.refreshEngagement({ now });
assert.equal(eng.updated, 3);
const fresh = await LIB.read({ sport: 'nfl' });
assert.equal(fresh.find(c => c.url.endsWith('953')).views, 150000, 'views refreshed for ranking');
assert.ok(new Date(fresh[0].checkedAt).getTime() > now - 60e3, 'checkedAt stamped');
messagesHandler = body => {
  const n = body.messages[0].content.filter(c => c.type === 'text' && /^\d+\./.test(c.text)).length;
  return reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 4000, output_tokens: 200 }, content: [{ type: 'text', text: JSON.stringify({ clips: Array.from({ length: n }, (_, k) => ({ i: k + 1, isGameAction: true, quality: 4, subject: [], label: 'touchdown' })) }) }] });
};
const cls = await cron._test.classifyPass({ capUsd: 0.3, runId: 't' });
assert.equal(cls.candidates, 3);
assert.equal(cls.classified, 3);
assert.ok(cls.cost > 0 && cls.cost < 0.01);
assert.equal((await LIB.read({ sport: 'nfl' }))[0].ai.quality, 4, 'verdict stored on the row');
assert.equal((await cron._test.classifyPass({ capUsd: 0.3, runId: 't' })).candidates, 0, 'never classified twice');
assert.equal((await cron._test.classifyPass({ capUsd: 0, runId: 't' })).off, true, 'no budget left today: off');
assert.equal(cron._test.settings({}).classifyUsd, 0.3, 'classification cap defaults to $0.30/day');
assert.equal(cron._test.settings({ CLIPS_CLASSIFY_MAX_USD: '0.5' }).classifyUsd, 0.5);

console.log('Video Ads moments tests passed.');
