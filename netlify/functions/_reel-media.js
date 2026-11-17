'use strict';
// Reels Studio media made by AI, for the fill chain's last resorts only:
//
//   scene      one AI scene still (stadium, crowd, field, ball, trophy,
//              skyline, locker, scoreboard) through aiImage (default
//              bfl/flux-3-image-klein, about $0.011). Fill-chain step 3.
//   clipStart  one AI b-roll clip (4 s, 9:16, 720p, no audio) as an async
//   clipStatus Gateway job. google/veo-3.1-lite-generate-001 at $0.03/s, so
//              $0.12 a clip (cheapest good model on /v1/models, 2026-11-18:
//              Veo 3.1 Lite 720p $0.03/s; Seedance v1 Pro Fast $0.02/s at
//              720p but lower quality; Kling 2.5 Turbo $0.042/s; Wan 2.6
//              Flash $0.05/s). Off unless REELS_AI_CLIPS=gateway; at most
//              REELS_AI_CLIPS_MAX (default 2) per reel.
//
// Prompts come ONLY from ReelFormats.scenePrompt (a closed list of scenes,
// the sport and colour words): no names, players, logos, jerseys or text can
// reach a model. Both are cached by prompt (scene stills for 6 h, finished
// clips for 2 h), logged with logUsage (reels-scene, reels-ai-clip) and carry
// an "AI-generated" rights record.
//
// Video wire format (from @ai-sdk/gateway 4.0.146 GatewayVideoModel, the SDK
// the Gateway docs use; there is no raw-HTTP page for it yet):
//   POST https://ai-gateway.vercel.sh/v4/ai/video-model/start
//        headers ai-gateway-protocol-version 0.0.1, ai-video-model-specification-version 4, ai-model-id
//        body { prompt, n: 1, aspectRatio: '9:16', resolution, duration, generateAudio: false }
//        -> { operation, warnings, providerMetadata }
//   POST https://ai-gateway.vercel.sh/v4/ai/video-model/status   body { operation }
//        -> { status: pending | completed | error | cancelled, videos: [{ type: 'url', url, mediaType } | { type: 'base64', data, mediaType }] }
// The page polls clipStatus every few seconds (each request is short, inside
// Vercel's limits). A hosted URL goes straight to the browser; inline bytes
// are returned only under 3.4 MB of base64 (Vercel's 4.5 MB response cap),
// otherwise the page falls back to the AI scene still with a slow push-in.
const crypto = require('node:crypto');
const F = require('../../reel-formats.js');
const gateway = () => require('./_ai-gateway.js');

const VIDEO_BASE = 'https://ai-gateway.vercel.sh/v4/ai/video-model';
const VIDEO_MODEL = 'google/veo-3.1-lite-generate-001';
const VIDEO_PRICE_PER_SECOND = { 'google/veo-3.1-lite-generate-001': 0.03, 'bytedance/seedance-v1.0-pro-fast': 0.0206, 'klingai/kling-v2.5-turbo-t2v': 0.042 };
const CLIP_SECONDS = 4;
const MAX_INLINE_B64 = 3.4 * 1024 * 1024;
const SCENE_TTL = 6 * 3600e3;
const CLIP_TTL = 2 * 3600e3;
const SCENES = new Map();
const CLIPS = new Map(); // prompt hash -> finished clip; operation -> prompt hash
const JOBS = new Map();

const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 32);
const AI_RIGHTS = model => ({ source: `AI-generated (${model} via Vercel AI Gateway)`, licence: 'AI-generated scene with no real people, logos or text; label it as AI-made where the platform asks', organic: true, paid: true, ai: true });

function clipsStatus(env = process.env) {
  const on = String(env.REELS_AI_CLIPS || '').trim().toLowerCase() === 'gateway' && Boolean(env.AI_GATEWAY_API_KEY);
  const max = Math.max(0, Math.min(6, Number.parseInt(env.REELS_AI_CLIPS_MAX || '2', 10) || 0));
  const model = String(env.REELS_AI_CLIP_MODEL || VIDEO_MODEL).trim();
  return { ready: on && max > 0, model, max, seconds: CLIP_SECONDS, perClip: Number(((VIDEO_PRICE_PER_SECOND[model] || 0.05) * CLIP_SECONDS).toFixed(4)), reason: on ? '' : 'AI b-roll clips are off (REELS_AI_CLIPS=gateway turns them on).' };
}

// ─── Scene still ──────────────────────────────────────────────────────────
async function scene({ scene: name = 'stadium', sport = '', colors = [], track = null } = {}) {
  const { scene: s, prompt } = F.scenePrompt({ scene: name, sport, colors });
  const key = hash(prompt);
  const hit = SCENES.get(key);
  if (hit && Date.now() - hit.at < SCENE_TTL) return { ...hit.value, cached: true, cost: 0 };
  const api = gateway();
  if (!api.gatewayConfigured()) return { ok: false, reason: 'off', error: 'AI scenes need the AI Gateway.' };
  try {
    const out = await api.aiImage({ prompt, size: '768x1344', track: track ? { ...track, feature: 'reels-scene' } : undefined });
    const value = { ok: true, scene: s, dataUrl: out.dataUrl, model: out.model, cost: out.cost, rights: AI_RIGHTS(out.model) };
    SCENES.set(key, { at: Date.now(), value });
    if (SCENES.size > 40) SCENES.delete(SCENES.keys().next().value);
    return { ...value, cached: false };
  } catch (error) {
    const budget = api.isBudgetError(error);
    return { ok: false, reason: budget ? 'budget' : 'error', error: budget ? "This week's AI budget is used up." : 'The AI scene could not be made right now.' };
  }
}

// ─── AI b-roll clip (async job) ───────────────────────────────────────────
const videoHeaders = (env, model) => ({
  Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
  'ai-gateway-protocol-version': '0.0.1',
  'ai-video-model-specification-version': '4',
  'ai-model-id': model,
  'Content-Type': 'application/json',
});
async function postJson(url, init) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const message = data && data.error ? (data.error.message || data.error) : `Request failed: ${response.status}`;
    throw Object.assign(new Error(String(message)), { status: response.status });
  }
  return data;
}
// used: how many AI clips this reel already has (the page sends it; the cap
// is enforced here too).
async function clipStart({ scene: name = 'stadium', sport = '', colors = [], used = 0, track = null, env = process.env } = {}) {
  const status = clipsStatus(env);
  if (!status.ready) return { ok: false, reason: 'off', error: status.reason };
  if (Number(used) >= status.max) return { ok: false, reason: 'cap', error: `This reel already has ${status.max} AI clips (the cap).` };
  const { scene: s, prompt } = F.scenePrompt({ scene: name, sport, colors, motion: true });
  const key = hash(`${status.model}|${prompt}`);
  const done = CLIPS.get(key);
  if (done && Date.now() - done.at < CLIP_TTL) return { ...done.value, cached: true, cost: 0, status: 'completed' };
  const started = Date.now();
  try {
    const data = await postJson(`${VIDEO_BASE}/start`, {
      method: 'POST',
      headers: { ...videoHeaders(env, status.model), 'idempotency-key': `reels-${key}` },
      body: JSON.stringify({ prompt, n: 1, aspectRatio: '9:16', resolution: '720x1280', duration: CLIP_SECONDS, generateAudio: false }),
      signal: AbortSignal.timeout(20000),
    });
    if (data.operation == null) {
      console.warn('reels ai-clip: start reply had no operation; keys:', Object.keys(data).join(','));
      throw new Error('The video model did not accept the job.');
    }
    const cost = Number((status.perClip).toFixed(4));
    // Billed when the job starts: logged once here.
    await gateway().logUsage(track, { feature: 'reels-ai-clip', model: status.model, ok: true, input_tokens: 0, output_tokens: 0, cost_usd: cost, duration_ms: Date.now() - started });
    const job = hash(JSON.stringify(data.operation));
    JOBS.set(job, { operation: data.operation, key, model: status.model, scene: s, at: Date.now() });
    if (JOBS.size > 60) JOBS.delete(JOBS.keys().next().value);
    return { ok: true, status: 'pending', job, operation: data.operation, scene: s, model: status.model, cost, seconds: CLIP_SECONDS };
  } catch (error) {
    await gateway().logUsage(track, { feature: 'reels-ai-clip', model: status.model, ok: false, input_tokens: 0, output_tokens: 0, cost_usd: 0, duration_ms: Date.now() - started, error: String(error.message || error).slice(0, 200) });
    const budget = gateway().isBudgetError(error);
    return { ok: false, reason: budget ? 'budget' : 'error', error: budget ? "This week's AI budget is used up." : 'The AI clip could not be started. The scene still is used instead.' };
  }
}
// One short status check. The page calls it every few seconds.
async function clipStatus({ job = '', operation = null, env = process.env } = {}) {
  const status = clipsStatus(env);
  if (!status.ready) return { ok: false, reason: 'off', error: status.reason };
  const known = JOBS.get(String(job)) || null;
  const op = known ? known.operation : operation;
  if (op == null) return { ok: false, reason: 'job', error: 'Unknown clip job.' };
  const model = known ? known.model : status.model;
  try {
    const data = await postJson(`${VIDEO_BASE}/status`, { method: 'POST', headers: videoHeaders(env, model), body: JSON.stringify({ operation: op }), signal: AbortSignal.timeout(15000) });
    if (data.status === 'pending') return { ok: true, status: 'pending' };
    if (data.status === 'error' || data.status === 'cancelled') return { ok: false, status: 'error', reason: 'error', error: 'The AI clip failed. The scene still is used instead.' };
    if (data.status !== 'completed') return { ok: true, status: 'pending' };
    const v = (Array.isArray(data.videos) ? data.videos : [])[0] || {};
    let value;
    if (v.type === 'url' && /^https:\/\//.test(String(v.url))) value = { ok: true, url: v.url, mediaType: v.mediaType || 'video/mp4' };
    else if (v.type === 'base64' && v.data) {
      if (String(v.data).length > MAX_INLINE_B64) return { ok: false, status: 'error', reason: 'too-large', error: 'The AI clip is too large to send. The scene still is used instead.' };
      value = { ok: true, data: String(v.data), mediaType: v.mediaType || 'video/mp4' };
    } else {
      console.warn('reels ai-clip: completed without a video; keys:', Object.keys(v).join(','));
      return { ok: false, status: 'error', reason: 'error', error: 'The AI clip came back empty.' };
    }
    value = { ...value, status: 'completed', model, scene: known ? known.scene : '', rights: AI_RIGHTS(model), seconds: CLIP_SECONDS };
    if (known) { CLIPS.set(known.key, { at: Date.now(), value }); JOBS.delete(String(job)); }
    return value;
  } catch (error) {
    return { ok: false, status: 'error', reason: 'error', error: 'The AI clip status could not be read. The scene still is used instead.' };
  }
}

module.exports = { scene, clipStart, clipStatus, clipsStatus, VIDEO_MODEL, VIDEO_BASE, CLIP_SECONDS, VIDEO_PRICE_PER_SECOND, _test: { SCENES, CLIPS, JOBS } };
