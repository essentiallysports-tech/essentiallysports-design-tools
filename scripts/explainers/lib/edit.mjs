// The edit: turns a recorded timeline into what the encoder plays.
//   - Dead time is trimmed: a stretch with no voice, no cursor, no click and no
//     visible change (frame diffs from compose.html analyze()) that runs past
//     IDLE_MAX is shortened to IDLE_KEEP. A wait (Recorder.waitFor) that only
//     shows a spinner or progress bar is sped up to at most WAIT_KEEP.
//   - Chapter breaks get a short hold (the picture freezes under a title).
//   - The camera: zooms in (1.3-1.6x, up to 1.8x for small targets) on what is
//     being clicked or typed into, pans between nearby steps, eases back out
//     between steps. A critically damped spring keeps every move smooth.
//   - Captions: each line is split into short chunks timed to the voice, and
//     placed in the lower third unless the zoomed area is there.
// All times in ms. Source = recorded time, output = edited time.
export const IDLE_MAX = 1200, IDLE_KEEP = 500, WAIT_KEEP = 1200, HOLD = 1500;
export const W = 1920, H = 1080;
export const APP = { w: 1440, h: 900 };
export const ANCHOR = { x: 960, y: 486 }; // where the app centre sits in the wide shot
export const WIDE = { s: 1, fx: 720, fy: 450 };
const FOCUS_Y = 430; // zoomed targets sit here (clear of the lower-third captions)
export const CAPTION_TOP = 900; // the lower-third band starts here

// ── Intervals ───────────────────────────────────────────────────────────────
function merge(list, join = 0) {
  const s = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + join) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}
function complement(busy, from, to) {
  const out = []; let at = from;
  for (const [a, b] of busy) { if (a > at) out.push([at, Math.min(a, to)]); at = Math.max(at, b); if (at >= to) break; }
  if (at < to) out.push([at, to]);
  return out.filter(([a, b]) => b > a);
}

// ── Segments: source <-> output ─────────────────────────────────────────────
// changes: source times (ms) where the picture visibly changed.
export function buildEdit(tl, changes = []) {
  const D = tl.duration;
  const hard = merge([
    ...tl.captions.map(c => [c.t - 250, c.t + c.dur * 1000 + 350]),
    ...tl.clicks.map(c => [c.t - 350, c.t + 600]),
    ...movingSpans(tl.track),
    ...(tl.focus || []).filter(f => f.kind === 'type').map(f => [f.t - 200, f.t + 400]),
    [0, 400], [D - 600, D],
  ], 0);
  const soft = merge(changes.map(t => [t - 160, t + 160]), 380);
  const waits = merge((tl.waits || []).map(w => [w.from, w.to]), 0);
  const inWait = (a, b) => waits.some(([x, y]) => a >= x - 50 && b <= y + 400);
  const pieces = []; // [a, b, outLen]
  let at = 0;
  for (const [a, b] of complement(hard, 0, D)) {
    if (a > at) pieces.push([at, a, a - at]);
    // Inside a gap: idle (no change) stretches and spinner-only waits shrink.
    let p = a;
    const live = soft.filter(([x, y]) => y > a && x < b).map(([x, y]) => [Math.max(a, x), Math.min(b, y)]);
    const parts = [];
    for (const [x, y] of live) { if (x > p) parts.push([p, x, false]); parts.push([x, y, true]); p = y; }
    if (p < b) parts.push([p, b, false]);
    // Fold short live bits inside a wait into one sped-up run.
    for (const [x, y, changing] of parts) {
      const len = y - x;
      if (!changing && len > IDLE_MAX) pieces.push([x, y, IDLE_KEEP]);
      else if (changing && len > WAIT_KEEP * 1.25 && inWait(x, y)) pieces.push([x, y, WAIT_KEEP]);
      else pieces.push([x, y, len]);
    }
    at = b;
  }
  if (at < D) pieces.push([at, D, D - at]);
  // Coalesce neighbours inside one wait so a long spinner wait (idle + live
  // bits) collapses to one short sped-up run, not many.
  const merged = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && last[2] < last[1] - last[0] && p[2] < p[1] - p[0] && inWait(last[0], p[1])) { last[1] = p[1]; last[2] = Math.min(WAIT_KEEP, last[2] + p[2]); }
    else merged.push([...p]);
  }
  // Chapters: a hold (source frozen) at the chapter time.
  // (Not right after the title card: that already says what this is.)
  const holds = (tl.chapters || []).filter(c => c.t > 2000).map(c => ({ t: c.t, label: c.label })).sort((x, y) => x.t - y.t);
  const segs = []; let o = 0;
  const push = (s0, s1, len, extra = {}) => { if (len <= 0 && s1 <= s0) return; segs.push({ s0, s1, o0: o, o1: o + len, ...extra }); o += len; };
  for (const [a, b, len] of merged) {
    let s = a, outLeft = len;
    for (const h of holds) {
      if (h.t < a || h.t >= b || h.done) continue;
      const frac = (h.t - s) / (b - s);
      const l = Math.round(outLeft * frac);
      push(s, h.t, l); outLeft -= l; s = h.t;
      push(h.t, h.t, HOLD, { hold: h.label }); h.done = true;
    }
    push(s, b, outLeft);
  }
  for (const h of holds) if (!h.done) push(D, D, HOLD, { hold: h.label });
  return { segs, duration: o };
}

function movingSpans(track) {
  const out = [];
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i];
    if (b.t - a.t < 80 && Math.hypot(b.x - a.x, b.y - a.y) > 0.5) out.push([a.t - 120, b.t + 120]);
  }
  return merge(out, 60);
}

export function toOut(edit, s) {
  const { segs } = edit;
  for (const g of segs) {
    if (s < g.s0) return g.o0;
    if (s <= g.s1 && g.s1 > g.s0) return g.o0 + (s - g.s0) / (g.s1 - g.s0) * (g.o1 - g.o0);
    if (g.s1 === g.s0 && s === g.s0) return g.o0;
  }
  return edit.duration;
}
export function toSrc(edit, o) {
  for (const g of edit.segs) {
    if (o <= g.o1) return g.o1 === g.o0 ? g.s0 : g.s0 + (Math.max(0, o - g.o0)) / (g.o1 - g.o0) * (g.s1 - g.s0);
  }
  const last = edit.segs[edit.segs.length - 1];
  return last ? last.s1 : 0;
}

// ── Camera ──────────────────────────────────────────────────────────────────
// A zoom for a box (app px): fit it in the area above the captions.
function zoomFor(b) {
  const fit = Math.min((W * 0.7) / Math.max(1, b.w), ((CAPTION_TOP - 60) * 0.85) / Math.max(1, b.h));
  return fit;
}
export function cameraFor(s, cx, cy) {
  // Put (cx, cy) at (960, FOCUS_Y), then keep the app covering the frame
  // (horizontally always; vertically the bottom may rise to the caption band).
  let fx = cx;
  let fy = cy - (FOCUS_Y - ANCHOR.y) / s;
  const clamp = (v, lo, hi) => lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
  fx = clamp(fx, ANCHOR.x / s, APP.w - (W - ANCHOR.x) / s);
  fy = clamp(fy, ANCHOR.y / s, APP.h - (CAPTION_TOP - 40 - ANCHOR.y) / s);
  return { s, fx, fy };
}
// Shots: focus events grouped (same caption, close in time, fit together).
export function shots(tl) {
  const ev = (tl.focus || []).slice().sort((a, b) => a.t - b.t);
  const capAt = t => { let i = -1; for (let k = 0; k < tl.captions.length; k++) if (tl.captions[k].t <= t + 200) i = k; return i; };
  const clickAfter = t => tl.clicks.find(c => c.t >= t && c.t - t < 2500);
  // A shot holds while the narrator talks about it (to the end of the line).
  const voiceEnd = t => { const i = capAt(t); const c = tl.captions[i]; return c && t <= c.t + c.dur * 1000 + 300 ? c.t + c.dur * 1000 + 450 : 0; };
  const endOf = e => Math.max(e.kind === 'click' ? (clickAfter(e.t)?.t ?? e.t + 900) + 1000 : e.kind === 'type' ? e.t + 1200 : e.t + 2200, voiceEnd(e.t));
  const out = [];
  let cur = null;
  const close = (until = Infinity) => { if (cur) { cur.end = Math.min(cur.end, until); out.push(cur); } cur = null; };
  for (const e of ev) {
    if (e.kind === 'wide') { close(e.t); continue; }
    const box = { x: e.x, y: e.y, w: e.w, h: e.h };
    if (cur) {
      const u = union(cur.box, box);
      const sameStep = capAt(e.t) === cur.cap;
      if (sameStep && e.t - cur.end < 1400 && zoomFor(u) >= 1.3) { cur.box = u; cur.end = Math.max(cur.end, endOf(e)); cur.events.push(e); continue; }
      close(e.t + 100);
    }
    cur = { start: e.t - 150, end: endOf(e), box, cap: capAt(e.t), events: [e], at: e.at, zoom: e.zoom };
  }
  close();
  for (const sh of out) {
    let s = zoomFor(sh.box);
    let cx = sh.box.x + sh.box.w / 2, cy = sh.box.y + sh.box.h / 2;
    if (sh.zoom) s = sh.zoom;
    else if (s < 1.3) {
      // A little too big: a gentle 1.3x still shows nearly all of it. Much
      // too big: a gentle zoom on the pointer for a click, else stay wide.
      if (s >= 0.95) s = 1.3;
      else if (sh.events.length === 1 && sh.at && (sh.events[0].kind === 'click' || sh.events[0].kind === 'type')) { s = 1.3; cx = sh.at.x; cy = sh.at.y; }
      else s = 1;
    }
    sh.s = Math.min(1.8, s > 1.6 && sh.box.w > 260 ? 1.6 : s);
    sh.cam = sh.s <= 1.01 ? { ...WIDE } : cameraFor(sh.s, cx, cy);
  }
  return out.filter(sh => sh.s > 1.01);
}
function union(a, b) { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; }

// The camera path in output time, sampled every `step` ms.
export function cameraPath(tl, edit, { step = 1000 / 60, lead = 380, omega = 10 } = {}) {
  const sh = shots(tl);
  // Between steps the camera eases back out (at least BREATHE ms wide) when
  // the next shot is somewhere else; within a step, or to a nearby spot, it pans.
  const BREATHE = 1100;
  for (let i = 1; i < sh.length; i++) {
    const a = sh[i - 1], b = sh[i];
    const far = Math.hypot(a.cam.fx - b.cam.fx, a.cam.fy - b.cam.fy) > 260 || Math.abs(a.s - b.s) > 0.35;
    if (a.cap !== b.cap && far) a.end = Math.max(a.start + 900, Math.min(a.end, b.start - BREATHE));
    else if (b.start - a.end < BREATHE) a.end = b.start;
  }
  const holds = edit.segs.filter(g => g.hold);
  const want = o => {
    if (holds.some(g => o >= g.o0 - 400 && o <= g.o1 + 150)) return WIDE;
    const s = toSrc(edit, o + lead);
    const hit = sh.find(x => s >= x.start && s <= x.end);
    return hit ? hit.cam : WIDE;
  };
  const n = Math.ceil(edit.duration / step) + 1;
  const out = new Array(n);
  // Two critically damped springs in a row: the move starts gently, glides,
  // and settles with no overshoot (an S-curve, like a camera operator).
  const mk = () => ({ ls: 0, fx: WIDE.fx, fy: WIDE.fy });
  const s1 = mk(), v1 = { ls: 0, fx: 0, fy: 0 }, st = mk(), v = { ls: 0, fx: 0, fy: 0 };
  const dt = step / 1000;
  for (let i = 0; i < n; i++) {
    const w = want(i * step);
    const target = { ls: Math.log(w.s), fx: w.fx, fy: w.fy };
    for (const k of ['ls', 'fx', 'fy']) {
      const a1 = omega * omega * (target[k] - s1[k]) - 2 * omega * v1[k];
      v1[k] += a1 * dt; s1[k] += v1[k] * dt;
      const a = omega * omega * (s1[k] - st[k]) - 2 * omega * v[k];
      v[k] += a * dt; st[k] += v[k] * dt;
    }
    out[i] = [Math.round(Math.exp(st.ls) * 1000) / 1000, Math.round(st.fx * 10) / 10, Math.round(st.fy * 10) / 10];
  }
  return { step, samples: out, shots: sh.map(x => ({ start: x.start, end: x.end, s: x.s, box: x.box, cap: x.cap })) };
}
export function camAt(path, o) {
  const i = Math.max(0, Math.min(path.samples.length - 1, Math.round(o / path.step)));
  const [s, fx, fy] = path.samples[i];
  return { s, fx, fy };
}
// App px -> screen px for a camera.
export const toScreen = (cam, x, y) => ({ x: (x - cam.fx) * cam.s + ANCHOR.x, y: (y - cam.fy) * cam.s + ANCHOR.y });

// ── Captions ────────────────────────────────────────────────────────────────
// Short chunks (at most two lines of ~40 characters), split at sentence and
// clause breaks, timed by length across the voice line.
export function chunkText(text, max = 64) {
  const sentences = text.match(/[^.!?]+[.!?]+["’”]?|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) || [text];
  const out = [];
  for (const s of sentences) {
    if (s.length <= max) { out.push(s); continue; }
    // Split long sentences at a comma / colon / dash nearest the middle.
    const parts = s.split(/(?<=[,:;—])\s+/);
    let cur = '';
    for (const p of parts) {
      if (cur && (cur + ' ' + p).length > max) { out.push(cur); cur = p; } else cur = cur ? cur + ' ' + p : p;
    }
    if (cur) out.push(cur);
  }
  // Join tiny neighbours ("Done." + "The names are ready.").
  const joined = [];
  for (const c of out) {
    const last = joined[joined.length - 1];
    if (last && (last.length < 18 || c.length < 14) && (last + ' ' + c).length <= max) joined[joined.length - 1] = last + ' ' + c; else joined.push(c);
  }
  return joined;
}
// Caption cues in output time: [{ from, to, text, pos: 'bottom' | 'top' }].
export function captionCues(tl, edit, cam) {
  const cues = [];
  tl.captions.forEach((c, i) => {
    const start = toOut(edit, c.t);
    const voiceEnd = toOut(edit, c.t + c.dur * 1000);
    const next = tl.captions[i + 1] ? toOut(edit, tl.captions[i + 1].t) : edit.duration;
    // Off before the next caption, and before a chapter card comes up.
    const hold = edit.segs.find(g => g.hold && g.o0 >= voiceEnd - 50);
    const end = Math.min(next - 60, voiceEnd + 900, hold ? Math.max(voiceEnd, hold.o0 - 480) : Infinity);
    const chunks = chunkText(c.text);
    const total = chunks.reduce((n, x) => n + x.length, 0);
    let at = start;
    chunks.forEach((text, k) => {
      const share = (voiceEnd - start) * text.length / total;
      const to = k === chunks.length - 1 ? end : at + share;
      cues.push({ from: Math.round(at), to: Math.round(to), text, step: i + 1 });
      at += share;
    });
  });
  // Lower third, unless the zoomed-in target would sit under it.
  for (const q of cues) {
    let low = true;
    if (cam) for (let o = q.from; o <= q.to; o += 100) {
      const c = camAt(cam, o);
      if (c.s < 1.05) continue;
      const shot = cam.shots.find(sh => { const s = toSrc(edit, o); return s >= sh.start && s <= sh.end; });
      if (!shot) continue;
      const b = toScreen(c, shot.box.x, shot.box.y + shot.box.h);
      if (b.y > CAPTION_TOP - 10) { low = false; break; }
    }
    q.pos = low ? 'bottom' : 'top';
  }
  return cues;
}
// Voice spans in output time (for ducking the music).
export function voiceSpans(tl, edit, offset = 0) {
  return tl.captions.map(c => [offset + toOut(edit, c.t), offset + toOut(edit, c.t + c.dur * 1000)]);
}
