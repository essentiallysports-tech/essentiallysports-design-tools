#!/usr/bin/env node
// Public clip sources (netlify/functions/_clip-source-public.js): Reddit and
// Bluesky listing parsing, verified timestamps + freshness, media URL
// extraction (v.redd.it, Streamable, Bluesky getBlob, X links), dedupe,
// caching, env gates, OAuth paths and rate-limit handling. Every network call
// is mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const mod = require(path.resolve('netlify/functions/_clip-source-public.js'));
const T = mod._test;
T.pacing.scale = 0;

const NOW = Date.now();
const iso = h => new Date(NOW - h * 3600e3).toISOString();
const secs = h => Math.floor((NOW - h * 3600e3) / 1000);
const headers = (obj = {}) => ({ get: name => obj[name.toLowerCase()] ?? null });
const reply = (status, body, hdrs = {}) => ({ ok: status < 400, status, headers: headers(hdrs), json: async () => body });

// ── Fixtures ──────────────────────────────────────────────────────────────
const rpost = (id, o = {}) => ({ kind: 't3', data: {
  id, subreddit: o.sub || 'nfl', permalink: `/r/${o.sub || 'nfl'}/comments/${id}/x/`, title: o.title || `Highlight ${id}`,
  created_utc: secs(o.ageH ?? 2), score: 100, over_18: !!o.nsfw, is_self: !!o.self,
  url: o.url || `https://v.redd.it/${id}`, url_overridden_by_dest: o.url,
  secure_media: o.video === false || o.url ? null : { reddit_video: {
    fallback_url: `https://v.redd.it/${id}/CMAF_${o.h ?? 720}.mp4?source=fallback`, width: o.w ?? 1280, height: o.h ?? 720,
    duration: o.secs ?? 20, has_audio: o.audio ?? true, hls_url: `https://v.redd.it/${id}/HLSPlaylist.m3u8?a=1` } },
  preview: { images: [{ source: { url: `https://preview.redd.it/${id}.jpg` } }] },
  crosspost_parent_list: o.crosspost,
} });
const listing = children => ({ kind: 'Listing', data: { children } });

const bpost = (rkey, o = {}) => {
  const did = o.did || 'did:plc:abc123';
  const record = { $type: 'app.bsky.feed.post', text: o.text || `Clip ${rkey}`, createdAt: o.createdAt || iso(o.ageH ?? 1) };
  if (o.xUrl) record.facets = [{ features: [{ $type: 'app.bsky.richtext.facet#link', uri: o.xUrl }] }];
  if (o.video !== false && !o.xOnly) {
    record.embed = { $type: 'app.bsky.embed.video', video: { $type: 'blob', ref: { $link: o.cid || `cid${rkey}` }, mimeType: o.mime || 'video/mp4', size: o.size ?? 3_000_000 }, aspectRatio: { width: o.w ?? 1920, height: o.h ?? 1080 } };
  }
  return {
    uri: `at://${did}/app.bsky.feed.post/${rkey}`, cid: `p${rkey}`, author: { did, handle: o.handle || 'nflnewsposter.bsky.social' },
    record, indexedAt: o.indexedAt || iso(o.ageH ?? 1), labels: o.labels || [],
    embed: record.embed ? { $type: 'app.bsky.embed.video#view', cid: o.cid || `cid${rkey}`, playlist: `https://video.bsky.app/watch/${did}/cid${rkey}/playlist.m3u8`, thumbnail: `https://video.bsky.app/watch/${did}/cid${rkey}/thumbnail.jpg`, aspectRatio: { width: o.w ?? 1920, height: o.h ?? 1080 } } : undefined,
  };
};

// ── fetch mock ────────────────────────────────────────────────────────────
let routes = [];
const calls = [];
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  calls.push({ href, method: options.method || 'GET', headers: options.headers || {}, body: options.body });
  assert.match(options.headers?.['User-Agent'] || '', /^FrameUp\/1\.0 \(\+https:\/\/frameup\.essentiallysports\.com\)$/, 'polite UA on every call');
  for (const [test, handler] of routes) if (test(href, options)) return handler(href, options);
  if (/video\.twimg|v\.redd\.it|streamable\.com\/video|getBlob/.test(href)) throw new Error('server must never download video bytes');
  throw new Error(`unexpected fetch ${href}`);
};
const route = (test, handler) => routes.push([typeof test === 'string' ? h => h.includes(test) : test, handler]);
const reset = () => { routes = []; calls.length = 0; T.reset(); };
const ENV = { CLIPS_BLUESKY_SEARCH: 'off' };

// ── Pure helpers ──────────────────────────────────────────────────────────
assert.equal(T.isoOf('2026-11-17T14:04:15.648815476+00:00'), '2026-11-17T14:04:15.648Z', 'nanosecond timestamps parse');
assert.equal(T.isoOf(1700000000), '2023-11-14T22:13:20.000Z');
assert.equal(T.isoOf('nope'), null);
assert.deepEqual(T.xLink('see https://twitter.com/NFL/status/1234567890?s=20'), { url: 'https://x.com/NFL/status/1234567890', handle: 'NFL', id: '1234567890' });
assert.equal(T.xLink('https://x.com/i/status/123456'), null);
assert.equal(T.streamableId('https://streamable.com/e73di6'), 'e73di6');
assert.equal(T.streamableId('https://streamable.com/e/AbC12'), 'abc12');
assert.equal(T.streamableId('https://example.com/e73di6'), null);
assert.ok(T.looksOld('#TBT to this catch'));
assert.ok(T.looksOld('The 2019 playoff run', new Date('2026-11-17')));
assert.ok(!T.looksOld('Week 11 touchdown', new Date('2026-11-17')));
const rv = T.redditVideo({ fallback_url: 'https://v.redd.it/abc123/CMAF_720.mp4?source=fallback', width: 1280, height: 720, duration: 12, has_audio: true });
assert.equal(rv.mediaUrl, 'https://v.redd.it/abc123/CMAF_720.mp4');
assert.equal(rv.audioUrl, 'https://v.redd.it/abc123/CMAF_AUDIO_128.mp4');
assert.equal(rv.hasAudio, false, 'v.redd.it MP4 is video-only');
assert.equal(rv.durationMs, 12000);
assert.equal(T.redditVideo({ fallback_url: 'https://evil.example/x.mp4' }), null);
assert.equal(T.redditVideo({ fallback_url: 'https://v.redd.it/abc/CMAF_720.mp4', has_audio: false }).audioUrl, null);
assert.equal(T.retryAfterMs(headers({ 'retry-after': '30' }), 5), 30000);
assert.equal(T.retryAfterMs(headers({ 'x-ratelimit-reset': '12' }), 5), 12000);
assert.equal(T.retryAfterMs(headers({}), 5), 5);
assert.ok(T.mentionsAny('Eagles win!', T.teamTerms({ name: 'Philadelphia Eagles', short: 'Eagles' })));
assert.ok(!T.mentionsAny('Seagles', ['eagles']));
assert.ok(T.PDS_ALLOWED.test('https://inkcap.us-east.host.bsky.network'));
assert.ok(!T.PDS_ALLOWED.test('https://evil.host.bsky.network.example.com'));

// Bluesky verified time: indexedAt, or createdAt when backdated earlier.
assert.equal(T.blueskyPostedAt({ indexedAt: iso(1), record: { createdAt: iso(0.5) } }), iso(1));
assert.equal(T.blueskyPostedAt({ indexedAt: iso(1), record: { createdAt: iso(500) } }), iso(500), 'backdated import reads old');
assert.equal(T.blueskyPostedAt({ record: { createdAt: iso(1) } }), null, 'no AppView time = unverified');

// ── Env gates ─────────────────────────────────────────────────────────────
assert.equal(mod.reddit.configured({}), true);
assert.equal(mod.reddit.configured({ CLIPS_REDDIT: 'off' }), false);
assert.equal(mod.bluesky.configured({ CLIPS_BLUESKY: 'off' }), false);
assert.equal(mod.configured({ CLIPS_REDDIT: 'off', CLIPS_BLUESKY: 'off' }), false);
assert.equal(mod.configured({ CLIPS_PUBLIC: 'off' }), false);
assert.equal(mod.id, 'public');
assert.deepEqual(mod.sources.map(s => s.id), ['reddit', 'bluesky']);

// ── Reddit: public listing, parsing, freshness, dedupe, Streamable, X ─────
reset();
route('www.reddit.com/r/nfl/new.json', () => reply(200, listing([
  rpost('fresh1', { title: 'Jalen Hurts TD run', ageH: 3 }),
  rpost('fresh1', { title: 'dupe of fresh1', ageH: 3 }),
  rpost('old1', { ageH: 200 }),
  rpost('tbt1', { title: '#TBT what a catch', ageH: 2 }),
  rpost('low1', { h: 360, w: 640 }),
  rpost('long1', { secs: 600 }),
  rpost('nsfw1', { nsfw: true }),
  rpost('self1', { self: true, video: false }),
  rpost('xpost', { url: 'https://twitter.com/Eagles/status/1999999999999', ageH: 1 }),
  rpost('strm1', { url: 'https://streamable.com/abcd12', ageH: 4, title: 'Streamable catch' }),
  rpost('strmold', { url: 'https://streamable.com/old999', ageH: 300 }),
  rpost('cross1', { ageH: 5, video: false, url: 'https://www.reddit.com/r/eagles/comments/zz', crosspost: [rpost('orig1').data] }),
])));
route('api.streamable.com/videos/abcd12', () => reply(200, { status: 2, title: 'x', audio_channels: 2, thumbnail_url: '//cdn-cf-east.streamable.com/image/abcd12.jpg',
  files: { mp4: { url: '//cdn-cf-east.streamable.com/video/mp4/abcd12.mp4?Expires=' + (Math.floor(NOW / 1000) + 3 * 86400) + '&Signature=s', width: 1280, height: 720, duration: 33.5, size: 3_500_000 } } }));
let res = await mod.reddit.search({ sport: 'nfl', sinceHours: 120, env: ENV });
const byUrl = Object.fromEntries(res.candidates.map(c => [c.mediaId || c.url, c]));
assert.equal(res.cost, 0);
assert.ok(byUrl['vreddit:fresh1'], 'fresh v.redd.it clip kept');
assert.equal(byUrl['vreddit:fresh1'].postedAt, iso(3).replace(/\.\d{3}Z$/, '.000Z'));
assert.equal(byUrl['vreddit:fresh1'].mediaUrl, 'https://v.redd.it/fresh1/CMAF_720.mp4');
assert.equal(byUrl['vreddit:fresh1'].quality, '720p');
assert.equal(byUrl['vreddit:fresh1'].sourceKind, 'fan');
assert.equal(byUrl['vreddit:fresh1'].handle, 'r/nfl');
assert.ok(byUrl['vreddit:orig1'], 'crosspost resolves to the parent video');
assert.ok(!byUrl['vreddit:old1'] && !byUrl['vreddit:tbt1'] && !byUrl['vreddit:low1'] && !byUrl['vreddit:long1'] && !byUrl['vreddit:nsfw1']);
const x = res.candidates.find(c => c.platform === 'x');
assert.equal(x.url, 'https://x.com/Eagles/status/1999999999999');
assert.equal(x.mediaUrl, null, 'X goes through clipFromPost');
assert.equal(x.postedAt, null);
assert.equal(x.sourceKind, 'official', 'team handle classified via video-ads-sources');
const s = byUrl['streamable:abcd12'];
assert.equal(s.mediaUrl.startsWith('https://cdn-cf-east.streamable.com/video/mp4/abcd12.mp4?Expires='), true);
assert.equal(s.durationMs, 33500);
assert.equal(s.bytes, 3_500_000);
assert.ok(s.expiresAt);
assert.ok(!calls.some(c => c.href.includes('old999')), 'stale Streamable links are not resolved');
assert.equal(res.diag.duplicate, 1);
assert.equal(res.diag.tooOld, 2);
assert.equal(res.diag.throwback, 1);
assert.equal(res.diag.lowQuality, 1);
assert.equal(res.diag.badLength, 1);
assert.equal(res.diag.mode, 'public');
// Newest first.
const times = res.candidates.map(c => Date.parse(c.postedAt || c.discoveredAt));
assert.deepEqual(times, [...times].sort((a, b) => b - a));

// Cached: a second identical search makes no listing call.
const before = calls.length;
res = await mod.reddit.search({ sport: 'nfl', sinceHours: 120, env: ENV });
assert.equal(calls.filter(c => c.href.includes('reddit.com')).length, calls.slice(0, before).filter(c => c.href.includes('reddit.com')).length, 'listing served from cache');
assert.ok(res.diag.cached >= 1);

// ── Reddit: unauthenticated 403 block -> cooldown, no hammering ──────────
reset();
let hits = 0;
route('www.reddit.com/', () => { hits += 1; return reply(403, null, {}); });
res = await mod.reddit.search({ sport: 'mlb', env: ENV });
assert.equal(res.candidates.length, 0);
assert.equal(hits, 1, 'stops after the first 403');
assert.equal(res.diag.blocked, 1);
res = await mod.reddit.search({ sport: 'golf', env: ENV });
assert.equal(hits, 1, 'host in cooldown: no new request');
assert.ok(res.diag.rateLimited >= 1);

// 429 with Retry-After also cools down.
reset();
route('www.reddit.com/', () => reply(429, null, { 'retry-after': '60' }));
await mod.reddit.search({ sport: 'nfl', env: ENV });
assert.ok(T.cooldowns.get('www.reddit.com') > Date.now() + 50e3);

// ── Reddit: app-only OAuth ────────────────────────────────────────────────
reset();
let tokenCalls = 0;
route(h => h === 'https://www.reddit.com/api/v1/access_token', (h, o) => {
  tokenCalls += 1;
  assert.equal(o.method, 'POST');
  assert.equal(o.headers.Authorization, `Basic ${Buffer.from('cid:sec').toString('base64')}`);
  assert.equal(o.body, 'grant_type=client_credentials');
  return reply(200, { access_token: 'tok', expires_in: 86400 });
});
route('oauth.reddit.com/r/', (h, o) => {
  assert.equal(o.headers.Authorization, 'bearer tok');
  assert.ok(!h.includes('tok'), 'no secrets in URLs');
  return reply(200, listing([rpost('o1', { title: 'Cowboys score' })]), { 'x-ratelimit-remaining': '1', 'x-ratelimit-reset': '42' });
});
res = await mod.reddit.search({ sport: 'nfl', team: { name: 'Dallas Cowboys', short: 'Cowboys' }, env: { ...ENV, REDDIT_CLIENT_ID: 'cid', REDDIT_CLIENT_SECRET: 'sec' } });
assert.equal(res.diag.mode, 'oauth');
assert.equal(tokenCalls, 1, 'token fetched once and reused');
assert.ok(calls.some(c => c.href.startsWith('https://oauth.reddit.com/r/cowboys/new')), 'team subreddit searched');
assert.ok(res.candidates.some(c => c.mediaId === 'vreddit:o1'));
assert.ok(T.cooldowns.get('oauth.reddit.com') > Date.now(), 'nearly-spent OAuth window pauses');

// Team filter on league subs drops posts that do not name the team.
reset();
route('www.reddit.com/r/nfl/new.json', () => reply(200, listing([rpost('a1', { title: 'Eagles TD' }), rpost('a2', { title: 'Bills TD' })])));
route('www.reddit.com/r/eagles/new.json', () => reply(200, listing([])));
res = await mod.reddit.search({ sport: 'nfl', team: { name: 'Philadelphia Eagles', short: 'Eagles' }, env: ENV });
assert.deepEqual(res.candidates.map(c => c.mediaId), ['vreddit:a1']);

// ── Bluesky: feeds, getBlob URL, X links, freshness, PDS allow-list ──────
reset();
route('public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=nflnewsposter', () => reply(200, { feed: [
  { post: bpost('v1', { text: '[NFL] Saquon touchdown! twitter.com/NFL/status/1888888888888', xUrl: 'https://twitter.com/NFL/status/1888888888888' }) },
  { post: bpost('v1', {}) }, // same post twice (dupe)
  { post: bpost('old', { ageH: 300 }) },
  { post: bpost('mov', { mime: 'video/quicktime' }) },
  { post: bpost('nsfw', { labels: [{ val: 'porn' }] }) },
  { post: bpost('xonly', { xOnly: true, xUrl: 'https://x.com/someone/status/1777777777777' }) },
  { post: bpost('ext', { did: 'did:plc:selfhost' }) },
  { post: bpost('rp', {}), reason: { $type: 'app.bsky.feed.defs#reasonRepost' } },
] }));
route('public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed', () => reply(200, { feed: [] }));
route('https://plc.directory/did:plc:abc123', () => reply(200, { service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://inkcap.us-east.host.bsky.network' }] }));
route('https://plc.directory/did:plc:selfhost', () => reply(200, { service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.example.org' }] }));
res = await mod.bluesky.search({ sport: 'nfl', env: ENV });
const media = res.candidates.find(c => c.platform === 'bluesky');
assert.equal(media.mediaUrl, 'https://inkcap.us-east.host.bsky.network/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aabc123&cid=cidv1');
assert.equal(media.url, 'https://bsky.app/profile/nflnewsposter.bsky.social/post/v1');
assert.equal(media.width, 1920);
assert.equal(media.quality, '1080p');
assert.equal(media.bytes, 3_000_000);
assert.equal(media.serverStreamOk, true);
assert.ok(media.hlsUrl.includes('playlist.m3u8'));
assert.equal(media.sourceKind, 'fan');
const xs = res.candidates.filter(c => c.platform === 'x');
assert.deepEqual(xs.map(c => c.url).sort(), ['https://x.com/NFL/status/1888888888888', 'https://x.com/someone/status/1777777777777']);
assert.equal(xs.find(c => c.handle === 'NFL').sourceKind, 'league');
assert.equal(xs.find(c => c.handle === 'someone').sourceKind, 'fan');
assert.equal(xs[0].via.startsWith('https://bsky.app/profile/'), true);
assert.equal(res.candidates.length, 3);
assert.equal(res.diag.duplicate, 1);
assert.equal(res.diag.tooOld, 1);
assert.equal(res.diag.notMp4, 1);
assert.equal(res.diag.pdsNotAllowed, 1);
assert.equal(calls.filter(c => c.href.includes('plc.directory/did:plc:abc123')).length, 1, 'PDS resolved once (cached)');
assert.ok(!calls.some(c => c.href.includes('getAuthorFeed') && c.href.includes('reason')));

// Bluesky search: unauthenticated 403 -> cooldown; authenticated path uses the PDS proxy.
reset();
let searchHits = 0;
route('api.bsky.app/xrpc/app.bsky.feed.searchPosts', () => { searchHits += 1; return reply(403, null); });
route('getAuthorFeed', () => reply(200, { feed: [] }));
res = await mod.bluesky.search({ sport: 'mlb', env: {} });
assert.equal(searchHits, 1, 'second query skipped while cooling down');
assert.equal(res.diag.blocked, 1);

reset();
route('https://bsky.social/xrpc/com.atproto.server.createSession', (h, o) => {
  assert.deepEqual(JSON.parse(o.body), { identifier: 'me.bsky.social', password: 'app-pw' });
  return reply(200, { accessJwt: 'jwt1' });
});
route('https://bsky.social/xrpc/app.bsky.feed.searchPosts', (h, o) => {
  assert.equal(o.headers.Authorization, 'Bearer jwt1');
  assert.ok(new URL(h).searchParams.get('since'));
  return reply(200, { posts: [bpost('s1', { text: 'Mets walk-off home run', handle: 'fan.bsky.social' })] });
});
route('getAuthorFeed', () => reply(200, { feed: [] }));
route('plc.directory', () => reply(200, { service: [{ id: '#atproto_pds', serviceEndpoint: 'https://a.b.host.bsky.network' }] }));
res = await mod.bluesky.search({ sport: 'mlb', team: { name: 'New York Mets', short: 'Mets' }, env: { BLUESKY_HANDLE: 'me.bsky.social', BLUESKY_APP_PASSWORD: 'app-pw' } });
assert.equal(res.diag.auth, 'app-password');
assert.equal(res.candidates.length, 1);
assert.equal(res.candidates[0].handle, 'fan.bsky.social');
assert.equal(calls.filter(c => c.href.includes('createSession')).length, 1);

// Mixed-topic accounts: off-sport posts are dropped; sport words or team names pass.
assert.ok(T.aboutSport('Derrick Henry touchdown!', 'nfl'));
assert.ok(T.aboutSport('Bills beat the Jets', 'nfl'), 'team names count');
assert.ok(!T.aboutSport('Harper hit the three', 'nfl'));
reset();
route('getAuthorFeed?actor=watchmomentwire', () => reply(200, { feed: [
  { post: bpost('nba', { text: 'Harper hit the three to win it', handle: 'watchmomentwire.bsky.social' }) },
  { post: bpost('td', { text: 'Steelers touchdown late', handle: 'watchmomentwire.bsky.social' }) },
] }));
route('getAuthorFeed', () => reply(200, { feed: [] }));
route('plc.directory', () => reply(200, { service: [{ id: '#atproto_pds', serviceEndpoint: 'https://a.b.host.bsky.network' }] }));
res = await mod.bluesky.search({ sport: 'nfl', env: ENV });
assert.deepEqual(res.candidates.map(c => c.mediaId), ['bsky:cidtd']);
assert.equal(res.diag.offTopic, 1);

// ── Combined source: merge, dedupe across sources, failure isolation ─────
reset();
route('www.reddit.com/r/nfl/new.json', () => reply(200, listing([rpost('m1', { ageH: 1 }), rpost('m2', { url: 'https://x.com/NFL/status/1888888888888', ageH: 2 })])));
route('getAuthorFeed?actor=nflnewsposter', () => reply(200, { feed: [{ post: bpost('z', { xOnly: true, xUrl: 'https://twitter.com/NFL/status/1888888888888' }) }] }));
route('getAuthorFeed', () => { throw new Error('network down'); });
res = await mod.search({ sport: 'nfl', env: ENV, limit: 10 });
assert.equal(res.cost, 0);
assert.equal(res.candidates.filter(c => c.url === 'https://x.com/NFL/status/1888888888888').length, 1, 'same X post from two sources kept once');
assert.ok(res.candidates.some(c => c.mediaId === 'vreddit:m1'));
assert.ok(res.diag.sources.reddit && res.diag.sources.bluesky);
assert.ok(res.diag.sources.bluesky.failed >= 1);

reset();
res = await mod.search({ sport: 'nfl', env: { CLIPS_REDDIT: 'off', CLIPS_BLUESKY: 'off' } });
assert.deepEqual(res.candidates, []);
assert.deepEqual(res.diag.skipped, ['reddit', 'bluesky']);
assert.equal(calls.length, 0, 'gated sources make no calls');

// ── Media host allow-list for a possible server stream ───────────────────
const ok = (u) => mod.MEDIA_HOSTS.some(h => h.pattern.test(u));
assert.ok(ok('https://v.redd.it/abc123/CMAF_720.mp4'));
assert.ok(ok('https://v.redd.it/abc123/CMAF_AUDIO_128.mp4'));
assert.ok(ok('https://cdn-cf-east.streamable.com/video/mp4/abcd12.mp4?Expires=1&Signature=s'));
assert.ok(ok('https://inkcap.us-east.host.bsky.network/xrpc/com.atproto.sync.getBlob?did=x&cid=y'));
assert.ok(!ok('https://v.redd.it.evil.com/abc/CMAF_720.mp4'));
assert.ok(!ok('https://example.com/video.mp4'));

console.log('clip-source-public: all tests passed');
