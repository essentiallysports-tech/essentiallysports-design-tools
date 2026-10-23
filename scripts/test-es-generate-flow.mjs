// End-to-end checks for /api/es-generate with ES MCP, OpenAI and the ES site
// mocked: which "brain" runs, that every design passes the template checks,
// photos, fallbacks and auth.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const fnPath = path.join(fnDir, 'es-generate.js');
const mcpPath = path.join(fnDir, '_es-mcp.js');
const authPath = path.join(fnDir, '_supabase-auth.js');

const IMAGE = 'https://image-cdn.essentiallysports.com/wp-content/uploads/mahomes.jpg';
const ARTICLE = {
  id: 1,
  date: '2026-10-20T10:00:00',
  link: 'https://www.essentiallysports.com/nfl-news-mahomes-chiefs-win/',
  title: { rendered: 'Patrick Mahomes Leads Chiefs Past Raiders' },
  excerpt: { rendered: '<p>Mahomes threw for 320 yards.</p>' },
  yoast_head_json: { og_image: [{ url: IMAGE }] },
};
const AI_DESIGNS = {
  designs: [
    { postType: 'cover', title: 'Mahomes', sport: 'NFL', team: 'Kansas City Chiefs', fields: { pills: ['Patrick Mahomes', 'Not Done Yet'] }, photoQuery: 'Patrick Mahomes Chiefs', why: 'Big win, headline post.', sources: [ARTICLE.link] },
    { postType: 'quote', title: 'Too long', fields: { lines: ['This line is much too long for the quote'] } },
    { postType: 'stats-single-ent', title: 'Stats', sport: 'NFL', team: 'Kansas City Chiefs', fields: { headline: 'Mahomes Masterclass', stats: [{ value: '320', label: 'YDS' }, { value: '3', label: 'TD' }, { value: '1', label: 'INT' }] }, photoQuery: 'Patrick Mahomes', why: 'Three clean numbers.', sources: ['https://not-es.example.com/x'] },
  ],
};

let fetchCalls = [];
const groqRequests = [];
let groqReplies = [];
let openAiReply = { ok: true, body: { choices: [{ message: { content: JSON.stringify(AI_DESIGNS) } }] } };
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  fetchCalls.push(href);
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (href.startsWith('https://www.essentiallysports.com/wp-json/wp/v2/posts')) return reply(200, [ARTICLE]);
  if (href.startsWith('https://api.openai.com/')) {
    assert.match(JSON.parse(options.body).messages[0].content, /Patrick Mahomes Leads Chiefs Past Raiders/, 'the prompt includes ES research');
    return reply(openAiReply.ok ? 200 : 500, openAiReply.body);
  }
  if (href.startsWith('https://api.groq.com/openai/v1/chat/completions')) {
    const body = JSON.parse(options.body);
    groqRequests.push(body);
    return reply(200, { choices: [{ message: { content: groqReplies.shift() } }] });
  }
  throw new Error(`unexpected fetch ${href}`);
};

function mockModules({ mcp = null, authOk = true } = {}) {
  [fnPath, mcpPath, authPath].forEach(p => delete require.cache[p]);
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { verifyEsUser: async () => (authOk ? { ok: true, user: { email: 'a@essentiallysports.com' } } : { ok: false, statusCode: 401, error: 'Authentication required.' }) } };
  require.cache[mcpPath] = { id: mcpPath, filename: mcpPath, loaded: true, exports: { isMcpConfigured: () => Boolean(mcp), createSession: () => mcp } };
  return require(fnPath).handler;
}

const post = (handler, body) => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer x' }, body: JSON.stringify(body) }).then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));

// 1. ES MCP with a reasoning tool: MCP thinks, MCP finds photos, checks apply.
const mcpCalls = [];
const fakeMcp = {
  listTools: async () => [
    { name: 'search_images', description: 'Agency images', inputSchema: { properties: { query: { type: 'string' }, type: { type: 'string' } } } },
    { name: 'search_articles', description: 'ES news', inputSchema: { properties: { query: { type: 'string' } } } },
    { name: 'write_copy', description: 'Generate copy from a prompt', inputSchema: { properties: { prompt: { type: 'string' } }, required: ['prompt'] } },
  ],
  callTool: async (name, args) => {
    mcpCalls.push(name);
    if (name === 'search_images') return { content: [{ type: 'text', text: `**Mahomes**\nType: AGENCY · Full-resolution URL: ${IMAGE}` }] };
    if (name === 'search_articles') return { content: [{ type: 'text', text: `Mahomes article ${ARTICLE.link}` }] };
    if (name === 'write_copy') {
      assert.match(args.prompt, /ES MCP: search_articles/, 'MCP research reaches the prompt');
      return { content: [{ type: 'text', text: `Here you go:\n${JSON.stringify(AI_DESIGNS)}` }] };
    }
    throw new Error(`unknown tool ${name}`);
  },
};
let handler = mockModules({ mcp: fakeMcp });
let res = await post(handler, { brief: 'Patrick Mahomes after the Chiefs win: 320 YDS 3 TD 1 INT' });
assert.equal(res.status, 200);
assert.equal(res.body.brain, 'es-mcp:write_copy');
assert.deepEqual(res.body.designs.map(d => d.postType), ['cover', 'stats-single-ent'], 'the too-long quote is dropped');
assert.ok(res.body.notes.some(note => /Skipped design 2: quote/.test(note)));
const [cover, stats] = res.body.designs;
assert.deepEqual(cover.lines, ['Patrick Mahomes', 'Not Done Yet']);
assert.equal(cover.sport, 'NFL');
assert.equal(cover.team, 'Kansas City Chiefs');
assert.equal(cover.photo.url, `/api/es-image-search?image=${encodeURIComponent(IMAGE)}`);
assert.deepEqual(stats.lines, ['Mahomes Masterclass', '320 | YDS', '3 | TD', '1 | INT']);
assert.equal(stats.sources[0].url, ARTICLE.link, 'non-ES sources are replaced by real ES research');
assert.ok(mcpCalls.includes('search_articles') && mcpCalls.includes('write_copy'));
assert.equal(cover.hints.sport, 'NFL', 'league from the ES story URL');
assert.equal(cover.hints.person, 'mahomes');
assert.deepEqual(res.body.connection.roles, { think: 'write_copy', articles: 'search_articles', stats: null, trending: null, images: 'search_images' });
assert.equal(res.body.connection.mcpConfigured, true);
assert.ok(!fetchCalls.some(url => url.includes('openai')), 'OpenAI is not used when ES MCP can think');

// 2. No ES MCP, OpenAI key present: OpenAI thinks; photo from the ES story.
process.env.OPENAI_API_KEY = 'test-key';
process.env.GENERATE_USE_OPENAI = 'true';
fetchCalls = [];
handler = mockModules();
res = await post(handler, { brief: 'Patrick Mahomes after the Chiefs win', formats: ['cover'] });
assert.equal(res.body.brain, 'openai:gpt-4.1-mini');
assert.deepEqual(res.body.designs.map(d => d.postType), ['cover'], 'only requested formats survive');
assert.equal(res.body.designs[0].photo.sourceUrl, IMAGE);

// 3. The AI fails: draft mode takes over and says so.
openAiReply = { ok: false, body: { error: { message: 'rate limited' } } };
res = await post(handler, { brief: 'Patrick Mahomes after the Chiefs win' });
assert.equal(res.body.brain, 'draft');
assert.ok(res.body.notes.some(note => /AI step failed.*rate limited/.test(note)));
assert.ok(res.body.designs.length >= 1);
delete process.env.OPENAI_API_KEY;
delete process.env.GENERATE_USE_OPENAI;

// 3b. A key alone never calls OpenAI: it is opt-in (billed separately).
process.env.OPENAI_API_KEY = 'test-key';
fetchCalls = [];
handler = mockModules();
res = await post(handler, { brief: 'Patrick Mahomes after the Chiefs win' });
assert.equal(res.body.brain, 'draft');
assert.ok(!fetchCalls.some(url => url.includes('openai')), 'no OpenAI call without GENERATE_USE_OPENAI=true');
delete process.env.OPENAI_API_KEY;

// 3c. Groq (default when GROQ_API_KEY is set): one repair round for broken limits.
process.env.GROQ_API_KEY = 'groq-test';
groqReplies = [
  JSON.stringify(AI_DESIGNS),
  JSON.stringify({ designs: [{ postType: 'quote', title: 'Fixed', sport: 'NFL', team: 'Kansas City Chiefs', fields: { lines: ['We Are Not', 'Done Yet'] }, photoQuery: 'Patrick Mahomes Chiefs' }] }),
];
handler = mockModules();
res = await post(handler, { brief: 'Patrick Mahomes after the Chiefs win: "We are not done yet"' });
assert.equal(res.body.brain, 'groq:openai/gpt-oss-120b');
assert.equal(res.body.connection.ai, 'groq');
assert.deepEqual(res.body.designs.map(d => d.postType), ['cover', 'stats-single-ent', 'quote'], 'the repaired quote is added');
assert.equal(groqRequests.length, 2, 'exactly one repair round');
assert.equal(groqRequests[0].response_format.type, 'json_object');
assert.match(groqRequests[0].messages[0].content, /use those exact words/, 'brief text is kept verbatim');
assert.match(groqRequests[1].messages[2].content, /design 2: quote needs 1-3 lines of max 18 chars/, 'repair names the broken limit');
assert.equal(new Set(res.body.designs.map(d => d.id)).size, 3, 'unique design ids');

// 3d. GENERATE_AI=rules turns AI off even with a key.
process.env.GENERATE_AI = 'rules';
groqRequests.length = 0;
handler = mockModules();
res = await post(handler, { brief: 'Patrick Mahomes after the Chiefs win' });
assert.equal(res.body.brain, 'draft');
assert.equal(groqRequests.length, 0);
delete process.env.GENERATE_AI;
delete process.env.GROQ_API_KEY;

// 4. Guards: auth, empty brief, method.
handler = mockModules({ authOk: false });
assert.equal((await post(handler, { brief: 'Patrick Mahomes' })).status, 401);
handler = mockModules();
assert.equal((await post(handler, { brief: 'x' })).status, 400);
assert.equal((await handler({ httpMethod: 'DELETE', headers: {} })).statusCode, 405);

// 5. GET reports what is connected (tool names only for signed-in users).
handler = mockModules({ mcp: fakeMcp });
const health = JSON.parse((await handler({ httpMethod: 'GET', headers: {} })).body);
assert.equal(health.brain, 'es-mcp:write_copy');
assert.deepEqual(health.roles, { think: 'write_copy', articles: 'search_articles', stats: null, trending: null, images: 'search_images' });
assert.deepEqual(health.tools, ['search_images', 'search_articles', 'write_copy']);

console.log('es-generate flow checks passed');
