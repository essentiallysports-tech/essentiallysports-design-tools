'use strict';
// Video Ads: newsletter-signup video ads (trending sports clip + logo + copy +
// CTA). One endpoint, POST { mode, ... }:
//
//   trends      last-48h NFL / CFB / MLB moments (shared with Trend Design)
//   clip        an X post link -> its MP4 versions on video.twimg.com, so the
//               browser downloads the clip itself. Video bytes never pass
//               through this function (serverless responses are capped at ~4.5 MB).
//   find-clips  X posts with video from the last 5 days of one team, the
//               teams in a colour, or a moment, aimed at verified sources
//               (video-ads-sources.js): one x.com-only web search (Haiku, up
//               to 4 searches, $0.06 cap) or, with X_BEARER_TOKEN, the X API;
//               every post verified like `clip` (timestamp under 120h, no
//               throwbacks, >=480p, 4-120 s), ranked best first, widened to
//               league accounts / the colour group when a team is thin;
//               30-minute cache; `diag` says where candidates went
//   copy        3 ad-copy variants in the ES styles, grounded in the brand, sport,
//               team or moment and colour theme, plus lessons from past ads;
//               common problems are repaired in code before the model retries
//   chat        the Video Ads assistant: a reply, plus an optional change to the ad
//   grammar     grammar / spelling / punctuation fixes from the cheapest model;
//               each must quote its field exactly and keep numbers and brand
//               words; 10-minute cache
//   moments-with-clips  the top ~10 trending moments that have fresh, verified
//               clips (one capped search for all of them, shared 30-min cache)
//   research    removed (410)
//
// Every request needs a signed-in ES user; AI modes count toward the hourly limit.
const { verifyEsUser, bearerToken } = require('./_supabase-auth.js');
const { getTrends } = require('./trend-design.js');
const { _helpers: tweet } = require('./tweet-oembed.js');
const { aiText, aiWebResearch, gatewayConfigured, isBudgetError, userOverHourlyLimit, aiSpendGate, featureDisabled, featureOffMessage } = require('./_ai-gateway.js');
const RULES = require('../../frameup-rules.js');
const BRANDS = require('../../video-ads-brands.js');
const TEAMS = require('../../video-ads-teams.js');

// The learning loop (_ad-learning.js) is optional: without it, copy works as before.
let learning = { lessonsFor: async () => ({ examples: [], rules: [] }), recordEvent: async () => false };
try { learning = { ...learning, ...require('./_ad-learning.js') }; } catch { /* not deployed yet */ }

const AD_SPORTS = ['nfl', 'cfb', 'mlb'];
const TREND_HOURS = 48;
const VIDEO_HOST = 'video.twimg.com';

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

// ─── Trends ────────────────────────────────────────────────────────────────
async function trends() {
  const data = await getTrends(false, { window: '2d' });
  const since = Date.now() - TREND_HOURS * 3600e3;
  const items = (data.items || [])
    .filter(item => AD_SPORTS.includes(item.category))
    .filter(item => !item.publishedAt || new Date(item.publishedAt).getTime() >= since)
    .map(item => ({
      id: item.id,
      sport: item.category,
      title: item.title,
      traffic: item.traffic || '',
      source: item.source || '',
      url: item.url || '',
      image: item.image || '',
      publishedAt: item.publishedAt || '',
      related: (item.related || []).slice(0, 4).map(r => ({ title: r.title, url: r.url, source: r.source })),
    }));
  return { ok: true, updatedAt: data.updatedAt, hours: TREND_HOURS, items, stale: Boolean(data.stale) };
}

// ─── Clip lookup (X post -> MP4 versions) ──────────────────────────────────
const isVideoUrl = url => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === VIDEO_HOST;
  } catch (error) {
    return false;
  }
};

// "…/vid/avc1/720x1280/abc.mp4" -> { width: 720, height: 1280 }
const sizeFromUrl = url => {
  const match = String(url).match(/\/(\d{2,5})x(\d{2,5})\//);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: 0, height: 0 };
};

function variantsFrom(list) {
  const seen = new Set();
  return list
    .filter(v => v && isVideoUrl(v.url) && (!v.type || /mp4/i.test(v.type)) && /\.mp4(\?|$)/i.test(v.url))
    .map(v => {
      const size = v.width && v.height ? { width: v.width, height: v.height } : sizeFromUrl(v.url);
      return { url: v.url, width: size.width, height: size.height, bitrate: Number(v.bitrate || 0) };
    })
    .filter(v => (seen.has(v.url) ? false : seen.add(v.url)))
    .sort((a, b) => (b.height * b.width) - (a.height * a.width) || b.bitrate - a.bitrate);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

const postedAt = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

async function clipFromPost(rawUrl) {
  let url;
  try {
    url = tweet.normalizeTweetUrl(rawUrl);
  } catch (error) {
    return { ok: false, status: 400, error: error.message };
  }
  const id = tweet.extractTweetId(url);
  // fxtwitter first (fuller metadata), then X's syndication feed.
  const fx = await fetchJson(`${tweet.FXTWITTER_ENDPOINT}/i/status/${encodeURIComponent(id)}`).catch(() => null);
  const fxTweet = fx?.code === 200 ? fx.tweet : null;
  const fxVideos = fxTweet?.media?.videos || [];
  let variants = variantsFrom(fxVideos.flatMap(video => [
    ...(video.formats || video.variants || []).map(f => ({ url: f.url, type: f.container ? `video/${f.container}` : f.type, bitrate: f.bitrate, width: f.width, height: f.height })),
    { url: video.url, type: video.format || 'video/mp4', width: video.width, height: video.height },
  ]));
  let meta = fxTweet ? {
    author: fxTweet.author?.name || '',
    handle: fxTweet.author?.screen_name || '',
    text: String(fxTweet.text || '').slice(0, 280),
    thumbnail: fxVideos[0]?.thumbnail_url || '',
    durationMs: Math.round(Number(fxVideos[0]?.duration || 0) * 1000),
    postedAt: postedAt(fxTweet.created_timestamp ? fxTweet.created_timestamp * 1000 : fxTweet.created_at),
    likes: Number(fxTweet.likes || 0),
    views: Number(fxTweet.views || 0),
    verifiedType: String(fxTweet.author?.verification?.type || ''),
  } : null;
  let reached = Boolean(fx);
  if (!variants.length) {
    const syn = await fetchJson(`${tweet.SYNDICATION_ENDPOINT}?id=${encodeURIComponent(id)}&token=1`).catch(() => null);
    reached = reached || Boolean(syn);
    const media = (syn?.mediaDetails || []).filter(m => m?.video_info?.variants);
    variants = variantsFrom(media.flatMap(m => m.video_info.variants.map(v => ({ url: v.url, type: v.content_type, bitrate: v.bitrate }))));
    if (syn) {
      meta = meta || {
        author: syn.user?.name || '',
        handle: syn.user?.screen_name || '',
        text: String(syn.text || '').slice(0, 280),
        thumbnail: media[0]?.media_url_https || '',
        durationMs: Number(media[0]?.video_info?.duration_millis || 0),
        postedAt: postedAt(syn.created_at),
        likes: Number(syn.favorite_count || 0),
        views: 0,
        verifiedType: String(syn.user?.verified_type || (syn.user?.verified ? 'verified' : '')),
      };
    }
  }
  // reason tells a search apart "no video in the post" from "couldn't reach either source".
  if (!variants.length) return { ok: false, status: 404, reason: reached ? 'no-video' : 'unreachable', error: 'That post has no downloadable video. Try another post, or save the clip and drop it in.' };
  return { ok: true, url, variants, ...meta };
}


// ─── AI helpers ────────────────────────────────────────────────────────────
function extractJson(text) {
  const raw = String(text || '');
  const start = raw.search(/[{[]/);
  if (start < 0) return null;
  for (let end = raw.length; end > start; end -= 1) {
    if (raw[end - 1] !== '}' && raw[end - 1] !== ']') continue;
    try { return JSON.parse(raw.slice(start, end)); } catch (error) { /* keep shrinking */ }
  }
  return null;
}
const clean = (value, max = 400) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const strings = (list, max, each = 300) => (Array.isArray(list) ? list : []).map(item => clean(item, each)).filter(Boolean).slice(0, max);
const httpsUrl = value => { try { const u = new URL(String(value)); return u.protocol === 'https:' ? u.toString() : ''; } catch (error) { return ''; } };
const isXPost = value => { try { tweet.normalizeTweetUrl(value); return true; } catch (error) { return false; } };
const numberTokens = text => (String(text || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map(n => n.replace(/,/g, ''));
const money = value => Number(Number(value || 0).toFixed(5));
const SPORT_NAMES = { nfl: 'NFL', cfb: 'college football', mlb: 'MLB' };
const withTimeout = (promise, ms, fallback) => Promise.race([
  Promise.resolve(promise).catch(() => fallback),
  new Promise(resolve => setTimeout(() => resolve(fallback), ms)),
]);

function trendInput(trend = {}) {
  if (typeof trend === 'string') trend = { title: trend };
  return {
    id: clean(trend.id, 80),
    title: clean(trend.title, 300),
    sport: AD_SPORTS.includes(trend.sport) ? trend.sport : '',
    url: httpsUrl(trend.url),
    related: (Array.isArray(trend.related) ? trend.related : []).slice(0, 4).map(r => ({ title: clean(r?.title, 200), url: httpsUrl(r?.url) })),
  };
}

// ─── Find clips (team, colour or moment -> fresh, verified X videos) ──────
// Why the grid used to come back empty: a general web search ("Chiefs video
// this week") mostly returns articles and profile pages, X status links are a
// minority, and the few that come back often have no video or are old. Now:
//   1. Targeted: the search is limited to x.com (allowed_domains) and aimed at
//      the verified sources in video-ads-sources.js (the team's own account,
//      the league / conference and the networks), several focused queries in
//      one call (up to 4 searches, hard cap $0.06), asking for 25 status links.
//      With X_BEARER_TOKEN set, the official X API v2 recent search
//      (`from:<handle> has:videos`) is used instead and costs no AI at all.
//   2. Verified: every post is checked like `clip` (fxtwitter, then X
//      syndication; video.twimg.com MP4s only); the VERIFIED timestamp must be
//      under 120 hours; throwbacks are dropped.
//   3. Quality: best version under 480p, or shorter than 4 s / longer than
//      120 s, is dropped; the rest are scored (verified source, resolution,
//      recency, engagement, length), de-duplicated (the same video re-posted
//      by several accounts) and returned best first.
//   4. Widened, never empty when it can be helped: a team with fewer than 3
//      clips also gets its league / network posts, then its colour group;
//      the response says so (`widened`, `note`).
//   5. `diag` counts where candidates went, so a thin grid can be explained.
// Cache: 30 minutes per (strategy, sport, team | colour | query), shared on
// the instance.
const SOURCES = require('../../video-ads-sources.js');
const CLIP_CACHE = new Map();
const CLIP_TTL_MS = 30 * 60 * 1000;
const FIND_CLIPS = {
  maxUses: 4, maxTokens: 1600, maxCostUsd: 0.06, candidates: 25, maxClips: 12, maxAgeHours: 120, minClips: 3, verifyMs: 6000,
  searchMs: 28000,
  // Widening into the colour group: a smaller search, only while there is time.
  widenUses: 2, widenCostUsd: 0.03, widenBeforeMs: 30000, widenSearchMs: 20000,
  // Quality floor.
  minShortSide: 480, minSeconds: 4, maxSeconds: 120,
};
const X_DOMAINS = ['x.com', 'twitter.com'];
const X_API = 'https://api.x.com/2';
const xApiOn = () => Boolean(process.env.X_BEARER_TOKEN);
const strategyNow = () => (xApiOn() ? 'xapi' : 'web');

function teamOut(team) {
  return { name: team.name, short: team.short, colors: team.colors.slice(0, 2) };
}

// Post text that says the footage is old: throwback wording, or a season/year
// two or more years back. Deterministic and conservative.
const THROWBACK = /#?\b(?:tbt|throwback(?:thursday)?|flashback(?:friday)?|on this day|years? ago|this day in (?:history|\w+ history)|anniversary|remember when)\b/i;
function looksOld(text, now = new Date()) {
  const value = String(text || '');
  if (THROWBACK.test(value)) return true;
  const year = now.getUTCFullYear();
  const years = [...value.matchAll(/(?:^|[^\d$#.,/:])((?:19|20)\d{2})(?:[-–](?:\d{2}|\d{4}))?(?![\d,.]?\d)/g)].map(m => Number(m[1]));
  return years.some(y => y >= 1900 && y <= year - 2);
}

// Verified age in hours, or null when the post carries no usable timestamp.
function ageHoursOf(postedAt, now = Date.now()) {
  const at = postedAt ? new Date(postedAt).getTime() : NaN;
  if (!Number.isFinite(at)) return null;
  const hours = (now - at) / 3600e3;
  return hours < -1 ? null : Math.max(0, hours); // a date in the future is not trusted either
}

// ── Search plan: who to target and how to ask ─────────────────────────────
// { kind, subject, official:[handles], league:[], media:[], queries:[], terms:[] }
function searchPlan({ sport, team = null, teams = [], query = '' }) {
  const { league, media } = SOURCES.sourcesFor(sport);
  const sportName = SPORT_NAMES[sport];
  if (team) {
    const own = SOURCES.handleFor(team);
    const queries = [
      own ? `x.com/${own} status video` : `${team.name} video highlights`,
      `${team.name} highlights video this week`,
      `@${league[0]} ${team.short} highlight`,
      `${media.slice(0, 2).map(h => `@${h}`).join(' OR ')} ${team.short}`,
    ];
    return { kind: 'team', subject: `${sportName} team: ${team.name} (only this team)`, official: own ? [own] : [], league, media, queries, terms: [team.short, team.name] };
  }
  if (teams.length) {
    const official = teams.map(t => SOURCES.handleFor(t)).filter(Boolean);
    const queries = [
      ...[official.slice(0, 3), official.slice(3, 6)].filter(g => g.length).map(g => `${g.map(h => `x.com/${h}`).join(' OR ')} status video`),
      `${sportName} highlights ${teams.slice(0, 4).map(t => t.short).join(' ')}`,
      `@${league[0]} highlights ${teams.slice(0, 3).map(t => t.short).join(' OR ')}`,
    ];
    return { kind: 'color', subject: `${sportName} teams: ${teams.map(t => t.name).join(', ')}`, official, league, media, queries, terms: teams.map(t => t.short) };
  }
  const named = teamInTitle(query, sport);
  const own = named ? SOURCES.handleFor(named) : '';
  const queries = [
    `${query} video`,
    own ? `x.com/${own} status ${query}` : `@${league[0]} ${query}`,
    `${media.slice(0, 2).map(h => `@${h}`).join(' OR ')} ${query}`,
    `${query} highlight`,
  ];
  return { kind: 'query', subject: `${sportName} moment: ${query}`, official: own ? [own] : [], league, media, queries, terms: keyTerms(query, named) };
}

// A few distinctive words of a moment title (names, teams) for X API queries.
function keyTerms(text, team) {
  const stop = new Set(['The', 'A', 'An', 'And', 'Of', 'In', 'On', 'At', 'To', 'For', 'With', 'After', 'Before', 'Over', 'Past', 'Vs', 'NFL', 'MLB', 'CFB']);
  const caps = (String(text).match(/\b[A-Z][\w'.-]{2,}\b/g) || []).filter(w => !stop.has(w));
  return [...new Set([...(team ? [team.short] : []), ...caps])].slice(0, 3);
}

const handleList = (label, list) => (list.length ? `${label}: ${list.map(h => `@${h}`).join(', ')}` : '');

function webPrompt(plan, { since, candidates = FIND_CLIPS.candidates, maxUses = FIND_CLIPS.maxUses } = {}) {
  return [
    plan.subject,
    'Verified accounts to search first:',
    handleList('- team', plan.official),
    handleList('- league', plan.league),
    handleList('- networks', plan.media),
    `Run up to ${maxUses} focused searches, for example:`,
    ...plan.queries.slice(0, maxUses).map((q, i) => `${i + 1}. ${q}`),
    `Find X posts made in the last 5 days (120 hours) (after ${since} UTC) that carry native video from this week's games: highlights, big plays, celebrations. Status links only (https://x.com/<handle>/status/<id>), not profile pages or articles.`,
    'Prefer the verified accounts above; other accounts only when they posted the video themselves.',
    `Reply with JSON only: {"posts": [{"url": "https://x.com/<handle>/status/<id>", "date": "YYYY-MM-DD the post was made"}]} (up to ${candidates}, verified accounts first, newest first).`,
  ].filter(Boolean).join('\n');
}

const SEARCH_SYSTEM = [
  'You find the newest sports video posts on X (Twitter) for EssentiallySports newsletter ads.',
  'Search, then reply with JSON only. List only X post URLs you actually saw in search results; never make one up or change an id.',
  'Freshness matters most: only posts made in the last 5 days (120 hours). No throwbacks, anniversaries or re-uploads of old games.',
  'Quality next: official team, league and network accounts post the cleanest HD video, so look there first.',
].join('\n');

// ── X API v2 (optional, X_BEARER_TOKEN) ───────────────────────────────────
// One recent-search call: `(from:a OR from:b) has:videos -is:retweet`. The
// query is kept under 512 characters (the limit on X's self-serve plans).
function xQueryFor(plan) {
  const tail = ' has:videos -is:retweet -is:reply';
  const from = list => `(${list.map(h => `from:${h}`).join(' OR ')})`;
  const terms = plan.terms.filter(Boolean).map(t => (/\s/.test(t) ? `"${t}"` : t));
  const about = terms.length ? ` (${terms.join(' OR ')})` : '';
  const build = (official, outlets) => {
    const parts = [];
    if (official.length) parts.push(plan.kind === 'query' && terms.length ? `(${from(official)}${about})` : from(official));
    if (outlets.length) parts.push(`(${from(outlets)}${about})`);
    return `${parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0] || ''}${tail}`;
  };
  let official = [...plan.official];
  let outlets = [...plan.league, ...plan.media.filter(h => !/^(espn|SportsCenter)$/i.test(h))];
  let q = build(official, outlets);
  while (q.length > 512 && outlets.length) { outlets = outlets.slice(0, -1); q = build(official, outlets); }
  while (q.length > 512 && official.length > 1) { official = official.slice(0, -1); q = build(official, outlets); }
  return q;
}

// Recent posts with native video from the X API, shaped like clipFromPost().
async function xApiSearch(query, { max = FIND_CLIPS.candidates } = {}) {
  const params = new URLSearchParams({
    query,
    max_results: String(Math.max(10, Math.min(100, max))),
    start_time: new Date(Date.now() - FIND_CLIPS.maxAgeHours * 3600e3 + 60e3).toISOString(),
    expansions: 'attachments.media_keys,author_id',
    'tweet.fields': 'created_at,public_metrics,author_id,attachments',
    'media.fields': 'type,variants,duration_ms,preview_image_url,public_metrics,width,height',
    'user.fields': 'username,name,verified_type',
  });
  const response = await fetch(`${X_API}/tweets/search/recent?${params}`, {
    headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Object.assign(new Error(`X API ${response.status}`), { status: response.status });
  const data = await response.json().catch(() => null);
  const media = new Map((data?.includes?.media || []).map(m => [m.media_key, m]));
  const users = new Map((data?.includes?.users || []).map(u => [u.id, u]));
  return (data?.data || []).map(post => {
    const user = users.get(post.author_id) || {};
    const video = (post.attachments?.media_keys || []).map(k => media.get(k)).find(m => m && (m.type === 'video' || m.type === 'animated_gif'));
    const handle = user.username || '';
    const url = `https://x.com/${handle || 'i'}/status/${post.id}`;
    if (!video) return { ok: false, reason: 'no-video', url };
    const variants = variantsFrom((video.variants || []).map(v => ({ url: v.url, type: v.content_type, bitrate: v.bit_rate })));
    if (!variants.length) return { ok: false, reason: 'no-video', url };
    return {
      ok: true, url, variants,
      author: user.name || '', handle,
      text: String(post.text || '').slice(0, 280),
      thumbnail: video.preview_image_url || '',
      durationMs: Number(video.duration_ms || 0),
      postedAt: postedAt(post.created_at),
      likes: Number(post.public_metrics?.like_count || 0),
      views: Number(video.public_metrics?.view_count || post.public_metrics?.impression_count || 0),
      verifiedType: String(user.verified_type || ''),
    };
  });
}

// ── Quality, ranking, de-duplication ───────────────────────────────────────
const shortSide = v => (v && v.width && v.height ? Math.min(v.width, v.height) : 0);
const qualityLabel = side => (!side ? '' : side >= 1080 ? '1080p' : side >= 720 ? '720p' : `${side}p`);
// The same video re-posted by several accounts shares X's media id.
function mediaKey(clip) {
  for (const v of clip.variants || []) {
    const m = String(v.url).match(/\/(?:amplify_video|ext_tw_video|tweet_video)\/(\d+)\//);
    if (m) return `m${m[1]}`;
  }
  const thumb = String(clip.thumb || '').replace(/\?.*$/, '');
  return thumb ? `t${thumb}` : `u${clip.url}`;
}

const SOURCE_POINTS = { official: 40, league: 32, media: 26, other: 0 };
function scoreClip(c) {
  let score = SOURCE_POINTS[c.source] ?? 0;
  if (c.source === 'other' && /^(organization|business|government)$/i.test(c.verifiedType || '')) score += 10;
  const side = c.shortSide || 0;
  score += side >= 1080 ? 20 : side >= 720 ? 15 : side >= 480 ? 6 : 3;
  score += 20 * Math.max(0, 1 - (Number(c.ageHours) || 0) / FIND_CLIPS.maxAgeHours);
  if (c.views > 0) score += Math.min(15, 2.5 * Math.log10(1 + c.views));
  else if (c.likes > 0) score += Math.min(15, 3 * Math.log10(1 + c.likes));
  const secs = (c.durationMs || 0) / 1000;
  if (secs >= 6 && secs <= 60) score += 5;
  else if (secs > 0) score += 2;
  return Math.round(score * 10) / 10;
}

// One verified post -> { clip } or { reason } (the diag bucket it fell into).
function assessClip(c, { sport = '', now = Date.now() } = {}) {
  if (!c?.ok || !c.variants?.length) return { reason: c?.reason === 'no-video' ? 'noVideo' : 'failed' };
  const age = ageHoursOf(c.postedAt, now);
  if (age === null) return { reason: 'noDate' };
  if (age > FIND_CLIPS.maxAgeHours) return { reason: 'tooOld' };
  if (looksOld(c.text, new Date(now))) return { reason: 'throwback' };
  const best = c.variants[0];
  const side = shortSide(best);
  if (side && side < FIND_CLIPS.minShortSide) return { reason: 'lowQuality' };
  const secs = (c.durationMs || 0) / 1000;
  if (secs && (secs < FIND_CLIPS.minSeconds || secs > FIND_CLIPS.maxSeconds)) return { reason: 'badLength' };
  const clip = {
    url: c.url,
    handle: c.handle || '',
    text: c.text || '',
    thumb: c.thumbnail || '',
    duration: Math.round((c.durationMs || 0) / 100) / 10,
    durationMs: c.durationMs || 0,
    postedAt: c.postedAt,
    ageHours: Math.round(age),
    variants: c.variants.map(v => ({ url: v.url, width: v.width, height: v.height, bitrate: v.bitrate })),
    source: SOURCES.classifyHandle(c.handle, sport),
    quality: qualityLabel(side),
    shortSide: side,
    likes: Number(c.likes || 0),
    views: Number(c.views || 0),
    verifiedType: c.verifiedType || '',
  };
  clip.score = scoreClip(clip);
  return { clip };
}

// Kept for callers that only want the clip (or null).
const freshClip = (c, opts) => assessClip(c, opts).clip || null;

// Best first; the same video from several accounts is kept once (best copy).
function rankClips(clips, diag = null) {
  const byKey = new Map();
  clips.forEach(c => {
    const key = mediaKey(c);
    const had = byKey.get(key);
    if (had && diag) diag.dupes += 1;
    if (!had || c.score > had.score) byKey.set(key, c);
  });
  return [...byKey.values()].sort((a, b) => b.score - a.score || a.ageHours - b.ageHours);
}

const newDiag = strategy => ({ strategy, searched: 0, listed: 0, nonPost: 0, candidates: 0, noVideo: 0, failed: 0, noDate: 0, tooOld: 0, throwback: 0, lowQuality: 0, badLength: 0, dupes: 0, kept: 0 });

// Verifies candidate posts in parallel and buckets the failures into diag.
async function verifyAll(urls, { sport, diag }) {
  const checks = await Promise.all(urls.map(url => withTimeout(clipFromPost(url), FIND_CLIPS.verifyMs, { ok: false, reason: 'timeout' })));
  return assessAll(checks, { sport, diag });
}
function assessAll(checks, { sport, diag }) {
  const now = Date.now();
  const clips = [];
  checks.forEach(check => {
    const { clip, reason } = assessClip(check, { sport, now });
    if (clip) clips.push(clip);
    else diag[reason] = (diag[reason] || 0) + 1;
  });
  return clips;
}

// One search round for a plan: X API when configured (falling back to web
// search if X refuses), else one capped web search. -> { clips, cost, diag }
async function searchRound(plan, { sport, track, feature, maxUses, maxCostUsd, timeoutMs }) {
  const diag = newDiag(strategyNow());
  if (xApiOn()) {
    try {
      const found = await xApiSearch(xQueryFor(plan));
      diag.searched = 1;
      diag.listed = found.length;
      diag.candidates = found.length;
      const clips = rankClips(assessAll(found, { sport, diag }), diag);
      diag.kept = clips.length;
      return { clips, cost: 0, diag };
    } catch (error) {
      console.warn(`video-ads ${feature}: X API failed (${error.status || error.message}); using web search`);
      diag.strategy = 'web';
      diag.xapiError = Number(error.status) || 'error';
    }
  }
  const since = new Date(Date.now() - FIND_CLIPS.maxAgeHours * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  const result = await aiWebResearch({
    tier: 'search', system: SEARCH_SYSTEM, prompt: webPrompt(plan, { since, maxUses }),
    maxUses, maxTokens: FIND_CLIPS.maxTokens, maxCostUsd, timeoutMs, allowedDomains: X_DOMAINS,
    track: { ...track, feature },
  });
  if (result.cost > maxCostUsd) console.warn(`video-ads ${feature} cost ${result.cost.toFixed(4)} over the ${maxCostUsd} cap`);
  const parsed = extractJson(result.text) || {};
  const posts = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.posts) ? parsed.posts : []);
  // The model's dates are ignored: only the verified timestamp counts.
  const listed = posts.slice(0, 40).map(p => clean(typeof p === 'string' ? p : p?.url, 300)).filter(Boolean);
  const cited = (result.urls || []).map(u => u.url);
  const all = [...new Set([...listed, ...cited])];
  const xPosts = all.filter(isXPost);
  diag.searched = result.searches || 0;
  diag.listed = all.length;
  diag.nonPost = all.length - xPosts.length;
  // Verified accounts first, so the candidate cap never cuts them.
  const rank = url => ({ official: 0, league: 1, media: 2, other: 3 })[SOURCES.classifyHandle(url.split('/')[3], sport)];
  const candidates = [...new Set(xPosts.map(u => tweet.normalizeTweetUrl(u)))].sort((a, b) => rank(a) - rank(b)).slice(0, FIND_CLIPS.candidates);
  diag.candidates = candidates.length;
  const clips = rankClips(await verifyAll(candidates, { sport, diag }), diag);
  diag.kept = clips.length;
  return { clips, cost: result.cost, diag };
}

const noteFor = n => (n < FIND_CLIPS.minClips ? { note: `Only ${n} clip${n === 1 ? '' : 's'} from the last 5 days.` } : {});
const clipKey = (strategy, sport, { team, color, query }) => `${strategy}|${sport}|${team ? `team:${team.name.toLowerCase()}` : color ? `color:${color}` : `query:${query.toLowerCase()}`}`;

// Re-ages cached clips, drops the ones that crossed 120h, and re-ranks.
const reAge = clips => clips
  .map(c => ({ ...c, ageHours: Math.round(ageHoursOf(c.postedAt) ?? Infinity) }))
  .filter(c => c.ageHours <= FIND_CLIPS.maxAgeHours)
  .map(c => (c.source ? { ...c, score: scoreClip(c) } : c))
  .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.ageHours - b.ageHours);

function fromCache(key) {
  const hit = CLIP_CACHE.get(key);
  if (!hit || Date.now() - hit.at >= CLIP_TTL_MS) return null;
  const clips = reAge(hit.value.clips);
  const note = hit.value.widened ? { note: hit.value.note } : noteFor(clips.length);
  return { ...hit.value, clips, ...note, cached: true, cost: 0 };
}
function toCache(key, value) {
  if (CLIP_CACHE.size > 120) CLIP_CACHE.delete(CLIP_CACHE.keys().next().value);
  CLIP_CACHE.set(key, { at: Date.now(), value });
}

async function findClips(body, track) {
  const started = Date.now();
  const sport = AD_SPORTS.includes(body.sport) ? body.sport : '';
  if (!sport) return { ok: false, status: 400, error: 'Pick NFL, CFB or MLB first.' };
  // Precedence: team > colour > query.
  const teamName = clean(typeof body.team === 'string' ? body.team : body.team?.name, 80);
  const team = teamName ? TEAMS.findTeam(teamName, sport) : null;
  if (teamName && !team) return { ok: false, status: 400, error: `We don't have "${teamName}" in ${SPORT_NAMES[sport]}. Pick a team from the list.` };
  const color = !team && TEAMS.colorById(body.color) ? body.color : '';
  const query = !team && !color ? clean(body.query, 160) : '';
  if (!team && !color && query.length < 3) return { ok: false, status: 400, error: 'Pick a team, a colour or a moment first.' };
  const teams = team ? [team] : (color ? TEAMS.teamsFor({ sport, color }) : []);
  const teamsOut = teams.map(teamOut);
  // A colour with no teams in this sport: nothing to search, nothing spent.
  if (color && !teams.length) return { ok: true, teams: [], clips: [], cached: false, cost: 0, note: `No ${SPORT_NAMES[sport]} teams wear that colour.` };

  const strategy = strategyNow();
  const key = clipKey(strategy, sport, { team, color, query });
  const hit = fromCache(key);
  if (hit) return hit;
  if (track.skipAi) return null; // cache miss: the caller gates and comes back

  const plan = searchPlan({ sport, team, teams: color ? teams : [], query });
  const first = await searchRound(plan, {
    sport, track, feature: 'video-ads-find-clips',
    maxUses: FIND_CLIPS.maxUses, maxCostUsd: FIND_CLIPS.maxCostUsd, timeoutMs: FIND_CLIPS.searchMs,
  });
  let cost = first.cost;
  const diag = first.diag;
  let clips = first.clips.map(c => ({ ...c, via: team && (c.source === 'league' || c.source === 'media') ? 'league' : 'search' }));
  let widened = null;
  let note = '';

  if (team) {
    const own = clips.filter(c => c.via === 'search').length;
    const steps = [];
    if (own < FIND_CLIPS.minClips && clips.some(c => c.via === 'league')) steps.push('league');
    // Still short: the team's colour group (free when cached, else one small search).
    const family = team.families[0];
    const colorObj = TEAMS.colorById(family);
    if (clips.length < FIND_CLIPS.minClips && colorObj && Date.now() - started < FIND_CLIPS.widenBeforeMs) {
      const groupKey = clipKey(strategy, sport, { color: family });
      let group = fromCache(groupKey);
      if (!group) {
        const groupTeams = TEAMS.teamsFor({ sport, color: family });
        const round = await searchRound(searchPlan({ sport, teams: groupTeams }), {
          sport, track, feature: 'video-ads-find-clips',
          maxUses: FIND_CLIPS.widenUses, maxCostUsd: FIND_CLIPS.widenCostUsd,
          timeoutMs: Math.max(5000, Math.min(FIND_CLIPS.widenSearchMs, 52000 - (Date.now() - started))),
        }).catch(error => { console.warn('video-ads widen failed:', error.message); return null; }); // the team's own results still stand
        if (round) {
          cost += round.cost;
          diag.widen = round.diag;
          group = { clips: round.clips };
          if (round.clips.length >= FIND_CLIPS.minClips) toCache(groupKey, { ok: true, teams: groupTeams.map(teamOut), clips: round.clips, strategy, diag: round.diag });
        }
      }
      const have = new Set(clips.map(mediaKey));
      const extra = (group?.clips || []).filter(c => !have.has(mediaKey(c))).map(c => ({ ...c, via: 'color' }));
      if (extra.length) {
        clips = rankClips([...clips, ...extra]);
        // Widened results go after the team's own.
        const order = { search: 0, league: 1, color: 2 };
        clips.sort((a, b) => order[a.via] - order[b.via] || b.score - a.score);
        steps.push('color');
      }
      widened = steps.length ? { to: steps, ...(steps.includes('color') ? { color: family, colorLabel: colorObj.label } : {}) } : null;
    } else if (steps.length) {
      widened = { to: steps };
    }
    if (widened) {
      const parts = [widened.to.includes('league') ? `${SPORT_NAMES[sport]} accounts` : '', widened.to.includes('color') ? `other ${colorObj.label.split(' ')[0].toLowerCase()} teams` : ''].filter(Boolean);
      note = `Fewer ${team.short} clips this week — showing ${parts.join(' and ')} too.`;
    }
  }
  clips = clips.slice(0, FIND_CLIPS.maxClips);
  diag.kept = clips.length;
  diag.ms = Date.now() - started;
  const value = { ok: true, teams: teamsOut, clips, strategy: diag.strategy, diag, ...(widened ? { widened, note } : {}) };
  toCache(key, value);
  return { ...value, ...(widened ? {} : noteFor(clips.length)), cached: false, cost: money(cost) };
}

// ─── Moments with clips (By moment: only moments that have fresh clips) ────
// One search for the top ~10 trending moments, grouped by moment, aimed at
// x.com and the sport's verified accounts (and the team's own account when the
// title names one); every post verified, filtered and ranked like find-clips.
// Shared across users for 30 minutes.
const MOMENT_CACHE = new Map();
const MOMENTS = { top: 10, maxUses: 3, maxTokens: 1700, maxCostUsd: 0.045, perMoment: 5, maxCandidates: 36 };

// The team a moment's title names first (full or short name), if any.
function teamInTitle(title, sport) {
  const text = String(title || '').toLowerCase();
  const at = name => text.search(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name.toLowerCase())}(?![\\p{L}\\p{N}])`, 'u'));
  let best = null;
  TEAMS.TEAMS.filter(t => t.sport === sport).forEach(team => {
    const found = [at(team.name), at(team.short)].filter(i => i >= 0);
    if (found.length && (!best || Math.min(...found) < best.index)) best = { team, index: Math.min(...found) };
  });
  return best ? best.team : null;
}

async function momentList(sportIn) {
  const sports = AD_SPORTS.includes(sportIn) ? [sportIn] : AD_SPORTS;
  const data = await trends();
  return (data.items || []).filter(item => sports.includes(item.sport)).slice(0, MOMENTS.top);
}

function momentsCached(key) {
  const hit = MOMENT_CACHE.get(key);
  if (!hit || Date.now() - hit.at >= CLIP_TTL_MS) return null;
  const moments = hit.value.moments.map(m => ({ ...m, clips: reAge(m.clips) })).filter(m => m.clips.length);
  return { ...hit.value, moments, cached: true, cost: 0 };
}

async function momentsWithClips(body, track) {
  const sport = AD_SPORTS.includes(body.sport) ? body.sport : 'all';
  const list = await momentList(sport);
  const key = `web|${sport}|${list.map(m => m.id).join(',')}`;
  const cached = momentsCached(key);
  if (cached) return cached;
  if (track.skipAi) return null; // cache miss: the caller gates and comes back
  if (!list.length) return { ok: true, moments: [], checked: 0, cached: false, cost: 0 };

  const since = new Date(Date.now() - FIND_CLIPS.maxAgeHours * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  const sports = [...new Set(list.map(m => m.sport))];
  const outlets = sports.map(s => {
    const src = SOURCES.sourcesFor(s);
    return `- ${SPORT_NAMES[s]}: ${[...src.league.slice(0, 3), ...src.media.slice(0, 3)].map(h => `@${h}`).join(', ')}`;
  });
  const prompt = [
    'Trending moments:',
    ...list.map((m, i) => {
      const team = teamInTitle(m.title, m.sport);
      const own = team ? SOURCES.handleFor(team) : '';
      return `${i + 1}. [${SPORT_NAMES[m.sport]}] ${m.title}${own ? ` (team account @${own})` : ''}`;
    }),
    '',
    'Verified accounts to search first (league, networks):',
    ...outlets,
    '',
    `For each moment, find X posts made in the last 5 days (120 hours) (after ${since} UTC) that carry native video OF THAT MOMENT: highlights, the play itself, celebrations, reactions. Prefer the team account and the verified accounts above. Status links only (https://x.com/<handle>/status/<id>), not profile pages or articles.`,
    `Reply with JSON only: {"moments": [{"i": <moment number>, "posts": ["https://x.com/<handle>/status/<id>"]}]} (up to ${MOMENTS.perMoment} posts per moment, verified accounts first; leave out moments with none).`,
  ].join('\n');
  const result = await aiWebResearch({
    tier: 'search', system: SEARCH_SYSTEM, prompt,
    maxUses: MOMENTS.maxUses, maxTokens: MOMENTS.maxTokens, maxCostUsd: MOMENTS.maxCostUsd, timeoutMs: 40000, allowedDomains: X_DOMAINS,
    track: { ...track, feature: 'video-ads-moments-with-clips' },
  });
  if (result.cost > MOMENTS.maxCostUsd + 0.01) console.warn(`video-ads moments-with-clips cost ${result.cost.toFixed(4)}`);
  const parsed = extractJson(result.text) || {};
  const groups = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.moments) ? parsed.moments : []);
  const diag = newDiag('web');
  diag.searched = result.searches || 0;
  // Moment index -> candidate post URLs; a post counts for its first moment only.
  const seen = new Set();
  const byMoment = new Map();
  let total = 0;
  groups.forEach(group => {
    const index = Number(group?.i ?? group?.index ?? group?.moment) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return;
    const raw = (Array.isArray(group.posts) ? group.posts : []).map(p => clean(typeof p === 'string' ? p : p?.url, 300)).filter(Boolean);
    diag.listed += raw.length;
    const posts = raw.filter(isXPost).map(u => tweet.normalizeTweetUrl(u));
    diag.nonPost += raw.length - posts.length;
    const mine = byMoment.get(index) || [];
    posts.forEach(url => {
      if (seen.has(url) || mine.length >= MOMENTS.perMoment || total >= MOMENTS.maxCandidates) return;
      seen.add(url);
      mine.push(url);
      total += 1;
    });
    if (mine.length) byMoment.set(index, mine);
  });

  const urls = [...byMoment.values()].flat();
  diag.candidates = urls.length;
  const checks = await Promise.all(urls.map(url => withTimeout(clipFromPost(url), FIND_CLIPS.verifyMs, { ok: false, reason: 'timeout' })));
  const now = Date.now();
  const verified = new Map(urls.map((url, k) => {
    const sportOf = list[[...byMoment.entries()].find(([, v]) => v.includes(url))[0]].sport;
    const { clip, reason } = assessClip(checks[k], { sport: sportOf, now });
    if (!clip) diag[reason] = (diag[reason] || 0) + 1;
    return [url, clip || null];
  }));
  const moments = list.map((m, index) => {
    const clips = rankClips((byMoment.get(index) || []).map(url => verified.get(url)).filter(Boolean), diag);
    if (!clips.length) return null;
    diag.kept += clips.length;
    const team = teamInTitle(m.title, m.sport);
    return { id: m.id, title: m.title, sport: m.sport, ...(team ? { team: teamOut(team) } : {}), publishedAt: m.publishedAt, clips };
  }).filter(Boolean);
  const value = { ok: true, moments, checked: list.length, strategy: 'web', diag };
  if (MOMENT_CACHE.size > 20) MOMENT_CACHE.delete(MOMENT_CACHE.keys().next().value);
  MOMENT_CACHE.set(key, { at: Date.now(), value });
  return { ...value, cached: false, cost: money(result.cost) };
}

// ─── Copy (3 variants in the ES styles) ────────────────────────────────────
const LIMITS = { headlineWords: 22, paragraphWords: 45, totalWords: 95, ctaChars: 32 };
const STYLES = ['simple', 'condensed', 'highlight'];
const words = text => String(text || '').split(/\s+/).filter(Boolean).length;

// What the ad is about: brand, sport, team(s) or moment, colour theme, notes.
// Only this text may supply numbers.
function copyContext(body) {
  const brand = BRANDS.byId(body.brandId);
  const sport = AD_SPORTS.includes(body.sport) ? body.sport : brand.sport;
  const trend = trendInput(body.trend || (body.title ? { title: body.title } : {}));
  const rawTeams = [...(Array.isArray(body.teams) ? body.teams : []), ...(body.team ? [body.team] : [])].slice(0, 6);
  const teams = [...new Set(rawTeams.map(t => {
    const name = clean(typeof t === 'string' ? t : t?.name, 80);
    return TEAMS.findTeam(name, sport)?.name || name;
  }).filter(Boolean))];
  const color = TEAMS.colorById(body.color);
  const notes = clean(body.notes, 600);
  const clipText = clean(body.clip?.text, 280);
  const factsText = [trend.title, ...trend.related.map(r => r.title), ...teams, notes, clipText].filter(Boolean).join(' ');
  return { brand, sport, trend, teams, color, notes, clipText, factsText };
}

function contextLines(ctx) {
  return [
    `Newsletter: ${ctx.brand.label} (${ctx.brand.league}) for ${ctx.brand.audience}. Default button: "${ctx.brand.cta}". Sport: ${SPORT_NAMES[ctx.sport]}.`,
    ctx.trend.title ? `Moment: ${ctx.trend.title}` : '',
    ...ctx.trend.related.map(r => (r.title ? `Related: ${r.title}` : '')),
    ctx.teams.length ? `Team${ctx.teams.length > 1 ? 's' : ''} in the clip: ${ctx.teams.join(', ')}` : '',
    ctx.color ? `Colour theme of this ad set: ${ctx.color.label.toLowerCase()} teams` : '',
    ctx.clipText ? `The clip's post says: ${ctx.clipText}` : '',
    ctx.notes ? `Editor's notes: ${ctx.notes}` : '',
  ].filter(Boolean);
}

// Checks one variant; returns { variant, errors }.
function checkVariant(raw, brand, factsText, wantStyle) {
  const errors = [];
  const style = STYLES.includes(raw?.style) ? raw.style : (wantStyle || 'condensed');
  const headline = clean(raw?.headline, 220);
  const body = strings(raw?.body, 3, 400);
  let highlight = clean(raw?.highlight, 120);
  const cta = clean(raw?.cta, LIMITS.ctaChars).toUpperCase() || brand.cta;
  if (!headline) errors.push('headline is missing');
  if (words(headline) > LIMITS.headlineWords) errors.push(`headline has ${words(headline)} words (max ${LIMITS.headlineWords})`);
  body.forEach((p, i) => { if (words(p) > LIMITS.paragraphWords) errors.push(`paragraph ${i + 1} has ${words(p)} words (max ${LIMITS.paragraphWords})`); });
  const total = words(headline) + body.reduce((n, p) => n + words(p), 0);
  if (total > LIMITS.totalWords) errors.push(`${total} words in all (max ${LIMITS.totalWords})`);
  if (style === 'highlight') {
    if (!highlight || !headline.toLowerCase().includes(highlight.toLowerCase())) errors.push('highlight must be words copied exactly from the headline');
  } else {
    highlight = '';
  }
  [headline, ...body].forEach(text => {
    const hit = RULES.BANNED.find(rule => rule.re.test(text));
    if (hit) errors.push(`"${text.slice(0, 60)}" breaks the ES style (${hit.why})`);
  });
  const known = new Set(numberTokens(factsText));
  [headline, ...body].forEach(text => numberTokens(text).forEach(n => {
    if (!known.has(n)) errors.push(`the number ${n} is not in the moment or your notes`);
  }));
  return { variant: { style, headline, highlight, body, cta, why: clean(raw?.why, 200) }, errors };
}

// ─── Auto-fix: deterministic repairs before any retry ──────────────────────
const sentencesOf = text => String(text || '').match(/[^.!?]+[.!?]+["'’”)\]]*\s*|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) || [];
const capFirst = text => text.replace(/^(\W*)(\p{Ll})/u, (m, pre, ch) => pre + ch.toUpperCase());
const TRAILING_FILLER = /(?:[\s,;:–—-]+|\s+(?:and|or|but|the|a|an|to|of|with|for|in|on|at|by|as|your|our|their|this|that))+$/i;
const isBanned = text => RULES.BANNED.some(rule => rule.re.test(text));

// Shortens text to `max` words: whole sentences when they fit, else a clean word cut.
function trimToWords(text, max) {
  if (words(text) <= max) return text;
  const kept = [];
  for (const sentence of sentencesOf(text)) {
    if (words([...kept, sentence].join(' ')) > max) break;
    kept.push(sentence);
  }
  if (kept.length && words(kept.join(' ')) >= max * 0.4) return kept.join(' ');
  let cut = text.split(/\s+/).slice(0, max).join(' ');
  for (let i = 0; i < 3 && TRAILING_FILLER.test(cut); i += 1) cut = cut.replace(TRAILING_FILLER, '');
  return /[.!?]$/.test(cut) ? cut : `${cut.replace(/[,;:]$/, '')}.`;
}

// Hype words -> calm synonyms (with a/an fixed); junk that can simply go is dropped.
const HYPE_SWAPS = { shocking: 'stunning', shocked: 'stunned', 'jaw-dropping': 'stunning', 'jaw dropping': 'stunning', jawdropping: 'stunning', 'mind-blowing': 'stunning', 'mind blowing': 'stunning', mindblowing: 'stunning', insane: 'wild', unbelievable: 'remarkable', 'must-see': 'big', 'must see': 'big' };
const matchCase = (source, word) => (source === source.toUpperCase() && /[A-Z]/.test(source) ? word.toUpperCase() : /^[A-Z]/.test(source) ? word[0].toUpperCase() + word.slice(1) : word);
function swapBanned(text) {
  let out = String(text || '');
  out = out.replace(/\b(?:(a|an)\s+)?(shocking|shocked|jaw[- ]?dropping|mind[- ]?blowing|insane|unbelievable|must[- ]see)\b/gi, (m, article, word) => {
    const swap = matchCase(word, HYPE_SWAPS[word.toLowerCase()] || HYPE_SWAPS[word.toLowerCase().replace(/\s+/, '-')] || 'big');
    if (!article) return swap;
    const fixed = /^[aeiou]/i.test(swap) ? 'an' : 'a';
    return `${matchCase(article, fixed)} ${swap}`;
  });
  out = out.replace(/\byou won['’]?t believe\b/gi, m => matchCase(m, 'see'));
  out = out.replace(/\bbreaking(?:\s+news)?\s*[:—–-]\s*/gi, '').replace(/\bbreaking\s+(?=news\b)/gi, '');
  out = out.replace(/\s*(?:https?:\/\/|www\.)\S+/gi, '');
  out = out.replace(/\p{Extended_Pictographic}️?/gu, '');
  out = out.replace(/#([A-Za-z0-9_]+)/g, '$1');
  out = out.replace(/!{2,}/g, '!').replace(/\?{2,}/g, '?');
  out = out.replace(/\b(?:omg|wtf|lol|smh|bruh)\b[,.!]?\s*/gi, '');
  return capFirst(out.replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').trim());
}

// Drops the sentences of `text` that `bad` flags; '' when nothing is left.
const dropSentences = (text, bad) => sentencesOf(text).filter(s => !bad(s)).join(' ');

// Closest headline phrase to the model's highlight: the longest run of headline
// words found in the highlight; else the headline's last 2-3 words.
const norm = w => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
function closestPhrase(headline, highlight) {
  const exact = headline.toLowerCase().indexOf(highlight.toLowerCase());
  if (highlight && exact >= 0) return headline.slice(exact, exact + highlight.length);
  const hw = headline.split(/\s+/).filter(Boolean);
  const want = new Set(String(highlight || '').split(/\s+/).map(norm).filter(Boolean));
  let best = [0, 0];
  for (let i = 0; i < hw.length; i += 1) {
    let j = i;
    while (j < hw.length && want.has(norm(hw[j]))) j += 1;
    if (j - i > best[1] - best[0]) best = [i, j];
  }
  const [from, to] = best[1] > best[0] ? best : [Math.max(0, hw.length - (hw.length > 6 ? 3 : 2)), hw.length];
  return hw.slice(from, to).join(' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’]+$/gu, '');
}

// Repairs a raw variant in code. Returns { raw, fixes:[{ kind, word?, note }] }.
function autoFix(input, brand, factsText, wantStyle) {
  const fixes = [];
  const fix = (kind, note, extra = {}) => fixes.push({ kind, ...extra, note });
  const style = STYLES.includes(input?.style) ? input.style : (wantStyle || 'condensed');
  let headline = clean(input?.headline, 220);
  let body = strings(input?.body, 3, 400);
  let highlight = clean(input?.highlight, 120);
  let cta = clean(input?.cta, 80);

  // Banned words: swap or strip, then drop whole sentences that still break a rule.
  // A body paragraph may go entirely ('' is returned); the headline never does.
  const scrub = (text, field, mayEmpty) => {
    if (!isBanned(text)) return text;
    const word = (RULES.BANNED.map(r => text.match(r.re)?.[0]).find(Boolean) || '').toLowerCase();
    let out = swapBanned(text);
    if (isBanned(out)) {
      const dropped = dropSentences(out, isBanned);
      if (dropped || mayEmpty) out = dropped;
    }
    if (!out && !mayEmpty) return text;
    if (!isBanned(out)) fix('banned', `Removed "${word}" from the ${field}`, /^[\p{L}' -]+$/u.test(word) ? { word } : {});
    return out;
  };
  headline = scrub(headline, 'headline', false);
  const scrubbed = body.map((p, i) => scrub(p, `paragraph ${i + 1}`, body.length > 1)).filter(Boolean);
  if (scrubbed.length) body = scrubbed;

  // Numbers that aren't in the input: drop those body sentences (never the headline's only sentence).
  const known = new Set(numberTokens(factsText));
  const invented = s => numberTokens(s).some(n => !known.has(n));
  const bodyText = () => body.join(' ');
  if (invented(bodyText())) {
    const next = body.map(p => dropSentences(p, invented)).filter(Boolean);
    if (next.length && !invented(next.join(' '))) {
      body = next;
      fix('invented_number', 'Dropped a sentence with a number that is not in the input');
    }
  }
  if (invented(headline) && sentencesOf(headline).length > 1) {
    const next = dropSentences(headline, invented);
    if (next) { headline = next; fix('invented_number', 'Dropped a headline sentence with a number that is not in the input'); }
  }

  // Length: headline, each paragraph, then the whole ad.
  if (words(headline) > LIMITS.headlineWords) {
    headline = trimToWords(headline, LIMITS.headlineWords);
    fix('headline_length', `Trimmed the headline to ${words(headline)} words`);
  }
  body = body.map((p, i) => {
    if (words(p) <= LIMITS.paragraphWords) return p;
    const next = trimToWords(p, LIMITS.paragraphWords);
    fix('paragraph_length', `Trimmed paragraph ${i + 1} to ${words(next)} words`);
    return next;
  });
  const total = () => words(headline) + body.reduce((n, p) => n + words(p), 0);
  if (total() > LIMITS.totalWords) {
    while (total() > LIMITS.totalWords && body.length > 1) body = body.slice(0, -1);
    if (total() > LIMITS.totalWords && body.length) {
      const room = LIMITS.totalWords - words(headline);
      body = room >= 6 ? [trimToWords(body[0], room)] : [];
    }
    fix('total_length', `Shortened the ad to ${total()} words`);
  }

  // Highlight: must be an exact phrase of the headline.
  if (style === 'highlight' && headline) {
    const exact = highlight && headline.includes(highlight);
    if (!exact) {
      const next = closestPhrase(headline, highlight);
      if (next) {
        fix('highlight', highlight ? `Matched the highlight to the headline: "${next}"` : `Picked a highlight from the headline: "${next}"`);
        highlight = next;
      }
    }
  }

  // CTA: uppercase, short, no banned words; else the brand's default.
  if (cta && (cta.length > LIMITS.ctaChars || isBanned(cta))) {
    fix('cta', `Replaced the button text with "${brand.cta}"`);
    cta = brand.cta;
  } else if (cta && cta !== cta.toUpperCase()) {
    fix('cta', 'Uppercased the button text');
    cta = cta.toUpperCase();
  }
  return { raw: { ...input, style, headline, body, highlight, cta }, fixes };
}

const COPY_SYSTEM = [
  'You write newsletter sign-up video ads for EssentiallySports (ES) newsletters. The ad plays over a trending sports clip.',
  'Formula: hook on the moment or team fans are talking about -> what the newsletter gives them -> it is free. Warm, punchy, plain American English. Second person ("you") or a fan\'s first person ("That\'s why I read ES Dugout").',
  'Styles: "simple" = all plain paragraphs; "condensed" = a bold condensed headline then plain paragraphs; "highlight" = an uppercase condensed headline where one phrase (copied exactly from the headline) sits on a coloured box, then plain paragraphs.',
  'Headline up to 22 words, 1-3 short paragraphs, under 95 words in all. Never invent stats, scores, quotes or subscriber counts: use numbers only if they appear in the moment, the clip or the editor\'s notes. No emojis, hashtags, links, "Breaking" or hype words.',
  'The button text is a short call to sign up (e.g. "SIGN UP ES CFB"); it is separate from the copy.',
].join('\n');

// Lessons from past ads (never blocks: empties on any problem or after 3s).
async function lessons(brand, sport, token) {
  const got = await withTimeout(learning.lessonsFor({ brandId: brand.id, sport, token }), 3000, null);
  const examples = (Array.isArray(got?.examples) ? got.examples : []).slice(0, 5).map(ex => ({
    style: STYLES.includes(ex?.style) ? ex.style : 'condensed',
    headline: clean(ex?.headline, 220),
    highlight: clean(ex?.highlight, 120),
    body: strings(Array.isArray(ex?.body) ? ex.body : [ex?.body], 3, 400),
    cta: clean(ex?.cta, 40),
  })).filter(ex => ex.headline || ex.body.length);
  const rules = strings(got?.rules, 6, 120);
  return { examples, rules };
}

function lessonLines({ examples, rules }) {
  return [
    examples.length ? `Ads we shipped for this newsletter (match the voice and length; don't reuse their facts or numbers):\n${examples.map(ex => `- ${JSON.stringify(ex)}`).join('\n')}` : '',
    rules.length ? `House rules learned from past ads:\n- ${rules.join('\n- ')}` : '',
  ].filter(Boolean);
}

async function copy(body, track) {
  const ctx = copyContext(body);
  const { brand, factsText } = ctx;
  const wantStyle = STYLES.includes(body.style) ? body.style : '';
  if (!ctx.trend.title && !ctx.teams.length && !ctx.notes && !ctx.color) {
    return { ok: false, status: 400, error: 'Pick a clip, a moment or a colour first, or write a note about the ad.' };
  }
  const learned = await lessons(brand, ctx.sport, track.token);
  const ask = [
    ...contextLines(ctx),
    ...lessonLines(learned),
    wantStyle ? `Write 3 variants, all in the "${wantStyle}" style, each a clearly different angle.` : 'Write 3 variants: one "simple", one "condensed", one "highlight", each a clearly different angle.',
    'Reply with JSON only: {"variants": [{"style": "...", "headline": "...", "highlight": "exact words from the headline (highlight style only)", "body": ["...", "..."], "cta": "...", "why": "one short line on the angle"}]}',
  ].join('\n');
  let cost = 0;
  let messages = [{ role: 'user', content: ask }];
  let good = [];
  let autoFixed = [];
  let lastErrors = [];
  let allErrors = [];
  for (let attempt = 0; attempt < 2 && good.length < 2; attempt += 1) {
    // COPY_SYSTEM is about 400 tokens, under the 512-token cache minimum, so it is
    // not marked cacheable (the hint would only add a cache-write attempt).
    const result = await aiText({ tier: 'main', system: COPY_SYSTEM, messages, json: true, maxTokens: 2000, timeoutMs: 25000, track: { ...track, feature: 'video-ads-copy' } });
    cost += result.cost;
    const parsed = extractJson(result.text);
    const variants = Array.isArray(parsed?.variants) ? parsed.variants : [];
    // Repair in code first; only what can't be repaired goes back to the model.
    const checked = variants.slice(0, 4).map(raw => {
      const repaired = autoFix(raw, brand, factsText, wantStyle);
      return { ...checkVariant(repaired.raw, brand, factsText, wantStyle), fixes: repaired.fixes };
    });
    const passed = checked.filter(c => !c.errors.length);
    good = [...good, ...passed.map(c => c.variant)].slice(0, 3);
    autoFixed = [...autoFixed, ...passed.flatMap(c => c.fixes)];
    lastErrors = checked.filter(c => c.errors.length).flatMap(c => c.errors);
    if (!variants.length) lastErrors = ['the reply had no variants'];
    allErrors = [...allErrors, ...lastErrors];
    if (good.length >= 2 || !lastErrors.length) break;
    messages = [...messages, { role: 'assistant', content: result.text }, { role: 'user', content: `Some variants broke the rules: ${lastErrors.slice(0, 8).join('; ')}. Rewrite them so every rule passes. Same JSON shape.` }];
  }
  autoFixed = autoFixed.slice(0, 12);
  // What the checks caught feeds the learning loop (best effort, never blocks for long).
  if (allErrors.length || autoFixed.length) {
    await withTimeout(learning.recordEvent({
      token: track.token,
      email: track.email,
      event: { type: 'check_failed', brandId: brand.id, sport: ctx.sport, payload: { issues: allErrors.slice(0, 12), autoFixed: autoFixed.map(({ kind, word }) => (word ? { kind, word } : { kind })) } },
    }), 1500, false);
  }
  const lessonsUsed = { examples: learned.examples.length, rules: learned.rules.length };
  if (!good.length) return { ok: false, status: 422, error: 'The AI copy did not pass the ES checks. Try again or add a note.', issues: lastErrors.slice(0, 5), autoFixed, lessons: lessonsUsed, cost: money(cost) };
  return { ok: true, variants: good, autoFixed, lessons: lessonsUsed, cost: money(cost) };
}

// ─── Assistant chat ────────────────────────────────────────────────────────
async function chat(body, track) {
  const ctx = copyContext(body);
  const { brand } = ctx;
  const layout = body.layout && typeof body.layout === 'object' ? body.layout : {};
  const history = (Array.isArray(body.messages) ? body.messages : []).slice(-12)
    .map(m => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: clean(m?.content, 1500) }))
    .filter(m => m.content);
  if (!history.length || history[history.length - 1].role !== 'user') return { ok: false, status: 400, error: 'Write a message first.' };
  const factsText = [ctx.factsText, ...history.filter(m => m.role === 'user').map(m => m.content)].join(' ');
  const system = [
    COPY_SYSTEM,
    'You are the Video Ads assistant inside FrameUp: help the editor shape this ad. Be brief and practical.',
    'When the editor asks for a change to the ad, include "patch" with only the fields to change (style, headline, highlight, body, cta). For several options, include "variants" (same shape as the copy variants). Otherwise only reply.',
    'Reply with JSON only: {"reply": "...", "patch": {...} or null, "variants": [...] or null}',
    '',
    ...contextLines(ctx),
    ctx.trend.title || ctx.teams.length ? '' : 'No clip or moment picked yet.',
    `Current ad: ${JSON.stringify({ style: layout.style, headline: clean(layout.headline, 300), highlight: clean(layout.highlight, 120), body: strings(layout.body, 3, 500), cta: clean(layout.cta, 40) })}`,
  ].filter(Boolean).join('\n');
  const result = await aiText({ tier: 'main', system, messages: history, json: true, maxTokens: 1800, timeoutMs: 25000, track: { ...track, feature: 'video-ads-chat' } });
  const parsed = extractJson(result.text) || { reply: clean(result.text, 1500) };
  const out = { ok: true, reply: clean(parsed.reply, 1500) || 'Done.', cost: money(result.cost) };
  // A change to the ad passes the same checks as AI copy; fields that fail are dropped and said so.
  if (parsed.patch && typeof parsed.patch === 'object') {
    const merged = { style: layout.style, headline: layout.headline, highlight: layout.highlight, body: layout.body, cta: layout.cta, ...parsed.patch };
    const { variant, errors } = checkVariant(merged, brand, factsText, layout.style);
    if (errors.length) out.reply += ` (I couldn't apply that change: ${errors.slice(0, 2).join('; ')}.)`;
    else out.patch = Object.fromEntries(Object.keys(parsed.patch).filter(k => k in variant).map(k => [k, variant[k]]));
  }
  if (Array.isArray(parsed.variants)) {
    const good = parsed.variants.slice(0, 3).map(v => checkVariant(v, brand, factsText, '')).filter(c => !c.errors.length).map(c => c.variant);
    if (good.length) out.variants = good;
  }
  return out;
}

// ─── Grammar check (the cheapest model) ────────────────────────────────────
// Grammar, spelling and punctuation only. Every suggestion is checked in code:
// its `original` must be an exact substring of that field, and it may not
// change a number or a brand / team name, or simply repeat the original.
// Identical requests are served from a 10-minute cache for free.
const GRAMMAR_CACHE = new Map();
const GRAMMAR_TTL_MS = 10 * 60 * 1000;
const GRAMMAR = { maxIssues: 8, maxTokens: 1500 };
const GRAMMAR_FIELDS = ['headline', 'highlight', 'body', 'cta'];
// Kept as typed (no whitespace collapse), so `original` can be matched exactly.
const rawText = (value, max) => String(value ?? '').replace(/<[^>]*>/g, ' ').slice(0, max);

function grammarCopy(body) {
  const src = body?.copy && typeof body.copy === 'object' ? body.copy : {};
  return {
    headline: rawText(src.headline, 300),
    highlight: rawText(src.highlight, 120),
    body: (Array.isArray(src.body) ? src.body : []).slice(0, 3).map(p => rawText(p, 500)),
    cta: rawText(src.cta, 40),
  };
}

// Brand and team words a suggestion must keep exactly as written.
const PROTECTED = (() => {
  const terms = new Set(['EssentiallySports', 'Essentially Sports', 'ES']);
  (BRANDS.AD_BRANDS || []).forEach(b => [b.label, b.short, b.league, b.cta, b.wordmark?.text].forEach(t => t && terms.add(String(t))));
  (TEAMS.TEAMS || []).forEach(t => [t.name, t.short].forEach(n => n && terms.add(String(n))));
  return [...terms].filter(t => t.length >= 2).sort((a, b) => b.length - a.length);
})();
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termCount = (text, term) => (text.match(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, 'gu')) || []).length;
const termCountLoose = (text, term) => (text.match(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, 'giu')) || []).length;
const changesBrand = (original, suggestion) => PROTECTED.some(term => {
  const loose = termCountLoose(original, term) + termCountLoose(suggestion, term);
  return loose > 0 && (termCount(original, term) !== termCount(suggestion, term) || termCountLoose(original, term) !== termCountLoose(suggestion, term));
});
const changesNumbers = (original, suggestion) => numberTokens(original).join('|') !== numberTokens(suggestion).join('|');
const isAllCaps = text => /\p{Lu}/u.test(text) && text === text.toUpperCase();

// Keeps only safe, exact suggestions. Returns { issues, dropped }.
function checkGrammarIssues(list, copyIn) {
  const issues = [];
  let dropped = 0;
  const seen = new Set();
  for (const raw of (Array.isArray(list) ? list : []).slice(0, 20)) {
    const field = GRAMMAR_FIELDS.includes(raw?.field) ? raw.field : '';
    const index = field === 'body' ? Number(raw?.index ?? 0) : undefined;
    const text = field === 'body' ? copyIn.body[index] : copyIn[field];
    const original = String(raw?.original ?? '');
    const suggestion = String(raw?.suggestion ?? '');
    const reason = clean(raw?.reason, 60);
    const key = `${field}|${index}|${original}`;
    const ok = field && typeof text === 'string'
      && (field !== 'body' || (Number.isInteger(index) && index >= 0 && index < copyIn.body.length))
      && original.trim() && suggestion.trim()
      && original.length <= 300 && suggestion.length <= original.length * 2 + 40
      && text.includes(original)
      && suggestion !== original
      && !changesNumbers(original, suggestion)
      && !changesBrand(original, suggestion)
      // ALL-CAPS headlines and buttons are intentional: never "fix" the casing away.
      && !(isAllCaps(original) && !isAllCaps(suggestion) && /\p{L}/u.test(suggestion))
      && !(field === 'cta' && suggestion.toLowerCase() === original.toLowerCase())
      && !seen.has(key);
    if (!ok) { dropped += 1; continue; }
    seen.add(key);
    issues.push({ field, ...(field === 'body' ? { index } : {}), original, suggestion, reason: reason || 'Grammar' });
    if (issues.length >= GRAMMAR.maxIssues) break;
  }
  return { issues, dropped };
}

const GRAMMAR_SYSTEM = [
  'You proofread short newsletter sign-up video ads for EssentiallySports (ES).',
  'Fix grammar, spelling and punctuation ONLY. Never change meaning, tone, facts, numbers, names or brand words. Never rewrite for style or length.',
  'Keep ES house style: plain American English, short punchy sentences, sentence fragments in ads are fine.',
  'ALL-CAPS headlines and the ALL-CAPS button (cta) are intentional: never change their casing.',
  'Return at most 8 issues. Each issue: {"field": "headline" | "highlight" | "body" | "cta", "index": paragraph number from 0 (body only), "original": the shortest snippet containing the mistake, copied EXACTLY from that field, "suggestion": the corrected snippet, "reason": 3-6 words}.',
  'If there are no mistakes, return an empty list. Reply with JSON only: {"issues": [...]}',
].join('\n');

const grammarKey = (brandId, copyIn) => JSON.stringify([String(brandId || ''), copyIn]);
function grammarCached(body) {
  const hit = GRAMMAR_CACHE.get(grammarKey(body.brandId, grammarCopy(body)));
  return hit && Date.now() - hit.at < GRAMMAR_TTL_MS ? { ...hit.value, cached: true, cost: 0 } : null;
}

async function grammar(body, track) {
  const copyIn = grammarCopy(body);
  if (![copyIn.headline, copyIn.highlight, ...copyIn.body, copyIn.cta].some(t => t.trim())) {
    return { ok: false, status: 400, error: 'Write some copy first.' };
  }
  const cached = grammarCached(body);
  if (cached) return cached;
  const brand = BRANDS.byId(body.brandId);
  const ask = [
    `Newsletter: ${brand.label}.`,
    `Ad copy: ${JSON.stringify({ headline: copyIn.headline, highlight: copyIn.highlight, body: copyIn.body, cta: copyIn.cta })}`,
  ].join('\n');
  const result = await aiText({ tier: 'light', system: GRAMMAR_SYSTEM, messages: [{ role: 'user', content: ask }], json: true, maxTokens: GRAMMAR.maxTokens, timeoutMs: 20000, track: { ...track, feature: 'video-ads-grammar' } });
  const parsed = extractJson(result.text);
  const list = Array.isArray(parsed) ? parsed : parsed?.issues;
  const { issues, dropped } = checkGrammarIssues(list, copyIn);
  const value = { ok: true, issues };
  if (GRAMMAR_CACHE.size > 200) GRAMMAR_CACHE.delete(GRAMMAR_CACHE.keys().next().value);
  GRAMMAR_CACHE.set(grammarKey(body.brandId, copyIn), { at: Date.now(), value });
  return { ...value, dropped, cached: false, cost: money(result.cost) };
}

const AI_MODES = { 'find-clips': findClips, 'moments-with-clips': momentsWithClips, copy, chat, grammar };
// The usage feature (and AI_DISABLE name) of each mode.
const MODE_FEATURES = { 'find-clips': 'video-ads-find-clips', 'moments-with-clips': 'video-ads-moments-with-clips', copy: 'video-ads-copy', chat: 'video-ads-chat', grammar: 'video-ads-grammar' };

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });
  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (error) { return json(400, { ok: false, error: 'Invalid request.' }); }
  try {
    if (body.mode === 'trends') return json(200, await trends());
    if (body.mode === 'clip') {
      const result = await clipFromPost(String(body.url || '').slice(0, 400));
      return json(result.ok ? 200 : result.status, result);
    }
    if (body.mode === 'research') return json(410, { ok: false, error: 'Research was removed.' });
    if (AI_MODES[body.mode]) {
      const token = bearerToken(event.headers);
      // One run id per request: a copy run's retry shares it with the first try.
      const track = { email: auth.user.email, token, runId: `va-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}` };
      // Switched off (AI_DISABLE): a calm reply before anything else, cached results included.
      const feature = MODE_FEATURES[body.mode];
      if (featureDisabled(feature)) return json(503, { ok: false, reason: 'feature-off', error: featureOffMessage(feature) });
      // A cached clip search costs nothing, so it skips the AI gates.
      if (body.mode === 'find-clips') {
        const cached = await findClips(body, { ...track, skipAi: true });
        if (cached) return json(cached.ok ? 200 : (cached.status || 502), cached);
      }
      // Same for moments-with-clips (shared 30-minute cache).
      if (body.mode === 'moments-with-clips') {
        const cached = await momentsWithClips(body, { ...track, skipAi: true }).catch(() => null);
        if (cached) return json(200, cached);
      }
      // Same for a repeated grammar check (10-minute cache).
      if (body.mode === 'grammar') {
        const cached = grammarCached(body);
        if (cached) return json(200, cached);
      }
      if (!gatewayConfigured()) return json(503, { ok: false, reason: 'off', error: 'AI is not available right now.' });
      if (await userOverHourlyLimit(token)) return json(429, { ok: false, reason: 'limit', error: "You've used a lot of AI this hour. Take a short break and try again soon." });
      const gate = await aiSpendGate(token, { feature });
      if (gate) return json(gate.status, { ok: false, reason: gate.reason, error: gate.error });
      if (String(event.body || '').length > 60000) return json(413, { ok: false, error: 'That request is too large.' });
      try {
        const result = await AI_MODES[body.mode](body, track);
        return json(result.ok ? 200 : (result.status || 502), result);
      } catch (error) {
        if (isBudgetError(error)) return json(503, { ok: false, reason: 'budget', error: "This week's AI budget is used up, so AI features are paused until it resets." });
        if (body.mode === 'find-clips') {
          console.error('video-ads find-clips failed:', error);
          return json(502, { ok: false, error: 'Clip search is unavailable right now. Paste an X link or upload a clip instead.' });
        }
        if (body.mode === 'moments-with-clips') {
          console.error('video-ads moments-with-clips failed:', error);
          return json(502, { ok: false, error: "Couldn't check which moments have clips right now." });
        }
        throw error;
      }
    }
    return json(400, { ok: false, error: 'Unknown request.' });
  } catch (error) {
    console.error('video-ads failed:', error);
    return json(502, { ok: false, error: 'Video Ads is unavailable right now. Try again in a moment.' });
  }
};

exports._test = {
  variantsFrom, isVideoUrl, sizeFromUrl, clipFromPost, trends, checkVariant, autoFix, trimToWords, swapBanned, closestPhrase,
  MODE_FEATURES, COPY_SYSTEM, findClips, momentsWithClips, teamInTitle, MOMENT_CACHE, MOMENTS, looksOld, ageHoursOf, copy, chat, CLIP_CACHE, FIND_CLIPS, grammar, checkGrammarIssues, GRAMMAR_CACHE,
  searchPlan, webPrompt, xQueryFor, xApiSearch, assessClip, freshClip, scoreClip, rankClips, mediaKey, qualityLabel, CLIP_TTL_MS, SOURCES,
  useLearning(mod) { learning = { lessonsFor: async () => ({ examples: [], rules: [] }), recordEvent: async () => false, ...mod }; },
};
