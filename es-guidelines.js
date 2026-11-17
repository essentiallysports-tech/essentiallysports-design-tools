// ES design guidelines, machine-readable. One file for the server (require)
// and the browser (window.ESGuidelines).
//
// Extracted on 2026-11-18 from the guide images in the repo root, the
// guideline pages in index.html (#logo-guidelines, #social-guidelines,
// #video-guidelines), frameup-rules.js, the Generate templates
// (netlify/functions/es-generate.js TEMPLATES, frameup-spec.js) and
// project-docs/es-designer-brand-design-guide.md. Every rule names its source.
//   SM-nn  social-media-guide-nn.webp   (Creative Media Guide)
//   BL-nn  brand-logo-guide-nn.webp     (Brand / Logo guide)
//   VB-nn  video-brand-guide-nn.webp    (Video brand guide)
//   CODE   enforced by the templates / checker already
// unclear: true marks anything the images do not say confidently; those are
// listed in UNCLEAR at the bottom for Suhail to confirm.
//
// What the creative director may vary is only what the ES templates expose:
// the template, the words, the team (its brand-kit pill palette), the photo.
// Fonts, colours, logo, mist, safe areas and the swipe button come from the
// templates, so an off-guide font, colour or layout cannot be produced.
(function (root, factory) {
  const spec = factory(typeof module === 'object' && module.exports ? require('./frameup-rules.js') : root.FrameUpRules);
  if (typeof module === 'object' && module.exports) module.exports = spec;
  else root.ESGuidelines = spec;
}(typeof self !== 'undefined' ? self : this, RULES => {
  'use strict';

  const VERSION = '2026-11-18';

  const CANVAS = {
    social: { width: 1080, height: 1350, source: 'SM-03' },
    shortForm: { width: 1080, height: 1920, source: 'VB-04' },
    youtube: { width: 1280, height: 720, source: 'project-docs/es-designer-brand-design-guide.md §12' },
  };

  const FONTS = {
    headline: { family: 'Acumin Pro Condensed', weight: 'Black', source: 'SM-07 ("Brand font for headlines")' },
    pillsAllowed: { families: ['Acumin VF', 'Roboto Condensed'], source: 'SM-07 §4 ("Only Acumin VF and Roboto Condensed are permitted inside pills")' },
    subtitles: { family: 'Acumin Pro Condensed', weight: 'Black', source: 'VB-05 §2' },
    casing: { rule: 'Post text is set uppercase by the templates (pills, quotes, stat labels)', source: 'CODE (frameup-rules.js FIT upper:true); SM-06..08 examples' },
  };

  const COLORS = {
    esBlue: { hex: '#0A7DFA', source: 'BL-02' },
    black: { hex: '#000000', source: 'BL-02' },
    white: { hex: '#FFFFFF', source: 'BL-02' },
    esNavy: { hex: '#033162', source: 'project-docs/es-designer-brand-design-guide.md §2', unclear: true },
    teamPalettes: { rule: 'Pills, mist and highlight text use the team\'s official brand-kit colours (brand-kit.js palette pairs: background / foreground / mist)', source: 'SM-04, SM-06, CODE (brand-kit.js)' },
  };

  const LOGO = {
    variants: {
      primary: ['blue (white type on #0A7DFA)', 'black (white on #000000)', 'blue reverse (#0A7DFA on white)', 'outlined (white type, white outline)'],
      secondary: 'stacked ESSENTIALLY / SPORTS, same four colourways',
      tertiary: 'ES mark, same four colourways',
      source: 'BL-02, BL-03, BL-04',
    },
    sizes: { mark: '122×104px', wordmark: '417×49px', videoIcon: '48×42px', source: 'SM-02, VB-02' },
    clearSpace: { px: 50, source: 'SM-02, BL-05' },
    placement: {
      noSwipe: 'top-right', withSwipe: 'top-left', video: 'top-right, 50px from the edges', subBrand: 'ES mark top-left of the lockup at 50% or 65% of its width',
      source: 'SM-02, VB-02, BL-07',
    },
  };

  const SAFE_AREA = { px: RULES ? RULES.SAFE_AREA : 50, rule: '50px on every side of the 1080×1350 canvas', source: 'SM-03, SM-05, SM-08, SM-10' };

  const SWIPE = { size: '200×56px', position: 'bottom-right, 50px from the right and bottom edges', look: 'SWIPE >> in the ES box style (grey or white), Acumin', source: 'SM-11' };

  const MIST = { opacity: 0.9, rule: 'Stats posts use mist in the team\'s official colour at 90% opacity; never black mist on stats', source: 'SM-04, SM-05' };

  // The ES templates Generate may use (the director picks only from these).
  const TEMPLATES = ['cover', 'quote', 'long-quote', 'double-entity-quote', 'stats-single-ent', 'stats-double-ent', 'listicle-type-1', 'listicle-type-2', 'player-stat-line', 'team-record'];

  // ─── Rules (id, level, what, source, how it is enforced) ────────────────
  // level: must (hard gate / never produced) | should (critique, warning)
  // enforced: template (the ES template makes it impossible to break),
  //           check (the Guideline check gates it in code), review (critique only)
  const RULE_LIST = [
    // Logo
    { id: 'logo-placement', level: 'must', area: 'logo', rule: 'ES logo top-right; top-left when a swipe button is present. Placement never changes for design preference.', source: 'SM-02', enforced: 'template' },
    { id: 'logo-clear-space', level: 'must', area: 'logo', rule: '50px clear space on every side of the logo; nothing enters it.', source: 'SM-02, BL-05', enforced: 'template' },
    { id: 'logo-size', level: 'must', area: 'logo', rule: 'Logo mark 122×104px, wordmark 417×49px; never stretched, compressed, skewed or below minimum size.', source: 'SM-02, BL-06', enforced: 'template' },
    { id: 'logo-colours', level: 'must', area: 'logo', rule: 'Only the blue, black, blue-reverse and white-outlined logo colourways. No other colours, gradients or textures.', source: 'BL-02, BL-06', enforced: 'template' },
    { id: 'logo-no-effects', level: 'must', area: 'logo', rule: 'No shadows, effects, rotation, re-typesetting or rounded/altered containers on the logo.', source: 'BL-06; index.html Logo FAQ', enforced: 'template' },
    { id: 'logo-contrast', level: 'must', area: 'logo', rule: 'Never place the logo over an image area without contrast.', source: 'BL-06', enforced: 'template' },
    // Layout
    { id: 'canvas-size', level: 'must', area: 'layout', rule: 'Instagram creative is 1080×1350px.', source: 'SM-03', enforced: 'template' },
    { id: 'safe-area', level: 'must', area: 'layout', rule: 'All text and key visuals stay inside the 50px safe area.', source: 'SM-03, SM-05, SM-08', enforced: 'template' },
    { id: 'es-template', level: 'must', area: 'layout', rule: 'Use an ES template (Cover, Quote, Long Quote, Two-Person Quote, Player Stats, Head-to-Head, Rankings Table, Ranked List, Player Stat Line, Team Record / Score). No free-form layouts.', source: 'CODE (es-generate.js TEMPLATES); SM-08, SM-10 examples', enforced: 'check' },
    { id: 'headline-bottom', level: 'should', area: 'layout', rule: 'Headline pills sit low on the canvas over the mist, inside the safe area.', source: 'SM-08, SM-10', enforced: 'template' },
    // Type
    { id: 'font-family', level: 'must', area: 'type', rule: 'Headlines in Acumin Pro Condensed Black; only Acumin VF and Roboto Condensed inside pills. No other fonts (no wide or rounded grotesques, no scripts).', source: 'SM-07', enforced: 'template' },
    { id: 'no-outlined-type', level: 'must', area: 'type', rule: 'No outlined / stroked or hollow headline type; pill text is solid in the team highlight colour.', source: 'SM-06, SM-07 (solid pill text only); BL-06 (no effects)', enforced: 'template', unclear: true },
    { id: 'type-hierarchy', level: 'should', area: 'type', rule: 'Font weight and styling stay consistent with the headline hierarchy.', source: 'SM-07 §4', enforced: 'template' },
    { id: 'uppercase', level: 'should', area: 'type', rule: 'Post headlines and pills are uppercase.', source: 'CODE (FIT upper:true); SM-06..10 examples', enforced: 'template' },
    // Pills
    { id: 'pill-system', level: 'must', area: 'pills', rule: 'Headlines are broken into pills with equal gaps and consistent pill sizes; container start/end align with the text.', source: 'SM-06, SM-07 §6', enforced: 'template' },
    { id: 'pill-text-colour', level: 'must', area: 'pills', rule: 'Pill text colour is the team\'s highlight colour.', source: 'SM-06', enforced: 'template' },
    { id: 'pill-contrast', level: 'must', area: 'pills', rule: 'A pill background never matches its container colour; contrast is mandatory.', source: 'SM-06, SM-07 §5', enforced: 'template' },
    { id: 'pill-layout', level: 'should', area: 'pills', rule: 'Pills feel dynamic and balanced, not crowded, rigid or staggered.', source: 'SM-06 §1, SM-07 §6', enforced: 'template', unclear: true },
    // Colour
    { id: 'team-palette', level: 'must', area: 'colour', rule: 'Colours come from the team\'s official brand-kit palette (or the neutral ES look when no team); no off-palette accent colours.', source: 'SM-04, SM-06; CODE (brand-kit.js)', enforced: 'check' },
    { id: 'mist-team-colour', level: 'must', area: 'colour', rule: 'Stats posts carry mist in the team\'s official colour at 90% opacity; no black mist on stats.', source: 'SM-04, SM-05', enforced: 'template' },
    { id: 'mist-opacity', level: 'must', area: 'colour', rule: 'Mist overlays are always 90% opacity; never altered for style.', source: 'SM-04', enforced: 'template' },
    // Images
    { id: 'image-subject', level: 'must', area: 'image', rule: 'The subject is the main focal point: sharp, well lit, separated from the background, no competing focal points.', source: 'SM-09 §1', enforced: 'review' },
    { id: 'image-framing', level: 'should', area: 'image', rule: 'Crop keeps the subject dominant without feeling cramped; minimal, intentional negative space; eyes face into the frame.', source: 'SM-09 §2', enforced: 'review' },
    { id: 'image-real-photo', level: 'must', area: 'image', rule: 'Real ES photos of the subject; no generated realistic athletes, no stylised halftone/cut-out treatments outside the templates.', source: 'CODE (Generate photo rules); SM-09, SM-10', enforced: 'template', unclear: true },
    // Swipe
    { id: 'swipe-button', level: 'must', area: 'swipe', rule: 'Swipe button bottom-right, 50px from the right and bottom, fixed 200×56px, unobstructed.', source: 'SM-11', enforced: 'template' },
    // Voice (frameup-rules.js)
    { id: 'voice', level: 'must', area: 'copy', rule: 'Punchy, confident, plain American sports English; covers are hooks (a bold claim or a question in 2-8 words).', source: 'CODE (frameup-rules.js VOICE)', enforced: 'check' },
    { id: 'banned-words', level: 'must', area: 'copy', rule: 'No emojis, hashtags, links, "Breaking", hype words, repeated !! or ??, CTAs or profanity on the design.', source: 'CODE (frameup-rules.js BANNED)', enforced: 'check' },
    { id: 'real-facts', level: 'must', area: 'copy', rule: 'Every number, quote and result comes from the brief, the source design or ES research. Stats use real stat labels.', source: 'CODE (_lint-spec.js)', enforced: 'check' },
    { id: 'text-fit', level: 'must', area: 'copy', rule: 'Text fits the template at a readable size (shorter lines sit bigger).', source: 'CODE (frameup-rules.js FIT)', enforced: 'check' },
  ];
  // Composed designs (Generate "Creative", owner request 2026-11-19: "make new
  // things, not just an image with text on it"). Free composition inside the
  // brand: frameup-compose.js builds from proven archetypes, and its checkScene
  // gate and renderer enforce these in code. Kept apart from RULE_LIST so the
  // template checks and the on-brand critique are unchanged.
  const COMPOSED_RULES = [
    { id: 'composed-archetype', level: 'must', area: 'composed', rule: 'A composed design is built from an ES composition archetype (hero cut-out + number, prize focus, big number, split screen, magazine cover, scoreboard, by the numbers, compare bars, quote + portrait, typographic, collage strip, duotone hero, record badge, unit chart).', source: 'Owner 2026-11-19; frameup-compose.js ARCHETYPES', enforced: 'check' },
    { id: 'composed-fonts', level: 'must', area: 'composed', rule: 'Only Acumin Pro Condensed (display), Roboto Condensed (labels, pills) and Roboto (body). No stroked or outlined type.', source: 'SM-07; frameup-compose.js checkScene', enforced: 'check' },
    { id: 'composed-palette', level: 'must', area: 'composed', rule: 'Every colour comes from the team brand-kit / logo-library colours, a league or ES golf kit, or the ES colours, plus their shades. Off-palette colours snap to the nearest allowed colour.', source: 'SM-04, SM-06; frameup-compose.js checkScene', enforced: 'check' },
    { id: 'composed-logo', level: 'must', area: 'composed', rule: 'The ES mark is never a free layer: it is drawn last, 122x104, 50px in, top-right (top-left with a swipe button), black when the area under it is ES blue.', source: 'SM-02, BL-02, BL-06; frameup-compose.js render', enforced: 'template' },
    { id: 'composed-safe-area', level: 'must', area: 'composed', rule: 'Text, numbers, pills and charts stay inside the 50px safe area and out of the logo clear space.', source: 'SM-03, SM-02; frameup-compose.js checkScene', enforced: 'check' },
    { id: 'composed-numbers', level: 'must', area: 'composed', rule: 'Every number on a composed design (and every unit chart) is a fact from the brief or cited ES research.', source: 'CODE (_composer.js, checkScene)', enforced: 'check' },
    { id: 'composed-cutout', level: 'must', area: 'composed', rule: 'Cut-outs are real ES photos of the person the brief names; the mask is applied to the original pixels. Never generated or altered athletes.', source: 'Owner 2026-11-19; remove-bg.js likeness rule', enforced: 'check' },
    { id: 'composed-ai-art', level: 'must', area: 'composed', rule: 'AI art is backgrounds and objects only (trophies, balls, stadium light, money, weather, motion): never people, faces, jerseys, logos or text.', source: 'Owner 2026-11-19; _asset-service.js never-people guard', enforced: 'check' },
  ];
  const RULES_BY_ID = Object.fromEntries([...RULE_LIST, ...COMPOSED_RULES].map(rule => [rule.id, rule]));

  // Anything the images do not say confidently (for Suhail to confirm).
  const UNCLEAR = [
    { id: 'mist-example-label', note: 'SM-04 labels the example "DENVER BRONCOS" but shows the Lakers logo and colours (#552C81 / #FCB724).' },
    { id: 'pill-layout', note: 'SM-06 says avoid aligning all pills in one straight line; SM-07 §6 says layouts should feel structured, not staggered. How much offset is right?' },
    { id: 'no-outlined-type', note: 'No guide image bans outlined/stroked headline type in words; it follows from SM-06/07 (solid pill text) and BL-06 (no effects on the logo). Confirm it is off-guide.' },
    { id: 'image-real-photo', note: 'No guide image covers halftone or cut-out photo treatments; inferred from SM-09/10 (sharp real photo, subject dominant).' },
    { id: 'logo-rounded', note: 'BL-02..04 show square logo containers only; a rounded ES app-icon style mark is treated as off-guide.' },
    { id: 'pill-numbering', note: 'SM-07 numbers its sections 4-6 after SM-06\'s 1-2; section 3 is missing from the images.' },
    { id: 'logo-incorrect-10', note: 'BL-06, last example (blue box with wide padding) is captioned "do not use the logo against any gradient or textures", the same as example 2. Probably "do not change the container padding".' },
    { id: 'es-navy', note: '#033162 (ES Navy) comes from the UI brand doc, not from the post guides.' },
  ];

  // ─── Short lines for prompts ─────────────────────────────────────────────
  // The director plans inside these; the vision critique cites these ids.
  function directorLines() {
    return [
      'ES design rules (fixed by the templates; plan only inside them):',
      '- Only ES templates (Cover, Quote, Long Quote, Two-Person Quote, Player Stats, Head-to-Head, Rankings Table, Ranked List, Player Stat Line, Team Record / Score); no free-form layouts, carousel art or custom slides.',
      '- Type is Acumin Pro Condensed Black, uppercase, in solid pills: no other fonts, no outlined or stroked type.',
      '- Colours are the team\'s official brand-kit palette (pills, highlight text, 90% mist); no off-palette accent words or colours.',
      '- ES logo top-right (top-left with a swipe button), 50px clear space and safe area; never moved or restyled.',
      '- Real ES photos with the subject dominant; no halftone, cut-out or generated athletes.',
    ];
  }

  // The same rules for the Creative art director (composed designs).
  function composedLines() {
    return [
      'ES rules for composed designs (enforced in code; plan inside them):',
      '- Fonts: Acumin Pro Condensed for display, Roboto Condensed for labels; no outlined or stroked type.',
      '- Colours: the team\'s official colours (or the league / ES golf kit / ES colours) and their shades only.',
      '- The ES logo is placed for you (top-right, 50px in); never ask for it, never put text in its corner.',
      '- 50px safe area on every side.',
      '- Cut-outs only from real ES photos of the person the brief names; AI art is objects and places, never people, faces, jerseys, logos or text.',
      '- Every number is a fact from the brief (by id).',
    ];
  }

  function critiqueRulesText() {
    return RULE_LIST.map(rule => `- ${rule.id} [${rule.level}] ${rule.rule} (${rule.source})`).join('\n');
  }

  // ─── The Guideline check (hard gate, code only) ──────────────────────────
  // Runs on every Generate design after the brand checker (_lint-spec.js).
  // Returns { ok, errors, fixes, passed }: errors drop the design; fixes are
  // automatic corrections, listed on the card ("On-brand: fixed ...").
  // ctx: { lint (lintSpec result), brandKit (array), templates (object) }.
  const STYLE_KEYS = /^(?:font|fontFamily|fontWeight|color|colour|background|backgroundColor|stroke|outline|textStroke|gradient|shadow|halftone|layout|x|y|left|top|rotate)$/i;
  function stripStyleKeys(value, path = '', found = []) {
    if (Array.isArray(value)) value.forEach((item, i) => stripStyleKeys(item, `${path}[${i}]`, found));
    else if (value && typeof value === 'object') {
      Object.keys(value).forEach(key => {
        if (STYLE_KEYS.test(key)) {
          found.push(`${path}${path ? '.' : ''}${key}`);
          delete value[key];
        } else stripStyleKeys(value[key], `${path}${path ? '.' : ''}${key}`, found);
      });
    }
    return found;
  }

  function checkDesign(spec, ctx = {}) {
    const errors = [];
    const fixes = [];
    const passed = [];
    const templates = ctx.templates || null;
    const brandKit = Array.isArray(ctx.brandKit) ? ctx.brandKit : [];
    const fail = (rule, msg) => errors.push({ rule, msg, source: RULES_BY_ID[rule]?.source || '' });
    if (!spec || typeof spec !== 'object') return { ok: false, errors: [{ rule: 'es-template', msg: 'not a design', source: '' }], fixes, passed };

    // es-template: only ES templates.
    if (!TEMPLATES.includes(spec.postType) || (templates && !templates[spec.postType])) fail('es-template', `"${spec.postType}" is not an ES template`);
    else passed.push('es-template');

    // Fonts / colours / layout can never be set by the AI: strip any style key.
    const stripped = [...stripStyleKeys(spec.fields), ...(spec.alts || []).flatMap(alt => stripStyleKeys(alt?.fields))];
    if (stripped.length) fixes.push({ rule: 'font-family', what: `removed style overrides (${stripped.slice(0, 3).join(', ')})` });
    passed.push('font-family', 'logo-placement', 'safe-area', 'swipe-button', 'mist-opacity');

    // team-palette: a team must be in the brand kit (else neutral ES look);
    // paletteIdx must be one of that team's palette pairs.
    // ctx.resolveTeam (the checker's findTeam) maps "Kansas City Chiefs" to the kit's "CHIEFS".
    const resolved = typeof ctx.resolveTeam === 'function' ? (ctx.resolveTeam(spec.sport, spec.team) || ctx.resolveTeam('', spec.team) || spec.team) : spec.team;
    const named = item => (item.variation || item.team) === resolved;
    const entry = spec.team ? (brandKit.find(item => named(item) && item.sport === spec.sport) || brandKit.find(named)) : null;
    if (spec.team && brandKit.length && !entry) {
      fixes.push({ rule: 'team-palette', what: `"${spec.team}" has no ES brand colours; the neutral ES look is used` });
      spec.team = '';
    }
    if (spec.paletteIdx != null) {
      const size = entry?.palette?.length || 0;
      if (!Number.isInteger(spec.paletteIdx) || spec.paletteIdx < 0 || spec.paletteIdx >= size) {
        fixes.push({ rule: 'team-palette', what: 'reset an off-palette colour choice to the team\'s primary pair' });
        delete spec.paletteIdx;
      }
    }
    passed.push('team-palette');

    // mist-team-colour: stats posts want a team (its mist); warn-only fix note.
    if (['stats-single-ent', 'stats-double-ent', 'player-stat-line', 'team-record'].includes(spec.postType) && !spec.team) {
      fixes.push({ rule: 'mist-team-colour', what: 'no team found: pick the team so the mist uses its official colour' });
    }

    // Copy rules come from the brand checker (lintSpec): its errors are
    // guideline errors too; its automatic fixes are listed.
    const lint = ctx.lint;
    if (lint) {
      const map = { banned: 'banned-words', 'unsourced-number': 'real-facts', 'unsourced-quote': 'real-facts', 'bad-stat-label': 'real-facts', 'stat-mismatch': 'real-facts', 'too-long': 'text-fit', duplicate: 'voice' };
      (lint.errors || []).forEach(issue => fail(map[issue.code] || 'voice', issue.msg));
      (lint.warnings || []).forEach(warning => {
        if (warning.code === 'auto-split') fixes.push({ rule: 'text-fit', what: 'split long lines so the text stays big' });
      });
      if (lint.patch && 'team' in lint.patch && lint.patch.team !== spec.team) fixes.push({ rule: 'team-palette', what: lint.patch.team ? `team set to the brand-kit name "${lint.patch.team}"` : 'cleared a team that is not in the brand kit' });
      if (!(lint.errors || []).length) passed.push('banned-words', 'real-facts', 'text-fit', 'voice');
    }
    return { ok: !errors.length, errors, fixes, passed: [...new Set(passed)] };
  }

  // ─── Bring it on-brand: map a source design's slides to ES templates ─────
  // slides: [{ role, text, numbers: [{ value, label }], quote, entities }]
  // Returns [{ slide, template, why }]: what each slide becomes in ES form.
  const STAT_LABEL = RULES ? RULES.STAT_LABELS : /^(PTS|REB|AST|YDS|TD|INT|HR|RBI)$/i;
  function mapSlides(slides = []) {
    return (Array.isArray(slides) ? slides : []).slice(0, 10).map((slide, index) => {
      const role = String(slide?.role || '').toLowerCase();
      const numbers = Array.isArray(slide?.numbers) ? slide.numbers : [];
      const statNumbers = numbers.filter(n => STAT_LABEL.test(String(n?.label || '').trim()));
      const entities = Array.isArray(slide?.entities) ? slide.entities.filter(Boolean) : [];
      let template = 'cover';
      let why = 'a headline hook becomes an ES Cover (pills over a real photo)';
      if (slide?.quote && String(slide.quote).split(/\s+/).length > 8) { template = 'long-quote'; why = 'a full quote becomes an ES Long Quote'; }
      else if (slide?.quote) { template = 'quote'; why = 'a short quote becomes an ES Quote'; }
      else if (role === 'list' || entities.length >= 3) {
        template = numbers.length >= entities.length && entities.length >= 3 ? 'listicle-type-1' : 'listicle-type-2';
        why = 'a ranked list becomes an ES Rankings Table / Ranked List';
      } else if (numbers.some(n => /^\d{1,3}\s?[-–]\s?\d{1,3}$/.test(String(n?.value || '').trim())) && entities.length <= 2) {
        template = 'team-record'; why = 'a record or final score becomes an ES Team Record / Score';
      } else if (statNumbers.length >= 4) { template = 'player-stat-line'; why = 'a full stat line becomes an ES Player Stat Line'; }
      else if (statNumbers.length >= 3) { template = 'stats-single-ent'; why = 'three real stat numbers become ES Player Stats'; }
      else if (numbers.length) { template = 'cover'; why = 'numbers without game-stat labels (views, money, records) become a Cover hook, never a stats card'; }
      return { slide: index + 1, role: role || 'other', template, why };
    });
  }

  return {
    VERSION, CANVAS, FONTS, COLORS, LOGO, SAFE_AREA, SWIPE, MIST, TEMPLATES,
    RULES: RULE_LIST, RULES_BY_ID, UNCLEAR,
    COMPOSED_RULES, directorLines, composedLines, critiqueRulesText, checkDesign, mapSlides, stripStyleKeys,
  };
}));
