// Reels Studio v4: the Breakdown engine. One engine draws the four v4 styles
// (reel-es-themes.js STYLES: Breakdown, Case File, The Outlier, Hot Seat) the
// way the ES video team's breakdown reels look: chapters -> beats -> zones on
// a persistent 3-zone canvas, a slab wipe between chapters, word-timed
// kinetic captions. Pure functions, no DOM (the page passes a canvas context,
// images and a measure function), for the browser (window.ReelES4, and
// ReelES.toV4 etc.), the server and the tests (require).
//
//   normalize(plan) / toV4(plan)         plan v4 (a v3 plan converts: one chapter per 2-3 beats)
//   cleanModule(m) / moduleProblems(m)   the 18 data modules and their exact data shapes
//   buildTimeline(plan, opts, helpers)   -> v4 timeline (tracks like v3, plus els / layers / wipes)
//   stateAt(el, t) / visibleAt(tl, t)    any element's props at any time (pure)
//   drawFrame(ctx, tl, t, env, helpers)  canvas drawing
//   clipTimes(tl, t)                     which clips show which source time (preview + export)
//   checks(tl, { measure })              the motion lint + the v3 brand checks, v4 edition
//
// THE ZONES (1080 x 1920, the ES grid: column x 60-1020, words y 300-1640):
//   marker   chapter marker at the kicker slot (y 330), level with the ES mark
//   headline held for the whole chapter, 1-2 lines, one *word* coloured
//   media    a 16:9 clip / presser window in a white card with an ink label
//            tag, two photo name cards, or a cut-out player
//   module   the data module that builds (bars grow, dots slide, "?" flips)
//   caption  1-3 word kinetic captions between the zones (one blue word)
//   The ES mark sits top-right ALWAYS (above the wipe; black on the blue slab).
//
// THE MOTION SYSTEM (one; lint and the motion test enforce it):
//   curves    out = cubic-bezier(.2,.8,.2,1) for entries, inOut = (.65,0,.35,1)
//             for matched moves and morphs, in = (.4,0,1,1) for exits only,
//             spring (k 300, d 26) for pops and stamps. Never linear.
//   durations 160 / 240 / 400 / 640 ms only; staggers 48 ms (40-60).
//   Every element is an id with keyframes. A beat change diffs the scenes:
//   the same id MORPHS (inOut 400: position, size, value, colour; a text
//   change flips: in 160, swap under scaleY 0, out 160), a new id ENTERS
//   (out 400, staggered), a gone id EXITS (in 240). Between chapters the blue
//   slab wipe (inOut 640) covers the frame at its midpoint, the next chapter
//   is set there, under the slab, in its settled first frame, so the wipe's
//   second half reveals exactly that frame; the modules build only after it.
//   Ambient motion (Ken Burns on photos, a quote's read bar) runs over a
//   shot or beat on the inOut curve: marked ambient, not on the scale.
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./reel-es.js') : root.ReelES, node ? require('./reel-es-themes.js') : root.ReelESThemes);
  if (node) module.exports = api;
  else {
    root.ReelES4 = api;
    // ReelES.toV4 and friends (the contract's names) on the page too.
    if (root.ReelES) ['toV4', 'normalizeV4', 'isV4', 'MOTION4', 'MODULE_TYPES', 'cleanModule', 'moduleProblems'].forEach(k => { if (!(k in root.ReelES) || root.ReelES[k] == null) root.ReelES[k] = api[k === 'normalizeV4' ? 'normalize' : k]; });
  }
}(typeof self !== 'undefined' ? self : this, (ES, TH) => {
  'use strict';
  if (!ES || !TH) throw new Error('reel-es4.js needs reel-es-themes.js and reel-es.js loaded first.');

  // ─── Brand ──────────────────────────────────────────────────────────────
  const T = ES.TOKENS;
  const GREY = ES.GREY;
  const INK = T.ink;
  const BLUE = T.blue;
  const RED = T.red;
  const WHITE = T.white;
  const PAPER = T.paper;
  // Owner: ES blue, ink, paper, white (+ red for "bad", grey for "didn't").
  const TONE = { blue: BLUE, red: RED, ink: INK, grey: GREY, white: WHITE, paper: PAPER, green: BLUE, yellow: BLUE };
  const PALETTE = new Set([BLUE, RED, INK, GREY, WHITE, PAPER].map(c => c.toUpperCase()));
  const toneHex = (t, d = 'ink') => TONE[t] || TONE[d];
  const TS = ES.TYPE_SCALE; // statXL 300, stat 220, display 168, h1 128, h2 96, caption 64, label 44, body 34
  const dFont = size => ES.displayFont(size);
  const sFont = size => ES.smallFont(size);
  const CAP = ES.TYPE.cap;
  const W = 1080;
  const H = 1920;

  // ─── Motion ─────────────────────────────────────────────────────────────
  const CURVES = Object.freeze({ out: [0.2, 0.8, 0.2, 1], inOut: [0.65, 0, 0.35, 1], in: [0.4, 0, 1, 1] });
  const SPRING = Object.freeze({ k: 300, d: 26, m: 1 });
  const DURATIONS = Object.freeze([160, 240, 400, 640]);
  const DUR = Object.freeze({ xs: 160, s: 240, m: 400, l: 640 });
  const STAGGER = Object.freeze({ min: 40, max: 60, step: 48 });
  const WIPE = Object.freeze({ ms: 640, half: 320, curve: 'inOut', skewDeg: -14 });
  const CAPTION_POP = Object.freeze({ ms: 160, curve: 'out', from: 0.86, exitMs: 160, exitCurve: 'in' });
  const AMBIENT = Object.freeze({ photo: [1, 1.06], clip: [1, 1.03], curve: 'inOut' });
  const MOTION4 = Object.freeze({ CURVES, SPRING, DURATIONS, DUR, STAGGER, WIPE, CAPTION_POP, AMBIENT, NAMED: ['out', 'inOut', 'in', 'spring'] });

  const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1; const bx = 3 * (x2 - x1) - cx; const ax = 1 - cx - bx;
    const cy = 3 * y1; const by = 3 * (y2 - y1) - cy; const ay = 1 - cy - by;
    const sx = t => ((ax * t + bx) * t + cx) * t;
    const sy = t => ((ay * t + by) * t + cy) * t;
    const dx = t => (3 * ax * t + 2 * bx) * t + cx;
    return x => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i += 1) {
        const e = sx(t) - x;
        if (Math.abs(e) < 1e-7) return sy(t);
        const d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      let lo = 0; let hi = 1; t = x;
      for (let i = 0; i < 40; i += 1) { const v = sx(t); if (Math.abs(v - x) < 1e-7) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
      return sy(t);
    };
  }
  const ease = { out: bezier(...CURVES.out), inOut: bezier(...CURVES.inOut), in: bezier(...CURVES.in) };
  // The spring (k 300, d 26, m 1): under-damped (zeta 0.75), ~3% overshoot, settled by 400 ms.
  function springAt(q, durMs = DUR.m) {
    if (q <= 0) return 0;
    if (q >= 1) return 1;
    const { k, d, m } = SPRING;
    const w0 = Math.sqrt(k / m);
    const z = d / (2 * Math.sqrt(k * m));
    const wd = w0 * Math.sqrt(1 - z * z);
    const tau = (q * durMs) / 1000;
    return 1 - Math.exp(-z * w0 * tau) * (Math.cos(wd * tau) + ((z * w0) / wd) * Math.sin(wd * tau));
  }
  ease.spring = q => springAt(q, DUR.m);
  function curveAt(name, q, d) { return name === 'spring' ? springAt(q, d) : (ease[name] || ease.inOut)(q); }

  // ─── Colours and mixing ─────────────────────────────────────────────────
  const HEX = /^#[0-9a-f]{6}$/i;
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function mixHex(a, b, e) {
    const x = rgb(a); const y = rgb(b); const q = clamp01(e);
    return `#${x.map((v, i) => Math.round(v + (y[i] - v) * q).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  }
  function mixVal(a, b, e) {
    if (typeof b === 'number') return typeof a === 'number' ? a + (b - a) * e : b;
    if (typeof b === 'string' && HEX.test(b) && typeof a === 'string' && HEX.test(a)) return mixHex(a, b, e);
    if (Array.isArray(b) && Array.isArray(a) && a.length === b.length) return b.map((v, i) => mixVal(a[i], v, e));
    return e >= 0.5 ? b : (a === undefined ? b : a);
  }
  const same = (a, b) => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => same(v, b[i])) : (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : (a && b && typeof a === 'object' && typeof b === 'object' ? JSON.stringify(a) === JSON.stringify(b) : a === b)));

  // ─── Copy helpers ───────────────────────────────────────────────────────
  const clean = (v, max = 400) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  const up = (v, max) => clean(v, max).toUpperCase();
  const num = v => { const m = String(v == null ? '' : v).replace(/[$,]/g, '').replace('−', '-').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : NaN; };
  // A number shown as text that can count: '35' -> 35, '47%' -> 47 + '%', '$1.2M'.
  function countable(v) {
    const s = clean(v, 16);
    const m = s.match(/^([^\d-]*)(-?\d{1,3}(?:,\d{3})+|-?\d+(?:\.\d+)?)(.*)$/);
    if (!m || /\d/.test(m[3]) || /\d/.test(m[1])) return null;
    const raw = m[2].replace(/,/g, '');
    return { value: Number(raw), pre: m[1], post: m[3], dec: (raw.split('.')[1] || '').length, comma: m[2].includes(',') };
  }
  function fmtCount(c, v) {
    const n = Number(v) || 0;
    let s = c.dec ? n.toFixed(c.dec) : String(Math.round(n));
    if (c.comma) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${c.pre}${s}${c.post}`;
  }
  function hash(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
  function rng(seed) { let s = Math.floor(hash(seed) * 2 ** 31) || 1; return () => { s = (s * 48271) % 2147483647; return s / 2147483647; }; }

  // Approximate widths (Roboto Condensed 800 / Roboto 500) for build-time
  // layout when no measure is given; the draw step always uses the real one.
  function approxMeasure(text, font) {
    const m = String(font).match(/(\d+(?:\.\d+)?)px/);
    const size = m ? Number(m[1]) : 40;
    const cond = /Condensed|Acumin/.test(font);
    let w = 0;
    for (const ch of String(text)) {
      w += (ch === ' ' ? 0.22 : /[MW]/.test(ch) ? 0.76 : /[IJ1il.,:;'!|·]/.test(ch) ? 0.27 : /[A-Z#%&]/.test(ch) ? 0.56 : /[0-9]/.test(ch) ? 0.52 : /[a-z]/.test(ch) ? 0.47 : 0.5) * (cond ? 1 : 1.12);
    }
    return w * size;
  }

  // ─── Modules: the data shapes (numbers must be sourced; lint checks) ────
  const MODULE_TYPES = ['scoreboard', 'bars', 'numberLine', 'dotGrid', 'scatter', 'wl', 'rankList', 'statTiles', 'reveal', 'compare', 'tally', 'calendar', 'timeline', 'playDiagram', 'flow', 'checklist', 'quote', 'lineChart'];
  const MEDIA_KINDS = ['clip', 'presser', 'photo', 'cards', 'cutout', 'none', 'auto'];
  const tone = (v, d = 'ink') => (['blue', 'red', 'ink', 'grey'].includes(v) ? v : (v === 'green' || v === 'good' ? 'blue' : v === 'bad' ? 'red' : d));
  const pt = p => (Array.isArray(p) ? [clamp01(p[0]), clamp01(p[1])] : p && typeof p === 'object' ? [clamp01(p.x), clamp01(p.y)] : null);
  const pts = (list, n) => (Array.isArray(list) ? list.map(pt).filter(Boolean).slice(0, n) : []);
  const stampOf = s => (!s ? null : typeof s === 'string' ? { text: up(s, 18), tone: 'red' } : s.text ? { text: up(s.text, 18), tone: tone(s.tone, 'red') } : null);
  function cleanModule(raw) {
    if (!raw || typeof raw !== 'object' || !MODULE_TYPES.includes(raw.type)) return null;
    const m = raw;
    const list = (v, n) => (Array.isArray(v) ? v.filter(x => x != null).slice(0, n) : []);
    switch (m.type) {
      case 'scoreboard': return { type: 'scoreboard', rows: list(m.rows, 4).map(r => ({ team: up(r.team, 14), logo: clean(r.logo, 300), value: clean(r.value, 8) })).filter(r => r.team), ...(m.tag && m.tag.text ? { tag: { text: up(m.tag.text, 28), tone: tone(m.tag.tone, 'red') } } : {}) };
      case 'bars': return { type: 'bars', title: up(m.title, 28), unit: clean(m.unit, 6), max: Number(m.max) > 0 ? Number(m.max) : 0, rows: list(m.rows, 5).map(r => ({ label: up(r.label, 22), value: Number.isFinite(num(r.value)) ? num(r.value) : 0, tone: tone(r.tone) })).filter(r => r.label) };
      case 'numberLine': { const min = Number(m.min); const max = Number(m.max); return { type: 'numberLine', min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) && max > min ? max : (Number.isFinite(min) ? min + 1 : 1), marks: list(m.marks, 3).map(k => ({ label: up(k.label, 18), value: Number(k.value) || 0, tone: tone(k.tone, 'blue') })), caption: up(m.caption, 40) }; }
      case 'dotGrid': { const total = Math.max(1, Math.min(400, Math.round(Number(m.total) || 0))); let left = total; return { type: 'dotGrid', total, title: up(m.title, 28), groups: list(m.groups, 4).map(g => { const n = Math.max(0, Math.min(left, Math.round(Number(g.n) || 0))); left -= n; return { n, tone: tone(g.tone, 'blue'), label: up(g.label, 18) }; }).filter(g => g.n > 0), ...(m.avatar ? { avatar: { label: up(m.avatar.label || m.avatar.name, 18), asset: clean(m.avatar.asset, 80), index: Number.isFinite(Number(m.avatar.index)) ? Math.max(0, Math.min(total - 1, Number(m.avatar.index))) : total - 1 } } : {}) }; }
      case 'scatter': return { type: 'scatter', points: Array.isArray(m.points) ? m.points.slice(0, 400).map(p => (Array.isArray(p) ? { x: Number(p[0]), y: Number(p[1]) } : { x: Number(p && p.x), y: Number(p && p.y) })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)) : Math.max(10, Math.min(1200, Math.round(Number(m.points) || 400))), highlight: m.highlight ? { label: up(m.highlight.label, 18), x: Number(m.highlight.x), y: Number(m.highlight.y) } : null, diagonal: m.diagonal !== false, axes: { x: up(m.axes && m.axes.x, 22), y: up(m.axes && m.axes.y, 22) }, title: up(m.title, 28) };
      case 'wl': return { type: 'wl', items: String(m.items || '').toUpperCase().replace(/D/g, 'T').replace(/[^WLT]/g, '').slice(0, 24), title: up(m.title, 28) };
      case 'rankList': return { type: 'rankList', title: up(m.title, 28), rows: list(m.rows, 5).map((r, i) => ({ rank: clean(r.rank != null ? r.rank : i + 1, 4), label: up(r.label, 20), value: up(r.value, 10), chip: up(r.chip, 6), tone: tone(r.tone, i === 0 ? 'blue' : 'ink') })).filter(r => r.label) };
      case 'statTiles': return { type: 'statTiles', title: up(m.title, 28), tiles: list(m.tiles, 3).map((x, i) => ({ value: up(x.value, 8), label: up(x.label, 18), tone: tone(x.tone, i === 0 ? 'blue' : 'ink') })).filter(x => x.value) };
      case 'reveal': return { type: 'reveal', from: up(m.from || '?', 6), to: up(m.to, 8), label: up(m.label, 22), tone: tone(m.tone, 'blue') };
      case 'compare': return { type: 'compare', from: { value: up(m.from && m.from.value, 8), label: up(m.from && m.from.label, 18) }, to: { value: up(m.to && m.to.value, 8), label: up(m.to && m.to.label, 18) }, tone: tone(m.tone, 'blue') };
      case 'tally': return { type: 'tally', n: Math.max(0, Math.min(25, Math.round(Number(m.n) || 0))), label: up(m.label, 22) };
      case 'calendar': return { type: 'calendar', month: up(m.month, 12), year: clean(m.year, 6), day: clean(m.day, 4), stamp: stampOf(m.stamp) };
      case 'timeline': return { type: 'timeline', title: up(m.title, 28), slots: list(m.slots, 10).map(s => ({ label: up(s.label, 8), filled: Boolean(s.filled), tone: tone(s.tone, 'blue') })) };
      case 'playDiagram': return { type: 'playDiagram', offense: pts(m.offense, 11), defense: pts(m.defense, 11), route: pts(m.route, 8), label: up(m.label, 24) };
      case 'flow': { const nodes = list(m.nodes, 6).map((n, i) => ({ id: clean(n.id || `n${i}`, 12), text: up(n.text, 18), tone: tone(n.tone, 'ink') })).filter(n => n.text); const ids = new Set(nodes.map(n => n.id)); return { type: 'flow', nodes, edges: list(m.edges, 8).filter(e => Array.isArray(e) && ids.has(clean(e[0], 12)) && ids.has(clean(e[1], 12))).map(e => [clean(e[0], 12), clean(e[1], 12)]) }; }
      case 'checklist': return { type: 'checklist', title: up(m.title, 28), rows: list(m.rows, 5).map(r => ({ rank: clean(r.rank, 3), text: up(r.text, 24), checked: r.checked !== false })).filter(r => r.text) };
      case 'quote': return { type: 'quote', text: clean(m.text, 120).replace(/^["“]|["”]$/g, ''), who: up(m.who, 30) };
      case 'lineChart': return { type: 'lineChart', points: (Array.isArray(m.points) ? m.points : []).slice(0, 24).map(p => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p && p.x), Number(p && p.y)])).filter(p => p.every(Number.isFinite)), label: up(m.label, 18), stamp: stampOf(m.stamp), axes: { x: up(m.axes && m.axes.x, 22), y: up(m.axes && m.axes.y, 22) } };
      default: return null;
    }
  }
  // What a module needs to draw at all (lint 'module-shape').
  function moduleProblems(raw) {
    if (!raw) return [];
    if (!MODULE_TYPES.includes(raw.type)) return [`"${raw.type}" is not a module.`];
    const m = cleanModule(raw);
    const need = ({
      scoreboard: () => m.rows.length >= 1,
      bars: () => m.rows.length >= 1,
      numberLine: () => m.marks.length >= 1,
      dotGrid: () => m.total >= 1,
      scatter: () => Array.isArray(m.points) ? m.points.length >= 3 : true,
      wl: () => m.items.length >= 1,
      rankList: () => m.rows.length >= 1,
      statTiles: () => m.tiles.length >= 1,
      reveal: () => Boolean(m.to),
      compare: () => Boolean(m.from.value && m.to.value),
      tally: () => m.n >= 1,
      calendar: () => Boolean(m.month && (m.year || m.day)),
      timeline: () => m.slots.length >= 2,
      playDiagram: () => m.offense.length + m.defense.length >= 1,
      flow: () => m.nodes.length >= 2,
      checklist: () => m.rows.length >= 1,
      quote: () => Boolean(m.text),
      lineChart: () => m.points.length >= 2,
    }[m.type] || (() => false))();
    return need ? [] : [`The ${m.type} module is missing its data.`];
  }
  // Every string a module shows (the numbers lint reads these).
  function moduleStrings(m) {
    if (!m) return [];
    const s = [];
    const add = (...v) => v.forEach(x => { if (x != null && x !== '') s.push(String(x)); });
    switch (m.type) {
      case 'scoreboard': m.rows.forEach(r => add(r.team, r.value)); if (m.tag) add(m.tag.text); break;
      case 'bars': add(m.title); m.rows.forEach(r => add(r.label, `${r.value}`)); break;
      case 'numberLine': add(m.min, m.max, m.caption); m.marks.forEach(k => add(k.label)); break;
      case 'dotGrid': add(m.title, m.total); m.groups.forEach(g => add(g.n, g.label)); break;
      case 'scatter': add(m.title, m.axes.x, m.axes.y); if (m.highlight) add(m.highlight.label); break;
      case 'wl': add(m.title); break;
      case 'rankList': add(m.title); m.rows.forEach(r => add(r.label, r.value, r.chip)); break;
      case 'statTiles': add(m.title); m.tiles.forEach(x => add(x.value, x.label)); break;
      case 'reveal': add(m.to, m.label); break;
      case 'compare': add(m.from.value, m.from.label, m.to.value, m.to.label); break;
      case 'tally': add(m.n, m.label); break;
      case 'calendar': add(m.month, m.year, m.day); if (m.stamp) add(m.stamp.text); break;
      case 'timeline': add(m.title); m.slots.forEach(x => add(x.label)); break;
      case 'playDiagram': add(m.label); break;
      case 'flow': m.nodes.forEach(n => add(n.text)); break;
      case 'checklist': add(m.title); m.rows.forEach(r => add(r.text)); break;
      case 'quote': add(m.text, m.who); break;
      case 'lineChart': add(m.label, m.axes.x, m.axes.y); if (m.stamp) add(m.stamp.text); break;
      default: break;
    }
    return s;
  }
  // Structural numbers a module draws that need no source (rank 1-5, the
  // countdown's 3·2·1, a progress tracker's 1-5).
  const STRUCTURAL = new Set(['1', '2', '3', '4', '5']);

  // ─── Plan v4 ────────────────────────────────────────────────────────────
  function cleanMedia(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = MEDIA_KINDS.includes(raw.kind) ? raw.kind : 'auto';
    if (kind === 'none') return { kind: 'none' };
    const sub = raw.subject && typeof raw.subject === 'object' ? raw.subject : {};
    return {
      kind,
      subject: { type: clean(sub.type, 16), name: clean(sub.name, 60), team: clean(sub.team, 40), ...(sub.date ? { date: clean(sub.date, 20) } : {}), ...(sub.moment ? { moment: clean(sub.moment, 80) } : {}) },
      label: up(raw.label, 24),
      ...(raw.asset ? { asset: clean(raw.asset, 80) } : {}),
      ...(kind === 'cards' ? { cards: (Array.isArray(raw.cards) ? raw.cards : []).slice(0, 2).map(c => ({ name: up(c.name, 20), tag: up(c.tag, 16), sticker: up(c.sticker, 8), ...(c.asset ? { asset: clean(c.asset, 80) } : {}) })).filter(c => c.name) } : {}),
    };
  }
  function cleanMarker(m) {
    if (!m) return null;
    if (typeof m === 'string') return clean(m, 28) ? { kind: 'label', text: up(m, 28) } : null;
    if (m.kind === 'countdown') { const of = Math.max(2, Math.min(5, Math.round(Number(m.of) || 3))); return { kind: 'countdown', n: Math.max(1, Math.min(of, Math.round(Number(m.n) || of))), of }; }
    if (m.kind === 'progress') { const of = Math.max(2, Math.min(6, Math.round(Number(m.of) || 5))); return { kind: 'progress', i: Math.max(1, Math.min(of, Math.round(Number(m.i) || 1))), of }; }
    if (m.text) return { kind: 'label', text: up(m.text, 28) };
    return null;
  }
  function cleanClose(c) {
    if (!c || typeof c !== 'object') return { kind: 'endcard' };
    if (c.kind === 'yourCall') {
      const options = (Array.isArray(c.options) ? c.options : []).slice(0, 2).map((o, i) => ({ text: up(o && o.text, 22), tone: tone(o && o.tone, i ? 'blue' : 'red') })).filter(o => o.text);
      return { kind: 'yourCall', prompt: up(c.prompt || 'YOUR CALL', 40), options: options.length === 2 ? options : [{ text: 'YES', tone: 'blue' }, { text: 'NO', tone: 'red' }], comment: up(c.comment, 40), vo: clean(c.vo, 200) };
    }
    if (c.kind === 'checklist') return { kind: 'checklist', prompt: up(c.prompt || 'THE CASE', 40), rows: cleanModule({ type: 'checklist', rows: c.rows }).rows, vo: clean(c.vo, 200) };
    return { kind: 'endcard' };
  }
  const isV4 = plan => Boolean(plan && (plan.v === 4 || Array.isArray(plan.chapters)));
  function normalize(plan) {
    const p = plan || {};
    const esStyle = TH.styleOf(p);
    const skin = TH.SKINS.includes(p.skin) ? p.skin : TH.getStyle(esStyle).skin;
    let n = 0;
    const chapters = (Array.isArray(p.chapters) ? p.chapters : []).slice(0, 6).map((c, ci) => ({
      id: clean(c && c.id, 24) || `c${ci + 1}`,
      marker: cleanMarker(c && c.marker),
      headline: clean(c && c.headline, 80),
      tone: c && c.tone === 'red' ? 'red' : 'blue',
      beats: (c && Array.isArray(c.beats) ? c.beats : []).slice(0, 6).map(b => {
        n += 1;
        const media = cleanMedia(b && b.media);
        return {
          id: clean(b && b.id, 24) || `b${n}`,
          vo: clean(b && b.vo, 320),
          ...(media ? { media } : {}),
          ...(b && b.module ? { module: cleanModule(b.module) } : {}),
          ...(b && b.module && !cleanModule(b.module) ? { moduleRaw: { type: clean(b.module.type, 20) } } : (b && b.moduleRaw ? { moduleRaw: { type: clean(b.moduleRaw.type, 20) } } : {})),
          ...(b && stampOf(b.stamp) ? { stamp: { ...stampOf(b.stamp), at: b.stamp.at === 'module' ? 'module' : b.stamp.at === 'media' ? 'media' : '' } } : {}),
          ...(b && b.tag && b.tag.text ? { tag: { text: up(b.tag.text, 28), tone: tone(b.tag.tone, 'red') } } : {}),
          ...(b && b.layout ? { layout: clean(b.layout, 10) } : {}),
        };
      }).filter(b => b.vo || b.module || b.media),
    })).filter(c => c.beats.length);
    return {
      v: 4, style: 'es', esStyle, skin,
      title: clean(p.title, 140), team: p.team || null, sport: clean(p.sport, 12),
      sources: Array.isArray(p.sources) ? p.sources.slice(0, 20) : [], sourceLine: clean(p.sourceLine, 120),
      ...(p.voLengthMs ? { voLengthMs: Number(p.voLengthMs) } : {}),
      chapters, close: cleanClose(p.close),
    };
  }

  // ─── toV4: a v3 (flat beats + blocks) plan, chaptered ───────────────────
  // One chapter per 2-3 beats: a hook or statement opens a chapter (its
  // words become the headline); the end card becomes the close.
  function emHeadline(parts) { return parts.map(x => (x.em ? `*${x.text}*` : x.text)).join(' ').replace(/\*\s+\*/g, ' '); }
  function blockToV4(beat) {
    const b = ES.blockOf(beat || {});
    const title = b.title ? clean(b.title, 60) : '';
    const out = { headline: '', module: null, media: null, stamp: null, tag: null };
    switch (b.type) {
      case 'hook': out.headline = emHeadline((b.pills || []).map(p => ({ text: up(p.text, 20), em: p.color === 'blue' }))); out.media = { kind: 'auto' }; if (b.stamp) out.stamp = stampOf(b.stamp); break;
      case 'statement': out.headline = (b.lines || []).map(l => (l.color && l.color !== 'ink' ? `*${up(l.text, 20)}*` : up(l.text, 30))).join(' '); out.media = { kind: 'auto' }; break;
      case 'number': out.module = { type: 'reveal', from: '?', to: b.value, label: b.label || b.kicker }; break;
      case 'dots': out.module = { type: 'dotGrid', total: Math.min(400, Number(b.total || b.count) || 0), groups: b.highlight ? [{ n: Number(b.highlight) || 0, tone: 'blue', label: b.label || '' }] : [] }; break;
      case 'dotGrid': out.module = { type: 'dotGrid', total: b.total, groups: b.groups, title: '' }; out.headline = title; break;
      case 'compare': out.module = { type: 'bars', title: b.kicker || '', rows: (b.items || []).map(i => ({ label: i.label, value: num(i.value), tone: i.color === 'blue' ? 'blue' : 'ink' })) }; break;
      case 'statTiles': out.module = { type: 'statTiles', tiles: b.tiles }; out.headline = title; break;
      case 'streak': out.module = { type: 'wl', items: b.items, title: b.label || '' }; out.headline = title; break;
      case 'rankTile': out.module = { type: 'rankList', rows: (b.items || []).map(i => ({ rank: i.rank, label: [i.kicker, i.pos].filter(Boolean).join(' '), value: i.chip || '' })) }; out.headline = title; break;
      case 'tagPill': out.tag = { text: b.text, tone: b.tone || 'red' }; out.headline = title; out.media = { kind: 'auto' }; break;
      case 'quote': out.module = { type: 'quote', text: b.text, who: b.who }; break;
      case 'photoCard': out.media = { kind: 'photo', label: b.label || '' }; out.headline = title; if (Array.isArray(b.tiles) && b.tiles.length) out.module = { type: 'statTiles', tiles: b.tiles }; break;
      case 'clipLabel': out.media = { kind: 'clip', label: up(b.text, 24) }; break;
      default: break;
    }
    return out;
  }
  function toV4(plan) {
    if (!plan) return normalize({});
    if (isV4(plan)) return normalize(plan);
    const beats = Array.isArray(plan.beats) ? plan.beats : [];
    const chapters = [];
    let cur = null;
    let close = { kind: 'endcard' };
    beats.forEach((raw, i) => {
      const b0 = ES.blockOf(raw || {});
      if (b0.type === 'endcard' || (raw && raw.kind === 'cta')) { close = { kind: 'endcard' }; return; }
      const v = blockToV4(raw);
      const opens = !cur || cur.beats.length >= 3 || (cur.beats.length >= 2 && v.headline);
      if (opens) { cur = { id: `c${chapters.length + 1}`, headline: v.headline || clean(plan.title, 60).toUpperCase(), tone: 'blue', beats: [] }; chapters.push(cur); } else if (!cur.headline && v.headline) cur.headline = v.headline;
      cur.beats.push({
        id: clean(raw && raw.id, 24) || `b${i + 1}`, vo: clean(raw && raw.vo, 320),
        ...(v.media ? { media: v.media } : {}), ...(v.module ? { module: v.module } : {}), ...(v.stamp ? { stamp: v.stamp } : {}), ...(v.tag ? { tag: v.tag } : {}),
      });
    });
    if (chapters.length > 1) chapters.forEach((c, i) => { c.marker = `${i + 1} · ${clean(c.headline.replace(/\*/g, ''), 40).split(' ').slice(0, 2).join(' ')}`; });
    const esStyle = TH.styleOf(plan);
    return normalize({ ...plan, v: 4, esStyle, chapters, close });
  }

  // ─── The zones (9:16; a 4:5 export fits this frame, see drawFrame) ─────
  const ZONE = Object.freeze({ left: 60, right: 1020, width: 960, markerY: 330, headY: 404, headW: 840, mark: { x: 940, y: 330, size: 80 }, safeTop: 300, safeBottom: 1640, sourceY: 1600 });
  const LAYOUTS = Object.freeze({
    both: { media: { x: 60, y: 616, w: 960, h: 540 }, cap: 1222, module: { x: 60, y: 1296, w: 960, h: 328 } },
    data: { module: { x: 60, y: 616, w: 960, h: 560 }, cap: 1238, media: { x: 256, y: 1320, w: 568, h: 320 } },
    media: { media: { x: 60, y: 656, w: 960, h: 540 }, cap: 1300 },
    module: { module: { x: 60, y: 616, w: 960, h: 800 }, cap: 1496 },
    none: { cap: 1000 },
  });
  // How tall a module wants to be (more than the 'both' slot -> 'data' layout).
  function moduleNeed(m) {
    switch (m.type) {
      case 'scoreboard': return m.rows.length * 120 + (m.rows.length - 1) * 12 + (m.tag ? 72 : 0);
      case 'bars': return 72 + m.rows.length * 92 + (m.title ? 40 : 0);
      case 'rankList': return m.rows.length * 104 + (m.title ? 56 : 0);
      case 'checklist': return m.rows.length * 96 + 64;
      case 'statTiles': case 'compare': case 'wl': case 'timeline': case 'quote': return 320;
      case 'reveal': case 'numberLine': case 'tally': return 420;
      default: return 600;
    }
  }
  const PILL = size => ES.pillMetricsAt(size);

  // ─── Scene specs ────────────────────────────────────────────────────────
  // A spec: { id, kind, z, p (target props), from (build-start overrides),
  // enter ('rise' | 'pop' | 'fade' | 'media' | 'draw'), order (stagger index),
  // parent (props dx / dy relative to the parent's x / y), at (absolute entry time) }.
  const DRAWN = new Set(['line', 'poly', 'check']);
  const sp = (id, kind, p, o = {}) => ({ id, kind, buildAt: o.buildAt != null ? o.buildAt : null, z: o.z != null ? o.z : 20, p: { alpha: 1, dy: 0, sc: 1, sy: 1, ...(DRAWN.has(kind) ? { p: 1 } : {}), ...p }, from: o.from || null, enter: o.enter || 'rise', order: o.order || 0, parent: o.parent || null, at: o.at != null ? o.at : null, ambient: o.ambient || null });
  function tSize(measure, text, sizes, width, font = dFont) { for (const s of sizes) if (measure(text, font(s)) <= width) return s; return sizes[sizes.length - 1]; }

  function markerSpecs(marker) {
    if (!marker) return [];
    const y = ZONE.markerY;
    if (marker.kind === 'label') return [sp('marker', 'pill', { x: ZONE.left, y, size: TS.label, fill: INK, ink: WHITE, text: marker.text }, { z: 30 })];
    const list = [];
    const n = marker.kind === 'countdown' ? marker.of : marker.of;
    for (let i = 0; i < n; i += 1) {
      const label = marker.kind === 'countdown' ? `#${marker.of - i}` : String(i + 1);
      const active = marker.kind === 'countdown' ? marker.of - i === marker.n : i + 1 === marker.i;
      const done = marker.kind === 'countdown' ? marker.of - i > marker.n : i + 1 < marker.i;
      list.push(sp(`marker.${i}`, 'chip', { x: ZONE.left + i * 108, y, w: 96, h: 52, size: TS.label, fill: active ? BLUE : done ? INK : WHITE, ink: active || done ? WHITE : INK, text: label, line: active || done ? 0 : 1 }, { z: 30, order: i }));
    }
    return list;
  }

  // Module builders: (m, r, c) -> specs. r: the zone rect. c: { measure, skin, beat }.
  const PAD = 32;
  const HEAD_STEPS = [TS.h1, TS.h2, TS.caption];
  function panel(r, c, extra = {}) { return sp('mod.panel', 'panel', { x: r.x, y: r.y, w: r.w, h: r.h, chalk: extra.chalk ? 1 : 0 }, { z: 10, enter: 'fade' }); }
  function titlePill(text, r) { return text ? [sp('mod.title', 'pill', { x: r.x + PAD, y: r.y - PILL(TS.label).h / 2, size: TS.label, fill: INK, ink: WHITE, text }, { z: 32, order: 0 })] : []; }
  function inner(r, top = 0) { return { x: r.x + PAD, y: r.y + PAD + top, w: r.w - 2 * PAD, h: r.h - 2 * PAD - top }; }
  const MOD = {};
  // When the voiceover says a figure ('35', 'thirty-five'): a reveal flips there.
  function spokenAt(c, value) {
    const want = num(value);
    if (!Number.isFinite(want) || !c.words) return null;
    const w = c.words.find(x => x.beat === c.beat.id && (num(x.w) === want || (ES.spelledNumber && ES.spelledNumber(String(x.w).toLowerCase().replace(/[^a-z-]/g, '')) === want)));
    return w ? w.s - DUR.xs : null;
  }
  MOD.scoreboard = (m, r) => {
    const n = m.rows.length;
    const tagH = m.tag ? 72 : 0;
    const rowH = Math.min(120, Math.floor((r.h - tagH - (n - 1) * 12) / n));
    const top = r.y + Math.max(0, (r.h - tagH - (n * rowH + (n - 1) * 12)) / 2);
    const vals = m.rows.map(x => num(x.value));
    const best = Math.max(...vals.filter(Number.isFinite));
    const out = [];
    m.rows.forEach((row, i) => {
      const y = top + i * (rowH + 12);
      const key = `mod.sb.${row.team}`;
      const c0 = countable(row.value);
      const lead = Number.isFinite(vals[i]) && vals[i] === best && n > 1;
      out.push(sp(`${key}.row`, 'card', { x: r.x, y, w: r.w, h: rowH }, { z: 12, order: i }));
      out.push(sp(`${key}.chip`, 'teamchip', { x: r.x + 16, y: y + 16, w: rowH - 32, h: rowH - 32, text: row.team.slice(0, 3), logo: row.logo }, { z: 14, order: i }));
      out.push(sp(`${key}.name`, 'text', { x: r.x + rowH + 16, y: y + rowH / 2 + (CAP * TS.caption) / 2, size: TS.caption, color: INK, text: row.team }, { z: 14, order: i }));
      out.push(sp(`${key}.val`, 'text', { x: r.x + r.w - 32, y: y + rowH / 2 + (CAP * TS.h2) / 2, size: TS.h2, color: lead ? BLUE : INK, align: 'right', text: row.value, ...(c0 ? { value: c0.value, fmt: c0 } : {}) }, { z: 14, order: i, from: c0 ? { value: 0 } : null }));
    });
    if (m.tag) out.push(sp('mod.sb.tag', 'pill', { x: r.x, y: top + n * (rowH + 12) + 12, size: TS.label, fill: toneHex(m.tag.tone, 'red'), ink: WHITE, text: m.tag.text }, { z: 16, order: n + 1, enter: 'pop' }));
    return out;
  };
  MOD.bars = (m, r) => {
    const out = [panel(r), ...titlePill(m.title, r)];
    const a = inner(r, m.title ? 12 : 0);
    const n = m.rows.length;
    const rowH = Math.min(132, a.h / n);
    const barH = Math.max(24, Math.min(56, rowH - 60));
    const max = m.max || Math.max(...m.rows.map(x => x.value), 1);
    const valW = 200;
    const block = n * rowH;
    const y0 = a.y + Math.max(0, (a.h - block) / 2);
    m.rows.forEach((row, i) => {
      const key = `mod.bars.${row.label}`;
      const y = y0 + i * rowH;
      const bw = Math.max(8, ((a.w - valW) * row.value) / max);
      const c0 = countable(`${row.value}${m.unit}`) || { value: row.value, pre: '', post: m.unit, dec: 0 };
      out.push(sp(`${key}.label`, 'text', { x: a.x, y: y + CAP * TS.label, size: TS.label, color: INK, text: row.label }, { order: i }));
      out.push(sp(`${key}.bar`, 'rect', { x: a.x, y: y + CAP * TS.label + 14, w: bw, h: barH, fill: toneHex(row.tone) }, { order: i, from: { w: 0 }, enter: 'fade' }));
      out.push(sp(`${key}.val`, 'text', { x: a.x + bw + 20, y: y + CAP * TS.label + 14 + barH / 2 + (CAP * TS.caption) / 2, size: TS.caption, color: toneHex(row.tone), text: fmtCount(c0, row.value), value: row.value, fmt: c0 }, { order: i, from: { value: 0, x: a.x + 20 }, enter: 'fade' }));
    });
    return out;
  };
  MOD.numberLine = (m, r) => {
    const out = [panel(r)];
    const a = inner(r);
    const ay = a.y + a.h * 0.66;
    const x0 = a.x + 24;
    const x1 = a.x + a.w - 24;
    const X = v => x0 + ((v - m.min) / (m.max - m.min)) * (x1 - x0);
    out.push(sp('mod.nl.axis', 'line', { x1: x0, y1: ay, x2: x1, y2: ay, stroke: INK, lw: 8 }, { from: { p: 0 }, enter: 'fade' }));
    [m.min, m.max].forEach((v, i) => {
      out.push(sp(`mod.nl.tick${i}`, 'line', { x1: X(v), y1: ay - 24, x2: X(v), y2: ay + 24, stroke: INK, lw: 8 }, { order: 1 }));
      out.push(sp(`mod.nl.tl${i}`, 'text', { x: X(v), y: ay + 24 + 20 + CAP * TS.label, size: TS.label, color: INK, align: 'center', text: v > 0 && m.min < 0 ? `+${v}` : String(v) }, { order: 1 }));
    });
    const sorted = m.marks.map((k, i) => ({ ...k, i, x: X(Math.max(m.min, Math.min(m.max, k.value))) })).sort((p, q) => p.x - q.x);
    sorted.forEach((k, j) => {
      const below = j > 0 && Math.abs(k.x - sorted[j - 1].x) < 220 && !sorted[j - 1].below;
      k.below = below;
      const key = `mod.nl.m.${k.label}`;
      const ph = PILL(TS.label).h;
      out.push(sp(`${key}.dot`, 'dot', { x: k.x, y: ay, r: 30, fill: toneHex(k.tone, 'blue'), stroke: WHITE, lw: 6 }, { order: 2 + j, enter: 'pop', from: { x: X(m.min) } }));
      out.push(sp(`${key}.pill`, 'pill', { x: k.x, y: below ? ay + 88 : ay - 52 - PILL(TS.caption).h, size: TS.caption, fill: toneHex(k.tone, 'blue'), ink: WHITE, text: k.label, anchor: 'center', minX: a.x, maxX: a.x + a.w }, { order: 2 + j, enter: 'pop', from: { x: X(m.min) } }));
    });
    if (m.caption) out.push(sp('mod.nl.cap', 'text', { x: a.x + a.w / 2, y: a.y + CAP * TS.label + 8, size: TS.label, color: INK, align: 'center', text: m.caption }, { order: 1 }));
    return out;
  };
  MOD.dotGrid = (m, r, c) => {
    const out = [panel(r), ...titlePill(m.title, r)];
    const a = inner(r, m.title ? 12 : 0);
    // The legend's row is always kept, so the grid does not move when groups fill in.
    const legendH = PILL(TS.label).h + 24;
    const gw = a.w;
    const gh = a.h - legendH;
    let best = { cell: 0, cols: 1, rows: 1 };
    for (let cols = 1; cols <= m.total; cols += 1) { const rows = Math.ceil(m.total / cols); const cell = Math.min(gw / cols, gh / rows, 96); if (cell > best.cell) best = { cell, cols, rows }; }
    const { cell, cols, rows } = best;
    const ox = a.x + (gw - cols * cell) / 2 + cell / 2;
    const oy = a.y + (gh - rows * cell) / 2 + cell / 2;
    const fills = [];
    m.groups.forEach(g => { for (let k = 0; k < g.n; k += 1) fills.push(toneHex(g.tone, 'blue')); });
    for (let i = 0; i < m.total; i += 1) {
      const row = Math.floor(i / cols);
      const fill = fills[i] || GREY;
      const isAv = m.avatar && i === m.avatar.index;
      if (isAv) continue;
      out.push(sp(`mod.dot.${i}`, 'dot', { x: ox + (i % cols) * cell, y: oy + row * cell, r: cell * 0.36, fill }, { z: 14, order: Math.min(row, 24), enter: 'pop', from: fill !== GREY ? { fill: GREY } : null }));
    }
    if (m.avatar) {
      const i = m.avatar.index;
      const x = ox + (i % cols) * cell;
      const y = oy + Math.floor(i / cols) * cell;
      const R = Math.max(cell * 0.9, 40);
      out.push(sp('mod.dot.avatar', 'avatar', { x, y, r: R, asset: m.avatar.asset, ring: BLUE, text: m.avatar.label.slice(0, 2) }, { z: 18, order: rows + 1, enter: 'pop' }));
      if (m.avatar.label) out.push(sp('mod.dot.avlabel', 'pill', { x, y: y - R - 12 - PILL(TS.label).h, size: TS.label, fill: BLUE, ink: WHITE, text: m.avatar.label, anchor: 'center', minX: a.x, maxX: a.x + a.w }, { z: 19, order: rows + 2, enter: 'pop' }));
    }
    let lx = a.x;
    m.groups.forEach((g, gi) => {
      const fill = toneHex(g.tone, 'blue');
      out.push(sp(`mod.dot.leg.${g.label || gi}`, 'pill', { x: lx, y: a.y + a.h - PILL(TS.label).h, size: TS.label, fill, ink: g.tone === 'grey' ? INK : WHITE, text: `${g.n} ${g.label}`.trim() }, { z: 16, order: Math.min(rows, 24) + gi, enter: 'rise' }));
      lx += c.measure(`${g.n} ${g.label}`.trim(), dFont(TS.label)) + PILL(TS.label).padLeft + PILL(TS.label).padRight + 16;
    });
    return out;
  };
  MOD.scatter = (m, r) => {
    const out = [panel(r), ...titlePill(m.title, r)];
    const a = inner(r, m.title ? 12 : 0);
    const plot = { x: a.x + 48, y: a.y + 8, w: a.w - 56, h: a.h - 64 };
    out.push(sp('mod.sc.ax', 'line', { x1: plot.x, y1: plot.y + plot.h, x2: plot.x + plot.w, y2: plot.y + plot.h, stroke: INK, lw: 4 }, { from: { p: 0 }, enter: 'fade' }));
    out.push(sp('mod.sc.ay', 'line', { x1: plot.x, y1: plot.y + plot.h, x2: plot.x, y2: plot.y, stroke: INK, lw: 4 }, { from: { p: 0 }, enter: 'fade' }));
    if (m.axes.x) out.push(sp('mod.sc.lx', 'text', { x: plot.x + plot.w, y: plot.y + plot.h + 16 + CAP * TS.body, size: TS.body, font: 's', color: INK, align: 'right', text: m.axes.x }, { order: 1 }));
    if (m.axes.y) out.push(sp('mod.sc.ly', 'text', { x: plot.x + 16, y: plot.y + CAP * TS.body + 4, size: TS.body, font: 's', color: INK, align: 'left', text: m.axes.y }, { order: 1 }));
    let list = m.points;
    if (!Array.isArray(list)) {
      const rand = rng(`scatter${list}`);
      const g = () => (rand() + rand() + rand() - 1.5) / 1.5;
      list = Array.from({ length: list }, () => { const x = rand(); return { x, y: Math.max(0.01, Math.min(0.99, x * 0.9 + 0.05 + g() * 0.16)) }; });
    } else {
      const xs = list.map(p => p.x); const ys = list.map(p => p.y);
      const [xa, xb, ya, yb] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      list = list.map(p => ({ x: (p.x - xa) / Math.max(1e-9, xb - xa), y: (p.y - ya) / Math.max(1e-9, yb - ya) }));
    }
    const P = (x, y) => [plot.x + 12 + x * (plot.w - 24), plot.y + plot.h - 12 - y * (plot.h - 24)];
    const rr = list.length > 500 ? 5 : list.length > 150 ? 7 : 10;
    list.forEach((q, i) => { const [x, y] = P(q.x, q.y); out.push(sp(`mod.sc.p${i}`, 'dot', { x, y, r: rr, fill: INK, alpha: 0.3 }, { z: 12, order: 1 + Math.floor(q.x * 9.99), enter: 'pop' })); });
    if (m.diagonal) { const [x1, y1] = P(0, 0); const [x2, y2] = P(1, 1); out.push(sp('mod.sc.diag', 'line', { x1, y1, x2, y2, stroke: BLUE, lw: 6, dash: 1 }, { z: 13, order: 11, from: { p: 0 }, enter: 'fade' })); }
    if (m.highlight) {
      const hx = Number.isFinite(m.highlight.x) ? clamp01(m.highlight.x) : 0.9;
      const hy = Number.isFinite(m.highlight.y) ? clamp01(m.highlight.y) : 0.25;
      const [x, y] = P(hx, hy);
      out.push(sp('mod.sc.hl', 'dot', { x, y, r: 22, fill: BLUE, stroke: WHITE, lw: 6 }, { z: 18, order: 12, enter: 'pop' }));
      if (m.highlight.label) out.push(sp('mod.sc.hll', 'pill', { x, y: y - 22 - 16 - PILL(TS.label).h, size: TS.label, fill: BLUE, ink: WHITE, text: m.highlight.label, anchor: 'center', minX: a.x, maxX: a.x + a.w }, { z: 19, order: 13, enter: 'pop' }));
    }
    return out;
  };
  MOD.wl = (m, r) => {
    const out = [panel(r), ...titlePill(m.title, r)];
    const a = inner(r, m.title ? 12 : 0);
    const n = m.items.length;
    const perRow = n > 12 ? Math.ceil(n / 2) : n;
    const size = Math.min(96, Math.floor((a.w - (perRow - 1) * 10) / perRow));
    const rows = Math.ceil(n / perRow);
    const w = perRow * size + (perRow - 1) * 10;
    const recH = TS.h2 * CAP + 24;
    const y0 = a.y + (a.h - rows * size - (rows - 1) * 10 - recH) / 2;
    const x0 = a.x + (a.w - w) / 2;
    [...m.items].forEach((c, i) => {
      const fill = c === 'W' ? BLUE : c === 'L' ? RED : GREY;
      out.push(sp(`mod.wl.${i}`, 'chip', { x: x0 + (i % perRow) * (size + 10), y: y0 + Math.floor(i / perRow) * (size + 10), w: size, h: size, size: size >= 80 ? TS.caption : TS.label, fill, ink: c === 'T' ? INK : WHITE, text: c }, { z: 14, order: i, enter: 'pop' }));
    });
    const wN = [...m.items].filter(c => c === 'W').length;
    const lN = [...m.items].filter(c => c === 'L').length;
    const tN = n - wN - lN;
    out.push(sp('mod.wl.rec', 'text', { x: a.x + a.w / 2, y: y0 + rows * size + (rows - 1) * 10 + recH, size: TS.h2, color: INK, align: 'center', text: `${wN}-${lN}${tN ? `-${tN}` : ''}` }, { order: n + 1 }));
    return out;
  };
  MOD.rankList = (m, r) => {
    const out = [...titlePill(m.title, r)];
    const top = m.title ? PILL(TS.label).h / 2 + 16 : 0;
    const n = m.rows.length;
    const rowH = Math.min(112, Math.floor((r.h - top - (n - 1) * 12) / n));
    const y0 = r.y + top + Math.max(0, (r.h - top - n * rowH - (n - 1) * 12) / 2);
    m.rows.forEach((row, i) => {
      const y = y0 + i * (rowH + 12);
      const key = `mod.rk.${row.label}`;
      out.push(sp(`${key}.row`, 'card', { x: r.x, y, w: r.w, h: rowH }, { z: 12, order: i }));
      out.push(sp(`${key}.rank`, 'chip', { x: r.x, y, w: rowH, h: rowH, size: TS.caption, fill: toneHex(row.tone, 'ink'), ink: WHITE, text: `#${row.rank}` }, { z: 14, order: i }));
      out.push(sp(`${key}.label`, 'text', { x: r.x + rowH + 24, y: y + rowH / 2 + (CAP * TS.caption) / 2, size: TS.caption, color: INK, text: row.label, chip: row.chip }, { z: 14, order: i }));
      if (row.value) out.push(sp(`${key}.val`, 'text', { x: r.x + r.w - 28, y: y + rowH / 2 + (CAP * TS.caption) / 2, size: TS.caption, color: toneHex(row.tone, 'ink') === INK ? INK : BLUE, align: 'right', text: row.value }, { z: 14, order: i }));
    });
    return out;
  };
  MOD.statTiles = (m, r, c) => {
    const out = [...titlePill(m.title, r)];
    const n = m.tiles.length;
    const gap = 24;
    const w = (r.w - (n - 1) * gap) / n;
    const h = Math.min(r.h, n === 1 ? 380 : 340);
    const y = r.y + (r.h - h) / 2;
    const steps = n === 1 ? [TS.stat, TS.display, TS.h1] : n === 2 ? [TS.display, TS.h1, TS.h2] : [TS.h1, TS.h2, TS.caption];
    const fit = steps.filter(s => s * 1.0 < h - 120);
    m.tiles.forEach((tile, i) => {
      const x = r.x + i * (w + gap);
      const key = `mod.tile.${i}`;
      const size = tSize(c.measure, tile.value, fit.length ? fit : [TS.h2], w - 48);
      const c0 = countable(tile.value);
      const ph = PILL(TS.label).h;
      const blockH = CAP * size + 28 + ph;
      const ty = y + (h - blockH) / 2 + CAP * size;
      out.push(sp(`${key}.card`, 'card', { x, y, w, h }, { z: 12, order: i }));
      out.push(sp(`${key}.val`, 'text', { x: x + w / 2, y: ty, size, color: toneHex(tile.tone, 'ink'), align: 'center', text: tile.value, ...(c0 ? { value: c0.value, fmt: c0 } : {}) }, { z: 14, order: i, from: c0 ? { value: 0 } : null }));
      if (tile.label) out.push(sp(`${key}.lab`, 'pill', { x: x + w / 2, y: ty + 28, size: TS.label, fill: INK, ink: WHITE, text: tile.label, anchor: 'center' }, { z: 15, order: i + 1 }));
    });
    return out;
  };
  MOD.reveal = (m, r, c) => {
    const w = Math.min(r.w, 600);
    const h = Math.min(r.h, 400);
    const x = r.x + (r.w - w) / 2;
    const y = r.y + (r.h - h) / 2;
    const ph = PILL(TS.label).h;
    const size = tSize(c.measure, m.to, [TS.statXL, TS.stat, TS.display, TS.h1].filter(s => CAP * s < h - ph - 80).concat([TS.h1]), w - 64);
    const ty = y + (h - (CAP * size + 32 + (m.label ? ph : 0))) / 2 + CAP * size;
    return [
      sp('mod.rv.card', 'card', { x, y, w, h }, { z: 12 }),
      sp('mod.rv.val', 'text', { x: x + w / 2, y: ty, size, color: toneHex(m.tone, 'blue'), align: 'center', text: m.to }, { z: 14, from: { text: m.from, color: INK }, buildAt: spokenAt(c, m.to) }),
      ...(m.label ? [sp('mod.rv.lab', 'pill', { x: x + w / 2, y: ty + 32, size: TS.label, fill: INK, ink: WHITE, text: m.label, anchor: 'center' }, { z: 15, order: 1 })] : []),
    ];
  };
  MOD.compare = (m, r, c) => {
    const gap = 120;
    const w = (r.w - gap) / 2;
    const h = Math.min(r.h, 340);
    const y = r.y + (r.h - h) / 2;
    const ph = PILL(TS.label).h;
    const size = tSize(c.measure, [m.from.value, m.to.value].sort((a, b) => b.length - a.length)[0], [TS.display, TS.h1, TS.h2].filter(s => CAP * s < h - ph - 80).concat([TS.h2]), w - 48);
    const ty = y + (h - (CAP * size + 28 + ph)) / 2 + CAP * size;
    const side = (k, x, col, i) => {
      const c0 = countable(k.value);
      return [
        sp(`mod.cmp.${i}.card`, 'card', { x, y, w, h }, { z: 12, order: i * 2 }),
        sp(`mod.cmp.${i}.val`, 'text', { x: x + w / 2, y: ty, size, color: col, align: 'center', text: k.value, ...(c0 ? { value: c0.value, fmt: c0 } : {}) }, { z: 14, order: i * 2, from: c0 && i ? { value: countable(m.from.value) ? countable(m.from.value).value : 0 } : null }),
        ...(k.label ? [sp(`mod.cmp.${i}.lab`, 'pill', { x: x + w / 2, y: ty + 28, size: TS.label, fill: i ? toneHex(m.tone, 'blue') : INK, ink: WHITE, text: k.label, anchor: 'center' }, { z: 15, order: i * 2 + 1 })] : []),
      ];
    };
    return [
      ...side(m.from, r.x, INK, 0),
      sp('mod.cmp.arrow', 'line', { x1: r.x + w + 20, y1: y + h / 2, x2: r.x + w + gap - 20, y2: y + h / 2, stroke: toneHex(m.tone, 'blue'), lw: 10, head: 1 }, { z: 14, order: 2, from: { p: 0 }, enter: 'fade' }),
      ...side(m.to, r.x + w + gap, toneHex(m.tone, 'blue'), 1),
    ];
  };
  MOD.tally = (m, r) => {
    const out = [panel(r)];
    const a = inner(r);
    const groups = Math.ceil(m.n / 5);
    const step = 40;
    const groupW = 4 * step + 64;
    const perRow = Math.max(1, Math.min(groups, Math.floor((a.w - 240) / groupW)));
    const rowsN = Math.ceil(groups / perRow);
    const mh = Math.min(200, (a.h - (rowsN - 1) * 24) / rowsN);
    const x0 = a.x + 16;
    const y0 = a.y + (a.h - (rowsN * mh + (rowsN - 1) * 24)) / 2;
    for (let i = 0; i < m.n; i += 1) {
      const g = Math.floor(i / 5);
      const k = i % 5;
      const gx = x0 + (g % perRow) * groupW;
      const gy = y0 + Math.floor(g / perRow) * (mh + 24);
      const p = k < 4 ? { x1: gx + k * step, y1: gy, x2: gx + k * step, y2: gy + mh } : { x1: gx - 20, y1: gy + mh * 0.78, x2: gx + 3 * step + 20, y2: gy + mh * 0.22 };
      out.push(sp(`mod.tally.${i}`, 'line', { ...p, stroke: k < 4 ? INK : BLUE, lw: 14, cap: 1 }, { z: 14, order: i, from: { p: 0 }, enter: 'fade' }));
    }
    void groups;
    out.push(sp('mod.tally.n', 'text', { x: a.x + a.w, y: a.y + CAP * TS.display + 8, size: TS.display, color: BLUE, align: 'right', text: String(m.n), value: m.n, fmt: { pre: '', post: '', dec: 0 } }, { z: 14, order: 1, from: { value: 0 } }));
    if (m.label) out.push(sp('mod.tally.l', 'pill', { x: a.x + a.w, y: a.y + CAP * TS.display + 32, size: TS.label, fill: INK, ink: WHITE, text: m.label, anchor: 'right' }, { z: 15, order: 2 }));
    return out;
  };
  MOD.calendar = (m, r) => {
    const w = Math.min(r.w * 0.62, 520);
    const h = Math.min(r.h, 440);
    const x = r.x + (r.w - w) / 2;
    const y = r.y + (r.h - h) / 2;
    const out = [sp('mod.cal', 'calendar', { x, y, w, h, month: m.month, big: m.day || m.year, year: m.day ? m.year : '' }, { z: 12 })];
    if (m.stamp) out.push(sp('mod.cal.stamp', 'stamp', { x: x + w - 60, y: y + h - 40, text: m.stamp.text, color: toneHex(m.stamp.tone, 'red'), rot: -10, size: TS.caption }, { z: 40, order: 6, enter: 'pop' }));
    return out;
  };
  MOD.timeline = (m, r) => {
    const out = [panel(r), ...titlePill(m.title, r)];
    const a = inner(r, m.title ? 12 : 0);
    const n = m.slots.length;
    const gap = 16;
    const size = Math.min(132, (a.w - (n - 1) * gap) / n);
    const x0 = a.x + (a.w - (n * size + (n - 1) * gap)) / 2;
    const y = a.y + (a.h - size - 16 - CAP * TS.body - 8) / 2;
    m.slots.forEach((s, i) => {
      const x = x0 + i * (size + gap);
      out.push(sp(`mod.tl.${i}`, 'slot', { x, y, w: size, h: size, f: s.filled ? 1 : 0, fill: toneHex(s.tone, 'blue') }, { z: 14, order: i, from: s.filled ? { f: 0 } : null }));
      if (s.label) out.push(sp(`mod.tl.${i}.l`, 'text', { x: x + size / 2, y: y + size + 16 + CAP * TS.body, size: TS.body, font: 's', color: INK, align: 'center', text: s.label }, { z: 14, order: i }));
    });
    return out;
  };
  MOD.playDiagram = (m, r) => {
    const out = [sp('mod.panel', 'field', { x: r.x, y: r.y, w: r.w, h: r.h }, { z: 10, enter: 'fade' })];
    if (m.label) out.push(...titlePill(m.label, r));
    const a = inner(r, 16);
    const P = q => [a.x + q[0] * a.w, a.y + q[1] * a.h];
    m.offense.forEach((q, i) => { const [x, y] = P(q); out.push(sp(`mod.pd.o${i}`, 'ring', { x, y, r: 24, stroke: BLUE, lw: 7 }, { z: 14, order: i, enter: 'pop' })); });
    m.defense.forEach((q, i) => { const [x, y] = P(q); out.push(sp(`mod.pd.x${i}`, 'xmark', { x, y, r: 22, stroke: INK, lw: 8 }, { z: 14, order: i, enter: 'pop' })); });
    if (m.route.length >= 2) out.push(sp('mod.pd.route', 'poly', { pts: m.route.map(P), stroke: BLUE, lw: 9, head: 1, dash: 0 }, { z: 15, order: Math.max(m.offense.length, m.defense.length) + 1, from: { p: 0 }, enter: 'fade' }));
    return out;
  };
  MOD.flow = (m, r, c) => {
    const out = [panel(r)];
    const a = inner(r);
    const depth = {};
    const incoming = new Set(m.edges.map(e => e[1]));
    const roots = m.nodes.filter(n => !incoming.has(n.id)).map(n => n.id);
    (roots.length ? roots : [m.nodes[0].id]).forEach(id => { depth[id] = 0; });
    for (let k = 0; k < 6; k += 1) m.edges.forEach(([x, y]) => { if (depth[x] != null && (depth[y] == null || depth[y] < depth[x] + 1) && depth[x] < 5) depth[y] = depth[x] + 1; });
    m.nodes.forEach(n => { if (depth[n.id] == null) depth[n.id] = 0; });
    const levels = Math.max(...Object.values(depth)) + 1;
    const FS = TS.caption;
    const ph = PILL(FS).h;
    const rowGap = levels > 1 ? (a.h - ph) / (levels - 1) : 0;
    const pos = {};
    for (let lv = 0; lv < levels; lv += 1) {
      const row = m.nodes.filter(n => depth[n.id] === lv);
      row.forEach((n, i) => { pos[n.id] = { x: a.x + ((i + 0.5) * a.w) / row.length, y: a.y + (levels > 1 ? lv * rowGap : (a.h - ph) / 2), lv }; });
    }
    m.nodes.forEach(n => out.push(sp(`mod.fl.${n.id}`, 'pill', { x: pos[n.id].x, y: pos[n.id].y, size: FS, fill: toneHex(n.tone, 'ink'), ink: WHITE, text: n.text, anchor: 'center', minX: a.x, maxX: a.x + a.w }, { z: 16, order: pos[n.id].lv * 2, enter: 'pop' })));
    m.edges.forEach(([x, y], i) => out.push(sp(`mod.fl.e${i}`, 'line', { x1: pos[x].x, y1: pos[x].y + ph + 10, x2: pos[y].x, y2: pos[y].y - 12, stroke: INK, lw: 5, dash: 1, head: 1 }, { z: 14, order: pos[x].lv * 2 + 1, from: { p: 0 }, enter: 'fade' })));
    void c;
    return out;
  };
  MOD.checklist = (m, r, c) => {
    const chalk = c.skin === 'scrapbook';
    const out = [sp('mod.panel', 'panel', { x: r.x, y: r.y, w: r.w, h: r.h, chalk: chalk ? 1 : 0 }, { z: 10, enter: 'fade' }), ...titlePill(m.title, r)];
    const a = inner(r, m.title ? 12 : 0);
    const n = m.rows.length;
    const rowH = Math.min(112, a.h / n);
    const y0 = a.y + (a.h - n * rowH) / 2;
    const ink = chalk ? WHITE : INK;
    m.rows.forEach((row, i) => {
      const y = y0 + i * rowH;
      const box = 64;
      const key = `mod.ck.${row.text}`;
      out.push(sp(`${key}.box`, 'check', { x: a.x, y: y + (rowH - box) / 2, size: box, stroke: ink, mark: row.checked ? BLUE : RED, checked: row.checked ? 1 : 0 }, { z: 14, order: i * 2, from: { p: 0 } }));
      out.push(sp(`${key}.t`, 'text', { x: a.x + box + 28, y: y + rowH / 2 + (CAP * TS.caption) / 2, size: TS.caption, color: ink, text: row.rank ? `#${row.rank} ${row.text}` : row.text }, { z: 14, order: i * 2 }));
    });
    return out;
  };
  MOD.quote = (m, r) => {
    const ph = PILL(TS.label).h;
    return [
      sp('mod.q.card', 'quotecard', { x: r.x, y: r.y, w: r.w, h: r.h }, { z: 12 }),
      sp('mod.q.mark', 'text', { x: r.x + PAD, y: r.y + PAD + CAP * TS.display, size: TS.display, color: BLUE, text: '“' }, { z: 14 }),
      sp('mod.q.text', 'para', { x: r.x + PAD + 96, y: r.y + PAD + 8, w: r.w - 2 * PAD - 96, h: r.h - 2 * PAD - ph - 48, text: m.text, color: INK, steps: [TS.h2, TS.caption, TS.label], maxLines: 5 }, { z: 14, order: 1 }),
      ...(m.who ? [sp('mod.q.who', 'pill', { x: r.x + PAD + 96, y: r.y + r.h - PAD - ph - 16, size: TS.label, fill: INK, ink: WHITE, text: `— ${m.who}` }, { z: 15, order: 2 })] : []),
      sp('mod.q.bar', 'rect', { x: r.x, y: r.y + r.h - 12, w: r.w, h: 12, fill: BLUE }, { z: 15, order: 2, from: { w: 0 }, enter: 'fade', ambient: 'beat' }),
    ];
  };
  MOD.lineChart = (m, r) => {
    const out = [panel(r)];
    if (m.label) out.push(...titlePill(m.label, r));
    const a = inner(r, 16);
    const plot = { x: a.x + 16, y: a.y + 8, w: a.w - 32, h: a.h - 56 };
    out.push(sp('mod.lc.ax', 'line', { x1: plot.x, y1: plot.y + plot.h, x2: plot.x + plot.w, y2: plot.y + plot.h, stroke: INK, lw: 4 }, { from: { p: 0 }, enter: 'fade' }));
    const xs = m.points.map(p => p[0]); const ys = m.points.map(p => p[1]);
    const [xa, xb, ya, yb] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const P = p => [plot.x + ((p[0] - xa) / Math.max(1e-9, xb - xa)) * plot.w, plot.y + plot.h - 16 - ((p[1] - ya) / Math.max(1e-9, yb - ya)) * (plot.h - 40)];
    const list = m.points.map(P);
    out.push(sp('mod.lc.line', 'poly', { pts: list, stroke: BLUE, lw: 10, dot: 1 }, { z: 14, order: 1, from: { p: 0 }, enter: 'fade' }));
    const last = list[list.length - 1];
    out.push(sp('mod.lc.end', 'dot', { x: last[0], y: last[1], r: 20, fill: BLUE, stroke: WHITE, lw: 6 }, { z: 16, order: 14, enter: 'pop' }));
    if (m.axes.x) out.push(sp('mod.lc.lx', 'text', { x: plot.x + plot.w, y: plot.y + plot.h + 16 + CAP * TS.body, size: TS.body, font: 's', color: INK, align: 'right', text: m.axes.x }, { order: 1 }));
    if (m.stamp) out.push(sp('mod.lc.stamp', 'stamp', { x: plot.x + plot.w * 0.72, y: plot.y + plot.h * 0.22, text: m.stamp.text, color: toneHex(m.stamp.tone, 'red'), rot: -8, size: TS.caption }, { z: 40, order: 16, enter: 'pop' }));
    return out;
  };

  // Media specs: the window (card), the picture(s), the label tag.
  function mediaSpecs(media, r, assetsOf, c) {
    if (!media || media.kind === 'none' || !r) return [];
    const out = [];
    const kind = media.kind;
    const ph = PILL(TS.label).h;
    if (kind === 'cards') {
      const cards = media.cards && media.cards.length ? media.cards : [{ name: up(media.subject.name, 20) }];
      const n = Math.min(2, cards.length);
      const gap = 24;
      const w = (r.w - (n - 1) * gap) / n;
      const list = assetsOf.cards;
      cards.slice(0, n).forEach((card, i) => {
        const x = r.x + i * (w + gap);
        const asset = card.asset || list[i] || '';
        const id = `media.cards.${i}`;
        out.push(sp(id, 'namecard', { x, y: r.y, w, h: r.h, asset, name: card.name, tag: card.tag || '' }, { z: 20, order: i }));
        if (card.sticker) { const pm = PILL(TS.caption); const sw = c.measure(card.sticker, dFont(TS.caption)) + pm.padLeft + pm.padRight; out.push(sp(`${id}.st`, 'sticker', { ox: w - sw / 2 - 8, oy: 64, text: card.sticker, rot: 7, size: TS.caption }, { z: 26, order: i + 3, enter: 'pop', parent: id })); }
      });
      return out;
    }
    const asset = assetsOf.main;
    if (kind === 'cutout') {
      out.push(sp('media.cutout', 'cutout', { x: r.x, y: r.y, w: r.w, h: r.h, asset }, { z: 20 }));
    } else {
      out.push(sp('media.card', 'card', { x: r.x, y: r.y, w: r.w, h: r.h, polaroid: c.skin === 'scrapbook' && kind === 'photo' ? 1 : 0, media: 1 }, { z: 18 }));
      out.push(sp(`media.img.${asset || 'empty'}`, 'media', { asset, kind: kind === 'auto' ? '' : kind }, { z: 19, parent: 'media.card', enter: 'media' }));
    }
    const label = media.label || (kind === 'presser' ? 'PRESS CONFERENCE' : '');
    if (label) out.push(sp('media.label', 'pill', { ox: 24, oy: -ph / 2, size: TS.label, fill: INK, ink: WHITE, text: label }, { z: 24, order: 1, parent: kind === 'cutout' ? 'media.cutout' : 'media.card' }));
    if (kind === 'presser' && media.subject.name) out.push(sp('media.who', 'pill', { ox: 24, oy: r.h - ph - 24, size: TS.label, fill: BLUE, ink: WHITE, text: up(media.subject.name, 24) }, { z: 24, order: 2, parent: 'media.card' }));
    return out;
  }

  // ─── Build ──────────────────────────────────────────────────────────────
  // helpers (from reel-render): { F, estimateWordTimes, captionCards, duckPoints, MUSIC, sourceLineFrom, parseVoEmphasis }
  function chooseLayout(b, hasMedia) {
    if (b.layout && LAYOUTS[b.layout]) return b.layout;
    const mod = b.module;
    if (hasMedia && mod) return ['cards', 'cutout'].includes(b.media.kind) || moduleNeed(mod) <= LAYOUTS.both.module.h ? 'both' : 'data';
    if (hasMedia) return 'media';
    if (mod) return 'module';
    return 'none';
  }
  function newLayer(i, start) { return { i, start, end: Infinity, els: new Map() }; }
  function newEl(L, s) { const el = { id: s.id, layer: L.i, kind: s.kind, z: s.z, parent: s.parent, base: {}, keys: [], busy: {}, final: {}, alive: false, born: [], died: [] }; L.els.set(s.id, el); return el; }
  function addKey(el, t, d, c, p, flags = {}) {
    let start = t;
    Object.keys(p).forEach(k => { start = Math.max(start, el.busy[k] || -Infinity); });
    el.keys.push({ t: Math.round(start), d, c, p: { ...p }, ...flags });
    Object.keys(p).forEach(k => { el.busy[k] = start + d; el.final[k] = p[k]; });
    return start + d;
  }
  // The props an entry starts from.
  function enterFrom(s) {
    switch (s.enter) {
      case 'pop': return { alpha: 0, sc: 0.6 };
      case 'fade': case 'media': case 'draw': return { alpha: 0 };
      case 'rise': default: return { alpha: 0, dy: 28 };
    }
  }
  function morph(el, target, t, mode) {
    const geo = {};
    const txt = {};
    Object.keys(target).forEach(k => {
      if (same(el.final[k], target[k])) return;
      const v = target[k];
      if (typeof v === 'string' && !HEX.test(v)) txt[k] = v;
      else if (v != null && typeof v === 'object' && !Array.isArray(v)) txt[k] = v; // fmt objects swap with the text
      else geo[k] = v;
    });
    let end = t;
    if (Object.keys(txt).length) {
      // A flip: squash shut (in), swap while shut, open (out).
      addKey(el, t, DUR.xs, 'in', { sy: 0 });
      addKey(el, t + DUR.xs, 0, 'set', txt, { cover: true });
      end = addKey(el, t + DUR.xs, DUR.xs, 'out', { sy: 1 });
    }
    if (Object.keys(geo).length) end = Math.max(end, addKey(el, t, mode === 'build' ? DUR.l : DUR.m, mode === 'build' ? 'out' : 'inOut', geo));
    return end;
  }
  // Diff one scene into a layer at time t.
  //   mode 'cover': t is under the slab (or frame one): set the settled first
  //   frame there, instantly; builds start at `reveal`.
  //   mode 'beat': morph / enter / exit, staggered.
  function applyScene(L, specs, t, mode, reveal, ctx) {
    const seen = new Set();
    const ids = new Set(specs.map(s => s.id));
    let exiting = false;
    L.els.forEach(el => { if (el.alive && !ids.has(el.id) && !el.global) exiting = true; });
    specs.forEach(s => {
      seen.add(s.id);
      let el = L.els.get(s.id);
      const delay = (s.order || 0) * STAGGER.step;
      const target = s.p;
      const start = s.from ? { ...target, ...s.from } : target;
      const fresh = !el || !el.alive;
      if (!el) el = newEl(L, s);
      el.parent = s.parent;
      el.z = s.z;
      el.kind = s.kind;
      if (fresh) {
        el.alive = true;
        // Under the slab (or frame one) the chapter's first frame is set:
        // headline, marker, media (and tags). The module enters and builds
        // after the reveal, so the revealed frame is exactly that first frame
        // and every chapter opens with motion.
        const deferred = mode === 'cover' && s.at == null && /^(mod\.|tag$)/.test(s.id);
        if (mode === 'cover' && s.at == null && !deferred) {
          addKey(el, t, 0, 'set', { ...start }, { cover: true });
          el.born.push(t);
          if (s.from) morph(el, target, Math.max(reveal + delay, s.buildAt || 0), 'build');
        } else {
          // Inside a chapter, new elements enter once the old ones are mostly out (160 ms).
          const at = s.at != null ? Math.max(t, s.at) : (mode === 'cover' ? reveal : t + (exiting ? DUR.xs : 0)) + delay;
          addKey(el, t, 0, 'set', { ...start, ...enterFrom(s) }, { cover: true });
          el.born.push(at);
          const pre = enterFrom(s);
          if (s.enter === 'pop') {
            addKey(el, at, DUR.xs, 'out', { alpha: start.alpha });
            addKey(el, at, DUR.m, 'spring', { sc: start.sc });
          } else if (s.enter === 'media') {
            addKey(el, at, DUR.s, 'inOut', { alpha: start.alpha });
          } else {
            const back = {};
            Object.keys(pre).forEach(k => { back[k] = start[k]; });
            addKey(el, at, s.enter === 'rise' ? DUR.m : DUR.s, 'out', back);
          }
          if (s.from) morph(el, target, Math.max(at + DUR.m - DUR.xs, s.buildAt || 0), 'build');
        }
        if (s.ambient === 'beat' && ctx && ctx.beatEnd) {
          // A read bar: grows over the beat (ambient, on the inOut curve).
          el.keys.forEach(k => { if (k.p.w != null && k.c !== 'set') { k.d = Math.max(DUR.l, ctx.beatEnd - k.t - DUR.m); k.c = 'inOut'; k.ambient = true; el.busy.w = k.t + k.d; } });
        }
      } else {
        morph(el, target, t + (mode === 'beat' ? delay : 0), 'morph');
      }
    });
    // Exits (media pictures leave under the new one: a crossfade, not a dip).
    L.els.forEach(el => {
      if (!el.alive || seen.has(el.id) || el.global) return;
      el.alive = false;
      if (el.kind === 'media' && ids.has(el.parent) && specs.some(s => s.kind === 'media' && s.id !== el.id && s.parent === el.parent)) {
        addKey(el, t + DUR.s, 0, 'set', { alpha: 0 }, { cover: true, exit: true });
        el.died.push(t + DUR.s);
        return;
      }
      addKey(el, t, DUR.s, 'in', { alpha: 0, dy: -16 }, { exit: true });
      el.died.push(t + DUR.s);
    });
  }

  const CONTAINERS = new Set(['panel', 'card', 'field', 'quotecard', 'calendar']);
  function chapterHeadSpecs(ch) {
    return [
      sp('head', 'headline', { x: ZONE.left, y: ZONE.headY, w: ZONE.headW, text: ch.headline.toUpperCase(), em: toneHex(ch.tone === 'red' ? 'red' : 'blue') }, { z: 30 }),
      ...markerSpecs(ch.marker),
    ];
  }
  function zoneOf(layout, which) { return LAYOUTS[layout] ? LAYOUTS[layout][which] || null : null; }

  function buildTimeline(plan0, opts = {}, helpers = {}) {
    const plan = toV4(plan0);
    const F = helpers.F;
    const style = TH.getStyle(plan.esStyle);
    const voice = opts.voice || {};
    const photos = opts.photos || {};
    const assets = { ...(opts.assets || {}) };
    const measure = typeof opts.measure === 'function' ? opts.measure : approxMeasure;
    const ctxBase = { measure, skin: plan.skin };
    const estVo = text => (F && F.estimateVoMs ? F.estimateVoMs(text) : Math.round((String(text).split(/\s+/).filter(Boolean).length / 2.6) * 1000));
    const pace = style.pacing;
    const voScale = Number(plan.voLengthMs) > 0 && !Object.keys(voice).length
      ? Number(plan.voLengthMs) / Math.max(1, plan.chapters.reduce((a, c) => a + c.beats.reduce((x, b) => x + estVo(ES.plainVo(b.vo)), 0), 0)) : 1;
    const beats = [];
    const chapters = [];
    const words = [];
    const audio = [];
    const wipes = [];
    const layers = [];
    let estimated = 0;
    let t = 0;
    const parseEm = helpers.parseVoEmphasis || (vo => { const p = ES.parseEmphasis(vo); return { text: p.text || ES.plainVo(vo), flags: p.flags || [] }; });
    const addWords = (vo, id, start, span, v) => {
      const emph = parseEm(vo);
      const timed = v && Array.isArray(v.words) && v.words.length
        ? v.words.map(w => ({ w: clean(w.w, 40).replace(/\*/g, ''), s: start + Math.round(w.s), e: start + Math.round(w.e) })).filter(w => w.w)
        : (helpers.estimateWordTimes ? helpers.estimateWordTimes(emph.text, start, span) : []);
      timed.forEach((w, k) => words.push({ ...w, beat: id, ...(timed.length === emph.flags.length && emph.flags[k] ? { em: true } : {}) }));
      if (v && v.asset) audio.push({ id: `vo-${id}`, kind: 'vo', beat: id, asset: v.asset, inMs: start, durMs: span, gainDb: 0 });
    };
    // Timing: chapters back to back; a wipe centred on each chapter start.
    plan.chapters.forEach((ch, ci) => {
      const cIn = t;
      if (ci > 0) wipes.push({ at: t, ms: WIPE.ms, to: ci });
      ch.beats.forEach((b, bi) => {
        const first = bi === 0;
        const last = bi === ch.beats.length - 1;
        const emph = parseEm(b.vo);
        const v = voice[b.id] || null;
        if (b.vo && !(v && v.durationMs > 0)) estimated += 1;
        const voMs = v && v.durationMs > 0 ? Math.round(v.durationMs) : Math.round(estVo(emph.text) * voScale);
        const lead = ci === 0 && first ? 100 : first ? WIPE.half + DUR.xs : DUR.xs;
        const tail = last ? WIPE.half + DUR.s : pace.tailMs || DUR.s;
        const min = ci === 0 && first ? Math.max(pace.hookMs || 3000, 2400) : Math.max(pace.beatMinMs || 2400, first ? 2800 : 2200);
        const dur = Math.max(min, lead + voMs + tail);
        beats.push({ id: b.id, chapter: ch.id, ci, bi, inMs: t, outMs: t + dur, vo: b.vo, kind: ci === 0 && first ? 'hook' : 'point', voStart: t + lead, src: b });
        if (b.vo) addWords(b.vo, b.id, t + lead, voMs, v);
        t += dur;
      });
      chapters.push({ id: ch.id, i: ci, inMs: cIn, outMs: t, headline: ch.headline, tone: ch.tone, marker: ch.marker });
    });
    // The close: its own layer after a wipe.
    const close = plan.close;
    const closeId = 'close';
    if (plan.chapters.length) wipes.push({ at: t, ms: WIPE.ms, to: plan.chapters.length });
    const closeIn = t;
    const closeVoMs = close.vo ? estVo(close.vo) : 0;
    const closeDur = close.kind === 'endcard' ? 3000 : Math.max(close.kind === 'checklist' ? 5200 : 4600, WIPE.half + DUR.xs + closeVoMs + 600);
    if (close.vo) addWords(close.vo, closeId, t + WIPE.half + DUR.xs, closeVoMs, voice[closeId]);
    beats.push({ id: closeId, chapter: closeId, ci: plan.chapters.length, bi: 0, inMs: t, outMs: t + closeDur, vo: close.vo || '', kind: 'cta', src: { close } });
    t += closeDur;
    const durationMs = t;

    // Scenes -> elements.
    const G = newLayer('g', 0); // global: the caption anchor
    G.end = durationMs;
    const capEl = newEl(G, { id: 'cap', kind: 'anchor', z: 0 });
    capEl.global = true;
    const shots = [];
    const beatLayout = {};
    plan.chapters.forEach((ch, ci) => {
      const ch0 = chapters[ci];
      const L = newLayer(ci, ci === 0 ? 0 : ch0.inMs);
      L.end = ch0.outMs;
      layers.push(L);
      const reveal = ci === 0 ? DUR.s : ch0.inMs + WIPE.half;
      ch.beats.forEach((b, bi) => {
        const beat = beats.find(x => x.id === b.id);
        const main = [b.media && b.media.asset, ...(photos[b.id] || [])].filter(a => a && assets[a])[0] || '';
        const cardAssets = (photos[b.id] || []).filter(a => assets[a]);
        let media = b.media || null;
        if (media && media.kind === 'auto') media = main ? { ...media, kind: assets[main].kind === 'clip' ? 'clip' : 'photo' } : null;
        const hasMedia = Boolean(media && media.kind !== 'none');
        const layout = chooseLayout({ ...b, media }, hasMedia);
        beatLayout[b.id] = layout;
        const ctx = { ...ctxBase, beat: b, beatEnd: beat.outMs, words };
        const mr = zoneOf(layout, 'media');
        let dr = zoneOf(layout, 'module');
        let capY = LAYOUTS[layout].cap;
        // Module alone: as tall as it needs (480-800), the caption under it.
        if (layout === 'module' && b.module) { const need = moduleNeed(b.module); const h = need >= 600 ? 800 : Math.max(480, need); dr = { ...dr, y: dr.y + Math.round((800 - h) / 2 / 8) * 8, h }; }
        const specs = [...chapterHeadSpecs(ch)];
        if (hasMedia) specs.push(...mediaSpecs(media, mr, { main, cards: cardAssets }, ctx));
        if (b.module && MOD[b.module.type] && dr) specs.push(...MOD[b.module.type](b.module, dr, ctx));
        const tagZone = dr || mr;
        // The tag: a red / blue ES pill, a tab on the zone's top-right edge
        // (the label tag and the module title are tabs on the top-left).
        if (b.tag && tagZone) { const th = PILL(TS.label).h; specs.push(sp('tag', 'pill', { x: tagZone.x + tagZone.w - 24, y: tagZone.y - th / 2, size: TS.label, fill: toneHex(b.tag.tone, 'red'), ink: WHITE, text: b.tag.text, anchor: 'right' }, { z: 34, order: 3, enter: 'pop' })); }
        if (b.stamp) {
          const zr = (b.stamp.at === 'media' ? mr : b.stamp.at === 'module' ? dr : null) || mr || dr || { x: 60, y: 700, w: 960, h: 500 };
          const sw = measure(b.stamp.text, dFont(TS.caption)) + 56;
          const shh = CAP * TS.caption + 52;
          const key = String(b.stamp.text).split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
          const w = words.find(x => x.beat === b.id && x.w.toLowerCase().replace(/[^a-z0-9]/g, '') === key);
          const at = Math.max(beat.inMs + (bi === 0 ? WIPE.half + DUR.m : DUR.l), Math.min(beat.outMs - 900, w ? w.s : beat.inMs + 1400));
          // Over the zone's top-right corner, rotated like a rubber stamp.
          // A media window: its top-right corner. A module: its bottom-right corner.
          const onMedia = zr === mr;
          specs.push(sp('stamp', 'stamp', { x: zr.x + zr.w - sw / 2 - 40, y: onMedia ? zr.y + shh / 2 + 40 : zr.y + zr.h - shh / 2 - 32, text: b.stamp.text, color: toneHex(b.stamp.tone, 'red'), rot: -8, size: TS.caption }, { z: 40, enter: 'pop', at }));
        }
        if (bi === 0) applyScene(L, specs, ci === 0 ? 0 : ch0.inMs, 'cover', reveal, ctx);
        else applyScene(L, specs, beat.inMs, 'beat', 0, ctx);
        // The caption line follows the layout.
        if (bi === 0) addKey(capEl, ci === 0 ? 0 : ch0.inMs, 0, 'set', { y: capY }, { cover: true });
        else if (!same(capEl.final.y, capY)) addKey(capEl, beat.inMs, DUR.m, 'inOut', { y: capY });
      });
    });
    // The close layer.
    {
      const L = newLayer(plan.chapters.length, closeIn);
      L.end = durationMs;
      layers.push(L);
      const specs = closeSpecs(close, plan, ctxBase);
      applyScene(L, specs, closeIn, 'cover', closeIn + WIPE.half, { ...ctxBase, beatEnd: durationMs });
      addKey(capEl, closeIn, 0, 'set', { y: close.kind === 'yourCall' ? 1500 : 1480 }, { cover: true });
      // Ambient: the options (or the last check, or the CTA) breathe until the end (every beat moves).
      const breathe = close.kind === 'yourCall' ? ['close.opt.0', 'close.opt.1'] : close.kind === 'checklist' ? [...L.els.keys()].filter(id => /\.box$/.test(id)).slice(-1) : ['close.cta.1'];
      breathe.forEach((id, i) => {
        const el = L.els.get(id);
        if (!el) return;
        for (let at = closeIn + WIPE.half + DUR.l + DUR.m + i * DUR.m; at + 2 * DUR.l < durationMs; at += 2 * DUR.l + DUR.m) { addKey(el, at, DUR.l, 'inOut', { sc: 1.04 }); addKey(el, at + DUR.l, DUR.l, 'inOut', { sc: 1 }); }
      });
    }
    // Shots (the video track): every picture element's visible span.
    const shotFor = (el, L, asset, kindHint) => {
      if (!asset || !assets[asset]) return;
      const a = assets[asset];
      const inMs = Math.max(L.start, el.born[0] != null ? el.born[0] : L.start);
      const outMs = Math.min(L.end + (L.end < durationMs ? 0 : 0), el.died.length ? el.died[el.died.length - 1] : L.end);
      const beat = beats.filter(b => b.inMs <= inMs + 1).pop() || beats[0];
      const isClip = a.kind === 'clip';
      const end = Math.max(0.5, (Number(a.durationMs) || 6000) / 1000);
      const inSec = isClip ? Math.max(0, Math.min(end - 0.5, Number(a.clipIn) || 0)) : 0;
      const outSec = isClip ? (Number(a.clipOut) > inSec + 0.5 ? Math.min(end, Number(a.clipOut)) : end) : 0;
      shots.push({ id: `${el.layer}:${el.id}`, el: el.id, layer: el.layer, beat: beat.id, asset, inMs, outMs: Math.max(inMs + 1, outMs), kind: kindHint || a.kind, clip: isClip ? { inSec, durSec: outSec } : null, motion: { from: isClip ? AMBIENT.clip[0] : AMBIENT.photo[0], to: isClip ? AMBIENT.clip[1] : AMBIENT.photo[1], curve: AMBIENT.curve } });
    };
    [...layers].forEach(L => L.els.forEach(el => {
      const f = el.final;
      if (el.kind === 'media') shotFor(el, L, f.asset, f.kind);
      if (el.kind === 'namecard' || el.kind === 'cutout') shotFor(el, L, f.asset, 'photo');
      if (el.kind === 'avatar' && f.asset) shotFor(el, L, f.asset, 'photo');
    }));
    shots.sort((a, b) => a.inMs - b.inMs);
    // Sort keys; seal elements.
    const els = [];
    [G, ...layers].forEach(L => L.els.forEach(el => {
      el.keys.sort((a, b) => a.t - b.t);
      const first = el.keys[0];
      el.base = first ? { ...first.p } : {};
      delete el.busy;
      els.push(el);
    }));

    // Captions: 1-3 word cards; one highlighted word each.
    const cards = helpers.captionCards ? helpers.captionCards(words, { style: 'highlight', maxWords: 3, maxChars: 22, phrases: true }) : [];
    cards.forEach(c => {
      if (c.words.some(i => words[i].em)) return;
      const pick = keyWord(c.words.map(i => words[i].w));
      if (pick >= 0) words[c.words[pick]].hl = true;
    });
    if (opts.music && opts.music.asset && assets[opts.music.asset] && helpers.duckPoints) {
      audio.push({ id: 'music', kind: 'music', asset: opts.music.asset, inMs: 0, gainDb: (helpers.MUSIC || {}).baseDb || -10, duck: true, envelope: helpers.duckPoints(audio.filter(a => a.kind === 'vo'), durationMs) });
    }
    assets['graphics:es'] = { kind: 'graphic', label: 'Type, data modules and captions', rights: { source: 'FrameUp renderer', licence: 'ES-owned graphic', organic: true, paid: true } };
    assets['logo:es'] = { kind: 'logo', label: 'EssentiallySports mark', src: 'assets/brand-logos/essentiallysports-mark.svg', rights: { source: 'EssentiallySports', licence: 'ES brand mark', organic: true, paid: true } };
    const size = opts.aspect === '4:5' || plan0.aspect === '4:5' ? [W, 1350] : [W, H];
    const clipCount = new Set(shots.filter(s => s.clip).map(s => s.asset)).size;
    const graphics = beats.map((b, i) => ({ id: `${b.id}g`, beat: b.id, template: b.kind === 'cta' ? `es4-${close.kind}` : 'es4-beat', kind: b.kind, inMs: b.inMs, outMs: b.outMs, index: i, data: { text: beatText(b.src, plan.chapters[b.ci]), module: b.src && b.src.module ? b.src.module.type : '', media: b.src && b.src.media ? b.src.media.kind : '', layout: beatLayout[b.id] || '', chapter: b.chapter } }));
    const sourceLine = clean(plan.sourceLine || (helpers.sourceLineFrom ? helpers.sourceLineFrom(opts.sources) : ''), 120);
    return {
      v: 4, engine: 'es4', fps: 30, size, durationMs,
      format: clean(plan0.format, 20) || 'explainer', tag: 'BREAKDOWN', sport: plan.sport, title: plan.title,
      style: 'es', reelStyle: plan.esStyle, esStyle: plan.esStyle, skin: plan.skin, look: 'paper',
      limits: { maxSeconds: 120, targetSeconds: [80, 100] },
      team: opts.team && opts.team.name ? { name: clean(opts.team.name, 80), colors: (opts.team.colors || []).filter(c => HEX.test(String(c))).slice(0, 2), logo: opts.team.logo || '' } : null,
      captionStyle: 'es4', highlight: BLUE, voice: { mode: ['elevenlabs', 'gateway'].includes(opts.voiceMode) ? opts.voiceMode : 'off' },
      beats: beats.map(b => ({ id: b.id, kind: b.kind, chapter: b.chapter, inMs: b.inMs, outMs: b.outMs, vo: b.vo, text: beatText(b.src, plan.chapters[b.ci]), module: b.src && b.src.module ? b.src.module.type : '', media: b.src && b.src.media ? b.src.media.kind : '' })),
      chapters, wipes, layers: [...layers].map(L => ({ i: L.i, start: L.start, end: L.end })), els,
      tracks: { video: shots, graphics, captions: { style: 'es4', words, cards }, audio },
      assets, clipCount, needsClips: clipCount === 0,
      sources: (opts.sources || []).slice(0, 20), corpus: String(opts.corpus || '').slice(0, 12000), sourceLine,
      timing: { estimate: estimated > 0, ...(voScale !== 1 ? { voLengthMs: Number(plan.voLengthMs) } : {}) },
      plan,
    };
  }
  // The caption's key word: a number, else the longest word that is not a filler.
  const FILLER = new Set(['the', 'a', 'an', 'and', 'but', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'is', 'are', 'was', 'were', 'it', 'its', 'that', 'this', 'he', 'she', 'they', 'his', 'her', 'their', 'then', 'just', 'from', 'as', 'be', 'been', 'has', 'have', 'had', 'so', 'not']);
  function keyWord(list) {
    const bare = list.map(w => String(w).toLowerCase().replace(/[^a-z0-9%]/g, ''));
    const n = bare.findIndex(w => /\d/.test(w));
    if (n >= 0) return n;
    let best = -1;
    bare.forEach((w, i) => { if (!FILLER.has(w) && w.length >= 5 && (best < 0 || w.length > bare[best].length)) best = i; });
    return best;
  }
  function beatText(src, ch) {
    if (!src) return '';
    if (src.close) return [src.close.prompt, ...(src.close.options || []).map(o => o.text), src.close.comment, ...(src.close.rows || []).map(r => r.text)].filter(Boolean).join(' · ');
    return [ch ? ES.plainVo(ch.headline) : '', ...moduleStrings(src.module), src.tag && src.tag.text, src.stamp && src.stamp.text, src.media && src.media.label, ...((src.media && src.media.cards) || []).flatMap(c => [c.name, c.tag, c.sticker])].filter(Boolean).join(' · ');
  }

  function closeSpecs(close, plan, ctx) {
    const out = [];
    const ph = PILL(TS.label).h;
    if (close.kind === 'yourCall') {
      out.push(sp('close.prompt', 'para', { x: ZONE.left, y: 560, w: 960, h: 300, text: close.prompt, color: INK, steps: [TS.h1, TS.h2], maxLines: 2, align: 'center', em: BLUE, emLast: 1 }, { z: 30 }));
      // Both options at one size (the biggest step both fit).
      const size = [TS.h2, TS.caption].find(z => close.options.every(o => ctx.measure(o.text, dFont(z)) <= 840 - 96)) || TS.caption;
      close.options.forEach((o, i) => out.push(sp(`close.opt.${i}`, 'button', { x: 120, y: 900 + i * 196, w: 840, h: 164, fill: toneHex(o.tone, i ? 'blue' : 'red'), text: o.text, size }, { z: 30, order: i, from: { alpha: 0, sc: 0.9 } })));
      if (close.comment) out.push(sp('close.comment', 'pill', { x: 540, y: 1330, size: TS.label, fill: INK, ink: WHITE, text: close.comment, anchor: 'center', bubble: 1 }, { z: 30, order: 3, from: { alpha: 0 } }));
    } else if (close.kind === 'checklist') {
      out.push(sp('close.prompt', 'para', { x: ZONE.left, y: 440, w: 840, h: 200, text: close.prompt, color: INK, steps: [TS.h1, TS.h2], maxLines: 2 }, { z: 30 }));
      const r = { x: 60, y: 680, w: 960, h: 640 };
      // The board is part of the close's first frame (revealed by the wipe); its rows build after.
      MOD.checklist({ type: 'checklist', title: '', rows: close.rows }, r, ctx).forEach(s => out.push(s.id === 'mod.panel' ? { ...s, id: 'close.board' } : s));
    } else {
      out.push(sp('close.wordmark', 'wordmark', { x: 540, y: 820, w: 640 }, { z: 30 }));
      ES.DEFAULT_CTA.forEach((line, i) => out.push(sp(`close.cta.${i}`, 'pill', { x: 540, y: 1000 + i * (PILL(TS.h1).h), size: TS.h1, fill: i ? BLUE : INK, ink: WHITE, text: line, anchor: 'center' }, { z: 30, order: i + 1, from: { alpha: 0 } })));
    }
    const src = clean(plan.sourceLine, 120);
    if (src) out.push(sp('close.source', 'text', { x: 540, y: ZONE.sourceY - 40, size: TS.body, font: 's', color: INK, align: 'center', text: src, alpha: 0.72 }, { z: 30 }));
    void ph;
    return out;
  }

  // ─── Evaluate ───────────────────────────────────────────────────────────
  function stateAt(el, T) {
    const out = { ...el.base };
    const keys = el.keys;
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i];
      if (T < k.t) break;
      const q = k.d > 0 ? clamp01((T - k.t) / k.d) : 1;
      const e = q >= 1 ? 1 : curveAt(k.c, q, k.d);
      const p = k.p;
      for (const n in p) out[n] = e >= 1 ? p[n] : mixVal(out[n], p[n], e);
    }
    return out;
  }
  // The layer on screen at t (the wipe switches layers at its midpoint).
  function layerAt(tl, t) {
    let cur = 0;
    tl.layers.forEach((L, i) => { if (t >= L.start) cur = i; });
    return tl.layers[cur];
  }
  function wipeAt(tl, t) {
    const w = tl.wipes.find(x => t >= x.at - x.ms / 2 && t < x.at + x.ms / 2);
    return w ? { ...w, p: (t - (w.at - w.ms / 2)) / w.ms } : null;
  }
  // Everything visible at t, with resolved props (absolute x / y for children).
  function visibleAt(tl, t) {
    const L = layerAt(tl, t);
    const byId = new Map();
    const list = [];
    tl.els.forEach(el => { if (el.layer === L.i) { const s = stateAt(el, t); byId.set(el.id, s); list.push({ el, s }); } });
    list.forEach(x => {
      if (x.el.parent && byId.has(x.el.parent)) {
        const ps = byId.get(x.el.parent);
        x.parentState = ps;
        if (x.s.ox != null) { x.s.x = ps.x + x.s.ox; x.s.y = ps.y + x.s.oy; x.s.dy = (x.s.dy || 0) + (ps.dy || 0); x.s.alpha *= ps.alpha == null ? 1 : ps.alpha; }
      }
    });
    return { layer: L, list: list.filter(x => (x.s.alpha == null ? 1 : x.s.alpha) > 0.002).sort((a, b) => a.el.z - b.el.z) };
  }
  const capAt = (tl, t) => { const el = tl.els.find(e => e.layer === 'g' && e.id === 'cap'); return el ? stateAt(el, t).y : 1200; };
  function clipTime(shot, t) {
    if (!shot || !shot.clip) return 0;
    const span = Math.max(0.5, shot.clip.durSec - shot.clip.inSec);
    return shot.clip.inSec + ((Math.max(0, t - shot.inMs) / 1000) % span);
  }
  function clipTimes(tl, t) {
    const L = layerAt(tl, t);
    return tl.tracks.video.filter(s => s.clip && s.asset && s.layer === L.i && t >= s.inMs && t < s.outMs + DUR.s).map(s => ({ asset: s.asset, time: clipTime(s, t) }));
  }
  // frameAt (the page reads beat / caption from it like v3's).
  function frameAt(tl, tMs) {
    const t = Math.max(0, Math.min(tl.durationMs - 1, tMs));
    const bi = Math.max(0, tl.beats.findIndex(b => t >= b.inMs && t < b.outMs));
    const card = tl.tracks.captions.cards.find(c => t >= c.s && t < c.e) || null;
    const g = tl.tracks.graphics[bi];
    return { t, beatIndex: bi, graphic: g ? { ...g, local: t - g.inMs, exit: 0 } : null, wipe: wipeAt(tl, t), caption: card ? { ...card, local: t - card.s } : null, shot: null, prev: null, transition: null };
  }

  // ─── Draw ───────────────────────────────────────────────────────────────
  const mediaSize = m => { if (!m) return null; const w = m.videoWidth || m.naturalWidth || m.width; const h = m.videoHeight || m.naturalHeight || m.height; return w && h ? [w, h] : null; };
  function setTrack(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px || 0}px`; }
  function measurer(env) {
    const m = env && typeof env.measure === 'function' ? env.measure : approxMeasure;
    if (!env.__m4) env.__m4 = { w: new Map(), para: new Map() };
    const cache = env.__m4.w;
    const f = (text, font) => { const k = `${font}|${text}`; let v = cache.get(k); if (v == null) { v = m(String(text), font); cache.set(k, v); } return v; };
    f.cache = env.__m4.para;
    return f;
  }
  function withState(ctx, s, cx, cy, fn) {
    ctx.save();
    ctx.globalAlpha *= clamp01(s.alpha == null ? 1 : s.alpha);
    const sc = s.sc == null ? 1 : s.sc;
    const sy = s.sy == null ? 1 : s.sy;
    ctx.translate(cx, cy + (s.dy || 0));
    if (s.rot) ctx.rotate((s.rot * Math.PI) / 180);
    if (sc !== 1 || sy !== 1) ctx.scale(sc, sc * sy);
    ctx.translate(-cx, -cy);
    fn();
    ctx.restore();
  }
  // Scrapbook: a small deterministic tilt per paper element.
  const tilt = (id, skin) => (skin === 'scrapbook' ? (hash(id) - 0.5) * 2.2 : 0);
  function paperShadow(ctx, skin) {
    ctx.shadowColor = skin === 'scrapbook' ? 'rgba(18,18,18,0.16)' : 'rgba(18,18,18,0.10)';
    ctx.shadowBlur = skin === 'scrapbook' ? 0 : 28;
    ctx.shadowOffsetX = skin === 'scrapbook' ? 6 : 0;
    ctx.shadowOffsetY = skin === 'scrapbook' ? 8 : 10;
  }
  const noShadow = ctx => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };
  function tape(ctx, x, y, w, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillRect(-w / 2, -18, w, 36);
    ctx.strokeStyle = 'rgba(201,197,188,0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2, -18, w, 36);
    ctx.restore();
  }
  function drawPill(ctx, s, M, tl) {
    const size = s.size || TS.label;
    const pm = PILL(size);
    const font = dFont(size);
    const tw = M(s.text, font);
    const w = tw + pm.padLeft + pm.padRight;
    let x = s.anchor === 'center' ? s.x - w / 2 : s.anchor === 'right' ? s.x - w : s.x;
    if (s.minX != null) x = Math.max(s.minX, Math.min((s.maxX || 1e9) - w, x));
    withState(ctx, s, x + w / 2, s.y + pm.h / 2, () => {
      ctx.fillStyle = s.fill || INK;
      ctx.fillRect(Math.round(x), Math.round(s.y), Math.round(w), Math.round(pm.h));
      if (s.bubble) { ctx.beginPath(); ctx.moveTo(x + 40, s.y + pm.h - 1); ctx.lineTo(x + 40, s.y + pm.h + 22); ctx.lineTo(x + 66, s.y + pm.h - 1); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = s.ink || WHITE;
      ctx.font = font;
      ctx.textAlign = 'left';
      ctx.fillText(s.text, x + pm.padLeft, s.y + pm.baseline);
    });
    void tl;
    return { x, y: s.y, w, h: pm.h };
  }
  function textOf(s) { return s.fmt && typeof s.value === 'number' ? fmtCount(s.fmt, s.value) : String(s.text == null ? '' : s.text); }
  function drawText(ctx, s, M) {
    const size = s.size || TS.label;
    const font = s.font === 's' ? sFont(size) : dFont(size);
    const text = textOf(s);
    const w = M(text, font);
    const x = s.align === 'center' ? s.x - w / 2 : s.align === 'right' ? s.x - w : s.x;
    withState(ctx, { ...s, rot: 0 }, x + w / 2, s.y - (CAP * size) / 2, () => {
      ctx.font = font;
      ctx.fillStyle = s.color || INK;
      ctx.textAlign = 'left';
      ctx.fillText(text, x, s.y);
      if (s.chip) {
        const pm = PILL(TS.body);
        const cw = M(s.chip, dFont(TS.body)) + pm.padLeft + pm.padRight;
        const cx = x + w + 20;
        ctx.fillStyle = INK;
        ctx.fillRect(cx, s.y - CAP * size / 2 - pm.h / 2, cw, pm.h);
        ctx.fillStyle = WHITE;
        ctx.font = dFont(TS.body);
        ctx.fillText(s.chip, cx + pm.padLeft, s.y - CAP * size / 2 - pm.h / 2 + pm.baseline);
      }
    });
    return { x, y: s.y - CAP * size, w, h: CAP * size };
  }
  // Words with *emphasis*, wrapped into a box on the type scale (biggest step that fits).
  function wrapEm(M, text, steps, width, maxLines, oneLineAbove = Infinity, maxH = Infinity) {
    const toks = [];
    String(text || '').split(/(\*[^*]+\*)/).forEach(part => { const em = /^\*.*\*$/.test(part); part.replace(/\*/g, '').split(/\s+/).filter(Boolean).forEach(w => toks.push({ w, em })); });
    const breakAt = (font, space, wid) => {
      const lines = [];
      let line = [];
      let lw = 0;
      toks.forEach(tk => {
        const ww = M(tk.w, font);
        if (line.length && lw + space + ww > wid) { lines.push({ toks: line, w: lw }); line = []; lw = 0; }
        line.push({ ...tk, ww });
        lw += (line.length > 1 ? space : 0) + ww;
      });
      if (line.length) lines.push({ toks: line, w: lw });
      return lines;
    };
    for (let si = 0; si < steps.length; si += 1) {
      const size = steps[si];
      const font = dFont(size);
      const space = M(' ', font);
      const cap = Math.max(1, Math.min(size > oneLineAbove ? 1 : maxLines, Math.floor((maxH + size * 0.1) / (size * 0.92))));
      let lines = breakAt(font, space, width);
      const ok = lines.length <= cap && lines.every(l => l.w <= width + 0.5);
      if (ok && lines.length > 1) {
        // Balance the lines (no orphan word): the narrowest width that keeps the count.
        let lo = width * 0.4; let hi = width;
        for (let k = 0; k < 14; k += 1) { const mid = (lo + hi) / 2; if (breakAt(font, space, mid).length <= lines.length) hi = mid; else lo = mid; }
        lines = breakAt(font, space, hi);
      }
      if (ok) return { size, lines, space, fits: true };
      if (si === steps.length - 1) return { size, lines: lines.slice(0, cap), space, fits: false };
    }
    return { size: steps[0], lines: [], space: 0, fits: true };
  }
  function drawPara(ctx, s, M, skin, isHead) {
    const steps = s.steps || [TS.h2, TS.caption];
    const key = `${isHead ? 'H' : 'P'}|${s.text}|${s.w}|${s.h}|${steps.join(',')}|${s.maxLines}`;
    if (!M.cache) M.cache = new Map();
    let lay = M.cache.get(key);
    if (!lay) { lay = wrapEm(M, s.text, steps, s.w, s.maxLines || 2, isHead ? TS.h2 : Infinity, s.h || Infinity); M.cache.set(key, lay); }
    const lh = Math.round(lay.size * 0.92);
    const font = dFont(lay.size);
    withState(ctx, s, s.x + s.w / 2, s.y + (lay.lines.length * lh) / 2, () => {
      ctx.font = font;
      ctx.textAlign = 'left';
      lay.lines.forEach((line, i) => {
        let x = s.align === 'center' ? s.x + (s.w - line.w) / 2 : s.x;
        const y = s.y + CAP * lay.size + i * lh;
        line.toks.forEach((tk, j) => {
          const em = tk.em || (s.emLast && i === lay.lines.length - 1 && !lay.lines.some(l => l.toks.some(q => q.em)));
          ctx.fillStyle = em ? (s.em || BLUE) : (s.color || INK);
          ctx.fillText(tk.w, x, y);
          if (em && skin === 'scrapbook' && isHead) {
            ctx.save();
            ctx.strokeStyle = s.em || BLUE;
            ctx.lineWidth = Math.max(6, lay.size * 0.07);
            ctx.lineCap = 'round';
            ctx.beginPath();
            const uy = y + lay.size * 0.12;
            ctx.moveTo(x, uy + 4);
            ctx.quadraticCurveTo(x + tk.ww * 0.5, uy - 6, x + tk.ww, uy + 2);
            ctx.stroke();
            ctx.restore();
          }
          x += tk.ww + (j < line.toks.length - 1 ? lay.space : 0);
        });
      });
    });
    return lay;
  }
  function drawMediaInto(ctx, rect, s, shot, tl, env, t) {
    const asset = s.asset ? tl.assets[s.asset] : null;
    const vid = asset && asset.kind === 'clip' && env.videos ? env.videos[s.asset] : null;
    const media = vid && (vid.readyState || 0) >= 2 ? vid : (env.images ? env.images[s.asset] : null);
    const size = mediaSize(media);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    if (!size) {
      // An empty slot (lint flags it): a quiet hatch, never a fake picture.
      ctx.fillStyle = '#E6E2D9';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = 'rgba(18,18,18,0.08)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      for (let k = -rect.h; k < rect.w; k += 40) { ctx.moveTo(rect.x + k, rect.y + rect.h); ctx.lineTo(rect.x + k + rect.h, rect.y); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(18,18,18,0.45)';
      ctx.font = sFont(TS.body);
      ctx.textAlign = 'center';
      ctx.fillText(asset ? 'LOADING' : (s.kind === 'clip' || s.kind === 'presser' ? 'FIND A CLIP' : 'ADD A PHOTO'), rect.x + rect.w / 2, rect.y + rect.h / 2 + 12);
      ctx.textAlign = 'left';
      ctx.restore();
      return;
    }
    const isClip = asset && asset.kind === 'clip';
    const span = shot ? Math.max(1, shot.outMs - shot.inMs) : 1;
    const q = shot ? clamp01((t - shot.inMs) / span) : 0;
    const [z0, z1] = isClip ? AMBIENT.clip : AMBIENT.photo;
    const zoom = z0 + (z1 - z0) * ease.inOut(q);
    const face = ES.faceBox(size, null, asset);
    const c = ES.focusCrop(size, rect, face, zoom, isClip ? 0.22 : 0.42);
    ctx.drawImage(media, c.sx, c.sy, c.sw, c.sh, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }
  function drawEl(ctx, x, tl, env, t, M, helpers) {
    const { el, s } = x;
    const skin = tl.skin;
    switch (el.kind) {
      case 'headline': drawPara(ctx, { ...s, steps: HEAD_STEPS, maxLines: 2 }, M, skin, true); return;
      case 'para': drawPara(ctx, s, M, skin, false); return;
      case 'pill': drawPill(ctx, s, M, tl); return;
      case 'text': drawText(ctx, s, M); return;
      case 'chip': withState(ctx, s, s.x + s.w / 2, s.y + s.h / 2, () => {
        ctx.fillStyle = s.fill || INK;
        ctx.fillRect(Math.round(s.x), Math.round(s.y), Math.round(s.w), Math.round(s.h));
        if (s.line) { ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(s.x + 1.5, s.y + 1.5, s.w - 3, s.h - 3); }
        const size = s.size || TS.label;
        ctx.font = dFont(size);
        ctx.fillStyle = s.ink || WHITE;
        ctx.textAlign = 'center';
        ctx.fillText(s.text, s.x + s.w / 2, s.y + s.h / 2 + (CAP * size) / 2);
        ctx.textAlign = 'left';
      }); return;
      case 'panel': case 'card': case 'field': case 'quotecard': {
        const rot = tilt(`${el.layer}${el.id}`, skin) * (el.kind === 'card' && s.media ? 0.5 : 1);
        withState(ctx, { ...s, rot }, s.x + s.w / 2, s.y + s.h / 2, () => {
          ctx.save();
          if (s.chalk) {
            paperShadow(ctx, skin);
            ctx.fillStyle = INK;
            ctx.fillRect(s.x, s.y, s.w, s.h);
            noShadow(ctx);
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 2;
            for (let k = 0; k < 14; k += 1) { const yy = s.y + ((k + 0.5) * s.h) / 14; ctx.beginPath(); ctx.moveTo(s.x + 24, yy + Math.sin(k) * 3); ctx.lineTo(s.x + s.w - 24, yy - Math.cos(k) * 3); ctx.stroke(); }
          } else if (el.kind === 'quotecard' && skin === 'scrapbook') {
            paperShadow(ctx, skin);
            ctx.fillStyle = WHITE;
            const rand = rng(el.id);
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            for (let xx = s.x; xx <= s.x + s.w; xx += 24) ctx.lineTo(xx, s.y + rand() * 10);
            ctx.lineTo(s.x + s.w, s.y + s.h);
            for (let xx = s.x + s.w; xx >= s.x; xx -= 24) ctx.lineTo(xx, s.y + s.h - rand() * 12);
            ctx.closePath();
            ctx.fill();
          } else {
            paperShadow(ctx, skin);
            ctx.fillStyle = WHITE;
            ctx.fillRect(s.x, s.y, s.w, s.h);
            noShadow(ctx);
            if (el.kind === 'field') {
              ctx.strokeStyle = 'rgba(18,18,18,0.10)';
              ctx.lineWidth = 3;
              for (let k = 1; k < 5; k += 1) { const yy = s.y + (k * s.h) / 5; ctx.beginPath(); ctx.moveTo(s.x + 24, yy); ctx.lineTo(s.x + s.w - 24, yy); ctx.stroke(); }
              ctx.strokeStyle = 'rgba(18,18,18,0.45)';
              ctx.setLineDash([18, 14]);
              ctx.lineWidth = 4;
              ctx.beginPath(); ctx.moveTo(s.x + 24, s.y + s.h * 0.6); ctx.lineTo(s.x + s.w - 24, s.y + s.h * 0.6); ctx.stroke();
              ctx.setLineDash([]);
            }
          }
          ctx.restore();
          if (skin === 'scrapbook' && (el.kind === 'quotecard' || s.media || el.kind === 'panel')) { tape(ctx, s.x + 70, s.y + 2, 150, -6); tape(ctx, s.x + s.w - 70, s.y + 2, 150, 7); }
        });
        return;
      }
      case 'media': {
        const ps = x.parentState;
        if (!ps) return;
        const inset = 14;
        const rect = { x: ps.x + inset, y: ps.y + inset + (ps.dy || 0), w: ps.w - 2 * inset, h: ps.h - 2 * inset - (ps.polaroid ? 56 : 0) };
        const shot = tl.tracks.video.find(v => v.layer === el.layer && v.el === el.id);
        const rot = tilt(`${el.layer}${el.parent}`, skin) * 0.5;
        withState(ctx, { alpha: s.alpha * (ps.alpha == null ? 1 : ps.alpha), sc: ps.sc, rot }, ps.x + ps.w / 2, ps.y + ps.h / 2, () => drawMediaInto(ctx, rect, s, shot, tl, env, t));
        return;
      }
      case 'namecard': withState(ctx, { ...s, rot: tilt(el.id, skin) }, s.x + s.w / 2, s.y + s.h / 2, () => {
        ctx.save(); paperShadow(ctx, skin); ctx.fillStyle = WHITE; ctx.fillRect(s.x, s.y, s.w, s.h); ctx.restore();
        const pm = PILL(TS.caption);
        const photo = { x: s.x + 14, y: s.y + 14, w: s.w - 28, h: s.h - 28 - pm.h - 20 };
        const shot = tl.tracks.video.find(v => v.layer === el.layer && v.el === el.id);
        drawMediaInto(ctx, photo, { asset: s.asset, kind: 'photo' }, shot, tl, env, t);
        const name = s.name || '';
        ctx.font = dFont(TS.caption);
        ctx.fillStyle = INK;
        ctx.fillText(name, s.x + 24, s.y + s.h - 24 - (pm.h - pm.baseline) + 4);
        if (s.tag) drawPill(ctx, { x: s.x + 24, y: photo.y + photo.h - PILL(TS.body).h - 16, size: TS.body, fill: BLUE, ink: WHITE, text: s.tag, alpha: 1 }, M, tl);
        if (skin === 'scrapbook') tape(ctx, s.x + s.w / 2, s.y + 4, 160, (hash(el.id) - 0.5) * 12);
      }); return;
      case 'sticker': {
        const pm = PILL(s.size || TS.caption);
        const font = dFont(s.size || TS.caption);
        const w = M(s.text, font) + pm.padLeft + pm.padRight;
        withState(ctx, s, s.x, s.y, () => {
          ctx.fillStyle = RED;
          ctx.fillRect(s.x - w / 2, s.y - pm.h / 2, w, pm.h);
          ctx.fillStyle = WHITE;
          ctx.font = font;
          ctx.fillText(s.text, s.x - w / 2 + pm.padLeft, s.y - pm.h / 2 + pm.baseline);
        });
        return;
      }
      case 'cutout': {
        const cut = env.cutouts && env.cutouts[s.asset];
        const img = mediaSize(cut) ? cut : null;
        withState(ctx, s, s.x + s.w / 2, s.y + s.h / 2, () => {
          ctx.fillStyle = BLUE;
          ctx.fillRect(s.x + s.w * 0.12, s.y + s.h * 0.3, s.w * 0.76, s.h * 0.7);
          if (img) {
            const [iw, ih] = mediaSize(img);
            const k = Math.min((s.h * 1.08) / ih, s.w / iw);
            const dw = iw * k; const dh = ih * k;
            ctx.save();
            if (skin === 'scrapbook') { ctx.shadowColor = WHITE; ctx.shadowBlur = 0; [[6, 0], [-6, 0], [0, 6], [0, -6]].forEach(([ox, oy]) => { ctx.shadowOffsetX = ox; ctx.shadowOffsetY = oy; ctx.drawImage(img, s.x + (s.w - dw) / 2, s.y + s.h - dh, dw, dh); }); noShadow(ctx); }
            ctx.drawImage(img, s.x + (s.w - dw) / 2, s.y + s.h - dh, dw, dh);
            ctx.restore();
          } else {
            const shot = tl.tracks.video.find(v => v.layer === el.layer && v.el === el.id);
            drawMediaInto(ctx, { x: s.x + s.w * 0.12, y: s.y + s.h * 0.3, w: s.w * 0.76, h: s.h * 0.7 }, { asset: s.asset, kind: 'photo' }, shot, tl, env, t);
          }
        });
        return;
      }
      case 'teamchip': withState(ctx, s, s.x + s.w / 2, s.y + s.h / 2, () => {
        const logo = s.logo && env.images ? env.images[s.logo] : null;
        if (mediaSize(logo)) { const [lw, lh] = mediaSize(logo); const k = Math.min(s.w / lw, s.h / lh); ctx.drawImage(logo, s.x + (s.w - lw * k) / 2, s.y + (s.h - lh * k) / 2, lw * k, lh * k); return; }
        ctx.fillStyle = INK;
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.fillStyle = WHITE;
        ctx.font = dFont(TS.label);
        ctx.textAlign = 'center';
        ctx.fillText(s.text, s.x + s.w / 2, s.y + s.h / 2 + (CAP * TS.label) / 2);
        ctx.textAlign = 'left';
      }); return;
      case 'rect': withState(ctx, s, s.x, s.y + s.h / 2, () => { ctx.fillStyle = s.fill || INK; ctx.fillRect(s.x, s.y, Math.max(0, s.w), s.h); }); return;
      case 'dot': withState(ctx, s, s.x, s.y, () => {
        ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(0.5, s.r), 0, Math.PI * 2);
        ctx.fillStyle = s.fill || INK; ctx.fill();
        if (s.stroke && s.lw) { ctx.lineWidth = s.lw; ctx.strokeStyle = s.stroke; ctx.stroke(); }
      }); return;
      case 'ring': withState(ctx, s, s.x, s.y, () => { ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.lineWidth = s.lw; ctx.strokeStyle = s.stroke; ctx.stroke(); }); return;
      case 'xmark': withState(ctx, s, s.x, s.y, () => { ctx.lineWidth = s.lw; ctx.strokeStyle = s.stroke; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(s.x - s.r, s.y - s.r); ctx.lineTo(s.x + s.r, s.y + s.r); ctx.moveTo(s.x + s.r, s.y - s.r); ctx.lineTo(s.x - s.r, s.y + s.r); ctx.stroke(); }); return;
      case 'avatar': withState(ctx, s, s.x, s.y, () => {
        ctx.save();
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
        ctx.clip();
        const img = s.asset && env.images ? env.images[s.asset] : null;
        if (mediaSize(img)) { const face = ES.faceBox(mediaSize(img), null, tl.assets[s.asset]); const c = ES.focusCrop(mediaSize(img), { x: s.x - s.r, y: s.y - s.r, w: 2 * s.r, h: 2 * s.r }, face, 1, 0.7); ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, s.x - s.r, s.y - s.r, 2 * s.r, 2 * s.r); } else { ctx.fillStyle = WHITE; ctx.font = dFont(TS.label); ctx.textAlign = 'center'; ctx.fillText(s.text || '', s.x, s.y + (CAP * TS.label) / 2); ctx.textAlign = 'left'; }
        ctx.restore();
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.lineWidth = 8; ctx.strokeStyle = s.ring || BLUE; ctx.stroke();
      }); return;
      case 'line': {
        const p = s.p == null ? 1 : clamp01(s.p);
        if (p <= 0) return;
        withState(ctx, { ...s, sc: 1, sy: 1 }, 0, 0, () => {
          const x2 = s.x1 + (s.x2 - s.x1) * p;
          const y2 = s.y1 + (s.y2 - s.y1) * p;
          ctx.strokeStyle = s.stroke || INK;
          ctx.lineWidth = s.lw || 4;
          ctx.lineCap = s.cap ? 'round' : 'butt';
          if (s.dash) ctx.setLineDash([s.lw * 3, s.lw * 2.4]);
          ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.setLineDash([]);
          if (s.head && p > 0.6) arrowHead(ctx, s.x1, s.y1, x2, y2, s.lw, s.stroke, (p - 0.6) / 0.4);
        });
        return;
      }
      case 'poly': {
        const p = s.p == null ? 1 : clamp01(s.p);
        const list = s.pts || [];
        if (p <= 0 || list.length < 2) return;
        withState(ctx, { ...s, sc: 1, sy: 1 }, 0, 0, () => {
          const segs = list.slice(1).map((q, i) => Math.hypot(q[0] - list[i][0], q[1] - list[i][1]));
          const total = segs.reduce((a, b) => a + b, 0);
          let left = total * p;
          ctx.strokeStyle = s.stroke || BLUE;
          ctx.lineWidth = s.lw || 6;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(list[0][0], list[0][1]);
          let end = list[0]; let prev = list[0];
          for (let i = 0; i < segs.length && left > 0; i += 1) {
            const k = Math.min(1, left / segs[i]);
            end = [list[i][0] + (list[i + 1][0] - list[i][0]) * k, list[i][1] + (list[i + 1][1] - list[i][1]) * k];
            prev = list[i];
            ctx.lineTo(end[0], end[1]);
            left -= segs[i];
          }
          ctx.stroke();
          if (s.head && p > 0.85) arrowHead(ctx, prev[0], prev[1], end[0], end[1], s.lw, s.stroke, (p - 0.85) / 0.15);
          if (s.dot) list.forEach((q, i) => { if (i / (list.length - 1) <= p + 1e-6) { ctx.beginPath(); ctx.arc(q[0], q[1], s.lw * 0.9, 0, Math.PI * 2); ctx.fillStyle = WHITE; ctx.fill(); ctx.lineWidth = s.lw * 0.5; ctx.stroke(); } });
        });
        return;
      }
      case 'slot': withState(ctx, s, s.x + s.w / 2, s.y + s.h / 2, () => {
        ctx.fillStyle = WHITE; ctx.fillRect(s.x, s.y, s.w, s.h);
        if (s.f > 0) { ctx.fillStyle = s.fill || BLUE; const h = s.h * clamp01(s.f); ctx.fillRect(s.x, s.y + s.h - h, s.w, h); }
        ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.strokeRect(s.x + 2.5, s.y + 2.5, s.w - 5, s.h - 5);
      }); return;
      case 'check': withState(ctx, s, s.x + s.size / 2, s.y + s.size / 2, () => {
        ctx.strokeStyle = s.stroke || INK; ctx.lineWidth = 6; ctx.strokeRect(s.x + 3, s.y + 3, s.size - 6, s.size - 6);
        const p = s.p == null ? 1 : clamp01(s.p);
        if (p <= 0) return;
        ctx.strokeStyle = s.mark || BLUE; ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        if (s.checked) {
          const a = [s.x + s.size * 0.2, s.y + s.size * 0.52]; const b = [s.x + s.size * 0.42, s.y + s.size * 0.74]; const c = [s.x + s.size * 0.95, s.y + s.size * 0.05];
          const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]); const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]); let left = (l1 + l2) * p;
          ctx.moveTo(a[0], a[1]);
          const k1 = Math.min(1, left / l1); ctx.lineTo(a[0] + (b[0] - a[0]) * k1, a[1] + (b[1] - a[1]) * k1); left -= l1;
          if (left > 0) { const k2 = Math.min(1, left / l2); ctx.lineTo(b[0] + (c[0] - b[0]) * k2, b[1] + (c[1] - b[1]) * k2); }
        } else {
          const q = Math.min(1, p * 2); const q2 = clamp01(p * 2 - 1); const i0 = s.size * 0.24; const i1 = s.size * 0.76;
          ctx.moveTo(s.x + i0, s.y + i0); ctx.lineTo(s.x + i0 + (i1 - i0) * q, s.y + i0 + (i1 - i0) * q);
          if (q2 > 0) { ctx.moveTo(s.x + i1, s.y + i0); ctx.lineTo(s.x + i1 - (i1 - i0) * q2, s.y + i0 + (i1 - i0) * q2); }
        }
        ctx.stroke();
      }); return;
      case 'calendar': withState(ctx, { ...s, rot: tilt(el.id, skin) }, s.x + s.w / 2, s.y + s.h / 2, () => {
        ctx.save(); paperShadow(ctx, skin); ctx.fillStyle = WHITE; ctx.fillRect(s.x, s.y, s.w, s.h); ctx.restore();
        const band = 112;
        ctx.fillStyle = RED; ctx.fillRect(s.x, s.y, s.w, band);
        ctx.fillStyle = WHITE; ctx.font = dFont(TS.caption); ctx.textAlign = 'center';
        ctx.fillText(`${s.month}${s.year ? ` ${s.year}` : ''}`, s.x + s.w / 2, s.y + band / 2 + (CAP * TS.caption) / 2);
        const big = String(s.big || '');
        const size = big.length > 2 ? TS.display : TS.statXL;
        ctx.fillStyle = INK; ctx.font = dFont(size);
        ctx.fillText(big, s.x + s.w / 2, s.y + band + (s.h - band) / 2 + (CAP * size) / 2);
        ctx.textAlign = 'left';
        [0.25, 0.75].forEach(f => { ctx.fillStyle = INK; ctx.fillRect(s.x + s.w * f - 6, s.y - 18, 12, 40); });
      }); return;
      case 'stamp': {
        const size = s.size || TS.caption;
        const font = dFont(size);
        const tw = M(s.text, font);
        const w = tw + 56;
        const h = CAP * size + 52;
        withState(ctx, s, s.x, s.y, () => {
          ctx.strokeStyle = s.color || RED;
          ctx.fillStyle = s.color || RED;
          ctx.lineWidth = 8;
          ctx.strokeRect(s.x - w / 2, s.y - h / 2, w, h);
          ctx.lineWidth = 3;
          ctx.strokeRect(s.x - w / 2 + 12, s.y - h / 2 + 12, w - 24, h - 24);
          ctx.font = font;
          ctx.textAlign = 'center';
          ctx.fillText(s.text, s.x, s.y + (CAP * size) / 2);
          ctx.textAlign = 'left';
        });
        return;
      }
      case 'button': withState(ctx, s, s.x + s.w / 2, s.y + s.h / 2, () => {
        ctx.save(); paperShadow(ctx, 'clean'); ctx.fillStyle = s.fill; ctx.fillRect(s.x, s.y, s.w, s.h); ctx.restore();
        const size = tSize(M, s.text, [s.size || TS.h2, TS.caption], s.w - 96);
        ctx.font = dFont(size); ctx.fillStyle = WHITE; ctx.textAlign = 'center';
        ctx.fillText(s.text, s.x + s.w / 2, s.y + s.h / 2 + (CAP * size) / 2);
        ctx.textAlign = 'left';
      }); return;
      case 'wordmark': withState(ctx, s, s.x, s.y, () => {
        const art = helpers && helpers.BRAND && helpers.BRAND.wordmark;
        const h = art ? (s.w * art.h) / art.w : 96;
        if (helpers && helpers.drawBrand && art) helpers.drawBrand(ctx, 'wordmark', s.x - s.w / 2, s.y - h / 2, s.w, h, 'blue', env);
        else { ctx.font = dFont(TS.h2); ctx.fillStyle = BLUE; ctx.textAlign = 'center'; ctx.fillText('ESSENTIALLYSPORTS', s.x, s.y); ctx.textAlign = 'left'; }
      }); return;
      default: return;
    }
  }
  function arrowHead(ctx, x1, y1, x2, y2, lw, color, k) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const L = lw * 3.2 * clamp01(k);
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x2 + Math.cos(a) * L * 0.4, y2 + Math.sin(a) * L * 0.4);
    ctx.lineTo(x2 - Math.cos(a - 0.5) * L, y2 - Math.sin(a - 0.5) * L);
    ctx.lineTo(x2 - Math.cos(a + 0.5) * L, y2 - Math.sin(a + 0.5) * L);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  function drawGround(ctx, tl, w, h) {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);
    if (tl.skin === 'scrapbook') {
      ctx.save();
      ctx.strokeStyle = 'rgba(10,125,250,0.10)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 20; x < w; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = 20; y < h; y += 40) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(10,125,250,0.18)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = 20; x < w; x += 200) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = 20; y < h; y += 200) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      ctx.restore();
    }
  }
  // The slab: one blue diagonal slab; it covers the whole frame at p = 0.5.
  function slabPoly(p, w = W, h = H) {
    const lean = Math.tan((Math.abs(WIPE.skewDeg) * Math.PI) / 180) * h;
    const SW = w + lean + 120;
    const x0 = -SW;
    const x1 = w + lean;
    const x = x0 + (x1 - x0) * ease.inOut(clamp01(p));
    return [[x, 0], [x + SW, 0], [x + SW - lean, h], [x - lean, h]];
  }
  function inPoly(poly, px, py) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function drawCaptions(ctx, tl, t, M) {
    const words = tl.tracks.captions.words;
    const cards = tl.tracks.captions.cards;
    const card = cards.find(c => t >= c.s && t < c.e);
    if (!card) return;
    const y = capAt(tl, t);
    const exitQ = clamp01((t - (card.e - CAPTION_POP.exitMs)) / CAPTION_POP.exitMs);
    const out = 1 - ease.in(exitQ);
    // h2 when the card fits the column, else the caption step (never smaller).
    const list = card.words.map(i => ({ ...words[i], text: words[i].w.toUpperCase().replace(/[.,;:!]+$/, '').replace(/^["“(]|["”)]$/g, '') }));
    const widths = sz => list.map(w => M(w.text, dFont(sz)) + PILL(sz).padLeft + PILL(sz).padRight);
    let size = TS.h2;
    let ws = widths(size);
    if (ws.reduce((a, b) => a + b, 0) > 960) { size = TS.caption; ws = widths(size); }
    const pm = PILL(size);
    const total = ws.reduce((a, b) => a + b, 0);
    let x = 540 - total / 2;
    const top = y - pm.h / 2;
    list.forEach((w, i) => {
      const q = clamp01((t - w.s) / CAPTION_POP.ms);
      if (t < w.s) { x += ws[i]; return; }
      const e = ease.out(q);
      const a = Math.min(1, q * 2) * out;
      const sc = CAPTION_POP.from + (1 - CAPTION_POP.from) * e;
      const hl = w.em || w.hl;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.translate(x + ws[i] / 2, y);
      ctx.scale(sc, sc);
      ctx.translate(-(x + ws[i] / 2), -y);
      ctx.fillStyle = hl ? BLUE : INK;
      ctx.fillRect(Math.round(x), Math.round(top), Math.ceil(ws[i]) + 1, Math.round(pm.h));
      ctx.fillStyle = WHITE;
      ctx.font = dFont(size);
      ctx.fillText(w.text, x + pm.padLeft, top + pm.baseline);
      ctx.restore();
      x += ws[i];
    });
  }
  function drawMark(ctx, tl, helpers, env, slab, x, y) {
    const size = ZONE.mark.size;
    const covered = slab && inPoly(slab, x + size / 2, y + size / 2);
    const v = covered ? 'black' : 'blue';
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = v === 'black' ? '#000000' : BLUE;
    ctx.fillRect(x, y, size, size);
    const art = helpers && helpers.BRAND && helpers.BRAND.mark;
    const h = art ? (size * art.h) / art.w : size;
    if (helpers && helpers.drawBrand) helpers.drawBrand(ctx, 'mark', x, y + (size - h) / 2, size, h, v, env);
    ctx.restore();
  }
  // drawFrame(ctx, timeline, tMs, env, helpers): one frame. A 4:5 timeline
  // draws the 9:16 design fitted into 1080 x 1350 (the words y 280-1660 band
  // scaled to fit), the ES mark at full size top-right.
  function drawFrame(ctx, tl, tMs, env = {}, helpers = {}) {
    const t = Math.max(0, Math.min(tl.durationMs - 1, tMs));
    const [cw, ch] = tl.size;
    const M = measurer(env);
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    drawGround(ctx, tl, cw, ch);
    const four = ch !== H;
    const k = four ? (ch - 112) / (1660 - 280) : 1;
    if (four) { ctx.translate((cw - W * k) / 2, 56 - 280 * k); ctx.scale(k, k); }
    const vis = visibleAt(tl, t);
    vis.list.forEach(x => { if (x.el.kind !== 'anchor') drawEl(ctx, x, tl, env, t, M, helpers); });
    drawCaptions(ctx, tl, t, M);
    ctx.restore();
    const wipe = wipeAt(tl, t);
    let slab = null;
    if (wipe) {
      slab = slabPoly(wipe.p, cw, ch);
      ctx.save();
      ctx.fillStyle = BLUE;
      ctx.beginPath();
      slab.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    drawMark(ctx, tl, helpers, env, slab, cw - 60 - ZONE.mark.size, four ? 60 : ZONE.mark.y);
    return { t, layer: vis.layer.i, wipe };
  }

  // ─── Checks: the motion lint + the brand checks (v4) ────────────────────
  const issue = (id, severity, message, fix = '', beat = '') => ({ id, severity, message, fix, beat });
  function elBox(x, M) {
    const { el, s } = x;
    switch (el.kind) {
      case 'pill': { const pm = PILL(s.size || TS.label); const w = M(s.text, dFont(s.size || TS.label)) + pm.padLeft + pm.padRight; let px = s.anchor === 'center' ? s.x - w / 2 : s.anchor === 'right' ? s.x - w : s.x; if (s.minX != null) px = Math.max(s.minX, Math.min((s.maxX || 1e9) - w, px)); return { x: px, y: s.y, w, h: pm.h, text: s.text }; }
      case 'text': { const size = s.size || TS.label; const w = M(textOf(s), s.font === 's' ? sFont(size) : dFont(size)); const px = s.align === 'center' ? s.x - w / 2 : s.align === 'right' ? s.x - w : s.x; return { x: px, y: s.y - CAP * size, w, h: CAP * size, text: textOf(s) }; }
      case 'headline': case 'para': { const lay = el.kind === 'headline' ? wrapEm(M, s.text, HEAD_STEPS, s.w, 2, TS.h2) : wrapEm(M, s.text, s.steps || [TS.h2, TS.caption], s.w, s.maxLines || 2, Infinity, s.h || Infinity); return { x: s.x, y: s.y, w: Math.max(0, ...lay.lines.map(l => l.w)), h: lay.lines.length * lay.size * 0.92, text: s.text, fits: lay.fits }; }
      case 'stamp': { const size = s.size || TS.caption; const w = M(s.text, dFont(size)) + 56; const h = CAP * size + 52; return { x: s.x - w / 2, y: s.y - h / 2, w, h, text: s.text }; }
      case 'sticker': { const size = s.size || TS.caption; const pm = PILL(size); const w = M(s.text, dFont(size)) + pm.padLeft + pm.padRight; return { x: s.x - w / 2, y: s.y - pm.h / 2, w, h: pm.h, text: s.text }; }
      default: return null;
    }
  }
  // Text boxes of every beat, settled (the lint and the sheets read these).
  function textBoxes(tl, measure) {
    const M = measure || approxMeasure;
    const out = [];
    tl.beats.forEach(b => {
      const t = Math.min(b.outMs - DUR.s - 20, Math.max(b.inMs + 1800, b.inMs + (b.outMs - b.inMs) * 0.7));
      visibleAt(tl, t).list.forEach(x => { const box = elBox(x, M); if (box) out.push({ ...box, beat: b.id, role: x.el.id }); });
    });
    return out;
  }
  function checks(tl, { measure = null } = {}) {
    const out = [];
    const M = measure || approxMeasure;
    // 1. The motion system: durations on the scale, named curves, no linear.
    let offScale = 0; let linear = 0; let bareSet = 0;
    tl.els.forEach(el => el.keys.forEach(k => {
      if (k.c === 'set') { if (k.d !== 0 || !k.cover) bareSet += 1; return; }
      if (!MOTION4.NAMED.includes(k.c)) linear += 1;
      if (!k.ambient && !DURATIONS.includes(k.d)) offScale += 1;
    }));
    if (offScale) out.push(issue('motion-scale', 'critical', `${offScale} animation${offScale > 1 ? 's are' : ' is'} off the duration scale (160 / 240 / 400 / 640 ms).`, 'Use a step of the motion scale.'));
    if (linear) out.push(issue('motion-linear', 'critical', `${linear} animation${linear > 1 ? 's use' : ' uses'} linear or unnamed easing.`, 'Use ES out, inOut, in (exits) or the spring.'));
    if (bareSet) out.push(issue('motion-cut', 'critical', `${bareSet} element${bareSet > 1 ? 's jump' : ' jumps'} while on screen.`, 'Morph it, or change it under the wipe.'));
    (tl.wipes || []).forEach(w => { if (w.ms !== WIPE.ms) out.push(issue('motion-scale', 'critical', 'A chapter wipe is not 640 ms.', 'Use the slab wipe.')); });
    // 2. Every beat moves: an animation, a moving picture, or the close's breathing.
    tl.beats.forEach((b, i) => {
      const L = tl.layers.find(x => b.inMs >= x.start && b.inMs < x.end) || tl.layers[0];
      const keyMoves = tl.els.some(el => el.layer === L.i && el.keys.some(k => k.d > 0 && k.t < b.outMs && k.t + k.d > b.inMs));
      const media = tl.tracks.video.some(s => s.layer === L.i && s.inMs < b.outMs && s.outMs > b.inMs && tl.assets[s.asset]);
      if (!keyMoves && !media) out.push(issue('static-beat', 'critical', `Beat ${i + 1} does not move: no clip, no photo and no module building.`, 'Give it a clip or photo, or a data module that builds.', b.id));
    });
    // 3. Empty media slots; 4. clips.
    tl.els.forEach(el => {
      if (['media', 'namecard', 'cutout'].includes(el.kind) && (!el.final.asset || !tl.assets[el.final.asset])) {
        const b = tl.beats.find(x => x.inMs <= (el.born[0] || 0) + 1 && x.outMs > (el.born[0] || 0)) || {};
        out.push(issue('empty-media', 'critical', `A ${el.kind === 'namecard' ? 'name card' : el.kind === 'cutout' ? 'cut-out' : 'media window'} has no clip or photo.`, 'Find a clip, or set the beat\'s media to none.', b.id || ''));
      }
    });
    if (!tl.clipCount) out.push(issue('needs-clips', 'critical', 'This reel has no confirmed clip. Every ES breakdown needs at least one.', 'Find clips.'));
    // 5. Modules: their data shapes.
    (tl.plan ? tl.plan.chapters : []).forEach(c => c.beats.forEach(b => {
      if (b.moduleRaw) out.push(issue('module-shape', 'critical', `"${b.moduleRaw.type}" is not a module this engine draws.`, `Use one of: ${MODULE_TYPES.join(', ')}.`, b.id));
      if (b.module) moduleProblems(b.module).forEach(msg => out.push(issue('module-shape', 'critical', msg, 'Fill in the module, or pick another.', b.id)));
      if (b.media && b.media.kind === 'cards' && b.module && moduleNeed(b.module) > LAYOUTS.both.module.h) out.push(issue('layout', 'warning', 'Name cards leave a short data zone: this module is squeezed.', 'Use a compact module (tiles, compare, scoreboard).', b.id));
    }));
    // 6. Brand (v3 checks, v4 edition): palette, type scale, safe frame,
    //    the mark, one emphasis per headline, captions of 1-3 words, no emoji.
    const off = new Set();
    let sizes = 0;
    tl.els.forEach(el => el.keys.forEach(k => {
      ['fill', 'color', 'ink', 'stroke', 'em', 'mark'].forEach(n => { const v = k.p[n]; if (typeof v === 'string' && HEX.test(v) && !PALETTE.has(v.toUpperCase())) off.add(v); });
      if (k.p.size != null && !Object.values(TS).includes(k.p.size)) sizes += 1;
    }));
    if (off.size) out.push(issue('palette', 'critical', `Colours outside the ES palette: ${[...off].slice(0, 4).join(', ')}.`, 'ES blue, ink, paper, white (red for bad).'));
    if (sizes) out.push(issue('type-scale', 'critical', `${sizes} text size${sizes > 1 ? 's are' : ' is'} off the ES type scale.`, 'Use a step of the type scale.'));
    const boxes = textBoxes(tl, M);
    const seen = new Set();
    boxes.forEach(b => {
      if (seen.has(`${b.beat}:${b.role}`)) return;
      if (b.x < 39.5 || b.x + b.w > 1040.5 || b.y < 299.5 || b.y + b.h > 1640.5) { seen.add(`${b.beat}:${b.role}`); out.push(issue('safe-frame', 'critical', `“${String(b.text).slice(0, 24)}” is outside the ES safe frame.`, 'Shorten it.', b.beat)); }
      const mk = { x: ZONE.mark.x - 40, y: ZONE.mark.y - 40, w: ZONE.mark.size + 80, h: ZONE.mark.size + 80 };
      if (b.x < mk.x + mk.w && b.x + b.w > mk.x && b.y < mk.y + mk.h && b.y + b.h > mk.y) { seen.add(`${b.beat}:${b.role}`); out.push(issue('logo', 'critical', `“${String(b.text).slice(0, 24)}” sits in the ES mark's clear space.`, 'Shorten it.', b.beat)); }
      if (b.fits === false) { seen.add(`${b.beat}:${b.role}`); out.push(issue('fit', 'warning', `“${String(b.text).slice(0, 24)}” is too long for its zone at the smallest step.`, 'Shorten it.', b.beat)); }
    });
    (tl.plan ? tl.plan.chapters : []).forEach(c => {
      const n = (c.headline.match(/\*[^*]+\*/g) || []).length;
      if (n > 1) out.push(issue('headline', 'warning', `Chapter "${c.headline.replace(/\*/g, '')}" colours ${n} words. One.`, 'Keep one *word*.', c.beats[0] && c.beats[0].id));
      if (!n) out.push(issue('headline', 'info', `Chapter "${c.headline}" has no coloured word.`, 'Mark the key word with *stars*.', c.beats[0] && c.beats[0].id));
      if (!c.headline) out.push(issue('headline', 'critical', 'A chapter has no headline.', 'Write one (it holds for the chapter).', c.beats[0] && c.beats[0].id));
    });
    const EMOJI = /\p{Extended_Pictographic}/u;
    tl.beats.forEach(b => { if (EMOJI.test(`${b.text} ${b.vo}`)) out.push(issue('banned', 'critical', 'No emoji on screen or in the voiceover.', 'Remove it.', b.id)); });
    (tl.tracks.captions.cards || []).forEach(c => { if (c.words.length > 3) out.push(issue('captions', 'warning', 'A caption has more than 3 words.', '', c.beat)); });
    return out;
  }

  return {
    MOTION4, CURVES, SPRING, DURATIONS, DUR, STAGGER, WIPE, ease, springAt, curveAt, bezier,
    MODULE_TYPES, MEDIA_KINDS, LAYOUTS, ZONE, PALETTE, TONE,
    cleanModule, moduleProblems, moduleStrings, moduleNeed, normalize, toV4, isV4, STRUCTURAL,
    buildTimeline, stateAt, visibleAt, layerAt, wipeAt, frameAt, clipTimes, clipTime, capAt,
    drawFrame, slabPoly, inPoly, textBoxes, checks, approxMeasure, keyWord, countable, fmtCount, mixVal,
  };
}));
