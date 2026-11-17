'use strict';
// Reels Studio clip judge: a vision model looks at a few frames of each
// candidate clip (sampled in the browser: about 3 small JPEGs per clip) and
// says what is in it, how good the picture is, how much action each frame
// has and how well it fits each beat subject. The page ranks clips with that
// (reel-clips.js); with AI off it ranks with the free heuristic alone.
//
//   judgeClips({ clips: [{ url, text, handle, frames: [dataUrl], times }],
//                subjects: [{ key, label }], budgetUsd, track, model? })
//     -> { ok, judgements: { [url]: judgement }, cost, model, cached, skipped }
//
// Model: REELS_CLIP_JUDGE_MODEL or google/gemini-3.8-flash (newest Gateway
// Flash, good on sports frames, ~$0.004 per 3 clips); Claude Haiku 5.5 when
// Gemini fails. One call per request (<= 3 clips). Cached per clip URL for
// 6 h on the warm server (the page caches 7 days). Every call is logged
// (feature reels-clip-judge). The caller checks aiSpendGate first; the
// per-reel cap ($0.10) is enforced here from budgetUsd before any call.
const { logUsage, featureDisabled, gatewayConfigured } = require('./_ai-gateway.js');
const C = require('../../reel-clips.js');

const GATEWAY = 'https://ai-gateway.vercel.sh/v1';
const FEATURE = 'reels-clip-judge';
const CACHE = new Map();
const TTL_MS = 6 * 3600e3;
const DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_FRAME_CHARS = 90000;

const clean = (v, n = 200) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const modelFor = () => clean(process.env.REELS_CLIP_JUDGE_MODEL, 80) || C.JUDGE.model;

const SYSTEM = [
  'You judge short sports video clips for an EssentiallySports vertical reel.',
  'For each clip you get its post text and a few frames in time order.',
  'Report only what the frames and the post text show. Name a player only when a jersey name or number, a caption or the post text identifies them; otherwise leave players empty. Never guess.',
  'Answer with JSON only: {"clips":[{"i":0,"kind":"game-action|highlight-replay|celebration|practice|press-conference|interview|crowd-stadium|graphic-or-text|studio-talk|other","teams":["..."],"players":["..."],"quality":0-10,"action":[0-10 per frame],"relevance":{"<subject key>":0-10},"textOverlay":true|false,"note":"<= 12 words"}]}',
  'quality: sharp, well framed, no big watermark, letterbox or burned-in text = high.',
  'action: how much sport is happening in that frame (a play, a catch, a run, a celebration = high; a scoreboard, a talking head, a logo slate = low).',
  'relevance: for every subject key given, how well this clip shows that subject (the named player or team on screen = 8-10; the right team but another player = 5-6; unrelated = 0-2).',
].join('\n');

function priceOf(model) { return C.PRICES[model] || C.PRICES[C.JUDGE.model]; }
function costOf(model, usage) { const p = priceOf(model); return ((usage.input || 0) * p.input + (usage.output || 0) * p.output) / 1e6; }

function userContent(clips, subjects) {
  const parts = [{ type: 'text', text: `Subjects (key: label): ${subjects.map(s => `${s.key}: ${s.label}`).join(' | ') || 'none'}\nClips: ${clips.length}` }];
  clips.forEach((clip, i) => {
    parts.push({ type: 'text', text: `Clip ${i} from @${clean(clip.handle, 40) || 'unknown'}: "${clean(clip.text, 220)}" (${clip.frames.length} frames${clip.times.length ? ` at ${clip.times.map(t => `${Number(t).toFixed(1)}s`).join(', ')}` : ''})` });
    clip.frames.forEach(url => parts.push({ type: 'image_url', image_url: { url } }));
  });
  return parts;
}

// One Gateway call (OpenAI-compatible: works for Gemini and Claude).
async function callModel({ model, clips, subjects, timeoutMs = 25000, fetchImpl = fetch }) {
  const response = await fetchImpl(`${GATEWAY}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}` },
    body: JSON.stringify({
      model, max_tokens: 300 + clips.length * 260, temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userContent(clips, subjects) }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(data?.error?.message || `Clip judge failed: ${response.status}`), { status: response.status });
  const text = String(data?.choices?.[0]?.message?.content || '');
  const u = data?.usage || {};
  const usage = { input: u.prompt_tokens || 0, output: u.completion_tokens || 0 };
  const m = text.match(/\{[\s\S]*\}/);
  let parsed = null;
  try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
  if (!parsed || !Array.isArray(parsed.clips)) throw Object.assign(new Error('The clip judge returned no JSON.'), { usage });
  return { parsed, usage };
}

async function judgeClips({ clips = [], subjects = [], budgetUsd = C.JUDGE.maxUsdPerReel, track, fetchImpl = fetch, now = Date.now } = {}) {
  if (!gatewayConfigured()) return { ok: false, reason: 'off', error: 'AI is off: clips are ranked without the vision check.' };
  if (featureDisabled(FEATURE)) return { ok: false, reason: 'feature-off', error: 'The clip check is switched off: clips are ranked without it.' };
  const subs = (Array.isArray(subjects) ? subjects : []).slice(0, 12).map(s => ({ key: C.norm(s && s.key).slice(0, 40), label: clean(s && s.label, 60) })).filter(s => s.key);
  const list = (Array.isArray(clips) ? clips : []).slice(0, C.JUDGE.perCall).map(c => ({
    url: clean(c && c.url, 300), text: clean(c && c.text, 280), handle: clean(c && c.handle, 40),
    frames: (Array.isArray(c && c.frames) ? c.frames : []).filter(f => typeof f === 'string' && f.length <= MAX_FRAME_CHARS && DATA_URL.test(f)).slice(0, C.JUDGE.framesPerClip + 1),
    times: (Array.isArray(c && c.times) ? c.times : []).map(Number).filter(Number.isFinite).slice(0, C.JUDGE.framesPerClip + 1),
  })).filter(c => /^https:\/\//.test(c.url) && c.frames.length);
  if (!list.length) return { ok: false, status: 400, error: 'No clip frames to judge.' };

  const judgements = {};
  const todo = [];
  list.forEach(c => {
    const hit = CACHE.get(c.url);
    if (hit && now() - hit.at < TTL_MS && subs.every(s => s.key in hit.j.relevance)) judgements[c.url] = hit.j;
    else todo.push(c);
  });
  if (!todo.length) return { ok: true, judgements, cost: 0, model: '', cached: list.length, skipped: 0 };

  // The per-reel cap: never start a call the budget cannot cover.
  const budget = Math.max(0, Math.min(C.JUDGE.maxUsdPerReel, Number(budgetUsd)));
  const primary = modelFor();
  const estimate = C.judgeCost({ clips: todo.length, frames: Math.max(...todo.map(c => c.frames.length)), model: primary });
  if (!(budget > 0) || estimate > budget) return { ok: true, judgements, cost: 0, model: '', cached: list.length - todo.length, skipped: todo.length, capped: true };

  let cost = 0;
  let used = '';
  for (const model of [primary, C.JUDGE.fallback].filter((m, i, a) => a.indexOf(m) === i)) {
    const started = now();
    if (model !== primary && cost + C.judgeCost({ clips: todo.length, model }) > budget) break;
    try {
      const { parsed, usage } = await callModel({ model, clips: todo, subjects: subs, fetchImpl });
      const c = costOf(model, usage);
      cost += c;
      used = model;
      await logUsage(track && { ...track, feature: FEATURE }, { model, ok: true, input_tokens: usage.input, output_tokens: usage.output, cost_usd: Number(c.toFixed(6)), duration_ms: now() - started });
      parsed.clips.forEach(row => {
        const clip = todo[Number(row && row.i)];
        if (!clip) return;
        const j = C.validateJudgement(row, clip.frames.length);
        if (!j) return;
        judgements[clip.url] = j;
        CACHE.set(clip.url, { at: now(), j });
      });
      if (CACHE.size > 600) [...CACHE.keys()].slice(0, 200).forEach(k => CACHE.delete(k));
      break;
    } catch (error) {
      const usage = error.usage || { input: 0, output: 0 };
      const c = costOf(model, usage);
      cost += c;
      await logUsage(track && { ...track, feature: FEATURE }, { model, ok: false, input_tokens: usage.input, output_tokens: usage.output, cost_usd: Number(c.toFixed(6)), duration_ms: now() - started, error: String(error.message || error).slice(0, 200) });
    }
  }
  if (!used) return { ok: false, reason: 'error', error: 'The clip check did not answer: clips are ranked without it.', cost: Number(cost.toFixed(6)) };
  return { ok: true, judgements, cost: Number(cost.toFixed(6)), model: used, cached: list.length - todo.length, skipped: 0 };
}

module.exports = { judgeClips, callModel, SYSTEM, FEATURE, CACHE, _test: { userContent, costOf } };
