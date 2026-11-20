// Generate photo framing: the subject (box + head from the vision check) is
// framed in every photo slot, not the box's top-left corner; photos without a
// box aim at the upper third; a swapped photo brings its own framing; the
// vision check's box / head are validated; cut-outs keep the head on the canvas.
// Pure Node: no Chrome, no network, no AI.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../frameup-compose.js');
const V = require('../netlify/functions/_photo-verify.js');
const { coverRect, framingOf, focusOf, framedOnCanvas, planHeadroom } = C._framing;

const inside = (crop, iw, ih, box) => box.x * iw >= crop.sx - 0.5 && (box.x + box.w) * iw <= crop.sx + crop.sw + 0.5
  && box.y * ih >= crop.sy - 0.5 && (box.y + box.h) * ih <= crop.sy + crop.sh + 0.5;
const headIn = (crop, iw, ih, head) => head.x * iw >= crop.sx && head.x * iw <= crop.sx + crop.sw && head.y * ih >= crop.sy && head.y * ih <= crop.sy + crop.sh;
const coversImage = (crop, iw, ih) => crop.sx >= -0.01 && crop.sy >= -0.01 && crop.sx + crop.sw <= iw + 0.01 && crop.sy + crop.sh <= ih + 0.01;

// ── 1. A point keeps today's behaviour (centred, clamped) ───────────────────
{
  const r = coverRect(1000, 1000, 500, 1000, { x: 0.5, y: 0.5 });
  assert.equal(r.sx, 250, 'a point centres the crop');
  const edge = coverRect(1000, 1000, 500, 1000, { x: 0.95, y: 0.5 });
  assert.equal(edge.sx, 500, 'clamped so the photo still covers the slot');
  assert.deepEqual(framingOf({ x: 0.4, y: 0.3 }), { head: { x: 0.4, y: 0.3 }, box: null });
}

// ── 2. A box is a subject, not a point: never centred on its corner ─────────
{
  // Landscape photo, person on the right (box top-left at 0.7, 0.1), into a 9:16 story slot.
  const box = { x: 0.7, y: 0.1, w: 0.25, h: 0.85 };
  const crop = coverRect(1200, 800, 1080, 1920, box);
  assert.ok(coversImage(crop, 1200, 800));
  assert.ok(inside(crop, 1200, 800, box), `the whole subject is in the 9:16 crop (${JSON.stringify(crop)})`);
  // The old reading (box corner as the centre) cut the subject: guard the regression.
  const asCorner = coverRect(1200, 800, 1080, 1920, { x: 0.7, y: 0.1 });
  assert.ok(!inside(asCorner, 1200, 800, box), 'the corner-as-point crop is what used to cut the person');
  // A box at the very left edge of the photo.
  const left = { x: 0, y: 0.05, w: 0.18, h: 0.9 };
  const c2 = coverRect(1600, 900, 1080, 1920, left);
  assert.ok(inside(c2, 1600, 900, left) && coversImage(c2, 1600, 900), 'a box at the left edge stays inside');
  // Head estimate: centred across the box, near its top.
  const f = framingOf(box);
  assert.ok(Math.abs(f.head.x - 0.825) < 1e-9 && f.head.y > 0.1 && f.head.y < 0.3, 'head estimated at the box top');
  // An explicit head point wins.
  assert.deepEqual(framingOf({ ...box, hx: 0.8, hy: 0.2 }).head, { x: 0.8, y: 0.2 });
}

// ── 3. Zoomed slots (duotone-hero 1.7, name-stack 1.25, fieldPhoto 1.12) ────
for (const zoom of [1.12, 1.25, 1.7]) {
  const box = { x: 0.55, y: 0.15, w: 0.3, h: 0.6, hx: 0.7, hy: 0.25 };
  const crop = coverRect(1500, 1000, 1080, 1350, box, zoom);
  assert.ok(coversImage(crop, 1500, 1000), `zoom ${zoom}: covers`);
  const fits = box.w * 1500 <= crop.sw && box.h * 1000 <= crop.sh;
  if (fits) assert.ok(inside(crop, 1500, 1000, box), `zoom ${zoom}: the subject fits, so all of it shows`);
  assert.ok(headIn(crop, 1500, 1000, { x: 0.7, y: 0.25 }), `zoom ${zoom}: the head is in`);
}
// A subject bigger than the crop: the head (top) part stays in, with headroom.
{
  const box = { x: 0.1, y: 0.05, w: 0.8, h: 0.95, hx: 0.5, hy: 0.15 };
  const crop = coverRect(900, 1200, 1080, 660, box, 1.25);
  assert.ok(headIn(crop, 900, 1200, { x: 0.5, y: 0.15 }), 'tall subject in a wide zoomed slot: the head is in');
  const at = (0.15 * 1200 - crop.sy) / crop.sh;
  assert.ok(at > 0.08 && at < 0.5, `the head sits in the upper half (${at.toFixed(2)})`);
}

// ── 4. No framing: upper third, top area for wide slots from tall photos ────
{
  const square = coverRect(900, 1200, 1080, 1080, undefined);
  assert.equal(square.sy, 0, 'a portrait photo in a square slot starts at the top');
  const wide = coverRect(900, 1200, 1080, 660, {});
  assert.ok(wide.sy <= 1200 * 0.08 + 0.01, `a wide slot from a tall photo keeps the top (${wide.sy})`);
  const old = Math.max(0, Math.min(1200 - wide.sh, 1200 * 0.35 - wide.sh / 2));
  assert.ok(wide.sy < old, 'higher than the old (0.5, 0.35) default');
}

// ── 5. focusOf: the composer's { focus, focal, box } become one focus ───────
{
  assert.deepEqual(focusOf({ focus: { x: 0.2, y: 0.1, w: 0.5, h: 0.8 }, focal: { x: 0.45, y: 0.2 } }), { x: 0.2, y: 0.1, w: 0.5, h: 0.8, hx: 0.45, hy: 0.2 });
  assert.deepEqual(focusOf({ focal: { x: 0.4, y: 0.25 } }), { x: 0.4, y: 0.25 }, 'a head point alone');
  assert.deepEqual(focusOf({ box: { x: 0.1, y: 0.1, w: 0.3, h: 0.6 } }), { x: 0.1, y: 0.1, w: 0.3, h: 0.6 });
  assert.equal(focusOf({ src: '/a.jpg' }), undefined);
  // normalizeInput folds the head into every photo's focus (hero, extras, headshots, split sides).
  const n = C.normalizeInput({
    photos: [{ url: '/a.jpg', focus: { x: 0.6, y: 0.1, w: 0.3, h: 0.8 }, focal: { x: 0.75, y: 0.2 } }, { url: '/b.jpg', focal: { x: 0.3, y: 0.3 } }],
    headshots: [{ url: '/h.jpg', person: 'A', focal: { x: 0.5, y: 0.2 } }],
    sides: [{ title: 'X', photo: { src: '/s.jpg', focus: { x: 0.1, y: 0.1, w: 0.2, h: 0.5 }, focal: { x: 0.2, y: 0.2 } } }],
  });
  assert.deepEqual(n.photo.focus, { x: 0.6, y: 0.1, w: 0.3, h: 0.8, hx: 0.75, hy: 0.2 });
  assert.deepEqual(n.photos[0].focus, { x: 0.3, y: 0.3 });
  assert.deepEqual(n.headshots[0].focus, { x: 0.5, y: 0.2 });
  assert.deepEqual(n.sides[0].photo.focus, { x: 0.1, y: 0.1, w: 0.2, h: 0.5, hx: 0.2, hy: 0.2 });
}

// ── 6. Every photo layer of a built design carries the subject's framing ────
{
  const input = {
    size: 'story', sport: 'NFL', headline: 'Josh Allen runs wild', kicker: 'NFL', name: 'Josh Allen',
    palette: C.makePalette(['#00338D', '#C60C30']),
    photo: { src: '/p/allen.jpg', focus: { x: 0.7, y: 0.1, w: 0.25, h: 0.85 }, focal: { x: 0.82, y: 0.2 } },
  };
  const scene = C.build('magazine-cover', input, 0);
  const layer = scene.layers.find(l => l.type === 'photo' && l.src === '/p/allen.jpg');
  assert.deepEqual(layer.focus, { x: 0.7, y: 0.1, w: 0.25, h: 0.85, hx: 0.82, hy: 0.2 });
  // Where it lands on the canvas: head and box inside the slot.
  const slot = { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
  const crop = coverRect(1200, 800, slot.w, slot.h, layer.focus, layer.zoom || 1);
  const at = framedOnCanvas(1200, 800, slot, crop, layer.focus);
  assert.ok(at.head.x >= slot.x && at.head.x <= slot.x + slot.w && at.head.y >= slot.y && at.head.y <= slot.y + slot.h, 'head on the canvas');
  assert.ok(at.fits && at.box.x >= slot.x - 1 && at.box.x + at.box.w <= slot.x + slot.w + 1, 'the subject box is inside the slot');
  // Mirrored layers map the head mirrored.
  const flipped = framedOnCanvas(1200, 800, slot, crop, layer.focus, true);
  assert.ok(Math.abs((flipped.head.x - slot.x) - (slot.x + slot.w - at.head.x)) < 0.2, 'flip mirrors the head');
}

// ── 7. swapPhoto: the new photo's framing replaces the old one ──────────────
{
  const input = {
    size: 'portrait', sport: 'NFL', headline: 'Josh Allen runs wild', kicker: 'NFL', name: 'Josh Allen',
    palette: C.makePalette(['#00338D', '#C60C30']),
    photo: { src: '/p/old.jpg', focus: { x: 0.1, y: 0.1, w: 0.3, h: 0.8 } },
  };
  const scene = C.build('magazine-cover', input, 0);
  const swapped = C.swapPhoto(scene, { from: '/p/old.jpg', to: '/p/new.jpg', photo: { src: '/p/new.jpg', focus: { x: 0.6, y: 0.05, w: 0.3, h: 0.9 }, focal: { x: 0.74, y: 0.15 } } });
  const l = swapped.layers.find(x => x.src === '/p/new.jpg');
  assert.deepEqual(l.focus, { x: 0.6, y: 0.05, w: 0.3, h: 0.9, hx: 0.74, hy: 0.15 }, 'takes the new photo framing');
  const bare = C.swapPhoto(scene, { from: '/p/old.jpg', to: '/p/plain.jpg' });
  assert.equal(bare.layers.find(x => x.src === '/p/plain.jpg').focus, undefined, 'never keeps the old photo framing');
  const pointOnly = C.swapPhoto(scene, { from: '/p/old.jpg', to: '/p/pt.jpg', focus: { x: 0.3, y: 0.2 } });
  assert.deepEqual(pointOnly.layers.find(x => x.src === '/p/pt.jpg').focus, { x: 0.3, y: 0.2 });
}

// ── 8. The vision check's box and head are validated ────────────────────────
{
  const { normalizeRow, boxOf, headOf } = V._test;
  assert.deepEqual(boxOf([0.3, 0.1, 0.4, 0.8]), { x: 0.3, y: 0.1, w: 0.4, h: 0.8 });
  assert.deepEqual(boxOf([0.5, 0.2, 0.9, 0.95]), { x: 0.5, y: 0.2, w: 0.4, h: 0.75 }, 'corner form [x0, y0, x1, y1] is converted');
  assert.deepEqual(boxOf([0.6, 0.3, 0.41, 0.7]), { x: 0.6, y: 0.3, w: 0.4, h: 0.7 }, 'a hair over the edge is trimmed');
  assert.equal(boxOf([0.2, 0.1, 0, 0.5]), null, 'zero width');
  assert.equal(boxOf([0.2, 0.1, -0.3, 0.5]), null, 'negative width');
  assert.equal(boxOf([1.4, 0.1, 0.3, 0.5]), null, 'outside 0-1');
  assert.equal(boxOf([0.3, 0.1, 0.4]), null, 'three numbers');
  assert.equal(boxOf(['a', 0.1, 0.4, 0.5]), null, 'not numbers');
  assert.equal(boxOf([0.8, 0.7, 0.5, 0.2]), null, 'off the frame and not corners either');
  assert.deepEqual(headOf([0.5, 0.2], { x: 0.3, y: 0.1, w: 0.4, h: 0.8 }), { x: 0.5, y: 0.2 });
  assert.equal(headOf([0.95, 0.2], { x: 0.3, y: 0.1, w: 0.4, h: 0.8 }), null, 'a head far outside its box is dropped');
  assert.equal(headOf([1.2, 0.2], null), null, 'outside the frame');
  assert.equal(headOf(null, null), null);
  const row = normalizeRow({ n: 1, match: 'yes', box: [0.3, 0.1, 0.4, 0.8], head: [0.5, 0.2], cutout: true });
  assert.deepEqual(row.focus, { x: 0.3, y: 0.1, w: 0.4, h: 0.8 });
  assert.deepEqual(row.head, { x: 0.5, y: 0.2 });
  const old = normalizeRow({ n: 1, match: 'yes', box: [0.3, 0.1, 0.4, 0.8] });
  assert.equal(old.head, null, 'a reply without a head still works');
  // decide() carries the head through.
  const subject = { name: 'Josh Allen', kind: 'person', team: 'Buffalo Bills' };
  const photo = { source: 'es-media', sourceUrl: 'https://image-cdn.essentiallysports.com/x/Untitled.jpg', title: '', caption: 'Credits: IMAGO' };
  const d = V.decide(photo, subject, V.evidence(photo, subject), { ...row, evidence: 'Bills #17', people: 1, main: true, role: 'player', kind: 'action', quality: 4, graphic: false }, {});
  assert.deepEqual(d.head, { x: 0.5, y: 0.2 });
  // The prompt asks for the head as a position, and still never to identify a face.
  const prompt = V.verifyPrompt(subject, [{}]);
  assert.match(prompt, /"head": \[x, y\]/);
  assert.match(prompt, /Do not identify anyone from their face/);
  assert.match(prompt, /never used to tell who it is/);
}

// ── 9. Cut-outs: the head stays on the canvas, side moves are capped ────────
{
  const scene = { size: { w: 1080, h: 1350 }, layers: [{ type: 'background' }, { type: 'cutout', src: '/c.png' }] };
  // A head that pokes past the right edge, nothing else on the design.
  const report = { items: [], cutouts: [{ x: 500, y: 300, w: 640, h: 1050, head: { x: 980, y: 320, w: 160, h: 180 }, at: 0, layer: 1 }] };
  const moved = planHeadroom(scene, report);
  assert.ok(moved, 'a head off the edge is moved');
  const m = moved.layers[1]._move;
  assert.ok(980 + m.x >= 0 && 980 + m.x + 160 <= 1080, `the head is back on the canvas (${JSON.stringify(m)})`);
  assert.ok(Math.abs(m.x) <= 640 * 0.25 + 1, 'side move capped at a quarter of the figure');
  // A figure already fine is left alone.
  assert.equal(planHeadroom(scene, { items: [], cutouts: [{ x: 200, y: 300, w: 640, h: 1050, head: { x: 440, y: 320, w: 160, h: 180 }, at: 0, layer: 1 }] }), null);
  // Less than 85% of the figure on the canvas is not a fit (moves it in).
  const half = planHeadroom(scene, { items: [], cutouts: [{ x: 560, y: 300, w: 640, h: 1050, head: { x: 760, y: 320, w: 160, h: 180 }, at: 0, layer: 1 }] });
  assert.ok(half && half.layers[1]._move.x < 0, 'a figure 80% on the canvas moves in');
}

console.log('compose framing: box framing, zoom, defaults, focus plumbing, swap, vision box/head, cut-out headroom - ok');
