#!/usr/bin/env node
// Generate v5 photos (gen5-photos): the right person, as the main subject,
// never an opponent, a reporter or a namesake (_photo-verify.js, _imagery.js
// rankFor / findSubjectPhotos, the asset service wiring, the composer's
// resolvePhotos / photoKey / distinctPhotos and the plan's photo contract).
// Offline: fetch is mocked, the vision model is mocked, and the labelled set
// (scripts/fixtures/gen5-photo-labels.json, real ES captions and titles
// labelled by eye) runs through the real text checks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.GEN_ASSETS_STORAGE = 'off';
delete process.env.AI_GATEWAY_API_KEY;
delete process.env.GENERATE_PHOTO_VERIFY_TIER;
globalThis.fetch = async url => { throw new Error(`unexpected network call: ${url}`); };

const V = require('../netlify/functions/_photo-verify.js');
const I = require('../netlify/functions/_imagery.js');
const BASE = 'https://image-cdn.essentiallysports.com/wp-content/uploads';
const allen = { name: 'Josh Allen', kind: 'person' };
const media = (caption, file, extra = {}) => ({ source: 'es-media', sourceUrl: `${BASE}/${file}.jpg`, url: `/api/es-image-search?image=${file}`, title: extra.title || '', caption, width: 2048, height: 1365, matched: 'person', ...extra });
const article = (title, file) => ({ source: 'es-article', sourceUrl: `${BASE}/${file}.jpg`, url: `/p/${file}`, title, caption: '', width: 2048, height: 1365, matched: 'person' });

// ─── 1. Text evidence: the live Josh Allen failures, as classes ───────────
{
  const ev = (photo, subject = allen) => V.evidence(photo, subject);
  // An opponent leads the caption (Mahomes pats Allen): about someone else.
  let e = ev(media('KANSAS CITY, MO - OCTOBER 16: Kansas City Chiefs quarterback Patrick Mahomes 15 pats Buffalo Bills quarterback Josh Allen 17 on the head after an NFL game', 'imago1016465675'));
  assert.equal(e.lead, 'other');
  assert.equal(e.leadName, 'Patrick Mahomes');
  // A namesake: "Josh Hines-Allen" is not Josh Allen.
  e = ev(media('JACKSONVILLE, FL - JANUARY 11: Josh Hines-Allen 41 of the Jacksonville Jaguars sacks Josh Allen 17 of the Buffalo Bills during the AFC Wildcard Playoff game', 'imago1071192871'));
  assert.equal(e.lead, 'other');
  assert.ok(!V.isPerson('Josh Hines-Allen', 'Josh Allen'));
  assert.ok(V.isPerson('Shai Gilgeous Alexander', 'Shai Gilgeous-Alexander'));
  assert.ok(V.isPerson('VERSTAPPEN Max', 'Max Verstappen'), 'surname-first agency style');
  // The person leads, a reporter shares the frame: verified but not the main subject.
  e = ev(media('INGLEWOOD, CA - OCTOBER 12: Josh Allen 17 of the Buffalo Bills is interviewed by MNF sideline reporter Laura Rutledge following an NFL game', 'imago1084470006h'));
  assert.equal(e.lead, 'subject');
  assert.deepEqual(e.others, ['Laura Rutledge']);
  assert.equal(e.team, 'Buffalo Bills');
  // A venue in the caption is not a second person.
  e = ev(media('DENVER, CO - JANUARY 17: Buffalo Bills quarterback Josh Allen 17 runs onto the field to warm up before the AFC Divisional Round game against the Denver Broncos at Empower Field at Mile High on January 17, 2026 in Denver, Colorado.', 'imago1071448009'));
  assert.equal(e.named, 'caption');
  assert.deepEqual(e.others, []);
  assert.equal(e.team, 'Buffalo Bills');
  // The photographer credit after the first sentence names nobody in the frame.
  e = ev(media('January 11, 2026: Buffalo Bills quarterback Josh Allen 17 in the first half of a wild card game against the Jacksonville Jaguars in Jacksonville, FL. Romeo T Guzman/CSM', 'imago1071168007'));
  assert.deepEqual(e.others, []);
  // ES article lead images: the headline's lead person.
  assert.equal(ev(article('NFL Week 11 MVP Ladder: Patrick Mahomes Re-Enters the Mix', 'USATSI_27252598')).lead, 'other');
  assert.equal(ev(article("ESPN's Laura Rutledge Fires Back at Criticism after Fellow Broadcaster Defends Her", 'imago1070682638')).lead, 'other');
  assert.equal(ev(article('“If That Was Josh Allen”: Aaron Glenn Seemingly Calls Out Refs Over Double Standards', 'imago1064527878')).lead, 'other', 'a name inside a quote is not the subject');
  e = ev(article("“We're Not Playing Our Best Football”: Josh Allen Issues Blunt Verdict After Jets Game", 'imago1083341848h'));
  assert.equal(e.named, 'title');
  assert.equal(ev(article("Josh Allen's Wife Hailee Shares Proud 4-Word Message", 'imago1058572009')).relation, true, 'a story about his wife');
  const judge = ev(article("Aaron Judge Reportedly Gave Jazz Chisholm Jr. Stern Warnings, but Yankees Insider Says", 'Jazz-Chisholm-Jr-with-team'), { name: 'Aaron Judge', kind: 'person' });
  assert.deepEqual(judge.others, ['Jazz Chisholm'], 'a second person the headline is about');
  // Short media titles and file names with two people.
  assert.deepEqual(ev({ source: 'es-media', sourceUrl: `${BASE}/d07.jpg`, title: 'Lamar Jackson Joe Burrow', caption: 'IMAGO' }, { name: 'Joe Burrow', kind: 'person' }).others, ['Lamar Jackson']);
  assert.deepEqual(ev({ source: 'es-media', sourceUrl: `${BASE}/Stephen-Curry-Draymond-Green-5.jpg`, title: '', caption: 'Credits: Imago' }, { name: 'Stephen Curry', kind: 'person' }).others, ['Draymond Green']);
  // Nobody named at all.
  assert.equal(ev({ source: 'es-media', sourceUrl: `${BASE}/Untitled-design-647-14.jpg`, title: '', caption: 'Credits: IMAGO' }).named, '');
}

// ─── 2. decide(): never a guess, never an opponent ───────────────────────
{
  const facts = { team: 'Buffalo Bills', briefTeams: ['Buffalo Bills', 'Kansas City Chiefs'], opponents: ['Kansas City Chiefs'] };
  const d = (photo, v = null, subject = allen, f = facts) => V.decide(photo, subject, V.evidence(photo, subject), v, f);
  assert.match(d(media('Kansas City Chiefs quarterback Patrick Mahomes 15 warms up', 'a1')).drop, /Patrick Mahomes/);
  assert.equal(d(media('Buffalo Bills quarterback Josh Allen 17 runs with the ball', 'a2')).verified, true);
  assert.equal(d(media('Buffalo Bills quarterback Josh Allen 17 runs with the ball', 'a2')).main, true);
  const noName = d({ source: 'es-media', sourceUrl: `${BASE}/Untitled.jpg`, title: '', caption: 'Credits: IMAGO' });
  assert.equal(noName.verified, false, 'no evidence: not the person');
  // A namesake on another team (Lamar Jackson 38 of the Atlanta Falcons) is not verified.
  const lamar = { name: 'Lamar Jackson', kind: 'person' };
  const falcons = d(media('ATLANTA, GA - AUGUST 08: Lamar Jackson 38 of the Atlanta Falcons wraps up Jackson Meeks', 'f1'), null, lamar, { team: 'Baltimore Ravens', briefTeams: [], opponents: [] });
  assert.equal(falcons.verified, false);
  assert.equal(falcons.otherTeam, 'Atlanta Falcons');
  // In an opponent's uniform: dropped outright.
  assert.match(d(media('Josh Allen 17 of the Kansas City Chiefs warms up', 'k1')).drop, /opponent/);
  // Vision: "no" drops even a named photo; "yes" verifies an unnamed one; a reporter is never the subject.
  const named = media('Buffalo Bills quarterback Josh Allen 17 runs with the ball', 'v1');
  const row = extra => ({ match: 'yes', evidence: 'Bills #17', people: 1, main: true, role: 'player', kind: 'action', focus: { x: 0.3, y: 0.1, w: 0.4, h: 0.8 }, cutout: true, quality: 4, graphic: false, ...extra });
  assert.match(d(named, row({ match: 'no', evidence: 'Chiefs #15' })).drop, /not Josh Allen/);
  const unnamed = { source: 'es-media', sourceUrl: `${BASE}/Untitled.jpg`, title: '', caption: 'Credits: IMAGO' };
  const yes = d(unnamed, row());
  assert.equal(yes.verified, true);
  assert.equal(yes.verifiedBy, 'vision');
  assert.deepEqual(yes.focus, { x: 0.3, y: 0.1, w: 0.4, h: 0.8 });
  assert.equal(yes.cutoutOk, true);
  assert.match(d(unnamed, row({ match: 'unsure', role: 'reporter' })).drop, /reporter/);
  assert.equal(d(unnamed, row({ match: 'unsure' })).verified, false, 'unsure + no text evidence: not verified');
  assert.equal(d(named, row({ match: 'unsure' })).verified, true, 'unsure + the caption names them: verified');
  const group = d(named, row({ main: false, people: 4 }));
  assert.equal(group.main, false);
  assert.equal(group.cutoutOk, false, 'no cut-out from a crowded frame');
}

// ─── 3. Teams and leagues: a person of that team, or the league named ─────
{
  const lions = { name: 'Lions', kind: 'team', full: 'Detroit Lions' };
  const te = caption => V.teamEvidence({ source: 'es-media', sourceUrl: `${BASE}/x.jpg`, title: '', caption }, lions);
  assert.equal(te('DETROIT, MI - OCTOBER 25: Green Bay Packers wide receiver Christian Watson 9 makes a wide open catch and then is tackled by Detroit Lions safety Chuck Clark 36').lead, 'other');
  assert.equal(te('Drake Maye 10 New England Patriots injured, New England Patriots vs. Detroit Lions, American Football').lead, 'other');
  assert.equal(te('DETROIT, MI - SEPTEMBER 13: Detroit Lions running back Jahmyr Gibbs 0 tries to escape a tackle').named, 'caption');
  assert.equal(te('97 Aidan Hutchinson EDGE Detroit Lions, New England Patriots vs Detroit Lions').named, 'caption');
  assert.equal(V.teamEvidence(article('NFL League Meetings Takeaways: Draft Hints from Lions', 'x'), lions).named, '', 'an article image is not checked against the team');
  const liv = { name: 'LIV Golf', kind: 'league' };
  const le = caption => V.teamEvidence({ source: 'es-media', sourceUrl: `${BASE}/y.jpg`, title: '', caption }, liv);
  assert.equal(le('May 10, 2026: Graeme McDowell hits from the 8th tee box during the final round of the LIV Golf Virginia').named, 'caption');
  assert.equal(le('HOYLAKE, ENGLAND - JUNE 15: Connor Graham of Scotland plays from the third tee during Qualifying Round 2 of The Amateur Championship').named, '', 'any golfer is not a LIV golfer');
  assert.equal(le("AUG 23, 2026: Rory McIlroy's 2026 season has reached an uncomfortable point").named, '');
  assert.equal(V.sameTeam('Bills', 'Buffalo Bills'), true);
  assert.equal(V.sameTeam('Lions', 'Green Bay Packers'), false);
}

// ─── 4. The labelled set (real ES captions, labelled by eye) ──────────────
// Ratchet: wrong-person photos kept anywhere in a subject's list, and in the
// five the composer keeps. Before gen5: 63 kept / 14 in the top five.
const SET = JSON.parse(fs.readFileSync(new URL('./fixtures/gen5-photo-labels.json', import.meta.url), 'utf8'));
{
  assert.ok(SET.subjects.length >= 20, '20+ subjects');
  assert.ok(SET.subjects.filter(s => s.person).length >= 10, '10+ named players');
  assert.ok(SET.subjects.some(s => s.kind === 'league' && /LIV/.test(s.brief)), 'a league story with no named person (LIV)');
  let keptWrong = 0;
  let topWrong = 0;
  let topNotMain = 0;
  let keptMain = 0;
  const C = require('../netlify/functions/_composer.js');
  for (const s of SET.subjects) {
    const subject = s.person ? { name: s.person, kind: 'person', ...C.photoFactsFor(C.readCreative(s.brief, {}), s.person) } : { name: s.league, kind: s.kind, full: s.full || '' };
    const pool = s.photos.map(p => ({ ...p, url: `/x/${p.n}`, matched: s.person ? 'person' : 'team' }));
    const res = await I.rankFor(subject, pool, { allowed: () => true, probe: async () => null, probeDeadlineMs: 5 }, {}, { allowVision: false });
    const label = new Map(s.photos.map(p => [p.sourceUrl, p.label]));
    res.ranked.forEach(p => { if (['A', 'X'].includes(label.get(p.sourceUrl))) keptWrong += 1; if (label.get(p.sourceUrl) === 'M') keptMain += 1; });
    const top = I.diversify(res.ranked, 6).slice(0, 5);
    top.forEach(p => { if (['A', 'X'].includes(label.get(p.sourceUrl))) topWrong += 1; if (label.get(p.sourceUrl) === 'P') topNotMain += 1; });
    assert.ok(res.ranked.every(p => p.verified === true && p.verifiedBy), `${s.id}: every kept photo is verified`);
    if (s.id === 'josh-allen') {
      const urls = res.ranked.map(p => p.sourceUrl);
      [1, 4, 11, 12, 13].forEach(n => assert.ok(!urls.includes(s.photos[n].sourceUrl), `Josh Allen: photo ${n} (${s.photos[n].who || 'wrong'}) never kept`));
      assert.ok(res.team === 'Buffalo Bills', `the captions agree he plays for the Bills: ${res.team}`);
      assert.deepEqual(res.opponents, ['Kansas City Chiefs']);
    }
  }
  console.log(`labelled set: wrong-person kept ${keptWrong}, top-5 wrong ${topWrong}, top-5 not main ${topNotMain}, main photos kept ${keptMain}`);
  assert.ok(keptWrong <= 3, `wrong-person photos kept: ${keptWrong}`);
  assert.ok(topWrong <= 2, `wrong-person photos in the top five: ${topWrong}`);
  assert.ok(topNotMain <= 12, `not-the-main-subject photos in the top five: ${topNotMain}`);
  assert.ok(keptMain >= 130, `enough right-person photos survive: ${keptMain}`);
}

// ─── 5. Vision: one call per subject, Sonnet, facts in the prompt, cached ──
{
  V.VERDICTS.clear();
  const calls = [];
  const gateway = {
    aiText: async args => {
      calls.push(args);
      const n = args.messages[0].content.filter(c => c.type === 'image').length;
      return { text: JSON.stringify({ photos: Array.from({ length: n }, (_, i) => ({ n: i + 1, match: i === 0 ? 'no' : 'yes', evidence: i === 0 ? 'Chiefs #15' : 'Bills #17', people: 1, main: true, role: 'player', kind: 'action', box: [0.2, 0.1, 0.5, 0.8], cutout: true, quality: 4 })) }), cost: 0.021 };
    },
  };
  const subject = { name: 'Josh Allen', kind: 'person', team: 'Buffalo Bills', teamColors: ['#00338D', '#D50A0A'], number: 17, opponents: ['Kansas City Chiefs'], others: ['Patrick Mahomes'] };
  const photos = [1, 2, 3].map(i => media(`Buffalo Bills quarterback Josh Allen 17 photo ${i}`, `imago10000${i}`));
  const res = await V.verifyWithVision(subject, photos, { gateway, track: { email: 'a@essentiallysports.com' } });
  assert.equal(calls.length, 1, 'one call for the subject');
  assert.equal(calls[0].tier, 'best', 'Sonnet by default (accuracy first)');
  assert.equal(calls[0].track.feature, 'generate-photo-pick', 'logged under the photo feature');
  const prompt = calls[0].messages[0].content[0].text;
  assert.match(prompt, /Do not identify anyone from their face/);
  assert.match(prompt, /Buffalo Bills/);
  assert.match(prompt, /jersey number 17/);
  assert.match(prompt, /Kansas City Chiefs/);
  assert.match(prompt, /Patrick Mahomes/);
  const images = calls[0].messages[0].content.filter(c => c.type === 'image').map(c => c.source.url);
  assert.ok(images.every(u => /width=1024/.test(u)), 'smaller images for the check');
  assert.ok(calls[0].messages[0].content.some(c => c.type === 'text' && /caption: Buffalo Bills quarterback/.test(c.text)), 'each photo goes with its caption');
  assert.equal(res.cost, 0.021);
  assert.equal(res.verdicts.size, 3);
  assert.deepEqual([...res.verdicts.values()][1].focus, { x: 0.2, y: 0.1, w: 0.5, h: 0.8 });
  const again = await V.verifyWithVision(subject, photos, { gateway });
  assert.equal(calls.length, 1, 'verdicts cached per photo');
  assert.equal(again.cost, 0);
  // A failing call: no verdicts, no throw (the text checks still decide).
  V.VERDICTS.clear();
  const broken = await V.verifyWithVision(subject, photos, { gateway: { aiText: async () => { throw new Error('timeout'); } } });
  assert.equal(broken.verdicts.size, 0);
  assert.equal(broken.called, false);
  process.env.GENERATE_PHOTO_VERIFY_TIER = 'main';
  V.VERDICTS.clear();
  await V.verifyWithVision(subject, photos, { gateway });
  assert.equal(calls[calls.length - 1].tier, 'main', 'the tier can be lowered by env');
  delete process.env.GENERATE_PHOTO_VERIFY_TIER;
}

// ─── 6. findSubjectPhotos with the verifier: the contract fields ─────────
{
  V.VERDICTS.clear();
  const pool = [
    { id: 1, sourceUrl: `${BASE}/imago200001.jpg`, title: '', caption: 'Buffalo Bills quarterback Josh Allen 17 runs with the ball against the Miami Dolphins', width: 2400, height: 1600 },
    { id: 2, sourceUrl: `${BASE}/imago200002.jpg`, title: '', caption: 'Kansas City Chiefs quarterback Patrick Mahomes 15 warms up', width: 2400, height: 1600 },
    { id: 3, sourceUrl: `${BASE}/imago200003.jpg`, title: '', caption: 'Credits: IMAGO', width: 2400, height: 1600 },
    { id: 4, sourceUrl: `${BASE}/imago200004.jpg`, title: '', caption: 'Buffalo Bills quarterback Josh Allen 17 celebrates a touchdown', width: 2400, height: 1600 },
    { id: 5, sourceUrl: `${BASE}/imago200005.jpg`, title: '', caption: 'Buffalo Bills quarterback Josh Allen 17 looks on', width: 2400, height: 1600 },
  ];
  let seen = [];
  const deps = {
    allowed: () => true, probe: async () => null, probeDeadlineMs: 5, tags: async () => [],
    agency: async q => (q === 'Josh Allen' ? pool : []), media: async () => [], articles: async () => [],
    verify: async (subject, photos) => {
      seen = photos.map(p => p.sourceUrl);
      assert.equal(subject.team, 'Buffalo Bills', 'the verifier gets the consensus team');
      assert.deepEqual(subject.opponents, ['Kansas City Chiefs']);
      assert.ok(subject.teamColors.length >= 2);
      const v = new Map();
      photos.forEach(p => {
        const stem = I._test.photoStem(p.sourceUrl);
        if (/200003/.test(p.sourceUrl)) v.set(stem, { match: 'yes', evidence: 'Bills #17', people: 1, main: true, role: 'player', kind: 'portrait', focus: { x: 0.35, y: 0.05, w: 0.3, h: 0.7 }, cutout: true, quality: 5, graphic: false });
        else if (/200005/.test(p.sourceUrl)) v.set(stem, { match: 'unsure', evidence: 'back to camera', people: 5, main: false, role: 'player', kind: 'group', focus: null, cutout: false, quality: 3, graphic: false });
        else v.set(stem, { match: 'yes', evidence: 'Bills #17', people: 1, main: true, role: 'player', kind: /200004/.test(p.sourceUrl) ? 'celebration' : 'action', focus: { x: 0.2, y: 0.1, w: 0.5, h: 0.85 }, cutout: true, quality: 4, graphic: false });
      });
      return { verdicts: v, cost: 0.02, called: true };
    },
  };
  const res = await I.findSubjectPhotos({ person: 'Josh Allen', teams: ['Buffalo Bills', 'Kansas City Chiefs'], others: [], count: 6 }, { gated: true }, deps);
  assert.ok(!seen.some(u => /200002/.test(u)), 'a photo the caption gives to Mahomes never reaches the model');
  const urls = res.photos.map(p => p.sourceUrl);
  assert.ok(!urls.some(u => /200002/.test(u)), 'never the opponent');
  assert.ok(urls.some(u => /200003/.test(u)), 'an unnamed photo the model confirms is kept');
  assert.ok(!urls.some(u => /200005/.test(u)), 'a crowded frame drops when solo photos exist');
  res.photos.forEach(p => {
    assert.equal(p.verified, true);
    assert.ok(['vision', 'caption', 'title', 'file'].includes(p.verifiedBy));
    assert.ok(['action', 'portrait', 'celebration', 'reaction', 'offfield', 'group', 'crowd', 'venue', 'object'].includes(p.shot), p.shot);
    assert.equal(p.main, true);
  });
  assert.deepEqual(res.photos.find(p => /200003/.test(p.sourceUrl)).focus, { x: 0.35, y: 0.05, w: 0.3, h: 0.7 });
  assert.equal(res.photos.find(p => /200004/.test(p.sourceUrl)).shot, 'celebration');
  assert.equal(res.cost, 0.02);
  assert.equal(res.subject.team, 'Buffalo Bills');
  // Free mode (the spend gate refuses): text checks only, still no wrong person.
  const free = await I.findSubjectPhotos({ person: 'Josh Allen', teams: ['Buffalo Bills', 'Kansas City Chiefs'], count: 6 }, {}, { ...deps, gate: async () => ({ reason: 'weekly-limit' }) });
  assert.equal(free.cost, 0);
  assert.ok(!free.photos.some(p => /20000[23]/.test(p.sourceUrl)), 'free mode: no opponent, no unnamed photo');
  assert.ok(free.photos.every(p => p.verifiedBy === 'caption'));
  // A league subject: only photos tied to the league.
  const liv = await I.findSubjectPhotos({ team: 'LIV Golf', count: 6 }, {}, {
    allowed: () => true, probe: async () => null, probeDeadlineMs: 5, tags: async () => [], articles: async () => [], media: async () => [],
    agency: async () => [
      { id: 'l1', sourceUrl: `${BASE}/imago300001.jpg`, caption: 'WESTFIELD, IN - AUGUST 23: Bryson DeChambeau during the Final Round of LIV Golf Indianapolis', width: 2400, height: 1600 },
      { id: 'l2', sourceUrl: `${BASE}/imago300002.jpg`, caption: 'HOYLAKE, ENGLAND - JUNE 15: Connor Graham of Scotland plays from the third tee during The Amateur Championship', width: 2400, height: 1600 },
    ],
  });
  assert.deepEqual(liv.photos.map(p => p.sourceUrl.match(/300\d+/)[0]), ['300001'], 'a golfer with no LIV tie never stands in for LIV');
}

// ─── 7. Asset service wiring: facts reach the check, cache key includes them ──
{
  const A = require('../netlify/functions/_asset-service.js');
  const got = [];
  const ctx = { gated: true, deps: {
    allowed: () => true, probe: async () => null, probeDeadlineMs: 5, tags: async () => [], media: async () => [], articles: async () => [],
    agency: async () => [{ id: 'z1', sourceUrl: `${BASE}/imago400001.jpg`, caption: 'Buffalo Bills quarterback Josh Allen 17 runs', width: 2400, height: 1600 }],
    verify: async (subject, photos) => { got.push(subject); return { verdicts: new Map(), cost: 0, called: false }; },
    storageHas: null,
  } };
  const r1 = await A.findPhotos({ person: 'Josh Allen', teams: ['Buffalo Bills', 'Kansas City Chiefs'], others: ['Patrick Mahomes'] }, ctx);
  assert.equal(r1.photos.length, 1);
  assert.equal(r1.photos[0].verified, true);
  assert.deepEqual(got[0].others, ['Patrick Mahomes']);
  await A.findPhotos({ person: 'Josh Allen', teams: ['Buffalo Bills'], others: [] }, ctx);
  assert.equal(got.length, 2, 'different brief facts are a different cache entry');
}

// ─── 8. Composer: verified photos only, the contract on the plan, one photo per design ──
{
  const C = require('../netlify/functions/_composer.js');
  // photoKey: the same agency frame under another file name is one photo.
  assert.equal(C.photoKey('/api/es-image-search?image=' + encodeURIComponent(`${BASE}/imago1083443391h.jpg?width=2048`)), C.photoKey(`${BASE}/imago1083443391-1536x1024.jpg`));
  assert.notEqual(C.photoKey(`${BASE}/imago1083443391.jpg`), C.photoKey(`${BASE}/imago1083443392.jpg`));
  const read = C.readCreative('Josh Allen goes over 1000+ rushing yards as the Bills beat the Chiefs 30-21.\nSport: NFL', {});
  assert.deepEqual(C.photoFactsFor(read, 'Josh Allen'), { teams: ['Buffalo Bills', 'Kansas City Chiefs'], others: [] });
  // resolvePhotos: unverified photos never become the person's.
  const calls = [];
  const verified = i => ({ url: `/api/es-image-search?image=${encodeURIComponent(`${BASE}/imago5000${i}.jpg`)}`, title: '', person: 'Josh Allen', score: 0.9 - i / 100, verified: true, verifiedBy: 'caption', main: true, shot: i % 2 ? 'action' : 'portrait', kind: 'action', focus: { x: 0.3, y: 0.1, w: 0.4, h: 0.8 }, cutoutOk: true });
  C.setAssetService({
    findPhotos: async args => { calls.push(args); return { ok: true, photos: [...[1, 2, 3, 4, 5].map(verified), { url: '/api/es-image-search?image=mahomes.jpg', person: 'Josh Allen', score: 0.99, verified: false }], cutouts: [], headshots: [], logos: [] }; },
    cutout: async ({ imageUrl }) => ({ ok: true, url: `${imageUrl}-cut.png`, cost: 0 }),
  });
  const photos = await C.resolvePhotos(read, {});
  assert.deepEqual(calls[0].teams, ['Buffalo Bills', 'Kansas City Chiefs'], 'the brief\'s teams go to the check');
  assert.ok(!photos['Josh Allen'].some(p => /mahomes/.test(p.src)), 'an unverified photo is never used');
  assert.ok(photos['Josh Allen'].every(p => p.verified === true && p.focus && ['action', 'portrait'].includes(p.kind)));
  // The plan: photo.verified / kind / focus for the renderer; every design its own photo.
  C.PLAN_CACHE.clear();
  const plan = await C.plan({ brief: read.brief, director: false, want: 4 });
  const withPhoto = plan.directions.filter(d => d.photo);
  assert.ok(withPhoto.length >= 2, 'designs show the person');
  withPhoto.forEach(d => {
    assert.equal(d.photo.verified, true, `${d.id}: verified`);
    assert.equal(d.photo.verifiedBy, 'caption');
    assert.ok(['action', 'portrait'].includes(d.photo.kind), d.photo.kind);
    assert.deepEqual(d.photo.focus, { x: 0.3, y: 0.1, w: 0.4, h: 0.8 });
  });
  const keys = withPhoto.map(d => C.photoKey(d.photo.src));
  assert.equal(new Set(keys).size, keys.length, `one photo per design: ${keys}`);
  // distinctPhotos: two designs on one photo, the person has another: the second moves.
  const assets = { photos, cutouts: {}, art: {}, headshots: [], logos: [] };
  const photoDesigns = plan.directions.filter(d => d.photo && !d.cutout);
  const base = photoDesigns[0] || withPhoto[0];
  const internal = d => ({ ...d, person: 'Josh Allen', photo: photos['Josh Allen'].find(p => C.photoKey(p.src) === C.photoKey(d.photo.src)), factIds: d.facts, numberFact: '', label: '' });
  const same = [internal(base), { ...internal(base), id: 'dX' }];
  const finish = d => ({ ...d, candidates: [{}], holes: [] });
  const review = { fixed: [] };
  C.distinctPhotos(same, read, assets, { finish, review });
  assert.notEqual(C.photoKey(same[0].photo.src), C.photoKey(same[1].photo.src), 'the repeat moves to another photo');
  assert.equal(review.fixed[0].check, 'same-photo');
  // Only one photo exists: the repeat stays (better than no photo).
  const one = { ...assets, photos: { 'Josh Allen': [same[0].photo] } };
  const pair = [{ ...same[0] }, { ...same[0], id: 'dY' }];
  C.distinctPhotos(pair, read, one, { finish, review: { fixed: [] } });
  assert.equal(C.photoKey(pair[0].photo.src), C.photoKey(pair[1].photo.src));
  C.setAssetService(null);
}

// ─── 9. A league story with no named person: LIV photos only, each design its own ──
{
  const C = require('../netlify/functions/_composer.js');
  C.PLAN_CACHE.clear();
  const liv = SET.subjects.find(s => s.id === 'liv-golf');
  const agency = liv.photos.filter(p => p.source === 'es-media').map(p => ({ id: p.n, sourceUrl: p.sourceUrl, title: p.title, caption: p.caption, width: p.width, height: p.height }));
  const A = require('../netlify/functions/_asset-service.js');
  const deps = { allowed: () => true, probe: async () => null, probeDeadlineMs: 5, tags: async () => [], media: async () => [], articles: async () => [], agency: async () => agency, verify: null, vision: null, storageHas: null };
  C.setAssetService({ findPhotos: args => A.findPhotos(args, { deps }), cutout: async () => ({ ok: false }) });
  const plan = await C.plan({ brief: liv.brief, director: false, want: 4 });
  const label = new Map(liv.photos.map(p => [C.photoKey(p.sourceUrl), p.label]));
  const used = plan.directions.filter(d => d.photo).map(d => C.photoKey(d.photo.src));
  assert.ok(used.length >= 1, 'LIV players photographed at LIV events are used');
  used.forEach(k => assert.equal(label.get(k), 'R', `only photos tied to LIV: ${k} is ${label.get(k)}`));
  assert.equal(new Set(used).size, used.length, `no photo twice in the run: ${used}`);
  plan.directions.filter(d => d.photo).forEach(d => assert.equal(d.photo.verified, true));
  C.setAssetService(null);
}

console.log('test-gen-photo-verify: ok');
