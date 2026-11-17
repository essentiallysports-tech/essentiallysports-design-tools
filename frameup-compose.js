/*
 * FrameUp Compose: Generate's "Creative" output. A composed design is a JSON
 * scene spec (canvas size + ordered layers) that this file builds from a
 * composition archetype, checks against the ES guidelines, and draws on a
 * canvas (the Generate preview and the 1080+ export use the same code).
 *
 *   FrameUpCompose.ARCHETYPES            the composition library (14 recipes)
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
 * Effects (layer.fx): shadow, glow, opacity, blend, rotate. Fonts are ES only
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

  const VERSION = '2026-11-19';
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
  const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'lighten', 'darken'];
  const MAX_LAYERS = 28;
  // Fixes the art director may ask for (one round, applied in code).
  const FIXES = ['bigger-number', 'bigger-headline', 'shorter-headline', 'darker-mist', 'more-contrast', 'less-clutter', 'swap-palette', 'move-headline-up'];
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
    const shades = [];
    base.concat([bg, accent, accent2, paper]).forEach(c => [0.2, 0.45, 0.7].forEach(t => shades.push(mix(c, '#000000', t), mix(c, '#FFFFFF', t))));
    palette.allowed = [...new Set([...base, bg, bg2, ink, accent, accent2, paper, paperInk, ES.blue, ES.black, ES.white, ES.ink, ES.paper, ES.navy, ES.grey, '#000000', '#FFFFFF', ...shades].map(normHex))];
    return palette;
  }
  // The same palette, light/dark swapped (a variant and the swap-palette fix).
  function flipPalette(p) {
    const flipped = { ...p, bg: p.paper, ink: p.paperInk, paper: p.bg, paperInk: p.ink, bg2: mix(p.paper, p.accent, 0.12), mode: p.mode === 'light' ? 'dark' : 'light' };
    if (contrast(flipped.accent, flipped.bg) < 2.6) flipped.accent = contrast(p.bg, flipped.bg) >= 3 ? p.bg : flipped.ink;
    flipped.allowed = [...new Set([...(p.allowed || []), flipped.bg2].map(normHex))];
    return flipped;
  }

  // ─── Small text helpers ─────────────────────────────────────────────────
  const clean = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim();
  const upper = value => clean(value).toUpperCase();
  const words = value => clean(value).split(' ').filter(Boolean);
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
    const palette = input.palette?.allowed ? input.palette : makePalette(input.palette?.colors || []);
    return { W: size.w, H: size.h, p: palette };
  }
  const kickerPill = (input, p, x = SAFE, y = SAFE + 14, opts = {}) => (clean(input.kicker) ? {
    type: 'pill', role: 'kicker', text: upper(input.kicker), x, y, h: opts.h || 52, color: opts.color || p.bg, bg: opts.bg || p.accent, maxW: opts.maxW || 700, align: opts.align || 'left',
  } : null);
  const mist = (W, H, p, from = 0.45, strength = 0.92, color = null) => ({
    type: 'shape', shape: 'gradient', x: 0, y: Math.round(H * from), w: W, h: H - Math.round(H * from), color: color || p.mist, stops: [[0, 0], [0.55, strength * 0.8], [1, strength]],
  });
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
          headlineText(input, pal, { x: SAFE, y: H - 420, w: W - SAFE * 2, h: 270 }, { size: 140, maxLines: 2 }),
          { type: 'text', role: 'label', text: upper(input.number.label), x: SAFE, y: H - SAFE - 92, w: W - SAFE * 2, h: 60, font: 'condensed', size: 40, minSize: 26, maxLines: 1, color: pal.accent, align: 'left', tracking: 2 },
          { type: 'shape', shape: 'rect', x: SAFE, y: H - SAFE - 18, w: 160, h: 10, color: pal.accent },
          grain(0.07),
        ];
      },
    },
    {
      id: 'prize-poster', name: 'Prize focus', focal: 'art',
      about: 'The prize (trophy, cheque, cards) as hero art with the money number over it.',
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
          ...lines.map((n, k) => ({ type: 'text', role: 'label', text: upper(`${n.display} ${n.label || ''}`), x: right ? SAFE : W - SAFE - 330, y: 660 + k * 110, w: 330, h: 96, font: 'condensed', size: 40, minSize: 26, maxLines: 2, color: p.ink, align: right ? 'left' : 'right', box: { color: rgba(p.bg, 0.0), pad: 0 }, highlight: { words: [upper(n.display)], color: p.accent } })),
          headlineText(input, p, { x: SAFE, y: H - SAFE - 400, w: W - SAFE * 2, h: 400 }, { size: 170, maxLines: 3 }),
          grain(0.06),
        ];
      },
    },
    {
      id: 'scoreboard', name: 'Scoreboard', focal: 'number',
      about: 'A final score as a broadcast scoreboard: logos, both scores, the key stats as a ticker.',
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
  ];
  const BY_ID = Object.fromEntries(ARCHETYPES.map(a => [a.id, a]));

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
    return { ok: !errors.length, errors, fixes, scene };
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
  const ES_MARK = (box = '#0A7DFA', type = 'white') => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg width="123" height="105" viewBox="0 0 123 105" xmlns="http://www.w3.org/2000/svg"><path d="M122.332 0H0V104.066H122.332V0Z" fill="${box}"/><path d="M54.1567 57.7938H31.2568V75.8168H57.1807L55.1537 89.8498H14.2188V14.2178H55.1977V28.4348H31.2568V43.6498H54.1567V57.7938Z" fill="${type}"/><path d="M78.0299 67.9531C78.4659 74.1651 80.2329 78.4391 85.4259 78.4391C90.4709 78.4391 92.0879 75.0431 92.0879 70.7441C92.0879 65.5101 89.4569 62.4321 80.5609 57.8731C67.4239 51.0901 62.4629 45.3651 62.4629 34.2501C62.4629 21.3121 70.3689 12.8281 85.3519 12.8281C102.977 12.8281 108.02 23.8411 108.164 35.4551H91.4339C91.1449 30.1881 90.1819 25.6621 85.2459 25.6621C81.3809 25.6621 79.6519 28.1691 79.6519 32.3891C79.6519 36.7211 81.3409 38.9551 89.5659 43.0661C103.584 50.1251 109.535 56.0941 109.535 68.8101C109.535 81.3121 102.228 91.2741 85.2519 91.2741C66.8589 91.2741 61.2479 80.7941 60.8789 67.9541H78.0289L78.0299 67.9531Z" fill="${type}"/></svg>`)}`;

  function loadImage(src) {
    if (!src) return Promise.resolve(null);
    if (imageCache.has(src)) return imageCache.get(src);
    const promise = new Promise(resolve => {
      if (String(src).startsWith('proc:')) return resolve(procArt(String(src).slice(5)));
      const img = new Image();
      if (/^https?:/i.test(src) && !src.startsWith(location.origin)) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
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

  // Texture patterns (made once per size).
  const textures = new Map();
  function texture(kind, color = '#FFFFFF') {
    const key = `${kind}|${color}`;
    if (textures.has(key)) return textures.get(key);
    let c;
    if (kind === 'grain') {
      c = makeCanvas(256, 256);
      const g = c.getContext('2d');
      const img = g.createImageData(256, 256);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255;
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
    }
    textures.set(key, c);
    return c;
  }

  function fontString(font, size, weight) {
    return `${weight || FONT_WEIGHT[font] || 700} ${Math.round(size)}px ${FONTS[font] || FONTS.display}`;
  }

  // Greedy wrap; returns lines or null when a single word is too wide.
  function wrap(g, text, width) {
    const list = words(text);
    const lines = [];
    let line = '';
    for (const word of list) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width <= width || !line) {
        if (!line && g.measureText(word).width > width) return null;
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  // Balanced wrap: tries to make lines similar width (looks designed, not ragged).
  function balance(g, lines, width) {
    if (!lines || lines.length < 2) return lines;
    const all = lines.join(' ');
    let lo = width * 0.5;
    let hi = width;
    let best = lines;
    for (let k = 0; k < 10; k += 1) {
      const mid = (lo + hi) / 2;
      const tryLines = wrap(g, all, mid);
      if (tryLines && tryLines.length === lines.length) { best = tryLines; hi = mid; } else lo = mid;
    }
    return best;
  }

  function fitText(g, layer) {
    const font = layer.font || 'display';
    const lh = layer.lineHeight || (font === 'display' ? 0.9 : 1.15);
    const maxLines = layer.maxLines || 3;
    const tracking = layer.tracking || 0;
    let size = layer.size || 100;
    const min = layer.minSize || Math.min(size, 24);
    const padX = layer.box ? (layer.box.pad ?? 18) : 0;
    while (size >= min) {
      g.font = fontString(font, size, layer.weight);
      if ('letterSpacing' in g) g.letterSpacing = `${tracking}px`;
      const lines = wrap(g, layer.text, layer.w - padX * 2);
      if (lines && lines.length <= maxLines && lines.length * size * lh <= layer.h + 1) {
        return { size, lines: font === 'display' && layer.role !== 'quote' ? balance(g, lines, layer.w - padX * 2) : lines, lh, overflow: false };
      }
      size -= Math.max(1, Math.round(size * 0.04));
    }
    size = min;
    g.font = fontString(font, size, layer.weight);
    let lines = wrap(g, layer.text, layer.w - padX * 2) || [layer.text];
    const overflow = lines.length > maxLines || lines.length * size * lh > layer.h + 1;
    lines = lines.slice(0, maxLines);
    return { size, lines, lh, overflow };
  }

  // The colour under a box (for the contrast check): mean of a few samples.
  function sampleColor(g, x, y, w, h, scale) {
    try {
      const pts = [[0.2, 0.3], [0.5, 0.5], [0.8, 0.7], [0.35, 0.8], [0.65, 0.25]];
      let r = 0; let gg = 0; let b = 0;
      pts.forEach(([px, py]) => {
        const d = g.getImageData(Math.round((x + w * px) * scale), Math.round((y + h * py) * scale), 1, 1).data;
        r += d[0]; gg += d[1]; b += d[2];
      });
      return toHex([r / pts.length, gg / pts.length, b / pts.length]);
    } catch (error) {
      return '';
    }
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

  // Duotone (luminance mapped dark→light). Same-origin images only; else a tinted grayscale.
  function duotone(img, dark, light, w, h) {
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    try {
      const data = g.getImageData(0, 0, c.width, c.height);
      const a = rgb(dark);
      const b = rgb(light);
      for (let i = 0; i < data.data.length; i += 4) {
        const l = (0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2]) / 255;
        const t = Math.min(1, Math.max(0, (l - 0.08) / 0.84));
        data.data[i] = a[0] + (b[0] - a[0]) * t;
        data.data[i + 1] = a[1] + (b[1] - a[1]) * t;
        data.data[i + 2] = a[2] + (b[2] - a[2]) * t;
      }
      g.putImageData(data, 0, 0);
    } catch (error) {
      g.globalCompositeOperation = 'color';
      g.fillStyle = light;
      g.fillRect(0, 0, w, h);
    }
    return c;
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
      const grad = g.createRadialGradient(W * at.x * s, H * at.y * s, 0, W * at.x * s, H * at.y * s, Math.max(W, H) * 0.85 * s);
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
        const { sx, sy, sw, sh } = coverRect(img.width, img.height, W, H, layer.image.focus);
        const src = layer.image.duotone ? duotone(img, layer.image.duotone[0], layer.image.duotone[1], img.width, img.height) : img;
        if (layer.image.blur) g.filter = `blur(${layer.image.blur * s}px)`;
        g.drawImage(src, sx, sy, sw, sh, 0, 0, W * s, H * s);
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
    } else if (kind === 'grid' || kind === 'lines') {
      const pat = g.createPattern(texture(kind, color), 'repeat');
      if (pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix().scale(s, s));
      g.fillStyle = pat;
      g.fillRect(0, 0, W * s, H * s);
    }
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
    if (layer.fx?.rotate) {
      g.translate((x + w / 2) * s, (y + h / 2) * s);
      g.rotate((layer.fx.rotate * Math.PI) / 180);
      g.translate(-(x + w / 2) * s, -(y + h / 2) * s);
    }
    if (layer.shape === 'gradient') {
      const grad = g.createLinearGradient(0, y * s, 0, (y + h) * s);
      (layer.stops || [[0, 0], [1, 0.9]]).forEach(([at, alpha]) => grad.addColorStop(at, rgba(layer.color, alpha)));
      g.fillStyle = grad;
      g.fillRect(x * s, y * s, w * s, h * s);
    } else if (layer.shape === 'circle') {
      g.fillStyle = layer.color;
      g.beginPath(); g.ellipse((x + w / 2) * s, (y + h / 2) * s, (w / 2) * s, (h / 2) * s, 0, 0, Math.PI * 2); g.fill();
    } else if (layer.shape === 'ring') {
      g.strokeStyle = layer.color; g.lineWidth = (layer.lineWidth || 8) * s;
      g.beginPath(); g.ellipse((x + w / 2) * s, (y + h / 2) * s, (w / 2) * s, (h / 2) * s, 0, 0, Math.PI * 2); g.stroke();
    } else if (layer.shape === 'poly') {
      g.fillStyle = layer.color;
      g.beginPath();
      (layer.points || []).forEach(([px, py], i) => (i ? g.lineTo(px * s, py * s) : g.moveTo(px * s, py * s)));
      g.closePath(); g.fill();
    } else if (layer.shape === 'quote') {
      // Two solid quote marks (drawn, so any font works).
      g.fillStyle = layer.color;
      const mark = (ox) => {
        const r = (h * 0.32);
        g.beginPath(); g.arc((ox + r) * s, (y + h - r) * s, r * s, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo((ox + r * 0.2) * s, (y + h - r) * s); g.quadraticCurveTo((ox + r * 0.1) * s, (y + h * 0.1) * s, (ox + r * 2) * s, y * s); g.lineTo((ox + r * 2) * s, (y + h * 0.18) * s); g.quadraticCurveTo((ox + r * 0.9) * s, (y + h * 0.3) * s, (ox + r * 1.4) * s, (y + h - r * 1.6) * s); g.closePath(); g.fill();
      };
      mark(x);
      mark(x + w * 0.52);
    } else if (layer.shape === 'frame') {
      g.strokeStyle = layer.color; g.lineWidth = (layer.lineWidth || 6) * s;
      g.strokeRect(x * s, y * s, w * s, h * s);
    } else {
      g.fillStyle = layer.color;
      const r = (layer.radius || 0) * s;
      if (r && g.roundRect) { g.beginPath(); g.roundRect(x * s, y * s, w * s, h * s, r); g.fill(); } else g.fillRect(x * s, y * s, w * s, h * s);
    }
    g.restore();
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
    const shadow = g.shadowBlur;
    if (layer.mask !== 'none') { maskPath(g, layer, s); g.clip(); }
    const { sx, sy, sw, sh } = coverRect(img.width, img.height, w, h, layer.focus, layer.zoom || 1);
    let src = img;
    if (layer.duotone) src = duotone(img, layer.duotone[0], layer.duotone[1], img.width, img.height);
    else if (layer.grayscale) g.filter = 'grayscale(1)';
    g.drawImage(src, sx, sy, sw, sh, x * s, y * s, w * s, h * s);
    g.restore();
    if (layer.border) {
      g.save();
      g.strokeStyle = layer.border.color; g.lineWidth = layer.border.width * s;
      maskPath(g, layer, s); g.stroke();
      g.restore();
    }
    return shadow;
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
    const dx = x + (w - dw) / 2;
    const dy = layer.anchor === 'center' ? y + (h - dh) / 2 : y + h - dh;
    let src = trimmed;
    if (layer.duotone) {
      const tone = duotone(trimmed, layer.duotone[0], layer.duotone[1], trimmed.width, trimmed.height);
      const tg = tone.getContext('2d');
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(trimmed, 0, 0);
      src = tone;
    }
    g.save();
    applyFx(g, layer.fx, s);
    g.drawImage(src, dx * s, dy * s, dw * s, dh * s);
    g.restore();
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
    g.drawImage(src, (x + (w - dw) / 2) * s, (y + (h - dh) / 2) * s, dw * s, dh * s);
    g.restore();
  }

  function drawText(g, layer, s, report) {
    if (!clean(layer.text)) return;
    const fit = fitText(g, layer);
    const font = layer.font || 'display';
    const lineH = fit.size * fit.lh;
    const total = fit.lines.length * lineH;
    let y0 = layer.y;
    if (layer.valign === 'bottom') y0 = layer.y + layer.h - total;
    else if (layer.valign === 'middle') y0 = layer.y + (layer.h - total) / 2;
    const key = w => w.replace(/[^\w$%'-]/g, '').replace(/^'+|'+$/g, '').toUpperCase();
    const hl = new Set((layer.highlight?.words || []).flatMap(w => words(w)).map(key).filter(Boolean));
    const bg = sampleColor(g, layer.x, y0, layer.w, total, s);
    g.save();
    applyFx(g, layer.fx, s);
    g.font = fontString(font, fit.size * s, layer.weight);
    if ('letterSpacing' in g) g.letterSpacing = `${(layer.tracking || 0) * s}px`;
    g.textBaseline = 'alphabetic';
    let minX = Infinity;
    let maxX = -Infinity;
    fit.lines.forEach((line, i) => {
      const width = g.measureText(line).width / s;
      const lx = layer.align === 'center' ? layer.x + (layer.w - width) / 2 : layer.align === 'right' ? layer.x + layer.w - width : layer.x;
      // Acumin's cap height sits near 0.72 of the size; baseline per line.
      const base = y0 + i * lineH + fit.size * (font === 'display' ? 0.8 : 0.85);
      if (layer.box) {
        const pad = layer.box.pad ?? 18;
        g.save();
        g.shadowColor = 'transparent';
        g.fillStyle = layer.box.color;
        g.fillRect((lx - pad) * s, (y0 + i * lineH - fit.size * 0.02) * s, (width + pad * 2) * s, (lineH * 0.98) * s);
        g.restore();
      }
      minX = Math.min(minX, lx);
      maxX = Math.max(maxX, lx + width);
      let cursor = lx;
      line.split(' ').forEach((word, k) => {
        const piece = k ? ` ${word}` : word;
        g.fillStyle = hl.has(key(word)) ? layer.highlight.color : layer.color;
        g.fillText(piece, cursor * s, base * s);
        cursor += g.measureText(piece).width / s;
      });
    });
    g.restore();
    report.items.push({ type: 'text', role: layer.role, size: fit.size, lines: fit.lines.length, overflow: fit.overflow, contrast: bg ? contrast(layer.color, bg) : 0, box: { x: minX, y: y0, w: maxX - minX, h: total } });
  }

  function drawPill(g, layer, s, report) {
    if (!clean(layer.text)) return;
    const font = layer.font || 'condensed';
    let size = layer.size || Math.round((layer.h || 52) * 0.6);
    g.save();
    g.font = fontString(font, size, layer.weight);
    if ('letterSpacing' in g) g.letterSpacing = '1px';
    const padX = Math.round((layer.h || 52) * 0.36);
    let width = g.measureText(layer.text).width;
    while (layer.maxW && width + padX * 2 > layer.maxW && size > 18) {
      size -= 1;
      g.font = fontString(font, size, layer.weight);
      width = g.measureText(layer.text).width;
    }
    const w = width + padX * 2;
    const x = layer.align === 'right' ? layer.x + (layer.maxW || w) - w : layer.x;
    g.fillStyle = layer.bg;
    g.fillRect(x * s, layer.y * s, w * s, layer.h * s);
    g.font = fontString(font, size * s, layer.weight);
    if ('letterSpacing' in g) g.letterSpacing = `${s}px`;
    g.fillStyle = layer.color;
    g.textBaseline = 'middle';
    g.fillText(layer.text, (x + padX) * s, (layer.y + layer.h / 2 + size * 0.04) * s);
    g.restore();
    report.items.push({ type: 'pill', role: layer.role, size, overflow: false, contrast: contrast(layer.color, layer.bg), box: { x, y: layer.y, w, h: layer.h } });
  }

  function drawNumber(g, layer, s, report) {
    const value = clean(layer.value);
    if (!value) return;
    const prefix = clean(layer.prefix);
    const suffix = clean(layer.suffix);
    const label = clean(layer.label);
    const labelSize = label ? (layer.labelSize || 40) : 0;
    const labelGap = label ? labelSize * 0.35 : 0;
    const avail = layer.h - labelSize - labelGap;
    let size = Math.min(layer.size || 400, avail / 0.78);
    const measure = sz => {
      g.font = fontString('display', sz);
      if ('letterSpacing' in g) g.letterSpacing = `${-sz * 0.01}px`;
      const main = g.measureText(value).width;
      g.font = fontString('display', sz * 0.5);
      const pre = prefix ? g.measureText(prefix).width + sz * 0.02 : 0;
      const suf = suffix ? g.measureText(suffix).width + sz * 0.03 : 0;
      return { main, pre, suf, total: main + pre + suf };
    };
    let m = measure(size);
    while (m.total > layer.w && size > 30) { size *= 0.95; m = measure(size); }
    const capH = size * 0.74;
    const top = layer.y + (avail - capH) / 2 + (layer.valign === 'top' ? -(avail - capH) / 2 : 0);
    const x0 = layer.align === 'center' ? layer.x + (layer.w - m.total) / 2 : layer.align === 'right' ? layer.x + layer.w - m.total : layer.x;
    const base = top + capH;
    g.save();
    applyFx(g, layer.fx, s);
    g.textBaseline = 'alphabetic';
    if (prefix) {
      g.font = fontString('display', size * 0.5 * s);
      g.fillStyle = layer.unitColor || layer.color;
      g.fillText(prefix, x0 * s, (top + size * 0.37) * s);
    }
    g.font = fontString('display', size * s);
    if ('letterSpacing' in g) g.letterSpacing = `${-size * 0.01 * s}px`;
    g.fillStyle = layer.color;
    g.fillText(value, (x0 + m.pre) * s, base * s);
    if (suffix) {
      g.font = fontString('display', size * 0.5 * s);
      g.fillStyle = layer.unitColor || layer.color;
      g.fillText(suffix, (x0 + m.pre + m.main + size * 0.03) * s, (top + size * 0.37) * s);
    }
    g.restore();
    if (label) {
      drawText(g, { type: 'text', role: 'label', text: label, x: layer.x, y: base + labelGap, w: layer.w, h: labelSize * 1.2 * 2, font: 'condensed', size: labelSize, minSize: Math.min(labelSize, 22), maxLines: 2, lineHeight: 1.05, color: layer.labelColor || layer.color, align: layer.align, valign: 'top', tracking: 1.5 }, s, report);
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
    await Promise.all(scene.layers.flatMap(l => [l.src, l.image?.src].filter(Boolean)).map(loadImage));
    const report = { items: [], missing: [] };
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (const layer of scene.layers) {
      g.save();
      try {
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
    VERSION, SIZES, SAFE, LOGO, FONTS, LAYER_TYPES, ROLES, FIXES, PROC_ART, ARCHETYPES, BY_ID,
    fits, fitting, build, candidates, makePalette, flipPalette, checkScene, applyFix, scoreReport,
    render, toDataUrl, editableText, setText, swapPhoto,
    _test: { contrast, mix, lum, normHex, digitsIn, logoZone, coverRect },
  };
}));
