#!/usr/bin/env node
// Size packs: the tiny ZIP writer (checked byte by byte and with the system
// `unzip` when it's installed) and the size-pack layout maths.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Zip = require('../frameup-zip.js');
const Pack = require('../frameup-size-pack.js');

// ─── ZIP writer ──────────────────────────────────────────────────────────
assert.equal(Zip.crc32(new TextEncoder().encode('123456789')), 0xCBF43926, 'standard CRC-32 check value');
assert.equal(Zip.crc32(new Uint8Array(0)), 0);
assert.equal(Zip.cleanName('../../etc/passwd'), 'etc/passwd');
assert.equal(Zip.cleanName('/abs\\win\\name.jpeg'), 'abs/win/name.jpeg');
assert.equal(Zip.cleanName(''), 'file');
const stamp = Zip.dosDateTime(new Date(2026, 10, 18, 13, 45, 31));
assert.equal(stamp.date, ((2026 - 1980) << 9) | (11 << 5) | 18);
assert.equal(stamp.time, (13 << 11) | (45 << 5) | 15);
assert.throws(() => Zip.zip([]), /Nothing to zip/);

const a = new TextEncoder().encode('hello size pack');
const b = new Uint8Array(1000).map((_, i) => i % 251);
const bytes = Zip.zip([
  { name: 'feed.jpeg', data: a, date: new Date(2026, 0, 2) },
  { name: 'feed.jpeg', data: b },
  { name: 'café.png', data: new Uint8Array(0) },
]);
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
assert.equal(view.getUint32(0, true), 0x04034B50, 'starts with a local header');
const eocd = bytes.length - 22;
assert.equal(view.getUint32(eocd, true), 0x06054B50, 'ends with the end record');
assert.equal(view.getUint16(eocd + 10, true), 3, 'three entries');
const centralStart = view.getUint32(eocd + 16, true);
assert.equal(view.getUint32(centralStart, true), 0x02014B50);
// Walk the central directory: names, sizes, CRCs, offsets all line up.
let at = centralStart;
const names = [];
for (let i = 0; i < 3; i++) {
  const nameLength = view.getUint16(at + 28, true);
  const name = new TextDecoder().decode(bytes.slice(at + 46, at + 46 + nameLength));
  const size = view.getUint32(at + 24, true);
  const crc = view.getUint32(at + 16, true);
  const offset = view.getUint32(at + 42, true);
  assert.equal(view.getUint32(offset, true), 0x04034B50, `${name}: offset points at a local header`);
  const localNameLength = view.getUint16(offset + 26, true);
  const data = bytes.slice(offset + 30 + localNameLength, offset + 30 + localNameLength + size);
  assert.equal(Zip.crc32(data), crc, `${name}: CRC matches`);
  names.push(name);
  at += 46 + nameLength;
}
assert.deepEqual(names, ['feed.jpeg', 'feed-2.jpeg', 'café.png'], 'duplicate names get -2; UTF-8 kept');

// The system unzip agrees, when it's available.
try {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frameup-zip-'));
  const file = path.join(dir, 'pack.zip');
  fs.writeFileSync(file, bytes);
  const out = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
  assert.match(out, /No errors detected/);
  fs.rmSync(dir, { recursive: true, force: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

// ─── Layout maths ────────────────────────────────────────────────────────
const ids = Pack.TARGETS.map(t => `${t.id}:${t.w}x${t.h}`);
assert.deepEqual(ids, ['feed:1080x1350', 'square:1080x1080', 'story:1080x1920', 'x:1600x900', 'youtube:1280x720']);

const feed = { w: 1080, h: 1350 };
const rects = Pack.fitRects(feed, { w: 1600, h: 900 });
assert.deepEqual(rects.contain, { x: 440, y: 0, w: 720, h: 900 }, 'contain centres the whole design');
assert.equal(rects.cover.w, 1600);
assert.ok(rects.cover.h >= 900);
assert.equal(rects.cover.x, 0);

assert.equal(Pack.cropLoss(feed, feed), 0);
assert.ok(Math.abs(Pack.cropLoss(feed, { w: 1080, h: 1080 }) - 0.2) < 1e-9, '4:5 to square loses 20%');
assert.ok(Pack.cropLoss({ w: 1280, h: 720 }, { w: 1600, h: 900 }) < 1e-9, '16:9 to 16:9 loses nothing');
assert.deepEqual(Pack.cropSource({ w: 1280, h: 720 }, { w: 1600, h: 900 }), { x: 0, y: 0, w: 1280, h: 720 });
assert.deepEqual(Pack.cropSource(feed, { w: 1080, h: 1080 }), { x: 0, y: 135, w: 1080, h: 1080 });

assert.equal(Pack.chooseMethod({ postType: 'cover', src: feed, dst: { w: 1080, h: 1350 } }), 'original');
assert.equal(Pack.chooseMethod({ postType: 'cover', src: feed, dst: { w: 1600, h: 900 } }), 'relayout');
assert.equal(Pack.chooseMethod({ postType: 'quote', src: feed, dst: { w: 1600, h: 900 } }), 'fit', 'not verified for re-layout: fitted');
assert.equal(Pack.chooseMethod({ postType: 'quote', src: { w: 1080, h: 1300 }, dst: feed }), 'crop', 'a small trim is a crop');
assert.equal(Pack.chooseMethod({ postType: 'twitter-quote', src: feed, dst: { w: 1080, h: 1920 } }), 'fit');

const workspaces = {
  instagram: { width: 1080, height: 1350, mistHeight: 404, defaultBottomAnchor: 180 },
  reels: { width: 1080, height: 1920, mistHeight: 540, defaultBottomAnchor: 240 },
  youtube: { width: 1280, height: 720, mistHeight: 320, defaultBottomAnchor: 92 },
};
const story = Pack.relayoutPlan({ base: workspaces.instagram, target: Pack.TARGETS[2], workspaces, anchor: 180 });
assert.equal(story.mistHeight, 540, 'story uses the Reels fade');
assert.equal(story.bottomAnchor, 240, 'story uses the Reels text position');
assert.equal(story.swipe, false, 'no swipe arrow on a story');
const yt = Pack.relayoutPlan({ base: workspaces.instagram, target: Pack.TARGETS[4], workspaces, anchor: 270, textX: 540, textY: 1000 });
assert.equal(yt.mistHeight, 320);
assert.equal(yt.bottomAnchor, 138, 'a raised anchor stays proportionally raised (92 × 270/180)');
assert.equal(yt.textX, 540 * 1280 / 1080, 'a dragged text block moves with the width');
assert.equal(yt.textY, 1000 * 720 / 1350);
const square = Pack.relayoutPlan({ base: workspaces.instagram, target: Pack.TARGETS[1], workspaces });
assert.equal(square.mistHeight, Math.round(404 * 1080 / 1350), 'square scales the feed fade by height');
assert.equal(square.bottomAnchor, Math.round(180 * 1080 / 1350));
assert.equal(square.textX, null);
assert.equal(square.swipe, true);

assert.equal(Pack.packFilename('es-ig-Chiefs Clinch!', Pack.TARGETS[3], 'jpeg'), 'es-ig-chiefs-clinch-x-1600x900.jpeg');
assert.equal(Pack.packFilename('', Pack.TARGETS[0]), 'frameup-feed-1080x1350.jpeg');

console.log('size pack tests passed.');
