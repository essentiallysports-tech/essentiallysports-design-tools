#!/usr/bin/env node
// Reels Studio, your own voiceover: the server side (checkTake, transcribeTake,
// alignBeats in netlify/functions/_reel-voice.js) and the browser's pure logic
// (reel-voice-input.js): a mocked transcript -> per-beat windows, the 90 s /
// one-request size guard, the fallbacks (on-device words, the even split
// marked estimated) and the rule that the script is never rewritten.
// fetch, Groq and the Gateway are mocked. No DOM.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
delete process.env.GROQ_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.REELS_TRANSCRIBE;
const V = require('../netlify/functions/_reel-voice.js');
const gateway = require('../netlify/functions/_ai-gateway.js');
const api = require('../netlify/functions/reel-maker.js');
const C = require('../reel-voice-input.js');
const E = require('../reel-es.js');
const R = require('../reel-render.js');
const F = require('../reel-formats.js');
const X = require('../reel-captions-export.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
const realFetch = globalThis.fetch;
const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const track = { email: 'a@essentiallysports.com', token: 'tok' };

// A script in three scenes and what a recogniser would hear: it drops the
// comma in the number and the possessive, mishears a name, and adds an "um".
const BEATS = [
  { id: 'b1', vo: "The Bills' big *win* changes everything." },
  { id: 'b2', vo: 'Josh Allen threw for 5,477 yards.' },
  { id: 'b3', vo: 'Buffalo clinched the AFC East.' },
];
const HEARD_TEXT = 'The Bills big win changes everything um Josh Alan threw for 5477 yards Buffalo clinched the AFC East';
// 300 ms a word with a 60 ms gap; a 700 ms pause before each new sentence.
function hear(text, pauseBefore = ['Josh', 'Buffalo']) {
  let at = 200;
  return text.split(' ').map(w => { if (pauseBefore.includes(w)) at += 700; const word = { w, s: at, e: at + 300 }; at += 360; return word; });
}
const HEARD = hear(HEARD_TEXT);
const TAKE_MS = HEARD[HEARD.length - 1].e + 400;
const scriptWords = BEATS.map(b => b.vo.replace(/\*/g, '').split(/\s+/));

await test('alignBeats (server): a transcript -> one window per beat, in order, inside the take', () => {
  const { beats, match } = V.alignBeats(BEATS, HEARD, TAKE_MS);
  assert.deepEqual(beats.map(b => b.id), ['b1', 'b2', 'b3']);
  beats.forEach((b, i) => {
    assert.ok(b.startMs >= 0 && b.endMs <= TAKE_MS && b.endMs > b.startMs);
    if (i) assert.ok(b.startMs >= beats[i - 1].endMs, 'windows never overlap');
    b.words.forEach((w, k) => { assert.ok(w.e >= w.s); if (k) assert.ok(w.s >= b.words[k - 1].s); });
  });
  // Each beat starts on its own first heard word.
  assert.equal(beats[0].startMs, HEARD.find(h => h.w === 'The').s);
  assert.equal(beats[1].startMs, HEARD.find(h => h.w === 'Josh').s);
  assert.equal(beats[2].startMs, HEARD.find(h => h.w === 'Buffalo').s);
  assert.equal(beats[2].endMs, HEARD[HEARD.length - 1].e);
  assert.ok(match > 0.8 && match <= 1);
});

await test('never rewrite the script: every word comes back exactly as written, only timed', () => {
  const { beats } = V.alignBeats(BEATS, HEARD, TAKE_MS);
  beats.forEach((b, i) => assert.deepEqual(b.words.map(w => w.w), scriptWords[i]));
  const all = beats.flatMap(b => b.words.map(w => w.w)).join(' ');
  assert.ok(all.includes("Bills'") && all.includes('5,477') && all.includes('Allen'));
  assert.ok(!all.includes('Alan') && !all.includes('um') && !all.includes('5477 '));
  // A misheard word ("Alan") sits between its matched neighbours.
  const allen = beats[1].words[1];
  assert.ok(allen.s >= beats[1].words[0].e && allen.e <= beats[1].words[2].s);
  // Emphasis asterisks are never spoken or returned.
  assert.ok(!all.includes('*'));
});

await test('alignBeats: a recording of something else scores a low match; empty input is safe', () => {
  const other = hear('Completely different words about the weather in Chicago today and tomorrow');
  assert.ok(V.alignBeats(BEATS, other, 6000).match < 0.2);
  assert.deepEqual(V.alignBeats([], HEARD, TAKE_MS), { beats: [], match: 0 });
  assert.deepEqual(V.alignBeats([{ id: 'x', vo: '' }], HEARD, TAKE_MS), { beats: [], match: 0 });
  // Nothing heard: the words are spread over the take, still in order.
  const spread = V.alignBeats(BEATS, [], 9000).beats;
  assert.equal(spread.length, 3);
  assert.ok(spread[0].startMs < spread[1].startMs && spread[1].startMs < spread[2].startMs && spread[2].endMs <= 9000);
});

await test('the browser runs the same alignment (on-device fallback): identical windows', () => {
  assert.deepEqual(C.alignBeats(BEATS, HEARD, TAKE_MS), V.alignBeats(BEATS, HEARD, TAKE_MS));
  const messy = hear('uh the bills big win it changes like everything josh allen threw yards buffalo clinched east');
  assert.deepEqual(C.alignBeats(BEATS, messy, 9000), V.alignBeats(BEATS, messy, 9000));
  assert.deepEqual(C.alignScript("The Bills' big win", HEARD.slice(0, 4), 1500), V.alignScript("The Bills' big win", HEARD.slice(0, 4), 1500));
});

await test('heardFromChunks: on-device recogniser chunks -> heard words in ms', () => {
  const words = C.heardFromChunks([{ text: ' The', timestamp: [0.2, 0.5] }, { text: ' Bills', timestamp: [0.56, null] }, { text: '  ', timestamp: [1, 2] }, { text: 'x' }]);
  assert.deepEqual(words, [{ w: 'The', s: 200, e: 500 }, { w: 'Bills', s: 560, e: 860 }]);
  assert.deepEqual(C.heardFromChunks(null), []);
});

// ── Size guard ──
const wavBytes = seconds => C.encodeWav(new Float32Array(Math.round(seconds * 16000)));
await test('size guard: 90 s of 16 kHz mono fits one request; longer is refused clearly', () => {
  const full = wavBytes(90);
  assert.equal(full.length, 90 * 16000 * 2 + 44);
  const body = JSON.stringify({ mode: 'voice-align', audio: C.toBase64(full), beats: BEATS });
  assert.ok(body.length < api._test.MAX_VOICE_BODY, 'under the function cap');
  assert.ok(body.length < 4.5 * 1024 * 1024, 'under Vercel\'s 4.5 MB body cap');
  assert.deepEqual(V.checkTake(Buffer.from(full)), { ok: true, durationMs: 90000 });
  const long = V.checkTake(Buffer.from(wavBytes(96)));
  assert.equal(long.ok, false);
  assert.equal(long.reason, 'too-long');
  assert.match(long.error, /90 seconds/);
  assert.equal(V.checkTake(Buffer.from('ID3 not a wav at all, just some bytes that are long enough to pass')).reason, 'bad-audio');
  assert.equal(V.checkTake(Buffer.from(wavBytes(0))).reason, 'bad-audio');
  // The browser says the same before anything is sent.
  assert.equal(C.checkLength(90.3).ok, true);
  const refuse = C.checkLength(102);
  assert.equal(refuse.reason, 'too-long');
  assert.match(refuse.error, /1:42 long.*up to 90 seconds/);
  assert.equal(C.checkLength(0.4).reason, 'too-short');
  assert.equal(C.LIMITS.maxSeconds, V.TAKE.maxSeconds);
});

await test('files: MP3, M4A, WAV and WebM are taken; anything else gets a plain-English error', () => {
  ['take.mp3', 'take.m4a', 'take.wav', 'take.webm'].forEach(name => assert.equal(C.checkFile({ name, type: '', size: 1000 }).ok, true));
  assert.equal(C.checkFile({ name: 'voice', type: 'audio/webm;codecs=opus', size: 1000 }).ok, true);
  assert.match(C.checkFile({ name: 'notes.pdf', type: 'application/pdf', size: 10 }).error, /MP3, M4A, WAV or WebM/);
  assert.equal(C.checkFile({ name: 'a.mp3', type: 'audio/mpeg', size: 0 }).reason, 'empty');
  assert.equal(C.checkFile({ name: 'a.wav', type: 'audio/wav', size: 200 * 1024 * 1024 }).reason, 'size');
});

await test('mixDown + encodeWav: stereo 48 kHz -> 16 kHz mono 16-bit WAV the server accepts', () => {
  const n = 48000;
  const left = Float32Array.from({ length: n }, (_, i) => Math.sin(i / 20));
  const right = Float32Array.from({ length: n }, (_, i) => -Math.sin(i / 20) * 0.5);
  const mono = C.mixDown([left, right], 48000);
  assert.equal(mono.length, 16000);
  assert.ok(Math.max(...mono) <= 0.26 && Math.max(...mono) > 0.2, 'channels are averaged');
  const wav = Buffer.from(C.encodeWav(mono));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(V.wavDurationMs(wav), 1000);
  assert.equal(Buffer.from(C.toBase64(new Uint8Array(wav)), 'base64').equals(wav), true);
  // Clipping never wraps.
  const loud = Buffer.from(C.encodeWav(Float32Array.from([2, -2])));
  assert.equal(loud.readInt16LE(44), 32767);
  assert.equal(loud.readInt16LE(46), -32768);
});

// ── transcribeTake: providers, cost, privacy ──
const AUDIO = C.toBase64(wavBytes(2));
await test('transcribeTake: no provider -> off; the Gateway is used when Groq has no key, with its cost', async () => {
  V._test.TAKE_CACHE.clear();
  assert.equal((await V.transcribeTake({ audio: AUDIO, track, env: {} })).reason, 'off');
  const seen = [];
  const real = gateway.aiTranscribe;
  gateway.aiTranscribe = async args => { seen.push(args); return { text: 'The Bills win', words: [{ word: 'The', start: 0.2, end: 0.5 }, { word: 'Bills', start: 0.56, end: 0.86 }, { word: 'win', start: 0.9, end: 1.2 }], segments: [], model: args.model, cost: 0.0002 }; };
  try {
    const out = await V.transcribeTake({ audio: AUDIO, track, env: { AI_GATEWAY_API_KEY: 'gw' } });
    assert.equal(out.ok, true);
    assert.equal(out.provider, 'gateway');
    assert.equal(out.cost, 0.0002);
    assert.deepEqual(out.words, [{ w: 'The', s: 200, e: 500 }, { w: 'Bills', s: 560, e: 860 }, { w: 'win', s: 900, e: 1200 }]);
    assert.equal(seen[0].mediaType, 'audio/wav');
    assert.equal(seen[0].track.feature, 'reels-voice-align');
    // The same take again is free (a retry never bills twice).
    const again = await V.transcribeTake({ audio: AUDIO, track, env: { AI_GATEWAY_API_KEY: 'gw' } });
    assert.equal(again.cached, true);
    assert.equal(again.cost, 0);
    assert.equal(seen.length, 1);
  } finally { gateway.aiTranscribe = real; }
});

await test('transcribeTake: the free provider goes first; its failure falls through to the Gateway; usage rows carry no words', async () => {
  V._test.TAKE_CACHE.clear();
  const calls = [];
  let groqOk = true;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    if (u.includes('api.groq.com')) return groqOk ? jsonResponse(200, { text: ' Josh Allen did it.', words: [{ word: 'Josh', start: 0.1, end: 0.4 }, { word: 'Allen', start: 0.45, end: 0.8 }, { word: 'did', start: 0.9, end: 1.0 }, { word: 'it.', start: 1.05, end: 1.3 }] }) : jsonResponse(500, { error: { message: 'down' } });
    if (u.includes('frameup_ai_usage')) return new Response('', { status: 201 });
    throw new Error(`unexpected fetch ${u}`);
  };
  const real = gateway.aiTranscribe;
  let gw = 0;
  gateway.aiTranscribe = async () => { gw += 1; return { text: 'Josh Allen did it.', words: [{ word: 'Josh', start: 0.1, end: 0.4 }], segments: [], model: 'elevenlabs/scribe-v2', cost: 0.0003 }; };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const env = { GROQ_API_KEY: 'gq', AI_GATEWAY_API_KEY: 'gw' };
    const out = await V.transcribeTake({ audio: AUDIO, track, env });
    assert.equal(out.provider, 'groq');
    assert.equal(out.cost, 0);
    assert.equal(gw, 0, 'the billed provider is not called when the free one answers');
    assert.equal(out.words.length, 4);
    const groq = calls.find(c => c.url.includes('api.groq.com'));
    assert.equal(groq.opts.headers.Authorization, 'Bearer gq');
    assert.ok(groq.opts.body instanceof FormData);
    assert.deepEqual(groq.opts.body.getAll('timestamp_granularities[]'), ['word', 'segment']);
    const rows = calls.filter(c => c.url.includes('frameup_ai_usage')).map(c => c.opts.body);
    rows.forEach(row => { assert.ok(!/Josh|Allen/.test(row), 'no script or transcript text in the usage log'); });
    // Groq down: the Gateway answers.
    groqOk = false;
    const other = C.toBase64(wavBytes(3));
    const second = await V.transcribeTake({ audio: other, track, env });
    assert.equal(second.provider, 'gateway');
    assert.equal(gw, 1);
    // Both down: a clear, non-technical error.
    gateway.aiTranscribe = async () => { throw new Error('boom'); };
    const third = await V.transcribeTake({ audio: C.toBase64(wavBytes(4)), track, env });
    assert.deepEqual([third.ok, third.reason], [false, 'error']);
    assert.ok(!/boom|groq/i.test(third.error));
    // A budget stop is passed on as such (the page then uses its own fallback).
    gateway.aiTranscribe = async () => { throw Object.assign(new Error('Insufficient funds'), { status: 402, code: 'budget' }); };
    const fourth = await V.transcribeTake({ audio: C.toBase64(wavBytes(5)), track, env: { AI_GATEWAY_API_KEY: 'gw' } });
    assert.equal(fourth.ok, false);
    assert.ok(['budget', 'error'].includes(fourth.reason));
  } finally { gateway.aiTranscribe = real; globalThis.fetch = realFetch; console.warn = warn; }
});

await test('transcribeTake: a silent take says so', async () => {
  V._test.TAKE_CACHE.clear();
  const real = gateway.aiTranscribe;
  gateway.aiTranscribe = async () => ({ text: '', words: [], segments: [], model: 'm', cost: 0 });
  try {
    const out = await V.transcribeTake({ audio: C.toBase64(wavBytes(6)), track, env: { AI_GATEWAY_API_KEY: 'gw' } });
    assert.equal(out.reason, 'silent');
    assert.match(out.error, /No speech was heard/);
  } finally { gateway.aiTranscribe = real; }
});

// ── Fallbacks and cutting ──
const plan = E.scriptToPlan('The Cubs lost on Sunday night. This bar got *paid* in full. Kalshi says 1 in 2,500 bets was insurance.', { sourceLine: 'Source: Kalshi' });
const lines = C.beatLines(plan, E);
await test('beatLines: every spoken scene in order, as written, without the ES end card', () => {
  assert.equal(lines.length, plan.beats.length - 1);
  assert.equal(lines.map(l => l.vo).join(' '), E.plainVo(plan.script.text));
  assert.ok(!lines.some(l => l.vo.includes('*')));
  assert.deepEqual(C.beatLines({ beats: [{ id: 'a', vo: '  ' }, { id: 'b', vo: 'Hi there' }] }), [{ id: 'b', vo: 'Hi there' }]);
  assert.deepEqual(C.beatLines(null), []);
});

await test('fallback: the even split shares the take by expected length and is marked estimated', () => {
  const split = C.evenSplit(lines, 12000, F.estimateVoMs);
  assert.equal(split.length, lines.length);
  assert.equal(split[0].startMs, 0);
  assert.equal(split[split.length - 1].endMs, 12000);
  split.forEach((w, i) => {
    assert.equal(w.estimated, true);
    assert.deepEqual(w.words, [], 'no word times are invented');
    if (i) assert.equal(w.startMs, split[i - 1].endMs);
    const share = (w.endMs - w.startMs) / 12000;
    const want = F.estimateVoMs(lines[i].vo) / lines.reduce((a, l) => a + F.estimateVoMs(l.vo), 0);
    assert.ok(Math.abs(share - want) < 0.01);
  });
  assert.equal(C.TIMING.estimated, 'estimated timing');
  // Without the page's estimator it still splits by word count.
  assert.equal(C.evenSplit(lines, 9000).length, lines.length);
});

await test('cutWindows: cuts hug the words, never overlap, and stay inside the take', () => {
  const { beats } = V.alignBeats(BEATS, HEARD, TAKE_MS);
  const cuts = C.cutWindows(beats, TAKE_MS);
  cuts.forEach((cut, i) => {
    assert.ok(cut.fromMs >= 0 && cut.toMs <= TAKE_MS && cut.toMs > cut.fromMs);
    if (i) assert.ok(cut.fromMs >= cuts[i - 1].toMs, 'no audio is used twice');
    assert.ok(cut.fromMs <= beats[i].startMs && beats[i].startMs - cut.fromMs <= 70, 'a breath before the first word');
    assert.ok(cut.toMs >= beats[i].endMs && cut.toMs - beats[i].endMs <= 140, 'a beat after the last word');
    assert.deepEqual(cut.words.map(w => w.w), scriptWords[i]);
    assert.equal(cut.words[0].s, beats[i].startMs - cut.fromMs, 'word times are from the cut\'s start');
    cut.words.forEach(w => assert.ok(w.s >= 0 && w.e >= w.s && w.e <= cut.toMs - cut.fromMs));
  });
  // The even split is cut edge to edge (nothing between scenes is thrown away).
  const even = C.cutWindows(C.evenSplit(lines, 12000, F.estimateVoMs), 12000, { preMs: 0, postMs: 0 });
  assert.equal(even[0].fromMs, 0);
  even.forEach((cut, i) => { if (i) assert.equal(cut.fromMs, even[i - 1].toMs); });
  assert.equal(even[even.length - 1].toMs, 12000);
});

await test('nudge start: moves one scene\'s start, within limits, and nothing else', () => {
  const { beats } = V.alignBeats(BEATS, HEARD, TAKE_MS);
  const base = C.cutWindows(beats, TAKE_MS);
  const later = C.cutWindows(beats, TAKE_MS, { nudge: { b2: 200 } });
  assert.equal(later[1].fromMs, base[1].fromMs + 200);
  assert.deepEqual(later[2], base[2]);
  assert.equal(later[0].fromMs, base[0].fromMs);
  const earlier = C.cutWindows(beats, TAKE_MS, { nudge: { b2: -300 } });
  assert.ok(earlier[1].fromMs < base[1].fromMs);
  assert.ok(earlier[1].fromMs >= earlier[0].toMs, 'never into the scene before');
  // Word times still count from the new start, never negative.
  earlier[1].words.forEach(w => assert.ok(w.s >= 0));
  assert.equal(earlier[1].words[0].s - base[1].words[0].s, base[1].fromMs - earlier[1].fromMs);
  // Clamped to the limit and to the scene itself.
  const wild = C.cutWindows(beats, TAKE_MS, { nudge: { b1: -99999, b3: 99999 } });
  assert.equal(wild[0].fromMs, 0);
  assert.ok(wild[2].fromMs < beats[2].endMs && wild[2].toMs > wild[2].fromMs);
});

await test('end to end: the cut take drives the timeline; captions are the script word for word', () => {
  const heard = hear(lines.map(l => l.vo).join(' ').replace(/[.,]/g, '').replace('2500', '2500'), ['This', 'Kalshi']);
  const takeMs = heard[heard.length - 1].e + 300;
  const { beats: windows } = C.alignBeats(lines, heard, takeMs);
  const cuts = C.cutWindows(windows, takeMs);
  const voice = Object.fromEntries(cuts.map(cut => [cut.id, { own: true, durationMs: cut.toMs - cut.fromMs, words: cut.words, asset: `vo:${cut.id}` }]));
  const assets = Object.fromEntries(cuts.map(cut => [`vo:${cut.id}`, { kind: 'vo', rights: C.RIGHTS }]));
  const tl = R.buildTimeline(plan, { style: 'es', voice, assets, voiceMode: 'gateway' });
  assert.equal(tl.timing.estimate, false, 'times are the voice\'s, not estimates');
  assert.equal(tl.tracks.captions.words.map(w => w.w).join(' '), E.plainVo(plan.script.text));
  assert.equal(X.toTranscript(tl).replace(/\s+/g, ' ').trim(), E.plainVo(plan.script.text));
  assert.equal(tl.tracks.audio.filter(a => a.kind === 'vo').length, cuts.length);
  tl.tracks.audio.filter(a => a.kind === 'vo').forEach(a => { const cut = cuts.find(c => `vo:${c.id}` === a.asset); assert.equal(a.durMs, cut.toMs - cut.fromMs); });
  assert.equal(E.voMatchesScript(plan), true, 'the plan still reads the script word for word');
  assert.equal(C.RIGHTS.source, 'Your recording');
  // The estimated fallback: scene lengths follow the split, captions still the script.
  const even = C.cutWindows(C.evenSplit(lines, takeMs, F.estimateVoMs), takeMs, { preMs: 0, postMs: 0 });
  const tl2 = R.buildTimeline(plan, { style: 'es', voice: Object.fromEntries(even.map(cut => [cut.id, { own: true, estimated: true, durationMs: cut.toMs - cut.fromMs, words: cut.words, asset: `vo:${cut.id}` }])), assets, voiceMode: 'gateway' });
  assert.equal(tl2.tracks.captions.words.map(w => w.w).join(' '), E.plainVo(plan.script.text));
});

await test('no script: a transcript becomes a locked-words plan (scriptToPlan), then the same alignment', () => {
  const said = 'Josh Allen did it again on Sunday night. The Bills are now 10 and 2. Nobody saw this coming in September.';
  const fromTake = E.scriptToPlan(said, {});
  assert.equal(fromTake.script.locked, true);
  assert.equal(fromTake.script.text, said);
  const l2 = C.beatLines(fromTake, E);
  assert.equal(l2.map(l => l.vo).join(' '), said);
  const heard = hear(said.replace(/[.]/g, ''), ['The', 'Nobody']);
  const { beats: w2, match } = C.alignBeats(l2, heard, heard[heard.length - 1].e + 200);
  assert.equal(match, 1);
  assert.equal(w2.flatMap(b => b.words.map(w => w.w)).join(' '), said);
});

console.log(process.exitCode ? '\nReel voice-align tests failed.' : `\nAll ${passed} reel voice-align tests passed.`);
