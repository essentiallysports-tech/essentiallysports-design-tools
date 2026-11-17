#!/usr/bin/env node
// Reels Studio data formats, Phase 0 contract (project-docs/reels-formats-contract.md):
// the format registry (reel-formats.js), the element registry and stub draws
// (reel-styles.js), the unified flow (reel-flow.js), timeline schema v2
// (reel-timeline.js: normaliser with v1 compatibility, validator, digest,
// refs, facts), the server dispatch stubs (reel-maker.js FORMAT_MODES) and
// the four places that used to clamp unknown formats to 'explainer'.
// Pure: fetch is mocked, no network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'reels');
const fixture = name => JSON.parse(readFileSync(path.join(FIX, name), 'utf8'));

const F = require('../reel-formats.js');
const S = require('../reel-styles.js');
const FLOW = require('../reel-flow.js');
const T = require('../reel-timeline.js');
const R = require('../reel-render.js');
const L = require('../reel-lint.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
const measure = (text, font) => String(text).length * Number(String(font).match(/([\d.]+)px/)[1]) * 0.5;
function stubCtx() {
  const calls = [];
  const handler = { get: (target, prop) => (prop in target ? target[prop] : (...args) => { calls.push([prop, ...args]); return { width: 10, addColorStop() {} }; }), set: (target, prop, value) => { target[prop] = value; return true; } };
  return { ctx: new Proxy({ calls, measureText: t => ({ width: String(t).length * 10 }), canvas: { width: 1080, height: 1920 } }, handler), calls };
}

// ─── Format registry ─────────────────────────────────────────────────────
await test('registry: news formats unchanged; gameswing, replay, archive registered with the owner defaults', () => {
  assert.deepEqual(F.FORMAT_IDS, ['explainer', 'stat', 'top5', 'quote'], 'the picker still lists the four news formats');
  assert.deepEqual(F.DATA_FORMAT_IDS, ['gameswing', 'replay', 'archive'], 'build order');
  assert.deepEqual(F.ALL_FORMAT_IDS, [...F.FORMAT_IDS, ...F.DATA_FORMAT_IDS]);
  const want = { gameswing: ['series', 'game', ['reel']], replay: ['classic', 'clip', ['reel', 'carousel']], archive: ['countdown', 'player', ['reel', 'carousel']] };
  for (const [id, [style, source, outputs]] of Object.entries(want)) {
    const f = F.FORMATS[id];
    assert.equal(f.id, id);
    assert.equal(f.family, 'data');
    assert.equal(f.defaultStyle, style, `${id} default style`);
    assert.equal(S.FORMAT_STYLES[id], style, `${id}: styles agree`);
    assert.ok(S.STYLES[style], `${id}: ${style} exists`);
    assert.equal(f.source, source);
    assert.deepEqual(f.outputs, outputs);
    assert.ok(F.SOURCE_KINDS.includes(f.source));
    f.outputs.forEach(o => assert.ok(F.OUTPUTS.includes(o)));
    // Fields every existing reader of FORMATS uses (director, lint, page).
    ['label', 'short', 'tag', 'blurb', 'description'].forEach(k => assert.ok(typeof f[k] === 'string' && f[k], `${id}.${k}`));
    assert.ok(f.beats.min >= 1 && f.beats.max >= f.beats.min);
    assert.ok(f.targetSeconds[0] >= 8 && f.targetSeconds[1] <= f.maxSeconds && f.maxSeconds <= 90, `${id} durations inside the lint limits`);
    f.kinds.forEach(k => assert.ok(F.KINDS.includes(k), `${id}: story kind ${k} is one today's director knows`));
    f.dataKinds.forEach(k => assert.ok(F.DATA_KINDS.includes(k), `${id}: data kind ${k}`));
    f.sports.forEach(s => assert.ok(F.SPORTS.some(x => x.id === s), `${id}: sport ${s} is a reel sport`));
    assert.ok(!f.sports.includes('nba'), 'no NBA yet');
    assert.ok(f.cost && typeof f.cost.hint === 'string');
    assert.ok(F.isDataFormat(id));
    assert.deepEqual(F.formatKinds(id), [...new Set([...f.kinds, ...f.dataKinds])]);
  }
  assert.equal(F.FORMATS.gameswing.attribution, 'Win probability: ESPN Analytics');
  assert.deepEqual(F.FORMATS.gameswing.sports, ['nfl', 'cfb', 'mlb']);
  assert.deepEqual(F.FORMATS.replay.rights.clipSources, ['x', 'library', 'upload']);
  assert.equal(F.FORMATS.replay.rights.paidWithLeagueFootage, 'warn');
  assert.ok(!F.isDataFormat('explainer'));
  assert.ok(!F.KINDS.some(k => F.DATA_KINDS.includes(k)), 'data kinds stay out of KINDS until the renderer draws them');
  assert.deepEqual(F.ALL_KINDS, [...F.KINDS, ...F.DATA_KINDS]);
  F.ALL_KINDS.forEach(k => assert.ok(k in F.KIND_LABELS, `label for ${k}`));
});

await test('router: news routing unchanged; data formats are only suggested', () => {
  assert.equal(F.routeFormat('Bills complete a 21-point comeback in overtime').format, 'explainer', 'routeFormat never returns a data format');
  assert.equal(F.suggestDataFormat('Bills complete a comeback in overtime'), 'gameswing');
  assert.equal(F.suggestDataFormat('One-handed catch goes viral'), 'replay');
  assert.equal(F.suggestDataFormat('Hall of Fame class announced'), 'archive');
  assert.equal(F.suggestDataFormat('Chiefs sign a kicker'), '');
});

await test('cost: news estimates unchanged; data, archive and frame-pick lines only when asked', () => {
  const base = F.estimateCost({ tier: 'economy', voiceMode: 'off' });
  assert.ok(!base.lines.some(l => ['data', 'archive', 'framepick'].includes(l.id)));
  assert.equal(base.lines[0].id, 'director');
  const swing = F.estimateCost({ tier: 'economy', ...F.formatCostOptions('gameswing') });
  assert.equal(swing.lines[0].id, 'data');
  assert.equal(swing.lines[0].usd, 0);
  assert.equal(swing.total, base.total, 'game data is free');
  const replay = F.estimateCost({ tier: 'economy', ...F.formatCostOptions('replay') });
  const pick = replay.lines.find(l => l.id === 'framepick');
  assert.ok(pick && pick.usd > 0 && pick.usd <= F.PRICES.framePickCap);
  assert.ok(!F.estimateCost(F.formatCostOptions('replay', { aiFramePick: false })).lines.some(l => l.id === 'framepick'), 'no AI: no frame-pick line');
  assert.ok(F.estimateCost(F.formatCostOptions('archive')).lines.some(l => l.id === 'archive' && l.usd === 0));
  assert.deepEqual(F.formatCostOptions('explainer'), {});
  assert.equal(F.FORMATS.gameswing.voice, 'off');
  assert.equal(F.formatCostOptions('gameswing').voiceMode, 'off');
});

// ─── Elements (reel-styles.js) ───────────────────────────────────────────
await test('elements: registry, per-style tokens in ES fonts and no purple, boxes inside the safe areas', () => {
  const want = ['scorebug', 'wpline', 'clock', 'playcard', 'panel3', 'timeline-node', 'source-chip', 'attribution'];
  assert.deepEqual(S.ELEMENT_IDS, want);
  S.STYLE_IDS.forEach(id => assert.deepEqual(S.validateStyle(S.STYLES[id]), [], `${id} validates with the elements`));
  for (const styleId of S.STYLE_IDS) {
    for (const el of S.ELEMENT_IDS) {
      const t = S.elementTokens(styleId, el);
      Object.entries(t).forEach(([k, v]) => {
        if (/font/i.test(k)) assert.ok(S.FONTS.includes(v), `${styleId}/${el}.${k} is an ES font`);
        else assert.ok(!S.isPurple(v), `${styleId}/${el}.${k} not purple`);
      });
    }
  }
  const reel = T.CANVASES.reel.safe;
  const slide = T.CANVASES.slide.safe;
  for (const el of S.ELEMENT_IDS) {
    const e = S.ELEMENTS[el];
    e.kinds.forEach(k => assert.ok(F.DATA_KINDS.includes(k), `${el} kind ${k}`));
    const b = S.elementBox(el, { w: 1080, h: 1920 });
    assert.ok(b.x >= reel.left && b.x + b.w <= reel.right && b.y >= reel.top && b.y + b.h <= reel.bottom, `${el} inside the reel safe zone`);
    const s = S.elementBox(el, { w: 1080, h: 1350 });
    assert.ok(s.x >= slide.left && s.x + s.w <= slide.right && s.y >= slide.top && s.y + s.h <= slide.bottom, `${el} inside the slide safe area`);
  }
  // The scorebug keeps clear of the ES mark (x 870, 50 px clear space).
  const bug = S.elementBox('scorebug');
  assert.ok(bug.x + bug.w <= 870 - 50);
  assert.equal(S.elementTokens('nope', 'scorebug').fill, S.STYLES.classic.palette.bg, 'unknown style falls back to classic');
  assert.equal(S.elementTokens('series', 'nope'), null);
});

await test('elements: stub draws a labelled placeholder in every style and never throws', () => {
  for (const styleId of [...S.STYLE_IDS, 'unknown']) {
    for (const el of [...S.ELEMENT_IDS, 'not-an-element']) {
      const { ctx, calls } = stubCtx();
      const op = S.drawPlaceholder(ctx, el, null, styleId);
      assert.equal(op.type, 'placeholder');
      assert.match(op.text, /COMING SOON$/);
      assert.ok(calls.some(c => c[0] === 'fillText'), `${styleId}/${el} draws its label`);
      assert.ok(calls.some(c => c[0] === 'strokeRect'));
    }
  }
  assert.equal(S.drawPlaceholder(null, 'scorebug').element, 'scorebug', 'no context: returns the op only');
  assert.equal(S.suggestStyle({ format: 'gameswing' }).id, 'series');
  assert.equal(S.suggestStyle({ format: 'top5', text: '' }).id, 'countdown', 'news suggestion unchanged');
});

// ─── Flow (reel-flow.js) ──────────────────────────────────────────────────
await test('flow: news flow is byte-for-byte the old one', () => {
  assert.deepEqual(FLOW.initial(), { step: 'story', making: false, stages: FLOW.STAGES.map(s => ({ ...s, state: 'todo', note: '' })), hasReel: false, error: '' });
  assert.deepEqual(FLOW.STEPS, ['story', 'review', 'export']);
  assert.deepEqual(FLOW.stepsFor('explainer'), FLOW.STEPS);
  assert.deepEqual(FLOW.stagesFor('stat').map(s => s.id), ['script', 'voice', 'visuals', 'build']);
  assert.equal(FLOW.reduce(FLOW.initial(), { type: 'go', step: 'format' }).step, 'story', 'the news flow has no format step');
  assert.deepEqual(FLOW.reduce(FLOW.initial(), { type: 'reset' }), FLOW.initial());
});

await test('flow: data formats: gallery -> source -> story -> make (data / frames) -> review -> export', () => {
  assert.deepEqual(FLOW.ALL_STEPS, ['format', 'source', 'story', 'review', 'export']);
  assert.deepEqual(FLOW.stagesFor('gameswing').map(s => s.id), ['data', 'script', 'voice', 'visuals', 'build']);
  assert.deepEqual(FLOW.stagesFor('replay').map(s => s.id), ['frames', 'script', 'build']);
  assert.deepEqual(FLOW.stagesFor('archive').map(s => s.id), ['data', 'script', 'voice', 'visuals', 'build']);
  assert.equal(FLOW.stagesFor('archive')[0].label, 'Researching the career');
  F.DATA_FORMAT_IDS.forEach(id => assert.equal(FLOW.sourceKindFor(id), F.FORMATS[id].source, `${id} source kind agrees`));
  assert.equal(FLOW.sourceKindFor('quote'), 'trend');
  Object.values(FLOW.SOURCE_KINDS).forEach(k => k.modes.forEach(m => assert.ok(require('../netlify/functions/reel-maker.js')._test.FORMAT_MODES[m], `${k.id} uses a registered mode ${m}`)));

  let s = FLOW.reduce(FLOW.initial(), { type: 'pick-format', format: 'gameswing' });
  assert.deepEqual([s.step, s.format, s.source], ['source', 'gameswing', null]);
  assert.equal(FLOW.reduce(s, { type: 'make' }), s, 'no game picked: Make does nothing');
  assert.equal(FLOW.reduce(s, { type: 'go', step: 'story' }), s, 'no game picked: no story step');
  s = FLOW.reduce(s, { type: 'set-source', source: { kind: 'game', sport: 'nfl' } });
  assert.equal(s.step, 'source', 'incomplete source stays');
  s = FLOW.reduce(s, { type: 'set-source', source: { kind: 'game', sport: 'nfl', eventId: '401873063', label: 'SF at DAL' } });
  assert.equal(s.step, 'story');
  s = FLOW.reduce(s, { type: 'make' });
  assert.deepEqual(s.stages.map(x => x.state), ['active', 'todo', 'todo', 'todo', 'todo']);
  const failed = FLOW.reduce(s, { type: 'stage-done', stage: 'data', failed: true, note: 'Game data is unavailable; use the brief.' });
  assert.deepEqual([failed.making, failed.error], [false, 'Game data is unavailable; use the brief.'], 'no data stops the run');
  ['data', 'script', 'voice', 'visuals', 'build'].forEach(id => { s = FLOW.reduce(s, { type: 'stage-done', stage: id, skipped: id === 'voice' }); });
  assert.deepEqual([s.making, s.step, s.hasReel], [false, 'review', true]);
  assert.equal(FLOW.reduce(s, { type: 'go', step: 'export' }).step, 'export');
  assert.equal(FLOW.reduce(s, { type: 'go', step: 'format' }).step, 'format', 'back to the gallery');
  assert.equal(FLOW.reduce(s, { type: 'pick-format', format: 'quote' }).step, 'story', 'a news format from the gallery is the old flow');

  // Replay: a frames failure is soft (the code pick is the fallback).
  let r = FLOW.reduce(FLOW.initial('replay'), { type: 'set-source', source: { kind: 'clip', origin: 'tiktok', url: 'https://x.com/a/status/1' } });
  assert.equal(r.step, 'source', 'unknown clip origin is refused');
  r = FLOW.reduce(r, { type: 'set-source', source: { kind: 'clip', origin: 'upload', assetId: 'clip:upload1' } });
  r = FLOW.reduce(FLOW.reduce(r, { type: 'make' }), { type: 'stage-done', stage: 'frames', failed: true, note: 'AI pick off; used the code pick' });
  assert.deepEqual([r.making, r.stages[1].state], [true, 'active']);
  assert.ok(FLOW.sourceReady('archive', { kind: 'player', sport: 'nfl', athleteId: '2330', name: 'Tom Brady', angle: '5 best moments' }));
  assert.ok(!FLOW.sourceReady('archive', { kind: 'game', sport: 'nfl', eventId: '1' }));
  assert.equal(FLOW.reduce(r, { type: 'reset' }).format, 'replay');
});

// ─── Timeline schema v2 (reel-timeline.js) ────────────────────────────────
const STAT_PLAN = {
  format: 'stat', title: 'Allen breaks the Bills record', sport: 'nfl',
  beats: [
    { id: 'b1', kind: 'hook', text: '5,477 yards. A Bills record.', vo: 'Josh Allen just threw for 5,477 yards, the most in Bills history.' },
    { id: 'b2', kind: 'stat', text: '5,477 passing yards', vo: 'That beats the old mark by a mile.', stat: { value: '5,477', label: 'pass yds' } },
    { id: 'b3', kind: 'cta', text: 'Is he the MVP?', vo: 'Is he the MVP? Tell us below.' },
  ],
};

await test('schema v2: a v1 timeline normalises losslessly, idempotently, without mutation, and validates', () => {
  const v1 = R.buildTimeline(STAT_PLAN, { style: 'explainer' });
  assert.equal(v1.v, 1, 'the renderer still emits v1 (Agent B moves it to v2)');
  const before = JSON.stringify(v1);
  const v2 = T.normalizeTimeline(v1);
  assert.equal(JSON.stringify(v1), before, 'input not mutated');
  assert.equal(v2.v, 2);
  assert.deepEqual(v2.canvas, { w: 1080, h: 1920 });
  assert.deepEqual(v2.size, [1080, 1920]);
  assert.deepEqual(v2.outputs, ['reel']);
  assert.deepEqual(v2.data, { game: null, athlete: null, archive: null });
  assert.deepEqual(v2.slides, []);
  assert.equal(v2.replay, null);
  // Every v1 field survives unchanged (beats only gain refs: []).
  for (const [k, v] of Object.entries(v1)) {
    if (k === 'v') continue;
    if (k === 'beats') assert.deepEqual(v2.beats.map(({ refs, ...rest }) => rest), v, 'beats kept');
    else assert.deepEqual(v2[k], v, `${k} kept`);
  }
  v2.beats.forEach(b => assert.deepEqual(b.refs, []));
  assert.deepEqual(T.normalizeTimeline(v2), v2, 'idempotent');
  const check = T.validateTimeline(v1);
  assert.deepEqual(check.errors, [], 'a v1 timeline is valid');
  assert.equal(T.normalizeTimeline(null), null);
  assert.equal(T.validateTimeline('x').ok, false);
  // A v1 timeline still renders exactly as before (the renderer never sees v2 yet).
  const { ctx } = stubCtx();
  R.drawFrame(ctx, v1, 500, { measure, images: {}, videos: {} });
});

await test('schema v2: canvas sizes, outputs and slides', () => {
  const slideOnly = { v: 2, canvas: { w: 1080, h: 1350 }, outputs: ['carousel'], beats: [], slides: [{ id: 's1', kind: 'cover', text: 'Cover', refs: [] }] };
  assert.ok(T.validateTimeline(slideOnly).ok, '1080x1350 carousel-only');
  assert.deepEqual(T.canvasFor(slideOnly), { w: 1080, h: 1350, safe: T.CANVASES.slide.safe });
  assert.ok(!T.validateTimeline({ ...slideOnly, outputs: ['reel'] }).ok, 'a reel needs 1080x1920');
  assert.ok(!T.validateTimeline({ ...slideOnly, canvas: { w: 1080, h: 1080 } }).ok, 'square is not a canvas');
  const many = { ...slideOnly, slides: Array.from({ length: 21 }, (_, i) => ({ id: `s${i + 1}`, kind: 'panel', refs: [] })) };
  assert.ok(T.validateTimeline(many).errors.some(e => e.path === 'slides'), 'Instagram allows 20 slides');
  assert.ok(!T.validateTimeline({ ...slideOnly, slides: [{ id: 's1', kind: 'poster' }] }).ok, 'unknown slide kind');
  assert.ok(T.validateTimeline({ ...slideOnly, slides: [{ id: 's1', kind: 'panel', refs: [] }] }).warnings.some(w => w.path === 'slides[0]'), 'cover first is a warning');
});

await test('schema v2: the three fixture timelines validate; refs resolve to data points', () => {
  for (const name of ['timeline-v2-gameswing.json', 'timeline-v2-replay.json', 'timeline-v2-archive.json']) {
    const tl = fixture(name);
    const out = T.validateTimeline(tl);
    assert.deepEqual(out.errors, [], name);
    assert.ok(F.FORMATS[tl.format] && F.isDataFormat(tl.format));
    assert.equal(tl.style, F.FORMATS[tl.format].defaultStyle, `${name} uses the default style`);
  }
  const game = fixture('timeline-v2-gameswing.json');
  assert.equal(T.resolveRef(game, 'play:401873063558').text, 'Deebo Samuel Sr. 11 Yd pass from Brock Purdy (Eddy Pineiro Kick)');
  assert.deepEqual(T.resolveRef(game, 'wp:-1'), { seq: -1, wpHome: 0.3606 });
  assert.equal(T.resolveRef(game, 'play:nope'), null);
  assert.equal(T.resolveRef(game, 'bogus'), null);
  const arch = fixture('timeline-v2-archive.json');
  assert.equal(T.resolveRef(arch, 'stat:s2001').stats[4], '2,843');
  assert.equal(T.resolveRef(arch, 'stat:totals').stats[6], '649');
  assert.equal(T.resolveRef(fixture('timeline-v2-replay.json'), 'frame:reaction').t, 9.0);
});

await test('schema v2: the validator catches broken data, missing attribution and dangling refs', () => {
  const game = fixture('timeline-v2-gameswing.json');
  const noAttr = JSON.parse(JSON.stringify(game));
  noAttr.data.game.attribution = '';
  assert.ok(T.validateTimeline(noAttr).errors.some(e => /attribution/.test(e.path)), 'WP on screen needs its attribution');
  const dangling = JSON.parse(JSON.stringify(game));
  dangling.beats[1].refs = ['play:999'];
  assert.ok(T.validateTimeline(dangling).errors.some(e => /does not resolve/.test(e.msg)));
  const playNoRef = JSON.parse(JSON.stringify(game));
  playNoRef.beats[1].refs = [];
  assert.ok(T.validateTimeline(playNoRef).errors.some(e => /needs a play/.test(e.msg)));
  const espnLogo = JSON.parse(JSON.stringify(game));
  espnLogo.data.game.teams.home.logo = 'https://a.espncdn.com/i/teamlogos/nfl/500/dal.png';
  assert.ok(T.validateTimeline(espnLogo).errors.some(e => /logo/.test(e.path)), 'no ESPN logo URLs');
  const arch = fixture('timeline-v2-archive.json');
  const uncited = JSON.parse(JSON.stringify(arch));
  uncited.data.archive.moments[0].cite = [];
  uncited.beats[1].refs = [];
  const out = T.validateTimeline(uncited);
  assert.ok(out.errors.some(e => /cite/.test(e.path)) && out.errors.some(e => /moment cites/.test(e.msg)));
  const badSource = JSON.parse(JSON.stringify(arch));
  badSource.data.archive.sources = [{ id: 'a1', type: 'es-article', title: 'x', url: 'https://example.com/x', date: '2017-02-06' }];
  badSource.data.archive.photos = [{ id: 'p1', url: 'https://upload.wikimedia.org/x.jpg', credit: 'x' }];
  const bad = T.validateTimeline(badSource).errors.map(e => e.path);
  assert.ok(bad.includes('data.archive.sources[0].url') && bad.includes('data.archive.photos[0].url'), 'ES articles and the ES photo pool only');
  const rep = fixture('timeline-v2-replay.json');
  rep.replay.origin = 'tiktok';
  assert.ok(T.validateTimeline(rep).errors.some(e => e.path === 'replay.origin'));
  const big = { v: 2, beats: [], tracks: {}, corpus: 'x'.repeat(210 * 1024) };
  assert.ok(T.validateTimeline(big).errors.some(e => /cloud cap/.test(e.msg)), '200 KB cap');
});

await test('digest: the golden NFL digest is valid, <= 8 KB, and matches the trimmed ESPN fixture', () => {
  const d = fixture('nfl-401873063.digest.json');
  const out = T.validateDigest(d);
  assert.deepEqual(out.errors, []);
  assert.ok(out.bytes <= T.LIMITS.digestBytes);
  // Traceable to the reshaped ESPN summary: ids, scores, clocks, wallclocks, WP.
  const sum = fixture('espn-nfl-summary-401873063.min.json');
  const plays = sum.drives.previous.flatMap(dr => dr.plays);
  d.plays.forEach(p => {
    const src = plays[p.seq];
    assert.equal(src.id, p.id, 'seq is the index in the flattened play list');
    assert.equal(src.clock.displayValue, p.clock);
    assert.equal(src.period.number, p.period);
    assert.equal(src.wallclock, p.wallclock);
    assert.deepEqual({ home: src.homeScore, away: src.awayScore }, p.score);
    assert.equal(src.scoringPlay, p.scoring);
    assert.equal(src.start.shortDownDistanceText || null, p.down);
  });
  const wp = sum.winprobability;
  assert.deepEqual(d.wp.points[0], [-1, wp[0].homeWinPercentage], 'a leading unmatched WP entry is the pregame value');
  d.wp.points.slice(1).forEach(([seq, v]) => assert.equal(wp.find(w => w.playId === plays[seq].id).homeWinPercentage, v));
  const comp = sum.header.competitions[0].competitors;
  const home = comp.find(c => c.homeAway === 'home');
  assert.equal(d.teams.home.abbr, home.team.abbreviation);
  assert.equal(d.teams.home.score, Number(home.score));
  assert.deepEqual(d.teams.home.linescore, home.linescores.map(l => Number(l.displayValue)));
  assert.equal(d.attribution, F.FORMATS.gameswing.attribution);
  // Shape breakers.
  assert.ok(!T.validateDigest({ ...d, sport: 'nba' }).ok, 'no NBA yet');
  assert.ok(!T.validateDigest({ ...d, plays: Array.from({ length: 31 }, (_, i) => ({ ...d.plays[0], id: `p${i}`, seq: i })) }).ok, 'at most 30 plays');
  assert.ok(!T.validateDigest({ ...d, wp: { points: [[0, 1.4]] } }).ok, 'WP is 0-1');
  assert.ok(!T.validateDigest({ ...d, plays: [{ ...d.plays[0], text: 'x'.repeat(101) }] }).ok, 'play text <= 100');
  const huge = { ...d, plays: Array.from({ length: 30 }, (_, i) => ({ ...d.plays[1], id: `p${i}`, seq: i, text: 'y'.repeat(100), tags: ['scoring', 'swing', 'lead-change', 'period-end'] })), wp: { team: 'home', points: Array.from({ length: 120 }, (_, i) => [i, 0.123456789]), count: 203 } };
  assert.ok(T.validateDigest(huge).errors.some(e => /cap is 8192/.test(e.msg)), 'the 8 KB cap binds');
});

await test('digest facts: every number a Game Swing beat may show is in the facts text (lint extraSources)', () => {
  const d = fixture('nfl-401873063.digest.json');
  const facts = T.digestFacts(d);
  const set = F.numberSet(facts);
  ['46', '40', '3', '7', '52', '11', '12', '56', '6', '36', '64', '38'].forEach(n => assert.ok(set.has(n), `${n} in facts`));
  assert.match(facts, /Win probability: ESPN Analytics/);
  assert.equal(T.digestFacts(d), facts, 'deterministic');
  assert.equal(T.digestFacts(null), '');
  // The lint accepts a beat built only from digest numbers.
  const tl = R.buildTimeline({ format: 'gameswing', title: 'SF at DAL', beats: [{ id: 'b1', kind: 'hook', text: 'SF 7, DAL 3 at 6:56', vo: 'San Francisco led 7 to 3 with 6:56 left in the first.' }, { id: 'b2', kind: 'cta', text: 'Who wins the rematch?', vo: 'Who wins the rematch? Tell us below.' }] }, { style: 'series' });
  const lint = L.lintTimeline(tl, { extraSources: facts });
  assert.ok(!lint.issues.some(i => i.rule === 'numbers'), JSON.stringify(lint.issues.filter(i => i.rule === 'numbers')));
});

// ─── Clamps: data formats are accepted where unknown formats became 'explainer' ─
await test('clamps: buildTimeline, lint, fallbackPlan accept the data formats; data kinds degrade to point', () => {
  for (const id of F.DATA_FORMAT_IDS) {
    const plan = { format: id, title: 'Test', beats: [{ id: 'b1', kind: 'hook', text: 'A hook', vo: 'A hook line.' }, { id: 'b2', kind: F.FORMATS[id].dataKinds[0], text: 'Data beat', vo: 'The data beat.' }, { id: 'b3', kind: 'cta', text: 'Thoughts?', vo: 'Tell us below.' }] };
    const tl = R.buildTimeline(plan, { style: F.FORMATS[id].defaultStyle });
    assert.equal(tl.format, id, `buildTimeline keeps ${id}`);
    assert.equal(tl.tag, F.FORMATS[id].tag);
    assert.equal(tl.beats[1].kind, 'point', 'a data kind is drawn as a point until Agent B lands it');
    const { ctx } = stubCtx();
    for (const t of [0, 1500, tl.durationMs - 1]) R.drawFrame(ctx, tl, t, { measure, images: {}, videos: {} });
    tl.tracks.graphics.forEach(g => R.layoutGraphic(measure, g, tl));
    const lint = L.lintTimeline(tl, {});
    assert.ok(Array.isArray(lint.issues), `lint runs for ${id}`);
    assert.equal(F.fallbackPlan({ brief: 'A thing happened. Then another.', title: 'Test', format: id }).format, id);
  }
});

await test('clamps: server plan, project save and event accept the data formats; FORMAT_MODES stubs answer 501', async () => {
  delete process.env.AI_GATEWAY_API_KEY;
  const realFetch = globalThis.fetch;
  const posted = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1', email: 'editor@essentiallysports.com' }), { status: 200 });
    if (u.includes('/rpc/')) return new Response('0', { status: 200 });
    if (u.includes('/rest/v1/frameup_reel_')) { posted.push({ u, body: opts.body ? JSON.parse(opts.body) : null }); return new Response('', { status: 201 }); }
    throw new Error(`unexpected fetch ${u}`);
  };
  try {
    const api = require('../netlify/functions/reel-maker.js');
    const { _test } = api;
    // plan (AI off -> grounded draft) keeps the data format.
    const plan = await _test.plan({ brief: 'The 49ers beat the Cowboys 46-40.', format: 'gameswing', sport: 'nfl' }, { email: 'e' }, { off: true });
    assert.equal(plan.plan.format, 'gameswing');
    assert.equal(plan.style, 'series', 'the format default style is suggested');
    const auth = { user: { email: 'editor@essentiallysports.com' } };
    await _test.projectSave({ project: { id: '00000000-0000-4000-8000-000000000001', format: 'archive', timeline: { v: 2 } } }, auth, 'tok');
    assert.equal(posted.at(-1).body.format, 'archive');
    await _test.recordEvent({ type: 'carousel_export', format: 'replay', payload: {} }, auth, 'tok');
    assert.equal(posted.at(-1).body.format, 'replay');
    assert.equal(posted.at(-1).body.type, 'carousel_export');
    await _test.projectSave({ project: { id: '00000000-0000-4000-8000-000000000001', format: 'nba-swing', timeline: {} } }, auth, 'tok');
    assert.equal(posted.at(-1).body.format, 'explainer', 'an unknown format still clamps');
    ['data', 'frames', 'carousel_export'].forEach(t => assert.ok(_test.EVENT_TYPES.includes(t)));

    // Dispatch stubs.
    assert.deepEqual(Object.keys(_test.FORMAT_MODES), ['games', 'game-data', 'athlete', 'archive-research', 'frame-pick']);
    assert.deepEqual(Object.fromEntries(Object.entries(_test.FORMAT_MODES).map(([k, v]) => [k, v.gate])), { games: 'data', 'game-data': 'data', athlete: 'data', 'archive-research': 'mcp', 'frame-pick': 'ai' });
    // Phase 1 (Agent A): every mode is landed; a null run still answers 501.
    for (const mode of Object.keys(_test.FORMAT_MODES)) assert.equal(typeof _test.FORMAT_MODES[mode].run, 'function', mode);
    const games = _test.FORMAT_MODES.games;
    const savedRun = games.run;
    try {
      games.run = null;
      const out = await _test.formatMode('games', {}, { token: 't' });
      assert.deepEqual([out.ok, out.status, out.reason, out.mode], [false, 501, 'coming-soon', 'games']);
      assert.match(out.error, /coming soon/);
    } finally { games.run = savedRun; }
    // Landed data modes validate input before any network call.
    assert.equal((await _test.formatMode('game-data', {}, { token: 't' })).status, 400);
    assert.equal((await _test.formatMode('nope', {}, {})).status, 400);
    // Through the handler (signed in): ESPN unreachable (fetch is mocked) -> soft fail.
    const res = await api.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer good' }, body: JSON.stringify({ mode: 'game-data', sport: 'nfl', eventId: '401873063' }) });
    assert.equal(res.statusCode, 502);
    assert.equal(JSON.parse(res.body).reason, 'data-unavailable');
    const cfg = JSON.parse((await api.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer good' }, body: JSON.stringify({ mode: 'config' }) })).body);
    assert.deepEqual(cfg.formats, F.FORMAT_IDS);
    assert.deepEqual(cfg.dataFormats, F.DATA_FORMAT_IDS);
    assert.deepEqual(cfg.formatModes, { games: true, 'game-data': true, athlete: true, 'archive-research': true, 'frame-pick': true });

    // A landed handler goes through its gate (ai: spend gate, then caps).
    const entry = _test.FORMAT_MODES['frame-pick'];
    const saved = entry.run;
    try {
      let ran = 0;
      entry.run = async () => { ran += 1; return { ok: true, setup: 0, play: 1, reaction: 2 }; };
      const gated = await _test.formatMode('frame-pick', {}, { token: 't' }, { aiSpendGate: async () => ({ status: 503, reason: 'budget', error: 'Paused' }) });
      assert.deepEqual([gated.status, gated.reason, ran], [503, 'budget', 0]);
      const capped = await _test.formatMode('frame-pick', {}, { token: 't' }, { aiSpendGate: async () => null, weekly: async () => false, hourly: async () => true });
      assert.deepEqual([capped.status, capped.reason, ran], [429, 'limit', 0]);
      const ok = await _test.formatMode('frame-pick', {}, { token: 't' }, { aiSpendGate: async () => null, weekly: async () => false, hourly: async () => false });
      assert.deepEqual([ok.ok, ran], [true, 1]);
      entry.run = async () => { throw new Error('boom'); };
      const err = await _test.formatMode('frame-pick', {}, { token: 't' }, { aiSpendGate: async () => null, weekly: async () => false, hourly: async () => false });
      assert.equal(err.status, 502);
    } finally { entry.run = saved; }
    const data = _test.FORMAT_MODES.games;
    const savedData = data.run;
    try {
      data.run = async body => ({ ok: true, games: [], sport: body.sport });
      const out = await _test.formatMode('games', { sport: 'nfl' }, { token: 't' }, { aiSpendGate: async () => { throw new Error('data modes never hit the spend gate'); }, hourly: async () => { throw new Error('nor the hourly cap'); } });
      assert.deepEqual([out.ok, out.sport], [true, 'nfl']);
    } finally { data.run = savedData; }
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('fixtures: every response fixture has the documented top-level shape', () => {
  const files = readdirSync(FIX);
  ['games-nfl.response.json', 'game-data-401873063.response.json', 'athlete-2330.response.json', 'athlete-search.response.json', 'archive-research-2330.response.json', 'frame-pick.response.json', 'nfl-401873063.digest.json', 'espn-nfl-summary-401873063.min.json'].forEach(f => assert.ok(files.includes(f), f));
  const games = fixture('games-nfl.response.json');
  assert.ok(games.ok && Array.isArray(games.games) && games.games[0].teams.home.abbr && games.games[0].status.final === true);
  assert.deepEqual(fixture('game-data-401873063.response.json').digest, fixture('nfl-401873063.digest.json'));
  const athlete = fixture('athlete-2330.response.json').athlete;
  const tl = { v: 2, canvas: { w: 1080, h: 1920 }, beats: [], data: { athlete } };
  assert.deepEqual(T.validateTimeline(tl).errors, []);
  const arch = fixture('archive-research-2330.response.json');
  assert.ok(arch.coverage.thin && arch.candidates.every(c => c.cite.length));
  arch.candidates.forEach(c => assert.ok(T.resolveRef(tl, c.cite[0]), `${c.id} cites a real stat row`));
  const pick = fixture('frame-pick.response.json');
  ['setup', 'play', 'reaction'].forEach(k => assert.ok(Number.isInteger(pick[k]) && pick[k] >= 0 && pick[k] < 9));
});

console.log(process.exitCode ? '\nReels formats core tests failed.' : `\nAll ${passed} reels formats core tests passed.`);
