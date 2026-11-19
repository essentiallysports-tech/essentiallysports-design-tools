#!/usr/bin/env node
// Video Ads clip sourcing (owner, 2026-11-19): "CFB and MLB very few clips"
// and "all videos should be from trusted sites". Every network call is mocked.
//   1. The trusted-source allowlist (_clip-trust.js): team / league / network
//      accounts and sites pass; fans, Reddit, Bluesky, Streamable and unknown
//      hosts are rejected; Google redirect links are judged by where they lead.
//   2. Handle coverage: every team has an official handle (CFB 71, MLB 30,
//      NFL 32), every Power Four program is in the list, conference accounts.
//   3. Windows per sport: NFL 5 days, CFB 7, MLB 30 in the offseason.
//   4. The official-sites source (_clip-source-sites.js): ESPN (CFB) and
//      MLB.com parsing, last games of the season, NFL untouched.
//   5. find-clips end to end in free mode: ESPN clips (size read from the
//      file header), MLB offseason label, last-games note, fan posts dropped.
//   6. By moment, all sports: a full NFL pool no longer starves CFB and MLB.
//   7. Pasted links: any link works, labelled trusted or "Unverified source".
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const authPath = path.join(fnDir, '_supabase-auth.js');
const trendsPath = path.join(fnDir, 'trend-design.js');
const hAgo = h => new Date(Date.now() - h * 3600e3).toISOString();
const nowSec = Math.floor(Date.now() / 1000);

// ── Fixtures ──────────────────────────────────────────────────────────────
// A tiny MP4 header: one 'tkhd' box saying 1920x1080 (what ESPN serves).
function mp4Header(w, h) {
  const buf = Buffer.alloc(200);
  buf.write('moov', 4);
  buf.write('tkhd', 40);
  buf[44] = 0; // version 0
  const off = 44 + 4 + 20 + 8 + 8 + 36;
  buf.writeUInt32BE(w * 65536, off);
  buf.writeUInt32BE(h * 65536, off + 4);
  return buf;
}
const ESPN_ID = { alabama: '333', vanderbilt: '238', ohioState: '194', fcs: '2534' };
const espnVideo = (id, title, ageH, teamId) => ({
  id, headline: title, originalPublishDate: hAgo(ageH), duration: 25,
  thumbnail: `https://espnmedia-cdn.akamaized.net/espn/media/${id}.jpg`,
  links: { web: { href: `https://www.espn.com/video/clip/_/id/${id}/play` }, source: { href: `https://espnmedia-cdn.akamaized.net/espn/media/16x9/${id}/${id}.mp4`, HD: { href: `https://espnmedia-cdn.akamaized.net/espn/media/16x9/${id}/${id}.mp4` } } },
  categories: teamId ? [{ type: 'team', teamId: Number(teamId) }] : [],
});
const espnEvent = (id, ageH, a, b, rank = 99) => ({ id, date: hAgo(ageH), status: { type: { completed: true } }, competitions: [{ competitors: [{ team: { id: a }, curatedRank: { current: rank } }, { team: { id: b }, curatedRank: { current: 99 } }] }] });
let espnBoard = {};
let espnSummaries = {};
const mlbItem = (slug, title, ageH, team, secs = 30) => ({
  slug, headline: title, date: hAgo(ageH), duration: `00:00:${String(secs).padStart(2, '0')}`,
  image: { cuts: [{ width: 960, src: `https://img.mlbstatic.com/${slug}.jpg` }] },
  playbacks: [{ name: 'hlsCloud', url: `https://mlb-cuts-diamond.mlb.com/${slug}.m3u8` }, { name: 'mp4Avc', url: `https://mlb-cuts-diamond.mlb.com/FORGE/${slug}_1280x720_59_4000K.mp4` }],
  keywordsAll: [{ type: 'team_id', displayName: team }],
});
let mlbSchedule = () => ({ dates: [] });
let mlbContent = {};
let fx = {};
const fetchLog = [];
const reply = (status, body, headers = {}) => ({
  ok: status < 400, status,
  json: async () => body, text: async () => JSON.stringify(body),
  headers: { get: k => headers[String(k).toLowerCase()] ?? (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
  arrayBuffer: async () => (body instanceof Buffer ? body.buffer.slice(body.byteOffset, body.byteOffset + body.length) : new ArrayBuffer(0)),
  body: { cancel: async () => {} },
});
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  fetchLog.push(href);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, 0);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_spend') || href.includes('/rest/v1/rpc/frameup_team_ai_spend')) return reply(200, [{ total_usd: 0 }]);
  if (href.includes('/rest/v1/')) return reply(404, { code: 'PGRST205', message: 'not installed' });
  if (href.startsWith('https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard')) {
    const week = new URL(href).searchParams.get('week');
    return reply(200, week ? (espnBoard.last || { events: [] }) : (espnBoard.current || { events: [] }));
  }
  if (href.startsWith('https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary')) {
    const id = new URL(href).searchParams.get('event');
    return reply(200, espnSummaries[id] || { videos: [] });
  }
  if (href.startsWith('https://statsapi.mlb.com/api/v1/schedule')) return reply(200, mlbSchedule(new URL(href)));
  if (href.startsWith('https://statsapi.mlb.com/api/v1/game/')) {
    const pk = href.match(/game\/(\d+)\/content/)?.[1];
    return reply(200, mlbContent[pk] || { highlights: { highlights: null } });
  }
  if (href.startsWith('https://espnmedia-cdn.akamaized.net/')) {
    if (options.method === 'HEAD') return reply(200, null, { 'content-type': 'video/mp4' });
    assert.equal(options.headers?.Range, 'bytes=0-65535', 'only the file header is read, never the video');
    return reply(206, mp4Header(1920, 1080), { 'content-type': 'video/mp4' });
  }
  if (href.startsWith('https://mlb-cuts-diamond.mlb.com/')) return reply(200, null, { 'content-type': 'video/mp4' });
  if (href.startsWith('https://api.fxtwitter.com/')) {
    const id = href.match(/status\/(\d+)/)?.[1];
    const p = fx[id];
    if (!p) return reply(404, {});
    return reply(200, { code: 200, tweet: {
      text: p.text ?? `Touchdown ${id}`, created_timestamp: nowSec - Math.round((p.ageH ?? 2) * 3600), likes: 10, views: 1000,
      author: { name: p.handle, screen_name: p.handle },
      media: { videos: [{ url: `https://video.twimg.com/amplify_video/${id}/vid/avc1/1280x720/a.mp4`, thumbnail_url: `https://pbs.twimg.com/${id}.jpg`, duration: 20, width: 1280, height: 720 }] },
    } });
  }
  if (href.startsWith('https://cdn.syndication.twimg.com/')) return reply(404, {});
  if (href.startsWith('https://video.twimg.com/')) throw new Error('the server must never download video bytes');
  throw new Error(`unexpected fetch ${href}`);
};

require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: () => 'tok',
  verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }),
} };
require.cache[trendsPath] = { id: trendsPath, filename: trendsPath, loaded: true, exports: { getTrends: async () => ({ updatedAt: new Date().toISOString(), items: [] }) } };
delete process.env.AI_GATEWAY_API_KEY;
delete process.env.XAI_API_KEY;
delete process.env.X_BEARER_TOKEN;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.CLIPS_EXTRA_SOURCES;
delete process.env.CLIPS_LIBRARY;

const TRUST = require(path.join(fnDir, '_clip-trust.js'));
const SITES = require(path.join(fnDir, '_clip-source-sites.js'));
const LIB = require(path.join(fnDir, '_clip-library.js'));
const TEAMS = require(path.resolve('video-ads-teams.js'));
const SOURCES = require(path.resolve('video-ads-sources.js'));
const ads = require(path.join(fnDir, 'video-ads.js'));
const T = ads._test;

// ═══ 1. Trusted-source allowlist ══════════════════════════════════════════
const ok = (input, kind, label) => {
  const t = TRUST.classify(input);
  assert.equal(t.trusted, true, `${JSON.stringify(input)} should be trusted`);
  assert.equal(t.kind, kind);
  if (label) assert.equal(t.label, label);
};
const no = (input, why) => assert.equal(TRUST.classify(input).trusted, false, why);
ok({ platform: 'x', handle: 'Yankees' }, 'official', '@Yankees · team account');
ok({ platform: 'x', handle: '@AlabamaFTBL' }, 'official', '@AlabamaFTBL · team account');
ok({ platform: 'x', url: 'https://x.com/MLB/status/1' }, 'league', '@MLB · league account');
ok({ platform: 'x', handle: 'SECNetwork' }, 'league');
ok({ platform: 'x', handle: 'ESPNCFB' }, 'media', '@ESPNCFB · network');
ok({ platform: 'x', handle: 'CFBONFOX' }, 'media');
ok({ platform: 'x', handle: 'NFLonCBS' }, 'media');
ok({ platform: 'mlb', url: 'https://www.mlb.com/video/a-walk-off', mediaUrl: 'https://mlb-cuts-diamond.mlb.com/a_1280x720_59_4000K.mp4' }, 'league', 'MLB.com · league site');
ok({ platform: 'espn', url: 'https://www.espn.com/video/clip/_/id/1', mediaUrl: 'https://espnmedia-cdn.akamaized.net/espn/media/1.mp4' }, 'media', 'ESPN · network');
ok({ url: 'https://www.chiefs.com/video/td' }, 'official', 'Kansas City Chiefs · team site');
ok({ url: 'https://rolltide.com/news/2026/11/14/video' }, 'official');
ok({ url: 'https://www.nfl.com/videos/td' }, 'league', 'NFL.com · league site');
ok({ url: 'https://www.google.com/url?sa=t&url=https%3A%2F%2Fwww.mlb.com%2Fvideo%2Fhomer' }, 'league', 'MLB.com · league site');
no({ platform: 'x', handle: 'chiefsfan99' }, 'a fan account');
no({ platform: 'x', url: 'https://x.com/NFL_Memes/status/1' }, 'an aggregator');
no({ platform: 'x', handle: '' }, 'no author');
no({ platform: 'reddit', url: 'https://www.reddit.com/r/CFB/comments/1', mediaUrl: 'https://v.redd.it/a/DASH_720.mp4' }, 'Reddit');
no({ platform: 'bluesky', url: 'https://bsky.app/profile/a/post/1', mediaUrl: 'https://x.bsky.network/blob' }, 'Bluesky');
no({ platform: 'streamable', url: 'https://streamable.com/abc' }, 'Streamable');
no({ url: 'https://evil.example/clip.mp4' }, 'an unknown host');
no({ url: 'https://mlb.com.evil.example/video' }, 'a look-alike host');
no({ url: 'https://www.google.com/url?url=https%3A%2F%2Fevil.example%2Fv' }, 'a Google link to an unknown site');
no({ platform: 'espn', url: 'https://www.espn.com/video/1', mediaUrl: 'https://cdn.evil.example/1.mp4' }, 'a trusted page with a file from an unknown host');
assert.equal(TRUST.classify({ platform: 'x', handle: 'fan' }).label, '@fan · unverified');
assert.equal(TRUST.classify({ platform: 'reddit', url: 'https://reddit.com/r/x' }).label, 'Reddit · unverified');
assert.equal(TRUST.unwrapRedirect('https://www.google.com/url?q=https://www.espn.com/video/1'), 'https://www.espn.com/video/1');
assert.equal(TRUST.unwrapRedirect('https://www.espn.com/video/1'), 'https://www.espn.com/video/1');
assert.ok(TRUST.mediaHostTrusted('https://video.twimg.com/a.mp4'));
assert.ok(!TRUST.mediaHostTrusted('https://v.redd.it/a.mp4'), 'Reddit files are not search results any more');
assert.equal(T.TRUST, TRUST, 'video-ads.js uses the one allowlist');
assert.equal(ads.clipPipeline.TRUST, TRUST, 'and so does the daily prefetch');

// ═══ 2. Handle coverage ═══════════════════════════════════════════════════
const cov = SOURCES.coverage(TEAMS.TEAMS);
assert.deepEqual(cov.nfl, { teams: 32, withHandle: 32, league: 2, media: 6 }, 'NFL unchanged');
assert.equal(cov.mlb.teams, 30);
assert.equal(cov.mlb.withHandle, 30, 'all 30 MLB teams');
assert.equal(cov.cfb.teams, 73, 'CFB: every Power Four program + Notre Dame + top Group of Five');
assert.equal(cov.cfb.withHandle, 73);
const p4 = Object.values({ ...SOURCES.CONFERENCE_SOURCES }).length;
assert.equal(p4, 4);
['sec', 'big10', 'acc', 'big12'].forEach(conf => assert.ok(SOURCES.CONFERENCE_SOURCES[conf].length));
// Every Power Four program: SEC 16, Big Ten 18, ACC 17, Big 12 16 = 67.
const confTeams = TEAMS.TEAMS.filter(t => t.sport === 'cfb' && SOURCES.conferenceFor(t).length);
assert.equal(confTeams.length, 67, 'all 67 Power Four programs, each with its conference accounts');
assert.deepEqual(SOURCES.conferenceFor('Alabama Crimson Tide'), ['SECNetwork', 'SEC']);
assert.deepEqual(SOURCES.conferenceFor('Iowa State Cyclones'), ['Big12Conference']);
assert.deepEqual(SOURCES.conferenceFor('Notre Dame Fighting Irish'), []);
['@CFBONFOX', '@ESPNCFB', '@SECNetwork', '@bigten', '@accnetwork', '@Big12Conference'].forEach(h => assert.notEqual(SOURCES.classifyHandle(h, 'cfb'), 'other', h));
['@MLB', '@MLBNetwork', '@MLBONFOX'].forEach(h => assert.notEqual(SOURCES.classifyHandle(h, 'mlb'), 'other', h));
const lower = Object.values(SOURCES.TEAM_HANDLES).map(h => h.toLowerCase());
assert.equal(new Set(lower).size, lower.length, 'one handle per team');
TEAMS.TEAMS.forEach(t => assert.ok(t.logo && t.colors.length === 2 && t.families.length >= 1, t.name));
// A CFB team search asks its own conference first.
const bama = TEAMS.findTeam('Alabama', 'cfb');
assert.deepEqual(T.searchPlan({ sport: 'cfb', team: bama }).league.slice(0, 2), ['SECNetwork', 'SEC']);
assert.match(T.searchPlan({ sport: 'cfb', team: bama }).queries[2], /^@SECNetwork Alabama/);
// Longer team names first: "Kansas State" is not also "Kansas".
assert.deepEqual(T.teamsInText('Kansas State edges Iowa State', 'cfb').sort(), ['Iowa State Cyclones', 'Kansas State Wildcats']);

// ═══ 3. Windows per sport ═════════════════════════════════════════════════
const nov19 = Date.UTC(2026, 10, 19, 12);
const jul10 = Date.UTC(2026, 6, 10, 12);
assert.equal(T.windowFor('nfl', nov19), 120, 'NFL keeps 5 days');
assert.equal(T.windowFor('cfb', nov19), 168, 'CFB: 7 days (always covers last weekend)');
assert.equal(T.windowFor('mlb', nov19), 720, 'MLB offseason: 30 days');
assert.equal(T.windowFor('mlb', jul10), 120, 'MLB in season: 5 days');
assert.equal(T.mlbOffseason(Date.UTC(2026, 10, 2)), false, 'early November: World Series week');
assert.equal(T.mlbOffseason(Date.UTC(2027, 1, 25)), false, 'spring training');
assert.deepEqual(T.windowInfo('mlb', nov19), { hours: 720, days: 30, offseason: true, label: 'Recent highlights (last 30 days)' });
assert.equal(T.windowInfo('cfb', nov19).label, 'Last 7 days');
assert.equal(T.windowInfo('nfl', nov19).label, 'Last 5 days');
assert.deepEqual(T.mp4Dims(mp4Header(1920, 1080)), { width: 1920, height: 1080 });
assert.equal(T.mp4Dims(Buffer.alloc(64)), null);

// ═══ 4. Official-sites source ═════════════════════════════════════════════
assert.equal(SITES.id, 'sites');
assert.equal(SITES.paid, false, 'free: runs in free mode too');
assert.equal(SITES.configured({ CLIPS_SITES: 'off' }), false);
espnBoard = {
  current: { week: { number: 12 }, season: { type: 2, year: 2026 }, events: [espnEvent('e3', 30, ESPN_ID.ohioState, ESPN_ID.fcs, 1), { ...espnEvent('e9', -40, ESPN_ID.alabama, ESPN_ID.fcs), status: { type: { completed: false } } }] },
  last: { events: [espnEvent('e1', 100, ESPN_ID.alabama, ESPN_ID.vanderbilt, 3), espnEvent('e2', 300, ESPN_ID.alabama, ESPN_ID.vanderbilt)] },
};
espnSummaries = {
  e1: { videos: [espnVideo('101', 'Keelon Russell throws 39-yard TD vs. Vanderbilt', 98, ESPN_ID.alabama), espnVideo('102', 'Brock Taylor makes 57-yard field goal', 97), { headline: 'no file', links: {} }] },
  e3: { videos: [espnVideo('301', 'Julian Sayin 60-yard touchdown pass', 28, ESPN_ID.ohioState)] },
};
let r = await SITES.search({ sport: 'cfb', team: bama, sinceHours: 168 });
assert.equal(r.cost, 0);
assert.equal(r.diag.games, 1, 'only Alabama\'s finished game in the window (not the game in 2 days, not the one 12 days ago)');
assert.deepEqual(r.candidates.map(c => c.url), ['https://www.espn.com/video/clip/_/id/102/play', 'https://www.espn.com/video/clip/_/id/101/play'], 'newest first; the item with no file is skipped');
const c101 = r.candidates[1];
assert.equal(c101.platform, 'espn');
assert.equal(c101.sourceKind, 'media');
assert.equal(c101.mediaUrl, 'https://espnmedia-cdn.akamaized.net/espn/media/16x9/101/101.mp4');
assert.deepEqual(c101.teams, ['Alabama Crimson Tide']);
assert.deepEqual(r.candidates[0].teams.sort(), ['Alabama Crimson Tide', 'Vanderbilt Commodores'], 'untagged clip: both teams of the game');
assert.equal(c101.width, null, 'ESPN lists no size: it is read from the file');
r = await SITES.search({ sport: 'cfb', sinceHours: 168 });
assert.equal(r.candidates[0].url, 'https://www.espn.com/video/clip/_/id/301/play', 'sport-wide: ranked teams first');
assert.equal(r.candidates.length, 3);
r = await SITES.search({ sport: 'nfl', sinceHours: 120 });
assert.equal(r.candidates.length, 0, 'NFL search is unchanged: no site source');

const brewersGame = (pk, ageH) => ({ gamePk: pk, gameDate: hAgo(ageH), status: { abstractGameState: 'Final' }, teams: { away: { team: { name: 'Milwaukee Brewers' } }, home: { team: { name: 'Tampa Bay Rays' } } } });
mlbSchedule = u => {
  const days = (Date.now() - Date.parse(u.searchParams.get('startDate'))) / 864e5;
  return { dates: [{ games: days > 25 ? [brewersGame(9001, 21 * 24)] : [] }] };
};
mlbContent = { 9001: { highlights: { highlights: { items: [
  mlbItem('contreras-rbi-double', "William Contreras' RBI double", 21 * 24, 'Milwaukee Brewers', 31),
  mlbItem('condensed-game', 'Condensed Game: MIL@TB', 21 * 24, 'Milwaukee Brewers', 59),
  { ...mlbItem('long-recap', 'Game 5 Highlights', 21 * 24, 'Milwaukee Brewers'), duration: '00:07:28' },
] } } } };
SITES._test.reset();
r = await SITES.search({ sport: 'mlb', sinceHours: 720 });
assert.equal(r.candidates.length, 2, 'clips over 120 s (full recaps) are skipped');
assert.equal(r.candidates[0].platform, 'mlb');
assert.equal(r.candidates[0].sourceKind, 'league');
assert.equal(r.candidates[0].url, 'https://www.mlb.com/video/contreras-rbi-double');
assert.equal(r.candidates[0].width, 1280, 'size from the file name');
assert.equal(r.candidates[0].height, 720);
assert.deepEqual(r.candidates[0].teams, ['Milwaukee Brewers']);
assert.ok(!r.candidates[0].lastGames, 'inside the 30-day window: not "last games"');
r = await SITES.search({ sport: 'mlb', sinceHours: 120 });
assert.equal(r.diag.lastGames, true, 'nothing in 5 days: the last games of the season');
assert.ok(r.candidates.every(c => c.lastGames));
// Empty highlights (MLB's API sometimes answers that for a moment) are not cached.
SITES._test.reset();
const keep = mlbContent[9001];
mlbContent = {};
r = await SITES.search({ sport: 'mlb', sinceHours: 720 });
assert.equal(r.candidates.length, 0);
mlbContent = { 9001: keep };
r = await SITES.search({ sport: 'mlb', sinceHours: 720 });
assert.equal(r.candidates.length, 2, 'the next ask retries');

// ═══ 5. find-clips end to end (free mode: no AI, no keys) ═════════════════
process.env.CLIPS_LIBRARY = 'off';
T.useSources([SITES]);
T.CLIP_CACHE.clear();
let res = await T.findClips({ sport: 'cfb', team: 'Alabama' }, { freeOnly: true });
assert.equal(res.ok, true);
assert.equal(res.cost, 0);
assert.equal(res.clips.length, 2);
assert.ok(res.clips.every(c => c.platform === 'espn' && c.quality === '1080p'), '1080p measured from the file header');
assert.ok(res.clips.every(c => c.trust.label === 'ESPN · network'));
assert.ok(res.clips.every(c => c.via === 'search'), 'an ESPN clip tagged Alabama is an Alabama result, not a widening');
assert.equal(res.widened, undefined);
assert.deepEqual(res.window, { hours: 168, days: 7, offseason: false, label: 'Last 7 days' });
assert.ok(!fetchLog.some(u => u.includes('video.twimg.com')));

SITES._test.reset();
T.CLIP_CACHE.clear();
res = await T.findClips({ sport: 'mlb', team: 'Brewers' }, { freeOnly: true });
assert.equal(res.clips.length, 2);
assert.equal(res.clips[0].trust.label, 'MLB.com · league site');
if (T.mlbOffseason()) {
  assert.equal(res.window.label, 'Recent highlights (last 30 days)', 'MLB offseason: labelled, not empty');
  assert.ok(res.clips.every(c => c.via === 'search'));
}
// Deep offseason (no games in the window): last games, labelled with the date.
mlbSchedule = u => {
  const days = (Date.now() - Date.parse(u.searchParams.get('startDate'))) / 864e5;
  return { dates: [{ games: days > 40 ? [brewersGame(9001, 45 * 24)] : [] }] };
};
mlbContent = { 9001: { highlights: { highlights: { items: [mlbItem('last-homer', 'Christian Yelich solo home run', 45 * 24, 'Milwaukee Brewers', 25)] } } } };
SITES._test.reset();
T.CLIP_CACHE.clear();
res = await T.findClips({ sport: 'mlb', team: 'Brewers' }, { freeOnly: true });
assert.equal(res.clips.length, 1);
assert.equal(res.clips[0].via, 'lastgames');
assert.equal(res.lastGames, true);
assert.match(res.note, /^No MLB games in the last \d+ days — showing highlights from the last games of the season \(\w+ \d+\)\.$/);
// Only MLB gets last games.
assert.equal(T.assessClip({ ok: true, platform: 'mlb', url: 'https://www.mlb.com/video/x', variants: [{ url: 'https://mlb-cuts-diamond.mlb.com/x_1280x720_.mp4', width: 1280, height: 720 }], postedAt: hAgo(900), durationMs: 20000, text: 'home run', lastGames: true }, { sport: 'cfb' }).reason, 'tooOld');

// Fan posts never come back, from any source.
const fanSource = { id: 'public', configured: () => true, search: async () => ({ cost: 0, candidates: [
  { url: 'https://x.com/bamafan/status/111', platform: 'x', handle: 'bamafan', postedAt: null, mediaUrl: null },
  { url: 'https://x.com/AlabamaFTBL/status/112', platform: 'x', handle: 'AlabamaFTBL', postedAt: null, mediaUrl: null },
  { url: 'https://www.reddit.com/r/rolltide/comments/1', platform: 'reddit', handle: 'u1', postedAt: hAgo(3), mediaUrl: 'https://v.redd.it/a/DASH_720.mp4', width: 1280, height: 720, durationMs: 20000, text: 'Touchdown Bama' },
] }) };
fx = { 111: { handle: 'bamafan' }, 112: { handle: 'AlabamaFTBL', text: 'TOUCHDOWN ALABAMA' } };
T.useSources([fanSource]);
T.CLIP_CACHE.clear();
fetchLog.length = 0;
res = await T.findClips({ sport: 'cfb', team: 'Alabama' }, { freeOnly: true });
assert.deepEqual(res.clips.map(c => c.url), ['https://x.com/AlabamaFTBL/status/112'], 'only the official post');
assert.equal(res.clips[0].trust.label, '@AlabamaFTBL · team account');
assert.equal(res.diag.sources.public.untrusted, 2, 'the fan post and the Reddit upload');
assert.ok(!fetchLog.some(u => /status\/111|v\.redd\.it/.test(u)), 'nothing is fetched for untrusted candidates');

// The library hides rows saved before the rule (fan clips).
delete process.env.CLIPS_LIBRARY;
LIB._test.reset();
await LIB.write([
  { clip: { url: 'https://x.com/bamafan/status/120', handle: 'bamafan', platform: 'x', text: 'Touchdown Bama', postedAt: hAgo(5), durationMs: 20000, variants: [{ url: 'https://video.twimg.com/amplify_video/120/vid/avc1/1280x720/a.mp4', width: 1280, height: 720 }] }, sport: 'cfb', teams: ['Alabama Crimson Tide'] },
  { clip: { url: 'https://x.com/AlabamaFTBL/status/121', handle: 'AlabamaFTBL', platform: 'x', text: 'Touchdown Bama', postedAt: hAgo(5), durationMs: 20000, variants: [{ url: 'https://video.twimg.com/amplify_video/121/vid/avc1/1280x720/a.mp4', width: 1280, height: 720 }] }, sport: 'cfb', teams: ['Alabama Crimson Tide'] },
]);
const lib = await T.libraryClips({ sport: 'cfb' });
assert.deepEqual(lib.fresh.map(c => c.url), ['https://x.com/AlabamaFTBL/status/121'], 'a stored fan clip is hidden');
assert.equal(lib.fresh[0].trust.label, '@AlabamaFTBL · team account');

// ═══ 6. By moment, all sports: fair per sport ═════════════════════════════
// The library has plenty of NFL plays (14) and nothing else. Before, "enough"
// counted all sports together, so CFB and MLB were never topped up.
LIB._test.reset();
await LIB.write(Array.from({ length: 14 }, (_, i) => ({
  clip: { url: `https://x.com/NFL/status/${500 + i}`, handle: 'NFL', platform: 'x', text: `${['Chiefs', 'Bills', 'Eagles', 'Lions', 'Ravens', 'Packers', 'Bears'][i % 7]} play number ${i} touchdown ${'abcdefghijklmn'[i]}${i}`, postedAt: hAgo(2 + i * 7), durationMs: 20000, views: 1000 * (i + 1), variants: [{ url: `https://video.twimg.com/amplify_video/${500 + i}/vid/avc1/1280x720/a.mp4`, width: 1280, height: 720 }] },
  sport: 'nfl', teams: [],
})));
const asked = [];
const fairSource = { id: 'sites', configured: () => true, paid: false, search: async opts => {
  asked.push(opts.sport);
  if (opts.sport === 'cfb') return { cost: 0, candidates: [{ url: 'https://www.espn.com/video/clip/_/id/9/td', platform: 'espn', handle: '', postedAt: hAgo(20), text: 'Ohio State touchdown run', mediaUrl: 'https://espnmedia-cdn.akamaized.net/espn/media/9.mp4', width: 1920, height: 1080, durationMs: 20000, sourceKind: 'media', teams: ['Ohio State Buckeyes'] }] };
  return { cost: 0, candidates: [] };
} };
T.useSources([fairSource]);
T.MOMENT_CACHE.clear();
const mo = await T.momentsWithClips({ sport: 'all' }, { freeOnly: true });
assert.ok(asked.includes('cfb') && asked.includes('mlb'), 'CFB and MLB are topped up even though NFL is full');
assert.ok(!asked.includes('nfl'), 'NFL already had its share: no extra calls');
assert.ok(mo.moments.some(m => m.sport === 'cfb'), 'a CFB play is in All sports');
assert.ok(mo.windows && mo.windows.cfb.label === 'Last 7 days' && mo.windows.nfl.label === 'Last 5 days');
T.useSources([]);

// ═══ 7. Pasted links: any link works, labelled ════════════════════════════
fx = { 131: { handle: 'Yankees', text: 'Judge homer' }, 132: { handle: 'randomfan', text: 'Judge homer from my seat' } };
const clipMode = url => ads.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify({ mode: 'clip', url }) }).then(x => ({ status: x.statusCode, body: JSON.parse(x.body) }));
let link = await clipMode('https://x.com/Yankees/status/131');
assert.equal(link.status, 200, JSON.stringify(link.body));
assert.deepEqual(link.body.trust, { trusted: true, kind: 'official', label: '@Yankees · team account', site: 'X' });
link = await clipMode('https://x.com/randomfan/status/132');
assert.equal(link.status, 200, 'a fan link still works: the user chose it');
assert.equal(link.body.trust.trusted, false);
assert.equal(link.body.trust.kind, 'unverified');
link = await clipMode(`https://www.google.com/url?sa=t&url=${encodeURIComponent('https://x.com/Yankees/status/131')}`);
assert.equal(link.status, 200, 'a Google result link is followed to the post');
assert.equal(link.body.trust.label, '@Yankees · team account');

console.log('Video Ads clip-source tests passed.');
