// Reels Studio styles: the visual systems a reel can be drawn in, as data.
// One file for the browser (window.ReelStyles), the server and the tests
// (require), like reel-formats.js. The renderer (reel-render.js) reads the
// palette, type scale, layouts, caption treatment and motion from here; the
// director (_reel-director.js) reads which beat components a style supports
// and how long its reels may run; the lint reads the length limits.
//
//   STYLES[id]          the style (see the shape below)
//   STYLE_IDS           picker order
//   COMPONENT_KINDS     the data beats (bars, versus, dotrank, chips, steps,
//                       tiles, roles, mystery) on top of the story beats
//   suggestStyle({ format, text })  -> { id, why }   (code only, free)
//   validateStyle(style) -> [] of problems (tests keep the data honest)
//   ELEMENTS / elementTokens / elementBox / drawPlaceholder
//                       the data-format overlay pieces (scorebug, wpline,
//                       clock, playcard, panel3, timeline-node, source-chip,
//                       attribution) and their per-style tokens
//
// 2026-11-21: 'es' (the ES video team's reels system, reel-es.js) is the
// house style and the default for news reels. Every style shares its brand
// layer: ES blue #0A7DFA, ink #121212, the signal colours green #1BC47D,
// red #E8322B, yellow #FFC52F, paper #F1EFEA on the light looks; the ES mark
// and logotype rules are in reel-render.js.
//
// Studied from two published ES reels (a light "data explainer" and the
// "ES Moneyball" analytics series) and rebuilt on one 8-pt grid inside the
// Reels safe zone (x 65-1015, y 270-1580). Fonts: Acumin Pro Condensed,
// Roboto and Roboto Condensed only. Team colours are content, never chrome.
//
// Reels 2.0 (2026-11-25): 'es' is the only style offered (STYLE_IDS). What a
// person picks now is an ES LOOK (reel-es-themes.js). The four older styles
// (classic, explainer, series, countdown) are retired: LEGACY_STYLE_IDS keeps
// their data and reel-render.js keeps their draw code for one release as a
// safety net, saved reels in them open in the closest look, and nothing
// offers them. The data formats (Game Swing, Replay, Archive) default to 'es';
// withLook() / elementTokens(style, element, look) re-skin their overlays.
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./reel-es-themes.js') : root.ReelESThemes);
  if (node) module.exports = api;
  else root.ReelStyles = api;
}(typeof self !== 'undefined' ? self : this, TH => {
  'use strict';

  const CONDENSED = '"Acumin Pro Condensed Local", "Roboto Condensed", sans-serif';
  const LABEL = '"Roboto Condensed", Roboto, sans-serif';
  const BODY = 'Roboto, sans-serif';
  const FONTS = [CONDENSED, LABEL, BODY];

  const STORY_KINDS = ['hook', 'context', 'point', 'stat', 'rank', 'quote', 'payoff', 'cta'];
  // Data beats. Every number in them must come from the sources (lint rule
  // "numbers" walks every field; F.numberFields lists them).
  //   bars     comparison bars           bars: [{ label, value, note }] (2-4)
  //   versus   cards with headshots      versus: [{ name, value, note, photo }] (2-3, name "?" = mystery card)
  //   dotrank  a dot "galaxy" ranking    dotrank: { total, rank, label, note }
  //   chips    "1 in 5" squares          chips: { filled, total, label }
  //   steps    a step tracker            steps: { current, total, label } (structural numbers)
  //   tiles    team tiles                tiles: [{ team, label, chip }] (2-4)
  //   roles    position / role cards     roles: [{ role, value, note, tone: good|bad }] (2-4)
  //   mystery  a "?" placeholder card    text + detail
  const COMPONENT_KINDS = ['bars', 'versus', 'dotrank', 'chips', 'steps', 'tiles', 'roles', 'mystery'];
  const ALL_KINDS = [...STORY_KINDS, ...COMPONENT_KINDS];

  // Layout names the renderer knows. Every style maps every kind to one.
  // Data-format layouts (Phase 1): one per data beat kind, the same name in
  // every style (reel-render.js draws them with each style's element tokens).
  const DATA_LAYOUTS = ['play', 'wpline', 'moment', 'panel3'];
  const ES_LAYOUTS = ['es-hook', 'es-statement', 'es-number', 'es-dots', 'es-compare', 'es-quote', 'es-endcard'];
  const LAYOUTS = [...ES_LAYOUTS, 'legacy', 'headline-visual', 'stat-hero', 'rank-card', 'quote', 'bars', 'versus', 'dotrank', 'chips', 'steps', 'tiles', 'roles', 'mystery', 'endcard', ...DATA_LAYOUTS];
  const STANDARD_LAYOUTS = {
    hook: 'headline-visual', context: 'headline-visual', point: 'headline-visual', payoff: 'headline-visual',
    stat: 'stat-hero', rank: 'rank-card', quote: 'quote', cta: 'endcard',
    bars: 'bars', versus: 'versus', dotrank: 'dotrank', chips: 'chips', steps: 'steps', tiles: 'tiles', roles: 'roles', mystery: 'mystery',
  };

  // 8-pt grid inside the safe zone. Light styles use one column x 88-992.
  const GRID = { unit: 8, left: 88, right: 992, top: 288, captionTop: 1336, captionBottom: 1512, bottom: 1560 };

  // The ES brand layer (reel-es.js TOKENS) every style draws with.
  const BRAND = { blue: '#0A7DFA', ink: '#121212', paper: '#F1EFEA', green: '#1BC47D', red: '#E8322B', yellow: '#FFC52F' };
  // Each Reels Studio beat kind on its ES block (reel-es.js BLOCK_FOR_KIND).
  const ES_KIND_LAYOUTS = { hook: 'es-hook', context: 'es-statement', point: 'es-statement', payoff: 'es-statement', rank: 'es-statement', steps: 'es-statement', tiles: 'es-statement', mystery: 'es-statement', stat: 'es-number', dotrank: 'es-dots', chips: 'es-dots', bars: 'es-compare', versus: 'es-compare', roles: 'es-compare', quote: 'es-quote', cta: 'es-endcard' };

  const STYLES = {
    es: {
      id: 'es',
      label: 'ES Reels',
      blurb: 'The ES video team\'s system: paper, boxed pills, counting numbers, dots and bars, slab wipes and one-line captions.',
      theme: 'light',
      engine: 'es', // reel-es.js draws it
      palette: { bg: BRAND.paper, paper: BRAND.paper, panel: '#FFFFFF', ink: BRAND.ink, muted: '#5C5A55', line: '#CFCBC2', accent: BRAND.blue, hi: BRAND.yellow, hiInk: BRAND.ink, good: BRAND.green, bad: BRAND.red, chip: BRAND.ink, chipInk: '#FFFFFF', mystery: '#DEDAD1', rule: BRAND.blue, texture: 'none' },
      type: { display: CONDENSED, label: LABEL, body: BODY, headline: [150, 88], stat: [300, 150], cardValue: [104, 64], labelSize: 34, eyebrow: 28, bodySize: 34, caption: [84, 48] },
      caption: { mode: 'es' }, // one line at y 1172, 1-3 words, *emphasis* yellow
      motion: { enter: 'rise', durMs: 400, stagger: 160, transition: 'slab', transitionMs: 500 },
      chrome: { bug: false, eyebrow: false, badge: 'top-right', seriesTag: false, strip: false, rail: false },
      emphasis: 'highlight',
      visual: 'fullbleed', cutout: false,
      layouts: { ...STANDARD_LAYOUTS, ...ES_KIND_LAYOUTS },
      components: ['bars', 'dotrank', 'chips'],
      seconds: { target: [20, 60], max: 90 },
      beats: { max: 16 },
      voWords: [40, 160],
    },
    classic: {
      id: 'classic',
      label: 'ES Classic',
      blurb: 'Dark, full-bleed ES photos with slow push-ins and bold captions.',
      theme: 'dark',
      engine: 'classic', // the original Reels Studio look (story beats keep their legacy layouts)
      palette: { bg: BRAND.ink, paper: BRAND.ink, panel: '#1E1E1E', ink: '#FFFFFF', muted: 'rgba(255,255,255,0.72)', line: 'rgba(255,255,255,0.22)', accent: BRAND.blue, hi: BRAND.yellow, hiInk: BRAND.ink, good: BRAND.green, bad: BRAND.red, chip: BRAND.yellow, chipInk: BRAND.ink, mystery: '#2A2A2A' },
      type: { display: CONDENSED, label: LABEL, body: BODY, headline: [116, 78], stat: [360, 160], cardValue: [120, 72], labelSize: 34, eyebrow: 30, bodySize: 44, caption: [96, 64] },
      caption: { mode: 'user' }, // Highlight or Box, the editor picks
      motion: { enter: 'rise', durMs: 380, stagger: 45, transition: 'crossfade', transitionMs: 220 },
      chrome: { bug: 'top-left', eyebrow: false, badge: false, seriesTag: false, strip: false, rail: false },
      visual: 'fullbleed', cutout: false,
      layouts: { ...STANDARD_LAYOUTS, hook: 'legacy', context: 'legacy', point: 'legacy', payoff: 'legacy', stat: 'legacy', rank: 'legacy', quote: 'legacy', cta: 'legacy' },
      components: ['bars', 'versus', 'mystery'],
      seconds: { target: [20, 45], max: 90 },
      beats: { max: 12 },
      voWords: [55, 110],
    },
    explainer: {
      id: 'explainer',
      label: 'ES Data Explainer',
      blurb: 'Light paper, a cut-out player over a framed photo, a stat hero, dot rankings and comparison cards.',
      theme: 'light',
      engine: 'styled',
      palette: { bg: BRAND.paper, paper: BRAND.paper, panel: '#FFFFFF', ink: BRAND.ink, muted: '#5C5A55', line: '#CFCBC2', accent: BRAND.blue, hi: BRAND.yellow, hiInk: BRAND.ink, good: BRAND.green, bad: BRAND.red, chip: BRAND.ink, chipInk: '#FFFFFF', mystery: '#DEDAD1', rule: BRAND.blue, texture: 'dots' },
      type: { display: CONDENSED, label: LABEL, body: BODY, headline: [104, 72], stat: [320, 160], cardValue: [96, 64], labelSize: 32, eyebrow: 28, bodySize: 32, caption: [68, 52] },
      caption: { mode: 'block', box: '#111214', ink: '#FFFFFF', active: '#FFD23F' },
      motion: { enter: 'rise', durMs: 420, stagger: 40, transition: 'slide', transitionMs: 420 }, // a push: out-going beat leaves left, the next arrives composed
      chrome: { bug: false, eyebrow: true, badge: 'top-right', seriesTag: false, strip: false, rail: false },
      emphasis: 'highlight', // one word on a yellow highlight
      visual: 'inset', cutout: true,
      layouts: { ...STANDARD_LAYOUTS },
      components: ['bars', 'versus', 'dotrank', 'chips', 'steps', 'mystery'],
      seconds: { target: [45, 110], max: 120 },
      beats: { max: 24 },
      voWords: [90, 300],
    },
    series: {
      id: 'series',
      label: 'ES Analytics Series',
      blurb: 'A dashboard: series tag, a data strip on every scene, step tracker, team tiles and position cards.',
      theme: 'light',
      engine: 'styled',
      palette: { bg: BRAND.paper, paper: BRAND.paper, panel: '#FFFFFF', ink: BRAND.ink, muted: '#5C5A55', line: BRAND.ink, accent: BRAND.blue, hi: BRAND.yellow, hiInk: BRAND.ink, good: BRAND.green, bad: BRAND.red, chip: BRAND.yellow, chipInk: BRAND.ink, mystery: '#DEDAD1', rule: BRAND.ink, texture: 'grid' },
      type: { display: CONDENSED, label: LABEL, body: BODY, headline: [96, 68], stat: [300, 150], cardValue: [112, 68], labelSize: 30, eyebrow: 26, bodySize: 30, caption: [64, 50] },
      caption: { mode: 'block', box: '#111214', ink: '#FFFFFF', active: '#FFD23F' },
      motion: { enter: 'wipe', durMs: 420, stagger: 60, transition: 'wipe', transitionMs: 380 }, // a left-to-right wipe behind an ink bar
      chrome: { bug: false, eyebrow: false, badge: 'top-right', seriesTag: true, strip: true, rail: false },
      emphasis: 'color', // the emphasis word (or the second line) turns red
      visual: 'inset', cutout: true,
      layouts: { ...STANDARD_LAYOUTS },
      components: ['bars', 'versus', 'chips', 'steps', 'tiles', 'roles', 'mystery'],
      seconds: { target: [45, 120], max: 120 },
      beats: { max: 24 },
      voWords: [90, 300],
    },
    countdown: {
      id: 'countdown',
      label: 'ES Countdown',
      blurb: 'Ranked photo cards that flip in, a 5-to-1 rail and yellow rank numerals on ES ink.',
      theme: 'dark',
      engine: 'styled',
      palette: { bg: BRAND.ink, paper: BRAND.ink, panel: '#1E1E1E', ink: '#FFFFFF', muted: 'rgba(255,255,255,0.74)', line: 'rgba(255,255,255,0.2)', accent: BRAND.blue, hi: BRAND.yellow, hiInk: BRAND.ink, good: BRAND.green, bad: BRAND.red, chip: BRAND.yellow, chipInk: BRAND.ink, mystery: '#2A2A2A', rule: BRAND.yellow, texture: 'lines' },
      type: { display: CONDENSED, label: LABEL, body: BODY, headline: [104, 72], stat: [300, 150], cardValue: [104, 68], labelSize: 32, eyebrow: 28, bodySize: 34, caption: [88, 62] },
      caption: { mode: 'highlight' },
      motion: { enter: 'flip', durMs: 460, stagger: 50, transition: 'flip', transitionMs: 380 }, // the last card lifts away, the next flips in
      chrome: { bug: false, eyebrow: false, badge: 'top-right', seriesTag: false, strip: false, rail: true },
      emphasis: 'highlight',
      visual: 'card', cutout: false,
      layouts: { ...STANDARD_LAYOUTS },
      components: ['versus', 'bars', 'tiles', 'mystery'],
      seconds: { target: [25, 55], max: 90 },
      beats: { max: 12 },
      voWords: [55, 130],
    },
  };
  // The picker offers ES only; the look (reel-es-themes.js) is the choice.
  const STYLE_IDS = ['es'];
  // Retired 2026-11-25. Kept for one release so an old timeline still draws.
  const LEGACY_STYLE_IDS = ['classic', 'explainer', 'series', 'countdown'];
  const isLegacy = id => LEGACY_STYLE_IDS.includes(id);
  // The style a plan is built in now: 'es' for anything retired or unknown.
  const currentStyle = id => (STYLE_IDS.includes(id) ? id : 'es');
  // The house style for news reels (ES video team, 2026-11-21).
  const DEFAULT_STYLE = 'es';
  const get = id => STYLES[id] || STYLES.classic;

  // ─── Elements for the data formats (Phase 0 contract) ─────────────────────
  // project-docs/reels-formats-contract.md §4. The overlay and card pieces the
  // Game Swing, Moment Replay and Archive formats draw. Each element names the
  // style tokens it reads (palette keys and type roles), so every style can
  // draw it without new colours; a style may override a token per element in
  // ELEMENT_TOKENS below. Real drawing is Agent B's (reel-render.js); until
  // then drawPlaceholder() draws a clear labelled box so nothing crashes.
  //   box    default box on the 1080x1920 reel canvas (inside the safe zone)
  //   box45  default box on the 1080x1350 slide canvas (60 px margins)
  //   kinds  the beat kinds (reel-formats.js DATA_KINDS) that use it
  const ELEMENTS = {
    scorebug: { id: 'scorebug', label: 'Scorebug', kinds: ['play', 'wpline'], zone: 'top', box: { x: 88, y: 288, w: 720, h: 104 }, box45: { x: 60, y: 60, w: 700, h: 96 }, tokens: { fill: 'panel', ink: 'ink', muted: 'muted', line: 'line', accent: 'accent', font: 'display', labelFont: 'label' }, notes: 'Team abbreviations (team colours are content), scores, period, clock, possession dot, down and distance. Stays clear of the ES mark and its 50 px clear space (the mark is x 870-992, y 288-392).' },
    wpline: { id: 'wpline', label: 'Win-probability line', kinds: ['wpline', 'play'], zone: 'band', box: { x: 88, y: 472, w: 904, h: 144 }, box45: { x: 60, y: 228, w: 960, h: 140 }, full: { x: 88, y: 640, w: 904, h: 600 }, full45: { x: 60, y: 420, w: 960, h: 640 }, tokens: { line: 'ink', guide: 'line', ink: 'ink', muted: 'muted', fill: 'paper', good: 'good', bad: 'bad', labelFont: 'label' }, notes: 'Draws on with beat progress; 0/50/100% guides; the line in ink, team colours either side of 50%; the swing in a highlighter stroke with a marker and its callout ("SF 63%"); the attribution element is required next to it.' },
    clock: { id: 'clock', label: 'Game clock', kinds: ['play', 'wpline'], zone: 'top', box: { x: 588, y: 400, w: 220, h: 48 }, box45: { x: 560, y: 164, w: 200, h: 44 }, tokens: { fill: 'chip', ink: 'chipInk', font: 'display' }, notes: 'Period + clock ("Q4  0:23", "BOT 9") as the digest has them, in a tab under the bug with a live dot. The clock never ticks: a ticking clock would show times that are not in the data.' },
    playcard: { id: 'playcard', label: 'Play caption card', kinds: ['play'], zone: 'lower', box: { x: 88, y: 1172, w: 904, h: 200 }, box45: { x: 60, y: 1080, w: 960, h: 190 }, tokens: { fill: 'panel', ink: 'ink', muted: 'muted', accent: 'accent', hi: 'hi', hiInk: 'hiInk', font: 'display', bodyFont: 'body' }, notes: 'Down and distance chip + the play line (<= 9 words), score change pulses.' },
    panel3: { id: 'panel3', label: '3-frame strip', kinds: ['panel3'], zone: 'full', box: { x: 88, y: 456, w: 904, h: 1104 }, box45: { x: 60, y: 214, w: 960, h: 1076 }, tokens: { gutter: 'line', ink: 'ink', chip: 'chip', chipInk: 'chipInk', fill: 'paper', font: 'display', labelFont: 'label' }, notes: 'Setup / The play / Reaction panels, 8 px gutters, label chip top-left, caption bottom-left (<= 6 words).' },
    'timeline-node': { id: 'timeline-node', label: 'Year rail node', kinds: ['moment'], zone: 'rail', box: { x: 88, y: 288, w: 160, h: 1272 }, box45: { x: 60, y: 60, w: 140, h: 1230 }, tokens: { line: 'rule', node: 'accent', ink: 'ink', muted: 'muted', hi: 'hi', font: 'display', labelFont: 'label' }, notes: 'The year rail of an archive reel; the current moment is the lit node.' },
    'source-chip': { id: 'source-chip', label: 'Source chip', kinds: ['moment', 'play', 'wpline', 'panel3'], zone: 'chip', box: { x: 88, y: 1448, w: 600, h: 48 }, box45: { x: 60, y: 1194, w: 600, h: 44 }, tokens: { fill: 'panel', ink: 'muted', line: 'line', labelFont: 'label' }, notes: 'Short source line ("ES · Feb 2017", photo credit). Text only, no links drawn.' },
    attribution: { id: 'attribution', label: 'Data attribution', kinds: ['wpline', 'play'], zone: 'chip', box: { x: 88, y: 1512, w: 760, h: 40 }, box45: { x: 60, y: 1246, w: 760, h: 36 }, tokens: { ink: 'muted', labelFont: 'label' }, notes: 'Exactly the format attribution ("Win probability: ESPN Analytics"). Required whenever a WP line or WP number is on screen.' },
  };
  const ELEMENT_IDS = Object.keys(ELEMENTS);
  // Per-style token overrides (palette key or literal colour), per element.
  // Absent = the element's default token map above.
  const ELEMENT_TOKENS = {
    classic: { scorebug: { fill: 'bg' }, panel3: { gutter: 'ink' }, 'timeline-node': { line: 'line' } },
    es: {},
    explainer: {},
    series: { scorebug: { fill: 'ink', ink: 'paper', muted: 'hi' }, clock: { fill: 'hi', ink: 'hiInk' } },
    countdown: { 'timeline-node': { node: 'hi' }, clock: { fill: 'hi', ink: 'hiInk' } },
  };
  // ─── Looks on the data formats ───────────────────────────────────────────
  // The ES style's palette for a look: the ground the look puts its figures
  // on (paper, white, ink or a dark team colour), with the chip in the look's
  // pill colour and the rule in its accent. Paper returns the style as is.
  const lookArgs = look => (look && typeof look === 'object' ? { id: look.look || look.id, team: look.team || '' } : { id: look, team: '' });
  const lookCache = new Map();
  function withLook(styleOrId, look, team = '') {
    const style = typeof styleOrId === 'object' && styleOrId ? styleOrId : get(styleOrId);
    const a = lookArgs(look);
    const teamHex = a.team || team || '';
    if (!TH || style.engine !== 'es' || !a.id || TH.lookId(a.id) === 'paper') return style;
    const key = `${style.id}|${TH.lookId(a.id)}|${teamHex}`;
    if (lookCache.has(key)) return lookCache.get(key);
    const theme = TH.resolve(a.id, { team: teamHex });
    const D = theme.surfaceFor('number');
    const ground = theme.hex(D.ground);
    const dark = TH.luminance(ground) < 0.18;
    const chip = D.fill.ink || 'ink';
    const base = style.palette;
    const palette = dark
      ? { ...base, bg: ground, paper: ground, panel: '#1E1E1E', ink: '#FFFFFF', muted: 'rgba(255,255,255,0.72)', line: 'rgba(255,255,255,0.22)', mystery: '#2A2A2A' }
      : { ...base, bg: ground, paper: ground, panel: ground.toUpperCase() === '#FFFFFF' ? BRAND.paper : '#FFFFFF' };
    palette.chip = theme.hex(chip);
    palette.chipInk = theme.hex(theme.inkOn(chip));
    palette.rule = theme.team && theme.id === 'team' && TH.contrast(theme.team, ground) >= 1.6 ? theme.team : BRAND.blue;
    const out = { ...style, theme: dark ? 'dark' : 'light', palette, look: theme.id };
    if (lookCache.size > 64) lookCache.clear();
    lookCache.set(key, out);
    return out;
  }
  // Resolve an element's tokens for a style: palette keys become colours,
  // type roles ('display', 'label', 'body') become ES font stacks. look (an
  // id, or { look, team }) re-skins the ES style for that look.
  function elementTokens(styleId, elementId, look = null) {
    const style = withLook(typeof styleId === 'object' && styleId ? styleId : get(styleId), look);
    const el = ELEMENTS[elementId];
    if (!el) return null;
    const over = (ELEMENT_TOKENS[style.id] || {})[elementId] || {};
    const out = {};
    Object.entries({ ...el.tokens, ...over }).forEach(([key, ref]) => {
      if (['display', 'label', 'body'].includes(ref)) out[key] = style.type[ref];
      else if (style.palette[ref] != null) out[key] = style.palette[ref];
      else out[key] = ref; // a literal colour override
    });
    return out;
  }
  // The default box for an element on a canvas (1080x1920 reel or 1080x1350 slide).
  function elementBox(elementId, canvas) {
    const el = ELEMENTS[elementId];
    if (!el) return null;
    return { ...(canvas && Number(canvas.h) === 1350 ? el.box45 : el.box) };
  }
  // Stub draw (Phase 0): a dashed, labelled box in the style's tokens, so a
  // data beat never crashes or draws nothing. Agent B replaces the call sites
  // with real drawing; this function stays as the fallback for unknown data.
  // ctx is a CanvasRenderingContext2D (or the tests' stub). Returns the op it drew.
  function drawPlaceholder(ctx, elementId, box, styleId) {
    const el = ELEMENTS[elementId] || { id: String(elementId || 'element'), label: String(elementId || 'Element') };
    const t = elementTokens(styleId, el.id) || {};
    const style = get(styleId);
    const b = box || elementBox(el.id) || { x: 88, y: 288, w: 904, h: 120 };
    const text = `${String(el.label).toUpperCase()} · COMING SOON`;
    const size = Math.max(18, Math.min(32, Math.round(b.h * 0.3)));
    if (ctx) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = style.palette.panel;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      if (ctx.setLineDash) ctx.setLineDash([12, 8]);
      ctx.strokeStyle = style.palette.accent;
      ctx.lineWidth = 3;
      ctx.strokeRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3);
      if (ctx.setLineDash) ctx.setLineDash([]);
      ctx.fillStyle = style.palette.ink;
      ctx.font = `700 ${size}px ${t.labelFont || t.font || LABEL}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, b.x + 20, b.y + b.h / 2, Math.max(10, b.w - 40));
      ctx.restore();
    }
    return { type: 'placeholder', element: el.id, text, x: b.x, y: b.y, w: b.w, h: b.h, size };
  }

  // Which beat kinds a style lets the director write (story kinds of the
  // format plus the style's components).
  const kindsFor = (styleId, formatKinds = STORY_KINDS) => [...new Set([...formatKinds, ...get(styleId).components])];

  // ─── Suggestion (code first, free) ───────────────────────────────────────
  const SERIES_RE = /\b(?:moneyball|rebuild|rebuilding|cap space|salary cap|free agen(?:cy|ts?)|draft (?:pick|capital)|front office|roster|blueprint|series|part \d|step \d|dead money|contract year|trade (?:up|down))\b/i;
  const DATA_RE = /\b(?:per (?:game|throw|attempt|carry)|average|rate|percent|percentile|rank(?:ed|s)?|since \d{4}|seasons?|out of|compared|vs\.?|versus|efficiency|epa|yards per|completion|analytics|data|chart)\b|\d+(?:\.\d+)?%|\b1 in \d+\b/i;
  // Default style per data format (owner, 2026-11-18); reel-formats.js
  // DATA_FORMATS[id].defaultStyle says the same (a test keeps them equal).
  // 2026-11-25: every data format is drawn in the ES style (the look re-skins it).
  const FORMAT_STYLES = { gameswing: 'es', replay: 'es', archive: 'es' };
  function suggestStyle({ format = '', text = '' } = {}) {
    if (FORMAT_STYLES[format]) return { id: FORMAT_STYLES[format], why: `The ${get(FORMAT_STYLES[format]).label} look is the house style for this format.` };
    void text;
    return { id: DEFAULT_STYLE, why: 'The ES video team\'s house style for every reel.' };
  }
  // The pre-2026-11-21 suggestion between the other looks (kept for the
  // picker's "why" lines and for anyone who picks a look by hand).
  function legacySuggestStyle({ format = '', text = '' } = {}) {
    const t = String(text || '');
    const numbers = (t.match(/\d[\d,.]*/g) || []).length;
    if (format === 'top5' || /\btop[\s-]?(?:5|five|10|ten)\b|\bcountdown\b|\branked\b/i.test(t)) return { id: 'countdown', why: 'A ranked list: cards flip in from 5 to 1.' };
    if (SERIES_RE.test(t)) return { id: 'series', why: 'Roster, cap or draft talk reads best as a dashboard with a data strip.' };
    if (DATA_RE.test(t) || numbers >= 4) return { id: 'explainer', why: 'Several numbers to compare: a light data explainer shows them clearly.' };
    return { id: 'classic', why: 'A news story: full photos and bold captions keep it moving.' };
  }

  // ─── Integrity (tests) ───────────────────────────────────────────────────
  const HEX = /^#[0-9a-f]{6}$/i;
  const COLOR = /^(?:#[0-9a-f]{6}|rgba?\([\d\s.,]+\))$/i;
  // Purple: hue 255-300 with real saturation. Never in the UI chrome.
  function isPurple(hex) {
    const m = String(hex).match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return false;
    const [r, g, b] = m.slice(1).map(x => parseInt(x, 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 0.12) return false;
    let h;
    if (max === r) h = ((g - b) / (max - min)) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    h = (h * 60 + 360) % 360;
    return h >= 255 && h <= 300;
  }
  function validateStyle(style) {
    const problems = [];
    if (!style || !style.id) return ['no id'];
    ['bg', 'paper', 'panel', 'ink', 'muted', 'accent', 'hi', 'hiInk', 'good', 'bad', 'chip', 'chipInk', 'mystery'].forEach(k => {
      if (!COLOR.test(String(style.palette && style.palette[k]))) problems.push(`${style.id}: palette.${k}`);
      else if (HEX.test(style.palette[k]) && isPurple(style.palette[k])) problems.push(`${style.id}: palette.${k} is purple`);
    });
    ['display', 'label', 'body'].forEach(k => { if (!FONTS.includes(style.type && style.type[k])) problems.push(`${style.id}: type.${k} not an ES font`); });
    ALL_KINDS.forEach(kind => { if (!LAYOUTS.includes(style.layouts && style.layouts[kind])) problems.push(`${style.id}: no layout for ${kind}`); });
    (style.components || []).forEach(k => { if (!COMPONENT_KINDS.includes(k)) problems.push(`${style.id}: unknown component ${k}`); });
    if (!(style.seconds && style.seconds.max >= style.seconds.target[1])) problems.push(`${style.id}: seconds`);
    if (!['crossfade', 'slide', 'wipe', 'flip', 'slab'].includes(style.motion && style.motion.transition)) problems.push(`${style.id}: transition`);
    if (!['user', 'block', 'highlight', 'box', 'es'].includes(style.caption && style.caption.mode)) problems.push(`${style.id}: caption mode`);
    // Data-format elements: every token resolves to an ES font or a non-purple colour.
    ELEMENT_IDS.forEach(id => {
      const over = (ELEMENT_TOKENS[style.id] || {})[id] || {};
      Object.entries({ ...ELEMENTS[id].tokens, ...over }).forEach(([key, ref]) => {
        if (['display', 'label', 'body'].includes(ref)) { if (!FONTS.includes(style.type && style.type[ref])) problems.push(`${style.id}: ${id}.${key} not an ES font`); return; }
        const value = style.palette && style.palette[ref] != null ? style.palette[ref] : ref;
        if (!COLOR.test(String(value))) problems.push(`${style.id}: ${id}.${key} is not a colour`);
        else if (HEX.test(value) && isPurple(value)) problems.push(`${style.id}: ${id}.${key} is purple`);
      });
    });
    return problems;
  }

  return {
    STYLES, STYLE_IDS, LEGACY_STYLE_IDS, isLegacy, currentStyle, withLook, DEFAULT_STYLE, BRAND, ES_LAYOUTS, legacySuggestStyle, STORY_KINDS, COMPONENT_KINDS, ALL_KINDS, LAYOUTS, DATA_LAYOUTS, GRID, FONTS, CONDENSED, LABEL, BODY, get, kindsFor, suggestStyle, validateStyle, isPurple,
    ELEMENTS, ELEMENT_IDS, ELEMENT_TOKENS, FORMAT_STYLES, elementTokens, elementBox, drawPlaceholder,
  };
}));
