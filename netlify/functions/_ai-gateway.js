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

const { authConfig } = require('./_supabase-auth.js');

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
};
// USD per generated image (Gateway list prices, 2026-11, ~1MP). Unknown models count at 0.07.
const IMAGE_PRICES = {
  'bfl/flux-3-image-klein': 0.011,
  'meta/muse-image-1.0': 0.01,
  'google/gemini-3.1-flash-lite-image': 0.034,
  'google/gemini-3.1-flash-image': 0.067,
};
// USD per 1M tokens (Gateway list prices, 2026-11). Unknown models count at main rates.
const PRICES = {
  'openai/gpt-oss-20b': { input: 0.03, output: 0.14 },
  'openai/gpt-6-luna': { input: 0.10, output: 0.50 },
  'anthropic/claude-haiku-5.5': { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 },
  'anthropic/claude-sonnet-5.5': { input: 2, output: 10, cacheRead: 0.20, cacheWrite: 2.5 },
  'anthropic/claude-opus-5.5': { input: 4, output: 20, cacheRead: 0.20, cacheWrite: 5 },
};
const USAGE_TABLE = 'frameup_ai_usage';

function gatewayConfigured() {
  return Boolean(process.env.AI_GATEWAY_API_KEY) && String(process.env.GENERATE_AI || '').toLowerCase() !== 'rules';
}

function costUsd(model, usage = {}) {
  const price = PRICES[model] || PRICES[MODELS.main] || { input: 0.10, output: 0.50 };
  const perToken = rate => (rate || 0) / 1e6;
  return (usage.input || 0) * perToken(price.input)
    + (usage.output || 0) * perToken(price.output)
    + (usage.cacheRead || 0) * perToken(price.cacheRead ?? price.input)
    + (usage.cacheWrite || 0) * perToken(price.cacheWrite ?? price.input);
}

// Saves one usage row. Never throws: tracking must not break the feature.
async function logUsage(track, row) {
  if (!track?.token || !track?.email) return;
  try {
    const config = authConfig();
    await fetch(`${config.url}/rest/v1/${USAGE_TABLE}`, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${track.token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ user_email: track.email, feature: track.feature || 'other', ...row }),
      signal: AbortSignal.timeout(3000),
    });
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
    if (!response.ok) return false;
    const count = Number(await response.json());
    return Number.isFinite(count) && count >= limit;
  } catch {
    return false;
  }
}

// Per-person weekly $ cap on AI spend (all features). The week starts Monday
// 00:00 UTC, the same period the sidebar's "AI usage" card shows. Reads the
// caller's own spend with frameup_my_ai_spend(p_since) and the caller's own
// session. Fails open like the hourly check: if the function is missing or the
// call fails, the request goes ahead. Set AI_USER_WEEKLY_LIMIT_USD to change
// the cap (0 turns it off).
const USER_WEEKLY_LIMIT_USD = Number(String(process.env.AI_USER_WEEKLY_LIMIT_USD ?? '').trim() || 20);
function weeklyLimitMessage(limit = USER_WEEKLY_LIMIT_USD) {
  const amount = Number.isInteger(limit) ? String(limit) : Number(limit).toFixed(2);
  return `You've reached this week's $${amount} AI limit. It resets Monday.`;
}
// Monday 00:00 UTC on or before `now`.
function weekStartUtc(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start;
}
async function userOverWeeklyLimit(token, limit = USER_WEEKLY_LIMIT_USD) {
  if (!token || !(limit > 0)) return false;
  try {
    const config = authConfig();
    const response = await fetch(`${config.url}/rest/v1/rpc/frameup_my_ai_spend`, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_since: weekStartUtc().toISOString() }),
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return false;
    const data = await response.json();
    const row = Array.isArray(data) ? data[0] : data;
    const total = Number(row?.total_usd);
    return Number.isFinite(total) && total >= limit;
  } catch {
    return false;
  }
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
  let response = await send(Boolean(cacheSystem && system));
  // If the Gateway rejects the cache hint, retry once as a plain request.
  if (cacheSystem && system && response.status === 400) response = await send(false);
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
  const model = MODELS[tier] || MODELS.light;
  if (model === MODELS.image) throw new Error('Use aiImage for image models.');
  const started = Date.now();
  try {
    const call = model.startsWith('anthropic/') ? anthropicCall : openaiCall;
    const result = await call({ model, system, messages, json, effort, maxTokens, timeoutMs, cacheSystem });
    if (!result.text.trim()) throw new Error('The AI returned an empty reply.');
    const cost = costUsd(model, result.usage);
    await logUsage(track, {
      model, ok: true,
      input_tokens: result.usage.input, output_tokens: result.usage.output,
      cost_usd: Number(cost.toFixed(6)), duration_ms: Date.now() - started,
    });
    return { text: result.text, model, cost };
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
const WEB_SEARCH_USD = 0.01;
async function aiWebResearch({ tier = 'main', system, prompt, maxUses = 4, maxTokens = 3000, timeoutMs = 45000, track, maxCostUsd } = {}) {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error('AI_GATEWAY_API_KEY is not set.');
  const model = MODELS[tier] || MODELS.main;
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
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }],
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
      cost_usd: Number(cost.toFixed(6)), duration_ms: Date.now() - started,
    });
    return { text, urls, searches, model, cost, ...(hasCap ? { capped } : {}) };
  } catch (error) {
    await logUsage(track, { model, ok: false, input_tokens: usage.input, output_tokens: usage.output, cost_usd: 0, duration_ms: Date.now() - started, error: String(error.message || error).slice(0, 200) });
    throw error;
  }
}

// One generated image (scenes and backgrounds only; callers write the prompt).
// Image-only models use /images/generations; Gemini image models answer
// through /chat/completions with modalities. Returns { dataUrl, model, cost }.
// Throws on any failure. Logged with images: 1.
async function aiImage({ prompt, model = MODELS.image, size = '1024x1280', timeoutMs = 45000, track } = {}) {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error('AI_GATEWAY_API_KEY is not set.');
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

module.exports = { gatewayConfigured, aiText, aiImage, aiWebResearch, costUsd, isBudgetError, logBackupCall, logUsage, userOverHourlyLimit, userOverWeeklyLimit, weeklyLimitMessage, weekStartUtc, MODELS, IMAGE_PRICES };
