#!/usr/bin/env node
// The shared clip library (_clip-library.js), its daily prefetch cron
// (clips-prefetch.js) and the find-clips / moments-with-clips integration in
// video-ads.js. Every network call is mocked: a tiny fake PostgREST for the
// library tables, the AI Gateway, fxtwitter, media HEAD checks and two fake
// extra sources (a free 'bluesky'-style one and a paid 'grok' one).
//   1. Library before the migration: memory only, no service key / table missing.
//   2. Library after the migration: upsert, read, dead links, purge, runs.
//   3. find-clips: library first (no AI with >= 9), top-up merge / dedupe / rank,
//      write-back, per-source diag, platform / sourceKind fields.
//   4. Never empty: older team clips, then the sport, labelled; AI gated -> library.
//   5. moments-with-clips: library first; empty moments -> fallback clips.
//   6. library mode: sort, paging, team chips.
//   7. Prefetch: cron secret, daily schedule + batches cover every team once,
//      trending first, the daily budget cap, dead links, purge.
//   8. Diag: admins only, no secrets.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const authPath = path.join(fnDir, '_supabase-auth.js');
const trendsPath = path.join(fnDir, 'trend-design.js');
const DB = 'https://db.example.supabase.co';

const nowSec = Math.floor(Date.now() / 1000);
const hAgo = h => new Date(Date.now() - h * 3600e3).toISOString();
const VIDEOM = (id, w = 1280, h = 720) => `https://video.twimg.com/amplify_video/${id}/vid/avc1/${w}x${h}/clip.mp4`;
const reply = (status, body, headers = {}) => ({
  ok: status < 400, status,
  headers: { get: name => headers[name.toLowerCase()] ?? null },
  json: async () => body, text: async () => (body === undefined ? '' : JSON.stringify(body)),
  body: { cancel: async () => {} },
});

// ── Fake PostgREST ─────────────────────────────────────────────────────────
const db = { frameup_clip_library: [], frameup_clip_prefetch_runs: [], frameup_ai_usage: [] };
let tableMissing = true;
let isAdminAnswer = false;
const restCalls = [];
function filterRows(rows, params) {
  return rows.filter(row => [...params.entries()].every(([key, raw]) => {
    if (['select', 'order', 'limit', 'on_conflict'].includes(key)) return true;
    const [op, ...rest] = raw.split('.');
    const value = rest.join('.');
    const cell = row[key];
    if (op === 'eq') return String(cell) === value;
    if (op === 'is') return String(cell) === value;
    if (op === 'gte') return new Date(cell) >= new Date(value);
    if (op === 'lt') return new Date(cell) < new Date(value);
    if (op === 'ov') { const list = value.replace(/^\{|\}$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')); return (cell || []).some(t => list.includes(t)); }
    if (op === 'in') { const list = value.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')); return list.includes(String(cell)); }
    return true;
  }));
}
function rest(href, options) {
  const u = new URL(href);
  const table = u.pathname.replace('/rest/v1/', '');
  const method = options.method || 'GET';
  restCalls.push({ table, query: u.search, method, auth: options.headers?.Authorization, apikey: options.headers?.apikey, prefer: options.headers?.Prefer || '' });
  if (table.startsWith('frameup_clip') && tableMissing) return reply(404, { code: 'PGRST205', message: 'Could not find the table' });
  const rows = db[table];
  if (!rows) return reply(404, { code: 'PGRST205' });
  if (method === 'GET') {
    let out = filterRows(rows, u.searchParams);
    const order = u.searchParams.get('order');
    if (order) { const [col, dir] = order.split('.'); out = [...out].sort((a, b) => (dir === 'desc' ? -1 : 1) * (new Date(a[col]) - new Date(b[col]))); }
    return reply(200, out.slice(0, Number(u.searchParams.get('limit') || 1000)));
  }
  if (method === 'POST') {
    const body = JSON.parse(options.body);
    (Array.isArray(body) ? body : [body]).forEach(row => {
      const i = rows.findIndex(r => r.url && r.url === row.url);
      if (i >= 0) rows[i] = { ...rows[i], ...row };
      else rows.push({ first_seen: new Date().toISOString(), ...row });
    });
    return reply(201, undefined);
  }
  if (method === 'PATCH') {
    const body = JSON.parse(options.body);
    filterRows(rows, u.searchParams).forEach(r => Object.assign(r, body));
    return reply(204, undefined);
  }
  if (method === 'DELETE') {
    const gone = new Set(filterRows(rows, u.searchParams));
    db[table] = rows.filter(r => !gone.has(r));
    return reply(204, undefined);
  }
  return reply(400, {});
}

// ── Other mocks ────────────────────────────────────────────────────────────
let posts = {};
let messagesHandler = () => { throw new Error('unexpected AI call'); };
let callsThisHour = 0;
const aiCalls = [];
const mediaChecks = [];
let mediaStatus = () => 200;
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, callsThisHour);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_spend') || href.includes('/rest/v1/rpc/frameup_team_ai_spend')) return reply(200, [{ total_usd: 0 }]);
  if (href.includes('/rest/v1/rpc/is_es_designer_admin')) return reply(200, isAdminAnswer);
  if (href.startsWith(`${DB}/rest/v1/`)) return rest(href, options);
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) {
    const body = JSON.parse(options.body);
    aiCalls.push(body);
    return messagesHandler(body);
  }
  if (href.startsWith('https://api.fxtwitter.com/')) {
    const id = href.match(/status\/(\d+)/)?.[1];
    const p = posts[id];
    if (!p) return reply(404, {});
    return reply(200, { code: 200, tweet: {
      text: p.text ?? `Clip ${id}`, created_timestamp: nowSec - Math.round((p.ageH ?? 2) * 3600), likes: p.likes ?? 0, views: p.views ?? 0,
      author: { name: p.handle, screen_name: p.handle },
      media: p.video === false ? {} : { videos: [{ url: VIDEOM(p.media ?? id), thumbnail_url: `https://pbs.twimg.com/${id}.jpg`, duration: p.secs ?? 15, width: 1280, height: 720 }] },
    } });
  }
  if (href.startsWith('https://cdn.syndication.twimg.com/')) return reply(404, {});
  if (/bsky\.network|v\.redd\.it|streamable\.com/.test(href)) {
    mediaChecks.push({ href, method: options.method || 'GET' });
    const status = mediaStatus(href);
    return reply(status, undefined, { 'content-type': 'video/mp4' });
  }
  if (href.startsWith('https://video.twimg.com/')) throw new Error('the server must never download video bytes');
  throw new Error(`unexpected fetch ${href}`);
};

// Trends: two NFL moments naming teams.
let trendItems = [];
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: DB, publishableKey: 'pk-public' }),
  bearerToken: headers => String(headers?.authorization || '').replace(/^Bearer\s+/i, ''),
  verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }),
} };
require.cache[trendsPath] = { id: trendsPath, filename: trendsPath, loaded: true, exports: { getTrends: async () => ({ updatedAt: new Date().toISOString(), items: trendItems }) } };
process.env.AI_GATEWAY_API_KEY = 'gw-test';
delete process.env.X_BEARER_TOKEN;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.CLIPS_LIBRARY;
delete process.env.CLIPS_EXTRA_SOURCES;

const LIB = require(path.join(fnDir, '_clip-library.js'));
const ads = require(path.join(fnDir, 'video-ads.js'));
const cron = require(path.join(fnDir, 'clips-prefetch.js'));
const T = ads._test;
const TEAMS = require(path.resolve('video-ads-teams.js'));

const post = (body, token = 'tok') => ads.handler({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  .then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));
const xurl = (handle, id) => `https://x.com/${handle}/status/${id}`;
const searchReply = (list, searches = 2, input = 12000) => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: input, output_tokens: 600, server_tool_use: { web_search_requests: searches } }, content: [{ type: 'text', text: JSON.stringify({ posts: list }) }] });
const libClip = (n, { sport = 'nfl', teams = ['Kansas City Chiefs'], ageH = 3, handle = 'Chiefs', views = 0, platform = 'x' } = {}) => ({
  clip: {
    url: xurl(handle, 9000 + n), platform, handle, text: `Library clip ${n}`, postedAt: hAgo(ageH), durationMs: 15000,
    variants: [{ url: VIDEOM(9000 + n), width: 1280, height: 720, bitrate: 1 }], source: 'official', views,
  },
  sport, teams,
});
function resetAll() {
  LIB._test.reset();
  T.CLIP_CACHE.clear();
  T.MOMENT_CACHE.clear();
  db.frameup_clip_library = [];
  db.frameup_clip_prefetch_runs = [];
  db.frameup_ai_usage = [];
  aiCalls.length = 0;
  restCalls.length = 0;
  mediaChecks.length = 0;
}

// Fake extra sources (contract interface).
const sourceCalls = [];
let freeCandidates = () => [];
let paidCandidates = () => [];
const freeSource = { id: 'public', configured: () => true, async search(opts) { sourceCalls.push({ id: 'public', opts }); return { candidates: freeCandidates(opts), cost: 0, diag: { searched: 1 } }; } };
const grokSource = { id: 'grok', configured: () => true, async search(opts) { sourceCalls.push({ id: 'grok', opts }); return { candidates: paidCandidates(opts), cost: 0.02, diag: { searched: 1 } }; } };
T.useSources([freeSource, grokSource]);
const BSKY = n => `https://morel.us-east.host.bsky.network/xrpc/com.atproto.sync.getBlob?did=did:plc:x&cid=c${n}`;

// ═══ 1. Library before the migration ═══════════════════════════════════════
resetAll();
assert.equal(LIB.status().store, 'supabase+memory', 'a store is configured');
let w = await LIB.write([libClip(1), libClip(2, { ageH: 150 })]);
assert.equal(w.written, 2);
assert.equal(w.remote, false, 'no service key: memory only');
assert.equal(restCalls.filter(c => c.method !== 'GET').length, 0, 'no writes without the service key');
let rows = await LIB.read({ sport: 'nfl', teams: ['Kansas City Chiefs'] });
assert.equal(rows.length, 2);
assert.equal(rows[0].fromLibrary, true);
assert.equal(rows[0].platform, 'x');
assert.equal(rows[0].sourceKind, 'official');
assert.equal((await LIB.read({ sport: 'nfl', teams: ['Dallas Cowboys'] })).length, 0, 'team filter');
assert.equal((await LIB.read({ sport: 'mlb' })).length, 0, 'sport filter');
// With a service key but no table yet: one failed call, then memory only for 10 minutes.
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-secret-xyz';
restCalls.length = 0;
rows = await LIB.read({ sport: 'nfl' });
assert.equal(rows.length, 2, 'memory still answers when the table is missing');
assert.equal(LIB._test.state.installed, false, 'missing table detected');
assert.equal(LIB.status().store, 'memory');
const before = restCalls.length;
await LIB.read({ sport: 'nfl' });
await LIB.write([libClip(3)]);
assert.equal(restCalls.length, before, 'no retries against a missing table for 10 minutes');
// CLIPS_LIBRARY=off: nothing at all.
process.env.CLIPS_LIBRARY = 'off';
assert.deepEqual(await LIB.read({ sport: 'nfl' }), []);
assert.equal((await LIB.write([libClip(4)])).written, 0);
delete process.env.CLIPS_LIBRARY;

// ═══ 2. Library after the migration ════════════════════════════════════════
resetAll();
tableMissing = false;
w = await LIB.write([libClip(1), libClip(2, { ageH: 150 }), libClip(5, { sport: 'mlb', teams: ['New York Yankees'], handle: 'Yankees' })]);
assert.equal(w.remote, true);
const up = restCalls.find(c => c.method === 'POST' && c.table === 'frameup_clip_library');
assert.match(up.query, /on_conflict=url/);
assert.match(up.prefer, /resolution=merge-duplicates/);
assert.equal(up.auth, 'Bearer service-secret-xyz', 'writes use the service role');
assert.equal(db.frameup_clip_library.length, 3);
assert.deepEqual(db.frameup_clip_library[0].teams, ['Kansas City Chiefs']);
assert.ok(db.frameup_clip_library.every(r => r.posted_at && Array.isArray(r.variants) && r.variants.length));
LIB._test.memory.clear(); // a different server instance: only the database knows
rows = await LIB.read({ sport: 'nfl', teams: ['Kansas City Chiefs'] });
assert.equal(rows.length, 2, 'read from the database');
assert.equal((await LIB.read({ sport: 'nfl', sinceHours: 120 })).length, 1, 'since filter');
// The caller's token is used for reads when there is no service key.
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
restCalls.length = 0;
assert.equal((await LIB.read({ sport: 'nfl', token: 'user-tok' })).length, 2);
assert.equal(restCalls[0].auth, 'Bearer user-tok', 'reads fall back to the user session (RLS)');
assert.equal((await LIB.write([libClip(6)])).remote, false, 'writes need the service key');
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-secret-xyz';
await LIB.markDead([xurl('Chiefs', 9001)]);
assert.equal(db.frameup_clip_library.find(r => r.url === xurl('Chiefs', 9001)).dead, true);
assert.equal((await LIB.read({ sport: 'nfl' })).some(c => c.url === xurl('Chiefs', 9001)), false, 'dead links are never served');
db.frameup_clip_library.push({ ...db.frameup_clip_library[0], url: 'https://x.com/old/status/1', posted_at: hAgo(24 * 8), dead: false });
const purged = await LIB.purge();
assert.equal(purged.remote, true);
assert.equal(db.frameup_clip_library.some(r => r.url === 'https://x.com/old/status/1'), false, 'older than 7 days deleted');
await LIB.recordRun({ startedAt: new Date().toISOString(), batch: 1, cost: 0.12, ms: 100 });
assert.equal(db.frameup_clip_prefetch_runs.length, 1);
assert.ok(Math.abs((await LIB.spentToday()) - 0.12) < 1e-9);

// ═══ 3. find-clips: library first, then top-up ═════════════════════════════
resetAll();
// 3a. >= 9 fresh library clips: instant, no AI, no sources.
await LIB.write(Array.from({ length: 10 }, (_, i) => libClip(100 + i, { ageH: 1 + i })));
let res = await post({ mode: 'find-clips', sport: 'nfl', team: 'Chiefs' });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(res.body.strategy, 'library');
assert.equal(res.body.clips.length, 10);
assert.equal(res.body.cost, 0);
assert.equal(aiCalls.length, 0, 'no AI call when the library has enough');
assert.equal(sourceCalls.length, 0, 'no live source either');
assert.equal(res.body.diag.sources.library, 10);
// Even over the hourly limit: the library is free.
callsThisHour = 500;
T.CLIP_CACHE.clear();
res = await post({ mode: 'find-clips', sport: 'nfl', team: 'Chiefs' });
assert.equal(res.status, 200);
callsThisHour = 0;

// 3b. Thin library: AI web search + free + paid sources, merged, deduped, ranked, written back.
resetAll();
sourceCalls.length = 0;
await LIB.write([libClip(1, { teams: ['Green Bay Packers'], handle: 'packers' })]);
posts = {
  11: { handle: 'packers', ageH: 3 },
  12: { handle: 'NFL', ageH: 2, text: 'Packers walk-off field goal wins it at Lambeau tonight' },
  13: { handle: 'fan1', ageH: 1, media: 11 }, // re-post of 11 (same media id)
  14: { handle: 'packers', ageH: 5 },
};
messagesHandler = () => searchReply([xurl('packers', 11), xurl('NFL', 12)]);
freeCandidates = () => [
  // A Bluesky re-upload of the NFL post: same length, same caption -> duplicate.
  { url: 'https://bsky.app/profile/nflmirror/post/1', platform: 'bluesky', handle: 'nflmirror', postedAt: hAgo(2), text: 'Packers walk-off field goal wins it at Lambeau tonight', mediaUrl: BSKY(1), durationMs: 15000, width: 1280, height: 720, sourceKind: 'fan' },
  // A different Bluesky clip.
  { url: 'https://bsky.app/profile/fan/post/2', platform: 'bluesky', handle: 'gbfan', postedAt: hAgo(4), text: 'Packers sideline reaction', mediaUrl: BSKY(2), durationMs: 20000, width: 1080, height: 1920, sourceKind: 'fan', hasAudio: true },
  // No verified time: dropped.
  { url: 'https://bsky.app/profile/fan/post/3', platform: 'bluesky', handle: 'gbfan', postedAt: null, text: 'Packers', mediaUrl: BSKY(3), durationMs: 20000, width: 1280, height: 720, sourceKind: 'fan' },
  // A host that is not allowed: never fetched.
  { url: 'https://evil.example/post/4', platform: 'web', handle: 'x', postedAt: hAgo(1), text: 'Packers', mediaUrl: 'https://evil.example/a.mp4', durationMs: 20000, width: 1280, height: 720 },
];
paidCandidates = () => [{ url: xurl('fan1', 13), platform: 'x', handle: 'fan1', postedAt: null, mediaUrl: null }, { url: xurl('packers', 14), platform: 'x', handle: 'packers', postedAt: null, mediaUrl: null }];
res = await post({ mode: 'find-clips', sport: 'nfl', team: 'Packers' });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(aiCalls.length >= 1, true, 'the web search ran');
assert.deepEqual(sourceCalls.map(c => c.id).sort(), ['grok', 'public']);
assert.equal(sourceCalls[0].opts.team.name, 'Green Bay Packers', 'sources get the team');
assert.ok(!mediaChecks.some(c => c.href.includes('evil.example')), 'unknown media hosts are never fetched');
const urls = res.body.clips.map(c => c.url);
assert.ok(urls.includes(xurl('packers', 11)) && urls.includes(xurl('packers', 14)) && urls.includes(xurl('NFL', 12)));
assert.ok(urls.includes('https://bsky.app/profile/fan/post/2'));
assert.ok(!urls.includes(xurl('fan1', 13)), 'the re-post of the same X video is dropped');
assert.ok(!urls.includes('https://bsky.app/profile/nflmirror/post/1'), 'the cross-platform re-upload is dropped');
assert.ok(urls.includes(xurl('packers', 9001)), 'the library clip is part of the merge');
assert.equal(res.body.clips[0].sourceKind, 'official', 'official first');
const bsky = res.body.clips.find(c => c.platform === 'bluesky');
assert.equal(bsky.sourceKind, 'fan');
assert.equal(bsky.hasAudio, true);
assert.equal(bsky.variants[0].url, BSKY(2), 'the browser downloads the MP4 directly');
assert.ok(res.body.clips.every(c => c.platform && c.sourceKind && c.via));
const ds = res.body.diag.sources;
assert.equal(ds.library, 1);
assert.equal(ds.web, 2);
assert.equal(ds.public.found, 4);
assert.equal(ds.public.kept, 2, 'passed verification (the re-upload is removed later, as a duplicate)');
assert.equal(ds.grok.kept, 2);
assert.ok(res.body.cost > 0.02 && res.body.cost <= 0.1, `cost ${res.body.cost}`);
// Written back for everyone, tagged with the team.
const saved = db.frameup_clip_library.filter(r => r.teams.includes('Green Bay Packers')).map(r => r.url);
assert.ok(saved.includes(xurl('packers', 11)) && saved.includes(xurl('packers', 14)));
assert.ok(saved.includes(xurl('NFL', 12)), 'a league clip naming the team is tagged with it');
assert.equal(db.frameup_clip_library.find(r => r.url === 'https://bsky.app/profile/fan/post/2').platform, 'bluesky');
assert.ok(res.body.diag.librarySaved >= 4);

// ═══ 4. Never empty ════════════════════════════════════════════════════════
resetAll();
sourceCalls.length = 0;
freeCandidates = () => [];
paidCandidates = () => [];
await LIB.write([
  libClip(201, { teams: ['Dallas Cowboys'], handle: 'dallascowboys', ageH: 140 }), // same team, 5.8 days
  libClip(202, { teams: ['Chicago Bears'], handle: 'ChicagoBears', ageH: 4 }), // same sport
  libClip(203, { sport: 'cfb', teams: ['Penn State Nittany Lions'], handle: 'PennStateFball', ageH: 6 }), // other sport
]);
messagesHandler = () => searchReply([]);
res = await post({ mode: 'find-clips', sport: 'nfl', team: 'Cowboys' });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.deepEqual(res.body.clips.map(c => c.via), ['older', 'sport'], 'older same-team clip, then the sport');
assert.deepEqual(res.body.fallback.steps, ['older', 'sport']);
assert.match(res.body.note, /older Cowboys clips, then other NFL clips from the clip library/);
// A team whose colour group has clips in another sport (Penn State: navy, Cowboys: blue first).
// AI blocked (over the hourly limit): the library still answers, labelled, 200.
T.CLIP_CACHE.clear();
callsThisHour = 500;
sourceCalls.length = 0;
const aiBefore = aiCalls.length;
res = await post({ mode: 'find-clips', sport: 'nfl', team: 'Cowboys' });
assert.equal(res.status, 200, 'never an error while the library has something');
assert.equal(res.body.aiPaused, 'limit');
assert.equal(res.body.freeOnly, true);
assert.equal(aiCalls.length, aiBefore, 'no AI while gated');
assert.ok(sourceCalls.every(c => c.id !== 'grok'), 'paid sources skipped while gated');
// Nothing anywhere: the old error stays.
resetAll();
res = await post({ mode: 'find-clips', sport: 'mlb', team: 'Yankees' });
assert.equal(res.status, 429);
callsThisHour = 0;
// Colour-group fallback across sports.
resetAll();
await LIB.write([libClip(301, { sport: 'cfb', teams: ['Alabama Crimson Tide'], handle: 'AlabamaFTBL', ageH: 3 })]);
messagesHandler = () => searchReply([]);
res = await post({ mode: 'find-clips', sport: 'nfl', team: 'Chiefs' }); // red
assert.deepEqual(res.body.clips.map(c => c.via), ['colorx']);
assert.match(res.body.note, /other red teams/);

// ═══ 5. moments-with-clips ═════════════════════════════════════════════════
resetAll();
trendItems = [
  { id: 't1', category: 'nfl', title: 'Chiefs stun Bills in overtime thriller', publishedAt: hAgo(3) },
  { id: 't2', category: 'nfl', title: 'Cowboys coach under fire after loss', publishedAt: hAgo(5) },
];
trendItems.push({ id: 't3', category: 'nfl', title: 'Lions clinch the division', publishedAt: hAgo(6) });
await LIB.write([
  ...Array.from({ length: 6 }, (_, i) => libClip(400 + i, { ageH: 2 + i })),
  ...Array.from({ length: 4 }, (_, i) => libClip(420 + i, { ageH: 2 + i, teams: ['Detroit Lions'], handle: 'Lions' })),
]);
res = await post({ mode: 'moments-with-clips', sport: 'nfl' });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(res.body.strategy, 'library');
assert.equal(aiCalls.length, 0, 'moments from the library: no AI');
assert.deepEqual(res.body.moments.map(m => m.id), ['t1', 't3'], 'moments without library clips are left out');
assert.equal(res.body.moments[0].clips.length, 5, 'up to 5 per moment');
// No clip for any moment: the sport's newest library clips come back as a fallback.
resetAll();
trendItems = trendItems.slice(0, 2);
await LIB.write([libClip(450, { teams: ['Detroit Lions'], handle: 'Lions', ageH: 2 })]);
messagesHandler = () => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 9000, output_tokens: 300, server_tool_use: { web_search_requests: 1 } }, content: [{ type: 'text', text: '{"moments": []}' }] });
res = await post({ mode: 'moments-with-clips', sport: 'nfl' });
assert.equal(res.status, 200);
assert.equal(res.body.moments.length, 0);
assert.equal(res.body.fallback.clips.length, 1);
assert.equal(res.body.fallback.clips[0].via, 'sport');
assert.match(res.body.fallback.note, /clip library/);

// ═══ 6. library mode ═══════════════════════════════════════════════════════
resetAll();
await LIB.write([
  libClip(501, { ageH: 1, views: 10 }),
  libClip(502, { ageH: 5, views: 900000 }),
  libClip(503, { ageH: 3, teams: ['Detroit Lions'], handle: 'Lions', views: 50 }),
  libClip(504, { ageH: 150 }), // older than 5 days: not browsed
]);
res = await post({ mode: 'library', sport: 'nfl' });
assert.equal(res.status, 200);
assert.equal(res.body.total, 3);
assert.deepEqual(res.body.clips.map(c => c.url.split('/').pop()), ['9501', '9503', '9502'], 'newest first');
res = await post({ mode: 'library', sport: 'nfl', sort: 'popular', limit: 1, offset: 0 });
assert.equal(res.body.clips[0].url.endsWith('9502'), true, 'most popular first');
assert.equal(res.body.clips.length, 1);
res = await post({ mode: 'library', sport: 'nfl', sort: 'popular', limit: 1, offset: 1 });
assert.equal(res.body.clips.length, 1, 'paging');
assert.deepEqual(res.body.teams.map(t => [t.name, t.count]), [['Kansas City Chiefs', 2], ['Detroit Lions', 1]]);
res = await post({ mode: 'library', sport: 'nfl', team: 'Lions' });
assert.equal(res.body.total, 1);
assert.equal(res.body.teams.length, 2, 'team chips list every team, not just the filtered one');
assert.equal((await post({ mode: 'library', sport: 'nba' })).status, 400);

// ═══ 7. Prefetch cron ══════════════════════════════════════════════════════
const C = cron._test;
const call = (query = {}, headers = {}) => cron.handler({ httpMethod: 'GET', headers, queryStringParameters: query }).then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));
// 7a. The secret.
delete process.env.CRON_SECRET;
assert.equal((await call({}, { authorization: 'Bearer anything' })).status, 503, 'refused when CRON_SECRET is unset');
process.env.CRON_SECRET = 'cron-secret-123';
assert.equal((await call({}, {})).status, 401);
assert.equal((await call({}, { authorization: 'Bearer wrong' })).status, 401);
assert.equal(C.cronAuthorized({ Authorization: 'Bearer cron-secret-123' }), true);
assert.equal(C.cronAuthorized({ 'x-cron-secret': 'cron-secret-123' }), true, 'external schedulers may send x-cron-secret');
assert.equal(C.cronAuthorized({ authorization: 'Bearer cron-secret-1234' }), false);
assert.equal((await call({ batch: '11' }, { authorization: 'Bearer cron-secret-123' })).status, 400, 'batch out of range');

// 7b. Daily schedule: one vercel.json cron per batch, all daily, before the US morning.
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const crons = vercel.crons.filter(c => c.path.startsWith('/api/clips-prefetch'));
const { batches, maxUsd } = C.settings({});
assert.equal(batches, 10);
assert.equal(maxUsd, 0.75, 'default daily AI cap');
assert.equal(C.settings({ CLIPS_PREFETCH_MAX_USD: '0' }).maxUsd, 0, 'a cap of 0 means no AI');
// One daily cron starts batch 1 and each batch chains the next (Hobby allows 2 crons).
assert.equal(crons.length, 1, 'one daily cron that chains the batches');
assert.equal(crons[0].path, '/api/clips-prefetch?batch=1&chain=1');
{
  const [min, hour, dom, mon, dow] = crons[0].schedule.split(' ');
  assert.ok(/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*', `${crons[0].schedule} runs once a day (Hobby-safe)`);
}
assert.ok(vercel.crons.length <= 2, 'Hobby plan allows 2 crons');
assert.equal(crons[0].schedule, '0 10 * * *');
assert.equal(vercel.functions['api/clips-prefetch.js'].maxDuration, 60);
assert.ok(fs.existsSync('api/clips-prefetch.js'));

// 7c. Batches cover every team exactly once; trending first in batch 1.
const all = C.allTeams();
assert.equal(all.length, TEAMS.TEAMS.length);
const covered = [];
for (let b = 1; b <= batches; b += 1) covered.push(...C.planBatch({ batch: b, batches, teams: all }).map(j => `${j.team.sport}|${j.team.name}`));
assert.equal(covered.length, all.length);
assert.equal(new Set(covered).size, all.length, 'every team once a day');
const chiefsT = TEAMS.findTeam('Chiefs', 'nfl');
const plan1 = C.planBatch({ batch: 1, batches, trending: [chiefsT], teams: all });
assert.equal(plan1[0].team.name, 'Kansas City Chiefs');
assert.equal(plan1[0].trending, true);
assert.equal(plan1.filter(j => j.team.name === 'Kansas City Chiefs').length, 1);
assert.ok(C.planBatch({ batch: 2, batches, teams: all }).every(j => !j.trending));
assert.ok(Math.max(...Array.from({ length: batches }, (_, i) => C.planBatch({ batch: i + 1, batches, teams: all }).length)) <= 12, 'small enough for 60 s');

// 7d. Budget: makeBudget never lets reservations pass the cap.
const budget = C.makeBudget(0.1);
assert.equal(budget.reserve(0.06), true);
assert.equal(budget.reserve(0.06), false, 'over the cap: refused');
budget.settle(0.06, 0.02);
assert.ok(Math.abs(budget.left() - 0.08) < 1e-9, 'unspent reserve returned');

// 7e. A run: free sources for every team, AI only while the day's budget lasts.
resetAll();
process.env.CLIPS_PREFETCH_MAX_USD = '0.1';
trendItems = [{ id: 't1', category: 'nfl', title: 'Chiefs stun Bills in overtime thriller', publishedAt: hAgo(3) }];
sourceCalls.length = 0;
let nextId = 700;
freeCandidates = opts => [{ url: `https://bsky.app/profile/m/post/${nextId += 1}`, platform: 'bluesky', handle: 'mirror', postedAt: hAgo(2), text: `${opts.team?.name || ''} highlight ${nextId}`, mediaUrl: BSKY(nextId), durationMs: 12000, width: 1280, height: 720, sourceKind: 'fan' }];
paidCandidates = () => [];
messagesHandler = () => searchReply([], 2, 20000);
res = await call({ batch: '1' }, { authorization: 'Bearer cron-secret-123' });
assert.equal(res.status, 200, JSON.stringify(res.body));
const run1 = res.body;
assert.equal(run1.batch, 1);
assert.deepEqual(run1.trending, ['Kansas City Chiefs']);
assert.equal(run1.done + run1.skipped.length + run1.timedOut.length, run1.teams);
assert.ok(run1.saved >= run1.done, 'every refreshed team saved its free clip');
assert.ok(run1.cost <= 0.1 + 1e-9, `daily cap held (${run1.cost})`);
assert.ok(run1.aiTeams.length >= 1 && run1.aiTeams.length < run1.teams, 'AI for a few teams only');
assert.equal(run1.aiTeams[0], 'Kansas City Chiefs', 'trending team gets the budget first');
assert.ok(sourceCalls.filter(c => c.id === 'public').length >= run1.done, 'free sources for every team');
assert.equal(db.frameup_clip_prefetch_runs.length, 1, 'run summary recorded');
assert.ok(db.frameup_ai_usage.every(r => r.feature === 'clips-prefetch' && r.cost_usd > 0), 'AI spend logged');
assert.ok(db.frameup_ai_usage.length >= 1);
const libRows = db.frameup_clip_library.length;
assert.ok(libRows >= run1.done);
// The next batch sees what batch 1 spent: nothing left, so no AI at all.
const aiBeforeB2 = aiCalls.length;
res = await call({ batch: '2' }, { authorization: 'Bearer cron-secret-123' });
assert.equal(res.status, 200);
assert.ok(res.body.budget.availableThisBatch <= 0.1 - run1.cost + 1e-9);
const spentAll = db.frameup_clip_prefetch_runs.reduce((n, r) => n + Number(r.cost_usd), 0);
assert.ok(spentAll <= 0.1 + 1e-9, `all batches together stay within the daily cap (${spentAll})`);
if (res.body.budget.availableThisBatch < C.CONFIG.aiEstimateUsd) assert.equal(aiCalls.length, aiBeforeB2, 'budget gone: no AI in later batches');
assert.ok(res.body.done > 0);
delete process.env.CLIPS_PREFETCH_MAX_USD;

// 7f. Dead links and purge.
resetAll();
await LIB.write([
  { clip: { url: 'https://bsky.app/profile/a/post/1', platform: 'bluesky', handle: 'a', text: 'Alive', postedAt: hAgo(30), durationMs: 10000, variants: [{ url: BSKY(801), width: 1280, height: 720 }] }, sport: 'nfl', teams: [] },
  { clip: { url: 'https://bsky.app/profile/a/post/2', platform: 'bluesky', handle: 'a', text: 'Gone', postedAt: hAgo(30), durationMs: 10000, variants: [{ url: BSKY(802), width: 1280, height: 720 }] }, sport: 'nfl', teams: [] },
]);
db.frameup_clip_library.forEach(r => { r.last_checked = hAgo(30); });
db.frameup_clip_library.push({ ...db.frameup_clip_library[0], url: 'https://bsky.app/profile/a/post/old', posted_at: hAgo(200) });
mediaStatus = href => (href.includes('c802') ? 404 : 200);
const re = await C.recheckLinks();
assert.equal(re.dead, 1);
assert.equal(db.frameup_clip_library.find(r => r.url.endsWith('/post/2')).dead, true);
assert.ok(new Date(db.frameup_clip_library.find(r => r.url.endsWith('/post/1')).last_checked) > new Date(hAgo(1)));
mediaStatus = () => 200;
await LIB.purge();
assert.ok(!db.frameup_clip_library.some(r => r.url.endsWith('/post/old')));

// ═══ 8. Diag: admins only, no secrets ══════════════════════════════════════
isAdminAnswer = false;
assert.equal((await call({ diag: '1' }, { authorization: 'Bearer user-tok' })).status, 403);
assert.equal((await call({ diag: '1' }, {})).status, 403);
assert.equal((await call({ diag: '1' }, { authorization: 'Bearer cron-secret-123' })).status, 403, 'the cron secret is not an admin login');
isAdminAnswer = true;
await C.runBatch({ batch: 3 });
res = await call({ diag: '1' }, { authorization: 'Bearer admin-tok' });
assert.equal(res.status, 200, JSON.stringify(res.body));
const text = JSON.stringify(res.body);
['service-secret-xyz', 'cron-secret-123', 'gw-test', 'pk-public'].forEach(secret => assert.ok(!text.includes(secret), `diag leaks ${secret}`));
assert.equal(res.body.config.cronSecret, true);
assert.equal(res.body.config.serviceKey, true);
assert.equal(res.body.schedule.cron, '0 10 * * *');
assert.ok(res.body.library.bySport && typeof res.body.library.total === 'number');
assert.ok(res.body.lastDaily && res.body.lastDaily.batchesRun.includes(3));
assert.equal(res.body.lastDaily.batchesExpected, 10);
assert.ok(Array.isArray(res.body.runs));
assert.deepEqual(res.body.config.sources.map(s => s.id), ['public', 'grok']);

tableMissing = true;
console.log('Clip library tests passed.');
