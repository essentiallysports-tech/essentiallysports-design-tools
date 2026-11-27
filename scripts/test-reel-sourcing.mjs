#!/usr/bin/env node
// Reels v3 sourcing: per-scene subjects, the relevance gate (an irrelevant
// clip is refused and the scene falls back to a verified photo, then an
// infographic block), verified photos only (focus / head passed through),
// the 24-candidate judge queue and its $0.03 cap, per-subject clip search
// (library first, live search for at most 2 subjects), the review pass
// (code fixes + one cheap model call, safe rewrites only), the handler
// modes and the browser module (window.ReelSourcing). Every network and AI
// call is mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.AI_GATEWAY_API_KEY = 'gw-test';
const gateway = require('../netlify/functions/_ai-gateway.js');
const C = require('../reel-clips.js');
const SRC = require('../netlify/functions/_reel-sourcing.js');
const judge = require('../netlify/functions/_reel-clip-judge.js');
const D = require('../netlify/functions/_reel-director.js');
const RS = require('../reel-sourcing.js');
const ADS = require('../netlify/functions/video-ads.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}

// ─── Fixtures: the reference topics ─────────────────────────────────────
const TEAM = { name: 'Green Bay Packers' };
const PLAN = {
  title: "Rodgers' 2011 has no twin", sport: 'nfl', team: TEAM, esStyle: 'gametape', style: 'es',
  beats: [
    { id: 'b1', kind: 'hook', text: 'Rodgers 2011 has no twin', block: { type: 'hook', pills: [{ text: 'RODGERS 2011', color: 'ink' }] }, subject: { type: 'player', name: 'Aaron Rodgers', team: 'Green Bay Packers', moment: '2011 season' } },
    { id: 'b2', kind: 'point', text: 'George Kittle tore his Achilles', block: { type: 'clipLabel', text: 'GEORGE KITTLE' }, subject: { type: 'player', name: 'George Kittle', team: 'San Francisco 49ers' } },
    { id: 'b3', kind: 'stat', text: '45 TD 6 INT', stat: { value: '45', label: 'TD' }, block: { type: 'statTiles', tiles: [{ value: '45', label: 'TD', tone: 'blue' }] } },
    { id: 'b4', kind: 'point', text: 'Green Bay went 15-1', block: { type: 'statement', lines: [{ text: 'GREEN BAY', color: 'ink' }, { text: 'WENT 15-1', color: 'blue' }] }, subject: { type: 'team', name: 'Green Bay Packers' } },
    { id: 'b5', kind: 'cta', text: 'Who is closest?', block: { type: 'endcard' } },
  ],
};
const clip = (id, text, extra = {}) => ({ url: `https://x.com/${id}`, handle: 'packers', text, source: 'official', ageHours: 10, durationMs: 9000, shortSide: 720, teams: [], variants: [{ url: `https://video.twimg.com/${id}.mp4`, width: 720, height: 1280 }], ...extra });
const RODGERS = clip('rodgers', 'Aaron Rodgers 2011 touchdown highlights', { teams: ['Green Bay Packers'] });
const CROWD = clip('crowd', 'Lambeau is loud tonight', { teams: ['Green Bay Packers'] });
const KITTLE = clip('kittle', 'George Kittle catch and run', { handle: '49ers', teams: ['San Francisco 49ers'] });
const AWAY = clip('away', 'Chicago Bears win', { via: 'colorx', handle: 'ChicagoBears' });
const photo = (name, verified, extra = {}) => ({ url: `/api/es-image-search?image=${encodeURIComponent(`https://image-cdn.essentiallysports.com/${name}.jpg`)}`, sourceUrl: `https://image-cdn.essentiallysports.com/${name}.jpg`, title: name, verified, verifiedBy: verified ? 'vision' : '', focus: { x: 0.3, y: 0.1, w: 0.4, h: 0.6 }, focal: { x: 0.5, y: 0.22 }, kind: 'action', ...extra });
const J = (key, rel, extra = {}) => C.validateJudgement({ kind: 'game-action', quality: 8, action: [7, 8, 7], relevance: { [key]: rel }, ...extra }, 3);

function mockDeps({ clipsByKey = {}, photosBy = {}, calls = {} } = {}) {
  calls.find = []; calls.photos = []; calls.verifyGateways = [];
  return {
    teams: require('../video-ads-teams.js'),
    judgeCache: new Map(),
    confirmed: { keysFor: () => [], read: async () => [] },
    log: () => {},
    gateway: { gatewayConfigured: () => true, featureDisabled: () => false, aiText: async args => { calls.verifyGateways.push(args.track && args.track.feature); return { text: '{}', cost: 0.01 }; } },
    findClips: async (body, track) => {
      calls.find.push({ subject: body.subject.name, freeOnly: Boolean(track.freeOnly), query: body.query || '', team: body.team || '' });
      const key = body.subject.type === 'team' ? body.subject.name : body.subject.team || body.subject.name;
      return { ok: true, clips: clipsByKey[key] || [], cost: track.freeOnly ? 0 : 0.03 };
    },
    findPhotos: async (args, ctx) => {
      calls.photos.push({ args, vision: Boolean(ctx.deps.verify) });
      if (ctx.deps.verify) await ctx.deps.verify({ name: args.person || args.team }, [], { max: 12 });
      return { ok: true, photos: photosBy[args.person || args.team || args.query] || [], cost: ctx.deps.verify ? 0.01 : 0 };
    },
    verifyWithVision: async (subject, photos, opts) => { calls.maxPhotos = opts.max; await opts.gateway.aiText({ track: { feature: 'generate-photo-pick' } }); return { verdicts: new Map(), cost: 0.01 }; },
  };
}

// ─── reel-clips: subjects, styles, the gate ─────────────────────────────
await test('subjects: the director\'s per-scene subject wins; else derived from the photo query / the team', () => {
  const s1 = C.subjectOfBeat(PLAN.beats[0], PLAN);
  assert.deepEqual([s1.type, s1.name, s1.team, s1.moment, s1.key], ['player', 'Aaron Rodgers', 'Green Bay Packers', '2011 season', 'aaron rodgers']);
  const s3 = C.subjectOfBeat({ kind: 'point', photo: 'Jordy Nelson' }, PLAN);
  assert.deepEqual([s3.type, s3.name, s3.team], ['player', 'Jordy Nelson', 'Green Bay Packers']);
  const s4 = C.subjectOfBeat({ kind: 'point', text: 'x' }, PLAN);
  assert.deepEqual([s4.type, s4.name], ['team', 'Green Bay Packers']);
  assert.equal(C.subjectFor(PLAN.beats[0], PLAN).key, 'aaron rodgers', 'the old picker reads the same key');
});

await test('styles (v4): the four new ids; v3 ids and old looks / recipes map per the contract; media policy per style', () => {
  assert.deepEqual(C.STYLE_IDS, ['breakdown', 'casefile', 'outlier', 'hotseat']);
  assert.equal(C.styleOf({ esStyle: 'hotseat' }), 'hotseat');
  assert.equal(C.styleOf({ esStyle: 'hypecut' }), 'breakdown');
  assert.equal(C.styleOf({ esStyle: 'gametape' }), 'breakdown');
  assert.equal(C.styleOf({ style: 'statcard' }), 'breakdown');
  assert.equal(C.styleOf({ esStyle: 'receipts', beats: [{ block: { type: 'dotGrid' } }] }), 'outlier', 'receipts with a dot grid -> The Outlier');
  assert.equal(C.styleOf({ recipe: 'Data-led' }), 'breakdown');
  assert.equal(C.styleOf({ look: 'photo' }), 'breakdown');
  assert.equal(C.styleOf({ look: 'paper', beats: [{ visual: 'clip' }] }), 'breakdown');
  assert.equal(C.legacyStyle('bold'), 'hypecut', 'the v3 legacy map still reads old looks');
  assert.equal(C.wantsFor(PLAN.beats[1], 'breakdown'), 'clip');
  assert.equal(C.wantsFor(PLAN.beats[2], 'breakdown'), 'none', 'an animating data block carries the scene');
  assert.equal(C.wantsFor({ kind: 'point', media: { kind: 'presser', subject: { type: 'person', name: 'Eric DeCosta' } } }, 'breakdown'), 'presser');
  assert.equal(C.wantsFor({ kind: 'point', subject: { type: 'person', name: 'Eric DeCosta' } }, 'hotseat'), 'presser', 'Hot Seat: people get pressers');
  assert.equal(C.wantsFor({ kind: 'point', media: { kind: 'cards' } }, 'breakdown'), 'photo');
  assert.equal(C.wantsFor({ kind: 'point', module: { type: 'scatter' } }, 'outlier'), 'none');
  // v3 policies stay readable for old callers.
  assert.equal(C.wantsFor(PLAN.beats[1], 'gametape'), 'clip');
  assert.equal(C.wantsFor(PLAN.beats[2], 'gametape'), 'none', 'data blocks carry no media');
  assert.equal(C.wantsFor(PLAN.beats[0], 'statcard'), 'photo');
  assert.equal(C.wantsFor(PLAN.beats[0], 'receipts'), 'none');
  assert.equal(C.wantsFor({ kind: 'point', block: { type: 'photoCard' } }, 'gametape'), 'photo');
});

await test('relevance gate: subject >= 7, the moment >= 5 when named, never a graphic; strict text gate only without a judge', () => {
  const sub = C.subjectOfBeat(PLAN.beats[0], PLAN);
  assert.equal(C.passesGate(J(sub.key, 9, { moment: { [sub.key]: 8 } }), sub), true);
  assert.equal(C.passesGate(J(sub.key, 6, { moment: { [sub.key]: 8 } }), sub), false, 'right team, another player');
  assert.equal(C.passesGate(J(sub.key, 9), sub), false, 'the moment was not confirmed');
  assert.equal(C.passesGate(J(sub.key, 9, { moment: { [sub.key]: 2 } }), sub), false, 'wrong moment');
  assert.equal(C.passesGate(J(sub.key, 9, { kind: 'graphic-or-text', moment: { [sub.key]: 9 } }), sub), false);
  assert.equal(C.passesGate(null, sub), false);
  assert.equal(C.textGate(RODGERS, sub), true, 'full name in an official post');
  assert.equal(C.textGate(clip('r2', 'Rodgers deep ball'), sub), false, 'one word is not enough');
  assert.equal(C.textGate({ ...RODGERS, source: 'fan' }, sub), false, 'untrusted source');
  const team = C.subjectOfBeat(PLAN.beats[3], PLAN);
  assert.equal(C.textGate(CROWD, team), true, 'the team\'s own tagged official post');
  assert.equal(C.textGate({ ...CROWD, source: 'media' }, team), false);
});

await test('gatedPicks: an irrelevant clip is refused -> verified photo; no photo -> infographic block; unverified photo refused; no reuse', () => {
  const s1 = C.subjectOfBeat(PLAN.beats[0], PLAN);
  const s2 = C.subjectOfBeat(PLAN.beats[1], PLAN);
  const scenes = [
    { beatId: 'b1', subject: s1, wants: 'clip', beat: PLAN.beats[0], clips: [CROWD, RODGERS], photos: [photo('rodgers', true)] },
    { beatId: 'b2', subject: s2, wants: 'clip', beat: PLAN.beats[1], clips: [CROWD], photos: [photo('kittle-unverified', false)] },
    { beatId: 'b4', subject: C.subjectOfBeat(PLAN.beats[3], PLAN), wants: 'clip', beat: PLAN.beats[3], clips: [RODGERS], photos: [] },
  ];
  const judgements = {
    [CROWD.url]: J(s1.key, 2, { relevance: { [s1.key]: 2, [s2.key]: 1, 'green bay packers': 5 } }),
    [RODGERS.url]: C.validateJudgement({ kind: 'highlight-replay', quality: 8, action: [8, 8, 8], relevance: { [s1.key]: 9, 'green bay packers': 8 }, moment: { [s1.key]: 7 } }, 3),
  };
  const out = C.gatedPicks(scenes, { judgements, judgeAvailable: true });
  assert.equal(out.b1.kind, 'clip');
  assert.equal(out.b1.clip.url, RODGERS.url, 'the confirmed clip, not the crowd shot');
  assert.equal(out.b1.gate, 'judge');
  assert.equal(out.b2.kind, 'none', 'crowd refused, unverified photo refused');
  assert.equal(out.b2.fallback.type, 'statement');
  assert.ok(out.b2.fallback.lines.length >= 1);
  assert.notEqual(out.b4.kind === 'clip' && out.b4.clip.url, RODGERS.url, 'the same clip is not put on a second scene');
  assert.ok(out.b1.candidates.every(c => c.kind === 'photo' || c.gate), 'Swap only offers gated clips and verified photos');
  // No judge at all (AI off): only the strict text gate.
  const off = C.gatedPicks([{ ...scenes[0], clips: [CROWD, RODGERS] }], { judgeAvailable: false });
  assert.equal(off.b1.kind, 'clip');
  assert.equal(off.b1.gate, 'text');
  // The judge ran but did not rate this subject: an unjudged clip is not used.
  const on = C.gatedPicks([{ ...scenes[0], clips: [RODGERS], photos: [] }], { judgeAvailable: true });
  assert.equal(on.b1.kind, 'none');
  assert.ok(C.fallbackBlock({ text: 'x', stat: { value: '45', label: 'TD' } }).type === 'statTiles');
});

await test('judge queue: up to 24 candidates, round-robin over scenes, judged clips skipped; cost cap $0.03', () => {
  const many = Array.from({ length: 20 }, (_, i) => clip(`c${i}`, `Aaron Rodgers play ${i}`));
  const other = Array.from({ length: 20 }, (_, i) => clip(`k${i}`, `George Kittle play ${i}`));
  const q = C.judgeQueue([{ beatId: 'b1', subject: C.subjectOfBeat(PLAN.beats[0], PLAN), clips: many }, { beatId: 'b2', subject: C.subjectOfBeat(PLAN.beats[1], PLAN), clips: other }], { judged: url => url.endsWith('/c0') });
  assert.equal(q.length, 24);
  assert.ok(!q.some(e => e.url.endsWith('/c0')));
  assert.equal(q.filter(e => e.beatIds.includes('b1')).length, 12, 'both scenes get turns');
  assert.equal(C.JUDGE.maxClips, 24);
  assert.equal(C.JUDGE.maxUsdPerReel, 0.03);
  const reel = Math.ceil(24 / C.JUDGE.perCall) * C.judgeCost({ clips: C.JUDGE.perCall });
  assert.ok(reel <= 0.031, `24 clips cost ~$${reel.toFixed(4)}`);
});

await test('clip judge: rates the moment per subject, needs it in the cache, 4 clips a call, logged as reels-clip-judge', async () => {
  judge.CACHE.clear();
  const frame = `data:image/jpeg;base64,${'A'.repeat(200)}`;
  const sent = [];
  const logged = [];
  const realLog = gateway.logUsage;
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    sent.push(body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ clips: [{ i: 0, kind: 'game-action', quality: 8, action: [8, 8, 8], relevance: { 'aaron rodgers': 9 }, moment: { 'aaron rodgers': 7 } }] }) } }], usage: { prompt_tokens: 3000, completion_tokens: 200 } }), { status: 200 });
  };
  const clips = Array.from({ length: 5 }, (_, i) => ({ url: `https://x.com/j${i}`, text: 'Aaron Rodgers', frames: [frame, frame, frame], times: [1, 2, 3] }));
  const out = await judge.judgeClips({ clips, subjects: [{ key: 'aaron rodgers', label: 'Aaron Rodgers', moment: '2011 season' }], budgetUsd: 0.03, fetchImpl, track: null });
  assert.equal(out.ok, true);
  const user = sent[0].messages[1].content;
  assert.match(user[0].text, /\[moment: 2011 season\]/);
  assert.match(sent[0].messages[0].content, /moment/);
  assert.equal(user.filter(p => p.type === 'image_url').length, 12, '4 clips x 3 frames in one call');
  assert.equal(out.judgements['https://x.com/j0'].moment['aaron rodgers'], 7);
  // Cached for the same subject + moment; a new moment needs a fresh look.
  const again = await judge.judgeClips({ clips: clips.slice(0, 1), subjects: [{ key: 'aaron rodgers', label: 'Aaron Rodgers', moment: '2011 season' }], budgetUsd: 0.03, fetchImpl });
  assert.equal(again.cached, 1);
  assert.equal(sent.length, 1);
  assert.equal(judge.FEATURE, 'reels-clip-judge');
  gateway.logUsage = realLog;
  void logged;
});

// ─── sceneMedia ──────────────────────────────────────────────────────────
await test('scene-media: one search per team (shared by its scenes), photos only verified with focus + head, per-scene subjects', async () => {
  const calls = {};
  const deps = mockDeps({
    calls,
    clipsByKey: { 'Green Bay Packers': [CROWD, RODGERS, AWAY], 'San Francisco 49ers': [KITTLE] },
    photosBy: { 'Aaron Rodgers': [photo('rodgers', true), photo('someone-else', false)], 'George Kittle': [photo('kittle', true)], 'Green Bay Packers': [] },
  });
  const res = await SRC.sceneMedia({ plan: PLAN }, { deps, aiAllowed: true, track: { email: 'e', token: 't' } });
  assert.equal(res.ok, true);
  assert.equal(res.esStyle, 'breakdown', 'gametape maps to Breakdown');
  assert.deepEqual(res.beats.map(b => b.wants), ['clip', 'clip', 'none', 'clip', 'none']);
  // The ladder: Rodgers player+moment -> player+game -> team+game -> team (only one clip names him);
  // Kittle player+game -> team; the Packers scene the team rung.
  assert.deepEqual(calls.find.filter(c => c.subject === 'Aaron Rodgers').map(c => c.query || `team:${c.team}`), ['Aaron Rodgers 2011 season', 'Aaron Rodgers highlights', 'Green Bay Packers 2011 season', 'team:Green Bay Packers']);
  assert.deepEqual(calls.find.filter(c => c.subject === 'George Kittle').map(c => c.query || `team:${c.team}`), ['George Kittle highlights', 'team:San Francisco 49ers']);
  assert.ok(res.beats[0].ladder.length === 4 && res.beats[0].ladder[0].rung === 'player+moment');
  const b1 = res.beats[0];
  assert.equal(b1.subject.name, 'Aaron Rodgers');
  assert.ok(!b1.clips.some(c => c.url === AWAY.url), 'widened other-team clips never reach a scene');
  assert.equal(b1.clips[0].url, RODGERS.url, 'clips naming the subject first');
  assert.equal(b1.photos.length, 1, 'the unverified photo is dropped');
  assert.deepEqual(b1.photos[0].focus, { x: 0.3, y: 0.1, w: 0.4, h: 0.6 });
  assert.deepEqual(b1.photos[0].head, { x: 0.5, y: 0.22 });
  // No judgements yet: nothing judged, so no clip is picked; the judge queue lists them.
  assert.equal(b1.pick.kind, 'photo', 'unjudged clips wait; the verified photo stands');
  assert.ok(res.judgeQueue.length >= 3 && res.judgeQueue.length <= 24);
  assert.equal(res.beats[3].pick.kind, 'none');
  assert.equal(res.beats[3].pick.fallback.type, 'statement', 'no picture: an infographic block');
  assert.equal(res.beats[3].motionOk, false, 'a static statement with no picture fails the motion rule');
  assert.equal(res.needsClips, true);
  assert.equal(res.actions[0].action, 'find-clips');
  assert.ok(calls.verifyGateways.length && calls.verifyGateways.every(f => f === 'reels-photo-verify'), 'photo vision logged as a Reels feature');
  assert.equal(calls.maxPhotos, 6, 'at most 6 photos per vision check');
  assert.equal(res.judge.threshold.relevance, 7);
});

await test('scene-media: judgements in -> the confirmed clip is picked; an irrelevant one never is', async () => {
  const deps = mockDeps({ clipsByKey: { 'Green Bay Packers': [CROWD, RODGERS], 'San Francisco 49ers': [KITTLE] }, photosBy: {} });
  const judgements = {
    [RODGERS.url]: { kind: 'game-action', quality: 8, action: [8], relevance: { 'aaron rodgers': 9, 'green bay packers': 8 }, moment: { 'aaron rodgers': 8 } },
    [CROWD.url]: { kind: 'crowd-stadium', quality: 6, action: [2], relevance: { 'aaron rodgers': 1, 'green bay packers': 4 } },
    [KITTLE.url]: { kind: 'game-action', quality: 8, action: [8], relevance: { 'george kittle': 3 } },
  };
  const res = await SRC.sceneMedia({ plan: PLAN, judgements }, { deps, aiAllowed: true });
  assert.equal(res.beats[0].pick.kind, 'clip');
  assert.equal(res.beats[0].pick.ref, RODGERS.url);
  assert.equal(res.beats[0].pick.gate, 'judge');
  assert.equal(res.beats[1].pick.kind, 'none', 'Kittle clip judged 3/10: refused, no photo, infographic');
  assert.equal(res.beats[3].pick.kind, 'none', 'the crowd shot (4/10 for the team) is refused');
  assert.equal(res.beats[1].clips[0].gate, '');
});

await test('scene-media: live clip search for at most 2 subjects, vision for at most 2 (6 photos each); AI off -> library + text evidence, no queue', async () => {
  const plan = { ...PLAN, beats: ['Aaron Rodgers|Green Bay Packers', 'George Kittle|San Francisco 49ers', 'Josh Allen|Buffalo Bills', 'Patrick Mahomes|Kansas City Chiefs', 'Lamar Jackson|Baltimore Ravens'].map((x, i) => ({ id: `b${i + 1}`, kind: i ? 'point' : 'hook', text: x, block: { type: i ? 'statement' : 'hook' }, subject: { type: 'player', name: x.split('|')[0], team: x.split('|')[1] } })) };
  const calls = {};
  const res = await SRC.sceneMedia({ plan }, { deps: mockDeps({ calls }), aiAllowed: true });
  assert.equal(calls.find.filter(c => !c.freeOnly).length, 2, 'at most 2 paid live searches a reel, whatever the ladder');
  assert.ok(calls.find.filter(c => c.freeOnly).length >= 3, 'the other rungs: library + free sources');
  assert.equal(calls.photos.filter(c => c.vision).length, 2);
  assert.equal(res.capped.clips, true);
  assert.equal(res.capped.photos, true);
  const off = {};
  const res2 = await SRC.sceneMedia({ plan }, { deps: mockDeps({ calls: off }), aiAllowed: false });
  assert.ok(off.find.every(c => c.freeOnly));
  assert.ok(off.photos.every(c => !c.vision));
  assert.deepEqual(res2.judgeQueue, []);
  assert.equal(res2.judge.ready, false);
});

await test('scene-media (v4): old Receipts / Stat Card plans map to Breakdown and get clips; a verified photo carries Ken Burns', async () => {
  const calls = {};
  const res = await SRC.sceneMedia({ plan: { ...PLAN, esStyle: 'receipts' } }, { deps: mockDeps({ calls, photosBy: { 'Aaron Rodgers': [photo('rodgers', true)] } }), aiAllowed: true });
  assert.equal(res.esStyle, 'breakdown');
  assert.ok(calls.find.length > 0, 'no more all-paper reels');
  assert.equal(res.beats[0].pick.kind, 'photo');
  assert.ok(res.beats[0].pick.kenBurns && res.beats[0].pick.kenBurns.to.w < 1, 'Ken Burns on the focus box');
  assert.equal(res.beats[0].motion, 'kenburns');
  assert.equal(res.beats[2].motion, 'module', 'the stat tiles animate by themselves');
});

// ─── Review ──────────────────────────────────────────────────────────────
const CORPUS = 'Aaron Rodgers threw 45 TD and 6 INT in 2011. Green Bay went 15-1.';
await test('review (code): unsourced tile dropped, long lines wrapped, yellow recoloured, hook first, unknown block replaced, bad media flagged', () => {
  const plan = structuredClone(PLAN);
  plan.beats[2].block.tiles.push({ value: '99', label: 'YDS', tone: 'ink' });
  plan.beats[3].block.lines = [{ text: 'GREEN BAY WENT FIFTEEN', color: 'yellow' }];
  plan.beats.splice(0, 0, plan.beats.splice(1, 1)[0]); // hook second
  plan.beats.push({ id: 'b6', kind: 'point', text: 'odd', block: { type: 'sparkle' } });
  plan.beats.push(plan.beats.splice(plan.beats.findIndex(b => b.kind === 'cta'), 1)[0]);
  const picks = { b1: { kind: 'clip', gate: 'judge', relevance: 9, moment: 8 }, b2: { kind: 'clip', gate: '', relevance: 3 }, b4: { kind: 'photo', verified: false } };
  const { plan: out, issues } = SRC.codeReview(plan, { picks, corpus: CORPUS, style: 'gametape' });
  assert.equal(out.beats[0].kind, 'hook');
  const b3 = out.beats.find(b => b.id === 'b3');
  assert.deepEqual(b3.block.tiles.map(t => t.value), ['45']);
  const b4 = out.beats.find(b => b.id === 'b4');
  assert.ok(b4.block.lines.every(l => l.text.length <= 14 && l.color !== 'yellow'));
  assert.ok(['statement', 'statTiles'].includes(out.beats.find(b => b.id === 'b6').block.type));
  const media = issues.filter(i => i.kind === 'media' && i.fix === 'repick').map(i => i.beatId).sort();
  assert.deepEqual(media, ['b2', 'b4'], 'the unconfirmed clip and the unverified photo; not the judged one');
  assert.ok(issues.some(i => i.kind === 'fact' && i.fixed));
  assert.ok(issues.some(i => i.kind === 'brand' && i.fix === 'reorder'));
});

await test('review (AI): one Haiku call logged as reels-review; safe rewrites applied, a new number refused; ready only with no open critical', async () => {
  const calls = [];
  const gw = {
    gatewayConfigured: () => true,
    aiText: async args => {
      calls.push(args);
      return { text: JSON.stringify({ issues: [
        { beat: 'b4', kind: 'text', problem: 'vague', text: 'Green Bay went 15-1 in 2011' },
        { beat: 'b3', kind: 'fact', problem: 'claim', text: 'He threw 50 TD' },
        { beat: 'b1', kind: 'media', problem: 'the clip shows another player' },
        { beat: 'zz', kind: 'text', problem: 'no such scene' },
      ] }), model: 'anthropic/claude-haiku-5.5', cost: 0.0008 };
    },
  };
  const picks = { b1: { kind: 'clip', gate: 'judge', relevance: 9, moment: 8 } };
  const res = await SRC.review({ plan: PLAN, picks, corpus: CORPUS }, { deps: { gateway: gw }, aiAllowed: true, track: { email: 'e' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tier, 'main');
  assert.equal(calls[0].track.feature, 'reels-review');
  assert.ok(calls[0].maxTokens <= 700);
  assert.match(calls[0].messages[0].content, /b1 \[hook\] subject: Aaron Rodgers/);
  assert.equal(res.plan.beats.find(b => b.id === 'b4').text, 'Green Bay went 15-1 in 2011');
  assert.ok(res.plan.beats.find(b => b.id === 'b4').block.lines.every(l => l.text.length <= 14));
  assert.equal(res.plan.beats.find(b => b.id === 'b3').text, '45 TD 6 INT', 'an unsourced 50 is never written');
  assert.ok(res.issues.some(i => i.beatId === 'b1' && i.fix === 'repick' && i.severity === 'critical'));
  assert.equal(res.ready, false);
  assert.equal(res.cost, 0.0008);
  // AI off: code checks only, no call.
  const quiet = await SRC.review({ plan: PLAN, picks, corpus: CORPUS }, { deps: { gateway: gw }, aiAllowed: false });
  assert.equal(calls.length, 1);
  assert.equal(quiet.ready, true);
});

// ─── Director: subjects + data first ────────────────────────────────────
await test('director (v3): the style\'s blocks only, subjects validated against the sources, invented numbers in tiles dropped', () => {
  const read = D.readReelBrief({ brief: 'Aaron Rodgers threw 45 TD and 6 INT in 2011 as the Green Bay Packers went 15-1. George Kittle tore his Achilles.', format: 'stat' });
  const r = D.validatePlan({ format: 'stat', team: 'Green Bay Packers', beats: [
    { kind: 'hook', text: 'Rodgers 2011 has no twin', vo: 'Aaron Rodgers in 2011 was a season nobody has matched since then.', block: { type: 'hook', pills: [{ text: 'RODGERS 2011', color: 'ink' }] }, subject: { type: 'player', name: 'Aaron Rodgers', team: 'Green Bay Packers', moment: '2011 season' } },
    { kind: 'stat', text: '45 TD, 6 INT', vo: 'He threw 45 touchdowns against only 6 interceptions that year.', block: { type: 'statTiles', tiles: [{ value: '45', label: 'TD' }, { value: '6', label: 'INT' }] }, subject: { type: 'player', name: 'Tom Brady' } },
    { kind: 'stat', text: '99 TD', vo: 'Some say 99.', block: { type: 'statTiles', tiles: [{ value: '99', label: 'TD' }] } },
    { kind: 'point', text: '15-1', vo: 'And the Green Bay Packers went 15-1 in the regular season.', block: { type: 'streak', items: 'WWWWWWWWWWWWWLWW', label: '15-1' } },
    { kind: 'point', text: 'The clip', vo: 'Watch him work in that 2011 season for the Packers.', block: { type: 'clipLabel', text: 'AARON RODGERS' } },
    { kind: 'cta', text: 'Who comes closest?', vo: 'Who comes closest? Tell us.', block: { type: 'endcard' } },
  ] }, { read, format: 'stat', style: 'es', esStyle: 'receipts' });
  const types = r.plan.beats.map(b => b.block && b.block.type);
  assert.deepEqual(types, ['hook', 'statTiles', 'streak', 'statement', 'endcard']);
  assert.equal(r.plan.esStyle, 'receipts');
  assert.equal(r.plan.beats[0].subject.moment, '2011 season');
  assert.equal(r.plan.beats[1].subject.name, 'Green Bay Packers', 'Tom Brady is not in the sources: derived instead');
  assert.ok(r.issues.some(i => /99/.test(i)));
  assert.ok(r.issues.some(i => /clipLabel block is not part of Receipts/.test(i)));
  assert.match(D.styleRequest({ engine: 'es' }, '', 'statcard'), /STYLE v3: Stat Card/);
  assert.match(D.V3_SPEC, /"subject"/);
  assert.equal(D.v3StyleOf({ look: 'photo' }), 'statcard');
});

await test('director (v3): Receipts with fewer than two data blocks is weak (data first)', () => {
  const read = D.readReelBrief({ brief: 'The Green Bay Packers went 15-1 in 2011 with Aaron Rodgers.', format: 'explainer' });
  const r = D.validatePlan({ format: 'explainer', beats: [
    { kind: 'hook', text: 'Green Bay 2011', vo: 'Green Bay in 2011 was a machine that nobody could slow down at all.', block: { type: 'hook', pills: [{ text: 'GREEN BAY 2011' }] } },
    { kind: 'point', text: 'A machine', vo: 'The Packers went 15-1 behind Aaron Rodgers and an offense that never stopped.', block: { type: 'statement', lines: [{ text: 'A MACHINE' }] } },
    { kind: 'context', text: 'Nobody slowed them', vo: 'Week after week the Packers scored and scored and scored again all season.', block: { type: 'statement', lines: [{ text: 'NOBODY' }] } },
    { kind: 'payoff', text: 'Still the bar', vo: 'That team is still the bar for the Packers and for Aaron Rodgers too.', block: { type: 'statement', lines: [{ text: 'THE BAR' }] } },
    { kind: 'cta', text: 'Best Packers team?', vo: 'Best Packers team ever? Tell us.', block: { type: 'endcard' } },
  ] }, { read, format: 'explainer', style: 'es', esStyle: 'receipts' });
  assert.equal(r.weak, true);
  assert.ok(r.issues.some(i => /two data blocks/.test(i)));
});

// ─── video-ads find-clips per subject ───────────────────────────────────
await test('video-ads find-clips: a subject picks the team, the full name ranks first; no subject = unchanged', async () => {
  const t = ADS._test;
  assert.deepEqual(t.readClipSubject({ name: 'Aaron Rodgers', team: 'Green Bay Packers', type: 'player' }), { type: 'player', name: 'Aaron Rodgers', team: 'Green Bay Packers', moment: '' });
  assert.equal(t.readClipSubject({ name: '' }), null);
  assert.equal(t.subjectHit({ text: 'Aaron Rodgers to Jordy Nelson' }, { type: 'player', name: 'Aaron Rodgers' }), true);
  assert.equal(t.subjectHit({ text: 'Rodgers to Nelson' }, { type: 'player', name: 'Aaron Rodgers' }), false);
  assert.equal(typeof ADS.findClipsFor, 'function');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  t.useSources([]);
  try {
    const out = await t.findClips({ sport: 'nfl', subject: { type: 'player', name: 'Aaron Rodgers', team: 'Green Bay Packers' } }, { email: 'e', token: 't', freeOnly: true });
    assert.equal(out.ok, true);
    assert.equal(out.teams[0].name, 'Green Bay Packers', 'the subject\'s team was searched');
    assert.equal(out.subject.name, 'Aaron Rodgers');
    const plain = await t.findClips({ sport: 'nfl', team: 'Green Bay Packers' }, { email: 'e', token: 't', freeOnly: true });
    assert.equal(plain.subject, undefined);
  } finally { globalThis.fetch = realFetch; }
});

// ─── The handler modes ──────────────────────────────────────────────────
await test('handler: scene-media and review answer for a signed-in user; free mode / over cap -> aiPaused, still ok', async () => {
  const { handler } = require('../netlify/functions/reel-maker.js');
  const realFetch = globalThis.fetch;
  let spend = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const j = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/auth/v1/user')) return String(opts.headers?.Authorization || '').includes('good') ? j(200, { id: 'u1', email: 'editor@essentiallysports.com' }) : j(401, {});
    if (u.includes('/rpc/frameup_my_ai_spend')) return j(200, [{ total_usd: spend }]);
    if (u.includes('/rpc/frameup_team_ai_spend')) return j(200, [{ total_usd: 0 }]);
    if (u.includes('/rpc/frameup_my_ai_calls_last_hour')) return j(200, 0);
    if (u.includes('/rest/v1/frameup_ai_usage')) return new Response('', { status: 201 });
    return j(404, {});
  };
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'pk';
  const realAi = gateway.aiText;
  let reviewCalls = 0;
  gateway.aiText = async args => { reviewCalls += 1; assert.equal(args.track.feature, 'reels-review'); return { text: '{"issues":[]}', model: 'anthropic/claude-haiku-5.5', cost: 0.0005 }; };
  try {
    const call = async body => { const r = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer good' }, body: JSON.stringify(body) }); return { status: r.statusCode, body: JSON.parse(r.body) }; };
    const sm = await call({ mode: 'scene-media', plan: { ...PLAN, esStyle: 'receipts' } });
    assert.equal(sm.status, 200);
    assert.equal(sm.body.esStyle, 'breakdown');
    assert.equal(sm.body.beats.length, 5);
    const rv = await call({ mode: 'review', plan: PLAN, picks: {}, corpus: CORPUS });
    assert.equal(rv.status, 200);
    assert.equal(rv.body.ready, true);
    assert.equal(reviewCalls, 1);
    const bad = await call({ mode: 'review', plan: { beats: [] } });
    assert.equal(bad.status, 400);
    spend = 999; // over the weekly cap
    const capped = await call({ mode: 'review', plan: PLAN, picks: {}, corpus: CORPUS });
    assert.equal(capped.status, 200);
    assert.ok(capped.body.aiPaused);
    assert.equal(reviewCalls, 1, 'no model call over the cap');
    const unauth = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer nope' }, body: JSON.stringify({ mode: 'scene-media', plan: PLAN }) });
    assert.equal(unauth.statusCode, 401);
  } finally { globalThis.fetch = realFetch; gateway.aiText = realAi; }
});

// ─── The browser module ─────────────────────────────────────────────────
await test('ReelSourcing.mediaFor: samples the judge queue, judges 4 at a time within the cap, picks under the gate; candidates + review repick', async () => {
  RS._test.reset();
  const sceneReply = {
    ok: true, esStyle: 'gametape', subjects: [{ key: 'aaron rodgers', label: 'Aaron Rodgers', moment: '2011 season' }, { key: 'george kittle', label: 'George Kittle' }],
    judge: { ready: true, maxClips: 24, perCall: 4, maxUsdPerReel: 0.03 },
    beats: [
      { beatId: 'b1', wants: 'clip', subject: C.subjectOfBeat(PLAN.beats[0], PLAN), clips: [CROWD, RODGERS], photos: [photoOut('rodgers')] },
      { beatId: 'b2', wants: 'clip', subject: C.subjectOfBeat(PLAN.beats[1], PLAN), clips: [KITTLE, ...Array.from({ length: 5 }, (_, i) => clip(`kx${i}`, 'Niners'))], photos: [] },
      { beatId: 'b3', wants: 'none', subject: C.subjectOfBeat(PLAN.beats[2], PLAN), clips: [], photos: [] },
    ],
    judgeQueue: [CROWD, RODGERS, KITTLE, ...Array.from({ length: 5 }, (_, i) => clip(`kx${i}`, 'Niners'))].map(c => ({ url: c.url, beatIds: [], keys: [] })),
    cost: 0.03,
  };
  function photoOut(name) { const p = photo(name, true); return { url: p.url, sourceUrl: p.sourceUrl, verified: true, focus: p.focus, head: p.focal }; }
  const sent = [];
  const api = async body => {
    sent.push(body);
    if (body.mode === 'scene-media') return sceneReply;
    if (body.mode === 'clip-judge') {
      const judgements = {};
      body.clips.forEach(c => { judgements[c.url] = { kind: 'game-action', quality: 8, action: [8, 8, 8], relevance: { 'aaron rodgers': c.url === RODGERS.url ? 9 : 1, 'george kittle': c.url === KITTLE.url ? 8 : 2 }, moment: { 'aaron rodgers': c.url === RODGERS.url ? 8 : 0 } }; });
      return { ok: true, judgements, cost: 0.005 };
    }
    if (body.mode === 'review') return { ok: true, ready: false, plan: body.plan, issues: [{ beatId: 'b1', kind: 'media', severity: 'critical', fix: 'repick', fixed: false }], cost: 0.0005 };
    throw new Error(`unexpected ${body.mode}`);
  };
  const frame = 'data:image/jpeg;base64,AAAA';
  const out = await RS.mediaFor(PLAN, 'gametape', { api, loadVideo: async () => ({}), sampleClip: async () => ({ samples: [{ t: 0.5, motion: 0.5 }, { t: 3, motion: 0.9 }], frames: [frame, frame, frame], times: [1, 2, 3] }) });
  const judgeCalls = sent.filter(b => b.mode === 'clip-judge');
  assert.equal(judgeCalls.length, 2, '8 clips in batches of 4');
  assert.ok(judgeCalls.every(b => b.clips.length <= 4 && b.budgetUsd <= 0.03));
  assert.equal(judgeCalls[0].subjects[0].moment, '2011 season');
  assert.equal(out.beats.b1.pick.kind, 'clip');
  assert.equal(out.beats.b1.pick.clip.url, RODGERS.url);
  assert.ok(out.beats.b1.pick.segment && out.beats.b1.pick.segment.outSec > out.beats.b1.pick.segment.inSec);
  assert.equal(out.beats.b2.pick.kind, 'clip');
  assert.equal(out.beats.b2.pick.clip.url, KITTLE.url);
  assert.equal(out.beats.b3.pick.kind, 'none');
  assert.equal(sent[0].plan.beats[0].subject.name, 'Aaron Rodgers', 'the subject travels with the plan');
  const cands = RS.candidates('b1');
  assert.ok(cands.length >= 1 && cands[0].kind === 'photo', 'Swap: the verified photo (the crowd clip never)');
  assert.ok(!cands.some(c => c.kind === 'clip' && c.clip.url === CROWD.url));
  const picks = RS.picksFor(PLAN);
  assert.equal(picks.b1.kind, 'clip');
  assert.equal(picks.b1.gate, 'judge');
  const r = await RS.review(PLAN, { api });
  assert.equal(r.repicks.b1.kind, 'photo', 'the review\'s media issue is re-picked from the verified candidates');
  assert.equal(r.ready, true);
  // Second reel: the per-reel judge cap carries the spend; judgements cached in memory storage.
  assert.ok(RS.spent.judge > 0);
});

await test('ReelSourcing: no plan or a failing server -> an empty answer, never a throw', async () => {
  RS._test.reset();
  assert.deepEqual((await RS.mediaFor(null)).beats, {});
  const failed = await RS.mediaFor(PLAN, 'gametape', { api: async () => { throw new Error('Server down'); } });
  assert.deepEqual(failed.beats, {});
  assert.match(failed.notes[0], /Server down/);
  const rv = await RS.review(PLAN, { api: async () => { throw new Error('nope'); } });
  assert.equal(rv.ready, false);
  assert.deepEqual(RS.candidates('b1'), []);
});

console.log(process.exitCode ? '' : `\nAll ${passed} reel sourcing tests passed.`);
