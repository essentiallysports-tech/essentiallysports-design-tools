'use strict';
// Video Ads: newsletter-signup video ads (trending sports clip + logo + copy +
// CTA). One endpoint, POST { mode, ... }:
//
//   trends  last-48h NFL / CFB / MLB moments (shared with Trend Design)
//   clip    an X post link -> its MP4 versions on video.twimg.com, so the
//           browser downloads the clip itself. Video bytes never pass through
//           this function (serverless responses are capped at ~4.5 MB).
//   research  web research on a moment (Claude + web search): facts with
//             sources, why fans care, ad angles, X posts and YouTube links,
//             and the X posts whose video FrameUp can download (verifiedClips)
//   copy      3 ad-copy variants in the ES styles, checked before they return
//   chat      the Video Ads assistant: a reply, plus an optional change to the ad
//
// Every request needs a signed-in ES user; AI modes count toward the hourly limit.
const { verifyEsUser, bearerToken } = require('./_supabase-auth.js');
const { getTrends } = require('./trend-design.js');
const { _helpers: tweet } = require('./tweet-oembed.js');
const { aiText, aiWebResearch, gatewayConfigured, isBudgetError, userOverHourlyLimit } = require('./_ai-gateway.js');
const RULES = require('../../frameup-rules.js');
const BRANDS = require('../../video-ads-brands.js');

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
const isYouTube = value => /^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)[\w-]+/i.test(String(value));
const numberTokens = text => (String(text || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map(n => n.replace(/,/g, ''));

function trendInput(trend = {}) {
  return {
    id: clean(trend.id, 80),
    title: clean(trend.title, 300),
    sport: ['nfl', 'cfb', 'mlb'].includes(trend.sport) ? trend.sport : '',
    url: httpsUrl(trend.url),
    related: (Array.isArray(trend.related) ? trend.related : []).slice(0, 4).map(r => ({ title: clean(r?.title, 200), url: httpsUrl(r?.url) })),
  };
}

// ─── Research (web search) ─────────────────────────────────────────────────
const RESEARCH_CACHE = new Map();
const RESEARCH_TTL_MS = 30 * 60 * 1000;
const SPORT_NAMES = { nfl: 'NFL', cfb: 'college football', mlb: 'MLB' };

async function research({ trend: rawTrend }, track) {
  const trend = trendInput(rawTrend);
  if (trend.title.length < 4) return { ok: false, status: 400, error: 'Pick a trend or type the moment first.' };
  const key = `${trend.sport}|${trend.title.toLowerCase()}`;
  const hit = RESEARCH_CACHE.get(key);
  if (hit && Date.now() - hit.at < RESEARCH_TTL_MS) return { ...hit.value, cost: 0, cached: true };

  const system = [
    'You research trending US sports moments for EssentiallySports (ES) newsletter ads.',
    'Search the web, then reply with JSON only. Report only what your sources say; never guess numbers or quotes.',
    'Find the clip: X (Twitter) posts with VIDEO of the moment, preferring official league, team, network and reporter accounts (e.g. @NFL, @MLB, @ESPN, @SportsCenter, team accounts). Give status URLs like https://x.com/NFL/status/123. Also YouTube links of the moment if any.',
  ].join('\n');
  const prompt = [
    `Moment (${SPORT_NAMES[trend.sport] || 'US sports'}): ${trend.title}`,
    trend.url ? `Story: ${trend.url}` : '',
    ...trend.related.map(r => `Related: ${r.title}${r.url ? ` (${r.url})` : ''}`),
    '',
    'Reply with JSON only:',
    '{"summary": "2-3 sentences: what happened, when", "keyFacts": [{"fact": "...", "sourceUrl": "https://..."}], "whyFansCare": "one sentence", "angles": ["ad angle for a newsletter sign-up ad", "..."], "xPosts": ["https://x.com/.../status/..."], "youtube": ["https://www.youtube.com/watch?v=..."], "searchPhrases": ["what to search to find the clip"]}',
  ].filter(Boolean).join('\n');

  let parsed = null;
  let cost = 0;
  let model = '';
  let webSearch = true;
  let cited = [];
  try {
    const result = await aiWebResearch({ tier: 'main', system, prompt, maxUses: 4, maxTokens: 2500, timeoutMs: 45000, track: { ...track, feature: 'video-ads-research' } });
    parsed = extractJson(result.text);
    cost += result.cost;
    model = result.model;
    cited = result.urls.map(u => u.url);
  } catch (error) {
    if (isBudgetError(error)) return { ok: false, status: 503, reason: 'budget', error: "This week's AI budget is used up, so research is paused until it resets." };
    // Web search unavailable: a plain answer from the trend and its related
    // stories (no clip search), clearly marked.
    webSearch = false;
    const result = await aiText({ tier: 'main', system: system.replace(/Search the web, then reply/, 'Using only the details given, reply'), messages: [{ role: 'user', content: prompt }], json: true, maxTokens: 1500, timeoutMs: 20000, track: { ...track, feature: 'video-ads-research' } });
    parsed = extractJson(result.text);
    cost += result.cost;
    model = result.model;
  }
  if (!parsed) return { ok: false, status: 502, error: 'The research came back unreadable. Try again.' };

  const keyFacts = (Array.isArray(parsed.keyFacts) ? parsed.keyFacts : []).slice(0, 8)
    .map(f => ({ fact: clean(f?.fact, 300), sourceUrl: httpsUrl(f?.sourceUrl) }))
    .filter(f => f.fact);
  const xPosts = [...new Set([...strings(parsed.xPosts, 10, 300), ...cited].filter(isXPost).map(u => tweet.normalizeTweetUrl(u)))].slice(0, 8);
  const youtube = [...new Set([...strings(parsed.youtube, 6, 300), ...cited].filter(isYouTube))].slice(0, 4);
  // Which X posts really carry a downloadable video (checked in parallel).
  const checks = await Promise.allSettled(xPosts.slice(0, 6).map(url => Promise.race([
    clipFromPost(url),
    new Promise(resolve => setTimeout(() => resolve({ ok: false }), 6000)),
  ])));
  const verifiedClips = checks.filter(c => c.status === 'fulfilled' && c.value?.ok).map(c => ({
    url: c.value.url, handle: c.value.handle || '', text: c.value.text || '', thumbnail: c.value.thumbnail || '', durationMs: c.value.durationMs || 0, variants: c.value.variants,
  }));
  const value = {
    ok: true,
    webSearch,
    summary: clean(parsed.summary, 700),
    keyFacts,
    whyFansCare: clean(parsed.whyFansCare, 300),
    angles: strings(parsed.angles, 5, 200),
    xPosts,
    youtube,
    searchPhrases: strings(parsed.searchPhrases, 5, 120),
    verifiedClips,
    model,
  };
  if (RESEARCH_CACHE.size > 60) RESEARCH_CACHE.delete(RESEARCH_CACHE.keys().next().value);
  RESEARCH_CACHE.set(key, { at: Date.now(), value });
  return { ...value, cost: Number(cost.toFixed(5)) };
}

// ─── Copy (3 variants in the ES styles) ────────────────────────────────────
const LIMITS = { headlineWords: 22, paragraphWords: 45, totalWords: 95, ctaChars: 32 };
const words = text => String(text || '').split(/\s+/).filter(Boolean).length;

// Facts the copy may use: the research, the trend, and anything the editor typed.
function factText({ trend, research: facts, notes }) {
  return [trend?.title, ...(trend?.related || []).map(r => r.title), facts?.summary, facts?.whyFansCare, ...(facts?.keyFacts || []).map(f => f.fact), notes].filter(Boolean).join(' ');
}

// Checks one variant; returns { variant, errors }.
function checkVariant(raw, brand, factsText, wantStyle) {
  const errors = [];
  const style = ['simple', 'condensed', 'highlight'].includes(raw?.style) ? raw.style : (wantStyle || 'condensed');
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
    if (!known.has(n)) errors.push(`the number ${n} is not in the research or your notes`);
  }));
  return { variant: { style, headline, highlight, body, cta, why: clean(raw?.why, 200) }, errors };
}

const COPY_SYSTEM = [
  'You write newsletter sign-up video ads for EssentiallySports (ES) newsletters. The ad plays over a trending sports clip.',
  'Formula: hook on the moment fans are talking about -> what the newsletter gives them -> it is free. Warm, punchy, plain American English. Second person ("you") or a fan\'s first person ("That\'s why I read ES Dugout").',
  'Styles: "simple" = all plain paragraphs; "condensed" = a bold condensed headline then plain paragraphs; "highlight" = an uppercase condensed headline where one phrase (copied exactly from the headline) sits on a coloured box, then plain paragraphs.',
  'Headline up to 22 words, 1-3 short paragraphs, under 95 words in all. Never invent stats, scores, quotes or subscriber counts: use numbers only if they appear in the facts or the editor\'s notes. No emojis, hashtags, links, "Breaking" or hype words.',
  'The button text is a short call to sign up (e.g. "SIGN UP ES CFB"); it is separate from the copy.',
].join('\n');

async function copy(body, track) {
  const brand = BRANDS.byId(body.brandId);
  const trend = trendInput(body.trend || {});
  const facts = body.research && typeof body.research === 'object' ? {
    summary: clean(body.research.summary, 700),
    whyFansCare: clean(body.research.whyFansCare, 300),
    keyFacts: (Array.isArray(body.research.keyFacts) ? body.research.keyFacts : []).slice(0, 8).map(f => ({ fact: clean(f?.fact, 300) })),
    angles: strings(body.research.angles, 5, 200),
  } : null;
  const notes = clean(body.notes, 600);
  const wantStyle = ['simple', 'condensed', 'highlight'].includes(body.style) ? body.style : '';
  if (!trend.title && !notes && !facts?.summary) return { ok: false, status: 400, error: 'Pick a moment or write a note about the ad first.' };
  const factsText = factText({ trend, research: facts, notes });
  const ask = [
    `Newsletter: ${brand.label} (${brand.league}) for ${brand.audience}. Default button: "${brand.cta}".`,
    trend.title ? `Moment: ${trend.title}` : '',
    facts?.summary ? `What happened: ${facts.summary}` : '',
    facts?.keyFacts?.length ? `Facts:\n- ${facts.keyFacts.map(f => f.fact).join('\n- ')}` : '',
    facts?.whyFansCare ? `Why fans care: ${facts.whyFansCare}` : '',
    facts?.angles?.length ? `Angles to consider: ${facts.angles.join(' | ')}` : '',
    notes ? `Editor's notes: ${notes}` : '',
    wantStyle ? `Write 3 variants, all in the "${wantStyle}" style, each a clearly different angle.` : 'Write 3 variants: one "simple", one "condensed", one "highlight", each a clearly different angle.',
    'Reply with JSON only: {"variants": [{"style": "...", "headline": "...", "highlight": "exact words from the headline (highlight style only)", "body": ["...", "..."], "cta": "...", "why": "one short line on the angle"}]}',
  ].filter(Boolean).join('\n');
  let cost = 0;
  let messages = [{ role: 'user', content: ask }];
  let good = [];
  let lastErrors = [];
  for (let attempt = 0; attempt < 2 && good.length < 2; attempt += 1) {
    const result = await aiText({ tier: 'main', system: COPY_SYSTEM, cacheSystem: true, messages, json: true, maxTokens: 2000, timeoutMs: 25000, track: { ...track, feature: 'video-ads-copy' } });
    cost += result.cost;
    const variants = Array.isArray(extractJson(result.text)?.variants) ? extractJson(result.text).variants : [];
    const checked = variants.slice(0, 4).map(v => checkVariant(v, brand, factsText, wantStyle));
    good = [...good, ...checked.filter(c => !c.errors.length).map(c => c.variant)].slice(0, 3);
    lastErrors = checked.filter(c => c.errors.length).flatMap(c => c.errors);
    if (good.length >= 2 || !lastErrors.length) break;
    messages = [...messages, { role: 'assistant', content: result.text }, { role: 'user', content: `Some variants broke the rules: ${lastErrors.slice(0, 8).join('; ')}. Rewrite them so every rule passes. Same JSON shape.` }];
  }
  if (!good.length) return { ok: false, status: 422, error: 'The AI copy did not pass the ES checks. Try again or add a note.', issues: lastErrors.slice(0, 5), cost: Number(cost.toFixed(5)) };
  return { ok: true, variants: good, cost: Number(cost.toFixed(5)) };
}

// ─── Assistant chat ────────────────────────────────────────────────────────
async function chat(body, track) {
  const brand = BRANDS.byId(body.brandId);
  const trend = trendInput(body.trend || {});
  const facts = body.research && typeof body.research === 'object' ? body.research : {};
  const layout = body.layout && typeof body.layout === 'object' ? body.layout : {};
  const history = (Array.isArray(body.messages) ? body.messages : []).slice(-12)
    .map(m => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: clean(m?.content, 1500) }))
    .filter(m => m.content);
  if (!history.length || history[history.length - 1].role !== 'user') return { ok: false, status: 400, error: 'Write a message first.' };
  const factsText = factText({ trend, research: facts, notes: history.filter(m => m.role === 'user').map(m => m.content).join(' ') });
  const system = [
    COPY_SYSTEM,
    'You are the Video Ads assistant inside FrameUp: help the editor shape this ad. Be brief and practical.',
    'When the editor asks for a change to the ad, include "patch" with only the fields to change (style, headline, highlight, body, cta). For several options, include "variants" (same shape as the copy variants). Otherwise only reply.',
    'Reply with JSON only: {"reply": "...", "patch": {...} or null, "variants": [...] or null}',
    '',
    `Newsletter: ${brand.label} (${brand.league}). Default button: "${brand.cta}".`,
    trend.title ? `Moment: ${trend.title}` : 'No moment picked yet.',
    facts.summary ? `Research: ${clean(facts.summary, 700)}` : '',
    Array.isArray(facts.keyFacts) && facts.keyFacts.length ? `Facts:\n- ${facts.keyFacts.slice(0, 8).map(f => clean(f?.fact, 300)).join('\n- ')}` : '',
    `Current ad: ${JSON.stringify({ style: layout.style, headline: clean(layout.headline, 300), highlight: clean(layout.highlight, 120), body: strings(layout.body, 3, 500), cta: clean(layout.cta, 40) })}`,
  ].filter(Boolean).join('\n');
  const result = await aiText({ tier: 'main', system, messages: history, json: true, maxTokens: 1800, timeoutMs: 25000, track: { ...track, feature: 'video-ads-chat' } });
  const parsed = extractJson(result.text) || { reply: clean(result.text, 1500) };
  const out = { ok: true, reply: clean(parsed.reply, 1500) || 'Done.', cost: Number(result.cost.toFixed(5)) };
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

const AI_MODES = { research, copy, chat };

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
    if (AI_MODES[body.mode]) {
      if (!gatewayConfigured()) return json(503, { ok: false, reason: 'off', error: 'AI is not available right now.' });
      const token = bearerToken(event.headers);
      if (await userOverHourlyLimit(token)) return json(429, { ok: false, reason: 'limit', error: "You've used a lot of AI this hour. Take a short break and try again soon." });
      if (String(event.body || '').length > 60000) return json(413, { ok: false, error: 'That request is too large.' });
      const track = { email: auth.user.email, token };
      try {
        const result = await AI_MODES[body.mode](body, track);
        return json(result.ok ? 200 : (result.status || 502), result);
      } catch (error) {
        if (isBudgetError(error)) return json(503, { ok: false, reason: 'budget', error: "This week's AI budget is used up, so AI features are paused until it resets." });
        throw error;
      }
    }
    return json(400, { ok: false, error: 'Unknown request.' });
  } catch (error) {
    console.error('video-ads failed:', error);
    return json(502, { ok: false, error: 'Video Ads is unavailable right now. Try again in a moment.' });
  }
};

exports._test = { variantsFrom, isVideoUrl, sizeFromUrl, clipFromPost, trends, checkVariant, research, copy, chat, RESEARCH_CACHE };
