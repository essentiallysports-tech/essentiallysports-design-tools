// Generate composed designs: renders every composition that fits each of 24
// briefs (scripts/_qa-generate-fixtures.mjs) in real headless Chrome with the
// page's renderer (frameup-compose.js), and fails on:
//   - a number glyph under a cut-out's head or face (measured here from the
//     cut-out's own pixels, not from the renderer's report);
//   - text drawn over a cut-out's face (headline, pill, label);
//   - two text blocks colliding (one drawn over the other);
//   - text that does not fit its box (cut off);
//   - a missing image;
//   - an empty area: a flat, empty third of the design (3 x 3 grid).
// Every brief: all fitting compositions x 3 variants at 4:5, plus 9:16 and 1:1.
// The briefs' people are drawn as plain SVG figures (stand / bust / swing pose)
// so the check needs no photos and no network.
// Run: node scripts/check-generate-designs.mjs   (skips if Chrome isn't installed)
//   QA_DESIGNS_OUT=<dir>  also writes a contact sheet of every flagged design.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, findChrome, startServer, startChrome, sleep } from './_qa-chrome.mjs';
import { BRIEFS, buildPlan, qaFile } from './_qa-generate-fixtures.mjs';

const CHROME = findChrome();
if (!CHROME) { console.log('generate designs: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('generate designs: skipped (needs Node with WebSocket)'); process.exit(0); }
const require = createRequire(import.meta.url);
const C = require(path.join(ROOT, 'frameup-compose.js'));

// ── The scenes: what Generate can show for each brief ─────────────────────
const jobs = [];
for (const brief of BRIEFS) {
  const plan = await buildPlan(brief.text);
  const inputs = plan.directions.map(d => d.input).filter(Boolean);
  // The richest input first (a cut-out, the most numbers), so every look gets a chance.
  inputs.sort((a, b) => (Boolean(b.cutout) - Boolean(a.cutout)) || ((b.numbers?.length || 0) - (a.numbers?.length || 0)));
  const seen = new Set();
  plan.directions.forEach(d => d.candidates.forEach(scene => {
    const k = `${scene.archetype}|${scene.variant}|${scene.size?.w}x${scene.size?.h}|plan`;
    if (!seen.has(k)) { seen.add(k); jobs.push({ brief: brief.id, scene, why: 'plan' }); }
  }));
  for (const a of C.ARCHETYPES) {
    const input = inputs.find(i => { try { return C.fits(a.id, i); } catch { return false; } });
    if (!input) continue;
    const sizes = [['portrait', [0, 1, 2]], ['story', [0]], ['square', [0]]];
    for (const [size, variants] of sizes) {
      for (const v of variants) {
        let scene = null;
        try {
          const inp = { ...input, size };
          if (C.fits(a.id, inp) === false) continue;
          scene = C.build(a.id, inp, v);
        } catch { scene = null; }
        if (!scene) continue;
        const checked = C.checkScene(scene, { facts: input.facts });
        if (!checked.ok) continue; // the gate drops it before anyone sees it
        const k = `${a.id}|${v}|${size}|${brief.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        jobs.push({ brief: brief.id, scene: checked.scene, why: `${size} v${v}` });
      }
    }
  }
}

// QA_COMPOSE=<file>: render with another frameup-compose.js (a before / after comparison).
const OVERRIDE = process.env.QA_COMPOSE ? fs.readFileSync(process.env.QA_COMPOSE, 'utf8') : '';
const { server, base } = await startServer({ extra: url => (OVERRIDE && url.pathname === '/frameup-compose.js' ? { type: 'text/javascript', body: OVERRIDE } : url.pathname === '/__qa-designs.html' ? { type: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>designs</title><body style="margin:0"><script src="/frameup-compose.js"></script>' } : qaFile(url)) });
const chrome = await startChrome(CHROME);
const { send, evaluate } = chrome;
const stop = () => { chrome.close(); server.close(); };

const PROBE = `(async (jobs, scale) => {
  const C = window.FrameUpCompose;
  const out = [];
  const imgs = new Map();
  const load = src => { if (!imgs.has(src)) imgs.set(src, new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; })); return imgs.get(src); };
  // The check's own head finder (independent of the renderer's): the top of the
  // first solid band of the figure, about a head tall, around the band's peak.
  async function headOf(src, box) {
    const img = await load(src);
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(box.w * scale)); c.height = Math.max(1, Math.round(box.h * scale));
    const t = document.createElement('canvas'); t.width = img.naturalWidth || img.width; t.height = img.naturalHeight || img.height;
    const tg = t.getContext('2d'); tg.drawImage(img, 0, 0, t.width, t.height);
    const d0 = tg.getImageData(0, 0, t.width, t.height).data;
    let x0 = t.width, y0 = t.height, x1 = 0, y1 = 0;
    for (let y = 0; y < t.height; y += 2) for (let x = 0; x < t.width; x += 2) if (d0[(y * t.width + x) * 4 + 3] > 24) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 <= x0) return null;
    const g = c.getContext('2d'); g.drawImage(t, x0, y0, x1 - x0 + 2, y1 - y0 + 2, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const W = c.width, H = c.height;
    const rows = []; for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 96) n++; rows.push(n); }
    const widest = Math.max(...rows); if (widest < 3) return null;
    const top = rows.findIndex(n => n >= 0.2 * widest);
    const bh = Math.min(0.3 * (H - top), 0.4 * widest);
    const cols = new Array(W).fill(0);
    for (let y = top; y < Math.min(H, top + bh); y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 96) cols[x]++;
    const peak = Math.max(...cols); let a = cols.indexOf(peak), b = a;
    while (a > 0 && cols[a - 1] >= peak * 0.5) a--; while (b < W - 1 && cols[b + 1] >= peak * 0.5) b++;
    return { x: box.x + a / scale, y: box.y + top / scale, w: (b - a + 1) / scale, h: bh / scale };
  }
  const meet = (p, q, pad = 0) => p.x < q.x + q.w - pad && q.x < p.x + p.w - pad && p.y < q.y + q.h - pad && q.y < p.y + p.h - pad;
  const area = (p, q) => Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)) * Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
  for (const job of jobs) {
    const scene = job.scene;
    const canvas = document.createElement('canvas');
    let report;
    try { report = await C.render(scene, canvas, { scale }); } catch (error) { out.push({ ...job.meta, problems: ['render failed: ' + error.message] }); continue; }
    const problems = [];
    const items = report.items || [];
    // Cut-outs, in drawing order, with the number items drawn before each.
    const cutLayers = scene.layers.filter(l => l.type === 'cutout' && !l.breakout);
    const numBefore = []; let nNum = 0;
    scene.layers.forEach(l => { if (l.type === 'number') nNum++; if (l.type === 'cutout' && !l.breakout) numBefore.push(nNum); });
    const numItems = items.filter(i => i.type === 'number');
    const drawn = (report.cutouts || []);
    for (let k = 0; k < Math.min(cutLayers.length, drawn.length); k++) {
      const head = await headOf(cutLayers[k].src, drawn[k]);
      if (!head) continue;
      // gen5: a board number may sit behind the head for its declared foot (n.overlap, as on the ES board's "25-2").
      numItems.slice(0, numBefore[k]).forEach(n => { const box = n.overlap ? { ...n.box, h: n.box.h * (1 - n.overlap) } : n.box; if (meet(head, box, n.overlap ? 0 : 4)) problems.push('number under the head: ' + Math.round(area(head, box)) + 'px²'); });
      // Text drawn after the figure, over its face (the middle of the head box).
      const face = { x: head.x + head.w * 0.2, y: head.y + head.h * 0.25, w: head.w * 0.6, h: head.h * 0.55 };
      const after = drawn[k].at != null ? items.slice(drawn[k].at) : [];
      after.filter(i => i.box && i.type !== 'number' && meet(face, i.box, 2)).forEach(i => problems.push('text over the face: ' + (i.role || i.type)));
    }
    // Text collisions: two text blocks of different roles drawn over each other.
    const texts = items.filter(i => i.box && i.box.w > 2 && i.box.h > 2 && (i.type === 'text' || i.type === 'pill' || i.type === 'number'));
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const p = texts[i].box, q = texts[j].box;
      const ov = area(p, q);
      if (ov > 0.08 * Math.min(p.w * p.h, q.w * q.h) && ov > 200) problems.push('text collision: ' + (texts[i].role || texts[i].type) + ' / ' + (texts[j].role || texts[j].type));
    }
    items.filter(i => i.overflow).forEach(i => problems.push('cut off: ' + (i.role || i.type)));
    if (report.missing?.length) problems.push('missing image');
    // Empty thirds: a flat cell (no detail) that nothing is drawn in.
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const px = g.getImageData(0, 0, W, H).data;
    const empty = [];
    for (let cy = 0; cy < 3; cy++) for (let cx = 0; cx < 3; cx++) {
      if (cy === 0 && cx === 2) continue; // the ES mark's corner
      let n = 0, sum = 0, sq = 0;
      for (let y = Math.floor(cy * H / 3); y < (cy + 1) * H / 3; y += 3) for (let x = Math.floor(cx * W / 3); x < (cx + 1) * W / 3; x += 3) {
        const o = (y * W + x) * 4; const l = 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]; n++; sum += l; sq += l * l;
      }
      const sd = Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2));
      if (sd < 2.5) empty.push(['top-left', 'top', '', 'left', 'centre', 'right', 'bottom-left', 'bottom', 'bottom-right'][cy * 3 + cx]);
    }
    if (empty.length) problems.push('empty area: ' + empty.join(', '));
    out.push({ problems, thumb: problems.length || job.pick ? canvas.toDataURL('image/jpeg', 0.7) : '' });
  }
  return out;
})`;

// QA_DESIGNS_PICK=<regex on brief-archetype-size>: also save those designs (with QA_DESIGNS_OUT).
const PICK = new RegExp(process.env.QA_DESIGNS_PICK || '^$');
let exitCode = 0;
try {
  await send('Page.enable');
  await send('Page.navigate', { url: `${base}/__qa-designs.html` });
  for (let i = 0; i < 60 && !(await evaluate('Boolean(window.FrameUpCompose)').catch(() => false)); i++) await sleep(150);
  const started = Date.now();
  const results = [];
  const BATCH = 40;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const part = jobs.slice(i, i + BATCH);
    const r = await evaluate(`${PROBE}(${JSON.stringify(part.map(j => ({ scene: j.scene, pick: PICK.test(`${j.brief}-${j.scene.archetype}-${j.why.replace(/\s+/g, '')}`) })))}, 0.4)`);
    r.forEach((x, k) => results.push({ ...part[k], ...x }));
  }
  const bad = results.filter(r => r.problems?.length);
  if (process.env.QA_DESIGNS_OUT) {
    const dir = path.join(process.env.QA_DESIGNS_OUT, 'picked');
    fs.mkdirSync(dir, { recursive: true });
    results.filter(r => r.thumb && !r.problems?.length).forEach(r => fs.writeFileSync(path.join(dir, `${r.brief}-${r.scene.archetype}-${r.why.replace(/\s+/g, '')}.jpg`), Buffer.from(r.thumb.split(',')[1], 'base64')));
  }
  const byKind = {};
  bad.forEach(r => r.problems.forEach(p => { const k = p.split(':')[0]; byKind[k] = (byKind[k] || 0) + 1; }));
  // Fatal everywhere: these were fixed at the root (renderer / gate) and must stay at 0.
  const FATAL = /^(number under the head|text over the face|missing image|render failed)/;
  const fatal = bad.filter(r => r.problems.some(p => FATAL.test(p)));
  const verbose = process.env.QA_DESIGNS_VERBOSE;
  (verbose ? bad : fatal).forEach(r => console.log(`${fatal.includes(r) ? 'FAIL' : 'known'} ${r.brief} · ${r.scene.archetype} · ${r.why} · ${r.scene.tone || ''}: ${[...new Set(r.problems)].join('; ')}`));
  if (process.env.QA_DESIGNS_OUT && bad.length) {
    const dir = process.env.QA_DESIGNS_OUT;
    fs.mkdirSync(dir, { recursive: true });
    bad.forEach((r, k) => fs.writeFileSync(path.join(dir, `${String(k).padStart(3, '0')}-${r.brief}-${r.scene.archetype}-${r.why.replace(/\s+/g, '')}.jpg`), Buffer.from(r.thumb.split(',')[1], 'base64')));
  }
  const archetypes = new Set(results.map(r => r.scene.archetype)).size;
  console.log(`generate designs: ${results.length} designs (${BRIEFS.length} briefs, ${archetypes} compositions) in ${Math.round((Date.now() - started) / 1000)}s; ${bad.length} with problems ${JSON.stringify(byKind)}`);
  // Layout debts that are not fixed yet (mostly 1:1 and 9:16 resizes of a few
  // compositions): ratcheted, so they can only go down. Lower these numbers when
  // you fix some; QA_DESIGNS_VERBOSE=1 lists every one.
  // gen4-quality (2026-11-21): 86 / 59 / 490 -> 75 / 55 / 452 (typographic poster, light stat card,
  // big-number with cut-out, split panel without a tag).
  const CEILING = { 'text collision': 69, 'cut off': 55, 'empty area': 430 };
  const over = Object.entries(CEILING).filter(([k, max]) => (byKind[k] || 0) > max);
  over.forEach(([k, max]) => console.log(`FAIL ${k}: ${byKind[k]} designs, more than the known ${max} (run with QA_DESIGNS_VERBOSE=1)`));
  if (fatal.length || over.length) exitCode = 1;
} catch (error) {
  console.error('generate designs: error', error);
  exitCode = 1;
} finally {
  stop();
}
process.exit(exitCode);
