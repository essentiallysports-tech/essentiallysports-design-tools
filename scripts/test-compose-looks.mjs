// Generate v3 looks: the ES-board archetypes, tone families (contrast-checked),
// the shared input shape (photos / cutouts / headshots / logos with url),
// cut-out craft and the content rules that keep looks honest. Pure Node:
// scene specs and the gate only (the lab renders them in Chrome).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../frameup-compose.js');
const { contrast } = C._test;
const LOOKS = C.ARCHETYPES.filter(a => a.looks);

// ── 1. Catalogue ───────────────────────────────────────────────────────────
assert.ok(LOOKS.length >= 12, `12+ new looks (${LOOKS.length})`);
assert.equal(C.ARCHETYPES.filter(a => !a.looks).length, 29, 'every v1/v2 archetype is still there');
assert.deepEqual(C.TONES, ['light', 'paper', 'vivid', 'dark', 'duotone', 'editorial', 'esblue']);
const families = new Set(LOOKS.map(a => a.family));
['stats', 'cover', 'quote', 'grid', 'listicle', 'bar-graph', 'extra', 'lifestyle'].forEach(f => assert.ok(families.has(f), `an ES board ${f} look`));
C.ARCHETYPES.forEach(a => {
  assert.ok(C.FAMILIES.includes(a.family), `${a.id}: family`);
  assert.ok(a.tones.length && a.tones.every(t => C.TONES.includes(t)), `${a.id}: tones`);
});
LOOKS.forEach(a => {
  assert.ok(a.name && a.about && a.needs && a.kinds?.length && a.focal, `${a.id}: catalogue fields`);
  assert.equal(C.NEEDS[a.id], a.needs);
});
// Light and dark looks both exist, and every tone is drawn by 3+ looks.
C.TONES.forEach(t => assert.ok(LOOKS.filter(a => a.tones.includes(t)).length >= 3, `tone ${t} has 3+ looks`));

// ── 2. Tone palettes: every role reads, for awkward team colours too ─────────
const TEAMS = [
  ['#FB4F14', '#000000'], ['#552583', '#FDB927'], ['#F7B5CD', '#231F20'], ['#FFC72C', '#1D428A'], ['#FFFFFF', '#A5ACAF'],
  ['#0C2340', '#C4CED4'], ['#007AC1', '#EF3B24', '#002D62'], ['#000000', '#E4002B'], ['#00338D', '#C60C30'], ['#BF5700', '#333F48'],
  ['#FFD100', '#00205B'], ['#69BE28', '#002244'], ['#E31837', '#FFB81C'], ['#0B3D2E', '#C9A227'], ['#F4F2EE'], [],
];
TEAMS.forEach(cols => {
  const base = C.makePalette(cols);
  C.TONES.forEach(tone => {
    const p = C.tonePalette(base, tone);
    const tag = `${cols.join('/') || 'ES'} ${tone}`;
    assert.equal(p.toneName, tone);
    assert.ok(contrast(p.ink, p.bg) >= (tone === 'esblue' ? 3 : 4.5), `${tag}: ink on bg ${contrast(p.ink, p.bg).toFixed(2)}`);
    assert.ok(contrast(p.inkSmall, p.bg) >= 4.5, `${tag}: small ink on bg`);
    assert.ok(contrast(p.accent, p.bg) >= 3, `${tag}: accent on bg`);
    assert.ok(contrast(p.boxInk, p.box) >= 4.5, `${tag}: box text`);
    assert.ok(contrast(p.boxHi, p.box) >= 3, `${tag}: highlighted word in a box`);
    assert.ok(contrast(p.tagInk, p.tag) >= 4.5, `${tag}: tag text`);
    ['bg', 'ink', 'accent', 'box', 'boxInk', 'tag', 'tagInk'].forEach(k => assert.ok(p.allowed.includes(p[k]), `${tag}: ${k} allowed`));
  });
  assert.equal(C.tonePalette(base, 'light').mode, 'light');
  assert.equal(C.tonePalette(base, 'paper').mode, 'light');
  assert.equal(C.tonePalette(base, 'vivid').mode, 'dark');
});
// Vivid really is the team colour (not murky): OKC blue, Chiefs red.
assert.equal(C.tonePalette(C.makePalette(['#007AC1', '#EF3B24', '#002D62']), 'vivid').bg, '#007AC1');
assert.equal(C.tonePalette(C.makePalette(['#E31837', '#FFB81C']), 'vivid').bg, '#E31837');
assert.equal(C.tonePalette(C.makePalette(['#00338D']), 'esblue').bg, '#0A7DFA');
// Editorial photos are B&W, duotone photos use a 3-stop team ramp.
assert.equal(C.tonePalette(C.makePalette(['#00338D']), 'editorial').treat, 'mono');
assert.equal(C.tonePalette(C.makePalette(['#00338D']), 'duotone').duo.length, 3);

// ── 3. The shared input shape (B / C) ──────────────────────────────────────
const shared = {
  sport: 'NFL', palette: C.makePalette(['#E31837', '#FFB81C'], { name: 'Chiefs' }),
  kicker: 'Week 12', headline: 'Mahomes cooks the Bills again', highlight: ['again'], name: 'Patrick Mahomes', body: 'Kansas City moves to 9-2.',
  number: { value: '312', label: 'pass yards', factId: 'f1' },
  numbers: [{ value: '312', display: '312', label: 'pass yards', factId: 'f1' }, { value: '4', display: '4', label: 'touchdowns', factId: 'f2' }, { value: '118.6', display: '118.6', label: 'passer rating', factId: 'f3' }],
  record: { value: '9-2', label: 'record', factId: 'f4' },
  quote: { text: 'We just kept finding ways', by: 'Patrick Mahomes' },
  photos: [
    { url: '/p/mahomes-1.jpg', width: 2400, height: 1600, person: 'Patrick Mahomes', team: 'Chiefs', kind: 'action', score: 0.92, source: 'es', rights: 'es-licensed' },
    { url: '/p/mahomes-2.jpg', width: 2000, height: 1333, person: 'Patrick Mahomes', kind: 'portrait', score: 0.8, source: 'es', rights: 'es-licensed' },
    { url: '/p/mahomes-3.jpg', width: 1800, height: 1200, person: 'Patrick Mahomes', kind: 'action', score: 0.7, source: 'es', rights: 'es-licensed' },
  ],
  cutouts: [{ url: '/c/mahomes-2.png', width: 2000, height: 1333, person: 'Patrick Mahomes', fromPhoto: '/p/mahomes-2.jpg' }],
  headshots: ['Patrick Mahomes', 'Josh Allen', 'Joe Burrow', 'Lamar Jackson'].map((person, k) => ({ url: `/h/${k}.png`, person })),
  logos: [{ url: 'assets/logos/nfl/kc.webp', team: 'Chiefs', league: 'NFL' }],
  quotes: [{ text: 'We just kept finding ways', by: 'Patrick Mahomes' }, { text: 'They were better tonight', by: 'Josh Allen', photo: { url: '/p/allen.jpg' } }],
  rows: [{ name: 'Patrick Mahomes', value: '312' }, { name: 'Josh Allen', value: '288' }, { name: 'Joe Burrow', value: '275' }],
  bars: [{ value: '312', display: '312', label: '2025' }, { value: '288', display: '288', label: '2024' }],
  post: { name: 'Kansas City Chiefs', text: 'Another one. 9-2.' },
  facts: [{ id: 'f1', text: '312 pass yards' }, { id: 'f2', text: '4 touchdowns' }, { id: 'f3', text: '118.6 rating' }, { id: 'f4', text: '9-2' }, { id: 'f5', text: '288 and 275 yards' }, { id: 'f6', text: '2024 and 2025 seasons' }, { id: 'f7', text: 'Week 12' }],
};
const norm = C.normalizeInput(shared);
assert.equal(norm.photo.src, '/p/mahomes-1.jpg', 'the top-ranked photo is the hero');
assert.equal(norm.photos.length, 2, 'the rest support it');
assert.equal(norm.cutout.src, '/c/mahomes-2.png', 'cut-out from url');
assert.equal(norm.cutout.fromPhoto, '/p/mahomes-2.jpg');
assert.equal(norm.logos[0].src, 'assets/logos/nfl/kc.webp');
assert.equal(norm.logos[0].name, 'Chiefs');
assert.deepEqual(C.normalizeInput(norm), norm, 'normalising is idempotent');
assert.equal(C.normalizeInput({ tone: 'neon' }).tone, undefined, 'unknown tone dropped');
assert.deepEqual(C.normalizeInput(null), {});
// Old-shape inputs build exactly as before through the normaliser.
const old = { palette: shared.palette, headline: 'Old shape', photo: { src: '/a.jpg' }, photos: [{ src: '/b.jpg', label: 'b' }, { src: '/c.jpg', label: 'c' }], cutout: { src: '/a.png' }, number: { value: '312', label: 'yards' }, logos: [{ src: 'x.webp', name: 'X' }] };
['hero-number', 'magazine-cover', 'photo-mosaic', 'duotone-hero', 'big-number'].forEach(id => assert.deepEqual(C.build(id, old, 0).layers, C.build(id, C.normalizeInput(old), 0).layers, `${id}: old shape unchanged`));
// Old archetypes read the shared shape too (url photos become the hero photo).
assert.ok(C.fits('magazine-cover', { headline: 'x', photos: [{ url: '/p.jpg' }] }));

// ── 4. Every look: fits the shared input, 3 distinct variants, gate-clean, every tone, every size ──
const STRICT = ['team-palette', 'safe-area', 'font-family', 'no-outlined-type', 'composed-effects', 'mist-opacity', 'logo-placement', 'type-hierarchy', 'logo-clear-space'];
// A record story for the record alert (it only fits records).
const inputFor = a => (a.id === 'record-alert' ? { ...shared, headline: 'Mahomes breaks the franchise record' } : shared);
LOOKS.forEach(a => {
  const shared = inputFor(a);
  assert.ok(C.fits(a.id, shared), `${a.id} fits the shared input`);
  assert.ok(a.fits(shared), `${a.id}: direct a.fits() reads the shared shape`);
  const scenes = C.candidates(a.id, shared, 3);
  assert.equal(new Set(scenes.map(s => JSON.stringify(s.layers))).size, 3, `${a.id}: three different variants`);
  const check = (scene, tag) => {
    assert.ok(scene.layers.length <= 34, `${tag}: layer budget (${scene.layers.length})`);
    assert.equal(scene.family, a.family);
    const checked = C.checkScene(JSON.parse(JSON.stringify(scene)));
    assert.ok(checked.ok, `${tag}: ${JSON.stringify(checked.errors)}`);
    const bad = checked.fixes.filter(f => STRICT.includes(f.rule));
    assert.deepEqual(bad, [], `${tag}: built inside the ES rules`);
    scene.layers.forEach(l => {
      if (l.font) assert.ok(C.FONTS[l.font], `${tag}: ES fonts only`);
      if (l.type === 'cutout') {
        assert.ok(!l.blur, `${tag}: the subject stays sharp`);
        assert.ok(!l.flip, `${tag}: athletes are never mirrored (jersey text)`);
        assert.ok(l.fx?.shadow, `${tag}: cut-outs carry a ground shadow`);
        if (l.rim) assert.ok(!['light', 'paper', 'editorial'].includes(scene.tone), `${tag}: rim light only on dark fields`);
      }
      if (l.mist) assert.equal(Math.max(...l.stops.map(s => s[1])), 0.9, `${tag}: mist at 90%`);
    });
  };
  scenes.forEach(scene => check(scene, `${a.id} v${scene.variant}`));
  a.tones.forEach(tone => {
    const scene = C.build(a.id, { ...shared, tone }, 0);
    assert.equal(scene.tone, tone, `${a.id}: draws in ${tone}`);
    check(scene, `${a.id} ${tone}`);
  });
  // A tone it does not support falls back to its first tone.
  const other = C.TONES.find(t => !a.tones.includes(t));
  if (other) assert.equal(C.build(a.id, { ...shared, tone: other }, 0).tone, a.tones[0], `${a.id}: unsupported tone falls back`);
  // Variant 2 crosses light / dark when the look has both.
  const light = new Set(['light', 'paper', 'editorial']);
  if (a.tones.some(t => light.has(t)) && a.tones.some(t => !light.has(t))) {
    assert.notEqual(light.has(scenes[0].tone), light.has(scenes[2].tone), `${a.id}: variant 2 changes mood`);
  }
  ['square', 'story'].forEach(size => check(C.build(a.id, { ...shared, size }, 0), `${a.id} ${size}`));
  check(C.build(a.id, { ...shared, swipe: true }, 0), `${a.id} swipe`);
});

// ── 4b. v1/v2 archetypes take the director's tone when it is one of theirs ──
{
  const rich = { ...shared, art: { src: 'proc:trophy' }, compare: { title: 'Yards', a: { label: 'KC', value: '312' }, b: { label: 'BUF', value: '288' } }, score: { a: { name: 'Chiefs', value: '312' }, b: { name: 'Bills', value: '288' }, tag: 'Final' }, sides: [{ title: 'Chiefs', number: { value: '312' } }, { title: 'Bills', number: { value: '288' } }] };
  let n = 0;
  C.ARCHETYPES.filter(a => !a.looks).forEach(a => {
    const input = a.id === 'unit-grid' ? { ...rich, number: { value: '118', label: 'yards' }, facts: [...rich.facts, { id: 'u', text: '118' }] } : rich;
    if (!C.fits(a.id, input)) return;
    assert.deepEqual(C.build(a.id, input, 0).layers, C.build(a.id, { ...input, tone: undefined }, 0).layers, `${a.id}: no tone, no change`);
    a.tones.forEach(tone => {
      const scene = C.build(a.id, { ...input, tone }, 0);
      assert.equal(scene.tone, tone, `${a.id}: scene.tone ${tone}`);
      assert.equal(scene.palette.toneName, tone);
      const checked = C.checkScene(JSON.parse(JSON.stringify(scene)));
      assert.ok(checked.ok, `${a.id} ${tone}: ${JSON.stringify(checked.errors)}`);
      n += 1;
    });
    const off = C.TONES.find(x => !a.tones.includes(x));
    if (off) assert.equal(C.build(a.id, { ...input, tone: off }, 0).palette.toneName, undefined, `${a.id}: an unsupported tone is ignored`);
  });
  assert.ok(n > 60, `old archetypes x tones (${n})`);
}

// ── 5. Defensive: missing fields never throw, they just do not fit ──────────
LOOKS.forEach(a => {
  [{}, { headline: 'Only a headline' }, { photos: [] }, { cutouts: [{}] }, { photos: [{ url: '' }], headshots: null, logos: 'x' }].forEach(input => {
    assert.doesNotThrow(() => C.fits(a.id, input), `${a.id}: fits never throws`);
  });
  assert.equal(C.fits(a.id, {}), false, `${a.id}: an empty input does not fit`);
});
assert.ok(C.fitting(shared).filter(id => C.BY_ID[id].looks).length >= 12, 'fitting() lists the looks');

// ── 6. Content rules (honest looks, every brief) ───────────────────────────
// Record alert only for record stories (a W-L record is not a broken record).
assert.ok(!C.fits('record-alert', { ...shared, headline: 'Mahomes cooks the Bills', kicker: 'Week 12' }), 'record alert needs a record story');
assert.ok(C.fits('record-alert', { ...shared, headline: 'Mahomes breaks the franchise record' }));
const alert = C.build('record-alert', { ...shared, headline: 'Record alert!', kicker: '' }, 0);
assert.equal(alert.layers.filter(l => /RECORD ALERT/.test(l.text || '')).length, 1, 'never the same phrase twice');
// Bars compare ONE measure (seasons or people), never a stat line.
const statLine = { ...shared, bars: undefined };
assert.ok(!C.fits('bar-race', statLine), 'yards / touchdowns / rating are not one measure');
assert.ok(C.fits('bar-race', { ...statLine, numbers: [{ value: '62', display: '62', label: '2022' }, { value: '58', display: '58', label: '2024' }] }), 'seasons are');
assert.ok(C.fits('bar-race', { ...statLine, numbers: [{ value: '30', display: '30', label: 'PPG', who: 'Curry' }, { value: '27', display: '27', label: 'PPG', who: 'James' }] }), 'players are');
// A ranked table needs rows (or 3+ different people), never one player's stat line ranked 1-2-3.
assert.ok(!C.fits('ranked-table', { ...shared, rows: undefined }), 'a stat line is not a ranking');
assert.ok(C.fits('ranked-table', { ...shared, rows: undefined, numbers: ['A Allen', 'B Burrow', 'C Jackson'].map((who, k) => ({ value: String(30 - k), display: String(30 - k), label: 'TDs', who })) }));
// Rank squares are ordinals: they pass the fact gate; any other stray number still fails.
const table = C.build('ranked-table', shared, 0);
assert.ok(C.checkScene(JSON.parse(JSON.stringify(table))).ok, 'ranks 1-3 are not invented numbers');
const forged = JSON.parse(JSON.stringify(table));
forged.layers.push({ type: 'text', role: 'label', ordinal: true, text: '99 yards', x: 60, y: 600, w: 300, h: 60, font: 'condensed', size: 30, color: forged.palette.ink });
assert.equal(C.checkScene(forged).ok, false, 'ordinal only covers a bare rank');
// Stat sheets never show the same value twice.
const sheet = C.build('stat-sheet', { ...shared, record: { value: '312', label: 'yards' } }, 0);
const shown = sheet.layers.filter(l => l.type === 'number').map(l => l.value);
assert.equal(new Set(shown).size, shown.length, 'no duplicated stat');
// Two voices need two different speakers with their own photos.
assert.equal(C.fits('quote-duo', { ...shared, quotes: [shared.quotes[0], shared.quotes[0]] }), false);
// The magazine split never prints the name twice (headline already names him).
const split = C.build('split-panel', shared, 0);
assert.equal(split.layers.filter(l => /MAHOMES/.test(l.text || '')).length, 1, 'name once');
assert.ok(split.layers.some(l => l.role === 'kicker' && l.text === 'WEEK 12'), 'the kicker leads instead');
// The post card only shows a real post (never a quote dressed as a tweet).
assert.equal(C.fits('post-card', { ...shared, post: null }), false);

// ── 7. Cut-out craft: depth and frame breaks ──────────────────────────────
const stack = C.build('stat-stack', shared, 0);
const order = stack.layers.map(l => l.type);
assert.ok(order.indexOf('number') < order.indexOf('cutout'), 'the number sits behind the player');
assert.ok(order.lastIndexOf('text') > order.indexOf('cutout'), 'the headline box sits over the figure');
assert.equal(stack.layers.find(l => l.type === 'photo').src, '/p/mahomes-2.jpg', 'the blurred field is the cut-out\'s own photo');
const broken = C.build('frame-break', shared, 0).layers.find(l => l.type === 'cutout');
assert.equal(broken.breakout.photo, '/p/mahomes-2.jpg', 'frame break registers the cut-out on its own photo');
assert.ok(broken.breakout.lift > 0, 'the head rises out of the frame');
const swapped = C.swapPhoto(C.build('frame-break', shared, 0), { from: '', to: '/p/new.jpg', cutout: '/c/new.png' });
assert.equal(swapped.layers.find(l => l.type === 'cutout').breakout.photo, '/p/new.jpg', 'swap photo keeps the frame and its cut-out together');
// Staggered highlight boxes are plain data the renderer reads (cover).
const cover = C.build('cover-boxes', shared, 0).layers.find(l => l.role === 'headline');
// gen5: the board's steps are in cap heights (box.cascade), boxes in the board style.
assert.ok(cover.box && Array.isArray(cover.box.cascade) && cover.box.cascade.some(n => n >= 0.5), 'ES staggered highlight boxes (deliberate steps)');
assert.equal(cover.box.style, 'board');
assert.equal(cover.phrase, true, 'cover boxes break at phrase boundaries');

console.log(`compose looks: ${LOOKS.length} looks x ${C.TONES.length} tones, shared input shape, content rules - ok`);
