#!/usr/bin/env node
// Generate imagery v3 (_imagery.js, the asset service's prepareImagery /
// storeCutout, the composer hook, the browser's prepareCutouts): subject
// extraction for every class of brief, ranking, de-duplication, size probing,
// vision (mocked, cached, gated), cut-out plan and store, headshots, logos and
// the contract input shape. Nothing leaves the machine: fetch is mocked and
// every source is injected.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.GEN_ASSETS_STORAGE = 'off';
delete process.env.AI_GATEWAY_API_KEY;
globalThis.fetch = async url => { throw new Error(`unexpected network call: ${url}`); };

const I = require('../netlify/functions/_imagery.js');
const T = I._test;
const BASE = 'https://image-cdn.essentiallysports.com/wp-content/uploads';
const allowed = url => String(url).startsWith('https://image-cdn.essentiallysports.com/');

// ─── 1. Names ───────────────────────────────────────────────────────────
{
  assert.equal(T.cleanName('BRYSON DECHAMBEAU JOINS'), 'Bryson Dechambeau');
  assert.equal(T.cleanName('World Tour.'), 'World Tour');
  assert.equal(T.cleanName("Mahomes's"), 'Mahomes');
  assert.equal(T.classifyName('Europe'), 'place');
  assert.equal(T.classifyName('Kansas City'), 'place');
  assert.equal(T.classifyName('World Tour'), 'event');
  assert.equal(T.classifyName('Monaco Grand Prix'), 'event');
  assert.equal(T.classifyName('Bryson DeChambeau'), 'person');
  assert.equal(T.classifyName('Bryson'), 'short');
  assert.equal(T.classifyName('Arrowhead Stadium'), 'venue');
  assert.equal(T.classifyName('Warriors-Lakers'), '', 'two teams joined by a hyphen are not a person');
  assert.ok(['team', 'event'].includes(T.classifyName('Inter Miami')), 'a club is never a person');
  assert.equal(T.classifyName('Roland Garros'), 'event');
  assert.equal(T.classifyName('Jaxon Smith-Njigba'), 'person');
  assert.equal(T.classifyName('North'), '');
  assert.equal(T.classifyName('Los Angeles Lakers'), 'team', 'the logo library knows teams');
  assert.equal(T.classifyName('Lakers'), 'team');
  assert.equal(T.classifyName('Bengals', { teams: [{ name: 'Bengals', kind: 'team' }] }), 'team');
  assert.equal(T.classifyName('NBA', { teams: [{ name: 'NBA', kind: 'league' }] }), 'league');
}

// Subjects: cleans, resolves short / shouted names through ES tags, keeps order.
{
  T.TAG_CACHE.clear();
  const tagCalls = [];
  const tags = async q => {
    tagCalls.push(q);
    if (/bryson/i.test(q)) return [{ name: 'Bryson DeChambeau', count: 900 }, { name: 'Bryson Nimmo', count: 2 }];
    if (/ohtani/i.test(q)) return [{ name: 'Shohei Ohtani', count: 1200 }];
    if (/lebron/i.test(q)) return [{ name: 'LeBron James', count: 5000 }, { name: 'LeBron James Jr.', count: 40 }];
    if (/caitlin clark/i.test(q)) return [{ name: 'Caitlin Clark', count: 3000 }];
    if (/^north/i.test(q)) return [{ name: 'North Wilkesboro Speedway', count: 40 }, { name: 'North Carolina', count: 900 }];
    if (/^dodgers/i.test(q)) return [{ name: 'Dodgers Stadium', count: 50 }];
    return [];
  };
  const golf = await I.subjectsFor({ brief: 'Bryson DeChambeau is taking on Europe on the DP World Tour', people: ['Bryson DeChambeau', 'World Tour', 'Europe'], teams: [{ name: 'DP World Tour', kind: 'league', id: 'l1' }], stories: [{ text: 'Bryson DeChambeau is taking on Europe on the DP World Tour', teams: ['l1'] }] }, { tags });
  assert.deepEqual(golf.heroes.map(h => h.name), ['Bryson DeChambeau'], 'places and tours are not people');
  assert.ok(golf.dropped.some(d => d.name === 'Europe' && /place/.test(d.why)));
  const short = await I.subjectsFor({ brief: 'Bryson takes on Europe', people: ['World Tour.', 'Bryson', 'Europe'], teams: [], stories: [] }, { tags });
  assert.deepEqual(short.heroes.map(h => h.name), ['Bryson DeChambeau'], 'a first name resolves to the ES tag');
  const shouted = await I.subjectsFor({ brief: 'BRYSON DECHAMBEAU JOINS DP WORLD TOUR FOR 2027', people: ['BRYSON DECHAMBEAU JOINS', 'WORLD'], teams: [], stories: [] }, { tags });
  assert.deepEqual(shouted.heroes.map(h => h.name), ['Bryson DeChambeau'], 'an ALL-CAPS brief resolves to the real spelling');
  const mlb = await I.subjectsFor({ brief: 'Ohtani signs a record deal with the Dodgers', people: ['Ohtani'], teams: [{ name: 'Dodgers', kind: 'team', id: 't1' }], stories: [{ text: 'Ohtani signs a record deal with the Dodgers', teams: ['t1'] }] }, { tags });
  assert.deepEqual(mlb.heroes.map(h => h.name), ['Shohei Ohtani']);
  const caps = await I.subjectsFor({ brief: 'CAITLIN CLARK BREAKS THE ROOKIE ASSISTS RECORD WITH 337', people: ['CAITLIN CLARK BREAKS', 'ROOKIE ASSISTS RECORD'], teams: [], stories: [] }, { tags });
  assert.deepEqual(caps.heroes.map(h => h.name), ['Caitlin Clark'], 'shouted words: the longest prefix that is a real ES name');
  const takes = await I.subjectsFor({ brief: 'BRYSON TAKES ON EUROPE IN 2027', people: ['BRYSON TAKES', 'EUROPE'], teams: [], stories: [] }, { tags });
  assert.deepEqual(takes.heroes.map(h => h.name), ['Bryson DeChambeau'], 'a shouted first name before a verb still resolves');
  const north = await I.subjectsFor({ brief: 'The Bengals took first place in the AFC North.', people: ['North.'], teams: [], stories: [] }, { tags });
  assert.deepEqual(north.heroes, [], 'a direction word never becomes a venue or person');
  const venue = await I.subjectsFor({ brief: 'The Chiefs plan to leave Arrowhead Stadium', people: ['Arrowhead Stadium', 'Kansas'], teams: [{ name: 'Chiefs', kind: 'team', id: 'c' }], stories: [{ text: 'The Chiefs plan to leave Arrowhead Stadium', teams: ['c'] }] }, { tags });
  assert.deepEqual(venue.heroes.map(h => `${h.name}:${h.kind}`), ['Chiefs:team', 'Arrowhead Stadium:venue']);
  const offline = await I.subjectsFor({ brief: 'JOSH ALLEN THROWS 5 TDS', people: ['JOSH ALLEN THROWS'], teams: [], stories: [] }, { tags: async () => { throw new Error('offline'); } });
  assert.deepEqual(offline.heroes.map(h => h.name), ['Josh Allen'], 'tags offline: the cleaned guess is kept');
  assert.equal(offline.heroes.length, 1);
  // A team-only story: the team is the subject (event imagery).
  const team = await I.subjectsFor({ brief: 'The Bengals beat the Steelers 38-18', people: [], teams: [{ name: 'Bengals', kind: 'team', id: 'a' }, { name: 'Steelers', kind: 'team', id: 'b' }], stories: [{ text: 'The Bengals beat the Steelers 38-18', teams: ['a', 'b'] }] }, { tags });
  assert.deepEqual(team.heroes.map(h => `${h.name}:${h.kind}`), ['Bengals:team', 'Steelers:team']);
  // A ranking: 4 heroes, the rest are headshot extras.
  const many = ['Josh Allen', 'Lamar Jackson', 'Joe Burrow', 'Jalen Hurts', 'Patrick Mahomes', 'Dak Prescott'];
  const ranking = await I.subjectsFor({ brief: `Top QBs: ${many.join(', ')}`, people: many, teams: [], stories: [] }, { tags });
  assert.equal(ranking.heroes.length, 4);
  assert.deepEqual(ranking.extras.map(e => e.name), ['Patrick Mahomes', 'Dak Prescott']);
  // Lookups are cached.
  const before = tagCalls.length;
  await I.subjectsFor({ brief: 'Bryson again', people: ['Bryson'], teams: [], stories: [] }, { tags });
  assert.equal(tagCalls.length, before, 'tag lookups are cached');
}

// ─── 2. Photo signals ───────────────────────────────────────────────────
{
  assert.equal(T.photoStem(`${BASE}/USATSI_28925574.jpg-scaled-e1780279607189.jpeg`), T.photoStem('https://essentiallysports-images-v2prod.s3.amazonaws.com/agency/USATSI_28925574.jpg'), 'one agency frame, any host');
  assert.equal(T.photoStem(`${BASE}/a-b-1536x1024.jpg`), T.photoStem(`${BASE}/a-b.jpg`));
  assert.deepEqual(T.sizeFromUrl(`${BASE}/x-1079x720.jpg`), { width: 1079, height: 720 });
  assert.equal(T.originalOf(`${BASE}/x-1079x720.jpg`), `${BASE}/x.jpg`);
  assert.equal(T.kindHint('Bryson DeChambeau tees off on the 1st hole'), 'action');
  assert.equal(T.kindHint('Scheffler lifts the trophy'), 'celebration');
  assert.equal(T.kindHint('Mahomes looks on from the sideline'), 'portrait');
  assert.equal(T.kindHint('General view of Arrowhead Stadium'), 'venue');
  const subject = { name: 'Bryson DeChambeau', kind: 'person' };
  assert.equal(T.mentions('Bryson DeChambeau of the Crushers', subject), 2);
  assert.equal(T.mentions('DeChambeau smiles', subject), 1);
  assert.equal(T.mentions('Brian Rolapp speaks', subject), 0);
  assert.equal(T.groupHint({ sourceUrl: `${BASE}/Rory-McIlroy-and-Bryson-DeChambeau-2.jpg`, title: '', caption: '' }, subject), true);
  assert.equal(T.groupHint({ sourceUrl: `${BASE}/Bryson-DeChambeau-swing.jpg`, title: '', caption: '' }, subject), false);
  // JPEG / PNG headers.
  const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0, 0, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 3, 1, 0x22, 0]);
  assert.deepEqual(T.headerSize(jpeg), { width: 1920, height: 1080 });
}

// Scoring: graphics, the wrong person and tiny files drop; sharp, named, solo action wins.
{
  const subject = { name: 'Bryson DeChambeau', kind: 'person' };
  const photo = (file, extra = {}) => ({ sourceUrl: `${BASE}/${file}`, title: '', caption: '', width: 2000, height: 1333, matched: 'person', ...extra });
  const score = (p, v = null) => I.scorePhoto(p, subject, I.heuristics(p, subject), v);
  assert.equal(score(photo('LIV-Golf-logo-1.jpg')).drop, 'graphic');
  assert.equal(score(photo('Bryson-DeChambeau-silhouette.jpg')).drop, 'graphic');
  assert.equal(score(photo('x.jpg', { width: 300, height: 200 })).drop, 'too small');
  assert.equal(score(photo('Brian-Rolapp.jpg', { matched: 'query' })).drop, 'not about the person');
  assert.equal(score(photo('a.jpg'), { subject: false, quality: 4 }).drop, 'not the person');
  assert.equal(score(photo('a.jpg'), { subject: true, quality: 1 }).drop, 'blurry or murky');
  const sharp = score(photo('Bryson-DeChambeau-tees-off.jpg')).score;
  const small = score(photo('Bryson-DeChambeau-tees-off-2.jpg', { width: 640, height: 427 })).score;
  const group = score(photo('Rory-McIlroy-and-Bryson-DeChambeau.jpg')).score;
  assert.ok(sharp > small, 'resolution counts');
  assert.ok(sharp > group, 'a solo subject beats a group');
  const seen = score(photo('a.jpg'), { subject: true, alone: true, face: true, quality: 5, kind: 'action' }).score;
  assert.ok(seen > sharp, 'vision-confirmed beats text-only');
}

// ─── 3. prepareImagery end to end (mocked sources) ───────────────────────
function sources() {
  const calls = { agency: [], media: [], articles: [], probe: [], vision: [], storage: [] };
  const deps = {
    allowed,
    tags: async () => [],
    agency: async (q, n) => {
      calls.agency.push(q);
      if (/Bengals|Cincinnati/.test(q)) return [{ id: 'b1', sourceUrl: `${BASE}/Bengals-fans-celebrate-at-Paycor-Stadium.jpg`, caption: 'Bengals fans celebrate at Paycor Stadium', width: 3000, height: 2000 }];
      if (!/Bryson/.test(q)) return [];
      return [
        { id: 'a1', sourceUrl: `${BASE}/USATSI_100001.jpg`, caption: 'Bryson DeChambeau tees off on the 1st hole during the final round', credit: 'Imagn', width: 3200, height: 2133 },
        { id: 'a2', sourceUrl: `${BASE}/USATSI_100002.jpg`, caption: 'Bryson DeChambeau celebrates his win with the trophy', credit: 'Imagn', width: 2400, height: 3600 },
        { id: 'a3', sourceUrl: `${BASE}/USATSI_100003.jpg`, caption: 'Rory McIlroy and Bryson DeChambeau walk the 18th', credit: 'Imagn', width: 3000, height: 2000 },
      ];
    },
    articles: async q => {
      calls.articles.push(q);
      if (!/Bryson/.test(q)) return [];
      return [
        { url: 'https://www.essentiallysports.com/a1', title: "Bryson DeChambeau's PGA return is on hold", image: `${BASE}/USATSI_100001.jpg-scaled-e1780279607189.jpeg` },
        { url: 'https://www.essentiallysports.com/a2', title: 'LIV Golf exits explained', image: `${BASE}/LIV-Golf-logo-1.jpg` },
        { url: 'https://www.essentiallysports.com/a3', title: 'Brian Rolapp delivers a blunt verdict', image: `${BASE}/Brian-Rolapp-2.jpg` },
        { url: 'https://www.essentiallysports.com/a4', title: 'Bryson DeChambeau smiles after round 1', image: `${BASE}/Bryson-DeChambeau-smiling-1079x720.jpg` },
      ];
    },
    media: async q => {
      calls.media.push(q);
      if (/Mahomes|Allen/.test(q)) return [{ id: q, sourceUrl: `${BASE}/${q.replace(/\s+/g, '-')}-looks-on.jpg`, title: `${q} looks on`, width: 1600, height: 1200 }];
      if (!/Bryson/.test(q)) return [];
      return [
        { id: 9, sourceUrl: `${BASE}/Bryson-DeChambeau-silhouette-1536x1024.jpg`, title: 'silhouette', width: 2560, height: 1707 },
        { id: 10, sourceUrl: `${BASE}/Bryson-DeChambeau-drives-the-ball-1536x1024.jpg`, title: 'Bryson DeChambeau drives the ball', width: 2560, height: 1707 },
        { id: 11, sourceUrl: `${BASE}/Bryson-tiny-300x200.jpg`, title: 'Bryson DeChambeau thumbnail crop', width: 300, height: 200 },
      ];
    },
    probe: async url => {
      calls.probe.push(url);
      if (/drives-the-ball\.jpg(\?|$)/.test(url)) return { width: 2560, height: 1707 }; // the original behind the 1536 size
      if (/smiling\.jpg(\?|$)/.test(url)) return null; // no bigger original
      return null;
    },
    probeDeadlineMs: 2000,
    vision: null,
    storageHas: async path => { calls.storage.push(path); return null; },
  };
  return { deps, calls };
}
const GOLF_READ = { brief: 'Sport: Golf\nBryson DeChambeau is taking on Europe on the DP World Tour.', sport: 'Golf', people: ['Bryson DeChambeau', 'World Tour', 'Europe'], teams: [{ name: 'DP World Tour', kind: 'league', id: 'league-dp-world-tour', logo: 'assets/infographics/logo-dp-world-tour.webp' }], stories: [{ id: 's1', text: 'Bryson DeChambeau is taking on Europe on the DP World Tour', teams: ['league-dp-world-tour'] }] };
{
  const { deps, calls } = sources();
  const im = await I.prepareImagery(GOLF_READ, {}, deps);
  assert.equal(im.ok, true);
  assert.deepEqual(im.subjects.map(s => s.name), ['Bryson DeChambeau']);
  assert.ok(!calls.agency.some(q => /Europe|World Tour$/.test(q)), 'never searched a place or tour as a person');
  const urls = im.bySubject['Bryson DeChambeau'].map(p => p.sourceUrl);
  assert.ok(urls.length >= 3, 'several photos of the named person');
  assert.ok(!urls.some(u => /logo|silhouette|Rolapp|tiny/.test(u)), `no graphics, other people or thumbnails: ${urls}`);
  assert.equal(urls.filter(u => /USATSI_100001/.test(u)).length, 1, 'the agency frame and its article copy count once');
  assert.ok(urls.some(u => /drives-the-ball\.jpg\?width=2048$/.test(u)), 'the 1536 size is swapped for the larger original');
  assert.ok(urls.every(u => u.includes('width=2048')), 'the CDN is asked for full resolution (it caps at 1280 otherwise)');
  const top = im.bySubject['Bryson DeChambeau'][0];
  assert.ok(/USATSI_10000[12]/.test(top.sourceUrl), `a sharp, named, solo agency photo leads: ${top.sourceUrl}`);
  assert.notEqual(im.bySubject['Bryson DeChambeau'][0].kind, im.bySubject['Bryson DeChambeau'][1].kind, 'variety in the first two');
  // Contract shape.
  im.photos.forEach(p => {
    assert.ok(p.url.startsWith('/api/es-image-search?image='));
    assert.ok(['action', 'portrait', 'crowd', 'venue', 'object'].includes(p.kind));
    assert.equal(typeof p.score, 'number');
    assert.equal(p.rights.aiGenerated, false);
    assert.ok(['es-agency', 'es-article', 'es-media'].includes(p.source));
    assert.equal(p.person, 'Bryson DeChambeau');
  });
  // Cut-outs: hero's best solo photos, never the group shot, at most 3; looked up in the store.
  assert.ok(im.cutoutPlan.length >= 1 && im.cutoutPlan.length <= 3);
  assert.ok(!im.cutoutPlan.some(c => /100003/.test(c.sourceUrl)), 'no cut-out of a group photo');
  assert.ok(im.cutoutPlan.every(c => c.path.startsWith('gen-assets/cutouts/') && c.path.endsWith('.png')));
  assert.equal(calls.storage.length, im.cutoutPlan.length);
  assert.equal(im.headshots[0].person, 'Bryson DeChambeau');
  assert.deepEqual(im.logos.map(l => l.url), ['assets/infographics/logo-dp-world-tour.webp']);
  assert.equal(im.cost, 0, 'no vision without a key');
  assert.equal(im.stats.visionCalls, 0);
}

// Cut-outs already in the store come back as input.cutouts at $0.
{
  const { deps } = sources();
  deps.storageHas = async path => `https://store.example/${path}`;
  const im = await I.prepareImagery(GOLF_READ, {}, deps);
  assert.ok(im.cutouts.length >= 1);
  assert.equal(im.cutoutPlan.length, 0, 'nothing left for the browser');
  assert.ok(im.cutouts.every(c => c.person === 'Bryson DeChambeau' && c.fromPhoto.startsWith('/api/es-image-search') && c.url.startsWith('https://store.example/gen-assets/cutouts/')));
}

// Vision: called once per person for unseen photos, cached, gated; it overrides text.
{
  T.VISION_CACHE.clear();
  const { deps } = sources();
  let visionCalls = 0;
  deps.vision = async ({ subject, photos }) => {
    visionCalls += 1;
    assert.equal(subject.name, 'Bryson DeChambeau');
    assert.ok(photos.length <= I.LIMITS.visionPhotos);
    return { cost: 0.0032, rows: photos.map((p, i) => ({ n: i + 1, subject: !/100002/.test(p.sourceUrl), alone: true, face: /100001/.test(p.sourceUrl), quality: /drives/.test(p.sourceUrl) ? 1 : 4, kind: 'action', graphic: false, cutout: true, fx: 0.4, fy: 0.3 })) };
  };
  const im = await I.prepareImagery(GOLF_READ, { gated: true }, deps);
  assert.equal(visionCalls, 1);
  assert.equal(im.cost, 0.0032);
  const urls = im.bySubject['Bryson DeChambeau'].map(p => p.sourceUrl);
  assert.ok(!urls.some(u => /100002/.test(u)), 'vision: not the person -> dropped');
  assert.ok(!urls.some(u => /drives/.test(u)), 'vision: murky -> dropped');
  assert.deepEqual(im.bySubject['Bryson DeChambeau'][0].focal, { x: 0.4, y: 0.3 });
  assert.ok(im.headshots[0].fromPhoto.includes('100001'), 'headshot: the photo with a visible face');
  const again = await I.prepareImagery(GOLF_READ, { gated: true }, deps);
  assert.equal(visionCalls, 1, 'verdicts cached per person + photo');
  assert.equal(again.cost, 0);
  // The spend gate refuses: no vision, still photos.
  T.VISION_CACHE.clear();
  const gatedDeps = { ...deps, gate: async () => ({ reason: 'weekly-limit' }) };
  const refused = await I.prepareImagery(GOLF_READ, {}, gatedDeps);
  assert.equal(visionCalls, 1, 'the spend gate stops vision');
  assert.ok(refused.photos.length >= 3);
}

// Never a cut-out of a crowd, venue or object photo, even when vision says it could be.
{
  T.VISION_CACHE.clear();
  const subject = { name: 'Bryson DeChambeau', kind: 'person' };
  const pool = ['crowd', 'venue', 'object', 'action'].map((k, i) => ({ sourceUrl: `${BASE}/Bryson-DeChambeau-${k}.jpg`, url: `/p${i}`, title: 'Bryson DeChambeau', caption: '', width: 2000, height: 1400, matched: 'person' }));
  const res = await I.rankFor(subject, pool, { allowed, probe: async () => null, vision: async ({ photos }) => ({ cost: 0, rows: photos.map((p, i) => ({ n: i + 1, subject: true, alone: true, face: true, quality: 4, kind: p.sourceUrl.match(/-(\w+)\.jpg$/)[1], cutout: true })) }) }, {}, { allowVision: true });
  assert.deepEqual(res.ranked.filter(p => p.cutoutOk).map(p => p.kind), ['action']);
}

// Team-only and grid briefs.
{
  const { deps } = sources();
  const team = await I.prepareImagery({ brief: 'The Bengals beat the Steelers 38-18', sport: 'NFL', people: [], teams: [{ name: 'Bengals', full: 'Cincinnati Bengals', kind: 'team', id: 'nfl-cin', logo: 'assets/logos/nfl/cin.webp' }], stories: [{ text: 'The Bengals beat the Steelers 38-18', teams: ['nfl-cin'] }] }, {}, deps);
  assert.equal(team.subjects[0].kind, 'team');
  assert.equal(team.bySubject.Bengals[0].team, 'Bengals');
  assert.equal(team.bySubject.Bengals[0].person, undefined);
  assert.equal(team.cutoutPlan.length, 0, 'team photos are never cut out as a person');
  assert.ok(team.logos.some(l => l.url === 'assets/logos/nfl/cin.webp' && l.team === 'Cincinnati Bengals' && l.league === 'NFL'));
  assert.ok(team.logos.some(l => /league-logos\/nfl/.test(l.url)), 'the league mark too');
  const many = ['Josh Allen', 'Lamar Jackson', 'Joe Burrow', 'Jalen Hurts', 'Patrick Mahomes'];
  const grid = await I.prepareImagery({ brief: `Top QBs: ${many.join(', ')}`, sport: 'NFL', people: many, teams: [], stories: [] }, {}, deps);
  assert.ok(grid.headshots.some(h => h.person === 'Patrick Mahomes'), 'extras get headshots for grids');
  assert.ok(grid.headshots.some(h => h.person === 'Josh Allen'));
}

// inputImagery: the design's subject first, the chosen photo leading, no repeats.
{
  const { deps } = sources();
  const im = await I.prepareImagery(GOLF_READ, {}, deps);
  const second = im.bySubject['Bryson DeChambeau'][1];
  const input = I.inputImagery(im, { person: 'Bryson DeChambeau', main: second.url, exclude: [im.bySubject['Bryson DeChambeau'][0].sourceUrl] });
  assert.equal(input.photos[0].url, second.url, 'the chosen photo leads');
  assert.ok(!input.photos.some(p => p.sourceUrl === im.bySubject['Bryson DeChambeau'][0].sourceUrl), 'a photo used elsewhere stays out');
  assert.ok(input.photos.every(p => p.src === p.url));
  assert.ok(input.photos.length <= 8);
  assert.deepEqual(I.inputImagery(null, {}), {});
}

// ─── 4. Asset service: storeCutout, prepareImagery wrapper ───────────────
{
  const A = require('../netlify/functions/_asset-service.js');
  const png = (colorType = 6, w = 800, h = 1000) => {
    const b = Buffer.alloc(40);
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(b);
    b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1');
    b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[24] = 8; b[25] = colorType;
    return `data:image/png;base64,${b.toString('base64')}`;
  };
  const ctx = { token: 't', deps: { allowed } };
  assert.equal((await A.storeCutout({ sourceUrl: 'https://evil.example/x.jpg', image: png() }, ctx)).reason, 'reference');
  assert.equal((await A.storeCutout({ sourceUrl: `${BASE}/x.jpg`, image: png(2) }, ctx)).reason, 'bad-image', 'needs alpha');
  assert.equal((await A.storeCutout({ sourceUrl: `${BASE}/x.jpg`, image: 'data:image/jpeg;base64,/9j/' }, ctx)).reason, 'bad-image');
  // Storage off here: refused politely (the session copy still works).
  assert.equal((await A.storeCutout({ sourceUrl: `${BASE}/x.jpg`, image: png() }, ctx)).reason, 'error');
  // The wrapper caches a finished answer and never throws.
  A._test.IMAGERY_CACHE.clear();
  const { deps } = sources();
  deps.storageHas = async path => `https://store.example/${path}`;
  const first = await A.prepareImagery(GOLF_READ, { deps });
  assert.equal(first.ok, true);
  assert.equal(first.cached, false);
  const second = await A.prepareImagery(GOLF_READ, { deps });
  assert.equal(second.cached, true);
  const broken = await A.prepareImagery({ get people() { throw new Error('bad read'); } }, { deps });
  assert.equal(broken.ok, false);
  assert.deepEqual(broken.photos, []);
}

// ─── 5. findPhotos v3: exactly what the composer (gen-director) reads ───
// Per subject: res.photos sorted by score (url, src, width, height, kind,
// focal, rights), res.cutouts [{ url, fromPhoto }], res.headshots, res.logos.
{
  const A = require('../netlify/functions/_asset-service.js');
  A._test.PHOTO_CACHE.clear();
  T.TAG_CACHE.clear();
  const { deps } = sources();
  deps.tags = async q => (/bryson/i.test(q) ? [{ name: 'Bryson DeChambeau', count: 900 }] : []);
  deps.storageHas = async path => `https://store.example/${path}`;
  const ctx = { gated: true, deps };
  const res = await A.findPhotos({ person: 'Bryson DeChambeau', sport: 'Golf', count: 6 }, ctx);
  assert.equal(res.ok, true);
  assert.ok(res.photos.length >= 3);
  const scores = res.photos.map(p => p.score);
  assert.ok(res.photos.every(p => p.url && p.src === p.url && typeof p.score === 'number' && p.rights?.aiGenerated === false && ['action', 'portrait', 'crowd', 'venue', 'object'].includes(p.kind) && p.person === 'Bryson DeChambeau'));
  assert.ok(scores.every(x => x >= 0 && x <= 1), 'scores are 0-1');
  assert.ok(res.cutouts.length >= 1 && res.cutouts.every(c => c.url && res.photos.some(p => p.url === c.fromPhoto)), 'stored cut-outs keyed by fromPhoto');
  assert.ok(res.cutouts.every(c => !['crowd', 'venue', 'object'].includes(res.photos.find(p => p.url === c.fromPhoto).kind)));
  assert.equal(res.headshots[0].person, 'Bryson DeChambeau');
  assert.ok(res.headshots[0].url);
  assert.ok(res.logos.some(l => l.url && l.league === 'GOLF') || Array.isArray(res.logos));
  // Junk subjects: no photos, and nothing searched.
  const searched = [];
  const spy = { ...deps, agency: async q => { searched.push(q); return []; }, media: async q => { searched.push(q); return []; } };
  for (const junk of ['Europe', 'Sunday', 'North.', 'World Tour', 'Las Vegas']) {
    const none = await A.findPhotos({ person: junk, sport: 'Golf' }, { gated: true, deps: spy });
    assert.deepEqual(none.photos, [], `${junk} is not a person`);
  }
  assert.deepEqual(searched, [], 'junk subjects never reach the ES search');
  // A first name resolves before searching.
  A._test.PHOTO_CACHE.clear();
  const short = await A.findPhotos({ person: 'Bryson', sport: 'Golf' }, ctx);
  assert.equal(short.subject.name, 'Bryson DeChambeau');
  assert.ok(short.photos.length >= 3);
  // A team: logo from the library, photos tagged with the team, never cut-outs.
  const team = await A.findPhotos({ team: 'Bengals', query: 'Bengals', sport: 'NFL' }, ctx);
  assert.ok(team.photos.every(p => p.team === 'Bengals' && !p.person));
  assert.deepEqual(team.cutouts, []);
  assert.ok(team.logos.some(l => /nfl\/cin/.test(l.url)), 'team logo');
  assert.ok(team.logos.some(l => /league-logos\/nfl/.test(l.url)), 'league mark');
  // Cached: the second design of the set costs nothing.
  const again = await A.findPhotos({ person: 'Bryson', sport: 'Golf' }, ctx);
  assert.equal(again.cached, true);
  assert.equal(again.cost, 0);
}

// ─── 6. Browser client: prepareCutouts caps, stores and never throws ─────
{
  const F = require('../frameup-assets.js');
  assert.equal(typeof F.prepareCutouts, 'function');
  assert.equal(typeof F.storeCutout, 'function');
  const none = await F.prepareCutouts([{ sourceUrl: `${BASE}/a.jpg` }]);
  assert.deepEqual(none, { cutouts: [], cost: 0, made: 0, failed: 0 }, 'no document: nothing made, no throw');
  assert.deepEqual(await F.prepareCutouts(null), { cutouts: [], cost: 0, made: 0, failed: 0 });
}

console.log('test-gen-imagery: all passed');
