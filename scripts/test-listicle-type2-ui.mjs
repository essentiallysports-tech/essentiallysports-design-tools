import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(source, /<script src="listicle-type2-data\.js"><\/script>/, 'Type 2 data module must load');
assert.match(source, /<option value="listicle-type-2">Listicle Type 2<\/option>/, 'Type 2 must be selectable');
assert.match(
  source,
  /'listicle-type-2': \{[\s\S]*?render: drawListicleType2Post,[\s\S]*?getPayload: getListicleType2Payload/,
  'Type 2 must have an isolated post registry entry',
);
assert.match(source, /let activeListicleType2RowIndex = 0;/, 'the first Type 2 block must open by default');
assert.match(
  source,
  /blockLabel\.textContent = `Block \$\{rowIndex \+ 1\}`;/,
  'Type 2 summaries must use Block 1 through Block 5',
);
assert.match(source, /asset === 'player' \? 10 \* 1024 \* 1024 : 4 \* 1024 \* 1024/, 'asset limits must stay explicit');

const rendererStart = source.indexOf('function drawListicleType2Post');
const rendererEnd = source.indexOf('\nfunction drawListicleRankPill', rendererStart);
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, 'Type 2 renderer must exist');
const renderer = source.slice(rendererStart, rendererEnd);
assert.match(renderer, /const rowStart = 323;[\s\S]*?data\.rows\.forEach/, 'Type 2 must render its fixed row system');
assert.match(renderer, /drawListicleType2Player/, 'Type 2 must render optional player cutouts');
assert.match(source, /function drawListicleType2Rank[\s\S]*?const horizontalPad = 16 \* scale;/, 'rank badges must use equal horizontal padding');
assert.match(source, /function drawListicleType2Rank[\s\S]*?actualBoundingBoxLeft[\s\S]*?actualBoundingBoxRight[\s\S]*?actualBoundingBoxAscent[\s\S]*?actualBoundingBoxDescent/, 'rank badges must use visible glyph bounds for optical padding');
assert.match(source, /function drawListicleType2Rank[\s\S]*?const pillWidth = Math\.min\(width, Math\.ceil\(glyphWidth \+ horizontalPad \* 2\)\);[\s\S]*?const verticalPad = Math\.max\(0, \(height - glyphHeight\) \/ 2\);/, 'rank badges must hug their number with equal visible padding');
assert.match(renderer, /const textX = sx\(315\);/, 'team copy must keep a deliberate gap after the logo frame');
assert.match(renderer, /drawListicleHeading\(ctx, W, scale, data\.title\)/, 'Type 2 must use the shared aligned heading renderer');
assert.match(renderer, /ctx\.moveTo\(left, sx\(LISTICLE_CANVAS_LAYOUT\.dividerY\)\)/, 'Type 2 must keep one header divider at the shared ruler position');
assert.doesNotMatch(renderer, /drawSwipeButton/, 'Type 2 reference must not add a swipe badge');

assert.match(
  source,
  /body:is\(\[data-instagram-post-type="listicle-type-1"\], \[data-instagram-post-type="listicle-type-2"\]\)[\s\S]*?#swipe-button-card/,
  'both listicle modes must hide unrelated workspace controls without changing other post types',
);

console.log('Listicle Type 2 UI tests passed.');
