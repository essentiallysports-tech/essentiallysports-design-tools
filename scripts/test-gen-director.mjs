// gen-director (Generate v3, 2026-11-20): the art director makes sets an ES
// senior designer would ship. Every failure CLASS from the live review is
// checked across the whole replay set (23 briefs: golf, NFL, CFB, NBA, MLB,
// tennis, soccer, F1; stats, records, trades, contracts, injuries, rankings,
// quotes, previews, results, lifestyle, multi-story, topic-only, Trends
// hand-offs with coverage meta). No brief-specific rules. Every network call
// is mocked (photos, cut-outs, the AI gateway).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');

// ── Mocks: the AI gateway (director + judge) and Supabase ─────────────────
let directorReplies = [];
let judgeReply = null;
const aiCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) {
    const body = JSON.parse(options.body);
    aiCalls.push(body);
    const content = body.messages[0].content;
    if (Array.isArray(content)) return reply(200, { content: [{ type: 'text', text: JSON.stringify(judgeReply) }], usage: { input_tokens: 9000, output_tokens: 700 } });
    const next = directorReplies.length > 1 ? directorReplies.shift() : directorReplies[0];
    return reply(200, { content: [{ type: 'text', text: JSON.stringify(next || { directions: [] }) }], usage: { input_tokens: 4200, output_tokens: 1300 } });
  }
  if (href.includes('/rest/v1/')) return reply(200, []);
  throw new Error(`unexpected fetch ${href}`);
};
process.env.AI_GATEWAY_API_KEY = 'gw-test';
delete process.env.GENERATE_ART_DIRECTOR_MODEL;
delete process.env.GENERATE_JUDGE_MODEL;
delete process.env.AI_ECONOMY;
const authPath = path.join(fnDir, '_supabase-auth.js');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }), verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }) } };

const COMPOSE = require(path.resolve('frameup-compose.js'));
const C = require(path.join(fnDir, '_composer.js'));
const M = require(path.join(fnDir, '_creative-memory.js'));
const { briefs } = JSON.parse(fs.readFileSync('scripts/fixtures/gen-director-briefs.json', 'utf8'));
assert.ok(briefs.length >= 20, '20+ replay briefs');
assert.ok(new Set(briefs.map(b => b.sport)).size >= 7, 'across 7+ sports');
assert.ok(new Set(briefs.map(b => b.type)).size >= 12, 'across 12+ story types');

// ES photos for any named person (3 each); the asset service cuts them out.
const photosFor = person => [1, 2, 3].map(i => ({ url: `https://images.essentiallysports.com/${encodeURIComponent(person)}-${i}.jpg`, title: person }));
let cutoutCalls = 0;
const cutService = { cutout: async ({ imageUrl }) => { cutoutCalls += 1; return { ok: true, url: imageUrl.replace('.jpg', '-cut.png'), cost: 0 }; } };

const YEAR = /^(?:19|20)\d{2}$/;
const COVERAGE = /\b(?:STORIES|STORY|OUTLETS?|ARTICLES?|SOURCES?|SEARCHES|PUBLICATIONS?)\b/;
const LIGHT = new Set(['light', 'paper', 'editorial']);

// Every failure class, on one plan. Returns a list of problems (empty = clean).
function problems(plan, brief) {
  const out = [];
  const facts = plan.read.facts;
  const named = plan.read.people.length > 0;
  const say = text => out.push(`${brief.id}: ${text}`);
  plan.directions.forEach(d => {
    d.candidates.forEach(scene => {
      const nums = scene.layers.filter(l => l.type === 'number' && l.value);
      nums.forEach(l => {
        const fact = facts.find(f => f.id === l.factId);
        // 1. Coverage counts are never stats.
        if (COVERAGE.test(String(l.label).toUpperCase()) || (fact && fact.kind === 'meta')) say(`${scene.id} shows a coverage count "${l.value} ${l.label}"`);
        // 2. A year or date is never a number on the design.
        if (!l.prefix && YEAR.test(String(l.value).replace(/,/g, ''))) say(`${scene.id} shows the year ${l.value} as a number`);
        if (fact && fact.kind === 'date') say(`${scene.id} shows a date fact "${fact.text}"`);
        // 3. Labels read as noun phrases.
        if (l.label && !C.labelReads(l.label)) say(`${scene.id} garbled label "${l.label}"`);
        // 4. Said once: the headline never repeats a shown number.
        const head = ` ${String(d.headline).toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
        const digits = String(l.value).replace(/,/g, '').match(/\d+/g) || [];
        if (digits.some(x => x.length >= 2 && head.includes(` ${x} `))) say(`${scene.id} headline "${d.headline}" repeats ${l.value}`);
      });
      // Labels set as text next to a number (role label + factId) read too.
      scene.layers.filter(l => l.role === 'label' && l.factId).forEach(l => {
        if (COVERAGE.test(String(l.text).toUpperCase())) say(`${scene.id} label text shows a coverage count "${l.text}"`);
      });
      // 7. No empty areas.
      const holes = C.emptyQuadrants(scene);
      if (holes.length) say(`${scene.id} (${scene.archetype}) has an empty ${holes.join('+')} area`);
      // The ES gate still passes.
      assert.ok(COMPOSE.checkScene(JSON.parse(JSON.stringify(scene)), { facts: d.input.facts }).ok, `${brief.id} ${scene.id} passes the ES gate`);
      if (scene.tone) assert.equal(scene.tone, d.tone, 'the scene carries its tone');
    });
    if (d.kicker && d.kicker.toLowerCase() === String(d.headline).toLowerCase()) say(`${d.id} kicker repeats the headline`);
    assert.ok(C.TONES.includes(d.tone), `${brief.id} ${d.id} has a tone`);
    assert.equal(d.input.tone, d.tone, 'input.tone goes to the renderer (shared shape)');
  });
  // 5. Tones: varied, light and dark mixed.
  const tones = plan.directions.map(d => d.tone);
  if (tones.length >= 2 && new Set(tones).size < 2) say(`one tone across the set (${tones.join(', ')})`);
  if (tones.length >= 2 && !tones.some(t => LIGHT.has(t))) say(`no light design (${tones.join(', ')})`);
  if (tones.length >= 2 && tones.every(t => LIGHT.has(t))) say(`no dark design (${tones.join(', ')})`);
  // Families vary (ES categories).
  const families = plan.directions.map(d => d.family);
  if (new Set(families).size < Math.min(families.length, 3)) say(`families repeat (${families.join(', ')})`);
  // 6. A named star with a cut-out: a cut-out-led design.
  if (named && plan.assets.cutouts > 0 && !plan.directions.some(d => d.cutoutLed && d.candidates[0].layers.some(l => l.type === 'cutout'))) say('a named person, cut-outs ready, no cut-out-led design');
  // Image-led: half the set shows photography when a person is named.
  if (named && plan.assets.photos > 0) {
    const shown = plan.directions.filter(d => C.usesPhoto(d.candidates[0])).length;
    if (shown < Math.ceil(plan.directions.length / 2)) say(`only ${shown} of ${plan.directions.length} designs show a photo`);
  }
  // The plan's own scorecard agrees.
  Object.entries(plan.review.checks).forEach(([check, value]) => { if (!value.ok) say(`review check ${check} failed: ${JSON.stringify(value)}`); });
  return out;
}

// ── 1. Content sense: what a number means, whether a label reads ─────────
{
  assert.equal(C.statWeight({ kind: 'count', value: '4', label: 'stories' }), 0, 'coverage counts are not stats');
  assert.equal(C.statWeight({ kind: 'count', value: '6', label: 'outlets' }), 0);
  assert.equal(C.statWeight({ kind: 'count', value: '2027', label: 'season' }), 0, 'a year is not a stat');
  assert.equal(C.statWeight({ kind: 'money', value: '450', prefix: '$', suffix: 'M', label: 'extension' }), 5);
  assert.equal(C.statWeight({ kind: 'count', value: '409', label: 'yards' }), 5);
  assert.equal(C.statWeight({ kind: 'count', value: '2', label: 'weeks' }), 1, 'a duration is weak');
  assert.equal(C.senseLabel('season Why fans'), 'season', 'the label stops where the next sentence starts');
  assert.equal(C.senseLabel('players earning cards'), 'players earning cards');
  assert.equal(C.senseLabel('yards and'), 'yards');
  assert.ok(!C.labelReads('SEASON WHY FANS'));
  assert.ok(C.labelReads('PASSING YARDS'));
  assert.equal(C.stripCoverage('Why fans care: 4 stories on this · 6 outlets · fits Golf').trim(), '', 'Trends coverage meta is not story text');
  assert.equal(C.stripCoverage('Everyone is covering it: 4 stories across 6 outlets.').includes('4'), false);

  const bryson = C.readCreative(briefs.find(b => b.id === 'golf-bryson-trend').brief, {});
  assert.ok(!bryson.facts.some(f => C.statWeight(f) > 0), 'the Bryson brief has no stat: no number design');
  assert.ok(!bryson.facts.some(f => /why|fans|stories|outlets/i.test(f.label)), 'no label from "Why fans care" or the coverage counts');
  assert.equal(bryson.headline, 'Bryson Takes On Europe', 'the brief\'s headline line is kept');
  assert.equal(bryson.stories.length, 1, 'coverage talk is not a story');
  const gauff = C.readCreative(briefs.find(b => b.id === 'tennis-quote').brief, {});
  assert.ok(gauff.facts.some(f => f.kind === 'ratio' && f.display === '14/15'), '"14 of her last 15" is one fact, never "15 MATCHES"');
  const ws = C.readCreative(briefs.find(b => b.id === 'mlb-result').brief, {});
  assert.ok(!ws.facts.some(f => f.label === 'win'), '"Game 5 to win" is not "5 WIN"');
  assert.ok(ws.facts.some(f => f.kind === 'date' && f.value === '5'), 'Game 5 is an identifier');
  const ohtani = C.readCreative(briefs.find(b => b.id === 'mlb-ohtani').brief, {});
  assert.ok(ohtani.facts.some(f => f.kind === 'ordinal' && f.display === '4TH'), 'ordinals are facts (4th MVP)');
  assert.equal(C.heroFact(ohtani.facts).text, '55 home runs', 'the hero is the strongest real stat, not the year');
}

// ── 2. The replay set through the code planner (no AI) ───────────────────
const plans = {};
{
  C.setAssetService(cutService);
  const all = [];
  for (const brief of briefs) {
    C.PLAN_CACHE.clear();
    const plan = await C.plan({ brief: brief.brief, director: false, localFind: async person => photosFor(person), want: 4 });
    plans[brief.id] = plan;
    assert.ok(plan.directions.length >= 3, `${brief.id}: 3+ designs (${plan.directions.length})`);
    assert.ok(plan.directions.every(d => d.candidates.length >= 1), `${brief.id}: every design has candidates`);
    all.push(...problems(plan, brief));
  }
  assert.deepEqual(all, [], `failure classes across the replay set:\n${all.join('\n')}`);
  // The live failure, by name: none of it comes back.
  const bryson = plans['golf-bryson-trend'];
  const numbers = bryson.directions.flatMap(d => d.candidates.flatMap(s => s.layers.filter(l => l.type === 'number')));
  assert.equal(numbers.length, 0, 'Bryson: no fake stats, no 2027 hero number');
  assert.ok(bryson.directions.some(d => d.cutoutLed), 'Bryson: a cut-out-led design');
  assert.ok(bryson.directions.some(d => d.headline === 'Bryson Takes On Europe'), 'Bryson: the brief\'s own headline on a cover');
  assert.ok(new Set(bryson.directions.map(d => d.tone)).size >= 3, 'Bryson: varied tones');
}

// ── 3. The AI director: today's failing plan is caught in code ───────────
{
  const brief = briefs.find(b => b.id === 'golf-bryson-trend').brief;
  const read = C.readCreative(brief, {});
  const year = read.facts.find(f => f.kind === 'date');
  // What the live director shipped: the year as hero, repeated in the headline,
  // a bogus label, every design dark; plus a fine typographic poster.
  const bad = { directions: [
    { story: 's1', archetype: 'big-number', headline: 'The 2027 season starts a new era', numberFact: year.id, factIds: [year.id], label: 'season', tone: 'dark' },
    { story: 's1', archetype: 'by-the-numbers', headline: 'Everyone is covering Bryson\'s move', factIds: [year.id], labels: { [year.id]: 'season why fans' }, tone: 'dark' },
    { story: 's1', archetype: 'typographic', headline: 'Bryson takes on Europe', highlight: ['Europe'], tone: 'dark', label: 'season Why fans' },
  ] };
  const assets = { photos: { 'Bryson DeChambeau': [{ src: '/b1.jpg', id: 'p1a', person: 'Bryson DeChambeau' }, { src: '/b2.jpg', id: 'p1b', person: 'Bryson DeChambeau' }] }, cutouts: { '/b1.jpg': '/b1.png' }, art: {} };
  const { directions, dropped } = C.validateDirections(bad, read, assets, { want: 4 });
  const why = text => dropped.find(d => d.headline === text)?.why || '';
  assert.match(why('The 2027 season starts a new era'), /not a stat \(a year or date\)/, 'a year is never the hero number');
  assert.match(why('Everyone is covering Bryson\'s move'), /does not fit|not a stat/, 'no grid of non-stats');
  assert.deepEqual(directions.map(d => d.archetype), ['typographic']);
  assert.equal(directions[0].label, '', 'a garbled label is dropped');
  // A label the director wrote must read; numbers in the headline that the poster shows are refused.
  const sga = C.readCreative(briefs.find(b => b.id === 'nba-sga-record').brief, {});
  const pts = sga.facts.find(f => f.label === 'points');
  const dup = C.validateDirections({ directions: [{ story: 's1', archetype: 'big-number', headline: 'SGA drops 50 on them', numberFact: pts.id, factIds: [pts.id] }] }, sga, { photos: {}, cutouts: {}, art: {} });
  assert.match(dup.dropped[0].why, /repeats 50/, 'number and headline say it once');
  const fam = C.validateDirections({ directions: [
    { story: 's1', archetype: 'magazine-cover', headline: 'Gilgeous-Alexander scores again', photo: 'p1a', tone: 'dark' },
    { story: 's1', archetype: 'duotone-hero', headline: 'Shai scores, again and again', photo: 'p1b', tone: 'duotone' },
  ] }, sga, { photos: { 'Shai Gilgeous-Alexander': [{ src: '/s1.jpg', id: 'p1a', person: 'Shai Gilgeous-Alexander' }, { src: '/s2.jpg', id: 'p1b', person: 'Shai Gilgeous-Alexander' }] }, cutouts: {}, art: {} }, { want: 4 });
  assert.match(fam.dropped.map(d => d.why).join(' '), /second cover design/, 'one design per ES family in a set of 4');

  // Through plan(), in auto mode (GENERATE_ART_DIRECTOR_MODEL=auto; gen4 made Sonnet the
  // default): Haiku first; the plan is thin, so Sonnet once; the set is repaired in code.
  process.env.GENERATE_ART_DIRECTOR_MODEL = 'auto';
  C.setAssetService(cutService);
  C.PLAN_CACHE.clear();
  aiCalls.length = 0;
  directorReplies = [bad, bad];
  const plan = await C.plan({ brief, found: {}, want: 4, localFind: async person => photosFor(person), lessons: [] });
  const models = aiCalls.map(c => c.model);
  assert.equal(models.length, 2, 'auto: Haiku, then one Sonnet escalation');
  assert.match(models[0], /haiku/);
  assert.match(models[1], /sonnet/);
  assert.equal(plan.director.escalated, true);
  assert.deepEqual(problems(plan, { id: 'bryson-ai' }), []);
  assert.ok(plan.dropped.some(d => /year or date/.test(d.why)));
  assert.ok(plan.directions.some(d => d.source === 'director' && d.archetype === 'typographic'));
  assert.ok(plan.cost.director > 0 && plan.cost.director < 0.06, `director cost ${plan.cost.director}`);
  // The system prompt carries the ES families, tones and the house lessons.
  const system = aiCalls[0].system.map(b => b.text).join('\n');
  assert.match(system, /ES families \(the ES Figma board\)/);
  assert.match(system, /never a numberFact/i);
  assert.match(aiCalls[0].messages[0].content, /ES house lessons/);
  assert.match(aiCalls[0].messages[0].content, /"stat":false/, 'facts tell the director which are not stats');
  // A good Haiku plan: one call, no escalation.
  C.PLAN_CACHE.clear();
  aiCalls.length = 0;
  directorReplies = [{ directions: [
    { story: 's1', archetype: 'typographic', headline: 'Bryson takes on Europe', tone: 'light' },
    { story: 's1', archetype: 'trading-card', headline: 'Europe calls Bryson', photo: 'p1b', tone: 'dark' },
  ] }];
  const cheap = await C.plan({ brief, found: {}, want: 4, localFind: async person => photosFor(person), lessons: [] });
  assert.equal(aiCalls.length, 1, 'Haiku enough: no Sonnet call');
  assert.match(aiCalls[0].model, /haiku/);
  assert.deepEqual(problems(cheap, { id: 'bryson-haiku' }), []);
  // GENERATE_ART_DIRECTOR_MODEL=sonnet forces Sonnet.
  assert.equal(C.directorTier('sonnet'), 'best');
  assert.equal(C.directorTier('haiku'), 'main');
  assert.equal(C.directorTier('auto'), 'auto');
  assert.equal(C.directorTier(''), 'best', 'gen4: Sonnet art-directs by default (quality first)');
  // Default (no env): one Sonnet call.
  delete process.env.GENERATE_ART_DIRECTOR_MODEL;
  C.PLAN_CACHE.clear();
  aiCalls.length = 0;
  directorReplies = [{ directions: [
    { story: 's1', archetype: 'typographic', headline: 'Bryson takes on Europe', tone: 'light' },
    { story: 's1', archetype: 'trading-card', headline: 'Europe calls Bryson', photo: 'p1b', tone: 'dark' },
  ] }];
  await C.plan({ brief: `${brief} `, found: {}, want: 4, localFind: async person => photosFor(person), lessons: [] });
  assert.equal(aiCalls.length, 1, 'default: one director call');
  assert.match(aiCalls[0].model, /sonnet/, 'default director is Sonnet');
}

// ── 4. Set design helpers ────────────────────────────────────────────────
{
  const set = [{ archetype: 'magazine-cover' }, { archetype: 'duotone-hero' }, { archetype: 'hero-number' }];
  C.assignTones(set);
  assert.ok(new Set(set.map(d => d.tone)).size === 3, 'different tones');
  assert.ok(set.every(d => C.tonesOf(d.archetype).includes(d.tone)), 'each tone is one its archetype supports');
  const mixed = [{ archetype: 'by-the-numbers', tone: 'dark' }, { archetype: 'typographic', tone: 'dark' }, { archetype: 'hero-number', tone: 'dark' }];
  C.assignTones(mixed);
  assert.ok(mixed.some(d => C.LIGHT_TONES.has(d.tone)) && mixed.some(d => !C.LIGHT_TONES.has(d.tone)), 'light and dark mixed');
  // gen-looks' archetype metadata wins when it is there.
  const a = COMPOSE.BY_ID.typographic;
  const keep = { family: a.family, tones: a.tones };
  a.family = 'quote';
  a.tones = ['paper'];
  assert.equal(C.familyOf('typographic'), 'quote');
  assert.deepEqual(C.tonesOf('typographic'), ['paper']);
  a.family = keep.family;
  a.tones = keep.tones;
  assert.equal(C.familyOf('typographic'), 'cover');
  // Empty areas: a 3-number grid in a 2x2 leaves a hole.
  const sga = C.readCreative(briefs.find(b => b.id === 'nba-sga-record').brief, {});
  const input = C.inputsFor({ story: 's1', archetype: 'by-the-numbers', headline: 'SGA', factIds: ['f1', 'f2', 'f3'] }, sga, {});
  assert.equal(input.numbers.length, 3);
  assert.ok(C.emptyQuadrants(COMPOSE.build('by-the-numbers', input, 0)).includes('bottom-right'));
}

// ── 5. The shared input shape from the asset service (gen-imagery) ───────
{
  C.PLAN_CACHE.clear();
  cutoutCalls = 0;
  const seen = [];
  C.setAssetService({
    ...cutService,
    findPhotos: async args => {
      seen.push(args);
      const who = args.person || args.team;
      return {
        photos: [
          { url: `https://img/${who}-low.jpg`, width: 800, height: 600, person: who, kind: 'crowd', score: 0.2, source: 'es', rights: { licence: 'ES' } },
          { url: `https://img/${who}-hero.jpg`, width: 1600, height: 2000, person: who, kind: 'action', focal: { x: 0.5, y: 0.3 }, score: 0.95, source: 'es', rights: { licence: 'ES' } },
        ],
        cutouts: [{ url: `https://img/${who}-hero.png`, fromPhoto: `https://img/${who}-hero.jpg`, person: who }],
        headshots: [{ url: `https://img/${who}-head.jpg`, person: who }],
        logos: [{ url: 'https://img/thunder.svg', team: 'Thunder', league: 'NBA' }],
      };
    },
  });
  directorReplies = [{ directions: [] }];
  const plan = await C.plan({ brief: briefs.find(b => b.id === 'nba-sga-record').brief, found: {}, want: 4, director: false });
  assert.ok(seen.some(a => a.person === 'Shai Gilgeous-Alexander'));
  const lead = plan.directions.find(d => d.cutoutLed);
  assert.ok(lead, 'the service cut-out leads a design');
  assert.equal(lead.input.cutout.src, 'https://img/Shai Gilgeous-Alexander-hero.png', 'the ranked photo\'s ready cut-out is used');
  assert.ok(lead.input.cutouts.length >= 1 && lead.input.cutouts[0].url && lead.input.cutouts[0].fromPhoto, 'input.cutouts in the shared shape');
  assert.ok(plan.directions.every(d => Array.isArray(d.input.headshots)), 'input.headshots passed through');
  assert.ok(plan.directions.some(d => d.input.headshots.length), 'headshots reach the inputs');
  assert.ok(plan.directions.find(d => d.photo)?.photo.src.endsWith('-hero.jpg'), 'photos ranked by score: the best one first');
  assert.equal(cutoutCalls, 0, 'ready cut-outs are not made again; a crowd shot is never cut out');
  C.setAssetService(null);
  // No asset service, no photos: still a full, varied set (each branch works alone).
  C.PLAN_CACHE.clear();
  const bare = await C.plan({ brief: briefs.find(b => b.id === 'nfl-burrow-stats').brief, found: {}, want: 4, director: false });
  assert.ok(bare.directions.length >= 3);
  assert.deepEqual(problems(bare, { id: 'nfl-no-assets' }), []);
}

// ── 6. The judge: new rubric lines, set tone variety, fix ops ─────────────
{
  const img = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-gd').toString('base64');
  C.JUDGE_CACHE.clear();
  judgeReply = {
    set: { toneVariety: 2, change: 'd3', why: 'All three are dark green or navy.' },
    directions: [
      { id: 'd1', best: 'd1c1', scores: { d1c1: { hierarchy: 4, focal: 4, readability: 5, brand: 4, originality: 3, image: 1, labels: 5, stats: 5 } }, note: 'Huge headline; the golf-ball photo is a murky corner.', fix: '', improvements: [{ text: 'The tiny murky golf-ball photo adds nothing', fix: '' }, { text: 'Bryson is named but no design leads with his cut-out', fix: 'use-cutout' }] },
      { id: 'd2', best: 'd2c1', scores: { d2c1: { hierarchy: 4, focal: 4, readability: 4, brand: 4, originality: 3, image: 3, labels: 4, stats: 1 } }, improvements: [{ text: '2027 is a year shown as the hero number, not a stat', fix: 'drop-stat' }, { text: 'The headline repeats the 2027', fix: '' }] },
      { id: 'd3', best: 'd3c1', scores: { d3c1: { hierarchy: 3, focal: 3, readability: 4, brand: 4, originality: 3, image: 2, labels: 1, stats: 1 } }, improvements: [{ text: 'The label SEASON WHY FANS is garbled', fix: '' }, { text: '4 STORIES and 6 OUTLETS are our own coverage counts', fix: '' }] },
    ],
  };
  const sets = ['d1', 'd2', 'd3'].map((id, i) => ({ direction: id, archetype: ['typographic', 'big-number', 'by-the-numbers'][i], tone: 'dark', items: [{ id: `${id}c1`, image: `${img}${i}` }] }));
  aiCalls.length = 0;
  const out = await C.judge({ brief: briefs[0].brief, sets, heuristics: {} });
  assert.equal(out.source, 'vision');
  assert.match(aiCalls[0].model, /sonnet/, 'vision judging stays on Sonnet');
  const prompt = aiCalls[0].messages[0].content[0].text;
  ['image (photo and cut-out quality', 'labels (every stat label', 'stats (every number is a real stat', 'toneVariety', 'ES house lessons'].forEach(t => assert.ok(prompt.includes(t), `judge prompt has ${t}`));
  assert.ok(prompt.includes('typographic, dark tone'), 'the judge sees each design\'s tone');
  assert.equal(out.set.toneVariety, 2);
  assert.equal(out.set.codeToneVariety, 1, 'code agrees: one tone three times');
  assert.equal(out.set.change, 'd3');
  // gen4: the judge's problems are repairs the page applies while designing
  // (never "Apply" chips); old-style replies map onto repair ops.
  const d3 = out.directions.find(d => d.id === 'd3');
  assert.ok(d3.repairs.some(r => r.op === 'flip-tone'), 'tone fix: a repair (palette flip)');
  const d1 = out.directions.find(d => d.id === 'd1');
  assert.ok(d1.repairs.some(r => r.op === 'drop-image'), 'weak, murky image -> dropped while designing');
  assert.ok(d1.repairs.some(r => r.op === 'use-cutout'), 'use-cutout repair');
  const d2 = out.directions.find(d => d.id === 'd2');
  assert.ok(d2.repairs.some(r => r.op === 'drop-stat'), 'drop-stat repair');
  assert.ok(d2.scores.d2c1.stats === 1 && d1.scores.d1c1.image === 1, 'new rubric lines scored');
  out.directions.forEach(d => {
    assert.deepEqual(d.critique.improvements, [], `${d.id}: no repair is shown as a suggestion`);
    assert.deepEqual(d.review, { autoFixed: [], suggestions: [] });
    d.repairs.forEach(r => assert.ok(COMPOSE.REPAIR_OPS.includes(r.op), `known repair op ${r.op}`));
  });
  assert.ok(prompt.includes('repairs') && prompt.includes('drop-image') && prompt.includes('remove-tag'), 'the judge is asked for repairs');
  const ASSIST = require(path.resolve('generate-assistant.js'));
  assert.ok(ASSIST, 'generate-assistant.js loads');
  // New-style reply: repairs with text, and one creative idea (a repair-like "idea" is refused).
  C.JUDGE_CACHE.clear();
  judgeReply = { directions: [
    { id: 'd1', best: 'd1c1', scores: {}, repairs: [{ issue: 'Headline drops the colon after MANFRED', op: 'headline', text: 'Manfred: owners won\'t budge' }, { issue: 'MLB tag', op: 'remove-tag' }, { issue: 'nonsense', op: 'paint-it-red' }], idea: 'Try a versus layout with Manfred and Tony Clark' },
    { id: 'd2', best: 'd2c1', scores: {}, repairs: [], idea: 'Fix the murky photo' },
  ] };
  const fresh = await C.judge({ brief: 'x', sets: sets.slice(0, 2).map((s, i) => ({ ...s, items: [{ id: s.items[0].id, image: `${img}n${i}` }] })), heuristics: {} });
  const n1 = fresh.directions.find(d => d.id === 'd1');
  assert.deepEqual(n1.repairs.map(r => r.op), ['headline', 'remove-tag'], 'unknown ops dropped');
  assert.equal(n1.repairs[0].text, 'Manfred: owners won\'t budge');
  assert.deepEqual(n1.review.suggestions, ['Try a versus layout with Manfred and Tony Clark']);
  assert.equal(n1.critique.improvements[0].fix.op, 'assist');
  assert.deepEqual(fresh.directions.find(d => d.id === 'd2').review.suggestions, [], 'a repair is never a suggestion');
  // Recheck: the second look says so in the prompt and logs its own feature.
  C.JUDGE_CACHE.clear();
  aiCalls.length = 0;
  judgeReply = { directions: [{ id: 'd1', best: 'd1c1', scores: {}, repairs: [] }] };
  await C.judge({ brief: 'x', sets: [{ ...sets[0], items: [{ id: 'd1c1', image: `${img}r` }] }], heuristics: {}, recheck: true });
  assert.match(aiCalls[0].messages[0].content[0].text, /SECOND LOOK/);
  // Without a model score the set verdict comes from code (tones sent by the page).
  C.JUDGE_CACHE.clear();
  judgeReply = { directions: [] };
  const coded = await C.judge({ brief: 'x', sets: sets.map((s, i) => ({ ...s, tone: ['dark', 'light', 'vivid'][i], items: [{ id: s.items[0].id, image: `${img}z${i}` }] })), heuristics: {} });
  assert.equal(coded.set.toneVariety, 5, 'light and dark, three tones');
  assert.equal(coded.set.change, '');
  // The judge's critiques teach the right topics.
  // es-generate.js hands the judge's issues to the learning model (as before).
  const signals = M.judgeSignals(out.directions.map(d => ({ ...d, critique: { ...d.critique, improvements: d.issues.map(text => ({ text })) } })), { sport: 'Golf' });
  const topics = new Set(signals.flatMap(M.observationsFrom).map(o => o.topic));
  ['stat-meaning', 'label-sense', 'no-cutout', 'image-weak'].forEach(t => assert.ok(topics.has(t), `learns ${t}`));
}

// ── 7. Code critique on a bad scene: fix ops a click applies ─────────────
{
  const read = C.readCreative('Lakers start the season 12-2.\nSport: NBA', {});
  read.facts.push({ id: 'f9', story: 's1', kind: 'meta', text: '4 stories', value: '4', label: 'stories', weight: 0 });
  const scene = COMPOSE.build('by-the-numbers', { headline: 'Lakers roll', numbers: [{ value: '4', label: 'stories', factId: 'f9' }, { value: '12-2', label: 'season Why fans', factId: 'f1' }, { value: '12-2', label: 'record', factId: 'f1' }], palette: COMPOSE.makePalette(['#552583', '#FDB927']) }, 0);
  const crit = C.codeCritique(scene, { story: 's1', archetype: 'by-the-numbers', headline: 'Lakers roll' }, read, {});
  assert.ok(crit.improvements.some(i => /not a stat about the story \(a coverage count\)/.test(i.text) && i.fix.op === 'remove' && i.fix.target.type === 'number'), 'remove the coverage count');
  const relabel = crit.improvements.find(i => /does not read as a stat label/.test(i.text));
  assert.ok(relabel && relabel.fix.op === 'text' && relabel.fix.text === 'SEASON', 'relabel to the noun phrase');
}

// ── 8. Memory: topics and the house lessons ──────────────────────────────
{
  assert.equal(M.topicOf('4 STORIES and 6 OUTLETS are coverage counts').id, 'stat-meaning');
  assert.equal(M.topicOf('The label SEASON WHY FANS is garbled').id, 'label-sense');
  assert.equal(M.topicOf('All three designs share the same dark tone').id, 'tone-monotone');
  assert.equal(M.topicOf('Bryson is named but no design leads with his cut-out').id, 'no-cutout');
  assert.equal(M.topicOf('The headline repeats the hero number').id, 'duplicate');
  assert.equal(M.topicOf('The photo is too dark behind the headline').id, 'photo-dark', 'existing topics unchanged');
  assert.ok(M.SEED_LESSONS.length >= 6);
  assert.ok(M.SEED_LESSONS.every(l => l.seed && l.kind === 'avoid' && l.text.length > 20));
  const learned = [{ id: 'L1', key: 'avoid:global:duplicate', text: 'Team: never repeat the number.', kind: 'avoid', topic: 'duplicate' }];
  const merged = M.withSeeds(learned, { limit: 10 });
  assert.equal(merged.filter(l => l.topic === 'duplicate').length, 1, 'a learned lesson replaces its seed');
  assert.equal(merged[0].id, 'L1', 'learned lessons first');
  const lines = M.promptLines(merged, { who: 'director' });
  assert.ok(lines.some(l => /ES house lessons/.test(l)) && lines.some(l => /Team lessons/.test(l)), 'house and team lessons under their own headings');
  assert.ok(!M.promptLines(M.withSeeds([]), { who: 'director' }).some(l => /Team lessons/.test(l)));
}

console.log(`gen-director: ${briefs.length} briefs, every failure class clear; director, judge, memory and asset-shape checks pass.`);
