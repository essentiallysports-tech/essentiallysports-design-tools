#!/usr/bin/env node
// Reels Studio styles (reel-styles.js) and the styled renderer: style data
// integrity (fonts, no purple, a layout for every beat kind), every style x
// every beat kind renders without throwing and inside the safe zone, empty
// slots are plain black, clips map to source times, the suggestion rules,
// the 80/20 clip planner and the AI scene prompts (no names, ever).
// Pure: no DOM, no network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../reel-styles.js');
const F = require('../reel-formats.js');
const R = require('../reel-render.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
// Rough metrics: 0.55 em per character (a little wider than real Acumin).
const measure = (text, font) => String(text).length * Number(String(font).match(/([\d.]+)px/)[1]) * 0.55;

// One beat of every kind, with long-ish text to stress the layouts.
const ALL_BEATS = [
  { id: 'h', kind: 'hook', text: 'Mahomes isn’t playing like Mahomes', vo: 'Patrick Mahomes is not playing like Patrick Mahomes this season.', emphasis: 'Mahomes', visual: 'clip' },
  { id: 'c', kind: 'context', text: 'Every QB season since 2006 ranked', vo: 'We ranked all 714 quarterback seasons since 2006.', visual: 'photo', detail: 'Each dot is one quarterback season.' },
  { id: 's', kind: 'stat', text: 'Average throw depth', vo: 'His average throw travels just 6.5 yards.', stat: { value: '6.5', label: 'yards per throw' }, detail: 'How far his average pass travels in the air', chips: { filled: '1', total: '5', label: 'pre-designed throws' } },
  { id: 'r', kind: 'rank', rank: 3, name: 'Josh Allen', text: 'Josh Allen', vo: 'Number three is Josh Allen.', detail: 'Turnover-worthy throws doubled' },
  { id: 'q', kind: 'quote', text: 'We are not done', vo: 'He said the team is not done yet.', quote: { text: 'We are not done. Not even close.', by: 'Patrick Mahomes' } },
  { id: 'p', kind: 'point', text: 'The deep ball disappeared', vo: 'The deep ball is gone.' },
  { id: 'y', kind: 'payoff', text: 'Why it matters for January', vo: 'And that matters in January.' },
  { id: 'ba', kind: 'bars', text: 'Many turnover-worthy throws', vo: 'Allen throws twice as many turnover-worthy passes.', detail: 'Turnover-worthy throws', bars: [{ label: 'Mahomes', value: '1×' }, { label: 'Allen', value: '2×' }] },
  { id: 'v', kind: 'versus', text: 'Now look at the other stars', vo: 'Now look at the other stars.', versus: [{ name: 'Burrow', value: '+50%', note: 'higher-value throws' }, { name: 'Allen', value: '2×', note: 'turnover-worthy throws' }, { name: '?', value: '' }] },
  { id: 'd', kind: 'dotrank', text: 'Mahomes 2026 vs 714 QB seasons', vo: 'Out of 714 seasons, his 2018 ranks 234th.', dotrank: { total: '714', rank: '234', label: '2018 Mahomes', note: 'Closer to the centre means more value' } },
  { id: 'ch', kind: 'chips', text: '1 in 5 throws is pre-designed', vo: 'One in five of his throws is pre-designed.', chips: { filled: '1', total: '5', label: 'Pre-designed' } },
  { id: 'st', kind: 'steps', text: 'Recreate them in the aggregate', vo: 'Step two: recreate them in the aggregate.', steps: { current: '2', total: '3', label: 'Moneyball rebuild' } },
  { id: 'ti', kind: 'tiles', text: 'Four teams rebuilt this way', vo: 'Four teams rebuilt this way.', tiles: [{ team: 'Ravens', label: 'Rebuilt 2019', chip: 'Rebuilt', colors: ['#241773', '#000000'] }, { team: 'Colts', label: 'Rebuilt', chip: 'Rebuilt', colors: ['#002C5F', '#A2AAAD'] }, { team: 'Eagles', label: 'Rebuilt', colors: ['#004C54', '#A5ACAF'] }, { team: 'Steelers', label: 'Next?', chip: '?', colors: ['#FFB612', '#101820'] }] },
  { id: 'ro', kind: 'roles', text: 'Where the holes are', vo: 'Here is where the holes are.', roles: [{ role: 'WR', value: '#31', note: 'Receiving yds', tone: 'bad' }, { role: 'LB', value: 'FA', tone: 'bad' }, { role: 'DB', value: '3 FAs', tone: 'bad' }, { role: 'DL', value: '#2', note: 'Defensive line', tone: 'good' }] },
  { id: 'm', kind: 'mystery', text: 'Who is next?', vo: 'So who is next?', detail: 'The 2028 draft decides it' },
  { id: 'e', kind: 'cta', text: 'Is Mahomes back in January?', vo: 'Is Mahomes back in January? Tell us below.' },
];
const PLAN = { format: 'explainer', title: 'Mahomes isn’t playing like Mahomes', eyebrow: 'Patrick Mahomes · 714 QB seasons', series: { tag: 'ES Moneyball' }, strip: { label: '2027 cap space', value: '-$12.3M', of: '$40M', note: '3 seasons of cap', tone: 'bad' }, beats: ALL_BEATS };
const ASSETS = { 'img:1': { kind: 'photo', rights: {} }, 'clip:1': { kind: 'clip', durationMs: 8000, clipIn: 1.5, rights: {} }, 'tile:t': { kind: 'tile', colors: ['#E31837', '#FFB81C'], logo: 'logo:team', rights: {} } };
const PHOTOS = { h: ['clip:1', 'img:1'], c: ['img:1'], s: ['clip:1'], r: ['tile:t'], q: ['img:1'], 'v#v0': ['img:1'] };

function stubCtx() {
  const calls = { fillText: 0, drawImage: 0, fillRect: 0, black: 0 };
  const grad = { addColorStop() {} };
  let fill = '';
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return text => ({ width: String(text).length * 20 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => grad;
      if (key === 'createPattern') return () => null;
      if (key === 'fillText') return () => { calls.fillText += 1; };
      if (key === 'drawImage') return () => { calls.drawImage += 1; };
      if (key === 'fillRect') return () => { calls.fillRect += 1; if (fill === '#000000') calls.black += 1; };
      return () => {};
    },
    set(target, key, value) { if (key === 'fillStyle') fill = value; target[key] = value; return true; },
  });
  return { ctx, calls };
}
const env = () => ({ measure, images: { 'img:1': { naturalWidth: 1600, naturalHeight: 1067 }, 'logo:es': { width: 123, height: 105 }, 'logo:team': { width: 200, height: 200 } }, videos: { 'clip:1': { readyState: 4, videoWidth: 1280, videoHeight: 720 } }, cutouts: { 'clip:1': { width: 600, height: 900 } } });

test('style data: four styles, ES fonts only, no purple, every beat kind has a layout', () => {
  assert.deepEqual(S.STYLE_IDS, ['classic', 'explainer', 'series', 'countdown']);
  S.STYLE_IDS.forEach(id => assert.deepEqual(S.validateStyle(S.STYLES[id]), [], id));
  assert.ok(S.isPurple('#7B2FBE') && !S.isPurple('#1F6FEB') && !S.isPurple('#D93A2F'), 'the purple check works');
  assert.deepEqual(S.COMPONENT_KINDS, F.COMPONENT_KINDS, 'formats and styles agree on the data beats');
  assert.ok(S.STYLES.explainer.seconds.max >= 120 && S.STYLES.series.seconds.max >= 120, 'long-form styles allow 90-120 s');
  assert.ok(S.STYLES.series.chrome.strip && S.STYLES.series.chrome.seriesTag);
  assert.ok(S.kindsFor('series').includes('tiles') && !S.kindsFor('classic').includes('tiles'));
});

S.STYLE_IDS.forEach(styleId => {
  test(`${styleId}: every beat kind renders (stub canvas) and every box sits in the safe zone`, () => {
    // Classic and Countdown hold 12 beats: the kinds are checked in two reels.
    const max = S.STYLES[styleId].beats.max;
    const chunks = [];
    for (let i = 0; i < ALL_BEATS.length; i += max) chunks.push(ALL_BEATS.slice(i, i + max));
    chunks.forEach(beats => {
    const tl = R.buildTimeline({ ...PLAN, beats }, { style: styleId, photos: PHOTOS, assets: ASSETS, team: { name: 'Kansas City Chiefs', colors: ['#E31837', '#FFB81C'] } });
    assert.equal(tl.style, styleId);
    assert.equal(tl.beats.length, beats.length);
    const { ctx, calls } = stubCtx();
    const e = env();
    tl.tracks.graphics.forEach(g => { for (const dt of [0, 150, 500, 1500]) R.drawFrame(ctx, tl, Math.min(g.outMs - 1, g.inMs + dt), e); });
    assert.ok(calls.fillText > beats.length * 4, 'text drawn');
    const boxes = R.allBoxes(measure, tl);
    const SAFE = R.SAFE;
    const out = boxes.filter(b => b.x < SAFE.left - 0.5 || b.x + b.w > SAFE.right + 0.5 || b.y < SAFE.top - 0.5 || b.y + b.h > SAFE.bottom + 0.5);
    assert.deepEqual(out.map(b => `${b.beat}:${b.role}:${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)}x${Math.round(b.h)}`), []);
    });
  });
});

test('styled layouts: components carry their data (bars scale, dots, chips, steps, tiles, roles, mystery)', () => {
  const tl = R.buildTimeline(PLAN, { style: 'series', photos: PHOTOS, assets: ASSETS });
  const ops = id => R.layoutGraphic(measure, tl.tracks.graphics.find(g => g.beat === id), tl);
  const bars = ops('ba').filter(o => o.role === 'bar');
  assert.equal(bars.length, 2);
  assert.ok(bars[1].w > bars[0].w, '2x is longer than 1x');
  assert.equal(ops('d').find(o => o.type === 'dotring').n, 714);
  assert.equal(ops('ch').filter(o => o.role === 'chip-square').length, 5);
  assert.equal(ops('ch').filter(o => o.role === 'chip-square' && o.fill === 'accent').length, 1);
  assert.equal(ops('st').filter(o => o.role === 'step-square').length, 3);
  assert.equal(ops('ti').filter(o => o.role === 'tile').length, 4);
  assert.equal(ops('ro').filter(o => o.role === 'role-card' && o.fill === 'good').length, 1);
  assert.ok(ops('m').some(o => o.role === 'mystery-mark' && o.text === '?'));
  assert.ok(ops('v').some(o => o.role === 'mystery'), 'a "?" versus entry is a mystery card');
  const chrome = R.layoutChrome(measure, tl, { beatIndex: 0 });
  assert.ok(chrome.some(o => o.role === 'series-tag'));
  assert.ok(chrome.some(o => o.role === 'strip-value' && o.text === '-$12.3M'), 'the data strip is on every scene');
  assert.ok(R.layoutGraphic(measure, tl.tracks.graphics[0], tl).some(o => o.role === 'headline' && o.color === 'bad'), 'series: the emphasis turns red');
  const ex = R.buildTimeline(PLAN, { style: 'explainer' });
  assert.ok(R.layoutGraphic(measure, ex.tracks.graphics[0], ex).some(o => o.role === 'headline' && o.bg === 'hi'), 'explainer: one word on the yellow highlight');
  assert.equal(ex.captionStyle, 'block');
  assert.equal(ex.strip, null, 'the strip is a Series feature');
});

test('empty slots are plain black; a designed background is an explicit choice', () => {
  const tl = R.buildTimeline({ format: 'explainer', beats: [ALL_BEATS[0], ALL_BEATS.at(-1)] }, { style: 'classic' });
  const { ctx, calls } = stubCtx();
  R.drawFrame(ctx, tl, 500, env());
  assert.ok(calls.black >= 1, 'the full-bleed slot is black');
  assert.equal(R.drawVisual(ctx, '', { x: 0, y: 0, w: 10, h: 10 }, tl, env()), 'empty');
  const designed = R.buildTimeline({ format: 'explainer', beats: [ALL_BEATS[0]] }, { photos: { h: ['design:bg'] }, assets: { 'design:bg': { kind: 'design', rights: {} } } });
  assert.equal(R.drawVisual(ctx, 'design:bg', { x: 0, y: 0, w: 10, h: 10 }, designed, env()), 'design');
});

test('clips: one shot per clip, played from the trim point, looping a short clip', () => {
  const tl = R.buildTimeline(PLAN, { style: 'explainer', photos: PHOTOS, assets: ASSETS });
  const shot = tl.tracks.video.find(s => s.beat === 's');
  assert.equal(shot.clip.inSec, 1.5);
  const times = R.clipTimes(tl, shot.inMs + 1000);
  assert.deepEqual(times.map(x => x.asset), ['clip:1']);
  assert.ok(Math.abs(times[0].time - 2.5) < 0.01);
  assert.ok(R.clipTime(shot, 7000) < 8, 'loops inside the clip');
});

test('suggestStyle: Top 5 -> Countdown, cap / draft talk -> Series, numbers -> Explainer, news -> Classic', () => {
  assert.equal(S.suggestStyle({ format: 'top5', text: 'Best QBs' }).id, 'countdown');
  assert.equal(S.suggestStyle({ text: 'Moneyball for the Steelers: cap space and the draft' }).id, 'series');
  assert.equal(S.suggestStyle({ text: 'Mahomes averages 6.5 yards per throw, 234th of 714 seasons' }).id, 'explainer');
  assert.equal(S.suggestStyle({ text: 'Chiefs sign a receiver' }).id, 'classic');
});

test('planVisualMix: about 80% of the time is clips; faces and the end card stay stills', () => {
  const beats = [
    { id: 'a', kind: 'hook', durMs: 3000 }, { id: 'b', kind: 'context', durMs: 5000 }, { id: 'c', kind: 'stat', durMs: 4000 },
    { id: 'd', kind: 'quote', durMs: 4000, visual: 'headshot' }, { id: 'e', kind: 'point', durMs: 5000 }, { id: 'f', kind: 'payoff', durMs: 4000 },
    { id: 'g', kind: 'versus', durMs: 3000 }, { id: 'h', kind: 'cta', durMs: 2500 },
  ];
  const mix = F.planVisualMix(beats, { target: 0.8 });
  assert.equal(mix.mode.h, 'design');
  assert.ok(mix.share >= 0.7 && mix.share <= 0.9, `share ${mix.share}`);
  assert.equal(mix.mode.d, 'image', 'the quote keeps its headshot');
  const few = F.planVisualMix(beats, { target: 0.8, clipsAvailable: 2 });
  assert.equal(Object.values(few.mode).filter(m => m === 'clip').length, 2, 'never more clips than were found');
});

test('scenePrompt: closed scene list, no names, no people, no logos or text', () => {
  const p = F.scenePrompt({ scene: 'stadium', sport: 'nfl', colors: ['#E31837', '#FFB81C'], motion: true });
  assert.match(p.prompt, /No people, no faces/);
  assert.match(p.prompt, /no logos/);
  assert.match(p.prompt, /red|gold/);
  assert.doesNotMatch(p.prompt, /Chiefs|Mahomes|Kansas/);
  const evil = F.scenePrompt({ scene: 'Patrick Mahomes celebrating in a Chiefs jersey', sport: 'nfl' });
  assert.equal(evil.scene, 'stadium', 'free text is never used');
  assert.doesNotMatch(evil.prompt, /Mahomes|Chiefs/);
});

test('data-format elements: layouts registered, boxes stacked without overlap, tokens ES-only and never purple', () => {
  assert.deepEqual(S.DATA_LAYOUTS, ['play', 'wpline', 'moment', 'panel3']);
  S.DATA_LAYOUTS.forEach(l => assert.ok(S.LAYOUTS.includes(l)));
  S.STYLE_IDS.forEach(id => assert.deepEqual(S.validateStyle(S.STYLES[id]), [], id));
  for (const cv of [{ w: 1080, h: 1920 }, { w: 1080, h: 1350 }]) {
    const bug = S.elementBox('scorebug', cv);
    const clock = S.elementBox('clock', cv);
    const band = S.elementBox('wpline', cv);
    assert.ok(clock.y >= bug.y + bug.h, 'the clock tab hangs under the bug');
    assert.ok(clock.x + clock.w <= bug.x + bug.w, 'under its right end');
    assert.ok(band.y >= clock.y + clock.h, 'the WP band below the clock');
    const mark = cv.h === 1350 ? R.SLIDE_MARK : R.ES_MARK;
    assert.ok(bug.x + bug.w <= mark.x - mark.clear, 'clear of the ES mark');
    assert.ok(S.elementBox('panel3', cv).y >= mark.y + mark.h + mark.clear, 'the strip starts under the mark');
  }
  for (const id of S.STYLE_IDS) for (const el of S.ELEMENT_IDS) Object.entries(S.elementTokens(id, el)).forEach(([k, v]) => { if (!/font/i.test(k)) assert.ok(!S.isPurple(v), `${id}/${el}.${k}`); });
});

console.log(process.exitCode ? '\nReel styles tests failed.' : `\nAll ${passed} reel styles tests passed.`);
