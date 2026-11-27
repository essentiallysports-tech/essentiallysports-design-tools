// Reels Studio v4 sample plans: the six reference reels the owner shared,
// rebuilt as v4 plans (structure from the decoded frame sheets) with drawn
// SVG stand-ins for every clip and photo (no rights involved). Numbers are
// layout stand-ins taken from the decoded sheets, listed in CORPUS so the
// numbers lint passes; quotes are marked SAMPLE (never a real quote).
// Shared by the golden sheets (reel-v4-sheets.mjs) and the engine tests.

const field = (kit, opp, { ball = true } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
<rect width="1600" height="900" fill="#3F7A3A"/>${Array.from({ length: 9 }, (_, i) => `<rect x="${i * 200 - 20}" y="0" width="8" height="900" fill="#FFFFFF" opacity="0.55"/>`).join('')}
<rect y="0" width="1600" height="160" fill="#2B2F36"/><rect y="150" width="1600" height="16" fill="#1E1E1E"/>
${[[520, 520], [640, 470], [760, 540], [880, 480]].map(([x, y]) => `<g transform="translate(${x} ${y})"><circle r="34" cy="-120" fill="#C68E62"/><rect x="-46" y="-90" width="92" height="120" rx="20" fill="${kit}"/><rect x="-40" y="30" width="80" height="110" fill="#F2F2F2"/></g>`).join('')}
${[[1000, 500], [1120, 450], [1240, 530]].map(([x, y]) => `<g transform="translate(${x} ${y})"><circle r="34" cy="-120" fill="#8D5B3C"/><rect x="-46" y="-90" width="92" height="120" rx="20" fill="${opp}"/><rect x="-40" y="30" width="80" height="110" fill="#E5E5E5"/></g>`).join('')}
${ball ? '<ellipse cx="930" cy="420" rx="26" ry="16" fill="#6B3A1E"/>' : ''}</svg>`;
const presser = (kit, name) => `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
<rect width="1600" height="900" fill="${kit}"/>${Array.from({ length: 40 }, (_, i) => `<rect x="${(i % 8) * 200 + ((Math.floor(i / 8) % 2) * 100)}" y="${Math.floor(i / 8) * 180}" width="120" height="70" fill="#FFFFFF" opacity="0.10"/>`).join('')}
<circle cx="800" cy="330" r="130" fill="#C68E62"/><path d="M670 260 Q800 150 930 260 L930 300 L670 300 Z" fill="#2A2A2A"/>
<path d="M430 900 Q460 520 800 500 Q1140 520 1170 900 Z" fill="#1C1C1C"/><rect x="760" y="480" width="80" height="60" fill="#F5F5F5"/>
<rect x="560" y="700" width="480" height="200" fill="#121212"/><rect x="760" y="560" width="14" height="150" fill="#555"/><circle cx="767" cy="560" r="22" fill="#333"/>
<text x="800" y="850" font-family="Arial" font-weight="700" font-size="44" fill="#FFFFFF" text-anchor="middle" opacity="0.5">${name}</text></svg>`;
const bust = (kit, bg = true) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 900 1125">
${bg ? '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3B4A5C"/><stop offset="1" stop-color="#9FB0BF"/></linearGradient></defs><rect width="900" height="1125" fill="url(#g)"/>' : ''}
<circle cx="450" cy="330" r="170" fill="#C68E62"/><path d="M290 260 Q450 110 610 260 L610 300 L290 300 Z" fill="#222"/><rect x="385" y="480" width="130" height="110" fill="#C68E62"/>
<path d="M60 1125 Q80 640 450 600 Q820 640 840 1125 Z" fill="${kit}"/><text x="450" y="900" font-family="Arial" font-weight="900" font-size="200" fill="#FFFFFF" text-anchor="middle" opacity="0.85">${'​'}</text></svg>`;

export const PICTURES = {
  ramsClip: field('#003594', '#97233F'), ramsClip2: field('#003594', '#203731', { ball: false }),
  dalClip: field('#041E42', '#004C54'), phiClip: field('#004C54', '#041E42', { ball: false }),
  sfClip: field('#AA0000', '#0B162A'), kcClip: field('#E31837', '#002244'), gbClip: field('#203731', '#4F2683'),
  balPress1: presser('#241773', 'BALTIMORE'), balPress2: presser('#241773', 'RAVENS'), lvPress: presser('#000000', 'RAIDERS'),
  ramsA: bust('#003594'), ramsB: bust('#FFA300'), coachA: bust('#003594'), coachB: bust('#AA0000'),
  kittle: bust('#AA0000'), rodgers: bust('#203731'), rodgersCut: bust('#203731', false), mahomes: bust('#E31837'), mahomesCut: bust('#E31837', false), qbB: bust('#125740'),
};
const R = { source: 'FrameUp QA', licence: 'Drawn stand-in', organic: true, paid: true };
const clip = (id, label) => ({ id, kind: 'clip', label, durationMs: 6000, head: { x: 0.56, y: 0.42 }, focus: { x: 0.28, y: 0.3, w: 0.55, h: 0.55 }, rights: R });
const photo = (id, label) => ({ id, kind: 'photo', label, head: { x: 0.5, y: 0.29 }, focus: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, rights: R });
export const ASSETS = {
  ramsClip: clip('ramsClip', 'Rams run'), ramsClip2: clip('ramsClip2', 'Rams drive'), dalClip: clip('dalClip', 'Dallas drive'), phiClip: clip('phiClip', 'Eagles kick'),
  sfClip: clip('sfClip', '49ers catch'), kcClip: clip('kcClip', 'Chiefs screen'), gbClip: clip('gbClip', 'Packers TD'),
  balPress1: clip('balPress1', 'GM presser'), balPress2: clip('balPress2', 'Center presser'), lvPress: clip('lvPress', 'Edge presser'),
  ramsA: photo('ramsA', 'Receiver A'), ramsB: photo('ramsB', 'Receiver B'), coachA: photo('coachA', 'Coach A'), coachB: photo('coachB', 'Coach B'),
  kittle: photo('kittle', 'Tight end'), rodgers: photo('rodgers', 'QB'), rodgersCut: photo('rodgersCut', 'QB cut-out'), mahomes: photo('mahomes', 'QB 2'), mahomesCut: photo('mahomesCut', 'QB 2 cut-out'), qbB: photo('qbB', 'QB 3'),
};
// The cut-out pipeline's output (transparent PNGs in the app; SVGs here).
export const CUTOUTS = { rodgersCut: 'rodgersCut', mahomesCut: 'mahomesCut' };

export const CORPUS = [
  '1 in 100 teams. 1000 team seasons. 35 second-half runs. 44 vs ARI, 47 vs GB. Under 50% successful. Possession 40:40 vs 19:20.',
  'Dallas led 31-10, a 21-point lead, lost 34-31 on a 59-yard field goal with 0:02 left. 4th & 1, sacked -9 yards. +10. 47% to 57%.',
  'Jan. 11. 67 Achilles tears, 26 back to 90%, 26 returned, 15 did not. 92.6 and 90.4 grades, #1 TE 2024 and 2025. 49ers 9-1. 85%, 90%, 102%. Age 25 30 35, 70% 52% 31%.',
  'Rodgers 4, 7 TD passes; 2011 MVP, 2014 MVP; 45 TD 6 INT; 38 and 31. 3 2 1.',
  'Chiefs 5.1, Giants 5.6, Dolphins 5.9 air yards per attempt. November 1960. 32 teams. 1 to 5.',
  'Ravens 82-38 since 2019. 2019 2020 2021 2022 2023 2024. 0 Super Bowls.',
].join(' ');

const yourCall = (team, a, b, comment) => ({ kind: 'yourCall', prompt: `${team} FANS: YOUR CALL`, options: [{ text: a, tone: 'red' }, { text: b, tone: 'blue' }], comment });

export const REELS = {
  rams: {
    label: 'Rams / McVay "1 in 100 teams do this"',
    plan: { v: 4, esStyle: 'breakdown', skin: 'clean', title: '1 in 100 teams do this', sport: 'nfl', sourceLine: 'Source: Pro Football Reference, NFL Next Gen Stats', chapters: [
      { id: 'c1', marker: '1 · THE OUTLIER', headline: 'ONLY *1 IN 100* TEAMS DO THIS', beats: [
        { id: 'r1', vo: 'Only *one in a hundred* teams do what the Rams just did.', media: { kind: 'clip', label: 'RAMS BALL', subject: { type: 'team', name: 'Rams' } }, module: { type: 'scatter', points: 1000, diagonal: true, axes: { x: 'RUN RATE', y: 'WIN %' } } },
        { id: 'r2', vo: 'Plot a thousand team seasons. The Rams sit way off the line.', media: { kind: 'clip', label: 'RAMS BALL' }, module: { type: 'scatter', points: 1000, diagonal: true, axes: { x: 'RUN RATE', y: 'WIN %' }, highlight: { label: 'RAMS', x: 0.93, y: 0.3 } } },
      ] },
      { id: 'c2', marker: '2 · NO RECEIVERS', headline: 'NO ADAMS. *NO NACUA.*', tone: 'red', beats: [
        { id: 'r3', vo: 'No Adams. No Nacua. Both of them out.', media: { kind: 'cards', cards: [{ name: 'ADAMS', tag: 'WR', sticker: 'OUT' }, { name: 'NACUA', tag: 'WR', sticker: 'OUT' }] }, module: { type: 'bars', title: 'PASS RATE', unit: '%', max: 60, rows: [{ label: 'VS ARI', value: 44, tone: 'ink' }, { label: 'VS GB', value: 47, tone: 'blue' }] } },
        { id: 'r4', vo: 'So McVay ran it. *35* times after halftime, the most in football.', media: { kind: 'clip', label: 'RAMS BALL' }, module: { type: 'reveal', from: '?', to: '35', label: 'MOST 2ND-HALF RUNS' }, tag: { text: 'UNDER 50% SUCCESSFUL', tone: 'red' } },
      ] },
      { id: 'c3', marker: '3 · THE CLOCK', headline: 'THEY *KEPT THE BALL*', beats: [
        { id: 'r5', vo: 'They held the ball for forty minutes. The other side got nineteen.', media: { kind: 'clip', label: 'RAMS BALL' }, module: { type: 'scoreboard', rows: [{ team: 'RAMS', value: '40:40' }, { team: 'OPP', value: '19:20' }] }, stamp: { text: 'CONTROL', tone: 'blue' } },
      ] },
      { id: 'c4', marker: '4 · THE VERDICT', headline: 'MCVAY VS *LAFLEUR*', beats: [
        { id: 'r6', vo: 'Same tree, two answers. McVay ran. LaFleur threw.', media: { kind: 'cards', cards: [{ name: 'MCVAY', tag: 'RAN IT' }, { name: 'LAFLEUR', tag: 'THREW IT' }] }, module: { type: 'compare', from: { value: '44', label: 'VS ARI' }, to: { value: '47', label: 'VS GB' } } },
      ] },
    ], close: yourCall('RAMS', 'RUN IT AGAIN', 'GET THE WRS BACK', 'COMMENT: WHAT WINS IN JANUARY?') },
    photos: { r1: ['ramsClip'], r2: ['ramsClip'], r3: ['ramsA', 'ramsB'], r4: ['ramsClip2'], r5: ['ramsClip2'], r6: ['coachA', 'coachB'] },
  },
  dallas: {
    label: 'Dallas "blew a 21-point lead"',
    plan: { v: 4, esStyle: 'breakdown', skin: 'clean', title: 'Dallas blew a 21-point lead', sport: 'nfl', sourceLine: 'Source: ESPN, nflfastR', chapters: [
      { id: 'c1', marker: '1 · THE RUN', headline: 'DALLAS BLEW A *21-POINT LEAD*', tone: 'red', beats: [
        { id: 'd1', vo: 'Dallas was up *twenty-one* points.', media: { kind: 'clip', label: 'COWBOYS BALL' }, module: { type: 'scoreboard', rows: [{ team: 'DAL', value: '31' }, { team: 'PHI', value: '10' }] } },
        { id: 'd2', vo: 'Then they lost it on a fifty-nine yard field goal with two seconds left.', media: { kind: 'clip', label: 'EAGLES BALL' }, module: { type: 'scoreboard', rows: [{ team: 'DAL', value: '31' }, { team: 'PHI', value: '34' }], tag: { text: '59-YD FG · 0:02 LEFT', tone: 'red' } }, stamp: { text: '+21', tone: 'red' } },
      ] },
      { id: 'c2', marker: '2 · THE THROW', headline: 'IT WAS *NOT* THE 4TH DOWN', beats: [
        { id: 'd3', vo: 'Fourth and one. They dropped back. Sacked for minus nine.', media: { kind: 'clip', label: 'COWBOYS BALL' }, module: { type: 'statTiles', tiles: [{ value: '-9', label: 'YARDS · SACKED', tone: 'red' }] }, tag: { text: '4TH & 1 · DROPBACK', tone: 'red' }, stamp: { text: 'BAD CALL', tone: 'red' } },
        { id: 'd4', vo: 'But Dallas sits *plus ten* on that call over a season.', module: { type: 'numberLine', min: -20, max: 20, marks: [{ label: 'DALLAS +10', value: 10, tone: 'red' }], caption: 'EPA ON 4TH & SHORT' } },
      ] },
      { id: 'c3', marker: '3 · THE CHOICE', headline: 'BACKING OFF = *A CHOICE*', beats: [
        { id: 'd5', vo: 'Going for it would have moved their win chance from forty-seven to fifty-seven percent.', module: { type: 'compare', from: { value: '47%', label: 'PUNT' }, to: { value: '57%', label: 'GO FOR IT' } } },
        { id: 'd6', vo: 'Instead the pocket collapsed and the favour was returned.', media: { kind: 'clip', label: 'EAGLES BALL' }, module: { type: 'playDiagram', label: 'THE POCKET', offense: [[0.3, 0.62], [0.4, 0.62], [0.5, 0.62], [0.6, 0.62], [0.7, 0.62], [0.5, 0.82]], defense: [[0.32, 0.5], [0.45, 0.5], [0.55, 0.5], [0.68, 0.5]], route: [[0.68, 0.5], [0.62, 0.68], [0.52, 0.8]] }, stamp: { text: 'A CHOICE', tone: 'blue' } },
      ] },
    ], close: yourCall('COWBOYS', 'BAD CALL', 'RIGHT CALL', 'COMMENT: WHO IS TO BLAME?') },
    photos: { d1: ['dalClip'], d2: ['phiClip'], d3: ['dalClip'], d6: ['phiClip'] },
  },
  kittle: {
    label: 'Kittle "shouldn\'t be this good again"',
    plan: { v: 4, esStyle: 'outlier', skin: 'clean', title: "Kittle shouldn't be this good again", sport: 'nfl', sourceLine: 'Source: PFF, ES research', chapters: [
      { id: 'c1', marker: '1 · THE INJURY', headline: 'KITTLE TORE HIS *ACHILLES*', tone: 'red', beats: [
        { id: 'k1', vo: 'George Kittle tore his Achilles.', media: { kind: 'photo', label: 'GEORGE KITTLE' }, module: { type: 'quote', text: 'Sample quote for layout only. The player\'s own words go here.', who: 'SAMPLE' } },
      ] },
      { id: 'c2', marker: '2 · THE ODDS', headline: '67 TEARS. *WHO CAME BACK?*', beats: [
        { id: 'k2', vo: 'Sixty-seven Achilles tears since 2015.', module: { type: 'dotGrid', total: 67, groups: [] } },
        { id: 'k3', vo: 'Twenty-six got back to ninety percent. Fifteen never returned.', module: { type: 'dotGrid', total: 67, groups: [{ n: 26, tone: 'blue', label: 'BACK TO 90%' }, { n: 26, tone: 'ink', label: 'RETURNED' }, { n: 15, tone: 'grey', label: "DIDN'T" }] } },
        { id: 'k4', vo: 'And the older you are, the *worse* your odds.', module: { type: 'lineChart', label: 'BACK TO 90% BY AGE', points: [[25, 70], [30, 52], [35, 31]], axes: { x: 'AGE 25 · 30 · 35' }, stamp: { text: 'WORSE ODDS', tone: 'red' } } },
      ] },
      { id: 'c3', marker: '3 · THE PEAK', headline: 'THE *#1* TIGHT END', beats: [
        { id: 'k5', vo: 'He was the number one tight end two years running.', media: { kind: 'photo', label: 'GEORGE KITTLE' }, module: { type: 'statTiles', tiles: [{ value: '92.6', label: '2024 TE GRADE', tone: 'blue' }, { value: '90.4', label: '2025 TE GRADE', tone: 'ink' }] }, tag: { text: 'TORE ACHILLES · JAN. 11', tone: 'red' } },
        { id: 'k6', vo: 'And the 49ers went nine and one with him.', media: { kind: 'clip', label: '49ERS BALL' }, module: { type: 'wl', items: 'WWWWLWWWWW', title: '49ERS WITH KITTLE' } },
        { id: 'k7', vo: 'Most who make it back top out under ninety percent.', module: { type: 'bars', title: '% OF OLD LEVEL', unit: '%', max: 110, rows: [{ label: 'TYPICAL', value: 85, tone: 'ink' }, { label: 'GOOD', value: 90, tone: 'ink' }, { label: 'KITTLE NEEDS', value: 102, tone: 'blue' }] }, stamp: { text: 'PAST THE LINE', tone: 'blue' } },
      ] },
      { id: 'c4', marker: '4 · THE OUTLIER', headline: "HE *SHOULDN'T EXIST*", beats: [
        { id: 'k8', vo: 'If he comes back as the best again, he is the dot that should not exist.', module: { type: 'dotGrid', total: 67, groups: [{ n: 26, tone: 'blue', label: 'BACK TO 90%' }, { n: 26, tone: 'ink', label: 'RETURNED' }, { n: 15, tone: 'grey', label: "DIDN'T" }], avatar: { label: 'KITTLE', asset: 'kittle', index: 66 } }, stamp: { text: "SHOULDN'T EXIST", tone: 'red' } },
      ] },
    ], close: yourCall('49ERS', 'NOT THE SAME', "HE'S BACK", 'COMMENT: YOUR CALL') },
    photos: { k1: ['kittle'], k5: ['kittle'], k6: ['sfClip'] },
  },
  rodgers: {
    label: 'Rodgers "who should call" (Scrapbook)',
    plan: { v: 4, esStyle: 'casefile', skin: 'scrapbook', title: 'Who should call the plays?', sport: 'nfl', sourceLine: 'Source: Pro Football Reference', chapters: [
      { id: 'c1', marker: { kind: 'countdown', n: 3, of: 3 }, headline: 'WHO SHOULD *CALL* PLAYS?', beats: [
        { id: 'g1', vo: 'Who should be calling plays for Aaron Rodgers?', media: { kind: 'cutout' }, module: { type: 'quote', text: 'Sample quote for layout only.', who: 'SAMPLE' } },
        { id: 'g2', vo: 'Exhibit three. When he calls it, the touchdowns pile up.', media: { kind: 'cutout' }, module: { type: 'tally', n: 4, label: 'TD PASSES' } },
        { id: 'g3', vo: 'Four. Then seven.', media: { kind: 'clip', label: 'PACKERS BALL' }, module: { type: 'tally', n: 7, label: 'TD PASSES' } },
      ] },
      { id: 'c2', marker: { kind: 'countdown', n: 2, of: 3 }, headline: 'TWO *MVP* CARDS', beats: [
        { id: 'g4', vo: 'Exhibit two. Two MVP seasons, and the coach who benched the plan.', media: { kind: 'cards', cards: [{ name: 'RODGERS', tag: '2011 MVP' }, { name: 'RODGERS', tag: '2014 MVP', sticker: 'BENCHED' }] }, module: { type: 'statTiles', tiles: [{ value: '45', label: 'TD', tone: 'blue' }, { value: '6', label: 'INT', tone: 'ink' }] } },
      ] },
      { id: 'c3', marker: { kind: 'countdown', n: 1, of: 3 }, headline: 'THE *WAIVER* PATH', beats: [
        { id: 'g5', vo: 'Exhibit one. The path if nothing changes.', module: { type: 'flow', nodes: [{ id: 'a', text: 'BENCHED', tone: 'red' }, { id: 'b', text: 'WAIVERS', tone: 'ink' }, { id: 'c', text: 'NEW TEAM', tone: 'blue' }, { id: 'd', text: 'RETIRE', tone: 'ink' }], edges: [['a', 'b'], ['b', 'c'], ['b', 'd']] } },
        { id: 'g6', vo: 'And the clock is ticking.', module: { type: 'calendar', month: 'NOVEMBER', day: '3', year: '2025', stamp: 'DEADLINE' } },
      ] },
    ], close: { kind: 'checklist', prompt: 'THE *CASE*', rows: [{ text: 'HE CALLS IT', checked: true }, { text: 'MORE TDS', checked: true }, { text: 'COACH CALLS IT', checked: false }] } },
    photos: { g1: ['rodgersCut'], g2: ['rodgersCut'], g3: ['gbClip'], g4: ['rodgers', 'qbB'] },
  },
  chiefs: {
    label: 'Chiefs "shortest throw in football" (Scrapbook)',
    plan: { v: 4, esStyle: 'casefile', skin: 'scrapbook', title: 'The shortest throw in football', sport: 'nfl', sourceLine: 'Source: NFL Next Gen Stats', chapters: [
      { id: 'c1', marker: { kind: 'progress', i: 1, of: 4 }, headline: 'THE *SHORTEST* THROW', beats: [
        { id: 'h1', vo: 'The Chiefs throw the shortest passes in football.', media: { kind: 'cutout' }, module: { type: 'rankList', title: 'AIR YARDS / ATT', rows: [{ rank: 1, label: 'CHIEFS', value: '5.1', chip: 'KC' }, { rank: 2, label: 'GIANTS', value: '5.6', chip: 'NYG' }, { rank: 3, label: 'DOLPHINS', value: '5.9', chip: 'MIA' }] } },
      ] },
      { id: 'c2', marker: { kind: 'progress', i: 2, of: 4 }, headline: 'THE *GO-TO* PLAY', beats: [
        { id: 'h2', vo: 'Their go-to play is a quick screen to the flat.', media: { kind: 'clip', label: 'CHIEFS BALL' }, module: { type: 'playDiagram', label: 'QUICK SCREEN', offense: [[0.3, 0.6], [0.4, 0.6], [0.5, 0.6], [0.6, 0.6], [0.7, 0.6], [0.5, 0.8], [0.88, 0.6]], defense: [[0.35, 0.45], [0.5, 0.45], [0.65, 0.45], [0.85, 0.35]], route: [[0.5, 0.8], [0.7, 0.75], [0.92, 0.5], [0.96, 0.2]] } },
      ] },
      { id: 'c3', marker: { kind: 'progress', i: 3, of: 4 }, headline: 'AN *OLD* IDEA', beats: [
        { id: 'h3', vo: 'The idea is older than the Super Bowl. November 1960.', module: { type: 'calendar', month: 'NOVEMBER', year: '1960', stamp: 'FIRST CALL' } },
      ] },
      { id: 'c4', marker: { kind: 'progress', i: 4, of: 4 }, headline: '1 OF *32*', beats: [
        { id: 'h4', vo: 'Thirty-two teams. One throws it this short.', media: { kind: 'photo', label: 'KANSAS CITY' }, module: { type: 'dotGrid', total: 32, groups: [{ n: 31, tone: 'grey', label: 'THE REST' }], avatar: { label: 'KC', asset: 'mahomes', index: 31 } } },
      ] },
    ], close: { kind: 'checklist', prompt: 'DOES IT *WORK?*', rows: [{ text: 'SAFE', checked: true }, { text: 'FAST', checked: true }, { text: 'BIG PLAYS', checked: false }] } },
    photos: { h1: ['mahomesCut'], h2: ['kcClip'], h4: ['mahomes'] },
  },
  ravens: {
    label: 'Ravens / Lamar "the perfect cover"',
    plan: { v: 4, esStyle: 'hotseat', skin: 'clean', title: 'Is DeCosta on the hot seat?', sport: 'nfl', sourceLine: 'Source: Pro Football Reference', chapters: [
      { id: 'c1', marker: '1 · THE GM', headline: 'IS DECOSTA ON THE *HOT SEAT?*', tone: 'red', beats: [
        { id: 'v1', vo: 'Eighty-two and thirty-eight since 2019. And still no ring.', media: { kind: 'presser', subject: { type: 'person', name: 'Eric DeCosta' } }, module: { type: 'statTiles', tiles: [{ value: '82-38', label: 'SINCE 2019', tone: 'blue' }] } },
        { id: 'v2', vo: 'His own center says the run game got *spiked*.', media: { kind: 'presser', subject: { type: 'person', name: 'Tyler Linderbaum' } }, module: { type: 'statTiles', tiles: [{ value: '82-38', label: 'SINCE 2019', tone: 'blue' }, { value: '0', label: 'SUPER BOWLS', tone: 'red' }] }, stamp: { text: 'SPIKED', tone: 'red' } },
      ] },
      { id: 'c2', marker: '2 · THE RECORD', headline: 'SIX SEASONS. *NO RING.*', beats: [
        { id: 'v3', vo: 'Six seasons on the calendar.', module: { type: 'timeline', slots: ['2019', '2020', '2021', '2022', '2023', '2024'].map(label => ({ label, filled: false })) } },
        { id: 'v4', vo: 'Every one of them ended short.', module: { type: 'timeline', slots: ['2019', '2020', '2021', '2022', '2023', '2024'].map(label => ({ label, filled: true, tone: 'red' })) } },
      ] },
      { id: 'c3', marker: '3 · THE THREAT', headline: "THEY *CAN'T BLOCK* HIM", beats: [
        { id: 'v5', vo: 'And the edge rushers they face every year? They cannot block them.', media: { kind: 'presser', subject: { type: 'person', name: 'Maxx Crosby' } }, module: { type: 'wl', items: 'LWLL', title: 'VS THE AFC WEST' }, stamp: { text: "CAN'T BLOCK", tone: 'red' } },
      ] },
    ], close: yourCall('RAVENS', 'FIRE DECOSTA', 'ONE MORE OFFSEASON', 'COMMENT: WHO GOES FIRST?') },
    photos: { v1: ['balPress1'], v2: ['balPress2'], v5: ['lvPress'] },
  },
};
export const REEL_ORDER = ['rams', 'dallas', 'kittle', 'rodgers', 'chiefs', 'ravens'];
export function optsFor(id, extra = {}) {
  return { style: 'es', corpus: CORPUS, assets: ASSETS, photos: REELS[id].photos, sources: [{ title: 'Stand-in source', url: 'https://example.com' }], ...extra };
}
