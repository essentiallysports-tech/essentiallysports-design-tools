#!/usr/bin/env node
// Reels Studio v4 motion check (QA lane). Plays every reference reel
// (scripts/fixtures/reels4/reference-plans.json) through the real engine in
// headless Chrome, samples frames around every transition and across every
// beat, records the canvas draw calls (scripts/lib/reels4-frame-lab.js) and
// asserts the v4 motion system (contract: Motion system):
//   scale       the engine exposes its curves (out .2,.8,.2,1 / inOut .65,0,.35,1 / in .4,0,1,1,
//               spring) and the duration scale 160 / 240 / 400 / 640 ms
//   continuity  inside a chapter there are no cuts: at every beat boundary each element that is
//               drawn on both sides is in the same place (draw-call log, <= 3 px), the frame does not
//               jump (pixels, captions excluded), nothing teleports (> 200 px in one 16 ms step), and
//               an element moving into the boundary keeps its velocity (no retarget kink)
//   enters      every element enters: nothing (but a caption word) appears at full size and opacity
//               in one frame
//   easing      every measured move (position, size or opacity of a word or picture) is eased: not
//               linear, and close to one of the named curves (or a spring)
//   durations   every measured move lasts one step of the scale (+-1 frame)
//   wipe        each chapter change is a blue slab wipe of 640 ms on the inOut curve; during its
//               first half the uncovered picture is the outgoing chapter's last frame, during the
//               second half the uncovered picture is the incoming chapter's first frame, and the
//               wipe's end frame equals the next chapter's first frame (nothing jumps after it); the
//               ES mark stays on top
//   moves       every beat moves: no still stretch (captions aside) longer than REELS4_STILL_MS
//               (default 1200 ms); a beat with no clip (photo, cards, cut-out or a module only)
//               still animates by itself, without any video playback
// Frame sheets: REELS4_SHEETS=<dir> writes motion-<reel>.png (each wipe and each failing
// transition as a strip of frames, problems in red) and motion-<reel>.json.
// REELS4_ONLY=dallas,kittle limits reels. Run: node scripts/check-reels4-motion.mjs (skips without Chrome)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, findChrome, startServer, startChrome, sleep, figureSvg } from './_qa-chrome.mjs';

const CHROME = findChrome();
if (!CHROME) { console.log('reels4 motion: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('reels4 motion: skipped (needs Node with WebSocket)'); process.exit(0); }
const SHEETS = process.env.REELS4_SHEETS || '';
if (SHEETS) fs.mkdirSync(SHEETS, { recursive: true });
const STILL_MS = Number(process.env.REELS4_STILL_MS || 1200);
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/reels4/reference-plans.json'), 'utf8'));
const ONLY = (process.env.REELS4_ONLY || '').split(',').filter(Boolean);
const PLANS = FIX.plans.filter(p => !ONLY.length || ONLY.some(o => p.id.includes(o)));
const SCALE = [160, 240, 400, 640];
const CURVES = { out: [0.2, 0.8, 0.2, 1], inOut: [0.65, 0, 0.35, 1], in: [0.4, 0, 1, 1] };

const pageHtml = fs.readFileSync(path.join(ROOT, 'reel-maker.html'), 'utf8');
const srcs = [...pageHtml.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
const from = srcs.findIndex(s => /^frameup-rules\.js/.test(s));
const to = srcs.findIndex(s => /^reel-lint\.js/.test(s));
const ENGINE = from >= 0 && to > from ? srcs.slice(from, to + 1) : [];
if (!ENGINE.length) { console.log('reels4 motion: FAIL could not find the engine scripts in reel-maker.html'); process.exit(1); }
const MEDIA = {
  photo: { kind: 'photo', svg: () => figureSvg({ pose: 'bust', cutout: false, colour: '#203731', w: 1200, h: 1500 }) },
  cutout: { kind: 'photo', svg: () => figureSvg({ pose: 'stand', cutout: true, colour: '#AA0000', w: 900, h: 1200 }) },
  card: { kind: 'photo', svg: () => figureSvg({ pose: 'bust', cutout: false, colour: '#1D428A', w: 750, h: 1050 }) },
  'clip-game': { kind: 'clip', colour: '#203731', svg: () => figureSvg({ pose: 'stand', cutout: false, colour: '#203731', w: 1600, h: 900 }) },
  'clip-presser': { kind: 'clip', colour: '#241773', svg: () => figureSvg({ pose: 'bust', cutout: false, colour: '#241773', w: 1600, h: 900 }) },
};
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>reels4 motion</title>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Condensed:wght@700;800&display=swap" rel="stylesheet">
<style>body{margin:0;background:#fff}</style>
${ENGINE.map(s => `<script src="/${s}"></script>`).join('\n')}
</head><body></body></html>`;
const { server, base } = await startServer({
  extra: url => {
    if (url.pathname === '/__qa4/page.html') return { type: 'text/html', body: PAGE };
    const m = url.pathname.match(/^\/__qa4\/media\/([\w-]+)\.svg$/);
    if (m && MEDIA[m[1]]) return { type: 'image/svg+xml', body: MEDIA[m[1]].svg() };
    return null;
  },
});
const page = await startChrome(CHROME, { width: 1200, height: 1000 });
const cleanup = () => { page.close(); server.close(); };
const pageErrors = [];
page.on(m => { if (m.method === 'Runtime.exceptionThrown') pageErrors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]); });
await page.send('Page.enable'); await page.send('Runtime.enable');
await page.send('Page.navigate', { url: `${base}/__qa4/page.html` });
for (let i = 0; i < 100; i++) { await sleep(150); if (await page.evaluate(`document.readyState === 'complete' && Boolean(window.ReelRender && window.ReelES)`).catch(() => false)) break; }
if (!(await page.evaluate(`Boolean(window.ReelRender && window.ReelES)`).catch(() => false))) { console.log(`reels4 motion: FAIL the engine did not load (${pageErrors.slice(0, 3).join(' | ') || 'no error'})`); cleanup(); process.exit(1); }
await page.evaluate(fs.readFileSync(path.join(ROOT, 'scripts/lib/reels4-frame-lab.js'), 'utf8'));
await page.evaluate(`QA4.load(${JSON.stringify(Object.fromEntries(Object.entries(MEDIA).map(([k, v]) => [k, { kind: v.kind, colour: v.colour }])))})`);

// ─── In-page motion analysis ─────────────────────────────────────────────────
const MOTION = String.raw`(() => {
const Q = window.QA4;
const SCALE = ${JSON.stringify(SCALE)};
const CURVES = ${JSON.stringify(CURVES)};
const STILL_MS = ${STILL_MS};
const rb = b => b ? { l: Math.round(b.l), t: Math.round(b.t), r: Math.round(b.r), b: Math.round(b.b) } : null;
// Cubic bezier y(x) for a CSS curve.
function bezier([x1, y1, x2, y2]) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t, sy = t => ((ay * t + by) * t + cy) * t, dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => { let t = x; for (let i = 0; i < 8; i++) { const e = sx(t) - x; const d = dx(t); if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break; t -= e / d; } t = Math.max(0, Math.min(1, t)); return sy(t); };
}
const NAMED = Object.fromEntries(Object.entries(CURVES).map(([k, v]) => [k, bezier(v)]));

// Elements of one frame, keyed for matching across frames (captions apart).
function elements(log, voc, band) {
  const texts = Q.classify(log, voc, band);
  const out = new Map(); const seen = {};
  const put = (k, e) => { seen[k] = (seen[k] || 0) + 1; out.set(k + '#' + seen[k], e); };
  texts.filter(t => t.role !== 'caption').sort((a, b) => a.t - b.t || a.l - b.l).forEach(t => put('T:' + t.role + ':' + t.text, { kind: 'text', role: t.role, x: (t.l + t.r) / 2, y: (t.t + t.b) / 2, w: t.r - t.l, h: t.b - t.t, a: t.a, size: t.size, rot: t.rot, box: t }));
  log.filter(e => e.op === 'image' && !/logo:/.test(String(e.src))).forEach(e => put('I:' + e.src, { kind: 'image', src: e.src, x: (e.l + e.r) / 2, y: (e.t + e.b) / 2, w: e.r - e.l, h: e.b - e.t, a: e.a, time: e.time, crop: e.crop, box: e }));
  return { els: out, caps: texts.filter(t => t.role === 'caption') };
}
const sigOf = (els, withTime) => [...els.entries()].map(([k, e]) => k + ':' + [e.x, e.y, e.w, e.h].map(v => Math.round(v)).join(',') + ':' + Math.round(e.a * 50) + (e.crop ? ':' + e.crop.join(',') : '') + (withTime && e.time != null ? ':' + e.time : '')).join('|');

function maskNoCaption(band) { if (!band) return null; const y0 = band[0] / 5, y1 = band[1] / 5; return j => { const y = Math.floor(j / Q.SW); return y < y0 || y > y1; }; }

// A trajectory: [{t, e}] for one key. Motion segments per channel.
function segments(track) {
  const out = [];
  for (const ch of ['x', 'y', 'w', 'h', 'a']) {
    let i = 1;
    while (i < track.length) {
      const d = Math.abs(track[i].e[ch] - track[i - 1].e[ch]);
      const eps = ch === 'a' ? 0.01 : 0.6;
      if (d <= eps) { i++; continue; }
      let j = i;
      while (j + 1 < track.length && Math.abs(track[j + 1].e[ch] - track[j].e[ch]) > (ch === 'a' ? 0.002 : 0.25)) j++;
      const s0 = track[i - 1], s1 = track[j];
      const total = s1.e[ch] - s0.e[ch];
      const big = ch === 'a' ? Math.abs(total) >= 0.4 : Math.abs(total) >= 24;
      if (big && j - i >= 2) {
        const pts = track.slice(i - 1, j + 1).map(s => ({ t: s.t, p: (s.e[ch] - s0.e[ch]) / total }));
        out.push({ ch, t0: s0.t, t1: s1.t, total, pts });
      }
      i = j + 1;
    }
  }
  return out;
}
function judge(seg, step) {
  const T = seg.t1 - seg.t0;
  const xs = seg.pts.map(p => ({ x: (p.t - seg.t0) / T, p: p.p }));
  const linDev = Math.max(...xs.map(q => Math.abs(q.p - q.x)));
  const overshoot = Math.max(...xs.map(q => q.p)) > 1.03 || Math.min(...xs.map(q => q.p)) < -0.03;
  let best = null;
  for (const [k, f] of Object.entries(NAMED)) { const rms = Math.sqrt(xs.reduce((s, q) => s + (q.p - f(q.x)) ** 2, 0) / xs.length); if (!best || rms < best.rms) best = { k, rms }; }
  // The real duration: the move started up to one step before the first changed sample and ended by the last.
  const dur = T;
  const onScale = SCALE.find(s => Math.abs(s - dur) <= step + 10) || null;
  return { linear: !overshoot && linDev < 0.06 && xs.length >= 4, linDev: Math.round(linDev * 100) / 100, spring: overshoot, curve: best, dur: Math.round(dur), onScale };
}

function run(entry, opts) {
  const b = Q.build(entry, {});
  if (b.error) return { error: b.error };
  const { plan, info } = Q.current;
  const spec = Q.motionSpec();
  const fails = []; const notes = []; const strips = [];
  const fail = (rule, msg, extra = {}) => fails.push({ rule, msg, ...extra });
  // Scale and curves the engine exposes.
  const want = { out: CURVES.out, inOut: CURVES.inOut, in: CURVES.in };
  for (const [k, v] of Object.entries(want)) { const got = spec.curves[k]; if (!got) fail('scale', 'the engine exposes no "' + k + '" curve (ReelES.ease.' + k + ')'); else if (Array.isArray(got) && got.some((x, i) => Math.abs(x - v[i]) > 1e-3)) fail('scale', 'ease.' + k + ' is ' + got.join(',') + ' (contract ' + v.join(',') + ')'); }
  if (!spec.spring) fail('scale', 'the engine exposes no spring (ReelES.spring k 300, d 26)');
  else if (typeof spec.spring === 'object' && (Number(spec.spring.k || spec.spring.stiffness) !== 300 || Number(spec.spring.d || spec.spring.damping) !== 26)) fail('scale', 'spring is ' + JSON.stringify(spec.spring) + ' (contract k 300, d 26)');
  if (!spec.durations) fail('scale', 'the engine exposes no duration scale');
  else if (spec.durations.join() !== SCALE.join()) fail('scale', 'duration scale ' + spec.durations.join('/') + ' (contract ' + SCALE.join('/') + ')');

  // Caption band (captions are excluded from motion signatures and pixel continuity).
  const ys = [];
  for (const bt of info.beats) { const voc = Q.vocabFor(plan, bt.id); for (let t = bt.inMs + 300; t < bt.outMs; t += 600) { Q.frame(t).log.filter(e => e.op === 'text' && Q.within(voc.vo, e.text) && !Q.within(voc.headline, e.text) && !Q.within(voc.module, e.text)).forEach(e => ys.push((e.t + e.b) / 2)); } }
  ys.sort((a, c) => a - c);
  const band = ys.length ? [ys[Math.floor(ys.length / 2)] - 110, ys[Math.floor(ys.length / 2)] + 110] : null;
  const keep = maskNoCaption(band);
  const beatOf = t => info.beats.find(x => x.inMs <= t && t < x.outMs) || info.beats[info.beats.length - 1];
  const vocAt = t => Q.vocabFor(plan, (beatOf(t) || {}).id);
  const thumb = { w: 108, h: 192 };

  // ── Beat boundaries inside a chapter: no cuts. ──
  const moves = [];
  const transitions = [];
  for (let i = 1; i < info.beats.length; i++) {
    const a = info.beats[i - 1], c = info.beats[i];
    if (!a.chapterId || a.chapterId !== c.chapterId) continue;
    transitions.push({ kind: 'beat', t: c.inMs, from: a.id, to: c.id });
  }
  for (const tr of transitions) {
    const tb = tr.t;
    const f0 = Q.frame(tb - 1, { pixels: true }), f1 = Q.frame(tb + 1, { pixels: true });
    const e0 = elements(f0.log, vocAt(tb - 1), band).els, e1 = elements(f1.log, vocAt(tb + 1), band).els;
    const bad = [];
    for (const [k, x] of e0) { const y = e1.get(k); if (!y) continue; const d = Math.hypot(x.x - y.x, x.y - y.y), dw = Math.abs(x.w - y.w) + Math.abs(x.h - y.h), da = Math.abs(x.a - y.a); if (d > 3 || dw > 4 || da > 0.15) bad.push(k.replace(/#\d+$/, '') + ' jumps ' + Math.round(d) + ' px / size ' + Math.round(dw) + ' / alpha ' + da.toFixed(2)); }
    const pd = Q.diff(f0.px, f1.px, keep);
    if (pd.mean > 4 || pd.share > 0.04) bad.push('the frame cuts: ' + (pd.share * 100).toFixed(1) + '% of pixels change in 2 ms (mean ' + pd.mean.toFixed(1) + ')');
    // Window: teleports, pop-ins, velocity kinks; collect moves for easing/durations.
    const step = 16;
    const tracks = new Map(); let prev = null;
    const ts = []; for (let t = tb - 48; t <= tb + 800; t += step) ts.push(t);
    const fr = [];
    for (const t of ts) {
      const f = Q.frame(t);
      const { els } = elements(f.log, vocAt(t), band);
      for (const [k, e] of els) { if (!tracks.has(k)) tracks.set(k, []); tracks.get(k).push({ t, e }); }
      if (prev) for (const [k, e] of els) {
        const p = prev.get(k);
        if (p && Math.hypot(p.x - e.x, p.y - e.y) > 200) bad.push(k.replace(/#\d+$/, '') + ' teleports ' + Math.round(Math.hypot(p.x - e.x, p.y - e.y)) + ' px in ' + step + ' ms @' + t);
        if (!p && t > tb && e.a > 0.9 && e.kind === 'text' && e.role !== 'stamp') { const later = Q.frame(t + 400); const L2 = elements(later.log, vocAt(t + 400), band).els.get(k); if (L2 && Math.abs(L2.size - e.size) < 0.5 && Math.abs(L2.y - e.y) < 1 && Math.abs(L2.x - e.x) < 1) bad.push(k.replace(/#\d+$/, '') + ' appears at full size and opacity @' + t + ' (no entrance)'); }
      }
      prev = els;
    }
    for (const [k, tr2] of tracks) {
      // Velocity kink at the boundary: moving in, then a different speed out.
      const at = i => tr2.find(s => s.t === i);
      const bm = at(tb - 32), b0 = at(tb - 16), a0 = at(tb), a1 = at(tb + 16);
      if (bm && b0 && a0 && a1) { const v0 = Math.hypot(b0.e.x - bm.e.x, b0.e.y - bm.e.y) / 16, v1 = Math.hypot(a1.e.x - a0.e.x, a1.e.y - a0.e.y) / 16; if (v0 > 0.5 && Math.abs(v1 - v0) > 0.5 * v0) bad.push(k.replace(/#\d+$/, '') + ' changes speed at the boundary (' + v0.toFixed(2) + ' -> ' + v1.toFixed(2) + ' px/ms)'); }
      segments(tr2).forEach(s => moves.push({ key: k.replace(/#\d+$/, ''), at: tr.to, ...s, ...judge(s, step) }));
    }
    tr.bad = [...new Set(bad)];
    if (tr.bad.length) {
      tr.bad.forEach(m => fail('continuity', tr.from + ' -> ' + tr.to + ' @' + tb + ' ms: ' + m));
      strips.push({ label: 'beat ' + tr.from + ' -> ' + tr.to + ' @' + tb + ' ms', frames: [tb - 200, tb - 1, tb + 1, tb + 80, tb + 160, tb + 400, tb + 700].map(t => { const f = Q.frame(t, { thumb }); return { thumb: f.thumb, note: (t - tb) + ' ms', bad: t === tb + 1 }; }) });
    }
  }

  // ── Chapter wipes. ──
  const wipes = [];
  for (let i = 1; i < info.chapters.length; i++) {
    const ch = info.chapters[i], prevCh = info.chapters[i - 1];
    let w = info.wipes.find(x => x.to === ch.id) || info.wipes.find(x => x.inMs <= ch.inMs + 20 && x.outMs >= ch.inMs - 20);
    const base0 = Q.blueShare(Q.frame(ch.inMs - 1500, { pixels: true }).px), base1 = Q.blueShare(Q.frame(ch.inMs + 1500, { pixels: true }).px);
    const cov = [];
    for (let t = ch.inMs - 1000; t <= ch.inMs + 1000; t += 16) { const f = Q.frame(t, { pixels: true }); cov.push({ t, c: Q.blueShare(f.px) - Math.max(base0, base1) }); }
    const on = cov.filter(x => x.c > 0.02);
    const found = on.length ? { inMs: on[0].t - 8, outMs: on[on.length - 1].t + 8 } : null;
    if (!w && found) w = { ...found, detected: true };
    if (!w) { fail('wipe', prevCh.id + ' -> ' + ch.id + ' @' + ch.inMs + ' ms: no blue slab wipe (no ES-blue cover found within 1 s of the chapter change)'); strips.push({ label: 'no wipe ' + prevCh.id + ' -> ' + ch.id, frames: [-500, -250, -1, 1, 250, 500].map(d => { const f = Q.frame(ch.inMs + d, { thumb }); return { thumb: f.thumb, note: d + ' ms', bad: true }; }) }); continue; }
    const dur = w.outMs - w.inMs;
    const peak = Math.max(...cov.map(x => x.c));
    const rec = { from: prevCh.id, to: ch.id, inMs: w.inMs, outMs: w.outMs, dur, detected: Boolean(w.detected), peakCover: Math.round(peak * 100) };
    if (Math.abs(dur - 640) > 40) fail('wipe', prevCh.id + ' -> ' + ch.id + ': the wipe lasts ' + dur + ' ms (contract 640 ms)');
    if (peak < 0.6) fail('wipe', prevCh.id + ' -> ' + ch.id + ': the slab covers at most ' + Math.round(peak * 100) + '% of the frame (it should cover the frame at its middle)');
    // Coverage curve: up then down; neither half linear.
    const mid = w.inMs + dur / 2;
    for (const [h0, h1, name] of [[w.inMs, mid, 'in'], [mid, w.outMs, 'out']]) {
      const pts = cov.filter(x => x.t >= h0 && x.t <= h1);
      if (pts.length >= 5) { const c0 = pts[0].c, c1 = pts[pts.length - 1].c; if (Math.abs(c1 - c0) > 0.2) { const dev = Math.max(...pts.map(p => Math.abs((p.c - c0) / (c1 - c0) - (p.t - h0) / (h1 - h0)))); rec['lin_' + name] = Math.round(dev * 100) / 100; if (dev < 0.05) fail('wipe', prevCh.id + ' -> ' + ch.id + ': the slab moves ' + name + ' linearly (max deviation from linear ' + dev.toFixed(3) + '; contract inOut)'); } }
    }
    // Under the slab: outgoing frozen on the first half, incoming first frame on the second half.
    const out0 = Q.frame(w.inMs - 1, { pixels: true }).px;
    const endF = Q.frame(w.outMs + 1, { pixels: true }).px;
    const after = Q.frame(w.outMs + 34, { pixels: true }).px;
    const bad = [];
    for (let t = w.inMs + 16; t < w.outMs; t += 32) {
      const f = Q.frame(t, { pixels: true });
      const m = Q.blueMask(f.px);
      const ref = t < mid ? out0 : endF;
      const refM = Q.blueMask(ref);
      const d = Q.diff(f.px, ref, j => !m[j] && !refM[j] && (!keep || keep(j)));
      if (d.n > Q.SW * Q.SH * 0.04 && (d.mean > 5 || d.share > 0.05)) bad.push('@' + t + ' (' + (t < mid ? 'first half: outgoing' : 'second half: incoming') + ' picture differs from the ' + (t < mid ? 'last frame before the wipe' : 'wipe end frame') + ', ' + (d.share * 100).toFixed(1) + '% px, mean ' + d.mean.toFixed(1) + ')');
      if (!Q.markIn(Q.frame(t).log)) bad.push('@' + t + ' the ES mark is hidden by the wipe');
    }
    const j = Q.diff(endF, after, keep);
    if (j.mean > 4 || j.share > 0.04) bad.push('the frame jumps right after the wipe (' + (j.share * 100).toFixed(1) + '% px change in 33 ms): the wipe did not end on the next chapter\'s first frame');
    // The engine's own head frame of the next chapter, when it can draw one without the wipe.
    rec.bad = [...new Set(bad)];
    rec.bad.forEach(m => fail('wipe', prevCh.id + ' -> ' + ch.id + ': ' + m));
    wipes.push(rec);
    const tsW = [w.inMs - 120, w.inMs + dur * 0.15, w.inMs + dur * 0.35, mid, w.inMs + dur * 0.65, w.inMs + dur * 0.85, w.outMs + 1, w.outMs + 120].map(Math.round);
    strips.push({ label: 'wipe ' + prevCh.id + ' -> ' + ch.id + ' (' + dur + ' ms' + (w.detected ? ', found from pixels' : '') + ')' + (rec.bad.length ? ' · ' + rec.bad.length + ' problem(s)' : ''), frames: tsW.map(t => { const f = Q.frame(t, { thumb }); return { thumb: f.thumb, note: (t - w.inMs) + ' ms', bad: rec.bad.length > 0 && t >= mid }; }) });
  }

  // ── Every beat moves; a beat with no clip still animates. ──
  const stills = [];
  for (const bt of info.beats) {
    const beat = Q.beatsOf(plan).find(x => x.id === bt.id);
    const voc = Q.vocabFor(plan, bt.id);
    const kind = beat && beat.media ? beat.media.kind : 'none';
    const hasClip = kind === 'clip' || kind === 'presser';
    let run = 0, worst = 0, worstAt = bt.inMs, prevAll = null, prevOwn = null, runOwn = 0, worstOwn = 0, worstOwnAt = bt.inMs, anyOwn = false;
    const s0 = bt.inMs + 80, s1 = bt.outMs - 40;
    for (let t = s0; t < s1; t += 100) {
      const { els } = elements(Q.frame(t).log, voc, band);
      const all = sigOf(els, true), own = sigOf(els, false);
      if (prevAll !== null) { if (all === prevAll) { run += 100; if (run > worst) { worst = run; worstAt = t - run; } } else run = 0; if (own === prevOwn) { runOwn += 100; if (runOwn > worstOwn) { worstOwn = runOwn; worstOwnAt = t - runOwn; } } else { runOwn = 0; anyOwn = true; } }
      prevAll = all; prevOwn = own;
    }
    const rec = { beat: bt.id, kind, durMs: bt.outMs - bt.inMs, stillMs: worst, stillAt: worstAt, ownStillMs: worstOwn, moves: anyOwn };
    stills.push(rec);
    if (worst > STILL_MS) { fail('moves', bt.id + ' (' + kind + '): nothing moves for ' + worst + ' ms from ' + worstAt + ' ms (captions aside; max ' + STILL_MS + ')'); strips.push({ label: 'still ' + bt.id + ' (' + kind + ') ' + worst + ' ms', frames: [0, 0.25, 0.5, 0.75, 1].map(k => { const t = Math.round(worstAt + worst * k); const f = Q.frame(t, { thumb }); return { thumb: f.thumb, note: t + ' ms', bad: true }; }) }); }
    if (!hasClip && worstOwn > STILL_MS) fail('moves', bt.id + ' has no clip (' + kind + ') and does not animate by itself for ' + worstOwn + ' ms from ' + worstOwnAt + ' ms (Ken Burns or a module must move)');
    if (!hasClip && !anyOwn) fail('moves', bt.id + ' has no clip (' + kind + ') and never animates after it lands');
  }

  // ── Beat entrances (the first 900 ms of every beat): easing and durations. ──
  for (const bt of info.beats) {
    const voc = Q.vocabFor(plan, bt.id);
    const tracks = new Map();
    for (let t = bt.inMs; t <= Math.min(bt.outMs - 1, bt.inMs + 900); t += 16) { const { els } = elements(Q.frame(t).log, voc, band); for (const [k, e] of els) { if (!tracks.has(k)) tracks.set(k, []); tracks.get(k).push({ t, e }); } }
    for (const [k, tr2] of tracks) segments(tr2).forEach(s => { if (!moves.some(m => m.key === k.replace(/#\d+$/, '') && m.ch === s.ch && Math.abs(m.t0 - s.t0) < 20)) moves.push({ key: k.replace(/#\d+$/, ''), at: bt.id, ...s, ...judge(s, 16) }); });
  }
  const isKB = m => /^I:/.test(m.key) && m.t1 - m.t0 > 900;
  for (const m of moves) {
    const where = m.at + ' ' + m.key.slice(0, 40) + ' ' + m.ch + ' @' + m.t0 + '-' + m.t1 + ' ms';
    if (m.linear) fail('easing', where + ': linear (max deviation ' + m.linDev + ')' + (isKB(m) ? ' [Ken Burns]' : ''));
    else if (!m.spring && m.curve && m.curve.rms > 0.12 && !isKB(m)) notes.push(where + ': not close to a named curve (best ' + m.curve.k + ', rms ' + m.curve.rms.toFixed(3) + ')');
    if (!m.spring && !isKB(m) && !m.onScale) fail('durations', where + ': lasts ~' + m.dur + ' ms (scale ' + SCALE.join('/') + ')');
  }
  return { v: b.v, durationMs: b.durationMs, chapters: info.chapters.length, beats: info.beats.length, band, wipes, transitions: transitions.map(t => ({ ...t })), moves: moves.map(m => ({ key: m.key, at: m.at, ch: m.ch, t0: m.t0, t1: m.t1, dur: m.dur, linear: m.linear, linDev: m.linDev, spring: m.spring, curve: m.curve, onScale: m.onScale })), stills, fails, notes, sheet: opts.sheet && strips.length ? Q.sheet(strips.slice(0, 24), 'reels4 motion · ' + entry.label) : '' };
}
window.QA4M = { run };
return true;
})()`;
await page.evaluate(MOTION);

const failures = []; const notes = []; const summary = [];
for (const entry of PLANS) {
  const t0 = Date.now();
  const r = await page.evaluate(`QA4M.run(${JSON.stringify(entry)}, { sheet: ${Boolean(SHEETS)} })`).catch(e => ({ error: e.message }));
  const tag = `${entry.id}/${entry.plan.esStyle}`;
  if (r.error) { failures.push(`${tag}: ${r.error}`); continue; }
  if (r.v !== 4) failures.push(`${tag}: the timeline is not v4 (tl.v ${r.v})`);
  const byRule = {};
  for (const f of r.fails) { byRule[f.rule] = (byRule[f.rule] || 0) + 1; failures.push(`${tag} [${f.rule}] ${f.msg}`); }
  for (const n of r.notes) notes.push(`${tag} ${n}`);
  const lin = r.moves.filter(m => m.linear).length;
  summary.push(`${tag}: ${r.chapters} chapters, ${r.beats} beats, ${(r.durationMs / 1000).toFixed(1)} s; ${r.transitions.length} beat transitions, ${r.wipes.length} wipes (${r.wipes.map(w => w.dur + 'ms' + (w.detected ? '*' : '')).join(' ')}), ${r.moves.length} moves measured (${lin} linear, ${r.moves.filter(m => !m.onScale && !m.spring).length} off-scale), longest still ${Math.max(0, ...r.stills.map(s => s.stillMs))} ms; ${JSON.stringify(byRule)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (SHEETS) {
    if (r.sheet) fs.writeFileSync(path.join(SHEETS, `motion-${entry.id}.png`), Buffer.from(r.sheet.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(SHEETS, `motion-${entry.id}.json`), JSON.stringify({ ...r, sheet: undefined }, null, 2));
  }
}
if (pageErrors.length) failures.push(...[...new Set(pageErrors)].slice(0, 5).map(e => `page error: ${e}`));
cleanup();
for (const s of summary) console.log(s);
if (process.env.REELS4_NOTES) for (const n of [...new Set(notes)]) console.log(`note ${n}`);
const uniq = [...new Set(failures)];
for (const f of uniq.slice(0, 300)) console.log(`FAIL ${f}`);
if (uniq.length > 300) console.log(`... ${uniq.length - 300} more`);
console.log(`reels4 motion: ${PLANS.length} reels, ${uniq.length} failures, ${notes.length} notes${SHEETS ? `; sheets in ${SHEETS}` : ''}`);
process.exit(uniq.length ? 1 : 0);
