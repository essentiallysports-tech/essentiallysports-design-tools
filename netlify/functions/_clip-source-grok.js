'use strict';
// Video Ads clip source: X-native search with xAI Grok (project-docs/clips-grok.md).
//
// Why: the Haiku web search in video-ads.js finds few clips because web search
// engines barely index fresh X status pages. Grok's `x_search` tool searches X
// itself (keyword / semantic / user search over posts), limited to the official
// team, league and network handles in video-ads-sources.js and to a date range.
//
// Routes, in order (each env-gated):
//   1. XAI_API_KEY set: xAI's own Responses API (api.x.ai/v1/responses) with the
//      x_search tool. This is the route xAI documents.
//   2. Otherwise the Vercel AI Gateway Responses API (ai-gateway.vercel.sh/v1/responses)
//      with the same body and a `spacexai/*` model. The Gateway documents xAI's
//      web_search tool for Grok but NOT x_search, so this module detects an
//      unsupported or silently ignored tool and remembers it for 6 h.
//   3. When x_search is unsupported: Perplexity Sonar on the Gateway (chat
//      completions, x.com domain filter, last week). Weaker (a web index again)
//      but works on the Gateway key alone. CLIPS_GROK_FALLBACK=off skips it.
//
// Post URLs come ONLY from the citations/annotations/search results the API
// returns. A URL the model wrote in its answer is used only when the same
// status id is in the citations; anything else is counted as diag.invented.
// postedAt is decoded from the status id (an X snowflake encodes its creation
// time), so freshness never relies on what the model says. Candidates carry
// mediaUrl: null: video-ads.js verifies them with clipFromPost (fxtwitter / X
// syndication), which finds the MP4 and the real text and date.
//
// Env:
//   CLIPS_GROK=off                switch the source off
//   CLIPS_GROK_MODEL              Gateway model (default spacexai/grok-4.20-non-reasoning)
//   CLIPS_GROK_DIRECT_MODEL       model on api.x.ai when XAI_API_KEY is set (default grok-4.20-0309-non-reasoning)
//   CLIPS_GROK_MAX_USD            budget per search() (default 0.03); later handle batches stop at it
//   CLIPS_GROK_MAX_TURNS          agentic turns per call (default 1, xAI `max_turns`)
//   CLIPS_GROK_FALLBACK=off       no Sonar fallback
//   CLIPS_GROK_FALLBACK_MODEL     default perplexity/sonar
//   XAI_API_KEY                   optional, direct xAI route
// Feature name for usage rows and AI_DISABLE: video-ads-find-clips-grok (also
// switched off by AI_DISABLE=video-ads-find-clips).

const SOURCES = require('../../video-ads-sources.js');
const { logUsage, aiSpendGate, featureDisabled } = require('./_ai-gateway.js');

const FEATURE = 'video-ads-find-clips-grok';
const GATEWAY = 'https://ai-gateway.vercel.sh/v1';
const XAI = 'https://api.x.ai/v1';
const DEFAULT_MODEL = 'spacexai/grok-4.20-non-reasoning';
const DEFAULT_DIRECT_MODEL = 'grok-4.20-0309-non-reasoning';
const DEFAULT_FALLBACK_MODEL = 'perplexity/sonar';
// x_search accepts up to 20 handles in allowed_x_handles (docs.x.ai/developers/tools/x-search).
const MAX_HANDLES_PER_CALL = 20;
const MAX_CALLS = 4;
const UNSUPPORTED_MS = 6 * 3600e3;
const TIMEOUT_MS = 25000;

// USD. Token rates per 1M from the live Gateway list (ai-gateway.vercel.sh/v1/models,
// 2026-11-17) and docs.x.ai/developers/pricing. Tool fees from docs.x.ai pricing:
// x_search $5 / 1k posts fetched, $10 / 1k profiles; web_search $5 / 1k calls.
// Sonar: the Gateway lists a request fee; $0.005 is Perplexity's low-context
// list price, used as the conservative figure.
const PRICES = {
  'spacexai/grok-4.20-non-reasoning': { input: 1.25, cacheRead: 0.20, output: 2.50 },
  'spacexai/grok-4.20-reasoning': { input: 1.25, cacheRead: 0.20, output: 2.50 },
  'spacexai/grok-4.3': { input: 1.25, cacheRead: 0.20, output: 2.50 },
  'spacexai/grok-build-0.1': { input: 1.00, cacheRead: 0.20, output: 2.00 },
  'spacexai/grok-4.5': { input: 2, cacheRead: 0.30, output: 6 },
  'grok-4.20-0309-non-reasoning': { input: 1.25, cacheRead: 0.20, output: 2.50 },
  'grok-4.3': { input: 1.25, cacheRead: 0.20, output: 2.50 },
  'perplexity/sonar': { input: 0.25, cacheRead: 0.25, output: 2.50, request: 0.005 },
};
const TOOL_PRICES = { xPost: 0.005, xUser: 0.01, webSearch: 0.005 };

const state = { unsupportedUntil: 0, unsupportedReason: '' };

const envOf = env => env || process.env;
const off = value => /^(0|off|false|no|disabled?)$/i.test(String(value || '').trim());
const modelOf = env => String(envOf(env).CLIPS_GROK_MODEL || DEFAULT_MODEL).trim();
const directModelOf = env => String(envOf(env).CLIPS_GROK_DIRECT_MODEL || DEFAULT_DIRECT_MODEL).trim();
const fallbackModelOf = env => String(envOf(env).CLIPS_GROK_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL).trim();
function numberEnv(env, name, fallback, min, max) {
  const n = Number(envOf(env)[name]);
  return Number.isFinite(n) && String(envOf(env)[name] ?? '').trim() !== '' ? Math.min(max, Math.max(min, n)) : fallback;
}

function configured(env) {
  const e = envOf(env);
  if (off(e.CLIPS_GROK)) return false;
  if (String(e.GENERATE_AI || '').toLowerCase() === 'rules') return false;
  return Boolean(e.XAI_API_KEY || e.AI_GATEWAY_API_KEY);
}

// ── Handles ──────────────────────────────────────────────────────────────
const bare = h => String(h || '').replace(/^@/, '').trim();
const teamName = t => (typeof t === 'string' ? t : t?.name || '');
const SPORTS = Object.keys(SOURCES.SPORT_SOURCES);

// Most useful first: the team(s) asked for, the sport's league accounts, its
// networks, then (for a sport-wide or colour search) the other team accounts.
function handlePlan({ sport, team, teams = [] } = {}) {
  const sports = SPORTS.includes(sport) ? [sport] : SPORTS;
  const asked = [team, ...(Array.isArray(teams) ? teams : [])].filter(Boolean);
  const own = asked.map(t => SOURCES.handleFor(teamName(t))).filter(Boolean);
  const league = sports.flatMap(s => SOURCES.sourcesFor(s).league);
  const media = sports.flatMap(s => SOURCES.sourcesFor(s).media);
  // A single-team search stays on that team's world; otherwise every team of the sport.
  const rest = team ? [] : Object.values(SOURCES.TEAM_HANDLES).filter(h => sports.includes(sportOfHandle(h)));
  const seen = new Set();
  return [...own, ...league, ...media, ...rest].map(bare).filter(h => {
    const key = h.toLowerCase();
    if (!h || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Team handle -> sport id, from video-ads-teams.js (loaded lazily, optional).
let teamSports = null;
function sportOfHandle(handle) {
  if (!teamSports) {
    teamSports = new Map();
    try {
      const TEAMS = require('../../video-ads-teams.js');
      (TEAMS.TEAMS || []).forEach(t => { const h = SOURCES.handleFor(t.name); if (h) teamSports.set(h.toLowerCase(), t.sport); });
    } catch { /* no team data: every team handle counts for every sport */ }
  }
  return teamSports.get(String(handle).toLowerCase()) || '';
}

function batches(list, size = MAX_HANDLES_PER_CALL) {
  const n = Math.max(1, Math.min(MAX_HANDLES_PER_CALL, size));
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

// ── Dates ────────────────────────────────────────────────────────────────
// x_search from_date is a UTC day (YYYY-MM-DD, inclusive from 00:00 UTC), so the
// window is rounded down to the day and the exact cut is made on the post time.
const ymd = ms => new Date(ms).toISOString().slice(0, 10);
const fromDateFor = (sinceHours, now = Date.now()) => ymd(now - sinceHours * 3600e3);

// X status ids are snowflakes: the top bits are ms since 2010-11-04 (Twitter epoch).
const TWITTER_EPOCH = 1288834974657n;
function snowflakeTime(id) {
  if (!/^\d{15,20}$/.test(String(id || ''))) return null;
  try {
    const ms = Number((BigInt(id) >> 22n) + TWITTER_EPOCH);
    return ms > Date.UTC(2010, 10, 4) ? new Date(ms).toISOString() : null;
  } catch { return null; }
}

// Same rule as video-ads.js looksOld (kept in sync by scripts/test-clip-source-grok.mjs).
const THROWBACK = /#?\b(?:tbt|throwback(?:thursday)?|flashback(?:friday)?|on this day|years? ago|this day in (?:history|\w+ history)|anniversary|remember when)\b/i;
function looksOld(text, now = new Date()) {
  const value = String(text || '');
  if (THROWBACK.test(value)) return true;
  const year = now.getUTCFullYear();
  const years = [...value.matchAll(/(?:^|[^\d$#.,/:])((?:19|20)\d{2})(?:[-–](?:\d{2}|\d{4}))?(?![\d,.]?\d)/g)].map(m => Number(m[1]));
  return years.some(y => y >= 1900 && y <= year - 2);
}

// ── Citations ────────────────────────────────────────────────────────────
// https://x.com/<handle>/status/<id> (also twitter.com, mobile., /i/web/status/, /statuses/).
const STATUS_RE = /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:([A-Za-z0-9_]{1,15})\/status(?:es)?|i(?:\/web)?\/status)\/(\d{5,20})/gi;
function statusLinks(text) {
  const out = [];
  for (const m of String(text || '').matchAll(STATUS_RE)) {
    const handle = m[1] && !/^i$/i.test(m[1]) ? m[1] : '';
    out.push({ id: m[2], handle });
  }
  return out;
}

// Every URL the API itself returned: top-level citations, url_citation
// annotations, Sonar search_results, and urls inside tool-call outputs.
function citedUrls(data) {
  const urls = [];
  const add = u => { if (typeof u === 'string' && u) urls.push(u); else if (u?.url) urls.push(String(u.url)); };
  (Array.isArray(data?.citations) ? data.citations : []).forEach(add);
  (Array.isArray(data?.search_results) ? data.search_results : []).forEach(add);
  (Array.isArray(data?.output) ? data.output : []).forEach(item => {
    (Array.isArray(item?.content) ? item.content : []).forEach(part => (part?.annotations || []).forEach(a => a?.type === 'url_citation' && add(a)));
    if (item?.type && item.type !== 'message' && typeof item.output === 'string') statusLinks(item.output).forEach(l => urls.push(`https://x.com/${l.handle || 'i'}/status/${l.id}`));
  });
  (data?.choices || []).forEach(choice => {
    (choice?.message?.annotations || []).forEach(a => add(a?.url_citation || a));
  });
  return urls;
}

function answerText(data) {
  if (typeof data?.output_text === 'string' && data.output_text) return data.output_text;
  const parts = [];
  (Array.isArray(data?.output) ? data.output : []).forEach(item => {
    if (item?.type !== 'message') return;
    (item.content || []).forEach(part => { if (typeof part?.text === 'string') parts.push(part.text); });
  });
  (data?.choices || []).forEach(choice => { if (typeof choice?.message?.content === 'string') parts.push(choice.message.content); });
  return parts.join('\n');
}

// The model's JSON ({"posts":[{url, handle, text}]}) only adds hints (text,
// handle) to posts that are already cited.
function modelPosts(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed?.posts) ? parsed.posts.filter(p => p && typeof p === 'object') : [];
  } catch { return []; }
}

// Cited X posts -> candidates (url, handle, postedAt from the id). Counts the
// URLs the model wrote that no citation backs (diag.invented).
function candidatesFrom(data, { sport, sinceHours, now = Date.now(), allowed = [] } = {}) {
  const diag = { cited: 0, invented: 0, tooOld: 0, throwback: 0, noDate: 0 };
  const cited = new Map();
  citedUrls(data).forEach(url => statusLinks(url).forEach(link => {
    const prev = cited.get(link.id);
    if (!prev || (!prev.handle && link.handle)) cited.set(link.id, link);
  }));
  diag.cited = cited.size;
  const hints = new Map();
  modelPosts(answerText(data)).forEach(post => {
    const link = statusLinks(post.url)[0];
    if (!link) return;
    if (!cited.has(link.id)) { diag.invented += 1; return; }
    hints.set(link.id, post);
  });
  const allowedSet = new Map(allowed.map(h => [h.toLowerCase(), h]));
  const candidates = [];
  cited.forEach((link, id) => {
    const hint = hints.get(id) || {};
    const hinted = bare(hint.handle);
    // A handle comes from the cited URL; the model's hint only fills an /i/ link and only with a searched handle.
    const handle = link.handle || allowedSet.get(hinted.toLowerCase()) || '';
    const at = snowflakeTime(id);
    if (!at) { diag.noDate += 1; return; }
    const age = (now - new Date(at).getTime()) / 3600e3;
    if (age > sinceHours || age < -1) { diag.tooOld += 1; return; }
    const text = String(hint.text || '').slice(0, 280);
    if (text && looksOld(text, new Date(now))) { diag.throwback += 1; return; }
    const kind = handle ? SOURCES.classifyHandle(handle, sport) : 'other';
    candidates.push({
      url: `https://x.com/${handle || 'i'}/status/${id}`,
      platform: 'x',
      handle: handle || null,
      postedAt: at,
      text,
      mediaUrl: null,
      thumb: null, durationMs: null, width: null, height: null,
      sourceKind: kind === 'other' ? 'fan' : kind,
    });
  });
  return { candidates, diag };
}

// ── Cost ────────────────────────────────────────────────────────────────
function toolUsage(usage = {}) {
  const d = usage.server_side_tool_usage_details || usage.server_side_tool_usage || {};
  const num = v => Math.max(0, Number(v) || 0);
  return {
    xCalls: num(d.x_search_calls ?? d.x_search),
    xPosts: num(d.x_posts_fetched),
    xUsers: num(d.x_users_fetched),
    webSearches: num(d.web_search_calls ?? d.web_search),
  };
}

function usageTokens(usage = {}) {
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
  const cached = Number(usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0) || 0;
  const output = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
  return { input: Math.max(0, input - cached), cacheRead: cached, output };
}

// Provider-reported cost first (xAI cost_in_usd_ticks, 1 USD = 1e10 ticks; or a
// plain usage.cost in USD), else tokens at list price plus tool fees.
function callCost(model, data) {
  const usage = data?.usage || {};
  const ticks = Number(usage.cost_in_usd_ticks);
  if (Number.isFinite(ticks) && ticks > 0) return ticks / 1e10;
  const reported = Number(usage.cost);
  if (Number.isFinite(reported) && reported > 0) return reported;
  const price = PRICES[model] || PRICES[DEFAULT_MODEL];
  const t = usageTokens(usage);
  const tools = toolUsage(usage);
  return (t.input * price.input + t.cacheRead * (price.cacheRead ?? price.input) + t.output * price.output) / 1e6
    + (price.request || 0)
    + tools.xPosts * TOOL_PRICES.xPost + tools.xUsers * TOOL_PRICES.xUser + tools.webSearches * TOOL_PRICES.webSearch;
}

// ── Requests ────────────────────────────────────────────────────────────
const SYSTEM = [
  'You find the newest sports video posts on X for EssentiallySports newsletter ads.',
  'Use the X search tool. Only list posts the search returned; never invent or edit a post URL or id.',
  'Only posts with native video (highlights, plays, celebrations, pressers) made inside the date window. No throwbacks or re-uploads of old games.',
  'Reply with JSON only.',
].join('\n');

function userPrompt({ subject, handles, sinceHours, limit, sinceIso }) {
  return [
    subject,
    `Search X posts from these accounts: ${handles.map(h => `@${h}`).join(', ')}.`,
    `Only posts made after ${sinceIso} UTC (the last ${sinceHours} hours) that carry a native video.`,
    `Reply as {"posts":[{"url":"https://x.com/<handle>/status/<id>","handle":"<handle>","text":"<post text>"}]} with up to ${limit} posts, newest and most-watched first.`,
  ].join('\n');
}

function subjectFor({ sport, team, teams = [], color, query }) {
  const sportName = { nfl: 'NFL', mlb: 'MLB', cfb: 'college football' }[sport] || 'NFL, MLB and college football';
  if (query) return `${sportName} moment: ${String(query).slice(0, 200)}`;
  if (team) return `${sportName}: ${teamName(team)} video highlights from this week.`;
  if (teams.length) return `${sportName}${color ? ` (${color} teams)` : ''}: video highlights from ${teams.slice(0, 6).map(teamName).join(', ')} and their league.`;
  return `${sportName}: this week's video highlights.`;
}

// Responses API body with the x_search tool (same shape on api.x.ai and the Gateway).
function xSearchBody({ model, handles, fromDate, prompt, maxTurns }) {
  return {
    model,
    input: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    tools: [{ type: 'x_search', allowed_x_handles: handles, from_date: fromDate, enable_image_understanding: false, enable_video_understanding: false }],
    max_turns: maxTurns,
    max_output_tokens: 1200,
    temperature: 0,
  };
}

// Sonar fallback (Gateway chat completions): x.com only, last week.
function sonarBody({ model, prompt }) {
  const perplexity = { search_domain_filter: ['x.com'], search_recency_filter: 'week', web_search_options: { search_context_size: 'low' } };
  return {
    model,
    messages: [{ role: 'system', content: SYSTEM.replace('Use the X search tool.', 'Search x.com status pages.') }, { role: 'user', content: prompt }],
    max_tokens: 1200,
    temperature: 0,
    // Perplexity's search filters, passed through the Gateway's providerOptions.
    providerOptions: { perplexity },
  };
}

async function post(url, key, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, data };
}

// A 4xx that names the tool, or a 200 where no X search ran and nothing was cited.
function unsupportedReply(res) {
  if (!res.ok) {
    const msg = String(res.data?.error?.message || res.data?.error || res.data?.message || '');
    return [400, 404, 422].includes(res.status) && /x_search|tool|unsupported|not supported|unknown|invalid/i.test(msg);
  }
  const tools = toolUsage(res.data?.usage || {});
  const ran = tools.xCalls > 0 || tools.xPosts > 0
    || (res.data?.output || []).some(item => /x_(keyword|semantic|user)_search|x_thread_fetch|x_search/.test(`${item?.name || ''} ${item?.type || ''}`));
  return !ran && citedUrls(res.data).length === 0;
}

async function logCall(track, row) {
  if (!track) return;
  await logUsage({ ...track, feature: FEATURE }, row);
}

// ── search() ────────────────────────────────────────────────────────────
async function search({ sport, team, teams = [], color, query, sinceHours = 120, limit = 25, track, token, env } = {}) {
  const e = envOf(env);
  const diag = { mode: 'off', calls: 0, batches: 0, handles: 0, searched: 0, cited: 0, found: 0, invented: 0, tooOld: 0, throwback: 0, noDate: 0, duplicate: 0, failed: 0, xPostsFetched: 0 };
  const result = (candidates = [], cost = 0) => ({ candidates, cost: Number(cost.toFixed(6)), diag });
  if (!configured(e)) return result();
  if (featureDisabled(FEATURE)) { diag.mode = 'feature-off'; return result(); }
  if (token) {
    const blocked = await aiSpendGate(token, { feature: FEATURE });
    if (blocked) { diag.mode = 'blocked'; diag.blocked = blocked.reason; return result(); }
  }

  const hours = Math.max(1, Math.min(168, Number(sinceHours) || 120));
  const max = Math.max(1, Math.min(50, Number(limit) || 25));
  const budget = numberEnv(e, 'CLIPS_GROK_MAX_USD', 0.03, 0.005, 1);
  const maxTurns = Math.round(numberEnv(e, 'CLIPS_GROK_MAX_TURNS', 1, 1, 5));
  const now = Date.now();
  const handles = handlePlan({ sport, team, teams });
  const groups = batches(handles).slice(0, MAX_CALLS);
  diag.handles = handles.length;
  const prompt = list => userPrompt({ subject: subjectFor({ sport, team, teams, color, query }), handles: list, sinceHours: hours, limit: max, sinceIso: new Date(now - hours * 3600e3).toISOString().slice(0, 16) });

  const direct = Boolean(e.XAI_API_KEY);
  const useX = direct || now >= state.unsupportedUntil;
  const fallbackOn = !off(e.CLIPS_GROK_FALLBACK) && Boolean(e.AI_GATEWAY_API_KEY);
  const byId = new Map();
  let spent = 0;
  let lastCost = 0;

  const take = (data, allowed) => {
    const got = candidatesFrom(data, { sport, sinceHours: hours, now, allowed });
    ['cited', 'invented', 'tooOld', 'throwback', 'noDate'].forEach(k => { diag[k] += got.diag[k]; });
    got.candidates.forEach(c => {
      const id = c.url.split('/').pop();
      if (byId.has(id)) { diag.duplicate += 1; if (!byId.get(id).handle && c.handle) byId.set(id, c); } else byId.set(id, c);
    });
  };

  const run = async (kind, model, url, key, body, allowed) => {
    const started = Date.now();
    diag.calls += 1;
    try {
      const res = await post(url, key, body);
      if (kind === 'x' && !direct && unsupportedReply(res)) {
        state.unsupportedUntil = Date.now() + UNSUPPORTED_MS;
        state.unsupportedReason = res.ok ? 'tool ignored' : `HTTP ${res.status}`;
        diag.unsupported = state.unsupportedReason;
        const cost = res.ok ? callCost(model, res.data) : 0;
        spent += cost;
        await logCall(track, { model, ok: res.ok, input_tokens: usageTokens(res.data?.usage).input, output_tokens: usageTokens(res.data?.usage).output, cost_usd: Number(cost.toFixed(6)), duration_ms: Date.now() - started, error: `x_search unsupported (${state.unsupportedReason})` });
        return 'unsupported';
      }
      if (!res.ok) throw Object.assign(new Error(String(res.data?.error?.message || `HTTP ${res.status}`)), { status: res.status });
      const cost = callCost(model, res.data);
      const t = usageTokens(res.data?.usage);
      spent += cost;
      lastCost = cost;
      diag.xPostsFetched += toolUsage(res.data?.usage).xPosts;
      await logCall(track, { model, ok: true, input_tokens: t.input, output_tokens: t.output, cache_read_tokens: t.cacheRead, cost_usd: Number(cost.toFixed(6)), duration_ms: Date.now() - started });
      take(res.data, allowed);
      return 'ok';
    } catch (error) {
      diag.failed += 1;
      diag.error = String(error.message || error).slice(0, 160);
      await logCall(track, { model, ok: false, input_tokens: 0, output_tokens: 0, cost_usd: 0, duration_ms: Date.now() - started, error: diag.error });
      return 'stop'; // an error (budget, rate limit, outage) ends this search; no retries on the next batch
    }
  };

  if (useX && groups.length) {
    diag.mode = direct ? 'xai' : 'gateway';
    const model = direct ? directModelOf(e) : modelOf(e);
    const url = `${direct ? XAI : GATEWAY}/responses`;
    const key = direct ? e.XAI_API_KEY : e.AI_GATEWAY_API_KEY;
    const fromDate = fromDateFor(hours, now);
    for (const group of groups) {
      if (diag.batches > 0 && (spent + lastCost > budget || byId.size >= max)) break;
      diag.batches += 1;
      diag.searched += group.length;
      const status = await run('x', model, url, key, xSearchBody({ model, handles: group, fromDate, prompt: prompt(group), maxTurns }), group);
      if (status === 'unsupported' || status === 'stop') break;
    }
  }
  if ((!useX || diag.unsupported) && fallbackOn) {
    diag.mode = 'sonar';
    const model = fallbackModelOf(e);
    const group = groups[0] || [];
    diag.batches += 1;
    await run('sonar', model, `${GATEWAY}/chat/completions`, e.AI_GATEWAY_API_KEY, sonarBody({ model, prompt: prompt(group) }), group);
  }

  const rank = { official: 0, league: 1, media: 2, fan: 3 };
  const candidates = [...byId.values()]
    .sort((a, b) => rank[a.sourceKind] - rank[b.sourceKind] || String(b.postedAt).localeCompare(String(a.postedAt)))
    .slice(0, max);
  diag.found = candidates.length;
  return result(candidates, spent);
}

module.exports = {
  id: 'grok',
  configured,
  search,
  _test: {
    FEATURE, DEFAULT_MODEL, DEFAULT_DIRECT_MODEL, MAX_HANDLES_PER_CALL, PRICES, TOOL_PRICES, state,
    handlePlan, batches, fromDateFor, snowflakeTime, looksOld, statusLinks, citedUrls, answerText, modelPosts,
    candidatesFrom, callCost, toolUsage, usageTokens, xSearchBody, sonarBody, unsupportedReply,
    reset() { state.unsupportedUntil = 0; state.unsupportedReason = ''; },
  },
};
