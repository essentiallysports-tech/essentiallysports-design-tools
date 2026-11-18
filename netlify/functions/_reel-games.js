'use strict';
// Reels Studio game data (contract: project-docs/reels-formats-contract.md §2,
// §3.1, §3.2). No AI. Server-side only: the browser never calls ESPN.
//
//   listGames(body, ctx)    mode games:     live / recent (finals, last 48 h) /
//                                           a date; sorted by drama (null last)
//   gameData(body, ctx)     mode game-data: one game's GameDigest (<= 8 KB)
//   athlete(body, ctx)      mode athlete:   player search, or career stats by id
//   digestGame(summary, { sport, eventId, now })   ESPN summary -> GameDigest
//   statsapiDigest(...)     MLB StatsAPI -> GameDigest (REELS_DATA_MLB_STATSAPI=
//                           fallback only; MLBAM terms: non-commercial use)
//   matchLibraryClips(digest, { token })   clip library rows -> play matches
//
// Sources: ESPN's public site API (no key; undocumented, so every response
// goes through a schema check and a shape change fails soft with
// reason 'data-unavailable': the page falls back to the brief path).
// CollegeFootballData stays stubbed until the owner adds CFBD_API_KEY.
//
// Politeness: fetch with a timeout and a plain User-Agent (no contact data),
// one in-flight request per URL, and caches: game list live 15 s, other lists
// 60 s; a live digest 20 s, a final digest 7 days once the game ended 2 h
// ago (2 min before that); athlete data 24 h. A per-user limiter (30 a
// minute) protects ESPN from a stuck page.
const T = require('../../reel-timeline.js');
const D = require('../../reel-data.js');

const UA = 'FrameUp-Reels/1.0'; // ESPN's edge refuses agents with a URL in them (403, checked 2026-11-18)
const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const WEB = 'https://site.web.api.espn.com/apis/common/v3';
const STATSAPI = 'https://statsapi.mlb.com/api';
const LEAGUES = {
  nfl: { path: 'football/nfl', sport: 'football', league: 'nfl', board: '' },
  cfb: { path: 'football/college-football', sport: 'football', league: 'college-football', board: '&groups=80&limit=300' },
  mlb: { path: 'baseball/mlb', sport: 'baseball', league: 'mlb', board: '' },
  golf: { path: 'golf/pga', sport: 'golf', league: 'pga', board: '' },
};
const GAME_SPORTS = ['nfl', 'cfb', 'mlb'];
const TTL = {
  listLive: 15, list: 60,
  digestLive: 20, digestFresh: 120, digestFinal: 7 * 86400,
  athlete: 86400,
};
const LIMIT_PER_MIN = 30;
const MAX_GAMES = 60;
const RECENT_HOURS = 48;
const WARM_DIGESTS = 6; // per list request: finals or live games without a cached digest
const WARM_BUDGET_MS = 4500;
const FETCH_TIMEOUT_MS = 8000;
const SOFT = { ok: false, status: 502, reason: 'data-unavailable', error: 'Game data is unavailable; use the brief.' };

const clean = (v, n = 200) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const int = v => { const n = Number(String(v == null ? '' : v).replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n) : 0; };
const isoNow = now => new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
const r4 = v => Math.round(Number(v) * 1e4) / 1e4;

class SchemaError extends Error {}
const need = (cond, what) => { if (!cond) throw new SchemaError(`ESPN shape changed: ${what}`); };

// ─── Cache (memory, per warm instance) ──────────────────────────────────
// REELS_GAME_CACHE=supabase is reserved for the optional frameup_game_digests
// table (research §G.5); until that migration exists it behaves as memory.
function makeCache(max = 400) {
  const map = new Map();
  return {
    get(key, now) {
      const hit = map.get(key);
      if (!hit) return null;
      if (now >= hit.exp) { map.delete(key); return null; }
      return hit;
    },
    set(key, value, ttlSec, now) {
      map.delete(key);
      map.set(key, { value, exp: now + ttlSec * 1000, at: now, ttlSec });
      while (map.size > max) map.delete(map.keys().next().value);
    },
    clear() { map.clear(); },
    get size() { return map.size; },
  };
}
const CACHE = makeCache();
const INFLIGHT = new Map();
const HITS = new Map(); // email -> [timestamps]

function limited(email, now) {
  const key = String(email || 'anon').toLowerCase();
  const recent = (HITS.get(key) || []).filter(t => now - t < 60000);
  if (recent.length >= LIMIT_PER_MIN) { HITS.set(key, recent); return true; }
  recent.push(now);
  HITS.set(key, recent);
  if (HITS.size > 2000) HITS.delete(HITS.keys().next().value);
  return false;
}
const LIMITED = { ok: false, status: 429, reason: 'limit', error: 'Too many game data requests this minute. Try again shortly.' };

// ─── Fetch ──────────────────────────────────────────────────────────────
async function getJson(url, { fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  if (INFLIGHT.has(url)) return INFLIGHT.get(url);
  const run = (async () => {
    const response = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw Object.assign(new Error(`${new URL(url).hostname} ${response.status}`), { status: response.status });
    const text = await response.text();
    try { return JSON.parse(text); } catch { throw new SchemaError('not JSON'); }
  })();
  INFLIGHT.set(url, run);
  try { return await run; } finally { INFLIGHT.delete(url); }
}
const opts = ctx => ({ fetchImpl: (ctx && ctx.fetchImpl) || fetch });
const nowOf = ctx => (ctx && ctx.now) || Date.now;

// ─── Digest (contract §3.2, rules 1-6) ──────────────────────────────────
function shortenText(raw, max = T.LIMITS.playText) {
  const text = clean(raw, 2000);
  if (text.length <= max) return text;
  let cut = -1;
  // A sentence end, not an abbreviation: "Deebo Samuel Sr. 11 Yd pass" or "D. Greenlaw" keep going.
  const abbrev = i => text[i] === '.' && /(?:^|[\s(#-])(?:[A-Z]|Jr|Sr|St|Mt|vs|II|III|IV)$/.test(text.slice(Math.max(0, i - 5), i));
  for (let i = 0; i < max; i += 1) if (/[.!?]/.test(text[i]) && (i + 1 === text.length || text[i + 1] === ' ') && !abbrev(i)) cut = i;
  if (cut > 0) return text.slice(0, cut + 1);
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > 0 ? head.slice(0, space) : head).replace(/[\s,;:]+$/, '')}…`;
}
const stripParens = text => String(text || '').replace(/^\s*(?:\([^)]*\)\s*)+/, '');

// Downsample to <= max points, always keeping the first, the last, the min and the max.
function downsample(points, max) {
  if (points.length <= max) return points.slice();
  let imin = 0;
  let imax = 0;
  points.forEach((p, i) => { if (p[1] < points[imin][1]) imin = i; if (p[1] > points[imax][1]) imax = i; });
  const keep = new Set([0, points.length - 1, imin, imax]);
  const m = max - keep.size;
  for (let k = 1; k <= m; k += 1) keep.add(Math.round((k * (points.length - 1)) / (m + 1)));
  for (let i = 0; keep.size < max && i < points.length; i += 1) keep.add(i);
  return [...keep].sort((a, b) => a - b).slice(0, max).map(i => points[i]);
}

// Header + competitors, checked field by field.
function readHeader(summary) {
  need(summary && typeof summary === 'object', 'summary');
  const comp = summary.header && Array.isArray(summary.header.competitions) && summary.header.competitions[0];
  need(comp && Array.isArray(comp.competitors) && comp.competitors.length === 2, 'header.competitions[0].competitors');
  const side = which => {
    const c = comp.competitors.find(x => x && x.homeAway === which);
    need(c && c.team && c.team.abbreviation, `competitor ${which}`);
    return {
      id: String(c.team.id || c.id || ''),
      abbr: String(c.team.abbreviation).toUpperCase().replace(/[^A-Z0-9&]/g, '').slice(0, 5),
      name: clean(c.team.displayName || c.team.name || c.team.abbreviation, 80),
      score: int(c.score),
      linescore: (Array.isArray(c.linescores) ? c.linescores : []).map(l => int(l && (l.displayValue != null ? l.displayValue : l.value))),
    };
  };
  const st = comp.status || {};
  const type = st.type || {};
  need(['pre', 'in', 'post'].includes(type.state), 'status.type.state');
  return {
    comp,
    home: side('home'),
    away: side('away'),
    status: { state: type.state, final: Boolean(type.completed) && type.state === 'post', detail: clean(type.detail || type.description, 60), period: Number.isInteger(st.period) ? st.period : null, clock: clean(st.displayClock, 12) },
    startsAt: comp.date || (summary.header && summary.header.date) || null,
  };
}

// The flattened play list (rule 1): football drives.previous[].plays[] in
// order (plus the live drive, drives.current, while a game is on); MLB plays[].
function flatPlays(summary, sport) {
  if (sport === 'mlb') {
    need(summary.plays == null || Array.isArray(summary.plays), 'plays[]');
    return (summary.plays || []).filter(p => p && p.id);
  }
  const drives = summary.drives;
  if (drives == null) return []; // pregame
  need(typeof drives === 'object' && (drives.previous == null || Array.isArray(drives.previous)), 'drives.previous[]');
  const list = [];
  const seenDrives = new Set();
  (drives.previous || []).forEach(dr => { seenDrives.add(String(dr && dr.id)); (dr && Array.isArray(dr.plays) ? dr.plays : []).forEach(p => list.push(p)); });
  if (drives.current && !seenDrives.has(String(drives.current.id)) && Array.isArray(drives.current.plays)) drives.current.plays.forEach(p => list.push(p));
  const seen = new Set();
  return list.filter(p => p && p.id && !seen.has(String(p.id)) && seen.add(String(p.id)));
}

const TAG_ORDER = ['scoring', 'swing', 'lead-change', 'period-end', 'final'];
const leader = s => (s.home > s.away ? 'home' : (s.away > s.home ? 'away' : 'tie'));

function digestGame(summary, { sport, eventId, now = Date.now } = {}) {
  need(GAME_SPORTS.includes(sport), 'sport');
  const head = readHeader(summary);
  const raw = flatPlays(summary, sport);
  const seqOf = new Map(raw.map((p, i) => [String(p.id), i]));

  // Win probability (rule 2).
  const wpRaw = Array.isArray(summary.winprobability) ? summary.winprobability : [];
  const wpByPlay = new Map();
  let points = [];
  wpRaw.forEach((w, i) => {
    if (!w || typeof w.homeWinPercentage !== 'number') return;
    const v = r4(Math.max(0, Math.min(1, w.homeWinPercentage)));
    const seq = seqOf.get(String(w.playId));
    if (seq != null) { wpByPlay.set(String(w.playId), v); points.push([seq, v]); } else if (i === 0) points.push([-1, v]);
  });
  const bySeq = new Map();
  points.forEach(p => bySeq.set(p[0], p));
  points = [...bySeq.values()].sort((a, b) => a[0] - b[0]);
  points = downsample(points, T.LIMITS.wpPoints);

  // Every play: fields, swing, tags.
  const scoringText = new Map((Array.isArray(summary.scoringPlays) ? summary.scoringPlays : []).filter(s => s && s.id).map(s => [String(s.id), clean(s.text, 400)]));
  let prevWp = points.length && points[0][0] === -1 ? points[0][1] : null;
  let prevScore = { home: 0, away: 0 };
  const all = raw.map((p, seq) => {
    const period = Number(p.period && p.period.number) || 1;
    const half = sport === 'mlb' ? (/^bot/i.test(String(p.period && p.period.type)) ? 'bottom' : (/^top/i.test(String(p.period && p.period.type)) ? 'top' : null)) : null;
    const score = { home: int(p.homeScore), away: int(p.awayScore) };
    const wpHome = wpByPlay.has(String(p.id)) ? wpByPlay.get(String(p.id)) : null;
    const swing = wpHome != null && prevWp != null ? r4(wpHome - prevWp) : null;
    if (wpHome != null) prevWp = wpHome;
    const scoring = Boolean(p.scoringPlay);
    // College play text leads with the formation and jersey numbers ("No
    // Huddle-Shotgun #16 A.Manning ..."): drop them before the length cut so
    // the receiver and the gain fit (the play card cleans the rest).
    const text = scoring && scoringText.get(String(p.id)) ? shortenText(scoringText.get(String(p.id))) : shortenText(T.stripPlayNoise(stripParens(p.text)));
    let team = null;
    if (sport === 'mlb') team = half === 'top' ? 'away' : (half === 'bottom' ? 'home' : null);
    else {
      const tid = String(p.start && p.start.team && p.start.team.id || '');
      team = tid && tid === head.home.id ? 'home' : (tid && tid === head.away.id ? 'away' : null);
    }
    const start = p.start || {};
    const down = sport !== 'mlb' && Number(start.down) > 0 ? (clean(start.shortDownDistanceText, 24) || null) : null;
    const prevLead = leader(prevScore);
    const lead = leader(score);
    prevScore = score;
    const type = clean((sport === 'mlb' && p.alternativeType && p.alternativeType.text) || (p.type && p.type.text), 40);
    return {
      id: String(p.id), seq, period,
      clock: sport === 'mlb' ? '' : clean(p.clock && p.clock.displayValue, 12),
      half, text: text || type || 'Play', type, score,
      wallclock: p.wallclock && /^\d{4}-\d{2}-\d{2}T/.test(p.wallclock) ? String(p.wallclock) : null,
      wpHome, swing, scoring,
      down,
      yards: sport !== 'mlb' && Number.isFinite(Number(p.statYardage)) && p.statYardage != null ? Number(p.statYardage) : null,
      team,
      _lead: prevLead !== 'tie' && lead !== 'tie' && prevLead !== lead,
    };
  });
  // Tags (rule 4).
  const swingTop = new Set(all.filter(p => p.swing != null && Math.abs(p.swing) >= 0.05)
    .sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing) || a.seq - b.seq).slice(0, 12).map(p => p.seq));
  const lastOfPeriod = new Map();
  all.forEach(p => lastOfPeriod.set(p.period, p.seq));
  const periodEnds = new Set(lastOfPeriod.values());
  const last = all[all.length - 1];
  all.forEach(p => {
    const tags = new Set();
    if (p.scoring) tags.add('scoring');
    if (swingTop.has(p.seq)) tags.add('swing');
    if (p._lead) tags.add('lead-change');
    if (periodEnds.has(p.seq)) tags.add('period-end');
    if (p === last && head.status.final && p.score.home === head.home.score && p.score.away === head.away.score) tags.add('final');
    p.tags = TAG_ORDER.filter(t => tags.has(t));
    delete p._lead;
  });
  // Selection (rule 5).
  let kept = all.filter(p => p.tags.length);
  const only = (p, tag) => p.tags.length === 1 && p.tags[0] === tag;
  const dropWhile = (pick, order) => {
    const victims = kept.filter(pick).sort(order);
    while (kept.length > T.LIMITS.plays && victims.length) { const v = victims.shift(); kept = kept.filter(p => p !== v); }
  };
  dropWhile(p => only(p, 'swing'), (a, b) => Math.abs(a.swing) - Math.abs(b.swing) || a.seq - b.seq);
  dropWhile(p => only(p, 'period-end'), (a, b) => a.seq - b.seq);
  if (kept.length > T.LIMITS.plays) {
    const rank = p => (p.tags.includes('final') ? 4 : 0) + (p.tags.includes('lead-change') ? 2 : 0) + (p.scoring ? 1 : 0) + Math.abs(p.swing || 0);
    kept = kept.slice().sort((a, b) => rank(b) - rank(a) || a.seq - b.seq).slice(0, T.LIMITS.plays);
  }
  kept.sort((a, b) => a.seq - b.seq);

  const sportPath = LEAGUES[sport].path;
  const digest = {
    v: 1,
    provider: 'espn',
    sport,
    eventId: String(eventId),
    fetchedAt: isoNow(now),
    startsAt: head.startsAt || null,
    source: { name: 'ESPN', url: `${SITE}/${sportPath}/summary?event=${eventId}` },
    status: head.status,
    teams: { home: head.home, away: head.away },
    attribution: points.length ? T.ATTRIBUTION.espn : '',
    wp: points.length ? { team: 'home', points, count: wpRaw.length } : null,
    plays: kept,
  };
  return fitDigest(digest);
}

// Rule 6: shorten play text (80, then 60 chars), then halve the WP series,
// until <= 8 KB. One change from the letter of rule 6 (flagged in the
// report): the WP series is not halved below 60 points while plays that are
// only period ends or only swings can go first. A full NFL game keeps ~23
// tagged plays at ~300 bytes each, so halving alone left a 7-point WP line.
const WP_FLOOR = 60;
function fitDigest(digest) {
  const cap = T.LIMITS.digestBytes;
  const over = () => T.bytes(digest) > cap;
  if (!over()) return digest;
  for (const n of [80, 60]) {
    digest.plays.forEach(p => { p.text = shortenText(p.text, n); });
    if (!over()) return digest;
  }
  const halve = floor => {
    while (over() && digest.wp && digest.wp.points.length > floor) digest.wp.points = downsample(digest.wp.points, Math.max(floor, Math.floor(digest.wp.points.length / 2)));
  };
  halve(WP_FLOOR);
  const only = (p, tag) => p.tags.length === 1 && p.tags[0] === tag;
  const drop = (pick, order) => {
    const victims = digest.plays.filter(pick).sort(order);
    while (over() && victims.length) { const v = victims.shift(); digest.plays = digest.plays.filter(p => p !== v); }
  };
  drop(p => only(p, 'period-end'), (a, b) => a.seq - b.seq);
  drop(p => only(p, 'swing'), (a, b) => Math.abs(a.swing) - Math.abs(b.swing) || a.seq - b.seq);
  halve(4);
  drop(p => !p.tags.includes('final') && !p.tags.includes('lead-change'), (a, b) => Math.abs(a.swing || 0) - Math.abs(b.swing || 0) || a.seq - b.seq);
  drop(() => true, (a, b) => a.seq - b.seq);
  return digest;
}

function digestTtl(digest, now) {
  if (!digest.status.final) return digest.status.state === 'pre' ? TTL.list : TTL.digestLive;
  const lastWall = digest.plays.reduce((m, p) => Math.max(m, Date.parse(p.wallclock) || 0), 0);
  const ended = lastWall || Date.parse(digest.startsAt) + 4 * 3600e3 || 0;
  return ended && now() - ended > 2 * 3600e3 ? TTL.digestFinal : TTL.digestFresh;
}

// ─── MLB StatsAPI (fallback only, env-gated) ────────────────────────────
function statsapiEnabled(env = process.env) { return /^fallback$/i.test(String(env.REELS_DATA_MLB_STATSAPI || '').trim()); }
function statsapiDigest({ feed, winprob, gamePk, now = Date.now }) {
  need(feed && feed.liveData && feed.gameData, 'statsapi feed');
  const teams = feed.gameData.teams || {};
  const ls = feed.liveData.linescore || {};
  const side = which => ({
    id: String(teams[which] && teams[which].id || ''),
    abbr: String(teams[which] && teams[which].abbreviation || '').toUpperCase().slice(0, 5),
    name: clean(teams[which] && teams[which].name, 80),
    score: int(ls.teams && ls.teams[which] && ls.teams[which].runs),
    linescore: (Array.isArray(ls.innings) ? ls.innings : []).map(inn => int(inn[which] && inn[which].runs)),
  });
  const plays = (feed.liveData.plays && Array.isArray(feed.liveData.plays.allPlays)) ? feed.liveData.plays.allPlays : [];
  const status = feed.gameData.status || {};
  const final = /final|game over/i.test(String(status.abstractGameState || status.detailedState || ''));
  // Reuse the ESPN digest rules on an ESPN-shaped view of the feed.
  const espnLike = {
    header: { competitions: [{
      date: feed.gameData.datetime && feed.gameData.datetime.dateTime,
      status: { period: Number(ls.currentInning) || null, type: { state: final ? 'post' : (/live|progress/i.test(String(status.abstractGameState)) ? 'in' : 'pre'), completed: final, detail: clean(status.detailedState, 40) } },
      competitors: ['home', 'away'].map(w => { const t = side(w); return { homeAway: w, score: String(t.score), team: { id: t.id, abbreviation: t.abbr, displayName: t.name }, linescores: t.linescore.map(n => ({ displayValue: String(n) })) }; }),
    }] },
    plays: plays.map((p, i) => ({
      id: `${gamePk}-${p.about && p.about.atBatIndex != null ? p.about.atBatIndex : i}`,
      text: p.result && p.result.description,
      alternativeType: { text: p.result && p.result.event },
      homeScore: p.result && p.result.homeScore, awayScore: p.result && p.result.awayScore,
      period: { number: p.about && p.about.inning, type: p.about && p.about.halfInning === 'bottom' ? 'Bottom' : 'Top' },
      scoringPlay: Boolean(p.about && p.about.isScoringPlay),
      wallclock: p.about && p.about.startTime ? new Date(p.about.startTime).toISOString().replace(/\.\d{3}Z$/, 'Z') : null,
    })),
    winprobability: (Array.isArray(winprob) ? winprob : []).map(w => ({ playId: `${gamePk}-${w.atBatIndex}`, homeWinPercentage: Number(w.homeTeamWinProbability) / 100 })),
  };
  const digest = digestGame(espnLike, { sport: 'mlb', eventId: String(gamePk), now });
  digest.provider = 'mlb-statsapi';
  digest.source = { name: 'MLB StatsAPI', url: `${STATSAPI}/v1.1/game/${gamePk}/feed/live` };
  if (digest.wp) digest.attribution = T.ATTRIBUTION['mlb-statsapi'];
  return digest;
}

// CollegeFootballData: stubbed off (owner: no key yet). Kept as the hook the
// CFB fallback plugs into once CFBD_API_KEY exists.
function cfbdEnabled() { return false; } // flip to Boolean(env.CFBD_API_KEY) when the CFB fallback is built

// ─── Mode: game-data ────────────────────────────────────────────────────
async function loadDigest({ sport, eventId, gamePk }, ctx = {}) {
  const now = nowOf(ctx);
  const key = `digest:${sport}:${eventId}`;
  const hit = CACHE.get(key, now());
  if (hit) return { digest: hit.value, cached: true, ttlSec: Math.max(1, Math.round((hit.exp - now()) / 1000)) };
  try {
    const summary = await getJson(`${SITE}/${LEAGUES[sport].path}/summary?event=${encodeURIComponent(eventId)}`, opts(ctx));
    const digest = digestGame(summary, { sport, eventId, now });
    const check = T.validateDigest(digest);
    if (!check.ok) throw new SchemaError(`digest invalid: ${check.errors.slice(0, 2).map(e => `${e.path} ${e.msg}`).join('; ')}`);
    const ttl = digestTtl(digest, now);
    CACHE.set(key, digest, ttl, now());
    return { digest, cached: false, ttlSec: ttl };
  } catch (error) {
    if (sport === 'mlb' && gamePk && statsapiEnabled(ctx.env || process.env)) {
      const [feed, wp] = await Promise.all([
        getJson(`${STATSAPI}/v1.1/game/${gamePk}/feed/live`, opts(ctx)),
        getJson(`${STATSAPI}/v1/game/${gamePk}/winProbability`, opts(ctx)).catch(() => []),
      ]);
      const digest = statsapiDigest({ feed, winprob: wp, gamePk, now });
      digest.eventId = String(eventId);
      if (!T.validateDigest(digest).ok) throw error;
      const ttl = digestTtl(digest, now);
      CACHE.set(key, digest, ttl, now());
      return { digest, cached: false, ttlSec: ttl, fallback: 'mlb-statsapi' };
    }
    throw error;
  }
}
function cachedDigest(sport, eventId, now = Date.now()) {
  const hit = CACHE.get(`digest:${sport}:${eventId}`, now);
  return hit ? hit.value : null;
}

const EVENT_ID = /^[0-9]{5,12}$/;
async function gameData(body, ctx = {}) {
  const now = nowOf(ctx);
  const sport = String(body && body.sport || '');
  const eventId = String(body && body.eventId || '');
  if (!GAME_SPORTS.includes(sport)) return { ok: false, status: 400, error: 'Pick an NFL, college football or MLB game.' };
  if (!EVENT_ID.test(eventId)) return { ok: false, status: 400, error: 'That game id does not look right.' };
  if (limited(ctx.auth && ctx.auth.user && ctx.auth.user.email, now())) return LIMITED;
  const gamePk = /^[0-9]{4,8}$/.test(String(body.gamePk || '')) ? String(body.gamePk) : '';
  try {
    const out = await loadDigest({ sport, eventId, gamePk }, ctx);
    const result = { ok: true, digest: out.digest, cached: out.cached, ttlSec: out.ttlSec };
    // Optional (additive): clip-library matches for the digest's plays.
    if (body.clips === true) result.clipMatches = await matchLibraryClips(out.digest, ctx).catch(() => []);
    return result;
  } catch (error) {
    console.warn(`reel game-data ${sport} ${eventId}:`, String(error && error.message || error).slice(0, 200));
    return { ...SOFT };
  }
}

// ─── Mode: games ────────────────────────────────────────────────────────
const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
function readBoard(board, sport) {
  need(board && Array.isArray(board.events), 'scoreboard events[]');
  return board.events.map(e => {
    const comp = e && Array.isArray(e.competitions) && e.competitions[0];
    if (!comp || !Array.isArray(comp.competitors)) return null;
    const side = which => {
      const c = comp.competitors.find(x => x && x.homeAway === which);
      if (!c || !c.team) return null;
      return { abbr: String(c.team.abbreviation || '').toUpperCase(), name: clean(c.team.displayName || c.team.name, 80), score: int(c.score) };
    };
    const home = side('home');
    const away = side('away');
    const st = comp.status || e.status || {};
    const type = st.type || {};
    if (!home || !away || !['pre', 'in', 'post'].includes(type.state)) return null;
    return {
      id: String(e.id), sport, name: clean(e.name, 120), startsAt: e.date || comp.date || null,
      status: { state: type.state, final: Boolean(type.completed) && type.state === 'post', detail: clean(type.detail || type.shortDetail, 60), period: Number.isInteger(st.period) ? st.period : null, clock: clean(st.displayClock, 12) },
      teams: { home, away },
      drama: null, wpSpark: null,
    };
  }).filter(Boolean);
}
async function listGames(body, ctx = {}) {
  const now = nowOf(ctx);
  const sport = String(body && body.sport || '');
  const when = ['live', 'recent', 'date'].includes(body && body.when) ? body.when : 'recent';
  if (!GAME_SPORTS.includes(sport)) return { ok: false, status: 400, error: 'Pick NFL, college football or MLB.' };
  const date = when === 'date' ? String(body.date || '') : null;
  if (when === 'date' && !/^20\d{6}$/.test(date)) return { ok: false, status: 400, error: 'Pick a date (YYYYMMDD).' };
  if (limited(ctx.auth && ctx.auth.user && ctx.auth.user.email, now())) return LIMITED;
  const ttlSec = when === 'live' ? TTL.listLive : TTL.list;
  const key = `list:${sport}:${when}:${date || ''}`;
  let games;
  let updatedAt;
  const hit = CACHE.get(key, now());
  if (hit) ({ games, updatedAt } = hit.value);
  else {
    const lg = LEAGUES[sport];
    const days = when === 'date' ? [date] : (when === 'live' ? [null] : [0, 1, 2].map(k => ymd(now() - k * 86400e3)));
    try {
      const boards = await Promise.all(days.map(d => getJson(`${SITE}/${lg.path}/scoreboard?${d ? `dates=${d}` : ''}${lg.board}`.replace('?&', '?'), opts(ctx))));
      const seen = new Set();
      games = boards.flatMap(b => readBoard(b, sport)).filter(g => !seen.has(g.id) && seen.add(g.id));
    } catch (error) {
      console.warn(`reel games ${sport} ${when}:`, String(error && error.message || error).slice(0, 200));
      return { ok: false, status: 502, reason: 'data-unavailable', error: 'The game list is unavailable right now; use the brief.' };
    }
    if (when === 'live') games = games.filter(g => g.status.state === 'in');
    if (when === 'recent') {
      const since = now() - (RECENT_HOURS + 4) * 3600e3; // a game ends ~3-4 h after it starts
      games = games.filter(g => g.status.final && Date.parse(g.startsAt) >= since);
    }
    updatedAt = isoNow(now);
    CACHE.set(key, { games, updatedAt }, ttlSec, now());
  }

  // Drama: from cached digests; warm a few uncached ones (finals and live
  // games only, closest score first) inside a small time budget.
  games = games.map(g => ({ ...g, teams: { home: { ...g.teams.home }, away: { ...g.teams.away } } }));
  const margin = g => Math.abs(g.teams.home.score - g.teams.away.score);
  const cold = games.filter(g => g.status.state !== 'pre' && !cachedDigest(sport, g.id, now()))
    .sort((a, b) => margin(a) - margin(b)).slice(0, ctx.warm === false ? 0 : WARM_DIGESTS);
  if (cold.length) {
    const budget = new Promise(resolve => { const t = setTimeout(resolve, ctx.warmBudgetMs || WARM_BUDGET_MS); if (t.unref) t.unref(); });
    await Promise.race([Promise.allSettled(cold.map(g => loadDigest({ sport, eventId: g.id }, ctx))), budget]);
  }
  games.forEach(g => {
    const d = cachedDigest(sport, g.id, now());
    if (d) { g.drama = D.dramaScore(d); g.wpSpark = D.wpSpark(d, 24); }
  });
  const rank = g => (g.status.state === 'in' ? 0 : 1);
  games.sort((a, b) => {
    if (a.drama != null && b.drama != null) return b.drama - a.drama;
    if (a.drama != null) return -1;
    if (b.drama != null) return 1;
    return rank(a) - rank(b) || margin(a) - margin(b) || String(b.startsAt).localeCompare(String(a.startsAt));
  });
  return { ok: true, sport, when, date, updatedAt, ttlSec, games: games.slice(0, MAX_GAMES) };
}

// ─── Mode: athlete ──────────────────────────────────────────────────────
const POSITION_CATEGORY = { QB: 'passing', RB: 'rushing', FB: 'rushing', WR: 'receiving', TE: 'receiving', SP: 'pitching', RP: 'pitching', P: 'pitching' };
function readAthleteStats(stats, info, { sport, athleteId, now, url }) {
  need(stats && Array.isArray(stats.categories), 'athlete stats categories[]');
  const position = clean(info && info.position && info.position.abbreviation, 6);
  const cats = stats.categories.filter(c => c && Array.isArray(c.labels) && Array.isArray(c.statistics || c.firstSeasons));
  const wanted = POSITION_CATEGORY[position] || (sport === 'mlb' ? 'batting' : '');
  const cat = cats.find(c => c.name === wanted) || cats.slice().sort((a, b) => (b.statistics || []).length - (a.statistics || []).length)[0] || null;
  const teamAbbr = new Map(Object.values(stats.teams || {}).map(t => [String(t.id), String(t.abbreviation || '').toLowerCase()]));
  let block = null;
  if (cat) {
    const labels = cat.labels.slice(0, T.LIMITS.statLabels).map(String);
    const rows = (cat.statistics || cat.firstSeasons || []).filter(r => r && r.season && Number.isInteger(r.season.year) && Array.isArray(r.stats));
    const perYear = new Map();
    rows.forEach(r => perYear.set(r.season.year, (perYear.get(r.season.year) || 0) + 1));
    const seasons = rows.map(r => {
      const split = perYear.get(r.season.year) > 1;
      const tag = (teamAbbr.get(String(r.teamId)) || String(r.teamId || '')).replace(/[^a-z0-9]/g, '').slice(0, 8);
      return { id: split && tag ? `s${r.season.year}-${tag}` : `s${r.season.year}`, year: r.season.year, teamId: String(r.teamId || ''), team: clean(r.teamSlug, 60), stats: r.stats.slice(0, labels.length).map(String) };
    }).slice(-T.LIMITS.statRows);
    const ids = new Set();
    block = {
      category: String(cat.name || ''), labels,
      names: (cat.names || []).slice(0, labels.length).map(String),
      seasons: seasons.filter(s => !ids.has(s.id) && ids.add(s.id)),
      totals: Array.isArray(cat.totals) ? cat.totals.slice(0, labels.length).map(String) : null,
    };
  }
  return {
    v: 1, provider: 'espn', sport, athleteId: String(athleteId),
    name: clean(info && (info.displayName || info.fullName), 80) || '',
    position, fetchedAt: isoNow(now),
    source: { name: 'ESPN', url },
    stats: block,
  };
}
async function athlete(body, ctx = {}) {
  const now = nowOf(ctx);
  const sport = String(body && body.sport || '');
  if (!LEAGUES[sport]) return { ok: false, status: 400, error: 'Pick a sport.' };
  if (limited(ctx.auth && ctx.auth.user && ctx.auth.user.email, now())) return LIMITED;
  const lg = LEAGUES[sport];
  const id = String(body.athleteId || '');
  try {
    if (id) {
      if (!/^[0-9]{1,12}$/.test(id)) return { ok: false, status: 400, error: 'That player id does not look right.' };
      const key = `athlete:${sport}:${id}`;
      const hit = CACHE.get(key, now());
      if (hit) return { ok: true, athlete: hit.value, cached: true };
      const url = `${WEB}/sports/${lg.path}/athletes/${id}/stats`;
      const [stats, info] = await Promise.all([getJson(url, opts(ctx)), getJson(`${WEB}/sports/${lg.path}/athletes/${id}`, opts(ctx)).catch(() => null)]);
      const out = readAthleteStats(stats, info && (info.athlete || info), { sport, athleteId: id, now, url });
      if (!out.name) out.name = clean(body.name, 80);
      CACHE.set(key, out, TTL.athlete, now());
      return { ok: true, athlete: out, cached: false };
    }
    const query = clean(body.query, 60);
    if (query.length < 2) return { ok: false, status: 400, error: 'Type a player name.' };
    const key = `search:${sport}:${query.toLowerCase()}`;
    const hit = CACHE.get(key, now());
    if (hit) return { ok: true, candidates: hit.value, cached: true };
    const q = encodeURIComponent(query);
    // Active players: the league-scoped search. Retired players drop out of
    // it, so a short list is topped up from the unscoped search, filtered to
    // the sport (it also returns other sports' players with the same name).
    const scoped = await getJson(`${WEB}/search?query=${q}&type=player&sport=${lg.sport}&league=${lg.league}&limit=8`, opts(ctx));
    need(scoped && Array.isArray(scoped.items), 'search items[]');
    let items = scoped.items;
    if (items.length < 8) {
      const wide = await getJson(`${WEB}/search?query=${q}&type=player&limit=20`, opts(ctx)).catch(() => null);
      (wide && Array.isArray(wide.items) ? wide.items : []).forEach(i => { if (i && i.sport === lg.sport && (!i.league || i.league === lg.league) && !items.some(x => x.id === i.id)) items = [...items, i]; });
    }
    const candidates = items.filter(i => i && i.id && i.displayName).slice(0, 8).map(i => ({
      athleteId: String(i.id), name: clean(i.displayName, 80), sport,
      position: clean(i.position && i.position.abbreviation, 6),
      years: '',
      team: clean(String(i.label || '').replace(/^[A-Z]+\s*-\s*/, ''), 60),
    }));
    CACHE.set(key, candidates, TTL.athlete, now());
    return { ok: true, candidates, cached: false };
  } catch (error) {
    console.warn(`reel athlete ${sport}:`, String(error && error.message || error).slice(0, 200));
    return { ok: false, status: 502, reason: 'data-unavailable', error: 'Player data is unavailable right now; use the brief.' };
  }
}

// ─── Clip matching (Game Swing) ─────────────────────────────────────────
// Library clips posted during the game (+15 min) -> the play each shows.
// Unsure matches are left out: those beats keep their photo.
function teamHandles(digest) {
  let SRC = null;
  try { SRC = require('../../video-ads-sources.js'); } catch { SRC = null; }
  const side = t => ({ name: t.name, handles: SRC ? [SRC.handleFor(t.name)].filter(Boolean) : [] });
  const neutral = SRC ? [...SRC.sourcesFor(digest.sport).league, ...SRC.sourcesFor(digest.sport).media] : [];
  return { teams: { home: side(digest.teams.home), away: side(digest.teams.away) }, neutralHandles: neutral };
}
async function matchLibraryClips(digest, ctx = {}) {
  const lib = ctx.library || require('./_clip-library.js');
  const walls = digest.plays.map(p => Date.parse(p.wallclock)).filter(Number.isFinite);
  if (!walls.length) return [];
  const since = Math.min(...walls);
  const hours = Math.max(1, Math.ceil((nowOf(ctx)() - since) / 3600e3) + 1);
  const clips = await lib.read({ sport: digest.sport, teams: [digest.teams.home.name, digest.teams.away.name], sinceHours: Math.min(hours, 7 * 24), limit: 200, token: ctx.token || '' });
  const hint = teamHandles(digest);
  const out = [];
  (Array.isArray(clips) ? clips : []).forEach(c => {
    const m = D.matchClipToPlay(c, digest.plays, hint);
    // What the page needs to load the clip (variants) and the plan to re-match it (text).
    if (m && m.sure) {
      out.push({
        playId: m.playId, url: c.url, handle: c.handle || '', text: String(c.text || '').slice(0, 280), postedAt: c.postedAt,
        lagSec: m.lagSec, confidence: m.confidence, reasons: m.reasons,
        variants: (Array.isArray(c.variants) ? c.variants : []).filter(v => v && /^https:\/\//.test(String(v.url || ''))).slice(0, 6),
        thumb: c.thumb || '', durationMs: Number(c.durationMs) || 0, sourceKind: c.sourceKind || c.source || '',
      });
    }
  });
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 30);
}

function _reset() { CACHE.clear(); INFLIGHT.clear(); HITS.clear(); }

module.exports = {
  listGames, gameData, athlete, digestGame, statsapiDigest, statsapiEnabled, cfbdEnabled, loadDigest, cachedDigest,
  matchLibraryClips, teamHandles, readBoard, readAthleteStats, shortenText, downsample, fitDigest, digestTtl,
  SchemaError, TTL, LIMIT_PER_MIN, UA, SOFT,
  _test: { CACHE, INFLIGHT, HITS, _reset, limited, getJson },
};
