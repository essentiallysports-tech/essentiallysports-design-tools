// Merch Designs: on-canvas move/resize (merch-canvas.js), pure geometry.
// Mapping round-trips (close-up + calibrated photos), clamping inside the print
// area, corner resize keeps the opposite corner, centre snap, and the photo map
// agreeing with MerchPrint's own print-area box.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../merch-print.js');
globalThis.MerchPrint = P;
const C = require('../merch-canvas.js');
let n = 0; const ok = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} vs ${b} (±${eps})`);
const TEE = { pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150, kind: 'tee', region: 'front' };
const concept = { id: 'c1', stack: [{ text: 'LAKE SHOW', size: 'big', fill: 'a', ink: 'ink' }, { text: 'FOREVER', size: 'mid', fill: 'b', ink: 'ink' }], palette: { a: '#552583', b: '#FDB927', ink: '#FFFFFF' }, align: 'left', blanks: ['tee'] };
const TEE_ID = P.TEMPLATE_KIND.tee;

ok('linear map round-trips inches <-> canvas', () => {
  const map = { kind: 'linear', ox: 37.5, oy: -12, k: 41.3, inW: 15, inH: 18 };
  for (const p of [{ x: 0, y: 0 }, { x: 7.5, y: 9 }, { x: 15, y: 18 }, { x: 3.21, y: 11.7 }]) {
    const q = C.canvasToInches(C.inchesToCanvas(p, map), map);
    near(q.x, p.x, 1e-9); near(q.y, p.y, 1e-9);
  }
});

ok('every calibrated photo round-trips across the print area', () => {
  let maps = 0;
  for (const [tid, set] of Object.entries(P.PHOTO_AREAS)) {
    for (const cal of Object.values(set)) {
      const map = { kind: 'photo', cal, W: 720, H: 960, inW: 15, inH: 18 };
      for (let x = 0; x <= 15; x += 1.5) for (const y of [0, 4.5, 18]) {
        const q = C.canvasToInches(C.inchesToCanvas({ x, y }, map), map);
        near(q.x, x, 1e-6, `${tid} x`); near(q.y, y, 1e-6, `${tid} y`);
      }
      maps += 1;
    }
  }
  assert.ok(maps >= 10, `checked ${maps} photos`);
});

ok('photo map matches MerchPrint.photoRect (where photoMock draws the area)', () => {
  const cal = P.photoCal(TEE_ID, { photoIndex: 0 });
  const map = { kind: 'photo', cal, W: 720, H: 960, inW: 15, inH: 18 };
  const r = C.rectToCanvas({ x: 0, y: 0, w: 15, h: 18 }, map);
  const pr = P.photoRect(cal, 15, 18);
  near(r.x, pr.x * 720, 0.01, 'left'); near(r.w, pr.w * 720, 0.01, 'width');
  near(r.y, pr.y * 960, 0.01, 'top'); near(r.h, cal.ppi * 720 * 18, 0.01, 'height');
});

ok('close-up map from the engine puts the design box where closeup() draws it', () => {
  const view = { view: 'closeup', spec: TEE, pad: 0.14 };
  const map = C._mapFor(view, concept, { width: 720, height: 840 });
  const m = C._measure(concept, { ...P.DEFAULT_AREAS.tee, ...TEE });
  const r = C.rectToCanvas(m.box, map);
  // closeup() centres the design and fits it inside the 14% pad.
  near(r.x + r.w / 2, 360, 0.5, 'centre x'); near(r.y + r.h / 2, 420, 0.5, 'centre y');
  assert.ok(Math.abs(r.w - 720 * 0.72) < 0.5 || Math.abs(r.h - 840 * 0.72) < 0.5, 'fills the padded canvas on one side');
});

ok('no map on an uncalibrated photo or a back photo for a front print', () => {
  assert.equal(C._mapFor({ view: 'tee', templateId: TEE_ID, photoIndex: 2, spec: TEE, calibrated: false }, concept, { width: 720, height: 960 }), null);
  assert.equal(C._mapFor({ view: 'tee', templateId: TEE_ID, photoIndex: 2, spec: TEE, calibrated: true }, concept, { width: 720, height: 960 }), null, 'photo 2 has no calibration');
  assert.equal(C._mapFor({ view: 'tee', templateId: TEE_ID, photoIndex: 3, spec: TEE, calibrated: true }, concept, { width: 720, height: 960 }), null, 'back photo, front print');
  assert.ok(C._mapFor({ view: 'tee', templateId: TEE_ID, photoIndex: 0, spec: TEE, calibrated: true }, concept, { width: 720, height: 960 }));
});

ok('clampFit keeps the design inside the area and the engine limits', () => {
  const area = { inW: 15, inH: 18 };
  const design = { w: 10, h: 4 };
  let f = C.clampFit({ scale: 3, topIn: -2, xIn: 9 }, { design, area });
  assert.equal(f.scale, 1.6); assert.equal(f.topIn, 0.5); assert.equal(f.xIn, 2.5);
  f = C.clampFit({ scale: 0.1, topIn: 30, xIn: -9 }, { design, area });
  assert.equal(f.scale, 0.6); assert.equal(f.topIn, 10); assert.equal(f.xIn, -2.5);
  f = C.clampFit({ scale: 1, topIn: 16, xIn: 0 }, { design: { w: 4, h: 4 }, area });
  assert.equal(f.topIn, 10, 'topMaxIn wins');
  f = C.clampFit({ scale: 1, topIn: 9, xIn: 0 }, { design: { w: 4, h: 12 }, area });
  assert.equal(f.topIn, 6, 'bottom edge stays inside: 18 - 12');
  f = C.clampFit({ scale: 1, topIn: 9, xIn: 0 }, { design: { w: 4, h: 12 }, area, topOffsetIn: 1 });
  assert.equal(f.topIn, 5, 'design top sits 1 in under topIn');
  f = C.clampFit({ scale: 1, topIn: null, xIn: 3 }, { design, area, allowX: false });
  assert.equal(f.topIn, null); assert.equal(f.xIn, 0);
  f = C.clampFit({ scale: 1, topIn: 2, xIn: 1 }, { design: { w: 16, h: 2 }, area });
  assert.equal(f.xIn, 0, 'wider than the area: centred');
});

ok('corner resize keeps the opposite corner where it was', () => {
  const start = { x: 2.5, y: 3, w: 10, h: 4 };
  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    const opp = { x: corner.includes('e') ? start.x : start.x + start.w, y: corner.includes('s') ? start.y : start.y + start.h };
    const dragged = { x: corner.includes('e') ? start.x + start.w : start.x, y: corner.includes('s') ? start.y + start.h : start.y };
    const grow = { x: dragged.x + (corner.includes('e') ? 1 : -1), y: dragged.y + (corner.includes('s') ? 0.4 : -0.4) };
    const r = C.resizeFromCorner({ start, corner, pointer: grow, startScale: 1 });
    near(r.ratio, 1.1, 1e-9, corner);
    near(r.scale, 1.1, 1e-9);
    const keep = { x: corner.includes('e') ? r.box.x : r.box.x + r.box.w, y: corner.includes('s') ? r.box.y : r.box.y + r.box.h };
    near(keep.x, opp.x, 1e-9, `${corner} anchor x`); near(keep.y, opp.y, 1e-9, `${corner} anchor y`);
    near(r.box.w / r.box.h, start.w / start.h, 1e-9, 'proportional');
    // placeAtAnchor with a measured (slightly different) size keeps the anchor too.
    const p = C.placeAtAnchor({ w: 10.7, h: 4.5 }, { anchor: r.anchor, corner });
    const keep2 = { x: corner.includes('e') ? p.x : p.x + p.w, y: corner.includes('s') ? p.y : p.y + p.h };
    near(keep2.x, opp.x, 1e-9); near(keep2.y, opp.y, 1e-9);
  }
});

ok('corner resize: shrink, limits, off-diagonal pointers and from the centre', () => {
  const start = { x: 2.5, y: 3, w: 10, h: 4 };
  let r = C.resizeFromCorner({ start, corner: 'se', pointer: { x: 10, y: 6 }, startScale: 1 });
  near(r.ratio, 0.75, 0.001, 'shrinks');
  r = C.resizeFromCorner({ start, corner: 'se', pointer: { x: 40, y: 30 }, startScale: 1.2 });
  near(r.scale, 1.6, 1e-9, 'max'); near(r.ratio, 1.6 / 1.2, 1e-9);
  r = C.resizeFromCorner({ start, corner: 'se', pointer: { x: 0, y: 0 }, startScale: 1 });
  near(r.scale, 0.6, 1e-9, 'min (pointer past the anchor)');
  r = C.resizeFromCorner({ start, corner: 'se', pointer: { x: 13.5, y: 3 }, startScale: 1 }); // dragged right along the top edge
  assert.ok(r.ratio > 0.9 && r.ratio < 1.1, `projection on the diagonal: ${r.ratio}`);
  r = C.resizeFromCorner({ start, corner: 'nw', pointer: { x: 1.5, y: 2.6 }, startScale: 1, fromCentre: true });
  near(r.box.x + r.box.w / 2, 7.5, 1e-9, 'centre x stays'); near(r.box.y + r.box.h / 2, 5, 1e-9, 'centre y stays');
  near(r.ratio, 1.2, 1e-9);
  // centreX: the centre line and the opposite edge (top, for se) hold; the handle tracks the pointer.
  r = C.resizeFromCorner({ start, corner: 'se', pointer: { x: 7.5 + 5 * 1.1, y: 3 + 4 * 1.1 }, startScale: 1, centreX: true });
  near(r.ratio, 1.1, 1e-9, 'centreX ratio');
  near(r.box.x + r.box.w / 2, 7.5, 1e-9, 'centre line'); near(r.box.y, 3, 1e-9, 'top edge');
});

ok('centre snap: Shift forces it, near the line snaps, away stays', () => {
  assert.deepEqual(C.snapX(2.4, { force: true }), { xIn: 0, snapped: true });
  assert.deepEqual(C.snapX(0.08, { thresholdIn: 0.1 }), { xIn: 0, snapped: true });
  assert.deepEqual(C.snapX(-0.3, { thresholdIn: 0.1 }), { xIn: -0.3, snapped: false });
});

ok('px per inch: close-up is linear; on a photo the centre is widest (it wraps round the body)', () => {
  assert.equal(C.pxPerInch({ kind: 'linear', k: 30 }), 30);
  const cal = P.photoCal(TEE_ID, { photoIndex: 0 });
  const map = { kind: 'photo', cal, W: 720, H: 960, inW: 15, inH: 18 };
  const mid = C.pxPerInch(map, 7.5);
  near(mid, 17, 0.2, '17 px/in at the chest on the 720 px photo');
  assert.ok(C.pxPerInch(map, 0.5) < mid && C.pxPerInch(map, 14.5) < mid);
});

console.log(`\n${n} merch-canvas checks passed`);
