// Newsletter infographic templates. Each entry becomes its own option in
// Newsletter → Newsletter Asset, with an editable panel built from its layers.
// How to add one: project-docs/infographics.md
//
// Coordinates are in design pixels (the Figma frame size); exportScale 2 exports
// at twice that. Layers draw in order, first = bottom. Layer types:
//   image  static artwork          { src, x, y, w, h, opacity }    (default: full canvas)
//   rect   shape                   { x, y, w, h | points, fill | gradient, radius, stroke, strokeWidth, opacity }
//   path   line / outline          { points, stroke, strokeWidth, closed, outside }
//                                  outside: true = only the stroke half outside the shape
//   photo  swappable photo         { id, label, group, x, y, w, h | points, radius | shape: 'circle',
//                                    fill, placeholder: { src, x, y, w, h, rotate, anchor } }
//                                  anchor: 'fill' stretches to the box like the design does
//                                  placeholder = the design's photo and its crop box (cover fit)
//   text   text                    { id, label, group, default, x, y, w, h, font: { family, weight, size, minSize, scaleX },
//                                    color, align, valign | baseline, maxLines, lineHeight, letterSpacing,
//                                    uppercase, maxLength, box: { fill, padL, padR, height, baselineFromBottom } }
//                                  no id = fixed text; layers sharing an id share one field
//                                  labelFrom: id of another text layer whose value labels this field
//                                  (e.g. each stat is labelled with its column name)
// groups: order of the panel's sections. Two or more named groups become collapsible
// cards; short fields of one kind (maxLength ≤ 24, e.g. "Stat 1/2/3") sit side by side.
// draft: true = localhost only.
(function defineInfographicTemplates() {
  const DIR = 'assets/infographics/';
  const WHITE_EDGE = { type: 'path', stroke: '#FFFFFF', strokeWidth: 6, outside: true };

  // Three Player Stats: one card per player.
  const STAT_FONT = { family: 'Acumin Pro Condensed Local', weight: 700, size: 32.205, minSize: 20 };
  const LABEL_FONT = { family: 'Acumin Pro Condensed Web', weight: 400, size: 12.882, minSize: 9 };
  const statCard = (n, x, top, bottom, photo, name, stats) => {
    const group = `Player ${n}`;
    const columns = [[x, 71.83], [x + 71.83, 65.48], [x + 137.31, 60.22]];
    return [
      { type: 'photo', id: `p${n}Photo`, label: 'Photo', group, x, y: top, w: 197.19, h: 156.11, radius: [9.39, 9.39, 0, 0], fill: '#FFFFFF', placeholder: photo },
      { type: 'rect', x: x + 0.587, y: top + 0.587, w: 196.02, h: 154.94, radius: [8.8, 8.8, 0, 0], stroke: '#A7A6A6', strokeWidth: 1.174 },
      { type: 'rect', x: x + 0.587, y: bottom + 0.587, w: 196.36, h: 98.66, radius: [0, 0, 8.8, 8.8], fill: 'rgba(240,240,240,.74)', stroke: '#A7A6A6', strokeWidth: 1.174 },
      { type: 'text', id: `p${n}Name`, label: 'Name', group, default: name, x: x + 4, y: bottom + 7.42, w: 189.5, h: 29.62, align: 'center', uppercase: true, color: '#FFFFFF', letterSpacing: -0.626, font: { size: 32.2, minSize: 16, scaleX: 0.97 }, box: { fill: '#008F00', padL: 2.924, padR: 2.924, height: 29.62, baselineFromBottom: 3.3 }, maxLength: 40 },
      { type: 'path', points: [[x + 71.83, bottom + 46.06], [x + 71.83, bottom + 86.85]], stroke: '#C7C7C7', strokeWidth: 1.07 },
      { type: 'path', points: [[x + 137.31, bottom + 46.06], [x + 137.31, bottom + 86.85]], stroke: '#C7C7C7', strokeWidth: 1.07 },
      ...columns.map(([cx, cw], i) => ({ type: 'text', id: `label${i + 1}`, label: `Column ${i + 1} label`, group: 'Column labels', default: ['2026 Events', 'Top 10s', 'Wins'][i], x: cx + 3, y: bottom + 44, w: cw - 6, h: 16, align: 'center', baseline: bottom + 57.4, color: '#003008', letterSpacing: -0.258, font: LABEL_FONT, maxLength: 24 })),
      ...columns.map(([cx, cw], i) => ({ type: 'text', id: `p${n}Stat${i + 1}`, label: `Stat ${i + 1}`, labelFrom: `label${i + 1}`, group, default: stats[i], x: cx + 3, y: bottom + 58, w: cw - 6, h: 34, align: 'center', baseline: bottom + 86.3, color: '#003008', letterSpacing: -0.644, font: STAT_FONT, maxLength: 8 })),
    ];
  };

  // Three Player Badges: photo panel with a round logo near the bottom.
  const badgePanel = (n, x, photo, badgeX, badgeY, badge) => {
    const group = ['Left player', 'Middle player', 'Right player'][n - 1];
    return [
      { type: 'photo', id: `p${n}Photo`, label: 'Photo', group, x, y: 0, w: 211, h: 340, fill: '#000000', placeholder: photo },
      { type: 'rect', x, y: 0, w: 211, h: 340, gradient: { from: [0, 214], to: [0, 338.45], stops: [[0, 'rgba(16,61,16,0)'], [1, '#000000']] } },
      { type: 'photo', id: `p${n}Logo`, label: 'Logo', group, x: badgeX, y: badgeY, w: 112, h: 111, shape: 'circle', fill: '#FFFFFF', placeholder: { src: DIR + badge, x: badgeX, y: badgeY, w: 112, h: 111 } },
    ];
  };

  window.ES_INFOGRAPHIC_TEMPLATES = [
    {
      id: 'three-player-slant',
      label: 'Three Player Slant FI',
      width: 640,
      height: 340,
      exportScale: 2,
      background: '#AAAAAA',
      layers: [
        { type: 'photo', id: 'middle', label: 'Middle player', x: 0, y: 0, w: 640, h: 340, placeholder: { src: DIR + 'golfer-b.webp', x: 44, y: -55, w: 551, h: 689 } },
        { type: 'photo', id: 'left', label: 'Left player', points: [[0, 0], [230.5, 0], [165, 348.5], [0, 348.5]], placeholder: { src: DIR + 'golfer-a.webp', x: -212.38, y: -140.42, w: 613, h: 622.28, rotate: -0.49 } },
        { type: 'photo', id: 'right', label: 'Right player', points: [[409.5, -3], [640, -3], [640, 345.5], [475, 345.5]], placeholder: { src: DIR + 'golfer-c.webp', x: 410, y: -3, w: 262, h: 349 } },
        { ...WHITE_EDGE, points: [[0, 0], [230.5, 0], [165, 348.5], [0, 348.5]] },
        { ...WHITE_EDGE, points: [[409.5, -3], [640, -3], [640, 345.5], [475, 345.5]] },
      ],
    },
    {
      id: 'two-player-slant',
      label: 'Two Player Slant FI',
      width: 608,
      height: 323,
      exportScale: 2,
      background: '#AAAAAA',
      layers: [
        { type: 'photo', id: 'left', label: 'Left player', x: 0, y: 0, w: 608, h: 323, placeholder: { src: DIR + 'duo-left.webp', x: -88.4, y: -28.52, w: 490.5, h: 664.46, anchor: 'fill' } },
        { type: 'photo', id: 'right', label: 'Right player', points: [[264.08, -43.6], [634.41, -24.32], [613.33, 336.9], [348.23, 323.1]], placeholder: { src: DIR + 'duo-right.webp', x: 95.15, y: -69.24, w: 677, h: 432, rotate: 5.73 } },
        { ...WHITE_EDGE, strokeWidth: 5.7, points: [[264.08, -43.6], [634.41, -24.32], [613.33, 336.9], [348.23, 323.1]] },
      ],
    },
    {
      id: 'two-photo-split',
      label: 'Two Photo Split FI',
      width: 640,
      height: 340,
      exportScale: 2,
      background: '#FFFFFF',
      layers: [
        { type: 'photo', id: 'left', label: 'Left photo', x: 0, y: 0, w: 318, h: 340, fill: '#FFFFFF', placeholder: { src: DIR + 'split-left.webp', x: 0, y: 0, w: 318, h: 405, anchor: 'fill' } },
        { type: 'photo', id: 'right', label: 'Right photo', x: 322, y: 0, w: 318, h: 340, fill: '#FFFFFF', placeholder: { src: DIR + 'split-right.webp', x: 305, y: -95, w: 340, h: 441, anchor: 'fill' } },
        { type: 'rect', x: 318, y: 0, w: 4, h: 340, fill: '#FFFFFF' },
      ],
    },
    {
      id: 'four-photo-sequence',
      label: 'Four Photo Sequence FI',
      width: 640,
      height: 340,
      exportScale: 2,
      background: '#FFFFFF',
      layers: [
        { type: 'photo', id: 'photo1', label: 'Photo 1', x: 0, y: 0, w: 160, h: 340, placeholder: { src: DIR + 'swing-1.webp', x: -51, y: 0, w: 298, h: 405 } },
        { type: 'photo', id: 'photo2', label: 'Photo 2', x: 160, y: 0, w: 160, h: 340, placeholder: { src: DIR + 'swing-2.webp', x: 138, y: -17, w: 283, h: 421 } },
        { type: 'photo', id: 'photo3', label: 'Photo 3', x: 320, y: 0, w: 160, h: 340, placeholder: { src: DIR + 'swing-3.webp', x: 278, y: 0, w: 300, h: 408 } },
        { type: 'photo', id: 'photo4', label: 'Photo 4', x: 480, y: 0, w: 160, h: 340, placeholder: { src: DIR + 'swing-4.webp', x: 446, y: 0, w: 320, h: 450 } },
        { type: 'rect', x: 157, y: 0, w: 2, h: 340, fill: '#FFFFFF' },
        { type: 'rect', x: 319, y: 0, w: 2, h: 340, fill: '#FFFFFF' },
        { type: 'rect', x: 479, y: 0, w: 2, h: 340, fill: '#FFFFFF' },
      ],
    },
    {
      id: 'three-player-badges',
      label: 'Three Player Badges FI',
      width: 640,
      height: 340,
      exportScale: 2,
      background: '#FFFFFF',
      groups: ['Left player', 'Middle player', 'Right player'],
      layers: [
        ...badgePanel(1, 0, { src: DIR + 'golfer-a.webp', x: -210.02, y: -140.36, w: 613, h: 622.28, rotate: -0.49 }, 50.24, 210.95, 'badge-dp-world-tour.webp'),
        ...badgePanel(2, 214, { src: DIR + 'golfer-b.webp', x: 66.02, y: -43.63, w: 505.9, h: 632.37 }, 264.05, 216.71, 'badge-pga-tour.webp'),
        ...badgePanel(3, 429, { src: DIR + 'golfer-c.webp', x: 386.88, y: -0.5, w: 266.94, h: 355.92 }, 478.65, 219.86, 'badge-usga.webp'),
      ],
    },
    {
      id: 'headline-photo',
      label: 'Headline Photo FI',
      width: 640,
      height: 340,
      exportScale: 2,
      background: '#FFFFFF',
      layers: [
        { type: 'photo', id: 'photo', label: 'Photo', x: 0, y: 0, w: 640, h: 340, placeholder: { src: DIR + 'island-green.webp', x: 0, y: -74, w: 640, h: 427 } },
        { type: 'rect', x: 0, y: 0, w: 640, h: 340, gradient: { from: [0, 213.7], to: [0, 338.2], stops: [[0, 'rgba(16,61,16,0)'], [1, '#103D10']] } },
        { type: 'text', id: 'line1', label: 'Headline line 1', default: 'How to Play', x: 106, y: 207, w: 518, h: 50.63, uppercase: true, color: '#003008', letterSpacing: -0.739, font: { size: 60, minSize: 30, scaleX: 0.955 }, box: { fill: '#FFFFFF', padL: 6.167, padR: 5.482, height: 50.63, baselineFromBottom: 5.3 }, maxLength: 40 },
        { type: 'text', id: 'line2', label: 'Headline line 2', default: 'the Island Green', x: 139, y: 257, w: 485, h: 50.63, uppercase: true, color: '#003008', letterSpacing: -0.739, font: { size: 60, minSize: 30, scaleX: 0.955 }, box: { fill: '#FFFFFF', padL: 6.167, padR: 5.482, height: 50.63, baselineFromBottom: 5.3 }, maxLength: 40 },
      ],
    },
    {
      id: 'three-player-stats',
      label: 'Three Player Stats FI',
      width: 640,
      height: 318,
      exportScale: 2,
      background: '#E8E8E8',
      groups: ['Player 1', 'Player 2', 'Player 3', 'Column labels', ''],
      layers: [
        { type: 'image', src: DIR + 'stats-background.webp' },
        ...statCard(1, 12, 21, 176.66, { src: DIR + 'stats-1.webp', x: -58.18, y: -4.1, w: 370, h: 392, anchor: 'fill' }, 'J.T. Poston', ['16', '02', '01']),
        ...statCard(2, 221, 20, 175.66, { src: DIR + 'stats-2.webp', x: 154.09, y: -8.17, w: 418, h: 307, anchor: 'fill' }, 'Eric Cole', ['17', '04', '0']),
        ...statCard(3, 429.48, 20.93, 176.59, { src: DIR + 'stats-3.webp', x: 228.83, y: -6.17, w: 582, h: 388 }, 'Zach Johnson', ['03', '0', '0']),
        { type: 'text', id: 'footnote', label: 'Footnote', default: '* On The PGA Tour', x: 14, y: 288, w: 612, h: 16, baseline: 304.5, color: '#7F7F7F', letterSpacing: -0.3, font: { family: 'Roboto, "Helvetica Neue", Arial, sans-serif', weight: 500, size: 15, minSize: 10 }, maxLength: 80 },
      ],
    },
  ];
})();
