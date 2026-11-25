// Merch Designs: the print engine (browser: window.MerchPrint; tests: require).
//
//   MerchPrint.render(concept, printSpec, canvas[, opts])   -> Promise<{ canvas, blob, width, height, scale, full, note, semiPixels, checks }>
//   MerchPrint.renderLogo(printSpec, canvas[, opts])        -> the same, for the ES wordmark's own small print
//   MerchPrint.checks(concept, printSpec[, opts])           -> [{ id, ok, level: 'ok'|'warn'|'error', text }]
//   MerchPrint.preview(concept, garmentColor, canvas[, opts]) -> Promise<{ width, height }>  (flat tee mockup for the UI)
//   MerchPrint.fallbackConcepts(content[, opts])            -> Concept[] (no AI)
//   MerchPrint.layout(concept, printSpec[, opts])           -> the scene (pure; used by the tests)
//
// Concept and print spec are the shapes in the merch contract:
//   Concept   { id, collection, title, team: { id, name } | null, palette: { a, b, ink },
//               garment: { color, name }, stack: [{ text, size: 'big'|'small', fill, ink }],
//               align: 'left'|'center', blanks, rights: [{ kind, text }], why }
//   PrintSpec { templateId, region: 'front'|'back', pixelsWidth, pixelsHeight, dpi, garmentColor }
//             (optional: kind 'tee'|'hoodie'|'poster'|'sticker'|'mug', default from concept.blanks[0];
//              logo: 'inline' puts the ES wordmark under the design, for hard goods with one print area)
//
// Per kind (merch v2): tees and hoodies print a compact mid-chest stack at the
// area's DPI (150 minimum). Posters, stickers and mugs need 300 DPI and keep a
// safe edge (poster trim 0.25 in, sticker cut line 0.125 in). A mug's area is
// the whole wrap: the design sits on the face (the middle of the wrap), clear
// of the handle seam at both ends.
//
// The design is drawn at the print area's own pixel size and DPI from ES pills
// only (owner rule: FrameUp's Cover pill, Acumin Post 900, uppercase, a solid
// straight box, stacked rows touching; no shapes, blocks, rules or icons).
// The ES wordmark is not part of the design: renderLogo() makes it as its own
// print for a separate area the person picks (sleeve, back neck, label).
// The look follows the owner's merch board (Figma 2550:4085): one word per
// pill alternating the team's colours, small name lines, a wide banner pill,
// a knockout nickname pill, a number pill, quote stacks; compact, mid-chest
// (about a third of the chest).
// A row whose type colour is the shirt colour is knocked out (the shirt shows
// through), so there is no ink to match. Every pixel of the print file ends
// fully solid or fully clear (DTG prints see-through ink as a muddy halo).
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const deps = isNode
    ? { rules: require('./frameup-rules.js'), merch: require('./merch-rules.js'), kit: require('./brand-kit.js'), teams: require('./video-ads-teams.js') }
    : { rules: root.FrameUpRules, merch: root.MerchRules, get kit() { return root.ES_BRAND_KIT || []; }, get teams() { return root.VideoAdsTeams || null; } };
  const api = factory(deps);
  if (isNode) module.exports = api;
  else root.MerchPrint = api;
}(typeof self !== 'undefined' ? self : this, (deps) => {
  'use strict';

  const FrameUpRules = deps.rules;
  const MerchRules = deps.merch;
  const WHITE = '#FFFFFF';
  const BLACK = '#000000';
  const ES_BLUE = '#0A7DFA';
  const WORDMARK = { w: 258, h: 31, blue: 'brand-logo-blue.svg', white: 'brand-logo-white.svg' };
  const PHONE_MAX_PIXELS = 16000000; // iOS Safari refuses canvases over ~16.7 MP
  const SMALL = 0.36; // small (name line) pills, relative to the big pill size
  const WRAP_AT = 18; // big rows longer than this wrap into more pills
  const MIN_CAP_IN = { apparel: 0.12, other: 0.08 }; // smallest printable cap height
  const MIN_CONTRAST = 1.45; // ink vs garment: below this the art melts into the shirt
  const CAP = 0.7; // cap height / font size (Acumin Post)
  // Safe edges for hard goods, in inches: poster trim, sticker cut line, mug handle seam.
  const SAFE_IN = { poster: 0.25, sticker: 0.125, mug: 0.5 };
  const MUG_FACE = 0.5; // share of the wrap seen from one side
  // Print areas used when the page has no template yet (previews, tests).
  const DEFAULT_AREAS = {
    tee: { pixelsWidth: 1800, pixelsHeight: 2400, dpi: 150 },
    hoodie: { pixelsWidth: 1800, pixelsHeight: 1650, dpi: 150 },
    poster: { pixelsWidth: 5400, pixelsHeight: 7200, dpi: 300 },
    sticker: { pixelsWidth: 1200, pixelsHeight: 1200, dpi: 300 },
    mug: { pixelsWidth: 2550, pixelsHeight: 1050, dpi: 300 },
  };

  const contrast = (a, b) => FrameUpRules.contrastRatio(a, b);
  const hexOk = v => /^#[0-9a-f]{6}$/i.test(String(v || ''));
  const hex = v => (hexOk(v) ? String(v).toUpperCase() : null);
  const up = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const isLight = c => contrast(c, BLACK) > contrast(c, WHITE);
  const kindOf = (concept, spec) => (MerchRules.BLANKS[spec?.kind] ? spec.kind : MerchRules.BLANKS[concept?.blanks?.[0]] ? concept.blanks[0] : 'tee');

  // ─── Team colours ──────────────────────────────────────────────────────
  // { a, b, ink } for a team from the repo's team lists (brand-kit.js first,
  // then video-ads-teams.js); ES blue / navy for no team.
  function teamPalette(name) {
    const n = String(name || '').toLowerCase().trim();
    if (!n || /essentially|^es$/.test(n)) return { ...MerchRules.ES_PALETTE };
    const kit = (deps.kit || []).find(t => t && t.team && t.team.toLowerCase() === n);
    let a;
    let b;
    if (kit) {
      const p = kit.primary || {};
      a = hex(p.background);
      const cands = [p.mist, p.foreground, ...(kit.palette || []).flatMap(x => [x.background, x.mist, x.foreground])].map(hex).filter(Boolean);
      b = cands.find(c => c !== a && c !== WHITE && c !== BLACK) || cands.find(c => c !== a) || WHITE;
    } else {
      const t = (deps.teams?.TEAMS || []).find(x => x.name.toLowerCase() === n || String(x.short || '').toLowerCase() === n);
      if (!t) return { ...MerchRules.ES_PALETTE };
      a = hex(t.colors?.[0]) || ES_BLUE;
      b = hex(t.colors?.[1]) || WHITE;
    }
    if (!a) return { ...MerchRules.ES_PALETTE };
    // a dark-on-dark pair (navy + black) reads as one colour: use white as b.
    if (contrast(a, b) < 1.6) b = isLight(a) ? BLACK : WHITE;
    const ink = contrast(b, BLACK) >= contrast(b, WHITE) ? BLACK : WHITE;
    return { a, b, ink };
  }
  // Plain colour names for garment chips ("Purple", "Navy").
  const NAMED = [['White', WHITE], ['Black', '#111111'], ['Navy', '#0C2340'], ['Royal blue', '#1D4FA0'], ['Light blue', '#6CACE4'], ['Red', '#C8102E'], ['Maroon', '#6A1A2C'], ['Orange', '#F56600'], ['Gold', '#FFB81C'], ['Green', '#1E6B3A'], ['Kelly green', '#2E9E48'], ['Teal', '#00788C'], ['Purple', '#4F2683'], ['Grey', '#8A8D8F'], ['Silver', '#C4CED4'], ['Brown', '#4F2C1D']];
  function colorName(c) {
    const h = hex(c) || WHITE;
    const rgb = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16));
    const [r, g, b] = rgb(h);
    return NAMED.map(([n, v]) => { const [R, G, B] = rgb(v); return [n, (r - R) ** 2 * 0.3 + (g - G) ** 2 * 0.59 + (b - B) ** 2 * 0.11]; }).sort((x, y) => x[1] - y[1])[0][0];
  }

  // ─── Print area ────────────────────────────────────────────────────────
  function areaOf(spec = {}, kind = 'tee') {
    const d = DEFAULT_AREAS[kind] || DEFAULT_AREAS.tee;
    const dpi = Number(spec.dpi) > 0 ? Number(spec.dpi) : d.dpi;
    const w = Math.round(Number(spec.pixelsWidth) > 0 ? Number(spec.pixelsWidth) : d.pixelsWidth);
    const h = Math.round(Number(spec.pixelsHeight) > 0 ? Number(spec.pixelsHeight) : d.pixelsHeight);
    return { w, h, dpi, inW: w / dpi, inH: h / dpi, region: spec.region === 'back' ? 'back' : 'front' };
  }
  // Full print file on desktop; on phones a smaller copy when the full one is
  // over Safari's canvas limit (the page says so and creates from desktop).
  function canvasPlan(spec, { phone = false, kind = 'tee' } = {}) {
    const a = areaOf(spec, kind);
    const pixels = a.w * a.h;
    if (!phone || pixels <= PHONE_MAX_PIXELS) return { scale: 1, w: a.w, h: a.h, full: true, note: '' };
    const scale = Math.floor(Math.sqrt(PHONE_MAX_PIXELS / pixels) * 1000) / 1000;
    return { scale, w: Math.floor(a.w * scale), h: Math.floor(a.h * scale), full: false, note: 'Phones can’t hold the full print file, so this is a smaller preview. Create the product from a desktop to send the full-size file.' };
  }

  // ─── Measuring ─────────────────────────────────────────────────────────
  // Node / before fonts load: Acumin Post 900 caps are about half an em wide.
  const approxMeasure = (text, size) => up(text).split('').reduce((w, ch) => w + size * (ch === ' ' ? 0.2 : /[MW]/.test(ch) ? 0.66 : /[IJ1.,'!:’]/.test(ch) ? 0.26 : /[—]/.test(ch) ? 0.8 : 0.49), 0);
  const fontOf = size => `900 ${size}px "Acumin Post", "Roboto Condensed", sans-serif`;
  let liveMeasure = null; // set once the real font is loaded in a browser
  function canvasMeasure(ctx) {
    const cache = new Map();
    return (text, size) => {
      const key = up(text);
      if (!cache.has(key)) { ctx.font = fontOf(100); cache.set(key, ctx.measureText(key).width / 100); }
      return cache.get(key) * size;
    };
  }
  function pillGeom(size, scale) {
    const m = FrameUpRules.pillMetrics(size, size * CAP, scale);
    return { h: m.h, padL: m.padLeft, padR: m.padRight, baseline: m.baseline, step: m.step };
  }

  // ─── Colours of a row on this garment ──────────────────────────────────
  function resolve(key, pal) {
    if (key === 'a' || key === 'b' || key === 'ink') return hex(pal[key]) || BLACK;
    if (key === 'white') return WHITE;
    return hex(key) || hex(pal.a) || BLACK;
  }
  // The box must stand off the shirt; type in the shirt colour is a knockout;
  // otherwise type must stand off the box.
  function rowColors(row, pal, garment, apparel) {
    const options = [pal.a, pal.b, pal.ink, WHITE, BLACK].map(hex).filter(Boolean);
    let bg = resolve(row.fill || 'a', pal);
    let ink = resolve(row.ink || (row.fill === 'b' ? 'ink' : 'white'), pal);
    if (contrast(bg, garment) < MIN_CONTRAST) bg = options.filter(c => c !== garment).sort((x, y) => (contrast(y, garment) >= 2 ? 1 : 0) - (contrast(x, garment) >= 2 ? 1 : 0) || options.indexOf(x) - options.indexOf(y))[0];
    const knockout = apparel && contrast(ink, garment) < 1.15 && contrast(bg, garment) >= MIN_CONTRAST;
    if (!knockout && contrast(ink, bg) < 2.4) ink = options.filter(c => c !== bg).sort((x, y) => contrast(y, bg) - contrast(x, bg))[0];
    return { bg, ink, knockout };
  }

  // Wraps long text into balanced rows (stacked pills read best at 8-16 letters).
  function wrapText(text, goal) {
    const words = up(text).split(' ').filter(Boolean);
    const len = words.join(' ').length;
    const target = goal || Math.max(8, Math.min(16, Math.round(Math.sqrt(len) * 2.1)));
    const rows = [];
    let cur = '';
    words.forEach(w => { if (cur && (cur + ' ' + w).length > target) { rows.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; });
    if (cur) rows.push(cur);
    return rows;
  }
  // Concept.stack -> rows ({ text, rel, row }), long big rows wrapped.
  function rowsOf(concept) {
    const stack = (Array.isArray(concept.stack) ? concept.stack : []).map(r => (typeof r === 'string' ? { text: r, size: 'big' } : r)).filter(r => r && up(r.text));
    const rows = [];
    stack.slice(0, 12).forEach(r => {
      const small = r.size === 'small';
      const parts = !small && up(r.text).length > WRAP_AT ? wrapText(r.text) : [up(r.text)];
      parts.forEach(t => rows.push({ text: t, rel: small ? SMALL : 1, row: r }));
    });
    return rows.slice(0, 14);
  }

  // Rows -> placed pills inside box (sized so the widest row and the whole
  // stack fit; rows touch the way the editor's Cover pills do).
  function stackRows(rows, box, measure, scale, align) {
    const at100 = rows.map(r => { const g = pillGeom(100 * r.rel, scale); return { w: measure(r.text, 100 * r.rel) + g.padL + g.padR, step: g.step, h: g.h }; });
    const maxW = Math.max(...at100.map(r => r.w));
    const totalH = at100.reduce((s, r, i) => s + (i < at100.length - 1 ? r.step : r.h), 0);
    const size = Math.max(4, Math.floor(Math.min(box.w / maxW, box.h / totalH) * 100));
    const items = [];
    let y = 0;
    let blockW = 0;
    rows.forEach((r, i) => {
      const s = size * r.rel;
      const g = pillGeom(s, scale);
      const w = measure(r.text, s) + g.padL + g.padR;
      blockW = Math.max(blockW, w);
      items.push({ type: 'pill', text: r.text, size: s, w, h: g.h, padL: g.padL, baseline: g.baseline, y, bg: r.bg, ink: r.ink, knockout: r.knockout, small: r.rel < 1, align: r.align || align });
      y += i < rows.length - 1 ? g.step : g.h;
    });
    const x0 = box.x + (box.w - blockW) / 2;
    const y0 = box.y + (box.valign === 'top' ? 0 : (box.h - y) / 2);
    items.forEach(p => {
      p.x = Math.round(p.align === 'center' ? x0 + (blockW - p.w) / 2 : x0);
      p.y = Math.round(y0 + p.y);
      p.w = Math.round(p.w);
      p.h = Math.round(p.h);
    });
    return { items, size, bounds: { x: Math.round(x0), y: Math.round(y0), w: Math.round(blockW), h: Math.round(y) } };
  }

  // ─── Layout (pure) ─────────────────────────────────────────────────────
  function layout(concept = {}, spec = {}, { measure } = {}) {
    const m = measure || liveMeasure || approxMeasure;
    const kind = kindOf(concept, spec);
    const blank = MerchRules.BLANKS[kind];
    const a = areaOf(spec, kind);
    const pal = { ...teamPalette(concept.team?.name), ...Object.fromEntries(Object.entries(concept.palette || {}).filter(([, v]) => hexOk(v)).map(([k, v]) => [k, v.toUpperCase()])) };
    const garment = blank.apparel ? (hex(spec.garmentColor) || hex(concept.garment?.color) || WHITE) : WHITE;
    const scale = a.dpi / 72;
    const W = a.w;
    const H = a.h;
    const align = concept.align === 'center' ? 'center' : 'left';
    const rows = rowsOf(concept);
    if (!rows.length) MerchRules.CORE_LINES[0].forEach(t => rows.push({ text: t, rel: 1, row: { fill: 'a', ink: 'ink' } }));
    rows.forEach(r => Object.assign(r, rowColors(r.row, pal, garment, blank.apparel)));
    const items = [];

    // Pills only (owner rule): every element is a pill. The ES wordmark is not
    // part of this print; it is its own small print (renderLogo) in a separate
    // area of the person's choice.
    const margin = Math.round(0.15 * a.dpi);
    const bigRows = rows.filter(r => r.rel === 1);
    const single = rows.length === 1;
    const longest = Math.max(...rows.map(r => r.text.length));
    const widthRatio = single ? (longest <= 3 ? 0.26 : longest <= 10 ? 0.46 : 0.66) : concept.collection === 'quote' ? 0.58 : 0.5;
    let box;
    if (blank.apparel) {
      const top = Math.round(Math.min(1.75 * a.dpi, H * 0.12));
      box = { x: Math.round(W * (1 - widthRatio) / 2), y: top, w: Math.round(W * widthRatio), h: Math.round(Math.min(H - top - margin, H * 0.6)), valign: 'top' };
    } else if (kind === 'mug') {
      // The face of the mug: the middle of the wrap, clear of the handle seam.
      const faceW = Math.round(W * MUG_FACE);
      const padX = Math.round(faceW * 0.08);
      const padY = Math.max(Math.round(SAFE_IN.mug * a.dpi * 0.5), Math.round(H * 0.1));
      box = { x: Math.round((W - faceW) / 2) + padX, y: padY, w: faceW - 2 * padX, h: H - 2 * padY, valign: 'center' };
    } else {
      const pad = Math.max(Math.round(Math.min(W, H) * 0.1), Math.ceil((SAFE_IN[kind] || 0) * a.dpi * 1.5));
      box = { x: pad, y: pad, w: W - 2 * pad, h: H - 2 * pad, valign: 'center' };
    }
    if (single && longest > 3) box.h = Math.min(box.h, Math.round(box.w * 0.34));
    // Hard goods have one print area, so the ES wordmark goes under the design.
    const inlineLogo = !blank.apparel && spec.logo === 'inline';
    let logoW = 0;
    let logoH = 0;
    let gap = 0;
    if (inlineLogo) {
      logoW = Math.round(Math.min(box.w * 0.6, 3 * a.dpi));
      logoH = Math.max(1, Math.round(logoW * WORDMARK.h / WORDMARK.w));
      gap = Math.round(logoH * 0.9);
      const fullH = box.h;
      box.h = Math.max(1, box.h - logoH - gap);
      box.fullH = fullH;
    }
    const result = stackRows(rows, box, m, scale, align);
    items.push(...result.items);
    const design = { ...result.bounds };
    if (inlineLogo) {
      // Centre the design + wordmark block in the full box.
      const blockH = design.h + gap + logoH;
      const shift = Math.round(box.y + (box.fullH - blockH) / 2) - design.y;
      items.forEach(i => { i.y += shift; });
      design.y += shift;
      const logo = { type: 'logo', variant: contrast(garment, ES_BLUE) < 1.6 ? 'white' : 'blue', x: Math.round(box.x + (box.w - logoW) / 2), y: design.y + design.h + gap, w: logoW, h: logoH };
      items.push(logo);
      const x0 = Math.min(design.x, logo.x);
      design.w = Math.max(design.x + design.w, logo.x + logo.w) - x0;
      design.x = x0;
      design.h = logo.y + logo.h - design.y;
    }
    return { w: W, h: H, dpi: a.dpi, inW: a.inW, inH: a.inH, region: a.region, kind, apparel: blank.apparel, garment, palette: pal, items, design, size: result.size, bigRows: bigRows.length, inlineLogo };
  }

  // ─── Print checks ──────────────────────────────────────────────────────
  // [{ id, ok, level: 'ok' | 'warn' | 'error', text }]; any 'error' stops a push.
  function checksFor(scene, { renderScale = 1, semiPixels = null } = {}) {
    const out = [];
    const add = (id, ok, level, text) => out.push({ id, ok, level: ok ? 'ok' : level, text });
    const inside = scene.items.every(i => i.x >= 0 && i.y >= 0 && i.x + i.w <= scene.w && i.y + i.h <= scene.h);
    add('area', inside, 'error', inside ? 'Everything sits inside the print area.' : 'Part of the design runs outside the print area. Shorten the words.');
    const effects = scene.items.some(i => (i.opacity !== undefined && i.opacity !== 1) || i.shadow || i.glow || i.gradient);
    add('effects', !effects, 'error', effects ? 'Fades, glows or see-through ink print badly. Remove them.' : 'Solid ink only: no fades, glows or see-through areas.');
    if (semiPixels !== null) add('pixels', semiPixels === 0, 'error', semiPixels === 0 ? 'Every pixel is fully solid or fully clear.' : `${semiPixels} see-through pixels would print as a halo.`);
    const boxes = scene.items.filter(i => i.type === 'pill' || i.type === 'block');
    const lost = boxes.find(i => contrast(i.bg, scene.garment) < MIN_CONTRAST);
    const whiteOnWhite = scene.apparel && contrast(scene.garment, WHITE) < 1.2 && boxes.some(i => contrast(i.bg, WHITE) < 1.2);
    const unreadable = boxes.find(i => !i.knockout && contrast(i.ink, i.bg) < 2.4);
    const garmentOk = !lost && !whiteOnWhite && !unreadable;
    add('garment', garmentOk, 'error', garmentOk ? 'Every colour stands out from the blank.' : unreadable ? `"${unreadable.text}" is hard to read on its box. Swap the colours.` : `The "${(lost || boxes[0]).text}" box disappears on a ${colorName(scene.garment).toLowerCase()} ${scene.apparel ? 'shirt' : 'blank'}. Pick another colour.`);
    const minCap = Math.min(...boxes.filter(i => i.type === 'pill').map(i => i.size * CAP / scene.dpi), Infinity);
    const need = scene.apparel ? MIN_CAP_IN.apparel : MIN_CAP_IN.other;
    const capOk = !Number.isFinite(minCap) || minCap >= need - 1e-6;
    add('text-size', capOk, 'error', capOk ? (Number.isFinite(minCap) ? `Smallest letters are ${minCap.toFixed(2)} in tall at print size.` : 'Big type only.') : `Some letters are only ${minCap.toFixed(2)} in tall at print size; ${need} in is the smallest that prints cleanly. Use fewer or shorter lines.`);
    const minDpi = (MerchRules.BLANKS[scene.kind] || {}).minDpi || 150;
    const eff = Math.round(scene.dpi * renderScale);
    const dpiOk = eff >= minDpi && scene.dpi >= minDpi;
    add('dpi', dpiOk, renderScale < 1 && scene.dpi >= minDpi ? 'warn' : 'error', dpiOk ? `${scene.w} × ${scene.h} px at ${scene.dpi} DPI: full print size.` : scene.dpi < minDpi ? `This blank's print area is ${scene.dpi} DPI; ${minDpi} DPI is the minimum for a ${(MerchRules.BLANKS[scene.kind] || {}).label || 'blank'}.` : `This preview is ${eff} DPI; printing needs ${minDpi}. Create the product from a desktop.`);
    if (scene.apparel) {
      const inches = scene.design.w / scene.dpi;
      add('placement', inches <= 9.5, 'warn', inches <= 9.5 ? `Design is ${inches.toFixed(1)} in wide: compact, mid-chest.` : `Design is ${inches.toFixed(1)} in wide, wider than a chest print. Use shorter words.`);
    } else {
      // Safe edge: poster trim, sticker cut line, mug handle seam.
      const safe = Math.round((SAFE_IN[scene.kind] || 0) * scene.dpi);
      const d = scene.design;
      const edge = Math.min(d.x, d.y, scene.w - d.x - d.w, scene.h - d.y - d.h);
      const what = { poster: ['trim', 'the trim'], sticker: ['cut', 'the cut line'], mug: ['wrap', 'the handle seam'] }[scene.kind] || ['edge', 'the edge'];
      if (scene.kind === 'mug') {
        const face = scene.w * MUG_FACE;
        const onFace = d.x >= (scene.w - face) / 2 - 1 && d.x + d.w <= (scene.w + face) / 2 + 1;
        const seamOk = Math.min(d.x, scene.w - d.x - d.w) >= safe && Math.min(d.y, scene.h - d.y - d.h) >= Math.round(0.125 * scene.dpi);
        add('wrap', seamOk && onFace, seamOk ? 'warn' : 'error', !seamOk ? `The design runs into the handle seam. Keep it ${SAFE_IN.mug} in from both ends of the wrap.` : onFace ? `Design sits on the face of the mug (${(d.w / scene.dpi).toFixed(1)} in wide), clear of the handle.` : 'The design wraps past the face of the mug, so part of it is hidden from the front. Use shorter words.');
      } else {
        add(what[0], edge >= safe, 'error', edge >= safe ? `Everything is at least ${SAFE_IN[scene.kind] || 0} in inside ${what[1]}.` : `Part of the design is within ${SAFE_IN[scene.kind]} in of ${what[1]} and may be cut off. Use shorter words.`);
      }
    }
    return out;
  }
  function checks(concept, spec, opts = {}) {
    return checksFor(layout(concept, spec, opts), opts);
  }
  // ─── The ES wordmark: its own small print ───────────────────────────────
  // The ESSENTIALLYSPORTS wordmark pill (brand-logo-blue.svg / -white.svg, the
  // official ES assets), fitted to whatever area the person picked (sleeve,
  // back neck, neck label...), centred, transparent around it.
  const LOGO_MIN_LETTER_IN = 0.06; // the wordmark's letters are ~70% of its height
  function logoLayout(spec = {}) {
    const a = areaOf(spec, 'tee');
    const garment = hex(spec.garmentColor) || WHITE;
    const pad = Math.round(Math.min(a.w, a.h) * 0.06);
    const maxW = Math.min(a.w - 2 * pad, (a.h - 2 * pad) * WORDMARK.w / WORDMARK.h, (Number(spec.maxInches) || 3) * a.dpi);
    const w = Math.max(1, Math.floor(maxW));
    const h = Math.max(1, Math.round(w * WORDMARK.h / WORDMARK.w));
    const logo = { type: 'logo', variant: contrast(garment, ES_BLUE) < 1.6 ? 'white' : 'blue', x: Math.round((a.w - w) / 2), y: Math.round((a.h - h) / 2), w, h };
    return { w: a.w, h: a.h, dpi: a.dpi, inW: a.inW, inH: a.inH, region: spec.region || 'logo', kind: 'tee', apparel: true, garment, logo: true, items: [logo], design: { x: logo.x, y: logo.y, w, h }, size: h };
  }
  function logoChecks(scene, { semiPixels = null } = {}) {
    const out = [];
    const add = (id, ok, level, text) => out.push({ id, ok, level: ok ? 'ok' : level, text });
    const l = scene.items[0];
    add('area', l.x >= 0 && l.y >= 0 && l.x + l.w <= scene.w && l.y + l.h <= scene.h, 'error', 'The wordmark sits inside its print area.');
    const letters = (l.h * 0.7) / scene.dpi;
    add('text-size', letters >= LOGO_MIN_LETTER_IN, 'error', letters >= LOGO_MIN_LETTER_IN ? `Wordmark is ${(l.w / scene.dpi).toFixed(2)} in wide.` : 'This area is too small for the ES wordmark to print cleanly. Pick a bigger spot.');
    add('dpi', scene.dpi >= 150, 'error', scene.dpi >= 150 ? `${scene.dpi} DPI.` : `This area is ${scene.dpi} DPI; 150 is the minimum.`);
    if (semiPixels !== null) add('pixels', semiPixels === 0, 'error', semiPixels === 0 ? 'Every pixel is fully solid or fully clear.' : `${semiPixels} see-through pixels would print as a halo.`);
    return out;
  }
  async function renderLogo(spec, canvas, opts = {}) {
    const scene = logoLayout(spec);
    const target = canvas || document.createElement('canvas');
    target.width = scene.w;
    target.height = scene.h;
    const g = target.getContext('2d');
    g.clearRect(0, 0, target.width, target.height);
    await drawScene(scene, g);
    const semiPixels = solidify(g, target.width, target.height);
    const blob = opts.blob === false || !target.toBlob ? null : await new Promise(resolve => target.toBlob(resolve, 'image/png'));
    return { canvas: target, blob, width: target.width, height: target.height, scale: 1, full: true, note: '', semiPixels, scene, checks: logoChecks(scene, { semiPixels }) };
  }

  const blocking = list => (list || []).filter(c => c.level === 'error');

  // ─── Browser drawing ───────────────────────────────────────────────────
  const BASE = (typeof document !== 'undefined' && document.currentScript?.src) ? document.currentScript.src.replace(/[^/]*$/, '') : '';
  let fontPromise = null;
  function loadFonts() {
    if (typeof document === 'undefined' || typeof FontFace === 'undefined') return Promise.resolve(false);
    if (!fontPromise) {
      const face = new FontFace('Acumin Post', `url(${BASE}fonts/acumin-post-legacy.otf)`, { weight: '900' });
      fontPromise = face.load().then(f => {
        document.fonts.add(f);
        liveMeasure = canvasMeasure(document.createElement('canvas').getContext('2d'));
        return true;
      }).catch(() => false);
    }
    return fontPromise;
  }
  const imageCache = new Map();
  function loadImage(src) {
    if (!imageCache.has(src)) imageCache.set(src, new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src; }));
    return imageCache.get(src);
  }
  async function drawScene(scene, g) {
    for (const it of scene.items) {
      if (it.type === 'pill' || it.type === 'block') {
        g.fillStyle = it.bg;
        g.fillRect(it.x, it.y, it.w, it.h);
        g.font = fontOf(it.size);
        g.textBaseline = 'alphabetic';
        g.textAlign = it.type === 'block' ? 'center' : 'left';
        if (it.knockout) { g.globalCompositeOperation = 'destination-out'; g.fillStyle = BLACK; } else g.fillStyle = it.ink;
        if (it.type === 'block') g.fillText(it.text, it.x + it.w / 2, it.y + it.h / 2 + (it.size * CAP) / 2);
        else g.fillText(it.text, it.x + it.padL, it.y + it.baseline);
        g.globalCompositeOperation = 'source-over';
        g.textAlign = 'left';
      } else if (it.type === 'logo') {
        const img = await loadImage(BASE + (it.variant === 'white' ? WORDMARK.white : WORDMARK.blue));
        if (img) g.drawImage(img, it.x, it.y, it.w, it.h);
      }
    }
  }
  // Every pixel fully opaque or fully clear (50% threshold; colour un-premultiplied).
  // Returns how many see-through pixels are left (0; the check proves it).
  function solidify(g, w, h) {
    const band = 256;
    let left = 0;
    for (let y = 0; y < h; y += band) {
      const rows = Math.min(band, h - y);
      const img = g.getImageData(0, y, w, rows);
      const d = img.data;
      for (let i = 3; i < d.length; i += 4) {
        const al = d[i];
        if (al !== 0 && al !== 255) {
          if (al >= 128) { const k = 255 / al; d[i - 3] = Math.min(255, Math.round(d[i - 3] * k)); d[i - 2] = Math.min(255, Math.round(d[i - 2] * k)); d[i - 1] = Math.min(255, Math.round(d[i - 1] * k)); d[i] = 255; } else { d[i - 3] = 0; d[i - 2] = 0; d[i - 1] = 0; d[i] = 0; }
        }
      }
      g.putImageData(img, 0, y);
      const after = g.getImageData(0, y, w, rows).data;
      for (let i = 3; i < after.length; i += 4) if (after[i] !== 0 && after[i] !== 255) left += 1;
    }
    return left;
  }
  const isPhone = () => typeof navigator !== 'undefined' && (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent || '')));

  // The print file: a transparent PNG at the print area's size.
  async function render(concept, spec, canvas, opts = {}) {
    await loadFonts();
    const kind = kindOf(concept, spec);
    const scene = layout(concept, spec);
    const plan = opts.scale ? { scale: opts.scale, full: opts.scale >= 1, note: '' } : canvasPlan(spec, { phone: opts.phone ?? isPhone(), kind });
    const target = canvas || document.createElement('canvas');
    target.width = Math.max(1, Math.round(scene.w * plan.scale));
    target.height = Math.max(1, Math.round(scene.h * plan.scale));
    const g = target.getContext('2d');
    g.clearRect(0, 0, target.width, target.height);
    g.save();
    g.scale(plan.scale, plan.scale);
    await drawScene(scene, g);
    g.restore();
    const semiPixels = solidify(g, target.width, target.height);
    const blob = opts.blob === false || !target.toBlob ? null : await new Promise(resolve => target.toBlob(resolve, 'image/png'));
    return { canvas: target, blob, width: target.width, height: target.height, scale: plan.scale, full: plan.full, note: plan.note, semiPixels, scene, checks: checksFor(scene, { renderScale: plan.scale, semiPixels }) };
  }

  // ─── Flat mockups for the UI ───────────────────────────────────────────
  // Shapes on a 1000-unit square; `area` is the print area on the blank.
  const TEE = 'M318 112 L196 150 L48 300 L148 410 L228 346 L228 930 L772 930 L772 346 L852 410 L952 300 L804 150 L682 112 Q500 250 318 112 Z';
  const HOOD = 'M318 112 L196 150 L60 380 L150 440 L228 380 L228 930 L772 930 L772 380 L850 440 L940 380 L804 150 L682 112 Q640 40 500 30 Q360 40 318 112 Z';
  // Where the wordmark hint sits on the flat tee (front view; back-neck and
  // inside labels are shown at the collar).
  const LOGO_SPOTS = {
    neck: { x: 500, y: 150, w: 64 },
    'back-neck': { x: 500, y: 150, w: 64 },
    label: { x: 500, y: 150, w: 64 },
    sleeve: { x: 128, y: 290, w: 54 },
    none: null,
  };
  const MOCK = {
    tee: { path: TEE, collar: 'M318 112 Q500 250 682 112 Q500 214 318 112 Z', area: { x: 338, y: 214, w: 324 } },
    hoodie: { path: HOOD, collar: 'M330 120 Q500 230 670 120 Q500 60 330 120 Z', area: { x: 338, y: 240, w: 324 } },
    poster: { rect: { x: 230, y: 90, w: 540, h: 720 }, area: { x: 230, y: 90, w: 540, h: 720 } },
    sticker: { rect: { x: 260, y: 260, w: 480, h: 480, r: 60 }, area: { x: 260, y: 260, w: 480, h: 480 } },
    mug: { rect: { x: 170, y: 300, w: 560, h: 400, r: 24 }, handle: true, area: { x: 190, y: 320, w: 520, h: 360 }, face: MUG_FACE },
  };
  function shade(c, k) {
    const h = hex(c) || WHITE;
    return '#' + [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * k))).toString(16).padStart(2, '0')).join('');
  }
  async function preview(concept, garmentColor, canvas, opts = {}) {
    await loadFonts();
    const kind = MerchRules.BLANKS[opts.kind] ? opts.kind : 'tee';
    const garment = MerchRules.BLANKS[kind].apparel ? (hex(garmentColor) || hex(concept?.garment?.color) || WHITE) : WHITE;
    const size = Math.max(120, Math.round(opts.size || canvas.width || 600));
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, size, size);
    const u = size / 1000;
    const shape = MOCK[kind];
    g.save();
    g.scale(u, u);
    g.lineJoin = 'round';
    g.strokeStyle = isLight(garment) ? 'rgba(14,16,20,.16)' : 'rgba(255,255,255,.12)';
    g.lineWidth = 3;
    g.fillStyle = garment;
    if (shape.path) {
      const p = new Path2D(shape.path);
      g.fill(p); g.stroke(p);
      g.fillStyle = shade(garment, isLight(garment) ? 0.9 : 0.75);
      g.fill(new Path2D(shape.collar));
    } else {
      const r = shape.rect;
      if (shape.handle) { g.lineWidth = 46; g.strokeStyle = '#E4E7EB'; g.beginPath(); g.arc(r.x + r.w, r.y + r.h / 2, 110, -Math.PI / 2, Math.PI / 2); g.stroke(); g.lineWidth = 3; g.strokeStyle = 'rgba(14,16,20,.16)'; }
      g.beginPath();
      if (g.roundRect) g.roundRect(r.x, r.y, r.w, r.h, r.r || 0); else g.rect(r.x, r.y, r.w, r.h);
      g.fill(); g.stroke();
    }
    g.restore();
    // The design, drawn at preview size into the blank's print area.
    const spec = { ...(DEFAULT_AREAS[kind]), ...(opts.spec || {}), garmentColor: garment, kind };
    if (!MerchRules.BLANKS[kind].apparel && opts.logoSpot === 'inline') spec.logo = 'inline';
    const scene = layout(concept, spec);
    // Apparel: the area's width across the chest, from the top. Hard goods:
    // fitted inside the blank (a mug shows its face, the middle of the wrap).
    const src = shape.face ? { x: scene.w * (1 - shape.face) / 2, w: scene.w * shape.face } : { x: 0, w: scene.w };
    const k = shape.area.h ? Math.min(shape.area.w * u / src.w, shape.area.h * u / scene.h) : shape.area.w * u / scene.w;
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(scene.w * k));
    off.height = Math.max(1, Math.round(scene.h * k));
    const og = off.getContext('2d');
    og.scale(k, k);
    await drawScene(scene, og);
    if (shape.area.h) {
      const dw = Math.round(src.w * k);
      const dh = off.height;
      g.drawImage(off, Math.round(src.x * k), 0, dw, dh, Math.round(shape.area.x * u + (shape.area.w * u - dw) / 2), Math.round(shape.area.y * u + (shape.area.h * u - dh) / 2), dw, dh);
    } else g.drawImage(off, Math.round(shape.area.x * u), Math.round(shape.area.y * u));
    // A small hint of where the separate ES wordmark print goes.
    const spot = LOGO_SPOTS[opts.logoSpot === undefined ? 'neck' : opts.logoSpot];
    if (spot && shape.path) {
      const img = await loadImage(BASE + (contrast(garment, ES_BLUE) < 1.6 ? WORDMARK.white : WORDMARK.blue));
      if (img) g.drawImage(img, Math.round((spot.x - spot.w / 2) * u), Math.round(spot.y * u), Math.round(spot.w * u), Math.round(spot.w * u * WORDMARK.h / WORDMARK.w));
    }
    return { width: size, height: size, scene };
  }

  // ─── Concepts without AI ───────────────────────────────────────────────
  const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'it', 'its', 'his', 'her', 'their', 'this', 'that', 'as', 'after', 'before', 'over', 'into', 'than', 'then', 'he', 'she', 'they', 'we', 'you', 'i', 'said', 'says', 'has', 'have', 'had', 'will', 'just', 'who', 'what', 'when']);
  let rightsIndex = null;
  const indexNow = () => rightsIndex || (rightsIndex = MerchRules.buildRightsIndex({ brandKit: deps.kit || [], vaTeams: deps.teams?.TEAMS || [] }));
  const hashOf = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h.toString(36); };
  function findQuote(text) {
    const m = text.match(/["“]([^"“”]{3,160})["”]/);
    if (!m) return null;
    const after = text.slice(m.index + m[0].length).match(/^\s*[,.—–-]*\s*(?:said|says)?\s*([A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+){0,2})/);
    const before = text.slice(0, m.index).match(/([A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+){0,2})\s+(?:said|says|told [\w ]+)[:,]?\s*$/);
    const by = (after && after[1]) || (before && before[1]) || '';
    return { text: m[1].trim().replace(/[.,]$/, ''), by: by.trim() };
  }
  function findNickname(text) {
    const m = text.match(/(?:nicknamed|known as|called|aka)\s+["“']?([A-Z][\w'’-]+(?:[ -][A-Z][\w'’-]+)?)/);
    if (m) return m[1];
    const q = text.match(/["“]([A-Z][\w'’-]+(?:\s[A-Z][\w'’-]+)?)["”]/);
    return q && q[1].length <= 14 ? q[1] : '';
  }
  function findNumber(text) {
    const m = text.match(/(?:^|[^\d.,$])(\d{1,2})(?!\d|[.,]\d)(?:\s+([A-Za-z]+))?/);
    if (!m) return null;
    const word = m[2] && !STOP.has(m[2].toLowerCase()) ? m[2] : '';
    return { n: m[1], word };
  }
  // The fill that stands out most on the team-colour shirt (knockout pills).
  const boldFill = pal => ['b', 'white', 'ink'].map(k => [k, contrast(resolve(k, pal), pal.a)]).sort((x, y) => y[1] - x[1])[0][0];
  function concept(base) {
    return { id: `fb-${base.collection}-${hashOf(JSON.stringify(base.stack))}`, align: 'left', blanks: ['tee', 'hoodie'], rights: [], why: '', ...base };
  }
  // content: a string, or { text, team, collection }. Returns up to opts.max
  // (default 4) concepts across collections, each fit to print.
  function fallbackConcepts(content, opts = {}) {
    const c = typeof content === 'string' ? { text: content } : (content || {});
    const text = MerchRules.clip(c.text, 600);
    const idx = indexNow();
    const hit = c.team ? { name: String(c.team.name || c.team) } : MerchRules.teamsIn(text, idx)[0];
    const team = hit ? { id: hashOf(hit.name), name: hit.name } : null;
    const pal = teamPalette(team?.name);
    const garmentTeam = { color: pal.a, name: colorName(pal.a) };
    const garmentWhite = { color: WHITE, name: 'White' };
    const teamRights = team ? [{ kind: 'team', text: team.name }] : [];
    const era = /\b(19|20)\d{2}s?\b|\bera\b|\bremember|\bback in\b|\bdynasty\b|\bclassic\b|\bthrowback\b/i.test(text);
    const out = [];
    const people = MerchRules.peopleIn(text, idx);
    const quote = findQuote(text);
    const nick = findNickname(text);
    const num = findNumber(text);

    if (people.length >= 2) {
      const names = people.slice(0, 5).map(p => p.split(' ').slice(-1)[0]);
      out.push(concept({ collection: era ? 'replay' : 'current', title: `${names.slice(0, 2).join(' / ')} stack`, team, palette: pal, garment: garmentWhite,
        stack: names.map((n, i) => ({ text: n, size: 'big', fill: i % 2 ? 'b' : 'a', ink: i % 2 ? 'ink' : (contrast(pal.a, WHITE) >= 3 ? 'white' : 'ink') })),
        rights: [...people.slice(0, 5).map(p => ({ kind: 'name', text: p })), ...teamRights], why: 'One name per pill in the team’s colours: the roll call fans remember.' }));
    }
    if (quote && quote.by) {
      out.push(concept({ collection: 'quote', title: 'In their own words', team, palette: pal, garment: garmentWhite, align: 'center', blanks: ['tee', 'hoodie', 'poster', 'mug'],
        stack: [{ text: quote.text, size: 'big', fill: 'a', ink: contrast(pal.b, pal.a) >= 2.4 ? 'b' : 'white' }, { text: `— ${quote.by}`, size: 'small', fill: 'b', ink: 'ink' }],
        rights: [{ kind: 'quote', text: quote.text }, { kind: 'name', text: quote.by }, ...teamRights], why: 'The exact words, attributed, in stacked pills.' }));
    }
    if (nick) {
      out.push(concept({ collection: 'nickname', title: nick, team, palette: pal, garment: garmentTeam, align: 'center',
        stack: [{ text: nick, size: 'big', fill: boldFill(pal), ink: 'a' }],
        rights: [{ kind: 'nickname', text: nick }, ...teamRights], why: 'Almost famous: one knockout pill in the shirt colour.' }));
    }
    if (num && team) {
      out.push(concept({ collection: era ? 'replay' : 'current', title: `#${num.n}`, team, palette: pal, garment: garmentTeam, align: 'center',
        stack: [{ text: num.n, size: 'big', fill: boldFill(pal), ink: 'a' }, ...(num.word ? [{ text: num.word, size: 'small', fill: boldFill(pal), ink: 'a' }] : [])],
        rights: teamRights, why: 'One number pill: the stat or the jersey, nothing else.' }));
    }
    // A banner from the story's own words (first clause, 2-4 content words).
    const words = text.replace(/["“”]/g, '').split(/[.!?;:—]/)[0].split(/\s+/).filter(Boolean);
    const phrase = words.slice(0, 4).join(' ');
    const bannerOk = phrase && words.length >= 2 && words.length <= 4 && !/\d/.test(phrase) && !STOP.has(words[words.length - 1].toLowerCase()) && phrase.length <= 26 && !MerchRules.bannedIn(phrase).length && words.some(w => !STOP.has(w.toLowerCase()));
    if (bannerOk && (team || out.length < 2)) {
      out.push(concept({ collection: era ? 'replay' : 'current', title: phrase, team, palette: pal, garment: team ? garmentTeam : garmentWhite, align: 'center',
        stack: [{ text: phrase, size: 'big', fill: team ? 'white' : 'a', ink: team ? 'a' : 'ink' }],
        rights: teamRights.concat(MerchRules.peopleIn(phrase, idx).map(p => ({ kind: 'name', text: p }))), why: 'One wide pill across the chest, like a headline.' }));
    }
    // Core ES: always offered; the line rotates with the content.
    const core = MerchRules.CORE_LINES[parseInt(hashOf(text || 'es'), 36) % MerchRules.CORE_LINES.length];
    out.push(concept({ collection: 'core', title: core.join(' '), team: null, palette: { ...MerchRules.ES_PALETTE }, garment: garmentWhite, blanks: ['tee', 'hoodie', 'sticker', 'mug', 'poster'],
      stack: core.map((t, i) => ({ text: t, size: 'big', fill: i % 2 ? 'b' : 'a', ink: 'ink' })), rights: [], why: 'Ours alone: an Essentially Sports line in ES blue.' }));
    if (out.length < 4) {
      out.push(concept({ collection: 'core', title: 'ESSENTIALLY SPORTS', team: null, palette: { ...MerchRules.ES_PALETTE }, garment: { color: '#0C2340', name: 'Navy' }, align: 'center', blanks: ['tee', 'hoodie', 'sticker'],
        stack: [{ text: 'ESSENTIALLY SPORTS', size: 'big', fill: 'a', ink: 'white' }], rights: [], why: 'The name, one pill, on navy.' }));
    }
    const seen = new Set();
    return out.filter(x => !seen.has(x.id) && seen.add(x.id)).slice(0, opts.max || 4);
  }

  return {
    VERSION: '2026-11-25b', WORDMARK, PHONE_MAX_PIXELS, SMALL, WRAP_AT, MIN_CAP_IN, MIN_CONTRAST, CAP, DEFAULT_AREAS, SAFE_IN, MUG_FACE,
    render, renderLogo, checks, preview, fallbackConcepts, layout, logoLayout, logoChecks, LOGO_SPOTS,
    teamPalette, colorName, areaOf, canvasPlan, approxMeasure, pillGeom, wrapText, rowsOf, rowColors, stackRows, checksFor, blocking,
    loadFonts, solidify, fontOf, findQuote, findNickname, findNumber,
  };
}));
