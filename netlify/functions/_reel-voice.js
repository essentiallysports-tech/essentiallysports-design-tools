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
//   The speech path has never been called live from FrameUp, so the reply is
//   read defensively: base64 in `audio`, `audio.base64`, `audio.data`, `data`
//   or `audioBase64`; mp3 or wav (sniffed from the bytes). On a reply with no
//   audio the top-level keys are logged (never the audio, never secrets).
//   GET /api/reel-maker?diag=voice (admins) runs one tiny real synthesis.
//
//   Model (2026-11-18, Suhail: "a much better, more human voice"): Eleven v4,
//   ElevenLabs' "most emotive, high quality" model, $0.00008/char on the
//   Gateway (about $0.04 for a 30 s reel). It reads [excited]-style audio tags
//   as delivery directions (Gateway docs: v4 and v3), so the hook line of the
//   game-day voice gets one. If v4 fails (not a budget error), Multilingual v2
//   and then Flash v2.5 are tried once each, unless REELS_TTS_MODEL pins one.
//   REELS_TTS_VOICE pins the default voice (else Brian).
//
//   Four voices (all ElevenLabs "premade" library voices, never clones; ids
//   checked against https://api.elevenlabs.io/v1/voices on 2026-11-18, every
//   one category "premade", accent "american"):
//     brian  Brian  nPczCjzI2devNBz1zQrb  "Deep, Resonant and Comforting" (male)
//     liam   Liam   TX3LPaxmHKxFdv7VOQHJ  "Energetic, Social Media Creator" (male)
//     sarah  Sarah  EXAVITQu4vr4xnSDxMaL  "Mature, Reassuring, Confident" (female)
//     bella  Bella  hpp4J3VqNfWAUOO0d1Us  "Professional, Bright, Warm" (female)
//   The browser sends only the option id; the server maps it to the voice id.
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
const DEFAULT_MODEL = 'elevenlabs/eleven-v4';
const FALLBACK_MODELS = ['elevenlabs/eleven-multilingual-v2', 'elevenlabs/eleven-flash-v2.5'];
// The four voices offered in the page (option id -> library voice).
const VOICES = [
  { id: 'brian', name: 'Brian', line: 'Warm documentary narrator', gender: 'male', voice: 'nPczCjzI2devNBz1zQrb', settings: { stability: 0.5, similarityBoost: 0.75, style: 0.3 } },
  { id: 'liam', name: 'Liam', line: 'Energetic game-day host', gender: 'male', voice: 'TX3LPaxmHKxFdv7VOQHJ', settings: { stability: 0.5, similarityBoost: 0.75, style: 0.55 }, hookTag: '[excited]' },
  { id: 'sarah', name: 'Sarah', line: 'Calm, confident analyst', gender: 'female', voice: 'EXAVITQu4vr4xnSDxMaL', settings: { stability: 0.5, similarityBoost: 0.8, style: 0.2 } },
  { id: 'bella', name: 'Bella', line: 'Bright studio presenter', gender: 'female', voice: 'hpp4J3VqNfWAUOO0d1Us', settings: { stability: 0.5, similarityBoost: 0.75, style: 0.4 } },
];
const DEFAULT_VOICE_OPTION = 'brian';
const SAMPLE_LINE = "Here's what the numbers really say.";
const voiceOption = id => VOICES.find(v => v.id === id) || null;
const DEFAULT_ALIGN_MODEL = 'elevenlabs/scribe-v2';
const MUSIC_MODEL = 'elevenlabs/music-v2.5';
// ElevenLabs "Roger" (CwhRBWXzGAHq8TQ4Fs17): a public library voice (used in
// Vercel's Gateway speech docs), confident and resonant; reads sports well.
const DEFAULT_VOICES = { elevenlabs: 'nPczCjzI2devNBz1zQrb', google: 'Charon', openai: 'onyx', microsoft: 'en-US-Ethan' };
// ElevenLabs public library ("premade") voices, usable without a clone check.
const LIBRARY_VOICES = new Set([
  // (the four page voices are in this list: Brian, Liam, Sarah, Bella)
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

function voiceStatus(env = process.env, optionId = '') {
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
  const pinned = Boolean(String(env.REELS_TTS_MODEL || '').trim());
  const model = normModel(env.REELS_TTS_MODEL);
  const provider = providerOf(model);
  // A picked option (ElevenLabs models only) wins over the env default voice.
  const option = provider === 'elevenlabs' ? voiceOption(optionId) : null;
  const voice = option ? option.voice : String(env.REELS_TTS_VOICE || DEFAULT_VOICES[provider] || '').trim();
  if (!voice) return off(`Set REELS_TTS_VOICE for ${model}.`);
  const chosen = option || VOICES.find(v => v.voice === voice) || null;
  return {
    mode: 'gateway', ready: true, provider: 'gateway', model, pinned, voice, option: chosen ? chosen.id : '', settings: chosen ? chosen.settings : null, hookTag: chosen ? chosen.hookTag || '' : '',
    align: normModel(env.REELS_ALIGN_MODEL || DEFAULT_ALIGN_MODEL), label: chosen ? `${chosen.name}, ${chosen.line.toLowerCase()} (ES house voice)` : 'ES house voice (AI Gateway)',
  };
}
// What the browser may see (no voice ids, no keys): the four options, the
// model and its price per character for the cost estimate.
const publicStatus = status => ({
  mode: status.mode, ready: status.ready, label: status.label, reason: status.reason || '', model: status.ready ? status.model : '',
  perChar: status.ready ? (VOICE_PRICES[status.model] || {}).perChar || 0 : 0,
  voices: status.ready && providerOf(status.model) === 'elevenlabs' && status.mode === 'gateway' ? VOICES.map(({ id, name, line, gender }) => ({ id, name, line, gender })) : [],
  defaultVoice: status.option || DEFAULT_VOICE_OPTION,
});

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

// Text as it should be spoken: money and multipliers read naturally, the
// script (and its captions) keep their own spelling.
function speakable(text, { tag = '' } = {}) {
  let t = String(text || '');
  t = t.replace(/([−-])\$(\d[\d,.]*)\s?([MBK])\b/g, (m, s, n, u) => `minus $${n} ${{ M: 'million', B: 'billion', K: 'thousand' }[u]}`);
  t = t.replace(/\$(\d[\d,.]*)\s?([MBK])\b/g, (m, n, u) => `$${n} ${{ M: 'million', B: 'billion', K: 'thousand' }[u]}`);
  t = t.replace(/(\d)\s?[×x](?=\s|$|[.,!?])/g, '$1 times');
  t = t.replace(/~\s?(?=[$#\d])/g, 'about ');
  t = t.replace(/#(\d+)/g, 'number $1');
  t = t.replace(/\s+/g, ' ').trim();
  return tag ? `${tag} ${t}` : t;
}
// The audio in a Gateway speech reply, whichever key it came in.
function audioFromReply(data) {
  if (!data || typeof data !== 'object') return '';
  const pick = [data.audio, data.audio && data.audio.base64, data.audio && data.audio.data, data.data, data.audioBase64, data.audio_base64];
  const b64 = pick.find(v => typeof v === 'string' && v.length > 16);
  return b64 ? String(b64).replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, '') : '';
}
const replyKeys = data => (data && typeof data === 'object' ? Object.keys(data).concat(data.audio && typeof data.audio === 'object' ? Object.keys(data.audio).map(k => `audio.${k}`) : []).slice(0, 12) : [typeof data]);

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

const EXPRESSIVE = new Set(['elevenlabs/eleven-v4', 'elevenlabs/eleven-v3', 'elevenlabs/eleven-v3-conversational', 'elevenlabs/eleven-v4-turbo']);
async function speakGateway(status, text, env, { model = status.model, hook = false } = {}) {
  const provider = providerOf(model);
  const tag = hook && status.hookTag && EXPRESSIVE.has(model) ? status.hookTag : '';
  const body = { text: provider === 'elevenlabs' ? speakable(text, { tag }) : speakable(text), voice: status.voice, outputFormat: provider === 'google' ? 'wav' : 'mp3' };
  if (provider === 'google') body.instructions = 'A confident sports-news narrator: brisk, clear, warm, never shouting.';
  if (provider === 'elevenlabs') {
    const v = status.settings || { stability: 0.5, similarityBoost: 0.75, style: 0.3 };
    body.providerOptions = { elevenlabs: { voiceSettings: { stability: v.stability, similarityBoost: v.similarityBoost, style: v.style, useSpeakerBoost: true } } };
  }
  const data = await gatewayJson(GATEWAY_SPEECH, { method: 'POST', headers: gatewayHeaders(env, model, 'speech'), body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  const b64 = audioFromReply(data);
  if (!b64) {
    console.warn('reels voice: speech reply had no audio; keys:', replyKeys(data).join(','));
    throw Object.assign(new Error('The voice model returned no audio.'), { keys: replyKeys(data) });
  }
  const buffer = Buffer.from(b64, 'base64');
  const mime = sniffMime(buffer);
  if (mime === 'application/octet-stream') console.warn('reels voice: unrecognised audio bytes', buffer.length);
  return { audio: buffer.toString('base64'), mime, durationMs: mime === 'audio/wav' ? wavDurationMs(buffer) : 0, model, bytes: buffer.length };
}
// v4 first; on a non-budget failure try the next model once (unless pinned).
async function speakWithFallback(status, text, env, opts = {}) {
  const chain = status.pinned || providerOf(status.model) !== 'elevenlabs' ? [status.model] : [status.model, ...FALLBACK_MODELS.filter(m => m !== status.model)];
  let last;
  for (const model of chain) {
    try { return await speakGateway(status, text, env, { ...opts, model }); } catch (error) {
      last = error;
      if (gateway().isBudgetError(error) || error.status === 401 || error.status === 429) break;
      console.warn(`reels voice: ${model} failed (${error.status || ''} ${String(error.message || error).slice(0, 120)})`);
    }
  }
  throw last;
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
async function synthesize({ text, voiceOption: optionId = '', hook = false, align = true, feature = 'reels-voice', track = null, env = process.env } = {}) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (!line) return { ok: false, reason: 'empty', error: 'This beat has no voiceover line.' };
  if (line.length > MAX_CHARS) return { ok: false, reason: 'too-long', error: `Keep a beat's voiceover under ${MAX_CHARS} characters.` };
  if (optionId && !voiceOption(optionId)) return { ok: false, reason: 'voice', error: 'Pick one of the four ES voices.' };
  const status = voiceStatus(env, optionId);
  if (!status.ready) return { ok: false, reason: 'off', error: status.reason };
  const key = cacheKey(status.mode, status.model, status.voice, status.align, hook ? 'hook' : '', align ? 'a' : 'n', line);
  if (CACHE.has(key)) return { ...CACHE.get(key), cached: true, cost: 0, costs: { voice: 0, align: 0 } };
  const allowed = await voiceAllowed(status, env);
  if (!allowed.ok) return { ok: false, reason: 'voice-check', error: allowed.reason };
  const log = row => gateway().logUsage(track, { input_tokens: 0, output_tokens: 0, ...row });
  const started = Date.now();
  const logModel = status.mode === 'elevenlabs' ? `elevenlabs-direct/${status.model}` : status.model;
  let out;
  try {
    out = status.mode === 'gateway' ? await speakWithFallback(status, line, env, { hook }) : await speakEleven(status, line, env);
  } catch (error) {
    await log({ feature, model: logModel, ok: false, cost_usd: 0, duration_ms: Date.now() - started, error: String(error.message || error).slice(0, 200) });
    const budget = gateway().isBudgetError(error);
    return { ok: false, reason: budget ? 'budget' : 'error', error: budget ? "This week's AI budget is used up, so voiceover is paused." : 'The voiceover could not be made right now. Try again, or export with captions only.', detail: String(error.message || error).slice(0, 200), keys: error.keys || undefined };
  }
  const usedModel = out.model || status.model;
  const voiceMs = Date.now() - started;
  let alignUsd = 0;
  let words = out.words || [];
  let alignedBy = words.length ? 'native' : '';
  if (align && !words.length && status.mode === 'gateway') {
    // Word timings from Gateway transcription (Scribe v2).
    const alignStarted = Date.now();
    try {
      const data = await transcribeGateway(status.align, out.audio, out.mime, env);
      const heard = wordsFromTranscript(data);
      const seconds = Number(data.durationInSeconds) || out.durationMs / 1000 || line.length / 15;
      if (!out.durationMs) out.durationMs = Math.round(seconds * 1000);
      alignUsd = voiceCost(status.align, 0, seconds);
      words = heard.length ? alignScript(line, heard.filter(w => !/^\[.*\]$/.test(w.w)), out.durationMs) : [];
      alignedBy = words.length ? status.align : '';
      await log({ feature: 'reels-voice-align', model: status.align, ok: true, cost_usd: Number(alignUsd.toFixed(6)), duration_ms: Date.now() - alignStarted });
    } catch (error) {
      // Captions still work: the page spreads the words over the clip.
      await log({ feature: 'reels-voice-align', model: status.align, ok: false, cost_usd: 0, duration_ms: Date.now() - alignStarted, error: String(error.message || error).slice(0, 200) });
    }
  }
  // Gemini also bills seconds of audio (known now from the WAV or the alignment).
  const spoken = status.mode === 'gateway' ? speakable(line, { tag: hook && status.hookTag && EXPRESSIVE.has(usedModel) ? status.hookTag : '' }) : line;
  const voiceUsd = voiceCost(usedModel, spoken.length, out.durationMs / 1000);
  await log({ feature, model: status.mode === 'elevenlabs' ? logModel : usedModel, ok: true, cost_usd: Number(voiceUsd.toFixed(6)), duration_ms: voiceMs });
  const cost = Number((voiceUsd + alignUsd).toFixed(6));
  const result = { ok: true, ...out, words, alignedBy, model: usedModel, voice: status.option || '', mode: status.mode, cost, costs: { voice: Number(voiceUsd.toFixed(6)), align: Number(alignUsd.toFixed(6)) }, cached: false };
  remember(key, result);
  return result;
}

// A short preview of one voice (no alignment), cached like any line.
async function sample({ voiceOption: optionId = DEFAULT_VOICE_OPTION, track = null, env = process.env } = {}) {
  if (!voiceOption(optionId)) return { ok: false, reason: 'voice', error: 'Pick one of the four ES voices.' };
  return synthesize({ text: SAMPLE_LINE, voiceOption: optionId, align: false, feature: 'reels-voice-sample', track, env });
}
// Admin check after a deploy: one tiny real synthesis ("Test.", about
// $0.0004 on v4). Returns what came back (model, format, bytes) or the
// error text and the reply's keys. Never the audio, never a key.
async function diagnose({ track = null, env = process.env } = {}) {
  const status = voiceStatus(env);
  if (!status.ready) return { ok: false, configured: false, reason: status.reason };
  if (status.mode !== 'gateway') return { ok: false, configured: true, mode: status.mode, reason: 'Diag covers the Gateway route only.' };
  const started = Date.now();
  try {
    const out = await speakWithFallback(status, 'Test.', env);
    const usd = voiceCost(out.model, 5);
    await gateway().logUsage(track, { feature: 'reels-voice-diag', model: out.model, ok: true, input_tokens: 0, output_tokens: 0, cost_usd: Number(usd.toFixed(6)), duration_ms: Date.now() - started });
    return { ok: true, configured: true, model: out.model, requested: status.model, voice: status.option || 'env', format: out.mime, bytes: out.bytes, ms: Date.now() - started, cost: Number(usd.toFixed(6)) };
  } catch (error) {
    await gateway().logUsage(track, { feature: 'reels-voice-diag', model: status.model, ok: false, input_tokens: 0, output_tokens: 0, cost_usd: 0, duration_ms: Date.now() - started, error: String(error.message || error).slice(0, 200) });
    return { ok: false, configured: true, model: status.model, status: error.status || 0, error: String(error.message || error).slice(0, 300), keys: error.keys || [], ms: Date.now() - started };
  }
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
    const b64 = audioFromReply(data);
    if (!b64) { console.warn('reels music: reply had no audio; keys:', replyKeys(data).join(',')); throw new Error('The music model returned no audio.'); }
    const cost = Number(voiceCost(MUSIC_MODEL, 0, length).toFixed(6));
    await gateway().logUsage(track, { feature: 'reels-music', model: MUSIC_MODEL, ok: true, input_tokens: 0, output_tokens: 0, cost_usd: cost, duration_ms: Date.now() - started });
    const result = { ok: true, audio: b64, mime: sniffMime(Buffer.from(b64.slice(0, 16), 'base64')), seconds: length, mood: MOODS[mood] ? mood : 'hype', cost, rights: MUSIC_RIGHTS, cached: false };
    remember(key, result);
    return result;
  } catch (error) {
    await gateway().logUsage(track, { feature: 'reels-music', model: MUSIC_MODEL, ok: false, input_tokens: 0, output_tokens: 0, cost_usd: 0, duration_ms: Date.now() - started, error: String(error.message || error).slice(0, 200) });
    const budget = gateway().isBudgetError(error);
    return { ok: false, reason: budget ? 'budget' : 'error', error: budget ? "This week's AI budget is used up, so music is paused." : 'The music could not be made right now. Upload a licensed track instead.' };
  }
}

// ── Reels 2.0: C (inputs) ── a person's own voiceover ─────────────────────
// The browser sends one take as 16 kHz mono 16-bit WAV (base64). It is
// transcribed (the free provider first, see transcriptionPlan) and the
// SCRIPT's words get the transcript's times: the words are never rewritten,
// only timed. Each beat gets its window of the take; the browser slices the
// original full-quality audio with those windows.
//   90 s at 16 kHz mono 16-bit = 2.88 MB, 3.84 MB as base64: one request,
//   under Vercel's 4.5 MB body cap.
const TAKE = { maxSeconds: 90, sampleRate: 16000, maxWavBytes: 90 * 16000 * 2 + 4096, maxBeats: 40 };
const TAKE_CACHE = new Map(); // sha256(audio) -> transcript (a retry is free)
const plainWords = text => String(text || '').replace(/\*/g, '').trim().split(/\s+/).filter(Boolean);

// Is this a WAV we accept? -> { ok, durationMs } | { ok: false, reason, error }
function checkTake(buffer) {
  if (!buffer || buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return { ok: false, reason: 'bad-audio', error: 'That recording could not be read. Try recording again or upload an MP3 or WAV.' };
  const durationMs = wavDurationMs(buffer);
  if (!durationMs) return { ok: false, reason: 'bad-audio', error: 'That recording is empty. Try again.' };
  if (buffer.length > TAKE.maxWavBytes || durationMs > TAKE.maxSeconds * 1000 + 500) return { ok: false, reason: 'too-long', error: `Voiceovers can be up to ${TAKE.maxSeconds} seconds. Trim this one and try again.` };
  return { ok: true, durationMs };
}

async function groqTranscribe(buffer, model, env) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'audio/wav' }), 'voiceover.wav');
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  form.append('language', 'en');
  form.append('temperature', '0');
  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }, body: form, signal: AbortSignal.timeout(40000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw Object.assign(new Error(`Groq transcription failed: ${response.status}`), { status: response.status });
  const words = (Array.isArray(data.words) ? data.words : []).map(w => ({ w: String(w.word || '').trim(), s: Math.round(Number(w.start) * 1000), e: Math.round(Number(w.end) * 1000) })).filter(w => w.w && Number.isFinite(w.s) && Number.isFinite(w.e));
  return { text: String(data.text || '').trim(), words: words.length ? words : wordsFromTranscript({ segments: data.segments }), language: data.language || '' };
}

// One take -> { ok, text, words: [{ w, s, e }] (ms), provider, model, cost }.
// Providers in transcriptionPlan order (Groq is free); a failed one falls
// through to the next. Usage is logged; the words themselves never are.
async function transcribeTake({ audio, track = null, env = process.env } = {}) {
  const gw = gateway();
  const steps = gw.transcriptionPlan(env).filter(step => step.keyPresent && step.provider !== 'openai');
  if (!steps.length) return { ok: false, reason: 'off', error: 'Speech recognition is not set up here.' };
  const key = crypto.createHash('sha256').update(audio).digest('hex');
  if (TAKE_CACHE.has(key)) return { ...TAKE_CACHE.get(key), cost: 0, cached: true };
  const feature = (track && track.feature) || 'reels-voice-align';
  let last = null;
  for (const step of steps) {
    const started = Date.now();
    try {
      let out;
      if (step.provider === 'groq') {
        const got = await groqTranscribe(Buffer.from(audio, 'base64'), step.model, env);
        await gw.logUsage({ ...(track || {}), feature }, { model: `groq/${step.model}`, ok: true, input_tokens: 0, output_tokens: 0, cost_usd: 0, duration_ms: Date.now() - started });
        out = { ok: true, text: got.text, words: got.words, provider: 'groq', model: step.model, cost: 0 };
      } else {
        const got = await gw.aiTranscribe({ audio, mediaType: 'audio/wav', model: step.model, track: { ...(track || {}), feature } });
        const words = (got.words || []).map(w => ({ w: String(w.word || '').trim(), s: Math.round(Number(w.start) * 1000), e: Math.round(Number(w.end) * 1000) })).filter(w => w.w);
        out = { ok: true, text: String(got.text || '').trim(), words: words.length ? words : wordsFromTranscript({ segments: got.segments }), provider: 'gateway', model: got.model || step.model, cost: Number(got.cost) || 0 };
      }
      if (!out.words.length) { last = Object.assign(new Error('No words heard.'), { reason: 'silent' }); continue; }
      if (TAKE_CACHE.size >= 20) TAKE_CACHE.delete(TAKE_CACHE.keys().next().value);
      TAKE_CACHE.set(key, out);
      return out;
    } catch (error) {
      if (gw.isBudgetError(error)) return { ok: false, reason: 'budget', error: "This week's AI budget is used up, so AI features are paused until it resets." };
      if (error && error.code === 'feature-off') return { ok: false, reason: 'off', error: error.message };
      last = error;
      console.warn(`reels voice-align: ${step.provider} failed (${(error && error.status) || ''} ${String((error && error.message) || error).slice(0, 120)})`);
    }
  }
  if (last && last.reason === 'silent') return { ok: false, reason: 'silent', error: 'No speech was heard in that recording. Check the microphone and try again.' };
  return { ok: false, reason: 'error', error: 'The recording could not be transcribed right now.' };
}

// Beats ([{ id, vo }], in order) + the heard words -> per beat
// { id, startMs, endMs, words: [{ w, s, e }] } in take time. `w` is always the
// script's own word. `match` is the share of script words the take contains
// (a low value means the recording is not this script).
function alignBeats(beats, heard, durationMs = 0) {
  const list = (Array.isArray(beats) ? beats : []).map(b => ({ id: String((b && b.id) || ''), words: plainWords(b && b.vo) })).filter(b => b.id && b.words.length);
  if (!list.length) return { beats: [], match: 0 };
  const end = Math.max(0, Math.round(durationMs) || (heard.length ? heard[heard.length - 1].e : 0));
  const timed = alignScript(list.flatMap(b => b.words).join(' '), heard, end);
  // Monotonic and inside the take.
  let floor = 0;
  timed.forEach(word => {
    word.s = Math.max(floor, Math.min(end || Infinity, Math.round(Number(word.s) || 0)));
    word.e = Math.max(word.s, Math.min(end || Infinity, Math.round(Number(word.e) || 0)));
    floor = word.s;
  });
  const pool = new Map();
  heard.forEach(h => { const k = norm(h.w); if (k) pool.set(k, (pool.get(k) || 0) + 1); });
  let hit = 0;
  let total = 0;
  timed.forEach(word => { const k = norm(word.w); if (!k) return; total += 1; if (pool.get(k) > 0) { hit += 1; pool.set(k, pool.get(k) - 1); } });
  let i = 0;
  const out = list.map(b => {
    const words = timed.slice(i, i + b.words.length);
    i += b.words.length;
    return { id: b.id, startMs: words[0].s, endMs: Math.max(words[0].s, words[words.length - 1].e), words: words.map(w => ({ w: w.w, s: w.s, e: w.e })) };
  });
  return { beats: out, match: total ? Number((hit / total).toFixed(3)) : 0 };
}

module.exports = {
  voiceStatus, publicStatus, musicStatus, synthesize, sample, diagnose, makeMusic, speakable, audioFromReply, wordsFromAlignment, wordsFromTranscript, alignScript, wavDurationMs, voiceCost, verifyElevenVoice,
  TAKE, checkTake, transcribeTake, alignBeats,
  MAX_CHARS, VOICES, DEFAULT_VOICE_OPTION, SAMPLE_LINE, FALLBACK_MODELS, VOICE_PRICES, GATEWAY_SPEECH, GATEWAY_TRANSCRIBE, DEFAULT_MODEL, DEFAULT_ALIGN_MODEL, DEFAULT_VOICES, LIBRARY_VOICES, MUSIC_MODEL, MUSIC_RIGHTS, MOODS,
  _test: { CACHE, verified, sniffMime, TAKE_CACHE },
};
