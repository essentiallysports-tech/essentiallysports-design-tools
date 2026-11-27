#!/usr/bin/env node
// Reels Studio v3 golden frame sheets: the four styles (one sample reel each,
// from the team's reference topics) and every new block, drawn by the real
// renderer in headless Chrome at 9:16 (and 4:5 for the style reels).
//   node scripts/lib/reel-v3-sheets.mjs <out-dir>
// Writes style-<id>-<aspect>.png (frame one, each scene settled, the end
// card), block-<type>.png (a block's scene early, mid-build and settled),
// frame-<style>-<n>.png (full-size settled frames) and lint.txt.
import fs from 'node:fs';
import path from 'node:path';
import { findChrome, startServer, startChrome, figureSvg, sleep } from '../_qa-chrome.mjs';
import { REELS, STYLE_ORDER, ASSETS, PICTURES, CORPUS } from './reel-v3-samples.mjs';

const out = path.resolve(process.argv[2] || 'reels3-out/engine');
fs.mkdirSync(out, { recursive: true });
const chromePath = findChrome();
if (!chromePath) { console.error('Chrome not found'); process.exit(1); }
const pictures = Object.fromEntries(Object.entries(PICTURES).map(([id, p]) => [id, figureSvg({ pose: p.pose, cutout: false, colour: p.colour, w: 1200, h: 1600 })]));

const page = `<!doctype html><meta charset="utf-8"><title>reels v3</title>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@500&family=Roboto+Condensed:wght@700;800&display=swap" rel="stylesheet">
<body style="margin:0;background:#888">
<script src="/video-ads-render.js"></script><script src="/frameup-rules.js"></script><script src="/reel-formats.js"></script><script src="/reel-es-themes.js"></script><script src="/reel-styles.js"></script>
<script src="/reel-es.js"></script><script src="/reel-timeline.js"></script><script src="/reel-replay.js"></script>
<script src="/reel-render.js"></script><script src="/reel-lint.js"></script>
<script>
const REELS = ${JSON.stringify(REELS)}; const ASSETS = ${JSON.stringify(ASSETS)}; const PICS = ${JSON.stringify(pictures)}; const CORPUS = ${JSON.stringify(CORPUS)};
const mc = document.createElement('canvas').getContext('2d');
const measure = (text, font) => { mc.font = font; return mc.measureText(text).width; };
const images = {};
const grain = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const d = x.createImageData(128, 128); for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } x.putImageData(d, 0, 0); return c; })();
async function ready() {
  await Promise.all(['500 34px Roboto', '800 128px "Roboto Condensed"', '700 64px "Roboto Condensed"'].map(f => document.fonts.load(f)));
  await document.fonts.ready;
  await Promise.all(Object.entries(PICS).map(([id, svg]) => new Promise(res => { const im = new Image(); im.onload = () => { images[id] = im; res(); }; im.onerror = res; im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); })));
  return { fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight) };
}
const build = (id, aspect) => ReelRender.buildTimeline(REELS[id].plan, { style: id, aspect, corpus: CORPUS, assets: ASSETS, photos: REELS[id].photos });
const env = () => ({ measure, images, videos: {}, cutouts: {}, grain });
function draw(tl, t) { const [W, H] = tl.size; const f = document.createElement('canvas'); f.width = W; f.height = H; ReelRender.drawFrame(f.getContext('2d'), tl, t, env()); return f; }
function strip(frames, scale, title) {
  const tw = Math.round(frames[0].c.width * scale); const th = Math.round(frames[0].c.height * scale); const gap = 10; const head = 26;
  const c = document.createElement('canvas'); c.width = frames.length * (tw + gap) + gap; c.height = th + head + gap;
  const x = c.getContext('2d'); x.fillStyle = '#2E2E2E'; x.fillRect(0, 0, c.width, c.height);
  frames.forEach((f, i) => { x.imageSmoothingQuality = 'high'; x.drawImage(f.c, gap + i * (tw + gap), head, tw, th); x.fillStyle = '#FFF'; x.font = '500 14px Roboto'; x.fillText((i === 0 && title ? title + ' : ' : '') + f.label, gap + i * (tw + gap), 18); });
  return c;
}
function lintOf(tl) { return ReelLint.lintTimeline(tl, { boxes: ReelRender.textBoxes(measure, tl), measure }).issues.filter(i => i.severity !== 'info' && i.id !== 'rights').map(i => i.severity + ' ' + i.id + ': ' + i.message); }
function styleSheet(id, aspect) {
  const tl = build(id, aspect);
  const g = tl.tracks.graphics;
  const frames = [{ t: 0, label: 'frame one' }];
  g.forEach((x, i) => { if (i > 0 && i < g.length - 1) frames.push({ t: Math.min(x.outMs - 60, x.inMs + 2400), label: x.data.block.type }); });
  frames.push({ t: g[g.length - 1].inMs + 2200, label: 'end card' });
  const drawn = frames.map(f => ({ ...f, c: draw(tl, f.t) }));
  return { png: strip(drawn, 0.42, ReelES.STYLES[id].label + ' ' + aspect).toDataURL('image/png'), full: aspect === '9:16' ? drawn.map(f => f.c.toDataURL('image/png')) : [], issues: lintOf(tl), dur: tl.durationMs };
}
// A block's scene through its build: just in, mid-build, settled.
function blockSheet(id, beatIndex) {
  const tl = build(id, '9:16');
  const x = tl.tracks.graphics[beatIndex];
  const ts = [[x.inMs + 420, 'entering'], [x.inMs + 900, 'building'], [Math.min(x.outMs - 60, x.inMs + 2600), 'settled']];
  return strip(ts.map(([t, label]) => ({ t, label, c: draw(tl, t) })), 0.42, x.data.block.type + ' (' + ReelES.STYLES[id].label + ')').toDataURL('image/png');
}
</script>`;

const { server, base } = await startServer({ extra: url => (url.pathname === '/__qa/v3.html' ? { type: 'text/html', body: page } : null) });
const chrome = await startChrome(chromePath, { width: 1200, height: 900 });
const save = (file, dataUrl) => fs.writeFileSync(path.join(out, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
try {
  await chrome.send('Page.enable');
  await chrome.send('Page.navigate', { url: `${base}/__qa/v3.html` });
  await sleep(1500);
  const info = await chrome.evaluate('ready()');
  console.log('fonts:', info.fonts.join(', '));
  const problems = [];
  for (const id of STYLE_ORDER) {
    for (const aspect of ['9:16', '4:5']) {
      const r = await chrome.evaluate(`styleSheet(${JSON.stringify(id)}, ${JSON.stringify(aspect)})`);
      save(`style-${id}-${aspect.replace(':', 'x')}.png`, r.png);
      r.full.forEach((png, i) => save(`frame-${id}-${i}.png`, png));
      r.issues.forEach(i => problems.push(`${id} ${aspect}: ${i}`));
      console.log(id, aspect, `${(r.dur / 1000).toFixed(1)} s`, `${r.issues.length} issues`);
    }
  }
  // Every new block, from the sample reels.
  const blocks = [];
  STYLE_ORDER.forEach(id => REELS[id].plan.beats.forEach((b, i) => { if (b.block && !blocks.some(x => x.type === b.block.type)) blocks.push({ type: b.block.type, id, i }); }));
  for (const b of blocks.filter(x => !['hook', 'statement', 'endcard'].includes(x.type))) save(`block-${b.type}.png`, await chrome.evaluate(`blockSheet(${JSON.stringify(b.id)}, ${b.i})`));
  fs.writeFileSync(path.join(out, 'lint.txt'), problems.join('\n') + '\n');
  console.log(`lint issues (not info, not rights): ${problems.length}`);
  problems.slice(0, 40).forEach(p => console.log('  ' + p));
} finally { chrome.close(); server.close(); }
