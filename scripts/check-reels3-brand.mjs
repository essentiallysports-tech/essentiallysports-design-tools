#!/usr/bin/env node
// Reels Studio v3 brand check (QA lane). Renders the sample reels
// (scripts/fixtures/reels3/sample-plans.json: Rodgers 2011 stat twin, 67
// Achilles tears, Kittle #1 TE, Green Bay 2011 streak) in each of the four
// styles with the real engine (reel-render.js + reel-es.js, loaded exactly as
// reel-maker.html loads them) in headless Chrome, samples one settled frame
// per scene, records every canvas draw call and asserts the v3 brand rules on
// what was actually drawn:
//   scale     every word's drawn size (font px x transform scale) is a step of ReelES.TYPE_SCALE
//   pill      every one-line text box is an ES pill from FrameUpRules.pillMetrics (height, left pad)
//   limits    per frame: one headline, <= 1 media, <= 2 label pills, <= 2 signal colours
//   fit       no word cut off by a clip, squeezed with maxWidth
//   copy      every drawn word is a whole word of the scene's copy or voiceover (no cut words)
//   frame     every word sits inside the ES frame (x 40..1040, y 300..1640)
//   boxes     no unknown boxes: every filled shape is a pill, a tile, a dot/streak square, a
//             compare bar, a thin line, the caption bar, a media frame, the mark or the ground
//   framing   a photo's face (the photo-verify focus box) is in the picture and no words cover it
//   mark      the ES mark (top right) only on the hook and the end card; logotype only on the end card
// Also: the four style ids and labels, and the engine's own checks (ReelES.checks via
// ReelLint) per reel, so a frame that breaks a rule while lint passes is reported as a
// lint gap. Alignment to the 60 px column is reported as a note (warn).
// Frame sheets: REELS3_SHEETS=<dir> writes <topic>-<style>.png (one thumbnail per scene,
// failing boxes outlined in red) and <topic>-<style>.json (the per-frame findings).
// v4 (2026-11-27): the v3 four are retired to ReelES.V3_STYLES (still drawn on the v3 path); this check reads those.
// Before the v3 engine lands (no ReelES.STYLES) the reels are drawn in today's ES style
// with the new blocks mapped to old ones, and the run reports "engine v3 not present".
// The style rides on plan.esStyle (as the director writes it); REELS3_REELSTYLE=1 also sets plan.reelStyle
// (the engine's own field) to see each style drawn while the two disagree.
// Run: node scripts/check-reels3-brand.mjs   (skips without Chrome). REELS3_ONLY=receipts limits styles.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, findChrome, startServer, startChrome, sleep, figureSvg } from './_qa-chrome.mjs';

const CHROME = findChrome();
if (!CHROME) { console.log('reels3 brand: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('reels3 brand: skipped (needs Node with WebSocket)'); process.exit(0); }
const SHEETS = process.env.REELS3_SHEETS || '';
if (SHEETS) fs.mkdirSync(SHEETS, { recursive: true });
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/reels3/sample-plans.json'), 'utf8'));
const STYLE_IDS = ['gametape', 'statcard', 'receipts', 'hypecut'];
const STYLE_LABELS = { gametape: 'Game Tape', statcard: 'Stat Card', receipts: 'Receipts', hypecut: 'Hype Cut' };
const ONLY = (process.env.REELS3_ONLY || '').split(',').filter(Boolean);
const STYLES = ONLY.length ? STYLE_IDS.filter(s => ONLY.includes(s)) : STYLE_IDS;

// The engine scripts, in reel-maker.html's order: frameup-rules.js through reel-lint.js
// (anything the engine lane adds in between is picked up).
const pageHtml = fs.readFileSync(path.join(ROOT, 'reel-maker.html'), 'utf8');
const srcs = [...pageHtml.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
const from = srcs.findIndex(s => /^frameup-rules\.js/.test(s));
const to = srcs.findIndex(s => /^reel-lint\.js/.test(s));
const ENGINE = from >= 0 && to > from ? srcs.slice(from, to + 1) : [];
if (!ENGINE.length) { console.log('reels3 brand: FAIL could not find the engine scripts in reel-maker.html'); process.exit(1); }

// Media stand-ins: plain SVG figures (no photo rights). Photos 4:5 portrait, clips 16:9.
function mediaSvg(key) {
  const m = FIX.media[key];
  if (!m) return null;
  if (m.kind !== 'clip') return figureSvg({ pose: m.figure?.pose || 'stand', cutout: false, colour: m.figure?.colour || '#1D428A', w: 1200, h: 1500 });
  // A 16:9 "broadcast" frame: field, yard lines, the whole figure in the middle (so a 9:16 crop shows a person).
  const fig = figureSvg({ pose: m.figure?.pose || 'stand', cutout: true, colour: m.figure?.colour || '#1D428A', w: 600, h: 800 }).replace('<svg ', '<svg x="500" y="70" ');
  const lines = Array.from({ length: 9 }, (_, i) => `<rect x="${i * 200}" y="560" width="6" height="340" fill="#ffffff" opacity="0.5"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="560" fill="#5B6B7C"/><rect y="560" width="1600" height="340" fill="#3E7A35"/>${lines}${fig}</svg>`;
}
const BRAND_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>reels3 brand</title>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Condensed:wght@700;800&display=swap" rel="stylesheet">
<style>@font-face{font-family:"Acumin Post";src:url("/fonts/acumin-post-legacy.otf")}body{margin:0;background:#fff}</style>
${ENGINE.map(s => `<script src="/${s}"></script>`).join('\n')}
</head><body></body></html>`;

const { server, base } = await startServer({
  extra: url => {
    if (url.pathname === '/__qa/brand.html') return { type: 'text/html', body: BRAND_PAGE };
    const m = url.pathname.match(/^\/__qa\/media\/([\w-]+)\.svg$/);
    if (m) { const svg = mediaSvg(m[1]); return svg ? { type: 'image/svg+xml', body: svg } : null; }
    return null;
  },
});
const page = await startChrome(CHROME, { width: 1200, height: 1000 });
const cleanup = () => { page.close(); server.close(); };
const pageErrors = [];
page.on(m => {
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
});
await page.send('Page.enable');
await page.send('Runtime.enable');
await page.send('Page.navigate', { url: `${base}/__qa/brand.html` });
for (let i = 0; i < 100; i++) {
  await sleep(150);
  if (await page.evaluate(`document.readyState === 'complete' && Boolean(window.ReelRender && window.ReelES)`).catch(() => false)) break;
}
if (!(await page.evaluate(`Boolean(window.ReelRender && window.ReelES)`).catch(() => false))) {
  console.log(`reels3 brand: FAIL the engine did not load (${pageErrors.slice(0, 3).join(' | ') || 'no error'})`);
  cleanup(); process.exit(1);
}

// ─── In-page harness ─────────────────────────────────────────────────────────
// Everything below runs in the page: build, draw with a recording context,
// classify what was drawn, and return findings plus a thumbnail sheet.
const HARNESS = String.raw`(() => {
const R = window.ReelRender, ES = window.ReelES, L = window.ReelLint, FR = window.FrameUpRules;
const V3 = Boolean(ES && ES.STYLES && typeof ES.STYLES === 'object');
const ALSO_REELSTYLE = Boolean(window.__QA_REELSTYLE);
const W = 1080, H = 1920;
const measureCtx = document.createElement('canvas').getContext('2d');
const measure = (text, font) => { measureCtx.font = font; return measureCtx.measureText(text).width; };
const grain = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, 64, 64); return c; })();
const loadImage = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

// Scale steps, flattened ({ display: 168, stat: [220, 300] } or [{ id, size }]).
function scaleSteps() {
  const out = [];
  const walk = v => { if (Number.isFinite(Number(v)) && typeof v !== 'boolean' && v !== '' && v !== null) out.push(Number(v)); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  if (ES && ES.TYPE_SCALE) walk(ES.TYPE_SCALE);
  return [...new Set(out.filter(n => n >= 8 && n <= 600))].sort((a, b) => a - b);
}
const hex = c => { if (typeof c !== 'string') return ''; const s = c.trim().toLowerCase(); if (/^#[0-9a-f]{6}$/.test(s)) return s; if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map(x => x + x).join(''); const m = s.match(/^rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(',').map(x => parseFloat(x)); if (p.length > 3 && p[3] < 0.05) return ''; return '#' + p.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, '0')).join(''); } return s; };

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
  const rotated = () => { const m = tf(); return Math.abs(m.b) > 1e-3 || Math.abs(m.c) > 1e-3; };
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
  wrap('fillRect', (x, y, w, h) => { const b = cut(box(x, y, w, h)); if (b && alpha() > 0.02) log.push({ op: 'rect', ...b, fill: hex(ctx.fillStyle), rot: rotated(), a: alpha(), scale: scaleOf() }); });
  wrap('fill', p => {
    if (p instanceof Path2D) { const m = tf(); log.push({ op: 'path2d', ox: m.e, oy: m.f, sx: Math.hypot(m.a, m.b), sy: Math.hypot(m.c, m.d), fill: hex(ctx.fillStyle), a: alpha() }); return; }
    const b = cut(path ? { ...path } : null); if (b && alpha() > 0.02) log.push({ op: 'fill', ...b, parts, fill: hex(ctx.fillStyle), rot: rotated(), a: alpha() });
  });
  wrap('stroke', () => { const b = cut(path ? { ...path } : null); if (b && alpha() > 0.02) log.push({ op: 'stroke', ...b, stroke: hex(ctx.strokeStyle), lw: ctx.lineWidth * scaleOf(), a: alpha() }); });
  wrap('strokeRect', (x, y, w, h) => { const b = cut(box(x, y, w, h)); if (b && alpha() > 0.02) log.push({ op: 'stroke', ...b, stroke: hex(ctx.strokeStyle), lw: ctx.lineWidth * scaleOf(), a: alpha() }); });
  wrap('fillText', (text, x, y, maxWidth) => {
    if (alpha() <= 0.02 || !String(text).trim()) return;
    const mt = P.measureText.call(ctx, text);
    const al = ctx.textAlign, bl = ctx.textBaseline;
    let lx = x - (al === 'center' ? mt.width / 2 : (al === 'right' || al === 'end') ? mt.width : 0);
    const asc = mt.actualBoundingBoxAscent || 0, desc = mt.actualBoundingBoxDescent || 0;
    const b = box(lx, y - asc, mt.width, asc + desc);
    const px = Number((String(ctx.font).match(/([\d.]+)px/) || [0, 0])[1]);
    const c = clipNow();
    const clipped = Boolean(c && (b.l < c.l - 2 || b.r > c.r + 2 || b.t < c.t - 2 || b.b > c.b + 2));
    log.push({ op: 'text', text: String(text), ...b, size: Math.round(px * scaleOf() * 10) / 10, font: ctx.font, fill: hex(ctx.fillStyle), rot: rotated(), a: alpha(), align: al, base: bl, clipped, maxW: maxWidth == null ? null : maxWidth, natW: mt.width });
  });
  wrap('drawImage', (img, ...a) => {
    let x, y, w, h;
    if (a.length === 2) { [x, y] = a; w = img.width; h = img.height; } else if (a.length === 4) { [x, y, w, h] = a; } else { [, , , , x, y, w, h] = a; }
    const b = cut(box(x, y, w, h));
    // The face (photo-verify focus box) in frame coordinates, for the framing rule.
    let face = null;
    const key = img && img.dataset && String(img.dataset.qa || '').replace(/^media:/, '');
    const fo = key && window.__FIX && window.__FIX.media[key] && window.__FIX.media[key].focus;
    if (fo && img.naturalWidth) {
      let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
      if (a.length === 8) [sx, sy, sw, sh] = a;
      const fx = fo.x * img.naturalWidth, fy = fo.y * img.naturalHeight;
      face = box(x + (fx - sx) / sw * w, y + (fy - sy) / sh * h, fo.w * img.naturalWidth / sw * w, fo.h * img.naturalHeight / sh * h);
    }
    if (b && alpha() > 0.02) log.push({ op: 'image', ...b, src: img && (img.dataset?.qa || img.src || img.tagName || 'canvas'), a: alpha(), face });
  });
  return log;
}

// ── v3 -> today's blocks (only when the v3 engine is missing) ──
const plain = s => String(s || '').replace(/\*/g, '');
const lineOf = s => ({ text: plain(s && s.text || s), color: /\*/.test(s && s.text || s) ? 'blue' : ((s && s.color) || 'ink') });
function downgrade(beat) {
  const b = beat.block || {};
  const out = { ...beat };
  const t = b.type;
  if (t === 'hook') out.block = { type: 'hook', pills: (b.pills || []).map(lineOf) };
  else if (t === 'statement') out.block = { type: 'statement', lines: (b.lines || []).map(lineOf) };
  else if (t === 'photoCard') { out.kind = 'point'; out.block = { type: 'statement', lines: [{ text: b.label, color: 'blue' }] }; }
  else if (t === 'clipLabel') { out.kind = 'point'; out.block = { type: 'statement', lines: [{ text: b.text, color: 'ink' }] }; }
  else if (t === 'tagPill') { out.kind = 'point'; out.block = { type: 'statement', lines: [{ text: b.text, color: b.tone === 'blue' ? 'blue' : 'ink' }] }; }
  else if (t === 'streak') { out.kind = 'point'; out.block = { type: 'statement', lines: [{ text: b.label, color: 'ink' }] }; }
  else if (t === 'statTiles') { const ts = b.tiles || []; out.kind = ts.length > 1 ? 'bars' : 'stat'; out.block = ts.length > 1 ? { type: 'compare', items: ts.map(x => ({ label: x.label, value: parseFloat(String(x.value).replace(/[^\d.]/g, '')) || 1, display: x.value, color: x.tone === 'blue' ? 'blue' : 'ink' })) } : { type: 'number', value: parseFloat(ts[0].value) || 0, label: ts[0].label, display: ts[0].value }; }
  else if (t === 'rankTile') { out.kind = 'stat'; out.block = { type: 'number', value: parseFloat(String(b.rank).replace(/[^\d.]/g, '')) || 1, prefix: '#', label: b.pos, kicker: b.kicker, display: b.rank }; }
  else if (t === 'dotGrid') { out.kind = 'dotrank'; out.block = { type: 'dots', count: b.total, highlight: (b.groups || [])[0]?.n || 0, label: b.title, note: (b.groups || [])[0]?.label || '' }; }
  if (typeof out.vo === 'string') out.vo = out.vo; // *word* emphasis is shared
  return out;
}

const images = {};
async function loadMedia(media) {
  for (const k of Object.keys(media)) { const img = await loadImage('/__qa/media/' + k + '.svg'); if (img) { img.dataset.qa = 'media:' + k; images[k] = img; } }
  const mark = await loadImage('/assets/brand-logos/essentiallysports-mark.svg'); if (mark) { mark.dataset.qa = 'logo:es'; images['logo:es'] = mark; }
  try { await document.fonts.load('800 100px "Roboto Condensed"'); await document.fonts.load('500 40px Roboto'); } catch {}
  return { fonts: document.fonts.check('800 100px "Roboto Condensed"'), media: Object.keys(images).length };
}

function build(fix, topic, styleId) {
  const assets = {}; const photos = {};
  const beats = topic.styles[styleId].map(key => {
    const raw = JSON.parse(JSON.stringify(topic.beats[key]));
    raw.id = key;
    if (raw.media) {
      const m = fix.media[raw.media];
      assets[raw.media] = { kind: m.kind, url: '/__qa/media/' + raw.media + '.svg', subject: m.subject, verified: true, ...(m.focus ? { focus: m.focus, head: { x: m.focus.x + m.focus.w / 2, y: m.focus.y + m.focus.h / 2 } } : {}), ...(m.kind === 'clip' ? { durationMs: m.durationMs || 6000, clipIn: 0.4 } : {}), rights: { source: 'QA stand-in (SVG)', licence: 'QA fixture, no rights needed', organic: true, paid: true } };
      photos[key] = [raw.media];
    }
    if (raw.block && raw.block.photo && fix.media[raw.block.photo] && !assets[raw.block.photo]) { const m = fix.media[raw.block.photo]; assets[raw.block.photo] = { kind: 'photo', url: '/__qa/media/' + raw.block.photo + '.svg', verified: true, focus: m.focus, head: { x: m.focus.x + m.focus.w / 2, y: m.focus.y + m.focus.h / 2 }, rights: { source: 'QA stand-in (SVG)', licence: 'QA fixture, no rights needed', organic: true, paid: true } }; photos[key] = [raw.block.photo]; }
    return V3 ? raw : downgrade(raw);
  });
  const plan = { title: topic.title, format: topic.format || 'stat', sport: topic.sport, style: 'es', ...(V3 ? { esStyle: styleId } : {}), ...(V3 && ALSO_REELSTYLE ? { reelStyle: styleId } : {}), sourceLine: 'Source: ' + ((topic.sources || [])[0]?.source || 'ES'), sources: topic.sources, team: topic.team || undefined, beats };
  const opts = { style: 'es', ...(V3 ? { esStyle: styleId } : {}), photos, assets, team: topic.team || undefined, sources: topic.sources };
  return { plan, opts, assets };
}

// Every word the scene may draw: its block's copy and its voiceover (captions).
const norm = w => String(w).toUpperCase().replace(/[’']/g, "'").replace(/^[^A-Z0-9#$]+|[^A-Z0-9%]+$/g, '');
function vocab(beat) {
  const out = new Set();
  const walk = v => { if (typeof v === 'string' || typeof v === 'number') String(v).replace(/\*/g, '').split(/[\s·]+/).forEach(w => { const n = norm(w); if (n) { out.add(n); n.split(/[-/]/).forEach(x => x && out.add(x)); } }); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (!['tone', 'color', 'type', 'photo', 'focus', 'scan', 'r', 'size'].includes(k)) walk(x); }); };
  walk(beat.block); walk(beat.vo); walk(beat.text);
  if (beat.block && beat.block.type === 'streak') ['W', 'L', 'T'].forEach(x => out.add(x));
  return out;
}
function blockAt(tl, t) {
  const g = (tl.tracks && tl.tracks.graphics || []).find(x => x.inMs <= t && t < x.outMs);
  const block = g && g.data && g.data.block;
  return { beat: g ? g.beat : '', type: block ? block.type : (g ? String(g.template || '').replace(/^es-/, '') : ''), g };
}
// A settled moment in each scene: entrances, count-ups and the stamp done, before the next wipe.
function sampleTimes(tl) {
  return (tl.beats || []).map(b => { const d = b.outMs - b.inMs; const t = Math.max(b.inMs + d * 0.5, Math.min(b.inMs + 2100, b.outMs - 560)); return { beat: b.id, t: Math.round(t) }; });
}

// ── Classify and check one frame ──
function analyse(log, ctxInfo) {
  const { steps, blockType, isHook, isEnd } = ctxInfo;
  const issues = []; const notes = []; const boxes = [];
  const add = (rule, msg, b) => { issues.push({ rule, msg, box: b ? { l: Math.round(b.l), t: Math.round(b.t), r: Math.round(b.r), b: Math.round(b.b) } : null }); };
  const texts = log.filter(e => e.op === 'text');
  const inside = (t, b, tol = 3) => t.l >= b.l - tol && t.r <= b.r + tol && t.t >= b.t - tol && t.b <= b.b + tol;
  const area = b => Math.max(0, b.r - b.l) * Math.max(0, b.b - b.t);
  const media = log.filter(e => e.op === 'image' && !/logo:|grain/.test(String(e.src)) && area(e) > W * H * 0.04);
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  // Text sizes on the scale.
  if (!steps.length) { if (!ctxInfo.scaleReported) add('scale', 'ReelES.TYPE_SCALE is missing (engine v3 not present)'); }
  else texts.forEach(t => { if (!steps.some(s => Math.abs(s - t.size) <= 0.6)) add('scale', '"' + t.text.slice(0, 24) + '" is ' + t.size + ' px, not on the type scale (' + steps.join('/') + ')', t); });
  // Words fit: never cut by a clip, squeezed by maxWidth or spilling out of their box.
  texts.forEach(t => {
    if (t.clipped) add('fit', '"' + t.text.slice(0, 24) + '" is cut off (drawn past its clip)', t);
    if (t.maxW != null && t.natW > t.maxW + 1) add('fit', '"' + t.text.slice(0, 24) + '" is squeezed (maxWidth ' + Math.round(t.maxW) + ' < ' + Math.round(t.natW) + ')', t);
  });
  // Copy: every drawn word is a whole word of the scene's copy or voiceover (nothing cut mid-word).
  if (ctxInfo.vocab && !ctxInfo.isEnd) texts.forEach(t => t.text.split(/[\s·]+/).forEach(w => { const n = norm(w); if (n && !ctxInfo.vocab.has(n) && !/^\d+$/.test(n)) add('copy', 'drawn word "' + w + '" (in "' + t.text.slice(0, 24) + '") is not in the scene\'s copy: cut or invented', t); }));
  // Words inside the ES frame.
  texts.forEach(t => { if (t.l < 40 - 2 || t.r > 1040 + 2 || t.t < 300 - 2 || t.b > 1640 + 2) add('frame', '"' + t.text.slice(0, 24) + '" is outside the ES frame (' + [t.l, t.t, t.r, t.b].map(Math.round).join(',') + ')', t); });
  // Shapes.
  const fills = log.filter(e => (e.op === 'rect' || e.op === 'fill') && !e.rot);
  const full = b => area(b) >= W * H * 0.9;
  let markSeen = false, logoSeen = false;
  // The mark and logotype: a brand box (fillRect) followed by its Path2D letters.
  log.forEach((e, i) => {
    if (e.op !== 'rect') return;
    const nx = log[i + 1];
    if (!nx || nx.op !== 'path2d') return;
    const w = e.r - e.l, h = e.b - e.t;
    e.kind = 'brand';
    if (w <= 140 && h <= 140 && w >= 40) markSeen = { ...e }; else logoSeen = { ...e };
  });
  log.filter(e => e.op === 'image' && /logo:es/.test(String(e.src))).forEach(e => { markSeen = { ...e }; });
  // The square mark by its place and size (top right, 60-120 px, no words in it), however it is drawn.
  log.forEach(e => { if ((e.op === 'rect' || e.op === 'fill') && !e.kind) { const w = e.r - e.l, h = e.b - e.t; if (w >= 60 && w <= 120 && Math.abs(w - h) <= 4 && e.r >= 960 && e.t <= 560 && !texts.some(t => inside(t, e))) { e.kind = 'brand'; markSeen = { ...e }; } } });
  const pillMetric = size => (FR && FR.pillMetrics ? FR.pillMetrics(size) : null);
  let labelPills = 0, headlinePills = 0;
  const textOwner = new Map();
  for (const f of fills) {
    if (f.kind === 'brand') continue;
    const w = f.r - f.l, h = f.b - f.t;
    if (full(f)) { f.kind = 'ground'; continue; }
    const inner = texts.filter(t => inside(t, f));
    const sq = Math.abs(w - h) <= Math.max(2, 0.12 * Math.max(w, h));
    if (inner.length === 0) {
      if (w <= 8 || h <= 8) f.kind = 'line';
      else if (f.op === 'fill' && f.parts >= 4) f.kind = 'dot';
      else if (media.some(m => inside(f, m, 6) || inside(m, f, 24))) f.kind = 'media-frame';
      else if (sq && w <= 72) f.kind = 'dot';
      else if (blockType === 'compare' && h <= 160) f.kind = 'bar';
      else if (fills.some(o => o !== f && !full(o) && texts.some(t => inside(t, o)) && inside(f, o, 1))) f.kind = 'tile-part';
      else f.kind = 'unknown';
    } else if (inner.length === 1 || new Set(inner.map(t => Math.round(t.t))).size === 1 && inner.every(t => t.size === inner[0].size)) {
      // A one-line box: must be an ES pill (pillMetrics height and left pad).
      const t = inner.reduce((a, b) => (a.l <= b.l ? a : b));
      const m = pillMetric(t.size);
      const isPill = m && near(h, m.h, 2.5) && near(t.l - f.l, m.padLeft, 4);
      const capBand = ctxInfo.captionY && near((f.t + f.b) / 2, ctxInfo.captionY, 60) && h <= 120;
      const tileLike = fills.some(o => o !== f && !full(o) && o.kind !== 'brand' && inside(f, o, 1) && texts.filter(x => inside(x, o)).length > inner.length);
      if (capBand && blockType !== 'clipLabel') f.kind = 'caption-bar';
      else if (isPill) { f.kind = 'pill'; if (t.size >= 96) headlinePills++; else labelPills++; }
      else if (tileLike) { f.kind = 'unknown'; f.why = 'a box inside a tile that is not a pill (h ' + Math.round(h) + ', pad ' + Math.round(t.l - f.l) + (m ? '; pill would be h ' + Math.round(m.h) + ', pad ' + Math.round(m.padLeft) : '') + ')'; }
      else if (sq && w <= 140 && inner.every(t => t.text.trim().length <= 2)) f.kind = 'dot';
      else if (ctxInfo.captionY && near((f.t + f.b) / 2, ctxInfo.captionY, 90) && h <= 120) f.kind = 'caption-bar';
      else { f.kind = 'unknown'; f.why = 'a text box that is not an ES pill (h ' + Math.round(h) + ', left pad ' + Math.round(t.l - f.l) + (m ? '; pill at ' + t.size + ' px is h ' + Math.round(m.h) + ', pad ' + Math.round(m.padLeft) : '; no pillMetrics') + ')'; }
    } else {
      f.kind = 'tile';
    }
    inner.forEach(t => textOwner.set(t, f));
  }
  fills.filter(f => f.kind === 'unknown').forEach(f => add('boxes', 'unknown box ' + Math.round(f.r - f.l) + 'x' + Math.round(f.b - f.t) + (f.why ? ': ' + f.why : '') + ' fill ' + f.fill, f));
  // Framing: the face is in the picture and no words cover it.
  media.filter(m => m.face).forEach(m => {
    const f = m.face, fa = area(f);
    const vis = { l: Math.max(f.l, m.l, 0), t: Math.max(f.t, m.t, 0), r: Math.min(f.r, m.r, W), b: Math.min(f.b, m.b, H) };
    const shown = vis.r > vis.l && vis.b > vis.t ? area(vis) / fa : 0;
    if (shown < 0.85) add('framing', 'the face is cut off (' + Math.round(shown * 100) + '% of the head box in the picture)', f);
    texts.forEach(t => { const o = { l: Math.max(f.l, t.l), t: Math.max(f.t, t.t), r: Math.min(f.r, t.r), b: Math.min(f.b, t.b) }; if (o.r > o.l && o.b > o.t && area(o) > fa * 0.04) add('framing', '"' + t.text.slice(0, 24) + '" covers the face', t); });
  });
  // The caption bar never sits on the block's words (it may sit on a full-bleed picture).
  fills.filter(f => f.kind === 'caption-bar').forEach(c => {
    texts.filter(t => !inside(t, c) && !(textOwner.get(t) && textOwner.get(t).kind === 'caption-bar')).forEach(t => { const o = { l: Math.max(c.l, t.l), t: Math.max(c.t, t.t), r: Math.min(c.r, t.r), b: Math.min(c.b, t.b) }; if (o.r > o.l + 2 && o.b > o.t + 2) add('caption', 'the caption bar covers "' + t.text.slice(0, 24) + '"', t); });
    media.filter(m => m.r - m.l < W * 0.95).forEach(m => { const o = { l: Math.max(c.l, m.l), t: Math.max(c.t, m.t), r: Math.min(c.r, m.r), b: Math.min(c.b, m.b) }; if (o.r > o.l && o.b > o.t) notes.push('the caption sits on a framed picture (' + (blockType || '?') + ')'); });
  });
  // Element limits.
  // A dot grid's legend is part of its data block (one pill per group).
  if (labelPills > 2 && !(blockType === 'dotGrid' && labelPills <= 3)) add('limits', labelPills + ' label pills (max 2)');
  if (labelPills > 2 && blockType === 'dotGrid') notes.push('dotGrid legend: ' + labelPills + ' pills (rule says <= 2 pills per frame; legend counted as the data block)');
  if (media.length > 1) add('limits', media.length + ' media in one frame (max 1)', media[1]);
  const SIG = { green: '#1bc47d', red: '#e8322b', yellow: '#ffc52f' };
  const tokens = (ES && ES.TOKENS) || {};
  const sigHex = new Set(['green', 'red', 'yellow'].map(k => hex(tokens[k] || SIG[k])));
  const used = new Set(log.filter(e => (e.op === 'rect' || e.op === 'fill' || e.op === 'text') && sigHex.has(e.fill)).map(e => e.fill));
  if (used.size > 2) add('limits', used.size + ' signal colours in one frame (max 2)');
  // The mark.
  if (markSeen && !(isHook || isEnd)) add('mark', 'the ES mark shows on a ' + (blockType || '?') + ' scene (hook and end card only)', markSeen);
  if (logoSeen && !isEnd) add('mark', 'the logotype shows on a ' + (blockType || '?') + ' scene (end card only)', logoSeen);
  if (isEnd && !markSeen && !logoSeen) notes.push('end card: no ES mark or logotype found');
  if (markSeen && !(markSeen.r >= 960 && markSeen.t <= 560)) add('mark', 'the ES mark is not top right', markSeen);
  // Alignment (note): left-aligned boxes and free text start on the 60 px column.
  fills.filter(f => ['pill', 'tile'].includes(f.kind)).forEach(f => { const c = (f.l + f.r) / 2; if (!near(f.l, 60, 3) && !near(c, 540, 4) && !near(f.r, 1020, 3) && !fills.some(o => o !== f && o.kind === f.kind && near(o.t, f.t, 3) && o.l < f.l)) notes.push('align: ' + f.kind + ' at x ' + Math.round(f.l) + ' (column is 60)'); });
  return { media: media.map(m => ({ src: String(m.src).slice(0, 40), box: [m.l, m.t, m.r, m.b].map(Math.round), face: m.face ? [m.face.l, m.face.t, m.face.r, m.face.b].map(Math.round) : null })), texts: texts.map(t => ({ text: t.text.slice(0, 40), size: t.size, box: [t.l, t.t, t.r, t.b].map(Math.round), clipped: t.clipped || undefined })), issues, notes, counts: { texts: texts.length, pills: labelPills, headlinePills, media: media.length, tiles: fills.filter(f => f.kind === 'tile').length, unknown: fills.filter(f => f.kind === 'unknown').length }, sizes: [...new Set(texts.map(t => t.size))].sort((a, b) => a - b), mark: Boolean(markSeen), logotype: Boolean(logoSeen) };
}

async function renderReel(fix, topicId, styleId, opts2 = {}) {
  const topic = fix.topics.find(t => t.id === topicId);
  const { plan, opts } = build(fix, topic, styleId);
  let tl;
  try { tl = R.buildTimeline(plan, opts); } catch (e) { return { error: 'buildTimeline threw: ' + e.message }; }
  if (!tl || !tl.beats || !tl.beats.length) return { error: 'empty timeline' };
  const env = { measure, images, videos: {}, cutouts: {}, grain };
  const steps = scaleSteps();
  const captionY = ES && ES.GEO ? ES.GEO.captionY : 1172;
  const frames = [];
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const thumbs = [];
  const TW = 360, TH = 640;
  for (const s of sampleTimes(tl)) {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    // Fresh recorder per frame (own-property wrappers on this context).
    for (const k of Object.keys(ctx)) delete ctx[k];
    const log = recorder(ctx);
    let drawErr = '';
    try { R.drawFrame(ctx, tl, s.t, env); } catch (e) { drawErr = e.message; }
    for (const k of Object.keys(ctx)) delete ctx[k];
    const at = blockAt(tl, s.t);
    const type = at.type;
    const srcBeat = plan.beats.find(b => b.id === at.beat);
    const res = analyse(log, { vocab: srcBeat ? vocab(srcBeat) : null, steps, blockType: type, isHook: type === 'hook' || at.g?.kind === 'hook', isEnd: type === 'endcard' || at.g?.kind === 'cta', captionY, scaleReported: frames.length > 0 });
    if (drawErr) res.issues.push({ rule: 'draw', msg: 'drawFrame threw: ' + drawErr });
    frames.push({ beat: s.beat, t: s.t, type, ...res });
    const th = document.createElement('canvas'); th.width = TW; th.height = TH;
    const tc = th.getContext('2d'); tc.drawImage(canvas, 0, 0, TW, TH);
    const k = TW / W;
    tc.strokeStyle = 'rgba(232,50,43,0.95)'; tc.lineWidth = 2;
    res.issues.forEach(i => { if (i.box) tc.strokeRect(i.box.l * k, i.box.t * k, (i.box.r - i.box.l) * k, (i.box.b - i.box.t) * k); });
    if (opts2.guides) { tc.setLineDash([4, 4]); tc.strokeStyle = 'rgba(10,125,250,0.5)'; tc.lineWidth = 1; tc.strokeRect(40 * k, 300 * k, 1000 * k, 1340 * k); tc.setLineDash([]); }
    thumbs.push(th);
  }
  // Sheet: thumbnails in a row with a caption strip under each.
  const pad = 16, cap = 64;
  const sheet = document.createElement('canvas');
  sheet.width = pad + thumbs.length * (TW + pad); sheet.height = pad * 2 + 44 + TH + cap;
  const sc = sheet.getContext('2d');
  sc.fillStyle = '#ffffff'; sc.fillRect(0, 0, sheet.width, sheet.height);
  sc.fillStyle = '#121212'; sc.font = '700 24px Roboto, sans-serif';
  sc.fillText(topic.title + '  ·  ' + styleId + (V3 ? '' : '  (engine v3 not present: today\'s ES style)'), pad, pad + 26);
  thumbs.forEach((th, i) => {
    const x = pad + i * (TW + pad), y = pad + 44;
    sc.drawImage(th, x, y); sc.strokeStyle = '#d0d0d0'; sc.lineWidth = 1; sc.strokeRect(x + 0.5, y + 0.5, TW - 1, TH - 1);
    const f = frames[i];
    sc.fillStyle = f.issues.length ? '#E8322B' : '#121212'; sc.font = '700 18px Roboto, sans-serif';
    sc.fillText((i + 1) + '. ' + f.beat + ' · ' + (f.type || '?') + (f.issues.length ? '  ·  ' + f.issues.length + ' issue' + (f.issues.length > 1 ? 's' : '') : '  ·  ok'), x, y + TH + 26);
    sc.fillStyle = '#555'; sc.font = '500 15px Roboto, sans-serif';
    sc.fillText('sizes ' + f.sizes.join('/') + '  pills ' + f.counts.pills + '+' + f.counts.headlinePills + 'h  media ' + f.counts.media, x, y + TH + 50);
  });
  // The engine's own checks, for the lint-gap cross-check.
  let lint = null;
  try { if (L && L.lintTimeline) { const boxes = R.allBoxes ? R.allBoxes(measure, tl) : null; const r = L.lintTimeline(tl, { boxes, measure, extraSources: topic.facts || '' }); lint = { critical: r.critical, warnings: r.warnings, ids: [...new Set(r.issues.map(i => i.id || i.code || i.kind || ''))].filter(Boolean), criticals: r.issues.filter(i => i.severity === 'critical').map(i => (i.id || i.code || '') + ': ' + String(i.message || '').slice(0, 140)) }; } } catch (e) { lint = { error: e.message }; }
  return { v3: V3, style: tl.style, reelStyle: tl.reelStyle || '', durationMs: tl.durationMs, frames, lint, sheet: opts2.sheet ? sheet.toDataURL('image/png') : '' };
}

window.QA3 = { V3, loadMedia, renderReel, scaleSteps, styles: () => (V3 ? Object.fromEntries(Object.entries(ES.V3_STYLES || ES.STYLES).map(([k, v]) => [k, { id: v && v.id, label: v && v.label, blocks: v && v.blocks }])) : null), hasPillMetrics: Boolean(FR && FR.pillMetrics) };
return true;
})()`;

if (process.env.REELS3_REELSTYLE) await page.evaluate('window.__QA_REELSTYLE = true');
await page.evaluate(HARNESS);
const loaded = await page.evaluate(`QA3.loadMedia(${JSON.stringify(FIX.media)})`);
const v3 = await page.evaluate('QA3.V3');
const failures = [];
const notes = [];
if (!loaded.fonts) notes.push('Roboto Condensed did not load (offline?): text widths use a fallback font');
if (!v3) failures.push('engine v3 not present: ReelES.STYLES is missing (the reels below are drawn in today\'s ES style with the new blocks mapped to old ones)');
else {
  const st = await page.evaluate('QA3.styles()');
  const ids = Object.keys(st || {});
  if (ids.join() !== STYLE_IDS.join()) failures.push(`ReelES.V3_STYLES ids are ${ids.join(',')} (want ${STYLE_IDS.join(',')})`);
  for (const id of STYLE_IDS) if (st?.[id] && st[id].label !== STYLE_LABELS[id]) failures.push(`style ${id} label "${st[id].label}" (want "${STYLE_LABELS[id]}")`);
}
if (!(await page.evaluate('QA3.hasPillMetrics'))) failures.push('FrameUpRules.pillMetrics is not loaded on the reels page');

const summary = [];
for (const topic of FIX.topics) {
  for (const style of STYLES) {
    const r = await page.evaluate(`QA3.renderReel(window.__FIX || (window.__FIX = ${JSON.stringify(FIX)}), ${JSON.stringify(topic.id)}, ${JSON.stringify(style)}, { sheet: ${Boolean(SHEETS)}, guides: true })`);
    const tag = `${topic.id}/${style}`;
    if (r.error) { failures.push(`${tag}: ${r.error}`); continue; }
    if (v3 && r.reelStyle !== style) failures.push(`${tag}: the engine drew it as "${r.reelStyle || '?'}" (plan.esStyle = ${style}, plan.style = 'es': the engine does not read plan.esStyle)`);
    const bad = r.frames.filter(f => f.issues.length);
    const byRule = {};
    r.frames.forEach(f => f.issues.forEach(i => { byRule[i.rule] = (byRule[i.rule] || 0) + 1; }));
    summary.push(`${tag}: ${r.frames.length} scenes, ${(r.durationMs / 1000).toFixed(1)} s, ${bad.length} with issues ${JSON.stringify(byRule)}; lint ${r.lint ? (r.lint.error ? 'error ' + r.lint.error : r.lint.critical + ' critical') : 'n/a'}`);
    for (const f of bad) for (const i of f.issues) failures.push(`${tag} #${f.beat} (${f.type}) [${i.rule}] ${i.msg}`);
    // Lint gap: frames break brand rules the engine's checks did not flag as critical.
    if (bad.length && r.lint && !r.lint.error && r.lint.critical === 0 && v3) notes.push(`${tag}: lint gap: ${bad.length} frame(s) break brand rules but ReelES.checks has 0 critical`);
    for (const f of r.frames) for (const n of f.notes) notes.push(`${tag} #${f.beat}: ${n}`);
    if (SHEETS) {
      if (r.sheet) fs.writeFileSync(path.join(SHEETS, `${topic.id}-${style}.png`), Buffer.from(r.sheet.split(',')[1], 'base64'));
      fs.writeFileSync(path.join(SHEETS, `${topic.id}-${style}.json`), JSON.stringify({ ...r, sheet: undefined }, null, 2));
    }
  }
}
if (pageErrors.length) failures.push(...pageErrors.slice(0, 5).map(e => `page error: ${e}`));
cleanup();

for (const s of summary) console.log(s);
if (process.env.REELS3_NOTES) for (const n of notes) console.log(`note ${n}`);
// The scale is reported once per run when it is missing, not per frame.
const uniq = [...new Set(failures)];
for (const f of uniq.slice(0, 400)) console.log(`FAIL ${f}`);
if (uniq.length > 400) console.log(`... ${uniq.length - 400} more`);
console.log(`reels3 brand: ${FIX.topics.length} topics × ${STYLES.length} styles, ${uniq.length} failures, ${notes.length} notes${SHEETS ? `; sheets in ${SHEETS}` : ''}`);
process.exit(uniq.length ? 1 : 0);
