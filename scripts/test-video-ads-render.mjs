#!/usr/bin/env node
// Video Ads layout (video-ads-render.js): runs, wrapping, highlight boxes and
// auto-fit inside each size's safe area. Text is measured with a stub
// (width = characters × size × 0.5) so the test needs no canvas.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../video-ads-render.js');
const B = require('../video-ads-brands.js');

const sizeOf = font => Number(String(font).match(/([\d.]+)px/)[1]);
const measure = (text, font) => [...String(text)].length * sizeOf(font) * 0.5;
const brand = B.byId('essentially-cfb');
const logo = { width: 417, height: 49 };

// 1. **bold** runs.
assert.deepEqual(R.parseRuns('Keep up **free** today'), [{ text: 'Keep up ', bold: false }, { text: 'free', bold: true }, { text: ' today', bold: false }]);

// 2. The highlight phrase marks exactly its words (case-insensitive).
const tokens = R.tokensFor('THE TEAM YOU WERE HANDED. KEEP UP WITH IT, FREE.', { fontFor: () => '700 80px x', highlight: 'keep up with it, free.' });
assert.deepEqual(tokens.filter(t => t.lit).map(t => t.text), ['KEEP', 'UP', 'WITH', 'IT,', 'FREE.']);

// 3. Wrapping never exceeds the width.
const lines = R.wrapTokens(measure, R.tokensFor('one two three four five six seven eight nine ten', { fontFor: () => '400 40px x' }), 200);
assert.ok(lines.length > 1);
lines.forEach(line => assert.ok(line.width <= 200, `line fits (${line.width})`));

const layout = {
  style: 'highlight',
  headline: 'The college football team you were handed, from your dad to your son. Keep up with it, free.',
  highlight: 'Keep up with it, free.',
  body: ['Nobody picks their first team. A dad passes it to his son: the same seats, the same Saturdays. Keep up with the program you were handed, then all of college football. Free. Join 100,000+ fans today.'],
  cta: 'SIGN UP ES CFB',
  unsubscribe: true,
  align: 'left',
  anchor: 'center',
};

// 4. Every size: the stack fits inside the safe area and nothing leaves it.
for (const size of Object.values(B.SIZES)) {
  const result = R.fitLayout(measure, layout, brand, size, logo);
  assert.equal(result.fits, true, `${size.id} fits`);
  const top = size.safe.top;
  const bottom = size.height - size.safe.bottom;
  result.ops.forEach(op => {
    if (op.type === 'text') {
      assert.ok(op.x >= size.safe.side - 1, `${size.id} text inside left edge`);
      assert.ok(op.x + measure(op.text, op.font) <= size.width - size.safe.side + 1, `${size.id} text inside right edge: "${op.text}"`);
      assert.ok(op.y >= top && op.y <= bottom + 2, `${size.id} text inside the safe area`);
    }
  });
  // The highlighted words sit on brand-coloured boxes, drawn before the text.
  const boxes = result.ops.filter(op => op.type === 'box');
  assert.ok(boxes.length >= 1, `${size.id} has highlight boxes`);
  assert.ok(boxes.every(box => box.fill === brand.highlight.bg));
  assert.ok(result.ops.indexOf(boxes[0]) < result.ops.findIndex(op => op.type === 'text' && op.fill === brand.highlight.fg));
  // Logo, CTA button with the mail icon in the brand accent, unsubscribe line.
  assert.ok(result.ops.some(op => op.type === 'logo'));
  assert.ok(result.ops.some(op => op.type === 'button' && op.fill === '#FFFFFF'));
  assert.ok(result.ops.some(op => op.type === 'mail' && op.fill === brand.accent));
  assert.ok(result.ops.some(op => op.type === 'text' && op.text === 'SIGN UP ES CFB'));
  assert.ok(result.ops.some(op => op.type === 'text' && op.text === 'Unsubscribe anytime'));
}

// 5. Simple style: copy has no condensed font and no highlight boxes (the CTA
//    button is always condensed, as in the ES templates).
const simple = R.fitLayout(measure, { ...layout, style: 'simple' }, brand, B.SIZES['9x16'], logo);
assert.ok(!simple.ops.some(op => op.type === 'box'));
assert.ok(!simple.ops.some(op => op.type === 'text' && /Acumin/.test(op.font) && op.text !== 'SIGN UP ES CFB'));

// 6. Condensed style: condensed headline, Roboto body, no boxes.
const condensed = R.fitLayout(measure, { ...layout, style: 'condensed' }, brand, B.SIZES['9x16'], logo);
assert.ok(condensed.ops.some(op => op.type === 'text' && /Acumin/.test(op.font)));
assert.ok(condensed.ops.some(op => op.type === 'text' && /Roboto/.test(op.font)));
assert.ok(!condensed.ops.some(op => op.type === 'box'));

// 7. Far too much copy for a square: reported as not fitting (never silently cut).
const huge = R.fitLayout(measure, { ...layout, body: [layout.body[0].repeat(6)] }, brand, B.SIZES['1x1'], logo);
assert.equal(huge.fits, false);

// 8. Centre alignment centres each line inside the safe area.
const centred = R.fitLayout(measure, { ...layout, align: 'center', style: 'simple', body: [], headline: 'Short line' }, brand, B.SIZES['9x16'], null);
const word = centred.ops.find(op => op.type === 'text' && op.text === 'Short');
const lineWidth = measure('Short line', word.font);
assert.ok(Math.abs(word.x - (1080 - lineWidth) / 2) < 2, 'centred');

// 9. Figma template rules (ES Design Team file, NFL-ad-with-logo): the logo is
//    pinned at the size's logoTop and the copy starts below it; Simple copy is
//    Roboto Medium; the CTA is ~1.92× its label tall (99.1 / 51.73) with a black label.
for (const size of Object.values(B.SIZES)) {
  const result = R.fitLayout(measure, layout, brand, size, logo);
  const mark = result.ops.find(op => op.type === 'logo');
  assert.equal(mark.y, size.logoTop, `${size.id} logo pinned at logoTop`);
  assert.ok(mark.w <= R.BASE.logoBox.w + 0.01 && mark.h <= R.BASE.logoBox.h + 0.01, `${size.id} logo fits the logo box`);
  const firstText = result.ops.find(op => op.type === 'text');
  assert.ok(firstText.y > mark.y + mark.h, `${size.id} copy starts below the logo`);
}
const plainAd = R.fitLayout(measure, { ...layout, style: 'simple' }, brand, B.SIZES['9x16'], logo);
assert.ok(plainAd.ops.filter(op => op.type === 'text' && /Roboto/.test(op.font) && op.text !== 'Unsubscribe anytime').every(op => /^(500|700) /.test(op.font)), 'Simple copy is Roboto Medium (bold runs 700)');
const button = plainAd.ops.find(op => op.type === 'button');
const label = plainAd.ops.find(op => op.type === 'text' && op.text === 'SIGN UP ES CFB');
assert.ok(Math.abs(button.h - sizeOf(label.font) * 1.92) < 0.5, 'CTA is 1.92× its label tall');
assert.equal(label.fill, '#000000');

// 10. Figma values (ES Design Team file, ADS page: NFL-ad-with-logo 9:16 frames
//     2295:3387 / 3421 / 3454 and CFB frames 2295:5346 / 5319 / 5332).
const nflBody = ['Injuries, trades, benchings — miss one day and you’re lost in your group chat.', 'That’s why I read The Huddle.\nEvery NFL story that matters, delivered in one free 5-minute email every morning.', 'Never miss a move. And it’s free!'];
const nfl = { style: 'condensed', headline: 'The NFL moves too fast to keep up with.', body: nflBody, cta: 'SIGN UP FOR THE HUDDLE', unsubscribe: true, align: 'center', anchor: 'center' };
const huddle = B.byId('the-huddle');
const nflAd = R.fitLayout(measure, nfl, huddle, B.SIZES['9x16'], { width: 270.45, height: 74.93 });
assert.equal(nflAd.fits, true);
assert.equal(nflAd.scale, 1, 'copy that fits is drawn at the Figma sizes, never larger');
const bodyOps = nflAd.ops.filter(op => op.type === 'text' && /px Roboto,/.test(op.font) && op.text !== 'Unsubscribe anytime');
assert.ok(bodyOps.every(op => sizeOf(op.font) === 49.2 && /^500 /.test(op.font)), 'body is Roboto Medium 49.19px');
const headOps = nflAd.ops.filter(op => op.type === 'text' && /Acumin/.test(op.font) && op.text !== 'SIGN UP FOR THE HUDDLE');
assert.ok(headOps.every(op => sizeOf(op.font) === 85.2), 'condensed headline is 85px');
// Line pitch 1.11 inside a paragraph (also for a typed line break), one blank line between paragraphs.
const baselines = [...new Set(bodyOps.map(op => Math.round(op.y * 100) / 100))].sort((a, b) => a - b);
const steps = baselines.slice(1).map((y, i) => Math.round((y - baselines[i]) * 10) / 10);
const pitch = Math.round(49.19 * 1.11 * 10) / 10;
assert.ok(steps.every(step => Math.abs(step - pitch) < 0.2 || Math.abs(step - 2 * pitch) < 0.2), `body rhythm is 1.11 lines with blank lines between paragraphs (${steps})`);
assert.ok(steps.some(step => Math.abs(step - 2 * pitch) < 0.2), 'paragraphs are a blank line apart');
const why = bodyOps.find(op => op.text === 'Every');
const that = bodyOps.find(op => op.text === 'That’s');
assert.ok(Math.abs(why.y - that.y - pitch) < 0.2, 'a single line break stays in the paragraph');
// Headline baseline → body cap top 90px; body → CTA 120px; CTA → unsubscribe cap top 23px.
const lastHead = Math.max(...headOps.map(op => op.y));
const firstBody = Math.min(...bodyOps.map(op => op.y));
assert.ok(Math.abs(firstBody - 49.19 * R.CAP.body - lastHead - 90) < 0.5, 'headline → body gap');
const btn = nflAd.ops.find(op => op.type === 'button');
assert.ok(Math.abs(btn.y - Math.max(...bodyOps.map(op => op.y)) - 120) < 0.5, 'body → CTA gap');
assert.ok(Math.abs(btn.h - 99.1) < 0.2 && Math.abs(btn.r - 13.66) < 0.05, 'CTA 99px tall, radius 13.7');
const unsub = nflAd.ops.find(op => op.text === 'Unsubscribe anytime');
assert.equal(unsub.fill, '#FFFFFF');
assert.ok(/^600 24\.9px Roboto/.test(unsub.font), 'unsubscribe is Roboto SemiBold 24.9px');
assert.ok(Math.abs(unsub.y - 24.89 * R.CAP.body - (btn.y + btn.h) - 23) < 0.5, 'unsubscribe 23px under the CTA');
// The ES logo is drawn at its Figma size and centred, 107px from the top.
const mark = nflAd.ops.find(op => op.type === 'logo');
assert.ok(Math.abs(mark.w - 270.45) < 0.01 && mark.y === 107 && Math.abs(mark.x + mark.w / 2 - 540) < 0.01);
// The copy is centred on the frame (y ≈ 960), as in every 9:16 Figma frame.
//     Taller copy slides up but stays inside the safe area.
const shortAd = R.fitLayout(measure, { ...nfl, body: [nflBody[2]] }, huddle, B.SIZES['9x16'], { width: 270.45, height: 74.93 });
const first = shortAd.ops.find(op => op.type === 'text');
const stackTop = first.y - sizeOf(first.font) * R.CAP.condensed;
const stackBottom = shortAd.ops.find(op => op.text === 'Unsubscribe anytime').y;
assert.ok(Math.abs((stackTop + stackBottom) / 2 - 960) < 2, `stack centred on the frame (${stackTop}–${stackBottom})`);
assert.ok(unsub.y <= 1920 - B.SIZES['9x16'].safe.bottom + 0.01, 'tall copy stays above the bottom safe zone');
// Highlight: uppercase 97px headline, flat brand box (cap top − 9, baseline + 11).
const hl = R.fitLayout(measure, { ...nfl, style: 'highlight', highlight: 'NFL moves too fast', align: 'left' }, huddle, B.SIZES['9x16'], null);
const box = hl.ops.find(op => op.type === 'box');
const litWord = hl.ops.find(op => op.type === 'text' && op.text === 'NFL');
assert.equal(sizeOf(litWord.font), 97);
assert.equal(box.r, 0);
assert.equal(box.fill, '#CC3333');
assert.equal(litWord.fill, '#FFFFFF');
assert.ok(Math.abs(box.y - (litWord.y - 0.79 * 97.04)) < 0.5 && Math.abs(box.h - 0.9 * 97.04) < 0.5);
assert.equal(B.byId('essentially-cfb').highlight.bg, '#D7A343');
// A long highlight headline steps down (97 → ~74px) to stay within three lines.
const longHl = R.fitLayout(measure, { ...layout, body: [] }, brand, B.SIZES['9x16'], null);
const longOps = longHl.ops.filter(op => op.type === 'text' && /Acumin/.test(op.font) && op.text !== 'SIGN UP ES CFB');
const lineCount = new Set(longOps.map(op => Math.round(op.y))).size;
const longSize = sizeOf(longOps[0].font);
assert.ok(lineCount <= 3 || longSize <= 97.04 * R.BASE.headlineMin + 0.1, `long headline stays within 3 lines (${lineCount} at ${longSize}px)`);
assert.ok(longSize < 97 && longSize >= 97.04 * R.BASE.headlineMin - 0.1);

console.log('Video Ads renderer tests passed.');
