// Generate, director first (2026-11-18): named directions the editor can see,
// pick, edit and steer; designs grouped by direction; the director's note and
// one-click fix; the memory of what editors choose and export; Haiku-first
// with Sonnet escalation behind GENERATE_DIRECTOR_MODEL=auto. Every network
// call is mocked; unexpected fetches throw.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const genPath = path.join(fnDir, 'es-generate.js');
const gwPath = path.join(fnDir, '_ai-gateway.js');
const mcpPath = path.join(fnDir, '_es-mcp.js');
const authPath = path.join(fnDir, '_supabase-auth.js');
const examplesPath = path.join(fnDir, '_generate-examples.js');
const directorPath = path.join(fnDir, '_creative-director.js');
const memoryPath = path.join(fnDir, '_direction-memory.js');
const eventsPath = path.join(fnDir, 'generate-direction-events.js');

const SONNET = 'anthropic/claude-sonnet-5.5';
const HAIKU = 'anthropic/claude-haiku-5.5';
const IMG = n => `https://image-cdn.essentiallysports.com/wp-content/uploads/clark-${n}.jpg`;
const POSTS = [1, 2].map(n => ({
  id: n, date: `2026-11-1${n}T10:00:00`, link: `https://www.essentiallysports.com/wnba-news-clark-${n}/`,
  title: { rendered: `Caitlin Clark story ${n} with the Indiana Fever` },
  excerpt: { rendered: '<p>Clark and the Fever.</p>' },
  content: { rendered: '<p>Caitlin Clark scored 30 points with 9 assists and 6 rebounds as the Indiana Fever beat the Chicago Sky.</p>' },
  yoast_head_json: { og_image: [{ url: IMG(n) }] },
}));
const CORPUS = [
  { id: 'DES1', exported_at: '2026-11-15T10:00:00Z', workspace_variant: 'Cover Image', post_type: 'cover', sport: 'WNBA', team: 'Indiana Fever', title: 'x', lines: ['Who Stops', 'Clark At 22?'], listicle: null, palette_idx: 0, photo_url: IMG(9), brief: 'clark 22 pts', generated: {}, status: 'Done', stars: 5 },
  { id: 'DES2', exported_at: '2026-11-14T10:00:00Z', workspace_variant: 'Player Stats', post_type: 'stats-single-ent', sport: 'WNBA', team: '', title: 'x', lines: ['Statement Made', '41 | PTS'], listicle: null, palette_idx: 0, photo_url: 'https://evil.example.com/x.jpg', brief: '', generated: { runId: 'run-old-1', angle: 'Unguardable right now' }, status: '', stars: null },
];
const STATS = [{ value: '30', label: 'PTS' }, { value: '9', label: 'AST' }, { value: '6', label: 'REB' }];
const GOOD = {
  read: { subject: 'Caitlin Clark', team: 'Indiana Fever', sport: 'WNBA', moment: 'Clark carried the Fever past the Sky' },
  concepts: [
    { name: 'The Unguardable Case', postType: 'stats-single-ent', angle: 'Clark is simply unguardable right now', hook: 'reaction', emotion: 'awe', headlineIdea: 'No One Can Stop Her', factsUsed: ['30 PTS', '9 AST', '6 REB'], photo: { query: 'Caitlin Clark Fever', shot: 'celebration' }, team: 'Indiana Fever', palette: 'auto', rationale: 'Die-hards love real numbers.', inspiredBy: ['P2', 'P9'], confidence: 88 },
    { name: 'Her Own Words', postType: 'quote', angle: 'Her own words: this team is just getting started', hook: 'quote', emotion: 'respect', headlineIdea: 'Building Something Special', factsUsed: ['We are building something special'], photo: { query: 'Caitlin Clark Fever', shot: 'portrait' }, team: 'Fever', palette: 'auto', rationale: 'Real words travel.', inspiredBy: [], confidence: 0.7 },
    { name: '', postType: 'cover', angle: 'Is anyone in the league able to slow her down?', hook: 'question', emotion: 'debate', headlineIdea: 'Can Anyone Stop Clark?', factsUsed: ['Fever beat the Sky'], photo: { query: 'Caitlin Clark Fever', shot: 'action' }, team: '', palette: 'auto', rationale: 'Debate drives comments.', inspiredBy: ['p1'] },
  ],
};
const ONE = { ...GOOD, concepts: [GOOD.concepts[2]] };

let directorReply = { [SONNET]: GOOD, [HAIKU]: GOOD };
let reviewCards = null;
let overWeek = false;
let seen;
const reset = () => { seen = { director: [], directorModels: [], writer: [], review: [], rewrite: [], usage: [], events: [] }; };
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const asText = value => (typeof value === 'string' ? value : JSON.stringify(value));

globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('/wp-json/wp/v2/tags')) return reply(200, /caitlin clark/i.test(new URL(href).searchParams.get('search')) ? [{ id: 42888, name: 'Caitlin Clark', count: 5239 }] : []);
  if (href.includes('/wp-json/wp/v2/posts')) return reply(200, new URL(href).searchParams.get('tags') ? POSTS : []);
  if (href.includes('/rest/v1/frameup_ai_usage')) { seen.usage.push(JSON.parse(options.body)); return reply(201, {}); }
  if (href.endsWith('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, 0);
  if (href.endsWith('/rest/v1/rpc/frameup_my_ai_spend')) return reply(200, [{ total_usd: overWeek ? 25 : 0 }]);
  if (href.endsWith('/rest/v1/rpc/list_frameup_generate_corpus')) return reply(200, CORPUS);
  if (href.endsWith('/rest/v1/rpc/frameup_generate_direction_signals')) {
    return reply(200, [
      { type: 'design_exported', run_id: 'run-old-1', post_type: 'stats-single-ent', hook: 'reaction', angle: 'Unguardable right now', payload: {} },
      { type: 'direction_chosen', run_id: 'run-old-2', post_type: 'cover', hook: 'question', angle: 'Who stops her now?', payload: {} },
      { type: 'less_like_this', run_id: 'run-old-3', post_type: 'cover', hook: 'claim', angle: 'Clark is the GOAT already', payload: {} },
    ]);
  }
  if (href.includes('/rest/v1/frameup_generate_direction_events')) { seen.events.push(JSON.parse(options.body)); return reply(201, {}); }
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/chat/completions')) {
    const prompt = JSON.parse(options.body).messages[0].content;
    seen.review.push(prompt);
    const cards = reviewCards || (prompt.match(/^card \d+/gm) || []).map((_, i) => ({ card: i + 1, best: 0, score: 4.7, strong: '', note: '' }));
    return reply(200, { choices: [{ message: { content: JSON.stringify({ cards }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 80 } });
  }
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) {
    const body = JSON.parse(options.body);
    const content = body.messages[0].content;
    if (Array.isArray(content)) return reply(200, { content: [{ type: 'text', text: '{"best": 1}' }], usage: { input_tokens: 4000, output_tokens: 20 } });
    if (/creative director/.test(asText(body.system || ''))) {
      seen.director.push(content);
      seen.directorModels.push(body.model);
      const answer = directorReply[body.model];
      if (answer === 'fail') throw new Error('network down');
      if (answer === 'budget') return reply(402, { error: { message: 'Spend limit reached for this API key' } });
      return reply(200, { content: [{ type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }], usage: { input_tokens: 2600, output_tokens: 650 } });
    }
    if (/senior social editor at EssentiallySports \(ES\)\. Rewrite/.test(content)) {
      seen.rewrite.push(content);
      return reply(200, { content: [{ type: 'text', text: JSON.stringify({ fields: { pills: ['Who Can', 'Stop Clark?'] } }) }], usage: { input_tokens: 900, output_tokens: 60 } });
    }
    seen.writer.push(content);
    // One design per requested slot, each answering its concept.
    const ids = [...content.matchAll(/^- (c\d) \[([a-z0-9-]+)/gm)].map(m => ({ id: m[1], postType: m[2] }));
    const per = Number((content.match(/Write exactly (\d) designs per concept/) || [])[1] || 1);
    const make = (id, postType, n) => (postType === 'stats-single-ent'
      ? { conceptId: id, postType, sport: 'WNBA', team: 'Indiana Fever', fields: { headline: n ? 'Statement Made' : 'No One Can Stop Her', stats: STATS }, photoQuery: 'Caitlin Clark Fever' }
      : postType === 'quote'
        ? { conceptId: id, postType, sport: 'WNBA', team: '', fields: { lines: n ? ['Something', 'Special'] : ['We Are Building', 'Something Special'] }, photoQuery: 'Caitlin Clark Fever' }
        : { conceptId: id, postType: 'cover', sport: 'WNBA', team: 'Indiana Fever', fields: { pills: n ? ['Who Slows', 'Clark Down?'] : ['Can Anyone', 'Stop Clark?'] }, photoQuery: 'Caitlin Clark Fever' });
    const designs = ids.length
      ? ids.flatMap(({ id, postType }) => Array.from({ length: per }, (_, n) => make(id, postType, n)))
      : [make('', 'cover', 0)].map(({ conceptId, ...rest }) => rest);
    return reply(200, { content: [{ type: 'text', text: JSON.stringify({ designs }) }], usage: { input_tokens: 5400, output_tokens: 1300 } });
  }
  throw new Error(`unexpected fetch ${href}`);
};

process.env.AI_GATEWAY_API_KEY = 'gw-test';
delete process.env.GROQ_API_KEY;
function load() {
  [genPath, gwPath, mcpPath, authPath, examplesPath, directorPath, memoryPath, eventsPath].forEach(p => delete require.cache[p]);
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: {
      authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
      verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }),
      bearerToken: headers => String(headers?.authorization || '').replace(/^Bearer\s+/i, ''),
    },
  };
  require.cache[mcpPath] = { id: mcpPath, filename: mcpPath, loaded: true, exports: { isMcpConfigured: () => false, createSession: () => null } };
  return require(genPath);
}
let gen = load();
let director = require(directorPath);
const post = body => gen.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) }).then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));
const brief = 'Caitlin Clark after the Fever beat the Sky: "We are building something special." 30 PTS 9 AST 6 REB';

// ─── 1. Concept validation: names, confidence, inspiredBy, chosen ─────────
{
  const { readBrief, TEMPLATES } = gen._test;
  const read = readBrief(brief, { tags: [{ name: 'Caitlin Clark' }], articles: [] }, []);
  const corpus = 'Caitlin Clark scored 30 points as the Indiana Fever beat the Chicago Sky.';
  const opts = { read, want: 4, brief, corpus, templates: TEMPLATES, pastIds: ['P1', 'P2'] };
  const concepts = director.validateConcepts(GOOD, opts);
  assert.equal(concepts.length, 3);
  assert.equal(concepts[0].name, 'The Unguardable Case');
  assert.equal(concepts[2].name, 'The Question', 'a missing name comes from the hook');
  assert.deepEqual(concepts[0].inspiredBy, ['P2'], 'unknown past-post ids (P9) are dropped');
  assert.deepEqual(concepts[2].inspiredBy, ['P1'], 'ids are case-insensitive');
  assert.ok(concepts.every(c => c.confidence >= 15 && c.confidence <= 98), 'confidence is 15-98');
  assert.ok(concepts[0].confidence > concepts[2].confidence, 'three verified facts beat one');
  assert.equal(director.confidenceFor(0.7, { factsUsed: ['a'] }), director.confidenceFor(70, { factsUsed: ['a'] }), '0-1 and 0-100 scales agree');
  assert.equal(concepts[0].rationale, 'Die-hards love real numbers.');

  // The editor's picked + edited directions: ref kept, longer angle ok, no look-alike drop,
  // but template fit and facts are still checked in code.
  const long = 'Clark is simply unguardable right now, and every coach in the league knows it too';
  const chosen = director.validateConcepts({ concepts: [
    { ...GOOD.concepts[0], ref: 'd1', angle: long, edited: true, confidence: 91 },
    { ...GOOD.concepts[0], ref: 'd2', angle: 'Clark is simply unguardable right now!' },
    { ...GOOD.concepts[0], ref: 'd3', postType: 'listicle-type-1' },
    { ...GOOD.concepts[0], ref: 'd4', factsUsed: ['41 PTS', '12 AST', '6 REB'] },
  ] }, { ...opts, chosen: true });
  assert.deepEqual(chosen.map(c => c.ref), ['d1', 'd2'], 'unfit templates and invented stats still drop');
  assert.equal(chosen[0].angle, long);
  assert.equal(chosen[0].edited, true);
  assert.equal(chosen[0].confidence, 91, "a chosen direction keeps the confidence it was shown with");
  assert.deepEqual(chosen.map(c => c.id), ['c1', 'c2']);
}

// ─── 2. Steering: normalize, director request, writer block ───────────────
{
  assert.deepEqual(director.normalizeSteer('question'), { hook: 'question', tone: '', audience: '', more: [], less: [] });
  const s = director.normalizeSteer({ hook: 'viral', tone: 'Witty', audience: 'die-hard', more: ['Clark is unguardable', 'x'], less: [{ angle: 'Clark is the GOAT already' }], extra: 1 });
  assert.deepEqual(s, { hook: '', tone: 'witty', audience: 'diehard', more: ['Clark is unguardable'], less: ['Clark is the GOAT already'] });
  assert.equal(director.steerIsEmpty(director.normalizeSteer(null)), true);
  assert.equal(director.steerIsEmpty(s), false);
  const request = director.directorRequest({ brief, read: {}, steer: s, memory: ['Editors pick question hooks most.'] });
  assert.match(request, /Tone from the editor: witty/);
  assert.match(request, /Audience from the editor: die-hard fans/);
  assert.match(request, /more like: "Clark is unguardable"/);
  assert.match(request, /less like \(avoid these angles and their hooks\): "Clark is the GOAT already"/);
  assert.match(request, /What ES editors picked and exported lately:\n- Editors pick question hooks most\./);
  const block = director.conceptsBlock([{ id: 'c1', postType: 'cover', angle: 'A big question', hook: 'question', emotion: '', factsUsed: [], photo: {} }], 2, [], { perConcept: 2, steer: { tone: 'hype', audience: 'casual' } });
  assert.match(block, /Write exactly 2 designs per concept/);
  assert.doesNotMatch(block, /Then add up to/, 'one direction x 2 takes fills the count');
  assert.match(block, /Tone from the editor: hype/);
  assert.match(block, /Audience: casual fans/);
}

// ─── 3. Model tier: Sonnet by default, Haiku-first behind =auto ───────────
{
  assert.equal(director.directorTier(''), 'best', 'the default is Sonnet');
  assert.equal(director.directorTier('auto'), 'auto');
  assert.equal(director.directorTier('AUTO '), 'auto');
  const { readBrief, TEMPLATES } = gen._test;
  const read = readBrief(brief, { tags: [{ name: 'Caitlin Clark' }], articles: [] }, []);
  const args = { brief, read, want: 4, templates: TEMPLATES, corpus: 'Fever beat the Sky. 30 PTS 9 AST 6 REB', tier: 'auto' };

  // Haiku's concepts fail validation: exactly one Sonnet call, and its concepts win.
  reset();
  directorReply = { [HAIKU]: 'Be bold!', [SONNET]: GOOD };
  let result = await director.runDirector(args);
  assert.deepEqual(seen.directorModels, [HAIKU, SONNET]);
  assert.equal(result.source, 'sonnet-escalated');
  assert.equal(result.escalated, true);
  assert.equal(result.concepts.length, 3);
  assert.equal(result.calls, 2);

  // Only one Haiku concept survives (fewer than 2): escalate.
  reset();
  directorReply = { [HAIKU]: ONE, [SONNET]: GOOD };
  result = await director.runDirector(args);
  assert.deepEqual(seen.directorModels, [HAIKU, SONNET]);
  assert.equal(result.concepts.length, 3);

  // Haiku is good enough: no Sonnet call.
  reset();
  directorReply = { [HAIKU]: GOOD, [SONNET]: GOOD };
  result = await director.runDirector(args);
  assert.deepEqual(seen.directorModels, [HAIKU]);
  assert.equal(result.source, 'director');
  assert.ok(result.cost < 0.002, `a Haiku direction is cheap (got ${result.cost})`);

  // Haiku fails: Sonnet once. Late in the run: no escalation.
  reset();
  directorReply = { [HAIKU]: 'fail', [SONNET]: GOOD };
  result = await director.runDirector(args);
  assert.deepEqual(seen.directorModels, [HAIKU, SONNET]);
  assert.equal(result.source, 'sonnet-escalated');
  reset();
  result = await director.runDirector({ ...args, startedAt: Date.now() - 60000 });
  assert.deepEqual(seen.directorModels, [HAIKU], 'no escalation late in a run');
  assert.deepEqual(result.concepts, []);

  // Budget: never escalated.
  reset();
  directorReply = { [HAIKU]: 'budget', [SONNET]: GOOD };
  result = await director.runDirector(args);
  assert.deepEqual(seen.directorModels, [HAIKU]);
  assert.equal(result.source, 'budget');

  // Default tier: Sonnet first (unchanged).
  reset();
  directorReply = { [HAIKU]: GOOD, [SONNET]: GOOD };
  result = await director.runDirector({ ...args, tier: 'best' });
  assert.deepEqual(seen.directorModels, [SONNET]);
}

// ─── 4. mode 'direct': the named directions, nothing written yet ──────────
directorReply = { [SONNET]: GOOD, [HAIKU]: GOOD };
reset();
let res = await post({ mode: 'direct', brief, steer: { tone: 'witty', audience: 'diehard', less: ['Clark is the GOAT already'] } });
assert.equal(res.status, 200);
assert.equal(res.body.mode, 'direct');
assert.equal(res.body.source, 'director');
assert.equal(seen.director.length, 1, 'one director call');
assert.equal(seen.writer.length, 0, 'no designs are written in the directions step');
assert.match(seen.director[0], /Tone from the editor: witty/, 'tone reaches the director');
assert.match(seen.director[0], /Audience from the editor: die-hard/);
assert.match(seen.director[0], /less like .*Clark is the GOAT already/);
assert.match(seen.director[0], /- P1 \[/, 'past posts carry ids the director can cite');
assert.match(seen.director[0], /What ES editors picked and exported lately/, 'the memory reaches the director');
assert.match(seen.director[0], /Shipped lately: "Unguardable right now"/);
const dirs = res.body.directions;
assert.equal(dirs.length, 3);
assert.deepEqual(Object.keys(dirs[0]).filter(k => ['id', 'name', 'postType', 'label', 'angle', 'hook', 'why', 'confidence', 'inspiredBy'].includes(k)).length, 9);
assert.equal(dirs[0].label, 'Player Stats');
assert.equal(dirs[0].why, 'Die-hards love real numbers.');
assert.equal(dirs[0].inspiredBy.length, 1);
assert.match(dirs[0].inspiredBy[0].text, /Statement Made/);
assert.equal(dirs[0].inspiredBy[0].photo, '', 'a past post photo on an unknown host is never shown');
const coverDir = dirs.find(d => d.postType === 'cover');
assert.match(coverDir.inspiredBy[0].photo, /^\/api\/es-image-search\?image=/, 'an ES photo goes through the image proxy');
assert.equal(coverDir.inspiredBy[0].stars, 5);
assert.equal(res.body.steer.tone, 'witty');
assert.match(res.body.runId, /^run-/);
assert.ok(res.body.meta.costUsd > 0);
assert.ok(seen.usage.some(row => row.feature === 'generate-director'), 'logged under the existing director feature');

// The corpus ranking favours the post whose run the team exported.
{
  const { scorePastPost, normalizeCorpus } = require(examplesPath);
  const { deriveSignals } = require(memoryPath);
  const signals = deriveSignals([{ type: 'design_exported', run_id: 'run-old-1', angle: 'Unguardable right now', payload: {} }]);
  const posts = normalizeCorpus(CORPUS);
  const exported = posts.find(p => p.id === 'DES2');
  const read = { subjects: ['Caitlin Clark'], sport: 'WNBA', brief };
  assert.ok(scorePastPost(exported, read, { signals }) - scorePastPost(exported, read, {}) >= 3.4, 'exported run + angle add a clear boost');
  const less = deriveSignals([{ type: 'less_like_this', angle: 'Unguardable right now', payload: {} }]);
  assert.ok(scorePastPost(exported, read, { signals: less }) < scorePastPost(exported, read, {}), 'an angle editors asked less of counts less');
}

// Director fails in the directions step: an empty list (the page then generates the old way).
reset();
directorReply = { [SONNET]: 'nope', [HAIKU]: 'nope' };
res = await post({ mode: 'direct', brief });
assert.equal(res.status, 200);
assert.deepEqual(res.body.directions, []);
assert.equal(res.body.source, 'none');

// The weekly cap holds for the directions step too: free mode, no director
// (the page then makes the designs the usual, rule-based way).
overWeek = true;
reset();
res = await post({ mode: 'direct', brief });
assert.equal(res.status, 200);
assert.equal(res.body.mode, 'free');
assert.equal(res.body.reason, 'user-limit');
assert.deepEqual(res.body.directions, []);
assert.equal(seen.director.length, 0);
overWeek = false;

// Gateway off: the directions step says so and makes no call.
delete process.env.AI_GATEWAY_API_KEY;
process.env.GROQ_API_KEY = 'groq-test';
gen = load();
reset();
res = await post({ mode: 'direct', brief });
assert.equal(res.body.source, 'off');
assert.deepEqual(res.body.directions, []);
process.env.AI_GATEWAY_API_KEY = 'gw-test';
delete process.env.GROQ_API_KEY;
gen = load();
director = require(directorPath);

// ─── 5. Designs from picked directions ────────────────────────────────────
directorReply = { [SONNET]: GOOD, [HAIKU]: GOOD };
reset();
const picked = { ...dirs[2], ref: 'd-cover', angle: 'Can anybody in the WNBA slow Caitlin Clark down?', edited: true };
res = await post({ brief, directions: [picked], count: 4, steer: { tone: 'hype' } });
assert.equal(res.status, 200);
assert.equal(seen.director.length, 0, 'picked directions skip the director call');
assert.match(seen.writer[0], /Write exactly 2 designs per concept/, 'one direction = two takes');
assert.match(seen.writer[0], /angle: "Can anybody in the WNBA slow Caitlin Clark down\?"/, 'the edited angle reaches the writer');
assert.match(seen.writer[0], /Tone from the editor: hype/, 'tone reaches the writer');
assert.equal(res.body.direction.source, 'chosen');
assert.equal(res.body.direction.perConcept, 2);
assert.equal(res.body.designs.length, 2);
assert.ok(res.body.designs.every(d => d.direction?.ref === 'd-cover' && d.direction.name === 'The Question'), 'both designs carry the direction name and ref');
assert.ok(res.body.designs.every(d => d.runId === res.body.runId), 'every design carries the runId (export linkage)');
assert.ok(res.body.designs.every(d => !d.lint?.warnings?.some(w => w.code === 'same-angle')), 'two takes on one direction are not "too close"');

// Two directions = two takes each, grouped in order.
reset();
res = await post({ brief, directions: [{ ...dirs[0], ref: 'a' }, { ...dirs[2], ref: 'b' }], count: 4 });
assert.deepEqual(res.body.designs.map(d => d.direction.ref), ['a', 'a', 'b', 'b']);

// A tampered direction (template that does not fit) falls back to the director.
reset();
res = await post({ brief, directions: [{ ...dirs[0], postType: 'listicle-type-2', ref: 'x' }] });
assert.equal(seen.director.length, 1, 'the director chose again');
assert.ok(res.body.notes.some(note => /no longer fit/.test(note)));

// More like this on a design = its direction, 2 takes, its lines avoided.
reset();
res = await post({ brief, formats: ['cover'], count: 2, avoid: ['Can Anyone', 'Stop Clark?'], directions: [{ ...dirs[2], ref: 'd-cover' }] });
assert.equal(seen.director.length, 0);
assert.match(seen.writer[0], /do not reuse these lines: "Can Anyone", "Stop Clark\?"/);
assert.equal(res.body.designs.length, 2);

// ─── 6. The director's note and one-click fix ─────────────────────────────
reset();
reviewCards = [
  { card: 1, best: 0, score: 3.2, strong: 'Big, real numbers', note: 'Lead with the 30 points, cut the reaction word.' },
  { card: 2, best: 0, score: 4.8, strong: '', note: '' },
];
res = await post({ brief, directions: [{ ...dirs[0], ref: 'a' }], count: 2 });
reviewCards = null;
assert.match(seen.review[0], /strong is what works best/);
const [first, second] = res.body.designs;
assert.deepEqual(first.critique.fix, { text: 'Lead with the 30 points, cut the reaction word.', how: 'fix' });
assert.equal(first.critique.strong, 'Big, real numbers');
assert.equal(first.critique.source, 'review');
assert.equal(second.critique.fix, null, 'a great design needs no fix');
assert.equal(second.critique.strong, 'Three real numbers carry it.', 'a fallback strong line by template');

// Apply fix = a rewrite with the fix text and the direction's angle.
reset();
const cover = { postType: 'cover', fields: { pills: ['Can Anyone', 'Stop Clark?'] }, lines: ['Can Anyone', 'Stop Clark?'], listicle: null, title: 'x', sport: 'WNBA', team: 'Indiana Fever', direction: { angle: 'Is anyone able to slow her down?', hook: 'question' } };
res = await post({ mode: 'rewrite', instruction: 'fix', fix: 'Name her: "Clark" reads faster than "her".', brief, spec: cover });
assert.equal(res.status, 200);
assert.equal(seen.rewrite.length, 1);
assert.match(seen.rewrite[0], /Apply the ES creative director's fix/);
assert.match(seen.rewrite[0], /Director's fix: "Name her: \\"Clark\\" reads faster than \\"her\\"\."/);
assert.match(seen.rewrite[0], /Keep the creative direction's angle: "Is anyone able to slow her down\?"/);
assert.deepEqual(res.body.design.lines, ['Who Can', 'Stop Clark?']);
assert.ok(seen.usage.some(row => row.feature === 'generate-rewrite-fix'));
res = await post({ mode: 'rewrite', instruction: 'fix', fix: '', brief, spec: cover });
assert.equal(res.status, 400, 'a fix needs its text');

// directorNote, pure.
{
  const { directorNote } = gen._test;
  assert.equal(directorNote({ postType: 'cover', lint: { warnings: [{ code: 'same-angle' }] }, review: { score: 3, note: 'x' } }).fix.how, 'angle');
  assert.equal(directorNote({ postType: 'cover', lint: { warnings: [{ code: 'pick-photo' }] } }).fix.how, 'photo');
  assert.equal(directorNote({ postType: 'cover', lint: { warnings: [{ code: 'auto-split' }] } }).fix.how, 'shorter');
  assert.equal(directorNote({ postType: 'cover', direction: { hook: 'question' } }).strong, 'A question fans will want to answer.');
  assert.equal(directorNote({ postType: 'cover', review: { score: 3.1, note: '' } }).fix.how, 'punchier');
}

// ─── 7. Memory events ─────────────────────────────────────────────────────
{
  const memory = require(memoryPath);
  memory._test.reset();
  assert.ok(memory.normalizeEvent({ type: 'direction_chosen', runId: 'run-a1', directionId: 'c1', postType: 'cover', hook: 'question', angle: 'A', payload: { name: 'x' } }).row);
  assert.equal(memory.normalizeEvent({ type: 'nope' }).error, 'Unknown event type.');
  assert.equal(memory.normalizeEvent({ type: 'direction_chosen', postType: 'banner' }).error, 'Invalid post type.');
  assert.equal(memory.normalizeEvent({ type: 'direction_chosen', hook: 'vibes' }).error, 'Invalid hook.');
  assert.equal(memory.normalizeEvent({ type: 'direction_chosen', runId: 'run a;drop' }).error, 'Invalid run.');
  assert.equal(memory.normalizeEvent({ type: 'direction_chosen', payload: { blob: 'x'.repeat(17000) } }).error, undefined, 'long strings are clipped, not rejected');
  const scrubbed = memory.normalizeEvent({ type: 'direction_edited', payload: { email: 'a@b.c', userId: 'u', before: { angle: 'a', user_email: 'x' }, after: { angle: 'b' } } }).row.payload;
  assert.deepEqual(scrubbed, { before: { angle: 'a' }, after: { angle: 'b' } }, 'emails and user ids are stripped at any depth');

  const signals = memory.deriveSignals([
    ...Array.from({ length: 3 }, () => ({ type: 'direction_chosen', hook: 'question', angle: 'Who stops her?', payload: {} })),
    { type: 'design_exported', run_id: 'run-x', hook: 'question', angle: 'Who stops her?', payload: {} },
    ...Array.from({ length: 3 }, (_, i) => ({ type: 'less_like_this', hook: 'claim', angle: `Clark is the GOAT ${i}`, payload: {} })),
  ]);
  assert.ok(signals.exportedRuns.has('run-x'));
  assert.match(signals.lines[0], /Editors pick question hooks most \(3 picks, 1 exports\)/);
  assert.ok(signals.lines.some(line => /push back on bold-claim hooks/.test(line)));
  assert.ok(signals.lines.length <= 5);

  // The endpoint saves with the user's session; a missing table is quiet.
  const events = require(eventsPath);
  reset();
  let r = await events.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify({ event: { type: 'design_exported', runId: 'run-a1', directionId: 'c1', postType: 'cover', hook: 'question', angle: 'Who stops her?', payload: { specId: 'gen-1' } } }) });
  assert.equal(r.statusCode, 200);
  assert.equal(JSON.parse(r.body).ok, true);
  assert.equal(seen.events[0].user_email, 'a@essentiallysports.com');
  assert.equal(seen.events[0].run_id, 'run-a1');
  assert.equal(seen.events[0].direction_id, 'c1');
  r = await events.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify({ event: { type: 'bogus' } }) });
  assert.equal(r.statusCode, 400);
  r = await events.handler({ httpMethod: 'GET', headers: {} });
  assert.equal(r.statusCode, 405);

  // signalsFor never throws: RPC missing, own rows missing -> empties.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => (String(url).includes('direction') ? reply(404, { code: 'PGRST205' }) : realFetch(url));
  memory._test.reset();
  const empty = await memory.signalsFor({ token: 'tok' });
  assert.deepEqual(empty.lines, []);
  assert.equal(await memory.recordEvent({ token: 'tok', email: 'a@essentiallysports.com', event: { type: 'direction_chosen' } }), false);
  globalThis.fetch = realFetch;
}

console.log('generate director-first checks passed');
