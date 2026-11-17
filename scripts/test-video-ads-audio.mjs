#!/usr/bin/env node
// Video Ads sound (video-ads-audio.js): muted by default in the export mixer,
// the shared audio library (parsing + empty state), upload validation,
// fade / loop / offset maths, ducking levels, the rights record, and the
// page wiring (export only adds an audio track when the mix is audible).
// A mocked AudioContext stands in for Web Audio; no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const A = require('../video-ads-audio.js');
const close = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≈ ${b}`);

// ─── Mock AudioContext ───────────────────────────────────────────────────────
function mockContext() {
  const log = [];
  const param = name => ({
    name, value: 0, events: [],
    setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; },
    linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); },
    cancelScheduledValues(t) { this.events = []; log.push(['cancel', name, t]); },
  });
  const node = (kind, extra = {}) => {
    const n = {
      kind, outputs: [],
      connect(dest) { this.outputs.push(dest); log.push(['connect', kind, dest.kind]); return dest; },
      disconnect(dest) { this.outputs = dest ? this.outputs.filter(o => o !== dest) : []; },
      ...extra,
    };
    return n;
  };
  const ac = {
    currentTime: 10,
    sources: [],
    log,
    createGain() { return node('gain', { gain: param('gain') }); },
    createBufferSource() {
      const s = node('buffer', { buffer: null, loop: false, loopStart: 0, loopEnd: 0, started: null, stopped: false,
        start(when, offset) { this.started = { when, offset }; }, stop() { this.stopped = true; } });
      ac.sources.push(s);
      return s;
    },
  };
  return ac;
}
const media = { kind: 'media', outputs: [], connect(d) { this.outputs.push(d); return d; } };
const buffer = { duration: 30 };

// 1. Default is muted: the clip gain and music gain are 0, nothing is audible,
//    and playing starts no track.
{
  const ac = mockContext();
  const m = A.createMixer(ac, { mediaSource: media });
  assert.equal(A.DEFAULTS.mode, 'muted');
  const lv = m.apply({ ...A.DEFAULTS });
  assert.deepEqual(lv, { original: 0, music: 0 });
  assert.deepEqual(m.levels(), { original: 0, music: 0 });
  assert.equal(m.audible(), false, 'muted mix is not audible: the export adds no audio track');
  m.sync(0, true, 8);
  assert.equal(ac.sources.length, 0, 'no buffer source when muted');
  // Graph: media -> original gain -> bus; env -> music gain -> bus.
  assert.equal(media.outputs[0], m.nodes.original);
  assert.ok(m.nodes.original.outputs.includes(m.bus));
  assert.ok(m.nodes.music.outputs.includes(m.bus));
  // Muted with a buffer loaded is still silent.
  m.apply({ ...A.DEFAULTS }, { buffer });
  m.sync(0, true, 8);
  assert.equal(ac.sources.length, 0);
  assert.equal(m.audible(), false);
}

// 2. Original: the clip at 0 dB, audible; no clip sound = not audible.
{
  const ac = mockContext();
  const m = A.createMixer(ac, { mediaSource: { ...media, outputs: [] } });
  m.apply({ ...A.DEFAULTS, mode: 'original' });
  close(m.levels().original, 1);
  assert.equal(m.levels().music, 0);
  assert.equal(m.audible(), true);
  m.apply({ ...A.DEFAULTS, mode: 'original' }, { clipHasAudio: false });
  assert.equal(m.audible(), false, 'an animated background has no clip sound');
}

// 3. Ducking: music -6 dB; with "keep the clip" the clip drops to -12 dB.
{
  const music = A.levels({ ...A.DEFAULTS, mode: 'library' });
  close(music.music, Math.pow(10, -6 / 20), 1e-9, 'music -6 dB');
  assert.equal(music.original, 0, 'music alone: the clip stays muted');
  const both = A.levels({ ...A.DEFAULTS, mode: 'upload', keepOriginal: true });
  close(both.music, 0.501187, 1e-5, 'music -6 dB');
  close(both.original, 0.251189, 1e-5, 'clip ducked to -12 dB');
  const custom = A.levels({ ...A.DEFAULTS, mode: 'library', keepOriginal: true, musicDb: 0, duckDb: -20 });
  close(custom.music, 1);
  close(custom.original, 0.1, 1e-9);
  // Music not loaded yet: the clip is not ducked against silence.
  const waiting = A.levels({ ...A.DEFAULTS, mode: 'library', keepOriginal: true }, { hasMusic: false });
  assert.equal(waiting.music, 0);
  close(waiting.original, 1, 1e-9);
  assert.equal(A.dbToGain(A.DB_MIN), 0, 'slider floor is silence');
  assert.equal(A.dbToGain(-Infinity), 0);
  close(A.dbToGain(0), 1);
}

// 4. Music in the mixer: a buffer source at the offset, looping the region,
//    with a fade envelope; seeks restart it, pause stops it.
{
  const ac = mockContext();
  const m = A.createMixer(ac, { mediaSource: { ...media, outputs: [] } });
  m.apply({ ...A.DEFAULTS, mode: 'library', offset: 4, fade: 0.5, loop: true }, { buffer });
  assert.equal(m.audible(), true);
  m.sync(0, true, 8);
  assert.equal(ac.sources.length, 1);
  const src = ac.sources[0];
  assert.equal(src.started.offset, 4, 'starts at the trim start');
  assert.equal(src.loop, true);
  assert.equal(src.loopStart, 4);
  assert.equal(src.loopEnd, 30);
  const ev = m.nodes.env.gain.events;
  assert.deepEqual(ev[0], ['set', 0, 10], 'envelope starts at 0 (fade in)');
  assert.deepEqual(ev[1], ['ramp', 1, 10.5], 'full volume after 0.5 s');
  assert.deepEqual(ev[2], ['ramp', 1, 17.5], 'holds until 0.5 s before the end');
  assert.deepEqual(ev[3], ['ramp', 0, 18], 'faded out at the end');
  // In sync: no restart.
  ac.currentTime = 11;
  m.sync(1.02, true, 8);
  assert.equal(ac.sources.length, 1, 'no restart while in sync');
  // A seek: restart at the new place.
  m.sync(5, true, 8);
  assert.equal(ac.sources.length, 2);
  assert.ok(src.stopped);
  assert.equal(ac.sources[1].started.offset, 9);
  // Pause stops the track.
  m.sync(5.2, false, 8);
  assert.ok(ac.sources[1].stopped);
  assert.equal(m.playing(), false);
  // Loop off and past the end: silence, no source.
  m.apply({ ...A.DEFAULTS, mode: 'library', offset: 25, loop: false }, { buffer });
  m.sync(6, true, 8);
  assert.equal(ac.sources.length, 2, 'a finished non-looping track stays silent');
}

// 5. Fade / loop / offset maths.
{
  assert.equal(A.envelope(0, 8, 0.5), 0);
  assert.equal(A.envelope(0.25, 8, 0.5), 0.5);
  assert.equal(A.envelope(4, 8, 0.5), 1);
  assert.equal(A.envelope(7.75, 8, 0.5), 0.5);
  assert.equal(A.envelope(8, 8, 0.5), 0);
  assert.equal(A.envelope(-1, 8, 0.5), 0);
  assert.equal(A.envelope(3, 8, 0), 1, 'no fade: full from the start');
  // The fade is capped at half the ad.
  assert.equal(A.envelope(1, 2, 3), 1);
  assert.equal(A.envelope(0.5, 2, 3), 0.5);
  // Ramps from mid-ad: current value, then the fade-out points.
  const r = A.envelopeRamps(4, 8, 0.5);
  assert.deepEqual(r, [{ in: 0, value: 1 }, { in: 3.5, value: 1 }, { in: 4, value: 0 }]);
  assert.deepEqual(A.envelopeRamps(0, 8, 0), [{ in: 0, value: 1 }, { in: 8, value: 1 }, { in: 8, value: 0 }], 'fade 0: on, held, off at the end');
  // Track position: offset, loop over [offset, end), or null once it runs out.
  assert.equal(A.trackPosition(0, { offset: 4, trackDuration: 30 }), 4);
  assert.equal(A.trackPosition(10, { offset: 4, trackDuration: 30 }), 14);
  close(A.trackPosition(30, { offset: 4, trackDuration: 30, loop: true }), 8, 1e-9, 'wraps to offset + 4');
  assert.equal(A.trackPosition(30, { offset: 4, trackDuration: 30, loop: false }), null);
  assert.equal(A.trackPosition(1, { offset: 0, trackDuration: 0 }), null, 'no track');
  // A short track loops to cover a long ad.
  close(A.trackPosition(7.5, { offset: 0, trackDuration: 2 }), 1.5, 1e-9);
  // The trim start always leaves half a second.
  assert.equal(A.clampOffset(40, 30), 29.5);
  assert.equal(A.clampOffset(-3, 30), 0);
}

// 6. Library parsing and the empty state (the shipped file is empty).
{
  const shipped = JSON.parse(fs.readFileSync(new URL('../audio-library.json', import.meta.url), 'utf8'));
  const lib = A.parseLibrary(shipped);
  assert.equal(lib.empty, true);
  assert.equal(lib.tracks.length, 0);
  assert.match(shipped.about, /assets\/audio\//, 'about says where files go');
  assert.equal(lib.emptyMessage, 'No tracks yet. Upload your own, or ask an admin to add library tracks.');
  // The documented example is a valid track.
  const ex = A.parseLibrary({ version: 1, tracks: [shipped.example] });
  assert.equal(ex.tracks.length, 1, JSON.stringify(ex.skipped));
  assert.equal(ex.tracks[0].file, 'assets/audio/fourth-quarter-drive.mp3');
  const good = { id: 'drive', title: 'Drive', mood: 'hype', bpm: 120, durationSec: 60, file: 'assets/audio/drive.mp3', licence: { organic: true, paid: false, note: 'Org only' }, addedBy: 'x', addedAt: '2026-11-18' };
  const parsed = A.parseLibrary({ version: 1, about: 'a', tracks: [
    good,
    { ...good }, // duplicate id
    { ...good, id: 'Bad Id' },
    { ...good, id: 'remote', file: 'https://example.com/x.mp3' }, // not same origin
    { ...good, id: 'escape', file: 'assets/audio/../x.mp3' },
    { ...good, id: 'nolic', licence: null },
    { ...good, id: 'neither', licence: { organic: false, paid: false } },
    { ...good, id: 'notitle', title: '' },
    { ...good, id: 'wav', file: 'assets/audio/wav.wav', bpm: 'x', licence: { organic: true, paid: true } },
    null,
  ] });
  assert.deepEqual(parsed.tracks.map(t => t.id), ['drive', 'wav']);
  assert.equal(parsed.tracks[1].bpm, null);
  assert.equal(parsed.skipped.length, 8);
  assert.equal(parsed.empty, false);
  assert.equal(A.licenceLabel(parsed.tracks[0].licence), 'Organic only');
  assert.equal(A.licenceLabel(parsed.tracks[1].licence), 'Organic + paid');
  assert.equal(A.parseLibrary('nope').empty, true);
  assert.equal(A.parseLibrary({}).empty, true);
}

// 7. loadLibrary: fetch errors fall back to the empty state, never throw.
{
  const ok = await A.loadLibrary(async url => { assert.equal(url, 'audio-library.json'); return { ok: true, json: async () => ({ tracks: [] }) }; });
  assert.equal(ok.empty, true);
  const missing = await A.loadLibrary(async () => ({ ok: false, status: 404 }));
  assert.equal(missing.empty, true);
  assert.match(missing.error, /404/);
  const thrown = await A.loadLibrary(async () => { throw new Error('offline'); });
  assert.equal(thrown.empty, true);
}

// 8. Upload validation: type and size.
{
  const MB = 1024 * 1024;
  assert.equal(A.validateUpload({ name: 'a.mp3', type: 'audio/mpeg', size: MB }).ok, true);
  assert.equal(A.validateUpload({ name: 'a.m4a', type: 'audio/x-m4a', size: MB }).ok, true);
  assert.equal(A.validateUpload({ name: 'a.wav', type: 'audio/wav', size: MB }).ok, true);
  assert.equal(A.validateUpload({ name: 'a.m4a', type: '', size: MB }).ok, true, 'no type: the extension decides');
  assert.equal(A.validateUpload({ name: 'a.m4a', type: 'application/octet-stream', size: MB }).ok, true);
  assert.equal(A.validateUpload({ name: 'a.ogg', type: 'audio/ogg', size: MB }).ok, false);
  assert.equal(A.validateUpload({ name: 'a.mp4', type: 'video/mp4', size: MB }).ok, false);
  assert.equal(A.validateUpload({ name: 'a.exe', type: '', size: MB }).ok, false);
  assert.equal(A.validateUpload({ name: 'a.mp3', type: 'audio/mpeg', size: 15 * MB }).ok, true, '15 MB is allowed');
  const big = A.validateUpload({ name: 'a.mp3', type: 'audio/mpeg', size: 15 * MB + 1 });
  assert.equal(big.ok, false);
  assert.match(big.error, /15 MB/);
  assert.equal(A.validateUpload({ name: 'a.mp3', type: 'audio/mpeg', size: 0 }).ok, false);
  assert.equal(A.validateUpload(null).ok, false);
}

// 9. Persistence: per brand, default Muted; an upload never survives a reload;
//    a track that left the library falls back to Muted.
{
  assert.equal(A.normalize(undefined).mode, 'muted');
  assert.equal(A.normalize({ mode: 'upload' }).mode, 'muted');
  assert.equal(A.persistable({ ...A.DEFAULTS, mode: 'upload', musicDb: -3 }).mode, 'muted');
  assert.equal(A.persistable({ ...A.DEFAULTS, mode: 'upload', musicDb: -3 }).musicDb, -3);
  const lib = A.parseLibrary({ tracks: [] });
  assert.equal(A.normalize({ mode: 'library', trackId: 'gone' }, { library: lib }).mode, 'muted');
  assert.equal(A.normalize({ mode: 'library', trackId: 'x' }).mode, 'library', 'library not loaded yet: keep it');
  const n = A.normalize({ mode: 'original', musicDb: 99, fade: 10, offset: -2, loop: false });
  assert.equal(n.musicDb, A.DB_MAX);
  assert.equal(n.fade, A.FADE_MAX);
  assert.equal(n.offset, 0);
  assert.equal(n.loop, false);
}

// 10. Rights record for the export learning event.
{
  assert.deepEqual(A.record({ ...A.DEFAULTS }), { mode: 'muted', audible: false });
  const orig = A.record({ ...A.DEFAULTS, mode: 'original' }, { clip: { source: 'x', url: 'https://x.com/a' } });
  assert.equal(orig.audible, true);
  assert.deepEqual(orig.original, { clipSource: 'x', clipUrl: 'https://x.com/a', db: 0 });
  const track = { id: 'drive', title: 'Drive', licence: { organic: true, paid: true, note: 'ES #1' } };
  const lib = A.record({ ...A.DEFAULTS, mode: 'library', trackId: 'drive', keepOriginal: true }, { track, clip: { source: 'upload' } });
  assert.equal(lib.track.id, 'drive');
  assert.deepEqual(lib.track.licence, { organic: true, paid: true, note: 'ES #1' });
  assert.equal(lib.original.db, -12, 'ducked clip recorded');
  const up = A.record({ ...A.DEFAULTS, mode: 'upload' }, { upload: { name: 'tone.wav', size: 1000 }, rightsTicked: true });
  assert.deepEqual(up.upload, { name: 'tone.wav', bytes: 1000, rightsConfirmed: true });
  assert.equal(up.original, undefined);
  assert.equal(A.describe({ ...A.DEFAULTS }), 'Muted');
}

// 11. Page wiring: the export adds audio tracks only when audible; every
//     export learning event carries `sound`; the library file is same origin.
{
  const js = fs.readFileSync(new URL('../video-ads.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../video-ads.html', import.meta.url), 'utf8');
  assert.match(js, /const withSound = soundAudible\(\);/);
  assert.match(js, /if \(audioDest\) audioDest\.stream\.getAudioTracks\(\)/);
  assert.doesNotMatch(js, /audioSource\.connect\(audioDest\)/, 'the clip is never wired straight to the recorder');
  assert.equal((js.match(/sound: soundRecord\(\)/g) || []).length, 2, 'single/grid and daily-set export events');
  assert.match(js, /sound: A\.persistable\(state\.sound\)/, 'remembered per brand');
  assert.match(html, /<script src="video-ads-audio\.js\?v=[^"]+"><\/script>[\s\S]*<script src="video-ads\.js/, 'audio module loads before the page');
  assert.match(html, /data-sound="muted" aria-checked="true"/, 'Muted is the default in the markup');
  assert.match(html, /<video id="va-video"[^>]*\bmuted\b/, 'the element starts muted');
}

console.log('video-ads audio: ok');
