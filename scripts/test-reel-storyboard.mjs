// Reels Studio storyboard and accessibility helpers (Reels 2.0, lane D):
// the pure parts of reel-storyboard.js and reel-a11y.js, plus the one
// mutation path's structured variant (setEsField in reel-maker.js).
// Run: node scripts/test-reel-storyboard.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const SB = require(path.join(root, 'reel-storyboard.js'));
const A = require(path.join(root, 'reel-a11y.js'));
const ES = require(path.join(root, 'reel-es.js'));
const js = readFileSync(path.join(root, 'reel-maker.js'), 'utf8');
const sbJs = readFileSync(path.join(root, 'reel-storyboard.js'), 'utf8');
const css = readFileSync(path.join(root, 'reel-maker.css'), 'utf8');
const html = readFileSync(path.join(root, 'reel-maker.html'), 'utf8');
let n = 0;
const t = (name, fn) => { try { fn(); n += 1; } catch (error) { console.error(`FAIL ${name}`); throw error; } };

t('colour chips: ink, blue, green for a win, red for a loss', () => {
  assert.deepEqual(SB.COLORS.map(c => c.id), ['ink', 'blue', 'green', 'red']);
  assert.match(SB.COLORS[2].label, /win/);
  assert.match(SB.COLORS[3].label, /loss/);
  SB.COLORS.forEach(c => assert.ok(ES.COLOR_NAMES.includes(c.id), `${c.id} is an ES colour`));
  assert.equal(SB.ROWS.pills.max, ES.LIMITS.pills);
  assert.equal(SB.ROWS.lines.max, ES.LIMITS.lines);
  assert.equal(SB.ROWS.items.max, ES.LIMITS.compareMax);
  assert.equal(SB.ROWS.items.min, ES.LIMITS.compareMin);
});

t('reorder: any scene moves before the end card; the end card never moves', () => {
  const list = ['hook', 'a', 'b', 'c', 'end'];
  const end = 4;
  assert.deepEqual(SB.move(list, 2, 1, end), ['hook', 'b', 'a', 'c', 'end']);
  assert.deepEqual(SB.move(list, 1, 3, end), ['hook', 'b', 'c', 'a', 'end']);
  assert.equal(SB.move(list, 4, 3, end), null, 'the end card does not move');
  assert.equal(SB.move(list, 3, 4, end), null, 'nothing goes after the end card');
  assert.equal(SB.move(list, 0, -1, end), null);
  assert.equal(SB.move(list, 1, 1, end), null);
  assert.deepEqual(SB.move(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a'], 'no end card: free order');
  assert.deepEqual(list, ['hook', 'a', 'b', 'c', 'end'], 'the list passed in is not changed');
  assert.equal(SB.endIndex(list, (b, i) => b === 'end' && i === 4), 4);
  assert.equal(SB.endIndex(['a', 'b'], () => false), -1);
});

t('drag and drop: the index a dropped scene lands on', () => {
  // 5 scenes, end card at 4. Drop scene 0 after scene 2 -> index 2.
  assert.equal(SB.dropIndex(0, 2, true, 5, 4), 2);
  assert.equal(SB.dropIndex(0, 2, false, 5, 4), 1);
  assert.equal(SB.dropIndex(3, 0, false, 5, 4), 0);
  assert.equal(SB.dropIndex(1, 4, true, 5, 4), 3, 'dropping past the end card lands just before it');
  assert.equal(SB.dropIndex(1, 4, false, 5, 4), 3);
  assert.equal(SB.dropIndex(2, 2, true, 5, 4), 2, 'on itself: no move');
});

t('stamp word: the person\'s emphasised word, else the last word on screen', () => {
  assert.equal(SB.stampWord('The Cubs lost. This bar got *paid.*', ['THE CUBS LOST.']), 'PAID');
  assert.equal(SB.stampWord('No emphasis here', ['ALLEN BROKE', 'THE RECORD.']), 'RECORD');
  assert.equal(SB.stampWord('', []), '');
  assert.equal(SB.dotsLine(2521, 1), '1 of 2,521 dots is green.');
  assert.equal(SB.dotsLine(10, 3), '3 of 10 dots are green.');
  assert.equal(SB.dotsLine(5, 9), '5 of 5 dots are green.');
});

t('scrubber: aria-valuetext reads the time, the scene and its block', () => {
  assert.equal(A.valueText({ t: 7000, index: 2, total: 7, name: 'Number' }), '0:07, scene 3 of 7, Number');
  assert.equal(A.valueText({ t: 0 }), '0:00');
  assert.equal(A.valueText({ t: 65000, index: 6, total: 7, name: 'End card' }), '1:05, scene 7 of 7, End card');
});

t('scrubber keys: arrows one frame, Shift one second, Home / End, J / K / L, Space', () => {
  const d = 20000;
  const go = (key, t, shift = false) => A.seekTo(A.keyAction(key, { shift }), t, d);
  assert.equal(go('ArrowRight', 0), Math.round(1000 / 30));
  assert.equal(go('ArrowLeft', 1000), Math.round(29 * 1000 / 30));
  assert.equal(go('ArrowRight', 1000, true), 2000);
  assert.equal(go('ArrowLeft', 500, true), 0, 'never before the start');
  assert.equal(go('End', 500), d - 1);
  assert.equal(go('Home', 500), 0);
  assert.equal(go('l', 1000), 3000);
  assert.equal(go('J', 5000), 3000);
  assert.equal(go('ArrowRight', d - 1), d - 1, 'never past the end');
  assert.deepEqual(A.keyAction('k'), { type: 'toggle' });
  assert.deepEqual(A.keyAction(' '), { type: 'toggle' });
  assert.equal(A.keyAction('x'), null);
  assert.equal(A.keyAction('Tab'), null);
});

t('reorder announcement and the scene description', () => {
  assert.equal(A.moveText({ from: 2, to: 1, total: 7 }), 'Scene 3 moved to position 2 of 7');
  assert.equal(A.sceneText({ index: 2, total: 7, name: 'Number', strings: ['KALSHI TRADES', '274,000', 'CONTRACTS'], vo: 'Kalshi saw *274,000* contracts' }),
    'Scene 3 of 7: Number. On screen: KALSHI TRADES, 274,000, CONTRACTS. Voiceover: Kalshi saw 274,000 contracts.');
  assert.equal(A.sceneText({ index: 6, total: 7, name: 'End card', strings: ['WE BRING', 'THE RECEIPTS.'] }), 'Scene 7 of 7: End card. On screen: WE BRING, THE RECEIPTS..');
  assert.match(A.sceneText({ index: 0, total: 3, name: 'Hook', strings: ['A'], vo: 'Hi.', media: 'A photo sits behind it' }), /A photo sits behind it\. Voiceover: Hi\.$/);
});

t('calm preview: a scene change is a cut (old scene held, then the new scene past its wipe)', () => {
  const tl = { tracks: { graphics: [{ inMs: 0, outMs: 3000 }, { inMs: 3000, outMs: 6000 }, { inMs: 6000, outMs: 6300 }] } };
  assert.equal(A.calmTime(tl, 1500), 1500, 'outside a wipe: the time itself');
  assert.equal(A.calmTime(tl, 100), 100, 'the first scene has no wipe');
  assert.equal(A.calmTime(tl, 3000), 2999, 'first half of the wipe: the last frame of the old scene');
  assert.equal(A.calmTime(tl, 3249), 2999);
  assert.equal(A.calmTime(tl, 3250), 3500, 'second half: the new scene with the wipe gone');
  assert.equal(A.calmTime(tl, 3499), 3500);
  assert.equal(A.calmTime(tl, 3500), 3500);
  assert.equal(A.calmTime(tl, 6000), 5999);
  assert.equal(A.calmTime(tl, 6200), 6299, 'a scene shorter than the wipe stays inside itself');
  assert.equal(A.calmTime(tl, 3100, 0), 3100, 'a style with no wipe is left alone');
  assert.equal(A.calmTime({ tracks: { graphics: [] } }, 50), 50);
  // The preview only: the export code draws with the real time.
  assert.match(js, /const tDraw = state\.calm && A11Y \? A11Y\.calmTime\(state\.timeline, state\.t, wipeMs\(\)\) : state\.t;\s+R\.drawFrame\(ctx, state\.timeline, tDraw, env\);/);
  assert.match(js, /draw: t => R\.drawFrame\(c, tl, t, envFor\(tl\)\)/, 'frame-exact export uses the real time');
  assert.match(html, /Your export keeps the full motion\./);
});

t('captions are always on: a voiced scene with no caption words is found', () => {
  const tl = {
    beats: [{ id: 'a', inMs: 0, outMs: 2000 }, { id: 'b', inMs: 2000, outMs: 4000 }, { id: 'c', inMs: 4000, outMs: 6000 }],
    tracks: { audio: [{ kind: 'vo', asset: 'vo:a' }, { kind: 'vo', asset: 'vo:b' }, { kind: 'music', asset: 'music' }], captions: { words: [{ w: 'Hi', s: 100 }, { w: 'there', s: 400 }] } },
  };
  assert.deepEqual(A.captionGaps(tl), ['b'], 'b is voiced with no words; c has no voice');
  assert.deepEqual(A.captionGaps({ beats: tl.beats, tracks: { audio: [], captions: { words: [] } } }), []);
  assert.deepEqual(A.captionGaps(null), []);
  assert.match(js, /A11Y\.captionGaps\(state\.timeline\)\.forEach[\s\S]{0,400}severity: 'critical'/);
  assert.doesNotMatch(html, /captions-off|data-captions-off/, 'no control turns captions off');
});

t('one mutation path: the cards write through ctx.setField, with rows as a structured value', () => {
  assert.doesNotMatch(sbJs, /\.block\s*=[^=]|beat\.(text|kind|stat|bars)\s*=[^=]/, 'the storyboard never writes a beat itself');
  assert.match(sbJs, /ctx\.setField\(beat, `es\.\$\{key\}`, rows\)/);
  // setEsField, lifted out of the page and run on real blocks.
  const src = js.slice(js.indexOf('  function setEsField(beat, field, value) {'), js.indexOf('  function beatFields(beat, i) {'));
  const setEsField = new Function('ES', `${src}; return setEsField;`)(ES);
  const beat = { id: 'b1', ...ES.legacyFields({ type: 'hook', pills: [{ text: 'THE CUBS LOST.', color: 'ink' }] }), vo: 'x' };
  setEsField(beat, 'es.pills', [{ text: ' The Cubs lost. ', color: 'ink' }, { text: 'This bar got paid.', color: 'RED' }, { text: '  ', color: 'blue' }]);
  assert.deepEqual(beat.block.pills, [{ text: 'The Cubs lost.', color: 'ink' }, { text: 'This bar got paid.', color: 'red' }]);
  setEsField(beat, 'es.stamp', { text: 'PAID' });
  assert.deepEqual(beat.block.stamp, { text: 'PAID' });
  setEsField(beat, 'es.stamp', null);
  assert.equal(beat.block.stamp, undefined);
  setEsField(beat, 'es.pills', 'Typed line | blue');
  assert.deepEqual(beat.block.pills, [{ text: 'Typed line', color: 'blue' }], 'the typed syntax still works (data formats, old tests)');
  const cmp = { id: 'b2', ...ES.legacyFields({ type: 'compare', items: [{ label: 'A', value: 1, display: '1' }, { label: 'B', value: 2, display: '2' }] }) };
  setEsField(cmp, 'es.items', [{ label: 'On the games', display: '$692M', color: 'red' }, { label: 'As insurance', display: '$0.3M', color: 'green' }, { label: '', display: '9' }]);
  assert.deepEqual(cmp.block.items, [{ label: 'On the games', value: 692, display: '$692M', color: 'red' }, { label: 'As insurance', value: 0.3, display: '$0.3M', color: 'green' }]);
  assert.deepEqual(cmp.bars, [{ label: 'On the games', value: '$692M' }, { label: 'As insurance', value: '$0.3M' }], 'the legacy fields follow');
});

t('field ids keep the pattern rm-es-<field>-<beatId>; cards take media drops', () => {
  assert.match(sbJs, /const fid = \(field, id\) => `rm-\$\{field\.replace\(\/\\\.\/g, '-'\)\}-\$\{id\}`;/);
  assert.match(sbJs, /id="rm-es-\$\{key\}-\$\{k\}-\$\{esc\(id\)\}"/);
  assert.match(sbJs, /id="rm-estype-\$\{esc\(id\)\}" data-field="es\.type"/);
  assert.match(sbJs, /data-beat="\$\{esc\(id\)\}" data-ri-beat="\$\{esc\(id\)\}"/);
  assert.match(sbJs, /R\.drawFrame\(g, tl, t, ui\.envFor\(tl\)\)/, 'thumbnails are drawn by the real renderer');
});

t('contrast and forced-colours styles exist; focus is visible on the new controls', () => {
  assert.match(css, /@media \(prefers-contrast: more\) \{/);
  assert.match(css, /@media \(forced-colors: active\) \{[\s\S]*?forced-color-adjust: none/);
  assert.match(css, /:is\(\.rm-tile, \.rm-recipe, \.rm-card__face, \.rm-cchip, \.rm-addrow, \.rm-look\):focus-visible \{ outline:/);
  assert.match(html, /id="rm-sb-live" aria-live="assertive"/);
  assert.match(html, /id="rm-scene-desc" aria-live="polite"/);
});

console.log(`All ${n} reel storyboard and accessibility tests passed.`);
