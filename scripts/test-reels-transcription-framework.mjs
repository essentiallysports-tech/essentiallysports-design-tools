#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const reels = readFileSync(join(root, 'reels.js'), 'utf8');
const html = readFileSync(join(root, 'reels.html'), 'utf8');
const socialSource = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(reels, /TRANSCRIBE_SAMPLE_RATE\s*=\s*16000/);
assert.match(reels, /TRANSCRIBE_CHUNK_SECONDS\s*=\s*25/);
assert.match(reels, /CAPTION_MAX_WORDS\s*=\s*5/);
assert.match(reels, /CAPTION_MIN_SECONDS\s*=\s*0\.7/);
assert.match(reels, /MAX_INLINE_UPLOAD_BYTES\s*=\s*3\s*\*\s*1024\s*\*\s*1024/);
assert.match(reels, /function transcribeUploadedClip/);
assert.match(reels, /function transcribeDecodedAudio/);
assert.match(reels, /function formatCaptionBeats/);
assert.match(reels, /formatCaptionBeats\(result\.segments \|\| \[\]\)/);
assert.match(reels, /function encodeWav/);
assert.match(reels, /function refreshSpeechBackendStatus/);
assert.match(reels, /\/api\/es-video-intelligence\?health=1/);
assert.match(reels, /Speech backend ready: ES MCP intelligence plus Groq Whisper captions\./);
assert.match(reels, /mimeType:\s*'audio\/wav'/);
assert.match(reels, /function drawCaptionPills/);
assert.match(reels, /POST_FONT_FAMILY\s*=\s*'Acumin Post'/);
assert.match(reels, /PILL_H\s*=\s*122/);
assert.match(reels, /PILL_FONT_SIZE\s*=\s*130/);
assert.match(reels, /PILL_PAD_LEFT\s*=\s*18\.40/);
assert.match(reels, /PILL_PAD_RIGHT\s*=\s*21\.88/);
assert.match(reels, /function getCaptionPillXOffset/);
assert.match(reels, /CAPTION_PILL_OFFSETS\s*=\s*\[0,\s*-96,\s*84,\s*-48\]/);
assert.match(reels, /function initBrandControls/);
assert.match(reels, /function renderPaletteRow/);
assert.match(html, /id="reels-sport-select"/);
assert.match(html, /id="reels-team-select"/);
assert.match(html, /id="reels-palette-row"/);

for (const constant of ['PILL_H', 'PILL_FONT_SIZE', 'PILL_PAD_LEFT', 'PILL_PAD_RIGHT']) {
  const socialValue = socialSource.match(new RegExp(`const ${constant}\\\\s*=\\\\s*([0-9.]+)`))?.[1];
  const reelsValue = reels.match(new RegExp(`var ${constant}\\\\s*=\\\\s*([0-9.]+)`))?.[1];
  assert.equal(reelsValue, socialValue, `Reels ${constant} must match the social-media pill renderer`);
}

const captionPillSource = reels.slice(
  reels.indexOf('function drawCaptionPills'),
  reels.indexOf('function getCaptionBlockTop'),
);
assert.match(captionPillSource, /ctx\.fillRect\(pillX,\s*pillY,\s*pillW,\s*activePillH\)/);
assert.doesNotMatch(captionPillSource, /roundRect|arcTo|ctx\.fill\(\)/);
assert.match(captionPillSource, /getCaptionPillXOffset\(index,\s*lines\.length\)/);

const formatterSource = reels.slice(
  reels.indexOf('function formatCaptionBeats'),
  reels.indexOf('function addCaptionAtPlayhead'),
);
assert.match(formatterSource, /i\s*\+=\s*CAPTION_MAX_WORDS/);
assert.match(formatterSource, /words\.slice\(i,\s*i \+ CAPTION_MAX_WORDS\)/);
assert.match(formatterSource, /chunkStart/);
assert.match(formatterSource, /chunkEnd/);

console.log('Reels transcription framework checks passed.');
