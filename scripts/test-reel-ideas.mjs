#!/usr/bin/env node
// Reels ideas room (netlify/functions/_reel-ideas.js, mode "ideas" in
// reel-maker.js, the reel-ideas.js helpers and the sample data). Every network
// call is mocked (no ES site, no ES MCP, no ESPN, no AI, no Supabase):
//   gathering in parallel with soft failures and timeouts, the prompt (source
//   ids; trend ideas kept out of the facts), grounding (invented numbers and
//   quotes are downgraded or dropped, lenses must be earned, poll options carry
//   no numbers), free mode, the 30-minute cache, cost logging (reels-ideas,
//   reels-ideas-sonnet, cached system prompt), the plan built from an angle is
//   valid for ReelES and builds a timeline, ES coverage in a normal plan.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const authPath = path.join(fnDir, '_supabase-auth.js');
const esPath = path.join(fnDir, 'es-generate.js');
const trendPath = path.join(fnDir, 'trend-design.js');
const gamesPath = path.join(fnDir, '_reel-games.js');
process.env.AI_GATEWAY_API_KEY = 'gw-test';

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}

// ─── Mocks ────────────────────────────────────────────────────────────────
let weeklySpend = 0;
let usageRows = [];
let aiBodies = [];
let aiReply = () => { throw new Error('unexpected AI call'); };
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, 0);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_spend') || href.includes('/rest/v1/rpc/frameup_team_ai_spend')) return reply(200, [{ total_usd: weeklySpend }]);
  if (href.includes('/rest/v1/frameup_ai_usage')) { usageRows.push(JSON.parse(options.body)); return reply(201, {}); }
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) { const body = JSON.parse(options.body); aiBodies.push(body); return aiReply(body); }
  throw new Error(`unexpected fetch ${href}`);
};
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: () => 'tok',
  verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }),
} };

const ARTICLES = [
  { title: '"Absolutely a bad decision": Troy Aikman blasts Cowboys over Dak Prescott deal', url: 'https://www.essentiallysports.com/nfl-news-aikman-blasts-cowboys/', date: '2026-11-22', excerpt: 'The Hall of Famer did not hold back on the $60 million extension.', body: 'Troy Aikman said: "Absolutely a bad decision." Dallas gave Dak Prescott a $60 million extension. Prescott has thrown 24 touchdowns this season.', image: '' },
  { title: 'Cowboys fans turn against Jerry Jones after Eagles loss', url: 'https://www.essentiallysports.com/nfl-news-fans-turn/', date: '2026-11-21', excerpt: 'Fans booed at AT&T Stadium.', body: 'Fans booed as Dallas lost 31-17 to Philadelphia.', image: '' },
];
let esCalls = { coverage: 0, mcp: 0 };
let esBehaviour = 'ok'; // ok | throw | hang | empty
const esStub = {
  keyTerms: text => String(text).split(' ').slice(0, 3).join(' '),
  nameCandidates: () => ['Dak Prescott'],
  isEsUrl: url => /^https:\/\/www\.essentiallysports\.com\//.test(url),
  discover: async () => ({ mcp: { id: 'mcp' }, tools: { articles: { name: 'query_articles' } } }),
  queryEsArticles: async () => { esCalls.mcp += 1; if (esBehaviour !== 'ok') return []; return [{ title: ARTICLES[0].title, url: ARTICLES[0].url, date: '', excerpt: 'Sport: NFL.', image: '' }]; },
  esCoverage: async () => {
    esCalls.coverage += 1;
    if (esBehaviour === 'throw') throw new Error('ES site down');
    if (esBehaviour === 'hang') return new Promise(() => {});
    if (esBehaviour === 'empty') return { articles: [], tags: [] };
    return { articles: ARTICLES, tags: [] };
  },
};
require.cache[esPath] = { id: esPath, filename: esPath, loaded: true, exports: { esData: esStub } };
let trendBehaviour = 'ok';
const TREND_ITEM = { id: 't-dak', category: 'nfl', title: 'Cowboys give Dak Prescott a $60 million extension', url: 'https://news.example/dak', source: 'ESPN', publishedAt: new Date().toISOString(), team: { name: 'Dallas Cowboys' }, fit: { score: 85 }, rank: 2, related: [{ title: 'Prescott deal runs through 2029', url: 'https://news.example/2029', source: 'NFL.com' }] };
require.cache[trendPath] = { id: trendPath, filename: trendPath, loaded: true, exports: {
  getTrends: async () => { if (trendBehaviour === 'throw') throw new Error('feeds down'); return { updatedAt: 'now', items: [TREND_ITEM, { id: 't-nba', category: 'others', title: 'Lakers trade for a new center', related: [], rank: 1, fit: { score: 35 } }, { id: 't-ten', category: 'tennis', title: 'Coco Gauff wins in Riyadh', related: [], rank: 1.5 }] }; },
  cachedEnrichment: id => (id === 't-dak' ? { why: 'Fans care about the cap', titles: [], hook: 'Dak got paid', angle: { lens: 'money', line: 'An invented 999 million angle' } } : null),
} };
let gamesBehaviour = 'ok';
require.cache[gamesPath] = { id: gamesPath, filename: gamesPath, loaded: true, exports: {
  listGames: async () => { if (gamesBehaviour === 'throw') throw new Error('espn'); return { ok: true, games: [{ id: 'g', startsAt: '2026-11-20T18:00Z', status: { final: true }, teams: { home: { name: 'Dallas Cowboys', score: 17 }, away: { name: 'Philadelphia Eagles', score: 31 } } }] }; },
  athlete: async body => (body.athleteId
    ? { ok: true, athlete: { name: 'Dak Prescott', source: { url: 'https://espn.example/dak' }, stats: { category: 'passing', labels: ['YDS', 'TD'], seasons: [{ year: 2026, team: 'dallas-cowboys', stats: ['3,105', '24'] }], totals: ['35,000', '251'] } } }
    : { ok: true, candidates: [{ athleteId: '1', name: 'Dak Prescott' }] }),
  gameData: async () => ({ ok: false }), cachedDigest: () => null, teamHandles: () => ({}),
} };

const gateway = require('../netlify/functions/_ai-gateway.js');
const I = require('../netlify/functions/_reel-ideas.js');
const { handler, _test: RM } = require('../netlify/functions/reel-maker.js');
const ES = require('../reel-es.js');
const F = require('../reel-formats.js');
const R = require('../reel-render.js');
const CORE = require('../reel-ideas.js');
const SAMPLE = require('../reel-b-sample.js');
const { lintPlan } = require('../netlify/functions/_reel-lint.js');

const call = async body => { const res = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer good' }, body: JSON.stringify(body) }); return { status: res.statusCode, body: JSON.parse(res.body) }; };
const end = { vo: '', block: { type: 'endcard' } };
const hook = (a, b) => ({ text: `${a} ${b}`, vo: 'Dallas just made its call on Dak Prescott, and the fans have plenty to say about it.', block: { type: 'hook', pills: [{ text: a, color: 'ink' }, { text: b, color: 'blue' }] } });
const say = (text, vo) => ({ text, vo, block: { type: 'statement', lines: [{ text: text.toUpperCase(), color: 'ink' }] } });
const GOOD = {
  angles: [
    { lens: 'money', angle: 'The $60 million question Dallas now has to answer', title: 'The $60 million question', recipe: 'money-story', sources: ['a1', 't1', 'zz9'],
      beats: [hook('$60 MILLION.', 'ONE ARM.'), { text: 'The extension', vo: 'Dallas gave Dak Prescott a $60 million extension.', block: { type: 'number', kicker: 'THE EXTENSION', value: 60, prefix: '$', suffix: 'M', label: 'FOR DAK', color: 'green' } }, say('Fans are split', 'Cowboys fans are split on what comes next for this team.'), say('Now earn it', 'Now Prescott has to earn it on the field, every single week.'), end],
      poll: { question: 'Is Dak worth it?', options: ['Worth it', 'Overpaid', '60 million no', 'Worth it'] } },
    { lens: 'quote-led', angle: '"Absolutely a bad decision": Aikman blasts the Cowboys', title: 'Aikman blasts Dallas', recipe: 'quote-reaction', sources: ['a1'],
      beats: [hook('A LEGEND', 'UNLOADS.'), { text: 'Absolutely a bad decision', vo: 'Troy Aikman did not hold back when he was asked about it.', block: { type: 'quote', text: 'Absolutely a bad decision', who: 'TROY AIKMAN' } }, say('Fans booed', 'Fans booed inside the stadium as Dallas lost to Philadelphia.'), say('Who is right', 'So who is right, the legend or the front office?'), end],
      poll: { question: 'Is Aikman right?', options: ['Spot on', 'Way off'] } },
    // Invented number on a number card, clean headline -> downgraded to a statement.
    { lens: 'fan-reaction', angle: 'Cowboys fans turn on Jerry Jones', title: 'Fans turn', recipe: 'fan-pulse', sources: ['a2'],
      beats: [hook('FANS HAVE', 'HAD ENOUGH.'), { text: 'The boos got loud', vo: 'The boos got loud inside the stadium on Sunday.', block: { type: 'number', kicker: 'BOOS', value: 87000, label: 'FANS', color: 'red' } }, say('They lost again', 'Dallas lost 31-17 to Philadelphia, and the fans let them hear it.'), say('Jerry feels it', 'Jerry Jones is feeling the heat from his own crowd now.'), end],
      poll: { question: 'Are the fans right?', options: ['Yes', 'No'] } },
    // An invented quote: the quote-led lens is not earned -> dropped. (Same lens as above anyway.)
    { lens: 'verdict', angle: 'Aikman rules on the deal', title: 'The verdict', recipe: 'verdict', sources: ['a1'],
      beats: [hook('THE VERDICT', 'IS IN.'), { text: '"He is finished in Dallas"', vo: 'Aikman said "He is finished in Dallas" on air.', block: { type: 'quote', text: 'He is finished in Dallas', who: 'TROY AIKMAN' } }, { text: 'Worth 250 million', vo: 'That is a 250 million dollar mistake.', block: { type: 'statement', lines: [{ text: '$250 MILLION', color: 'red' }] } }, say('A cold take', 'It is a cold take from a man who knows the building.'), end],
      poll: { question: 'Agree?', options: ['Yes', 'No'] } },
    // Hook with an invented number -> the angle is dropped.
    { lens: 'behind-the-moment', angle: 'Behind the deal', title: 'Behind it', recipe: 'explainer', sources: ['t1'],
      beats: [{ text: '72 hours of talks', vo: 'It took 72 hours of talks.', block: { type: 'hook', pills: [{ text: '72 HOURS.', color: 'ink' }] } }, say('One', 'One more line about the deal for the fans.'), say('Two', 'And a second line about the deal for the fans.'), end] },
  ],
};
const haiku = text => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 4500, output_tokens: 3000 }, content: [{ type: 'text', text }] });
const reset = () => { I.CACHE.clear(); usageRows = []; aiBodies = []; esCalls = { coverage: 0, mcp: 0 }; esBehaviour = 'ok'; trendBehaviour = 'ok'; gamesBehaviour = 'ok'; weeklySpend = 0; aiReply = () => haiku(JSON.stringify(GOOD)); };
const TOPIC = 'Dak Prescott and the Dallas Cowboys extension';

await test('gather: ES most-read + coverage, the trend, a final and player stats, each as a cited source', async () => {
  reset();
  const g = await I.gather(I.readInput({ topic: TOPIC, sport: 'nfl', trend: { id: 't-dak', title: TREND_ITEM.title, sport: 'nfl' } }), { auth: { user: { email: 'a@essentiallysports.com' } } });
  const types = g.sources.map(s => `${s.id}:${s.type}`);
  assert.deepEqual(types, ['b1:brief', 't1:trend', 'n1:news', 'a1:es', 'a2:es', 'g1:game', 'p1:player']);
  assert.equal(g.sources.find(s => s.id === 'a1').mostRead, true, 'the MCP record (ranked by page views) is marked most read');
  assert.equal(g.sources.find(s => s.id === 'a1').date, '2026-11-22', 'and takes its date and body from the tagged coverage');
  assert.match(g.corpus, /Absolutely a bad decision/);
  assert.match(g.corpus, /Philadelphia Eagles 31, Dallas Cowboys 17/);
  assert.match(g.corpus, /YDS 3,105, TD 24/);
  assert.ok(!/999/.test(g.corpus), 'the trend\'s AI angle is an idea, never a fact');
  assert.equal(g.trendIdeas.angle.lens, 'money');
  assert.equal(g.steps.factCheck.skipped, true, 'no fact check unless asked');
  assert.equal(g.fit, 85);
});

await test('gather: every step fails softly (errors and timeouts), inside its own budget', async () => {
  reset();
  esBehaviour = 'hang'; trendBehaviour = 'throw'; gamesBehaviour = 'throw';
  const keep = { ...I.STEP_MS };
  I.STEP_MS.es = 60;
  const started = Date.now();
  const g = await I.gather(I.readInput({ topic: TOPIC, sport: 'nfl' }), {});
  Object.assign(I.STEP_MS, keep);
  assert.ok(Date.now() - started < 1500, 'a hanging source does not hold the run');
  assert.equal(g.steps.es.ok, false);
  assert.equal(g.steps.es.reason, 'timeout');
  assert.equal(g.steps.trend.ok, false);
  assert.equal(g.steps.games.count, 0);
  assert.deepEqual(g.sources.map(s => s.type).filter(t => t !== 'player'), ['brief']);
  const out = await I.run({ topic: TOPIC, sport: 'nfl' }, { blocked: 'off' });
  assert.equal(out.ok, true, 'and the run still answers');
});

await test('prompt: sources by id, the newsletter, trend ideas marked as not facts; the system prompt carries the ES angle and blocks', async () => {
  reset();
  const input = I.readInput({ topic: TOPIC, sport: 'nfl', steer: 'keep it calm' });
  const g = await I.gather(input, {});
  const req = I.ideasRequest(input, g, new Date('2026-11-25T00:00:00Z'));
  assert.match(req, /\[a1\] ES article, most read \(2026-11-22\)/);
  assert.match(req, /\[g1\] game result/);
  assert.match(req, /newsletter: The Huddle/);
  assert.match(req, /TREND IDEAS \(direction only, not facts\)/);
  assert.match(req, /EDITOR NOTE: keep it calm/);
  for (const word of ['moments behind the moment', 'Quote-led', 'Verdict', 'Money', 'Fan reaction', 'Essentially Dunk', 'Break Point', 'Lucky Dog', 'Essentially CFB', 'Essentially Golf', '"type":"hook"', '"type":"endcard"']) assert.ok(I.IDEAS_SYSTEM.includes(word), `system prompt has ${word}`);
  for (const lens of I.LENSES) assert.ok(I.IDEAS_SYSTEM.includes(lens));
  for (const recipe of I.RECIPES) assert.ok(I.IDEAS_SYSTEM.includes(recipe));
  assert.ok(I.IDEAS_SYSTEM.length >= gateway.CACHE_MIN_CHARS, 'long enough to be cached');
});

await test('grounding: invented numbers and quotes are downgraded or dropped; lenses are earned; polls carry no numbers', async () => {
  reset();
  const out = await I.run({ topic: TOPIC, sport: 'nfl' }, { track: { email: 'a@essentiallysports.com', token: 'tok' } });
  assert.equal(out.source, 'ai');
  assert.deepEqual(out.angles.map(a => a.lens), ['money', 'quote-led', 'fan-reaction']);
  const [moneyA, quote, fans] = out.angles;
  assert.equal(moneyA.plan.beats[1].block.type, 'number');
  assert.equal(moneyA.plan.beats[1].block.value, 60);
  assert.deepEqual(moneyA.sources, ['a1', 't1'], 'unknown source ids are removed');
  assert.deepEqual(moneyA.poll.options, ['Worth it', 'Overpaid'], 'options with numbers and repeats are removed');
  assert.equal(quote.plan.beats[1].block.type, 'quote');
  assert.equal(quote.plan.beats[1].quote.text, 'Absolutely a bad decision');
  assert.match(quote.storyboard[1].text, /“Absolutely a bad decision”, TROY AIKMAN/);
  // The invented 87,000 card became a plain statement from its own clean headline.
  assert.equal(fans.downgraded, 1);
  assert.equal(fans.plan.beats[1].block.type, 'statement');
  assert.ok(!JSON.stringify(fans.plan).includes('87'), 'the invented number is nowhere in the plan');
  assert.ok(fans.issues.some(i => /87000.*plain statement/.test(i)));
  assert.equal(fans.plan.beats[2].vo.includes('31-17'), true, 'a sourced score stays');
  // Dropped: the invented quote + number (most of it unsourced), and the hook with an invented number.
  assert.equal(out.dropped.length, 2);
  assert.ok(out.dropped.some(d => /Verdict/.test(d)));
  assert.ok(out.dropped.some(d => /Behind the moment.*hook/.test(d)));
  const all = JSON.stringify(out.angles);
  assert.ok(!all.includes('finished in Dallas') && !all.includes('250') && !all.includes('72 HOURS'));
});

await test('grounding units: quotes must be exact; a quote-led angle without a real quote and a money angle without a figure are dropped', async () => {
  reset();
  const g = await I.gather(I.readInput({ topic: TOPIC, sport: 'nfl' }), {});
  const near = I.groundBeat({ text: 'A bad call', vo: 'Aikman called it out.', block: { type: 'quote', text: 'Absolutely a terrible decision', who: 'TROY AIKMAN' } }, I._test.makeChecker(g.corpus), 1);
  assert.equal(near.downgraded, true, 'a paraphrase is not a quote');
  assert.equal(near.beat.block.type, 'statement');
  const inVo = I.groundBeat({ text: 'He said it', vo: 'He said "this team is lost" on air.', block: { type: 'statement', lines: [{ text: 'HE SAID IT' }] } }, I._test.makeChecker(g.corpus), 1);
  assert.equal(inVo.dropped, true, 'invented quoted words in the voiceover drop the beat');
  const q = I.groundAngle({ lens: 'quote-led', angle: 'x', beats: [hook('HE SAID', 'IT ALL.'), say('One line', 'One line about the story for fans today.'), say('Two lines', 'A second line about the story for fans today.'), end] }, g);
  assert.equal(q.angle, null);
  assert.match(q.why, /Quote led/);
  const m = I.groundAngle({ lens: 'money', angle: 'x', beats: [hook('THE MONEY', 'TALKS.'), say('One line', 'One line about the story for fans today.'), say('Two lines', 'A second line about the story for fans today.'), end] }, g);
  assert.equal(m.angle, null);
  assert.equal(I.groundAngle({ lens: 'nonsense', beats: [] }, g).angle, null);
  assert.equal(I.cleanPoll({ question: 'Will he get 99 touchdowns?', options: ['Yes', 'No'] }, I._test.makeChecker(g.corpus)), null, 'a poll question with an unsourced number is removed');
  assert.deepEqual(I.cleanPoll({ question: 'Who wins', options: ['Dallas', 'Top 5', 'Philly'] }, I._test.makeChecker(g.corpus)), { question: 'Who wins?', options: ['Dallas', 'Philly'] });
});

await test('the plan built from an angle is valid for ReelES, lints clean on numbers and builds a timeline', async () => {
  reset();
  const out = await I.run({ topic: TOPIC, sport: 'nfl' }, {});
  for (const angle of out.angles) {
    const plan = angle.plan;
    assert.equal(plan.style, 'es');
    assert.equal(plan.lens, angle.lens);
    assert.ok(I.RECIPES.includes(plan.recipe));
    assert.equal(plan.beats[0].block.type, 'hook');
    assert.equal(ES.blockOf(plan.beats[plan.beats.length - 1]).type, 'endcard');
    const sourceSet = F.numberSet(out.corpus);
    plan.beats.forEach(beat => {
      assert.ok(F.KINDS.includes(beat.kind));
      if (beat.block) {
        assert.deepEqual(ES.cleanBlock(beat.block), beat.block, 'blocks carry exactly their fields');
        assert.equal(ES.KIND_FOR[beat.block.type], beat.kind);
      }
      assert.deepEqual(F.unsourcedNumbers(beat, sourceSet, plan.format), []);
    });
    const lint = lintPlan(plan, { corpus: out.corpus });
    assert.ok(!(lint.issues || []).some(i => i.level === 'error' && /source|number|quote/i.test(i.message || i.text || '')), 'no provenance errors');
    const tl = R.buildTimeline(JSON.parse(JSON.stringify(plan)), { style: 'es' });
    assert.ok(tl && tl.beats.length === plan.beats.length, 'the renderer builds it');
    // The page's applyPlan input.
    const data = CORE.applyData(angle, out);
    assert.deepEqual(data.plan, plan);
    assert.notEqual(data.plan, plan, 'a copy, so the card stays as it was');
    assert.equal(data.source, 'director');
    assert.ok(data.sources.length && data.sources.every(s => ['news', 'trend', 'brief', 'game', 'player', 'fact-check'].includes(s.type)));
    assert.equal(data.corpus, out.corpus);
  }
});

await test('free mode: template angles per lens from ES titles and facts, labelled, no AI call', async () => {
  reset();
  aiReply = () => { throw new Error('no AI in free mode'); };
  for (const blocked of ['free', 'off', 'weekly-limit', 'limit']) {
    const out = await I.run({ topic: TOPIC, sport: 'nfl' }, { blocked });
    assert.equal(out.ok, true);
    assert.equal(out.free, true);
    assert.equal(out.source, 'free');
    assert.equal(out.cost, 0);
    assert.ok(out.angles.length >= 3, `${blocked}: ${out.angles.length} drafts`);
    assert.ok(out.angles.every(a => a.free === true && a.plan.beats[0].block.type === 'hook'));
    if (blocked !== 'free') assert.match(out.notice, /free drafts/);
  }
  const out = await I.run({ topic: TOPIC, sport: 'nfl' }, { blocked: 'off' });
  const lenses = out.angles.map(a => a.lens);
  assert.ok(lenses.includes('fan-first') && lenses.includes('quote-led') && lenses.includes('money'), lenses.join());
  const quote = out.angles.find(a => a.lens === 'quote-led').plan.beats.find(b => b.block && b.block.type === 'quote');
  assert.equal(quote.block.text, 'Absolutely a bad decision', 'an exact quote found in the sources');
  assert.equal(quote.block.who, 'VIA ESSENTIALLYSPORTS', 'attributed to the coverage, never to a guessed speaker');
  const fig = out.angles.find(a => a.lens === 'money').plan.beats.find(b => b.block && b.block.type === 'number');
  assert.equal(fig.block.value, 60);
  assert.equal(aiBodies.length, 0);
  assert.equal(I.CACHE.size, 0, 'free drafts are not cached');
  // Nothing found at all: still a draft from the topic itself.
  esBehaviour = 'empty'; trendBehaviour = 'throw'; gamesBehaviour = 'throw';
  const bare = await I.run({ topic: 'A quiet story with no coverage' }, { blocked: 'off' });
  assert.equal(bare.ok, true);
  assert.ok(Array.isArray(bare.angles));
});

await test('AI failure or ideas that do not hold up fall back to free drafts (the spend is still reported)', async () => {
  reset();
  aiReply = () => reply(500, { error: { message: 'boom' } });
  const failed = await I.run({ topic: TOPIC, sport: 'nfl' }, { track: { email: 'a@essentiallysports.com', token: 'tok' } });
  assert.equal(failed.free, true);
  assert.equal(failed.reason, 'error');
  reset();
  aiReply = () => haiku(JSON.stringify({ angles: [GOOD.angles[4]] }));
  const weak = await I.run({ topic: TOPIC, sport: 'nfl' }, { track: { email: 'a@essentiallysports.com', token: 'tok' } });
  assert.equal(weak.free, true);
  assert.equal(weak.reason, 'weak');
  assert.ok(weak.cost > 0, 'the call that was made is reported');
  assert.equal(weak.dropped.length, 1);
});

await test('handler: mode ideas is gated, logged as reels-ideas with a cached system prompt, and cached for 30 minutes', async () => {
  reset();
  const first = await call({ mode: 'ideas', topic: TOPIC, sport: 'nfl' });
  assert.equal(first.status, 200);
  assert.equal(first.body.source, 'ai');
  assert.equal(first.body.angles.length, 3);
  assert.equal(aiBodies.length, 1, 'one AI call');
  assert.equal(aiBodies[0].model, gateway.MODELS.main);
  assert.equal(aiBodies[0].system[0].cache_control.type, 'ephemeral', 'the system prompt is cached');
  const row = usageRows.find(x => x.feature === 'reels-ideas');
  assert.ok(row && row.ok, 'logged as reels-ideas');
  assert.equal(row.model, gateway.MODELS.main);
  // 4,500 in + 3,000 out on Haiku: the price shown in the UI is honest.
  assert.ok(Math.abs(first.body.cost - 0.00195) < 1e-6, `cost ${first.body.cost}`);
  assert.ok(first.body.cost <= I.PRICES.main + 1e-9);
  assert.deepEqual(first.body.prices, { ...I.PRICES });
  assert.deepEqual({ ...I.PRICES }, CORE.PRICES, 'the page shows the server\'s prices');
  const again = await call({ mode: 'ideas', topic: TOPIC, sport: 'nfl' });
  assert.equal(again.body.cached, true);
  assert.equal(again.body.cost, 0);
  assert.equal(aiBodies.length, 1, 'no second AI call');
  assert.equal(esCalls.coverage, 1, 'and no second gathering');
  // After 30 minutes the cache is cold.
  const key = [...I.CACHE.keys()][0];
  I.CACHE.get(key).at -= I.CACHE_TTL_MS + 1000;
  await call({ mode: 'ideas', topic: TOPIC, sport: 'nfl' });
  assert.equal(aiBodies.length, 2);
  // Sonnet on request: its own feature and model.
  const best = await call({ mode: 'ideas', topic: TOPIC, sport: 'nfl', tier: 'best' });
  assert.equal(aiBodies[2].model, gateway.MODELS.best);
  assert.ok(usageRows.some(x => x.feature === 'reels-ideas-sonnet'));
  assert.ok(best.body.cost <= I.PRICES.best + 1e-9, `sonnet cost ${best.body.cost}`);
  assert.equal((await call({ mode: 'ideas', topic: 'x' })).status, 400);
});

await test('handler: over the weekly budget -> free drafts, no AI call, no error', async () => {
  reset();
  weeklySpend = 999;
  const out = await call({ mode: 'ideas', topic: TOPIC, sport: 'nfl' });
  assert.equal(out.status, 200);
  assert.equal(out.body.free, true);
  assert.ok(out.body.angles.length >= 3);
  assert.equal(aiBodies.length, 0);
  assert.equal(usageRows.length, 0);
});

await test('fact check: only when asked, capped, its cost reported apart', async () => {
  reset();
  let asked = 0;
  const keep = gateway.aiWebResearch;
  gateway.aiWebResearch = async opts => { asked += 1; assert.equal(opts.maxCostUsd, 0.03); return { text: 'Prescott signed on Monday for 4 years.', urls: [{ url: 'https://nfl.example/x', title: 'NFL' }], cost: 0.02 }; };
  const off = await I.run({ topic: TOPIC, sport: 'nfl' }, {});
  assert.equal(asked, 0);
  I.CACHE.clear();
  const on = await I.run({ topic: TOPIC, sport: 'nfl', factCheck: true }, {});
  gateway.aiWebResearch = keep;
  assert.equal(asked, 1);
  assert.ok(on.sources.some(s => s.type === 'fact-check'));
  assert.equal(on.costs.factCheck, 0.02);
  assert.ok(on.cost > off.cost);
  assert.equal(I.PRICES.factCheckCap, 0.03);
});

await test('normal plan(): ES coverage joins the sources (soft-fail, inside 4,000 characters of facts)', async () => {
  reset();
  aiReply = () => haiku(JSON.stringify({ format: 'explainer', title: 'T', beats: [] }));
  const es = await I.esSources('Dak Prescott Cowboys extension', {});
  assert.equal(es.sources.length, 2);
  assert.match(es.text, /ES article \(2026-11-22\).*Absolutely a bad decision/);
  assert.ok(es.text.length <= 3600);
  const out = await call({ mode: 'plan', brief: 'Dak Prescott signed a $60 million extension with the Dallas Cowboys this week.', format: 'explainer' });
  assert.equal(out.status, 200);
  assert.ok(out.body.sources.some(s => s.type === 'es' && /essentiallysports\.com/.test(s.url)), 'ES articles are listed as sources');
  assert.match(out.body.corpus, /Absolutely a bad decision/, 'and their text is in the corpus the checks use');
  assert.match(aiBodies[0].messages[0].content, /ES article/, 'the director sees them');
  // A miss or a slow ES site never blocks the plan.
  RM.PLAN_CACHE.clear();
  esBehaviour = 'throw';
  const miss = await call({ mode: 'plan', brief: 'Dak Prescott signed a $60 million extension with the Dallas Cowboys this week.', format: 'explainer' });
  assert.equal(miss.status, 200);
  assert.ok(!miss.body.sources.some(s => s.type === 'es'));
  esBehaviour = 'hang';
  const slow = await I.esSources('Dak Prescott Cowboys extension', { budgetMs: 40 });
  assert.deepEqual(slow.sources, []);
  // Over a cap: no ES call at all.
  RM.PLAN_CACHE.clear(); esBehaviour = 'ok'; esCalls.coverage = 0; weeklySpend = 999;
  await call({ mode: 'plan', brief: 'Dak Prescott signed a $60 million extension with the Dallas Cowboys this week.', format: 'explainer' });
  assert.equal(esCalls.coverage, 0);
});

await test('trends: NBA and tennis join the list, with ES fit and the cached ES angle', async () => {
  reset();
  const out = await call({ mode: 'trends' });
  const by = Object.fromEntries(out.body.items.map(i => [i.id, i]));
  assert.equal(by['t-dak'].sport, 'nfl');
  assert.equal(by['t-dak'].fit, 85);
  assert.equal(by['t-dak'].angle.lens, 'money');
  assert.equal(by['t-nba'].sport, 'nba', 'picked out of "others" by league words');
  assert.equal(by['t-ten'].sport, 'tennis');
  assert.equal(out.body.counts.nba, 1);
  assert.deepEqual(out.body.sports, ['nfl', 'cfb', 'mlb', 'golf', 'tennis', 'nba', 'wnba', 'nascar']);
  assert.equal(RM.trendSport({ category: 'others', title: 'NASCAR Cup Series finale set', related: [] }), 'nascar');
  assert.equal(RM.trendSport({ category: 'others', title: 'Caitlin Clark returns', related: [] }), 'wnba');
  assert.equal(RM.trendSport({ category: 'others', title: 'Messi scores twice', related: [] }), 'others');
});

await test('page helpers and sample data: cost line, demo hosts, sample plans are valid ES plans', async () => {
  assert.equal(CORE.isDemo({ hostname: 'localhost', search: '' }), true);
  assert.equal(CORE.isDemo({ hostname: '127.0.0.1', search: '' }), true);
  assert.equal(CORE.isDemo({ hostname: 'localhost', search: '?demo=off' }), false);
  assert.equal(CORE.isDemo({ hostname: 'frameup.essentiallysports.com', search: '?demo=reels' }), false, 'never on production');
  assert.equal(CORE.isDemo({ hostname: 'frameup.essentiallysports.com', search: '' }), false);
  assert.equal(CORE.isDemo({ hostname: 'preview-abc.vercel.app', search: '?demo=reels' }), true);
  assert.match(CORE.costLine({}), /About \$0\.002 per run/);
  assert.match(CORE.costLine({ best: true, factCheck: true }), /About \$0\.04 per run, plus up to \$0\.03 for the fact check/);
  assert.match(CORE.costLine({ demo: true }), /no cost/);
  assert.match(CORE.costLine({ ai: false }), /free drafts/);
  assert.equal(CORE.gatherLine({ steps: { es: { ok: true, count: 3 }, trend: { ok: false }, games: { ok: true, skipped: true } } }), 'ES articles: 3 · Trend headlines: not reachable');
  for (const state of ['live', 'free', 'over', 'empty']) {
    const s = SAMPLE.ideas({ state });
    assert.equal(s.sample, true);
    assert.equal(s.cost, 0);
    if (state === 'empty') { assert.equal(s.angles.length, 0); continue; }
    const set = F.numberSet(s.corpus);
    s.angles.forEach(a => {
      assert.equal(a.free, state !== 'live');
      a.plan.beats.forEach(b => { assert.deepEqual(ES.cleanBlock(b.block), b.block); assert.deepEqual(F.unsourcedNumbers(b, set, 'explainer'), [], `${a.lens}: ${b.text}`); });
      assert.ok(R.buildTimeline(CORE.applyData(a, s).plan, { style: 'es' }).beats.length >= 4);
    });
  }
});

console.log(process.exitCode ? '\nSome reel ideas tests failed.' : `\nAll ${passed} reel ideas tests passed.`);
