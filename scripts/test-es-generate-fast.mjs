// Generate speed + photo + scene image checks, with every network call mocked:
// ES tag research (and its cache), the Gateway path (Claude writes, Claude
// picks the photo, Groq takes over calmly when the weekly budget runs out),
// "fresh take" retries, and the Scene image function (never people or logos,
// logged with images: 1).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const genPath = path.join(fnDir, 'es-generate.js');
const imgPath = path.join(fnDir, 'es-generate-image.js');
const gwPath = path.join(fnDir, '_ai-gateway.js');
const mcpPath = path.join(fnDir, '_es-mcp.js');
const authPath = path.join(fnDir, '_supabase-auth.js');

const IMG = n => `https://image-cdn.essentiallysports.com/wp-content/uploads/clark-${n}.jpg`;
const POSTS = [1, 2, 3].map(n => ({
  id: n, date: `2026-11-1${n}T10:00:00`, link: `https://www.essentiallysports.com/wnba-news-clark-${n}/`,
  title: { rendered: `Caitlin Clark story ${n} with the Indiana Fever` }, excerpt: { rendered: '<p>Clark and the Fever.</p>' },
  yoast_head_json: { og_image: [{ url: IMG(n) }] },
}));
const DESIGNS = { designs: [
  { postType: 'stats-single-ent', sport: 'WNBA', team: 'Indiana Fever', fields: { headline: 'Clark Delivers', stats: [{ value: '30', label: 'PTS' }, { value: '9', label: 'AST' }, { value: '6', label: 'REB' }] }, photoQuery: 'Caitlin Clark Fever', scene: 'Empty basketball arena under bright lights, Indiana Fever logo at center court', why: 'Three real numbers.' },
  { postType: 'cover', sport: 'WNBA', team: 'Indiana Fever', fields: { pills: ['Can Anyone', 'Stop Caitlin Clark?'] }, photoQuery: 'Caitlin Clark', why: 'A hook.' },
] };

let calls = [];
let gatewayMode = 'ok'; // ok | budget
let usageRows = [];
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  calls.push(href);
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (href.includes('/wp-json/wp/v2/tags')) {
    const q = new URL(href).searchParams.get('search');
    if (/caitlin clark/i.test(q)) return reply(200, [{ id: 9, name: 'Caitlin Clark fan page', count: 0 }, { id: 42888, name: 'Caitlin Clark', count: 5239 }]);
    if (/^lakers$/i.test(q)) return reply(200, [{ id: 4378, name: 'Los Angeles Lakers', count: 692 }]);
    return reply(200, []);
  }
  if (href.includes('/wp-json/wp/v2/posts')) {
    const tags = new URL(href).searchParams.get('tags');
    if (tags) return reply(200, POSTS);
    return reply(200, []);
  }
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) {
    const body = JSON.parse(options.body);
    if (gatewayMode === 'budget') return reply(402, { error: { message: 'Spend limit reached for this API key' } });
    const content = body.messages[0].content;
    if (Array.isArray(content)) {
      assert.ok(content.some(block => block.type === 'image' && block.source.url === IMG(1)), 'the photo pick sees the ES photos');
      return reply(200, { content: [{ type: 'text', text: '{"best": 2}' }], usage: { input_tokens: 4000, output_tokens: 50 } });
    }
    return reply(200, { content: [{ type: 'text', text: JSON.stringify(DESIGNS) }], usage: { input_tokens: 5000, output_tokens: 1200 } });
  }
  if (href.startsWith('https://api.groq.com/')) return reply(200, { choices: [{ message: { content: JSON.stringify(DESIGNS) } }] });
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/images/generations')) {
    const body = JSON.parse(options.body);
    if (gatewayMode === 'budget') return reply(402, { error: { message: 'Spend limit reached' } });
    assert.equal(body.model, 'bfl/flux-3-image-klein', 'the cheapest good image model by default');
    assert.match(body.prompt, /no people in focus/);
    assert.match(body.prompt, /no logos/);
    assert.doesNotMatch(body.prompt, /Fever|Clark/, 'no names or teams reach the image model');
    return reply(200, { data: [{ b64_json: '/9j/AAAA' }] });
  }
  if (href.includes('/rest/v1/frameup_ai_usage')) {
    usageRows.push(JSON.parse(options.body));
    return reply(201, {});
  }
  throw new Error(`unexpected fetch ${href}`);
};

process.env.AI_GATEWAY_API_KEY = 'gw-test';
process.env.GROQ_API_KEY = 'groq-test';
function load() {
  [genPath, imgPath, gwPath, mcpPath, authPath].forEach(p => delete require.cache[p]);
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }), verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }) } };
  require.cache[mcpPath] = { id: mcpPath, filename: mcpPath, loaded: true, exports: { isMcpConfigured: () => false, createSession: () => null } };
  return { gen: require(genPath), img: require(imgPath) };
}
const post = (handler, body) => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) }).then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));

let { gen, img } = load();
const t = gen._test;

// 1. Names in briefs, including Trend Design's labelled briefs.
assert.deepEqual(t.nameCandidates('Caitlin Clark scores 30 PTS 9 AST 6 REB against the Sky'), ['Caitlin Clark']);
assert.equal(t.nameCandidates('Headline: Are The Lakers Already Cooked?\nStory: Lakers drop fifth straight as LeBron James sits\nSport: NBA')[0], 'LeBron James', 'full names first');
assert.ok(t.nameCandidates('Headline: Are The Lakers Already Cooked?\nSport: NBA').includes('Lakers'));
assert.ok(!t.nameCandidates('Sport: NBA').includes('NBA'), 'the Sport label is not a name');
assert.deepEqual(t.nameCandidates('make a post about the lakers losing streak').slice(0, 1), ['lakers losing']);

// 2. Scene text never carries a name, team or brand.
assert.equal(t.sceneText('Empty basketball arena, Indiana Fever logo at center court'), 'empty basketball arena, logo at center court');
assert.equal(t.sceneText('Caitlin Clark'), '');

// 3. ES research by tag: exact tag (most used), newest tagged posts, cached.
calls = [];
const coverage = await t.esCoverage('Caitlin Clark scores 30 PTS against the Sky');
assert.deepEqual(coverage.tags.map(tag => tag.name), ['Caitlin Clark']);
assert.equal(coverage.articles.length, 3);
assert.ok(calls.some(url => url.includes('tags=42888')), 'posts come from the Caitlin Clark tag');
assert.ok(!calls.some(url => /posts\?search=/.test(url)), 'no slow full-text search when a tag matches');
calls = [];
await t.esCoverage('Caitlin Clark scores 30 PTS against the Sky');
assert.equal(calls.length, 0, 'the same brief is served from the research cache');
assert.equal((await t.esCoverage('make a post about the lakers losing streak')).tags[0].name, 'Los Angeles Lakers', 'a nickname finds the team tag');

// 4. Full run on the Gateway: Claude writes, Claude picks the photo (in parallel), cost reported.
t.COVERAGE_CACHE.clear();
usageRows = [];
let res = await post(gen.handler, { brief: 'Caitlin Clark scores 30 PTS 9 AST 6 REB against the Sky' });
assert.equal(res.status, 200);
assert.equal(res.body.brain, 'gateway:anthropic/claude-haiku-5.5');
assert.deepEqual(res.body.designs.map(d => d.postType), ['stats-single-ent', 'cover']);
const [stats] = res.body.designs;
assert.equal(stats.photo.sourceUrl, IMG(2), "Claude's pick (photo 2) is used");
assert.equal(stats.photos[0].sourceUrl, IMG(2), 'the pick leads the photo choices');
assert.equal(stats.photos.length, 3);
assert.equal(stats.scene, 'empty basketball arena under bright lights, logo at center court');
assert.equal(res.body.photo.picked, true);
assert.equal(res.body.ai.fallback, '');
assert.ok(res.body.meta.costUsd > 0 && res.body.meta.costUsd < 0.01, 'a run costs well under a cent');
assert.ok(res.body.meta.ms.total >= 0);
assert.deepEqual(usageRows.map(row => row.feature).sort(), ['generate', 'generate-photo-pick'], 'both AI calls are tracked');

// 5. Retry asks for a fresh take.
let prompt = '';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url).endsWith('/v1/messages') && typeof JSON.parse(options.body).messages[0].content === 'string') prompt = JSON.parse(options.body).messages[0].content;
  return realFetch(url, options);
};
await post(gen.handler, { brief: 'Caitlin Clark scores 30 PTS 9 AST 6 REB against the Sky', formats: ['stats-single-ent'], count: 1, avoid: ['Clark Delivers'] });
assert.match(prompt, /fresh take: do not reuse these lines: "Clark Delivers"/);
globalThis.fetch = realFetch;

// 6. Weekly budget used up: Groq writes, the page is told why, no second Gateway try.
gatewayMode = 'budget';
calls = [];
res = await post(gen.handler, { brief: 'Caitlin Clark scores 30 PTS 9 AST 6 REB against the Sky' });
assert.equal(res.status, 200);
assert.match(res.body.brain, /^groq:/);
assert.equal(res.body.ai.fallback, 'budget');
assert.equal(res.body.designs.length, 2);
assert.equal(res.body.designs[0].photo.sourceUrl, IMG(1), 'without the pick, the newest ES photo is used');
assert.equal(calls.filter(url => url.endsWith('/v1/messages')).length, 2, 'one design call + one photo pick, no retries');

// 7. Scene image: one click, one image, tracked with images: 1.
gatewayMode = 'ok';
usageRows = [];
res = await post(img.handler, { scene: 'Empty basketball arena, Indiana Fever logo', sport: 'WNBA' });
assert.equal(res.status, 200);
assert.equal(res.body.dataUrl, 'data:image/jpeg;base64,/9j/AAAA');
assert.equal(usageRows.length, 1);
assert.equal(usageRows[0].images, 1);
assert.equal(usageRows[0].feature, 'generate-scene-image');
assert.ok(usageRows[0].cost_usd > 0);
res = await post(img.handler, { scene: 'Caitlin Clark', sport: 'WNBA' });
assert.equal(res.status, 200, 'a name-only scene falls back to an empty arena for the sport');
assert.equal(res.body.scene, 'empty wnba stadium at night under bright floodlights');
gatewayMode = 'budget';
res = await post(img.handler, { scene: 'empty football stadium at night' });
assert.equal(res.status, 503);
assert.equal(res.body.reason, 'budget');
assert.equal((await img.handler({ httpMethod: 'GET', headers: {} })).statusCode, 405);

// 8. The per-user hourly cap.
gatewayMode = 'ok';
process.env.GENERATE_IMAGE_HOURLY_LIMIT = '1';
({ img } = load());
assert.equal((await post(img.handler, { scene: 'empty football stadium at night' })).status, 200);
assert.equal((await post(img.handler, { scene: 'empty football stadium at night' })).status, 429);

// 9. _ai-gateway stays backward compatible for Trend Design.
const gw = require(gwPath);
assert.equal(typeof gw.aiText, 'function');
assert.equal(typeof gw.gatewayConfigured, 'function');
assert.equal(gw.isBudgetError({ status: 402 }), true);
assert.equal(gw.isBudgetError(new Error('The operation timed out')), false);

console.log('es-generate fast research, photo pick and scene image checks passed');
