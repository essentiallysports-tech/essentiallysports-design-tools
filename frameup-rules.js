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

  return { VERSION: '2026-11-15', CANVAS, SAFE_AREA, FIT, BANNED, WEAK_WORDS, VOICE, STAT_LABELS };
}));
