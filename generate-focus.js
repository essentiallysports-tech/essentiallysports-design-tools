/*
 * Generate · the design focus view (the Creative environment).
 *
 * Click a composed design and it opens big, Figma-style:
 *   top bar    back to results · design n of N · prev / next · size switch
 *              (4:5 1080×1350 · 9:16 1080×1920 · 1:1 1080×1080) · undo / redo ·
 *              PNG / JPG · Open in editor (only when the editor can take it)
 *   left rail  every design of the run, to jump between them
 *   stage      the design drawn at full quality, Fit or 100 %, with a layer
 *              outline when a layer is hovered in the panel
 *   panel      Assistant (#gen-assistant-slot, filled by generate-assistant.js) ·
 *              Director (score, strengths, what could be better + Apply, next
 *              time) · Layers (text edits, swap photo) · History (every version,
 *              restore any)
 *
 * Contract with the assistant (generate-assistant.js, another branch):
 *   window.FrameUpAssistant.mount(slotEl, { getScene, setScene, designId, runId })
 *   window.FrameUpAssistant.applyImprovement(designId, improvementId)
 *   'frameup:design-changed' events ({ detail: { designId, scene?, label? } })
 * Until that file exists the slot says so politely; the rest works on its own.
 *
 * The pure helpers (History, reframe, cleanStory, estimateCost, critiqueFor,
 * relTime) are also exported for Node tests (scripts/test-gen-ui.mjs).
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpFocus = api;
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  // ─── Pure helpers ───────────────────────────────────────────────────────
  const clone = value => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Story text without the labels a trend brief carries ("Story: …", "Sport: …").
  function cleanStory(text) {
    return String(text || '')
      .replace(/(^|\n|\s)(?:Story|Team|Sport|League|Headline)\s*:\s*/gi, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Estimated AI cost of one run, per number of designs. Creative: the art
  // director (scales a little with output), the vision judge (3 small renders a
  // design) and assets (cut-outs, concept art; often cached). Templates: one
  // writer call plus checks. Shown as an estimate, never as a bill; the run's
  // real cost replaces it in the summary.
  const COST = {
    creative: { base: 0.006, director: 0.0012, judge: 0.0028, assets: 0.03 },
    templates: { base: 0.004, perDesign: 0.0035 },
  };
  function estimateCost(count, look = 'creative') {
    const n = Math.max(1, Math.min(8, Number(count) || 4));
    if (look === 'templates') {
      const t = COST.templates;
      return Number((t.base + Math.min(n, 4) * t.perDesign).toFixed(3));
    }
    const range = estimateRange(n, look);
    if (range) return range.high;
    const c = COST.creative;
    return Number((c.base + n * (c.director + c.judge + c.assets)).toFixed(3));
  }
  // One source of truth for Creative: the assistant engine's costEstimate(n)
  // (generate-assistant.js mirrors the server's budgetFor: 3 candidates up to 4
  // designs, 2 above). { low, high, label } or null when it is not loaded.
  function assistantEngine() {
    if (root && root.FrameUpAssistant?.costEstimate) return root.FrameUpAssistant;
    try { return typeof require === 'function' ? require('./generate-assistant.js') : null; } catch (error) { return null; }
  }
  function estimateRange(count, look = 'creative') {
    if (look === 'templates') return null;
    const engine = assistantEngine();
    return engine?.costEstimate ? engine.costEstimate(Math.max(1, Math.min(8, Number(count) || 4))) : null;
  }

  // ─── ETA: how long a run takes (gen v4) ──────────────────────────────
  // A model by look, number of designs and whether a named person means photo
  // search + cut-outs, then corrected by this browser's own past runs (the
  // median of actual / model over the last 12 runs of that look; the more runs,
  // the more it trusts them). Shown before a run and live while it runs.
  const ETA_KEY = 'frameup.generate.durations.v1';
  function etaModel({ look = 'creative', count = 4, people = true } = {}) {
    const n = Math.max(1, Math.min(8, Math.round(Number(count) || 4)));
    if (look === 'templates') return 12 + 3 * Math.min(n, 4);
    // Research + art director ~22 s, compose / judge ~5 s a design, photos and
    // cut-outs for a named person ~14 s (concept art only: ~4 s).
    return 22 + 5 * n + (people ? 14 : 4);
  }
  function etaEstimate(history = [], params = {}) {
    const look = params.look === 'templates' ? 'templates' : 'creative';
    const base = etaModel({ ...params, look });
    const runs = (Array.isArray(history) ? history : []).filter(h => h && h.look === look && Number(h.s) > 3 && Number(h.s) < 400).slice(-12);
    if (!runs.length) return { seconds: Math.round(base), base: Math.round(base), learned: 0 };
    const ratios = runs.map(h => Number(h.s) / etaModel(h)).sort((a, b) => a - b);
    const mid = ratios.length % 2 ? ratios[(ratios.length - 1) / 2] : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2;
    const ratio = Math.max(0.4, Math.min(3, mid));
    const trust = Math.min(1, runs.length / 4);
    return { seconds: Math.round(base * (1 - trust + trust * ratio)), base: Math.round(base), learned: runs.length };
  }
  function etaRecord(history = [], run = {}) {
    const s = Math.round(Number(run.s) || 0);
    const list = Array.isArray(history) ? history.filter(Boolean) : [];
    if (s < 3 || s > 400) return list.slice(-30);
    return [...list, { look: run.look === 'templates' ? 'templates' : 'creative', count: Math.max(1, Math.min(8, Number(run.count) || 4)), people: Boolean(run.people), s, at: Number(run.at) || Date.now() }].slice(-30);
  }
  // "about 45 s", "about 1 min", "about 1 min 20 s" (to the nearest 5 s).
  function etaLabel(seconds) {
    const t = Math.max(5, Math.round((Number(seconds) || 0) / 5) * 5);
    if (t < 60) return `about ${t} s`;
    const m = Math.floor(t / 60);
    const r = t - m * 60;
    return `about ${m} min${r ? ` ${r} s` : ''}`;
  }
  // "0:42" for the running clock.
  const clock = seconds => { const t = Math.max(0, Math.floor(Number(seconds) || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  // Live progress: { pct, over, text }. Honest when it runs long: the bar stops
  // short of the end and the text says it is taking longer than usual.
  function etaProgress(elapsed, estimate, { limit = 180 } = {}) {
    const e = Math.max(0, Number(elapsed) || 0);
    const est = Math.max(5, Number(estimate) || 60);
    if (e <= est) {
      const left = Math.max(5, Math.round((est - e) / 5) * 5);
      return { pct: Math.round((e / est) * 90), over: false, text: e < 3 ? `Usually takes ${etaLabel(est)}` : `${etaLabel(left).replace(/^about /, 'About ')} left` };
    }
    const pct = Math.min(97, Math.round(90 + 7 * (1 - Math.exp(-(e - est) / est))));
    if (e > limit - 30) return { pct, over: true, text: `Still working. A run stops at ${Math.round(limit / 60)} min; you'll see a notice if it does` };
    if (e > est * 1.15) return { pct, over: true, text: `Taking longer than usual (usually ${etaLabel(est).replace(/^about /, '')})` };
    return { pct, over: false, text: 'Almost there' };
  }
  function etaHistory() {
    try { const list = JSON.parse(root.localStorage?.getItem(ETA_KEY) || '[]'); return Array.isArray(list) ? list : []; } catch (error) { return []; }
  }
  function etaSave(run) {
    try { root.localStorage?.setItem(ETA_KEY, JSON.stringify(etaRecord(etaHistory(), run))); } catch (error) { /* private mode */ }
  }

  // "now", "12m", "3h", "2d" (a trend's freshness, a recent brief's age).
  function relTime(then, now = Date.now()) {
    const t = typeof then === 'number' ? then : Date.parse(then || '');
    if (!Number.isFinite(t)) return '';
    const m = Math.max(0, Math.round((now - t) / 60000));
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h`;
    return `${Math.round(h / 24)}d`;
  }

  // Version history for one design: linear undo / redo, restore any version
  // (a restore is a new version, so nothing is ever lost). Typing in a text
  // field folds into one version per field burst.
  class History {
    constructor(scene, label = 'Original', { max = 60 } = {}) {
      this.max = max;
      this.entries = [{ scene: clone(scene), label, source: 'start', at: Date.now() }];
      this.index = 0;
    }
    get current() { return this.entries[this.index].scene; }
    get canUndo() { return this.index > 0; }
    get canRedo() { return this.index < this.entries.length - 1; }
    push(scene, label = 'Edit', source = 'edit', { coalesce = false, now = Date.now() } = {}) {
      const top = this.entries[this.index];
      if (same(top.scene, scene)) return false;
      this.entries = this.entries.slice(0, this.index + 1);
      if (coalesce && this.index > 0 && top.source === source && top.label === label && now - top.at < 1500) {
        top.scene = clone(scene);
        top.at = now;
        return true;
      }
      this.entries.push({ scene: clone(scene), label, source, at: now });
      // Keep the original; drop the oldest edit after it.
      if (this.entries.length > this.max) this.entries.splice(1, 1);
      this.index = this.entries.length - 1;
      return true;
    }
    undo() { if (this.canUndo) this.index -= 1; return this.current; }
    redo() { if (this.canRedo) this.index += 1; return this.current; }
    restore(i) {
      const entry = this.entries[i];
      if (!entry) return this.current;
      if (i === this.index) return this.current;
      this.push(entry.scene, `Restored: ${entry.label}`, 'restore');
      return this.current;
    }
  }

  // Another canvas size for a composed scene (the no-network path; a scene
  // rebuilt from its inputs, when the server sends them, is better).
  //   Taller (9:16): full-bleed layers stretch; every other layer keeps its
  //     anchor: the top third stays, the bottom third moves with the bottom
  //     edge, the middle moves half way.
  //   Shorter (1:1): the composition scales down as one group inside the safe
  //     area, centred, type sizes too, so nothing overlaps; full-bleed layers
  //     still fill the canvas.
  const SIZE_KEYS = { portrait: { w: 1080, h: 1350 }, story: { w: 1080, h: 1920 }, square: { w: 1080, h: 1080 } };
  const SAFE = 50;
  const SCALED = ['size', 'minSize', 'labelSize', 'unitSize'];
  function sizeKeyOf(scene) {
    const s = scene?.size || {};
    return Object.keys(SIZE_KEYS).find(k => SIZE_KEYS[k].w === s.w && SIZE_KEYS[k].h === s.h) || 'portrait';
  }
  function reframe(scene, key) {
    const size = SIZE_KEYS[key];
    if (!size || !scene?.size) return null;
    const W = scene.size.w;
    const H0 = scene.size.h;
    const H1 = size.h;
    const next = clone(scene);
    if (H0 === H1) return next;
    const dH = H1 - H0;
    const k = (H1 - SAFE * 2) / (H0 - SAFE * 2);
    next.layers.forEach(layer => {
      const hasBox = typeof layer.y === 'number';
      const fill = layer.type === 'background' || !hasBox || (['photo', 'cutout', 'shape'].includes(layer.type) && (layer.h || 0) >= H0 * 0.6 && (layer.w || W) >= W * 0.6);
      if (!hasBox) return;
      if (fill) {
        layer.y = Math.round(layer.y * (H1 / H0));
        if (typeof layer.h === 'number') layer.h = Math.round(layer.h * (H1 / H0));
        return;
      }
      if (dH < 0) {
        layer.y = Math.round(SAFE + (layer.y - SAFE) * k);
        if (typeof layer.x === 'number') layer.x = Math.round(W / 2 + (layer.x - W / 2) * k);
        ['w', 'h', ...SCALED].forEach(prop => { if (typeof layer[prop] === 'number') layer[prop] = Math.round(layer[prop] * k); });
        return;
      }
      const c = (layer.y + (layer.h || 0) / 2) / H0;
      if (c > 2 / 3) layer.y = Math.round(layer.y + dH);
      else if (c >= 1 / 3) layer.y = Math.round(layer.y + dH / 2);
    });
    next.size = { w: size.w, h: size.h };
    return next;
  }

  // The critique for a design: the art director's (another branch adds
  // design.critique = { strengths, improvements:[{id,text,fix}], nextTime })
  // or, until then, the free quick check's issues as improvements.
  function critiqueFor({ verdict = {}, dir = {}, scene = {}, report = null } = {}) {
    const given = verdict.critique || dir.critique || scene.critique || null;
    // A reviewed critique (gen v4: autoFixed + creative ideas) is final even
    // when it has no ideas: the quick check's repairs never come back.
    if (given && (given.improvements?.length || given.strengths?.length || given.nextTime || Array.isArray(given.autoFixed))) {
      return {
        source: 'director',
        strengths: (given.strengths || []).filter(Boolean).map(String).slice(0, 4),
        improvements: (given.improvements || []).filter(i => i && i.text).map((i, n) => ({ id: String(i.id || `i${n + 1}`), text: String(i.text), fix: i.fix || null })).slice(0, 5),
        nextTime: String(given.nextTime || ''),
      };
    }
    const seen = new Set();
    const improvements = (report?.heuristic?.issues || [])
      .filter(i => i && i.what && !seen.has(i.fix || i.what) && seen.add(i.fix || i.what))
      .map((i, n) => ({ id: `q${n + 1}`, text: i.what.charAt(0).toUpperCase() + i.what.slice(1), fix: i.fix ? { op: i.fix } : null }))
      .slice(0, 4);
    return { source: 'quick', strengths: [], improvements, nextTime: '' };
  }

  const designIdFor = (runId, dirId) => `${String(runId || 'run').replace(/[^\w-]/g, '').slice(0, 40) || 'run'}-${dirId}`;

  const util = Object.freeze({ cleanStory, estimateCost, estimateRange, relTime, History, reframe, sizeKeyOf, critiqueFor, designIdFor, SIZE_KEYS, COST, etaModel, etaEstimate, etaRecord, etaLabel, etaProgress, etaHistory, etaSave, clock, ETA_KEY });
  if (!root || typeof root.document === 'undefined') return { util };

  // ─── Browser: the focus view ────────────────────────────────────────────
  const doc = root.document;
  const C = () => root.FrameUpCompose;
  const CR = () => root.FrameUpCreative;
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  // Lucide icons (ISC licence).
  const ICON = {
    back: svg('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'),
    prev: svg('<path d="m15 18-6-6 6-6"/>'),
    next: svg('<path d="m9 18 6-6-6-6"/>'),
    undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>'),
    redo: svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>'),
    download: svg('<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>'),
    sparkles: svg('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>'),
    clapper: svg('<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
    layers: svg('<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>'),
    history: svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    wand: svg('<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>'),
    bulb: svg('<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>'),
    text: svg('<path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/>'),
    image: svg('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
    square: svg('<rect width="18" height="18" x="3" y="3" rx="2"/>'),
    hash: svg('<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>'),
    chart: svg('<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>'),
    pill: svg('<rect width="20" height="12" x="2" y="6" rx="6"/>'),
    logo: svg('<path d="M12 3 4 7v6c0 4.4 3.4 7.5 8 8 4.6-.5 8-3.6 8-8V7z"/>'),
    keyboard: svg('<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>'),
    editor: svg('<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>'),
  };
  const LAYER_ICON = { background: ICON.square, photo: ICON.image, cutout: ICON.image, text: ICON.text, number: ICON.hash, shape: ICON.square, logo: ICON.logo, chart: ICON.chart, pill: ICON.pill };
  const SIZES = [
    ['portrait', '4:5', '1080 × 1350', 'Feed portrait'],
    ['story', '9:16', '1080 × 1920', 'Story / Reel'],
    ['square', '1:1', '1080 × 1080', 'Square'],
  ];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isMac = /Mac|iPhone|iPad/.test(root.navigator?.platform || '');
  const mod = isMac ? '⌘' : 'Ctrl';
  const reduced = root.matchMedia?.('(prefers-reduced-motion: reduce)');

  const view = { el: null, designId: '', tab: 'assistant', zoom: 'fit', hover: -1, renderToken: 0, opener: null, assistantTried: false };

  // The assistant script is another branch's file: load it once, on first use.
  function loadAssistant() {
    if (root.FrameUpAssistant || view.assistantTried) return Promise.resolve(Boolean(root.FrameUpAssistant));
    view.assistantTried = true;
    return new Promise(resolve => {
      const s = doc.createElement('script');
      s.src = 'generate-assistant.js?v=20261121-gen4ui';
      s.async = true;
      s.onload = () => resolve(Boolean(root.FrameUpAssistant));
      s.onerror = () => { s.remove(); resolve(false); };
      doc.head.append(s);
    });
  }

  function build() {
    const el = doc.createElement('dialog');
    el.className = 'gfx';
    el.setAttribute('aria-labelledby', 'gfx-title');
    el.innerHTML = `
      <header class="gfx-top">
        <div class="gfx-top__left">
          <button class="gfx-btn gfx-btn--back" type="button" data-fx="close" aria-keyshortcuts="Escape">${ICON.back}<span>Results</span></button>
          <span class="gfx-top__sep" aria-hidden="true"></span>
          <div class="gfx-top__titles">
            <h2 class="gfx-top__title" id="gfx-title"></h2>
            <span class="gfx-top__meta" id="gfx-meta"></span>
          </div>
          <div class="gfx-group gfx-nav">
            <button class="gfx-icon" type="button" data-fx="prev" aria-label="Previous design" data-tip="Previous · ←">${ICON.prev}</button>
            <button class="gfx-icon" type="button" data-fx="next" aria-label="Next design" data-tip="Next · →">${ICON.next}</button>
          </div>
        </div>
        <div class="gfx-top__right">
          <div class="es-segmented gfx-seg" role="radiogroup" aria-label="Canvas size" id="gfx-sizes">
            ${SIZES.map(([key, ratio, dims, name], i) => `<button type="button" role="radio" class="es-segmented__item gfx-seg__item" data-size="${key}" aria-checked="false" data-tip="${name} · ${dims} · ${i + 1}"><span class="gfx-ratio gfx-ratio--${key}" aria-hidden="true"></span>${ratio}</button>`).join('')}
          </div>
          <div class="gfx-group">
            <button class="gfx-icon" type="button" data-fx="undo" aria-label="Undo" aria-keyshortcuts="${isMac ? 'Meta' : 'Control'}+Z" data-tip="Undo · ${mod} Z">${ICON.undo}</button>
            <button class="gfx-icon" type="button" data-fx="redo" aria-label="Redo" aria-keyshortcuts="${isMac ? 'Meta' : 'Control'}+Shift+Z" data-tip="Redo · ${mod} ⇧ Z">${ICON.redo}</button>
          </div>
          <button class="gfx-icon gfx-keys-btn" type="button" data-fx="keys" aria-label="Keyboard shortcuts" aria-expanded="false" aria-controls="gfx-keys" data-tip="Shortcuts · ?">${ICON.keyboard}</button>
          <button class="es-btn es-btn--sm es-btn--tertiary gfx-editor" type="button" data-fx="editor" hidden>${ICON.editor}Open in editor</button>
          <button class="es-btn es-btn--sm gfx-jpg" type="button" data-fx="jpeg" data-tip="Download JPG 1080">JPG</button>
          <button class="es-btn es-btn--sm es-btn--primary gfx-png" type="button" data-fx="png" aria-keyshortcuts="E" data-tip="Download PNG 1080 · E">${ICON.download}PNG</button>
        </div>
        <div class="gfx-keys" id="gfx-keys" hidden>
          <p class="gfx-keys__title">Keyboard shortcuts</p>
          <dl>
            <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Previous / next design</dd>
            <dt><kbd>${mod}</kbd> <kbd>Z</kbd></dt><dd>Undo</dd>
            <dt><kbd>${mod}</kbd> <kbd>⇧</kbd> <kbd>Z</kbd></dt><dd>Redo</dd>
            <dt><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></dt><dd>4:5 · 9:16 · 1:1</dd>
            <dt><kbd>F</kbd></dt><dd>Fit / 100 %</dd>
            <dt><kbd>E</kbd></dt><dd>Download PNG</dd>
            <dt><kbd>/</kbd></dt><dd>Ask the assistant</dd>
            <dt><kbd>Esc</kbd></dt><dd>Back to results</dd>
          </dl>
        </div>
      </header>
      <div class="gfx-body">
        <nav class="gfx-rail" aria-label="Designs in this run"><ol class="gfx-rail__list" id="gfx-rail"></ol></nav>
        <div class="gfx-stage" id="gfx-stage">
          <div class="gfx-stage__scroll" id="gfx-scroll">
            <div class="gfx-canvas" id="gfx-canvas-wrap">
              <canvas id="gfx-canvas" role="img"></canvas>
              <div class="gfx-hilite" id="gfx-hilite" hidden></div>
              <div class="gfx-busy" id="gfx-busy" hidden><span class="gen-spinner" aria-hidden="true"></span></div>
            </div>
          </div>
          <div class="gfx-zoom" role="group" aria-label="Zoom">
            <button type="button" class="gfx-zoom__item" data-zoom="fit" aria-pressed="true">Fit</button>
            <button type="button" class="gfx-zoom__item" data-zoom="100" aria-pressed="false">100%</button>
            <span class="gfx-zoom__dims" id="gfx-dims"></span>
          </div>
          <p class="gfx-stage__note" id="gfx-note" role="status" aria-live="polite"></p>
        </div>
        <aside class="gfx-panel" aria-label="Design tools">
          <div class="gfx-tabs" role="tablist" aria-label="Design tools">
            <button class="gfx-tab" type="button" role="tab" id="gfx-tab-assistant" data-tab="assistant" aria-controls="gfx-pane-assistant">${ICON.sparkles}Assistant</button>
            <button class="gfx-tab" type="button" role="tab" id="gfx-tab-director" data-tab="director" aria-controls="gfx-pane-director">${ICON.clapper}Director<span class="gfx-tab__count" id="gfx-better-count" hidden></span></button>
            <button class="gfx-tab" type="button" role="tab" id="gfx-tab-layers" data-tab="layers" aria-controls="gfx-pane-layers">${ICON.layers}Layers</button>
            <button class="gfx-tab" type="button" role="tab" id="gfx-tab-history" data-tab="history" aria-controls="gfx-pane-history">${ICON.history}History</button>
          </div>
          <div class="gfx-pane gfx-pane--assistant" role="tabpanel" id="gfx-pane-assistant" aria-labelledby="gfx-tab-assistant">
            <section id="gen-assistant-slot" class="gfx-slot" data-design-id="" aria-label="AI assistant"></section>
          </div>
          <div class="gfx-pane" role="tabpanel" id="gfx-pane-director" aria-labelledby="gfx-tab-director" hidden></div>
          <div class="gfx-pane" role="tabpanel" id="gfx-pane-layers" aria-labelledby="gfx-tab-layers" hidden></div>
          <div class="gfx-pane" role="tabpanel" id="gfx-pane-history" aria-labelledby="gfx-tab-history" hidden></div>
        </aside>
      </div>`;
    doc.body.append(el);
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    el.addEventListener('input', onInput);
    el.addEventListener('submit', event => event.preventDefault());
    el.addEventListener('close', onClosed);
    el.addEventListener('pointerover', onHover);
    el.addEventListener('pointerout', onHover);
    el.addEventListener('focusin', onHover);
    // Clicking the dimmed area outside the sheet (narrow screens) closes it.
    el.addEventListener('mousedown', event => { if (event.target === el) close(); });
    let resizeTimer = null;
    root.addEventListener('resize', () => {
      if (!el.open) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => draw(), 120);
    });
    return el;
  }

  const $ = id => view.el.querySelector(`#${id}`);
  const current = () => CR()?.design?.(view.designId) || null;

  function open(designId, { tab = '', opener = null } = {}) {
    if (!CR()?.design?.(designId)) return false;
    if (!view.el) view.el = build();
    view.opener = opener || doc.activeElement;
    view.designId = designId;
    if (tab) view.tab = tab;
    view.zoom = 'fit';
    if (!view.el.open) {
      if (typeof view.el.showModal === 'function') view.el.showModal();
      else view.el.setAttribute('open', '');
      doc.documentElement.classList.add('gfx-open');
    }
    show();
    root.requestAnimationFrame?.(() => view.el.querySelector(`[data-tab="${view.tab}"]`)?.focus({ preventScroll: true }));
    CR()?.track?.('design_opened', { payload: { look: 'creative', view: 'focus', designId } });
    return true;
  }
  function close() {
    if (!view.el?.open) return;
    view.el.close();
  }
  function onClosed() {
    doc.documentElement.classList.remove('gfx-open');
    root.FrameUpAssistant?.unmount?.($('gen-assistant-slot'));
    const card = CR()?.design?.(view.designId)?.card;
    const back = card?.isConnected ? card.querySelector('.gen-cc__media') : view.opener;
    back?.focus?.({ preventScroll: false });
  }

  // Everything for the current design.
  function show() {
    const d = current();
    if (!d) return close();
    const list = CR().designs();
    const i = list.findIndex(x => x.designId === d.designId);
    $('gfx-title').textContent = d.title;
    $('gfx-meta').textContent = `${d.layout} · Design ${i + 1} of ${list.length}`;
    view.el.querySelector('[data-fx="prev"]').disabled = list.length < 2;
    view.el.querySelector('[data-fx="next"]').disabled = list.length < 2;
    view.el.querySelector('[data-fx="editor"]').hidden = typeof d.openInEditor !== 'function';
    renderRail(list, d.designId);
    paintTabs();
    paintTop();
    renderDirector();
    renderLayers();
    renderHistory();
    mountAssistant();
    draw();
  }

  function paintTop() {
    const d = current();
    if (!d) return;
    const key = sizeKeyOf(d.getScene());
    view.el.querySelectorAll('[data-size]').forEach(b => {
      const on = b.dataset.size === key;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    view.el.querySelector('[data-fx="undo"]').disabled = !d.history.canUndo;
    view.el.querySelector('[data-fx="redo"]').disabled = !d.history.canRedo;
    view.el.querySelectorAll('[data-zoom]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.zoom === view.zoom)));
    const s = d.getScene().size;
    $('gfx-dims').textContent = `${s.w} × ${s.h}`;
  }

  function renderRail(list, active) {
    const rail = $('gfx-rail');
    const known = new Map([...rail.children].map(li => [li.dataset.id, li]));
    rail.replaceChildren(...list.map((d, i) => {
      const li = known.get(d.designId) || doc.createElement('li');
      li.dataset.id = d.designId;
      li.innerHTML = `<button type="button" class="gfx-rail__item" data-fx="goto" data-id="${esc(d.designId)}" aria-label="Design ${i + 1}: ${esc(d.title)}" ${d.designId === active ? 'aria-current="true"' : ''}><img alt="" src="${esc(d.thumb())}"><span class="gfx-rail__n" aria-hidden="true">${i + 1}</span></button>`;
      return li;
    }));
    rail.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  function paintTabs() {
    view.el.querySelectorAll('.gfx-tab').forEach(tab => {
      const on = tab.dataset.tab === view.tab;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      view.el.querySelector(`#${tab.getAttribute('aria-controls')}`).hidden = !on;
    });
  }

  // ── The canvas ──────────────────────────────────────────────────────────
  async function draw() {
    const d = current();
    if (!d || !C()) return;
    const scene = d.getScene();
    const token = ++view.renderToken;
    const scroll = $('gfx-scroll');
    const canvas = $('gfx-canvas');
    const wrap = $('gfx-canvas-wrap');
    const cs = root.getComputedStyle(scroll);
    const availW = Math.max(120, scroll.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    const availH = Math.max(160, scroll.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
    const fit = Math.min(availW / scene.size.w, availH / scene.size.h, 1);
    const cssScale = view.zoom === 'fit' ? fit : 1;
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const cssW = Math.round(scene.size.w * cssScale);
    const cssH = Math.round(scene.size.h * cssScale);
    wrap.style.width = `${cssW}px`;
    wrap.style.height = `${cssH}px`;
    scroll.classList.toggle('is-zoomed', view.zoom !== 'fit');
    const busy = $('gfx-busy');
    const timer = setTimeout(() => { busy.hidden = false; }, 160);
    try {
      // Draw off-screen, then swap, so the view never flashes empty.
      const off = doc.createElement('canvas');
      const report = await C().render(scene, off, { scale: Math.min(1, cssScale * dpr) });
      if (token !== view.renderToken) return;
      canvas.width = off.width;
      canvas.height = off.height;
      canvas.getContext('2d').drawImage(off, 0, 0);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.setAttribute('aria-label', `${d.layout}: ${C().editableText(scene).map(t => t.text).join(' · ')}`);
      view.scale = cssScale;
      $('gfx-note').textContent = report?.missing?.length ? 'An image did not load. Swap the photo in Layers.' : '';
      paintHilite();
    } catch (error) {
      if (token === view.renderToken) $('gfx-note').textContent = 'Preview unavailable. Try another size or undo the last change.';
    } finally {
      clearTimeout(timer);
      if (token === view.renderToken) busy.hidden = true;
    }
  }

  function paintHilite() {
    const box = $('gfx-hilite');
    const d = current();
    const layer = d && view.hover >= 0 ? d.getScene().layers[view.hover] : null;
    if (!layer || typeof layer.x !== 'number' || typeof layer.y !== 'number' || !layer.w) { box.hidden = true; return; }
    const s = view.scale || 1;
    box.hidden = false;
    box.style.transform = `translate(${Math.round(layer.x * s)}px, ${Math.round(layer.y * s)}px)`;
    box.style.width = `${Math.round(layer.w * s)}px`;
    box.style.height = `${Math.round((layer.h || 40) * s)}px`;
    box.dataset.label = layerName(layer);
  }

  // ── Director tab ────────────────────────────────────────────────────────
  const RUBRIC = [['hierarchy', 'Hierarchy'], ['focal', 'Focal point'], ['readability', 'Phone readability'], ['brand', 'ES brand'], ['originality', 'Originality']];
  function renderDirector() {
    const d = current();
    const pane = $('gfx-pane-director');
    const crit = d.critique();
    const score = d.score();
    const count = $('gfx-better-count');
    const toImprove = crit.improvements.filter(i => !d.isApplied?.(i.id)).length;
    count.hidden = !toImprove;
    count.textContent = toImprove;
    const rubric = score?.parts ? RUBRIC.filter(([k]) => Number.isFinite(score.parts[k])) : [];
    pane.innerHTML = `
      <section class="gfx-sec">
        <div class="gfx-score">
          <div class="gfx-score__big">${score?.total ? `<strong>${Number(score.total).toFixed(1)}</strong><span>/ 5</span>` : '<strong>–</strong>'}</div>
          <div class="gfx-score__meta"><span class="gfx-eyebrow">${score?.source === 'vision' ? 'Art director score' : 'Quick check score'}</span><span class="gfx-score__guide">${ICON.check}On-brand · passed the ES check</span></div>
        </div>
        ${rubric.length ? `<ul class="gfx-rubric">${rubric.map(([k, label]) => `<li><span>${label}</span><span class="gfx-rubric__bar" aria-hidden="true"><i style="width:${(score.parts[k] / 5) * 100}%"></i></span><b>${score.parts[k]}</b></li>`).join('')}</ul>` : ''}
        ${d.note ? `<p class="gfx-note-text">${esc(d.note)}</p>` : ''}
      </section>
      ${fixedHtml(crit)}
      ${crit.strengths.length ? `<section class="gfx-sec"><h3 class="gfx-eyebrow">What works</h3><ul class="gfx-list gfx-list--good">${crit.strengths.map(s => `<li>${ICON.check}<span>${esc(s)}</span></li>`).join('')}</ul></section>` : ''}
      <section class="gfx-sec">
        <h3 class="gfx-eyebrow">Ideas to try</h3>
        ${crit.improvements.length ? `<ul class="gfx-better">${crit.improvements.map(i => `<li class="gfx-better__item${d.isApplied?.(i.id) ? ' is-applied' : ''}" data-id="${esc(i.id)}"><span class="gfx-better__text">${esc(i.text)}</span>${applyButton(d, i)}</li>`).join('')}</ul>` : '<p class="gfx-muted">No new ideas for this version. Ask the assistant for a variation if you want one.</p>'}
      </section>
      ${crit.nextTime ? `<section class="gfx-sec gfx-lesson">${ICON.bulb}<div><h3 class="gfx-eyebrow">Next time</h3><p>${esc(crit.nextTime)}</p></div></section>` : ''}
      ${d.source ? `<p class="gfx-muted gfx-source">Source: <a href="${esc(d.source.url)}" target="_blank" rel="noopener">${esc(d.source.title || d.source.url)}</a></p>` : ''}`;
  }
  // "Fixed while designing": the small fixes the director made before this
  // design was shown (design.review.autoFixed). Quiet, never a to-do.
  function fixedHtml(crit) {
    const line = root.FrameUpAssistant?.fixedLine ? root.FrameUpAssistant.fixedLine(crit.autoFixed || []) : (crit.autoFixed || []).join(', ');
    return line ? `<section class="gfx-sec gfx-fixed">${ICON.check}<p><b>Fixed while designing:</b> ${esc(line)}</p></section>` : '';
  }
  // An improvement is applied by the assistant (any instruction), or here
  // when it names one of the composer's built-in fixes.
  function applyButton(d, i) {
    if (d.isApplied?.(i.id)) return `<span class="gfx-applied">${ICON.check}Applied</span>`;
    const viaAssistant = typeof root.FrameUpAssistant?.applyImprovement === 'function';
    const name = i.fix?.op === 'fix' ? i.fix.name : i.fix?.op;
    const local = Boolean(name) && C()?.FIXES?.includes(name);
    if (!viaAssistant && !local) return `<button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-fx="ask" data-id="${esc(i.id)}" data-tip="Send this to the AI assistant">${ICON.sparkles}Ask AI</button>`;
    return `<button class="es-btn es-btn--sm" type="button" data-fx="apply" data-id="${esc(i.id)}" data-tip="${viaAssistant ? 'The AI assistant makes this change' : 'Apply the fix'}">${ICON.wand}Apply</button>`;
  }

  // ── Layers tab ──────────────────────────────────────────────────────────
  function layerName(layer) {
    const role = layer.role ? layer.role.charAt(0).toUpperCase() + layer.role.slice(1) : '';
    const type = { background: 'Background', photo: layer.role === 'art' || String(layer.src || '').startsWith('proc:') ? 'Art' : 'Photo', cutout: 'Cut-out', text: 'Text', number: 'Number', shape: layer.shape ? `Shape · ${layer.shape}` : 'Shape', logo: 'Logo', chart: 'Chart', pill: 'Label' }[layer.type] || layer.type;
    return role && layer.type !== 'background' && !['photo', 'cutout'].includes(layer.type) ? `${role}` : type;
  }
  function renderLayers() {
    const d = current();
    const pane = $('gfx-pane-layers');
    const scene = d.getScene();
    const editable = new Map(C().editableText(scene).map(t => [t.index, t]));
    const photos = d.photos();
    const currentPhoto = C().mainPhoto(scene) || scene.layers.find(l => l.type === 'cutout')?.src || '';
    const canSwap = photos.length && (C().mainPhoto(scene) || scene.layers.some(l => l.type === 'cutout'));
    const rows = scene.layers.map((layer, index) => ({ layer, index })).reverse();
    pane.innerHTML = `
      ${canSwap ? `<section class="gfx-sec"><h3 class="gfx-eyebrow">Photo</h3><div class="gfx-photos">${photos.map((p, i) => `<button class="gen-thumb" type="button" data-fx="photo" data-index="${i}" aria-pressed="${p.src === currentPhoto || p.cutout === currentPhoto}" aria-label="${esc(`ES photo ${i + 1}${p.person ? ` of ${p.person}` : ''}`)}"><img src="${esc(p.src)}" alt="" loading="lazy"></button>`).join('')}</div><p class="gfx-muted">Cut-outs stay with their own photo; a swapped photo fills the photo slots.</p></section>` : ''}
      <section class="gfx-sec">
        <h3 class="gfx-eyebrow">Layers <span class="gfx-src">${scene.layers.length}</span></h3>
        <form class="gfx-layers" novalidate>
          ${rows.map(({ layer, index }) => {
            const t = editable.get(index);
            return `<div class="gfx-layer${t ? ' is-text' : ''}" data-layer="${index}">
              <span class="gfx-layer__icon" aria-hidden="true">${LAYER_ICON[layer.type] || ICON.square}</span>
              ${t ? `<label class="gfx-layer__field"><span class="gfx-layer__name">${esc(layerName(layer))}</span><input type="text" maxlength="160" data-index="${index}" value="${esc(t.text)}" spellcheck="true"></label>`
                : `<span class="gfx-layer__name">${esc(layerName(layer))}${layer.type === 'number' ? ` <b>${esc(`${layer.prefix || ''}${layer.value || ''}${layer.suffix || ''}`)}</b>` : ''}</span>`}
            </div>`;
          }).join('')}
        </form>
        <p class="gfx-muted">Numbers stay facts: a digit that is not in the brief is refused. Hover a layer to see it on the canvas.</p>
      </section>`;
  }

  // ── History tab ─────────────────────────────────────────────────────────
  function renderHistory() {
    const d = current();
    const pane = $('gfx-pane-history');
    const h = d.history;
    const items = h.entries.map((e, i) => ({ e, i })).reverse();
    pane.innerHTML = `
      <section class="gfx-sec">
        <div class="gfx-history__head"><h3 class="gfx-eyebrow">Versions <span class="gfx-src">${h.entries.length}</span></h3>
          <div class="gfx-group"><button class="gfx-icon" type="button" data-fx="undo" aria-label="Undo" ${h.canUndo ? '' : 'disabled'}>${ICON.undo}</button><button class="gfx-icon" type="button" data-fx="redo" aria-label="Redo" ${h.canRedo ? '' : 'disabled'}>${ICON.redo}</button></div></div>
        <ol class="gfx-history">
          ${items.map(({ e, i }) => `<li><button type="button" class="gfx-version${i === h.index ? ' is-current' : ''}${i > h.index ? ' is-ahead' : ''}" data-fx="restore" data-index="${i}" ${i === h.index ? 'aria-current="true"' : ''}>
            <span class="gfx-version__dot gfx-version__dot--${esc(e.source)}" aria-hidden="true"></span>
            <span class="gfx-version__label">${esc(e.label)}</span>
            <span class="gfx-version__meta">v${i + 1} · ${relTime(e.at) === 'now' ? 'just now' : `${relTime(e.at)} ago`}${i === h.index ? ' · current' : ''}</span>
          </button></li>`).join('')}
        </ol>
        <p class="gfx-muted">Restoring a version adds it on top, so nothing is lost.</p>
      </section>`;
  }

  // ── The assistant slot ──────────────────────────────────────────────────
  async function mountAssistant() {
    const slot = $('gen-assistant-slot');
    const d = current();
    if (!d) return;
    if (slot.dataset.designId === d.designId && slot.dataset.mounted === '1') return;
    slot.dataset.designId = d.designId;
    slot.dataset.mounted = '';
    root.FrameUpAssistant?.unmount?.(slot);
    slot.replaceChildren();
    slot.classList.add('is-loading');
    const ok = await loadAssistant();
    if (slot.dataset.designId !== d.designId) return;
    slot.classList.remove('is-loading');
    if (ok && typeof root.FrameUpAssistant?.mount === 'function') {
      try {
        root.FrameUpAssistant.mount(slot, { getScene: d.getScene, setScene: d.setScene, designId: d.designId, runId: d.runId });
        slot.dataset.mounted = '1';
        renderDirector(); // Apply buttons now go through the assistant
        return;
      } catch (error) { /* falls through to the offline state */ }
    }
    slot.innerHTML = `<div class="gfx-slot__off">
      <span class="gfx-slot__mark" aria-hidden="true">${ICON.sparkles}</span>
      <p class="gfx-slot__title">The AI assistant is not available here yet</p>
      <p class="gfx-muted">You can still edit text and photos in Layers, apply the director's quick fixes, and step through History.</p>
      <button class="es-btn es-btn--sm" type="button" data-fx="tab" data-tab="layers">${ICON.layers}Open Layers</button>
    </div>`;
  }

  // ── Events ──────────────────────────────────────────────────────────────
  function step(delta) {
    const list = CR().designs();
    if (list.length < 2) return;
    const i = list.findIndex(x => x.designId === view.designId);
    view.designId = list[(i + delta + list.length) % list.length].designId;
    view.hover = -1;
    show();
  }
  function setSize(key) {
    const d = current();
    if (!d || sizeKeyOf(d.getScene()) === key) return;
    const ok = d.resize(key);
    if (!ok) $('gfx-note').textContent = 'This layout cannot take that size; try another composition.';
  }
  function setZoom(z) {
    view.zoom = z === '100' ? '100' : 'fit';
    paintTop();
    draw();
  }

  async function onClick(event) {
    const b = event.target.closest('[data-fx], [data-size], [data-zoom], [data-tab]');
    if (!b || b.disabled) return;
    const d = current();
    if (b.matches('.gfx-tab')) {
      view.tab = b.dataset.tab;
      paintTabs();
      return;
    }
    if (b.dataset.size) return setSize(b.dataset.size);
    if (b.dataset.zoom) return setZoom(b.dataset.zoom);
    const fx = b.dataset.fx;
    if (fx === 'close') return close();
    if (fx === 'prev') return step(-1);
    if (fx === 'next') return step(1);
    if (fx === 'goto') { view.designId = b.dataset.id; view.hover = -1; return show(); }
    if (fx === 'undo') return d.undo();
    if (fx === 'redo') return d.redo();
    if (fx === 'restore') return d.restore(Number(b.dataset.index));
    if (fx === 'tab') { view.tab = b.dataset.tab; return paintTabs(); }
    if (fx === 'keys') {
      const box = $('gfx-keys');
      box.hidden = !box.hidden;
      b.setAttribute('aria-expanded', String(!box.hidden));
      return;
    }
    if (fx === 'png' || fx === 'jpeg') {
      b.disabled = true;
      try { await d.export(fx === 'jpeg' ? 'image/jpeg' : 'image/png'); } finally { setTimeout(() => { b.disabled = false; }, 600); }
      return;
    }
    if (fx === 'editor') return d.openInEditor?.();
    if (fx === 'photo') return d.swapPhoto(Number(b.dataset.index));
    if (fx === 'apply') {
      b.disabled = true;
      b.classList.add('is-busy');
      try { await d.applyImprovement(b.dataset.id); } finally { if (b.isConnected) { b.disabled = false; b.classList.remove('is-busy'); } }
      // The button became "Applied": keep keyboard focus in the list.
      if (!b.isConnected) (view.el.querySelector('.gfx-better :is([data-fx="apply"], [data-fx="ask"])') || view.el.querySelector('.gfx-tab[aria-selected="true"]'))?.focus({ preventScroll: true });
      return;
    }
    if (fx === 'ask') {
      // No assistant API to apply directly: hand the text to the chat input.
      const item = d.critique().improvements.find(i => i.id === b.dataset.id);
      view.tab = 'assistant';
      paintTabs();
      const input = $('gen-assistant-slot').querySelector('textarea, input[type="text"]');
      if (input && item) {
        input.value = item.text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
    }
  }

  let typing = null;
  function onInput(event) {
    const input = event.target.closest?.('.gfx-layer input');
    if (!input) return;
    const d = current();
    const err = d.checkDigits(input.value);
    input.setCustomValidity(err);
    input.reportValidity();
    if (err) return;
    clearTimeout(typing);
    typing = setTimeout(() => d.setText(Number(input.dataset.index), input.value), 220);
  }

  function onHover(event) {
    const row = event.target.closest?.('.gfx-layer');
    const next = event.type === 'pointerout' && !event.relatedTarget?.closest?.('.gfx-layer') ? -1 : row ? Number(row.dataset.layer) : view.hover;
    if (event.type === 'focusin' && !row) return;
    if (next === view.hover) return;
    view.hover = next;
    paintHilite();
  }

  const typingIn = target => target instanceof root.HTMLElement && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  function onKey(event) {
    const d = current();
    if (!d) return;
    const k = event.key;
    const accel = event.metaKey || event.ctrlKey;
    // Size radios: arrows move within the group.
    if (event.target.closest?.('#gfx-sizes') && ['ArrowLeft', 'ArrowRight'].includes(k)) {
      event.preventDefault();
      const keys = SIZES.map(s => s[0]);
      const i = keys.indexOf(sizeKeyOf(d.getScene()));
      setSize(keys[(i + (k === 'ArrowLeft' ? -1 : 1) + keys.length) % keys.length]);
      view.el.querySelector(`[data-size="${sizeKeyOf(d.getScene())}"]`)?.focus();
      return;
    }
    // Tabs: arrows move (tab pattern).
    if (event.target.closest?.('.gfx-tabs') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(k)) {
      event.preventDefault();
      const tabs = [...view.el.querySelectorAll('.gfx-tab')];
      const i = tabs.findIndex(t => t.dataset.tab === view.tab);
      const j = k === 'Home' ? 0 : k === 'End' ? tabs.length - 1 : (i + (k === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
      view.tab = tabs[j].dataset.tab;
      paintTabs();
      tabs[j].focus();
      return;
    }
    if (accel && (k === 'z' || k === 'Z')) {
      if (typingIn(event.target) && event.target.closest('#gen-assistant-slot')) return; // the chat's own undo
      event.preventDefault();
      if (event.shiftKey) d.redo(); else d.undo();
      return;
    }
    if (accel && (k === 'y' || k === 'Y') && !isMac) { event.preventDefault(); d.redo(); return; }
    if (typingIn(event.target) || accel || event.altKey) return;
    if (k === 'ArrowLeft' && !event.target.closest?.('.gfx-rail')) { event.preventDefault(); step(-1); }
    else if (k === 'ArrowRight' && !event.target.closest?.('.gfx-rail')) { event.preventDefault(); step(1); }
    else if (k === '1' || k === '2' || k === '3') setSize(SIZES[Number(k) - 1][0]);
    else if (k === 'f' || k === 'F') setZoom(view.zoom === 'fit' ? '100' : 'fit');
    else if (k === 'e' || k === 'E') view.el.querySelector('[data-fx="png"]').click();
    else if (k === '?') view.el.querySelector('[data-fx="keys"]').click();
    else if (k === '/') {
      event.preventDefault();
      view.tab = 'assistant';
      paintTabs();
      $('gen-assistant-slot').querySelector('textarea, input')?.focus();
    }
  }

  // Called by generate-creative.js after any change to a design.
  function refresh(designId, { parts = 'all' } = {}) {
    if (!view.el?.open || designId !== view.designId) return;
    paintTop();
    renderHistory();
    if (parts !== 'text') renderLayers();
    renderDirector();
    draw();
    const list = CR().designs();
    renderRail(list, view.designId);
  }

  return Object.freeze({ util, open, close, refresh, isOpen: () => Boolean(view.el?.open), currentId: () => view.designId, _reduced: reduced });
}));
