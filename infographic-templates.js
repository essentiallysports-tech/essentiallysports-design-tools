// Newsletter infographic templates. Each entry becomes its own option in
// Newsletter → Newsletter Asset, with an editable panel built from its layers.
// How to add one: project-docs/infographics.md
//
// Coordinates are in design pixels. Every newsletter FI exports at 960 × 640:
// the older slant/split/sequence/headline designs are 640 × 426.67 at
// exportScale 1.5; the newer golf designs are drawn at 960 × 640 directly.
// Layers draw in order, first = bottom. Layer types:
//   image  static artwork          { src, x, y, w, h, opacity }    (default: full canvas)
//   rect   shape                   { x, y, w, h | points, fill | gradient, radius, stroke, strokeWidth,
//                                    opacity, shadow: { blur, x, y, color }, shape: 'circle' }
//   path   line / outline          { points, stroke, strokeWidth, closed, outside }
//                                  outside: true = only the stroke half outside the shape
//   photo  swappable photo         { id, label, group, x, y, w, h | points, radius | shape: 'circle',
//                                    fill, fit: 'contain', fitPadding, placeholder: { src, x, y, w, h, rotate, anchor } }
//                                  anchor: 'fill' stretches to the box like the design does
//                                  placeholder = the design's photo and its crop box (cover fit)
//                                  main: true = the Upload photo button fills this slot
//   swatches colour choice (panel only) { id, label, group, options: '<Social sport>', default: '<variation>' };
//                                  pills with swatch: '<id>' take that variation's pill + text colour
//   text   text                    { id, label, group, default, x, y, w, h, font: { family, weight, size, minSize, scaleX },
//                                    color, align, valign | baseline, maxLines, lineHeight, letterSpacing,
//                                    uppercase, maxLength, box: { fill, padL, padR, height, baselineFromBottom } }
//                                  no id = fixed text; layers sharing an id share one field
//                                  labelFrom: id of another text layer whose value labels this field
//                                  (e.g. each stat is labelled with its column name)
// Flow: any layer with flowAfter: '<id>' (and flowGap) starts right after that
// layer's drawn width, so pills of different widths sit side by side.
// groups: order of the panel's sections. Two or more named groups become collapsible
// cards; short fields of one kind (maxLength ≤ 24, e.g. "Stat 1/2/3") sit side by side.
// draft: true = localhost only.
(function defineInfographicTemplates() {
  const DIR = 'assets/infographics/';
  const WHITE_EDGE = { type: 'path', stroke: '#FFFFFF', strokeWidth: 6, outside: true };

  // ── Older designs: one frame of 640 × 426.67, exported at 1.5× = 960 × 640.
  const W = 640;
  const H = 640 / 1.5;
  const EXPORT_SCALE = 1.5;
  // The designs were drawn 340 tall; this is the extra height they now fill.
  const EXTRA = H - 340;

  // Slanted panels keep the design's angle and run past the new bottom edge.
  const SLANT_LEFT = [[0, 0], [230.5, 0], [148.7, 435], [0, 435]];
  const SLANT_RIGHT = [[409.5, -3], [640, -3], [640, 435], [491.8, 435]];
  // Two Player Slant was drawn 608 × 323; scaled to 640 wide, then extended down.
  const DUO_RIGHT = [[277.98, -45.89], [667.8, -25.6], [640.03, 450], [389.5, 440]];

  // ── Sample people photos: the same two across every FI. Each is placed so
  // the face lands at the same spot in its slot, so heads line up when photos
  // sit side by side. face = [x, y] of the face centre in the image.
  const PEOPLE = {
    a: { src: DIR + 'sample-tennis.webp', w: 1200, h: 675, face: [645, 165] },
    b: { src: DIR + 'sample-golf.webp', w: 1280, h: 720, face: [589, 150] },
  };
  const slotBounds = slot => {
    if (!slot.points) return slot;
    const xs = slot.points.map(p => p[0]);
    const ys = slot.points.map(p => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  // Cover-fits the photo into the slot (zoom ≥ 1 crops tighter) with the face
  // at (fx, fy) of the slot, without ever uncovering the slot.
  const person = (p, slot, fx = 0.5, fy = 0.27, zoom = 1.15) => {
    const b = slotBounds(slot);
    const k = Math.max(b.w / p.w, b.h / p.h) * zoom;
    const w = p.w * k;
    const h = p.h * k;
    const x = Math.min(b.x, Math.max(b.x + b.w - w, b.x + fx * b.w - p.face[0] * k));
    const y = Math.min(b.y, Math.max(b.y + b.h - h, b.y + fy * b.h - p.face[1] * k));
    return { src: p.src, x, y, w, h, anchor: 'fill' };
  };

  // ── Golf card designs (Figma section 2188:941): drawn at 960 × 640, 1×.
  const GW = 960;
  const GH = 640;
  const GOLF_BG = { type: 'image', src: DIR + 'golf-bg.webp' };
  const CARD_SHADOW = { blur: 18, y: 6, color: 'rgba(0,48,8,0.12)' };
  const GREEN = '#008F00';
  const INK = '#090A0C';
  const DEEP = '#003008';
  const MUTED = '#5F655A';
  const RULE = '#C6D3B8';
  const RC = 'Roboto Condensed';
  const rc = (weight, size, minSize) => ({ family: RC, weight, size, minSize });
  // Roboto Condensed with line-height 1: the baseline sits 0.8418 em below the line top.
  const bl = (top, size) => top + 0.8418 * size;
  // A pill: solid box hugging one line of white uppercase text.
  const pill = (fill, size, padX, padY) => ({
    uppercase: true,
    color: '#FFFFFF',
    font: rc(900, size, Math.max(12, Math.round(size * 0.55))),
    box: { fill, padL: padX, padR: padX, height: size + padY * 2, baselineFromBottom: size + padY * 2 - padY - 0.8418 * size },
  });

  // FrameUp's post pill at any bar height h: same font (Acumin Post black),
  // padding and proportions as the Social cover pills (122 px tall), with the
  // capitals centred in the bar. swatch: id of a colour-choice field to take
  // the pill and text colours from.
  const framePill = (h, fill, swatch) => ({
    uppercase: true,
    color: '#FFFFFF',
    font: { size: h * (130 / 122) * 0.955, minSize: Math.round(h * 0.55), scaleX: 1 },
    box: { fill, padL: h * (18.4 / 122), padR: h * (21.88 / 122), height: h, baselineFromBottom: h * (5.15 / 34) },
    ...(swatch ? { swatch } : {}),
  });
  // Stacked pills follow the Social cover rule (drawPills): the next pill starts
  // just under the previous line's letters, covering its bottom padding:
  // step = bar height − top padding + edge gap + row gap (1 px each at 122 px).
  const pillStep = h => h - h * (5.15 / 34) + 2 * (h / 122);
  const FRAMEUP_PILL = framePill(34, GREEN);
  const FRAMEUP_PILL_STEP = pillStep(34);

  // Player Season Stats: three photo cards with name pill and three stats.
  const seasonCard = (n, x, photo, name, stats) => {
    const group = `Player ${n}`;
    const top = 44;
    const columns = [0, 83, 166].map(offset => x + 16 + offset);
    return [
      { type: 'rect', x, y: top, w: 280, h: 528, radius: 12, fill: '#FFFFFF', shadow: CARD_SHADOW },
      { type: 'photo', id: `p${n}Photo`, label: 'Photo', group, x, y: top, w: 280, h: 380, radius: [12, 12, 0, 0], fill: '#E4EBD8', placeholder: photo },
      { type: 'text', id: `p${n}Name`, label: 'Name', group, default: name, x: x + 16, y: 440, w: 248, h: 38, maxLength: 40, ...pill(GREEN, 28, 12, 5) },
      { type: 'rect', x: x + 16 + 82, y: 495, w: 1, h: 56, fill: RULE },
      { type: 'rect', x: x + 16 + 165, y: 495, w: 1, h: 56, fill: RULE },
      ...columns.map((cx, i) => ({ type: 'text', id: `label${i + 1}`, label: `Column ${i + 1} label`, group: 'Column labels', default: ['2026 Events', 'Top 10s', 'Wins'][i], x: cx, y: 492, w: 82, h: 16, align: 'center', baseline: bl(492, 16), color: MUTED, font: rc(500, 16, 11), maxLength: 24 })),
      ...columns.map((cx, i) => ({ type: 'text', id: `p${n}Stat${i + 1}`, label: `Stat ${i + 1}`, labelFrom: `label${i + 1}`, group, default: stats[i], x: cx, y: 510, w: 82, h: 44, align: 'center', baseline: bl(510, 44), color: DEEP, font: rc(700, 44, 24), maxLength: 8 })),
    ];
  };

  // Weekend Winners: three photo cards with a two-pill name, event and tour logo.
  const winnerCard = (n, x, photo, first, last, event, logo) => {
    const group = `Winner ${n}`;
    return [
      { type: 'rect', x, y: 40, w: 280, h: 539, radius: 12, fill: '#FFFFFF', shadow: CARD_SHADOW },
      { type: 'photo', id: `w${n}Photo`, label: 'Photo', group, x, y: 40, w: 280, h: 400, radius: [12, 12, 0, 0], fill: '#E4EBD8', placeholder: photo },
      // FrameUp's own pill: Acumin Post black, post-pill padding, stacked flush.
      { type: 'text', id: `w${n}First`, label: 'First name', group, default: first, x: x + 14, y: 452, w: 150, h: 34, maxLength: 20, ...FRAMEUP_PILL },
      { type: 'text', id: `w${n}Last`, label: 'Last name', group, default: last, x: x + 14, y: 452 + FRAMEUP_PILL_STEP, w: 150, h: 34, maxLength: 20, ...FRAMEUP_PILL },
      { type: 'text', id: `w${n}Event`, label: 'Tournament', group, default: event, x: x + 14, y: 452 + FRAMEUP_PILL_STEP + 34 + 11, w: 150, h: 34, maxLines: 2, lineHeight: 1.15, color: INK, font: rc(500, 15, 11), maxLength: 60 },
      { type: 'rect', x: x + 175, y: 468.5, w: 1, h: 80, fill: RULE },
      { type: 'photo', id: `w${n}Logo`, label: 'Tour logo', group, x: x + 188, y: 468.5, w: 78, h: 80, fit: 'contain', fitPadding: 4, placeholder: logo },
    ];
  };

  // Defending Champion course stats: [x, width, label, value] per column.
  const COURSE_STATS = [[460, 50, 'Par', '70'], [530, 100, 'Yards', '7,289'], [650, 114, 'Scoring Average', '70.26'], [784, 160, 'Hardest Hole', 'Par-4 5th']];

  // Tournament Fields: a column per event, title pills then three player cards
  // with name and three result pills.
  // Pills use FrameUp's own pill; each column's colour is picked from the
  // Social Media Tennis palettes (new tennis palettes appear automatically).
  const fieldColumn = (k, x, palette, side, titles, players) => {
    const colorId = `c${k}Color`;
    const layers = [
      { type: 'swatches', id: colorId, label: 'Pill colour', group: `${side} tournament`, options: 'Tennis', default: palette },
      { type: 'text', id: `c${k}Title1`, label: 'Title line 1', group: `${side} tournament`, default: titles[0], x, y: 40, w: 420, h: 48, maxLength: 30, ...framePill(48, '#5A2A82', colorId) },
      { type: 'text', id: `c${k}Title2`, label: 'Title line 2', group: `${side} tournament`, default: titles[1], x, y: 40 + pillStep(48), w: 420, h: 48, maxLength: 30, ...framePill(48, '#5A2A82', colorId) },
    ];
    players.forEach((player, j) => {
      const y = 156 + 140 * j;
      const group = `${side} player ${j + 1}`;
      const idBase = `c${k}p${j + 1}`;
      layers.push(
        { type: 'rect', x, y, w: 420, h: 124, radius: 12, fill: '#FFFFFF', shadow: CARD_SHADOW },
        { type: 'photo', id: `${idBase}Photo`, label: 'Photo', group, x, y, w: 128, h: 124, radius: [12, 0, 0, 12], fill: '#EEF3E6', placeholder: person(player.person, { x, y, w: 128, h: 124 }, 0.5, 0.45, 2.4) },
        { type: 'text', id: `${idBase}Name`, label: 'Name', group, default: player.name, x: x + 144, y: y + 20.5, w: 260, h: 28, baseline: bl(y + 20.5, 28), uppercase: true, color: INK, font: rc(900, 28, 16), maxLength: 30 },
        { type: 'text', text: 'Last 3 Finishes', x: x + 144, y: y + 54.5, w: 200, h: 15, baseline: bl(y + 54.5, 15), color: MUTED, font: rc(600, 15, 15) },
        ...player.results.map((result, r) => ({
          type: 'text', id: `${idBase}R${r + 1}`, label: `Result ${r + 1}`, group, default: result,
          x: x + 144, y: y + 75.5, w: 120, h: 28, maxLength: 6, ...framePill(28, '#5A2A82', colorId),
          ...(r ? { flowAfter: `${idBase}R${r}`, flowGap: 6 } : {}),
        })),
      );
    });
    return layers;
  };

  window.ES_INFOGRAPHIC_TEMPLATES = [
    {
      id: 'three-player-slant',
      label: 'Three Player Slant FI',
      width: W,
      height: H,
      exportScale: EXPORT_SCALE,
      background: '#AAAAAA',
      layers: [
        { type: 'photo', id: 'middle', label: 'Middle player', x: 0, y: 0, w: W, h: H, placeholder: person(PEOPLE.b, { x: 0, y: 0, w: W, h: H }, 0.5, 0.27, 1.15) },
        { type: 'photo', id: 'left', label: 'Left player', points: SLANT_LEFT, placeholder: person(PEOPLE.a, { points: SLANT_LEFT }, 0.42, 0.27, 1.15) },
        { type: 'photo', id: 'right', label: 'Right player', points: SLANT_RIGHT, placeholder: person(PEOPLE.a, { points: SLANT_RIGHT }, 0.58, 0.27, 1.15) },
        { ...WHITE_EDGE, points: SLANT_LEFT },
        { ...WHITE_EDGE, points: SLANT_RIGHT },
      ],
    },
    {
      id: 'two-player-slant',
      label: 'Two Player Slant FI',
      width: W,
      height: H,
      exportScale: EXPORT_SCALE,
      background: '#AAAAAA',
      layers: [
        { type: 'photo', id: 'left', label: 'Left player', x: 0, y: 0, w: W, h: H, placeholder: person(PEOPLE.a, { x: 0, y: 0, w: W, h: H }, 0.25, 0.27, 1.15) },
        { type: 'photo', id: 'right', label: 'Right player', points: DUO_RIGHT, placeholder: person(PEOPLE.b, { points: DUO_RIGHT }, 0.5, 0.27, 1.15) },
        { ...WHITE_EDGE, points: DUO_RIGHT },
      ],
    },
    {
      id: 'two-photo-split',
      label: 'Two Photo Split FI',
      width: W,
      height: H,
      exportScale: EXPORT_SCALE,
      background: '#FFFFFF',
      layers: [
        { type: 'photo', id: 'left', label: 'Left photo', x: 0, y: 0, w: 318, h: H, fill: '#FFFFFF', placeholder: person(PEOPLE.a, { x: 0, y: 0, w: 318, h: H }) },
        { type: 'photo', id: 'right', label: 'Right photo', x: 322, y: 0, w: 318, h: H, fill: '#FFFFFF', placeholder: person(PEOPLE.b, { x: 322, y: 0, w: 318, h: H }) },
        { type: 'rect', x: 318, y: 0, w: 4, h: H, fill: '#FFFFFF' },
      ],
    },
    {
      id: 'four-photo-sequence',
      label: 'Four Photo Sequence FI',
      width: W,
      height: H,
      exportScale: EXPORT_SCALE,
      background: '#FFFFFF',
      layers: [
        ...[PEOPLE.a, PEOPLE.b, PEOPLE.a, PEOPLE.b].map((p, i) => ({ type: 'photo', id: `photo${i + 1}`, label: `Photo ${i + 1}`, x: 160 * i, y: 0, w: 160, h: H, placeholder: person(p, { x: 160 * i, y: 0, w: 160, h: H }) })),
        { type: 'rect', x: 157, y: 0, w: 2, h: H, fill: '#FFFFFF' },
        { type: 'rect', x: 319, y: 0, w: 2, h: H, fill: '#FFFFFF' },
        { type: 'rect', x: 479, y: 0, w: 2, h: H, fill: '#FFFFFF' },
      ],
    },
    {
      id: 'headline-photo',
      label: 'Headline Photo FI',
      width: W,
      height: H,
      exportScale: EXPORT_SCALE,
      background: '#FFFFFF',
      layers: [
        { type: 'photo', id: 'photo', label: 'Photo', x: 0, y: 0, w: W, h: H, placeholder: person(PEOPLE.b, { x: 0, y: 0, w: W, h: H }, 0.5, 0.3, 1) },
        { type: 'rect', x: 0, y: 0, w: W, h: H, gradient: { from: [0, 213.7 + EXTRA], to: [0, 338.2 + EXTRA], stops: [[0, 'rgba(16,61,16,0)'], [1, '#103D10']] } },
        { type: 'text', id: 'line1', label: 'Headline line 1', default: 'How to Play', x: 106, y: 207 + EXTRA, w: 518, h: 50.63, uppercase: true, color: '#003008', letterSpacing: -0.739, font: { size: 60, minSize: 30, scaleX: 0.955 }, box: { fill: '#FFFFFF', padL: 6.167, padR: 5.482, height: 50.63, baselineFromBottom: 5.3 }, maxLength: 40 },
        { type: 'text', id: 'line2', label: 'Headline line 2', default: 'the Island Green', x: 139, y: 257 + EXTRA, w: 485, h: 50.63, uppercase: true, color: '#003008', letterSpacing: -0.739, font: { size: 60, minSize: 30, scaleX: 0.955 }, box: { fill: '#FFFFFF', padL: 6.167, padR: 5.482, height: 50.63, baselineFromBottom: 5.3 }, maxLength: 40 },
      ],
    },

    // ── Golf card designs (960 × 640).
    {
      id: 'player-season-stats',
      label: 'Player Season Stats FI',
      width: GW,
      height: GH,
      background: '#DDE5C9',
      groups: ['Player 1', 'Player 2', 'Player 3', 'Column labels', ''],
      layers: [
        GOLF_BG,
        ...seasonCard(1, 40, person(PEOPLE.a, { x: 40, y: 44, w: 280, h: 380 }), 'J.T. Poston', ['16', '02', '01']),
        ...seasonCard(2, 340, person(PEOPLE.b, { x: 340, y: 44, w: 280, h: 380 }), 'Eric Cole', ['17', '04', '0']),
        ...seasonCard(3, 640, person(PEOPLE.a, { x: 640, y: 44, w: 280, h: 380 }), 'Zach Johnson', ['03', '0', '0']),
        { type: 'text', id: 'footnote', label: 'Footnote', default: '* On the PGA Tour', x: 40, y: 608, w: 600, h: 16, baseline: bl(608, 16), color: MUTED, font: { family: 'Roboto', weight: 500, size: 16, minSize: 11 }, maxLength: 80 },
      ],
    },
    {
      id: 'weekend-winners',
      label: 'Weekend Winners FI',
      width: GW,
      height: GH,
      background: '#DDE5C9',
      groups: ['Winner 1', 'Winner 2', 'Winner 3'],
      layers: [
        GOLF_BG,
        ...winnerCard(1, 40, person(PEOPLE.a, { x: 40, y: 40, w: 280, h: 400 }), 'Grant', 'Forrest', 'Open de France', { src: DIR + 'logo-dp-world-tour.webp', x: 40 + 188, y: 469.5, w: 78, h: 78, anchor: 'fill' }),
        ...winnerCard(2, 340, person(PEOPLE.b, { x: 340, y: 40, w: 280, h: 400 }), 'Miyu', 'Yamashita', 'Aramco Korea Championship', { src: DIR + 'logo-let.webp', x: 340 + 213.89, y: 476.5, w: 52.11, h: 64, anchor: 'fill' }),
        ...winnerCard(3, 640, person(PEOPLE.a, { x: 640, y: 40, w: 280, h: 400 }), 'Vaughn', 'Taylor', 'Constellation Furyk & Friends', { src: DIR + 'logo-pga-tour-champions.webp', x: 640 + 195.31, y: 487.66, w: 70.87, h: 41.67, anchor: 'fill' }),
      ],
    },
    {
      id: 'tournament-fields',
      label: 'Tournament Fields FI',
      width: GW,
      height: GH,
      background: '#DDE5C9',
      groups: ['Left tournament', 'Left player 1', 'Left player 2', 'Left player 3', 'Right tournament', 'Right player 1', 'Right player 2', 'Right player 3'],
      layers: [
        GOLF_BG,
        ...fieldColumn(1, 40, 'Wimbledon', 'Left', ['Amundi Evian', 'Championship'], [
          { person: PEOPLE.a, name: 'Nelly Korda', results: ['T43', 'T26', 'T9'] },
          { person: PEOPLE.b, name: 'Jeeno Thitikul', results: ['02', 'MC', 'T9'] },
          { person: PEOPLE.a, name: 'Haeran Ryu', results: ['MC', '05', 'T42'] },
        ]),
        ...fieldColumn(2, 500, 'US Open', 'Right', ['Genesis', 'Scottish Open'], [
          { person: PEOPLE.b, name: 'Chris Gotterup', results: ['Win', 'MC', 'DNP'] },
          { person: PEOPLE.a, name: 'Ludvig Aberg', results: ['T8', 'T4', 'MC'] },
          { person: PEOPLE.b, name: 'Rory McIlroy', results: ['T2', 'T4', 'Win'] },
        ]),
      ],
    },
    {
      id: 'defending-champion',
      label: 'Defending Champion FI',
      width: GW,
      height: GH,
      background: '#DDE5C9',
      groups: ['Champion', 'Course stats', 'Weather'],
      layers: [
        GOLF_BG,
        { type: 'rect', x: 40, y: 40, w: 380, h: 340, radius: 12, fill: '#E4EBD8', shadow: CARD_SHADOW },
        { type: 'photo', id: 'photo', label: 'Photo', group: 'Champion', main: true, x: 40, y: 40, w: 380, h: 340, radius: 12, placeholder: person(PEOPLE.b, { x: 40, y: 40, w: 380, h: 340 }, 0.5, 0.3, 1.1) },
        { type: 'text', id: 'name', label: 'Champion', group: 'Champion', default: 'Ben Griffin', x: 460, y: 40, w: 480, h: 80, maxLength: 30, ...pill(GREEN, 64, 18, 8) },
        { type: 'text', id: 'subtitle', label: 'Subtitle', group: 'Champion', default: 'Defending Champion', x: 460, y: 134, w: 460, h: 26, baseline: bl(134, 26), color: INK, font: rc(600, 26, 16), maxLength: 40 },
        { type: 'rect', x: 460, y: 174, w: 460, h: 1, fill: 'rgba(0,48,8,0.3)' },
        // Labels first, then values, so each set sits side by side in the panel.
        ...COURSE_STATS.map(([x, w, label], i) => ({ type: 'text', id: `stat${i + 1}Label`, label: `Stat ${i + 1} label`, group: 'Course stats', default: label, x, y: 237, w, h: 16, baseline: bl(237, 16), color: MUTED, font: rc(600, 16, 10), maxLength: 18 })),
        ...COURSE_STATS.map(([x, w, label, value], i) => ({ type: 'text', id: `stat${i + 1}`, label: `Stat ${i + 1}`, labelFrom: `stat${i + 1}Label`, group: 'Course stats', default: value, x, y: 195, w, h: 40, baseline: bl(195, 40), color: DEEP, font: rc(700, 40, 20), maxLength: 12 })),
        { type: 'rect', x: 515, y: 195, w: 1, h: 64, fill: RULE },
        { type: 'rect', x: 635, y: 195, w: 1, h: 64, fill: RULE },
        { type: 'rect', x: 769, y: 195, w: 1, h: 64, fill: RULE },
        { type: 'rect', x: 40, y: 420, w: 880, h: 180, radius: 12, fill: 'rgba(255,255,255,0.75)' },
        { type: 'photo', id: 'weatherIcon', label: 'Weather icon', group: 'Weather', x: 68, y: 469.6, w: 84.31, h: 81.43, fit: 'contain', placeholder: { src: DIR + 'weather-sunny.svg', x: 68.16, y: 469.77, w: 84, h: 81.1, anchor: 'fill' } },
        { type: 'text', id: 'condition', label: 'Conditions', group: 'Weather', default: 'Mostly Sunny', x: 176.31, y: 468, w: 321.69, h: 30, baseline: bl(468, 30), uppercase: true, color: GREEN, font: rc(900, 30, 18), maxLength: 30 },
        { type: 'text', id: 'detail', label: 'Details', group: 'Weather', default: 'With an average 30% chance of rain, and winds averaging 6.8 to 11.3 MPH', x: 176.31, y: 508.6, w: 321.69, h: 48, maxLines: 2, lineHeight: 1.2, color: INK, font: rc(500, 20, 14), maxLength: 120 },
        { type: 'rect', x: 522, y: 455, w: 1, h: 110, fill: RULE },
        { type: 'image', src: DIR + 'weather-thermo.svg', x: 565.86, y: 483.77, w: 27.25, h: 54.77 },
        { type: 'text', id: 'temp', label: 'Temperature', group: 'Weather', default: '70.8° – 88.3°', x: 635, y: 488, w: 260, h: 44, baseline: bl(488, 44), color: DEEP, font: rc(700, 44, 24), maxLength: 20 },
        { type: 'text', id: 'unit', label: 'Unit', group: 'Weather', default: 'F', x: 879, y: 503, w: 40, h: 26, baseline: bl(488, 44), color: DEEP, font: rc(600, 26, 14), maxLength: 3, flowAfter: 'temp', flowGap: 6 },
      ],
    },
    {
      id: 'player-quote',
      label: 'Player Quote FI',
      width: GW,
      height: GH,
      background: '#FFFFFF',
      layers: [
        { type: 'photo', id: 'photo', label: 'Photo', main: true, x: 0, y: 0, w: GW, h: GH, placeholder: person(PEOPLE.a, { x: 0, y: 0, w: GW, h: GH }, 0.27, 0.33, 1.3) },
        { type: 'rect', x: 397, y: 300, w: 84.45, h: 84.45, fill: 'rgba(0,0,0,0.65)' },
        { type: 'image', src: DIR + 'quote-open.svg', x: 413.77, y: 326.07, w: 51.22, h: 32.79 },
        { type: 'text', id: 'line1', label: 'Quote line 1', default: 'Pootycuts', x: 481.45, y: 300, w: 460, h: 84.79, uppercase: true, color: DEEP, font: { size: 92.6, minSize: 40, scaleX: 0.955 }, box: { fill: '#FFFFFF', padL: 21.79, padR: 21.79, height: 84.79, baselineFromBottom: 10.6 }, maxLength: 30 },
        { type: 'text', id: 'line2', label: 'Quote line 2', default: 'Block', x: 514.14, y: 376.28, w: 360, h: 84.79, uppercase: true, color: DEEP, font: { size: 92.6, minSize: 40, scaleX: 0.955 }, box: { fill: '#FFFFFF', padL: 21.79, padR: 21.79, height: 84.79, baselineFromBottom: 10.6 }, maxLength: 30 },
        { type: 'rect', x: 783.85, y: 384.45, w: 76.28, h: 76.28, fill: 'rgba(0,0,0,0.65)', flowAfter: 'line2', flowGap: 0 },
        { type: 'image', src: DIR + 'quote-close.svg', x: 798.99, y: 408, w: 46.27, h: 29.62, flowAfter: 'line2', flowGap: 15.14 },
      ],
    },
    {
      id: 'three-panel-collage',
      label: 'Three Panel Collage FI',
      width: GW,
      height: GH,
      background: '#0B1F0B',
      groups: ['Left player', 'Middle player', 'Right player'],
      layers: [
        ...[
          [0, 'Left player', PEOPLE.a, 'collage-badge-1.webp'],
          [322, 'Middle player', PEOPLE.b, 'collage-badge-2.webp'],
          [644, 'Right player', PEOPLE.a, 'collage-badge-3.webp'],
        ].flatMap(([x, group, p, badge], i) => {
          // Badge centred in its panel.
          const bx = x + (316 - 168.66) / 2;
          return [
            { type: 'photo', id: `p${i + 1}Photo`, label: 'Photo', group, x, y: 0, w: 316, h: GH, fill: '#0B1F0B', placeholder: person(p, { x, y: 0, w: 316, h: GH }, 0.5, 0.25, 1.15) },
            { type: 'rect', x, y: 0, w: 316, h: GH, gradient: { from: [0, 402.9], to: [0, 637.1], stops: [[0, 'rgba(16,61,16,0)'], [1, '#000000']] } },
            { type: 'photo', id: `p${i + 1}Logo`, label: 'Logo', group, x: bx, y: 448.85, w: 168.66, h: 167.15, shape: 'circle', fill: '#FFFFFF', fit: 'contain', fitPadding: 18, placeholder: { src: DIR + badge, x: bx, y: 448.85, w: 168.66, h: 167.15, anchor: 'fill' } },
          ];
        }),
      ],
    },
    {
      id: 'two-up-collage',
      label: 'Two Up Collage FI',
      width: GW,
      height: GH,
      background: '#FFFFFF',
      layers: [
        { type: 'photo', id: 'left', label: 'Left photo', x: 0, y: 0, w: 478.12, h: GH, fill: '#FFFFFF', placeholder: person(PEOPLE.a, { x: 0, y: 0, w: 478.12, h: GH }, 0.45, 0.27, 1.15) },
        { type: 'photo', id: 'right', label: 'Right photo', x: 481.88, y: 0, w: 478.12, h: GH, fill: '#FFFFFF', placeholder: person(PEOPLE.b, { x: 481.88, y: 0, w: 478.12, h: GH }, 0.55, 0.27, 1.15) },
        { type: 'rect', x: 476.24, y: 0, w: 7.53, h: GH, fill: '#FFFFFF' },
        { type: 'photo', id: 'logo1', label: 'Top logo', x: 353.88, y: 52.71, w: 248.77, h: 248.77, shape: 'circle', fill: '#FFFFFF', fit: 'contain', fitPadding: 40, placeholder: { src: DIR + 'logo-pga-tour.webp', x: 416.4, y: 93.99, w: 130.04, h: 166.34, anchor: 'fill' } },
        { type: 'rect', x: 355.56, y: 54.39, w: 245.41, h: 245.41, shape: 'circle', stroke: '#2F832B', strokeWidth: 3.36 },
        { type: 'photo', id: 'logo2', label: 'Bottom logo', x: 355.76, y: 336.94, w: 248.77, h: 248.77, shape: 'circle', fill: '#FFFFFF', fit: 'contain', fitPadding: 40, placeholder: { src: DIR + 'logo-let.webp', x: 384.72, y: 347.46, w: 188.39, h: 231.35, anchor: 'fill' } },
        { type: 'rect', x: 357.44, y: 338.62, w: 245.41, h: 245.41, shape: 'circle', stroke: '#2F832B', strokeWidth: 3.36 },
      ],
    },
  ];
})();
