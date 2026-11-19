'use strict';
// Video Ads clip source: official sites, free, no keys (id 'sites').
//
// Why: the X-based searches (Haiku web search, Grok) find plenty of NFL but
// few college football and MLB clips: web indexes barely cover fresh X posts
// from college programs, and MLB is in its offseason. The league / network
// sites publish every play as its own HD clip, with a timestamp and team tags:
//
//   cfb  ESPN (network). The site API's scoreboard (this week + last week,
//        FBS) -> finished games -> each game's summary `videos` (one clip
//        per touchdown, interception, big play), MP4 on espnmedia-cdn
//        (1080p, CORS *; the size is read from the file's header by
//        video-ads.js checkMedia, never assumed).
//   mlb  MLB.com (league). statsapi.mlb.com schedule -> finished games ->
//        each game's content `highlights` (MP4 on mlb-cuts-diamond.mlb.com,
//        CORS *; the size is in the file name, e.g. _1280x720_). Offseason:
//        the window is wider (video-ads.js windowFor), and when no game was
//        played in it, the last games of the season are returned, flagged
//        `lastGames` so the page labels them.
//   nfl  nothing: NFL search is unchanged (the owner is happy with it).
//
// Candidates follow the shared clip-source shape (url = the clip's page on the
// site, mediaUrl = the MP4). Every one is still verified in video-ads.js
// (checkMedia + assessClip: trusted host, freshness, 720p, 4-120 s, game action).
// Measured live 2026-11-19 (see project-docs/ai-edit-log.md). Note: ESPN's
// edge refuses a User-Agent containing "+https://…", so this module sends the
// plain product token.
//
// Env: CLIPS_SITES=off switches the source off (CLIPS_EXTRA_SOURCES=off too).

const TEAMS = require('../../video-ads-teams.js');

const UA = 'FrameUp/1.0';
const TIMEOUT_MS = 6000;
const LIST_TTL_MS = 15 * 60e3; // scoreboards / schedules
const GAME_TTL_MS = 6 * 3600e3; // a finished game's clips do not change
const LIMITS = { games: 6, perTeamGames: 3, perGame: 12, lastGamesDays: 150 };
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
const MLB = 'https://statsapi.mlb.com/api/v1';

const off = v => /^(off|0|false|no|disabled)$/i.test(String(v ?? '').trim());
const configured = env => !off((env || process.env).CLIPS_SITES);

// ── Cache + fetch ─────────────────────────────────────────────────────────
const CACHE = new Map();
// keep(value): whether to cache it (MLB's content API sometimes answers with
// empty highlights for a moment; those are not cached, so the next ask retries).
async function getJson(url, ttl, diag, keep = () => true) {
  const hit = CACHE.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  diag.requests = (diag.requests || 0) + 1;
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) { diag.httpErrors = (diag.httpErrors || 0) + 1; return null; }
  const value = await response.json().catch(() => null);
  if (value && keep(value)) {
    if (CACHE.size > 300) CACHE.delete(CACHE.keys().next().value);
    CACHE.set(url, { at: Date.now(), value });
  }
  return value;
}

// ── Teams ─────────────────────────────────────────────────────────────────
const teamName = t => (typeof t === 'string' ? t : t?.name || '');
const cfbTeams = () => TEAMS.TEAMS.filter(t => t.sport === 'cfb');
// ESPN team id (the logo key, /ncaa/500/<id>.png) -> registry team.
function espnIdMap() {
  const map = new Map();
  cfbTeams().forEach(t => { const id = String(t.logo || '').match(/\/ncaa\/500\/(\d+)\.png$/)?.[1]; if (id) map.set(id, t); });
  return map;
}
// The teams a request is about: picked teams, else teams named in the query.
function askedTeams(sport, { team, teams = [], query = '' }) {
  const names = [team, ...(Array.isArray(teams) ? teams : [])].map(teamName).filter(Boolean);
  const list = names.map(n => TEAMS.findTeam(n, sport)).filter(Boolean);
  if (list.length || !query) return list;
  const text = String(query).toLowerCase();
  const named = TEAMS.TEAMS.filter(t => t.sport === sport && [t.name, t.short].some(n => new RegExp(`(?<![\\p{L}\\p{N}])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(text)));
  return named.sort((a, b) => b.name.length - a.name.length).slice(0, 2);
}

const durMs = value => {
  if (typeof value === 'number') return value * 1000;
  const parts = String(value || '').split(':').map(Number);
  if (!parts.length || parts.some(n => !Number.isFinite(n))) return 0;
  return parts.reduce((sum, n) => sum * 60 + n, 0) * 1000;
};
const inWindow = (iso, sinceHours, now) => {
  const at = Date.parse(iso || '');
  return Number.isFinite(at) && at <= now + 3600e3 && now - at <= sinceHours * 3600e3;
};

// ── College football: ESPN ────────────────────────────────────────────────
async function espnGames(diag) {
  const current = await getJson(`${ESPN}/scoreboard?groups=80&limit=200`, LIST_TTL_MS, diag);
  const events = [...(current?.events || [])];
  const week = Number(current?.week?.number);
  const type = Number(current?.season?.type) || 2;
  const year = Number(current?.season?.year);
  if (week > 1 && year) {
    const last = await getJson(`${ESPN}/scoreboard?groups=80&limit=200&dates=${year}&seasontype=${type}&week=${week - 1}`, LIST_TTL_MS, diag);
    events.push(...(last?.events || []));
  }
  return events;
}

function pickEspnGames(events, asked, { sinceHours, now }) {
  const ids = espnIdMap();
  const askedIds = new Set(asked.map(t => [...ids.entries()].find(([, v]) => v === t)?.[0]).filter(Boolean));
  const seen = new Set();
  const games = events
    .filter(e => e?.status?.type?.completed && inWindow(e.date, sinceHours + 12, now))
    .filter(e => (seen.has(e.id) ? false : seen.add(e.id)))
    .map(e => {
      const comps = e.competitions?.[0]?.competitors || [];
      const teamIds = comps.map(c => String(c?.team?.id || ''));
      const rank = Math.min(...comps.map(c => Number(c?.curatedRank?.current) || 99));
      return { id: String(e.id), date: e.date, teamIds, rank, known: teamIds.filter(id => ids.has(id)).length };
    });
  if (askedIds.size) {
    return games.filter(g => g.teamIds.some(id => askedIds.has(id)))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .slice(0, Math.max(LIMITS.perTeamGames, askedIds.size * 2));
  }
  // Sport-wide: games with a team we know (power conferences + top programs),
  // ranked teams first, then the newest.
  return games.filter(g => g.known > 0)
    .sort((a, b) => (a.rank <= 25 ? 0 : 1) - (b.rank <= 25 ? 0 : 1) || Date.parse(b.date) - Date.parse(a.date))
    .slice(0, LIMITS.games);
}

function espnCandidates(summary, game) {
  const ids = espnIdMap();
  const gameTeams = game.teamIds.map(id => ids.get(id)?.name).filter(Boolean);
  return (summary?.videos || []).slice(0, LIMITS.perGame).map(v => {
    const src = v?.links?.source || {};
    const mediaUrl = src.HD?.href || src.mezzanine?.href || src.href || '';
    const page = v?.links?.web?.href || '';
    if (!mediaUrl || !/\.mp4(?:$|\?)/.test(mediaUrl) || !page) return null;
    const tagged = (v.categories || []).filter(c => c?.type === 'team' && c.teamId).map(c => ids.get(String(c.teamId))?.name).filter(Boolean);
    return {
      url: page,
      platform: 'espn',
      handle: '',
      siteName: 'ESPN',
      sourceKind: 'media',
      postedAt: v.originalPublishDate || v.lastModified || null,
      text: String(v.headline || v.title || '').slice(0, 280),
      mediaUrl,
      thumb: v.thumbnail || v.posterImages?.default?.href || null,
      durationMs: durMs(v.duration),
      width: null, height: null, // read from the file header (checkMedia)
      teams: [...new Set(tagged.length ? tagged : gameTeams)],
    };
  }).filter(Boolean);
}

async function searchCfb(opts, diag) {
  const asked = askedTeams('cfb', opts);
  const games = pickEspnGames(await espnGames(diag), asked, opts);
  diag.games = games.length;
  const summaries = await Promise.all(games.map(g => getJson(`${ESPN}/summary?event=${g.id}`, GAME_TTL_MS, diag, v => Array.isArray(v?.videos) && v.videos.length > 0).catch(() => null)));
  return summaries.flatMap((s, i) => espnCandidates(s, games[i]));
}

// ── MLB: MLB.com (statsapi) ───────────────────────────────────────────────
const ymd = ms => new Date(ms).toISOString().slice(0, 10);
async function mlbGames(sinceHours, now, diag) {
  const data = await getJson(`${MLB}/schedule?sportId=1&startDate=${ymd(now - sinceHours * 3600e3)}&endDate=${ymd(now)}`, LIST_TTL_MS, diag);
  return (data?.dates || []).flatMap(d => d.games || []);
}
const isFinal = g => g?.status?.abstractGameState === 'Final' || /^final|game over|completed/i.test(g?.status?.detailedState || '');

function pickMlbGames(games, asked) {
  const names = new Set(asked.map(t => t.name));
  const done = games.filter(isFinal).sort((a, b) => Date.parse(b.gameDate) - Date.parse(a.gameDate));
  const mine = names.size ? done.filter(g => names.has(g.teams?.away?.team?.name) || names.has(g.teams?.home?.team?.name)) : done;
  return mine.slice(0, names.size ? Math.max(LIMITS.perTeamGames, names.size * 2) : LIMITS.games);
}

function mlbCandidates(content, game, { lastGames = false } = {}) {
  const items = content?.highlights?.highlights?.items || [];
  const gameTeams = [game.teams?.away?.team?.name, game.teams?.home?.team?.name].filter(n => TEAMS.findTeam(n, 'mlb'));
  return items.map(item => {
    const mp4 = (item.playbacks || []).find(p => p.name === 'mp4Avc') || (item.playbacks || []).find(p => /\.mp4$/.test(p.url || ''));
    const size = String(mp4?.url || '').match(/_(\d{3,4})x(\d{3,4})_/);
    const ms = durMs(item.duration);
    if (!mp4 || !size || ms < 4000 || ms > 120000 || !item.slug) return null;
    const cuts = item.image?.cuts || [];
    const thumb = (cuts.find(c => Number(c.width) >= 600 && Number(c.width) <= 1000) || cuts[0] || {}).src || null;
    const tagged = (item.keywordsAll || []).filter(k => k.type === 'team_id').map(k => k.displayName).filter(n => TEAMS.findTeam(n, 'mlb'));
    return {
      url: `https://www.mlb.com/video/${item.slug}`,
      platform: 'mlb',
      handle: '',
      siteName: 'MLB.com',
      sourceKind: 'league',
      postedAt: item.date || null,
      text: String(item.headline || item.title || '').slice(0, 280),
      mediaUrl: mp4.url,
      thumb,
      durationMs: ms,
      width: Number(size[1]), height: Number(size[2]),
      teams: [...new Set(tagged.length ? tagged : gameTeams)],
      ...(lastGames ? { lastGames: true } : {}),
    };
  }).filter(Boolean).slice(0, LIMITS.perGame);
}

async function searchMlb(opts, diag) {
  const asked = askedTeams('mlb', opts);
  let games = pickMlbGames(await mlbGames(opts.sinceHours, opts.now, diag), asked);
  let lastGames = false;
  // Nothing played in the window (deep offseason): the last games of the season.
  if (!games.length && opts.allowLastGames !== false) {
    const older = pickMlbGames(await mlbGames(LIMITS.lastGamesDays * 24, opts.now, diag), asked);
    games = older.slice(0, asked.length ? LIMITS.perTeamGames : 3);
    lastGames = games.length > 0;
    diag.lastGames = lastGames;
  }
  diag.games = games.length;
  const contents = await Promise.all(games.map(g => getJson(`${MLB}/game/${g.gamePk}/content`, GAME_TTL_MS, diag, v => (v?.highlights?.highlights?.items || []).length > 0).catch(() => null)));
  return contents.flatMap((c, i) => mlbCandidates(c, games[i], { lastGames }));
}

// ── search() ──────────────────────────────────────────────────────────────
async function search({ sport, team, teams = [], query = '', sinceHours = 120, limit = 25, env, now = Date.now(), allowLastGames } = {}) {
  const diag = { requests: 0, games: 0, found: 0 };
  if (!configured(env) || !['cfb', 'mlb'].includes(sport)) return { candidates: [], cost: 0, diag: { ...diag, skipped: sport || 'none' } };
  const opts = { team, teams, query, sinceHours: Math.max(1, Number(sinceHours) || 120), now, allowLastGames };
  let list = [];
  try {
    list = sport === 'cfb' ? await searchCfb(opts, diag) : await searchMlb(opts, diag);
  } catch (error) {
    diag.error = String(error?.message || error).slice(0, 120);
  }
  // Only clips inside the window (last-games clips carry their own flag).
  const fresh = list.filter(c => c.lastGames || inWindow(c.postedAt, opts.sinceHours, now));
  diag.tooOld = list.length - fresh.length;
  // Asked teams' clips first, then the newest; one per page URL.
  const asked = new Set(askedTeams(sport, opts).map(t => t.name));
  const seen = new Set();
  const candidates = fresh
    .filter(c => (seen.has(c.url) ? false : seen.add(c.url)))
    .sort((a, b) => (b.teams.some(t => asked.has(t)) ? 1 : 0) - (a.teams.some(t => asked.has(t)) ? 1 : 0) || Date.parse(b.postedAt) - Date.parse(a.postedAt))
    .slice(0, Math.max(1, Math.min(40, Number(limit) || 25)));
  diag.found = candidates.length;
  return { candidates, cost: 0, diag };
}

module.exports = {
  id: 'sites',
  paid: false,
  configured,
  search,
  _test: { CACHE, LIMITS, espnIdMap, askedTeams, pickEspnGames, espnCandidates, pickMlbGames, mlbCandidates, durMs, reset() { CACHE.clear(); } },
};
