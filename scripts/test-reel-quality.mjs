#!/usr/bin/env node
// Reels Studio output quality (feature/reels-quality): the official ES mark
// and its lint rule, beat transitions and the finish pass, the clip picker
// (ranking, best segment, no reuse, mocked vision judge, cost cap, caching),
// muted clip audio by default and the shared music library. No network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../reel-render.js');
const S = require('../reel-styles.js');
const L = require('../reel-lint.js');
const F = require('../reel-formats.js');
const C = require('../reel-clips.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
const measure = (text, font) => String(text).length * Number(String(font).match(/([\d.]+)px/)[1]) * 0.5;
const stubCtx = calls => new Proxy({}, {
  get(target, key) {
    if (key in target) return target[key];
    if (key === 'measureText') return text => ({ width: String(text).length * 20 });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (key === 'createPattern') return () => null;
    if (key === 'getImageData') return undefined;
    return (...args) => { calls[key] = (calls[key] || 0) + 1; if (key === 'drawImage') calls.images.push(args); };
  },
  set(target, key, value) { target[key] = value; return true; },
});
const corpus = 'Mahomes 6.5 yards per throw 714 seasons rank 234 1 in 5 +50% 2× 2026 6-2 -$12.3M $40M #31 #2 #25 48% 2018 2006 2027 2028';
const PLAN = {
  format: 'explainer', title: 'Mahomes isn\'t playing like Mahomes', sport: 'nfl', eyebrow: 'Patrick Mahomes · 714 QB seasons',
  team: { name: 'Kansas City Chiefs', colors: ['#E31837', '#FFB81C'] },
  strip: { label: '2027 cap space', value: '-$12.3M', of: '$40M', tone: 'bad' }, series: { tag: 'ES Moneyball' },
  beats: [
    { id: 'b1', kind: 'hook', text: 'A very long hook headline that would run under the logo', vo: 'Patrick Mahomes is not playing like Patrick Mahomes.', emphasis: 'Mahomes' },
    { id: 'b2', kind: 'stat', text: 'Average throw depth', vo: 'His average throw travels just 6.5 yards.', stat: { value: '6.5', label: 'Yards per throw' } },
    { id: 'b3', kind: 'dotrank', text: 'Mahomes vs 714 QB seasons', vo: 'Out of 714 seasons his ranks 234th.', dotrank: { total: '714', rank: '234', label: '2018 Mahomes' } },
    { id: 'b4', kind: 'bars', text: 'Turnover-worthy throws', vo: 'Allen has twice as many.', bars: [{ label: 'Chiefs', value: '1×' }, { label: 'Allen', value: '2×' }] },
    { id: 'b5', kind: 'tiles', text: 'Teams that rebuilt', vo: 'Three teams rebuilt.', tiles: [{ team: 'Steelers', colors: ['#FFB612'] }, { team: 'Ravens', colors: ['#241773'] }] },
    { id: 'b6', kind: 'cta', text: 'Is Mahomes back in January?', vo: 'Is Mahomes back? Tell us below.' },
  ],
};
const build = (style, extra = {}) => R.buildTimeline(PLAN, { style, team: PLAN.team, corpus, ...extra });

// ─── Logo ──────────────────────────────────────────────────────────────────
await test('logo (ES video system): the official ES letters in an 80 px blue square, right 60, top 330, on the hook and the end card only, in every style', () => {
  assert.ok(R.BRAND.mark.d.startsWith('M54.1567 57.7938'), 'path data from assets/brand-logos/essentiallysports-mark.svg');
  assert.equal(R.BRAND.mark.box, '#0A7DFA');
  S.STYLE_IDS.forEach(style => {
    const tl = build(style);
    const marks = R.logoPlacements(tl);
    assert.deepEqual(marks.map(m => m.beat), [tl.beats[0].id, tl.beats.at(-1).id], `${style}: hook + end card`);
    assert.ok(marks.at(-1).endcard, style);
    marks.forEach(m => {
      assert.equal(m.w, 80); assert.equal(m.h, 80);
      assert.equal(m.x + m.w, 1080 - 60, `${style} right 60`);
      assert.equal(m.y, 330, `${style} top 330`);
      assert.equal(m.clear, 40, 'clear space: half its height');
    });
    assert.equal(tl.assets['logo:es'].src, 'assets/brand-logos/essentiallysports-mark.svg');
  });
});

await test('logo: no text or chart enters the 50 px clear space (headlines wrap short beside the mark)', () => {
  S.STYLE_IDS.forEach(style => {
    const tl = build(style);
    const m = R.ES_MARK;
    const zone = { x: m.x - m.clear, y: m.y - m.clear, w: m.w + 2 * m.clear, h: m.h + 2 * m.clear };
    const hits = R.allBoxes(measure, tl).filter(b => b.role !== 'es-mark' && b.x < zone.x + zone.w && b.x + b.w > zone.x && b.y < zone.y + zone.h && b.y + b.h > zone.y);
    assert.deepEqual(hits.map(b => `${b.role}:${b.text || ''}`), [], style);
    const lint = L.lintTimeline(tl, { boxes: R.textBoxes(measure, tl) });
    assert.ok(!lint.issues.some(i => i.id === 'logo'), `${style}: ${JSON.stringify(lint.issues.filter(i => i.id === 'logo'))}`);
  });
});

await test('logo: colourway follows what is under it (black on ES blue, blue elsewhere); drawn last, unfaded', () => {
  assert.equal(R.markVariant('#0A7DFA'), 'black');
  assert.equal(R.markVariant('#1F6FEB'), 'black');
  assert.equal(R.markVariant('#ECEAE6'), 'blue');
  assert.equal(R.markVariant('#0D1220'), 'blue');
  assert.equal(R.markVariant('not a colour'), 'blue');
  const calls = { images: [] };
  const tl = build('explainer');
  const logo = { width: 123, height: 105 };
  R.drawFrame(stubCtx(calls), tl, 1500, { measure, images: { 'logo:es': logo } });
  const last = calls.images[calls.images.length - 1];
  assert.equal(last[0], logo, 'the ES mark is the last image drawn (over the finish pass)');
  // Node has no Path2D: the mark falls back to the official file, scaled
  // uniformly to 80 px wide and centred in the 80 px blue square.
  const h = (80 * R.BRAND.mark.h) / R.BRAND.mark.w;
  assert.deepEqual(last.slice(1).map(v => Math.round(v * 100) / 100), [R.ES_MARK.x, Math.round((R.ES_MARK.y + (80 - h) / 2) * 100) / 100, 80, Math.round(h * 100) / 100]);
});

await test('logo lint: missing, scaled, moved or crowded marks are critical; a non-official file is critical', () => {
  const tl = build('explainer');
  const ok = R.logoPlacements(tl);
  const lint = marks => L.lintTimeline(tl, { marks }).issues.filter(i => i.id === 'logo');
  assert.ok(lint(ok.slice(1)).some(i => i.severity === 'critical' && /no ES logo/.test(i.message)), 'missing on beat 1');
  assert.ok(lint(ok.map(m => ({ ...m, w: 76, h: 65 }))).some(i => /not 80x80/.test(i.message)), 'scaled');
  assert.ok(lint(ok.map(m => ({ ...m, x: 84 }))).some(i => /not top-right/.test(i.message)), 'moved top-left (the old bug)');
  const crowd = L.lintTimeline(tl, { boxes: [{ beat: 'b1', role: 'headline', text: 'TOO WIDE', x: 700, y: 330, w: 300, h: 60 }] }).issues;
  assert.ok(crowd.some(i => i.id === 'logo' && i.severity === 'critical' && /clear space/.test(i.message)));
  const fake = { ...tl, assets: { ...tl.assets, 'logo:es': { ...tl.assets['logo:es'], src: 'es-badge-text.png' } } };
  assert.ok(L.lintTimeline(fake, {}).issues.some(i => i.id === 'logo' && /official/.test(i.message)));
});

await test('end card: the official logotype at 96 px tall (ES video system), Essentially Golf on golf reels; no "ES" set in type', () => {
  ['classic', 'explainer'].forEach(style => {
    const tl = build(style);
    const ops = R.layoutGraphic(measure, tl.tracks.graphics.at(-1), tl);
    const wm = ops.find(o => o.type === 'wordmark');
    assert.ok(wm && wm.brand === 'wordmark' && wm.h === 96 && wm.w === Math.round((96 * 258) / 30.6864), style);
    assert.ok(!ops.some(o => /^ESSENTIALLYSPORTS$|^ES$/.test(String(o.text || ''))), `${style}: no typeset logo`);
  });
  const golf = R.buildTimeline({ ...PLAN, sport: 'golf' }, { style: 'explainer', corpus });
  assert.equal(R.layoutGraphic(measure, golf.tracks.graphics.at(-1), golf).find(o => o.type === 'wordmark').brand, 'golf');
  S.STYLE_IDS.forEach(style => assert.ok(!R.layoutChrome(measure, build(style), {}).some(o => o.role === 'badge-text'), `${style}: no ES text badge`));
});

// ─── Motion and finish ─────────────────────────────────────────────────────
await test('transitions: push / wipe / lift between beats in the styled looks, the outgoing beat drawn whole', () => {
  [['explainer', 'slide'], ['series', 'wipe'], ['countdown', 'flip']].forEach(([style, kind]) => {
    const tl = build(style);
    const b2 = tl.beats[1];
    const f = R.frameAt(tl, b2.inMs + 40);
    assert.equal(f.transition.kind, kind);
    assert.ok(f.transition.p > 0 && f.transition.p < 0.3);
    assert.equal(f.transition.from.beat, 'b1');
    assert.equal(f.graphic.exit, 0, 'no fade-out first');
    assert.equal(R.frameAt(tl, b2.inMs + S.get(style).motion.transitionMs + 20).transition, null);
    assert.equal(R.frameAt(tl, 10).transition, null, 'none on the first beat');
  });
  const classic = build('classic');
  assert.equal(R.frameAt(classic, classic.beats[1].inMs + 40).transition, null, 'Classic keeps its cross-fade');
});

await test('every style draws every frame with the finish pass (stub canvas); count-ups for bar and versus values', () => {
  S.STYLE_IDS.forEach(style => {
    const tl = build(style);
    const calls = { images: [] };
    const ctx = stubCtx(calls);
    for (let t = 0; t < tl.durationMs; t += 1000 / 15) R.drawFrame(ctx, tl, t, { measure, images: { 'logo:es': { width: 123, height: 105 } }, grain: {} });
    assert.ok(calls.fillText > 50, style);
  });
  const tl = build('explainer');
  const bars = R.layoutGraphic(measure, tl.tracks.graphics[3], tl);
  assert.ok(bars.filter(o => o.role === 'bar-value').every(o => o.type === 'count'));
  assert.equal(bars.find(o => o.role === 'bar').fill, '#E31837', 'the reel\'s team keeps its colour in a bar that names it');
  const tiles = R.layoutGraphic(measure, R.buildTimeline(PLAN, { style: 'series', corpus }).tracks.graphics[4], R.buildTimeline(PLAN, { style: 'series', corpus }));
  assert.equal(tiles.find(o => o.role === 'tile-name' && o.text === 'STEELERS').color, '#111214', 'ink on Steelers gold');
  assert.equal(tiles.find(o => o.role === 'tile-name' && o.text === 'RAVENS').color, '#FFFFFF');
});

await test('captions: an 820 px measure, clear of the like / share rail', () => {
  S.STYLE_IDS.forEach(style => {
    const tl = build(style);
    tl.tracks.captions.cards.forEach(card => R.layoutCaption(measure, card, tl).ops.forEach(op => {
      const x0 = op.box ? op.box.x : op.x;
      const x1 = op.box ? op.box.x + op.box.w : op.x + op.w;
      // v3: ES captions sit on the column (x 60); the right edge keeps clear of the like / share rail.
      const left = S.STYLES[style].engine === 'es' ? 60 - 0.5 : (1080 - R.CAPTION_W) / 2 - 31;
      assert.ok(x0 >= left && x1 <= (1080 + R.CAPTION_W) / 2 + 31, `${style} caption ${x0}-${x1}`);
    }));
  });
});

// ─── Clip audio and music ──────────────────────────────────────────────────
await test('clip audio: muted by default; opt-in adds each clip\'s own sound from its trim point, ducked under the voice', () => {
  const assets = { 'clip:a': { kind: 'clip', durationMs: 8000, clipIn: 1.2, clipOut: 4.5, label: 'Clip', rights: { source: 'x', licence: 'y', organic: true, paid: true } } };
  const voice = { b1: { durationMs: 2000, asset: 'vo:b1' } };
  const opts = { style: 'classic', corpus, photos: { b1: ['clip:a'] }, assets, voice };
  const muted = R.buildTimeline(PLAN, opts);
  assert.ok(!muted.tracks.audio.some(a => a.kind === 'clip'), 'off by default');
  assert.equal(muted.tracks.video[0].clip.inSec, 1.2);
  assert.equal(muted.tracks.video[0].clip.durSec, 4.5, 'the picked segment ends where the picker said');
  const on = R.buildTimeline(PLAN, { ...opts, clipAudio: true });
  const sound = on.tracks.audio.find(a => a.kind === 'clip');
  assert.ok(sound && sound.asset === 'clipaudio:clip:a' && sound.offsetSec === 1.2);
  assert.ok(R.musicGainDbAt(sound.envelope, 1000) <= -25, 'ducked under the voice');
  assert.ok(on.assets['clipaudio:clip:a'].rights.organic, 'rights follow the clip');
  assert.ok(!R.buildTimeline(PLAN, { ...opts, clipAudio: [] }).tracks.audio.some(a => a.kind === 'clip'), 'a clip with no sound track adds nothing');
});

await test('music library: audio-library.json first (licence object), reels-music.json shape too; no licence or a remote file is dropped', () => {
  assert.deepEqual(F.MUSIC_FILES, ['audio-library.json', 'reels-music.json']);
  const shared = F.musicTracks({ tracks: [
    { id: 'drive', title: 'Drive', src: 'assets/audio/drive.mp3', licence: { name: 'Epidemic #1', organic: true, paid: true } },
    { id: 'calm', title: 'Calm', src: 'assets/audio/calm.mp3', licence: { organic: true, paid: false } },
    { id: 'far', title: 'Far', src: 'https://cdn.example.com/x.mp3', licence: { organic: true, paid: true } },
  ] });
  assert.deepEqual(shared.map(t => [t.id, t.organic, t.paid]), [['drive', true, true], ['calm', true, false]]);
  assert.equal(shared[1].licence, 'FrameUp audio library');
  const old = F.musicTracks({ tracks: [{ id: 'a', title: 'A', src: 'assets/reels-music/a.mp3', licence: 'Artlist #9', paid: true }, { id: 'b', src: 'b.mp3' }] });
  assert.deepEqual(old.map(t => [t.id, t.organic, t.paid]), [['a', true, true]]);
  assert.deepEqual(F.musicTracks(null), []);
});

// ─── Clip picker ───────────────────────────────────────────────────────────
const now = Date.now();
const clip = (url, extra = {}) => ({ url: `https://x.com/${url}`, handle: 'Chiefs', text: '', ageHours: 10, shortSide: 720, durationMs: 9000, source: 'official', variants: [{ url: `https://video.twimg.com/${url}.mp4`, width: 720, height: 1280 }], ...extra });
const POOL = [
  clip('crowd', { text: 'Arrowhead is loud tonight', handle: 'Chiefs' }),
  clip('mahomes', { text: 'Patrick Mahomes deep shot to Rice', ageHours: 30 }),
  clip('kelce', { text: 'Travis Kelce catch', source: 'media' }),
  clip('old', { text: 'Patrick Mahomes in 2019', ageHours: 118, shortSide: 360, source: 'other' }),
];
const BEATS = [
  { id: 'b1', kind: 'hook', text: 'Mahomes isn\'t playing like Mahomes', photo: 'Patrick Mahomes', durMs: 3000 },
  { id: 'b2', kind: 'point', text: 'Kelce is his safety valve', photo: 'Travis Kelce', durMs: 2500 },
  { id: 'b3', kind: 'point', text: 'The Chiefs offense', durMs: 2500 },
];
const PL = { team: { name: 'Kansas City Chiefs' } };

await test('ranking (AI off): the clip about the beat\'s player, fresh, official and sharp wins; old low-res fan copy loses', () => {
  const sub = C.subjectFor(BEATS[0], PL);
  assert.deepEqual(sub.players, ['Patrick Mahomes']);
  const ranked = POOL.map(c => [c.url.split('/').pop(), C.heuristicScore(c, sub).score]).sort((a, b) => b[1] - a[1]);
  assert.equal(ranked[0][0], 'mahomes');
  assert.ok(ranked.find(r => r[0] === 'old')[1] < ranked[0][1] - 15);
});

await test('assign (v3, gated): each beat gets its own relevant clip; a beat no clip is about gets none (no fallback)', () => {
  const out = C.assign(POOL, BEATS, PL);
  assert.equal(out.b1.clip.url, 'https://x.com/mahomes');
  assert.equal(out.b2.clip.url, 'https://x.com/kelce');
  assert.equal(out.b3, undefined, 'no unjudged crowd clip for "The Chiefs offense": no random fallback');
  assert.ok(/about Patrick Mahomes/.test(out.b1.why));
  const one = C.assign([POOL[1]], BEATS.slice(0, 2).map(b => ({ ...b, photo: 'Patrick Mahomes' })), PL, { samples: { [POOL[1].url]: Array.from({ length: 9 }, (_, i) => ({ t: i, motion: 0.5 })) } });
  assert.ok(/reused/.test(one.b2.why));
  assert.ok(one.b2.segment.inSec >= one.b1.segment.outSec - 0.01 || one.b2.segment.outSec <= one.b1.segment.inSec + 0.01, 'a reused clip plays a different part');
});

await test('vision judgement: what is on screen beats the post text; validated and clamped', () => {
  const sub = C.subjectFor(BEATS[0], PL);
  const j = C.validateJudgement({ kind: 'game-action', teams: ['Chiefs'], players: ['Patrick Mahomes'], quality: 14, action: [3, 9, 'x'], relevance: { [sub.key]: 9 }, textOverlay: false, note: 'deep pass' }, 3);
  assert.deepEqual(j.action, [3, 9, 5]);
  assert.equal(j.quality, 10);
  assert.equal(C.validateJudgement({ kind: 'nonsense' }).kind, 'other');
  assert.equal(C.validateJudgement(null), null);
  const crowd = POOL[0];
  const plain = C.judgedScore(crowd, sub, null).score;
  const seen = C.judgedScore(crowd, sub, j).score;
  assert.ok(seen > plain + 15, `${plain} -> ${seen}`);
  const slate = C.validateJudgement({ kind: 'graphic-or-text', quality: 4, action: [0, 1, 0], relevance: { [sub.key]: 2 }, textOverlay: true });
  assert.ok(C.judgedScore(POOL[1], sub, slate).score < C.judgedScore(POOL[1], sub, null).score, 'a logo slate drops even with a matching caption');
  const out = C.assign(POOL, [BEATS[0]], PL, { judgements: { [crowd.url]: j, [POOL[1].url]: slate } });
  assert.equal(out.b1.clip.url, crowd.url, 'the judged clip wins');
  assert.ok(out.b1.judged);
});

await test('best segment: the window with the most action for the beat\'s length, after the intro; motion from frame diffs', () => {
  const samples = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(t => ({ t, motion: t >= 5 && t <= 7 ? 1 : 0.1 }));
  const seg = C.bestSegment(samples, 2, 9);
  assert.ok(seg.inSec >= 4.5 && seg.outSec <= 8.01, JSON.stringify(seg));
  assert.ok(Math.abs(seg.outSec - seg.inSec - 2) < 0.01);
  assert.deepEqual(C.bestSegment([], 3, 9), { inSec: 0.4, outSec: 9, score: 0 });
  assert.equal(C.bestSegment(samples, 10, 6).inSec, 0, 'a clip shorter than the beat plays whole');
  const still = new Uint8Array(100).fill(10);
  const move = new Uint8Array(100).fill(200);
  const e = C.motionEnergy([still, still, move, still]);
  assert.equal(Math.max(...e), 1);
  assert.ok(e[1] === 0);
  // Judge action steers it too: the judged frames map to their sample times.
  const j = C.withActionAt(C.validateJudgement({ action: [10, 0, 0] }), [1, 4, 7]);
  const s2 = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((t, k) => ({ t, motion: 0.5, action: j.actionAt(k, t) }));
  assert.ok(C.bestSegment(s2, 2, 9).inSec < 2.5);
});

await test('cost: 8 clips x 3 frames on Gemini 3.8 Flash is about a cent, far under the $0.10 cap; the estimate counts cached clips out', () => {
  const full = C.judgeCost({ clips: 8 });
  assert.ok(full > 0.004 && full < 0.03, `${full}`);
  assert.ok(C.reelJudgeEstimate(8) <= C.JUDGE.maxUsdPerReel);
  assert.equal(C.reelJudgeEstimate(8, 8), 0);
  assert.ok(C.judgeCost({ clips: 3, model: 'anthropic/claude-haiku-5.5' }) < C.judgeCost({ clips: 3 }));
  const est = F.estimateCost({ clipJudge: C.reelJudgeEstimate(8) });
  assert.ok(est.lines.some(l => l.id === 'clipjudge' && l.usd > 0));
});

await test('cache: judgements kept per clip URL for 7 days, survive a reload, expire after', () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v) };
  let t = now;
  const a = C.makeCache(storage, { now: () => t });
  a.set('https://x.com/1', { kind: 'game-action' });
  assert.equal(C.makeCache(storage, { now: () => t }).get('https://x.com/1').kind, 'game-action');
  t += 8 * 864e5;
  assert.equal(C.makeCache(storage, { now: () => t }).get('https://x.com/1'), null);
  assert.equal(C.makeCache(null).get('x'), null, 'no storage: works, caches nothing');
});

// ─── Server judge (mocked Gateway) ─────────────────────────────────────────
await test('server judge: Gemini first, validated, cached per URL; Haiku when Gemini fails; never past the budget', async () => {
  process.env.AI_GATEWAY_API_KEY = 'test-key';
  delete process.env.GENERATE_AI;
  const J = require('../netlify/functions/_reel-clip-judge.js');
  const frame = `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`;
  const clips = [{ url: 'https://x.com/a', text: 'Mahomes deep shot', frames: [frame, frame, frame], times: [1, 3, 5] }];
  const subjects = [{ key: 'patrick mahomes', label: 'Patrick Mahomes' }];
  const seen = [];
  const reply = (model, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => (ok ? { choices: [{ message: { content: JSON.stringify({ clips: [{ i: 0, kind: 'game-action', players: ['Patrick Mahomes'], quality: 8, action: [4, 9, 6], relevance: { 'patrick mahomes': 9 } }] }) } }], usage: { prompt_tokens: 1200, completion_tokens: 120 } } : { error: { message: 'boom' } }) });
  const fetchOk = async (url, init) => { const body = JSON.parse(init.body); seen.push(body.model); assert.ok(body.messages[1].content.some(p => p.type === 'image_url')); return reply(body.model); };
  J.CACHE.clear();
  const r1 = await J.judgeClips({ clips, subjects, budgetUsd: 0.1, fetchImpl: fetchOk });
  assert.ok(r1.ok && r1.model === 'google/gemini-3.8-flash');
  assert.deepEqual(r1.judgements['https://x.com/a'].action, [4, 9, 6]);
  assert.ok(r1.cost > 0 && r1.cost < 0.01);
  const r2 = await J.judgeClips({ clips, subjects, budgetUsd: 0.1, fetchImpl: fetchOk });
  assert.equal(seen.length, 1, 'second call served from the cache');
  assert.equal(r2.cached, 1);
  J.CACHE.clear();
  const models = [];
  const flaky = async (url, init) => { const m = JSON.parse(init.body).model; models.push(m); return reply(m, m !== 'google/gemini-3.8-flash'); };
  const r3 = await J.judgeClips({ clips, subjects, budgetUsd: 0.1, fetchImpl: flaky });
  assert.deepEqual(models, ['google/gemini-3.8-flash', 'anthropic/claude-haiku-5.5']);
  assert.equal(r3.model, 'anthropic/claude-haiku-5.5');
  J.CACHE.clear();
  let called = 0;
  const r4 = await J.judgeClips({ clips, subjects, budgetUsd: 0.0001, fetchImpl: async () => { called += 1; return reply(''); } });
  assert.ok(r4.ok && r4.capped && called === 0, 'over the per-reel budget: no call');
  const bad = await J.judgeClips({ clips: [{ url: 'https://x.com/b', frames: ['javascript:alert(1)'] }], subjects, fetchImpl: fetchOk });
  assert.equal(bad.ok, false, 'only image data URLs are sent');
  process.env.GENERATE_AI = 'rules';
  assert.equal((await J.judgeClips({ clips, subjects, fetchImpl: fetchOk })).reason, 'off', 'AI off: heuristic ranking only');
  delete process.env.GENERATE_AI;
});

console.log(process.exitCode ? '\nReel quality tests failed.' : `\nAll ${passed} reel quality tests passed.`);
