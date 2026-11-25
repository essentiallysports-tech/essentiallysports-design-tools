'use strict';
// Reels Studio: trend or brief -> a 20-45 s 9:16 reel with no game footage
// (project-docs/ai-reels-research.md, MVP). One endpoint, POST { mode, ... }:
//
//   config    what is switched on: AI, the house voice (or captions only),
//             the fact check; no AI, no cost
//   trends    last-48h NFL / CFB / MLB / Golf trends (shared with Trend Design)
//   plan      fact check (optional, capped: 2 searches, $0.03) -> reel director
//             (_reel-director.js: Haiku, Sonnet only when the plan is weak) ->
//             validated beats + lint. With AI off or over a cap it returns a
//             grounded draft built from the brief (free), never an error.
//             45-minute cache per (topic, format, tier, steer).
//   revise    "shorter / punchier / stronger hook / calmer" or free text
//   ideas     the ideas room (_reel-ideas.js): ES articles, the trend, game and
//             player data (+ the optional fact check) -> one Haiku call (Sonnet
//             on request) -> 4-5 grounded ES angles, each with a ready plan.
//             Free template drafts when AI is off or over a cap. 30-min cache.
//   music     optional generated instrumental bed (REELS_MUSIC=gateway), organic-only rights
//   voice-sample  a ~2 s preview of one of the four voices (cached)
//   voice-align  a person's own voiceover (one take, 16 kHz mono WAV, 90 s at
//             most): transcribed (free provider first) and aligned to the
//             beats' words -> per-beat { startMs, endMs, words }. The script
//             is never rewritten. No beats: the transcript comes back so the
//             page can build a locked-words reel from the take.
//   scene     one AI scene still for the fill chain (no people, names or logos)
//   clip-judge  a vision model rates up to 3 candidate clips from frames the
//             browser sampled (_reel-clip-judge.js, Gemini 3.8 Flash, Haiku
//             fallback); capped at $0.10 per reel, cached per clip URL,
//             logged as reels-clip-judge; respects aiSpendGate
//   ai-clip-start / ai-clip-status
//             one AI b-roll clip as an async Gateway job (REELS_AI_CLIPS=gateway,
//             capped by REELS_AI_CLIPS_MAX, default 2 per reel); the page polls
//
// GET ?diag=voice (dashboard admins only, is_es_designer_admin(), fails
// closed): one tiny real synthesis ("Test.", well under a cent) to verify the
// live Gateway speech route after a deploy. Returns ok, model, format and the
// byte length, or the error text and the reply's keys. Never audio or keys.
//   voice     one beat's voiceover (<= 400 chars) as base64 audio + word
//             timings (_reel-voice.js); one beat per request keeps every
//             response far under Vercel's 4.5 MB body limit
//   projects / project-save / project-load / event
//             cloud copies of reel projects and an append-only event log
//             (frameup_reel_projects, frameup_reel_events), with the user's
//             own session (RLS). Before the migration runs they answer
//             { cloud: false } and the page keeps its local autosave.
//
// Data formats (Game Swing, Moment Replay, Archive; Phase 0 contract in
// project-docs/reels-formats-contract.md §2). One dispatch table,
// FORMAT_MODES, registers:
//   games             { sport, when, date? }          -> { games: [GameSummary] }      data (free)
//   game-data         { sport, eventId }              -> { digest: GameDigest }        data (free)
//   athlete           { sport, query } | { sport, athleteId } -> { candidates } | { athlete }  data (free)
//   archive-research  { sport, athleteId, angle }     -> { articles, photos, candidates, coverage }  mcp
//   frame-pick        { clipUrl, segment, frames, times } -> { setup, play, reaction, captions }  ai
// Handlers: _reel-games.js (ESPN, no AI; soft-fails with reason
// 'data-unavailable'), _reel-archive.js (ES MCP, $0 AI), _reel-frame-pick.js
// (one capped vision call, code fallback). A mode whose run is null answers
// 501 { reason: 'coming-soon' } before any gate or network call.
// plan with a data format + its digest / archive / replay: see dataPlan.
//
// Every request needs a signed-in ES user. AI modes count toward the hourly
// and weekly caps and are logged in frameup_ai_usage (features reels-*).
const crypto = require('node:crypto');
const { verifyEsUser, bearerToken, authConfig } = require('./_supabase-auth.js');
const media = require('./_reel-media.js');
const STYLES = require('../../reel-styles.js');
const { getTrends } = require('./trend-design.js');
const { gatewayConfigured, isBudgetError, userOverHourlyLimit, userOverWeeklyLimit, weeklyLimitMessage, aiSpendGate, freeModeGate, withAiMode } = require('./_ai-gateway.js');
const clipJudge = require('./_reel-clip-judge.js');
const CLIPS = require('../../reel-clips.js');
const director = require('./_reel-director.js');
const voice = require('./_reel-voice.js');
const { lintPlan } = require('./_reel-lint.js');
const F = require('../../reel-formats.js');
const games = require('./_reel-games.js');
const archive = require('./_reel-archive.js');
const framePick = require('./_reel-frame-pick.js');
// ── Reels 2.0: lane B ── the ideas room and ES coverage for news reels.
const ideas = require('./_reel-ideas.js');
const { cachedEnrichment } = require('./trend-design.js');

const REEL_SPORTS = ['nfl', 'cfb', 'mlb', 'golf'];
const TREND_HOURS = 48;
const PLAN_TTL_MS = 45 * 60 * 1000;
const PLAN_CACHE = new Map();
const MAX_BODY = 220 * 1024; // a project's timeline is capped at 200 KB; a clip-judge batch (3 clips x 3 small JPEGs) is ~120 KB
const PROJECTS = 'frameup_reel_projects';
const EVENTS = 'frameup_reel_events';
// ── Reels 2.0: C (inputs) ── a voice-align body carries one take (<= 90 s of 16 kHz mono WAV as base64, ~3.9 MB).
const MAX_VOICE_BODY = 4.3 * 1024 * 1024;
const EVENT_TYPES = ['plan', 'revise', 'voice', 'edit', 'export', 'lint_blocked', 'make', 'visuals', 'data', 'frames', 'carousel_export',
  // ── Reels 2.0: C (inputs) ── start source, idea lens, recipe, look, version, media added, voice mode, captions export, radar
  'start', 'idea_pick', 'recipe', 'look', 'variant', 'media_add', 'voice_upload', 'captions_export', 'radar_open', 'radar_handoff'];

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
const money = usd => Number((Number(usd) || 0).toFixed(6));
const clean = (value, max = 400) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);

// ─── Trends ────────────────────────────────────────────────────────────────
// ── Reels 2.0: lane B ── wider sports + the ES angle.
// The 2-day board covers NFL, CFB and MLB (and whatever is in Google's
// trending searches). Golf and tennis have their own news feeds only on the
// 1-day board, so it is merged in (soft-fail). NBA, WNBA and NASCAR have no
// feed of their own: the classifier files them under "others", and they are
// picked out here by league words, so those lists are thin (general sports
// headlines and trending searches only).
const TREND_SPORTS = [...REEL_SPORTS, 'tennis', 'nba', 'wnba', 'nascar'];
const TRENDS_PER_SPORT = 12;
const OTHER_LEAGUES = [
  ['wnba', /\bwnba\b|caitlin clark|a'ja wilson|angel reese/i],
  ['nba', /\bnba\b|\b(?:lakers|celtics|warriors|knicks|bucks|nuggets|mavericks|cavaliers|timberwolves)\b|lebron|steph(?:en)? curry|giannis|luka doncic|wembanyama/i],
  ['nascar', /\bnascar\b|cup series|daytona 500/i],
];
function trendSport(item) {
  if (item.category !== 'others') return item.category;
  const text = [item.title, ...(item.related || []).map(r => r.title)].join(' ');
  const hit = OTHER_LEAGUES.find(([, re]) => re.test(text));
  return hit ? hit[0] : 'others';
}
async function trends() {
  const [data, day] = await Promise.all([
    getTrends(false, { window: '2d' }),
    getTrends(false).catch(() => null), // golf, tennis and general sports headlines
  ]);
  const since = Date.now() - TREND_HOURS * 3600e3;
  const seen = new Set();
  const perSport = {};
  const items = [...(data.items || []), ...((day && day.items) || [])]
    .filter(item => item && !seen.has(item.id) && seen.add(item.id))
    .map(item => ({ item, sport: trendSport(item) }))
    .filter(({ sport }) => TREND_SPORTS.includes(sport))
    .filter(({ item }) => !item.publishedAt || new Date(item.publishedAt).getTime() >= since)
    .sort((a, b) => (b.item.rank || 0) - (a.item.rank || 0))
    // At most 12 a sport, so a busy league never crowds a quiet one off the list.
    .filter(({ sport }) => { perSport[sport] = (perSport[sport] || 0) + 1; return perSport[sport] <= TRENDS_PER_SPORT; })
    .map(({ item, sport }) => {
      const ai = cachedEnrichment(item.id);
      return {
        id: item.id, sport, title: item.title, source: item.source || '', url: item.url || '',
        publishedAt: item.publishedAt || '', team: item.team?.name || '',
        format: F.routeFormat([item.title, ...(item.related || []).map(r => r.title)].join(' ')).format,
        related: (item.related || []).slice(0, 4).map(r => ({ title: r.title, url: r.url, source: r.source })),
        // ES fit (0-100, trend-design.js esFit) and, when the trend has been enriched, its ES angle.
        fit: item.fit ? Number(item.fit.score) || 0 : null,
        ...(ai && ai.why ? { why: ai.why } : {}),
        ...(ai && ai.angle ? { angle: ai.angle } : {}),
      };
    });
  const counts = Object.fromEntries(TREND_SPORTS.map(id => [id, items.filter(i => i.sport === id).length]));
  return { ok: true, updatedAt: data.updatedAt, hours: TREND_HOURS, items, sports: TREND_SPORTS, counts, stale: Boolean(data.stale) };
}

// ─── Plan ──────────────────────────────────────────────────────────────────
function readTrend(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = clean(raw.title, 300);
  if (!title) return null;
  return {
    id: clean(raw.id, 80), title, sport: REEL_SPORTS.includes(raw.sport) ? raw.sport : '', team: clean(raw.team, 80), why: clean(raw.why, 300), url: clean(raw.url, 400),
    related: (Array.isArray(raw.related) ? raw.related : []).slice(0, 4).map(r => ({ title: clean(r && r.title, 300), url: clean(r && r.url, 400), source: clean(r && r.source, 80) })).filter(r => r.title),
  };
}
const planKey = parts => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
function sourcesOf(trend, brief, facts) {
  const list = [];
  if (brief) list.push({ type: 'brief', title: 'Your brief' });
  if (trend) {
    list.push({ type: 'trend', title: trend.title, url: trend.url });
    trend.related.forEach(r => list.push({ type: 'news', title: r.title, url: r.url, source: r.source }));
  }
  (facts?.urls || []).forEach(u => list.push({ type: 'fact-check', title: u.title || u.url, url: u.url }));
  return list.slice(0, 16);
}

// Data formats (Game Swing, Moment Replay, Archive): the plan comes from the
// digest / archive / replay the page sends (re-validated on the server), so
// every beat carries refs into timeline.data. Code plans it; one optional
// Haiku pass rewrites the words (numbers only from the facts). Over a cap or
// with AI off, the code plan ships as it is (free).
async function dataPlan(input, body, track, gates) {
  // Reels 2.0: retired styles are written as ES; the person's look rides along.
  const style = STYLES.currentStyle(STYLES.STYLES[body.style] ? body.style : F.FORMATS[input.format].defaultStyle);
  const look = clean(body.look, 20);
  const blocked = gates.free ? 'free' : gates.off ? 'off' : (gates.weekly ? 'weekly-limit' : (gates.hourly ? 'limit' : '')); // ai-free-mode: 'free' = code plan
  const tier = body.tier === 'economy' ? 'economy' : 'standard';
  const out = await director.runDataDirector(input, { style, look, tier: body.aiCopy === false ? 'off' : tier, steer: clean(body.steer, 300), voice: body.voice === true, blocked, track });
  if (!out.plan) return { ok: false, status: 422, reason: 'no-data', error: 'There is not enough data for this reel; use the brief.' };
  const MAXP = require('../../reel-data.js').MAX_KEY_PLAYS;
  const dropped = input.playIds && input.playIds.length > MAXP ? [`Kept the ${MAXP} strongest of your ${input.playIds.length} ticked plays.`] : [];
  return {
    ok: true, plan: out.plan, source: out.source, reason: out.reason || '',
    notice: blocked === 'weekly-limit' ? `${weeklyLimitMessage()} Here is the reel built from the data.` : blocked === 'limit' ? "You've used a lot of AI this hour. Here is the reel built from the data." : '',
    escalated: false, model: out.model || '', issues: [...dropped, ...(out.issues || [])].slice(0, 8), corpus: out.corpus.slice(0, 12000),
    sources: [], route: null, style, suggestedStyle: STYLES.suggestStyle({ format: input.format }),
    lint: lintPlan(out.plan, { corpus: out.corpus }),
    costs: { director: money(out.cost), factCheck: 0 }, cost: money(out.cost), factCheck: null, cached: Boolean(out.cached),
  };
}

async function plan(body, track, gates) {
  if (F.isDataFormat(body.format)) {
    const input = director.readDataInput(body, { cachedDigest: games.cachedDigest });
    // Game Swing honours the editor's ticked key plays: at least one must be a play of this game.
    if (input.format === 'gameswing' && input.digest && input.playIdsSent && !input.playIds.length) {
      return { ok: false, status: 422, reason: 'no-plays', error: 'Tick at least one key play from this game.' };
    }
    if (director.hasDataInput(input)) return dataPlan(input, body, track, gates);
  }
  const brief = clean(body.brief, 2400);
  const trend = readTrend(body.trend);
  if (!brief && !trend) return { ok: false, status: 400, error: 'Pick a trend or write a brief.' };
  const format = F.FORMATS[body.format] ? body.format : 'auto';
  const tier = body.tier === 'economy' ? 'economy' : 'standard';
  const sport = REEL_SPORTS.includes(body.sport) ? body.sport : '';
  const steer = clean(body.steer, 300);
  // Style: the editor's pick, or 'auto' = the code suggestion (free).
  const suggested = STYLES.suggestStyle({ format, text: [trend?.title, ...(trend?.related || []).map(r => r.title), brief].filter(Boolean).join(' ') });
  const style = STYLES.currentStyle(STYLES.STYLES[body.style] ? body.style : suggested.id);
  const look = clean(body.look, 20);
  const key = planKey([trend?.id || trend?.title || '', brief, format, tier, steer, sport, Boolean(body.factCheck), style]);
  const hit = PLAN_CACHE.get(key);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return { ...hit.value, cached: true, cost: 0, costs: { director: 0, factCheck: 0 } };

  // Over a cap or AI off: a free, grounded draft (the page says why).
  const blocked = gates.free ? 'free' : gates.off ? 'off' : (gates.weekly ? 'weekly-limit' : (gates.hourly ? 'limit' : '')); // ai-free-mode: 'free' = code plan
  let facts = null;
  let factCost = 0;
  // ── Reels 2.0: lane B ── ES's own coverage joins the sources of a news reel
  // (free: ES's public tag search; ~6 s budget, soft-fail). It runs beside the
  // fact check, so it adds no time when that is on.
  const esWork = blocked ? null : ideas.esSources([trend?.title, brief].filter(Boolean).join('. '), { budgetMs: 6000 }).catch(() => null);
  if (!blocked && body.factCheck) {
    try {
      facts = await director.factCheck({ topic: [trend?.title, brief].filter(Boolean).join('. '), sport, track });
      factCost = facts.cost;
    } catch (error) {
      if (isBudgetError(error)) facts = null;
    }
  }
  // The director reads 4,000 characters of extra facts: the fact check keeps
  // its place, ES coverage takes the room that is left.
  const es = (esWork && await esWork) || { text: '', sources: [] };
  const esRoom = 4000 - (facts?.text ? facts.text.length + 1 : 0);
  const esText = es.text && esRoom >= 400 ? es.text.slice(0, esRoom) : '';
  const extraFacts = [facts?.text || '', esText].filter(Boolean).join('\n');
  let result;
  if (blocked) {
    // Never spend over a cap (or with AI off): a draft from the brief, no model call.
    const read = director.readReelBrief({ brief, trend, sport, format });
    const draft = F.fallbackPlan({ brief: read.text, title: trend ? trend.title : '', format: read.format, sport: read.sport });
    draft.team = read.team;
    draft.style = style;
    if (look) draft.look = look;
    result = { plan: draft, read, source: 'draft', cost: 0, model: '', issues: [] };
  } else {
    result = await director.runReelDirector({ brief, trend, format, sport, tier, steer, style, look, track, facts: extraFacts });
  }
  const corpus = result.read.corpus;
  const value = {
    ok: true,
    plan: result.plan,
    source: result.source,
    reason: blocked || result.reason || '',
    notice: blocked === 'weekly-limit' ? `${weeklyLimitMessage()} Here is a free draft from your brief.` : blocked === 'limit' ? "You've used a lot of AI this hour. Here is a free draft from your brief." : blocked === 'off' ? 'AI is off, so this is a draft built from your brief.' : '',
    escalated: Boolean(result.escalated),
    model: result.model || '',
    issues: (result.issues || []).slice(0, 8),
    corpus: corpus.slice(0, 12000),
    sources: [...sourcesOf(trend, brief, facts), ...(esText ? es.sources : [])].slice(0, 16),
    route: result.read.route,
    style, suggestedStyle: suggested,
    lint: lintPlan(result.plan, { corpus }),
    costs: { director: money(result.cost), factCheck: money(factCost) },
    cost: money(result.cost + factCost),
    factCheck: facts ? { capped: Boolean(facts.capped), urls: facts.urls.length } : null,
  };
  if (!blocked && result.source !== 'draft') PLAN_CACHE.set(key, { at: Date.now(), value });
  if (PLAN_CACHE.size > 200) PLAN_CACHE.delete(PLAN_CACHE.keys().next().value);
  return value;
}

async function revise(body, track) {
  const current = body.plan && typeof body.plan === 'object' ? body.plan : null;
  if (!current || !Array.isArray(current.beats) || !current.beats.length) return { ok: false, status: 400, error: 'There is no reel to revise yet.' };
  const out = await director.revisePlan({ plan: current, instruction: clean(body.instruction, 300), corpus: clean(body.corpus, 12000), track });
  if (!out.plan.beats.length || out.weak && out.plan.beats.length < 3) return { ok: false, status: 422, error: 'That change did not come back clean. Try a different wording.', issues: out.issues };
  out.plan.team = current.team || out.plan.team;
  return { ok: true, plan: out.plan, issues: out.issues.slice(0, 8), model: out.model, cost: money(out.cost), lint: lintPlan(out.plan, { corpus: clean(body.corpus, 12000) }) };
}

async function speak(body, track) {
  const out = await voice.synthesize({ text: clean(body.text, voice.MAX_CHARS + 1), voiceOption: clean(body.voice, 12), hook: body.hook === true, track });
  if (!out.ok) return { ok: false, status: out.reason === 'off' ? 503 : (out.reason === 'budget' ? 503 : (out.reason === 'error' ? 502 : 400)), reason: out.reason, error: out.error };
  return { ok: true, beat: clean(body.beat, 24), audio: out.audio, mime: out.mime, durationMs: out.durationMs, words: out.words, alignedBy: out.alignedBy || '', cost: out.cost, costs: out.costs, cached: out.cached, mode: out.mode, model: out.model, voice: out.voice || '' };
}
async function voiceSample(body, track) {
  const out = await voice.sample({ voiceOption: clean(body.voice, 12), track });
  if (!out.ok) return { ok: false, status: out.reason === 'off' || out.reason === 'budget' ? 503 : (out.reason === 'voice' ? 400 : 502), reason: out.reason, error: out.error };
  return { ok: true, voice: clean(body.voice, 12), audio: out.audio, mime: out.mime, cost: out.cost, cached: out.cached, model: out.model };
}
// ── Reels 2.0: C (inputs) ── a person's own voiceover -> per-beat windows.
async function voiceAlign(body, track) {
  const audio = typeof body.audio === 'string' ? body.audio : '';
  if (!audio) return { ok: false, status: 400, reason: 'bad-audio', error: 'No recording was sent.' };
  const check = voice.checkTake(Buffer.from(audio, 'base64'));
  if (!check.ok) return { ok: false, status: check.reason === 'too-long' ? 413 : 400, reason: check.reason, error: check.error };
  const beats = (Array.isArray(body.beats) ? body.beats : []).slice(0, voice.TAKE.maxBeats).map(b => ({ id: clean(b && b.id, 24), vo: clean(b && b.vo, 320) })).filter(b => b.id && b.vo);
  const heard = await voice.transcribeTake({ audio, track: { ...track, feature: 'reels-voice-align' } });
  if (!heard.ok) return { ok: false, status: heard.reason === 'off' || heard.reason === 'budget' ? 503 : (heard.reason === 'silent' ? 422 : 502), reason: heard.reason, error: heard.error };
  const aligned = voice.alignBeats(beats, heard.words, check.durationMs);
  return { ok: true, durationMs: check.durationMs, beats: aligned.beats, match: aligned.match, transcript: heard.text, words: beats.length ? undefined : heard.words, provider: heard.provider, model: heard.model, cost: money(heard.cost), cached: Boolean(heard.cached) };
}
const COLORS = list => (Array.isArray(list) ? list : []).filter(c => /^#[0-9a-f]{6}$/i.test(String(c))).slice(0, 2);
async function sceneImage(body, track) {
  const out = await media.scene({ scene: clean(body.scene, 16), sport: clean(body.sport, 8), colors: COLORS(body.colors), track });
  if (!out.ok) return { ok: false, status: out.reason === 'off' || out.reason === 'budget' ? 503 : 502, reason: out.reason, error: out.error };
  return out;
}
async function aiClipStart(body, track) {
  const out = await media.clipStart({ scene: clean(body.scene, 16), sport: clean(body.sport, 8), colors: COLORS(body.colors), used: Number(body.used) || 0, track });
  if (!out.ok) return { ok: false, status: ['off', 'budget'].includes(out.reason) ? 503 : (out.reason === 'cap' ? 429 : 502), reason: out.reason, error: out.error };
  return out;
}
async function aiClipStatus(body) {
  const out = await media.clipStatus({ job: clean(body.job, 64), operation: body.operation && typeof body.operation === 'object' ? body.operation : (typeof body.operation === 'string' ? body.operation.slice(0, 2000) : null) });
  if (!out.ok) return { ok: false, status: out.reason === 'off' ? 503 : 200, reason: out.reason, error: out.error, state: out.status || 'error' };
  return out;
}

// Dashboard admin? The database decides (the function RLS uses); any failure
// means no.
async function isAdmin(token) {
  if (!token) return false;
  try {
    const config = authConfig();
    const response = await fetch(`${config.url}/rest/v1/rpc/is_es_designer_admin`, {
      method: 'POST', headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return false;
    return (await response.json()) === true;
  } catch { return false; }
}

async function music(body, track) {
  const out = await voice.makeMusic({ mood: clean(body.mood, 20), seconds: Number(body.seconds) || 30, track });
  if (!out.ok) return { ok: false, status: out.reason === 'off' || out.reason === 'budget' ? 503 : 502, reason: out.reason, error: out.error };
  return { ok: true, audio: out.audio, mime: out.mime, seconds: out.seconds, mood: out.mood, cost: out.cost, cached: out.cached, rights: out.rights };
}

// ─── Projects (user's own session; RLS) ──────────────────────────────────
function rest(token) {
  const config = authConfig();
  return {
    url: `${config.url}/rest/v1`,
    headers: extra => ({ apikey: config.publishableKey, Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', ...extra }),
  };
}
const missing = status => status === 404 || status === 400; // table not there yet (PGRST205 / 42P01)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function projects(body, auth, token) {
  const api = rest(token);
  try {
    const response = await fetch(`${api.url}/${PROJECTS}?select=id,title,format,sport,status,cost_usd,updated_at&order=updated_at.desc&limit=20`, { headers: api.headers(), signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { ok: true, cloud: !missing(response.status), items: [] };
    return { ok: true, cloud: true, items: await response.json() };
  } catch { return { ok: true, cloud: false, items: [] }; }
}
async function projectSave(body, auth, token) {
  const p = body.project && typeof body.project === 'object' ? body.project : null;
  if (!p || !UUID.test(String(p.id || ''))) return { ok: false, status: 400, error: 'Invalid project.' };
  const timeline = p.timeline && typeof p.timeline === 'object' ? p.timeline : {};
  if (JSON.stringify(timeline).length > 200 * 1024) return { ok: false, status: 413, error: 'This project is too large to save to the cloud. It is still saved in this browser.' };
  const row = {
    id: p.id, user_email: auth.user.email,
    title: clean(p.title, 140) || 'Untitled reel',
    format: F.FORMATS[p.format] ? p.format : 'explainer',
    sport: REEL_SPORTS.includes(p.sport) ? p.sport : null,
    status: ['draft', 'rendered', 'exported'].includes(p.status) ? p.status : 'draft',
    timeline, cost_usd: money(p.cost_usd), updated_at: new Date().toISOString(),
  };
  const api = rest(token);
  try {
    const response = await fetch(`${api.url}/${PROJECTS}?on_conflict=id`, { method: 'POST', headers: api.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(row), signal: AbortSignal.timeout(6000) });
    if (!response.ok) return { ok: true, cloud: false, saved: false };
    return { ok: true, cloud: true, saved: true };
  } catch { return { ok: true, cloud: false, saved: false }; }
}
async function projectLoad(body, auth, token) {
  const id = String(body.id || '');
  if (!UUID.test(id)) return { ok: false, status: 400, error: 'Invalid project.' };
  const api = rest(token);
  try {
    const response = await fetch(`${api.url}/${PROJECTS}?id=eq.${id}&select=*`, { headers: api.headers(), signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { ok: true, cloud: false, project: null };
    const rows = await response.json();
    return { ok: true, cloud: true, project: rows[0] || null };
  } catch { return { ok: true, cloud: false, project: null }; }
}
async function recordEvent(body, auth, token) {
  const type = String(body.type || '');
  if (!EVENT_TYPES.includes(type)) return { ok: false, status: 400, error: 'Unknown event.' };
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
  if (JSON.stringify(payload).length > 16000) return { ok: false, status: 413, error: 'Event too large.' };
  const api = rest(token);
  try {
    const response = await fetch(`${api.url}/${EVENTS}`, {
      method: 'POST', headers: api.headers({ Prefer: 'return=minimal' }), signal: AbortSignal.timeout(4000),
      body: JSON.stringify({ user_email: auth.user.email, project_id: UUID.test(String(body.projectId || '')) ? body.projectId : null, type, format: F.FORMATS[body.format] ? body.format : null, payload }),
    });
    return { ok: true, cloud: response.ok };
  } catch { return { ok: true, cloud: false }; }
}

// ─── Data-format modes (one dispatch table; contract §2) ────────────────
// gate:  'data' free, signed-in, rate-limited per user (Agent A adds the
//               30/min limiter in _reel-games.js);
//        'mcp'  ES MCP calls, no Gateway spend: counts toward the hourly limit;
//        'ai'   a Gateway call: aiSpendGate(feature) + hourly + weekly caps.
// run:   async (body, ctx) -> { ok, ...result } | { ok:false, status, reason, error }
//        ctx = { auth, token, track }. null = not built yet (501).
const FORMAT_MODES = {
  games: { gate: 'data', label: 'Game list', run: games.listGames },
  'game-data': { gate: 'data', label: 'Game data', run: games.gameData },
  athlete: { gate: 'data', label: 'Player search', run: games.athlete },
  'archive-research': { gate: 'mcp', label: 'Archive research', run: archive.archiveResearch },
  'frame-pick': { gate: 'ai', feature: 'reels-frame-pick', label: 'AI frame pick', run: framePick.framePick },
};
const comingSoon = (mode, entry) => ({ ok: false, status: 501, reason: 'coming-soon', mode, error: `${entry.label} is coming soon to Reels Studio.` });
async function formatMode(mode, body, ctx, gates = {}) {
  const entry = FORMAT_MODES[mode];
  if (!entry) return { ok: false, status: 400, error: 'Unknown request.' };
  if (typeof entry.run !== 'function') return comingSoon(mode, entry);
  const { token } = ctx;
  if (entry.gate === 'ai') {
    const gate = await (gates.aiSpendGate || aiSpendGate)(token, { feature: entry.feature });
    freeModeGate(gate); // ai-free-mode: skipped; the page keeps its code pick
    if (gate) return { ok: false, status: gate.status, reason: gate.reason, error: gate.error };
  }
  if (entry.gate === 'ai' || entry.gate === 'mcp') {
    const [weekly, hourly] = await Promise.all([(gates.weekly || userOverWeeklyLimit)(token), (gates.hourly || userOverHourlyLimit)(token)]);
    if (entry.gate === 'ai' && weekly) return { ok: false, status: 429, reason: 'weekly-limit', error: weeklyLimitMessage() };
    if (hourly) return { ok: false, status: 429, reason: 'limit', error: "You've used a lot of AI this hour. Take a short break and try again soon." };
  }
  try {
    return await entry.run(body, ctx);
  } catch (error) {
    if (isBudgetError(error)) return { ok: false, status: 503, reason: 'budget', error: "This week's AI budget is used up, so AI features are paused until it resets." };
    console.error(`reel-maker ${mode} failed:`, error);
    return { ok: false, status: 502, error: `${entry.label} is unavailable right now. Try again in a moment.` };
  }
}

const AI_MODES = { plan, revise, voice: speak, 'voice-align': voiceAlign, music, 'voice-sample': voiceSample, scene: sceneImage, 'ai-clip-start': aiClipStart };
// ai-clip-status only reads a job that was already billed and capped.
const DATA_MODES = { 'ai-clip-status': aiClipStatus, projects, 'project-save': projectSave, 'project-load': projectLoad, event: recordEvent };

// withAiMode (ai-free-mode): one free-mode store per request; replies carry mode: 'free'.
exports.handler = withAiMode(async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' };
  if (event.httpMethod === 'GET' && String(event.queryStringParameters?.diag || '') === 'voice') {
    const auth = await verifyEsUser(event);
    if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error });
    const token = bearerToken(event.headers);
    if (!(await isAdmin(token))) return json(403, { ok: false, error: 'Admins only.' });
    const out = await voice.diagnose({ track: { email: auth.user.email, token } });
    return json(200, { diag: 'voice', ...out });
  }
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });
  const bodySize = String(event.body || '').length;
  if (bodySize > MAX_VOICE_BODY) return json(413, { ok: false, reason: 'too-long', error: 'That request is too large.' });
  // Only a voice-align take may be larger than the usual cap (checked once the body is read).
  if (bodySize > MAX_BODY && !/"mode"\s*:\s*"voice-align"/.test(String(event.body).slice(0, 4000) + String(event.body).slice(-4000))) return json(413, { ok: false, error: 'That request is too large.' });
  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Invalid request.' }); }
  if (bodySize > MAX_BODY && body.mode !== 'voice-align') return json(413, { ok: false, error: 'That request is too large.' });
  const token = bearerToken(event.headers);
  const track = { email: auth.user.email, token };
  try {
    if (body.mode === 'config') {
      return json(200, {
        ok: true, ai: gatewayConfigured(), voice: voice.publicStatus(voice.voiceStatus()),
        music: (({ ready, perSecond, rights, reason }) => ({ ready, perSecond, rights, reason }))(voice.musicStatus()),
        factCheck: { maxSearches: director.FACT_CHECK.maxUses, maxCostUsd: director.FACT_CHECK.maxCostUsd },
        formats: F.FORMAT_IDS, prices: F.PRICES, styles: STYLES.STYLE_IDS,
        dataFormats: F.DATA_FORMAT_IDS,
        formatModes: Object.fromEntries(Object.entries(FORMAT_MODES).map(([id, m]) => [id, typeof m.run === 'function'])),
        aiClips: (({ ready, model, max, seconds, perClip, reason }) => ({ ready, model, max, seconds, perClip, reason }))(media.clipsStatus()),
        scenes: { ready: gatewayConfigured(), perImage: F.PRICES.sceneImage },
        clipJudge: { ready: gatewayConfigured(), model: process.env.REELS_CLIP_JUDGE_MODEL || CLIPS.JUDGE.model, maxUsdPerReel: CLIPS.JUDGE.maxUsdPerReel },
      });
    }
    if (body.mode === 'trends') return json(200, await trends());
    if (body.mode === 'clip-judge') {
      const gate = await aiSpendGate(token, { feature: clipJudge.FEATURE });
      freeModeGate(gate); // ai-free-mode: skipped; the page keeps its code ranking
      if (gate) return json(gate.status, { ok: false, reason: gate.reason, error: gate.error });
      if (await userOverHourlyLimit(token)) return json(429, { ok: false, reason: 'limit', error: 'Clips are ranked without the AI check this hour.' });
      const result = await clipJudge.judgeClips({ clips: body.clips, subjects: body.subjects, budgetUsd: Number(body.budgetUsd ?? CLIPS.JUDGE.maxUsdPerReel), track });
      return json(result.ok ? 200 : (result.status || (result.reason === 'off' || result.reason === 'feature-off' ? 503 : 502)), result);
    }
    // ── Reels 2.0: lane B ── the ideas room. Over a cap, with AI off or on
    // any AI failure it answers with free template drafts, never an error.
    if (body.mode === 'ideas') {
      const [gate, hourly] = await Promise.all([aiSpendGate(token, { feature: ideas.FEATURE }), userOverHourlyLimit(token)]);
      const free = freeModeGate(gate);
      const blocked = free ? 'free' : (gate && gate.reason === 'feature-off') || !gatewayConfigured() ? 'off' : gate ? 'weekly-limit' : hourly ? 'limit' : '';
      const result = await ideas.run(body, { track, auth, blocked });
      return json(result.ok ? 200 : (result.status || 502), result);
    }
    if (FORMAT_MODES[body.mode]) {
      const result = await formatMode(body.mode, body, { auth, token, track });
      return json(result.ok ? 200 : (result.status || 400), result);
    }
    if (DATA_MODES[body.mode]) {
      const result = await DATA_MODES[body.mode](body, auth, token);
      return json(result.ok ? 200 : (result.status || 400), result);
    }
    if (AI_MODES[body.mode]) {
      // ai-free-mode: person and team budgets (was the personal cap only). Over one,
      // the plan is the code plan (no director); AI-only modes are skipped.
      const [gate, hourly] = await Promise.all([aiSpendGate(token, {}), userOverHourlyLimit(token)]);
      const free = freeModeGate(gate);
      const weekly = Boolean(gate) && !free;
      if (body.mode === 'plan') {
        const result = await plan(body, track, { off: !free && !gatewayConfigured(), free, weekly, hourly });
        return json(result.ok ? 200 : (result.status || 502), result);
      }
      if (free) return json(200, { ok: true, skipped: true });
      if (body.mode === 'revise' && !gatewayConfigured()) return json(503, { ok: false, reason: 'off', error: 'AI is not available right now. Edit the beats by hand.' });
      if (weekly) return json(gate.status, { ok: false, reason: gate.reason, error: gate.error });
      if (hourly) return json(429, { ok: false, reason: 'limit', error: "You've used a lot of AI this hour. Take a short break and try again soon." });
      try {
        const result = await AI_MODES[body.mode](body, track);
        return json(result.ok ? 200 : (result.status || 502), result);
      } catch (error) {
        if (isBudgetError(error)) return json(503, { ok: false, reason: 'budget', error: "This week's AI budget is used up, so AI features are paused until it resets." });
        console.error(`reel-maker ${body.mode} failed:`, error);
        return json(502, { ok: false, error: body.mode === 'revise' ? 'Revise is unavailable right now. Edit the beats by hand.' : 'That did not work. Try again in a moment.' });
      }
    }
    return json(400, { ok: false, error: 'Unknown request.' });
  } catch (error) {
    console.error('reel-maker failed:', error);
    return json(502, { ok: false, error: 'Reels Studio is unavailable right now. Try again in a moment.' });
  }
});

exports._test = { voiceAlign, MAX_VOICE_BODY, FORMAT_MODES, formatMode, dataPlan, EVENT_TYPES, isAdmin, voiceSample, sceneImage, aiClipStart, aiClipStatus, trends, plan, revise, speak, projects, projectSave, projectLoad, recordEvent, readTrend, PLAN_CACHE, sourcesOf, TREND_SPORTS, trendSport, ideas };
