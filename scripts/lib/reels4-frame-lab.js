// Reels Studio v4 frame lab (QA lane). Injected into a page that has loaded the
// reel engine (reel-maker.html's engine scripts); shared by
// scripts/check-reels4-brand.mjs and scripts/check-reels4-motion.mjs.
// Defines window.QA4:
//   load(media)           stand-in pictures (SVG figures served by the check) and
//                         moving stand-in clips (canvas "videos": a figure that
//                         walks across a broadcast frame, so playback is visible
//                         in the draw log as the clip time and in the pixels);
//   build(entry, opts)    plan v4 + engine opts (assets / photos per beat) and
//                         the timeline (R.buildTimeline), plus a normalised view
//                         of it: chapters, beats, wipes (as the engine reports
//                         them; a wipe is found from the pixels when it does not);
//   frame(t, how)         seeks the clips (R.clipTimes), draws one frame with a
//                         recording 2D context and returns the draw-call log
//                         (text, fills, strokes, images with clip time, rotation
//                         angle, alpha) and, on request, a small RGBA copy for
//                         pixel comparisons;
//   classify(log, beat)   what each drawn word is: headline, caption, stamp,
//                         tag, label, marker, module, mark;
//   sheet(frames, title)  a PNG strip of thumbnails with red boxes on problems.
// No network: every picture is generated here or by the check's server.
(() => {
const R = window.ReelRender, ES = window.ReelES, L = window.ReelLint, FR = window.FrameUpRules;
const ES4 = window.ReelES4 || (ES && ES.v4) || null;
const W = 1080, H = 1920;
const SW = 216, SH = 384; // the small copy for pixel checks (1/5)
const measureCtx = document.createElement('canvas').getContext('2d');
const measure = (text, font) => { measureCtx.font = font; return measureCtx.measureText(text).width; };
const grain = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, 64, 64); return c; })();
const loadImage = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const hex = c => { if (typeof c !== 'string') return ''; const s = c.trim().toLowerCase(); if (/^#[0-9a-f]{6}$/.test(s)) return s; if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map(x => x + x).join(''); const m = s.match(/^rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(',').map(x => parseFloat(x)); if (p.length > 3 && p[3] < 0.05) return ''; return '#' + p.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, '0')).join(''); } return s; };
const TOKENS = Object.assign({ blue: '#0A7DFA', ink: '#121212', paper: '#F1EFEA', white: '#FFFFFF', red: '#E8322B', green: '#1BC47D', yellow: '#FFC52F' }, (ES && ES.TOKENS) || {});

// ── Engine surface (v4 names first, v3 fallbacks) ──
// Always through ReelRender, as the page and the export do (it routes a v4 plan to the
// Breakdown engine with its helpers).
const api = {
  build: (plan, opts) => R.buildTimeline(plan, opts),
  draw: (ctx, tl, t, env) => R.drawFrame(ctx, tl, t, env),
  clipTimes: (tl, t) => { try { return (R.clipTimes ? R.clipTimes(tl, t) : []) || []; } catch { return []; } },
};
function motionSpec() {
  // v4 names first (ReelES4.MOTION4: CURVES, DURATIONS, SPRING, WIPE), then ReelES.
  const M = (ES4 && (ES4.MOTION4 || ES4.MOTION)) || (ES && (ES.MOTION4 || ES.MOTION)) || {};
  const ease = M.CURVES || (ES4 && ES4.CURVES) || (ES && ES.ease) || null;
  const durs = M.DURATIONS || M.durations || (ES4 && ES4.DURATIONS) || (ES && ES.DURATIONS) || null;
  const spring = M.SPRING || (ES4 && ES4.SPRING) || (ES && ES.spring) || null;
  const stamp = M.STAMP || (ES4 && ES4.STAMP) || (ES && ES.STAMP) || null;
  const zones = ES4 && ES4.ZONE ? { zone: ES4.ZONE, layouts: ES4.LAYOUTS } : null;
  const toV4 = (ES && ES.toV4) || (ES4 && ES4.toV4) || null;
  const flat = v => { const out = []; const walk = x => { if (Number.isFinite(Number(x)) && x !== '' && x !== null && typeof x !== 'boolean') out.push(Number(x)); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') Object.values(x).forEach(walk); }; walk(v); return out; };
  const curves = {};
  if (ease && typeof ease === 'object') for (const [k, v] of Object.entries(ease)) { if (Array.isArray(v) && v.length === 4) curves[k] = v.map(Number); else if (v && Array.isArray(v.bezier)) curves[k] = v.bezier.map(Number); else if (typeof v === 'string') { const m = v.match(/cubic-bezier\(([^)]+)\)/); if (m) curves[k] = m[1].split(',').map(Number); } else if (typeof v === 'function') curves[k] = v; }
  return { raw: { ease: Boolean(ease), durs, spring, stamp, zones }, curves, durations: durs ? [...new Set(flat(durs))].sort((a, b) => a - b) : null, spring, stamp, zones, toV4: Boolean(toV4), es4: Boolean(ES4) };
}

// ── Stand-in media ──
const media = { images: {}, videos: {} };
function fakeClip(key, colour) {
  // A canvas that behaves like a playing <video> for drawImage: set currentTime and it redraws.
  const c = document.createElement('canvas'); c.width = 640; c.height = 360;
  const g = c.getContext('2d');
  let t = 0;
  const paint = () => {
    g.fillStyle = '#5B6B7C'; g.fillRect(0, 0, 640, 224); g.fillStyle = '#3E7A35'; g.fillRect(0, 224, 640, 136);
    g.fillStyle = 'rgba(255,255,255,0.5)'; for (let i = 0; i < 9; i++) g.fillRect(((i * 80 - t * 60) % 720 + 720) % 720 - 40, 224, 3, 136);
    const x = 200 + Math.sin(t * 1.3) * 120, y = 120 + Math.cos(t * 2.1) * 10;
    g.fillStyle = colour; g.beginPath(); g.arc(x, y, 26, 0, Math.PI * 2); g.fill(); g.fillRect(x - 30, y + 28, 60, 110);
    g.fillStyle = '#ffffff'; g.fillRect(x - 12, y + 50, 24, 30);
  };
  paint();
  Object.defineProperties(c, {
    currentTime: { get: () => t, set: v => { t = Number(v) || 0; paint(); } },
    readyState: { value: 4 }, videoWidth: { value: 640 }, videoHeight: { value: 360 }, duration: { value: 8 }, paused: { value: true }, seeking: { value: false },
  });
  c.play = () => Promise.resolve(); c.pause = () => {};
  c.dataset.qa = 'clip:' + key;
  return c;
}
async function load(spec) {
  for (const [k, m] of Object.entries(spec || {})) {
    if (m.kind === 'clip') { media.videos[k] = fakeClip(k, m.colour || '#203731'); const still = await loadImage('/__qa4/media/' + k + '.svg'); if (still) { still.dataset.qa = 'media:' + k; media.images[k] = still; } }
    else { const img = await loadImage('/__qa4/media/' + k + '.svg'); if (img) { img.dataset.qa = 'media:' + k; media.images[k] = img; } }
  }
  const mark = await loadImage('/assets/brand-logos/essentiallysports-mark.svg'); if (mark) { mark.dataset.qa = 'logo:es'; media.images['logo:es'] = mark; }
  try { await document.fonts.load('800 100px "Roboto Condensed"'); await document.fonts.load('500 40px Roboto'); } catch {}
  return { fonts: document.fonts.check('800 100px "Roboto Condensed"'), images: Object.keys(media.images).length, videos: Object.keys(media.videos).length };
}

// ── Recording context ──
function recorder(ctx) {
  const P = CanvasRenderingContext2D.prototype;
  const log = [];
  let path = null; let parts = 0; const clips = [null]; const stack = [];
  const tf = () => ctx.getTransform();
  const pt = (x, y) => { const m = tf(); return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; };
  const ext = (x, y) => { const [a, b] = pt(x, y); if (!path) path = { l: a, t: b, r: a, b: b }; else { path.l = Math.min(path.l, a); path.t = Math.min(path.t, b); path.r = Math.max(path.r, a); path.b = Math.max(path.b, b); } };
  const box = (x, y, w, h) => { const ps = [pt(x, y), pt(x + w, y), pt(x, y + h), pt(x + w, y + h)]; const xs = ps.map(p => p[0]), ys = ps.map(p => p[1]); return { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) }; };
  const clipNow = () => clips[clips.length - 1];
  const cut = b => { const c = clipNow(); if (!b || !c) return b; const o = { l: Math.max(b.l, c.l), t: Math.max(b.t, c.t), r: Math.min(b.r, c.r), b: Math.min(b.b, c.b) }; return o.r - o.l < 0.5 || o.b - o.t < 0.5 ? null : o; };
  const angle = () => { const m = tf(); return Math.round(Math.atan2(m.b, m.a) * 1800 / Math.PI) / 10; };
  const scaleOf = () => { const m = tf(); return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)); };
  const alpha = () => ctx.globalAlpha;
  const wrap = (name, fn) => { ctx[name] = function (...a) { try { fn.apply(null, a); } catch (e) { /* recording only */ } return P[name].apply(ctx, a); }; };
  wrap('save', () => { stack.push(clips.length); clips.push(clipNow()); });
  wrap('restore', () => { const n = stack.pop(); if (n != null) clips.length = n; if (!clips.length) clips.push(null); });
  wrap('beginPath', () => { path = null; parts = 0; });
  wrap('rect', (x, y, w, h) => { parts++; ext(x, y); ext(x + w, y + h); ext(x + w, y); ext(x, y + h); });
  wrap('roundRect', (x, y, w, h) => { parts++; ext(x, y); ext(x + w, y + h); ext(x + w, y); ext(x, y + h); });
  wrap('moveTo', (x, y) => { parts++; ext(x, y); });
  wrap('lineTo', (x, y) => ext(x, y));
  wrap('quadraticCurveTo', (a, b, x, y) => { ext(a, b); ext(x, y); });
  wrap('bezierCurveTo', (a, b, c, d, x, y) => { ext(a, b); ext(c, d); ext(x, y); });
  wrap('arc', (x, y, r) => { parts++; ext(x - r, y - r); ext(x + r, y + r); });
  wrap('ellipse', (x, y, rx, ry) => { ext(x - rx, y - ry); ext(x + rx, y + ry); });
  wrap('clip', p => { const b = p instanceof Path2D ? null : path; if (b) clips[clips.length - 1] = cut({ ...b }) || { l: 0, t: 0, r: 0, b: 0 }; });
  wrap('fillRect', (x, y, w, h) => { const b = cut(box(x, y, w, h)); if (b && alpha() > 0.02) log.push({ op: 'rect', ...b, fill: hex(ctx.fillStyle), rot: angle(), a: alpha(), scale: scaleOf() }); });
  wrap('fill', p => {
    if (p instanceof Path2D) { const m = tf(); log.push({ op: 'path2d', ox: m.e, oy: m.f, sx: Math.hypot(m.a, m.b), sy: Math.hypot(m.c, m.d), fill: hex(ctx.fillStyle), a: alpha(), rot: angle() }); return; }
    const b = cut(path ? { ...path } : null); if (b && alpha() > 0.02) log.push({ op: 'fill', ...b, parts, fill: hex(ctx.fillStyle), rot: angle(), a: alpha() });
  });
  wrap('stroke', () => { const b = cut(path ? { ...path } : null); if (b && alpha() > 0.02) log.push({ op: 'stroke', ...b, stroke: hex(ctx.strokeStyle), lw: ctx.lineWidth * scaleOf(), a: alpha(), rot: angle() }); });
  wrap('strokeRect', (x, y, w, h) => { const b = cut(box(x, y, w, h)); if (b && alpha() > 0.02) log.push({ op: 'stroke', ...b, stroke: hex(ctx.strokeStyle), lw: ctx.lineWidth * scaleOf(), a: alpha(), rot: angle() }); });
  wrap('fillText', (text, x, y, maxWidth) => {
    if (alpha() <= 0.02 || !String(text).trim()) return;
    const mt = P.measureText.call(ctx, text);
    const al = ctx.textAlign;
    const lx = x - (al === 'center' ? mt.width / 2 : (al === 'right' || al === 'end') ? mt.width : 0);
    const asc = mt.actualBoundingBoxAscent || 0, desc = mt.actualBoundingBoxDescent || 0;
    const b = box(lx, y - asc, mt.width, asc + desc);
    const px = Number((String(ctx.font).match(/([\d.]+)px/) || [0, 0])[1]);
    const c = clipNow();
    const clipped = Boolean(c && (b.l < c.l - 2 || b.r > c.r + 2 || b.t < c.t - 2 || b.b > c.b + 2));
    log.push({ op: 'text', text: String(text), ...b, size: Math.round(px * scaleOf() * 10) / 10, font: ctx.font, fill: hex(ctx.fillStyle), rot: angle(), a: alpha(), clipped, maxW: maxWidth == null ? null : maxWidth, natW: mt.width });
  });
  wrap('drawImage', (img, ...a) => {
    let x, y, w, h;
    if (a.length === 2) { [x, y] = a; w = img.width; h = img.height; } else if (a.length === 4) { [x, y, w, h] = a; } else { [, , , , x, y, w, h] = a; }
    const b = cut(box(x, y, w, h));
    const src = img && ((img.dataset && img.dataset.qa) || img.src || img.tagName || 'canvas');
    const crop = a.length === 8 ? a.slice(0, 4).map(n => Math.round(n * 10) / 10) : null;
    if (b && alpha() > 0.02) log.push({ op: 'image', ...b, src, a: alpha(), rot: angle(), time: img && typeof img.currentTime === 'number' ? Math.round(img.currentTime * 1000) : null, crop });
  });
  return log;
}

// ── Plan → engine input ──
const plain = s => String(s == null ? '' : s).replace(/\*/g, '');
const beatsOf = plan => (Array.isArray(plan.chapters) ? plan.chapters.flatMap(c => (c.beats || []).map(b => ({ ...b, chapterId: c.id }))) : []);
let current = null;
function build(entry, opts2 = {}) {
  const plan = JSON.parse(JSON.stringify(entry.plan));
  if (opts2.style) plan.esStyle = opts2.style;
  if (opts2.skin) plan.skin = opts2.skin;
  plan.style = 'es';
  const assets = {}; const photos = {};
  for (const ch of plan.chapters) for (const b of ch.beats) {
    const m = b.media;
    if (!m || m.kind === 'none') continue;
    const key = (m.kind === 'clip' || m.kind === 'presser') ? 'clip-' + (m.kind === 'presser' ? 'presser' : 'game') : (m.kind === 'cutout' ? 'cutout' : (m.kind === 'cards' ? 'card' : 'photo'));
    const id = key + ':' + b.id;
    const isClip = m.kind === 'clip' || m.kind === 'presser';
    assets[id] = { id, kind: isClip ? 'clip' : 'photo', url: '/__qa4/media/' + key + '.svg', subject: m.subject, verified: true, confirmed: isClip, focus: { x: 0.3, y: 0.08, w: 0.4, h: 0.34 }, head: { x: 0.5, y: 0.25 }, ...(isClip ? { durationMs: 8000, clipIn: 0.4, segment: { start: 0.4, end: 6.4 } } : {}), rights: { source: 'QA stand-in', licence: 'QA fixture, no rights needed', organic: true, paid: true } };
    photos[b.id] = [id];
    m.asset = id; m.ref = id; m.url = assets[id].url; m.verified = true; if (isClip) { m.confirmed = true; m.segment = { start: 0.4, end: 6.4 }; }
    if (m.kind === 'cards') (m.cards || []).forEach((c, i) => { const cid = 'card:' + b.id + ':' + i; assets[cid] = { ...assets[id], id: cid }; c.asset = cid; });
    media.images[id] = media.images[key]; if (isClip) media.videos[id] = media.videos[key];
    (m.cards || []).forEach((c, i) => { if (c.asset) media.images[c.asset] = media.images.card; });
  }
  const opts = { style: 'es', esStyle: plan.esStyle, skin: plan.skin, assets, photos, team: plan.team, sources: plan.sources, sport: plan.sport };
  let tl;
  try { tl = api.build(plan, opts); } catch (e) { return { error: 'buildTimeline threw: ' + e.message }; }
  if (!tl) return { error: 'buildTimeline returned nothing' };
  const info = normalise(tl, plan);
  current = { entry, plan, opts, tl, info, env: { measure, images: media.images, videos: media.videos, cutouts: {}, grain } };
  return { ok: true, info, v: tl.v, style: tl.esStyle || tl.reelStyle || tl.style, durationMs: tl.durationMs };
}
const num = (...v) => { for (const x of v) if (Number.isFinite(Number(x)) && x !== null && x !== '') return Number(x); return null; };
function normalise(tl, plan) {
  const pBeats = beatsOf(plan);
  const chOfBeat = Object.fromEntries(pBeats.map(b => [b.id, b.chapterId]));
  const beats = (tl.beats || []).map(b => ({ id: b.id, chapterId: b.chapterId || b.chapter || chOfBeat[b.id] || '', inMs: num(b.inMs, b.startMs, b.start), outMs: num(b.outMs, b.endMs, b.end), kind: b.kind || '' })).filter(b => b.inMs != null && b.outMs != null);
  let chapters = Array.isArray(tl.chapters) && tl.chapters.length ? tl.chapters.map(c => ({ id: c.id, inMs: num(c.inMs, c.startMs, c.start), outMs: num(c.outMs, c.endMs, c.end) })) : [];
  // The close is its own layer after the last wipe: kept apart from the chapters.
  if (!chapters.length) {
    const by = new Map();
    beats.forEach(b => { if (!b.chapterId) return; const c = by.get(b.chapterId) || { id: b.chapterId, inMs: b.inMs, outMs: b.outMs }; c.inMs = Math.min(c.inMs, b.inMs); c.outMs = Math.max(c.outMs, b.outMs); by.set(b.chapterId, c); });
    chapters = [...by.values()].sort((a, b) => a.inMs - b.inMs);
  }
  const wipeSrc = tl.wipes || (tl.transitions || []).filter(x => /wipe|slab/i.test(String(x.kind || x.type || ''))) || [];
  // ReelES4: { at (the middle), ms, to (chapter index; chapters.length = the close) }.
  const chId = i => (Number.isInteger(i) ? (chapters[i] ? chapters[i].id : 'close') : i);
  const wipes = wipeSrc.map(w => { const ms = num(w.ms, w.durMs); const at = num(w.at, w.midMs, w.mid); return { from: Number.isInteger(w.to) ? chId(w.to - 1) : (w.from || ''), to: chId(w.to), inMs: num(w.inMs, w.startMs, at != null && ms != null ? at - ms / 2 : null), outMs: num(w.outMs, w.endMs, at != null && ms != null ? at + ms / 2 : null), midMs: at }; }).filter(w => w.inMs != null && w.outMs != null);
  return { durationMs: tl.durationMs, chapters, beats, wipes, wipesFromEngine: wipes.length > 0, close: tl.close || null, anims: Array.isArray(tl.anims) ? tl.anims.length : (Array.isArray(tl.tweens) ? tl.tweens.length : null) };
}

// ── One frame ──
const big = document.createElement('canvas'); big.width = W; big.height = H;
const small = document.createElement('canvas'); small.width = SW; small.height = SH;
function frame(t, how = {}) {
  const { tl, env } = current;
  for (const c of api.clipTimes(tl, t)) { const v = env.videos[c.asset]; if (v) v.currentTime = c.time; }
  const ctx = big.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, W, H);
  for (const k of Object.keys(ctx)) delete ctx[k];
  const log = how.log === false ? null : recorder(ctx);
  let err = '';
  try { api.draw(ctx, tl, t, env); } catch (e) { err = e.message; }
  for (const k of Object.keys(ctx)) delete ctx[k];
  let px = null;
  if (how.pixels) { const s = small.getContext('2d'); s.clearRect(0, 0, SW, SH); s.drawImage(big, 0, 0, SW, SH); px = s.getImageData(0, 0, SW, SH).data; }
  let thumb = null;
  if (how.thumb) { thumb = document.createElement('canvas'); thumb.width = how.thumb.w || 180; thumb.height = how.thumb.h || 320; thumb.getContext('2d').drawImage(big, 0, 0, thumb.width, thumb.height); }
  return { t, log, px, err, thumb };
}

// ── What each word is ──
const norm = w => String(w).toUpperCase().replace(/[’']/g, "'").replace(/[−–—]/g, '-').replace(/^[^A-Z0-9#$+\-?]+|[^A-Z0-9%?]+$/g, '');
const words = s => plain(s).split(/[\s·/]+/).map(norm).filter(Boolean);
const NUMLIKE = /^[#+\-]?\d[\d,.:]*(%|X|S|ST|ND|RD|TH|M|K|YD|YDS)?$/;
function strings(v, skip = ['tone', 'type', 'kind', 'asset', 'ref', 'url', 'focus', 'at', 'logo', 'checked', 'filled', 'diagonal']) { const out = []; const walk = (x, k) => { if (skip.includes(k)) return; if (typeof x === 'string' || typeof x === 'number') out.push(String(x)); else if (Array.isArray(x)) x.forEach(y => walk(y)); else if (x && typeof x === 'object') Object.entries(x).forEach(([kk, y]) => walk(y, kk)); }; walk(v); return out; }
function vocabFor(plan, beatId) {
  const b = beatsOf(plan).find(x => x.id === beatId) || {};
  const ch = plan.chapters.find(c => c.id === b.chapterId) || {};
  const set = k => new Set(strings(k).flatMap(words));
  // A countdown / progress marker draws every chip: #1..#of and 1..of.
  const marker = ch.marker == null ? [] : (typeof ch.marker === 'string' ? [ch.marker] : [...Array.from({ length: Number(ch.marker.of) || 0 }, (_, k) => ['#' + (k + 1), String(k + 1)]).flat(), '3·2·1']);
  return {
    headline: set(ch.headline), marker: set(marker), vo: set(b.vo), module: set([b.module, b.module && b.module.type === 'wl' ? ['W', 'L', 'T'] : []]), stamp: set(b.stamp && b.stamp.text), tag: set([b.tag && b.tag.text, b.module && b.module.tag]),
    label: set([b.media && b.media.label, b.media && b.media.cards]), close: set(plan.close), source: set([plan.sourceLine, (plan.sources || []).map(s => s.source)]),
    stampText: words(b.stamp && b.stamp.text || '').join(' '),
    all: set([ch.headline, marker, b.vo, b.module, b.module && b.module.type === 'wl' ? ['W', 'L', 'T'] : [], b.stamp, b.tag, b.media && b.media.label, b.media && b.media.cards, plan.sourceLine, plan.close]),
    headlineRaw: plain(ch.headline || ''), emphasis: (String(ch.headline || '').match(/\*([^*]+)\*/) || [])[1] || '', tone: ch.tone || 'blue',
  };
}
// Every word of text is in set. strict: numbers must be in the set too (a headline's "21-POINT"
// is in it, a module's "+21" is not); loose: any formatted number passes.
function within(set, text, strict) { const ws = words(text); const ok = w => set.has(w) || (!strict && NUMLIKE.test(w)); return ws.length > 0 && ws.every(w => ok(w) || w.split(/[-/]/).every(x => !x || ok(x))) && (!strict || ws.some(w => set.has(w))); }
function classify(log, voc, captionBand) {
  const texts = log.filter(e => e.op === 'text');
  return texts.map(t => {
    const cy = (t.t + t.b) / 2;
    let role = 'other';
    const inBand = captionBand && cy >= captionBand[0] && cy <= captionBand[1];
    if (Math.abs(t.rot) >= 1 && within(voc.stamp, t.text, true)) role = 'stamp';
    else if (inBand && within(voc.vo, t.text) && !within(voc.headline, t.text, true) && !within(voc.module, t.text, true) && !within(voc.tag, t.text, true) && !within(voc.label, t.text, true)) role = 'caption';
    else if (within(voc.headline, t.text, true) && t.size >= 64 && (!captionBand || t.b < captionBand[0]) && !(ES4 && ES4.ZONE && t.t > ES4.ZONE.headY + 240)) role = 'headline';
    else if (within(voc.marker, t.text, true)) role = 'marker';
    else if (within(voc.stamp, t.text, true) && words(t.text).join(' ') === voc.stampText) role = 'stamp'; // an unrotated stamp: only the whole stamp text
    else if (within(voc.tag, t.text, true)) role = 'tag';
    else if (within(voc.label, t.text, true)) role = 'label';
    else if (within(voc.module, t.text)) role = 'module';
    else if (within(voc.close, t.text)) role = 'close';
    else if (within(voc.source, t.text)) role = 'source';
    else if (within(voc.vo, t.text)) role = 'caption';
    return { ...t, role };
  });
}
// The ES mark: a brand box followed by its letters (Path2D), the logo image, or a 60-140 px square top right with no words.
function markIn(log) {
  for (let i = 0; i < log.length; i++) { const e = log[i]; if (e.op === 'rect' && log[i + 1] && log[i + 1].op === 'path2d') { const w = e.r - e.l; if (w >= 40 && w <= 160) return e; } }
  const img = log.find(e => e.op === 'image' && /logo:es|essentiallysports-mark/.test(String(e.src))); if (img) return img;
  const texts = log.filter(e => e.op === 'text');
  return log.find(e => (e.op === 'rect' || e.op === 'fill') && (e.r - e.l) >= 56 && (e.r - e.l) <= 140 && Math.abs((e.r - e.l) - (e.b - e.t)) <= 4 && e.r >= 940 && e.t <= 600 && !texts.some(t => t.l >= e.l && t.r <= e.r && t.t >= e.t && t.b <= e.b)) || null;
}

// ── Pixels ──
const BLUE = [10, 125, 250];
function blueMask(px) { const m = new Uint8Array(SW * SH); for (let i = 0, j = 0; i < px.length; i += 4, j++) { const d = Math.abs(px[i] - BLUE[0]) + Math.abs(px[i + 1] - BLUE[1]) + Math.abs(px[i + 2] - BLUE[2]); m[j] = d < 60 ? 1 : 0; } return m; }
const blueShare = px => { const m = blueMask(px); let n = 0; for (const v of m) n += v; return n / m.length; };
// Mean absolute RGB difference (0..255) over the pixels where keep(j) is true, and the share of pixels that differ by > 24.
function diff(a, b, keep) { let s = 0, n = 0, big = 0; for (let i = 0, j = 0; i < a.length; i += 4, j++) { if (keep && !keep(j)) continue; const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3; s += d; n++; if (d > 24) big++; } return { mean: n ? s / n : 0, share: n ? big / n : 0, n }; }

// ── Sheets ──
function sheet(rows, title) {
  // rows: [{ label, frames: [{ thumb, note, bad, boxes:[{l,t,r,b}] }] }]
  const TW = rows[0] && rows[0].frames[0] && rows[0].frames[0].thumb ? rows[0].frames[0].thumb.width : 180;
  const TH = rows[0] && rows[0].frames[0] && rows[0].frames[0].thumb ? rows[0].frames[0].thumb.height : 320;
  const pad = 10, cap = 34, head = 40, lab = 22;
  const cols = Math.max(...rows.map(r => r.frames.length), 1);
  const c = document.createElement('canvas'); c.width = pad + cols * (TW + pad); c.height = head + rows.length * (lab + TH + cap + pad);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#121212'; g.font = '700 20px Roboto, sans-serif'; g.fillText(title, pad, 28);
  rows.forEach((r, ri) => {
    const y0 = head + ri * (lab + TH + cap + pad);
    g.fillStyle = '#121212'; g.font = '700 15px Roboto, sans-serif'; g.fillText(r.label, pad, y0 + 16);
    r.frames.forEach((f, i) => {
      const x = pad + i * (TW + pad), y = y0 + lab;
      if (f.thumb) g.drawImage(f.thumb, x, y);
      g.strokeStyle = f.bad ? '#E8322B' : '#d0d0d0'; g.lineWidth = f.bad ? 3 : 1; g.strokeRect(x + 0.5, y + 0.5, TW - 1, TH - 1);
      const k = TW / W; g.strokeStyle = 'rgba(232,50,43,0.95)'; g.lineWidth = 2;
      (f.boxes || []).forEach(b => g.strokeRect(x + b.l * k, y + b.t * k, (b.r - b.l) * k, (b.b - b.t) * k));
      g.fillStyle = f.bad ? '#E8322B' : '#555'; g.font = '500 12px Roboto, sans-serif';
      String(f.note || '').split('\n').slice(0, 2).forEach((line, li) => g.fillText(line.slice(0, 34), x, y + TH + 14 + li * 14));
    });
  });
  return c.toDataURL('image/png');
}

window.QA4 = { W, H, SW, SH, TOKENS, api, motionSpec, load, build, frame, classify, vocabFor, markIn, within, words, norm, NUMLIKE, blueMask, blueShare, diff, sheet, beatsOf, plain, get current() { return current; }, scaleSteps: () => { const out = []; const walk = v => { if (Number.isFinite(Number(v)) && typeof v !== 'boolean' && v !== '' && v !== null) out.push(Number(v)); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); }; if (ES && ES.TYPE_SCALE) walk(ES.TYPE_SCALE); return [...new Set(out.filter(n => n >= 8 && n <= 600))].sort((a, b) => a - b); }, pillMetrics: size => (FR && FR.pillMetrics ? FR.pillMetrics(size) : null), lint: (tl, extra) => { try { if (L && L.lintTimeline) { const r = L.lintTimeline(tl, { boxes: R.allBoxes ? R.allBoxes(measure, tl) : null, measure, extraSources: extra || '' }); return { critical: r.critical, warnings: r.warnings, ids: [...new Set(r.issues.map(i => i.id || i.code || ''))].filter(Boolean), criticals: r.issues.filter(i => i.severity === 'critical').map(i => (i.id || i.code || '') + ': ' + String(i.message || '').slice(0, 160)) }; } } catch (e) { return { error: e.message }; } return null; } };
return true;
})()
