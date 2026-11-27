// Reels Studio v3 sample reels: one per style, from the team's reference
// topics (Rodgers 2011 stat twin, 67 Achilles tears, Kittle #1 TE, 2011 Green
// Bay streak). Shared by the frame-sheet renderer (reel-v3-sheets.mjs) and the
// engine tests. Pictures are stand-in SVG figures with a known head position
// (no photo rights involved); `head` / `focus` are what photo-verify returns.
export const CORPUS = 'Aaron Rodgers 2011: 45 touchdowns, 6 interceptions, Green Bay went 15-1, 15 and 1. 67 Achilles tears; 52 made it back, 26 got back to 90%, 15 did not. George Kittle tore his Achilles on Jan. 11. PFF: 2024 #1 TE grade 92.6, 2025 #1 TE grade 90.4.';

// Stand-in assets: a bust (head and shoulders), a standing player, a swing.
export const ASSETS = {
  bust: { id: 'bust', kind: 'photo', label: 'Stand-in bust', head: { x: 0.5, y: 0.275 }, focus: { x: 0.05, y: 0.08, w: 0.9, h: 0.9 }, rights: { source: 'FrameUp QA', licence: 'Drawn stand-in', organic: true, paid: true } },
  stand: { id: 'stand', kind: 'photo', label: 'Stand-in player', head: { x: 0.5, y: 0.158 }, focus: { x: 0.2, y: 0.07, w: 0.6, h: 0.93 }, rights: { source: 'FrameUp QA', licence: 'Drawn stand-in', organic: true, paid: true } },
  swing: { id: 'swing', kind: 'clip', label: 'Stand-in clip', durationMs: 6000, head: { x: 0.478, y: 0.25 }, focus: { x: 0.2, y: 0.05, w: 0.66, h: 0.95 }, rights: { source: 'FrameUp QA', licence: 'Drawn stand-in', organic: true, paid: true } },
  clip2: { id: 'clip2', kind: 'clip', label: 'Stand-in clip 2', durationMs: 6000, head: { x: 0.5, y: 0.158 }, focus: { x: 0.2, y: 0.07, w: 0.6, h: 0.93 }, rights: { source: 'FrameUp QA', licence: 'Drawn stand-in', organic: true, paid: true } },
};
export const PICTURES = {
  bust: { pose: 'bust', colour: '#203731' },
  stand: { pose: 'stand', colour: '#203731' },
  swing: { pose: 'swing', colour: '#AA0000' },
  clip2: { pose: 'stand', colour: '#AA0000' },
};

const beats = list => list.map((b, i) => ({ id: `b${i + 1}`, emphasis: '', photo: '', ...b }));
export const REELS = {
  statcard: {
    plan: { format: 'stat', title: "Rodgers' 2011 has no twin", sourceLine: 'Source: Pro Football Reference', reelStyle: 'statcard', beats: beats([
      { kind: 'hook', vo: "Aaron Rodgers' 2011 season has no twin.", block: { type: 'hook', kicker: 'STAT TWIN · EP. 10', pills: [{ text: "RODGERS' 2011", color: 'ink' }, { text: 'HAS NO TWIN', color: 'blue' }] } },
      { kind: 'point', vo: '45 touchdowns. 6 interceptions.', block: { type: 'photoCard', title: "RODGERS' *2011*", label: '2011 · GB', scan: true, tiles: [{ value: '45', label: 'TD', tone: 'blue' }, { value: '6', label: 'INT', tone: 'ink' }] } },
      { kind: 'point', vo: 'The closest twin? Nobody.', block: { type: 'statement', lines: [{ text: 'CLOSEST TWIN:', color: 'ink' }, { text: '*NOBODY.*', color: 'ink' }] } },
      { kind: 'chips', vo: 'Green Bay went 15 and 1.', block: { type: 'streak', title: '2011 · *GREEN BAY*', items: 'WWWWWWWWWWWWWLWW', label: '15-1' } },
      { kind: 'cta', block: { type: 'endcard' } },
    ]) },
    photos: { b1: ['bust'], b2: ['stand'] },
  },
  receipts: {
    plan: { format: 'stat', title: '67 Achilles tears', sourceLine: 'Source: ES research, PFF', reelStyle: 'receipts', beats: beats([
      { kind: 'hook', vo: '67 Achilles tears. Who came back?', block: { type: 'hook', pills: [{ text: '67 ACHILLES', color: 'ink' }, { text: 'TEARS.', color: 'blue' }] } },
      { kind: 'dotrank', vo: 'Of 67, 52 made it back, 26 got back to 90%, 15 did not.', block: { type: 'dotGrid', title: '*67* ACHILLES TEARS', total: 67, groups: [{ n: 26, tone: 'blue', label: 'BACK TO 90%' }, { n: 26, tone: 'ink', label: 'RETURNED' }, { n: 15, tone: 'grey', label: "DIDN'T RETURN" }] } },
      { kind: 'stat', vo: '52 made it back. 26 got back to 90%.', block: { type: 'statTiles', title: 'THE *OLD LEVEL.*', tiles: [{ value: '52', label: 'MADE IT BACK', tone: 'ink' }, { value: '26', label: 'BACK TO 90%', tone: 'blue' }] } },
      { kind: 'point', vo: 'George Kittle tore his Achilles on Jan. 11.', block: { type: 'tagPill', title: 'GEORGE *KITTLE*', text: 'TORE ACHILLES · JAN. 11', tone: 'red' } },
      { kind: 'rank', vo: 'He was the number 1 tight end in 2024 and 2025, graded 92.6 and 90.4.', block: { type: 'rankTile', title: 'TIGHT END *#1*', items: [{ kicker: '2024', rank: '1', pos: 'TE', chip: 'GRADE 92.6' }, { kicker: '2025', rank: '1', pos: 'TE', chip: 'GRADE 90.4' }] } },
      { kind: 'cta', block: { type: 'endcard' } },
    ]) },
    photos: {},
  },
  gametape: {
    plan: { format: 'explainer', title: 'Kittle tore his Achilles', sourceLine: 'Source: PFF', reelStyle: 'gametape', beats: beats([
      { kind: 'hook', vo: 'George Kittle tore his Achilles.', block: { type: 'hook', pills: [{ text: 'KITTLE TORE', color: 'ink' }, { text: 'HIS ACHILLES', color: 'blue' }] } },
      { kind: 'point', vo: 'The best tight end in football.', block: { type: 'clipLabel', text: 'GEORGE KITTLE', sub: 'SAN FRANCISCO · TE' } },
      { kind: 'point', vo: 'It happened on Jan. 11.', block: { type: 'tagPill', text: 'TORE ACHILLES · JAN. 11', tone: 'red' } },
      { kind: 'point', vo: 'Graded 92.6 and 90.4, back to back.', block: { type: 'statTiles', title: 'BACK TO *BACK*', tiles: [{ value: '92.6', label: '2024 TE GRADE', tone: 'blue' }, { value: '90.4', label: '2025 TE GRADE', tone: 'ink' }] } },
      { kind: 'point', vo: 'Now he has to *come back.*', block: { type: 'statement', lines: [{ text: 'NOW HE HAS', color: 'ink' }, { text: 'TO *COME BACK.*', color: 'ink' }] } },
      { kind: 'cta', block: { type: 'endcard' } },
    ]) },
    photos: { b1: ['swing'], b2: ['clip2'], b3: ['swing'], b5: ['clip2'] },
  },
  hypecut: {
    plan: { format: 'explainer', title: 'Green Bay 2011', sourceLine: 'Source: Pro Football Reference', reelStyle: 'hypecut', beats: beats([
      { kind: 'hook', vo: 'Green Bay, 2011. *Unreal.*', block: { type: 'hook', pills: [{ text: '2011', color: 'ink' }, { text: 'GREEN BAY', color: 'blue' }], stamp: { text: 'UNREAL' } } },
      { kind: 'point', vo: '45 touchdowns. 6 interceptions.', block: { type: 'statement', lines: [{ text: '45 TD.', color: 'ink' }, { text: '*6 INT.*', color: 'ink' }] } },
      { kind: 'point', vo: 'Aaron Rodgers. MVP.', block: { type: 'clipLabel', text: 'AARON RODGERS', sub: 'MVP · 2011' } },
      { kind: 'stat', vo: '15 and 1.', block: { type: 'statTiles', tiles: [{ value: '15-1', label: 'RECORD', tone: 'blue' }] } },
      { kind: 'point', vo: 'No twin.', block: { type: 'statement', lines: [{ text: 'NO *TWIN.*', color: 'ink' }] } },
      { kind: 'cta', block: { type: 'endcard' } },
    ]) },
    photos: { b1: ['swing'], b2: ['clip2'], b3: ['clip2'] },
  },
};
export const STYLE_ORDER = ['gametape', 'statcard', 'receipts', 'hypecut'];

// Build options for a sample reel (the renderer's buildTimeline opts).
export function optsFor(id, extra = {}) {
  const r = REELS[id];
  return { style: id, corpus: CORPUS, assets: ASSETS, photos: r.photos, ...extra };
}
