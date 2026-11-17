// FrameUp editor: "Remove background" for a photo in the design (player
// cut-outs). Sends the image to Bria RMBG 2.0 (trained on licensed data,
// cleared for commercial use; about $0.018 per image) and returns a
// transparent PNG. Only when a signed-in ES person clicks for it.
//
// Off unless BRIA_API_KEY is set: GET says { configured: false } and POST
// answers 503 with reason "off", so the editor can explain politely.
//
// Env:
//   BRIA_API_KEY            required to switch it on (Bria "api_token")
//   BRIA_REMOVE_BG_URL      optional endpoint override (default: Bria v2 sync)
//   REMOVE_BG_HOURLY_LIMIT  optional per-person cap per warm server (default 30)
//   REMOVE_BG_COST_USD      optional cost logged per image (default 0.018)
// Every call is logged to frameup_ai_usage (feature "remove-bg") and counts
// toward the shared per-person hourly and weekly AI caps.
const { verifyEsUser } = require('./_supabase-auth.js');
const { logUsage, userOverHourlyLimit, userOverWeeklyLimit, weeklyLimitMessage } = require('./_ai-gateway.js');

const DEFAULT_ENDPOINT = 'https://engine.prod.bria-api.com/v2/image/edit/remove_background';
const MAX_BYTES = 6 * 1024 * 1024;
// Vercel caps a function response at about 4.5 MB; base64 adds a third.
const MAX_INLINE_RESULT_BYTES = 3 * 1024 * 1024;
const MODEL = 'bria/rmbg-2.0';
const recent = new Map();

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function configured(env = process.env) {
  return Boolean(String(env.BRIA_API_KEY || '').trim());
}

function hourlyLimit(env = process.env) {
  const value = Number(env.REMOVE_BG_HOURLY_LIMIT);
  return Number.isFinite(value) && value > 0 ? value : 30;
}

function costPerImage(env = process.env) {
  const value = Number(env.REMOVE_BG_COST_USD);
  return Number.isFinite(value) && value >= 0 ? value : 0.018;
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
  // Size check before decoding: 4 base64 characters carry 3 bytes.
  if (Math.floor(base64.length * 3 / 4) > MAX_BYTES + 3) return { error: 'That image is over 6 MB. Use a smaller one.', tooLarge: true };
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) return { error: 'The image is empty.' };
  if (bytes.length > MAX_BYTES) return { error: 'That image is over 6 MB. Use a smaller one.', tooLarge: true };
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
  const isWebp = bytes.slice(0, 4).toString('latin1') === 'RIFF' && bytes.slice(8, 12).toString('latin1') === 'WEBP';
  if (!isPng && !isJpeg && !isWebp) return { error: 'That file is not a PNG, JPG or WebP image.' };
  return { mime: match[1], base64, bytes };
}

// Bria answers { result: { image_url } } (v2) or { result_url } (v1).
function resultUrl(payload) {
  const url = payload?.result?.image_url || payload?.result_url || payload?.image_url || '';
  return /^https:\/\//i.test(url) ? url : '';
}

async function callBria(image, env = process.env) {
  const endpoint = String(env.BRIA_REMOVE_BG_URL || DEFAULT_ENDPOINT);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', api_token: String(env.BRIA_API_KEY).trim() },
    body: JSON.stringify({ image: image.base64, sync: true }),
    signal: AbortSignal.timeout(45000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`Bria ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const url = resultUrl(payload);
  if (!url) throw new Error('Bria returned no image.');
  return url;
}

async function fetchResult(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Result ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, type: response.headers.get('content-type') || 'image/png' };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { error: auth.error });
  if (event.httpMethod === 'GET') return json(200, { configured: configured(), maxBytes: MAX_BYTES });
  if (!configured()) {
    return json(503, { error: 'Remove background is not set up yet.', reason: 'off' });
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { error: 'Bad request.' });
  }
  const image = parseImage(body.image);
  if (image.error) return json(image.tooLarge ? 413 : 400, { error: image.error });

  const email = auth.user?.email || 'unknown';
  const token = String(event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
  if (await userOverWeeklyLimit(token)) return json(429, { error: weeklyLimitMessage(), reason: 'weekly-limit' });
  if (!underLimit(email, hourlyLimit()) || await userOverHourlyLimit(token)) {
    return json(429, { error: 'That is a lot of background removals this hour. Try again later.', reason: 'limit' });
  }

  const track = { feature: 'remove-bg', email, token };
  const started = Date.now();
  try {
    const url = await callBria(image);
    const result = await fetchResult(url);
    await logUsage(track, { model: MODEL, ok: true, input_tokens: 0, output_tokens: 0, images: 1, cost_usd: costPerImage(), duration_ms: Date.now() - started });
    if (result.bytes.length > MAX_INLINE_RESULT_BYTES) return json(200, { ok: true, url });
    return json(200, { ok: true, dataUrl: `data:${result.type.split(';')[0]};base64,${result.bytes.toString('base64')}` });
  } catch (error) {
    await logUsage(track, { model: MODEL, ok: false, input_tokens: 0, output_tokens: 0, images: 0, cost_usd: 0, duration_ms: Date.now() - started, error: String(error.message || error).slice(0, 200) });
    console.error('remove-bg failed:', error.message || error);
    return json(502, { error: 'The background could not be removed. Try again in a moment.' });
  }
};

exports._test = { configured, hourlyLimit, costPerImage, underLimit, parseImage, resultUrl, recent, MAX_BYTES, DEFAULT_ENDPOINT };
