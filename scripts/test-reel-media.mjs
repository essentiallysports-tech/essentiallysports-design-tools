#!/usr/bin/env node
// Reels Studio AI media (netlify/functions/_reel-media.js) and the director's
// style components (_reel-director.js): AI scene stills (cached, logged,
// name-free), AI b-roll clips as async Gateway jobs (start -> poll status,
// cap per reel, cost, inline-size guard), and director output validation for
// the new beat kinds (numbers from the sources only). fetch is mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.AI_GATEWAY_API_KEY = 'gw-test';
const gateway = require('../netlify/functions/_ai-gateway.js');
const M = require('../netlify/functions/_reel-media.js');
const D = require('../netlify/functions/_reel-director.js');
const F = require('../reel-formats.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
const realFetch = globalThis.fetch;
const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const usage = [];
function mock(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    if (u.includes('frameup_ai_usage')) { usage.push(JSON.parse(opts.body)); return new Response('', { status: 201 }); }
    return handler(u, opts);
  };
  return calls;
}
const track = { email: 'a@essentiallysports.com', token: 'tok' };
const ON = { AI_GATEWAY_API_KEY: 'gw-test', REELS_AI_CLIPS: 'gateway' };

await test('scene still: name-free prompt, cached by prompt, logged as reels-scene, AI rights', async () => {
  usage.length = 0;
  const prompts = [];
  const calls = mock((url, opts) => { prompts.push(JSON.parse(opts.body).prompt); return jsonResponse(200, { data: [{ b64_json: '/9j/abc' }] }); });
  const a = await M.scene({ scene: 'crowd', sport: 'mlb', colors: ['#002D72'], track });
  assert.equal(a.ok, true);
  assert.match(a.dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(a.rights.ai, true);
  assert.match(prompts[0], /baseball|crowd/);
  assert.match(prompts[0], /No people/);
  const b = await M.scene({ scene: 'crowd', sport: 'mlb', colors: ['#002D72'], track });
  assert.equal(b.cached, true);
  assert.equal(calls.filter(c => c.url.includes('/images/generations')).length, 1);
  assert.equal(usage[0].feature, 'reels-scene');
});

await test('AI clip: off by default; start -> pending -> completed (URL); exact wire shape; billed once; cached', async () => {
  usage.length = 0;
  assert.equal((await M.clipStart({ scene: 'stadium', env: { AI_GATEWAY_API_KEY: 'gw' } })).reason, 'off');
  let polls = 0;
  const calls = mock((url, opts) => {
    if (url === `${M.VIDEO_BASE}/start`) {
      assert.equal(opts.headers['ai-model-id'], 'google/veo-3.1-lite-generate-001');
      assert.equal(opts.headers['ai-video-model-specification-version'], '4');
      assert.equal(opts.headers['ai-gateway-protocol-version'], '0.0.1');
      const body = JSON.parse(opts.body);
      assert.deepEqual([body.aspectRatio, body.duration, body.generateAudio, body.n], ['9:16', 4, false, 1]);
      assert.doesNotMatch(body.prompt, /Mahomes|Chiefs/);
      return jsonResponse(200, { operation: { gatewayJobId: 'job_1' }, warnings: [] });
    }
    if (url === `${M.VIDEO_BASE}/status`) {
      assert.deepEqual(JSON.parse(opts.body), { operation: { gatewayJobId: 'job_1' } });
      polls += 1;
      return polls < 3 ? jsonResponse(200, { status: 'pending' }) : jsonResponse(200, { status: 'completed', videos: [{ type: 'url', url: 'https://cdn.example/clip.mp4', mediaType: 'video/mp4' }] });
    }
    throw new Error(url);
  });
  const start = await M.clipStart({ scene: 'Mahomes in a Chiefs jersey', sport: 'nfl', track, env: ON });
  assert.equal(start.status, 'pending');
  assert.equal(start.cost, 0.12, '4 s x $0.03');
  let st;
  // The page's polling loop (mocked timer).
  for (let i = 0; i < 10; i += 1) { st = await M.clipStatus({ job: start.job, env: ON }); if (st.status !== 'pending') break; }
  assert.equal(polls, 3);
  assert.deepEqual([st.ok, st.status, st.url, st.rights.ai], [true, 'completed', 'https://cdn.example/clip.mp4', true]);
  assert.equal(usage.filter(r => r.feature === 'reels-ai-clip').length, 1, 'billed once, at start');
  const again = await M.clipStart({ scene: 'Mahomes in a Chiefs jersey', sport: 'nfl', track, env: ON });
  assert.equal(again.cached, true);
  assert.equal(calls.filter(c => c.url.endsWith('/start')).length, 1);
});

await test('AI clip: the per-reel cap (default 2, env), errors and oversized inline bytes fall back calmly', async () => {
  assert.equal((await M.clipStart({ scene: 'field', used: 2, env: ON })).reason, 'cap');
  assert.equal(M.clipsStatus({ ...ON, REELS_AI_CLIPS_MAX: '1' }).max, 1);
  assert.equal(M.clipsStatus(ON).perClip, 0.12);
  mock(url => (url.endsWith('/start') ? jsonResponse(200, { operation: 'op-2' }) : jsonResponse(200, { status: 'completed', videos: [{ type: 'base64', data: 'A'.repeat(3.5 * 1024 * 1024), mediaType: 'video/mp4' }] })));
  const s = await M.clipStart({ scene: 'ball', sport: 'mlb', env: ON });
  const big = await M.clipStatus({ job: s.job, env: ON });
  assert.equal(big.reason, 'too-large');
  mock(url => (url.endsWith('/start') ? jsonResponse(500, { error: { message: 'boom' } }) : jsonResponse(200, {})));
  const failed = await M.clipStart({ scene: 'trophy', env: ON });
  assert.equal(failed.ok, false);
  mock(() => jsonResponse(200, { status: 'error', error: 'safety' }));
  assert.equal((await M.clipStatus({ operation: 'x', env: ON })).status, 'error');
});

await test('cost: a 60 s reel with script, voice, a clip search, 2 AI clips and 2 scenes stays under $1', () => {
  const est = F.estimateCost({ tier: 'standard', voiceMode: 'gateway', voiceModel: 'elevenlabs/eleven-v4', voChars: 900, clipSearches: 1, aiClips: 2, scenes: 2, longForm: false });
  assert.ok(est.total < 1, `${est.total}`);
  assert.ok(est.lines.find(l => l.id === 'aiclips').usd === 0.24);
});

// ─── Director: the new beat kinds ─────────────────────────────────────────
const CORPUS = 'Mahomes averages 6.5 yards per throw. Out of 714 QB seasons since 2006, his 2018 season ranks 234th. 1 in 5 of his throws is pre-designed. Allen has 2× the turnover-worthy throws. The Steelers have -$12.3M in 2027 cap space.';
const read = { corpus: CORPUS, auto: false, route: F.routeFormat(''), sport: 'nfl', team: null };

await test('director: Series components validated, numbers sourced, strip and series tag kept', () => {
  const parsed = {
    format: 'explainer', title: 'Moneyball', series: { tag: 'ES Moneyball' }, strip: { label: '2027 cap space', value: '-$12.3M', tone: 'bad' },
    beats: [
      { kind: 'hook', text: 'Mahomes at 6.5 yards', vo: 'Mahomes averages just 6.5 yards per throw, and that is the story.' },
      { kind: 'dotrank', text: 'Ranked among 714 seasons', vo: 'Out of 714 quarterback seasons, his 2018 ranks 234th.', dotrank: { total: '714', rank: '234', label: '2018 Mahomes' } },
      { kind: 'chips', text: '1 in 5 is pre-designed', vo: 'One in five of his throws is pre-designed.', chips: { filled: '1', total: '5', label: 'pre-designed' } },
      { kind: 'bars', text: 'Turnover-worthy throws', vo: 'Allen has twice the turnover-worthy throws.', bars: [{ label: 'Mahomes', value: '1×' }, { label: 'Allen', value: '2×' }] },
      { kind: 'roles', text: 'Holes everywhere', vo: 'Here is where it breaks down.', roles: [{ role: 'WR', value: '#31' }, { role: 'LB', value: 'FA' }] },
      { kind: 'tiles', text: 'Who rebuilt', vo: 'These teams rebuilt.', tiles: [{ team: 'Baltimore Ravens', label: 'Rebuilt' }, { team: 'Pittsburgh Steelers', label: 'Next' }] },
      { kind: 'steps', text: 'Step two', vo: 'Step two of the plan.', steps: { current: '2', total: '3', label: 'Rebuild' } },
      { kind: 'cta', text: 'Can they fix it?', vo: 'Can they fix it? Tell us.' },
    ],
  };
  const out = D.validatePlan(parsed, { read, format: 'explainer', style: 'series' });
  const kinds = out.plan.beats.map(b => b.kind);
  assert.ok(!kinds.includes('dotrank'), 'the dot ranking is an Explainer component: coerced to a point in Series');
  assert.ok(D.validatePlan(parsed, { read, format: 'explainer', style: 'explainer' }).plan.beats.some(b => b.kind === 'dotrank' && b.dotrank.total === '714'));
  assert.ok(kinds.includes('chips') && kinds.includes('bars') && kinds.includes('tiles') && kinds.includes('steps'), kinds.join(','));
  assert.ok(!kinds.includes('roles'), 'roles with an unsourced #31 dropped');
  assert.ok(out.issues.some(i => /31/.test(i)));
  assert.equal(out.plan.strip.value, '-$12.3M');
  assert.equal(out.plan.series.tag, 'ES Moneyball');
  assert.equal(out.plan.style, 'series');
  const tiles = out.plan.beats.find(b => b.kind === 'tiles').tiles;
  assert.ok(tiles[0].colors.length && tiles[0].logo, 'team colours and logo resolved in code');
  assert.equal(out.plan.beats.find(b => b.kind === 'chips').visual, 'chart');
});

await test('director: invented strip numbers and components the style lacks are refused', () => {
  const parsed = { strip: { label: 'Cap', value: '$99M' }, beats: [
    { kind: 'hook', text: 'Mahomes at 6.5', vo: 'Mahomes averages 6.5 yards per throw this season, the lowest of his career by far.' },
    { kind: 'tiles', text: 'Teams', vo: 'Teams.', tiles: [{ team: 'Ravens' }, { team: 'Colts' }] },
    { kind: 'chips', text: '3 in 7', vo: 'Three in seven.', chips: { filled: '3', total: '7' } },
    { kind: 'cta', text: 'Thoughts?', vo: 'Thoughts? Tell us.' },
  ] };
  const ex = D.validatePlan(parsed, { read, format: 'explainer', style: 'explainer' });
  assert.equal(ex.plan.strip, undefined, 'the Explainer has no strip');
  assert.ok(!ex.plan.beats.some(b => b.kind === 'tiles'), 'tiles are a Series component: coerced to a point');
  assert.ok(!ex.plan.beats.some(b => b.kind === 'chips'), '3 in 7 is not in the sources');
  const series = D.validatePlan(parsed, { read, format: 'explainer', style: 'series' });
  assert.equal(series.plan.strip, undefined);
  assert.ok(series.issues.some(i => /data strip/.test(i)));
});

await test('director: long-form styles allow up to 24 beats; the prompt names only the style components; visuals and scenes kept', () => {
  const beats = [{ kind: 'hook', text: 'Mahomes at 6.5 yards', vo: 'Mahomes averages 6.5 yards per throw this season, and here is why that matters so much.', visual: 'clip', photo: 'Patrick Mahomes' }];
  for (let i = 0; i < 20; i += 1) beats.push({ kind: 'point', text: `Point ${i % 2 ? 'one' : 'two'}`, vo: 'This is a sourced point about the throws he makes.', visual: i % 3 ? 'photo' : 'scene', scene: 'crowd', photo: 'Kansas City Chiefs' });
  beats.push({ kind: 'cta', text: 'Is he back?', vo: 'Is he back? Tell us.' });
  const out = D.validatePlan({ beats }, { read, format: 'explainer', style: 'explainer' });
  assert.ok(out.plan.beats.length > 8 && out.plan.beats.length <= 24);
  assert.equal(out.plan.beats[0].visual, 'clip');
  assert.ok(out.plan.beats.some(b => b.visual === 'scene' && b.scene === 'crowd'));
  const classic = D.validatePlan({ beats }, { read, format: 'explainer', style: 'classic' });
  assert.ok(classic.plan.beats.length <= 8);
  const prompt = D.directorRequest({ read, format: 'explainer', style: require('../reel-styles.js').get('series') });
  assert.match(prompt, /tiles:/);
  assert.match(prompt, /LENGTH: this style runs long-form/);
  assert.doesNotMatch(D.directorRequest({ read, format: 'explainer', style: require('../reel-styles.js').get('explainer') }), /tiles:/);
});

await test('runReelDirector: a retired style is written in ES (Reels 2.0), same token budget; Haiku first as before', async () => {
  const seen = [];
  gateway.aiText = async opts => { seen.push(opts); return { text: '{"beats":[]}', model: 'anthropic/claude-haiku-5.5', cost: 0.002 }; };
  await D.runReelDirector({ brief: CORPUS, style: 'explainer', tier: 'economy' });
  await D.runReelDirector({ brief: CORPUS, style: 'classic', tier: 'economy' });
  assert.deepEqual(seen.map(s => s.tier), ['main', 'main']);
  // explainer and classic are retired: both requests are ES requests now.
  assert.equal(seen[0].maxTokens, seen[1].maxTokens);
  seen.forEach(s => assert.match(s.messages[0].content, /STYLE: ES Reels/));
});

globalThis.fetch = realFetch;
console.log(process.exitCode ? '\nReel media tests failed.' : `\nAll ${passed} reel media tests passed.`);
