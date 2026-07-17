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
assert.doesNotMatch(
  rendererSource.slice(rowLoopStart, rowLoopEnd),
  /setLineDash|moveTo\s*\(|lineTo\s*\(|stroke\s*\(/,
  'listicle rows must not render dashed horizontal or vertical separator lines',
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
