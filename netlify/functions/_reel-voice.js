'use strict';
// Reels Studio voiceover, captions alignment and music, all through the
// Vercel AI Gateway (one key: AI_GATEWAY_API_KEY; no ElevenLabs account).
//
// Speech (docs: https://vercel.com/docs/ai-gateway/modalities/text-to-speech)
//   POST https://ai-gateway.vercel.sh/v4/ai/speech-model
//   headers: Authorization: Bearer <key>, ai-gateway-protocol-version: 0.0.1,
//            ai-speech-model-specification-version: 4, ai-model-id: <model>
//   body:    { text, voice, outputFormat, instructions?, providerOptions? }
//   reply:   { audio: <base64>, warnings: [] }   (no word timings)
//   REELS_TTS_MODEL (default elevenlabs/eleven-flash-v2.5; e.g. elevenlabs/eleven-v3
//   for hype, google/gemini-3.8-flash-tts for the cheapest), REELS_TTS_VOICE
//   (default: ElevenLabs "Roger", a public library voice; Charon for Google,
//   onyx for OpenAI).
//
// Word timings (docs: https://vercel.com/docs/ai-gateway/modalities/speech-to-text)
//   The speech reply has none, so the voiced audio is transcribed once with
//   elevenlabs/scribe-v2 (REELS_ALIGN_MODEL), which timestamps every word:
//   POST /v4/ai/transcription-model, header ai-transcription-model-specification-version: 4,
//   body { audio: <base64>, mediaType }; reply { text, segments, durationInSeconds,
//   providerMetadata: { elevenlabs: { words: [{ text, type, start, end }] } } }.
//   The script's own words (so "5,477" stays "5,477") take the transcript's times.
//
// Music (REELS_MUSIC=gateway): elevenlabs/music-v2.5 on the same speech
//   endpoint, instrumental, length set with providerOptions.elevenlabs.musicLengthMs.
//   Rights: ElevenLabs Music Terms (updated 2026-10-09) allow online commercial
//   use on paid plans (film, TV, radio excluded) but do not name paid ads, and
//   the plan behind Vercel's provider keys is not confirmed: generated music is
//   recorded as "organic only", so the lint blocks paid exports with it.
//
// Options: REELS_TTS=off forces captions only. REELS_TTS=elevenlabs uses
// ElevenLabs directly (ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID, /with-timestamps),
// an optional fallback only.
//
// Never a cloned voice: the voice comes only from env (the browser cannot pick
// one). Through the Gateway with Vercel's provider keys only ElevenLabs'
// public library voices exist; a voice id outside the known library list is
// used only if ELEVENLABS_API_KEY can confirm it is not a clone (fail closed).
//
// One request voices one beat (<= 400 characters): responses stay far under
// Vercel's 4.5 MB body limit. Results are cached by text hash (speech and
// alignment together), so the same line is never billed twice. Every call is
// logged with logUsage: reels-voice, reels-voice-align, reels-music.
const crypto = require('node:crypto');
const gateway = () => require('./_ai-gateway.js');

const GATEWAY_SPEECH = 'https://ai-gateway.vercel.sh/v4/ai/speech-model';
const GATEWAY_TRANSCRIBE = 'https://ai-gateway.vercel.sh/v4/ai/transcription-model';
const ELEVEN = 'https://api.elevenlabs.io/v1';
const MAX_CHARS = 400;
const DEFAULT_MODEL = 'elevenlabs/eleven-flash-v2.5';
const DEFAULT_ALIGN_MODEL = 'elevenlabs/scribe-v2';
const MUSIC_MODEL = 'elevenlabs/music-v2.5';
// ElevenLabs "Roger" (CwhRBWXzGAHq8TQ4Fs17): a public library voice (used in
// Vercel's Gateway speech docs), confident and resonant; reads sports well.
const DEFAULT_VOICES = { elevenlabs: 'CwhRBWXzGAHq8TQ4Fs17', google: 'Charon', openai: 'onyx', microsoft: 'en-US-Ethan' };
// ElevenLabs public library ("premade") voices, usable without a clone check.
const LIBRARY_VOICES = new Set([
  'CwhRBWXzGAHq8TQ4Fs17', 'hpp4J3VqNfWAUOO0d1Us', 'nPczCjzI2devNBz1zQrb', 'pNInz6obpgDQGcFmaJgB', 'JBFqnCBsd6RMkjVDRZzb',
  'onwK4e9ZLuTAKqWW03F9', 'cjVigY5qzO86Huf0OWal', 'iP95p4xoKVk53GoZ742B', 'TX3LPaxmHKxFdv7VOQHJ', 'bIHbv24MWmeRgasZH58o',
  'IKne3meq5aSn9XLyUdCD', 'N2lVS1w4EtoT3dr4eOWO', 'EXAVITQu4vr4xnSDxMaL', 'FGY2WhTYpPnrIDTdsKH5', 'Xb7hH8MSUJpSbSDYk0k2',
  'XrExE9yKIg1WjnnlVkGX', 'cgSgspJ2msm6clMCkdW9', 'pFZP5JQG7iQjIQuC4Bku', 'SAz9YHcvj6GT2YYXdXww', '21m00Tcm4TlvDq8ikWAM',
]);
// USD, from https://ai-gateway.vercel.sh/v1/models (2026-11-17).
const VOICE_PRICES = {
  'elevenlabs/eleven-flash-v2.5': { perChar: 0.00004 },
  'elevenlabs/eleven-v4-turbo': { perChar: 0.00004 },
  'elevenlabs/eleven-v3': { perChar: 0.00008 },
  'elevenlabs/eleven-v4': { perChar: 0.00008 },
  'openai/tts-1': { perChar: 0.000015 },
  // Gemini TTS bills text in ($0.50/1M tokens, about 4 chars a token) and
  // audio out ($9/1M audio tokens, about 25 a second).
  'google/gemini-3.8-flash-tts': { perChar: 0.0000005 / 4, perSecond: 25 * 0.000009 },
  'elevenlabs/scribe-v2': { perSecond: 0.000061112 },
  'openai/whisper-1': { perSecond: 0.0001 },
  'elevenlabs/music-v2.5': { perSecond: 0.0025 },
  'elevenlabs/music-v2': { perSecond: 0.0025 },
  eleven_flash_v2_5: { perChar: 0.00004 },
  eleven_turbo_v2_5: { perChar: 0.00004 },
  eleven_multilingual_v2: { perChar: 0.00008 },
  eleven_v3: { perChar: 0.00008 },
};
const BLOCKED_CATEGORIES = new Set(['cloned', 'professional']);
const MUSIC_RIGHTS = {
  source: 'ElevenLabs Music v2.5 via Vercel AI Gateway (AI-generated instrumental)',
  licence: 'ElevenLabs Music Terms (updated 2026-10-09): online commercial use on paid plans, not film, TV or radio; paid ads not named and the plan behind the Gateway is unconfirmed, so organic only until ES confirms.',
  organic: true,
  paid: false,
};

const providerOf = model => String(model || '').split('/')[0];
const normModel = model => {
  const m = String(model || '').trim();
  if (!m) return DEFAULT_MODEL;
  return m.includes('/') ? m : (/^eleven/.test(m) ? `elevenlabs/${m}` : m);
};

function voiceStatus(env = process.env) {
  const flag = String(env.REELS_TTS || '').trim().toLowerCase();
  const hasGateway = Boolean(env.AI_GATEWAY_API_KEY);
  const hasEleven = Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID);
  const off = reason => ({ mode: 'off', ready: false, label: 'Captions only', reason });
  if (flag === 'off') return off('Voiceover is switched off (REELS_TTS=off).');
  if (flag === 'elevenlabs') {
    if (hasEleven) return { mode: 'elevenlabs', ready: true, provider: 'elevenlabs', model: String(env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5').trim(), voice: env.ELEVENLABS_VOICE_ID, align: 'native', label: 'ES house voice (ElevenLabs direct)' };
    if (!hasGateway) return off('REELS_TTS=elevenlabs needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID.');
  }
  if (!hasGateway) return off('No voice is set up yet (AI_GATEWAY_API_KEY is missing). Reels export with captions and music only.');
  const model = normModel(env.REELS_TTS_MODEL);
  const provider = providerOf(model);
  const voice = String(env.REELS_TTS_VOICE || DEFAULT_VOICES[provider] || '').trim();
  if (!voice) return off(`Set REELS_TTS_VOICE for ${model}.`);
  return { mode: 'gateway', ready: true, provider: 'gateway', model, voice, align: normModel(env.REELS_ALIGN_MODEL || DEFAULT_ALIGN_MODEL), label: 'ES house voice (AI Gateway)' };
}
// What the browser may see (no voice ids, no keys).
const publicStatus = status => ({ mode: status.mode, ready: status.ready, label: status.label, reason: status.reason || '', model: status.ready ? status.model : '' });

function musicStatus(env = process.env) {
  const on = String(env.REELS_MUSIC || '').trim().toLowerCase() === 'gateway' && Boolean(env.AI_GATEWAY_API_KEY);
  return { ready: on, model: on ? MUSIC_MODEL : '', perSecond: VOICE_PRICES[MUSIC_MODEL].perSecond, rights: MUSIC_RIGHTS, reason: on ? '' : 'Generated music is off (REELS_MUSIC=gateway turns it on).' };
}

// ElevenLabs character alignment -> word timings in ms (relative to the clip).
function wordsFromAlignment(alignment) {
  const chars = alignment && Array.isArray(alignment.characters) ? alignment.characters : [];
  const starts = alignment && alignment.character_start_times_seconds || [];
  const ends = alignment && alignment.character_end_times_seconds || [];
  const out = [];
  let word = null;
  chars.forEach((ch, i) => {
    if (/\s/.test(ch)) { if (word) { out.push(word); word = null; } return; }
    const s = Math.round(Number(starts[i]) * 1000);
    const e = Math.round(Number(ends[i]) * 1000);
    if (!word) word = { w: ch, s: Number.isFinite(s) ? s : 0, e: Number.isFinite(e) ? e : 0 };
    else { word.w += ch; if (Number.isFinite(e)) word.e = e; }
  });
  if (word) out.push(word);
  return out.filter(w => /[\p{L}\p{N}]/u.test(w.w));
}

// Words from a Gateway transcription reply (Scribe word list, else segments).
function wordsFromTranscript(data) {
  const scribe = data && data.providerMetadata && data.providerMetadata.elevenlabs && data.providerMetadata.elevenlabs.words;
  if (Array.isArray(scribe) && scribe.length) {
    return scribe
      .filter(w => (w.type || 'word') === 'word' && /[\p{L}\p{N}]/u.test(String(w.text || '')))
      .map(w => ({ w: String(w.text).trim(), s: Math.round(Number(w.start) * 1000), e: Math.round(Number(w.end) * 1000) }))
      .filter(w => Number.isFinite(w.s) && Number.isFinite(w.e));
  }
  const out = [];
  (Array.isArray(data && data.segments) ? data.segments : []).forEach(seg => {
    const list = String(seg.text || '').trim().split(/\s+/).filter(Boolean);
    const s0 = Number(seg.startSecond ?? seg.start ?? 0) * 1000;
    const s1 = Number(seg.endSecond ?? seg.end ?? 0) * 1000;
    const step = list.length ? (s1 - s0) / list.length : 0;
    list.forEach((w, i) => out.push({ w, s: Math.round(s0 + i * step), e: Math.round(s0 + (i + 0.9) * step) }));
  });
  return out;
}

// The script's words get the transcript's times. Words match after
// normalising ("5,477" ~ "5477", "Bills'" ~ "bills"); a word the transcript
// spelled differently is placed between its matched neighbours.
const norm = w => String(w).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]/g, '');
function alignScript(script, heard, durationMs = 0) {
  const words = String(script || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = words.map(w => ({ w, s: null, e: null }));
  let j = 0;
  out.forEach(word => {
    const key = norm(word.w);
    if (!key) return;
    for (let k = j; k < Math.min(heard.length, j + 4); k += 1) {
      const h = norm(heard[k].w);
      if (h && (h === key || h.startsWith(key) || key.startsWith(h))) { word.s = heard[k].s; word.e = heard[k].e; j = k + 1; break; }
    }
  });
  // Fill the gaps by interpolating between matched neighbours.
  const end = durationMs || (heard.length ? heard[heard.length - 1].e : 0);
  for (let i = 0; i < out.length; i += 1) {
    if (out[i].s != null) continue;
    let a = i - 1;
    while (a >= 0 && out[a].s == null) a -= 1;
    let b = i;
    while (b < out.length && out[b].s == null) b += 1;
    const from = a >= 0 ? out[a].e : 0;
    const to = b < out.length ? out[b].s : end;
    const n = b - a - 1;
    for (let k = 0; k < n; k += 1) {
      const span = Math.max(0, to - from) / n;
      out[a + 1 + k].s = Math.round(from + k * span);
      out[a + 1 + k].e = Math.round(from + (k + 0.9) * span);
    }
    i = b;
  }
  return out;
}

// Duration of a WAV (RIFF) buffer in ms, or 0.
function wavDurationMs(buffer) {
  if (!buffer || buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return 0;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = buffer.readUInt32LE(offset + 16);
    if (id === 'data') return byteRate ? Math.round((Math.min(size, buffer.length - offset - 8) / byteRate) * 1000) : 0;
    offset += 8 + size + (size % 2);
  }
  return 0;
}

const sniffMime = buffer => {
  if (!buffer || buffer.length < 4) return 'application/octet-stream';
  if (buffer.toString('ascii', 0, 4) === 'RIFF') return 'audio/wav';
  if (buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (buffer.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  return 'application/octet-stream';
};

function voiceCost(model, chars, seconds = 0) {
  const p = VOICE_PRICES[model] || { perChar: 0.00004 };
  return chars * (p.perChar || 0) + seconds * (p.perSecond || 0);
}

// ─── The never-clone check (ElevenLabs voices) ───────────────────────────
const verified = new Map(); // voiceId -> { ok, at, reason }
const VERIFY_TTL_MS = 6 * 3600e3;
async function verifyElevenVoice(voiceId, env = process.env) {
  const hit = verified.get(voiceId);
  if (hit && Date.now() - hit.at < VERIFY_TTL_MS) return hit;
  let result;
  try {
    const response = await fetch(`${ELEVEN}/voices/${encodeURIComponent(voiceId)}`, { headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) result = { ok: false, reason: 'The house voice could not be checked, so it was not used.' };
    else if (BLOCKED_CATEGORIES.has(String(data.category || '').toLowerCase())) result = { ok: false, reason: 'The house voice is a cloned voice. Reels never use cloned voices: pick a library or designed voice.' };
    else result = { ok: true, category: String(data.category || '') };
  } catch {
    result = { ok: false, reason: 'The house voice could not be checked, so it was not used.' };
  }
  result.at = Date.now();
  verified.set(voiceId, result.ok ? result : { ...result, at: Date.now() - VERIFY_TTL_MS + 60e3 });
  return result;
}
async function voiceAllowed(status, env) {
  const eleven = status.mode === 'elevenlabs' || providerOf(status.model) === 'elevenlabs';
  if (!eleven) return { ok: true }; // Google / OpenAI / Microsoft prebuilt voices only
  if (status.mode === 'gateway' && LIBRARY_VOICES.has(status.voice)) return { ok: true };
  if (env.ELEVENLABS_API_KEY) return verifyElevenVoice(status.voice, env);
  return { ok: false, reason: 'REELS_TTS_VOICE is not a known ElevenLabs library voice, and there is no ELEVENLABS_API_KEY to check it is not a clone, so it was not used.' };
}

// ─── Gateway calls ───────────────────────────────────────────────────────
const gatewayHeaders = (env, model, kind) => ({
  Authorization: `Bearer ${env.AI_GATEWAY_API_KEY}`,
  'ai-gateway-protocol-version': '0.0.1',
  [`ai-${kind}-model-specification-version`]: '4',
  'ai-model-id': model,
  'Content-Type': 'application/json',
});
async function gatewayJson(url, init) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const message = data && data.error ? (data.error.message || data.error) : `Request failed: ${response.status}`;
    throw Object.assign(new Error(String(message)), { status: response.status });
  }
  return data;
}

async function speakGateway(status, text, env) {
  const provider = providerOf(status.model);
  const body = { text, voice: status.voice, outputFormat: provider === 'google' ? 'wav' : 'mp3' };
  if (provider === 'google') body.instructions = 'A confident sports-news narrator: brisk, clear, warm, never shouting.';
  if (provider === 'elevenlabs') body.providerOptions = { elevenlabs: { voiceSettings: { stability: 0.45, similarityBoost: 0.8, style: 0.2, useSpeakerBoost: true } } };
  const data = await gatewayJson(GATEWAY_SPEECH, { method: 'POST', headers: gatewayHeaders(env, status.model, 'speech'), body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  if (!data.audio) throw new Error('The voice model returned no audio.');
  const buffer = Buffer.from(String(data.audio), 'base64');
  const mime = sniffMime(buffer);
  return { audio: buffer.toString('base64'), mime, durationMs: mime === 'audio/wav' ? wavDurationMs(buffer) : 0 };
}

async function transcribeGateway(model, audioB64, mime, env) {
  return gatewayJson(GATEWAY_TRANSCRIBE, {
    method: 'POST',
    headers: gatewayHeaders(env, model, 'transcription'),
    body: JSON.stringify({ audio: audioB64, mediaType: mime === 'application/octet-stream' ? 'audio/mpeg' : mime }),
    signal: AbortSignal.timeout(25000),
  });
}

async function speakEleven(status, text, env) {
  const url = `${ELEVEN}/text-to-speech/${encodeURIComponent(status.voice)}/with-timestamps?output_format=mp3_44100_128`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ text, model_id: status.model, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true } }),
    signal: AbortSignal.timeout(25000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !data.audio_base64) throw Object.assign(new Error((data && data.detail && (data.detail.message || data.detail)) || `Voice request failed: ${response.status}`), { status: response.status });
  const words = wordsFromAlignment(data.alignment || data.normalized_alignment);
  return { audio: String(data.audio_base64), mime: 'audio/mpeg', durationMs: words.length ? words[words.length - 1].e : 0, words };
}

// ─── Synthesis ───────────────────────────────────────────────────────────
const CACHE = new Map(); // hash(mode, model, voice, text) -> result (speech + alignment)
const CACHE_MAX = 200;
const cacheKey = (...parts) => crypto.createHash('sha256').update(parts.join('|')).digest('hex');
const remember = (key, value) => { if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value); CACHE.set(key, value); };

// Returns { ok, audio (base64), mime, durationMs, words, cost, costs, model, cached }
// or { ok: false, reason, error }. Never throws.
async function synthesize({ text, track = null, env = process.env } = {}) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (!line) return { ok: false, reason: 'empty', error: 'This beat has no voiceover line.' };
  if (line.length > MAX_CHARS) return { ok: false, reason: 'too-long', error: `Keep a beat's voiceover under ${MAX_CHARS} characters.` };
  const status = voiceStatus(env);
  if (!status.ready) return { ok: false, reason: 'off', error: status.reason };
  const key = cacheKey(status.mode, status.model, status.voice, status.align, line);
  if (CACHE.has(key)) return { ...CACHE.get(key), cached: true, cost: 0, costs: { voice: 0, align: 0 } };
  const allowed = await voiceAllowed(status, env);
  if (!allowed.ok) return { ok: false, reason: 'voice-check', error: allowed.reason };
  const log = row => gateway().logUsage(track, { input_tokens: 0, output_tokens: 0, ...row });
  const started = Date.now();
  const logModel = status.mode === 'elevenlabs' ? `elevenlabs-direct/${status.model}` : status.model;
  let out;
  try {
    out = status.mode === 'gateway' ? await speakGateway(status, line, env) : await speakEleven(status, line, env);
  } catch (error) {
    await log({ feature: 'reels-voice', model: logModel, ok: false, cost_usd: 0, duration_ms: Date.now() - started, error: String(error.message || error).slice(0, 200) });
    const budget = gateway().isBudgetError(error);
    return { ok: false, reason: budget ? 'budget' : 'error', error: budget ? "This week's AI budget is used up, so voiceover is paused." : 'The voiceover could not be made right now. Try again, or export with captions only.' };
  }
  const voiceMs = Date.now() - started;
  let alignUsd = 0;
  let words = out.words || [];
  let alignedBy = words.length ? 'native' : '';
  if (!words.length && status.mode === 'gateway') {
    // Word timings from Gateway transcription (Scribe v2).
    const alignStarted = Date.now();
    try {
      const data = await transcribeGateway(status.align, out.audio, out.mime, env);
      const heard = wordsFromTranscript(data);
      const seconds = Number(data.durationInSeconds) || out.durationMs / 1000 || line.length / 15;
      if (!out.durationMs) out.durationMs = Math.round(seconds * 1000);
      alignUsd = voiceCost(status.align, 0, seconds);
      words = heard.length ? alignScript(line, heard, out.durationMs) : [];
      alignedBy = words.length ? status.align : '';
      await log({ feature: 'reels-voice-align', model: status.align, ok: true, cost_usd: Number(alignUsd.toFixed(6)), duration_ms: Date.now() - alignStarted });
    } catch (error) {
      // Captions still work: the page spreads the words over the clip.
      await log({ feature: 'reels-voice-align', model: status.align, ok: false, cost_usd: 0, duration_ms: Date.now() - alignStarted, error: String(error.message || error).slice(0, 200) });
    }
  }
  // Gemini also bills seconds of audio (known now from the WAV or the alignment).
  const voiceUsd = voiceCost(status.model, line.length, out.durationMs / 1000);
  await log({ feature: 'reels-voice', model: logModel, ok: true, cost_usd: Number(voiceUsd.toFixed(6)), duration_ms: voiceMs });
  const cost = Number((voiceUsd + alignUsd).toFixed(6));
  const result = { ok: true, ...out, words, alignedBy, model: status.model, mode: status.mode, cost, costs: { voice: Number(voiceUsd.toFixed(6)), align: Number(alignUsd.toFixed(6)) }, cached: false };
  remember(key, result);
  return result;
}

// ─── Music bed (REELS_MUSIC=gateway) ─────────────────────────────────────
const MOODS = {
  hype: 'driving, energetic sports-highlight beat, punchy drums and bass, confident',
  tension: 'tense, building cinematic pulse, low strings and steady percussion',
  calm: 'calm analytical studio bed, soft keys and light percussion',
  celebration: 'uplifting celebratory anthem feel, bright synths and claps',
};
async function makeMusic({ mood = 'hype', seconds = 30, track = null, env = process.env } = {}) {
  const status = musicStatus(env);
  if (!status.ready) return { ok: false, reason: 'off', error: status.reason };
  const length = Math.max(10, Math.min(60, Math.round(Number(seconds) || 30)));
  const style = MOODS[mood] || MOODS.hype;
  const prompt = `Instrumental background music for a short vertical sports video: ${style}. No vocals, no lyrics, no melody that sounds like an existing song. Leaves room for a voiceover.`;
  const key = cacheKey('music', MUSIC_MODEL, prompt, length);
  if (CACHE.has(key)) return { ...CACHE.get(key), cached: true, cost: 0 };
  const started = Date.now();
  try {
    const data = await gatewayJson(GATEWAY_SPEECH, {
      method: 'POST',
      headers: gatewayHeaders(env, MUSIC_MODEL, 'speech'),
      body: JSON.stringify({ text: prompt, outputFormat: 'mp3', providerOptions: { elevenlabs: { musicLengthMs: length * 1000, forceInstrumental: true } } }),
      signal: AbortSignal.timeout(55000),
    });
    if (!data.audio) throw new Error('The music model returned no audio.');
    const cost = Number(voiceCost(MUSIC_MODEL, 0, length).toFixed(6));
    await gateway().logUsage(track, { feature: 'reels-music', model: MUSIC_MODEL, ok: true, input_tokens: 0, output_tokens: 0, cost_usd: cost, duration_ms: Date.now() - started });
    const result = { ok: true, audio: String(data.audio), mime: sniffMime(Buffer.from(String(data.audio).slice(0, 16), 'base64')), seconds: length, mood: MOODS[mood] ? mood : 'hype', cost, rights: MUSIC_RIGHTS, cached: false };
    remember(key, result);
    return result;
  } catch (error) {
    await gateway().logUsage(track, { feature: 'reels-music', model: MUSIC_MODEL, ok: false, input_tokens: 0, output_tokens: 0, cost_usd: 0, duration_ms: Date.now() - started, error: String(error.message || error).slice(0, 200) });
    const budget = gateway().isBudgetError(error);
    return { ok: false, reason: budget ? 'budget' : 'error', error: budget ? "This week's AI budget is used up, so music is paused." : 'The music could not be made right now. Upload a licensed track instead.' };
  }
}

module.exports = {
  voiceStatus, publicStatus, musicStatus, synthesize, makeMusic, wordsFromAlignment, wordsFromTranscript, alignScript, wavDurationMs, voiceCost, verifyElevenVoice,
  MAX_CHARS, VOICE_PRICES, GATEWAY_SPEECH, GATEWAY_TRANSCRIBE, DEFAULT_MODEL, DEFAULT_ALIGN_MODEL, DEFAULT_VOICES, LIBRARY_VOICES, MUSIC_MODEL, MUSIC_RIGHTS, MOODS,
  _test: { CACHE, verified, sniffMime },
};
