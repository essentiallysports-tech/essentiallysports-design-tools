#!/usr/bin/env node
// Reels Studio Moment Replay helpers (reel-replay.js) and the carousel export
// (reel-export.js exportStills): pixel scores (sharpness, scene change,
// motion), the 9 code candidates (3 per third), the frame-pick answer
// (indices only, bad answers fall back to the code pick), the panel
// scrubbers, the panel layout inside both safe areas, the carousel slides
// and the PNG zip. Pure: no DOM, no network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RP = require('../reel-replay.js');
const R = require('../reel-render.js');
const S = require('../reel-styles.js');
const T = require('../reel-timeline.js');
const X = require('../reel-export.js');
const Zip = require('../frameup-zip.js');
const fx = name => require(`./fixtures/reels/${name}`);

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
const measure = (text, font) => String(text).length * Number(String(font).match(/([\d.]+)px/)[1]) * 0.55;
const planOf = tl => ({ format: tl.format, title: tl.title, sport: tl.sport, beats: tl.beats.map(b => ({ id: b.id, kind: b.kind, text: b.text, vo: b.vo, refs: b.refs })), data: tl.data, replay: tl.replay, slides: tl.slides, outputs: tl.outputs });

// A w x h grey frame: a checkerboard (sharp) or one flat value (soft).
function frame(w, h, fn) { const g = new Uint8Array(w * h); for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) g[y * w + x] = fn(x, y); return g; }

await test('pixels: grey downsamples RGBA, sharpness ranks focus, sceneChange spots a cut', () => {
  const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(255);
  for (let i = 0; i < 16; i += 1) { rgba[i * 4] = 0; rgba[i * 4 + 1] = 0; rgba[i * 4 + 2] = 0; }
  assert.deepEqual([...RP.grey(rgba, 4, 4, 2, 2)], [0, 0, 0, 0]);
  const sharp = frame(32, 18, (x, y) => ((x + y) % 2 ? 255 : 0));
  const soft = frame(32, 18, (x) => 100 + x);
  assert.ok(RP.sharpness(sharp, 32, 18) > RP.sharpness(soft, 32, 18) * 100, 'a checkerboard is far sharper than a ramp');
  assert.equal(RP.sharpness(null, 1, 1), 0);
  const black = frame(48, 27, () => 0);
  const white = frame(48, 27, () => 255);
  assert.equal(RP.sceneChange(black, black), 0);
  assert.equal(RP.sceneChange(black, white), 1);
  const m = RP.motionSeries([black, black, white, white]);
  assert.equal(m.length, 4);
  assert.equal(Math.max(...m), 1, 'normalised to the clip peak');
  assert.equal(m[1], 0);
});

// 24 samples over 3.2-9.8 s: calm and sharp early, a motion peak in the
// middle, a cut and a sharp crowd shot late, two blurred frames.
const SEG = { in: 3.2, out: 9.8 };
const SAMPLES = Array.from({ length: 24 }, (_, i) => {
  const t = Math.round((SEG.in + ((i + 0.5) * (SEG.out - SEG.in)) / 24) * 100) / 100;
  const motion = i === 12 ? 1 : (i > 8 && i < 16 ? 0.6 : 0.1 + (i % 3) * 0.05);
  return { t, motion, scene: i === 18 ? 0.8 : 0.05, sharp: i === 2 || i === 13 ? 2 : 200 + i * 3, jpeg: `data:image/jpeg;base64,${'A'.repeat(100)}${i}` };
});

await test('candidateFrames: 9 candidates, 3 per role in its own third, blurred frames dropped, the peak is the play', () => {
  const c = RP.candidateFrames(SAMPLES, { segment: SEG });
  assert.equal(c.candidates.length, 9);
  assert.deepEqual(c.candidates.map(x => x.role), ['setup', 'setup', 'setup', 'play', 'play', 'play', 'reaction', 'reaction', 'reaction']);
  c.candidates.forEach(x => {
    const third = c.thirds[RP.ROLES.indexOf(x.role)];
    assert.ok(x.t >= third.in - 0.01 && x.t <= third.out + 0.01, `${x.role} ${x.t} inside ${third.in}-${third.out}`);
    assert.ok(x.sharp > 10, 'no blurred candidate');
  });
  assert.equal(c.best.play.t, SAMPLES[12].t, 'the motion peak');
  assert.equal(c.best.reaction.t, SAMPLES[18].t, 'the cut after the peak');
  assert.ok(c.candidates.filter(x => x.role === 'setup').every(x => x.motion <= 0.2), 'setup frames are calm');
  assert.deepEqual(RP.codePick(c).map(f => f.role), ['setup', 'play', 'reaction']);
  assert.deepEqual(RP.candidateFrames([]).candidates, []);
});

await test('pickRequest: <= 9 frames under the 220 KB body cap, times in step', () => {
  const c = RP.candidateFrames(SAMPLES, { segment: SEG });
  const body = RP.pickRequest(c, { clipUrl: 'https://x.com/a/status/1', segment: SEG });
  assert.equal(body.mode, 'frame-pick');
  assert.equal(body.frames.length, 9);
  assert.equal(body.times.length, 9);
  assert.equal(body.budgetUsd, 0.02);
  const big = c.candidates.map(x => ({ ...x, jpeg: `data:image/jpeg;base64,${'B'.repeat(40000)}` }));
  const capped = RP.pickRequest(big, {});
  assert.ok(capped.frames.length < 9 && JSON.stringify(capped).length <= 220 * 1024, 'stays under the cap');
});

await test('applyPick: the fixture answer maps to frames and captions; bad answers fall back to the code pick', () => {
  const c = RP.candidateFrames(SAMPLES, { segment: SEG });
  const answer = fx('frame-pick.response.json');
  const ok = RP.applyPick(c, answer);
  assert.equal(ok.picker, 'ai');
  assert.deepEqual(ok.frames.map(f => f.role), ['setup', 'play', 'reaction']);
  assert.equal(ok.frames[1].t, c.candidates[answer.play].t);
  assert.equal(ok.frames[0].caption, 'The setup');
  assert.equal(ok.cost, 0.0016);
  ok.frames.forEach(f => assert.ok(f.caption.split(' ').length <= 6));
  const code = RP.codePick(c);
  for (const bad of [{ ...answer, play: 12 }, { ...answer, setup: -1 }, { ...answer, setup: 8, reaction: 0 }, { ok: false, status: 503 }, null]) {
    const r = RP.applyPick(c, bad);
    assert.equal(r.picker, 'code');
    assert.deepEqual(r.frames, code);
    assert.ok(r.errors.length);
  }
});

await test('scrubbers: one per panel, kept in order inside the segment, manual once moved', () => {
  const tl = fx('timeline-v2-replay.json');
  const m = RP.scrubberModel(tl.replay);
  assert.deepEqual(m.panels.map(p => [p.role, p.t]), [['setup', 3.6], ['play', 6.1], ['reaction', 9]]);
  assert.equal(m.panels[0].label, 'SETUP');
  const a = RP.scrub(m, 'play', 20);
  assert.equal(a.panels[1].t, 8.85, 'stops 0.15 s before the reaction');
  assert.equal(a.picker, 'manual');
  const b = RP.scrub(a, 'setup', 0);
  assert.equal(b.panels[0].t, 3.2, 'not before the segment');
  assert.equal(RP.scrub(b, 'nope', 4), b);
  assert.deepEqual(RP.framesOf(b).map(f => f.role), ['setup', 'play', 'reaction']);
  const v = T.validateTimeline({ ...tl, replay: { ...tl.replay, frames: RP.framesOf(b), picker: b.picker } });
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.equal(m.panels[0].t, 3.6, 'scrub never mutates');
});

await test('panelLayout: three panels inside the reel and slide safe areas, clear of the ES mark, Classic tilts', () => {
  for (const style of S.STYLE_IDS) {
    for (const cv of [T.CANVASES.reel, T.CANVASES.slide]) {
      const L = RP.panelLayout(style, cv);
      const safe = cv.safe;
      const mark = cv.h === 1350 ? R.SLIDE_MARK : R.ES_MARK;
      assert.equal(L.panels.length, 3);
      L.panels.forEach(p => {
        assert.ok(p.x >= safe.left && p.x + p.w <= safe.right && p.y >= safe.top && p.y + p.h <= safe.bottom, `${style} ${cv.h} ${p.role}`);
        assert.ok(p.y >= mark.y + mark.h + mark.clear, 'below the logo clear space');
      });
      assert.ok(L.panels[1].y - (L.panels[0].y + L.panels[0].h) === L.gutter);
    }
  }
  assert.ok(RP.panelLayout('classic', T.CANVASES.reel).panels.every(p => Math.abs(p.tilt) === 0.5));
  assert.ok(RP.panelLayout('series', T.CANVASES.reel).panels.every(p => p.tilt === 0));
});

await test('buildSlides: one 1080x1350 timeline per slide, each valid; default slides from the beats', () => {
  for (const name of ['timeline-v2-replay.json', 'timeline-v2-archive.json', 'timeline-v2-gameswing.json']) {
    const f = fx(name);
    const tl = R.buildTimeline(planOf(f), { style: f.style, assets: f.assets });
    const slides = R.buildSlides(tl);
    assert.ok(slides.length >= 3 && slides.length <= 20, name);
    assert.equal(slides[0].slide.kind, 'cover');
    assert.equal(slides.at(-1).slide.kind, 'cta');
    slides.forEach(s => {
      assert.deepEqual(s.canvas, { w: 1080, h: 1350 });
      const v = T.validateTimeline(s);
      assert.ok(v.ok, `${name} ${s.slide.id}: ${JSON.stringify(v.errors)}`);
    });
    if (f.slides.length) assert.deepEqual(slides.map(s => s.slide.kind), f.slides.map(s => s.kind), 'the project\'s own slides');
  }
  const gs = R.buildTimeline(planOf(fx('timeline-v2-gameswing.json')), { style: 'series' });
  assert.deepEqual(RP.defaultSlides(gs).map(s => s.kind), ['cover', 'data', 'data', 'cta']);
  assert.deepEqual(RP.slideFileNames(R.buildSlides(gs)), ['01-cover.png', '02-data.png', '03-data.png', '04-cta.png']);
});

await test('exportStills: every slide drawn settled into a PNG, zipped with the in-repo writer', async () => {
  const f = fx('timeline-v2-replay.json');
  const tl = R.buildTimeline(planOf(f), { style: 'classic', assets: f.assets });
  const slides = R.buildSlides(tl);
  let drawn = 0;
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === 'measureText' ? s => ({ width: String(s).length * 20 }) : (k === 'getImageData' ? undefined : () => { if (k === 'fillText') drawn += 1; return { addColorStop() {} }; }))), set: (t, k, v) => { t[k] = v; return true; } });
  let encoded = 0;
  const canvas = { width: 1080, height: 1350, getContext: () => ctx, convertToBlob: async () => { encoded += 1; return { arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, encoded]).buffer }; } };
  const progress = [];
  const out = await X.exportStills(slides, { R, Zip, canvas, env: { measure, images: {} }, onProgress: (a, b) => progress.push(`${a}/${b}`) });
  const bytes = out instanceof Uint8Array ? out : new Uint8Array(await out.arrayBuffer());
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b, 'a zip (PK)');
  const text = Buffer.from(bytes).toString('latin1');
  ['01-cover.png', '02-panel.png', '05-cta.png'].forEach(n => assert.ok(text.includes(n), n));
  assert.equal(encoded, slides.length);
  assert.ok(drawn > slides.length * 2, 'text drawn on every slide');
  assert.equal(progress.at(-1), `${slides.length}/${slides.length}`);
  await assert.rejects(() => X.exportStills([], { R, Zip, canvas }), /No slides/);
});

console.log(process.exitCode ? '\nReel replay tests failed.' : `\nAll ${passed} reel replay tests passed.`);
