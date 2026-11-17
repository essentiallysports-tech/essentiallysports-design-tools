'use strict';
// FrameUp AI through the Vercel AI Gateway: one key (AI_GATEWAY_API_KEY, set in
// Vercel / .env.local) for every AI feature. The key has a weekly spend cap
// set by the dev team; when it runs out the Gateway errors and callers fall
// back (Groq or rule-based drafts), so FrameUp keeps working.
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
//                  (AI_USER_WEEKLY_LIMIT_USD, AI_TEAM_WEEKLY_LIMIT_USD), fail open
//                  with a warning event, or closed with AI_FAIL_CLOSED=1.
//   AI_ECONOMY=1   routes the best (Sonnet) tier to main (Haiku).
//   aiText / aiWebResearch / aiImage refuse a switched-off feature before any fetch.

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

function gatewayConfigured() {
  return Boolean(process.env.AI_GATEWAY_API_KEY) && String(process.env.GENERATE_AI || '').toLowerCase() !== 'rules';
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
  ['reels-transcription', 'Automatic captions'],
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
const ECONOMY_ROUTES = { best: 'main' };
function economyMode() { return envFlag('AI_ECONOMY'); }
function modelFor(tier, fallback = 'light') {
  const routed = economyMode() && ECONOMY_ROUTES[tier] ? ECONOMY_ROUTES[tier] : tier;
  return MODELS[routed] || MODELS[fallback];
}
function failClosed() { return envFlag('AI_FAIL_CLOSED'); }
function teamWeeklyLimitUsd() {
  const value = Number(String(process.env.AI_TEAM_WEEKLY_LIMIT_USD ?? '').trim());
  return Number.isFinite(value) && value > 0 ? value : 0;
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
// session. AI_USER_WEEKLY_LIMIT_USD changes the cap ($20 by default, a testing
// value that may be raised; 0 turns it off; anything unreadable keeps $20).
//
// When spend can't be read (function missing, timeout) the call goes ahead and
// a warning event is logged ("fails open", right while testing).
// AI_FAIL_CLOSED=1 blocks instead (aiSpendGate, reason "limit-unknown").
const USER_WEEKLY_LIMIT_USD = (() => {
  const raw = String(process.env.AI_USER_WEEKLY_LIMIT_USD ?? '').trim();
  const value = Number(raw || 20);
  return Number.isFinite(value) && value >= 0 ? value : 20;
})();
const money = limit => (Number.isInteger(limit) ? String(limit) : Number(limit).toFixed(2));
function weeklyLimitMessage(limit = USER_WEEKLY_LIMIT_USD) {
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
async function checkUserWeekly(token, limit = USER_WEEKLY_LIMIT_USD) {
  if (!token || !(limit > 0)) return { over: false, unknown: false };
  const spend = await readSpend('frameup_my_ai_spend', token);
  if (spend.unknown) {
    warnEvent('user-spend-unreadable', { why: spend.unknown });
    return { over: false, unknown: true };
  }
  return { over: spend.total >= limit, unknown: false, total: spend.total };
}
// Team weekly $ cap (AI_TEAM_WEEKLY_LIMIT_USD; off when unset). Reads
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
async function userOverWeeklyLimit(token, limit = USER_WEEKLY_LIMIT_USD) {
  const result = await checkUserWeekly(token, limit);
  return result.over || (result.unknown && failClosed());
}
async function teamOverWeeklyLimit(token, limit = teamWeeklyLimitUsd()) {
  const result = await checkTeamWeekly(token, limit);
  return result.over || (result.unknown && failClosed());
}
// One check for every AI handler, before any AI call: the feature's kill
// switch, the person's weekly cap and the team's weekly cap. Returns null when
// the call may go ahead, else { status, reason, error } for a calm reply:
//   feature-off (503), weekly-limit (429), team-limit (429), limit-unknown (503, AI_FAIL_CLOSED=1 only).
async function aiSpendGate(token, { feature } = {}) {
  if (feature && featureDisabled(feature)) return { status: 503, reason: 'feature-off', error: featureOffMessage(feature) };
  const [user, team] = await Promise.all([checkUserWeekly(token), checkTeamWeekly(token)]);
  // Crossing 50/80/100% of the team cap posts a Slack alert straight away
  // (once per threshold per week; needs SLACK_AI_ALERTS_WEBHOOK_URL).
  if (Number.isFinite(team.total)) await teamThresholdAlert({ total: team.total, limit: teamWeeklyLimitUsd(), weekStart: weekStartUtc().toISOString() });
  if (user.over) return { status: 429, reason: 'weekly-limit', error: weeklyLimitMessage() };
  if (team.over) return { status: 429, reason: 'team-limit', error: teamLimitMessage() };
  if ((user.unknown || team.unknown) && failClosed()) return { status: 503, reason: 'limit-unknown', error: LIMIT_UNKNOWN_MESSAGE };
  return null;
}
// What the Dashboard and pages may know about the guardrails (no secrets).
function aiGuardConfig() {
  return {
    userWeeklyLimitUsd: USER_WEEKLY_LIMIT_USD,
    teamWeeklyLimitUsd: teamWeeklyLimitUsd(),
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
  const status = Number(error?.status || 0);
  return status === 402 || /budget|spend|quota|credit|insufficient|spending limit|usage limit/i.test(String(error?.message || ''));
}

// 512 tokens is at least about 1,500 characters of English; under 1,024 characters it can't qualify.
const CACHE_MIN_CHARS = 1024;

async function anthropicCall({ model, system, messages, effort, maxTokens, timeoutMs, cacheSystem }) {
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
  if (!response.ok) throw Object.assign(new Error(data?.error?.message || `AI request failed: ${response.status}`), { status: response.status });
  // A refusal or a cut-off reply counts as a failure so the caller falls back.
  if (data?.stop_reason === 'refusal') throw new Error('The AI declined this request.');
  if (data?.stop_reason === 'max_tokens') throw new Error('The AI reply was cut off.');
  const u = data?.usage || {};
  return {
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
  if (!response.ok) throw Object.assign(new Error(data?.error?.message || `AI request failed: ${response.status}`), { status: response.status });
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
async function aiText({ tier = 'light', system, messages, json = false, effort = 'low', maxTokens = 4000, timeoutMs = 25000, track, cacheSystem = false } = {}) {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error('AI_GATEWAY_API_KEY is not set.');
  if (trackDisabled(track)) throw featureOffError(track.feature || track.task);
  const model = modelFor(tier, 'light');
  if (tier === 'image' || model === MODELS.image) throw new Error('Use aiImage for image models.');
  const started = Date.now();
  try {
    const call = model.startsWith('anthropic/') ? anthropicCall : openaiCall;
    const result = await call({ model, system, messages, json, effort, maxTokens, timeoutMs, cacheSystem });
    if (!result.text.trim()) throw new Error('The AI returned an empty reply.');
    const cost = costUsd(model, result.usage);
    await logUsage(track, {
      model, ok: true,
      input_tokens: result.usage.input, output_tokens: result.usage.output,
      cache_read_tokens: result.usage.cacheRead || 0, cache_write_tokens: result.usage.cacheWrite || 0,
      cost_usd: Number(cost.toFixed(6)), duration_ms: Date.now() - started,
    });
    return { text: result.text, model, cost, usage: result.usage };
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
      if (!response.ok) throw Object.assign(new Error(data?.error?.message || `AI request failed: ${response.status}`), { status: response.status });
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
    if (!response.ok) throw Object.assign(new Error(data?.error?.message || data?.message || `Transcription failed: ${response.status}`), { status: response.status });
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
      if (!response.ok) throw Object.assign(new Error(data?.error?.message || `Image request failed: ${response.status}`), { status: response.status });
      dataUrl = String(data?.choices?.[0]?.message?.images?.[0]?.image_url?.url || '');
    } else {
      const response = await fetch(`${GATEWAY}/images/generations`, {
        method: 'POST', headers,
        body: JSON.stringify({ model, prompt, n: 1, size, response_format: 'b64_json', providerOptions: { blackForestLabs: { outputFormat: 'jpeg' } } }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw Object.assign(new Error(data?.error?.message || `Image request failed: ${response.status}`), { status: response.status });
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
  gatewayConfigured, aiText, aiImage, aiWebResearch, costUsd, audioCostUsd, isBudgetError, logBackupCall, logUsage,
  userOverHourlyLimit, userOverWeeklyLimit, teamOverWeeklyLimit, weeklyLimitMessage, teamLimitMessage, weekStartUtc,
  aiSpendGate, aiGuardConfig, featureDisabled, trackDisabled, featureOffMessage, featureOffError, modelFor, economyMode, failClosed, teamWeeklyLimitUsd, warnEvent,
  aiTranscribe, transcriptionPlan, transcriptionWords, TRANSCRIPTION_MODEL,
  MODELS, PRICES, IMAGE_PRICES, AUDIO_PRICES_PER_MIN, ECONOMY_ROUTES, CACHE_MIN_CHARS, USER_WEEKLY_LIMIT_USD,
};
