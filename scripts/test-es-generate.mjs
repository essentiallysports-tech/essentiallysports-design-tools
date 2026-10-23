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
// The real ES MCP (2026-10): data tools only. Nothing may be mistaken for a writer,
// even tools whose descriptions say they "answer questions".
const esRoles = classifyTools(['search_images', 'query_articles', 'brief_podcast', 'latest_nba_angles', 'datalake_query', 'daily_top_pages',
  'newsletter_post_metrics', 'social_post_performance', 'syndication_article_status', 'syndication_published_index', 'query_tracker_report']
  .map(name => ({ name, description: 'Answers questions like... generate summaries' })));
assert.deepEqual(Object.fromEntries(Object.entries(esRoles).map(([role, tool]) => [role, tool?.name || null])),
  { images: 'search_images', articles: 'query_articles', stats: null, trending: null, think: null });

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

// Who a design is about, their league from ES URLs, and the text to match a team.
const { mainWord, sportFromUrl, brandHints } = _test;
assert.equal(mainWord('Patrick Mahomes Chiefs'), 'mahomes');
assert.equal(mainWord('Caitlin Clark'), 'clark');
assert.equal(mainWord('lakers losing streak'), 'lakers');
assert.equal(sportFromUrl('https://www.essentiallysports.com/nfl-active-news-x/'), 'NFL');
assert.equal(sportFromUrl('https://www.essentiallysports.com/wnba-news-x/'), 'WNBA');
assert.equal(sportFromUrl('https://www.essentiallysports.com/golf-news-x/'), '');
const hints = brandHints({ photoQuery: 'Caitlin Clark' }, 'Caitlin Clark scores 30', [
  { title: 'Caitlin Clark and the Fever roll', excerpt: '', url: 'https://www.essentiallysports.com/wnba-news-a/' },
  { title: 'Chiefs win again', excerpt: '', url: 'https://www.essentiallysports.com/nfl-news-b/' },
]);
assert.equal(hints.sport, 'WNBA', 'only stories about the person decide the league');
assert.equal(hints.person, 'clark');
assert.ok(hints.text.includes('Fever') && !hints.text.includes('Chiefs'));

console.log('es-generate checks passed');

// ES MCP query_articles markdown → articles tagged with sport and teams.
const parsed = _test.parseEsArticles(`6 results

**[LeBron James' 76ers Hit With Huge Blow Hours Before Season Opener Vs. Knicks](https://www.essentiallysports.com/nba-active-basketball-news-lebron-james-76ers-hit/)**
Sport: NBA | Writer: Krishna | Editor: A | Published: 00:41 | Entity: Lebron James,76Ers,Knicks | Type: Trend Setting
PVs: 8,359

**[Caitlin Clark Snubbed by Own Team &amp; More](https://www.essentiallysports.com/wnba-basketball-news-caitlin-clark-snubbed/)**
Sport: WNBA/NCAA | Writer: O | Published: 03:46 | Type: In-Depth

**[Not ES](https://evil.example.com/x)**
Sport: NBA | Entity: X`);
assert.deepEqual(parsed.map(a => [a.sport, a.excerpt]), [
  ['NBA', 'Sport: NBA. Tagged: Lebron James,76Ers,Knicks.'],
  ['WNBA', 'Sport: WNBA.'],
]);
assert.equal(parsed[1].title, 'Caitlin Clark Snubbed by Own Team & More');
console.log('es-mcp article parsing checks passed');

// Quote templates name no speaker: third-person words about someone are rejected.
assert.match(checkFields('quote', { lines: ['He Done Stacked', 'His Team'] }).error, /about the person/);
assert.match(checkFields('long-quote', { text: 'He is the greatest player this league has ever seen.' }).error, /about the person/);
assert.ok(checkFields('quote', { lines: ['We Are Not Done', 'Yet'] }).lines, 'first-person quotes pass');
assert.ok(checkFields('long-quote', { text: 'I told him we would win this one for my family.' }).lines, 'first person with him/my passes');
console.log('quote speaker checks passed');

// Tables in the brief: web-pasted (one cell per line) and sheet (tabs) both
// become a Rankings Table with the exact names and values.
const webTable = 'MOST SEASONS STARTING 5-0 TOGETHER IN NFL HISTORY\n\nRank\nQuarterback\nHead Coach\nSeasons Starting 5-0 Together\n1\nTom Brady\nBill Belichick\n4\n2\nPeyton Manning\nTony Dungy\n4\n3\nFran Tarkenton\nBud Grant\n3\n4\nPatrick Mahomes\nAndy Reid\n3';
const fromWeb = checkSpec(_test.tableDesign(_test.parseTableBrief(webTable)), 0, []).spec.listicle;
assert.equal(fromWeb.title, 'MOST SEASONS STARTING 5-0\nTOGETHER IN NFL HISTORY');
assert.deepEqual([fromWeb.entityHeader, fromWeb.metric1Header, fromWeb.metric2Header], ['Quarterback', 'Head Coach', 'Seasons']);
assert.deepEqual(fromWeb.rows.map(r => [r.rank, r.entity, r.metric1, r.metric2]), [
  ['1', 'Tom Brady', 'Bill Belichick', '4'], ['2', 'Peyton Manning', 'Tony Dungy', '4'],
  ['3', 'Fran Tarkenton', 'Bud Grant', '3'], ['4', 'Patrick Mahomes', 'Andy Reid', '3'],
]);
const fromSheet = checkSpec(_test.tableDesign(_test.parseTableBrief('Top scorers\nRank\tPlayer\tTeam\tPTS\n1\tLuka Doncic\tLakers\t33.9\n2\tShai Gilgeous-Alexander\tThunder\t32.7\n3\tGiannis Antetokounmpo\tBucks\t30.4')), 0, []).spec.listicle;
assert.deepEqual(fromSheet.rows.map(r => r.metric2), ['33.9', '32.7', '30.4']);
assert.equal(_test.parseTableBrief('Patrick Mahomes after the Chiefs win: 320 YDS, 3 TD'), null, 'plain briefs are not tables');
assert.ok(checkFields('listicle-type-1', { title: 'T', entityHeader: 'A', metric1Header: 'B', metric2Header: 'C', rows: [{ entity: 'X', metric1: '1', metric2: '2' }] }).error, 'needs 3+ rows');
console.log('table brief checks passed');

// Quotes must be real words from the brief or research.
const source = _test.squash('Mahomes after the win: "We are not done yet." 320 YDS');
const quoteSpec = fields => checkSpec({ postType: 'quote', fields }, 0, []).spec;
assert.equal(_test.fakeQuote(quoteSpec({ lines: ['We Are Not', 'Done Yet'] }), source), '', 'a real quote, re-split and re-cased, passes');
assert.match(_test.fakeQuote(quoteSpec({ lines: ['Dream', 'Duo'] }), source), /not in the brief/);
console.log('real quote checks passed');
