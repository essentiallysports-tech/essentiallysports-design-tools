#!/usr/bin/env node
// Video Ads multi-select (feature/va-multiselect): By team / By colour pick up
// to 6 teams or colours, results are clips of ANY of them. Every network call
// is mocked (a tiny fake PostgREST for the clip library, the AI Gateway,
// fxtwitter and two fake extra sources).
//   1. Shared helpers (video-ads-moments.js): togglePick cap, filterMoments
//      union (teams OR, colours OR, teams AND colours), back compat, matchedOf,
//      remembered picks per sport (try/catch storage).
//   2. find-clips: validation (known teams / colours, at most 6), the single
//      team / colour fields still work with the same cache keys, several teams
//      = ONE library query with an overlap filter, union de-duplicated, each
//      clip tagged with the picked teams it matched, cache keyed by the sorted
//      selection.
//   3. Cost caps unchanged: a thin multi-team selection runs at most ONE capped
//      search (aimed at the thinnest team first) and each source once.
//   4. Colours: union of the colours' teams, one query, sorted cache key.
//   5. library mode: `teams: []` (overlap), unknown names dropped, matched tags.
//   6. Union / dedupe / sort of merged clips into plays (buildMoments + sortMoments).
//   7. Page wiring: toggle chips (aria-pressed), checkbox swatches, chip menus,
//      remembered picks, the Trends hand-off still single, version bumps.
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

// ── 1. Shared helpers ──────────────────────────────────────────────────────
const M = require(path.resolve('video-ads-moments.js'));
assert.equal(M.PICK_MAX, 6);
let pick = { list: [] };
['A', 'B', 'C', 'D', 'E', 'F'].forEach(v => { pick = M.togglePick(pick.list, v); assert.equal(pick.capped, false); });
assert.deepEqual(pick.list, ['A', 'B', 'C', 'D', 'E', 'F']);
const seventh = M.togglePick(pick.list, 'G');
assert.equal(seventh.capped, true, 'a 7th pick is refused');
assert.deepEqual(seventh.list, pick.list, 'nothing changes when capped');
assert.deepEqual(M.togglePick(pick.list, 'C').list, ['A', 'B', 'D', 'E', 'F'], 'toggling a picked one removes it');
assert.deepEqual(M.togglePick(['A'], '').list, ['A']);

const pool = [
  { id: 'm1', sport: 'nfl', teams: ['Kansas City Chiefs'] },
  { id: 'm2', sport: 'nfl', teams: ['Green Bay Packers'] },
  { id: 'm3', sport: 'nfl', teams: [{ name: 'Philadelphia Eagles' }, 'Dallas Cowboys'] },
  { id: 'm4', sport: 'mlb', teams: ['New York Yankees'] },
];
const ids = list => list.map(m => m.id);
assert.deepEqual(ids(M.filterMoments(pool, { teams: ['Kansas City Chiefs', 'dallas cowboys'] })), ['m1', 'm3'], 'ANY of the teams (case-insensitive)');
assert.deepEqual(ids(M.filterMoments(pool, { team: 'Green Bay Packers' })), ['m2'], 'single team still works');
assert.deepEqual(ids(M.filterMoments(pool, { teams: ['Kansas City Chiefs'], team: 'Green Bay Packers' })), ['m1', 'm2'], 'single + array merge');
assert.deepEqual(ids(M.filterMoments(pool, { colors: ['red', 'teal'] })), ['m1', 'm3'], 'ANY of the colours (team families)');
assert.deepEqual(ids(M.filterMoments(pool, { color: 'gold' })), ['m1', 'm2'], 'single colour still works');
assert.deepEqual(ids(M.filterMoments(pool, { teams: ['Kansas City Chiefs', 'Green Bay Packers'], colors: ['red'] })), ['m1'], 'teams AND colours');
assert.deepEqual(ids(M.filterMoments(pool, { sport: 'mlb', teams: [] })), ['m4']);
assert.equal(M.filterMoments(pool, {}).length, 4, 'no filter: everything');

assert.deepEqual(M.matchedOf({ teams: ['Dallas Cowboys', 'Philadelphia Eagles'] }, ['Philadelphia Eagles', 'Kansas City Chiefs', 'Dallas Cowboys']), ['Philadelphia Eagles', 'Dallas Cowboys'], 'selection order kept');
assert.deepEqual(M.matchedOf({ teams: [], clips: [{ matched: ['Kansas City Chiefs'] }] }, ['Kansas City Chiefs']), ['Kansas City Chiefs'], 'server matched tags count');
assert.deepEqual(M.matchedOf({ teams: ['X'] }, []), []);

// Remembered picks per sport, never throwing.
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const store = mem();
assert.deepEqual(M.readPicks(store, 'nfl'), { teams: [], colors: [] }, 'nothing saved yet');
assert.equal(M.writePicks(store, 'nfl', { teams: ['Kansas City Chiefs', 'Dallas Cowboys'] }), true);
assert.equal(M.writePicks(store, 'nfl', { colors: ['red'] }), true);
assert.equal(M.writePicks(store, 'cfb', { teams: ['Alabama Crimson Tide'] }), true);
assert.deepEqual(M.readPicks(store, 'nfl'), { teams: ['Kansas City Chiefs', 'Dallas Cowboys'], colors: ['red'] }, 'teams and colours kept apart per sport');
assert.deepEqual(M.readPicks(store, 'cfb').teams, ['Alabama Crimson Tide']);
assert.deepEqual(M.readPicks(store, 'mlb'), { teams: [], colors: [] });
M.writePicks(store, 'nfl', { teams: Array.from({ length: 9 }, (_, i) => `T${i}`) });
assert.equal(M.readPicks(store, 'nfl').teams.length, 6, 'capped at 6 on write');
store.setItem(M.PICKS_KEY, '{not json');
assert.deepEqual(M.readPicks(store, 'nfl'), { teams: [], colors: [] }, 'corrupt storage reads as empty');
store.setItem(M.PICKS_KEY, JSON.stringify({ nfl: { teams: ['ok', 5, '', 'x'.repeat(200)] } }));
assert.deepEqual(M.readPicks(store, 'nfl').teams, ['ok'], 'junk entries dropped');
const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
assert.deepEqual(M.readPicks(blocked, 'nfl'), { teams: [], colors: [] }, 'blocked storage: no throw');
assert.equal(M.writePicks(blocked, 'nfl', { teams: ['A'] }), false, 'blocked storage: no throw');
assert.deepEqual(M.readPicks(null, 'nfl'), { teams: [], colors: [] });
assert.equal(M.writePicks(null, 'nfl', { teams: ['A'] }), false);

// ── Fake PostgREST + mocks ─────────────────────────────────────────────────
const db = { frameup_clip_library: [], frameup_clip_prefetch_runs: [], frameup_ai_usage: [] };
const restCalls = [];
function filterRows(rows, params) {
  return rows.filter(row => [...params.entries()].every(([key, raw]) => {
    if (['select', 'order', 'limit', 'on_conflict'].includes(key)) return true;
    const [op, ...rest] = raw.split('.');
    const value = rest.join('.');
    const cell = row[key];
    if (op === 'eq' || op === 'is') return String(cell) === value;
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
  restCalls.push({ table, params: u.searchParams, method });
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
      if (i >= 0) rows[i] = { ...rows[i], ...row }; else rows.push({ first_seen: new Date().toISOString(), ...row });
    });
    return reply(201, undefined);
  }
  return reply(204, undefined);
}
let posts = {};
let messagesHandler = () => { throw new Error('unexpected AI call'); };
const aiCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, 0);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_spend') || href.includes('/rest/v1/rpc/frameup_team_ai_spend')) return reply(200, [{ total_usd: 0 }]);
  if (href.includes('/rest/v1/rpc/')) return reply(200, false);
  if (href.startsWith(`${DB}/rest/v1/`)) return rest(href, options);
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) { const body = JSON.parse(options.body); aiCalls.push(body); return messagesHandler(body); }
  if (href.startsWith('https://api.fxtwitter.com/')) {
    const id = href.match(/status\/(\d+)/)?.[1];
    const p = posts[id];
    if (!p) return reply(404, {});
    return reply(200, { code: 200, tweet: {
      text: p.text ?? `Clip ${id} highlight`, created_timestamp: nowSec - Math.round((p.ageH ?? 2) * 3600), likes: p.likes ?? 0, views: p.views ?? 0,
      author: { name: p.handle, screen_name: p.handle },
      media: { videos: [{ url: VIDEOM(p.media ?? id), thumbnail_url: `https://pbs.twimg.com/${id}.jpg`, duration: 15, width: 1280, height: 720 }] },
    } });
  }
  if (href.startsWith('https://cdn.syndication.twimg.com/')) return reply(404, {});
  if (href.startsWith('https://video.twimg.com/')) throw new Error('the server must never download video bytes');
  throw new Error(`unexpected fetch ${href}`);
};
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: DB, publishableKey: 'pk-public' }),
  bearerToken: headers => String(headers?.authorization || '').replace(/^Bearer\s+/i, ''),
  verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }),
} };
require.cache[trendsPath] = { id: trendsPath, filename: trendsPath, loaded: true, exports: { getTrends: async () => ({ updatedAt: new Date().toISOString(), items: [] }) } };
process.env.AI_GATEWAY_API_KEY = 'gw-test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-secret-xyz';
delete process.env.X_BEARER_TOKEN;
delete process.env.CLIPS_LIBRARY;
delete process.env.CLIPS_EXTRA_SOURCES;

const LIB = require(path.join(fnDir, '_clip-library.js'));
const ads = require(path.join(fnDir, 'video-ads.js'));
const T = ads._test;
const post = body => ads.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) })
  .then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));
const xurl = (handle, id) => `https://x.com/${handle}/status/${id}`;
const searchReply = (list, searches = 2, input = 12000) => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: input, output_tokens: 600, server_tool_use: { web_search_requests: searches } }, content: [{ type: 'text', text: JSON.stringify({ posts: list }) }] });
const libClip = (n, { teams, handle, ageH = 3, views = 0, media = null }) => ({
  clip: { url: xurl(handle, 9000 + n), platform: 'x', handle, text: `Library clip ${n} for ${teams.join(' and ')}`, postedAt: hAgo(ageH), durationMs: 15000 + n * 100,
    variants: [{ url: VIDEOM(media ?? 9000 + n), width: 1280, height: 720, bitrate: 1 }], source: 'official', views },
  sport: 'nfl', teams,
});
const sourceCalls = [];
const freeSource = { id: 'public', configured: () => true, async search(opts) { sourceCalls.push({ id: 'public', opts }); return { candidates: [], cost: 0, diag: { searched: 1 } }; } };
const paidSource = { id: 'grok', configured: () => true, async search(opts) { sourceCalls.push({ id: 'grok', opts }); return { candidates: [], cost: 0.02, diag: { searched: 1 } }; } };
T.useSources([freeSource, paidSource]);
function resetAll() {
  LIB._test.reset();
  T.CLIP_CACHE.clear();
  db.frameup_clip_library = [];
  aiCalls.length = 0;
  restCalls.length = 0;
  sourceCalls.length = 0;
  posts = {};
  messagesHandler = () => { throw new Error('unexpected AI call'); };
}
const libReads = () => restCalls.filter(c => c.table === 'frameup_clip_library' && c.method === 'GET');

// ── 2. find-clips: validation + back compat ────────────────────────────────
resetAll();
let res = await post({ mode: 'find-clips', sport: 'nfl', teams: ['Chiefs', 'Eagles', 'Cowboys', 'Packers', 'Bears', 'Lions', 'Vikings'] });
assert.equal(res.status, 400);
assert.match(res.body.error, /up to 6 teams/);
res = await post({ mode: 'find-clips', sport: 'nfl', teams: ['Chiefs', 'Toronto Argonauts'] });
assert.equal(res.status, 400, 'unknown team refused');
assert.match(res.body.error, /Toronto Argonauts/);
res = await post({ mode: 'find-clips', sport: 'nfl', teams: ['Chiefs', 'Yankees'] });
assert.equal(res.status, 400, 'a team from another sport is not "known" here');
res = await post({ mode: 'find-clips', sport: 'nfl', colors: ['red', 'plaid'] });
assert.equal(res.status, 400, 'unknown colour id refused');
assert.match(res.body.error, /plaid/);
res = await post({ mode: 'find-clips', sport: 'nfl', colors: ['red', 'blue', 'green', 'gold', 'orange', 'navy', 'silver'] });
assert.equal(res.status, 400);
assert.match(res.body.error, /up to 6 colours/);
res = await post({ mode: 'find-clips', sport: 'nfl', color: 'plaid' });
assert.equal(res.status, 400, 'a lone unknown colour is still ignored (as before): nothing left to search');
assert.match(res.body.error, /Pick a team, a colour or a moment/);
assert.equal(aiCalls.length, 0, 'validation never spends');
assert.equal(T.PICK_MAX, 6);

// Single team / colour: the same cache keys as before; `teams: [one]` is the same search.
await LIB.write(Array.from({ length: 10 }, (_, i) => libClip(i, { teams: ['Kansas City Chiefs'], handle: 'Chiefs', ageH: 1 + i })));
res = await post({ mode: 'find-clips', sport: 'nfl', team: 'Chiefs' });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(res.body.clips.length, 10);
assert.ok(res.body.clips.every(c => !('matched' in c)), 'one team: no matched tags (unchanged response)');
assert.equal(T.clipKey('web', 'nfl', { team: { name: 'Kansas City Chiefs' } }), 'web|nfl|team:kansas city chiefs');
assert.equal(T.clipKey('web', 'nfl', { color: 'red', colors: ['red'], query: '' }), 'web|nfl|color:red');
assert.equal(T.clipKey('web', 'nfl', { query: 'Big Play' }), 'web|nfl|query:big play');
res = await post({ mode: 'find-clips', sport: 'nfl', teams: ['Kansas City Chiefs'] });
assert.equal(res.status, 200);
assert.equal(res.body.clips.length, 10, '`teams: [one]` = `team: one`');
assert.equal(T.pickedTeams({ team: 'Chiefs', teams: ['Kansas City Chiefs'] }, 'nfl').teams.length, 1, 'the same team twice is one pick');

// ── Several teams: ONE library query with an overlap filter ────────────────
resetAll();
await LIB.write([
  ...Array.from({ length: 5 }, (_, i) => libClip(100 + i, { teams: ['Kansas City Chiefs'], handle: 'Chiefs', ageH: 2 + i, views: 1000 * i })),
  ...Array.from({ length: 4 }, (_, i) => libClip(200 + i, { teams: ['Philadelphia Eagles'], handle: 'Eagles', ageH: 1 + i })),
  // One play about both teams (counted once, matched to both).
  libClip(300, { teams: ['Kansas City Chiefs', 'Philadelphia Eagles'], handle: 'NFL', ageH: 1 }),
  // A re-post of clip 100's video by another account: the same media -> one clip.
  libClip(301, { teams: ['Kansas City Chiefs'], handle: 'fanpage', ageH: 2, media: 9100 }),
  // Another team: never in the results.
  libClip(400, { teams: ['Dallas Cowboys'], handle: 'dallascowboys', ageH: 1 }),
]);
LIB._test.memory.clear(); // only the database knows: every clip comes from the query
restCalls.length = 0;
res = await post({ mode: 'find-clips', sport: 'nfl', teams: ['Eagles', 'Chiefs'] });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(libReads().length, 1, 'one library query for two teams');
const ov = libReads()[0].params.get('teams');
assert.match(ov, /^ov\.\{/, 'an overlap filter on the teams array');
assert.ok(ov.includes('"Philadelphia Eagles"') && ov.includes('"Kansas City Chiefs"'), 'both teams in the one query');
assert.equal(aiCalls.length, 0, 'enough in the library: no AI');
assert.equal(sourceCalls.length, 0);
assert.equal(res.body.cost, 0);
assert.deepEqual(res.body.teams.map(t => t.name), ['Philadelphia Eagles', 'Kansas City Chiefs'], 'teams in pick order');
const urls = res.body.clips.map(c => c.url);
assert.equal(new Set(urls).size, urls.length, 'no duplicate urls');
assert.ok(!urls.some(u => u.includes('dallascowboys')), 'only the picked teams');
assert.equal(urls.filter(u => u === xurl('Chiefs', 9100) || u === xurl('fanpage', 9301)).length, 1, 'the same video re-posted is one clip');
assert.equal(res.body.clips.length, 10, '5 + 4 + 1 shared, the re-post dropped');
const both = res.body.clips.find(c => c.url === xurl('NFL', 9300));
assert.deepEqual([...both.matched].sort(), ['Kansas City Chiefs', 'Philadelphia Eagles'], 'a clip about both teams says so');
assert.deepEqual(res.body.clips.find(c => c.url === xurl('Eagles', 9200)).matched, ['Philadelphia Eagles']);
assert.ok(res.body.clips.every(c => c.matched.length >= 1), 'every clip says which picked team(s) it matched');
// Cache keyed by the sorted selection: the other order is a cache hit.
const keys = [...T.CLIP_CACHE.keys()];
res = await post({ mode: 'find-clips', sport: 'nfl', teams: ['Chiefs', 'Eagles'] });
assert.equal(res.status, 200);
assert.equal(T.clipKey('web', 'nfl', { teams: [{ name: 'Philadelphia Eagles' }, { name: 'Kansas City Chiefs' }] }), 'web|nfl|teams:kansas city chiefs,philadelphia eagles');
assert.equal(T.clipKey('web', 'nfl', { teams: [{ name: 'Kansas City Chiefs' }, { name: 'Philadelphia Eagles' }] }), 'web|nfl|teams:kansas city chiefs,philadelphia eagles');
assert.deepEqual(keys, [], 'library answers are not cached (free anyway)');

// ── 3. Thin selection: at most ONE capped search, thinnest team first ──────
resetAll();
await LIB.write([
  ...Array.from({ length: 3 }, (_, i) => libClip(500 + i, { teams: ['Kansas City Chiefs'], handle: 'Chiefs', ageH: 2 + i })),
  libClip(510, { teams: ['Dallas Cowboys'], handle: 'dallascowboys', ageH: 3 }),
]);
posts = { 61: { handle: 'Eagles', ageH: 2 }, 62: { handle: 'dallascowboys', ageH: 4 } };
messagesHandler = () => searchReply([xurl('Eagles', 61), xurl('dallascowboys', 62)]);
res = await post({ mode: 'find-clips', sport: 'nfl', teams: ['Chiefs', 'Cowboys', 'Eagles'] });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(aiCalls.length, 1, 'three teams, ONE web search (not one per team)');
assert.deepEqual(sourceCalls.map(c => c.id).sort(), ['grok', 'public'], 'each extra source once');
const ask = JSON.stringify(aiCalls[0]);
assert.ok(ask.indexOf('Philadelphia Eagles') < ask.indexOf('Dallas Cowboys') && ask.indexOf('Dallas Cowboys') < ask.indexOf('Kansas City Chiefs'), 'aimed at the thinnest team first (Eagles 0, Cowboys 1, Chiefs 3 in the library)');
assert.equal(aiCalls[0].tools[0].max_uses, T.FIND_CLIPS.maxUses, 'the same search cap as one team');
assert.ok(res.body.cost <= T.FIND_CLIPS.maxCostUsd + 0.02 + 1e-9, `cost within the one-team caps (${res.body.cost})`);
assert.equal(T.FIND_CLIPS.maxCostUsd, 0.06, 'caps unchanged');
assert.equal(T.FIND_CLIPS.maxUses, 4, 'caps unchanged');
assert.equal(res.body.widened, undefined, 'no colour-group widening (and no second search) for several teams');
const got = res.body.clips.map(c => c.url);
assert.ok(got.includes(xurl('Eagles', 61)) && got.includes(xurl('Chiefs', 9500)) && got.includes(xurl('dallascowboys', 9510)), 'library + live, merged');
assert.deepEqual(res.body.clips.find(c => c.url === xurl('Eagles', 61)).matched, ['Philadelphia Eagles'], 'live clips are tagged too (official handle)');
// The same selection again (any order): the 30-minute cache, nothing spent.
aiCalls.length = 0;
res = await post({ mode: 'find-clips', sport: 'nfl', teams: ['Eagles', 'Chiefs', 'Cowboys'] });
assert.equal(res.body.cached, true, 'cache keyed by the sorted selection');
assert.equal(res.body.cost, 0);
assert.equal(aiCalls.length, 0);
assert.ok([...T.CLIP_CACHE.keys()].includes('web|nfl|teams:dallas cowboys,kansas city chiefs,philadelphia eagles'));

// ── 4. Several colours: union of their teams, one query ────────────────────
resetAll();
const TEAMS = require(path.resolve('video-ads-teams.js'));
const union = T.teamsForColors('nfl', ['red', 'teal']).map(t => t.name);
const redTeams = TEAMS.teamsFor({ sport: 'nfl', color: 'red' }).map(t => t.name);
const tealTeams = TEAMS.teamsFor({ sport: 'nfl', color: 'teal' }).map(t => t.name);
assert.deepEqual(union, [...new Set([...redTeams, ...tealTeams])], 'union, red teams first');
await LIB.write([
  ...Array.from({ length: 6 }, (_, i) => libClip(600 + i, { teams: ['Kansas City Chiefs'], handle: 'Chiefs', ageH: 1 + i })),
  ...Array.from({ length: 4 }, (_, i) => libClip(700 + i, { teams: ['Philadelphia Eagles'], handle: 'Eagles', ageH: 1 + i })),
]);
LIB._test.memory.clear();
restCalls.length = 0;
res = await post({ mode: 'find-clips', sport: 'nfl', colors: ['teal', 'red'] });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(libReads().length, 1, 'one query for two colours');
assert.deepEqual(res.body.teams.map(t => t.name).sort(), [...union].sort());
assert.equal(res.body.clips.length, 10, 'clips of either colour');
assert.equal(aiCalls.length, 0);
assert.ok(res.body.clips.some(c => c.matched.includes('Philadelphia Eagles')) && res.body.clips.some(c => c.matched.includes('Kansas City Chiefs')));
assert.equal(T.clipKey('web', 'nfl', { colors: ['teal', 'red'] }), 'web|nfl|colors:red,teal', 'sorted colour key');
// One colour: only 6 red clips in the library, so one capped search, as before.
messagesHandler = () => searchReply([]);
aiCalls.length = 0;
res = await post({ mode: 'find-clips', sport: 'nfl', colors: ['red'] });
assert.equal(res.status, 200, '`colors: [one]` works like `color`');
assert.equal(aiCalls.length, 1, 'one search for one colour');
assert.ok([...T.CLIP_CACHE.keys()].includes('web|nfl|color:red'), '`colors: [one]` shares the single colour cache key');
// Teams win over colours, as the single fields always did.
assert.equal(T.pickedColors({ colors: ['red'], color: 'red' }).colors.length, 1);

// ── 5. library mode: teams array ───────────────────────────────────────────
restCalls.length = 0;
res = await post({ mode: 'library', sport: 'nfl', teams: ['Chiefs', 'Eagles', 'Not A Team'] });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.deepEqual(res.body.selected.map(t => t.name), ['Kansas City Chiefs', 'Philadelphia Eagles'], 'unknown names dropped (a filter)');
assert.equal(res.body.team.name, 'Kansas City Chiefs', 'the old `team` field: the first pick');
assert.equal(res.body.total, 10);
assert.ok(res.body.clips.every(c => c.matched.length === 1));
const filtered = libReads().filter(c => c.params.get('teams'));
assert.equal(filtered.length, 1, 'one overlap query for the picked teams (the other read is the unfiltered team chips)');
res = await post({ mode: 'library', sport: 'nfl', team: 'Eagles' });
assert.equal(res.body.total, 4, 'single `team` still filters');
assert.ok(res.body.clips.every(c => !('matched' in c)));
res = await post({ mode: 'library', sport: 'nfl', teams: Array.from({ length: 7 }, () => 'Chiefs') });
assert.equal(res.body.total, 6, 'the same team 7 times is one pick (Chiefs only), not a cap error');

// ── 6. Union / dedupe / sort into plays ────────────────────────────────────
{
  const now = Date.now();
  const clip = (id, team, ageH, views, text, media) => ({ url: xurl('x', id), handle: 'x', sport: 'nfl', teams: [team], postedAt: new Date(now - ageH * 3600e3).toISOString(), views, text, variants: [{ url: VIDEOM(media ?? id), width: 1280, height: 720 }], durationMs: 15000 });
  const merged = [
    clip(1, 'Kansas City Chiefs', 1, 900, 'Mahomes 40 yard touchdown pass to Kelce', 11),
    clip(2, 'Kansas City Chiefs', 1.2, 400, 'Mahomes 40 yard touchdown pass to Kelce', 11), // same video, another account
    clip(3, 'Philadelphia Eagles', 30, 50000, 'Hurts sneak for the score on fourth down'),
    clip(4, 'Philadelphia Eagles', 3, 10, 'Eagles defense forces a fumble late'),
  ];
  const plays = M.buildMoments(merged, { now, windowHours: 168 }).moments;
  assert.equal(plays.length, 3, 'one card per play across the picked teams');
  assert.equal(plays.find(m => m.clips.length === 2)?.angles, 1, 'the re-post is an angle, not a card');
  assert.equal(M.sortMoments(plays, 'newest')[0].teams[0], 'Kansas City Chiefs');
  assert.equal(M.sortMoments(plays, 'views')[0].teams[0], 'Philadelphia Eagles', 'most viewed first');
  assert.deepEqual(M.matchedOf(plays.find(m => m.teams.includes('Philadelphia Eagles')), ['Kansas City Chiefs', 'Philadelphia Eagles']), ['Philadelphia Eagles']);
}

// ── 7. Page wiring ─────────────────────────────────────────────────────────
const js = fs.readFileSync('video-ads.js', 'utf8');
const html = fs.readFileSync('video-ads.html', 'utf8');
const css = fs.readFileSync('video-ads-findclip.css', 'utf8');
assert.doesNotMatch(js, /state\.team\b|state\.color\b|mo\.team\b|mo\.color\b|lib\.team\b/, 'single-pick state is gone');
assert.doesNotMatch(js, /data-mo-filter|data-lib-filter|data-filter="team"/, 'no single <select> filters left');
assert.match(js, /class="es-chip va-teamchip[^"]*"[^>]*aria-pressed="\$\{on\}"/, 'team chips are toggle buttons (aria-pressed)');
assert.match(js, /class="va-swatch" type="button" role="checkbox"/, 'swatches are checkboxes');
assert.match(js, /pickMenu\('library'/);
assert.match(js, /pickMenu\('mo-team'/);
assert.match(js, /pickMenu\('mo-color'/);
assert.match(js, /aria-haspopup="true" aria-expanded="\$\{open\}"/, 'chip menus say they open');
assert.match(js, /type="checkbox" data-pick-opt=/, 'chip menu options are checkboxes');
assert.match(js, /MOX\.writePicks\(pickStore\(\)/, 'picks remembered per sport');
assert.match(js, /const pickStore = \(\) => \{ try \{ return window\.localStorage; \} catch/, 'storage access never throws');
assert.match(js, /names\.length === 1 \? \{ sport: state\.teamSport, team: names\[0\] \}/, 'one team: the single `team` field');
assert.match(js, /state\.teams = \[named\?\.name \|\| String\(m\.team\)\.slice\(0, 80\)\]/, 'the Trends hand-off picks its one team');
assert.match(js, /mo\.teams = hf\.team \? \[hf\.team\] : \[\]/, 'the hand-off filters By moment to its team');
assert.match(html, /id="va-team-list"/);
assert.match(html, /role="group" aria-label="Teams, pick up to 6" id="va-team-list"/);
assert.match(html, /role="group" aria-label="Team colours, pick up to 6" id="va-swatches"/);
['video-ads.js', 'video-ads-moments.js', 'video-ads.css', 'video-ads-findclip.css'].forEach(f => assert.ok(html.includes(`${f}?v=20261120-multi`), `${f} cache key bumped`));
assert.match(css, /\.va-picksum\b/);
assert.match(css, /\.va-pick__pop\b/);
assert.match(css, /html\[data-theme="dark"\][^{]*\.va-picksum__chip/, 'dark mode');
assert.doesNotMatch(css.slice(css.indexOf('Multi-select')), /#(?:8b5cf6|7c3aed|a855f7|9333ea|6d28d9)|purple|violet/i, 'no purple');

console.log('Video Ads multi-select tests passed.');
