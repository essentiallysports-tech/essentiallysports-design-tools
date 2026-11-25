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
  assert.equal(tl.assets['bg:generated'], undefined, 'an empty slot is plain black, not a generated background');
  const designed = R.buildTimeline(STAT_PLAN, { photos: { b1: ['design:bg'] }, assets: { 'design:bg': { kind: 'design', rights: {} } } });
  assert.ok(designed.assets['bg:generated'].rights.paid, 'the designed background (fill-chain step 4) is ES-owned');
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

// ─── Data formats (Phase 1): Game Swing, Moment Replay, Archive ─────────
const T = require('../reel-timeline.js');
const S = require('../reel-styles.js');
const fx = name => JSON.parse(JSON.stringify(require(`./fixtures/reels/${name}`)));
const planOf = tl => ({ format: tl.format, title: tl.title, sport: tl.sport, beats: tl.beats.map(b => ({ id: b.id, kind: b.kind, text: b.text, vo: b.vo, refs: b.refs })), data: tl.data, replay: tl.replay, slides: tl.slides, outputs: tl.outputs });
const recCtx = () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === 'measureText' ? s => ({ width: String(s).length * 20 }) : (k === 'getImageData' ? undefined : (...a) => { calls.push([k, ...a]); return { addColorStop() {} }; }))), set: (t, k, v) => { t[k] = v; return true; } });
  return { ctx, calls };
};
const FIX = { gameswing: 'timeline-v2-gameswing.json', replay: 'timeline-v2-replay.json', archive: 'timeline-v2-archive.json' };
const build = (id, style, extra = {}) => { const f = fx(FIX[id]); return R.buildTimeline({ ...planOf(f), ...(extra.plan || {}) }, { style, assets: f.assets, ...extra.opts }); };
const textsOf = (tl, beat) => R.layoutGraphic(measure, tl.tracks.graphics.find(g => g.beat === beat), tl).filter(o => o.text != null).map(o => o.text);

test('data formats: buildTimeline emits v2 with the canvas, data, refs and the data kinds', () => {
  const tl = build('gameswing', 'series');
  assert.equal(tl.v, 2);
  assert.deepEqual(tl.canvas, { w: 1080, h: 1920 });
  assert.deepEqual(tl.outputs, ['reel']);
  assert.deepEqual(tl.beats.map(b => b.kind), ['hook', 'play', 'wpline', 'cta']);
  assert.deepEqual(tl.beats[1].refs, ['play:401873063558']);
  assert.deepEqual(tl.tracks.graphics.map(g => g.template), ['headline-visual', 'play', 'wpline', 'endcard']);
  assert.equal(tl.data.game.eventId, '401873063');
  assert.ok(T.validateTimeline(tl).ok, JSON.stringify(T.validateTimeline(tl).errors));
  assert.ok(tl.beats[1].outMs - tl.beats[1].inMs >= R.DATA_MIN_MS.play, 'a play holds for its count-up');
  const rp = build('replay', 'classic');
  assert.deepEqual(rp.outputs, ['reel', 'carousel']);
  assert.equal(rp.slides.length, 5);
  assert.equal(rp.beats[1].kind, 'panel3');
  // No data behind a data kind: it degrades to a story point, never an empty box.
  const bare = R.buildTimeline({ format: 'gameswing', beats: [{ id: 'b1', kind: 'hook', text: 'Hi' }, { id: 'b2', kind: 'play', text: 'x', refs: ['play:nope'] }, { id: 'b3', kind: 'wpline', text: 'y' }] }, { style: 'series' });
  assert.deepEqual(bare.beats.map(b => b.kind), ['hook', 'point', 'point']);
  // A carousel-only project on the 4:5 canvas.
  const four = R.buildTimeline(planOf(fx(FIX.archive)), { style: 'countdown', canvas: { w: 1080, h: 1350 } });
  assert.deepEqual(four.canvas, { w: 1080, h: 1350 });
  assert.deepEqual(four.outputs, ['carousel']);
  // News formats keep v1 exactly.
  assert.equal(R.buildTimeline(STAT_PLAN, {}).v, 1);
});

test('data formats: every style x every data kind stays inside the safe zone and clear of the ES mark', () => {
  const zone = { x: R.ES_MARK.x - R.ES_MARK.clear, y: R.ES_MARK.y - R.ES_MARK.clear, w: R.ES_MARK.w + 2 * R.ES_MARK.clear, h: R.ES_MARK.h + 2 * R.ES_MARK.clear };
  for (const id of Object.keys(FIX)) {
    for (const style of S.STYLE_IDS) {
      const tl = build(id, style);
      const data = new Set(tl.beats.filter(b => R.DATA_TEMPLATES.has(b.kind)).map(b => b.id));
      assert.ok(data.size, `${id} has data beats`);
      R.allBoxes(measure, tl).filter(b => data.has(b.beat)).forEach(b => {
        assert.ok(b.x >= R.SAFE.left - 0.5 && b.x + b.w <= R.SAFE.right + 0.5 && b.y >= R.SAFE.top - 0.5 && b.y + b.h <= R.SAFE.bottom + 0.5, `${id}/${style} ${b.role} ${JSON.stringify(b)}`);
        if (b.role !== 'es-mark') assert.ok(!(b.x < zone.x + zone.w && b.x + b.w > zone.x && b.y < zone.y + zone.h && b.y + b.h > zone.y), `${id}/${style} ${b.role} in the logo clear space`);
      });
      const { ctx, calls } = recCtx();
      for (let t = 0; t < tl.durationMs; t += 300) R.drawFrame(ctx, tl, t, { measure, images: {}, videos: {} });
      assert.ok(calls.some(c => c[0] === 'fillText'));
    }
  }
});

test('scorebug: digest scores (a scoring play counts up from the score before), down, clock tab, possession', () => {
  const tl = build('gameswing', 'series');
  const ops = R.layoutGraphic(measure, tl.tracks.graphics[1], tl);
  const scores = ops.filter(o => o.type === 'score');
  assert.deepEqual(scores.map(o => [o.from, o.to]), [[0, 7], [3, 3]], 'SF 0 -> 7 on the touchdown, DAL stays 3');
  assert.deepEqual(scores[0].refs, ['play:401873063558', 'play:401873063302']);
  assert.ok(ops.some(o => o.role === 'down' && o.text === '1ST & 10'));
  assert.ok(ops.some(o => o.role === 'clock-text' && o.text === 'Q1  6:56'));
  const poss = ops.find(o => o.role === 'possession');
  assert.ok(poss && poss.x < scores[1].cellX, 'possession under the away (SF) score');
  const bug = ops.find(o => o.role === 'scorebug');
  assert.ok(bug.x + bug.w <= R.ES_MARK.x - R.ES_MARK.clear);
  // The wpline beat shows the final.
  const fin = R.layoutGraphic(measure, tl.tracks.graphics[2], tl);
  assert.deepEqual(fin.filter(o => o.type === 'score').map(o => o.to), [46, 40]);
  assert.ok(fin.some(o => o.role === 'status' && o.text === 'FINAL'));
  assert.equal(R.periodLabel({ sport: 'nfl' }, { period: 6 }), '2OT');
  assert.equal(R.periodLabel({ sport: 'mlb' }, { period: 9, half: 'bottom' }), 'BOT 9');
});

// Real digests (ESPN, 2026-10-28 MIL at TB and 2026-11-14 TEX at LSU) as the Game Swing editor gets them.
const realSwing = (name, playIds, style = 'series') => {
  const game = fx(name);
  const beats = [{ id: 'b1', kind: 'hook', text: 'Hook' }, ...playIds.map((id, i) => ({ id: `b${i + 2}`, kind: 'play', text: 'A play', refs: [`play:${id}`] }))];
  return R.buildTimeline({ format: 'gameswing', title: 'Swing', sport: game.sport, beats }, { style, canvas: { w: 1080, h: 1920 }, data: { game } });
};

test('scorebug, MLB: no clock tab repeating the inning; the bug shows it once; the clip moves up into the space', () => {
  for (const style of S.STYLE_IDS) {
    const tl = realSwing('mlb-401908046.digest.json', ['4019080460204990057', '4019080461002990057'], style);
    tl.tracks.graphics.filter(g => g.template === 'play').forEach(g => {
      const ops = R.layoutGraphic(measure, g, tl);
      assert.ok(!ops.some(o => o.role === 'clock' || o.role === 'clock-text'), `${style}: no clock tab for baseball`);
      const innings = ops.filter(o => o.text != null && /^(?:TOP|BOT) \d+$/.test(o.text));
      assert.equal(innings.length, 1, `${style}: the inning once`);
      assert.equal(innings[0].role, 'down');
    });
  }
  const top = R.layoutGraphic(measure, realSwing('mlb-401908046.digest.json', ['4019080460204990057']).tracks.graphics[1], realSwing('mlb-401908046.digest.json', ['4019080460204990057']));
  assert.ok(top.some(o => o.text === 'TOP 2'));
  // Football keeps its clock tab (period + clock), CFB too.
  const cfb = realSwing('cfb-401856885.digest.json', ['401856885813']);
  const ops = R.layoutGraphic(measure, cfb.tracks.graphics[1], cfb);
  assert.ok(ops.some(o => o.role === 'clock-text' && o.text === 'Q4  0:03'));
  assert.ok(ops.some(o => o.role === 'down' && o.text === '2ND & GOAL'));
});

test('play card, CFB: the line under the headline is the play without ESPN noise, numbers only from the play', () => {
  const tl = realSwing('cfb-401856885.digest.json', ['401856885794', '401856885813', '401856885508', '401856885250']);
  const lines = tl.tracks.graphics.filter(g => g.template === 'play').map(g => R.layoutGraphic(measure, g, tl).filter(o => o.role === 'play-text').map(o => o.text).join(' '));
  assert.deepEqual(lines, [
    'A. Manning pass complete short right',
    'Raleek Brown 4 Yd pass from Arch Manning',
    'D. Jones rush middle for 4 yds gain',
    'S. Leavitt pass intercepted',
  ]);
  lines.forEach(l => assert.ok(!/Shotgun|Huddle|#\d|…|\(/.test(l), l));
  const lint = require('../reel-lint.js').lintTimeline(tl, { boxes: R.allBoxes(measure, tl), extraSources: T.digestFacts(tl.data.game) });
  const numberIssues = lint.issues.filter(i => i.id === 'numbers' || i.id === 'data-numbers');
  assert.deepEqual(numberIssues, [], 'every number on the card is the play\'s own');
});

test('win probability: the chart, the swing marker from the refs, and the attribution every time', () => {
  const tl = build('gameswing', 'series');
  const wp = R.layoutGraphic(measure, tl.tracks.graphics[2], tl);
  const chart = wp.find(o => o.type === 'wpchart');
  assert.equal(chart.mode, 'full');
  assert.deepEqual([chart.from, chart.to], [-1, 1]);
  assert.ok(wp.some(o => o.role === 'wp-callout' && o.text === 'SF 63%'), 'SF 63% at wp:1 (DAL 0.3663)');
  assert.ok(wp.some(o => o.role === 'wp-from' && o.text === 'SF 64%'));
  assert.deepEqual(wp.filter(o => o.role === 'attribution').map(o => o.text), ['Win probability: ESPN Analytics']);
  const band = R.layoutGraphic(measure, tl.tracks.graphics[1], tl);
  assert.equal(band.find(o => o.type === 'wpchart').mode, 'band');
  assert.ok(band.some(o => o.role === 'attribution'));
  // No WP in the digest: no chart and no attribution line.
  const f = fx(FIX.gameswing);
  f.data.game.wp = null;
  const noWp = R.buildTimeline(planOf(f), { style: 'series' });
  assert.equal(noWp.beats[2].kind, 'point', 'a wpline beat needs WP');
  assert.ok(!R.layoutGraphic(measure, noWp.tracks.graphics[1], noWp).some(o => o.type === 'wpchart' || o.role === 'attribution'));
  // The chart draws on: early frames reveal less of the line than late ones.
  const st = (local) => { const { ctx, calls } = recCtx(); R.drawFrame(ctx, tl, tl.beats[2].inMs + local, { measure, images: {}, videos: {} }); return calls.filter(c => c[0] === 'lineTo').length; };
  assert.ok(st(3000) >= st(400));
});

test('team colours: from the digest, contrast-checked against the bug, never purple, distinct teams', () => {
  const f = fx(FIX.gameswing);
  f.data.game.teams.home.colors = ['#003594', '#869397'];
  f.data.game.teams.away.colors = ['#5B2C83', '#AA0000'];
  const tl = R.buildTimeline(planOf(f), { style: 'series' });
  const chips = R.layoutGraphic(measure, tl.tracks.graphics[1], tl).filter(o => o.role === 'team-chip').map(o => o.fill);
  assert.deepEqual(chips, ['#AA0000', '#003594'], 'away purple skipped, home navy');
  assert.equal(R.bestInk('#FFB612'), '#111214', 'dark ink on gold');
  assert.equal(R.bestInk('#003594'), '#FFFFFF');
  f.data.game.teams.away.colors = ['#003594'];
  const same = R.buildTimeline(planOf(f), { style: 'series' });
  const c2 = R.layoutGraphic(measure, same.tracks.graphics[1], same).filter(o => o.role === 'team-chip').map(o => o.fill);
  assert.notEqual(c2[0], c2[1], 'two teams never share a colour');
});

test('provenance: every number a data element draws comes from a ref', () => {
  for (const id of Object.keys(FIX)) {
    for (const style of S.STYLE_IDS) {
      const tl = build(id, style);
      assert.deepEqual(R.unbackedNumbers(measure, tl), [], `${id}/${style}`);
      R.buildSlides(tl).forEach(s => assert.deepEqual(R.unbackedNumbers(measure, s), [], `${id}/${style} ${s.slide.id}`));
    }
  }
  const tl = build('archive', 'countdown');
  const nums = R.provenanceNumbers(tl, ['stat:s2001']);
  ['2001', '2843', '18', '12'].forEach(n => assert.ok(nums.has(n), n));
  assert.ok(!nums.has('4694'));
  const wp = R.provenanceNumbers(build('gameswing', 'series'), ['wp:1']);
  assert.ok(wp.has('37') && wp.has('63'));
  // A moment line that says something its stat row does not.
  tl.data.archive.moments[0].line = '9,999 yards in one year';
  tl.data.athlete.stats.seasons[1].stats = tl.data.athlete.stats.seasons[1].stats.map(() => '-'); // no stat rows: the line shows
  const bad = R.unbackedNumbers(measure, tl);
  assert.ok(bad.some(u => u.numbers.includes('9999')), JSON.stringify(bad));
});

test('archive: year from the cited source, stat rows from ESPN strings, source chip, the year rail', () => {
  const tl = build('archive', 'countdown');
  const t = textsOf(tl, 'b2');
  assert.ok(t.includes('2001'));
  assert.ok(t.includes('2,843') && t.includes('18') && t.includes('12'), 'ESPN display strings, never recomputed');
  assert.ok(t.includes('PASSING') && t.includes('YARDS'), 'the stat\'s full name');
  assert.ok(t.includes('ESPN · 2001 SEASON STATS'));
  const ops = R.layoutGraphic(measure, tl.tracks.graphics[1], tl);
  assert.equal(ops.filter(o => o.role === 'rail-node-on').length, 1);
  assert.equal(ops.filter(o => o.role === 'rail-node' || o.role === 'rail-node-on').length, 2);
  const info = R.momentInfo(tl, ['stat:s2022']);
  assert.equal(info.year, 2022);
  assert.deepEqual(info.tiles.map(x => x.label), ['YDS', 'TD', 'INT']);
});

test('replay: three panels from the frames, chips and captions, staggered in; images from env', () => {
  const f = fx(FIX.replay);
  f.replay.frames = f.replay.frames.map(x => ({ ...x, caption: `The ${x.role} moment here today now` }));
  const tl = R.buildTimeline(planOf(f), { style: 'classic', assets: f.assets });
  const ops = R.layoutGraphic(measure, tl.tracks.graphics[1], tl);
  const panels = ops.filter(o => o.type === 'panel');
  assert.deepEqual(panels.map(p => p.key), ['frame:setup', 'frame:play', 'frame:reaction']);
  assert.ok(panels[0].delay < panels[1].delay && panels[1].delay < panels[2].delay);
  assert.deepEqual(ops.filter(o => o.role === 'panel-chip').map(o => o.text), ['SETUP', 'THE PLAY', 'REACTION']);
  ops.filter(o => o.role === 'panel-caption').forEach(o => assert.ok(o.text.split(' ').length <= 6, 'captions <= 6 words'));
  const img = { width: 1280, height: 720 };
  const { ctx, calls } = recCtx();
  R.drawFrame(ctx, tl, tl.beats[1].outMs - 400, { measure, images: { 'frame:setup': img, 'frame:play': img, 'frame:reaction': img }, videos: {} });
  assert.ok(calls.filter(c => c[0] === 'drawImage').length >= 3, 'all three frames drawn');
  const empty = recCtx();
  R.drawFrame(empty.ctx, tl, tl.beats[1].outMs - 400, { measure, images: {}, videos: {} });
  assert.ok(empty.calls.some(c => c[0] === 'fillText' && c[1] === 'PICK A FRAME'), 'the empty state, never a blank panel');
});

test('slides: drawn on a 1080x1350 canvas with the ES mark top-right; logo placements follow the canvas', () => {
  const tl = build('replay', 'classic');
  const slides = R.buildSlides(tl);
  slides.forEach(s => {
    const { ctx, calls } = recCtx();
    R.drawFrame(ctx, s, 2399, { measure, images: {}, videos: {} });
    const clip = calls.find(c => c[0] === 'rect');
    assert.deepEqual(clip.slice(1), [0, 0, 1080, 1350]);
    const [m] = R.logoPlacements(s);
    assert.deepEqual([m.x, m.y, m.w, m.h], [R.SLIDE_MARK.x, 60, 80, 80], 'the 80 px ES mark, right 60');
    R.allBoxes(measure, s).filter(b => b.text != null).forEach(b => assert.ok(b.x >= 59.5 && b.x + b.w <= 1020.5 && b.y >= 59.5 && b.y + b.h <= 1290.5, `${s.slide.id} ${b.role} ${JSON.stringify(b)}`));
  });
});

// ─── Reels 2.0: looks ────────────────────────────────────────────────────
test('looks: an ES timeline carries its look (opts.look, else plan.look, else paper); a retired style carries none; data formats default to ES and wear it', () => {
  const es = extra => R.buildTimeline({ ...STAT_PLAN, ...(extra.plan || {}) }, { style: 'es', ...(extra.opts || {}) });
  assert.equal(es({}).look, 'paper');
  assert.equal(es({ plan: { look: 'ink' } }).look, 'ink');
  assert.equal(es({ plan: { look: 'ink' }, opts: { look: 'blue' } }).look, 'blue');
  assert.equal(es({ opts: { look: 'nope' } }).look, 'paper');
  assert.equal('look' in R.buildTimeline(STAT_PLAN, { style: 'classic', look: 'ink' }), false);
  assert.equal(R.styleRetired(R.buildTimeline(STAT_PLAN, { style: 'classic' })), true);
  assert.equal(R.styleRetired(es({})), false);
  for (const id of Object.keys(FIX)) {
    assert.equal(F.FORMATS[id].defaultStyle, 'es');
    const paper = build(id, 'es');
    const ink = build(id, 'es', { opts: { look: 'ink' } });
    assert.equal(paper.v, 2);
    assert.equal(paper.look, 'paper');
    assert.equal(ink.look, 'ink');
    assert.equal(R.styleOf(paper), S.STYLES.es, `${id}: Paper is the ES style as it was`);
    assert.equal(R.styleOf(ink).palette.paper, '#121212', `${id}: Ink re-skins the data layouts`);
    assert.equal(R.styleOf(ink).theme, 'dark');
    R.buildSlides(ink, { style: 'es' }).forEach(sl => assert.equal(sl.look, 'ink'));
    for (let t = 0; t < ink.durationMs; t += 1500) { const c = recCtx(); assert.doesNotThrow(() => R.drawFrame(c.ctx || c, ink, t, { measure })); }
  }
});


console.log(process.exitCode ? '\nReel render tests failed.' : `\nAll ${passed} reel render tests passed.`);
