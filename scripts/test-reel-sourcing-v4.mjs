#!/usr/bin/env node
// Reels v4 sourcing (lane SOURCING): v4 chapter plans, per-beat media kinds
// (clip / presser / photo / cutout / cards / none), the retry ladder, the
// confirmed-clip library, the judge's best segment, the motion rule
// (motionOk / clipCount / needsClips), press-conference sources, older
// moments, the clip proxy, the judge-failure text gate, nextCandidate / rank
// in the browser, and a mocked measurement over the 6 reference reels.
// Every network and AI call is mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.AI_GATEWAY_API_KEY = 'gw-test';
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const C = require('../reel-clips.js');
const SRC = require('../netlify/functions/_reel-sourcing.js');
const LIB = require('../netlify/functions/_reel-clip-confirmed.js');
const judge = require('../netlify/functions/_reel-clip-judge.js');
const RS = require('../reel-sourcing.js');
const ADS = require('../netlify/functions/video-ads.js');
const TRUST = require('../netlify/functions/_clip-trust.js');

let passed = 0;
const quiet = process.argv.includes('--quiet');
async function test(name, fn) {
  try { await fn(); passed += 1; if (!quiet) console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}

// ─── Fixtures ────────────────────────────────────────────────────────────
const clip = (id, text, extra = {}) => ({ url: `https://x.com/${extra.handle || 'NFL'}/status/${id}`, handle: 'NFL', text, source: 'league', ageHours: 10, durationMs: 9000, shortSide: 720, teams: [], variants: [{ url: `https://video.twimg.com/${id}.mp4`, width: 720, height: 1280 }], ...extra });
const photo = (name, extra = {}) => ({ url: `/api/es-image-search?image=${name}`, sourceUrl: `https://image-cdn.essentiallysports.com/${name}.jpg`, title: name, verified: true, focus: { x: 0.3, y: 0.1, w: 0.4, h: 0.6 }, focal: { x: 0.5, y: 0.22 }, ...extra });
const J = (rels, extra = {}) => C.validateJudgement({ kind: 'game-action', quality: 8, action: [3, 9, 4], relevance: rels, ...extra }, 3);

// The Ravens "perfect cover" reel (reference 6) as a v4 plan.
const RAVENS = {
  v: 4, esStyle: 'hotseat', skin: 'clean', title: 'The perfect cover', sport: 'nfl', team: { name: 'Baltimore Ravens' },
  chapters: [
    { id: 'c1', headline: 'THE *PERFECT* COVER', beats: [
      { id: 'h1', vo: 'Lamar keeps winning', media: { kind: 'clip', subject: { type: 'player', name: 'Lamar Jackson', team: 'Baltimore Ravens', moment: 'touchdown run' } } },
      { id: 'h2', vo: 'DeCosta says the roster is fine', media: { kind: 'presser', subject: { type: 'person', name: 'Eric DeCosta', team: 'Baltimore Ravens' } } },
    ] },
    { id: 'c2', headline: '82-38 SINCE 2019', beats: [
      { id: 'd1', vo: '82 and 38', module: { type: 'statTiles', tiles: [{ value: '82-38' }] }, media: { kind: 'none' } },
      { id: 'd2', vo: 'Linderbaum and Crosby', media: { kind: 'cards', cards: [{ name: 'Tyler Linderbaum', tag: 'C' }, { name: 'Maxx Crosby', tag: 'EDGE', sticker: 'OUT' }] } },
      { id: 'd3', vo: 'Lamar on the cover', media: { kind: 'cutout', subject: { type: 'player', name: 'Lamar Jackson', team: 'Baltimore Ravens' } } },
      { id: 'd4', vo: 'what now', media: { kind: 'photo', subject: { type: 'player', name: 'Nobody Known', team: 'Baltimore Ravens' } } },
    ] },
  ],
  close: { kind: 'yourCall', prompt: 'RAVENS FANS: YOUR CALL' },
};
const LAMAR_TD = clip('lamar-td', 'Lamar Jackson touchdown run! 🔥', { handle: 'Ravens', source: 'official', teams: ['Baltimore Ravens'] });
const LAMAR_2 = clip('lamar-2', 'Lamar Jackson highlights vs Bengals', { handle: 'Ravens', source: 'official', teams: ['Baltimore Ravens'] });
const RAVENS_GEN = clip('ravens-gen', 'Ravens win at home', { handle: 'Ravens', source: 'official', teams: ['Baltimore Ravens'] });
const DECOSTA_PC = clip('decosta-pc', 'Eric DeCosta press conference: we believe in this roster', { handle: 'Ravens', source: 'official', teams: ['Baltimore Ravens'] });

function deps({ calls = {}, byQuery = {}, byTeam = {}, photosBy = {}, confirmedRows = [], cost = 0.03, ignoreQuery = false } = {}) {
  calls.find = []; calls.photos = [];
  return {
    teams: require('../video-ads-teams.js'),
    judgeCache: new Map(),
    log: line => { calls.log = line; },
    gateway: { gatewayConfigured: () => true, featureDisabled: () => false, aiText: async () => ({ text: '{}', cost: 0 }) },
    confirmed: { keysFor: LIB.keysFor, read: async keys => confirmedRows.filter(r => keys.includes(r.key)) },
    findClips: async (body, track) => {
      calls.find.push({ subject: body.subject.name, query: body.query || '', team: body.team || '', kind: body.kind || '', windowHours: body.windowHours || 0, freeOnly: Boolean(track.freeOnly), deadlineAt: track.deadlineAt });
      const list = !ignoreQuery && body.query ? (byQuery[body.query] || []) : (byTeam[body.team || body.subject.team || body.subject.name] || []);
      return { ok: true, clips: list, cost: track.freeOnly ? 0 : cost };
    },
    findPhotos: async args => { calls.photos.push(args.person || args.team || args.query); return { ok: true, photos: photosBy[args.person || args.team || args.query] || [], cost: 0 }; },
    verifyWithVision: async () => ({ verdicts: new Map(), cost: 0 }),
  };
}

// ─── reel-clips (pure) ───────────────────────────────────────────────────
await test('beatsOf: v4 chapters flatten in order with chapter ids; missing ids get c<i>b<j>; v3 beats unchanged', () => {
  const flat = C.beatsOf(RAVENS);
  assert.deepEqual(flat.map(b => b.id), ['h1', 'h2', 'd1', 'd2', 'd3', 'd4']);
  assert.equal(flat[2].chapterId, 'c2');
  assert.deepEqual(C.beatsOf({ chapters: [{ beats: [{ vo: 'a' }, { vo: 'b' }] }] }).map(b => b.id), ['c1b1', 'c1b2']);
  assert.deepEqual(C.beatsOf({ beats: [{ id: 'x' }, {}] }).map(b => b.id), ['x', 'b2']);
  assert.equal(C.subjectOfBeat(flat[1], RAVENS).type, 'person', 'media.subject is read, person kept');
});

await test('ladder: player+moment -> player+game -> team+game -> team; pressers; a named older moment widens the window', () => {
  const now = Date.UTC(2026, 10, 27);
  const kittle = C.ladderFor({ type: 'player', name: 'George Kittle', team: 'San Francisco 49ers', moment: 'Achilles injury' }, 'clip', { now });
  assert.deepEqual(kittle.map(r => r.rung), ['player+moment', 'player+game', 'team+game', 'team']);
  assert.equal(kittle[0].body.query, 'George Kittle Achilles injury');
  assert.deepEqual(kittle[3].body, { team: 'San Francisco 49ers' });
  const team = C.ladderFor({ type: 'team', name: 'Dallas Cowboys', team: 'Dallas Cowboys' }, 'clip', { now });
  assert.deepEqual(team.map(r => r.rung), ['team']);
  const pc = C.ladderFor({ type: 'person', name: 'Eric DeCosta', team: 'Baltimore Ravens' }, 'presser', { now });
  assert.deepEqual(pc.map(r => r.body.query), ['Eric DeCosta press conference', 'Eric DeCosta interview', 'Baltimore Ravens press conference']);
  assert.ok(pc.every(r => r.body.kind === 'presser'));
  const old = C.ladderFor({ type: 'player', name: 'Dak Prescott', team: 'Dallas Cowboys', date: '2026-10-05', moment: '21-point lead' }, 'clip', { now });
  assert.ok(old[0].body.windowHours > 24 * 50 && old[0].body.windowHours < 24 * 60, 'about 53 days back + 3 days');
  assert.equal(C.olderWindowHours({ moment: 'last night' }, now), null);
  assert.equal(C.olderWindowHours({ moment: '2011 season' }, now), 365 * 24, 'capped at a year');
});

await test('gate (v4): presser beats need press-conference footage; game beats refuse it; presser text gate', () => {
  const sub = { key: 'eric decosta', name: 'Eric DeCosta', type: 'person', team: 'Baltimore Ravens' };
  const pcJ = J({ 'eric decosta': 9 }, { kind: 'press-conference' });
  assert.equal(C.passesGate(pcJ, sub, C.GATE, 'presser'), true);
  assert.equal(C.passesGate(pcJ, sub, C.GATE, 'clip'), false, 'a podium shot is not a game moment');
  assert.equal(C.passesGate(J({ 'eric decosta': 9 }), sub, C.GATE, 'presser'), false, 'game action is not a presser');
  assert.equal(C.textGate(DECOSTA_PC, sub, 'presser'), true);
  assert.equal(C.textGate(DECOSTA_PC, sub, 'clip'), false);
  assert.equal(C.textGate(LAMAR_TD, { key: 'lamar jackson', name: 'Lamar Jackson', type: 'player' }, 'clip'), true);
});

await test('Ken Burns: from a wide crop to the focus box (normalized, inside the photo); no focus -> a centre push', () => {
  const kb = C.kenBurnsFor(photo('x'));
  const inside = r => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001;
  assert.ok(inside(kb.from) && inside(kb.to) && inside(kb.focus));
  assert.ok(kb.to.w < kb.from.w && kb.to.h <= kb.from.h, 'pushes in');
  assert.ok(kb.to.x <= kb.focus.x && kb.to.x + kb.to.w >= kb.focus.x + kb.focus.w, 'the end frame keeps the whole focus box');
  assert.equal(kb.ease, 'inOut');
  const none = C.kenBurnsFor({});
  assert.equal(none.hasFocus, false);
  assert.ok(inside(none.to));
});

await test('judge segment: the window around the frame with the most action; a clip shorter than the beat is flagged short', () => {
  assert.deepEqual(C.judgeSegment([2, 9, 3], [1, 5, 9], 12, 4), { start: 3, end: 7 });
  assert.deepEqual(C.judgeSegment([9, 1, 1], [0.5, 5, 9], 12, 4), { start: 0.4, end: 4.4 }, 'never before the 0.4 s intro');
  assert.deepEqual(C.judgeSegment([1], [1], 3, 5), { start: 0, end: 3, short: true });
  const seg = C.segmentOut({ inSec: 1, outSec: 2 }, 4);
  assert.deepEqual([seg.start, seg.end, seg.inSec, seg.outSec, seg.short], [1, 2, 1, 2, true]);
  const v = C.validateJudgement({ kind: 'game-action', segment: { start: 2, end: 6 } });
  assert.deepEqual(v.segment, { start: 2, end: 6 });
  assert.equal(C.validateJudgement({ segment: { start: 5, end: 2 } }).segment, undefined, 'a backwards segment is dropped');
});

await test('gatedPicks (v4): confirmed library passes free; judge failure -> strict text gate; cards; cutout; team photo; failures named', () => {
  const lamar = C.subjectOfBeat(RAVENS.chapters[0].beats[0], RAVENS);
  const confirmed = { ...LAMAR_2, confirmed: { relevance: 9, moment: 7, segment: { start: 2, end: 5 }, rank: 2, kind: 'clip' } };
  const scenes = [
    { beatId: 'a', beat: RAVENS.chapters[0].beats[0], subject: lamar, wants: 'clip', clips: [confirmed], photos: [], durMs: 3000 },
    { beatId: 'b', beat: { media: { kind: 'clip' } }, subject: lamar, wants: 'clip', clips: [LAMAR_TD], photos: [], durMs: 3000 },
    { beatId: 'c', beat: RAVENS.chapters[1].beats[1], subject: { key: 'x', name: 'x', type: 'player' }, wants: 'photo', kind: 'cards', clips: [], photos: [], cards: [{ name: 'Tyler Linderbaum', photos: [photo('linderbaum')] }, { name: 'Maxx Crosby', photos: [] }] },
    { beatId: 'd', beat: RAVENS.chapters[1].beats[2], subject: lamar, wants: 'photo', kind: 'cutout', clips: [], photos: [photo('lamar')] },
    { beatId: 'e', beat: RAVENS.chapters[1].beats[3], subject: { key: 'nobody known', name: 'Nobody Known', type: 'player', team: 'Baltimore Ravens' }, wants: 'photo', kind: 'photo', clips: [], photos: [], teamPhotos: [photo('ravens-team')] },
  ];
  // The judge is up but failed: LAMAR_TD is unjudged and may pass the text gate.
  const picks = C.gatedPicks(scenes, { judgements: {}, judgeAvailable: true, judgeFailed: true });
  assert.equal(picks.a.kind, 'clip');
  assert.equal(picks.a.gate, 'library');
  assert.deepEqual([picks.a.segment.start, picks.a.segment.end], [2, 5], "the library's segment without samples");
  assert.equal(picks.b.kind, 'clip');
  assert.equal(picks.b.gate, 'text');
  assert.equal(picks.c.kind, 'cards');
  assert.equal(picks.c.cards.length, 2);
  assert.ok(picks.c.cards[0].photo && picks.c.cards[0].kenBurns && !picks.c.cards[1].photo);
  assert.equal(picks.d.kind, 'cutout');
  assert.equal(picks.d.cutout, true);
  assert.equal(picks.e.kind, 'photo');
  assert.match(picks.e.why, /team photo/);
  assert.deepEqual(picks.e.failures, ['no-photo']);
  // Judge up and fine but nothing judged: unjudged clips wait (judge-unavailable reason).
  const wait = C.gatedPicks([scenes[1]], { judgements: {}, judgeAvailable: true });
  assert.equal(wait.b.kind, 'none');
  assert.deepEqual(wait.b.failures, ['judge-unavailable']);
  // Judged and refused.
  const no = C.gatedPicks([scenes[1]], { judgements: { [LAMAR_TD.url]: J({ 'lamar jackson': 3 }) }, judgeAvailable: true });
  assert.deepEqual(no.b.failures, ['judge-rejected']);
});

await test('motion rule: clip / Ken Burns / module per beat; clipCount 0 -> needsClips + a Find clips action; static beats named', () => {
  const picks = {
    h1: { kind: 'clip', clip: LAMAR_TD },
    h2: { kind: 'none' },
    d1: { kind: 'none' },
    d2: { kind: 'cards', cards: [{ name: 'A', photo: photo('a') }] },
    d3: { kind: 'cutout', photo: photo('l') },
    d4: { kind: 'none' },
  };
  const s = C.motionSummary(RAVENS, picks);
  assert.equal(s.clipCount, 1);
  assert.equal(s.needsClips, false);
  assert.equal(s.motionOk, false);
  assert.deepEqual(Object.fromEntries(Object.entries(s.beats).map(([k, v]) => [k, v.motion])), { h1: 'clip', h2: 'none', d1: 'module', d2: 'kenburns', d3: 'kenburns', d4: 'none' });
  assert.deepEqual(s.actions.map(a => a.beatId), ['h2', 'd4']);
  const none = C.motionSummary(RAVENS, { ...picks, h1: { kind: 'photo', photo: photo('x') } });
  assert.equal(none.needsClips, true);
  assert.equal(none.actions[0].action, 'find-clips');
  assert.ok(none.actions[0].beatIds.includes('h1') && none.actions[0].beatIds.includes('h2'));
  const st = C.sourcingStats(RAVENS, { ...picks, h1: { ...picks.h1, rung: 'player+moment', gate: 'judge' }, d4: { kind: 'none', failures: ['no-photo'] } });
  assert.deepEqual([st.clip, st.photo, st.module, st.none], [1, 2, 1, 2]);
  assert.equal(st.failures['no-photo'], 1);
  assert.equal(st.rungs['player+moment'], 1);
});

await test('sampleClip: a frame that fails to draw keeps its time slot (motion never shifts onto another time)', async () => {
  let draws = 0;
  const ctx = {
    drawImage() { draws += 1; if (draws === 3) throw new Error('decode'); },
    getImageData() { const d = new Uint8ClampedArray(48 * 27 * 4); d.fill(draws * 40); return { data: d }; },
  };
  const doc = { createElement: () => ({ getContext: () => ctx, toDataURL: () => 'data:image/jpeg;base64,AAAA' }) };
  const listeners = {};
  const video = { duration: 4, videoWidth: 16, videoHeight: 9, addEventListener: (e, fn) => { listeners[e] = fn; }, set currentTime(t) { setTimeout(() => listeners.seeked && listeners.seeked(), 0); } };
  const out = await C.sampleClip(video, { count: 4, judgeFrames: 1, doc });
  assert.equal(out.samples.length, 4);
  assert.equal(out.samples[1].motion, 0.5, 'the failed sample keeps 0.5 at its own time');
});

// ─── find-clips (video-ads.js) ───────────────────────────────────────────
await test('find-clips: presser searches keep trusted press conferences only; game searches still drop them; older moments skip the window', () => {
  const now = Date.now();
  const post = (text, extra = {}) => ({ ok: true, url: 'https://x.com/Ravens/status/1', handle: 'Ravens', text, postedAt: new Date(now - 30 * 3600e3).toISOString(), durationMs: 20000, variants: [{ url: 'https://video.twimg.com/a.mp4', width: 720, height: 1280 }], ...extra });
  const pc = post('Eric DeCosta press conference');
  assert.equal(ADS._test.assessClip(pc, { sport: 'nfl', now }).reason, 'notGame');
  assert.ok(ADS._test.assessClip(pc, { sport: 'nfl', now, presser: true }).clip);
  assert.equal(ADS._test.assessClip(post('Lamar Jackson touchdown run'), { sport: 'nfl', now, presser: true }).reason, 'notPresser');
  assert.equal(ADS._test.assessClip(post('DeCosta press conference', { handle: 'some_fan', url: 'https://x.com/some_fan/status/2' }), { sport: 'nfl', now, presser: true }).reason, 'untrusted');
  // A presser-only source counts only for pressers.
  assert.equal(TRUST.isTrusted({ platform: 'x', handle: 'PatMcAfeeShow' }), false);
  assert.equal(TRUST.isTrusted({ platform: 'x', handle: 'PatMcAfeeShow', purpose: 'presser' }), true);
  const show = post('Lamar Jackson interview on the show', { handle: 'PatMcAfeeShow', url: 'https://x.com/PatMcAfeeShow/status/3' });
  const kept = ADS._test.assessClip(show, { sport: 'nfl', now, presser: true });
  assert.ok(kept.clip && kept.clip.source === 'media');
  // Older moment: 50 days old is too old normally, fine with the widened window; a year in the text is no throwback then.
  const old = post('Dak Prescott 2024 comeback highlights', { handle: 'dallascowboys', url: 'https://x.com/dallascowboys/status/4', postedAt: new Date(now - 50 * 24 * 3600e3).toISOString() });
  assert.equal(ADS._test.assessClip(old, { sport: 'nfl', now }).reason, 'tooOld');
  assert.ok(ADS._test.assessClip(old, { sport: 'nfl', now, windowHours: 60 * 24 }).clip);
  const plan = ADS._test.searchPlan({ sport: 'nfl', query: 'Eric DeCosta press conference', presser: true, olderHours: 24 * 40 });
  assert.equal(plan.presser, true);
  assert.equal(plan.windowHours, 24 * 40);
  assert.match(ADS._test.webPrompt(plan, { since: '2026-10-01 00:00' }), /press conference or interview/);
});

// ─── scene-media (server) ────────────────────────────────────────────────
await test('scene-media (v4 plan): the ladder stops when a rung names the subject twice; pressers walk their own ladder; deadline passed down', async () => {
  const calls = {};
  const d = deps({
    calls,
    byQuery: { 'Lamar Jackson touchdown run': [LAMAR_TD, LAMAR_2, RAVENS_GEN], 'Eric DeCosta press conference': [DECOSTA_PC] },
    byTeam: { 'Baltimore Ravens': [RAVENS_GEN] },
    photosBy: { 'Lamar Jackson': [photo('lamar')], 'Tyler Linderbaum': [photo('linderbaum')], 'Maxx Crosby': [photo('crosby')], 'Baltimore Ravens': [photo('ravens')] },
  });
  const res = await SRC.sceneMedia({ plan: RAVENS }, { deps: d, aiAllowed: true, track: { email: 'e', token: 't' } });
  assert.equal(res.ok, true);
  assert.equal(res.esStyle, 'hotseat');
  assert.deepEqual(res.beats.map(b => b.beatId), ['h1', 'h2', 'd1', 'd2', 'd3', 'd4']);
  assert.deepEqual(res.beats.map(b => b.wants), ['clip', 'presser', 'none', 'photo', 'photo', 'photo']);
  const lamarCalls = calls.find.filter(c => c.subject === 'Lamar Jackson');
  assert.deepEqual(lamarCalls.map(c => c.query), ['Lamar Jackson touchdown run'], 'two clips name him on the first rung: stop');
  const pcCalls = calls.find.filter(c => c.subject === 'Eric DeCosta');
  assert.equal(pcCalls[0].kind, 'presser');
  assert.ok(calls.find.every(c => c.deadlineAt > Date.now()), 'every find-clips call knows the deadline');
  assert.equal(res.beats[0].clips[0].rung, 'player+moment');
  assert.ok(res.beats[0].clips.every(c => c.subjectHit || c.url === RAVENS_GEN.url));
  // No judgements yet: clips wait for the judge; the judge queue lists them.
  assert.ok(res.judgeQueue.some(q => q.url === LAMAR_TD.url) && res.judgeQueue.some(q => q.url === DECOSTA_PC.url));
  assert.equal(res.beats[2].motion, 'module');
  assert.equal(res.beats[3].pick.kind, 'cards');
  assert.equal(res.beats[3].pick.cards.filter(c => c.photo).length, 2);
  assert.equal(res.beats[4].pick.kind, 'cutout');
  assert.equal(res.beats[5].pick.kind, 'photo', 'no photo of the subject: the team photo, with Ken Burns');
  assert.ok(res.beats[5].pick.kenBurns);
  assert.equal(res.subjects.find(s => s.key === 'eric decosta').wants, 'presser');
  assert.match(calls.log, /^reels-sourcing \{/);
  assert.ok(typeof res.stats.shares.clip === 'number');
});

await test('scene-media: judgements in -> clip + presser picked with the judge segment; clipCount 1, needsClips false', async () => {
  const d = deps({ byQuery: { 'Lamar Jackson touchdown run': [LAMAR_TD, LAMAR_2], 'Eric DeCosta press conference': [DECOSTA_PC] }, photosBy: {} });
  const judgements = {
    [LAMAR_TD.url]: { kind: 'game-action', quality: 8, action: [2, 9, 3], relevance: { 'lamar jackson': 9 }, moment: { 'lamar jackson': 8 }, segment: { start: 1.5, end: 4.5 } },
    [DECOSTA_PC.url]: { kind: 'press-conference', quality: 7, action: [2, 2, 2], relevance: { 'eric decosta': 9 } },
  };
  const res = await SRC.sceneMedia({ plan: RAVENS, judgements }, { deps: d, aiAllowed: true });
  assert.equal(res.beats[0].pick.kind, 'clip');
  assert.deepEqual([res.beats[0].pick.segment.start, res.beats[0].pick.segment.end], [1.5, 4.5]);
  assert.equal(res.beats[1].pick.kind, 'presser');
  assert.equal(res.clipCount, 2);
  assert.equal(res.needsClips, false);
});

await test('scene-media: the confirmed library answers first (no search, no judge queue entry); live searches stay <= 2', async () => {
  const calls = {};
  const rows = [LAMAR_TD, LAMAR_2].map(c => ({ key: 'player:lamar jackson', url: c.url, kind: 'clip', clip: c, relevance: 9, moment: 8, segment: { start: 1, end: 4 }, rank: 1 }));
  const res = await SRC.sceneMedia({ plan: RAVENS }, { deps: deps({ calls, confirmedRows: rows }), aiAllowed: true });
  assert.equal(calls.find.filter(c => c.subject === 'Lamar Jackson').length, 0);
  assert.equal(res.beats[0].pick.kind, 'clip');
  assert.equal(res.beats[0].pick.gate, 'library');
  assert.ok(!res.judgeQueue.some(q => q.url === LAMAR_TD.url));
  assert.ok(calls.find.filter(c => !c.freeOnly).length <= 2);
});

await test('scene-media: a sport without clip sources -> no-sport reason, photos with Ken Burns still move the beats', async () => {
  const plan = { ...RAVENS, sport: 'golf' };
  const res = await SRC.sceneMedia({ plan }, { deps: deps({ photosBy: { 'Lamar Jackson': [photo('l')] } }), aiAllowed: true });
  assert.deepEqual(res.beats[0].failures, ['no-sport']);
  assert.equal(res.beats[0].motion, 'kenburns');
  assert.equal(res.needsClips, true);
});

await test('scene-media: a deadline that has run out stops the ladder (reason deadline), the call still answers', async () => {
  let t = Date.now();
  const d = { ...deps({}), now: () => t };
  const findClips = d.findClips;
  d.findClips = async (b, tr) => { t += 50000; return findClips(b, tr); };
  const res = await SRC.sceneMedia({ plan: RAVENS }, { deps: d, aiAllowed: true, budgetMs: 44000 });
  assert.equal(res.ok, true);
  assert.ok(res.beats[0].ladder.some(r => r.error === 'deadline'));
});

// ─── confirmed-clip library ─────────────────────────────────────────────
await test('confirmed library: keys per subject; confirm (relevance >= 7 only) -> read; rank down below -3 hides it', async () => {
  LIB._reset();
  assert.deepEqual(LIB.keysFor({ type: 'player', name: 'Lamar Jackson', team: 'Baltimore Ravens', date: '2026-11-23' }), ['player:lamar jackson', 'game:baltimore ravens|2026-11-23', 'team:baltimore ravens']);
  assert.deepEqual(LIB.keysFor({ type: 'person', name: 'Eric DeCosta', team: 'Baltimore Ravens' }), ['person:eric decosta', 'team:baltimore ravens']);
  const w = await LIB.confirm([
    { key: 'player:lamar jackson', url: LAMAR_TD.url, kind: 'clip', clip: LAMAR_TD, relevance: 9, segment: { start: 1, end: 4 } },
    { key: 'player:lamar jackson', url: RAVENS_GEN.url, kind: 'clip', clip: RAVENS_GEN, relevance: 5 },
  ]);
  assert.equal(w.written, 1, 'relevance under 7 is never stored');
  const rows = await LIB.read(['player:lamar jackson'], { kind: 'clip' });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].segment, { start: 1, end: 4 });
  assert.equal((await LIB.read(['player:lamar jackson'], { kind: 'presser' })).length, 0);
  for (let i = 0; i < 3; i += 1) await LIB.rank(LAMAR_TD.url, ['player:lamar jackson'], -1);
  assert.equal((await LIB.read(['player:lamar jackson'])).length, 0, 'swapped out three times: no longer offered');
  await LIB.rank(LAMAR_TD.url, [], +1);
  assert.equal((await LIB.read(['player:lamar jackson']))[0].rank, -2);
});

await test('confirmed library: with the service key it upserts on (key,url) without rank; a missing table falls back to memory', async () => {
  LIB._reset();
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'pk';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url: String(url), init }); return new Response(JSON.stringify({ code: 'PGRST205', message: 'relation does not exist' }), { status: 404, headers: { 'Content-Type': 'application/json' } }); };
  try {
    const w = await LIB.confirm([{ key: 'player:lamar jackson', url: LAMAR_TD.url, clip: LAMAR_TD, relevance: 9 }], { fetchImpl });
    assert.equal(w.remote, false);
    assert.match(sent[0].url, /frameup_reel_clip_confirmed\?on_conflict=key,url/);
    const body = JSON.parse(sent[0].init.body);
    assert.ok(!('rank' in body[0]) && !('kept' in body[0]), 'an upsert never resets the rank');
    assert.equal((await LIB.read(['player:lamar jackson'], { fetchImpl })).length, 1, 'memory still answers');
  } finally { delete process.env.SUPABASE_SERVICE_ROLE_KEY; LIB._reset(); }
});

await test('confirmJudged: only gate-passing, trusted clips on trusted media hosts are stored, per subject key, with the judge segment', async () => {
  const stored = [];
  const store = { keysFor: LIB.keysFor, confirm: async e => { stored.push(...e); return { written: e.length }; } };
  const meta = c => ({ handle: c.handle, text: c.text, platform: 'x', variants: c.variants, durationMs: c.durationMs });
  const fan = clip('fan', 'Lamar Jackson touchdown run', { handle: 'some_fan', url: 'https://x.com/some_fan/status/9' });
  const evil = { ...LAMAR_2, variants: [{ url: 'https://evil.example/x.mp4' }] };
  await SRC.confirmJudged({
    clips: [LAMAR_TD, fan, evil, RAVENS_GEN].map(c => ({ url: c.url, handle: c.handle, meta: meta(c) })),
    subjects: [{ key: 'lamar jackson', label: 'Lamar Jackson', type: 'player', team: 'Baltimore Ravens', wants: 'clip' }],
    judgements: Object.fromEntries([LAMAR_TD, fan, evil, RAVENS_GEN].map(c => [c.url, { ...J({ 'lamar jackson': c === RAVENS_GEN ? 4 : 9 }), segment: { start: 1, end: 3 } }])),
    sport: 'nfl',
  }, { deps: { confirmed: store, trust: TRUST } });
  assert.deepEqual([...new Set(stored.map(e => e.url))], [LAMAR_TD.url]);
  assert.deepEqual(stored.map(e => e.key), ['player:lamar jackson', 'team:baltimore ravens']);
  assert.deepEqual(stored[0].segment, { start: 1, end: 3 });
});

// ─── judge ──────────────────────────────────────────────────────────────
await test('clip judge (v4): every judgement carries a best segment (the model\'s, or around the most action); short clips flagged', async () => {
  judge.CACHE.clear();
  const frame = 'data:image/jpeg;base64,AAAA';
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ clips: [
    { i: 0, kind: 'game-action', quality: 8, action: [2, 9, 3], relevance: { 'lamar jackson': 9 }, segment: { start: 2, end: 5 } },
    { i: 1, kind: 'game-action', quality: 8, action: [9, 2, 2], relevance: { 'lamar jackson': 8 } },
    { i: 2, kind: 'game-action', quality: 8, action: [5], relevance: { 'lamar jackson': 8 } },
  ] }) } }], usage: { prompt_tokens: 3000, completion_tokens: 300 } }), { status: 200 });
  const out = await judge.judgeClips({
    clips: [
      { url: LAMAR_TD.url, frames: [frame, frame, frame], times: [1, 4, 7], durationMs: 9000, wantMs: 3000 },
      { url: LAMAR_2.url, frames: [frame, frame, frame], times: [1, 4, 7], durationMs: 9000, wantMs: 3000 },
      { url: RAVENS_GEN.url, frames: [frame], times: [1], durationMs: 2000, wantMs: 3000 },
    ],
    subjects: [{ key: 'lamar jackson', label: 'Lamar Jackson' }], fetchImpl,
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.judgements[LAMAR_TD.url].segment, { start: 2, end: 5 });
  assert.deepEqual(out.judgements[LAMAR_2.url].segment, { start: 0.4, end: 3.4 });
  assert.deepEqual(out.judgements[RAVENS_GEN.url].segment, { start: 0, end: 2, short: true });
  assert.ok(out.cost > 0 && out.cost < 0.03);
  assert.match(judge.SYSTEM, /segment/);
});

// ─── clip proxy ─────────────────────────────────────────────────────────
await test('clip proxy: allow-listed hosts only, redirects re-checked, one ranged chunk, 404 -> dead', async () => {
  assert.equal(SRC.proxyHostAllowed('https://video.twimg.com/a.mp4'), true);
  assert.equal(SRC.proxyHostAllowed('https://espnmedia-cdn.akamaized.net/a.mp4'), true);
  assert.equal(SRC.proxyHostAllowed('https://evil.example/a.mp4'), false);
  assert.equal(SRC.proxyHostAllowed('http://video.twimg.com/a.mp4'), false);
  assert.equal(SRC.proxyHostAllowed('https://cdn.example/a.mp4', { CLIPS_MEDIA_HOSTS: 'cdn.example' }), true);
  assert.equal((await SRC.clipProxy({ url: 'https://evil.example/a.mp4' })).status, 400);
  const asked = [];
  const ok = await SRC.clipProxy({ url: 'https://video.twimg.com/a.mp4', start: 100 }, { fetchImpl: async (u, init) => { asked.push(init.headers.Range); return new Response(new Uint8Array(50), { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 100-149/5000' } }); } });
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.from, ok.to, ok.total, ok.bytes.length], [100, 149, 5000, 50]);
  assert.equal(asked[0], `bytes=100-${100 + SRC.PROXY.chunk - 1}`);
  const redirect = await SRC.clipProxy({ url: 'https://video.twimg.com/a.mp4' }, { fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/b.mp4' } }) });
  assert.equal(redirect.reason, 'redirect');
  const dead = await SRC.clipProxy({ url: 'https://video.twimg.com/a.mp4' }, { fetchImpl: async () => new Response('', { status: 404 }) });
  assert.deepEqual([dead.status, dead.reason], [404, 'dead']);
  const page = await SRC.clipProxy({ url: 'https://video.twimg.com/a.mp4' }, { fetchImpl: async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }) });
  assert.equal(page.reason, 'type');
});

await test('handler: clip-rank and clip-proxy answer a signed-in user (binary 206 with Content-Range); clip-judge confirms into the library', async () => {
  const { handler } = require('../netlify/functions/reel-maker.js');
  const realFetch = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'pk';
  LIB._reset();
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const j = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/auth/v1/user')) return String(opts.headers?.Authorization || '').includes('good') ? j(200, { id: 'u1', email: 'editor@essentiallysports.com' }) : j(401, {});
    if (u.startsWith('https://video.twimg.com/')) return new Response(new Uint8Array([1, 2, 3, 4]), { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/4' } });
    if (u.includes('/rpc/frameup_my_ai_spend')) return j(200, [{ total_usd: 0 }]);
    if (u.includes('/rpc/frameup_team_ai_spend')) return j(200, [{ total_usd: 0 }]);
    if (u.includes('/rpc/frameup_my_ai_calls_last_hour')) return j(200, 0);
    if (u.includes('/rest/v1/')) return new Response('', { status: 201 });
    if (u.includes('ai-gateway.vercel.sh')) return j(200, { choices: [{ message: { content: JSON.stringify({ clips: [{ i: 0, kind: 'game-action', quality: 8, action: [3, 9, 2], relevance: { 'lamar jackson': 9 } }] }) } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
    return j(404, {});
  };
  try {
    const raw = body => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer good' }, body: JSON.stringify(body) });
    const px = await raw({ mode: 'clip-proxy', url: 'https://video.twimg.com/a.mp4' });
    assert.equal(px.statusCode, 206);
    assert.equal(px.isBase64Encoded, true);
    assert.equal(px.headers['Content-Range'], 'bytes 0-3/4');
    assert.deepEqual([...Buffer.from(px.body, 'base64')], [1, 2, 3, 4]);
    const bad = await raw({ mode: 'clip-proxy', url: 'https://evil.example/a.mp4' });
    assert.equal(bad.statusCode, 400);
    const frame = 'data:image/jpeg;base64,AAAA';
    const jr = await raw({ mode: 'clip-judge', sport: 'nfl', subjects: [{ key: 'lamar jackson', label: 'Lamar Jackson', type: 'player', team: 'Baltimore Ravens' }], clips: [{ url: LAMAR_TD.url, handle: 'Ravens', text: LAMAR_TD.text, frames: [frame, frame, frame], times: [1, 4, 7], durationMs: 9000, wantMs: 3000, meta: { handle: 'Ravens', platform: 'x', variants: LAMAR_TD.variants, text: LAMAR_TD.text } }] });
    assert.equal(jr.statusCode, 200);
    assert.ok(JSON.parse(jr.body).judgements[LAMAR_TD.url].segment);
    const rows = await LIB.read(['player:lamar jackson']);
    assert.equal(rows.length, 1, 'the confirmed clip is in the library');
    const rk = await raw({ mode: 'clip-rank', url: LAMAR_TD.url, delta: 1, keys: ['player:lamar jackson'] });
    assert.equal(rk.statusCode, 200);
    assert.equal(JSON.parse(rk.body).rank, 1);
    const unauth = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer nope' }, body: JSON.stringify({ mode: 'clip-proxy', url: 'https://video.twimg.com/a.mp4' }) });
    assert.equal(unauth.statusCode, 401);
  } finally { globalThis.fetch = realFetch; LIB._reset(); judge.CACHE.clear(); }
});

// ─── The browser module ─────────────────────────────────────────────────
function sceneReplyFor(beats) {
  return { ok: true, esStyle: 'hotseat', subjects: [{ key: 'lamar jackson', label: 'Lamar Jackson', type: 'player', team: 'Baltimore Ravens' }], judge: { ready: true, maxClips: 24, perCall: 4, maxUsdPerReel: 0.03 }, beats, judgeQueue: beats.flatMap(b => b.clips).map(c => ({ url: c.url, beatIds: [beats.find(b => b.clips.includes(c)).beatId], keys: [] })), cost: 0 };
}
const lamarSub = C.subjectOfBeat(RAVENS.chapters[0].beats[0], RAVENS);
const frame = 'data:image/jpeg;base64,AAAA';
const sampler = async () => ({ samples: [{ t: 0.5, motion: 0.5 }, { t: 3, motion: 0.9 }], frames: [frame, frame, frame], times: [1, 2, 3] });

await test('ReelSourcing (v4): a judge error does not end judging; after it unjudged clips use the strict text gate; motion fields + actions', async () => {
  RS._test.reset();
  const extra = Array.from({ length: 4 }, (_, i) => clip(`x${i}`, 'Ravens practice', { handle: 'Ravens', source: 'official' }));
  const beats = [
    { beatId: 'h1', wants: 'clip', kind: 'clip', subject: lamarSub, clips: [...extra, LAMAR_TD], photos: [], teamPhotos: [] },
    { beatId: 'd1', wants: 'none', kind: 'none', subject: lamarSub, clips: [], photos: [], teamPhotos: [] },
  ];
  let judgeCalls = 0;
  const sent = [];
  const api = async body => {
    sent.push(body);
    if (body.mode === 'scene-media') return sceneReplyFor(beats);
    if (body.mode === 'clip-judge') { judgeCalls += 1; if (judgeCalls === 1) throw Object.assign(new Error('Gateway 502'), { status: 502 }); return { ok: true, judgements: {}, cost: 0.001 }; }
    if (body.mode === 'clip-rank') return { ok: true };
    throw new Error(body.mode);
  };
  const out = await RS.mediaFor(RAVENS, 'hotseat', { api, loadVideo: async () => ({}), sampleClip: sampler, aiBrollUsd: 0.25 });
  assert.equal(judgeCalls, 2, 'the second batch still ran after one failure');
  assert.equal(out.judgeFailed, true);
  assert.equal(out.beats.h1.pick.kind, 'clip');
  assert.equal(out.beats.h1.pick.gate, 'text', 'the post names him in full: the strict text gate');
  assert.equal(out.beats.h1.motion, 'clip');
  assert.equal(out.beats.d1.motion, 'module');
  assert.equal(out.clipCount, 1);
  assert.equal(out.needsClips, false);
  const judgeBody = sent.find(b => b.mode === 'clip-judge');
  assert.ok(judgeBody.clips[0].meta && judgeBody.clips[0].meta.variants, 'meta travels for the confirmed library');
  assert.equal(judgeBody.sport, 'nfl');
  assert.ok(judgeBody.subjects[0].type === 'player' && judgeBody.subjects[0].team);
  const sp = sent.find(b => b.mode === 'scene-media');
  assert.ok(Array.isArray(sp.plan.chapters) && sp.plan.chapters[0].beats[0].media.kind === 'clip', 'the v4 plan travels slim, chapters kept');
  // A 429 stops at once.
  RS._test.reset();
  let n = 0;
  await RS.mediaFor(RAVENS, 'hotseat', { api: async body => { if (body.mode === 'scene-media') return sceneReplyFor(beats); n += 1; throw Object.assign(new Error('limit'), { status: 429 }); }, loadVideo: async () => ({}), sampleClip: sampler });
  assert.equal(n, 1);
});

await test('ReelSourcing (v4): a clip that will not load is left out (load-failed); nextCandidate walks clip -> photo -> team photo -> none; rank sends clip-rank', async () => {
  RS._test.reset();
  const beats = [{ beatId: 'h1', wants: 'clip', kind: 'clip', subject: lamarSub, clips: [LAMAR_TD, LAMAR_2], photos: [photo('lamar')], teamPhotos: [photo('ravens')] }];
  const sent = [];
  const api = async body => {
    sent.push(body);
    if (body.mode === 'scene-media') return sceneReplyFor(beats);
    if (body.mode === 'clip-judge') return { ok: true, judgements: Object.fromEntries(body.clips.map(c => [c.url, { kind: 'game-action', quality: 8, action: [8, 8, 8], relevance: { 'lamar jackson': 9 }, moment: { 'lamar jackson': 8 } }])), cost: 0.002 };
    return { ok: true };
  };
  const out = await RS.mediaFor(RAVENS, 'hotseat', { api, loadVideo: async c => (c.url === LAMAR_2.url ? null : {}), sampleClip: sampler });
  assert.equal(out.beats.h1.pick.clip.url, LAMAR_TD.url);
  assert.ok(!out.beats.h1.clips.some(c => c.url === LAMAR_2.url), 'the clip that did not load is not offered');
  const p1 = RS.nextCandidate('h1');
  assert.equal(p1.kind, 'photo');
  assert.ok(p1.kenBurns);
  assert.ok(p1.failures.includes('load-failed'));
  assert.equal(RS.last.beats.h1.motion, 'kenburns');
  assert.equal(RS.last.needsClips, true, 'no clip left: flagged');
  const p2 = RS.nextCandidate('h1');
  assert.equal(p2.photo.sourceUrl, photo('ravens').sourceUrl, 'then the team photo');
  const p3 = RS.nextCandidate('h1');
  assert.equal(p3.kind, 'none');
  assert.equal(RS.rank(LAMAR_TD.url, 1, { beatId: 'h1' }), true);
  await new Promise(r => setTimeout(r, 0));
  const rk = sent.find(b => b.mode === 'clip-rank');
  assert.deepEqual([rk.url, rk.delta, rk.keys], [LAMAR_TD.url, 1, ['player:lamar jackson', 'team:baltimore ravens']]);
  assert.equal(RS.rank('not-a-url', 1), false);
  assert.deepEqual(RS.keysFor({ type: 'player', name: 'Lamar Jackson', team: 'Baltimore Ravens', date: '2026-11-23' }), LIB.keysFor({ type: 'player', name: 'Lamar Jackson', team: 'Baltimore Ravens', date: '2026-11-23' }), 'browser and server keys agree');
  const check = RS.motionCheck(RAVENS);
  assert.equal(check.motionOk, false);
  assert.ok(check.actions.some(a => a.action === 'ai-broll'), 'AI b-roll is offered (with its price), never run');
});

await test('ReelSourcing: fetchClipFile falls back to the same-origin proxy in chunks when the direct download is refused', async () => {
  const chunks = [];
  const got = await RS._test.fetchClipFile('https://video.twimg.com/a.mp4', {
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
    proxy: async (url, start) => { chunks.push(start); return { bytes: new Uint8Array(start === 0 ? 3 : 2), total: 5 }; },
  });
  assert.ok(got.blob);
  assert.equal(got.via, 'proxy');
  assert.deepEqual(chunks, [0, 3]);
  const dead = await RS._test.fetchClipFile('https://video.twimg.com/a.mp4', { fetchImpl: async () => new Response('', { status: 404 }), proxy: async () => { throw new Error('should not proxy a dead file'); } });
  assert.equal(dead.error, 'dead');
});

// ─── Measurement (mocked fixtures): the 6 reference reels ───────────────
// Each reel's clip pool mimics what a team search returns today (mostly
// generic team clips, few naming the player) and what a player / presser
// query returns (clips that name the subject). The judge mock confirms a
// clip when its post names the subject (a stand-in for the vision check).
// "team-only" = the v3 strategy (every subject searched by its team);
// "v4" = the ladder + presser sources. This measures the search-terms
// change only; real-world rates need the live check.
await test('measurement: clip share on the 6 reference reels, team-only search (v3) vs the v4 ladder (mocked)', async () => {
  const REELS = [
    ['Rams/McVay', 'Los Angeles Rams', [['Sean McVay', 'person', 'presser'], ['Davante Adams', 'player', 'clip'], ['Puka Nacua', 'player', 'clip'], ['Los Angeles Rams', 'team', 'clip']]],
    ['Dallas 21-pt lead', 'Dallas Cowboys', [['Dak Prescott', 'player', 'clip'], ['Brian Schottenheimer', 'person', 'presser'], ['Dallas Cowboys', 'team', 'clip']]],
    ['Kittle', 'San Francisco 49ers', [['George Kittle', 'player', 'clip'], ['Kyle Shanahan', 'person', 'presser'], ['San Francisco 49ers', 'team', 'clip']]],
    ['Rodgers who calls', 'Pittsburgh Steelers', [['Aaron Rodgers', 'player', 'clip'], ['Mike Tomlin', 'person', 'presser'], ['Pittsburgh Steelers', 'team', 'clip']]],
    ['Chiefs shortest throw', 'Kansas City Chiefs', [['Patrick Mahomes', 'player', 'clip'], ['Travis Kelce', 'player', 'clip'], ['Kansas City Chiefs', 'team', 'clip']]],
    ['Ravens perfect cover', 'Baltimore Ravens', [['Lamar Jackson', 'player', 'clip'], ['Eric DeCosta', 'person', 'presser'], ['Tyler Linderbaum', 'player', 'presser']]],
  ];
  const rows = [];
  for (const [title, team, subs] of REELS) {
    const plan = { v: 4, esStyle: 'breakdown', sport: 'nfl', title, team: { name: team }, chapters: [{ id: 'c1', beats: subs.map(([name, type, kind], i) => ({ id: `b${i + 1}`, vo: name, media: { kind, subject: { type, name, team } } })) }] };
    const generic = Array.from({ length: 9 }, (_, i) => clip(`${team}-g${i}`, `${team} highlights from Sunday`, { teams: [team] }));
    const byQuery = {};
    subs.forEach(([name, , kind]) => {
      const q = kind === 'presser' ? `${name} press conference` : `${name} highlights`;
      byQuery[q] = [clip(`${name}-1`, kind === 'presser' ? `${name} press conference after the game` : `${name} with the big play`, { teams: [team] }), clip(`${name}-2`, kind === 'presser' ? `${name} postgame press conference` : `${name} touchdown`, { teams: [team] })];
    });
    // The mock judge: relevance 9 when the post names the subject, 3 otherwise; pressers by text.
    const judgeAll = res => {
      const j = {};
      res.beats.forEach(b => b.clips.forEach(c => {
        const names = res.subjects.filter(s => ` ${C.norm(c.text)} `.includes(` ${s.key} `) || (s.type === 'team' && (c.teams || []).includes(s.label)));
        const rel = Object.fromEntries(res.subjects.map(s => [s.key, names.some(n => n.key === s.key) ? 9 : 3]));
        j[c.url] = { kind: /press conference/.test(c.text) ? 'press-conference' : 'game-action', quality: 8, action: [5, 8, 5], relevance: rel };
      }));
      return j;
    };
    const run = async ignoreQuery => {
      const d = deps({ byQuery, byTeam: { [team]: generic }, ignoreQuery });
      const first = await SRC.sceneMedia({ plan }, { deps: d, aiAllowed: true });
      const second = await SRC.sceneMedia({ plan, judgements: judgeAll(first) }, { deps: d, aiAllowed: true });
      return second.stats;
    };
    const before = await run(true);
    const after = await run(false);
    rows.push({ reel: title, beats: after.beats, v3TeamOnly: `${before.clip}/${before.beats}`, v4Ladder: `${after.clip}/${after.beats}` });
  }
  if (!quiet) console.table(rows);
  const share = key => rows.reduce((a, r) => a + Number(r[key].split('/')[0]), 0) / rows.reduce((a, r) => a + r.beats, 0);
  assert.ok(share('v4Ladder') > share('v3TeamOnly'), 'the ladder finds more subject clips than the team-only search');
  assert.ok(share('v4Ladder') >= 0.9);
});

console.log(`${process.exitCode ? 'Some' : 'All'} ${passed} v4 sourcing tests ${process.exitCode ? 'ran (see failures)' : 'passed'}.`);
