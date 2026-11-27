// ES Reels looks: many looks, one system. Each look is DATA on top of the ES
// video team's kit (reel-es.js): a ground, colour roles, a pill treatment, a
// caption box, a layout preset and a motion preset. Nothing here can change
// the kit's locked rules; validateLook() refuses a look that tries.
//
//   LOOKS / LOOK_IDS / DEFAULT_LOOK   Paper (today's look, the default), Ink,
//                                     Blue, Team colour, Photo-led, Data-led,
//                                     Minimal, Bold
//   LAYOUTS / MOTIONS / SURFACES      the presets a look may name
//   resolve(lookId, { team })         -> theme (what reel-es.js draws with)
//   validateLook(look, { team })      -> [] of problems
//   contrast(a, b) / luminance(hex)   WCAG maths
//   lookForStyle(styleId)             the closest look for a retired style
//
// LOCKED (never part of a look; reel-es.js owns them): the two typefaces, the
// safe frame, the caption line, the ES mark on the hook and the end card only,
// the slab wipe's shape, skew and 0.5 s, the end card last, the copy LIMITS,
// and what the signal colours mean (green = win, red = loss, yellow = caption
// emphasis). A look only chooses among the brand tokens, plus one team colour
// (the Team colour look) that is contrast-checked every time.
//
// Contrast rules (validateLook):
//   reading text (text on its ground, a pill's ink on its fill, caption words
//   on the caption box, the source line)                       at least 4.5:1
//   accent display type (the blue line, the big number)        at least 3:1
//   signal colours used as text keep their kit colour; on a ground where one
//   would drop under 3:1 the surface names a plate (an ink hug box) and the
//   engine draws the word on it. The kit's own paper pairings are kept as is.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelESThemes = api;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // The brand tokens (the same object reel-es.js exports as TOKENS).
  const TOKENS = { blue: '#0A7DFA', ink: '#121212', paper: '#F1EFEA', green: '#1BC47D', red: '#E8322B', yellow: '#FFC52F', white: '#FFFFFF' };
  const SIGNALS = ['green', 'red', 'yellow'];
  const SIGNAL_MEANING = { green: 'win', red: 'loss', yellow: 'emphasis' };
  const NEUTRALS = ['ink', 'paper', 'white', 'blue'];
  const GROUNDS = ['paper', 'white', 'ink', 'blue', 'team']; // never a signal colour: a green or red ground would read as a result
  const HEX6 = /^#[0-9a-f]{6}$/i;
  const TEXT_MIN = 4.5;
  const ACCENT_MIN = 3;

  function luminance(hex) {
    const m = String(hex || '').match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return 0;
    const [r, g, b] = m.slice(1).map(x => { const v = parseInt(x, 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  // `over` drawn at `alpha` on `under` (the source line at 72%).
  function blend(over, under, alpha) {
    const p = h => [1, 3, 5].map(i => parseInt(String(h).slice(i, i + 2), 16));
    const [a, b] = [p(over), p(under)];
    return `#${a.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  }

  // ─── Layout presets (sizes are 9:16 px; the 4:5 frame scales them) ──────
  // Every preset stays inside the safe frame and above the caption line; the
  // column, the caption line and the marks are not theirs to move.
  // v3 (2026-11-27): sizes are steps of the one type scale (reel-es.js
  // TYPE_SCALE), never free pixel values. pillStep / statementStep /
  // numberStep name the biggest step a block may use; text that does not fit
  // moves down one step at a time (and is shortened at the smallest), never
  // to an in-between size.
  const LAYOUTS = {
    standard: { id: 'standard', pillBoxed: true, pillStep: 'h1', statementStep: 'display', statementBoxed: false, numberStep: 'statXL', kickerFill: 'ink', kickerBoxed: true, whoBoxed: true, ctaPanel: true, media: { hook: 'full', statement: 'lower' }, director: 'Standard: any mix of blocks; one idea a beat.' },
    photo: { id: 'photo', pillBoxed: true, pillStep: 'h1', statementStep: 'h1', statementBoxed: true, numberStep: 'statXL', kickerFill: 'ink', kickerBoxed: true, whoBoxed: true, ctaPanel: true, media: { hook: 'full', statement: 'full' }, director: 'Photo-led: the hook and at least two statement beats, each one a moment a photo can show (a person, a play, a place); at most one number, dots or compare beat.' },
    data: { id: 'data', pillBoxed: true, pillStep: 'h1', statementStep: 'h1', statementBoxed: false, numberStep: 'statXL', kickerFill: 'blue', kickerBoxed: true, whoBoxed: true, ctaPanel: true, media: { hook: 'full', statement: 'lower' }, director: 'Data-led: at least two of number / dots / compare, each with a kicker; statements only to set up or land a figure.' },
    minimal: { id: 'minimal', pillBoxed: false, pillStep: 'h1', statementStep: 'display', statementBoxed: false, numberStep: 'statXL', kickerFill: 'ink', kickerBoxed: false, whoBoxed: false, ctaPanel: false, media: { hook: 'lower', statement: 'lower' }, director: 'Minimal: at most two pills on the hook, no stamp, statements of one or two lines; let one figure or one quote carry the reel.' },
    bold: { id: 'bold', pillBoxed: true, pillStep: 'display', statementStep: 'display', statementBoxed: true, numberStep: 'statXL', kickerFill: 'blue', kickerBoxed: true, whoBoxed: true, ctaPanel: true, media: { hook: 'full', statement: 'lower' }, director: 'Bold: pills and lines of 10 characters or fewer so they draw at full size; two lines beat three.' },
    // Game Tape: the clip carries the scene, boxed words sit over it.
    tape: { id: 'tape', pillBoxed: true, pillStep: 'h1', statementStep: 'h1', statementBoxed: true, numberStep: 'statXL', kickerFill: 'ink', kickerBoxed: true, whoBoxed: true, ctaPanel: true, media: { hook: 'full', statement: 'full' }, director: 'Game Tape: the clip is the story; short boxed words over it.' },
  };
  // ─── Motion presets (inside the kit's limits: 0.35-0.45 s, 150-180 ms) ──
  const MOTION_LIMITS = { enterMinMs: 350, enterMaxMs: 450, staggerMinMs: 150, staggerMaxMs: 180 };
  const MOTIONS = {
    standard: { id: 'standard', enterMs: 400, staggerMs: 160 },
    calm: { id: 'calm', enterMs: 450, staggerMs: 180 },
    punchy: { id: 'punchy', enterMs: 350, staggerMs: 150 },
  };

  // ─── Surfaces: how the kit's colour names land on a ground ──────────────
  // text / fill: a block's colour name -> the token drawn (absent = itself).
  // plate: the hug box a low-contrast signal word sits on (null = kit pairing).
  // dot: the plain dots. cta: the end card panel. logo / mark: the brand
  // colourway (black where what is under it is ES blue). small: source-line alpha.
  const SURFACES = {
    paper: { id: 'paper', ground: 'paper', text: {}, fill: {}, plate: null, dot: 'ink', cta: 'blue', logo: 'blue', mark: 'blue', small: 0.72 },
    white: { id: 'white', ground: 'white', text: { white: 'ink' }, fill: {}, plate: null, dot: 'ink', cta: 'blue', logo: 'blue', mark: 'blue', small: 0.72 },
    // White with the pills swapped: blue is the first pill, ink the second (Data-led).
    whiteBlue: { id: 'whiteBlue', ground: 'white', text: { white: 'ink' }, fill: { ink: 'blue', blue: 'ink' }, plate: null, dot: 'ink', cta: 'blue', logo: 'blue', mark: 'blue', small: 0.72 },
    ink: { id: 'ink', ground: 'ink', text: { ink: 'white' }, fill: { ink: 'white' }, plate: null, dot: 'white', cta: 'blue', logo: 'blue', mark: 'blue', small: 0.72 },
    inkPaper: { id: 'inkPaper', ground: 'ink', text: { ink: 'paper', white: 'paper' }, fill: { ink: 'paper', white: 'paper' }, plate: null, dot: 'paper', cta: 'blue', logo: 'blue', mark: 'blue', small: 0.72 },
    blue: { id: 'blue', ground: 'blue', text: { blue: 'white' }, fill: { blue: 'white' }, plate: 'ink', dot: 'ink', cta: 'ink', logo: 'black', mark: 'black', small: 1 },
  };
  // The Team colour surface is worked out from the colour itself, every time.
  function teamSurface(hex) {
    const cw = contrast('#FFFFFF', hex);
    const ci = contrast(TOKENS.ink, hex);
    const text = ci >= cw ? 'ink' : 'white';
    const other = text === 'ink' ? 'white' : 'ink';
    const hexOf = n => TOKENS[n];
    // The accent: the other neutral or ES blue where it reads on the colour;
    // else ES blue on the ink plate (a light yellow or gold ground).
    const accent = [other, 'blue'].find(n => n !== text && contrast(hexOf(n), hex) >= ACCENT_MIN) || 'blue';
    const alt = [other, 'blue', 'paper'].find(n => contrast(hexOf(n), hex) >= 1.6) || other;
    // The mark turns black only on a colour close to ES blue itself.
    const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const [p, q] = [rgb(hex), rgb(TOKENS.blue)];
    const nearBlue = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 110;
    return { id: 'team', ground: 'team', text: { ink: text, white: text, blue: accent }, fill: { ink: text, white: text, blue: alt }, plate: 'ink', dot: text, cta: text, logo: nearBlue ? 'black' : 'blue', mark: nearBlue ? 'black' : 'blue', small: 1 };
  }

  // A few mid-tone colours (a pure red, say) carry neither white nor ink text
  // at 4.5:1. validateLook refuses them as a ground, and the Team colour look
  // then keeps the reel on ink and uses the colour for a pill and the wipe.
  const teamCarriesText = hex => Math.max(contrast('#FFFFFF', hex), contrast(TOKENS.ink, hex)) >= TEXT_MIN;
  const TEAM_ON_INK = { id: 'team', ground: 'ink', text: { ink: 'white' }, fill: { ink: 'white', blue: 'team' }, plate: null, dot: 'white', cta: 'blue', logo: 'blue', mark: 'blue', small: 0.72 };

  // ─── The looks ──────────────────────────────────────────────────────────
  // ground: the token every scene starts on. scenes: blocks that leave it for
  // another surface (the kit's quote sits on ink). roles: the look's colour
  // roles, spelled out (validateLook checks they agree with the surfaces).
  const LOOKS = {
    paper: {
      id: 'paper', label: 'Paper', blurb: 'The ES house look: warm paper, ink pills, blue accents.',
      ground: 'paper', surface: 'paper', scenes: { quote: 'ink' },
      roles: { text: 'ink', accent: 'blue', pillFill: 'ink', pillInk: 'white', pillAlt: 'blue', captionFill: 'ink', captionInk: 'white', captionEmphasis: 'yellow', mark: 'blue', wipe: ['blue', 'ink'], dotBase: 'ink', grain: 0.05 },
      pill: 'boxed', caption: { box: 'hug', emphasis: 'text' }, layout: 'standard', motion: 'standard',
    },
    ink: {
      id: 'ink', label: 'Ink', blurb: 'Night mode: ink ground, paper type and pills.',
      // Every scene stays on ink, the quote too: one light scene in a dark reel reads as a mistake.
      ground: 'ink', surface: 'inkPaper', scenes: {},
      roles: { text: 'paper', accent: 'blue', pillFill: 'paper', pillInk: 'ink', pillAlt: 'blue', captionFill: 'paper', captionInk: 'ink', captionEmphasis: 'yellow', mark: 'blue', wipe: ['blue', 'paper'], dotBase: 'paper', grain: 0 },
      pill: 'boxed', caption: { box: 'hug', emphasis: 'highlight' }, layout: 'standard', motion: 'standard',
    },
    blue: {
      id: 'blue', label: 'Blue', blurb: 'ES blue edge to edge, ink type; figures on ink.',
      // The quote stays on blue; only the figures (number, dots, compare) drop to ink boards.
      ground: 'blue', surface: 'blue', scenes: { number: 'ink', dots: 'ink', compare: 'ink' },
      roles: { text: 'ink', accent: 'white', pillFill: 'ink', pillInk: 'white', pillAlt: 'white', captionFill: 'ink', captionInk: 'white', captionEmphasis: 'yellow', mark: 'black', wipe: ['white', 'ink'], dotBase: 'ink', grain: 0 },
      pill: 'boxed', caption: { box: 'hug', emphasis: 'text' }, layout: 'standard', motion: 'standard',
    },
    team: {
      id: 'team', label: 'Team colour', blurb: 'The team\'s colour as the ground, contrast-checked.',
      ground: 'team', surface: 'team', scenes: { quote: 'ink', number: 'ink', dots: 'ink', compare: 'ink' },
      // text, accent and pills are worked out from the team colour (teamSurface).
      roles: { text: 'auto', accent: 'auto', pillFill: 'auto', pillInk: 'auto', pillAlt: 'auto', captionFill: 'ink', captionInk: 'white', captionEmphasis: 'yellow', mark: 'auto', wipe: ['team', 'ink'], dotBase: 'auto', grain: 0 },
      pill: 'boxed', caption: { box: 'hug', emphasis: 'text' }, layout: 'standard', motion: 'standard', teamColour: true,
    },
    photo: {
      id: 'photo', label: 'Photo-led', blurb: 'Full-frame photos under white boxed lines.',
      ground: 'ink', surface: 'ink', scenes: {},
      roles: { text: 'white', accent: 'blue', pillFill: 'white', pillInk: 'ink', pillAlt: 'blue', captionFill: 'ink', captionInk: 'white', captionEmphasis: 'yellow', mark: 'blue', wipe: ['blue', 'ink'], dotBase: 'white', grain: 0 },
      pill: 'boxed', caption: { box: 'hug', emphasis: 'text' }, layout: 'photo', motion: 'standard',
    },
    data: {
      id: 'data', label: 'Data-led', blurb: 'White story, ink boards for figures, blue pills.',
      ground: 'white', surface: 'whiteBlue', scenes: { quote: 'ink', number: 'ink', dots: 'ink', compare: 'ink' },
      roles: { text: 'ink', accent: 'blue', pillFill: 'blue', pillInk: 'white', pillAlt: 'ink', captionFill: 'ink', captionInk: 'white', captionEmphasis: 'yellow', mark: 'blue', wipe: ['blue', 'ink'], dotBase: 'ink', grain: 0 },
      pill: 'boxed', caption: { box: 'hug', emphasis: 'text' }, layout: 'data', motion: 'standard',
    },
    minimal: {
      id: 'minimal', label: 'Minimal', blurb: 'Type on paper, no boxes, a calmer pace.',
      ground: 'paper', surface: 'paper', scenes: {},
      roles: { text: 'ink', accent: 'blue', pillFill: 'ink', pillInk: 'white', pillAlt: 'blue', captionFill: 'ink', captionInk: 'white', captionEmphasis: 'yellow', mark: 'blue', wipe: ['blue', 'ink'], dotBase: 'ink', grain: 0 },
      pill: 'plain', caption: { box: 'hug', emphasis: 'text' }, layout: 'minimal', motion: 'calm',
    },
    bold: {
      id: 'bold', label: 'Bold', blurb: 'Everything boxed and a size up, a faster pace.',
      // The quote sits on ink, as in Paper (the kit's own quote).
      ground: 'paper', surface: 'paper', scenes: { quote: 'ink' },
      roles: { text: 'ink', accent: 'blue', pillFill: 'ink', pillInk: 'white', pillAlt: 'blue', captionFill: 'ink', captionInk: 'white', captionEmphasis: 'yellow', mark: 'blue', wipe: ['ink', 'blue'], dotBase: 'ink', grain: 0.05 },
      pill: 'big', caption: { box: 'hug', emphasis: 'text' }, layout: 'bold', motion: 'punchy',
    },
  };
  // Internal looks the v3 styles draw with (never offered on their own).
  LOOKS.tape = {
    id: 'tape', label: 'Game Tape', blurb: 'Clips first, boxed words over them, on the ES paper.',
    ground: 'paper', surface: 'paper', scenes: { quote: 'ink' },
    roles: { text: 'ink', accent: 'blue', pillFill: 'ink', pillInk: 'white', pillAlt: 'blue', captionFill: 'ink', captionInk: 'white', captionEmphasis: 'yellow', mark: 'blue', wipe: ['blue', 'ink'], dotBase: 'ink', grain: 0.05 },
    pill: 'boxed', caption: { box: 'hug', emphasis: 'text' }, layout: 'tape', motion: 'standard', internal: true,
  };
  const LOOK_IDS = ['paper', 'ink', 'blue', 'team', 'photo', 'data', 'minimal', 'bold'];
  const DEFAULT_LOOK = 'paper';
  const lookId = id => (LOOKS[id] ? id : DEFAULT_LOOK);
  // The closest look for each style retired on 2026-11-25.
  const LEGACY_STYLE_LOOKS = { classic: 'photo', explainer: 'data', series: 'ink', countdown: 'paper' };
  const lookForStyle = styleId => LEGACY_STYLE_LOOKS[styleId] || DEFAULT_LOOK;

  // The ink (text colour name) for a fill: ink on the light tokens, white on the rest.
  function inkOn(fill, colors) {
    if (fill === 'team') return contrast(TOKENS.ink, (colors && colors.team) || TOKENS.blue) >= contrast('#FFFFFF', (colors && colors.team) || TOKENS.blue) ? 'ink' : 'white';
    return ['yellow', 'green', 'white', 'paper'].includes(fill) ? 'ink' : 'white';
  }

  // ─── resolve: a look (+ the reel's team colour) -> the theme drawn ──────
  const cache = new Map();
  function resolve(id, { team = '' } = {}) {
    const look = LOOKS[lookId(id)];
    const teamHex = look.teamColour && HEX6.test(String(team || '')) ? String(team).toUpperCase() : '';
    const key = `${look.id}|${teamHex}`;
    if (cache.has(key)) return cache.get(key);
    const colors = { ...TOKENS, team: teamHex || TOKENS.blue };
    // Team colour with no team on the reel draws as ES blue (the lint says so).
    const teamWeak = Boolean(teamHex) && !teamCarriesText(teamHex);
    const surfaces = { ...SURFACES, team: look.teamColour ? (teamWeak ? TEAM_ON_INK : teamHex ? teamSurface(teamHex) : { ...SURFACES.blue, id: 'team', ground: 'team' }) : null };
    const base = surfaces[look.surface];
    // A team colour close to ink keeps every scene on it (ink boards beside a
    // near-black ground read as a mistake), and the wipe leads with white.
    const teamDark = teamWeak || Boolean(teamHex) && contrast(TOKENS.ink, teamHex) < 2.2 && SIGNALS.concat('blue').every(n => contrast(TOKENS[n], teamHex) >= ACCENT_MIN);
    // The first slab, then the slab the cut happens under. On a team colour
    // close to ink the cover slab is white, so the wipe never vanishes.
    const wipe = look.roles.wipe.slice();
    if (teamDark) { wipe[0] = teamWeak ? 'team' : 'white'; wipe[1] = teamWeak ? 'white' : 'ink'; }
    const theme = {
      id: look.id, look, colors, team: teamHex, teamMissing: Boolean(look.teamColour && !teamHex), teamWeak,
      base, surfaces,
      surfaceFor: type => (teamDark ? base : surfaces[look.scenes[type]] || base),
      caption: { fill: look.roles.captionFill, ink: look.roles.captionInk, em: look.roles.captionEmphasis, mode: look.caption.emphasis, box: look.caption.box },
      wipe,
      grain: look.roles.grain || 0,
      layout: LAYOUTS[look.layout] || LAYOUTS.standard,
      motion: MOTIONS[look.motion] || MOTIONS.standard,
      inkOn: fill => inkOn(fill, colors),
      hex: name => colors[name] || name,
    };
    if (cache.size > 64) cache.clear();
    cache.set(key, theme);
    return theme;
  }

  // ─── validateLook ───────────────────────────────────────────────────────
  // look: a LOOKS entry (or any object of that shape). team: the hex the Team
  // colour look would run with. Returns plain-English problems; [] = valid.
  function validateLook(look, { team = '' } = {}) {
    const out = [];
    if (!look || typeof look !== 'object' || !look.id) return ['The look has no id.'];
    const say = m => out.push(`${look.id}: ${m}`);
    const roles = look.roles || {};
    // Tokens only. One team colour, only on a look that declares it.
    const isToken = c => Object.prototype.hasOwnProperty.call(TOKENS, c);
    const colourOk = c => isToken(c) || (c === 'team' && look.teamColour) || (c === 'auto' && look.teamColour);
    if (!GROUNDS.includes(look.ground)) say(`the ground "${look.ground}" is not a brand ground (paper, white, ink, blue or the team colour). Signal colours are never a ground.`);
    if (look.ground === 'team' && !look.teamColour) say('only the Team colour look may use a team colour.');
    Object.entries(roles).forEach(([role, value]) => {
      if (role === 'grain') { if (!(Number(value) >= 0 && Number(value) <= 0.08)) say('grain must be between 0 and 0.08.'); return; }
      if (role === 'mark') { if (!['blue', 'black', 'auto'].includes(value)) say('the ES mark is blue, or black on ES blue. Nothing else.'); return; }
      (Array.isArray(value) ? value : [value]).forEach(c => { if (!colourOk(c)) say(`${role} uses "${c}", which is not a brand token.`); });
    });
    // Signal meanings are never remapped.
    if (roles.captionEmphasis !== 'yellow') say('caption emphasis must be yellow (yellow means emphasis).');
    ['text', 'accent', 'pillFill', 'pillAlt', 'captionFill', 'captionInk', 'dotBase'].forEach(r => { if (SIGNALS.includes(roles[r])) say(`${r} is ${roles[r]}: green means a win, red a loss and yellow emphasis, so a signal colour cannot be a ${r} colour.`); });
    (Array.isArray(roles.wipe) ? roles.wipe : []).forEach(c => { if (SIGNALS.includes(c)) say(`the wipe uses ${c}: signal colours keep their meaning.`); });
    if (look.signals) say('a look cannot redefine the signal colours.');
    const surfIds = [look.surface, ...Object.values(look.scenes || {})];
    surfIds.forEach(sid => {
      const s = sid === 'team' ? (look.teamColour ? teamSurface(HEX6.test(team) ? team : TOKENS.blue) : null) : SURFACES[sid];
      if (!s) { say(`unknown surface "${sid}".`); return; }
      [...Object.entries(s.text), ...Object.entries(s.fill)].forEach(([from, to]) => { if (SIGNALS.includes(from) || SIGNALS.includes(to)) say(`surface ${sid} remaps ${from} to ${to}: signal colours are never remapped.`); });
    });
    Object.keys(look.scenes || {}).forEach(t => { if (!['hook', 'statement', 'number', 'dots', 'compare', 'quote', 'endcard'].includes(t)) say(`unknown block "${t}" in scenes.`); });
    // Wipe: two different colours.
    if (!Array.isArray(roles.wipe) || roles.wipe.length !== 2 || roles.wipe[0] === roles.wipe[1]) say('the wipe needs two different colours (the first slab, then the one the cut happens under).');
    // Presets and treatments.
    if (!LAYOUTS[look.layout]) say(`unknown layout preset "${look.layout}".`);
    const mo = MOTIONS[look.motion] || look.motion;
    if (!mo || typeof mo !== 'object') say(`unknown motion preset "${look.motion}".`);
    else {
      if (mo.enterMs < MOTION_LIMITS.enterMinMs || mo.enterMs > MOTION_LIMITS.enterMaxMs) say(`entrances take ${mo.enterMs} ms; the kit allows ${MOTION_LIMITS.enterMinMs} to ${MOTION_LIMITS.enterMaxMs}.`);
      if (mo.staggerMs < MOTION_LIMITS.staggerMinMs || mo.staggerMs > MOTION_LIMITS.staggerMaxMs) say(`the stagger is ${mo.staggerMs} ms; the kit allows ${MOTION_LIMITS.staggerMinMs} to ${MOTION_LIMITS.staggerMaxMs}.`);
    }
    if (!['boxed', 'plain', 'big'].includes(look.pill)) say(`unknown pill treatment "${look.pill}".`);
    if (!look.caption || look.caption.box !== 'hug' || !['text', 'highlight'].includes(look.caption.emphasis)) say('captions are one hug box; emphasis is yellow text or a yellow highlight.');
    // Locked rules a look may not carry at all.
    ['fonts', 'type', 'safe', 'captionY', 'markBlocks', 'limits', 'wipeMs', 'wipeSkewDeg', 'endcard'].forEach(k => { if (look[k] != null) say(`"${k}" is locked by the ES kit and cannot be set by a look.`); });
    if (out.length) return out;

    // Contrast, on every surface the look draws on.
    if (look.teamColour && team && !HEX6.test(String(team))) return [`${look.id}: the team colour "${team}" is not a hex colour.`];
    const colors = { ...TOKENS, team: HEX6.test(String(team)) ? team : TOKENS.blue };
    const hex = n => colors[n] || n;
    const need = (what, fg, bg, min) => { const c = contrast(hex(fg), hex(bg)); if (c < min) say(`${what}: ${fg} on ${bg} is ${c.toFixed(2)}:1 (needs ${min}:1).`); };
    [...new Set(surfIds)].forEach(sid => {
      const s = sid === 'team' ? teamSurface(colors.team) : SURFACES[sid];
      const t = n => s.text[n] || n;
      const f = n => s.fill[n] || n;
      need(`text on the ${sid} ground`, t('ink'), s.ground, TEXT_MIN);
      need(`accent on the ${sid} ${s.plate && contrast(hex(t('blue')), hex(s.ground)) < ACCENT_MIN ? 'plate' : 'ground'}`, t('blue'), s.plate && contrast(hex(t('blue')), hex(s.ground)) < ACCENT_MIN ? s.plate : s.ground, ACCENT_MIN);
      // Boxed words are display type (64 px and up): the kit's own white on blue and
      // white on red pills need 3:1; any other pill needs the full 4.5:1.
      ['ink', 'blue', ...SIGNALS].forEach(n => need(`${n} pill ink on the ${sid} surface`, inkOn(f(n), colors), f(n), ['blue', 'red'].includes(f(n)) ? ACCENT_MIN : TEXT_MIN));
      need(`end card words on the ${sid} surface`, inkOn(s.cta, colors), s.cta, s.cta === 'blue' ? ACCENT_MIN : TEXT_MIN);
      const small = s.small < 1 ? blend(hex(t('ink')), hex(s.ground), s.small) : hex(t('ink'));
      need(`source line on the ${sid} ground`, small, s.ground, TEXT_MIN);
      // Signals as words: readable on the ground, or on the surface's plate.
      // (The kit's own paper pairings are the kit's; they are not re-judged here.)
      if (s.plate) SIGNALS.concat(['blue', 'white']).forEach(n => { if (contrast(hex(t(n)), hex(s.ground)) < ACCENT_MIN) need(`${n} on the ${sid} plate`, t(n), s.plate, ACCENT_MIN); });
      else if (!['paper', 'white'].includes(s.ground)) SIGNALS.forEach(n => need(`${n} on the ${sid} ground`, n, s.ground, ACCENT_MIN));
    });
    // Roles agree with the base surface (the roles are the look's public face).
    if (!look.teamColour) {
      const s = SURFACES[look.surface];
      const want = { text: s.text.ink || 'ink', accent: s.text.blue || 'blue', pillFill: s.fill.ink || 'ink', pillAlt: s.fill.blue || 'blue', dotBase: s.dot, mark: s.mark };
      Object.entries(want).forEach(([r, v]) => { if (roles[r] !== v) say(`role ${r} says ${roles[r]} but the ${look.surface} surface draws ${v}.`); });
      if (roles.pillInk !== inkOn(want.pillFill, colors)) say(`pill ink ${roles.pillInk} does not match the fill ${want.pillFill}.`);
      if (s.ground !== look.ground) say(`the ground ${look.ground} does not match the ${look.surface} surface.`);
    }
    // Captions: words on the box; emphasis as yellow words, or ink on a yellow highlight.
    need('caption words', roles.captionInk, roles.captionFill, TEXT_MIN);
    if (look.caption.emphasis === 'text') need('caption emphasis', 'yellow', roles.captionFill, TEXT_MIN);
    else need('caption emphasis (ink on the yellow highlight)', 'ink', 'yellow', TEXT_MIN);
    return out;
  }

  // The contrast matrix of a look (tests and the frame-sheet review print it).
  function contrastMatrix(id, { team = '' } = {}) {
    const theme = resolve(id, { team });
    const rows = [];
    const types = ['hook', 'statement', 'number', 'dots', 'compare', 'quote', 'endcard'];
    const seen = new Set();
    types.forEach(type => {
      const s = theme.surfaceFor(type);
      if (seen.has(s.id)) return;
      seen.add(s.id);
      const g = theme.hex(s.ground);
      const t = n => s.text[n] || n;
      // on(): against the ground, or against the plate when the surface would plate it.
      const on = n => contrast(theme.hex(n), s.plate && contrast(theme.hex(n), g) < ACCENT_MIN ? theme.hex(s.plate) : g);
      rows.push({ surface: s.id, ground: g, plate: s.plate || '', text: contrast(theme.hex(t('ink')), g), accent: on(t('blue')), pill: contrast(theme.hex(theme.inkOn(s.fill.ink || 'ink')), theme.hex(s.fill.ink || 'ink')), green: contrast(TOKENS.green, s.plate && contrast(TOKENS.green, g) < ACCENT_MIN ? theme.hex(s.plate) : g), red: contrast(TOKENS.red, s.plate && contrast(TOKENS.red, g) < ACCENT_MIN ? theme.hex(s.plate) : g) });
    });
    rows.push({ surface: 'caption', ground: theme.hex(theme.caption.fill), text: contrast(theme.hex(theme.caption.ink), theme.hex(theme.caption.fill)), accent: theme.caption.mode === 'text' ? contrast(TOKENS.yellow, theme.hex(theme.caption.fill)) : contrast(TOKENS.ink, TOKENS.yellow) });
    return rows;
  }

  // ─── Reels Studio v3: the four styles ───────────────────────────────────
  // A style is a locked template system on the one ES frame: which blocks it
  // may use and in what order, its media mix, pacing, motion and default
  // voice and music. The look it draws with (ground, pills, wipe) is internal:
  // every style keeps the ES type scale, pills, colours, mark and end card.
  //   media.clips / media.photos: the share of scenes (0-1) that carry a
  //   verified clip / photo; clipsMin is the floor a Game Tape reel needs.
  //   pacing: beat lengths in ms (the voiceover still sets the real length).
  //   previewPlan: a small plan the style cards loop (reference topics, no media).
  const STYLE_IDS = ['gametape', 'statcard', 'receipts', 'hypecut'];
  const DEFAULT_STYLE = 'receipts';
  const ep = (beats, extra = {}) => ({ format: 'explainer', style: 'es', sourceLine: 'Source: Pro Football Reference', ...extra, beats: beats.map((b, i) => ({ id: `b${i + 1}`, vo: '', emphasis: '', photo: '', ...b })) });
  const STYLES = {
    gametape: {
      id: 'gametape', label: 'Game Tape', blurb: 'Video-first: verified game clips with short type over them.',
      look: 'tape', blocks: ['hook', 'clipLabel', 'statement', 'statTiles', 'tagPill', 'endcard'],
      order: ['hook', 'clipLabel', 'statement', 'clipLabel', 'statTiles', 'clipLabel', 'endcard'], max: { statTiles: 1, tagPill: 1 },
      media: { clips: 0.9, photos: 0.1, clipsMin: 0.8 }, pacing: { hookMs: 3000, beatMinMs: 2000, beatMaxMs: 3600, tailMs: 200 },
      motion: 'standard', kinetic: false, voice: { tone: 'energetic' }, music: 'hype',
      previewPlan: ep([
        { kind: 'hook', vo: 'George Kittle tore his Achilles on January 11.', block: { type: 'hook', pills: [{ text: 'KITTLE TORE', color: 'ink' }, { text: 'HIS ACHILLES', color: 'blue' }] } },
        { kind: 'point', vo: 'The best tight end in football.', block: { type: 'clipLabel', text: 'GEORGE KITTLE', sub: 'SAN FRANCISCO · TE' } },
        { kind: 'point', vo: 'Back to back years as the top graded tight end.', block: { type: 'statTiles', title: 'BACK TO *BACK*', tiles: [{ value: '92.6', label: '2024 TE GRADE', tone: 'blue' }, { value: '90.4', label: '2025 TE GRADE', tone: 'ink' }] } },
        { kind: 'cta', block: { type: 'endcard' } },
      ], { sourceLine: 'Source: PFF' }),
    },
    statcard: {
      id: 'statcard', label: 'Stat Card', blurb: 'Player cards and stat tiles that build on screen.',
      look: 'paper', blocks: ['hook', 'photoCard', 'statTiles', 'streak', 'rankTile', 'tagPill', 'statement', 'compare', 'number', 'endcard'],
      order: ['hook', 'photoCard', 'statTiles', 'rankTile', 'streak', 'statement', 'endcard'], max: { photoCard: 3 },
      media: { clips: 0, photos: 0.6, clipsMin: 0 }, pacing: { hookMs: 3000, beatMinMs: 2600, beatMaxMs: 5000, tailMs: 260 },
      motion: 'standard', kinetic: false, voice: { tone: 'steady' }, music: 'tension',
      previewPlan: ep([
        { kind: 'hook', vo: "Aaron Rodgers' 2011 has no twin.", block: { type: 'hook', kicker: 'STAT TWIN · EP. 10', pills: [{ text: "RODGERS' 2011", color: 'ink' }, { text: 'HAS NO TWIN', color: 'blue' }] } },
        { kind: 'point', vo: '45 touchdowns, 6 interceptions.', block: { type: 'photoCard', title: "RODGERS' *2011*", label: '2011 · GB', scan: true, tiles: [{ value: '45', label: 'TD', tone: 'blue' }, { value: '6', label: 'INT', tone: 'ink' }] } },
        { kind: 'point', vo: 'And a 15 and 1 season.', block: { type: 'streak', title: '2011 · *GREEN BAY*', items: 'WWWWWWWWWWWWWLWW', label: '15-1' } },
        { kind: 'cta', block: { type: 'endcard' } },
      ]),
    },
    receipts: {
      id: 'receipts', label: 'Receipts', blurb: 'Pure motion graphics: numbers, dots and bars, no footage needed.',
      look: 'paper', blocks: ['hook', 'statement', 'statTiles', 'dotGrid', 'compare', 'streak', 'rankTile', 'tagPill', 'quote', 'number', 'dots', 'endcard'],
      order: ['hook', 'dotGrid', 'statTiles', 'compare', 'statement', 'endcard'], max: {},
      media: { clips: 0, photos: 0, clipsMin: 0 }, pacing: { hookMs: 3000, beatMinMs: 2800, beatMaxMs: 5500, tailMs: 300 },
      motion: 'standard', kinetic: false, voice: { tone: 'steady' }, music: 'calm',
      previewPlan: ep([
        { kind: 'hook', vo: '67 Achilles tears since 2015.', block: { type: 'hook', pills: [{ text: '67 ACHILLES', color: 'ink' }, { text: 'TEARS', color: 'blue' }] } },
        { kind: 'dotrank', vo: '52 made it back. 26 got back to 90 percent.', block: { type: 'dotGrid', title: '*67* ACHILLES TEARS', total: 67, groups: [{ n: 26, tone: 'blue', label: 'BACK TO 90%' }, { n: 26, tone: 'ink', label: 'RETURNED' }, { n: 15, tone: 'grey', label: "DIDN'T RETURN" }] } },
        { kind: 'stat', vo: '52 made it back. 26 got back to 90 percent.', block: { type: 'statTiles', title: 'THE *OLD LEVEL*', tiles: [{ value: '52', label: 'MADE IT BACK', tone: 'ink' }, { value: '26', label: 'BACK TO 90%', tone: 'blue' }] } },
        { kind: 'cta', block: { type: 'endcard' } },
      ], { sourceLine: 'Source: ES research' }),
    },
    hypecut: {
      id: 'hypecut', label: 'Hype Cut', blurb: 'Fast kinetic type over clips, stamps and quick stat pops.',
      look: 'bold', blocks: ['hook', 'statement', 'tagPill', 'statTiles', 'clipLabel', 'endcard'],
      order: ['hook', 'statement', 'clipLabel', 'statement', 'statTiles', 'endcard'], max: { statTiles: 2 },
      media: { clips: 0.6, photos: 0.2, clipsMin: 0 }, pacing: { hookMs: 2400, beatMinMs: 1400, beatMaxMs: 2600, tailMs: 120 },
      motion: 'punchy', kinetic: true, voice: { tone: 'hype' }, music: 'hype',
      previewPlan: ep([
        { kind: 'hook', vo: 'Green Bay, 2011.', block: { type: 'hook', pills: [{ text: '2011', color: 'ink' }, { text: 'GREEN BAY', color: 'blue' }], stamp: { text: 'UNREAL' } } },
        { kind: 'point', vo: '45 touchdowns. 6 picks.', block: { type: 'statement', lines: [{ text: '45 TD.', color: 'ink' }, { text: '*6 INT.*', color: 'ink' }] } },
        { kind: 'stat', vo: 'Fifteen and one.', block: { type: 'statTiles', tiles: [{ value: '15-1', label: 'RECORD', tone: 'blue' }] } },
        { kind: 'cta', block: { type: 'endcard' } },
      ]),
    },
  };
  const isStyle = id => STYLE_IDS.includes(id);
  const getStyle = id => STYLES[isStyle(id) ? id : DEFAULT_STYLE];
  const slug = v => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // Retired looks and recipes (Reels 2.0), and their labels, on a v3 style.
  const LEGACY_DECISIVE = {
    data: 'receipts', 'data-led': 'receipts', 'stat-drop': 'receipts', 'money-story': 'receipts', versus: 'receipts',
    photo: 'statcard', 'photo-led': 'statcard',
    bold: 'hypecut', countdown: 'hypecut', hype: 'hypecut',
  };
  const LEGACY_SOFT = ['paper', 'ink', 'blue', 'team', 'team-colour', 'team-color', 'minimal', 'quote', 'quote-reaction', 'explainer', 'fan-pulse', 'verdict', 'es', 'classic', 'series'];
  // A plan has clips when any scene carries one (or the plan says so).
  function hasClips(plan) {
    const p = plan || {};
    if (p.hasClips || (Array.isArray(p.clips) && p.clips.length)) return true;
    return (Array.isArray(p.beats) ? p.beats : []).some(b => b && (b.clip || b.clipId || (b.media && b.media.kind === 'clip') || (b.pick && b.pick.kind === 'clip') || b.visual === 'clip'));
  }
  // legacyStyle(look, recipe, plan): the v3 style an old reel opens in.
  function legacyStyle(look, recipe, plan) {
    const r = slug(recipe);
    const l = slug(look);
    if (isStyle(r)) return r;
    if (isStyle(l)) return l;
    if (LEGACY_DECISIVE[r]) return LEGACY_DECISIVE[r];
    if (LEGACY_DECISIVE[l]) return LEGACY_DECISIVE[l];
    void LEGACY_SOFT;
    return hasClips(plan) ? 'gametape' : 'receipts';
  }
  // styleOf(plan): the plan's v3 style (plan.reelStyle, or plan.style when it
  // is one of the four), else the closest style for its old look / recipe.
  function styleOf(plan) {
    const p = plan || {};
    if (isStyle(p.reelStyle)) return p.reelStyle;
    if (isStyle(p.style)) return p.style;
    return legacyStyle(p.look, p.recipe, p);
  }
  // The internal look a style draws with.
  const lookForReelStyle = id => getStyle(id).look;

  return {
    TOKENS, SIGNALS, SIGNAL_MEANING, NEUTRALS, GROUNDS, TEXT_MIN, ACCENT_MIN,
    LOOKS, LOOK_IDS, DEFAULT_LOOK, LAYOUTS, MOTIONS, MOTION_LIMITS, SURFACES, LEGACY_STYLE_LOOKS,
    STYLES, STYLE_IDS, DEFAULT_STYLE, isStyle, getStyle, styleOf, legacyStyle, hasClips, lookForReelStyle,
    lookId, lookForStyle, teamCarriesText, resolve, validateLook, contrastMatrix, teamSurface, inkOn, contrast, luminance, blend,
  };
}));
