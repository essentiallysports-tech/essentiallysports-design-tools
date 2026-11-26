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
  assert.deepEqual(P.fitOf({ fit: { scale: 9, topIn: -3 } }), { scale: 1.6, topIn: 0.5 });
  assert.deepEqual(P.fitOf({}), { scale: 1, topIn: null });
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
