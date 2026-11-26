#!/usr/bin/env node
// Merch Brainstorm room (netlify/functions/_merch-brainstorm.js, the
// brainstorm-* modes of merch.js, _merch-brainstorm-store.js, the migration).
// Every network call is mocked (no AI Gateway, no Supabase, no ES feeds):
//   open creates / reuses the shared board by trend id (or 'line:' + hash),
//   context gathered once (trend + ES articles + web fact check), soft-fails,
//   turn validation (invented number, unsourced quote, league mark, official,
//   too long, duplicate dropped), a cut-off reply keeps its complete lines,
//   actions (more-like / mix / angle / tone / audience), basic -> Haiku,
//   pro -> Sonnet (+ fallback to Basic), free mode / weekly cap -> code lines,
//   hourly limit, cost caps, star / edit / add / remove permissions, list,
//   database store (create race, updated_at retry, busy, missing table ->
//   memory), feature names, migration (RLS, size checks, undo).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const modPath = path.join(fnDir, 'merch.js');
const authPath = path.join(fnDir, '_supabase-auth.js');
const gwPath = path.join(fnDir, '_ai-gateway.js');
const storePath = path.join(fnDir, '_merch-brainstorm-store.js');

const logs = [];
for (const k of ['log', 'warn', 'error', 'info']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { logs.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); if (process.env.MERCH_TEST_VERBOSE) orig(...a); };
}

// ─── Mocks ────────────────────────────────────────────────────────────────
const reply = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
let weeklySpend = 0;
let hourCalls = 0;
let admin = false;
let usageRows = [];
let aiCalls = [];
let webCalls = [];
let dbHandler = null; // (href, options) => reply, for /rest/v1/frameup_merch_brainstorm
let messagesHandler = () => { throw new Error('unexpected AI call'); };
let webHandler = () => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 6000, output_tokens: 250, server_tool_use: { web_search_requests: 1 } }, content: [
  { type: 'web_search_tool_result', content: [{ url: 'https://www.espn.com/nfl/recap/packers-rams', title: 'Packers 24, Rams 17' }] },
  { type: 'text', text: '- Green Bay beat Los Angeles 24-17 on Nov 26 at Lambeau Field (espn.com)\n- Jordan Love threw 3 touchdowns in the snow (nfl.com)\n- Fans call Lambeau the "Frozen Tundra" (packers.com)' },
] });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('/rest/v1/rpc/is_es_designer_admin')) return reply(200, admin);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, hourCalls);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_spend') || href.includes('/rest/v1/rpc/frameup_team_ai_spend')) return reply(200, [{ total_usd: weeklySpend }]);
  if (href.includes('/rest/v1/frameup_ai_usage')) { usageRows.push(JSON.parse(options.body)); return reply(201, {}); }
  if (href.includes('/rest/v1/frameup_merch_brainstorm')) { if (!dbHandler) throw new Error('unexpected db call'); return dbHandler(href, options); }
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) {
    const b = JSON.parse(options.body);
    if (Array.isArray(b.tools) && b.tools.some(t => t.type && t.type.startsWith('web_search'))) { webCalls.push(b); return webHandler(b); }
    aiCalls.push(b);
    return messagesHandler(b);
  }
  throw new Error(`unexpected fetch ${href}`);
};
[modPath, authPath, gwPath, storePath].forEach(p => delete require.cache[p]);
let email = 'sam@essentiallysports.com';
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: () => 'tok',
  verifyEsUser: async () => ({ ok: true, user: { id: '0b4f6a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b', email } }),
} };
for (const k of ['FOURTHWALL_API_USERNAME', 'FOURTHWALL_API_PASSWORD', 'MERCH_PUSHERS', 'MERCH_RIGHTS_POLICY', 'AI_DISABLE', 'AI_DISABLE_FEATURES', 'AI_ECONOMY', 'SUPABASE_SERVICE_ROLE_KEY',
  'AI_MAIN_MODEL', 'AI_BEST_MODEL', 'AI_USER_WEEKLY_LIMIT_USD', 'AI_TEAM_WEEKLY_LIMIT_USD', 'AI_FAIL_CLOSED']) delete process.env[k];
process.env.AI_GATEWAY_API_KEY = 'test-gateway-key';
const GW = require(gwPath);
const { handler, _test: M } = require(modPath);
const BS = M.brainstorm;
const STORE = require(storePath);
const G = require('../merch-guidelines.js');

const call = async body => {
  const res = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};
let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed += 1; } catch (error) { process.stderr.write(`FAIL ${name}\n`); throw error; }
};
const aiJson = (obj, usage = { input_tokens: 4500, output_tokens: 500 }) => () => reply(200, { stop_reason: 'end_turn', usage, content: [{ type: 'text', text: JSON.stringify(obj) }] });
let esCalls = 0;
let esImpl = async () => ({ articles: [
  { title: 'Jordan Love silences doubters in the Lambeau snow', url: 'https://www.essentiallysports.com/nfl-jordan-love-snow/', date: '2026-11-26', excerpt: 'Love finished with 287 yards as Green Bay won.', body: 'The Packers improved to 9-3.' },
  { title: 'Not ES', url: 'https://example.com/x', excerpt: '' },
] });
const fresh = () => {
  M.reset(); STORE._test.reset(); aiCalls = []; webCalls = []; usageRows = []; weeklySpend = 0; hourCalls = 0; admin = false; dbHandler = null; esCalls = 0;
  email = 'sam@essentiallysports.com';
  delete process.env.AI_DISABLE; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  BS.setSources({ es: async topic => { esCalls += 1; return esImpl(topic); } });
};
const TREND = {
  id: 'trend-m3-a1b2c3d4e5f6', title: 'Packers stun Rams 24-17 at Lambeau in the snow', category: 'nfl', source: 'ESPN', url: 'https://www.espn.com/nfl/story',
  team: { name: 'Green Bay Packers', short: 'Packers' },
  related: [{ title: 'Jordan Love throws 3 TDs as the "Frozen Tundra" roars', source: 'AP', url: 'https://apnews.com/x' }],
};
const GOOD_TURN = {
  note: 'Leaned on the snow game and the score.',
  items: [
    { text: 'Frozen Tundra Faithful', angle: 'chant', why: 'Lambeau in the snow is the picture every Packers fan keeps.', rights: [] },
    { text: '24-17 IN THE SNOW', angle: 'stat', why: 'The score, worn like a ticket stub.', rights: [] },
    { text: '31-10 BLOWOUT', angle: 'stat', why: 'invented score', rights: [] },
    { text: 'NFL SNOW KINGS', angle: 'chant', why: 'league mark', rights: [] },
    { text: '"WE OWN THE COLD"', angle: 'quote', why: 'made-up quote', rights: [] },
    { text: '"FROZEN TUNDRA" ROARS', angle: 'quote', why: 'exact words from the headline', rights: [] },
    { text: 'OFFICIAL SNOW BOWL', angle: 'pun', why: 'licence word', rights: [] },
    { text: 'THIS LINE IS FAR TOO LONG FOR A SHIRT', angle: 'pun', why: 'too long', rights: [] },
    { text: 'frozen tundra faithful!', angle: 'chant', why: 'dup in batch', rights: [] },
    { text: 'LOVE IN THE COLD', angle: 'player', why: 'A surname pun fans get.', rights: [{ kind: 'name', text: 'Jordan Love' }, { kind: 'bogus', text: 'x' }] },
  ],
};
const open = (extra = {}) => call({ mode: 'brainstorm-open', trend: TREND, designMode: 'basic', ...extra });

// ─── Guidelines, features, migration ──────────────────────────────────────
await test('guidelines: brainstorm prompt (rules, shape, angles, voice)', () => {
  const s = G.BRAINSTORM_SYSTEM;
  assert.match(s, /JSON only/); assert.match(s, /"items"/); assert.match(s, /"note"/); assert.match(s, /32 characters/);
  assert.match(s, /SOURCES exactly/); assert.match(s, /Super Bowl/); assert.match(s, /official/); assert.match(s, /good taste/);
  assert.match(s, /never repeat|NEW lines/i); assert.match(s, /No emojis/, 'FrameUpRules.VOICE');
  assert.deepEqual([...G.BRAINSTORM_ANGLES], ['quote', 'nickname', 'chant', 'callback', 'pun', 'stat', 'rivalry', 'era', 'city', 'player', 'troll']);
});
await test('features: merch-brainstorm + merch-brainstorm-context registered (names, kill switch)', () => {
  assert.equal(M.FEATURES.brainstorm, 'merch-brainstorm');
  assert.equal(M.FEATURES.brainstormContext, 'merch-brainstorm-context');
  assert.match(GW.featureOffMessage('merch-brainstorm'), /^The merch brainstorm room is switched off/);
  assert.match(GW.featureOffMessage('merch-brainstorm-context'), /^The merch brainstorm web check is switched off/);
  assert.match(GW.featureOffMessage('merch-brainstorm-basic'), /brainstorm room/);
});
await test('migration: table, unique key, size checks, RLS read for ES users, service writes only, undo', () => {
  const sql = fs.readFileSync('supabase/migrations/20261127090000_frameup_merch_brainstorm.sql', 'utf8');
  assert.match(sql, /create table if not exists public\.frameup_merch_brainstorm/);
  assert.match(sql, /key text not null unique/);
  for (const col of ['trend_id', 'title', 'sport', 'team jsonb', 'context jsonb', 'lines jsonb', 'turns jsonb', 'created_by', 'created_at', 'updated_at']) assert.ok(sql.includes(col), col);
  assert.match(sql, /pg_column_size\(lines\) <= 131072/); assert.match(sql, /pg_column_size\(context\) <= 65536/); assert.match(sql, /pg_column_size\(turns\) <= 65536/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /for select to authenticated\s+using \(public\.is_es_designer_domain_user\(\)\)/);
  assert.match(sql, /revoke all on table public\.frameup_merch_brainstorm from anon, authenticated/);
  assert.ok(!/grant (insert|update|delete|all)/i.test(sql), 'no browser writes');
  assert.match(sql, /drop policy if exists/); assert.match(sql, /Undo:\n--\s+drop table if exists public\.frameup_merch_brainstorm/);
});

// ─── open ─────────────────────────────────────────────────────────────────
await test('open: creates the shared board for a trend, gathers context once (trend + ES + web check)', async () => {
  fresh();
  const r = await open();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.created, true);
  const s = r.body.session;
  assert.equal(s.key, TREND.id); assert.equal(s.trendId, TREND.id); assert.equal(s.title, TREND.title); assert.equal(s.sport, 'nfl');
  assert.deepEqual(s.team, { name: 'Green Bay Packers', short: 'Packers' });
  assert.equal(s.storage, 'memory'); assert.match(s.id, /^bs-/);
  assert.deepEqual(s.people, ['sam@essentiallysports.com']); assert.deepEqual(s.lines, []); assert.ok(s.contextAt);
  const c = r.body.context;
  assert.deepEqual(c.sources, { trend: true, es: true, web: true });
  assert.equal(c.headlines[0].title, TREND.title); assert.equal(c.headlines.length, 2);
  assert.deepEqual(c.esArticles, [{ title: 'Jordan Love silences doubters in the Lambeau snow', url: 'https://www.essentiallysports.com/nfl-jordan-love-snow/', date: '2026-11-26' }], 'ES urls only, no excerpt/body');
  assert.equal(c.facts.length, 3); assert.match(c.facts[0], /^Green Bay beat Los Angeles 24-17/);
  assert.deepEqual(c.factUrls, [{ title: 'Packers 24, Rams 17', url: 'https://www.espn.com/nfl/recap/packers-rams' }]);
  assert.ok(c.nicknames.includes('Frozen Tundra'), JSON.stringify(c.nicknames));
  assert.equal(c.sportLabel, 'NFL');
  assert.equal(c.colours.length, 2); assert.ok(c.colours.every(h => /^#[0-9A-F]{6}$/i.test(h))); assert.ok(c.palette && c.palette.a);
  assert.ok(!('corpus' in c) && !('cost' in c), 'corpus and cost stay on the server');
  // Cost: one search ($0.01) + Haiku reading it; capped at one search.
  assert.equal(webCalls.length, 1);
  assert.equal(webCalls[0].tools[0].max_uses, 1);
  assert.match(webCalls[0].model, /haiku/);
  assert.ok(r.body.cost.usd > 0.01 && r.body.cost.usd < 0.013, `web check cost ${r.body.cost.usd}`);
  assert.equal(r.body.cost.cached, false);
  assert.ok(usageRows.some(u => u.feature === 'merch-brainstorm-context'));
  assert.equal(aiCalls.length, 0, 'no turn on open');
  // A teammate opens the same moment: same board, context reused, $0.
  email = 'alex@essentiallysports.com';
  const again = await open();
  assert.equal(again.body.created, false);
  assert.equal(again.body.session.id, s.id);
  assert.deepEqual(again.body.cost, { usd: 0, cached: true });
  assert.equal(webCalls.length, 1, 'web check once per board');
  assert.equal(esCalls, 1);
  // Polling: brainstorm-get is $0 and returns the context on request.
  const got = await call({ mode: 'brainstorm-get', sessionId: s.id, withContext: true });
  assert.equal(got.status, 200); assert.equal(got.body.session.id, s.id); assert.equal(got.body.context.title, TREND.title);
  assert.equal((await call({ mode: 'brainstorm-get', sessionId: 'bs-0000000000000000' })).status, 404);
  assert.equal((await call({ mode: 'brainstorm-get', sessionId: 'nope' })).status, 404);
});
await test('open: context re-gathered after 6 h; no trend -> board keyed by line hash; input errors', async () => {
  fresh();
  const r = await open();
  const board = STORE._test.MEMORY.get(r.body.session.id);
  board.context.gatheredAt = new Date(Date.now() - 7 * 3600e3).toISOString();
  const later = await open();
  assert.equal(later.body.cost.cached, false); assert.equal(webCalls.length, 2);
  const line = await call({ mode: 'brainstorm-open', content: { text: 'Cheeseheads never melt', trend: null }, designMode: 'basic' });
  assert.equal(line.status, 200);
  assert.match(line.body.session.key, /^line:[0-9a-f]{24}$/);
  assert.equal(line.body.session.trendId, null); assert.equal(line.body.context.sources.trend, false);
  assert.deepEqual(line.body.context.headlines, []);
  const same = await call({ mode: 'brainstorm-open', content: 'cheeseheads NEVER melt!', designMode: 'basic' });
  assert.equal(same.body.session.id, line.body.session.id, 'same words -> same board');
  const bad = await call({ mode: 'brainstorm-open', content: 'x' });
  assert.equal(bad.status, 400); assert.equal(bad.body.reason, 'input');
});
await test('open: ES and web check soft-fail (timeout / error / free mode) and the board still opens', async () => {
  fresh();
  esImpl = () => new Promise(() => {}); // never answers: the 6 s budget ends it
  webHandler = () => reply(500, { error: { message: 'boom' } });
  const t0 = Date.now();
  const r = await open();
  assert.equal(r.status, 200);
  assert.ok(Date.now() - t0 < 6800, 'ES capped at 6 s');
  assert.deepEqual(r.body.context.sources, { trend: true, es: false, web: false });
  assert.ok(r.body.context.notes.some(n => /ES articles: timeout/.test(n)), r.body.context.notes.join('|'));
  assert.ok(r.body.context.notes.some(n => /Web check: unavailable/.test(n)));
  assert.equal(r.body.cost.usd, 0);
  // Weekly cap: no web check at all (no fetch), note says why.
  fresh();
  esImpl = async () => { throw new Error('wp down'); };
  weeklySpend = 999;
  const capped = await open();
  assert.equal(capped.status, 200);
  assert.equal(webCalls.length, 0);
  assert.ok(capped.body.context.notes.some(n => /weekly AI budget/.test(n)));
  assert.ok(capped.body.context.notes.some(n => /ES articles: unavailable/.test(n)));
  // Context feature switched off: no web call; the turn feature is separate.
  fresh();
  process.env.AI_DISABLE = 'merch-brainstorm-context';
  const off = await open();
  assert.equal(webCalls.length, 0); assert.ok(off.body.context.notes.some(n => /switched off/.test(n)));
  delete process.env.AI_DISABLE;
  esImpl = async () => ({ articles: [{ title: 'Jordan Love silences doubters in the Lambeau snow', url: 'https://www.essentiallysports.com/nfl-jordan-love-snow/', date: '2026-11-26', excerpt: 'Love finished with 287 yards as Green Bay won.', body: 'The Packers improved to 9-3.' }] });
  webHandler = () => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 6000, output_tokens: 250, server_tool_use: { web_search_requests: 1 } }, content: [
    { type: 'web_search_tool_result', content: [{ url: 'https://www.espn.com/nfl/recap/packers-rams', title: 'Packers 24, Rams 17' }] },
    { type: 'text', text: '- Green Bay beat Los Angeles 24-17 on Nov 26 at Lambeau Field (espn.com)\n- Jordan Love threw 3 touchdowns in the snow (nfl.com)\n- Fans call Lambeau the "Frozen Tundra" (packers.com)' },
  ] });
});

// ─── turn ─────────────────────────────────────────────────────────────────
await test('turn (basic): Haiku, rules drop bad lines, rights flagged, turn + lines saved, cost ~$0.001', async () => {
  fresh();
  const { body: o } = await open();
  messagesHandler = aiJson(GOOD_TURN);
  const r = await call({ mode: 'brainstorm-turn', sessionId: o.session.id, prompt: 'snowy lines for the faithful', designMode: 'basic' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(aiCalls.length, 1);
  assert.match(aiCalls[0].model, /haiku/);
  assert.equal(aiCalls[0].max_tokens, 1500);
  const texts = r.body.lines.map(l => l.text);
  assert.deepEqual(texts, ['FROZEN TUNDRA FAITHFUL', '24-17 IN THE SNOW', '"FROZEN TUNDRA" ROARS', 'LOVE IN THE COLD']);
  assert.equal(r.body.dropped, 6, 'invented number, unsourced quote, league mark, official, too long, duplicate');
  const [chant, stat, quote, player] = r.body.lines;
  assert.equal(chant.angle, 'chant'); assert.equal(chant.source, 'ai'); assert.equal(chant.by, 'sam@essentiallysports.com'); assert.equal(chant.designMode, 'basic');
  assert.deepEqual(chant.starred, []); assert.match(chant.id, /^bl-[0-9a-f]{8}$/);
  assert.deepEqual(chant.rights, [{ kind: 'nickname', text: 'Frozen Tundra' }]);
  assert.deepEqual(stat.rights, []);
  assert.ok(quote.rights.some(x => x.kind === 'quote' && x.text === 'FROZEN TUNDRA'));
  assert.deepEqual(player.rights, [{ kind: 'name', text: 'Jordan Love' }], 'unknown kinds dropped');
  assert.ok(chant.why.length <= 140);
  assert.equal(r.body.note, 'Leaned on the snow game and the score.');
  assert.equal(r.body.designMode, 'basic');
  const s = r.body.session;
  assert.equal(s.lines.length, 4); assert.equal(s.turns.length, 1);
  assert.equal(s.turns[0].prompt, 'snowy lines for the faithful'); assert.deepEqual(s.turns[0].lineIds, r.body.lines.map(l => l.id));
  assert.equal(s.turns[0].ai, true); assert.equal(s.turns[0].designMode, 'basic');
  // The prompt carries guidelines, sources, the board and the request.
  const sys = aiCalls[0].system; const sysText = Array.isArray(sys) ? sys.map(x => x.text).join('') : String(sys);
  assert.match(sysText, /merch editor for EssentiallySports/);
  const ask = aiCalls[0].messages[0].content; const askText = Array.isArray(ask) ? ask.map(x => x.text).join('') : String(ask);
  assert.match(askText, /SOURCES/); assert.match(askText, /Packers stun Rams 24-17/); assert.match(askText, /Jordan Love silences doubters/);
  assert.match(askText, /Web fact check/); assert.match(askText, /BOARD[^\n]*\n\(empty\)/); assert.match(askText, /They typed: snowy lines for the faithful/);
  assert.ok(r.body.cost.usd > 0 && r.body.cost.usd <= 0.003, `basic turn cost ${r.body.cost.usd}`);
  assert.ok(usageRows.some(u => u.feature === 'merch-brainstorm' && u.task === 'merch-brainstorm-basic'), JSON.stringify(usageRows.map(u => [u.feature, u.task])));
  assert.equal(webCalls.length, 1, 'no web check on a turn');
  // Second turn: the board is in the prompt, repeats are dropped, chat history sent.
  messagesHandler = aiJson({ note: 'More snow.', items: [{ text: 'FROZEN TUNDRA FAITHFUL', angle: 'chant', why: 'x' }, { text: 'Lambeau Snow Globe', angle: 'pun', why: 'A snow globe of the night.' }] });
  const r2 = await call({ mode: 'brainstorm-turn', sessionId: o.session.id, action: { kind: 'angle', angle: 'wordplay' }, designMode: 'basic' });
  assert.deepEqual(r2.body.lines.map(l => l.text), ['LAMBEAU SNOW GLOBE']);
  assert.equal(r2.body.dropped, 1);
  const ask2 = aiCalls[1].messages[0].content; const ask2Text = Array.isArray(ask2) ? ask2.map(x => x.text).join('') : String(ask2);
  assert.match(ask2Text, /- FROZEN TUNDRA FAITHFUL/); assert.match(ask2Text, /RECENT CHAT:\nPerson: snowy lines/); assert.match(ask2Text, /Angle: wordplay and puns/);
  assert.deepEqual(r2.body.session.turns[1].action, { kind: 'angle', angle: 'pun' });
});
await test('turn: a reply cut off at the token limit keeps its complete lines', async () => {
  fresh();
  const { body: o } = await open();
  const cut = '{"note":"Snow lines","items":[{"text":"LAMBEAU SNOW GLOBE","angle":"pun","why":"A snow globe night.","rights":[]},{"text":"PACK ATTACK IN THE SN';
  messagesHandler = () => reply(200, { stop_reason: 'max_tokens', usage: { input_tokens: 4500, output_tokens: 1500 }, content: [{ type: 'text', text: cut }] });
  const r = await call({ mode: 'brainstorm-turn', sessionId: o.session.id, prompt: 'go', designMode: 'basic' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.lines.map(l => l.text), ['LAMBEAU SNOW GLOBE']);
  assert.equal(r.body.truncated, true);
  assert.equal(r.body.note, 'Snow lines', 'note read from the cut-off reply');
  assert.ok(logs.some(l => /reply cut off; kept 1 complete lines/.test(l)));
});
await test('turn (pro): Sonnet; Pro failure falls back to one Basic run; garbled / AI down -> 502', async () => {
  fresh();
  const { body: o } = await open();
  messagesHandler = aiJson({ note: 'Pro lines.', items: [{ text: 'TUNDRA TOUGH', angle: 'chant', why: 'Cold-weather pride.' }] }, { input_tokens: 4500, output_tokens: 700 });
  const r = await call({ mode: 'brainstorm-turn', sessionId: o.session.id, action: { kind: 'tone', tone: 'Funny' }, designMode: 'pro' });
  assert.equal(r.status, 200);
  assert.match(aiCalls[0].model, /sonnet/); assert.equal(aiCalls[0].max_tokens, 2000);
  assert.equal(r.body.designMode, 'pro'); assert.equal(r.body.lines[0].designMode, 'pro');
  assert.ok(r.body.cost.usd >= 0.005 && r.body.cost.usd <= 0.02, `pro turn cost ${r.body.cost.usd}`);
  assert.ok(usageRows.some(u => u.task === 'merch-brainstorm-pro'));
  // Pro errors -> Basic answers.
  messagesHandler = b => (/sonnet/.test(b.model) ? reply(500, { error: { message: 'overloaded' } }) : aiJson({ note: 'Basic.', items: [{ text: 'CHEESE ON ICE', angle: 'pun', why: 'x' }] })());
  const fb = await call({ mode: 'brainstorm-turn', sessionId: o.session.id, prompt: 'more', designMode: 'pro' });
  assert.equal(fb.status, 200, JSON.stringify(fb.body));
  assert.equal(fb.body.fellBack, 'ai'); assert.equal(fb.body.designMode, 'basic'); assert.deepEqual(fb.body.lines.map(l => l.text), ['CHEESE ON ICE']);
  // Basic AI down -> 502; garbled -> 502; nothing saved.
  const before = (await call({ mode: 'brainstorm-get', sessionId: o.session.id })).body.session.turns.length;
  messagesHandler = () => reply(500, { error: { message: 'down' } });
  const down = await call({ mode: 'brainstorm-turn', sessionId: o.session.id, prompt: 'more', designMode: 'basic' });
  assert.equal(down.status, 502); assert.equal(down.body.reason, 'ai');
  messagesHandler = () => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'sorry, no JSON' }] });
  const garbled = await call({ mode: 'brainstorm-turn', sessionId: o.session.id, prompt: 'more', designMode: 'basic' });
  assert.equal(garbled.status, 502);
  assert.equal((await call({ mode: 'brainstorm-get', sessionId: o.session.id })).body.session.turns.length, before);
});
await test('turn: actions (more-like, mix, audience) reach the AI; bad actions / input rejected', async () => {
  fresh();
  const { body: o } = await open();
  messagesHandler = aiJson(GOOD_TURN);
  const first = await call({ mode: 'brainstorm-turn', sessionId: o.session.id, prompt: 'start', designMode: 'basic' });
  const [a, b] = first.body.lines;
  const asks = [];
  messagesHandler = body => { const c = body.messages[0].content; asks.push(Array.isArray(c) ? c.map(x => x.text).join('') : String(c)); return aiJson({ note: 'ok', items: [{ text: `NEW LINE ${asks.length}`, angle: 'chant', why: 'x' }] })(); };
  // Numbers in "NEW LINE 1" aren't in the sources: dropped -> 0 lines still 200 with a note.
  const more = await call({ mode: 'brainstorm-turn', sessionId: o.session.id, action: { kind: 'more-like', lineIds: [a.id] }, designMode: 'basic' });
  assert.equal(more.status, 200); assert.deepEqual(more.body.lines, []); assert.match(more.body.note, /None of the AI's lines passed/);
  assert.match(asks[0], /More like "FROZEN TUNDRA FAITHFUL": same feel/);
  await call({ mode: 'brainstorm-turn', sessionId: o.session.id, action: { kind: 'mix', lineIds: [a.id, b.id] }, designMode: 'basic' });
  assert.match(asks[1], /Mix "FROZEN TUNDRA FAITHFUL" and "24-17 IN THE SNOW"/);
  await call({ mode: 'brainstorm-turn', sessionId: o.session.id, action: { kind: 'audience', audience: 'For neutral fans' }, designMode: 'basic' });
  assert.match(asks[2], /neutral fans/);
  const bad = async (body, re) => { const r = await call({ mode: 'brainstorm-turn', sessionId: o.session.id, designMode: 'basic', ...body }); assert.equal(r.status, 400, JSON.stringify(r.body)); if (re) assert.match(r.body.error, re); };
  await bad({ action: { kind: 'mix', lineIds: [a.id] } }, /exactly two/);
  await bad({ action: { kind: 'angle', angle: 'gossip' } }, /angle/);
  await bad({ action: { kind: 'more-like', lineIds: ['bl-deadbeef'] } }, /no longer on the board/);
  await bad({}, /Ask for lines/);
  assert.equal((await call({ mode: 'brainstorm-turn', sessionId: 'bs-0000000000000000', prompt: 'x' })).status, 404);
});
await test('turn: free mode / weekly cap -> no AI, code lines from the headlines, note; hourly limit 429', async () => {
  fresh();
  const { body: o } = await open();
  weeklySpend = 999;
  messagesHandler = () => { throw new Error('no AI over the cap'); };
  const r = await call({ mode: 'brainstorm-turn', sessionId: o.session.id, prompt: 'lines', designMode: 'pro' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(aiCalls.length, 0);
  assert.equal(r.body.free, true); assert.equal(r.body.fellBack, 'cap'); assert.equal(r.body.designMode, 'basic');
  assert.equal(r.body.mode, 'free', 'withAiMode marks the reply');
  assert.match(r.body.note, /this week's AI budget/);
  assert.ok(r.body.lines.length >= 1 && r.body.lines.every(l => l.source === 'code'), JSON.stringify(r.body.lines));
  assert.ok(r.body.lines.some(l => l.text === 'FROZEN TUNDRA'));
  assert.equal(r.body.session.turns[0].ai, false);
  assert.deepEqual(r.body.cost, { usd: 0, cached: false });
  // Turn feature switched off -> free path too.
  weeklySpend = 0;
  process.env.AI_DISABLE = 'merch-brainstorm';
  const off = await call({ mode: 'brainstorm-turn', sessionId: o.session.id, prompt: 'lines', designMode: 'basic' });
  assert.equal(off.body.free, true); assert.equal(aiCalls.length, 0);
  delete process.env.AI_DISABLE;
  hourCalls = 9999;
  const hourly = await call({ mode: 'brainstorm-turn', sessionId: o.session.id, prompt: 'lines', designMode: 'basic' });
  assert.equal(hourly.status, 429); assert.equal(hourly.body.reason, 'limit');
});

// ─── lines: star / edit / add / remove ────────────────────────────────────
await test('lines: anyone stars; only the author (or an admin) edits / removes; edits re-validated; add own line', async () => {
  fresh();
  const { body: o } = await open();
  messagesHandler = aiJson(GOOD_TURN);
  const t = await call({ mode: 'brainstorm-turn', sessionId: o.session.id, prompt: 'go', designMode: 'basic' });
  const line = t.body.lines[0];
  const sid = o.session.id;
  const op = (body) => call({ mode: 'brainstorm-line', sessionId: sid, lineId: line.id, ...body });
  email = 'alex@essentiallysports.com';
  let r = await op({ op: 'star' });
  assert.equal(r.status, 200); assert.deepEqual(r.body.session.lines[0].starred, ['alex@essentiallysports.com']);
  r = await op({ op: 'star' }); assert.deepEqual(r.body.session.lines[0].starred, ['alex@essentiallysports.com'], 'idempotent');
  assert.ok(r.body.session.people.includes('alex@essentiallysports.com'));
  r = await op({ op: 'edit', text: 'TUNDRA FAITHFUL' }); assert.equal(r.status, 403); assert.equal(r.body.reason, 'forbidden');
  r = await op({ op: 'remove' }); assert.equal(r.status, 403);
  // Own line added by Alex.
  const add = await call({ mode: 'brainstorm-add', sessionId: sid, text: 'Cheeseheads never melt, Packers' });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.equal(add.body.line.source, 'person'); assert.equal(add.body.line.by, 'alex@essentiallysports.com'); assert.equal(add.body.line.text, 'Cheeseheads never melt, Packers', 'their words kept as typed');
  assert.deepEqual(add.body.line.rights, [{ kind: 'team', text: 'Green Bay Packers' }]);
  // Person lines: numbers are their words (not checked); league marks are.
  assert.equal((await call({ mode: 'brainstorm-add', sessionId: sid, text: '13 titles and counting' })).status, 200);
  const mark = await call({ mode: 'brainstorm-add', sessionId: sid, text: 'Super Bowl or bust' });
  assert.equal(mark.status, 400); assert.equal(mark.body.reason, 'rules'); assert.match(mark.body.error, /Super Bowl/);
  const dup = await call({ mode: 'brainstorm-add', sessionId: sid, text: 'frozen tundra faithful' });
  assert.equal(dup.status, 400); assert.equal(dup.body.reason, 'duplicate');
  assert.equal((await call({ mode: 'brainstorm-add', sessionId: sid, text: ' ' })).status, 400);
  assert.equal((await call({ mode: 'brainstorm-add', sessionId: sid, text: 'x'.repeat(61) })).status, 400);
  // Alex edits own line (person rules).
  r = await call({ mode: 'brainstorm-line', sessionId: sid, lineId: add.body.line.id, op: 'edit', text: 'Cheeseheads never melt' });
  assert.equal(r.status, 200); const edited = r.body.session.lines.find(l => l.id === add.body.line.id);
  assert.equal(edited.text, 'Cheeseheads never melt'); assert.equal(edited.edited, true); assert.deepEqual(edited.rights, []);
  // Sam (author of the AI line) edits it: AI rules apply (no invented numbers).
  email = 'sam@essentiallysports.com';
  r = await op({ op: 'edit', text: 'FAITHFUL SINCE 1919' }); assert.equal(r.status, 400); assert.match(r.body.error, /1919 isn't in the sources/);
  r = await op({ op: 'edit', text: 'NFL FAITHFUL' }); assert.equal(r.body.reason, 'rules');
  r = await op({ op: 'edit', text: '24-17 IN THE SNOW' }); assert.equal(r.status, 400); assert.equal(r.body.reason, 'duplicate');
  r = await op({ op: 'edit', text: 'tundra faithful' }); assert.equal(r.status, 200);
  assert.equal(r.body.session.lines.find(l => l.id === line.id).text, 'TUNDRA FAITHFUL');
  r = await op({ op: 'unstar' }); assert.deepEqual(r.body.session.lines.find(l => l.id === line.id).starred, ['alex@essentiallysports.com'], 'Sam had not starred');
  // An admin may remove anyone's line.
  email = 'boss@essentiallysports.com'; admin = true;
  r = await call({ mode: 'brainstorm-line', sessionId: sid, lineId: add.body.line.id, op: 'remove' });
  assert.equal(r.status, 200); assert.ok(!r.body.session.lines.some(l => l.id === add.body.line.id));
  admin = false; email = 'sam@essentiallysports.com';
  r = await op({ op: 'remove' }); assert.equal(r.status, 200); assert.ok(!r.body.session.lines.some(l => l.id === line.id));
  assert.equal((await op({ op: 'star' })).status, 404);
  assert.equal((await op({ op: 'shout' })).status, 400);
});
await test('list: recent boards with line / starred / people counts', async () => {
  fresh();
  const { body: o } = await open();
  await call({ mode: 'brainstorm-add', sessionId: o.session.id, text: 'Tundra tough' });
  email = 'alex@essentiallysports.com';
  const line = (await call({ mode: 'brainstorm-get', sessionId: o.session.id })).body.session.lines[0];
  await call({ mode: 'brainstorm-line', sessionId: o.session.id, lineId: line.id, op: 'star' });
  await call({ mode: 'brainstorm-open', content: 'Cheeseheads never melt' });
  const r = await call({ mode: 'brainstorm-list' });
  assert.equal(r.status, 200); assert.equal(r.body.storage, 'memory');
  assert.equal(r.body.sessions.length, 2);
  const board = r.body.sessions.find(s => s.id === o.session.id);
  assert.deepEqual({ lines: board.lines, starred: board.starred, people: board.people, sport: board.sport, trendId: board.trendId }, { lines: 1, starred: 1, people: 2, sport: 'nfl', trendId: TREND.id });
  assert.equal(r.body.sessions[0].title, 'Cheeseheads never melt', 'newest first');
});

// ─── Unit: line rules, actions, facts ────────────────────────────────────
await test('unit: checkAiLine / checkPersonLine / shapeAction / factsFrom / nicknamesFrom', () => {
  const src = 'Packers stun Rams 24-17. Love said "we live for the cold" after 3 TDs.';
  assert.equal(BS.checkAiLine('24-17 forever', src).text, '24-17 FOREVER');
  assert.equal(BS.checkAiLine('25-17 forever', src).why, 'number');
  assert.equal(BS.checkAiLine('“We live for the cold”', src).text, '"WE LIVE FOR THE COLD"', 'curly quotes ok when exact');
  assert.equal(BS.checkAiLine('"We love the cold"', src).why, 'quote');
  assert.equal(BS.checkAiLine('"Cold', src).why, 'quote', 'unbalanced quote');
  assert.equal(BS.checkAiLine('Licensed to chill', src).why, 'rules');
  assert.equal(BS.checkAiLine('Insane cold game', src).why, 'rules', 'banned hype word');
  assert.equal(BS.checkAiLine('one two three four five six seven', src).why, 'long');
  assert.equal(BS.checkPersonLine('Since 1919, never cold').text, 'Since 1919, never cold');
  assert.equal(BS.checkPersonLine('Stanley Cup dreams').why, 'rules');
  assert.deepEqual(BS.shapeAction({ kind: 'angle', angle: 'City Pride' }), { action: { kind: 'angle', angle: 'city' } });
  assert.deepEqual(BS.shapeAction({ kind: 'tone', tone: 'more emotional' }), { action: { kind: 'tone', tone: 'emotional' } });
  assert.deepEqual(BS.shapeAction({ kind: 'more-like', lineIds: ['bl-12345678', 'bl-12345678', 'junk'] }), { action: { kind: 'more-like', lineIds: ['bl-12345678'] } });
  assert.ok(BS.shapeAction({ kind: 'audience', audience: 'Official NFL fans' }).error);
  assert.deepEqual(BS.shapeAction(null), {});
  assert.deepEqual(BS.factsFrom('Here are the facts:\n1. Green Bay won 24-17 at home (espn.com)\n* **Love** threw 3 TDs (nfl.com)\nok'), ['Green Bay won 24-17 at home (espn.com)', 'Love threw 3 TDs (nfl.com)']);
  assert.deepEqual(BS.nicknamesFrom(['The "Frozen Tundra" roars', 'Love, nicknamed The Golden Boy, wins', 'Big "NFL" news']), ['Frozen Tundra', 'Golden Boy']);
  assert.equal(BS.WEB_CHECK.maxUses, 1); assert.ok(BS.WEB_CHECK.maxCostUsd <= 0.01);
});

// ─── Database store ───────────────────────────────────────────────────────
// A tiny PostgREST stand-in for frameup_merch_brainstorm.
function fakeTable() {
  const rows = new Map();
  let clock = Date.parse('2026-11-27T09:00:00Z');
  const stamp = () => new Date((clock += 1000)).toISOString().replace('Z', '+00:00');
  const calls = [];
  const state = { rows, calls, clashOnce: 0, missing: false };
  state.handler = (href, options = {}) => {
    const u = new URL(href);
    const method = options.method || 'GET';
    calls.push(`${method} ${u.search}`);
    if (state.missing) return reply(404, { code: 'PGRST205', message: 'Could not find the table' });
    const eq = name => { const v = u.searchParams.get(name); return v && v.startsWith('eq.') ? v.slice(3) : null; };
    if (method === 'GET') {
      let list = [...rows.values()];
      if (eq('key')) list = list.filter(r => r.key === eq('key'));
      if (eq('id')) list = list.filter(r => r.id === eq('id'));
      if (u.searchParams.get('order')) list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return reply(200, list.slice(0, Number(u.searchParams.get('limit')) || 50));
    }
    if (method === 'POST') {
      const body = JSON.parse(options.body);
      if ([...rows.values()].some(r => r.key === body.key)) return reply(201, []);
      const at = stamp();
      const row = { id: `0000000${rows.size}-1111-4222-8333-444455556666`.slice(-36).replace(/^.{8}/, `0000000${rows.size}`.slice(-8)), ...body, created_at: at, updated_at: at };
      rows.set(row.id, row);
      return reply(201, [row]);
    }
    if (method === 'PATCH') {
      const row = rows.get(eq('id'));
      if (state.clashOnce > 0 && row) { state.clashOnce -= 1; row.updated_at = stamp(); row.lines = [...row.lines, { id: 'bl-aaaaaaaa', text: 'TEAMMATE LINE', angle: 'chant', why: '', by: 'kim@essentiallysports.com', at: row.updated_at, starred: [], source: 'person', rights: [] }]; }
      if (!row || row.updated_at !== eq('updated_at')) return reply(200, []);
      Object.assign(row, JSON.parse(options.body), { updated_at: stamp() });
      return reply(200, [row]);
    }
    return reply(400, { message: 'unsupported' });
  };
  return state;
}
await test('db store: shared board in Supabase, create race returns the teammate\'s board, updated_at retry merges, busy after two clashes', async () => {
  fresh();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  const table = fakeTable();
  dbHandler = table.handler;
  const r = await open();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.session.storage, 'db'); assert.match(r.body.session.id, /^[0-9a-f-]{36}$/);
  assert.equal(table.rows.size, 1);
  const row = [...table.rows.values()][0];
  assert.equal(row.key, TREND.id); assert.equal(row.trend_id, TREND.id); assert.equal(row.created_by, 'sam@essentiallysports.com');
  assert.ok(row.context.corpus.includes('24-17') && row.context.gatheredAt, 'context (with corpus) stored on the row');
  assert.ok(table.calls.some(c => c.startsWith('POST ?on_conflict=key')));
  assert.ok(table.calls.some(c => /^PATCH .*updated_at=eq\./.test(c)), 'writes are guarded by updated_at');
  // Someone writes between our read and write: re-read, re-apply, both lines kept.
  table.clashOnce = 1;
  const add = await call({ mode: 'brainstorm-add', sessionId: row.id, text: 'Tundra tough' });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.deepEqual(add.body.session.lines.map(l => l.text), ['TEAMMATE LINE', 'Tundra tough']);
  table.clashOnce = 2;
  const busy = await call({ mode: 'brainstorm-add', sessionId: row.id, text: 'Snow globe' });
  assert.equal(busy.status, 409); assert.equal(busy.body.reason, 'busy');
  // Create race: the insert is ignored (teammate's row exists) -> that board.
  const list = await call({ mode: 'brainstorm-list' });
  assert.equal(list.body.storage, 'db'); assert.equal(list.body.sessions[0].id, row.id);
  const raced = await STORE.create({ key: TREND.id, title: 'x', lines: [], turns: [], context: {} });
  assert.equal(raced.created, false); assert.equal(raced.board.id, row.id);
  // A turn writes lines + turn in one guarded PATCH.
  messagesHandler = aiJson(GOOD_TURN);
  const t = await call({ mode: 'brainstorm-turn', sessionId: row.id, prompt: 'go', designMode: 'basic' });
  assert.equal(t.status, 200); assert.equal(table.rows.get(row.id).turns.length, 1);
});
await test('db store: missing table (migration not run) -> memory boards, then the db again after the pause', async () => {
  fresh();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  const table = fakeTable();
  table.missing = true;
  dbHandler = table.handler;
  const r = await open();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.session.storage, 'memory'); assert.match(r.body.session.id, /^bs-/);
  assert.ok(STORE._test.dbOff());
  assert.ok(logs.some(l => /frameup_merch_brainstorm unavailable/.test(l)));
  const calls = table.calls.length;
  const again = await open();
  assert.equal(again.body.session.id, r.body.session.id);
  assert.equal(table.calls.length, calls, 'no db calls while paused');
  const list = await call({ mode: 'brainstorm-list' });
  assert.equal(list.body.storage, 'memory');
});

await test('existing merch modes unaffected; unknown brainstorm mode -> 400', async () => {
  fresh();
  assert.equal((await call({ mode: 'brainstorm-nope' })).status, 400);
  assert.equal(typeof M.partialItems, 'function');
});

process.stdout.write(`test-merch-brainstorm: ${passed} passed\n`);
