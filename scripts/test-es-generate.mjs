import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _test } = require('../netlify/functions/es-generate.js');
const { checkFields, checkSpec, classifyTools, buildArgs, extractJson, draftPlan } = _test;

// Valid specs become the exact line format the editor reads.
assert.deepEqual(checkFields('cover', { pills: ['LeBron James', 'Passes 50,000'] }).lines, ['LeBron James', 'Passes 50,000']);
assert.deepEqual(
  checkFields('stats-single-ent', { headline: 'Record Alert!', stats: [{ value: '50K', label: 'PTS' }, { value: '21', label: 'Seasons' }, { value: '4', label: 'MVP' }] }).lines,
  ['Record Alert!', '50K | PTS', '21 | Seasons', '4 | MVP'],
);
assert.equal(checkFields('stats-double-ent', {
  headline: 'Who Won The Trade?',
  a: { name: 'Luka Doncic', stats: [1, 2, 3, 4].map(n => ({ value: String(n), label: 'PTS' })) },
  b: { name: 'Anthony Davis', stats: [1, 2, 3, 4].map(n => ({ value: String(n), label: 'PTS' })) },
}).lines.length, 11);
assert.deepEqual(
  checkFields('double-entity-quote', { a: { quote: 'I will watch it from Cabo!', name: 'LeBron James' }, b: { quote: 'Never say never', name: 'Stephen Curry', context: 'on 2028' } }).lines,
  ['I will watch it from Cabo!', 'LeBron James', '', 'Never say never', 'Stephen Curry', 'on 2028'],
);
assert.deepEqual(checkFields('long-quote', { text: '"We are not done yet, not even close."' }).lines, ['We are not done yet, not even close.']);

// Anything outside the template limits is rejected, never cut short.
assert.ok(checkFields('cover', { pills: ['x'.repeat(21)] }).error);
assert.ok(checkFields('double-entity-quote', { a: { quote: 'x'.repeat(49), name: 'A B' }, b: { quote: 'Fine', name: 'C D' } }).error);
assert.ok(checkFields('cover', { pills: ['One', 'Two', 'Three', 'Four', 'Five'] }).error);
assert.ok(checkFields('quote', { lines: ['This line is far too long'] }).error);
assert.ok(checkFields('stats-single-ent', { headline: 'Hi there', stats: [{ value: '1', label: 'A' }] }).error);
assert.ok(checkFields('stats-single-ent', { headline: 'Hi there', stats: [1, 2, 3].map(() => ({ value: '12345678', label: 'PTS' })) }).error);
assert.ok(checkFields('listicle-type-1', {}).error);

// Specs: unknown types, unrequested formats and non-ES sources are filtered.
assert.ok(checkSpec({ postType: 'banner', fields: {} }, 0, []).error);
assert.ok(checkSpec({ postType: 'cover', fields: { pills: ['A Headline'] } }, 0, ['quote']).error);
const spec = checkSpec({
  postType: 'cover',
  fields: { pills: ['A Headline'] },
  sources: ['https://www.essentiallysports.com/nba-news-x/', 'https://evil.example.com/x', { url: 'https://essentiallysports.com/y', title: 'Y' }],
}, 0, []).spec;
assert.deepEqual(spec.sources.map(s => s.url), ['https://www.essentiallysports.com/nba-news-x/', 'https://essentiallysports.com/y']);
assert.equal(spec.photoQuery, '');
assert.equal(checkSpec({ postType: 'stats-double-ent', photoQuery: 'Luka', fields: {} }, 0, []).error.includes('head-to-head'), true);

// Tool discovery by name/description; image search never doubles as articles.
const roles = classifyTools([
  { name: 'search_images', description: 'Search agency images' },
  { name: 'search_articles', description: 'Search ES news articles' },
  { name: 'get_player_stats', description: 'Player stat lines' },
  { name: 'trending_topics', description: 'What is hot now' },
  { name: 'summarize', description: 'Summarize text' },
]);
assert.equal(roles.images.name, 'search_images');
assert.equal(roles.articles.name, 'search_articles');
assert.equal(roles.stats.name, 'get_player_stats');
assert.equal(roles.trending.name, 'trending_topics');
assert.equal(roles.think.name, 'summarize');
assert.equal(classifyTools([{ name: 'search_images' }]).think, null);

// Arguments follow the tool's schema; missing required inputs skip the call.
assert.deepEqual(buildArgs({ schema: { properties: { query: { type: 'string' }, limit: { type: 'number' } } } }, 'LeBron'), { query: 'LeBron', limit: 5 });
assert.deepEqual(buildArgs({ schema: { properties: { prompt: { type: 'string' } } } }, 'Hi'), { prompt: 'Hi' });
assert.equal(buildArgs({ schema: { properties: { id: { type: 'number' } }, required: ['id'] } }, 'Hi'), null);

// JSON is found inside chatty replies or code fences.
assert.deepEqual(extractJson('Sure!\n```json\n{"designs": [{"postType": "cover"}]}\n```'), { designs: [{ postType: 'cover' }] });
assert.equal(extractJson('no json here'), null);

// Draft mode only reuses text from the brief or ES story, and stays valid.
const draft = draftPlan('LeBron James says "We are not done yet" after 38 PTS 9 AST 7 REB win', { articles: [] }, []);
assert.deepEqual(draft.map(d => d.postType), ['cover', 'quote', 'stats-single-ent']);
assert.deepEqual(draft.find(d => d.postType === 'quote').fields.lines, ['We Are Not Done', 'Yet']);
const longQuote = draftPlan('Curry: "We have to keep believing in each other, no matter what anyone says"', { articles: [] }, []);
assert.equal(longQuote.find(d => d.postType === 'long-quote')?.fields.text, 'We have to keep believing in each other, no matter what anyone says');
draft.forEach((design, index) => assert.ok(checkSpec(design, index, []).spec, `draft ${design.postType} must pass checks`));
assert.deepEqual(draft.find(d => d.postType === 'stats-single-ent').fields.stats, [{ value: '38', label: 'PTS' }, { value: '9', label: 'AST' }, { value: '7', label: 'REB' }]);
assert.equal(draftPlan('Celtics win', { articles: [] }, ['quote']).length, 0);

console.log('es-generate checks passed');
