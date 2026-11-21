'use strict';
// Competitor ads (Video Ads): which ads other sports publishers and newsletters
// run on Facebook / Instagram right now, what looks like it works, what is being
// tested, and ideas for our own newsletters. Owner: "which ads are running good
// or bad, what's the current trend ... ideate better than our competitors".
//
// Nothing is stored. A check runs only when someone presses Check; results live
// in this server's memory for 30 minutes (so a repeat check costs nothing) and
// in the person's browser tab.
//
// Data: Meta's public Ad Library through the Apify actor
// igolaizola~facebook-ad-library-scraper ("lite", about $0.30 per 1,000 results),
// run synchronously (run-sync-get-dataset-items). APIFY_TOKEN (server env only)
// turns it on; without it every mode answers "not set up" and the page says so.
// Automated collection from the Ad Library is the owner's business decision
// (Meta's terms); see project-docs/ai-edit-log.md.
//
// The actor input and the field mapping are re-implemented in plain Node from
// fb-ad-library-mcp by Navid Moazzez (MIT License, Copyright (c) 2026):
// src/backends/apify.ts (actor input, error statuses), src/adlibrary/normalize.ts
// (adFromGraphql / adFromApify: creatives live in images / videos / cards
// depending on the ad's format), src/adlibrary/url.ts (Ad Library URLs).
//
// One endpoint, POST { mode, ... } (signed-in ES users only):
//   status       { configured, capUsd, perResultUsd, defaultLimit } — no Apify call
//   advertisers  { query, country? } -> the Pages behind a keyword's ads
//                (the lite actor has no Page search, so they are derived from
//                one small keyword run, like the reference implementation)
//   ads          { query | pageId | url, country?, limit?, status? } -> normalized
//                ads, a summary, the matching Page and the run's cost
//   analyze      { ads, target? } -> working / testing / trends / notWorking /
//                ideas (the cheap main tier, JSON, numbers checked in code)
// Costs: each Apify run is logged as feature `meta-ads-fetch` (results x $0.30
// per 1,000) and counts toward the AI budget; a code-side weekly cap
// (APIFY_POLICY.weeklyUsd, $4 team-wide; APIFY_WEEKLY_LIMIT_USD can only lower
// it) keeps Apify's $5 monthly free credit safe. Analysis is `meta-ads-analyze`.

const { verifyEsUser, bearerToken, authConfig } = require('./_supabase-auth.js');
const {
  aiText, gatewayConfigured, isBudgetError, userOverHourlyLimit, aiSpendGate, featureDisabled, featureOffMessage,
  freeModeGate, inFreeMode, withAiMode, logUsage, policyLimit, weekStartUtc,
} = require('./_ai-gateway.js');

const ACTOR = 'igolaizola~facebook-ad-library-scraper';
const APIFY_BASE = 'https://api.apify.com/v2';
const AD_LIBRARY = 'https://www.facebook.com/ads/library/';
const PER_RESULT_USD = 0.30 / 1000;
const APIFY_POLICY = Object.freeze({ weeklyUsd: 4 });
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 120;
const LIMITS = Object.freeze({ defaultAds: 50, maxAds: 60, advertisers: 30, query: 120, analyzeAds: 60, body: 200000, text: 600 });
const RUN_TIMEOUT_S = 100; // Apify's own run timeout; the function allows 120 s (vercel.json)
const FEATURES = Object.freeze({ fetch: 'meta-ads-fetch', analyze: 'meta-ads-analyze' });
const COUNTRIES = new Set(['US', 'CA', 'GB', 'AU', 'IE', 'NZ', 'IN', 'ALL']);
const NOT_SET_UP = "Competitor ads isn't set up yet. Ask an admin to add APIFY_TOKEN in Vercel to turn this on.";

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
const apifyToken = (env = process.env) => String(env.APIFY_TOKEN || '').trim();
const configured = (env = process.env) => Boolean(apifyToken(env));
function weeklyCapUsd(env = process.env) { return policyLimit('APIFY_WEEKLY_LIMIT_USD', APIFY_POLICY.weeklyUsd, env).limit; }
const costFor = results => Number((Math.max(0, Number(results) || 0) * PER_RESULT_USD).toFixed(6));

// ─── Small JSON helpers (reference: normalize.ts) ───────────────────────────
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : undefined);
const str = v => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const arr = v => (Array.isArray(v) ? v.filter(x => obj(x)) : []);
const strArray = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
// The lite actor passes Meta's snake_case through; other Apify actors use camelCase.
const pick = (o, ...keys) => { if (!o) return undefined; for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };
const clip = (v, n = LIMITS.text) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Unix seconds (number or digit string) or an ISO-ish string -> YYYY-MM-DD.
function isoDate(value) {
  if (value === null || value === undefined || value === '' || value === 0) return undefined;
  let seconds;
  if (typeof value === 'number') seconds = value > 1e12 ? value / 1000 : value;
  else if (typeof value === 'string') {
    if (!/^\d+$/.test(value)) { const d = Date.parse(value); return Number.isFinite(d) ? new Date(d).toISOString().slice(0, 10) : undefined; }
    seconds = Number(value);
    if (seconds > 1e12) seconds /= 1000;
  }
  if (!Number.isFinite(seconds)) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}
// Meta wraps copy as {"text": "..."}; providers send a bare string.
function text(value) {
  if (typeof value === 'string') return str(value);
  const w = obj(value);
  return w ? str(w.text) : undefined;
}
// l.facebook.com/l.php?u=<real> -> <real>
function unwrapRedirect(url) {
  if (!url || !/l\.facebook\.com/.test(url)) return url;
  try { const target = new URL(url).searchParams.get('u'); return target || url; } catch { return url; }
}
function domainOf(url) {
  if (!url) return undefined;
  try { const host = new URL(url).hostname.toLowerCase(); return host.startsWith('www.') ? host.slice(4) : host || undefined; } catch { return undefined; }
}
const platformLabel = v => String(v).split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
const httpsUrl = url => { try { const u = new URL(String(url)); return u.protocol === 'https:' ? u.toString() : ''; } catch { return ''; } };
// Creative files: Meta's CDNs only (img-src / links in the page).
const mediaUrl = url => { const u = httpsUrl(url); if (!u) return ''; const host = new URL(u).hostname; return /(^|\.)fbcdn\.net$|(^|\.)facebook\.com$|(^|\.)fbsbx\.com$/.test(host) ? u : ''; };

// Whole days the ad has run: Meta's total_active_time when given, else from the
// start date to today (still running) or to its end date (stopped).
function daysRunning({ start, end, active, activeSeconds } = {}, now = Date.now()) {
  if (activeSeconds && activeSeconds > 0) return Math.floor(activeSeconds / 86400);
  const s = Date.parse(start || '');
  if (!Number.isFinite(s)) return null;
  const e = active === false && end ? Date.parse(end) : now;
  if (!Number.isFinite(e)) return null;
  return Math.max(0, Math.floor((e - s) / 86400000));
}

// Creatives live in three disjoint places depending on the ad's format:
// images (IMAGE), videos (VIDEO), cards (DCO, DPA, CAROUSEL; per-card copy).
function creativesFrom(snapshot) {
  const out = [];
  for (const image of arr(pick(snapshot, 'images'))) {
    out.push({ kind: 'image', image: str(pick(image, 'resized_image_url', 'resizedImageUrl')) || str(pick(image, 'original_image_url', 'originalImageUrl')) });
  }
  for (const video of arr(pick(snapshot, 'videos'))) {
    out.push({ kind: 'video', video: str(pick(video, 'video_sd_url', 'videoSdUrl')) || str(pick(video, 'video_hd_url', 'videoHdUrl')), image: str(pick(video, 'video_preview_image_url', 'videoPreviewImageUrl')) });
  }
  for (const card of arr(pick(snapshot, 'cards'))) {
    const video = str(pick(card, 'video_sd_url', 'videoSdUrl')) || str(pick(card, 'video_hd_url', 'videoHdUrl'));
    out.push({
      kind: video ? 'video' : 'image', card: true, video,
      image: str(pick(card, 'video_preview_image_url', 'videoPreviewImageUrl')) || str(pick(card, 'resized_image_url', 'resizedImageUrl')) || str(pick(card, 'original_image_url', 'originalImageUrl')),
      title: text(pick(card, 'title')), body: text(pick(card, 'body')), ctaText: str(pick(card, 'cta_text', 'ctaText')),
      linkUrl: unwrapRedirect(str(pick(card, 'link_url', 'linkUrl'))),
    });
  }
  return out;
}

function mediaTypeOf(displayFormat, creatives) {
  const fmt = String(displayFormat || '').toUpperCase();
  const cards = creatives.filter(c => c.card).length;
  if (fmt === 'CAROUSEL' || ((fmt === 'DPA' || fmt === 'DCO') && cards > 1) || cards > 1) return 'carousel';
  if (fmt === 'VIDEO' || creatives.some(c => c.kind === 'video')) return 'video';
  if (fmt === 'IMAGE' || creatives.some(c => c.image)) return 'image';
  return 'text';
}

// One actor item -> our ad shape. Handles Meta's own shape passed through
// (ad_archive_id + snapshot), its camelCase twin, and the flat shape.
function normalizeAd(item, now = Date.now()) {
  const node = obj(item) || {};
  const snapshot = obj(pick(node, 'snapshot')) || {};
  const flat = !obj(node.snapshot);
  const src = flat ? node : snapshot;
  const id = String(pick(node, 'ad_archive_id', 'adArchiveID', 'adArchiveId', 'adId', 'id') ?? '').replace(/[^\d]/g, '');
  const creatives = flat ? creativesFrom(node) : creativesFrom(snapshot);
  const first = creatives[0] || {};
  const linkUrl = httpsUrl(unwrapRedirect(str(pick(src, 'link_url', 'linkUrl')) || first.linkUrl)) || '';
  const startDate = isoDate(pick(node, 'start_date', 'startDate', 'startDateFormatted'));
  const endDate = isoDate(pick(node, 'end_date', 'endDate', 'endDateFormatted'));
  const activeRaw = pick(node, 'is_active', 'isActive');
  const isActive = typeof activeRaw === 'boolean' ? activeRaw : null;
  const displayFormat = str(pick(src, 'display_format', 'displayFormat')) || '';
  const body = text(pick(src, 'body')) || text(pick(node, 'adText')) || first.body || '';
  const title = text(pick(src, 'title')) || first.title || '';
  const pageName = str(pick(node, 'page_name', 'pageName')) || str(pick(snapshot, 'page_name', 'pageName')) || '';
  const pageId = pick(node, 'page_id', 'pageID', 'pageId') ?? pick(snapshot, 'page_id', 'pageID', 'pageId');
  return {
    id,
    pageId: pageId !== undefined ? String(pageId).replace(/[^\d]/g, '') : '',
    pageName: clip(pageName, 120),
    pageUrl: httpsUrl(str(pick(snapshot, 'page_profile_uri', 'pageProfileUri')) || str(pick(node, 'page_profile_uri', 'pageUrl'))) || '',
    pagePicture: mediaUrl(str(pick(snapshot, 'page_profile_picture_url', 'pageProfilePictureUrl'))),
    body: clip(body, 1200),
    title: clip(title, 200),
    caption: clip(text(pick(src, 'caption')), 120),
    ctaText: clip(str(pick(src, 'cta_text', 'ctaText')) || first.ctaText, 40),
    ctaType: clip(str(pick(src, 'cta_type', 'ctaType')), 40),
    linkUrl,
    linkDomain: domainOf(linkUrl) || '',
    mediaType: mediaTypeOf(displayFormat, creatives),
    displayFormat,
    thumbnailUrl: mediaUrl(creatives.find(c => c.image)?.image),
    videoUrl: mediaUrl(creatives.find(c => c.video)?.video),
    cardCount: creatives.filter(c => c.card).length,
    platforms: strArray(pick(node, 'publisher_platform', 'publisherPlatform')).map(platformLabel),
    startDate: startDate || '',
    endDate: endDate || '',
    isActive,
    daysRunning: daysRunning({ start: startDate, end: endDate, active: isActive, activeSeconds: num(pick(node, 'total_active_time', 'totalActiveTime')) }, now),
    variants: num(pick(node, 'collation_count', 'collationCount')) || null,
    adLibraryUrl: id ? `${AD_LIBRARY}?id=${id}` : '',
  };
}

function normalizeAll(items, now = Date.now()) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!obj(item)) continue;
    const ad = normalizeAd(item, now);
    if (!ad.id || seen.has(ad.id)) continue;
    seen.add(ad.id);
    out.push(ad);
  }
  return out;
}

// ─── What to search for ─────────────────────────────────────────────────────
// A Facebook Page URL / ID becomes a pageId; a page URL with a vanity name
// becomes that name as a keyword (resolving it would need another request);
// anything else is a keyword (brand name or topic).
function parseTarget({ query, pageId, url } = {}) {
  const id = String(pageId ?? '').trim();
  if (/^\d{5,20}$/.test(id)) return { pageId: id, label: id };
  const raw = clip(url || query, LIMITS.query);
  if (!raw) return null;
  if (/^\d{5,20}$/.test(raw)) return { pageId: raw, label: raw };
  let parsed = null;
  try { parsed = new URL(/^https?:\/\//i.test(raw) ? raw : (/^(www\.|m\.)?facebook\.com\//i.test(raw) ? `https://${raw}` : '')); } catch { parsed = null; }
  if (parsed && /(^|\.)facebook\.com$/i.test(parsed.hostname)) {
    // An Ad Library link (view_all_page_id) or profile.php?id= (an ad's ?id= is not a Page).
    const viewAll = parsed.searchParams.get('view_all_page_id') || '';
    if (/^\d{5,20}$/.test(viewAll)) return { pageId: viewAll, label: viewAll };
    const profileId = /profile\.php/.test(parsed.pathname) ? parsed.searchParams.get('id') || '' : '';
    if (/^\d{5,20}$/.test(profileId)) return { pageId: profileId, label: profileId };
    const q = /\/ads\/library/.test(parsed.pathname) ? clip(parsed.searchParams.get('q'), LIMITS.query) : '';
    if (q) return { query: q, label: q };
    const pidMatch = parsed.pathname.match(/-(\d{8,20})\/?$/) || parsed.pathname.match(/^\/(\d{5,20})\/?$/);
    if (pidMatch) return { pageId: pidMatch[1], label: pidMatch[1] };
    const slug = parsed.pathname.split('/').filter(Boolean)[0] || '';
    if (slug && !/^(ads|profile\.php|pages|groups|watch)$/i.test(slug)) return { query: slug.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ').trim(), label: slug, fromUrl: true };
    return null;
  }
  return { query: raw, label: raw };
}

// The lite actor's input (reference: apify.ts inputFor, actor "lite").
function actorInput(target, { country = 'US', limit = LIMITS.defaultAds, status = 'active' } = {}) {
  return {
    maxItems: limit,
    ...(target.pageId ? { pageId: target.pageId } : { query: target.query }),
    country: country === 'ALL' ? 'ALL' : country,
    mediaType: 'all',
    activeStatus: status === 'all' ? 'all' : 'active',
    fetchDetails: true,
  };
}
function adLibraryUrl(target, { country = 'US', status = 'active' } = {}) {
  const search = new URLSearchParams({ active_status: status === 'all' ? 'all' : 'active', ad_type: 'all', country, media_type: 'all' });
  if (target.pageId) { search.set('view_all_page_id', target.pageId); search.set('search_type', 'page'); } else search.set('search_type', 'keyword_unordered');
  if (target.query) search.set('q', target.query);
  return `${AD_LIBRARY}?${search.toString()}`;
}

// ─── Apify ──────────────────────────────────────────────────────────────────
class ApifyError extends Error {
  constructor(message, { status = 502, reason = 'apify' } = {}) { super(message); this.status = status; this.reason = reason; }
}
async function runActor(input, { token = apifyToken(), fetchImpl = fetch, timeoutS = RUN_TIMEOUT_S } = {}) {
  // The token goes in the Authorization header (Apify accepts Bearer), so it is
  // never part of a URL that could end up in a log.
  const endpoint = `${APIFY_BASE}/acts/${ACTOR}/run-sync-get-dataset-items?timeout=${timeoutS}&maxItems=${Number(input.maxItems) || LIMITS.defaultAds}&clean=true`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((timeoutS + 10) * 1000),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new ApifyError('The ad library took too long to answer. Try again, or check fewer ads.', { status: 504, reason: 'timeout' });
    throw new ApifyError("Couldn't reach the ad library right now. Try again in a moment.", { status: 502, reason: 'network' });
  }
  if (response.status === 401) throw new ApifyError('The ad library refused the key. Ask an admin to check APIFY_TOKEN in Vercel.', { status: 502, reason: 'apify-auth' });
  if (response.status === 402) throw new ApifyError("The Apify account is out of credit, so checks are paused. Ask an admin to top it up.", { status: 503, reason: 'apify-credit' });
  if (response.status === 403) {
    const body = await response.text().catch(() => '');
    if (/public-actor-disabled/.test(body)) throw new ApifyError("The Apify plan can't run this scraper. Ask an admin to check the Apify plan.", { status: 503, reason: 'apify-plan' });
    throw new ApifyError('The ad library refused the request. Ask an admin to check APIFY_TOKEN in Vercel.', { status: 502, reason: 'apify-auth' });
  }
  if (response.status === 408) throw new ApifyError('The ad library took too long to answer. Try again, or check fewer ads.', { status: 504, reason: 'timeout' });
  if (response.status === 429) throw new ApifyError('The ad library is busy right now. Try again in a minute.', { status: 429, reason: 'apify-busy' });
  if (!response.ok) throw new ApifyError("The ad library check didn't work. Try again in a moment.", { status: 502, reason: 'apify' });
  const items = await response.json().catch(() => null);
  return Array.isArray(items) ? items : [];
}

// ─── Weekly Apify cap ───────────────────────────────────────────────────────
// Team-wide spend this week = the logged meta-ads-fetch rows (read with the
// service role when it is set) or, failing that, what this server has spent.
const memSpend = { week: '', usd: 0 };
function noteSpend(usd, now = new Date()) {
  const week = weekStartUtc(now).toISOString();
  if (memSpend.week !== week) { memSpend.week = week; memSpend.usd = 0; }
  memSpend.usd += Math.max(0, Number(usd) || 0);
}
async function weekSpendUsd({ fetchImpl = fetch, env = process.env, now = new Date() } = {}) {
  const week = weekStartUtc(now).toISOString();
  const mem = memSpend.week === week ? memSpend.usd : 0;
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!serviceKey) return { usd: mem, source: 'memory' };
  try {
    const config = authConfig();
    const response = await fetchImpl(`${config.url}/rest/v1/frameup_ai_usage?select=cost_usd&feature=eq.${FEATURES.fetch}&created_at=gte.${encodeURIComponent(week)}&limit=5000`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return { usd: mem, source: 'memory' };
    const rows = await response.json();
    const db = (Array.isArray(rows) ? rows : []).reduce((sum, r) => sum + (Number(r?.cost_usd) || 0), 0);
    return { usd: Math.max(db, mem), source: 'database' };
  } catch { return { usd: mem, source: 'memory' }; }
}
function overCapMessage(cap) {
  return `This week's $${Number.isInteger(cap) ? cap : cap.toFixed(2)} budget for competitor checks is used up. Checks come back Monday; earlier results in this tab still work.`;
}

// ─── In-memory cache (30 minutes; not storage) ──────────────────────────────
const CACHE = new Map();
function cacheGet(key, now = Date.now()) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) { CACHE.delete(key); return null; }
  return hit;
}
function cacheSet(key, data, now = Date.now()) {
  CACHE.set(key, { at: now, data });
  while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
}

// ─── Summary (code, no AI) ──────────────────────────────────────────────────
const median = list => { const s = list.filter(n => Number.isFinite(n)).sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
function countBy(list, key) {
  const map = new Map();
  list.forEach(item => { const k = typeof key === 'function' ? key(item) : item[key]; (Array.isArray(k) ? k : [k]).filter(Boolean).forEach(v => map.set(v, (map.get(v) || 0) + 1)); });
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}
function summarize(ads) {
  const media = { video: 0, image: 0, carousel: 0, text: 0 };
  ads.forEach(a => { media[a.mediaType] = (media[a.mediaType] || 0) + 1; });
  const days = ads.map(a => a.daysRunning).filter(n => Number.isFinite(n));
  return {
    total: ads.length,
    active: ads.filter(a => a.isActive !== false).length,
    media,
    medianDays: median(days),
    longestDays: days.length ? Math.max(...days) : null,
    longRunning: ads.filter(a => a.daysRunning >= 30).length,
    newThisWeek: ads.filter(a => Number.isFinite(a.daysRunning) && a.daysRunning <= 7).length,
    ctas: countBy(ads, a => a.ctaText).slice(0, 6),
    platforms: countBy(ads, 'platforms').slice(0, 6),
    pages: countBy(ads, 'pageName').slice(0, 8),
  };
}
// Ads grouped by Page (the advertisers mode, and "did you mean" after a keyword run).
function advertisersFrom(ads) {
  const byPage = new Map();
  ads.forEach(ad => {
    if (!ad.pageId) return;
    const hit = byPage.get(ad.pageId);
    if (hit) { hit.adCount += 1; return; }
    byPage.set(ad.pageId, { pageId: ad.pageId, pageName: ad.pageName, pageUrl: ad.pageUrl, picture: ad.pagePicture, adCount: 1 });
  });
  return [...byPage.values()].sort((a, b) => b.adCount - a.adCount).slice(0, 12);
}
const squash = s => String(s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
// The Page whose name matches a typed brand ("the athletic" -> "The Athletic").
function matchPage(query, advertisers) {
  const q = squash(query);
  if (q.length < 3) return null;
  return advertisers.find(a => squash(a.pageName) === q) || advertisers.find(a => squash(a.pageName).startsWith(q) || (q.length >= 5 && squash(a.pageName).includes(q))) || null;
}

// ─── Modes: advertisers / ads ───────────────────────────────────────────────
const countryOf = c => (COUNTRIES.has(String(c || '').toUpperCase()) ? String(c).toUpperCase() : 'US');
const limitOf = n => Math.max(5, Math.min(LIMITS.maxAds, Math.round(Number(n) || LIMITS.defaultAds)));

async function fetchAds(target, options, deps = {}) {
  const items = await runActor(actorInput(target, options), deps);
  return { items, ads: normalizeAll(items, deps.now || Date.now()) };
}

async function logFetch(track, { results, ok, started, error }) {
  const usd = ok ? costFor(results) : 0;
  if (ok) noteSpend(usd);
  await logUsage({ ...track, feature: FEATURES.fetch, task: 'apify-ad-library' }, {
    model: `apify/${ACTOR}`, ok, input_tokens: 0, output_tokens: 0,
    cost_usd: usd, duration_ms: Date.now() - started, ...(error ? { error: String(error).slice(0, 200) } : {}),
  });
  return usd;
}

// Shared gate for anything that runs the actor. Returns a reply when blocked.
async function fetchGate(track, estimateUsd, deps = {}) {
  if (featureDisabled(FEATURES.fetch)) return json(503, { ok: false, reason: 'feature-off', error: featureOffMessage(FEATURES.fetch) });
  if (await userOverHourlyLimit(track.token)) return json(429, { ok: false, reason: 'limit', error: "You've run a lot of checks this hour. Take a short break and try again soon." });
  const gate = await aiSpendGate(track.token, { feature: FEATURES.fetch });
  // Over a weekly AI budget: a check has no free version, so a plain "over budget"
  // reply (reason renamed so withAiMode doesn't turn it into a free-mode success).
  if (gate) return json(gate.status, { ok: false, reason: gate.free ? 'over-budget' : gate.reason, error: gate.error });
  const cap = weeklyCapUsd(deps.env);
  const spent = await weekSpendUsd(deps);
  if (spent.usd + estimateUsd > cap + 1e-9) return json(429, { ok: false, reason: 'over-cap', error: overCapMessage(cap), capUsd: cap, spentUsd: Number(spent.usd.toFixed(4)) });
  return null;
}

async function adsMode(body, track, deps = {}) {
  const target = parseTarget(body);
  if (!target) return json(400, { ok: false, reason: 'input', error: 'Type a brand name, a Facebook Page link or a keyword.' });
  const country = countryOf(body.country);
  const limit = limitOf(body.limit);
  const status = body.status === 'all' ? 'all' : 'active';
  const key = `ads|${country}|${status}|${limit}|${target.pageId ? `p:${target.pageId}` : `q:${target.query.toLowerCase()}`}`;
  const hit = cacheGet(key);
  if (hit) return json(200, { ...hit.data, cost: { ...hit.data.cost, usd: 0, cached: true, cachedAt: new Date(hit.at).toISOString() } });
  if (!configured(deps.env)) return json(503, { ok: false, reason: 'not-set-up', error: NOT_SET_UP });
  const blocked = await fetchGate(track, costFor(limit), deps);
  if (blocked) return blocked;
  const started = Date.now();
  let result;
  try {
    result = await fetchAds(target, { country, limit, status }, deps);
  } catch (error) {
    await logFetch(track, { results: 0, ok: false, started, error: error.reason || error.message });
    if (error instanceof ApifyError) return json(error.status, { ok: false, reason: error.reason, error: error.message });
    throw error;
  }
  const usd = await logFetch(track, { results: result.items.length, ok: true, started });
  let ads = result.ads;
  const advertisers = advertisersFrom(ads);
  let matchedPage = null;
  if (target.query) {
    matchedPage = matchPage(target.query, advertisers);
    // A brand name: keep that Page's ads when it has any; otherwise show the keyword results.
    if (matchedPage) ads = ads.filter(a => a.pageId === matchedPage.pageId);
  }
  ads.sort((a, b) => (b.daysRunning ?? -1) - (a.daysRunning ?? -1));
  const data = {
    ok: true,
    target: { ...target, country, status },
    matchedPage,
    advertisers,
    ads,
    summary: summarize(ads),
    adLibraryUrl: adLibraryUrl(matchedPage ? { pageId: matchedPage.pageId } : target, { country, status }),
    fetchedAt: new Date().toISOString(),
    cost: { usd, results: result.items.length, perResultUsd: PER_RESULT_USD, cached: false },
  };
  cacheSet(key, data);
  return json(200, data);
}

async function advertisersMode(body, track, deps = {}) {
  const target = parseTarget(body);
  if (!target) return json(400, { ok: false, reason: 'input', error: 'Type a brand name, a Facebook Page link or a keyword.' });
  const country = countryOf(body.country);
  if (target.pageId) return json(200, { ok: true, advertisers: [{ pageId: target.pageId, pageName: '', adCount: null }], cost: { usd: 0, results: 0, cached: false } });
  const key = `adv|${country}|${target.query.toLowerCase()}`;
  const hit = cacheGet(key);
  if (hit) return json(200, { ...hit.data, cost: { ...hit.data.cost, usd: 0, cached: true } });
  if (!configured(deps.env)) return json(503, { ok: false, reason: 'not-set-up', error: NOT_SET_UP });
  const blocked = await fetchGate(track, costFor(LIMITS.advertisers), deps);
  if (blocked) return blocked;
  const started = Date.now();
  let result;
  try {
    result = await fetchAds(target, { country, limit: LIMITS.advertisers, status: 'active' }, deps);
  } catch (error) {
    await logFetch(track, { results: 0, ok: false, started, error: error.reason || error.message });
    if (error instanceof ApifyError) return json(error.status, { ok: false, reason: error.reason, error: error.message });
    throw error;
  }
  const usd = await logFetch(track, { results: result.items.length, ok: true, started });
  const advertisers = advertisersFrom(result.ads);
  const data = { ok: true, advertisers, matchedPage: matchPage(target.query, advertisers), cost: { usd, results: result.items.length, cached: false } };
  cacheSet(key, data);
  return json(200, data);
}

// ─── Analyze ────────────────────────────────────────────────────────────────
const BRANDS = [
  { id: 'essentially-cfb', label: 'Essentially CFB', sport: 'college football', cta: 'SIGN UP ES CFB' },
  { id: 'es-dugout', label: 'ES Dugout', sport: 'MLB', cta: 'SIGN UP ES DUGOUT' },
  { id: 'the-huddle', label: 'The Huddle', sport: 'NFL', cta: 'SIGN UP THE HUDDLE' },
];
const WORKING_DAYS = 30;
const TESTING_DAYS = 7;
const SHORT_DAYS = 14;

// Ads the browser sends back: only the fields the analysis reads, capped.
function cleanAds(list) {
  return (Array.isArray(list) ? list : []).slice(0, LIMITS.analyzeAds).map(a => ({
    id: String(a?.id ?? '').replace(/[^\d]/g, '').slice(0, 24),
    pageName: clip(a?.pageName, 80),
    body: clip(a?.body, 400),
    title: clip(a?.title, 140),
    ctaText: clip(a?.ctaText, 40),
    mediaType: ['video', 'image', 'carousel', 'text'].includes(a?.mediaType) ? a.mediaType : 'text',
    platforms: strArray(a?.platforms).slice(0, 5).map(p => clip(p, 24)),
    daysRunning: Number.isFinite(Number(a?.daysRunning)) && a?.daysRunning !== null ? Math.max(0, Math.round(Number(a.daysRunning))) : null,
    isActive: typeof a?.isActive === 'boolean' ? a.isActive : null,
    variants: Number(a?.variants) > 0 ? Math.round(Number(a.variants)) : null,
    cardCount: Math.max(0, Math.round(Number(a?.cardCount) || 0)),
  })).filter(a => a.id);
}

// The buckets are decided in code (facts); the AI only explains them.
function buckets(ads) {
  const byDays = [...ads].sort((a, b) => (b.daysRunning ?? -1) - (a.daysRunning ?? -1));
  const working = byDays.filter(a => a.daysRunning >= WORKING_DAYS).slice(0, 8);
  const testing = [...ads].filter(a => Number.isFinite(a.daysRunning) && a.daysRunning <= TESTING_DAYS).sort((a, b) => a.daysRunning - b.daysRunning).slice(0, 8);
  const stopped = ads.filter(a => a.isActive === false && Number.isFinite(a.daysRunning) && a.daysRunning <= SHORT_DAYS).slice(0, 8);
  return { working, testing, stopped };
}

// Numbers the analysis may repeat: those in the ads' own words (and the
// thresholds the page states). Everything else counts as invented.
const NUMBER_RE = /\d[\d,.]*\s*%?/g;
const normNum = s => s.replace(/[,\s%]/g, '').replace(/\.$/, '').replace(/\.0+$/, '');
function allowedNumbers(ads) {
  const set = new Set(['7', '30']);
  ads.forEach(a => `${a.body} ${a.title} ${a.ctaText} ${a.pageName}`.replace(NUMBER_RE, m => { set.add(normNum(m)); return m; }));
  return set;
}
function inventedNumbers(textValue, allowed) {
  const found = String(textValue || '').match(NUMBER_RE) || [];
  return found.map(normNum).filter(n => n && !allowed.has(n));
}

const ANALYZE_SYSTEM = [
  'You are a performance-ad strategist for EssentiallySports (ES), a sports publisher with three free email newsletters: Essentially CFB (college football), ES Dugout (MLB) and The Huddle (NFL).',
  'You read competitors\' ads from Meta\'s public Ad Library and explain what they are doing. Ads that run a long time usually work (advertisers stop paying for losers); brand-new ads are tests. Never claim to know results: say "likely" and why.',
  'Rules: refer to ads only by their id from the list. Do not write any number (days, counts, percentages, prices, subscriber counts) unless it appears in the ad\'s own text; the page already shows the real numbers. Never invent facts, quotes or results.',
  'The ideas are new ads for OUR newsletters, in the ES Video Ads "highlight" format: headline (max 22 words, plain, calm, says it is free), highlight (2-6 words copied exactly from the headline, shown on a coloured box), body (1-2 short paragraphs, under 60 words in all, sentences of 14 words or fewer, plain words for fans aged 55+), cta (short sign-up button text). No numbers at all in ideas, no emojis, hashtags, links, "Breaking", hype or urgency tricks, no player endorsements, never name a competitor.',
  'Return JSON only.',
].join('\n');

function analyzePrompt(ads, target, groups) {
  const line = a => JSON.stringify({ id: a.id, page: a.pageName, format: a.mediaType, cards: a.cardCount || undefined, active: a.isActive, cta: a.ctaText || undefined, platforms: a.platforms, title: a.title || undefined, body: a.body || undefined, variants: a.variants || undefined, bucket: groups.working.includes(a) ? 'long-running' : groups.testing.includes(a) ? 'new' : groups.stopped.includes(a) ? 'stopped-quickly' : undefined });
  return [
    `Competitor checked: ${clip(target, 120) || 'several advertisers'}.`,
    `Ads (${ads.length}):`,
    ads.map(line).join('\n'),
    '',
    `Long-running ad ids (30+ days): ${groups.working.map(a => a.id).join(', ') || 'none'}.`,
    `New ad ids (last 7 days): ${groups.testing.map(a => a.id).join(', ') || 'none'}.`,
    `Stopped-quickly ad ids: ${groups.stopped.map(a => a.id).join(', ') || 'none'}.`,
    '',
    'Return this JSON:',
    '{"headline":"one sentence: what this competitor is doing right now",',
    ' "working":[{"id":"<long-running id>","why":"why it likely works: hook, offer, format, visual"}],',
    ' "testing":[{"id":"<new id>","what":"what they seem to be testing"}],',
    ' "trends":[{"label":"Formats|Hooks|Offers|CTAs|Length|Visual style","detail":"the pattern across these ads"}],',
    ' "notWorking":[{"id":"<stopped-quickly id, or omit>","pattern":"what likely did not work","why":"the evidence, said as an inference"}],',
    ' "ideas":[{"brand":"essentially-cfb|es-dugout|the-huddle","angle":"short name","headline":"","highlight":"","body":[""],"cta":"","inspiredBy":["<ad id>"]}]}',
    'Up to 5 working, 5 testing, 4-6 trends, up to 3 notWorking (when there are no stopped ads, infer only from patterns the long-running ads avoid, and say it is inferred), exactly 5 ideas covering all three newsletters.',
  ].join('\n');
}

function parseJson(raw) {
  const s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(s); } catch { /* fall through */ }
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; } }
  return null;
}

// Highlight must be words from the headline (the Video Ads highlight style).
function fixHighlight(headline, highlight) {
  const h = clip(highlight, 80);
  if (h && headline.toLowerCase().includes(h.toLowerCase())) {
    const at = headline.toLowerCase().indexOf(h.toLowerCase());
    return headline.slice(at, at + h.length);
  }
  const sentences = headline.split(/(?<=[.!?])\s+/).filter(Boolean);
  const last = sentences.length > 1 ? sentences[sentences.length - 1] : '';
  return last && last.split(/\s+/).length <= 6 ? last : '';
}

// Turns the model's JSON into the reply: known ids only, no invented numbers.
function shapeAnalysis(data, ads, groups) {
  const allowed = allowedNumbers(ads);
  const ids = new Set(ads.map(a => a.id));
  const inSet = set => item => set.has(String(item?.id || ''));
  const workingIds = new Set(groups.working.map(a => a.id));
  const testingIds = new Set(groups.testing.map(a => a.id));
  let dropped = 0;
  const keep = (list, fields, filter = () => true, max = 5) => (Array.isArray(list) ? list : []).filter(x => obj(x)).filter(filter).map(x => {
    const out = {};
    Object.entries(fields).forEach(([k, n]) => { out[k] = clip(x[k], n); });
    return out;
  }).filter(x => {
    const bad = Object.values(x).some(v => inventedNumbers(v === x.id ? '' : v, allowed).length);
    if (bad) dropped += 1;
    return !bad;
  }).slice(0, max);
  const working = keep(data?.working, { id: 24, why: 300 }, inSet(workingIds)).filter(x => x.why);
  const testing = keep(data?.testing, { id: 24, what: 300 }, inSet(testingIds)).filter(x => x.what);
  const trends = keep(data?.trends, { label: 40, detail: 320 }, () => true, 6).filter(x => x.label && x.detail);
  const notWorking = keep(data?.notWorking, { id: 24, pattern: 200, why: 300 }, x => !x.id || ids.has(String(x.id)), 3)
    .filter(x => x.pattern).map(x => ({ ...x, id: ids.has(x.id) ? x.id : '', inferred: true }));
  const ideas = (Array.isArray(data?.ideas) ? data.ideas : []).filter(x => obj(x)).map(x => {
    const brand = BRANDS.find(b => b.id === x.brand) || null;
    const headline = clip(x.headline, 200);
    const body = (Array.isArray(x.body) ? x.body : [x.body]).map(p => clip(p, 400)).filter(Boolean).slice(0, 3);
    return {
      brand: brand ? brand.id : '',
      angle: clip(x.angle, 60),
      headline,
      highlight: fixHighlight(headline, x.highlight),
      body,
      cta: clip(x.cta, 40) || (brand ? brand.cta : ''),
      inspiredBy: strArray(x.inspiredBy).map(String).filter(id => ids.has(id)).slice(0, 3),
    };
  }).filter(x => {
    if (!x.brand || !x.headline || !x.body.length) return false;
    // Ideas carry no numbers at all (nothing verified to say).
    const bad = /\d/.test(`${x.headline} ${x.highlight} ${x.body.join(' ')} ${x.cta}`);
    if (bad) dropped += 1;
    return !bad;
  }).slice(0, 5);
  const headline = inventedNumbers(data?.headline, allowed).length ? '' : clip(data?.headline, 240);
  return { headline, working, testing, trends, notWorking, ideas, dropped };
}

// No AI (free mode / AI off): the code buckets and counted trends only.
function freeAnalysis(ads, groups) {
  const s = summarize(ads);
  const trends = [];
  const media = Object.entries(s.media).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  if (media.length) trends.push({ label: 'Formats', detail: `Mostly ${media[0][0]} ads.` });
  if (s.ctas[0]) trends.push({ label: 'CTAs', detail: `The most used button is "${s.ctas[0].label}".` });
  if (s.platforms[0]) trends.push({ label: 'Placements', detail: `Most ads run on ${s.platforms.slice(0, 2).map(p => p.label).join(' and ')}.` });
  return {
    headline: '',
    working: groups.working.slice(0, 5).map(a => ({ id: a.id, why: '' })),
    testing: groups.testing.slice(0, 5).map(a => ({ id: a.id, what: '' })),
    trends,
    notWorking: groups.stopped.slice(0, 3).map(a => ({ id: a.id, pattern: 'Stopped soon after it started', why: 'Inferred from a short run; Meta does not publish results.', inferred: true })),
    ideas: [],
    dropped: 0,
  };
}

const ANALYZE_TIER = 'main'; // Haiku 5.5: the cheapest model that writes usable ad copy and reliable JSON
async function analyzeMode(body, track) {
  const ads = cleanAds(body.ads);
  if (!ads.length) return json(400, { ok: false, reason: 'input', error: 'There are no ads to read yet. Run a check first.' });
  const target = clip(body.target, 120);
  const groups = buckets(ads);
  const key = `an|${target.toLowerCase()}|${ads.map(a => `${a.id}:${a.daysRunning}`).join(',')}`;
  const hit = cacheGet(key);
  if (hit) return json(200, { ...hit.data, cost: { usd: 0, cached: true } });
  const free = reason => json(200, { ok: true, ai: false, reason, analysis: freeAnalysis(ads, groups), cost: { usd: 0, cached: false } });
  if (featureDisabled(FEATURES.analyze)) return free('feature-off');
  const gate = process.env.AI_GATEWAY_API_KEY && !inFreeMode() ? await aiSpendGate(track.token, { feature: FEATURES.analyze }) : null;
  if (inFreeMode() || freeModeGate(gate)) return free('free');
  if (gate) return json(gate.status, { ok: false, reason: gate.reason, error: gate.error });
  if (!gatewayConfigured()) return free('off');
  if (await userOverHourlyLimit(track.token)) return json(429, { ok: false, reason: 'limit', error: "You've used a lot of AI this hour. Take a short break and try again soon." });
  let result;
  try {
    result = await aiText({ tier: ANALYZE_TIER, system: ANALYZE_SYSTEM, messages: [{ role: 'user', content: analyzePrompt(ads, target, groups) }], json: true, maxTokens: 3000, timeoutMs: 45000, track: { ...track, feature: FEATURES.analyze } });
  } catch (error) {
    if (inFreeMode()) return free('free');
    if (isBudgetError(error)) return free('budget');
    console.error('meta-ads analyze failed:', error.message);
    return json(502, { ok: false, reason: 'ai', error: "The AI couldn't read these ads right now. The ads and counts above still work; try again in a moment." });
  }
  const parsed = parseJson(result.text);
  if (!parsed) return json(502, { ok: false, reason: 'ai', error: "The AI's answer came back garbled. Try again in a moment." });
  const data = { ok: true, ai: true, analysis: shapeAnalysis(parsed, ads, groups), model: result.model, cost: { usd: Number((result.cost || 0).toFixed(6)), cached: false } };
  cacheSet(key, data);
  return json(200, data);
}

// ─── Handler ────────────────────────────────────────────────────────────────
exports.handler = withAiMode(async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });
  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error });
  if (String(event.body || '').length > LIMITS.body) return json(413, { ok: false, error: 'That request is too large.' });
  let body = {};
  try { body = JSON.parse(event.body || '{}') || {}; } catch { return json(400, { ok: false, error: 'Invalid request.' }); }
  const track = { email: auth.user.email, token: bearerToken(event.headers), runId: `ma-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}` };
  try {
    if (body.mode === 'status') {
      return json(200, { ok: true, configured: configured(), capUsd: weeklyCapUsd(), perResultUsd: PER_RESULT_USD, defaultLimit: LIMITS.defaultAds, maxLimit: LIMITS.maxAds, estimateUsd: costFor(LIMITS.defaultAds), notice: configured() ? '' : NOT_SET_UP });
    }
    if (body.mode === 'ads') return await adsMode(body, track);
    if (body.mode === 'advertisers') return await advertisersMode(body, track);
    if (body.mode === 'analyze') return await analyzeMode(body, track);
    return json(400, { ok: false, error: 'Unknown request.' });
  } catch (error) {
    console.error('meta-ads failed:', error);
    return json(502, { ok: false, error: 'Competitor ads is unavailable right now. Try again in a moment.' });
  }
});

exports._test = {
  ACTOR, PER_RESULT_USD, APIFY_POLICY, LIMITS, FEATURES, CACHE, CACHE_TTL_MS, NOT_SET_UP, memSpend,
  isoDate, text, unwrapRedirect, domainOf, mediaUrl, daysRunning, normalizeAd, normalizeAll, mediaTypeOf,
  parseTarget, actorInput, adLibraryUrl, runActor, ApifyError, weeklyCapUsd, weekSpendUsd, noteSpend, costFor,
  summarize, advertisersFrom, matchPage, cleanAds, buckets, allowedNumbers, inventedNumbers, analyzePrompt,
  parseJson, fixHighlight, shapeAnalysis, freeAnalysis, ANALYZE_SYSTEM, ANALYZE_TIER, adsMode, advertisersMode, analyzeMode,
  resetCache() { CACHE.clear(); memSpend.week = ''; memSpend.usd = 0; },
};
