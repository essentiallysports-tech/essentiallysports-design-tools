#!/usr/bin/env node
// Reels radar (netlify/functions/reel-radar.js, api/reel-radar.js, the
// reel-radar.js helpers and the sample data). Every network call is mocked (no
// X, no clip library, no AI, no Supabase):
//   find: the library first, a FREE top-up only, the trust filter, de-duping,
//   ranking by views per hour ("views unknown" handled), the cap, older clips
//   labelled, sports that are not covered, the 30-minute cache, and that no
//   media address is returned or stored; analyze: the prompt, known clip ids
//   only, the numbers check, briefs with no numbers or quotes, free mode, cost
//   logging, the cache; the adapter and vercel.json; sample-data hosts.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const authPath = path.join(fnDir, '_supabase-auth.js');
process.env.AI_GATEWAY_API_KEY = 'gw-test';
delete process.env.X_BEARER_TOKEN;

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
let signedIn = true;
let weeklySpend = 0;
let usageRows = [];
let aiBodies = [];
let aiReply = () => { throw new Error('unexpected AI call'); };
let otherFetches = [];
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, 0);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_spend') || href.includes('/rest/v1/rpc/frameup_team_ai_spend')) return reply(200, [{ total_usd: weeklySpend }]);
  if (href.includes('/rest/v1/frameup_ai_usage')) { usageRows.push(JSON.parse(options.body)); return reply(201, {}); }
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) { const body = JSON.parse(options.body); aiBodies.push(body); return aiReply(body); }
  otherFetches.push(href);
  throw new Error(`unexpected fetch ${href}`);
};
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: () => 'tok',
  verifyEsUser: async () => (signedIn ? { ok: true, user: { email: 'a@essentiallysports.com' } } : { ok: false, statusCode: 401, error: 'Authentication required.' }),
} };

const gateway = require('../netlify/functions/_ai-gateway.js');
const REAL = require('../netlify/functions/video-ads.js').clipPipeline;
const MOMENTS = require('../video-ads-moments.js');
const { handler, _test: T } = require('../netlify/functions/reel-radar.js');
const adapter = require('../api/reel-radar.js');
const CORE = require('../reel-radar.js');
const SAMPLE = require('../reel-b-sample.js');

const NOW = Date.parse('2026-11-25T12:00:00Z');
const clipOf = (n, { handle = 'dallascowboys', views = 0, likes = 0, hours = 5, secs = 20, text = '', score = 50 } = {}) => ({
  url: `https://x.com/${handle}/status/${1000 + n}`, handle, text: text || `Dak Prescott clip number ${n} from the game tonight`, thumb: `https://pbs.twimg.com/media/t${n}.jpg`,
  duration: secs, durationMs: secs * 1000 + n, postedAt: new Date(NOW - hours * 3600e3).toISOString(), ageHours: hours,
  variants: [{ url: `https://video.twimg.com/ext_tw_video/${5000 + n}/pu/vid/1280x720/v.mp4`, width: 1280, height: 720 }],
  source: 'official', sourceKind: 'official', shortSide: 720, views, likes, platform: 'x', score, trust: { kind: 'official', label: 'Team account' },
});
let lib = { fresh: [], older: [] };
let calls = { library: 0, round: [], sources: [], saved: 0, written: 0 };
let live = { round: [], sources: [] };
const pipeline = {
  ...REAL,
  libraryClips: async args => { calls.library += 1; calls.libraryArgs = args; return lib; },
  searchRound: async (plan, opts) => { calls.round.push(opts); return { clips: live.round, cost: 0, diag: {} }; },
  runSources: async (opts, cfg) => { calls.sources.push(cfg); return { clips: live.sources, cost: 0, diag: {} }; },
  saveToLibrary: async () => { calls.saved += 1; return 0; },
  CLIP_LIBRARY: { ...REAL.CLIP_LIBRARY, write: async () => { calls.written += 1; return { written: 0 }; } },
};
const deps = { pipeline, moments: MOMENTS, now: () => NOW };
const track = { email: 'a@essentiallysports.com', token: 'tok' };
const find = async body => { const res = await T.findMode(body, track, deps); return { status: res.statusCode, body: JSON.parse(res.body) }; };
const reset = () => { T.resetCache(); lib = { fresh: [], older: [] }; live = { round: [], sources: [] }; calls = { library: 0, round: [], sources: [], saved: 0, written: 0 }; usageRows = []; aiBodies = []; otherFetches = []; weeklySpend = 0; signedIn = true; };

await test('find: ranked by views per hour, trusted accounts only, de-duplicated, capped', async () => {
  reset();
  lib.fresh = [
    clipOf(1, { views: 100000, hours: 50, score: 90 }), // 2,000 an hour
    clipOf(2, { views: 60000, hours: 2, handle: 'NFL', score: 40 }), // 30,000 an hour
    clipOf(3, { views: 900000, hours: 10, handle: 'RandomFan123', score: 99 }), // not on the allowlist
    clipOf(4, { views: 20000, hours: 4, handle: 'espn', score: 30 }), // 5,000 an hour
    { ...clipOf(5, { views: 10, hours: 1 }), url: clipOf(2).url }, // the same post again
    ...Array.from({ length: 14 }, (_, i) => clipOf(20 + i, { views: 1000 + i, hours: 20 })),
  ];
  const { status, body } = await find({ mode: 'find', topic: 'Dak Prescott extension', sport: 'nfl' });
  assert.equal(status, 200);
  assert.equal(body.ranking, 'views-per-hour');
  assert.equal(body.clips.length, T.RADAR.maxClips, 'capped at 12');
  assert.deepEqual(body.clips.slice(0, 3).map(c => c.handle), ['NFL', 'espn', 'dallascowboys'], 'fastest first, not biggest or best-scored first');
  assert.deepEqual(body.clips.slice(0, 3).map(c => c.velocity), [30000, 5000, 2000]);
  assert.deepEqual(body.clips.map(c => c.id).slice(0, 3), ['c1', 'c2', 'c3']);
  assert.ok(!body.clips.some(c => c.handle === 'RandomFan123'), 'untrusted accounts never show');
  assert.equal(body.diag.untrusted, 1);
  assert.equal(new Set(body.clips.map(c => c.url)).size, body.clips.length, 'no repeats');
  const top = body.clips[0];
  assert.deepEqual(Object.keys(top).sort(), ['ageHours', 'caption', 'duration', 'handle', 'id', 'likes', 'postedAt', 'source', 'sourceLabel', 'thumb', 'url', 'velocity', 'views', 'viewsKnown'].sort());
  assert.equal(top.ageHours, 2);
  assert.equal(top.duration, 20);
  assert.equal(body.cost.usd, 0);
  assert.equal(calls.round.length, 0, 'the library had enough: no live search');
});

await test('find: no media is returned, stored or proxied', async () => {
  reset();
  lib.fresh = Array.from({ length: 8 }, (_, i) => clipOf(i, { views: 5000 * (i + 1) }));
  const { body } = await find({ mode: 'find', topic: 'Dak Prescott extension', sport: 'nfl' });
  const text = JSON.stringify(body);
  assert.ok(!/video\.twimg\.com|\.mp4|variants/.test(text), 'no file addresses in the reply');
  assert.ok(!/video\.twimg\.com|\.mp4|variants/.test(JSON.stringify([...T.CACHE.values()])), 'nor in the cache');
  assert.equal(calls.saved + calls.written, 0, 'the radar never writes to the clip library');
  assert.equal(otherFetches.length, 0, 'and fetches nothing itself');
  assert.ok(body.clips.every(c => /^https:\/\/x\.com\//.test(c.url) && /^https:\/\/pbs\.twimg\.com\//.test(c.thumb)));
  const src = fs.readFileSync('netlify/functions/reel-radar.js', 'utf8');
  assert.ok(!/saveToLibrary\(|CLIP_LIBRARY\.write|setEngagement|supabase-rest/.test(src), 'no storage call in the function');
});

await test('find: a thin library gets a FREE top-up only; older clips are labelled; "views unknown" ranks by age', async () => {
  reset();
  lib.fresh = [clipOf(1, { likes: 0, views: 0, hours: 9 })];
  lib.older = [clipOf(40, { views: 0, hours: 150 }), clipOf(41, { views: 0, hours: 160 })];
  live.round = [clipOf(2, { views: 0, hours: 3, handle: 'NFL' })];
  const { body } = await find({ mode: 'find', topic: 'Cowboys beat Eagles', sport: 'nfl' });
  assert.equal(calls.round.length, 1);
  assert.equal(calls.round[0].freeOnly, true, 'never the paid web search');
  assert.equal(calls.round[0].maxCostUsd, 0);
  assert.equal(calls.sources[0].freeOnly, true);
  assert.equal(calls.sources[0].paid, false);
  assert.equal(calls.libraryArgs.teams[0].name, 'Dallas Cowboys', 'a named team narrows the library read');
  assert.equal(body.team, 'Dallas Cowboys');
  assert.equal(body.ranking, 'newest');
  assert.deepEqual(body.clips.map(c => [c.handle, c.ageHours, Boolean(c.older)]), [['NFL', 3, false], ['dallascowboys', 9, false], ['dallascowboys', 150, true], ['dallascowboys', 160, true]]);
  assert.ok(body.clips.every(c => c.viewsKnown === false && c.velocity === 0));
  assert.match(body.note, /No view counts/);
  // Likes stand in when a clip has no view count.
  reset();
  lib.fresh = [clipOf(1, { views: 0, likes: 4000, hours: 4 }), clipOf(2, { views: 50000, hours: 5 }), ...Array.from({ length: 5 }, (_, i) => clipOf(10 + i, { views: 100, hours: 30 }))];
  const mixed = (await find({ mode: 'find', topic: 'Dak Prescott extension', sport: 'nfl' })).body;
  assert.equal(mixed.ranking, 'views-per-hour');
  assert.match(mixed.note, /ranked by likes/);
  assert.equal(mixed.clips.find(c => c.likes === 4000).viewsKnown, false);
});

await test('find: nothing found, sports that are not covered, bad input', async () => {
  reset();
  const none = await find({ mode: 'find', topic: 'Dak Prescott extension', sport: 'nfl' });
  assert.equal(none.body.ok, true);
  assert.deepEqual(none.body.clips, []);
  assert.match(none.body.note, /No official clips/);
  assert.equal(T.CACHE.size, 0, 'an empty result is not cached');
  for (const sport of ['nba', 'tennis', 'nascar', 'golf', '']) {
    const out = await find({ mode: 'find', topic: 'Lakers trade for a center', sport });
    assert.equal(out.body.supported, false, sport);
    assert.equal(out.body.note, T.NOT_COVERED);
  }
  assert.equal(calls.library, 1, 'no clip call for a sport without trusted sources');
  assert.equal((await find({ mode: 'find', topic: 'x', sport: 'nfl' })).status, 400);
  const viaTrend = await find({ mode: 'find', trend: { id: 't1', title: 'Dak Prescott extension', sport: 'nfl' } });
  assert.equal(viaTrend.body.query, 'Dak Prescott extension');
});

await test('find: repeat lookups within 30 minutes come from memory', async () => {
  reset();
  lib.fresh = Array.from({ length: 7 }, (_, i) => clipOf(i, { views: 1000 * (i + 1) }));
  await find({ mode: 'find', topic: 'Dak Prescott extension', sport: 'nfl' });
  const again = await find({ mode: 'find', topic: 'dak prescott EXTENSION', sport: 'nfl' });
  assert.equal(again.body.cost.cached, true);
  assert.equal(calls.library, 1);
  const res = await T.findMode({ mode: 'find', topic: 'Dak Prescott extension', sport: 'nfl' }, track, { ...deps, now: () => NOW + T.CACHE_TTL_MS + 1000 });
  assert.equal(JSON.parse(res.body).cost.cached, false);
  assert.equal(calls.library, 2);
});

const CLIPS = [
  { id: 'c1', handle: 'NFL', caption: 'Dak Prescott signs for 4 more years', views: 60000, likes: 900, ageHours: 2, duration: 20, velocity: 30000, source: 'league' },
  { id: 'c2', handle: 'dallascowboys', caption: 'He is staying home', views: 100000, likes: 2100, ageHours: 50, duration: 41, velocity: 2000, source: 'official' },
  { id: 'c3', handle: 'espn', caption: 'The panel reacts', views: 0, likes: 0, ageHours: null, duration: 0, velocity: 0, source: 'media' },
];
const GOOD = {
  read: 'Short clips from the league account are travelling fastest, with c1 at 30k views an hour.',
  patterns: [
    { label: 'Length', detail: 'The fastest clip, c1, runs 20 seconds and c2 runs 41.', clips: ['c1', 'c2', 'c9'] },
    { label: 'Reach', detail: 'c2 has 100k views after 2 days.', clips: ['c2'] },
    { label: 'Hook', detail: 'About 73% of viewers likely drop after 5 seconds.', clips: ['c1'] },
    { label: 'Caption', detail: 'Captions state the news in the first words.', clips: [] },
  ],
  briefs: [
    { lens: 'fan-first', title: 'What Dallas gets', hook: 'He stayed. Now what?', brief: 'Open on the signing, then say what it means for fans. End on a question.' },
    { lens: 'money', title: 'The 60 million question', hook: 'Follow the money', brief: 'Lead with the figure.' },
    { lens: 'verdict', title: 'A legend rules', hook: 'He said "bad decision"', brief: 'Open on the verdict.' },
    { lens: 'fan-first', title: 'A repeat lens', hook: 'Again', brief: 'The same lens twice.' },
    { lens: 'behind-the-moment', title: 'The room', hook: 'Before the cameras', brief: 'Show what happened around the announcement, then why it matters.' },
  ],
};
const haiku = text => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 1700, output_tokens: 900 }, content: [{ type: 'text', text }] });
const analyze = async body => { const res = await T.analyzeMode(body, track); return { status: res.statusCode, body: JSON.parse(res.body) }; };

await test('analyze: one Haiku call; known clip ids; every number checked against the fetched stats; briefs carry no numbers or quotes', async () => {
  reset();
  aiReply = () => haiku('```json\n' + JSON.stringify(GOOD) + '\n```');
  const { status, body } = await analyze({ mode: 'analyze', topic: 'Dak Prescott extension', sport: 'nfl', clips: CLIPS });
  assert.equal(status, 200);
  assert.equal(body.ai, true);
  assert.equal(aiBodies.length, 1);
  assert.equal(aiBodies[0].model, gateway.MODELS.main, 'the cheap main tier');
  assert.equal(T.ANALYZE_TIER, 'main');
  assert.match(T.ANALYZE_SYSTEM, /cannot watch the videos/);
  assert.match(T.ANALYZE_SYSTEM, /style reference, not a fact source/);
  const prompt = aiBodies[0].messages[0].content;
  assert.match(prompt, /"id":"c1".*"seconds":20.*"viewsPerHour":30000/);
  assert.ok(!/variants|mp4|thumb|https:/.test(prompt), 'only captions and counts go to the model');
  const a = body.analysis;
  assert.match(a.read, /30k views an hour/, 'a fetched stat in its short form is allowed');
  assert.deepEqual(a.patterns.map(p => p.label), ['Length', 'Reach', 'Caption'], 'the invented 73% and 5 seconds are dropped');
  assert.deepEqual(a.patterns[0].clips, ['c1', 'c2'], 'unknown clip ids are removed');
  assert.deepEqual(a.briefs.map(b => b.lens), ['fan-first', 'behind-the-moment'].concat(a.briefs.slice(2).map(b => b.lens)));
  assert.equal(a.briefs.length, 3, 'always three briefs');
  assert.equal(a.briefs[2].free, true, 'a template fills the gap, labelled');
  assert.ok(a.briefs.every(b => !/\d/.test(`${b.title} ${b.hook} ${b.brief}`) && !/["“”]/.test(`${b.title} ${b.hook} ${b.brief}`)));
  assert.equal(a.dropped, 3);
  const row = usageRows.find(x => x.feature === 'reels-radar-analyze');
  assert.ok(row && row.ok, 'logged as reels-radar-analyze');
  assert.ok(Math.abs(body.cost.usd - 0.00062) < 1e-6, `cost ${body.cost.usd}`);
  assert.ok(body.cost.usd <= T.PRICES.analyze);
  assert.equal(T.PRICES.analyze, CORE.PRICES.analyze, 'the page shows the server\'s price');
  const again = await analyze({ mode: 'analyze', topic: 'Dak Prescott extension', sport: 'nfl', clips: CLIPS });
  assert.equal(again.body.cost.cached, true);
  assert.equal(aiBodies.length, 1, 'a repeat read is free');
});

await test('numbers check units', async () => {
  const allowed = T.allowedNumbers(T.cleanClips(CLIPS));
  assert.deepEqual(T.inventedNumbers('c1 runs 20 seconds with 60,000 views (60k), 30k an hour, 2 hours old; c2 is 2 days old', allowed), []);
  assert.deepEqual(T.inventedNumbers('It got 75k views and a 12% lift', allowed), ['75k', '12']);
  assert.deepEqual(T.inventedNumbers('signs for 4 more years', allowed), [], 'numbers in a caption may be repeated');
  assert.equal(T.cleanClips(Array.from({ length: 30 }, (_, i) => ({ caption: `clip ${i}` }))).length, T.RADAR.maxClips);
  assert.equal(T.cleanClips([{ id: 'c1', caption: '<b>hi</b> there', views: '12', extra: 'x', variants: [1] }])[0].variants, undefined);
});

await test('analyze: free mode (over budget, AI off) counts patterns in code; a garbled or failed AI reply is a calm error', async () => {
  reset();
  aiReply = () => { throw new Error('no AI when over budget'); };
  weeklySpend = 999;
  const free = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ mode: 'analyze', topic: 'Dak Prescott extension', clips: CLIPS }) });
  const body = JSON.parse(free.body);
  assert.equal(free.statusCode, 200);
  assert.equal(body.ai, false);
  assert.equal(body.cost.usd, 0);
  assert.equal(aiBodies.length, 0);
  assert.ok(body.analysis.patterns.some(p => p.label === 'Length' && /20 seconds/.test(p.detail)), 'the median of the real lengths');
  assert.ok(body.analysis.patterns.some(p => /1 of these 3 clips/.test(p.detail)));
  assert.equal(body.analysis.briefs.length, 3);
  assert.ok(body.analysis.briefs.every(b => !/\d/.test(`${b.title} ${b.brief}`)));
  weeklySpend = 0;
  const key = process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  assert.equal((await analyze({ mode: 'analyze', topic: 'Another story', clips: CLIPS })).body.reason, 'off');
  process.env.AI_GATEWAY_API_KEY = key;
  aiReply = () => haiku('not json at all');
  assert.equal((await analyze({ mode: 'analyze', topic: 'Garbled', clips: CLIPS })).status, 502);
  aiReply = () => reply(500, { error: { message: 'boom' } });
  const failed = await analyze({ mode: 'analyze', topic: 'Failed', clips: CLIPS });
  assert.equal(failed.status, 502);
  assert.match(failed.body.error, /couldn't read these clips/);
  assert.equal((await analyze({ mode: 'analyze', clips: [] })).status, 400);
});

await test('handler and adapter: sign-in, status, methods, size cap, vercel.json', async () => {
  reset();
  const post = async (body, raw) => { const res = await handler({ httpMethod: 'POST', headers: {}, body: raw || JSON.stringify(body) }); return { status: res.statusCode, body: JSON.parse(res.body) }; };
  const status = await post({ mode: 'status' });
  assert.equal(status.status, 200);
  assert.deepEqual(status.body.sports, ['nfl', 'cfb', 'mlb']);
  assert.equal(status.body.xApi, false);
  assert.deepEqual(status.body.prices, { find: 0, analyze: 0.001 });
  assert.equal(status.body.cacheMinutes, 30);
  assert.equal((await post({ mode: 'nope' })).status, 400);
  assert.equal((await post(null, '{bad')).status, 400);
  assert.equal((await post(null, JSON.stringify({ mode: 'find', topic: 'x'.repeat(70000) }))).status, 413);
  assert.equal((await handler({ httpMethod: 'GET', headers: {} })).statusCode, 405);
  signedIn = false;
  assert.equal((await post({ mode: 'status' })).status, 401);
  const res = { headers: {}, statusCode: 0, payload: null, setHeader(n, v) { this.headers[n.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, send(p) { this.payload = p; return this; }, json(p) { this.payload = p; return this; } };
  await adapter({ method: 'POST', headers: {}, body: { mode: 'status' } }, res);
  assert.equal(res.statusCode, 401);
  signedIn = true;
  await adapter({ method: 'POST', headers: {}, body: { mode: 'status' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  assert.deepEqual(vercel.functions['api/reel-radar.js'], { maxDuration: 60 });
});

await test('page helpers and sample data: hosts, labels, the hand-off is a note and never a source', async () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]', 'frameup.localhost', 'frameup.test']) assert.equal(CORE.isDemo({ hostname: host, search: '' }), true, host);
  assert.equal(CORE.isDemo({ hostname: 'localhost', search: '?demo=off' }), false);
  assert.equal(CORE.isDemo({ hostname: 'frameup.essentiallysports.com', search: '?demo=reels' }), false, 'never on production');
  assert.equal(CORE.isDemo({ hostname: 'essentiallysports-design-tools.vercel.app', search: '?demo=reels' }), false);
  assert.equal(CORE.isDemo({ hostname: 'preview-x.vercel.app', search: '?demo=reels' }), true);
  assert.equal(CORE.isDemo({ hostname: 'preview-x.vercel.app', search: '' }), false);
  assert.equal(CORE.reachLabel({ views: 1250000 }), '1.3M views');
  assert.equal(CORE.reachLabel({ views: 0, likes: 900 }), '900 likes');
  assert.equal(CORE.reachLabel({}), 'Views unknown');
  assert.equal(CORE.speedLabel({ views: 0, likes: 900, velocity: 400 }), '', 'no views-per-hour claim without a view count');
  assert.equal(CORE.speedLabel({ views: 60000, velocity: 30000 }), '30k views an hour');
  assert.equal(CORE.ageLabel(2), '2h ago');
  assert.equal(CORE.ageLabel(72), '3d ago');
  assert.equal(CORE.ageLabel(null), '');
  assert.equal(CORE.durationLabel(83), '1:23');
  assert.equal(CORE.durationLabel(0), '');
  assert.equal(CORE.fitLabel(85), 'ES fit 85');
  assert.equal(CORE.fitLabel(null), '');
  const h = CORE.handoff({ trend: { id: 't1', title: 'Dak signs', sport: 'nfl' }, brief: { lens: 'fan-first', title: 'What Dallas gets', brief: 'Open on the signing.' } });
  assert.equal(h.topic, 'Dak signs');
  assert.equal(h.sport, 'nfl');
  assert.match(h.steer, /^Treatment idea \(style only, not a fact\): What Dallas gets\. Open on the signing\./);
  assert.equal(CORE.handoff({ topic: 'A story', sport: 'mlb' }).steer, '');
  for (const state of ['live', 'unknown', 'free']) {
    const found = SAMPLE.radarFind({ state });
    assert.equal(found.sample, true);
    assert.ok(found.clips.length >= 4);
    assert.ok(found.clips.every(c => /^https:\/\/x\.com\/Sample/.test(c.url) && !('variants' in c)));
    if (state === 'unknown') assert.ok(found.clips.every(c => !c.viewsKnown));
    else assert.deepEqual(found.clips.map(c => c.velocity), [...found.clips.map(c => c.velocity)].sort((a, b) => b - a));
    const read = SAMPLE.radarAnalysis({ state });
    assert.equal(read.analysis.briefs.length, 3);
    assert.ok(read.analysis.briefs.every(b => !/\d/.test(`${b.title} ${b.hook} ${b.brief}`)));
  }
  assert.equal(SAMPLE.radarFind({ state: 'empty' }).clips.length, 0);
  assert.equal(SAMPLE.radarFind({ sport: 'nba' }).supported, false);
  assert.ok(SAMPLE.trends().every(t => /^s-/.test(t.id) && t.title));
});

console.log(process.exitCode ? '\nSome reel radar tests failed.' : `\nAll ${passed} reel radar tests passed.`);
