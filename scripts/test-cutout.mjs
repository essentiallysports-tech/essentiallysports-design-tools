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

console.log('cutout tests passed.');
