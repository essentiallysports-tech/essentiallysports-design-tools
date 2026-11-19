// Generate v4 "gen4-learning" (2026-11-21): Generate learns after every run
// from what goes final and what gets changed. Covers: the page's signal
// capture (frameup-learning.js), diff extraction, distillation and decay of
// change lessons, outcome scoring (hits / recurrences on exports), injection
// into the director's and the judge's prompts, the ranking effect on the
// next run, and the admin repeat-change trend. Every network call is mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const authPath = path.join(fnDir, '_supabase-auth.js');
const mcpPath = path.join(fnDir, '_es-mcp.js');

const NFL = 'Bengals rout Steelers 38-18 on Sunday Night Football and sit alone atop the AFC North at 7-2. Joe Burrow threw for 409 yards and 4 touchdowns. Ja\'Marr Chase caught 11 passes for 231 yards. Cincinnati outgained Pittsburgh 484-222.\nSport: NFL';
const DAY = 24 * 60 * 60 * 1000;

// ── Mocks ─────────────────────────────────────────────────────────────────
let aiReplies = [];
const aiRequests = [];
const restCalls = [];
let eventRows = [];
let admin = true;
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
  restCalls.push({ href, method: options.method || 'GET', body: options.body, headers: options.headers });
  if (href.includes('/rpc/is_es_designer_admin')) return reply(200, admin);
  if (href.includes('/rest/v1/frameup_creative_lessons') || href.includes('/rpc/frameup_creative_lessons_bump')) return reply(404, { code: 'PGRST205' });
  if (href.includes('/rest/v1/frameup_generate_direction_events')) {
    if ((options.method || 'GET') === 'POST') { eventRows.push({ created_at: new Date().toISOString(), ...JSON.parse(options.body) }); return reply(201, null); }
    return reply(200, eventRows.filter(r => r.type === 'design_exported' && r.payload?.signal === 'export'));
  }
  if (href.includes('/rest/v1/')) return reply(200, []);
  throw new Error(`unexpected fetch ${href}`);
};
process.env.AI_GATEWAY_API_KEY = 'gw-test';
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }), verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }), bearerToken: () => 'tok' } };
require.cache[mcpPath] = { id: mcpPath, filename: mcpPath, loaded: true, exports: { isMcpConfigured: () => false, createSession: () => null } };

const L = require(path.resolve('frameup-learning.js'));
const M = require(path.join(fnDir, '_creative-memory.js'));
const P = require(path.join(fnDir, '_composer.js'));
const gen = require(path.join(fnDir, 'es-generate.js'));
P.setAssetService(null);
const post = body => gen.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) }).then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));

// A delivered design and the version an editor downloaded.
const scene = (over = {}) => ({
  id: 'c1', archetype: 'stat-stack', archetypeName: 'Stat Stack', tone: 'dark', size: { w: 1080, h: 1350 }, palette: { mode: 'dark', bg: '#000' },
  layers: [
    { type: 'photo', role: 'bg', src: 'https://img.es/crowd-at-stadium.jpg' },
    { type: 'pill', role: 'kicker', text: 'NFL WEEK 10' },
    { type: 'text', role: 'headline', text: 'THE BENGALS ROUT THE STEELERS ON SUNDAY NIGHT FOOTBALL' },
    { type: 'text', role: 'body', text: 'Joe Burrow threw for 409 yards and four touchdowns as Cincinnati rolled.' },
  ],
  ...over,
});
const edited = () => {
  const s = scene({ size: { w: 1080, h: 1920 }, palette: { mode: 'light', bg: '#fff' } });
  s.layers[0].src = 'https://img.es/joe-burrow.jpg';
  s.layers[2].text = 'BENGALS ROUT STEELERS';
  s.layers[3].text = '';
  return s;
};
const photos = [{ src: 'https://img.es/joe-burrow.jpg', person: 'Joe Burrow' }];

// ── 1. Diff extraction (page) ─────────────────────────────────────────────
{
  const history = { entries: [{ scene: scene(), source: 'start' }, { scene: edited(), source: 'text' }, { scene: edited(), source: 'photo' }, { scene: edited(), source: 'fix' }], index: 3 };
  const diff = L.diffScenes(scene(), edited(), { photos, history });
  assert.deepEqual([diff.headline.beforeWords, diff.headline.afterWords], [9, 3], 'headline word counts');
  assert.equal(diff.body.removed, true, 'body copy deleted');
  assert.equal(diff.kicker, undefined, 'unchanged roles are left out');
  assert.deepEqual(diff.photo, { from: 'scene', to: 'person', crowd: true }, 'a crowd shot swapped for the named player');
  assert.deepEqual(diff.size, { from: 'portrait', to: 'story' });
  assert.deepEqual(diff.palette, { from: 'dark', to: 'light' });
  assert.deepEqual([diff.steps, diff.fixes, diff.asks], [3, 1, 0]);
  assert.equal(L.isUnchanged(diff), false);
  const same = L.diffScenes(scene(), scene(), { photos, history: { entries: [{ scene: scene() }], index: 0 } });
  assert.equal(L.isUnchanged(same), true, 'shipped as is');
  // Case-only differences (setText upper-cases) are not changes.
  const upper = scene(); upper.layers[3].text = upper.layers[3].text.toUpperCase();
  assert.equal(L.diffScenes(scene(), upper).body, undefined);
  const shuffled = L.diffScenes(scene(), scene({ archetype: 'scoreboard' }));
  assert.deepEqual(shuffled.archetype, { from: 'stat-stack', to: 'scoreboard' });
  assert.equal(L.photoKind(scene({ layers: [{ type: 'cutout', src: 'x.png' }] })), 'cutout');
  assert.equal(L.sizeKey({ size: { w: 1080, h: 1080 } }), 'square');
}

// ── 2. Signal capture (page -> creative-signal body) ──────────────────────
{
  const sent = [];
  L._test.setSender(body => sent.push(body));
  L._test.reset();
  const history = { entries: [{ scene: scene(), source: 'start' }, { scene: edited(), source: 'text' }], index: 1 };
  globalThis.FrameUpCreative = {
    state: { run: { plan: { runId: 'r1', read: { sport: 'NFL' }, lessons: [{ key: 'avoid:archetype=stat-stack:chg-headline-shorter' }, { key: 'avoid:global:headline-long' }] } } },
    design: id => (id === 'r1-d1' ? { runId: 'r1', getScene: () => edited(), history, photos: () => photos } : null),
  };
  const out = L.capture({ event: 'download', designId: 'r1-d1', format: 'image/png' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].mode, 'creative-signal');
  const sig = sent[0].signal;
  assert.equal(sig.event, 'download');
  assert.equal(sig.runId, 'r1');
  assert.equal(sig.archetype, 'stat-stack');
  assert.equal(sig.tone, 'dark');
  assert.equal(sig.sport, 'NFL');
  assert.ok(sig.diff.headline && sig.diff.photo && sig.diff.size, 'the structured diff rides along');
  assert.deepEqual(sig.injected, ['avoid:archetype=stat-stack:chg-headline-shorter', 'avoid:global:headline-long'], 'the run\'s lesson keys (to score the outcome)');
  assert.equal(out.designId, 'r1-d1');
  L.capture({ event: 'download', designId: 'r1-d1', format: 'image/jpeg' });
  assert.equal(sent.length, 1, 'PNG then JPG of the same version counts once');
  assert.equal(L.capture({ event: 'bogus' }), false);
  // Shuffle away: one reject for the composition left behind, once per archetype.
  const changed = (s, source) => L._test.onChanged({ detail: { origin: 'generate', designId: 'r1-d1', scene: s, source } });
  changed(scene({ archetype: 'scoreboard', archetypeName: 'Scoreboard' }), 'another');
  changed(scene({ archetype: 'hero-number' }), 'another');
  changed(scene({ archetype: 'hero-number' }), 'text');
  const rejects = sent.filter(b => b.signal.event === 'reject');
  assert.deepEqual(rejects.map(b => b.signal.archetype), ['stat-stack', 'scoreboard']);
  delete globalThis.FrameUpCreative;
}

// ── 3. Server: normalise, changes, observations ──────────────────────────
const norm = raw => M.normalizeSignal(raw).signal;
{
  const sig = norm({ event: 'download', designId: 'r1-d1', runId: 'r1', archetype: 'stat-stack', archetypeName: 'Stat Stack', tone: 'dark', sport: 'NFL', diff: L.diffScenes(scene(), edited(), { photos }), injected: ['avoid:global:chg-body-cut', 'DROP TABLE', 'prefer:global:x'] });
  assert.equal(sig.type, 'export', 'download is an export');
  assert.deepEqual(sig.injected, ['avoid:global:chg-body-cut'], 'only lesson keys survive');
  assert.equal(M.normalizeSignal({ event: 'assist', text: 'x' }).signal.type, 'assistant');
  assert.equal(M.normalizeSignal({ event: 'apply', text: 'x' }).signal.type, 'improvement');
  assert.ok(M.normalizeSignal({ event: 'judge' }).error, 'the page cannot fake judge signals');
  const topics = M.changesOf(sig.diff).map(c => c.topic);
  assert.deepEqual(topics, ['chg-headline-shorter', 'chg-body-cut', 'chg-photo-scene', 'chg-size-story', 'chg-palette-light']);
  const obs = M.observationsFrom(sig);
  const short = obs.filter(o => o.topic === 'chg-headline-shorter');
  assert.deepEqual(short.map(o => o.scope), ['global', 'archetype', 'sport'], 'per archetype, sport and overall');
  assert.match(short.find(o => o.scope === 'archetype').text, /^On Stat Stack, people shorten the headline before posting \(9 to 3 words\)/);
  assert.match(obs.find(o => o.topic === 'chg-photo-scene').text, /no-person photos \(crowd, venue, objects\)/);
  const pref = obs.find(o => o.kind === 'prefer');
  assert.equal(pref.weight, 1, 'a changed export is weak taste evidence');
  // Unchanged: strong taste for the archetype and the tone; no change lessons.
  const asIs = M.observationsFrom(norm({ event: 'export', archetype: 'scoreboard', archetypeName: 'Scoreboard', tone: 'light', sport: 'NFL', diff: { steps: 0 } }));
  assert.deepEqual(asIs.map(o => [o.topic, o.weight]), [['prefer-scoreboard', 2.5], ['prefer-tone-light', 1.5]]);
  assert.match(asIs[0].text, /as is/);
  // Shuffles, fixes and asks count as changes but have their own signals.
  const own = M.observationsFrom(norm({ event: 'export', archetype: 'x', diff: { archetype: { from: 'a', to: 'x' }, fixes: 2, asks: 1 } }));
  assert.ok(own.every(o => o.kind === 'prefer'), 'no double counting');
  // Legacy export (no diff) still teaches taste.
  assert.equal(M.observationsFrom({ type: 'export', archetype: 'scoreboard', sport: 'NFL' })[0].kind, 'prefer');
}

// ── 4. Distillation, decay and outcome scoring ────────────────────────────
{
  const t0 = Date.parse('2026-11-01T00:00:00Z');
  const sig = norm({ event: 'export', archetype: 'stat-stack', archetypeName: 'Stat Stack', sport: 'NFL', diff: { headline: { before: 'A B C D E F G H I', after: 'A B C', beforeWords: 9, afterWords: 3 } } });
  let { lessons } = M.distil([], M.observationsFrom(sig), { now: t0, outcome: true });
  const key = 'avoid:archetype=stat-stack:chg-headline-shorter';
  assert.ok(lessons.find(l => l.key === key), 'one row per topic and scope');
  assert.equal(M.selectLessons(lessons, { sport: 'NFL', archetypes: ['stat-stack'], now: t0 }).filter(l => l.change).length, 0, 'one export is not a lesson yet');
  ({ lessons } = M.distil(lessons, M.observationsFrom(sig), { now: t0 + DAY, outcome: true }));
  const picked = M.selectLessons(lessons, { sport: 'NFL', archetypes: ['stat-stack'], now: t0 + DAY });
  const change = picked.find(l => l.change);
  assert.equal(change.key, key, 'two exports in a day: an active change lesson, the archetype scope wins');
  assert.equal(picked.filter(l => l.topic === 'chg-headline-shorter').length, 1, 'one slot per topic');
  // Summary: the third time it is a REPEAT (the lesson was already active).
  const summary = M.exportSummary(sig, lessons, { now: t0 + DAY });
  assert.deepEqual(summary, { unchanged: false, changes: ['chg-headline-shorter'], repeats: ['chg-headline-shorter'], archetype: 'stat-stack', tone: '' });
  assert.deepEqual(M.exportSummary(norm({ event: 'export', archetype: 'stat-stack', diff: {} }), lessons, { now: t0 + DAY }).repeats, []);
  // Outcomes score change lessons: injected and not changed again = hit.
  const injected = M.scopedInjected(sig, [key, 'avoid:archetype=scoreboard:chg-body-cut', 'avoid:global:headline-long']);
  assert.deepEqual(injected, [key], 'only change lessons in the export\'s scopes');
  let res = M.distil(lessons, M.observationsFrom(norm({ event: 'export', archetype: 'stat-stack', sport: 'NFL', diff: {} })), { now: t0 + 2 * DAY, injected, outcome: true });
  assert.equal(res.lessons.find(l => l.key === key).hits, 1, 'the lesson held: shipped without shortening');
  res = M.distil(res.lessons, M.observationsFrom(sig), { now: t0 + 3 * DAY, injected, outcome: true });
  assert.equal(res.lessons.find(l => l.key === key).recurrences, 1, 'changed again after the lesson was injected');
  // The judge never scores change lessons.
  const judged = M.distil(res.lessons, [], { now: t0 + 4 * DAY, injected: [key] });
  assert.equal(judged.lessons.find(l => l.key === key).hits, 1, 'judge pass: no hit for a change lesson');
  // Decay: two months later it has faded out.
  assert.equal(M.selectLessons(res.lessons, { sport: 'NFL', archetypes: ['stat-stack'], now: t0 + 70 * DAY }).filter(l => l.change).length, 0, 'old changes fade');
  // Size lessons are kept for admins but never prompted.
  const sized = M.distil([], [...M.observationsFrom(norm({ event: 'export', archetype: 'a', diff: { size: { from: 'portrait', to: 'story' } } })), ...M.observationsFrom(norm({ event: 'export', archetype: 'a', diff: { size: { from: 'portrait', to: 'story' } } }))], { now: t0, outcome: true });
  assert.equal(M.selectLessons(sized.lessons, { now: t0, archetypes: '*' }).filter(l => /size/.test(l.topic)).length, 0);
  assert.ok(M.adminView(sized.lessons, { now: t0 }).changes.some(r => r.topic === 'chg-size-story'));
}

// ── 5. Injection: director and judge prompts ──────────────────────────────
{
  const t0 = Date.now();
  const rows = [
    { key: 'avoid:archetype=stat-stack:chg-headline-shorter', text: 'On Stat Stack, people shorten the headline before posting (9 to 3 words); write it that short from the start.', topic: 'chg-headline-shorter', kind: 'avoid', scope: 'archetype', scopeValue: 'stat-stack', evidence: 3, lastSeen: new Date(t0).toISOString() },
    { key: 'avoid:archetype=scoreboard:chg-headline-shorter', text: 'On Scoreboard, people shorten the headline before posting (8 to 4 words); write it that short from the start.', topic: 'chg-headline-shorter', kind: 'avoid', scope: 'archetype', scopeValue: 'scoreboard', evidence: 2.5, lastSeen: new Date(t0).toISOString() },
    { key: 'avoid:global:headline-long', text: 'Keep headlines to 2-6 words so they set big.', topic: 'headline-long', kind: 'avoid', scope: 'global', scopeValue: '', evidence: 3, lastSeen: new Date(t0).toISOString() },
    { key: 'prefer:sport=nfl:prefer-scoreboard', text: 'Editors ship the Scoreboard composition for NFL as is; offer it when the brief fits.', topic: 'prefer-scoreboard', kind: 'prefer', scope: 'sport', scopeValue: 'NFL', evidence: 5, lastSeen: new Date(t0).toISOString() },
    { key: 'avoid:sport=nfl:reject-big-number', text: 'Editors often reject the Big Number composition for NFL.', topic: 'reject-big-number', kind: 'avoid', scope: 'sport', scopeValue: 'NFL', evidence: 4, lastSeen: new Date(t0).toISOString() },
    { key: 'prefer:sport=nfl:prefer-tone-light', text: 'Designs in the light tone ship as is for NFL.', topic: 'prefer-tone-light', kind: 'prefer', scope: 'sport', scopeValue: 'NFL', evidence: 3, lastSeen: new Date(t0).toISOString() },
  ];
  const director = M.selectLessons(rows, { sport: 'NFL', archetypes: '*', limit: 7, rank: true, now: t0 });
  assert.equal(director.filter(l => l.topic === 'chg-headline-shorter').length, 2, 'the director gets each archetype\'s change lesson');
  assert.ok(!director.some(l => l.topic === 'headline-long'), 'the critique twin steps aside for the change lesson');
  assert.ok(director.length <= 8, 'fits the composer\'s 8');
  const rank = director.find(l => l.kind === 'rank');
  assert.match(rank.text, /rank these archetypes first.*scoreboard/);
  assert.match(rank.text, /rank these last.*big-number/);
  assert.match(rank.text, /tones that ship as is: light/);
  const dLines = M.promptLines(director, { who: 'director' }).join('\n');
  assert.match(dLines, /What editors change before posting, every time \(do it while designing/);
  assert.match(dLines, /On Stat Stack, people shorten the headline/);
  assert.match(dLines, /Ranking from past exports/);
  const judge = M.selectLessons(rows, { sport: 'NFL', archetypes: ['stat-stack'], now: t0 });
  const jLines = M.promptLines(judge, { who: 'judge' }).join('\n');
  assert.match(jLines, /not finished: fix it now \(it is a repair, not a suggestion\)/);
  assert.ok(!/Scoreboard, people/.test(jLines), 'the judge gets only its archetypes');
  assert.ok(!/Ranking from past exports/.test(jLines), 'no ranking line for the judge');
  // Through the composer: the director's request carries them.
  const read = P.readCreative(NFL, {});
  const req = P.directorRequest(read, { photos: {} }, { lessons: director });
  assert.ok(req.includes('On Stat Stack, people shorten the headline') && req.includes('Ranking from past exports'), 'directorRequest carries change lessons and ranking');
  // And the judge's prompt.
  assert.ok(P.judgePrompt([{ direction: 'd1', archetype: 'stat-stack', items: [{ id: 'd1c1' }] }], NFL, judge).includes('fix it now'), 'judgePrompt carries change lessons');
}

// ── 6. Ranking effect on the next run ─────────────────────────────────────
{
  const bias = M.rankBias([
    { topic: 'prefer-scoreboard', kind: 'prefer', scope: 'global', evidence: 3, lastSeen: new Date().toISOString() },
    { topic: 'reject-big-number', kind: 'avoid', scope: 'global', evidence: 3, lastSeen: new Date().toISOString() },
    { topic: 'chg-palette-light', kind: 'avoid', scope: 'global', evidence: 4, lastSeen: new Date().toISOString() },
    { topic: 'prefer-hero-number', kind: 'prefer', scope: 'sport', scopeValue: 'NBA', evidence: 9, lastSeen: new Date().toISOString() },
  ], { sport: 'NFL' });
  assert.deepEqual(bias.archetypes, { scoreboard: 3, 'big-number': -3 }, 'other sports do not count');
  assert.ok(bias.tones.light > 0 && bias.tones.dark < 0, 'palette flips to light favour light tones');
  const list = [{ archetype: 'big-number' }, { archetype: 'typographic' }, { archetype: 'scoreboard' }, { archetype: 'magazine-cover' }];
  M.rankDirections(list, { bias });
  assert.deepEqual(list.map(d => d.archetype), ['scoreboard', 'typographic', 'magazine-cover', 'big-number'], 'stable: preferred first, rejected last');
  const untouched = [{ archetype: 'b' }, { archetype: 'a' }];
  M.rankDirections(untouched, { bias: { archetypes: {}, tones: {} } });
  assert.deepEqual(untouched.map(d => d.archetype), ['b', 'a'], 'no memory, no change');

  // End to end: the code plan (no director) before and after the team ships one archetype as is.
  M._test.reset();
  P.PLAN_CACHE.clear();
  const before = await P.plan({ brief: NFL, found: {}, want: 2, director: false, cacheKey: 'rank-before' });
  // A lower-ranked archetype that survives the plan's own checks (gen4 swaps
  // designs with empty areas, so pick from what a wider plan actually keeps).
  const wide = await P.plan({ brief: NFL, found: {}, want: 6, director: false, cacheKey: 'rank-wide' });
  const base = wide.directions.map(d => d.archetype);
  const target = base.find(a => a !== before.directions[0].archetype && a !== base[0]);
  assert.ok(target, 'a lower-ranked archetype to promote');
  for (let i = 0; i < 2; i += 1) await M.learn({ token: 'tok', signals: [norm({ event: 'export', archetype: target, sport: 'NFL', diff: { steps: 0 } })] });
  const after = await P.plan({ brief: NFL, found: {}, want: 2, director: false, cacheKey: 'rank-after' });
  assert.equal(after.directions[0].archetype, target, `shipped-as-is ${target} now leads the next run`);
  assert.notEqual(before.directions[0].archetype, target);
}

// ── 7. Handler: creative-signal logs the outcome; creative-lessons trend ───
{
  M._test.reset();
  eventRows = [];
  const diff = L.diffScenes(scene(), edited(), { photos });
  for (let i = 0; i < 3; i += 1) {
    const res = await post({ mode: 'creative-signal', signal: { event: 'download', designId: `r${i}-d1`, runId: `r${i}`, archetype: 'stat-stack', archetypeName: 'Stat Stack', tone: 'dark', sport: 'NFL', diff } });
    assert.equal(res.status, 200);
    assert.equal(res.body.summary.unchanged, false);
    if (i === 0) assert.deepEqual(res.body.summary.repeats, [], 'first time: nothing known yet');
    if (i === 2) assert.ok(res.body.summary.repeats.includes('chg-headline-shorter'), 'third time: a repeat change');
  }
  await post({ mode: 'creative-signal', signal: { event: 'download', designId: 'r9-d1', runId: 'r9', archetype: 'scoreboard', tone: 'light', sport: 'NFL', diff: { steps: 0 } } });
  assert.equal(eventRows.length, 4, 'every export is logged');
  assert.equal(eventRows[0].type, 'design_exported');
  assert.equal(eventRows[0].payload.signal, 'export');
  assert.ok(eventRows[0].payload.learn && eventRows[0].payload.diff, 'the row carries the summary and the diff');
  assert.equal(eventRows[3].payload.learn.unchanged, true);
  const view = await post({ mode: 'creative-lessons' });
  assert.equal(view.status, 200);
  assert.equal(view.body.admin, true);
  assert.equal(view.body.trend.source, 'team');
  assert.equal(view.body.trend.totals.exports, 4);
  assert.equal(view.body.trend.totals.repeatRate, 0.25, 'one of four exports repeated a known change');
  assert.equal(view.body.trend.totals.shipRate, 0.25);
  assert.equal(view.body.trend.topChanges[0].topic, 'chg-headline-shorter');
  assert.ok(view.body.changes.some(c => c.topic === 'chg-photo-scene'), 'admins see what people change');
  assert.ok(view.body.preferences.archetypes.scoreboard > 0, 'and what ships');
  admin = false;
  const nonAdmin = await post({ mode: 'creative-lessons' });
  assert.equal(nonAdmin.body.trend, null, 'the trend is admins only');
  admin = true;
  // The admin card renders it.
  const html = L.adminHtml(view.body);
  assert.match(html, /Repeat-change rate, latest week/);
  assert.match(html, /Shortened the headline/);
  assert.match(L.adminHtml({ ...view.body, trend: null }), /Admins only/);
}

// ── 8. Trend maths: weekly buckets, falling repeat rate ───────────────────
{
  const now = Date.parse('2026-11-21T12:00:00Z');
  const row = (daysAgo, learn) => ({ created_at: new Date(now - daysAgo * DAY).toISOString(), payload: { learn } });
  const rows = [
    row(50, { unchanged: false, changes: ['chg-headline-shorter'], repeats: ['chg-headline-shorter'] }),
    row(50, { unchanged: false, changes: ['chg-photo-scene'], repeats: ['chg-photo-scene'] }),
    row(2, { unchanged: true, changes: [], repeats: [] }),
    row(1, { unchanged: false, changes: ['chg-headline-shorter'], repeats: [] }),
    row(90, { unchanged: false, changes: ['x'], repeats: ['x'] }),
  ];
  const t = M.trendFrom(rows, { now, weeks: 8 });
  assert.equal(t.weeks.length, 8);
  assert.equal(t.totals.exports, 4, 'older than 8 weeks is left out');
  assert.equal(t.weeks.find(w => w.exports === 2 && w.repeat === 2).repeatRate, 1);
  assert.equal(t.weeks[7].repeatRate, 0);
  assert.equal(t.repeatRateDelta, -1, 'the repeat rate fell: the model learned');
  assert.equal(t.topChanges[0].topic, 'chg-headline-shorter');
}

console.log('gen4-learning checks passed');
