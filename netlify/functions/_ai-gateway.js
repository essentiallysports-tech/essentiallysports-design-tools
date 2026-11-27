'use strict';
// FrameUp AI through the Vercel AI Gateway: one key (AI_GATEWAY_API_KEY, set in
// Vercel / .env.local) for every AI feature. The account has a $50/week budget
// on Vercel (a hard stop). FrameUp's own budgets sit under it (POLICY: $20 per
// person, $45 team); over any of them, or when the Gateway reports its budget
// used up, FrameUp runs in free mode: every tool uses its no-AI path (rules,
// templates, ES photos, code ranking) and replies { ok: true, mode: 'free' }.
//
// Two tiers keep spend low:
//   light: small, frequent jobs (Trend Design headline ideas). Cheapest model.
//   main:  bigger jobs (Generate, photo picking). Claude Haiku 5.5.
// Override with AI_LIGHT_MODEL / AI_MAIN_MODEL.
//
// Every call's token use and cost is saved to public.frameup_ai_usage (one row
// per call, written with the signed-in user's own session), which the
// Dashboard's "AI spend" panel reads.
//
// Guardrails (project-docs/ai-strategy-and-costs.md, "What shipped"):
//   aiSpendGate()  kill switch (AI_DISABLE) + per-person and team weekly $ caps
//                  (POLICY; AI_USER_WEEKLY_LIMIT_USD / AI_TEAM_WEEKLY_LIMIT_USD can
//                  only lower them), fail open with a warning event, or closed
//                  with AI_FAIL_CLOSED=1. Over a cap: { free } -> freeModeGate().
//   withAiMode()   wraps every AI handler: per-request free-mode store + reply shape.
//   AI_ECONOMY=1   routes the best (Sonnet) tier to main (Haiku).
//   aiText / aiWebResearch / aiImage refuse a switched-off feature before any fetch.

const { AsyncLocalStorage } = require('node:async_hooks');
const { authConfig } = require('./_supabase-auth.js');
const { teamThresholdAlert } = require('./_ai-alerts.js');

const GATEWAY = 'https://ai-gateway.vercel.sh/v1';
const MODELS = {
  light: process.env.AI_LIGHT_MODEL || 'openai/gpt-oss-20b',
  main: process.env.AI_MAIN_MODEL || 'anthropic/claude-haiku-5.5',
  // Cheap web search (Video Ads clip finding). Web search needs a Claude model,
  // so the cheapest Claude tier, not the (non-Claude) light model.
  search: process.env.AI_SEARCH_MODEL || 'anthropic/claude-haiku-5.5',
  // Generate's art-director review: a different model family from the writer,
  // so it does not just approve its own style.
  review: process.env.AI_REVIEW_MODEL || 'openai/gpt-6-luna',
  // Only for designs that still score low, or when someone asks for the best version.
  best: process.env.AI_BEST_MODEL || 'anthropic/claude-sonnet-5.5',
  // gen5: Generate's art director (owner: "use a good model if it's needed to
  // create good designs"). One call a run, logged and capped per run.
  top: process.env.AI_TOP_MODEL || 'anthropic/claude-opus-5.5',
  // Scene/background images, only on an explicit click. Cheapest good model.
  image: process.env.AI_IMAGE_MODEL || 'bfl/flux-3-image-klein',
  // Backup text model on the Gateway, used when Groq isn't configured (Generate
  // writer, Trends): an open-weights model from a different family than Claude.
  backup: process.env.AI_BACKUP_MODEL || 'openai/gpt-oss-120b',
};
// Speech to text on the Gateway (Reels captions). ElevenLabs Scribe v2 returns
// word-level timestamps by default, which the caption editor needs.
const TRANSCRIPTION_MODEL = process.env.AI_TRANSCRIPTION_MODEL || 'elevenlabs/scribe-v2';
// USD per generated image (Gateway list prices, 2026-11, ~1MP). Unknown models count at 0.07.
const IMAGE_PRICES = {
  'bfl/flux-3-image-klein': 0.011,
  'meta/muse-image-1.0': 0.01,
  'google/gemini-3.1-flash-lite-image': 0.034,
  'google/gemini-3.1-flash-image': 0.067,
};
// USD per 1M tokens. Unknown models count at main rates (scripts/test-ai-guardrails.mjs
// fails if a default model has no entry).
// Anthropic rows are Anthropic's list prices (platform.claude.com/docs/en/about-claude/pricing,
// checked 2026-11-17); the Gateway bills provider list price with no markup:
//   Haiku 5.5   $0.10 in / $0.50 out for prompts up to 100K tokens ($0.50 / $2.50 above: longContext),
//               cache read 0.1x = $0.01, 5-minute cache write 1.25x = $0.125.
//   Sonnet 5.5  $2 / $10, cache read $0.10 (0.05x, was wrongly $0.20 here), cache write $2.50.
//   Opus 5.5    $4 / $20, cache read $0.20 (0.05x), cache write $5.
// The OpenAI rows are the Gateway's list prices (2026-11); re-check them in the monthly review.
// Cache writes are priced at the 5-minute TTL (the only TTL FrameUp sends).
const PRICES = {
  'openai/gpt-oss-20b': { input: 0.03, output: 0.14 },
  'openai/gpt-oss-120b': { input: 0.10, output: 0.50 },
  'openai/gpt-6-luna': { input: 0.10, output: 0.50 },
  'anthropic/claude-haiku-5.5': { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125, longContext: { above: 100000, input: 0.50, output: 2.50, cacheRead: 0.05, cacheWrite: 0.625 } },
  'anthropic/claude-sonnet-5.5': { input: 2, output: 10, cacheRead: 0.10, cacheWrite: 2.5 },
  'anthropic/claude-opus-5.5': { input: 4, output: 20, cacheRead: 0.20, cacheWrite: 5 },
};
// USD per audio minute for speech to text. Gateway ids are from the live model
// list (ai-gateway.vercel.sh/v1/models, 2026-11-18: transcription_duration_cost_per_second
// x 60). Token-billed models (gpt-4o-*, gemini) are estimates from typical audio
// token rates. Bare ids are direct OpenAI (OPENAI_API_KEY). Groq Whisper is free.
const AUDIO_PRICES_PER_MIN = {
  'elevenlabs/scribe-v2': 0.0036667,
  'openai/whisper-1': 0.006,
  'openai/gpt-transcribe': 0.0045,
  'openai/gpt-4o-transcribe': 0.006,
  'openai/gpt-4o-mini-transcribe': 0.003,
  'google/gemini-3.5-transcribe': 0.004,
  'mistral/voxtral-mini-transcribe-3': 0.0035,
  'mistral/voxtral-small-transcribe-3': 0.004,
  'microsoft/mai-transcribe-2': 0.0016668,
  'spacexai/grok-stt': 0.00168,
  'fish-audio/transcribe-1': 0.006,
  'gpt-4o-transcribe': 0.006,
  'gpt-4o-mini-transcribe': 0.003,
  'whisper-1': 0.006,
};
function audioCostUsd(model, seconds) {
  const rate = AUDIO_PRICES_PER_MIN[model] ?? 0.006;
  return Math.max(0, Number(seconds) || 0) / 60 * rate;
}
const USAGE_TABLE = 'frameup_ai_usage';

// False in free mode too (over a weekly budget, see "Free mode" below), so every
// caller's existing no-AI path (rules, templates, code ranking) runs instead.
function gatewayConfigured() {
  return Boolean(process.env.AI_GATEWAY_API_KEY) && String(process.env.GENERATE_AI || '').toLowerCase() !== 'rules' && !freeModeReason();
}

function costUsd(model, usage = {}) {
  let price = PRICES[model] || PRICES[MODELS.main] || { input: 0.10, output: 0.50 };
  // Haiku 5.5 bills a whole request at the higher rate once the prompt passes 100K tokens.
  const prompt = (usage.input || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0);
  if (price.longContext && prompt > price.longContext.above) price = { ...price, ...price.longContext };
  const perToken = rate => (rate || 0) / 1e6;
  return (usage.input || 0) * perToken(price.input)
    + (usage.output || 0) * perToken(price.output)
    + (usage.cacheRead || 0) * perToken(price.cacheRead ?? price.input)
    + (usage.cacheWrite || 0) * perToken(price.cacheWrite ?? price.input);
}

// ─── Guardrail settings (all env, read on every call so a redeploy is not needed in tests) ───
const envFlag = name => /^(1|true|yes|on)$/i.test(String(process.env[name] || '').trim());
// AI_DISABLE=video-ads-find-clips,trend-enrich switches features off. A name also
// covers its sub-features ("generate" covers "generate-director"); "all" or "*"
// switches every AI feature off.
function disabledFeatures() {
  return String(process.env.AI_DISABLE || process.env.AI_DISABLE_FEATURES || '')
    .split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
}
function featureDisabled(feature) {
  const name = String(feature || '').trim().toLowerCase().replace(/-backup$/, '');
  if (!name) return false;
  return disabledFeatures().some(off => off === 'all' || off === '*' || name === off || name.startsWith(`${off}-`));
}
const FEATURE_NAMES = [
  ['generate-rewrite', 'AI rewrites'],
  ['generate-creative', 'Creative designs'],
  ['generate-assistant', 'The design assistant'],
  ['generate-scene-image', 'AI scene images'],
  ['generate', 'AI design writing'],
  ['trend', 'AI headline ideas'],
  ['video-ads-find-clips', 'Clip search'],
  ['video-ads-moments-with-clips', 'Clip search'],
  ['video-ads-copy', 'AI ad copy'],
  ['video-ads-chat', 'The Video Ads assistant'],
  ['video-ads-grammar', 'The AI grammar check'],
  ['video-ads-rating', 'Ad rating'],
  ['meta-ads', 'Competitor ads'],
  ['merch-concepts', 'Merch design ideas'],
  ['merch-copy', 'Merch shop copy'],
  ['merch-refine', 'The merch design chat'],
  ['merch-moments', 'Merch moments'],
  // The context entry comes first: names match by prefix.
  ['merch-brainstorm-context', 'The merch brainstorm web check'],
  ['merch-brainstorm', 'The merch brainstorm room'],
  ['reels-transcription', 'Automatic captions'],
  ['reels-ideas', 'The Reels ideas room'],
  ['reels-radar', 'The Reels trend radar'],
  ['reels-voice-align', 'Voiceover sync'],
  ['reels-photo-verify', 'Reels photo check'],
  ['reels-review', 'The Reels review pass'],
  // Reels v4: the director (prefix covers reels-director-sonnet), AI edits,
  // the critic, the "Need a script?" helper and the daily house lessons.
  ['reels-director', 'The Reels director'],
  ['reels-revise', 'Reels AI edits'],
  ['reels-critique', 'The Reels critic'],
  ['reels-script-draft', 'The Reels script helper'],
  ['reels-lessons', 'Reels house lessons'],
];
// A call is switched off when its feature or its task is listed.
function trackDisabled(track) {
  return featureDisabled(track?.feature) || featureDisabled(track?.task);
}
function featureOffMessage(feature) {
  const name = String(feature || '').toLowerCase();
  const label = (FEATURE_NAMES.find(([prefix]) => name === prefix || name.startsWith(`${prefix}-`)) || [])[1] || 'This AI feature';
  return `${label} is switched off for now. Everything else in FrameUp still works.`;
}
function featureOffError(feature) {
  return Object.assign(new Error(featureOffMessage(feature)), { status: 503, code: 'feature-off', feature });
}
// AI_ECONOMY=1 routes the expensive tier to a cheaper one: best (Sonnet) runs on
// main (Haiku). Logged rows carry the model that really ran.
const ECONOMY_ROUTES = { best: 'main', top: 'main' };
function economyMode() { return envFlag('AI_ECONOMY'); }
function modelFor(tier, fallback = 'light') {
  const routed = economyMode() && ECONOMY_ROUTES[tier] ? ECONOMY_ROUTES[tier] : tier;
  return MODELS[routed] || MODELS[fallback];
}
function failClosed() { return envFlag('AI_FAIL_CLOSED'); }

// ─── Budget policy (testing phase, owner 2026-11-20). Set here, in code ─────
// The Vercel AI Gateway account budget is $50/week, a hard stop on Vercel's
// side. FrameUp stops at $45 for the team (so it degrades before that stop) and
// $20 per person. Over any of them FrameUp runs in free mode (no AI) instead of
// erroring. To raise a limit, change POLICY (and the Gateway budget on Vercel).
// AI_USER_WEEKLY_LIMIT_USD / AI_TEAM_WEEKLY_LIMIT_USD are optional overrides
// that can only LOWER a limit: a value above the policy (or 0, off, garbage)
// is ignored with a logged 'limit-env-ignored' event and shows in
// /api/ai-status as envIgnored, so an old env value never silently raises it.
const POLICY = Object.freeze({ userWeeklyUsd: 20, teamWeeklyUsd: 45, gatewayWeeklyUsd: 50 });
// Accepts "50", "$50", "50 USD", "50.00", "1,000". null when unset, NaN when unreadable.
function parseUsd(raw) {
  const text = String(raw ?? '').trim().replace(/^\$\s*/, '').replace(/\s*(usd|dollars?)$/i, '').replace(/,/g, '').trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : NaN;
}
function policyLimit(envName, ceiling, env = process.env) {
  const value = parseUsd(env[envName]);
  if (value === null) return { limit: ceiling, ignored: false };
  if (value > 0 && value <= ceiling) return { limit: value, ignored: false };
  return { limit: ceiling, ignored: true, why: value > ceiling ? 'above-policy' : 'not-a-positive-amount' };
}
function limitFor(envName, ceiling) {
  const result = policyLimit(envName, ceiling);
  if (result.ignored) warnEvent('limit-env-ignored', { env: envName, why: result.why, using: ceiling });
  return result.limit;
}
function userWeeklyLimitUsd() { return limitFor('AI_USER_WEEKLY_LIMIT_USD', POLICY.userWeeklyUsd); }
function teamWeeklyLimitUsd() { return limitFor('AI_TEAM_WEEKLY_LIMIT_USD', POLICY.teamWeeklyUsd); }
function envIgnored() {
  return ['AI_USER_WEEKLY_LIMIT_USD', 'AI_TEAM_WEEKLY_LIMIT_USD']
    .filter(name => policyLimit(name, name.includes('TEAM') ? POLICY.teamWeeklyUsd : POLICY.userWeeklyUsd).ignored);
}

// ─── Free mode ─────────────────────────────────────────────────────────────
// One request runs in free mode when the person or the team is over this
// week's budget, or the Gateway itself said its budget is used up. Handlers
// wrapped with withAiMode() get a per-request store; aiSpendGate() returns
// { free: reason } and freeModeGate(gate) switches the request to free mode.
// In free mode gatewayConfigured() is false and aiText / aiWebResearch /
// aiImage / aiTranscribe throw a 'free-mode' error before any fetch, so the
// callers' no-AI paths run. The handler's reply then carries
// { ok: true, mode: 'free', reason, notice, resetsAt } (see annotateFree).
const FREE_REASONS = ['user-limit', 'team-limit', 'gateway-budget'];
const FREE_NOTES = {
  user: "You've used this week's AI budget, so FrameUp is in free mode. AI features come back Monday.",
  team: "The team's AI budget for this week is used up, so FrameUp is in free mode. AI features come back Monday.",
};
function freeModeNotice(reason) { return reason === 'user-limit' ? FREE_NOTES.user : FREE_NOTES.team; }
const aiModeStore = new AsyncLocalStorage();
// A Gateway budget reply switches the rest of that request to free mode. The
// next request tries the Gateway again (a refused call costs nothing), so AI
// comes back as soon as the budget does. The time of the last budget reply is
// kept so /api/ai-status can say 'gateway-budget' for a while.
const GATEWAY_BUDGET_RECENT_MS = 10 * 60 * 1000;
let gatewayBudgetAt = 0;
function gatewayBudgetRecent(now = Date.now()) { return gatewayBudgetAt > 0 && now - gatewayBudgetAt < GATEWAY_BUDGET_RECENT_MS; }
function noteFree(reason) {
  const store = aiModeStore.getStore();
  if (store && !store.free) store.free = reason;
}
function markGatewayBudget() {
  gatewayBudgetAt = Date.now();
  warnEvent('gateway-budget', {});
  noteFree('gateway-budget');
}
function freeModeReason() {
  return aiModeStore.getStore()?.free || null;
}
function inFreeMode() { return Boolean(freeModeReason()); }
function enterFreeMode(reason) { if (FREE_REASONS.includes(reason)) noteFree(reason); }
function freeModeError(reason) {
  return Object.assign(new Error(freeModeNotice(reason)), { status: 402, code: 'free-mode', reason, freeMode: true });
}
// A Gateway reply that means "the account's budget / credit is used up":
// 402 always; 429 / 403 only with budget words (a plain rate limit is not it).
function isGatewayBudgetReply(status, message = '') {
  const code = Number(status || 0);
  if (code === 402) return true;
  return (code === 429 || code === 403) && /budget|quota|credit|spend|billing|insufficient|exceeded your|payment/i.test(String(message || ''));
}
// The error a failed Gateway reply throws. A budget reply switches the rest of
// the request to free mode.
function gatewayError(status, message, fallback) {
  if (isGatewayBudgetReply(status, message)) {
    markGatewayBudget();
    return freeModeError('gateway-budget');
  }
  return Object.assign(new Error(message || fallback), { status });
}
// Throws before any fetch when the request is in free mode.
function assertAiMode() {
  const reason = freeModeReason();
  if (reason) throw freeModeError(reason);
}
// For handlers: true (and the request is now in free mode) when the gate's
// reason is a budget; false for anything else (switched off, unknown spend).
function freeModeGate(gate) {
  if (!gate?.free) return false;
  enterFreeMode(gate.free);
  return true;
}
function freeModeInfo(reason) {
  return { mode: 'free', reason, notice: freeModeNotice(reason), resetsAt: nextWeekStartUtc().toISOString() };
}
// Turns a handler reply into the free-mode shape. A 2xx reply keeps its body
// and gains { mode, reason, notice, resetsAt }. An AI-only reply that could not
// run (429 / 500 / 502 / 503) becomes 200 { ok: true, mode: 'free', skipped: true }.
// Old-style budget replies (reason weekly-limit / team-limit / budget) from
// paths that did not enter free mode are converted too.
const SKIPPABLE = new Set([429, 500, 502, 503]);
function annotateFree(result, store = {}) {
  if (!result || typeof result.body !== 'string' || !result.body) return result;
  let body;
  try { body = JSON.parse(result.body); } catch { return result; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return result;
  let reason = store.free || null;
  if (!reason) {
    if (body.reason === 'weekly-limit') reason = 'user-limit';
    else if (body.reason === 'team-limit') reason = 'team-limit';
    else if (body.reason === 'budget' && /week|budget is used up|AI budget/i.test(String(body.error || ''))) { reason = 'gateway-budget'; markGatewayBudget(); }
  }
  if (!reason) return result;
  const status = Number(result.statusCode || 200);
  let next;
  let statusCode = status;
  // A reply's own `mode` (e.g. es-generate 'direct') is kept as requestMode.
  const own = body.mode && body.mode !== 'free' ? { requestMode: body.mode } : {};
  if (status < 400) {
    next = { ...body, ...own, ok: body.ok !== false, ...freeModeInfo(reason) };
  } else if (SKIPPABLE.has(status)) {
    const { error, detail, ...rest } = body;
    next = { ...rest, ...own, ok: true, ...freeModeInfo(reason), skipped: true };
    statusCode = 200;
  } else {
    return result;
  }
  return { ...result, statusCode, headers: { ...(result.headers || {}), 'Cache-Control': 'no-store' }, body: JSON.stringify(next) };
}
// Wraps a Netlify-style handler: one free-mode store per request, reply annotated.
function withAiMode(handler) {
  const wrapped = async function aiModeHandler(event, context) {
    const store = { free: null };
    const result = await aiModeStore.run(store, () => handler(event, context));
    return annotateFree(result, store);
  };
  wrapped.inner = handler;
  return wrapped;
}

// Guard warnings ("spend could not be read", "cache hint rejected") go to the
// server log as one JSON line, at most once a minute per kind, and are counted
// for /api/ai-status.
const guardWarnings = {};
const warnedAt = {};
function warnEvent(kind, detail = {}) {
  guardWarnings[kind] = (guardWarnings[kind] || 0) + 1;
  const now = Date.now();
  if (warnedAt[kind] && now - warnedAt[kind] < 60000) return;
  warnedAt[kind] = now;
  console.warn(JSON.stringify({ event: 'ai-guard-warning', kind, count: guardWarnings[kind], failClosed: failClosed(), ...detail }));
}

// Saves one usage row. Never throws: tracking must not break the feature.
// The measurement columns (cache tokens, task, run id) come from migration
// 20261118120000_ai_guardrails.sql. Until it is applied PostgREST rejects them
// (PGRST204), so the row is re-sent without them and later rows skip them.
const EXTRA_USAGE_COLUMNS = ['cache_read_tokens', 'cache_write_tokens', 'task', 'run_id'];
const usageColumns = { extra: true };
async function logUsage(track, row) {
  if (!track?.token || !track?.email) return;
  const full = {
    user_email: track.email,
    feature: track.feature || 'other',
    ...(track.task ? { task: track.task } : {}),
    ...(track.runId ? { run_id: String(track.runId).slice(0, 80) } : {}),
    ...row,
  };
  const basic = Object.fromEntries(Object.entries(full).filter(([key]) => !EXTRA_USAGE_COLUMNS.includes(key)));
  const send = body => {
    const config = authConfig();
    return fetch(`${config.url}/rest/v1/${USAGE_TABLE}`, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${track.token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
  };
  try {
    const withExtra = usageColumns.extra && Object.keys(full).some(key => EXTRA_USAGE_COLUMNS.includes(key));
    const response = await send(withExtra ? full : basic);
    if (withExtra && response && response.status === 400) {
      const error = await response.json().catch(() => null);
      if (error?.code === 'PGRST204' || /column/i.test(String(error?.message || ''))) {
        usageColumns.extra = false;
        await send(basic);
      }
    }
  } catch { /* tracking is best effort */ }
}

// Per-person hourly cap on AI calls (all features), counted in the database so
// it holds across servers and cold starts. Uses the caller's own session and
// the frameup_my_ai_calls_last_hour() function. Fails open: if the count can't
// be read (function missing, timeout) the call goes ahead, so a database hiccup
// never blocks work. The weekly Gateway cap stays the hard limit.
const USER_HOURLY_CALL_LIMIT = Number(process.env.AI_USER_HOURLY_LIMIT || 120);
async function userOverHourlyLimit(token, limit = USER_HOURLY_CALL_LIMIT) {
  if (!token || !(limit > 0)) return false;
  try {
    const config = authConfig();
    const response = await fetch(`${config.url}/rest/v1/rpc/frameup_my_ai_calls_last_hour`, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) { warnEvent('hourly-count-unreadable', { why: `http-${response.status}` }); return false; }
    const count = Number(await response.json());
    return Number.isFinite(count) && count >= limit;
  } catch {
    warnEvent('hourly-count-unreadable', { why: 'network' });
    return false;
  }
}

// Per-person weekly $ cap on AI spend (all features). The week starts Monday
// 00:00 UTC, the same period the sidebar's "AI usage" card shows. Reads the
// caller's own spend with frameup_my_ai_spend(p_since) and the caller's own
// session. The cap is POLICY.userWeeklyUsd ($20); AI_USER_WEEKLY_LIMIT_USD
// can only lower it (see POLICY above).
//
// When spend can't be read (function missing, timeout) the call goes ahead and
// a warning event is logged ("fails open", right while testing).
// AI_FAIL_CLOSED=1 blocks instead (aiSpendGate, reason "limit-unknown").
const money = limit => (Number.isInteger(limit) ? String(limit) : Number(limit).toFixed(2));
function weeklyLimitMessage(limit = userWeeklyLimitUsd()) {
  return `You've reached this week's $${money(limit)} AI limit. It resets Monday.`;
}
function teamLimitMessage(limit = teamWeeklyLimitUsd()) {
  return `The team has used this week's $${money(limit)} AI budget, so AI features are paused until Monday. Everything else still works.`;
}
const LIMIT_UNKNOWN_MESSAGE = "AI spend can't be checked right now, so AI features are paused for a moment. Try again shortly.";
// Monday 00:00 UTC on or before `now`.
function weekStartUtc(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start;
}
// Next Monday 00:00 UTC: when this week's budgets reset.
function nextWeekStartUtc(now = new Date()) {
  const next = weekStartUtc(now);
  next.setUTCDate(next.getUTCDate() + 7);
  return next;
}
// Reads one spend RPC with the caller's session. Returns { total } or { unknown: why }.
async function readSpend(rpc, token) {
  try {
    const config = authConfig();
    const response = await fetch(`${config.url}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_since: weekStartUtc().toISOString() }),
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return { unknown: `http-${response.status}` };
    const data = await response.json();
    const row = Array.isArray(data) ? data[0] : data;
    const total = Number(row && typeof row === 'object' ? row.total_usd : row);
    if (row == null || (typeof row === 'object' && row.total_usd == null) || !Number.isFinite(total)) return { unknown: 'no-total' };
    return { total };
  } catch (error) {
    return { unknown: error?.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}
async function checkUserWeekly(token, limit = userWeeklyLimitUsd()) {
  if (!token || !(limit > 0)) return { over: false, unknown: false };
  const spend = await readSpend('frameup_my_ai_spend', token);
  if (spend.unknown) {
    warnEvent('user-spend-unreadable', { why: spend.unknown });
    return { over: false, unknown: true };
  }
  return { over: spend.total >= limit, unknown: false, total: spend.total };
}
// Team weekly $ cap (POLICY.teamWeeklyUsd, $45; AI_TEAM_WEEKLY_LIMIT_USD can lower it). Reads
// frameup_team_ai_spend(p_since), which returns only the team's total.
async function checkTeamWeekly(token, limit = teamWeeklyLimitUsd()) {
  if (!token || !(limit > 0)) return { over: false, unknown: false };
  const spend = await readSpend('frameup_team_ai_spend', token);
  if (spend.unknown) {
    warnEvent('team-spend-unreadable', { why: spend.unknown });
    return { over: false, unknown: true };
  }
  return { over: spend.total >= limit, unknown: false, total: spend.total };
}
// Kept for callers and tests: true when the person is at or over their cap
// (or, with AI_FAIL_CLOSED=1, when their spend can't be read).
async function userOverWeeklyLimit(token, limit = userWeeklyLimitUsd()) {
  const result = await checkUserWeekly(token, limit);
  return result.over || (result.unknown && failClosed());
}
async function teamOverWeeklyLimit(token, limit = teamWeeklyLimitUsd()) {
  const result = await checkTeamWeekly(token, limit);
  return result.over || (result.unknown && failClosed());
}
// One check for every AI handler, before any AI call: the feature's kill
// switch, the person's weekly cap and the team's weekly cap. Returns null when
// the call may go ahead, else { status, reason, error, free? } for a calm reply:
//   feature-off (503), weekly-limit (429, free 'user-limit'), team-limit (429,
//   free 'team-limit'), limit-unknown (503, AI_FAIL_CLOSED=1 only).
// A gate with `free` means "run the no-AI path": pass it to freeModeGate().
async function aiSpendGate(token, { feature } = {}) {
  if (feature && featureDisabled(feature)) return { status: 503, reason: 'feature-off', error: featureOffMessage(feature) };
  const [user, team] = await Promise.all([checkUserWeekly(token), checkTeamWeekly(token)]);
  // Crossing 50/80/100% of the team cap posts a Slack alert straight away
  // (once per threshold per week; needs SLACK_AI_ALERTS_WEBHOOK_URL).
  if (Number.isFinite(team.total)) await teamThresholdAlert({ total: team.total, limit: teamWeeklyLimitUsd(), weekStart: weekStartUtc().toISOString() });
  if (user.over) return { status: 429, reason: 'weekly-limit', free: 'user-limit', error: weeklyLimitMessage() };
  if (team.over) return { status: 429, reason: 'team-limit', free: 'team-limit', error: teamLimitMessage() };
  if ((user.unknown || team.unknown) && failClosed()) return { status: 503, reason: 'limit-unknown', error: LIMIT_UNKNOWN_MESSAGE };
  return null;
}

// Daily cron jobs have no user session. They read the team's week total with
// the service role (frameup_ai_budget_summary) and skip AI work at or over the
// team cap. Never throws; unreadable spend lets the job go ahead (its own
// per-run $ cap still holds) unless AI_FAIL_CLOSED=1.
async function cronSpendGate({ feature } = {}) {
  if (feature && featureDisabled(feature)) return { status: 503, reason: 'feature-off', error: featureOffMessage(feature) };
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const limit = teamWeeklyLimitUsd();
  let total = NaN;
  if (serviceKey) {
    try {
      const config = authConfig();
      const response = await fetch(`${config.url}/rest/v1/rpc/frameup_ai_budget_summary`, {
        method: 'POST',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_since: weekStartUtc().toISOString() }),
        signal: AbortSignal.timeout(2500),
      });
      if (response.ok) total = Number((await response.json())?.total_usd);
    } catch { /* unreadable */ }
  }
  if (!Number.isFinite(total)) {
    warnEvent('team-spend-unreadable', { why: serviceKey ? 'cron-read-failed' : 'cron-no-service-key' });
    return failClosed() ? { status: 503, reason: 'limit-unknown', error: LIMIT_UNKNOWN_MESSAGE } : null;
  }
  if (total >= limit) return { status: 429, reason: 'team-limit', free: 'team-limit', error: teamLimitMessage(limit), total };
  return null;
}

// /api/ai-status: this person's and the team's week, and the mode the next AI
// call would run in. Spend that can't be read is null (and does not switch to free).
async function aiBudgetStatus(token) {
  const userLimit = userWeeklyLimitUsd();
  const teamLimit = teamWeeklyLimitUsd();
  const [mine, team] = token
    ? await Promise.all([readSpend('frameup_my_ai_spend', token), readSpend('frameup_team_ai_spend', token)])
    : [{ unknown: 'no-session' }, { unknown: 'no-session' }];
  const userSpent = Number.isFinite(mine.total) ? Number(mine.total.toFixed(4)) : null;
  const teamSpent = Number.isFinite(team.total) ? Number(team.total.toFixed(4)) : null;
  let reason = null;
  if (userSpent != null && userSpent >= userLimit) reason = 'user-limit';
  else if (teamSpent != null && teamSpent >= teamLimit) reason = 'team-limit';
  else if (gatewayBudgetRecent()) reason = 'gateway-budget';
  return {
    mode: reason ? 'free' : 'ai',
    reason,
    notice: reason ? freeModeNotice(reason) : null,
    userLimitUsd: userLimit,
    userSpentUsd: userSpent,
    teamLimitUsd: teamLimit,
    teamSpentUsd: teamSpent,
    gatewayBudgetUsd: POLICY.gatewayWeeklyUsd,
    resetsAt: nextWeekStartUtc().toISOString(),
  };
}
// What the Dashboard and pages may know about the guardrails (no secrets).
function aiGuardConfig() {
  return {
    userWeeklyLimitUsd: userWeeklyLimitUsd(),
    teamWeeklyLimitUsd: teamWeeklyLimitUsd(),
    policy: { ...POLICY },
    envIgnored: envIgnored(),
    hourlyCallLimit: USER_HOURLY_CALL_LIMIT,
    disabled: disabledFeatures(),
    economy: economyMode(),
    failClosed: failClosed(),
    alertsConfigured: Boolean(process.env.SLACK_AI_ALERTS_WEBHOOK_URL),
    weekStart: weekStartUtc().toISOString(),
    warnings: { ...guardWarnings },
  };
}

// Backup providers (Groq, opt-in OpenAI) are called directly, not through the
// Gateway, so they log here instead. Tokens are recorded so the Dashboard counts
// every call; cost stays 0 while Groq is on its free tier (OpenAI is opt-in and
// not priced here). Rows use the feature name plus "-backup".
async function logBackupCall(track, { provider, model, ok, usage, started, error }) {
  if (!track) return;
  await logUsage(track, {
    feature: `${track.feature || 'other'}-backup`,
    model: `${provider}/${model}`,
    ok,
    input_tokens: usage?.prompt_tokens || 0,
    output_tokens: usage?.completion_tokens || 0,
    cost_usd: 0,
    duration_ms: Date.now() - started,
    ...(error ? { error: String(error).slice(0, 200) } : {}),
  });
}

// True when the Gateway refused because the key's spend cap (or credit) ran
// out, so callers can say so calmly instead of showing a raw error.
function isBudgetError(error) {
  if (error?.code === 'free-mode') return true;
  const status = Number(error?.status || 0);
  return status === 402 || /budget|spend|quota|credit|insufficient|spending limit|usage limit/i.test(String(error?.message || ''));
}

// 512 tokens is at least about 1,500 characters of English; under 1,024 characters it can't qualify.
const CACHE_MIN_CHARS = 1024;

async function anthropicCall({ model, system, messages, effort, maxTokens, timeoutMs, cacheSystem, allowCutoff = false }) {
  const send = cache => fetch(`${GATEWAY}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.AI_GATEWAY_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      output_config: { effort },
      // cacheSystem marks the (large, unchanging) system prompt as cacheable: cached
      // reads cost 10% of normal input and come back faster. Below the model's
      // minimum size the hint is simply ignored.
      ...(system ? { system: cache ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system } : {}),
      messages,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  // A prompt far below the 512-token cache minimum (Haiku / Sonnet / Opus 5.5)
  // would never cache, so the hint is not sent.
  const cacheable = Boolean(cacheSystem && system && String(system).length >= CACHE_MIN_CHARS);
  let response = await send(cacheable);
  // If the Gateway rejects the cache hint, retry once as a plain request and say
  // so in the log: otherwise caching looks on while every call is billed twice.
  if (cacheable && response.status === 400) {
    warnEvent('cache-hint-rejected', { model });
    response = await send(false);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw gatewayError(response.status, data?.error?.message, `AI request failed: ${response.status}`);
  // A refusal or a cut-off reply counts as a failure so the caller falls back.
  if (data?.stop_reason === 'refusal') throw new Error('The AI declined this request.');
  const truncated = data?.stop_reason === 'max_tokens';
  if (truncated && !allowCutoff) throw new Error('The AI reply was cut off.');
  const u = data?.usage || {};
  return {
    truncated,
    text: (data?.content || []).filter(block => block.type === 'text').map(block => block.text).join(''),
    usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 },
  };
}

async function openaiCall({ model, system, messages, json, maxTokens, timeoutMs }) {
  const response = await fetch(`${GATEWAY}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw gatewayError(response.status, data?.error?.message, `AI request failed: ${response.status}`);
  if (data?.choices?.[0]?.finish_reason === 'length') throw new Error('The AI reply was cut off.');
  const u = data?.usage || {};
  return {
    text: String(data?.choices?.[0]?.message?.content || ''),
    usage: { input: u.prompt_tokens || 0, output: u.completion_tokens || 0 },
  };
}

// tier: 'light' | 'main' | 'review' | 'best'. messages: [{ role: 'user' | 'assistant', content }].
// track: { feature, email, token } for spend tracking (optional).
// Returns { text, model, cost }. Throws on any failure.
// allowCutoff: return a reply cut off at maxTokens (truncated: true) instead of
// throwing, for callers that can use the complete part (e.g. a JSON list).
async function aiText({ tier = 'light', system, messages, json = false, effort = 'low', maxTokens = 4000, timeoutMs = 25000, track, cacheSystem = false, allowCutoff = false } = {}) {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error('AI_GATEWAY_API_KEY is not set.');
  if (trackDisabled(track)) throw featureOffError(track.feature || track.task);
  assertAiMode();
  const model = modelFor(tier, 'light');
  if (tier === 'image' || model === MODELS.image) throw new Error('Use aiImage for image models.');
  const started = Date.now();
  try {
    const call = model.startsWith('anthropic/') ? anthropicCall : openaiCall;
    const result = await call({ model, system, messages, json, effort, maxTokens, timeoutMs, cacheSystem, allowCutoff });
    if (!result.text.trim()) throw new Error('The AI returned an empty reply.');
    const cost = costUsd(model, result.usage);
    await logUsage(track, {
      model, ok: true,
      input_tokens: result.usage.input, output_tokens: result.usage.output,
      cache_read_tokens: result.usage.cacheRead || 0, cache_write_tokens: result.usage.cacheWrite || 0,
      cost_usd: Number(cost.toFixed(6)), duration_ms: Date.now() - started,
    });
    return { text: result.text, model, cost, usage: result.usage, truncated: Boolean(result.truncated) };
  } catch (error) {
    await logUsage(track, { model, ok: false, input_tokens: 0, output_tokens: 0, cost_usd: 0, duration_ms: Date.now() - started, error: String(error.message || error).slice(0, 200) });
    throw error;
  }
}

// Web research: Claude with the built-in web search tool (Video Ads uses it to
// find what happened in a trending moment and where its clips live). maxUses
// caps the searches (each costs about $0.01 on top of tokens). Returns
// { text, urls:[{url,title}], searches, model, cost }. Throws on failure.
// maxCostUsd (optional): a hard per-call cap. A paused search is only continued
// while the spend so far is under the cap and searches are left, so one call
// never runs past maxUses searches; the result carries capped: true when it
// stopped early. With the cap set, a reply with cited links but no text is
// returned (text '') instead of throwing.
// allowedDomains (optional): limits the search tool to those sites (Anthropic
// web_search `allowed_domains`), e.g. ['x.com', 'twitter.com'] for clip search.
const WEB_SEARCH_USD = 0.01;
async function aiWebResearch({ tier = 'main', system, prompt, maxUses = 4, maxTokens = 3000, timeoutMs = 45000, track, maxCostUsd, allowedDomains } = {}) {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error('AI_GATEWAY_API_KEY is not set.');
  if (trackDisabled(track)) throw featureOffError(track.feature || track.task);
  assertAiMode();
  const model = modelFor(tier, 'main');
  if (!model.startsWith('anthropic/')) throw new Error('Web research needs a Claude model.');
  const started = Date.now();
  const messages = [{ role: 'user', content: prompt }];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const texts = [];
  const urls = [];
  let searches = 0;
  let capped = false;
  const hasCap = Number.isFinite(maxCostUsd) && maxCostUsd > 0;
  try {
    // A long search can pause mid-turn; it is continued once.
    for (let round = 0; round < 2; round += 1) {
      const response = await fetch(`${GATEWAY}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.AI_GATEWAY_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          ...(system ? { system } : {}),
          messages,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses, ...(Array.isArray(allowedDomains) && allowedDomains.length ? { allowed_domains: allowedDomains } : {}) }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw gatewayError(response.status, data?.error?.message, `AI request failed: ${response.status}`);
      const u = data?.usage || {};
      usage.input += u.input_tokens || 0;
      usage.output += u.output_tokens || 0;
      usage.cacheRead += u.cache_read_input_tokens || 0;
      usage.cacheWrite += u.cache_creation_input_tokens || 0;
      searches += Number(u.server_tool_use?.web_search_requests || 0);
      (data?.content || []).forEach(block => {
        if (block.type === 'text' && block.text) texts.push(block.text);
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          block.content.forEach(item => { if (item?.url) urls.push({ url: item.url, title: String(item.title || '').slice(0, 200) }); });
        }
      });
      if (data?.stop_reason !== 'pause_turn') break;
      if (hasCap && (costUsd(model, usage) + searches * WEB_SEARCH_USD >= maxCostUsd || searches >= maxUses)) { capped = true; break; }
      messages.push({ role: 'assistant', content: data.content });
    }
    const text = texts.join('\n').trim();
    if (!text && !(hasCap && urls.length)) throw new Error('The research returned no answer.');
    const cost = costUsd(model, usage) + searches * WEB_SEARCH_USD;
    await logUsage(track, {
      model, ok: true,
      input_tokens: usage.input, output_tokens: usage.output,
      cache_read_tokens: usage.cacheRead, cache_write_tokens: usage.cacheWrite,
      cost_usd: Number(cost.toFixed(6)), duration_ms: Date.now() - started,
    });
    return { text, urls, searches, model, cost, ...(hasCap ? { capped } : {}) };
  } catch (error) {
    await logUsage(track, { model, ok: false, input_tokens: usage.input, output_tokens: usage.output, cost_usd: 0, duration_ms: Date.now() - started, error: String(error.message || error).slice(0, 200) });
    throw error;
  }
}

// Speech to text through the Gateway's transcription endpoint
// (vercel.com/docs/ai-gateway/modalities/speech-to-text, REST):
//   POST https://ai-gateway.vercel.sh/v4/ai/transcription-model
//   headers: Authorization: Bearer <key>, ai-gateway-protocol-version: 0.0.1,
//            ai-transcription-model-specification-version: 4, ai-model-id: <model>
//   body:    { audio: <base64>, mediaType, providerOptions? }
//   reply:   { text, segments: [{ text, startSecond, endSecond }], language,
//              durationInSeconds, warnings, providerMetadata }
// Word timing: ElevenLabs puts it in providerMetadata.elevenlabs.words
// ({ text, type, start, end }); whisper-1 gives it with
// providerOptions.openai.timestampGranularities ['word'].
// Returns { text, segments, words: [{ word, start, end }], language,
// durationInSeconds, model, cost }. Logged with the audio cost. Throws on failure.
const GATEWAY_TRANSCRIBE_URL = 'https://ai-gateway.vercel.sh/v4/ai/transcription-model';
function transcriptionWords(data) {
  const meta = data?.providerMetadata || {};
  const listed = [meta.elevenlabs?.words, meta.openai?.words, meta.azure?.words].find(list => Array.isArray(list) && list.length) || [];
  const words = listed
    .filter(item => !item.type || item.type === 'word')
    .map(item => ({ word: String(item.text ?? item.word ?? '').trim(), start: Number(item.start ?? item.startSecond) || 0, end: Number(item.end ?? item.endSecond) || 0 }))
    .filter(item => item.word);
  if (words.length) return words;
  // whisper-1 with word granularity comes back as one segment per word.
  const segments = Array.isArray(data?.segments) ? data.segments : [];
  if (segments.length && segments.every(seg => String(seg.text || '').trim().split(/\s+/).length <= 1)) {
    return segments.map(seg => ({ word: String(seg.text || '').trim(), start: Number(seg.startSecond) || 0, end: Number(seg.endSecond) || 0 })).filter(item => item.word);
  }
  return [];
}
async function aiTranscribe({ audio, mediaType = 'audio/wav', model = TRANSCRIPTION_MODEL, timeoutMs = 60000, track } = {}) {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error('AI_GATEWAY_API_KEY is not set.');
  if (trackDisabled(track)) throw featureOffError(track.feature || track.task);
  assertAiMode();
  const started = Date.now();
  const providerOptions = /^openai\/whisper/.test(model) ? { openai: { timestampGranularities: ['word', 'segment'] } } : undefined;
  try {
    const response = await fetch(GATEWAY_TRANSCRIBE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
        'ai-gateway-protocol-version': '0.0.1',
        'ai-transcription-model-specification-version': '4',
        'ai-model-id': model,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ audio, mediaType, ...(providerOptions ? { providerOptions } : {}) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw gatewayError(response.status, data?.error?.message || data?.message, `Transcription failed: ${response.status}`);
    const words = transcriptionWords(data);
    const segments = Array.isArray(data?.segments) ? data.segments : [];
    const lastEnd = Math.max(0, ...words.map(word => word.end), ...segments.map(seg => Number(seg.endSecond) || 0));
    const seconds = Number(data?.durationInSeconds) > 0 ? Number(data.durationInSeconds) : lastEnd;
    const cost = audioCostUsd(model, seconds);
    await logUsage(track, { model, ok: true, input_tokens: 0, output_tokens: 0, cost_usd: Number(cost.toFixed(6)), duration_ms: Date.now() - started });
    return { text: String(data?.text || ''), segments, words, language: data?.language || '', durationInSeconds: seconds, model, cost };
  } catch (error) {
    await logUsage(track, { model, ok: false, input_tokens: 0, output_tokens: 0, cost_usd: 0, duration_ms: Date.now() - started, error: String(error.message || error).slice(0, 200) });
    throw error;
  }
}

// Which speech-to-text providers Reels captions try, in order. Groq first
// (free), then the Gateway, then direct OpenAI. REELS_TRANSCRIBE=gateway|groq|openai
// moves one provider to the front; the others stay as fallbacks. Each step says
// whether its key is present (booleans only) and whether it is billed.
const TRANSCRIBE_PROVIDERS = ['groq', 'gateway', 'openai'];
function transcriptionPlan(env = process.env) {
  const steps = {
    groq: { provider: 'groq', model: env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo', keyPresent: Boolean(env.GROQ_API_KEY), billed: false },
    gateway: { provider: 'gateway', model: env.AI_TRANSCRIPTION_MODEL || TRANSCRIPTION_MODEL, keyPresent: Boolean(env.AI_GATEWAY_API_KEY) && String(env.GENERATE_AI || '').toLowerCase() !== 'rules', billed: true },
    openai: { provider: 'openai', model: env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-transcribe', keyPresent: Boolean(env.OPENAI_API_KEY), billed: true },
  };
  const prefer = String(env.REELS_TRANSCRIBE || '').trim().toLowerCase();
  const order = TRANSCRIBE_PROVIDERS.includes(prefer) ? [prefer, ...TRANSCRIBE_PROVIDERS.filter(name => name !== prefer)] : TRANSCRIBE_PROVIDERS;
  return order.map(name => ({ ...steps[name], perMinuteUsd: steps[name].billed ? (AUDIO_PRICES_PER_MIN[steps[name].model] ?? 0.006) : 0 }));
}

// One generated image (scenes and backgrounds only; callers write the prompt).
// Image-only models use /images/generations; Gemini image models answer
// through /chat/completions with modalities. Returns { dataUrl, model, cost }.
// Throws on any failure. Logged with images: 1.
async function aiImage({ prompt, model = MODELS.image, size = '1024x1280', timeoutMs = 45000, track } = {}) {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error('AI_GATEWAY_API_KEY is not set.');
  if (trackDisabled(track)) throw featureOffError(track.feature || track.task);
  assertAiMode();
  const started = Date.now();
  const headers = { 'content-type': 'application/json', Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}` };
  try {
    let dataUrl = '';
    if (model.startsWith('google/')) {
      const response = await fetch(`${GATEWAY}/chat/completions`, {
        method: 'POST', headers,
        body: JSON.stringify({ model, modalities: ['text', 'image'], messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw gatewayError(response.status, data?.error?.message, `Image request failed: ${response.status}`);
      dataUrl = String(data?.choices?.[0]?.message?.images?.[0]?.image_url?.url || '');
    } else {
      const response = await fetch(`${GATEWAY}/images/generations`, {
        method: 'POST', headers,
        body: JSON.stringify({ model, prompt, n: 1, size, response_format: 'b64_json', providerOptions: { blackForestLabs: { outputFormat: 'jpeg' } } }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw gatewayError(response.status, data?.error?.message, `Image request failed: ${response.status}`);
      const b64 = data?.data?.[0]?.b64_json;
      if (b64) dataUrl = `data:image/${b64.startsWith('/9j/') ? 'jpeg' : 'png'};base64,${b64}`;
    }
    if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(dataUrl)) throw new Error('The image model returned no image.');
    const cost = IMAGE_PRICES[model] ?? 0.07;
    await logUsage(track, { model, ok: true, input_tokens: 0, output_tokens: 0, images: 1, cost_usd: cost, duration_ms: Date.now() - started });
    return { dataUrl, model, cost };
  } catch (error) {
    await logUsage(track, { model, ok: false, input_tokens: 0, output_tokens: 0, images: 0, cost_usd: 0, duration_ms: Date.now() - started, error: String(error.message || error).slice(0, 200) });
    throw error;
  }
}

module.exports = {
  POLICY, parseUsd, policyLimit, userWeeklyLimitUsd, nextWeekStartUtc, cronSpendGate, aiBudgetStatus,
  withAiMode, annotateFree, freeModeGate, enterFreeMode, inFreeMode, freeModeReason, freeModeError, freeModeNotice, freeModeInfo,
  isGatewayBudgetReply, markGatewayBudget, gatewayBudgetRecent, FREE_REASONS, FREE_NOTES,
  _resetFreeMode() { gatewayBudgetAt = 0; },
  gatewayConfigured, aiText, aiImage, aiWebResearch, costUsd, audioCostUsd, isBudgetError, logBackupCall, logUsage,
  userOverHourlyLimit, userOverWeeklyLimit, teamOverWeeklyLimit, weeklyLimitMessage, teamLimitMessage, weekStartUtc,
  aiSpendGate, aiGuardConfig, featureDisabled, trackDisabled, featureOffMessage, featureOffError, modelFor, economyMode, failClosed, teamWeeklyLimitUsd, warnEvent,
  aiTranscribe, transcriptionPlan, transcriptionWords, TRANSCRIPTION_MODEL,
  MODELS, PRICES, IMAGE_PRICES, AUDIO_PRICES_PER_MIN, ECONOMY_ROUTES, CACHE_MIN_CHARS,
  // Kept for old callers: the per-person limit right now (read on every access).
  get USER_WEEKLY_LIMIT_USD() { return userWeeklyLimitUsd(); },
};
