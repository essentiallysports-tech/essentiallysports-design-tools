#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const reels = readFileSync(join(root, 'reels.js'), 'utf8');
const html = readFileSync(join(root, 'reels.html'), 'utf8');

assert.match(reels, /TRANSCRIBE_SAMPLE_RATE\s*=\s*16000/);
assert.match(reels, /TRANSCRIBE_CHUNK_SECONDS\s*=\s*25/);
assert.match(reels, /MAX_INLINE_UPLOAD_BYTES\s*=\s*3\s*\*\s*1024\s*\*\s*1024/);
assert.match(reels, /function transcribeUploadedClip/);
assert.match(reels, /function transcribeDecodedAudio/);
assert.match(reels, /function encodeWav/);
assert.match(reels, /mimeType:\s*'audio\/wav'/);
assert.match(reels, /function drawCaptionPills/);
assert.match(reels, /POST_FONT_FAMILY\s*=\s*'Acumin Post'/);
assert.match(reels, /function initBrandControls/);
assert.match(reels, /function renderPaletteRow/);
assert.match(html, /id="reels-sport-select"/);
assert.match(html, /id="reels-team-select"/);
assert.match(html, /id="reels-palette-row"/);

console.log('Reels transcription framework checks passed.');
