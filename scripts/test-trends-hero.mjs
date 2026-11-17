// Trends hero round (2026-11-18): offline, no network.
//   1. trends-logic.js: Post now picks, storyline folding, why-now, hand-offs
//      (Generate, Video Ads, Reels Studio), post kit + clipboard text,
//      shortlist text, the browser AI cache TTL, keyboard shortcuts.
//   2. trend-design.js: storylines, hot / rising signals, ES fit per brand,
//      template + photo suggestions, quick-idea junk filter, noise and
//      classifier fixes, AI grounding (no invented numbers), the reel hook.
//   3. Wiring: generate.html loads the view, AI never fires on load or hover.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');
const L = require(path.join(ROOT, 'trends-logic.js'));
globalThis.fetch = async url => { throw new Error(`unexpected fetch ${url}`); };
const T = require(path.join(ROOT, 'netlify/functions/trend-design.js'))._test;
let passed = 0;
const ok = (name, fn) => { fn(); passed += 1; };

const NOW = Date.parse('2026-11-18T12:00:00Z');
const hoursAgo = h => new Date(NOW - h * 3600e3).toISOString();
const story = (id, category, rank, extra = {}) => ({ id, category, rank, type: 'news', title: `Story ${id}`, publishedAt: hoursAgo(1), url: `https://example.com/${id}`, source: 'ESPN', related: [], ...extra });

// ── 1. trends-logic.js ──────────────────────────────────────────────────
ok('topPicks: one per storyline, at most 2 per sport, fit and signal weigh in', () => {
  const s = { id: 's-golf-dechambeau', label: 'Bryson DeChambeau', size: 3 };
  const items = [
    story('a', 'golf', 2.0, { storyline: { ...s, lead: true }, fit: { score: 60 } }),
    story('b', 'golf', 1.9, { storyline: { ...s, lead: false }, fit: { score: 60 } }),
    story('c', 'golf', 1.8, { fit: { score: 60 } }),
    story('d', 'golf', 1.7, { fit: { score: 60 } }),
    story('e', 'nfl', 1.0, { fit: { score: 100, brand: 'the-huddle' }, signal: 'hot' }),
    story('f', 'mlb', 1.2, { fit: { score: 40 } }),
  ];
  const picks = L.topPicks(items, { n: 5 }).map(i => i.id);
  assert.deepEqual(picks, ['a', 'c', 'e', 'f']);
  assert.ok(L.pickScore(items[4]) > L.pickScore({ ...items[4], signal: null }));
});

ok('foldStorylines keeps lead order and folds members', () => {
  const s = id => ({ id, label: id, size: 2 });
  const folded = L.foldStorylines([story('a', 'nfl', 3, { storyline: s('x') }), story('b', 'nfl', 2), story('c', 'nfl', 1, { storyline: s('x') })]);
  assert.deepEqual(folded.map(e => [e.item.id, e.more.map(m => m.id)]), [['a', ['c']], ['b', []]]);
});

ok('whyNow: searches, storyline size, outlets, brand; no repeated signal word', () => {
  const text = L.whyNow(story('a', 'nfl', 1, { signal: 'hot', coverage: 3, storyline: { id: 'x', size: 5 }, fit: { brand: 'the-huddle' } }));
  assert.equal(text, '5 stories on this · 3 outlets · fits The Huddle');
  assert.equal(L.whyNow(story('b', 'golf', 1, { type: 'search', traffic: '50K+' })), '50K+ searches');
});

ok('hand-offs: Generate brief, Video Ads, Reels Studio contract', () => {
  const item = story('t-1', 'nfl', 1, { title: 'Broncos drop 3 spots', team: { name: 'Denver Broncos', short: 'Broncos' }, related: [{ title: 'Power rankings week 11', url: 'https://x.com', source: 'X' }] });
  const brief = L.briefFor(item, { headline: 'Broncos slide', why: 'Bye week hurt', sportLabel: 'NFL' });
  assert.match(brief, /^Headline: Broncos slide\nStory: Broncos drop 3 spots\nContext: Power rankings week 11\nWhy fans care: Bye week hurt\nTeam: Denver Broncos\nSport: NFL$/);
  const v = L.videoHandoff(item, { why: 'w' });
  assert.equal(v.key, 'frameup.videoAdMoment.v1');
  assert.match(v.url, /^video-ads\.html\?from=trends&sport=nfl&moment=Broncos\+drop\+3\+spots&team=Denver\+Broncos&trend=t-1$/);
  const r = L.reelHandoff(item, { hook: 'Did the bye cost Denver?' });
  assert.equal(r.key, 'frameup.reelMoment.v1');
  const q = new URL(r.url, 'https://x/').searchParams;
  assert.equal(q.get('moment'), 'Broncos drop 3 spots');
  assert.equal(q.get('sport'), 'nfl');
  assert.equal(q.get('team'), 'Denver Broncos');
  assert.equal(q.get('trend'), 't-1');
  assert.equal(q.get('brief'), null, 'no brief: Reels would drop the trend');
  assert.equal(r.payload.why, 'Did the bye cost Denver?', 'the hook stands in for why');
  assert.equal(r.payload.title, 'Broncos drop 3 spots');
  // Tennis: Reels has no tennis sport, so it goes as "any sport".
  assert.equal(L.reelHandoff(story('t-2', 'tennis', 1)).payload.sport, '');
  assert.equal(new URL(L.reelHandoff(story('t-2', 'tennis', 1)).url, 'https://x/').searchParams.get('sport'), null);
});

ok('post kit: AI headlines win, rule ideas fall back, template + photo + video', () => {
  const item = story('t-3', 'mlb', 1, { titles: ['Rule idea'], template: { id: 'quote', why: 'The story leads with a quote.' }, photo: { query: 'Tarik Skubal', kind: 'person' }, team: { name: 'New York Mets', logo: 'x.svg' }, fit: { brand: 'es-dugout' } });
  const rules = L.kitFor(item, null);
  assert.deepEqual(rules.headlines, ['Rule idea']);
  assert.equal(rules.headlinesAi, false);
  assert.equal(rules.template.label, 'Quote');
  assert.match(rules.template.thumb, /instagram-quote\.webp$/);
  assert.equal(rules.video.brand, 'ES Dugout');
  const ai = L.kitFor(item, { why: 'Big name', titles: ['A', 'B', 'C', 'D'], hook: 'Where does Skubal land?' });
  assert.deepEqual(ai.headlines, ['A', 'B', 'C']);
  assert.equal(ai.hook, 'Where does Skubal land?');
  const text = L.kitText(item, ai, { sportLabel: 'MLB' });
  for (const part of ['Headlines (AI, check facts):', '- A', 'Template: Quote', 'Photo: Tarik Skubal · team graphic: New York Mets logo', 'Reel hook: Where does Skubal land?', 'Video ad: ES Dugout']) assert.ok(text.includes(part), part);
  assert.equal(L.kitFor(story('g', 'golf', 1), null).video, null, 'no video ads for golf');
  assert.equal(L.kitFor(story('g', 'golf', 1, { template: { id: 'made-up' } }), null).template.id, 'cover');
});

ok('shortlist text and AI cache TTL', () => {
  const text = L.shortlistText([story('a', 'nfl', 1, { publishedAt: new Date(NOW - 2 * 3600e3).toISOString() })], { now: NOW });
  assert.equal(text, 'Trends shortlist (1)\n1. Story a (NFL, 2h ago) https://example.com/a');
  assert.equal(L.shortlistText([]), '');
  const cache = L.readAiCache({ fresh: { why: 'w', titles: ['t'], hook: 'h', at: NOW - 1000 }, old: { why: 'w', titles: [], at: NOW - L.AI_TTL_MS - 1 }, bad: null }, NOW);
  assert.deepEqual([...cache.keys()], ['fresh']);
  assert.equal(cache.get('fresh').hook, 'h');
});

ok('freshness labels', () => {
  assert.equal(L.freshness(hoursAgo(0.5), NOW), 'new');
  assert.equal(L.freshness(hoursAgo(3), NOW), 'today');
  assert.equal(L.freshness(hoursAgo(30), NOW), 'older');
  assert.equal(L.ago(hoursAgo(2), NOW), '2h ago');
  assert.equal(L.isFresh({ type: 'search', publishedAt: hoursAgo(25) }, {}, NOW), false);
  assert.equal(L.isFresh({ type: 'news', publishedAt: hoursAgo(25) }, {}, NOW), true);
});

ok('keyboard shortcuts never fire while typing or with modifiers', () => {
  const card = { tagName: 'ARTICLE', classList: { contains: c => c === 'trend-row' } };
  const btn = { tagName: 'BUTTON', classList: { contains: () => false } };
  const ev = (key, target = btn, extra = {}) => ({ key, target, ...extra });
  assert.equal(L.shortcut(ev('j')), 'next');
  assert.equal(L.shortcut(ev('K')), 'prev');
  assert.equal(L.shortcut(ev('p')), 'kit');
  assert.equal(L.shortcut(ev('?', btn, { shiftKey: true })), 'help');
  assert.equal(L.shortcut(ev('ArrowDown', card)), 'next');
  assert.equal(L.shortcut(ev('ArrowDown', btn)), null, 'arrows scroll the page off a card');
  assert.equal(L.shortcut(ev('Enter', card)), 'kit');
  assert.equal(L.shortcut(ev('Enter', btn)), null);
  assert.equal(L.shortcut(ev('d', { tagName: 'INPUT' })), null);
  assert.equal(L.shortcut(ev('d', { tagName: 'DIV', isContentEditable: true })), null);
  assert.equal(L.shortcut(ev('k', btn, { metaKey: true })), null, '⌘K stays the search palette');
  assert.equal(L.shortcut(ev('S', btn, { shiftKey: true })), null);
  assert.equal(L.shortcut(ev('x')), null);
});

// ── 2. trend-design.js ──────────────────────────────────────────────────
ok('storylines: shared people and running stories, labels, leads', () => {
  const list = [
    'Bryson DeChambeau joins DP World Tour after LIV collapse',
    'Tiger Woods confirms return to PGA Tour action',
    'DeChambeau-Led LIV Contingent Joins DP World Tour',
    'Tiger Woods set for PGA Tour comeback after injury',
    'Graeme McDowell joins Bryson DeChambeau in returning to Europe',
    'Chad Ramey saves his tour card with a win',
  ].map((title, i) => ({ id: `t${i}`, title, type: 'news', category: 'golf' }));
  const lines = T.buildStorylines(list, 'golf');
  const labels = Object.fromEntries(lines.map(l => [l.label, l.ids]));
  assert.deepEqual(labels['Bryson DeChambeau'], ['t0', 't2', 't4']);
  assert.deepEqual(labels['Tiger Woods'], ['t1', 't3']);
  assert.equal(list[0].storyline.lead, true);
  assert.equal(list[2].storyline.lead, false);
  assert.equal(list[2].storyline.size, 3);
  assert.equal(list[5].storyline, undefined, 'a story on its own has no storyline');
  // "State" is not a storyline (Iowa State, NC State, Arkansas State).
  const states = ['Iowa State coach suspended', 'NC State coach speaks', 'Arkansas State fires coach'].map((title, i) => ({ id: `s${i}`, title, type: 'news' }));
  assert.equal(T.buildStorylines(states, 'others').length, 0);
  // Running stories by phrase.
  const ranks = ['NFL power rankings: Broncos land after Week 10', 'Week 11 NFL Power Rankings roundup', 'Bears power rankings for Week 11', 'Chiefs sign a kicker', 'Lions get a key player back', 'Bills beat Jets'].map((title, i) => ({ id: `n${i}`, title, type: 'news' }));
  assert.deepEqual(T.buildStorylines(ranks, 'nfl').map(l => [l.label, l.ids.length]), [['Power rankings', 3]]);
});

ok('signals: hot, rising, none; only from the feed', () => {
  const now = NOW;
  assert.equal(T.signalFor({ type: 'search', traffic: '100K+', publishedAt: hoursAgo(5) }, { now }), 'hot');
  assert.equal(T.signalFor({ type: 'news', coverage: 4, publishedAt: hoursAgo(2) }, { now, size: 3 }), 'hot');
  assert.equal(T.signalFor({ type: 'news', coverage: 4, publishedAt: hoursAgo(20) }, { now, size: 3 }), null);
  assert.equal(T.signalFor({ type: 'news', coverage: 2, publishedAt: hoursAgo(2) }, { now }), 'rising');
  assert.equal(T.signalFor({ type: 'news', coverage: 3, publishedAt: hoursAgo(10) }, { now, prev: { coverage: 2 } }), 'rising');
  assert.equal(T.signalFor({ type: 'news', coverage: 1, publishedAt: hoursAgo(0.5) }, { now }), null, 'new is shown by the age, not a signal');
  assert.equal(T.signalFor({ type: 'news', publishedAt: 'nope' }, { now }), null);
});

ok('ES fit per sport and newsletter', () => {
  const huddle = T.esFit({ category: 'nfl', type: 'news', team: { name: 'x' }, score: 10 }, { size: 3 });
  assert.equal(huddle.brand, 'the-huddle');
  assert.equal(huddle.score, 95); // 50 core + 15 newsletter + 10 team + 10 star + 10 storyline
  assert.equal(T.esFit({ category: 'golf', type: 'news', score: 6 }).brand, '');
  assert.ok(T.esFit({ category: 'others', type: 'news' }).score < T.esFit({ category: 'tennis', type: 'news' }).score);
  assert.equal(T.esFit({ category: 'cfb', type: 'news' }).brand, 'essentially-cfb');
  assert.equal(T.esFit({ category: 'mlb', type: 'news' }).brand, 'es-dugout');
});

ok('template + photo suggestions are rules, not AI', () => {
  assert.equal(T.suggestTemplate({ title: '"A Total Fiasco": Gauff\'s former coach calls for changes' }).id, 'quote');
  assert.equal(T.suggestTemplate({ title: 'Coach: "We were not good enough tonight and we all know it, every one of us in that room"' }).id, 'long-quote');
  assert.equal(T.suggestTemplate({ title: 'NFL power rankings: See where the Broncos land' }).id, 'listicle-type-2');
  assert.equal(T.suggestTemplate({ title: 'Mahomes throws for 320 yards in the win' }).id, 'stats-single-ent');
  assert.equal(T.suggestTemplate({ title: 'Tiger Woods confirms his return' }).id, 'cover');
  assert.deepEqual(T.photoQuery({ category: 'golf', type: 'news', title: 'Tiger Woods Announces PGA Tour Return After Scandal' }), { query: 'Tiger Woods', kind: 'person' });
  assert.deepEqual(T.photoQuery({ category: 'cfb', type: 'news', title: 'Oregon looked dead in CFP race. Why Dan Lanning thinks nobody wants Ducks' }), { query: 'Dan Lanning', kind: 'person' });
  assert.deepEqual(T.photoQuery({ category: 'nfl', type: 'news', title: 'NFL power rankings: See where the Broncos land', team: { name: 'Denver Broncos' } }), { query: 'Denver Broncos', kind: 'team' });
  assert.equal(T.photoQuery({ category: 'mlb', type: 'news', title: 'MLB lockout countdown nears' }).kind, 'league');
});

ok('quick ideas drop junk fragments', () => {
  const ideas = item => T.suggestTitles({ type: 'news', related: [], ...item });
  assert.deepEqual(ideas({ title: 'Bryson DeChambeau to return with DP World Tour following end of LIV Golf - The Athletic', source: 'The Athletic' }).filter(t => /^The Athletic$/.test(t)), []);
  assert.ok(!ideas({ title: "Tiger Woods Announces PGA Tour Return After Scandal: Here's When He'll Play Next" }).some(t => /^Here/.test(t)));
  assert.ok(!ideas({ title: "'IF THIS IS A DREAM' LOOK: Alex Eala reacts (Alex Eala/Instagram Story)" }).some(t => /Instagram Story\)/.test(t)));
  assert.ok(!ideas({ title: 'Dan Campbell: I am not telling players to stop celebrating' }).includes('Dan Campbell'), 'a bare name is not a headline');
  assert.ok(ideas({ title: 'Week 12 College Football Playoff Rankings Projection: Georgia Leads the Way' }).includes('Georgia Leads the Way'));
});

ok('noise and classifier fixes', () => {
  assert.equal(T.classify('Sources: Jets QB Geno Smith avoided major ankle injury').category, 'nfl');
  assert.equal(T.classify('Derrick Henry on 10 carries for 10 yards').category, 'nfl');
  assert.equal(T.classify('Arch Manning will participate in Senior Day').category, 'cfb');
  const src = fs.readFileSync(path.join(ROOT, 'netlify/functions/trend-design.js'), 'utf8');
  const noise = new RegExp(src.match(/const NOISE = \/(.+)\/i;/)[1], 'i');
  for (const t of ['MLB The Show 27 announced', 'College Football Games Today: Where to Watch every game', 'Tennis WTA Finals: Best of 10sBalls Photo Galleries', 'How Much Do MLB Baseball Operations Jobs Pay?', '2026 CME Group Tour Championship: Expert picks']) assert.ok(noise.test(t), t);
  assert.ok(!noise.test('Tiger Woods confirms return to PGA Tour'));
});

ok('AI angles: hook, grounded numbers, clickbait dropped', () => {
  assert.match(T.ENRICH_SYSTEM, /"hook"/);
  assert.match(T.ENRICH_SYSTEM, /Any number you write must appear in the story/);
  const reply = JSON.stringify({ items: [
    { id: 'a', why: 'Denver fell 3 spots in a bye week', titles: ['Broncos drop 3 spots', 'Broncos drop 5 spots', 'BREAKING: Broncos fall', 'Denver slides on the bye'], hook: 'Did the bye cost Denver 3 spots?' },
    { id: 'b', why: 'He scored 40 points', titles: ['Big night'], hook: 'Can anyone stop him?' },
  ] });
  const out = T.parseEnrichment(reply, ['a', 'b'], { a: 'NFL playoff picture: Broncos dropped 3 spots during bye week', b: 'Star leads win' });
  assert.deepEqual(out.a.titles, ['Broncos drop 3 spots', 'Denver slides on the bye']);
  assert.equal(out.a.hook, 'Did the bye cost Denver 3 spots?');
  assert.equal(out.b.why, '', '40 is not in the story');
  assert.equal(out.b.hook, 'Can anyone stop him?');
  // Without sources (older callers) only the shape is checked.
  assert.equal(T.parseEnrichment(reply, ['b']).b.why, 'He scored 40 points');
  assert.ok(T.ENRICH_TTL_MS >= 6 * 3600e3, 'angles kept 6 h (ids are content hashes)');
  assert.ok(T.enrichMaxTokens(6) <= 3200);
});

// ── 3. Wiring ───────────────────────────────────────────────────────────
ok('generate.html loads the Trends view and its CSS with the branch cache key', () => {
  const html = fs.readFileSync(path.join(ROOT, 'generate.html'), 'utf8');
  for (const tag of ['trends.css?v=20261118-hero-trends', 'trends-logic.js?v=20261118-hero-trends', 'trends-view.js?v=20261118-hero-trends']) assert.ok(html.includes(tag), tag);
  for (const id of ['trends-live', 'trends-filters', 'trends-body', 'trends-empty', 'trends-brand', 'trends-density', 'trends-keys', 'trends-keys-panel', 'trends-ai', 'trends-refresh']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(html.indexOf('trends-logic.js') < html.indexOf('trends-view.js'));
});

ok('AI never on load or hover: only a kit, a card button or the toolbar asks', () => {
  const view = fs.readFileSync(path.join(ROOT, 'trends-view.js'), 'utf8');
  assert.ok(!/pointerover[^\n]*wantAi|DWELL_MS/.test(view), 'no hover dwell');
  const calls = view.split('\n').filter(line => /wantAi\(/.test(line) && !/function wantAi/.test(line));
  assert.equal(calls.length, 3, calls.join('\n'));
  assert.ok(calls.some(l => /toggleKit|open && needsAi/.test(l)));
  assert.ok(calls.some(l => /\[data-ai\]/.test(l) || /aiState\.delete\(id\)/.test(l)));
  // load() and the first paint never ask.
  const loadFn = view.slice(view.indexOf('async function load('), view.indexOf('function sportUrl('));
  assert.ok(!/wantAi|flushAi/.test(loadFn));
});

ok('the legacy trend-design.html still redirects to the Trends view', () => {
  const legacy = fs.readFileSync(path.join(ROOT, 'trend-design.html'), 'utf8');
  assert.match(legacy, /query\.set\('view', 'trends'\)/);
  assert.match(legacy, /generate\.html\?/);
});

console.log(`trends-hero: ${passed} checks passed`);
