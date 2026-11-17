// Generate v2 styles: the 15 new composition archetypes, the effect limits in
// the ES gate (checkScene), the busy-photo contrast rule, mist at 90% and the
// new art-director fixes. Pure Node (no canvas): scene specs and the gate only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../frameup-compose.js');

const NEW = ['pill-stack', 'versus-split', 'trading-card', 'lower-third', 'front-page', 'film-strip', 'neon-night', 'swiss-grid', 'quote-marks', 'record-gauge', 'photo-mosaic', 'sticker-collage', 'type-knockout', 'stat-tower', 'ticket-stub'];

const pal = C.makePalette(['#FB4F14', '#000000'], { name: 'Bengals' });
const rich = {
  palette: pal, sport: 'NFL', kicker: 'Sunday Night', headline: 'Burrow carved them up', highlight: ['carved'], name: 'Joe Burrow', body: 'Cincinnati sits alone atop the AFC North.',
  number: { value: '409', label: 'yards', factId: 'f1' },
  numbers: [{ value: '409', display: '409', label: 'yards', factId: 'f1' }, { value: '4', display: '4', label: 'touchdowns', factId: 'f2' }, { value: '11', display: '11', label: 'passes', factId: 'f3' }],
  photo: { src: '/a.jpg' }, photos: [{ src: '/b.jpg', label: 'one' }, { src: '/c.jpg', label: 'two' }], cutout: { src: '/a.png' },
  logos: [{ src: 'assets/logos/nfl/cin.webp', name: 'Bengals' }],
  compare: { title: 'Not even close', a: { label: 'Cincinnati yards', value: '484' }, b: { label: 'Pittsburgh yards', value: '222' } },
  score: { a: { name: 'Bengals', value: '38', logo: 'assets/logos/nfl/cin.webp' }, b: { name: 'Steelers', value: '18', logo: 'assets/logos/nfl/pit.webp' }, tag: 'Final' },
  record: { value: '7-2', label: 'record' }, quote: { text: 'We shot ourselves in the foot', by: 'Aaron Rodgers' },
  facts: [{ id: 'f1', text: '409 yards' }, { id: 'f2', text: '4 touchdowns' }, { id: 'f3', text: '11 passes' }, { id: 'f4', text: '484-222' }, { id: 'f5', text: '38-18' }, { id: 'f6', text: '7-2' }],
};

// ── 1. Catalogue ───────────────────────────────────────────────────────────
assert.ok(C.ARCHETYPES.length >= 29, `29+ archetypes (${C.ARCHETYPES.length})`);
assert.equal(new Set(C.ARCHETYPES.map(a => a.id)).size, C.ARCHETYPES.length, 'unique ids');
NEW.forEach(id => assert.ok(C.BY_ID[id], `${id} exists`));
C.ARCHETYPES.forEach(a => {
  assert.ok(a.name && a.about && a.focal, `${a.id}: name, about, focal`);
  assert.ok(typeof a.needs === 'string' && a.needs.length > 5, `${a.id}: needs (for the director catalogue)`);
  assert.ok(Array.isArray(a.kinds) && a.kinds.length, `${a.id}: story kinds`);
  assert.equal(C.NEEDS[a.id], a.needs);
});
assert.ok(new Set(C.ARCHETYPES.map(a => a.focal)).size >= 7, 'every focal type is covered');

// ── 2. Every new archetype: fits, 3 distinct variants, clean through the gate ──
const peak = l => Math.max(...l.stops.map(s => s[1]));
NEW.forEach(id => {
  assert.ok(C.fits(id, rich), `${id} fits a rich input`);
  const scenes = C.candidates(id, rich, 3);
  assert.equal(scenes.length, 3);
  assert.ok(new Set(scenes.map(s => JSON.stringify(s.layers))).size === 3, `${id}: three different variants`);
  scenes.forEach(scene => {
    assert.deepEqual(C.build(id, rich, scene.variant), scene, `${id}: deterministic`);
    assert.ok(scene.layers.length <= 34, `${id}: layer budget`);
    const checked = C.checkScene(JSON.parse(JSON.stringify(scene)));
    assert.ok(checked.ok, `${id} v${scene.variant}: ${JSON.stringify(checked.errors)}`);
    // Built inside the rules, so the gate has nothing to correct.
    const bad = checked.fixes.filter(f => ['team-palette', 'safe-area', 'font-family', 'no-outlined-type', 'composed-effects', 'mist-opacity', 'logo-placement', 'type-hierarchy'].includes(f.rule));
    assert.deepEqual(bad, [], `${id} v${scene.variant} needed no gate fixes`);
    scene.layers.forEach(l => {
      if (l.font) assert.ok(C.FONTS[l.font], `${id}: ES font only`);
      assert.ok(!('stroke' in l) && !('outline' in l), `${id}: no outlined type`);
      if (l.mist) assert.equal(peak(l), 0.9, `${id}: mist at 90%`);
      if (l.type === 'cutout') assert.ok(!l.blur, `${id}: the subject stays sharp`);
      if (['text', 'number', 'pill'].includes(l.type) && l.fx?.rotate) assert.ok(Math.abs(l.fx.rotate) <= 8, `${id}: type tilt <= 8`);
    });
  });
});
// Fit rules are specific.
assert.ok(!C.fits('versus-split', { headline: 'x' }), 'versus needs a score');
assert.ok(!C.fits('film-strip', { ...rich, photos: [] }), 'film strip needs 3 photos');
assert.ok(!C.fits('quote-marks', { headline: 'x' }), 'quote marks need a quote');
assert.ok(!C.fits('type-knockout', { ...rich, headline: 'one two three four five six seven' }), 'photo-in-type needs a short headline');
assert.ok(C.fits('record-gauge', { headline: 'x', number: { value: '62', suffix: '%' } }), 'gauge takes a percentage');
assert.ok(!C.fits('record-gauge', { headline: 'x', number: { value: '62' } }), 'gauge needs a share');
// The gauge only shows numbers from the facts (the share is drawn, not written).
const gauge = C.build('record-gauge', rich, 0);
const arc = gauge.layers.find(l => l.shape === 'arc' && l.value < 1);
assert.ok(Math.abs(arc.value - 484 / 706) < 0.001, 'arc fill is 484 of 706');

// ── 3. The gate: effect limits ─────────────────────────────────────────────
{
  const scene = C.build('pill-stack', rich, 0);
  scene.layers.push(
    { type: 'cutout', src: '/a.png', x: 100, y: 100, w: 500, h: 600, blur: 12, fx: { rotate: 30 } },
    { type: 'photo', src: '/b.jpg', x: 0, y: 0, w: 1080, h: 600, blur: 80, rim: { color: '#FFFFFF' }, fx: { tilt: { skewY: 0.5 } } },
    { type: 'shape', shape: 'grain', opacity: 0.5 },
    { type: 'shape', shape: 'leak', x: 0, y: 0, w: 300, h: 300, color: '#FFFFFF', opacity: 1 },
    { type: 'text', role: 'label', text: 'Glow', x: 60, y: 900, w: 400, h: 60, font: 'condensed', size: 40, minSize: 10, color: '#FFFFFF', blur: 4, fx: { glow: { color: '#FB4F14', alpha: 1, blur: 300 } }, knockout: { src: '/a.jpg' } },
    { type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000000', knockout: { src: '/a.jpg' } },
    { type: 'shape', shape: 'gradient', mist: true, x: 0, y: 600, w: 1080, h: 750, color: pal.bg, stops: [[0, 0], [1, 1]] },
  );
  scene.layers[0] = { ...scene.layers[0], texture: 'grain', textureOpacity: 0.6 };
  const { ok, fixes } = C.checkScene(scene);
  assert.ok(ok);
  const L = scene.layers;
  const cut = L.find(l => l.type === 'cutout');
  assert.ok(!('blur' in cut), 'cut-out blur removed');
  assert.equal(cut.fx.rotate, C.FX_LIMITS.imageRotate);
  const ph = L.find(l => l.src === '/b.jpg');
  assert.equal(ph.blur, C.FX_LIMITS.photoBlur);
  assert.ok(!ph.rim, 'rim light only on cut-outs');
  assert.equal(ph.fx.tilt.skewY, C.FX_LIMITS.skew);
  assert.equal(L.filter(l => l.shape === 'grain').pop().opacity, C.FX_LIMITS.grain);
  assert.equal(L.find(l => l.shape === 'leak').opacity, C.FX_LIMITS.leak);
  assert.equal(L[0].textureOpacity, C.FX_LIMITS.grain);
  const glow = L.find(l => l.text === 'Glow');
  assert.ok(!('blur' in glow), 'type is never blurred');
  assert.equal(glow.fx.glow.alpha, C.FX_LIMITS.glowAlpha);
  assert.equal(glow.fx.glow.blur, C.FX_LIMITS.glowBlur);
  assert.equal(glow.minSize, C.FX_LIMITS.minType, 'smallest type raised');
  assert.ok(glow.knockout, 'photo-in-type allowed on text');
  assert.ok(!L.find(l => l.shape === 'rect' && l.w === 10).knockout, 'knockout removed from a shape');
  const m = L.filter(l => l.mist).pop();
  assert.equal(peak(m), 0.9, 'mist normalised to 90%');
  ['composed-effects', 'mist-opacity', 'text-fit'].forEach(rule => assert.ok(fixes.some(f => f.rule === rule), `fix ${rule}`));
}

// ── 4. Text over a busy photo ──────────────────────────────────────────────
{
  const bare = { v: 1, size: { w: 1080, h: 1350 }, palette: pal, facts: [], layers: [
    { type: 'background', fill: { kind: 'solid', colors: [pal.bg] } },
    { type: 'photo', src: '/a.jpg', x: 0, y: 0, w: 1080, h: 1350, mask: 'rect' },
    { type: 'text', role: 'headline', text: 'OVER THE PHOTO', x: 50, y: 900, w: 980, h: 300, font: 'display', size: 120, color: '#FFFFFF' },
  ] };
  const a = C.checkScene(JSON.parse(JSON.stringify(bare)));
  assert.ok(a.scene.layers[2].fx?.shadow, 'unprotected text gets a shadow');
  assert.ok(a.fixes.some(f => f.rule === 'composed-contrast'));
  const shielded = JSON.parse(JSON.stringify(bare));
  shielded.layers.splice(2, 0, { type: 'shape', shape: 'gradient', mist: true, x: 0, y: 700, w: 1080, h: 650, color: pal.bg, stops: [[0, 0], [1, 0.9]] });
  const b = C.checkScene(shielded);
  assert.ok(!b.scene.layers[3].fx?.shadow, 'text on mist is left alone');
  const dark = JSON.parse(JSON.stringify(bare));
  dark.layers[2].color = '#000000';
  assert.equal(C.checkScene(dark).scene.layers[2].fx.shadow.color, '#FFFFFF', 'dark type gets a light shadow');
  const faded = JSON.parse(JSON.stringify(bare));
  faded.layers[1].fx = { opacity: 0.3 };
  assert.ok(!C.checkScene(faded).scene.layers[2].fx?.shadow, 'a faded photo is not busy');
}

// ── 5. Palette roles are contrast-checked ──────────────────────────────────
[['#FB4F14', '#000000'], ['#552583', '#FDB927'], ['#0B5D3B', '#FFD54A'], ['#C4CED4', '#000000'], []].forEach(colors => {
  const p = C.makePalette(colors);
  assert.ok(C._test.contrast(p.onAccent, p.accent) >= 4.5, `${colors}: text on accent reads`);
  assert.ok(C._test.contrast(p.inkSoft, p.bg) >= 4.5, `${colors}: soft ink reads`);
  ['onAccent', 'inkSoft', 'deep', 'rim', ...p.tone.map((_, i) => i)].forEach(k => {
    const c = typeof k === 'number' ? p.tone[k] : p[k];
    assert.ok(p.allowed.includes(c), `${colors}: ${k} is an allowed colour`);
  });
  const f = C.flipPalette(p);
  assert.ok(f.onAccent && f.allowed.includes(f.onAccent), 'flipped palette keeps the roles');
});
// Lakers: team purple on gold pills (the ES pill guide).
assert.equal(C.makePalette(['#552583', '#FDB927']).onAccent, C.makePalette(['#552583', '#FDB927']).bg);
// Old serialized palettes (no roles) still build.
const old = { ...pal };
['onAccent', 'inkSoft', 'deep', 'rim', 'tone'].forEach(k => delete old[k]);
assert.ok(C.checkScene(C.build('pill-stack', { ...rich, palette: old }, 0)).ok, 'old palette objects are upgraded');

// ── 6. New fixes ───────────────────────────────────────────────────────────
['brighten-photo', 'darken-photo', 'more-depth', 'add-scrim'].forEach(op => {
  assert.ok(C.FIXES.includes(op));
  ['pill-stack', 'trading-card', 'hero-number'].forEach(id => {
    const s = C.build(id, rich, 0);
    const next = C.applyFix(s, op);
    assert.notDeepEqual(next.layers, s.layers, `${op} changes ${id}`);
    assert.equal(next.fixApplied, op);
    const checked = C.checkScene(next);
    assert.ok(checked.ok, `${op} on ${id} passes the gate`);
    next.layers.filter(l => l.mist).forEach(l => assert.equal(peak(l), 0.9, `${op} keeps the mist at 90%`));
  });
});
const depth = C.applyFix(C.build('trading-card', rich, 0), 'more-depth');
assert.ok(depth.layers.find(l => l.type === 'cutout').rim, 'more-depth rim-lights the cut-out');
assert.ok(depth.layers.some(l => l.shape === 'vignette'));

console.log('compose styles checks passed');
