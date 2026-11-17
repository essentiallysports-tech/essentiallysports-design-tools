// Free, public clip sources for Video Ads "Find a clip" (no paid keys).
//
// Sub-sources, each matching the shared clip-source interface
// (scratchpad clips-contract.md): { id, configured(env), search(opts) }.
//   reddit   – sports subreddits (r/nfl, r/CFB, r/baseball, r/MLB, r/golf,
//              team subs). Media: v.redd.it, streamable.com, X links.
//              App-only OAuth when REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are
//              set; otherwise the public .json listings, best-effort (Reddit
//              blocks many server IPs with a 403, so we back off for 30 min).
//   bluesky  – public AppView: author feeds of accounts that post sports video
//              (incl. mirror bots of official X accounts, whose X links become
//              X candidates) + post search (best-effort unauthenticated, or
//              authenticated with BLUESKY_HANDLE / BLUESKY_APP_PASSWORD).
//              Media: the original upload via com.atproto.sync.getBlob on the
//              author's PDS (video/mp4, CORS *), HLS playlist kept as hlsUrl.
// Streamable is a media host, resolved for links found in either source.
//
// Measured 2026-11-17 (see project-docs/clips-public.md). Every media host used
// here answers `Access-Control-Allow-Origin: *`, so the browser downloads the
// MP4 directly; the server never touches video bytes.
//
// Exports: the combined source (id 'public') + `sources` [reddit, bluesky] +
// each sub-source by name + `_test` internals.
'use strict';

const USER_AGENT = 'FrameUp/1.0 (+https://frameup.essentiallysports.com)';
const CACHE_MS = 12 * 60e3; // listings: 10–15 min
const LONG_CACHE_MS = 24 * 3600e3; // DID -> PDS
const TIMEOUT_MS = 8000;
// 720p floor: the shared Video Ads constant (CLIP_MIN_SHORT_SIDE in _clip-library.js).
const QUALITY = { minShortSide: 720, minSeconds: 4, maxSeconds: 120 };
const MAX_BYTES_SERVER_STREAM = 4 * 1024 * 1024;

let SOURCES = null;
try { SOURCES = require('../../video-ads-sources.js'); } catch { SOURCES = null; }
let TEAMS = null;
try { TEAMS = require('../../video-ads-teams.js'); } catch { TEAMS = null; }

// ── Small shared helpers ───────────────────────────────────────────────────
const envOf = env => env || process.env || {};
const isOff = value => /^(off|0|false|no|disabled)$/i.test(String(value ?? '').trim());

// The throwback filter, copied from video-ads.js (looksOld) so this module
// stands alone.
const THROWBACK = /#?\b(?:tbt|throwback(?:thursday)?|flashback(?:friday)?|on this day|years? ago|this day in (?:history|\w+ history)|anniversary|remember when)\b/i;
function looksOld(text, now = new Date()) {
  const value = String(text || '');
  if (THROWBACK.test(value)) return true;
  const year = now.getUTCFullYear();
  const years = [...value.matchAll(/(?:^|[^\d$#.,/:])((?:19|20)\d{2})(?:[-–](?:\d{2}|\d{4}))?(?![\d,.]?\d)/g)].map(m => Number(m[1]));
  return years.some(y => y >= 1900 && y <= year - 2);
}

// ISO string, tolerant of nanosecond fractions ("…T14:04:15.648815476+00:00").
function isoOf(value) {
  if (value === null || value === undefined || value === '') return null;
  let ms;
  if (typeof value === 'number') ms = value < 1e12 ? value * 1000 : value;
  else ms = Date.parse(String(value).replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function ageHours(iso, now = Date.now()) {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return null;
  const hours = (now - at) / 3600e3;
  return hours < -1 ? null : Math.max(0, hours);
}

// ── Cache (in memory, per warm instance) ──────────────────────────────────
const CACHE = new Map();
function cacheGet(key, now = Date.now()) {
  const hit = CACHE.get(key);
  if (!hit) return undefined;
  if (hit.expires <= now) { CACHE.delete(key); return undefined; }
  return hit.value;
}
function cacheSet(key, value, ttl = CACHE_MS) {
  if (CACHE.size > 500) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, { value, expires: Date.now() + ttl });
  return value;
}

// ── Polite pacing + rate-limit cooldowns, per host ────────────────────────
const PACE_MS = { 'www.reddit.com': 1100, 'oauth.reddit.com': 650, 'api.streamable.com': 400, default: 250 };
const pacing = { scale: 1 }; // tests set scale 0
const lanes = new Map(); // host -> promise of the last slot
const cooldowns = new Map(); // host -> epoch ms until which the host is skipped

function paceFor(host) {
  const gap = (PACE_MS[host] ?? PACE_MS.default) * pacing.scale;
  const prev = lanes.get(host) || Promise.resolve();
  const slot = prev.then(() => (gap > 0 ? new Promise(r => setTimeout(r, gap)) : null));
  lanes.set(host, slot.catch(() => null));
  return prev; // wait for the previous request's slot, then go
}
function coolingDown(host, now = Date.now()) {
  const until = cooldowns.get(host) || 0;
  return until > now ? until : 0;
}
function coolDown(host, ms) {
  cooldowns.set(host, Math.max(cooldowns.get(host) || 0, Date.now() + ms));
}
// Seconds from Retry-After / x-ratelimit-reset / ratelimit-reset (epoch secs).
function retryAfterMs(headers, fallbackMs) {
  const get = name => (headers && typeof headers.get === 'function' ? headers.get(name) : null);
  const retry = Number(get('retry-after'));
  if (Number.isFinite(retry) && retry > 0) return Math.min(retry * 1000, 3600e3);
  const reset = Number(get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return Math.min(reset * 1000, 3600e3);
  const epoch = Number(get('ratelimit-reset'));
  if (Number.isFinite(epoch) && epoch > 1e9) return Math.min(Math.max(0, epoch * 1000 - Date.now()), 3600e3);
  return fallbackMs;
}

// GET (or POST) JSON with UA, timeout, pacing, and cooldown on 429 / 403.
// Returns { ok, status, json, headers, skipped }.
async function request(url, { method = 'GET', headers = {}, body, diag, cooldownMs = 15 * 60e3, cooldownOn403 = false } = {}) {
  const host = new URL(url).host;
  if (coolingDown(host)) {
    if (diag) diag.rateLimited = (diag.rateLimited || 0) + 1;
    return { ok: false, status: 0, skipped: 'cooldown' };
  }
  await paceFor(host);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (diag) diag.failed = (diag.failed || 0) + 1;
    return { ok: false, status: 0, error: String(error?.message || error) };
  }
  const status = response.status;
  if (status === 429 || (status === 403 && cooldownOn403)) {
    coolDown(host, retryAfterMs(response.headers, cooldownMs));
    if (diag) {
      diag.rateLimited = (diag.rateLimited || 0) + 1;
      if (status === 403) diag.blocked = (diag.blocked || 0) + 1;
    }
    return { ok: false, status, headers: response.headers };
  }
  if (!response.ok) {
    if (diag) diag.failed = (diag.failed || 0) + 1;
    return { ok: false, status, headers: response.headers };
  }
  const json = await response.json().catch(() => null);
  if (json === null && diag) diag.failed = (diag.failed || 0) + 1;
  return { ok: json !== null, status, json, headers: response.headers };
}

// ── Sport / team plumbing ─────────────────────────────────────────────────
const SPORTS = ['nfl', 'cfb', 'mlb', 'golf'];

function teamName(team) {
  return typeof team === 'string' ? team : team?.name || '';
}
// Words that identify a team in a post: full name, short name, nickname, X handle.
function teamTerms(team) {
  const name = teamName(team);
  if (!name) return [];
  const short = typeof team === 'object' ? team.short || '' : '';
  const words = name.split(/\s+/);
  const nickname = words.length > 1 ? words.slice(-1)[0] : '';
  const handle = SOURCES?.handleFor ? SOURCES.handleFor(name) : '';
  return [...new Set([name, short, nickname, handle].filter(t => t && t.length >= 3).map(t => t.toLowerCase()))];
}
function mentionsAny(text, terms) {
  if (!terms.length) return true;
  const value = ` ${String(text || '').toLowerCase()} `;
  return terms.some(term => new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(value));
}

// Does a post plausibly belong to the sport? League words + that sport's team
// names (video-ads-teams.js). Used on mixed-topic posts (search results and
// accounts that post several sports); single-sport feeds skip it.
const SPORT_WORDS = {
  nfl: ['nfl', 'touchdown', 'td', 'quarterback', 'qb', 'field goal', 'pick six', 'interception', 'sack', 'fumble', 'snf', 'mnf', 'tnf', 'super bowl', 'end zone'],
  cfb: ['cfb', 'college football', 'ncaa', 'touchdown', 'td', 'sec', 'big ten', 'big 12', 'acc', 'heisman', 'cfp', 'bowl game', 'maction'],
  mlb: ['mlb', 'home run', 'homer', 'strikeout', 'grand slam', 'walk-off', 'walkoff', 'no-hitter', 'world series', 'pitcher', 'inning'],
  golf: ['golf', 'pga', 'liv golf', 'birdie', 'eagle putt', 'hole-in-one', 'hole in one', 'masters', 'ryder cup', 'lpga', 'dp world tour'],
};
const sportTermCache = new Map();
function sportTerms(sport) {
  if (!SPORT_WORDS[sport]) return [];
  if (!sportTermCache.has(sport)) {
    const teams = (TEAMS?.TEAMS || []).filter(t => t.sport === sport).flatMap(teamTerms);
    sportTermCache.set(sport, [...new Set([...SPORT_WORDS[sport], ...teams])]);
  }
  return sportTermCache.get(sport);
}
const aboutSport = (text, sport) => !SPORT_WORDS[sport] || mentionsAny(text, sportTerms(sport));

// X status link -> canonical URL + handle, or null.
const X_STATUS = /https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/i;
function xLink(value) {
  const m = String(value || '').match(X_STATUS);
  if (!m || /^(i|intent|share|home)$/i.test(m[1])) return null;
  return { url: `https://x.com/${m[1]}/status/${m[2]}`, handle: m[1], id: m[2] };
}
function xSourceKind(handle, sport) {
  const kind = SOURCES?.classifyHandle ? SOURCES.classifyHandle(handle, sport) : 'other';
  return kind === 'other' ? 'fan' : kind;
}

const shortSide = c => (c.width && c.height ? Math.min(c.width, c.height) : 0);
function qualityLabel(c) {
  const side = shortSide(c);
  return !side ? '' : side >= 1080 ? '1080p' : side >= 720 ? '720p' : `${side}p`;
}

// ── Media hosts ───────────────────────────────────────────────────────────
// v.redd.it: Reddit gives a video-only CMAF/DASH MP4 (fallback_url) and a
// separate audio MP4. Both answer CORS *. DASH_* names now 403; CMAF_* work.
function redditVideo(rv) {
  if (!rv || typeof rv !== 'object') return null;
  const fallback = String(rv.fallback_url || '').replace(/\?.*$/, '');
  const m = fallback.match(/^https:\/\/v\.redd\.it\/([a-z0-9]+)\/((?:CMAF|DASH)_\d+)\.mp4$/i);
  if (!m) return null;
  const prefix = m[2].startsWith('DASH') ? 'DASH' : 'CMAF';
  return {
    mediaId: `vreddit:${m[1]}`,
    mediaUrl: fallback,
    mediaHost: 'v.redd.it',
    width: Number(rv.width) || 0,
    height: Number(rv.height) || 0,
    durationMs: rv.duration ? Math.round(Number(rv.duration) * 1000) : null,
    hasAudio: false, // the MP4 itself is video-only
    audioUrl: rv.has_audio === false ? null : `https://v.redd.it/${m[1]}/${prefix}_AUDIO_128.mp4`,
    hlsUrl: rv.hls_url ? String(rv.hls_url).replace(/\?.*$/, '') : null, // has audio, CORS *
  };
}

const STREAMABLE_ID = /^https?:\/\/(?:www\.)?streamable\.com\/(?:e\/|o\/)?([a-z0-9]{4,10})(?:[/?#]|$)/i;
function streamableId(url) {
  return String(url || '').match(STREAMABLE_ID)?.[1]?.toLowerCase() || null;
}
// api.streamable.com/videos/{id} (public, no key). CDN cdn-cf-*.streamable.com
// answers CORS * with Range support. URLs are signed and expire (~3 days).
async function resolveStreamable(id, diag) {
  const key = `streamable:${id}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  const res = await request(`https://api.streamable.com/videos/${encodeURIComponent(id)}`, { diag });
  if (!res.ok) return res.status === 404 ? cacheSet(key, null) : null;
  const d = res.json;
  if (d.status !== 2) return cacheSet(key, null, 2 * 60e3); // still processing / failed
  const file = d.files?.mp4?.url ? d.files.mp4 : d.files?.['mp4-mobile']?.url ? d.files['mp4-mobile'] : null;
  if (!file) return cacheSet(key, null);
  const url = String(file.url).startsWith('//') ? `https:${file.url}` : String(file.url);
  if (!/^https:\/\/cdn-cf-[a-z]+\.streamable\.com\//.test(url)) return cacheSet(key, null);
  const expires = Number(new URL(url).searchParams.get('Expires'));
  const thumb = d.thumbnail_url ? (String(d.thumbnail_url).startsWith('//') ? `https:${d.thumbnail_url}` : d.thumbnail_url) : '';
  const out = {
    mediaId: `streamable:${id}`,
    mediaUrl: url,
    mediaHost: 'streamable.com',
    width: Number(file.width) || 0,
    height: Number(file.height) || 0,
    durationMs: file.duration ? Math.round(Number(file.duration) * 1000) : null,
    bytes: Number(file.size) || null,
    hasAudio: Number(d.audio_channels) > 0 ? true : null,
    thumb,
    title: d.title || '',
    expiresAt: Number.isFinite(expires) && expires > 0 ? new Date(expires * 1000).toISOString() : null,
  };
  // Signed URLs expire, so never cache past the expiry.
  const ttl = out.expiresAt ? Math.min(CACHE_MS, Date.parse(out.expiresAt) - Date.now() - 60e3) : CACHE_MS;
  return ttl > 0 ? cacheSet(key, out, ttl) : out;
}

// ── Candidate post-processing shared by both sources ──────────────────────
// Drops stale / throwback / low quality, dedupes by media id (or URL), sorts
// newest first. X candidates (mediaUrl null) skip the media checks.
function finalize(list, { sinceHours = 120, limit = 25, now = Date.now(), diag }) {
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const key = c.mediaId || c.url;
    if (seen.has(key)) { diag.duplicate = (diag.duplicate || 0) + 1; continue; }
    seen.add(key);
    const age = ageHours(c.postedAt || c.discoveredAt, now);
    if (age === null && c.platform !== 'x') { diag.noDate = (diag.noDate || 0) + 1; continue; }
    if (age !== null && age > sinceHours) { diag.tooOld = (diag.tooOld || 0) + 1; continue; }
    if (looksOld(c.text, new Date(now))) { diag.throwback = (diag.throwback || 0) + 1; continue; }
    if (c.platform !== 'x') {
      const side = shortSide(c);
      if (side && side < QUALITY.minShortSide) { diag.lowQuality = (diag.lowQuality || 0) + 1; continue; }
      const secs = (c.durationMs || 0) / 1000;
      if (secs && (secs < QUALITY.minSeconds || secs > QUALITY.maxSeconds)) { diag.badLength = (diag.badLength || 0) + 1; continue; }
    }
    out.push({ ...c, quality: c.platform === 'x' ? '' : qualityLabel(c), ageHours: age === null ? null : Math.round(age * 10) / 10 });
  }
  out.sort((a, b) => (Date.parse(b.postedAt || b.discoveredAt || 0) || 0) - (Date.parse(a.postedAt || a.discoveredAt || 0) || 0));
  return out.slice(0, limit);
}

// ══════════════════════════════════════════════════════════════════════════
// Reddit
// ══════════════════════════════════════════════════════════════════════════
const REDDIT_SPORT_SUBS = {
  nfl: ['nfl'],
  cfb: ['CFB'],
  mlb: ['baseball', 'MLB'],
  golf: ['golf', 'PGATour'],
};
const REDDIT_GENERAL_SUBS = ['sports'];
// Team subreddits (well-known names; a wrong one only costs a 404 in diag).
const REDDIT_TEAM_SUBS = {
  'Arizona Cardinals': 'AZCardinals', 'Atlanta Falcons': 'falcons', 'Baltimore Ravens': 'ravens',
  'Buffalo Bills': 'buffalobills', 'Carolina Panthers': 'panthers', 'Chicago Bears': 'CHIBears',
  'Cincinnati Bengals': 'bengals', 'Cleveland Browns': 'Browns', 'Dallas Cowboys': 'cowboys',
  'Denver Broncos': 'DenverBroncos', 'Detroit Lions': 'detroitlions', 'Green Bay Packers': 'GreenBayPackers',
  'Houston Texans': 'Texans', 'Indianapolis Colts': 'Colts', 'Jacksonville Jaguars': 'Jaguars',
  'Kansas City Chiefs': 'KansasCityChiefs', 'Las Vegas Raiders': 'raiders', 'Los Angeles Chargers': 'Chargers',
  'Los Angeles Rams': 'LosAngelesRams', 'Miami Dolphins': 'miamidolphins', 'Minnesota Vikings': 'minnesotavikings',
  'New England Patriots': 'Patriots', 'New Orleans Saints': 'Saints', 'New York Giants': 'NYGiants',
  'New York Jets': 'nyjets', 'Philadelphia Eagles': 'eagles', 'Pittsburgh Steelers': 'steelers',
  'San Francisco 49ers': '49ers', 'Seattle Seahawks': 'Seahawks', 'Tampa Bay Buccaneers': 'buccaneers',
  'Tennessee Titans': 'Tennesseetitans', 'Washington Commanders': 'Commanders',
  'Arizona Diamondbacks': 'azdiamondbacks', 'Atlanta Braves': 'Braves', 'Baltimore Orioles': 'orioles',
  'Boston Red Sox': 'redsox', 'Chicago Cubs': 'CHICubs', 'Chicago White Sox': 'whitesox',
  'Cincinnati Reds': 'Reds', 'Cleveland Guardians': 'ClevelandGuardians', 'Colorado Rockies': 'ColoradoRockies',
  'Detroit Tigers': 'motorcitykitties', 'Houston Astros': 'Astros', 'Kansas City Royals': 'KCRoyals',
  'Los Angeles Angels': 'angelsbaseball', 'Los Angeles Dodgers': 'Dodgers', 'Miami Marlins': 'letsgofish',
  'Milwaukee Brewers': 'Brewers', 'Minnesota Twins': 'minnesotatwins', 'New York Mets': 'NewYorkMets',
  'New York Yankees': 'NYYankees', Athletics: 'OaklandAthletics', 'Philadelphia Phillies': 'phillies',
  'Pittsburgh Pirates': 'buccos', 'San Diego Padres': 'Padres', 'San Francisco Giants': 'SFGiants',
  'Seattle Mariners': 'Mariners', 'St. Louis Cardinals': 'Cardinals', 'Tampa Bay Rays': 'tampabayrays',
  'Texas Rangers': 'TexasRangers', 'Toronto Blue Jays': 'Torontobluejays', 'Washington Nationals': 'Nationals',
};

// App-only OAuth (client_credentials). Token cached until shortly before expiry.
const redditAuth = { token: null, expires: 0 };
async function redditToken(env, diag) {
  const id = env.REDDIT_CLIENT_ID;
  const secret = env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (redditAuth.token && redditAuth.expires > Date.now()) return redditAuth.token;
  const res = await request('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    diag,
  });
  if (!res.ok || !res.json?.access_token) { diag.authFailed = (diag.authFailed || 0) + 1; return null; }
  redditAuth.token = res.json.access_token;
  redditAuth.expires = Date.now() + Math.max(60, Number(res.json.expires_in || 3600) - 120) * 1000;
  return redditAuth.token;
}

// One listing (new posts, or an in-sub search) -> array of post `data`.
async function redditListing(path, params, env, diag) {
  const token = await redditToken(env, diag);
  const query = new URLSearchParams({ raw_json: '1', ...params }).toString();
  const url = token ? `https://oauth.reddit.com${path}?${query}` : `https://www.reddit.com${path}.json?${query}`;
  const key = `reddit:${token ? 'o' : 'p'}:${path}?${query}`;
  const cached = cacheGet(key);
  if (cached !== undefined) { diag.cached = (diag.cached || 0) + 1; return cached; }
  diag.requests = (diag.requests || 0) + 1;
  diag.mode = token ? 'oauth' : 'public';
  const res = await request(url, {
    headers: token ? { Authorization: `bearer ${token}` } : {},
    diag,
    cooldownOn403: !token, // unauthenticated 403 = network block; back off
    cooldownMs: token ? 10 * 60e3 : 30 * 60e3,
  });
  if (token && res.status === 401) { redditAuth.token = null; redditAuth.expires = 0; }
  // Stay under the OAuth budget: when the window is nearly spent, pause.
  const remaining = Number(res.headers?.get?.('x-ratelimit-remaining'));
  if (token && Number.isFinite(remaining) && remaining < 3) {
    coolDown('oauth.reddit.com', retryAfterMs(res.headers, 60e3));
  }
  if (!res.ok) return res.skipped ? [] : cacheSet(key, [], 2 * 60e3);
  const posts = (res.json?.data?.children || []).filter(ch => ch?.kind === 't3').map(ch => ch.data);
  return cacheSet(key, posts);
}

// One Reddit post -> candidate (media) | { x } | { streamable } | null.
function parseRedditPost(post, { sport } = {}) {
  if (!post || post.over_18 || post.removed_by_category || post.is_self) return null;
  const src = Array.isArray(post.crosspost_parent_list) && post.crosspost_parent_list[0] ? post.crosspost_parent_list[0] : post;
  const base = {
    url: `https://www.reddit.com${post.permalink || ''}`,
    platform: 'reddit',
    handle: `r/${post.subreddit || ''}`,
    postedAt: isoOf(post.created_utc), // Reddit's server timestamp (verified)
    text: String(post.title || '').slice(0, 280),
    sourceKind: 'fan',
    redditScore: Number(post.score) || 0,
    sport: sport || '',
  };
  const preview = src.preview?.images?.[0]?.source?.url || (/^https?:/.test(src.thumbnail || '') ? src.thumbnail : '');
  const rv = redditVideo(src.secure_media?.reddit_video || src.media?.reddit_video);
  if (rv) return { kind: 'media', candidate: { ...base, ...rv, thumb: preview, bytes: null } };
  const link = String(src.url_overridden_by_dest || src.url || '');
  const x = xLink(link);
  if (x) return { kind: 'x', candidate: { ...base, url: x.url, platform: 'x', handle: x.handle, postedAt: null, discoveredAt: base.postedAt, mediaUrl: null, via: base.url, sourceKind: xSourceKind(x.handle, sport) } };
  const sid = streamableId(link);
  if (sid) return { kind: 'streamable', id: sid, base: { ...base, thumb: preview } };
  return null;
}

async function redditSearch({ sport = '', team = null, teams = [], query = '', sinceHours = 120, limit = 25, env } = {}) {
  env = envOf(env);
  const diag = { source: 'reddit', searched: 0, found: 0, noVideo: 0, failed: 0 };
  const subs = new Set();
  const teamList = [team, ...(teams || [])].filter(Boolean);
  const terms = teamList.flatMap(teamTerms);
  for (const t of teamList) { const sub = REDDIT_TEAM_SUBS[teamName(t)]; if (sub) subs.add(sub); }
  const sportSubs = REDDIT_SPORT_SUBS[sport] || (sport ? [] : Object.values(REDDIT_SPORT_SUBS).flat());
  sportSubs.forEach(s => subs.add(s));
  if (!sport && !teamList.length) REDDIT_GENERAL_SUBS.forEach(s => subs.add(s));
  const t = sinceHours <= 24 ? 'day' : 'week';

  const raw = [];
  for (const sub of [...subs].slice(0, 6)) {
    const isTeamSub = Object.values(REDDIT_TEAM_SUBS).includes(sub);
    let posts;
    if (query) {
      posts = await redditListing(`/r/${sub}/search`, { q: query, restrict_sr: '1', sort: 'new', t, limit: '50' }, env, diag);
    } else {
      posts = await redditListing(`/r/${sub}/new`, { limit: '75' }, env, diag);
    }
    diag.searched += posts.length;
    for (const post of posts) {
      if (!isTeamSub && terms.length && !mentionsAny(post.title, terms)) continue;
      if (REDDIT_GENERAL_SUBS.includes(sub) && sport && !aboutSport(post.title, sport)) { diag.offTopic = (diag.offTopic || 0) + 1; continue; }
      raw.push(post);
    }
    if (coolingDown('www.reddit.com') && diag.mode === 'public') break; // blocked; stop asking
  }

  const candidates = [];
  const pending = [];
  for (const post of raw) {
    const parsed = parseRedditPost(post, { sport });
    if (!parsed) { diag.noVideo += 1; continue; }
    if (parsed.kind === 'streamable') pending.push(parsed);
    else candidates.push(parsed.candidate);
  }
  // Resolve Streamable links (few per call; skip ones already too old).
  for (const p of pending.slice(0, 8)) {
    const age = ageHours(p.base.postedAt);
    if (age !== null && age > sinceHours) { diag.tooOld = (diag.tooOld || 0) + 1; continue; }
    const media = await resolveStreamable(p.id, diag);
    if (!media) { diag.noVideo += 1; continue; }
    const { title, ...rest } = media;
    candidates.push({ ...p.base, ...rest, thumb: rest.thumb || p.base.thumb });
  }
  const out = finalize(candidates, { sinceHours, limit, diag });
  diag.found = out.length;
  return { candidates: out, cost: 0, diag };
}

const reddit = {
  id: 'reddit',
  configured: env => !isOff(envOf(env).CLIPS_REDDIT),
  search: redditSearch,
};

// ══════════════════════════════════════════════════════════════════════════
// Bluesky
// ══════════════════════════════════════════════════════════════════════════
// Accounts checked 2026-11-17 (public.api.bsky.app getAuthorFeed). Mirror bots
// repost official X posts with the X link, which we hand to clipFromPost.
const BLUESKY_ACCOUNTS = {
  nfl: [
    { actor: 'nflnewsposter.bsky.social', kind: 'fan', sportOnly: true }, // ~54 videos / 84 X links per 48 h
    { actor: 'ravensbot.bsky.social', kind: 'fan', sportOnly: true },
    { actor: 'watchmomentwire.bsky.social', kind: 'fan' },
    { actor: 'omahaprod-mirror.bsky.social', kind: 'fan' },
  ],
  cfb: [
    { actor: 'splitzoneduo.com', kind: 'media', sportOnly: true },
    { actor: 'redditcfb.com', kind: 'fan', sportOnly: true },
    { actor: 'cfbplayoff.bsky.social', kind: 'league', sportOnly: true },
  ],
  mlb: [
    { actor: 'pitchingninja.com', kind: 'media', sportOnly: true },
    { actor: 'codifybaseball.bsky.social', kind: 'media', sportOnly: true },
  ],
  golf: [],
  any: [{ actor: 'espn.com', kind: 'media' }, { actor: 'theathletic.com', kind: 'media' }],
};
const BLUESKY_QUERIES = {
  nfl: ['NFL', 'touchdown'],
  cfb: ['college football', 'CFB'],
  mlb: ['MLB', 'home run'],
  golf: ['golf', 'PGA Tour'],
};
const PUBLIC_APPVIEW = 'https://public.api.bsky.app/xrpc';
const SEARCH_APPVIEW = 'https://api.bsky.app/xrpc'; // public.api.bsky.app 403s searchPosts
// Only PDS hosts whose getBlob we verified to answer CORS * (Bluesky-run PDSes).
const PDS_ALLOWED = /^https:\/\/(?:[a-z0-9-]+\.)+host\.bsky\.network$/;

const blueskyAuth = { jwt: null, expires: 0 };
async function blueskySession(env, diag) {
  const identifier = env.BLUESKY_HANDLE;
  const password = env.BLUESKY_APP_PASSWORD;
  if (!identifier || !password) return null;
  if (blueskyAuth.jwt && blueskyAuth.expires > Date.now()) return blueskyAuth.jwt;
  const res = await request('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
    diag,
  });
  if (!res.ok || !res.json?.accessJwt) { diag.authFailed = (diag.authFailed || 0) + 1; return null; }
  blueskyAuth.jwt = res.json.accessJwt;
  blueskyAuth.expires = Date.now() + 90 * 60e3; // access tokens last ~2 h
  return blueskyAuth.jwt;
}

// DID -> PDS endpoint (cached a day).
async function pdsFor(did, diag) {
  const key = `pds:${did}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  let url = null;
  if (/^did:plc:[a-z0-9]+$/.test(did)) url = `https://plc.directory/${did}`;
  else if (/^did:web:[a-z0-9.-]+$/i.test(did)) url = `https://${did.slice(8)}/.well-known/did.json`;
  if (!url) return cacheSet(key, null, LONG_CACHE_MS);
  const res = await request(url, { diag });
  if (!res.ok) return null;
  const service = (res.json?.service || []).find(s => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
  const endpoint = service?.serviceEndpoint ? String(service.serviceEndpoint).replace(/\/+$/, '') : null;
  return cacheSet(key, endpoint, LONG_CACHE_MS);
}

function videoEmbedOf(record) {
  const e = record?.embed || {};
  if (e.$type === 'app.bsky.embed.video') return e;
  if (e.media?.$type === 'app.bsky.embed.video') return e.media;
  return null;
}
function videoViewOf(post) {
  const e = post?.embed || {};
  if (String(e.$type || '').startsWith('app.bsky.embed.video')) return e;
  if (String(e.media?.$type || '').startsWith('app.bsky.embed.video')) return e.media;
  return null;
}
function linksOf(record) {
  const out = [];
  for (const facet of record?.facets || []) for (const f of facet.features || []) if (f.uri) out.push(f.uri);
  const e = record?.embed || {};
  if (e.external?.uri) out.push(e.external.uri);
  if (e.media?.external?.uri) out.push(e.media.external.uri);
  return out;
}
const postUrl = post => {
  const rkey = String(post.uri || '').split('/').pop();
  return `https://bsky.app/profile/${post.author?.handle || post.author?.did}/post/${rkey}`;
};
// Verified time: the AppView's indexedAt; if the client's createdAt is earlier
// (backdated / imported), trust the earlier one so old footage reads old.
function blueskyPostedAt(post) {
  const indexed = isoOf(post.indexedAt);
  const created = isoOf(post.record?.createdAt);
  if (!indexed) return null;
  if (created && Date.parse(created) < Date.parse(indexed)) return created;
  return indexed;
}

// One post view -> { media?: candidate-without-mediaUrl, xs: [candidates] }.
function parseBlueskyPost(post, { sport, kind = 'fan' } = {}) {
  if (!post?.record) return null;
  const labels = (post.labels || []).map(l => l.val);
  if (labels.some(v => /^(porn|sexual|nudity|graphic-media|gore|!hide|!warn)$/.test(v))) return null;
  const base = {
    url: postUrl(post),
    platform: 'bluesky',
    handle: post.author?.handle || '',
    did: post.author?.did || '',
    postedAt: blueskyPostedAt(post),
    text: String(post.record.text || '').slice(0, 280),
    sourceKind: kind,
    sport: sport || '',
  };
  const xs = [];
  for (const link of linksOf(post.record)) {
    const x = xLink(link);
    if (x && !xs.some(c => c.url === x.url)) {
      xs.push({ ...base, url: x.url, platform: 'x', handle: x.handle, postedAt: null, discoveredAt: base.postedAt, mediaUrl: null, via: base.url, sourceKind: xSourceKind(x.handle, sport) });
    }
  }
  const embed = videoEmbedOf(post.record);
  const view = videoViewOf(post);
  let media = null;
  const cid = embed?.video?.ref?.$link || embed?.video?.cid || view?.cid;
  if (embed && cid) {
    const ar = embed.aspectRatio || view?.aspectRatio || {};
    media = {
      ...base,
      mediaId: `bsky:${cid}`,
      cid,
      mimeType: embed.video?.mimeType || '',
      bytes: Number(embed.video?.size) || null,
      width: Number(ar.width) || 0, // Bluesky stores the upload's aspectRatio (usually pixels)
      height: Number(ar.height) || 0,
      durationMs: null, // not exposed by the AppView
      thumb: view?.thumbnail || '',
      hlsUrl: view?.playlist || null,
      hasAudio: null,
      mediaHost: 'bsky-pds',
    };
  }
  return { media, xs };
}

async function blueskyFeed(actor, diag) {
  const url = `${PUBLIC_APPVIEW}/app.bsky.feed.getAuthorFeed?${new URLSearchParams({ actor, limit: '50', filter: 'posts_no_replies' })}`;
  const cached = cacheGet(url);
  if (cached !== undefined) { diag.cached = (diag.cached || 0) + 1; return cached; }
  diag.requests = (diag.requests || 0) + 1;
  const res = await request(url, { diag });
  if (!res.ok) return res.skipped ? [] : cacheSet(url, [], 2 * 60e3);
  const posts = (res.json?.feed || []).filter(item => !item.reason).map(item => item.post);
  return cacheSet(url, posts);
}

async function blueskySearchPosts(q, sinceHours, env, diag) {
  const jwt = await blueskySession(env, diag);
  const params = new URLSearchParams({ q, sort: 'latest', limit: '50', lang: 'en', since: new Date(Date.now() - sinceHours * 3600e3).toISOString() });
  const url = jwt ? `https://bsky.social/xrpc/app.bsky.feed.searchPosts?${params}` : `${SEARCH_APPVIEW}/app.bsky.feed.searchPosts?${params}`;
  const key = `bsky-search:${jwt ? 'a' : 'p'}:${q}:${Math.round(sinceHours)}`;
  const cached = cacheGet(key);
  if (cached !== undefined) { diag.cached = (diag.cached || 0) + 1; return cached; }
  diag.requests = (diag.requests || 0) + 1;
  // Unauthenticated search 403s intermittently: back off 15 min on 403.
  const res = await request(url, { headers: jwt ? { Authorization: `Bearer ${jwt}` } : {}, diag, cooldownOn403: !jwt });
  if (jwt && res.status === 401) { blueskyAuth.jwt = null; blueskyAuth.expires = 0; }
  if (!res.ok) return res.skipped ? [] : cacheSet(key, [], 2 * 60e3);
  return cacheSet(key, res.json?.posts || []);
}

async function blueskySearch({ sport = '', team = null, teams = [], query = '', sinceHours = 120, limit = 25, env } = {}) {
  env = envOf(env);
  const diag = { source: 'bluesky', searched: 0, found: 0, noVideo: 0, failed: 0 };
  const teamList = [team, ...(teams || [])].filter(Boolean);
  const terms = teamList.flatMap(teamTerms);
  const accounts = [...(BLUESKY_ACCOUNTS[sport] || (sport ? [] : SPORTS.flatMap(s => BLUESKY_ACCOUNTS[s] || []))), ...BLUESKY_ACCOUNTS.any];
  const queries = query ? [query] : teamList.length ? teamList.map(teamName).slice(0, 3) : BLUESKY_QUERIES[sport] || [];

  const posts = []; // [post, kind, sportOnly]
  for (const acc of accounts) {
    for (const post of await blueskyFeed(acc.actor, diag)) posts.push([post, acc.kind, !!acc.sportOnly]);
  }
  if (!isOff(env.CLIPS_BLUESKY_SEARCH)) {
    for (const q of queries.slice(0, 3)) {
      for (const post of await blueskySearchPosts(q, sinceHours, env, diag)) posts.push([post, 'fan', false]);
    }
  }
  diag.searched = posts.length;

  const candidates = [];
  const mediaPending = [];
  const seenUris = new Set();
  for (const [post, kind, sportOnly] of posts) {
    if (seenUris.has(post.uri)) { diag.duplicate = (diag.duplicate || 0) + 1; continue; }
    seenUris.add(post.uri);
    const text = String(post.record?.text || '');
    const age = ageHours(blueskyPostedAt(post));
    if (age !== null && age > sinceHours) { diag.tooOld = (diag.tooOld || 0) + 1; continue; }
    if (!sportOnly && sport && !aboutSport(text, sport)) { diag.offTopic = (diag.offTopic || 0) + 1; continue; }
    const parsed = parseBlueskyPost(post, { sport, kind });
    if (!parsed) { diag.failed += 1; continue; }
    // Team filter: the post (or its X link's handle) must name the team.
    const relevant = c => mentionsAny(`${text} ${c.platform === 'x' ? c.handle : ''}`, terms);
    candidates.push(...parsed.xs.filter(relevant));
    if (parsed.media && relevant(parsed.media)) mediaPending.push(parsed.media);
    else if (!parsed.media && !parsed.xs.length) diag.noVideo += 1;
  }
  // Resolve the PDS for each video's author -> getBlob URL (original upload).
  for (const m of mediaPending) {
    if (m.mimeType && m.mimeType !== 'video/mp4') { diag.notMp4 = (diag.notMp4 || 0) + 1; continue; }
    const pds = await pdsFor(m.did, diag);
    if (!pds || !PDS_ALLOWED.test(pds)) { diag.pdsNotAllowed = (diag.pdsNotAllowed || 0) + 1; continue; }
    const { did, cid, mimeType, ...rest } = m;
    candidates.push({
      ...rest,
      mediaUrl: `${pds}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did, cid })}`,
      serverStreamOk: Boolean(rest.bytes && rest.bytes <= MAX_BYTES_SERVER_STREAM),
    });
  }
  const out = finalize(candidates, { sinceHours, limit, diag });
  diag.found = out.length;
  diag.auth = blueskyAuth.jwt ? 'app-password' : 'public';
  return { candidates: out, cost: 0, diag };
}

const bluesky = {
  id: 'bluesky',
  configured: env => !isOff(envOf(env).CLIPS_BLUESKY),
  search: blueskySearch,
};

// ══════════════════════════════════════════════════════════════════════════
// Combined source
// ══════════════════════════════════════════════════════════════════════════
const sources = [reddit, bluesky];

// Runs every configured sub-source in parallel, merges + dedupes. A failing
// sub-source never fails the whole call (its error lands in diag).
async function search(opts = {}) {
  const env = envOf(opts.env);
  const limit = opts.limit ?? 25;
  const active = sources.filter(s => s.configured(env));
  const diag = { source: 'public', sources: {}, skipped: sources.filter(s => !active.includes(s)).map(s => s.id) };
  const results = await Promise.all(active.map(s => s.search({ ...opts, env, limit: limit * 2 }).catch(error => ({ candidates: [], cost: 0, diag: { error: String(error?.message || error) } }))));
  const all = [];
  results.forEach((r, i) => { diag.sources[active[i].id] = r.diag; all.push(...r.candidates); });
  const seen = new Set();
  const merged = [];
  for (const c of all) {
    const key = c.mediaId || c.url;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }
  merged.sort((a, b) => (Date.parse(b.postedAt || b.discoveredAt || 0) || 0) - (Date.parse(a.postedAt || a.discoveredAt || 0) || 0));
  const candidates = merged.slice(0, limit);
  diag.found = candidates.length;
  diag.searched = results.reduce((n, r) => n + (r.diag?.searched || 0), 0);
  return { candidates, cost: 0, diag };
}

// Hosts the browser downloads from directly (all verified CORS *, 2026-11-17).
// clips-library may allow-list exactly these for a <=4 MB server stream, but
// none needs one.
const MEDIA_HOSTS = [
  { host: 'v.redd.it', pattern: /^https:\/\/v\.redd\.it\/[a-z0-9]+\/(?:CMAF|DASH)_(?:\d+|AUDIO_\d+)\.mp4$/i, cors: '*', note: 'video-only MP4; audio is a separate CMAF_AUDIO_128.mp4; Range ok' },
  { host: 'cdn-cf-*.streamable.com', pattern: /^https:\/\/cdn-cf-[a-z]+\.streamable\.com\/video\/mp4(?:-mobile)?\/[a-z0-9]+\.mp4\?/i, cors: '*', note: 'signed URL, expires ~3 days; Range ok' },
  { host: '*.host.bsky.network', pattern: /^https:\/\/(?:[a-z0-9-]+\.)+host\.bsky\.network\/xrpc\/com\.atproto\.sync\.getBlob\?/i, cors: '*', note: 'original upload; Range NOT honoured; can be large' },
];

module.exports = {
  id: 'public',
  configured: env => !isOff(envOf(env).CLIPS_PUBLIC) && sources.some(s => s.configured(env)),
  search,
  sources,
  reddit,
  bluesky,
  MEDIA_HOSTS,
  USER_AGENT,
  _test: {
    looksOld, isoOf, ageHours, xLink, streamableId, redditVideo, parseRedditPost, parseBlueskyPost,
    blueskyPostedAt, resolveStreamable, aboutSport, finalize, retryAfterMs, teamTerms, mentionsAny, pdsFor,
    CACHE, cooldowns, lanes, pacing, redditAuth, blueskyAuth, BLUESKY_ACCOUNTS, REDDIT_TEAM_SUBS, PDS_ALLOWED,
    reset() {
      CACHE.clear(); cooldowns.clear(); lanes.clear();
      redditAuth.token = null; redditAuth.expires = 0;
      blueskyAuth.jwt = null; blueskyAuth.expires = 0;
    },
  },
};
