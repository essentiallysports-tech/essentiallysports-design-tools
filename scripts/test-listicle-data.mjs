import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const listicle = require('../listicle-data.js');

const defaults = listicle.createDefaultListicleData();
assert.equal(defaults.schemaVersion, 1);
assert.equal(defaults.rows.length, 5, 'defaults must contain exactly five rows');
assert.deepEqual(defaults.rows.map(row => row.id), [
  'listicle-row-1',
  'listicle-row-2',
  'listicle-row-3',
  'listicle-row-4',
  'listicle-row-5',
]);
assert.deepEqual(
  defaults.rows.map(row => row.logoSrc),
  listicle.DEFAULT_LOGO_SOURCES,
  'all five default rows must include safe local placeholder logos',
);
assert.deepEqual(
  defaults.rows.map(row => row.rank),
  ['1', '2', '3', '4', '5'],
  'the five default listicle ranks must run from 1 through 5',
);

const oversized = listicle.normalizeListicleData({
  title: 'A'.repeat(200),
  rows: Array.from({ length: 12 }, (_, index) => ({
    id: `unsafe-${index}`,
    rank: String(index + 1),
    entity: `Entity ${index + 1}`,
    metric1: `${index}-0`,
    metric2: '.500',
  })),
});
assert.equal(oversized.rows.length, 5, 'extra rows must be discarded');
assert.equal(oversized.title.length, listicle.LIMITS.title, 'title must be length-limited');
assert.equal(oversized.rows[4].entity, 'Entity 5');

const undersized = listicle.normalizeListicleData({
  rows: [{ rank: '1', entity: 'Only One', metric1: '10', metric2: '20' }],
});
assert.equal(undersized.rows.length, 5, 'missing rows must be restored');
assert.equal(undersized.rows[0].entity, 'Only One');
assert.equal(undersized.rows[1].entity, 'Entity', 'missing rows must use neutral safe content');
assert.deepEqual(undersized.rows.map(row => row.rank), ['1', '2', '3', '4', '5']);

const hostile = listicle.normalizeListicleData({
  title: 'Title\u0000\nwith controls',
  rows: [{
    rank: '123456',
    entity: 'X'.repeat(100),
    metric1: 'Y'.repeat(100),
    metric2: 'Z'.repeat(100),
    accent: 'not-a-color',
    logoSrc: 'javascript:alert(1)',
  }],
});
assert.equal(hostile.rows[0].rank.length, listicle.LIMITS.rank);
assert.equal(hostile.rows[0].entity.length, listicle.LIMITS.entity);
assert.equal(hostile.rows[0].metric1.length, listicle.LIMITS.metric);
assert.equal(hostile.rows[0].metric2.length, listicle.LIMITS.metric);
assert.equal(hostile.rows[0].accent, listicle.DEFAULT_ACCENTS[0]);
assert.equal(hostile.rows[0].logoSrc, '');
assert.equal(hostile.title, 'Title\nwith controls');

const safePlaceholder = listicle.updateListicleRow(defaults, 0, {
  logoSrc: 'assets/listicle-placeholders/clemson.png',
});
assert.equal(safePlaceholder.rows[0].logoSrc, 'assets/listicle-placeholders/clemson.png');

const validLogo = 'data:image/png;base64,AAAA';
const withLogo = listicle.updateListicleRow(defaults, 2, {
  logoSrc: validLogo,
  logoName: 'logo.png',
});
assert.equal(withLogo.rows[2].logoSrc, validLogo);
assert.equal(withLogo.rows[2].logoName, 'logo.png');
assert.equal(withLogo.rows.length, 5);

const invalidUpdate = listicle.updateListicleRow(defaults, 5, { entity: 'Sixth row' });
assert.equal(invalidUpdate.rows.length, 5);
assert.equal(invalidUpdate.rows.some(row => row.entity === 'Sixth row'), false, 'sixth row updates must be ignored');

const changedHeader = listicle.updateListicleField(defaults, 'metric1Header', 'Points');
assert.equal(changedHeader.metric1Header, 'Points');
assert.equal(changedHeader.rows.length, 5);

const multilineTitle = listicle.updateListicleField(defaults, 'title', 'First title line\nSecond title line');
assert.equal(multilineTitle.title, 'First title line\nSecond title line', 'title must preserve one explicit line break');
const excessiveTitleLines = listicle.updateListicleField(defaults, 'title', 'First\nSecond\nThird');
assert.equal(excessiveTitleLines.title, 'First\nSecond Third', 'title must safely collapse content beyond two lines');

const titleWithTypingSpace = listicle.updateListicleField(defaults, 'title', 'Worst MLB ');
assert.equal(titleWithTypingSpace.title, 'Worst MLB ', 'title must preserve a trailing space while the user types');
const rowWithTypingSpace = listicle.updateListicleRow(defaults, 0, { entity: 'Texas ' });
assert.equal(rowWithTypingSpace.rows[0].entity, 'Texas ', 'row text must preserve a trailing space between words');
const rowWithCompleteWords = listicle.updateListicleRow(rowWithTypingSpace, 0, { entity: 'Texas Rangers' });
assert.equal(rowWithCompleteWords.rows[0].entity, 'Texas Rangers', 'spaces between complete words must remain intact');

console.log('Listicle data tests passed.');
