// Generate "Creative" (2026-11-19): composed designs. The composition library
// and ES gate (frameup-compose.js), the brief reader, grounding and variety
// rules, the art director and vision judge (_composer.js), the es-generate
// modes, and the page wiring. Every network call is mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const genPath = path.join(fnDir, 'es-generate.js');
const mcpPath = path.join(fnDir, '_es-mcp.js');
const authPath = path.join(fnDir, '_supabase-auth.js');

const GOLF = 'LPGA Tour season ends with $2 million prize and PGA Tour season ends with 100 players earning cards\nSport: Golf';
const NFL = 'Bengals rout Steelers 38-18 on Sunday Night Football and sit alone atop the AFC North at 7-2. Joe Burrow threw for 409 yards and 4 touchdowns. Ja\'Marr Chase caught 11 passes for 231 yards. Cincinnati outgained Pittsburgh 484-222.\nSport: NFL';
const NBA = 'Lakers start the season 12-2 behind Luka Doncic. ESPN\'s Ramona Shelburne: "It\'s easy to find your way when you\'re playing one of the easiest schedules in the league." The Lakers visit Victor Wembanyama and the Spurs the day after Thanksgiving.\nSport: NBA';

let gatewayReply = { directions: [] };
let judgeReply = null;
let gatewayCalls = 0;
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (href.includes('/wp-json/wp/v2/')) return reply(200, []);
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) {
    gatewayCalls += 1;
    const body = JSON.parse(options.body);
    const content = body.messages[0].content;
    if (Array.isArray(content)) return reply(200, { content: [{ type: 'text', text: JSON.stringify(judgeReply) }], usage: { input_tokens: 3200, output_tokens: 400 } });
    return reply(200, { content: [{ type: 'text', text: JSON.stringify(gatewayReply) }], usage: { input_tokens: 2500, output_tokens: 900 } });
  }
  if (href.includes('/rest/v1/')) return reply(200, []);
  throw new Error(`unexpected fetch ${href}`);
};
process.env.AI_GATEWAY_API_KEY = 'gw-test';
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }), verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }) } };
require.cache[mcpPath] = { id: mcpPath, filename: mcpPath, loaded: true, exports: { isMcpConfigured: () => false, createSession: () => null } };

const COMPOSE = require(path.resolve('frameup-compose.js'));
const C = require(path.join(fnDir, '_composer.js'));
const GUIDE = require(path.resolve('es-guidelines.js'));
const gen = require(genPath);
const post = body => gen.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) }).then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));

// ── 1. Brief reading: stories and facts ──────────────────────────────────
{
  const golf = C.readCreative(GOLF, {});
  assert.equal(golf.sport, 'Golf');
  assert.equal(golf.stories.length, 2, 'LPGA and PGA are two stories');
  assert.equal(golf.stories[0].subject, 'LPGA Tour');
  assert.equal(golf.stories[1].subject, 'PGA Tour');
  const [money, count] = golf.facts;
  assert.deepEqual([money.kind, money.display, money.story], ['money', '$2M', 's1']);
  assert.deepEqual([count.kind, count.value, count.label, count.story], ['count', '100', 'players earning cards', 's2']);
  assert.deepEqual(golf.teams.map(t => `${t.name}:${t.kind}`), ['LPGA Tour:league', 'PGA Tour:league']);
  assert.deepEqual(golf.stories[0].teams, ['league-lpga'], '"LPGA Tour" never matches "PGA Tour"');

  const nfl = C.readCreative(NFL, {});
  const kinds = Object.fromEntries(nfl.facts.map(f => [f.text, f.kind]));
  assert.equal(kinds['38-18'], 'score');
  assert.equal(kinds['7-2'], 'record');
  assert.equal(kinds['484-222'], 'compare');
  assert.equal(kinds['409 yards'], 'count');
  assert.deepEqual(nfl.people, ['Joe Burrow', 'Ja\'Marr Chase']);
  assert.deepEqual(nfl.teams.map(t => t.name), ['Bengals', 'Steelers']);

  const nba = C.readCreative(NBA, {});
  assert.equal(nba.quotes.length, 1);
  assert.equal(nba.quotes[0].by, 'Ramona Shelburne', 'the speaker, not "ESPN\'s"');
  assert.ok(!nba.people.includes('The Lakers'));
  assert.equal(nba.stories.length, 3, 'the quote sentence and the next sentence are separate stories');
}

// ── 2. The composition library and the ES gate ───────────────────────────
{
  assert.ok(COMPOSE.ARCHETYPES.length >= 24 && COMPOSE.ARCHETYPES.length <= 60, '24-60 archetypes (v2 styles + v3 looks)');
  const pal = COMPOSE.makePalette(['#FB4F14', '#000000']);
  assert.equal(pal.bg, '#000000');
  assert.equal(pal.accent, '#FB4F14');
  assert.ok(COMPOSE._test.contrast(pal.ink, pal.bg) >= 4.5);
  const rich = {
    palette: pal, kicker: 'Sunday Night', headline: 'Burrow carved them up', highlight: ['carved'], name: 'Joe Burrow', body: 'Four touchdowns.',
    number: { value: '409', label: 'yards', factId: 'f3' }, numbers: [{ value: '409', display: '409', label: 'yards' }, { value: '4', display: '4', label: 'touchdowns' }, { value: '11', display: '11', label: 'passes' }],
    photo: { src: '/a.jpg' }, photos: [{ src: '/b.jpg', label: 'one' }, { src: '/c.jpg', label: 'two' }], cutout: { src: '/a.png' }, art: { src: 'proc:trophy' },
    compare: { a: { label: 'Cincinnati', value: '484' }, b: { label: 'Pittsburgh', value: '222' } }, score: { a: { name: 'Bengals', value: '38' }, b: { name: 'Steelers', value: '18' } },
    record: { value: '7-2', label: 'record' }, quote: { text: 'We shot ourselves in the foot', by: 'Aaron Rodgers' },
    sides: [{ title: 'LPGA Tour', number: { value: '2', prefix: '$', suffix: 'M' } }, { title: 'PGA Tour', number: { value: '100' } }],
    facts: [{ id: 'f1', text: '409 yards' }, { id: 'f2', text: '4 touchdowns' }, { id: 'f3', text: '11 passes' }, { id: 'f4', text: '484-222' }, { id: 'f5', text: '38-18' }, { id: 'f6', text: '7-2' }, { id: 'f7', text: '$2 million' }, { id: 'f8', text: '100 players' }],
  };
  const unitsInput = { ...rich, number: { value: '100', label: 'players earning cards' } };
  // v3 looks have their own fit rules and tests (scripts/test-compose-looks.mjs).
  COMPOSE.ARCHETYPES.filter(a => !a.looks).forEach(a => {
    const input = a.id === 'unit-grid' ? unitsInput : rich;
    assert.ok(a.fits(input), `${a.id} fits a rich input`);
    const scenes = COMPOSE.candidates(a.id, input, 3);
    assert.equal(scenes.length, 3, `${a.id}: 3 candidates`);
    scenes.forEach(scene => {
      assert.ok(!scene.layers.some(l => l.type === 'logo' && l.kind === 'es'), 'no free ES logo layer');
      const checked = COMPOSE.checkScene(scene);
      assert.ok(checked.ok, `${a.id} v${scene.variant} passes the gate: ${JSON.stringify(checked.errors)}`);
      scene.layers.filter(l => l.font).forEach(l => assert.ok(COMPOSE.FONTS[l.font], `${a.id}: ES font only`));
    });
    assert.ok(new Set(scenes.map(s => JSON.stringify(s.layers))).size >= 2, `${a.id}: variants differ`);
  });
  assert.ok(!COMPOSE.fits('unit-grid', { number: { value: '2', prefix: '$', suffix: 'M' } }), 'money is never a unit chart');
  assert.ok(!COMPOSE.fits('hero-number', { number: { value: '409' } }), 'hero cut-out needs a cut-out');

  // The gate: style overrides, off-palette colours, stray numbers, the ES logo, safe area.
  const scene = COMPOSE.build('big-number', { palette: pal, headline: 'Big night', number: { value: '409', label: 'yards' }, facts: [{ id: 'f1', text: '409 yards' }] });
  scene.layers.push({ type: 'text', role: 'body', text: 'He threw 999 yards', x: 10, y: 10, w: 200, h: 40, font: 'comic', fontFamily: 'Comic Sans', stroke: '#fff', color: '#7B2CBF' });
  scene.layers.push({ type: 'logo', kind: 'es', src: 'brand-logo-blue.svg', x: 0, y: 0, w: 10, h: 10 });
  const checked = COMPOSE.checkScene(scene);
  assert.equal(checked.ok, false, 'an invented number fails');
  assert.ok(checked.errors.some(e => e.rule === 'real-facts' && /999/.test(e.msg)));
  const rules = checked.fixes.map(f => f.rule);
  ['font-family', 'no-outlined-type', 'team-palette', 'safe-area', 'logo-placement'].forEach(rule => assert.ok(rules.includes(rule), `fixes ${rule}`));
  const odd = scene.layers.find(l => l.text === 'He threw 999 yards');
  assert.equal(odd.font, 'display');
  assert.ok(!('fontFamily' in odd) && !('stroke' in odd));
  assert.ok(pal.allowed.includes(odd.color), 'colour snapped to the palette');
  assert.ok(odd.x >= 50 && odd.y >= 50, 'moved inside the safe area');
  assert.ok(!scene.layers.some(l => l.type === 'logo' && l.kind === 'es'), 'free ES logo removed');
  // Unit chart must be a fact.
  const units = COMPOSE.build('unit-grid', { palette: pal, headline: 'Cards earned', number: { value: '100', label: 'cards' }, facts: [{ id: 'f1', text: '100 cards' }] });
  assert.ok(COMPOSE.checkScene(units).ok);
  units.layers.find(l => l.chart === 'units').count = 120;
  assert.equal(COMPOSE.checkScene(units).ok, false, 'a unit chart with no fact behind it fails');
  // Text never enters the logo's clear space.
  const crowd = COMPOSE.build('typographic', { palette: pal, headline: 'Corner text' });
  crowd.layers.push({ type: 'text', role: 'kicker', text: 'Corner', x: 700, y: 60, w: 330, h: 60, font: 'condensed', color: pal.ink });
  COMPOSE.checkScene(crowd);
  const corner = crowd.layers.find(l => l.text === 'Corner');
  assert.ok(corner.x + corner.w <= COMPOSE._test.logoZone(crowd).x, 'kept clear of the ES logo');

  // Fixes: whitelisted, each changes the scene.
  const base = COMPOSE.build('hero-number', rich, 0);
  COMPOSE.FIXES.forEach(op => assert.notDeepEqual(COMPOSE.applyFix(base, op).layers, base.layers, `${op} changes the scene`));
  assert.deepEqual(COMPOSE.applyFix(base, 'nonsense').layers, base.layers);
  // Inline text edits and photo swaps.
  const fields = COMPOSE.editableText(base);
  assert.ok(fields.some(f => f.role === 'headline'));
  const edited = COMPOSE.setText(base, fields.find(f => f.role === 'headline').index, 'new words here');
  assert.equal(edited.layers[fields.find(f => f.role === 'headline').index].text, 'NEW WORDS HERE');
  const swapped = COMPOSE.swapPhoto(COMPOSE.build('magazine-cover', rich), { from: '/a.jpg', to: '/z.jpg' });
  assert.ok(swapped.layers.some(l => l.type === 'photo' && l.src === '/z.jpg'));
  // Heuristic score.
  const h = COMPOSE.scoreReport({ items: [{ role: 'headline', type: 'text', size: 40, overflow: true, contrast: 1.5 }] }, base);
  assert.ok(h.score < 3 && h.fix === 'shorter-headline');
}

// ── 3. Directions: grounding, variety, the code floor ────────────────────
{
  const read = C.readCreative(GOLF, { articles: [{ title: 'Tour Pro Issues Plea for LIV Golfers\' PGA Return', url: 'https://www.essentiallysports.com/golf-news-liv/', excerpt: 'Following LIV Golf\'s collapse into Chapter 11 liquidation, a tour pro wants them back.' }] });
  const assets = { photos: { 'LPGA Tour': [{ src: '/lpga1.jpg', id: 'p1a', person: 'LPGA Tour', team: true }], 'PGA Tour': [{ src: '/pga.jpg', id: 'p2a', person: 'PGA Tour', team: true }, { src: '/pga-1200x768.jpg', id: 'p2b', person: 'PGA Tour', team: true }] }, cutouts: {}, art: { s1: { src: 'proc:trophy' }, s2: { src: 'proc:cards' } } };
  const raw = { directions: [
    { story: 's1', archetype: 'prize-poster', headline: 'One last swing for $2 million', numberFact: 'f1', factIds: ['f1'], highlight: ['$2'], palette: 'golf:Green & Gold', note: 'Gold trophy, $2M over its base.' },
    { story: 's1', archetype: 'big-number', headline: 'A $3 million finish', numberFact: 'f1', factIds: ['f1'] },
    { story: 's1', archetype: 'typographic', headline: 'LIV Golf is dead. Now what?', sources: [] },
    { story: 's2', archetype: 'prize-poster', headline: 'Cards earned', numberFact: 'f2' },
    { story: 's2', archetype: 'unit-grid', headline: 'Season over. Cards earned.', numberFact: 'f2', factIds: ['f2'], labels: { f2: 'Tour cards', f9: 'x' } },
    { story: 's2', archetype: 'magazine-cover', headline: 'Earned. Not given.', photo: 'p2a', factIds: ['f2'] },
    { story: 's2', archetype: 'duotone-hero', headline: 'Cards, earned again', photo: 'p2b' },
    { story: 's9', archetype: 'big-number', headline: 'Nowhere' },
    { story: 's1', archetype: 'hero-number', headline: 'Who won it', photo: 'p1a', numberFact: 'f1' },
  ] };
  const { directions, dropped } = C.validateDirections(raw, read, assets, { want: 6 });
  const why = text => dropped.find(d => d.headline === text)?.why || '';
  assert.match(why('A $3 million finish'), /not a fact/, 'invented number dropped');
  assert.match(why('LIV Golf is dead. Now what?'), /not in the brief.*no ES story was cited/, 'off-brief LIV angle dropped without a citation');
  assert.match(why('Cards earned'), /same archetype/);
  assert.match(why('Cards, earned again'), /same photo/, 'the same image under a resized URL is the same photo');
  assert.match(why('Nowhere'), /no story/);
  assert.match(why('Who won it'), /team photo cannot be a player cut-out|does not fit/);
  assert.deepEqual(directions.map(d => d.archetype), ['prize-poster', 'unit-grid', 'magazine-cover']);
  assert.deepEqual(directions.find(d => d.archetype === 'unit-grid').labels, { f2: 'Tour cards' });
  // With the ES story cited, the LIV angle is allowed and carries its source.
  const cited = C.validateDirections({ directions: [{ story: 's1', archetype: 'typographic', headline: 'LIV Golf is dead. Now what?', sources: ['A1'] }] }, read, assets);
  assert.equal(cited.directions.length, 1);
  assert.equal(cited.directions[0].cited[0].url, 'https://www.essentiallysports.com/golf-news-liv/');

  // The code floor: different archetypes, every story covered, different photos.
  const nflRead = C.readCreative(NFL, {});
  const photos = { 'Joe Burrow': ['a', 'b', 'c'].map((n, i) => ({ src: `/burrow-${n}.jpg`, id: `p1${n}`, person: 'Joe Burrow' })) };
  const floor = C.planDeterministic(nflRead, { photos, cutouts: { '/burrow-a.jpg': '/burrow-a.png' }, art: {} }, { want: 4 });
  assert.equal(floor.length, 4);
  assert.equal(new Set(floor.map(d => d.archetype)).size, 4, 'different archetypes');
  assert.ok(new Set(floor.map(d => d.story)).size >= 3, 'spread across the stories');
  const used = floor.filter(d => d.photo).map(d => d.photo.src);
  assert.equal(new Set(used).size, used.length, 'never the same photo twice');
  const golfFloor = C.planDeterministic(C.readCreative(GOLF, {}), { photos: {}, cutouts: {}, art: { s1: { src: 'proc:trophy' }, s2: { src: 'proc:cards' } } });
  assert.ok(golfFloor.some(d => d.archetype === 'split-versus'), 'two stories with numbers get a split screen');
  assert.ok(golfFloor.some(d => d.story === 's1') && golfFloor.some(d => d.story === 's2'), 'LPGA and PGA both covered');

  // Photo de-duplication.
  assert.equal(C.photoKey('https://x/wp-content/uploads/imago1060010797h.jpg-e1794795240386.jpeg'), C.photoKey('https://x/wp-content/uploads/imago1060010797h-1200x768.jpg'));
  assert.equal(C.dedupePhotos([{ src: '/a-scaled.jpg' }, { src: '/a.jpg' }, { src: '/b.jpg' }]).length, 2);
  assert.equal(C.procArtFor('season ends with $2 million prize', 'Golf'), 'trophy');
  assert.equal(C.procArtFor('100 players earning cards', 'Golf'), 'cards');
}

// ── 4. The whole plan: director, assets, cost, cache ─────────────────────
{
  C.setAssetService(null);
  gatewayReply = { directions: [
    { story: 's1', archetype: 'prize-poster', name: 'The Last Check', headline: 'One last swing for $2 million', numberFact: 'f1', factIds: ['f1'], art: 'gold trophy', palette: 'golf:Green & Gold', note: 'Gold trophy lit from above; $2M over its base.' },
    { story: 's2', archetype: 'unit-grid', headline: 'Season over. Cards earned.', numberFact: 'f2', factIds: ['f2'], palette: 'es', note: '100 cards in a grid.' },
  ] };
  const calls = gatewayCalls;
  const plan = await C.plan({ brief: GOLF, found: {}, want: 4, track: { email: 'a@essentiallysports.com' } });
  assert.equal(gatewayCalls - calls, 1, 'one art-director call');
  assert.equal(plan.director.source, 'director');
  assert.equal(plan.directions.length, 4, 'the code plan fills the set');
  assert.equal(new Set(plan.directions.map(d => d.archetype)).size, 4);
  assert.ok(plan.directions.every(d => d.candidates.length >= 2 && d.candidates.length <= 3), '2-3 candidates each');
  assert.ok(plan.directions.every(d => d.candidates.every(s => s.guideline?.ok)));
  assert.equal(plan.directions[0].note, 'Gold trophy lit from above; $2M over its base.');
  assert.match(plan.directions[0].art.src, /^proc:trophy/, 'no asset service: ES vector art');
  assert.ok(plan.cost.director > 0 && plan.cost.total < 0.1, `cost per plan ${plan.cost.total}`);
  const again = await C.plan({ brief: GOLF, found: {}, want: 4 });
  assert.equal(again.cached, true);
  assert.equal(again.cost.total, 0, 'cached plans cost nothing');

  // With the asset service: photos per subject, cut-outs, AI concept art (never people).
  C.PLAN_CACHE.clear();
  const seen = [];
  C.setAssetService({
    findPhotos: async args => { seen.push(args); return { photos: [{ url: `/api/es-image-search?u=${encodeURIComponent(args.person || args.team)}-1.jpg` }, { url: `/api/es-image-search?u=${encodeURIComponent(args.person || args.team)}-1.jpg` }, { url: `/api/es-image-search?u=${encodeURIComponent(args.person || args.team)}-2.jpg` }] }; },
    cutout: async ({ imageUrl }) => ({ ok: true, url: `${imageUrl}.png`, cost: 0.01 }),
    generateConceptArt: async ({ avoid }) => { assert.ok(avoid.includes('people') && avoid.includes('logos')); return { ok: true, url: 'https://cdn.example/art.png', cost: 0.03, rights: { aiGenerated: true } }; },
  });
  gatewayReply = { directions: [] };
  const withAssets = await C.plan({ brief: NFL, found: {}, want: 4 });
  assert.ok(seen.some(a => a.person === 'Joe Burrow'), 'photos for the named player');
  assert.ok(withAssets.assets.cutouts >= 1);
  assert.ok(withAssets.cost.assets > 0);
  assert.ok(withAssets.directions.some(d => d.archetype === 'hero-number' || d.archetype === 'scoreboard'), 'a cut-out composition');
  C.setAssetService(null);
}

// ── 5. The art director's vision pass ────────────────────────────────────
{
  const img = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg').toString('base64');
  judgeReply = { directions: [{ id: 'd1', best: 'd1c2', scores: { d1c1: { hierarchy: 3, focal: 3, readability: 4, brand: 4, originality: 3 }, d1c2: { hierarchy: 5, focal: 5, readability: 5, brand: 5, originality: 4 } }, note: 'Giant $2M over the trophy.', fix: 'bigger-number' }, { id: 'd2', best: 'nope', scores: {}, fix: 'make-it-pop' }] };
  const sets = [{ direction: 'd1', archetype: 'prize-poster', items: [{ id: 'd1c1', image: img }, { id: 'd1c2', image: img }] }, { direction: 'd2', archetype: 'unit-grid', items: [{ id: 'd2c1', image: `${img}A` }, { id: 'd2c2', image: `${img}B` }] }];
  const out = await C.judge({ brief: GOLF, sets, heuristics: { d2c2: { score: 4.4 }, d2c1: { score: 3 } } });
  assert.equal(out.source, 'vision');
  assert.equal(out.directions[0].best, 'd1c2');
  assert.equal(out.directions[0].fix, 'bigger-number');
  assert.equal(out.directions[0].note, 'Giant $2M over the trophy.');
  assert.ok(out.directions[0].scores.d1c2.total > out.directions[0].scores.d1c1.total);
  assert.equal(out.directions[1].fix, '', 'a fix outside the whitelist is ignored');
  assert.ok(['d2c1', 'd2c2'].includes(out.directions[1].best));
  assert.ok(out.cost > 0);
  const cached = await C.judge({ brief: GOLF, sets, heuristics: {} });
  assert.equal(cached.cached, true);
  assert.equal(cached.cost, 0);
  // Non-image payloads are ignored.
  assert.deepEqual((await C.judge({ sets: [{ direction: 'd1', items: [{ id: 'x', image: 'javascript:alert(1)' }] }] })).directions, []);
  // No key: the heuristic picks.
  const key = process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  C.JUDGE_CACHE.clear();
  const free = await C.judge({ sets: [{ direction: 'd3', items: [{ id: 'd3c1', image: `${img}C` }, { id: 'd3c2', image: `${img}D` }] }], heuristics: { d3c1: { score: 3.1, fix: 'darker-mist' }, d3c2: { score: 4.2, fix: '' } } });
  assert.equal(free.source, 'heuristic');
  assert.equal(free.directions[0].best, 'd3c2');
  process.env.AI_GATEWAY_API_KEY = key;
}

// ── 6. es-generate modes ─────────────────────────────────────────────────
{
  C.PLAN_CACHE.clear();
  gatewayReply = { directions: [{ story: 's1', archetype: 'record-badge', headline: 'Luka has them rolling', numberFact: 'f1', factIds: ['f1'], palette: 'team:Lakers', note: '12-2 in gold over a ghosted crest.' }] };
  const res = await post({ mode: 'creative', brief: NBA, steer: { tone: 'witty' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.kind, 'creative');
  assert.ok(res.body.runId);
  assert.ok(res.body.directions.length >= 2);
  assert.equal(res.body.directions[0].archetype, 'record-badge');
  assert.ok(typeof res.body.meta.costUsd === 'number');
  judgeReply = { directions: [] };
  const judged = await post({ mode: 'creative-judge', brief: NBA, sets: [], heuristics: {} });
  assert.equal(judged.status, 200);
  assert.deepEqual(judged.body.directions, []);
}

// ── 7. Guidelines, page wiring, cache keys ───────────────────────────────
{
  assert.ok(GUIDE.COMPOSED_RULES.length >= 6);
  assert.ok(GUIDE.RULES_BY_ID['composed-cutout'] && GUIDE.RULES_BY_ID['composed-numbers']);
  assert.ok(!GUIDE.RULES.some(r => r.area === 'composed'), 'template rules unchanged');
  assert.ok(GUIDE.composedLines().some(line => /never people/.test(line)));
  const html = fs.readFileSync('generate.html', 'utf8');
  assert.match(html, /frameup-compose\.js\?v=[\w-]+/);
  assert.match(html, /generate-creative\.js\?v=[\w-]+/);
  assert.match(html, /generate-creative\.css\?v=[\w-]+/);
  assert.match(html, /window\.FrameUpCreative\?\.isOn\?\.\(\)/, 'Generate hands Creative runs to generate-creative.js');
  assert.match(html, /window\.FrameUpGenerate = Object\.freeze/);
  const js = fs.readFileSync('generate-creative.js', 'utf8');
  ['creative-judge', 'recordDesignExport', 'Try another composition', 'Swap photo', 'Edit text', 'applyFix'].forEach(text => assert.ok(js.includes(text), `page has ${text}`));
  const css = fs.readFileSync('generate-creative.css', 'utf8');
  assert.ok(!/#(?:7B2CBF|8B5CF6|A855F7|9333EA|6D28D9)/i.test(css), 'no purple');
  const gw = fs.readFileSync(path.join(fnDir, '_ai-gateway.js'), 'utf8');
  assert.match(gw, /\['generate-creative', 'Creative designs'\]/);
}

console.log('generate creative checks passed');
