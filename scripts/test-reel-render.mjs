#!/usr/bin/env node
// Reels Studio renderer (reel-render.js) and formats (reel-formats.js):
// timeline building, renderer timing (shots, cross-fades, graphics, caption
// cards, music ducking), layout inside the safe zones, and drawing with a
// stub canvas. Pure: no DOM, no network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const F = require('../reel-formats.js');
const R = require('../reel-render.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
// Rough Acumin / Roboto metrics: half an em per character.
const measure = (text, font) => String(text).length * Number(String(font).match(/([\d.]+)px/)[1]) * 0.5;

const STAT_PLAN = {
  format: 'stat', title: 'Allen breaks the Bills record', sport: 'nfl',
  beats: [
    { id: 'b1', kind: 'hook', text: '5,477 yards. A Bills record.', vo: 'Josh Allen just threw for 5,477 yards, the most in Bills history.', emphasis: 'record' },
    { id: 'b2', kind: 'stat', text: '5,477 passing yards', vo: 'That beats the old mark by a mile.', stat: { value: '5,477', label: 'pass yds' } },
    { id: 'b3', kind: 'context', text: 'Buffalo won the AFC East', vo: 'And Buffalo won the AFC East again, the fifth straight year they have done it.' },
    { id: 'b4', kind: 'payoff', text: 'MVP case, made', vo: 'If you are building an MVP case, this is where it starts.' },
    { id: 'b5', kind: 'cta', text: 'Is he the MVP?', vo: 'Is he the MVP? Tell us below.' },
  ],
};
const TEAM = { name: 'Buffalo Bills', colors: ['#00338D', '#C60C30'], logo: '' };

test('formats: four formats, router picks by keywords, explainer by default', () => {
  assert.deepEqual(F.FORMAT_IDS, ['explainer', 'stat', 'top5', 'quote']);
  assert.equal(F.routeFormat('Top 5 quarterbacks in the MVP race').format, 'top5');
  assert.equal(F.routeFormat('Allen becomes the first QB since 1998 to do it').format, 'stat');
  assert.equal(F.routeFormat('"We are not done," Mahomes said after the loss').format, 'quote');
  assert.equal(F.routeFormat('Chiefs trade for a receiver').format, 'explainer');
  assert.equal(F.routeFormat('Something happened').format, 'explainer');
});

test('numbers: normalised, sourced or not, Top-5 ranks need no source', () => {
  assert.deepEqual(F.numbersIn('5,477 yards and 15 TDs in 2025, 62.5%'), ['5477', '15', '2025', '62.5']);
  const src = F.numberSet('He threw for 5477 yards and 15 touchdowns.');
  assert.deepEqual(F.unsourcedNumbers({ text: '5,477 yards', vo: 'and 15 TDs, plus 3 picks' }, src, 'stat'), ['3']);
  assert.deepEqual(F.unsourcedNumbers({ kind: 'rank', rank: 3, text: '#3 Allen', vo: 'Number 3 is Allen.' }, F.numberSet(''), 'top5'), []);
  assert.deepEqual(F.unsourcedNumbers({ kind: 'rank', rank: 3, text: 'Top 5: #2 Allen' }, F.numberSet(''), 'top5'), ['2'], 'only its own rank is free');
});

test('fallback plan: grounded in the brief, hook first, end card last, no invented numbers', () => {
  const brief = 'Josh Allen threw for 5,477 yards in 2025. He also ran for 15 touchdowns. Buffalo clinched the AFC East.';
  const plan = F.fallbackPlan({ brief, title: 'Allen sets a Bills record', format: 'stat', sport: 'nfl' });
  assert.equal(plan.beats[0].kind, 'hook');
  assert.equal(plan.beats.at(-1).kind, 'cta');
  assert.ok(plan.beats.some(b => b.kind === 'stat' && b.stat.value === '5,477'));
  const src = F.numberSet(`${brief} Allen sets a Bills record`);
  plan.beats.forEach(b => assert.deepEqual(F.unsourcedNumbers(b, src, plan.format), [], `beat "${b.text}"`));
  assert.equal(new Set(plan.beats.map(b => b.vo)).size, plan.beats.length, 'no line is read twice');
  assert.equal(F.fallbackPlan({ brief: 'Top 5 rushers this week. Henry leads.', format: 'top5' }).format, 'explainer', 'a Top 5 needs sourced entries');
});

test('estimateCost: economy is cents, voice scales with characters, render is free', () => {
  const eco = F.estimateCost({ tier: 'economy', voiceMode: 'off' });
  assert.ok(eco.total < 0.01);
  const std = F.estimateCost({ tier: 'standard', factCheck: true, voiceMode: 'elevenlabs', voChars: 450 });
  assert.ok(std.total > eco.total && std.total < 0.12, `standard-lite under $0.12 (${std.total})`);
  assert.equal(std.lines.find(l => l.id === 'render').usd, 0);
});

let tl;
test('buildTimeline: beats back to back, VO from 0.1 s, durations follow the voice', () => {
  tl = R.buildTimeline(STAT_PLAN, { team: TEAM, corpus: 'x', voice: { b1: { durationMs: 3000, words: [{ w: 'Josh', s: 0, e: 300 }, { w: 'Allen', s: 300, e: 700 }] } } });
  assert.equal(tl.v, 1);
  assert.deepEqual(tl.size, [1080, 1920]);
  assert.equal(tl.beats[0].inMs, 0);
  tl.beats.forEach((b, i) => { if (i) assert.equal(b.inMs, tl.beats[i - 1].outMs, 'no gaps'); });
  assert.equal(tl.durationMs, tl.beats.at(-1).outMs);
  assert.equal(tl.beats[0].outMs, 100 + 3000 + F.PACE.tailMs, 'beat 1 = lead + VO + tail');
  assert.ok(tl.durationMs >= 15000 && tl.durationMs <= 45000, `length ${tl.durationMs}`);
  assert.equal(tl.highlight, '#00338D', 'the team colour when white reads on it');
  assert.equal(tl.tag, 'STAT ALERT');
  // Aligned words are offset by the VO start; estimated ones fill the other beats.
  const w = tl.tracks.captions.words;
  assert.deepEqual([w[0].w, w[0].s, w[1].s], ['Josh', 100, 400]);
  assert.ok(w.every((x, i) => i === 0 || x.s >= w[i - 1].s), 'word times only move forward');
  assert.ok(w.every(x => x.e > x.s));
});

test('buildTimeline: long beats get a second shot; pushes stay under 10%; rights for what the renderer makes', () => {
  const shots = tl.tracks.video;
  shots.forEach(s => assert.ok(s.outMs - s.inMs <= F.PACE.shotMaxMs + 1, `shot ${s.id} ${s.outMs - s.inMs}ms`));
  shots.filter(s => !s.asset).forEach(s => assert.ok(s.motion.to / s.motion.from <= 1.1));
  assert.ok(tl.assets['bg:generated'].rights.paid, 'the generated background is ES-owned');
  assert.ok(tl.assets['graphics:es'].rights.organic);
});

test('buildTimeline: music is ducked 14 dB under every VO clip and fades out', () => {
  const t = R.buildTimeline(STAT_PLAN, {
    voice: { b1: { durationMs: 2500, words: [], asset: 'vo:b1' }, b2: { durationMs: 2000, words: [], asset: 'vo:b2' } },
    assets: { 'vo:b1': { kind: 'vo' }, 'vo:b2': { kind: 'vo' }, music: { kind: 'music' } },
    music: { asset: 'music' },
  });
  const music = t.tracks.audio.find(a => a.kind === 'music');
  const vo = t.tracks.audio.filter(a => a.kind === 'vo');
  assert.equal(vo.length, 2);
  const mid = vo[0].inMs + vo[0].durMs / 2;
  assert.equal(R.musicGainDbAt(music.envelope, mid), R.MUSIC.duckDb);
  assert.equal(R.MUSIC.baseDb - R.MUSIC.duckDb, 14);
  const gap = t.beats[3].inMs + 600; // no VO asset on beat 4
  assert.equal(R.musicGainDbAt(music.envelope, gap), R.MUSIC.baseDb);
  assert.equal(R.musicGainDbAt(music.envelope, t.durationMs), R.MUSIC.floorDb);
  assert.ok(R.musicGainDbAt(music.envelope, t.durationMs - 300) < R.MUSIC.baseDb, 'fading out');
  assert.equal(R.dbToGain(-60), 0);
});

test('frameAt: shot cross-fade lasts 220 ms, graphics follow beats, captions show the spoken word', () => {
  const second = tl.tracks.video[1];
  let f = R.frameAt(tl, second.inMs + 10);
  assert.ok(f.prev && f.mix > 0 && f.mix < 0.2, 'just after a cut both shots show');
  f = R.frameAt(tl, second.inMs + R.XFADE_MS + 5);
  assert.equal(f.prev, null);
  assert.equal(f.mix, 1);
  f = R.frameAt(tl, 0);
  assert.equal(f.graphic.template, 'hook');
  assert.equal(f.beatIndex, 0);
  const b2 = tl.beats[1];
  f = R.frameAt(tl, b2.inMs + 50);
  assert.equal(f.graphic.template, 'stat');
  assert.ok(f.graphic.local >= 50);
  // The graphic fades in its last 180 ms (not on the last beat).
  assert.ok(R.frameAt(tl, b2.outMs - 30).graphic.exit > 0.8);
  assert.equal(R.frameAt(tl, tl.durationMs - 30).graphic.exit, 0, 'the end card holds');
  const word = tl.tracks.captions.words[1];
  f = R.frameAt(tl, word.s + 5);
  assert.ok(f.caption, 'a caption card is up');
  assert.equal(f.caption.active, 1, 'the word being spoken is highlighted');
});

test('captionCards: 1-3 words for Highlight, never across beats or sentences; Box holds more', () => {
  const words = R.estimateWordTimes('Josh Allen just threw for 5,477 yards. The most ever, by a mile.', 0, 4000).map(w => ({ ...w, beat: 'b1' }));
  const cards = R.captionCards(words, { style: 'highlight' });
  cards.forEach(c => assert.ok(c.words.length <= 3));
  assert.ok(cards.every(c => !c.words.slice(0, -1).some(i => /[.!?]$/.test(words[i].w))), 'a sentence end closes the card');
  const box = R.captionCards(words, { style: 'box' });
  assert.ok(box.length < cards.length);
  const two = [{ w: 'End', s: 0, e: 200, beat: 'a' }, { w: 'Start', s: 220, e: 400, beat: 'b' }];
  assert.equal(R.captionCards(two).length, 2);
  cards.forEach((c, i) => { if (cards[i + 1]) assert.ok(c.e <= cards[i + 1].s, 'cards never overlap'); });
});

test('layout: every text box sits inside the safe zone (x 65-1015, y 270-1580)', () => {
  const formats = [
    STAT_PLAN,
    { format: 'top5', beats: [{ kind: 'hook', text: 'Top 5 QBs right now', vo: 'Here are the top 5.' }, ...[5, 4, 3, 2, 1].map(rank => ({ kind: 'rank', rank, name: `Quarterback Number ${rank} With A Long Name`, detail: 'A detail line that is fairly long to wrap', text: '', vo: 'Line.' })), { kind: 'cta', text: 'Who is your number one?', vo: 'Who is yours?' }] },
    { format: 'quote', beats: [{ kind: 'hook', text: 'We are not done', vo: 'He said it.' }, { kind: 'quote', text: 'q', quote: { text: 'We are not done yet. This team has a lot more to show everyone this season.', by: 'Patrick Mahomes' }, vo: 'After the game.' }, { kind: 'cta', text: 'Do you believe him?', vo: 'Do you?' }] },
  ];
  formats.forEach(plan => {
    const t = R.buildTimeline(plan, { team: TEAM });
    const boxes = R.textBoxes(measure, t);
    assert.ok(boxes.length > 5);
    boxes.forEach(b => {
      assert.ok(b.x >= R.SAFE.left && b.x + b.w <= R.SAFE.right + 0.5, `${plan.format} ${b.role} "${b.text}" x ${b.x}-${b.x + b.w}`);
      assert.ok(b.y >= R.SAFE.top && b.y + b.h <= R.SAFE.bottom, `${plan.format} ${b.role} "${b.text}" y ${b.y}-${b.y + b.h}`);
    });
  });
});

test('layout: the hook headline steps down to fit four lines; stat numbers count up', () => {
  const g = { template: 'hook', data: { text: 'A very long hook line that keeps going and going far past it' } };
  const ops = R.layoutGraphic(measure, g, { tag: 'EXPLAINED' });
  const words = ops.filter(o => o.type === 'word');
  const lines = new Set(words.map(o => Math.round(o.y)));
  assert.ok(lines.size <= 4);
  assert.ok(words[0].size < 150);
  const spec = R.parseStatValue('5,477');
  assert.equal(R.formatStat(spec, 0), '0');
  assert.equal(R.formatStat(spec, 2738.5), '2,739');
  assert.equal(R.formatStat(spec, 5477), '5,477');
  assert.equal(R.formatStat(R.parseStatValue('62.5%'), 31.25), '31.3%');
  assert.equal(R.formatStat(R.parseStatValue('-12'), -12), '-12');
  assert.equal(R.parseStatValue('MVP'), null);
});

test('colour: highlight falls back to ES Blue when white text would not read', () => {
  assert.equal(R.accessibleHighlight(['#FFB81C', '#FFD100']), R.ES_BLUE, 'gold teams');
  assert.equal(R.accessibleHighlight(['#FFB81C', '#203731']), '#203731', 'the second colour when the first fails');
  assert.ok(R.contrast('#FFFFFF', R.ES_BLUE) >= 4.5);
  assert.equal(R.ease.outCubic(0), 0);
  assert.equal(R.ease.outCubic(1), 1);
  assert.ok(R.ease.outCubic(0.5) > 0.5, 'ease-out front-loads the motion');
});

test('drawFrame: draws every frame of the reel without throwing (stub canvas)', () => {
  const calls = { fillText: 0, drawImage: 0 };
  const grad = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return text => ({ width: String(text).length * 20 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => grad;
      if (key === 'createPattern') return () => null;
      if (key === 'fillText') return () => { calls.fillText += 1; };
      if (key === 'drawImage') return () => { calls.drawImage += 1; };
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const photo = { naturalWidth: 1600, naturalHeight: 1067 };
  const t = R.buildTimeline(STAT_PLAN, { team: TEAM, photos: { b1: ['img:1'] }, assets: { 'img:1': { kind: 'photo', rights: {} } } });
  const env = { measure, images: { 'img:1': photo, 'logo:es': { width: 123, height: 105 } } };
  for (let ms = 0; ms < t.durationMs; ms += 1000 / 30) R.drawFrame(ctx, t, ms, env);
  assert.ok(calls.fillText > 100);
  assert.ok(calls.drawImage > 30, 'photo and ES mark drawn');
  // Frame 0 already carries the claim (hook rule).
  const before = calls.fillText;
  R.drawFrame(ctx, t, 0, env);
  assert.ok(calls.fillText > before, 'text on the very first frame');
});

console.log(process.exitCode ? '\nReel render tests failed.' : `\nAll ${passed} reel render tests passed.`);
