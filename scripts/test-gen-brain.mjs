// Generate v2 "gen-brain" (2026-11-19): the director's critique ("what could
// have been better"), the learning model (_creative-memory.js: lessons from
// signals, decay, prompt injection, hit rate), and the AI design assistant
// (_design-assistant.js + generate-assistant.js: scene patches, the ES gate,
// the fact check, undo / redo). Every network call is mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const authPath = path.join(fnDir, '_supabase-auth.js');
const mcpPath = path.join(fnDir, '_es-mcp.js');

const NFL = 'Bengals rout Steelers 38-18 on Sunday Night Football and sit alone atop the AFC North at 7-2. Joe Burrow threw for 409 yards and 4 touchdowns. Ja\'Marr Chase caught 11 passes for 231 yards. Cincinnati outgained Pittsburgh 484-222.\nSport: NFL';
const GOLF = 'LPGA Tour season ends with $2 million prize and PGA Tour season ends with 100 players earning cards\nSport: Golf';

// ── Mocks ─────────────────────────────────────────────────────────────────
let aiReplies = [];
const aiRequests = [];
const restCalls = [];
let lessonRows = null; // null = table missing (404)
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (href.includes('/wp-json/wp/v2/')) return reply(200, []);
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) {
    const body = JSON.parse(options.body);
    aiRequests.push(body);
    const next = aiReplies.length ? aiReplies.shift() : { directions: [] };
    return reply(200, { content: [{ type: 'text', text: typeof next === 'string' ? next : JSON.stringify(next) }], usage: { input_tokens: 2000, output_tokens: 300 } });
  }
  if (href.includes('/rest/v1/frameup_creative_lessons')) {
    restCalls.push({ href, method: options.method || 'GET', body: options.body });
    return lessonRows ? reply(200, lessonRows) : reply(404, { code: 'PGRST205', message: 'missing' });
  }
  if (href.includes('/rest/v1/rpc/frameup_creative_lessons_bump')) {
    restCalls.push({ href, method: 'POST', body: options.body });
    return lessonRows ? reply(200, 1) : reply(404, { code: 'PGRST202' });
  }
  if (href.includes('/rest/v1/')) {
    restCalls.push({ href, method: options.method || 'GET', body: options.body });
    return reply(200, []);
  }
  throw new Error(`unexpected fetch ${href}`);
};
process.env.AI_GATEWAY_API_KEY = 'gw-test';
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }), verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }), bearerToken: () => 'tok' } };
require.cache[mcpPath] = { id: mcpPath, filename: mcpPath, loaded: true, exports: { isMcpConfigured: () => false, createSession: () => null } };

const COMPOSE = require(path.resolve('frameup-compose.js'));
const A = require(path.resolve('generate-assistant.js'));
const M = require(path.join(fnDir, '_creative-memory.js'));
const D = require(path.join(fnDir, '_design-assistant.js'));
const P = require(path.join(fnDir, '_composer.js'));
const gen = require(path.join(fnDir, 'es-generate.js'));
P.setAssetService(null);
const post = body => gen.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) }).then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));
const DAY = 24 * 60 * 60 * 1000;

const nflPlan = await P.plan({ brief: NFL, director: false, want: 4, cacheKey: 'nfl-test' });
const nflRead = P.readCreative(NFL, {});
const ctxFor = plan => ({ compose: COMPOSE, logos: plan.read.teams.filter(t => t.logo).map(t => ({ src: t.logo, name: t.name })), photos: [], facts: plan.read.facts.map(f => ({ id: f.id, text: f.text })) });
const nflCtx = ctxFor(nflPlan);
const scoreboard = nflPlan.directions.find(d => d.archetype === 'scoreboard').candidates[0];
// gen4: the code plan now leads with board-grade looks; the big-number poster is built directly.
const bigNumber = nflPlan.directions.find(d => d.archetype === 'big-number')?.candidates[0] || COMPOSE.build('big-number', { ...(nflPlan.directions.find(d => d.input?.number)?.input || nflPlan.directions[0].input), cutout: null, cutouts: [] }, 0);

// ── 1. Critique shape ─────────────────────────────────────────────────────
{
  // Every direction carries a critique (free checks with no AI).
  nflPlan.directions.forEach(d => {
    assert.ok(Array.isArray(d.critique.strengths) && Array.isArray(d.critique.improvements) && typeof d.critique.nextTime === 'string', `${d.archetype} has a critique`);
    d.critique.improvements.forEach(i => { assert.match(i.id, /^i\d+$/); assert.ok(i.text && i.fix && i.fix.op); });
  });
  // Scores need no unit; a lone number without a label does.
  assert.equal(P.codeCritique(scoreboard, {}, nflRead).improvements.some(i => /unit/.test(i.text)), false, 'a scoreboard is not flagged for a missing unit');
  const bare = JSON.parse(JSON.stringify(bigNumber));
  bare.layers.forEach(l => { if (l.type === 'number') { l.label = ''; l.suffix = ''; l.prefix = ''; } if (l.role === 'label') l.role = 'kicker'; });
  const flagged = P.codeCritique(bare, {}, nflRead);
  assert.ok(flagged.improvements.some(i => /no unit or label/.test(i.text) && i.fix.op === 'assist'), 'number lacks unit');

  // Director: strengths / improvements / nextTime are kept, with fixes.
  const golfRead = P.readCreative(GOLF, {});
  const out = P.validateDirections({ directions: [{ story: 's1', archetype: 'prize-poster', headline: 'LPGA season ends rich', numberFact: 'f1', factIds: ['f1'], strengths: ['Gold glow on the prize'], improvements: ['No cut-out of a player, so the art carries it', 'The number could be bigger'], nextTime: 'Ask for a winner photo when the prize is the story.' }] }, golfRead, { photos: {}, cutouts: {}, art: { s1: { src: 'proc:trophy' } } });
  const crit = out.directions[0].critique;
  assert.deepEqual(crit.strengths, ['Gold glow on the prize']);
  assert.equal(crit.improvements.length, 2);
  assert.deepEqual(crit.improvements[1].fix, { op: 'fix', name: 'bigger-number' }, 'a known topic maps to a one-click fix');
  assert.equal(crit.improvements[0].fix.op, 'assist', 'others go to the assistant');
  assert.match(crit.nextTime, /winner photo/);
  assert.ok(P.DIRECTOR_SYSTEM().includes('nextTime') && P.DIRECTOR_SYSTEM().includes('improvements'));

  // Judge: per design critique from the vision reply; unknown fixes become assistant asks.
  const img = 'data:image/jpeg;base64,AAAA';
  aiReplies = [{ directions: [{ id: 'd1', best: 'd1c1', scores: { d1c1: { hierarchy: 4, focal: 4, readability: 3, brand: 4, originality: 3 } }, note: 'Score first.', fix: '', strengths: ['Winner row in Bengals orange'], improvements: [{ text: 'Photo too dark behind the headline', fix: 'brighten-photo' }, { text: 'Kicker repeats the headline', fix: 'nonsense' }, 'Number lacks its unit'], nextTime: 'Pick brighter photos for top-heavy layouts.' }] }];
  const judged = await P.judge({ brief: NFL, sets: [{ direction: 'd1', archetype: 'scoreboard', items: [{ id: 'd1c1', image: `${img}1` }] }], lessons: [{ id: 'L1', key: 'k1', text: 'Keep headlines to 2-6 words so they set big.', kind: 'avoid' }] });
  const c = judged.directions[0].critique;
  assert.deepEqual(c.strengths, ['Winner row in Bengals orange']);
  // gen4: problems are repairs applied while designing, never chips; an unknown fix name is never trusted.
  assert.deepEqual(c.improvements, [], 'no repair is offered as a suggestion');
  assert.deepEqual(judged.directions[0].repairs.map(r => r.op), ['brighten-photo']);
  assert.ok(judged.directions[0].issues.includes('Kicker repeats the headline'), 'every issue still reaches the learning model');
  assert.match(c.nextTime, /brighter photos/);
  const judgeText = aiRequests.at(-1).messages[0].content[0].text;
  assert.ok(judgeText.includes('Keep headlines to 2-6 words'), 'lessons are injected into the judge prompt');
  assert.ok(judgeText.includes('nextTime'), 'the judge is asked what could be better');

  // Heuristic fallback (no key) still explains its fix.
  const key = process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  P.JUDGE_CACHE.clear();
  const free = await P.judge({ sets: [{ direction: 'd9', items: [{ id: 'd9c1', image: `${img}X` }] }], heuristics: { d9c1: { score: 3.2, fix: 'darker-mist' } } });
  assert.deepEqual(free.directions[0].repairs, [{ op: 'darker-mist', issue: 'The type sits on a busy part of the photo; a deeper mist would help.' }], 'the quick check\'s fix is a repair too');
  assert.deepEqual(free.directions[0].critique.improvements, []);
  process.env.AI_GATEWAY_API_KEY = key;

  // Merging on the page: judge first, director / checks after, no duplicates, applied fix dropped.
  const legacy = { strengths: c.strengths, improvements: [{ id: 'j1', text: 'Photo too dark behind the headline', fix: { op: 'fix', name: 'brighten-photo' } }], nextTime: c.nextTime };
  const merged = A.designCritique({ strengths: ['Cut-out gives depth'], improvements: [{ id: 'c1', text: 'The number could be bigger', fix: { op: 'fix', name: 'bigger-number' } }] }, legacy, { fixApplied: 'brighten-photo' });
  assert.ok(!merged.improvements.some(i => i.fix.name === 'brighten-photo'), 'the fix the judge already applied is not offered again');
  assert.deepEqual(merged.improvements.map(i => i.id), merged.improvements.map((_, n) => `i${n + 1}`));
  assert.equal(merged.strengths[0], 'Winner row in Bengals orange');
  assert.equal(A.chipLabel({ text: 'try a versus layout with both teams and the final score between them.' }), 'Try a versus layout with both teams and the final score between them', 'gen v4: full text, never cut');
}

// ── 2. Lessons: topics, dedupe, distillation, decay, hit rate ─────────────
{
  assert.equal(M.topicOf('Photo too dark behind the headline').id, 'photo-dark');
  assert.equal(M.topicOf('the image is murky').id, 'photo-dark');
  assert.equal(M.topicOf('Number lacks its unit').id, 'number-unit');
  assert.equal(M.topicOf('Headline is too long for the box').id, 'headline-long');
  assert.equal(M.intentTopic('use a darker photo').id, 'low-contrast');
  assert.equal(M.intentTopic('move the number left'), null, 'taste asks teach no lesson');

  const obsA = M.observationsFrom({ type: 'judge', text: 'Photo too dark behind the headline', archetype: 'magazine-cover', sport: 'NFL' });
  const obsB = M.observationsFrom({ type: 'judge', text: 'The image is murky and dim', archetype: 'magazine-cover', sport: 'NFL' });
  assert.deepEqual(obsA.map(o => o.key), obsB.map(o => o.key), 'two phrasings of one mistake dedupe to the same lessons');
  assert.deepEqual(obsA.map(o => o.scope), ['global', 'archetype', 'sport']);

  const t0 = Date.parse('2026-11-01T00:00:00Z');
  let { lessons } = M.distil([], obsA, { now: t0 });
  assert.equal(lessons.length, 3);
  assert.equal(M.selectLessons(lessons, { sport: 'NFL', now: t0 }).length, 0, 'one sighting is not a lesson yet');
  ({ lessons } = M.distil(lessons, obsB, { now: t0 + DAY }));
  const global = lessons.find(l => l.scope === 'global');
  assert.equal(lessons.length, 3, 'no duplicate rows');
  assert.ok(global.evidence > 1.9 && global.evidence <= 2, 'evidence decays a little between sightings');
  const picked = M.selectLessons(lessons, { sport: 'NFL', archetypes: ['magazine-cover'], now: t0 + DAY });
  assert.equal(picked.length, 1, 'one lesson per topic (the most specific scope)');
  assert.equal(picked[0].scope, 'archetype');
  assert.match(picked[0].text, /photo bright/);
  // Decay: three weeks later the weight halves; two months later it is inactive.
  assert.ok(Math.abs(M.decayed(global, t0 + DAY + 21 * DAY) - global.evidence / 2) < 0.01, 'half-life 21 days');
  assert.equal(M.selectLessons(lessons, { sport: 'NFL', now: t0 + 60 * DAY }).length, 0, 'old lessons fade out');
  // Out of scope: an NBA run does not get the NFL / cover lessons, only global ones.
  assert.equal(M.selectLessons(lessons, { sport: 'NBA', now: t0 + DAY })[0].scope, 'global');

  // Hit rate: injected and the mistake did not come back = hit; came back = recurrence.
  const keys = picked.map(l => l.key);
  let res = M.distil(lessons, [], { now: t0 + 2 * DAY, injected: keys });
  assert.equal(res.lessons.find(l => l.key === keys[0]).hits, 1);
  assert.deepEqual(res.deltas.map(d => [d.hits, d.evidence]), [[1, 0]]);
  res = M.distil(res.lessons, obsA, { now: t0 + 3 * DAY, injected: keys });
  const again = res.lessons.find(l => l.key === keys[0]);
  assert.equal(again.recurrences, 1, 'a mistake repeated after the lesson existed is counted');
  assert.equal(M.hitRate(again), 0.5);
  const view = M.adminView(res.lessons, { now: t0 + 3 * DAY });
  assert.equal(view.recurring[0].key, keys[0]);
  assert.equal(view.totals.hitRate, 0.5);
  assert.ok(view.top.length >= 1);

  // Taste from picks / exports; rejects; edits.
  const pref = M.observationsFrom({ type: 'export', archetype: 'magazine-cover', archetypeName: 'Magazine cover', sport: 'Golf' });
  assert.equal(pref[0].kind, 'prefer');
  assert.match(pref[0].text, /Magazine cover composition for Golf/);
  assert.equal(M.observationsFrom({ type: 'reject', archetype: 'unit-grid', sport: 'Golf' })[0].kind, 'avoid');
  assert.equal(M.observationsFrom({ type: 'edit', before: 'LPGA TOUR SEASON ENDS WITH A RECORD PRIZE', after: 'LPGA PAYDAY' })[0].topic, 'headline-long');
  assert.deepEqual(M.observationsFrom({ type: 'bogus' }), []);

  // Prompt lines.
  const lines = M.promptLines([{ id: 'L1', text: 'Avoid A.', kind: 'avoid' }, { id: 'L2', text: 'Ship B.', kind: 'prefer' }]);
  assert.match(lines[0], /Do not repeat/);
  assert.ok(lines.includes('- [L1] Avoid A.') && lines.includes('- [L2] Ship B.'));
  assert.deepEqual(M.promptLines([]), []);

  // Signals are cleaned; events map onto the existing log's types.
  assert.ok(M.normalizeSignal({ type: 'judge' }).error, 'the page cannot fake judge signals');
  const sig = M.normalizeSignal({ type: 'thumb', value: -5, archetype: 'magazine-cover<script>', designId: 'r1:d2', runId: 'r1', text: '<b>too busy</b>' }).signal;
  assert.equal(sig.value, -1);
  assert.equal(sig.archetype, 'magazine-cover', 'tags stripped');
  assert.equal(sig.text, 'too busy');
  assert.equal(M.eventFor(sig).type, 'less_like_this');
  assert.equal(M.eventFor(sig).directionId, 'd2');
  assert.equal(M.eventFor({ ...sig, type: 'export' }).type, 'design_exported');
  assert.equal(M.eventFor({ ...sig, type: 'export' }).postType, undefined, 'no post type, so the existing log accepts it');
}

// ── 3. Storage: memory before the migration, deltas through the RPC after ─
{
  M._test.reset();
  lessonRows = null;
  const signals = [{ type: 'judge', text: 'Photo too dark behind the headline', sport: 'Golf', archetype: 'magazine-cover' }];
  await M.learn({ token: 'tok', signals });
  await M.learn({ token: 'tok', signals });
  const local = await M.lessonsFor({ token: 'tok', sport: 'Golf', archetypes: ['magazine-cover'] });
  assert.equal(local.length, 1, 'works before the migration (instance memory)');
  M._test.reset();
  lessonRows = [{ key: 'avoid:global:headline-long', text: 'Keep headlines to 2-6 words so they set big.', topic: 'headline-long', kind: 'avoid', scope: 'global', scope_value: '', evidence: 4, hits: 0, recurrences: 0, last_seen: new Date().toISOString() }];
  restCalls.length = 0;
  const fromDb = await M.lessonsFor({ token: 'tok', sport: 'Golf' });
  assert.equal(fromDb[0].key, 'avoid:global:headline-long', 'team lessons come from the table');
  await M.learn({ token: 'tok', signals, injected: [fromDb[0].key] });
  const rpc = restCalls.find(c => c.href.includes('/rpc/frameup_creative_lessons_bump'));
  assert.ok(rpc, 'writes go through the RPC');
  const rows = JSON.parse(rpc.body).p_rows;
  assert.ok(rows.every(r => r.d_evidence <= 5 && r.d_hits <= 5), 'deltas are capped');
  assert.ok(rows.some(r => r.key === 'avoid:global:headline-long' && r.d_hits === 1), 'the injected lesson scores a hit');
  assert.equal(JSON.parse(rpc.body).p_half_life_days, M.HALF_LIFE_DAYS);
  const sql = fs.readFileSync('supabase/migrations/20261118130000_frameup_creative_lessons.sql', 'utf8');
  ['create table if not exists public.frameup_creative_lessons', 'enable row level security', 'security definer', 'Undo:', 'is_es_designer_domain_user', 'revoke insert, update, delete'].forEach(text => assert.ok(sql.includes(text), `migration has ${text}`));
}

// ── 4. Prompt injection of lessons into the director ──────────────────────
{
  const lessons = [{ id: 'L1', key: 'k', text: 'Every hero number needs its unit or label right under it.', kind: 'avoid' }];
  const read = P.readCreative(GOLF, {});
  assert.ok(P.directorRequest(read, { photos: {} }, { lessons }).includes('[L1] Every hero number needs its unit'), 'directorRequest carries the lessons');
  assert.ok(!P.directorRequest(read, { photos: {} }, {}).includes('Team lessons'), 'none without memory');
  // Through es-generate: the table's lessons reach the director's prompt.
  M._test.reset();
  lessonRows = [{ key: 'avoid:sport=golf:number-unit', text: 'Every hero number needs its unit or label right under it.', topic: 'number-unit', kind: 'avoid', scope: 'sport', scope_value: 'Golf', evidence: 3, hits: 2, recurrences: 0, last_seen: new Date().toISOString() }];
  aiRequests.length = 0;
  aiReplies = [{ directions: [] }];
  P.PLAN_CACHE.clear();
  const run = await post({ mode: 'creative', brief: GOLF, count: 6 });
  assert.equal(run.status, 200);
  const director = aiRequests.find(r => !Array.isArray(r.messages[0].content));
  assert.ok(director.messages[0].content.includes('Every hero number needs its unit'), 'es-generate injects the lessons');
  assert.equal(run.body.lessons[0].text, 'Every hero number needs its unit or label right under it.');
  assert.deepEqual(run.body.budget, { count: 6, candidatesPerDesign: 2 }, 'count 6 -> 2 candidates per design');
  assert.ok(director.max_tokens > 1800, 'the director gets room for more designs');
  assert.ok(run.body.directions.every(d => d.candidates.length <= 2));
  assert.equal(P.budgetFor(12).want, 8, 'count is capped at 8');
  assert.equal(P.budgetFor(0).want, 4, 'default 4');
  const est = A.costEstimate(8);
  assert.ok(est.low < est.high && est.candidatesPerDesign === 2 && /^~\$/.test(est.label));
  assert.ok(A.costEstimate(1).high < A.costEstimate(8).high);
}

// ── 5. Scene patches: the ES gate and the fact check ──────────────────────
{
  // Can't invent numbers.
  const invent = A.applyPatch(bigNumber, [{ op: 'text', target: { role: 'headline' }, text: 'Burrow throws 99 touchdowns' }], nflCtx);
  assert.equal(invent.ok, false);
  assert.match(invent.skipped[0].why, /99.*not a number from the brief/);
  // A brief number is fine; other ops in the same patch still apply.
  const mixed = A.applyPatch(bigNumber, [{ op: 'text', target: { role: 'headline' }, text: 'Burrow 4 touchdowns' }, { op: 'text', target: { type: 'number' }, text: 'yards 77' }, { op: 'fx', target: { role: 'headline' }, fx: { rotate: 40, blend: 'nope' } }], nflCtx);
  assert.equal(mixed.applied.length, 2);
  assert.equal(mixed.skipped.length, 1, 'the label with an invented 77 is skipped');
  assert.equal(mixed.scene.layers.find(l => l.role === 'headline').fx.rotate, 8, 'rotation clamped to the ES limit');
  assert.equal(mixed.scene.layers.find(l => l.role === 'headline').fx.blend, undefined);
  // Off-palette colours snap to the palette (checkScene), purple never survives.
  const purple = A.applyPatch(bigNumber, [{ op: 'set', target: { role: 'headline' }, props: { color: '#8A2BE2', font: 'Comic Sans', stroke: 3, type: 'logo' } }], nflCtx);
  const head = purple.scene.layers.find(l => l.role === 'headline');
  assert.ok(purple.ok && head.color !== '#8A2BE2' && bigNumber.palette.allowed.map(c => c.toUpperCase()).includes(head.color), 'colour snapped to the palette');
  assert.equal(head.type, 'text', 'type cannot be changed');
  assert.notEqual(head.font, 'Comic Sans');
  assert.equal(head.stroke, undefined, 'no outlined type');
  // Safe area enforced after a move.
  const moved = A.applyPatch(bigNumber, [{ op: 'move', target: { role: 'headline' }, dx: -900, dy: 0 }], nflCtx);
  assert.ok(moved.scene.layers.find(l => l.role === 'headline').x >= 49, 'text kept inside the 50px safe area');
  assert.ok(moved.fixes.some(f => /safe area/.test(f)));
  // Not allowed: removing the background, unknown logos, ES logo layers, foreign photos.
  assert.equal(A.applyPatch(bigNumber, [{ op: 'remove', target: { type: 'background' } }], nflCtx).ok, false);
  assert.equal(A.applyPatch(bigNumber, [{ op: 'add', layer: { type: 'logo', src: 'https://evil.example/x.png' } }], nflCtx).ok, false);
  assert.equal(A.applyPatch(bigNumber, [{ op: 'photo', src: 'https://elsewhere.example/p.jpg' }], nflCtx).ok, false);
  const esLogo = A.applyPatch(bigNumber, [{ op: 'add', layer: { type: 'logo', src: nflCtx.logos[0].src, kind: 'es' } }], nflCtx);
  assert.ok(esLogo.ok && !esLogo.scene.layers.some(l => l.kind === 'es'), 'an added logo is never an ES mark');
  // Undo-safe: the input scene is never mutated.
  const snapshot = JSON.stringify(bigNumber);
  A.applyPatch(bigNumber, [{ op: 'fix', name: 'more-drama' }, { op: 'palette', flip: true }, { op: 'scale', target: { type: 'number' }, by: 1.3 }], nflCtx);
  assert.equal(JSON.stringify(bigNumber), snapshot);
  // Archetype swap and size change rebuild from the scene (scores kept).
  const story = A.applyPatch(scoreboard, [{ op: 'size', size: 'story' }], nflCtx);
  assert.ok(story.ok && story.scene.size.h === 1920 && story.scene.archetype === 'scoreboard');
  // gen4: the typographic poster needs a 3+ word headline (never a name alone).
  const worded = JSON.parse(JSON.stringify(bigNumber));
  (worded.layers.find(l => l.role === 'headline') || {}).text = 'BENGALS ROUT THE STEELERS';
  const typo = A.applyPatch(worded, [{ op: 'archetype', id: 'typographic' }], nflCtx);
  assert.ok(typo.ok && typo.scene.archetype === 'typographic');
  assert.equal(A.applyPatch(bigNumber, [{ op: 'archetype', id: 'not-a-layout' }], nflCtx).ok, false);

  // Local intents (free).
  const cases = [['Bigger number please', 'bigger-number'], ['more drama', 'more-drama'], ['add the Bengals logo', 'add-logo'], ['declutter it', 'less-clutter']];
  cases.forEach(([text, name]) => assert.equal(A.localIntent(text, bigNumber, nflCtx)?.ops[0].name, name, text));
  assert.deepEqual(A.localIntent('move the number left by 40', bigNumber, nflCtx).ops[0], { op: 'move', target: { type: 'number', nth: 0 }, dx: -40, dy: 0 });
  assert.equal(A.localIntent('swap to the typographic layout', bigNumber, nflCtx).ops[0].id, 'typographic');
  assert.equal(A.localIntent('make the headline punchier', bigNumber, nflCtx), null, 'copy asks go to the AI');
  assert.equal(A.localIntent('brighten the photo and then add a logo', bigNumber, nflCtx), null, 'compound asks go to the AI');
}

// ── 6. The assistant server: tiers, op normalisation, cost, rules ─────────
{
  const ctx = { photos: [{ src: 'https://images.essentiallysports.com/a.jpg', person: 'Joe Burrow' }], logos: [{ src: nflCtx.logos[0].src, name: 'Bengals' }], facts: nflCtx.facts, sport: 'NFL' };
  // Local: no AI call, $0.
  aiRequests.length = 0;
  let res = await D.assist({ instruction: 'bigger number', scene: bigNumber, context: ctx });
  assert.equal(res.status, 200);
  assert.equal(res.body.costUsd, 0);
  assert.equal(res.body.model, 'rules');
  assert.equal(aiRequests.length, 0);
  // Haiku for copy; an invented number in one op is skipped, the rest applied.
  aiReplies = [{ reply: 'Punchier headline, darker mist.', ops: [{ op: 'text', target: { role: 'headline' }, text: 'Burrow torches Pittsburgh' }, { op: 'text', target: { type: 'number' }, text: '500 YARDS' }, { op: 'fix', name: 'darker-mist' }, { op: 'palette', palette: 'team:Nowhere' }, { op: 'replace', scene: { kind: 'composed', layers: [] } }], suggestions: ['Add the logo', 'Try 3 lines'] }];
  res = await D.assist({ instruction: 'make the headline punchier', scene: bigNumber, context: ctx, history: [{ role: 'user', text: 'hi' }] });
  const call = aiRequests.at(-1);
  assert.ok(call.model.includes('haiku'), 'Haiku first');
  assert.ok(call.messages[0].content.includes('Editor: make the headline punchier'));
  assert.ok(call.messages[0].content.includes('Conversation so far'), 'multi-turn context');
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.ops.map(o => o.op), ['text', 'fix'], 'unknown palettes and replace ops from the model are dropped; the invented number skipped');
  assert.ok(res.body.skipped.some(s => /500/.test(s.why)));
  assert.equal(res.body.scene.layers.find(l => l.role === 'headline').text, 'BURROW TORCHES PITTSBURGH');
  assert.deepEqual(res.body.suggestions, ['Add the logo'], 'no digits in suggestions');
  assert.ok(res.body.costUsd > 0);
  // Sonnet for layout changes; photo ids map to this design's ES photos only.
  aiReplies = [{ reply: 'Rebuilt as a versus.', ops: [{ op: 'photo', photo: 'p1' }, { op: 'photo', photo: 'p9' }] }];
  res = await D.assist({ instruction: 'rearrange it into a different layout with the photo', scene: bigNumber, context: ctx });
  assert.ok(aiRequests.at(-1).model.includes('sonnet'), 'Sonnet for layout changes');
  assert.equal(D.normalizeOps([{ op: 'photo', photo: 'p9' }], D.cleanContext(ctx, bigNumber)).length, 0);
  assert.equal(D.normalizeOps([{ op: 'palette', palette: 'es' }], D.cleanContext(ctx, bigNumber))[0].colors[0], '#033162');
  // Bad input.
  assert.equal((await D.assist({ instruction: 'x', scene: bigNumber })).status, 400);
  assert.equal((await D.assist({ instruction: 'bigger', scene: { kind: 'template' } })).status, 400);
  assert.ok(D.SYSTEM().includes('NEVER add, change or invent a number'));
}

// ── 7. es-generate modes ──────────────────────────────────────────────────
{
  M._test.reset();
  lessonRows = null;
  aiReplies = [{ reply: 'Done.', ops: [{ op: 'fix', name: 'more-contrast' }] }];
  const assist = await post({ mode: 'creative-assist', instruction: 'make the headline punchier', scene: bigNumber, context: { sport: 'NFL' } });
  assert.equal(assist.status, 200);
  assert.equal(assist.body.ok, true);
  assert.ok(M._test.memory().size > 0, 'assistant requests feed the learning model');
  const usage = restCalls.filter(c => c.href.includes('ai_usage') || c.href.includes('usage')).map(c => JSON.parse(c.body || '{}').feature).filter(Boolean);
  assert.ok(usage.includes('generate-assistant'), 'logUsage feature generate-assistant');
  restCalls.length = 0;
  const sig = await post({ mode: 'creative-signal', signal: { type: 'export', designId: 'r1:d1', runId: 'r1', archetype: 'big-number', sport: 'NFL' } });
  assert.deepEqual(sig, { status: 200, body: { ok: true, observed: 1 } });
  const event = restCalls.find(c => c.href.includes('frameup_generate_direction_events'));
  assert.equal(JSON.parse(event.body).type, 'design_exported', 'exports also go to the direction-events log');
  assert.equal((await post({ mode: 'creative-signal', signal: { type: 'judge' } })).status, 400);
  const admin = await post({ mode: 'creative-lessons' });
  assert.equal(admin.status, 200);
  assert.ok(admin.body.totals.lessons >= 1 && Array.isArray(admin.body.top) && Array.isArray(admin.body.recurring));
  // Judge mode: lessons in, critique out, judge improvements learned.
  M._test.reset();
  P.JUDGE_CACHE.clear();
  aiReplies = [{ directions: [{ id: 'd1', best: 'd1c1', scores: {}, improvements: [{ text: 'Number lacks its unit', fix: '' }], nextTime: 'Always label numbers.' }] }];
  const judged = await post({ mode: 'creative-judge', brief: NFL, sport: 'NFL', sets: [{ direction: 'd1', archetype: 'big-number', items: [{ id: 'd1c1', image: 'data:image/jpeg;base64,QkJC' }] }] });
  assert.equal(judged.status, 200);
  // gen4: the issue is not a chip; it still reaches the learning model.
  assert.deepEqual(judged.body.directions[0].critique.improvements, []);
  assert.ok(judged.body.directions[0].issues.includes('Number lacks its unit'));
  assert.ok([...M._test.memory().values()].some(l => l.topic === 'number-unit'), 'the judge teaches the memory');
}

// ── 8. Undo / redo ────────────────────────────────────────────────────────
{
  const h = A.createHistory({ v: 0 }, { limit: 3 });
  assert.equal(h.canUndo(), false);
  h.push({ v: 1 }, 'one');
  h.push({ v: 2 }, 'two');
  assert.deepEqual(h.undo(), { v: 1 });
  assert.deepEqual(h.undo(), { v: 0 });
  assert.equal(h.undo(), null);
  assert.deepEqual(h.redo(), { v: 1 });
  h.push({ v: 9 }, 'branch');
  assert.equal(h.canRedo(), false, 'a new change clears redo');
  h.push({ v: 10 }); h.push({ v: 11 }); h.push({ v: 12 });
  assert.equal(h.size(), 4, 'the stack is capped');
  const cur = h.current; cur.v = 999;
  assert.equal(h.current.v, 12, 'history hands out copies');
  assert.deepEqual(h.entries().find(e => e.current), { label: 'Change', at: 3, current: true });
}

// ── 9. Page wiring ────────────────────────────────────────────────────────
{
  const html = fs.readFileSync('generate.html', 'utf8');
  assert.match(html, /<script src="generate-assistant\.js\?v=[\w-]+" defer><\/script>/);
  const js = fs.readFileSync('generate-creative.js', 'utf8');
  ['FrameUpAssistant', 'designCritique', 'register', "signal?.('export'", "signal?.('edit'", 'sport: plan.read?.sport'].forEach(text => assert.ok(js.includes(text), `generate-creative.js has ${text}`));
  const client = fs.readFileSync('generate-assistant.js', 'utf8');
  ['frameup:design-changed', 'applyImprovement', 'mount(slotEl', 'creative-assist', 'creative-signal'].forEach(text => assert.ok(client.includes(text), `generate-assistant.js has ${text}`));
  assert.ok(!/purple|#8A2BE2|violet/i.test(client), 'no purple');
}

console.log('gen-brain checks passed');
