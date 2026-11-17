// Reels Studio Moment Replay helpers (window.ReelReplay; Node for the tests).
// Code first, AI second (research §D.1): the browser samples the chosen clip
// segment, scores every sample for motion, scene change and sharpness, keeps
// 9 candidates (3 per third: setup, play, reaction) and either takes the code
// pick or sends the 9 small JPEGs to the server's frame-pick mode (Agent A),
// which answers with indices only. Then the editor can scrub each panel.
//
//   grey(rgba, w, h, outW, outH)       -> Uint8Array luminance, downsampled
//   sharpness(grey, w, h)              -> variance of a 3x3 Laplacian (focus)
//   sceneChange(a, b, bins)            -> 0..1 histogram distance (cuts)
//   motionSeries(greys)                -> 0..1 per sample (reel-clips idea)
//   candidateFrames(samples, opts)     -> { candidates: 9 in role order, best }
//   applyPick(cands, response, opts)   -> { frames, picker, captions, errors }
//   scrubberModel(replay) / scrub(model, role, t) / framesOf(model)
//                                       the panel scrubbers' data (pure)
//   panelLayout(style, canvas)         -> 3 panel rects + chip/caption anchors
//   buildSlides(timeline, opts)        -> carousel slide timelines (1080x1350)
//   sampleSegment(video, segment, o)   -> samples for candidateFrames (browser)
//
// Pure except sampleSegment and grabFrames (they need a <video> and a canvas).
// No network: the frame-pick request is the page's job (contract §2.1).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelReplay = api;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const ROLES = ['setup', 'play', 'reaction'];
  const ROLE_LABELS = { setup: 'SETUP', play: 'THE PLAY', reaction: 'REACTION' };
  const SAMPLE = { count: 24, width: 320, small: [48, 27], sharp: [160, 90], perRole: 3, minGapSec: 0.15, quality: 0.72 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round2 = v => Math.round(v * 100) / 100;

  // ─── Pixels ────────────────────────────────────────────────────────────
  // RGBA (ImageData.data) -> luminance at outW x outH (box filter).
  function grey(rgba, w, h, outW = w, outH = h) {
    const out = new Uint8Array(outW * outH);
    if (!rgba || !w || !h) return out;
    for (let y = 0; y < outH; y += 1) {
      const y0 = Math.floor((y * h) / outH);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / outH));
      for (let x = 0; x < outW; x += 1) {
        const x0 = Math.floor((x * w) / outW);
        const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / outW));
        let sum = 0;
        let n = 0;
        for (let yy = y0; yy < y1; yy += 1) {
          for (let xx = x0; xx < x1; xx += 1) {
            const k = (yy * w + xx) * 4;
            sum += rgba[k] * 0.299 + rgba[k + 1] * 0.587 + rgba[k + 2] * 0.114;
            n += 1;
          }
        }
        out[y * outW + x] = n ? Math.round(sum / n) : 0;
      }
    }
    return out;
  }
  // Focus: the variance of a 3x3 Laplacian. Motion blur and soft focus score low.
  function sharpness(g, w, h) {
    if (!g || w < 3 || h < 3) return 0;
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        const lap = g[i - w] + g[i + w] + g[i - 1] + g[i + 1] - 4 * g[i];
        sum += lap;
        sq += lap * lap;
        n += 1;
      }
    }
    if (!n) return 0;
    const mean = sum / n;
    return Math.round((sq / n - mean * mean) * 100) / 100;
  }
  // Scene change: half the L1 distance between two luminance histograms (0 same, 1 a hard cut).
  function sceneChange(a, b, bins = 32) {
    if (!a || !b || !a.length || !b.length) return 0;
    const hist = g => {
      const hh = new Float64Array(bins);
      for (let i = 0; i < g.length; i += 1) hh[Math.min(bins - 1, Math.floor((g[i] / 256) * bins))] += 1;
      for (let i = 0; i < bins; i += 1) hh[i] /= g.length;
      return hh;
    };
    const ha = hist(a);
    const hb = hist(b);
    let d = 0;
    for (let i = 0; i < bins; i += 1) d += Math.abs(ha[i] - hb[i]);
    return Math.round((d / 2) * 1000) / 1000;
  }
  // Motion per sample (mean absolute difference to the previous sample),
  // normalised to the clip's own peak, like reel-clips.js motionEnergy.
  function motionSeries(greys) {
    const list = greys || [];
    if (list.length < 2) return list.map(() => 0.5);
    const diffs = list.map((f, i) => {
      const g = list[i - 1] || list[i + 1];
      if (!f || !g || f.length !== g.length) return 0;
      let sum = 0;
      for (let k = 0; k < f.length; k += 1) sum += Math.abs(f[k] - g[k]);
      return sum / f.length / 255;
    });
    const max = Math.max(...diffs, 1e-6);
    return diffs.map(d => Math.round((d / max) * 1000) / 1000);
  }

  // ─── Candidates (code pick) ────────────────────────────────────────────
  // samples: [{ t, motion 0..1, scene 0..1, sharp >= 0, jpeg? }] in time order.
  // The segment splits into thirds:
  //   setup    low motion, sharp (pre-snap, the set position)
  //   play     the motion peak
  //   reaction after the peak, a scene change (celebration, bench), sharp
  // Blurred frames (sharpness under a quarter of the median) drop out unless
  // a third has nothing else. Returns 9 candidates (3 per role, best first,
  // role order) and the best of each role.
  function candidateFrames(samples, { perRole = SAMPLE.perRole, segment = null } = {}) {
    const list = (samples || []).filter(s => s && Number.isFinite(s.t)).map((s, index) => ({ ...s, index })).sort((a, b) => a.t - b.t);
    if (!list.length) return { candidates: [], best: {}, thirds: [] };
    const t0 = segment && Number.isFinite(segment.in) ? segment.in : list[0].t;
    const t1 = segment && Number.isFinite(segment.out) ? segment.out : list[list.length - 1].t + 1e-6;
    const span = Math.max(1e-6, t1 - t0);
    const sharpVals = list.map(s => Number(s.sharp) || 0).sort((a, b) => a - b);
    const median = sharpVals[Math.floor(sharpVals.length / 2)] || 0;
    const maxSharp = Math.max(...sharpVals, 1e-6);
    const blurred = s => median > 0 && (Number(s.sharp) || 0) < median * 0.25;
    const sh = s => (Number(s.sharp) || 0) / maxSharp;
    const mo = s => clamp(Number(s.motion) || 0, 0, 1);
    const sc = s => clamp(Number(s.scene) || 0, 0, 1);
    const peak = list.reduce((m, s) => (mo(s) > mo(m) ? s : m), list[0]);
    const thirdOf = s => clamp(Math.floor(((s.t - t0) / span) * 3), 0, 2);
    const scorers = {
      setup: s => 0.55 * (1 - mo(s)) + 0.45 * sh(s),
      play: s => 0.75 * mo(s) + 0.25 * sh(s),
      reaction: s => 0.45 * sc(s) + 0.3 * sh(s) + 0.25 * mo(s) + (s.t > peak.t ? 0.15 : 0),
    };
    const thirds = [[], [], []];
    list.forEach(s => thirds[thirdOf(s)].push(s));
    const candidates = [];
    const best = {};
    ROLES.forEach((role, r) => {
      // A third with no samples borrows the nearest samples of the whole segment.
      let pool = thirds[r].length ? thirds[r] : [...list].sort((a, b) => Math.abs(a.t - (t0 + span * (r + 0.5) / 3)) - Math.abs(b.t - (t0 + span * (r + 0.5) / 3))).slice(0, perRole);
      const sharpOnes = pool.filter(s => !blurred(s));
      if (sharpOnes.length) pool = sharpOnes;
      const ranked = pool.map(s => ({ s, score: Math.round(scorers[role](s) * 1000) / 1000 })).sort((a, b) => b.score - a.score || a.s.t - b.s.t).slice(0, perRole);
      ranked.forEach(({ s, score }) => candidates.push({ role, t: round2(s.t), index: s.index, score, motion: mo(s), scene: sc(s), sharp: Number(s.sharp) || 0, jpeg: s.jpeg || '' }));
      if (ranked[0]) best[role] = { role, t: round2(ranked[0].s.t), index: ranked[0].s.index };
    });
    return { candidates, best, thirds: [0, 1, 2].map(i => ({ in: round2(t0 + (span * i) / 3), out: round2(t0 + (span * (i + 1)) / 3) })) };
  }
  // The code pick as replay frames (always available, free).
  function codePick(result) {
    const best = (result && result.best) || {};
    return ROLES.filter(r => best[r]).map(r => ({ role: r, t: best[r].t }));
  }
  // The server's frame-pick answer (contract §2.1: indices into the 9
  // candidates, never images) -> replay frames. Bad indices, a role order
  // that runs backwards in time, or a failed call all fall back to the code pick.
  function applyPick(cands, response) {
    const list = Array.isArray(cands) ? cands : (cands && cands.candidates) || [];
    // The code pick: each role's best candidate (they come best first).
    const code = cands && cands.best ? codePick(cands) : ROLES.map(role => list.find(c => c.role === role)).filter(Boolean).map(c => ({ role: c.role, t: c.t }));
    const fallback = { frames: code, picker: 'code', captions: {}, errors: [] };
    if (!response || response.ok !== true) return { ...fallback, errors: ['frame-pick unavailable'] };
    const errors = [];
    const frames = [];
    ROLES.forEach(role => {
      const i = response[role];
      if (!Number.isInteger(i) || i < 0 || i >= list.length) { errors.push(`${role}: index ${i} out of range`); return; }
      frames.push({ role, t: list[i].t });
    });
    if (frames.length === 3 && !(frames[0].t <= frames[1].t && frames[1].t <= frames[2].t)) errors.push('frames out of order');
    if (errors.length) return { ...fallback, errors };
    const captions = {};
    const cap = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 6).join(' ');
    ROLES.forEach(role => { const c = cap(response.captions && response.captions[role]); if (c) captions[role] = c; });
    frames.forEach(f => { if (captions[f.role]) f.caption = captions[f.role]; });
    return { frames, picker: 'ai', captions, errors, cost: Number(response.cost) || 0, model: String(response.model || '') };
  }

  // ─── Panel scrubbers (data model for the UI) ───────────────────────────
  // One slider per panel. Each role keeps to its third of the segment and the
  // three stay in order (setup <= play <= reaction, 0.15 s apart).
  function scrubberModel(replay, { clipSec = null } = {}) {
    const seg = replay && replay.segment && replay.segment.out > replay.segment.in ? replay.segment : { in: 0, out: Math.max(0.5, Number(clipSec) || 6) };
    const span = seg.out - seg.in;
    const frames = (replay && Array.isArray(replay.frames)) ? replay.frames : [];
    const panels = ROLES.map((role, i) => {
      const lo = round2(seg.in + (span * i) / 3);
      const hi = round2(seg.in + (span * (i + 1)) / 3);
      const f = frames.find(x => x && x.role === role);
      const t = f && Number.isFinite(f.t) ? f.t : round2((lo + hi) / 2);
      return { role, label: ROLE_LABELS[role], min: round2(seg.in), max: round2(seg.out), third: { in: lo, out: hi }, t: round2(clamp(t, seg.in, seg.out)), step: 0.04, caption: f && f.caption ? String(f.caption) : '' };
    });
    return { segment: { in: seg.in, out: seg.out }, panels, picker: (replay && replay.picker) || 'code' };
  }
  function scrub(model, role, t) {
    if (!model || !Array.isArray(model.panels)) return model;
    const i = ROLES.indexOf(role);
    if (i < 0 || !Number.isFinite(Number(t))) return model;
    const gap = SAMPLE.minGapSec;
    const panels = model.panels.map(p => ({ ...p }));
    const lo = i > 0 ? panels[i - 1].t + gap : model.segment.in;
    const hi = i < 2 ? panels[i + 1].t - gap : model.segment.out;
    panels[i].t = round2(clamp(Number(t), Math.min(lo, hi), Math.max(lo, hi)));
    return { ...model, panels, picker: 'manual' };
  }
  function framesOf(model) {
    return (model && model.panels ? model.panels : []).map(p => ({ role: p.role, t: p.t, ...(p.caption ? { caption: p.caption } : {}) }));
  }

  // ─── Layout ────────────────────────────────────────────────────────────
  // Three stacked panels. Reel (1080x1920): x 88-992 from y 456 (clear of the
  // ES mark and its 50 px clear space) to 1560. Slide (1080x1350): x 60-1020
  // from y 214 (under the slide's mark row) to 1290. 8 px gutters; Classic
  // gets hard 6 px ink borders and a slight alternating 0.5 degree tilt (the
  // comic-strip grammar); the others keep straight frames.
  function panelLayout(style, canvas) {
    const id = typeof style === 'string' ? style : (style && style.id) || 'classic';
    const slide = canvas && Number(canvas.h) === 1350;
    const box = slide ? { x: 60, y: 214, w: 960, h: 1076 } : { x: 88, y: 456, w: 904, h: 1104 };
    const gutter = 8;
    const h = Math.floor((box.h - gutter * 2) / 3);
    const border = id === 'classic' ? 6 : (id === 'series' ? 4 : 0);
    const radius = id === 'countdown' ? 20 : (id === 'explainer' ? 4 : 0);
    const panels = ROLES.map((role, i) => ({
      role, label: ROLE_LABELS[role], x: box.x, y: box.y + i * (h + gutter), w: box.w, h,
      tilt: id === 'classic' ? (i % 2 === 0 ? -0.5 : 0.5) : 0,
      chip: { x: box.x + 20, y: box.y + i * (h + gutter) + 20 },
      caption: { x: box.x + 20, y: box.y + i * (h + gutter) + h - 20 },
    }));
    return { box, gutter, border, radius, panels };
  }

  // ─── Carousel slides (1080x1350) ───────────────────────────────────────
  // A slide timeline per timeline.slides[] entry (or a default set built from
  // the beats): the same data block, one beat of the slide's kind. The
  // renderer (ReelRender.drawFrame) draws a 1350-high canvas as a slide.
  const SLIDE_MS = 2400;
  const clean = (v, max = 200) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  function defaultSlides(tl) {
    const out = [];
    const beats = Array.isArray(tl.beats) ? tl.beats : [];
    const hook = beats.find(b => b.kind === 'hook');
    out.push({ id: 's1', kind: 'cover', text: clean((hook && hook.text) || tl.title, 80), refs: tl.replay ? ['frame:play'] : [] });
    beats.forEach(b => {
      if (out.length >= 19) return;
      const refs = Array.isArray(b.refs) ? b.refs : [];
      if (b.kind === 'panel3') ROLES.forEach(role => { if (refs.includes(`frame:${role}`)) out.push({ id: `s${out.length + 1}`, kind: 'panel', text: ROLE_LABELS[role], refs: [`frame:${role}`], beat: b.id }); });
      else if (b.kind === 'moment') out.push({ id: `s${out.length + 1}`, kind: 'moment', text: clean(b.text, 120), refs, beat: b.id });
      else if (b.kind === 'play' || b.kind === 'wpline') out.push({ id: `s${out.length + 1}`, kind: 'data', text: clean(b.text, 120), refs, beat: b.id });
    });
    const cta = [...beats].reverse().find(b => b.kind === 'cta');
    if (cta) out.push({ id: `s${out.length + 1}`, kind: 'cta', text: clean(cta.text, 120), refs: [] });
    return out.slice(0, 20);
  }
  function buildSlides(timeline, { style = '' } = {}) {
    const tl = timeline || {};
    const list = Array.isArray(tl.slides) && tl.slides.length ? tl.slides : defaultSlides(tl);
    const total = Math.min(20, list.length);
    return list.slice(0, 20).map((s, i) => {
      const refs = (Array.isArray(s.refs) ? s.refs : []).map(String).slice(0, 8);
      const beat = s.beat && Array.isArray(tl.beats) ? tl.beats.find(b => b.id === s.beat) : null;
      const kind = ['cover', 'panel', 'moment', 'data', 'cta'].includes(s.kind) ? s.kind : 'panel';
      const slide = { id: clean(s.id, 4) || `s${i + 1}`, kind, text: clean(s.text, 140), caption: clean(s.caption, 80), asset: clean(s.asset, 80), beat: s.beat || null, refs, index: i, total };
      return {
        v: 2, fps: 30, canvas: { w: 1080, h: 1350 }, size: [1080, 1350], outputs: ['carousel'], durationMs: SLIDE_MS,
        format: tl.format || 'replay', tag: tl.tag || '', sport: tl.sport || '', title: tl.title || '', style: style || tl.style || 'classic',
        team: tl.team || null, highlight: tl.highlight || '#0A6FDE', captionStyle: 'block', voice: { mode: 'off' },
        data: tl.data || { game: null, athlete: null, archive: null }, replay: tl.replay || null,
        slide,
        beats: [{ id: slide.id, kind: `slide-${kind}`, inMs: 0, outMs: SLIDE_MS, text: slide.text, refs, beatText: beat ? beat.text : '' }],
        tracks: { video: [], graphics: [{ id: `${slide.id}g`, beat: slide.id, template: `slide-${kind}`, kind: `slide-${kind}`, inMs: 0, outMs: SLIDE_MS, index: i, data: { text: slide.text, caption: slide.caption, refs } }], captions: { style: 'block', words: [], cards: [] }, audio: [] },
        assets: tl.assets || {}, sources: tl.sources || [], corpus: tl.corpus || '', slides: [],
      };
    });
  }
  // File names for the carousel zip: 01-cover.png, 02-panel.png...
  function slideFileNames(slides, prefix = '') {
    const pad = n => String(n).padStart(2, '0');
    return (slides || []).map((s, i) => `${prefix}${pad(i + 1)}-${(s.slide && s.slide.kind) || 'slide'}.png`);
  }

  // ─── Browser: sample the segment, grab full-size frames ───────────────
  const seek = (video, t) => new Promise(resolve => {
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, 1500);
    video.addEventListener('seeked', done, { once: true });
    try { video.currentTime = t; } catch { done(); }
  });
  // 24 samples over the segment: a 48x27 grey (motion, scene) and a 160x90
  // grey (sharpness), plus a 320 px JPEG for the frame-pick candidates.
  async function sampleSegment(video, segment, { count = SAMPLE.count, width = SAMPLE.width, doc = typeof document !== 'undefined' ? document : null } = {}) {
    if (!video || !doc) return [];
    const dur = Math.max(0.5, Number(video.duration) || 0);
    const a = clamp(Number(segment && segment.in) || 0, 0, dur - 0.1);
    const b = clamp(Number(segment && segment.out) || dur, a + 0.1, dur);
    const times = Array.from({ length: count }, (_, i) => round2(a + ((i + 0.5) * (b - a)) / count));
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    const big = doc.createElement('canvas');
    big.width = width; big.height = Math.max(2, Math.round((width * vh) / vw));
    const bg = big.getContext('2d', { willReadFrequently: true });
    const out = [];
    let prev = null;
    for (const t of times) {
      await seek(video, t);
      try {
        bg.drawImage(video, 0, 0, big.width, big.height);
        const data = bg.getImageData(0, 0, big.width, big.height).data;
        const small = grey(data, big.width, big.height, SAMPLE.small[0], SAMPLE.small[1]);
        const mid = grey(data, big.width, big.height, SAMPLE.sharp[0], SAMPLE.sharp[1]);
        out.push({ t, small, scene: prev ? sceneChange(prev, small) : 0, sharp: sharpness(mid, SAMPLE.sharp[0], SAMPLE.sharp[1]), jpeg: big.toDataURL('image/jpeg', SAMPLE.quality) });
        prev = small;
      } catch { out.push({ t, small: null, scene: 0, sharp: 0, jpeg: '' }); }
    }
    const motion = motionSeries(out.map(s => s.small));
    return out.map((s, i) => ({ t: s.t, motion: motion[i] ?? 0.5, scene: s.scene, sharp: s.sharp, jpeg: s.jpeg }));
  }
  // The three chosen times at full size, as canvases the renderer draws
  // (env.images['frame:setup'] ...). No upload: the frames stay in the page.
  async function grabFrames(video, frames, { doc = typeof document !== 'undefined' ? document : null, maxWidth = 1920 } = {}) {
    const out = {};
    if (!video || !doc) return out;
    for (const f of frames || []) {
      await seek(video, f.t);
      const vw = video.videoWidth || 16;
      const vh = video.videoHeight || 9;
      const k = Math.min(1, maxWidth / vw);
      const c = doc.createElement('canvas');
      c.width = Math.round(vw * k); c.height = Math.round(vh * k);
      try { c.getContext('2d').drawImage(video, 0, 0, c.width, c.height); out[`frame:${f.role}`] = c; } catch { /* tainted or not ready: the panel shows its empty state */ }
    }
    return out;
  }
  // The frame-pick request body (contract §2.1): <= 9 frames, <= 220 KB.
  function pickRequest(cands, { clipUrl = '', segment = null, budgetUsd = 0.02, maxBytes = 220 * 1024 } = {}) {
    const list = (Array.isArray(cands) ? cands : (cands && cands.candidates) || []).slice(0, 9);
    const frames = [];
    const times = [];
    let size = 400;
    list.forEach(c => {
      if (!c.jpeg || size + c.jpeg.length > maxBytes) return;
      frames.push(c.jpeg); times.push(c.t); size += c.jpeg.length + 8;
    });
    return { mode: 'frame-pick', clipUrl: String(clipUrl || ''), segment: segment ? { in: segment.in, out: segment.out } : null, frames, times, budgetUsd };
  }

  return {
    ROLES, ROLE_LABELS, SAMPLE, SLIDE_MS,
    grey, sharpness, sceneChange, motionSeries, candidateFrames, codePick, applyPick, pickRequest,
    scrubberModel, scrub, framesOf, panelLayout, buildSlides, defaultSlides, slideFileNames,
    sampleSegment, grabFrames,
  };
}));
