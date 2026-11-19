// Generate with the creative director, full handler, every network call mocked:
//   - the corpus RPC feeds masked past posts to the director and the writer,
//   - Sonnet directs (3 concepts), Haiku writes one design per concept,
//   - the art director (luna) sees each card's intended angle,
//   - every failure (garbage, 402, turned off, 1 design) falls back to the old path.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

// These cases pin the Sonnet-only director path (the default is now auto).
process.env.GENERATE_DIRECTOR_MODEL = process.env.GENERATE_DIRECTOR_MODEL || 'best';
const require = createRequire(import.meta.url);
// These cover the template look's fallback photo pick (no asset service);
// the verified path (classicPhotos + asset service) is in test-generate-classic-photos.mjs.
require('../netlify/functions/_composer.js').setAssetService(null);
const fnDir = path.resolve('netlify/functions');
const genPath = path.join(fnDir, 'es-generate.js');
const gwPath = path.join(fnDir, '_ai-gateway.js');
const mcpPath = path.join(fnDir, '_es-mcp.js');
const authPath = path.join(fnDir, '_supabase-auth.js');
const examplesPath = path.join(fnDir, '_generate-examples.js');
const directorPath = path.join(fnDir, '_creative-director.js');

const SONNET = 'anthropic/claude-sonnet-5.5';
const IMG = n => `https://image-cdn.essentiallysports.com/wp-content/uploads/clark-${n}.jpg`;
const POSTS = [1, 2].map(n => ({
  id: n, date: `2026-11-1${n}T10:00:00`, link: `https://www.essentiallysports.com/wnba-news-clark-${n}/`,
  title: { rendered: `Caitlin Clark story ${n} with the Indiana Fever` },
  excerpt: { rendered: '<p>Clark and the Fever.</p>' },
  content: { rendered: '<p>Caitlin Clark scored 30 points with 9 assists and 6 rebounds as the Indiana Fever beat the Chicago Sky.</p>' },
  yoast_head_json: { og_image: [{ url: IMG(n) }] },
}));
const CORPUS = [
  { id: 'DES1', exported_at: '2026-11-15T10:00:00Z', workspace_variant: 'Cover Image', post_type: 'cover', sport: 'WNBA', team: 'Indiana Fever', title: 'x', lines: ['Who Stops', 'Clark At 22?'], listicle: null, palette_idx: 0, photo_url: null, brief: 'clark 22 pts', generated: {}, status: 'Done', stars: 5 },
  { id: 'DES2', exported_at: '2026-11-14T10:00:00Z', workspace_variant: 'Player Stats', post_type: 'stats-single-ent', sport: 'WNBA', team: '', title: 'x', lines: ['Statement Made', '41 | PTS'], listicle: null, palette_idx: 0, photo_url: null, brief: '', generated: {}, status: '', stars: null },
  { id: 'DES3', exported_at: '2026-11-13T10:00:00Z', workspace_variant: 'Quote', post_type: 'quote', sport: 'NBA', team: '', title: 'x', lines: ['We Run', 'This'], listicle: null, palette_idx: 0, photo_url: null, brief: '', generated: {}, status: '', stars: null },
];
const STATS = [{ value: '30', label: 'PTS' }, { value: '9', label: 'AST' }, { value: '6', label: 'REB' }];
const CONCEPTS = { read: { subject: 'Caitlin Clark', team: 'Indiana Fever', sport: 'WNBA', moment: 'Clark carried the Fever past the Sky' }, concepts: [
  { postType: 'stats-single-ent', angle: 'Clark is simply unguardable right now', hook: 'reaction', emotion: 'awe', headlineIdea: 'No One Can Stop Her', factsUsed: ['30 PTS', '9 AST', '6 REB'], photo: { query: 'Caitlin Clark Fever', shot: 'celebration' }, team: 'Indiana Fever', palette: 'auto', rationale: 'Three real numbers carry the awe.' },
  { postType: 'quote', angle: 'Her own words: this team is just getting started', hook: 'quote', emotion: 'respect', headlineIdea: 'Building Something Special', factsUsed: ['We are building something special'], photo: { query: 'Caitlin Clark Fever', shot: 'portrait' }, team: 'Fever', palette: 'auto', rationale: 'Real words.' },
  { postType: 'cover', angle: 'Is anyone in the league able to slow her down?', hook: 'question', emotion: 'debate', headlineIdea: 'Can Anyone Stop Clark?', factsUsed: ['Fever beat the Sky'], photo: { query: 'Caitlin Clark Fever', shot: 'action' }, team: '', palette: 'auto', rationale: 'Debate.' },
] };
// The writer answers the concepts out of order; the server restores concept order.
const WRITER = { designs: [
  { conceptId: 'c3', postType: 'cover', sport: 'WNBA', team: 'Indiana Fever', fields: { pills: ['Can Anyone', 'Stop Clark?'] }, photoQuery: 'Caitlin Clark Fever', why: 'Is anyone able to slow her down?' },
  { conceptId: 'c1', postType: 'stats-single-ent', sport: 'WNBA', team: 'Indiana Fever', fields: { headline: 'No One Can Stop Her', stats: STATS }, photoQuery: 'Caitlin Clark Fever', why: 'Unguardable.' },
  { conceptId: 'c2', postType: 'quote', sport: 'WNBA', team: '', fields: { lines: ['We Are Building', 'Something Special'] }, photoQuery: 'Caitlin Clark Fever', why: 'Her words.' },
] };
const LEGACY = { designs: [
  { postType: 'stats-single-ent', sport: 'WNBA', team: 'Indiana Fever', fields: { headline: 'Clark Delivers', stats: STATS }, photoQuery: 'Caitlin Clark', why: 'Real numbers.' },
  { postType: 'cover', sport: 'WNBA', team: 'Indiana Fever', fields: { pills: ['Can Anyone', 'Stop Clark?'] }, photoQuery: 'Caitlin Clark', why: 'A hook.' },
] };

let directorMode = 'ok'; // ok | garbage | budget
let seen;
const reset = () => { seen = { director: [], writer: [], review: [], messages: 0, groq: 0, usage: [], corpus: 0 }; };
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('/wp-json/wp/v2/tags')) return reply(200, /caitlin clark/i.test(new URL(href).searchParams.get('search')) ? [{ id: 42888, name: 'Caitlin Clark', count: 5239 }] : []);
  if (href.includes('/wp-json/wp/v2/posts')) return reply(200, new URL(href).searchParams.get('tags') ? POSTS : []);
  if (href.includes('/rest/v1/frameup_ai_usage')) { seen.usage.push(JSON.parse(options.body)); return reply(201, {}); }
  if (href.endsWith('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, 0);
  if (href.endsWith('/rest/v1/rpc/frameup_my_ai_spend')) return reply(200, [{ total_usd: 0 }]);
  if (href.endsWith('/rest/v1/rpc/list_frameup_generate_corpus')) { seen.corpus += 1; return reply(200, CORPUS); }
  if (href.startsWith('https://api.groq.com/')) { seen.groq += 1; return reply(200, { choices: [{ message: { content: JSON.stringify(LEGACY) } }] }); }
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/chat/completions')) {
    const body = JSON.parse(options.body);
    const prompt = body.messages[0].content;
    seen.review.push(prompt);
    const cards = (prompt.match(/^card \d+/gm) || []).map((_, i) => ({ card: i + 1, best: 0, score: 4.3, note: '' }));
    return reply(200, { choices: [{ message: { content: JSON.stringify({ cards }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 80 } });
  }
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) {
    seen.messages += 1;
    const body = JSON.parse(options.body);
    const content = body.messages[0].content;
    if (Array.isArray(content)) {
      if (directorMode === 'budget') return reply(402, { error: { message: 'Spend limit reached for this API key' } });
      return reply(200, { content: [{ type: 'text', text: '{"best": 1}' }], usage: { input_tokens: 4000, output_tokens: 20 } });
    }
    if (body.model === SONNET && /creative director/.test(JSON.stringify(body.system || ''))) {
      seen.director.push(content);
      if (directorMode === 'budget') return reply(402, { error: { message: 'Spend limit reached for this API key' } });
      if (directorMode === 'garbage') return reply(200, { content: [{ type: 'text', text: 'Here are my thoughts: be bold!' }], usage: { input_tokens: 2600, output_tokens: 300 } });
      return reply(200, { content: [{ type: 'text', text: JSON.stringify(CONCEPTS) }], usage: { input_tokens: 2600, output_tokens: 650, cache_read_input_tokens: 1300 } });
    }
    seen.writer.push(content);
    const directed = /Creative direction from the ES creative director/.test(content);
    return reply(200, { content: [{ type: 'text', text: JSON.stringify(directed ? WRITER : LEGACY) }], usage: { input_tokens: 5400, output_tokens: 1300 } });
  }
  throw new Error(`unexpected fetch ${href}`);
};

process.env.AI_GATEWAY_API_KEY = 'gw-test';
process.env.GROQ_API_KEY = 'groq-test';
function load() {
  [genPath, gwPath, mcpPath, authPath, examplesPath, directorPath].forEach(p => delete require.cache[p]);
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }), verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }) } };
  require.cache[mcpPath] = { id: mcpPath, filename: mcpPath, loaded: true, exports: { isMcpConfigured: () => false, createSession: () => null } };
  return require(genPath);
}
let gen = load();
// Each request starts cold (no photo pick reused from an earlier scenario).
const post = body => (gen._test.PHOTO_PICK_CACHE.clear(), gen._test.IMAGE_SEARCH_CACHE.clear(), gen).handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) }).then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));
const brief = 'Caitlin Clark after the Fever beat the Sky: "We are building something special." 30 PTS 9 AST 6 REB';

// 1. The director directs, the writer follows, the reviewer checks the angle.
reset();
let res = await post({ brief });
assert.equal(res.status, 200);
assert.equal(seen.director.length, 1, 'one director call');
assert.match(seen.director[0], /Past ES posts the team shipped/);
assert.match(seen.director[0], /"Who Stops \| Clark At #\?"/, 'past posts reach the director with digits masked');
assert.doesNotMatch(seen.director[0], /41/, "a past post's numbers never reach the director");
assert.equal(seen.writer.length, 1, 'one writer call');
assert.match(seen.writer[0], /Creative direction from the ES creative director/);
assert.match(seen.writer[0], /- c1 \[stats-single-ent · reaction · awe\]/);
assert.match(seen.writer[0], /Clark At #\?/, 'the writer sees a masked past post');
assert.match(seen.writer[0], /"conceptId": "c1"/);
assert.match(seen.review[0], /intended angle: "Clark is simply unguardable right now" \(reaction\)/);
assert.match(seen.review[0], /angle \(does it land the intended angle/);
assert.deepEqual(res.body.designs.map(d => d.postType), ['stats-single-ent', 'quote', 'cover'], 'designs follow the concept order');
assert.ok(res.body.designs.every(d => d.direction?.angle), 'each design carries its angle');
assert.deepEqual(res.body.designs.map(d => d.direction.conceptId), ['c1', 'c2', 'c3']);
assert.equal(res.body.designs[0].direction.shot, 'celebration');
assert.equal(res.body.designs[1].team, 'Indiana Fever', "an empty team takes the concept's team");
assert.ok(res.body.designs.every(d => !('conceptId' in d)), 'conceptId stays inside direction');
assert.equal(res.body.direction.source, 'director');
assert.equal(res.body.direction.model, SONNET);
assert.equal(res.body.direction.concepts.length, 3);
assert.equal(res.body.direction.read.moment, 'Clark carried the Fever past the Sky');
assert.match(res.body.runId, /^run-/);
assert.equal(res.body.learning.corpus, 'rich');
assert.ok(res.body.meta.ms.direction >= 0);
assert.ok(res.body.meta.costUsd > 0.005 && res.body.meta.costUsd < 0.03, `a directed run costs under 3 cents (got ${res.body.meta.costUsd})`);
const features = seen.usage.map(row => row.feature);
assert.ok(features.includes('generate-director'), 'the director is tracked under its own feature');
assert.deepEqual([...new Set(features)].sort(), ['generate', 'generate-director', 'generate-photo-pick', 'generate-review']);

// 2. The director returns garbage: the old path, no direction anywhere.
directorMode = 'garbage';
reset();
res = await post({ brief });
assert.equal(res.status, 200);
assert.equal(res.body.direction.source, 'none');
assert.deepEqual(res.body.direction.concepts, []);
assert.deepEqual(res.body.designs.map(d => d.postType), ['stats-single-ent', 'cover']);
assert.ok(res.body.designs.every(d => !d.direction), 'no direction on the designs');
assert.doesNotMatch(seen.writer[0], /Creative direction/, 'the writer prompt has no direction block');
assert.doesNotMatch(seen.review[0], /intended angle/);
assert.match(seen.review[0], /score is the average of the four/, 'the review prompt is the old one');

// 3. The director hits the weekly budget: the writer goes to Groq, no second Gateway try.
directorMode = 'budget';
reset();
res = await post({ brief });
assert.equal(res.status, 200);
assert.match(res.body.brain, /^groq:/);
assert.equal(res.body.ai.fallback, 'budget');
assert.equal(seen.groq, 1);
// The photo pick may start before or after the director's 402: either it is
// sent once, or it sees the budget is out and never calls. Never a retry.
assert.ok(seen.messages >= 1 && seen.messages <= 2, `director + at most one photo pick (got ${seen.messages})`);
assert.equal(res.body.designs.length, 2);
assert.equal(res.body.direction.source, 'none');

// 4. directions:false and count:1 never call the director.
directorMode = 'ok';
reset();
res = await post({ brief, directions: false });
assert.equal(seen.director.length, 0, 'directions:false = the old path');
assert.equal(res.body.direction.source, 'none');
assert.equal(res.body.designs.length, 2);
reset();
res = await post({ brief, formats: ['cover'], count: 1, avoid: ['Can Anyone'] });
assert.equal(seen.director.length, 0, 'Try again (1 design) stays one cheap call');

// 5. The editor's steer reaches the director; unknown steers are ignored.
reset();
await post({ brief, steer: 'question' });
assert.match(seen.director[0], /Steer from the editor: question/);
reset();
await post({ brief, steer: 'make-it-viral' });
assert.doesNotMatch(seen.director[0], /Steer from the editor/);

// 6. Before the corpus migration: the old examples RPC, and the old prompt
//    format for the writer when the director has nothing to add.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const href = String(url);
  if (href.endsWith('/rest/v1/rpc/list_frameup_generate_corpus')) return reply(404, { code: 'PGRST202', message: 'Could not find the function' });
  if (href.endsWith('/rest/v1/rpc/list_frameup_examples')) return reply(200, [{ title: 'Can Anyone Stop Clark?', workspace_variant: 'Cover Image', exported_at: '2026-11-15T10:00:00Z', brief: 'clark after the fever win' }]);
  return realFetch(url, options);
};
gen = load();
directorMode = 'garbage';
reset();
res = await post({ brief });
assert.equal(res.status, 200);
assert.equal(res.body.learning.corpus, 'legacy');
assert.match(seen.writer[0], /- \[Cover\] brief "clark after the fever win" -> the team used: Can Anyone Stop Clark\?/, 'the writer sees exactly the old example lines');
assert.equal(res.body.designs.length, 2);

// 7. The time guard: research slower than DIRECTOR_START_BY_MS skips the director.
globalThis.fetch = realFetch;
gen = load();
directorMode = 'ok';
const clock = gen._test.clock;
const step = gen._test.DIRECTOR_START_BY_MS + 1000;
let fake = 0;
clock.now = () => (fake += step); // every reading jumps past the guard: research is "too slow"
reset();
res = await post({ brief });
assert.equal(seen.director.length, 0, 'slow research: no director');
assert.equal(res.body.direction.source, 'none');
assert.ok(res.body.designs.length >= 1);

console.log('es-generate creative direction checks passed');
