// Reels Studio export helpers (window.ReelExport; Node for the tests).
// The page owns the canvas, fonts and Web Audio; this file owns the parts
// that decide whether the MP4 has the voice in it:
//
//   mixPlan(timeline, buffers)        which audio clips go into the mix
//   encodeMediabunny({ MB, ... })     frame-exact MP4 (H.264 + AAC) with the
//                                     mixed audio interleaved one second at a
//                                     time; clips are seeked before each frame
//   attachAudio(stream, ac, mix)      the MediaRecorder fallback's audio track
//
// The audio mix (voice at 0 dB, music ducked 14 dB under it) is rendered once
// by the page with an OfflineAudioContext and is the SAME buffer for preview,
// WebCodecs and MediaRecorder, so if the preview speaks, the file speaks.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelExport = api;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // Audio clips of the timeline whose decoded buffers exist.
  function mixPlan(timeline, buffers) {
    const clips = (timeline && timeline.tracks ? timeline.tracks.audio : []).filter(a => buffers && buffers[a.asset]);
    const vo = clips.filter(a => a.kind === 'vo');
    const wanted = (timeline && timeline.tracks ? timeline.tracks.audio : []).filter(a => a.kind === 'vo').length;
    return { clips, vo: vo.length, voWanted: wanted, music: clips.some(a => a.kind === 'music'), missingVo: Math.max(0, wanted - vo.length) };
  }

  // One second of a mixed AudioBuffer (copied: encoders keep references).
  function sliceSecond(mix, sec, makeBuffer) {
    const start = Math.floor(sec * mix.sampleRate);
    const end = Math.min(mix.length, Math.floor((sec + 1) * mix.sampleRate));
    if (end <= start) return null;
    const buf = makeBuffer({ length: end - start, numberOfChannels: mix.numberOfChannels, sampleRate: mix.sampleRate });
    for (let ch = 0; ch < mix.numberOfChannels; ch += 1) buf.copyToChannel(mix.getChannelData(ch).subarray(start, end), ch);
    return buf;
  }

  // MB: the Mediabunny module. draw(t): draws frame t on `canvas`.
  // prepare(t): async, e.g. seeks the clips on screen at t (optional).
  async function encodeMediabunny({ MB, canvas, durationMs, mix = null, draw, prepare = null, fps = 30, bitrate = 8e6, onProgress = () => {}, job = {}, makeBuffer = null, yieldEvery = 6 }) {
    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
    const video = new MB.CanvasSource(canvas, { codec: 'avc', bitrate, keyFrameInterval: 2 });
    output.addVideoTrack(video, { frameRate: fps });
    let audio = null;
    if (mix) { audio = new MB.AudioBufferSource({ codec: 'aac', bitrate: 192e3 }); output.addAudioTrack(audio); }
    await output.start();
    const frames = Math.ceil((durationMs / 1000) * fps);
    const mk = makeBuffer || (o => new AudioBuffer(o));
    let audioSeconds = 0;
    for (let i = 0; i < frames; i += 1) {
      if (job.cancelled) { await output.cancel(); throw new Error('cancelled'); }
      if (audio && i % fps === 0) { const s = sliceSecond(mix, i / fps, mk); if (s) { await audio.add(s); audioSeconds += s.length / mix.sampleRate; } }
      const t = (i * 1000) / fps;
      if (prepare) await prepare(t);
      draw(t);
      await video.add(i / fps, 1 / fps);
      if (i % yieldEvery === 0) { onProgress(i / frames); await new Promise(r => setTimeout(r, 0)); }
    }
    await output.finalize();
    return { buffer: output.target.buffer, frames, hasAudio: Boolean(audio), audioSeconds };
  }

  // MediaRecorder fallback: the mix plays into the recorded stream.
  function attachAudio(stream, ac, mix) {
    if (!mix) return null;
    const dest = ac.createMediaStreamDestination();
    const src = ac.createBufferSource();
    src.buffer = mix;
    src.connect(dest);
    dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    return src;
  }

  return { mixPlan, sliceSecond, encodeMediabunny, attachAudio };
}));
