#!/usr/bin/env node
// Reels Studio v3: any brief or script, in every style (code only, $0).
// Five varied scripts (golf, F1, a tennis quote, a transfer rumour, a
// play-by-play) go through ReelES.scriptToPlan -> ReelRecipes.applyStyle in
// all four styles, then buildTimeline + lint. Asserts, per scene:
//   - the voiceover is the script, word for word (never changed)
//   - on-screen words are a contiguous excerpt of the scene's own voiceover
//     (tile values aside: "four" may show as 4)
//   - no on-screen phrase ends on a dangling word (like, of, his, the, is, to, a, for…)
//   - one emphasis per scene (one *marked* run, or a blue tile)
//   - a scene with a figure (spelled or not) is a data block in Receipts and Stat Card
//   - lint: no critical issue
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../reel-es.js');
const RR = require('../reel-recipes.js');
const R = require('../reel-render.js');
const L = require('../reel-lint.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
const measure = (text, font) => String(text).length * Number(String(font).match(/([\d.]+)px/)[1]) * 0.47;

export const BRIEFS = {
  golf: 'Scottie Scheffler won the Masters again. He finished four shots clear of the field. That is his second green jacket in three years. Nobody has dominated Augusta like this since Tiger. The rest of the tour is playing for second.',
  f1: 'Max Verstappen started seventeenth in Brazil. He won the race anyway. Rain turned Interlagos into chaos and he never lost his nerve. Lando Norris started on pole and finished sixth. The title fight swung in one afternoon.',
  tennis: '"I do not play for records," Novak Djokovic said after the final. Then he lifted his twenty-fourth Grand Slam. He is thirty-six years old. The younger players keep asking the same question: when does he stop?',
  transfer: 'Real Madrid are watching the situation closely. Sources say the club wants a new left back this summer. Alphonso Davies is the name on the list. Bayern want to keep him. This one could run all window.',
  script: 'This is the play everyone is talking about. Fourth and one, game on the line. The coach goes for it. The quarterback keeps it himself. First down. Ballgame.',
};
const DANGLING = new Set(['like', 'of', 'his', 'her', 'their', 'its', 'the', 'a', 'an', 'is', 'to', 'for', 'and', 'with', 'at', 'in', 'on', 'by', 'from', 'that', 'this', 'or', 'but']);
const norm = w => String(w).toLowerCase().replace(/[^a-z0-9'’%-]/g, '');
const wordsOf = t => String(t || '').replace(/\*/g, ' ').split(/\s+/).map(norm).filter(Boolean);
const contiguous = (part, whole) => {
  const p = wordsOf(part);
  const w = wordsOf(whole);
  if (!p.length) return true;
  for (let i = 0; i + p.length <= w.length; i += 1) if (p.every((x, j) => x === w[i + j])) return true;
  return false;
};
// The on-screen phrases of a block (each must read as a whole phrase).
function phrases(b) {
  if (b.type === 'hook') return [(b.pills || []).map(p => p.text).join(' ')];
  if (b.type === 'statement') return [(b.lines || []).map(l => l.text).join(' ')].filter(Boolean);
  if (b.type === 'statTiles') return [b.title, ...(b.tiles || []).map(t => t.label)].filter(Boolean);
  if (b.type === 'quote') return [b.text];
  return [];
}
const runs = text => { const e = E.parseEmphasis(text); let n = 0; e.flags.forEach((f, i) => { if (f && !e.flags[i - 1]) n += 1; }); return n; };
const hasFigure = vo => E.figuresIn(vo).length > 0;

Object.entries(BRIEFS).forEach(([id, script]) => {
  E.V3_STYLE_IDS.forEach(styleId => {
    test(`${id} / ${styleId}: whole phrases, one emphasis, figures as data, voiceover untouched`, () => {
      const plan0 = E.scriptToPlan(script, { sourceLine: 'Source: ES desk' });
      const { plan } = RR.applyStyle(plan0, styleId);
      assert.ok(E.voMatchesScript(plan), 'the voiceover reads the script word for word');
      assert.deepEqual(plan.beats.map(b => b.vo), plan0.beats.map(b => b.vo), 'no voiceover line changed');
      assert.equal(plan.esStyle, styleId);
      plan.beats.forEach((beat, i) => {
        const b = beat.block;
        if (!beat.vo || b.type === 'endcard') return;
        const where = `${id}/${styleId} scene ${i + 1} (${b.type})`;
        assert.ok(E.V3_STYLES[styleId].blocks.includes(b.type), `${where}: a ${E.V3_STYLES[styleId].label} block`);
        // Stat Card's kicker (the reel's subject) is an excerpt of the script.
        if (b.kicker) assert.ok(contiguous(b.kicker, script), `${where}: kicker “${b.kicker}” is in the script`);
        phrases(b).forEach(p => {
          assert.ok(contiguous(p, beat.vo), `${where}: “${p}” is an excerpt of “${beat.vo}”`);
          const last = wordsOf(p).pop();
          assert.ok(!DANGLING.has(last), `${where}: “${p}” ends on “${last}”`);
        });
        const marked = [...(b.pills || []).map(p => p.text), ...(b.lines || []).map(l => l.text), b.title || ''].join(' ');
        const blueTile = (b.tiles || []).some(t => t.tone === 'blue');
        if (b.type === 'statTiles') assert.ok(runs(marked) <= 1 && (runs(marked) === 1 || blueTile), `${where}: one emphasis`);
        else if (b.type !== 'quote') assert.equal(runs(marked), 1, `${where}: one emphasis in “${marked}”`);
        if ((styleId === 'receipts' || styleId === 'statcard') && i > 0 && hasFigure(beat.vo)) assert.equal(b.type, 'statTiles', `${where}: a figure becomes a data block`);
      });
      const tl = R.buildTimeline(plan, { style: 'es', esStyle: styleId, corpus: script });
      const res = L.lintTimeline(tl, { boxes: R.textBoxes(measure, tl), measure });
      assert.deepEqual(res.issues.filter(x => x.severity === 'critical' && x.id !== 'rights').map(x => x.message), []);
    });
  });
});

// v4: a script reshaped in a v4 style builds on the Breakdown engine, words
// untouched; with no media yet the lint asks for motion and clips (owner rule).
Object.entries(BRIEFS).forEach(([id, script]) => {
  test(`${id} / v4 styles: toV4 keeps every word; no media yet -> flagged for clips and motion only`, () => {
    E.STYLE_IDS.forEach(styleId => {
      const { plan } = RR.applyStyle(E.scriptToPlan(script, { sourceLine: 'Source: ES desk' }), styleId);
      assert.equal(plan.esStyle, styleId);
      const v4 = E.toV4(plan);
      assert.equal(v4.esStyle, styleId);
      assert.deepEqual(v4.chapters.flatMap(c => c.beats.map(b => b.vo)), plan.beats.filter(b => b.vo).map(b => b.vo), 'no voiceover line changed');
      const tl = R.buildTimeline(plan, { style: 'es', esStyle: styleId, corpus: script });
      assert.equal(tl.v, 4);
      const crit = new Set(L.lintTimeline(tl, { measure }).issues.filter(x => x.severity === 'critical').map(x => x.id));
      [...crit].forEach(c => assert.ok(['static-beat', 'needs-clips'].includes(c), `${id}/${styleId}: ${c}`));
      assert.ok(crit.has('needs-clips'));
    });
  });
});

test('figures: spelled and written numbers, with the words that name them', () => {
  assert.deepEqual(E.figuresIn('He finished four shots clear of the field.').map(f => [f.display, f.label]), [['4', 'SHOTS CLEAR']]);
  assert.deepEqual(E.figuresIn('Then he lifted his twenty-fourth Grand Slam.').map(f => [f.display, f.label]), [['24TH', 'GRAND SLAM']]);
  assert.deepEqual(E.figuresIn('Max Verstappen started seventeenth in Brazil.').map(f => [f.display, f.label]), [['17TH', 'STARTED']]);
  assert.deepEqual(E.figuresIn('Fourth and one, game on the line.'), [], 'a down is not a stat without its words');
  assert.deepEqual(E.spelledNumbers('thirty-six years, second jacket, one more'), ['36', '2']);
  // A spelled number in the script backs the digits on a tile.
  const tl = R.buildTimeline(RR.applyStyle(E.scriptToPlan(BRIEFS.tennis), 'receipts').plan, { style: 'es', esStyle: 'receipts', corpus: BRIEFS.tennis });
  assert.ok(!L.lintTimeline(tl, {}).issues.some(x => x.id === 'numbers'));
});

test('styles look different with no media: Hype Cut stacks short kinetic pills, Stat Card carries the subject', () => {
  const hype = RR.applyStyle(E.scriptToPlan(BRIEFS.transfer), 'hypecut').plan;
  const rec = RR.applyStyle(E.scriptToPlan(BRIEFS.transfer), 'receipts').plan;
  const card = RR.applyStyle(E.scriptToPlan(BRIEFS.golf), 'statcard').plan;
  const maxLen = p => Math.max(...p.beats.filter(b => b.block.type === 'statement').flatMap(b => b.block.lines.map(l => E.plainVo(l.text).length)));
  assert.ok(maxLen(hype) <= 20 && maxLen(hype) <= maxLen(rec), 'Hype Cut lines are short');
  assert.ok(card.beats.some(b => b.block.kicker === 'SCOTTIE SCHEFFLER'), 'Stat Card names its subject');
  assert.equal(R.buildTimeline(hype, { style: 'es', esStyle: 'hypecut' }).look, 'hype');
  assert.equal(R.buildTimeline(rec, { style: 'es', esStyle: 'receipts' }).look, 'paper');
});

console.log(process.exitCode ? '\nReel brief tests failed.' : `\nAll ${passed} reel brief tests passed.`);
