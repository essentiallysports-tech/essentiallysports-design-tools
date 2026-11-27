// ES Reels: the ES video team's reels design system (from Vinay, brand kit of
// 2 Nov 2026), built into Reels Studio as data and pure functions. One file
// for the browser (window.ReelES), the server and the tests (require), like
// reel-styles.js. reel-render.js draws the 'es' style with it, reel-lint.js
// runs its checklist, the director and the page read its blocks.
//
//   TOKENS / TYPE / MOTION / LIMITS     the brand rules as numbers
//   geometry([w, h])                    column, safe frame, caption line, marks
//                                       (1080x1920; 1080x1350 scaled, see below)
//   BLOCKS / blockOf(beat) / cleanBlock / legacyFields / blockText
//                                       the seven blocks and their exact fields
//   parseEmphasis(vo) / plainVo(vo)     *word* caption emphasis
//   scriptToPlan(script, opts)          the person's script, word for word, in beats
//   layoutBlock / layoutCaption / textBoxes   ops with boxes (safe-frame maths)
//   drawFrame / drawSlab / drawMark     canvas drawing (helpers passed in by reel-render)
//   checks(timeline, opts) / checklist(issues)   the system's checklist as lint
//
// What is written in the kit is followed exactly; what the kit's HTML template
// would have decided (it was not available) is marked INFERRED below.
//
// Reels 2.0 (looks): reel-es-themes.js holds the looks as data (Paper, Ink,
// Blue, Team colour, Photo-led, Data-led, Minimal, Bold). themeOf(timeline)
// resolves the reel's look; the ground, colours, pills, captions, dots, the
// mark's colourway and the slab's two colours come from it. Fonts, the safe
// frame, the caption line, the marks' places, the wipe's shape and timing, the
// end card and LIMITS do not: no look can move them. A reel with no look is
// Paper and draws exactly as before (scripts/test-reel-looks.mjs holds a
// golden copy of every draw call).
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./reel-es-themes.js') : root.ReelESThemes, node ? require('./frameup-rules.js') : root.FrameUpRules);
  if (node) module.exports = api;
  else root.ReelES = api;
}(typeof self !== 'undefined' ? self : this, (TH, RULES) => {
  'use strict';
  if (!TH) throw new Error('reel-es.js needs reel-es-themes.js loaded first.');

  // ─── Brand tokens (references/brand.md) ─────────────────────────────────
  const TOKENS = { blue: '#0A7DFA', ink: '#121212', paper: '#F1EFEA', green: '#1BC47D', red: '#E8322B', yellow: '#FFC52F', white: '#FFFFFF' };
  // v3: the neutral grey of the dot grid's "didn't" group and a tie square
  // (never a ground, never text; ink reads on it at 10:1).
  const GREY = '#C9C5BC';
  // Signal colours mean something (win / loss / emphasis). At most 2 per beat.
  const SIGNALS = ['green', 'red', 'yellow'];
  const COLOR_NAMES = ['ink', 'blue', 'red', 'green', 'yellow', 'white'];
  // Display: condensed black uppercase. Acumin Pro Condensed Black where the
  // machine has it (Adobe Fonts), else Roboto Condensed 800 (the page loads
  // it). Small text: Roboto 500. Never a third typeface.
  const TYPE = {
    display: '"Acumin Pro Condensed Black", "Roboto Condensed", sans-serif',
    displayWeight: 800,
    small: 'Roboto, sans-serif',
    smallWeight: 500,
    lineHeight: 0.84,
    tracking: -0.01, // em
    cap: 0.71, // cap height of Roboto Condensed (Acumin is within 1%)
    pad: 0.16, // boxed words: 0.16em round the trimmed cap-height-to-baseline box
  };
  const displayFont = size => `${TYPE.displayWeight} ${Math.round(size * 10) / 10}px ${TYPE.display}`;
  const smallFont = size => `${TYPE.smallWeight} ${Math.round(size * 10) / 10}px ${TYPE.small}`;

  // ─── Motion (references/brand.md, Motion) ───────────────────────────────
  const MOTION = {
    enterMs: 400, enterMinMs: 350, enterMaxMs: 450, ease: 'expo.out',
    fromLeft: 60, fromBelow: 36, // 60 px from the left, or 30-40 px from below
    staggerMs: 160, staggerMinMs: 150, staggerMaxMs: 180,
    wipeMs: 500, wipeSkewDeg: -14, wipeColors: ['blue', 'ink'], // the only cut
    driftFrom: 1, driftTo: 1.1, // photos, over the whole scene
    stampMs: 200, stampEase: 'power4.in', stampRotDeg: -9, stampFrom: 1.7, shakeMs: 260, shakePx: 12,
    countMs: 1000, // number count-up (INFERRED: the kit gives no duration)
    captionMaxWords: 3, // captions cut on 1-3 words at a time, never word by word
  };
  const ease = {
    expoOut: t => { const x = clamp01(t); return x >= 1 ? 1 : 1 - 2 ** (-10 * x); },
    power4In: t => clamp01(t) ** 5, // GSAP power4 = quint
    inOutCubic: t => { const x = clamp01(t); return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2; },
    inOutSine: t => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t)),
  };
  function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

  // ─── Copy limits (references/blocks.md, copy.md, checklist.md) ──────────
  const LIMITS = { pillChars: 14, pills: 3, lineChars: 14, lines: 3, quoteChars: 70, dotsMax: 2600, compareMin: 2, compareMax: 4, digits: 6, signalsPerBeat: 2, endcardMs: 3000, wordsPerSecond: 2.6 };
  const DEFAULT_CTA = ['WE BRING', 'THE RECEIPTS.'];

  // ─── Layout (1080 x 1920) and the 4:5 export ───────────────────────────
  // 9:16 is the kit, to the pixel. 4:5 (1080x1350) is INFERRED: the same
  // rules with every vertical position scaled by 1350/1920 (safe frame top
  // 211, bottom 1153, captions at 824, ES mark top 232), the same 60 px
  // column and 40 px side margin, type scaled by 0.82 so blocks keep their
  // proportions in the shorter frame, marks at full size (never scaled).
  function geometry(size) {
    const w = Array.isArray(size) ? Number(size[0]) || 1080 : 1080;
    const h = Array.isArray(size) ? Number(size[1]) || 1920 : 1920;
    const k = h / 1920;
    const r = v => Math.round(v * k);
    return {
      w, h, k, type: h >= 1900 ? 1 : 0.82,
      col: { x: 60, w: 960 },
      safe: { top: r(300), bottom: r(1640), side: 40 },
      captionY: r(1172),
      mark: { size: 80, x: w - 60 - 80, y: r(330), clear: 40 },
      logotype: { h: 96 },
      top: { hook: r(480), statement: r(440), block: r(440) },
      // Blocks stay above the caption line, 64 px clear of its bar (v3).
      contentBottom: r(1072),
      lowerTop: r(1268), // below the caption line (dots note)
      sourceY: r(1590),
      // v3 slots (the one grid): every block's parts start on these.
      //   kicker  the series / label pill, level with the top of the ES mark
      //   head    the headline (hook pills, titles, statement lines)
      //   lower   the second element, below the caption line (tiles, legend, label pills)
      //   centre  where a scene's group of words and data is centred when it
      //           has no picture (the optical centre of the word zone)
      slots: { kicker: r(330), head: r(480), centre: r(880), lower: r(1288), cardBottom: r(1240), cardBottomSolo: r(1400) },
      unit: 8,
    };
  }
  const GEO = geometry([1080, 1920]);

  // ─── v3: one type scale (Reels Studio v3) ───────────────────────────────
  // Every word on screen is one of these sizes (9:16 px; the 4:5 frame
  // multiplies them all by its type factor, 0.82). Nothing auto-shrinks to an
  // in-between size: text that does not fit moves down one step, and at the
  // smallest step a block allows it is shortened at a word (the lint says so).
  // Working values until Vinay's ES Reels design system file is reconciled.
  const TYPE_SCALE = Object.freeze({ statXL: 300, stat: 220, display: 168, h1: 128, h2: 96, caption: 64, label: 44, body: 34 });
  const STEP_NAMES = Object.freeze(['statXL', 'stat', 'display', 'h1', 'h2', 'caption', 'label', 'body']);
  const SCALE_STEPS = Object.freeze(STEP_NAMES.map(n => TYPE_SCALE[n]));
  const stepIndex = name => (STEP_NAMES.includes(name) ? STEP_NAMES.indexOf(name) : STEP_NAMES.indexOf('h1'));
  // The biggest step at or under a pixel size.
  const snapStep = px => SCALE_STEPS.find(v => v <= (Number(px) || 0) + 0.01) || SCALE_STEPS[SCALE_STEPS.length - 1];
  const stepName = px => STEP_NAMES[SCALE_STEPS.indexOf(snapStep(px))];
  const onScale = (size, T = 1) => SCALE_STEPS.some(v => Math.abs(v * T - Number(size)) < 0.6);
  const stepsFrom = (max, min) => STEP_NAMES.slice(stepIndex(max), Math.max(stepIndex(max), stepIndex(min)) + 1);
  // The first step from max down to min where ok(size) holds; else min, flagged.
  function pickStep(max, min, T, ok) {
    const names = stepsFrom(max, min);
    for (const n of names) { const size = TYPE_SCALE[n] * T; if (ok(size)) return { step: n, size, fits: true }; }
    const n = names[names.length - 1];
    return { step: n, size: TYPE_SCALE[n] * T, fits: false };
  }
  // The 8-pt spacing scale: every gap between parts is one of these.
  const SPACE = Object.freeze({ xs: 8, s: 16, m: 24, l: 40, xl: 56, xxl: 64, gap: 48 });
  // One grid: the ES frame (column x 60 / width 960, words y 300-1640, 40 px
  // sides, captions at y 1172) and its slots. reel-render's retired styles
  // read it too (there is no second grid).
  const GRID = Object.freeze({ unit: 8, left: 60, right: 1020, width: 960, side: 40, top: 300, bottom: 1640, captionY: 1172, slots: GEO.slots });

  // ─── v3: one box language, the FrameUp ES pill ──────────────────────────
  // Every label, tag and boxed word is the ES pill from frameup-rules.js
  // (PILL / pillMetrics): sharp box, 0.94em tall, its side padding, rows
  // that touch. Three sizes, all on the type scale.
  const PILL_SIZES = Object.freeze({ L: 'h1', M: 'caption', S: 'label' });
  // Characters a pill of each size holds before it reads as a sentence.
  const PILL_CHARS = Object.freeze({ L: 16, M: 24, S: 28, XL: 12 });
  function pillMetricsAt(size) {
    if (RULES && RULES.pillMetrics) return RULES.pillMetrics(size, TYPE.cap * size);
    const h = size * (122 / 130);
    const topPad = Math.max(0, Math.round((h - TYPE.cap * size) * 0.5));
    return { size, h, padLeft: size * (18.4 / 130), padRight: size * (21.88 / 130), topPad, baseline: Math.min(topPad + TYPE.cap * size, h - 2), step: Math.max(Math.round(h * 0.55), h - topPad + 1) + 1, cap: TYPE.cap * size };
  }
  const pillPad = size => { const pm = pillMetricsAt(size); return pm.padLeft + pm.padRight; };
  const pillClass = (size, T = 1) => { const n = stepName(size / T); return n === 'h1' ? 'L' : n === 'caption' ? 'M' : n === 'label' || n === 'body' ? 'S' : n === 'h2' ? 'M' : 'XL'; };
  // Element limits per frame: a headline, one picture, one data block, two pills.
  const ELEMENT_LIMITS = Object.freeze({ headline: 1, media: 1, data: 1, pills: 2 });
  // One inner inset for everything drawn inside a box (tiles, the photo card):
  // the gap from its edge to the words and pills in it.
  const TILE_INSET = 32;

  // ─── Blocks (references/blocks.md; the only building blocks) ───────────
  // kind: the Reels Studio beat kind each block rides on, so formats, the
  // director, number provenance and the lint keep working unchanged.
  const BLOCKS = {
    hook: { kind: 'hook', fields: ['media', 'pills', 'stamp', 'kicker'], label: 'Hook', media: true },
    statement: { kind: 'point', fields: ['lines', 'media', 'top'], label: 'Statement', media: true },
    number: { kind: 'stat', fields: ['value', 'prefix', 'suffix', 'label', 'kicker', 'color'], label: 'Number' },
    dots: { kind: 'dotrank', fields: ['count', 'highlight', 'label', 'note'], label: 'Dots' },
    compare: { kind: 'bars', fields: ['items', 'kicker'], label: 'Compare' },
    quote: { kind: 'quote', fields: ['text', 'who'], label: 'Quote' },
    endcard: { kind: 'cta', fields: ['cta'], label: 'End card' },
    // v3 blocks (Reels Studio v3): the team's reference frames, on the one grid.
    photoCard: { kind: 'point', fields: ['photo', 'label', 'focus', 'scan', 'title', 'kicker', 'tag', 'tiles'], label: 'Photo card', media: true, v3: true },
    statTiles: { kind: 'stat', fields: ['tiles', 'title', 'kicker', 'tag'], label: 'Stat tiles', v3: true },
    dotGrid: { kind: 'dotrank', fields: ['total', 'groups', 'title', 'kicker'], label: 'Dot grid', v3: true },
    streak: { kind: 'chips', fields: ['items', 'label', 'title', 'kicker'], label: 'Streak', v3: true },
    rankTile: { kind: 'rank', fields: ['kicker', 'rank', 'pos', 'chip', 'items', 'title', 'label', 'tag'], label: 'Rank tile', v3: true },
    tagPill: { kind: 'point', fields: ['text', 'tone', 'title', 'kicker', 'media'], label: 'Tag', media: true, v3: true },
    clipLabel: { kind: 'point', fields: ['text', 'sub', 'kicker', 'tone', 'media', 'focus'], label: 'Clip label', media: true, v3: true },
  };
  const BLOCK_TYPES = Object.keys(BLOCKS);
  const KIND_FOR = Object.fromEntries(BLOCK_TYPES.map(t => [t, BLOCKS[t].kind]));
  // Every Reels Studio beat kind lands on a block.
  const BLOCK_FOR_KIND = { hook: 'hook', context: 'statement', point: 'statement', payoff: 'statement', rank: 'statement', steps: 'statement', tiles: 'statement', mystery: 'statement', stat: 'number', dotrank: 'dots', chips: 'dots', bars: 'compare', versus: 'compare', roles: 'compare', quote: 'quote', cta: 'endcard' };
  const TEMPLATES = BLOCK_TYPES.map(t => `es-${t}`);

  const str = (v, n = 200) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const colorName = (c, fallback = 'ink') => (COLOR_NAMES.includes(String(c || '').toLowerCase()) ? String(c).toLowerCase() : fallback);
  // ─── The look (reel-es-themes.js) ───────────────────────────────────────
  // themeOf: the reel's look, resolved (a missing or unknown look is Paper).
  // The Team colour look reads the reel's first team colour.
  function themeOf(timeline) {
    const tl = timeline || {};
    const team = tl.team && Array.isArray(tl.team.colors) ? tl.team.colors[0] : '';
    return TH.resolve(tl.look, { team });
  }
  const PAPER = TH.resolve('paper');
  // A colour name ('ink', 'blue', 'team'…) as a colour, in the look.
  const colorOf = (name, theme) => (name === 'grey' ? GREY : (theme ? theme.colors[name] : TOKENS[name]) || name || TOKENS.ink);
  const numOf = v => { const m = String(v == null ? '' : v).replace(/[$,]/g, '').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : NaN; };
  const words = text => String(text || '').trim().split(/\s+/).filter(Boolean);

  // Greedy wrap into lines of at most `max` characters (a longer word keeps its own line).
  function splitLines(text, max = 14) {
    const out = [];
    let line = '';
    words(text).forEach(w => {
      if (!line) line = w;
      else if (`${line} ${w}`.length <= max) line = `${line} ${w}`;
      else { out.push(line); line = w; }
    });
    if (line) out.push(line);
    return out;
  }
  // The same, cut to `n` lines (for headlines made from a sentence, never the VO).
  function fitLines(text, max, n) {
    const lines = splitLines(text, max);
    return lines.length > n ? lines.slice(0, n) : lines;
  }

  // Shape a raw block to its exact fields (anything else is dropped).
  function cleanBlock(raw) {
    const b = raw && typeof raw === 'object' ? raw : {};
    const type = BLOCK_TYPES.includes(b.type) ? b.type : 'statement';
    const out = { type };
    if (type === 'hook') {
      out.pills = (Array.isArray(b.pills) ? b.pills : []).slice(0, LIMITS.pills).map(p => (typeof p === 'string' ? { text: str(p, 40), color: 'ink' } : { text: str(p && p.text, 40), color: colorName(p && p.color), ...(Number(p && p.size) >= 60 ? { size: Math.min(160, Number(p.size)) } : {}) })).filter(p => p.text);
      if (b.stamp && str(b.stamp.text || b.stamp, 20)) {
        const s = typeof b.stamp === 'string' ? { text: b.stamp } : b.stamp;
        out.stamp = { text: str(s.text, 20).split(' ')[0] };
        if (Number.isFinite(Number(s.at)) && s.at !== '' && s.at != null) out.stamp.at = Math.max(0, Math.min(12, Number(s.at)));
        ['x', 'y', 'size'].forEach(k => { if (Number.isFinite(Number(s[k])) && s[k] !== '' && s[k] != null) out.stamp[k] = Number(s[k]); });
      }
      if (b.media) out.media = str(b.media, 200);
      if (str(b.kicker, 28)) out.kicker = str(b.kicker, 28);
    } else if (type === 'statement') {
      out.lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 4).map(l => (typeof l === 'string' ? { text: str(l, 40), color: 'ink' } : { text: str(l && l.text, 40), color: colorName(l && l.color) })).filter(l => l.text);
      if (Number.isFinite(Number(b.top)) && b.top !== '' && b.top != null) out.top = Math.max(300, Math.min(1100, Number(b.top)));
      if (b.media) out.media = str(b.media, 200);
    } else if (type === 'number') {
      const v = numOf(b.value);
      out.value = Number.isFinite(v) ? v : 0;
      out.prefix = str(b.prefix, 3);
      out.suffix = str(b.suffix, 4);
      out.label = str(b.label, 40);
      out.kicker = str(b.kicker, 40);
      out.color = colorName(b.color, 'blue');
      if (b.display) out.display = str(b.display, 16);
    } else if (type === 'dots') {
      out.count = Math.max(1, Math.min(LIMITS.dotsMax * 2, Math.round(numOf(b.count)) || 1));
      out.highlight = Math.max(0, Math.min(out.count, Math.round(numOf(b.highlight)) || 0));
      out.label = str(b.label, 40);
      out.note = str(b.note, 40);
    } else if (type === 'compare') {
      out.items = (Array.isArray(b.items) ? b.items : []).slice(0, 6).map(it => {
        const value = numOf(it && (it.value != null && it.value !== '' ? it.value : it.display));
        return { label: str(it && it.label, 28), value: Number.isFinite(value) ? Math.abs(value) : 0, display: str(it && (it.display || it.value), 16), ...(it && it.color ? { color: colorName(it.color) } : {}) };
      }).filter(it => it.label);
      out.kicker = str(b.kicker, 40);
    } else if (type === 'quote') {
      out.text = str(b.text, 200).replace(/^[“"]|[”"]$/g, '');
      out.who = str(b.who || b.by, 60);
    } else if (type === 'endcard') {
      const cta = Array.isArray(b.cta) ? b.cta.map(c => str(c, 30)).filter(Boolean).slice(0, 2) : [];
      out.cta = cta.length ? cta : DEFAULT_CTA.slice();
    } else cleanV3(type, b, out);
    return out;
  }
  // ─── v3 block shapes ────────────────────────────────────────────────────
  const toneOf = (v, allowed, d) => (allowed.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : d);
  // A focus box { x, y, w, h } (0-1 of the picture, photo-verify's focus or
  // head box), or null. Arrays [x, y, w, h] are accepted.
  function focusBox(f) {
    if (!f) return null;
    const a = Array.isArray(f) ? { x: f[0], y: f[1], w: f[2], h: f[3] } : f;
    const n = v => Number(v);
    if (![a.x, a.y].every(v => Number.isFinite(n(v)))) return null;
    const w = Number.isFinite(n(a.w)) && n(a.w) > 0 ? n(a.w) : 0.3;
    const h = Number.isFinite(n(a.h)) && n(a.h) > 0 ? n(a.h) : 0.3;
    // A bare point (head centre) becomes a box round it.
    const x = Number.isFinite(n(a.w)) ? n(a.x) : n(a.x) - w / 2;
    const y = Number.isFinite(n(a.h)) ? n(a.y) : n(a.y) - h / 2;
    const c = v => Math.max(0, Math.min(1, v));
    const out = { x: c(x), y: c(y), w: Math.min(1 - c(x), w), h: Math.min(1 - c(y), h) };
    return out.w > 0.01 && out.h > 0.01 ? out : null;
  }
  const tagOf = t => { if (!t) return null; const o = typeof t === 'string' ? { text: t } : t; const text = str(o.text, 28); return text ? { text, tone: toneOf(o.tone, ['red', 'blue', 'ink'], 'red') } : null; };
  const tilesOf = (list, n) => (Array.isArray(list) ? list : []).slice(0, n).map((t, i) => {
    const o = t && typeof t === 'object' ? t : { value: t };
    const out = { value: str(o.value, 12), label: str(o.label, 28), tone: toneOf(o.tone, ['blue', 'ink'], i === 0 ? 'blue' : 'ink') };
    if (str(o.chip, 20)) out.chip = str(o.chip, 20);
    if (str(o.kicker, 16)) out.kicker = str(o.kicker, 16);
    return out;
  }).filter(t => t.value);
  const STREAK = { W: 'W', L: 'L', T: 'T', D: 'T' };
  function cleanV3(type, b, out) {
    const head = () => {
      if (str(b.title, 60)) out.title = str(b.title, 60);
      if (str(b.kicker, 28) && type !== 'rankTile') out.kicker = str(b.kicker, 28);
    };
    if (type === 'photoCard') {
      head();
      if (b.photo) out.photo = str(b.photo, 200);
      out.label = str(b.label, 28);
      const f = focusBox(b.focus);
      if (f) out.focus = f;
      out.scan = Boolean(b.scan);
      const tag = tagOf(b.tag);
      if (tag) out.tag = tag;
      out.tiles = tilesOf(b.tiles, 3);
    } else if (type === 'statTiles') {
      head();
      out.tiles = tilesOf(b.tiles, 3);
      const tag = tagOf(b.tag);
      if (tag) out.tag = tag;
    } else if (type === 'dotGrid') {
      head();
      out.total = Math.max(1, Math.min(LIMITS.dotsMax, Math.round(numOf(b.total)) || 1));
      let left = out.total;
      out.groups = (Array.isArray(b.groups) ? b.groups : []).slice(0, 3).map((g, i) => {
        const n = Math.max(0, Math.min(left, Math.round(numOf(g && g.n)) || 0));
        left -= n;
        return { n, tone: toneOf(g && g.tone, ['blue', 'ink', 'grey'], ['blue', 'ink', 'grey'][i]), label: str(g && g.label, 24) };
      }).filter(g => g.n > 0 || g.label);
    } else if (type === 'streak') {
      head();
      const raw = Array.isArray(b.items) ? b.items.map(x => (x && typeof x === 'object' ? x.r : x)) : String(b.items || '').split('');
      out.items = raw.map(x => STREAK[String(x || '').trim().toUpperCase()]).filter(Boolean).slice(0, 20);
      out.label = str(b.label, 20);
    } else if (type === 'rankTile') {
      head();
      if (str(b.label, 28)) out.label = str(b.label, 28);
      const list = Array.isArray(b.items) && b.items.length ? b.items : [b];
      out.items = list.slice(0, 2).map((it, i) => {
        const r = str(it && it.rank, 6).replace(/^#?/, '#');
        return { kicker: str(it && it.kicker, 16), rank: r === '#' ? '' : r, pos: str(it && it.pos, 20), chip: str(it && it.chip, 20), tone: toneOf(it && it.tone, ['ink', 'blue'], i === 0 ? 'ink' : 'ink') };
      }).filter(it => it.rank || it.pos);
      const tag = tagOf(b.tag);
      if (tag) out.tag = tag;
    } else if (type === 'tagPill') {
      head();
      out.text = str(b.text, 28);
      out.tone = toneOf(b.tone, ['red', 'blue', 'ink'], 'red');
      if (b.media) out.media = str(b.media, 200);
    } else if (type === 'clipLabel') {
      if (str(b.kicker, 28)) out.kicker = str(b.kicker, 28);
      out.text = str(b.text, 24);
      if (str(b.sub, 28)) out.sub = str(b.sub, 28);
      out.tone = toneOf(b.tone, ['blue', 'ink'], 'blue');
      const f = focusBox(b.focus);
      if (f) out.focus = f;
      if (b.media) out.media = str(b.media, 200);
    }
  }
  // A tile's on-screen value split for the count-up ("$692M" -> $ 692 M), or
  // null when it is not one number ("15-1", "#1 TE" stay as they are).
  function tileNumber(value) {
    const v = String(value || '').trim();
    const m = v.match(/^([$#]?)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(%|[KMB]|\+)?$/i);
    if (!m) return null;
    return { value: Number(m[2].replace(/,/g, '')), prefix: m[1], suffix: (m[3] || '').toUpperCase(), display: v };
  }

  // A beat's block: its own (an ES plan, or edited in Review), else made
  // from the beat's existing fields, so every plan (AI, draft, saved) draws
  // in the ES system without a rewrite.
  function blockOf(beat) {
    const b = beat || {};
    if (b.block && BLOCK_TYPES.includes(b.block.type)) return cleanBlock(b.block);
    const type = BLOCK_FOR_KIND[b.kind] || 'statement';
    const text = str(b.text, 120);
    if (type === 'hook') {
      const out = { type, pills: hookPills(text.replace(/[.!?]+$/, '')) };
      const em = str(b.emphasis, 20).split(' ')[0];
      if (em) out.stamp = { text: em };
      return out;
    }
    if (type === 'statement') {
      const src = b.kind === 'rank' && b.name ? `#${b.rank || ''} ${b.name}` : text;
      const lines = headlineLines(plainVo(src).replace(/[!?]+$/, ''), LIMITS.lineChars, LIMITS.lines);
      // v3: the blue word is the one chosen by meaning (the beat's highlight
      // word, or *word* in its text or voiceover), never forced onto the last line.
      const marks = marksIn(b.emphasis ? `*${b.emphasis}*` : '', src, b.vo);
      return { type, lines: markLines(lines, marks).map(t => ({ text: t, color: 'ink' })) };
    }
    if (type === 'number') {
      const raw = str(b.stat && b.stat.value, 16);
      const m = raw.match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
      return { type, value: m ? Number(m[2].replace(/,/g, '')) : 0, prefix: m ? m[1].trim().slice(0, 3) : '', suffix: m ? m[3].trim().slice(0, 4) : '', label: str(b.stat && b.stat.label, 40), kicker: text.length <= 28 ? text : words(text).slice(0, 4).join(' '), color: 'blue', ...(raw ? { display: raw } : {}) };
    }
    if (type === 'dots') {
      if (b.chips) return { type, count: Math.max(1, Math.round(numOf(b.chips.total)) || 1), highlight: Math.max(0, Math.round(numOf(b.chips.filled)) || 0), label: str(b.chips.label || text, 40), note: '' };
      const d = b.dotrank || {};
      return { type, count: Math.max(1, Math.round(numOf(d.total)) || 1), highlight: 1, label: text, note: str(d.label, 40) };
    }
    if (type === 'compare') {
      const list = b.bars || (b.versus || []).map(v => ({ label: v.name, value: v.value })) || [];
      const rows = (b.roles || []).map(r => ({ label: r.role, value: r.value }));
      const items = (list.length ? list : rows).slice(0, LIMITS.compareMax).map((x, i) => ({ label: str(x.label, 28), value: Math.abs(numOf(x.value)) || 0, display: str(x.value, 16), color: i === 0 ? 'blue' : 'ink' }));
      return { type, items, kicker: text.length <= 28 ? text : words(text).slice(0, 4).join(' ') };
    }
    if (type === 'quote') return { type, text: str(b.quote && b.quote.text, 200), who: str(b.quote && b.quote.by, 60) };
    return { type: 'endcard', cta: DEFAULT_CTA.slice() };
  }
  const takesMedia = beat => Boolean(BLOCKS[blockOf(beat).type].media);

  // How a number shows on screen ("$692M", "274,000").
  function numberDisplay(block, value = block.value) {
    const v = Number(value) || 0;
    const decimals = (String(block.value).split('.')[1] || '').length;
    const fixed = Math.abs(v).toFixed(Math.min(2, decimals));
    const [int, dec] = fixed.split('.');
    const grouped = int.length > 4 || (block.display && /,/.test(block.display)) ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int;
    return `${block.prefix || ''}${v < 0 ? '-' : ''}${grouped}${dec ? `.${dec}` : ''}${block.suffix || ''}`;
  }
  // The on-screen words of a block (lint, provenance, the legacy text field).
  function blockStrings(block) {
    const b = block || {};
    if (b.type === 'hook') return [...(b.pills || []).map(p => p.text), b.stamp ? b.stamp.text : ''].filter(Boolean);
    if (b.type === 'statement') return (b.lines || []).map(l => l.text);
    if (b.type === 'number') return [b.kicker, numberDisplay(b), b.label].filter(Boolean);
    if (b.type === 'dots') return [b.label, b.note].filter(Boolean);
    if (b.type === 'compare') return [b.kicker, ...(b.items || []).flatMap(it => [it.label, it.display])].filter(Boolean);
    if (b.type === 'quote') return [b.text, b.who].filter(Boolean);
    if (b.type === 'endcard') return (b.cta || []).filter(Boolean);
    const strip = list => list.filter(Boolean).map(t => plainVo(t));
    const tiles = list => (list || []).flatMap(t => [t.kicker, t.value, t.label, t.chip]);
    if (b.type === 'photoCard') return strip([b.kicker, b.title, b.label, b.tag && b.tag.text, ...tiles(b.tiles)]);
    if (b.type === 'statTiles') return strip([b.kicker, b.title, b.tag && b.tag.text, ...tiles(b.tiles)]);
    if (b.type === 'dotGrid') return strip([b.kicker, b.title, ...(b.groups || []).map(g => g.label)]);
    if (b.type === 'streak') return strip([b.kicker, b.title, b.label]);
    if (b.type === 'rankTile') return strip([b.label, b.title, b.tag && b.tag.text, ...(b.items || []).flatMap(it => [it.kicker, `${it.rank} ${it.pos}`.trim(), it.chip])]);
    if (b.type === 'tagPill') return strip([b.kicker, b.title, b.text]);
    if (b.type === 'clipLabel') return strip([b.kicker, b.text, b.sub]);
    return [];
  }
  const blockText = block => {
    const b = block || {};
    if (b.type === 'hook') return (b.pills || []).map(p => p.text).join(' ');
    if (b.type === 'statement') return (b.lines || []).map(l => l.text).join(' ');
    if (b.type === 'number') return b.kicker || b.label || numberDisplay(b);
    if (b.type === 'dots' || b.type === 'compare') return b.label || b.kicker || '';
    if (b.type === 'quote') return b.text;
    if (b.type === 'endcard') return (b.cta || []).join(' ');
    return plainVo(b.title || b.text || blockStrings(b)[0] || '');
  };
  // The legacy fields a block implies (kind, text, stat, bars, dotrank,
  // quote), so the rest of Reels Studio sees a normal beat.
  function legacyFields(block) {
    const b = cleanBlock(block);
    const out = { kind: KIND_FOR[b.type], text: blockText(b).slice(0, 90), block: b };
    if (b.type === 'number') out.stat = { value: b.display || numberDisplay(b), label: b.label };
    if (b.type === 'compare') out.bars = (b.items || []).map(it => ({ label: it.label, value: it.display || String(it.value) }));
    if (b.type === 'dots') out.dotrank = { total: String(b.count), rank: String(b.highlight), label: b.note };
    if (b.type === 'quote') out.quote = { text: b.text, by: b.who };
    if ((b.type === 'statTiles' || b.type === 'photoCard') && b.tiles && b.tiles[0]) out.stat = { value: b.tiles[0].value, label: b.tiles[0].label };
    if (b.type === 'dotGrid') out.dotrank = { total: String(b.total), rank: String((b.groups[0] || {}).n || 0), label: (b.groups[0] || {}).label || '' };
    if (b.type === 'rankTile' && b.items[0]) { out.rank = Number(String(b.items[0].rank).replace('#', '')) || 1; out.name = `${b.items[0].pos}`; }
    return out;
  }
  // Signal colours a block uses (green and red; yellow too, though only
  // captions should use it). The dots' highlight is green.
  function signalsIn(block, vo = '') {
    const b = block || {};
    const used = new Set();
    const add = c => { if (SIGNALS.includes(c)) used.add(c); };
    (b.pills || []).forEach(p => add(p.color));
    if (b.stamp) add('red');
    (b.lines || []).forEach(l => add(l.color));
    if (b.type === 'number') add(b.color);
    if (b.type === 'dots' && b.highlight > 0) add('green');
    if (b.type === 'compare') (b.items || []).forEach(it => add(it.color));
    if (b.type === 'streak' && (b.items || []).includes('W')) add('green');
    if (b.type === 'tagPill') add(b.tone);
    if (b.tag) add(b.tag.tone);
    if (parseEmphasis(vo).flags.some(Boolean)) add('yellow');
    return [...used];
  }

  // ─── Captions: *word* emphasis ─────────────────────────────────────────
  // "The Cubs lost. This bar got *paid.*" -> plain words + a flag per word.
  function parseEmphasis(vo) {
    const list = words(vo);
    let open = false;
    const flags = [];
    const plain = list.map(w => {
      const starts = /^[“"(]*\*/.test(w);
      const ends = /\*[.,!?;:”")]*$/.test(w);
      const on = open || starts;
      if (starts && !ends) open = true;
      if (ends) open = false;
      flags.push(on);
      return w.replace(/\*/g, '');
    }).map(w => w).filter((w, i) => { if (!w) flags[i] = null; return Boolean(w); });
    return { words: plain, flags: flags.filter(f => f !== null), text: plain.join(' ') };
  }
  const plainVo = vo => String(vo || '').replace(/\*/g, '');

  // ─── Script -> beats (the person's words, never rewritten) ─────────────
  const FILLER_START = /^(?:so|and|but|now|well|look|okay|ok|plus|also)[,]?\s+/i;
  const TRAIL_STOP = /\s+(?:the|a|an|on|in|of|to|as|at|for|and|but|with|by|their|his|her|its|our|your|is|are|was|were|that|this|so|very|just)$/i;
  function trimTrail(text) { let t = String(text || '').trim(); let prev; do { prev = t; t = t.replace(TRAIL_STOP, ''); } while (t !== prev); return t; }
  function headline(sentence, maxWords = 8) {
    const s = String(sentence || '').replace(/\*/g, '').replace(FILLER_START, '').replace(/[“”"]/g, '');
    const list = words(s).map(w => w.replace(/[,;:—–]+$/, ''));
    return trimTrail(list.slice(0, maxWords).join(' ').replace(/[.!?]+$/, ''));
  }
  // Lines for a statement (1-3, under 14 characters) from a headline; when
  // the words don't fit, the end is cut at a word that can close a line.
  function headlineLines(text, max, n) {
    let list = words(text);
    while (list.length > 1 && splitLines(list.join(' '), max).length > n) list = list.slice(0, -1);
    return splitLines(trimTrail(list.join(' ')) || list.join(' '), max);
  }
  // Pills for a hook: up to 3 at 14 characters; longer lines drop to size 110
  // (the kit's rule) and take about 18.
  function hookPills(text0) {
    const marks = marksIn(text0);
    const text = plainVo(text0);
    const at14 = splitLines(text, LIMITS.pillChars);
    const fit = at14.length <= LIMITS.pills ? { lines: at14, size: 0 } : { lines: headlineLines(text, 18, LIMITS.pills), size: 110 };
    // The pill holding the marked word is blue; with none marked, the last pill
    // (the kit's ink-then-blue stack).
    const hit = fit.lines.findIndex(t => words(t).some(w => marks.has(bareWord(w))));
    const blue = hit >= 0 ? hit : (fit.lines.length > 1 ? fit.lines.length - 1 : -1);
    return fit.lines.map((t, i) => ({ text: t, color: i === blue ? 'blue' : 'ink', ...(fit.size && t.length > LIMITS.pillChars ? { size: fit.size } : {}) }));
  }
  // Sentences, keeping every character: joined back with single spaces they
  // equal the script (whitespace normalised).
  function scriptSentences(script) {
    const text = String(script || '').replace(/\s+/g, ' ').trim();
    if (!text) return [];
    return text.split(/(?<=[.!?…]["”’)*]*)\s+(?=["“(*]?[A-Z0-9$])/).map(s => s.trim()).filter(Boolean);
  }
  // A long sentence splits at a comma, semicolon or dash near its middle.
  function splitLong(sentence, max = 22) {
    const list = words(sentence);
    if (list.length <= max) return [sentence];
    const mid = list.length / 2;
    let best = -1;
    list.forEach((w, i) => { if (i > 2 && i < list.length - 3 && /[,;:—–]$/.test(w) && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i; });
    if (best < 0) best = Math.floor(mid) - 1;
    return [list.slice(0, best + 1).join(' '), ...splitLong(list.slice(best + 1).join(' '), max)];
  }
  // The words that follow a number, up to the next comma (stop words dropped).
  const STOP = new Set(['the', 'a', 'an', 'on', 'in', 'of', 'to', 'as', 'at', 'for', 'and', 'but', 'with', 'by', 'was', 'were', 'is', 'are']);
  function labelAfter(text, from, n) {
    const rest = text.slice(from).split(/[,;:.!?—–(]|\s(?:compared|while|than|vs\.?|versus|and)\s/i)[0];
    return words(rest).map(w => w.replace(/[^\w'’-]/g, '')).filter(w => w && !STOP.has(w.toLowerCase())).slice(0, n).join(' ');
  }
  const NUM_TOKEN = /(\$?)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(%|[KMB]\b|\s?(?:million|billion|thousand)\b)?/gi;
  // Block for one beat of script (code only, free). The person can change
  // the block and its words in Review.
  function blockForLine(line, { first = false } = {}) {
    const plain = line.replace(/\*/g, '');
    const quoted = plain.match(/[“"]([^”"]{4,})[”"]/);
    if (!first && quoted && quoted[1].length <= LIMITS.quoteChars) {
      const who = (plain.match(/([A-Z][a-z'’.-]+(?:\s+[A-Z][a-z'’.-]+){0,2})\s+(?:said|says|told|added|admitted)\b/) || plain.match(/\b(?:said|says)\s+([A-Z][a-z'’.-]+(?:\s+[A-Z][a-z'’.-]+){0,2})/) || [])[1] || '';
      return { type: 'quote', text: quoted[1].trim().replace(/[,;:]$/, ''), who: who.toUpperCase() };
    }
    if (first) return { type: 'hook', pills: hookPills(headline(quoted ? quoted[1] : plain, 8)) };
    const scale = plain.match(/\b(\d{1,3}(?:,\d{3})*|\d+)\s+(?:in|out of)\s+(?:every\s+)?(\d{1,3}(?:,\d{3})+|\d+)\b/i);
    if (scale) {
      const hi = Number(scale[1].replace(/,/g, ''));
      const count = Number(scale[2].replace(/,/g, ''));
      const after = labelAfter(plain, scale.index + scale[0].length, 4);
      const before = headline(plain.slice(0, scale.index).replace(/\b(?:says?|said|reports?|shows?|found)\s*$/i, ''), 4);
      if (count >= 2 && count <= LIMITS.dotsMax && hi <= count) return { type: 'dots', count, highlight: hi, label: words(before).length >= 2 ? before : after, note: `${scale[1]} IN ${scale[2]}` };
    }
    const nums = [...plain.matchAll(NUM_TOKEN)].filter(m => !/^(?:19|20)\d\d$/.test(m[2]) || m[1] || m[3]);
    const compareWord = /\b(?:vs\.?|versus|compared (?:to|with)|than|while|against)\b/i.test(plain);
    if (nums.length >= 2 && compareWord) {
      const items = nums.slice(0, LIMITS.compareMax).map((m, i) => {
        const label = labelAfter(plain, m.index + m[0].length, 2) || `ITEM ${i + 1}`;
        return { label, value: Number(m[2].replace(/,/g, '')), display: `${m[1]}${m[2]}${(m[3] || '').trim()}`, color: i === 0 ? 'blue' : 'ink' };
      });
      const before = headline(plain.slice(0, nums[0].index), 4);
      return { type: 'compare', items, kicker: words(before).length >= 2 ? before : '' };
    }
    const big = nums.find(m => m[1] || m[3] || m[2].replace(/[,.]/g, '').length >= 2);
    if (big) {
      const unit = (big[3] || '').trim();
      const kicker = headline(plain.slice(0, big.index), 4);
      return { type: 'number', value: Number(big[2].replace(/,/g, '')), prefix: big[1], suffix: unit.length <= 2 ? unit.toUpperCase() : '', label: labelAfter(plain, big.index + big[0].length, 3), kicker: words(kicker).length >= 2 ? kicker : '', color: 'blue', display: `${big[1]}${big[2]}${unit.length <= 2 ? unit.toUpperCase() : ''}` };
    }
    const lines = headlineLines(headline(plain, 8), LIMITS.lineChars, LIMITS.lines);
    return { type: 'statement', lines: markLines(lines, marksIn(line)).map(t => ({ text: t, color: 'ink' })) };
  }
  // The words a text marks with *asterisks* (lower case, bare).
  const bareWord = w => String(w || '').toLowerCase().replace(/[^a-z0-9%$#'’.-]/g, '').replace(/[.]+$/, '');
  function marksIn(...texts) {
    const out = new Set();
    texts.forEach(t => { const e = parseEmphasis(t); e.words.forEach((w, i) => { if (e.flags[i] && bareWord(w)) out.add(bareWord(w)); }); });
    return out;
  }
  // Lines with the marked words wrapped in *asterisks* (the layout draws them blue).
  function markLines(lines, marks) {
    if (!marks || !marks.size) return lines.slice();
    return lines.map(l => words(l).map(w => (marks.has(bareWord(w)) ? `*${w}*` : w)).join(' '));
  }
  // opts: { title, sport, voLengthSec, sourceLine, format }
  function scriptToPlan(script, opts = {}) {
    const sentences = scriptSentences(script).flatMap(s => splitLong(s));
    // Very short sentences ride with the next one (one idea, 2-5 s a beat).
    const lines = [];
    sentences.forEach(s => {
      const last = lines[lines.length - 1];
      if (last && words(last).length < 4 && words(last).length + words(s).length <= 22) lines[lines.length - 1] = `${last} ${s}`;
      else lines.push(s);
    });
    const beats = lines.map((line, i) => {
      const block = cleanBlock(blockForLine(line, { first: i === 0 }));
      return { id: `b${i + 1}`, ...legacyFields(block), vo: line, emphasis: '', photo: '' };
    });
    beats.push({ id: `b${beats.length + 1}`, ...legacyFields({ type: 'endcard', cta: DEFAULT_CTA.slice() }), vo: '', emphasis: '', photo: '' });
    const plan = {
      format: opts.format || 'explainer', title: str(opts.title, 120) || headline(lines[0] || '', 10), sport: opts.sport || '', team: null,
      angle: '', source: 'script', beats, style: 'es', script: { text: String(script || '').replace(/\s+/g, ' ').trim(), locked: true },
      sourceLine: str(opts.sourceLine, 120),
    };
    const sec = Number(opts.voLengthSec);
    if (sec > 0) plan.voLengthMs = Math.round(sec * 1000);
    return plan;
  }
  // True when the beats still read the script word for word (in order).
  function voMatchesScript(plan) {
    const want = plan && plan.script && plan.script.text;
    if (!want) return true;
    const got = (plan.beats || []).map(b => String(b.vo || '').trim()).filter(Boolean).join(' ');
    return got.replace(/\s+/g, ' ') === want.replace(/\s+/g, ' ');
  }

  // ─── Layout: ops with boxes ─────────────────────────────────────────────
  // op: { type: 'text', role, text, font, size, x, y (baseline), w, color,
  //       fill? (a boxed word), enter: 'left' | 'up' | 'none', delay, rot? }
  //     { type: 'rect' | 'panel' | 'dots' | 'bar' | 'media' | 'quote-mark' | 'mark' | 'logotype' }
  const tracked = (measure, text, size) => measure(text, displayFont(size)) + TYPE.tracking * size * Math.max(0, text.length - 1);
  // The hug box of a boxed word: cap-height to baseline, 0.16em all round.
  function hugBox(x, y, w, size) {
    const pad = TYPE.pad * size;
    return { x: x - pad, y: y - TYPE.cap * size - pad, w: w + 2 * pad, h: TYPE.cap * size + 2 * pad };
  }
  // The text colour (a name) for a boxed word's fill, in the look.
  const inkOn = (name, theme) => (name === 'grey' ? 'ink' : TH.inkOn(name, theme ? theme.colors : null));
  // A word whose colour would not read on the scene's ground (a red line on
  // ES blue) sits on the surface's plate: an ink hug box, kept in the column.
  function plateOps(ops, S, theme, geo) {
    if (!S.plate) return;
    const ground = theme.hex(S.ground);
    ops.forEach(op => {
      if ((op.type !== 'text' && op.type !== 'count') || op.fill || op.noCheck || op.small || op.onPanel || op.on) return;
      if (TH.contrast(theme.hex(op.color), ground) >= TH.ACCENT_MIN) return;
      // The plate is the ES pill round the word; too wide for the column, the
      // word moves down one step of the type scale (never an in-between size).
      let need = op.w + pillPad(op.size);
      while (need > geo.col.w && snapStep(op.size / geo.type - 1) < op.size / geo.type) {
        const next = snapStep(op.size / geo.type - 1) * geo.type;
        const k = next / op.size;
        op.size = next; op.w *= k; op.track = TYPE.tracking * op.size; op.font = displayFont(op.size);
        need = op.w + pillPad(op.size);
      }
      const pm = pillMetricsAt(op.size);
      op.fill = S.plate;
      op.plated = true;
      op.x = Math.max(op.x, geo.col.x + pm.padLeft);
      op.box = { x: op.x - pm.padLeft, y: op.y - pm.baseline, w: need, h: pm.h };
      op.pill = true;
    });
  }
  const opBox = op => (op.box ? { ...op.box } : op.fill ? hugBox(op.x, op.y, op.w, op.size) : { x: op.x, y: op.y - TYPE.cap * op.size, w: op.w, h: TYPE.cap * op.size });
  // The ES mark: on the hook, the end card and whatever scene opens the reel.
  function showsMark(graphic) {
    const g = graphic || {};
    const type = (g.data && g.data.block && g.data.block.type) || '';
    return MARK_BLOCKS.has(type) || g.inMs === 0;
  }

  // ─── v3 layout helpers ─────────────────────────────────────────────────
  // Word tokens with their *emphasis* flag, upper-cased.
  function emTokens(text) {
    const e = parseEmphasis(text);
    return e.words.map((w, i) => ({ w: w.toUpperCase(), em: Boolean(e.flags[i]) }));
  }
  const tokText = toks => toks.map(t => t.w).join(' ');
  // Greedy wrap of tokens at a measured width.
  function wrapTokens(measure, toks, size, width) {
    const out = [];
    let line = [];
    toks.forEach(t => {
      const next = line.concat(t);
      if (line.length && tracked(measure, tokText(next), size) > width) { out.push(line); line = [t]; } else line = next;
    });
    if (line.length) out.push(line);
    return out;
  }
  // Drop words from the end (and a dangling stop word) until the line fits.
  function cutToFit(measure, toks, size, width, extra = 0) {
    let list = toks.slice();
    while (list.length > 1 && tracked(measure, tokText(list), size) + extra > width) list = list.slice(0, -1);
    while (list.length > 1 && TRAIL_STOP.test(` ${list[list.length - 1].w.toLowerCase()}`)) list = list.slice(0, -1);
    return list;
  }
  // One line of tokens as text ops: a run of emphasised words is its own op in
  // the emphasis colour, on the same baseline.
  function lineOps(measure, toks, x, y, size, color, emColor, extra = {}) {
    const ops = [];
    const font = displayFont(size);
    const space = measure(' ', font) + TYPE.tracking * size;
    let cx = x;
    let i = 0;
    while (i < toks.length) {
      let j = i;
      while (j + 1 < toks.length && toks[j + 1].em === toks[i].em) j += 1;
      const text = tokText(toks.slice(i, j + 1));
      const w = tracked(measure, text, size);
      // Alignment marks belong to the line's first run only.
      const own = ops.length ? { ...extra, align: '', slot: undefined } : extra;
      ops.push({ type: 'text', text, font, size, x: cx, y, w, color: toks[i].em ? emColor : color, track: TYPE.tracking * size, ...own });
      cx += w + space;
      i = j + 1;
    }
    return ops;
  }
  // A pill: the FrameUp ES pill (pillMetrics) round upper-case display type.
  // op.box is the pill; op.x / op.y are the text's start and baseline.
  function pillOp(measure, text, x, top, size, fill, extra = {}, theme = null) {
    const t = String(text).toUpperCase();
    const pm = pillMetricsAt(size);
    const w = tracked(measure, t, size);
    return { type: 'text', text: t, font: displayFont(size), size, x: x + pm.padLeft, y: top + pm.baseline, w, color: inkOn(fill, theme), fill, track: TYPE.tracking * size, box: { x, y: top, w: pm.padLeft + w + pm.padRight, h: pm.h }, pill: true, ...extra };
  }

  // v3 vertical balance: a scene with no picture and nothing in the lower
  // slot is one group, centred on the word zone's optical centre (y 880),
  // never above the headline slot and always 64 px clear of the caption bar.
  // Moves are 8-pt steps. A statement placed by hand (block.top) stays put.
  const CENTRED = new Set(['hook', 'statement', 'number', 'quote', 'statTiles', 'rankTile', 'streak', 'tagPill', 'photoCard', 'compare', 'dots']);
  function opTop(o) { return o.box ? o.box.y : (o.type === 'text' || o.type === 'count') ? o.y - TYPE.cap * o.size : o.y; }
  function opBottom(o) { return o.box ? o.box.y + o.box.h : (o.type === 'text' || o.type === 'count') ? o.y : o.y + (o.h || 0); }
  function centreGroup(ops, block, geo) {
    if (!CENTRED.has(block.type) || block.top != null) return;
    if (ops.some(o => o.type === 'media' || o.slot === 'lower' || (o.type === 'tile' && o.y >= geo.slots.lower - 0.5))) return;
    const group = ops.filter(o => o.type !== 'rect' && o.type !== 'logotype' && o.y != null);
    if (!group.length) return;
    const top = Math.min(...group.map(opTop));
    const bottom = Math.max(...group.map(opBottom));
    const h = bottom - top;
    const zoneTop = geo.slots.head;
    const zoneBottom = geo.contentBottom;
    if (h >= zoneBottom - zoneTop) return;
    const want = Math.max(zoneTop, Math.min(geo.slots.centre - h / 2, zoneBottom - h));
    const dy = Math.floor((want - top) / geo.unit) * geo.unit;
    if (dy <= 0) return;
    group.forEach(o => {
      o.y += dy;
      if (o.box) o.box = { ...o.box, y: o.box.y + dy };
      if (o.slot) { delete o.slot; o.centred = true; }
    });
  }
  function layoutBlock(measure, graphic, timeline = {}) {
    const geo = geometry(timeline.size);
    const block = (graphic.data && graphic.data.block) || blockOf(graphic.data || {});
    const theme = themeOf(timeline);
    const S = theme.surfaceFor(block.type); // the scene's surface (ground + how colour names land on it)
    const LY = theme.layout;
    const tx = name => S.text[name] || name; // a text colour name on this surface
    const fl = name => S.fill[name] || name; // a boxed word's fill on this surface
    const T = geo.type;
    const X = geo.col.x;
    const CW = geo.col.w;
    const K = geo.k;
    const st = theme.motion.staggerMs;
    const ops = [];
    const m = (t, f) => measure(String(t), f);
    const sz = name => TYPE_SCALE[name] * T;
    const sp = v => v * T; // an 8-pt gap at this frame's type factor
    const markHere = showsMark(graphic);
    // The widest a top-row part can be beside the ES mark (and its clear space).
    const besideMark = top => (markHere && top < geo.mark.y + geo.mark.size + geo.mark.clear ? geo.mark.x - geo.mark.clear - X : CW);
    const pill = (text, x, top, size, fill, extra) => pillOp(m, text, x, top, size, fl(fill), extra, theme);
    // A pill row with *emphasis*: only the marked words turn blue. The row is
    // split at them into pills that touch (ink | blue | ink), never one pill
    // all blue. Alignment marks stay on the row's first pill.
    const pillRow = (toks, x, top, size, fill, extra = {}) => {
      if (!toks.some(t => t.em) || toks.every(t => t.em)) return [pill(tokText(toks), x, top, size, toks.length && toks.every(t => t.em) ? (fill === 'blue' ? 'ink' : 'blue') : fill, extra)];
      const out = [];
      let cx = x;
      let i = 0;
      while (i < toks.length) {
        let j = i;
        while (j + 1 < toks.length && toks[j + 1].em === toks[i].em) j += 1;
        const f = toks[i].em ? (fill === 'blue' ? 'ink' : 'blue') : fill;
        const op = pill(tokText(toks.slice(i, j + 1)), cx, top, size, f, out.length ? { ...extra, align: 'row', slot: undefined, delay: (extra.delay || 0) + 60 * out.length } : extra);
        out.push(op);
        cx = op.box.x + op.box.w;
        i = j + 1;
      }
      return out;
    };
    // Where the face is in a full-frame picture (frame px, top and bottom),
    // from the block's focus box or the picture's verified head / focus box.
    // Pictures fill the 9:16 frame by height, so a box's y maps straight across.
    const faceBand = () => {
      const shot = ((timeline.tracks && timeline.tracks.video) || []).find(v => v.beat === graphic.beat && v.asset);
      const asset = shot && timeline.assets ? timeline.assets[shot.asset] : null;
      let f = focusBox(block.focus);
      if (!f && asset) {
        const hd = Array.isArray(asset.head) ? { x: asset.head[0], y: asset.head[1] } : asset.head;
        if (hd && Number.isFinite(Number(hd.y))) f = { x: Number(hd.x) - 0.1, y: Number(hd.y) - 0.07, w: 0.2, h: 0.14 };
        else f = focusBox(asset.focus);
      }
      if (!f) return null;
      const h = Math.min(f.h, 0.24);
      return { top: f.y * geo.h, bottom: (f.y + h) * geo.h };
    };
    // Words over a full-frame picture never cover the face: the group stays at
    // its slot when the face is clear of it, else moves below the face, else
    // above it, else to the lower slot (8-pt steps).
    const clearFace = group => {
      const band = faceBand();
      if (!band || !group.length) return;
      const top = Math.min(...group.map(opTop));
      const bottom = Math.max(...group.map(opBottom));
      const h = bottom - top;
      const gap = sp(SPACE.xxl);
      if (bottom <= band.top - gap || top >= band.bottom + gap) return;
      const snap = v => Math.ceil(v / geo.unit) * geo.unit;
      const options = [snap(band.bottom + gap), Math.floor((band.top - gap - h) / geo.unit) * geo.unit, geo.slots.lower];
      const to = options.find((t, i) => (i === 0 ? t + h <= geo.contentBottom : i === 1 ? t >= geo.slots.head : t + h <= geo.safe.bottom));
      if (to == null) return;
      const dy = to - top;
      group.forEach(o => { o.y += dy; if (o.box) o.box = { ...o.box, y: o.box.y + dy }; if (o.slot) { delete o.slot; o.clearsFace = true; } });
    };
    // A pill whose words fit `width`: the size steps down (never in between),
    // and at the smallest step the words are cut at a word (flagged).
    const fitPill = (text, x, top, maxStep, minStep, fill, width, extra = {}) => {
      const toks = emTokens(text);
      const ok = s => tracked(m, tokText(toks), s) + pillPad(s) <= width + 0.01;
      const pk = pickStep(maxStep, minStep, T, ok);
      const list = pk.fits ? toks : cutToFit(m, toks, pk.size, width, pillPad(pk.size));
      const op = pill(tokText(list), x, top, pk.size, fill, { pillSize: pillClass(pk.size, T), ...extra });
      if (!pk.fits) op.shortened = true;
      return op;
    };
    const pillStep = size => pillMetricsAt(size).step;
    // A photo under the words: the whole frame, or the part below them.
    const mediaFull = () => ({ type: 'media', role: 'media', x: 0, y: 0, w: geo.w, h: geo.h });
    const mediaBelow = bottom => {
      const y0 = Math.max(bottom + 64 * K, 720 * K);
      return geo.h - y0 > 360 * K ? { type: 'media', role: 'media', x: 0, y: Math.round(y0), w: geo.w, h: geo.h - Math.round(y0) } : null;
    };
    // The kicker pill (series / label), level with the top of the ES mark.
    const kickerOp = (text, fill = 'ink') => {
      if (!text) return null;
      const top = geo.slots.kicker;
      const op = fitPill(text, X, top, PILL_SIZES.S, PILL_SIZES.S, fill, besideMark(top), { role: 'kicker', enter: 'left', delay: 0, align: 'col', slot: 'kicker' });
      ops.push(op);
      return op;
    };
    // A headline with *emphasis* (blue), wrapped on the column: the biggest
    // step from maxStep that fits in maxLines, else the smallest, cut at a word.
    const titleOps = (text, top, { maxStep = 'h1', minStep = 'h2', maxLines = 2, color = 'ink', em = 'blue', role = 'title', delay = 0, width = CW } = {}) => {
      const toks = emTokens(text);
      if (!toks.length) return { bottom: top, lines: 0 };
      let lines = null;
      const pk = pickStep(maxStep, minStep, T, s => { const l = wrapTokens(m, toks, s, width); if (l.length <= maxLines && l.every(x => tracked(m, tokText(x), s) <= width + 0.01)) { lines = l; return true; } return false; });
      let shortened = false;
      if (!pk.fits) {
        lines = wrapTokens(m, toks, pk.size, width).slice(0, maxLines).map(l => cutToFit(m, l, pk.size, width));
        shortened = true;
      }
      const size = pk.size;
      let y = top + TYPE.cap * size;
      lines.forEach((l, i) => {
        lineOps(m, l, X, y, size, tx(color), tx(em), { role, enter: 'up', delay: delay + i * st, align: i === 0 ? 'col' : '', ...(i === 0 ? { slot: 'head' } : {}), ...(shortened ? { shortened: true } : {}) }).forEach(o => ops.push(o));
        y += TYPE.lineHeight * size;
      });
      return { bottom: y - TYPE.lineHeight * size, lines: lines.length, size };
    };
    // Up to n pills in priority order (element limit: two pills a frame).
    let pillsLeft = ELEMENT_LIMITS.pills;
    const allow = () => { if (pillsLeft <= 0) return false; pillsLeft -= 1; return true; };

    // Tiles: one component for stat and rank tiles. Flat fill, radius 0, the
    // same padding, one value step for every tile in the row.
    const tilesOps = (tiles, top, { maxValue = 'stat', delay0 = st } = {}) => {
      const n = tiles.length;
      if (!n) return top;
      const gap = sp(SPACE.m);
      let tw = (CW - gap * (n - 1)) / n;
      const pad = sp(TILE_INSET);
      let inner = tw - 2 * pad;
      const values = tiles.map(t => String(t.value).toUpperCase());
      const vk = pickStep(n === 1 ? 'statXL' : maxValue, 'h2', T, s => values.every(v => tracked(m, v, s) <= inner + 0.01));
      const labels = tiles.map(t => String(t.label || '').toUpperCase());
      const lk = pickStep(n === 1 ? 'h2' : 'caption', 'label', T, s => labels.every(v => tracked(m, v, s) <= inner + 0.01));
      const kickers = tiles.map(t => String(t.kicker || '').toUpperCase());
      const hasK = kickers.some(Boolean);
      const hasL = labels.some(Boolean);
      const hasChip = tiles.some(t => t.chip);
      const ks = sz('label');
      const cs = sz(PILL_SIZES.S);
      const chipH = pillMetricsAt(cs).h;
      const vs = vk.size;
      const ls = lk.size;
      // One tile hugs its words (at least half the column), never a full-width slab.
      if (n === 1) {
        const need = Math.max(tracked(m, values[0], vs), labels[0] ? tracked(m, labels[0], ls) : 0, kickers[0] ? tracked(m, kickers[0], ks) : 0, tiles[0].chip ? tracked(m, String(tiles[0].chip).toUpperCase(), cs) + pillPad(cs) : 0);
        tw = Math.min(CW, Math.max(CW / 2, Math.ceil((need + 2 * pad) / 8) * 8));
        inner = tw - 2 * pad;
      }
      const h = pad + (hasK ? TYPE.cap * ks + sp(SPACE.m) : 0) + TYPE.cap * vs + (hasL ? sp(SPACE.m) + TYPE.cap * ls : 0) + (hasChip ? sp(SPACE.m) + chipH : 0) + pad;
      tiles.forEach((t, i) => {
        const x = X + i * (tw + gap);
        const fill = fl(t.tone === 'blue' ? 'blue' : 'ink');
        const on = inkOn(fill, theme);
        const d = delay0 + i * st;
        ops.push({ type: 'tile', role: 'tile', x, y: top, w: tw, h, fill, enter: 'up', delay: d, align: i === 0 ? 'col' : 'row' });
        let y = top + pad;
        if (hasK && kickers[i]) {
          const kt = kickers[i];
          ops.push({ type: 'text', role: 'tile-kicker', text: kt, font: displayFont(ks), size: ks, x: x + pad, y: y + TYPE.cap * ks, w: tracked(m, kt, ks), color: on, on: fill, alpha: 0.78, track: TYPE.tracking * ks, enter: 'up', delay: d + 60 });
        }
        if (hasK) y += TYPE.cap * ks + sp(SPACE.m);
        const v = values[i];
        const num = tileNumber(t.value);
        const vop = { type: num ? 'count' : 'text', role: 'tile-value', text: v, font: displayFont(vs), size: vs, x: x + pad, y: y + TYPE.cap * vs, w: tracked(m, v, vs), color: on, on: fill, track: TYPE.tracking * vs, enter: 'up', delay: d + 60 };
        if (num) vop.block = { value: num.value, prefix: num.prefix, suffix: num.suffix, display: num.display };
        if (!vk.fits) vop.shortened = true;
        ops.push(vop);
        y += TYPE.cap * vs;
        if (hasL && labels[i]) {
          const lt = labels[i];
          ops.push({ type: 'text', role: 'tile-label', text: lt, font: displayFont(ls), size: ls, x: x + pad, y: y + sp(SPACE.m) + TYPE.cap * ls, w: tracked(m, lt, ls), color: on, on: fill, track: TYPE.tracking * ls, enter: 'up', delay: d + 120, ...(lk.fits ? {} : { shortened: true }) });
        }
        if (hasL) y += sp(SPACE.m) + TYPE.cap * ls;
        if (t.chip) ops.push(pillOp(m, t.chip, x + pad, y + sp(SPACE.m), cs, fill === fl('blue') ? fl('ink') : fl('blue'), { role: 'chip', pillSize: 'S', enter: 'left', delay: d + 240, inTile: true }, theme));
      });
      return top + h;
    };

    if (block.type === 'hook') {
      const full = LY.media.hook === 'full';
      if (graphic.media && full) ops.push(mediaFull());
      if (block.kicker) kickerOp(block.kicker);
      let top = geo.slots.head;
      let bottom = top;
      const list = block.pills || [];
      // One step for the whole stack (the biggest the longest pill allows),
      // and the stack ends 110 px above the caption line.
      const texts = list.map(p => String(plainVo(p.text)).toUpperCase());
      const maxStep = LY.pillStep || PILL_SIZES.L;
      const room = geo.captionY - 110 * K - top;
      const pk = pickStep(maxStep, PILL_SIZES.M, T, s => texts.every(t => tracked(m, t, s) + pillPad(s) <= CW + 0.01) && (list.length - 1) * pillStep(s) + pillMetricsAt(s).h <= room);
      list.forEach((p, i) => {
        const text = texts[i];
        if (LY.pillBoxed) {
          const toks = emTokens(text);
          const fitToks = pk.fits ? toks : cutToFit(m, toks, pk.size, CW, pillPad(pk.size));
          const marked = emTokens(String(p.text).toUpperCase());
          const rowToks = marked.length === fitToks.length ? marked : fitToks;
          const color = p.color || 'ink';
          const row = pillRow(rowToks, X, top, pk.size, color, { role: 'pill', pillSize: pillClass(pk.size, T), enter: 'left', delay: i * st, align: 'col', ...(i === 0 ? { slot: 'head' } : {}), ...(pk.fits ? {} : { shortened: true }) });
          row.forEach(o => ops.push(o));
          bottom = top + row[0].box.h;
          top += pillStep(pk.size);
        } else {
          // Plain pills (Minimal): the same words as display type, no box.
          const c = p.color === 'yellow' || p.color === 'white' ? 'ink' : (p.color || 'ink');
          ops.push({ type: 'text', role: 'pill', text, font: displayFont(pk.size), size: pk.size, x: X, y: top + TYPE.cap * pk.size, w: tracked(m, text, pk.size), color: tx(c), track: TYPE.tracking * pk.size, enter: 'left', delay: i * st, align: 'col', ...(i === 0 ? { slot: 'head' } : {}) });
          bottom = top + TYPE.cap * pk.size;
          top += TYPE.lineHeight * pk.size + sp(SPACE.s);
        }
      });
      if (graphic.media && !full) { const md = mediaBelow(bottom); if (md) ops.unshift(md); }
      if (block.stamp && block.stamp.text) {
        // The stamp: one word, Display step, a red pill tilted -9°.
        const size = sz('display');
        const text = block.stamp.text.toUpperCase();
        const below = bottom + sp(SPACE.xxl);
        const sy = block.stamp.y != null ? block.stamp.y * K : Math.max(below, Math.min(860 * K, geo.captionY - 84 * K - pillMetricsAt(size).h * 1.2));
        const sx = block.stamp.x != null ? block.stamp.x : 300;
        const op = pill(text, sx, sy, size, 'red', { role: 'stamp', pillSize: 'XL', enter: 'stamp', at: graphic.stampAt != null ? graphic.stampAt : 1200, rot: MOTION.stampRotDeg });
        // Keep the tilted stamp inside the column.
        const b = rotatedBox(op);
        const shift = Math.min(0, geo.col.x + geo.col.w - (b.x + b.w)) + Math.max(0, geo.col.x - b.x);
        op.x += shift;
        op.box.x += shift;
        ops.push(op);
      }
      if (graphic.media && full) clearFace(ops.filter(o => o.role === 'pill' || o.role === 'stamp'));
    } else if (block.type === 'statement') {
      const lines = (block.lines || []).map(l => ({ ...l, toks: emTokens(l.text) }));
      const lineColor = l => (l.color === 'yellow' || l.color === 'white' ? 'ink' : l.color);
      const top0 = block.top != null ? block.top * K : geo.slots.head;
      let bottom;
      const maxStep = LY.statementStep || 'h1';
      if (LY.statementBoxed) {
        // Boxed lines (Game Tape, Photo-led, Hype Cut): every line a pill; a
        // line holding the *emphasis* word is the blue pill.
        const pk = pickStep(maxStep, 'h2', T, s => lines.every(l => tracked(m, tokText(l.toks), s) + pillPad(s) <= CW + 0.01));
        const stack = lines.length ? (lines.length - 1) * pillStep(pk.size) + pillMetricsAt(pk.size).h : 0;
        // Over a full-frame picture the lines sit low, just above the caption
        // line, so the face stays clear (faces are framed on the upper third).
        let top = graphic.media && LY.media.statement === 'full' && block.top == null ? Math.max(top0, geo.contentBottom - 40 * K - stack) : top0;
        lines.forEach((l, i) => {
          const toks = pk.fits ? l.toks : cutToFit(m, l.toks, pk.size, CW, pillPad(pk.size));
          const fill = lineColor(l) || 'ink';
          pillRow(toks, X, top, pk.size, fill, { role: 'line', pillSize: pillClass(pk.size, T), enter: theme.motion.id === 'punchy' ? 'left' : 'up', delay: i * st, align: 'col', ...(i === 0 && block.top == null && top === top0 ? { slot: 'head' } : {}), ...(pk.fits ? {} : { shortened: true }) }).forEach(o => ops.push(o));
          top += pillStep(pk.size);
        });
        bottom = top - pillStep(pk.size) + pillMetricsAt(pk.size).h;
        if (graphic.media && LY.media.statement === 'full' && block.top == null) clearFace(ops.filter(o => o.role === 'line'));
      } else {
        const pk = pickStep(maxStep, 'h2', T, s => lines.every(l => tracked(m, tokText(l.toks), s) <= CW + 0.01));
        const size = pk.size;
        let y = top0 + TYPE.cap * size;
        // A line that will sit on a plate (plateOps) gets the plate's padding
        // above and below, so it never covers its neighbours.
        const plated = l => Boolean(S.plate) && TH.contrast(theme.hex(tx(lineColor(l))), theme.hex(S.ground)) < TH.ACCENT_MIN;
        lines.forEach((l, i) => {
          const gap = plated(l) ? TYPE.pad * size * 1.25 : 0;
          if (i > 0) y += gap;
          const toks = pk.fits ? l.toks : cutToFit(m, l.toks, size, CW);
          lineOps(m, toks, X, y, size, tx(lineColor(l)), tx('blue'), { role: 'line', enter: 'up', delay: i * st, align: 'col', ...(i === 0 && block.top == null ? { slot: 'head' } : {}), ...(pk.fits ? {} : { shortened: true }) }).forEach(o => ops.push(o));
          y += TYPE.lineHeight * size + gap;
        });
        bottom = y - TYPE.lineHeight * size;
      }
      if (graphic.media) {
        const md = LY.media.statement === 'full' && LY.statementBoxed ? mediaFull() : mediaBelow(bottom);
        if (md) ops.unshift(md);
      }
    } else if (block.type === 'number') {
      let top = geo.slots.head;
      if (block.kicker) {
        if (LY.kickerBoxed) {
          const op = fitPill(block.kicker, X, top, PILL_SIZES.M, PILL_SIZES.S, LY.kickerFill, CW, { role: 'kicker', enter: 'left', delay: 0, align: 'col', slot: 'head' });
          ops.push(op);
          top += op.box.h + sp(SPACE.xl);
        } else {
          const kt = block.kicker.toUpperCase();
          const ks = sz('caption');
          ops.push({ type: 'text', role: 'kicker', text: kt, font: displayFont(ks), size: ks, x: X, y: top + TYPE.cap * ks, w: tracked(m, kt, ks), color: tx('ink'), track: TYPE.tracking * ks, enter: 'left', delay: 0, align: 'col', slot: 'head' });
          top += ks * TYPE.cap + sp(SPACE.xxl);
        }
      }
      const full = numberDisplay(block);
      const pk = pickStep(LY.numberStep || 'statXL', 'h1', T, s => tracked(m, full, s) <= CW + 0.01);
      const size = pk.size;
      const y = top + TYPE.cap * size;
      ops.push({ type: 'count', role: 'number', text: full, block, font: displayFont(size), size, x: X, y, w: tracked(m, full, size), color: tx(block.color || 'blue'), track: TYPE.tracking * size, enter: 'up', delay: st, align: 'col', ...(block.kicker ? {} : { slot: 'head' }) });
      if (block.label) {
        const toks = emTokens(block.label);
        const lk = pickStep('h2', 'caption', T, s => tracked(m, tokText(toks), s) <= CW + 0.01);
        const list = lk.fits ? toks : cutToFit(m, toks, lk.size, CW);
        lineOps(m, list, X, y + sp(SPACE.l) + TYPE.cap * lk.size, lk.size, tx('ink'), tx('blue'), { role: 'label', enter: 'up', delay: 2 * st, align: 'col', ...(lk.fits ? {} : { shortened: true }) }).forEach(o => ops.push(o));
      }
    } else if (block.type === 'dots') {
      let top = geo.slots.head;
      if (block.label) {
        const t = titleOps(block.label, top, { maxStep: 'h2', minStep: 'caption', maxLines: 2, role: 'label' });
        top = t.bottom + sp(SPACE.gap);
      }
      const n = Math.max(1, Math.min(LIMITS.dotsMax, block.count));
      const hi = Math.min(n, block.highlight || 0);
      const ns = sz(PILL_SIZES.M);
      const noteH = block.note ? pillMetricsAt(ns).h + sp(SPACE.l) : 0;
      const region = { x: X, y: top, w: CW, h: Math.max(160 * K, geo.contentBottom - noteH - top) };
      let cell = Math.floor(Math.sqrt((region.w * region.h) / n));
      cell = Math.max(6, Math.min(140, cell));
      let cols = Math.max(1, Math.floor(region.w / cell));
      let rows = Math.ceil(n / cols);
      while (rows * cell > region.h && cell > 6) { cell -= 1; cols = Math.max(1, Math.floor(region.w / cell)); rows = Math.ceil(n / cols); }
      ops.push({ type: 'dots', role: 'dots', x: X, y: region.y, w: cols * cell, h: rows * cell, n, hi, cell, cols, base: S.dot, enter: 'none', delay: st, align: 'col' });
      if (block.note) ops.push(fitPill(block.note, X, region.y + rows * cell + sp(SPACE.l), PILL_SIZES.M, PILL_SIZES.S, hi ? 'green' : 'ink', CW, { role: 'note', enter: 'left', delay: 1500, align: 'col' }));
    } else if (block.type === 'compare') {
      let top = geo.slots.head;
      if (block.kicker) {
        if (LY.kickerBoxed) {
          const op = fitPill(block.kicker, X, top, PILL_SIZES.M, PILL_SIZES.S, LY.kickerFill, CW, { role: 'kicker', enter: 'left', delay: 0, align: 'col', slot: 'head' });
          ops.push(op);
          top += op.box.h + sp(SPACE.xl);
        } else {
          const kt = block.kicker.toUpperCase();
          const ks = sz('caption');
          ops.push({ type: 'text', role: 'kicker', text: kt, font: displayFont(ks), size: ks, x: X, y: top + TYPE.cap * ks, w: tracked(m, kt, ks), color: tx('ink'), track: TYPE.tracking * ks, enter: 'left', delay: 0, align: 'col', slot: 'head' });
          top += ks * TYPE.cap + sp(SPACE.xxl);
        }
      }
      const items = (block.items || []).slice(0, LIMITS.compareMax);
      const max = Math.max(0, ...items.map(it => it.value)) || 1;
      const unit = (geo.contentBottom - top) / Math.max(2, items.length);
      // Labels: Caption step (Label when four rows are tight); values one step
      // under the bar's height; bars are 8-pt multiples.
      const ls = unit >= 200 * T ? sz('caption') : sz('label');
      const barH = Math.round(Math.min(128 * T, unit * 0.44) / 8) * 8;
      const valueSize = snapStep(barH * 0.92 / T) * T;
      const reserve = Math.max(...items.map(it => tracked(m, String(it.display || it.value).toUpperCase(), valueSize)), 0) + sp(SPACE.m);
      const barMax = Math.max(160, CW - reserve);
      items.forEach((it, i) => {
        const y0 = top + i * unit;
        const toks = emTokens(it.label);
        const list = cutToFit(m, toks, ls, CW);
        const label = tokText(list);
        ops.push({ type: 'text', role: 'item-label', text: label, font: displayFont(ls), size: ls, x: X, y: y0 + TYPE.cap * ls, w: tracked(m, label, ls), color: tx('ink'), track: TYPE.tracking * ls, enter: 'left', delay: i * st, align: 'col', ...(list.length < toks.length ? { shortened: true } : {}) });
        const by = y0 + TYPE.cap * ls + sp(SPACE.s);
        // A tiny value still reads as a bar, never as a thin stripe.
        const w = Math.max(Math.ceil(barH * 0.4), Math.round((barMax * it.value) / max));
        const color = it.color || (i === 0 ? 'blue' : 'ink');
        ops.push({ type: 'bar', role: 'bar', x: X, y: by, w, h: barH, fill: fl(color), enter: 'grow', delay: i * st + 120, align: 'col' });
        const disp = String(it.display || it.value).toUpperCase();
        ops.push({ type: 'text', role: 'item-value', text: disp, font: displayFont(valueSize), size: valueSize, x: X + w + sp(SPACE.m), y: by + barH / 2 + (TYPE.cap * valueSize) / 2, w: tracked(m, disp, valueSize), color: tx('ink'), track: TYPE.tracking * valueSize, enter: 'left', delay: i * st + 360 });
      });
    } else if (block.type === 'quote') {
      const text = `${block.text}`.toUpperCase();
      // Balanced: no one-word last line when a narrower measure avoids it.
      const lines0 = s => { for (const k of [1, 0.86, 0.74]) { const l = wrapWidth(m, text, s, CW * k); if (l.length === 1 || words(l[l.length - 1]).length > 1) return l; } return wrapWidth(m, text, s, CW); };
      const pk = pickStep('h1', 'caption', T, s => lines0(s).length <= 5 && lines0(s).length * TYPE.lineHeight * s <= 560 * K);
      const size = pk.size;
      const lines = lines0(size);
      const qm = 360 * T;
      ops.push({ type: 'text', role: 'quote-mark', text: '“', font: displayFont(qm), size: qm * 0.5, x: X - 8, y: geo.slots.head + qm * 0.5, w: qm * 0.42, color: tx('blue'), noCheck: true, enter: 'up', delay: 0 });
      let y = geo.slots.head + qm * 0.5 + sp(SPACE.m) + TYPE.cap * size;
      lines.forEach((t, i) => { ops.push({ type: 'text', role: 'quote', text: t, font: displayFont(size), size, x: X, y, w: tracked(m, t, size), color: tx('ink'), track: TYPE.tracking * size, enter: 'up', delay: (i + 1) * st, align: 'col' }); y += TYPE.lineHeight * size; });
      if (block.who) {
        const wtop = y - TYPE.lineHeight * size + sp(SPACE.xxl);
        if (LY.whoBoxed) ops.push(fitPill(block.who, X, wtop, PILL_SIZES.M, PILL_SIZES.S, 'blue', CW, { role: 'who', enter: 'left', delay: (lines.length + 1) * st, align: 'col' }));
        else { const ws = sz('caption'); const wt = block.who.toUpperCase(); ops.push({ type: 'text', role: 'who', text: wt, font: displayFont(ws), size: ws, x: X, y: wtop + TYPE.cap * ws, w: tracked(m, wt, ws), color: tx('blue'), track: TYPE.tracking * ws, enter: 'left', delay: (lines.length + 1) * st, align: 'col' }); }
      }
    } else if (block.type === 'endcard') {
      const cta = (block.cta || DEFAULT_CTA).map(c => String(c).toUpperCase());
      const pk = pickStep('h1', 'h2', T, s => cta.every(t => tracked(m, t, s) + 2 * TYPE.pad * s <= CW + 0.01));
      const size = pk.size;
      const pad = TYPE.pad * size;
      const lh = TYPE.lineHeight * size;
      const widest = Math.max(...cta.map(t => tracked(m, t, size)));
      const top = geo.slots.head;
      const panel = { type: 'panel', role: 'cta-panel', x: X, y: top, w: widest + 2 * pad, h: TYPE.cap * size + (cta.length - 1) * lh + 2 * pad, fill: S.cta, enter: 'left', delay: 0, align: 'col' };
      if (LY.ctaPanel) ops.push(panel);
      // Minimal: the same words without the panel, the last line in the accent.
      cta.forEach((t, i) => ops.push({ type: 'text', role: 'cta', text: t, font: displayFont(size), size, x: X + (LY.ctaPanel ? pad : 0), y: top + pad + TYPE.cap * size + i * lh, w: tracked(m, t, size), color: LY.ctaPanel ? inkOn(S.cta, theme) : tx(i === cta.length - 1 && cta.length > 1 ? 'blue' : 'ink'), track: TYPE.tracking * size, ...(LY.ctaPanel ? { onPanel: true, on: S.cta } : {}), enter: 'left', delay: 0, ...(pk.fits ? {} : { shortened: true }) }));
      const lw = Math.round((258 * geo.logotype.h) / 30.6864);
      // INFERRED: the message on top, the logotype as the signature above the source line.
      ops.push({ type: 'logotype', role: 'logotype', x: X, y: Math.round(Math.max(panel.y + panel.h + 96 * K, geo.sourceY - 92 * K - geo.logotype.h - 34)), w: lw, h: geo.logotype.h, variant: S.logo, enter: 'up', delay: st });
      const src = String(timeline.sourceLine || '').trim();
      if (src) {
        // Body step; a source line too long for the column is cut at a word.
        const s = sz('body');
        const f = smallFont(s);
        let text = src.toUpperCase();
        let cut = false;
        while (measure(text, f) > CW && text.includes(' ')) { text = `${text.slice(0, text.lastIndexOf(' ')).replace(/[,;:·-]+$/, '')}…`.replace(/…(?=.*…)/, ''); cut = true; }
        ops.push({ type: 'text', role: 'source', text, font: f, size: s, x: X, y: geo.sourceY, w: Math.min(CW, measure(text, f)), color: tx('ink'), alpha: S.small, enter: 'up', delay: 2 * st, small: true, ...(cut ? { shortened: true } : {}) });
      }
    } else layoutV3(block);

    function layoutV3(b) {
      // A v3 block: kicker pill (top slot), headline, its one element, pills.
      const pillsWanted = [];
      if (b.kicker) pillsWanted.push('kicker');
      if (b.type === 'photoCard' && b.label) pillsWanted.unshift('label');
      if (b.tag) pillsWanted.splice(b.type === 'photoCard' ? 1 : 0, 0, 'tag');
      if (b.type === 'clipLabel') { if (b.sub) pillsWanted.unshift('sub'); if (b.text) pillsWanted.unshift('text'); }
      if (b.type === 'tagPill' && b.text) pillsWanted.unshift('text');
      if (b.type === 'rankTile' && b.label) pillsWanted.unshift('label');
      const drawn = new Set(pillsWanted.filter(() => allow()));
      if (b.kicker && drawn.has('kicker')) kickerOp(b.kicker, 'ink');
      if (b.type === 'rankTile' && b.label && drawn.has('label')) kickerOp(b.label, 'ink');
      const head = geo.slots.head;
      const bare = b.type === 'tagPill' && !graphic.media;
      // A tag with no picture grows: a Display headline (up to three lines) over the tag, centred.
      const titleMax = theme.motion.id === 'punchy' || bare ? 'display' : 'h1';
      const t = b.title ? titleOps(b.title, head, { maxStep: titleMax, minStep: 'h2', maxLines: bare ? 3 : 2 }) : null;
      let y = t ? t.bottom + sp(SPACE.gap) : head;
      // A tag below the headline (photo cards carry theirs on the card).
      const tagBelow = () => {
        if (!b.tag || !drawn.has('tag')) return;
        const op = fitPill(b.tag.text, X, y, PILL_SIZES.M, PILL_SIZES.S, b.tag.tone, CW, { role: 'tag', enter: 'left', delay: st, align: 'col' });
        ops.push(op);
        y += op.box.h + sp(SPACE.l);
      };
      if (b.type === 'photoCard') {
        const tiles = (b.tiles || []).slice(0, 3);
        if (!graphic.media) {
          // No verified photo: no empty card. The tiles carry the scene.
          tagBelow();
          tilesOps(tiles, Math.max(y, head), {});
          return;
        }
        // The card ends 64 px above the caption bar (captions never sit on it).
        const y1 = geo.contentBottom;
        const card = { type: 'media', role: 'card', fit: 'focus', x: X, y, w: CW, h: Math.max(320 * K, y1 - y), focus: b.focus || null, scan: Boolean(b.scan), bracket: true, enter: 'up', delay: 0, align: 'col' };
        ops.push(card);
        let py = card.y + sp(TILE_INSET);
        const inset = X + sp(TILE_INSET);
        if (b.label && drawn.has('label')) {
          // Pills on the card ride in with it (same direction, a beat later).
          const op = fitPill(b.label, inset, py, PILL_SIZES.S, PILL_SIZES.S, 'blue', CW - 2 * sp(TILE_INSET), { role: 'label', enter: 'up', delay: st, inCard: true });
          ops.push(op);
          py += op.box.h + sp(SPACE.xs);
        }
        if (b.tag && drawn.has('tag')) ops.push(fitPill(b.tag.text, inset, py, PILL_SIZES.S, PILL_SIZES.S, b.tag.tone, CW - 2 * sp(TILE_INSET), { role: 'tag', enter: 'up', delay: 2 * st, inCard: true }));
        if (tiles.length) tilesOps(tiles, geo.slots.lower, { maxValue: 'display', delay0: 3 * st });
      } else if (b.type === 'statTiles') {
        tagBelow();
        tilesOps((b.tiles || []).slice(0, 3), y, {});
      } else if (b.type === 'rankTile') {
        tagBelow();
        // The rank is the tile's value; the position is its own label line
        // ("#1" over "PASSER RATING"), so a long position is never cut.
        tilesOps((b.items || []).map(it => ({ kicker: it.kicker, value: it.rank || it.pos, label: it.rank ? it.pos : '', chip: it.chip, tone: it.tone })), y, {});
      } else if (b.type === 'dotGrid') {
        // The grid fills the column: the biggest cell that fits the space
        // between the headline and the caption line; the legend sits below it.
        const groups = b.groups || [];
        const n = Math.max(1, b.total);
        // The legend is part of the data block: directly under the grid, above
        // the caption bar. One row of M pills when they fit, else one row of S
        // pills, else M pills stacked 8 px apart, left on the grid.
        const labelled = groups.filter(g => g.label);
        const rowW = size => labelled.reduce((a, g, i) => a + tracked(m, g.label.toUpperCase(), size) + pillPad(size) + (i ? sp(SPACE.s) : 0), 0);
        const row = [sz(PILL_SIZES.M), sz(PILL_SIZES.S)].find(size => rowW(size) <= CW + 0.01);
        const ls = row || sz(PILL_SIZES.M);
        const lh = Math.ceil(pillMetricsAt(ls).h / 8) * 8;
        const legendH = labelled.length ? (row ? lh : labelled.length * lh + (labelled.length - 1) * sp(SPACE.xs)) + sp(SPACE.m) : 0;
        const region = { y, h: Math.max(200 * K, geo.contentBottom - y - legendH) };
        let cols = 1;
        let cell = CW;
        for (let c = 1; c <= n; c += 1) {
          const cl = Math.min(120 * T, CW / c);
          if (Math.ceil(n / c) * cl <= region.h) { cols = c; cell = cl; break; }
          cols = c; cell = cl;
        }
        const rows = Math.ceil(n / cols);
        ops.push({ type: 'dotgrid', role: 'dotgrid', x: X, y: region.y, w: cols * cell, h: rows * cell, n, cols, cell, groups: groups.map(g => ({ n: g.n, tone: fl(g.tone === 'grey' ? 'grey' : g.tone) })), rest: 'grey', enter: 'none', delay: st, align: 'col' });
        let lx = X;
        let ly = Math.ceil((region.y + rows * cell + sp(SPACE.m)) / 8) * 8;
        labelled.forEach((g, i) => {
          const op = pill(g.label, lx, ly, ls, g.tone, { role: 'legend', pillSize: pillClass(ls, T), enter: 'left', delay: 1400 + i * st, legend: true, align: row && i > 0 ? 'row' : 'col' });
          ops.push(op);
          if (row) lx = op.box.x + op.box.w + sp(SPACE.s);
          else ly += lh + sp(SPACE.xs);
        });
      } else if (b.type === 'streak') {
        const items = b.items || [];
        const n = items.length;
        if (n) {
          const perRow = n <= 10 ? n : Math.ceil(n / 2);
          const gap = sp(SPACE.s);
          const sq = Math.min(128 * T, Math.floor((CW - gap * (perRow - 1)) / perRow));
          const letter = snapStep((sq * 0.62) / T) * T;
          const FILL = { W: 'green', L: 'ink', T: 'grey' };
          items.forEach((r, i) => {
            const x = X + (i % perRow) * (sq + gap);
            const yy = y + Math.floor(i / perRow) * (sq + gap);
            const fill = fl(FILL[r]);
            const d = st + i * 50;
            ops.push({ type: 'square', role: 'streak', x, y: yy, w: sq, h: sq, fill, enter: 'up', delay: d, align: i % perRow === 0 ? 'col' : 'row' });
            const w = tracked(m, r, letter);
            ops.push({ type: 'text', role: 'streak-letter', text: r, font: displayFont(letter), size: letter, x: x + (sq - w) / 2, y: yy + (sq + TYPE.cap * letter) / 2, w, color: inkOn(fill, theme), on: fill, track: TYPE.tracking * letter, enter: 'up', delay: d });
          });
          y += Math.ceil(n / perRow) * (sq + gap) - gap;
          if (b.label) {
            const ls = pickStep('display', 'h2', T, s => tracked(m, b.label.toUpperCase(), s) <= CW).size;
            const lt = b.label.toUpperCase();
            ops.push({ type: 'text', role: 'streak-label', text: lt, font: displayFont(ls), size: ls, x: X, y: y + sp(SPACE.gap) + TYPE.cap * ls, w: tracked(m, lt, ls), color: tx('ink'), track: TYPE.tracking * ls, enter: 'up', delay: st + n * 50 + 120, align: 'col' });
          }
        }
      } else if (b.type === 'tagPill' && graphic.media) {
        // Over a clip or photo (Game Tape, Hype Cut): the picture fills the
        // frame, the headline is boxed, the tag is a lower-third pill.
        ops.unshift({ ...mediaFull(), fit: 'focus', focus: b.focus || null, full: true });
        ops.splice(0, ops.length, ...ops.filter(o => o.role !== 'title'));
        if (b.title) {
          const toks = emTokens(b.title);
          const pk = pickStep('h1', 'h2', T, s => wrapTokens(m, toks, s, CW - pillPad(s)).length <= 2);
          let ty = head;
          wrapTokens(m, toks, pk.size, CW - pillPad(pk.size)).slice(0, 2).forEach((l, i) => {
            const op = pill(tokText(l), X, ty, pk.size, l.some(x => x.em) ? 'blue' : 'ink', { role: 'title', pillSize: pillClass(pk.size, T), enter: 'left', delay: i * st, align: 'col', ...(i === 0 ? { slot: 'head' } : {}) });
            ops.push(op);
            ty += pillStep(pk.size);
          });
        }
        if (b.text && drawn.has('text')) ops.push(fitPill(b.text, X, geo.slots.lower, PILL_SIZES.M, PILL_SIZES.S, b.tone, CW, { role: 'tag', enter: 'left', delay: 2 * st, align: 'col', slot: 'lower' }));
      } else if (b.type === 'tagPill' && !t && b.text && drawn.has('text')) {
        // A tag alone (no picture, no headline) is the headline: its parts
        // ("TORE ACHILLES · JAN. 11") stack as H1 pills, the first in the tag's
        // colour, the rest ink, centred as one group.
        const parts = b.text.split(/\s+·\s+/).map(x => x.trim()).filter(Boolean);
        const rows = parts.length > 1 ? parts : [b.text];
        const pk = pickStep('h1', 'caption', T, s => rows.every(r => tracked(m, r.toUpperCase(), s) + pillPad(s) <= CW + 0.01));
        let ty = y;
        rows.forEach((r, i) => {
          const op = pill(r, X, ty, pk.size, i === 0 ? b.tone : 'ink', { role: 'tag', pillSize: pillClass(pk.size, T), enter: 'left', delay: st + i * st, align: 'col' });
          ops.push(op);
          ty += pillStep(pk.size);
        });
      } else if (b.type === 'tagPill') {
        if (b.text && drawn.has('text')) {
          const op = fitPill(b.text, X, y, PILL_SIZES.M, PILL_SIZES.S, b.tone, CW, { role: 'tag', enter: 'left', delay: st, align: 'col', ...(t ? {} : { slot: 'head' }) });
          ops.push(op);
          y += op.box.h;
        }
        if (graphic.media) { const md = mediaBelow(y); if (md) ops.unshift({ ...md, fit: 'focus', focus: b.focus || null }); }
      } else if (b.type === 'clipLabel') {
        // The clip fills the frame; the label is a lower-third pill under the caption line.
        if (graphic.media) ops.unshift({ ...mediaFull(), fit: 'focus', focus: b.focus || null, full: true });
        let ly = geo.slots.lower;
        if (b.text && drawn.has('text')) {
          const op = fitPill(b.text, X, ly, PILL_SIZES.M, PILL_SIZES.S, b.tone || 'blue', CW, { role: 'label', enter: 'left', delay: st, align: 'col', slot: 'lower' });
          ops.push(op);
          ly += op.box.h + sp(SPACE.xs);
        }
        if (b.sub && drawn.has('sub')) ops.push(fitPill(b.sub, X, ly, PILL_SIZES.S, PILL_SIZES.S, 'ink', CW, { role: 'sub', enter: 'left', delay: 2 * st, align: 'col' }));
      }
    }
    centreGroup(ops, block, geo);
    plateOps(ops, S, theme, geo);
    // A scene that leaves the look's ground (the kit's quote on ink) paints its own first.
    if (S.ground !== theme.base.ground) ops.unshift({ type: 'rect', role: 'ground', x: 0, y: 0, w: geo.w, h: geo.h, fill: S.ground, noBox: true, enter: 'none' });
    return ops;
  }
  function wrapWidth(measure, text, size, width) {
    const out = [];
    let line = '';
    words(text).forEach(w => {
      const next = line ? `${line} ${w}` : w;
      if (line && tracked(measure, next, size) > width) { out.push(line); line = w; } else line = next;
    });
    if (line) out.push(line);
    return out;
  }
  // Axis-aligned box of a tilted (stamp) op.
  function rotatedBox(op) {
    const b = op.box ? { ...op.box } : hugBox(op.x, op.y, op.w, op.size);
    if (!op.rot) return b;
    const a = (op.rot * Math.PI) / 180;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]);
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  // Captions: one line at y 1172, centred, 1-3 words cut on together, in an
  // ink box that hugs the line; *emphasis* words in yellow.
  function layoutCaption(measure, card, timeline) {
    const geo = geometry(timeline.size);
    const list = card.words.map(i => ({ i, text: String(timeline.tracks.captions.words[i].w).replace(/^[“"]|[”"]$/g, '').toUpperCase(), em: Boolean(timeline.tracks.captions.words[i].em) }));
    const line = list.map(w => w.text).join(' ');
    // Caption step (64), Label (44) when the words need it; never in between.
    const size = pickStep('caption', 'label', geo.type, s => tracked(measure, line, s) + 2 * TYPE.pad * s <= geo.col.w + 0.01).size;
    const w = tracked(measure, line, size);
    const box = hugBox(0, 0, w, size);
    // v3: the caption bar sits on the column (x 60), like every other part.
    const x0 = geo.col.x + TYPE.pad * size;
    const y = geo.captionY - box.h / 2 + TYPE.pad * size + TYPE.cap * size;
    const space = measure(' ', displayFont(size)) + TYPE.tracking * size;
    let x = x0;
    const ops = list.map(word => {
      const ww = tracked(measure, word.text, size);
      const op = { type: 'cword', i: word.i, text: word.text, em: word.em, font: displayFont(size), size, x, y, w: ww, track: TYPE.tracking * size };
      x += ww + space;
      return op;
    });
    return { style: 'es', ops, box: hugBox(x0, y, w, size), size };
  }

  // Every word box of an ES reel (the safe-frame maths): text, boxed words
  // with their padding, tilted stamps, captions. Background panels count
  // too when they carry words (the CTA panel).
  function textBoxes(measure, timeline, layout = layoutBlock) {
    const out = [];
    timeline.tracks.graphics.forEach(g => layout(measure, g, timeline).forEach(op => {
      if ((op.type === 'text' || op.type === 'count') && !op.noCheck) {
        const b = op.rot ? rotatedBox(op) : opBox(op);
        out.push({ beat: g.beat, role: op.role, text: op.text, ...b });
      } else if (op.type === 'panel' || op.type === 'tile' || op.type === 'square') out.push({ beat: g.beat, role: op.role, text: '', x: op.x, y: op.y, w: op.w, h: op.h });
    }));
    timeline.tracks.captions.cards.forEach(card => {
      const cap = layoutCaption(measure, card, timeline);
      if (cap.box) out.push({ beat: card.beat, role: 'caption', text: cap.ops.map(o => o.text).join(' '), ...cap.box });
    });
    return out;
  }
  // Inside the safe frame: no words above y 300, within 40 px of the sides, or below y 1640.
  function outsideSafe(box, size) {
    const geo = geometry(size);
    return box.y < geo.safe.top - 0.5 || box.y + box.h > geo.safe.bottom + 0.5 || box.x < geo.safe.side - 0.5 || box.x + box.w > geo.w - geo.safe.side + 0.5;
  }
  // Marks: the ES mark on the hook and the end card only; the logotype on the end card only.
  function markRect(size) { const g = geometry(size); return { x: g.mark.x, y: g.mark.y, w: g.mark.size, h: g.mark.size, clear: g.mark.clear }; }
  const MARK_BLOCKS = new Set(['hook', 'endcard']);

  // ─── Drawing ────────────────────────────────────────────────────────────
  // helpers (from reel-render): { drawVisual(ctx, assetId, rect, timeline, env, opts), drawBrand(ctx, id, x, y, w, h, variant, env), BRAND }
  function enterState(op, local, motion = null) {
    const l = local - (op.delay || 0);
    const p = ease.expoOut(l / ((motion && motion.enterMs) || MOTION.enterMs));
    if (op.enter === 'none' || op.enter === 'grow' || op.enter === 'stamp') return { a: 1, dx: 0, dy: 0, p, l };
    const a = l <= 0 ? 0 : 1;
    if (op.enter === 'left') return { a, dx: -(1 - p) * MOTION.fromLeft, dy: 0, p, l };
    return { a, dx: 0, dy: (1 - p) * MOTION.fromBelow, p, l };
  }
  function setTrack(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px || 0}px`; }
  function fillHug(ctx, op, color, theme) {
    const b = op.box || hugBox(op.x, op.y, op.w, op.size);
    ctx.fillStyle = colorOf(color, theme);
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  function drawText(ctx, op, text = op.text, theme = null) {
    ctx.font = op.font;
    if (op.fill) fillHug(ctx, op, op.fill, theme);
    ctx.fillStyle = colorOf(op.color, theme);
    if (op.track) setTrack(ctx, op.track);
    ctx.fillText(text, op.x, op.y);
    if (op.track) setTrack(ctx, 0);
  }
  function drawDots(ctx, op, local, theme = null) {
    // Grey dots fill in row by row over 1.2 s; the highlighted ones (the
    // last cells) land last, in green, with a small pop.
    const plain = op.n - op.hi;
    const shown = Math.floor(plain * ease.expoOut((local - (op.delay || 0)) / 1200));
    const r = op.cell * 0.36;
    // The plain dots take the look's dot colour; the highlight is always green.
    ctx.fillStyle = colorOf(op.base || 'ink', theme);
    ctx.globalAlpha *= 0.3;
    ctx.beginPath();
    for (let i = 0; i < shown; i += 1) {
      const cx = op.x + (i % op.cols) * op.cell + op.cell / 2;
      const cy = op.y + Math.floor(i / op.cols) * op.cell + op.cell / 2;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalAlpha /= 0.3;
    if (!op.hi) return;
    const t = local - (op.delay || 0) - 1250;
    if (t <= 0) return;
    const k = 1 + 0.5 * (1 - ease.expoOut(t / 300));
    // A few highlighted dots in a big field would vanish: they draw at least
    // 9 px across, with a green ring round each (flat, no glow).
    const few = op.hi <= 12;
    const rr = (few ? Math.max(op.cell * 0.46, 9) : op.cell * 0.42) * k;
    const centre = j => { const i = plain + j; return [op.x + (i % op.cols) * op.cell + op.cell / 2, op.y + Math.floor(i / op.cols) * op.cell + op.cell / 2]; };
    ctx.fillStyle = TOKENS.green;
    ctx.beginPath();
    for (let j = 0; j < op.hi; j += 1) { const [cx, cy] = centre(j); ctx.moveTo(cx + rr, cy); ctx.arc(cx, cy, rr, 0, Math.PI * 2); }
    ctx.fill();
    if (few) {
      ctx.strokeStyle = TOKENS.green;
      ctx.lineWidth = 4;
      for (let j = 0; j < op.hi; j += 1) { const [cx, cy] = centre(j); ctx.beginPath(); ctx.arc(cx, cy, rr + 12, 0, Math.PI * 2); ctx.stroke(); }
    }
  }
  // ─── v3 drawing: dot grid, focus-framed media, viewfinder, scan line ───
  // The dot grid: the groups in order (blue, ink, grey), then the rest grey;
  // dots land one after another over 1.4 s.
  function drawDotGrid(ctx, op, local, theme = null) {
    const t = local - (op.delay || 0);
    const shown = Math.floor(op.n * ease.expoOut(t / 1400));
    if (shown <= 0) return;
    const r = op.cell * 0.36;
    const runs = [];
    let i = 0;
    (op.groups || []).forEach(g => { runs.push({ from: i, to: i + g.n, tone: g.tone }); i += g.n; });
    if (i < op.n) runs.push({ from: i, to: op.n, tone: op.rest || 'grey' });
    runs.forEach(run => {
      ctx.fillStyle = colorOf(run.tone, theme);
      ctx.beginPath();
      for (let k = run.from; k < Math.min(run.to, shown); k += 1) {
        const cx = op.x + (k % op.cols) * op.cell + op.cell / 2;
        const cy = op.y + Math.floor(k / op.cols) * op.cell + op.cell / 2;
        ctx.moveTo(cx + r, cy);
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
      ctx.fill();
    });
  }
  const mediaSize = media => {
    if (!media) return null;
    const w = media.videoWidth || media.naturalWidth || media.width;
    const h = media.videoHeight || media.naturalHeight || media.height;
    return w > 0 && h > 0 ? [w, h] : null;
  };
  // Where the face is, in source pixels: the block's focus box, else the
  // picture's verified head point (photo-verify) sized from its focus box,
  // else its focus box. null = unknown (no bracket is drawn).
  function faceBox(size, blockFocus, asset) {
    const [sw, sh] = size;
    const px = f => ({ x: f.x * sw, y: f.y * sh, w: f.w * sw, h: f.h * sh });
    if (blockFocus) return px(blockFocus);
    const a = asset || {};
    const focus = focusBox(a.focus);
    const hd = Array.isArray(a.head) ? { x: a.head[0], y: a.head[1] } : a.head;
    if (hd && Number.isFinite(Number(hd.x)) && Number.isFinite(Number(hd.y))) {
      const side = Math.max(0.12 * Math.min(sw, sh), (focus ? focus.w * sw * 0.62 : 0.24 * sw));
      return { x: hd.x * sw - side / 2, y: hd.y * sh - side * 0.55, w: side, h: side * 1.1 };
    }
    return focus ? px(focus) : null;
  }
  // The crop that keeps the face in frame: the face about half the frame's
  // height (never below a cover fit), its centre a little above the middle,
  // drifting in by up to 6% over the scene.
  // share: how much of the frame's height the face takes (a card frames the
  // face close; a full-frame clip keeps the player in shot).
  function focusCrop(size, rect, face, zoom = 1, share = 0.46) {
    const [sw, sh] = size;
    const cover = Math.max(rect.w / sw, rect.h / sh);
    const want = face ? (rect.h * share) / face.h : cover;
    const scale = Math.max(cover, Math.min(want, cover * 2.4)) * zoom;
    const cw = rect.w / scale;
    const ch = rect.h / scale;
    const fx = face ? face.x + face.w / 2 : sw / 2;
    const fy = face ? face.y + face.h / 2 : sh * 0.34;
    const cx = Math.max(0, Math.min(sw - cw, fx - cw / 2));
    const cy = Math.max(0, Math.min(sh - ch, fy - ch * 0.44));
    return { sx: cx, sy: cy, sw: cw, sh: ch, scale, map: (x, y) => [rect.x + (x - cx) * scale, rect.y + (y - cy) * scale] };
  }
  function drawFocusMedia(ctx, op, shot, p, timeline, env, helpers, frame, local, theme) {
    const asset = timeline.assets ? timeline.assets[shot.asset] : null;
    const vid = asset && asset.kind === 'clip' && env.videos ? env.videos[shot.asset] : null;
    const media = vid && (vid.readyState || 0) >= 2 ? vid : (env.images ? env.images[shot.asset] : null);
    const size = mediaSize(media);
    const stt = op.full ? { a: 1, dx: 0, dy: 0 } : enterState(op, local, theme.motion);
    if (stt.a <= 0) return;
    ctx.save();
    ctx.globalAlpha *= stt.a;
    ctx.translate(stt.dx, stt.dy);
    ctx.save();
    ctx.beginPath(); ctx.rect(op.x, op.y, op.w, op.h); ctx.clip();
    if (!size) {
      helpers.drawVisual(ctx, shot.asset, op, timeline, env, { p, motion: shot.motion, tMs: frame.t });
      ctx.restore(); ctx.restore();
      return;
    }
    const face = faceBox(size, op.focus, asset);
    const zoom = MOTION.driftFrom + (1.06 - MOTION.driftFrom) * ease.inOutSine(p);
    const c = focusCrop(size, op, face, zoom, op.full ? 0.16 : 0.46);
    ctx.drawImage(media, c.sx, c.sy, c.sw, c.sh, op.x, op.y, op.w, op.h);
    ctx.restore();
    if (face && (op.bracket || op.scan)) {
      const [x0, y0] = c.map(face.x, face.y);
      const [x1, y1] = c.map(face.x + face.w, face.y + face.h);
      const padX = (x1 - x0) * 0.16;
      const padY = (y1 - y0) * 0.12;
      const box = { x: Math.max(op.x + 16, x0 - padX), y: Math.max(op.y + 16, y0 - padY), w: 0, h: 0 };
      box.w = Math.min(op.x + op.w - 16, x1 + padX) - box.x;
      box.h = Math.min(op.y + op.h - 16, y1 + padY) - box.y;
      if (box.w > 40 && box.h > 40) {
        const t = local - (op.delay || 0) - 250;
        if (op.bracket) drawBracket(ctx, box, t, theme);
        if (op.scan) drawScanLine(ctx, box, t, theme);
      }
    }
    ctx.restore();
  }
  // The viewfinder: four blue corner brackets that close in on the face.
  function drawBracket(ctx, box, t, theme) {
    if (t <= 0) return;
    const p = ease.expoOut(t / 450);
    const k = 1 + 0.22 * (1 - p);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const w = box.w * k;
    const h = box.h * k;
    const x = cx - w / 2;
    const y = cy - h / 2;
    const arm = Math.max(24, Math.min(w, h) * 0.22);
    ctx.save();
    ctx.globalAlpha *= Math.min(1, t / 180);
    ctx.strokeStyle = colorOf('blue', theme);
    ctx.lineWidth = 8;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([px, py, sx, sy]) => {
      ctx.moveTo(px, py + sy * arm); ctx.lineTo(px, py); ctx.lineTo(px + sx * arm, py);
    });
    ctx.stroke();
    ctx.restore();
  }
  // The scan line: a thin blue line sweeping the viewfinder, down and back.
  function drawScanLine(ctx, box, t, theme) {
    if (t <= 300) return;
    const period = 2200;
    const q = ((t - 300) % period) / period;
    const pos = ease.inOutSine(q < 0.5 ? q * 2 : 2 - q * 2);
    const y = box.y + 12 + (box.h - 24) * pos;
    ctx.save();
    ctx.fillStyle = colorOf('blue', theme);
    ctx.globalAlpha *= 0.16;
    const down = q < 0.5;
    ctx.fillRect(box.x + 12, down ? y - 40 : y, box.w - 24, 40);
    ctx.globalAlpha /= 0.16;
    ctx.fillRect(box.x + 12, y - 2, box.w - 24, 4);
    ctx.restore();
  }
  // The ES mark: the official artwork scaled uniformly to 80 px wide, its
  // blue box extended to an 80 px square (INFERRED: the kit's own mark file
  // was not available; the letters are the official vectors, never retyped).
  // variant: 'blue', or 'black' where what is under the mark is ES blue (the
  // brand guide's two colourways; a look never picks any other).
  function drawMark(ctx, x, y, size, helpers, env, variant = 'blue') {
    const v = variant === 'black' ? 'black' : 'blue';
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = v === 'black' ? '#000000' : TOKENS.blue;
    ctx.fillRect(x, y, size, size);
    const art = helpers && helpers.BRAND && helpers.BRAND.mark;
    const h = art ? (size * art.h) / art.w : size;
    if (helpers && helpers.drawBrand) helpers.drawBrand(ctx, 'mark', x, y + (size - h) / 2, size, h, v, env);
    ctx.restore();
  }
  function drawStampOp(ctx, op, local, theme = null) {
    const t = local - op.at;
    if (t < 0) return;
    const p = clamp01(t / MOTION.stampMs);
    const k = MOTION.stampFrom - (MOTION.stampFrom - 1) * ease.power4In(p);
    const b = op.box || hugBox(op.x, op.y, op.w, op.size);
    ctx.save();
    ctx.globalAlpha *= Math.min(1, 0.4 + p);
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
    ctx.rotate((op.rot * Math.PI) / 180);
    ctx.scale(k, k);
    ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
    drawText(ctx, op, op.text, theme);
    ctx.restore();
  }
  // The small screen shake when the stamp lands (decays over 0.26 s).
  function shakeAt(ops, local) {
    const s = ops.find(o => o.enter === 'stamp');
    if (!s) return [0, 0];
    const t = local - s.at - MOTION.stampMs;
    if (t < 0 || t > MOTION.shakeMs) return [0, 0];
    const d = (1 - t / MOTION.shakeMs) * MOTION.shakePx;
    return [Math.sin(t / 14) * d, Math.cos(t / 11) * d * 0.6];
  }
  function drawOps(ctx, ops, graphic, timeline, frame, env, helpers, times, theme = themeOf(timeline)) {
    const local = times.ops;
    const [sx, sy] = shakeAt(ops, times.stamp);
    ctx.save();
    ctx.translate(sx, sy);
    ops.forEach(op => {
      if (op.type === 'media') {
        const shot = frame.shot && frame.shot.beat === graphic.beat ? frame.shot : (timeline.tracks.video.find(s => s.beat === graphic.beat) || null);
        if (!shot || !shot.asset) return;
        const p = clamp01((frame.t - shot.inMs) / Math.max(1, shot.outMs - shot.inMs));
        if (op.fit === 'focus') { drawFocusMedia(ctx, op, shot, p, timeline, env, helpers, frame, local, theme); return; }
        ctx.save();
        ctx.beginPath(); ctx.rect(op.x, op.y, op.w, op.h); ctx.clip();
        helpers.drawVisual(ctx, shot.asset, op, timeline, env, { p, motion: shot.motion, tMs: frame.t });
        ctx.restore();
        return;
      }
      if (op.type === 'rect') { ctx.fillStyle = colorOf(op.fill, theme); ctx.fillRect(op.x, op.y, op.w, op.h); return; }
      if (op.enter === 'stamp') { drawStampOp(ctx, op, times.stamp, theme); return; }
      const st = enterState(op, local, theme.motion);
      if (st.a <= 0) return;
      ctx.save();
      ctx.globalAlpha *= st.a * (op.alpha || 1);
      ctx.translate(st.dx, st.dy);
      if (op.type === 'text') drawText(ctx, op, op.text, theme);
      else if (op.type === 'count') {
        const c = ease.expoOut((local - (op.delay || 0)) / MOTION.countMs);
        drawText(ctx, op, numberDisplay(op.block, op.block.value * c), theme);
      } else if (op.type === 'panel') { ctx.fillStyle = colorOf(op.fill, theme); ctx.fillRect(op.x, op.y, op.w, op.h); } else if (op.type === 'bar') {
        ctx.fillStyle = colorOf(op.fill, theme);
        ctx.fillRect(op.x, op.y, Math.max(0, op.w * ease.expoOut(st.l / 600)), op.h);
      } else if (op.type === 'dots') drawDots(ctx, op, local, theme);
      else if (op.type === 'dotgrid') drawDotGrid(ctx, op, local, theme);
      else if (op.type === 'tile' || op.type === 'square') { ctx.fillStyle = colorOf(op.fill, theme); ctx.fillRect(op.x, op.y, op.w, op.h); }
      else if (op.type === 'logotype') { if (helpers.drawBrand) helpers.drawBrand(ctx, 'wordmark', op.x, op.y, op.w, op.h, op.variant === 'black' ? 'black' : 'blue', env); }
      ctx.restore();
    });
    ctx.restore();
  }
  // The look's ground. Paper (and Bold) carry the faint still grain; the flat
  // grounds (ink, blue, white, a team colour) carry none.
  function drawGround(ctx, geo, env, theme = PAPER) {
    ctx.fillStyle = colorOf(theme.base.ground, theme);
    ctx.fillRect(0, 0, geo.w, geo.h);
    // Faint grain, still (no flicker): the page's noise tile at 5%.
    if (theme.grain > 0 && env.grain && typeof ctx.createPattern === 'function') {
      const pattern = ctx.createPattern(env.grain, 'repeat');
      if (pattern) {
        ctx.save();
        ctx.globalAlpha = theme.grain;
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, geo.w, geo.h);
        ctx.restore();
      }
    }
  }
  const drawPaper = (ctx, geo, env) => drawGround(ctx, geo, env, PAPER); // the old name, kept
  // The slab wipe: a blue slab, then an ink slab over it, both skewed -14°,
  // cover the frame by the half-way point (the cut happens under the ink),
  // then leave to the right. 0.5 s; no cross-fade, no zoom. A look names the
  // two colours (theme.wipe); the shape, skew and timing are the same in all.
  function slabs(p, geo = GEO, theme = null) {
    const lean = Math.tan((Math.abs(MOTION.wipeSkewDeg) * Math.PI) / 180) * geo.h;
    const SW = geo.w + lean + 80;
    const cover = -40;
    const out = [];
    if (p < 0.5) {
      const q = p / 0.5;
      const xb = -SW + (cover + SW) * ease.inOutCubic(q / 0.8);
      const xi = -SW + (cover + SW) * ease.inOutCubic((q - 0.2) / 0.8);
      out.push({ color: 'blue', x: xb }, { color: 'ink', x: xi });
    } else {
      const q = (p - 0.5) / 0.5;
      const x = cover + (geo.w + lean + 40 - cover) * ease.inOutCubic(q);
      out.push({ color: 'ink', x });
    }
    const named = theme ? { blue: theme.wipe[0], ink: theme.wipe[1] } : null;
    return out.map(s => ({ ...s, ...(named ? { color: named[s.color] } : {}), lean, w: SW, poly: [[s.x, 0], [s.x + SW, 0], [s.x + SW - lean, geo.h], [s.x - lean, geo.h]] }));
  }
  function drawSlab(ctx, p, geo = GEO, theme = null) {
    slabs(p, geo, theme).forEach(s => {
      ctx.fillStyle = colorOf(s.color, theme);
      ctx.beginPath();
      s.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    });
  }
  function drawScene(ctx, graphic, timeline, frame, env, helpers, times, layout) {
    const geo = geometry(timeline.size);
    const block = graphic.data.block;
    const theme = themeOf(timeline);
    drawGround(ctx, geo, env, theme);
    const ops = env.layoutCache ? env.layoutCache(graphic) : layout(env.measure, graphic, timeline);
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    drawOps(ctx, ops, graphic, timeline, frame, env, helpers, times, theme);
    ctx.restore();
    // The marks: the hook and the end card only, same place and size in every look.
    if (showsMark(graphic)) { const mk = markRect(timeline.size); drawMark(ctx, mk.x, mk.y, mk.w, helpers, env, markVariantFor(theme, block.type, ops, mk)); }
  }
  // The mark's colourway in a scene: the surface's (black on ES blue), or blue
  // when a photo is under it.
  function markVariantFor(theme, type, ops, mk) {
    const S = theme.surfaceFor(type);
    const photoUnder = (ops || []).some(o => o.type === 'media' && o.y <= mk.y && o.y + o.h >= mk.y + mk.h);
    return photoUnder ? 'blue' : S.mark;
  }
  function drawCaption(ctx, frame, timeline, env) {
    const card = frame.caption;
    if (!card) return;
    const layout = env.captionCache ? env.captionCache(card) : layoutCaption(env.measure, card, timeline);
    if (!layout.ops.length) return;
    const theme = themeOf(timeline);
    // A reel made in a v3 style (timeline.esStyle): caption emphasis is ES
    // blue on the ink bar (4.6:1), not yellow; older reels keep the kit's yellow.
    const cap = TH.isStyle && TH.isStyle(timeline.esStyle) ? { ...theme.caption, em: 'blue', mode: 'text' } : theme.caption;
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colorOf(cap.fill, theme);
    ctx.fillRect(layout.box.x, layout.box.y, layout.box.w, layout.box.h);
    layout.ops.forEach(op => {
      ctx.font = op.font;
      // Emphasis (yellow in the kit looks, blue in v3): words on a dark box, or (a light
      // box) the word in ink on a yellow highlight the height of the box.
      if (op.em && cap.mode === 'highlight') {
        ctx.fillStyle = colorOf(cap.em, theme);
        ctx.fillRect(op.x - 0.09 * op.size, layout.box.y, op.w + 0.18 * op.size, layout.box.h);
      }
      ctx.fillStyle = op.em ? colorOf(cap.mode === 'highlight' ? inkOn(cap.em, theme) : cap.em, theme) : colorOf(cap.ink, theme);
      setTrack(ctx, op.track);
      ctx.fillText(op.text, op.x, op.y);
      setTrack(ctx, 0);
    });
    ctx.restore();
  }
  // Frame one is the cover: the opening hook is already composed at t = 0
  // (its pills landed; only the stamp lands later, on its own time). Every
  // other scene builds in once the slab has cleared it (half the wipe).
  function sceneTimes(graphic, local) {
    if (graphic.inMs === 0) return { ops: local + 60000, stamp: local };
    const l = local - MOTION.wipeMs / 2;
    return { ops: l, stamp: l };
  }
  function drawFrame(ctx, timeline, frame, env, helpers, layout = layoutBlock) {
    const geo = geometry(timeline.size);
    const g = frame.graphic;
    const theme = themeOf(timeline);
    if (!g) { drawGround(ctx, geo, env, theme); return; }
    const tr = frame.transition;
    if (tr && tr.p < 0.5) {
      const from = tr.from;
      drawScene(ctx, from, timeline, { ...frame, shot: tr.fromShot || frame.shot }, env, helpers, sceneTimes(from, from.outMs - from.inMs), layout);
    } else {
      drawScene(ctx, g, timeline, frame, env, helpers, sceneTimes(g, g.local), layout);
    }
    if (tr) drawSlab(ctx, tr.p, geo, theme);
    drawCaption(ctx, frame, timeline, env);
  }

  // ─── Checks (references/checklist.md + brand.md "Banned") ──────────────
  const EMOJI = /\p{Extended_Pictographic}/u;
  const issue = (id, severity, message, fix = '', beat = '') => ({ id, severity, message, fix, beat });
  // Numbers as spoken: "7.5K" on screen when the VO says "7,500" is flagged.
  function numberTokens(text) {
    const out = [];
    const re = /(\$?)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(%|k\b|m\b|b\b|thousand\b|million\b|billion\b)?/gi;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const n = Number(m[2].replace(/,/g, ''));
      const unit = (m[3] || '').toLowerCase();
      const mult = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 }[unit] || 1;
      out.push({ raw: m[0].trim(), value: Math.round(n * mult * 1000) / 1000, form: m[2] + (unit === '%' ? '%' : (mult > 1 ? unit[0] : '')) });
    }
    return out;
  }
  // The look's own checks: it is a real ES look, it passes validateLook with
  // this reel's team colour, and every word drawn has the contrast it needs
  // against what is under it (4.5:1 for reading text, 3:1 for accent and
  // signal display type; the kit's own paper pairings are left as they are).
  function lookChecks(timeline, { measure = null, layout = layoutBlock } = {}) {
    const out = [];
    const raw = timeline && timeline.look;
    const theme = themeOf(timeline);
    const name = theme.look.label;
    if (raw && !TH.LOOKS[raw]) out.push(issue('look', 'warning', `“${String(raw).slice(0, 24)}” is not an ES look, so this reel is drawn in Paper.`, 'Pick a look.'));
    // A team colour that cannot carry text is not used as the ground (the look
    // falls back to ink and keeps the colour for a pill and the wipe).
    if (theme.teamWeak) out.push(issue('look', 'info', `Text on this team colour (${theme.team}) would be under 4.5:1, so the reel stays on ink and uses the colour for a pill and the wipe.`, ''));
    TH.validateLook(theme.look, { team: theme.teamWeak ? '' : theme.team }).forEach(msg => out.push(issue('look', 'critical', `The ${name} look breaks an ES rule (${msg})`, 'Pick another look.')));
    if (theme.teamMissing) out.push(issue('look', 'info', 'The Team colour look needs a team. This reel has none, so it is drawn in ES blue.', 'Pick a team, or another look.'));
    const graphics = (timeline.tracks && timeline.tracks.graphics) || [];
    const blocks = graphics.map(g => (g.data && g.data.block) || null).filter(Boolean);
    if (theme.id === 'data' && blocks.filter(b => ['number', 'dots', 'compare'].includes(b.type)).length < 2) out.push(issue('look', 'info', 'Data-led works best with at least two number, dots or compare scenes.', 'Add a figure, or pick another look.'));
    if (theme.id === 'photo') {
      const bare = graphics.filter(g => g.data && g.data.block && BLOCKS[g.data.block.type].media && !g.media);
      if (bare.length) out.push(issue('look', 'info', `Photo-led: ${bare.length === 1 ? 'one scene has' : `${bare.length} scenes have`} no photo yet.`, 'Add a photo to each hook and statement.', bare[0].beat));
    }
    if (measure) {
      graphics.forEach((g, i) => {
        const b = g.data && g.data.block;
        if (!b) return;
        const S = theme.surfaceFor(b.type);
        const ops = layout(measure, g, timeline);
        const media = ops.filter(o => o.type === 'media');
        const panel = ops.find(o => o.type === 'panel');
        const seen = new Set();
        ops.forEach(op => {
          if ((op.type !== 'text' && op.type !== 'count') || op.noCheck) return;
          const box = opBox(op);
          const onPhoto = !op.fill && !op.on && media.some(mo => box.y + box.h > mo.y && box.y < mo.y + mo.h && box.x + box.w > mo.x && box.x < mo.x + mo.w);
          if (onPhoto) { if (!seen.has('photo')) out.push(issue('look', 'critical', `Beat ${i + 1}: “${String(op.text).slice(0, 24)}” sits on the photo without a box.`, 'Use boxed words over a photo.', g.beat)); seen.add('photo'); return; }
          const under = op.fill || op.on || (op.role === 'cta' && panel ? panel.fill : S.ground);
          const kit = !S.plate && ['paper', 'white'].includes(S.ground) && !op.fill && SIGNALS.includes(op.color);
          if (kit) return;
          const accent = SIGNALS.includes(op.color) || (!op.fill && op.color === (S.text.blue || 'blue') && op.color !== (S.text.ink || 'ink')) || (['blue', 'red', 'team'].includes(under) && !op.small); // boxed display words (64 px and up) on a colour
          const min = accent ? TH.ACCENT_MIN : TH.TEXT_MIN;
          let fg = colorOf(op.color, theme);
          const bg = colorOf(under, theme);
          if (op.alpha && op.alpha < 1) fg = TH.blend(fg, bg, op.alpha);
          const c = TH.contrast(fg, bg);
          const key = `${op.color}|${under}`;
          if (c < min && !seen.has(key)) { seen.add(key); out.push(issue('look', c < 2 ? 'critical' : 'warning', `Beat ${i + 1}: “${String(op.text).slice(0, 24)}” is ${op.color} on ${under} (${c.toFixed(1)}:1; it needs ${min}:1).`, 'Change the colour of the words, or pick another look.', g.beat)); }
        });
      });
    }
    return out;
  }
  // ─── v3 checks: one scale, one box language, one grid, element limits ───
  // What a frame holds: headline, picture, data block and pills (kicker,
  // label, tag, stamp, clip label). The data block's own legend and chips
  // are part of it.
  function elementsOf(block, graphic = {}) {
    const b = block || {};
    const e = { headline: 0, media: 0, data: 0, pills: 0 };
    const media = graphic && graphic.media ? 1 : 0;
    const t = b.type;
    if (b.kicker && t !== 'rankTile') e.pills += 1;
    if (t === 'hook') { e.headline = (b.pills || []).length ? 1 : 0; e.media = media; if (b.stamp) e.pills += 1; } else if (t === 'statement') { e.headline = 1; e.media = media; } else if (t === 'number' || t === 'compare') { e.data = 1; } else if (t === 'dots') { e.data = 1; if (b.note) e.pills += 1; } else if (t === 'quote') { e.headline = 1; if (b.who) e.pills += 1; } else if (t === 'photoCard') { e.headline = b.title ? 1 : 0; e.media = media; e.data = (b.tiles || []).length ? 1 : 0; if (b.label) e.pills += 1; if (b.tag) e.pills += 1; } else if (t === 'statTiles' || t === 'dotGrid' || t === 'streak') { e.headline = b.title ? 1 : 0; e.data = 1; if (b.tag) e.pills += 1; } else if (t === 'rankTile') { e.headline = b.title ? 1 : 0; e.data = 1; if (b.label) e.pills += 1; if (b.tag) e.pills += 1; } else if (t === 'tagPill') { e.headline = b.title ? 1 : 0; e.media = media; if (b.text) e.pills += 1; } else if (t === 'clipLabel') { e.media = media; if (b.text) e.pills += 1; if (b.sub) e.pills += 1; }
    return e;
  }
  // The op types the engine draws. Anything else (or a plain rectangle that
  // is not a scene's ground, a panel that is not the end card's) is a stray box.
  const KNOWN_OPS = new Set(['text', 'count', 'media', 'rect', 'panel', 'dots', 'dotgrid', 'bar', 'tile', 'square', 'logotype']);
  function v3Checks(timeline, { measure = null, layout = layoutBlock } = {}) {
    const out = [];
    const graphics = (timeline.tracks && timeline.tracks.graphics) || [];
    const geo = geometry(timeline.size);
    const style = TH.isStyle && TH.isStyle(timeline.reelStyle) ? TH.STYLES[timeline.reelStyle] : null;
    graphics.forEach((g, i) => {
      const b = g.data && g.data.block;
      if (!b) return;
      const label = `Beat ${i + 1}`;
      if (style && !style.blocks.includes(b.type)) out.push(issue('style', 'warning', `${label}: ${BLOCKS[b.type] ? BLOCKS[b.type].label : b.type} is not a ${style.label} block.`, `Use one of: ${style.blocks.map(t => BLOCKS[t].label).join(', ')}.`, g.beat));
      const el = elementsOf(b, g);
      Object.keys(ELEMENT_LIMITS).forEach(k => { if (el[k] > ELEMENT_LIMITS[k]) out.push(issue('elements', 'warning', `${label} has ${el[k]} ${k === 'pills' ? 'pills' : k === 'media' ? 'pictures' : `${k} elements`}. A frame holds a headline, one picture, one data block and two pills at most${k === 'pills' ? ', so the extra one is not drawn' : ''}.`, 'Drop one, or make it two scenes.', g.beat)); });
      if (!measure) return;
      const seen = new Set();
      const once = (key, make) => { if (!seen.has(key)) { seen.add(key); out.push(make()); } };
      layout(measure, g, timeline).forEach(op => {
        if (!KNOWN_OPS.has(op.type) || (op.type === 'rect' && op.role !== 'ground') || (op.type === 'panel' && op.role !== 'cta-panel')) once(`box:${op.type}:${op.role}`, () => issue('boxes', 'critical', `${label} draws a box the ES system does not have (${op.type}${op.role ? ` “${op.role}”` : ''}).`, 'Only ES pills, tiles, the photo card and the caption bar are boxes. Remove it.', g.beat));
        const isText = (op.type === 'text' || op.type === 'count') && !op.noCheck;
        if (isText && !onScale(op.size, geo.type)) once(`scale:${op.role}`, () => issue('scale', 'critical', `${label}: “${String(op.text).slice(0, 24)}” is ${Math.round(op.size)} px, off the type scale.`, `Use a step of the scale (${SCALE_STEPS.join(', ')}).`, g.beat));
        if (isText && op.shortened) once(`short:${op.role}`, () => issue('scale', 'warning', `${label}: “${String(op.text).slice(0, 24)}” was cut to fit at the smallest size.`, 'Shorten the words so they fit.', g.beat));
        if (isText && op.pill && op.role !== 'pill' && op.role !== 'line' && PILL_CHARS[op.pillSize] && plainVo(op.text).length > PILL_CHARS[op.pillSize]) once(`pill:${op.role}`, () => issue('pills', 'warning', `${label}: the pill “${String(op.text).slice(0, 24)}” is ${plainVo(op.text).length} characters. A size ${op.pillSize} pill holds about ${PILL_CHARS[op.pillSize]}.`, 'Shorten it.', g.beat));
        if (op.align === 'col') {
          const bx = op.box ? op.box.x : op.x;
          if (Math.abs(bx - geo.col.x) > 0.5) once(`col:${op.role}`, () => issue('slots', 'warning', `${label}: “${String(op.text || op.role).slice(0, 24)}” is off the column (x ${Math.round(bx)}, not ${geo.col.x}).`, 'Keep every part on the ES column.', g.beat));
        }
        if (op.slot && geo.slots[op.slot] != null) {
          const top = op.box ? op.box.y : (op.type === 'text' || op.type === 'count' ? op.y - TYPE.cap * op.size : op.y);
          if (Math.abs(top - geo.slots[op.slot]) > 0.5) once(`slot:${op.role}`, () => issue('slots', 'warning', `${label}: “${String(op.text || op.role).slice(0, 24)}” is not on its slot (y ${Math.round(top)}, not ${geo.slots[op.slot]}).`, 'Let the block place it.', g.beat));
        }
      });
    });
    if (style && style.media && style.media.clipsMin > 0) {
      const scenes = graphics.filter(g => g.data && g.data.block && g.data.block.type !== 'endcard');
      const clips = scenes.filter(g => (timeline.tracks.video || []).some(v => v.beat === g.beat && v.asset && timeline.assets && timeline.assets[v.asset] && timeline.assets[v.asset].kind === 'clip')).length;
      if (scenes.length && clips / scenes.length < style.media.clipsMin) out.push(issue('style', 'info', `${style.label} works best with clips on most scenes (${clips} of ${scenes.length} have one).`, 'Add verified clips, or pick Receipts or Stat Card.'));
    }
    return out;
  }
  // timeline: an ES timeline (graphics carry data.block). opts: { boxes, measure, layout }
  function checks(timeline, { boxes = null, measure = null, layout = layoutBlock } = {}) {
    const out = [];
    const graphics = timeline.tracks.graphics || [];
    const label = i => `Beat ${i + 1}`;
    // Safe frame.
    if (Array.isArray(boxes)) {
      const seen = new Set();
      boxes.filter(b => outsideSafe(b, timeline.size)).forEach(b => {
        const key = `${b.beat}:${b.role}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(issue('safe-frame', 'critical', `“${String(b.text || b.role).slice(0, 24)}” is outside the safe frame (no words above y 300, within 40 px of the sides, or below y 1640).`, 'Shorten the words or pick a smaller block.', b.beat));
      });
    }
    graphics.forEach((g, i) => {
      const b = g.data.block;
      const beat = timeline.beats[i] || {};
      if (!b) return;
      // Signal colours.
      const sig = signalsIn(b, beat.vo);
      if (sig.length > LIMITS.signalsPerBeat) out.push(issue('signals', 'critical', `${label(i)} uses ${sig.length} signal colours (${sig.join(', ')}). Two at most: if everything is highlighted, nothing is.`, 'Keep green and red for meaning; drop one.', g.beat));
      (b.lines || []).forEach(l => { if (l.color === 'yellow') out.push(issue('signals', 'warning', `${label(i)}: yellow is for caption emphasis only.`, 'Use ink, blue, green or red for the line.', g.beat)); });
      // Copy lengths.
      (b.pills || []).forEach(p => { if (p.text.length > LIMITS.pillChars && !(p.size && p.size <= 110)) out.push(issue('copy', 'warning', `${label(i)}: the pill “${p.text.slice(0, 24)}” is ${p.text.length} characters. Keep pills to about ${LIMITS.pillChars}.`, 'Shorten it, or split it into two pills.', g.beat)); });
      if (b.type === 'hook' && !(b.pills || []).length) out.push(issue('copy', 'critical', `${label(i)}: the hook has no pills.`, 'Add one to three short pills that state the tension.', g.beat));
      if (b.type === 'statement') {
        if (!(b.lines || []).length) out.push(issue('copy', 'critical', `${label(i)}: the statement has no lines.`, 'Add one to three short lines.', g.beat));
        if ((b.lines || []).length > LIMITS.lines) out.push(issue('copy', 'warning', `${label(i)}: ${b.lines.length} lines. A statement has 1 to 3.`, 'Cut a line, or make it two scenes.', g.beat));
        (b.lines || []).forEach(l => { if (plainVo(l.text).length > LIMITS.lineChars) out.push(issue('copy', 'warning', `${label(i)}: the line “${l.text.slice(0, 24)}” is ${l.text.length} characters. Keep lines under ${LIMITS.lineChars}.`, 'Shorten it or split it.', g.beat)); });
      }
      if (b.type === 'quote') {
        if (b.text.length > LIMITS.quoteChars) out.push(issue('copy', 'warning', `${label(i)}: the quote is ${b.text.length} characters. Keep it under ${LIMITS.quoteChars}.`, 'Use the strongest part of what they said, word for word.', g.beat));
        if (!b.who) out.push(issue('copy', 'warning', `${label(i)}: the quote doesn't say who said it.`, 'Add the speaker under “Who”.', g.beat));
      }
      if (b.type === 'compare' && ((b.items || []).length < LIMITS.compareMin || (b.items || []).length > LIMITS.compareMax)) out.push(issue('copy', 'warning', `${label(i)}: compare shows ${(b.items || []).length} items. Use 2 to 4.`, 'Add or remove an item.', g.beat));
      if (b.type === 'dots' && b.count > LIMITS.dotsMax) out.push(issue('copy', 'warning', `${label(i)}: ${b.count.toLocaleString('en-US')} dots. The block draws up to ${LIMITS.dotsMax.toLocaleString('en-US')}.`, 'Show the scale another way (a number block), or a smaller share.', g.beat));
      if (b.type === 'number' && String(Math.round(Math.abs(b.value))).length > LIMITS.digits) out.push(issue('copy', 'warning', `${label(i)}: the number has more than ${LIMITS.digits} digits.`, 'Use M or K, as the voiceover says it.', g.beat));
      // Numbers as spoken.
      if (b.type !== 'endcard' && beat.vo) {
        const said = numberTokens(plainVo(beat.vo));
        const shown = blockStrings(b).flatMap(numberTokens);
        shown.forEach(n => {
          if (!said.length) return;
          // A year on screen ("2011 · GB") is a label, not a figure to speak.
          if (/^(?:19|20)\d\d$/.test(n.raw)) return;
          const same = said.find(s => Math.abs(s.value - n.value) < 1e-9);
          if (!same) out.push(issue('as-spoken', 'warning', `${label(i)} shows ${n.raw}, but the voiceover doesn't say it.`, 'Show numbers exactly as the voiceover says them.', g.beat));
          else if (same.form.replace(/,/g, '') !== n.form.replace(/,/g, '') || (/,/.test(same.raw) !== /,/.test(n.raw) && n.value >= 10000)) out.push(issue('as-spoken', 'warning', `${label(i)} shows ${n.raw}; the voiceover says ${same.raw}.`, `Show it as “${same.raw}”.`, g.beat));
        });
      }
      // Banned: emoji in on-screen words.
      if (blockStrings(b).some(t => EMOJI.test(t))) out.push(issue('banned', 'critical', `${label(i)} has an emoji on screen. The ES system never uses emoji.`, 'Remove it.', g.beat));
    });
    // End card: present, last, with a source.
    const ends = graphics.map((g, i) => (g.data.block && g.data.block.type === 'endcard' ? i : -1)).filter(i => i >= 0);
    if (!ends.length) out.push(issue('endcard', 'critical', 'The reel has no end card.', 'The ES end card closes every reel (it is added for you when you rebuild).'));
    else if (ends[ends.length - 1] !== graphics.length - 1 || ends.length > 1) out.push(issue('endcard', 'critical', 'The end card is not the last scene.', 'Move the end card to the end.', graphics[ends[0]].beat));
    else {
      const e = graphics[ends[0]];
      if (Math.abs(e.outMs - e.inMs - LIMITS.endcardMs) > 40) out.push(issue('endcard', 'warning', 'The reel should end 3 s after the end card starts.', 'Rebuild the reel.', e.beat));
    }
    if (!String(timeline.sourceLine || '').trim()) out.push(issue('source', 'critical', 'The end card has no source line.', 'Every claim has a source: add it on the end card (for example “Source: ESPN”).', ends.length ? graphics[ends[0]].beat : ''));
    // Frame one says something.
    const g0 = graphics[0];
    if (!g0 || g0.inMs > 0 || !g0.data.block || !blockStrings(g0.data.block).filter(t => !/^(?:WE BRING|THE RECEIPTS\.)$/i.test(t)).length || g0.data.block.type === 'endcard') {
      out.push(issue('frame-one', 'critical', 'Frame one is empty. It must already say something.', 'Give the hook one to three pills.', g0 ? g0.beat : ''));
    } else if (g0.data.block.type !== 'hook') out.push(issue('frame-one', 'warning', 'The reel does not open on a hook block.', 'Make beat 1 a hook.', g0.beat));
    else if (g0.media) out.push(issue('frame-one', 'info', 'Frame one has a photo: check it shows who it is (face, number or jersey).', '', g0.beat));
    // Banned drawing: left-edge accent stripes, gradients or glow on text.
    if (measure) {
      graphics.forEach((g, i) => {
        const ops = layout(measure, g, timeline);
        if (ops.some(o => (o.type === 'rect' || o.type === 'panel' || (o.type === 'bar' && o.role !== 'bar')) && o.x <= 120 && o.w <= 24 && o.h >= 60)) out.push(issue('banned', 'critical', `${label(i)} has a left-edge accent stripe.`, 'Remove the stripe: premium comes from flat 2D motion.', g.beat));
        if (ops.some(o => o.glow || o.gradient || o.shadow)) out.push(issue('banned', 'critical', `${label(i)} has glow or a gradient on text.`, 'Flat colour only.', g.beat));
      });
    }
    // The look: on brand and readable.
    out.push(...lookChecks(timeline, { measure, layout }));
    // v3: the type scale, boxes, grid, element limits and the style's blocks.
    out.push(...v3Checks(timeline, { measure, layout }));
    return out;
  }
  // The system's checklist, one row per rule, for the Quality checks panel.
  const CHECKLIST = [
    { id: 'safe-frame', ok: 'Safe frame', bad: 'Words outside the safe frame' },
    { id: 'frame-one', ok: 'Frame one says something', bad: 'Frame one' },
    { id: 'signals', ok: 'Two signal colours at most', bad: 'Signal colours' },
    { id: 'copy', ok: 'Pills, lines and quotes short', bad: 'Copy length' },
    { id: 'as-spoken', ok: 'Numbers as spoken', bad: 'Numbers as spoken' },
    { id: 'endcard', ok: 'End card last, 3 s', bad: 'End card' },
    { id: 'source', ok: 'Source on the end card', bad: 'Source missing' },
    { id: 'banned', ok: 'No emoji, stripes or glow', bad: 'Banned item' },
    { id: 'look', ok: 'Look on brand and readable', bad: 'Look' },
    { id: 'scale', ok: 'Every size on the type scale', bad: 'Type scale' },
    { id: 'boxes', ok: 'No stray boxes', bad: 'Stray box' },
    { id: 'slots', ok: 'Everything on the grid', bad: 'Off the grid' },
    { id: 'elements', ok: 'One idea a frame', bad: 'Too much in a frame' },
    { id: 'pills', ok: 'Pills short', bad: 'Pill length' },
    { id: 'style', ok: 'Blocks fit the style', bad: 'Style' },
  ];
  function checklist(issues) {
    return CHECKLIST.map(row => {
      const hits = (issues || []).filter(i => i.id === row.id && i.severity !== 'info');
      return { id: row.id, ok: !hits.length, label: hits.length ? row.bad : row.ok, n: hits.length, severity: hits.some(h => h.severity === 'critical') ? 'critical' : (hits.length ? 'warning' : '') };
    });
  }

  // ─── Guidelines (plain English, for the help panel) ────────────────────
  const GUIDELINES = [
    { title: 'Your script, your words', items: ['You bring the script and the voiceover. Reels Studio splits your words into scenes and never rewrites them.', 'With no voiceover yet, scenes are timed at about 2.6 words a second. Those times are estimates until the voice is recorded.'] },
    { title: 'Seven blocks', items: ['Hook: the first 3 to 6 seconds, two or three pills, readable at frame one. An optional one-word stamp slams in.', 'Statement: 1 to 3 short lines. Number: one number that counts up. Dots: scale, up to 2,600 dots. Compare: 2 to 4 bars. Quote: the exact words and who said them.', 'End card: always last. "We bring the receipts", the ES logotype and the source line. The reel ends 3 seconds later.'] },
    { title: 'Colour and type', items: ['ES blue, ink and paper. Green, red and yellow only mean something (win, loss, emphasis), and never more than two in one scene.', 'Condensed black capitals for display, Roboto for small text. Boxed words hug their letters.'] },
    { title: 'Layout', items: ['No words above y 300, within 40 px of the sides, or below y 1640. Turn on Safe zones to see the frame.', 'Captions sit on one line at y 1172, cut on 1 to 3 words at a time. Wrap a word in *asterisks* in the voiceover to make it yellow.', 'The ES mark sits top right on the hook and the end card only. The logotype is on the end card only. Never the round ES icon.'] },
    { title: 'Motion', items: ['Entrances take 0.35 to 0.45 s, from the left or from below. Every cut is the blue-then-ink slab wipe.', 'Photos drift slowly. No spins, bounces, 3D, glow, gradients on text, left-edge stripes or emoji.'] },
    { title: 'Looks', items: ['Eight looks, one system: Paper, Ink, Blue, Team colour, Photo-led, Data-led, Minimal and Bold. Each changes the ground and colours; fonts, the safe frame, the ES mark, the slab wipe and the end card never change.', 'Team colour uses one team colour as an accent; when a colour cannot carry text, the reel stays on ink and keeps the colour for pills and the wipe.'] },
    { title: 'Your own voice and media', items: ['Record or upload your voiceover (up to 90 s). It is matched to your script scene by scene, and your words are never changed.', 'Drop, paste or pick photos and clips anywhere; they go to the scenes in order, and you can move them.'] },
    { title: 'Before you post', items: ['Numbers on screen exactly as the voiceover says them. Every claim has a source on the end card.', 'Export the MP4 here: it renders in your browser at 1080x1920, 30 fps, with your voiceover.'] },
  ];

  return {
    TOKENS, SIGNALS, COLOR_NAMES, TYPE, MOTION, LIMITS, DEFAULT_CTA, GEO, BLOCKS, BLOCK_TYPES, KIND_FOR, BLOCK_FOR_KIND, TEMPLATES, MARK_BLOCKS, GUIDELINES, CHECKLIST,
    // Looks (reel-es-themes.js)
    LOOKS: TH.LOOKS, LOOK_IDS: TH.LOOK_IDS, DEFAULT_LOOK: TH.DEFAULT_LOOK, LOOK_LAYOUTS: TH.LAYOUTS, LOOK_MOTIONS: TH.MOTIONS, themes: TH,
    themeOf, validateLook: TH.validateLook, lookForStyle: TH.lookForStyle, inkOn, drawGround, drawPaper, markVariantFor, lookChecks,
    ease, geometry, displayFont, smallFont, colorOf, splitLines, fitLines, cleanBlock, blockOf, takesMedia, numberDisplay, blockStrings, blockText, legacyFields, signalsIn,
    parseEmphasis, plainVo, headline, scriptSentences, splitLong, blockForLine, scriptToPlan, voMatchesScript,
    hugBox, rotatedBox, layoutBlock, layoutCaption, textBoxes, outsideSafe, markRect, numberTokens,
    enterState, sceneTimes, slabs, drawSlab, drawMark, drawCaption, drawFrame, drawScene, checks, checklist,
    // Reels Studio v3
    TYPE_SCALE, STEP_NAMES, SCALE_STEPS, SPACE, GRID, PILL_SIZES, PILL_CHARS, ELEMENT_LIMITS, GREY, KNOWN_OPS,
    STYLES: TH.STYLES, STYLE_IDS: TH.STYLE_IDS, DEFAULT_STYLE: TH.DEFAULT_STYLE, styleOf: TH.styleOf, legacyStyle: TH.legacyStyle, isStyle: TH.isStyle, getStyle: TH.getStyle, hasClips: TH.hasClips,
    snapStep, stepName, onScale, pickStep, pillMetricsAt, pillClass, focusBox, faceBox, focusCrop, tileNumber, elementsOf, v3Checks, showsMark, marksIn, markLines, emTokens,
  };
}));
