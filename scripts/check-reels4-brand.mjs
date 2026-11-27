#!/usr/bin/env node
// Reels Studio v4 brand check (QA lane). Renders every reference reel
// (scripts/fixtures/reels4/reference-plans.json: Rams, Dallas, Kittle, Rodgers,
// Chiefs, Ravens) in its own style with the real engine (the scripts
// reel-maker.html loads, frameup-rules.js through reel-lint.js) in headless
// Chrome, records every canvas draw call (scripts/lib/reels4-frame-lab.js) and
// asserts on what was actually drawn:
//   v3 brand rules (one settled frame per beat)
//     scale    every word's drawn size is a step of ReelES.TYPE_SCALE
//     pill     every one-line text box is an ES pill (FrameUpRules.pillMetrics height and left pad)
//     fit      no word cut off by a clip or squeezed with maxWidth
//     copy     every drawn word is a whole word of the plan (headline, marker, VO, module, stamp,
//              tag, label, close, source); numbers may be formatted
//     frame    every word inside the ES frame (x 40..1040, y 300..1640)
//     colour   words are ink, white, paper, ES blue or the red signal; <= 2 signal colours a frame
//   v4 rules
//     zones    the headline, media, data and caption zones do not overlap; the headline zone sits
//              above the media and data zones; each zone keeps one place across the reel (one grid);
//              the engine's ZONES are used when it exposes them
//     headline held for the whole chapter (same words, same place on every beat) with one coloured
//              word (the *emphasis*), blue or red as the chapter's tone
//     mark     the ES mark top right on EVERY sampled frame (v4: always shown)
//     stamp    every stamp is drawn rotated, within the limits (engine STAMP limits, else 2..12 deg)
//     caption  captions are 1-3 words at every sampled moment, mid-frame, highlight in ES blue only
// Also: ReelES.STYLES is the 4 v4 styles (ids, labels, previewPlan), the legacy map (receipts /
// statcard with dots -> outlier, else breakdown; gametape / hypecut -> breakdown), ReelES.toV4 on
// a v3 plan (one chapter per 2-3 beats), and the engine's own lint per reel (a frame that breaks a
// rule while lint passes is a lint gap).
// Frame sheets: REELS4_SHEETS=<dir> writes <reel>.png (a thumbnail per beat, problems in red) and
// <reel>.json (per-frame findings). REELS4_ONLY=dallas,kittle limits reels.
// Run: node scripts/check-reels4-brand.mjs   (skips without Chrome)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, findChrome, startServer, startChrome, sleep, figureSvg } from './_qa-chrome.mjs';

const CHROME = findChrome();
if (!CHROME) { console.log('reels4 brand: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('reels4 brand: skipped (needs Node with WebSocket)'); process.exit(0); }
const SHEETS = process.env.REELS4_SHEETS || '';
if (SHEETS) fs.mkdirSync(SHEETS, { recursive: true });
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/reels4/reference-plans.json'), 'utf8'));
const V3FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/reels3/sample-plans.json'), 'utf8'));
const STYLE_IDS = ['breakdown', 'casefile', 'outlier', 'hotseat'];
const STYLE_LABELS = { breakdown: 'Breakdown', casefile: 'Case File', outlier: 'The Outlier', hotseat: 'Hot Seat' };
const ONLY = (process.env.REELS4_ONLY || '').split(',').filter(Boolean);
const PLANS = FIX.plans.filter(p => !ONLY.length || ONLY.some(o => p.id.includes(o)));

const pageHtml = fs.readFileSync(path.join(ROOT, 'reel-maker.html'), 'utf8');
const srcs = [...pageHtml.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
const from = srcs.findIndex(s => /^frameup-rules\.js/.test(s));
const to = srcs.findIndex(s => /^reel-lint\.js/.test(s));
const ENGINE = from >= 0 && to > from ? srcs.slice(from, to + 1) : [];
if (!ENGINE.length) { console.log('reels4 brand: FAIL could not find the engine scripts in reel-maker.html'); process.exit(1); }

// Stand-in pictures (no rights involved): a portrait photo, a cut-out, a trading card, broadcast stills.
const MEDIA = {
  photo: { kind: 'photo', svg: () => figureSvg({ pose: 'bust', cutout: false, colour: '#203731', w: 1200, h: 1500 }) },
  cutout: { kind: 'photo', svg: () => figureSvg({ pose: 'stand', cutout: true, colour: '#AA0000', w: 900, h: 1200 }) },
  card: { kind: 'photo', svg: () => figureSvg({ pose: 'bust', cutout: false, colour: '#1D428A', w: 750, h: 1050 }) },
  'clip-game': { kind: 'clip', colour: '#203731', svg: () => broadcast('#203731') },
  'clip-presser': { kind: 'clip', colour: '#241773', svg: () => broadcast('#241773', true) },
};
function broadcast(colour, presser) {
  const fig = figureSvg({ pose: presser ? 'bust' : 'stand', cutout: true, colour, w: 600, h: 800 }).replace('<svg ', '<svg x="500" y="70" ');
  const ground = presser ? '<rect width="1600" height="900" fill="#2B2F3A"/><rect y="640" width="1600" height="260" fill="#8C6A43"/>' : '<rect width="1600" height="560" fill="#5B6B7C"/><rect y="560" width="1600" height="340" fill="#3E7A35"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">${ground}${fig}</svg>`;
}
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>reels4 qa</title>
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Condensed:wght@700;800&display=swap" rel="stylesheet">
<style>@font-face{font-family:"Acumin Post";src:url("/fonts/acumin-post-legacy.otf")}body{margin:0;background:#fff}</style>
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
if (!(await page.evaluate(`Boolean(window.ReelRender && window.ReelES)`).catch(() => false))) { console.log(`reels4 brand: FAIL the engine did not load (${pageErrors.slice(0, 3).join(' | ') || 'no error'})`); cleanup(); process.exit(1); }
await page.evaluate(fs.readFileSync(path.join(ROOT, 'scripts/lib/reels4-frame-lab.js'), 'utf8'));
const loaded = await page.evaluate(`QA4.load(${JSON.stringify(Object.fromEntries(Object.entries(MEDIA).map(([k, v]) => [k, { kind: v.kind, colour: v.colour }])))})`);

// ─── In-page brand analysis ──────────────────────────────────────────────────
const BRAND = String.raw`(() => {
const Q = window.QA4, ES = window.ReelES;
const FRAME = { l: 40, t: 300, r: 1040, b: 1640 };
const inside = (a, b, tol = 3) => a.l >= b.l - tol && a.r <= b.r + tol && a.t >= b.t - tol && a.b <= b.b + tol;
const overlap = (a, b, pad = 0) => a && b && a.l < b.r - pad && b.l < a.r - pad && a.t < b.b - pad && b.t < a.b - pad;
const union = list => list.length ? list.reduce((u, e) => ({ l: Math.min(u.l, e.l), t: Math.min(u.t, e.t), r: Math.max(u.r, e.r), b: Math.max(u.b, e.b) }), { l: 1e9, t: 1e9, r: -1e9, b: -1e9 }) : null;
const rb = b => b ? { l: Math.round(b.l), t: Math.round(b.t), r: Math.round(b.r), b: Math.round(b.b) } : null;
const area = b => Math.max(0, b.r - b.l) * Math.max(0, b.b - b.t);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const T = Q.TOKENS;
const PALETTE = new Set([T.ink, T.white, T.paper, T.blue, T.red, '#ffffff', '#121212', '#000000'].map(x => String(x).toLowerCase()));
const SIGNAL = new Set([T.red, T.green, T.yellow].map(x => String(x).toLowerCase()));

function captionBand(plan, info, spec) {
  const z = spec.zones && (spec.zones.caption || spec.zones.captions);
  if (z && Number.isFinite(z.y) && Number.isFinite(z.h)) return [z.y - 10, z.y + z.h + 10];
  if (z && Number.isFinite(z.t) && Number.isFinite(z.b)) return [z.t - 10, z.b + 10];
  const ys = [];
  for (const b of info.beats) {
    const voc = Q.vocabFor(plan, b.id);
    for (let t = b.inMs + 200; t < b.outMs - 100; t += 400) {
      const f = Q.frame(t);
      f.log.filter(e => e.op === 'text' && Q.within(voc.vo, e.text) && !Q.within(voc.headline, e.text) && !Q.within(voc.module, e.text) && !Q.within(voc.stamp, e.text) && !Q.within(voc.tag, e.text) && !Q.within(voc.label, e.text)).forEach(e => ys.push((e.t + e.b) / 2));
    }
  }
  if (!ys.length) return null;
  ys.sort((a, b) => a - b);
  const med = ys[Math.floor(ys.length / 2)];
  return [med - 110, med + 110];
}

function analyse(f, voc, ctx) {
  const issues = []; const notes = [];
  const add = (rule, msg, b) => issues.push({ rule, msg, box: rb(b) });
  const log = f.log;
  const texts = Q.classify(log, voc, ctx.band);
  // Type scale, fit, frame.
  if (ctx.steps.length) texts.forEach(t => {
    if (ctx.steps.some(s => Math.abs(s - t.size) <= 0.6)) return;
    // A caption word pops in from 0.86 of its step (CAPTION_POP) on the out curve.
    if (t.role === 'caption' && ctx.steps.some(s => t.size >= s * 0.85 && t.size <= s + 0.6)) return;
    // In motion (a pop or a morph)? The same words 400 ms later settle on a step.
    const later = ctx.later ? ctx.later.filter(x => x.op === 'text' && x.text === t.text) : [];
    if (later.length && later.every(x => ctx.steps.some(s => Math.abs(s - x.size) <= 0.6))) return;
    // A flip (a "?" that turns into its number on the spoken word): a different text settles in the same box within 400 ms.
    if (!later.length && ctx.later && t.l != null && ctx.later.some(x => x.op === 'text' && x.text !== t.text && x.l != null && Math.abs(((x.l + x.r) / 2) - ((t.l + t.r) / 2)) < 40 && Math.abs(((x.t + x.b) / 2) - ((t.t + t.b) / 2)) < 40 && ctx.steps.some(s => Math.abs(s - x.size) <= 0.6))) return;
    add('scale', '"' + t.text.slice(0, 24) + '" (' + t.role + ') is ' + t.size + ' px, not on the type scale' + (later.length ? ' (also ' + later[0].size + ' px 400 ms later)' : ''), t);
  });
  texts.forEach(t => {
    if (t.clipped) add('fit', '"' + t.text.slice(0, 24) + '" is cut off (drawn past its clip)', t);
    if (t.maxW != null && t.natW > t.maxW + 1) add('fit', '"' + t.text.slice(0, 24) + '" is squeezed (maxWidth ' + Math.round(t.maxW) + ' < ' + Math.round(t.natW) + ')', t);
    if (Math.abs(t.rot) < 1 && (t.l < FRAME.l - 2 || t.r > FRAME.r + 2 || t.t < FRAME.t - 2 || t.b > FRAME.b + 2)) add('frame', '"' + t.text.slice(0, 24) + '" (' + t.role + ') is outside the ES frame (' + [t.l, t.t, t.r, t.b].map(Math.round).join(',') + ')', t);
  });
  // Copy: whole words of the plan.
  if (!ctx.isClose) texts.forEach(t => t.text.split(/[\s·]+/).forEach(w => { const n = Q.norm(w); if (n && !voc.all.has(n) && !Q.NUMLIKE.test(n) && !n.split(/[-/]/).every(x => !x || voc.all.has(x) || Q.NUMLIKE.test(x)) && !/^(VS|AND|OF|THE|A|·|\?)$/.test(n)) add('copy', 'drawn word "' + w + '" (in "' + t.text.slice(0, 24) + '") is not in the beat\'s copy', t); }));
  // Colour.
  texts.forEach(t => { if (t.fill && !PALETTE.has(t.fill)) add('colour', '"' + t.text.slice(0, 24) + '" (' + t.role + ') is drawn in ' + t.fill + ' (ink, white, paper, ES blue or red only)', t); });
  const sig = new Set(log.filter(e => (e.op === 'rect' || e.op === 'fill' || e.op === 'text') && SIGNAL.has(e.fill)).map(e => e.fill));
  if (sig.size > 2) add('colour', sig.size + ' signal colours in one frame (max 2)');
  // Pills: a filled box holding one line of words must be an ES pill.
  const fills = log.filter(e => (e.op === 'rect' || e.op === 'fill') && Math.abs(e.rot || 0) < 1 && area(e) < Q.W * Q.H * 0.5);
  for (const b of fills) {
    const inner = texts.filter(t => inside(t, b) && Math.abs(t.rot) < 1);
    if (!inner.length) continue;
    const oneLine = new Set(inner.map(t => Math.round(t.t / 4))).size === 1 && inner.every(t => t.size === inner[0].size);
    if (!oneLine) continue;
    if (fills.some(o => o !== b && inside(b, o, 1) && texts.filter(t => inside(t, o)).length > inner.length)) continue; // a box inside a tile: the tile is the unit
    const t = inner.reduce((a, c) => (a.l <= c.l ? a : c));
    const m = Q.pillMetrics(t.size);
    const h = b.b - b.t;
    if (!m) { notes.push('no FrameUpRules.pillMetrics'); continue; }
    const bw = b.r - b.l;
    if (Math.abs(bw - h) <= Math.max(3, 0.15 * Math.max(bw, h)) && bw <= 96 && inner.every(x => x.text.trim().length <= 3)) { notes.push('a chip ' + Math.round(bw) + 'x' + Math.round(h) + ' "' + t.text + '" (pill h ' + Math.round(m.h) + ')'); continue; }
    if (h >= m.h * 1.6) { notes.push('a card / button (' + Math.round(b.r - b.l) + 'x' + Math.round(h) + ') holding "' + t.text.slice(0, 20) + '"'); continue; }
    if (!(near(h, m.h, 2.5) && (near(t.l - b.l, m.padLeft, 4) || near((b.l + b.r) / 2, (t.l + t.r) / 2, 4)))) add('pill', 'a one-line box (' + inner.map(x => x.role).join('/') + ' "' + t.text.slice(0, 20) + '") is not an ES pill: h ' + Math.round(h) + ', pad ' + Math.round(t.l - b.l) + ' (pill at ' + t.size + ' px: h ' + Math.round(m.h) + ', pad ' + Math.round(m.padLeft) + ')', b);
  }
  // Mark: always, top right.
  const mark = Q.markIn(log);
  if (!mark) add('mark', 'no ES mark on this frame (v4: always shown)');
  else if (!(mark.r >= 940 && mark.t <= 600)) add('mark', 'the ES mark is not top right', mark);
  // Stamps.
  const stamps = texts.filter(t => t.role === 'stamp');
  stamps.forEach(s => { const a = Math.abs(s.rot); if (a < ctx.stampMin - 0.05 || a > ctx.stampMax + 0.05) add('stamp', 'stamp "' + s.text.slice(0, 20) + '" is rotated ' + s.rot + ' deg (limits ' + ctx.stampMin + '..' + ctx.stampMax + ')', s); });
  // Captions: 1-3 words, highlight blue only.
  const caps = texts.filter(t => t.role === 'caption');
  const capWords = caps.reduce((n, t) => n + t.text.trim().split(/\s+/).filter(Boolean).length, 0);
  if (capWords > 3) add('caption', capWords + ' caption words on screen ("' + caps.map(t => t.text).join(' ').slice(0, 40) + '"; max 3)', union(caps));
  caps.forEach(t => { if (![T.ink, T.white, T.blue, '#ffffff', '#121212'].map(x => x.toLowerCase()).includes(t.fill)) add('caption', 'caption word "' + t.text + '" is ' + t.fill + ' (highlight is ES blue)', t); });
  // Zones.
  const head = texts.filter(t => t.role === 'headline');
  const mediaImgs = log.filter(e => e.op === 'image' && !/logo:/.test(String(e.src)) && area(e) > Q.W * Q.H * 0.02);
  const mod = texts.filter(t => t.role === 'module');
  const zone = { headline: union(head), media: union(mediaImgs), data: union(mod), caption: union(caps) };
  if (zone.headline && zone.media && overlap(zone.headline, zone.media, 4)) add('zones', 'the headline zone overlaps the media', zone.media);
  if (zone.headline && zone.data && overlap(zone.headline, zone.data, 4)) add('zones', 'the headline zone overlaps the data module', zone.data);
  if (zone.caption && zone.headline && overlap(zone.caption, zone.headline, 2)) add('zones', 'a caption covers the headline', zone.caption);
  if (zone.caption && zone.data) mod.forEach(m => { if (caps.some(c => overlap(c, m, 2))) add('zones', 'a caption covers module text "' + m.text.slice(0, 20) + '"', m); });
  if (zone.headline && zone.media && zone.headline.t > zone.media.t + 4) add('zones', 'the headline sits below the media zone', zone.headline);
  if (zone.headline && zone.data && zone.headline.t > zone.data.t + 4) add('zones', 'the headline sits below the data zone', zone.headline);
  const z = ctx.spec.zones;
  if (z) for (const [k, list] of [['headline', head], ['data', mod], ['caption', caps]]) { const zz = z[k] || (k === 'data' && (z.module || z.data)); if (zz && Number.isFinite(zz.y) && Number.isFinite(zz.h)) list.forEach(t => { if ((t.t + t.b) / 2 < zz.y - 4 || (t.t + t.b) / 2 > zz.y + zz.h + 4) add('zones', k + ' "' + t.text.slice(0, 20) + '" is outside the engine ' + k + ' zone (y ' + zz.y + '..' + (zz.y + zz.h) + ')', t); }); }
  // Headline: one coloured word (the emphasis), tone colour.
  const hl = texts.filter(t => t.role === 'headline');
  const coloured = hl.filter(t => t.fill === T.blue.toLowerCase() || t.fill === T.red.toLowerCase());
  if (hl.length && voc.emphasis) {
    const want = Q.words(voc.emphasis).join(' ');
    const got = coloured.map(t => Q.words(t.text).join(' ')).join(' ');
    if (!got) add('headline', 'the headline has no coloured word (want "' + voc.emphasis + '")', union(hl));
    else if (got !== want && !want.includes(got)) add('headline', 'the coloured headline words are "' + got + '" (want "' + want + '")', union(coloured));
    const toneHex = (voc.tone === 'red' ? T.red : T.blue).toLowerCase();
    coloured.forEach(t => { if (t.fill !== toneHex) add('headline', 'the coloured word "' + t.text + '" is ' + t.fill + ' but the chapter tone is ' + voc.tone, t); });
  }
  return { issues, notes, zone: Object.fromEntries(Object.entries(zone).map(([k, v]) => [k, rb(v)])), headline: hl.map(t => t.text + '@' + Math.round(t.l) + ',' + Math.round(t.t)).join(' | '), roles: Object.fromEntries([...new Set(texts.map(t => t.role))].map(r => [r, texts.filter(t => t.role === r).length])), sizes: [...new Set(texts.map(t => t.size))].sort((a, b) => a - b), mark: Boolean(mark), stamps: stamps.map(s => s.text + ' ' + s.rot + 'deg'), captions: caps.map(t => t.text).join(' '), err: f.err };
}

function renderReel(entry, opts) {
  const b = Q.build(entry, {});
  if (b.error) return { error: b.error };
  const { plan, info, tl } = Q.current;
  const spec = Q.motionSpec();
  const steps = Q.scaleSteps();
  const lim = spec.stamp && (spec.stamp.rotate || spec.stamp.rotation || spec.stamp.angle);
  const stampMin = Array.isArray(lim) ? Math.abs(lim[0]) : (lim && Number.isFinite(lim.min) ? Math.abs(lim.min) : 2);
  const stampMax = Array.isArray(lim) ? Math.abs(lim[1]) : (lim && Number.isFinite(lim.max) ? Math.abs(lim.max) : 12);
  const band = captionBand(plan, info, spec);
  const frames = [];
  const rows = [];
  const ctx = { steps, band, spec, stampMin, stampMax, isClose: false };
  // One settled frame per beat, and a late frame (stamps land late).
  for (const bt of info.beats) {
    const voc = Q.vocabFor(plan, bt.id);
    const isClose = !Q.beatsOf(plan).some(x => x.id === bt.id);
    const d = bt.outMs - bt.inMs;
    const tS = Math.round(Math.max(bt.inMs + d * 0.45, Math.min(bt.inMs + 1700, bt.outMs - 700)));
    const f = Q.frame(tS, { thumb: { w: 180, h: 320 } });
    const later = Q.frame(isClose ? bt.outMs - 200 : Math.min(bt.outMs - 1, tS + 400)).log;
    const res = analyse(f, voc, { ...ctx, isClose, later });
    const beat = Q.beatsOf(plan).find(x => x.id === bt.id);
    if (beat && beat.stamp) {
      const late = Q.frame(Math.round(bt.outMs - 360));
      const st = Q.classify(late.log, voc, band).filter(t => t.role === 'stamp');
      if (!st.length && !res.stamps.length) res.issues.push({ rule: 'stamp', msg: 'stamp "' + beat.stamp.text + '" is never drawn (settled or late frame)' });
      st.forEach(s => { const a = Math.abs(s.rot); if (a < stampMin || a > stampMax) res.issues.push({ rule: 'stamp', msg: 'stamp "' + s.text.slice(0, 20) + '" is rotated ' + s.rot + ' deg (limits ' + stampMin + '..' + stampMax + ')', box: rb(s) }); else if (a < 0.5) res.issues.push({ rule: 'stamp', msg: 'stamp "' + s.text.slice(0, 20) + '" is not rotated', box: rb(s) }); });
    }
    if (f.err) res.issues.push({ rule: 'draw', msg: 'drawFrame threw: ' + f.err });
    frames.push({ beat: bt.id, chapter: bt.chapterId, t: tS, ...res });
    rows.push({ thumb: f.thumb, note: bt.chapterId + '/' + bt.id + ' ' + (res.issues.length ? res.issues.length + ' issue(s)' : 'ok') + '\n' + (res.issues[0] ? res.issues[0].rule + ': ' + res.issues[0].msg : ''), bad: res.issues.length > 0, boxes: res.issues.map(i => i.box).filter(Boolean) });
  }
  // Captions and the mark between the settled frames: every 200 ms.
  const capIssues = [];
  let markMissing = 0, sampled = 0;
  for (const bt of info.beats) {
    const voc = Q.vocabFor(plan, bt.id);
    for (let t = bt.inMs; t < bt.outMs; t += 200) {
      const f = Q.frame(t);
      sampled++;
      if (!Q.markIn(f.log)) markMissing++;
      const caps = Q.classify(f.log, voc, band).filter(x => x.role === 'caption');
      const n = caps.reduce((a, c) => a + c.text.trim().split(/\s+/).filter(Boolean).length, 0);
      if (n > 3) capIssues.push(bt.id + ' @' + t + ' ms: ' + n + ' caption words ("' + caps.map(c => c.text).join(' ').slice(0, 40) + '")');
    }
  }
  // Headline held per chapter.
  const held = [];
  for (const ch of info.chapters) {
    const sigs = frames.filter(f => f.chapter === ch.id && f.headline).map(f => f.headline);
    if (new Set(sigs).size > 1) held.push(ch.id + ': the headline changes inside the chapter: ' + [...new Set(sigs)].join('  ->  ').slice(0, 200));
    if (!sigs.length && frames.some(f => f.chapter === ch.id)) held.push(ch.id + ': no headline drawn in the chapter');
  }
  // One grid: the headline zone top is the same across the reel.
  const tops = [...new Set(frames.map(f => f.zone.headline && f.zone.headline.t).filter(v => v != null))];
  const grid = tops.length && Math.max(...tops) - Math.min(...tops) > 8 ? ['the headline zone top moves across the reel: ' + tops.join(', ')] : [];
  return { v: b.v, style: b.style, durationMs: b.durationMs, chapters: info.chapters.length, beats: info.beats.length, band, frames, capIssues, markMissing, sampled, held, grid, lint: Q.lint(tl, (plan.sources || []).map(s => s.claim || '').join(' ')), sheet: opts.sheet ? Q.sheet([{ label: entry.id + ' · ' + plan.esStyle + ' / ' + plan.skin + ' · ' + (b.durationMs / 1000).toFixed(1) + ' s', frames: rows }], 'reels4 brand · ' + entry.label) : '' };
}

function statics(v3plans) {
  const out = { fails: [], notes: [] };
  const S = ES.STYLES || {};
  const ids = Object.keys(S);
  if (ids.join() !== ${JSON.stringify(STYLE_IDS.join())}) out.fails.push('ReelES.STYLES ids are ' + ids.join(',') + ' (want ' + ${JSON.stringify(STYLE_IDS.join())} + ')');
  for (const [id, label] of Object.entries(${JSON.stringify(STYLE_LABELS)})) {
    if (!S[id]) continue;
    if (S[id].label !== label) out.fails.push('style ' + id + ' label "' + S[id].label + '" (want "' + label + '")');
    if (!S[id].previewPlan || S[id].previewPlan.v !== 4 || !Array.isArray(S[id].previewPlan.chapters)) out.fails.push('style ' + id + ' has no v4 previewPlan');
    else if (S[id].previewPlan.close && !(window.ReelES4 && window.ReelES4.CLOSE_KINDS || ['yourCall', 'endcard', 'checklist']).includes(S[id].previewPlan.close.kind)) out.fails.push('style ' + id + ' previewPlan.close.kind is "' + S[id].previewPlan.close.kind + '" (allowed: yourCall | endcard | checklist)');
  }
  const TH = window.ReelESThemes || ES.themes || ES;
  const styleOf = (TH && TH.styleOf) || ES.styleOf;
  const toV4 = ES.toV4 || (window.ReelES4 && window.ReelES4.toV4);
  if (typeof styleOf !== 'function') out.fails.push('no styleOf (legacy map) on ReelES / ReelESThemes');
  else {
    const cases = [
      ['receipts with a dot grid', { esStyle: 'receipts', beats: [{ id: 'b1', block: { type: 'dotGrid', total: 67 } }] }, 'outlier'],
      ['statcard with a dot grid', { esStyle: 'statcard', beats: [{ id: 'b1', block: { type: 'dotGrid', total: 67 } }] }, 'outlier'],
      ['receipts without dots', { esStyle: 'receipts', beats: [{ id: 'b1', block: { type: 'statTiles', tiles: [] } }] }, 'breakdown'],
      ['statcard without dots', { esStyle: 'statcard', beats: [{ id: 'b1', block: { type: 'statTiles', tiles: [] } }] }, 'breakdown'],
      ['gametape', { esStyle: 'gametape', beats: [] }, 'breakdown'],
      ['hypecut', { esStyle: 'hypecut', beats: [] }, 'breakdown'],
      ['an old look (reelStyle "tape")', { reelStyle: 'tape', beats: [] }, 'breakdown'],
    ];
    for (const [name, plan, want] of cases) { let got; try { got = styleOf(plan); } catch (e) { got = 'threw ' + e.message; } if (got !== want) out.fails.push('legacy map: ' + name + ' -> ' + got + ' (want ' + want + ')'); }
  }
  if (typeof toV4 !== 'function') out.fails.push('no ReelES.toV4');
  else for (const p of v3plans) {
    let v; try { v = toV4(JSON.parse(JSON.stringify(p))); } catch (e) { out.fails.push('toV4 threw on ' + p.title + ': ' + e.message); continue; }
    const n = (p.beats || []).filter(b => !(b.kind === 'cta' || (b.block && b.block.type === 'endcard'))).length;
    const ch = (v && v.chapters) || [];
    const sizes = ch.map(c => (c.beats || []).length);
    if (!v || v.v !== 4 || !ch.length) { out.fails.push('toV4(' + p.title + ') is not a plan v4'); continue; }
    if (sizes.reduce((a, b) => a + b, 0) < n) out.fails.push('toV4(' + p.title + ') dropped beats (' + sizes.reduce((a, b) => a + b, 0) + ' of ' + n + ')');
    if (sizes.some(s => s > 3)) out.fails.push('toV4(' + p.title + ') chapter sizes ' + sizes.join('/') + ' (contract: one chapter per 2-3 beats)');
    if (!ch.every(c => c.headline)) out.fails.push('toV4(' + p.title + ') has a chapter with no headline');
    if (!['breakdown', 'casefile', 'outlier', 'hotseat'].includes(v.esStyle)) out.fails.push('toV4(' + p.title + ') esStyle "' + v.esStyle + '" (want a v4 style)');
  }
  const spec = Q.motionSpec();
  out.spec = { es4: spec.es4, curves: Object.keys(spec.curves), durations: spec.durations, zones: Boolean(spec.zones), stamp: spec.raw.stamp || null };
  return out;
}
window.QA4B = { renderReel, statics };
return true;
})()`;
await page.evaluate(BRAND);

// v3 plans (the reels3 sample topics, statcard order) for toV4.
const v3Plans = V3FIX.topics.map(t => ({ title: t.title, format: t.format || 'stat', sport: t.sport, style: 'es', esStyle: Object.keys(t.styles)[1] || 'statcard', sourceLine: 'Source: ' + ((t.sources || [])[0]?.source || 'ES'), beats: (t.styles.statcard || Object.values(t.styles)[0]).map(k => ({ id: k, ...t.beats[k] })) }));
const st = await page.evaluate(`QA4B.statics(${JSON.stringify(v3Plans)})`);
const failures = [...st.fails];
const notes = [];
if (!loaded.fonts) notes.push('Roboto Condensed did not load (offline?): text widths use a fallback font');
if (!st.spec.es4) notes.push('no window.ReelES4 (v4 engine module): the reels are drawn by ReelRender.buildTimeline/drawFrame');
const summary = [];
for (const entry of PLANS) {
  const r = await page.evaluate(`QA4B.renderReel(${JSON.stringify(entry)}, { sheet: ${Boolean(SHEETS)} })`).catch(e => ({ error: e.message }));
  const tag = `${entry.id}/${entry.plan.esStyle}`;
  if (r.error) { failures.push(`${tag}: ${r.error}`); continue; }
  if (r.v !== 4) failures.push(`${tag}: the timeline is not v4 (tl.v ${r.v}): the engine did not build chapters`);
  if (r.style && r.style !== entry.plan.esStyle) failures.push(`${tag}: drawn as "${r.style}" (plan.esStyle ${entry.plan.esStyle})`);
  if (r.chapters !== entry.plan.chapters.length) failures.push(`${tag}: the timeline has ${r.chapters} chapters (plan ${entry.plan.chapters.length})`);
  const sec = r.durationMs / 1000;
  if (!(sec >= 80 && sec <= 100)) failures.push(`${tag}: ${sec.toFixed(1)} s long (contract: 80-100 s for a full reel; VO ${entry.voWords} words)`);
  if (!r.band) failures.push(`${tag}: no captions found anywhere in the reel`);
  const byRule = {};
  r.frames.forEach(f => f.issues.forEach(i => { byRule[i.rule] = (byRule[i.rule] || 0) + 1; }));
  for (const f of r.frames) for (const i of f.issues) failures.push(`${tag} ${f.chapter}/${f.beat} @${f.t}ms [${i.rule}] ${i.msg}`);
  for (const c of r.capIssues.slice(0, 20)) failures.push(`${tag} [caption] ${c}`);
  if (r.markMissing) failures.push(`${tag} [mark] the ES mark is missing on ${r.markMissing} of ${r.sampled} sampled frames (v4: always shown)`);
  for (const h of r.held) failures.push(`${tag} [headline] ${h}`);
  for (const g of r.grid) failures.push(`${tag} [zones] ${g}`);
  const bad = r.frames.filter(f => f.issues.length).length;
  if (bad && r.lint && !r.lint.error && r.lint.critical === 0) notes.push(`${tag}: lint gap: ${bad} frame(s) break brand rules but lint has 0 critical`);
  if (r.lint && r.lint.critical) failures.push(`${tag}: engine lint has ${r.lint.critical} critical: ${r.lint.criticals.slice(0, 3).join(' | ')}`);
  for (const f of r.frames) for (const n of f.notes) notes.push(`${tag} ${f.beat}: ${n}`);
  summary.push(`${tag}: ${r.chapters} chapters, ${r.beats} beats, ${sec.toFixed(1)} s, ${bad} frames with issues ${JSON.stringify(byRule)}, caption band ${r.band ? r.band.map(Math.round).join('-') : 'none'}, lint ${r.lint ? (r.lint.error ? 'error' : r.lint.critical + ' critical') : 'n/a'}`);
  if (SHEETS) {
    if (r.sheet) fs.writeFileSync(path.join(SHEETS, `brand-${entry.id}.png`), Buffer.from(r.sheet.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(SHEETS, `brand-${entry.id}.json`), JSON.stringify({ ...r, sheet: undefined }, null, 2));
  }
}
if (pageErrors.length) failures.push(...[...new Set(pageErrors)].slice(0, 5).map(e => `page error: ${e}`));
cleanup();
console.log(`engine: ${JSON.stringify(st.spec)}`);
for (const s of summary) console.log(s);
if (process.env.REELS4_NOTES) for (const n of [...new Set(notes)]) console.log(`note ${n}`);
const uniq = [...new Set(failures)];
for (const f of uniq.slice(0, 400)) console.log(`FAIL ${f}`);
if (uniq.length > 400) console.log(`... ${uniq.length - 400} more`);
console.log(`reels4 brand: ${PLANS.length} reels, ${uniq.length} failures, ${notes.length} notes${SHEETS ? `; sheets in ${SHEETS}` : ''}`);
process.exit(uniq.length ? 1 : 0);
