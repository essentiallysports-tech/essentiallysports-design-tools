#!/usr/bin/env node
// Frame sheets for the ES looks review: six sample stories (stat, quote,
// comparison, scale/dots, statement-led news, photo-led) in every look, at
// 9:16 and 4:5, drawn by the real renderer in headless Chrome. Each sheet
// shows frame one, a mid-wipe, every block settled (with its caption) and the
// end card. Also one contact sheet per look and aspect.
//   node scripts/lib/reel-looks-sheets.mjs <out-dir> [look ...]
// Stand-in photos are drawn SVG figures (no photo rights involved).
import fs from 'node:fs';
import path from 'node:path';
import { findChrome, startServer, startChrome, figureSvg, sleep } from '../_qa-chrome.mjs';
import { STORIES, STORY_IDS, CORPUS } from './reel-looks-samples.mjs';

const out = path.resolve(process.argv[2] || 'reels2-out/looks');
const only = process.argv.slice(3);
fs.mkdirSync(out, { recursive: true });
const chromePath = findChrome();
if (!chromePath) { console.error('Chrome not found'); process.exit(1); }

const photos = {
  p1: figureSvg({ pose: 'swing', cutout: false, colour: '#005A9C', w: 1200, h: 1600 }),
  p2: figureSvg({ pose: 'stand', cutout: false, colour: '#1D428A', w: 1200, h: 1600 }),
  p3: figureSvg({ pose: 'bust', cutout: false, colour: '#C8102E', w: 1200, h: 1600 }),
};
const page = `<!doctype html><meta charset="utf-8"><title>looks</title>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@500&family=Roboto+Condensed:wght@700;800&display=swap" rel="stylesheet">
<body style="margin:0;background:#888">
<script src="/video-ads-render.js"></script><script src="/reel-formats.js"></script><script src="/reel-styles.js"></script>
<script src="/reel-es-themes.js"></script><script src="/reel-es.js"></script><script src="/reel-timeline.js"></script><script src="/reel-replay.js"></script>
<script src="/reel-render.js"></script><script src="/reel-lint.js"></script>
<script>
const STORIES = ${JSON.stringify(STORIES)}; const CORPUS = ${JSON.stringify(CORPUS)}; const PHOTOS = ${JSON.stringify(photos)};
const mc = document.createElement('canvas').getContext('2d');
const measure = (text, font) => { mc.font = font; return mc.measureText(text).width; };
const images = {};
const grain = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const d = x.createImageData(128, 128); for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } x.putImageData(d, 0, 0); return c; })();
async function ready() {
  await Promise.all(['500 34px Roboto', '800 128px "Roboto Condensed"', '700 64px "Roboto Condensed"'].map(f => document.fonts.load(f)));
  await document.fonts.ready;
  await Promise.all(Object.entries(PHOTOS).map(([id, svg]) => new Promise(res => { const im = new Image(); im.onload = () => { images[id] = im; res(); }; im.onerror = res; im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); })));
  return { fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight) };
}
function build(story, look, aspect, team) {
  const photo = story === 'photo';
  return ReelRender.buildTimeline(STORIES[story], { style: 'es', look, aspect, corpus: CORPUS, team: team ? { name: 'Team', colors: [team] } : null,
    ...(photo ? { photos: { b1: ['p1'], b2: ['p2'], b3: ['p3'] }, assets: { p1: { id: 'p1', kind: 'photo' }, p2: { id: 'p2', kind: 'photo' }, p3: { id: 'p3', kind: 'photo' } } } : {}) });
}
// frame one, a mid-wipe (the blue slab leading the cover slab), each block settled, the end card.
function times(tl) {
  const g = tl.tracks.graphics;
  const list = [{ t: 0, label: 'frame one' }];
  if (g[1]) list.push({ t: g[1].inMs + 150, label: 'mid-wipe' });
  g.forEach((x, i) => { if (i < g.length - 1) list.push({ t: Math.min(x.outMs - 60, x.inMs + 2600), label: x.data.block.type }); });
  const e = g[g.length - 1];
  list.push({ t: e.inMs + 2200, label: 'end card' });
  return list;
}
function sheet(story, look, aspect, team, scale = 0.25) {
  const tl = build(story, look, aspect, team);
  const [W, H] = tl.size;
  const ts = times(tl);
  const tw = Math.round(W * scale); const th = Math.round(H * scale); const gap = 8; const head = 22;
  const c = document.createElement('canvas');
  c.width = ts.length * (tw + gap) + gap; c.height = th + head + gap;
  const x = c.getContext('2d');
  x.fillStyle = '#3A3A3A'; x.fillRect(0, 0, c.width, c.height);
  const f = document.createElement('canvas'); f.width = W; f.height = H; const fx = f.getContext('2d');
  ts.forEach((it, i) => {
    fx.setTransform(1, 0, 0, 1, 0, 0);
    ReelRender.drawFrame(fx, tl, it.t, { measure, images, videos: {}, cutouts: {}, grain });
    x.imageSmoothingQuality = 'high';
    x.drawImage(f, gap + i * (tw + gap), head, tw, th);
    x.fillStyle = '#FFFFFF'; x.font = '500 13px Roboto'; x.fillText((i === 0 ? look + (team ? ' ' + team : '') + ' / ' + story + ' / ' + aspect + ' : ' : '') + it.label, gap + i * (tw + gap), 15);
  });
  const lint = ReelLint.lintTimeline(tl, { boxes: ReelRender.textBoxes(measure, tl), measure });
  return { canvas: c, issues: lint.issues.filter(i => i.severity !== 'info' && i.id !== 'rights').map(i => i.id + ': ' + i.message) };
}
function one(story, look, aspect, team) { const s = sheet(story, look, aspect, team, 0.5); return { png: s.canvas.toDataURL('image/png'), issues: s.issues }; }
function contact(look, aspect, team, stories) {
  const sheets = stories.map(s => sheet(s, look, aspect, team, 0.25).canvas);
  const c = document.createElement('canvas');
  c.width = Math.max(...sheets.map(s => s.width)); c.height = sheets.reduce((a, s) => a + s.height, 0);
  const x = c.getContext('2d'); x.fillStyle = '#3A3A3A'; x.fillRect(0, 0, c.width, c.height);
  let y = 0; sheets.forEach(s => { x.drawImage(s, 0, y); y += s.height; });
  return c.toDataURL('image/jpeg', 0.9);
}
</script>`;

const { server, base } = await startServer({ extra: url => (url.pathname === '/__qa/looks.html' ? { type: 'text/html', body: page } : null) });
const chrome = await startChrome(chromePath, { width: 1200, height: 900 });
const save = (file, dataUrl) => fs.writeFileSync(path.join(out, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
try {
  await chrome.send('Page.enable');
  await chrome.send('Page.navigate', { url: `${base}/__qa/looks.html` });
  await sleep(1500);
  const info = await chrome.evaluate('ready()');
  console.log('fonts:', info.fonts.join(', '));
  // The Team colour look is reviewed with a dark and a light team colour.
  const variants = [['paper'], ['ink'], ['blue'], ['team', '#0B162A', 'team-dark'], ['team', '#FFB612', 'team-light'], ['team', '#C8102E', 'team-red'], ['photo'], ['data'], ['minimal'], ['bold']]
    .filter(v => !only.length || only.includes(v[0]) || only.includes(v[2]));
  const problems = [];
  for (const [look, team = '', name = look] of variants) {
    for (const aspect of ['9:16', '4:5']) {
      const tag = aspect.replace(':', 'x');
      for (const story of STORY_IDS) {
        const r = await chrome.evaluate(`one(${JSON.stringify(story)}, ${JSON.stringify(look)}, ${JSON.stringify(aspect)}, ${JSON.stringify(team)})`);
        save(`${name}-${story}-${tag}.png`, r.png);
        r.issues.forEach(i => problems.push(`${name} ${story} ${aspect}: ${i}`));
      }
      save(`contact-${name}-${tag}.jpg`, await chrome.evaluate(`contact(${JSON.stringify(look)}, ${JSON.stringify(aspect)}, ${JSON.stringify(team)}, ${JSON.stringify(STORY_IDS)})`));
    }
    console.log('done', name);
  }
  fs.writeFileSync(path.join(out, 'lint.txt'), problems.join('\n') + '\n');
  console.log(`lint issues (not info): ${problems.length}`);
  problems.slice(0, 40).forEach(p => console.log('  ' + p));
} finally { chrome.close(); server.close(); }
