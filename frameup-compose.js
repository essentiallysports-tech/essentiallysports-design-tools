/*
 * FrameUp Compose: Generate's "Creative" output. A composed design is a JSON
 * scene spec (canvas size + ordered layers) that this file builds from a
 * composition archetype, checks against the ES guidelines, and draws on a
 * canvas (the Generate preview and the 1080+ export use the same code).
 *
 *   FrameUpCompose.ARCHETYPES            the composition library (29 recipes)
 *   FrameUpCompose.fits(id, input)       can this archetype be made from it?
 *   FrameUpCompose.build(id, input, v)   -> scene (v = variant 0..2)
 *   FrameUpCompose.candidates(id, input) -> 2-3 scenes (variants)
 *   FrameUpCompose.makePalette(colors)   -> palette from team / league colours
 *   FrameUpCompose.checkScene(scene)     -> { ok, errors, fixes } (ES guideline gate)
 *   FrameUpCompose.applyFix(scene, op)   -> scene (the art director's one fix)
 *   FrameUpCompose.render(scene, canvas, { scale }) -> report (browser only)
 *   FrameUpCompose.scoreReport(report)   -> free heuristic score (0-5) + issues
 *
 * Layers: background, photo, cutout, text, number, shape, logo, chart, pill.
 * Effects (layer.fx): shadow, glow, inner shadow, opacity, blend, rotate,
 * 3D tilt. Photo / cut-out treatments: duotone and tritone gradient maps with
 * an S-curve, auto levels, depth blur, newsprint halftone, gradient (fade)
 * masks, shape masks, vignette, rim light and die-cut sticker edges on
 * cut-outs, photo-in-type knockouts. Shapes add light leaks, starbursts,
 * gauges, film sprockets, ticket perforations and foil sheen. Type is set on
 * cap-height boxes with size-aware tracking, balanced lines and no widows; a
 * render-time contrast guard recolours (flat field) or scrims (busy photo)
 * any text that measures under 3:1 (4.5:1 small). Fonts are ES only
 * (Acumin Pro Condensed for display, Roboto Condensed for labels, Roboto for
 * body). The ES logo is never a free layer: the renderer always draws the ES
 * mark top-right (top-left with a swipe button), 122x104, 50px in, last.
 * UMD: window.FrameUpCompose in the browser, module.exports under Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpCompose = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '2026-11-19-v2';
  const SIZES = { portrait: { w: 1080, h: 1350 }, story: { w: 1080, h: 1920 }, square: { w: 1080, h: 1080 } };
  const SAFE = 50;
  const LOGO = { w: 122, h: 104 };
  const FONTS = {
    display: '"Acumin Pro Condensed Local", "Acumin Pro Condensed Web", "Roboto Condensed", "Arial Narrow", sans-serif',
    condensed: '"Roboto Condensed", "Acumin Pro Condensed Local", "Arial Narrow", sans-serif',
    body: 'Roboto, "Roboto Condensed", Arial, sans-serif',
  };
  const FONT_WEIGHT = { display: 700, condensed: 800, body: 500 };
  const LAYER_TYPES = ['background', 'photo', 'cutout', 'text', 'number', 'shape', 'logo', 'chart', 'pill'];
  const ROLES = ['kicker', 'headline', 'highlight', 'body', 'number', 'label', 'quote', 'name'];
  const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'lighten', 'darken', 'color-dodge'];
  const MAX_LAYERS = 34;
  // Effect limits the gate enforces (pro finish, never at the cost of reading).
  const FX_LIMITS = {
    textRotate: 8, imageRotate: 12, skew: 0.12, photoBlur: 28, grain: 0.14, texture: 0.26, leak: 0.6, glowAlpha: 0.85, glowBlur: 100,
    mist: 0.9, minType: 22,
  };
  // Fixes the art director may ask for (one round, applied in code).
  const FIXES = ['bigger-number', 'bigger-headline', 'shorter-headline', 'darker-mist', 'more-contrast', 'less-clutter', 'swap-palette', 'move-headline-up', 'brighten-photo', 'darken-photo', 'more-depth', 'add-scrim'];
  // ES vector art (no AI, free): the zero-cost stand-in for concept art.
  const PROC_ART = ['trophy', 'golf-ball', 'football', 'basketball', 'lights', 'cards', 'money'];

  // ─── Colour helpers ─────────────────────────────────────────────────────
  const hexRe = /^#[0-9a-f]{6}$/i;
  const normHex = value => {
    const text = String(value || '').trim();
    if (/^#[0-9a-f]{3}$/i.test(text)) return `#${text.slice(1).split('').map(c => c + c).join('')}`.toUpperCase();
    return hexRe.test(text) ? text.toUpperCase() : '';
  };
  const rgb = hex => {
    const h = normHex(hex) || '#000000';
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  };
  const toHex = ([r, g, b]) => `#${[r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
  const lum = hex => {
    const [r, g, b] = rgb(hex).map(v => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const sat = hex => {
    const [r, g, b] = rgb(hex).map(v => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  };
  const rgba = (hex, alpha) => `rgba(${rgb(hex).join(',')},${alpha})`;

  const ES = { blue: '#0A7DFA', navy: '#033162', black: '#000000', white: '#FFFFFF', ink: '#111111', paper: '#F4F2EE', grey: '#9AA3AE' };

  // A palette from up to three brand colours (team kit, logo library, league).
  // Roles: bg (dark field), bg2 (second field), ink (text on bg), accent
  // (highlight / numbers on bg), paper (light band), paperInk, mist (bg at 90%).
  // allowed: every colour the scene may use (the palette, its shades, ES colours).
  function makePalette(colors = [], { name = '', mode = 'dark' } = {}) {
    const list = colors.map(normHex).filter(Boolean);
    const base = list.length ? list : [ES.navy, ES.blue];
    const byDark = [...base].sort((a, b) => lum(a) - lum(b));
    let bg = byDark[0];
    // A field needs to be dark enough for white type; deepen bright team colours.
    if (lum(bg) > 0.08) bg = mix(bg, '#000000', lum(bg) > 0.3 ? 0.72 : 0.45);
    const accentPool = base.filter(c => contrast(c, bg) >= 3).sort((a, b) => (sat(b) + lum(b) * 0.4) - (sat(a) + lum(a) * 0.4));
    let accent = accentPool[0] || (contrast(ES.blue, bg) >= 3 ? ES.blue : '#FFFFFF');
    if (normHex(accent) === normHex(bg)) accent = '#FFFFFF';
    const accent2 = accentPool.find(c => c !== accent) || mix(accent, '#FFFFFF', 0.35);
    const ink = contrast('#FFFFFF', bg) >= contrast('#000000', bg) ? '#FFFFFF' : '#000000';
    const lightPool = base.filter(c => lum(c) > 0.45);
    const paper = lightPool[0] && sat(lightPool[0]) > 0.25 ? lightPool[0] : ES.paper;
    const paperInk = contrast(bg, paper) >= 4.5 ? bg : '#000000';
    const bg2 = mix(bg, accent, 0.18);
    const palette = { name: name || 'ES', bg, bg2, ink, accent, accent2, paper, paperInk, mist: bg, mode };
    if (mode === 'light') Object.assign(palette, { bg: paper, ink: paperInk, paper: bg, paperInk: ink, bg2: mix(paper, accent, 0.12) });
    finishPalette(palette, base);
    // Variants and the swap-palette fix draw with the flipped palette: allow its roles too.
    palette.allowed = flipPalette(palette).allowed;
    return palette;
  }
  // Derived roles every archetype can lean on, all contrast-checked:
  //   onAccent  text on an accent block (pills, bands): the best of bg / white / black
  //   inkSoft   secondary text on bg (ink pulled 25% toward bg, still >= 4.5:1)
  //   deep      a darker bg for depth (vignettes, under-bands)
  //   tone      tritone ramp for photos: deep shadow, team colour mid, light
  //   rim       rim-light colour for cut-outs (the accent, lifted)
  function finishPalette(p, base = []) {
    const best = (on, list) => list.slice().sort((a, b) => contrast(b, on) - contrast(a, on))[0];
    // Team colour on the accent when it reads (purple on gold), else the best of black / white.
    p.onAccent = contrast(p.bg, p.accent) >= 4.5 ? p.bg : best(p.accent, [p.bg, '#FFFFFF', '#000000']);
    p.inkSoft = contrast(mix(p.ink, p.bg, 0.25), p.bg) >= 4.5 ? mix(p.ink, p.bg, 0.25) : p.ink;
    p.deep = mix(p.bg, '#000000', 0.45);
    p.rim = mix(p.accent, '#FFFFFF', 0.35);
    p.tone = [mix(p.bg, '#000000', 0.55), sat(p.accent) > 0.35 ? mix(p.accent, p.bg, 0.35) : mix(p.bg, '#FFFFFF', 0.35), mix(p.accent, '#FFFFFF', 0.82)];
    const shades = [];
    base.concat([p.bg, p.accent, p.accent2, p.paper]).forEach(c => [0.2, 0.45, 0.7].forEach(t => shades.push(mix(c, '#000000', t), mix(c, '#FFFFFF', t))));
    // Panel tints: the field lifted toward its ink / accent (cards, tracks, slabs).
    for (let k = 0; k <= 12; k += 1) shades.push(mix(p.bg, p.ink, 0.04 + k * 0.02));
    [0.08, 0.12, 0.18, 0.28, 0.35].forEach(t => shades.push(mix(p.bg, p.accent, t), mix(p.accent, p.bg, t)));
    p.allowed = [...new Set([...base, p.bg, p.bg2, p.ink, p.accent, p.accent2, p.paper, p.paperInk, p.onAccent, p.inkSoft, p.deep, p.rim, ...p.tone, ES.blue, ES.black, ES.white, ES.ink, ES.paper, ES.navy, ES.grey, '#000000', '#FFFFFF', ...shades, ...(p.allowed || [])].filter(Boolean).map(normHex))];
    return p;
  }
  // The same palette, light/dark swapped (a variant and the swap-palette fix).
  function flipPalette(p) {
    const flipped = { ...p, bg: p.paper, ink: p.paperInk, paper: p.bg, paperInk: p.ink, bg2: mix(p.paper, p.accent, 0.12), mode: p.mode === 'light' ? 'dark' : 'light' };
    if (contrast(flipped.accent, flipped.bg) < 2.6) flipped.accent = contrast(p.bg, flipped.bg) >= 3 ? p.bg : flipped.ink;
    return finishPalette(flipped, []);
  }

  // ─── Small text helpers ─────────────────────────────────────────────────
  const clean = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim();
  const upper = value => clean(value).toUpperCase();
  const words = value => clean(value).split(' ').filter(Boolean);
  const squashed = value => clean(value).toLowerCase();
  const digitsIn = text => (String(text || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []);

  // ─── Inputs ─────────────────────────────────────────────────────────────
  // input = {
  //   size: 'portrait'|'story'|'square', palette, sport,
  //   kicker, headline, highlight: [words], body, label,
  //   number: { prefix, value, suffix, label, factId },     // the hero number
  //   numbers: [{ value, display, label, factId }],          // grids / charts
  //   compare: { title, a: { label, value, display }, b: {...}, unit },
  //   score: { a: { name, value, logo }, b: { name, value, logo }, tag },
  //   record: { value, label, logo },
  //   quote: { text, by },
  //   photo: { src, focus: {x, y} }, photos: [{ src, label, focus }],
  //   cutout: { src }, art: { src } ('proc:trophy' = ES vector art),
  //   logos: [{ src, name }], sides: [{ title, number, label, logo, photo, palette }],
  //   facts: [{ id, text, source }], swipe: false,
  // }
  const has = {
    number: i => Boolean(i.number?.value),
    numbers: (i, n) => (i.numbers || []).filter(x => x?.display || x?.value).length >= n,
    photo: i => Boolean(i.photo?.src),
    photos: (i, n) => (i.photos || []).filter(x => x?.src).length >= n,
    cutout: i => Boolean(i.cutout?.src),
    art: i => Boolean(i.art?.src),
    compare: i => Boolean(i.compare?.a?.value && i.compare?.b?.value),
    score: i => Boolean(i.score?.a?.value && i.score?.b?.value),
    record: i => Boolean(i.record?.value),
    quote: i => Boolean(i.quote?.text),
    sides: i => (i.sides || []).filter(s => s?.number?.value || s?.title).length >= 2,
    headline: i => Boolean(clean(i.headline)),
    units: i => {
      const n = Number(String(i.number?.value || '').replace(/,/g, ''));
      return Number.isInteger(n) && n >= 8 && n <= 200 && !i.number?.prefix && !i.number?.suffix;
    },
  };

  // Common pieces every archetype uses.
  function frame(input) {
    const size = SIZES[input.size] || SIZES.portrait;
    let palette = input.palette?.allowed ? input.palette : makePalette(input.palette?.colors || []);
    if (!palette.onAccent) palette = finishPalette({ ...palette }, []);
    return { W: size.w, H: size.h, p: palette };
  }
  const kickerPill = (input, p, x = SAFE, y = SAFE + 12, opts = {}) => (clean(input.kicker) ? {
    type: 'pill', role: 'kicker', text: upper(input.kicker), x, y, h: opts.h || 58, color: opts.color || p.onAccent, bg: opts.bg || p.accent, maxW: opts.maxW || 700, align: opts.align || 'left',
  } : null);
  // ES mist: the team colour, peaking at exactly 90% (SM-04). strength is kept
  // for old callers but never exceeds the guideline.
  const mist = (W, H, p, from = 0.45, strength = 0.9, color = null) => {
    const peak = Math.min(FX_LIMITS.mist, strength);
    return { type: 'shape', shape: 'gradient', mist: true, x: 0, y: Math.round(H * from), w: W, h: H - Math.round(H * from), color: color || p.mist, stops: [[0, 0], [0.42, peak * 0.62], [0.7, peak * 0.92], [1, peak]] };
  };
  const headlineText = (input, p, box, opts = {}) => ({
    type: 'text', role: 'headline', text: upper(input.headline), ...box,
    font: 'display', size: opts.size || 150, minSize: opts.minSize || 56, maxLines: opts.maxLines || 3, lineHeight: opts.lineHeight || 0.9,
    color: opts.color || p.ink, align: opts.align || 'left', valign: opts.valign || 'bottom',
    highlight: { words: (input.highlight || []).map(upper), color: opts.highlightColor || p.accent },
    ...(opts.box ? { box: opts.box } : {}),
    ...(opts.fx ? { fx: opts.fx } : {}),
  });
  const numberLayer = (n, box, color, opts = {}) => ({
    type: 'number', role: 'number', prefix: clean(n.prefix), value: clean(n.value), suffix: clean(n.suffix), label: upper(opts.noLabel ? '' : n.label),
    factId: n.factId || '', ...box, color, unitColor: opts.unitColor || color, labelColor: opts.labelColor || color,
    align: opts.align || 'left', size: opts.size || 600, labelSize: opts.labelSize || 40, ...(opts.fx ? { fx: opts.fx } : {}),
  });
  const grain = (opacity = 0.08) => ({ type: 'shape', shape: 'grain', x: 0, y: 0, w: 0, h: 0, opacity });

  // ─── The composition library ────────────────────────────────────────────
  // Each archetype: id, name, what it is, focal element, needs (fits), and a
  // build(input, variant) that returns layers. Variants: 0 default, 1 mirrored
  // or re-cropped, 2 palette swap / alternate emphasis.
  const ARCHETYPES = [
    {
      id: 'hero-number', name: 'Hero cut-out + giant number', focal: 'athlete',
      about: 'A player cut out in front of a giant stat number, headline low.',
      needs: 'a person with an ES photo (cut out) + one number',
      kinds: ["count", "money", "pct", "person"],
      fits: i => has.cutout(i) && has.number(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const mirror = v === 1;
        const pal = v === 2 ? flipPalette(p) : p;
        const numBox = { x: SAFE, y: 150, w: W - SAFE * 2, h: 620 };
        return [
          { type: 'background', fill: { kind: 'radial', colors: [pal.bg2, pal.bg], at: { x: mirror ? 0.3 : 0.7, y: 0.35 } }, texture: 'halftone', textureColor: pal.accent, textureOpacity: 0.16 },
          numberLayer(input.number, numBox, pal.accent, { align: mirror ? 'left' : 'right', size: 640, noLabel: true, fx: { opacity: 0.96 } }),
          { type: 'cutout', src: input.cutout.src, x: mirror ? 280 : 0, y: 210, w: 800, h: H - 210, anchor: 'bottom', fx: { shadow: { color: '#000000', blur: 40, x: 0, y: 18, alpha: 0.55 } } },
          mist(W, H, pal, 0.62, 0.95),
          kickerPill(input, pal),
          headlineText(input, pal, { x: SAFE, y: H - 440, w: W - SAFE * 2, h: 260 }, { size: 140, maxLines: 2 }),
          { type: 'text', role: 'label', text: upper(input.number.label), x: SAFE, y: H - SAFE - 92, w: W - SAFE * 2, h: 60, font: 'condensed', size: 40, minSize: 26, maxLines: 1, color: pal.accent, align: 'left', tracking: 2 },
          { type: 'shape', shape: 'rect', x: SAFE, y: H - SAFE - 18, w: 160, h: 10, color: pal.accent },
          grain(0.07),
        ];
      },
    },
    {
      id: 'prize-poster', name: 'Prize focus', focal: 'art',
      about: 'The prize (trophy, cheque, cards) as hero art with the money number over it.',
      needs: 'a money / prize number (+ concept art)',
      kinds: ["money"],
      fits: i => has.number(i) && (has.art(i) || has.photo(i)),
      build(input, v) {
        const { W, H, p } = frame(input);
        const pal = v === 2 ? flipPalette(p) : p;
        const art = input.art?.src || input.photo.src;
        const isArt = Boolean(input.art?.src);
        const artBox = v === 1 ? { x: 140, y: 110, w: 800, h: 660 } : { x: 190, y: 130, w: 700, h: 620 };
        return [
          { type: 'background', fill: { kind: 'radial', colors: [mix(pal.bg, pal.accent, 0.28), pal.bg], at: { x: 0.5, y: 0.4 } }, texture: 'rays', textureColor: pal.accent, textureOpacity: 0.12 },
          isArt
            ? { type: 'photo', role: 'art', src: art, ...artBox, mask: 'none', fit: 'contain', fx: { glow: { color: pal.accent, blur: 90, alpha: 0.55 } } }
            : { type: 'photo', src: art, x: 0, y: 0, w: W, h: 980, mask: 'rect', duotone: [pal.bg, pal.accent], fx: { opacity: 0.75 } },
          mist(W, H, pal, 0.5, 0.96),
          kickerPill(input, pal),
          numberLayer(input.number, { x: SAFE, y: v === 1 ? 640 : 690, w: W - SAFE * 2, h: 420 }, pal.ink, { align: 'center', size: 440, unitColor: pal.accent, labelColor: pal.accent, labelSize: 42, fx: { shadow: { color: '#000000', blur: 34, x: 0, y: 12, alpha: 0.55 } } }),
          headlineText(input, pal, { x: SAFE, y: H - SAFE - 180, w: W - SAFE * 2, h: 180 }, { size: 96, maxLines: 2, align: 'center' }),
          ...(input.logos?.[0]?.src ? [{ type: 'logo', kind: 'league', src: input.logos[0].src, x: SAFE, y: H - SAFE - 230, w: 0, h: 0, hidden: true }] : []),
          grain(0.08),
        ];
      },
    },
    {
      id: 'big-number', name: 'Big-number poster', focal: 'number',
      about: 'A single number fills the poster; a short line explains it.',
      needs: 'one number',
      kinds: ["count", "money", "pct", "record"],
      fits: i => has.number(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const pal = v === 1 ? flipPalette(p) : p;
        const photo = has.photo(input) && v !== 2;
        return [
          { type: 'background', fill: { kind: 'solid', colors: [pal.bg] }, texture: 'grain', textureOpacity: 0.1 },
          ...(photo ? [{ type: 'photo', src: input.photo.src, focus: input.photo.focus, x: 0, y: 0, w: W, h: H, mask: 'rect', duotone: [pal.bg, mix(pal.bg, pal.ink, 0.55)], fx: { opacity: 0.38, blend: pal.mode === 'light' ? 'multiply' : 'screen' } }] : []),
          { type: 'shape', shape: 'rect', x: SAFE, y: 220, w: 14, h: 520, color: pal.accent },
          kickerPill(input, pal),
          numberLayer(input.number, { x: SAFE + 40, y: 200, w: W - SAFE * 2 - 40, h: 600 }, pal.accent, { size: 640, labelColor: pal.ink, labelSize: 48 }),
          { type: 'shape', shape: 'rect', x: SAFE, y: 880, w: W - SAFE * 2, h: 4, color: pal.ink, opacity: 0.5 },
          headlineText(input, pal, { x: SAFE, y: 910, w: W - SAFE * 2, h: 330 }, { size: 130, maxLines: 3, valign: 'top' }),
          ...(clean(input.body) ? [{ type: 'text', role: 'body', text: clean(input.body), x: SAFE, y: H - SAFE - 60, w: W - SAFE * 2, h: 60, font: 'body', size: 34, minSize: 24, maxLines: 2, color: pal.ink, align: 'left', valign: 'bottom', fx: { opacity: 0.85 } }] : []),
        ];
      },
    },
    {
      id: 'split-versus', name: 'Split screen', focal: 'contrast',
      about: 'Two sides on a diagonal split: two stories, teams or players, each with its number.',
      needs: 'two stories, teams or players, each with a number',
      kinds: ["money", "count"],
      fits: i => has.sides(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const [a, b] = input.sides;
        const pa = a.palette?.allowed ? a.palette : p;
        const pb = b.palette?.allowed ? b.palette : flipPalette(p);
        const cut = v === 1 ? [[0, 0], [W, 0], [W, 560], [0, 760]] : [[0, 0], [W, 0], [W, 600], [0, 720]];
        const band = H - 290;
        const sideLayers = (side, pal, top) => {
          const list = [];
          // Top side: logo + title, then its number. Bottom side (under the cut): the same, right-aligned.
          const head = top ? 150 : cut[2][1] + 40;
          const numY = top ? 270 : cut[2][1] + 150;
          const numH = top ? 300 : band - numY - 30;
          if (side.photo?.src) list.push({ type: 'photo', src: side.photo.src, focus: side.photo.focus, x: 0, y: top ? 0 : cut[2][1] - 40, w: W, h: top ? cut[3][1] : band - cut[2][1] + 40, mask: top ? 'poly' : 'rect', points: top ? cut : null, duotone: [pal.bg, mix(pal.bg, pal.ink, 0.45)], fx: { opacity: top ? 0.6 : 0.4 } });
          if (side.logo?.src) list.push({ type: 'logo', kind: 'league', src: side.logo.src, x: top ? SAFE : W - SAFE - 110, y: head, w: 110, h: 110 });
          if (side.title) list.push({ type: 'text', role: 'kicker', text: upper(side.title), x: top ? SAFE + (side.logo?.src ? 130 : 0) : W - SAFE - 130 - 560, y: head + 22, w: 560, h: 66, font: 'condensed', size: 50, minSize: 28, maxLines: 1, color: pal.ink, align: top ? 'left' : 'right', valign: 'middle', tracking: 2 });
          if (side.number?.value) list.push(numberLayer(side.number, { x: SAFE, y: numY, w: W - SAFE * 2, h: numH }, pal.accent, { align: top ? 'left' : 'right', size: 330, labelColor: pal.ink, labelSize: 40 }));
          return list;
        };
        return [
          { type: 'background', fill: { kind: 'solid', colors: [pb.bg] }, texture: 'grain', textureOpacity: 0.08 },
          ...sideLayers(b, pb, false),
          { type: 'shape', shape: 'poly', points: cut, color: pa.bg, x: 0, y: 0, w: W, h: 0 },
          ...sideLayers(a, pa, true),
          { type: 'shape', shape: 'poly', points: [[0, cut[3][1]], [W, cut[2][1]], [W, cut[2][1] + 16], [0, cut[3][1] + 16]], color: pa.accent, x: 0, y: 0, w: W, h: 0 },
          { type: 'shape', shape: 'rect', x: 0, y: band, w: W, h: H - band, color: mix(pa.bg, '#000000', 0.35) },
          { type: 'shape', shape: 'rect', x: 0, y: band, w: W, h: 10, color: pa.accent },
          headlineText(input, { ...pa, ink: '#FFFFFF' }, { x: SAFE, y: band + 40, w: W - SAFE * 2, h: H - band - 40 - SAFE }, { size: 110, maxLines: 2, align: 'left', valign: 'middle' }),
          grain(0.06),
        ];
      },
    },
    {
      id: 'magazine-cover', name: 'Magazine cover', focal: 'athlete',
      about: 'Full-bleed photo, a masthead-size kicker, a stacked cover headline and cover lines.',
      needs: 'an ES photo of the subject',
      kinds: ["person", "score", "none"],
      fits: i => has.photo(i) && has.headline(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const lines = (input.numbers || []).filter(n => n.display).slice(0, 2);
        const right = v === 1;
        return [
          { type: 'background', fill: { kind: 'solid', colors: [p.bg] } },
          { type: 'photo', src: input.photo.src, focus: input.photo.focus, x: 0, y: 0, w: W, h: H, mask: 'rect', ...(v === 2 ? { duotone: [p.bg, mix(p.accent, '#FFFFFF', 0.35)] } : {}) },
          { type: 'shape', shape: 'gradient', x: 0, y: 0, w: W, h: 330, color: p.bg, stops: [[0, 0.75], [1, 0]] },
          mist(W, H, p, 0.48, 0.94),
          { type: 'text', role: 'kicker', text: upper(input.kicker || input.sport), x: SAFE, y: SAFE + 4, w: 760, h: 120, font: 'display', size: 120, minSize: 60, maxLines: 1, color: p.ink, align: 'left', tracking: 1, fx: { shadow: { color: '#000000', blur: 18, x: 0, y: 4, alpha: 0.35 } } },
          { type: 'shape', shape: 'rect', x: SAFE, y: SAFE + 136, w: 220, h: 12, color: p.accent },
          ...lines.map((n, k) => ({ type: 'text', role: 'label', text: upper(`${n.display} ${n.label || ''}`), x: right ? SAFE : W - SAFE - 330, y: 660 + k * 110, w: 330, h: 96, font: 'condensed', size: 40, minSize: 26, maxLines: 2, color: p.ink, align: right ? 'left' : 'right', highlight: { words: [upper(n.display)], color: p.accent } })),
          headlineText(input, p, { x: SAFE, y: H - SAFE - 400, w: W - SAFE * 2, h: 400 }, { size: 170, maxLines: 3 }),
          grain(0.06),
        ];
      },
    },
    {
      id: 'scoreboard', name: 'Scoreboard', focal: 'number',
      about: 'A final score as a broadcast scoreboard: logos, both scores, the key stats as a ticker.',
      needs: 'a final score between two teams',
      kinds: ["score"],
      fits: i => has.score(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const { a, b } = input.score;
        const win = Number(a.value) >= Number(b.value) ? 'a' : 'b';
        const chips = (input.numbers || []).filter(n => n.display).slice(0, 3);
        const row = (team, y, isWin) => [
          { type: 'shape', shape: 'rect', x: SAFE, y, w: W - SAFE * 2, h: 190, color: isWin ? p.accent : mix(p.bg, '#FFFFFF', 0.08), radius: 10 },
          ...(team.logo ? [{ type: 'logo', kind: 'team', src: team.logo, x: SAFE + 30, y: y + 25, w: 140, h: 140 }] : []),
          { type: 'text', role: 'name', text: upper(team.name), x: SAFE + 200, y: y + 40, w: 520, h: 110, font: 'display', size: 100, minSize: 50, maxLines: 1, color: isWin ? p.bg : p.ink, align: 'left', valign: 'middle' },
          { type: 'number', role: 'number', value: clean(team.value), prefix: '', suffix: '', label: '', x: W - SAFE - 260, y: y + 12, w: 230, h: 166, color: isWin ? p.bg : p.ink, align: 'right', size: 170, factId: input.score.factId || '' },
        ];
        return [
          { type: 'background', fill: { kind: 'linear', colors: [p.bg, mix(p.bg, '#000000', 0.5)], angle: 90 }, texture: 'grid', textureColor: p.accent, textureOpacity: 0.08 },
          ...(has.cutout(input) && v !== 2 ? [
            { type: 'text', role: 'label', text: upper(input.score.a.name), x: SAFE, y: 150, w: W - SAFE * 2, h: 330, font: 'display', size: 330, minSize: 120, maxLines: 1, color: p.accent, align: 'center', valign: 'middle', fx: { opacity: 0.16 } },
            { type: 'cutout', src: input.cutout.src, x: v === 1 ? 60 : 200, y: 110, w: 680, h: 560, anchor: 'bottom', fx: { opacity: 1, shadow: { color: '#000000', blur: 30, x: 0, y: 10, alpha: 0.5 } } }] : []),
          ...(has.photo(input) && !has.cutout(input) ? [{ type: 'photo', src: input.photo.src, focus: input.photo.focus, x: 0, y: 0, w: W, h: 660, mask: 'rect', duotone: [p.bg, mix(p.bg, p.accent, 0.7)], fx: { opacity: 0.6 } }] : []),
          { type: 'shape', shape: 'gradient', x: 0, y: 420, w: W, h: 260, color: p.bg, stops: [[0, 0], [1, 1]] },
          { type: 'pill', role: 'kicker', text: upper(input.score.tag || input.kicker || 'FINAL'), x: SAFE, y: SAFE + 14, h: 56, color: p.bg, bg: p.accent },
          ...row(a, 660, win === 'a'),
          ...row(b, 870, win === 'b'),
          ...chips.map((n, k) => ({ type: 'pill', role: 'label', text: upper(`${n.who ? `${n.who} ` : ''}${n.display} ${n.label || ''}`), x: SAFE + k * 330, y: 1100, h: 50, color: p.ink, bg: mix(p.bg, '#FFFFFF', 0.14), maxW: 316 })),
          headlineText(input, p, { x: SAFE, y: 1170, w: W - SAFE * 2, h: 130 }, { size: 74, maxLines: 2, valign: 'bottom' }),
          grain(0.06),
        ];
      },
    },
    {
      id: 'by-the-numbers', name: 'By the numbers', focal: 'data',
      about: 'A grid of the story\'s real numbers, each with its label, under a short title.',
      needs: '3+ numbers from the brief',
      kinds: ["count", "compare"],
      fits: i => has.numbers(i, 3),
      build(input, v) {
        const { W, H, p } = frame(input);
        const list = input.numbers.filter(n => n.display || n.value).slice(0, 4);
        const pal = v === 2 ? flipPalette(p) : p;
        const cols = 2;
        const top = has.cutout(input) || has.photo(input) ? 560 : 420;
        const cellW = (W - SAFE * 2 - 24) / cols;
        const rows = Math.ceil(list.length / cols);
        const cellH = Math.min(300, (H - SAFE - top - 24 * (rows - 1)) / rows);
        return [
          { type: 'background', fill: { kind: 'solid', colors: [pal.bg] }, texture: 'grain', textureOpacity: 0.08 },
          ...(has.cutout(input) && v !== 1 ? [{ type: 'cutout', src: input.cutout.src, x: 420, y: 60, w: 640, h: top - 40, anchor: 'bottom', fx: { shadow: { color: '#000000', blur: 26, x: 0, y: 10, alpha: 0.45 } } }]
            : has.photo(input) ? [{ type: 'photo', src: input.photo.src, focus: input.photo.focus, x: 0, y: 0, w: W, h: top, mask: 'rect', duotone: v === 1 ? [pal.bg, pal.accent] : null }, { type: 'shape', shape: 'gradient', x: 0, y: top - 260, w: W, h: 260, color: pal.bg, stops: [[0, 0], [1, 1]] }] : []),
          kickerPill(input, pal),
          headlineText(input, pal, { x: SAFE, y: 150, w: has.cutout(input) && v !== 1 ? 520 : W - SAFE * 2, h: top - 190 }, { size: 120, maxLines: 4, valign: 'bottom' }),
          ...list.flatMap((n, k) => {
            const x = SAFE + (k % cols) * (cellW + 24);
            const y = top + Math.floor(k / cols) * (cellH + 24);
            return [
              { type: 'shape', shape: 'rect', x, y, w: cellW, h: cellH, color: k === 0 ? pal.accent : mix(pal.bg, pal.ink, 0.1), radius: 8 },
              numberLayer({ ...n, value: n.value || n.display, label: `${n.who ? `${n.who} ` : ''}${n.label || ''}` }, { x: x + 28, y: y + 22, w: cellW - 56, h: cellH - 44 }, k === 0 ? pal.bg : pal.ink, { size: 180, labelSize: 34, labelColor: k === 0 ? pal.bg : pal.accent }),
            ];
          }),
        ];
      },
    },
    {
      id: 'stat-bars', name: 'Compare bars', focal: 'data',
      about: 'Photo on top, a colour band, then two bars that compare two real numbers.',
      needs: 'two comparable numbers (e.g. 484-222 yards)',
      kinds: ["compare"],
      fits: i => has.compare(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const { a, b } = input.compare;
        const va = Number(String(a.value).replace(/[^\d.]/g, ''));
        const vb = Number(String(b.value).replace(/[^\d.]/g, ''));
        const max = Math.max(va, vb) || 1;
        const photoH = has.photo(input) || has.cutout(input) ? 600 : 360;
        const pal = v === 2 ? flipPalette(p) : p;
        const bar = (item, value, y, lead) => [
          { type: 'text', role: 'label', text: upper(item.label), x: SAFE, y: y + 40, w: 520, h: 54, font: 'condensed', size: 40, minSize: 26, maxLines: 1, color: pal.ink, align: 'left', valign: 'bottom' },
          { type: 'number', role: 'number', value: clean(item.display || item.value), prefix: '', suffix: '', label: '', x: W - SAFE - 480, y, w: 480, h: 120, size: 130, color: lead ? pal.accent : pal.ink, align: 'right', factId: item.factId || input.compare.factId || '' },
          { type: 'shape', shape: 'rect', x: SAFE, y: y + 128, w: W - SAFE * 2, h: 40, color: mix(pal.bg, pal.ink, 0.12), radius: 6 },
          { type: 'shape', shape: 'rect', x: SAFE, y: y + 128, w: Math.max(40, (W - SAFE * 2) * (value / max)), h: 40, color: lead ? pal.accent : mix(pal.ink, pal.bg, 0.4), radius: 6 },
        ];
        return [
          { type: 'background', fill: { kind: 'solid', colors: [mix(pal.bg, '#000000', 0.25)] }, texture: 'grain', textureOpacity: 0.07 },
          ...(has.photo(input) ? [{ type: 'photo', src: input.photo.src, focus: input.photo.focus, x: 0, y: 0, w: W, h: photoH, mask: 'rect', ...(v === 1 ? { duotone: [pal.bg, mix(pal.accent, '#FFFFFF', 0.3)] } : {}) }] : []),
          ...(has.cutout(input) && !has.photo(input) ? [{ type: 'cutout', src: input.cutout.src, x: 200, y: 20, w: 680, h: photoH - 20, anchor: 'bottom' }] : []),
          kickerPill(input, pal),
          { type: 'shape', shape: 'rect', x: 0, y: photoH, w: W, h: 130, color: pal.accent },
          { type: 'text', role: 'headline', text: upper(input.compare.title || input.headline), x: SAFE, y: photoH + 18, w: W - SAFE * 2, h: 96, font: 'display', size: 92, minSize: 44, maxLines: 1, color: pal.bg, align: 'left', valign: 'middle' },
          { type: 'shape', shape: 'rect', x: 0, y: photoH + 130, w: W, h: 10, color: pal.ink, opacity: 0.85 },
          ...bar(a, va, photoH + 180, va >= vb),
          ...bar(b, vb, photoH + 380, vb > va),
          ...(clean(input.body) ? [{ type: 'text', role: 'body', text: clean(input.body), x: SAFE, y: H - SAFE - 80, w: W - SAFE * 2, h: 80, font: 'body', size: 32, minSize: 24, maxLines: 2, color: pal.ink, align: 'left', valign: 'bottom' }] : []),
        ];
      },
    },
    {
      id: 'quote-portrait', name: 'Quote with portrait', focal: 'type',
      about: 'Giant quote marks, the quote set big, the speaker cut out or framed.',
      needs: 'a quote (+ the speaker\'s photo)',
      kinds: ["quote"],
      fits: i => has.quote(i) && clean(i.quote.text).split(' ').length <= 32,
      build(input, v) {
        const { W, H, p } = frame(input);
        const portrait = has.cutout(input) ? 'cutout' : has.photo(input) ? 'photo' : '';
        const pal = v === 2 ? flipPalette(p) : p;
        const textW = portrait ? 600 : W - SAFE * 2;
        return [
          { type: 'background', fill: { kind: 'linear', colors: [pal.bg, pal.bg2], angle: 120 }, texture: 'lines', textureColor: pal.accent, textureOpacity: 0.07 },
          ...(portrait === 'cutout' ? [{ type: 'cutout', src: input.cutout.src, x: v === 1 ? -120 : 440, y: 300, w: 760, h: H - 300, anchor: 'bottom', fx: { shadow: { color: '#000000', blur: 30, x: 0, y: 10, alpha: 0.5 } } }] : []),
          ...(portrait === 'photo' ? [{ type: 'photo', src: input.photo.src, focus: input.photo.focus, x: v === 1 ? 0 : 560, y: 0, w: 520, h: H, mask: v === 1 ? 'slant-r' : 'slant-l', duotone: [pal.bg, mix(pal.accent, '#FFFFFF', 0.3)] }] : []),
          kickerPill(input, pal, v === 1 && portrait ? W - SAFE - 700 : SAFE, SAFE + 14, { align: v === 1 && portrait ? 'right' : 'left' }),
          { type: 'shape', shape: 'quote', x: v === 1 && portrait ? W - SAFE - textW : SAFE, y: 160, w: 200, h: 150, color: pal.accent },
          { type: 'text', role: 'quote', text: upper(input.quote.text), x: v === 1 && portrait ? W - SAFE - textW : SAFE, y: 350, w: textW, h: 760, font: 'display', size: 150, minSize: 56, maxLines: 8, lineHeight: 0.92, color: pal.ink, align: 'left', valign: 'top', highlight: { words: (input.highlight || []).map(upper), color: pal.accent } },
          { type: 'shape', shape: 'rect', x: v === 1 && portrait ? W - SAFE - textW : SAFE, y: H - SAFE - 110, w: 90, h: 10, color: pal.accent },
          { type: 'text', role: 'name', text: upper(input.quote.by), x: v === 1 && portrait ? W - SAFE - textW : SAFE, y: H - SAFE - 86, w: textW, h: 80, font: 'condensed', size: 44, minSize: 28, maxLines: 2, color: pal.ink, align: 'left', valign: 'bottom', tracking: 1 },
          grain(0.06),
        ];
      },
    },
    {
      id: 'typographic', name: 'Typographic poster', focal: 'type',
      about: 'The headline is the image: giant stacked words, one in the accent colour.',
      needs: 'a strong headline',
      kinds: ["quote", "none", "money", "count", "pct"],
      fits: i => has.headline(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const pal = v === 1 ? flipPalette(p) : p;
        const art = input.art?.src || '';
        return [
          { type: 'background', fill: { kind: 'solid', colors: [pal.bg] }, texture: v === 2 ? 'halftone' : 'grain', textureColor: pal.accent, textureOpacity: v === 2 ? 0.14 : 0.1 },
          ...(art ? [{ type: 'photo', role: 'art', src: art, x: W - 520, y: H - 620, w: 560, h: 560, mask: 'none', fit: 'contain', fx: { opacity: 0.22 } }] : []),
          ...(input.logos?.[0]?.src ? [{ type: 'logo', kind: 'league', src: input.logos[0].src, x: W - SAFE - 240, y: H - SAFE - 240, w: 240, h: 240, fx: { opacity: 0.18 }, mono: pal.ink }] : []),
          kickerPill(input, pal),
          { type: 'shape', shape: 'rect', x: SAFE, y: 200, w: W - SAFE * 2, h: 6, color: pal.ink },
          headlineText(input, pal, { x: SAFE, y: 240, w: W - SAFE * 2, h: H - 240 - SAFE - 120 }, { size: 260, minSize: 90, maxLines: 5, valign: 'top', lineHeight: 0.86 }),
          { type: 'shape', shape: 'rect', x: SAFE, y: H - SAFE - 96, w: W - SAFE * 2, h: 6, color: pal.ink },
          ...(input.number?.value ? [{ type: 'text', role: 'label', text: upper(`${input.number.prefix || ''}${input.number.value}${input.number.suffix || ''} ${input.number.label || ''}`), x: SAFE, y: H - SAFE - 70, w: W - SAFE * 2, h: 66, font: 'condensed', size: 44, minSize: 26, maxLines: 1, color: pal.accent, align: 'left', valign: 'bottom', tracking: 2, factId: input.number.factId || '' }] : []),
        ];
      },
    },
    {
      id: 'collage-strip', name: 'Name + collage strip', focal: 'athlete',
      about: 'Giant name behind a cut-out, a strip of moments with labels, a colour band headline.',
      needs: 'a person with 2+ different ES photos',
      kinds: ["person"],
      fits: i => has.cutout(i) && has.photos(i, 2) && clean(i.name),
      build(input, v) {
        const { W, H, p } = frame(input);
        const tiles = input.photos.filter(x => x.src).slice(0, 3);
        const tileW = (W - SAFE * 2 - 20 * (tiles.length - 1)) / tiles.length;
        const pal = v === 2 ? flipPalette(p) : p;
        return [
          { type: 'background', fill: { kind: 'solid', colors: [pal.bg] }, texture: 'grain', textureOpacity: 0.08 },
          { type: 'text', role: 'name', text: upper(input.name), x: SAFE, y: 110, w: W - SAFE * 2, h: 420, font: 'display', size: 300, minSize: 120, maxLines: 2, lineHeight: 0.84, color: pal.accent, align: 'center', valign: 'top' },
          { type: 'cutout', src: input.cutout.src, x: 170, y: 170, w: 740, h: 650, anchor: 'bottom', duotone: v === 1 ? [pal.bg, '#FFFFFF'] : null, fx: { shadow: { color: '#000000', blur: 30, x: 0, y: 12, alpha: 0.5 } } },
          ...tiles.flatMap((t, k) => {
            const x = SAFE + k * (tileW + 20);
            return [
              { type: 'photo', src: t.src, focus: t.focus, x, y: 830, w: tileW, h: 170, mask: 'rect', border: { color: pal.ink, width: 4 } },
              ...(t.label ? [{ type: 'pill', role: 'label', text: upper(t.label), x: x + 8, y: 962, h: 34, color: '#FFFFFF', bg: pal.accent2 === pal.accent ? ES.blue : pal.accent2, maxW: tileW - 16, size: 22 }] : []),
            ];
          }),
          { type: 'shape', shape: 'rect', x: 0, y: 1030, w: W, h: H - 1030, color: pal.paper },
          ...(clean(input.kicker) ? [{ type: 'text', role: 'kicker', text: clean(input.kicker), x: SAFE, y: 1056, w: W - SAFE * 2, h: 48, font: 'condensed', size: 36, minSize: 24, maxLines: 1, color: pal.paperInk, align: 'left' }] : []),
          headlineText(input, { ...pal, ink: pal.paperInk }, { x: SAFE, y: 1104, w: W - SAFE * 2, h: 196 }, { size: 110, maxLines: 2, valign: 'top', highlightColor: contrast(pal.accent, pal.paper) >= 3 ? pal.accent : pal.bg }),
        ];
      },
    },
    {
      id: 'duotone-hero', name: 'Duotone hero', focal: 'athlete',
      about: 'The photo in two team colours, a number badge and a knock-out headline band.',
      needs: 'an ES photo',
      kinds: ["person", "score", "none"],
      fits: i => has.photo(i) || has.cutout(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const src = input.photo?.src || '';
        const badge = input.number?.value;
        return [
          { type: 'background', fill: { kind: 'solid', colors: [p.bg] } },
          ...(src ? [{ type: 'photo', src, focus: input.photo.focus, x: 0, y: 0, w: W, h: H, mask: 'rect', zoom: has.cutout(input) ? 1.7 : 1, duotone: v === 2 ? [p.bg, '#FFFFFF'] : [mix(p.bg, '#000000', 0.3), p.accent], fx: { opacity: has.cutout(input) ? 0.55 : 1 } }] : []),
          ...(has.cutout(input) ? [{ type: 'cutout', src: input.cutout.src, x: v === 1 ? -40 : 160, y: 180, w: 920, h: 1000, anchor: 'bottom', fx: { shadow: { color: '#000000', blur: 36, x: 0, y: 14, alpha: 0.5 } } }] : []),
          mist(W, H, p, 0.6, 0.95),
          ...(badge ? [
            { type: 'shape', shape: 'circle', x: v === 1 ? W - SAFE - 300 : SAFE, y: 190, w: 300, h: 300, color: p.accent, fx: { shadow: { color: '#000000', blur: 24, x: 0, y: 8, alpha: 0.4 } } },
            numberLayer(input.number, { x: (v === 1 ? W - SAFE - 300 : SAFE) + 30, y: 240, w: 240, h: 200 }, p.bg, { align: 'center', size: 150, labelSize: 26, labelColor: p.bg }),
          ] : []),
          kickerPill(input, p),
          { type: 'shape', shape: 'rect', x: 0, y: H - 360, w: W, h: 8, color: p.accent },
          headlineText(input, p, { x: SAFE, y: H - 330, w: W - SAFE * 2, h: 280 }, { size: 150, maxLines: 2 }),
          grain(0.07),
        ];
      },
    },
    {
      id: 'record-badge', name: 'Record badge', focal: 'logo',
      about: 'The team badge as a giant watermark, the record set huge, the star cut out beside it.',
      needs: 'a team record (12-2) + the team',
      kinds: ["record"],
      fits: i => has.record(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const logo = input.record.logo || input.logos?.[0]?.src || '';
        const left = v !== 1;
        return [
          { type: 'background', fill: { kind: 'radial', colors: [p.bg2, p.bg], at: { x: left ? 0.3 : 0.7, y: 0.45 } }, texture: 'grain', textureOpacity: 0.08 },
          ...(logo ? [{ type: 'logo', kind: 'team', src: logo, x: left ? -180 : 460, y: 200, w: 800, h: 800, fx: { opacity: 0.1 } }] : []),
          ...(has.cutout(input) && v !== 2 ? [{ type: 'cutout', src: input.cutout.src, x: left ? 470 : -40, y: 220, w: 650, h: H - 220, anchor: 'bottom', fx: { shadow: { color: '#000000', blur: 30, x: 0, y: 12, alpha: 0.5 } } }] : []),
          mist(W, H, p, 0.7, 0.9),
          ...(logo ? [{ type: 'logo', kind: 'team', src: logo, x: left ? SAFE : W - SAFE - 150, y: SAFE, w: 150, h: 150 }] : []),
          numberLayer({ value: input.record.value, label: input.record.label, factId: input.record.factId }, { x: left ? SAFE : W - SAFE - 620, y: 300, w: has.cutout(input) && v !== 2 ? 560 : W - SAFE * 2, h: 470 }, p.accent, { align: left ? 'left' : 'right', size: 400, labelColor: p.ink, labelSize: 46 }),
          headlineText(input, p, { x: SAFE, y: H - SAFE - 330, w: W - SAFE * 2, h: 330 }, { size: 130, maxLines: 3, align: left ? 'left' : 'right' }),
        ];
      },
    },
    {
      id: 'unit-grid', name: 'Unit chart', focal: 'data',
      about: 'The count drawn as that many units (cards, players), so the number is felt, not read.',
      needs: 'a count of 8-200 things (100 players, 40 wins)',
      kinds: ["count"],
      fits: i => has.units(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const n = Number(String(input.number.value).replace(/,/g, ''));
        const pal = v === 1 ? flipPalette(p) : p;
        const gridY = v === 2 ? 640 : 520;
        return [
          { type: 'background', fill: { kind: 'solid', colors: [pal.bg] }, texture: 'grain', textureOpacity: 0.09 },
          kickerPill(input, pal),
          numberLayer(input.number, { x: SAFE, y: 140, w: W - SAFE * 2, h: v === 2 ? 470 : 360 }, pal.accent, { size: v === 2 ? 470 : 360, labelColor: pal.ink, labelSize: 44 }),
          { type: 'chart', chart: 'units', count: n, unit: input.unit || 'card', x: SAFE, y: gridY, w: W - SAFE * 2, h: H - gridY - 330, color: pal.accent, track: mix(pal.bg, pal.ink, 0.12), factId: input.number.factId || '' },
          headlineText(input, pal, { x: SAFE, y: H - SAFE - 260, w: W - SAFE * 2, h: 260 }, { size: 120, maxLines: 2 }),
        ];
      },
    },
    // ─── v2 styles (2026-11-19): 15 more archetypes, all ES-gated ─────────
    {
      id: 'pill-stack', name: 'ES pill headline', focal: 'athlete',
      about: 'The ES house look: a full-bleed photo, team mist at 90% and the headline broken into stacked highlight pills.',
      needs: 'an ES photo + a headline',
      kinds: ['person', 'none', 'score', 'record'],
      fits: i => has.photo(i) && has.headline(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const right = v === 1;
        const two = v === 2;
        const pillText = p.onAccent;
        const hiColor = contrast(p.ink, p.accent) >= 3 ? p.ink : pillText;
        return [
          { type: 'background', fill: { kind: 'solid', colors: [p.bg] } },
          { type: 'photo', src: input.photo.src, focus: input.photo.focus, x: 0, y: 0, w: W, h: H, mask: 'rect', flip: right, vignette: 0.25 },
          mist(W, H, p, 0.42),
          kickerPill(input, { ...p, accent: p.ink, onAccent: p.bg }),
          {
            type: 'text', role: 'headline', text: upper(input.headline), x: SAFE, y: H - SAFE - 450, w: W - SAFE * 2 - 80, h: 450,
            font: 'display', size: 128, minSize: 64, maxLines: 4, color: pillText, align: right ? 'right' : 'left', valign: 'bottom',
            box: { color: p.accent, ...(two ? { colors: [p.accent, contrast(pillText, p.ink) >= 4.5 ? p.ink : p.accent2] } : {}) },
            highlight: { words: two ? [] : (input.highlight || []).map(upper), color: hiColor },
          },
          grain(0.05),
        ];
      },
    },
    {
      id: 'versus-split', name: 'Split-tone versus', focal: 'contrast',
      about: 'A final as a diagonal split: the winner in the team colour, the other side in deep tone, both crests, both scores, VS at the cut.',
      needs: 'a final score between two teams',
      kinds: ['score'],
      fits: i => has.score(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const { a, b } = input.score;
        const band = H - 250;
        const flip = v === 1;
        const top = flip ? W - 380 : 700;
        const bottom = flip ? W - 700 : 380;
        const cut = [[0, 0], [top, 0], [bottom, band], [0, band]];
        const other = [[top, 0], [W, 0], [W, band], [bottom, band]];
        const winBg = v === 2 ? p.bg : p.accent;
        const winInk = v === 2 ? p.ink : p.onAccent;
        const loseBg = v === 2 ? p.deep : p.deep;
        const side = (team, isA) => {
          const left = isA !== flip;
          const ink = isA ? winInk : p.ink;
          const y0 = isA ? 220 : 520;
          const x = left ? SAFE : W - SAFE - 440;
          return [
            ...(team.logo ? [
              { type: 'logo', kind: 'team', src: team.logo, x: left ? -120 : W - 520, y: isA ? 80 : 420, w: 640, h: 640, fx: { opacity: isA ? 0.1 : 0.05 }, mono: ink },
              { type: 'logo', kind: 'team', src: team.logo, x: left ? SAFE : W - SAFE - 170, y: y0, w: 170, h: 170, align: left ? 'left' : 'right', fx: { shadow: { color: '#000000', blur: 20, x: 0, y: 8, alpha: 0.35 } } },
            ] : []),
            { type: 'text', role: 'name', text: upper(team.name), x, y: y0 + 196, w: 440, h: 76, font: 'display', size: 76, minSize: 40, maxLines: 1, color: ink, align: left ? 'left' : 'right', valign: 'top' },
            { type: 'number', role: 'number', value: clean(team.value), prefix: '', suffix: '', label: '', x, y: y0 + 290, w: 440, h: 300, size: 360, color: isA ? winInk : p.accent, align: left ? 'left' : 'right', valign: 'top', factId: input.score.factId || '' },
          ];
        };
        const mid = { x: (top + bottom) / 2, y: band / 2 };
        return [
          { type: 'background', fill: { kind: 'solid', colors: [loseBg] }, texture: 'lines', textureColor: p.ink, textureOpacity: 0.04 },
          { type: 'shape', shape: 'poly', points: other, color: loseBg, x: 0, y: 0, w: 0, h: 0 },
          { type: 'shape', shape: 'poly', points: cut, color: winBg, x: 0, y: 0, w: 0, h: 0, fx: { inner: { color: '#000000', blur: 60, alpha: 0.35 } } },
          ...(has.photo(input) && v === 1 ? [{ type: 'photo', src: input.photo.src, focus: input.photo.focus, x: 0, y: 0, w: W, h: band, mask: 'poly', points: cut, tritone: [mix(winBg, '#000000', 0.55), winBg, mix(winBg, '#FFFFFF', 0.6)], fx: { opacity: 0.38, blend: 'multiply' } }] : []),
          { type: 'shape', shape: 'leak', x: flip ? W - 520 : -120, y: -120, w: 640, h: 520, color: mix(winBg, '#FFFFFF', 0.7), opacity: 0.35 },
          ...side(a, true),
          ...side(b, false),
          { type: 'shape', shape: 'poly', points: [[top - 7, 0], [top + 7, 0], [bottom + 7, band], [bottom - 7, band]], color: p.ink, x: 0, y: 0, w: 0, h: 0 },
          { type: 'shape', shape: 'circle', x: mid.x - 72, y: mid.y - 72, w: 144, h: 144, color: p.ink, fx: { shadow: { color: '#000000', blur: 30, x: 0, y: 10, alpha: 0.45 } } },
          { type: 'text', role: 'label', text: 'VS', x: mid.x - 72, y: mid.y - 72, w: 144, h: 144, font: 'display', size: 70, minSize: 40, maxLines: 1, color: p.bg === p.ink ? p.accent : p.bg, align: 'center', valign: 'middle' },
          { type: 'shape', shape: 'rect', x: 0, y: band, w: W, h: H - band, color: p.bg },
          { type: 'shape', shape: 'rect', x: 0, y: band, w: W, h: 10, color: p.accent },
          kickerPill({ kicker: input.score.tag || input.kicker || 'Final' }, p, SAFE, band + 40, { h: 48 }),
          headlineText(input, p, { x: SAFE, y: band + 104, w: W - SAFE * 2, h: H - band - 104 - SAFE }, { size: 92, minSize: 48, maxLines: 1, valign: 'bottom' }),
          grain(0.06),
        ];
      },
    },
    {
      id: 'trading-card', name: 'Trading card', focal: 'athlete',
      about: 'The player as a collectible card: foil border with a sheen, rim-lit cut-out, name banner, one stat, slight 3D tilt.',
      needs: 'a person with an ES photo (cut out ideally) + their name',
      kinds: ['person'],
      fits: i => (has.cutout(i) || has.photo(i)) && Boolean(clean(i.name)),
      build(input, v) {
        const { W, H, p } = frame(input);
        const tilt = v === 1 ? 4 : -4;
        const pal = v === 2 ? flipPalette(p) : p;
        const card = { x: 190, y: 140, w: 700, h: 930 };
        const pivot = { x: card.x + card.w / 2, y: card.y + card.h / 2 };
        const T = { rotate: tilt, tilt: { skewY: tilt > 0 ? -0.015 : 0.015 }, pivot };
        const inner = { x: card.x + 26, y: card.y + 26, w: card.w - 52, h: card.h - 52 };
        const art = { x: inner.x, y: inner.y, w: inner.w, h: inner.h - 200 };
        const n = input.number?.value ? input.number : (input.numbers || []).find(x => x.value || x.display);
        return [
          { type: 'background', fill: { kind: 'radial', colors: [pal.bg2, pal.bg], at: { x: 0.5, y: 0.45 } }, texture: 'dots', textureColor: pal.accent, textureOpacity: 0.12 },
          { type: 'shape', shape: 'starburst', x: W / 2 - 520, y: 110, w: 1040, h: 1040, points: 24, inner: 0.9, color: pal.accent, opacity: 0.1 },
          { type: 'shape', shape: 'rect', ...card, radius: 30, color: pal.accent, sheen: 0.55, fx: { ...T, shadow: { color: '#000000', blur: 60, x: 0, y: 30, alpha: 0.55 } } },
          { type: 'shape', shape: 'rect', ...inner, radius: 18, color: pal.deep, fx: { ...T, inner: { color: '#000000', blur: 30, alpha: 0.5 } } },
          ...(has.photo(input) ? [{ type: 'photo', src: input.photo.src, focus: input.photo.focus, ...art, mask: 'round', radius: 18, blur: has.cutout(input) ? 7 : 0, tritone: pal.tone, fx: { ...T, opacity: has.cutout(input) ? 0.6 : 1 } }] : []),
          ...(has.cutout(input) ? [{ type: 'cutout', src: input.cutout.src, x: inner.x - 20, y: inner.y + 40, w: inner.w + 40, h: art.h - 40, anchor: 'bottom', rim: { color: pal.rim, width: 5, angle: -60, alpha: 0.9 }, fx: { ...T, shadow: { color: '#000000', blur: 24, x: 0, y: 10, alpha: 0.5 } } }] : []),
          { type: 'shape', shape: 'rect', x: inner.x, y: inner.y + inner.h - 200, w: inner.w, h: 200, radius: 0, color: pal.accent, fx: T },
          { type: 'text', role: 'name', text: upper(input.name), x: inner.x + 30, y: inner.y + inner.h - 186, w: inner.w - 60, h: 104, font: 'display', size: 104, minSize: 52, maxLines: 1, color: pal.onAccent, align: 'left', valign: 'middle', fx: T },
          ...(n ? [{ type: 'text', role: 'label', text: upper(`${n.prefix || ''}${n.value || n.display}${n.suffix || ''} ${n.label || ''}`), x: inner.x + 30, y: inner.y + inner.h - 78, w: inner.w - 60 - (input.logos?.[0]?.src ? 90 : 0), h: 50, font: 'condensed', size: 36, minSize: 24, maxLines: 1, color: pal.onAccent, align: 'left', valign: 'middle', factId: n.factId || '', fx: T }] : []),
          ...(input.logos?.[0]?.src ? [{ type: 'logo', kind: 'team', src: input.logos[0].src, x: inner.x + inner.w - 106, y: inner.y + inner.h - 96, w: 80, h: 80, fx: T }] : []),
          kickerPill(input, pal, SAFE, H - SAFE - 186, { h: 50 }),
          headlineText(input, pal, { x: SAFE, y: H - SAFE - 120, w: W - SAFE * 2, h: 120 }, { size: 96, minSize: 48, maxLines: 1, valign: 'bottom' }),
          grain(0.06),
        ];
      },
    },
    {
      id: 'lower-third', name: 'Broadcast lower-third', focal: 'athlete',
      about: 'A TV broadcast frame: full-bleed photo, a lower-third bar with the headline, a tag and a stat strap.',
      needs: 'an ES photo + a headline',
      kinds: ['person', 'score', 'none'],
      fits: i => has.photo(i) && has.headline(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const dark = v === 1;
        const bar = dark ? p.bg : ES.white;
        const barInk = dark ? p.ink : (contrast(p.bg, ES.white) >= 4.5 ? p.bg : ES.ink);
        const y = H - SAFE - 340;
        const logo = input.logos?.[0]?.src || input.record?.logo || '';
        const lw = logo ? 170 : 0;
        const n = input.number?.value ? input.number : (input.numbers || []).find(x => x.value || x.display);
        const strap = n ? upper(`${n.prefix || ''}${n.value || n.display}${n.suffix || ''} ${n.label || ''}`) : upper(input.name || input.sport);
        return [
          { type: 'background', fill: { kind: 'solid', colors: [p.bg] } },
          { type: 'photo', src: input.photo.src, focus: input.photo.focus, x: 0, y: 0, w: W, h: H, mask: 'rect', vignette: 0.35, ...(v === 2 ? { tritone: p.tone } : {}) },
          mist(W, H, p, 0.55),
          { type: 'shape', shape: 'texture', texture: 'scan', color: '#000000', opacity: 0.06 },
          { type: 'pill', role: 'kicker', text: upper(input.kicker || input.sport || 'Live'), x: SAFE, y, h: 56, color: p.onAccent, bg: p.accent, maxW: 640 },
          ...(logo ? [
            { type: 'shape', shape: 'rect', x: SAFE, y: y + 66, w: lw, h: 170, color: p.accent },
            { type: 'logo', kind: 'team', src: logo, x: SAFE + 20, y: y + 86, w: lw - 40, h: 130 },
          ] : []),
          { type: 'shape', shape: 'rect', x: SAFE + lw, y: y + 66, w: W - SAFE * 2 - lw, h: 170, color: bar, fx: { shadow: { color: '#000000', blur: 30, x: 0, y: 12, alpha: 0.35 } } },
          { type: 'shape', shape: 'rect', x: SAFE + lw, y: y + 66, w: 12, h: 170, color: p.accent },
          { type: 'text', role: 'headline', text: upper(input.headline), x: SAFE + lw + 40, y: y + 66, w: W - SAFE * 2 - lw - 70, h: 170, font: 'display', size: 96, minSize: 50, maxLines: 2, color: barInk, align: 'left', valign: 'middle', highlight: { words: (input.highlight || []).map(upper), color: contrast(p.accent, bar) >= 3 ? p.accent : barInk } },
          { type: 'shape', shape: 'rect', x: SAFE + lw, y: y + 236, w: W - SAFE * 2 - lw, h: 74, color: p.deep },
          { type: 'text', role: 'label', text: strap, x: SAFE + lw + 40, y: y + 236, w: W - SAFE * 2 - lw - 80, h: 74, font: 'condensed', size: 36, minSize: 24, maxLines: 1, color: p.ink, align: 'left', valign: 'middle', factId: n?.factId || '' },
          grain(0.05),
        ];
      },
    },
    {
      id: 'front-page', name: 'Newspaper front page', focal: 'type',
      about: 'A broadsheet front page: masthead, double rule, a screaming headline, a halftone photo with caption and a column of copy.',
      needs: 'an ES photo + a strong headline',
      kinds: ['score', 'record', 'person', 'none', 'quote'],
      fits: i => has.photo(i) && has.headline(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const paper = ES.paper;
        const ink = ES.ink;
        const spot = contrast(p.accent, paper) >= 3 ? p.accent : contrast(p.bg, paper) >= 3 ? p.bg : ink;
        const n = input.number?.value ? input.number : null;
        const wide = v === 1;
        const photoBox = wide ? { x: SAFE, y: 690, w: W - SAFE * 2, h: 380 } : { x: SAFE, y: 690, w: 600, h: 500 };
        const col = { x: SAFE + 630, y: 690, w: W - SAFE * 2 - 630, h: 500 };
        const tone = v === 2 ? { tritone: [ink, mix(spot, ink, 0.2), paper], levels: true } : { halftone: { cell: 7, color: ink, angle: 45 }, grayscale: true, levels: true, curve: 1.4 };
        return [
          { type: 'background', fill: { kind: 'solid', colors: [paper] }, texture: 'grain', textureOpacity: 0.12 },
          { type: 'text', role: 'kicker', text: upper(input.sport ? `${input.sport} Extra` : input.kicker || 'Extra'), x: SAFE, y: SAFE, w: W - SAFE * 2 - 200, h: 104, font: 'display', size: 104, minSize: 50, maxLines: 1, color: ink, align: 'left', valign: 'middle', guard: false },
          { type: 'shape', shape: 'rect', x: SAFE, y: 178, w: W - SAFE * 2, h: 8, color: ink },
          { type: 'shape', shape: 'rect', x: SAFE, y: 192, w: W - SAFE * 2, h: 2, color: ink },
          { type: 'text', role: 'label', text: upper(input.kicker || input.name || ''), x: SAFE, y: 204, w: (W - SAFE * 2) * 0.62, h: 40, font: 'condensed', size: 26, minSize: 22, maxLines: 1, color: ink, align: 'left', valign: 'middle', guard: false },
          { type: 'text', role: 'label', text: upper(input.name && !squashed(input.kicker).includes(squashed(input.name).split(' ').pop()) ? input.name : 'Special edition'), x: SAFE + (W - SAFE * 2) * 0.62, y: 204, w: (W - SAFE * 2) * 0.38, h: 40, font: 'condensed', size: 26, minSize: 22, maxLines: 1, color: ink, align: 'right', valign: 'middle', guard: false },
          { type: 'shape', shape: 'rect', x: SAFE, y: 252, w: W - SAFE * 2, h: 2, color: ink },
          { type: 'text', role: 'headline', text: upper(input.headline), x: SAFE, y: 280, w: W - SAFE * 2, h: 380, font: 'display', size: 190, minSize: 80, maxLines: 3, lineHeight: 0.88, color: ink, align: 'left', valign: 'middle', highlight: { words: (input.highlight || []).map(upper), color: spot } },
          { type: 'photo', src: input.photo.src, focus: input.photo.focus, ...photoBox, mask: 'rect', ...tone },
          { type: 'shape', shape: 'frame', ...photoBox, color: ink, lineWidth: 2 },
          { type: 'text', role: 'label', text: upper(input.name || input.kicker || ''), x: photoBox.x, y: photoBox.y + photoBox.h + 10, w: photoBox.w, h: 34, font: 'condensed', size: 22, minSize: 22, maxLines: 1, color: ink, align: 'left', valign: 'top', guard: false },
          ...(!wide ? [
            { type: 'shape', shape: 'rect', x: col.x - 16, y: col.y, w: 2, h: col.h, color: ink, opacity: 0.6 },
            ...(n ? [numberLayer(n, { x: col.x, y: col.y, w: col.w, h: 250 }, spot, { size: 220, labelColor: ink, labelSize: 26, align: 'left' })] : []),
            ...(clean(input.body) ? [{ type: 'text', role: 'body', text: clean(input.body), x: col.x, y: col.y + (n ? 270 : 0), w: col.w, h: col.h - (n ? 270 : 0), font: 'body', size: 30, minSize: 22, maxLines: 9, lineHeight: 1.3, color: ink, align: 'left', valign: 'top', guard: false }] : []),
          ] : [
            ...(clean(input.body) ? [{ type: 'text', role: 'body', text: clean(input.body), x: SAFE, y: photoBox.y + photoBox.h + 56, w: W - SAFE * 2, h: H - SAFE - (photoBox.y + photoBox.h + 56), font: 'body', size: 32, minSize: 22, maxLines: 4, lineHeight: 1.3, color: ink, align: 'left', valign: 'top', guard: false }] : []),
          ]),
        ];
      },
    },
    {
      id: 'film-strip', name: 'Film-strip timeline', focal: 'athlete',
      about: 'Three moments as frames on a tilted strip of film with sprocket holes and labels, the headline above.',
      needs: 'a person or team with 3+ different ES photos',
      kinds: ['person'],
      fits: i => has.photo(i) && has.photos(i, 2) && has.headline(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const tiles = [input.photo, ...input.photos.filter(x => x.src)].slice(0, 3);
        const pal = v === 2 ? flipPalette(p) : p;
        const rot = v === 1 ? 3 : -3;
        const sy = 560;
        const sh = 520;
        const T = { rotate: rot, pivot: { x: W / 2, y: sy + sh / 2 } };
        const fw = 300;
        const gap = 30;
        const x0 = (W - (fw * 3 + gap * 2)) / 2;
        return [
          { type: 'background', fill: { kind: 'linear', colors: [pal.bg, pal.deep], angle: 90 }, texture: 'grain', textureOpacity: 0.1 },
          kickerPill(input, pal),
          headlineText(input, pal, { x: SAFE, y: 170, w: W - SAFE * 2, h: 320 }, { size: 136, maxLines: 3, valign: 'bottom' }),
          { type: 'shape', shape: 'rect', x: -80, y: sy, w: W + 160, h: sh, color: ES.ink, fx: { ...T, shadow: { color: '#000000', blur: 50, x: 0, y: 20, alpha: 0.6 } } },
          { type: 'shape', shape: 'sprockets', x: -60, y: sy + 22, w: W + 120, h: 30, color: mix(pal.paper, '#000000', 0.2), fx: T },
          { type: 'shape', shape: 'sprockets', x: -60, y: sy + sh - 52, w: W + 120, h: 30, color: mix(pal.paper, '#000000', 0.2), fx: T },
          ...tiles.flatMap((t, k) => {
            const x = x0 + k * (fw + gap);
            return [
              { type: 'photo', src: t.src, focus: t.focus, x, y: sy + 80, w: fw, h: sh - 160, mask: 'rect', ...(v === 2 ? { tritone: pal.tone } : {}), fx: T },
              ...(t.label ? [{ type: 'pill', role: 'label', text: upper(t.label), x: x + 12, y: sy + sh - 136, h: 40, color: pal.onAccent, bg: pal.accent, maxW: fw - 24, fx: T }] : []),
            ];
          }),
          ...(input.number?.value ? [{ type: 'text', role: 'label', text: upper(`${input.number.prefix || ''}${input.number.value}${input.number.suffix || ''} ${input.number.label || ''}`), x: SAFE, y: H - SAFE - 90, w: W - SAFE * 2, h: 90, font: 'display', size: 84, minSize: 40, maxLines: 1, color: pal.accent, align: 'left', valign: 'bottom', factId: input.number.factId || '' }]
            : clean(input.body) ? [{ type: 'text', role: 'body', text: clean(input.body), x: SAFE, y: H - SAFE - 110, w: W - SAFE * 2, h: 110, font: 'body', size: 32, minSize: 24, maxLines: 2, color: pal.ink, align: 'left', valign: 'bottom' }] : []),
          { type: 'shape', shape: 'rect', x: SAFE, y: H - SAFE - 124, w: 120, h: 8, color: pal.accent },
        ];
      },
    },
    {
      id: 'neon-night', name: 'Neon night game', focal: 'type',
      about: 'Prime-time energy: a dark, depth-blurred photo, scanlines, and the headline glowing like neon in the team colour.',
      needs: 'a headline + an ES photo, a cut-out or a number',
      kinds: ['score', 'person', 'none', 'count'],
      fits: i => has.headline(i) && (has.photo(i) || has.cutout(i) || has.number(i)),
      build(input, v) {
        const { W, H, p } = frame(input);
        const neon = sat(p.accent) > 0.3 ? p.accent : ES.blue;
        const core = mix(neon, '#FFFFFF', 0.7);
        const cut = has.cutout(input) && v === 1;
        const n = input.number?.value ? input.number : null;
        const glow = { color: neon, blur: 46, alpha: 0.85 };
        return [
          { type: 'background', fill: { kind: 'radial', colors: [mix(p.deep, neon, 0.12), mix(p.bg, '#000000', 0.7)], at: { x: 0.5, y: 0.4 } } },
          ...(has.photo(input) ? [{ type: 'photo', src: input.photo.src, focus: input.photo.focus, x: 0, y: 0, w: W, h: H, mask: 'rect', blur: 5, tritone: ['#000000', mix(p.bg, neon, 0.25), mix(neon, '#FFFFFF', 0.3)], vignette: 0.7, fx: { opacity: 0.55 } }] : []),
          { type: 'shape', shape: 'texture', texture: 'scan', color: '#000000', opacity: 0.22 },
          ...(cut ? [{ type: 'cutout', src: input.cutout.src, x: 140, y: 560, w: 800, h: H - 560, anchor: 'bottom', rim: { color: core, width: 6, angle: -90, alpha: 0.95 }, fx: { shadow: { color: neon, blur: 60, x: 0, y: 0, alpha: 0.45 } } }, mist(W, H, { ...p, mist: '#000000' }, 0.82, 0.9)] : []),
          { type: 'pill', role: 'kicker', text: upper(input.kicker || input.sport || ''), x: SAFE, y: SAFE + 12, h: 52, color: '#000000', bg: core, maxW: 640, fx: { glow: { color: neon, blur: 30, alpha: 0.8 } } },
          { type: 'shape', shape: 'rect', x: SAFE, y: cut ? 196 : 300, w: W - SAFE * 2, h: 6, color: core, fx: { glow } },
          {
            type: 'text', role: 'headline', text: upper(input.headline), x: SAFE, y: cut ? 220 : 330, w: W - SAFE * 2, h: cut ? 330 : 520,
            font: 'display', size: 200, minSize: 70, maxLines: cut ? 3 : 4, lineHeight: 0.88, color: core, core, align: v === 2 ? 'left' : 'center', valign: 'middle', fx: { glow }, highlight: { words: [], color: core },
          },
          { type: 'shape', shape: 'rect', x: SAFE, y: cut ? 566 : 880, w: W - SAFE * 2, h: 6, color: core, fx: { glow } },
          ...(n && !cut ? [numberLayer(n, { x: SAFE, y: 920, w: W - SAFE * 2, h: H - SAFE - 920 }, core, { align: v === 2 ? 'left' : 'center', size: 300, labelColor: core, labelSize: 40, fx: { glow: { color: neon, blur: 50, alpha: 0.85 } } })]
            : !cut && clean(input.body) ? [{ type: 'text', role: 'body', text: clean(input.body), x: SAFE + 60, y: 940, w: W - SAFE * 2 - 120, h: 200, font: 'body', size: 34, minSize: 24, maxLines: 3, color: core, align: 'center', valign: 'top' }] : []),
          grain(0.08),
        ];
      },
    },
    {
      id: 'swiss-grid', name: 'Minimal Swiss grid', focal: 'type',
      about: 'International style: a strict 12-column grid, generous white, one accent, a flush-left headline and the number set like a specimen.',
      needs: 'a strong headline (+ a number or a photo)',
      kinds: ['count', 'money', 'pct', 'record', 'none'],
      fits: i => has.headline(i),
      build(input, v) {
        const { W, H } = frame(input);
        const base = frame(input).p;
        // Swiss is white paper and black ink; the team colour is the one spot colour (v2: dark).
        const p = v === 2 ? base : { ...base, bg: '#FFFFFF', ink: ES.ink, inkSoft: mix('#000000', '#FFFFFF', 0.2), mode: 'light' };
        const light = p.mode === 'light';
        const ink = p.ink;
        const spots = [base.accent, base.accent2, base.bg, ES.blue].filter(c => contrast(c, p.bg) >= 3);
        const accent = spots[0] || ink; // team colour first, ES blue only as a last resort
        const colW = (W - SAFE * 2 - 11 * 20) / 12;
        const cx = c => SAFE + c * (colW + 20);
        const span = c => c * colW + (c - 1) * 20;
        const n = input.number?.value ? input.number : null;
        const photo = has.photo(input) && v !== 1;
        return [
          { type: 'background', fill: { kind: 'solid', colors: [p.bg] }, texture: 'grain', textureOpacity: light ? 0.06 : 0.08 },
          { type: 'shape', shape: 'rect', x: SAFE, y: SAFE + 22, w: 26, h: 26, color: accent },
          { type: 'text', role: 'kicker', text: upper(input.kicker || input.sport || ''), x: SAFE + 44, y: SAFE + 14, w: span(8), h: 42, font: 'condensed', size: 30, minSize: 22, maxLines: 1, color: ink, align: 'left', valign: 'middle' },
          { type: 'shape', shape: 'rect', x: SAFE, y: 196, w: W - SAFE * 2, h: 3, color: ink },
          ...(photo ? [{ type: 'photo', src: input.photo.src, focus: input.photo.focus, x: cx(6), y: 236, w: span(6), h: 470, mask: 'rect', grayscale: true, curve: 1.4 }] : []),
          ...(n ? [numberLayer(n, { x: SAFE, y: 236, w: photo ? span(6) - 10 : W - SAFE * 2, h: 470 }, accent, { size: photo ? 300 : 520, labelColor: ink, labelSize: 32, valign: 'top' })]
            : [{ type: 'text', role: 'label', text: upper(input.name || input.sport || ''), x: SAFE, y: 236, w: photo ? span(6) - 10 : W - SAFE * 2, h: 470, font: 'display', size: 210, minSize: 80, maxLines: 3, lineHeight: 0.86, color: accent, align: 'left', valign: 'top' }]),
          { type: 'shape', shape: 'rect', x: SAFE, y: 740, w: W - SAFE * 2, h: 3, color: ink },
          { type: 'text', role: 'headline', text: upper(input.headline), x: SAFE, y: 780, w: span(9), h: H - SAFE - 780, font: 'display', size: 128, minSize: 60, maxLines: 4, color: ink, align: 'left', valign: 'top', highlight: { words: (input.highlight || []).map(upper), color: accent } },
          ...(clean(input.body) ? [{ type: 'text', role: 'body', text: clean(input.body), x: cx(9) + 10, y: 786, w: span(3) - 10, h: H - SAFE - 786, font: 'body', size: 24, minSize: 22, maxLines: 10, lineHeight: 1.32, color: p.inkSoft || ink, align: 'left', valign: 'top' }] : []),
        ];
      },
    },
    {
      id: 'quote-marks', name: 'Oversized quote marks', focal: 'type',
      about: 'The quote alone, set big between oversized quote marks in the team colour; the speaker in an ES pill.',
      needs: 'a quote from the brief (no photo needed)',
      kinds: ['quote'],
      fits: i => has.quote(i) && clean(i.quote.text).split(' ').length <= 34,
      build(input, v) {
        const { W, H } = frame(input);
        const base = frame(input).p;
        const p = v === 1 ? flipPalette(base) : base;
        const logo = input.logos?.[0]?.src || '';
        return [
          { type: 'background', fill: { kind: 'radial', colors: [p.bg2, p.bg], at: { x: 0.2, y: 0.25 } }, texture: 'grain', textureOpacity: 0.08 },
          ...(v === 2 && logo ? [{ type: 'logo', kind: 'team', src: logo, x: W - 640, y: H - 700, w: 760, h: 760, fx: { opacity: 0.08 }, mono: p.ink }] : []),
          { type: 'shape', shape: 'quote', x: SAFE - 6, y: 150, w: 400, h: 300, color: p.accent },
          kickerPill(input, p, SAFE + 430, 330, { h: 50 }),
          {
            type: 'text', role: 'quote', text: upper(input.quote.text), x: SAFE, y: 490, w: W - SAFE * 2, h: 560, font: 'display', size: 120, minSize: 54, maxLines: 7, lineHeight: 0.94,
            color: p.ink, align: 'left', valign: 'top', highlight: { words: (input.highlight || []).map(upper), color: p.accent },
          },
          { type: 'shape', shape: 'quote', flip: true, x: W - SAFE - 300, y: H - SAFE - 330, w: 300, h: 225, color: p.accent, opacity: 0.9 },
          { type: 'text', role: 'name', text: upper(input.quote.by), x: SAFE, y: H - SAFE - 64, w: W - SAFE * 2 - 340, h: 64, font: 'condensed', size: 38, minSize: 24, maxLines: 1, color: p.onAccent, align: 'left', valign: 'bottom', box: { color: p.accent } },
        ];
      },
    },
    {
      id: 'record-gauge', name: 'Record-breaker gauge', focal: 'data',
      about: 'A dial that fills to the share one side owns (484 of 706 yards), with the leading number set big inside it.',
      needs: 'two comparable numbers (484-222) or a percentage',
      kinds: ['compare', 'pct'],
      fits: i => has.compare(i) || (has.number(i) && /%/.test(`${i.number.suffix || ''}${i.number.value}`)),
      build(input, v) {
        const { W, H, p } = frame(input);
        const pal = v === 2 ? flipPalette(p) : p;
        const num = x => Number(String(x || '').replace(/[^\d.]/g, '')) || 0;
        let value = 0;
        let lead;
        let rest = null;
        if (has.compare(input)) {
          const { a, b } = input.compare;
          const [hi, lo] = num(a.value) >= num(b.value) ? [a, b] : [b, a];
          value = num(hi.value) / Math.max(1, num(hi.value) + num(lo.value));
          lead = { value: clean(hi.display || hi.value), label: hi.label, factId: hi.factId || input.compare.factId };
          rest = lo;
        } else {
          value = Math.min(1, num(input.number.value) / 100);
          lead = input.number;
        }
        const g = { x: SAFE + 20, y: 520, w: W - SAFE * 2 - 40, h: 480 };
        return [
          { type: 'background', fill: { kind: 'radial', colors: [pal.bg2, pal.bg], at: { x: 0.5, y: 0.7 } }, texture: 'grain', textureOpacity: 0.08 },
          ...(has.photo(input) && v !== 1 ? [{ type: 'photo', src: input.photo.src, focus: input.photo.focus, x: 0, y: 0, w: W, h: 560, mask: 'rect', tritone: pal.tone, fade: { to: 'bottom', from: 0.35 }, fx: { opacity: 0.55 } }] : []),
          kickerPill(input, pal),
          headlineText({ ...input, headline: input.compare?.title || input.headline }, pal, { x: SAFE, y: 170, w: W - SAFE * 2, h: 290 }, { size: 130, maxLines: 2, valign: 'bottom' }),
          { type: 'shape', shape: 'arc', ...g, lineWidth: 64, value: 1, color: mix(pal.bg, pal.ink, 0.14), ticks: 10, track: mix(pal.bg, pal.ink, 0.14) },
          { type: 'shape', shape: 'arc', ...g, lineWidth: 64, value, color: pal.accent, fx: { glow: { color: pal.accent, blur: 40, alpha: 0.55 } } },
          numberLayer({ value: lead.value, prefix: lead.prefix, suffix: lead.suffix, label: lead.label, factId: lead.factId }, { x: g.x + 150, y: g.y + 170, w: g.w - 300, h: 310 }, pal.ink, { align: 'center', size: 260, labelColor: pal.accent, labelSize: 36, valign: 'bottom' }),
          { type: 'shape', shape: 'rect', x: 0, y: H - SAFE - 200, w: W, h: 2, color: pal.ink, opacity: 0.25 },
          ...(rest ? [
            { type: 'text', role: 'label', text: upper(rest.label), x: SAFE, y: H - SAFE - 160, w: 620, h: 60, font: 'condensed', size: 38, minSize: 24, maxLines: 1, color: pal.inkSoft || pal.ink, align: 'left', valign: 'middle' },
            { type: 'number', role: 'number', value: clean(rest.display || rest.value), prefix: '', suffix: '', label: '', x: W - SAFE - 360, y: H - SAFE - 180, w: 360, h: 120, size: 130, color: pal.ink, align: 'right', factId: rest.factId || input.compare.factId || '' },
          ] : clean(input.body) ? [{ type: 'text', role: 'body', text: clean(input.body), x: SAFE, y: H - SAFE - 170, w: W - SAFE * 2, h: 170, font: 'body', size: 32, minSize: 24, maxLines: 3, color: pal.ink, align: 'left', valign: 'middle' }] : []),
        ];
      },
    },
    {
      id: 'photo-mosaic', name: 'Photo mosaic', focal: 'athlete',
      about: 'An editorial mosaic: one hero frame and two support frames on a tight grid, the headline in a clean band below.',
      needs: 'a person or team with 3+ different ES photos',
      kinds: ['person'],
      fits: i => has.photo(i) && has.photos(i, 2) && has.headline(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const tiles = [input.photo, ...input.photos.filter(x => x.src)].slice(0, 3);
        const mirror = v === 1;
        const grade = v === 2 ? { tritone: p.tone } : {};
        const top = 190;
        const big = { w: 600, h: 760 };
        const small = { w: W - SAFE * 2 - big.w - 20, h: (big.h - 20) / 2 };
        const bx = mirror ? W - SAFE - big.w : SAFE;
        const sx = mirror ? SAFE : SAFE + big.w + 20;
        const band = top + big.h + 40;
        return [
          { type: 'background', fill: { kind: 'solid', colors: [p.bg] }, texture: 'grain', textureOpacity: 0.08 },
          kickerPill(input, p),
          { type: 'photo', src: tiles[0].src, focus: tiles[0].focus, x: bx, y: top, w: big.w, h: big.h, mask: 'round', radius: 10, ...grade },
          { type: 'photo', src: tiles[1].src, focus: tiles[1].focus, x: sx, y: top, w: small.w, h: small.h, mask: 'round', radius: 10, ...grade },
          { type: 'photo', src: tiles[2].src, focus: tiles[2].focus, x: sx, y: top + small.h + 20, w: small.w, h: small.h, mask: 'round', radius: 10, ...(v === 0 ? { tritone: p.tone } : grade) },
          ...[tiles[1], tiles[2]].map((t, k) => (t.label ? { type: 'pill', role: 'label', text: upper(t.label), x: sx + 14, y: top + k * (small.h + 20) + small.h - 54, h: 40, color: p.onAccent, bg: p.accent, maxW: small.w - 28 } : null)).filter(Boolean),
          { type: 'shape', shape: 'rect', x: SAFE, y: band, w: 140, h: 10, color: p.accent },
          headlineText(input, p, { x: SAFE, y: band + 36, w: W - SAFE * 2, h: H - SAFE - band - 36 }, { size: 124, maxLines: 2, valign: 'top' }),
        ];
      },
    },
    {
      id: 'sticker-collage', name: 'Sticker collage', focal: 'athlete',
      about: 'Playful and loud: the player die-cut like a sticker on a starburst, tilted sticker pills for the stat and the name.',
      needs: 'a person with an ES photo (cut out) + a headline',
      kinds: ['person', 'count', 'record'],
      fits: i => has.cutout(i) && has.headline(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const pal = v === 2 ? flipPalette(p) : p;
        const mirror = v === 1;
        const n = input.number?.value ? input.number : (input.numbers || []).find(x => x.value || x.display);
        const stat = n ? upper(`${n.prefix || ''}${n.value || n.display}${n.suffix || ''} ${n.label || ''}`) : '';
        return [
          { type: 'background', fill: { kind: 'solid', colors: [pal.bg] }, texture: 'halftone', textureColor: pal.accent, textureOpacity: 0.2 },
          { type: 'shape', shape: 'starburst', x: mirror ? 60 : 160, y: 170, w: 860, h: 860, points: 22, inner: 0.82, color: pal.accent, fx: { rotate: mirror ? -8 : 8 } },
          { type: 'shape', shape: 'circle', x: mirror ? 210 : 310, y: 320, w: 560, h: 560, color: mix(pal.accent, pal.bg, 0.35), opacity: 0.5 },
          { type: 'cutout', src: input.cutout.src, x: mirror ? 40 : 200, y: 180, w: 840, h: 860, anchor: 'bottom', sticker: { color: '#FFFFFF', width: 14 }, fx: { rotate: mirror ? 3 : -3, shadow: { color: '#000000', blur: 30, x: 8, y: 16, alpha: 0.45 } } },
          ...(stat ? [{ type: 'pill', role: 'label', text: stat, x: mirror ? W - SAFE - 470 : SAFE, y: 600, h: 70, size: 40, color: pal.bg, bg: '#FFFFFF', maxW: 470, factId: n.factId || '', fx: { rotate: mirror ? 6 : -6, shadow: { color: '#000000', blur: 16, x: 4, y: 8, alpha: 0.4 } } }] : []),
          ...(clean(input.name) ? [{ type: 'pill', role: 'name', text: upper(input.name), x: mirror ? SAFE : W - SAFE - 420, y: 860, h: 64, size: 38, color: pal.onAccent, bg: pal.accent, maxW: 420, fx: { rotate: mirror ? -5 : 5, shadow: { color: '#000000', blur: 16, x: 4, y: 8, alpha: 0.4 } } }] : []),
          kickerPill(input, { ...pal, accent: '#FFFFFF', onAccent: pal.bg }),
          {
            type: 'text', role: 'headline', text: upper(input.headline), x: SAFE, y: 1010, w: W - SAFE * 2, h: H - SAFE - 1010, font: 'display', size: 110, minSize: 56, maxLines: 2,
            color: pal.onAccent, align: 'center', valign: 'bottom', box: { color: pal.accent, colors: [pal.accent, '#FFFFFF'] }, highlight: { words: [], color: pal.onAccent }, fx: { rotate: mirror ? 2 : -2, shadow: { color: '#000000', blur: 20, x: 0, y: 10, alpha: 0.35 } },
          },
          grain(0.07),
        ];
      },
    },
    {
      id: 'type-knockout', name: 'Photo in type', focal: 'type',
      about: 'The headline set huge with the ES photo showing through the letters (a knockout), on a quiet team-colour field.',
      needs: 'an ES photo + a short headline (2-5 words)',
      kinds: ['person', 'none', 'score'],
      fits: i => has.photo(i) && has.headline(i) && words(i.headline).length <= 6,
      build(input, v) {
        const { W, H, p } = frame(input);
        const pal = v === 2 ? flipPalette(p) : p;
        const tone = pal.mode === 'light' ? [mix(pal.paperInk, '#000000', 0.45), pal.paperInk, mix(pal.accent, pal.paperInk, 0.3)] : [mix(pal.accent, '#000000', 0.2), mix(pal.accent, '#FFFFFF', 0.2), '#FFFFFF'];
        return [
          { type: 'background', fill: { kind: 'radial', colors: [pal.bg2, pal.bg], at: { x: 0.5, y: 0.45 } }, texture: 'grain', textureOpacity: 0.09 },
          { type: 'photo', src: input.photo.src, focus: input.photo.focus, x: 0, y: 0, w: W, h: H, mask: 'rect', grayscale: true, blur: 10, fx: { opacity: 0.12, blend: pal.mode === 'light' ? 'multiply' : 'screen' } },
          kickerPill(input, pal),
          {
            type: 'text', role: 'headline', text: upper(input.headline), x: SAFE, y: 200, w: W - SAFE * 2, h: H - 200 - 230, font: 'display', size: 380, minSize: 120, maxLines: 4, lineHeight: 0.84,
            color: pal.ink, align: v === 1 ? 'left' : 'center', valign: 'middle', knockout: { src: input.photo.src, focus: input.photo.focus, levels: true, ...(v === 1 ? {} : { tritone: tone, curve: 1.1 }) },
            fx: { shadow: { color: '#000000', blur: 30, x: 0, y: 12, alpha: pal.mode === 'light' ? 0.18 : 0.5 } },
          },
          { type: 'shape', shape: 'rect', x: SAFE, y: H - SAFE - 150, w: W - SAFE * 2, h: 3, color: pal.ink, opacity: 0.6 },
          { type: 'text', role: 'label', text: upper(input.name || input.kicker || input.sport || ''), x: SAFE, y: H - SAFE - 120, w: W - SAFE * 2, h: 120, font: 'display', size: 76, minSize: 40, maxLines: 1, color: pal.accent, align: v === 1 ? 'left' : 'center', valign: 'middle' },
        ];
      },
    },
    {
      id: 'stat-tower', name: 'Stacked stat tower', focal: 'data',
      about: 'Every real number as a stepped slab rising beside the rim-lit cut-out: the first stat in the team colour leads.',
      needs: '3+ numbers from the brief (+ a cut-out)',
      kinds: ['count', 'compare'],
      fits: i => has.numbers(i, 3) && has.headline(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const list = input.numbers.filter(n => n.display || n.value).slice(0, 4);
        const pal = v === 2 ? flipPalette(p) : p;
        const right = v !== 1;
        const top = 470;
        const gap = 16;
        const rowH = Math.min(210, (H - SAFE - top - gap * (list.length - 1)) / list.length);
        const cut = has.cutout(input);
        return [
          { type: 'background', fill: { kind: 'linear', colors: [pal.bg2, pal.bg], angle: 90 }, texture: 'grain', textureOpacity: 0.08 },
          ...(cut ? [{ type: 'cutout', src: input.cutout.src, x: right ? 420 : -40, y: 150, w: 700, h: H - 150, anchor: 'bottom', align: right ? 'right' : 'left', rim: { color: pal.rim, width: 5, angle: right ? -140 : -40, alpha: 0.9 }, fx: { shadow: { color: '#000000', blur: 40, x: 0, y: 16, alpha: 0.55 } } }] : []),
          kickerPill(input, pal),
          headlineText(input, pal, { x: SAFE, y: 160, w: cut ? 640 : W - SAFE * 2, h: 270 }, { size: 120, maxLines: 3, valign: 'bottom', align: right ? 'left' : 'left' }),
          ...list.flatMap((n, k) => {
            const y = top + k * (rowH + gap);
            const w = (cut ? 720 : W - SAFE * 2) - k * 60;
            const x = right ? SAFE : W - SAFE - w;
            const lead = k === 0;
            const fill = lead ? pal.accent : mix(pal.bg, pal.ink, 0.1 + k * 0.04);
            const ink = lead ? pal.onAccent : pal.ink;
            return [
              { type: 'shape', shape: 'rect', x, y, w, h: rowH, color: fill, fx: { shadow: { color: '#000000', blur: 24, x: 0, y: 10, alpha: 0.35 } } },
              { type: 'number', role: 'number', value: clean(n.value || n.display), prefix: clean(n.prefix), suffix: clean(n.suffix), label: '', x: x + 28, y: y + 18, w: w * 0.48, h: rowH - 36, size: 170, color: ink, align: 'left', factId: n.factId || '' },
              { type: 'text', role: 'label', text: upper(`${n.who ? `${n.who} ` : ''}${n.label || ''}`), x: x + w * 0.5, y: y + 10, w: w * 0.5 - 28, h: rowH - 20, font: 'condensed', size: 40, minSize: 24, maxLines: 2, lineHeight: 1.04, color: lead ? pal.onAccent : contrast(pal.accent, fill) >= 4.5 ? pal.accent : pal.ink, align: 'right', valign: 'middle' },
            ];
          }),
        ];
      },
    },
    {
      id: 'ticket-stub', name: 'Game ticket', focal: 'number',
      about: 'The result as a game ticket: both crests and the score on the face, a perforated stub with the headline, tilted with a real shadow.',
      needs: 'a final score between two teams',
      kinds: ['score'],
      fits: i => has.score(i),
      build(input, v) {
        const { W, H, p } = frame(input);
        const { a, b } = input.score;
        const rot = v === 1 ? 4 : -4;
        const pal = v === 2 ? flipPalette(p) : p;
        const t = { x: SAFE + 20, y: 250, w: W - SAFE * 2 - 40, h: 860 };
        const tear = t.y + 560;
        const pivot = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
        const T = { rotate: rot, pivot };
        const face = ES.paper;
        const ink = ES.ink;
        const spot = contrast(pal.accent, face) >= 3 ? pal.accent : contrast(pal.bg, face) >= 3 ? pal.bg : ink;
        const team = (side, left) => [
          ...(side.logo ? [{ type: 'logo', kind: 'team', src: side.logo, x: left ? t.x + 40 : t.x + t.w - 40 - 170, y: t.y + 150, w: 170, h: 170, fx: T }] : []),
          { type: 'text', role: 'name', text: upper(side.name), x: left ? t.x + 40 : t.x + t.w - 40 - 300, y: t.y + 350, w: 300, h: 60, font: 'condensed', size: 40, minSize: 24, maxLines: 1, color: ink, align: left ? 'left' : 'right', valign: 'top', fx: T, guard: false },
        ];
        return [
          { type: 'background', fill: { kind: 'radial', colors: [pal.bg2, pal.bg], at: { x: 0.5, y: 0.45 } }, texture: 'lines', textureColor: pal.accent, textureOpacity: 0.06 },
          { type: 'shape', shape: 'rect', ...t, radius: 26, color: face, fx: { ...T, shadow: { color: '#000000', blur: 60, x: 0, y: 30, alpha: 0.6 } } },
          { type: 'shape', shape: 'rect', x: t.x, y: t.y, w: t.w, h: 92, radius: 0, color: spot, fx: T },
          { type: 'text', role: 'kicker', text: upper(input.score.tag || input.kicker || 'Final'), x: t.x + 40, y: t.y + 10, w: t.w - 80, h: 72, font: 'display', size: 58, minSize: 34, maxLines: 1, color: contrast('#FFFFFF', spot) >= contrast(ink, spot) ? '#FFFFFF' : ink, align: 'left', valign: 'middle', fx: T, guard: false },
          ...team(a, true),
          ...team(b, false),
          { type: 'number', role: 'number', value: clean(a.value), prefix: '', suffix: '', label: '', x: t.x + 230, y: t.y + 130, w: pivot.x - 40 - (t.x + 230), h: 220, size: 230, color: spot, align: 'right', factId: input.score.factId || '', fx: T },
          { type: 'shape', shape: 'rect', x: pivot.x - 16, y: t.y + 236, w: 32, h: 10, color: ink, fx: T },
          { type: 'number', role: 'number', value: clean(b.value), prefix: '', suffix: '', label: '', x: pivot.x + 40, y: t.y + 130, w: t.x + t.w - 230 - (pivot.x + 40), h: 220, size: 230, color: ink, align: 'left', factId: input.score.factId || '', fx: T },
          { type: 'shape', shape: 'barcode', x: t.x + 60, y: t.y + 440, w: t.w - 120, h: 70, color: ink, opacity: 0.85, seed: 9, fx: T },
          { type: 'shape', shape: 'perforation', x: t.x + 30, y: tear - 5, w: t.w - 60, h: 10, color: pal.bg, fx: T },
          { type: 'shape', shape: 'circle', x: t.x - 30, y: tear - 30, w: 60, h: 60, color: pal.bg, fx: T },
          { type: 'shape', shape: 'circle', x: t.x + t.w - 30, y: tear - 30, w: 60, h: 60, color: pal.bg, fx: T },
          { type: 'text', role: 'headline', text: upper(input.headline), x: t.x + 50, y: tear + 40, w: t.w - 100, h: t.h - 560 - 80, font: 'display', size: 120, minSize: 54, maxLines: 2, color: ink, align: 'left', valign: 'middle', highlight: { words: (input.highlight || []).map(upper), color: spot }, fx: T, guard: false },
          grain(0.07),
        ];
      },
    },
  ];
  const BY_ID = Object.fromEntries(ARCHETYPES.map(a => [a.id, a]));
  // What each archetype needs from the brief (for the art director's catalogue)
  // and the story kinds it serves (for the no-AI plan's priority lists).
  const NEEDS = Object.fromEntries(ARCHETYPES.map(a => [a.id, a.needs]));

  const fits = (id, input = {}) => Boolean(BY_ID[id] && BY_ID[id].fits(input));
  const fitting = (input = {}) => ARCHETYPES.filter(a => a.fits(input)).map(a => a.id);

  // A scene from an archetype and its inputs (variant 0-2).
  function build(id, input = {}, variant = 0) {
    const archetype = BY_ID[id];
    if (!archetype) throw new Error(`Unknown composition "${id}".`);
    const { W, H, p } = frame(input);
    const layers = archetype.build({ ...input, palette: p }, variant).filter(Boolean)
      .filter(layer => !layer.hidden);
    return {
      v: 1,
      kind: 'composed',
      archetype: id,
      archetypeName: archetype.name,
      focal: archetype.focal,
      variant,
      size: { w: W, h: H },
      palette: p,
      facts: Array.isArray(input.facts) ? input.facts.map(f => ({ id: f.id, text: clean(f.text), source: f.source || 'brief' })) : [],
      swipe: Boolean(input.swipe),
      layers,
    };
  }

  // 2-3 candidates for one direction: the archetype's variants (no AI).
  function candidates(id, input = {}, count = 3) {
    return [0, 1, 2].slice(0, Math.max(1, Math.min(3, count))).map(variant => build(id, input, variant));
  }

  // ─── The ES guideline gate for composed designs ─────────────────────────
  // Hard errors drop the design; fixes are applied and listed.
  //   fonts:     only display / condensed / body (Acumin, Roboto Condensed, Roboto)
  //   colours:   every colour from the scene palette (team / league / ES), its shades
  //   logo:      no free ES logo layer (the renderer places the one ES mark)
  //   type:      no stroked / outlined text; no rotated text over 8 degrees
  //   safe area: text, numbers, pills and charts inside 50px; clear of the logo zone
  //   numbers:   every digit on the design comes from a fact (brief / research)
  //   size:      known canvas sizes; at most 28 layers
  const COLOR_KEYS = ['color', 'bg', 'unitColor', 'labelColor', 'textureColor', 'track'];
  function logoZone(scene) {
    const W = scene.size?.w || 1080;
    return scene.swipe ? { x: 0, y: 0, w: SAFE + LOGO.w + SAFE, h: SAFE + LOGO.h + SAFE } : { x: W - SAFE - LOGO.w - SAFE, y: 0, w: SAFE + LOGO.w + SAFE, h: SAFE + LOGO.h + SAFE };
  }
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const TEXTISH = new Set(['text', 'number', 'pill', 'chart']);

  function textOf(layer) {
    if (layer.type === 'number') return `${layer.prefix || ''}${layer.value || ''}${layer.suffix || ''} ${layer.label || ''}`;
    return String(layer.text || '');
  }

  function checkScene(scene, { facts = null } = {}) {
    const errors = [];
    const fixes = [];
    if (!scene || typeof scene !== 'object' || !Array.isArray(scene.layers)) return { ok: false, errors: [{ rule: 'es-template', msg: 'not a scene' }], fixes };
    const size = scene.size || {};
    if (!Object.values(SIZES).some(s => s.w === size.w && s.h === size.h)) errors.push({ rule: 'canvas-size', msg: `canvas ${size.w}x${size.h} is not an ES size` });
    if (scene.layers.length > MAX_LAYERS) errors.push({ rule: 'composition', msg: `too many layers (${scene.layers.length})` });
    const allowed = new Set((scene.palette?.allowed || []).map(normHex));
    const known = facts || scene.facts || [];
    const factDigits = new Set(known.flatMap(f => digitsIn(f.text)));
    const zone = logoZone(scene);
    const W = size.w || 1080;
    const H = size.h || 1350;
    scene.layers = scene.layers.filter(layer => {
      if (!LAYER_TYPES.includes(layer?.type)) {
        fixes.push({ rule: 'composition', what: `removed an unknown layer (${String(layer?.type || '?').slice(0, 20)})` });
        return false;
      }
      if (layer.type === 'logo' && (layer.kind === 'es' || /essentiallysports|brand-logo|es-rounded/i.test(String(layer.src || '')))) {
        fixes.push({ rule: 'logo-placement', what: 'removed a free ES logo layer; the ES mark is placed by the template rules' });
        return false;
      }
      return true;
    });
    scene.layers.forEach((layer, index) => {
      const tag = `${layer.type}${layer.role ? `:${layer.role}` : ''} #${index + 1}`;
      if (layer.font && !FONTS[layer.font]) {
        fixes.push({ rule: 'font-family', what: `${tag}: "${String(layer.font).slice(0, 30)}" is not an ES font; set to Acumin` });
        layer.font = 'display';
      }
      ['fontFamily', 'stroke', 'outline', 'textStroke'].forEach(key => {
        if (key in layer) {
          delete layer[key];
          fixes.push({ rule: key === 'fontFamily' ? 'font-family' : 'no-outlined-type', what: `${tag}: removed ${key}` });
        }
      });
      if (layer.fx?.rotate && (TEXTISH.has(layer.type) || layer.type === 'logo') && Math.abs(layer.fx.rotate) > 8) {
        fixes.push({ rule: 'type-hierarchy', what: `${tag}: rotation limited to 8 degrees` });
        layer.fx.rotate = Math.sign(layer.fx.rotate) * 8;
      }
      if (layer.fx?.blend && !BLENDS.includes(layer.fx.blend)) delete layer.fx.blend;
      checkEffects(layer, tag, fixes);
      // Colours: from the palette (or its shades). Off-palette colours snap to the nearest allowed one.
      if (allowed.size) {
        COLOR_KEYS.forEach(key => {
          const value = layer[key];
          if (typeof value !== 'string' || !value || /^rgba\(/.test(value)) return;
          const hex = normHex(value);
          if (!hex) return;
          if (!allowed.has(hex)) {
            const nearest = [...allowed].sort((a, b) => colorDist(a, hex) - colorDist(b, hex))[0];
            fixes.push({ rule: 'team-palette', what: `${tag}: ${hex} is off-palette; used ${nearest}` });
            layer[key] = nearest;
          }
        });
      }
      if (TEXTISH.has(layer.type)) {
        // Safe area: keep inside 50px.
        const box = { x: layer.x || 0, y: layer.y || 0, w: layer.w || layer.maxW || 0, h: layer.h || 0 };
        if (layer.type !== 'pill' && (box.x < SAFE - 1 || box.y < SAFE - 1 || box.x + box.w > W - SAFE + 1 || box.y + box.h > H - SAFE + 1)) {
          const nx = Math.max(SAFE, Math.min(box.x, W - SAFE - box.w));
          const ny = Math.max(SAFE, Math.min(box.y, H - SAFE - box.h));
          layer.x = nx;
          layer.y = ny;
          if (box.w > W - SAFE * 2) layer.w = W - SAFE * 2;
          if (box.h > H - SAFE * 2) layer.h = H - SAFE * 2;
          fixes.push({ rule: 'safe-area', what: `${tag}: moved inside the 50px safe area` });
        }
        // The logo zone is the ES mark's (with its 50px clear space).
        const after = { x: layer.x, y: layer.y, w: layer.w || layer.maxW || 0, h: layer.h || 0 };
        if (overlaps(after, zone)) {
          if (!scene.swipe && after.x + after.w > zone.x) layer.w = Math.max(80, zone.x - after.x);
          else if (scene.swipe) {
            layer.y = Math.max(layer.y, zone.y + zone.h);
          }
          fixes.push({ rule: 'logo-clear-space', what: `${tag}: kept clear of the ES logo` });
        }
        // Numbers come only from facts.
        if (known.length || facts) {
          const digits = digitsIn(textOf(layer));
          const stray = digits.filter(d => !factDigits.has(d));
          if (stray.length) errors.push({ rule: 'real-facts', msg: `${tag}: "${stray.join(', ')}" is not a number from the brief or ES research` });
        }
        if (layer.type === 'chart' && layer.chart === 'units' && known.length && !factDigits.has(String(layer.count))) errors.push({ rule: 'real-facts', msg: `${tag}: unit chart of ${layer.count} has no fact behind it` });
      }
    });
    checkBusyText(scene, fixes);
    return { ok: !errors.length, errors, fixes, scene };
  }

  // Effects stay inside the ES finish: the subject sharp, type never blurred or
  // over-glowed, textures quiet, tilts subtle, mist at exactly 90%.
  function checkEffects(layer, tag, fixes) {
    const L = FX_LIMITS;
    const fx = layer.fx || {};
    const note = what => fixes.push({ rule: 'composed-effects', what: `${tag}: ${what}` });
    if (fx.rotate && (layer.type === 'photo' || layer.type === 'cutout') && Math.abs(fx.rotate) > L.imageRotate) { fx.rotate = Math.sign(fx.rotate) * L.imageRotate; note(`image tilt limited to ${L.imageRotate} degrees`); }
    if (fx.tilt) ['skewX', 'skewY'].forEach(k => { if (Math.abs(fx.tilt[k] || 0) > L.skew) { fx.tilt[k] = Math.sign(fx.tilt[k]) * L.skew; note('3D tilt limited'); } });
    if (layer.blur != null) {
      if (layer.type !== 'photo') { delete layer.blur; note(layer.type === 'cutout' ? 'the subject stays sharp (blur removed)' : 'removed blur'); } else if (layer.blur > L.photoBlur) { layer.blur = L.photoBlur; note('depth blur limited'); }
    }
    if (layer.rim && layer.type !== 'cutout') { delete layer.rim; note('rim light is for cut-outs only'); }
    if (layer.sticker && layer.type !== 'cutout') { delete layer.sticker; note('sticker edge is for cut-outs only'); }
    if (layer.knockout && layer.type !== 'text') { delete layer.knockout; note('photo-in-type is for text only'); }
    if (fx.glow) {
      if ((fx.glow.alpha ?? 0.5) > L.glowAlpha) { fx.glow.alpha = L.glowAlpha; note('glow strength limited'); }
      if ((fx.glow.blur || 0) > L.glowBlur) { fx.glow.blur = L.glowBlur; note('glow size limited'); }
    }
    if (layer.type === 'shape' && layer.shape === 'grain' && (layer.opacity ?? 0) > L.grain) { layer.opacity = L.grain; note('grain limited'); }
    if (layer.type === 'shape' && layer.shape === 'leak' && (layer.opacity ?? 1) > L.leak) { layer.opacity = L.leak; note('light leak limited'); }
    if (layer.type === 'background' && layer.texture) {
      const cap = layer.texture === 'grain' ? L.grain : L.texture;
      if ((layer.textureOpacity ?? 0.1) > cap) { layer.textureOpacity = cap; note('texture limited'); }
    }
    if (layer.type === 'shape' && layer.mist && Array.isArray(layer.stops)) {
      const peak = Math.max(...layer.stops.map(st => st[1]));
      if (peak && Math.abs(peak - L.mist) > 0.001) {
        layer.stops = layer.stops.map(([at, a]) => [at, Number(((a / peak) * L.mist).toFixed(3))]);
        fixes.push({ rule: 'mist-opacity', what: `${tag}: mist set to 90%` });
      }
    }
    if (TEXTISH.has(layer.type) && layer.type === 'text' && (layer.minSize || 0) && layer.minSize < L.minType) {
      layer.minSize = L.minType;
      fixes.push({ rule: 'text-fit', what: `${tag}: smallest type raised to ${L.minType}px` });
    }
  }

  // Text over a busy photo with nothing between (no mist, band or box) gets a
  // soft shadow; the renderer's contrast guard then adds a scrim if it still
  // measures under 3:1 (4.5:1 for small type).
  const coverage = (a, b) => {
    const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return a.w * a.h ? (w * h) / (a.w * a.h) : 0;
  };
  function layerBox(l, W, H) {
    if (l.points?.length) {
      const xs = l.points.map(p => p[0]);
      const ys = l.points.map(p => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    if (l.shape === 'vignette' || l.shape === 'grain' || l.shape === 'texture') return { x: 0, y: 0, w: W, h: H };
    return { x: l.x || 0, y: l.y || 0, w: l.w || l.maxW || 0, h: l.h || 0 };
  }
  function checkBusyText(scene, fixes) {
    const W = scene.size?.w || 1080;
    const H = scene.size?.h || 1350;
    scene.layers.forEach((t, i) => {
      if (t.type !== 'text' || t.box || t.knockout || t.guard === false || (t.fx?.opacity ?? 1) < 0.6 || t.fx?.shadow || t.fx?.glow) return;
      if (!['headline', 'quote', 'kicker', 'body', 'name', 'label'].includes(t.role)) return;
      const tb = layerBox(t, W, H);
      const below = scene.layers.slice(0, i);
      const photoAt = below.map((l, k) => ({ l, k })).filter(({ l }) => (l.type === 'photo' || l.type === 'cutout') && !l.halftone && (l.blur || 0) < 8 && (l.fx?.opacity ?? 1) >= 0.5 && coverage(tb, layerBox(l, W, H)) > 0.25).map(x => x.k);
      if (!photoAt.length) return;
      const last = Math.max(...photoAt);
      const shielded = below.slice(last + 1).some(l => l.type === 'shape' && coverage(tb, layerBox(l, W, H)) > 0.6 && (
        (l.shape === 'gradient' && Math.max(...(l.stops || [[0, 0]]).map(st => st[1])) >= 0.6)
        || (['rect', 'poly', 'circle'].includes(l.shape) && (l.opacity ?? l.fx?.opacity ?? 1) >= 0.8)));
      if (shielded) return;
      t.fx = { ...(t.fx || {}), shadow: { color: lum(normHex(t.color) || '#FFFFFF') > 0.3 ? '#000000' : '#FFFFFF', blur: 26, x: 0, y: 6, alpha: 0.55 } };
      fixes.push({ rule: 'composed-contrast', what: `${t.type}:${t.role} #${i + 1}: text over a busy photo; added a soft shadow (the renderer adds a scrim if it still reads under 3:1)` });
    });
  }
  function colorDist(a, b) {
    const x = rgb(a);
    const y = rgb(b);
    return (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2;
  }

  // ─── The art director's one fix (code, whitelisted) ─────────────────────
  function applyFix(scene, op) {
    const next = JSON.parse(JSON.stringify(scene));
    const find = pred => next.layers.filter(pred);
    const W = next.size.w;
    switch (op) {
      case 'bigger-number':
        find(l => l.type === 'number').slice(0, 1).forEach(l => {
          const grow = 1.14;
          const nw = Math.min(W - SAFE * 2, l.w * grow);
          l.x = Math.max(SAFE, l.x - (nw - l.w) / 2);
          l.w = nw;
          l.h *= grow;
          l.size = Math.round((l.size || 300) * grow);
        });
        break;
      case 'bigger-headline':
        find(l => l.role === 'headline').forEach(l => { l.size = Math.round((l.size || 120) * 1.15); l.minSize = Math.round((l.minSize || 56) * 1.1); });
        break;
      case 'shorter-headline':
        find(l => l.role === 'headline').forEach(l => { l.maxLines = Math.max(1, (l.maxLines || 3) - 1); l.size = Math.round((l.size || 120) * 1.1); });
        next.layers = next.layers.filter(l => l.role !== 'body');
        break;
      case 'darker-mist':
        find(l => l.shape === 'gradient').forEach(l => { l.stops = (l.stops || [[0, 0], [1, 0.9]]).map(([at, a]) => [at, Math.min(1, a + 0.12)]); l.y = Math.max(0, l.y - 80); l.h += 80; });
        break;
      case 'more-contrast':
        find(l => l.role === 'headline' || l.role === 'quote').forEach(l => { l.fx = { ...(l.fx || {}), shadow: { color: '#000000', blur: 22, x: 0, y: 6, alpha: 0.6 } }; });
        find(l => l.type === 'photo' && l.mask === 'rect').forEach(l => { l.fx = { ...(l.fx || {}), opacity: Math.min(l.fx?.opacity ?? 1, 0.7) }; });
        break;
      case 'less-clutter':
        next.layers = next.layers.filter(l => !(l.type === 'pill' && l.role === 'label') && !(l.type === 'text' && l.role === 'body') && !(l.type === 'shape' && l.shape === 'grain'));
        break;
      case 'swap-palette': {
        const flipped = flipPalette(next.palette);
        const map = new Map([[normHex(next.palette.bg), flipped.bg], [normHex(next.palette.ink), flipped.ink], [normHex(next.palette.paper), flipped.paper]]);
        next.layers.forEach(l => COLOR_KEYS.forEach(key => { if (map.has(normHex(l[key]))) l[key] = map.get(normHex(l[key])); }));
        next.layers.forEach(l => { if (l.fill?.colors) l.fill.colors = l.fill.colors.map(c => map.get(normHex(c)) || c); });
        next.palette = flipped;
        break;
      }
      case 'move-headline-up':
        find(l => l.role === 'headline').forEach(l => { l.y = Math.max(SAFE, l.y - 90); });
        break;
      case 'brighten-photo':
        // Auto levels, full opacity, half the vignette; the mist starts lower (still 90%).
        find(l => l.type === 'photo' || l.type === 'cutout').filter(l => l.role !== 'art').forEach(l => {
          l.levels = true;
          if (l.vignette) l.vignette = Number((l.vignette / 2).toFixed(2));
          if (l.fx?.opacity != null && l.fx.opacity < 1) l.fx = { ...l.fx, opacity: Math.min(1, l.fx.opacity + 0.25) };
        });
        find(l => l.mist).forEach(l => { const dy = Math.round(l.h * 0.12); l.y += dy; l.h -= dy; });
        break;
      case 'darken-photo':
        find(l => l.type === 'photo' && l.role !== 'art').forEach(l => { l.vignette = Math.min(0.75, (l.vignette || 0) + 0.35); });
        find(l => l.mist).forEach(l => { const dy = Math.min(l.y, 120); l.y -= dy; l.h += dy; });
        break;
      case 'more-depth': {
        // Depth of field behind a cut-out, a rim light on it, a vignette over the field.
        const hasCut = next.layers.some(l => l.type === 'cutout');
        find(l => l.type === 'photo' && l.role !== 'art' && hasCut).forEach(l => { l.blur = Math.max(l.blur || 0, 6); });
        find(l => l.type === 'cutout').forEach(l => { l.rim = l.rim || { color: next.palette?.rim || '#FFFFFF', width: 5, angle: -55, alpha: 0.85 }; });
        const at = next.layers.findIndex(l => TEXTISH.has(l.type));
        next.layers.splice(at < 0 ? next.layers.length : at, 0, { type: 'shape', shape: 'vignette', x: 0, y: 0, w: 0, h: 0, color: next.palette?.deep || '#000000', opacity: 0.55 });
        break;
      }
      case 'add-scrim': {
        // Text protection: a soft palette gradient under the headline (or quote).
        const at = next.layers.findIndex(l => l.role === 'headline' || l.role === 'quote');
        if (at < 0) return next;
        const t = next.layers[at];
        const pad = 70;
        next.layers.splice(at, 0, { type: 'shape', shape: 'gradient', x: 0, y: Math.max(0, t.y - pad), w: W, h: t.h + pad * 2, color: next.palette?.deep || '#000000', stops: [[0, 0], [0.3, 0.6], [0.7, 0.7], [1, 0]] });
        break;
      }
      default:
        return next;
    }
    next.fixApplied = op;
    return next;
  }

  // ─── Free heuristic score (pre-filter and the no-AI judge) ──────────────
  // report: from render() (measured text sizes, overflow, contrast samples).
  function scoreReport(report = {}, scene = {}) {
    const issues = [];
    let score = 4.4;
    const items = report.items || [];
    const W = scene.size?.w || 1080;
    const phone = 390 / W; // what a 1080 design is at phone width
    const headline = items.find(i => i.role === 'headline' || i.role === 'quote');
    if (headline) {
      if (headline.overflow) { score -= 1.2; issues.push({ fix: 'shorter-headline', what: 'the headline does not fit its box' }); }
      if (headline.size * phone < 22) { score -= 0.6; issues.push({ fix: 'shorter-headline', what: `the headline is ${Math.round(headline.size * phone)}px on a phone` }); }
      if (headline.contrast && headline.contrast < 3) { score -= 0.8; issues.push({ fix: 'more-contrast', what: `headline contrast ${headline.contrast.toFixed(1)}:1` }); }
    }
    const number = items.find(i => i.type === 'number');
    if (number && number.size * phone < 40 && scene.focal === 'number') { score -= 0.5; issues.push({ fix: 'bigger-number', what: 'the hero number is small at phone size' }); }
    items.filter(i => i.contrast && i.contrast < 2.2 && i.role !== 'headline').forEach(i => { score -= 0.25; issues.push({ fix: 'more-contrast', what: `${i.role || i.type} contrast ${i.contrast.toFixed(1)}:1` }); });
    items.filter(i => i.overflow && i.role !== 'headline').forEach(i => { score -= 0.3; issues.push({ fix: 'less-clutter', what: `${i.role || i.type} is cut off` }); });
    const textLayers = (scene.layers || []).filter(l => TEXTISH.has(l.type)).length;
    if (textLayers > 9) { score -= 0.4; issues.push({ fix: 'less-clutter', what: `${textLayers} text elements` }); }
    if ((report.missing || []).length) { score -= 0.8; issues.push({ fix: '', what: `missing image (${report.missing.length})` }); }
    return { score: Math.max(1, Math.min(5, Number(score.toFixed(2)))), issues, fix: issues.find(i => i.fix)?.fix || '' };
  }

  // ─── Renderer (browser) ─────────────────────────────────────────────────
  const imageCache = new Map();
  const loaded = new Map(); // src -> decoded image (sync access while drawing)
  const ES_MARK = (box = '#0A7DFA', type = 'white') => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg width="123" height="105" viewBox="0 0 123 105" xmlns="http://www.w3.org/2000/svg"><path d="M122.332 0H0V104.066H122.332V0Z" fill="${box}"/><path d="M54.1567 57.7938H31.2568V75.8168H57.1807L55.1537 89.8498H14.2188V14.2178H55.1977V28.4348H31.2568V43.6498H54.1567V57.7938Z" fill="${type}"/><path d="M78.0299 67.9531C78.4659 74.1651 80.2329 78.4391 85.4259 78.4391C90.4709 78.4391 92.0879 75.0431 92.0879 70.7441C92.0879 65.5101 89.4569 62.4321 80.5609 57.8731C67.4239 51.0901 62.4629 45.3651 62.4629 34.2501C62.4629 21.3121 70.3689 12.8281 85.3519 12.8281C102.977 12.8281 108.02 23.8411 108.164 35.4551H91.4339C91.1449 30.1881 90.1819 25.6621 85.2459 25.6621C81.3809 25.6621 79.6519 28.1691 79.6519 32.3891C79.6519 36.7211 81.3409 38.9551 89.5659 43.0661C103.584 50.1251 109.535 56.0941 109.535 68.8101C109.535 81.3121 102.228 91.2741 85.2519 91.2741C66.8589 91.2741 61.2479 80.7941 60.8789 67.9541H78.0289L78.0299 67.9531Z" fill="${type}"/></svg>`)}`;

  function loadImage(src) {
    if (!src) return Promise.resolve(null);
    if (imageCache.has(src)) return imageCache.get(src);
    const promise = new Promise(resolve => {
      if (String(src).startsWith('proc:')) { const art = procArt(String(src).slice(5)); loaded.set(src, art); return resolve(art); }
      const img = new Image();
      if (/^https?:/i.test(src) && !src.startsWith(location.origin)) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => { loaded.set(src, img); resolve(img); };
      img.onerror = () => resolve(null);
      img.src = src;
    });
    imageCache.set(src, promise);
    return promise;
  }

  const makeCanvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };

  // ES vector art (no AI): drawn shapes for concept art when no AI image exists.
  function procArt(kind) {
    const c = makeCanvas(800, 800);
    const g = c.getContext('2d');
    const gold = (y0, y1) => {
      const grad = g.createLinearGradient(0, y0, 0, y1);
      grad.addColorStop(0, '#FFF1B8');
      grad.addColorStop(0.35, '#F5C542');
      grad.addColorStop(0.7, '#C8901E');
      grad.addColorStop(1, '#8A5A0B');
      return grad;
    };
    const sheen = (x, y, w, h) => {
      const grad = g.createLinearGradient(x, 0, x + w, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
      grad.addColorStop(0.55, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(x, y, w, h);
    };
    if (kind === 'trophy') {
      g.save();
      // Handles
      g.lineWidth = 34;
      g.strokeStyle = gold(120, 420);
      g.beginPath(); g.moveTo(230, 170); g.bezierCurveTo(90, 170, 90, 380, 270, 400); g.stroke();
      g.beginPath(); g.moveTo(570, 170); g.bezierCurveTo(710, 170, 710, 380, 530, 400); g.stroke();
      // Cup
      g.fillStyle = gold(110, 520);
      g.beginPath();
      g.moveTo(210, 110); g.lineTo(590, 110);
      g.bezierCurveTo(590, 360, 520, 470, 430, 500);
      g.lineTo(370, 500);
      g.bezierCurveTo(280, 470, 210, 360, 210, 110);
      g.closePath(); g.fill();
      g.save(); g.clip(); sheen(250, 100, 160, 420); g.restore();
      g.fillStyle = '#FFF4CC'; g.fillRect(200, 96, 400, 26);
      // Stem + knot
      g.fillStyle = gold(500, 640);
      g.fillRect(372, 500, 56, 110);
      g.beginPath(); g.ellipse(400, 560, 58, 22, 0, 0, Math.PI * 2); g.fill();
      // Base
      g.fillStyle = gold(600, 760);
      g.beginPath(); g.moveTo(290, 610); g.lineTo(510, 610); g.lineTo(540, 690); g.lineTo(260, 690); g.closePath(); g.fill();
      g.fillStyle = '#2A1B05'; g.fillRect(230, 690, 340, 74);
      g.fillStyle = gold(690, 770); g.fillRect(230, 690, 340, 10);
      g.restore();
    } else if (kind === 'golf-ball') {
      const grad = g.createRadialGradient(330, 300, 40, 400, 400, 330);
      grad.addColorStop(0, '#FFFFFF'); grad.addColorStop(0.7, '#E9EDF1'); grad.addColorStop(1, '#A9B3BD');
      g.fillStyle = grad; g.beginPath(); g.arc(400, 400, 320, 0, Math.PI * 2); g.fill();
      g.save(); g.beginPath(); g.arc(400, 400, 320, 0, Math.PI * 2); g.clip();
      for (let y = 100; y < 720; y += 46) for (let x = 100 + ((y / 46) % 2) * 23; x < 720; x += 46) {
        const d = Math.hypot(x - 400, y - 400) / 320;
        if (d > 1) continue;
        g.fillStyle = `rgba(80,95,110,${0.12 + d * 0.18})`;
        g.beginPath(); g.ellipse(x, y, 13 * (1 - d * 0.45), 13, Math.atan2(y - 400, x - 400), 0, Math.PI * 2); g.fill();
      }
      g.restore();
    } else if (kind === 'football') {
      const grad = g.createLinearGradient(0, 200, 0, 600);
      grad.addColorStop(0, '#9B5A2B'); grad.addColorStop(1, '#4E2A10');
      g.fillStyle = grad; g.save(); g.translate(400, 400); g.rotate(-0.5);
      g.beginPath(); g.ellipse(0, 0, 340, 200, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#FFFFFF'; g.fillRect(-220, -8, 40, 16); g.fillRect(180, -8, 40, 16);
      g.fillRect(-70, -6, 140, 12);
      for (let x = -55; x <= 55; x += 22) g.fillRect(x - 4, -26, 8, 52);
      g.restore();
    } else if (kind === 'basketball') {
      const grad = g.createRadialGradient(330, 300, 40, 400, 400, 330);
      grad.addColorStop(0, '#FF9A3D'); grad.addColorStop(1, '#B4480C');
      g.fillStyle = grad; g.beginPath(); g.arc(400, 400, 320, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2A1205'; g.lineWidth = 14;
      g.beginPath(); g.arc(400, 400, 320, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(80, 400); g.lineTo(720, 400); g.stroke();
      g.beginPath(); g.moveTo(400, 80); g.lineTo(400, 720); g.stroke();
      g.beginPath(); g.ellipse(160, 400, 120, 300, 0, -Math.PI / 2, Math.PI / 2); g.stroke();
      g.beginPath(); g.ellipse(640, 400, 120, 300, 0, Math.PI / 2, Math.PI * 1.5); g.stroke();
    } else if (kind === 'lights') {
      for (let k = 0; k < 9; k += 1) {
        const a = -Math.PI / 2 + (k - 4) * 0.16;
        const grad = g.createLinearGradient(400, 60, 400 + Math.cos(a) * 760, 60 + Math.sin(-a) * 760);
        grad.addColorStop(0, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.beginPath(); g.moveTo(400, 60); g.lineTo(400 + Math.cos(a - 0.04) * 900, 60 - Math.sin(a - 0.04) * -900); g.lineTo(400 + Math.cos(a + 0.04) * 900, 60 - Math.sin(a + 0.04) * -900); g.closePath(); g.fill();
      }
    } else if (kind === 'cards') {
      for (let k = -2; k <= 2; k += 1) {
        g.save(); g.translate(400, 560); g.rotate(k * 0.16);
        g.fillStyle = k === 0 ? '#FFFFFF' : '#E7ECF2';
        g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 24;
        g.fillRect(-150, -420, 300, 420);
        g.shadowBlur = 0;
        g.fillStyle = '#0A7DFA'; g.fillRect(-150, -420, 300, 60);
        g.fillStyle = '#C9D3DD'; g.fillRect(-110, -320, 220, 18); g.fillRect(-110, -280, 160, 18); g.fillRect(-110, -240, 190, 18);
        g.restore();
      }
    } else if (kind === 'money') {
      for (let k = 0; k < 7; k += 1) {
        g.save(); g.translate(400, 620 - k * 46); g.rotate((k % 2 ? 1 : -1) * 0.03);
        g.fillStyle = '#2F6B3C'; g.fillRect(-300, -40, 600, 80);
        g.fillStyle = '#5FA36E'; g.fillRect(-286, -30, 572, 60);
        g.fillStyle = '#2F6B3C'; g.beginPath(); g.arc(0, 0, 24, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    }
    return c;
  }

  // ─── Pixel tools (all in-canvas, no ctx.filter needed: Safari-safe) ────
  // Seeded noise so a design exports the same pixels every time.
  function prng(seed = 7) {
    let t = seed >>> 0;
    return () => {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Texture patterns (made once per kind / colour).
  const textures = new Map();
  function texture(kind, color = '#FFFFFF') {
    const key = `${kind}|${color}`;
    if (textures.has(key)) return textures.get(key);
    let c;
    if (kind === 'grain') {
      // Film grain: soft, near-gaussian, mid-grey centred (overlay-neutral).
      c = makeCanvas(256, 256);
      const g = c.getContext('2d');
      const img = g.createImageData(256, 256);
      const rnd = prng(11);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 128 + ((rnd() + rnd() + rnd()) / 3 - 0.5) * 190;
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    } else if (kind === 'grid') {
      c = makeCanvas(60, 60);
      const g = c.getContext('2d');
      g.strokeStyle = color; g.lineWidth = 2;
      g.strokeRect(0, 0, 60, 60);
    } else if (kind === 'lines') {
      c = makeCanvas(48, 48);
      const g = c.getContext('2d');
      g.strokeStyle = color; g.lineWidth = 6;
      g.beginPath(); g.moveTo(-12, 48); g.lineTo(48, -12); g.moveTo(12, 60); g.lineTo(60, 12); g.stroke();
    } else if (kind === 'scan') {
      // Broadcast scanlines.
      c = makeCanvas(8, 6);
      const g = c.getContext('2d');
      g.fillStyle = color; g.fillRect(0, 0, 8, 2);
    } else if (kind === 'dots') {
      c = makeCanvas(24, 24);
      const g = c.getContext('2d');
      g.fillStyle = color;
      g.beginPath(); g.arc(6, 6, 3, 0, Math.PI * 2); g.arc(18, 18, 3, 0, Math.PI * 2); g.fill();
    }
    textures.set(key, c);
    return c;
  }

  let filterOk = null;
  function canFilter() {
    if (filterOk != null) return filterOk;
    try {
      const g = makeCanvas(2, 2).getContext('2d');
      g.filter = 'blur(2px)';
      filterOk = g.filter === 'blur(2px)';
    } catch (error) { filterOk = false; }
    return filterOk;
  }
  // Gaussian-ish blur of a canvas (edge-extended so borders never go dark).
  function blurCanvas(src, radius) {
    if (!(radius > 0.5)) return src;
    const pad = Math.ceil(radius * 3);
    const big = makeCanvas(src.width + pad * 2, src.height + pad * 2);
    const bg = big.getContext('2d');
    bg.drawImage(src, 0, 0, big.width, big.height);
    bg.drawImage(src, pad, pad);
    const out = makeCanvas(src.width, src.height);
    const og = out.getContext('2d');
    if (canFilter()) {
      og.filter = `blur(${radius}px)`;
      og.drawImage(big, -pad, -pad);
      og.filter = 'none';
      return out;
    }
    // Fallback: downsample / upsample twice (box-filter cascade).
    const f = Math.max(2, Math.round(radius / 1.6));
    const small = makeCanvas(big.width / f, big.height / f);
    const sg = small.getContext('2d');
    sg.imageSmoothingQuality = 'high';
    sg.drawImage(big, 0, 0, small.width, small.height);
    const mid = makeCanvas(small.width, small.height);
    mid.getContext('2d').drawImage(small, 0, 0);
    og.imageSmoothingQuality = 'high';
    og.drawImage(mid, 0, 0, mid.width, mid.height, -pad, -pad, big.width, big.height);
    return out;
  }

  // Gradient map (duotone = 2 stops, tritone = 3) with levels and an S-curve,
  // like a Photoshop Gradient Map over Curves. Alpha is kept (cut-outs stay cut).
  function toneLut(stops, curve = 1.3) {
    const cols = stops.map(rgb);
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i += 1) {
      let t = Math.min(1, Math.max(0, (i / 255 - 0.05) / 0.9));
      t = t < 0.5 ? 0.5 * (2 * t) ** curve : 1 - 0.5 * (2 * (1 - t)) ** curve;
      const seg = Math.min(cols.length - 2, Math.floor(t * (cols.length - 1)));
      const u = t * (cols.length - 1) - seg;
      for (let k = 0; k < 3; k += 1) lut[i * 3 + k] = cols[seg][k] + (cols[seg + 1][k] - cols[seg][k]) * u;
    }
    return lut;
  }
  function toneMap(canvas, stops, curve) {
    const g = canvas.getContext('2d');
    try {
      const data = g.getImageData(0, 0, canvas.width, canvas.height);
      const lut = toneLut(stops, curve);
      const d = data.data;
      for (let i = 0; i < d.length; i += 4) {
        const l = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * 3;
        d[i] = lut[l]; d[i + 1] = lut[l + 1]; d[i + 2] = lut[l + 2];
      }
      g.putImageData(data, 0, 0);
    } catch (error) {
      // Cross-origin pixels: a colour wash keeps the look.
      g.save();
      g.globalCompositeOperation = 'color';
      g.fillStyle = stops[stops.length - 1];
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.restore();
    }
    return canvas;
  }
  // Auto levels: stretch the 2nd-98th luminance percentiles to full range
  // (a dark arena photo still reads as a halftone or a tone map).
  function autoLevels(canvas) {
    const g = canvas.getContext('2d');
    try {
      const data = g.getImageData(0, 0, canvas.width, canvas.height);
      const d = data.data;
      const hist = new Uint32Array(256);
      let n = 0;
      for (let i = 0; i < d.length; i += 16) { if (d[i + 3] > 20) { hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])] += 1; n += 1; } }
      let lo = 0; let hi = 255; let acc = 0;
      for (let k = 0; k < 256; k += 1) { acc += hist[k]; if (acc > n * 0.02) { lo = k; break; } }
      acc = 0;
      for (let k = 255; k >= 0; k -= 1) { acc += hist[k]; if (acc > n * 0.02) { hi = k; break; } }
      if (hi - lo < 40 || (lo < 8 && hi > 247)) return canvas;
      const f = 255 / (hi - lo);
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c += 1) d[i + c] = (d[i + c] - lo) * f;
      g.putImageData(data, 0, 0);
    } catch (error) { /* cross-origin */ }
    return canvas;
  }
  // Kept for callers of the old API (luminance dark -> light).
  function duotone(img, dark, light, w, h) {
    const c = makeCanvas(w, h);
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return toneMap(c, [dark, light], 1.15);
  }

  // Newsprint halftone: dots on a rotated grid, radius from darkness.
  function halftone(canvas, cell, color, angle = 45) {
    const w = canvas.width;
    const h = canvas.height;
    const out = makeCanvas(w, h);
    const og = out.getContext('2d');
    let d;
    try { d = canvas.getContext('2d').getImageData(0, 0, w, h).data; } catch (error) { og.drawImage(canvas, 0, 0); return out; }
    const a = (angle * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const reach = Math.hypot(w, h);
    og.fillStyle = color;
    for (let v = -reach; v < reach; v += cell) {
      for (let u = -reach; u < reach; u += cell) {
        const x = w / 2 + u * cos - v * sin;
        const y = h / 2 + u * sin + v * cos;
        if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;
        const px = Math.min(w - 1, Math.max(0, Math.round(x)));
        const py = Math.min(h - 1, Math.max(0, Math.round(y)));
        const i = (py * w + px) * 4;
        if (d[i + 3] < 20) continue;
        const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        const r = cell * 0.56 * Math.sqrt(Math.max(0, 1 - l));
        if (r < 0.35) continue;
        og.beginPath(); og.arc(x, y, r, 0, Math.PI * 2); og.fill();
      }
    }
    return out;
  }

  // Gradient (alpha) mask: fade a buffer toward one edge.
  function fadeMask(canvas, fade) {
    const g = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const to = fade.to || 'bottom';
    const grad = to === 'top' ? g.createLinearGradient(0, h, 0, 0) : to === 'left' ? g.createLinearGradient(w, 0, 0, 0) : to === 'right' ? g.createLinearGradient(0, 0, w, 0) : g.createLinearGradient(0, 0, 0, h);
    const from = Math.min(0.95, Math.max(0, fade.from ?? 0.55));
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(from, 'rgba(0,0,0,1)');
    grad.addColorStop(Math.min(1, from + (1 - from) * 0.55), 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.save();
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.restore();
  }

  // Rim light on a cut-out: the silhouette's edge that faces the light.
  function rimLight(src, color, width, angle, alpha) {
    const c = makeCanvas(src.width, src.height);
    const g = c.getContext('2d');
    const a = ((angle ?? -50) * Math.PI) / 180;
    const pass = (wd, al) => {
      const t = makeCanvas(src.width, src.height);
      const tg = t.getContext('2d');
      tg.drawImage(src, 0, 0);
      tg.globalCompositeOperation = 'destination-out';
      tg.drawImage(src, -Math.cos(a) * wd, -Math.sin(a) * wd);
      tg.globalCompositeOperation = 'source-in';
      tg.fillStyle = color;
      tg.fillRect(0, 0, t.width, t.height);
      g.globalAlpha = al;
      g.drawImage(t, 0, 0);
    };
    pass(width * 2.4, alpha * 0.35);
    pass(width, alpha);
    return c;
  }

  function fontString(font, size, weight) {
    return `${weight || FONT_WEIGHT[font] || 700} ${Math.round(size * 100) / 100}px ${FONTS[font] || FONTS.display}`;
  }

  // ─── Type engine ────────────────────────────────────────────────────────
  // Figma-style text boxes: all-caps lines are set cap-top to baseline (no
  // phantom ascender space), so a headline's last baseline sits exactly on its
  // box bottom and its first cap on its box top. Tracking follows size (tight
  // at poster sizes, open for small caps labels). Lines are balanced; body copy
  // never ends on a one-word widow.
  let fontsReady = false;
  const capCache = {};
  function capRatio(g, font) {
    if (capCache[font]) return capCache[font];
    const prev = g.font;
    g.font = fontString(font, 200);
    const m = g.measureText('HEXB');
    const r = m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent / 200 : (font === 'display' ? 0.72 : 0.71);
    g.font = prev;
    if (fontsReady) capCache[font] = r;
    return r;
  }
  function autoTracking(font, size) {
    if (font === 'display') return size >= 260 ? -0.022 * size : size >= 160 ? -0.016 * size : size >= 96 ? -0.01 * size : size >= 60 ? -0.004 * size : 0.006 * size;
    if (font === 'condensed') return size <= 30 ? 0.08 * size : size <= 52 ? 0.05 * size : 0.02 * size;
    return 0;
  }
  const setTracking = (g, px) => { if ('letterSpacing' in g) g.letterSpacing = `${px}px`; };
  const isCaps = text => text === text.toUpperCase();
  // measureText width minus the trailing letter-space (so alignment is true).
  const textW = (g, text, track) => g.measureText(text).width - (text ? track : 0);

  // Greedy wrap; returns lines or null when a single word is too wide.
  function wrap(g, text, width, track = 0) {
    const list = words(text);
    const lines = [];
    let line = '';
    for (const word of list) {
      const next = line ? `${line} ${word}` : word;
      if (textW(g, next, track) <= width || !line) {
        if (!line && textW(g, word, track) > width) return null;
        line = next;
      } else {
        // A later word wider than the box on its own does not fit either.
        if (textW(g, word, track) > width) return null;
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  // Balanced wrap: the narrowest width that keeps the line count (even rag).
  function balance(g, lines, width, track = 0) {
    if (!lines || lines.length < 2) return lines;
    const all = lines.join(' ');
    let lo = width * 0.45;
    let hi = width;
    let best = lines;
    for (let k = 0; k < 12; k += 1) {
      const mid = (lo + hi) / 2;
      const tryLines = wrap(g, all, mid, track);
      if (tryLines && tryLines.length === lines.length) { best = tryLines; hi = mid; } else lo = mid;
    }
    return best;
  }
  // No widows: pull a word down so the last line has at least two words.
  function unwidow(g, lines, width, track = 0) {
    if (!lines || lines.length < 2 || lines[lines.length - 1].split(' ').length > 1) return lines;
    const prev = lines[lines.length - 2].split(' ');
    if (prev.length < 3) return lines;
    const moved = prev.pop();
    const last = `${moved} ${lines[lines.length - 1]}`;
    if (textW(g, last, track) > width) return lines;
    return [...lines.slice(0, -2), prev.join(' '), last];
  }

  function boxMetrics(layer, cap) {
    const b = layer.box || {};
    return { padX: b.pad ?? Math.round(cap * 0.34), padY: b.padY ?? Math.round(cap * 0.2), gap: b.gap ?? Math.round(cap * 0.16) };
  }
  // Vertical metrics for one size: where the first baseline sits from the box
  // top, the line step, and the block height for n lines.
  function vMetrics(g, layer, size) {
    const font = layer.font || 'display';
    const caps = isCaps(clean(layer.text));
    const cap = capRatio(g, font) * size;
    const lh = layer.lineHeight || (font === 'display' ? 0.9 : 1.18);
    const box = layer.box ? boxMetrics(layer, cap) : null;
    const step = box ? cap + box.padY * 2 + box.gap : Math.max(size * lh, caps ? cap * 1.12 : size);
    const first = (box ? box.padY : 0) + (caps ? cap : size * 0.78);
    const tail = (box ? box.padY : 0) + (caps ? 0 : size * 0.22);
    return { font, caps, cap, lh, step, first, tail, box, height: n => first + (n - 1) * step + tail };
  }

  function fitText(g, layer) {
    const font = layer.font || 'display';
    const maxLines = layer.maxLines || 3;
    let size = layer.size || 100;
    const min = layer.minSize || Math.min(size, 24);
    const attempt = sz => {
      const vm = vMetrics(g, layer, sz);
      const track = layer.tracking ?? autoTracking(font, sz);
      g.font = fontString(font, sz, layer.weight);
      setTracking(g, track);
      const avail = layer.w - (vm.box ? vm.box.padX * 2 : 0);
      const lines = wrap(g, layer.text, avail, track);
      return { vm, track, avail, lines };
    };
    const finish = (sz, a, overflow) => {
      let lines = a.lines || [layer.text];
      if (!overflow) lines = layer.role === 'body' || font === 'body' ? unwidow(g, lines, a.avail, a.track) : (layer.balance === false ? lines : balance(g, lines, a.avail, a.track));
      return { size: sz, lines, lh: a.vm.lh, vm: a.vm, track: a.track, overflow };
    };
    while (size >= min) {
      const a = attempt(size);
      if (a.lines && a.lines.length <= maxLines && a.vm.height(a.lines.length) <= layer.h + 1) return finish(size, a, false);
      size -= Math.max(1, Math.round(size * 0.04));
    }
    const a = attempt(min);
    const lines = a.lines || [layer.text];
    const overflow = !a.lines || lines.length > maxLines || a.vm.height(Math.min(lines.length, maxLines)) > layer.h + 1;
    a.lines = lines.slice(0, maxLines);
    return finish(min, a, overflow);
  }

  // Colour statistics under a box: 3x3 samples -> mean, every sample, busyness.
  function sampleStats(g, x, y, w, h, scale) {
    try {
      const cols = [];
      let sum = 0; let sq = 0;
      [0.12, 0.5, 0.88].forEach(py => [0.1, 0.5, 0.9].forEach(px => {
        const d = g.getImageData(Math.round((x + w * px) * scale), Math.round((y + h * py) * scale), 1, 1).data;
        const hex = toHex([d[0], d[1], d[2]]);
        cols.push(hex);
        const l = lum(hex);
        sum += l; sq += l * l;
      }));
      const mean = sum / cols.length;
      const r = cols.reduce((acc, c) => acc.map((v, i) => v + rgb(c)[i] / cols.length), [0, 0, 0]);
      return { mean: toHex(r), cols, busy: Math.sqrt(Math.max(0, sq / cols.length - mean * mean)) };
    } catch (error) {
      return null;
    }
  }
  // The colour under a box (for the contrast check): mean of a few samples.
  function sampleColor(g, x, y, w, h, scale) {
    const st = sampleStats(g, x, y, w, h, scale);
    return st ? st.mean : '';
  }

  function applyFx(g, fx = {}, s) {
    if (fx.opacity != null) g.globalAlpha = Math.max(0, Math.min(1, fx.opacity));
    if (fx.blend && BLENDS.includes(fx.blend) && fx.blend !== 'normal') g.globalCompositeOperation = fx.blend;
    const shadow = fx.shadow || fx.glow;
    if (shadow) {
      g.shadowColor = rgba(shadow.color || '#000000', shadow.alpha ?? 0.5);
      g.shadowBlur = (shadow.blur || 20) * s;
      g.shadowOffsetX = (shadow.x || 0) * s;
      g.shadowOffsetY = (shadow.y || 0) * s;
    }
  }

  // Cover-crop source rect for a box, around a focus point (0..1).
  function coverRect(iw, ih, w, h, focus = {}, zoom = 1) {
    const scale = Math.max(w / iw, h / ih) * zoom;
    const sw = w / scale;
    const sh = h / scale;
    const fx = focus.x ?? 0.5;
    const fy = focus.y ?? 0.35;
    const sx = Math.max(0, Math.min(iw - sw, iw * fx - sw / 2));
    const sy = Math.max(0, Math.min(ih - sh, ih * fy - sh / 2));
    return { sx, sy, sw, sh };
  }

  function maskPath(g, layer, s) {
    const { x, y, w, h } = layer;
    g.beginPath();
    switch (layer.mask) {
      case 'circle': g.ellipse((x + w / 2) * s, (y + h / 2) * s, (w / 2) * s, (h / 2) * s, 0, 0, Math.PI * 2); break;
      case 'arch': g.moveTo(x * s, (y + h) * s); g.lineTo(x * s, (y + w / 2) * s); g.arc((x + w / 2) * s, (y + w / 2) * s, (w / 2) * s, Math.PI, 0); g.lineTo((x + w) * s, (y + h) * s); g.closePath(); break;
      case 'slant-l': g.moveTo((x + w * 0.22) * s, y * s); g.lineTo((x + w) * s, y * s); g.lineTo((x + w) * s, (y + h) * s); g.lineTo(x * s, (y + h) * s); g.closePath(); break;
      case 'slant-r': g.moveTo(x * s, y * s); g.lineTo((x + w) * s, y * s); g.lineTo((x + w * 0.78) * s, (y + h) * s); g.lineTo(x * s, (y + h) * s); g.closePath(); break;
      case 'poly': (layer.points || []).forEach(([px, py], i) => (i ? g.lineTo(px * s, py * s) : g.moveTo(px * s, py * s))); g.closePath(); break;
      case 'round': if (g.roundRect) g.roundRect(x * s, y * s, w * s, h * s, (layer.radius || 24) * s); else g.rect(x * s, y * s, w * s, h * s); break;
      default: g.rect(x * s, y * s, w * s, h * s);
    }
  }

  async function drawBackground(g, layer, W, H, s) {
    const fill = layer.fill || { kind: 'solid', colors: ['#000000'] };
    const colors = fill.colors?.length ? fill.colors : ['#000000'];
    if (fill.kind === 'linear') {
      const a = ((fill.angle ?? 90) * Math.PI) / 180;
      const grad = g.createLinearGradient(W * s / 2 - Math.cos(a) * W * s / 2, H * s / 2 - Math.sin(a) * H * s / 2, W * s / 2 + Math.cos(a) * W * s / 2, H * s / 2 + Math.sin(a) * H * s / 2);
      colors.forEach((c, i) => grad.addColorStop(i / Math.max(1, colors.length - 1), c));
      g.fillStyle = grad;
    } else if (fill.kind === 'radial') {
      const at = fill.at || { x: 0.5, y: 0.4 };
      const grad = g.createRadialGradient(W * at.x * s, H * at.y * s, 0, W * at.x * s, H * at.y * s, Math.max(W, H) * (fill.reach || 0.85) * s);
      colors.forEach((c, i) => grad.addColorStop(i / Math.max(1, colors.length - 1), c));
      g.fillStyle = grad;
    } else {
      g.fillStyle = colors[0];
    }
    g.fillRect(0, 0, W * s, H * s);
    if (layer.image?.src) {
      const img = await loadImage(layer.image.src);
      if (img) {
        g.save();
        g.globalAlpha = layer.image.opacity ?? 1;
        const buf = photoBuffer(img, { ...layer.image, x: 0, y: 0, w: W, h: H }, s);
        g.drawImage(buf, 0, 0);
        g.restore();
      }
    }
    if (layer.texture) drawTexture(g, layer.texture, layer.textureColor || '#FFFFFF', layer.textureOpacity ?? 0.1, W, H, s, layer.fill?.at);
  }

  function drawTexture(g, kind, color, opacity, W, H, s, at = { x: 0.5, y: 0.4 }) {
    g.save();
    g.globalAlpha = opacity;
    if (kind === 'grain') {
      g.globalCompositeOperation = 'overlay';
      g.fillStyle = g.createPattern(texture('grain'), 'repeat');
      g.fillRect(0, 0, W * s, H * s);
    } else if (kind === 'halftone') {
      g.fillStyle = color;
      const step = 22 * s;
      for (let y = 0; y < H * s; y += step) {
        for (let x = (Math.round(y / step) % 2) * step / 2; x < W * s; x += step) {
          const t = Math.max(0, 1 - Math.hypot(x / s - W, y / s - 0) / (W * 1.1));
          const r = step * 0.42 * t;
          if (r < 0.6) continue;
          g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        }
      }
    } else if (kind === 'rays') {
      const cx = W * (at?.x ?? 0.5) * s;
      const cy = H * (at?.y ?? 0.4) * s;
      g.fillStyle = color;
      for (let k = 0; k < 24; k += 1) {
        const a0 = (k / 24) * Math.PI * 2;
        g.beginPath(); g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a0) * 2000 * s, cy + Math.sin(a0) * 2000 * s);
        g.lineTo(cx + Math.cos(a0 + 0.09) * 2000 * s, cy + Math.sin(a0 + 0.09) * 2000 * s);
        g.closePath(); g.fill();
      }
    } else if (kind === 'grid' || kind === 'lines' || kind === 'scan' || kind === 'dots') {
      const pat = g.createPattern(texture(kind, color), 'repeat');
      if (pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix().scale(s, s));
      g.fillStyle = pat;
      g.fillRect(0, 0, W * s, H * s);
    }
    g.restore();
  }

  // A shape's outline as a path (rect / round rect / circle / poly).
  function shapePath(g, layer, s) {
    const { x = 0, y = 0, w = 0, h = 0 } = layer;
    g.beginPath();
    if (layer.shape === 'circle') g.ellipse((x + w / 2) * s, (y + h / 2) * s, (w / 2) * s, (h / 2) * s, 0, 0, Math.PI * 2);
    else if (layer.shape === 'poly') (layer.points || []).forEach(([px, py], i) => (i ? g.lineTo(px * s, py * s) : g.moveTo(px * s, py * s)));
    else if (layer.radius && g.roundRect) g.roundRect(x * s, y * s, w * s, h * s, layer.radius * s);
    else g.rect(x * s, y * s, w * s, h * s);
    g.closePath();
  }
  // Inner shadow: clip to the shape, cast a shadow from a ring just outside it.
  function innerShadow(g, layer, s, inner) {
    g.save();
    shapePath(g, layer, s);
    g.clip();
    g.shadowColor = rgba(inner.color || '#000000', inner.alpha ?? 0.45);
    g.shadowBlur = (inner.blur || 24) * s;
    g.shadowOffsetX = (inner.x || 0) * s;
    g.shadowOffsetY = (inner.y || 0) * s;
    g.lineWidth = 200 * s;
    g.strokeStyle = '#000000';
    const { x = 0, y = 0, w = 0, h = 0 } = layer;
    if (layer.shape === 'circle') { g.beginPath(); g.ellipse((x + w / 2) * s, (y + h / 2) * s, (w / 2 + 100) * s, (h / 2 + 100) * s, 0, 0, Math.PI * 2); g.stroke(); } else g.strokeRect((x - 100) * s, (y - 100) * s, (w + 200) * s, (h + 200) * s);
    g.restore();
  }

  function drawShape(g, layer, W, H, s) {
    g.save();
    applyFx(g, { opacity: layer.opacity, ...(layer.fx || {}) }, s);
    if (layer.blend) g.globalCompositeOperation = layer.blend;
    const { x = 0, y = 0, w = 0, h = 0 } = layer;
    if (layer.shape === 'grain') {
      g.restore();
      drawTexture(g, 'grain', '#FFFFFF', layer.opacity ?? 0.08, W, H, s);
      return;
    }
    if (layer.shape === 'texture') {
      g.restore();
      drawTexture(g, layer.texture || 'dots', layer.color || '#FFFFFF', layer.opacity ?? 0.1, W, H, s, layer.at);
      return;
    }
    if (layer.shape === 'gradient') {
      const dir = layer.dir || 'down';
      const grad = dir === 'right' ? g.createLinearGradient(x * s, 0, (x + w) * s, 0) : dir === 'left' ? g.createLinearGradient((x + w) * s, 0, x * s, 0) : dir === 'up' ? g.createLinearGradient(0, (y + h) * s, 0, y * s) : g.createLinearGradient(0, y * s, 0, (y + h) * s);
      (layer.stops || [[0, 0], [1, 0.9]]).forEach(([at, alpha]) => grad.addColorStop(at, rgba(layer.color, alpha)));
      g.fillStyle = grad;
      g.fillRect(x * s, y * s, w * s, h * s);
    } else if (layer.shape === 'vignette') {
      const cx = (W / 2) * s;
      const cy = (H * (layer.cy ?? 0.45)) * s;
      const grad = g.createRadialGradient(cx, cy, Math.min(W, H) * 0.32 * s, cx, cy, Math.hypot(W, H) * 0.62 * s);
      grad.addColorStop(0, rgba(layer.color || '#000000', 0));
      grad.addColorStop(1, rgba(layer.color || '#000000', 1));
      g.fillStyle = grad;
      g.fillRect(0, 0, W * s, H * s);
    } else if (layer.shape === 'leak') {
      // Light leak: warm film burn from one edge, screened in.
      g.globalCompositeOperation = 'screen';
      const blob = (bx, by, r, col, a) => {
        const grad = g.createRadialGradient(bx * s, by * s, 0, bx * s, by * s, r * s);
        grad.addColorStop(0, rgba(col, a));
        grad.addColorStop(0.45, rgba(col, a * 0.45));
        grad.addColorStop(1, rgba(col, 0));
        g.fillStyle = grad;
        g.fillRect((bx - r) * s, (by - r) * s, r * 2 * s, r * 2 * s);
      };
      blob(x + w * 0.5, y + h * 0.5, Math.max(w, h) * 0.6, layer.color || '#FFFFFF', 0.9);
      blob(x + w * 0.2, y + h * 0.8, Math.max(w, h) * 0.35, layer.color2 || layer.color || '#FFFFFF', 0.7);
    } else if (layer.shape === 'circle') {
      g.fillStyle = layer.color;
      shapePath(g, layer, s); g.fill();
    } else if (layer.shape === 'ring') {
      g.strokeStyle = layer.color; g.lineWidth = (layer.lineWidth || 8) * s;
      g.beginPath(); g.ellipse((x + w / 2) * s, (y + h / 2) * s, (w / 2) * s, (h / 2) * s, 0, 0, Math.PI * 2); g.stroke();
    } else if (layer.shape === 'arc') {
      // Gauge: a track and a value arc (value 0..1) on a semicircle, round caps.
      const cx = (x + w / 2) * s;
      const cy = (y + h) * s;
      const r = (Math.min(w / 2, h) - (layer.lineWidth || 40) / 2) * s;
      const a0 = Math.PI;
      g.lineCap = 'round';
      g.lineWidth = (layer.lineWidth || 40) * s;
      if (layer.track) { g.strokeStyle = layer.track; g.beginPath(); g.arc(cx, cy, r, a0, 2 * Math.PI); g.stroke(); }
      g.strokeStyle = layer.color;
      g.beginPath(); g.arc(cx, cy, r, a0, a0 + Math.PI * Math.max(0.01, Math.min(1, layer.value ?? 1))); g.stroke();
      if (layer.ticks) {
        g.lineWidth = 4 * s; g.lineCap = 'butt';
        g.strokeStyle = layer.track || layer.color;
        for (let k = 0; k <= layer.ticks; k += 1) {
          const t = a0 + (Math.PI * k) / layer.ticks;
          const r0 = r + (layer.lineWidth || 40) * 0.75 * s;
          g.beginPath(); g.moveTo(cx + Math.cos(t) * r0, cy + Math.sin(t) * r0); g.lineTo(cx + Math.cos(t) * (r0 + 18 * s), cy + Math.sin(t) * (r0 + 18 * s)); g.stroke();
        }
      }
    } else if (layer.shape === 'starburst') {
      const n = layer.points || 18;
      const cx = (x + w / 2) * s;
      const cy = (y + h / 2) * s;
      const ro = (Math.min(w, h) / 2) * s;
      const ri = ro * (layer.inner || 0.84);
      g.fillStyle = layer.color;
      g.beginPath();
      for (let k = 0; k < n * 2; k += 1) {
        const r = k % 2 ? ri : ro;
        const t = (Math.PI * k) / n - Math.PI / 2;
        if (k) g.lineTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r); else g.moveTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r);
      }
      g.closePath(); g.fill();
    } else if (layer.shape === 'sprockets') {
      // Film-strip holes along a band.
      const n = layer.count || Math.max(4, Math.round(w / 46));
      const hw = (w / n) * 0.5;
      g.fillStyle = layer.color;
      for (let k = 0; k < n; k += 1) {
        const hx = x + (w / n) * k + (w / n - hw) / 2;
        g.beginPath();
        if (g.roundRect) g.roundRect(hx * s, y * s, hw * s, h * s, 4 * s); else g.rect(hx * s, y * s, hw * s, h * s);
        g.fill();
      }
    } else if (layer.shape === 'perforation') {
      // Ticket tear line: a row (or column) of punched dots.
      const vertical = h > w;
      const len = vertical ? h : w;
      const r = (vertical ? w : h) / 2;
      const n = Math.max(3, Math.floor(len / (r * 3.2)));
      g.fillStyle = layer.color;
      for (let k = 0; k < n; k += 1) {
        const t = (len / n) * (k + 0.5);
        g.beginPath(); g.arc((vertical ? x + r : x + t) * s, (vertical ? y + t : y + r) * s, r * s, 0, Math.PI * 2); g.fill();
      }
    } else if (layer.shape === 'barcode') {
      // Decorative ticket barcode (seeded bars, never digits).
      const rnd = prng(layer.seed || 5);
      g.fillStyle = layer.color;
      for (let bx = x; bx < x + w;) {
        const bw = 3 + Math.floor(rnd() * 3) * 3;
        if (rnd() > 0.35) g.fillRect(bx * s, y * s, bw * s, h * s);
        bx += bw + 3;
      }
    } else if (layer.shape === 'poly') {
      g.fillStyle = layer.color;
      shapePath(g, layer, s); g.fill();
    } else if (layer.shape === 'quote') {
      // Two solid quote marks (drawn, so any font works).
      g.fillStyle = layer.color;
      const mark = (ox) => {
        const r = (h * 0.32);
        g.beginPath(); g.arc((ox + r) * s, (y + h - r) * s, r * s, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo((ox + r * 0.2) * s, (y + h - r) * s); g.quadraticCurveTo((ox + r * 0.1) * s, (y + h * 0.1) * s, (ox + r * 2) * s, y * s); g.lineTo((ox + r * 2) * s, (y + h * 0.18) * s); g.quadraticCurveTo((ox + r * 0.9) * s, (y + h * 0.3) * s, (ox + r * 1.4) * s, (y + h - r * 1.6) * s); g.closePath(); g.fill();
      };
      if (layer.flip) { g.translate((x + w / 2) * s, (y + h / 2) * s); g.rotate(Math.PI); g.translate(-(x + w / 2) * s, -(y + h / 2) * s); }
      mark(x);
      mark(x + w * 0.52);
    } else if (layer.shape === 'frame') {
      g.strokeStyle = layer.color; g.lineWidth = (layer.lineWidth || 6) * s;
      if (layer.radius && g.roundRect) { g.beginPath(); g.roundRect(x * s, y * s, w * s, h * s, layer.radius * s); g.stroke(); } else g.strokeRect(x * s, y * s, w * s, h * s);
    } else {
      g.fillStyle = layer.color;
      shapePath(g, layer, s); g.fill();
    }
    g.restore();
    if (layer.fx?.inner) innerShadow(g, layer, s, layer.fx.inner);
    if (layer.sheen) {
      // Foil sheen: a soft diagonal highlight clipped to the shape.
      g.save();
      shapePath(g, layer, s); g.clip();
      const grad = g.createLinearGradient(x * s, y * s, (x + w) * s, (y + h) * s);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.42, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, `rgba(255,255,255,${layer.sheen})`);
      grad.addColorStop(0.58, 'rgba(255,255,255,0)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalCompositeOperation = 'screen';
      g.fillStyle = grad;
      g.fillRect(x * s, y * s, w * s, h * s);
      g.restore();
    }
  }

  // The photo, treated, in its own buffer (box size): crop, depth blur, tone,
  // halftone, gradient mask and shape mask, then composited with its fx.
  const bufferCache = new Map();
  function photoBuffer(img, layer, s) {
    const { x, y, w, h } = layer;
    const key = JSON.stringify([img.src || img.width, w, h, s, layer.focus, layer.zoom, layer.blur, layer.levels, layer.duotone, layer.tritone, layer.curve, layer.grayscale, layer.halftone, layer.fade, layer.mask, layer.points, layer.radius, layer.vignette, x, y, layer.flip]);
    if (img.src && bufferCache.has(key)) return bufferCache.get(key);
    const bw = Math.max(1, Math.round(w * s));
    const bh = Math.max(1, Math.round(h * s));
    let buf = makeCanvas(bw, bh);
    const bg = buf.getContext('2d');
    bg.imageSmoothingQuality = 'high';
    const { sx, sy, sw, sh } = coverRect(img.width, img.height, w, h, layer.focus, layer.zoom || 1);
    if (layer.flip) { bg.translate(bw, 0); bg.scale(-1, 1); }
    bg.drawImage(img, sx, sy, sw, sh, 0, 0, bw, bh);
    bg.setTransform(1, 0, 0, 1, 0, 0);
    if (layer.blur) buf = blurCanvas(buf, layer.blur * s);
    if (layer.levels) autoLevels(buf);
    const tone = layer.tritone || layer.duotone || (layer.grayscale ? ['#000000', '#FFFFFF'] : null);
    if (tone) toneMap(buf, tone, layer.curve || (layer.tritone ? 1.35 : 1.2));
    if (layer.vignette) {
      const vg = buf.getContext('2d');
      const grad = vg.createRadialGradient(bw / 2, bh * 0.42, Math.min(bw, bh) * 0.3, bw / 2, bh * 0.42, Math.hypot(bw, bh) * 0.6);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${layer.vignette})`);
      vg.fillStyle = grad;
      vg.fillRect(0, 0, bw, bh);
    }
    if (layer.halftone) buf = halftone(buf, Math.max(3, (layer.halftone.cell || 12) * s), layer.halftone.color || '#000000', layer.halftone.angle ?? 45);
    if (layer.fade) fadeMask(buf, layer.fade);
    if (layer.mask && !['rect', 'none'].includes(layer.mask)) {
      const mg = buf.getContext('2d');
      mg.save();
      mg.globalCompositeOperation = 'destination-in';
      mg.translate(-x * s, -y * s);
      maskPath(mg, layer, s);
      mg.fillStyle = '#000000';
      mg.fill();
      mg.restore();
    }
    if (img.src) {
      if (bufferCache.size > 80) bufferCache.delete(bufferCache.keys().next().value);
      bufferCache.set(key, buf);
    }
    return buf;
  }

  async function drawPhoto(g, layer, s, report) {
    const img = await loadImage(layer.src);
    if (!img) { report.missing.push(layer.src); return; }
    const { x, y, w, h } = layer;
    g.save();
    applyFx(g, layer.fx, s);
    if (layer.fit === 'contain') {
      const scale = Math.min(w / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      g.drawImage(img, (x + (w - dw) / 2) * s, (y + (h - dh) / 2) * s, dw * s, dh * s);
      g.restore();
      return;
    }
    g.drawImage(photoBuffer(img, layer, s), x * s, y * s);
    g.restore();
    if (layer.border) {
      g.save();
      g.strokeStyle = layer.border.color; g.lineWidth = layer.border.width * s;
      maskPath(g, layer, s); g.stroke();
      g.restore();
    }
  }

  async function drawCutout(g, layer, s, report) {
    const img = await loadImage(layer.src);
    if (!img) { report.missing.push(layer.src); return; }
    // Trim to the subject's own box, then fit the box (anchored bottom).
    const trimmed = trim(img);
    const { x, y, w, h } = layer;
    const scale = Math.min(w / trimmed.width, h / trimmed.height);
    const dw = trimmed.width * scale;
    const dh = trimmed.height * scale;
    const dx = layer.align === 'left' ? x : layer.align === 'right' ? x + w - dw : x + (w - dw) / 2;
    const dy = layer.anchor === 'center' ? y + (h - dh) / 2 : layer.anchor === 'top' ? y : y + h - dh;
    // Work at the drawn size (sharp, and the rim width is in canvas px).
    const cw = Math.max(1, Math.round(dw * s));
    const ch = Math.max(1, Math.round(dh * s));
    let src = makeCanvas(cw, ch);
    const sg = src.getContext('2d');
    sg.imageSmoothingQuality = 'high';
    if (layer.flip) { sg.translate(cw, 0); sg.scale(-1, 1); }
    sg.drawImage(trimmed, 0, 0, cw, ch);
    if (layer.levels) autoLevels(src);
    if (layer.duotone || layer.tritone) toneMap(src, layer.tritone || layer.duotone, layer.curve || 1.25);
    if (layer.fade) fadeMask(src, layer.fade);
    if (layer.sticker) {
      // Die-cut sticker edge: the silhouette grown in 24 directions, filled.
      const sw = Math.max(1, (layer.sticker.width || 14) * s);
      const edge = makeCanvas(cw + sw * 2 + 2, ch + sw * 2 + 2);
      const eg = edge.getContext('2d');
      for (let k = 0; k < 24; k += 1) eg.drawImage(src, sw + Math.cos((k / 24) * Math.PI * 2) * sw, sw + Math.sin((k / 24) * Math.PI * 2) * sw);
      eg.globalCompositeOperation = 'source-in';
      eg.fillStyle = layer.sticker.color || '#FFFFFF';
      eg.fillRect(0, 0, edge.width, edge.height);
      g.save();
      applyFx(g, layer.fx, s);
      g.drawImage(edge, dx * s - sw, dy * s - sw);
      g.restore();
    }
    g.save();
    applyFx(g, layer.sticker ? { ...(layer.fx || {}), shadow: null } : layer.fx, s);
    g.drawImage(src, dx * s, dy * s);
    g.restore();
    if (layer.rim) {
      g.save();
      g.globalCompositeOperation = 'screen';
      g.drawImage(rimLight(src, layer.rim.color || '#FFFFFF', Math.max(1.5, (layer.rim.width || 5) * s), layer.rim.angle, layer.rim.alpha ?? 0.85), dx * s, dy * s);
      g.restore();
    }
    report.cutouts = (report.cutouts || []).concat([{ x: dx, y: dy, w: dw, h: dh }]);
    src = null;
  }
  const trimCache = new WeakMap();
  function trim(img) {
    if (trimCache.has(img)) return trimCache.get(img);
    const c = makeCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    let out = c;
    try {
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let minX = c.width; let minY = c.height; let maxX = 0; let maxY = 0;
      for (let yy = 0; yy < c.height; yy += 2) {
        for (let xx = 0; xx < c.width; xx += 2) {
          if (d[(yy * c.width + xx) * 4 + 3] > 24) {
            if (xx < minX) minX = xx; if (xx > maxX) maxX = xx;
            if (yy < minY) minY = yy; if (yy > maxY) maxY = yy;
          }
        }
      }
      if (maxX > minX && maxY > minY) {
        out = makeCanvas(maxX - minX + 2, maxY - minY + 2);
        out.getContext('2d').drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
      }
    } catch (error) { /* cross-origin: draw as is */ }
    trimCache.set(img, out);
    return out;
  }

  async function drawLogo(g, layer, s, report) {
    const img = await loadImage(layer.src);
    if (!img) { report.missing.push(layer.src); return; }
    const { x, y, w, h } = layer;
    const scale = Math.min(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    g.save();
    applyFx(g, layer.fx, s);
    let src = img;
    if (layer.mono) {
      const c = makeCanvas(img.width, img.height);
      const cg = c.getContext('2d');
      cg.drawImage(img, 0, 0);
      cg.globalCompositeOperation = 'source-in';
      cg.fillStyle = layer.mono;
      cg.fillRect(0, 0, c.width, c.height);
      src = c;
    }
    const lx = layer.align === 'left' ? x : layer.align === 'right' ? x + w - dw : x + (w - dw) / 2;
    g.drawImage(src, lx * s, (y + (h - dh) / 2) * s, dw * s, dh * s);
    g.restore();
  }

  // Text that must read: headline, quote, kicker, body, name, label.
  const GUARD_ROLES = new Set(['headline', 'highlight', 'quote', 'kicker', 'body', 'name', 'label']);

  function drawText(g, layer, s, report) {
    if (!clean(layer.text)) return;
    const fit = fitText(g, layer);
    const { vm } = fit;
    const block = vm.height(fit.lines.length);
    let y0 = layer.y;
    if (layer.valign === 'bottom') y0 = layer.y + layer.h - block;
    else if (layer.valign === 'middle') y0 = layer.y + (layer.h - block) / 2;
    const key = w => w.replace(/[^\w$%'-]/g, '').replace(/^'+|'+$/g, '').toUpperCase();
    const hl = new Set((layer.highlight?.words || []).flatMap(w => words(w)).map(key).filter(Boolean));
    g.font = fontString(vm.font, fit.size, layer.weight);
    setTracking(g, fit.track);
    const placed = fit.lines.map((line, i) => {
      const width = textW(g, line, fit.track);
      const padX = vm.box ? vm.box.padX : 0;
      const lx = layer.align === 'center' ? layer.x + (layer.w - width) / 2 : layer.align === 'right' ? layer.x + layer.w - width - padX : layer.x + padX;
      return { line, width, lx, base: y0 + vm.first + i * vm.step };
    });
    const minX = Math.min(...placed.map(p => p.lx));
    const maxX = Math.max(...placed.map(p => p.lx + p.width));
    const inkBox = { x: minX, y: y0 + (vm.box ? vm.box.padY : 0), w: maxX - minX, h: Math.max(1, block - (vm.box ? vm.box.padY * 2 : 0)) };
    // Contrast guard: over a busy or low-contrast area, lay a feathered scrim
    // under the words (text protection), never change the copy or palette.
    const decorative = (layer.fx?.opacity ?? 1) < 0.6 || layer.guard === false || Boolean(layer.knockout);
    let stats = sampleStats(g, inkBox.x, inkBox.y, inkBox.w, inkBox.h, s);
    let guarded = '';
    let color = layer.color;
    if (stats && !vm.box && !decorative && GUARD_ROLES.has(layer.role)) {
      const worst = Math.min(...stats.cols.map(c => contrast(layer.color, c)));
      const need = fit.size >= 60 ? 3 : 4.5;
      const pal = report.palette || {};
      if (worst < need && stats.busy <= 0.05) {
        // Flat field: swap to the closest palette ink that reads (team dark first).
        const pool = [pal.bg, pal.ink, pal.paperInk, pal.accent, ES.ink, '#FFFFFF', '#000000'].filter(Boolean).map(normHex);
        color = pool.find(c => contrast(c, stats.mean) >= need) || pool.sort((a, b) => contrast(b, stats.mean) - contrast(a, stats.mean))[0];
        guarded = 'recolor';
      } else if (worst < need && (stats.busy > 0.05 || contrast(layer.color, stats.mean) < need)) {
        const options = [report.palette?.deep || '#000000', '#000000', report.palette?.paper || '#FFFFFF'];
        const col = layer.scrim || options.sort((a, b) => contrast(layer.color, b) - contrast(layer.color, a))[0];
        const alpha = Math.min(0.8, 0.42 + stats.busy * 1.6 + (need - worst) * 0.06);
        const pad = Math.max(24, fit.size * 0.45);
        // A feathered block: a rounded rect blurred in its own buffer.
        const bw = (inkBox.w + pad * 2.4) * s;
        const bh = (inkBox.h + pad * 2) * s;
        const feather = makeCanvas(bw, bh);
        const fg = feather.getContext('2d');
        fg.fillStyle = rgba(col, 1);
        fg.beginPath();
        if (fg.roundRect) fg.roundRect(pad * 0.6 * s, pad * 0.5 * s, (inkBox.w + pad * 1.2) * s, (inkBox.h + pad) * s, pad * s); else fg.rect(pad * 0.6 * s, pad * 0.5 * s, (inkBox.w + pad * 1.2) * s, (inkBox.h + pad) * s);
        fg.fill();
        g.save();
        g.globalAlpha = alpha;
        g.drawImage(blurCanvas(feather, pad * 0.55 * s), (inkBox.x - pad * 1.2) * s, (inkBox.y - pad) * s);
        g.restore();
        guarded = 'scrim';
        stats = sampleStats(g, inkBox.x, inkBox.y, inkBox.w, inkBox.h, s) || stats;
      }
    }
    g.save();
    applyFx(g, { ...(layer.fx || {}), shadow: null, glow: null }, s);
    g.font = fontString(vm.font, fit.size * s, layer.weight);
    setTracking(g, fit.track * s);
    g.textBaseline = 'alphabetic';
    // Highlight boxes (ES pills): one per line, cap-height padded, equal gaps.
    if (vm.box) {
      placed.forEach((p, i) => {
        const colors = layer.box.colors || [layer.box.color];
        g.fillStyle = colors[i % colors.length];
        g.fillRect((p.lx - vm.box.padX) * s, (p.base - vm.cap - vm.box.padY) * s, (p.width + vm.box.padX * 2) * s, (vm.cap + vm.box.padY * 2) * s);
      });
    }
    const paint = (fillFor) => placed.forEach(p => {
      let cursor = p.lx;
      p.line.split(' ').forEach((word, k) => {
        const piece = k ? ` ${word}` : word;
        g.fillStyle = fillFor(word);
        g.fillText(piece, cursor * s, p.base * s);
        cursor += g.measureText(piece).width / s;
      });
    });
    const fillFor = word => (hl.has(key(word)) && (!guarded || guarded === 'scrim') ? layer.highlight.color : color);
    const glow = layer.fx?.glow;
    const shadow = layer.fx?.shadow;
    if (glow) {
      // Neon: a wide bloom, a tight halo, then the hot core on top.
      [[glow.blur || 40, (glow.alpha ?? 0.8) * 0.7], [(glow.blur || 40) * 0.3, glow.alpha ?? 0.8]].forEach(([blur, alpha]) => {
        g.save();
        g.shadowColor = rgba(glow.color || layer.color, alpha);
        g.shadowBlur = blur * s;
        paint(fillFor);
        g.restore();
      });
    } else if (shadow) {
      g.save();
      g.shadowColor = rgba(shadow.color || '#000000', shadow.alpha ?? 0.5);
      g.shadowBlur = (shadow.blur || 20) * s;
      g.shadowOffsetX = (shadow.x || 0) * s;
      g.shadowOffsetY = (shadow.y || 0) * s;
      paint(fillFor);
      g.restore();
    }
    const koImg = layer.knockout?.src ? loaded.get(layer.knockout.src) : null;
    if (koImg) {
      // Photo in type: the glyphs become a window onto the photo.
      const cv = g.canvas;
      const buf = makeCanvas(cv.width, cv.height);
      const bg = buf.getContext('2d');
      bg.setTransform(g.getTransform ? g.getTransform() : new DOMMatrix());
      bg.font = g.font;
      setTracking(bg, fit.track * s);
      bg.textBaseline = 'alphabetic';
      placed.forEach(p => { bg.fillStyle = '#FFFFFF'; bg.fillText(p.line, p.lx * s, p.base * s); });
      bg.setTransform(1, 0, 0, 1, 0, 0);
      bg.globalCompositeOperation = 'source-in';
      const box = { x: minX, y: y0, w: Math.max(1, maxX - minX), h: block };
      bg.drawImage(photoBuffer(koImg, { ...layer.knockout, ...box, mask: 'rect' }, s), box.x * s, box.y * s);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(buf, 0, 0);
    } else paint(glow && layer.core ? () => layer.core : fillFor);
    g.restore();
    const under = stats?.mean || '';
    const worstC = stats ? Math.min(...stats.cols.map(c => contrast(color, c))) : 0;
    report.items.push({ type: 'text', role: layer.role, size: fit.size, lines: fit.lines.length, overflow: fit.overflow, contrast: vm.box ? contrast(layer.color, (layer.box.colors || [layer.box.color])[0]) : under ? contrast(color, under) : 0, worst: vm.box ? 0 : worstC, busy: stats?.busy || 0, guarded, box: { x: minX, y: y0, w: maxX - minX, h: block } });
  }

  function drawPill(g, layer, s, report) {
    if (!clean(layer.text)) return;
    const font = layer.font || 'condensed';
    const h = layer.h || 52;
    let size = layer.size || Math.round(h * 0.6);
    const track = sz => (layer.tracking ?? autoTracking(font, sz));
    g.save();
    applyFx(g, layer.fx, s);
    g.font = fontString(font, size, layer.weight);
    setTracking(g, track(size));
    const padX = Math.round(h * 0.34);
    let width = textW(g, layer.text, track(size));
    while (layer.maxW && width + padX * 2 > layer.maxW && size > 18) {
      size -= 1;
      g.font = fontString(font, size, layer.weight);
      setTracking(g, track(size));
      width = textW(g, layer.text, track(size));
    }
    const cap = capRatio(g, font) * size;
    const w = width + padX * 2;
    const x = layer.align === 'right' ? layer.x + (layer.maxW || w) - w : layer.align === 'center' ? layer.x + ((layer.maxW || w) - w) / 2 : layer.x;
    g.fillStyle = layer.bg;
    if (layer.radius && g.roundRect) { g.beginPath(); g.roundRect(x * s, layer.y * s, w * s, h * s, layer.radius * s); g.fill(); } else g.fillRect(x * s, layer.y * s, w * s, h * s);
    g.shadowColor = 'transparent';
    g.font = fontString(font, size * s, layer.weight);
    setTracking(g, track(size) * s);
    // Contrast-checked: a pill whose text would not read gets black or white.
    const ink = contrast(layer.color, layer.bg) >= 3 ? layer.color : ['#000000', '#FFFFFF'].sort((a, b) => contrast(b, layer.bg) - contrast(a, layer.bg))[0];
    g.fillStyle = ink;
    g.textBaseline = 'alphabetic';
    // Optically centred on the cap height (not the em box).
    g.fillText(layer.text, (x + padX) * s, (layer.y + (h + cap) / 2) * s);
    g.restore();
    report.items.push({ type: 'pill', role: layer.role, size, overflow: false, contrast: contrast(ink, layer.bg), box: { x, y: layer.y, w, h } });
  }

  function drawNumber(g, layer, s, report) {
    const value = clean(layer.value);
    if (!value) return;
    const prefix = clean(layer.prefix);
    const suffix = clean(layer.suffix);
    const label = clean(layer.label);
    const labelSize = label ? (layer.labelSize || 40) : 0;
    const labelGap = label ? labelSize * 0.5 : 0;
    const labelCap = label ? labelSize * 0.72 : 0;
    const avail = layer.h - labelCap - labelGap;
    const ratio = capRatio(g, 'display');
    let size = Math.min(layer.size || 400, avail / ratio);
    const measure = sz => {
      g.font = fontString('display', sz);
      const tr = autoTracking('display', sz);
      setTracking(g, tr);
      const main = textW(g, value, tr);
      g.font = fontString('display', sz * 0.5);
      setTracking(g, autoTracking('display', sz * 0.5));
      const pre = prefix ? textW(g, prefix, autoTracking('display', sz * 0.5)) + sz * 0.03 : 0;
      const suf = suffix ? textW(g, suffix, autoTracking('display', sz * 0.5)) + sz * 0.035 : 0;
      return { main, pre, suf, total: main + pre + suf };
    };
    let m = measure(size);
    while (m.total > layer.w && size > 30) { size *= 0.96; m = measure(size); }
    const capH = size * ratio;
    const block = capH + labelGap + labelCap;
    const top = layer.valign === 'top' ? layer.y : layer.valign === 'bottom' ? layer.y + layer.h - block : layer.y + (layer.h - block) / 2;
    const x0 = layer.align === 'center' ? layer.x + (layer.w - m.total) / 2 : layer.align === 'right' ? layer.x + layer.w - m.total : layer.x;
    const base = top + capH;
    // Contrast guard for numbers (same rule as text): on a flat field where the
    // figure reads under 3:1 (e.g. after a palette flip), swap to the closest
    // palette ink that reads. Busy photos and decorative numbers are left alone.
    const decorative = (layer.fx?.opacity ?? 1) < 0.6 || layer.guard === false;
    const nStats = decorative ? null : sampleStats(g, x0, top, m.total, capH, s);
    if (nStats && nStats.busy <= 0.05 && Math.min(...nStats.cols.map(c => contrast(layer.color, c))) < 3) {
      const pal = report.palette || {};
      const pool = [pal.bg, pal.ink, pal.paperInk, pal.accent, ES.ink, '#FFFFFF', '#000000'].filter(Boolean).map(normHex);
      const numColor = pool.find(c => contrast(c, nStats.mean) >= 3) || pool.sort((a, b) => contrast(b, nStats.mean) - contrast(a, nStats.mean))[0];
      layer = { ...layer, color: numColor, unitColor: layer.unitColor && contrast(layer.unitColor, nStats.mean) >= 3 ? layer.unitColor : numColor };
    }
    g.save();
    applyFx(g, layer.fx, s);
    g.textBaseline = 'alphabetic';
    // Units: half size, cap-top aligned with the figure (the money / % look).
    const unitBase = top + size * 0.5 * ratio;
    if (prefix) {
      g.font = fontString('display', size * 0.5 * s);
      setTracking(g, autoTracking('display', size * 0.5) * s);
      g.fillStyle = layer.unitColor || layer.color;
      g.fillText(prefix, x0 * s, unitBase * s);
    }
    g.font = fontString('display', size * s);
    setTracking(g, autoTracking('display', size) * s);
    g.fillStyle = layer.color;
    g.fillText(value, (x0 + m.pre) * s, base * s);
    if (suffix) {
      g.font = fontString('display', size * 0.5 * s);
      setTracking(g, autoTracking('display', size * 0.5) * s);
      g.fillStyle = layer.unitColor || layer.color;
      g.fillText(suffix, (x0 + m.pre + m.main + size * 0.035) * s, unitBase * s);
    }
    g.restore();
    if (label) {
      drawText(g, { type: 'text', role: 'label', text: label, x: layer.x, y: base + labelGap, w: layer.w, h: labelCap * 2 + labelSize * 0.5, font: 'condensed', size: labelSize, minSize: Math.min(labelSize, 22), maxLines: 2, lineHeight: 1.05, color: layer.labelColor || layer.color, align: layer.align, valign: 'top', guard: layer.guard }, s, report);
    }
    report.items.push({ type: 'number', role: 'number', size, overflow: m.total > layer.w + 1, contrast: 0, box: { x: x0, y: top, w: m.total, h: capH } });
  }

  function drawChart(g, layer, s, report) {
    if (layer.chart === 'units') {
      const n = Math.max(1, Math.min(200, Number(layer.count) || 0));
      const cols = layer.unit === 'card' ? (n > 120 ? 15 : 10) : (n > 60 ? 20 : n > 30 ? 10 : 8);
      const rows = Math.ceil(n / cols);
      const gap = 8;
      let cw = (layer.w - gap * (cols - 1)) / cols;
      const aspect = layer.unit === 'card' ? 0.62 : 1;
      let ch = cw * aspect;
      if (rows * ch + (rows - 1) * gap > layer.h) {
        ch = (layer.h - gap * (rows - 1)) / rows;
        cw = ch / aspect;
      }
      const totalW = cols * cw + (cols - 1) * gap;
      const x0 = layer.x + (layer.w - totalW) / 2;
      g.save();
      for (let i = 0; i < n; i += 1) {
        const cx = x0 + (i % cols) * (cw + gap);
        const cy = layer.y + Math.floor(i / cols) * (ch + gap);
        g.fillStyle = layer.color;
        if (layer.unit === 'card') {
          g.beginPath();
          if (g.roundRect) g.roundRect(cx * s, cy * s, cw * s, ch * s, 3 * s); else g.rect(cx * s, cy * s, cw * s, ch * s);
          g.fill();
          // A tour card: a darker stripe and a chip, so 100 reads as 100 cards.
          g.fillStyle = rgba('#000000', 0.22);
          g.fillRect(cx * s, (cy + ch * 0.2) * s, cw * s, ch * 0.16 * s);
          g.fillStyle = rgba('#FFFFFF', 0.55);
          g.fillRect((cx + cw * 0.1) * s, (cy + ch * 0.52) * s, cw * 0.18 * s, ch * 0.24 * s);
        } else {
          g.beginPath(); g.arc((cx + cw / 2) * s, (cy + ch / 2) * s, (Math.min(cw, ch) / 2) * s, 0, Math.PI * 2); g.fill();
        }
      }
      g.restore();
      report.items.push({ type: 'chart', role: 'chart', size: cw, overflow: false, contrast: 0, box: { x: x0, y: layer.y, w: totalW, h: rows * ch } });
    }
  }

  async function drawEsLogo(g, scene, s) {
    const W = scene.size.w;
    const x = scene.swipe ? SAFE : W - SAFE - LOGO.w;
    const y = SAFE;
    // Blue mark by default; black when the area under it is ES blue-ish (no contrast).
    const under = sampleColor(g, x, y, LOGO.w, LOGO.h, s);
    const blue = !under || Math.sqrt(colorDist(under, ES.blue)) > 120;
    const img = await loadImage(ES_MARK(blue ? ES.blue : ES.black, '#FFFFFF'));
    if (img) g.drawImage(img, x * s, y * s, LOGO.w * s, LOGO.h * s);
  }

  // Acumin is self-hosted (fonts/): registered here so any page can render.
  const SCRIPT_BASE = typeof document !== 'undefined' && document.currentScript?.src ? document.currentScript.src.replace(/[^/]*$/, '') : '';
  let fontsAdded = false;
  async function ensureFonts() {
    if (typeof document === 'undefined' || !document.fonts?.load) return;
    if (!fontsAdded && typeof FontFace !== 'undefined') {
      fontsAdded = true;
      const has = [...document.fonts].some(face => /Acumin Pro Condensed Local/.test(face.family));
      if (!has) {
        try {
          const face = new FontFace('Acumin Pro Condensed Local', `url(${SCRIPT_BASE}fonts/acumin-pro-condensed-bold.otf) format("opentype")`, { weight: '700', style: 'normal' });
          document.fonts.add(await face.load());
        } catch (error) { /* falls back to Roboto Condensed */ }
      }
    }
    await Promise.all([
      document.fonts.load(fontString('display', 100)),
      document.fonts.load(fontString('condensed', 40)),
      document.fonts.load(fontString('body', 30)),
    ]).catch(() => {});
    fontsReady = true;
  }

  // Rotation / 3D tilt for any layer, around its centre (or fx.pivot).
  function layerTransform(g, layer, s) {
    const fx = layer.fx || {};
    if (!fx.rotate && !fx.tilt) return;
    const pts = layer.points || [];
    const bx = layer.w ? layer.x + layer.w / 2 : pts.length ? pts.reduce((a, p) => a + p[0], 0) / pts.length : layer.x || 0;
    const by = layer.h ? layer.y + layer.h / 2 : pts.length ? pts.reduce((a, p) => a + p[1], 0) / pts.length : layer.y || 0;
    const px = fx.pivot?.x ?? bx;
    const py = fx.pivot?.y ?? by;
    g.translate(px * s, py * s);
    if (fx.rotate) g.rotate((fx.rotate * Math.PI) / 180);
    if (fx.tilt) g.transform(1, fx.tilt.skewY || 0, fx.tilt.skewX || 0, 1, 0, 0);
    g.translate(-px * s, -py * s);
  }

  // Draw a scene. canvas: an HTMLCanvasElement (resized here). scale: 1 = 1080 wide.
  // Returns a report: measured text sizes, overflow, contrast, missing images.
  async function render(scene, canvas, { scale = 1 } = {}) {
    const W = scene.size?.w || 1080;
    const H = scene.size?.h || 1350;
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    await ensureFonts();
    // Images load in parallel before drawing in order.
    await Promise.all(scene.layers.flatMap(l => [l.src, l.image?.src, l.knockout?.src].filter(Boolean)).map(loadImage));
    const report = { items: [], missing: [], palette: scene.palette || null };
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.imageSmoothingQuality = 'high';
    for (const layer of scene.layers) {
      g.save();
      try {
        if (layer.type !== 'background') layerTransform(g, layer, scale);
        if (layer.type === 'background') await drawBackground(g, layer, W, H, scale);
        else if (layer.type === 'shape') drawShape(g, layer, W, H, scale);
        else if (layer.type === 'photo') await drawPhoto(g, layer, scale, report);
        else if (layer.type === 'cutout') await drawCutout(g, layer, scale, report);
        else if (layer.type === 'logo') await drawLogo(g, layer, scale, report);
        else if (layer.type === 'text') drawText(g, layer, scale, report);
        else if (layer.type === 'pill') drawPill(g, layer, scale, report);
        else if (layer.type === 'number') drawNumber(g, layer, scale, report);
        else if (layer.type === 'chart') drawChart(g, layer, scale, report);
      } finally {
        g.restore();
      }
    }
    await drawEsLogo(g, scene, scale);
    delete report.palette;
    report.heuristic = scoreReport(report, scene);
    return report;
  }

  // A small JPEG of a scene (for the vision judge and the card preview).
  async function toDataUrl(scene, { width = 360, type = 'image/jpeg', quality = 0.82 } = {}) {
    const canvas = makeCanvas(1, 1);
    const report = await render(scene, canvas, { scale: width / (scene.size?.w || 1080) });
    return { dataUrl: canvas.toDataURL(type, quality), report };
  }

  // The editable text of a scene (for inline editing on the card).
  function editableText(scene) {
    return (scene.layers || []).map((layer, index) => ({ index, layer }))
      .filter(({ layer }) => (layer.type === 'text' || layer.type === 'pill') && ['kicker', 'headline', 'quote', 'body', 'name'].includes(layer.role))
      .map(({ index, layer }) => ({ index, role: layer.role, text: layer.text }));
  }
  function setText(scene, index, text) {
    const next = JSON.parse(JSON.stringify(scene));
    const layer = next.layers[index];
    if (!layer || !(layer.type === 'text' || layer.type === 'pill')) return next;
    const value = clean(text).slice(0, 220);
    layer.text = layer.role === 'body' ? value : value.toUpperCase();
    return next;
  }
  // Swap the photo (and its cut-out) everywhere it is used.
  function swapPhoto(scene, { from, to, cutout = '' }) {
    const next = JSON.parse(JSON.stringify(scene));
    next.layers.forEach(layer => {
      if (layer.type === 'photo' && layer.role !== 'art' && (!from || layer.src === from)) layer.src = to;
      if (layer.type === 'cutout' && cutout) layer.src = cutout;
    });
    return next;
  }

  // The photo a card's Swap photo replaces (never concept art).
  function mainPhoto(scene) {
    const layer = (scene.layers || []).find(l => l.type === 'photo' && l.role !== 'art' && !String(l.src || '').startsWith('proc:'));
    return layer ? layer.src : '';
  }

  return {
    mainPhoto,
    VERSION, SIZES, SAFE, LOGO, FONTS, LAYER_TYPES, ROLES, FIXES, FX_LIMITS, PROC_ART, ARCHETYPES, BY_ID, NEEDS,
    fits, fitting, build, candidates, makePalette, flipPalette, checkScene, applyFix, scoreReport,
    render, toDataUrl, editableText, setText, swapPhoto,
    _test: { contrast, mix, lum, normHex, digitsIn, logoZone, coverRect },
  };
}));
