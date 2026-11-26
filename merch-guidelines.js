// Merch Designs: the ES merch design guidelines the AI follows (browser:
// window.MerchGuidelines; server and tests: require). No DOM, no network.
//
//   BASIC_SYSTEM   the system prompt for Basic (pills only, Haiku).
//   PRO_SYSTEM     the system prompt for Pro (art director, Sonnet): Basic's
//                  rules plus richer layouts, trend use and up to 3 elements.
//   proSystem() / basicSystem()  the same, built on demand (count, refine).
//   SUMMARY        short bullets for the page ("The AI follows these rules").
//   ICONS / ELEMENT_TYPES / ELEMENT_RULES / LIMITS  what the server accepts.
//   contrastIssues(concept) / repairContrast(concept)  the colour rule in code.
//
// Owner decisions (merch4, 2026-11-26): Basic = ES pills only; Pro may add
// simple elements beside the pills; rights = allow names, nicknames, exact
// quotes and team colours with an acknowledgement; team logos, league marks and
// "official" are blocked; every number and quote must be in the source.
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./frameup-rules.js') : root.FrameUpRules);
  if (isNode) module.exports = api;
  else root.MerchGuidelines = api;
}(typeof self !== 'undefined' ? self : this, (FrameUpRules) => {
  'use strict';

  const VERSION = '2026-11-26-merch5';

  // ─── What the server accepts (same lists as MerchPrint.ICONS / ELEMENT_TYPES) ──
  // Original simple shapes drawn by the engine; never league or team marks.
  const ICONS = Object.freeze(['star', 'crown', 'flame', 'bolt', 'trophy', 'arrow', 'basketball', 'football', 'baseball', 'soccer', 'hockey', 'golf', 'tennis', 'racing-flag']);
  const ELEMENT_TYPES = Object.freeze(['number', 'rule', 'block', 'icon']);
  const ELEMENT_COLORS = Object.freeze(['a', 'b', 'ink', 'white', 'black']);
  // Per type: the allowed positions and the extra fields with their allowed values.
  const ELEMENT_RULES = Object.freeze({
    number: { positions: ['behind', 'above'], style: ['solid', 'outline'] },
    rule: { positions: ['above', 'below', 'between'], weight: ['thin', 'thick'] },
    block: { positions: ['behind'] },
    icon: { positions: ['above', 'below', 'left'] },
  });
  const COLLECTIONS = Object.freeze(['replay', 'nickname', 'quote', 'core', 'current']);
  const SIZES = Object.freeze(['big', 'mid', 'small']);
  // Row colour keys; a row may also carry a '#RRGGBB' hex the person picked.
  const ROW_COLORS = Object.freeze(['a', 'b', 'ink', 'white', 'black']);
  const HEX_RE = /^#[0-9a-f]{6}$/i;
  const isHex = v => HEX_RE.test(String(v || ''));
  const LIMITS = Object.freeze({
    rows: 10, rowText: 60, elements: 3, numberDigits: 2,
    basicConcepts: 4, proConcepts: 6, instruction: 300, history: 4,
    contrastBox: 2.0, contrastInk: 2.4,
    fitScaleMin: 0.6, fitScaleMax: 1.6, fitTopMinIn: 0.5, fitTopMaxIn: 10,
  });

  const VOICE = (FrameUpRules && FrameUpRules.VOICE) || [];

  // ─── The guidelines, in plain words (one source for the prompts and the page) ──
  const PILL = [
    'THE ES PILL. Every design is a stack of ES pills: Acumin Post 900 (heavy condensed), ALL CAPS, no letter-spacing, each line on a solid, sharp-cornered box (no rounded corners, no outlines, no gradients, no shadows).',
    'Rows stack with no gaps between them. Same-colour rows overlap slightly like the ES editor; different colours touch. Each row is its own box, as wide as its words.',
    'Three sizes: "big" (the headline row), "mid" (0.62 of big, for a supporting line) and "small" (a name, a date line, an attribution). Most designs are big rows; mid and small are for hierarchy.',
    'Short rows print bigger: aim for 3 to 16 characters a row; one to three words a pill. Split long lines at natural breaks, never mid-name.',
  ];
  const COLLECTION_RULES = [
    'COLLECTIONS. "replay": a moment or era fans relive. "nickname": the almost-famous nickname real fans use. "quote": in their own words, an exact quote from the source, then a small row "— Name". "core": ES itself (ESSENTIALLY / SPORTS, WE CENTER / FANS). "current": this week\'s story, while it is hot.',
  ];
  const LAYOUTS = [
    'LAYOUTS THAT WORK (vary them across a set):',
    '- Stacked words: one word per big pill, left aligned, colours alternating a / b.',
    '- Centre stagger: two words a pill, centred, rows of different widths.',
    '- Big headline + mid lines: one big row, two or three mid rows under it.',
    '- Wide banner: the whole line in one or two long big rows, centred.',
    '- Knockout on team colour: a team-colour tee with white pills and team-colour text.',
    '- Compact chest: three to five short rows at a smaller fit (fit.scale 0.7).',
    '- Number-led: a number from the source as its own big row, words under it.',
  ];
  const COLOUR = [
    'COLOUR. Use the team palette: "a" is the main team colour, "b" the second, "ink" the text colour that reads on them; "white" is plain white and "black" plain black. Rows alternate a and b, or use one colour throughout for calm designs.',
    `Pills must stand off the tee: every box needs contrast of at least ${LIMITS.contrastBox} against the garment colour, and the text at least ${LIMITS.contrastInk} against its box. A row's fill and ink are never the same colour.`,
    'On dark tees (black, navy, team colours) use white pills with team-colour text for the second colour. On white tees use the team colours for the boxes. Never put a navy pill on a black tee or a yellow pill on a white tee without a stronger colour beside it.',
    'Garments: white, black, or a team colour. Give the garment as a hex and a plain name.',
  ];
  const RIGHTS = [
    'RIGHTS. Player names, nicknames, exact quotes and team colours are allowed (the person acknowledges them before anything goes to the shop): list every real person, nickname, quote and team you used in "rights".',
    'Never use team logos, league or event marks (NFL, NBA, MLB, NHL, WNBA, NCAA, PGA, UFC, NASCAR, FIFA, Super Bowl, World Series, Stanley Cup, March Madness, Final Four) or words that claim a licence (official, licensed, authentic, authorized, endorsed, ®, ™).',
  ];
  const FACTS = [
    'FACTS. Never invent numbers, scores, dates, records or quotes. Every number on the design must appear in the source. Quotes are copied word for word from the source and always attributed. If the source has no number or quote, the design has none.',
    'The person\'s own words matter most: the FIRST concept must use their main line in full, word for word, split across rows at natural breaks. Never cut a line short or drop the end of a sentence.',
  ];
  const BASIC_ONLY = [
    'BASIC MODE: pills only. Do not add numbers behind, rules, blocks, icons or any other element: the design is the stack of pills on the garment.',
  ];
  const PRO_ART = [
    'PRO MODE: you are the ES merch art director. First write a short plan: the idea (what the set is about) and the angle (why fans would wear it now). Then give each design a different layout from the list, a sharp title, an optional short "label" (2-3 words naming the layout), and a "why" in one line.',
    'Use the trend context (headlines from ES and other outlets) to choose the angle and the words fans already use. Headlines are facts you may quote only as they are written; angle ideas are suggestions, never facts.',
    'You may size and place a design with "fit": {"scale": 0.6-1.6, "topIn": inches from the top or null}. 1 is the default chest size; 0.7 is a compact chest print; 1.3 is a bold full front.',
  ];
  const ELEMENTS = [
    'PRO ELEMENTS (optional, beside the pills; solid ink, print-safe; at most 3 per design, and most designs need none or one). Colours use the keys a | b | ink | white | black.',
    '- number: {"type":"number","text":"1-2 digits that are in the source","style":"solid|outline","color":"a","position":"behind|above"}. A jersey number or a score that is in the source, big behind the stack or above it. Only when the number is the story.',
    '- rule: {"type":"rule","position":"above|below|between","color":"b","weight":"thin|thick"}. A straight bar to frame the stack or separate a headline from its attribution.',
    '- block: {"type":"block","position":"behind","color":"a"}. A solid patch behind the whole stack, for a badge look on a busy tee colour.',
    `- icon: {"type":"icon","name":"${ICONS.join('|')}","position":"above|below|left","color":"a"}. A simple original shape (a star, a crown, a ball for the sport). Never a team or league mark.`,
    'Use elements sparingly: at most half of the set, never two of the same type, and never an element that repeats what the words already say.',
  ];

  const SHAPE_BASIC = '{"concepts":[{"collection":"replay|nickname|quote|core|current","title":"short name","team":{"id":"slug","name":"Team"}|null,"palette":{"a":"#hex","b":"#hex","ink":"#hex"},"garment":{"color":"#hex","name":"White"},"stack":[{"text":"ROW","size":"big|mid|small","fill":"a|b|ink|white|black","ink":"a|b|ink|white|black"}],"align":"left|center","rights":[{"kind":"name|nickname|quote|team","text":"..."}],"why":"one line on why fans would wear it"}]}';
  const SHAPE_PRO = '{"plan":{"idea":"one line","angle":"one line"},"concepts":[{"collection":"...","title":"short name","label":"Big headline","team":{"id":"slug","name":"Team"}|null,"palette":{"a":"#hex","b":"#hex","ink":"#hex"},"garment":{"color":"#hex","name":"White"},"stack":[{"text":"ROW","size":"big|mid|small","fill":"a|b|ink|white|black","ink":"a|b|ink|white|black"}],"align":"left|center","fit":{"scale":1,"topIn":null},"elements":[{"type":"rule","position":"below","color":"b","weight":"thick"}],"rights":[{"kind":"name|nickname|quote|team","text":"..."}],"why":"one line"}]}';

  const HEAD = 'You design fan-first sports merch for EssentiallySports (ES). Answer with JSON only, no prose. Keep the JSON compact.';
  const ROWS = `Each design: 1 to ${LIMITS.rows} rows, each at most ${LIMITS.rowText} characters.`;

  function basicSystem() {
    return [HEAD, ...PILL, ...COLLECTION_RULES, ...LAYOUTS, ...COLOUR, ...RIGHTS, ...FACTS, ...BASIC_ONLY, ROWS, ...VOICE, `Shape: ${SHAPE_BASIC}`].join('\n');
  }
  function proSystem() {
    return [HEAD, ...PILL, ...COLLECTION_RULES, ...LAYOUTS, ...COLOUR, ...RIGHTS, ...FACTS, ...PRO_ART, ...ELEMENTS, ROWS, ...VOICE, `Shape: ${SHAPE_PRO}`].join('\n');
  }
  // The refine prompt: one design changed by a typed instruction.
  function refineSystem(mode = 'basic') {
    const pro = mode === 'pro';
    return [
      'You are the ES merch art director. You change ONE existing design the way the person asks and keep everything else. Answer with JSON only: {"concept":{...the whole design in the same shape...},"note":"one short line on what changed"}.',
      'Custom colours: a row\'s "fill" or "ink" may be an exact hex ("#RRGGBB") the person picked instead of a key. Keep every hex exactly as it is unless the instruction asks to change that row\'s colours; never turn a hex into a key. New rows use the keys.',
      'Keep the design\'s collection and its words unless the instruction asks to change them. Never add a number or quote that is not in the source; never add league marks, logos or "official". If the instruction asks for something the rules forbid, make the closest allowed change and say so in the note.',
      ...PILL, ...COLOUR, ...RIGHTS, ...FACTS.slice(0, 1),
      ...(pro ? [...PRO_ART.slice(2), ...ELEMENTS] : BASIC_ONLY),
      ROWS, ...VOICE,
    ].join('\n');
  }
  // The moments prompt: score trend headlines for merch.
  const MOMENTS_SYSTEM = [
    'You are the merch editor for EssentiallySports (ES): you turn this week\'s sports headlines into fan shirt ideas. ES shirts carry a short line in stacked condensed pills. Answer with JSON only.',
    'For each headline (by its key, e.g. "m3") return:',
    '- "kind": quote | nickname | moment | era | stat | rivalry.',
    '- "score" 0-100: would fans buy and wear a shirt about this THIS week? High: a quotable line, a nickname, a career moment, a rivalry, a streak or an era fans feel. Low: injuries, odds, fantasy, rankings, contracts, schedules, how-to-watch, celebrity or non-sports news.',
    '- "lines": exactly 3 shirt lines, each {"text","angle"}. text: 1-5 words, max 28 characters, the words fans would actually wear (fan voice, a chant, a nickname, a callback, a pun on the moment). angle: quote | nickname | chant | callback | pun | stat | rivalry | era. Make the 3 lines genuinely different. Numbers and quoted words ONLY if they appear in the headline. Never a player\'s full name alone as a line; never "official"; no league or event marks (NFL, NBA, Super Bowl…); no hype words, emojis or hashtags.',
    '- "why": 1-2 short sentences on why this would sell now (the feeling it taps, the timing), max 200 characters, plain words.',
    '- "audience": who buys it, max 60 characters (e.g. "Packers fans after a big home win").',
    '- "timing": now | week | season | evergreen (how long the shirt stays relevant).',
    '- "collection": replay | nickname | quote | current (the ES collection it fits).',
    'Shape: {"items":[{"key":"m1","kind":"moment","score":72,"lines":[{"text":"...","angle":"chant"}],"why":"...","audience":"...","timing":"week","collection":"current"}]}',
  ].join('\n');

  // ─── Short bullets for the page ──────────────────────────────────────────
  const SUMMARY = Object.freeze([
    'ES pills only: heavy condensed caps on solid, sharp boxes, no gaps between rows.',
    'Big, mid and small rows; short lines print bigger.',
    'Five collections: replay, nickname, quote, core, current.',
    'Team colours, and every pill stands off the shirt colour.',
    'Your line comes first, word for word.',
    'Numbers and quotes only from your story; quotes always attributed.',
    'Names, nicknames and team colours need your tick; no logos, league marks or "official".',
    'Pro adds a plan, trend angles, more layouts and up to 3 simple extras (number, bar, patch, icon).',
  ]);

  // ─── The colour rule in code ─────────────────────────────────────────────
  const WHITE = '#ffffff';
  const BLACK = '#000000';
  const contrast = (a, b) => (FrameUpRules && FrameUpRules.contrastRatio ? FrameUpRules.contrastRatio(a, b) : 21);
  function colorOf(key, palette = {}) {
    if (key === 'white') return WHITE;
    if (key === 'black') return BLACK;
    if (isHex(key)) return String(key).toLowerCase();
    return /^#[0-9a-f]{6}$/i.test(String(palette[key] || '')) ? String(palette[key]).toLowerCase() : BLACK;
  }
  // Rows whose box melts into the garment or whose text melts into the box.
  function contrastIssues(concept = {}) {
    const garment = (concept.garment && concept.garment.color) || WHITE;
    const out = [];
    (Array.isArray(concept.stack) ? concept.stack : []).forEach((row, i) => {
      const box = colorOf(row.fill, concept.palette);
      const ink = colorOf(row.ink, concept.palette);
      const boxC = contrast(box, garment);
      const inkC = contrast(ink, box);
      if (boxC < LIMITS.contrastBox) out.push({ row: i, kind: 'box', ratio: Math.round(boxC * 100) / 100 });
      if (inkC < LIMITS.contrastInk) out.push({ row: i, kind: 'ink', ratio: Math.round(inkC * 100) / 100 });
    });
    return out;
  }
  // Fixes rows in place of the AI: a box that melts into the tee becomes the
  // palette key that stands off it best (white on dark tees), then the text
  // takes the key that reads best on its box. Only keys are changed: a hex a
  // person picked stays as it is (the print checks flag it instead).
  // Returns { concept, fixed }.
  function repairContrast(concept = {}) {
    const garment = (concept.garment && concept.garment.color) || WHITE;
    const pal = concept.palette || {};
    let fixed = 0;
    const stack = (Array.isArray(concept.stack) ? concept.stack : []).map(row => {
      let { fill, ink } = row;
      if (!isHex(fill) && contrast(colorOf(fill, pal), garment) < LIMITS.contrastBox) {
        const best = ROW_COLORS.map(k => [k, contrast(colorOf(k, pal), garment)]).sort((x, y) => y[1] - x[1])[0];
        if (best && best[1] > contrast(colorOf(fill, pal), garment)) { fill = best[0]; fixed += 1; }
      }
      if (!isHex(ink) && (fill === ink || contrast(colorOf(ink, pal), colorOf(fill, pal)) < LIMITS.contrastInk)) {
        const best = ROW_COLORS.filter(k => k !== fill).map(k => [k, contrast(colorOf(k, pal), colorOf(fill, pal))]).sort((x, y) => y[1] - x[1])[0];
        if (best && (fill === ink || best[1] > contrast(colorOf(ink, pal), colorOf(fill, pal)))) { ink = best[0]; fixed += 1; }
      }
      return fill === row.fill && ink === row.ink ? row : { ...row, fill, ink };
    });
    return { concept: fixed ? { ...concept, stack } : concept, fixed };
  }

  return {
    VERSION, ICONS, ELEMENT_TYPES, ELEMENT_COLORS, ELEMENT_RULES, COLLECTIONS, SIZES, ROW_COLORS, LIMITS, VOICE,
    SECTIONS: { PILL, COLLECTION_RULES, LAYOUTS, COLOUR, RIGHTS, FACTS, BASIC_ONLY, PRO_ART, ELEMENTS },
    BASIC_SYSTEM: basicSystem(), PRO_SYSTEM: proSystem(), MOMENTS_SYSTEM,
    basicSystem, proSystem, refineSystem, SUMMARY, contrastIssues, repairContrast, colorOf, isHex,
  };
}));
