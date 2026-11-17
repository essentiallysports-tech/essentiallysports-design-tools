// Reels Studio export helpers (window.ReelExport; Node for the tests).
// The page owns the canvas, fonts and Web Audio; this file owns the parts
// that decide whether the MP4 has the voice in it:
//
//   mixPlan(timeline, buffers)        which audio clips go into the mix
//   encodeMediabunny({ MB, ... })     frame-exact MP4 (H.264 + AAC) with the
//                                     mixed audio interleaved one second at a
//                                     time; clips are seeked before each frame
//   attachAudio(stream, ac, mix)      the MediaRecorder fallback's audio track
//   renderStills(slides, opts)        carousel slides (1080x1350) -> PNG files
//   exportStills(slides, opts)        the same, zipped (frameup-zip.js, no
//                                     deflate: PNGs are already compressed)
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

  // ─── Carousel stills (data formats) ────────────────────────────────────
  // slides: ReelRender.buildSlides(timeline) (one 1080x1350 timeline each).
  // Each slide is drawn once its motion has landed (t = the slide's end),
  // so the PNG is the settled design. opts (all optional in the browser):
  //   R        ReelRender            env    the renderer env (images, measure)
  //   canvas   a 1080x1350 canvas to reuse, or makeCanvas() -> canvas
  //   names    file names (default 01-cover.png, 02-panel.png...)
  //   onProgress(done, total)
  const pad2 = n => String(n).padStart(2, '0');
  const stillName = (s, i) => `${pad2(i + 1)}-${(s && s.slide && s.slide.kind) || 'slide'}.png`;
  async function canvasBytes(canvas, type) {
    if (typeof canvas.convertToBlob === 'function') return new Uint8Array(await (await canvas.convertToBlob({ type })).arrayBuffer());
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('The slide could not be encoded.'))), type));
    return new Uint8Array(await blob.arrayBuffer());
  }
  async function renderStills(slides, opts = {}) {
    const R = opts.R || (typeof self !== 'undefined' ? self.ReelRender : null);
    const list = Array.isArray(slides) ? slides.slice(0, 20) : [];
    if (!R || !list.length) throw new Error('No slides to export.');
    const make = opts.makeCanvas || (() => { const c = document.createElement('canvas'); c.width = 1080; c.height = 1350; return c; });
    const canvas = opts.canvas || make();
    const ctx = canvas.getContext('2d');
    const files = [];
    for (let i = 0; i < list.length; i += 1) {
      const s = list[i];
      ctx.clearRect(0, 0, 1080, 1350);
      R.drawFrame(ctx, s, Math.max(0, (s.durationMs || 2400) - 1), opts.env || {});
      const name = (opts.names && opts.names[i]) || stillName(s, i);
      files.push({ name, data: await canvasBytes(canvas, opts.type || 'image/png'), date: opts.date || new Date() });
      if (opts.onProgress) opts.onProgress(i + 1, list.length);
    }
    return files;
  }
  // -> a zip Blob (Uint8Array in Node, where Blob is optional).
  async function exportStills(slides, opts = {}) {
    const Zip = opts.Zip || (typeof self !== 'undefined' ? self.FrameUpZip : null);
    const files = await renderStills(slides, opts);
    if (!Zip) throw new Error('The zip writer is not loaded.');
    const bytes = Zip.zip(files);
    return typeof Blob !== 'undefined' ? new Blob([bytes], { type: 'application/zip' }) : bytes;
  }

  return { mixPlan, sliceSecond, encodeMediabunny, attachAudio, renderStills, exportStills, stillName };
}));
