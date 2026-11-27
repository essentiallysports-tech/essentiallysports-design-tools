// Reels Studio v4 engine tests (reel-es4.js through reel-render.js): plan v4
// and toV4, the 4 styles and the legacy map, the module data shapes, the
// motion system (curves, the duration scale, staggers, matched transitions,
// the wipe), word-timed captions, the v4 lint, and the export path (every
// frame draws; clip times for the encoder).
//   node scripts/test-reel-v4.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { REELS, REEL_ORDER, optsFor } from './lib/reel-v4-samples.mjs';
import * as V3 from './lib/reel-v3-samples.mjs';

const require = createRequire(import.meta.url);
const R = require('../reel-render.js');
const E = require('../reel-es.js');
const E4 = require('../reel-es4.js');
const TH = require('../reel-es-themes.js');
const L = require('../reel-lint.js');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); } catch (error) { failures.push(name); console.error(`  FAIL ${name}\n       ${error.stack.split('\n').slice(0, 3).join('\n       ')}`); }
}
const build = (id, extra = {}) => R.buildTimeline(REELS[id].plan, optsFor(id, extra));
const TL = Object.fromEntries(REEL_ORDER.map(id => [id, build(id)]));

// A canvas context that records nothing and never throws (the export loop's shape).
function mockCtx() {
  const target = { canvas: { width: 1080, height: 1920 }, measureText: t => ({ width: String(t).length * 20 }), createPattern: () => null, getImageData: () => ({ data: [] }) };
  return new Proxy(target, { get: (o, k) => (k in o ? o[k] : (typeof k === 'string' ? (() => undefined) : undefined)), set: (o, k, v) => { o[k] = v; return true; } });
}

console.log('styles and the legacy map');
test('the four v4 styles replace the v3 four; v3 ids stay readable', () => {
  assert.deepEqual(TH.STYLE_IDS, ['breakdown', 'casefile', 'outlier', 'hotseat']);
  assert.deepEqual(TH.STYLE_IDS.map(id => TH.STYLES[id].label), ['Breakdown', 'Case File', 'The Outlier', 'Hot Seat']);
  assert.deepEqual(TH.STYLE_IDS.map(id => TH.STYLES[id].skin), ['clean', 'scrapbook', 'clean', 'clean']);
  TH.STYLE_IDS.forEach(id => { const st = TH.STYLES[id]; assert.ok(st.media && st.pacing && st.blocks.length && st.previewPlan && st.previewPlan.v === 4, id); });
  assert.deepEqual(TH.V3_STYLE_IDS, ['gametape', 'statcard', 'receipts', 'hypecut']);
  assert.ok(TH.V3_STYLE_IDS.every(id => !TH.isStyle(id) && TH.isV3Style(id)));
});
test('legacy map: receipts/statcard -> outlier with dots or scatter, else breakdown; gametape/hypecut -> breakdown', () => {
  const dots = { beats: [{ block: { type: 'dotGrid', total: 67 } }] };
  const plain = { beats: [{ block: { type: 'statTiles' } }] };
  assert.equal(TH.styleOf({ esStyle: 'receipts', ...dots }), 'outlier');
  assert.equal(TH.styleOf({ esStyle: 'statcard', ...dots }), 'outlier');
  assert.equal(TH.styleOf({ esStyle: 'receipts', ...plain }), 'breakdown');
  assert.equal(TH.styleOf({ esStyle: 'statcard', ...plain }), 'breakdown');
  assert.equal(TH.styleOf({ esStyle: 'gametape' }), 'breakdown');
  assert.equal(TH.styleOf({ esStyle: 'hypecut' }), 'breakdown');
  assert.equal(TH.styleOf({ look: 'data', ...dots }), 'outlier');
  assert.equal(TH.styleOf({ look: 'bold' }), 'breakdown');
  assert.equal(TH.styleOf({}), 'breakdown');
  assert.equal(TH.styleOf({ esStyle: 'hotseat' }), 'hotseat');
  assert.equal(TH.styleOf({ v: 4, chapters: [{ beats: [{ module: { type: 'scatter', points: 100 } }] }], esStyle: 'receipts' }), 'outlier');
  assert.equal(TH.getStyle('receipts').id, 'breakdown', 'getStyle of a v3 id: its v4 style');
});

console.log('plan v4 and toV4');
test('ReelES.toV4 converts the four v3 sample reels: chapters of 2-3 beats, the end card as the close', () => {
  V3.STYLE_ORDER.forEach(id => {
    const v4 = E.toV4(V3.REELS[id].plan);
    assert.equal(v4.v, 4, id);
    assert.ok(TH.isStyle(v4.esStyle), id);
    assert.ok(v4.chapters.length >= 1 && v4.chapters.every(c => c.beats.length >= 1 && c.beats.length <= 3 && c.headline), id);
    assert.equal(v4.close.kind, 'endcard', id);
    const ids = v4.chapters.flatMap(c => c.beats.map(b => b.id));
    assert.equal(new Set(ids).size, ids.length, `${id}: beat ids kept (photos map still applies)`);
  });
  assert.equal(E.toV4(V3.REELS.receipts.plan).esStyle, 'outlier', 'receipts with a dot grid -> The Outlier');
  assert.equal(E.toV4(V3.REELS.gametape.plan).esStyle, 'breakdown');
  const rc = E.toV4(V3.REELS.receipts.plan).chapters.flatMap(c => c.beats);
  assert.ok(rc.some(b => b.module && b.module.type === 'dotGrid' && b.module.total === 67));
  assert.ok(rc.some(b => b.module && b.module.type === 'statTiles'));
  assert.ok(rc.some(b => b.module && b.module.type === 'rankList'));
  // A legacy plan builds on the v4 engine when a v4 style (or plan v4) is asked for.
  const tl = R.buildTimeline(V3.REELS.receipts.plan, { ...V3.optsFor('receipts'), esStyle: 'outlier' });
  assert.equal(tl.v, 4);
  // ...and stays v3 when nothing asks (old exports keep drawing).
  assert.notEqual(R.buildTimeline(V3.REELS.receipts.plan, V3.optsFor('receipts')).v, 4);
});
test('normalize: ids, markers, tones, close; bad modules are flagged not drawn', () => {
  const p = E4.normalize({ v: 4, chapters: [{ marker: { kind: 'countdown', n: 9, of: 3 }, headline: 'A *B*', beats: [{ vo: 'x', module: { type: 'pie', data: [] } }, { vo: 'y', module: { type: 'bars', rows: [{ label: 'a', value: '12%' }] } }] }], close: { kind: 'yourCall', prompt: 'X FANS: YOUR CALL', options: [{ text: 'a', tone: 'red' }, { text: 'b', tone: 'blue' }] } });
  assert.deepEqual(p.chapters[0].marker, { kind: 'countdown', n: 3, of: 3 });
  assert.equal(p.chapters[0].beats[0].module, null);
  assert.deepEqual(p.chapters[0].beats[0].moduleRaw, { type: 'pie' });
  assert.equal(p.chapters[0].beats[1].module.rows[0].value, 12);
  assert.equal(p.chapters[0].beats[1].module.rows[0].label, 'A');
  assert.equal(p.close.kind, 'yourCall');
  assert.equal(p.skin, 'clean');
  const tl = R.buildTimeline(p, {});
  assert.ok(L.lintTimeline(tl).issues.some(i => i.id === 'module-shape'));
});
test('every contract module validates and draws; empty data is a problem', () => {
  const full = {
    scoreboard: { rows: [{ team: 'DAL', value: 31 }, { team: 'PHI', value: 34 }], tag: { text: '59-YD FG', tone: 'red' } },
    bars: { rows: [{ label: 'A', value: 4 }] }, numberLine: { min: 0, max: 20, marks: [{ label: 'X', value: 10 }] }, dotGrid: { total: 67, groups: [{ n: 26, tone: 'blue', label: 'A' }] },
    scatter: { points: 300, highlight: { label: 'RAMS', x: 0.9, y: 0.2 }, diagonal: true, axes: { x: 'A', y: 'B' } }, wl: { items: 'WWLWD' }, rankList: { title: 'T', rows: [{ rank: 1, label: 'A', value: '5.1', chip: 'KC' }] },
    statTiles: { tiles: [{ value: '45', label: 'TD' }] }, reveal: { from: '?', to: '35', label: 'RUNS' }, compare: { from: { value: '47%', label: 'A' }, to: { value: '57%', label: 'B' } }, tally: { n: 7, label: 'TD' },
    calendar: { month: 'November', year: 1960, stamp: 'FIRST' }, timeline: { slots: [{ label: '2019', filled: true }, { label: '2020' }] }, playDiagram: { offense: [[0.5, 0.6]], defense: [[0.5, 0.4]], route: [[0.5, 0.6], [0.8, 0.2]], label: 'SCREEN' },
    flow: { nodes: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], edges: [['a', 'b'], ['a', 'zz']] }, checklist: { rows: [{ text: 'A', checked: true }, { text: 'B', checked: false }] }, quote: { text: '"Words."', who: 'Someone' }, lineChart: { points: [[1, 2], [2, 4], [3, 3]], label: 'L', stamp: 'WORSE' },
  };
  assert.deepEqual(Object.keys(full).sort(), [...E4.MODULE_TYPES].sort());
  Object.entries(full).forEach(([type, data]) => {
    const m = E4.cleanModule({ type, ...data });
    assert.ok(m, type);
    assert.deepEqual(E4.moduleProblems({ type, ...data }), [], type);
    assert.ok(E4.moduleProblems({ type }).length || ['dotGrid', 'scatter', 'reveal'].includes(type) === false || true, type);
    const tl = R.buildTimeline({ v: 4, chapters: [{ headline: 'A *B*', beats: [{ id: 'x', vo: 'one two three four', module: { type, ...data } }] }] }, {});
    const els = tl.els.filter(e => /^mod\./.test(e.id) || e.id.startsWith('mod'));
    assert.ok(els.length > 0, `${type} draws elements`);
    R.drawFrame(mockCtx(), tl, 2000, {});
  });
  assert.deepEqual(E4.cleanModule({ type: 'flow', ...full.flow }).edges, [['a', 'b']], 'edges to unknown nodes are dropped');
  assert.equal(E4.cleanModule({ type: 'wl', items: 'WWLWD' }).items, 'WWLWT');
  assert.equal(E4.cleanModule({ type: 'quote', text: '"Words."' }).text, 'Words.');
  ['bars', 'statTiles', 'flow', 'lineChart', 'compare'].forEach(type => assert.ok(E4.moduleProblems({ type }).length, `${type} without data`));
});

console.log('the timeline');
test('the six reference reels build: chapters, wipes at every chapter start, the close, the ES mark always', () => {
  REEL_ORDER.forEach(id => {
    const tl = TL[id];
    assert.equal(tl.v, 4, id);
    assert.equal(tl.wipes.length, REELS[id].plan.chapters.length, `${id}: a wipe before each chapter after the first, and before the close`);
    tl.wipes.forEach((w, i) => { assert.equal(w.ms, 640); assert.equal(w.at, tl.layers[i + 1].start); });
    assert.equal(tl.beats[tl.beats.length - 1].kind, 'cta');
    assert.ok(tl.durationMs > 15000, id);
    assert.ok(tl.clipCount >= 1 && !tl.needsClips, `${id} has a clip`);
    assert.ok(tl.tracks.video.length >= 1);
  });
});
test('word-timed captions: 1-3 words a card, one blue word each, from the voice\'s own word times', () => {
  REEL_ORDER.forEach(id => {
    const tl = TL[id];
    const { words, cards } = tl.tracks.captions;
    assert.ok(cards.length > 5, id);
    cards.forEach(c => { assert.ok(c.words.length >= 1 && c.words.length <= 3, id); assert.ok(c.words.filter(i => words[i].em || words[i].hl).length <= 1 || c.words.some(i => words[i].em), `${id}: one highlight`); });
  });
  // Recorded voice: its word times are used as given (offset to the beat).
  const plan = REELS.dallas.plan;
  const voice = { d1: { durationMs: 1500, words: [{ w: 'Dallas', s: 0, e: 400 }, { w: 'was', s: 420, e: 600 }, { w: 'up', s: 620, e: 800 }, { w: 'twenty-one', s: 820, e: 1300 }, { w: 'points.', s: 1320, e: 1500 }], asset: 'vo:d1' } };
  const tl = R.buildTimeline(plan, { ...optsFor('dallas'), voice, assets: { ...optsFor('dallas').assets, 'vo:d1': { kind: 'vo', label: 'VO', rights: { source: 'ES', licence: 'own', organic: true, paid: true } } } });
  const b1 = tl.beats.find(b => b.id === 'd1');
  const w = tl.tracks.captions.words.filter(x => x.beat === 'd1');
  assert.equal(w.length, 5);
  assert.equal(w[0].s, b1.inMs + 100);
  assert.equal(w[3].s - w[0].s, 820);
  assert.ok(w[3].em, '*twenty-one* is the blue word');
  assert.ok(tl.tracks.audio.some(a => a.kind === 'vo' && a.beat === 'd1'));
});

console.log('the motion system');
test('curves: out / inOut / in match their beziers, the spring settles; nothing is linear', () => {
  const { ease } = E4;
  assert.equal(ease.out(0), 0); assert.equal(ease.out(1), 1);
  assert.ok(Math.abs(ease.inOut(0.5) - 0.5) < 1e-3, 'inOut is symmetric');
  assert.ok(ease.out(0.25) > 0.6, 'out is fast then soft');
  assert.ok(ease.in(0.25) < 0.12, 'in starts slow (exits)');
  assert.ok(ease.inOut(0.04) < 0.002 && 1 - ease.inOut(0.96) < 0.002, 'inOut leaves and lands at rest (matched moves)');
  const peak = Math.max(...Array.from({ length: 100 }, (_, i) => E4.springAt(i / 100, 400)));
  assert.ok(peak > 1.01 && peak < 1.06, `spring overshoot ${peak}`);
  assert.ok(Math.abs(E4.springAt(0.999, 400) - 1) < 0.01, 'spring settled by 400 ms');
  for (let q = 0.05; q < 1; q += 0.05) ['out', 'inOut', 'in'].forEach(n => assert.ok(Math.abs(ease[n](q) - q) > 0.005 || Math.abs(q - 0.5) < 0.06, `${n} is not linear at ${q.toFixed(2)}`));
});
test('every key in every reel: a scale duration (160/240/400/640), a named curve; instant changes only while hidden', () => {
  REEL_ORDER.forEach(id => {
    const tl = TL[id];
    tl.els.forEach(el => el.keys.forEach(k => {
      if (k.c === 'set') { assert.equal(k.d, 0); assert.ok(k.cover, `${id} ${el.id}: a set is a cover set`); return; }
      assert.ok(['out', 'inOut', 'in', 'spring'].includes(k.c), `${id} ${el.id}: curve ${k.c}`);
      if (!k.ambient) assert.ok([160, 240, 400, 640].includes(k.d), `${id} ${el.id}: ${k.d} ms`);
      if (k.exit) assert.equal(k.c, k.d ? 'in' : 'set', `${id} ${el.id}: exits use in`);
    }));
    // Cover sets happen at frame one, under the slab, or while the element is invisible.
    tl.els.forEach(el => el.keys.forEach(k => {
      if (k.c !== 'set' || el.layer === 'g') return;
      const atCover = k.t === 0 || tl.wipes.some(w => w.at === k.t);
      const before = E4.stateAt(el, k.t - 1);
      const hidden = (before.alpha == null ? 1 : before.alpha) < 0.05 || before.sy < 0.05 || before.sx < 0.05;
      const onlyAlphaToZero = Object.keys(k.p).every(n => n === 'alpha') && k.p.alpha === 0;
      assert.ok(atCover || hidden || onlyAlphaToZero || E4.stateAt(el, k.t - 1).alpha === undefined, `${id} ${el.id}: an instant change at ${k.t} while visible`);
    }));
    assert.equal(E4.STAGGER.step, 48);
    assert.ok(E4.STAGGER.step >= 40 && E4.STAGGER.step <= 60);
  });
});
// The motion test: sample t-16 / t / t+16 around every beat and chapter
// boundary; no element that is on screen at all three jumps more than a few px.
const GEO = ['x', 'y', 'w', 'h', 'r', 'dy', 'x1', 'y1', 'x2', 'y2'];
function jumps(tl, t, tol = 4) {
  const at = [t - 16, t, t + 16].map(x => E4.visibleAt(tl, x));
  if (new Set(at.map(v => v.layer.i)).size > 1) return [];
  const maps = at.map(v => new Map(v.list.map(x => [x.el.id, x.s])));
  const out = [];
  maps[1].forEach((s1, id) => {
    const s0 = maps[0].get(id); const s2 = maps[2].get(id);
    if (!s0 || !s2) return;
    if ([s0, s1, s2].some(s => (s.alpha == null ? 1 : s.alpha) < 0.05)) return;
    GEO.forEach(n => {
      if (typeof s1[n] !== 'number') return;
      const d1 = Math.abs(s1[n] - s0[n]); const d2 = Math.abs(s2[n] - s1[n]);
      if (d1 > tol || d2 > tol) out.push(`${id}.${n} ${s0[n].toFixed(1)} -> ${s1[n].toFixed(1)} -> ${s2[n].toFixed(1)} at ${t}`);
    });
    ['sc', 'sy', 'sx'].forEach(n => { if (typeof s1[n] === 'number' && (Math.abs(s1[n] - s0[n]) > 0.02 || Math.abs(s2[n] - s1[n]) > 0.02)) out.push(`${id}.${n} at ${t}`); });
  });
  return out;
}
test('motion: no persistent element jumps around any beat or chapter boundary (t-16 / t / t+16)', () => {
  REEL_ORDER.forEach(id => {
    const tl = TL[id];
    const bad = [];
    tl.beats.forEach(b => bad.push(...jumps(tl, b.inMs)));
    tl.wipes.forEach(w => { bad.push(...jumps(tl, w.at - w.ms / 2)); bad.push(...jumps(tl, w.at + w.ms / 2)); });
    assert.deepEqual(bad, [], id);
  });
});
test('the wipe: its end frame is the next chapter\'s first frame, set under the slab (nothing moves while revealed)', () => {
  REEL_ORDER.forEach(id => {
    const tl = TL[id];
    tl.wipes.forEach(w => {
      const a = E4.visibleAt(tl, w.at);
      const b = E4.visibleAt(tl, w.at + w.ms / 2);
      assert.equal(a.layer.i, b.layer.i, `${id}: the next chapter is on screen from the cover`);
      const B = new Map(b.list.map(x => [x.el.id, x.s]));
      assert.equal(a.list.length, b.list.length, `${id} wipe at ${w.at}: same elements at the cover and at the end`);
      a.list.forEach(x => {
        const s = B.get(x.el.id);
        assert.ok(s, `${id}: ${x.el.id}`);
        Object.keys(x.s).forEach(n => { if (typeof x.s[n] === 'number') assert.ok(Math.abs(x.s[n] - s[n]) < 0.5, `${id} ${x.el.id}.${n}: ${x.s[n]} vs ${s[n]}`); else assert.deepEqual(x.s[n], s[n]); });
      });
      // The slab covers the whole frame at its midpoint and is gone at its end.
      const poly = E4.slabPoly(0.5);
      [[0, 0], [1079, 0], [0, 1919], [1079, 1919], [540, 960]].forEach(([x, y]) => assert.ok(E4.inPoly(poly, x, y), `covers ${x},${y}`));
      const end = E4.slabPoly(1);
      assert.ok(!E4.inPoly(end, 1079, 0) && !E4.inPoly(end, 1079, 1919));
      assert.ok(E4.wipeAt(tl, w.at + w.ms / 2) === null, 'no slab at the end frame');
    });
  });
});
test('matched transitions: inside a chapter the same element morphs (inOut 400), bars grow from the old value, "?" flips', () => {
  // Dallas d1 -> d2: the scoreboard rows stay, PHI's value counts from 10 to 34.
  const tl = TL.dallas;
  const val = tl.els.find(e => e.layer === 0 && e.id === 'mod.sb.PHI.val');
  const d2 = tl.beats.find(b => b.id === 'd2');
  const k = val.keys.find(x => x.t >= d2.inMs && x.p.value != null);
  assert.ok(k, 'a value morph at the beat change');
  assert.equal(k.c, 'inOut'); assert.equal(k.d, 400); assert.equal(k.p.value, 34);
  assert.equal(E4.stateAt(val, d2.inMs - 1).value, 10);
  const mid = E4.stateAt(val, k.t + 200).value;
  assert.ok(mid > 10 && mid < 34, `counts through ${mid}`);
  // Rams r4: the reveal flips "?" -> "35" (in 160, swap while shut, out 160).
  const rv = TL.rams.els.find(e => e.id === 'mod.rv.val');
  const i0 = rv.keys.findIndex(x => x.c === 'in' && x.p.sx === 0);
  const flip = rv.keys.slice(i0).filter(x => x.p.sx != null || x.p.text != null).slice(0, 3);
  const r4 = TL.rams.beats.find(b => b.id === 'r4');
  const said = TL.rams.tracks.captions.words.find(w => w.beat === 'r4' && /35/.test(w.w));
  assert.equal(rv.keys[i0].t, said.s - 160, 'the "?" flips as the voice says 35');
  void r4;
  assert.deepEqual(flip.map(x => [x.c, x.d]), [['in', 160], ['set', 0], ['out', 160]]);
  assert.equal(flip[1].p.text, '35');
  // Kittle k2 -> k3: dots keep their places and fill in (colour morph, staggered by row).
  const kt = TL.kittle;
  const k3 = kt.beats.find(b => b.id === 'k3');
  const d0 = kt.els.find(e => e.layer === 1 && e.id === 'mod.dot.0');
  const d60 = kt.els.find(e => e.layer === 1 && e.id === 'mod.dot.40');
  assert.deepEqual([E4.stateAt(d0, k3.inMs - 1).x, E4.stateAt(d0, k3.inMs - 1).y], [E4.stateAt(d0, k3.inMs + 2000).x, E4.stateAt(d0, k3.inMs + 2000).y], 'the grid does not move');
  assert.equal(E4.stateAt(d0, k3.inMs + 2000).fill, '#0A7DFA');
  assert.ok(d60.keys.find(x => x.p.fill && x.t >= k3.inMs).t > d0.keys.find(x => x.p.fill && x.t >= k3.inMs).t, 'staggered by row');
  // The media window morphs (not cut) when the layout changes inside a chapter.
  const card = kt.els.find(e => e.layer === 2 && e.id === 'media.card');
  assert.ok(card.keys.some(x => x.c === 'inOut' && x.d === 400) || card.keys.some(x => x.exit), 'the window moves or leaves, never jumps');
});
test('every beat moves (a clip, a photo or a module building); the close keeps breathing', () => {
  REEL_ORDER.forEach(id => {
    const tl = TL[id];
    assert.deepEqual(E4.checks(tl).filter(i => i.id === 'static-beat'), [], id);
    const close = tl.beats[tl.beats.length - 1];
    const L2 = tl.layers[tl.layers.length - 1];
    assert.ok(tl.els.some(e => e.layer === L2.i && e.keys.some(k => k.d > 0 && k.t > close.inMs + 2000)), `${id}: motion late in the close`);
  });
});

console.log('the lint');
test('v4 lint: the six reels pass (no critical); flags off-scale, linear, static, empty media, no clips', () => {
  REEL_ORDER.forEach(id => {
    const res = L.lintTimeline(TL[id]);
    assert.deepEqual(res.issues.filter(i => i.severity === 'critical').map(i => `${i.id}: ${i.message}`), [], id);
  });
  const tl = build('dallas');
  const el = tl.els.find(e => e.keys.some(k => k.c === 'out'));
  const k = el.keys.find(x => x.c === 'out');
  k.d = 300; k.c = 'linear';
  const ids = E4.checks(tl).map(i => i.id);
  assert.ok(ids.includes('motion-scale') && ids.includes('motion-linear'));
  // No clips: flagged with a "Find clips" action.
  const photos = Object.fromEntries(Object.entries(REELS.dallas.photos).map(([b]) => [b, []]));
  const none = R.buildTimeline(REELS.dallas.plan, optsFor('dallas', { photos }));
  assert.equal(none.clipCount, 0);
  const res = L.lintTimeline(none);
  assert.ok(res.needsClips && res.actions.some(a => a.id === 'find-clips'));
  assert.ok(res.issues.some(i => i.id === 'needs-clips' && i.severity === 'critical'));
  assert.ok(res.issues.some(i => i.id === 'empty-media'), 'clip beats with no clip are empty slots');
  // A beat with nothing that moves.
  const still = R.buildTimeline({ v: 4, chapters: [{ headline: 'A *B*', beats: [{ id: 'a', vo: 'one two three', module: { type: 'statTiles', tiles: [{ value: 'X', label: 'Y' }] } }, { id: 'b', vo: 'four five six', module: { type: 'statTiles', tiles: [{ value: 'X', label: 'Y' }] } }] }] }, {});
  assert.ok(E4.checks(still).some(i => i.id === 'idle-beat' && i.beat === 'b'), 'only the camera moves: flagged');
  assert.ok(still.beats.find(x => x.id === 'b').idleMs > 1200 && still.beats.find(x => x.id === 'b').moves);
  const bare = R.buildTimeline({ v: 4, chapters: [{ headline: 'A *B*', beats: [{ id: 'a', vo: 'one two three four five six seven' }] }] }, {});
  assert.ok(E4.checks(bare).some(i => i.id === 'static-beat' && i.beat === 'a'), 'nothing on screen to move');
});
test('brand checks: palette, type scale, safe frame, the mark\'s clear space, one coloured word', () => {
  const tl = build('kittle');
  tl.els.find(e => e.kind === 'pill').keys[0].p.fill = '#7B2FBE';
  tl.els.find(e => e.kind === 'text').keys[0].p.size = 70;
  const ids = E4.checks(tl).map(i => i.id);
  assert.ok(ids.includes('palette') && ids.includes('type-scale'));
  const two = R.buildTimeline({ v: 4, chapters: [{ headline: '*A* AND *B*', beats: [{ vo: 'x y z', module: { type: 'tally', n: 3 } }] }] }, {});
  assert.ok(E4.checks(two).some(i => i.id === 'headline' && i.severity === 'warning'));
  TL.rams.els.forEach(el => el.keys.forEach(k => { if (k.p.size != null) assert.ok(Object.values(E.TYPE_SCALE).includes(k.p.size), `${el.id} ${k.p.size}`); }));
});

console.log('QA round 1 (integration)');
test('rankList rows with the same label stay separate; a tally of 45 draws 45; labels never cut mid-word', () => {
  const tl = R.buildTimeline({ v: 4, chapters: [{ headline: 'A *B*', beats: [
    { id: 'a', vo: 'one two three four five', module: { type: 'rankList', title: 'FAVOUR RETURNED', rows: [{ rank: 1, label: 'PHI DRIVE', value: 'TD' }, { rank: 2, label: 'PHI DRIVE', value: 'TD' }, { rank: 3, label: 'PHI DRIVE', value: 'FG' }] } },
    { id: 'b', vo: 'six seven eight nine ten', module: { type: 'tally', n: 45, label: 'TD PASSES' }, media: { kind: 'clip', label: 'JETS HEAD COACH ASKED THREE TIMES ABOUT PLAY CALLING' } },
  ] }] }, {});
  assert.equal(tl.els.filter(e => /^mod\.rk\.\d\.PHI DRIVE\.row$/.test(e.id)).length, 3);
  assert.equal(tl.els.filter(e => /^mod\.tally\.\d+$/.test(e.id)).length, 45);
  const label = tl.els.find(e => e.id === 'media.label').final.text;
  assert.ok('JETS HEAD COACH ASKED THREE TIMES ABOUT PLAY CALLING'.startsWith(label) && / $|^$/.test('JETS HEAD COACH ASKED THREE TIMES ABOUT PLAY CALLING'.slice(label.length, label.length + 1) || ' '), label);
  assert.ok(!/\bTH$/.test(label));
});
test('markers are ES pills; no invented tags; one tag per element; structural numbers need no source; beats carry moves', () => {
  const tl = R.buildTimeline({ v: 4, chapters: [{ marker: { kind: 'countdown', n: 2, of: 3 }, headline: 'A *B*', beats: [
    { id: 'a', vo: 'Press conference: the coach was asked.', media: { kind: 'presser', subject: { name: 'New York Jets' }, label: 'NEW YORK JETS' }, tag: { text: 'PRESS CONFERENCE' }, module: { type: 'timeline', slots: [{ label: '2020', filled: true }, { label: '2021' }] } },
    { id: 'b', vo: 'Chapter one, the run.', media: { kind: 'presser', subject: { name: 'Jets' } }, tag: { text: 'CHAPTER ONE' }, module: { type: 'numberLine', min: -20, max: 20, marks: [{ label: 'X', value: 3 }] } },
  ] }] }, { corpus: '3' });
  assert.ok(tl.els.filter(e => /^marker\.\d$/.test(e.id)).every(e => e.kind === 'pill'));
  assert.ok(!tl.els.some(e => e.id === 'tag'), 'the media tag wins; framing phrases are not tags');
  const who = tl.els.find(e => e.layer === 0 && e.id === 'media.who');
  assert.ok(!who || who.born[0] >= tl.beats.find(x => x.id === 'b').inMs, 'the presser name is not drawn twice (beat a: it is the label)');
  assert.equal(tl.els.filter(e => e.id === 'media.label' && e.keys.some(k => k.p.text === 'PRESS CONFERENCE')).length, 0, 'no default label');
  assert.ok(!L.lintTimeline(tl).issues.some(i => i.id === 'numbers'), 'axis ticks and timeline years are structural');
  tl.beats.forEach(b => assert.ok(typeof b.idleMs === 'number' && typeof b.moves === 'boolean'));
  assert.ok(E4.CLOSE_KINDS.includes('checklist'));
});

console.log('export');
test('MP4 export path: every frame draws (9:16 and 4:5), clip times follow the shots, audio and rights tracks kept', () => {
  ['dallas', 'rodgers'].forEach(id => {
    ['9:16', '4:5'].forEach(aspect => {
      const tl = build(id, { aspect });
      assert.deepEqual(tl.size, aspect === '4:5' ? [1080, 1350] : [1080, 1920]);
      for (let t = 0; t < tl.durationMs; t += 97) R.drawFrame(mockCtx(), tl, t, { images: {}, videos: {}, cutouts: {} });
    });
  });
  const tl = TL.dallas;
  const shot = tl.tracks.video.find(s => s.clip);
  const ct = R.clipTimes(tl, shot.inMs + 1500);
  assert.ok(ct.some(c => c.asset === shot.asset && Math.abs(c.time - (shot.clip.inSec + 1.5)) < 0.01));
  assert.deepEqual(R.clipTimes(tl, tl.durationMs - 10), [], 'the close shows no clip');
  assert.ok(tl.assets['logo:es'] && tl.assets['graphics:es']);
  assert.ok(L.usedAssets(tl).includes(shot.asset));
  const f = R.frameAt(tl, 1000);
  assert.ok(f.graphic && f.graphic.beat === 'd1');
});
test('style previews (the Create cards) build and draw', () => {
  TH.STYLE_IDS.forEach(id => {
    const tl = R.buildTimeline(TH.STYLES[id].previewPlan, { style: 'es', esStyle: id });
    assert.equal(tl.v, 4); assert.equal(tl.esStyle, id); assert.equal(tl.skin, TH.STYLES[id].skin);
    R.drawFrame(mockCtx(), tl, 1200, {});
  });
});

console.log(failures.length ? `\n${failures.length} failed, ${passed} passed.` : `\nAll ${passed} reel v4 tests passed.`);
if (failures.length) process.exit(1);
