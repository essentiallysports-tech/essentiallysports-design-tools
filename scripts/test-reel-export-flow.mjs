#!/usr/bin/env node
// Reels Studio export (reel-export.js) and guided flow (reel-flow.js):
// the voice is in the mix plan, the MP4 path (mocked Mediabunny encoder)
// adds an AAC track and feeds it every second of the mix, the MediaRecorder
// fallback attaches the mix's audio track, clips are prepared (seeked) before
// each frame; the flow state machine (Make my reel -> stages -> review).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const X = require('../reel-export.js');
const FLOW = require('../reel-flow.js');
const R = require('../reel-render.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}

// A fake AudioBuffer (Node has none).
class FakeBuffer {
  constructor({ length, numberOfChannels, sampleRate }) { this.length = length; this.numberOfChannels = numberOfChannels; this.sampleRate = sampleRate; this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length)); }
  getChannelData(c) { return this.data[c]; }
  copyToChannel(src, c) { this.data[c].set(src); }
}
function fakeMB(log) {
  return {
    Output: class { constructor(o) { this.o = o; this.target = o.target; } addVideoTrack(v, o) { log.push(['video', o.frameRate]); } addAudioTrack(a) { log.push(['audio', a.o.codec]); } async start() { log.push(['start']); } async finalize() { log.push(['finalize']); } async cancel() { log.push(['cancel']); } },
    Mp4OutputFormat: class { constructor(o) { this.o = o; } },
    BufferTarget: class { constructor() { this.buffer = new ArrayBuffer(8); } },
    CanvasSource: class { constructor(c, o) { this.o = o; } async add(t) { log.push(['frame', t]); } },
    AudioBufferSource: class { constructor(o) { this.o = o; } async add(buf) { log.push(['samples', buf.length]); } },
  };
}

const PLAN = { format: 'explainer', beats: [
  { id: 'a', kind: 'hook', text: 'Allen threw for 400', vo: 'Allen threw for 400 yards.' },
  { id: 'b', kind: 'cta', text: 'Thoughts?', vo: 'What do you think? Tell us.' },
] };

await test('mixPlan: the voice clips are in the mix; a missing voice buffer is counted', () => {
  const tl = R.buildTimeline(PLAN, { voice: { a: { durationMs: 1800, words: [], asset: 'vo:a' }, b: { durationMs: 1500, words: [], asset: 'vo:b' } } });
  assert.deepEqual(X.mixPlan(tl, { 'vo:a': {}, 'vo:b': {} }), { clips: tl.tracks.audio, vo: 2, voWanted: 2, music: false, missingVo: 0 });
  assert.equal(X.mixPlan(tl, { 'vo:a': {} }).missingVo, 1);
});

await test('encodeMediabunny: AAC track added, every second of the mix fed, clips prepared before each frame', async () => {
  const log = [];
  const rate = 48000;
  const mix = new FakeBuffer({ length: rate * 3 + 100, numberOfChannels: 2, sampleRate: rate });
  const prepared = [];
  const out = await X.encodeMediabunny({ MB: fakeMB(log), canvas: {}, durationMs: 3000, mix, draw: () => {}, prepare: async t => { prepared.push(t); }, fps: 30, makeBuffer: o => new FakeBuffer(o), yieldEvery: 1000 });
  assert.equal(out.hasAudio, true);
  assert.ok(log.some(l => l[0] === 'audio' && l[1] === 'aac'), 'an AAC track');
  assert.equal(log.filter(l => l[0] === 'samples').length, 3, 'one chunk a second');
  assert.ok(Math.abs(out.audioSeconds - 3) < 0.01);
  assert.equal(log.filter(l => l[0] === 'frame').length, 90);
  assert.equal(prepared.length, 90);
  const silent = await X.encodeMediabunny({ MB: fakeMB([]), canvas: {}, durationMs: 1000, mix: null, draw: () => {}, makeBuffer: o => new FakeBuffer(o) });
  assert.equal(silent.hasAudio, false);
});

await test('encodeMediabunny: cancel stops and cancels the output', async () => {
  const log = [];
  const job = { cancelled: true };
  await assert.rejects(X.encodeMediabunny({ MB: fakeMB(log), canvas: {}, durationMs: 1000, draw: () => {}, job, makeBuffer: o => new FakeBuffer(o) }), /cancelled/);
  assert.ok(log.some(l => l[0] === 'cancel'));
});

await test('attachAudio (MediaRecorder fallback): the mix becomes an audio track of the recorded stream', () => {
  const added = [];
  const stream = { addTrack: t => added.push(t) };
  const track = { kind: 'audio' };
  let connected = false;
  const ac = { createMediaStreamDestination: () => ({ stream: { getAudioTracks: () => [track] } }), createBufferSource: () => ({ connect() { connected = true; } }) };
  const src = X.attachAudio(stream, ac, { duration: 3 });
  assert.ok(src && connected);
  assert.deepEqual(added, [track]);
  assert.equal(X.attachAudio(stream, ac, null), null);
});

await test('flow: Make my reel -> script, voice, visuals, build -> review; a failed script stays on the story step', () => {
  let s = FLOW.initial();
  assert.equal(s.step, 'story');
  assert.equal(FLOW.reduce(s, { type: 'go', step: 'review' }).step, 'story', 'no reel yet: no review');
  s = FLOW.reduce(s, { type: 'make' });
  assert.equal(s.making, true);
  assert.equal(FLOW.reduce(s, { type: 'make' }), s, 'a second click does nothing while making');
  s = FLOW.reduce(s, { type: 'stage-done', stage: 'script' });
  s = FLOW.reduce(s, { type: 'stage-done', stage: 'voice', failed: true, note: 'Voice failed' });
  assert.equal(s.stages[1].state, 'failed');
  assert.equal(s.stages[2].state, 'active', 'a voice failure does not stop the reel');
  s = FLOW.reduce(s, { type: 'stage-done', stage: 'visuals' });
  assert.equal(FLOW.progress(s), 0.75);
  s = FLOW.reduce(s, { type: 'stage-done', stage: 'build' });
  assert.deepEqual([s.making, s.step, s.hasReel], [false, 'review', true]);
  assert.equal(FLOW.reduce(s, { type: 'go', step: 'export' }).step, 'export');
  let f = FLOW.reduce(FLOW.initial(), { type: 'make' });
  f = FLOW.reduce(f, { type: 'stage-done', stage: 'script', failed: true, note: 'Over the limit' });
  assert.deepEqual([f.making, f.step, f.error], [false, 'story', 'Over the limit']);
  assert.deepEqual(FLOW.STAGES.map(x => x.label), ['Writing the script', 'Recording the voice', 'Finding clips', 'Building your reel']);
});

await test('statusLine: "Ready · 52 s · $0.48 · 2 checks"', () => {
  assert.equal(FLOW.statusLine({ seconds: 52.2, usd: 0.48, warnings: 2 }), 'Ready · 52 s · $0.48 · 2 checks');
  assert.equal(FLOW.statusLine({ seconds: 30, usd: 0.1, critical: 1 }), '1 to fix · 30 s · $0.10');
});

console.log(process.exitCode ? '\nReel export/flow tests failed.' : `\nAll ${passed} reel export/flow tests passed.`);
