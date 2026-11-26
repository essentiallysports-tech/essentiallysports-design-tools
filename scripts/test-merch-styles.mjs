#!/usr/bin/env node
// Merch Designs: the style library (merch-styles.js). No network.
//   >= 22 named styles (id, short label, why, pro flag), the UMD browser build,
//   expand() reaches >= 20 unique, print-valid designs for a 2-word line, a long
//   sentence, a quote with attribution and a line with a number, on a white and a
//   black tee, in Basic and Pro; the AI concepts stay first; Basic never gets
//   elements; the Pro number styles only appear when the design has a number;
//   signatures are unique; max is respected.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const MP = require('../merch-print.js');
const MS = require('../merch-styles.js');
const G = require('../merch-guidelines.js');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed += 1; } catch (error) { process.stderr.write(`FAIL ${name}\n`); throw error; }
};
const WHITE = '#FFFFFF';
const BLACK = '#111111';
const ES = { a: '#0A7DFA', b: '#033162', ink: '#FFFFFF' };
const LAKERS = { a: '#552583', b: '#FDB927', ink: '#FFFFFF' };
// An AI-style concept: the line split at natural breaks, colours alternating.
const ai = (id, line, extra = {}) => ({
  id, collection: 'current', title: line.slice(0, 40), team: null, palette: ES, garment: { color: WHITE, name: 'White' }, align: 'left',
  stack: MP.splitWords(line, 'auto').map((t, i) => ({ text: t, size: 'big', fill: i % 2 ? 'b' : 'a', ink: 'white' })),
  rights: [], why: 'AI', ...extra,
});
const printErrors = (c, garment) => MP.checks(c, { ...MP.DEFAULT_AREAS.tee, kind: 'tee', garmentColor: garment || c.garment?.color || WHITE }).filter(x => x.level === 'error');

const BRIEFS = {
  twoWord: { source: 'Showtime forever', concepts: () => [ai('mc-1', 'Showtime forever'), ai('mc-2', 'Forever Showtime', { align: 'center' })] },
  long: {
    source: 'Nobody else came close in Paris, fourteen times the King of Clay, and fans still sing about it',
    concepts: () => [ai('mc-1', 'Nobody else came close in Paris, fourteen times the King of Clay'), ai('mc-2', 'King of Clay', { collection: 'nickname' }), ai('mc-3', 'Fourteen times in Paris')],
  },
  quote: {
    source: '"I didn\'t quit tennis, tennis quit me" — David Ferrer',
    concepts: () => [
      { ...ai('mc-1', "I didn't quit tennis, tennis quit me"), collection: 'quote', stack: [{ text: "I DIDN'T QUIT TENNIS,", size: 'big', fill: 'a', ink: 'white' }, { text: 'TENNIS QUIT ME', size: 'big', fill: 'b', ink: 'white' }, { text: '— David Ferrer', size: 'small', fill: 'a', ink: 'white' }] },
      ai('mc-2', 'Tennis quit me'),
    ],
  },
  number: {
    source: 'Magic Johnson wore 32 for the Lakers and fans still call it Showtime',
    concepts: () => [ai('mc-1', 'Magic wore 32 for the Lakers', { palette: LAKERS }), ai('mc-2', 'Showtime 32', { palette: LAKERS }), ai('mc-3', 'Showtime forever', { palette: LAKERS })],
  },
};

test('styles: >= 22 named styles, unique ids, short labels, why, pro flag', () => {
  assert.ok(MS.STYLES.length >= 22, `${MS.STYLES.length} styles`);
  assert.ok(MS.STYLES.filter(s => !s.pro).length >= 20, 'Basic alone has >= 20 styles');
  assert.equal(new Set(MS.STYLES.map(s => s.id)).size, MS.STYLES.length);
  for (const s of MS.STYLES) {
    assert.match(s.id, /^[a-z-]+$/);
    assert.ok(s.label && s.label.length <= 16, `label "${s.label}" <= 16`);
    assert.ok(s.why && s.why.length <= 140, s.id);
    assert.equal(typeof s.make, 'function');
    assert.equal(typeof Boolean(s.pro), 'boolean');
  }
  // The AI's named list matches the code library (same ids and names).
  assert.deepEqual(G.STYLE_NAMES.map(s => s.id).sort(), MS.STYLES.map(s => s.id).sort());
  for (const s of G.STYLE_NAMES) assert.equal(s.name, MS.BY_ID[s.id].label, s.id);
  assert.deepEqual(G.STYLE_NAMES.filter(s => s.pro).map(s => s.id).sort(), MS.STYLES.filter(s => s.pro).map(s => s.id).sort());
});

test('styles: browser build sets window.MerchStyles (UMD)', () => {
  const win = {};
  for (const f of ['frameup-rules.js', 'brand-kit.js', 'video-ads-teams.js', 'merch-rules.js', 'merch-print.js', 'merch-styles.js']) vm.runInNewContext(fs.readFileSync(f, 'utf8'), { self: win, window: win, console });
  assert.ok(win.MerchStyles && win.MerchStyles.STYLES.length === MS.STYLES.length);
  const out = win.MerchStyles.expand(BRIEFS.quote.concepts(), { mode: 'basic', source: BRIEFS.quote.source });
  assert.ok(out.length >= 20, `browser expand ${out.length}`);
});

for (const [name, brief] of Object.entries(BRIEFS)) {
  for (const mode of ['basic', 'pro']) {
    for (const garment of [WHITE, BLACK]) {
      test(`expand ${name} ${mode} on ${garment}: >= 20 unique, print-valid, AI first`, () => {
        const input = brief.concepts();
        const out = MS.expand(input, { mode, garment, source: brief.source, min: 20, max: 28 });
        assert.ok(out.length >= 20, `${out.length} designs`);
        assert.ok(out.length <= 28);
        // AI concepts first, untouched apart from the flag.
        input.forEach((c, i) => { assert.equal(out[i].id, c.id); assert.equal(out[i].source, 'ai'); assert.deepEqual(out[i].stack, c.stack); });
        const styled = out.slice(input.length);
        assert.ok(styled.every(c => c.source === 'style' && MS.BY_ID[c.style] && c.variantOf && input.some(b => b.id === c.variantOf) && c.label.length <= 16));
        assert.equal(new Set(out.map(c => c.id)).size, out.length, 'unique ids');
        assert.equal(new Set(out.map(MS.signature)).size, out.length, 'unique signatures');
        for (const c of styled) assert.deepEqual(printErrors(c).map(e => e.text), [], `${c.style} on ${c.garment.color}`);
        // The words never change: every styled design carries its base's words.
        const letters = t => MP.splitWords(t, 'word').join(' ').replace(/[^A-Z0-9]/g, '');
        for (const c of styled) {
          const base = input.find(b => b.id === c.variantOf);
          assert.equal([...letters(c.stack.map(r => r.text).join(' '))].sort().join(''), [...letters(base.stack.map(r => r.text).join(' '))].sort().join(''), `${c.style} keeps the words`);
        }
        if (mode === 'basic') assert.ok(out.every(c => !('elements' in c)), 'Basic never carries elements');
        else assert.ok(styled.some(c => c.elements && c.elements.length), 'Pro adds element styles');
        const numbered = styled.filter(c => /^number-/.test(c.style));
        if (mode === 'pro' && name === 'number') {
          assert.ok(numbered.length >= 1, 'a number style when the line has a number');
          for (const c of numbered) assert.ok(c.stack.some(r => r.text.includes(c.elements.find(e => e.type === 'number').text)), 'number from the design');
        } else assert.equal(numbered.length, 0, 'no number style without a number');
      });
    }
  }
}

test('expand: Pro with 10 AI concepts keeps all 10 first and stops at max', () => {
  const ten = Array.from({ length: 10 }, (_, i) => ai(`mc-${i}`, ['Showtime forever', 'Magic era', 'King of the court', 'Run it back', 'Lake show', 'Purple and gold', 'Forever Showtime', 'Magic hour', 'Fast break', 'Court vision'][i]));
  const out = MS.expand(ten, { mode: 'pro', min: 20, max: 28 });
  assert.equal(out.length, 28);
  assert.deepEqual(out.slice(0, 10).map(c => c.id), ten.map(c => c.id));
});

test('expand: Basic strips AI elements; no AI concepts still works from fallback concepts', () => {
  const withEls = { ...ai('mc-1', 'Showtime forever'), elements: [{ type: 'rule', position: 'below', color: 'b' }] };
  const out = MS.expand([withEls], { mode: 'basic' });
  assert.ok(out.every(c => !('elements' in c)));
  const fb = MP.fallbackConcepts(BRIEFS.quote.source, { max: 6 });
  const fromFb = MS.expand(fb, { mode: 'basic', source: BRIEFS.quote.source });
  assert.ok(fromFb.length >= 20, `fallback ${fromFb.length}`);
  assert.deepEqual(MS.expand([], { mode: 'pro' }), []);
  assert.deepEqual(MS.expand(null), []);
});

test('styles: attribution becomes its own row; shapes hold', () => {
  const ctx = MS.prepare(BRIEFS.quote.concepts()[0], {});
  assert.deepEqual(ctx.smalls, ['— DAVID FERRER']);
  const inLine = MS.prepare(ai('mc-x', "I didn't quit tennis, tennis quit me — David Ferrer"), {});
  assert.deepEqual(inLine.smalls, ['— DAVID FERRER'], 'an attribution inside the big rows moves out');
  assert.ok(!inLine.words.join(' ').includes('FERRER'));
  const base = ai('mc-1', 'Nobody else came close in Paris');
  const pyr = MS.apply('pyramid', base).stack.map(r => r.text.length);
  assert.ok(pyr.every((n, i) => !i || n > pyr[i - 1]), `pyramid grows ${pyr}`);
  const fun = MS.apply('funnel', base).stack.map(r => r.text.length);
  assert.ok(fun.every((n, i) => !i || n < fun[i - 1]), `funnel shrinks ${fun}`);
  assert.equal(MS.apply('two-line', base).stack.length, 2);
  assert.equal(MS.apply('rule-frame', base, { mode: 'basic' }), null, 'Pro styles need Pro');
  assert.equal(MS.apply('number-behind', base, { mode: 'pro' }), null, 'no number, no number style');
  assert.equal(MS.apply('signed', base), null, 'no attribution, no signed quote');
  const knock = MS.apply('knockout', base);
  assert.equal(knock.garment.color, ES.a);
  assert.ok(MP.layout(knock, { ...MP.DEFAULT_AREAS.tee, kind: 'tee' }).items.some(i => i.knockout), 'knockout lets the shirt show through');
  assert.equal(MS.apply('tee-swap', base, { garment: BLACK }).garment.color, WHITE, 'a dark tee swaps to white');
  assert.equal(MS.sportIcon('tennis'), 'tennis');
  assert.equal(MS.sportIcon('', 'nothing here'), 'star');
});

test('signature: same look collapses, a different look does not', () => {
  const a = ai('mc-1', 'Showtime forever');
  assert.equal(MS.signature(a), MS.signature({ ...a, id: 'other', title: 'x' }));
  assert.equal(MS.signature({ ...a, stack: [{ text: 'SHOWTIME FOREVER', size: 'big', fill: 'a', ink: 'white' }], align: 'left' }), MS.signature({ ...a, stack: [{ text: 'SHOWTIME FOREVER', size: 'big', fill: 'a', ink: 'white' }], align: 'center' }), 'one row: align does not matter');
  assert.notEqual(MS.signature(a), MS.signature({ ...a, fit: { scale: 0.7, topIn: null } }));
  assert.notEqual(MS.signature(a), MS.signature({ ...a, garment: { color: BLACK } }));
});

console.log(`test-merch-styles: ${passed} tests passed`);
