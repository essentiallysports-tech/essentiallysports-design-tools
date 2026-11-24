// Reels Studio 2.0, lane C (inputs): your own voiceover.
//
// Upload an audio file or record in the browser (3-2-1 count-in, level meter,
// re-take, a prompter with each scene's words). The take is timed to the
// script: the SCRIPT's words are never rewritten, they only get the take's
// times. The original full-quality audio is then cut per scene into the same
// shapes the AI voice uses (state.buffers['vo:<beatId>'], state.voice[beatId]),
// so rebuild, the mix and the export work untouched.
//
// Timing, best first:
//   1. the server ('voice-align': speech recognition + alignment)
//   2. on-device speech recognition (reels-whisper-worker.js, lazy-loaded)
//   3. an even split by word count, clearly marked "estimated timing"
// Each scene has a "nudge start" control for the last few tenths.
//
// Pure logic (also loads in Node for tests): LIMITS, checkFile, checkLength,
// mixDown, encodeWav, toBase64, beatLines, alignScript, alignBeats,
// heardFromChunks, evenSplit, cutWindows.
// Browser: ctx.modules.voiceInput = { open(), mount(el), active(), remove(),
//   snapshot(), restore(saved), useFile(file) }.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelVoiceInput = api;
  if (typeof document !== 'undefined') api.attach();
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const LIMITS = {
    maxSeconds: 90, minSeconds: 1, sampleRate: 16000,
    maxFileBytes: 80 * 1024 * 1024,
    types: ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/webm', 'video/webm'],
    ext: ['mp3', 'm4a', 'wav', 'webm'],
    nudgeStepMs: 100, nudgeMaxMs: 1500,
    // 90 s of 16 kHz mono 16-bit is 2.88 MB, 3.84 MB as base64: one request under the 4.5 MB body cap.
    maxWavBytes: 90 * 16000 * 2 + 44,
  };
  const ACCEPT = '.mp3,.m4a,.wav,.webm,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/webm';
  const clock = seconds => { const s = Math.max(0, Math.round(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const extOf = name => (String(name || '').match(/\.([a-z0-9]{2,5})$/i) || [])[1]?.toLowerCase() || '';

  function checkFile(file) {
    const name = String((file && file.name) || 'This file');
    const type = String((file && file.type) || '').toLowerCase().split(';')[0];
    if (!LIMITS.types.includes(type) && !LIMITS.ext.includes(extOf(name))) return { ok: false, reason: 'type', error: 'That is not an audio file Reels Studio can use. Upload an MP3, M4A, WAV or WebM.' };
    if (!(Number(file.size) > 0)) return { ok: false, reason: 'empty', error: 'That file is empty.' };
    if (file.size > LIMITS.maxFileBytes) return { ok: false, reason: 'size', error: `That file is too large (${Math.round(file.size / 1048576)} MB). A ${LIMITS.maxSeconds}-second voiceover is usually under 5 MB.` };
    return { ok: true };
  }
  // The 90 s cap, in plain words.
  function checkLength(seconds) {
    const s = Number(seconds) || 0;
    if (s < LIMITS.minSeconds) return { ok: false, reason: 'too-short', error: 'That take is too short. Record at least a sentence.' };
    if (s > LIMITS.maxSeconds + 0.5) return { ok: false, reason: 'too-long', error: `This voiceover is ${clock(s)} long. Reels Studio takes up to ${LIMITS.maxSeconds} seconds: trim it and try again.` };
    return { ok: true };
  }

  // Channels -> one mono track at `outRate` (averaging when downsampling).
  function mixDown(channels, rate, outRate = LIMITS.sampleRate) {
    const n = channels.length ? channels[0].length : 0;
    const out = new Float32Array(Math.max(0, Math.floor((n * outRate) / rate)));
    const step = rate / outRate;
    for (let i = 0; i < out.length; i += 1) {
      const a = Math.floor(i * step);
      const b = Math.max(a + 1, Math.min(n, Math.floor((i + 1) * step)));
      let sum = 0;
      for (let c = 0; c < channels.length; c += 1) { const data = channels[c]; for (let k = a; k < b; k += 1) sum += data[k]; }
      out[i] = sum / ((b - a) * channels.length);
    }
    return out;
  }
  // Mono float samples -> a 16-bit PCM WAV (RIFF) as bytes.
  function encodeWav(samples, rate = LIMITS.sampleRate) {
    const bytes = new Uint8Array(44 + samples.length * 2);
    const view = new DataView(bytes.buffer);
    const text = (offset, s) => { for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
    text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i += 1) { const v = Math.max(-1, Math.min(1, samples[i])); view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
    return bytes;
  }
  function toBase64(bytes) {
    if (typeof Buffer !== 'undefined' && typeof btoa === 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  // The lines a take is matched against: every scene that is spoken, in order,
  // exactly as written (emphasis asterisks are not spoken). The ES end card
  // has no voiceover.
  const plainWords = text => String(text || '').replace(/\*/g, '').trim().split(/\s+/).filter(Boolean);
  function beatLines(plan, ES = null) {
    return ((plan && plan.beats) || []).filter(beat => {
      if (!plainWords(beat.vo).length) return false;
      return !(ES && ES.blockOf && ES.blockOf(beat).type === 'endcard');
    }).map(beat => ({ id: String(beat.id), vo: plainWords(beat.vo).join(' ') }));
  }

  // The same alignment the server runs (netlify/functions/_reel-voice.js
  // alignScript / alignBeats), for the on-device fallback: the script's words
  // get the heard words' times; a word heard differently sits between its
  // matched neighbours. The words themselves are never changed.
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
  function alignBeats(beats, heard, durationMs = 0) {
    const list = (Array.isArray(beats) ? beats : []).map(b => ({ id: String((b && b.id) || ''), words: plainWords(b && b.vo) })).filter(b => b.id && b.words.length);
    if (!list.length) return { beats: [], match: 0 };
    const end = Math.max(0, Math.round(durationMs) || (heard.length ? heard[heard.length - 1].e : 0));
    const timed = alignScript(list.flatMap(b => b.words).join(' '), heard, end);
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
  // The on-device recogniser's chunks ([{ text, timestamp: [s, e] }]) -> heard words (ms).
  function heardFromChunks(chunks) {
    return (Array.isArray(chunks) ? chunks : []).map(chunk => {
      const t = Array.isArray(chunk && chunk.timestamp) ? chunk.timestamp : [];
      const s = Number(t[0]);
      const e = Number(t[1]);
      return { w: String((chunk && chunk.text) || '').trim(), s: Math.round(s * 1000), e: Math.round((Number.isFinite(e) ? e : s + 0.3) * 1000) };
    }).filter(word => word.w && Number.isFinite(word.s) && Number.isFinite(word.e));
  }
  // No recognition at all: the take is shared out by each scene's expected
  // length. Marked `estimated`; there are no word times (captions pace evenly).
  function evenSplit(lines, durationMs, estimateVoMs) {
    const est = typeof estimateVoMs === 'function' ? estimateVoMs : text => plainWords(text).length * 385;
    const weights = lines.map(line => Math.max(1, est(line.vo)));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let at = 0;
    return lines.map((line, i) => {
      const startMs = Math.round((at / total) * durationMs);
      at += weights[i];
      return { id: line.id, startMs, endMs: Math.round((at / total) * durationMs), words: [], estimated: true };
    });
  }
  // Windows -> where to cut the original audio for each scene. A cut starts a
  // breath before the first word and ends a beat after the last, never into a
  // neighbour (the renderer adds its own air between scenes).
  //   nudge: { [beatId]: ms }  moves that scene's start earlier (-) or later (+)
  // -> [{ id, fromMs, toMs, words: [{ w, s, e }] (ms from the cut's start) }]
  function cutWindows(windows, durationMs, { preMs = 70, postMs = 140, nudge = {} } = {}) {
    const total = Math.max(0, Math.round(durationMs) || 0);
    const list = windows.map(w => {
      const shift = Math.max(-LIMITS.nudgeMaxMs, Math.min(LIMITS.nudgeMaxMs, Math.round(Number(nudge[w.id]) || 0)));
      const startMs = Math.max(0, Math.min(Math.max(0, w.endMs - 200), w.startMs + shift));
      return { ...w, startMs, shift };
    });
    return list.map((w, i) => {
      const prev = list[i - 1];
      const next = list[i + 1];
      const lower = prev ? Math.round((Math.min(prev.endMs, w.startMs) + w.startMs) / 2) : 0;
      const upper = next ? Math.round((w.endMs + Math.max(w.endMs, next.startMs)) / 2) : total;
      const fromMs = Math.max(0, Math.max(lower, w.startMs - preMs));
      const toMs = Math.max(fromMs + 120, Math.min(total || Infinity, Math.min(Math.max(upper, w.endMs), w.endMs + postMs)));
      const words = (w.words || []).map(word => ({ w: word.w, s: Math.max(0, Math.round(word.s - fromMs)), e: Math.max(0, Math.min(toMs - fromMs, Math.round(word.e - fromMs))) })).map(word => ({ ...word, e: Math.max(word.s, word.e) }));
      return { id: w.id, fromMs, toMs: Math.min(toMs, total || toMs), words };
    });
  }

  const TIMING = {
    ai: 'timed to your words',
    browser: 'timed to your words on this device',
    estimated: 'estimated timing',
  };
  const RIGHTS = { source: 'Your recording', licence: 'Recorded or uploaded by you; you confirmed ES may use it', organic: true, paid: true };

  // ─── Browser ─────────────────────────────────────────────────────────────
  function attach() {
    const start = ctx => {
      if (!ctx || ctx.modules.voiceInput) return;
      const { state } = ctx;
      const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
      // Lucide icons (ISC licence).
      const ICON = {
        mic: svg('<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>'),
        upload: svg('<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>'),
        stop: svg('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
        x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
        check: svg('<path d="M20 6 9 17l-5-5"/>'),
        warn: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
        minus: svg('<path d="M5 12h14"/>'),
        plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
      };
      const ES = () => (ctx.ES && state.plan && (!state.plan.style || state.plan.style === 'es' || (state.timeline && state.timeline.style === 'es')) ? ctx.ES : null);
      const mediaStore = () => (ctx.modules.tray && ctx.modules.tray.store) || (window.ReelMediaTray ? (mediaStore.own || (mediaStore.own = window.ReelMediaTray.createStore({ indexedDB: window.indexedDB }))) : null);
      const audioContext = () => { if (!state.ac) state.ac = new (window.AudioContext || window.webkitAudioContext)(); return state.ac; };
      const own = () => (state.voiceOwn && state.voiceOwn.plan === state.plan ? state.voiceOwn : null);
      let original = null; // the decoded take, full quality (kept for nudges)
      let lost = null; // a saved voiceover whose audio is not on this device
      let applying = false;
      const panels = new Set();

      // ── Decode, downmix, slice ──
      async function decode(blob) {
        const bytes = await blob.arrayBuffer();
        const ac = audioContext();
        return new Promise((resolve, reject) => { const p = ac.decodeAudioData(bytes, resolve, reject); if (p && p.catch) p.catch(reject); });
      }
      async function to16k(buffer) {
        try {
          const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
          const off = new Offline(1, Math.max(1, Math.ceil(buffer.duration * LIMITS.sampleRate)), LIMITS.sampleRate);
          const src = off.createBufferSource();
          src.buffer = buffer;
          src.connect(off.destination);
          src.start();
          return (await off.startRendering()).getChannelData(0);
        } catch {
          return mixDown(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)), buffer.sampleRate);
        }
      }
      function slice(buffer, fromMs, toMs) {
        const rate = buffer.sampleRate;
        const a = Math.max(0, Math.min(buffer.length - 1, Math.floor((fromMs / 1000) * rate)));
        const b = Math.max(a + 1, Math.min(buffer.length, Math.ceil((toMs / 1000) * rate)));
        const out = audioContext().createBuffer(buffer.numberOfChannels, b - a, rate);
        const fade = Math.min(Math.floor(rate * 0.006), Math.floor((b - a) / 4));
        for (let c = 0; c < buffer.numberOfChannels; c += 1) {
          const data = out.getChannelData(c);
          data.set(buffer.getChannelData(c).subarray(a, b));
          for (let i = 0; i < fade; i += 1) { const k = i / fade; data[i] *= k; data[data.length - 1 - i] *= k; }
        }
        return out;
      }

      // Writes the per-scene audio in the AI voice's own shapes.
      function writeSlices() {
        const v = own();
        if (!v || !original) return 0;
        const beats = state.plan.beats;
        const windows = beats.map(b => v.windows[b.id] && { id: b.id, ...v.windows[b.id] }).filter(Boolean);
        const nudge = Object.fromEntries(windows.map(w => [w.id, w.nudgeMs || 0]));
        const cuts = cutWindows(windows, original.duration * 1000, { nudge, ...(v.timing === 'estimated' ? { preMs: 0, postMs: 0 } : {}) });
        cuts.forEach(cut => {
          const beat = beats.find(b => b.id === cut.id);
          const buffer = slice(original, cut.fromMs, cut.toMs);
          const asset = `vo:${cut.id}`;
          state.buffers[asset] = buffer;
          state.assets[asset] = { kind: 'vo', label: `Your voiceover, scene ${beats.indexOf(beat) + 1}`, rights: { ...RIGHTS } };
          state.voice[cut.id] = { text: v.windows[cut.id].text, voiceId: state.voiceId, own: true, durationMs: Math.round(buffer.duration * 1000), words: cut.words, asset, ...(v.timing === 'estimated' ? { estimated: true } : {}) };
        });
        return cuts.length;
      }
      function clearOwn() {
        Object.keys(state.voice).forEach(id => { if (state.voice[id] && state.voice[id].own) { delete state.buffers[state.voice[id].asset]; delete state.assets[state.voice[id].asset]; delete state.voice[id]; } });
        state.voiceOwn = null;
        original = null;
      }
      const changed = () => { ctx.emit('voice-own', { active: Boolean(own()) }); renderPanels(); };

      // ── On-device speech recognition (lazy; the model downloads on first use) ──
      let worker = null;
      function listenOnDevice(samples, onProgress) {
        return new Promise((resolve, reject) => {
          if (typeof Worker === 'undefined') { reject(new Error('no-worker')); return; }
          try { worker = worker || new Worker('reels-whisper-worker.js?v=20260817', { type: 'module' }); } catch (error) { reject(error); return; }
          const id = `vo-${Date.now().toString(36)}`;
          const timer = setTimeout(() => finish(new Error('timeout')), 150000);
          function finish(error, data) {
            clearTimeout(timer);
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            if (error) { try { worker.terminate(); } catch { /* gone */ } worker = null; reject(error); } else resolve(data);
          }
          function onMessage(event) {
            const data = event.data || {};
            if (data.type === 'progress') { onProgress?.(data.progress); return; }
            if (data.id !== id) return;
            if (data.type === 'result') finish(null, { text: String(data.text || '').trim(), words: heardFromChunks(data.chunks) });
            else finish(new Error(data.message || 'failed'));
          }
          function onError(event) { finish(new Error((event && event.message) || 'worker failed')); }
          worker.addEventListener('message', onMessage);
          worker.addEventListener('error', onError);
          worker.postMessage({ id, samples });
        });
      }

      // ── One take -> the reel's voice ──
      const scriptField = () => (ctx.els.script ? ctx.els.script.value.trim() : '');
      function planFromWords(text, title) {
        const plan = ctx.ES.scriptToPlan(text, { sourceLine: ctx.els.scriptSource ? ctx.els.scriptSource.value.trim() : '', sport: state.sport, format: state.format === 'auto' ? 'explainer' : state.format });
        plan.style = state.style === 'auto' || !state.style ? 'es' : state.style;
        return { plan, source: 'script', corpus: [text, plan.sourceLine].filter(Boolean).join('\n'), sources: [{ type: 'script', title }] };
      }
      // -> { ok } | { ok: false, error }. onStatus(text) reports progress.
      async function useTake(blob, { via = 'upload', name = '', onStatus = () => {} } = {}) {
        if (applying) return { ok: false, error: 'Still working on the last take.' };
        applying = true;
        try {
          onStatus('Reading your recording…');
          let buffer;
          try { buffer = await decode(blob); } catch { return { ok: false, error: 'That file could not be read as audio. Try an MP3, M4A or WAV.' }; }
          const length = checkLength(buffer.duration);
          if (!length.ok) return { ok: false, error: length.error, reason: length.reason };
          const durationMs = Math.round(buffer.duration * 1000);
          const samples = await to16k(buffer);
          const wav = encodeWav(samples);
          if (wav.length > LIMITS.maxWavBytes + 64000) return { ok: false, reason: 'too-long', error: checkLength(LIMITS.maxSeconds + 1).error };

          // The words to match: the reel's scenes, else the pasted script, else the take itself.
          let made = null;
          let lines = state.plan ? beatLines(state.plan, ES()) : [];
          if (!state.plan && ctx.ES && ctx.F.wordCount(scriptField()) >= 6) { made = { ...planFromWords(scriptField(), 'Your script'), notice: 'Your script, word for word, timed to your voiceover.' }; lines = beatLines(made.plan, ctx.ES); }
          if (state.plan && !lines.length) return { ok: false, error: 'This reel has no voiceover lines yet. Add the words to a scene first.' };

          let windows = null;
          let heard = null;
          let transcript = '';
          let timing = '';
          let match = null;
          let note = '';
          const online = state.config.ai && !state.config.offline && window.ESAuth && window.ESAuth.fetchWithAuth;
          if (online) {
            onStatus('Listening to your take…');
            try {
              const data = await ctx.api({ mode: 'voice-align', audio: toBase64(wav), beats: lines });
              if (data.skipped) note = 'free';
              else {
                state.spent.voice = (Number(state.spent.voice) || 0) + (Number(data.cost) || 0);
                transcript = data.transcript || '';
                if (lines.length && Array.isArray(data.beats) && data.beats.length) { windows = data.beats; match = data.match; timing = 'ai'; } else if (Array.isArray(data.words) && data.words.length) { heard = data.words; timing = 'ai'; }
              }
            } catch (error) {
              if (error.status === 413 || error.reason === 'too-long') return { ok: false, reason: 'too-long', error: error.message };
              if (error.reason === 'silent') return { ok: false, reason: 'silent', error: error.message };
              note = 'failed';
            }
          }
          if (!windows && !heard) {
            onStatus('Listening on this device… the first time takes a minute.');
            try {
              const got = await listenOnDevice(samples, p => onStatus(`Getting ready to listen on this device… ${Math.round(p)}%`));
              if (got.words.length) { heard = got.words; transcript = got.text; timing = 'browser'; }
            } catch { /* falls through to the even split */ }
          }
          if (!lines.length) {
            // No script anywhere: the take becomes the script, word for word as heard.
            if (!ctx.ES || ctx.F.wordCount(transcript) < 4) return { ok: false, error: 'Reels Studio could not hear the words in this take. Paste your script under “Script” first, then add the voiceover.' };
            made = { ...planFromWords(transcript, 'Your voiceover'), notice: 'Built from your recording, word for word. Check the words below: speech recognition can mishear names and numbers.' };
            lines = beatLines(made.plan, ctx.ES);
          }
          if (!windows && heard) { const local = alignBeats(lines, heard, durationMs); windows = local.beats; match = local.match; }
          if (!windows || !windows.length) { windows = evenSplit(lines, durationMs, text => ctx.F.estimateVoMs(text)); timing = 'estimated'; match = null; }

          onStatus('Cutting your voice to the scenes…');
          if (made) ctx.applyPlan(made, { brief: made.plan.script.text, go: true });
          clearOwn();
          const byId = Object.fromEntries(state.plan.beats.map(b => [b.id, b]));
          state.voiceOwn = {
            plan: state.plan, name: name || (via === 'record' ? 'Recording' : 'Voiceover'), via, seconds: Number(buffer.duration.toFixed(2)), timing, match,
            windows: Object.fromEntries(windows.filter(w => byId[w.id]).map(w => [w.id, { startMs: Math.round(w.startMs), endMs: Math.round(w.endMs), nudgeMs: 0, text: byId[w.id].vo, words: (w.words || []).map(x => ({ w: x.w, s: Math.round(x.s), e: Math.round(x.e) })) }])),
          };
          original = buffer;
          lost = null;
          state.voiceOn = true;
          state.voiceError = '';
          const n = writeSlices();
          changed();
          ctx.rebuild();
          ctx.renderBeats();
          const store = mediaStore();
          if (store) store.put(state.projectId, 'voice', blob, { name: state.voiceOwn.name, type: blob.type || 'audio/webm', kind: 'voice', size: blob.size }).then(() => store.evict(state.projectId));
          ctx.logEvent('voice_upload', { via, seconds: Math.round(buffer.duration), timing, beats: n, fromTake: Boolean(made && made.sources[0].title === 'Your voiceover'), match: match == null ? null : Number(match), fallback: note });
          const low = timing !== 'estimated' && match != null && match < 0.5;
          const text = timing === 'estimated'
            ? 'Your voiceover is in, with estimated timing. Nudge any scene that starts early or late.'
            : (low ? 'Your voiceover is in, but it does not sound like the words on screen. Check each scene, or re-take.' : 'Your voiceover is in. Scenes and captions follow your voice.');
          ctx.toast(text, low ? { tone: 'error' } : {});
          return { ok: true, timing, beats: n, low, estimated: timing === 'estimated' };
        } finally { applying = false; }
      }
      async function useFile(file, { onStatus } = {}) {
        const check = checkFile(file);
        if (!check.ok) return check;
        return useTake(file, { via: 'upload', name: String(file.name || 'Voiceover').slice(0, 80), onStatus });
      }
      function remove({ quiet = false } = {}) {
        const had = Boolean(state.voiceOwn || lost);
        clearOwn();
        lost = null;
        const store = mediaStore();
        if (store) store.remove(state.projectId, 'voice');
        changed();
        if (state.plan) { ctx.rebuild(); ctx.renderBeats(); }
        if (had && !quiet) ctx.toast(state.config.voice.ready ? 'Your voiceover was removed. The AI voice is back on.' : 'Your voiceover was removed. The reel has captions only.');
      }
      function nudge(beatId, deltaMs) {
        const v = own();
        if (!v || !v.windows[beatId] || !original) return;
        const w = v.windows[beatId];
        w.nudgeMs = deltaMs === 0 ? 0 : Math.max(-LIMITS.nudgeMaxMs, Math.min(LIMITS.nudgeMaxMs, (w.nudgeMs || 0) + deltaMs));
        writeSlices();
        ctx.rebuild();
        renderPanels();
        const beat = state.timeline && state.timeline.beats.find(b => b.id === beatId);
        if (beat) { ctx.selectBeat(beatId); ctx.seek(beat.inMs); }
      }

      // What a saved project keeps (the audio itself stays in this browser).
      function snapshot() {
        const v = own();
        if (v) return { name: v.name, via: v.via, seconds: v.seconds, timing: v.timing, windows: v.windows };
        return lost ? { ...lost } : null;
      }
      async function restore(saved) {
        clearOwn();
        lost = null;
        if (!saved || !saved.windows || !state.plan) { changed(); return false; }
        const meta = { name: String(saved.name || 'Voiceover'), via: saved.via === 'record' ? 'record' : 'upload', seconds: Number(saved.seconds) || 0, timing: TIMING[saved.timing] ? saved.timing : 'estimated', windows: saved.windows };
        const store = mediaStore();
        const rec = store ? await store.get(state.projectId, 'voice') : null;
        let buffer = null;
        if (rec && rec.blob) { try { buffer = await decode(rec.blob); } catch { buffer = null; } }
        if (!buffer) {
          lost = meta;
          changed();
          ctx.toast('This reel’s voiceover is not on this device.', { action: { label: 'Add it again', run: () => open() } });
          return false;
        }
        original = buffer;
        state.voiceOwn = { ...meta, plan: state.plan, windows: Object.fromEntries(Object.entries(meta.windows).filter(([id]) => state.plan.beats.some(b => b.id === id))) };
        state.voiceOn = true;
        writeSlices();
        changed();
        ctx.rebuild();
        ctx.renderBeats();
        return true;
      }
      // A new plan replaced the one the take was cut for.
      ctx.on('rebuild', () => {
        if (applying) return;
        if (state.voiceOwn && state.voiceOwn.plan !== state.plan) {
          clearOwn();
          changed();
          ctx.toast('The script changed, so your voiceover was taken off. Record or upload it again.');
        }
      });

      // ── The dialog: record or upload ──
      const dialog = document.createElement('dialog');
      dialog.className = 'es-dialog rm-photos ri-voice';
      dialog.id = 'ri-voice';
      dialog.setAttribute('aria-labelledby', 'ri-voice-title');
      dialog.innerHTML = `<div class="rm-photos__head"><h2 class="rm-photos__title" id="ri-voice-title">Your voiceover</h2>
          <button class="rm-icon-btn" type="button" data-ri-close aria-label="Close">${ICON.x}</button></div>
        <div class="ri-voice__body" data-ri-body></div>
        <p class="ri-voice__status" role="status" aria-live="polite" data-ri-status></p>
        <p class="ri-voice__error" role="alert" data-ri-error hidden></p>`;
      document.body.append(dialog);
      const body = dialog.querySelector('[data-ri-body]');
      const statusEl = dialog.querySelector('[data-ri-status]');
      const errorEl = dialog.querySelector('[data-ri-error]');
      const filePick = document.createElement('input');
      filePick.type = 'file';
      filePick.accept = ACCEPT;
      filePick.className = 'es-sr-only';
      filePick.tabIndex = -1;
      filePick.setAttribute('aria-hidden', 'true');
      filePick.id = 'ri-voice-file';
      dialog.append(filePick);

      const rec = { view: 'idle', stream: null, recorder: null, chunks: [], blob: null, url: '', timer: 0, raf: 0, startedAt: 0, analyser: null, capped: false, count: 0, token: 0 };
      const setStatus = text => { statusEl.textContent = text || ''; };
      const setError = text => { errorEl.textContent = text || ''; errorEl.hidden = !text; };
      function prompterHtml() {
        const lines = state.plan ? beatLines(state.plan, ES()) : (ctx.F.wordCount(scriptField()) >= 6 && ctx.ES ? beatLines(ctx.ES.scriptToPlan(scriptField()), ctx.ES) : []);
        if (!lines.length) return `<div class="ri-prompter ri-prompter--empty"><p><b>No script yet? Just talk.</b></p><p class="rm-hint">Reels Studio turns your take into scenes, word for word as you said them. You can fix any misheard word after.</p></div>`;
        return `<div class="ri-prompter" tabindex="0" role="group" aria-label="Your script, scene by scene"><ol>${lines.map(line => `<li><span>${esc(line.vo)}</span></li>`).join('')}</ol></div>
          <p class="rm-hint">Read it as written: ${lines.length} scene${lines.length === 1 ? '' : 's'}, about ${clock(lines.reduce((ms, l) => ms + ctx.F.estimateVoMs(l.vo), 0) / 1000)}. Leave a short pause between scenes.</p>`;
      }
      function view(name) {
        rec.view = name;
        dialog.dataset.view = name;
        if (name === 'idle') {
          body.innerHTML = `${prompterHtml()}
            <div class="ri-voice__actions">
              <button class="es-btn es-btn--primary" type="button" data-ri-record>${ICON.mic}<span>Record</span></button>
              <button class="es-btn" type="button" data-ri-upload>${ICON.upload}<span>Upload a file</span></button>
            </div>
            <p class="rm-hint">Up to ${LIMITS.maxSeconds} seconds. Upload an MP3, M4A, WAV or WebM. Your voice stays yours: it is used for this reel only.</p>`;
        } else if (name === 'countin' || name === 'recording') {
          body.innerHTML = `${prompterHtml()}
            <div class="ri-rec" data-ri-rec>
              <div class="ri-rec__count" data-ri-count aria-live="assertive">${name === 'countin' ? '3' : ''}</div>
              <div class="ri-rec__row"><span class="ri-rec__dot" aria-hidden="true"></span><span class="ri-rec__time" data-ri-time>0:00</span><span class="ri-rec__of">of ${clock(LIMITS.maxSeconds)}</span></div>
              <div class="ri-meter" role="meter" aria-label="Microphone level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-ri-meter><span></span></div>
            </div>
            <div class="ri-voice__actions">
              <button class="es-btn es-btn--primary" type="button" data-ri-stop ${name === 'countin' ? 'disabled' : ''}>${ICON.stop}<span>Stop</span></button>
              <button class="es-btn es-btn--tertiary" type="button" data-ri-cancel>Cancel</button>
            </div>`;
        } else if (name === 'review') {
          body.innerHTML = `<div class="ri-review"><p class="ri-review__title"><b>${rec.capped ? `Stopped at ${LIMITS.maxSeconds} seconds, the longest a voiceover can be.` : 'Listen back.'}</b></p>
              <audio controls src="${esc(rec.url)}" aria-label="Your take"></audio></div>
            <div class="ri-voice__actions">
              <button class="es-btn es-btn--primary" type="button" data-ri-use>${ICON.check}<span>Use this take</span></button>
              <button class="es-btn" type="button" data-ri-record>${ICON.mic}<span>Re-take</span></button>
              <button class="es-btn es-btn--tertiary" type="button" data-ri-cancel>Discard</button>
            </div>`;
        } else if (name === 'working') {
          body.innerHTML = '<div class="ri-working"><span class="es-skeleton ri-working__bar"></span><p class="rm-hint">This takes a few seconds. Keep this window open.</p></div>';
        }
        const focus = body.querySelector(name === 'idle' ? '[data-ri-record]' : (name === 'review' ? '[data-ri-use]' : '[data-ri-stop]:not(:disabled), [data-ri-cancel]'));
        if (focus && dialog.open) focus.focus();
      }
      function stopStream() {
        cancelAnimationFrame(rec.raf);
        clearInterval(rec.timer);
        rec.token += 1;
        if (rec.stream) rec.stream.getTracks().forEach(t => t.stop());
        rec.stream = null;
        rec.analyser = null;
        try { rec.source?.disconnect(); } catch { /* gone */ }
      }
      function dropTake() { if (rec.url) URL.revokeObjectURL(rec.url); rec.url = ''; rec.blob = null; rec.chunks = []; }
      const recorderType = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
      async function record() {
        setError('');
        setStatus('');
        dropTake();
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { setError('This browser cannot record. Upload a file instead.'); return; }
        let stream;
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }); } catch (error) {
          setError(error && (error.name === 'NotAllowedError' || error.name === 'SecurityError') ? 'Reels Studio is not allowed to use the microphone. Allow it in the browser’s address bar, or upload a file instead.' : 'No microphone was found. Plug one in, or upload a file instead.');
          return;
        }
        rec.stream = stream;
        rec.capped = false;
        const token = (rec.token += 1);
        view('countin');
        // Level meter (the mic is live during the count-in, so levels can be checked).
        try {
          const ac = audioContext();
          await ac.resume().catch(() => {});
          rec.source = ac.createMediaStreamSource(stream);
          rec.analyser = ac.createAnalyser();
          rec.analyser.fftSize = 1024;
          rec.source.connect(rec.analyser);
        } catch { rec.analyser = null; }
        const data = rec.analyser ? new Float32Array(rec.analyser.fftSize) : null;
        let lastAria = 0;
        const meter = () => {
          if (token !== rec.token) return;
          const el = body.querySelector('[data-ri-meter]');
          if (el && rec.analyser) {
            rec.analyser.getFloatTimeDomainData(data);
            let peak = 0;
            for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
            const level = Math.round(Math.min(1, Math.sqrt(peak) * 1.15) * 100);
            el.firstElementChild.style.width = `${level}%`;
            el.classList.toggle('is-hot', peak > 0.97);
            const now = performance.now();
            if (now - lastAria > 400) { el.setAttribute('aria-valuenow', String(level)); lastAria = now; }
          }
          rec.raf = requestAnimationFrame(meter);
        };
        meter();
        // 3-2-1.
        for (let n = 3; n >= 1; n -= 1) {
          const el = body.querySelector('[data-ri-count]');
          if (el) el.textContent = String(n);
          await new Promise(r => setTimeout(r, 1000));
          if (token !== rec.token) return;
        }
        const type = recorderType();
        try { rec.recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 128000 } : undefined); } catch { stopStream(); view('idle'); setError('This browser cannot record. Upload a file instead.'); return; }
        rec.chunks = [];
        rec.recorder.addEventListener('dataavailable', event => { if (event.data && event.data.size) rec.chunks.push(event.data); });
        rec.recorder.addEventListener('stop', () => {
          const blob = new Blob(rec.chunks, { type: rec.recorder.mimeType || type || 'audio/webm' });
          const cancelled = rec.cancelled;
          rec.cancelled = false;
          stopStream();
          if (cancelled || !blob.size) { view('idle'); if (!cancelled) setError('Nothing was recorded. Check the microphone and try again.'); return; }
          rec.blob = blob;
          rec.url = URL.createObjectURL(blob);
          view('review');
          setStatus(rec.capped ? `Stopped at ${LIMITS.maxSeconds} seconds.` : 'Recorded. Listen back, then use it or re-take.');
        });
        view('recording');
        body.querySelector('[data-ri-rec]')?.classList.add('is-live');
        const count = body.querySelector('[data-ri-count]');
        if (count) count.textContent = '';
        setStatus('Recording. Read your script.');
        rec.startedAt = performance.now();
        rec.recorder.start(250);
        rec.timer = setInterval(() => {
          const s = (performance.now() - rec.startedAt) / 1000;
          const el = body.querySelector('[data-ri-time]');
          if (el) el.textContent = clock(Math.floor(s));
          body.querySelector('[data-ri-rec]')?.classList.toggle('is-ending', s > LIMITS.maxSeconds - 10);
          if (s >= LIMITS.maxSeconds) { rec.capped = true; stopRecording(); }
        }, 200);
      }
      function stopRecording({ cancel = false } = {}) {
        clearInterval(rec.timer);
        rec.cancelled = cancel;
        if (rec.recorder && rec.recorder.state !== 'inactive') { try { rec.recorder.stop(); } catch { stopStream(); view('idle'); } } else { stopStream(); view('idle'); }
      }
      async function commit(run) {
        setError('');
        view('working');
        let out;
        try { out = await run(text => setStatus(text)); } catch (error) { out = { ok: false, error: (error && error.message) || 'That did not work. Try again.' }; }
        if (out && out.ok) { setStatus(''); dropTake(); view('idle'); dialog.close(); return; }
        setStatus('');
        view(rec.blob ? 'review' : 'idle');
        setError((out && out.error) || 'That did not work. Try again.');
      }
      dialog.addEventListener('click', event => {
        const on = sel => event.target.closest(sel);
        if (on('[data-ri-close]')) { dialog.close(); return; }
        if (on('[data-ri-record]')) { record(); return; }
        if (on('[data-ri-stop]')) { stopRecording(); return; }
        if (on('[data-ri-cancel]')) { if (rec.view === 'review') { dropTake(); setStatus(''); view('idle'); } else { rec.token += 1; stopRecording({ cancel: true }); } return; }
        if (on('[data-ri-upload]')) { filePick.click(); return; }
        if (on('[data-ri-use]') && rec.blob) { const blob = rec.blob; commit(onStatus => useTake(blob, { via: 'record', name: 'Recording', onStatus })); }
      });
      filePick.addEventListener('change', () => {
        const file = filePick.files[0];
        filePick.value = '';
        if (!file) return;
        dropTake();
        commit(onStatus => useFile(file, { onStatus }));
      });
      dialog.addEventListener('close', () => { rec.token += 1; if (rec.recorder && rec.recorder.state !== 'inactive') stopRecording({ cancel: true }); else stopStream(); dropTake(); setStatus(''); setError(''); opener?.focus?.(); });
      dialog.addEventListener('cancel', event => { if (rec.view === 'working') event.preventDefault(); });
      let opener = null;
      function open() {
        if (dialog.open) return;
        opener = document.activeElement;
        setError('');
        setStatus('');
        view('idle');
        dialog.showModal();
        body.querySelector('[data-ri-record]')?.focus();
      }

      // ── The inline panel (Voice fold; lane D can mount it anywhere) ──
      function panelHtml() {
        const v = own();
        if (lost && !v) {
          return `<div class="ri-vo ri-vo--lost">${ICON.warn}<div><p><b>This reel’s voiceover is not on this device.</b></p><p class="rm-hint">${esc(lost.name)} · ${clock(lost.seconds)}. Add the same file again and it drops back into place.</p></div>
            <div class="ri-vo__actions"><button class="es-btn es-btn--sm" type="button" data-ri-vo-open>Add it again</button><button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-ri-vo-remove>Skip</button></div></div>`;
        }
        if (!v) {
          return `<div class="ri-vo"><div><p><b>Use your own voice</b></p><p class="rm-hint">Record here or upload a file, up to ${LIMITS.maxSeconds} seconds. Scenes and captions follow your words.</p></div>
            <div class="ri-vo__actions"><button class="es-btn es-btn--sm" type="button" data-ri-vo-open>${ICON.mic}<span>Record or upload</span></button></div></div>`;
        }
        const beats = state.plan.beats.filter(b => v.windows[b.id]);
        const est = v.timing === 'estimated';
        return `<div class="ri-vo is-on"><div><p><b>Your recording</b> <span class="es-badge ${est ? 'es-badge--warn' : 'es-badge--good'}">${esc(TIMING[v.timing])}</span></p>
            <p class="rm-hint">${esc(v.name)} · ${clock(v.seconds)} · on ${beats.length} scene${beats.length === 1 ? '' : 's'}. ${est ? 'Scene starts are estimated from the word count: nudge any scene that starts early or late.' : 'The AI voice is paused while your recording is on.'}</p></div>
          <div class="ri-vo__actions"><button class="es-btn es-btn--sm" type="button" data-ri-vo-open>Replace</button><button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-ri-vo-remove>Remove</button></div>
          <details class="ri-nudge"${est ? ' open' : ''}><summary>Nudge scene starts</summary>
            <ul class="ri-nudge__list">${beats.map(b => {
              const w = v.windows[b.id];
              const n = state.plan.beats.indexOf(b) + 1;
              const shift = (w.nudgeMs || 0) / 1000;
              return `<li><span class="ri-nudge__name">Scene ${n}</span>
                <span class="ri-nudge__ctl" role="group" aria-label="Scene ${n} start">
                  <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-ri-nudge="${esc(b.id)}" data-d="-1" aria-label="Start scene ${n} earlier" title="0.1 s earlier">${ICON.minus}</button>
                  <output class="ri-nudge__val" aria-live="polite">${shift === 0 ? '0.0 s' : `${shift > 0 ? '+' : '−'}${Math.abs(shift).toFixed(1)} s`}</output>
                  <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-ri-nudge="${esc(b.id)}" data-d="1" aria-label="Start scene ${n} later" title="0.1 s later">${ICON.plus}</button>
                </span></li>`;
            }).join('')}</ul></details></div>`;
      }
      function renderPanels() {
        panels.forEach(el => {
          const active = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
          const key = active ? (active.dataset.riNudge ? `[data-ri-nudge="${active.dataset.riNudge}"][data-d="${active.dataset.d}"]` : (active.hasAttribute('data-ri-vo-open') ? '[data-ri-vo-open]' : '')) : '';
          const wasOpen = el.querySelector('.ri-nudge')?.open;
          el.innerHTML = panelHtml();
          if (wasOpen && el.querySelector('.ri-nudge')) el.querySelector('.ri-nudge').open = true;
          if (key) el.querySelector(key)?.focus();
        });
        // The Script source's "voiceover length" field is not needed once a voiceover is attached.
        const hint = document.getElementById('rm-script-vo-hint');
        if (hint) hint.textContent = own() ? 'Not needed: scenes follow your attached voiceover.' : 'Optional. Better: record or upload your voiceover and scenes follow it exactly.';
      }
      function mount(el) {
        if (!el) return null;
        el.classList.add('ri-vo-host');
        el.addEventListener('click', event => {
          if (event.target.closest('[data-ri-vo-open]')) { open(); return; }
          if (event.target.closest('[data-ri-vo-remove]')) { remove(); return; }
          const btn = event.target.closest('[data-ri-nudge]');
          if (btn) nudge(btn.dataset.riNudge, Number(btn.dataset.d) * LIMITS.nudgeStepMs);
        });
        panels.add(el);
        renderPanels();
        return el;
      }

      const api = { open, mount, active: () => Boolean(own()), pending: () => Boolean(lost) && !own(), remove, snapshot, restore, useFile, useTake, nudge, LIMITS };
      ctx.register('voiceInput', api);
      // Temporary entry points (lane D moves them into the new interface):
      //   1. a panel at the top of the "Voice and captions" fold (Review)
      //   2. a button under the Script source's "Voiceover length" field
      const fold = document.querySelector('#rm-voice .rm-fold__body');
      if (fold && !document.getElementById('ri-voice-panel')) {
        const el = document.createElement('div');
        el.id = 'ri-voice-panel';
        fold.prepend(el);
        mount(el);
      }
      const voField = document.getElementById('rm-script-vo');
      const row = voField && voField.closest('.rm-script-row');
      if (row && !document.getElementById('ri-script-voice')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'ri-script-voice';
        btn.className = 'es-btn es-btn--sm ri-script-voice';
        btn.innerHTML = `${ICON.mic}<span>Record or upload your voiceover</span>`;
        btn.addEventListener('click', open);
        row.after(btn);
      }
      ctx.on('rebuild', renderPanels);
    };
    if (window.ReelMakerCtx) start(window.ReelMakerCtx);
    else document.addEventListener('reelmaker:ready', event => start((event.detail && event.detail.ctx) || window.ReelMakerCtx), { once: true });
  }

  return { LIMITS, ACCEPT, TIMING, RIGHTS, checkFile, checkLength, mixDown, encodeWav, toBase64, beatLines, alignScript, alignBeats, heardFromChunks, evenSplit, cutWindows, clock, attach };
}));
