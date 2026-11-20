// Generate "different every time" (owner: rotate the strong looks). The same
// brief run again by the same person shows different looks and tones: a seeded
// shuffle between strong looks (tier 1-2), a recency penalty for what this
// person was just shown (server history per user + the page's own history),
// fresh runs skip the plan cache, a shipped look's lift stays below the
// recency penalty, and tier 3 only fills a set nothing stronger can.
// No network, no AI: the Gateway and Supabase are mocked in memory.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const authPath = path.join(fnDir, '_supabase-auth.js');
const mcpPath = path.join(fnDir, '_es-mcp.js');

const CLARK = 'Caitlin Clark scores 30 PTS 9 AST 6 REB as the Fever beat the Sky 92-81. Clark: "We just kept attacking."\nSport: WNBA';

// ── Mocks: a per-user events table, the Gateway (a director that follows the
// "just shown" line), and auth that maps a token to a person. ─────────────
const EMAILS = { 'tok-a': 'a@essentiallysports.com', 'tok-b': 'b@essentiallysports.com' };
let eventRows = [];
let directorRequests = [];
let directorBodies = [];
const directorPick = { want: 4 };
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) {
    const body = JSON.parse(options.body);
    const content = body.messages[0].content;
    if (Array.isArray(content)) return reply(200, { content: [{ type: 'text', text: '{"directions":[]}' }], usage: { input_tokens: 100, output_tokens: 10 } });
    directorRequests.push(content);
    directorBodies.push(body);
    // A director that follows the prompt: strong looks it was not just shown.
    const shownLine = content.split('\n').find(line => line.startsWith('This person was just shown')) || '';
    const menu = (body.system[0]?.text || body.system).split('\n').find(line => line.startsWith('- Strong looks')) || '';
    const strong = menu.replace(/^.*?:\s*/, '').split('.')[0].split(',').map(s => s.trim()).filter(Boolean);
    const fresh = strong.filter(id => !new RegExp(`\\b${id}\\b`).test(shownLine));
    const directions = ['stat-stack', 'cover-boxes', 'quote-boxes', 'name-stack', 'stat-column', 'frame-break', 'split-panel', 'editorial-feature', 'magazine-cover', 'pill-stack', 'lower-third', 'post-card']
      .filter(id => fresh.includes(id)).slice(0, directorPick.want)
      .map(archetype => ({ story: 's1', archetype, name: 'Clark night', headline: 'Clark takes over', kicker: '', highlight: ['Clark'], numberFact: 'f1', factIds: ['f1'], label: '', tone: '', photo: '', art: '', palette: '', note: 'Clark first.', sources: [], strengths: [], improvements: [], nextTime: '' }));
    return reply(200, { content: [{ type: 'text', text: JSON.stringify({ directions }) }], usage: { input_tokens: 2500, output_tokens: 900 } });
  }
  if (href.includes('/rest/v1/frameup_generate_direction_events')) {
    const token = String(options.headers?.Authorization || '').replace(/^Bearer\s+/, '');
    if ((options.method || 'GET') === 'POST') {
      const row = JSON.parse(options.body);
      // RLS: a person only saves rows as themselves.
      if (row.user_email !== EMAILS[token]) return reply(403, {});
      eventRows.unshift({ ...row, created_at: new Date().toISOString() });
      return reply(201, {});
    }
    const who = decodeURIComponent((href.match(/user_email=eq\.([^&]+)/) || [])[1] || '');
    const type = (href.match(/type=eq\.([^&]+)/) || [])[1] || '';
    return reply(200, eventRows.filter(r => r.user_email === who && (!type || r.type === type)));
  }
  if (href.includes('/rest/v1/')) return reply(200, []);
  if (href.includes('/wp-json/')) return reply(200, []);
  throw new Error(`unexpected fetch ${href}`);
};
process.env.AI_GATEWAY_API_KEY = 'gw-test';
delete process.env.GENERATE_ART_DIRECTOR_EFFORT;
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
    verifyEsUser: async event => {
      const token = String(event?.headers?.authorization || '').replace(/^Bearer\s+/, '');
      return EMAILS[token] ? { ok: true, user: { email: EMAILS[token] } } : { ok: false, status: 401, error: 'no' };
    },
  },
};
require.cache[mcpPath] = { id: mcpPath, filename: mcpPath, loaded: true, exports: { isMcpConfigured: () => false, createSession: () => null } };

const C = require(path.join(fnDir, '_composer.js'));
const M = require(path.join(fnDir, '_creative-memory.js'));
const D = require(path.join(fnDir, '_direction-memory.js'));
const DIR = require(path.join(fnDir, '_creative-director.js'));
const COMPOSE = require(path.resolve('frameup-compose.js'));
const gen = require(path.join(fnDir, 'es-generate.js'));

// ES photos + cut-outs for every named person (local paths, no network).
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
C.setAssetService({
  async findPhotos({ person = '', team = '' } = {}) {
    if (team || !person) return { photos: [], cutouts: [], headshots: [], logos: [] };
    const who = slug(person);
    const photos = [1, 2, 3, 4].map(n => ({ url: `/p/${who}-${n}.jpg`, person, kind: n === 2 ? 'portrait' : 'action', score: 0.9 - n * 0.1, width: 900, height: 1200, source: 'es', rights: 'es-licensed' }));
    const cutouts = [1, 2].map(n => ({ url: `/c/${who}-${n}.png`, fromPhoto: photos[n - 1].url, person, width: 900, height: 1200 }));
    return { photos, cutouts, headshots: [{ url: `/p/${who}-2.jpg`, person }], logos: [] };
  },
});

const sig = plan => plan.directions.map(d => d.archetype).sort().join(',');

// ── 1. Five code-plan runs of one brief for one person: all different ─────
{
  const history = [];
  const sets = [];
  const looks = new Set();
  for (let i = 0; i < 5; i += 1) {
    const plan = await C.plan({ brief: CLARK, found: {}, want: 4, director: false, fresh: true, seed: `run-${i}`, recent: history.slice(0, 12) });
    assert.equal(plan.directions.length, 4, `run ${i}: 4 designs`);
    assert.ok(!plan.cached, 'fresh runs never come from the plan cache');
    plan.directions.forEach(d => assert.ok(C.tierOf(d.archetype) <= 2, `run ${i}: ${d.archetype} is a strong look (tier 3 only when nothing stronger fits)`));
    assert.ok(!sets.includes(sig(plan)), `run ${i}: a different set from every earlier run (${sig(plan)})`);
    sets.push(sig(plan));
    plan.directions.forEach(d => looks.add(d.archetype));
    // The next run's history: newest first (what es-generate / the page send).
    history.unshift(...plan.looks);
    assert.deepEqual(plan.looks.map(l => l.archetype), plan.directions.map(d => d.archetype), 'the plan reports the looks it showed');
  }
  assert.ok(looks.size >= 8, `at least 8 distinct looks across 5 runs (got ${looks.size}: ${[...looks].join(', ')})`);
  // Back-to-back runs never repeat a look when the brief has others that fit.
  console.log(`variety: 5 runs, ${looks.size} distinct looks: ${sets.join(' | ')}`);
}

// ── 2. A seed is deterministic; no seed keeps the old fixed order ─────────
{
  const a = await C.plan({ brief: CLARK, found: {}, want: 4, director: false, fresh: true, seed: 'pin-1', recent: [] });
  const b = await C.plan({ brief: CLARK, found: {}, want: 4, director: false, fresh: true, seed: 'pin-1', recent: [] });
  assert.deepEqual(a.directions.map(d => [d.archetype, d.tone]), b.directions.map(d => [d.archetype, d.tone]), 'same seed, same history: same plan (tests can pin it)');
  assert.deepEqual(a.directions.map(d => d.candidates.map(c => c.variant)), b.directions.map(d => d.candidates.map(c => c.variant)));
  const seeds = ['s1', 's2', 's3', 's4', 's5', 's6'];
  const firsts = new Set();
  for (const seed of seeds) {
    const p = await C.plan({ brief: CLARK, found: {}, want: 4, director: false, fresh: true, seed, recent: [] });
    firsts.add(sig(p));
  }
  assert.ok(firsts.size >= 2, 'different seeds resolve ties between strong looks differently');
  // Variants: the seed picks which variant leads.
  const input = { headline: 'Clark takes over', name: 'Caitlin Clark', number: { value: '30', label: 'POINTS', factId: 'f1' }, numbers: [{ value: '30', display: '30', label: 'POINTS', factId: 'f1' }], photo: { src: '/p/x.jpg' }, cutout: { src: '/c/x.png', fromPhoto: '/p/x.jpg' }, facts: [{ id: 'f1', text: '30 PTS' }] };
  assert.deepEqual(COMPOSE.candidates('stat-stack', input, 3).map(s => s.variant), [0, 1, 2], 'no offset: the old order');
  assert.deepEqual(COMPOSE.candidates('stat-stack', input, 2, 1).map(s => s.variant), [1, 2], 'offset 1: variants 1, 2');
  assert.deepEqual(COMPOSE.candidates('stat-stack', input, 3, 2).map(s => s.variant), [2, 0, 1], 'offset 2: variant 2 leads');
  // No seed (QA fixtures, internal re-calls): the fixed order, unchanged.
  const read = C.readCreative(CLARK, {});
  assert.equal(C.lookOrder(read, ['trading-card', 'stat-stack']).join(), 'trading-card,stat-stack', 'no variety: order untouched');
  read.variety = C.varietyFor({ seed: 'x', recent: [{ archetype: 'stat-stack', tone: 'vivid' }] });
  assert.deepEqual(C.lookOrder(read, ['trading-card', 'stat-stack', 'cover-boxes']), ['cover-boxes', 'stat-stack', 'trading-card'], 'strong first, just-shown after, tier 3 last');
}

// ── 3. fresh: true bypasses PLAN_CACHE; plain re-calls still hit it ───────
{
  C.PLAN_CACHE.clear();
  const key = 'variety-cache';
  const first = await C.plan({ brief: CLARK, found: {}, want: 4, director: false, cacheKey: key });
  const again = await C.plan({ brief: CLARK, found: {}, want: 4, director: false, cacheKey: key });
  assert.equal(again.cached, true, 'an internal re-call of the same plan is cached');
  assert.equal(sig(first), sig(again));
  const fresh = await C.plan({ brief: CLARK, found: {}, want: 4, director: false, cacheKey: key, fresh: true, seed: 'n1', recent: first.looks });
  assert.ok(!fresh.cached, 'fresh: true never returns the cached plan');
  assert.notEqual(sig(fresh), sig(first), 'and it moves away from what was just shown');
}

// ── 4. Recency beats a prefer lesson; tier 3 stays last ───────────────────
{
  const bias = { archetypes: { 'stat-stack': 12, 'cover-boxes': 0.5 }, tones: {} };
  const list = [{ archetype: 'stat-stack' }, { archetype: 'cover-boxes' }, { archetype: 'trading-card' }, { archetype: 'name-stack' }];
  M.rankDirections(list, { bias, recent: new Set(['stat-stack']), groupOf: d => (C.tierOf(d.archetype) <= 2 ? 0 : 1) });
  assert.deepEqual(list.map(d => d.archetype), ['cover-boxes', 'name-stack', 'stat-stack', 'trading-card'], 'a shipped look just shown ranks after fresh strong looks, before tier 3');
  assert.ok(M.PREFER_CAP < M.RECENT_PENALTY, 'a prefer lift is capped below the recency penalty');
  const plain = [{ archetype: 'stat-stack' }, { archetype: 'cover-boxes' }];
  M.rankDirections(plain, { bias });
  assert.equal(plain[0].archetype, 'stat-stack', 'without history the shipped look still leads');
  // The director's ranking line never asks for a look this person was just shown.
  assert.ok(!/stat-stack/.test(M.rankLine(bias, { recent: ['stat-stack'] })), 'rank line drops just-shown looks');
  assert.ok(/stat-stack/.test(M.rankLine(bias)), 'rank line keeps shipped looks otherwise');
}

// ── 5. Through the handler: history per person, prompt, effort ────────────
{
  const post = (body, token = 'tok-a') => gen.handler({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) }).then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));
  eventRows = [];
  directorRequests = [];
  directorBodies = [];
  const runs = [];
  for (let i = 0; i < 3; i += 1) {
    const res = await post({ mode: 'creative', brief: CLARK, count: 4, fresh: true, nonce: `nonce-a${i}`, steer: { more: ['Clark the closer'], less: ['Fever fans react'], hook: 'question' }, avoid: ['CLARK TAKES OVER'] });
    assert.equal(res.status, 200);
    assert.ok(!res.body.cached, 'fresh run, not the plan cache');
    runs.push(res.body);
  }
  // Each run logged its looks as this person's directions_shown row.
  const mine = eventRows.filter(r => r.user_email === EMAILS['tok-a']);
  assert.equal(mine.length, 3, 'one history row per run');
  assert.equal(mine[0].payload.look, 'creative');
  assert.ok(mine[0].payload.looks.every(l => C.tierOf(l.archetype) <= 2));
  // Run 2's director was told run 1's looks; run 3's, runs 1 and 2.
  assert.ok(!/This person was just shown/.test(directorRequests[0]), 'first run: no history yet');
  runs[0].looks.forEach(l => assert.ok(directorRequests[1].includes(l.archetype), `run 2 was told about ${l.archetype}`));
  assert.notEqual(sig(runs[0]), sig(runs[1]), 'run 2 differs from run 1');
  assert.notEqual(sig(runs[1]), sig(runs[2]), 'run 3 differs from run 2');
  // The steer and avoid lines Creative used to drop.
  assert.ok(/more like: "Clark the closer"/.test(directorRequests[0]), 'steer.more reaches the director');
  assert.ok(/less like.*"Fever fans react"/.test(directorRequests[0]), 'steer.less reaches the director');
  assert.ok(/question hooks/.test(directorRequests[0]), 'steer.hook reaches the director');
  assert.ok(/Already used.*"CLARK TAKES OVER"/.test(directorRequests[0]), 'avoid reaches the director');
  // The menu: every strong look, no fixed first picks.
  const system = directorBodies[0].system[0]?.text || directorBodies[0].system;
  assert.ok(!/Pick stat-stack/.test(system), 'the fixed first-picks line is gone');
  C.STRONG_LOOKS().forEach(id => assert.ok(system.includes(id), `menu lists ${id}`));
  assert.equal(C.STRONG_LOOKS().length, Object.keys(C.TIER).length, 'menu = tier 1 + tier 2');
  assert.equal(directorBodies[0].output_config.effort, 'medium', 'director effort medium');
  // Another person starts with no history (rows are per user).
  directorRequests = [];
  const other = await post({ mode: 'creative', brief: CLARK, count: 4, fresh: true, nonce: 'nonce-b0' }, 'tok-b');
  assert.equal(other.status, 200);
  assert.ok(!/This person was just shown/.test(directorRequests[0]), 'person B does not see person A\'s history');
  // The page's own history (localStorage) is used when the server has none, validated.
  directorRequests = [];
  eventRows = [];
  await post({ mode: 'creative', brief: CLARK, count: 4, fresh: true, nonce: 'nonce-b1', recent: [{ archetype: 'stat-stack', tone: 'vivid' }, { archetype: '<script>', tone: 'x' }, 'cover-boxes', { archetype: 'not-a-look' }] }, 'tok-b');
  const line = directorRequests[0].split('\n').find(l => l.startsWith('This person was just shown')) || '';
  assert.ok(/stat-stack \(vivid\)/.test(line) && /cover-boxes/.test(line), 'client history reaches the director');
  assert.ok(!/script|not-a-look/.test(line), 'unknown or unsafe looks are dropped');
}

// ── 6. Direction memory: own rows only, never throws ──────────────────────
{
  eventRows = [
    { user_email: 'a@essentiallysports.com', type: 'directions_shown', payload: { look: 'creative', looks: [{ archetype: 'stat-stack', tone: 'vivid' }] } },
    { user_email: 'b@essentiallysports.com', type: 'directions_shown', payload: { look: 'creative', looks: [{ archetype: 'quote-boxes', tone: 'dark' }] } },
    { user_email: 'a@essentiallysports.com', type: 'directions_shown', payload: { directions: [{ postType: 'cover', hook: 'claim' }, { postType: 'quote', hook: 'quote' }] } },
  ];
  const a = await D.recentFor({ token: 'tok-a', email: 'a@essentiallysports.com' });
  const b = await D.recentFor({ token: 'tok-b', email: 'b@essentiallysports.com' });
  assert.deepEqual(a.creative.map(l => l.archetype), ['stat-stack']);
  assert.deepEqual(b.creative.map(l => l.archetype), ['quote-boxes']);
  assert.deepEqual(a.classic.map(c => c.postType), ['cover', 'quote'], 'templates-look history (template + hook)');
  assert.deepEqual(await D.recentFor({}), D.EMPTY_RECENT, 'no token: no history');
  const keep = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('down'); };
  assert.deepEqual(await D.recentFor({ token: 'tok-a', email: 'a@essentiallysports.com' }), D.EMPTY_RECENT, 'Supabase down: no history, no throw');
  globalThis.fetch = keep;
  // deriveSignals ignores creative history rows (no hook stats from them).
  assert.deepEqual(D.deriveSignals([{ type: 'directions_shown', payload: { look: 'creative', looks: [{ archetype: 'stat-stack' }] } }]).hookStats, {});
}

// ── 7. Classic (templates look): the director hears what was just shown ───
{
  const req = DIR.directorRequest({ brief: CLARK, read: {}, recent: [{ postType: 'cover', hook: 'claim' }, { postType: 'cover', hook: 'question' }, { postType: 'quote', hook: 'quote' }] });
  assert.ok(/just shown \(newest first\): cover \/ claim, cover \/ question, quote \/ quote/.test(req));
  assert.ok(/at most one cover/.test(req), 'two covers last time: at most one this time');
  assert.ok(!/just shown/.test(DIR.directorRequest({ brief: CLARK, read: {} })), 'no history: no line');
}

// ── 8. Tones rotate by seed and avoid the last run's tones ────────────────
{
  const make = () => [{ archetype: 'stat-stack' }, { archetype: 'cover-boxes' }, { archetype: 'quote-boxes' }, { archetype: 'bar-race' }];
  const plain = C.assignTones(make()).map(d => d.tone);
  assert.deepEqual(C.assignTones(make()).map(d => d.tone), plain, 'no seed: the old fixed tones');
  const last = C.varietyFor({ seed: 't1', recent: plain.map((tone, i) => ({ archetype: ['stat-stack', 'cover-boxes', 'quote-boxes', 'bar-race'][i], tone })) });
  const next = C.assignTones(make(), last).map(d => d.tone);
  assert.notDeepEqual(next, plain, `the next run's tones differ (${plain} -> ${next})`);
  assert.ok(next.some(t => C.LIGHT_TONES.has(t)) && next.some(t => !C.LIGHT_TONES.has(t)), 'still mixed light and dark');
}

console.log('generate variety checks passed');
