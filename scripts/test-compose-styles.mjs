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
  // Text on an accent pill follows the editor's pair rule (mist >= 2.4:1, else white / black).
  assert.ok(C._test.contrast(p.onAccent, p.accent) >= 2.4, `${colors}: text on accent reads`);
  assert.equal(p.onAccent, C.pillTextColor({ background: p.accent, mist: p.bg }), `${colors}: onAccent is the pill rule`);
  assert.ok(C._test.contrast(p.inkSoft, p.bg) >= 4.5, `${colors}: soft ink reads`);
  ['onAccent', 'inkSoft', 'deep', 'rim', ...p.tone.map((_, i) => i)].forEach(k => {
    const c = typeof k === 'number' ? p.tone[k] : p[k];
    assert.ok(p.allowed.includes(c), `${colors}: ${k} is an allowed colour`);
  });
  const f = C.flipPalette(p);
  assert.ok(f.onAccent && f.allowed.includes(f.onAccent), 'flipped palette keeps the roles');
});
// Lakers: team purple on gold pills (the field colour reads on the accent, >= 2.4:1).
assert.equal(C.makePalette(['#552583', '#FDB927']).onAccent, C.makePalette(['#552583', '#FDB927']).bg);
// With the brand-kit pair (what the composer passes): the pill is the pair's
// background and its text the editor's rule (Lakers: gold pill, purple text;
// Golf Green & Gold: the mist is too close to the green, so white).
{
  const lakers = C.makePalette(['#FAB624', '#542C81'], { pair: { background: '#FAB624', foreground: '#542C81', mist: '#542C81' } });
  assert.equal(lakers.pillBg, '#FAB624');
  assert.equal(lakers.pillInk, '#542C81');
  assert.ok(lakers.allowed.includes('#FAB624') && lakers.allowed.includes('#542C81'));
  const golf = C.makePalette(['#0B5D3B', '#FFD54A', '#073F28'], { pair: { background: '#0B5D3B', foreground: '#FFD54A', mist: '#073F28' } });
  const golfDark = C.tonePalette(golf, 'light');
  assert.equal(golfDark.box, '#0B5D3B', 'tone boxes use the pair background');
  assert.equal(golfDark.boxInk, '#FFFFFF', 'mist under 2.4:1 -> white');
  assert.deepEqual(golfDark.pair, golf.pair, 'the pair survives the tone palette');
  assert.equal(C.boardColors(golfDark, {}).box, '#0B5D3B', 'board boxes use the pair background');
  assert.equal(C.boardColors(golfDark, {}).boxInk, '#FFFFFF');
}
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

// ── Big-number poster at 9:16 and 1:1 (polish 2026-11-20) ────────────────
// 4:5 is the original layout, value for value; 9:16 fills the lower third
// instead of leaving it empty; 1:1 keeps headline and body apart. Each size
// passes the ES gate with no fixes, every text box inside the canvas.
{
  const boxOf = (s, role) => s.layers.find(l => l.role === role);
  const portrait = C.build('big-number', rich, 0);
  assert.deepEqual([boxOf(portrait, 'number').y, boxOf(portrait, 'number').h, boxOf(portrait, 'headline').y, boxOf(portrait, 'headline').h, boxOf(portrait, 'headline').size, boxOf(portrait, 'body').y], [200, 600, 910, 330, 130, 1240], '4:5 unchanged');
  for (const size of ['story', 'square']) {
    for (const v of [0, 1, 2]) {
      const s = C.build('big-number', { ...rich, size }, v);
      const H = s.size.h;
      const gate = C.checkScene(JSON.parse(JSON.stringify(s)));
      assert.ok(gate.ok, `big-number ${size} v${v}: ${JSON.stringify(gate.errors)}`);
      assert.deepEqual(gate.fixes.filter(f => /safe|logo/i.test(f.rule)), [], `big-number ${size} v${v}: no safe-area or logo fixes`);
      const num = boxOf(s, 'number');
      const head = boxOf(s, 'headline');
      const body = boxOf(s, 'body');
      assert.ok(num.y + num.h <= head.y && head.y + head.h <= body.y, `${size}: number, headline, body stack without overlap`);
      assert.ok(body.y + body.h <= H - 50, `${size}: body inside the safe area`);
      if (size === 'story') {
        assert.ok(head.y >= H * 0.6, '9:16: the headline sits in the lower part, not at the 4:5 position');
        assert.ok(body.y - (head.y + head.h) <= 80, '9:16: no empty band between headline and body');
        assert.ok(num.h > 600 && head.size > 130, '9:16: number and headline grow');
      }
    }
  }
}

// ── 7. Pills follow the editor's rules (Acumin Black, straight, one colour) ──
{
  // Every pill layer of every composition (all variants, all tones of the looks).
  const kitPal = C.makePalette(['#FAB624', '#542C81'], { name: 'Lakers', pair: { background: '#FAB624', foreground: '#542C81', mist: '#542C81' } });
  let checked = 0;
  for (const a of C.ARCHETYPES) {
    for (const palette of [pal, kitPal]) {
      for (const tone of a.looks ? a.tones : ['']) {
        const input = { ...rich, palette, swipe: true, ...(tone ? { tone } : {}) };
        if (!C.fits(a.id, input)) continue;
        [0, 1, 2].forEach(v => {
          const scene = C.build(a.id, input, v);
          scene.layers.filter(C.isPillLayer).forEach(l => {
            checked += 1;
            const tag = `${a.id} v${v} ${tone} ${l.role}`;
            assert.equal(l.font, 'pill', `${tag}: pill font`);
            assert.ok(!('weight' in l) && !('tracking' in l), `${tag}: no weight / tracking override`);
            assert.equal(l.text, l.text.toUpperCase(), `${tag}: uppercase`);
            assert.ok(!l.fx?.rotate && !l.fx?.tilt && !l.fx?.shadow && !l.fx?.glow, `${tag}: straight, no shadow or glow`);
            assert.ok(!l.radius, `${tag}: sharp corners`);
            if (l.type === 'text') {
              assert.ok(!l.box.colors, `${tag}: one box colour`);
              assert.ok(!(l.highlight?.words || []).length, `${tag}: no second-colour words in a pill`);
            }
          });
        });
      }
    }
  }
  assert.ok(checked > 200, `pill layers checked (${checked})`);
  assert.match(C.FONTS.pill, /^"Acumin Post"/, 'pill font is the editor\'s Acumin Post (Acumin Pro Condensed Black)');

  // Drawn with a recording canvas: the boxes, fonts and colours the renderer uses.
  const fakeCtx = () => {
    const calls = { rects: [], texts: [], fonts: [], spacing: [] };
    const g = {
      calls, globalAlpha: 1, fillStyle: '#000', shadowColor: 'transparent', textAlign: 'left', textBaseline: 'alphabetic',
      _font: '10px x', get font() { return this._font; }, set font(v) { this._font = v; calls.fonts.push(v); },
      _ls: '0px', get letterSpacing() { return this._ls; }, set letterSpacing(v) { this._ls = v; calls.spacing.push(v); },
      save() {}, restore() {}, beginPath() {}, fill() {}, rect() {}, clip() {},
      measureText(t) { const size = Number((this._font.match(/([\d.]+)px/) || [])[1] || 10); return { width: String(t).length * size * 0.42, actualBoundingBoxAscent: size * 0.7, actualBoundingBoxDescent: 0 }; },
      fillRect(x, y, w, h) { calls.rects.push({ x, y, w, h, fill: this.fillStyle }); },
      fillText(t, x, y) { calls.texts.push({ t, x, y, fill: this.fillStyle, font: this._font }); },
      getImageData() { throw new Error('no pixels'); },
    };
    return g;
  };
  const scene = C.build('pill-stack', { ...rich, palette: kitPal, headline: 'Lebron to break another NBA record tonight' }, 0);
  const head = scene.layers.find(l => l.role === 'headline');
  const g = fakeCtx();
  const report = { items: [], palette: scene.palette };
  C._pill.drawText(g, head, 1, report);
  const item = report.items[0];
  assert.ok(item.pill, 'a boxed headline reports its pill rows');
  assert.match(item.pill.font, /^900 [\d.]+px "Acumin Post"/, 'headline pills: Acumin Black 900');
  assert.equal(item.pill.tracking, 0, 'no letter-spacing');
  assert.ok(g.calls.spacing.every(v => v === '0px'), 'letter-spacing set to 0');
  const rows = item.pill.rows;
  assert.ok(rows.length >= 2, 'a stacked headline');
  assert.equal(g.calls.rects.length, rows.length, 'one sharp box per row');
  assert.ok(new Set(g.calls.rects.map(r => r.fill)).size === 1 && g.calls.rects[0].fill === '#FAB624', 'every row the pair background');
  const size = item.size;
  const m = C.pillMetrics(size, size * 0.7);
  rows.forEach(r => assert.ok(Math.abs(r.h - size * 122 / 130) < 1e-6, 'pill height 122/130 of the type'));
  assert.ok(Math.abs(item.pill.padLeft - size * 18.4 / 130) < 1e-6 && Math.abs(item.pill.padRight - size * 21.88 / 130) < 1e-6, 'editor padding ratio');
  for (let i = 1; i < rows.length; i += 1) {
    const gap = rows[i].y - rows[i - 1].y;
    assert.ok(Math.abs(gap - m.step) < 1e-6, 'row step = the editor formula');
    assert.ok(rows[i].y <= rows[i - 1].y + rows[i - 1].h, 'stacked rows touch (no gap)');
    assert.ok(rows[i].y >= rows[i - 1].y + m.topPad + m.cap, 'the next row never covers the letters above');
  }
  g.calls.texts.forEach((t, i) => {
    assert.equal(t.t, t.t.toUpperCase(), 'uppercase');
    assert.equal(t.fill, '#542C81', 'text = the pair rule (Lakers purple on gold)');
  });
  // Text starts at the left padding of its row.
  const firstWord = g.calls.texts[0];
  assert.ok(Math.abs(firstWord.x - (rows[0].x + item.pill.padLeft)) < 1e-6, 'text at the left padding');

  // Small pills: the same font and proportions, scaled to the pill height.
  const kick = { type: 'pill', role: 'kicker', text: 'record alert!', x: 50, y: 62, h: 58, color: '#FFFFFF', bg: '#0A7DFA', maxW: 700, fx: { rotate: 6, shadow: { blur: 10 }, glow: { blur: 20 } }, radius: 12 };
  const g2 = fakeCtx();
  const r2 = { items: [], palette: {} };
  C._pill.drawPill(g2, kick, 1, r2);
  const k = r2.items[0];
  assert.match(k.pill.font, /^900 [\d.]+px "Acumin Post"/, 'kicker: Acumin Black 900');
  assert.ok(Math.abs(k.size - 58 * 130 / 122) < 1e-6, 'kicker type 130/122 of its height');
  assert.ok(Math.abs(k.pill.padLeft - 58 / (122 / 130) * 18.4 / 130) < 1e-6, 'kicker: editor padding ratio');
  assert.equal(k.pill.tracking, 0);
  assert.equal(g2.calls.texts[0].t, 'RECORD ALERT!', 'kicker uppercase');
  assert.equal(g2.calls.rects.length, 1, 'kicker: one sharp rectangle (no rounded corners)');
  assert.equal(g2.shadowBlur, undefined, 'no shadow / glow set');
  assert.equal(k.pill.ink, C.pillTextColor({ background: '#0A7DFA', mist: '#FFFFFF' }), 'kicker text: the pair rule');
  // A layer colour that does not reach 2.4:1 gives way to white / black.
  const g3 = fakeCtx();
  const r3 = { items: [], palette: {} };
  C._pill.drawPill(g3, { ...kick, color: '#3A8BFF' }, 1, r3);
  assert.equal(r3.items[0].pill.ink, '#000000');
  // Too wide for maxW: the type shrinks inside the same pill height (drawPills).
  const g4 = fakeCtx();
  const r4 = { items: [], palette: {} };
  C._pill.drawPill(g4, { ...kick, text: 'a very long kicker that cannot fit', maxW: 300 }, 1, r4);
  assert.ok(r4.items[0].box.w <= 300 + 1 && r4.items[0].box.h === 58, 'shrinks the type, keeps the pill');
}

console.log('compose styles checks passed');
