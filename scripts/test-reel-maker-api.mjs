#!/usr/bin/env node
// Reels Studio API: the Vercel adapter (api/reel-maker.js) and the handler
// (netlify/functions/reel-maker.js): sign-in, config, the plan mode (draft
// when AI is off or over the weekly cap; director otherwise), voice gating,
// cloud projects that degrade before the migration, and size limits.
// fetch (Supabase auth, RPCs, PostgREST) and the Gateway are mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
delete process.env.ELEVENLABS_API_KEY;
delete process.env.ELEVENLABS_VOICE_ID;
delete process.env.REELS_TTS;
process.env.AI_GATEWAY_API_KEY = 'gw-test';
const gateway = require('../netlify/functions/_ai-gateway.js');
const adapter = require('../api/reel-maker.js');
const { handler, _test } = require('../netlify/functions/reel-maker.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
const realFetch = globalThis.fetch;
const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let spend = 0;
let projectsTable = false;
const seen = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  seen.push({ url: u, opts });
  if (u.endsWith('/auth/v1/user')) {
    return String(opts.headers?.Authorization || '').includes('good') ? jsonResponse(200, { id: 'u1', email: 'Editor@EssentiallySports.com' }) : jsonResponse(401, {});
  }
  if (u.includes('/rpc/frameup_my_ai_spend')) return jsonResponse(200, [{ total_usd: spend }]);
  if (u.includes('/rpc/frameup_my_ai_calls_last_hour')) return jsonResponse(200, 0);
  if (u.includes('/rest/v1/frameup_ai_usage')) return new Response('', { status: 201 });
  if (u.includes('/rest/v1/frameup_reel_projects')) return projectsTable ? (opts.method === 'POST' ? new Response('', { status: 201 }) : jsonResponse(200, [{ id: 'p', title: 'Reel' }])) : jsonResponse(404, { code: 'PGRST205' });
  if (u.includes('/rest/v1/frameup_reel_events')) return projectsTable ? new Response('', { status: 201 }) : jsonResponse(404, {});
  throw new Error(`unexpected fetch ${u}`);
};
let aiCalls = 0;
gateway.aiText = async () => { aiCalls += 1; return { text: JSON.stringify({ format: 'stat', beats: [] }), model: 'anthropic/claude-haiku-5.5', cost: 0.001 }; };

function response() {
  return {
    headers: {}, statusCode: 0, payload: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.payload = payload; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}
const call = async (body, token = 'good') => {
  const res = await handler({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
const BRIEF = 'Josh Allen threw for 5,477 yards in 2025, the most in Bills history. Buffalo clinched the AFC East.';

await test('adapter: unauthenticated POST is 401; GET is 405 after sign-in', async () => {
  const res = response();
  await adapter({ method: 'POST', headers: {}, body: { mode: 'config' } }, res);
  assert.equal(res.statusCode, 401);
  const get = await handler({ httpMethod: 'GET', headers: { authorization: 'Bearer good' } });
  assert.equal(get.statusCode, 405);
  const res2 = response();
  await adapter({ method: 'POST', headers: { authorization: 'Bearer good' }, body: { mode: 'config' } }, res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.headers['content-type'], 'application/json');
});

await test('config: the Gateway key alone turns the house voice on; music bed off by default; no voice id leaks', async () => {
  const { status, body } = await call({ mode: 'config' });
  assert.equal(status, 200);
  assert.equal(body.ai, true);
  assert.equal(body.voice.mode, 'gateway');
  assert.equal(body.voice.model, 'elevenlabs/eleven-flash-v2.5');
  assert.equal(JSON.stringify(body).includes('CwhRBWXzGAHq8TQ4Fs17'), false);
  assert.equal(body.music.ready, false);
  assert.equal(body.music.rights.paid, false);
  assert.equal(body.factCheck.maxCostUsd, 0.03);
  process.env.REELS_TTS = 'off';
  const off = await call({ mode: 'config' });
  assert.equal(off.body.voice.mode, 'off');
  delete process.env.REELS_TTS;
});

await test('plan: over the weekly cap -> free draft, no model call, reason weekly-limit', async () => {
  spend = 25;
  aiCalls = 0;
  const { status, body } = await call({ mode: 'plan', brief: BRIEF, format: 'stat' });
  assert.equal(status, 200);
  assert.equal(body.source, 'draft');
  assert.equal(body.reason, 'weekly-limit');
  assert.match(body.notice, /limit/);
  assert.equal(aiCalls, 0);
  assert.equal(body.cost, 0);
  assert.ok(body.lint && typeof body.lint.critical === 'number');
  assert.equal(body.plan.beats[0].kind, 'hook');
  spend = 0;
});

await test('plan: under the cap the director runs (Haiku); a weak reply still returns a usable draft', async () => {
  aiCalls = 0;
  _test.PLAN_CACHE.clear();
  const { status, body } = await call({ mode: 'plan', brief: BRIEF, format: 'stat', tier: 'economy' });
  assert.equal(status, 200);
  assert.equal(aiCalls, 1);
  assert.equal(body.source, 'draft');
  assert.ok(body.plan.beats.length >= 3);
  assert.ok(body.sources.some(s => s.type === 'brief'));
  assert.match(body.corpus, /5,477/);
});

await test('plan: AI off (no Gateway key) -> draft with reason off', async () => {
  const key = process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  aiCalls = 0;
  const { body } = await call({ mode: 'plan', trend: { id: 't1', title: 'Scheffler wins by 4 at Augusta', sport: 'golf', related: [{ title: 'Scheffler shoots 66' }] } });
  assert.equal(body.reason, 'off');
  assert.equal(aiCalls, 0);
  assert.equal(body.plan.sport, 'golf');
  process.env.AI_GATEWAY_API_KEY = key;
});

await test('plan: needs a trend or a brief; bodies over 220 KB are refused', async () => {
  assert.equal((await call({ mode: 'plan' })).status, 400);
  const big = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer good' }, body: JSON.stringify({ mode: 'plan', brief: 'x'.repeat(230 * 1024) }) });
  assert.equal(big.statusCode, 413);
});

await test('voice: captions-only env -> 503 reason off; over the weekly cap -> 429; music off -> 503', async () => {
  process.env.REELS_TTS = 'off';
  let res = await call({ mode: 'voice', text: 'Josh Allen did it again.', beat: 'b1' });
  assert.equal(res.status, 503);
  assert.equal(res.body.reason, 'off');
  spend = 30;
  res = await call({ mode: 'voice', text: 'Josh Allen did it again.', beat: 'b1' });
  assert.equal(res.status, 429);
  assert.equal(res.body.reason, 'weekly-limit');
  spend = 0;
  delete process.env.REELS_TTS;
  res = await call({ mode: 'music', mood: 'hype', seconds: 30 });
  assert.equal(res.status, 503);
  assert.equal(res.body.reason, 'off');
});

await test('projects: before the migration -> cloud false (no error); after -> saved with the user session', async () => {
  projectsTable = false;
  const project = { id: '2b1f3e5c-1d2e-4f3a-9b8c-7d6e5f4a3b2c', title: 'Allen record', format: 'stat', sport: 'nfl', status: 'draft', timeline: { v: 1 }, cost_usd: 0.004 };
  let res = await call({ mode: 'project-save', project });
  assert.equal(res.status, 200);
  assert.equal(res.body.cloud, false);
  res = await call({ mode: 'projects' });
  assert.equal(res.body.cloud, false);
  assert.deepEqual(res.body.items, []);
  projectsTable = true;
  res = await call({ mode: 'project-save', project });
  assert.equal(res.body.saved, true);
  const save = seen.filter(s => s.url.includes('frameup_reel_projects') && s.opts.method === 'POST').at(-1);
  const row = JSON.parse(save.opts.body);
  assert.equal(row.user_email, 'editor@essentiallysports.com');
  assert.equal(save.opts.headers.Authorization, 'Bearer good', 'RLS: the user’s own session, never a service key');
  assert.match(save.opts.headers.Prefer, /merge-duplicates/);
  assert.equal((await call({ mode: 'project-save', project: { ...project, id: 'nope' } })).status, 400);
  assert.equal((await call({ mode: 'project-save', project: { ...project, timeline: { blob: 'x'.repeat(205 * 1024) } } })).status, 413);
  res = await call({ mode: 'event', type: 'export', projectId: project.id, format: 'stat', payload: { seconds: 31 } });
  assert.equal(res.body.cloud, true);
  assert.equal((await call({ mode: 'event', type: 'hack' })).status, 400);
});

await test('unknown mode is 400; revise with no reel is 400', async () => {
  assert.equal((await call({ mode: 'nope' })).status, 400);
  assert.equal((await call({ mode: 'revise', plan: { beats: [] } })).status, 400);
});

globalThis.fetch = realFetch;
console.log(process.exitCode ? '\nReel API tests failed.' : `\nAll ${passed} reel API tests passed.`);
