// Background learning from past designs: normalising exports, picking
// examples for a brief, and preferring confirmed brief -> design pairs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { selectExamples, formatExamples, _test } = require('../netlify/functions/_generate-examples.js');

const designs = _test.normalize([
  { variant: 'Cover Image', title: 'Does Patrick Mahomes Really Deserve This?', at: '2026-10-20' },
  { variant: 'Cover Image', title: 'Does Patrick Mahomes Really Deserve This?', at: '2026-10-19' },
  { variant: 'Twitter Quotes', title: 'nfl-rams', at: '2026-10-18' },
  { variant: 'Cover Image', title: 'adams-injury-is-just-the-tip', at: '2026-10-18' },
  { variant: 'Listicle Type 1', title: '10-highest-scoring-nfl-offenses-in-2021', at: '2026-10-17' },
  { variant: 'Stats Post Single Ent', title: 'statement made 30 PTS 16 reb 3 ast', at: '2026-10-16' },
  { variant: 'Cover Image', title: 'Can Anyone Stop Mahomes?', brief: 'mahomes after the chiefs win', at: '2026-10-15' },
  { variant: 'Long Quote Image', title: 'x'.repeat(200), at: '2026-10-14' },
]);
assert.equal(designs.filter(d => d.text === 'Does Patrick Mahomes Really Deserve This?').length, 1, 'duplicates removed');
assert.ok(!designs.some(d => d.text === 'nfl-rams' || /adams injury/.test(d.text)), 'slug names of non-rankings are dropped');
assert.ok(designs.some(d => d.postType === 'listicle-type-1' && d.topicOnly && d.text === '10 highest scoring nfl offenses in 2021'), 'ranking slugs become topics');
assert.ok(designs.every(d => d.text.length <= 110), 'long texts are trimmed');
assert.equal(designs[0].text, 'Does Patrick Mahomes Really Deserve This?', 'newest first');

const picked = selectExamples('Mahomes after the Chiefs win: we are not done yet', designs);
assert.equal(picked[0].brief, 'mahomes after the chiefs win', 'the confirmed brief -> design pair ranks first');
assert.ok(picked.some(d => d.postType === 'stats-single-ent'), 'style anchors for other templates are included');
assert.ok(formatExamples(picked).includes('brief "mahomes after the chiefs win" -> the team used: Can Anyone Stop Mahomes?'));
assert.ok(selectExamples('anything', designs, ['cover']).every(d => d.postType === 'cover'), 'respects requested formats');
console.log('generate examples checks passed');
