// Trend Design: sport classifier and RSS parsing (offline, no network).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _test } = require('../netlify/functions/trend-design.js');
const { classify, parseNews, parseTrends } = _test;

const cases = [
  ['Scottie Scheffler wins at Memorial', 'golf'],
  ['McIlroy and Rahm favourites for DP World Tour Championship title', 'golf'],
  ['Sinner beats Alcaraz in ATP Finals', 'tennis'],
  ['Coco Gauff reaches WTA Finals semis', 'tennis'],
  ['Chiefs rivals won\'t finalize deal made at NFL trade deadline', 'nfl'],
  ['Giants quarterback benched after loss', 'nfl'],
  ['Giants pitcher signs extension', 'mlb'],
  ['Yankees eye Juan Soto reunion', 'mlb'],
  ['Jeremiah Smith Ohio State Football News', 'cfb'],
  ['College Football Playoff rankings: Tennessee climbs', 'cfb'],
  ['Stephen Curry injured versus Rockets', 'others'],
  ['Lakers win 7th straight', 'others'],
];
for (const [text, expected] of cases) {
  assert.equal(classify(text).category, expected, `${text} → ${expected}`);
}

// Non-sports search trends are not classified as a sport.
for (const text of ['Game Of Thrones', 'Cathay Pacific', 'Kylie Jenner lawsuit', 'PS6 release date']) {
  assert.equal(classify(text).category, null, `${text} should not be a sport`);
}

// Google News RSS: title without " - Source", source and link kept.
const news = parseNews(`<rss><channel><item><title>Brewers’ Misiorowski wins NL Cy Young - ESPN</title><link>https://news.google.com/articles/abc</link><pubDate>Wed, 11 Nov 2026 20:00:00 GMT</pubDate><source url="https://espn.com">ESPN</source></item></channel></rss>`);
assert.equal(news.length, 1);
assert.equal(news[0].title, 'Brewers’ Misiorowski wins NL Cy Young');
assert.equal(news[0].source, 'ESPN');
assert.equal(news[0].type, 'news');

// Google Trends RSS: traffic, picture and related news.
const trends = parseTrends(`<rss><channel><item><title>jeremiah smith</title><ht:approx_traffic>200+</ht:approx_traffic><pubDate>Wed, 11 Nov 2026 23:00:00 -0800</pubDate><ht:picture>https://encrypted-tbn2.gstatic.com/x</ht:picture><ht:news_item><ht:news_item_title>Ohio State launches Heisman campaign</ht:news_item_title><ht:news_item_url>https://example.com/a</ht:news_item_url><ht:news_item_source>Eleven Warriors</ht:news_item_source></ht:news_item></item></channel></rss>`);
assert.equal(trends[0].title, 'Jeremiah Smith');
assert.equal(trends[0].traffic, '200+');
assert.equal(trends[0].type, 'search');
assert.equal(trends[0].related[0].source, 'Eleven Warriors');
assert.match(trends[0].image, /^https:/);

console.log(`trend-design: ${cases.length + 4} classifier cases and RSS parsing passed`);
