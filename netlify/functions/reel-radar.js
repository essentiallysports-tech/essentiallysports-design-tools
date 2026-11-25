'use strict';
// Reels Studio: trend + inspiration radar (Reels 2.0, lane B). "What is doing
// well on this story right now?", from official X clips only (owner's choice:
// no YouTube, Instagram or TikTok).
//
// One endpoint, POST { mode, ... } (signed-in ES users only):
//   status   what is switched on and what a read costs; no clip or AI call
//   find     { topic | trend, sport } -> official X clips for the story, ranked
//            by views per hour. Reuses the Video Ads clip pipeline
//            (video-ads.js clipPipeline): the shared clip library first, then a
//            FREE top-up only (the X API when it is configured, the free clip
//            sources); never the paid web search. Trusted accounts only
//            (_clip-trust.js). $0.
//   analyze  { clips, topic } -> ONE Haiku call over the captions, lengths and
//            velocity: the patterns that are working + 3 "our version" briefs
//            in the ES voice. The model cannot watch the videos (the page says
//            so). Every number it writes is checked in code against the
//            fetched stats; briefs carry no numbers and no quotes. With AI off
//            or over a budget: counted patterns and template briefs (free).
//
// Nothing is stored and no media is proxied: a clip is its link, caption,
// thumbnail address and public counts. Results live in this server's memory for
// 30 minutes. Inspiration is a style reference only, never a fact source: a
// brief goes to the ideas room as an editor's note, not as a source.
const { verifyEsUser, bearerToken } = require('./_supabase-auth.js');
const {
  aiText, gatewayConfigured, isBudgetError, userOverHourlyLimit, aiSpendGate, featureDisabled,
  freeModeGate, inFreeMode, withAiMode,
} = require('./_ai-gateway.js');
const RULES = require('../../frameup-rules.js');
// Required when called, so tests can swap them (and a cold start stays light).
const pipeline = () => require('./video-ads.js').clipPipeline;
const moments = () => require('../../video-ads-moments.js');

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 120;
const CACHE = new Map();
const RADAR = Object.freeze({ enough: 6, maxClips: 12, topUpMs: 30000, caption: 280, query: 160, body: 60000 });
const FEATURES = Object.freeze({ analyze: 'reels-radar-analyze' });
const PRICES = Object.freeze({ find: 0, analyze: 0.001 });
const LENSES = ['fan-first', 'quote-led', 'verdict', 'money', 'fan-reaction', 'behind-the-moment'];
const SPORT_LABEL = { nfl: 'NFL', cfb: 'college football', mlb: 'MLB' };
const NOT_COVERED = 'Clips can be found for NFL, college football and MLB right now. Other sports are not covered by the trusted clip sources yet.';

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
const clip = (v, n = 300) => String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const num = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const httpsUrl = url => { try { const u = new URL(String(url)); return u.protocol === 'https:' ? u.toString() : ''; } catch { return ''; } };
const withTimeout = (promise, ms, fallback) => Promise.race([
  Promise.resolve(promise).catch(() => fallback),
  new Promise(resolve => setTimeout(() => resolve(fallback), ms)),
]);
function cacheGet(key, now = Date.now()) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) { CACHE.delete(key); return null; }
  return hit;
}
function cacheSet(key, data, now = Date.now()) {
  CACHE.set(key, { at: now, data });
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
}

// ─── Find ───────────────────────────────────────────────────────────────────
function readTarget(body = {}) {
  const trend = body.trend && typeof body.trend === 'object' ? body.trend : null;
  const query = clip(body.topic || (trend && trend.title), RADAR.query);
  const sport = String(body.sport || (trend && trend.sport) || '').toLowerCase();
  return { query, sport, trendId: trend ? String(trend.id || '').replace(/[^\w-]/g, '').slice(0, 80) : '' };
}

// Pipeline clip -> what the page shows. No file addresses (variants) leave here.
function publicClip(c, { now, velocity, older = false }) {
  const views = num(c.views);
  const likes = num(c.likes);
  const posted = c.postedAt ? new Date(c.postedAt).getTime() : NaN;
  return {
    url: httpsUrl(c.url),
    handle: clip(c.handle, 40).replace(/^@/, ''),
    caption: clip(c.text, RADAR.caption),
    thumb: httpsUrl(c.thumb),
    views, likes, viewsKnown: views > 0,
    postedAt: Number.isFinite(posted) ? new Date(posted).toISOString() : '',
    ageHours: Number.isFinite(posted) ? Math.max(0, Math.round((now - posted) / 3600e3)) : null,
    duration: Math.round(num(c.duration) || num(c.durationMs) / 1000),
    velocity: Math.round(velocity),
    source: ['official', 'league', 'media'].includes(c.sourceKind || c.source) ? (c.sourceKind || c.source) : 'media',
    sourceLabel: clip(c.trust && c.trust.label, 40),
    ...(older ? { older: true } : {}),
  };
}

// Trusted, de-duplicated, ranked by views per hour, capped.
function rankForRadar(clips, { now = Date.now(), deps = {} } = {}) {
  const P = deps.pipeline || pipeline();
  const M = deps.moments || moments();
  const trusted = clips.filter(c => c && c.url && P.TRUST.isTrusted({ platform: c.platform || 'x', handle: c.handle, url: c.url, mediaUrl: c.platform && c.platform !== 'x' ? c.variants?.[0]?.url : '' }));
  const unique = P.rankClips(trusted);
  const scored = unique.map(c => ({ c, velocity: M.velocityOf(c, now) }));
  const anyEngagement = scored.some(s => s.velocity > 0);
  const age = c => { const t = new Date(c.postedAt).getTime(); return Number.isFinite(t) ? now - t : Infinity; };
  scored.sort((a, b) => (anyEngagement ? b.velocity - a.velocity || (b.c.score ?? 0) - (a.c.score ?? 0) : age(a.c) - age(b.c)));
  return { ranked: scored.slice(0, RADAR.maxClips), ranking: anyEngagement ? 'views-per-hour' : 'newest', untrusted: clips.length - trusted.length };
}

async function findMode(body, track, deps = {}) {
  const target = readTarget(body);
  if (target.query.length < 3) return json(400, { ok: false, reason: 'input', error: 'Pick a trend or type a topic first.' });
  const P = deps.pipeline || pipeline();
  if (!P.AD_SPORTS.includes(target.sport)) {
    return json(200, { ok: true, supported: false, query: target.query, sport: target.sport, clips: [], ranking: 'none', note: NOT_COVERED, cost: { usd: 0, cached: false } });
  }
  const key = `find|${target.sport}|${target.query.toLowerCase()}`;
  const now = (deps.now || Date.now)();
  const hit = cacheGet(key, now);
  if (hit) return json(200, { ...hit.data, cost: { usd: 0, cached: true, cachedAt: new Date(hit.at).toISOString() } });

  const plan = P.searchPlan({ sport: target.sport, query: target.query });
  const named = P.teamInTitle(target.query, target.sport);
  // 1. The shared clip library: instant and free.
  const lib = await P.libraryClips({ sport: target.sport, teams: named ? [named] : [], terms: named ? [] : plan.terms, token: track.token })
    .catch(() => ({ fresh: [], older: [] }));
  let pool = [...lib.fresh];
  const diag = { library: lib.fresh.length, live: 0, sources: 0, older: 0 };
  // 2. Thin: a FREE top-up only (X API when configured, the free sources).
  if (pool.length < RADAR.enough) {
    const known = new Set(pool.map(c => c.url));
    const [round, extra] = await withTimeout(Promise.all([
      P.searchRound(plan, { sport: target.sport, track, feature: 'reels-radar-find', freeOnly: true, maxUses: 0, maxCostUsd: 0, timeoutMs: RADAR.topUpMs }).catch(() => ({ clips: [] })),
      P.runSources({ sport: target.sport, team: named ? P.teamOut(named) : null, teams: [], query: target.query }, { track, freeOnly: true, paid: false, known, timeoutMs: RADAR.topUpMs - 5000 }).catch(() => ({ clips: [] })),
    ]), RADAR.topUpMs, [{ clips: [] }, { clips: [] }]);
    diag.live = round.clips.length;
    diag.sources = extra.clips.length;
    pool = [...pool, ...round.clips, ...extra.clips];
  }
  const fresh = rankForRadar(pool, { now, deps });
  let ranked = fresh.ranked.map(s => ({ ...s, older: false }));
  // 3. Still thin: the library's older clips of the same story, labelled.
  if (ranked.length < 3 && lib.older.length) {
    const have = new Set(ranked.map(s => s.c.url));
    const old = rankForRadar(lib.older.filter(c => !have.has(c.url)), { now, deps }).ranked.map(s => ({ ...s, older: true }));
    diag.older = old.length;
    ranked = [...ranked, ...old].slice(0, RADAR.maxClips);
  }
  const clips = ranked.map((s, i) => ({ id: `c${i + 1}`, ...publicClip(s.c, { now, velocity: s.velocity, older: s.older }) })).filter(c => c.url);
  const known = clips.filter(c => c.viewsKnown).length;
  const note = !clips.length ? `No official clips for this story in the last ${Math.round((plan.windowHours || 120) / 24)} days.`
    : fresh.ranking === 'newest' ? 'No view counts for these clips yet, so the newest are first.'
      : known < clips.length ? 'Some clips have no view count; they are ranked by likes.' : '';
  const data = {
    ok: true, supported: true, query: target.query, sport: target.sport, team: named ? named.name : '',
    clips, ranking: clips.length ? fresh.ranking : 'none', note,
    windowDays: Math.round((plan.windowHours || 120) / 24), fetchedAt: new Date(now).toISOString(),
    diag: { ...diag, kept: clips.length, untrusted: fresh.untrusted },
    cost: { usd: 0, cached: false },
  };
  if (clips.length) cacheSet(key, data, now);
  return json(200, data);
}

// ─── Analyze ────────────────────────────────────────────────────────────────
// Clips the browser sends back: only what the read uses, capped.
function cleanClips(list) {
  return (Array.isArray(list) ? list : []).slice(0, RADAR.maxClips).map((c, i) => ({
    id: /^c\d{1,2}$/.test(String(c?.id)) ? String(c.id) : `c${i + 1}`,
    handle: clip(c?.handle, 40),
    caption: clip(c?.caption, RADAR.caption),
    views: Math.round(num(c?.views)), likes: Math.round(num(c?.likes)),
    ageHours: c?.ageHours === null || c?.ageHours === undefined || !Number.isFinite(Number(c.ageHours)) ? null : Math.max(0, Math.round(Number(c.ageHours))),
    duration: Math.round(num(c?.duration)),
    velocity: Math.round(num(c?.velocity)),
    source: ['official', 'league', 'media'].includes(c?.source) ? c.source : 'media',
  })).filter(c => c.caption || c.views || c.duration);
}

// Numbers the read may repeat: those in the captions and the fetched stats
// (exact, and the short "12k" / "1.3M" forms the page shows).
const NUMBER_RE = /\d[\d,.]*\s?(?:[kKmM]\b)?%?/g;
const normNum = s => String(s).toLowerCase().replace(/[,\s%]/g, '').replace(/\.$/, '').replace(/\.0+(?=[km]?$)/, '');
function compact(n) {
  const v = num(n);
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '')}m`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace(/\.0$/, '')}k`;
  return String(Math.round(v));
}
function allowedNumbers(clips) {
  const set = new Set([String(clips.length)]);
  clips.forEach(c => {
    String(c.caption).replace(NUMBER_RE, m => { set.add(normNum(m)); return m; });
    [c.views, c.likes, c.duration, c.velocity, c.ageHours].forEach(v => { if (v !== null && v !== undefined && num(v)) { set.add(normNum(String(Math.round(v)))); set.add(compact(v)); } });
    if (c.ageHours !== null && c.ageHours >= 24) set.add(String(Math.round(c.ageHours / 24)));
    set.add(String(c.id).slice(1));
  });
  return set;
}
function inventedNumbers(text, allowed) {
  return (String(text || '').match(NUMBER_RE) || []).map(normNum).filter(n => n && !allowed.has(n));
}

const ANALYZE_SYSTEM = [
  'You are a short-video strategist for EssentiallySports (ES), a sports publisher. You are shown the official clips that are doing well on X for one story: each clip\'s caption, length, age, views, likes and views per hour.',
  'You cannot watch the videos. Judge only what you are given (captions, lengths, timing, who posted, how fast the views came) and say "likely" for anything you infer about the footage.',
  'Tell an ES reel producer what is working, then pitch 3 "our version" reels in the ES voice.',
  'ES voice and angle: fan-first, "the moments behind the moment"; quote-led; a legend or insider\'s verdict on a named star; the money figure up front; fan reaction; end on a question for fans. Punchy, plain American sports English. No emojis, hashtags, links, "Breaking" or hype words (shocking, insane, unbelievable).',
  'Rules:',
  '1. Refer to clips only by their id (c1, c2…). Do not write any number unless it is in the list you were given, exactly as shown.',
  '2. The clips are a style reference, not a fact source: the briefs describe HOW to tell the story (the opening, the order, the length, the caption style), never new facts about it. Briefs carry no numbers and no quotes, and do not copy a caption.',
  '3. Each brief uses a different lens.',
  'Return JSON only:',
  '{"read":"one sentence: what is working on this story right now","patterns":[{"label":"Hook|Length|Caption|Timing|Who posts|Format","detail":"the pattern, in one or two plain sentences","clips":["c1"]}],"briefs":[{"lens":"fan-first|quote-led|verdict|money|fan-reaction|behind-the-moment","title":"a short name for the reel","hook":"the opening line, at most 10 words","brief":"two sentences: what our version shows and how it is told"}]}',
  '3-5 patterns, exactly 3 briefs.',
].join('\n');

function analyzePrompt(clips, topic, sport) {
  const line = c => JSON.stringify({ id: c.id, by: `@${c.handle}`, source: c.source, seconds: c.duration || undefined, hoursOld: c.ageHours ?? undefined, views: c.views || undefined, likes: c.likes || undefined, viewsPerHour: c.velocity || undefined, caption: c.caption });
  return [
    `Story: ${clip(topic, RADAR.query) || 'a trending sports story'}${SPORT_LABEL[sport] ? ` (${SPORT_LABEL[sport]})` : ''}.`,
    `Clips, best first (${clips.length}):`,
    clips.map(line).join('\n'),
  ].join('\n');
}
function parseJson(raw) {
  const s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(s); } catch { /* fall through */ }
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; } }
  return null;
}
const banned = text => RULES.BANNED.some(rule => rule.re.test(text));

// The model's JSON -> the reply: known clip ids, no invented numbers, briefs
// with no numbers or quotes.
function shapeAnalysis(data, clips) {
  const allowed = allowedNumbers(clips);
  const ids = new Set(clips.map(c => c.id));
  let dropped = 0;
  const patterns = (Array.isArray(data?.patterns) ? data.patterns : []).filter(p => p && typeof p === 'object').map(p => ({
    label: clip(p.label, 40), detail: clip(p.detail, 320),
    clips: (Array.isArray(p.clips) ? p.clips : []).map(String).filter(id => ids.has(id)).slice(0, 4),
  })).filter(p => {
    if (!p.label || !p.detail) return false;
    const bad = inventedNumbers(`${p.label} ${p.detail}`, allowed).length > 0 || banned(p.detail);
    if (bad) dropped += 1;
    return !bad;
  }).slice(0, 5);
  const seen = new Set();
  const briefs = (Array.isArray(data?.briefs) ? data.briefs : []).filter(b => b && typeof b === 'object').map(b => ({
    lens: LENSES.includes(b.lens) ? b.lens : '', title: clip(b.title, 60), hook: clip(b.hook, 90), brief: clip(b.brief, 360),
  })).filter(b => {
    if (!b.lens || !b.title || !b.brief || seen.has(b.lens)) return false;
    const all = `${b.title} ${b.hook} ${b.brief}`;
    const bad = /\d/.test(all) || /["“”]/.test(all) || banned(all);
    if (bad) { dropped += 1; return false; }
    seen.add(b.lens);
    return true;
  }).slice(0, 3);
  const read = inventedNumbers(data?.read, allowed).length || banned(String(data?.read || '')) ? '' : clip(data?.read, 240);
  return { read, patterns, briefs, dropped };
}

// No AI (free mode / AI off): counted patterns and template briefs.
const median = list => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
function freeAnalysis(clips, topic) {
  const patterns = [];
  const top = clips[0];
  const timed = clips.filter(c => c.duration > 0);
  if (timed.length) patterns.push({ label: 'Length', detail: `The typical clip here runs ${median(timed.map(c => c.duration))} seconds.`, clips: timed.slice(0, 3).map(c => c.id) });
  const official = clips.filter(c => c.source === 'official').length;
  if (clips.length) patterns.push({ label: 'Who posts', detail: official ? `${official} of these ${clips.length} clips come from a team's own account.` : `All ${clips.length} clips come from league or network accounts.`, clips: [] });
  if (top && top.caption) {
    const words = top.caption.split(/\s+/).filter(Boolean).length;
    patterns.push({ label: 'Caption', detail: `The top clip's caption is ${words} words long.`, clips: [top.id] });
  }
  if (top && top.ageHours !== null && top.velocity) patterns.push({ label: 'Timing', detail: `The top clip was posted ${top.ageHours} hours ago and is still the fastest.`, clips: [top.id] });
  const story = clip(topic, 80).replace(/["“”]/g, '');
  const plain = story && !/\d/.test(story) ? story : 'this story';
  const briefs = [
    { lens: 'fan-first', title: 'What it means for fans', hook: '', brief: `Open on the moment itself, then say what ${plain} means for the fans watching. One idea per beat, and end on a question for them.` },
    { lens: 'behind-the-moment', title: 'The moment behind the moment', hook: '', brief: 'Skip the recap everyone has posted. Show the detail around the play that the highlight clips leave out, then explain why it matters.' },
    { lens: 'fan-reaction', title: 'How fans are taking it', hook: '', brief: 'Lead with how fans are reacting, only as far as the sources show it. Then give the story in three short beats and ask fans to pick a side.' },
  ];
  return { read: '', patterns, briefs, dropped: 0 };
}

const ANALYZE_TIER = 'main'; // Haiku: the cheapest model that writes usable briefs and reliable JSON
async function analyzeMode(body, track, deps = {}) {
  const clips = cleanClips(body.clips);
  if (!clips.length) return json(400, { ok: false, reason: 'input', error: 'There are no clips to read yet. Find clips first.' });
  const topic = clip(body.topic, RADAR.query);
  const sport = String(body.sport || '').toLowerCase();
  const key = `an|${topic.toLowerCase()}|${clips.map(c => `${c.handle}:${c.views}:${c.duration}:${c.caption.slice(0, 24)}`).join(',')}`;
  const hit = cacheGet(key);
  if (hit) return json(200, { ...hit.data, cost: { usd: 0, cached: true } });
  const free = reason => json(200, { ok: true, ai: false, reason, analysis: freeAnalysis(clips, topic), cost: { usd: 0, cached: false } });
  if (featureDisabled(FEATURES.analyze)) return free('feature-off');
  const gate = process.env.AI_GATEWAY_API_KEY && !inFreeMode() ? await aiSpendGate(track.token, { feature: FEATURES.analyze }) : null;
  if (inFreeMode() || freeModeGate(gate)) return free('free');
  if (gate) return json(gate.status, { ok: false, reason: gate.reason, error: gate.error });
  if (!gatewayConfigured()) return free('off');
  if (await userOverHourlyLimit(track.token)) return json(429, { ok: false, reason: 'limit', error: "You've used a lot of AI this hour. Take a short break and try again soon." });
  let result;
  try {
    result = await (deps.aiText || aiText)({ tier: ANALYZE_TIER, system: ANALYZE_SYSTEM, cacheSystem: true, messages: [{ role: 'user', content: analyzePrompt(clips, topic, sport) }], json: true, maxTokens: 1600, timeoutMs: 40000, track: { ...track, feature: FEATURES.analyze } });
  } catch (error) {
    if (inFreeMode()) return free('free');
    if (isBudgetError(error)) return free('budget');
    console.error('reel-radar analyze failed:', error.message);
    return json(502, { ok: false, reason: 'ai', error: "The AI couldn't read these clips right now. The clips and counts still work; try again in a moment." });
  }
  const parsed = parseJson(result.text);
  if (!parsed) return json(502, { ok: false, reason: 'ai', error: "The AI's answer came back garbled. Try again in a moment." });
  const analysis = shapeAnalysis(parsed, clips);
  // Fewer than three usable briefs: the template ones fill the gap (labelled by `free`).
  if (analysis.briefs.length < 3) {
    const have = new Set(analysis.briefs.map(b => b.lens));
    freeAnalysis(clips, topic).briefs.filter(b => !have.has(b.lens)).slice(0, 3 - analysis.briefs.length).forEach(b => analysis.briefs.push({ ...b, free: true }));
  }
  const data = { ok: true, ai: true, analysis, model: result.model, cost: { usd: Number((result.cost || 0).toFixed(6)), cached: false } };
  cacheSet(key, data);
  return json(200, data);
}

function statusMode(deps = {}) {
  let sports = ['nfl', 'cfb', 'mlb'];
  let xApi = false;
  let library = false;
  try { const P = deps.pipeline || pipeline(); sports = P.AD_SPORTS; xApi = P.xApiOn(); library = P.CLIP_LIBRARY.enabled(); } catch { /* the page still explains itself */ }
  return json(200, { ok: true, sports, xApi, library, ai: gatewayConfigured() && !featureDisabled(FEATURES.analyze), prices: PRICES, cacheMinutes: CACHE_TTL_MS / 60000, maxClips: RADAR.maxClips, notice: NOT_COVERED });
}

// ─── Handler ────────────────────────────────────────────────────────────────
exports.handler = withAiMode(async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });
  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error });
  if (String(event.body || '').length > RADAR.body) return json(413, { ok: false, error: 'That request is too large.' });
  let body = {};
  try { body = JSON.parse(event.body || '{}') || {}; } catch { return json(400, { ok: false, error: 'Invalid request.' }); }
  const track = { email: auth.user.email, token: bearerToken(event.headers), runId: `rr-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}` };
  try {
    if (body.mode === 'status') return statusMode();
    if (body.mode === 'find') return await findMode(body, track);
    if (body.mode === 'analyze') return await analyzeMode(body, track);
    return json(400, { ok: false, error: 'Unknown request.' });
  } catch (error) {
    console.error('reel-radar failed:', error);
    return json(502, { ok: false, error: 'The radar is unavailable right now. Try again in a moment.' });
  }
});

exports._test = {
  RADAR, FEATURES, PRICES, LENSES, CACHE, CACHE_TTL_MS, NOT_COVERED, ANALYZE_SYSTEM, ANALYZE_TIER,
  readTarget, publicClip, rankForRadar, findMode, cleanClips, allowedNumbers, inventedNumbers, analyzePrompt, parseJson,
  shapeAnalysis, freeAnalysis, analyzeMode, statusMode, compact,
  resetCache() { CACHE.clear(); },
};
