#!/usr/bin/env node
// Reels Studio game data (netlify/functions/_reel-games.js): the ESPN adapter
// against saved real responses (scripts/fixtures/reels), the GameDigest rules
// (contract §3.2) against the golden digest, caching, the per-user limiter,
// schema drift -> soft fail, the drama-sorted game list, athlete search and
// stats, the MLB StatsAPI fallback gate, and library clip matching.
// fetch is mocked: no network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const G = require('../netlify/functions/_reel-games.js');
const T = require('../reel-timeline.js');
const FX = new URL('./fixtures/reels/', import.meta.url);
const fx = name => JSON.parse(readFileSync(new URL(name, FX), 'utf8'));

let passed = 0;
async function test(name, fn) {
  try { G._test._reset(); await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
const json = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    for (const [match, reply] of routes) if (u.includes(match)) return typeof reply === 'function' ? reply(u, opts) : json(reply);
    return json({ error: 'not mocked' }, 404);
  };
  return { fetchImpl, calls };
}
const clock = start => { let t = start; const now = () => t; now.add = ms => { t += ms; }; return now; };
const auth = email => ({ user: { email } });

const GOLD = fx('nfl-401873063.digest.json');
const MIN = fx('espn-nfl-summary-401873063.min.json');
const FULL = fx('espn-nfl-summary-401873063.full.min.json');
const MLB = fx('espn-mlb-summary-401908046.min.json');
const BOARD = fx('espn-nfl-scoreboard.min.json');

await test('golden: the min NFL summary digests byte for byte to nfl-401873063.digest.json', () => {
  const d = G.digestGame(MIN, { sport: 'nfl', eventId: '401873063', now: () => Date.parse(GOLD.fetchedAt) });
  assert.equal(JSON.stringify(d), JSON.stringify(GOLD));
  assert.ok(T.validateDigest(d).ok);
});

await test('game-data: response matches the contract fixture (final, 7-day TTL, cached on the second call)', async () => {
  const resp = fx('game-data-401873063.response.json');
  const now = clock(Date.parse(GOLD.fetchedAt));
  const { fetchImpl, calls } = mockFetch([['/football/nfl/summary?event=401873063', MIN]]);
  const ctx = { auth: auth('a@essentiallysports.com'), fetchImpl, now };
  const out = await G.gameData({ sport: 'nfl', eventId: '401873063' }, ctx);
  assert.deepEqual(out, resp);
  assert.equal(calls[0].opts.headers['User-Agent'], G.UA);
  assert.doesNotMatch(G.UA, /@|https?:/, 'no contact data or URL in the User-Agent');
  assert.ok(calls[0].opts.signal, 'every fetch has a timeout');
  const again = await G.gameData({ sport: 'nfl', eventId: '401873063' }, ctx);
  assert.equal(again.cached, true);
  assert.equal(calls.length, 1);
});

await test('digest rules on a full real NFL game: <= 8 KB, <= 30 plays, tags per rule 4, WP keeps >= 60 points', () => {
  const d = G.digestGame(FULL, { sport: 'nfl', eventId: '401873063' });
  const v = T.validateDigest(d);
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.ok(v.bytes <= 8192);
  assert.ok(d.plays.length <= 30 && d.plays.length >= 15);
  assert.ok(d.wp.points.length >= 60 && d.wp.points.length <= 120, `wp points ${d.wp.points.length}`);
  assert.equal(d.wp.count, 203);
  assert.equal(d.wp.points[0][0], -1, 'pregame first');
  const ys = d.wp.points.map(p => p[1]);
  assert.equal(Math.min(...ys), 0, 'the series keeps its minimum');
  assert.equal(d.attribution, 'Win probability: ESPN Analytics');
  const swings = d.plays.filter(p => p.tags.includes('swing'));
  assert.ok(swings.length <= 12 && swings.every(p => Math.abs(p.swing) >= 0.05));
  const last = d.plays.at(-1);
  assert.ok(last.tags.includes('final') && last.score.away === 46 && last.score.home === 40);
  // Lead changes are flips between leaders, never a move out of a tie.
  d.plays.filter(p => p.tags.includes('lead-change')).forEach(p => assert.notEqual(p.score.home, p.score.away));
  d.plays.forEach(p => { assert.ok(p.text.length <= 100); assert.ok(!/^\(/.test(p.text), 'leading parentheticals stripped'); });
  // Scoring text comes from scoringPlays (not the raw play-by-play line).
  assert.ok(d.plays.some(p => p.scoring && /Yd pass from/.test(p.text)));
  assert.equal(JSON.stringify(d).includes('espncdn'), false, 'no ESPN logo URLs');
});

await test('MLB (ESPN): half innings, batting team, per-at-bat WP, period ends', () => {
  const d = G.digestGame(MLB, { sport: 'mlb', eventId: '401908046' });
  assert.ok(T.validateDigest(d).ok, JSON.stringify(T.validateDigest(d).errors));
  assert.deepEqual([d.teams.home.abbr, d.teams.away.abbr, d.teams.home.score, d.teams.away.score], ['TB', 'MIL', 1, 4]);
  const scoring = d.plays.filter(p => p.scoring);
  assert.ok(scoring.length >= 4);
  scoring.forEach(p => { assert.ok(['top', 'bottom'].includes(p.half)); assert.equal(p.team, p.half === 'top' ? 'away' : 'home'); assert.equal(p.down, null); assert.equal(p.clock, ''); });
  assert.ok(d.plays.some(p => p.tags.includes('period-end')));
  assert.equal(d.wp.count, 70);
});

await test('text rules: sentence cut <= 100, else a word cut + ellipsis; parentheticals stripped', () => {
  const long = 'First sentence is here. ' + 'word '.repeat(30) + 'end.';
  assert.equal(G.shortenText(long), 'First sentence is here.');
  const noStop = 'a'.repeat(5) + ' ' + 'bbbbbbbb '.repeat(14);
  const cut = G.shortenText(noStop);
  assert.ok(cut.endsWith('…') && cut.length <= 100);
  const d = G.digestGame(MIN, { sport: 'nfl', eventId: '401873063' });
  assert.ok(d.plays.every(p => !p.text.includes('(Shotgun)')));
});

await test('downsample keeps first, last, min and max', () => {
  const pts = Array.from({ length: 300 }, (_, i) => [i, 0.5 + 0.4 * Math.sin(i / 7)]);
  pts[137][1] = 0.01; pts[211][1] = 0.99;
  const out = G.downsample(pts, 120);
  assert.equal(out.length, 120);
  assert.deepEqual([out[0][0], out.at(-1)[0]], [0, 299]);
  assert.ok(out.some(p => p[0] === 137) && out.some(p => p[0] === 211));
  out.forEach((p, i) => { if (i) assert.ok(p[0] > out[i - 1][0]); });
});

await test('no win probability in the feed: wp null, no attribution, still a valid digest', () => {
  const { winprobability, ...noWp } = FULL;
  const d = G.digestGame(noWp, { sport: 'nfl', eventId: '401873063' });
  assert.equal(d.wp, null);
  assert.equal(d.attribution, '');
  assert.ok(T.validateDigest(d).ok);
  assert.ok(d.plays.every(p => p.wpHome === null && p.swing === null));
});

await test('schema drift fails soft: data-unavailable, never a throw', async () => {
  const cases = [
    { header: {}, drives: {} },
    { header: { competitions: [{ competitors: [{ homeAway: 'home' }] }] } },
    { ...MIN, header: { competitions: [{ ...MIN.header.competitions[0], status: { type: { state: 'weird' } } }] } },
    { ...MIN, drives: { previous: 'nope' } },
  ];
  for (const body of cases) {
    G._test._reset();
    const { fetchImpl } = mockFetch([['summary', body]]);
    const out = await G.gameData({ sport: 'nfl', eventId: '401873063' }, { auth: auth('x@e.com'), fetchImpl });
    assert.deepEqual(out, G.SOFT);
  }
  G._test._reset();
  const html = mockFetch([['summary', () => new Response('<HTML>Access Denied</HTML>', { status: 200 })]]);
  assert.equal((await G.gameData({ sport: 'nfl', eventId: '401873063' }, { fetchImpl: html.fetchImpl })).reason, 'data-unavailable');
  G._test._reset();
  const down = mockFetch([['summary', () => json({}, 503)]]);
  assert.equal((await G.gameData({ sport: 'nfl', eventId: '401873063' }, { fetchImpl: down.fetchImpl })).status, 502);
  const board = mockFetch([['scoreboard', { nope: true }]]);
  const list = await G.listGames({ sport: 'nfl', when: 'live' }, { fetchImpl: board.fetchImpl });
  assert.deepEqual([list.ok, list.status, list.reason], [false, 502, 'data-unavailable']);
  // Bad input never reaches ESPN.
  assert.equal((await G.gameData({ sport: 'nba', eventId: '1' }, {})).status, 400);
  assert.equal((await G.gameData({ sport: 'nfl', eventId: '../x' }, {})).status, 400);
});

await test('caching: live digest 20 s, final within 2 h of the end 2 min, list live 15 s / recent 60 s; one fetch in flight', async () => {
  const liveHeader = { competitions: [{ ...MIN.header.competitions[0], status: { period: 1, displayClock: '6:56', type: { state: 'in', completed: false, detail: '6:56 - 1st' } } }] };
  const live = { ...MIN, header: liveHeader };
  const now = clock(Date.parse('2026-11-15T21:45:00Z'));
  const { fetchImpl, calls } = mockFetch([['summary', live]]);
  const ctx = { fetchImpl, now };
  const [a, b] = await Promise.all([G.gameData({ sport: 'nfl', eventId: '401873063' }, ctx), G.gameData({ sport: 'nfl', eventId: '401873063' }, ctx)]);
  assert.equal(calls.length, 1, 'concurrent requests share one fetch');
  assert.equal(a.ttlSec, 20);
  assert.equal(b.digest.status.state, 'in');
  now.add(19000);
  assert.equal((await G.gameData({ sport: 'nfl', eventId: '401873063' }, ctx)).cached, true);
  now.add(2000);
  assert.equal((await G.gameData({ sport: 'nfl', eventId: '401873063' }, ctx)).cached, false);
  assert.equal(calls.length, 2);
  // Final, ended an hour ago: short TTL; ended long ago: 7 days.
  const fresh = G.digestGame(FULL, { sport: 'nfl', eventId: '401873063' });
  const end = Math.max(...fresh.plays.map(p => Date.parse(p.wallclock)).filter(Number.isFinite));
  assert.equal(G.digestTtl(fresh, () => end + 3600e3), G.TTL.digestFresh);
  assert.equal(G.digestTtl(fresh, () => end + 3 * 3600e3), G.TTL.digestFinal);
  // Lists.
  G._test._reset();
  const b2 = mockFetch([['scoreboard', BOARD]]);
  const lnow = clock(Date.parse('2026-11-16T12:00:00Z'));
  const l1 = await G.listGames({ sport: 'nfl', when: 'live' }, { fetchImpl: b2.fetchImpl, now: lnow, warm: false });
  assert.equal(l1.ttlSec, 15);
  await G.listGames({ sport: 'nfl', when: 'live' }, { fetchImpl: b2.fetchImpl, now: lnow, warm: false });
  assert.equal(b2.calls.length, 1);
  lnow.add(16000);
  await G.listGames({ sport: 'nfl', when: 'live' }, { fetchImpl: b2.fetchImpl, now: lnow, warm: false });
  assert.equal(b2.calls.length, 2);
  const r = await G.listGames({ sport: 'nfl', when: 'recent' }, { fetchImpl: b2.fetchImpl, now: lnow, warm: false });
  assert.equal(r.ttlSec, 60);
});

await test('limiter: 30 data calls a minute per user, then 429; another user is unaffected', async () => {
  const now = clock(Date.parse('2026-11-17T22:00:00Z'));
  const { fetchImpl } = mockFetch([['summary', MIN]]);
  const ctx = { auth: auth('busy@essentiallysports.com'), fetchImpl, now };
  for (let i = 0; i < G.LIMIT_PER_MIN; i += 1) assert.equal((await G.gameData({ sport: 'nfl', eventId: '401873063' }, ctx)).ok, true);
  const over = await G.gameData({ sport: 'nfl', eventId: '401873063' }, ctx);
  assert.deepEqual([over.status, over.reason], [429, 'limit']);
  assert.equal((await G.gameData({ sport: 'nfl', eventId: '401873063' }, { ...ctx, auth: auth('other@essentiallysports.com') })).ok, true);
  now.add(61000);
  assert.equal((await G.gameData({ sport: 'nfl', eventId: '401873063' }, ctx)).ok, true);
});

await test('games: contract shape, recent = finals in 48 h, sorted by drama (null last), digests warmed', async () => {
  const shape = fx('games-nfl.response.json');
  const now = clock(Date.parse('2026-11-16T12:00:00Z'));
  const { fetchImpl, calls } = mockFetch([['scoreboard', BOARD], ['summary?event=401873063', FULL], ['summary?event=401873059', MIN]]);
  const out = await G.listGames({ sport: 'nfl', when: 'recent' }, { fetchImpl, now });
  assert.deepEqual(Object.keys(out).sort(), Object.keys(shape).filter(k => k !== '_note').sort());
  assert.equal(out.date, null);
  const g0 = out.games[0];
  assert.deepEqual(Object.keys(g0).sort(), Object.keys(shape.games[0]).sort());
  assert.deepEqual(Object.keys(g0.status).sort(), Object.keys(shape.games[0].status).sort());
  assert.deepEqual(Object.keys(g0.teams.home).sort(), ['abbr', 'name', 'score']);
  assert.equal(out.games.length, 4);
  // 3 scoreboard days for "recent".
  assert.equal(calls.filter(c => c.url.includes('scoreboard')).length, 3);
  // SF at DAL has a real digest -> drama + spark; it sorts above games without one.
  assert.equal(g0.id, '401873063');
  assert.ok(g0.drama > 0 && g0.drama <= 1);
  assert.ok(Array.isArray(g0.wpSpark) && g0.wpSpark.length <= 24);
  const firstNull = out.games.findIndex(g => g.drama == null);
  assert.ok(out.games.slice(firstNull).every(g => g.drama == null), 'null drama last');
  out.games.forEach((g, i) => { if (i && g.drama != null) assert.ok(g.drama <= out.games[i - 1].drama); });
  // A week later the same games are no longer "recent".
  G._test._reset();
  const later = await G.listGames({ sport: 'nfl', when: 'recent' }, { fetchImpl, now: () => Date.parse('2026-11-25T12:00:00Z'), warm: false });
  assert.equal(later.games.length, 0);
  // Date mode needs a date.
  assert.equal((await G.listGames({ sport: 'nfl', when: 'date', date: 'x' }, {})).status, 400);
  const dated = await G.listGames({ sport: 'nfl', when: 'date', date: '20261115' }, { fetchImpl, now, warm: false });
  assert.equal(dated.date, '20261115');
  assert.ok(calls.at(-1).url.includes('dates=20261115'));
});

await test('athlete: search (active + retired top-up, sport-filtered) and career stats by id', async () => {
  const A = fx('espn-athlete-3139477.min.json');
  const wide = { items: [{ id: '122277', displayName: 'Tom Brady', sport: 'rugby', type: 'player' }, { id: '2330', displayName: 'Tom Brady', sport: 'football', league: 'nfl', position: { abbreviation: 'QB' }, label: 'NFL - Tampa Bay Buccaneers' }] };
  const { fetchImpl, calls } = mockFetch([
    ['search?query=tom%20brady&type=player&sport=football', { items: [] }],
    ['search?query=tom%20brady&type=player&limit=20', wide],
    ['search?query=patrick', A.search],
    ['athletes/3139477/stats', A.stats],
    ['athletes/3139477', A.info],
  ]);
  const ctx = { fetchImpl, now: () => Date.parse('2026-11-18T04:00:00Z') };
  const brady = await G.athlete({ sport: 'nfl', query: 'tom brady' }, ctx);
  assert.deepEqual(brady.candidates.map(c => [c.athleteId, c.name, c.position]), [['2330', 'Tom Brady', 'QB']], 'the rugby player is filtered out');
  const shape = fx('athlete-search.response.json');
  assert.deepEqual(Object.keys(brady.candidates[0]).filter(k => k !== 'team').sort(), Object.keys(shape.candidates[0]).sort());
  const m = await G.athlete({ sport: 'nfl', query: 'patrick mahomes' }, ctx);
  assert.equal(m.candidates[0].athleteId, '3139477');
  const stats = await G.athlete({ sport: 'nfl', athleteId: '3139477' }, ctx);
  assert.equal(stats.ok, true);
  const a = stats.athlete;
  assert.deepEqual([a.name, a.position, a.stats.category], ['Patrick Mahomes', 'QB', 'passing']);
  assert.ok(T.validateTimeline({ v: 2, beats: [], data: { athlete: a } }).ok);
  assert.equal(a.stats.seasons[0].id, 's2017');
  assert.equal(a.stats.totals[4], '38,324', 'display strings kept, never recomputed');
  const n = calls.length;
  await G.athlete({ sport: 'nfl', athleteId: '3139477' }, ctx);
  assert.equal(calls.length, n, 'athlete data cached 24 h');
  assert.equal((await G.athlete({ sport: 'nfl', athleteId: 'abc' }, ctx)).status, 400);
});

await test('athlete stats: the Brady excerpt reads into the contract athlete fixture', () => {
  const ex = fx('espn-athlete-2330-stats.excerpt.json');
  const c = ex.category0;
  const stats = { categories: [{ name: c.name, labels: c.labels, names: c.names, statistics: [...c.firstSeasons, c.lastSeason], totals: c.totals }] };
  const want = fx('athlete-2330.response.json').athlete;
  const got = G.readAthleteStats(stats, { displayName: 'Tom Brady', position: { abbreviation: 'QB' } }, { sport: 'nfl', athleteId: '2330', now: () => Date.parse(want.fetchedAt), url: want.source.url });
  const { trimmed, ...rest } = want;
  assert.deepEqual(got, rest);
});

await test('MLB StatsAPI: off by default; with REELS_DATA_MLB_STATSAPI=fallback it rescues an ESPN failure', async () => {
  const feed = {
    gameData: { teams: { home: { id: 139, abbreviation: 'TB', name: 'Tampa Bay Rays' }, away: { id: 158, abbreviation: 'MIL', name: 'Milwaukee Brewers' } }, status: { abstractGameState: 'Final', detailedState: 'Final' }, datetime: { dateTime: '2026-10-29T00:08:00Z' } },
    liveData: {
      linescore: fx('mlb-linescore-849799.json'),
      plays: { allPlays: [
        { result: { description: 'Turang scored.', event: 'Single', homeScore: 0, awayScore: 1 }, about: { atBatIndex: 0, inning: 2, halfInning: 'top', isScoringPlay: true, startTime: '2026-10-29T00:32:22Z' } },
        { result: { description: 'Hicks scored.', event: 'Double', homeScore: 1, awayScore: 4 }, about: { atBatIndex: 1, inning: 9, halfInning: 'bottom', isScoringPlay: true, startTime: '2026-10-29T03:01:00Z' } },
      ] },
    },
  };
  const wp = [{ atBatIndex: 0, homeTeamWinProbability: 40.2 }, { atBatIndex: 1, homeTeamWinProbability: 0 }];
  const { fetchImpl, calls } = mockFetch([['espn.com', () => json({}, 500)], ['feed/live', feed], ['winProbability', wp]]);
  const off = await G.gameData({ sport: 'mlb', eventId: '401908046', gamePk: '849799' }, { fetchImpl, env: {} });
  assert.equal(off.reason, 'data-unavailable');
  assert.equal(calls.some(c => c.url.includes('statsapi')), false, 'StatsAPI is never called while off');
  G._test._reset();
  const on = await G.gameData({ sport: 'mlb', eventId: '401908046', gamePk: '849799' }, { fetchImpl, env: { REELS_DATA_MLB_STATSAPI: 'fallback' } });
  assert.equal(on.ok, true);
  assert.equal(on.digest.provider, 'mlb-statsapi');
  assert.equal(on.digest.attribution, 'Win probability: MLB');
  assert.equal(on.digest.wp.points[0][1], 0.402, 'percentages divided by 100');
  assert.ok(T.validateDigest(on.digest).ok, JSON.stringify(T.validateDigest(on.digest).errors));
  assert.equal(G.cfbdEnabled({ CFBD_API_KEY: 'x' }), false, 'CFBD stays stubbed off');
});

await test('library clips: matched by wallclock window + team handle; unsure clips left out', async () => {
  const d = G.digestGame(FULL, { sport: 'nfl', eventId: '401873063' });
  const td = d.plays.find(p => p.scoring && p.team === 'away' && /McCaffrey 66/.test(p.text));
  const at = Date.parse(td.wallclock);
  const library = { read: async ({ sport, teams }) => {
    assert.equal(sport, 'nfl');
    assert.deepEqual(teams, ['Dallas Cowboys', 'San Francisco 49ers']);
    return [
      { url: 'https://x.com/49ers/status/1', handle: '49ers', text: 'McCaffrey to the house!', postedAt: new Date(at + 150e3).toISOString(), variants: [{ url: 'https://video.twimg.com/a.mp4', width: 720, height: 1280 }, { url: 'javascript:x' }], durationMs: 12000, sourceKind: 'team' },
      { url: 'https://x.com/someone/status/2', handle: 'someone', text: 'wow', postedAt: new Date(at + 3600e3).toISOString() },
    ];
  } };
  const out = await G.matchLibraryClips(d, { library, now: () => at + 7200e3 });
  assert.equal(out.length, 1);
  assert.equal(out[0].playId, td.id);
  assert.ok(out[0].confidence >= 0.6);
  // The page loads the clip from these (variants) and the plan re-matches it (text).
  assert.equal(out[0].text, 'McCaffrey to the house!');
  assert.deepEqual(out[0].variants.map(v => v.url), ['https://video.twimg.com/a.mp4']);
  assert.deepEqual([out[0].durationMs, out[0].sourceKind], [12000, 'team']);
});

await test('shortenText: abbreviations ("Sr.", initials) are not sentence ends (live 2026-11-18 digests)', () => {
  const t = 'Deebo Samuel Sr. 11 Yd pass from Brock Purdy (Eddy Pineiro Kick)';
  assert.equal(G.shortenText(t, 80), t);
  assert.equal(G.shortenText(t, 60), 'Deebo Samuel Sr. 11 Yd pass from Brock Purdy (Eddy Pineiro…');
  assert.equal(G.shortenText('Pass to J. Smith for 5 yards. Tackled by K. Jones at the 20 and more words here.', 60), 'Pass to J. Smith for 5 yards.');
});

console.log(`\n${passed} passed`);
