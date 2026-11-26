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
//               garment: { color, name }, stack: [{ text, size: 'big'|'mid'|'small', fill, ink }],
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
  const MID = 0.62; // mid pills: the lines under a big headline
  const WRAP_AT = 18; // big rows longer than this wrap into more pills
  const MIN_CAP_IN = { apparel: 0.12, other: 0.08 }; // smallest printable cap height
  const MIN_CONTRAST = 1.7; // box vs garment: below this a pill melts into the shirt (navy on black is ~1.5; gold on white ~1.8 still reads)
  let CAP = 0.675; // cap height / font size (Acumin Post 900, measured from the font; refined once it loads)
  // Safe edges for hard goods, in inches: poster trim, sticker cut line, mug handle seam.
  const SAFE_IN = { poster: 0.25, sticker: 0.125, mug: 0.5 };
  const MUG_FACE = 0.5; // share of the wrap seen from one side
  // Print areas used when the page has no template yet (previews, tests).
  const DEFAULT_AREAS = {
    tee: { pixelsWidth: 1800, pixelsHeight: 2400, dpi: 150 },
    // Live Fourthwall sizes (merch v2 server, 2026-11-25). Only used when no printSpec is given:
    // register rejects files that aren't the area's exact size, so the page always passes printSpec.
    hoodie: { pixelsWidth: 1650, pixelsHeight: 1650, dpi: 150 },
    poster: { pixelsWidth: 1500, pixelsHeight: 2100, dpi: 300 },
    sticker: { pixelsWidth: 900, pixelsHeight: 900, dpi: 300 },
    mug: { pixelsWidth: 2700, pixelsHeight: 1050, dpi: 300 },
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

  // ─── Pill colour options (Social / Newsletter's Sport → Team picker) ────
  // ES_BRAND_KIT entries: { sport, team | variation, primary, palette[] } of
  // { background, foreground, mist } pairs.
  const kitList = () => (Array.isArray(deps.kit) ? deps.kit : []).filter(e => e && e.sport);
  const kitName = e => String(e.team || e.variation || '');
  function kitSports() {
    return [...new Set(kitList().map(e => e.sport))];
  }
  // [{ name, entry }]: teams A–Z; variations (Tennis, Golf, Neutral) keep their order.
  function kitTeams(sport) {
    const list = kitList().filter(e => e.sport === sport && kitName(e)).map(entry => ({ name: kitName(entry), entry }));
    return list.every(t => t.entry.team) ? list.sort((x, y) => x.name.localeCompare(y.name)) : list;
  }
  const pairsOf = entry => {
    const pal = Array.isArray(entry?.palette) && entry.palette.length ? entry.palette : entry?.primary ? [entry.primary] : [];
    return pal.filter(p => p && hexOk(p.background));
  };
  // [{ bg, ink, label, index }]: one swatch per distinct box colour; index is
  // the pair's place in entry.palette (for paletteFromKit).
  function kitSwatches(entry) {
    const pairs = pairsOf(entry);
    const seen = new Set();
    const out = [];
    pairs.forEach((p, index) => {
      const bg = hex(p.background);
      if (seen.has(bg)) return;
      seen.add(bg);
      const others = pairs.filter(o => hex(o.background) !== bg);
      const ink = hex(FrameUpRules.pillTextColor({ ...p, background: bg }, others)) || pillInk(bg);
      out.push({ bg, ink, label: `${colorName(bg)} pill, ${colorName(ink).toLowerCase()} text`, index });
    });
    return out;
  }
  // { a, b, ink } for a picked swatch: a = that box colour, b = the next box
  // colour of the entry that reads as a different colour, ink = the text
  // colour on b (rows keep their a / b keys).
  function paletteFromKit(entry, index = 0) {
    const pairs = pairsOf(entry);
    if (!pairs.length) return { ...MerchRules.ES_PALETTE };
    const i = Number.isInteger(Number(index)) && pairs[Number(index)] ? Number(index) : 0;
    const pair = pairs[i];
    const a = hex(pair.background);
    const rest = [...pairs.slice(i + 1), ...pairs.slice(0, i)];
    const cands = [...rest.map(p => p.background), pair.mist, pair.foreground].map(hex).filter(Boolean);
    let b = cands.find(c => c !== a && contrast(a, c) >= 1.6) || (isLight(a) ? BLACK : WHITE);
    if (contrast(a, b) < 1.6) b = isLight(a) ? BLACK : WHITE;
    const ink = pillInk(b, pairs.filter(p => hex(p.background) !== b));
    return { a, b, ink };
  }
  // ES colours (ES Blue, Navy, White, Black), text by the ES pairs.
  const ES_SWATCHES = Object.freeze([
    { bg: ES_BLUE, label: 'ES Blue', with: [WHITE] },
    { bg: '#033162', label: 'Navy', with: [WHITE] },
    { bg: WHITE, label: 'White', with: [ES_BLUE] },
    { bg: BLACK, label: 'Black', with: [WHITE] },
  ].map(s => Object.freeze({ bg: s.bg, ink: pillInk(s.bg, s.with), label: s.label })));
  // Box colour vs garment colour (MIN_CONTRAST is the print check's floor).
  const boxContrast = (c, garment) => contrast(hex(c) || BLACK, hex(garment) || WHITE);

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
  // A row colour is a palette key (a | b | ink), white, black, or a hex
  // ('#RRGGBB', any case) the person picked.
  function resolve(key, pal) {
    if (key === 'a' || key === 'b' || key === 'ink') return hex(pal[key]) || BLACK;
    if (key === 'white') return WHITE;
    if (key === 'black') return BLACK;
    return hex(key) || hex(pal.a) || BLACK;
  }
  // Text colour for a pill box (the editor's rule: FrameUpRules.pillTextColor).
  // others: the other pairs of the same brand-kit entry, or plain hex strings.
  function pillInk(bg, others = []) {
    const b = hex(bg) || BLACK;
    const pairs = (Array.isArray(others) ? others : []).map(o => (typeof o === 'string' ? { background: o } : o)).filter(o => o && hexOk(o.background));
    return hex(FrameUpRules.pillTextColor({ background: b }, pairs)) || (isLight(b) ? BLACK : WHITE);
  }
  // The box must stand off the shirt; type in the shirt colour is a knockout;
  // otherwise type must stand off the box. A hex the person picked is never
  // swapped (the checks flag it instead); keys keep the automatic swap.
  function rowColors(row, pal, garment, apparel) {
    const options = [pal.a, pal.b, pal.ink, WHITE, BLACK].map(hex).filter(Boolean);
    const custom = hexOk(row.fill);
    const customInk = hexOk(row.ink);
    let bg = resolve(row.fill || 'a', pal);
    let ink = row.ink ? resolve(row.ink, pal) : custom ? pillInk(bg) : resolve(row.fill === 'b' ? 'ink' : 'white', pal);
    if (!custom && contrast(bg, garment) < MIN_CONTRAST) {
      const a = hex(pal.a) || ES_BLUE;
      // The second colour lost on the shirt: white (on dark) or black (on light) pill, team-colour text.
      const swap = isLight(garment) ? BLACK : WHITE;
      if (row.fill !== 'a' && contrast(swap, garment) >= MIN_CONTRAST && a !== bg && contrast(a, swap) >= 2.4 && contrast(a, garment) >= MIN_CONTRAST) { bg = swap; ink = a; }
      else bg = options.filter(c => c !== garment).sort((x, y) => (contrast(y, garment) >= MIN_CONTRAST ? 1 : 0) - (contrast(x, garment) >= MIN_CONTRAST ? 1 : 0) || options.indexOf(x) - options.indexOf(y))[0];
    }
    const knockout = apparel && contrast(ink, garment) < 1.15 && contrast(bg, garment) >= MIN_CONTRAST;
    if (!knockout && !customInk && contrast(ink, bg) < 2.4) ink = custom ? pillInk(bg) : options.filter(c => c !== bg).sort((x, y) => contrast(y, bg) - contrast(x, bg))[0];
    return { bg, ink, knockout, custom };
  }
  const sameLook = (p, q) => Boolean(p && q && p.bg) && p.bg === q.bg && Boolean(p.knockout) === Boolean(q.knockout);

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
      const rel = small ? SMALL : r.size === 'mid' ? MID : 1;
      const parts = !small && up(r.text).length > WRAP_AT ? wrapText(r.text) : [up(r.text)];
      parts.forEach(t => rows.push({ text: t, rel, row: r }));
    });
    return rows.slice(0, 14);
  }

  // ─── Fit: size and position the person sets in FrameUp ─────────────────
  // concept.fit = { scale: 0.6-1.6 (1 = the default compact size), topIn:
  // inches from the top of the print area (apparel; null = default) }.
  const FIT = { scaleMin: 0.6, scaleMax: 1.6, topMinIn: 0.5, topMaxIn: 10 };
  const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function fitOf(concept = {}) {
    const f = concept.fit || {};
    const scale = Number(f.scale) > 0 ? clampN(Number(f.scale), FIT.scaleMin, FIT.scaleMax) : 1;
    const topIn = f.topIn === null || f.topIn === undefined || f.topIn === '' || !Number.isFinite(Number(f.topIn)) ? null : clampN(Number(f.topIn), FIT.topMinIn, FIT.topMaxIn);
    return { scale, topIn };
  }
  // ─── Pro elements (beside the pills; solid ink, print-safe) ─────────────
  // Basic designs are pills only. Pro may add up to 3 of these:
  //   number { text: 1-2 digits, style: solid|outline, color, position: behind|above }
  //   rule   { position: above|below|between, color, weight: thin|thick }
  //   block  { position: behind, color }  (a solid patch behind the stack)
  //   icon   { name: ICONS, position: above|below|left, color }
  // Icons are original simple shapes on a 24-unit grid: `fill` is solid ink,
  // `cut` lines are knocked out (the shirt shows through).
  const ELEMENT_TYPES = Object.freeze({ number: ['behind', 'above'], rule: ['above', 'below', 'between'], block: ['behind'], icon: ['above', 'below', 'left'] });
  const ICON_SHAPES = {
    star: { fill: 'M12 1.8l3 6.7 7.2.7-5.4 4.8 1.6 7.1L12 17.4l-6.4 3.7 1.6-7.1L1.8 9.2 9 8.5z' },
    crown: { fill: 'M2.5 6.5l5 4.5L12 3.5l4.5 7.5 5-4.5-2 13h-15z' },
    flame: { fill: 'M12 1.5c1.2 4.2 5.5 6.3 5.5 11.5a5.5 5.5 0 0 1-11 0c0-3.2 2-4.6 2.2-7.6 1.6 1.1 2.3 2.7 2.3 4.4 1.2-2.2 1.3-5.3 1-8.3z' },
    bolt: { fill: 'M13.5 1.5L3.5 14h7l-1.5 8.5L20.5 9.5h-7z' },
    trophy: { fill: 'M6.5 2.5h11v2.5h3.5v2.5a5 5 0 0 1-5 5h-.4a5.6 5.6 0 0 1-2.6 3v2.5h3.5v3.5H7.5V18H11v-2.5a5.6 5.6 0 0 1-2.6-3H8a5 5 0 0 1-5-5V5h3.5z', cut: ['M5 6.8a2.6 2.6 0 0 0 1.6 3.1', 'M19 6.8a2.6 2.6 0 0 1-1.6 3.1'] },
    arrow: { fill: 'M2.5 9.5h11V4l8 8-8 8v-5.5h-11z' },
    basketball: { fill: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20z', cut: ['M12 2v20', 'M2 12h20', 'M5 4.8c3 2.6 3 11.8 0 14.4', 'M19 4.8c-3 2.6-3 11.8 0 14.4'] },
    football: { fill: 'M3.2 20.8c-1.6-5.6.2-12 4.7-15.5S18.3 1.6 20.8 3.2c1.6 5.6-.2 12-4.7 15.5s-10.4 3.7-12.9 2.1z', cut: ['M8.5 15.5l7-7', 'M10 11.2l2.8 2.8', 'M11.8 9.4l2.8 2.8', 'M8.2 13l2.8 2.8'] },
    baseball: { fill: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20z', cut: ['M6.2 4c2.6 4.2 2.6 11.8 0 16', 'M17.8 4c-2.6 4.2-2.6 11.8 0 16'] },
    soccer: { fill: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20z', cut: ['M12 7.5l4.3 3.1-1.6 5h-5.4l-1.6-5z', 'M12 7.5V3', 'M16.3 10.6l4.2-1.4', 'M14.7 15.6l2.6 3.7', 'M9.3 15.6l-2.6 3.7', 'M7.7 10.6L3.5 9.2'] },
    hockey: { fill: 'M14.5 1.5h3.2l-4.4 15.5h5.2a2.2 2.2 0 0 1 0 4.4H8.6l-1.3-4.4h4.2zM2.5 19.2c0-1.2 1.8-2 4-2s4 .8 4 2-1.8 2-4 2-4-.8-4-2z' },
    golf: { fill: 'M7 1.5h2V19H7zM9 1.5l9 4.3-9 4.3zM8 18.5c2.8 0 5 .9 5 2s-2.2 2-5 2-5-.9-5-2 2.2-2 5-2z' },
    tennis: { fill: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20z', cut: ['M4.2 5.8c4.3 2.6 4.3 9.8 0 12.4', 'M19.8 5.8c-4.3 2.6-4.3 9.8 0 12.4'] },
    'racing-flag': { fill: 'M4 1.5h2v21H4zM6 2.5h4v4H6zM14 2.5h4v4h-4zM10 6.5h4v4h-4zM18 6.5h3v4h-3zM6 10.5h4v4H6zM14 10.5h4v4h-4z' },
  };
  const ICONS = Object.freeze(Object.keys(ICON_SHAPES));
  // Keeps only valid elements (Pro), max 3; numbers 1-2 digits.
  function elementsOf(concept = {}) {
    if (concept.mode === 'basic' || !Array.isArray(concept.elements)) return [];
    const okColor = c => ['a', 'b', 'ink', 'white', 'black'].includes(c) || hexOk(c);
    return concept.elements.filter(e => e && ELEMENT_TYPES[e.type] && ELEMENT_TYPES[e.type].includes(e.position || ELEMENT_TYPES[e.type][0]) && okColor(e.color || 'a'))
      .filter(e => (e.type !== 'number' || /^\d{1,2}$/.test(String(e.text || ''))) && (e.type !== 'icon' || ICON_SHAPES[e.name]))
      .slice(0, 3).map(e => ({ ...e, position: e.position || ELEMENT_TYPES[e.type][0] }));
  }

  // Splits words into pills: 'word' one word each (tiny words ride with the
  // next), 'pair' two words, 'line' long lines, 'auto' balanced rows.
  const TINY = new Set(['A', 'AN', 'THE', 'OF', 'IN', 'ON', 'AT', 'TO', 'FOR', 'AND', 'OR', 'BY', 'IS', 'IT', 'MY', 'NO', 'SO', 'WE', 'I']);
  function splitWords(text, mode = 'auto') {
    const words = up(text).split(' ').filter(Boolean);
    if (!words.length) return [];
    if (mode === 'line') return wrapText(text, 24);
    if (mode === 'word' || mode === 'pair') {
      const units = [];
      let carry = '';
      words.forEach(w => { if (TINY.has(w.replace(/[^A-Z]/g, '')) && w.length <= 3) carry = carry ? `${carry} ${w}` : w; else { units.push(carry ? `${carry} ${w}` : w); carry = ''; } });
      if (carry) { if (units.length) units[units.length - 1] += ` ${carry}`; else units.push(carry); }
      if (mode === 'word') return units;
      const out = [];
      for (let i = 0; i < units.length; i += 2) out.push(units.slice(i, i + 2).join(' '));
      return out;
    }
    return wrapText(text);
  }

  // Rows -> placed pills inside box (sized so the widest row and the whole
  // stack fit). ES pill spacing (the editor's drawPills): 0 gap between rows.
  // A row the same colour as the row above (same box colour and knockout)
  // starts at the upper row's pillMetrics().step, so it overlaps the upper
  // box's padding under the letters; a row in a different colour starts at the
  // upper row's full height (touching). Heights and steps are whole pixels so
  // the overlap is exactly h - step. Rows draw in order: the lower box covers
  // the upper box's bottom padding, never its letters (step > baseline).
  function rowAdvance(prev, cur, size, scale) {
    const g = pillGeom(size * prev.rel, scale);
    return sameLook(prev, cur) ? Math.round(g.step) : Math.round(g.h);
  }
  function stackHeight(rows, size, scale) {
    let y = 0;
    rows.forEach((r, i) => { if (i) y += rowAdvance(rows[i - 1], r, size, scale); });
    return y + Math.round(pillGeom(size * rows[rows.length - 1].rel, scale).h);
  }
  function stackRows(rows, box, measure, scale, align) {
    const at100 = rows.map(r => { const g = pillGeom(100 * r.rel, scale); return { w: measure(r.text, 100 * r.rel) + g.padL + g.padR }; });
    const maxW = Math.max(...at100.map(r => r.w));
    // Width scales linearly with size; the stack height doesn't quite (the
    // 1px gaps in step scale with the canvas), so search the biggest size
    // whose real stack height fits the box.
    let lo = 4;
    let hi = Math.max(4, Math.floor((box.w / maxW) * 100));
    if (stackHeight(rows, hi, scale) <= box.h) lo = hi;
    else {
      while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (stackHeight(rows, mid, scale) <= box.h) lo = mid; else hi = mid; }
    }
    const size = lo;
    const items = [];
    let y = 0;
    let blockW = 0;
    rows.forEach((r, i) => {
      const s = size * r.rel;
      const g = pillGeom(s, scale);
      const w = measure(r.text, s) + g.padL + g.padR;
      blockW = Math.max(blockW, w);
      if (i) y += rowAdvance(rows[i - 1], r, size, scale);
      items.push({ type: 'pill', text: r.text, size: s, w, h: Math.round(g.h), padL: g.padL, baseline: g.baseline, y, bg: r.bg, ink: r.ink, knockout: r.knockout, custom: Boolean(r.custom), small: r.rel < 1, align: r.align || align });
    });
    const stackH = items.length ? Math.max(...items.map(p => p.y + p.h)) : 0;
    const x0 = box.x + (box.w - blockW) / 2;
    const y0 = Math.round(box.y + (box.valign === 'top' ? 0 : (box.h - stackH) / 2));
    items.forEach(p => {
      p.x = Math.round(p.align === 'center' ? x0 + (blockW - p.w) / 2 : x0);
      p.y = y0 + p.y;
      p.w = Math.round(p.w);
    });
    return { items, size, bounds: { x: Math.round(x0), y: y0, w: Math.round(blockW), h: stackH } };
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
    // Owner feedback (2026-11-26): designs read too small; start near a full chest print (~10 in on a 15 in area).
    const widthRatio = single ? (longest <= 3 ? 0.34 : longest <= 10 ? 0.6 : 0.78) : concept.collection === 'quote' ? 0.74 : 0.68;
    const fit = fitOf(concept);
    let box;
    if (blank.apparel) {
      const wr = Math.min(0.94, widthRatio * fit.scale);
      const top = fit.topIn !== null ? Math.min(Math.round(fit.topIn * a.dpi), H - margin - 10) : Math.round(Math.min(1.75 * a.dpi, H * 0.12));
      box = { x: Math.round(W * (1 - wr) / 2), y: top, w: Math.round(W * wr), h: Math.max(10, Math.round(Math.min(H - top - margin, H * 0.7 * fit.scale))), valign: 'top' };
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
    // Hard goods can only shrink inside their safe edge.
    if (!blank.apparel && fit.scale < 1) { const nw = Math.round(box.w * fit.scale); const nh = Math.round(box.h * fit.scale); box.x += Math.round((box.w - nw) / 2); box.y += Math.round((box.h - nh) / 2); box.w = nw; box.h = nh; }
    if (single && longest > 3) box.h = Math.min(box.h, Math.round(box.w * 0.34));
    // Hard goods have one print area, so the ES wordmark goes under the design.
    const inlineLogo = !blank.apparel && (spec.logo === 'inline' || spec.logo === 'inside');
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
    const els = elementsOf(concept);
    let result = stackRows(rows, box, m, scale, align);
    const extras = [];
    if (els.length) {
      // A 'between' rule sits under the first row: a second row of the same
      // colour overlaps the first, so it moves down by that overlap too.
      const overlapOf = r => (r.items.length > 1 ? Math.max(0, r.items[0].y + r.items[0].h - r.items[1].y) : 0);
      // Room the elements need around the stack, relative to the big pill height.
      const need = (r) => {
        const ph = pillGeom(r.size, scale).h;
        const e = { top: 0, bottom: 0, left: 0, gapIn: 0 };
        els.forEach(el => {
          if (el.type === 'rule') { const t = Math.max(Math.round(0.05 * a.dpi), Math.round(ph * (el.weight === 'thick' ? 0.16 : 0.07))); const g = Math.round(t * 1.6); if (el.position === 'above') e.top += t + g; else if (el.position === 'below') e.bottom += t + g; else e.gapIn += t + 2 * g + overlapOf(r); }
          if (el.type === 'icon') { const sz = Math.round(ph * 1.1); if (el.position === 'above') e.top += sz + Math.round(ph * 0.25); else if (el.position === 'below') e.bottom += sz + Math.round(ph * 0.25); else e.left += sz + Math.round(ph * 0.3); }
          if (el.type === 'number' && el.position === 'above') e.top += Math.round(ph * 1.9);
          if (el.type === 'block') { const pad = Math.round(ph * 0.3); e.top += pad; e.bottom += pad; e.left += pad / 2; }
        });
        return e;
      };
      let e = need(result);
      const bw = result.bounds.w + e.left;
      const bh = result.bounds.h + e.top + e.bottom + e.gapIn;
      const k = Math.min(1, box.w / bw, box.h / bh);
      if (k < 1) { result = stackRows(rows, { ...box, w: Math.floor(box.w * k), h: Math.floor(box.h * k) }, m, scale, align); e = need(result); }
      const ph = pillGeom(result.size, scale).h;
      // Centre the group (stack + extras) in the box.
      const groupW = result.bounds.w + e.left;
      const groupH = result.bounds.h + e.top + e.bottom + e.gapIn;
      const gx = box.x + Math.round((box.w - groupW) / 2);
      const gy = box.y + (box.valign === 'top' ? 0 : Math.round((box.h - groupH) / 2));
      const dx = gx + e.left - result.bounds.x;
      const dy = gy + e.top - result.bounds.y;
      result.items.forEach(i => { i.x += dx; i.y += dy; });
      result.bounds.x += dx; result.bounds.y += dy;
      // 'between' rule: push rows after the first down.
      const between = els.find(el => el.type === 'rule' && el.position === 'between');
      if (between && result.items.length > 1) { result.items.slice(1).forEach(i => { i.y += e.gapIn; }); result.bounds.h += e.gapIn; }
      const b = result.bounds;
      const col = key => resolve(key || 'a', pal);
      let top = b.y;
      let bottom = b.y + b.h;
      els.forEach(el => {
        if (el.type === 'block') { const pad = Math.round(ph * 0.3); extras.push({ type: 'rect', role: 'block', z: -2, x: b.x - Math.round(pad / 2), y: b.y - pad, w: b.w + pad, h: b.h + 2 * pad, bg: col(el.color) }); }
        if (el.type === 'number') {
          // A thin outline needs more contrast than a solid shape to read on the shirt.
          let fill = col(el.color);
          const needN = el.style === 'outline' ? 3 : MIN_CONTRAST;
          if (blank.apparel && contrast(fill, garment) < needN) fill = [pal.a, pal.b, pal.ink, isLight(garment) ? BLACK : WHITE].map(hex).filter(Boolean).find(c => contrast(c, garment) >= needN) || (isLight(garment) ? BLACK : WHITE);
          if (el.position === 'behind') { const size = Math.round(Math.min(b.h * 1.25, b.w * 1.1) / CAP * 0.82); extras.push({ type: 'number', z: -1, text: String(el.text), style: el.style === 'outline' ? 'outline' : 'solid', size, stroke: Math.max(Math.round(0.06 * a.dpi), Math.round(size * 0.035)), x: b.x, y: b.y, w: b.w, h: b.h, ink: fill, bg: fill }); }
          else { const size = Math.round((ph * 1.7) / CAP); const h = Math.round(size * CAP); top -= h + Math.round(ph * 0.2); extras.push({ type: 'number', z: 1, text: String(el.text), style: el.style === 'outline' ? 'outline' : 'solid', size, stroke: Math.max(Math.round(0.06 * a.dpi), Math.round(size * 0.035)), x: b.x, y: top, w: b.w, h, ink: fill, bg: fill, align: align === 'center' ? 'center' : 'left' }); }
        }
        if (el.type === 'rule') {
          const t = Math.max(Math.round(0.05 * a.dpi), Math.round(ph * (el.weight === 'thick' ? 0.16 : 0.07)));
          const g = Math.round(t * 1.6);
          let y;
          if (el.position === 'above') { top -= t + g; y = top; }
          else if (el.position === 'below') { y = bottom + g; bottom = y + t; }
          else { const first = result.items[0]; y = first.y + first.h + g; }
          extras.push({ type: 'rect', role: 'rule', z: 1, x: b.x, y, w: b.w, h: t, bg: col(el.color) });
        }
        if (el.type === 'icon') {
          const sz = Math.round(ph * 1.1);
          let x; let y;
          if (el.position === 'left') { x = b.x - sz - Math.round(ph * 0.3); y = b.y + Math.round((Math.min(b.h, ph * 2) - sz) / 2); }
          else if (el.position === 'above') { top -= sz + Math.round(ph * 0.25); y = top; x = align === 'center' ? b.x + Math.round((b.w - sz) / 2) : b.x; }
          else { y = bottom + Math.round(ph * 0.25); bottom = y + sz; x = align === 'center' ? b.x + Math.round((b.w - sz) / 2) : b.x; }
          extras.push({ type: 'icon', z: 1, name: el.name, x, y, w: sz, h: sz, bg: col(el.color) });
        }
      });
    }
    // Elements behind the pills draw first.
    items.push(...extras.filter(x => x.z < 0).sort((p, q) => p.z - q.z), ...result.items, ...extras.filter(x => x.z > 0));
    const all = items.filter(i => i.type !== 'logo');
    const design = all.length ? (() => { const x0 = Math.min(...all.map(i => i.x)); const y0 = Math.min(...all.map(i => i.y)); return { x: x0, y: y0, w: Math.max(...all.map(i => i.x + i.w)) - x0, h: Math.max(...all.map(i => i.y + i.h)) - y0 }; })() : { ...result.bounds };
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
    return { w: W, h: H, dpi: a.dpi, inW: a.inW, inH: a.inH, region: a.region, kind, apparel: blank.apparel, garment, palette: pal, items, design, size: result.size, bigRows: bigRows.length, inlineLogo, fit, designIn: { w: design.w / a.dpi, h: design.h / a.dpi, top: design.y / a.dpi } };
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
    const boxes = scene.items.filter(i => i.type === 'pill' || i.type === 'block' || i.type === 'rect' || i.type === 'icon' || i.type === 'number');
    // A pill on a block sits on the block, not the shirt.
    const block = scene.items.find(i => i.role === 'block');
    const under = i => (block && i.type === 'pill' ? block.bg : scene.garment);
    const lost = boxes.find(i => contrast(i.bg, under(i)) < MIN_CONTRAST);
    const whiteOnWhite = scene.apparel && contrast(scene.garment, WHITE) < 1.2 && boxes.some(i => contrast(i.bg, WHITE) < 1.2);
    const unreadable = boxes.find(i => i.type === 'pill' && !i.knockout && contrast(i.ink, i.bg) < 2.4);
    const garmentOk = !lost && !whiteOnWhite && !unreadable;
    const blankName = `${colorName(scene.garment).toLowerCase()} ${scene.apparel ? 'tee' : 'blank'}`;
    add('garment', garmentOk, 'error', garmentOk ? 'Every colour stands out from the blank.'
      : lost && lost.type === 'pill' && lost.custom ? `The custom colour ${lost.bg} on the "${lost.text}" pill is too close to the ${blankName}, so the pill won’t stand out. Pick another colour for that pill.`
      : unreadable && unreadable.custom ? `"${unreadable.text}" is hard to read on its custom colour ${unreadable.bg}. Pick another text colour or pill colour.`
      : unreadable ? `"${unreadable.text}" is hard to read on its box. Swap the colours.` : `The "${(lost || boxes[0]).text || (lost || boxes[0]).name || (lost || boxes[0]).role || 'design'}" ${lost?.type === 'pill' || !lost ? 'box' : 'element'} disappears on a ${colorName(scene.garment).toLowerCase()} ${scene.apparel ? 'shirt' : 'blank'}. Pick another colour.`);
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
      add('placement', inches <= 12.5, 'warn', inches <= 12.5 ? `Design is ${inches.toFixed(1)} in wide: a chest print.` : `Design is ${inches.toFixed(1)} in wide, wider than a chest print. Make it smaller or use shorter words.`);
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
        const mctx = document.createElement('canvas').getContext('2d');
        liveMeasure = canvasMeasure(mctx);
        try { mctx.font = fontOf(1000); const asc = mctx.measureText('H').actualBoundingBoxAscent / 1000; if (asc > 0.5 && asc < 0.8) CAP = asc; } catch { /* keep the default */ }
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
      } else if (it.type === 'rect') {
        g.fillStyle = it.bg;
        g.fillRect(it.x, it.y, it.w, it.h);
      } else if (it.type === 'number') {
        g.font = fontOf(it.size);
        g.textBaseline = 'alphabetic';
        const capH = it.size * CAP;
        g.textAlign = it.align === 'left' ? 'left' : 'center';
        const tx = it.align === 'left' ? it.x : it.x + it.w / 2;
        const ty = it.y + (it.h + capH) / 2;
        if (it.style === 'outline') { g.strokeStyle = it.ink; g.lineWidth = it.stroke; g.lineJoin = 'miter'; g.strokeText(it.text, tx, ty); }
        else { g.fillStyle = it.ink; g.fillText(it.text, tx, ty); }
        g.textAlign = 'left';
      } else if (it.type === 'icon') {
        const shape = ICON_SHAPES[it.name];
        if (shape && typeof Path2D !== 'undefined') {
          g.save();
          g.translate(it.x, it.y);
          g.scale(it.w / 24, it.h / 24);
          g.fillStyle = it.bg;
          g.fill(new Path2D(shape.fill), 'evenodd');
          if (shape.cut) { g.globalCompositeOperation = 'destination-out'; g.strokeStyle = BLACK; g.lineWidth = 1.5; g.lineCap = 'round'; g.lineJoin = 'round'; shape.cut.forEach(d => g.stroke(new Path2D(d))); }
          g.restore();
        }
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
    sleeve: { x: 872, y: 290, w: 54 }, // wearer's left sleeve = viewer's right (Fourthwall sleeve_left)
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

  // Close-up: just the design on the blank's colour, filling the canvas, so
  // designs can be compared at a glance (the tee mockup shows placement).
  async function closeup(concept, garmentColor, canvas, opts = {}) {
    await loadFonts();
    const kind = MerchRules.BLANKS[opts.kind] ? opts.kind : 'tee';
    const apparel = MerchRules.BLANKS[kind].apparel;
    const garment = apparel ? (hex(garmentColor) || hex(concept?.garment?.color) || WHITE) : WHITE;
    const W = canvas.width || 480;
    const H = canvas.height || 560;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.fillStyle = garment;
    g.fillRect(0, 0, W, H);
    const spec = { ...(DEFAULT_AREAS[kind]), ...(opts.spec || {}), garmentColor: garment, kind };
    const scene = layout(concept, spec);
    const d = scene.design;
    const pad = opts.pad ?? 0.1;
    const k = Math.min((W * (1 - 2 * pad)) / Math.max(1, d.w), (H * (1 - 2 * pad)) / Math.max(1, d.h));
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const og = off.getContext('2d');
    og.translate(W / 2 - (d.x + d.w / 2) * k, H / 2 - (d.y + d.h / 2) * k);
    og.scale(k, k);
    await drawScene(scene, og);
    g.drawImage(off, 0, 0);
    return { width: W, height: H, scene };
  }

  // ─── Mockup on Fourthwall's real blank photos (the fallback mockup) ─────
  // Fourthwall's templates carry 4 real photos per colour (colorVariants[].photos).
  // Every colour of a template is the same shoot re-coloured (same pose per photo
  // index, checked on all colours 2026-11-26), so one calibration per photo index
  // serves every colour. PHOTO_AREAS[templateId][photoIndex] says where the print
  // sits on that photo; photos without an entry never get a design drawn.
  //
  // Measured by eye on the 720 x 960 photos (2026-11-26, merch7), in photo pixels:
  //   ppi   photo pixels per inch of fabric at the chest (from tee length, shoulder
  //         and forearm proportions), so the print is drawn at its real size;
  //   top   y of the print area's top edge (Fourthwall front_large starts just under
  //         the neckline; back_large ~2.5 in under the back collar);
  //   body  the torso as a cylinder seen from the camera: axis x (cx), radius (r) and
  //         the angle of the print's centre line (yaw, degrees; 0 = facing camera).
  //         The flat print wraps round it, so the edges foreshorten like on a body;
  //   torso the visible shirt panel (sleeves, arms and hands in front are cut out):
  //         the print is clipped to it, so an arm in front of the chest covers ink
  //         (occluded names what covers part of the print; never the photo to open on);
  //   logo.sleeve / sleeveLeft  the ES wordmark spot on the wearer's left sleeve
  //         (viewer's right on front photos) and that sleeve's outline (tests keep
  //         the spot inside it). Back photos carry no logo spot.
  // x, y, w, h (fractions) are the template's main area of that side, for callers
  // that only need a box. scripts/test-merch-v3.mjs guards all of it.
  const PHOTO_W = 720;
  const PHOTO_H = 960;
  // merch7 blanks (PROD lane): long sleeve, crewneck, tank, youth tee. The tote's only
  // photo is an angled product shot, so it keeps the flat preview.
  const TEMPLATE_KIND = { tee: 'pro_Vv1XdaPMSdm6jZ5pj24NCQ', hoodie: 'pro_380', longsleeve: 'pro_6ae602fcb22447bfbc', crewneck: 'pro_14kNy0EJQkqopY-Z9Pm41A', tank: 'pro_xPL7YjOBRQWVL50Im8eKAA', youth: 'pro_ODh_gv0ESl6jIcRfvSww0w' };
  // The photo to open on per template (the hoodie's photo 0 has an arm across the chest).
  // What each photo index shows (all four, calibrated or not), when the reply has no angle.
  // What each photo index shows (all of them, calibrated or not), when the templates
  // reply carries no angle. Same order as PROD's PHOTO_ANGLES (_merch-templates.js).
  const PHOTO_ANGLES = {
    pro_Vv1XdaPMSdm6jZ5pj24NCQ: ['front', 'side', 'side', 'back'], pro_380: ['front', 'back', 'front', 'back'],
    pro_6ae602fcb22447bfbc: ['front', 'side', 'front', 'back', 'detail', 'detail'], 'pro_14kNy0EJQkqopY-Z9Pm41A': ['front', 'back', 'side', 'side'],
    pro_xPL7YjOBRQWVL50Im8eKAA: ['front', 'back', 'front', 'back', 'detail', 'detail'], pro_ODh_gv0ESl6jIcRfvSww0w: ['flat', 'flat'], pro_367: ['front'],
  };
  const PHOTO_HERO = { pro_Vv1XdaPMSdm6jZ5pj24NCQ: 0, pro_380: 2, pro_6ae602fcb22447bfbc: 0, 'pro_14kNy0EJQkqopY-Z9Pm41A': 0, pro_xPL7YjOBRQWVL50Im8eKAA: 0, pro_ODh_gv0ESl6jIcRfvSww0w: 0 };
  const MAIN_INCHES = {
    pro_Vv1XdaPMSdm6jZ5pj24NCQ: { front: [15, 18], back: [15, 18] }, pro_380: { front: [11, 11], back: [15, 18] },
    pro_6ae602fcb22447bfbc: { front: [15, 18], back: [15, 18] }, 'pro_14kNy0EJQkqopY-Z9Pm41A': { front: [15, 18], back: [15, 18] },
    pro_xPL7YjOBRQWVL50Im8eKAA: { front: [12, 16], back: [12, 16] }, pro_ODh_gv0ESl6jIcRfvSww0w: { front: [10, 12], back: [10, 12] },
  };
  const PHOTO_PX = {
    // Stanley/Stella Creator tee (male model, ~17 px/in on the close shots).
    pro_Vv1XdaPMSdm6jZ5pj24NCQ: {
      0: { angle: 'front', side: 'front', ppi: 17, top: 296, body: { cx: 362, r: 122, yaw: 0 },
        torso: [[236, 300], [290, 262], [330, 272], [365, 284], [400, 272], [440, 262], [492, 300], [490, 780], [232, 780]],
        logo: { sleeve: { x: 530, y: 418, w: 28, rot: 13 } },
        sleeveLeft: [[512, 318], [532, 302], [572, 470], [508, 490]] },
      // 1: waist-up three-quarter ('side'): the chest still faces the camera.
      1: { angle: 'side', side: 'front', ppi: 17, top: 306, body: { cx: 366, r: 114, yaw: -9 },
        // his left forearm crosses the shirt low on the right: cut out of the panel
        torso: [[250, 330], [254, 298], [305, 262], [345, 290], [395, 252], [462, 282], [472, 470], [478, 545], [446, 600], [404, 668], [330, 700], [250, 740]],
        logo: { sleeve: { x: 512, y: 380, w: 34, rot: 9 } },
        sleeveLeft: [[468, 292], [528, 298], [556, 352], [568, 466], [500, 476], [478, 400]] },
      // 2: back three-quarter, his arm covers the back: no calibration.
      3: { angle: 'back', side: 'back', ppi: 11.5, top: 197, body: { cx: 358, r: 90, yaw: 0 },
        torso: [[262, 196], [320, 172], [358, 167], [398, 172], [455, 196], [448, 320], [452, 500], [272, 505], [272, 320]] },
    },
    // Cotton Heritage premium hoodie (female model).
    pro_380: {
      // 0: close front; her right arm is raised in front of the chest (viewer's left),
      // so the left of a wide print hides behind the sleeve.
      0: { angle: 'front', side: 'front', occluded: 'arm', ppi: 18.8, top: 400, body: { cx: 360, r: 160, yaw: -4 },
        torso: [[282, 355], [330, 338], [380, 342], [470, 336], [508, 372], [500, 470], [492, 640], [302, 640], [297, 560], [286, 450]],
        logo: { sleeve: { x: 526, y: 580, w: 24, rot: 4 } },
        sleeveLeft: [[508, 392], [540, 400], [556, 520], [556, 700], [548, 800], [500, 800], [494, 600], [500, 470]] },
      1: { angle: 'back', side: 'back', ppi: 18.3, top: 415, body: { cx: 375, r: 170, yaw: 8.5 },
        torso: [[215, 400], [262, 330], [300, 312], [470, 312], [525, 350], [512, 430], [500, 600], [502, 760], [496, 840], [210, 840], [205, 560]] },
      2: { angle: 'front', side: 'front', ppi: 11.2, top: 240, body: { cx: 362, r: 85, yaw: 0 },
        torso: [[288, 218], [332, 204], [390, 204], [438, 218], [444, 372], [440, 512], [282, 512], [284, 372]],
        logo: { sleeve: { x: 460, y: 352, w: 17, rot: 6 } },
        sleeveLeft: [[440, 226], [468, 236], [488, 320], [492, 500], [458, 506], [448, 330]] },
      // 3: back three-quarter, her right arm covers half the back: no calibration.
    },
    // Gildan long sleeve (female model; 2 = raised arm, 4-5 = close-up details: not calibrated).
    pro_6ae602fcb22447bfbc: {
      0: { angle: 'front', side: 'front', ppi: 21, top: 298, body: { cx: 302, r: 140, yaw: -3 },
        torso: [[165, 300], [200, 262], [245, 250], [290, 282], [340, 250], [400, 262], [432, 300], [445, 430], [470, 560], [520, 700], [540, 860], [150, 860], [160, 600]],
        logo: { sleeve: { x: 472, y: 462, w: 28, rot: 27 } },
        sleeveLeft: [[425, 290], [465, 320], [505, 430], [565, 560], [645, 690], [600, 740], [530, 690], [470, 575], [440, 440]] },
      3: { angle: 'back', side: 'back', ppi: 12.3, top: 189, body: { cx: 365, r: 95, yaw: 0 },
        torso: [[262, 190], [320, 162], [370, 156], [420, 162], [478, 190], [465, 330], [470, 520], [262, 520], [265, 330]] },
    },
    // Gildan crewneck sweatshirt (female model; 2-3 three-quarter, not calibrated).
    'pro_14kNy0EJQkqopY-Z9Pm41A': {
      0: { angle: 'front', side: 'front', ppi: 18, top: 315, body: { cx: 358, r: 143, yaw: 0 },
        torso: [[215, 320], [265, 290], [310, 280], [358, 300], [405, 280], [450, 290], [505, 320], [505, 735], [215, 735]],
        logo: { sleeve: { x: 556, y: 480, w: 26, rot: 4 } },
        sleeveLeft: [[505, 320], [545, 330], [580, 420], [596, 560], [592, 700], [548, 830], [515, 830], [505, 700], [500, 420]] },
      1: { angle: 'back', side: 'back', ppi: 18.5, top: 318, body: { cx: 390, r: 185, yaw: 3 },
        torso: [[200, 320], [260, 290], [330, 272], [400, 270], [470, 272], [540, 290], [575, 330], [570, 770], [205, 770]] },
    },
    // Bella+Canvas tank (male model; no sleeves, so no logo spot).
    pro_xPL7YjOBRQWVL50Im8eKAA: {
      0: { angle: 'front', side: 'front', ppi: 19, top: 365, body: { cx: 360, r: 138, yaw: -15 },
        torso: [[224, 420], [230, 360], [250, 300], [285, 280], [300, 330], [318, 358], [345, 345], [385, 300], [440, 252], [470, 275], [490, 410], [500, 520], [490, 640], [470, 750], [230, 750], [222, 560]] },
      1: { angle: 'back', side: 'back', ppi: 15.5, top: 280, body: { cx: 370, r: 125, yaw: 0 },
        torso: [[245, 300], [262, 240], [300, 232], [330, 255], [370, 262], [410, 255], [445, 232], [478, 240], [495, 300], [490, 500], [495, 688], [248, 688], [245, 500]] },
    },
    // Gildan youth tee: flat lays (front, back), so the body is a very wide cylinder.
    pro_ODh_gv0ESl6jIcRfvSww0w: {
      0: { angle: 'flat', side: 'front', ppi: 22.5, top: 258, body: { cx: 360, r: 20000, yaw: 0 },
        torso: [[168, 200], [255, 160], [290, 142], [360, 240], [430, 142], [465, 160], [552, 200], [556, 815], [166, 815]] },
      1: { angle: 'flat', side: 'back', ppi: 22.5, top: 206, body: { cx: 359, r: 20000, yaw: 0 },
        torso: [[163, 190], [300, 142], [420, 142], [555, 190], [556, 820], [163, 820]] },
    },
  };
  const fx = v => v / PHOTO_W;
  const fy = v => v / PHOTO_H;
  // Horizontal photo position (fraction) of a point d inches from the print's centre line.
  function wrapX(cal, d, ppiF) {
    const th = Math.max(-1.5, Math.min(1.5, cal.body.yaw * Math.PI / 180 + (d * ppiF) / cal.body.r));
    return cal.body.cx + cal.body.r * Math.sin(th);
  }
  // The print area's box on a photo (fractions), for an area inW x inH inches.
  function photoRect(cal, inW, inH) {
    const left = wrapX(cal, -inW / 2, cal.ppi);
    const right = wrapX(cal, inW / 2, cal.ppi);
    return { x: left, y: cal.top, w: right - left, h: cal.ppi * inH * (PHOTO_W / PHOTO_H) };
  }
  const PHOTO_AREAS = {};
  for (const [tid, photos] of Object.entries(PHOTO_PX)) {
    PHOTO_AREAS[tid] = {};
    for (const [i, p] of Object.entries(photos)) {
      const cal = {
        angle: p.angle, side: p.side, occluded: p.occluded || '', ppi: fx(p.ppi), top: fy(p.top),
        body: { cx: fx(p.body.cx), r: fx(p.body.r), yaw: p.body.yaw },
        torso: p.torso.map(([x, y]) => [fx(x), fy(y)]),
      };
      if (p.logo) cal.logo = { sleeve: { x: fx(p.logo.sleeve.x), y: fy(p.logo.sleeve.y), w: fx(p.logo.sleeve.w), rot: p.logo.sleeve.rot || 0 } };
      if (p.sleeveLeft) cal.sleeveLeft = p.sleeveLeft.map(([x, y]) => [fx(x), fy(y)]);
      const [inW, inH] = MAIN_INCHES[tid][p.side];
      Object.assign(cal, photoRect(cal, inW, inH), { warp: { yaw: p.body.yaw, cx: cal.body.cx, r: cal.body.r } });
      PHOTO_AREAS[tid][i] = cal;
    }
  }
  // The four corners of the sleeve wordmark (fractions), rotated about its top-left.
  function logoCorners(spot, ratio = PHOTO_H / PHOTO_W) {
    const w = spot.w;
    const h = spot.w * (WORDMARK.h / WORDMARK.w); // in width units
    const a = (spot.rot || 0) * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    return [[0, 0], [w, 0], [w, h], [0, h]].map(([dx, dy]) => [spot.x + dx * c - dy * s, spot.y + (dx * s + dy * c) / ratio]);
  }
  const sideOf = (spec = {}) => (/back/i.test(String(spec.regionId || spec.region || '')) ? 'back' : 'front');
  const templateOf = (templateId, kind) => templateId || TEMPLATE_KIND[kind] || '';
  // The calibration for one photo: by index, else the first calibrated photo with that angle.
  function photoCal(templateId, { photoIndex, angle } = {}) {
    const set = PHOTO_AREAS[templateId];
    if (!set) return null;
    if (photoIndex !== undefined && photoIndex !== null && photoIndex !== '') return set[Number(photoIndex)] || null;
    if (angle) return Object.values(set).find(c => c.angle === angle) || null;
    return set[0] || null;
  }
  const photoUrl = p => (typeof p === 'string' ? p : String(p?.url || ''));
  // Nearest template colour (by hex) with photos, for a garment colour.
  function nearestColor(colors = [], garment = WHITE) {
    const g = hex(garment) || WHITE;
    const rgb = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16));
    const [r, gg, b] = rgb(g);
    const withPhotos = (colors || []).filter(c => hexOk(c?.hex) && Array.isArray(c.photos) && c.photos.some(photoUrl));
    if (!withPhotos.length) return null;
    return withPhotos.map(c => { const [R, G, B] = rgb(c.hex.toUpperCase()); return [c, (r - R) ** 2 + (gg - G) ** 2 + (b - B) ** 2]; }).sort((x, y) => x[1] - y[1])[0][0];
  }
  // Photo 0 of the nearest colour (kept for older callers).
  function photoFor(colors = [], garment = WHITE) {
    const best = nearestColor(colors, garment);
    if (!best) return null;
    const i = best.photos.findIndex(photoUrl);
    const p = best.photos[i];
    // index: pass it on as photoMock's photoIndex (the calibration is per photo index)
    return { url: photoUrl(p), index: Number.isInteger(p?.index) ? p.index : i, color: best };
  }
  // Every photo of the nearest colour: [{ url, angle, index, calibrated, side, primary, color }].
  // primary marks the photo to open on (calibrated, nothing in front of the print).
  // calibrated = the design can be drawn on it for this print side (opts.region:
  // 'front' default, or 'back'); a back photo is never calibrated for a front print.
  // Photos may be strings or { url, angle, index, view?, sampleArt? } (the templates reply;
  // index = Fourthwall's order, which is what the calibrations are keyed by).
  function photosFor(colors = [], garment = WHITE, templateId = '', opts = {}) {
    const best = nearestColor(colors, garment);
    if (!best) return [];
    const side = sideOf({ region: opts.region || opts.regionId || 'front' });
    const set = PHOTO_AREAS[templateId] || {};
    const list = best.photos.map((p, i) => {
      const url = photoUrl(p);
      if (!url) return null;
      const index = Number.isInteger(p?.index) ? p.index : i;
      const cal = set[index];
      const angle = (typeof p === 'object' && p.angle && p.angle !== 'unknown') ? p.angle : (cal?.angle || PHOTO_ANGLES[templateId]?.[index] || 'unknown');
      // Fourthwall's own sample print on the photo: never draw over it.
      const sampleArt = !!(typeof p === 'object' && p.sampleArt);
      const out = { url, angle, index, calibrated: !!cal && cal.side === side && !sampleArt, side: cal?.side || (typeof p === 'object' && p.view) || null, color: best.name, primary: false };
      if (sampleArt) out.sampleArt = true;
      return out;
    }).filter(Boolean);
    const want = side === 'back' ? null : PHOTO_HERO[templateId];
    const hero = list.find(x => x.calibrated && x.index === want) || list.find(x => x.calibrated);
    if (hero) hero.primary = true;
    return list;
  }
  const photoCache = new Map();
  function loadPhoto(src) {
    if (!photoCache.has(src)) {
      photoCache.set(src, new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => { const plain = new Image(); plain.onload = () => resolve(plain); plain.onerror = () => resolve(null); plain.src = src; };
        img.src = src;
      }));
    }
    return photoCache.get(src);
  }
  // Separable box blur of a w x h float map (radius r).
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      let acc = 0; const row = y * w;
      for (let x = -r; x <= r; x++) acc += src[row + Math.max(0, Math.min(w - 1, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / (2 * r + 1);
        acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }
  const polyPath = (g, poly, W, H) => { g.beginPath(); poly.forEach(([x, y], i) => (i ? g.lineTo(x * W, y * H) : g.moveTo(x * W, y * H))); g.closePath(); };
  // Fabric realism: the ink takes the shirt's light and folds. The photo's luminance
  // under the ink, relative to the fabric's lit level, shades the ink (multiply-like
  // on light shirts; on dark shirts softer, with screen-style highlights on the
  // folds' crests) and nudges where the ink is sampled along the fold gradient (a
  // 1-2 px displacement). The fabric's own texture comes through the same map.
  // Returns false when the photo can't be read (no CORS), so the caller draws plainly.
  function inkIntoFabric(g, layer, box, light) {
    let base, ink;
    try {
      base = g.getImageData(box.x, box.y, box.w, box.h);
      ink = layer.getContext('2d').getImageData(box.x, box.y, box.w, box.h);
    } catch { return false; }
    const b = base.data, d = ink.data, w = box.w, h = box.h;
    const L = new Float32Array(w * h);
    const hist = new Uint32Array(256);
    let count = 0;
    for (let i = 0, p = 0; p < L.length; p++, i += 4) {
      const v = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
      L[p] = v;
      if (d[i + 3]) { hist[v | 0]++; count++; }
    }
    if (!count) return true;
    // The fabric's lit level: 70th percentile of the luminance under the ink.
    let acc = 0, ref = 128;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= count * 0.7) { ref = Math.max(8, v); break; } }
    // Smoothed copies: Ls (r 2) shades without JPEG noise; Lg (r 5) gives the fold
    // gradient for the displacement, so heather specks don't scatter the ink.
    const Ls = boxBlur(L, w, h, 2);
    const Lg = boxBlur(Ls, w, h, 4);
    const out = new Uint8ClampedArray(d.length);
    const amp = 0.06;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const gx = (Lg[p + (x < w - 1 ? 1 : 0)] - Lg[p - (x > 0 ? 1 : 0)]);
        const gy = (Lg[p + (y < h - 1 ? w : 0)] - Lg[p - (y > 0 ? w : 0)]);
        const sx = Math.max(0, Math.min(w - 1, Math.round(x - Math.max(-1.5, Math.min(1.5, gx * amp)))));
        const sy = Math.max(0, Math.min(h - 1, Math.round(y - Math.max(-1.5, Math.min(1.5, gy * amp)))));
        const q = (sy * w + sx) * 4;
        const a = d[q + 3];
        const o = p * 4;
        if (!a) { out[o + 3] = 0; continue; }
        // light shirts: mostly the folds plus a little of the knit; dark shirts: folds
        // only (their knit is JPEG noise that would stripe the ink)
        const lum = light ? Ls[p] * 0.75 + L[p] * 0.25 : Ls[p];
        let r = d[q], gg = d[q + 1], bb = d[q + 2];
        if (light) {
          // multiply-style: the folds' shadows darken the ink as they darken the shirt
          const k = Math.max(0.4, Math.min(1.03, lum / ref));
          r *= k; gg *= k; bb *= k;
        } else {
          // dark shirt: ink a touch duller and softer, shadows deepen it, the folds'
          // crests catch light (screen). Differences, not ratios: near-black fabric
          // would turn every JPEG step into a streak.
          const dl = (lum - ref) / 255;
          const k = 0.96 * (dl < 0 ? Math.max(0.55, 1 + dl * 2.2) : 1);
          const hi = dl > 0 ? Math.min(0.25, dl * 1.2) : 0;
          r *= k; gg *= k; bb *= k;
          r += (255 - r) * hi; gg += (255 - gg) * hi; bb += (255 - bb) * hi;
        }
        out[o] = r; out[o + 1] = gg; out[o + 2] = bb;
        out[o + 3] = a * (light ? 0.93 : 0.95); // a trace of the fabric shows through
      }
    }
    // composite the shaded ink over the photo
    for (let i = 0; i < b.length; i += 4) {
      const a = out[i + 3] / 255;
      if (!a) continue;
      b[i] = b[i] * (1 - a) + out[i] * a;
      b[i + 1] = b[i + 1] * (1 - a) + out[i + 1] * a;
      b[i + 2] = b[i + 2] * (1 - a) + out[i + 2] * a;
    }
    g.putImageData(base, box.x, box.y);
    return true;
  }
  // opts: { photo: url, kind, garmentColor, spec, logoSpot: 'sleeve'|'neck'|'none',
  //         templateId, photoIndex, angle, sampleArt, realism (default true), plain }.
  // Resolves { width, height, scene, logoNote, photoIndex, angle, side, drawn: true }
  // or null when the photo has no calibration for this print side (or no photo):
  // the design is never drawn on an uncalibrated photo. With plain: true an
  // uncalibrated photo is drawn as is and { drawn: false, caption } comes back.
  async function photoMock(concept, canvas, opts = {}) {
    const kind = MerchRules.BLANKS[opts.kind] ? opts.kind : 'tee';
    if (!opts.photo) return null;
    const templateId = templateOf(opts.templateId, kind);
    const garment = hex(opts.garmentColor) || WHITE;
    const spec = { ...(DEFAULT_AREAS[kind]), ...(opts.spec || {}), garmentColor: garment, kind };
    const side = sideOf(opts.spec || {});
    let cal = photoCal(templateId, opts);
    if (cal && cal.side !== side) cal = null;
    if (opts.sampleArt) cal = null; // Fourthwall's own sample print is on that photo
    if (!cal && !opts.plain) return null;
    await loadFonts();
    const img = await loadPhoto(opts.photo);
    if (!img) return null;
    const W = canvas.width || 600;
    const H = Math.round(W * (img.naturalHeight || PHOTO_H) / (img.naturalWidth || PHOTO_W));
    canvas.height = H;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.drawImage(img, 0, 0, W, H);
    if (!cal) return { width: W, height: H, scene: null, logoNote: '', drawn: false, caption: 'Design shown in Fourthwall’s mockups', side };
    const scene = layout(concept, spec);
    // The print, flat, at its real size on this photo (ppi), then wrapped round the body.
    const ppiPx = cal.ppi * W;
    const k = ppiPx / scene.dpi;
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(scene.w * k));
    off.height = Math.max(1, Math.round(scene.h * k));
    const og = off.getContext('2d');
    og.scale(k, k);
    await drawScene(scene, og);
    const layer = document.createElement('canvas');
    layer.width = W;
    layer.height = H;
    const lg = layer.getContext('2d');
    const light = isLight(garment);
    const realism = opts.realism !== false;
    if (realism && 'filter' in lg) lg.filter = `blur(${light ? 0.3 : 0.4}px)`; // ink soaks in a little
    lg.save();
    polyPath(lg, cal.torso, W, H);
    lg.clip();
    const top = cal.top * H;
    const strips = 48;
    const sw = off.width / strips;
    for (let i = 0; i < strips; i++) {
      const d0 = (i / strips - 0.5) * scene.inW;
      const d1 = ((i + 1) / strips - 0.5) * scene.inW;
      const x0 = wrapX(cal, d0, cal.ppi) * W;
      const x1 = wrapX(cal, d1, cal.ppi) * W;
      if (x1 - x0 < 0.05) continue;
      lg.drawImage(off, i * sw, 0, sw, off.height, x0, top, x1 - x0 + 0.6, off.height);
    }
    lg.restore();
    // Only spots measured on this photo are drawn (the front photo can't show a
    // back-neck or inside label); the rest are named in the caption instead.
    const spot = cal.logo?.[opts.logoSpot];
    const logoNote = opts.logoSpot && opts.logoSpot !== 'none' && opts.logoSpot !== 'inline' && !spot ? opts.logoSpot : '';
    if (spot) {
      const logo = await loadImage(BASE + (contrast(garment, ES_BLUE) < 1.6 ? WORDMARK.white : WORDMARK.blue));
      if (logo) {
        const lw = spot.w * W;
        lg.save();
        lg.translate(spot.x * W, spot.y * H);
        lg.rotate((spot.rot || 0) * Math.PI / 180);
        lg.drawImage(logo, 0, 0, lw, lw * WORDMARK.h / WORDMARK.w);
        lg.restore();
      }
    }
    lg.filter = 'none';
    // Where ink can be: the torso box plus the logo spot.
    const pr = photoRect(cal, scene.inW, scene.inH);
    const tx = cal.torso.map(p => p[0]);
    const ty = cal.torso.map(p => p[1]);
    const ax0 = Math.max(pr.x, Math.min(...tx)) * W, ax1 = Math.min(pr.x + pr.w, Math.max(...tx)) * W;
    const ay0 = Math.max(pr.y, Math.min(...ty)) * H, ay1 = Math.min(pr.y + pr.h, Math.max(...ty)) * H;
    const lc = spot ? logoCorners(spot, PHOTO_H / PHOTO_W) : [];
    const xs = [ax0, ax1].concat(lc.map(p => p[0] * W));
    const ys = [ay0, ay1].concat(lc.map(p => p[1] * H));
    const box = { x: Math.max(0, Math.floor(Math.min(...xs)) - 2), y: Math.max(0, Math.floor(Math.min(...ys)) - 2) };
    box.w = Math.min(W, Math.ceil(Math.max(...xs)) + 2) - box.x;
    box.h = Math.min(H, Math.ceil(Math.max(...ys)) + 2) - box.y;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const shaded = realism && box.w > 0 && box.h > 0 && inkIntoFabric(g, layer, box, light);
    if (!shaded) {
      // Plain (photo not readable): multiply only on near-white shirts (keeps the
      // folds; white ink would vanish into any coloured shirt), straight otherwise.
      g.save();
      g.globalCompositeOperation = contrast(garment, WHITE) < 1.1 ? 'multiply' : 'source-over';
      g.globalAlpha = 0.96;
      g.drawImage(layer, 0, 0);
      g.restore();
    }
    const ms = typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : 0;
    const index = Number(Object.keys(PHOTO_AREAS[templateId]).find(i => PHOTO_AREAS[templateId][i] === cal));
    return { width: W, height: H, scene, logoNote, photoIndex: index, angle: cal.angle, side, drawn: true, realism: !!shaded, shadeMs: ms };
  }
  const pointInPoly = (x, y, poly) => { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i]; const [xj, yj] = poly[j]; if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; } return inside; };

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
  // The person's own line, whole, as pills ("Your words"). The main line is
  // the first sentence (or the whole text when it's short); never cut short.
  // Returns null when there's no usable line (too long for a chest print).
  function mainLine(text) {
    const t = String(text || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (t.length <= 90) return t.replace(/[.!?]+$/, '');
    const first = t.split(/(?<=[.!?])\s+/)[0].replace(/[.!?]+$/, '');
    return first.length <= 120 ? first : '';
  }
  function yourWords(content, opts = {}) {
    const c = typeof content === 'string' ? { text: content } : (content || {});
    const line = mainLine(c.text).replace(/["“”]/g, '');
    if (!line || line.split(' ').length < 2 || MerchRules.bannedIn(line).length) return null;
    const idx = indexNow();
    const hit = c.team ? { name: String(c.team.name || c.team) } : MerchRules.teamsIn(line, idx)[0] || MerchRules.teamsIn(String(c.text || ''), idx)[0];
    const team = hit ? { id: hashOf(hit.name), name: hit.name } : null;
    const pal = teamPalette(team?.name);
    // One word per pill for short lines, two for longer ones: fewer letters per
    // row print much bigger (owner: the type read too small).
    let rows = splitWords(line, 'word');
    if (rows.length > 6) rows = splitWords(line, 'pair');
    if (rows.length > 8) rows = splitWords(line, 'line');
    if (rows.length > 9) return null;
    const inkA = contrast(pal.a, WHITE) >= 3 ? 'white' : 'ink';
    return concept({ collection: 'current', label: 'Your words', title: line.length <= 48 ? line : `${line.slice(0, 45).replace(/\s+\S*$/, '')}…`, team, palette: pal, garment: { color: WHITE, name: 'White' }, align: opts.align || 'left',
      stack: rows.map((t, i) => ({ text: t, size: 'big', fill: i % 2 ? 'b' : 'a', ink: i % 2 ? 'ink' : inkA })),
      rights: [...(team ? [{ kind: 'team', text: team.name }] : []), ...MerchRules.peopleIn(line, idx).map(p => ({ kind: 'name', text: p }))],
      why: 'Your line, word for word, split across pills.' });
  }
  // True when a concept already carries the whole line (any row split).
  function hasLine(concept, text) {
    const line = up(mainLine(text).replace(/["“”]/g, '')).replace(/[^A-Z0-9 ]/g, '');
    if (!line) return true;
    const all = up((concept.stack || []).map(r => r.text).join(' ')).replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ');
    return all.includes(line);
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
    const mine = yourWords(c);
    if (mine) out.push(mine);
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

  // ─── Variations (no AI) ────────────────────────────────────────────────
  // The same words in different ES pill layouts: stacked words, centre
  // stagger, big + small, wide banner, on the team colour, compact, bold.
  // Small rows (like "— Name") stay small at the end. Rights carry over.
  const VARIANTS = [
    { key: 'stack', title: 'Stacked words', why: 'One word per pill, alternating the two colours.' },
    { key: 'stagger', title: 'Centre stagger', why: 'Two words per pill, centred, so the edges step in and out.' },
    { key: 'headline', title: 'Big + small', why: 'The first words big, the rest in small pills under them.' },
    { key: 'banner', title: 'Wide banner', why: 'Long pills in one colour, like a headline across the chest.' },
    { key: 'inverse', title: 'On the team colour', why: 'Team-colour tee with light pills; the shirt shows through the letters.' },
    { key: 'compact', title: 'Compact chest', why: 'Small and left-aligned, like a pocket print.' },
    { key: 'bold', title: 'Bold and big', why: 'Bigger pills, one word each, centred.' },
  ];
  function variations(base = {}, opts = {}) {
    const pal = { ...teamPalette(base.team?.name), ...Object.fromEntries(Object.entries(base.palette || {}).filter(([, v]) => hexOk(v)).map(([k, v]) => [k, v.toUpperCase()])) };
    const stack = (Array.isArray(base.stack) ? base.stack : []).filter(r => r && up(r.text));
    const smalls = stack.filter((r, i) => r.size === 'small' && i > 0);
    const words = stack.filter(r => !smalls.includes(r)).map(r => up(r.text)).join(' ');
    if (!words) return [];
    const inkOn = key => (contrast(resolve(key, pal), WHITE) >= 3 ? 'white' : 'ink');
    const alt = (texts, keys = ['a', 'b']) => texts.map((t, i) => { const fill = keys[i % keys.length]; return { text: t, size: 'big', fill, ink: fill === 'b' ? 'ink' : inkOn(fill) }; });
    const tail = (fill = 'b') => smalls.map(r => ({ ...r, size: 'small', fill, ink: fill === 'b' ? 'ink' : inkOn(fill) }));
    const cap = (rows, max = 9) => (rows.length > max ? null : rows);
    const per = mode => { const r = splitWords(words, mode); return r.length > 8 ? splitWords(words, mode === 'word' ? 'pair' : 'line') : r; };
    const white = { color: WHITE, name: 'White' };
    const teamTee = { color: pal.a, name: colorName(pal.a) };
    const make = (v, rows, extra = {}) => (rows ? { ...base, id: `${String(base.id || 'c').replace(/-v-[a-z]+$/, '')}-v-${v.key}`, variantOf: base.variantOf || base.id, variant: v.key, label: v.title, title: base.title || words.slice(0, 40), why: v.why, stack: rows, fit: { scale: 1, topIn: null }, ...extra } : null);
    const out = [];
    for (const v of VARIANTS) {
      let c = null;
      if (v.key === 'stack') c = make(v, cap([...alt(per('word')), ...tail()]), { align: 'left', garment: white });
      else if (v.key === 'stagger') c = make(v, cap([...alt(per('pair')), ...tail()]), { align: 'center', garment: white });
      else if (v.key === 'headline') {
        const rows = splitWords(words, 'auto');
        const first = rows.length > 1 ? [rows[0]] : splitWords(words, 'word').slice(0, 1);
        const rest = rows.length > 1 ? rows.slice(1) : splitWords(words, 'word').slice(1);
        c = rest.length ? make(v, cap([{ text: first[0], size: 'big', fill: 'a', ink: inkOn('a') }, ...rest.map((t, i) => ({ text: t, size: 'mid', fill: i % 2 ? 'a' : 'b', ink: i % 2 ? inkOn('a') : 'ink' })), ...tail()]), { align: 'left', garment: white }) : null;
      } else if (v.key === 'banner') c = make(v, cap([...splitWords(words, 'line').map(t => ({ text: t, size: 'big', fill: 'a', ink: inkOn('a') })), ...tail()]), { align: 'center', garment: white });
      else if (v.key === 'inverse') { const f = boldFill(pal); c = contrast(pal.a, WHITE) < 1.3 ? null : make(v, cap([...per('word').map((t, i) => ({ text: t, size: 'big', fill: i % 2 && f !== 'white' ? f : 'white', ink: 'a' })), ...tail(f === 'white' ? 'b' : f)]), { align: 'left', garment: teamTee }); }
      else if (v.key === 'compact') c = make(v, cap([...alt(per('pair')), ...tail()]), { align: 'left', garment: white, fit: { scale: 0.7, topIn: null } });
      else if (v.key === 'bold') c = make(v, cap([...alt(per('word')), ...tail()]), { align: 'center', garment: white, fit: { scale: 1.35, topIn: null } });
      if (c && JSON.stringify(c.stack) !== JSON.stringify(stack.map(r => ({ ...r, text: up(r.text) })))) out.push(c);
    }
    return out.slice(0, opts.max || VARIANTS.length);
  }

  return {
    VERSION: '2026-11-26-merch5', FIT, VARIANTS, fitOf, splitWords, variations, yourWords, hasLine, mainLine, ICONS, ICON_SHAPES, ELEMENT_TYPES, elementsOf, WORDMARK, PHONE_MAX_PIXELS, SMALL, MID, WRAP_AT, MIN_CAP_IN, MIN_CONTRAST, CAP, DEFAULT_AREAS, SAFE_IN, MUG_FACE,
    render, renderLogo, checks, preview, closeup, photoMock, photoFor, photosFor, photoRect, photoCal, logoCorners, PHOTO_AREAS, PHOTO_PX, PHOTO_HERO, TEMPLATE_KIND, pointInPoly, fallbackConcepts, layout, logoLayout, logoChecks, LOGO_SPOTS,
    kitSports, kitTeams, kitSwatches, paletteFromKit, pillInk, ES_SWATCHES, boxContrast, resolve,
    teamPalette, colorName, areaOf, canvasPlan, approxMeasure, pillGeom, wrapText, rowsOf, rowColors, stackRows, checksFor, blocking,
    loadFonts, solidify, fontOf, findQuote, findNickname, findNumber,
  };
}));
