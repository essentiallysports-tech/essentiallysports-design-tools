// Reels Studio clip picker: which clip goes on which beat, and which part of
// it. One file for the browser (window.ReelClips), the server and the tests
// (require), like reel-formats.js.
//
//   subjectFor(beat, plan)            -> { key, terms, team, players }
//   heuristicScore(clip, subject)     -> { score, parts }   (free, always on)
//   judgedScore(clip, subject, j)     -> score with the vision judgement
//   motionEnergy(frames)              -> [0..1] per sample (tiny grey frames)
//   bestSegment(samples, beatSec, clipSec) -> { inSec, outSec, score }
//   assign(pool, beats, plan, opts)   -> { [beatId]: { clip, score, why, segment } }
//   preselect(pool, beats, plan, n)   -> the clips worth sampling and judging
//   judgeCost({ clips, frames, model }) -> USD estimate for one judge call
//   validateJudgement(raw, frameCount) -> a clean judgement or null
//   makeCache(storage)                -> judgements per clip URL (7 days)
//   sampleClip(video, opts)           -> browser only: frames + motion
//
// Ranking (per beat): relevance to the beat's subject (team or player, from
// the post text, the clip's tagged teams / players and, when AI is on, what a
// vision model saw in sampled frames), recency, quality (resolution, length,
// motion, a clean picture) and source (official team > league > media). The
// same clip is not reused while another good one is free; when a clip must be
// reused, a different segment of it is used.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelClips = api;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // The vision judge. Gemini 3.8 Flash: the newest Flash on the Gateway
  // (2026-11-18, $0.75 in / $3.75 out per 1M), strong on frames and sports
  // scenes, about $0.01 per reel for 8 clips x 3 frames. Claude Haiku 5.5
  // ($0.10 / $0.50, vision) is the fallback when Gemini fails.
  const JUDGE = {
    model: 'google/gemini-3.8-flash',
    fallback: 'anthropic/claude-haiku-5.5',
    maxUsdPerReel: 0.10,
    maxClips: 8,
    perCall: 3, // clips per request (keeps a request well under the body cap)
    framesPerClip: 3,
    frameWidth: 320,
    tokensPerFrame: 260, // Gemini counts a small image at ~258 tokens; Claude ~(w*h)/750
    promptTokens: 900,
    outTokensPerClip: 170,
    cacheDays: 7,
  };
  const PRICES = {
    'google/gemini-3.8-flash': { input: 0.75, output: 3.75 },
    'google/gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
    'anthropic/claude-haiku-5.5': { input: 0.10, output: 0.50 },
    'anthropic/claude-sonnet-5.5': { input: 2, output: 10 },
  };
  const KINDS = ['game-action', 'highlight-replay', 'celebration', 'practice', 'press-conference', 'interview', 'crowd-stadium', 'graphic-or-text', 'studio-talk', 'other'];
  // How much each kind of footage suits a reel beat (moving sport first).
  const KIND_FIT = { 'game-action': 1, 'highlight-replay': 0.95, celebration: 0.85, practice: 0.6, 'crowd-stadium': 0.5, interview: 0.45, 'press-conference': 0.4, 'studio-talk': 0.2, 'graphic-or-text': 0.1, other: 0.3 };
  const SOURCE_FIT = { official: 1, league: 0.85, media: 0.7, other: 0.35, fan: 0.35 };

  const norm = v => String(v == null ? '' : v).toLowerCase().normalize('NFKD').replace(/[^\w\s#]/g, ' ').replace(/\s+/g, ' ').trim();
  const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'his', 'her', 'their', 'from', 'into', 'what', 'just', 'now', 'look', 'other', 'stars', 'many', 'more', 'than', 'year', 'season', 'game', 'team', 'nfl', 'mlb', 'cfb', 'right', 'back', 'here', 'where', 'which', 'why', 'how', 'who', 'are', 'was', 'has', 'have', 'not', 'isn', 'your', 'our', 'out', 'over']);
  const tokens = v => norm(v).split(' ').filter(w => w.length > 2 && !STOP.has(w));

  // ─── Subject of a beat ───────────────────────────────────────────────────
  // The players or teams the beat is about: its photo query, versus names,
  // rank name and words of its text; the reel's team as a backstop.
  function subjectFor(beat = {}, plan = {}) {
    const team = plan.team && plan.team.name ? String(plan.team.name) : '';
    const named = [beat.photo, beat.name, ...(Array.isArray(beat.versus) ? beat.versus.map(v => v && v.name !== '?' ? (v.photo || v.name) : '') : [])].filter(Boolean).map(String);
    const players = named.filter(n => !team || norm(n) !== norm(team));
    const terms = [...new Set([...named.flatMap(tokens), ...tokens(beat.text).slice(0, 6)])];
    const key = norm(players[0] || team || beat.text || '').slice(0, 40) || 'reel';
    return { key, terms, team, teamTerms: tokens(team), players };
  }

  // ─── Free ranking (always on; the only ranking when AI is off) ──────────
  function overlap(words, text) {
    if (!words.length) return 0;
    const hay = ` ${norm(text)} `;
    const hits = words.filter(w => hay.includes(` ${w} `) || hay.includes(` ${w}s `));
    return hits.length / words.length;
  }
  function heuristicScore(clip = {}, subject = { terms: [], teamTerms: [], players: [] }) {
    const text = [clip.text, clip.handle, ...(clip.teams || []), ...(clip.players || [])].join(' ');
    const playerHit = subject.players.length ? Math.max(0, ...subject.players.map(p => overlap(tokens(p), text))) : 0;
    const teamHit = subject.teamTerms.length ? overlap(subject.teamTerms, text) : 0;
    const termHit = overlap(subject.terms, text);
    const relevance = Math.min(1, playerHit * 0.7 + teamHit * 0.35 + termHit * 0.4);
    const hours = Number(clip.ageHours);
    const recency = Number.isFinite(hours) ? Math.max(0, 1 - hours / 120) : 0.5;
    const side = Number(clip.shortSide) || Math.min(...(clip.variants || [{}]).map(v => Math.min(v.width || 0, v.height || 0) || 9999)) || 0;
    const res = side >= 1080 ? 1 : side >= 720 ? 0.85 : side >= 480 ? 0.5 : 0.3;
    const secs = (Number(clip.durationMs) || 0) / 1000;
    const length = secs >= 5 && secs <= 60 ? 1 : secs > 0 ? 0.6 : 0.7;
    const source = SOURCE_FIT[clip.source || clip.sourceKind] ?? 0.4;
    const parts = { relevance, recency, quality: res * 0.7 + length * 0.3, source };
    const score = 100 * (0.45 * parts.relevance + 0.15 * parts.recency + 0.2 * parts.quality + 0.2 * parts.source);
    return { score: Math.round(score * 10) / 10, parts };
  }

  // With a vision judgement: what is actually on screen counts most.
  function judgedScore(clip, subject, judgement) {
    const base = heuristicScore(clip, subject);
    if (!judgement) return { ...base, judged: false };
    const rel = judgement.relevance && Number.isFinite(judgement.relevance[subject.key]) ? judgement.relevance[subject.key] / 10 : null;
    const seen = [...(judgement.players || []), ...(judgement.teams || [])].join(' ');
    const seenHit = Math.max(subject.players.length ? Math.max(0, ...subject.players.map(p => overlap(tokens(p), seen))) : 0, overlap(subject.teamTerms, seen) * 0.8);
    const relevance = Math.min(1, Math.max(rel != null ? rel : 0, seenHit, base.parts.relevance * 0.6));
    const action = judgement.action.length ? judgement.action.reduce((a, b) => a + b, 0) / judgement.action.length / 10 : 0.5;
    const quality = Math.min(1, (judgement.quality / 10) * 0.6 + base.parts.quality * 0.25 + (judgement.textOverlay ? 0 : 0.15));
    const kind = KIND_FIT[judgement.kind] ?? 0.3;
    const parts = { relevance, recency: base.parts.recency, quality, source: base.parts.source, action, kind };
    const score = 100 * (0.38 * relevance + 0.1 * parts.recency + 0.16 * quality + 0.12 * parts.source + 0.12 * action + 0.12 * kind);
    return { score: Math.round(score * 10) / 10, parts, judged: true };
  }

  // ─── Best segment ────────────────────────────────────────────────────────
  // Motion energy between tiny grey frames (0..1 per sample).
  function motionEnergy(frames) {
    const list = (frames || []).filter(f => f && f.length);
    if (list.length < 2) return list.map(() => 0.5);
    const diffs = list.map((f, i) => {
      const g = list[i - 1] || list[i + 1];
      let sum = 0;
      for (let k = 0; k < f.length; k += 1) sum += Math.abs(f[k] - g[k]);
      return sum / f.length / 255;
    });
    const max = Math.max(...diffs, 1e-6);
    return diffs.map(d => Math.round((d / max) * 1000) / 1000);
  }
  // samples: [{ t (sec), motion 0..1, action 0..10 (judge, optional) }].
  // Slides a window of the beat's length over the clip (after the first
  // 0.4 s: team intros, black frames) and keeps the one with the most action.
  function bestSegment(samples, beatSec, clipSec, { skip = 0.4, step = 0.25, avoid = null } = {}) {
    const len = Math.max(0.5, Number(clipSec) || 0);
    const want = Math.max(0.5, Number(beatSec) || 2);
    const start0 = len > want + skip ? skip : 0;
    if (!samples || !samples.length || len <= want + start0) return { inSec: start0, outSec: len, score: 0 };
    const value = s => (Number.isFinite(s.action) ? 0.6 * (s.action / 10) + 0.4 * (s.motion ?? 0.5) : (s.motion ?? 0.5));
    const at = t => {
      // Linear interpolation between samples.
      const list = samples;
      if (t <= list[0].t) return value(list[0]);
      for (let i = 1; i < list.length; i += 1) if (t <= list[i].t) { const a = list[i - 1]; const b = list[i]; const k = (t - a.t) / Math.max(1e-6, b.t - a.t); return value(a) + (value(b) - value(a)) * k; }
      return value(list[list.length - 1]);
    };
    let best = { inSec: start0, outSec: Math.min(len, start0 + want), score: -1 };
    for (let s = start0; s + want <= len + 1e-6; s += step) {
      // avoid: [in, out] of a part already used on another beat.
      if (avoid && s < avoid[1] && s + want > avoid[0]) continue;
      let sum = 0; let n = 0;
      for (let t = s; t <= s + want + 1e-6; t += step / 2) { sum += at(t); n += 1; }
      const score = sum / n - (s > len * 0.6 ? 0.02 : 0); // a small lean to the start of the clip on a tie
      if (score > best.score + 1e-9) best = { inSec: Math.round(s * 100) / 100, outSec: Math.round(Math.min(len, s + want) * 100) / 100, score: Math.round(score * 1000) / 1000 };
    }
    return best;
  }

  // ─── Choosing the candidates to sample (free) ────────────────────────────
  function preselect(pool, beats, plan, n = JUDGE.maxClips) {
    const list = (pool || []).filter(c => c && c.url);
    if (list.length <= n) return list;
    const best = new Map();
    (beats || []).forEach(beat => {
      const subject = subjectFor(beat, plan);
      list.forEach(c => { const s = heuristicScore(c, subject).score; best.set(c.url, Math.max(best.get(c.url) || 0, s)); });
    });
    return [...list].sort((a, b) => (best.get(b.url) || 0) - (best.get(a.url) || 0)).slice(0, n);
  }

  // ─── Assignment (one clip per beat, no reuse while others are free) ────
  //   beats: [{ id, durMs, ...plan beat }]
  //   opts: { judgements: { [url]: judgement }, samples: { [url]: [{t, motion, action}] }, used: Set(urls already on other beats) }
  function assign(pool, beats, plan = {}, { judgements = {}, samples = {}, judgeTimes = {}, used = new Set(), minScore = 18 } = {}) {
    const out = {};
    const J = url => { const j = judgements[url]; return j ? (typeof j.actionAt === 'function' ? j : withActionAt(j, judgeTimes[url] || [])) : null; };
    const uses = new Map([...used].map(u => [u, 1]));
    // Beats with the most specific subject choose first.
    const order = [...(beats || [])].map((beat, i) => ({ beat, i, subject: subjectFor(beat, plan) }))
      .sort((a, b) => (b.subject.players.length - a.subject.players.length) || (a.i - b.i));
    order.forEach(({ beat, subject }) => {
      const ranked = (pool || []).map(clip => {
        const s = judgedScore(clip, subject, J(clip.url));
        const reused = uses.get(clip.url) || 0;
        // Reuse costs a lot: a free clip that is nearly as good wins.
        return { clip, score: s.score - reused * 30, raw: s, reused };
      }).sort((a, b) => b.score - a.score);
      const pick = ranked[0];
      if (!pick || pick.score < minScore) return;
      const clipSec = (Number(pick.clip.durationMs) || 6000) / 1000;
      const beatSec = Math.max(0.5, (Number(beat.durMs) || 2500) / 1000);
      const sm = (samples[pick.clip.url] || []).map((x, k) => ({ ...x, action: J(pick.clip.url) ? J(pick.clip.url).actionAt(k, x.t) : undefined }));
      let segment = bestSegment(sm, beatSec, clipSec);
      // A reused clip plays a different part: the best window away from the first.
      if (pick.reused) {
        const first = Object.values(out).find(o => o.clip.url === pick.clip.url);
        if (first && Math.abs(first.segment.inSec - segment.inSec) < beatSec) {
          const alt = bestSegment(sm, beatSec, clipSec, { avoid: [first.segment.inSec, first.segment.outSec] });
          if (alt.score >= 0) segment = alt;
        }
      }
      uses.set(pick.clip.url, (uses.get(pick.clip.url) || 0) + 1);
      const p = pick.raw.parts;
      const why = [
        p.relevance >= 0.5 ? `about ${subject.players[0] || subject.team || 'this beat'}` : '',
        pick.raw.judged && p.kind >= 0.85 ? 'game action' : '',
        p.source >= 0.85 ? 'official source' : '',
        p.recency >= 0.7 ? 'fresh' : '',
        pick.reused ? 'reused (no other clip fits)' : '',
      ].filter(Boolean).join(' · ');
      out[beat.id] = { clip: pick.clip, score: Math.round(pick.score * 10) / 10, judged: pick.raw.judged, why, segment };
    });
    return out;
  }

  // ─── The judgement (server output, validated on both sides) ─────────────
  const clampN = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  function validateJudgement(raw, frameCount = JUDGE.framesPerClip) {
    if (!raw || typeof raw !== 'object') return null;
    const action = (Array.isArray(raw.action) ? raw.action : []).slice(0, Math.max(1, frameCount)).map(v => clampN(v, 0, 10, 5));
    const relevance = {};
    if (raw.relevance && typeof raw.relevance === 'object') Object.entries(raw.relevance).slice(0, 12).forEach(([k, v]) => { relevance[norm(k).slice(0, 40)] = clampN(v, 0, 10, 0); });
    const list = (v, n) => (Array.isArray(v) ? v : []).map(x => String(x || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, n);
    return {
      kind: KINDS.includes(raw.kind) ? raw.kind : 'other',
      teams: list(raw.teams, 4),
      players: list(raw.players, 4),
      quality: clampN(raw.quality, 0, 10, 5),
      action,
      relevance,
      textOverlay: raw.textOverlay === true,
      note: String(raw.note || '').replace(/\s+/g, ' ').slice(0, 80),
    };
  }
  // The action score at sample k (judge frames are a subset of the samples:
  // spread evenly, so sample k maps to the nearest judged frame).
  function withActionAt(j, times = []) {
    if (!j) return null;
    return {
      ...j,
      actionAt(k, t) {
        if (!j.action.length) return undefined;
        if (times.length === j.action.length) {
          let best = 0;
          times.forEach((x, i) => { if (Math.abs(x - t) < Math.abs(times[best] - t)) best = i; });
          return j.action[best];
        }
        return j.action[Math.min(j.action.length - 1, Math.round((k / Math.max(1, times.length || j.action.length)) * (j.action.length - 1)))];
      },
    };
  }

  // ─── Cost ────────────────────────────────────────────────────────────────
  function judgeCost({ clips = 1, frames = JUDGE.framesPerClip, model = JUDGE.model } = {}) {
    const price = PRICES[model] || PRICES[JUDGE.model];
    const input = JUDGE.promptTokens + clips * (frames * JUDGE.tokensPerFrame + 80);
    const output = clips * JUDGE.outTokensPerClip;
    return (input * price.input + output * price.output) / 1e6;
  }
  // Estimate for a reel (cost panel): the clips we would judge, minus cached ones.
  function reelJudgeEstimate(candidates = JUDGE.maxClips, cached = 0) {
    const n = Math.max(0, Math.min(JUDGE.maxClips, candidates) - cached);
    if (!n) return 0;
    const calls = Math.ceil(n / JUDGE.perCall);
    return Math.min(JUDGE.maxUsdPerReel, judgeCost({ clips: n }) + (calls - 1) * (JUDGE.promptTokens * PRICES[JUDGE.model].input) / 1e6);
  }

  // ─── Cache (per clip URL) ────────────────────────────────────────────────
  function makeCache(storage, { key = 'frameup.reelClipJudge.v1', days = JUDGE.cacheDays, now = () => Date.now() } = {}) {
    let data = {};
    try { data = JSON.parse((storage && storage.getItem(key)) || '{}') || {}; } catch { data = {}; }
    const ttl = days * 864e5;
    const save = () => {
      const entries = Object.entries(data).sort((a, b) => b[1].at - a[1].at).slice(0, 300);
      data = Object.fromEntries(entries);
      try { if (storage) storage.setItem(key, JSON.stringify(data)); } catch { /* storage full or blocked */ }
    };
    return {
      get(url) { const e = data[url]; return e && now() - e.at < ttl ? e.j : null; },
      set(url, j) { if (!url || !j) return; data[url] = { at: now(), j }; save(); },
      size() { return Object.keys(data).length; },
    };
  }

  // ─── Browser: sample a clip (frames for the judge + motion) ─────────────
  // Seeks a <video> to `count` evenly spaced times; returns small JPEGs
  // (every k-th, for the judge) and grey 48x27 frames for motion energy.
  async function sampleClip(video, { count = 8, judgeFrames = JUDGE.framesPerClip, width = JUDGE.frameWidth, doc = typeof document !== 'undefined' ? document : null } = {}) {
    if (!video || !doc) return { samples: [], frames: [], times: [] };
    const dur = Math.max(0.5, video.duration || 0);
    const times = Array.from({ length: count }, (_, i) => Math.min(dur - 0.05, 0.2 + (i * (dur - 0.4)) / Math.max(1, count - 1)));
    const pickEvery = new Set(Array.from({ length: judgeFrames }, (_, i) => Math.round(((i + 0.5) * count) / judgeFrames - 0.5)));
    const big = doc.createElement('canvas');
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    big.width = width; big.height = Math.max(2, Math.round((width * vh) / vw));
    const small = doc.createElement('canvas');
    small.width = 48; small.height = 27;
    const bg = big.getContext('2d');
    const sg = small.getContext('2d', { willReadFrequently: true });
    const greys = [];
    const frames = [];
    const frameTimes = [];
    for (let i = 0; i < times.length; i += 1) {
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(done, 1500);
        video.addEventListener('seeked', done, { once: true });
        try { video.currentTime = times[i]; } catch { done(); }
      });
      try {
        sg.drawImage(video, 0, 0, 48, 27);
        const d = sg.getImageData(0, 0, 48, 27).data;
        const g = new Uint8Array(48 * 27);
        for (let k = 0; k < g.length; k += 1) g[k] = (d[k * 4] * 0.3 + d[k * 4 + 1] * 0.59 + d[k * 4 + 2] * 0.11) | 0;
        greys.push(g);
        if (pickEvery.has(i)) { bg.drawImage(video, 0, 0, big.width, big.height); frames.push(big.toDataURL('image/jpeg', 0.6)); frameTimes.push(times[i]); }
      } catch { greys.push(null); }
    }
    const motion = motionEnergy(greys.filter(Boolean));
    const samples = times.map((t, i) => ({ t: Math.round(t * 100) / 100, motion: motion[i] ?? 0.5 }));
    return { samples, frames, times: frameTimes };
  }

  return { JUDGE, PRICES, KINDS, KIND_FIT, SOURCE_FIT, subjectFor, heuristicScore, judgedScore, motionEnergy, bestSegment, preselect, assign, validateJudgement, withActionAt, judgeCost, reelJudgeEstimate, makeCache, sampleClip, norm };
}));
