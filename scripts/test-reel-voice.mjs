#!/usr/bin/env node
// Reels Studio voice (netlify/functions/_reel-voice.js): the AI Gateway is the
// default route (speech + Scribe word alignment), env gating (captions only,
// REELS_TTS=off, the optional REELS_TTS=elevenlabs fallback), the never-clone
// rule, script-to-transcript alignment, the per-text cache, usage logging
// and the optional music bed with organic-only rights. fetch is mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const V = require('../netlify/functions/_reel-voice.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
const realFetch = globalThis.fetch;
const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => { calls.push({ url: String(url), opts }); return handler(String(url), opts); };
  return calls;
}
const GW = { AI_GATEWAY_API_KEY: 'gw-key' };
const track = { email: 'a@essentiallysports.com', token: 'tok' };
const MP3 = Buffer.from('ID3fake-mp3-bytes').toString('base64');
const usageRows = calls => calls.filter(c => c.url.includes('frameup_ai_usage')).map(c => JSON.parse(c.opts.body));

function wav(seconds, rate = 24000) {
  const data = Buffer.alloc(Math.round(seconds * rate) * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
// A Scribe reply: the transcript writes "5477" without the comma and adds an audio event.
const SCRIBE = {
  text: 'Allen threw for 5477 yards.', segments: [], durationInSeconds: 2.4, warnings: [],
  providerMetadata: { elevenlabs: { words: [
    { text: 'Allen', type: 'word', start: 0.05, end: 0.4 }, { text: ' ', type: 'spacing', start: 0.4, end: 0.45 },
    { text: 'threw', type: 'word', start: 0.45, end: 0.8 }, { text: 'for', type: 'word', start: 0.82, end: 0.95 },
    { text: '[breath]', type: 'audio_event', start: 1.0, end: 1.1 },
    { text: '5477', type: 'word', start: 1.1, end: 1.8 }, { text: 'yards.', type: 'word', start: 1.85, end: 2.3 },
  ] } },
};

await test('voiceStatus: the Gateway is the default (Eleven v4, library voice Brian); overrides; off; ElevenLabs only behind REELS_TTS=elevenlabs', () => {
  assert.equal(V.voiceStatus({}).mode, 'off', 'no key: captions only');
  const gw = V.voiceStatus(GW);
  assert.deepEqual([gw.mode, gw.model, gw.voice, gw.align], ['gateway', 'elevenlabs/eleven-v4', 'nPczCjzI2devNBz1zQrb', 'elevenlabs/scribe-v2']);
  assert.ok(V.LIBRARY_VOICES.has(gw.voice));
  assert.equal(V.voiceStatus({ ...GW, REELS_TTS_MODEL: 'eleven-v3' }).model, 'elevenlabs/eleven-v3', 'short model names work');
  const google = V.voiceStatus({ ...GW, REELS_TTS_MODEL: 'google/gemini-3.8-flash-tts' });
  assert.deepEqual([google.model, google.voice], ['google/gemini-3.8-flash-tts', 'Charon']);
  assert.equal(V.voiceStatus({ ...GW, REELS_TTS_VOICE: 'CwhRBWXzGAHq8TQ4Fs17' }).voice, 'CwhRBWXzGAHq8TQ4Fs17');
  assert.equal(V.voiceStatus({ ...GW, REELS_TTS: 'off' }).mode, 'off');
  const eleven = { ...GW, REELS_TTS: 'elevenlabs', ELEVENLABS_API_KEY: 'xi', ELEVENLABS_VOICE_ID: 'v1' };
  assert.equal(V.voiceStatus(eleven).mode, 'elevenlabs');
  assert.equal(V.voiceStatus({ ...GW, ELEVENLABS_API_KEY: 'xi', ELEVENLABS_VOICE_ID: 'v1' }).mode, 'gateway', 'an ElevenLabs key alone does not switch away from the Gateway');
  assert.equal(V.voiceStatus({ REELS_TTS: 'elevenlabs' }).mode, 'off');
  const pub = JSON.stringify(V.publicStatus(gw));
  V.VOICES.forEach(v => assert.equal(pub.includes(v.voice), false, 'voice ids never reach the browser'));
  assert.deepEqual(V.publicStatus(gw).voices.map(v => v.id), ['brian', 'liam', 'sarah', 'bella']);
});

await test('Gateway speech + Scribe alignment: exact request shapes, script words keep their spelling, both calls logged', async () => {
  V._test.CACHE.clear();
  const calls = mockFetch((url, opts) => {
    if (url === V.GATEWAY_SPEECH) {
      assert.equal(opts.headers['ai-model-id'], 'elevenlabs/eleven-v4');
      assert.equal(opts.headers['ai-speech-model-specification-version'], '4');
      assert.equal(opts.headers['ai-gateway-protocol-version'], '0.0.1');
      assert.equal(opts.headers.Authorization, 'Bearer gw-key');
      const body = JSON.parse(opts.body);
      assert.deepEqual([body.text, body.voice, body.outputFormat], ['Allen threw for 5,477 yards.', 'nPczCjzI2devNBz1zQrb', 'mp3']);
      assert.ok(body.providerOptions.elevenlabs.voiceSettings);
      return jsonResponse(200, { audio: MP3, warnings: [] });
    }
    if (url === V.GATEWAY_TRANSCRIBE) {
      assert.equal(opts.headers['ai-model-id'], 'elevenlabs/scribe-v2');
      assert.equal(opts.headers['ai-transcription-model-specification-version'], '4');
      const body = JSON.parse(opts.body);
      assert.equal(body.audio, MP3);
      assert.equal(body.mediaType, 'audio/mpeg');
      return jsonResponse(200, SCRIBE);
    }
    if (url.includes('frameup_ai_usage')) return new Response('', { status: 201 });
    throw new Error(`unexpected ${url}`);
  });
  const text = 'Allen threw for 5,477 yards.';
  const out = await V.synthesize({ text, env: GW, track });
  assert.equal(out.ok, true);
  assert.equal(out.mode, 'gateway');
  assert.equal(out.mime, 'audio/mpeg');
  assert.equal(out.durationMs, 2400, 'MP3 length from the transcription');
  assert.deepEqual(out.words.map(w => w.w), ['Allen', 'threw', 'for', '5,477', 'yards.']);
  assert.deepEqual(out.words.map(w => w.s), [50, 450, 820, 1100, 1850]);
  assert.equal(out.alignedBy, 'elevenlabs/scribe-v2');
  assert.ok(Math.abs(out.costs.voice - text.length * 0.00008) < 1e-9, 'Eleven v4: $0.00008 a character');
  assert.ok(Math.abs(out.costs.align - 2.4 * 0.000061112) < 1e-6, 'Scribe v2: $0.000061 a second');
  const rows = usageRows(calls);
  assert.deepEqual(rows.map(r => r.feature).sort(), ['reels-voice', 'reels-voice-align']);
  assert.equal(rows.find(r => r.feature === 'reels-voice').model, 'elevenlabs/eleven-v4');
  // Same text again: cached, free, no new Gateway calls.
  const before = calls.length;
  const again = await V.synthesize({ text, env: GW, track });
  assert.equal(again.cached, true);
  assert.equal(again.cost, 0);
  assert.equal(calls.length, before);
});

await test('alignment failure still returns the voice (captions are estimated in the page)', async () => {
  V._test.CACHE.clear();
  mockFetch(url => (url === V.GATEWAY_SPEECH ? jsonResponse(200, { audio: MP3 }) : url === V.GATEWAY_TRANSCRIBE ? jsonResponse(500, { error: { message: 'down' } }) : new Response('', { status: 201 })));
  const out = await V.synthesize({ text: 'A different line.', env: GW, track });
  assert.equal(out.ok, true);
  assert.deepEqual(out.words, []);
  assert.equal(out.costs.align, 0);
});

await test('Gemini via the Gateway: WAV, Charon, instructions; cost includes audio seconds', async () => {
  V._test.CACHE.clear();
  const env = { ...GW, REELS_TTS_MODEL: 'google/gemini-3.8-flash-tts' };
  mockFetch((url, opts) => {
    if (url === V.GATEWAY_SPEECH) {
      const body = JSON.parse(opts.body);
      assert.deepEqual([body.voice, body.outputFormat], ['Charon', 'wav']);
      assert.ok(body.instructions);
      return jsonResponse(200, { audio: wav(2.5).toString('base64') });
    }
    if (url === V.GATEWAY_TRANSCRIBE) return jsonResponse(200, { ...SCRIBE, durationInSeconds: 2.5 });
    return new Response('', { status: 201 });
  });
  const out = await V.synthesize({ text: 'Allen threw for 5,477 yards.', env, track });
  assert.equal(out.mime, 'audio/wav');
  assert.equal(out.durationMs, 2500);
  assert.ok(out.costs.voice > 2.5 * 25 * 0.000009 * 0.99);
});

await test('never a clone: unknown ElevenLabs voice ids are refused without a key to check them', async () => {
  V._test.CACHE.clear();
  V._test.verified.clear();
  let calls = mockFetch(() => { throw new Error('no request expected'); });
  let out = await V.synthesize({ text: 'Line one.', env: { ...GW, REELS_TTS_VOICE: 'myClonedVoice123' } });
  assert.equal(out.reason, 'voice-check');
  assert.equal(calls.length, 0);
  calls = mockFetch(url => (url.includes('/voices/') ? jsonResponse(200, { category: 'cloned' }) : jsonResponse(200, { audio: MP3 })));
  out = await V.synthesize({ text: 'Line one.', env: { ...GW, REELS_TTS_VOICE: 'myClonedVoice123', ELEVENLABS_API_KEY: 'xi' } });
  assert.equal(out.reason, 'voice-check');
  assert.match(out.error, /cloned/);
  assert.ok(!calls.some(c => c.url === V.GATEWAY_SPEECH));
  V._test.verified.clear();
  mockFetch(url => (url.includes('/voices/') ? jsonResponse(401, {}) : jsonResponse(200, { audio: MP3 })));
  out = await V.synthesize({ text: 'Line one.', env: { ...GW, REELS_TTS_VOICE: 'otherVoice', ELEVENLABS_API_KEY: 'xi' } });
  assert.equal(out.reason, 'voice-check', 'fails closed when the check cannot run');
});

await test('REELS_TTS=elevenlabs fallback: direct /with-timestamps gives word timings, no Scribe call', async () => {
  V._test.CACHE.clear();
  V._test.verified.clear();
  const env = { REELS_TTS: 'elevenlabs', ELEVENLABS_API_KEY: 'xi', ELEVENLABS_VOICE_ID: 'voice123' };
  const alignment = { characters: [...'Big win.'], character_start_times_seconds: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35], character_end_times_seconds: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.5] };
  const calls = mockFetch(url => {
    if (url.includes('/voices/')) return jsonResponse(200, { category: 'premade' });
    if (url.includes('/text-to-speech/voice123/with-timestamps')) return jsonResponse(200, { audio_base64: MP3, alignment });
    return new Response('', { status: 201 });
  });
  const out = await V.synthesize({ text: 'Big win.', env, track });
  assert.equal(out.mode, 'elevenlabs');
  assert.deepEqual(out.words, [{ w: 'Big', s: 0, e: 150 }, { w: 'win.', s: 200, e: 500 }]);
  assert.ok(!calls.some(c => c.url === V.GATEWAY_TRANSCRIBE));
});

await test('captions only, too long, and budget errors stay calm', async () => {
  V._test.CACHE.clear();
  mockFetch(() => { throw new Error('no network'); });
  assert.equal((await V.synthesize({ text: 'Hi.', env: {} })).reason, 'off');
  assert.equal((await V.synthesize({ text: 'x'.repeat(401), env: GW })).reason, 'too-long');
  mockFetch(url => (url === V.GATEWAY_SPEECH ? jsonResponse(402, { error: { message: 'Budget exceeded' } }) : new Response('', { status: 201 })));
  assert.equal((await V.synthesize({ text: 'Budget line.', env: GW, track })).reason, 'budget');
});

await test('alignScript: matched words take transcript times, misses are interpolated, order is kept', () => {
  const heard = [{ w: 'the', s: 0, e: 100 }, { w: 'bills', s: 120, e: 400 }, { w: 'win', s: 900, e: 1200 }];
  const words = V.alignScript("The Bills' big win", heard, 1300);
  assert.deepEqual(words.map(w => w.w), ['The', "Bills'", 'big', 'win']);
  assert.deepEqual([words[0].s, words[1].s, words[3].s], [0, 120, 900]);
  assert.ok(words[2].s >= 400 && words[2].e <= 900, 'a missed word sits between its neighbours');
  assert.deepEqual(V.wordsFromTranscript({ segments: [{ text: 'one two', startSecond: 0, endSecond: 1 }] }).map(w => w.w), ['one', 'two']);
});

await test('music bed: off unless REELS_MUSIC=gateway; Music v2.5 request; organic-only rights; logged as reels-music', async () => {
  V._test.CACHE.clear();
  assert.equal((await V.makeMusic({ env: GW })).reason, 'off');
  const env = { ...GW, REELS_MUSIC: 'gateway' };
  assert.equal(V.musicStatus(env).ready, true);
  const calls = mockFetch((url, opts) => {
    if (url === V.GATEWAY_SPEECH) {
      assert.equal(opts.headers['ai-model-id'], 'elevenlabs/music-v2.5');
      const body = JSON.parse(opts.body);
      assert.equal(body.voice, undefined, 'music takes no voice');
      assert.deepEqual(body.providerOptions.elevenlabs, { musicLengthMs: 30000, forceInstrumental: true });
      assert.match(body.text, /Instrumental/);
      return jsonResponse(200, { audio: MP3 });
    }
    return new Response('', { status: 201 });
  });
  const out = await V.makeMusic({ mood: 'tension', seconds: 30, env, track });
  assert.equal(out.ok, true);
  assert.equal(out.cost, 0.075, '30 s at $0.0025 a second');
  assert.equal(out.rights.paid, false);
  assert.equal(out.rights.organic, true);
  assert.match(out.rights.licence, /2026-10-09/);
  assert.equal(usageRows(calls)[0].feature, 'reels-music');
  assert.equal((await V.makeMusic({ mood: 'tension', seconds: 30, env, track })).cached, true);
});

await test('cost of a 30 s reel (about 450 characters, 30 s of audio): Eleven v4 + alignment is about 4 cents', () => {
  const usd = V.voiceCost('elevenlabs/eleven-v4', 450) + V.voiceCost('elevenlabs/scribe-v2', 0, 30);
  assert.ok(usd > 0.037 && usd < 0.039, `${usd}`);
});

await test('four voices: verified library ids, option picks the voice, unknown options refused, hook tag only for the game-day voice on v4', async () => {
  assert.equal(V.VOICES.length, 4);
  V.VOICES.forEach(v => assert.ok(V.LIBRARY_VOICES.has(v.voice), `${v.name} is on the safe list`));
  assert.deepEqual(V.VOICES.map(v => v.gender).sort(), ['female', 'female', 'male', 'male']);
  assert.equal(V.voiceStatus(GW, 'sarah').voice, 'EXAVITQu4vr4xnSDxMaL');
  assert.equal(V.voiceStatus(GW, 'nope').voice, 'nPczCjzI2devNBz1zQrb', 'unknown option: house voice');
  assert.equal((await V.synthesize({ text: 'Hi there.', voiceOption: 'clone-me', env: GW })).reason, 'voice');
  V._test.CACHE.clear();
  const bodies = [];
  mockFetch((url, opts) => {
    if (url === V.GATEWAY_SPEECH) { bodies.push(JSON.parse(opts.body)); return jsonResponse(200, { audio: MP3 }); }
    if (url === V.GATEWAY_TRANSCRIBE) return jsonResponse(200, SCRIBE);
    return new Response('', { status: 201 });
  });
  await V.synthesize({ text: 'Allen threw for 5,477 yards.', voiceOption: 'liam', hook: true, env: GW, track });
  assert.equal(bodies[0].voice, 'TX3LPaxmHKxFdv7VOQHJ');
  assert.match(bodies[0].text, /^\[excited\] Allen/);
  assert.equal(bodies[0].providerOptions.elevenlabs.voiceSettings.style, 0.55);
  await V.synthesize({ text: 'Allen threw for 5,477 yards.', voiceOption: 'liam', hook: true, env: { ...GW, REELS_TTS_MODEL: 'elevenlabs/eleven-flash-v2.5' }, track });
  assert.doesNotMatch(bodies[1].text, /\[excited\]/, 'no tags on a model that would read them aloud');
});

await test('speakable: money, multipliers and ranks read naturally; captions keep the script', () => {
  assert.equal(V.speakable('Cap space: -$12.3M, and $32M goes to 2× the WRs at ~#25.'), 'Cap space: minus $12.3 million, and $32 million goes to 2 times the WRs at about number 25.');
  assert.equal(V.speakable('6.5 yards'), '6.5 yards');
});

await test('reply parsing: audio in audio / audio.base64 / data; wav sniffed; no audio logs the keys only', async () => {
  assert.equal(V.audioFromReply({ audio: MP3 }), MP3);
  assert.equal(V.audioFromReply({ audio: { base64: MP3 } }), MP3);
  assert.equal(V.audioFromReply({ data: MP3 }), MP3);
  assert.equal(V.audioFromReply({ audio: `data:audio/mpeg;base64,${MP3}` }), MP3);
  assert.equal(V.audioFromReply({ warnings: [] }), '');
  V._test.CACHE.clear();
  const logs = [];
  const warn = console.warn;
  console.warn = (...a) => logs.push(a.join(' '));
  mockFetch(url => (url === V.GATEWAY_SPEECH ? jsonResponse(200, { result: { secret: 'x' }, warnings: [] }) : new Response('', { status: 201 })));
  const out = await V.synthesize({ text: 'Odd reply.', env: GW, track });
  console.warn = warn;
  assert.equal(out.ok, false);
  assert.ok(logs.some(l => /keys: result,warnings/.test(l)), 'keys logged');
  assert.ok(!logs.some(l => /gw-key|secret/.test(l.replace('keys:', ''))), 'no secrets or values logged');
  V._test.CACHE.clear();
  mockFetch(url => (url === V.GATEWAY_SPEECH ? jsonResponse(200, { audio: { base64: wav(1.5).toString('base64') } }) : (url === V.GATEWAY_TRANSCRIBE ? jsonResponse(500, {}) : new Response('', { status: 201 }))));
  const w = await V.synthesize({ text: 'A wav reply.', env: GW, track });
  assert.deepEqual([w.ok, w.mime, w.durationMs], [true, 'audio/wav', 1500]);
});

await test('fallback: v4 fails -> Multilingual v2 once, logged with the model that spoke; pinned models never fall back', async () => {
  V._test.CACHE.clear();
  const models = [];
  const calls = mockFetch((url, opts) => {
    if (url === V.GATEWAY_SPEECH) { models.push(opts.headers['ai-model-id']); return models.length === 1 ? jsonResponse(400, { error: { message: 'model unavailable' } }) : jsonResponse(200, { audio: MP3 }); }
    if (url === V.GATEWAY_TRANSCRIBE) return jsonResponse(200, SCRIBE);
    return new Response('', { status: 201 });
  });
  const warn = console.warn; console.warn = () => {};
  const out = await V.synthesize({ text: 'Fallback line.', env: GW, track });
  console.warn = warn;
  assert.deepEqual(models, ['elevenlabs/eleven-v4', 'elevenlabs/eleven-multilingual-v2']);
  assert.equal(out.model, 'elevenlabs/eleven-multilingual-v2');
  assert.equal(usageRows(calls).find(r => r.feature === 'reels-voice').model, 'elevenlabs/eleven-multilingual-v2');
  V._test.CACHE.clear();
  models.length = 0;
  mockFetch(url => { if (url === V.GATEWAY_SPEECH) { models.push(1); return jsonResponse(400, {}); } return new Response('', { status: 201 }); });
  console.warn = () => {};
  await V.synthesize({ text: 'Pinned.', env: { ...GW, REELS_TTS_MODEL: 'elevenlabs/eleven-v3' }, track });
  console.warn = warn;
  assert.equal(models.length, 1);
});

await test('sample: a short cached clip per voice, no alignment call; diagnose: one tiny call, no audio or key in the answer', async () => {
  V._test.CACHE.clear();
  const calls = mockFetch(url => (url === V.GATEWAY_SPEECH ? jsonResponse(200, { audio: MP3 }) : new Response('', { status: 201 })));
  const a = await V.sample({ voiceOption: 'bella', env: GW, track });
  assert.equal(a.ok, true);
  assert.ok(!calls.some(c => c.url === V.GATEWAY_TRANSCRIBE), 'samples skip alignment');
  assert.equal(usageRows(calls)[0].feature, 'reels-voice-sample');
  assert.equal((await V.sample({ voiceOption: 'bella', env: GW, track })).cached, true);
  const d = await V.diagnose({ env: GW, track });
  assert.deepEqual([d.ok, d.model, d.format, d.bytes > 0], [true, 'elevenlabs/eleven-v4', 'audio/mpeg', true]);
  assert.equal(JSON.stringify(d).includes(MP3), false);
  assert.equal(JSON.stringify(d).includes('gw-key'), false);
  mockFetch(url => (url === V.GATEWAY_SPEECH ? jsonResponse(403, { error: { message: 'Speech is not enabled for this team' } }) : new Response('', { status: 201 })));
  const warn = console.warn; console.warn = () => {};
  const bad = await V.diagnose({ env: GW, track });
  console.warn = warn;
  assert.equal(bad.ok, false);
  assert.match(bad.error, /not enabled/);
  assert.equal((await V.diagnose({ env: {} })).configured, false);
});

globalThis.fetch = realFetch;
console.log(process.exitCode ? '\nReel voice tests failed.' : `\nAll ${passed} reel voice tests passed.`);
