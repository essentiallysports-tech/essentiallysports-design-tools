// Generate's creative director (netlify/functions/_creative-director.js):
// reading the brief in code, validating the model's concepts (never trusted),
// and failing soft (no concepts = the old single-call path). Network mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
// The Sonnet-first scenarios below pin the tier (the default is now auto).
process.env.GENERATE_DIRECTOR_MODEL = process.env.GENERATE_DIRECTOR_MODEL || 'best';

const require = createRequire(import.meta.url);
process.env.AI_GATEWAY_API_KEY = 'gw-test';
const gen = require('../netlify/functions/es-generate.js');
const director = require('../netlify/functions/_creative-director.js');
const { readBrief, TEMPLATES, directorAllowed, DIRECTOR_START_BY_MS } = gen._test;
const { validateConcepts, runDirector, conceptsBlock, DIRECTOR_SYSTEM, directorRequest, directorTier } = director;

// ─── 1. readBrief ──────────────────────────────────────────────────────────
// A quote brief: the quote, its stats, the team named in the brief.
let read = readBrief('Mahomes after the Chiefs win: "We are not done yet." 320 YDS, 3 TD, 1 INT', { tags: [], articles: [] }, []);
assert.equal(read.kind, 'quote');
assert.equal(read.quote, 'We are not done yet.');
assert.equal(read.sport, 'NFL', 'the sport comes from the team named in the brief');
assert.match(read.team, /chiefs/i);
assert.deepEqual(read.stats.map(stat => stat.label), ['YDS', 'TD', 'INT']);
assert.equal(read.fits.quote, true);
assert.equal(read.fits['stats-single-ent'], true);
assert.equal(read.fits['listicle-type-1'], false);

// A stats brief: three real stats; the opponent ("against the Sky") is never
// the team, the newest tagged ES story gives the current team instead.
const clarkFound = {
  tags: [{ name: 'Caitlin Clark' }],
  articles: [
    { title: 'Caitlin Clark story with the Iowa Hawkeyes', excerpt: '', date: '2024-03-01', url: 'https://www.essentiallysports.com/a/' },
    { title: 'Caitlin Clark story with the Indiana Fever', excerpt: 'Clark and the Fever.', date: '2026-11-12', url: 'https://www.essentiallysports.com/wnba-news-b/' },
  ],
};
read = readBrief('Caitlin Clark scores 30 PTS 9 AST 6 REB against the Sky', clarkFound, []);
assert.equal(read.kind, 'stats');
assert.deepEqual(read.subjects, ['Caitlin Clark']);
assert.equal(read.team, 'Indiana Fever', 'the newest story about her names her current team');
assert.equal(read.sport, 'WNBA');
assert.equal(read.has.statsCount, 3);
assert.equal(read.fits['stats-single-ent'], true);
assert.equal(read.fits.quote, false, 'no quote: no quote templates');
assert.equal(read.fits['stats-double-ent'], false);

// A team named in the brief beats the research.
read = readBrief('Caitlin Clark and the Fever: "We are building something special."', { tags: [{ name: 'Caitlin Clark' }], articles: [clarkFound.articles[0]] }, []);
assert.equal(read.team, 'Indiana Fever');

// A pasted table is a ranking.
read = readBrief('TOP 3 RUSHING YARDS\nRank\nPlayer\nTeam\nYards\n1\nDerrick Henry\nRavens\n1,120\n2\nSaquon Barkley\nEagles\n1,050\n3\nJosh Jacobs\nPackers\n980', {}, []);
assert.equal(read.kind, 'ranking');
assert.equal(read.table, true);
assert.equal(read.fits['listicle-type-1'], true);
assert.equal(read.fits['listicle-type-2'], true);

// A Trend Design brief: the headline, the labelled sport, the team.
read = readBrief('Headline: Are The Lakers Already Cooked?\nStory: Lakers drop fifth straight as LeBron James sits\nSport: NBA', {}, []);
assert.equal(read.kind, 'headline');
assert.equal(read.trendHeadline, 'Are The Lakers Already Cooked?');
assert.equal(read.sport, 'NBA');
assert.match(read.team, /lakers/i);
assert.equal(read.has.headline, true);

// An instruction: its numbers come from the ES research.
read = readBrief("make a stats post on Mahomes' last game", { digest: 'Mahomes threw for 320 yards, 3 touchdowns and 1 interception.' }, []);
assert.equal(read.kind, 'instruction');
assert.equal(read.instruction, true);
assert.deepEqual(read.stats.map(stat => `${stat.value} ${stat.label}`), ['320 YDS', '3 TD', '1 INT']);
assert.equal(read.fits['stats-single-ent'], true);

// Fits are ANDed with the formats the editor asked for.
read = readBrief('Mahomes after the Chiefs win: "We are not done yet." 320 YDS, 3 TD, 1 INT', {}, ['cover']);
assert.deepEqual(Object.entries(read.fits).filter(([, ok]) => ok).map(([type]) => type), ['cover']);

// ─── 2. validateConcepts ───────────────────────────────────────────────────
const brief = 'Caitlin Clark after the Fever beat the Sky: "We are building something special." 30 PTS 9 AST 6 REB';
const corpus = 'Caitlin Clark scored 30 points as the Indiana Fever beat the Chicago Sky.';
read = readBrief(brief, clarkFound, []);
const concept = extra => ({
  postType: 'cover', angle: 'Clark is building a dynasty', hook: 'claim', emotion: 'hype', headlineIdea: 'Built Different',
  layout: '2 pills', factsUsed: ['Fever beat the Sky'], photo: { query: 'Caitlin Clark Fever', shot: 'celebration' }, team: 'Fever', palette: 'auto', rationale: 'Big claim.', ...extra,
});
const valid = parsed => validateConcepts(parsed, { read, allowedTypes: [], want: 4, brief, corpus, templates: TEMPLATES });

let concepts = valid({ concepts: [
  concept({ postType: 'stats-single-ent', hook: 'reaction', angle: 'No one can guard Clark right now', factsUsed: ['30 PTS', '9 AST', '6 REB'] }),
  concept({ postType: 'listicle-type-1', angle: 'A ranking nobody asked for' }), // not fitting (no table)
  concept({ postType: 'quote', hook: 'quote', angle: 'Her own words say it all', factsUsed: ['We are building something special'] }),
  concept({ postType: 'quote', hook: 'quote', angle: 'Something else from her quote' }), // same postType|hook
  concept({ angle: 'Clark is building a dynasty here', hook: 'question' }), // first cover
  concept({ angle: 'Clark is building a dynasty here now', hook: 'reaction' }), // near-duplicate angle
  concept({ postType: 'stats-single-ent', hook: 'numbers', angle: 'Numbers that are made up', factsUsed: ['41 PTS', '12 AST', '6 REB'] }), // invented facts
  concept({ postType: 'banner', angle: 'Not a template we have' }),
  concept({ angle: 'x' }), // angle too short
  concept({ angle: 'Who stops the Fever in October?', hook: 'mystery', emotion: 'chaos', palette: 'neon', photo: { query: 'Caitlin Clark', shot: 'blurry' } }),
] });
assert.deepEqual(concepts.map(c => c.postType), ['stats-single-ent', 'quote', 'cover', 'cover']);
assert.deepEqual(concepts.map(c => c.id), ['c1', 'c2', 'c3', 'c4'], 'ids are reassigned in order');
assert.deepEqual(concepts[0].factsUsed, ['30 PTS', '9 AST', '6 REB']);
assert.equal(concepts[2].team, 'Indiana Fever', 'the team resolves to the brand-kit name');
const odd = concepts[3];
assert.equal(odd.hook, 'claim', 'an unknown hook falls back to claim');
assert.equal(odd.emotion, '');
assert.equal(odd.palette, 'auto');
assert.equal(odd.photo.shot, 'any');
assert.deepEqual(odd.factsUsed, ['Fever beat the Sky']);
assert.equal(valid({ concepts: [concept({ factsUsed: ['Clark won MVP twice'] })] })[0].factsUsed.length, 0, 'invented facts are dropped');
// The 4th cover-claim is a dup of postType|hook; capped at want.
assert.equal(validateConcepts({ concepts: [
  concept({ angle: 'Clark is built different now' }), concept({ angle: 'Who can stop this Fever team?', hook: 'question' }),
  concept({ angle: 'Fever fans should be thrilled', hook: 'reaction' }), concept({ angle: 'This rivalry has one winner', hook: 'numbers' }),
] }, { read, want: 2, brief, corpus, templates: TEMPLATES }).length, 2, 'caps at want');
// Only covers fit: up to 3, each a different hook.
const coverOnly = { ...read, fits: { ...read.fits, quote: false, 'long-quote': false, 'stats-single-ent': false } };
assert.equal(validateConcepts({ concepts: [
  concept({ angle: 'Clark is built different now' }), concept({ angle: 'Who can stop this Fever team?', hook: 'question' }),
  concept({ angle: 'Fever fans should be thrilled', hook: 'reaction' }), concept({ angle: 'This rivalry has one clear winner', hook: 'debate' }),
] }, { read: coverOnly, want: 4, brief, corpus, templates: TEMPLATES }).length, 3, 'at most 3 covers when only covers fit');
assert.equal(valid({ concepts: [concept({ postType: 'cover' })] }).length, 1);
assert.equal(validateConcepts({ concepts: [concept({ postType: 'cover' })] }, { read, allowedTypes: ['quote'], want: 4, brief, corpus, templates: TEMPLATES }).length, 0, 'a template the editor did not ask for drops');
assert.deepEqual(valid(null), []);
assert.deepEqual(valid({ concepts: 'nope' }), []);

// The writer block lists each concept with its id, angle and facts.
const block = conceptsBlock(concepts.slice(0, 2), 4, ['ES Covers here run 2 pills of about 12 characters.']);
assert.match(block, /^Creative direction from the ES creative director/);
assert.match(block, /- c1 \[stats-single-ent · reaction · hype\] angle: "No one can guard Clark right now"/);
assert.match(block, /facts: 30 PTS, 9 AST, 6 REB/);
assert.match(block, /Then add up to 2 more designs/);
assert.match(block, /ES house style: ES Covers here run 2 pills/);
assert.equal(conceptsBlock([], 4), '');

// The writer prompt: the cached part before the request break never changes,
// and with no concepts the prompt is exactly the old one.
const found = { digest: 'research', articles: [] };
const plainPrompt = gen._test.buildPrompt(brief, found, [], 4, '- [Cover] A', []);
const directedPrompt = gen._test.buildPrompt(brief, found, [], 4, '- [Cover] A', [], { concepts: concepts.slice(0, 2), houseStyle: [] });
const BREAK = '\n<<<REQUEST>>>\n';
assert.equal(directedPrompt.split(BREAK)[0], plainPrompt.split(BREAK)[0], 'the cached static part is byte-identical');
assert.equal(gen._test.buildPrompt(brief, found, [], 4, '- [Cover] A', [], { concepts: [] }), plainPrompt, 'no concepts: the old prompt');
assert.match(directedPrompt, /"conceptId": "c1"/);
assert.doesNotMatch(plainPrompt, /conceptId|Creative direction/);

// The system prompt is built from the templates; the request carries the steer.
const system = DIRECTOR_SYSTEM(TEMPLATES);
assert.match(system, /creative director of EssentiallySports/);
assert.match(system, /- stats-single-ent \(Player Stats\): .* photo: yes/);
assert.match(system, /- listicle-type-1 \(Rankings Table\): .* photo: no/);
const request = directorRequest({ brief, read, allowedTypes: [], steer: 'question', pastPosts: '- [Cover] "A | B"', houseStyle: ['x'], digest: 'd'.repeat(5000), want: 3 });
assert.match(request, /Steer from the editor: question/);
assert.match(request, /Return 3 concepts/);
assert.ok(request.length < 2500 + brief.length + 1500, 'the research digest is capped at 2,500 characters');
assert.doesNotMatch(directorRequest({ brief, read, steer: 'viral' }), /Steer from the editor/, 'unknown steers are ignored');
assert.equal(directorTier(''), 'auto', 'Haiku first with Sonnet escalation by default');
assert.equal(directorTier('best'), 'best', 'Sonnet override');
assert.equal(directorTier('haiku'), 'main');
assert.equal(directorTier('main'), 'main');
assert.equal(directorTier('sonnet'), 'best');

// The guard: Gateway only, 2+ designs, not turned off, research under 9s.
const gateway = { name: 'gateway' };
assert.equal(directorAllowed({ provider: gateway, want: 4, researchMs: 3000 }), true);
assert.equal(directorAllowed({ provider: gateway, want: 4, researchMs: DIRECTOR_START_BY_MS + 1 }), false, 'slow research skips the director');
assert.equal(directorAllowed({ provider: gateway, want: 1, researchMs: 3000 }), false, 'Try again (1 design) stays one cheap call');
assert.equal(directorAllowed({ provider: gateway, want: 4, researchMs: 3000, directions: false }), false);
assert.equal(directorAllowed({ provider: { name: 'gateway', fallback: 'budget' }, want: 4, researchMs: 3000 }), false);
assert.equal(directorAllowed({ provider: { name: 'groq' }, want: 4, researchMs: 3000 }), false);

// ─── 3. runDirector never throws ───────────────────────────────────────────
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const args = { brief, read, want: 4, templates: TEMPLATES, corpus };
let models = [];
globalThis.fetch = async (url, options) => { models.push(JSON.parse(options.body).model); throw new Error('network down'); };
let result = await runDirector(args);
assert.deepEqual(result.concepts, []);
assert.equal(result.source, 'none');
assert.deepEqual(models, ['anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5'], 'a quick Sonnet failure retries once on Haiku');

models = [];
result = await runDirector({ ...args, startedAt: Date.now() - 20000 });
assert.deepEqual(models, ['anthropic/claude-sonnet-5.5'], 'no Haiku retry late in a run');

globalThis.fetch = async () => reply(200, { content: [{ type: 'text', text: 'Sorry, here are some thoughts, no JSON.' }], usage: { input_tokens: 10, output_tokens: 10 } });
result = await runDirector(args);
assert.deepEqual(result.concepts, []);
assert.equal(result.source, 'none', 'unparsable JSON: no concepts');

models = [];
globalThis.fetch = async (url, options) => { models.push(JSON.parse(options.body).model); return reply(402, { error: { message: 'Spend limit reached for this API key' } }); };
result = await runDirector(args);
assert.deepEqual(result.concepts, []);
assert.equal(result.source, 'budget');
assert.equal(models.length, 1, 'a budget error is not retried');

globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  assert.match(JSON.stringify(body.system), /creative director/);
  assert.equal(body.max_tokens, 1400);
  return reply(200, { content: [{ type: 'text', text: JSON.stringify({ read: { subject: 'Caitlin Clark', team: 'Indiana Fever', sport: 'WNBA', moment: 'Fever beat the Sky' }, concepts: [concept({})] }) }], usage: { input_tokens: 2600, output_tokens: 600, cache_read_input_tokens: 1300 } });
};
result = await runDirector(args);
assert.equal(result.source, 'director');
assert.equal(result.concepts.length, 1);
assert.equal(result.read.moment, 'Fever beat the Sky');
assert.ok(result.cost > 0.005 && result.cost < 0.02, `a Sonnet direction costs about a cent (got ${result.cost})`);

console.log('creative director checks passed');
