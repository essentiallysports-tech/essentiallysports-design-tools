#!/usr/bin/env node
// ES Reels looks (reel-es-themes.js + reel-es.js): eight looks on one engine,
// with the ES video team's rules locked in code. Pure: no DOM, no network.
//   - every look passes validateLook (and a dark, a light, a red and 60 other
//     team colours do too); looks that break a rule are refused
//   - the contrast matrix of every look
//   - signal colours are never remapped (green win, red loss, yellow emphasis)
//   - the slab wipe has the same geometry and timing in every look
//   - the ES mark is on the hook and the end card only, same place and size
//   - fonts, the caption line, the safe frame, LIMITS and the end card are locked
//   - Paper parity: a reel with no look draws exactly what the engine drew
//     before looks existed (golden draw calls, scripts/lib/reel-looks-golden.mjs)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STORIES, STORY_IDS, optsFor, measure, frameDigests, frameLog } from './lib/reel-looks-samples.mjs';

const require = createRequire(import.meta.url);
const TH = require('../reel-es-themes.js');
const E = require('../reel-es.js');
const R = require('../reel-render.js');
const L = require('../reel-lint.js');
const S = require('../reel-styles.js');
const F = require('../reel-formats.js');
const D = require('../netlify/functions/_reel-director.js');
const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
const TEAMS = { dark: '#0B162A', light: '#FFB612', red: '#C8102E' };
// Every look as it is used: the Team colour look once per sample team colour.
const VARIANTS = TH.LOOK_IDS.flatMap(id => (id === 'team' ? Object.entries(TEAMS).map(([k, hex]) => ({ id, team: hex, name: `team-${k}` })) : [{ id, team: '', name: id }]));
const build = (story, v, aspect = '9:16', extra = {}) => R.buildTimeline(STORIES[story], optsFor(story, { look: v.id, aspect, team: v.team ? { name: 'Team', colors: [v.team] } : null, ...extra }));
const lint = tl => L.lintTimeline(tl, { boxes: R.textBoxes(measure, tl), measure });
const clone = o => JSON.parse(JSON.stringify(o));
// A spread of team colours: greys, primaries, pastels, near-black, near-white.
const SPREAD = [];
for (let h = 0; h < 360; h += 30) for (const [sat, lig] of [[0.9, 0.12], [0.85, 0.3], [0.9, 0.5], [0.8, 0.7], [0.6, 0.88]]) {
  const f = n => { const k = (n + h / 30) % 12; const a = sat * Math.min(lig, 1 - lig); return Math.round(255 * (lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  SPREAD.push(`#${f(0)}${f(8)}${f(4)}`.toUpperCase());
}
SPREAD.push('#000000', '#FFFFFF', '#7F7F7F', '#0A7DFA', '#121212', '#F1EFEA', '#1BC47D', '#E8322B', '#FFC52F');

// ─── The looks as data ───────────────────────────────────────────────────
await test('looks: Paper (the default), Ink, Blue, Team colour, Photo-led, Data-led, Minimal and Bold, each one data with every role', () => {
  assert.deepEqual(TH.LOOK_IDS, ['paper', 'ink', 'blue', 'team', 'photo', 'data', 'minimal', 'bold']);
  assert.equal(TH.DEFAULT_LOOK, 'paper');
  assert.deepEqual(E.LOOK_IDS, TH.LOOK_IDS);
  assert.equal(E.LOOKS, TH.LOOKS);
  assert.deepEqual(TH.TOKENS, E.TOKENS, 'one set of brand tokens');
  assert.deepEqual(TH.LOOK_IDS.map(id => TH.LOOKS[id].label), ['Paper', 'Ink', 'Blue', 'Team colour', 'Photo-led', 'Data-led', 'Minimal', 'Bold']);
  TH.LOOK_IDS.forEach(id => {
    const l = TH.LOOKS[id];
    assert.equal(l.id, id);
    assert.ok(l.label && l.blurb && l.blurb.length <= 62, `${id} has a short blurb`);
    assert.ok(TH.GROUNDS.includes(l.ground), `${id} ground`);
    ['text', 'accent', 'pillFill', 'pillInk', 'pillAlt', 'captionFill', 'captionInk', 'captionEmphasis', 'mark', 'wipe', 'dotBase', 'grain'].forEach(r => assert.ok(l.roles[r] != null, `${id} role ${r}`));
    assert.ok(['boxed', 'plain', 'big'].includes(l.pill), `${id} pill treatment`);
    assert.equal(l.caption.box, 'hug');
    assert.ok(TH.LAYOUTS[l.layout], `${id} layout preset`);
    assert.ok(TH.MOTIONS[l.motion], `${id} motion preset`);
    assert.equal(JSON.stringify(l), JSON.stringify(clone(l)), `${id} is plain data (no functions)`);
  });
  // Paper is today's look, to the letter.
  const p = TH.LOOKS.paper;
  assert.deepEqual([p.ground, p.roles.text, p.roles.accent, p.roles.pillFill, p.roles.captionFill, p.roles.captionInk, p.roles.wipe, p.roles.grain, p.layout, p.motion], ['paper', 'ink', 'blue', 'ink', 'ink', 'white', ['blue', 'ink'], 0.05, 'standard', 'standard']);
  assert.deepEqual(p.scenes, { quote: 'ink' }, 'the kit\'s quote sits on ink');
  // Each look is its own thing: no two share ground + pill fill + layout + quote surface.
  const sig = TH.LOOK_IDS.map(id => { const l = TH.LOOKS[id]; return [l.ground, l.roles.pillFill, l.layout, l.scenes.quote || '', l.pill].join('|'); });
  assert.equal(new Set(sig).size, sig.length, 'every look is distinct');
  assert.equal(TH.lookId('nope'), 'paper');
  assert.equal(TH.lookId(undefined), 'paper');
});

await test('validateLook: every look is valid, with a dark, a light and a red team colour and 69 others', () => {
  TH.LOOK_IDS.forEach(id => {
    assert.deepEqual(TH.validateLook(TH.LOOKS[id]), [], id);
    Object.values(TEAMS).forEach(hex => assert.deepEqual(TH.validateLook(TH.LOOKS[id], { team: hex }), [], `${id} with ${hex}`));
  });
  assert.ok(SPREAD.length >= 69);
  // A few mid-tones (a pure red) carry neither white nor ink text at 4.5:1:
  // validateLook refuses exactly those as a ground, and the look falls back to ink.
  let weak = 0;
  SPREAD.forEach(hex => {
    const out = TH.validateLook(TH.LOOKS.team, { team: hex });
    if (TH.teamCarriesText(hex)) { assert.deepEqual(out, [], `team colour ${hex}`); assert.equal(TH.resolve('team', { team: hex }).teamWeak, false); return; }
    weak += 1;
    assert.ok(out.length && out.every(m => /text on the team ground|source line on the team ground/.test(m)), `${hex}: refused for text contrast only (${out.join(' | ')})`);
    const theme = TH.resolve('team', { team: hex });
    assert.equal(theme.teamWeak, true);
    assert.equal(theme.base.ground, 'ink', `${hex}: the reel stays on ink`);
    assert.equal(theme.base.fill.blue, 'team', `${hex}: the colour is kept for a pill`);
    assert.equal(theme.wipe[0], 'team');
  });
  assert.ok(weak >= 1 && weak <= 6, `${weak} of ${SPREAD.length} team colours cannot carry text`);
  assert.equal(TH.teamCarriesText('#F20D0D'), false);
  assert.equal(E.validateLook, TH.validateLook);
});

await test('validateLook refuses: remapped signals, non-token colours, low contrast, locked rules, motion outside the kit', () => {
  const bad = (change, re, base = 'paper') => { const l = clone(TH.LOOKS[base]); l.id = 'x'; change(l); const out = TH.validateLook(l, { team: TEAMS.dark }); assert.ok(out.length, `refused: ${re}`); assert.match(out.join(' | '), re); };
  // Signal meanings: green win, red loss, yellow caption emphasis.
  bad(l => { l.roles.captionEmphasis = 'green'; }, /caption emphasis must be yellow/);
  bad(l => { l.roles.captionEmphasis = 'white'; }, /caption emphasis must be yellow/);
  bad(l => { l.roles.pillFill = 'green'; }, /green means a win/);
  bad(l => { l.roles.accent = 'red'; }, /signal colour cannot be a accent colour/);
  bad(l => { l.roles.text = 'yellow'; }, /signal colour cannot be a text colour/);
  bad(l => { l.roles.wipe = ['red', 'ink']; }, /the wipe uses red/);
  bad(l => { l.ground = 'green'; }, /not a brand ground/);
  bad(l => { l.signals = { green: 'loss' }; }, /cannot redefine the signal colours/);
  // Tokens only (one team colour, and only on the Team colour look).
  bad(l => { l.roles.accent = '#FF00AA'; }, /not a brand token/);
  bad(l => { l.roles.pillFill = 'navy'; }, /not a brand token/);
  bad(l => { l.roles.wipe = ['team', 'ink']; }, /not a brand token/);
  bad(l => { l.ground = 'team'; }, /only the Team colour look/);
  bad(l => { l.roles.mark = 'white'; }, /the ES mark is blue, or black on ES blue/);
  assert.match(TH.validateLook(TH.LOOKS.team, { team: 'tomato' }).join(' '), /not a hex colour/);
  // Contrast: 4.5:1 for reading text.
  bad(l => { l.roles.captionInk = 'paper'; l.roles.captionFill = 'white'; }, /caption words: paper on white is 1\.\d+:1 \(needs 4\.5:1\)/);
  bad(l => { l.roles.captionFill = 'blue'; }, /caption words: white on blue is 3\.\d+:1/);
  bad(l => { l.roles.captionFill = 'paper'; l.roles.captionInk = 'ink'; }, /caption emphasis: yellow on paper/);
  bad(l => { l.surface = 'blue'; }, /role text|ground paper does not match/);
  // A look says what it draws: roles must agree with its surface.
  bad(l => { l.roles.text = 'white'; }, /role text says white/);
  bad(l => { l.roles.pillInk = 'ink'; }, /pill ink ink does not match/);
  // Locked by the kit: a look cannot carry these at all.
  ['fonts', 'type', 'safe', 'captionY', 'markBlocks', 'limits', 'wipeMs', 'wipeSkewDeg', 'endcard'].forEach(k => bad(l => { l[k] = 1; }, new RegExp(`"${k}" is locked by the ES kit`)));
  // Motion stays inside the kit: entrances 0.35-0.45 s, stagger 150-180 ms.
  bad(l => { l.motion = { enterMs: 300, staggerMs: 160 }; }, /entrances take 300 ms/);
  bad(l => { l.motion = { enterMs: 400, staggerMs: 90 }; }, /the stagger is 90 ms/);
  bad(l => { l.motion = 'bouncy'; }, /unknown motion preset/);
  bad(l => { l.layout = 'freeform'; }, /unknown layout preset/);
  bad(l => { l.roles.wipe = ['ink', 'ink']; }, /two different colours/);
  bad(l => { l.caption = { box: 'pill', emphasis: 'text' }; }, /captions are one hug box/);
  bad(l => { l.scenes = { quote: 'neon' }; }, /unknown surface/);
  assert.deepEqual(TH.validateLook(null), ['The look has no id.']);
  Object.values(TH.MOTIONS).forEach(m => {
    assert.ok(m.enterMs >= E.MOTION.enterMinMs && m.enterMs <= E.MOTION.enterMaxMs, `${m.id} entrance inside the kit`);
    assert.ok(m.staggerMs >= E.MOTION.staggerMinMs && m.staggerMs <= E.MOTION.staggerMaxMs, `${m.id} stagger inside the kit`);
  });
  assert.deepEqual([TH.MOTION_LIMITS.enterMinMs, TH.MOTION_LIMITS.enterMaxMs, TH.MOTION_LIMITS.staggerMinMs, TH.MOTION_LIMITS.staggerMaxMs], [E.MOTION.enterMinMs, E.MOTION.enterMaxMs, E.MOTION.staggerMinMs, E.MOTION.staggerMaxMs]);
});

await test('contrast matrix: reading text 4.5:1 and accents 3:1 on every surface of every look; signals 3:1 off paper', () => {
  assert.ok(Math.abs(TH.contrast('#FFFFFF', '#000000') - 21) < 0.01);
  assert.ok(Math.abs(TH.contrast('#FFFFFF', TH.TOKENS.blue) - 3.95) < 0.05, 'white on ES blue is under 4.5: it is never a reading-text pair');
  assert.ok(TH.contrast(TH.TOKENS.ink, TH.TOKENS.blue) >= 4.5, 'ink on ES blue reads');
  VARIANTS.forEach(v => {
    const rows = TH.contrastMatrix(v.id, { team: v.team });
    assert.ok(rows.length >= 2, v.name);
    rows.forEach(r => {
      assert.ok(r.text >= 4.5, `${v.name} ${r.surface}: text ${r.text.toFixed(2)}`);
      assert.ok(r.accent >= 3, `${v.name} ${r.surface}: accent ${r.accent.toFixed(2)}`);
      if (r.surface === 'caption') return;
      assert.ok(r.pill >= 3, `${v.name} ${r.surface}: pill ${r.pill.toFixed(2)}`);
      // The kit's own pairings on paper and white are the kit's (green words on
      // paper are 1.97:1 in today's look): they are recorded, not re-judged.
      const kit = ['#F1EFEA', '#FFFFFF'].includes(r.ground.toUpperCase()) && !r.plate;
      if (!kit) { assert.ok(r.green >= 3, `${v.name} ${r.surface}: green ${r.green.toFixed(2)}`); assert.ok(r.red >= 3, `${v.name} ${r.surface}: red ${r.red.toFixed(2)}`); }
    });
  });
  // Any team colour: text on it reads, whatever the colour.
  // (a colour that cannot carry text is not the ground: the matrix is of what is drawn.)
  SPREAD.forEach(hex => TH.contrastMatrix('team', { team: hex }).forEach(r => { assert.ok(r.text >= 4.5, `${hex} ${r.surface} text ${r.text.toFixed(2)}`); assert.ok(r.accent >= 3, `${hex} ${r.surface} accent ${r.accent.toFixed(2)}`); }));
  // Dark and light team colours pick opposite inks; the mark turns black only near ES blue.
  assert.equal(TH.teamSurface(TEAMS.dark).text.ink, 'white');
  assert.equal(TH.teamSurface(TEAMS.light).text.ink, 'ink');
  assert.equal(TH.teamSurface(TEAMS.red).mark, 'blue');
  assert.equal(TH.teamSurface('#0A7DFA').mark, 'black');
  assert.equal(TH.SURFACES.blue.mark, 'black');
});

// ─── Signals ─────────────────────────────────────────────────────────────
await test('signals never remapped: green, red and yellow draw as themselves in every look; no look adds or drops one', () => {
  const SIG = { green: '#1BC47D', red: '#E8322B', yellow: '#FFC52F' };
  VARIANTS.forEach(v => {
    const theme = TH.resolve(v.id, { team: v.team });
    Object.entries(SIG).forEach(([n, hex]) => assert.equal(theme.hex(n), hex, `${v.name}: ${n} is ${hex}`));
    Object.values(theme.surfaces).filter(Boolean).forEach(s => {
      E.SIGNALS.forEach(n => { assert.equal(s.text[n], undefined, `${v.name} ${s.id}: ${n} text is not remapped`); assert.equal(s.fill[n], undefined, `${v.name} ${s.id}: ${n} fill is not remapped`); });
      assert.ok(!Object.values(s.text).concat(Object.values(s.fill)).some(c => E.SIGNALS.includes(c)), `${v.name} ${s.id}: nothing becomes a signal colour`);
    });
    assert.equal(theme.caption.em, 'yellow', `${v.name}: caption emphasis is yellow`);
    STORY_IDS.forEach(story => {
      const tl = build(story, v);
      tl.tracks.graphics.forEach(g => {
        const block = g.data.block;
        const want = new Set(E.signalsIn(block, '').filter(c => c !== 'yellow'));
        const ops = R.layoutGraphic(measure, g, tl);
        const used = new Set();
        ops.forEach(op => { [op.color, op.fill].forEach(c => { if (E.SIGNALS.includes(c)) used.add(c); }); if (op.type === 'dots' && op.hi) used.add('green'); });
        assert.deepEqual([...used].sort(), [...want].sort(), `${v.name} ${story} ${block.type}: signals on screen are the block's own`);
      });
      // Drawn colours: an emphasised caption word shows yellow.
      const em = tl.tracks.captions.cards.find(c => c.words.some(i => tl.tracks.captions.words[i].em));
      if (em) assert.ok(frameLog(R, tl, em.e - 20).some(c => c[0] === '=fillStyle' && c[1] === SIG.yellow), `${v.name} ${story}: the emphasised caption word draws yellow`);
    });
    const dots = build('scale', v);
    const g = dots.tracks.graphics[1];
    assert.ok(frameLog(R, dots, g.outMs - 80).some(c => c[0] === '=fillStyle' && c[1] === SIG.green), `${v.name}: the highlighted dot draws green`);
  });
  // The stamp is red in every look; the block's signal limit is unchanged.
  VARIANTS.forEach(v => { const tl = build('stat', v); const st = R.layoutGraphic(measure, tl.tracks.graphics[0], tl).find(o => o.role === 'stamp'); assert.equal(st.fill, 'red', v.name); });
  assert.equal(E.LIMITS.signalsPerBeat, 2);
});

// ─── Locked: the wipe ────────────────────────────────────────────────────
await test('slab wipe: identical geometry, skew and 0.5 s in every look; only its two colours come from the look', () => {
  assert.equal(E.MOTION.wipeMs, 500);
  assert.equal(E.MOTION.wipeSkewDeg, -14);
  assert.equal(S.STYLES.es.motion.transitionMs, 500);
  [[1080, 1920], [1080, 1350]].forEach(size => {
    const geo = E.geometry(size);
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const base = E.slabs(p, geo);
      VARIANTS.forEach(v => {
        const theme = TH.resolve(v.id, { team: v.team });
        const mine = E.slabs(p, geo, theme);
        assert.deepEqual(mine.map(s => s.poly), base.map(s => s.poly), `${v.name} p=${p.toFixed(2)} ${size[1]}: same polygons`);
        assert.deepEqual(mine.map(s => [s.x, s.w, s.lean]), base.map(s => [s.x, s.w, s.lean]));
        mine.forEach((s, i) => assert.equal(s.color, base[i].color === 'blue' ? theme.wipe[0] : theme.wipe[1], `${v.name}: slab colours are the look's pair`));
      });
    }
  });
  VARIANTS.forEach(v => {
    const theme = TH.resolve(v.id, { team: v.team });
    assert.equal(theme.wipe.length, 2);
    assert.notEqual(theme.hex(theme.wipe[0]), theme.hex(theme.wipe[1]), `${v.name}: two different slabs`);
    theme.wipe.forEach(c => assert.ok(!E.SIGNALS.includes(c), `${v.name}: no signal colour in the wipe`));
    // Every cut is still the slab, half a second, in every look.
    const tl = build('news', v);
    const g = tl.tracks.graphics[1];
    const mid = R.frameAt(tl, g.inMs + 250);
    assert.equal(mid.transition.kind, 'slab', v.name);
    assert.ok(Math.abs(mid.transition.p - 0.5) < 0.01);
    assert.equal(R.frameAt(tl, g.inMs + 510).transition, null);
  });
  assert.deepEqual(TH.resolve('paper').wipe, ['blue', 'ink'], 'Paper: blue, then ink');
});

// ─── Locked: the marks ───────────────────────────────────────────────────
await test('ES mark: on the hook and the end card only, 80 px, right 60, top 330, in every look; blue, or black on ES blue', () => {
  VARIANTS.forEach(v => ['9:16', '4:5'].forEach(aspect => STORY_IDS.forEach(story => {
    const tl = build(story, v, aspect);
    const mk = E.markRect(tl.size);
    assert.deepEqual([mk.w, mk.h, mk.x], [80, 80, 940]);
    assert.equal(mk.y, aspect === '9:16' ? 330 : Math.round(330 * 1350 / 1920));
    const places = R.logoPlacements(tl);
    assert.deepEqual(places.map(p => p.beat), [tl.tracks.graphics[0].beat, tl.tracks.graphics[tl.tracks.graphics.length - 1].beat], `${v.name} ${story}: hook and end card only`);
    places.forEach(p => assert.deepEqual([p.x, p.y, p.w, p.h], [mk.x, mk.y, 80, 80]));
    tl.tracks.graphics.forEach(g => {
      const log = frameLog(R, tl, Math.min(g.outMs - 60, g.inMs + 2400));
      const at = log.findIndex(c => c[0] === 'fillRect' && c[1] === mk.x && c[2] === mk.y && c[3] === 80 && c[4] === 80);
      const shows = E.MARK_BLOCKS.has(g.data.block.type);
      assert.equal(at >= 0, shows, `${v.name} ${story} ${aspect} ${g.data.block.type}: mark ${shows ? 'drawn' : 'absent'}`);
      if (at >= 0) {
        const fill = log.slice(0, at).reverse().find(c => c[0] === '=fillStyle')[1];
        assert.ok(['#0A7DFA', '#000000'].includes(fill), `${v.name}: the mark is blue or black (${fill})`);
      }
    });
  })));
  assert.deepEqual([...E.MARK_BLOCKS], ['hook', 'endcard']);
  // Black on ES blue (the brand guide), blue once a photo is under it.
  const blue = build('news', { id: 'blue', team: '' });
  assert.equal(E.markVariantFor(TH.resolve('blue'), 'hook', R.layoutGraphic(measure, blue.tracks.graphics[0], blue), E.markRect(blue.size)), 'black');
  const photo = build('photo', { id: 'blue', team: '' });
  assert.equal(E.markVariantFor(TH.resolve('blue'), 'hook', R.layoutGraphic(measure, photo.tracks.graphics[0], photo), E.markRect(photo.size)), 'blue');
  assert.equal(E.markVariantFor(TH.resolve('paper'), 'hook', [], E.markRect([1080, 1920])), 'blue');
});

// ─── Locked: fonts, caption line, safe frame, limits, end card ───────────
await test('locked in every look: two typefaces, the caption line, the safe frame, LIMITS, the end card last for 3 s', () => {
  const families = new Set();
  const capBase = {};
  VARIANTS.forEach(v => ['9:16', '4:5'].forEach(aspect => STORY_IDS.forEach(story => {
    const tl = build(story, v, aspect);
    tl.tracks.graphics.forEach(g => R.layoutGraphic(measure, g, tl).forEach(op => { if (op.font) families.add(op.font.replace(/^\d+ [\d.]+px /, '')); }));
    // Captions: the same boxes in every look (one line, centred on the caption line).
    const caps = JSON.stringify(tl.tracks.captions.cards.map(card => { const c = R.layoutCaption(measure, card, tl); return [c.box, c.size, c.ops.map(o => [o.x, o.y, o.text])]; }));
    const key = `${story}@${aspect}`;
    if (v.id === 'paper') capBase[key] = caps;
    else assert.equal(caps, capBase[key], `${v.name} ${key}: captions sit where Paper's do`);
    const geo = E.geometry(tl.size);
    tl.tracks.captions.cards.forEach(card => { const c = R.layoutCaption(measure, card, tl); assert.ok(Math.abs(c.box.y + c.box.h / 2 - geo.captionY) < 0.5, `${v.name} ${key}: caption on the caption line`); });
    // Safe frame: no word box leaves it, in any look.
    R.textBoxes(measure, tl).forEach(b => assert.ok(!E.outsideSafe(b, tl.size), `${v.name} ${key}: “${b.text || b.role}” inside the safe frame`));
    // End card: last, 3 s.
    const last = tl.tracks.graphics[tl.tracks.graphics.length - 1];
    assert.equal(last.data.block.type, 'endcard');
    assert.equal(last.outMs - last.inMs, E.LIMITS.endcardMs);
    assert.equal(tl.tracks.graphics.filter(g => g.data.block.type === 'endcard').length, 1);
  })));
  assert.deepEqual([...families].sort(), [E.TYPE.display, E.TYPE.small].sort(), 'display and small type only, in every look');
  assert.deepEqual(E.LIMITS, { pillChars: 14, pills: 3, lineChars: 14, lines: 3, quoteChars: 70, dotsMax: 2600, compareMin: 2, compareMax: 4, digits: 6, signalsPerBeat: 2, endcardMs: 3000, wordsPerSecond: 2.6 });
  assert.deepEqual([E.GEO.safe, E.GEO.captionY, E.GEO.col], [{ top: 300, bottom: 1640, side: 40 }, 1172, { x: 60, w: 960 }]);
  // Timing is the script's, not the look's: every look has the same scene times.
  const times = v => build('news', v).tracks.graphics.map(g => [g.inMs, g.outMs]);
  VARIANTS.forEach(v => assert.deepEqual(times(v), times(VARIANTS[0]), `${v.name}: same scene times as Paper`));
});

// ─── Paper parity ────────────────────────────────────────────────────────
await test('Paper parity: no look, look "paper" and an unknown look draw exactly what the engine drew before looks (golden draw calls)', () => {
  const gold = JSON.parse(read('./fixtures/reels/es-paper-golden.json'));
  let frames = 0;
  STORY_IDS.forEach(story => ['9:16', '4:5'].forEach(aspect => {
    const want = gold.frames[`${story}@${aspect}`];
    const tl = R.buildTimeline(STORIES[story], optsFor(story, { aspect }));
    assert.equal(tl.look, 'paper');
    assert.equal(tl.durationMs, want.durationMs, `${story}@${aspect}: same length`);
    assert.deepEqual(tl.size, want.size);
    const got = frameDigests(R, tl, gold.stepMs);
    const at = got.findIndex((d, i) => d !== want.digests[i]);
    assert.equal(at, -1, `${story}@${aspect}: frame ${at} (t=${at * gold.stepMs} ms) draws differently from the golden copy`);
    assert.equal(got.length, want.digests.length);
    frames += got.length;
    // A timeline saved before looks has no look field at all.
    const old = { ...tl };
    delete old.look;
    assert.deepEqual(frameDigests(R, old, gold.stepMs), want.digests, `${story}@${aspect}: no look = Paper`);
    assert.deepEqual(frameDigests(R, { ...tl, look: 'not-a-look' }, gold.stepMs * 5), want.digests.filter((d, i) => i % 5 === 0), `${story}@${aspect}: an unknown look = Paper`);
  }));
  assert.ok(frames > 1500, `${frames} golden frames compared`);
  // The layout ops are the same too (lint and the safe-frame maths read these).
  const tl = R.buildTimeline(STORIES.stat, optsFor('stat'));
  const noLook = { ...tl }; delete noLook.look;
  tl.tracks.graphics.forEach(g => assert.deepEqual(R.layoutGraphic(measure, g, tl), R.layoutGraphic(measure, g, noLook)));
  assert.equal(E.themeOf({}).id, 'paper');
  assert.equal(E.themeOf(null).id, 'paper');
  assert.equal(E.colorOf('blue'), '#0A7DFA');
  assert.equal(E.colorOf('ink', E.themeOf({ look: 'ink' })), '#121212');
  assert.equal(E.inkOn('blue'), 'white');
  assert.equal(E.inkOn('yellow'), 'ink');
  assert.equal(E.inkOn('paper'), 'ink');
  assert.equal(typeof E.drawGround, 'function');
  assert.equal(typeof E.drawPaper, 'function', 'the old name is kept');
});

// ─── Every other look really is different ────────────────────────────────
await test('every look draws differently from Paper and from each other, on the same story', () => {
  const sig = v => frameDigests(R, build('news', v), 400).join('') + frameDigests(R, build('photo', v), 400).join('') + frameDigests(R, build('quote', v), 400).join('');
  const all = VARIANTS.map(v => [v.name, sig(v)]);
  assert.equal(new Set(all.map(a => a[1])).size, all.length, 'no two looks draw the same reel');
  // What changes is what the look says: ground, pills, captions.
  const fills = (v, story, i) => { const tl = build(story, v); const g = tl.tracks.graphics[i]; return frameLog(R, tl, Math.min(g.outMs - 60, g.inMs + 2400)).filter(c => c[0] === '=fillStyle').map(c => c[1]); };
  assert.equal(fills({ id: 'ink' }, 'news', 0)[0], '#121212');
  assert.equal(fills({ id: 'blue' }, 'news', 0)[0], '#0A7DFA');
  assert.equal(fills({ id: 'data' }, 'news', 0)[0], '#FFFFFF');
  assert.equal(fills({ id: 'team', team: TEAMS.light }, 'news', 0)[0], TEAMS.light);
  assert.ok(fills({ id: 'blue' }, 'news', 3).includes('#121212'), 'Blue: figures drop to an ink board');
  // The quote follows the look's ground in Ink and Blue; Paper and Bold keep the kit's ink quote.
  assert.deepEqual([TH.LOOKS.paper.scenes.quote, TH.LOOKS.bold.scenes.quote, TH.LOOKS.ink.scenes.quote, TH.LOOKS.blue.scenes.quote], ['ink', 'ink', undefined, undefined]);
  ['ink', 'blue', 'photo', 'minimal'].forEach(id => { const tl = build('quote', { id }); assert.ok(!R.layoutGraphic(measure, tl.tracks.graphics[1], tl).some(o => o.role === 'ground'), `${id}: the quote stays on the look's ground`); });
  assert.ok(!fills({ id: 'ink' }, 'quote', 1).includes('#F1EFEA') || fills({ id: 'ink' }, 'quote', 1)[0] === '#121212', 'Ink: the quote scene starts on ink');
  assert.equal(fills({ id: 'ink' }, 'quote', 1)[0], '#121212');
  assert.equal(fills({ id: 'blue' }, 'quote', 1)[0], '#0A7DFA');
  // Layout presets: Bold's pills are bigger, Minimal has no boxes, Photo-led boxes its statements over a full photo.
  const ops = (v, story, i) => { const tl = build(story, v); return R.layoutGraphic(measure, tl.tracks.graphics[i], tl); };
  const pill = v => ops(v, 'quote', 0).find(o => o.role === 'pill');
  assert.ok(pill({ id: 'bold' }).size > pill({ id: 'paper' }).size * 1.2);
  // v3: Bold's pills are the Display step of the one type scale.
  assert.equal(pill({ id: 'bold' }).size, E.TYPE_SCALE.display);
  assert.ok(E.onScale(pill({ id: 'paper' }).size));
  assert.ok(!pill({ id: 'minimal' }).fill && pill({ id: 'paper' }).fill === 'ink');
  const st = ops({ id: 'photo' }, 'photo', 1);
  assert.deepEqual(st.find(o => o.type === 'media'), { type: 'media', role: 'media', x: 0, y: 0, w: 1080, h: 1920 });
  assert.ok(st.filter(o => o.role === 'line').every(o => o.fill), 'Photo-led: boxed lines over the photo');
  assert.ok(ops({ id: 'paper' }, 'photo', 1).find(o => o.type === 'media').y >= 720, 'Paper: the photo sits below the lines');
  assert.ok(ops({ id: 'data' }, 'stat', 2).find(o => o.role === 'number').size >= ops({ id: 'paper' }, 'stat', 2).find(o => o.role === 'number').size);
  // A red line on ES blue would not read: it sits on an ink plate, inside the column.
  const plated = ops({ id: 'blue' }, 'quote', 2).find(o => o.text === 'MONDAY.');
  assert.deepEqual([plated.color, plated.fill, plated.plated], ['red', 'ink', true]);
  assert.ok((plated.box || E.hugBox(plated.x, plated.y, plated.w, plated.size)).x >= 60 - 0.5);
  assert.ok(!ops({ id: 'paper' }, 'quote', 2).find(o => o.text === 'MONDAY.').fill, 'Paper keeps the kit pairing');
  // Motion presets reach the entrance and the stagger.
  assert.equal(TH.resolve('minimal').motion.enterMs, 450);
  assert.equal(TH.resolve('bold').motion.staggerMs, 150);
  assert.equal(ops({ id: 'bold' }, 'quote', 0)[1].delay, 150);
  assert.ok(E.enterState({ enter: 'up', delay: 0 }, 200, TH.resolve('minimal').motion).p < E.enterState({ enter: 'up', delay: 0 }, 200).p);
});

// ─── buildTimeline, lint ─────────────────────────────────────────────────
await test('buildTimeline writes timeline.look from opts.look, else plan.look, else paper; only ES timelines carry one', () => {
  const b = (plan, opts) => R.buildTimeline(plan, { style: 'es', ...opts });
  assert.equal(b(STORIES.stat, {}).look, 'paper');
  assert.equal(b({ ...STORIES.stat, look: 'ink' }, {}).look, 'ink');
  assert.equal(b({ ...STORIES.stat, look: 'ink' }, { look: 'bold' }).look, 'bold');
  assert.equal(b({ ...STORIES.stat, look: 'zzz' }, {}).look, 'paper');
  assert.equal(b(STORIES.stat, { look: 'zzz' }).look, 'paper');
  assert.equal('look' in R.buildTimeline(STORIES.stat, { style: 'classic', look: 'ink' }), false, 'a retired style has no look');
  assert.equal(E.themeOf(b(STORIES.stat, { look: 'team', team: { name: 'T', colors: [TEAMS.light] } })).team, TEAMS.light);
  assert.equal(E.themeOf(b(STORIES.stat, { look: 'team' })).teamMissing, true);
});

await test('lint: every look is clean on all six stories at 9:16 and 4:5; the look checks catch what a look cannot fix', () => {
  VARIANTS.forEach(v => ['9:16', '4:5'].forEach(aspect => STORY_IDS.forEach(story => {
    const res = lint(build(story, v, aspect));
    const bad = res.issues.filter(i => i.severity !== 'info' && i.id !== 'rights');
    assert.deepEqual(bad.map(i => `${i.id}: ${i.message}`), [], `${v.name} ${story} ${aspect}`);
    assert.ok(E.checklist(res.issues).find(r => r.id === 'look').ok);
  })));
  // 60+ team colours: the reel stays clean (text, pills, plates, end card).
  SPREAD.forEach(hex => {
    const res = lint(build('quote', { id: 'team', team: hex }));
    assert.deepEqual(res.issues.filter(i => i.id === 'look' && i.severity !== 'info').map(i => i.message), [], `team colour ${hex}`);
  });
  // The Team colour look with no team says so (and draws in ES blue).
  const none = lint(build('news', { id: 'team', team: '' }));
  assert.ok(none.issues.some(i => i.id === 'look' && i.severity === 'info' && /needs a team/.test(i.message)));
  assert.equal(E.themeOf(build('news', { id: 'team', team: '' })).hex('team'), '#0A7DFA');
  // A number set to white on paper cannot be read: the look check says so.
  const white = clone(STORIES.stat); white.beats[2].block.color = 'white';
  const w = lint(R.buildTimeline(white, optsFor('stat')));
  assert.ok(w.issues.some(i => i.id === 'look' && i.severity === 'critical' && /white on paper/.test(i.message)));
  assert.equal(E.checklist(w.issues).find(r => r.id === 'look').ok, false);
  // An unknown look is flagged (and drawn as Paper).
  const tl = build('stat', { id: 'paper', team: '' }); tl.look = 'neon';
  assert.ok(lint(tl).issues.some(i => i.id === 'look' && /not an ES look/.test(i.message)));
  // Hints, never errors: Photo-led without photos, Data-led without figures.
  assert.ok(lint(build('news', { id: 'photo', team: '' })).issues.some(i => i.id === 'look' && i.severity === 'info' && /no photo yet/.test(i.message)));
  assert.ok(lint(build('quote', { id: 'data', team: '' })).issues.some(i => i.id === 'look' && i.severity === 'info' && /at least two number, dots or compare/.test(i.message)));
  assert.ok(!lint(build('comparison', { id: 'data', team: '' })).issues.some(i => i.id === 'look'));
  // Words straight on a photo are refused (a layout that forgot the box).
  const p = build('photo', { id: 'paper', team: '' });
  const naked = (m, g, t) => E.layoutBlock(m, g, t).map(o => (o.type === 'media' ? { ...o, y: 0, h: 1920 } : o));
  assert.ok(E.lookChecks(p, { measure, layout: naked }).some(i => i.severity === 'critical' && /on the photo without a box/.test(i.message)));
  // A reel still in a retired style is flagged.
  assert.ok(lint(R.buildTimeline(STORIES.stat, { style: 'series' })).issues.some(i => i.id === 'look' && /retired/.test(i.message)));
});

// ─── Old styles retired; data formats ────────────────────────────────────
await test('old styles retired: ES only in the picker, each retired style has a closest look, old beats land on ES blocks', () => {
  assert.deepEqual(S.STYLE_IDS, ['es']);
  assert.deepEqual(TH.LEGACY_STYLE_LOOKS, { classic: 'photo', explainer: 'data', series: 'ink', countdown: 'paper' });
  S.LEGACY_STYLE_IDS.forEach(id => { assert.ok(TH.LOOKS[E.lookForStyle(id)], id); assert.ok(S.STYLES[id], `${id}: data kept for one release`); });
  assert.equal(E.lookForStyle('es'), 'paper');
  assert.equal(E.lookForStyle('whatever'), 'paper');
  // A saved classic / explainer / series / countdown plan: every beat gets a block from its own fields.
  const legacy = [
    { style: 'classic', beats: [{ id: 'a', kind: 'hook', text: 'Allen breaks the Bills record', vo: 'Josh Allen just broke the Bills record.', emphasis: 'record' }, { id: 'b', kind: 'quote', text: '', quote: { text: 'We earned it', by: 'Josh Allen' }, vo: 'We earned it, he said.' }, { id: 'c', kind: 'cta', text: 'Follow ES', vo: '' }] },
    { style: 'explainer', beats: [{ id: 'a', kind: 'hook', text: 'How deep does Allen throw', vo: 'How deep does he throw?' }, { id: 'b', kind: 'stat', text: 'Average throw depth', vo: 'His average throw travels 8.4 yards.', stat: { value: '8.4', label: 'Yards per throw' } }, { id: 'c', kind: 'chips', text: 'Deep shots', chips: { filled: '1', total: '5', label: 'Deep shots' }, vo: 'One in five is deep.' }] },
    { style: 'series', beats: [{ id: 'a', kind: 'hook', text: 'Where the holes are', vo: 'Here is where the holes are.' }, { id: 'b', kind: 'roles', text: 'Needs', vo: 'Receiver first.', roles: [{ role: 'WR', value: '31' }, { role: 'LB', value: '12' }] }, { id: 'c', kind: 'tiles', text: 'Three teams called', vo: 'Three teams called.' }] },
    { style: 'countdown', format: 'top5', beats: [{ id: 'a', kind: 'hook', text: 'Top QBs right now', vo: 'The top QBs right now.' }, { id: 'b', kind: 'rank', rank: 2, name: 'Lamar Jackson', text: 'Lamar Jackson', vo: 'Two is Lamar.' }, { id: 'c', kind: 'rank', rank: 1, name: 'Josh Allen', text: 'Josh Allen', vo: 'One is Allen.' }] },
  ];
  legacy.forEach(plan => {
    const look = E.lookForStyle(plan.style);
    plan.beats.forEach(beat => { const block = E.blockOf(beat); assert.ok(E.BLOCK_TYPES.includes(block.type), `${plan.style} ${beat.kind} -> ${block.type}`); assert.deepEqual(E.cleanBlock(block), block); });
    const converted = { format: plan.format || 'explainer', title: 'Saved', sourceLine: 'Source: ES', style: S.currentStyle(plan.style), look, beats: plan.beats.map(b => ({ ...b, block: E.blockOf(b), kind: E.KIND_FOR[E.blockOf(b).type] })) };
    const tl = R.buildTimeline(converted, { corpus: '8.4 1 5 31 12 2' });
    assert.equal(tl.style, 'es');
    assert.equal(tl.look, look);
    assert.ok(R.isEs(tl));
    assert.equal(tl.tracks.graphics[tl.tracks.graphics.length - 1].data.block.type, 'endcard', `${plan.style}: the end card closes it`);
    assert.doesNotThrow(() => frameDigests(R, tl, 500));
    assert.deepEqual(plan.beats.map(b => b.vo), converted.beats.map(b => b.vo), 'no words change');
  });
  // The page does the conversion on open, with a toast, and offers looks only.
  const js = read('../reel-maker.js');
  assert.match(js, /function adoptLook\(plan, savedStyle = ''\)/);
  assert.match(js, /plan\.look = ES\.lookForStyle\(old\);/);
  assert.match(js, /const block = ES\.blockOf\(beat\);/);
  assert.match(js, /const lookNote = adoptLook\(state\.plan, t\.style\);[\s\S]{0,240}if \(lookNote\) toast\(lookNote\);/); // v3: the reel also opens in its style
  // Reels v3: the looks picker is retired; the four style cards pick the look.
  assert.doesNotMatch(js, /data-look="\$\{lk\.id\}"/, 'the looks picker is gone');
  assert.doesNotMatch(js, /S\.STYLE_IDS\.map\(id => S\.STYLES\[id\]\)/, 'the old style picker is gone');
  assert.match(js, /style: styleId\(\), look: lookId\(\), esStyle: curStyle\(\),/);
  assert.match(read('../reel-maker.html'), /<script src="reel-es-themes\.js\?v=[\w-]+"><\/script>\s*<script src="reel-styles\.js[^\n]+\n\s*<script src="reel-es\.js/, 'the looks load before the styles and the engine');
});

await test('data formats: default to ES, and their overlay elements are re-skinned per look (elementTokens(style, element, look))', () => {
  F.DATA_FORMAT_IDS.forEach(id => { assert.equal(F.FORMATS[id].defaultStyle, 'es', id); assert.equal(S.FORMAT_STYLES[id], 'es'); assert.equal(S.suggestStyle({ format: id }).id, 'es'); });
  // Paper is the ES style as it was.
  S.ELEMENT_IDS.forEach(el => { assert.deepEqual(S.elementTokens('es', el, 'paper'), S.elementTokens('es', el), el); assert.deepEqual(S.elementTokens('es', el, null), S.elementTokens('es', el)); });
  assert.equal(S.withLook('es', 'paper'), S.STYLES.es);
  assert.equal(S.withLook('classic', 'ink'), S.STYLES.classic, 'a retired style is not re-skinned');
  // Each look: real colours, ES fonts, no purple; dark boards where the look puts figures on ink.
  VARIANTS.forEach(v => {
    const st = S.withLook('es', v.id, v.team);
    assert.deepEqual(S.validateStyle(st), [], v.name);
    S.ELEMENT_IDS.forEach(el => Object.entries(S.elementTokens('es', el, { look: v.id, team: v.team })).forEach(([k, val]) => assert.ok(/^(#[0-9a-f]{6}|rgba?\([\d\s.,]+\))$/i.test(val) || S.FONTS.includes(val), `${v.name} ${el}.${k} = ${val}`)));
    const theme = TH.resolve(v.id, { team: v.team });
    assert.equal(st.palette.paper.toUpperCase(), theme.hex(theme.surfaceFor('number').ground).toUpperCase(), `${v.name}: the data ground is the look's figure ground`);
    assert.ok(R.contrast(st.palette.ink, st.palette.paper) >= 4.5, `${v.name}: data text reads`);
    assert.equal(st.palette.good, '#1BC47D'); assert.equal(st.palette.bad, '#E8322B'); assert.equal(st.palette.hi, '#FFC52F'); assert.equal(st.palette.accent, '#0A7DFA');
  });
  assert.equal(S.elementTokens('es', 'scorebug', 'ink').ink, '#FFFFFF');
  assert.equal(S.elementTokens('es', 'scorebug', 'paper').ink, '#121212');
  assert.notDeepEqual(S.elementTokens('es', 'playcard', 'blue'), S.elementTokens('es', 'playcard', 'paper'));
  // Built in the ES style, a data format's story beats are ES block scenes (hook, end card) drawn by
  // the ES engine; its data beats keep their layouts; the lint is clean; no vignette or glow (flat).
  ['gameswing', 'replay', 'archive'].forEach(id => {
    const f = JSON.parse(read(`./fixtures/reels/timeline-v2-${id}.json`));
    VARIANTS.forEach(v => {
      const tl = R.buildTimeline({ format: f.format, title: f.title, sport: f.sport, beats: f.beats.map(b => ({ ...b })) }, { style: 'es', look: v.id, team: v.team ? { name: 'T', colors: [v.team] } : null, assets: f.assets, data: f.data, replay: f.replay, slides: f.slides, corpus: f.corpus });
      assert.equal(tl.v, 2);
      assert.equal(tl.look, v.id);
      const g = tl.tracks.graphics;
      assert.deepEqual([g[0].template, g[0].data.block.type, g[g.length - 1].template, g[g.length - 1].data.block.type], ['es-hook', 'hook', 'es-endcard', 'endcard'], `${id} ${v.name}`);
      assert.ok(g.slice(1, -1).every(x => !x.data.block && R.DATA_TEMPLATES.has(x.template)), `${id}: data beats keep their data layouts`);
      const res = L.lintTimeline(tl, { boxes: R.textBoxes(measure, tl), measure });
      assert.deepEqual(res.issues.filter(i => i.severity === 'critical' && !['rights', 'numbers'].includes(i.id) && !/^(data-|archive-|replay-)/.test(i.id)).map(i => `${i.id}: ${i.message}`), [], `${id} ${v.name}: safe frame, logo and look rules hold`);
      const theme = E.themeOf(tl);
      const hook = frameLog(R, tl, 1200);
      assert.ok(hook.some(c => c[0] === '=fillStyle' && String(c[1]).toUpperCase() === theme.hex(theme.base.ground).toUpperCase()), `${id} ${v.name}: the hook sits on the look's ground`);
      // The ES block scenes are flat: no vignette, glow or gradient (the data layouts keep their own drawing).
      [g[0], g[g.length - 1]].forEach(x => assert.ok(!frameLog(R, tl, x.inMs + 1500).some(c => c[0] === 'gradient'), `${id} ${v.name} ${x.template}: flat`));
      const mk = E.markRect(tl.size);
      assert.equal(hook.filter(c => c[0] === 'fillRect' && c[1] === mk.x && c[2] === mk.y && c[3] === 80 && c[4] === 80).length, 1, `${id} ${v.name}: one ES mark on the hook`);
    });
  });
  // The three saved fixtures, moved to ES, render in every look, a frame at every second.
  ['timeline-v2-gameswing.json', 'timeline-v2-replay.json', 'timeline-v2-archive.json'].forEach(name => {
    const base = JSON.parse(read(`./fixtures/reels/${name}`));
    VARIANTS.forEach(v => {
      const tl = { ...base, style: 'es', captionStyle: 'es', look: v.id, team: v.team ? { name: 'T', colors: [v.team] } : base.team };
      assert.equal(R.isEs(tl), false, 'data formats keep their data layouts');
      assert.equal(R.styleOf(tl).palette.paper.toUpperCase(), S.withLook('es', v.id, v.team).palette.paper.toUpperCase());
      for (let t = 0; t < tl.durationMs; t += 1000) {
        const log = frameLog(R, tl, t);
        assert.ok(log.some(c => c[0] === 'fillRect'), `${name} ${v.name} t=${t}: draws`);
        assert.ok(!log.some(c => c[0] === '=fillStyle' && typeof c[1] === 'string' && /undefined|NaN/.test(c[1])), `${name} ${v.name}: no broken colours`);
      }
      assert.deepEqual(E.lookChecks(tl, {}).filter(i => i.severity !== 'info'), [], `${name} ${v.name}: the look's own rules hold`);
      // Carousel slides wear the look too.
      R.buildSlides(tl, { style: 'es' }).forEach(sl => { assert.equal(sl.look, v.id); assert.doesNotThrow(() => frameLog({ drawFrame: (c, t2, ms, env) => R.drawSlideFrame(c, t2, ms, env) }, sl, 1200)); });
    });
  });
});

// ─── Director ────────────────────────────────────────────────────────────
await test('director: ES_SPEC has one line per layout preset; the plan carries the look through', () => {
  Object.values(TH.LAYOUTS).forEach(l => { assert.ok(l.director && l.director.length < 220, l.id); assert.ok(D.ES_SPEC.includes(`- ${l.director}`), `${l.id} line in ES_SPEC`); });
  assert.match(D.ES_SPEC, /- Data-led: at least two of number \/ dots \/ compare/);
  assert.equal(D.ES_SPEC.split('\n').filter(l => /^- (Standard|Photo-led|Data-led|Minimal|Bold|Game Tape|Hype Cut):/.test(l)).length, Object.keys(TH.LAYOUTS).length);
  assert.equal(D.lookRequest('data'), 'LOOK: Data-led. Follow the Data-led line above.');
  assert.equal(D.lookRequest('ink'), 'LOOK: Ink. Follow the Standard line above.');
  assert.equal(D.lookRequest('nope'), '');
  const read0 = D.readReelBrief({ brief: 'The Chiefs signed a receiver on a one year deal. He ran 22.4 MPH last season.', format: 'explainer', sport: 'nfl' });
  const ask = D.directorRequest({ read: read0, format: 'explainer', style: S.get('es'), look: 'photo' });
  assert.match(ask, /LOOK: Photo-led\./);
  assert.doesNotMatch(D.directorRequest({ read: read0, format: 'explainer', style: S.get('es') }), /^LOOK: /m);
  const beats = [{ kind: 'hook', text: 'The Chiefs got faster', vo: 'The Chiefs just got faster.', block: { type: 'hook', pills: [{ text: 'THE CHIEFS' }, { text: 'GOT FASTER.', color: 'blue' }] } }, { kind: 'point', text: 'One year deal', vo: 'It is a one year deal.', block: { type: 'statement', lines: [{ text: 'ONE YEAR.' }] } }, { kind: 'cta', text: '', vo: '', block: { type: 'endcard' } }];
  assert.equal(D.validatePlan({ beats }, { read: read0, format: 'explainer', style: 'es', look: 'data' }).plan.look, 'data');
  assert.equal('look' in D.validatePlan({ beats }, { read: read0, format: 'explainer', style: 'es' }).plan, false, 'no look asked: the page defaults to Paper');
  assert.equal('look' in D.validatePlan({ beats }, { read: read0, format: 'explainer', style: 'es', look: 'neon' }).plan, false);
});

console.log(`\n${passed} passed`);
