// Trends -> Generate carries the trend itself (2026-11-24). Offline, fetch stubbed.
//   1. trends-logic.js: trendContext (compact, storyline siblings, AI ideas),
//      designHandoff (Home), trendStillFits (edited vs rewritten briefs).
//   2. _trend-context.js: normalizeTrend (user input: caps, https only, known
//      fields only, dropped when the brief no longer tells the story) and
//      trendResearch (real headlines -> digest + corpus; AI ideas apart).
//   3. es-generate.js end to end: the writer prompt carries the trend and the
//      ideas, the corpus does not carry the ideas (an "idea" quote is still
//      rejected), ES-hosted trend photo offered as a candidate (Wikipedia not),
//      the team hint, no trend = the prompt as before.
//   4. Director / composer prompts; page wiring (generate.html, trends-view, Home).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');
const fnDir = path.join(ROOT, 'netlify/functions');
const L = require(path.join(ROOT, 'trends-logic.js'));
const TC = require(path.join(fnDir, '_trend-context.js'));
let passed = 0;
const tests = [];
const ok = (name, fn) => tests.push([name, fn]);

const NOW = Date.parse('2026-11-24T12:00:00Z');
const ES_IMG = 'https://image-cdn.essentiallysports.com/wp-content/uploads/mahomes-trend.jpg';
const WIKI_IMG = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Patrick_Mahomes.jpg';
const TREND_ITEM = {
  id: 'mahomes-knee', type: 'news', category: 'nfl', title: 'Patrick Mahomes says his knee feels great before Bills game',
  url: 'https://www.essentiallysports.com/nfl-news-mahomes-knee/', source: 'EssentiallySports', sourceDomain: 'essentiallysports.com',
  publishedAt: new Date(NOW - 3 * 3600e3).toISOString(), traffic: '', coverage: 4, signal: 'hot',
  team: { name: 'Kansas City Chiefs', short: 'Chiefs', logo: 'https://example.com/kc.svg' },
  image: ES_IMG, imageKind: 'photo', imageCredit: '',
  related: [
    { title: 'Andy Reid: Mahomes was moving well at practice', url: 'https://www.espn.com/nfl/story/reid-mahomes', source: 'ESPN', domain: 'espn.com' },
    { title: 'Chiefs list Mahomes as full participant', url: 'https://www.essentiallysports.com/nfl-news-chiefs-injury-report/', source: 'EssentiallySports' },
  ],
  storyline: { id: 's-nfl-mahomes', label: 'Patrick Mahomes', size: 3, lead: true },
  rank: 2.1, fit: { score: 70 }, titles: ['quick idea'],
};
const AI = { why: 'Chiefs fans were worried after last week.', hook: 'Is Mahomes back to full speed?', titles: ['Mahomes Says He Is Ready', 'Knee Feels Great'] };

// ── 1. trends-logic.js ───────────────────────────────────────────────────
ok('trendContext: the full trend, compact, with storyline siblings and AI ideas', () => {
  const sibling = { id: 'mahomes-2', title: 'Mahomes expected to start Sunday vs Bills', url: 'https://www.cbssports.com/x', source: 'CBS Sports', storyline: { id: 's-nfl-mahomes' } };
  const t = L.trendContext(TREND_ITEM, AI, { more: [sibling, TREND_ITEM] });
  assert.equal(t.id, 'mahomes-knee');
  assert.equal(t.title, TREND_ITEM.title);
  assert.equal(t.url, TREND_ITEM.url);
  assert.deepEqual(t.team, { name: 'Kansas City Chiefs', short: 'Chiefs' }, 'the logo stays behind');
  assert.equal(t.signal, 'hot');
  assert.equal(t.coverage, 4);
  assert.equal(t.image, ES_IMG);
  assert.deepEqual(t.related.map(r => r.source), ['ESPN', 'EssentiallySports', 'CBS Sports'], 'own related first, then storyline siblings; never the trend itself');
  assert.deepEqual(t.storyline, { size: 3, label: 'Patrick Mahomes' });
  assert.equal(t.why, AI.why);
  assert.equal(t.hook, AI.hook);
  assert.deepEqual(t.titles, AI.titles);
  assert.ok(!('rank' in t) && !('fit' in t), 'feed-only fields are not sent');
  assert.ok(JSON.stringify(t).length < 2500, 'small enough to ride every request');
  assert.equal(TC.withTrendSport('Brief text.', { category: 'nfl' }), 'Brief text.\nSport: NFL', "the trend's league fills a missing Sport line");
  assert.equal(TC.withTrendSport('Brief text.\nSport: MLB', { category: 'nfl' }), 'Brief text.\nSport: MLB', "the brief's own Sport line wins");
  assert.equal(TC.withTrendSport('Brief text.', { category: 'others' }), 'Brief text.');
  assert.equal(L.trendContext(null), null);
});
ok('designHandoff: Home stores the trend for generate.html?trend=<id>', () => {
  const h = L.designHandoff(TREND_ITEM, { why: 'Big game Sunday.', brief: 'x' });
  assert.equal(h.key, L.KEYS.design);
  assert.equal(h.payload.trend.id, 'mahomes-knee');
  assert.equal(h.payload.trend.why, 'Big game Sunday.');
  assert.equal(h.payload.from, 'trends');
});
ok('trendStillFits: tidy edits keep the trend, a rewrite drops it', () => {
  const brief = L.briefFor(TREND_ITEM, { why: AI.why });
  assert.ok(L.trendStillFits(brief, brief));
  assert.ok(L.trendStillFits(`${brief}\nSport: NFL`, brief), 'the Sport line Generate adds is fine');
  assert.ok(L.trendStillFits(`${brief}\nMake it a stats post, he threw 3 TD`, brief), 'an added line keeps it');
  assert.ok(L.trendStillFits(brief.replace('feels great', 'feels good').replace(/Context:.*$/m, ''), brief), 'a small edit keeps it');
  assert.ok(!L.trendStillFits('Caitlin Clark scores 40 as the Fever beat the Sun', brief), 'another story drops it');
  assert.ok(!L.trendStillFits('', brief));
});

// ── 2. _trend-context.js ─────────────────────────────────────────────────
const BRIEF = 'Patrick Mahomes says his knee feels great before Bills game.\nContext: Andy Reid: Mahomes was moving well at practice.\nWhy fans care: Chiefs fans were worried after last week.';
ok('normalizeTrend: known fields only, capped, https only', () => {
  const raw = {
    ...L.trendContext(TREND_ITEM, AI), evil: '<script>', url: 'javascript:alert(1)', image: 'http://insecure.example.com/a.jpg',
    title: `${TREND_ITEM.title}<b>x</b>`, coverage: 1e9, signal: 'nuclear', traffic: '200K+<img>',
    related: [...Array(12)].map((_, i) => ({ title: `Mahomes related headline number ${i}`, url: i % 2 ? 'ftp://x/y' : `https://www.essentiallysports.com/r${i}`, source: 'S'.repeat(500), extra: 1 })),
    titles: [...Array(9)].map((_, i) => `Idea ${i} ${'x'.repeat(300)}`), why: 'w'.repeat(5000),
  };
  const t = TC.normalizeTrend(raw, BRIEF);
  assert.ok(t);
  assert.ok(!('evil' in t));
  assert.equal(t.url, '', 'javascript: URL dropped');
  assert.equal(t.image, '', 'http image dropped');
  assert.ok(!/</.test(t.title));
  assert.equal(t.coverage, 99);
  assert.equal(t.signal, '');
  assert.equal(t.traffic, '200K+');
  assert.equal(t.related.length, 6);
  assert.ok(t.related.every(r => r.source.length <= 80 && !('extra' in r)));
  assert.equal(t.related[1].url, '', 'non-https related URL dropped');
  assert.equal(t.titles.length, 5);
  assert.ok(t.titles.every(x => x.length <= 140));
  assert.equal(t.why.length, 400);
  assert.equal(TC.normalizeTrend('nope', BRIEF), null);
  assert.equal(TC.normalizeTrend([], BRIEF), null);
  assert.equal(TC.normalizeTrend({ title: 'x' }, BRIEF), null);
});
ok('normalizeTrend: dropped when the brief no longer tells the story', () => {
  const raw = L.trendContext(TREND_ITEM, AI);
  assert.ok(TC.normalizeTrend(raw, BRIEF));
  assert.equal(TC.normalizeTrend(raw, 'Caitlin Clark scores 40 as the Fever beat the Sun'), null);
  // A search trend: the brief tells the related headline, not the search.
  const search = { type: 'search', title: 'Lebron James', related: [{ title: 'LeBron James out vs Celtics with ankle soreness', url: 'https://www.espn.com/x', source: 'ESPN' }] };
  assert.ok(TC.normalizeTrend(search, 'Lebron James: LeBron James out vs Celtics with ankle soreness (ESPN).'));
});
ok('trendResearch: real headlines to the digest + corpus, AI ideas kept apart', () => {
  const t = TC.normalizeTrend(L.trendContext(TREND_ITEM, { ...AI, titles: ['Mahomes: "I Am Unstoppable"', 'Mahomes 500 Yards Incoming'] }), BRIEF);
  const r = TC.trendResearch(t, { now: NOW });
  assert.match(r.section, /The trend this brief came from/);
  assert.match(r.section, /Andy Reid: Mahomes was moving well at practice \(ESPN\)/);
  assert.match(r.section, /Team the feed tied it to: Kansas City Chiefs/);
  assert.match(r.whyNow, /hot right now.*4 outlets on it.*3 stories in this storyline.*first seen 3h ago/);
  assert.match(r.corpus, /Chiefs list Mahomes as full participant/);
  assert.ok(!/Unstoppable|500 Yards|worried/.test(r.corpus + r.section), 'AI ideas never reach the corpus or the digest');
  assert.match(r.ideas, /NOT facts/);
  assert.match(r.ideas, /Headline idea: Mahomes 500 Yards Incoming/);
  assert.deepEqual(r.sources, [TREND_ITEM.url, 'https://www.essentiallysports.com/nfl-news-chiefs-injury-report/'], 'only ES URLs become citable sources');
  assert.deepEqual(r.photo, { image: ES_IMG, title: TREND_ITEM.title, url: TREND_ITEM.url });
  const wiki = TC.trendResearch(TC.normalizeTrend({ ...L.trendContext(TREND_ITEM), image: WIKI_IMG, imageCredit: 'Wikipedia: Patrick Mahomes' }, BRIEF));
  assert.equal(wiki.photo, null, 'a Wikipedia picture is never a design photo');
  assert.match(wiki.section, /picture is of: Patrick Mahomes \(hint only\)/);
  const logo = TC.trendResearch(TC.normalizeTrend({ ...L.trendContext(TREND_ITEM), imageKind: 'logo' }, BRIEF));
  assert.equal(logo.photo, null, 'a logo is never a photo');
});

// ── 3. es-generate.js end to end ─────────────────────────────────────────
const ARTICLE = {
  id: 1, date: '2026-11-23T10:00:00', link: 'https://www.essentiallysports.com/nfl-news-mahomes-week/',
  title: { rendered: 'Patrick Mahomes Prepares for the Bills' }, excerpt: { rendered: '<p>The Chiefs quarterback practised on Wednesday.</p>' },
  yoast_head_json: { og_image: [{ url: 'https://image-cdn.essentiallysports.com/wp-content/uploads/article.jpg' }] },
};
const prompts = [];
let reply = { designs: [] };
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (href.startsWith('https://www.essentiallysports.com/wp-json/wp/v2/posts')) return res(200, [ARTICLE]);
  if (href.startsWith('https://www.essentiallysports.com/wp-json/wp/v2/tags')) return res(200, []);
  if (href.startsWith('https://api.groq.com/')) {
    const body = JSON.parse(options.body);
    prompts.push(body.messages.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n'));
    return res(200, { choices: [{ message: { content: JSON.stringify(reply) } }] });
  }
  return res(404, {});
};
const fnPath = path.join(fnDir, 'es-generate.js');
const authPath = path.join(fnDir, '_supabase-auth.js');
const mcpPath = path.join(fnDir, '_es-mcp.js');
function handler() {
  [fnPath, authPath, mcpPath].forEach(p => delete require.cache[p]);
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }) } };
  require.cache[mcpPath] = { id: mcpPath, filename: mcpPath, loaded: true, exports: { isMcpConfigured: () => false, createSession: () => null } };
  return require(fnPath).handler;
}
const post = (h, body) => h({ httpMethod: 'POST', headers: { authorization: 'Bearer x' }, body: JSON.stringify(body) }).then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));

const atest = [];
const aok = (name, fn) => atest.push([name, fn]);
aok('es-generate: the trend reaches the writer prompt; ideas labelled; response says so', async () => {
  process.env.GROQ_API_KEY = 'groq-test';
  reply = { designs: [{ postType: 'cover', title: 'Ready', sport: 'NFL', team: 'Kansas City Chiefs', fields: { pills: ['Mahomes Says', 'He Is Ready'] }, photoQuery: 'Patrick Mahomes Chiefs', why: 'hook', sources: ['https://www.essentiallysports.com/nfl-news-chiefs-injury-report/'] }] };
  const h = handler();
  prompts.length = 0;
  const trend = L.trendContext(TREND_ITEM, AI);
  const res = await post(h, { brief: `${BRIEF}\nSport: NFL`, trend, formats: ['cover'] });
  assert.equal(res.status, 200);
  const prompt = prompts[0];
  assert.match(prompt, /The trend this brief came from/);
  assert.match(prompt, /Chiefs list Mahomes as full participant/);
  assert.match(prompt, /Why now \(FrameUp Trends\): hot right now/);
  assert.match(prompt, /Angle ideas from FrameUp Trends \(AI-written suggestions, NOT facts/);
  assert.match(prompt, /Hook: Is Mahomes back to full speed\?/);
  assert.equal(res.body.research.trend.id, 'mahomes-knee');
  assert.equal(res.body.research.trend.photo, true);
  assert.equal(res.body.designs[0].sources[0]?.url, 'https://www.essentiallysports.com/nfl-news-chiefs-injury-report/', "the trend's ES link counts as a research source");
  assert.ok(prompt.indexOf('The trend this brief came from') < prompt.indexOf('Patrick Mahomes Prepares for the Bills'), 'the trend leads the digest');
  prompts.length = 0;
  await post(h, { brief: BRIEF, trend, formats: ['cover'] });
  assert.match(prompts[0], /Brief: [^]*?\nSport: NFL\n/, 'no Sport line in the brief: the trend\'s league is added');
});
aok('es-generate: no trend (or a rewritten brief) = the old prompt', async () => {
  const h = handler();
  prompts.length = 0;
  await post(h, { brief: `${BRIEF}\nSport: NFL`, formats: ['cover'] });
  assert.ok(!/The trend this brief came from|Angle ideas from FrameUp Trends/.test(prompts[0]));
  prompts.length = 0;
  const res = await post(h, { brief: 'Caitlin Clark scores 40 as the Fever beat the Sun', trend: L.trendContext(TREND_ITEM, AI), formats: ['cover'] });
  assert.ok(!/The trend this brief came from/.test(prompts[0]), 'stale trend ignored server-side too');
  assert.equal(res.body.research.trend, undefined);
});
aok('es-generate: a quote taken from an AI idea is still rejected (ideas are not facts)', async () => {
  reply = { designs: [{ postType: 'quote', title: 'Q', sport: 'NFL', team: 'Kansas City Chiefs', fields: { lines: ['I Am', 'Unstoppable'] }, photoQuery: 'Patrick Mahomes Chiefs' }] };
  const h = handler();
  const trend = L.trendContext(TREND_ITEM, { ...AI, titles: ['Mahomes: "I Am Unstoppable"'] });
  const res = await post(h, { brief: `${BRIEF}\nSport: NFL`, trend, formats: ['quote'] });
  assert.ok(!res.body.designs.some(d => d.postType === 'quote' && /unstoppable/i.test(d.lines.join(' '))), 'invented quote never ships');
});
aok('photo: the ES-hosted trend picture is a candidate; Wikipedia is not', async () => {
  const { _test } = require(fnPath);
  const found = { trend: { photo: { image: ES_IMG, title: TREND_ITEM.title } } };
  // trendPhotoFor is internal: exercised through photoCandidates' extra list.
  const withTrend = await _test.photoCandidates('Patrick Mahomes', null, {}, [], { extra: [{ image: ES_IMG, title: TREND_ITEM.title }] });
  assert.deepEqual(withTrend.map(c => c.sourceUrl), [ES_IMG]);
  const wiki = await _test.photoCandidates('Patrick Mahomes', null, {}, [], { extra: [{ image: WIKI_IMG, title: TREND_ITEM.title }] });
  assert.equal(wiki.length, 0, 'not an ES photo host: never a candidate');
  assert.ok(found);
  const src = fs.readFileSync(fnPath, 'utf8');
  assert.match(src, /classicPhotos\(\{ person, read, found, mcp, tools, track: photoTrack, extra: trendPhotoFor\(found, person\) \}\)/, 'templates path offers it (when the asset service cannot check)');
  assert.match(src, /photoCandidates\(person, mcp, tools, articles, \{ extra: trendPhotoFor\(found, person\) \}\)/, 'Creative local search offers it (verifiedLocal still checks)');
  assert.match(src, /if \(!photo \|\| !canProxy\(photo\.image\) \|\| !surname/);
});
aok('team hint: the trend team fills an empty team (brand-kit only)', async () => {
  const src = fs.readFileSync(fnPath, 'utf8');
  assert.match(src, /if \(!read\.team && found\.trend\?\.team\)/);
  const director = require(path.join(fnDir, '_creative-director.js'));
  assert.equal(director.teamInText('Kansas City Chiefs', 'NFL')?.team, 'CHIEFS', 'the brand-kit key, as readBrief sets it');
  assert.equal(director.teamInText('Gotham Rovers', 'NFL'), null, 'no kit team, no hint');
});

// ── 4. Director / composer prompts, page wiring ──────────────────────────
ok('director and composer prompts carry the trend (ideas labelled)', () => {
  const director = require(path.join(fnDir, '_creative-director.js'));
  const req = director.directorRequest({ brief: BRIEF, read: { fits: {} }, digest: 'digest', ideas: 'Angle ideas from FrameUp Trends (AI-written suggestions, NOT facts): x' });
  assert.match(req, /Angle ideas from FrameUp Trends/);
  assert.ok(!/Angle ideas/.test(director.directorRequest({ brief: BRIEF, read: { fits: {} }, digest: 'digest' })));
  const composer = require(path.join(fnDir, '_composer.js'));
  const read = composer.readCreative(BRIEF, {}, {});
  read.trend = { lines: [TREND_ITEM.title, 'Andy Reid: Mahomes was moving well at practice'], ideas: 'Angle ideas from FrameUp Trends (AI-written suggestions, NOT facts): y', whyNow: 'Why now (FrameUp Trends): hot right now.', team: 'Kansas City Chiefs' };
  const text = composer.directorRequest(read, { photos: {} }, { want: 2 });
  assert.match(text, /The trend this brief came from \(headlines from ES and other outlets; context for the angle, not facts to add\)/);
  assert.match(text, /- Andy Reid: Mahomes was moving well at practice/);
  assert.match(text, /Why now \(FrameUp Trends\)/);
  assert.match(text, /NOT facts/);
  const src = fs.readFileSync(path.join(fnDir, 'es-generate.js'), 'utf8');
  assert.match(src, /cacheKey = found\.trend \?/, 'a trend run has its own Creative plan cache entry');
  // The trend's team when the brief reading found none (live: "Rams All-Pro WR Puka Nacua..." read no team).
  const rams = composer.readCreative("Rams All-Pro WR Puka Nacua reportedly suspended 3 games for violating league's personal conduct policy.\nSport: NFL", {}, {});
  composer.addTrendTeam(rams, 'Los Angeles Rams');
  assert.ok(rams.teams.some(t => t.kind === 'team' && /Rams/.test(t.full) && t.from === 'trend'), JSON.stringify(rams.teams));
  assert.ok(!rams.people.includes('Rams All-Pro'), 'the team plus a word is not a person');
  assert.ok(rams.stories.some(s => s.teams.length), 'linked to the story that names it');
  const golf = composer.readCreative('Scottie Scheffler wins again.\nSport: Golf', {}, {});
  composer.addTrendTeam(golf, 'Los Angeles Rams');
  assert.ok(!golf.teams.some(t => t.from === 'trend'), 'never a team from another sport');
});
ok('wiring: all three click paths carry the trend; Generate sends it only while the brief fits', () => {
  const view = fs.readFileSync(path.join(ROOT, 'trends-view.js'), 'utf8');
  assert.match(view, /new CustomEvent\('ais:design', \{ detail: \{ brief, source: 'trends', trendId: id, format: template \|\| '', trend: trendOf\(id\), \.\.\.\(category \? \{ sport: labelOf\(category\) \} : \{\}\) \} \}\)/);
  const html = fs.readFileSync(path.join(ROOT, 'generate.html'), 'utf8');
  assert.match(html, /trendRun = event\.detail\?\.trend\?\.title \? \{ brief, trend: event\.detail\.trend \} : null;/);
  assert.match(html, /body: JSON\.stringify\(withTrend\(path, body\)\)/);
  assert.match(html, /TL\(\)\?\.trendStillFits\?\.\(body\.brief, trendRun\.brief\)/);
  assert.match(html, /\['brief', 'view', 'sport', 'league', 'trend'\]\.forEach/);
  assert.match(html, /stored\?\.trend\?\.id === trendId/);
  const home = fs.readFileSync(path.join(ROOT, 'frameup-home-today.js'), 'utf8');
  assert.match(home, /data-today-handoff="post"/);
  assert.match(home, /logic\.designHandoff\(item/);
  const H = require(path.join(ROOT, 'frameup-home-today.js'));
  const href = H.trendHref({ id: 'abc', title: 'Chiefs clinch the West' }, 'NFL', { logic: L });
  assert.match(href, /&league=NFL&trend=abc&autorun=0$/);
});

for (const [name, fn] of tests) { try { fn(); passed += 1; } catch (error) { console.error(`FAIL ${name}`); throw error; } }
for (const [name, fn] of atest) { try { await fn(); passed += 1; } catch (error) { console.error(`FAIL ${name}`); throw error; } }
delete process.env.GROQ_API_KEY;
console.log(`test-generate-trend-context: ${passed} passed`);
