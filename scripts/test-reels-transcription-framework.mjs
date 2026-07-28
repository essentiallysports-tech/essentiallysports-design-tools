#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

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
assert.match(reels, /function normalizeTimedWords/);
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

const uploadResetSource = reels.slice(
  reels.indexOf('function onFileChosen'),
  reels.indexOf('function onVideoMetadata'),
);
assert.match(uploadResetSource, /state\.captions\s*=\s*\[\]/);
assert.match(uploadResetSource, /state\.nextId\s*=\s*1/);
assert.match(uploadResetSource, /els\.downloadSrtBtn\.disabled\s*=\s*true/);
assert.match(uploadResetSource, /els\.intelBtn\.disabled\s*=\s*true/);

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
assert.match(formatterSource, /timedWords\.slice\(w,\s*w \+ CAPTION_MAX_WORDS\)/);
assert.match(formatterSource, /chunkStart/);
assert.match(formatterSource, /chunkEnd/);

const formatterSandbox = {
  Math,
  Number,
  String,
  Array,
  CAPTION_MAX_WORDS: 5,
  CAPTION_MIN_SECONDS: 0.7,
};
vm.runInNewContext(`${formatterSource}\nthis.formatCaptionBeats = formatCaptionBeats;`, formatterSandbox);

const beats = formatterSandbox.formatCaptionBeats([{
  start: 10,
  end: 16,
  text: 'Caitlin Clark drills another deep three and brings the crowd to its feet',
  confidence: 0.91,
}]);

assert.equal(beats.length, 3, 'long speech segments must be split into short caption beats');
assert.deepEqual(Array.from(beats, beat => beat.text), [
  'Caitlin Clark drills another deep',
  'three and brings the crowd',
  'to its feet',
]);
assert.ok(beats.every(beat => beat.text.split(/\s+/).length <= 5), 'caption beats must keep social-pill text short');
assert.equal(beats[0].start, 10);
assert.equal(beats.at(-1).end, 16);
assert.ok(beats.every(beat => beat.end > beat.start), 'caption beats must preserve positive timing windows');
assert.ok(beats.every(beat => beat.confidence === 0.91), 'caption beats must preserve provider confidence');

const timedBeats = formatterSandbox.formatCaptionBeats([{
  start: 20,
  end: 26,
  text: 'LeBron James gives Los Angeles one more huge playoff moment',
  confidence: 0.88,
  words: [
    { word: 'LeBron', start: 20.0, end: 20.3 },
    { word: 'James', start: 20.3, end: 20.7 },
    { word: 'gives', start: 20.7, end: 21.0 },
    { word: 'Los', start: 21.0, end: 21.2 },
    { word: 'Angeles', start: 21.2, end: 21.7 },
    { word: 'one', start: 22.0, end: 22.2 },
    { word: 'more', start: 22.2, end: 22.5 },
    { word: 'huge', start: 22.5, end: 22.8 },
    { word: 'playoff', start: 22.8, end: 23.3 },
    { word: 'moment', start: 23.3, end: 23.8 },
  ],
}]);

assert.equal(timedBeats.length, 2, 'word timestamps should split into five-word timed beats');
assert.deepEqual(Array.from(timedBeats, beat => beat.text), [
  'LeBron James gives Los Angeles',
  'one more huge playoff moment',
]);
assert.equal(timedBeats[0].start, 20.0);
assert.equal(timedBeats[0].end, 21.7);
assert.equal(timedBeats[1].start, 22.0);
assert.equal(timedBeats[1].end, 23.8);
assert.equal(timedBeats[0].words.length, 5);

console.log('Reels transcription framework checks passed.');
