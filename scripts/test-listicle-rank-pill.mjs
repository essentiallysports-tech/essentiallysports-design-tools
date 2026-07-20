import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rendererStart = source.indexOf('function drawListicleType1Post');
const rendererEnd = source.indexOf('\nfunction drawListicleRankPill', rendererStart);
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, 'listicle renderer must exist');
const rendererSource = source.slice(rendererStart, rendererEnd);
const rowLoopStart = rendererSource.indexOf('data.rows.forEach');
const rowLoopEnd = rendererSource.indexOf('drawSwipeButton', rowLoopStart);
assert.ok(rowLoopStart >= 0 && rowLoopEnd > rowLoopStart, 'listicle row renderer must exist');
assert.match(
  rendererSource.slice(rowLoopStart, rowLoopEnd),
  /index < data\.rows\.length - 1[\s\S]*?setLineDash\(\[sx\(9\), sx\(9\)\]\)[\s\S]*?moveTo\(left, separatorY\)[\s\S]*?lineTo\(right, separatorY\)/,
  'listicle rows must retain dotted separators between adjacent rows',
);
assert.equal(
  (rendererSource.match(/const headerTop = sx\(LISTICLE_TYPE1_TABLE_LAYOUT\.dividerY\)/g) || []).length,
  1,
  'listicle header must use one solid top divider',
);
assert.match(
  source,
  /const LISTICLE_TYPE1_TABLE_LAYOUT = Object\.freeze\(\{[\s\S]*?dividerY: 232,[\s\S]*?headerY: 278,[\s\S]*?rowTop: 324,[\s\S]*?rowHeight: 170,[\s\S]*?\}\);/,
  'Listicle Type 1 must keep a compact, evenly spaced table-header rhythm',
);
assert.match(
  rendererSource,
  /fillText\(String\(header\.text\)\.toUpperCase\(\), sx\(header\.x\), sx\(LISTICLE_TYPE1_TABLE_LAYOUT\.headerY\)\)[\s\S]*?const rowTop = LISTICLE_TYPE1_TABLE_LAYOUT\.rowTop/,
  'Listicle Type 1 must use the dedicated table spacing values',
);
assert.match(
  source,
  /const LISTICLE_CANVAS_LAYOUT = Object\.freeze\(\{[\s\S]*?safeInset: 50,[\s\S]*?titleTop: 50,[\s\S]*?dividerY: 250,[\s\S]*?function drawListicleHeading/,
  'both listicle templates must share the approved 50px ruler inset and heading geometry',
);
assert.match(
  source,
  /const firstLineMetrics = ctx\.measureText\(title\.lines\[0\] \|\| 'A'\);[\s\S]*?const firstLineAscent = firstLineMetrics\.actualBoundingBoxAscent \|\| title\.capAscent;[\s\S]*?const titleBaselineY = titleBox\.y \+ firstLineAscent;[\s\S]*?drawEsLogoMark\(ctx, logoX, sx\(LISTICLE_CANVAS_LAYOUT\.titleTop\), logoWidth, logoHeight\)/,
  'the shared listicle heading must align the title glyph top and ES logo to the same ruler',
);
assert.match(
  rendererSource,
  /drawListicleHeading\(ctx, W, scale, data\.title\)/,
  'Listicle Type 1 must use the shared heading renderer',
);
assert.match(
  source,
  /function fitListicleTwoLineEntity[\s\S]*?words\.length < 2[\s\S]*?for \(let split = 1; split < words\.length; split \+= 1\)[\s\S]*?lines = \[words\.slice\(0, bestSplit\)\.join\(' '\), words\.slice\(bestSplit\)\.join\(' '\)\]/,
  'Listicle Type 1 must balance multi-word team names into exactly two lines',
);
assert.match(
  rendererSource,
  /const entity = fitListicleTwoLineEntity\(ctx, row\.entity, sx\(335\), 54 \* scale, 34 \* scale\)/,
  'Listicle Type 1 rows must use the dedicated two-line entity fitter',
);
const entityFitStart = source.indexOf('function wrapListicleWords');
const entityFitEnd = source.indexOf('\nfunction fitListicleBlockInBox', entityFitStart);
assert.ok(entityFitStart >= 0 && entityFitEnd > entityFitStart, 'two-line entity fitting helpers must exist');
const entityFitSandbox = { Math, Number, POST_FONT_FAMILY: 'Roboto Condensed' };
vm.runInNewContext(
  `${source.slice(entityFitStart, entityFitEnd)}\nthis.fitEntity = fitListicleTwoLineEntity;`,
  entityFitSandbox,
);
const entityFitContext = {
  font: '',
  measureText(value) {
    const fontSize = Number(String(this.font).match(/([0-9.]+)px/)?.[1] || 16);
    return { width: String(value).length * fontSize * 0.48 };
  },
};
[
  ['Texas Rangers', ['TEXAS', 'RANGERS']],
  ['Cincinnati Reds', ['CINCINNATI', 'REDS']],
  ['Los Angeles Angels', ['LOS ANGELES', 'ANGELS']],
  ['Baltimore Orioles', ['BALTIMORE', 'ORIOLES']],
  ['Detroit Tigers', ['DETROIT', 'TIGERS']],
].forEach(([name, expected]) => {
  assert.deepEqual(
    Array.from(entityFitSandbox.fitEntity(entityFitContext, name, 335, 54, 34).lines),
    expected,
    `${name} must render as the approved two-line team block`,
  );
});
assert.doesNotMatch(
  rendererSource,
  /const headerBottom|moveTo\(left,\s*sx\(34[0-9]\)\)/,
  'listicle header must not render the removed duplicate solid divider',
);
assert.match(
  source,
  /function fitListicleHeaderFont[\s\S]*?`500 \$\{Math\.round\(size\)\}px "Roboto Condensed"/,
  'listicle column headings must be measured with Roboto Condensed Medium',
);
assert.match(
  source,
  /const size = fitListicleHeaderFont[\s\S]*?ctx\.font = `500 \$\{Math\.round\(size\)\}px "Roboto Condensed"/,
  'listicle column headings must render with Roboto Condensed Medium',
);
const functionStart = source.indexOf('function drawListicleRankPill');
const functionEnd = source.indexOf('\nfunction drawStatsText', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'listicle rank-pill renderer must exist');

const sandbox = {
  Math,
  POST_FONT_FAMILY: 'Roboto Condensed',
  PILL_FONT_SIZE: 130,
  PILL_H: 122,
  PILL_PAD_LEFT: 18.4,
  PILL_PAD_RIGHT: 21.88,
};
vm.runInNewContext(
  `${source.slice(functionStart, functionEnd)}\nthis.renderRankPill = drawListicleRankPill;`,
  sandbox,
);

function createMockContext() {
  let fontSize = 16;
  const stateStack = [];
  const draws = [];
  const ctx = {
    textAlign: 'center',
    textBaseline: 'middle',
    fillStyle: '#000000',
    get font() { return `900 ${fontSize}px sans-serif`; },
    set font(value) {
      const match = String(value).match(/([0-9.]+)px/);
      if (match) fontSize = Number(match[1]);
    },
    save() {
      stateStack.push({
        textAlign: this.textAlign,
        textBaseline: this.textBaseline,
        fillStyle: this.fillStyle,
        fontSize,
      });
    },
    restore() {
      const previous = stateStack.pop();
      if (!previous) return;
      this.textAlign = previous.textAlign;
      this.textBaseline = previous.textBaseline;
      this.fillStyle = previous.fillStyle;
      fontSize = previous.fontSize;
    },
    measureText(value) {
      assert.equal(this.textAlign, 'left', 'pill text must be measured with left alignment');
      assert.equal(this.textBaseline, 'alphabetic', 'pill text must be measured on an alphabetic baseline');
      const text = String(value);
      const width = fontSize * (text === 'A' ? 0.54 : text.length === 2 ? 0.93 : 0.51);
      return {
        width,
        actualBoundingBoxAscent: fontSize * 0.72,
        actualBoundingBoxDescent: fontSize * 0.04,
      };
    },
    fillRect(x, y, width, height) {
      draws.push({ type: 'rect', x, y, width, height, fillStyle: this.fillStyle });
    },
    fillText(value, x, y) {
      const metrics = this.measureText(value);
      draws.push({ type: 'text', value: String(value), x, y, metrics, fillStyle: this.fillStyle });
    },
  };
  return { ctx, draws };
}

const results = ['10', '9', '8', '7', '6'].map(rank => {
  const { ctx, draws } = createMockContext();
  sandbox.renderRankPill(ctx, rank, '#003278', 49, 100, 1);
  const rect = draws.find(draw => draw.type === 'rect');
  const text = draws.find(draw => draw.type === 'text');
  assert.ok(rect && text, `rank ${rank} must render a pill and text`);
  assert.equal(rect.height, 88, `rank ${rank} must use the established fixed pill height`);

  const leftPadding = text.x - rect.x;
  const rightPadding = rect.x + rect.width - (text.x + text.metrics.width);
  const textTop = text.y - text.metrics.actualBoundingBoxAscent;
  const textBottom = text.y + text.metrics.actualBoundingBoxDescent;
  const topPadding = textTop - rect.y;
  const bottomPadding = rect.y + rect.height - textBottom;

  assert.ok(Math.abs(leftPadding - sandbox.PILL_PAD_LEFT) < 0.01, `rank ${rank} must preserve shared left padding`);
  assert.ok(Math.abs(rightPadding - sandbox.PILL_PAD_RIGHT) < 0.01, `rank ${rank} must preserve shared right padding`);
  assert.ok(Math.abs(topPadding - bottomPadding) <= 1, `rank ${rank} must have balanced top and bottom padding`);
  assert.ok(topPadding >= 0 && bottomPadding >= 0, `rank ${rank} text must remain inside its pill`);
  return { rank, width: rect.width };
});

assert.ok(
  results.find(result => result.rank === '10').width > results.find(result => result.rank === '9').width,
  'two-digit ranks must expand the pill width instead of reducing established inner padding',
);

console.log('Listicle rank-pill layout tests passed.');
