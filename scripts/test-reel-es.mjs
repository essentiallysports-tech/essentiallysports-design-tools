#!/usr/bin/env node
// ES Reels (reel-es.js): the ES video team's reels design system in Reels
// Studio. Blocks and their exact fields, safe-frame maths (9:16 and 4:5), the
// checklist as lint rules, captions, the end card, timing, the motion
// constants, the script splitter (never rewrites) and the director's block
// validation (mocked). Pure: no DOM, no network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../reel-es.js');
const R = require('../reel-render.js');
const L = require('../reel-lint.js');
const S = require('../reel-styles.js');
const F = require('../reel-formats.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
// Roboto Condensed 800 runs about 0.47 em per capital.
const measure = (text, font) => String(text).length * Number(String(font).match(/([\d.]+)px/)[1]) * 0.47;
const stubCtx = calls => new Proxy({}, {
  get(target, key) {
    if (key in target) return target[key];
    if (key === 'measureText') return text => ({ width: String(text).length * 20 });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => { calls.gradient = (calls.gradient || 0) + 1; return { addColorStop() {} }; };
    if (key === 'createPattern') return () => null;
    return (...args) => { calls[key] = (calls[key] || 0) + 1; (calls.log || (calls.log = [])).push([key, ...args]); };
  },
  set(target, key, value) { target[key] = value; if (key === 'fillStyle') (calls.fills || (calls.fills = [])).push(value); return true; },
});

// Four stories from the kit's own examples (the shipped Kalshi reel).
const STAT = { format: 'stat', title: 'Kalshi bars', sourceLine: 'Source: Kalshi', beats: [
  { id: 'b1', kind: 'hook', block: { type: 'hook', pills: [{ text: 'THE CUBS LOST.', color: 'ink' }, { text: 'THIS BAR GOT PAID.', color: 'red', size: 110 }], stamp: { text: 'PAID' } }, vo: 'The Cubs lost. This bar got *paid.*' },
  { id: 'b2', kind: 'point', block: { type: 'statement', lines: [{ text: "IT WASN'T", color: 'ink' }, { text: 'INSURANCE.', color: 'blue' }] }, vo: "It wasn't insurance. It was a bet against its own team." },
  { id: 'b3', kind: 'stat', block: { type: 'number', kicker: 'KALSHI TRADES', value: 274000, label: 'CONTRACTS', color: 'blue' }, vo: 'On Kalshi, bars traded *274,000* contracts on the games.' },
  { id: 'b4', kind: 'cta', block: { type: 'endcard' } },
] };
const SCALE = { format: 'stat', title: 'Kalshi dots', sourceLine: 'Source: Kalshi', beats: [
  { id: 'b1', kind: 'hook', block: { type: 'hook', pills: [{ text: '2,521 BETS.' }, { text: 'ONE WAS' }, { text: 'INSURANCE.', color: 'green' }] }, vo: 'Of 2,521 bets, only *one* was insurance.' },
  { id: 'b2', kind: 'dotrank', block: { type: 'dots', label: 'EVERY BET ON GAMES', count: 2521, highlight: 1, note: '1 WAS INSURANCE' }, vo: 'Here is every bet on the games. Just 1 of them was insurance.' },
  { id: 'b3', kind: 'bars', block: { type: 'compare', kicker: 'HOW THEY BET', items: [{ label: 'ON THE GAMES', value: 692, display: '$692M', color: 'red' }, { label: 'AS INSURANCE', value: 0.3, display: '$0.3M', color: 'green' }] }, vo: 'That is $692M on the games, and $0.3M as insurance.' },
  { id: 'b4', kind: 'cta', block: { type: 'endcard' } },
] };
const QUOTE_SCRIPT = '"I didn\'t see a false start," Andy Reid said after the loss. Reid has seen a lot of football. "I didn\'t see a false start," Andy Reid said. The league reviewed the play on Monday. Fans are still arguing about it.';
const COMPARE_SCRIPT = 'Bars are betting against their own teams. Bettors put $692M on the games, compared to $0.3M as insurance. That is the gap. And it keeps growing.';
const build = (plan, opts = {}) => R.buildTimeline(plan, { style: 'es', corpus: '2,521 1 274,000 $692M $0.3M 692 0.3', ...opts });

// ─── Tokens and type ─────────────────────────────────────────────────────
await test('tokens: ES blue, ink, paper and the three signals, exactly; display type condensed black, 0.84 / -0.01em; boxed words 0.16em', () => {
  assert.deepEqual(E.TOKENS, { blue: '#0A7DFA', ink: '#121212', paper: '#F1EFEA', green: '#1BC47D', red: '#E8322B', yellow: '#FFC52F', white: '#FFFFFF' });
  assert.deepEqual(E.SIGNALS, ['green', 'red', 'yellow']);
  assert.match(E.TYPE.display, /^"Acumin Pro Condensed Black", "Roboto Condensed"/);
  assert.equal(E.TYPE.displayWeight, 800);
  assert.equal(E.TYPE.small, 'Roboto, sans-serif');
  assert.equal(E.TYPE.smallWeight, 500);
  assert.equal(E.TYPE.lineHeight, 0.84);
  assert.equal(E.TYPE.tracking, -0.01);
  assert.equal(E.TYPE.pad, 0.16);
  // Every style shares the brand layer (no navy, no off-brand blues).
  S.STYLE_IDS.forEach(id => {
    const p = S.STYLES[id].palette;
    assert.equal(p.accent, '#0A7DFA', id); assert.equal(p.good, '#1BC47D', id); assert.equal(p.bad, '#E8322B', id); assert.equal(p.hi, '#FFC52F', id);
    assert.ok([p.paper, p.bg].every(c => ['#F1EFEA', '#121212'].includes(c)), `${id} ground ${p.paper}`);
  });
  // A boxed word hugs cap-height to baseline with 0.16em all round.
  const b = E.hugBox(100, 500, 300, 100);
  assert.deepEqual(b, { x: 84, y: 500 - 71 - 16, w: 332, h: 71 + 32 });
});

await test('ES Reels is the default style for news reels; the other looks stay pickable', () => {
  assert.equal(S.STYLE_IDS[0], 'es');
  assert.equal(S.DEFAULT_STYLE, 'es');
  assert.equal(S.suggestStyle({ text: 'Chiefs sign a receiver' }).id, 'es');
  assert.equal(S.STYLES.es.engine, 'es');
  assert.equal(S.STYLES.es.motion.transition, 'slab');
  assert.equal(S.STYLES.es.caption.mode, 'es');
  assert.deepEqual(S.validateStyle(S.STYLES.es), []);
});

// ─── Blocks ──────────────────────────────────────────────────────────────
await test('blocks: the seven blocks with exactly their fields; anything else is dropped', () => {
  assert.deepEqual(E.BLOCK_TYPES, ['hook', 'statement', 'number', 'dots', 'compare', 'quote', 'endcard']);
  assert.deepEqual(E.BLOCKS.hook.fields, ['media', 'pills', 'stamp']);
  assert.deepEqual(E.BLOCKS.statement.fields, ['lines', 'media', 'top']);
  assert.deepEqual(E.BLOCKS.number.fields, ['value', 'prefix', 'suffix', 'label', 'kicker', 'color']);
  assert.deepEqual(E.BLOCKS.dots.fields, ['count', 'highlight', 'label', 'note']);
  assert.deepEqual(E.BLOCKS.compare.fields, ['items', 'kicker']);
  assert.deepEqual(E.BLOCKS.quote.fields, ['text', 'who']);
  assert.deepEqual(E.BLOCKS.endcard.fields, ['cta']);
  const hook = E.cleanBlock({ type: 'hook', pills: [{ text: 'A', color: 'purple', glow: true }], stamp: { text: 'PAID NOW', at: 2.4 }, eyebrow: 'x' });
  assert.deepEqual(hook, { type: 'hook', pills: [{ text: 'A', color: 'ink' }], stamp: { text: 'PAID', at: 2.4 } }, 'one-word stamp, unknown colour -> ink, extra fields gone');
  assert.deepEqual(E.cleanBlock({ type: 'quote', text: '"Exact words."', by: 'Andy Reid', extra: 1 }), { type: 'quote', text: 'Exact words.', who: 'Andy Reid' });
  assert.deepEqual(E.cleanBlock({ type: 'endcard' }).cta, ['WE BRING', 'THE RECEIPTS.'], 'the default CTA');
  assert.deepEqual(Object.keys(E.cleanBlock({ type: 'number', value: '$274,000', foo: 1 })).sort(), ['color', 'kicker', 'label', 'prefix', 'suffix', 'type', 'value']);
  assert.equal(E.cleanBlock({ type: 'number', value: '274,000' }).value, 274000);
});

await test('blocks: every Reels Studio beat kind lands on a block, and a block rides on a known kind', () => {
  F.KINDS.forEach(kind => assert.ok(E.BLOCK_TYPES.includes(E.BLOCK_FOR_KIND[kind]), kind));
  Object.values(E.KIND_FOR).forEach(kind => assert.ok(F.KINDS.includes(kind)));
  assert.equal(E.blockOf({ kind: 'stat', text: 'Pass yards', stat: { value: '5,477', label: 'pass yds' } }).value, 5477);
  assert.equal(E.numberDisplay(E.blockOf({ kind: 'stat', stat: { value: '$12.3M' } })), '$12.3M');
  assert.deepEqual(E.blockOf({ kind: 'bars', text: 'How', bars: [{ label: 'A', value: '2×' }, { label: 'B', value: '1×' }] }).items.map(i => [i.label, i.value]), [['A', 2], ['B', 1]]);
  assert.deepEqual(E.blockOf({ kind: 'chips', chips: { filled: '1', total: '5', label: 'deep shots' } }), { type: 'dots', count: 5, highlight: 1, label: 'deep shots', note: '' });
  assert.equal(E.blockOf({ kind: 'cta', text: 'What do you think?' }).type, 'endcard');
  const hook = E.blockOf({ kind: 'hook', text: 'Bars are betting against their own teams', emphasis: 'betting' });
  assert.ok(hook.pills.length >= 2 && hook.pills.length <= 3);
  assert.deepEqual(hook.stamp, { text: 'betting' });
  // Legacy fields keep the rest of Reels Studio working.
  const lf = E.legacyFields({ type: 'compare', items: [{ label: 'X', display: '$692M' }, { label: 'Y', display: '$0.3M' }] });
  assert.equal(lf.kind, 'bars');
  assert.deepEqual(lf.bars, [{ label: 'X', value: '$692M' }, { label: 'Y', value: '$0.3M' }]);
  assert.ok(E.takesMedia({ kind: 'hook' }) && E.takesMedia({ kind: 'point' }) && !E.takesMedia({ kind: 'stat' }));
});

// ─── Layout and safe frame ───────────────────────────────────────────────
await test('geometry: column 60 / 960, safe frame y 300-1640 and 40 px sides, captions at 1172, the mark 80 px right 60 top 330', () => {
  const g = E.geometry([1080, 1920]);
  assert.deepEqual(g.col, { x: 60, w: 960 });
  assert.deepEqual(g.safe, { top: 300, bottom: 1640, side: 40 });
  assert.equal(g.captionY, 1172);
  assert.deepEqual(g.mark, { size: 80, x: 940, y: 330, clear: 40 });
  assert.equal(g.logotype.h, 96);
  // 4:5: the same rules, vertical positions scaled by 1350/1920; the marks stay full size.
  const f = E.geometry([1080, 1350]);
  assert.deepEqual(f.safe, { top: 211, bottom: 1153, side: 40 });
  assert.equal(f.captionY, 824);
  assert.deepEqual(f.mark, { size: 80, x: 940, y: 232, clear: 40 });
  assert.ok(E.outsideSafe({ x: 60, y: 290, w: 100, h: 50 }) && E.outsideSafe({ x: 30, y: 400, w: 100, h: 50 }) && E.outsideSafe({ x: 60, y: 1600, w: 100, h: 50 }));
  assert.ok(!E.outsideSafe({ x: 40, y: 300, w: 1000, h: 1340 }));
});

await test('safe frame: every word of four sample reels (and their 4:5 versions) sits inside it, clear of the mark', () => {
  const stories = [STAT, SCALE, E.scriptToPlan(QUOTE_SCRIPT, { sourceLine: 'Source: ESPN' }), E.scriptToPlan(COMPARE_SCRIPT, { sourceLine: 'Source: Kalshi' })];
  stories.forEach((plan, n) => ['9:16', '4:5'].forEach(aspect => {
    const tl = build(plan, { aspect, corpus: `${plan.script ? plan.script.text : ''} 2,521 1 274,000 $692M $0.3M 692 0.3` });
    const boxes = R.textBoxes(measure, tl);
    assert.ok(boxes.length > 8);
    const out = boxes.filter(b => E.outsideSafe(b, tl.size));
    assert.deepEqual(out.map(b => `${b.role}:${b.text}`), [], `story ${n + 1} ${aspect}`);
    const mk = E.markRect(tl.size);
    R.logoPlacements(tl).forEach(m => boxes.filter(b => b.beat === m.beat).forEach(b => {
      const hit = b.x < mk.x + mk.w + mk.clear && b.x + b.w > mk.x - mk.clear && b.y < mk.y + mk.h + mk.clear && b.y + b.h > mk.y - mk.clear;
      assert.ok(!hit, `story ${n + 1} ${aspect}: ${b.role} in the mark's clear space`);
    }));
    const lint = L.lintTimeline(tl, { boxes, measure });
    assert.equal(lint.critical, 0, `story ${n + 1} ${aspect}: ${JSON.stringify(lint.issues.filter(i => i.severity === 'critical'))}`);
  }));
});

await test('layout: boxed pills hug their glyphs on the 60 px column; statements stack at 0.84; the stamp tilts -9°', () => {
  const tl = build(STAT);
  const hook = R.layoutGraphic(measure, tl.tracks.graphics[0], tl);
  const pill = hook.find(o => o.role === 'pill');
  const box = E.hugBox(pill.x, pill.y, pill.w, pill.size);
  assert.equal(Math.round(box.x), 60, 'box on the column');
  assert.equal(Math.round(box.y), 480, 'hook pills start below the mark\'s clear space');
  assert.equal(pill.fill, 'ink');
  assert.equal(hook.find(o => o.role === 'pill' && o.fill === 'red').color, 'white');
  const stamp = hook.find(o => o.role === 'stamp');
  assert.equal(stamp.rot, -9); assert.equal(stamp.fill, 'red'); assert.equal(stamp.text, 'PAID');
  const st = R.layoutGraphic(measure, tl.tracks.graphics[1], tl).filter(o => o.role === 'line');
  assert.ok(Math.abs((st[1].y - st[0].y) - st[0].size * 0.84) < 0.01, 'line-height 0.84');
  assert.equal(st[1].color, 'blue');
  assert.ok(Math.abs(st[0].track + st[0].size * 0.01) < 1e-9, '-0.01em tracking');
  // The tilted stamp's box (axis-aligned) is bigger than its upright box.
  const r = E.rotatedBox(stamp); const u = E.hugBox(stamp.x, stamp.y, stamp.w, stamp.size);
  assert.ok(r.h > u.h && r.w < u.w + 60);
});

await test('number, dots, compare: count-up, up to 2,600 dots with the green ones last, bars scaled to the max', () => {
  const tl = build(STAT);
  const num = R.layoutGraphic(measure, tl.tracks.graphics[2], tl).find(o => o.type === 'count');
  assert.equal(num.text, '274,000');
  assert.equal(E.numberDisplay(num.block, 137000), '137,000');
  const sc = build(SCALE);
  const dots = R.layoutGraphic(measure, sc.tracks.graphics[1], sc).find(o => o.type === 'dots');
  assert.equal(dots.n, 2521); assert.equal(dots.hi, 1);
  assert.ok(dots.cols * dots.cell <= 960 && dots.y + dots.h <= 1100, 'the grid fits the column above the caption line');
  const big = build({ ...SCALE, beats: [SCALE.beats[0], { ...SCALE.beats[1], block: { type: 'dots', count: 9000, highlight: 3 } }, SCALE.beats[3]] });
  assert.equal(R.layoutGraphic(measure, big.tracks.graphics[1], big).find(o => o.type === 'dots').n, 2600, 'capped at 2,600');
  // Green lands last: drawn after the grey dots, only once they are in.
  const calls = {};
  const env = { measure, images: {}, videos: {} };
  R.drawFrame(stubCtx(calls), sc, sc.beats[1].inMs + 900, env);
  assert.ok(!(calls.fills || []).includes('#1BC47D'), 'no green before the grid has landed');
  const calls2 = {};
  R.drawFrame(stubCtx(calls2), sc, sc.beats[1].inMs + 2600, env);
  assert.ok((calls2.fills || []).includes('#1BC47D'));
  const bars = R.layoutGraphic(measure, sc.tracks.graphics[2], sc).filter(o => o.role === 'bar');
  assert.equal(bars.length, 2);
  assert.ok(bars[0].w > bars[1].w * 10, 'scaled to the biggest value');
  assert.ok(bars[1].w >= bars[1].h * 0.4, 'a tiny value still reads as a bar, never a stripe');
});

// ─── Captions ────────────────────────────────────────────────────────────
await test('captions: 1-3 words a card, one line at y 1172 centred, *word* in yellow, asterisks never shown or spoken', () => {
  assert.deepEqual(E.parseEmphasis('The Cubs lost. This bar got *paid.*'), { words: ['The', 'Cubs', 'lost.', 'This', 'bar', 'got', 'paid.'], flags: [false, false, false, false, false, false, true], text: 'The Cubs lost. This bar got paid.' });
  assert.deepEqual(E.parseEmphasis('a *very big* deal').flags, [false, true, true, false]);
  assert.equal(E.plainVo('got *paid.*'), 'got paid.');
  const tl = build(STAT);
  const words = tl.tracks.captions.words;
  assert.ok(words.every(w => !w.w.includes('*')));
  assert.ok(words.find(w => w.w === 'paid.').em && words.find(w => w.w === '274,000').em);
  tl.tracks.captions.cards.forEach(card => {
    assert.ok(card.words.length >= 1 && card.words.length <= 3);
    const cap = R.layoutCaption(measure, card, tl);
    assert.equal(cap.style, 'es');
    assert.ok(Math.abs(cap.box.y + cap.box.h / 2 - 1172) < 0.01, 'centred on the caption line');
    assert.ok(Math.abs(cap.box.x + cap.box.w / 2 - 540) < 0.01, 'centred');
    assert.equal(new Set(cap.ops.map(o => o.y)).size, 1, 'one line');
  });
  // Cut on together: every word of the card is drawn on its first frame.
  const card = tl.tracks.captions.cards.find(c => c.words.length === 3);
  const calls = {};
  R.drawFrame(stubCtx(calls), tl, card.s + 1, { measure, images: {}, videos: {} });
  const texts = (calls.log || []).filter(c => c[0] === 'fillText').map(c => c[1]);
  card.words.forEach(i => assert.ok(texts.includes(words[i].w.toUpperCase()), `word ${words[i].w} on the first frame`));
  // The end card has no voiceover, so no captions.
  assert.ok(!words.some(w => w.beat === 'b4'));
});

// ─── End card and marks ──────────────────────────────────────────────────
await test('end card: always last (added when missing), 3 s, WE BRING / THE RECEIPTS., the 96 px logotype and the source line', () => {
  const noEnd = build({ ...STAT, beats: STAT.beats.slice(0, 3) });
  assert.equal(noEnd.beats.at(-1).kind, 'cta');
  assert.equal(noEnd.tracks.graphics.at(-1).template, 'es-endcard');
  const end = noEnd.tracks.graphics.at(-1);
  assert.equal(end.outMs - end.inMs, 3000, 'REEL.end = end card start + 3 s');
  assert.equal(noEnd.durationMs, end.inMs + 3000);
  const ops = R.layoutGraphic(measure, end, noEnd);
  assert.deepEqual(ops.filter(o => o.role === 'cta').map(o => o.text), ['WE BRING', 'THE RECEIPTS.']);
  const logo = ops.find(o => o.type === 'logotype');
  assert.equal(logo.h, 96); assert.equal(logo.w, Math.round((258 * 96) / 30.6864));
  assert.equal(ops.find(o => o.role === 'source').text, 'SOURCE: KALSHI');
  assert.ok(/Roboto/.test(ops.find(o => o.role === 'source').font) && /^500 /.test(ops.find(o => o.role === 'source').font), 'small text: Roboto 500');
  // A cta's VO is never read on the ES end card.
  const withVo = build({ ...STAT, beats: [...STAT.beats.slice(0, 3), { id: 'b4', kind: 'cta', text: 'What do you think?', vo: 'Tell us below.' }] });
  assert.ok(!withVo.tracks.captions.words.some(w => w.beat === 'b4'));
  // The mark: hook and end card only, 80 px, right 60, top 330; never on other scenes.
  const marks = R.logoPlacements(noEnd);
  assert.deepEqual(marks.map(m => m.beat), ['b1', noEnd.beats.at(-1).id]);
  marks.forEach(m => assert.deepEqual([m.x, m.y, m.w, m.h, m.clear], [940, 330, 80, 80, 40]));
  assert.ok(R.layoutChrome(measure, noEnd, { graphic: noEnd.tracks.graphics[1] }).every(o => o.type !== 'esmark'));
});

await test('marks are drawn as the official vectors (blue square + the brand file\'s letters), never retyped; no round icon', () => {
  const tl = build(STAT);
  const calls = {};
  const logo = { width: 123, height: 105 };
  R.drawFrame(stubCtx(calls), tl, 100, { measure, images: { 'logo:es': logo }, videos: {} });
  const fills = (calls.log || []).filter(c => c[0] === 'fillRect' && c[1] === 940 && c[2] === 330);
  assert.ok(fills.some(c => c[3] === 80 && c[4] === 80), 'the 80 px blue square');
  assert.ok((calls.log || []).some(c => c[0] === 'drawImage' && c[1] === logo), 'the brand file (Node has no Path2D)');
  assert.ok(!(calls.log || []).some(c => c[0] === 'fillText' && /^ES$|^ESSENTIALLY/.test(c[1])), 'no typeset logo');
  assert.ok(!(calls.log || []).some(c => c[0] === 'arc' && c[3] >= 30), 'no round ES icon');
});

// ─── Timing ──────────────────────────────────────────────────────────────
await test('timing: 2.6 words a second when there is no voice (marked as an estimate); the VO length spreads by words; a recorded voice locks it', () => {
  assert.equal(E.LIMITS.wordsPerSecond, 2.6);
  assert.equal(F.PACE.wordsPerSecond, 2.6);
  const tl = build(STAT);
  assert.deepEqual(tl.timing, { estimate: true, wordsPerSecond: 2.6 });
  assert.ok(L.lintTimeline(tl, {}).issues.some(i => i.id === 'timing' && /estimates/.test(i.message)));
  const plan = E.scriptToPlan(COMPARE_SCRIPT, { voLengthSec: 30, sourceLine: 'Source: Kalshi' });
  const t30 = build(plan, { corpus: COMPARE_SCRIPT });
  const t0 = build({ ...plan, voLengthMs: 0 }, { corpus: COMPARE_SCRIPT });
  assert.ok(t30.durationMs > t0.durationMs + 8000, 'a 30 s voiceover stretches the cuts');
  assert.equal(t30.timing.voLengthMs, 30000);
  const voice = Object.fromEntries(STAT.beats.filter(b => b.vo).map(b => [b.id, { durationMs: 2000, words: [] }]));
  assert.equal(build(STAT, { voice }).timing.estimate, false);
  // The hook holds 3-6 s.
  assert.ok(tl.beats[0].outMs - tl.beats[0].inMs >= 3000);
});

// ─── Motion ──────────────────────────────────────────────────────────────
await test('motion: entrances 0.35-0.45 s expo.out from 60 px left or 30-40 px below, staggered 0.15-0.18 s; slab wipe 0.5 s at -14°; drift 1 -> 1.1; stamp 0.2 s power4.in at -9°', () => {
  const M = E.MOTION;
  assert.ok(M.enterMs >= 350 && M.enterMs <= 450 && M.enterMinMs === 350 && M.enterMaxMs === 450);
  assert.equal(M.ease, 'expo.out');
  assert.equal(M.fromLeft, 60);
  assert.ok(M.fromBelow >= 30 && M.fromBelow <= 40);
  assert.ok(M.staggerMs >= 150 && M.staggerMs <= 180);
  assert.equal(M.wipeMs, 500); assert.equal(M.wipeSkewDeg, -14); assert.deepEqual(M.wipeColors, ['blue', 'ink']);
  assert.equal(M.driftFrom, 1); assert.equal(M.driftTo, 1.1);
  assert.equal(M.stampMs, 200); assert.equal(M.stampEase, 'power4.in'); assert.equal(M.stampRotDeg, -9);
  assert.ok(E.ease.expoOut(0.5) > 0.96 && E.ease.expoOut(0.1) > 0.45 && E.ease.power4In(0.5) < 0.04, 'expo.out lands fast, power4.in slams late');
  // Staggers in the layout use the constant.
  const tl = build(STAT);
  const pills = R.layoutGraphic(measure, tl.tracks.graphics[0], tl).filter(o => o.role === 'pill');
  assert.equal(pills[1].delay - pills[0].delay, M.staggerMs);
  assert.ok(pills.every(p => p.enter === 'left'));
  // Every cut is the slab wipe; no cross-fade.
  const f = R.frameAt(tl, tl.beats[1].inMs + 100);
  assert.equal(f.transition.kind, 'slab');
  assert.ok(Math.abs(f.transition.p - 0.2) < 1e-9);
  assert.equal(R.frameAt(tl, tl.beats[1].inMs + 520).transition, null);
  // Blue leads, then ink covers the whole frame at the half-way point (the cut).
  const early = E.slabs(0.2);
  assert.deepEqual(early.map(s => s.color), ['blue', 'ink']);
  assert.ok(early[0].x > early[1].x, 'blue ahead of ink');
  const mid = E.slabs(0.5)[0];
  assert.equal(mid.color, 'ink');
  assert.ok(mid.poly.every(([x], i) => (i === 0 || i === 3 ? x <= 0 : x >= 1080)), 'ink covers the frame at p = 0.5');
  assert.ok(Math.abs(mid.lean - Math.tan((14 * Math.PI) / 180) * 1920) < 0.01, 'skewed 14°');
  assert.ok(E.slabs(1)[0].poly.every(([x]) => x >= 1080 - 1), 'gone at the end');
  // Photos drift 1 -> 1.1, one shot per scene.
  const ph = build(STAT, { photos: { b1: ['p:1'] }, assets: { 'p:1': { kind: 'photo', src: 'x.jpg', rights: { source: 'ES', licence: 'x', organic: true, paid: true } } } });
  const shots = ph.tracks.video.filter(s => s.beat === 'b1');
  assert.equal(shots.length, 1);
  assert.deepEqual([shots[0].motion.from, shots[0].motion.to], [1, 1.1]);
  // Media only on hook / statement: a number scene ignores a photo.
  const n = build(STAT, { photos: { b3: ['p:1'] }, assets: { 'p:1': { kind: 'photo', src: 'x.jpg' } } });
  assert.equal(n.tracks.video.find(s => s.beat === 'b3').asset, null);
});

await test('frame one: the hook is composed at t = 0 (pills already landed, the mark on); the stamp lands on its word', () => {
  const tl = build(STAT);
  const calls = {};
  R.drawFrame(stubCtx(calls), tl, 0, { measure, images: {}, videos: {} });
  const texts = (calls.log || []).filter(c => c[0] === 'fillText').map(c => c[1]);
  assert.ok(texts.includes('THE CUBS LOST.') && texts.includes('THIS BAR GOT PAID.'), 'both pills on frame one');
  assert.ok(!texts.includes('PAID'), 'the stamp waits for its word');
  const g = tl.tracks.graphics[0];
  const paid = tl.tracks.captions.words.find(w => w.w === 'paid.');
  assert.equal(g.stampAt, paid.s - g.inMs, 'lands when "paid" is said');
  const calls2 = {};
  R.drawFrame(stubCtx(calls2), tl, g.stampAt + 260, { measure, images: {}, videos: {} });
  assert.ok((calls2.log || []).some(c => c[0] === 'fillText' && c[1] === 'PAID'));
  assert.ok((calls2.log || []).some(c => c[0] === 'rotate' && Math.abs(c[1] + (9 * Math.PI) / 180) < 1e-9), 'tilted -9°');
});

// ─── Lint: the kit's checklist ───────────────────────────────────────────
const lintOf = (plan, opts = {}) => { const tl = build(plan, opts); return L.lintTimeline(tl, { boxes: R.textBoxes(measure, tl), measure }); };
const ids = res => res.issues.filter(i => i.severity !== 'info').map(i => `${i.severity}:${i.id}`);
await test('lint: clean sample reels pass every rule; the checklist reads "Safe frame ✓"', () => {
  [STAT, SCALE].forEach(p => assert.deepEqual(ids(lintOf(p)), []));
  const rows = E.checklist(lintOf(STAT).issues);
  assert.equal(rows.length, 8);
  assert.ok(rows.every(r => r.ok));
  assert.equal(rows[0].label, 'Safe frame');
});

await test('lint: words outside the safe frame; more than 2 signal colours; long pills, lines and quotes', () => {
  const far = { ...STAT, beats: [STAT.beats[0], { id: 'x', kind: 'point', block: { type: 'statement', top: 1100, lines: [{ text: 'LOW' }, { text: 'LOWER' }, { text: 'LOWEST' }, { text: 'GONE' }] }, vo: 'Low.' }, STAT.beats[3]] };
  const tlFar = build(far);
  // The layout keeps words in by design; a box pushed past y 1640 (or the sides) is caught.
  const boxes = [...R.textBoxes(measure, tlFar), { beat: 'x', role: 'line', text: 'GONE', x: 60, y: 1610, w: 300, h: 60 }, { beat: 'x', role: 'pill', text: 'WIDE', x: 20, y: 600, w: 300, h: 60 }];
  const r1 = L.lintTimeline(tlFar, { boxes, measure });
  assert.equal(r1.issues.filter(i => i.id === 'safe-frame' && i.severity === 'critical').length, 2, JSON.stringify(r1.issues));
  assert.ok(r1.issues.some(i => i.id === 'copy' && /4 lines/.test(i.message)));
  assert.ok(!E.checklist(r1.issues)[0].ok);
  assert.ok(E.outsideSafe({ x: 60, y: 260, w: 100, h: 60 }), 'above y 300');
  const loud = { ...STAT, beats: [{ ...STAT.beats[0], block: { type: 'hook', pills: [{ text: 'WIN', color: 'green' }, { text: 'LOSS', color: 'red' }], stamp: { text: 'WOW' } }, vo: 'Win, loss, *wow.*' }, STAT.beats[3]] };
  assert.ok(lintOf(loud).issues.some(i => i.id === 'signals' && i.severity === 'critical' && /3 signal/.test(i.message)));
  const longs = { ...STAT, beats: [{ ...STAT.beats[0], block: { type: 'hook', pills: [{ text: 'A PILL THAT IS FAR TOO LONG' }] } }, { id: 'q', kind: 'quote', block: { type: 'quote', text: 'This is a quote that runs on for far longer than seventy characters, honestly.', who: '' }, vo: 'He said it.' }, { id: 's', kind: 'point', block: { type: 'statement', lines: [{ text: 'FIFTEEN LETTERS!' }] }, vo: 'Line.' }, STAT.beats[3]] };
  const r3 = lintOf(longs);
  ['pill', 'quote is', 'the line'].forEach(t => assert.ok(r3.issues.some(i => i.id === 'copy' && i.message.includes(t)), t));
  assert.ok(r3.issues.some(i => /doesn't say who/.test(i.message)));
});

await test('lint: numbers shown differently from the VO; missing end card, end card not last, missing source; empty frame one', () => {
  const asSaid = { ...STAT, beats: [STAT.beats[0], { id: 'n', kind: 'stat', block: { type: 'number', value: 7.5, suffix: 'K', label: 'FANS' }, vo: 'There were 7,500 fans.' }, STAT.beats[3]] };
  const r = lintOf(asSaid, { corpus: '7,500 7.5' });
  assert.ok(r.issues.some(i => i.id === 'as-spoken' && /7,500/.test(i.message)), JSON.stringify(r.issues));
  assert.deepEqual(E.numberTokens('$692M and 7.5K or 274,000').map(t => t.value), [692e6, 7500, 274000]);
  // The builder always closes on an end card; a timeline that lost it is caught.
  const tl = build(STAT);
  const cut = { ...tl, tracks: { ...tl.tracks, graphics: tl.tracks.graphics.slice(0, 3) }, beats: tl.beats.slice(0, 3) };
  assert.ok(E.checks(cut).some(i => i.id === 'endcard' && /no end card/.test(i.message)));
  const moved = build({ ...STAT, beats: [STAT.beats[0], STAT.beats[3], STAT.beats[1]] });
  assert.ok(L.lintTimeline(moved, {}).issues.some(i => i.id === 'endcard' && /not the last/.test(i.message)));
  assert.ok(lintOf({ ...STAT, sourceLine: '' }).issues.some(i => i.id === 'source' && i.severity === 'critical'));
  assert.equal(build({ ...STAT, sourceLine: '' }, { sources: [{ type: 'trend', url: 'https://www.espn.com/x' }] }).sourceLine, 'Source: espn.com', 'a source line from the reel\'s sites');
  const empty = { ...STAT, beats: [{ id: 'e', kind: 'hook', block: { type: 'hook', pills: [] }, vo: 'Hi.' }, STAT.beats[3]] };
  assert.ok(lintOf(empty).issues.some(i => i.id === 'frame-one' && i.severity === 'critical'));
});

await test('lint: banned items: emoji on screen, left-edge accent stripes, glow or gradients on text', () => {
  const emoji = { ...STAT, beats: [{ ...STAT.beats[0], block: { type: 'hook', pills: [{ text: 'PAID 💰' }] } }, STAT.beats[3]] };
  assert.ok(lintOf(emoji).issues.some(i => i.id === 'banned' && /emoji/.test(i.message)));
  const tl = build(STAT);
  const stripe = (m, g, t) => [...R.layoutGraphic(m, g, t), { type: 'rect', role: 'accent', x: 40, y: 400, w: 12, h: 600, fill: 'blue' }];
  assert.ok(E.checks(tl, { measure, layout: stripe }).some(i => i.id === 'banned' && /stripe/.test(i.message)));
  const glow = (m, g, t) => [...R.layoutGraphic(m, g, t), { type: 'text', role: 'x', text: 'GLOW', x: 60, y: 900, w: 100, size: 80, glow: true }];
  assert.ok(E.checks(tl, { measure, layout: glow }).some(i => i.id === 'banned' && /glow/.test(i.message)));
  // Nothing in the ES drawing uses a gradient, glow or shadow.
  const calls = {};
  for (let t = 0; t < tl.durationMs; t += 400) R.drawFrame(stubCtx(calls), tl, t, { measure, images: {}, videos: {} });
  assert.ok(!calls.gradient, 'no gradients');
  // The shared layer: no text shadow blur (glow) and no light leak in the other looks.
  const cl = R.buildTimeline({ format: 'explainer', beats: [{ id: 'a', kind: 'hook', text: 'Hook', vo: 'Hook line.' }, { id: 'b', kind: 'cta', text: 'Q?', vo: 'Q?' }] }, { style: 'countdown' });
  const blurs = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {})), set: (t, k, v) => { if (k === 'shadowBlur' && v) blurs.push(v); t[k] = v; return true; } });
  for (let t = 0; t < cl.durationMs; t += 200) R.drawFrame(ctx, cl, t, { measure, images: {}, videos: {} });
  assert.deepEqual(blurs, []);
});

// ─── Script: the person's words, never rewritten ─────────────────────────
await test('script: split into beats word for word; blocks picked by code (dots, compare, number, quote); the end card has no VO', () => {
  const script = 'The Cubs lost on Sunday. But one bar in Chicago got *paid.* Kalshi says 1 in 2,500 bets was insurance. Bettors put $692M on the games, compared to $0.3M as insurance. "I didn\'t see a false start," Andy Reid said. On Kalshi, bars traded 274,000 contracts. Fans are still arguing about it.';
  const plan = E.scriptToPlan(script, { sourceLine: 'Source: Kalshi' });
  assert.equal(plan.beats.filter(b => b.vo).map(b => b.vo).join(' '), script, 'every word, in order');
  assert.ok(E.voMatchesScript(plan));
  assert.deepEqual(plan.beats.map(b => b.block.type), ['hook', 'statement', 'dots', 'compare', 'quote', 'number', 'statement', 'endcard']);
  assert.equal(plan.beats.at(-1).vo, '');
  const dots = plan.beats[2].block;
  assert.deepEqual([dots.count, dots.highlight], [2500, 1]);
  assert.deepEqual(plan.beats[3].block.items.map(i => i.display), ['$692M', '$0.3M']);
  assert.deepEqual(plan.beats[4].block, { type: 'quote', text: "I didn't see a false start", who: 'ANDY REID' });
  assert.equal(plan.beats[5].block.value, 274000);
  assert.equal(plan.style, 'es');
  assert.equal(plan.sourceLine, 'Source: Kalshi');
  assert.equal(plan.script.locked, true);
  // On-screen words never end on a dangling "the" / "of".
  plan.beats.forEach(b => (b.block.lines || b.block.pills || []).forEach(l => assert.ok(!/\b(?:the|of|a|on)$/i.test(l.text), l.text)));
  // Long sentences split at a comma; nothing is lost.
  const long = 'He threw for three touchdowns in the first half, then ran for two more in the second half while the defense held them scoreless all night long.';
  assert.equal(E.scriptToPlan(long).beats.filter(b => b.vo).map(b => b.vo).join(' '), long);
  // Every number on screen comes from the script (it is the source).
  plan.beats.forEach(b => assert.deepEqual(F.unsourcedNumbers(b, F.numberSet(script), plan.format), [], b.block.type));
});

await test('provenance: a number in a block field must be in the sources', () => {
  assert.deepEqual(F.unsourcedNumbers({ block: { type: 'compare', items: [{ label: 'A', display: '$692M', value: 692 }, { label: 'B', display: '$9M', value: 9 }] } }, F.numberSet('$692M'), 'stat'), ['9']);
  assert.deepEqual(F.unsourcedNumbers({ block: { type: 'dots', count: 2521, highlight: 1 } }, F.numberSet('2,521 and 1'), 'stat'), []);
});

// ─── Director: blocks from the AI (mocked) ───────────────────────────────
await test('director: the ES style asks for blocks with exactly their fields; blocks with unsourced numbers drop; quotes must be exact', async () => {
  const D = require('../netlify/functions/_reel-director.js');
  const corpus = 'Kalshi data: 2,521 bets on games, 1 was insurance. Bettors put $692M on the games and $0.3M as insurance. Andy Reid: "I didn\'t see a false start."';
  const read = D.readReelBrief({ brief: corpus, format: 'stat' });
  const parsed = {
    format: 'stat', title: 'Kalshi bars', beats: [
      { kind: 'hook', text: 'Bars bet against their teams', vo: 'Bars are betting against their own teams.', block: { type: 'hook', pills: [{ text: 'BARS BET', color: 'ink' }, { text: 'AGAINST THEM.', color: 'red' }], stamp: { text: 'AGAINST' } } },
      { kind: 'dotrank', vo: 'Of 2,521 bets, *1* was insurance.', block: { type: 'dots', count: 2521, highlight: 1, label: 'EVERY BET', note: '1 WAS INSURANCE' } },
      { kind: 'bars', vo: 'That is $692M against $0.3M.', block: { type: 'compare', kicker: 'HOW THEY BET', items: [{ label: 'GAMES', value: 692, display: '$692M', color: 'red' }, { label: 'INSURANCE', value: 0.3, display: '$0.3M', color: 'green' }] } },
      { kind: 'stat', vo: 'They traded 9,999 contracts.', block: { type: 'number', value: 9999, label: 'CONTRACTS' } },
      { kind: 'quote', vo: 'Reid said it.', block: { type: 'quote', text: "I didn't see a false start.", who: 'ANDY REID' } },
      { kind: 'quote', vo: 'Made up.', block: { type: 'quote', text: 'We were robbed blind.', who: 'ANDY REID' } },
      { kind: 'cta', text: 'Who is right?', vo: 'Who is right? Tell us.', block: { type: 'endcard' } },
    ],
  };
  const out = D.validatePlan(parsed, { read, format: 'stat', style: 'es' });
  const types = out.plan.beats.map(b => b.block && b.block.type);
  assert.deepEqual(types, ['hook', 'dots', 'compare', 'quote', 'endcard'], JSON.stringify(out.issues));
  assert.ok(out.issues.some(i => /9999|9,999/.test(i)), 'the unsourced number dropped');
  assert.ok(out.issues.some(i => /word for word/.test(i)), 'the invented quote dropped');
  assert.equal(out.plan.beats[1].kind, 'dotrank');
  assert.equal(out.plan.style, 'es');
  // The prompt names every block and its fields.
  const req = D._test ? null : null; void req;
  const src = require('node:fs').readFileSync(new URL('../netlify/functions/_reel-director.js', import.meta.url), 'utf8');
  E.BLOCK_TYPES.forEach(t => assert.ok(src.includes(`"type":"${t}"`), `prompt shows ${t}`));
});

console.log(process.exitCode ? '\nReel ES tests failed.' : `\nAll ${passed} reel ES tests passed.`);
