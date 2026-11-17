#!/usr/bin/env node
// Free "plain backdrop" cut-out maths (runs on raw RGBA, no browser needed).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Cutout = require('../frameup-cutout.js');

function image(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return data;
}

// A grey studio backdrop with a dark subject in the middle.
const W = 120;
const H = 150;
const studio = image(W, H, (x, y) => {
  const inSubject = Math.hypot(x - 60, y - 60) < 30 || (x > 30 && x < 90 && y > 85);
  if (inSubject) return [40, 30, 90];
  const noise = (x * 7 + y * 13) % 9; // a little sensor noise
  return [228 + noise, 230 + noise, 233 + noise];
});
const stats = Cutout.edgeStats(studio, W, H);
assert.ok(stats.uniformity > 0.8, 'plain backdrop edges match (the subject touches the bottom edge)');
const mask = Cutout.plainBackdropMask(studio, W, H);
assert.equal(mask.ok, true);
assert.equal(mask.alpha[0], 0, 'corner removed');
assert.equal(mask.alpha[60 * W + 60], 255, 'subject kept');
assert.equal(mask.alpha[140 * W + 60], 255, 'subject touching the bottom edge kept');
assert.ok(mask.removed > 0.3 && mask.removed < 0.9);

// Busy backdrop (a stadium-like gradient with stripes): refused, not guessed.
const busy = image(W, H, (x, y) => (x % 10 < 5 ? [20 + y, 120, 40] : [200, 60 + x, 30]));
const refused = Cutout.plainBackdropMask(busy, W, H);
assert.equal(refused.ok, false);
assert.equal(refused.reason, 'busy');

// All one colour: nothing to cut out, so refused.
const flat = image(40, 40, () => [250, 250, 250]);
assert.equal(Cutout.plainBackdropMask(flat, 40, 40).reason, 'everything');

// An enclosed area of backdrop colour inside the subject is kept (fill starts at the edges).
const ring = image(60, 60, (x, y) => {
  const d = Math.hypot(x - 30, y - 30);
  return d < 20 && d > 10 ? [30, 30, 30] : [240, 240, 240];
});
const ringMask = Cutout.plainBackdropMask(ring, 60, 60);
assert.equal(ringMask.ok, true);
assert.equal(ringMask.alpha[30 * 60 + 30], 255, 'hole inside the subject is not punched out');

// Upload sizing.
assert.deepEqual(Cutout.scaledSize(4000, 3000, 2048), { width: 2048, height: 1536 });
assert.deepEqual(Cutout.scaledSize(800, 600, 2048), { width: 800, height: 600 }, 'never upscales');
assert.equal(Cutout.base64Bytes('data:image/png;base64,AAAA'), 3);
assert.ok(Cutout.MAX_SEND_BASE64 < 4.5 * 1024 * 1024, 'stays under the Vercel body limit');

// ─── Model mask on the original photo ───────────────────────────────────
// Pad plan: fitted, never cropped, centred, one of the model's sizes.
assert.deepEqual(Cutout.padPlan(1000, 1500), { size: '1024x1536', width: 1024, height: 1536, region: { x: 0, y: 0, w: 1024, h: 1536 } });
const tall = Cutout.padPlan(900, 1600); // 9:16 into 2:3: grey bars left and right
assert.equal(tall.size, '1024x1536');
assert.equal(tall.region.h, 1536);
assert.equal(tall.region.w, 864);
assert.equal(tall.region.x, 80);
assert.equal(Cutout.padPlan(1600, 900).size, '1536x1024');
assert.equal(Cutout.padPlan(1000, 1000).size, '1024x1024');

// A synthetic photo: green-ish backdrop, a red-ish "player" rectangle.
const PW = 80;
const PH = 100;
const subject = (x, y) => x >= 20 && x < 60 && y >= 15 && y < 95;
const photo = image(PW, PH, (x, y) => (subject(x, y) ? [200, 40 + (x % 7), 50] : [30, 140 + (y % 5), 60]));
// What a faithful model returns: roughly the same pixels (slightly redrawn),
// alpha 255 on the subject and 0 elsewhere.
function modelOutput({ shift = 0, alphaFn = (x, y) => (subject(x - shift, y) ? 255 : 0) } = {}) {
  const out = new Uint8ClampedArray(PW * PH * 4);
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      const i = (y * PW + x) * 4;
      const sx = Math.min(PW - 1, Math.max(0, x - shift));
      const j = (y * PW + sx) * 4;
      out[i] = photo[j] + 6; out[i + 1] = photo[j + 1] - 4; out[i + 2] = photo[j + 2] + 3;
      out[i + 3] = alphaFn(x, y);
    }
  }
  return out;
}

const good = modelOutput();
const alpha = Cutout.maskFromModel(good, PW, PH);
assert.equal(alpha[50 * PW + 40], 255, 'inside the subject stays opaque');
assert.equal(alpha[5 * PW + 5], 0, 'backdrop stays clear');
const edge = alpha[50 * PW + 20];
assert.ok(edge > 0 && edge < 255, `edge is softened (${edge})`);
const verdict = Cutout.checkMask({ alpha, modelRgba: good, originalRgba: photo, width: PW, height: PH, spill: 0 });
assert.equal(verdict.ok, true, JSON.stringify(verdict));
assert.ok(verdict.colorDiff < 10);
assert.ok(Math.abs(verdict.coverage - 0.4) < 0.03);

// Compositing keeps the ORIGINAL pixels: only alpha comes from the model.
const cut = Cutout.applyMask(photo, alpha);
const centre = (50 * PW + 40) * 4;
assert.deepEqual([cut[centre], cut[centre + 1], cut[centre + 2], cut[centre + 3]], [photo[centre], photo[centre + 1], photo[centre + 2], 255]);
assert.notEqual(cut[centre], good[centre], 'the model’s redrawn colour is not used');
assert.equal(cut[(5 * PW + 5) * 4 + 3], 0);
assert.equal(photo[(5 * PW + 5) * 4 + 3], 255, 'the original array is not modified');

// Rejections.
const empty = Cutout.maskFromModel(modelOutput({ alphaFn: () => 0 }), PW, PH);
assert.equal(Cutout.checkMask({ alpha: empty, modelRgba: good, originalRgba: photo, width: PW, height: PH }).reason, 'empty');
const full = Cutout.maskFromModel(modelOutput({ alphaFn: () => 255 }), PW, PH);
assert.equal(Cutout.checkMask({ alpha: full, modelRgba: good, originalRgba: photo, width: PW, height: PH }).reason, 'full');
assert.equal(Cutout.checkMask({ alpha, modelRgba: good, originalRgba: photo, width: PW, height: PH, spill: 0.2 }).reason, 'misaligned');
// The model moved the subject 15 px: its mask and pixels no longer match the photo.
const moved = modelOutput({ shift: 15 });
const movedVerdict = Cutout.checkMask({ alpha: Cutout.maskFromModel(moved, PW, PH), modelRgba: moved, originalRgba: photo, width: PW, height: PH });
assert.equal(movedVerdict.ok, false, 'a shifted subject is rejected');
assert.equal(movedVerdict.reason, 'redrawn');
// The model repainted the subject (here: a different shirt colour).
const repainted = modelOutput();
for (let p = 0; p < PW * PH; p++) { repainted[p * 4] = 40; repainted[p * 4 + 1] = 60; repainted[p * 4 + 2] = 210; }
assert.equal(Cutout.checkMask({ alpha, modelRgba: repainted, originalRgba: photo, width: PW, height: PH }).reason, 'redrawn');

// Spill: opaque pixels in the grey padding around the photo.
const plan = { x: 10, y: 0, w: 60, h: 100 };
const spillImg = new Uint8ClampedArray(PW * PH * 4);
for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) spillImg[(y * PW + x) * 4 + 3] = x < 10 ? 255 : 0;
assert.ok(Math.abs(Cutout.paddingSpill(spillImg, PW, PH, plan) - 0.5) < 0.05, 'left bar painted = half the padding');
assert.deepEqual(Cutout.maskBox(alpha, PW, PH), { x: 20, y: 15, w: 40, h: 80 });

console.log('cutout tests passed.');
