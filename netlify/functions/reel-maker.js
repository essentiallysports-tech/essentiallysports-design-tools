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
//   music     optional generated instrumental bed (REELS_MUSIC=gateway), organic-only rights
//   voice-sample  a ~2 s preview of one of the four voices (cached)
//   scene     one AI scene still for the fill chain (no people, names or logos)
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
// Every request needs a signed-in ES user. AI modes count toward the hourly
// and weekly caps and are logged in frameup_ai_usage (features reels-*).
const crypto = require('node:crypto');
const { verifyEsUser, bearerToken, authConfig } = require('./_supabase-auth.js');
const media = require('./_reel-media.js');
const STYLES = require('../../reel-styles.js');
const { getTrends } = require('./trend-design.js');
const { gatewayConfigured, isBudgetError, userOverHourlyLimit, userOverWeeklyLimit, weeklyLimitMessage } = require('./_ai-gateway.js');
const director = require('./_reel-director.js');
const voice = require('./_reel-voice.js');
const { lintPlan } = require('./_reel-lint.js');
const F = require('../../reel-formats.js');

const REEL_SPORTS = ['nfl', 'cfb', 'mlb', 'golf'];
const TREND_HOURS = 48;
const PLAN_TTL_MS = 45 * 60 * 1000;
const PLAN_CACHE = new Map();
const MAX_BODY = 220 * 1024; // a project's timeline is capped at 200 KB
const PROJECTS = 'frameup_reel_projects';
const EVENTS = 'frameup_reel_events';
const EVENT_TYPES = ['plan', 'revise', 'voice', 'edit', 'export', 'lint_blocked', 'make', 'visuals'];

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
const money = usd => Number((Number(usd) || 0).toFixed(6));
const clean = (value, max = 400) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);

// ─── Trends ────────────────────────────────────────────────────────────────
async function trends() {
  const data = await getTrends(false, { window: '2d' });
  const since = Date.now() - TREND_HOURS * 3600e3;
  const items = (data.items || [])
    .filter(item => REEL_SPORTS.includes(item.category))
    .filter(item => !item.publishedAt || new Date(item.publishedAt).getTime() >= since)
    .slice(0, 40)
    .map(item => ({
      id: item.id, sport: item.category, title: item.title, source: item.source || '', url: item.url || '',
      publishedAt: item.publishedAt || '', team: item.team?.name || '',
      format: F.routeFormat([item.title, ...(item.related || []).map(r => r.title)].join(' ')).format,
      related: (item.related || []).slice(0, 4).map(r => ({ title: r.title, url: r.url, source: r.source })),
    }));
  return { ok: true, updatedAt: data.updatedAt, hours: TREND_HOURS, items, stale: Boolean(data.stale) };
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

async function plan(body, track, gates) {
  const brief = clean(body.brief, 2400);
  const trend = readTrend(body.trend);
  if (!brief && !trend) return { ok: false, status: 400, error: 'Pick a trend or write a brief.' };
  const format = F.FORMATS[body.format] ? body.format : 'auto';
  const tier = body.tier === 'economy' ? 'economy' : 'standard';
  const sport = REEL_SPORTS.includes(body.sport) ? body.sport : '';
  const steer = clean(body.steer, 300);
  // Style: the editor's pick, or 'auto' = the code suggestion (free).
  const suggested = STYLES.suggestStyle({ format, text: [trend?.title, ...(trend?.related || []).map(r => r.title), brief].filter(Boolean).join(' ') });
  const style = STYLES.STYLES[body.style] ? body.style : suggested.id;
  const key = planKey([trend?.id || trend?.title || '', brief, format, tier, steer, sport, Boolean(body.factCheck), style]);
  const hit = PLAN_CACHE.get(key);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return { ...hit.value, cached: true, cost: 0, costs: { director: 0, factCheck: 0 } };

  // Over a cap or AI off: a free, grounded draft (the page says why).
  const blocked = gates.off ? 'off' : (gates.weekly ? 'weekly-limit' : (gates.hourly ? 'limit' : ''));
  let facts = null;
  let factCost = 0;
  if (!blocked && body.factCheck) {
    try {
      facts = await director.factCheck({ topic: [trend?.title, brief].filter(Boolean).join('. '), sport, track });
      factCost = facts.cost;
    } catch (error) {
      if (isBudgetError(error)) facts = null;
    }
  }
  let result;
  if (blocked) {
    // Never spend over a cap (or with AI off): a draft from the brief, no model call.
    const read = director.readReelBrief({ brief, trend, sport, format });
    const draft = F.fallbackPlan({ brief: read.text, title: trend ? trend.title : '', format: read.format, sport: read.sport });
    draft.team = read.team;
    draft.style = style;
    result = { plan: draft, read, source: 'draft', cost: 0, model: '', issues: [] };
  } else {
    result = await director.runReelDirector({ brief, trend, format, sport, tier, steer, style, track, facts: facts?.text || '' });
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
    sources: sourcesOf(trend, brief, facts),
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

const AI_MODES = { plan, revise, voice: speak, music, 'voice-sample': voiceSample, scene: sceneImage, 'ai-clip-start': aiClipStart };
// ai-clip-status only reads a job that was already billed and capped.
const DATA_MODES = { 'ai-clip-status': aiClipStatus, projects, 'project-save': projectSave, 'project-load': projectLoad, event: recordEvent };

exports.handler = async function handler(event) {
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
  if (String(event.body || '').length > MAX_BODY) return json(413, { ok: false, error: 'That request is too large.' });
  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Invalid request.' }); }
  const token = bearerToken(event.headers);
  const track = { email: auth.user.email, token };
  try {
    if (body.mode === 'config') {
      return json(200, {
        ok: true, ai: gatewayConfigured(), voice: voice.publicStatus(voice.voiceStatus()),
        music: (({ ready, perSecond, rights, reason }) => ({ ready, perSecond, rights, reason }))(voice.musicStatus()),
        factCheck: { maxSearches: director.FACT_CHECK.maxUses, maxCostUsd: director.FACT_CHECK.maxCostUsd },
        formats: F.FORMAT_IDS, prices: F.PRICES, styles: STYLES.STYLE_IDS,
        aiClips: (({ ready, model, max, seconds, perClip, reason }) => ({ ready, model, max, seconds, perClip, reason }))(media.clipsStatus()),
        scenes: { ready: gatewayConfigured(), perImage: F.PRICES.sceneImage },
      });
    }
    if (body.mode === 'trends') return json(200, await trends());
    if (DATA_MODES[body.mode]) {
      const result = await DATA_MODES[body.mode](body, auth, token);
      return json(result.ok ? 200 : (result.status || 400), result);
    }
    if (AI_MODES[body.mode]) {
      const [weekly, hourly] = await Promise.all([userOverWeeklyLimit(token), userOverHourlyLimit(token)]);
      if (body.mode === 'plan') {
        const result = await plan(body, track, { off: !gatewayConfigured(), weekly, hourly });
        return json(result.ok ? 200 : (result.status || 502), result);
      }
      if (body.mode === 'revise' && !gatewayConfigured()) return json(503, { ok: false, reason: 'off', error: 'AI is not available right now. Edit the beats by hand.' });
      if (weekly) return json(429, { ok: false, reason: 'weekly-limit', error: weeklyLimitMessage() });
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
};

exports._test = { isAdmin, voiceSample, sceneImage, aiClipStart, aiClipStatus, trends, plan, revise, speak, projects, projectSave, projectLoad, recordEvent, readTrend, PLAN_CACHE, sourcesOf };
