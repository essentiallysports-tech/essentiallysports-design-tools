#!/usr/bin/env node
// Writes scripts/fixtures/reels/es-paper-golden.json: the draw calls of the ES
// engine for six sample stories at 9:16 and 4:5, one digest per sampled frame.
// It was generated from the engine BEFORE looks existed (commit 9ba7412), so
// test-reel-looks.mjs can prove that a reel with no look, and the Paper look,
// still draw exactly what they drew then. Regenerated 2026-11-27 for Reels
// Studio v3 (one type scale, FrameUp pills), on purpose. Re-run only when Paper is changed on
// purpose:  node scripts/lib/reel-looks-golden.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STORIES, STORY_IDS, optsFor, frameDigests } from './reel-looks-samples.mjs';

const require = createRequire(import.meta.url);
const R = require('../../reel-render.js');
const out = { note: 'ES engine draw calls before looks (base 9ba7412). See scripts/lib/reel-looks-golden.mjs.', stepMs: 100, frames: {} };
STORY_IDS.forEach(id => ['9:16', '4:5'].forEach(aspect => {
  const tl = R.buildTimeline(STORIES[id], optsFor(id, { aspect }));
  out.frames[`${id}@${aspect}`] = { durationMs: tl.durationMs, size: tl.size, digests: frameDigests(R, tl, out.stepMs) };
}));
const file = fileURLToPath(new URL('../fixtures/reels/es-paper-golden.json', import.meta.url));
writeFileSync(file, `${JSON.stringify(out)}\n`);
console.log(`wrote ${file}: ${Object.values(out.frames).reduce((a, f) => a + f.digests.length, 0)} frames`);
