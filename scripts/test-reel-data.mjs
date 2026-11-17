#!/usr/bin/env node
// Reels Studio data plans (reel-data.js) and the data-format director
// (_reel-director.js runDataDirector, reel-maker plan hand-off): drama,
// key plays, the scorebug, clip-to-play matching, and the three plans.
// Every plan's refs resolve (validateTimeline), every number it shows is in
// the facts text (provenance), WP on screen carries its attribution, and the
// AI copy pass can only change words. The Gateway is stubbed: no network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const D = require('../reel-data.js');
const T = require('../reel-timeline.js');
const F = require('../reel-formats.js');
const G = require('../netlify/functions/_reel-games.js');
const gateway = require('../netlify/functions/_ai-gateway.js');
const DIR = require('../netlify/functions/_reel-director.js');
const FX = new URL('./fixtures/reels/', import.meta.url);
const fx = name => JSON.parse(readFileSync(new URL(name, FX), 'utf8'));

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}

const GOLD = fx('nfl-401873063.digest.json');
const FULL = G.digestGame(fx('espn-nfl-summary-401873063.full.min.json'), { sport: 'nfl', eventId: '401873063' });
const MLB = G.digestGame(fx('espn-mlb-summary-401908046.min.json'), { sport: 'mlb', eventId: '401908046' });
const ATHLETE = fx('athlete-2330.response.json').athlete;
const ARCHIVE = fx('archive-research-2330.response.json');
const REPLAY_TL = fx('timeline-v2-replay.json');

const asTimeline = plan => DIR.planTimeline(plan);
function provenance(plan, facts) {
  const set = F.numberSet(facts);
  const bad = [];
  plan.beats.forEach(b => { const n = F.unsourcedNumbers(b, set, plan.format); if (n.length) bad.push(`${b.id} "${b.text}": ${n.join(',')}`); });
  (plan.slides || []).forEach(s => F.numbersIn(`${s.text} ${s.caption || ''}`).forEach(n => { if (!set.has(n)) bad.push(`${s.id} "${s.text}": ${n}`); }));
  return bad;
}

await test('dramaScore: 0..1, null without data; a late comeback outranks a blowout', () => {
  assert.equal(D.dramaScore(null), null);
  assert.equal(D.dramaScore({ ...GOLD, plays: [], wp: null }), null);
  const full = D.dramaScore(FULL);
  assert.ok(full > 0 && full <= 1);
  const blowout = { ...FULL, plays: FULL.plays.map(p => ({ ...p, swing: 0.01, tags: p.tags.filter(t => t !== 'lead-change') })), wp: { ...FULL.wp, points: FULL.wp.points.map(p => [p[0], 0.05]) } };
  assert.ok(D.dramaScore(blowout) < full);
  const parts = D.dramaParts(FULL);
  assert.equal(parts.late, 1, 'scoring in Q4 inside one score');
  assert.ok(D.wpSpark(FULL).length === 24 && D.wpSpark(FULL).every(v => v >= 0 && v <= 1));
});

await test('keyPlays: <= n, the biggest swing and scoring plays, in game order', () => {
  const k = D.keyPlays(FULL, 5);
  assert.ok(k.length <= 5 && k.length >= 3);
  k.forEach((p, i) => { if (i) assert.ok(p.seq > k[i - 1].seq); });
  const maxSwing = FULL.plays.reduce((m, p) => (Math.abs(p.swing || 0) > Math.abs(m.swing || 0) ? p : m), FULL.plays[0]);
  assert.ok(k.some(p => p.id === maxSwing.id), 'the biggest swing is in');
  assert.ok(k.every(p => p.scoring || p.tags.some(t => t !== 'period-end')));
  assert.deepEqual(D.keyPlays(GOLD, 5).map(p => p.id), ['401873063302', '401873063558']);
});

for (const [label, digest] of [['golden (truncated) NFL', GOLD], ['full NFL', FULL], ['MLB', MLB]]) {
  await test(`planFromGame (${label}): refs resolve, play beats cite plays, WP attributed, numbers from the facts`, () => {
    const plan = D.planFromGame(digest);
    const v = T.validateTimeline(asTimeline(plan));
    assert.ok(v.ok, JSON.stringify(v.errors));
    assert.equal(plan.format, 'gameswing');
    assert.equal(plan.style, 'series');
    assert.equal(plan.beats[0].kind, 'hook');
    assert.equal(plan.beats.at(-1).kind, 'cta');
    assert.ok(plan.beats.length >= 4 && plan.beats.length <= F.FORMATS.gameswing.beats.max);
    plan.beats.filter(b => b.kind === 'play').forEach(b => assert.ok(b.refs.some(r => r.startsWith('play:'))));
    const wp = plan.beats.find(b => b.kind === 'wpline');
    if (digest.wp && digest.wp.points.length >= 2) {
      assert.ok(wp, 'a wpline beat when the digest has WP');
      assert.equal(plan.attribution, 'Win probability: ESPN Analytics');
      assert.equal(wp.attribution, digest.attribution);
    } else assert.equal(wp, undefined);
    assert.deepEqual(provenance(plan, D.factsText(digest)), []);
    assert.ok(plan.beats.every(b => b.refs.length <= T.LIMITS.refsPerBeat));
    assert.equal(JSON.stringify(plan).includes('espncdn'), false);
  });
}

await test('planFromGame without WP: no wpline, no wp refs, no attribution', () => {
  const noWp = { ...FULL, wp: null, attribution: '', plays: FULL.plays.map(p => ({ ...p, wpHome: null, swing: null })) };
  const plan = D.planFromGame(noWp);
  assert.ok(T.validateTimeline(asTimeline(plan)).ok);
  assert.ok(plan.beats.every(b => b.kind !== 'wpline' && !b.refs.some(r => r.startsWith('wp:'))));
  assert.equal(plan.attribution, '');
});

await test('planFromGame (live): live hook, no final payoff', () => {
  const live = { ...GOLD, status: { state: 'in', final: false, detail: '6:56 - 1st', period: 1, clock: '6:56' } };
  const plan = D.planFromGame(live);
  assert.match(plan.beats[0].text, /^Live: SF \d+, DAL \d+$/);
  assert.ok(!plan.beats.some(b => b.kind === 'payoff'));
  assert.deepEqual(provenance(plan, D.factsText(live)), []);
});

await test('scorebugAt: state from the digest only, scores never go backwards', () => {
  const plan = D.planFromGame(FULL);
  let t = 0;
  const beats = plan.beats.map(b => { const out = { ...b, inMs: t, outMs: t + 2000 }; t += 2000; return out; });
  const tl = { ...asTimeline(plan), beats };
  let last = { home: -1, away: -1 };
  for (let ms = 0; ms < t; ms += 250) {
    const s = D.scorebugAt(tl, ms);
    assert.ok(s.home.score >= last.home && s.away.score >= last.away, `monotonic at ${ms}`);
    last = { home: s.home.score, away: s.away.score };
    assert.deepEqual([s.home.abbr, s.away.abbr], ['DAL', 'SF']);
  }
  const end = D.scorebugAt(tl, t - 1);
  assert.deepEqual([end.final, end.label, end.home.score, end.away.score], [true, 'FINAL', 40, 46]);
  const playBeat = beats.find(b => b.kind === 'play');
  const s = D.scorebugAt(tl, playBeat.inMs + 10);
  const p = FULL.plays.find(x => `play:${x.id}` === playBeat.refs[0]);
  assert.deepEqual([s.home.score, s.away.score, s.clock, s.down, s.label], [p.score.home, p.score.away, p.clock, p.down, `Q${p.period}`]);
  assert.equal(D.scorebugAt({ beats: [] }, 0), null);
  assert.equal(D.periodLabel('mlb', 9, 'bottom'), 'Bot 9');
  assert.equal(D.periodLabel('nfl', 5, null), 'OT');
});

await test('matchClipToPlay: 1-15 min window, team handle, names; unsure = photo', () => {
  const play = GOLD.plays[1]; // SF TD, team away, wallclock 21:43:21Z
  const at = Date.parse(play.wallclock);
  const opts = { teams: { home: { handles: ['dallascowboys'] }, away: { handles: ['49ers'] } }, neutralHandles: ['NFL'] };
  const clip = (lagSec, handle, text = '') => ({ url: `https://x.com/${handle}/status/${lagSec}`, handle, text, postedAt: new Date(at + lagSec * 1000).toISOString() });
  assert.equal(D.matchClipToPlay(clip(30, '49ers'), [play], opts), null, 'too soon after the snap');
  assert.equal(D.matchClipToPlay(clip(20 * 60, '49ers'), [play], opts), null, 'too late');
  // A league account, the right time, no name: still unsure (photo).
  assert.equal(D.matchClipToPlay(clip(11 * 60, 'NFL'), GOLD.plays, opts).sure, false);
  // Two plays inside the window and nothing to tell them apart: ambiguous.
  const twin = [{ ...play, id: 'x1' }, { ...play, id: 'x2', wallclock: new Date(at + 20e3).toISOString() }];
  const amb = D.matchClipToPlay(clip(200, '49ers'), twin, opts);
  assert.ok(amb.reasons.includes('ambiguous') && amb.sure === false);
  const own = D.matchClipToPlay(clip(180, '49ers', 'Deebo Samuel scores!'), GOLD.plays, opts);
  assert.deepEqual([own.playId, own.sure], [play.id, true]);
  assert.ok(own.reasons.includes('team-handle') && own.reasons.includes('name-in-post'));
  const other = D.matchClipToPlay(clip(180, 'dallascowboys'), [play], opts);
  assert.equal(other.sure, false, "the other team's account is not trusted for this play");
  // ...but the same post matches Dallas's own field goal 13 min earlier.
  assert.equal(D.matchClipToPlay(clip(180, 'dallascowboys'), GOLD.plays, opts).playId, GOLD.plays[0].id);
  const fan = D.matchClipToPlay(clip(180, 'randomfan'), GOLD.plays, opts);
  assert.equal(fan.sure, false, 'time alone is not enough');
  assert.equal(D.matchClipToPlay({ postedAt: 'nope' }, GOLD.plays, opts), null);
  // In a plan: a sure clip goes on the play beat; an unsure one leaves the photo.
  const plan = D.planFromGame(GOLD, { ...opts, clips: [clip(180, '49ers', 'Samuel!'), clip(200, 'randomfan')] });
  const beat = plan.beats.find(b => b.refs.includes(`play:${play.id}`));
  assert.equal(beat.visual, 'clip');
  assert.equal(beat.clip.url, 'https://x.com/49ers/status/180');
  const fg = plan.beats.find(b => b.refs.includes(`play:${GOLD.plays[0].id}`));
  assert.equal(fg.visual, 'photo');
});

await test('planFromArchive: moments cite stat rows, refs resolve, slides valid, numbers from the archive facts', () => {
  const plan = D.planFromArchive(ARCHIVE, ATHLETE, { angle: '5 best moments' });
  const v = T.validateTimeline(asTimeline(plan));
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.equal(plan.style, 'countdown');
  assert.deepEqual(plan.outputs, ['reel', 'carousel']);
  const moments = plan.beats.filter(b => b.kind === 'moment');
  assert.deepEqual(moments.map(b => b.text), ['2001: 2,843 yards', '2022: 4,694 yards']);
  moments.forEach(b => assert.ok(b.refs.some(r => /^(src|stat):/.test(r))));
  assert.ok(plan.beats.some(b => b.kind === 'stat' && b.refs.includes('stat:totals')));
  assert.equal(plan.slides[0].kind, 'cover');
  assert.equal(plan.slides.at(-1).kind, 'cta');
  assert.ok(plan.slides.length >= F.FORMATS.archive.carousel.slides.min && plan.slides.length <= F.FORMATS.archive.carousel.slides.max);
  assert.deepEqual(provenance(plan, D.archiveFacts(plan.data.archive, ATHLETE)), []);
  assert.equal(plan.data.archive.thin, true);
  assert.equal(D.angleCount('Top 3 playoff runs'), 3);
  assert.equal(D.angleCount('career in 60s'), 5);
});

await test('planFromReplay: the 3-frame strip and a carousel of <= 5 slides, refs resolve', () => {
  const plan = D.planFromReplay(REPLAY_TL.replay, { captions: { setup: 'Eyes on the ball', play: 'The grab', reaction: 'Bench erupts' }, title: 'The catch, in three frames' });
  const v = T.validateTimeline(asTimeline(plan));
  assert.ok(v.ok, JSON.stringify(v.errors));
  const panel = plan.beats.find(b => b.kind === 'panel3');
  assert.deepEqual(panel.refs, ['frame:setup', 'frame:play', 'frame:reaction']);
  assert.deepEqual(panel.frames.map(f => f.caption), ['Eyes on the ball', 'The grab', 'Bench erupts']);
  assert.ok(plan.slides.length <= 5);
  assert.deepEqual(plan.slides.map(s => s.kind), ['cover', 'panel', 'panel', 'panel', 'cta']);
  const withGame = D.planFromReplay(REPLAY_TL.replay, { game: GOLD, playId: GOLD.plays[1].id });
  assert.ok(T.validateTimeline(asTimeline(withGame)).ok);
});

// ─── Director ─────────────────────────────────────────────────────────────
const real = { aiText: gateway.aiText, gatewayConfigured: gateway.gatewayConfigured };
function stubAi(reply) {
  const calls = [];
  gateway.gatewayConfigured = () => true;
  gateway.aiText = async opts => { calls.push(opts); if (reply instanceof Error) throw reply; return { text: typeof reply === 'function' ? reply(opts) : JSON.stringify(reply), model: 'anthropic/claude-haiku-5.5', cost: 0.0019 }; };
  return calls;
}
const restore = () => { Object.assign(gateway, real); DIR.DATA_CACHE.clear(); };

await test('director: AI off or blocked -> the code plan, free; refs resolve', async () => {
  try {
    gateway.gatewayConfigured = () => false;
    const input = DIR.readDataInput({ format: 'gameswing', digest: FULL });
    assert.ok(DIR.hasDataInput(input));
    const out = await DIR.runDataDirector(input, {});
    assert.deepEqual([out.source, out.reason, out.cost, out.refsOk], ['data', 'off', 0, true]);
    const calls = stubAi({ beats: [] });
    const blocked = await DIR.runDataDirector(input, { blocked: 'weekly-limit' });
    assert.deepEqual([blocked.reason, calls.length], ['weekly-limit', 0]);
  } finally { restore(); }
});

await test('director: the AI rewrites words only; invented numbers, kind or ref changes are refused', async () => {
  try {
    const input = DIR.readDataInput({ format: 'gameswing', digest: FULL });
    const code = DIR.codeDataPlan(input);
    const calls = stubAi(() => JSON.stringify({
      title: 'Niners hold off Dallas',
      beats: code.beats.map((b, i) => ({ id: b.id, kind: 'stat', refs: ['play:fake'], text: i === 0 ? 'Niners survive a wild finish' : (i === 1 ? 'Pickens breaks free for 777' : `${b.text} again`), vo: 'Some words here' })),
      hooks: ['A 46-40 shootout', 'Up by 1000'],
    }));
    const out = await DIR.runDataDirector(input, {});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tier, 'main', 'Haiku tier');
    assert.equal(calls[0].track, undefined);
    assert.equal(out.source, 'director');
    assert.equal(out.plan.beats[0].text, 'Niners survive a wild finish');
    assert.equal(out.plan.beats[1].text, code.beats[1].text, 'the line with an invented number keeps the code text');
    assert.ok(out.issues.some(i => /777/.test(i)));
    out.plan.beats.forEach((b, i) => { assert.equal(b.kind, code.beats[i].kind); assert.deepEqual(b.refs, code.beats[i].refs); assert.equal(b.vo, '', 'voice off: no VO'); });
    assert.deepEqual(out.plan.hooks, ['A 46-40 shootout']);
    assert.ok(T.validateTimeline(asTimeline(out.plan)).ok);
    assert.deepEqual(provenance(out.plan, out.corpus), []);
    assert.equal(out.cost, 0.0019);
    const again = await DIR.runDataDirector(input, {});
    assert.deepEqual([again.cached, again.cost, calls.length], [true, 0, 1], 'cached 45 min');
  } finally { restore(); }
});

await test('director: a failed or budget-capped AI call still returns the code plan', async () => {
  try {
    const input = DIR.readDataInput({ format: 'replay', replay: REPLAY_TL.replay, captions: { setup: 'a', play: 'b', reaction: 'c' } });
    stubAi(new Error('boom'));
    const out = await DIR.runDataDirector(input, {});
    assert.deepEqual([out.source, out.reason], ['data', 'error']);
    assert.ok(out.plan.beats.some(b => b.kind === 'panel3'));
  } finally { restore(); }
});

await test('director input: a tampered digest is refused; archive moments re-verified on the server', () => {
  const bad = JSON.parse(JSON.stringify(GOLD));
  bad.teams.home.logo = 'https://a.espncdn.com/i/teamlogos/nfl/500/dal.png';
  assert.equal(DIR.readDataInput({ format: 'gameswing', digest: bad }).digest, null);
  assert.equal(DIR.hasDataInput(DIR.readDataInput({ format: 'gameswing', digest: bad })), false);
  // A server-cached digest for the same game wins over the one sent.
  const cached = DIR.readDataInput({ format: 'gameswing', digest: GOLD }, { cachedDigest: () => FULL });
  assert.equal(cached.digest, FULL);
  const archive = { ...ARCHIVE, candidates: [...ARCHIVE.candidates, { id: 'm9', year: 2007, title: '2007 season', line: '50 TD', cite: ['stat:s2007'] }, { id: 'm8', year: 2001, title: 'Invented', line: '9,999 yards', cite: ['stat:s2001'] }] };
  const input = DIR.readDataInput({ format: 'archive', archive, athlete: ATHLETE });
  assert.deepEqual(input.archive.candidates.map(c => c.id), ['m1', 'm2']);
  const noAthlete = DIR.readDataInput({ format: 'archive', archive: ARCHIVE });
  assert.equal(noAthlete.archive.candidates.length, 0, 'stat cites need the stat rows they cite');
});

await test('reel-maker plan hand-off: a data format with its data plans from the data (AI off), lint backed by the facts', async () => {
  delete process.env.AI_GATEWAY_API_KEY;
  const { _test } = require('../netlify/functions/reel-maker.js');
  const g = await _test.plan({ format: 'gameswing', digest: FULL }, { email: 'e' }, { off: true });
  assert.deepEqual([g.ok, g.source, g.reason, g.style, g.cost], [true, 'data', 'off', 'series', 0]);
  assert.ok(g.corpus.includes('Win probability: ESPN Analytics'));
  assert.equal((g.lint.issues || []).filter(i => i.id === 'numbers').length, 0, 'no unsourced-number lint');
  const a = await _test.plan({ format: 'archive', archive: ARCHIVE, athlete: ATHLETE }, { email: 'e' }, { weekly: true });
  assert.equal(a.plan.format, 'archive');
  assert.match(a.notice, /built from the data/);
  // A data format with no data still takes the brief path.
  const brief = await _test.plan({ format: 'gameswing', brief: 'The 49ers beat the Cowboys 46-40.', sport: 'nfl' }, { email: 'e' }, { off: true });
  assert.equal(brief.source, 'draft');
});

console.log(`\n${passed} passed`);
