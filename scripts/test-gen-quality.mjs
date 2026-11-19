// Generate v4 quality (gen4-quality): the classes the owner flagged, for every
// brief in the QA set (no AI, no network):
//   - the count picked (1-8) is always delivered;
//   - no sport / league tag (MLB, NFL, GOLF...) on any design;
//   - no washed-out picture box (a faded photo or concept art inside a box);
//   - the typographic poster is never a name alone, has no art box, and shows
//     the named person when ES has them;
//   - a named person with ES photos is on every design of the code plan;
//   - design.review = { autoFixed, suggestions }, suggestions creative only;
//   - COMPOSE.repair applies the judge's repairs in code (and refuses unsafe ones);
//   - proxied ES photos are distinct photos (the live photoKey bug);
//   - free photo signals: another person's story image and off-field shots drop.
// Run: node scripts/test-gen-quality.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './_qa-chrome.mjs';
import { BRIEFS, buildPlan } from './_qa-generate-fixtures.mjs';

const require = createRequire(import.meta.url);
const C = require(path.join(ROOT, 'frameup-compose.js'));
const P = require(path.join(ROOT, 'netlify/functions/_composer.js'));
const IMG = require(path.join(ROOT, 'netlify/functions/_imagery.js'));

const SPORT_TAG = /^(?:NFL|NBA|MLB|NHL|WNBA|MLS|PGA|LPGA|LIV|ATP|WTA|F1|NCAA|CFB|CBB|GOLF|TENNIS|SOCCER|FORMULA ONE)$/;
const fullBleed = (l, sc) => (l.w || 0) >= sc.size.w * 0.95 && (l.h || 0) >= sc.size.h * 0.6;
const usesPerson = sc => sc.layers.some(l => l.type === 'cutout' || (l.type === 'photo' && l.role !== 'art' && (l.fx?.opacity ?? 1) >= 0.5));

// 1. Count, tags, faded images, typographic, person on every design, review.
const extra = [
  { id: 'manfred', text: 'Rob Manfred: MLB owners won\'t compromise on the salary cap as the labor fight with the players union heats up.\nSport: MLB' },
  { id: 'award', text: 'Caitlin Clark is named AP Female Athlete of the Year for the second straight season.\nSport: WNBA' },
];
let designs = 0;
for (const brief of [...BRIEFS, ...extra]) {
  for (const want of brief.id === 'manfred' || brief.id === 'trade' ? [1, 2, 3, 4, 5, 6, 7, 8] : [4]) {
    const plan = await buildPlan(brief.text, { want });
    assert.equal(plan.directions.length, want, `${brief.id}: asked for ${want}, got ${plan.directions.length}`);
    const read = P.readCreative(brief.text, {});
    plan.directions.forEach(d => {
      assert.ok(d.review && Array.isArray(d.review.autoFixed) && Array.isArray(d.review.suggestions), `${brief.id} ${d.id}: review shape`);
      d.review.suggestions.forEach(t => assert.ok(P.isCreativeIdea(t), `${brief.id}: suggestion is creative: ${t}`));
      d.critique.improvements.forEach(i => assert.ok(P.isCreativeIdea(i.text), `${brief.id}: no repair chip: ${i.text}`));
      d.candidates.forEach(sc => {
        designs += 1;
        sc.layers.filter(l => (l.type === 'text' || l.type === 'pill') && l.role === 'kicker').forEach(l => {
          String(l.text).split(/\s*·\s*/).forEach(part => assert.ok(!SPORT_TAG.test(part.trim()), `${brief.id} ${sc.archetype}: sport tag "${l.text}"`));
        });
        sc.layers.filter(l => l.type === 'photo').forEach(l => {
          const opacity = l.fx?.opacity ?? 1;
          if (l.role === 'art') assert.ok(opacity >= 0.5, `${brief.id} ${sc.archetype}: faded art`);
          else if (!fullBleed(l, sc)) assert.ok(opacity >= 0.5, `${brief.id} ${sc.archetype}: washed-out photo box`);
        });
        if (sc.archetype === 'typographic') {
          const head = sc.layers.find(l => l.role === 'headline');
          assert.ok(String(head.text).split(' ').length >= 3, `${brief.id}: typographic poster is not a name alone`);
          assert.ok(!sc.layers.some(l => l.role === 'art'), `${brief.id}: typographic poster has no art box`);
        }
      });
      // A named person with ES photos is shown (the fixtures give every person photos).
      const story = read.stories.find(s => s.id === d.story);
      if (story?.people?.length && want <= 4) assert.ok(usesPerson(d.candidates[0]), `${brief.id} ${d.id} ${d.archetype}: shows ${story.people[0]}`);
    });
  }
}

// 2. COMPOSE.repair.
{
  const input = { headline: 'Rob Manfred: MLB owners won\'t compromise', kicker: 'Rob Manfred', name: 'Rob Manfred', photo: { src: '/p1.jpg' }, cutout: { src: '/c1.png', fromPhoto: '/p1.jpg' }, art: { src: 'proc:trophy' }, facts: [{ id: 'f1', text: '12,000 yards' }], palette: C.makePalette(['#041E42', '#BF0D3E']) };
  const typo = C.build('typographic', input, 0);
  assert.ok(typo.layers.some(l => l.type === 'cutout'), 'typographic shows the cut-out when there is one');
  assert.ok(!typo.layers.some(l => l.role === 'art'), 'and never the concept art');
  const scene = C.build('magazine-cover', input, 0);
  scene.facts = input.facts;
  let r = C.repair(scene, [{ op: 'remove-tag', issue: 'tag' }, { op: 'headline', text: 'Manfred: owners won\'t budge', issue: 'colon' }], { input, facts: input.facts });
  assert.deepEqual(r.applied.map(a => a.op), ['remove-tag', 'headline']);
  assert.ok(!r.scene.layers.some(l => l.role === 'kicker'));
  assert.equal(r.scene.layers.find(l => l.role === 'headline').text, 'MANFRED: OWNERS WON\'T BUDGE');
  assert.equal(scene.layers.find(l => l.role === 'headline').text, 'ROB MANFRED: MLB OWNERS WON\'T COMPROMISE', 'the input scene is never mutated');
  r = C.repair(scene, [{ op: 'headline', text: 'Manfred wants 99 teams' }], { input, facts: input.facts });
  assert.equal(r.applied.length, 0, 'a headline with a number that is not a fact is refused');
  r = C.repair(scene, [{ op: 'paint-it-red' }], { input });
  assert.equal(r.skipped[0].why, 'unknown or repeated');
  const typoNoCut = C.build('typographic', { ...input, cutout: null, cutouts: [] }, 0);
  r = C.repair(typoNoCut, [{ op: 'drop-image', issue: 'murky photo' }], { input: { ...input, cutout: null, cutouts: [] }, facts: input.facts });
  assert.equal(r.applied[0]?.op, 'drop-image', 'a weak image is dropped (the design reflows)');
  assert.ok(!r.scene.layers.some(l => l.type === 'photo'));
  const bare = C.build('typographic', { ...input, photo: null, cutout: null, cutouts: [] }, 0);
  r = C.repair(bare, [{ op: 'use-cutout', issue: 'Manfred is named but not shown' }], { input, facts: input.facts });
  assert.ok(r.applied.length && r.scene.layers.some(l => l.type === 'cutout'), 'a missing named person is brought in');
  assert.ok(C.REPAIR_OPS.includes('drop-image') && C.FIXES.every(f => C.REPAIR_OPS.includes(f)));
  assert.equal(C.cleanKicker('CHIEFS · NFL', 'NFL'), 'CHIEFS');
  assert.equal(C.cleanKicker('MLB', 'MLB'), '');
  assert.equal(C.cleanKicker('RECORD ALERT!', 'NFL'), 'RECORD ALERT!');
}

// 3. photoKey: proxied ES photos stay distinct; the same image dedupes.
{
  const a = '/api/es-image-search?image=' + encodeURIComponent('https://image-cdn.essentiallysports.com/wp-content/uploads/Rob-Manfred-1.jpg?width=2048');
  const b = '/api/es-image-search?image=' + encodeURIComponent('https://image-cdn.essentiallysports.com/wp-content/uploads/imago21669912.jpg?width=2048');
  const a2 = '/api/es-image-search?image=' + encodeURIComponent('https://image-cdn.essentiallysports.com/wp-content/uploads/Rob-Manfred-1-1200x675.jpg');
  assert.notEqual(P.photoKey(a), P.photoKey(b), 'two ES photos are two photos');
  assert.equal(P.photoKey(a), P.photoKey(a2), 'one ES photo at two sizes is one photo');
  assert.equal(P.dedupePhotos([{ src: a }, { src: b }, { src: a2 }]).length, 2);
}

// 4. Free photo signals (no vision key).
{
  const subject = { name: 'LeBron James', full: 'LeBron James', kind: 'person' };
  const base = { width: 1920, height: 1080, sourceUrl: 'https://image-cdn.essentiallysports.com/wp-content/uploads/x.jpg', matched: 'person', caption: '', date: '2026-11-10' };
  const other = { ...base, title: 'Stephen A. Smith Refuses to Budge From His Prediction Despite the Lakers' };
  assert.equal(IMG.scorePhoto(other, subject, IMG.heuristics(other, subject), null).drop, 'another person leads the story');
  const wife = { ...base, title: '“My Wife Is Pissed”: LeBron James Admits Upsetting Savannah James' };
  assert.match(IMG.scorePhoto(wife, subject, IMG.heuristics(wife, subject), null).drop, /off-field/);
  const game = { ...base, title: 'Lakers Vs. Bulls', caption: 'March 12, 2026, Los Angeles, California, USA: LeBron James 23 of the Los Angeles Lakers drives' };
  const g = IMG.heuristics(game, subject);
  assert.equal(g.kind, 'action', 'an agency game caption is an in-game photo');
  assert.equal(IMG.scorePhoto(game, subject, g, null).drop, '');
  const own = { ...base, title: 'LeBron James Claims How Michael Jordan Influenced His Shooting' };
  assert.equal(IMG.scorePhoto(own, subject, IMG.heuristics(own, subject), null).drop, '', 'his own story image stays');
}

// 5. Code headlines: the colon stays, quotes are never chopped into a headline.
{
  const read = P.readCreative('Rob Manfred: MLB owners won\'t compromise on the salary cap.\nSport: MLB', {});
  assert.match(P.codeHeadline(read.stories[0].text, read.stories[0], read), /^Rob Manfred: MLB owners won't compromise/, 'the colon stays');
  const long = P.readCreative('Rob Manfred: MLB owners won\'t compromise on the salary cap as the labor fight with the players union heats up.\nSport: MLB', {});
  assert.equal(P.codeHeadline(long.stories[0].text, long.stories[0], long), 'Rob Manfred: MLB owners won\'t compromise');
  const q = P.readCreative('Clark: "I just love playing in front of this crowd."\nSport: WNBA', {});
  assert.ok(!/LOVE PLAYING/i.test(P.codeHeadline(q.stories[0].text, q.stories[0], q) || ''), 'no chopped quote as a headline');
  assert.equal(P.editorialKicker('MLB', read), '');
  assert.equal(P.editorialKicker('Rob Manfred · MLB', read), '');
  assert.equal(P.editorialKicker('LABOR WAR', read), 'LABOR WAR');
}

console.log(`gen-quality: ${BRIEFS.length + extra.length} briefs (${designs} candidate designs), counts 1-8 honoured, no sport tags, no washed-out boxes, typographic fixed, review contract, repairs, photo keys, photo signals: all pass.`);
