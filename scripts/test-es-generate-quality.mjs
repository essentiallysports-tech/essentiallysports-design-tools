// Generate quality pass (every network call mocked):
//   - the writer's alternatives survive the brand checks,
//   - the art-director review (different model family) picks the best option,
//   - a low-scoring card gets one rewrite from the best model (Sonnet),
//   - the one-card "rewrite" mode returns only versions that pass every rule.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const genPath = path.join(fnDir, 'es-generate.js');
const gwPath = path.join(fnDir, '_ai-gateway.js');
const mcpPath = path.join(fnDir, '_es-mcp.js');
const authPath = path.join(fnDir, '_supabase-auth.js');

const POSTS = [1, 2].map(n => ({
  id: n, date: `2026-11-1${n}T10:00:00`, link: `https://www.essentiallysports.com/wnba-news-clark-${n}/`,
  title: { rendered: `Caitlin Clark story ${n} with the Indiana Fever` },
  excerpt: { rendered: '<p>Clark and the Fever.</p>' },
  content: { rendered: '<p>Caitlin Clark scored 30 points with 9 assists and 6 rebounds against the Sky.</p>' },
  yoast_head_json: { og_image: [{ url: `https://image-cdn.essentiallysports.com/wp-content/uploads/clark-${n}.jpg` }] },
}));
const STATS = [{ value: '30', label: 'PTS' }, { value: '9', label: 'AST' }, { value: '6', label: 'REB' }];
const WRITER = { designs: [
  { postType: 'cover', sport: 'WNBA', team: 'Indiana Fever', fields: { pills: ['Can Anyone', 'Stop Clark?'] }, alts: [{ pills: ['Clark Is', 'Different'] }, { pills: ['Who Stops', 'Caitlin Clark?'] }], photoQuery: 'Caitlin Clark', why: 'A hook.' },
  { postType: 'stats-single-ent', sport: 'WNBA', team: 'Indiana Fever', fields: { headline: 'Clark Delivers', stats: STATS }, alts: [{ headline: 'Clark Shows Out', stats: STATS }], photoQuery: 'Caitlin Clark', why: 'Real numbers.' },
] };

const seen = { review: 0, escalate: 0, rewrite: 0 };
let rewriteReply = { fields: { pills: ['Clark Runs', 'This League'] } };
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('/wp-json/wp/v2/tags')) return reply(200, /caitlin clark/i.test(new URL(href).searchParams.get('search')) ? [{ id: 42888, name: 'Caitlin Clark', count: 5239 }] : []);
  if (href.includes('/wp-json/wp/v2/posts')) return reply(200, new URL(href).searchParams.get('tags') ? POSTS : []);
  if (href.includes('/rest/v1/frameup_ai_usage')) return reply(201, {});
  if (href.includes('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, 0);
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/chat/completions')) {
    // The art director (OpenAI family, not the Claude writer).
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'openai/gpt-6-luna', 'the review uses a different model family');
    seen.review += 1;
    const verdict = { cards: [{ card: 1, best: 2, score: 4.4, note: '' }, { card: 2, best: 0, score: 2.8, note: 'the headline is generic' }] };
    return reply(200, { choices: [{ message: { content: JSON.stringify(verdict) }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 80 } });
  }
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) {
    const body = JSON.parse(options.body);
    const content = body.messages[0].content;
    const usage = { input_tokens: 3000, output_tokens: 400 };
    if (Array.isArray(content)) return reply(200, { content: [{ type: 'text', text: '{"best": 1}' }], usage });
    if (body.model === 'anthropic/claude-sonnet-5.5' && /Rewrite each Instagram design/.test(content)) {
      seen.escalate += 1;
      assert.match(content, /the headline is generic/, "Sonnet sees the art director's note");
      return reply(200, { content: [{ type: 'text', text: JSON.stringify({ designs: [{ postType: 'stats-single-ent', fields: { headline: 'No One Can Stop Her', stats: STATS } }] }) }], usage });
    }
    if (/Rewrite this Instagram design/.test(content)) {
      seen.rewrite += 1;
      return reply(200, { content: [{ type: 'text', text: JSON.stringify(rewriteReply) }], usage });
    }
    return reply(200, { content: [{ type: 'text', text: JSON.stringify(WRITER) }], usage: { input_tokens: 5000, output_tokens: 1200 } });
  }
  throw new Error(`unexpected fetch ${href}`);
};

process.env.AI_GATEWAY_API_KEY = 'gw-test';
[genPath, gwPath, mcpPath, authPath].forEach(p => delete require.cache[p]);
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }), verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }) } };
require.cache[mcpPath] = { id: mcpPath, filename: mcpPath, loaded: true, exports: { isMcpConfigured: () => false, createSession: () => null } };
const gen = require(genPath);
const post = body => gen.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) }).then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));

const brief = 'Caitlin Clark scores 30 PTS 9 AST 6 REB against the Sky';
const res = await post({ brief });
assert.equal(res.status, 200);
const [cover, stats] = res.body.designs;

// 1. The reviewer preferred the cover's second alternative: it leads now.
assert.deepEqual(cover.lines, ['Who Stops', 'Caitlin Clark?']);
assert.deepEqual(cover.alts[0].lines, ['Can Anyone', 'Stop Clark?'], 'the old version stays one click away');
assert.equal(cover.review.score, 4.4);

// 2. The stats card scored 2.8: Sonnet rewrote it, and the rewrite passed the checks.
assert.equal(stats.fields.headline, 'No One Can Stop Her');
assert.equal(stats.review.escalated, true);
assert.equal(stats.alts[0].fields.headline, 'Clark Delivers');
assert.deepEqual(res.body.quality, { reviewed: true, improved: 1 });
assert.equal(seen.review, 1);
assert.equal(seen.escalate, 1, 'only the low-scoring card is escalated, in one call');
assert.ok(res.body.meta.costUsd < 0.05, 'a reviewed run with one escalation stays a few cents at most');

// 3. One-card rewrite: a version that passes every rule comes back.
let rw = await post({ mode: 'rewrite', instruction: 'punchier', brief, spec: cover });
assert.equal(rw.status, 200);
assert.deepEqual(rw.body.design.lines, ['Clark Runs', 'This League']);

// 4. A rewrite that invents a number is refused, never shown.
rewriteReply = { fields: { pills: ['Clark Drops', '45 Tonight'] } };
rw = await post({ mode: 'rewrite', instruction: 'shorter', brief, spec: cover });
assert.equal(rw.status, 422);
assert.match(rw.body.issues.join(' '), /45/);

// 5. Unknown instructions are rejected.
assert.equal((await post({ mode: 'rewrite', instruction: 'make-it-viral', brief, spec: cover })).status, 400);

console.log('Generate quality pass tests passed.');
