#!/usr/bin/env node
// Reels v5 CLIPS lane (2026-11-28, owner on live: "I don't see any clip, all
// are static"). A typical script must ask for clips, get them, and never
// leave a scene without motion. Every network and AI call is mocked.
//
// Root causes covered:
//   1. Sport: a script naming a player and "the 49ers" (no full team name)
//      read as sport '' -> scene-media searched nothing (no-sport).
//   2. Subject: "Then Dak Prescott was sacked" made the subject "Then Dak
//      Prescott" (no post names that, no search finds it).
//   3. Team clips: the ladder's team rung found team clips, but the judge
//      only rated them against the player (5-6/10) and the gate refused them.
//   4. "Find clips" (broaden) never reached the server: the same search ran again.
//   5. The page loaded clips with a direct fetch only (no proxy fallback).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.AI_GATEWAY_API_KEY = 'gw-test';
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const C = require('../reel-clips.js');
const SRC = require('../netlify/functions/_reel-sourcing.js');
const LIB = require('../netlify/functions/_reel-clip-confirmed.js');
const D4 = require('../netlify/functions/_reel-director4.js');
const SPORT = require('../netlify/functions/_reel-sport.js');
const RS = require('../reel-sourcing.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}

const DALLAS = 'Dallas blew a 21-point lead. The Cowboys were up 21 with nine minutes left. Then Dak Prescott was sacked on fourth and one. The Eagles kicked a 59-yard field goal with two seconds left. Was it the play call or the players? Cowboys fans, your call.';
const KITTLE = "George Kittle shouldn't be this good again. He tore his Achilles last season. Only 1 in 3 tight ends return to 90 percent. Kittle has 6 touchdowns in 8 games. The 49ers are 9-1 with him on the field. Is he the best tight end in football?";
const LAKERS = 'LeBron James scored 40 points for the Lakers last night. He is 41 years old. Nobody has done that at his age. Is this the best old-man season ever?';

// The code plan exactly as the server builds it for forceCode / AI off.
const codePlan = script => { const read = D4.readV4({ script }); return D4.scriptToV4(script, { esStyle: 'breakdown', read, team: read.team, sport: read.sport }); };
const allBeats = plan => plan.chapters.flatMap(c => c.beats);

// Team-account game clips that never name the player (what the team rung finds).
const teamClip = (id, team, handle) => ({ url: `https://x.com/${handle}/status/${id}`, handle, text: `${team.split(' ').pop()} drive in the 4th quarter`, source: 'official', ageHours: 20, durationMs: 14000, shortSide: 720, teams: [team], variants: [{ url: `https://video.twimg.com/${id}.mp4`, width: 720, height: 1280 }] });
const photo = name => ({ url: `/api/es-image-search?image=${name}`, sourceUrl: `https://image-cdn.essentiallysports.com/${name}.jpg`, title: name, verified: true, verifiedBy: 'vision', focus: { x: 0.3, y: 0.1, w: 0.4, h: 0.6 } });

function deps({ calls, byTeam = {}, photosBy = {} }) {
  calls.find = [];
  return {
    teams: require('../video-ads-teams.js'),
    judgeCache: new Map(),
    log: line => { calls.log = line; },
    gateway: { gatewayConfigured: () => true, featureDisabled: () => false, aiText: async () => ({ text: '{}', cost: 0 }) },
    confirmed: { keysFor: LIB.keysFor, read: async () => [] },
    findClips: async (body, track) => {
      calls.find.push({ sport: body.sport, subject: body.subject.name, query: body.query || '', team: body.team || '', windowHours: body.windowHours || 0, live: !track.freeOnly });
      return { ok: true, clips: body.team ? (byTeam[body.team] || []) : [], cost: track.freeOnly ? 0 : 0.04 };
    },
    findPhotos: async args => ({ ok: true, photos: photosBy[args.person || args.team || args.query] || [], cost: 0 }),
    verifyWithVision: async () => ({ verdicts: new Map(), cost: 0 }),
  };
}

await test('sport + team from a script with a nickname and sport words (Kittle / 49ers); none for an NBA script', () => {
  assert.equal(SPORT.inferSport(KITTLE).sport, 'nfl');
  assert.equal(SPORT.inferSport(KITTLE).team.name, 'San Francisco 49ers');
  assert.equal(SPORT.inferSport('Aaron Judge homered twice and drove in five RBIs').sport, 'mlb');
  assert.equal(SPORT.inferSport('The Giants lost again').sport, '', 'a nickname two sports share decides nothing alone');
  assert.equal(SPORT.inferSport('The Kansas City Chiefs won').team.name, 'Kansas City Chiefs', 'full names first: never "Kansas"');
  assert.equal(SPORT.inferSport(LAKERS).sport, '', 'no clip sport: honest needs-clips later');
  const plan = codePlan(KITTLE);
  assert.equal(plan.sport, 'nfl');
  assert.equal(plan.team && plan.team.name, 'San Francisco 49ers');
  assert.ok(allBeats(plan).filter(b => b.media && b.media.kind === 'clip').every(b => b.media.subject.team === 'San Francisco 49ers'));
});

await test('subjects: "Then Dak Prescott was sacked" names Dak Prescott; a team name is a team subject', () => {
  const plan = codePlan(DALLAS);
  const names = new Set(allBeats(plan).filter(b => b.media && b.media.subject).map(b => b.media.subject.name));
  assert.ok(names.has('Dak Prescott'), [...names].join(', '));
  assert.ok(![...names].some(n => /^then\b/i.test(n)), [...names].join(', '));
  const t = D4.scriptToV4('The Dallas Cowboys lost again. The Dallas Cowboys need a new coach.', { sport: 'nfl' });
  const sub = allBeats(t).find(b => b.media && b.media.subject).media.subject;
  assert.equal(sub.type, 'team');
});

for (const [label, script, team, handle] of [['Dallas', DALLAS, 'Dallas Cowboys', 'dallascowboys'], ['Kittle', KITTLE, 'San Francisco 49ers', '49ers']]) {
  await test(`${label}: a typical brief asks for clips, the team rung's clips pass the team gate, and no beat is static (server + browser, mocked)`, async () => {
    const plan = codePlan(script);
    // A plan the page built (no sport on it) must still search: sport from its words.
    const pagePlan = { ...plan, sport: '', team: null };
    const calls = {};
    const clips = [1, 2, 3].map(i => teamClip(`${label}-${i}`, team, handle));
    const d = deps({ calls, byTeam: { [team]: clips }, photosBy: { [team]: [photo('team')], 'Dak Prescott': [photo('dak')], 'George Kittle': [photo('kittle')] } });
    const server = body => SRC.sceneMedia(body, { deps: d, aiAllowed: true });
    const first = await server({ plan: RS._test.slimPlan(pagePlan) });
    assert.equal(first.sport, 'nfl', 'sport from the plan words');
    assert.ok(calls.find.length >= 1, 'at least one clip request');
    assert.ok(calls.find.some(c => c.team === team), 'the team rung ran');
    assert.ok(first.subjects.some(s => s.type === 'team' && s.label === team), 'the team is judged as its own subject');
    assert.ok(first.judgeQueue.length >= 1, 'clips queued for the judge');

    // Browser: mediaFor with the real server and a judge that sees the team, not the player.
    RS._test.reset();
    const teamKey = C.subjectKey({ name: team });
    const sent = [];
    const api = async body => {
      sent.push(body.mode);
      if (body.mode === 'scene-media') return server(body);
      if (body.mode === 'clip-judge') {
        const judgements = {};
        body.clips.forEach(c => { const rel = {}; body.subjects.forEach(s => { rel[s.key] = s.key === teamKey ? 8 : 5; }); judgements[c.url] = { kind: 'game-action', quality: 8, action: [3, 9, 4], relevance: rel }; });
        return { ok: true, judgements, cost: 0.004 };
      }
      return { ok: true };
    };
    const video = { duration: 14 };
    const sample = async () => ({ frames: ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,AAAA'], times: [2, 7, 12], samples: [{ t: 2, motion: 0.4 }, { t: 7, motion: 0.9 }, { t: 12, motion: 0.3 }] });
    const out = await RS.mediaFor(pagePlan, 'breakdown', { api, loadVideo: async () => video, sampleClip: sample, ai: true });
    assert.ok(sent.includes('clip-judge'), 'the judge ran');
    assert.ok(out.clipCount >= 1, `clips on the reel: ${out.clipCount}`);
    assert.equal(out.needsClips, false);
    const picks = Object.values(out.beats).map(b => b.pick);
    const teamPicks = picks.filter(p => p.kind === 'clip');
    assert.ok(teamPicks.every(p => p.gate === 'team' && p.label === team.toUpperCase().slice(0, 22)), 'team footage is labelled with the team, not the player');
    Object.entries(out.beats).forEach(([id, b]) => assert.notEqual(b.motion, 'none', `beat ${id} is static`));
    assert.equal(out.motionOk, true);
  });
}

await test('wants cutout is treated like photo (a verified photo with Ken Burns)', () => {
  const sub = { type: 'player', name: 'Dak Prescott', team: 'Dallas Cowboys', key: 'dak prescott' };
  const picks = C.gatedPicks([{ beatId: 'x', beat: { id: 'x' }, subject: sub, wants: 'cutout', kind: 'cutout', clips: [], photos: [photo('dak')], teamPhotos: [] }], { judgeAvailable: true });
  assert.equal(picks.x.kind, 'cutout');
  assert.ok(picks.x.kenBurns);
});

await test('"Find clips" reaches the server: broaden is forwarded; the server runs every rung, one more live search and a wider window', async () => {
  RS._test.reset();
  const bodies = [];
  await RS.mediaFor(codePlan(DALLAS), 'breakdown', { api: async b => { bodies.push(b); return { ok: true, beats: [], subjects: [], judgeQueue: [] }; }, broaden: true });
  assert.equal(bodies[0].broaden, true);
  assert.equal(bodies[0].ladder, 'broad');
  const calls = {};
  const plan = codePlan(KITTLE);
  const normal = await SRC.sceneMedia({ plan }, { deps: deps({ calls }), aiAllowed: true });
  const liveNormal = calls.find.filter(c => c.live).length;
  const broad = await SRC.sceneMedia({ plan, broaden: true }, { deps: deps({ calls }), aiAllowed: true });
  const liveBroad = calls.find.filter(c => c.live).length;
  assert.equal(normal.broad, false);
  assert.equal(broad.broad, true);
  assert.ok(liveBroad <= SRC.LIMITS.liveSearches + SRC.LIMITS.broadExtraSearches);
  assert.ok(liveBroad >= liveNormal);
  assert.ok(calls.find.every(c => c.windowHours >= 21 * 24), 'the wider window on every rung');
});

await test('no clip sport (NBA): the reel says it needs clips and why, offers Find clips, and every beat still moves (photos)', async () => {
  RS._test.reset();
  const plan = codePlan(LAKERS);
  const calls = {};
  const d = deps({ calls, photosBy: { 'LeBron James': [photo('lebron')] } });
  const out = await RS.mediaFor(plan, 'breakdown', { api: body => (body.mode === 'scene-media' ? SRC.sceneMedia(body, { deps: d, aiAllowed: true }) : { ok: true }), loadVideo: async () => null, ai: true });
  assert.equal(calls.find.length, 0, 'nothing to search');
  assert.equal(out.needsClips, true);
  assert.equal(out.actions[0].action, 'find-clips');
  assert.ok(out.notes.some(n => /names no NFL, college football or MLB/.test(n)), out.notes.join(' | '));
  Object.entries(out.beats).forEach(([id, b]) => assert.notEqual(b.motion, 'none', `beat ${id} is static`));
});

await test('the page loads clips through ReelSourcing.fetchClip (direct, then the same-origin proxy)', async () => {
  assert.equal(typeof RS.fetchClip, 'function');
  const fs = require('node:fs');
  const page = fs.readFileSync(new URL('../reel-maker.js', import.meta.url), 'utf8');
  assert.match(page, /SRC\(\)\.fetchClip\(variant\.url\)/, 'loadClip falls back to the proxy');
  const got = await RS._test.fetchClipFile('https://video.twimg.com/a.mp4', { fetchImpl: async () => { throw new TypeError('cors'); }, proxy: async (url, start) => ({ bytes: new Uint8Array(start ? 0 : 10), total: 10 }) });
  assert.equal(got.via, 'proxy');
});

console.log(`\n${passed} Reels v5 clips tests passed.`);
