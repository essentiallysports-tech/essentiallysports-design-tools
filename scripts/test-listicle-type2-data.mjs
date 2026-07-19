import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const listicle = require('../listicle-type2-data.js');

const defaults = listicle.createDefaultListicleData();
assert.equal(defaults.schemaVersion, 1);
assert.equal(defaults.rows.length, 5, 'Type 2 must always contain exactly five rows');
assert.deepEqual(defaults.rows.map(row => row.rank), ['1', '2', '3', '4', '5']);
assert.deepEqual(defaults.rows.map(row => row.logoSrc), listicle.DEFAULT_LOGO_SOURCES);
assert.equal(defaults.title, 'MVP Ladder\nUpdate');

const oversized = listicle.normalizeListicleData({
  title: 'First line\nSecond line\nThird line',
  rows: Array.from({ length: 8 }, (_, index) => ({
    rank: String(index + 1),
    entity: `Player ${index + 1}`,
    subtitle: `Team ${index + 1}`,
  })),
});
assert.equal(oversized.rows.length, 5, 'Type 2 must discard rows beyond five');
assert.equal(oversized.title, 'First line\nSecond line Third line');

const changed = listicle.updateListicleRow(defaults, 2, {
  entity: 'Updated Player',
  subtitle: 'Updated Team',
  playerSrc: 'data:image/webp;base64,AAAA',
  playerName: 'player.webp',
});
assert.equal(changed.rows[2].entity, 'Updated Player');
assert.equal(changed.rows[2].subtitle, 'Updated Team');
assert.equal(changed.rows[2].playerName, 'player.webp');
assert.equal(changed.rows[1].entity, defaults.rows[1].entity, 'editing one block must not leak into another');

const hostile = listicle.updateListicleRow(defaults, 0, {
  accent: 'red',
  logoSrc: 'javascript:alert(1)',
  playerSrc: 'https://unsafe.example/player.png',
});
assert.equal(hostile.rows[0].accent, listicle.DEFAULT_ACCENTS[0]);
assert.equal(hostile.rows[0].logoSrc, '');
assert.equal(hostile.rows[0].playerSrc, '');

const ignoredSixth = listicle.updateListicleRow(defaults, 5, { entity: 'Sixth Player' });
assert.equal(ignoredSixth.rows.some(row => row.entity === 'Sixth Player'), false);

console.log('Listicle Type 2 data tests passed.');
