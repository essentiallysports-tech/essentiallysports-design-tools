#!/usr/bin/env node
// Reels Studio caption files (reel-captions-export.js): SRT, VTT and a plain
// transcript built from the SAME caption cards the renderer burns in
// (ReelRender.captionCards), so the files match the video cue for cue.
// Emphasis asterisks are never shown. Pure: no DOM, no network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../reel-captions-export.js');
const R = require('../reel-render.js');
const E = require('../reel-es.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
const SCRIPT = 'The Cubs lost. This bar got *paid.* Kalshi says 1 in 2,500 bets was insurance. Fans <3 it --> everyone wins & nobody cries.';
const plan = E.scriptToPlan(SCRIPT, { sourceLine: 'Source: Kalshi' });
const tl = R.buildTimeline(plan, { style: 'es' });
// The same reel with a recorded voice on the first beat (word timings from the take).
const first = plan.beats[0];
const voWords = E.plainVo(first.vo).split(/\s+/).map((w, i) => ({ w, s: 100 + i * 400, e: 400 + i * 400 }));
const voiced = R.buildTimeline(plan, { style: 'es', voice: { [first.id]: { durationMs: 100 + voWords.length * 400, words: voWords, asset: `vo:${first.id}` } }, assets: { [`vo:${first.id}`]: { kind: 'vo' } }, voiceMode: 'gateway' });
const legacy = R.buildTimeline({ format: 'explainer', beats: [{ id: 'a', kind: 'hook', text: 'Hook', vo: 'Josh Allen did it *again* on Sunday night.' }, { id: 'b', kind: 'cta', text: 'Follow', vo: 'Follow for more.' }] }, { style: 'classic' });

const srtTime = /^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$/;
const vttTime = /^\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}$/;
const ms = stampText => { const [h, m, rest] = stampText.split(':'); const [s, milli] = rest.split(/[,.]/); return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(milli); };

test('cues: one per burned-in card, at the card\'s own start, with the card\'s own words', () => {
  [tl, voiced, legacy].forEach(timeline => {
    const cards = timeline.tracks.captions.cards;
    const words = timeline.tracks.captions.words;
    const cues = C.cues(timeline);
    assert.ok(cards.length > 3);
    assert.equal(cues.length, cards.length);
    cues.forEach((cue, i) => {
      assert.equal(cue.n, i + 1);
      assert.equal(cue.s, cards[i].s, 'cue starts when its card appears');
      const next = cards[i + 1];
      assert.equal(cue.e, Math.min(cards[i].e, next ? next.s : Infinity, timeline.durationMs), 'cue ends when its card leaves');
      assert.equal(cue.text, cards[i].words.map(k => words[k].w.replace(/\*/g, '')).join(' '));
      assert.equal(cue.beat, cards[i].beat);
    });
  });
});

test('cues: built with ReelRender.captionCards, so a re-card of the words gives the same cues', () => {
  const words = voiced.tracks.captions.words;
  // v3: ES captions follow phrases (phrases: true), as buildTimeline cards them.
  const again = R.captionCards(words, { style: 'highlight', maxWords: 3, maxChars: 22, phrases: true });
  assert.deepEqual(C.cues({ ...voiced, tracks: { captions: { words, cards: again } } }).map(c => [c.s, c.text]), C.cues(voiced).map(c => [c.s, c.text]));
  // The recorded take's word times are the cue times.
  assert.equal(C.cues(voiced)[0].s, voiced.tracks.captions.words[0].s);
});

test('cues never overlap, never run past the reel, and are never empty', () => {
  [tl, voiced, legacy].forEach(timeline => {
    const cues = C.cues(timeline);
    cues.forEach((cue, i) => {
      assert.ok(cue.e > cue.s);
      assert.ok(cue.e <= timeline.durationMs);
      if (cues[i + 1]) assert.ok(cue.e <= cues[i + 1].s);
      assert.ok(cue.text.length > 0);
    });
  });
});

test('emphasis asterisks are stripped everywhere', () => {
  [tl, voiced, legacy].forEach(timeline => {
    [C.toSrt(timeline), C.toVtt(timeline), C.toTranscript(timeline)].forEach(text => assert.ok(!text.includes('*')));
  });
  // Even when a word list still carries them (a voice provider echoing the script).
  const raw = { durationMs: 3000, tracks: { captions: { words: [{ w: '*paid.*', s: 0, e: 500, beat: 'b1' }, { w: 'Now', s: 600, e: 900, beat: 'b1' }], cards: [{ s: 0, e: 900, words: [0, 1], beat: 'b1' }] } } };
  assert.equal(C.cues(raw)[0].text, 'paid. Now');
  assert.equal(C.toTranscript(raw), 'paid. Now\n');
});

test('SRT: numbered blocks, comma milliseconds, blank line between cues', () => {
  const srt = C.toSrt(tl);
  const blocks = srt.trim().split('\n\n');
  const cues = C.cues(tl);
  assert.equal(blocks.length, cues.length);
  blocks.forEach((block, i) => {
    const lines = block.split('\n');
    assert.equal(lines[0], String(i + 1));
    assert.match(lines[1], srtTime);
    const [a, b] = lines[1].split(' --> ');
    assert.equal(ms(a), cues[i].s);
    assert.equal(ms(b), cues[i].e);
    assert.equal(lines.length, 3);
  });
  assert.ok(srt.endsWith('\n'));
  assert.equal(C.stamp(3723004, ','), '01:02:03,004');
});

test('VTT: header, dot milliseconds, escaped text, no stray cue arrows', () => {
  const vtt = C.toVtt(tl);
  assert.ok(vtt.startsWith('WEBVTT\n\n'));
  const blocks = vtt.slice(8).trim().split('\n\n');
  const cues = C.cues(tl);
  assert.equal(blocks.length, cues.length);
  blocks.forEach((block, i) => {
    const lines = block.split('\n');
    assert.match(lines[1], vttTime);
    assert.equal(ms(lines[1].split(' --> ')[0]), cues[i].s);
    assert.ok(!lines[2].includes('-->'));
    assert.ok(!/<|&(?!amp;|lt;|gt;)/.test(lines[2]), 'text is escaped for WebVTT');
  });
  assert.ok(vtt.includes('&lt;3') && vtt.includes('&amp;'));
  // SRT keeps the characters as they are (it is plain text) but never a cue arrow in the text.
  assert.ok(C.toSrt(tl).includes('<3'));
  assert.equal(C.toSrt(tl).split('\n').filter(line => line.includes('-->') && !srtTime.test(line)).length, 0);
});

test('transcript: the spoken words, one paragraph per beat, word for word', () => {
  const text = C.toTranscript(tl);
  const paras = text.trim().split('\n\n');
  const spoken = plan.beats.filter(b => b.vo).map(b => E.plainVo(b.vo).replace(/\s+/g, ' ').trim());
  assert.deepEqual(paras, spoken);
  assert.equal(paras.join(' '), E.plainVo(plan.script.text));
});

test('no captions: empty files (header only for VTT), no crash on a bare timeline', () => {
  [null, {}, { tracks: {} }, { tracks: { captions: { words: [], cards: [] } } }].forEach(timeline => {
    assert.deepEqual(C.cues(timeline), []);
    assert.equal(C.toSrt(timeline), '');
    assert.equal(C.toVtt(timeline), 'WEBVTT\n\n');
    assert.equal(C.toTranscript(timeline), '');
  });
});

test('file names: from the reel title, safe characters, the right extension', () => {
  assert.match(C.fileName(tl, 'srt'), /^es-reel-[a-z0-9-]+-captions\.srt$/);
  assert.match(C.fileName(tl, 'vtt'), /-captions\.vtt$/);
  assert.match(C.fileName(tl, 'transcript'), /-transcript\.txt$/);
  assert.equal(C.fileName({ title: '../../x<y>' }, 'srt'), 'es-reel-x-y-captions.srt');
  assert.equal(C.fileName({}, 'vtt'), 'es-reel-reel-captions.vtt');
});

console.log(process.exitCode ? '\nReel captions export tests failed.' : `\nAll ${passed} reel captions export tests passed.`);
