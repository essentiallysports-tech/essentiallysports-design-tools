'use strict';
// Video Ads: newsletter-signup video ads (trending sports clip + logo + copy +
// CTA). One endpoint, POST { mode, ... }:
//
//   trends      last-48h NFL / CFB / MLB moments (shared with Trend Design)
//   clip        any video link -> its direct file versions (X via video.twimg.com,
//               Bluesky, Reddit, Streamable, Vimeo, Drive, Dropbox, direct files,
//               og:video pages; YouTube / Instagram / TikTok refused with a
//               message), see _clip-link.js, so the browser downloads the clip
//               itself. Video bytes never pass through this function
//               (serverless responses are capped at ~4.5 MB).
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
//               common problems are repaired in code before the model retries.
//               Each variant also carries the fields of the no-footage styles
//               (Today's 3 headlines, Us vs Them claims) when the brief supports
//               them, and the reply has a style `suggestion`. `set: true` asks for
//               a daily set: 3 angles, each in the style that fits it best.
//               Variants are ranked by the free rubric checks (copyChecks).
//               Identical requests are served from a 10-minute cache.
//   suggest-style  the style suggestion alone, no model call (rules + what
//               this brand's exports favour)
//   chat        the Video Ads assistant: a reply, plus an optional change to the ad
//   grammar     grammar / spelling / punctuation fixes from Haiku (main tier);
//               each must quote its field exactly and keep numbers and brand
//               words; 10-minute cache
//   moments-with-clips  the top ~10 trending moments that have fresh, verified
//               clips (one capped search for all of them, shared 30-min cache)
//   claims      the Us vs Them claims per brand (admin overrides from
//               frameup_video_ad_claims, else video-ads-brands.js) + canEdit
//   save-claims an admin edits / approves one brand's claims (RLS: admins only)
//   library     the shared clip library (_clip-library.js) for a sport, team
//               filter, newest / most popular, paged; no AI, no cost
//   research    removed (410)
//
// find-clips and moments-with-clips read the shared clip library first (filled
// by the /api/clips-prefetch cron and by every live search) and only top up
// with live sources (web search or X API, plus _clip-source-grok.js and
// _clip-source-public.js when present) when it has fewer than 9 good clips.
// New finds are written back. See project-docs/clips-library.md.
//
// Every request needs a signed-in ES user; AI modes count toward the hourly limit.
const { verifyEsUser, bearerToken } = require('./_supabase-auth.js');
const { getTrends } = require('./trend-design.js');
const { _helpers: tweet } = require('./tweet-oembed.js');
const { aiText, aiWebResearch, gatewayConfigured, isBudgetError, userOverHourlyLimit, aiSpendGate, featureDisabled, featureOffMessage, freeModeGate, inFreeMode, withAiMode } = require('./_ai-gateway.js');
const RULES = require('../../frameup-rules.js');
const rest = require('./_supabase-rest.js');
const BRANDS = require('../../video-ads-brands.js');
const TEAMS = require('../../video-ads-teams.js');
const STYLE_RULES = require('../../video-ads-styles.js');

// The learning loop (_ad-learning.js) is optional: without it, copy works as before.
let learning = { lessonsFor: async () => ({ examples: [], rules: [] }), styleRankingFor: async () => [], recordEvent: async () => false };
try { learning = { ...learning, ...require('./_ad-learning.js') }; } catch { /* not deployed yet */ }

// The shared clip library (works in memory before its migration is applied).
const CLIP_LIBRARY = require('./_clip-library.js');
const CLIP_LINK = require('./_clip-link.js');
// Is it great game action? (AI verdict stored per clip, else free rules.)
const CLASSIFY = require('./_clip-classify.js');

// Extra clip sources (shared interface, scratchpad clips-contract.md), loaded
// defensively: each lives on its own branch until merged. CLIPS_EXTRA_SOURCES=off
// switches them all off.
const isOffValue = value => /^(off|0|false|no|disabled)$/i.test(String(value ?? '').trim());
let EXTRA_SOURCES = [];
['./_clip-source-grok.js', './_clip-source-public.js'].forEach(file => {
  try {
    const mod = require(file);
    if (mod && typeof mod.search === 'function' && typeof mod.configured === 'function') EXTRA_SOURCES.push(mod);
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') console.warn(`video-ads: clip source ${file} failed to load: ${error.message}`);
  }
});
const clipSources = () => (isOffValue(process.env.CLIPS_EXTRA_SOURCES) ? [] : EXTRA_SOURCES);
// AI-backed sources cost money: skipped when AI is gated, budgeted in the cron.
const isPaidSource = s => s.paid === true || s.ai === true || s.id === 'grok';

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
  maxUses: 4, maxTokens: 1600, maxCostUsd: 0.06, candidates: 25, maxClips: 36, maxAgeHours: 120, minClips: 3, verifyMs: 6000,
  searchMs: 28000,
  // Widening into the colour group: a smaller search, only while there is time.
  widenUses: 2, widenCostUsd: 0.03, widenBeforeMs: 30000, widenSearchMs: 20000,
  // Quality floor: 720p, one shared constant (CLIP_MIN_SHORT_SIDE, _clip-library.js).
  minShortSide: CLIP_LIBRARY.CLIP_MIN_SHORT_SIDE, minSeconds: 4, maxSeconds: 120,
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
  // No team, colour or query: the sport's most-watched highlights (By moment).
  if (!query) {
    const outlets = [...league.slice(0, 2), ...media.slice(0, 2)];
    return {
      kind: 'sport', subject: `${sportName}: the most-watched game highlights of the last 5 days`, official: [], league, media,
      queries: [`${outlets.map(h => `@${h}`).join(' OR ')} highlight video`, `${sportName} viral highlight this week`, `@${league[0]} top plays`, `${sportName} best plays video`],
      terms: [],
    };
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
  // The AI quality score (1-5), when the daily job has judged the clip.
  if (c.ai && c.ai.by === 'ai' && Number(c.ai.quality) >= 1) score += 3 * (Number(c.ai.quality) - 3);
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
  // 720p floor; a file of unknown size can't prove it, so it is dropped too.
  if (!side || side < FIND_CLIPS.minShortSide) return { reason: 'lowQuality' };
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
    source: sourceOf(c, sport),
    quality: qualityLabel(side),
    shortSide: side,
    likes: Number(c.likes || 0),
    views: Number(c.views || 0),
    verifiedType: c.verifiedType || '',
    platform: c.platform || 'x',
  };
  clip.sourceKind = clip.source === 'other' ? 'fan' : clip.source;
  if (typeof c.hasAudio === 'boolean') clip.hasAudio = c.hasAudio;
  if (c.foundBy) clip.foundBy = c.foundBy;
  if (Array.isArray(c.teams) && c.teams.length) clip.teams = c.teams.slice(0, 8);
  if (Array.isArray(c.players) && c.players.length) clip.players = c.players.slice(0, 8);
  if (c.ai && typeof c.ai.isGameAction === 'boolean') clip.ai = c.ai;
  // Game action only (podcasts, pressers, promos and memes are dropped).
  if (!CLASSIFY.isGreat(clip)) return { reason: 'notGame' };
  clip.score = scoreClip(clip);
  return { clip };
}

// X posts: the verified-source registry decides (never a source's claim).
// Other platforms: the source module's sourceKind ('fan' -> 'other').
function sourceOf(c, sport) {
  if (!c.platform || c.platform === 'x') return SOURCES.classifyHandle(c.handle, sport);
  return ['official', 'league', 'media'].includes(c.sourceKind) ? c.sourceKind : 'other';
}

// Kept for callers that only want the clip (or null).
const freshClip = (c, opts) => assessClip(c, opts).clip || null;

// Best first; the same video from several accounts is kept once (best copy).
// Across platforms (a Reddit or Bluesky re-upload of a team's X video) the
// media ids differ, so a second, conservative key: the same length to the
// second and the same opening words of a caption long enough to be distinctive.
function softKey(c) {
  const text = String(c.text || '').toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!c.durationMs || text.length < 24) return '';
  return `s${Math.round(c.durationMs / 1000)}|${text.slice(0, 40)}`;
}
function rankClips(clips, diag = null) {
  const seen = new Set();
  const kept = [];
  // Best copy first (stable, so ties keep their order), then skip any copy
  // that shares its url, media id or soft key with one already kept.
  [...clips].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).forEach(c => {
    const keys = [`u${c.url}`, mediaKey(c), softKey(c)].filter(Boolean);
    if (keys.some(k => seen.has(k))) { if (diag) diag.dupes = (diag.dupes || 0) + 1; return; }
    keys.forEach(k => seen.add(k));
    kept.push(c);
  });
  return kept.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.ageHours - b.ageHours);
}

const newDiag = strategy => ({ strategy, searched: 0, listed: 0, nonPost: 0, candidates: 0, noVideo: 0, failed: 0, noDate: 0, tooOld: 0, throwback: 0, lowQuality: 0, badLength: 0, notGame: 0, dupes: 0, kept: 0 });

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
// freeOnly (AI paused or gated): the X API only, never the paid web search.
async function searchRound(plan, { sport, track, feature, maxUses, maxCostUsd, timeoutMs, freeOnly = false }) {
  const diag = newDiag(strategyNow());
  if (freeOnly && !xApiOn()) return { clips: [], cost: 0, diag: { ...diag, strategy: 'none' } };
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
      if (freeOnly) return { clips: [], cost: 0, diag: { ...diag, strategy: 'none' } };
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
// Fallback clips labelled 'older' may be up to the library's 7 days.
const reAge = clips => clips
  .map(c => ({ ...c, ageHours: Math.round(ageHoursOf(c.postedAt) ?? Infinity) }))
  .filter(c => c.ageHours <= (c.via === 'older' ? CLIP_LIBRARY.KEEP_DAYS * 24 : FIND_CLIPS.maxAgeHours))
  .map(c => (c.source ? { ...c, score: scoreClip(c) } : c))
  .sort((a, b) => viaRank(a) - viaRank(b) || (b.score ?? 0) - (a.score ?? 0) || a.ageHours - b.ageHours);
// The request's own clips first, then widened ones, then labelled fallbacks.
const VIA_ORDER = { search: 0, league: 1, color: 2, older: 3, sport: 4, colorx: 5 };
function viaRank(c) { return VIA_ORDER[c.via] ?? 0; }

function fromCache(key) {
  const hit = CLIP_CACHE.get(key);
  if (!hit || Date.now() - hit.at >= CLIP_TTL_MS) return null;
  const clips = reAge(hit.value.clips);
  const note = hit.value.widened || hit.value.fallback ? { note: hit.value.note } : noteFor(clips.length);
  return { ...hit.value, clips, ...note, cached: true, cost: 0 };
}
function toCache(key, value) {
  if (CLIP_CACHE.size > 120) CLIP_CACHE.delete(CLIP_CACHE.keys().next().value);
  CLIP_CACHE.set(key, { at: Date.now(), value });
}

// ── Shared clip library + extra sources ───────────────────────────────────
// enough: library clips that make a live search unnecessary. maxOut: clips a
// response carries (the page shows 9 at a time, "Load more" for the rest).
const LIBRARY = { enough: 9, readMs: 3500, writeMs: 3000, sourceMs: 25000, maxOut: 36, fallbackFill: 9, momentSources: 3, momentPaid: 2 };

// Hosts a direct (non-X) MP4 may come from. All answer CORS * (measured by
// the clips-public branch, 2026-11-17), so the browser downloads them itself
// and no server stream is needed. CLIPS_MEDIA_HOSTS adds exact host names.
const MEDIA_HOSTS = [/^video\.twimg\.com$/, /^v\.redd\.it$/, /^(?:[a-z0-9-]+\.)*streamable\.com$/, /^(?:[a-z0-9-]+\.)*bsky\.network$/, /^bsky\.social$/];
function mediaHostAllowed(raw, env = process.env) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase();
  const extra = String(env.CLIPS_MEDIA_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  return MEDIA_HOSTS.some(re => re.test(host)) || extra.includes(host);
}

// Is a direct MP4 still there? HEAD, or a 2-byte range GET when HEAD is
// refused. Never reads the video. -> { ok, dead, status }
async function checkMedia(url) {
  if (!mediaHostAllowed(url)) return { ok: false, dead: false, status: 0, reason: 'host' };
  const looksVideo = type => !type || /video|octet-stream|binary|mp4/i.test(type);
  const ask = async (method, headers = {}) => {
    const response = await fetch(url, { method, headers: { 'User-Agent': 'FrameUp/1.0 (+https://frameup.essentiallysports.com)', ...headers }, redirect: 'follow', signal: AbortSignal.timeout(5000) });
    try { await response.body?.cancel?.(); } catch { /* nothing to cancel */ }
    return response;
  };
  try {
    let response = await ask('HEAD');
    if ([403, 405, 501].includes(response.status)) response = await ask('GET', { Range: 'bytes=0-1' });
    const ok = (response.status === 200 || response.status === 206) && looksVideo(response.headers?.get?.('content-type'));
    return { ok, dead: [404, 410].includes(response.status), status: response.status };
  } catch {
    return { ok: false, dead: false, status: 0 };
  }
}

// One candidate from a source module -> the clipFromPost() shape (ok / reason).
// X posts are verified by clipFromPost (verified timestamp, video.twimg.com);
// direct MP4s by checkMedia, keeping the source's verified timestamp.
async function verifyCandidate(cand) {
  const extra = {
    ...(cand.foundBy ? { foundBy: cand.foundBy } : {}),
    ...(Array.isArray(cand.teams) ? { teams: cand.teams } : {}),
    ...(Array.isArray(cand.players) ? { players: cand.players } : {}),
  };
  if ((cand.platform === 'x' || !cand.mediaUrl) && isXPost(cand.url)) {
    const result = await clipFromPost(cand.url);
    return result.ok ? { ...result, platform: 'x', ...extra } : result;
  }
  if (!cand.mediaUrl) return { ok: false, reason: 'no-video' };
  const media = await checkMedia(cand.mediaUrl);
  if (!media.ok) return { ok: false, reason: media.dead ? 'dead' : 'unreachable' };
  return {
    ok: true,
    url: httpsUrl(cand.url) || cand.mediaUrl,
    platform: clean(cand.platform, 24) || 'web',
    handle: clean(cand.handle, 80),
    text: clean(cand.text, 280),
    thumbnail: httpsUrl(cand.thumb),
    durationMs: Number(cand.durationMs || 0),
    postedAt: postedAt(cand.postedAt),
    likes: Number(cand.likes || 0),
    views: Number(cand.views || 0),
    verifiedType: '',
    variants: [{ url: cand.mediaUrl, width: Number(cand.width || 0), height: Number(cand.height || 0), bitrate: 0 }],
    sourceKind: cand.sourceKind,
    ...(typeof cand.hasAudio === 'boolean' ? { hasAudio: cand.hasAudio } : {}),
    ...extra,
  };
}

// The extra source modules for one request: run in parallel (free ones
// always, paid ones unless freeOnly / paid:false), candidates verified and
// assessed. Candidates already in the library (known urls) are not re-checked.
// -> { clips, cost, diag: { <sourceId>: { searched, found, kept, cost, ... } } }
// only: 'paid' runs just the paid sources (the cron's second, budgeted pass).
async function runSources(opts, { track = {}, freeOnly = false, paid = true, only = '', known = new Set(), timeoutMs = LIBRARY.sourceMs } = {}) {
  const active = clipSources().filter(s => {
    try {
      if (!s.configured(process.env)) return false;
      if (only === 'paid') return isPaidSource(s) && !freeOnly;
      return !((freeOnly || !paid) && isPaidSource(s));
    } catch { return false; }
  });
  if (!active.length) return { clips: [], cost: 0, diag: {} };
  const runs = await Promise.all(active.map(async s => {
    try {
      const result = await withTimeout(s.search({
        sinceHours: FIND_CLIPS.maxAgeHours, limit: FIND_CLIPS.candidates, ...opts,
        track: { ...track, feature: `video-ads-clips-${s.id}` }, token: track.token || '', env: process.env,
      }), timeoutMs, null);
      if (!result) return { id: s.id, candidates: [], cost: 0, diag: { timeout: 1 } };
      const candidates = (Array.isArray(result.candidates) ? result.candidates : [])
        .filter(c => c && typeof c.url === 'string')
        .map(c => ({ ...c, foundBy: c.platform && c.platform !== 'x' ? c.platform : s.id }));
      return { id: s.id, candidates, cost: Number(result.cost) || 0, diag: result.diag && typeof result.diag === 'object' ? result.diag : {} };
    } catch (error) {
      return { id: s.id, candidates: [], cost: 0, diag: { error: String(error?.message || error).slice(0, 80) } };
    }
  }));
  const diag = {};
  const seen = new Set(known);
  const jobs = [];
  runs.forEach(run => {
    const d = { ...run.diag, found: run.candidates.length, verified: 0, kept: 0, cost: money(run.cost) };
    diag[run.id] = d;
    run.candidates.forEach(cand => {
      const key = isXPost(cand.url) ? tweet.normalizeTweetUrl(cand.url) : cand.url;
      if (seen.has(key)) { d.known = (d.known || 0) + 1; return; }
      seen.add(key);
      jobs.push({ id: run.id, cand: isXPost(cand.url) ? { ...cand, url: key } : cand });
    });
  });
  const capped = jobs.slice(0, 40);
  const checks = await Promise.all(capped.map(job => withTimeout(verifyCandidate(job.cand), FIND_CLIPS.verifyMs, { ok: false, reason: 'timeout' })));
  const now = Date.now();
  const clips = [];
  checks.forEach((check, i) => {
    const d = diag[capped[i].id];
    const { clip, reason } = assessClip(check, { sport: opts.sport, now });
    if (clip) { d.kept += 1; clips.push(clip); } else d[`drop_${reason}`] = (d[`drop_${reason}`] || 0) + 1;
    if (check?.ok) d.verified += 1;
  });
  return { clips, cost: runs.reduce((sum, r) => sum + r.cost, 0), diag };
}

// Teams named in a text (full name, or a short name unique within the sport).
function teamsInText(text, sport) {
  const value = String(text || '');
  if (!value) return [];
  const list = TEAMS.TEAMS.filter(t => t.sport === sport);
  const shortCount = new Map();
  list.forEach(t => shortCount.set(t.short.toLowerCase(), (shortCount.get(t.short.toLowerCase()) || 0) + 1));
  const has = name => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'iu').test(value);
  return list.filter(t => has(t.name) || (shortCount.get(t.short.toLowerCase()) === 1 && has(t.short))).map(t => t.name);
}

// The teams a clip is about: the official account's team, teams named in its
// text, and the searched team when the clip came from the team's own search.
function clipTeams(clip, { sport, team = null } = {}) {
  const own = SOURCES.teamForHandle(clip.handle);
  const ownInSport = own && TEAMS.findTeam(own, sport) ? [own] : [];
  return [...new Set([...(clip.teams || []), ...ownInSport, ...teamsInText(clip.text, sport), ...(team ? [team.name] : [])])].slice(0, 8);
}

// Writes verified clips back to the library (best effort, bounded wait).
async function saveToLibrary(clips, { sport, team = null } = {}) {
  if (!clips.length || !CLIP_LIBRARY.enabled()) return 0;
  const items = clips.filter(c => !c.fromLibrary && c.via !== 'older').map(c => {
    const { via, ...clip } = c;
    const ownSearch = team && (via === 'search' || !via) && (SOURCES.teamForHandle(c.handle) === team.name || teamsInText(c.text, sport).includes(team.name));
    return { clip: { ...clip, mediaKey: mediaKey(c) }, sport, teams: clipTeams(c, { sport, team: ownSearch ? team : null }), foundBy: c.foundBy || '' };
  });
  const result = await withTimeout(CLIP_LIBRARY.write(items), LIBRARY.writeMs, { written: 0 });
  return result.written || 0;
}

const termHit = (clip, terms) => {
  const hay = `${clip.text || ''} ${(clip.teams || []).join(' ')}`.toLowerCase();
  return terms.some(t => t.length >= 3 && hay.includes(t.toLowerCase()));
};

// Library clips for a request. teams: team objects (empty = the whole sport);
// terms: words that must appear (moments). -> { fresh, older } (re-scored, de-duplicated)
async function libraryClips({ sport, teams = [], terms = [], token = '' } = {}) {
  if (!CLIP_LIBRARY.enabled()) return { fresh: [], older: [] };
  const rows = await withTimeout(CLIP_LIBRARY.read({ sport, teams: teams.map(t => t.name), sinceHours: CLIP_LIBRARY.KEEP_DAYS * 24, token }), LIBRARY.readMs, []);
  const now = Date.now();
  const clips = (rows || [])
    .map(c => ({ ...c, ageHours: Math.round(ageHoursOf(c.postedAt, now) ?? Infinity) }))
    .filter(c => Number.isFinite(c.ageHours) && !looksOld(c.text, new Date(now)) && CLASSIFY.isGreat(c))
    .filter(c => !terms.length || termHit(c, terms))
    .map(c => ({ ...c, score: scoreClip(c) }));
  return {
    fresh: rankClips(clips.filter(c => c.ageHours <= FIND_CLIPS.maxAgeHours)),
    older: rankClips(clips.filter(c => c.ageHours > FIND_CLIPS.maxAgeHours)),
  };
}

// Never empty while the library has something nearby: the same team's older
// clips (5-7 days), then the same sport, then teams of the same colour in the
// other sports. Each clip is labelled (via older / sport / colorx).
async function nearestFallback({ sport, team = null, teams = [], lib, have, token, need = LIBRARY.fallbackFill }) {
  const seen = new Set(have.map(mediaKey));
  const out = [];
  const steps = [];
  const take = (list, via) => {
    let added = 0;
    list.forEach(c => {
      if (out.length + have.length >= need || seen.has(mediaKey(c))) return;
      seen.add(mediaKey(c));
      out.push({ ...c, via });
      added += 1;
    });
    if (added) steps.push(via);
  };
  if (teams.length) take(lib.older, 'older');
  if (out.length + have.length < need) take((await libraryClips({ sport, token })).fresh, 'sport');
  const family = team ? team.families[0] : '';
  if (family && out.length + have.length < need) {
    for (const other of AD_SPORTS.filter(s => s !== sport)) {
      const group = TEAMS.teamsFor({ sport: other, color: family });
      if (group.length) take((await libraryClips({ sport: other, teams: group, token })).fresh, 'colorx');
    }
  }
  return { clips: out, steps: [...new Set(steps)] };
}

function fallbackNote(steps, { sport, team, query }) {
  const what = team ? `${team.short} clips` : query ? 'clips for this moment' : 'clips for these teams';
  const parts = steps.map(step => ({
    older: team ? `older ${team.short} clips` : 'older clips',
    sport: `other ${SPORT_NAMES[sport]} clips`,
    colorx: team ? `other ${TEAMS.colorById(team.families[0])?.label.split(' ')[0].toLowerCase() || 'same-colour'} teams` : 'same-colour teams',
  })[step]).filter(Boolean);
  return parts.length ? `Few fresh ${what} — showing ${parts.join(', then ')} from the clip library.` : '';
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

  const freeOnly = Boolean(track.freeOnly);
  const strategy = strategyNow();
  const key = clipKey(strategy, sport, { team, color, query });
  const hit = freeOnly ? null : fromCache(key);
  if (hit) return hit;

  // 1. The shared library: instant and free. Enough good clips: done.
  const named = query ? teamInTitle(query, sport) : null;
  const libTeams = team ? [team] : color ? teams : (named ? [named] : []);
  const terms = query ? keyTerms(query, named) : [];
  const lib = await libraryClips({ sport, teams: libTeams, terms: named ? [] : terms, token: track.token });
  const viaOf = c => (team && (c.source === 'league' || c.source === 'media') ? 'league' : 'search');
  if (lib.fresh.length >= LIBRARY.enough) {
    const clips = lib.fresh.slice(0, LIBRARY.maxOut).map(c => ({ ...c, via: viaOf(c) }));
    clips.sort((a, b) => viaRank(a) - viaRank(b) || b.score - a.score);
    const diag = { ...newDiag('library'), kept: clips.length, sources: { library: lib.fresh.length }, ms: Date.now() - started };
    return { ok: true, teams: teamsOut, clips, strategy: 'library', diag, fromLibrary: true, cached: false, cost: 0 };
  }
  if (track.skipAi) return null; // not enough in the library: the caller gates and comes back

  // 2. Live top-up: web search or X API, plus the extra sources, in parallel.
  const plan = searchPlan({ sport, team, teams: color ? teams : [], query });
  const [first, extra] = await Promise.all([
    searchRound(plan, {
      sport, track, feature: 'video-ads-find-clips', freeOnly,
      maxUses: FIND_CLIPS.maxUses, maxCostUsd: FIND_CLIPS.maxCostUsd, timeoutMs: FIND_CLIPS.searchMs,
    }),
    runSources({ sport, team: team ? teamOut(team) : null, teams: teams.map(teamOut), color, query }, {
      track, freeOnly, known: new Set(lib.fresh.map(c => c.url)),
    }),
  ]);
  let cost = first.cost + extra.cost;
  const diag = first.diag;
  diag.sources = { library: lib.fresh.length, [first.diag.strategy]: first.clips.length, ...extra.diag };
  const found = [...first.clips, ...extra.clips];
  const fromLib = new Set(lib.fresh.map(c => c.url));
  let clips = rankClips([...found, ...lib.fresh.filter(c => !found.some(f => f.url === c.url))], diag).map(c => ({ ...c, via: viaOf(c) }));
  let widened = null;
  let note = '';
  const widenFound = [];

  if (team) {
    const own = clips.filter(c => c.via === 'search').length;
    const steps = [];
    if (own < FIND_CLIPS.minClips && clips.some(c => c.via === 'league')) steps.push('league');
    // Still short: the team's colour group (library or cache first, else one small search).
    const family = team.families[0];
    const colorObj = TEAMS.colorById(family);
    if (clips.length < FIND_CLIPS.minClips && colorObj && Date.now() - started < FIND_CLIPS.widenBeforeMs) {
      const groupKey = clipKey(strategy, sport, { color: family });
      const groupTeams = TEAMS.teamsFor({ sport, color: family });
      let group = freeOnly ? null : fromCache(groupKey);
      if (!group) {
        const libGroup = await libraryClips({ sport, teams: groupTeams, token: track.token });
        if (libGroup.fresh.length >= FIND_CLIPS.minClips) group = { clips: libGroup.fresh };
      }
      if (!group) {
        const round = await searchRound(searchPlan({ sport, teams: groupTeams }), {
          sport, track, feature: 'video-ads-find-clips', freeOnly,
          maxUses: FIND_CLIPS.widenUses, maxCostUsd: FIND_CLIPS.widenCostUsd,
          timeoutMs: Math.max(5000, Math.min(FIND_CLIPS.widenSearchMs, 52000 - (Date.now() - started))),
        }).catch(error => { console.warn('video-ads widen failed:', error.message); return null; }); // the team's own results still stand
        if (round) {
          cost += round.cost;
          diag.widen = round.diag;
          group = { clips: round.clips };
          widenFound.push(...round.clips);
          if (round.clips.length >= FIND_CLIPS.minClips && !freeOnly) toCache(groupKey, { ok: true, teams: groupTeams.map(teamOut), clips: round.clips, strategy, diag: round.diag });
        }
      }
      const have = new Set(clips.map(mediaKey));
      const extraClips = (group?.clips || []).filter(c => !have.has(mediaKey(c))).map(c => ({ ...c, via: 'color' }));
      if (extraClips.length) {
        clips = rankClips([...clips, ...extraClips]);
        // Widened results go after the team's own.
        clips.sort((a, b) => viaRank(a) - viaRank(b) || b.score - a.score);
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

  // 3. New finds go into the library for everyone.
  const saved = await saveToLibrary([...found.map(c => ({ ...c, via: viaOf(c) })), ...widenFound], { sport, team: team || named });
  if (saved) diag.librarySaved = saved;

  // 4. Never empty while the library has something nearby (labelled).
  let fallback = null;
  if (clips.length < FIND_CLIPS.minClips) {
    const near = await nearestFallback({ sport, team: team || named, teams: libTeams, lib, have: clips, token: track.token });
    if (near.clips.length) {
      clips = [...clips, ...near.clips];
      fallback = { steps: near.steps };
      const fbNote = fallbackNote(near.steps, { sport, team: team || named, query });
      note = note ? `${note} ${fbNote}` : fbNote;
    }
  }
  clips = clips.slice(0, FIND_CLIPS.maxClips);
  diag.kept = clips.length;
  diag.fromLibrary = clips.filter(c => fromLib.has(c.url) || c.fromLibrary).length;
  diag.ms = Date.now() - started;
  const value = { ok: true, teams: teamsOut, clips, strategy: diag.strategy, diag, ...(widened ? { widened } : {}), ...(fallback ? { fallback } : {}), ...(widened || fallback ? { note } : {}) };
  if (!freeOnly) toCache(key, value);
  return { ...value, ...(widened || fallback ? {} : noteFor(clips.filter(c => c.via !== 'older').length)), cached: false, cost: money(cost), ...(freeOnly ? { freeOnly: true } : {}) };
}

// ─── By moment: the most popular clips of the last 5 days ─────────────────
// Owner's definition (2026-11-18): "Moments are the recent 5 days' trending
// clips, and clips can be distributed according to teams and colours." So a
// moment is a PLAY, not a news headline:
//   1. Pool: the shared clip library for the sport(s) (last 5 days, >= 720p,
//      game action only), instant and free.
//   2. Thin pool (fewer than MOMENTS.enough moments): top up with the free
//      sources (X API when configured, public sources), then, only if still
//      thin and AI is allowed, one capped paid round for the thinnest sport
//      (Haiku x.com search $0.03 cap + Grok via its own cap). New finds go
//      into the library.
//   3. Cluster near-duplicates of the same play into one moment (media key,
//      soft key, caption words + same teams + posted within 6 h); the best
//      version first, the others as "+N angles" (video-ads-moments.js).
//   4. Rank by trending: engagement per hour, engagement, recency, source,
//      quality, the AI quality score, and the number of angles. Too few view
//      counts to rank by: newest first, labelled (ranking: 'newest').
//   5. Titles: the post text, cleaned. Long or messy ones may get one light-
//      tier AI call per refresh for the whole batch (<= $0.005, cached 6 h,
//      kept only when every name and number is in the post text).
//   6. Never empty: too few fresh moments -> the library's older clips (5-7
//      days), labelled; the page keeps its "Make it without a clip" options.
// Reply: { ok, moments:[{id, title, titleBy, sport, teams[], score, velocity,
//   views, likes, postedAt, latestAt, ageHours, angles, clips:[best, ...alts]}],
//   ranking, note, facets:{teams, colors}, diag, cost }. Shared 30-min cache per sport.
const MOMENTS_LIB = require('../../video-ads-moments.js');
const MOMENT_CACHE = new Map();
const MOMENT_TITLE_CACHE = new Map(); // clip url -> { title, at }
const MOMENTS = {
  enough: 12, max: 60, minFresh: 3,
  paidUses: 2, paidCostUsd: 0.03,
  titleBatch: 12, titleMaxTokens: 420, titleTtlMs: 6 * 3600e3, titleMaxUsd: 0.005,
  titleFeature: 'video-ads-moments-with-clips-titles',
};

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

// Clip -> the shape the moments module clusters (sport + teams always set).
const poolClip = (c, sport) => ({ ...c, sport: c.sport || sport, teams: clipTeams(c, { sport }) });

// Moments for the page: teams as objects (logo lookups on the page), titles,
// facets for the Team / Colour filters.
function momentsOut(moments) {
  return moments.slice(0, MOMENTS.max).map(m => {
    const cached = m.clips.map(c => MOMENT_TITLE_CACHE.get(c.url)).find(x => x && x.title && Date.now() - x.at < MOMENTS.titleTtlMs);
    const { sourceText, ...rest } = m;
    return {
      ...rest,
      ...(cached ? { title: cached.title, titleBy: 'ai' } : {}),
      teams: m.teams.map(name => TEAMS.findTeam(name, m.sport)).filter(Boolean).map(t => ({ ...teamOut(t), families: t.families.slice(0, 3) })),
    };
  });
}

// One light-tier call titles the moments whose cleaned post text is long or
// had to fall back. Kept only when grounded in the post text. -> cost
async function titleMoments(moments, track) {
  const need = moments
    .filter(m => (m.titleCut || m.titleBy === 'fallback') && m.sourceText)
    .filter(m => !m.clips.some(c => { const x = MOMENT_TITLE_CACHE.get(c.url); return x && Date.now() - x.at < MOMENTS.titleTtlMs; }))
    .slice(0, MOMENTS.titleBatch);
  if (!need.length || isOffValue(process.env.VIDEO_ADS_MOMENT_TITLES)) return 0;
  if (typeof track.titleGate !== 'function' || !(await track.titleGate().catch(() => false))) return 0;
  const prompt = [
    'Write a short title (4-9 words) for each sports video post below.',
    'Summarise ONLY what the post text says: use only names, teams and numbers that appear in it. No hype words, no emoji, no hashtags.',
    'Reply with JSON only: {"titles":[{"i":1,"title":"..."}]}',
    '',
    ...need.map((m, i) => `${i + 1}. ${clean(m.sourceText, 280)}`),
  ].join('\n');
  try {
    const result = await aiText({ tier: 'light', system: 'You write short, factual titles for sports clips. JSON only.', messages: [{ role: 'user', content: prompt }], json: true, maxTokens: MOMENTS.titleMaxTokens, timeoutMs: 12000, track: { ...track, feature: MOMENTS.titleFeature } });
    if (result.cost > MOMENTS.titleMaxUsd) console.warn(`video-ads moment titles cost ${result.cost.toFixed(4)} over ${MOMENTS.titleMaxUsd}`);
    const parsed = extractJson(result.text) || {};
    const got = new Map();
    (Array.isArray(parsed.titles) ? parsed.titles : []).forEach(item => {
      const m = need[Number(item?.i) - 1];
      const title = m ? MOMENTS_LIB.groundedTitle(item.title, m.sourceText) : '';
      if (title) got.set(m, title);
    });
    // Rejected or missing titles are remembered too (title: ''), so a refresh
    // never pays twice for the same moment within 6 hours.
    need.forEach(m => {
      while (MOMENT_TITLE_CACHE.size > 2000) MOMENT_TITLE_CACHE.delete(MOMENT_TITLE_CACHE.keys().next().value);
      m.clips.forEach(c => MOMENT_TITLE_CACHE.set(c.url, { title: got.get(m) || '', at: Date.now() }));
    });
    return Number(result.cost) || 0;
  } catch (error) {
    console.warn('video-ads moment titles failed:', error.message);
    return 0;
  }
}

function momentsCached(key) {
  const hit = MOMENT_CACHE.get(key);
  if (!hit || Date.now() - hit.at >= CLIP_TTL_MS) return null;
  return hit.value;
}

// Pool -> the reply (clusters, ranking, never-empty fill, facets).
async function assembleMoments(pool, { sports, track, diag, older = [] }) {
  const built = MOMENTS_LIB.buildMoments(pool);
  let moments = built.moments;
  let note = '';
  let ranking = built.thin ? 'newest' : 'trending';
  if (moments.length < MOMENTS.minFresh && older.length) {
    const have = new Set(pool.map(c => c.url));
    const fill = MOMENTS_LIB.buildMoments(older.filter(c => !have.has(c.url)).map(c => ({ ...c, via: 'older' })), { windowHours: CLIP_LIBRARY.KEEP_DAYS * 24 }).moments;
    if (fill.length) {
      moments = [...moments, ...fill.map(m => ({ ...m, via: 'older' }))];
      note = 'Few fresh clips this week — older clips (5-7 days) from the clip library are added at the end.';
    }
  }
  if (!note && ranking === 'newest' && moments.length) note = 'Not enough view counts yet to rank by trending — showing the newest verified clips.';
  const cost = await titleMoments(moments.slice(0, 24), track);
  const out = momentsOut(moments);
  diag.kept = out.length;
  diag.clips = out.reduce((n, m) => n + m.clips.length, 0);
  diag.clustered = pool.length - built.moments.length;
  return { moments: out, ranking, note, facets: MOMENTS_LIB.momentFacets(out.map(m => ({ ...m, teams: m.teams.map(t => t.name) }))), cost };
}

async function momentsWithClips(body, track) {
  const started = Date.now();
  const sport = AD_SPORTS.includes(body.sport) ? body.sport : 'all';
  const sports = sport === 'all' ? AD_SPORTS : [sport];
  const freeOnly = Boolean(track.freeOnly);
  const key = `trending|${sport}`;
  const cached = freeOnly ? null : momentsCached(key);
  if (cached) {
    // Re-age and re-rank from the cached pool (cheap, no network).
    const diag = { ...cached.diag, strategy: 'cache' };
    const value = await assembleMoments(cached.pool, { sports, track, diag, older: cached.older });
    return { ok: true, ...value, strategy: cached.strategy, diag, cached: true, cost: money(value.cost) };
  }

  // 1. The library (free): fresh pool + older clips for the never-empty fill.
  const libs = await Promise.all(sports.map(s => libraryClips({ sport: s, token: track.token }).then(r => ({ s, ...r }))));
  let pool = libs.flatMap(r => r.fresh.map(c => poolClip(c, r.s)));
  const older = libs.flatMap(r => r.older.map(c => poolClip(c, r.s)));
  const diag = { ...newDiag('library'), sources: { library: pool.length } };
  let cost = 0;
  const enough = list => MOMENTS_LIB.buildMoments(list).moments.length >= MOMENTS.enough;
  if (!enough(pool)) {
    if (track.skipAi) return null; // thin: the caller gates and comes back
    // 2a. Free top-up: X API (when configured) + the free public sources, per sport.
    const known = new Set(pool.map(c => c.url));
    const free = await Promise.all(sports.map(async s => {
      const [xr, extra] = await Promise.all([
        xApiOn() ? searchRound(searchPlan({ sport: s }), { sport: s, track, feature: 'video-ads-moments-with-clips', freeOnly: true, maxUses: 0, maxCostUsd: 0, timeoutMs: 12000 }).catch(() => null) : null,
        runSources({ sport: s }, { track, freeOnly: true, known, timeoutMs: 15000 }),
      ]);
      return { s, clips: [...(xr?.clips || []), ...extra.clips], diag: { ...(xr ? { xapi: xr.clips.length } : {}), ...extra.diag } };
    }));
    const found = [];
    free.forEach(r => { r.clips.forEach(c => found.push(poolClip(c, r.s))); Object.assign(diag.sources, Object.fromEntries(Object.entries(r.diag).map(([id, d]) => [`${r.s}:${id}`, typeof d === 'object' ? d.kept || 0 : d]))); });
    pool = [...pool, ...found.filter(c => !known.has(c.url))];
    // 2b. Paid, only when still thin and AI is allowed: the thinnest sport.
    if (!freeOnly && !enough(pool)) {
      const counts = sports.map(s => ({ s, n: pool.filter(c => c.sport === s).length })).sort((a, b) => a.n - b.n);
      const s = counts[0].s;
      const [web, paid] = await Promise.all([
        xApiOn() ? null : searchRound(searchPlan({ sport: s }), { sport: s, track, feature: 'video-ads-moments-with-clips', maxUses: MOMENTS.paidUses, maxCostUsd: MOMENTS.paidCostUsd, timeoutMs: 25000 }).catch(() => null),
        runSources({ sport: s }, { track, only: 'paid', known: new Set(pool.map(c => c.url)), timeoutMs: 25000 }),
      ]);
      cost += (web?.cost || 0) + paid.cost;
      diag.strategy = 'web';
      diag.paidSport = s;
      if (web) { diag.sources[`${s}:web`] = web.clips.length; ['searched', 'listed', 'candidates', 'noVideo', 'tooOld', 'throwback', 'lowQuality', 'notGame', 'badLength'].forEach(k => { diag[k] = (diag[k] || 0) + (web.diag[k] || 0); }); }
      Object.entries(paid.diag).forEach(([id, d]) => { diag.sources[`${s}:${id}`] = d.kept || 0; });
      const paidClips = [...(web?.clips || []), ...paid.clips].map(c => poolClip(c, s));
      const have = new Set(pool.map(c => c.url));
      found.push(...paidClips);
      pool = [...pool, ...paidClips.filter(c => !have.has(c.url))];
    }
    // New finds go into the library for everyone.
    let saved = 0;
    for (const s of sports) {
      const mine = found.filter(c => c.sport === s);
      if (mine.length) saved += await saveToLibrary(mine, { sport: s });
    }
    if (saved) diag.librarySaved = saved;
  }
  pool = rankClips(pool); // one copy per url / media id; clustering keeps the angles
  const value = await assembleMoments(pool, { sports, track, diag, older });
  cost += value.cost;
  diag.ms = Date.now() - started;
  const strategy = diag.strategy;
  if (!freeOnly) {
    if (MOMENT_CACHE.size > 12) MOMENT_CACHE.delete(MOMENT_CACHE.keys().next().value);
    MOMENT_CACHE.set(key, { at: Date.now(), value: { pool, older, strategy, diag } });
  }
  return { ok: true, ...value, strategy, diag, ...(strategy === 'library' ? { fromLibrary: true } : {}), cached: false, cost: money(cost), ...(freeOnly ? { freeOnly: true } : {}) };
}

// ─── Clip library browsing (no AI, no cost) ────────────────────────────────
// POST { mode: 'library', sport, team?, sort: 'newest' | 'popular', offset, limit }
async function libraryMode(body, { token = '' } = {}) {
  const sport = AD_SPORTS.includes(body.sport) ? body.sport : '';
  if (!sport) return { ok: false, status: 400, error: 'Pick NFL, CFB or MLB first.' };
  const teamName = clean(typeof body.team === 'string' ? body.team : body.team?.name, 80);
  const team = teamName ? TEAMS.findTeam(teamName, sport) : null;
  const sort = ['popular', 'newest'].includes(body.sort) ? body.sort : 'trending';
  const offset = Math.max(0, Math.min(500, Math.floor(Number(body.offset) || 0)));
  const limit = Math.max(1, Math.min(LIBRARY.maxOut, Math.floor(Number(body.limit) || 18)));
  const { fresh } = await libraryClips({ sport, teams: team ? [team] : [], token });
  const popularity = c => (c.views > 0 ? Math.log10(1 + c.views) : 0) + (c.likes > 0 ? 1.2 * Math.log10(1 + c.likes) : 0);
  // Trending (default): views or likes per hour, recency, source, quality, AI score.
  const now = Date.now();
  const trend = c => MOMENTS_LIB.trendScore({ velocity: MOMENTS_LIB.velocityOf(c, now), engagement: MOMENTS_LIB.engagementOf(c), ageHours: c.ageHours, best: c }) + (c.ai?.by === 'ai' ? 3 * (Number(c.ai.quality) - 3) : 0);
  const sorted = [...fresh].sort(sort === 'popular'
    ? (a, b) => popularity(b) - popularity(a) || b.score - a.score
    : sort === 'trending' ? (a, b) => trend(b) - trend(a) || new Date(b.postedAt) - new Date(a.postedAt)
      : (a, b) => new Date(b.postedAt) - new Date(a.postedAt));
  // Team filter chips: the teams with fresh clips in this sport (all of them, not just this page).
  const all = team ? (await libraryClips({ sport, token })).fresh : fresh;
  const counts = new Map();
  all.forEach(c => (c.teams || []).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  const teamsOut = [...counts.entries()]
    .map(([name, count]) => ({ team: TEAMS.findTeam(name, sport), count }))
    .filter(x => x.team)
    .sort((a, b) => b.count - a.count || a.team.name.localeCompare(b.team.name))
    .slice(0, 40)
    .map(x => ({ ...teamOut(x.team), count: x.count }));
  return {
    ok: true, sport, sort, offset, limit,
    team: team ? teamOut(team) : null,
    total: sorted.length,
    clips: sorted.slice(offset, offset + limit),
    teams: teamsOut,
    newestAt: fresh.reduce((max, c) => (!max || c.postedAt > max ? c.postedAt : max), ''),
    store: CLIP_LIBRARY.status().store,
  };
}

// ─── Copy (3 variants in the ES styles) ────────────────────────────────────
const LIMITS = { headlineWords: 22, paragraphWords: 45, totalWords: 95, ctaChars: 32 };
const STYLES = Object.keys(BRANDS.STYLES);
const CLASSIC = BRANDS.CLASSIC_STYLES;
const NEW_STYLES = BRANDS.NEW_STYLES;
const SL = STYLE_RULES.LIMITS;
const words = text => String(text || '').split(/\s+/).filter(Boolean).length;

// What the ad is about: brand, sport, team(s) or moment, colour theme, notes.
// Only this text may supply numbers and headlines; claims about the
// newsletter come only from the brand's approved list.
function copyContext(body, { claims = null } = {}) {
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
  // Headlines the editor already has (Today's 3), and other trending titles the page sent.
  const typedItems = strings(body.items, 3, 200);
  const headlines = [...new Set([...trend.related.map(r => r.title), ...strings(body.headlines, 8, 200), ...typedItems].filter(Boolean))].slice(0, 10);
  const factsText = [trend.title, ...headlines, ...teams, notes, clipText].filter(Boolean).join(' ');
  const facts = {
    text: factsText,
    // Grounding for headlines.
    sources: [notes, clipText, trend.title, ...headlines].filter(Boolean),
    headlines: [trend.title, ...headlines].filter(Boolean),
    // The brand's claims: an admin's saved list (claimsFor) or the file's.
    claims: (Array.isArray(claims) ? claims : brand.verifiedClaims || []).slice(0, 12),
    teams,
  };
  return { brand, sport, trend, teams, color, notes, clipText, factsText, facts, headlines, typedItems };
}

function contextLines(ctx) {
  return [
    `Newsletter: ${ctx.brand.label} (${ctx.brand.league}) for ${ctx.brand.audience}. Default button: "${ctx.brand.cta}". Sport: ${SPORT_NAMES[ctx.sport]}.`,
    ctx.trend.title ? `Moment: ${ctx.trend.title}` : '',
    ...ctx.headlines.map(title => `Related: ${title}`),
    ctx.teams.length ? `Team${ctx.teams.length > 1 ? 's' : ''} in the clip: ${ctx.teams.join(', ')}` : '',
    ctx.color ? `Colour theme of this ad set: ${ctx.color.label.toLowerCase()} teams` : '',
    ctx.clipText ? `The clip's post says: ${ctx.clipText}` : '',
    ctx.notes ? `Editor's notes: ${ctx.notes}` : '',
    ctx.facts.claims.length ? `Approved claims about ${ctx.brand.label} (the only claims allowed, copy them exactly): ${ctx.facts.claims.map(c => `"${c}"`).join(', ')}` : '',
  ].filter(Boolean);
}

// Facts for the checks: the context's facts object, or (older callers) a plain string.
const factsOf = (facts, brand) => (facts && typeof facts === 'object'
  ? { text: '', sources: [], headlines: [], claims: [], teams: [], ...facts }
  : { text: String(facts || ''), sources: [String(facts || '')], headlines: [String(facts || '')], claims: (brand?.verifiedClaims || []), teams: [] });

// Cuts to `max` words without adding punctuation (labels, list items).
const cutWords = (text, max) => {
  const list = String(text || '').split(/\s+/).filter(Boolean);
  if (list.length <= max) return list.join(' ');
  let cut = list.slice(0, max).join(' ');
  for (let i = 0; i < 3 && TRAILING_FILLER.test(cut); i += 1) cut = cut.replace(TRAILING_FILLER, '');
  return cut.replace(/[,;:]$/, '');
};

// The no-footage styles' fields, cleaned (no checks yet).
function styleFieldsOf(raw) {
  return {
    offer: clean(raw?.offer, 200),
    listTitle: clean(raw?.listTitle, 120),
    items: strings(raw?.items, 3, 200),
    them: strings(raw?.them, 3, 80),
    us: strings(raw?.us, 3, 80),
  };
}
const GROUP_FIELDS = {
  today3: ['listTitle', 'items'],
  versus: ['them', 'us'],
};
const emptyOf = field => (['items', 'them', 'us'].includes(field) ? [] : '');
// Problems with one style's fields ([] = fine). `known` = numbers in the facts.
function groupErrors(group, f, facts, known) {
  const errors = [];
  const numbersOk = text => STYLE_RULES.numberTokens(text).every(n => known.has(n));
  if (group === 'today3') {
    if (f.items.length < 3) errors.push(`today3 needs 3 headlines (got ${f.items.length})`);
    if (words(f.listTitle) > SL.listTitleWords) errors.push(`listTitle has ${words(f.listTitle)} words (max ${SL.listTitleWords})`);
    f.items.forEach((item, i) => {
      if (words(item) > SL.itemWords) errors.push(`headline ${i + 1} has ${words(item)} words (max ${SL.itemWords})`);
      if (!STYLE_RULES.groundedIn(item, facts.headlines.concat(facts.sources))) errors.push(`headline ${i + 1} is not one of the stories given`);
      if (!numbersOk(item)) errors.push(`headline ${i + 1} has a number that is not in the stories`);
    });
  }
  if (group === 'versus') {
    if (f.them.length < 2) errors.push('versus needs 2-3 "them" lines');
    if (f.us.length < 2) errors.push('versus needs 2-3 approved claims');
    f.them.forEach(t => {
      if (words(t) > SL.themWords) errors.push(`"${t}" is over ${SL.themWords} words`);
      if (STYLE_RULES.namesSomeone(t)) errors.push(`"${t}" names someone; keep "them" generic`);
      if (STYLE_RULES.numberTokens(t).length) errors.push(`"${t}" has a number`);
    });
    f.us.forEach(u => { if (!STYLE_RULES.approvedClaim(u, facts.claims)) errors.push(`"${u}" is not an approved claim`); });
  }
  return errors;
}

// Checks one variant; returns { variant, errors }. The classic styles check
// the headline / body; a no-footage style checks its own fields (errors),
// and the other styles' fields ride along only when they pass (else they
// are emptied: the variant grid can't use them, nothing else breaks).
function checkVariant(raw, brand, factsIn, wantStyle) {
  const facts = factsOf(factsIn, brand);
  const factsText = facts.text;
  const errors = [];
  const style = STYLES.includes(raw?.style) ? raw.style : (wantStyle || 'condensed');
  const classic = CLASSIC.includes(style);
  const headline = clean(raw?.headline, 220);
  const body = strings(raw?.body, 3, 400);
  let highlight = clean(raw?.highlight, 120);
  const cta = clean(raw?.cta, LIMITS.ctaChars).toUpperCase() || brand.cta;
  if (classic) {
    if (!headline) errors.push('headline is missing');
    if (words(headline) > LIMITS.headlineWords) errors.push(`headline has ${words(headline)} words (max ${LIMITS.headlineWords})`);
    body.forEach((p, i) => { if (words(p) > LIMITS.paragraphWords) errors.push(`paragraph ${i + 1} has ${words(p)} words (max ${LIMITS.paragraphWords})`); });
    const total = words(headline) + body.reduce((n, p) => n + words(p), 0);
    if (total > LIMITS.totalWords) errors.push(`${total} words in all (max ${LIMITS.totalWords})`);
  }
  if (style === 'highlight') {
    if (!highlight || !headline.toLowerCase().includes(highlight.toLowerCase())) errors.push('highlight must be words copied exactly from the headline');
  } else {
    highlight = '';
  }
  const known = new Set(numberTokens(factsText));
  const f = styleFieldsOf(raw);
  const own = GROUP_FIELDS[style] ? style : '';
  Object.keys(GROUP_FIELDS).forEach(group => {
    const touched = GROUP_FIELDS[group].some(k => (Array.isArray(f[k]) ? f[k].length : f[k]));
    if (group !== own && !touched) return;
    const problems = groupErrors(group, f, facts, known);
    if (group === own) errors.push(...problems);
    else if (problems.length) GROUP_FIELDS[group].forEach(k => { f[k] = emptyOf(k); });
  });
  if (!classic) {
    if (!f.offer) errors.push('offer is missing');
    else if (words(f.offer) > SL.offerWords) errors.push(`offer has ${words(f.offer)} words (max ${SL.offerWords})`);
    else if (!/\bfree\b/i.test(f.offer)) errors.push('offer must say it is free');
  }
  const texts = [headline, ...body, f.offer, f.listTitle, ...f.items, ...f.them];
  texts.filter(Boolean).forEach(text => {
    const hit = RULES.BANNED.find(rule => rule.re.test(text));
    if (hit) errors.push(`"${text.slice(0, 60)}" breaks the ES style (${hit.why})`);
  });
  // Today's 3 titles may say "3" ("3 things NFL fans need to know").
  [headline, ...body, f.offer, f.listTitle].forEach(text => numberTokens(text).forEach(n => {
    if (!known.has(n) && !(text === f.listTitle && n === '3')) errors.push(`the number ${n} is not in the moment or your notes`);
  }));
  return { variant: { style, headline, highlight, body, cta, ...f, why: clean(raw?.why, 200) }, errors: [...new Set(errors)] };
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
function autoFix(input, brand, factsIn, wantStyle) {
  const facts = factsOf(factsIn, brand);
  const factsText = facts.text;
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
  // The no-footage styles' fields.
  const f = styleFieldsOf(input);
  // (known: the numbers in the facts, from above.)
  const own = GROUP_FIELDS[style] ? style : '';
  const scrubField = (text, field) => (text ? scrub(text, field, true) : text);
  ['offer', 'listTitle'].forEach(k => { f[k] = scrubField(f[k], k); });
  ['items', 'them'].forEach(k => { f[k] = f[k].map(t => scrubField(t, k)).filter(Boolean); });
  // Offer: short, and it says free (the default offer when there is none).
  if (!CLASSIC.includes(style)) {
    if (!f.offer) { f.offer = STYLE_RULES.defaultsFor(brand, style).offer; fix('offer', 'Added the offer line'); }
    if (words(f.offer) > SL.offerWords) { f.offer = trimToWords(f.offer, SL.offerWords); fix('offer', `Trimmed the offer to ${words(f.offer)} words`); }
    if (!/\bfree\b/i.test(f.offer)) { f.offer = `${f.offer.replace(/[.!\s]*$/, '')}. Free.`; fix('offer', 'Added “Free.” to the offer'); }
  }
  // Today's 3: short, real stories only.
  if (words(f.listTitle) > SL.listTitleWords) f.listTitle = cutWords(f.listTitle, SL.listTitleWords);
  const items = f.items.map(t => cutWords(t, SL.itemWords));
  f.items = items.filter(t => STYLE_RULES.groundedIn(t, facts.headlines.concat(facts.sources)) && STYLE_RULES.numberTokens(t).every(n => known.has(n)));
  if (f.items.length < items.length && own === 'today3') fix('today3', 'Dropped a headline that is not one of the stories given');
  // Us vs Them: generic "them", approved claims only.
  const them = f.them.map(t => cutWords(t, SL.themWords));
  f.them = them.filter(t => !STYLE_RULES.namesSomeone(t) && !STYLE_RULES.numberTokens(t).length);
  if (f.them.length < them.length && own === 'versus') fix('versus', 'Dropped a "your feed" line that named someone');
  const us = f.us.map(u => STYLE_RULES.approvedClaim(u, facts.claims)).filter(Boolean);
  if (us.length < f.us.length && own === 'versus') fix('claims', 'Dropped a claim that is not on the approved list');
  f.us = [...new Set(us)];
  if (own === 'versus' && f.us.length < 2 && facts.claims.length >= 2) {
    f.us = [...new Set([...f.us, ...facts.claims])].slice(0, SL.sideItems);
    fix('claims', 'Used the approved claims');
  }
  return { raw: { ...input, style, headline, body, highlight, cta, ...f }, fixes };
}

// The static system prompt (≥ 1,024 characters, identical on every call) is
// marked cacheable: repeat calls within 5 minutes read it at 10% of the price.
// The rules mirror the rating rubric in _ad-rating.js (offer clarity, CTA,
// 55+ readability, trust), so the copy is written to score well.
const COPY_SYSTEM = [
  'You write newsletter sign-up video ads for EssentiallySports (ES) newsletters. The ad plays over a sports clip, an animated background in team colours or a photo. The goal is one thing: a free newsletter sign-up.',
  'Formula: hook on the moment or team fans are talking about -> what the newsletter gives them -> it is free. Warm, plain American English. Second person ("you") or a fan\'s first person ("That\'s why I read ES Dugout").',
  'Write to score well with a reviewer who checks: (1) the offer is unmistakable: say it is a free newsletter or a free email and name it; (2) easy reading for fans aged 55+: short common words, sentences of 14 words or fewer, one idea per sentence, no slang, no abbreviations a casual fan would not know; (3) trust: calm and specific, no clickbait questions, no superlatives you cannot back up, no urgency tricks, at most one exclamation mark; (4) the button asks for the sign-up.',
  'Styles: "simple" = all plain paragraphs; "condensed" = a bold condensed headline then plain paragraphs; "highlight" = an uppercase condensed headline where one phrase (copied exactly from the headline) sits on a coloured box, then plain paragraphs.',
  'Styles that need no footage: "today3" (Today\'s 3) = a short title (listTitle, max 9 words) and three real stories from the related headlines or notes, each rewritten plainly and calmly in max 9 words (items), no rumours as facts, no "Breaking"; "versus" (Us vs Them) = 2-3 generic things fans put up with (them, max 5 words each, never a named outlet, person or brand) and 2-3 claims about the newsletter copied exactly from the approved claims (us). Every no-footage style also has an offer line (offer, max 16 words) that says it is free.',
  'Headline up to 22 words, 1-3 short paragraphs, under 95 words in all. Never invent stats, scores, quotes, headlines or subscriber counts: use numbers only if they appear in the moment, the clip or the editor\'s notes, and leave a style\'s fields empty when its facts are missing. Never imply a player or coach endorses the newsletter. No emojis, hashtags, links, "Breaking" or hype words.',
  'Angles that work for these ads: the moment (what just happened and why it matters to fans), save time (one email instead of many apps and feeds), belonging (your team, your Saturday or Sunday ritual), stay ahead (know before your friends). Each variant uses a different angle and says which in "why".',
  'The button text is a short call to sign up (e.g. "SIGN UP ES CFB"); it is separate from the copy.',
].join('\n');

// Lessons from past ads (never blocks: empties on any problem or after 3s).
// Examples in the requested style come first.
async function lessons(brand, sport, token, style = '') {
  const got = await withTimeout(learning.lessonsFor({ brandId: brand.id, sport, token }), 3000, null);
  const examples = (Array.isArray(got?.examples) ? got.examples : []).slice(0, 5).map(ex => {
    const out = {
      style: BRANDS.styleOr(ex?.style),
      headline: clean(ex?.headline, 220),
      highlight: clean(ex?.highlight, 120),
      body: strings(Array.isArray(ex?.body) ? ex.body : [ex?.body], 3, 400),
      cta: clean(ex?.cta, 40),
    };
    const extra = styleFieldsOf(ex);
    Object.keys(extra).forEach(k => { if (Array.isArray(extra[k]) ? extra[k].length : extra[k]) out[k] = extra[k]; });
    return out;
  }).filter(ex => ex.headline || ex.body.length || ex.offer)
    .sort((a, b) => (b.style === style) - (a.style === style));
  const rules = strings(got?.rules, 6, 120);
  return { examples, rules };
}
// This brand's styles ranked by exports and light editing (_ad-learning.js); [] on any problem.
async function styleRanking(brand, sport, token) {
  const got = await withTimeout(Promise.resolve().then(() => learning.styleRankingFor({ brandId: brand.id, sport, token })), 2500, []);
  return (Array.isArray(got) ? got : []).filter(r => r && STYLES.includes(r.style)).map(r => ({ style: r.style, score: Math.max(0, Math.min(1, Number(r.score) || 0)), exports: Number(r.exports) || 0 }));
}

function lessonLines({ examples, rules }) {
  return [
    examples.length ? `Ads we shipped for this newsletter (match the voice and length; don't reuse their facts or numbers):\n${examples.map(ex => `- ${JSON.stringify(ex)}`).join('\n')}` : '',
    rules.length ? `House rules learned from past ads:\n- ${rules.join('\n- ')}` : '',
  ].filter(Boolean);
}

// What the brief supports, for the suggestion and the "skip" rules.
function factsForSuggestion(ctx, body = {}) {
  return STYLE_RULES.briefFacts({
    notes: ctx.notes,
    clipText: ctx.clipText,
    trendTitle: ctx.trend.title,
    related: ctx.headlines,
    copy: { items: ctx.typedItems },
    brand: ctx.brand,
    hasClip: body.hasClip === true,
  });
}
// The style suggestion: rules first, then this brand's ranking, then the AI's pick (near-ties only).
function suggestionFor(ctx, body, ranking, aiPick = '') {
  return STYLE_RULES.suggestStyles(factsForSuggestion(ctx, body), { ranking, aiPick: STYLES.includes(aiPick) ? aiPick : '', brand: ctx.brand });
}
// A no-footage style asked for without its facts: say so before any AI call.
function skipReason(style, facts) {
  if (style === 'today3' && facts.relatedCount < 3) return { skip: 'no headlines', error: 'Today’s 3 needs 3 real headlines: pick a trending moment, or type them into the style’s fields.' };
  if (style === 'versus' && facts.claims < 2) return { skip: 'no claims', error: 'Us vs Them needs at least 2 approved claims for this newsletter.' };
  return null;
}

const VARIANT_SHAPE = '{"style": "...", "headline": "...", "highlight": "exact words from the headline (highlight style only)", "body": ["...", "..."], "cta": "...", "offer": "...", "listTitle": "", "items": [], "them": [], "us": [], "why": "the angle, in 2-4 words"}';

// Identical copy requests (same brief, style and set flag) within 10 minutes
// are served free. Saving a brand's claims clears it.
const COPY_CACHE = new Map();
const COPY_TTL_MS = 10 * 60 * 1000;
function copyKey(body) {
  const pick = k => (Array.isArray(body[k]) ? body[k].slice(0, 12).map(x => (typeof x === 'string' ? x : JSON.stringify(x))) : clean(typeof body[k] === 'object' ? JSON.stringify(body[k]) : body[k], 600));
  return JSON.stringify(['brandId', 'sport', 'style', 'set', 'trend', 'title', 'team', 'teams', 'color', 'notes', 'clip', 'items', 'headlines', 'hasClip'].map(k => (k === 'set' || k === 'hasClip' ? body[k] === true : pick(k))));
}
function copyCached(body) {
  const hit = COPY_CACHE.get(copyKey(body));
  return hit && Date.now() - hit.at < COPY_TTL_MS ? { ...hit.value, cached: true, cost: 0 } : null;
}
// Best first by the free rubric checks (clear offer, 55+ readability, trust,
// button); ties keep the model's order.
function rankVariants(list, brand) {
  return list.map((v, i) => ({ v, i, n: STYLE_RULES.copyChecks(v, brand).passed })).sort((a, b) => b.n - a.n || a.i - b.i).map(x => x.v);
}

async function copy(body, track) {
  const cached = copyCached(body);
  if (cached) return cached;
  const claims = await claimsFor(BRANDS.byId(body.brandId), track.token);
  const ctx = copyContext(body, { claims: claims.claims });
  ctx.brand = { ...ctx.brand, verifiedClaims: claims.claims, claimsApproved: claims.approved };
  const { brand, facts } = ctx;
  const wantStyle = STYLES.includes(body.style) ? body.style : '';
  const dailySet = body.set === true && !wantStyle;
  if (!ctx.trend.title && !ctx.teams.length && !ctx.notes && !ctx.color && !ctx.typedItems.length) {
    return { ok: false, status: 400, error: 'Pick a clip, a moment or a colour first, or write a note about the ad.' };
  }
  const [learned, ranking] = await Promise.all([lessons(brand, ctx.sport, track.token, wantStyle), styleRanking(brand, ctx.sport, track.token)]);
  const brief = factsForSuggestion(ctx, body);
  const skip = wantStyle ? skipReason(wantStyle, brief) : null;
  if (skip) return { ok: false, status: 422, reason: 'skip', ...skip, suggestion: suggestionFor(ctx, body, ranking) };
  const isNew = NEW_STYLES.includes(wantStyle);
  const ask = [
    ...contextLines(ctx),
    ...lessonLines(learned),
    wantStyle ? `Write 3 variants, all in the "${wantStyle}" style, each a clearly different angle.`
      : dailySet ? 'This is today\'s ad set: write 3 variants, each a clearly different angle from the list above. For each, choose the style that fits that angle best (use "today3" or "versus" only when their facts are given); use at least two different styles.'
        : 'Write 3 variants: one "simple", one "condensed", one "highlight", each a clearly different angle.',
    isNew
      ? 'Also give each variant a headline and 1-2 short body paragraphs on the same angle, so it can run in a classic style too.'
      : 'Also fill the no-footage fields (listTitle, items, them, us, offer) on the same angle wherever the facts support them, so the same copy can run as Today\'s 3 or Us vs Them. Leave a field empty when its facts are missing.',
    `Then name the one style that fits this brief best as "bestStyle" (one of: ${STYLES.join(', ')}), with "bestWhy" in under 10 words.`,
    `Reply with JSON only: {"variants": [${VARIANT_SHAPE}], "bestStyle": "...", "bestWhy": "..."}`,
  ].join('\n');
  let cost = 0;
  let messages = [{ role: 'user', content: ask }];
  let good = [];
  let autoFixed = [];
  let lastErrors = [];
  let allErrors = [];
  let aiPick = '';
  for (let attempt = 0; attempt < 2 && good.length < 2; attempt += 1) {
    // COPY_SYSTEM is static and over the cache minimum: cached reads cost 10%.
    const result = await aiText({ tier: 'main', system: COPY_SYSTEM, cacheSystem: true, messages, json: true, maxTokens: 3200, timeoutMs: 30000, track: { ...track, feature: 'video-ads-copy' } });
    cost += result.cost;
    const parsed = extractJson(result.text);
    if (parsed?.skip && !Array.isArray(parsed?.variants)) { lastErrors = [`the AI skipped: ${clean(parsed.skip, 80)}`]; allErrors = [...allErrors, ...lastErrors]; break; }
    if (!aiPick && STYLES.includes(parsed?.bestStyle)) aiPick = parsed.bestStyle;
    const variants = Array.isArray(parsed?.variants) ? parsed.variants : [];
    // Repair in code first; only what can't be repaired goes back to the model.
    const checked = variants.slice(0, 4).map(raw => {
      const repaired = autoFix(raw, brand, facts, wantStyle);
      return { ...checkVariant(repaired.raw, brand, facts, wantStyle), fixes: repaired.fixes };
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
      event: { type: 'check_failed', brandId: brand.id, sport: ctx.sport, payload: { style: wantStyle || '', issues: allErrors.slice(0, 12), autoFixed: autoFixed.map(({ kind, word }) => (word ? { kind, word } : { kind })) } },
    }), 1500, false);
  }
  const lessonsUsed = { examples: learned.examples.length, rules: learned.rules.length };
  const suggestion = suggestionFor(ctx, body, ranking, aiPick);
  if (!good.length) return { ok: false, status: 422, error: 'The AI copy did not pass the ES checks. Try again or add a note.', issues: lastErrors.slice(0, 5), autoFixed, lessons: lessonsUsed, suggestion, cost: money(cost) };
  const value = { ok: true, variants: rankVariants(good, brand), autoFixed, lessons: lessonsUsed, suggestion };
  if (COPY_CACHE.size > 200) COPY_CACHE.delete(COPY_CACHE.keys().next().value);
  COPY_CACHE.set(copyKey(body), { at: Date.now(), value });
  return { ...value, cached: false, cost: money(cost) };
}

// ─── Us vs Them claims: admin-editable, owner-approved ─────────────────────
// video-ads-brands.js holds the placeholder claims (claimsApproved: false).
// An admin can replace them and mark them approved from the page; the row
// lives in frameup_video_ad_claims (migration 20261118124800, RLS: everyone
// signed in reads, only is_es_designer_admin() writes). Before the migration
// runs, or on any error, the file's claims are used.
const CLAIMS_TTL_MS = 5 * 60 * 1000;
let claimsCache = { at: 0, rows: null };
const CLAIM_LIMITS = { min: 2, max: 6, chars: 60 };
async function claimRows(token) {
  if (claimsCache.rows && Date.now() - claimsCache.at < CLAIMS_TTL_MS) return claimsCache.rows;
  try {
    const rows = await withTimeout(rest.request('frameup_video_ad_claims?select=brand_id,claims,approved,updated_at', { token }), 2500, null);
    if (!Array.isArray(rows)) return claimsCache.rows || [];
    claimsCache = { at: Date.now(), rows };
    return rows;
  } catch (error) {
    return claimsCache.rows || [];
  }
}
async function claimsFor(brand, token) {
  const rows = token ? await claimRows(token) : [];
  const row = (rows || []).find(r => r && r.brand_id === brand.id);
  const saved = row && Array.isArray(row.claims) ? row.claims.map(c => clean(c, CLAIM_LIMITS.chars)).filter(Boolean) : [];
  if (saved.length >= CLAIM_LIMITS.min) return { claims: saved, approved: row.approved === true, source: 'saved', updatedAt: row.updated_at || '' };
  return { claims: (brand.verifiedClaims || []).slice(), approved: brand.claimsApproved === true, source: 'file', updatedAt: '' };
}
async function isAdmin(token) {
  try { return (await withTimeout(rest.request('rpc/is_es_designer_admin', { method: 'POST', token, body: {} }), 2500, false)) === true; } catch (error) { return false; }
}
async function claimsMode(body, track) {
  const [canEdit, ...lists] = await Promise.all([isAdmin(track.token), ...BRANDS.AD_BRANDS.map(b => claimsFor(b, track.token))]);
  return { ok: true, canEdit, claims: Object.fromEntries(BRANDS.AD_BRANDS.map((b, i) => [b.id, lists[i]])) };
}
function checkClaims(list) {
  const claims = [...new Set((Array.isArray(list) ? list : []).map(c => clean(c, 200)).filter(Boolean))];
  if (claims.length < CLAIM_LIMITS.min || claims.length > CLAIM_LIMITS.max) return { error: `Give ${CLAIM_LIMITS.min}-${CLAIM_LIMITS.max} claims.` };
  const long = claims.find(c => c.length > CLAIM_LIMITS.chars);
  if (long) return { error: `“${long.slice(0, 40)}…” is over ${CLAIM_LIMITS.chars} characters.` };
  const banned = claims.find(c => RULES.BANNED.some(rule => rule.re.test(c)));
  if (banned) return { error: `“${banned}” breaks the ES style.` };
  return { claims };
}
async function saveClaims(body, track) {
  const brand = BRANDS.AD_BRANDS.find(b => b.id === body.brandId);
  if (!brand) return { ok: false, status: 400, error: 'Pick a newsletter.' };
  const checked = checkClaims(body.claims);
  if (checked.error) return { ok: false, status: 400, error: checked.error };
  if (!(await isAdmin(track.token))) return { ok: false, status: 403, error: 'Only an admin can change the claims.' };
  try {
    await rest.request('frameup_video_ad_claims?on_conflict=brand_id', {
      method: 'POST', token: track.token, prefer: 'resolution=merge-duplicates,return=minimal',
      body: [{ brand_id: brand.id, claims: checked.claims, approved: body.approved === true, updated_by: track.email || '' }],
    });
  } catch (error) {
    if (error?.code === 'not_installed') return { ok: false, status: 503, reason: 'not-installed', error: 'Claim editing needs the frameup_video_ad_claims migration. Ask the owner to run it.' };
    return { ok: false, status: error?.status === 403 ? 403 : 502, error: error?.status === 403 ? 'Only an admin can change the claims.' : 'Couldn’t save the claims. Try again.' };
  }
  claimsCache = { at: 0, rows: null };
  COPY_CACHE.clear();
  return { ok: true, brandId: brand.id, claims: checked.claims, approved: body.approved === true };
}

// The style suggestion on its own: no model call, so no AI gate.
async function suggestStyle(body, track) {
  const claims = await claimsFor(BRANDS.byId(body.brandId), track.token);
  const ctx = copyContext(body, { claims: claims.claims });
  ctx.brand = { ...ctx.brand, verifiedClaims: claims.claims, claimsApproved: claims.approved };
  const ranking = await styleRanking(ctx.brand, ctx.sport, track.token);
  return { ok: true, suggestion: suggestionFor(ctx, body, ranking), ranking };
}

// The current ad's no-footage fields, only those that are set (keeps the chat prompt short).
function currentStyleFields(layout) {
  const f = styleFieldsOf(layout);
  return Object.fromEntries(Object.entries(f).filter(([, v]) => (Array.isArray(v) ? v.length : v)));
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
  const claimInfo = await claimsFor(brand, track.token);
  ctx.facts.claims = claimInfo.claims.slice(0, 12);
  // The static part (rules + assistant role) is cached; this ad's context
  // rides in front of the conversation as the first user turn.
  const context = [
    ...contextLines(ctx),
    ctx.trend.title || ctx.teams.length ? '' : 'No clip or moment picked yet.',
    `Current ad: ${JSON.stringify({ style: layout.style, headline: clean(layout.headline, 300), highlight: clean(layout.highlight, 120), body: strings(layout.body, 3, 500), cta: clean(layout.cta, 40), ...currentStyleFields(layout) })}`,
  ].filter(Boolean).join('\n');
  const turns = history[0].role === 'user'
    ? [{ ...history[0], content: `About this ad:\n${context}\n\n${history[0].content}` }, ...history.slice(1)]
    : [{ role: 'user', content: `About this ad:\n${context}` }, ...history];
  const system = [
    COPY_SYSTEM,
    'You are the Video Ads assistant inside FrameUp: help the editor shape this ad. Be brief and practical.',
    'When the editor asks for a change to the ad, include "patch" with only the fields to change (style, headline, highlight, body, cta, offer, listTitle, items, them, us). For several options, include "variants" (same shape as the copy variants). Otherwise only reply.',
    'Reply with JSON only: {"reply": "...", "patch": {...} or null, "variants": [...] or null}',
  ].join('\n');
  const result = await aiText({ tier: 'main', system, cacheSystem: true, messages: turns, json: true, maxTokens: 1800, timeoutMs: 25000, track: { ...track, feature: 'video-ads-chat' } });
  const parsed = extractJson(result.text) || { reply: clean(result.text, 1500) };
  const out = { ok: true, reply: clean(parsed.reply, 1500) || 'Done.', cost: money(result.cost) };
  // A change to the ad passes the same checks as AI copy; fields that fail are dropped and said so.
  if (parsed.patch && typeof parsed.patch === 'object') {
    const merged = { ...styleFieldsOf(layout), style: layout.style, headline: layout.headline, highlight: layout.highlight, body: layout.body, cta: layout.cta, ...parsed.patch };
    const { variant, errors } = checkVariant(merged, brand, { ...ctx.facts, text: factsText, sources: [...ctx.facts.sources, ...history.filter(m => m.role === 'user').map(m => m.content)] }, merged.style);
    if (errors.length) out.reply += ` (I couldn't apply that change: ${errors.slice(0, 2).join('; ')}.)`;
    else out.patch = Object.fromEntries(Object.keys(parsed.patch).filter(k => k in variant).map(k => [k, variant[k]]));
  }
  if (Array.isArray(parsed.variants)) {
    const good = parsed.variants.slice(0, 3).map(v => checkVariant(v, brand, { ...ctx.facts, text: factsText }, '')).filter(c => !c.errors.length).map(c => c.variant);
    if (good.length) out.variants = good;
  }
  return out;
}

// ─── Grammar check (Haiku, the main tier) ──────────────────────────────────
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
  const result = await aiText({ tier: 'main', system: GRAMMAR_SYSTEM, messages: [{ role: 'user', content: ask }], json: true, maxTokens: GRAMMAR.maxTokens, timeoutMs: 20000, track: { ...track, feature: 'video-ads-grammar' } });
  const parsed = extractJson(result.text);
  const list = Array.isArray(parsed) ? parsed : parsed?.issues;
  const { issues, dropped } = checkGrammarIssues(list, copyIn);
  const value = { ok: true, issues };
  if (GRAMMAR_CACHE.size > 200) GRAMMAR_CACHE.delete(GRAMMAR_CACHE.keys().next().value);
  GRAMMAR_CACHE.set(grammarKey(body.brandId, copyIn), { at: Date.now(), value });
  return { ...value, dropped, cached: false, cost: money(result.cost) };
}

// ─── ai-free-mode: rule-based ad copy (no AI) ──────────────────────────────
// Over this week's AI budget, copy comes from templates built only from what
// the editor gave (the moment's title, teams, typed headlines) and the
// newsletter's own label, league, audience and approved claims. Every variant
// still goes through autoFix + checkVariant, so the ES rules hold.
const FREE_THEM = ['Endless scrolling', 'Hot takes everywhere', 'Stories you missed'];
function freeTemplates(ctx, wantStyle) {
  const { brand, facts } = ctx;
  const subject = ctx.trend.title || ctx.typedItems[0] || (ctx.teams.length ? ctx.teams.slice(0, 2).join(' vs ') : '');
  const moment = subject ? trimToWords(swapBanned(subject), 14).replace(/[.!]+$/, '') : '';
  const team = ctx.teams[0] || '';
  const claims = facts.claims.slice(0, 3).map(c => String(c).replace(/[.]+$/, ''));
  const claimLine = claims.length ? `${claims.slice(0, 2).join('. ')}.` : `Sign up for ${brand.label}.`;
  const about = `${brand.label} covers ${brand.league} for ${brand.audience}.`;
  const offer = `${brand.label} is free. Sign up today.`;
  const items = [...new Set([ctx.trend.title, ...ctx.headlines, ...ctx.typedItems].filter(Boolean))].slice(0, 3).map(t => cutWords(swapBanned(t), SL.itemWords));
  const listTitle = `${brand.short || brand.league} stories today`;
  const classic = [
    { style: 'highlight', headline: moment || `${brand.league} news for ${brand.audience}`, body: [about, claimLine] },
    { style: 'condensed', headline: team ? `${team} fans, stay in the loop` : `Stay in the loop on ${brand.league}`, body: [moment ? `${moment}.` : about, claimLine] },
    { style: 'simple', headline: `Get ${brand.label} in your inbox`, body: [about, claimLine] },
  ].map(v => ({ ...v, cta: brand.cta, highlight: v.style === 'highlight' ? closestPhrase(v.headline, '') : '', offer, listTitle: items.length >= 3 ? listTitle : '', items: items.length >= 3 ? items : [], them: claims.length >= 2 ? FREE_THEM.slice(0, 2) : [], us: claims.length >= 2 ? claims.slice(0, 2) : [], why: 'free template' }));
  if (!wantStyle) return classic;
  if (CLASSIC.includes(wantStyle)) return classic.map(v => ({ ...v, style: wantStyle, highlight: wantStyle === 'highlight' ? closestPhrase(v.headline, '') : '' }));
  return [classic[0]].map(v => ({ ...v, style: wantStyle, listTitle: `${listTitle}`, items, them: FREE_THEM.slice(0, Math.min(3, Math.max(2, claims.length))), us: claims }));
}
async function freeCopy(body, track) {
  const claims = await claimsFor(BRANDS.byId(body.brandId), track.token);
  const ctx = copyContext(body, { claims: claims.claims });
  ctx.brand = { ...ctx.brand, verifiedClaims: claims.claims, claimsApproved: claims.approved };
  const { brand, facts } = ctx;
  if (!ctx.trend.title && !ctx.teams.length && !ctx.notes && !ctx.color && !ctx.typedItems.length) {
    return { ok: false, status: 400, error: 'Pick a clip, a moment or a colour first, or write a note about the ad.' };
  }
  const wantStyle = STYLES.includes(body.style) ? body.style : '';
  const ranking = await styleRanking(brand, ctx.sport, track.token).catch(() => []);
  const skip = wantStyle ? skipReason(wantStyle, factsForSuggestion(ctx, body)) : null;
  if (skip) return { ok: false, status: 422, reason: 'skip', ...skip, suggestion: suggestionFor(ctx, body, ranking) };
  const good = [];
  const autoFixed = [];
  freeTemplates(ctx, wantStyle).forEach(raw => {
    const repaired = autoFix(raw, brand, facts, wantStyle);
    const checked = checkVariant(repaired.raw, brand, facts, wantStyle);
    if (!checked.errors.length && !good.some(v => v.headline === checked.variant.headline)) { good.push(checked.variant); autoFixed.push(...repaired.fixes); }
  });
  return { ok: true, variants: rankVariants(good, brand), autoFixed: autoFixed.slice(0, 12), lessons: { examples: 0, rules: 0 }, suggestion: suggestionFor(ctx, body, ranking), source: 'template', cached: false, cost: 0 };
}
// The no-AI answer for each AI mode in free mode.
async function freeModeRun(mode, body, track) {
  if (mode === 'copy') return freeCopy(body, track);
  if (mode === 'find-clips' || mode === 'moments-with-clips') {
    // The clip library + free public sources; never the paid web search.
    const free = await AI_MODES[mode](body, { ...track, freeOnly: true }).catch(() => null);
    return free?.ok ? free : { ok: true, clips: [], moments: [], freeOnly: true };
  }
  // chat / grammar need the AI: skipped (the page keeps its free local checks).
  return { ok: true, skipped: true };
}

const AI_MODES = { 'find-clips': findClips, 'moments-with-clips': momentsWithClips, copy, chat, grammar };
// The usage feature (and AI_DISABLE name) of each mode.
const MODE_FEATURES = { 'find-clips': 'video-ads-find-clips', 'moments-with-clips': 'video-ads-moments-with-clips', copy: 'video-ads-copy', chat: 'video-ads-chat', grammar: 'video-ads-grammar' };

// withAiMode (ai-free-mode): one free-mode store per request; replies carry mode: 'free'.
exports.handler = withAiMode(async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });
  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (error) { return json(400, { ok: false, error: 'Invalid request.' }); }
  try {
    if (body.mode === 'trends') return json(200, await trends());
    if (body.mode === 'clip') {
      // Any video link (X, Bluesky, Reddit, Streamable, Vimeo, Drive, Dropbox,
      // direct files, pages with og:video) -> direct file URLs (_clip-link.js).
      const result = await CLIP_LINK.resolveLink(String(body.url || '').slice(0, 2000), { clipFromPost });
      return json(result.ok ? 200 : result.status, result);
    }
    if (body.mode === 'research') return json(410, { ok: false, error: 'Research was removed.' });
    if (body.mode === 'suggest-style') return json(200, await suggestStyle(body, { email: auth.user.email, token: bearerToken(event.headers) }));
    // Claims: no model call, so no AI gate. Writes are checked by RLS (admins only).
    if (body.mode === 'claims') return json(200, await claimsMode(body, { email: auth.user.email, token: bearerToken(event.headers) }));
    if (body.mode === 'save-claims') {
      const result = await saveClaims(body, { email: auth.user.email, token: bearerToken(event.headers) });
      return json(result.ok ? 200 : result.status, result);
    }
    if (body.mode === 'library') {
      const result = await libraryMode(body, { token: bearerToken(event.headers) });
      return json(result.ok ? 200 : (result.status || 400), result);
    }
    if (AI_MODES[body.mode]) {
      const token = bearerToken(event.headers);
      // One run id per request: a copy run's retry shares it with the first try.
      const track = { email: auth.user.email, token, runId: `va-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}` };
      // By moment's optional AI titles: one light call per refresh, only when
      // AI is on and this person is inside every limit (checked once, lazily).
      if (body.mode === 'moments-with-clips') {
        let gate = null;
        track.titleGate = () => (gate = gate || (async () => gatewayConfigured() && !featureDisabled(MOMENTS.titleFeature)
          && !(await userOverHourlyLimit(token)) && !(await aiSpendGate(token, { feature: MOMENTS.titleFeature })))());
      }
      // Switched off (AI_DISABLE): a calm reply before anything else, cached results included.
      const feature = MODE_FEATURES[body.mode];
      // AI blocked (switched off, not configured, over a limit) for a clip
      // search: the library and the free sources still answer when they have
      // anything; otherwise the usual calm reply.
      const clipMode = body.mode === 'find-clips' || body.mode === 'moments-with-clips';
      const blocked = async (status, payload) => {
        if (clipMode) {
          const free = await AI_MODES[body.mode](body, { ...track, freeOnly: true }).catch(() => null);
          const has = free?.ok && ((free.clips || []).length || (free.moments || []).length || (free.fallback?.clips || []).length);
          if (has) return json(200, { ...free, aiPaused: payload.reason || 'off' });
        }
        return json(status, payload);
      };
      if (featureDisabled(feature)) return blocked(503, { ok: false, reason: 'feature-off', error: featureOffMessage(feature) });
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
      // Same for a repeated copy request (10-minute cache).
      if (body.mode === 'copy') {
        const cached = copyCached(body);
        if (cached) return json(200, cached);
      }
      // Same for a repeated grammar check (10-minute cache).
      if (body.mode === 'grammar') {
        const cached = grammarCached(body);
        if (cached) return json(200, cached);
      }
      // ai-free-mode: over this week's AI budget -> the free path (templates, library, free sources).
      const gate = process.env.AI_GATEWAY_API_KEY && !inFreeMode() ? await aiSpendGate(token, { feature }) : null;
      if (inFreeMode() || freeModeGate(gate)) {
        const free = await freeModeRun(body.mode, body, track);
        return json(free.ok ? 200 : (free.status || 400), free);
      }
      if (!gatewayConfigured()) return blocked(503, { ok: false, reason: 'off', error: 'AI is not available right now.' });
      if (await userOverHourlyLimit(token)) return blocked(429, { ok: false, reason: 'limit', error: "You've used a lot of AI this hour. Take a short break and try again soon." });
      if (gate) return blocked(gate.status, { ok: false, reason: gate.reason, error: gate.error });
      if (String(event.body || '').length > 60000) return json(413, { ok: false, error: 'That request is too large.' });
      try {
        const result = await AI_MODES[body.mode](body, track);
        return json(result.ok ? 200 : (result.status || 502), result);
      } catch (error) {
        // ai-free-mode: a Gateway budget stop mid-run -> the free path.
        if (inFreeMode()) { const free = await freeModeRun(body.mode, body, track); return json(free.ok ? 200 : (free.status || 400), free); }
        if (isBudgetError(error)) return blocked(503, { ok: false, reason: 'budget', error: "This week's AI budget is used up, so AI features are paused until it resets." });
        if (body.mode === 'find-clips') {
          console.error('video-ads find-clips failed:', error);
          return blocked(502, { ok: false, error: 'Clip search is unavailable right now. Paste an X link or upload a clip instead.' });
        }
        if (body.mode === 'moments-with-clips') {
          console.error('video-ads moments-with-clips failed:', error);
          return blocked(502, { ok: false, error: "Couldn't check which moments have clips right now." });
        }
        throw error;
      }
    }
    return json(400, { ok: false, error: 'Unknown request.' });
  } catch (error) {
    console.error('video-ads failed:', error);
    return json(502, { ok: false, error: 'Video Ads is unavailable right now. Try again in a moment.' });
  }
});

exports._test = {
  variantsFrom, isVideoUrl, sizeFromUrl, clipFromPost, trends, checkVariant, autoFix, trimToWords, swapBanned, closestPhrase, copyContext, suggestStyle, skipReason, styleFieldsOf,
  freeCopy, freeTemplates, freeModeRun,
  MODE_FEATURES, COPY_SYSTEM, COPY_CACHE, copyKey, rankVariants, claimsFor, checkClaims, saveClaims, claimsMode, resetClaims() { claimsCache = { at: 0, rows: null }; }, findClips, momentsWithClips, teamInTitle, MOMENT_CACHE, MOMENTS, looksOld, ageHoursOf, copy, chat, CLIP_CACHE, FIND_CLIPS, grammar, checkGrammarIssues, GRAMMAR_CACHE,
  MOMENT_TITLE_CACHE, MOMENTS_LIB, CLASSIFY, assembleMoments, searchPlan, webPrompt, xQueryFor, xApiSearch, assessClip, freshClip, scoreClip, rankClips, mediaKey, qualityLabel, CLIP_TTL_MS, SOURCES,
  LIBRARY, CLIP_LIBRARY, libraryMode, libraryClips, nearestFallback, runSources, verifyCandidate, checkMedia, mediaHostAllowed, teamsInText, clipTeams, softKey,
  useSources(list) { EXTRA_SOURCES = Array.isArray(list) ? list : []; },
  useLearning(mod) { learning = { lessonsFor: async () => ({ examples: [], rules: [] }), styleRankingFor: async () => [], recordEvent: async () => false, ...mod }; },
};

// The clip pipeline, for the prefetch cron (clips-prefetch.js).
exports.clipPipeline = {
  AD_SPORTS, FIND_CLIPS, LIBRARY, CLIP_LIBRARY, searchPlan, searchRound, runSources, rankClips, saveToLibrary, clipFromPost, checkMedia,
  assessClip, teamInTitle, teamOut, isXPost, xApiOn, clipSources, isPaidSource, trends, mediaKey, CLASSIFY, libraryClips,
};
