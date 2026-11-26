#!/usr/bin/env node
// Merch Designs merch4: the AI art director (netlify/functions/merch.js
// concepts / refine / moments + merch-guidelines.js), every network call
// mocked (no Fourthwall, no AI Gateway, no Supabase, no trend feeds):
//   guidelines (UMD, prompts, summary, icons, contrast repair), the page's
//   { text, url, trend } content, Basic strips elements (Haiku), Pro on the
//   best tier (Sonnet) with plan + trend context + strict elements, Pro falls
//   back to Basic on cap / free / AI error, invented numbers and quotes
//   rejected, refine (validation, code intents at $0, AI, free mode, cache),
//   moments (feed, one scoring call, 30-min cache, heuristic in free mode,
//   headline-only lines), template photos (live + snapshot), feature names.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const modPath = path.join(fnDir, 'merch.js');
const authPath = path.join(fnDir, '_supabase-auth.js');
const gwPath = path.join(fnDir, '_ai-gateway.js');
const TEE = JSON.parse(fs.readFileSync('scripts/fixtures/fourthwall-tee-template.json', 'utf8')).template;

const logs = [];
for (const k of ['log', 'warn', 'error', 'info']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { logs.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); if (process.env.MERCH_TEST_VERBOSE) orig(...a); };
}

// ─── Mocks ────────────────────────────────────────────────────────────────
const reply = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
let weeklySpend = 0;
let hourCalls = 0;
let usageRows = [];
let aiCalls = [];
let messagesHandler = () => { throw new Error('unexpected AI call'); };
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('/rest/v1/rpc/is_es_designer_admin')) return reply(200, false);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, hourCalls);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_spend') || href.includes('/rest/v1/rpc/frameup_team_ai_spend')) return reply(200, [{ total_usd: weeklySpend }]);
  if (href.includes('/rest/v1/frameup_ai_usage')) { usageRows.push(JSON.parse(options.body)); return reply(201, {}); }
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) { const b = JSON.parse(options.body); aiCalls.push(b); return messagesHandler(b); }
  if (href.startsWith('https://api.fourthwall.com/')) return reply(404, { code: 'NOT_MOCKED' });
  throw new Error(`unexpected fetch ${href}`);
};
[modPath, authPath, gwPath].forEach(p => delete require.cache[p]);
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: () => 'tok',
  verifyEsUser: async () => ({ ok: true, user: { id: '0b4f6a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b', email: 'designer@essentiallysports.com' } }),
} };
for (const k of ['FOURTHWALL_API_USERNAME', 'FOURTHWALL_API_PASSWORD', 'MERCH_PUSHERS', 'MERCH_RIGHTS_POLICY', 'MERCH_TEMPLATES', 'AI_DISABLE', 'AI_DISABLE_FEATURES', 'AI_ECONOMY', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];
process.env.AI_GATEWAY_API_KEY = 'test-gateway-key';
const GW = require(gwPath);
const { handler, _test: M } = require(modPath);
const G = require('../merch-guidelines.js');

const call = async body => {
  const res = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};
let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed += 1; } catch (error) { process.stderr.write(`FAIL ${name}\n`); throw error; }
};
const aiJson = obj => () => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 600 }, content: [{ type: 'text', text: JSON.stringify(obj) }] });
const fresh = () => { M.reset(); aiCalls = []; usageRows = []; weeklySpend = 0; hourCalls = 0; delete process.env.AI_DISABLE; };

const SOURCE = 'Magic Johnson won 5 titles with the Lakers wearing number 32. After Game 6 he said "We just played Showtime basketball." Fans still call that era Showtime.';
const PAGE = { text: SOURCE, url: '', trend: null };
const good = {
  collection: 'replay', title: 'Showtime', team: { id: 'lal', name: 'Lakers' },
  palette: { a: '#552583', b: '#FDB927', ink: '#ffffff' }, garment: { color: '#ffffff', name: 'White' },
  stack: [{ text: 'SHOWTIME', size: 'big', fill: 'a', ink: 'white' }, { text: '5 TITLES', size: 'mid', fill: 'a', ink: 'white' }, { text: 'MAGIC', size: 'small', fill: 'a', ink: 'white' }],
  align: 'left', rights: [{ kind: 'team', text: 'Lakers' }], why: 'The era every Lakers fan replays.',
};
const withEls = (els, extra = {}) => ({ ...good, ...extra, elements: els });
const quoteGood = { ...good, collection: 'quote', title: 'Own words', stack: [{ text: 'WE JUST PLAYED', size: 'big', fill: 'a', ink: 'white' }, { text: 'SHOWTIME BASKETBALL', size: 'big', fill: 'a', ink: 'white' }, { text: '— Magic Johnson', size: 'small', fill: 'a', ink: 'white' }] };
const quoteFake = { ...quoteGood, stack: [{ text: 'BEST TEAM EVER', size: 'big', fill: 'a', ink: 'white' }, { text: '— Magic Johnson', size: 'small', fill: 'a', ink: 'white' }] };

// ─── Guidelines ────────────────────────────────────────────────────────────
await test('guidelines: exports, prompts, summary, icons (contract list)', () => {
  for (const k of ['VERSION', 'BASIC_SYSTEM', 'PRO_SYSTEM', 'SUMMARY', 'ICONS', 'ELEMENT_TYPES', 'LIMITS']) assert.ok(G[k], k);
  assert.deepEqual([...G.ICONS], ['star', 'crown', 'flame', 'bolt', 'trophy', 'arrow', 'basketball', 'football', 'baseball', 'soccer', 'hockey', 'golf', 'tennis', 'racing-flag']);
  assert.deepEqual([...G.ELEMENT_TYPES], ['number', 'rule', 'block', 'icon']);
  assert.ok(G.SUMMARY.length >= 5 && G.SUMMARY.every(s => typeof s === 'string' && s.length <= 110), 'short bullets');
  for (const s of [G.BASIC_SYSTEM, G.PRO_SYSTEM]) {
    assert.match(s, /Acumin Post 900/); assert.match(s, /sharp/); assert.match(s, /touch/);
    assert.match(s, /replay/); assert.match(s, /nickname/); assert.match(s, /Knockout on team colour/);
    assert.match(s, /at least 2/); assert.match(s, /white pills with team-colour text/);
    assert.match(s, /official/); assert.match(s, /Never invent numbers/); assert.match(s, /No emojis/, 'FrameUpRules.VOICE');
    assert.match(s, /word for word/);
  }
  assert.match(G.BASIC_SYSTEM, /pills only/);
  assert.ok(!/PRO ELEMENTS/.test(G.BASIC_SYSTEM), 'Basic prompt has no elements');
  assert.match(G.PRO_SYSTEM, /PRO ELEMENTS/); assert.match(G.PRO_SYSTEM, /racing-flag/); assert.match(G.PRO_SYSTEM, /sparingly/); assert.match(G.PRO_SYSTEM, /"plan"/);
  assert.match(G.refineSystem('pro'), /PRO ELEMENTS/); assert.ok(!/PRO ELEMENTS/.test(G.refineSystem('basic')));
});
await test('guidelines: browser build sets window.MerchGuidelines (UMD)', () => {
  const win = {};
  vm.runInNewContext(fs.readFileSync('frameup-rules.js', 'utf8'), { self: win, window: win });
  vm.runInNewContext(fs.readFileSync('merch-guidelines.js', 'utf8'), { self: win, window: win });
  assert.ok(win.MerchGuidelines && win.MerchGuidelines.SUMMARY.length === G.SUMMARY.length);
  assert.match(win.MerchGuidelines.BASIC_SYSTEM, /No emojis/);
});
await test('guidelines: contrast rule finds and repairs melting pills', () => {
  const navyOnBlack = { palette: { a: '#002244', b: '#ffb612', ink: '#ffffff' }, garment: { color: '#020202' }, stack: [{ text: 'X', size: 'big', fill: 'a', ink: 'white' }] };
  assert.ok(G.contrastIssues(navyOnBlack).some(i => i.kind === 'box'));
  const fixed = G.repairContrast(navyOnBlack);
  assert.equal(fixed.fixed > 0, true);
  assert.equal(G.contrastIssues(fixed.concept).length, 0);
  assert.notEqual(fixed.concept.stack[0].fill, 'a');
  const fine = { palette: { a: '#552583', b: '#fdb927', ink: '#ffffff' }, garment: { color: '#ffffff' }, stack: [{ text: 'X', size: 'big', fill: 'a', ink: 'white' }] };
  assert.equal(G.repairContrast(fine).fixed, 0);
});

// ─── concepts ──────────────────────────────────────────────────────────────
await test('concepts: the page\'s { text, url, trend } content works (was "[object Object]")', async () => {
  fresh();
  messagesHandler = aiJson({ concepts: [good] });
  const r = await call({ mode: 'concepts', content: PAGE });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.concepts.length, 1, '5 TITLES is in the source text');
  assert.match(JSON.stringify(aiCalls[0].messages), /Showtime basketball/);
  assert.equal(M.contentOf({ content: { text: 'hi there' } }), 'hi there');
  assert.equal(M.contentOf({ content: 'plain' }), 'plain');
});
await test('concepts basic: Haiku, 4 by default, elements stripped, no plan', async () => {
  fresh();
  messagesHandler = aiJson({ plan: { idea: 'x', angle: 'y' }, concepts: [withEls([{ type: 'rule', position: 'below', color: 'b', weight: 'thick' }]), good] });
  const r = await call({ mode: 'concepts', content: SOURCE, designMode: 'basic' });
  assert.equal(r.status, 200);
  assert.ok(aiCalls[0].model.includes('haiku'), aiCalls[0].model);
  assert.match(JSON.stringify(aiCalls[0].messages), /Return 4 concepts/);
  assert.ok(!/PRO ELEMENTS/.test(JSON.stringify(aiCalls[0].system)));
  assert.equal(r.body.designMode, 'basic');
  assert.equal(r.body.plan, null);
  assert.ok(r.body.concepts.every(c => c.mode === 'basic' && !('elements' in c)), 'Basic never carries elements');
  assert.ok(usageRows.some(u => u.feature === 'merch-concepts'));
});
await test('concepts pro: Sonnet, 6, plan, trend context, strict elements, fit, label', async () => {
  fresh();
  const feedItem = { id: 't-magic', title: 'Magic Johnson says Showtime Lakers would win today', category: 'others', type: 'news', source: 'ESPN', url: 'https://www.espn.com/x', publishedAt: new Date().toISOString(), coverage: 3, signal: 'hot', related: [{ title: 'Lakers retire 32 again in 2026 tribute night', source: 'ES', url: 'https://www.essentiallysports.com/x' }], why: 'Throwback talk with 99 replies' };
  M.setTrendsSource(async () => ({ items: [feedItem], updatedAt: new Date().toISOString() }));
  const proConcepts = [
    withEls([
      { type: 'number', text: '32', style: 'outline', color: 'a', position: 'behind' },
      { type: 'rule', position: 'below', color: 'b', weight: 'thick' },
      { type: 'icon', name: 'nba-logo', position: 'above', color: 'a' },          // unknown icon: dropped
      { type: 'icon', name: 'crown', position: 'right', color: 'a' },             // bad position: dropped
      { type: 'block', position: 'behind', color: 'pink' },                       // bad colour: dropped
      { type: 'icon', name: 'crown', position: 'above', color: 'white' },
      { type: 'rule', position: 'above', color: 'a' },                            // second rule: dropped
      { type: 'block', position: 'behind', color: 'black' },                      // a 4th element: dropped
    ], { label: 'Number-led', fit: { scale: 9, topIn: 50 } }),
    withEls([{ type: 'number', text: '99', style: 'solid', color: 'a', position: 'above' }], { title: 'Invented' }), // 99 only in the AI idea: rejected
    { ...good, title: 'Plain', fit: { scale: 0.7, topIn: null } },
  ];
  messagesHandler = aiJson({ plan: { idea: 'Showtime, the era fans replay', angle: 'Magic in his own words, while the throwback talk is hot' }, concepts: proConcepts });
  const r = await call({ mode: 'concepts', content: { text: SOURCE, url: '', trend: { id: 't-magic', title: feedItem.title, sport: 'others' } }, designMode: 'pro' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(aiCalls[0].model.includes('sonnet'), aiCalls[0].model);
  const sent = JSON.stringify(aiCalls[0]);
  assert.match(sent, /PRO ELEMENTS/);
  assert.match(sent, /Return the plan and 6 concepts/);
  assert.match(sent, /Lakers retire 32 again/, 'full trend from the feed (related headlines)');
  assert.match(sent, /NOT facts/, 'angle ideas labelled');
  assert.equal(r.body.designMode, 'pro');
  assert.deepEqual(r.body.plan, { idea: 'Showtime, the era fans replay', angle: 'Magic in his own words, while the throwback talk is hot' });
  assert.equal(r.body.concepts.length, 2);
  assert.equal(r.body.dropped, 1);
  const [a, plain] = r.body.concepts;
  assert.equal(a.mode, 'pro');
  assert.equal(a.label, 'Number-led');
  assert.deepEqual(a.fit, { scale: 1.6, topIn: 10 }, 'fit clamped');
  assert.deepEqual(a.elements, [
    { type: 'number', text: '32', style: 'outline', color: 'a', position: 'behind' },
    { type: 'rule', position: 'below', color: 'b', weight: 'thick' },
    { type: 'icon', name: 'crown', position: 'above', color: 'white' },
  ]);
  assert.ok(!('elements' in plain));
  assert.deepEqual(plain.fit, { scale: 0.7, topIn: null });
  assert.ok(r.body.cost.usd >= 0.009, `Sonnet cost ${r.body.cost.usd}`);
  // Cached for 30 minutes.
  const again = await call({ mode: 'concepts', content: { text: SOURCE, url: '', trend: { id: 't-magic', title: feedItem.title, sport: 'others' } }, designMode: 'pro' });
  assert.equal(again.body.cost.cached, true);
  assert.equal(aiCalls.length, 1);
  M.setTrendsSource(async () => { throw new Error('feed not used'); });
});
await test('concepts: a trend headline counts as source; AI ideas do not', async () => {
  fresh();
  const trend = { id: 't-1', title: 'Lakers retire 32 for Magic Johnson', related: [], why: 'Fans say 99 percent agree' };
  messagesHandler = aiJson({ concepts: [withEls([{ type: 'number', text: '32', color: 'a', position: 'behind' }], { stack: [{ text: 'RETIRE 32', size: 'big', fill: 'a', ink: 'white' }] }), { ...good, stack: [{ text: '99 PERCENT', size: 'big', fill: 'a', ink: 'white' }] }] });
  const r = await call({ mode: 'concepts', content: 'Magic Johnson night at the Lakers game this week, fans everywhere.', trend, designMode: 'pro' });
  assert.equal(r.body.concepts.length, 1, JSON.stringify(r.body));
  assert.equal(r.body.concepts[0].elements[0].text, '32');
});
await test('concepts: invented numbers and quotes are rejected', async () => {
  fresh();
  messagesHandler = aiJson({ concepts: [quoteGood, quoteFake, { ...good, stack: [{ text: '7 TITLES', size: 'big', fill: 'a', ink: 'white' }] }] });
  const r = await call({ mode: 'concepts', content: SOURCE });
  assert.equal(r.body.concepts.length, 1);
  assert.equal(r.body.concepts[0].collection, 'quote');
  assert.equal(r.body.dropped, 2);
});
await test('concepts pro: falls back to Basic on the person\'s cap (free, fellBack cap)', async () => {
  fresh();
  weeklySpend = 999;
  messagesHandler = () => { throw new Error('no AI over the cap'); };
  const r = await call({ mode: 'concepts', content: SOURCE, designMode: 'pro' });
  assert.equal(r.status, 200);
  assert.equal(r.body.free, true);
  assert.equal(r.body.concepts, null);
  assert.equal(r.body.fellBack, 'cap');
  assert.equal(r.body.designMode, 'basic');
  assert.equal(r.body.mode, 'free', 'withAiMode rewrites mode in free mode');
  assert.equal(r.body.requestMode, 'basic');
  assert.match(r.body.note, /Pro is paused/);
  assert.equal(aiCalls.length, 0);
});
await test('concepts pro: switched off -> fellBack free; Basic free has no fellBack', async () => {
  fresh();
  process.env.AI_DISABLE = 'merch-concepts';
  const r = await call({ mode: 'concepts', content: SOURCE, designMode: 'pro' });
  assert.equal(r.body.fellBack, 'free');
  assert.equal(r.body.free, true);
  const b = await call({ mode: 'concepts', content: SOURCE });
  assert.equal(b.body.free, true);
  assert.equal(b.body.fellBack, undefined);
  delete process.env.AI_DISABLE;
});
await test('concepts pro: AI error -> one Basic run (fellBack ai, no elements)', async () => {
  fresh();
  messagesHandler = b => (b.model.includes('sonnet') ? reply(500, { error: { message: 'overloaded' } }) : aiJson({ concepts: [withEls([{ type: 'rule', position: 'below', color: 'b' }])] })());
  const r = await call({ mode: 'concepts', content: SOURCE, designMode: 'pro' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.fellBack, 'ai');
  assert.equal(r.body.designMode, 'basic');
  assert.match(r.body.note, /Basic/);
  assert.ok(!('elements' in r.body.concepts[0]));
  assert.ok(aiCalls.some(c => c.model.includes('sonnet')) && aiCalls.some(c => c.model.includes('haiku')));
  // Pro returns nothing valid -> Basic too.
  fresh();
  messagesHandler = b => aiJson({ concepts: b.model.includes('sonnet') ? [quoteFake] : [good] })();
  const v = await call({ mode: 'concepts', content: SOURCE, designMode: 'pro' });
  assert.equal(v.body.fellBack, 'ai');
  assert.equal(v.body.concepts.length, 1);
});
await test('concepts: hourly limit and feature names', async () => {
  fresh();
  hourCalls = 9999;
  const r = await call({ mode: 'concepts', content: SOURCE, designMode: 'pro' });
  assert.equal(r.status, 429);
  assert.match(GW.featureOffMessage('merch-refine'), /^The merch design chat is switched off/);
  assert.match(GW.featureOffMessage('merch-moments'), /^Merch moments is switched off/);
});

// ─── refine ────────────────────────────────────────────────────────────────
await test('refine: input validation', async () => {
  fresh();
  assert.equal((await call({ mode: 'refine', concept: good, content: SOURCE })).status, 400);
  assert.equal((await call({ mode: 'refine', concept: good, content: SOURCE, instruction: 'x'.repeat(301) })).status, 400);
  const bad = await call({ mode: 'refine', concept: { ...good, stack: [{ text: '9 TITLES', size: 'big', fill: 'a', ink: 'white' }] }, content: SOURCE, instruction: 'use Lakers colours' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.reason, 'concept');
  assert.equal(aiCalls.length, 0);
});
await test('refine: simple instructions run in code at $0 (also with AI on)', async () => {
  fresh();
  const base = { ...good, id: 'mc-keep01' };
  let r = await call({ mode: 'refine', concept: base, content: SOURCE, instruction: 'Swap the colours' });
  assert.equal(r.body.intent, 'swap'); assert.equal(r.body.ai, false);
  assert.equal(r.body.concept.palette.a, '#fdb927'); assert.equal(r.body.concept.id, 'mc-keep01');
  r = await call({ mode: 'refine', concept: base, content: SOURCE, instruction: 'centre it please' });
  assert.equal(r.body.concept.align, 'center');
  r = await call({ mode: 'refine', concept: base, content: SOURCE, instruction: 'shorter' });
  assert.deepEqual(r.body.concept.stack.map(x => x.text), ['SHOWTIME', '5 TITLES']);
  r = await call({ mode: 'refine', concept: base, content: SOURCE, instruction: 'bigger' });
  assert.equal(r.body.concept.fit.scale, 1.15);
  r = await call({ mode: 'refine', concept: { ...base, fit: { scale: 1, topIn: 3 } }, content: SOURCE, instruction: 'make it smaller' });
  assert.deepEqual(r.body.concept.fit, { scale: 0.87, topIn: 3 });
  r = await call({ mode: 'refine', concept: base, content: SOURCE, instruction: 'black tee' });
  assert.equal(r.body.concept.garment.color, '#020202');
  assert.equal(G.contrastIssues(r.body.concept).length, 0, 'pills repaired for the black tee');
  assert.equal(r.body.cost.usd, 0);
  assert.equal(aiCalls.length, 0);
  assert.equal(M.codeIntent('use Lakers colours'), '');
});
await test('refine basic: Haiku, id kept, elements stripped, history sent, cached', async () => {
  fresh();
  messagesHandler = aiJson({ concept: { ...good, stack: [{ text: 'SHOWTIME', size: 'big', fill: 'a', ink: 'white' }, { text: 'MAGIC JOHNSON', size: 'small', fill: 'b', ink: 'a' }], elements: [{ type: 'rule', position: 'below', color: 'b' }] }, note: 'Put the name under the headline.' });
  const body = { mode: 'refine', concept: { ...good, id: 'mc-keep02' }, content: PAGE, instruction: 'add his name under it', history: ['shorter', 'use purple'], designMode: 'basic' };
  const r = await call(body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(aiCalls[0].model.includes('haiku'));
  assert.match(JSON.stringify(aiCalls[0].messages), /use purple/);
  assert.equal(r.body.concept.id, 'mc-keep02');
  assert.equal(r.body.note, 'Put the name under the headline.');
  assert.ok(!('elements' in r.body.concept));
  assert.equal(r.body.designMode, 'basic');
  assert.ok(usageRows.some(u => u.feature === 'merch-refine'));
  const again = await call(body);
  assert.equal(again.body.cost.cached, true);
  assert.equal(aiCalls.length, 1);
});
await test('refine pro: Sonnet keeps valid elements; invented number -> 422', async () => {
  fresh();
  messagesHandler = aiJson({ concept: withEls([{ type: 'number', text: '32', color: 'a', position: 'behind' }]), note: 'Added his number behind the stack.' });
  const r = await call({ mode: 'refine', concept: good, content: SOURCE, instruction: 'put his number behind it', designMode: 'pro' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(aiCalls[0].model.includes('sonnet'));
  assert.equal(r.body.concept.elements[0].text, '32');
  messagesHandler = aiJson({ concept: withEls([{ type: 'number', text: '23', color: 'a', position: 'behind' }]), note: 'x' });
  const bad = await call({ mode: 'refine', concept: good, content: SOURCE, instruction: 'put 23 behind it', designMode: 'pro' });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.reason, 'invalid');
  assert.match(bad.body.error, /number/);
  messagesHandler = aiJson({ concept: { ...good, stack: [{ text: 'NBA LEGEND', size: 'big', fill: 'a', ink: 'white' }] }, note: 'x' });
  const mark = await call({ mode: 'refine', concept: good, content: SOURCE, instruction: 'say legend', designMode: 'basic' });
  assert.equal(mark.status, 422);
});
await test('refine: free mode -> code intents only, else { free, error }', async () => {
  fresh();
  weeklySpend = 999;
  messagesHandler = () => { throw new Error('no AI in free mode'); };
  const ok = await call({ mode: 'refine', concept: good, content: SOURCE, instruction: 'white tee', designMode: 'pro' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.concept, null, 'already white: nothing to change');
  const left = await call({ mode: 'refine', concept: { ...good, align: 'center' }, content: SOURCE, instruction: 'left align' });
  assert.equal(left.body.concept.align, 'left');
  const r = await call({ mode: 'refine', concept: good, content: SOURCE, instruction: 'use Lakers colours', designMode: 'pro' });
  assert.equal(r.status, 200);
  assert.equal(r.body.free, true);
  assert.equal(r.body.concept, null);
  assert.match(r.body.error, /swap colours/);
  assert.equal(r.body.fellBack, 'cap');
  assert.equal(aiCalls.length, 0);
});

// ─── merch5: black and hex pill colours ──────────────────────────────────
const hexGood = { ...good, stack: [{ text: 'SHOWTIME', size: 'big', fill: '#E4002B', ink: '#FFFFFF' }, { text: 'MAGIC', size: 'small', fill: 'black', ink: 'white' }], paletteFrom: { kind: 'custom' } };
await test('validator: concepts accept hex and black rows, reject bad hex', async () => {
  fresh();
  messagesHandler = aiJson({ concepts: [hexGood, { ...good, stack: [{ text: 'SHOWTIME', size: 'big', fill: '#12345', ink: 'white' }] }, { ...good, stack: [{ text: 'SHOWTIME', size: 'big', fill: 'red', ink: 'white' }] }] });
  const r = await call({ mode: 'concepts', content: SOURCE, count: 3, designMode: 'basic' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.concepts.length, 1, 'bad hex and colour names dropped');
  assert.equal(r.body.dropped, 2);
  assert.deepEqual(r.body.concepts[0].stack.map(x => [x.fill, x.ink]), [['#E4002B', '#FFFFFF'], ['black', 'white']]);
  assert.deepEqual(r.body.concepts[0].paletteFrom, { kind: 'custom' });
  for (const bad of ['#12345', 'red', '#ZZZZZZ']) assert.equal(M.shapeConcept({ ...good, stack: [{ text: 'X', size: 'big', fill: bad, ink: 'white' }] }, { content: SOURCE }).error, 'row', bad);
});
await test('refine: the prompt teaches hex rows; an AI round trip keeps them', async () => {
  fresh();
  assert.match(G.refineSystem('basic'), /#RRGGBB/);
  assert.match(G.refineSystem('pro'), /Keep every hex exactly/);
  assert.match(G.basicSystem(), /Same-colour rows overlap slightly like the ES editor; different colours touch/);
  // The AI echoes the hex rows and centres the stack.
  messagesHandler = b => aiJson({ concept: { ...JSON.parse(b.messages[0].content.match(/The design now \(JSON\): (.*)/)[1]), align: 'center' }, note: 'Centred it.' })();
  const r = await call({ mode: 'refine', concept: { ...hexGood, id: 'mc-hex001' }, content: SOURCE, instruction: 'move it to the middle please and keep it calm', designMode: 'basic' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(aiCalls[0].messages[0].content, /#E4002B/, 'the hex goes to the AI');
  assert.equal(r.body.concept.align, 'center');
  assert.deepEqual(r.body.concept.stack.map(x => x.fill), ['#E4002B', 'black']);
  assert.deepEqual(r.body.concept.paletteFrom, { kind: 'custom' });
  // A code intent (black tee) repairs keys but never a person's hex.
  const navy = { ...good, id: 'mc-hex002', palette: { a: '#552583', b: '#0c2340', ink: '#ffffff' }, stack: [{ text: 'SHOWTIME', size: 'big', fill: '#0C2340', ink: '#FFFFFF' }, { text: 'MAGIC', size: 'small', fill: 'b', ink: 'ink' }] };
  const dark = await call({ mode: 'refine', concept: navy, content: SOURCE, instruction: 'black tee' });
  assert.equal(dark.body.intent, 'black');
  assert.equal(dark.body.concept.stack[0].fill, '#0C2340', 'hex kept on the black tee');
  assert.notEqual(dark.body.concept.stack[1].fill, 'b', 'the navy key is repaired');
});

// ─── moments ───────────────────────────────────────────────────────────────
const FEED = {
  updatedAt: '2026-11-26T15:00:00.000Z',
  items: [
    { id: 'm1', category: 'nfl', type: 'news', title: 'Ja\'Marr Chase: "We run this division" after Bengals sweep', source: 'ESPN', url: 'https://www.espn.com/a', publishedAt: '2026-11-26T13:00:00.000Z', coverage: 4, signal: 'hot', rank: 9, team: { name: 'Cincinnati Bengals', short: 'Bengals', logo: '' }, related: [] },
    { id: 'm2', category: 'nfl', type: 'news', title: 'Week 13 fantasy waiver wire pickups and injury report', source: 'CBS', url: 'https://www.cbs.com/b', publishedAt: '2026-11-26T12:00:00.000Z', coverage: 1, rank: 8, related: [] },
    { id: 'm3', category: 'mlb', type: 'news', title: 'Shohei Ohtani dynasty talk grows in Los Angeles', source: 'AP', url: 'https://apnews.com/c', publishedAt: '2026-11-26T11:00:00.000Z', coverage: 2, rank: 5, related: [] },
    { id: 'm4', category: 'nfl', type: 'news', title: 'Folded storyline story', rank: 4, related: [], storyline: { id: 's', label: 'x', size: 2, lead: false } },
  ],
};
await test('moments: keyed scoring, 3 shirt lines, why/audience/timing, 30-min cache, sport filter', async () => {
  fresh();
  // Real feed ids are long; the AI answers by short keys (m1, m2…) in feed order.
  const feed = { ...FEED, items: FEED.items.map(i => ({ ...i, id: `trend-${i.id}-a1b2c3d4e5f6` })) };
  M.setTrendsSource(async () => feed);
  messagesHandler = aiJson({ items: [
    { key: 'm1', kind: 'quote', score: 91, why: 'Fans will quote it all week after the sweep.', audience: 'Bengals fans after a sweep', timing: 'week', collection: 'quote',
      lines: [{ text: 'We run this division', angle: 'quote' }, { text: 'Who Dey Run It', angle: 'chant' }, { text: 'Sweep Season 26', angle: 'stat' }, { text: 'NFL kings', angle: 'chant' }] },
    { key: 'm2', kind: 'stat', score: 12, why: 'Low.', lines: [{ text: 'Official waiver kings', angle: 'pun' }] },
    { key: 'm3', kind: 'era', score: 70, why: 'Dynasty talk.', timing: 'evergreen', collection: 'replay', lines: [{ text: 'Dynasty Mode', angle: 'era' }, { text: 'Dynasty Mode', angle: 'era' }] },
  ] });
  const r = await call({ mode: 'moments' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(aiCalls.length, 1);
  assert.ok(aiCalls[0].model.includes('haiku'));
  assert.ok(r.body.moments.length === 3, 'folded storyline items skipped');
  const [top] = r.body.moments;
  assert.equal(top.id, 'trend-m1-a1b2c3d4e5f6'); assert.equal(top.kind, 'quote'); assert.equal(top.score, 91); assert.equal(top.ai, true);
  assert.deepEqual(top.lines.map(l => l.text), ['WE RUN THIS DIVISION', 'WHO DEY RUN IT']); // "26" not in the headline; "NFL" is a league mark
  assert.equal(top.line, 'WE RUN THIS DIVISION');
  assert.equal(top.audience, 'Bengals fans after a sweep'); assert.equal(top.timing, 'week'); assert.equal(top.collection, 'quote');
  assert.deepEqual(top.team, { name: 'Cincinnati Bengals', short: 'Bengals' });
  assert.equal(top.sportLabel, 'NFL');
  assert.equal(top.trend.category, 'nfl');
  const m2 = r.body.moments.find(m => m.id.includes('-m2-'));
  assert.ok(!/OFFICIAL/.test(m2.lines.map(l => l.text).join(' ')), 'official line dropped');
  assert.equal(m2.lines.length, 1, 'falls back to a headline line');
  const m3 = r.body.moments.find(m => m.id.includes('-m3-'));
  assert.deepEqual(m3.lines.map(l => l.text), ['DYNASTY MODE'], 'duplicates removed');
  assert.equal(m3.timing, 'evergreen'); assert.equal(m3.collection, 'replay');
  assert.equal(r.body.at, FEED.updatedAt);
  assert.equal(r.body.cached, false);
  assert.ok(r.body.cost.usd > 0 && r.body.cost.usd <= 0.003, `moments cost ${r.body.cost.usd}`);
  assert.ok(usageRows.some(u => u.feature === 'merch-moments'));
  const again = await call({ mode: 'moments' });
  assert.equal(again.body.cached, true);
  assert.equal(aiCalls.length, 1, 'cached scores: no second call');
  const mlb = await call({ mode: 'moments', sport: 'mlb' });
  assert.deepEqual(mlb.body.moments.map(m => m.id), ['trend-m3-a1b2c3d4e5f6']);
  assert.equal(aiCalls.length, 1);
});
await test('moments: free mode -> heuristic scores, no AI; feed down -> empty list', async () => {
  fresh();
  M.setTrendsSource(async () => FEED);
  weeklySpend = 999;
  messagesHandler = () => { throw new Error('no AI in free mode'); };
  const r = await call({ mode: 'moments' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ai, false);
  assert.equal(aiCalls.length, 0);
  const quote = r.body.moments.find(m => m.id === 'm1');
  const fantasy = r.body.moments.find(m => m.id === 'm2');
  assert.equal(quote.kind, 'quote');
  assert.equal(quote.line, 'WE RUN THIS DIVISION');
  assert.ok(quote.score > fantasy.score + 30, `${quote.score} vs ${fantasy.score}`);
  assert.equal(r.body.moments[0].id, 'm1');
  fresh();
  M.setTrendsSource(async () => { throw new Error('down'); });
  const down = await call({ mode: 'moments' });
  assert.equal(down.status, 200);
  assert.deepEqual(down.body.moments, []);
  assert.match(down.body.error, /Trends are unavailable/);
  // AI error -> heuristic, not an error.
  fresh();
  M.setTrendsSource(async () => FEED);
  messagesHandler = () => reply(500, { error: { message: 'boom' } });
  const err = await call({ mode: 'moments' });
  assert.equal(err.status, 200);
  assert.equal(err.body.moments.length, 3);
  assert.equal(err.body.ai, false);
});
await test('moments: lines use only the headline\'s words', () => {
  assert.equal(M.lineFromHeadline('Showtime forever', 'Magic says Showtime is back'), '');
  assert.equal(M.lineFromHeadline('showtime is back', 'Magic says Showtime is back'), 'SHOWTIME IS BACK');
  assert.equal(M.lineFromHeadline('Official NFL champs', 'Official NFL champs crowned'), '');
  assert.equal(M.headlineLine('Bryce Harper walks it off in Philadelphia'), 'BRYCE HARPER');
});

// ─── templates: photos per colour ─────────────────────────────────────────
await test('templates: live colours carry up to 4 photos; snapshot has a real photo', () => {
  const t = M.normalizeTemplate('tee', { ...TEE, colorVariants: TEE.colorVariants.map((c, i) => (i ? c : { ...c, photos: [...c.photos, ...c.photos.map((p, n) => ({ url: `${p.url}?n=${n}` })), { url: 'http://insecure.example/x.jpg' }, { url: 'https://a.example/1.jpg' }, { url: 'https://a.example/2.jpg' }, { url: 'https://a.example/3.jpg' }] })) }, 'curated');
  assert.ok(t.colors.every(c => Array.isArray(c.photos) && c.photos.length <= 4));
  assert.equal(t.colors[0].photos.length, 4);
  assert.ok(t.colors[0].photos.every(u => u.startsWith('https://')));
  assert.ok(t.colors[1].photos[0].startsWith('https://imgproxy.fourthwall.dev/'));
  for (const kind of ['tee', 'hoodie', 'poster', 'sticker', 'mug']) {
    const s = M.snapshotTemplate(kind);
    assert.ok(s.colors.every(c => Array.isArray(c.photos)), kind);
    assert.ok(s.colors.some(c => c.photos.length === 1 && c.photos[0].startsWith('https://imgproxy.fourthwall.dev/')), kind);
  }
});

assert.ok(!logs.some(l => /test-gateway-key/.test(l)), 'gateway key never logged');
process.stdout.write(`test-merch-ai: ${passed} tests passed\n`);
