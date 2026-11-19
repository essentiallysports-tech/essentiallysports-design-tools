#!/usr/bin/env node
// Video Ads clip search: verified-source registry (video-ads-sources.js),
// targeted query building, the quality filter (resolution, length), ranking
// (official first), de-duplication, widening a thin team search (league
// accounts, then the colour group) with its note, diag counts, the cost caps,
// and the optional X API path (X_BEARER_TOKEN) on / off / failing. Every
// network call is mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const adsPath = path.join(fnDir, 'video-ads.js');
const authPath = path.join(fnDir, '_supabase-auth.js');
const trendsPath = path.join(fnDir, 'trend-design.js');

const nowSec = Math.floor(Date.now() / 1000);
const VIDEOM = (id, w, h) => `https://video.twimg.com/amplify_video/${id}/vid/avc1/${w}x${h}/clip.mp4`;
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

// Posts by id: { handle, ageH, w, h, secs, media, views, likes, text, video }
let posts = {};
let messagesHandler = () => { throw new Error('unexpected AI call'); };
let xHandler = () => { throw new Error('unexpected X API call'); };
let callsThisHour = 0;
const aiCalls = [];
const xCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, callsThisHour);
  if (href.includes('/rest/v1/frameup_ai_usage')) return reply(201, {});
  if (href.includes('/rest/v1/rpc/frameup_my_ai_spend')) return reply(200, [{ total_usd: 0 }]);
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) {
    const body = JSON.parse(options.body);
    aiCalls.push(body);
    return messagesHandler(body);
  }
  if (href.startsWith('https://api.x.com/2/')) {
    xCalls.push({ href, auth: options.headers?.Authorization });
    return xHandler(new URL(href));
  }
  if (href.startsWith('https://api.fxtwitter.com/')) {
    const id = href.match(/status\/(\d+)/)?.[1];
    const p = posts[id];
    if (!p) return reply(404, {});
    const w = p.w ?? 1280;
    const h = p.h ?? 720;
    const media = p.media ?? id;
    return reply(200, { code: 200, tweet: {
      text: p.text ?? `Clip ${id} highlight`, created_timestamp: nowSec - Math.round((p.ageH ?? 2) * 3600),
      likes: p.likes ?? 0, views: p.views ?? 0,
      author: { name: p.handle, screen_name: p.handle, verification: { type: p.vtype ?? '' } },
      media: p.video === false ? {} : { videos: [{ url: VIDEOM(media, w, h), thumbnail_url: `https://pbs.twimg.com/${id}.jpg`, duration: p.secs ?? 15, width: w, height: h,
        formats: [{ url: VIDEOM(media, w, h), container: 'mp4', bitrate: 2176000 }] }] },
    } });
  }
  if (href.startsWith('https://cdn.syndication.twimg.com/')) return reply(404, {});
  if (href.startsWith('https://video.twimg.com/')) throw new Error('the server must never download video bytes');
  throw new Error(`unexpected fetch ${href}`);
};

[adsPath, authPath, trendsPath].forEach(p => delete require.cache[p]);
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: () => 'tok',
  verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }),
} };
require.cache[trendsPath] = { id: trendsPath, filename: trendsPath, loaded: true, exports: { getTrends: async () => ({ updatedAt: new Date().toISOString(), items: [] }) } };
process.env.AI_GATEWAY_API_KEY = 'gw-test';
// The shared clip library and the extra sources have their own tests
// (test-clip-library.mjs); off here so these keep testing the live search alone.
process.env.CLIPS_LIBRARY = 'off';
process.env.CLIPS_EXTRA_SOURCES = 'off';
delete process.env.X_BEARER_TOKEN;
delete require.cache[path.join(fnDir, '_ai-gateway.js')];
const { handler, _test } = require(adsPath);
const post = body => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) })
  .then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));
const url = (handle, id) => `https://x.com/${handle}/status/${id}`;
const searchReply = (list, searches = 4, input = 20000) => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: input, output_tokens: 800, server_tool_use: { web_search_requests: searches } }, content: [{ type: 'text', text: JSON.stringify({ posts: list }) }] });

// 1. Registry: every team has a verified handle; league / media per sport.
const TEAMS = require(path.resolve('video-ads-teams.js'));
const SOURCES = require(path.resolve('video-ads-sources.js'));
TEAMS.TEAMS.forEach(t => assert.match(SOURCES.handleFor(t), /^[A-Za-z0-9_]{2,15}$/, `${t.name} handle`));
assert.equal(Object.keys(SOURCES.TEAM_HANDLES).length, TEAMS.TEAMS.length, 'no handle for a team that is not in the list');
const lowerHandles = Object.values(SOURCES.TEAM_HANDLES).map(h => h.toLowerCase());
assert.equal(new Set(lowerHandles).size, lowerHandles.length, 'one handle per team');
assert.equal(SOURCES.handleFor('Kansas City Chiefs'), 'Chiefs');
assert.equal(SOURCES.handleFor({ name: 'Alabama Crimson Tide' }), 'AlabamaFTBL');
assert.equal(SOURCES.handleFor('Toronto Argonauts'), '');
assert.equal(SOURCES.classifyHandle('@chiefs', 'nfl'), 'official');
assert.equal(SOURCES.classifyHandle('NFL', 'nfl'), 'league');
assert.equal(SOURCES.classifyHandle('NFLonCBS', 'nfl'), 'media');
assert.equal(SOURCES.classifyHandle('SECNetwork', 'cfb'), 'league');
assert.equal(SOURCES.classifyHandle('NFL', 'mlb'), 'other', 'league lists are per sport');
assert.equal(SOURCES.classifyHandle('NFL'), 'league', 'no sport: every list');
assert.equal(SOURCES.classifyHandle('randomfan123', 'nfl'), 'other');
assert.equal(SOURCES.teamForHandle('Yankees'), 'New York Yankees');
['nfl', 'mlb', 'cfb'].forEach(s => { const src = SOURCES.sourcesFor(s); assert.ok(src.league.length && src.media.length, s); });
assert.equal(_test.SOURCES, SOURCES);

// 2. Query building targets the handles.
const chiefs = TEAMS.findTeam('Chiefs', 'nfl');
const plan = _test.searchPlan({ sport: 'nfl', team: chiefs });
assert.deepEqual(plan.official, ['Chiefs']);
assert.ok(plan.league.includes('NFL') && plan.media.includes('NFLonCBS'));
assert.equal(plan.queries[0], 'x.com/Chiefs status video');
assert.ok(plan.queries.some(q => q.includes('@NFL ')), 'a league-account query');
const prompt = _test.webPrompt(plan, { since: '2026-11-12 00:00' });
assert.match(prompt, /- team: @Chiefs/);
assert.match(prompt, /- league: @NFL, @nflnetwork/);
assert.match(prompt, /up to 25/);
const moment = _test.searchPlan({ sport: 'mlb', query: 'Yankees walk-off in the Bronx' });
assert.deepEqual(moment.official, ['Yankees'], 'a team named in a moment is targeted');
assert.ok(moment.terms.includes('Yankees'));
const xq = _test.xQueryFor(plan);
assert.match(xq, /^\(\(from:Chiefs\) OR \(\(from:NFL OR from:nflnetwork/);
assert.match(xq, /\(Chiefs OR "Kansas City Chiefs"\)\)\) has:videos -is:retweet -is:reply$/);
assert.doesNotMatch(xq, /from:espn\b/, 'catch-all ESPN accounts left out of X queries');
const big = _test.xQueryFor(_test.searchPlan({ sport: 'cfb', teams: TEAMS.teamsFor({ sport: 'cfb', color: 'red' }) }));
assert.ok(big.length <= 512, `X query within 512 chars (${big.length})`);

// 3. Quality filter, ranking, dedupe (pure).
const base = { ok: true, url: url('Chiefs', 1), handle: 'Chiefs', text: 'TD', postedAt: new Date(Date.now() - 2 * 3600e3).toISOString(), durationMs: 15000 };
const v = (w, h, id = 1) => [{ url: VIDEOM(id, w, h), width: w, height: h, bitrate: 1 }];
assert.equal(_test.assessClip({ ...base, variants: v(640, 360) }, { sport: 'nfl' }).reason, 'lowQuality', '360p dropped');
assert.equal(_test.assessClip({ ...base, variants: v(1280, 720), durationMs: 2000 }, { sport: 'nfl' }).reason, 'badLength', 'under 4 s dropped');
assert.equal(_test.assessClip({ ...base, variants: v(1280, 720), durationMs: 200000 }, { sport: 'nfl' }).reason, 'badLength', 'over 120 s dropped');
assert.equal(_test.assessClip({ ok: false, reason: 'no-video' }).reason, 'noVideo');
assert.equal(_test.assessClip({ ok: false, reason: 'timeout' }).reason, 'failed');
const good = _test.assessClip({ ...base, variants: v(1080, 1920) }, { sport: 'nfl' }).clip;
assert.equal(good.quality, '1080p', 'quality is the short side');
assert.equal(good.source, 'official');
assert.equal(_test.assessClip({ ...base, variants: v(1280, 720) }).clip.quality, '720p');
assert.equal(_test.assessClip({ ...base, variants: v(854, 480) }).reason, 'lowQuality', '480p dropped (720p floor)');
assert.equal(_test.FIND_CLIPS.minShortSide, 720, 'one shared 720p floor');
assert.equal(_test.assessClip({ ...base, variants: [{ url: 'https://video.twimg.com/x/clip.mp4', width: 0, height: 0, bitrate: 0 }] }).reason, 'lowQuality', 'unknown size dropped: it cannot prove 720p');
assert.equal(_test.assessClip({ ...base, text: 'Full press conference with the head coach', variants: v(1280, 720) }, { sport: 'nfl' }).reason, 'notGame', 'a presser is not game action');
// Trusted sources only (owner, 2026-11-19): a viral fan post is dropped, whatever its views.
assert.equal(_test.assessClip({ ...base, url: url('fan', 2), handle: 'fan', views: 5e6, variants: v(1080, 1920, 2) }, { sport: 'nfl' }).reason, 'untrusted', 'a fan post is never a result');
const net = _test.assessClip({ ...base, url: url('NFLonCBS', 3), handle: 'NFLonCBS', variants: v(1280, 720, 3) }, { sport: 'nfl' }).clip;
const leagueClip = _test.assessClip({ ...base, url: url('NFL', 5), handle: 'NFL', variants: v(1280, 720, 5) }, { sport: 'nfl' }).clip;
assert.deepEqual(_test.rankClips([net, leagueClip, good]).map(c => c.handle), ['Chiefs', 'NFL', 'NFLonCBS'], 'official, then league, then network');
assert.equal(good.trust.label, '@Chiefs · team account', 'each clip says who posted it');
assert.equal(net.trust.label, '@NFLonCBS · network');
assert.equal(leagueClip.trust.label, '@NFL · league account');
const repost = _test.assessClip({ ...base, url: url('NFLonFOX', 4), handle: 'NFLonFOX', variants: v(1080, 1920, 1) }, { sport: 'nfl' }).clip;
const diag = { dupes: 0 };
const deduped = _test.rankClips([repost, good], diag);
assert.deepEqual(deduped.map(c => c.url), [good.url], 'the same video re-posted: the official copy is kept');
assert.equal(diag.dupes, 1);

// 4. A strong team search: official clips first, quality filter, diag, no widening.
posts = {
  11: { handle: 'Chiefs', ageH: 3, w: 1080, h: 1920 },
  12: { handle: 'Chiefs', ageH: 10, w: 1280, h: 720 },
  13: { handle: 'NFL', ageH: 1, w: 1280, h: 720 },
  14: { handle: 'NFLonFOX', ageH: 1, w: 640, h: 360 }, // 360p
  15: { handle: 'Chiefs', ageH: 5, secs: 300 }, // 5 minutes
  19: { handle: 'chiefsfan99', ageH: 1, w: 1280, h: 720 }, // a fan account: never fetched
  16: { handle: 'NFLonCBS', ageH: 4, media: 11 }, // re-post of 11
  17: { handle: 'Chiefs', video: false },
  18: { handle: 'Chiefs', ageH: 2, w: 1280, h: 720 },
};
messagesHandler = () => searchReply([url('NFLonFOX', 14), url('NFL', 13), url('Chiefs', 11), url('Chiefs', 12), url('Chiefs', 15), url('NFLonCBS', 16), url('Chiefs', 17), url('Chiefs', 18), url('chiefsfan99', 19), 'https://x.com/Chiefs', 'https://www.espn.com/a']);
let res = await post({ mode: 'find-clips', sport: 'nfl', team: 'Chiefs' });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(aiCalls.length, 1);
assert.deepEqual(res.body.clips.map(c => c.url), [url('Chiefs', 11), url('Chiefs', 18), url('Chiefs', 12), url('NFL', 13)], 'official first, best quality and newest; low quality, too long, no video and re-posts dropped');
assert.equal(res.body.widened, undefined, '3 team clips: no widening');
assert.equal(res.body.note, undefined);
const d = res.body.diag;
assert.equal(d.nonPost, 2);
assert.equal(d.lowQuality, 1);
assert.equal(d.badLength, 1);
assert.equal(d.noVideo, 1);
assert.equal(d.dupes, 1);
assert.equal(d.untrusted, 1, 'the fan post was dropped before any fetch');
assert.equal(d.kept, 4);
assert.ok(res.body.cost <= _test.FIND_CLIPS.maxCostUsd && res.body.cost > 0.04, `one search costs at most $0.06 (${res.body.cost})`);

// 5. A thin team search widens: league accounts, then the red teams (one smaller search).
aiCalls.length = 0;
posts = {
  21: { handle: 'Chiefs', ageH: 3 },
  22: { handle: 'NFL', ageH: 4, text: 'Chiefs TD' },
  31: { handle: 'AZCardinals', ageH: 2 },
  32: { handle: '49ers', ageH: 6 },
  33: { handle: 'Buccaneers', ageH: 8 },
};
messagesHandler = body => {
  const ask = body.messages[0].content;
  if (/only this team/.test(ask)) return searchReply([url('Chiefs', 21), url('NFL', 22)]);
  assert.equal(body.tools[0].max_uses, 2, 'the widening search is smaller');
  assert.match(ask, /@AZCardinals/);
  return searchReply([url('AZCardinals', 31), url('49ers', 32), url('Buccaneers', 33), url('Chiefs', 21)], 2, 12000);
};
_test.CLIP_CACHE.clear();
res = await post({ mode: 'find-clips', sport: 'nfl', team: 'Chiefs' });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(aiCalls.length, 2);
assert.deepEqual(res.body.widened, { to: ['league', 'color'], color: 'red', colorLabel: 'Red' });
assert.equal(res.body.note, 'Fewer Chiefs clips this week — showing NFL accounts and other red teams too.');
assert.deepEqual(res.body.clips.map(c => c.via), ['search', 'league', 'color', 'color', 'color'], 'the team\'s own clips first, widened ones after');
assert.equal(res.body.clips.filter(c => c.url === url('Chiefs', 21)).length, 1, 'no duplicates across the widening');
assert.ok(res.body.cost <= _test.FIND_CLIPS.maxCostUsd + _test.FIND_CLIPS.widenCostUsd, `widening stays within $0.09 (${res.body.cost})`);
assert.ok(res.body.diag.widen && res.body.diag.widen.kept >= 3);
// The colour search it ran is cached for the colour tab (free next time).
res = await post({ mode: 'find-clips', sport: 'nfl', color: 'red' });
assert.equal(res.body.cached, true);
assert.equal(aiCalls.length, 2);

// 6. X API path (X_BEARER_TOKEN): no AI search, official variants, cache per strategy.
process.env.X_BEARER_TOKEN = 'x-test';
aiCalls.length = 0;
const xMedia = (key, id, w, h, ms = 20000) => ({ media_key: key, type: 'video', duration_ms: ms, preview_image_url: `https://pbs.twimg.com/${key}.jpg`, public_metrics: { view_count: 50000 },
  variants: [{ content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/x.m3u8' }, { content_type: 'video/mp4', bit_rate: 2176000, url: VIDEOM(id, w, h) }, { content_type: 'video/mp4', bit_rate: 256000, url: VIDEOM(id, 480, 270) }] });
xHandler = u => {
  const q = u.searchParams.get('query');
  assert.match(q, /from:Packers|from:packers/i);
  assert.match(q, /has:videos/);
  assert.equal(u.searchParams.get('expansions'), 'attachments.media_keys,author_id');
  assert.match(u.searchParams.get('media.fields'), /variants/);
  assert.ok(Date.parse(u.searchParams.get('start_time')) >= Date.now() - 121 * 3600e3, 'only the last 5 days');
  return reply(200, {
    data: [
      { id: '41', author_id: 'u1', created_at: new Date(Date.now() - 3 * 3600e3).toISOString(), text: 'Love to see it', attachments: { media_keys: ['m41'] }, public_metrics: { like_count: 900 } },
      { id: '42', author_id: 'u2', created_at: new Date(Date.now() - 2 * 3600e3).toISOString(), text: 'Packers win', attachments: { media_keys: ['m42'] } },
      { id: '43', author_id: 'u1', created_at: new Date(Date.now() - 1 * 3600e3).toISOString(), text: 'Photo only', attachments: { media_keys: ['p43'] } },
      { id: '44', author_id: 'u1', created_at: new Date(Date.now() - 1 * 3600e3).toISOString(), text: 'Tiny', attachments: { media_keys: ['m44'] } },
    ],
    includes: {
      media: [xMedia('m41', 41, 1080, 1920), xMedia('m42', 42, 1280, 720), { media_key: 'p43', type: 'photo' }, xMedia('m44', 44, 640, 360)],
      users: [{ id: 'u1', username: 'packers', name: 'Green Bay Packers', verified_type: 'business' }, { id: 'u2', username: 'NFL', name: 'NFL', verified_type: 'business' }],
    },
  });
};
res = await post({ mode: 'find-clips', sport: 'nfl', team: 'Packers' });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(aiCalls.length, 0, 'no AI search with the X API');
assert.equal(xCalls.length, 2, 'thin team: the green-team widening also uses the X API');
assert.equal(xCalls[0].auth, 'Bearer x-test');
assert.deepEqual(res.body.widened, { to: ['league'] }, 'the colour group added nothing new, so it is not claimed');
assert.equal(res.body.strategy, 'xapi');
assert.equal(res.body.cost, 0);
assert.deepEqual(res.body.clips.map(c => c.url), [url('packers', 41), url('NFL', 42)]);
assert.equal(res.body.clips[0].quality, '1080p');
assert.equal(res.body.clips[0].source, 'official');
assert.ok(res.body.clips[0].variants.every(x => x.url.startsWith('https://video.twimg.com/') && x.url.endsWith('.mp4')));
assert.equal(res.body.diag.noVideo, 1);
assert.equal(res.body.diag.lowQuality, 1);
assert.ok([..._test.CLIP_CACHE.keys()].includes('xapi|nfl|team:green bay packers'));
// X refuses (rate limit): web search takes over.
xHandler = () => reply(429, { title: 'Too Many Requests' });
posts = { 51: { handle: 'ChicagoBears', ageH: 2 }, 52: { handle: 'ChicagoBears', ageH: 3 }, 53: { handle: 'ChicagoBears', ageH: 4 } };
messagesHandler = () => searchReply([url('ChicagoBears', 51), url('ChicagoBears', 52), url('ChicagoBears', 53)]);
res = await post({ mode: 'find-clips', sport: 'nfl', team: 'Bears' });
assert.equal(res.status, 200);
assert.equal(aiCalls.length, 1, 'fell back to web search');
assert.equal(res.body.strategy, 'web');
assert.equal(res.body.diag.xapiError, 429);
assert.equal(res.body.clips.length, 3);
delete process.env.X_BEARER_TOKEN;
// Off again: a different cache key, so web search runs.
xCalls.length = 0;
res = await post({ mode: 'find-clips', sport: 'nfl', team: 'Packers' });
assert.equal(xCalls.length, 0, 'no X API without the token');
assert.equal(aiCalls.length, 2);

// 7. Gates unchanged: over the hourly limit on a cache miss is 429 before any search.
callsThisHour = 500;
res = await post({ mode: 'find-clips', sport: 'mlb', team: 'Yankees' });
assert.equal(res.status, 429);
assert.equal(aiCalls.length, 2);
callsThisHour = 0;

console.log('Video Ads clip search tests passed.');
