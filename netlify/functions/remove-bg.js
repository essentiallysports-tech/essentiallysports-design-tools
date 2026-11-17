// FrameUp editor: "Remove background" for a photo in the design (player
// cut-outs). Only when a signed-in ES person clicks for it.
//
// Providers (REMOVE_BG_PROVIDER):
//   openai  (default) OpenAI Images "edit" with a transparent background,
//           called directly with the OPENAI_API_KEY the repo already uses for
//           Reels transcription. Model REMOVE_BG_MODEL, default
//           gpt-image-1-mini (OpenAI's cheapest image model).
//   gateway the same request through the Vercel AI Gateway
//           (AI_GATEWAY_API_KEY, model "openai/<model>"). Opt-in only: the
//           Gateway's OpenAI image-edit route isn't documented for
//           transparent output, so it is never picked automatically.
//   bria    Bria RMBG 2.0 (BRIA_API_KEY), kept as an option.
//
// IMPORTANT: a generative model redraws pixels, so its picture of a real
// athlete may not be faithful. The editor never shows it: it only takes the
// returned image's ALPHA as a mask and applies that mask to the ORIGINAL
// photo, after checking the mask lines up (frameup-cutout.js).
//
// The editor pads the photo to the model's size itself (so the mask maps
// back exactly) and sends that padded JPEG plus the size it chose.
//
// Off when the chosen provider's key is missing: GET says
// { configured: false, envVar } and POST answers 503 "off".
//
// Env: REMOVE_BG_PROVIDER, REMOVE_BG_MODEL, REMOVE_BG_QUALITY (low|medium|high,
// default low), REMOVE_BG_HOURLY_LIMIT (default 30), OPENAI_API_KEY,
// AI_GATEWAY_API_KEY, BRIA_API_KEY, BRIA_REMOVE_BG_URL, REMOVE_BG_COST_USD
// (Bria only, default 0.018).
// Every call is logged to frameup_ai_usage (feature "remove-bg", real model,
// cost from the response's token usage) and counts toward the shared
// per-person hourly and weekly AI caps.
const { verifyEsUser } = require('./_supabase-auth.js');
const { logUsage, userOverHourlyLimit, userOverWeeklyLimit, weeklyLimitMessage } = require('./_ai-gateway.js');

const OPENAI_EDITS = 'https://api.openai.com/v1/images/edits';
const GATEWAY_EDITS = 'https://ai-gateway.vercel.sh/v1/images/edits';
const BRIA_ENDPOINT = 'https://engine.prod.bria-api.com/v2/image/edit/remove_background';
const DEFAULT_MODEL = 'gpt-image-1-mini';
const MAX_BYTES = 6 * 1024 * 1024;
// Vercel caps a function response at about 4.5 MB.
const MAX_RESULT_BASE64 = 4 * 1024 * 1024;
const SIZES = new Set(['1024x1024', '1024x1536', '1536x1024']);
const PROMPT = [
  'Remove the background from this photo and make it fully transparent.',
  'Keep the main subject (the person or object in front) exactly where it is, at exactly the same size and shape.',
  'Do not move, crop, resize, redraw or add anything. Grey padding at the edges is background too.',
].join(' ');

// USD per 1M tokens (OpenAI list prices, 2026-11): text in, image in, image out.
const TOKEN_PRICES = {
  'gpt-image-1-mini': { text: 2, image: 2.5, output: 8 },
  'gpt-image-1': { text: 5, image: 10, output: 40 },
  'gpt-image-1.5': { text: 5, image: 8, output: 32 },
  'gpt-image-2': { text: 5, image: 8, output: 30 },
};
// Documented per-image estimates (1024x1024), used only when usage is missing.
const IMAGE_PRICES = {
  'gpt-image-1-mini': { low: 0.005, medium: 0.011, high: 0.036 },
  'gpt-image-1': { low: 0.011, medium: 0.042, high: 0.167 },
};

const recent = new Map();

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function provider(env = process.env) {
  const chosen = String(env.REMOVE_BG_PROVIDER || '').trim().toLowerCase();
  return ['openai', 'gateway', 'bria'].includes(chosen) ? chosen : 'openai';
}

const ENV_VARS = { openai: 'OPENAI_API_KEY', gateway: 'AI_GATEWAY_API_KEY', bria: 'BRIA_API_KEY' };

function envVar(env = process.env) {
  return ENV_VARS[provider(env)];
}

function configured(env = process.env) {
  return Boolean(String(env[envVar(env)] || '').trim());
}

function model(env = process.env) {
  if (provider(env) === 'bria') return 'bria/rmbg-2.0';
  const name = String(env.REMOVE_BG_MODEL || DEFAULT_MODEL).trim().replace(/^openai\//, '');
  return /^[a-z0-9.-]+$/i.test(name) ? name : DEFAULT_MODEL;
}

function quality(env = process.env) {
  const value = String(env.REMOVE_BG_QUALITY || 'low').toLowerCase();
  return ['low', 'medium', 'high'].includes(value) ? value : 'low';
}

function hourlyLimit(env = process.env) {
  const value = Number(env.REMOVE_BG_HOURLY_LIMIT);
  return Number.isFinite(value) && value > 0 ? value : 30;
}

function briaCost(env = process.env) {
  const value = Number(env.REMOVE_BG_COST_USD);
  return Number.isFinite(value) && value >= 0 ? value : 0.018;
}

// Real cost from the response's token usage; the documented per-image price
// when usage is missing.
function openAiCost(modelName, usage, qualityName = 'low') {
  const prices = TOKEN_PRICES[modelName] || TOKEN_PRICES[DEFAULT_MODEL];
  if (usage && Number.isFinite(Number(usage.output_tokens))) {
    const details = usage.input_tokens_details || {};
    const imageIn = Number(details.image_tokens) || 0;
    const textIn = Number.isFinite(Number(details.text_tokens)) ? Number(details.text_tokens) : Math.max(0, (Number(usage.input_tokens) || 0) - imageIn);
    const cost = (textIn * prices.text + imageIn * prices.image + Number(usage.output_tokens) * prices.output) / 1e6;
    return Math.round(cost * 1e6) / 1e6;
  }
  const table = IMAGE_PRICES[modelName] || IMAGE_PRICES[DEFAULT_MODEL];
  return table[qualityName] ?? table.low;
}

function underLimit(email, limit, now = Date.now()) {
  const times = (recent.get(email) || []).filter(at => now - at < 3600e3);
  if (times.length >= limit) {
    recent.set(email, times);
    return false;
  }
  times.push(now);
  recent.set(email, times);
  return true;
}

// Accepts a data URL (PNG, JPEG or WebP) and checks the bytes really are one.
function parseImage(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!match) return { error: 'Send a PNG, JPG or WebP image.' };
  const base64 = match[2].replace(/\s+/g, '');
  if (Math.floor(base64.length * 3 / 4) > MAX_BYTES + 3) return { error: 'That image is over 6 MB. Use a smaller one.', tooLarge: true };
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) return { error: 'The image is empty.' };
  if (bytes.length > MAX_BYTES) return { error: 'That image is over 6 MB. Use a smaller one.', tooLarge: true };
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
  const isWebp = bytes.slice(0, 4).toString('latin1') === 'RIFF' && bytes.slice(8, 12).toString('latin1') === 'WEBP';
  if (!isPng && !isJpeg && !isWebp) return { error: 'That file is not a PNG, JPG or WebP image.' };
  const mime = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : 'image/webp';
  return { mime, base64, bytes };
}

// ─── OpenAI (direct or through the Gateway) ─────────────────────────────
async function callOpenAi(image, size, env = process.env) {
  const via = provider(env);
  const name = model(env);
  const form = new FormData();
  form.append('model', via === 'gateway' ? `openai/${name}` : name);
  form.append('prompt', PROMPT);
  form.append('image', new Blob([image.bytes], { type: image.mime }), `photo.${image.mime.split('/')[1]}`);
  form.append('background', 'transparent');
  // WebP keeps the alpha channel and is far smaller than PNG, so the answer
  // stays under Vercel's response limit. Only the alpha is used anyway.
  form.append('output_format', 'webp');
  form.append('output_compression', '90');
  form.append('quality', quality(env));
  form.append('size', size);
  form.append('n', '1');
  const response = await fetch(via === 'gateway' ? GATEWAY_EDITS : OPENAI_EDITS, {
    method: 'POST',
    headers: { Authorization: `Bearer ${String(env[envVar(env)]).trim()}` },
    body: form,
    signal: AbortSignal.timeout(55000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Image edit ${response.status}`);
    error.status = response.status;
    error.moderation = /safety|moderation|content policy/i.test(String(payload?.error?.message || payload?.error?.code || ''));
    throw error;
  }
  const b64 = payload?.data?.[0]?.b64_json;
  if (!b64) throw new Error('The image model returned no image.');
  if (b64.length > MAX_RESULT_BASE64) throw new Error('The cut-out came back too large.');
  const format = String(payload?.output_format || 'webp').toLowerCase();
  return {
    dataUrl: `data:image/${['png', 'webp'].includes(format) ? format : 'webp'};base64,${b64}`,
    cost: openAiCost(name, payload?.usage, quality(env)),
    model: `openai/${name}`,
    usage: payload?.usage || null,
  };
}

// ─── Bria (optional) ────────────────────────────────────────────────────
function resultUrl(payload) {
  const url = payload?.result?.image_url || payload?.result_url || payload?.image_url || '';
  return /^https:\/\//i.test(url) ? url : '';
}

async function callBria(image, env = process.env) {
  const response = await fetch(String(env.BRIA_REMOVE_BG_URL || BRIA_ENDPOINT), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', api_token: String(env.BRIA_API_KEY).trim() },
    body: JSON.stringify({ image: image.base64, sync: true }),
    signal: AbortSignal.timeout(45000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(`Bria ${response.status}`), { status: response.status });
  const url = resultUrl(payload);
  if (!url) throw new Error('Bria returned no image.');
  const result = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!result.ok) throw new Error(`Result ${result.status}`);
  const bytes = Buffer.from(await result.arrayBuffer());
  const base64 = bytes.toString('base64');
  if (base64.length > MAX_RESULT_BASE64) throw new Error('The cut-out came back too large.');
  const type = (result.headers.get('content-type') || 'image/png').split(';')[0];
  return { dataUrl: `data:${type};base64,${base64}`, cost: briaCost(env), model: 'bria/rmbg-2.0', usage: null };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { error: auth.error });
  if (event.httpMethod === 'GET') {
    return json(200, { configured: configured(), provider: provider(), envVar: envVar(), model: model(), maxBytes: MAX_BYTES, sizes: [...SIZES] });
  }
  if (!configured()) {
    return json(503, { error: 'Remove background is not set up yet.', reason: 'off', envVar: envVar() });
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { error: 'Bad request.' });
  }
  const image = parseImage(body.image);
  if (image.error) return json(image.tooLarge ? 413 : 400, { error: image.error });
  const size = SIZES.has(body.size) ? body.size : '1024x1024';

  const email = auth.user?.email || 'unknown';
  const token = String(event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
  if (await userOverWeeklyLimit(token)) return json(429, { error: weeklyLimitMessage(), reason: 'weekly-limit' });
  if (!underLimit(email, hourlyLimit()) || await userOverHourlyLimit(token)) {
    return json(429, { error: 'That is a lot of background removals this hour. Try again later.', reason: 'limit' });
  }

  const track = { feature: 'remove-bg', email, token };
  const started = Date.now();
  const via = provider();
  const loggedModel = via === 'bria' ? 'bria/rmbg-2.0' : `openai/${model()}`;
  try {
    const result = via === 'bria' ? await callBria(image) : await callOpenAi(image, size);
    await logUsage(track, {
      model: result.model,
      ok: true,
      input_tokens: Number(result.usage?.input_tokens) || 0,
      output_tokens: Number(result.usage?.output_tokens) || 0,
      images: 1,
      cost_usd: result.cost,
      duration_ms: Date.now() - started,
    });
    // maskOnly: the editor uses only the alpha of this image, on the original photo.
    return json(200, { ok: true, dataUrl: result.dataUrl, maskOnly: true, provider: via, model: result.model, size });
  } catch (error) {
    await logUsage(track, { model: loggedModel, ok: false, input_tokens: 0, output_tokens: 0, images: 0, cost_usd: 0, duration_ms: Date.now() - started, error: String(error.message || error).slice(0, 200) });
    console.error('remove-bg failed:', error.message || error);
    if (error.moderation) return json(422, { error: 'This photo couldn’t be processed by the cut-out model.', reason: 'moderation' });
    return json(502, { error: 'The background could not be removed. Try again in a moment.' });
  }
};

exports._test = { provider, envVar, configured, model, quality, hourlyLimit, briaCost, openAiCost, underLimit, parseImage, resultUrl, recent, MAX_BYTES, OPENAI_EDITS, GATEWAY_EDITS, BRIA_ENDPOINT, DEFAULT_MODEL, PROMPT };
