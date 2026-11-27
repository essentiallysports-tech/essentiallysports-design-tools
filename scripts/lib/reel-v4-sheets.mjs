#!/usr/bin/env node
// Reels Studio v4 golden frame sheets: the six reference reels (sample v4
// plans, SVG stand-ins), drawn by the real renderer in headless Chrome.
//   node scripts/lib/reel-v4-sheets.mjs <out-dir> [reelId…] [--full]
// Writes, per reel:
//   <id>-beats.png        frame one, every beat settled, the close
//   <id>-wipes.png        every chapter wipe: t-160, the cover, +160, the end (= next chapter's first frame)
//   <id>-beatcuts.png     every beat change inside a chapter: t-16, t+16, +200, +400, +800
//   <id>-<skin>-4x5.png   the 4:5 export's frames (one reel per skin)
//   frames/<id>-<n>.png   full-size settled frames (with --full)
// and lint.txt (ReelLint + the v4 checks) and pixels.txt (the wipe-end check).
import fs from 'node:fs';
import path from 'node:path';
import { findChrome, startServer, startChrome, sleep } from '../_qa-chrome.mjs';
import { REELS, REEL_ORDER, ASSETS, PICTURES, CUTOUTS, CORPUS, optsFor } from './reel-v4-samples.mjs';

const args = process.argv.slice(2);
const out = path.resolve(args.find(a => !a.startsWith('--') && !REEL_ORDER.includes(a)) || 'reels4-out/engine');
const only = args.filter(a => REEL_ORDER.includes(a));
const full = args.includes('--full');
fs.mkdirSync(path.join(out, 'frames'), { recursive: true });
const chromePath = findChrome();
if (!chromePath) { console.error('Chrome not found'); process.exit(1); }
const OPTS = Object.fromEntries(REEL_ORDER.map(id => [id, optsFor(id)]));

const page = `<!doctype html><meta charset="utf-8"><title>reels v4</title>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@500&family=Roboto+Condensed:wght@700;800&display=swap" rel="stylesheet">
<body style="margin:0;background:#888">
<script src="/video-ads-render.js"></script><script src="/frameup-rules.js"></script><script src="/reel-formats.js"></script><script src="/reel-es-themes.js"></script><script src="/reel-styles.js"></script>
<script src="/reel-es.js"></script><script src="/reel-es4.js"></script><script src="/reel-timeline.js"></script><script src="/reel-replay.js"></script>
<script src="/reel-render.js"></script><script src="/reel-lint.js"></script>
<script>
const REELS = ${JSON.stringify(REELS)}; const PICS = ${JSON.stringify(PICTURES)}; const CUTS = ${JSON.stringify(CUTOUTS)}; const OPTS = ${JSON.stringify(OPTS)};
const mc = document.createElement('canvas').getContext('2d');
const measure = (text, font) => { mc.font = font; return mc.measureText(text).width; };
const images = {}; const cutouts = {};
async function ready() {
  await Promise.all(['500 34px Roboto', '800 128px "Roboto Condensed"', '700 64px "Roboto Condensed"'].map(f => document.fonts.load(f)));
  await document.fonts.ready;
  await Promise.all(Object.entries(PICS).map(([id, svg]) => new Promise(res => { const im = new Image(); im.onload = () => { images[id] = im; res(); }; im.onerror = res; im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); })));
  Object.entries(CUTS).forEach(([id, pic]) => { cutouts[id] = images[pic]; });
  return { fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight) };
}
const build = (id, aspect = '9:16') => ReelRender.buildTimeline(REELS[id].plan, { ...OPTS[id], aspect, measure });
const env = () => ({ measure, images, videos: {}, cutouts });
function draw(tl, t) { const [W, H] = tl.size; const f = document.createElement('canvas'); f.width = W; f.height = H; ReelRender.drawFrame(f.getContext('2d'), tl, t, env()); return f; }
function strip(frames, scale, title, perRow = 8) {
  const tw = Math.round(frames[0].c.width * scale); const th = Math.round(frames[0].c.height * scale); const gap = 10; const head = 26;
  const rows = Math.ceil(frames.length / perRow); const cols = Math.min(perRow, frames.length);
  const c = document.createElement('canvas'); c.width = cols * (tw + gap) + gap; c.height = rows * (th + head + gap) + 30;
  const x = c.getContext('2d'); x.fillStyle = '#2E2E2E'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#FFF'; x.font = '500 16px Roboto'; x.fillText(title, gap, 20);
  frames.forEach((f, i) => { const cx = gap + (i % perRow) * (tw + gap); const cy = 30 + Math.floor(i / perRow) * (th + head + gap); x.imageSmoothingQuality = 'high'; x.drawImage(f.c, cx, cy + head, tw, th); x.fillStyle = '#FFF'; x.font = '500 13px Roboto'; x.fillText(f.label, cx, cy + 18); });
  return c.toDataURL('image/png');
}
const sec = t => (t / 1000).toFixed(2) + 's';
function beatsSheet(id) {
  const tl = build(id);
  const fr = [{ t: 0, label: 'frame one' }];
  tl.beats.forEach(b => fr.push({ t: Math.max(b.inMs + 1, b.outMs - (b.kind === 'cta' ? 200 : 420)), label: b.id + ' settled ' + sec(b.outMs - 420) }));
  const drawn = fr.map(f => ({ ...f, c: draw(tl, f.t) }));
  const mids = tl.beats.map(b => draw(tl, b.inMs + Math.min(1700, (b.outMs - b.inMs) / 2)).toDataURL('image/png'));
  return { png: strip(drawn, 0.25, REELS[id].label + ' · ' + tl.esStyle + ' / ' + tl.skin + ' · ' + sec(tl.durationMs) + ' · clips ' + tl.clipCount), full: drawn.map(f => f.c.toDataURL('image/png')), mids, dur: tl.durationMs };
}
function wipesSheet(id) {
  const tl = build(id);
  const fr = [];
  tl.wipes.forEach((w, i) => [[-WH - 16, 'tail −16'], [-160, '−160'], [0, 'cover'], [160, '+160'], [WH - 16, 'end −16'], [WH, 'END'], [WH + 16, '+16']].forEach(([d, l]) => fr.push({ t: w.at + d, label: 'wipe ' + (i + 1) + ' ' + l })));
  return strip(fr.map(f => ({ ...f, c: draw(tl, f.t) })), 0.2, REELS[id].label + ' · chapter wipes', 7);
}
const WH = 320;
function beatCutsSheet(id) {
  const tl = build(id);
  const fr = [];
  tl.beats.forEach((b, i) => { const prev = tl.beats[i - 1]; if (!prev || prev.chapter !== b.chapter) return; [[-16, '−16'], [16, '+16'], [200, '+200'], [400, '+400'], [800, '+800'], [1400, '+1400']].forEach(([d, l]) => fr.push({ t: b.inMs + d, label: b.id + ' ' + l })); });
  if (!fr.length) return null;
  return strip(fr.map(f => ({ ...f, c: draw(tl, f.t) })), 0.2, REELS[id].label + ' · beat changes (morphs)', 6);
}
function fourFive(id) {
  const tl = build(id, '4:5');
  const fr = [{ t: 0, label: 'frame one' }, ...tl.beats.map(b => ({ t: b.outMs - 420, label: b.id }))];
  return strip(fr.map(f => ({ ...f, c: draw(tl, f.t) })), 0.25, REELS[id].label + ' · 4:5');
}
// Pixel check: the wipe's end frame vs the next chapter's first frame as
// revealed mid-wipe (outside the slab), and the frame 16 ms later.
function pixels(id) {
  const tl = build(id);
  const res = [];
  const diff = (a, b, mask) => { const A = a.getContext('2d').getImageData(0, 0, a.width, a.height).data; const B = b.getContext('2d').getImageData(0, 0, b.width, b.height).data; let n = 0; let bad = 0; let sum = 0; for (let y = 0; y < a.height; y += 4) for (let x = 0; x < a.width; x += 4) { if (mask && !mask(x, y)) continue; const i = (y * a.width + x) * 4; const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]); sum += d; n += 1; if (d > 48) bad += 1; } return { mean: sum / Math.max(1, n) / 3, bad: bad / Math.max(1, n) }; };
  tl.wipes.forEach((w, i) => {
    const end = draw(tl, w.at + WH);
    const mid = draw(tl, w.at + 160);
    const poly = ReelES4.slabPoly((160 + WH) / 640, tl.size[0], tl.size[1]);
    const markOut = (x, y) => !(x > 900 && y < 470);
    const a = diff(end, mid, (x, y) => !ReelES4.inPoly(poly, x, y) && markOut(x, y));
    const b = diff(end, draw(tl, w.at + WH + 16), markOut);
    res.push({ wipe: i + 1, revealedVsEnd: a, endVsNext16: b });
  });
  return res;
}
function lintOf(id) {
  const tl = build(id);
  return ReelLint.lintTimeline(tl, { measure, boxes: null }).issues.filter(i => i.severity !== 'info').map(i => i.severity + ' ' + i.id + ': ' + i.message);
}
</script>`;

const { server, base } = await startServer({ extra: url => (url.pathname === '/__qa/v4.html' ? { type: 'text/html', body: page } : null) });
const chrome = await startChrome(chromePath, { width: 1200, height: 900 });
const save = (file, dataUrl) => fs.writeFileSync(path.join(out, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
try {
  await chrome.send('Page.enable');
  await chrome.send('Page.navigate', { url: `${base}/__qa/v4.html` });
  await sleep(1500);
  const info = await chrome.evaluate('ready()');
  console.log('fonts:', info.fonts.join(', '));
  const lint = [];
  const px = [];
  for (const id of only.length ? only : REEL_ORDER) {
    const r = await chrome.evaluate(`beatsSheet(${JSON.stringify(id)})`);
    save(`${id}-beats.png`, r.png);
    if (full) { r.full.forEach((png, i) => save(`frames/${id}-${i}.png`, png)); r.mids.forEach((png, i) => save(`frames/${id}-mid-${i + 1}.png`, png)); }
    save(`${id}-wipes.png`, await chrome.evaluate(`wipesSheet(${JSON.stringify(id)})`));
    const cuts = await chrome.evaluate(`beatCutsSheet(${JSON.stringify(id)})`);
    if (cuts) save(`${id}-beatcuts.png`, cuts);
    if (id === 'dallas' || id === 'rodgers') save(`${id}-4x5.png`, await chrome.evaluate(`fourFive(${JSON.stringify(id)})`));
    const p = await chrome.evaluate(`pixels(${JSON.stringify(id)})`);
    p.forEach(x => px.push(`${id} wipe ${x.wipe}: revealed-vs-end mean ${x.revealedVsEnd.mean.toFixed(2)} bad ${(x.revealedVsEnd.bad * 100).toFixed(2)}% · end-vs-+16ms mean ${x.endVsNext16.mean.toFixed(2)} bad ${(x.endVsNext16.bad * 100).toFixed(2)}%`));
    const l = await chrome.evaluate(`lintOf(${JSON.stringify(id)})`);
    l.forEach(i => lint.push(`${id}: ${i}`));
    console.log(id, `${(r.dur / 1000).toFixed(1)} s`, `${l.length} lint (non-info)`);
  }
  fs.writeFileSync(path.join(out, 'lint.txt'), lint.join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'pixels.txt'), px.join('\n') + '\n');
  lint.forEach(x => console.log('  ' + x));
  px.forEach(x => console.log('  ' + x));
} finally { chrome.close(); server.close(); }
void CORPUS; void ASSETS;
