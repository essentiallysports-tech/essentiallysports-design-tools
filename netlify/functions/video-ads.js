'use strict';
// Video Ads: newsletter-signup video ads (trending sports clip + logo + copy +
// CTA). One endpoint, POST { mode, ... }:
//
//   trends      last-48h NFL / CFB / MLB moments (shared with Trend Design)
//   clip        an X post link -> its MP4 versions on video.twimg.com, so the
//               browser downloads the clip itself. Video bytes never pass
//               through this function (serverless responses are capped at ~4.5 MB).
//   find-clips  X posts with video from the last 72 hours of one team, the
//               teams in a colour, or a moment: one cheap web search (Haiku,
//               2 searches, hard cost cap, 15-minute cache); every post
//               verified like `clip`, and kept only if its verified timestamp
//               is under 72h old and it isn't a throwback
//   copy        3 ad-copy variants in the ES styles, grounded in the brand, sport,
//               team or moment and colour theme, plus lessons from past ads;
//               common problems are repaired in code before the model retries
//   chat        the Video Ads assistant: a reply, plus an optional change to the ad
//   grammar     grammar / spelling / punctuation fixes from the cheapest model;
//               each must quote its field exactly and keep numbers and brand
//               words; 10-minute cache
//   moments-with-clips  the top ~10 trending moments that have fresh, verified
//               clips (one capped search for all of them, shared 15-min cache)
//   research    removed (410)
//
// Every request needs a signed-in ES user; AI modes count toward the hourly limit.
const { verifyEsUser, bearerToken } = require('./_supabase-auth.js');
const { getTrends } = require('./trend-design.js');
const { _helpers: tweet } = require('./tweet-oembed.js');
const { aiText, aiWebResearch, gatewayConfigured, isBudgetError, userOverHourlyLimit, userOverWeeklyLimit, weeklyLimitMessage } = require('./_ai-gateway.js');
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
  } : null;
  if (!variants.length) {
    const syn = await fetchJson(`${tweet.SYNDICATION_ENDPOINT}?id=${encodeURIComponent(id)}&token=1`).catch(() => null);
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
      };
    }
  }
  if (!variants.length) return { ok: false, status: 404, error: 'That post has no downloadable video. Try another post, or save the clip and drop it in.' };
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
// Cheap on purpose: the search tier (Haiku), at most 2 searches, a short reply,
// a hard per-call cap, and a 15-minute cache per (sport, team | colour | query).
// Fresh on purpose: only posts whose VERIFIED timestamp (fxtwitter / X
// syndication, never the model's claim) is under 72 hours old; no timestamp =
// dropped (fail closed); obvious re-uploads of old footage are dropped too.
const CLIP_CACHE = new Map();
const CLIP_TTL_MS = 15 * 60 * 1000;
const FIND_CLIPS = { maxUses: 2, maxTokens: 900, maxCostUsd: 0.03, candidates: 12, maxClips: 9, maxAgeHours: 72, minClips: 3, verifyMs: 6000 };

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

async function findClips(body, track) {
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

  const key = team ? `${sport}|team:${team.name.toLowerCase()}` : color ? `${sport}|color:${color}` : `${sport}|query:${query.toLowerCase()}`;
  const hit = CLIP_CACHE.get(key);
  if (hit && Date.now() - hit.at < CLIP_TTL_MS) {
    // Ages move on while cached; anything that crossed 72h meanwhile goes.
    const clips = reAge(hit.value.clips);
    return { ...hit.value, clips, ...noteFor(clips.length), cached: true, cost: 0 };
  }
  if (track.skipAi) return null; // cache miss: the caller gates and comes back

  const now = Date.now();
  const since = new Date(now - FIND_CLIPS.maxAgeHours * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  const subject = team ? `${SPORT_NAMES[sport]} team: ${team.name} (only this team)`
    : teams.length ? `${SPORT_NAMES[sport]} teams: ${teams.map(t => t.name).join(', ')}`
      : `${SPORT_NAMES[sport]} moment: ${query}`;
  const system = [
    'You find the newest sports video posts on X (Twitter) for EssentiallySports newsletter ads.',
    'Search, then reply with JSON only. List only X post URLs you actually saw in search results; never make one up.',
    'Freshness matters most: only posts made in the last 72 hours. No throwbacks, anniversaries or re-uploads of old games.',
  ].join('\n');
  const prompt = [
    subject,
    `Find X posts made in the last 72 hours (after ${since} UTC) that carry native video from this week's games: highlights, big plays, celebrations, fan moments.`,
    'Prefer official team, league, network and reporter accounts. Skip posts that only link to an article, and skip anything older.',
    `Reply with JSON only: {"posts": [{"url": "https://x.com/<handle>/status/<id>", "date": "YYYY-MM-DD the post was made"}]} (up to ${FIND_CLIPS.candidates}, newest first).`,
  ].join('\n');

  const result = await aiWebResearch({
    tier: 'search', system, prompt,
    maxUses: FIND_CLIPS.maxUses, maxTokens: FIND_CLIPS.maxTokens, maxCostUsd: FIND_CLIPS.maxCostUsd, timeoutMs: 30000,
    track: { ...track, feature: 'video-ads-find-clips' },
  });
  if (result.cost > FIND_CLIPS.maxCostUsd) console.warn(`video-ads find-clips cost ${result.cost.toFixed(4)} over the ${FIND_CLIPS.maxCostUsd} cap`);
  const parsed = extractJson(result.text) || {};
  const posts = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.posts) ? parsed.posts : []);
  // The model's dates are ignored: only the verified timestamp counts.
  const listed = posts.slice(0, 20).map(p => clean(typeof p === 'string' ? p : p?.url, 300)).filter(Boolean);
  const cited = (result.urls || []).map(u => u.url);
  const candidates = [...new Set([...listed, ...cited].filter(isXPost).map(u => tweet.normalizeTweetUrl(u)))].slice(0, FIND_CLIPS.candidates);

  // Verify each post like `clip` does: video.twimg.com MP4s only, never the bytes.
  const checks = await Promise.all(candidates.map(url => withTimeout(clipFromPost(url), FIND_CLIPS.verifyMs, { ok: false })));
  const clips = checks.map(freshClip).filter(Boolean).sort((a, b) => a.ageHours - b.ageHours).slice(0, FIND_CLIPS.maxClips);
  const value = { ok: true, teams: teamsOut, clips };
  if (CLIP_CACHE.size > 120) CLIP_CACHE.delete(CLIP_CACHE.keys().next().value);
  CLIP_CACHE.set(key, { at: Date.now(), value });
  return { ...value, ...noteFor(clips.length), cached: false, cost: money(result.cost) };
}

const noteFor = n => (n < FIND_CLIPS.minClips ? { note: `Only ${n} clip${n === 1 ? '' : 's'} from the last 3 days.` } : {});

// Shapes a verified clipFromPost result for the client, or null when it fails
// the freshness rules (verified timestamp under 72h, not a throwback).
function freshClip(c) {
  if (!c?.ok || !c.variants?.length) return null;
  const age = ageHoursOf(c.postedAt);
  if (age === null || age > FIND_CLIPS.maxAgeHours || looksOld(c.text)) return null;
  return {
    url: c.url,
    handle: c.handle || '',
    text: c.text || '',
    thumb: c.thumbnail || '',
    duration: Math.round((c.durationMs || 0) / 100) / 10,
    durationMs: c.durationMs || 0,
    postedAt: c.postedAt,
    ageHours: Math.round(age),
    variants: c.variants.map(v => ({ url: v.url, width: v.width, height: v.height, bitrate: v.bitrate })),
  };
}

// Re-ages cached clips and drops the ones that crossed 72h since caching.
const reAge = clips => clips
  .map(c => ({ ...c, ageHours: Math.round(ageHoursOf(c.postedAt) ?? Infinity) }))
  .filter(c => c.ageHours <= FIND_CLIPS.maxAgeHours);

// ─── Moments with clips (By moment: only moments that have fresh clips) ────
// One search for the top ~10 trending moments, grouped by moment, every post
// verified like find-clips. Shared across users for 15 minutes, so a refresh
// costs at most one capped search per sport choice per quarter hour.
const MOMENT_CACHE = new Map();
const MOMENTS = { top: 10, maxUses: 3, maxTokens: 1500, maxCostUsd: 0.03, perMoment: 4, maxCandidates: 30 };

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
  const key = `${sport}|${list.map(m => m.id).join(',')}`;
  const cached = momentsCached(key);
  if (cached) return cached;
  if (track.skipAi) return null; // cache miss: the caller gates and comes back
  if (!list.length) return { ok: true, moments: [], checked: 0, cached: false, cost: 0 };

  const since = new Date(Date.now() - FIND_CLIPS.maxAgeHours * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  const system = [
    'You find the newest sports video posts on X (Twitter) for EssentiallySports newsletter ads.',
    'Search, then reply with JSON only. List only X post URLs you actually saw in search results; never make one up.',
    'Freshness matters most: only posts made in the last 72 hours. No throwbacks, anniversaries or re-uploads of old games.',
  ].join('\n');
  const prompt = [
    'Trending moments:',
    ...list.map((m, i) => `${i + 1}. [${SPORT_NAMES[m.sport]}] ${m.title}`),
    '',
    `For each moment, find X posts made in the last 72 hours (after ${since} UTC) that carry native video OF THAT MOMENT: highlights, the play itself, celebrations, reactions. Prefer official team, league, network and reporter accounts. Skip posts that only link to an article.`,
    `Reply with JSON only: {"moments": [{"i": <moment number>, "posts": ["https://x.com/<handle>/status/<id>"]}]} (up to ${MOMENTS.perMoment} posts per moment; leave out moments with none).`,
  ].join('\n');
  const result = await aiWebResearch({
    tier: 'search', system, prompt,
    maxUses: MOMENTS.maxUses, maxTokens: MOMENTS.maxTokens, maxCostUsd: MOMENTS.maxCostUsd, timeoutMs: 40000,
    track: { ...track, feature: 'video-ads-moments-with-clips' },
  });
  if (result.cost > MOMENTS.maxCostUsd + 0.01) console.warn(`video-ads moments-with-clips cost ${result.cost.toFixed(4)}`);
  const parsed = extractJson(result.text) || {};
  const groups = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.moments) ? parsed.moments : []);
  // Moment index -> candidate post URLs; a post counts for its first moment only.
  const seen = new Set();
  const byMoment = new Map();
  let total = 0;
  groups.forEach(group => {
    const index = Number(group?.i ?? group?.index ?? group?.moment) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return;
    const posts = (Array.isArray(group.posts) ? group.posts : []).map(p => clean(typeof p === 'string' ? p : p?.url, 300)).filter(isXPost).map(u => tweet.normalizeTweetUrl(u));
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
  const checks = await Promise.all(urls.map(url => withTimeout(clipFromPost(url), FIND_CLIPS.verifyMs, { ok: false })));
  const verified = new Map(urls.map((url, k) => [url, freshClip(checks[k])]));
  const moments = list.map((m, index) => {
    const clips = (byMoment.get(index) || []).map(url => verified.get(url)).filter(Boolean).sort((a, b) => a.ageHours - b.ageHours);
    if (!clips.length) return null;
    const team = teamInTitle(m.title, m.sport);
    return { id: m.id, title: m.title, sport: m.sport, ...(team ? { team: teamOut(team) } : {}), publishedAt: m.publishedAt, clips };
  }).filter(Boolean);
  const value = { ok: true, moments, checked: list.length };
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
    const result = await aiText({ tier: 'main', system: COPY_SYSTEM, cacheSystem: true, messages, json: true, maxTokens: 2000, timeoutMs: 25000, track: { ...track, feature: 'video-ads-copy' } });
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
      const track = { email: auth.user.email, token };
      // A cached clip search costs nothing, so it skips the AI gates.
      if (body.mode === 'find-clips') {
        const cached = await findClips(body, { ...track, skipAi: true });
        if (cached) return json(cached.ok ? 200 : (cached.status || 502), cached);
      }
      // Same for moments-with-clips (shared 15-minute cache).
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
      if (await userOverWeeklyLimit(token)) return json(429, { ok: false, reason: 'weekly-limit', error: weeklyLimitMessage() });
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
  findClips, momentsWithClips, teamInTitle, MOMENT_CACHE, MOMENTS, looksOld, ageHoursOf, copy, chat, CLIP_CACHE, FIND_CLIPS, grammar, checkGrammarIssues, GRAMMAR_CACHE,
  useLearning(mod) { learning = { lessonsFor: async () => ({ examples: [], rules: [] }), recordEvent: async () => false, ...mod }; },
};
