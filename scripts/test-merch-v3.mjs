// Merch v3: the person's whole line, variations, size/position fit, all mockups.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../merch-print.js');
const FW = require('../netlify/functions/_fourthwall.js');
let n = 0; const ok = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const TEE = { pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150 };
const line = 'We center fans in everything we make for the game';

ok('Your words keeps the whole sentence, word for word', () => {
  const c = P.yourWords(line);
  assert.ok(c);
  assert.equal(c.stack.map(r => r.text).join(' '), line.toUpperCase());
  assert.ok(P.hasLine(c, line));
  assert.ok(c.stack.every(r => r.text.length <= 60));
});
ok('fallback designs lead with Your words', () => {
  assert.equal(P.fallbackConcepts(line)[0].label, 'Your words');
});
ok('hasLine spots a shortened line', () => {
  assert.equal(P.hasLine({ stack: [{ text: 'WE CENTER' }, { text: 'FANS' }] }, line), false);
});
ok('a long article keeps only its first sentence, still whole', () => {
  const t = 'The Lakers won again tonight. ' + 'More words follow here and keep going for a long time. '.repeat(4);
  assert.equal(P.mainLine(t), 'The Lakers won again tonight');
});
ok('variations: different layouts of the same words', () => {
  const base = P.yourWords(line);
  const v = P.variations(base);
  assert.ok(v.length >= 5);
  assert.equal(new Set(v.map(x => x.id)).size, v.length);
  v.forEach(x => {
    assert.equal(x.stack.map(r => r.text).join(' ').replace(/\s+/g, ' '), line.toUpperCase(), x.variant);
    assert.ok(x.stack.length <= 9);
    assert.equal(x.variantOf, base.id);
    assert.equal(P.checks(x, TEE).filter(c => c.level === 'error').length, 0, x.variant);
  });
});
ok('variations keep a small attribution row last', () => {
  const q = { id: 'q', title: 'Q', collection: 'quote', team: null, palette: { a: '#0A7DFA', b: '#FFFFFF', ink: '#000000' }, garment: { color: '#FFFFFF' }, stack: [{ text: 'NOBODY BELIEVED IN US', size: 'big', fill: 'a', ink: 'white' }, { text: '— COACH', size: 'small', fill: 'b', ink: 'ink' }] };
  P.variations(q).forEach(x => assert.equal(x.stack[x.stack.length - 1].text, '— COACH'));
});
ok('fit: size scales the print, position moves it', () => {
  const c = P.yourWords(line);
  const a = P.layout(c, TEE);
  const big = P.layout({ ...c, fit: { scale: 1.4 } }, TEE);
  const small = P.layout({ ...c, fit: { scale: 0.7 } }, TEE);
  assert.ok(big.design.w > a.design.w && small.design.w < a.design.w);
  const low = P.layout({ ...c, fit: { topIn: 4 } }, TEE);
  assert.equal(low.design.y, 600);
  assert.ok(big.items.every(i => i.x >= 0 && i.x + i.w <= TEE.pixelsWidth));
});
ok('fit is clamped to safe values', () => {
  assert.deepEqual(P.fitOf({ fit: { scale: 9, topIn: -3 } }), { scale: 1.6, topIn: 0.5, xIn: 0 });
  assert.deepEqual(P.fitOf({}), { scale: 1, topIn: null, xIn: 0 });
});
ok('splitWords modes', () => {
  assert.deepEqual(P.splitWords('the king of the court', 'word'), ['THE KING', 'OF THE COURT']);
  assert.ok(P.splitWords(line, 'line').every(r => r.length <= 24));
});
ok('Fourthwall product: every mockup, variant images labelled by colour, no repeats', () => {
  const p = FW.normalizeProduct({ id: 'p', images: [{ url: 'a' }, { url: 'b' }], variants: [
    { id: 'v1', attributes: { color: { name: 'White' }, size: { name: 'M' } }, images: [{ url: 'a' }, { url: 'w1' }] },
    { id: 'v2', attributes: { color: { name: 'Black' }, size: { name: 'L' } }, images: [{ url: 'k1' }, { url: 'k2' }] },
  ] });
  assert.deepEqual(p.images.map(i => i.url), ['a', 'b', 'w1', 'k1', 'k2']);
  assert.equal(p.images.find(i => i.url === 'k2').color, 'Black');
  assert.equal(p.variants[1].color, 'Black');
});
console.log(`merch v3: ${n} checks passed`);

// ─── merch4 engine ──────────────────────────────────────────────────────
ok('ES pill spacing (merch5): 0 gap; same-colour rows overlap by h - step, different colours touch', () => {
  const c = P.yourWords(line);
  const scene = P.layout(c, TEE);
  const pills = scene.items.filter(i => i.type === 'pill');
  for (let i = 1; i < pills.length; i++) {
    const g = P.pillGeom(pills[i - 1].size, scene.dpi / 72);
    const want = pills[i].bg === pills[i - 1].bg && pills[i].knockout === pills[i - 1].knockout ? Math.round(g.h) - Math.round(g.step) : 0;
    assert.equal(pills[i - 1].y + pills[i - 1].h - pills[i].y, want, `row ${i}`);
  }
  const one = P.layout({ ...c, stack: c.stack.map(r => ({ ...r, fill: 'a', ink: 'white' })) }, TEE).items.filter(i => i.type === 'pill');
  assert.ok(one.slice(1).every((p, i) => p.y < one[i].y + one[i].h), 'one colour: every row overlaps the one above');
});
ok('navy second colour on a dark tee becomes a white pill with team-colour text', () => {
  const c = { palette: { a: '#0A7DFA', b: '#033162', ink: '#FFFFFF' }, stack: [{ text: 'THEY', size: 'big', fill: 'a', ink: 'white' }, { text: 'DONT', size: 'big', fill: 'b', ink: 'white' }] };
  const pills = P.layout(c, { ...TEE, garmentColor: '#020718' }).items;
  assert.equal(pills[1].bg, '#FFFFFF'); assert.equal(pills[1].ink, '#0A7DFA');
  assert.equal(P.checks(c, { ...TEE, garmentColor: '#020718' }).find(x => x.id === 'garment').level, 'ok');
});
ok('Pro elements are laid out inside the area; Basic strips them', () => {
  const c = { mode: 'pro', ...P.yourWords(line), elements: [{ type: 'number', text: '23', style: 'outline', color: 'b', position: 'behind' }, { type: 'icon', name: 'crown', position: 'above', color: 'a' }, { type: 'rule', position: 'below', color: 'a', weight: 'thick' }, { type: 'block', position: 'behind', color: 'a' }] };
  const s = P.layout(c, TEE);
  assert.deepEqual(s.items.filter(i => i.type !== 'pill').map(i => i.type).sort(), ['icon', 'number', 'rect']);
  assert.equal(P.checks(c, TEE).filter(x => x.level === 'error').length, 0);
  assert.equal(P.layout({ ...c, mode: 'basic' }, TEE).items.filter(i => i.type !== 'pill').length, 0);
  assert.equal(P.elementsOf({ mode: 'pro', elements: [{ type: 'icon', name: 'nba-logo', position: 'above' }, { type: 'number', text: '123' }] }).length, 0);
  assert.ok(P.ICONS.includes('basketball') && P.ELEMENT_TYPES.rule.includes('between'));
});
ok('photoFor picks the nearest template colour with photos', () => {
  const colors = [{ name: 'White', hex: '#ffffff', photos: ['w.jpg'] }, { name: 'French Navy', hex: '#020718', photos: ['n.jpg'] }, { name: 'Red', hex: '#ed0739', photos: [] }];
  assert.equal(P.photoFor(colors, '#0C2340').url, 'n.jpg');
  assert.equal(P.photoFor(colors, '#C8102E').url, 'n.jpg'.replace('n', 'n')); // red has no photos -> nearest with photos
  assert.equal(P.photoFor([], '#fff'), null);
});
console.log(`merch v3 + merch4 engine: ${n} checks passed`);

// ─── Logo placement guards (owner: the sleeve logo landed on the body) ───
// merch7: every calibrated photo of every template (PHOTO_AREAS[templateId][photoIndex]).
const CALS = Object.entries(P.PHOTO_AREAS).flatMap(([tid, set]) => Object.entries(set).map(([i, cal]) => [tid, Number(i), cal]));
ok('photo calibrations: the tee and the hoodie, several photos each', () => {
  assert.deepEqual(Object.keys(P.PHOTO_AREAS).sort(), ['pro_14kNy0EJQkqopY-Z9Pm41A', 'pro_380', 'pro_6ae602fcb22447bfbc', 'pro_ODh_gv0ESl6jIcRfvSww0w', 'pro_Vv1XdaPMSdm6jZ5pj24NCQ', 'pro_xPL7YjOBRQWVL50Im8eKAA']);
  assert.deepEqual(Object.keys(P.PHOTO_AREAS.pro_Vv1XdaPMSdm6jZ5pj24NCQ), ['0', '1', '3']);
  assert.deepEqual(Object.keys(P.PHOTO_AREAS.pro_380), ['0', '1', '2']);
  CALS.forEach(([tid, i, c]) => {
    assert.ok(['front', 'back'].includes(c.side) && c.angle, `${tid}/${i}`);
    ['x', 'y', 'w', 'h', 'ppi', 'top'].forEach(k => assert.ok(c[k] > 0 && c[k] < 1, `${tid}/${i} ${k}`));
    assert.ok(c.body.r > 0 && Math.abs(c.body.yaw) < 30, `${tid}/${i} body`);
  });
});
ok('photo calibrations: every sleeve logo sits inside its measured wearer-left sleeve', () => {
  let n = 0;
  CALS.forEach(([tid, i, cal]) => {
    const s = cal.logo?.sleeve;
    if (cal.side === 'back') { assert.ok(!cal.logo, `${tid}/${i}: no logo drawn on a back photo`); return; }
    const SLEEVELESS = ['pro_xPL7YjOBRQWVL50Im8eKAA', 'pro_ODh_gv0ESl6jIcRfvSww0w']; // tank, youth tee: no sleeve print areas
    if (SLEEVELESS.includes(tid)) { assert.ok(!cal.logo, `${tid}/${i}: no sleeve spot on a blank without sleeve areas`); return; }
    assert.ok(s && cal.sleeveLeft, `${tid}/${i}: front photos measure the sleeve spot`);
    P.logoCorners(s).forEach(([x, y]) => assert.ok(P.pointInPoly(x, y, cal.sleeveLeft), `${tid}/${i}: corner ${x.toFixed(3)},${y.toFixed(3)} outside the sleeve`));
    assert.ok(s.x > cal.body.cx, `${tid}/${i}: wearer-left sleeve is on the viewer's right`);
    assert.ok(cal.sleeveLeft.every(([x]) => x > cal.body.cx), `${tid}/${i}: sleeve outline on the viewer's right`);
    assert.ok(!cal.logo.neck && !cal.logo['back-neck'] && !cal.logo.label, `${tid}/${i}: unmeasured spots are not drawn`);
    n += 1;
  });
  assert.ok(n >= 4);
});
ok('photo calibrations: the print area sits on the torso (top corners inside, >= 90% covered)', () => {
  CALS.forEach(([tid, i, cal]) => {
    const r = cal;
    const inTorso = (x, y) => P.pointInPoly(x, y, cal.torso);
    // an arm in front of the chest (occluded) may hide one side; the rest must hold
    if (!cal.occluded) assert.ok(inTorso(r.x + 0.002, r.y + 0.002) && inTorso(r.x + r.w - 0.002, r.y + 0.002), `${tid}/${i}: top corners`);
    else assert.ok(inTorso(r.x + r.w / 2, r.y + 0.002) && inTorso(r.x + r.w / 2, r.y + r.h / 2), `${tid}/${i}: top centre and centre`);
    let inside = 0, all = 0;
    for (let a = 0; a <= 20; a++) for (let b = 0; b <= 20; b++) { all += 1; if (P.pointInPoly(r.x + r.w * a / 20, r.y + r.h * b / 20, cal.torso)) inside += 1; }
    assert.ok(inside / all >= (cal.occluded ? 0.7 : 0.9), `${tid}/${i}: ${(100 * inside / all).toFixed(0)}% of the print on the torso`);
    if (cal.occluded) assert.notEqual(P.PHOTO_HERO[tid], i, `${tid}/${i}: an occluded photo is not the one to open on`);
    assert.ok(cal.torso.every(([x, y]) => x > 0 && x < 1 && y > 0 && y < 1));
    // the print is drawn at its real size: the main area's height = ppi x inches
    assert.ok(Math.abs(r.h - cal.ppi * ({ pro_xPL7YjOBRQWVL50Im8eKAA: 16, pro_ODh_gv0ESl6jIcRfvSww0w: 12 }[tid] || (tid === 'pro_380' && cal.side === 'front' ? 11 : 18)) * 720 / 960) < 1e-9, `${tid}/${i}: height`);
  });
});
ok('photo calibrations: the wrap foreshortens the edges, never mirrors them', () => {
  CALS.forEach(([tid, i, cal]) => {
    const r = P.photoRect(cal, 15, 18);
    const half = P.photoRect(cal, 7.5, 18);
    assert.ok(r.w > half.w && r.w < 2 * half.w + 1e-9, `${tid}/${i}`);
  });
});
ok('photosFor: every photo of the nearest colour, calibrated only where measured for the side', () => {
  const cols = [{ name: 'White', hex: '#ffffff', photos: ['w0', 'w1', 'w2', 'w3'] }, { name: 'Black', hex: '#080808', photos: [{ url: 'k0', angle: 'front', index: 0 }, { url: 'k1', angle: 'back', index: 1 }, { url: 'k2', angle: 'front', index: 2 }, { url: 'k3', angle: 'side', index: 3 }] }];
  const tee = P.photosFor(cols, '#FFFFFF', 'pro_Vv1XdaPMSdm6jZ5pj24NCQ');
  assert.deepEqual(tee.map(p => [p.url, p.angle, p.index, p.calibrated]), [['w0', 'front', 0, true], ['w1', 'side', 1, true], ['w2', 'side', 2, false], ['w3', 'back', 3, false]]);
  assert.equal(tee.find(p => p.primary).index, 0);
  const back = P.photosFor(cols, '#FFFFFF', 'pro_Vv1XdaPMSdm6jZ5pj24NCQ', { region: 'back_large' });
  assert.deepEqual(back.filter(p => p.calibrated).map(p => p.index), [3], 'front photos are not calibrated for a back print');
  assert.equal(back.find(p => p.primary).index, 3);
  const hood = P.photosFor(cols, '#000000', 'pro_380');
  assert.deepEqual(hood.map(p => [p.url, p.angle, p.calibrated]), [['k0', 'front', true], ['k1', 'back', false], ['k2', 'front', true], ['k3', 'side', false]]);
  assert.equal(hood.find(p => p.primary).index, 2, 'the hoodie opens on the photo with nothing in front of the chest');
  assert.ok(P.photosFor(cols, '#FFFFFF', 'pro_unknown').every(p => !p.calibrated && !p.primary), 'unknown template: nothing calibrated');
  assert.deepEqual(P.photosFor([], '#FFFFFF', 'pro_380'), []);
  const art = P.photosFor([{ name: 'W', hex: '#ffffff', photos: [{ url: 's0', angle: 'front', index: 0, sampleArt: true }, { url: 's1', angle: 'side', index: 1, view: 'front' }] }], '#FFFFFF', 'pro_Vv1XdaPMSdm6jZ5pj24NCQ');
  assert.equal(art[0].calibrated, false, 'never drawn over Fourthwall sample art');
  assert.equal(art[0].sampleArt, true);
  assert.equal(art.find(p => p.primary).index, 1);
  // PROD order: photos filtered out keep their Fourthwall index
  const gap = P.photosFor([{ name: 'W', hex: '#ffffff', photos: [{ url: 'b3', angle: 'back', index: 3, view: 'back' }] }], '#FFFFFF', 'pro_Vv1XdaPMSdm6jZ5pj24NCQ', { region: 'back' });
  assert.deepEqual([gap[0].index, gap[0].calibrated], [3, true]);
  assert.equal(P.photoFor([{ name: 'B', hex: '#000000', photos: [{ url: 'o0', index: 0 }] }], '#000000').url, 'o0', 'photoFor reads object photos');
});
ok('photoCal: by index, by angle, else photo 0; no calibration -> null', () => {
  const T = 'pro_Vv1XdaPMSdm6jZ5pj24NCQ';
  assert.equal(P.photoCal(T, { photoIndex: 1 }), P.PHOTO_AREAS[T][1]);
  assert.equal(P.photoCal(T, { photoIndex: 2 }), null);
  assert.equal(P.photoCal(T, { angle: 'back' }), P.PHOTO_AREAS[T][3]);
  assert.equal(P.photoCal(T, {}), P.PHOTO_AREAS[T][0]);
  assert.equal(P.photoCal('pro_x', {}), null);
  assert.equal(P.TEMPLATE_KIND.tee, T);
});
ok('flat preview: sleeve logo on the wearer-left sleeve (viewer right)', () => {
  assert.ok(P.LOGO_SPOTS.sleeve.x > 772, `x ${P.LOGO_SPOTS.sleeve.x}`);
});
console.log(`logo guards: ${n} checks passed`);

// photoMock never draws on an uncalibrated photo (resolves null before touching the canvas).
{
  const T = 'pro_Vv1XdaPMSdm6jZ5pj24NCQ';
  const c = P.yourWords(line);
  const canvas = { width: 720, getContext() { throw new Error('drew on an uncalibrated photo'); } };
  const front = { regionId: 'front_large', pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150 };
  const back = { regionId: 'back_large', pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150 };
  assert.equal(await P.photoMock(c, canvas, { photo: 'x.jpg', templateId: T, photoIndex: 2, spec: front }), null, 'side photo (no calibration)');
  assert.equal(await P.photoMock(c, canvas, { photo: 'x.jpg', templateId: T, photoIndex: 3, spec: front }), null, 'front design on the back photo');
  assert.equal(await P.photoMock(c, canvas, { photo: 'x.jpg', templateId: T, photoIndex: 0, spec: back }), null, 'back design on a front photo');
  assert.equal(await P.photoMock(c, canvas, { photo: 'x.jpg', templateId: 'pro_other', spec: front }), null, 'another template');
  assert.equal(await P.photoMock(c, canvas, { photo: 'x.jpg', kind: 'poster', spec: front }), null, 'no calibration for the kind');
  assert.equal(await P.photoMock(c, canvas, { templateId: T, photoIndex: 0, spec: front }), null, 'no photo');
  n += 1; console.log('ok photoMock: uncalibrated photos and wrong sides are never drawn on');
}
console.log(`merch7 photos: ${n} checks passed`);

// ─── tote-cal: the tote's flat panel in perspective (PHOTO_QUADS) ───
{
  const TOTE = 'pro_367';
  const cal = P.PHOTO_QUADS[TOTE]?.[0];
  let m = 0; const ok3 = (name, fn) => { fn(); m += 1; console.log('ok', name); };
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  ok3('tote: photo 0 is calibrated as a flat quad (front, 10 x 10 in area), body wraps untouched', () => {
    assert.deepEqual(Object.keys(P.PHOTO_QUADS), [TOTE]);
    assert.deepEqual(Object.keys(P.PHOTO_QUADS[TOTE]), ['0']);
    assert.ok(!P.PHOTO_AREAS[TOTE], 'quads live apart from the body-cylinder table');
    assert.equal(cal.side, 'front'); assert.equal(cal.angle, 'front'); assert.ok(!cal.body);
    assert.equal(P.TEMPLATE_KIND.tote, TOTE); assert.equal(P.PHOTO_HERO[TOTE], 0);
    assert.equal(P.photoCal(TOTE, {}), cal); assert.equal(P.photoCal(TOTE, { photoIndex: 0 }), cal); assert.equal(P.photoCal(TOTE, { angle: 'front' }), cal);
    assert.equal(P.photoCal(TOTE, { photoIndex: 1 }), null);
    ['x', 'y', 'w', 'h', 'ppi', 'top'].forEach(k => assert.ok(cal[k] > 0 && cal[k] < 1, k));
    assert.deepEqual(P.photoRect(cal, 10, 10), { x: cal.x, y: cal.y, w: cal.w, h: cal.h });
  });
  ok3('tote: the print quad is convex, clockwise, near edge taller than the far edge', () => {
    const q = cal.quad.map(([x, y]) => [x * 720, y * 960]);
    q.forEach(([x, y]) => assert.ok(x > 0 && x < 720 && y > 0 && y < 960));
    for (let i = 0; i < 4; i++) assert.ok(cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]) > 0, `corner ${i} turns the same way`);
    const left = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]), right = Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1]);
    assert.ok(left > right * 1.02 && left < right * 1.3, `near ${left.toFixed(1)} vs far ${right.toFixed(1)}`);
    // 10 x 10 in shows ~300 x ~350 px on this shot (the width foreshortened)
    const top = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
    assert.ok(top > 250 && top < 340 && left > 320 && left < 400, `top ${top.toFixed(0)}, left ${left.toFixed(0)}`);
  });
  ok3('tote: the print area sits inside the bag outline (every sampled point), the strap covers < 30% of it', () => {
    const g = P.photoGeometry(TOTE, 0, 720, 960);
    let all = 0, under = 0;
    for (let a = 0; a <= 20; a++) for (let b = 0; b <= 20; b++) {
      const [x, y] = g.toCanvas(a / 2, b / 2);
      all += 1;
      assert.ok(P.pointInPoly(x / 720, y / 960, cal.torso), `(${a / 2}, ${b / 2}) in off the bag`);
      if (cal.cover.some(poly => P.pointInPoly(x / 720, y / 960, poly))) under += 1;
    }
    assert.ok(under > 0 && under / all < 0.3, `${(100 * under / all).toFixed(0)}% of the area under the strap`);
    assert.ok(cal.torso.concat(...cal.cover).every(([x, y]) => x > 0 && x < 1 && y > 0 && y < 1));
  });
  ok3('tote: the area is centred on the panel (projective centre = the measured corners’ diagonal crossing)', () => {
    const c = P.PHOTO_QUADS[TOTE][0].face;
    // the panel's corners (unit square through the map) and its centre
    const [p0, p1, p2, p3] = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => { const w = c.m[6] * u + c.m[7] * v + 1; return [(c.m[0] * u + c.m[1] * v + c.m[2]) / w * 720, (c.m[3] * u + c.m[4] * v + c.m[5]) / w * 960]; });
    const t = ((p2[0] - p0[0]) * (p3[1] - p1[1]) - (p2[1] - p0[1]) * (p3[0] - p1[0])) === 0 ? 0 : (((p1[0] - p0[0]) * (p3[1] - p1[1]) - (p1[1] - p0[1]) * (p3[0] - p1[0])) / ((p2[0] - p0[0]) * (p3[1] - p1[1]) - (p2[1] - p0[1]) * (p3[0] - p1[0])));
    const X = [p0[0] + t * (p2[0] - p0[0]), p0[1] + t * (p2[1] - p0[1])];
    const [cx, cy] = P.photoGeometry(TOTE, 0, 720, 960).toCanvas(5, 5);
    assert.ok(Math.abs(cx - X[0]) < 1e-6 && Math.abs(cy - X[1]) < 1e-6, `${cx},${cy} vs ${X}`);
    assert.deepEqual(p0.map(Math.round), [152, 207], 'the map hits the measured corner');
  });
  ok3('tote: photoGeometry is projective and round-trips at any canvas size', () => {
    for (const W of [720, 1600, 2000]) {
      const H = Math.round(W * 960 / 720);
      const g = P.photoGeometry(TOTE, 0, W);
      assert.equal(g.calibrated, true); assert.equal(g.projective, true); assert.equal(g.side, 'front');
      assert.equal(g.inW, 10); assert.equal(g.inH, 10);
      g.quad.forEach(([x, y], i) => { assert.ok(Math.abs(x - cal.quad[i][0] * W) < 1e-6 && Math.abs(y - cal.quad[i][1] * H) < 1e-6, `corner ${i}`); });
      assert.ok(Math.abs(g.area.x - cal.x * W) < 1e-6 && Math.abs(g.area.w - cal.w * W) < 1e-6 && Math.abs(g.area.y - cal.y * H) < 1e-6);
      for (let x = 0; x <= 10; x += 1.25) for (const y of [0, 3.3, 7.1, 10]) {
        const [xi, yi] = g.toInches(...g.toCanvas(x, y));
        assert.ok(Math.abs(xi - x) < 1e-6 && Math.abs(yi - y) < 1e-6, `${x},${y} -> ${xi},${yi}`);
      }
      // straight lines stay straight (a projective map, not a wrap)
      const a = g.toCanvas(0, 4), b = g.toCanvas(5, 4), c = g.toCanvas(10, 4);
      assert.ok(Math.abs(cross(a, b, c)) < 1e-6 * W * W);
      // the far side is smaller: an inch near the right edge spans fewer px than at the left
      assert.ok(g.toCanvas(10, 5)[0] - g.toCanvas(9, 5)[0] < g.toCanvas(1, 5)[0] - g.toCanvas(0, 5)[0]);
    }
    // a different area size is centred on the same spot
    const s = P.photoGeometry(TOTE, 0, 720, 960, { inW: 6, inH: 6 });
    const [ax, ay] = s.toCanvas(3, 3), [bx, by] = P.photoGeometry(TOTE, 0, 720, 960).toCanvas(5, 5);
    assert.ok(Math.abs(ax - bx) < 1e-6 && Math.abs(ay - by) < 1e-6);
  });
  ok3('tote: photosFor opens on the calibrated photo in either colour; back prints are not drawn', () => {
    const cols = [{ name: 'Black', hex: '#060606', photos: [{ url: 'k0', index: 0, angle: 'front' }] }, { name: 'Oyster', hex: '#f6ebcd', photos: ['o0'] }];
    for (const [hexc, url] of [['#F6EBCD', 'o0'], ['#060606', 'k0'], ['#FFFFFF', 'o0']]) {
      const list = P.photosFor(cols, hexc, TOTE);
      assert.deepEqual(list.map(p => [p.url, p.angle, p.index, p.calibrated, p.primary]), [[url, 'front', 0, true, true]]);
    }
    assert.deepEqual(P.photosFor(cols, '#F6EBCD', TOTE, { region: 'back' }).map(p => p.calibrated), [false]);
  });
  {
    const canvas = { width: 720, getContext() { throw new Error('drew a back print on the tote photo'); } };
    assert.equal(await P.photoMock(P.yourWords(line), canvas, { photo: 'x.jpg', kind: 'tote', templateId: TOTE, photoIndex: 0, spec: { regionId: 'back', pixelsWidth: 1500, pixelsHeight: 1500, dpi: 150 } }), null);
    assert.equal(await P.photoMock(P.yourWords(line), canvas, { photo: 'x.jpg', kind: 'tote', templateId: TOTE, photoIndex: 1, spec: { regionId: 'front', pixelsWidth: 1500, pixelsHeight: 1500, dpi: 150 } }), null);
    m += 1; console.log('ok tote: photoMock never draws a back print or on an unmeasured photo');
  }
  console.log(`tote quad: ${m} checks passed`);
}

// ─── merch-realism: placement (mid-chest default, fit.xIn), designBox, photoGeometry ───
{
  const T = 'pro_Vv1XdaPMSdm6jZ5pj24NCQ';
  const SP = { regionId: 'front_large', pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150, garmentColor: '#FFFFFF' };
  const pal = { a: '#0A7DFA', b: '#111111', ink: '#FFFFFF' };
  const short = { palette: pal, stack: [{ text: 'GAME DAY', size: 'big', fill: 'a', ink: 'white' }, { text: 'EVERY DAY', size: 'big', fill: 'b', ink: 'white' }], fit: { scale: 0.7 } };
  const tall = { palette: pal, stack: ['KOBE', 'SHAQ', 'FISHER', 'HORRY', 'FOX'].map((t, i) => ({ text: t, size: 'big', fill: i % 2 ? 'b' : 'a', ink: 'white' })) };
  let m = 0; const ok2 = (name, fn) => { fn(); m += 1; console.log('ok', name); };
  ok2('default placement is mid-chest: short designs ~3 in down, tall ones centred near 37%', () => {
    const s = P.layout(short, SP);
    const t = P.layout(tall, SP);
    assert.ok(s.designIn.top >= 2.5 && s.designIn.top <= 3.26, `short top ${s.designIn.top}`);
    assert.ok(t.designIn.top >= 2.5 - 1e-6, `tall top ${t.designIn.top}`);
    assert.ok(t.design.y + t.design.h <= t.h, 'tall stays inside');
    [s, t].forEach(x => assert.equal(P.checksFor(x).filter(c => c.level === 'error').length, 0));
    // the slider still overrides it, and Reset (topIn null) returns to it
    assert.equal(P.layout({ ...short, fit: { scale: 0.7, topIn: 1 } }, SP).design.y, 150);
    assert.equal(P.layout({ ...short, fit: { scale: 0.7, topIn: null } }, SP).design.y, s.design.y);
    // small areas (hoodie front 11 x 11 in) keep it inside too
    const h = P.layout({ ...tall, blanks: ['hoodie'] }, { pixelsWidth: 1650, pixelsHeight: 1650, dpi: 150, kind: 'hoodie' });
    assert.ok(h.design.y + h.design.h <= h.h && h.design.y > 0);
  });
  ok2('fit.xIn moves the design sideways and stays inside the print area', () => {
    const base = P.layout(short, SP);
    const right = P.layout({ ...short, fit: { ...short.fit, xIn: 2 } }, SP);
    assert.equal(right.design.x - base.design.x, 300);
    assert.ok(Math.abs(right.designIn.x - 2) < 0.02);
    const far = P.layout({ ...short, fit: { ...short.fit, xIn: 9 } }, SP);
    assert.equal(far.design.x + far.design.w, far.w, 'clamped to the right edge');
    const farL = P.layout({ ...short, fit: { ...short.fit, xIn: -9 } }, SP);
    assert.equal(farL.design.x, 0, 'clamped to the left edge');
    [far, farL].forEach(x => assert.equal(P.checksFor(x).find(c => c.id === 'area').ok, true));
    assert.equal(P.fitOf({ fit: { xIn: 99 } }).xIn, P.FIT.xMaxIn);
    assert.equal(P.fitOf({ fit: { xIn: 'x' } }).xIn, 0);
    // hard goods stay inside their safe edge
    const poster = P.layout({ ...short, blanks: ['poster'], fit: { xIn: 9 } }, { pixelsWidth: 1500, pixelsHeight: 2100, dpi: 300, kind: 'poster' });
    assert.ok(poster.w - poster.design.x - poster.design.w >= Math.round(P.SAFE_IN.poster * 300));
  });
  ok2('designBox matches layout (inches from the print area top-left)', () => {
    const c = { ...short, fit: { scale: 0.7, xIn: 1.5, topIn: 4 } };
    const s = P.layout(c, SP);
    const b = P.designBox(c, SP);
    assert.deepEqual(b, { x: s.design.x / 150, y: s.design.y / 150, w: s.design.w / 150, h: s.design.h / 150 });
    assert.equal(b.y, 4);
  });
  ok2('photoGeometry: same area as photoRect at any canvas size; inverse mapping; uncalibrated', () => {
    for (const W of [720, 1600]) {
      const g = P.photoGeometry(T, 0, W);
      const r = P.photoRect(P.PHOTO_AREAS[T][0], 15, 18);
      const H = Math.round(W * 960 / 720);
      assert.ok(Math.abs(g.area.x - r.x * W) < 1e-6 && Math.abs(g.area.w - r.w * W) < 1e-6 && Math.abs(g.area.y - r.y * H) < 0.5);
      assert.ok(Math.abs(g.area.h - r.h * H) < 0.5); // H is rounded
      const [xi, yi] = g.toInches(...g.toCanvas(3.25, 5.5));
      assert.ok(Math.abs(xi - 3.25) < 1e-6 && Math.abs(yi - 5.5) < 1e-6);
    }
    assert.equal(P.photoGeometry(T, 2, 720).calibrated, false);
    assert.equal(P.photoGeometry('pro_x', 0, 720).area, null);
  });
  console.log(`merch-realism placement: ${m} checks passed`);
}

// ─── merch-realism in Chrome: photoMock width, geometry vs ink, print PNG unchanged ───
// Needs Chrome (skipped without it). The print PNG (render / renderLogo) is compared
// byte for byte with origin/main's merch-print.js (MERCH_PRINT_BASE=<ref> to change;
// MERCH_PRINT_CHANGED=1 skips it on a branch that changes the print on purpose).
{
  const { execFileSync } = await import('node:child_process');
  const { startServer, startChrome, findChrome } = await import('./_qa-chrome.mjs');
  const chromePath = findChrome();
  if (!chromePath) console.log('skip merch-realism Chrome checks: no Chrome');
  else {
    let baseSrc = null;
    if (process.env.MERCH_PRINT_CHANGED !== '1') {
      try { baseSrc = execFileSync('git', ['show', `${process.env.MERCH_PRINT_BASE || 'origin/main'}:merch-print.js`], { cwd: (await import('node:url')).fileURLToPath(new URL('..', import.meta.url)), maxBuffer: 1 << 24 }).toString(); } catch { baseSrc = null; }
    }
    const page = `<!doctype html><meta charset="utf-8"><body><script src="/frameup-rules.js"></script><script src="/brand-kit.js"></script><script src="/video-ads-teams.js"></script><script src="/merch-rules.js"></script>${baseSrc ? '<script src="/merch-print.base-qa.js"></script><script>window.MPBase = window.MerchPrint;</script>' : ''}<script src="/merch-print.js"></script></body>`;
    const { server, base } = await startServer({ extra: url => (url.pathname === '/__qa/merch.html' ? { type: 'text/html', body: page } : url.pathname === '/merch-print.base-qa.js' && baseSrc ? { type: 'text/javascript', body: baseSrc } : null) });
    const chrome = await startChrome(chromePath, { width: 900, height: 700 });
    try {
      await chrome.send('Page.navigate', { url: base + '/__qa/merch.html' });
      for (let i = 0; i < 50 && !(await chrome.evaluate('!!window.MerchPrint')); i++) await new Promise(r => setTimeout(r, 100));
      const r = await chrome.evaluate(`(async () => {
        const P = window.MerchPrint, T = 'pro_Vv1XdaPMSdm6jZ5pj24NCQ';
        const spec = { regionId: 'front_large', pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150 };
        // a synthetic light-grey "shirt" photo with soft shading and grain (no network)
        const ph = document.createElement('canvas'); ph.width = 720; ph.height = 960;
        const pg = ph.getContext('2d'); const gr = pg.createLinearGradient(0, 0, 720, 0);
        gr.addColorStop(0, '#b8b8b8'); gr.addColorStop(0.5, '#f0f0f0'); gr.addColorStop(1, '#b0b0b0');
        pg.fillStyle = gr; pg.fillRect(0, 0, 720, 960);
        const photo = ph.toDataURL('image/jpeg', 0.9);
        const concept = { palette: { a: '#111111', b: '#111111', ink: '#FFFFFF' }, stack: [{ text: 'GAME DAY', size: 'big', fill: 'a', ink: 'white' }], fit: { scale: 0.8, xIn: 1 } };
        const out = {};
        const run = async (W, realism) => { const cv = document.createElement('canvas'); cv.width = 720; const t0 = performance.now(); const res = await P.photoMock(concept, cv, { photo, templateId: T, photoIndex: 0, spec, garmentColor: '#FFFFFF', width: W, realism, logoSpot: 'none' }); return { cv, res, ms: performance.now() - t0 }; };
        await run(720, true);
        const big = await run(1600, true); out.bigW = big.cv.width; out.bigH = big.cv.height; out.bigRes = big.res.width; out.bigMs = Math.round(big.ms); out.bigShaded = big.res.realism;
        const small = await run(720, true); out.smallMs = Math.round(small.ms); out.smallW = small.cv.width;
        const huge = await run(5000, false); out.hugeW = huge.cv.width;
        // where the ink lands vs photoGeometry(designBox)
        const plain = await run(1600, false);
        const g = plain.cv.getContext('2d'); const W = plain.cv.width, H = plain.cv.height;
        const d = g.getImageData(0, 0, W, H).data;
        let x0 = W, y0 = H, x1 = 0, y1 = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (d[i] < 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
        const geo = P.photoGeometry(T, 0, W, H); const b = P.designBox(concept, spec);
        const [ex0, ey0] = geo.toCanvas(b.x, b.y); const [ex1, ey1] = geo.toCanvas(b.x + b.w, b.y + b.h);
        out.ink = [x0, y0, x1 + 1, y1 + 1]; out.expect = [ex0, ey0, ex1, ey1].map(v => Math.round(v * 10) / 10);
        // tote-cal: the tote's flat panel in perspective. Ink stays inside the projected
        // design box, never under the strap, and the realism pass runs on it.
        {
          const TO = 'pro_367', ts = { regionId: 'front', pixelsWidth: 1500, pixelsHeight: 1500, dpi: 150, logo: 'inside' };
          const tc = { palette: { a: '#111111', b: '#111111', ink: '#111111' }, stack: [{ text: 'TOTE DAY', size: 'big', fill: 'a', ink: 'ink' }, { text: 'EVERY DAY', size: 'big', fill: 'a', ink: 'ink' }], blanks: ['tote'] };
          const cv = document.createElement('canvas'); cv.width = 720;
          const res = await P.photoMock(tc, cv, { photo, kind: 'tote', templateId: TO, photoIndex: 0, spec: ts, garmentColor: '#F6EBCD', realism: false, logoSpot: 'inside' });
          const tW = cv.width, tH = cv.height; const td = cv.getContext('2d').getImageData(0, 0, tW, tH).data;
          const tg = P.photoGeometry(TO, 0, tW, tH); const tb = P.designBox(tc, ts);
          const corners = [[tb.x, tb.y], [tb.x + tb.w, tb.y], [tb.x + tb.w, tb.y + tb.h], [tb.x, tb.y + tb.h]].map(([x, y]) => tg.toCanvas(x, y));
          const cal = P.PHOTO_QUADS[TO][0];
          const deep = (x, y) => [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]].every(([dx, dy]) => cal.cover.some(poly => P.pointInPoly((x + dx) / tW, (y + dy) / tH, poly)));
          let inkN = 0, outside = 0, underStrap = 0;
          for (let y = 0; y < tH; y++) for (let x = 0; x < tW; x++) {
            const i = (y * tW + x) * 4; if (td[i] > 60) continue;
            inkN += 1;
            if (!P.pointInPoly(x + 0.5, y + 0.5, corners.map(([a, b], k) => [a + (k === 1 || k === 2 ? 3 : -3), b + (k >= 2 ? 3 : -3)]))) outside += 1;
            if (deep(x + 0.5, y + 0.5)) underStrap += 1;
          }
          out.tote = { drawn: res && res.drawn, inkN, outside, underStrap, w: tW };
          const big = document.createElement('canvas'); big.width = 720;
          const rb = await P.photoMock(tc, big, { photo, kind: 'tote', templateId: TO, photoIndex: 0, spec: ts, garmentColor: '#060606', realism: true, width: 1600, logoSpot: 'inside' });
          out.tote.bigShaded = rb.realism; out.tote.bigW = big.width;
          // the flat fallback draws a tote (and the merch7 tops) instead of throwing
          out.flat = [];
          for (const kind of ['tote', 'longsleeve', 'tank']) { try { const f = document.createElement('canvas'); f.width = 300; await P.preview(tc, '#F6EBCD', f, { kind, spec: ts, size: 300 }); out.flat.push(kind); } catch (e) { out.flat.push(kind + ': ' + e.message); } }
        }
        // the print PNG: byte-identical to the base engine for a fixed concept (explicit fit)
        if (window.MPBase) {
          const fixed = { id: 'fixed', palette: { a: '#0A7DFA', b: '#0B1F3A', ink: '#FFFFFF' }, stack: ['WE CENTER', 'FANS IN', 'EVERYTHING'].map((t, i) => ({ text: t, size: i ? 'mid' : 'big', fill: i % 2 ? 'b' : 'a', ink: 'white' })), elements: [{ type: 'icon', name: 'tennis', position: 'above', color: 'a' }], fit: { scale: 1, topIn: 1.75 } };
          const png = async lib => { const c = document.createElement('canvas'); await lib.render(fixed, { ...spec, garmentColor: '#FFFFFF' }, c, { scale: 0.5, blob: false, phone: false }); return c.toDataURL('image/png'); };
          const logo = async lib => { const c = document.createElement('canvas'); await lib.renderLogo({ pixelsWidth: 600, pixelsHeight: 300, dpi: 150, garmentColor: '#000000' }, c, { blob: false }); return c.toDataURL('image/png'); };
          const [a1, b1, a2, b2] = [await png(window.MPBase), await png(P), await logo(window.MPBase), await logo(P)];
          out.renderSame = a1 === b1; out.renderLen = a1.length; out.logoSame = a2 === b2;
        }
        return out;
      })()`);
      assert.equal(r.bigW, 1600, 'photoMock({ width: 1600 }) draws a 1600 px canvas');
      assert.equal(r.bigH, 2133);
      assert.equal(r.bigRes, 1600);
      assert.equal(r.bigShaded, true, 'realism ran at 1600');
      assert.equal(r.smallW, 720);
      assert.equal(r.hugeW, 2000, 'width is capped at 2000');
      r.ink.forEach((v, i) => assert.ok(Math.abs(v - r.expect[i]) <= 3, `ink ${r.ink} vs photoGeometry ${r.expect}`));
      console.log(`ok photoMock width 1600 (${r.bigMs} ms; 720 px ${r.smallMs} ms), ink matches photoGeometry`);
      assert.equal(r.tote.drawn, true, 'the tote photo is drawn on');
      assert.ok(r.tote.inkN > 2000, `tote ink pixels ${r.tote.inkN}`);
      assert.equal(r.tote.outside, 0, 'tote ink stays inside the projected design box (photoGeometry)');
      assert.equal(r.tote.underStrap, 0, 'no ink on the strap');
      assert.equal(r.tote.bigShaded, true); assert.equal(r.tote.bigW, 1600);
      assert.deepEqual(r.flat, ['tote', 'longsleeve', 'tank'], 'flat preview has a shape for every blank');
      console.log(`ok tote photoMock: ${r.tote.inkN} ink px inside the projected box, none on the strap; flat preview for tote / merch7 tops`);
      if (r.renderSame === undefined) console.log('skip print PNG comparison (no base ref)');
      else { assert.equal(r.renderSame, true, 'render() PNG changed vs the base'); assert.ok(r.renderLen > 1000); assert.equal(r.logoSame, true, 'renderLogo() PNG changed'); console.log('ok render() / renderLogo() PNGs byte-identical to the base engine'); }
    } finally { chrome.close(); server.close(); }
  }
}
