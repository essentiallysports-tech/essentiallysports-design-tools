'use strict';
// Reels Studio Moment Replay frame pick (contract §2.1 frame-pick, research
// §D.1). The browser samples the chosen clip segment, keeps the best 9
// candidate frames by code (3 per third: setup, play, reaction) and sends
// them here as small JPEGs (320 px wide). One cheap vision call picks one
// frame per role, rates clarity and writes a <= 6-word caption per panel.
// Indices only come back; the page re-grabs those times at full size.
//
//   framePick(body, ctx) -> { ok, setup, play, reaction, clarity, captions,
//                             notes, model, cost, cached, picker: 'ai'|'code' }
//
// Model: REELS_FRAME_PICK_MODEL or google/gemini-3.5-flash-lite (~$0.0016 a
// run at Gateway list prices); Claude Haiku 5.5 when it fails. Cap: $0.02 a
// run (budgetUsd may only lower it); a call the cap cannot cover is never
// started. Cached 7 days per (clip, segment, frames) hash on the warm
// server. Logged as reels-frame-pick. The caller (reel-maker FORMAT_MODES,
// gate 'ai') has already run aiSpendGate and the weekly / hourly caps.
//
// Code fallback (AI off, the feature switched off, over the cap, a failed
// or invalid answer): the client's best-ranked frame of each third (its
// scores when it sends them, else the middle one). Always free, always ok.
const crypto = require('node:crypto');
const C = require('../../reel-clips.js');

const GATEWAY = 'https://ai-gateway.vercel.sh/v1';
const FEATURE = 'reels-frame-pick';
const DEFAULT_MODEL = 'google/gemini-3.5-flash-lite';
const FALLBACK_MODEL = 'anthropic/claude-haiku-5.5';
const CAP_USD = 0.02;
const MAX_FRAMES = 9;
const MAX_FRAME_CHARS = 60000; // ~44 KB JPEG; the page sends ~20 KB
const TTL_MS = 7 * 86400e3;
const CACHE = new Map();
const DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const ROLES = ['setup', 'play', 'reaction'];
const TOKENS = { perFrame: 260, prompt: 900, output: 250 };
// Gateway list prices per 1M tokens (reel-clips.js PRICES has the same rows).
const PRICES = { ...C.PRICES, [DEFAULT_MODEL]: C.PRICES[DEFAULT_MODEL] || { input: 0.30, output: 2.50 }, [FALLBACK_MODEL]: C.PRICES[FALLBACK_MODEL] || { input: 0.10, output: 0.50 } };

const clean = (v, n = 200) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const modelFor = (env = process.env) => clean(env.REELS_FRAME_PICK_MODEL, 80) || DEFAULT_MODEL;
const priceOf = model => PRICES[model] || PRICES[DEFAULT_MODEL];
const costOf = (model, usage) => ((usage.input || 0) * priceOf(model).input + (usage.output || 0) * priceOf(model).output) / 1e6;
const estimate = (model, frames) => costOf(model, { input: TOKENS.prompt + frames * TOKENS.perFrame, output: TOKENS.output });

const SYSTEM = [
  'You pick frames for an EssentiallySports "Moment Replay": one sports moment told as three panels.',
  'You get up to 9 small frames from one clip, in time order, each with its index, time and the third of the clip it came from.',
  'Pick exactly one frame index per role:',
  '- setup: the moment before the play (pre-snap, set position, the approach); sharp and readable.',
  '- play: the peak of the action (the catch, the hit, the swing, the shot).',
  '- reaction: after the play (celebration, the crowd, the bench, the replay angle).',
  'setup < play < reaction in time. Prefer sharp frames with no big graphics, scoreboards or letterboxing.',
  'clarity: 0-10 for every frame (sharp, well framed, the action readable = high).',
  'captions: at most 6 words each, plain and factual about what the frame shows. No player names unless a name is readable in the frame. No numbers. No quotes.',
  'Answer with JSON only: {"setup":i,"play":i,"reaction":i,"clarity":[...],"captions":{"setup":"...","play":"...","reaction":"..."},"notes":"<= 12 words"}',
].join('\n');

function readFrames(body) {
  const frames = (Array.isArray(body && body.frames) ? body.frames : []).slice(0, MAX_FRAMES);
  if (!frames.length) return { error: 'No frames to pick from.' };
  if (frames.some(f => typeof f !== 'string' || f.length > MAX_FRAME_CHARS || !DATA_URL.test(f))) return { error: 'Frames must be small JPEG, PNG or WebP images.' };
  const times = (Array.isArray(body.times) ? body.times : []).slice(0, frames.length).map(Number);
  const roles = Array.isArray(body.roles) && body.roles.length === frames.length && body.roles.every(r => ROLES.includes(r)) ? body.roles.slice() : null;
  const scores = Array.isArray(body.scores) && body.scores.length === frames.length ? body.scores.map(Number) : null;
  return { frames, times: times.length === frames.length && times.every(Number.isFinite) ? times : frames.map((_, i) => i), roles, scores };
}
// Third of the clip each frame came from: the roles the page sent, else by position.
function thirds(n, roles) {
  return Array.from({ length: n }, (_, i) => (roles ? roles[i] : ROLES[Math.min(2, Math.floor((i * 3) / n))]));
}

function codePick({ frames, roles, scores }) {
  const n = frames.length;
  const third = thirds(n, roles);
  const pick = role => {
    const idx = third.map((r, i) => (r === role ? i : -1)).filter(i => i >= 0);
    if (!idx.length) return Math.min(n - 1, Math.max(0, Math.round(((ROLES.indexOf(role) + 0.5) * n) / 3 - 0.5)));
    if (scores) return idx.slice().sort((a, b) => (scores[b] || 0) - (scores[a] || 0) || a - b)[0];
    return idx[Math.floor((idx.length - 1) / 2)];
  };
  let [setup, play, reaction] = ROLES.map(pick);
  if (n >= 3 && !(setup < play && play < reaction)) { setup = 0; play = Math.floor((n - 1) / 2); reaction = n - 1; }
  const clarity = frames.map((_, i) => (scores && Number.isFinite(scores[i]) ? Math.max(0, Math.min(10, Math.round(scores[i]))) : null));
  return { setup, play, reaction, clarity: clarity.every(v => v == null) ? [] : clarity.map(v => (v == null ? 0 : v)), captions: { setup: 'The setup', play: 'The play', reaction: 'The reaction' } };
}

const CAPTION_DEFAULT = { setup: 'The setup', play: 'The play', reaction: 'The reaction' };
function caption(raw, role) {
  const text = clean(raw, 80).replace(/["“”]/g, '').replace(/[.!?]+$/, '');
  if (!text || /\d/.test(text)) return CAPTION_DEFAULT[role];
  return text.split(' ').slice(0, 6).join(' ');
}
// The model's answer, checked: indices in range and in time order, clarity
// clamped, captions short and number-free. null = unusable.
function validatePick(raw, n) {
  if (!raw || typeof raw !== 'object') return null;
  const idx = ROLES.map(r => Number(raw[r]));
  if (!idx.every(i => Number.isInteger(i) && i >= 0 && i < n)) return null;
  if (!(idx[0] < idx[1] && idx[1] < idx[2])) return null;
  const clarity = Array.from({ length: n }, (_, i) => {
    const v = Number(Array.isArray(raw.clarity) ? raw.clarity[i] : NaN);
    return Number.isFinite(v) ? Math.max(0, Math.min(10, Math.round(v))) : 0;
  });
  const caps = raw.captions && typeof raw.captions === 'object' ? raw.captions : {};
  return {
    setup: idx[0], play: idx[1], reaction: idx[2], clarity,
    captions: Object.fromEntries(ROLES.map(r => [r, caption(caps[r], r)])),
    notes: clean(raw.notes, 120),
  };
}

function userContent({ frames, times, roles }) {
  const third = thirds(frames.length, roles);
  const parts = [{ type: 'text', text: `Frames: ${frames.length}` }];
  frames.forEach((url, i) => {
    parts.push({ type: 'text', text: `Frame ${i} at ${Number(times[i]).toFixed(1)}s (${third[i]} third)` });
    parts.push({ type: 'image_url', image_url: { url } });
  });
  return parts;
}
async function callModel({ model, input, fetchImpl = fetch, timeoutMs = 20000 }) {
  const response = await fetchImpl(`${GATEWAY}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}` },
    body: JSON.stringify({
      model, max_tokens: TOKENS.output + 100, temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userContent(input) }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => null);
  const u = (data && data.usage) || {};
  const usage = { input: u.prompt_tokens || 0, output: u.completion_tokens || 0 };
  if (!response.ok) throw Object.assign(new Error((data && data.error && data.error.message) || `Frame pick failed: ${response.status}`), { usage });
  const text = String(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '');
  const m = text.match(/\{[\s\S]*\}/);
  let parsed = null;
  try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
  return { parsed, usage };
}

function cacheKey(body, frames) {
  const h = crypto.createHash('sha256');
  h.update(clean(body.clipUrl, 400));
  h.update(JSON.stringify(body.segment && typeof body.segment === 'object' ? [Number(body.segment.in), Number(body.segment.out)] : null));
  frames.forEach(f => h.update(f));
  return h.digest('hex');
}

// ctx: { track, fetchImpl?, now?, gateway? (the _ai-gateway module, for tests), env? }
async function framePick(body, ctx = {}) {
  const now = ctx.now || Date.now;
  const env = ctx.env || process.env;
  const gw = ctx.gateway || require('./_ai-gateway.js');
  const input = readFrames(body);
  if (input.error) return { ok: false, status: 400, error: input.error };
  if (input.frames.length < 3) return { ok: false, status: 400, error: 'Send at least three frames.' };
  const code = (notes, extra = {}) => ({ ok: true, ...codePick(input), notes, model: '', cost: 0, cached: false, picker: 'code', ...extra });

  const key = cacheKey(body, input.frames);
  const hit = CACHE.get(key);
  if (hit && now() - hit.at < TTL_MS) return { ...hit.value, cost: 0, cached: true };

  if (!gw.gatewayConfigured()) return code('AI is off: frames picked by the free check.', { reason: 'off' });
  if (gw.featureDisabled(FEATURE)) return code('The AI frame pick is switched off: frames picked by the free check.', { reason: 'feature-off' });
  const budget = Math.max(0, Math.min(CAP_USD, Number(body.budgetUsd ?? CAP_USD) || 0));
  const primary = modelFor(env);
  if (!(budget > 0) || estimate(primary, input.frames.length) > budget) return code('Over the frame-pick budget: frames picked by the free check.', { capped: true });

  const track = ctx.track ? { ...ctx.track, feature: FEATURE } : null;
  let cost = 0;
  for (const model of [primary, FALLBACK_MODEL].filter((m, i, a) => a.indexOf(m) === i)) {
    if (model !== primary && cost + estimate(model, input.frames.length) > budget) break;
    const started = now();
    try {
      const { parsed, usage } = await callModel({ model, input, fetchImpl: ctx.fetchImpl || fetch });
      const c = costOf(model, usage);
      cost += c;
      const pick = validatePick(parsed, input.frames.length);
      await gw.logUsage(track, { model, ok: Boolean(pick), input_tokens: usage.input, output_tokens: usage.output, cost_usd: Number(c.toFixed(6)), duration_ms: now() - started, ...(pick ? {} : { error: 'invalid frame pick' }) });
      if (!pick) continue;
      const value = { ok: true, ...pick, model, cost: Number(cost.toFixed(6)), cached: false, picker: 'ai' };
      CACHE.set(key, { at: now(), value });
      if (CACHE.size > 500) [...CACHE.keys()].slice(0, 100).forEach(k => CACHE.delete(k));
      return value;
    } catch (error) {
      const usage = error.usage || { input: 0, output: 0 };
      const c = costOf(model, usage);
      cost += c;
      await gw.logUsage(track, { model, ok: false, input_tokens: usage.input, output_tokens: usage.output, cost_usd: Number(c.toFixed(6)), duration_ms: now() - started, error: String(error.message || error).slice(0, 200) });
    }
  }
  return code('The AI frame pick did not answer cleanly: frames picked by the free check.', { cost: Number(cost.toFixed(6)), reason: 'error' });
}

module.exports = { framePick, codePick, validatePick, estimate, costOf, modelFor, SYSTEM, FEATURE, CAP_USD, DEFAULT_MODEL, FALLBACK_MODEL, CACHE, _test: { readFrames, userContent, cacheKey, thirds } };
