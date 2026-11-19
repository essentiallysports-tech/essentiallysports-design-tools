// Newsletter "Archive Page FI" (Figma ES Design Team Files, node 2365-65):
// registration in the editor, its own 834 x 555 size, the bottom overlay and
// the Quick Read tag, drawn by the real function against a recording canvas.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ID = 'archive-page-fi';

// ── Registration ──
assert.match(html, /<option value="archive-page-fi">Archive Page FI<\/option>/, 'listed in the Newsletter asset dropdown');
const optgroup = html.slice(html.indexOf('<optgroup label="Feature images">'), html.indexOf('</optgroup>', html.indexOf('<optgroup label="Feature images">')));
assert.ok(optgroup.includes(`value="${ID}"`), 'sits in the Feature images group');

const entry = html.match(/'archive-page-fi': \{\n([\s\S]*?)\n  \},\n/);
assert.ok(entry, 'NEWSLETTER_ASSET_TYPES entry');
assert.match(entry[1], /label: 'Archive Page FI'/);
assert.match(entry[1], /slug: 'archive-page-fi'/);
assert.match(entry[1], /width: 834,/, 'own width');
assert.match(entry[1], /height: 555,/, 'own height');
assert.match(entry[1], /maxLines: 1,/);

assert.match(html, /activeNewsletterAsset === 'archive-page-fi'\s*\n\s*\? drawNewsletterArchivePageFI/, 'render chain picks the draw function');
assert.match(html, /'archive-page-fi': 'assets\/infographics\/sample-golf\.webp'/, 'sample photo until one is uploaded');
for (const card of ['.color-card', '#pill-position-card', '#swipe-button-card']) {
  assert.ok(html.includes(`[data-newsletter-asset="archive-page-fi"] ${card}`), `hides ${card}`);
}
assert.ok(!/IMAGELESS_NEWSLETTER_ASSETS[^\n]*archive-page-fi/.test(html), 'is a photo asset');

// Other Newsletter sizes are unchanged.
const tag = html.match(/'tag-fi': \{\n([\s\S]*?)\n  \},\n/)[1];
assert.match(tag, /width: 960,/);
assert.match(tag, /height: 640,/);

const assist = fs.readFileSync(path.join(ROOT, 'frameup-editor-assist.js'), 'utf8');
assert.match(assist, /'archive-page-fi': \{ best: /, 'editor assist knows it');

const updates = JSON.parse(fs.readFileSync(path.join(ROOT, 'tours', 'updates.json'), 'utf8'));
assert.ok(updates.entries.some(e => (e.templates || []).some(([ws, v]) => ws === 'newsletter' && v === ID)), 'release note tags it New');

// ── Drawing ──
function extract(name) {
  const start = html.indexOf(name);
  assert.ok(start >= 0, `${name} present`);
  let i = html.indexOf('{', start);
  let depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  const end = html[i + 1] === ';' ? i + 2 : i + 1;
  return html.slice(start, end);
}
const src = [
  html.match(/const ARCHIVE_PAGE_FI_DEFAULT_TAG = '[^']*';/)[0],
  extract('const ARCHIVE_PAGE_FI = '),
  extract('function drawArchivePageFIBolt'),
  extract('function drawNewsletterArchivePageFI'),
].join('\n');

function recorder() {
  const calls = [];
  const gradients = [];
  const ctx = {
    calls, gradients, font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '',
    clearRect: (...a) => calls.push(['clearRect', ...a]),
    fillRect: (...a) => calls.push(['fillRect', ctx.fillStyle, ...a]),
    strokeRect: (...a) => calls.push(['strokeRect', ctx.strokeStyle, ctx.lineWidth, ...a]),
    fillText: (...a) => calls.push(['fillText', ctx.fillStyle, ctx.font, ...a]),
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill: () => calls.push(['fill', ctx.fillStyle]),
    createLinearGradient: (...a) => { const g = { args: a, stops: [], addColorStop: (o, c) => g.stops.push([o, c]) }; gradients.push(g); return g; },
    measureText: (t) => {
      const size = Number((ctx.font.match(/(\d+)px/) || [0, 40])[1]);
      return { width: t.length * size * 0.5, actualBoundingBoxLeft: 0, actualBoundingBoxRight: t.length * size * 0.5, actualBoundingBoxAscent: size * 0.7 };
    },
  };
  return ctx;
}

function draw({ lines = [], scale = 1, photo = null } = {}) {
  const ctx = recorder();
  const sandbox = {
    state: { lines, photo, lastTextBounds: null, textHitRects: [] },
    POST_FONT_FAMILY: 'Acumin Post',
    getNewsletterSamplePhoto: () => null,
    drawCoverImage: (c) => c.calls.push(['photo']),
    drawCoverImageInRect: (c) => c.calls.push(['photo']),
    fitCanvasFont: (_c, _t, _w, start) => start,
  };
  vm.runInNewContext(`${src}\ndrawNewsletterArchivePageFI(ctx, W, H, scale);`, { ...sandbox, ctx, W: 834 * scale, H: 555 * scale, scale });
  return { ctx, state: sandbox.state };
}

{
  const { ctx, state } = draw();
  const overlay = ctx.gradients[0];
  assert.ok(overlay, 'bottom overlay drawn even before a photo is chosen');
  assert.deepEqual(overlay.args, [0, 555 - 165, 0, 555], 'overlay runs down over the bottom 165px');
  assert.equal(overlay.stops[0][1], 'rgba(0,0,0,0)', 'overlay fades in from clear');
  assert.equal(overlay.stops.at(-1)[1], 'rgba(0,0,0,0.75)', 'overlay ends at 75% black');
  assert.ok(ctx.calls.some(c => c[0] === 'fillRect' && c[1] === overlay && c[3] === 390 && c[5] === 165), 'overlay rectangle covers the bottom band');

  const text = ctx.calls.find(c => c[0] === 'fillText');
  assert.equal(text[3], 'QUICK READ', 'default tag text from Figma');
  assert.equal(text[1], '#FFFFFF');
  assert.match(text[2], /^900 40px "Acumin Post"/);

  const box = ctx.calls.find(c => c[0] === 'strokeRect');
  assert.equal(box[1], '#FFFFFF', 'white outline');
  assert.equal(box[2], 2, '2px outline');
  assert.deepEqual(state.lastTextBounds && [state.lastTextBounds.x, state.lastTextBounds.y, state.lastTextBounds.h], [30, 555 - 30 - 57, 57], 'tag 30px from left and bottom, 57px tall');
  assert.ok(ctx.calls.some(c => c[0] === 'fill' && c[1] === '#FFC629'), 'yellow bolt');
}

{
  const { ctx } = draw({ lines: ['quick hit'] });
  assert.equal(ctx.calls.find(c => c[0] === 'fillText')[3], 'QUICK HIT', 'tag text is editable and upper-cased');
}

{
  // Export at 2x keeps the same proportions.
  const { ctx, state } = draw({ scale: 2 });
  assert.deepEqual(ctx.gradients[0].args, [0, 1110 - 330, 0, 1110]);
  assert.equal(state.lastTextBounds, null, 'hit areas only recorded for the on-screen render');
  assert.ok(ctx.calls.find(c => c[0] === 'fillText')[2].startsWith('900 80px'));
}

console.log('test-newsletter-archive-page-fi: ok');
