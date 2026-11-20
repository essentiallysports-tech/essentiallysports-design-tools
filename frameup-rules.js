// FrameUp brand rulebook: the ES social-post rules Generate is checked against.
// One file for the server (require) and the browser (window.FrameUpRules).
//
// Sources: template constants in index.html (PILL_*, POST_SAFE_AREA,
// QUOTE_POST_TEMPLATE, LONG_QUOTE_TEMPLATE, DOUBLE_ENTITY_*), the brand guide
// (project-docs/es-designer-brand-design-guide.md) and the Generate prompt.
// All sizes are on the 1080×1350 Social canvas. If a template's layout changes
// in index.html, update its box here too.
(function (root, factory) {
  const rules = factory();
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else root.FrameUpRules = rules;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const CANVAS = { width: 1080, height: 1350 };
  const SAFE_AREA = 50;
  // A pill's text area: canvas minus both safe areas minus the pill's padding.
  const PILL_TEXT_WIDTH = CANVAS.width - 2 * SAFE_AREA - 18.4 - 21.88;

  // How each text field is drawn. `minSize` is the smallest size that still
  // reads as an ES post; the canvas would shrink further, but below this the
  // checker asks for shorter copy. upper: the canvas uppercases this field.
  const FIT = {
    cover: { pill: { font: 'post', size: 130, minSize: 84, maxWidth: PILL_TEXT_WIDTH, upper: true } },
    quote: { line: { font: 'post', size: 131, minSize: 90, maxWidth: 900, upper: true } },
    'long-quote': { text: { font: 'condensed', size: 87, minSize: 50, maxWidth: 940, maxHeight: 245, lineHeight: 0.99, letterSpacing: -0.01, upper: true, wrap: true } },
    'double-entity-quote': {
      quote: { font: 'post', size: 98, minSize: 66, maxWidth: 455, maxHeight: 279, lineHeight: 0.95, letterSpacing: -0.02, upper: true, wrap: true },
      name: { font: 'post', size: 29, minSize: 24, maxWidth: 440, upper: true },
    },
    'stats-single-ent': {
      headline: { font: 'post', size: 130, minSize: 84, maxWidth: PILL_TEXT_WIDTH, upper: true },
      value: { font: 'post', size: 198, minSize: 110, maxWidth: 177, upper: true },
      label: { font: 'post', size: 47, minSize: 32, maxWidth: 110, upper: true },
    },
    'stats-double-ent': {
      headline: { font: 'post', size: 121, minSize: 80, maxWidth: 985, upper: true },
      name: { font: 'post', size: 83, minSize: 56, maxWidth: 560, upper: true },
    },
  };

  // Words and patterns ES posts never use. Each has a short reason for the
  // repair prompt. Matched case-insensitively against every text field.
  const BANNED = [
    { re: /you won['’]?t believe/i, why: 'clickbait phrase' },
    { re: /\b(?:shocking|shocked|jaw[- ]?dropping|mind[- ]?blowing|insane|unbelievable)\b/i, why: 'hype word; make the claim specific instead' },
    { re: /\b(?:must[- ]see|watch now|click|link in bio|swipe up)\b/i, why: 'call-to-action words do not belong on the design' },
    { re: /\bbreaking\b/i, why: '"Breaking" labels are not ES post style' },
    { re: /\b(?:omg|wtf|lol|smh|bruh)\b/i, why: 'slang abbreviation' },
    { re: /!{2,}|\?{2,}/, why: 'repeated punctuation' },
    { re: /#[A-Za-z0-9_]/, why: 'no hashtags on the design' },
    { re: /https?:\/\/|www\./i, why: 'no links on the design' },
    { re: /\p{Extended_Pictographic}/u, why: 'no emojis' },
    { re: /\b(?:fuck|shit|bitch|damn|hell no)\b/i, why: 'profanity' },
  ];

  // Filler words that weaken a hook (flagged as warnings, not errors).
  const WEAK_WORDS = /\b(?:very|really|just|literally|basically|actually)\b/i;

  // Lines added to the Generate prompt so the model writes to the rulebook.
  const VOICE = [
    'Write like ES: punchy, confident, plain American sports English. No emojis, no hashtags, no links, no "Breaking", no hype words (shocking, insane, unbelievable, you won\'t believe), no repeated !! or ??.',
    'Every number, score and stat must appear in the brief or the ES research. If it is not there, leave it out.',
    'Text is set in a heavy condensed font and uppercased on the design: shorter lines look bigger and better. A Cover pill reads best at 10-16 characters.',
  ];

  // Real stat labels (Player Stats / Head-to-Head).
  const STAT_LABELS = /^(PTS|REB|REBS|AST|ASTS|STL|BLK|TOV|FG|FG%|3PM|3PT|FT|FT%|YDS|YARDS|TD|TDS|INT|INTS|REC|CAR|RUSH|SACK|SACKS|TKL|TKLS|HR|RBI|AVG|ERA|SO|K|HITS|SB|OPS|WHIP|GOALS|G|A|SOG|SV|SAVES|PPG|RPG|APG|SPG|BPG|MIN|MINS|ACES|WINS|W|L|PCT|QBR|CMP|ATT|RTG|BIRDIES|EAGLES|PAR)$/i;

  // The ES pill: the editor's Cover pill (index.html PILL_*, drawPills,
  // getPillFont). Acumin Pro Condensed Black ("Acumin Post", 900), uppercase,
  // no letter-spacing, a sharp solid box; 130px type in a 122px pill with
  // 18.4 / 21.88px side padding; stacked rows touch (each row starts just under
  // the letters of the one above). Any pill size keeps these proportions.
  // scripts/test-pill-rules.mjs checks these numbers against index.html.
  const PILL = Object.freeze({
    family: 'Acumin Post',
    file: 'fonts/acumin-post-legacy.otf',
    weight: 900,
    upper: true,
    letterSpacing: 0,
    radius: 0,
    size: 130,
    height: 122,
    padLeft: 18.4,
    padRight: 21.88,
    edgeGap: 1,
    rowGap: 1,
    minSize: FIT.cover.pill.minSize,
    heightRatio: 122 / 130,
    padLeftRatio: 18.4 / 130,
    padRightRatio: 21.88 / 130,
    bestChars: [10, 16],
    mistContrast: 2.4,
  });
  // One pill row at a type size: box height, side padding, the text's top
  // padding (cap height centred), its baseline from the box top and the step
  // to the next stacked row (drawPills). cap = the measured cap height of "A";
  // scale = export scale (the 1px gaps scale with the canvas, not the type).
  function pillMetrics(size, cap, scale = 1) {
    const h = size * PILL.heightRatio;
    const capH = cap > 0 ? cap : size * 0.68;
    const topPad = Math.max(0, Math.round((h - capH) * 0.5));
    const baseline = Math.min(topPad + capH, h - Math.round(2 * scale));
    const step = Math.max(Math.round(h * 0.55), h - topPad + Math.round(PILL.edgeGap * scale)) + Math.round(PILL.rowGap * scale);
    return { size, h, padLeft: size * PILL.padLeftRatio, padRight: size * PILL.padRightRatio, topPad, baseline, step, cap: capH };
  }

  // Pill text colour (index.html getMistColorForPair / getTextColorForPair,
  // Social): the pair's mist when it reads (contrast >= 2.4), else the better
  // of white / black. pair = { background, foreground, mist }; others = the
  // rest of that brand-kit entry's pairs (the editor's fallback mist).
  const hexOk = v => /^#[0-9a-f]{6}$/i.test(String(v || ''));
  function luminance(hex) {
    const value = (hexOk(hex) ? hex : '#000000').replace('#', '');
    const lin = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const [r, g, b] = [0, 2, 4].map(i => lin(parseInt(value.slice(i, i + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrastRatio(a, b) {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function pillMist(pair = {}, others = []) {
    const bg = String(pair.background || '').toLowerCase();
    if (pair.mist && pair.mist.toLowerCase() !== bg) return pair.mist;
    const alternate = (others || []).find(p => p?.background && p.background.toLowerCase() !== bg);
    if (alternate) return alternate.background;
    if (pair.foreground && pair.foreground.toLowerCase() !== bg) return pair.foreground;
    return bg === '#000000' ? '#FFFFFF' : '#000000';
  }
  function pillTextColor(pair = {}, others = []) {
    const bg = pair?.background || '#1A1A1A';
    const mist = pillMist({ ...pair, background: bg }, others);
    if (mist && mist.toLowerCase() !== bg.toLowerCase() && contrastRatio(bg, mist) >= PILL.mistContrast) return mist;
    const candidates = [mist, '#FFFFFF', '#000000'].filter((color, index, arr) => (
      color && color.toLowerCase() !== bg.toLowerCase() && arr.findIndex(c => c?.toLowerCase() === color.toLowerCase()) === index
    ));
    return candidates.sort((a, b) => contrastRatio(bg, b) - contrastRatio(bg, a))[0] || '#FFFFFF';
  }

  return { VERSION: '2026-11-25', CANVAS, SAFE_AREA, FIT, BANNED, WEAK_WORDS, VOICE, STAT_LABELS, PILL, pillMetrics, pillMist, pillTextColor, contrastRatio };
}));
