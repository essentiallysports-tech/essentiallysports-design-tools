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
//
// Studied from two published ES reels (a light "data explainer" and the
// "ES Moneyball" analytics series) and rebuilt on one 8-pt grid inside the
// Reels safe zone (x 65-1015, y 270-1580). Fonts: Acumin Pro Condensed,
// Roboto and Roboto Condensed only. Team colours are content, never chrome.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelStyles = api;
}(typeof self !== 'undefined' ? self : this, () => {
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
  const LAYOUTS = ['legacy', 'headline-visual', 'stat-hero', 'rank-card', 'quote', 'bars', 'versus', 'dotrank', 'chips', 'steps', 'tiles', 'roles', 'mystery', 'endcard'];
  const STANDARD_LAYOUTS = {
    hook: 'headline-visual', context: 'headline-visual', point: 'headline-visual', payoff: 'headline-visual',
    stat: 'stat-hero', rank: 'rank-card', quote: 'quote', cta: 'endcard',
    bars: 'bars', versus: 'versus', dotrank: 'dotrank', chips: 'chips', steps: 'steps', tiles: 'tiles', roles: 'roles', mystery: 'mystery',
  };

  // 8-pt grid inside the safe zone. Light styles use one column x 88-992.
  const GRID = { unit: 8, left: 88, right: 992, top: 288, captionTop: 1336, captionBottom: 1512, bottom: 1560 };

  const STYLES = {
    classic: {
      id: 'classic',
      label: 'ES Classic',
      blurb: 'Dark, full-bleed ES photos with slow push-ins and bold captions.',
      theme: 'dark',
      engine: 'classic', // the original Reels Studio look (story beats keep their legacy layouts)
      palette: { bg: '#0B0D12', paper: '#0B0D12', panel: '#16191F', ink: '#FFFFFF', muted: 'rgba(255,255,255,0.72)', line: 'rgba(255,255,255,0.22)', accent: '#0A6FDE', hi: '#FFD23F', hiInk: '#101114', good: '#1E9E5A', bad: '#D93A2F', chip: '#FFD23F', chipInk: '#101114', mystery: '#2A2E37' },
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
      palette: { bg: '#ECEAE6', paper: '#ECEAE6', panel: '#FFFFFF', ink: '#111214', muted: '#62656D', line: '#C9C6C0', accent: '#1F6FEB', hi: '#FFD23F', hiInk: '#111214', good: '#1E9E5A', bad: '#D93A2F', chip: '#111214', chipInk: '#FFFFFF', mystery: '#D6D3CD', rule: '#1F6FEB', texture: 'dots' },
      type: { display: CONDENSED, label: LABEL, body: BODY, headline: [104, 72], stat: [320, 160], cardValue: [96, 64], labelSize: 32, eyebrow: 28, bodySize: 32, caption: [68, 52] },
      caption: { mode: 'block', box: '#111214', ink: '#FFFFFF', active: '#FFD23F' },
      motion: { enter: 'rise', durMs: 420, stagger: 40, transition: 'slide', transitionMs: 260 },
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
      palette: { bg: '#E8E7E3', paper: '#E8E7E3', panel: '#FFFFFF', ink: '#111214', muted: '#5E6168', line: '#111214', accent: '#1F6FEB', hi: '#FFD23F', hiInk: '#111214', good: '#1E9E5A', bad: '#D93A2F', chip: '#FFD23F', chipInk: '#111214', mystery: '#D3D1CB', rule: '#111214', texture: 'grid' },
      type: { display: CONDENSED, label: LABEL, body: BODY, headline: [96, 68], stat: [300, 150], cardValue: [112, 68], labelSize: 30, eyebrow: 26, bodySize: 30, caption: [64, 50] },
      caption: { mode: 'block', box: '#111214', ink: '#FFFFFF', active: '#FFD23F' },
      motion: { enter: 'wipe', durMs: 420, stagger: 60, transition: 'wipe', transitionMs: 260 },
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
      blurb: 'Ranked photo cards that flip in, a 5-to-1 rail and gold rank numerals on deep navy.',
      theme: 'dark',
      engine: 'styled',
      palette: { bg: '#0D1220', paper: '#0D1220', panel: '#161D30', ink: '#FFFFFF', muted: 'rgba(255,255,255,0.74)', line: 'rgba(255,255,255,0.2)', accent: '#2F80ED', hi: '#F2B33D', hiInk: '#0D1220', good: '#2FB36B', bad: '#E5484D', chip: '#F2B33D', chipInk: '#0D1220', mystery: '#232B40', rule: '#F2B33D', texture: 'lines' },
      type: { display: CONDENSED, label: LABEL, body: BODY, headline: [104, 72], stat: [300, 150], cardValue: [104, 68], labelSize: 32, eyebrow: 28, bodySize: 34, caption: [88, 62] },
      caption: { mode: 'highlight' },
      motion: { enter: 'flip', durMs: 460, stagger: 50, transition: 'flip', transitionMs: 300 },
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
  const STYLE_IDS = ['classic', 'explainer', 'series', 'countdown'];
  const get = id => STYLES[id] || STYLES.classic;

  // Which beat kinds a style lets the director write (story kinds of the
  // format plus the style's components).
  const kindsFor = (styleId, formatKinds = STORY_KINDS) => [...new Set([...formatKinds, ...get(styleId).components])];

  // ─── Suggestion (code first, free) ───────────────────────────────────────
  const SERIES_RE = /\b(?:moneyball|rebuild|rebuilding|cap space|salary cap|free agen(?:cy|ts?)|draft (?:pick|capital)|front office|roster|blueprint|series|part \d|step \d|dead money|contract year|trade (?:up|down))\b/i;
  const DATA_RE = /\b(?:per (?:game|throw|attempt|carry)|average|rate|percent|percentile|rank(?:ed|s)?|since \d{4}|seasons?|out of|compared|vs\.?|versus|efficiency|epa|yards per|completion|analytics|data|chart)\b|\d+(?:\.\d+)?%|\b1 in \d+\b/i;
  function suggestStyle({ format = '', text = '' } = {}) {
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
    if (!['crossfade', 'slide', 'wipe', 'flip'].includes(style.motion && style.motion.transition)) problems.push(`${style.id}: transition`);
    if (!['user', 'block', 'highlight', 'box'].includes(style.caption && style.caption.mode)) problems.push(`${style.id}: caption mode`);
    return problems;
  }

  return { STYLES, STYLE_IDS, STORY_KINDS, COMPONENT_KINDS, ALL_KINDS, LAYOUTS, GRID, FONTS, CONDENSED, LABEL, BODY, get, kindsFor, suggestStyle, validateStyle, isPurple };
}));
