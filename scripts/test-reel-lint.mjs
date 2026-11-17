#!/usr/bin/env node
// Reels Studio quality lint (reel-lint.js, netlify/functions/_reel-lint.js):
// hook in the first 2 s, safe zones, text length, caption contrast, total
// length, number provenance and rights. Critical issues block export.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../reel-render.js');
const L = require('../reel-lint.js');
const serverLint = require('../netlify/functions/_reel-lint.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
const measure = (text, font) => String(text).length * Number(String(font).match(/([\d.]+)px/)[1]) * 0.5;
const CORPUS = 'Josh Allen threw for 5,477 yards in 2025, a Bills record. Buffalo won the AFC East.';
const plan = (beats, format = 'stat') => ({ format, title: 'Allen', beats });
const GOOD = plan([
  { id: 'b1', kind: 'hook', text: '5,477 yards. A record.', vo: 'Josh Allen threw for 5,477 yards in 2025.' },
  { id: 'b2', kind: 'stat', text: '5,477 yards', vo: 'A Bills record.', stat: { value: '5,477', label: 'pass yds' } },
  { id: 'b3', kind: 'context', text: 'Buffalo won the East', vo: 'Buffalo won the AFC East.' },
  { id: 'b4', kind: 'point', text: 'The arm talent shows', vo: 'Every week the arm talent shows up in big moments for this team.' },
  { id: 'b5', kind: 'payoff', text: 'The MVP case is real', vo: 'That makes the MVP case very real for the Bills quarterback this season.' },
  { id: 'b6', kind: 'cta', text: 'Is he the MVP?', vo: 'Is he the MVP? Tell us.' },
]);
const lintOf = (p, opts = {}, build = {}) => {
  const tl = R.buildTimeline(p, { corpus: CORPUS, ...build });
  return { tl, res: L.lintTimeline(tl, { boxes: R.textBoxes(measure, tl), ...opts }) };
};
const ids = res => res.issues.map(i => `${i.severity}:${i.id}`);

test('a clean reel passes (captions-only info, no critical)', () => {
  const { res } = lintOf(GOOD);
  assert.equal(res.critical, 0, JSON.stringify(res.issues));
  assert.equal(res.ok, true);
  assert.ok(ids(res).includes('info:voice'), 'captions-only is noted');
});

test('numbers: an unsourced number is critical and names the beat', () => {
  const bad = structuredClone(GOOD);
  bad.beats[2].vo = 'Buffalo won the AFC East for the 6th year.';
  const { res } = lintOf(bad);
  const issue = res.issues.find(i => i.id === 'numbers');
  assert.equal(issue.severity, 'critical');
  assert.equal(issue.beat, 'b3');
  assert.match(issue.message, /6/);
  assert.equal(res.ok, false);
  // Adding a source clears it.
  const { res: fixed } = lintOf(bad, { extraSources: 'Bills: 6th straight division title' });
  assert.equal(fixed.issues.some(i => i.id === 'numbers'), false);
});

test('hook: no claim on screen in the first 2 s is critical; a non-hook opener warns', () => {
  const noText = structuredClone(GOOD);
  noText.beats[0].text = '';
  noText.beats[0].vo = '';
  assert.ok(ids(lintOf(noText).res).includes('critical:hook'));
  const late = structuredClone(GOOD);
  late.beats[0].kind = 'context';
  assert.ok(ids(lintOf(late).res).includes('warning:hook'));
});

test('safe zone: a box outside x 65-1015 / y 270-1580 is critical', () => {
  const { tl } = lintOf(GOOD);
  const boxes = [{ beat: 'b1', role: 'text', text: 'WIDE', x: 40, y: 900, w: 1000, h: 80 }];
  const res = L.lintTimeline(tl, { boxes });
  assert.ok(ids(res).includes('critical:safe-zone'));
  const low = L.lintTimeline(tl, { boxes: [{ beat: 'b1', role: 'caption', text: 'LOW', x: 200, y: 1560, w: 200, h: 60 }] });
  assert.ok(ids(low).includes('critical:safe-zone'));
});

test('text length: more than 9 words on screen or 28 in the VO warns', () => {
  const long = structuredClone(GOOD);
  long.beats[3].text = 'one two three four five six seven eight nine ten eleven';
  long.beats[3].vo = Array.from({ length: 32 }, (_, i) => `word${i}`).join(' ');
  const res = lintOf(long).res;
  assert.ok(ids(res).includes('warning:text-length'));
  assert.ok(ids(res).includes('warning:vo-length'));
});

test('caption contrast: white on a light highlight is critical (team colours are filtered first)', () => {
  const { tl } = lintOf(GOOD);
  const res = L.lintTimeline({ ...tl, highlight: '#FFB81C' });
  assert.ok(ids(res).includes('critical:caption-contrast'));
  const goldTeam = lintOf(GOOD, {}, { team: { name: 'Packers', colors: ['#FFB81C', '#FFD100'] } }).res;
  assert.equal(ids(goldTeam).includes('critical:caption-contrast'), false, 'buildTimeline already picks ES Blue');
});

test('length: under 8 s or over 90 s is critical; long for the format warns', () => {
  const short = plan([{ id: 'a', kind: 'hook', text: 'Allen', vo: 'Allen.' }, { id: 'z', kind: 'cta', text: 'Thoughts?', vo: 'Thoughts?' }]);
  assert.ok(ids(lintOf(short).res).includes('critical:length'));
  const { tl } = lintOf(GOOD);
  assert.ok(ids(L.lintTimeline({ ...tl, durationMs: 95000 })).includes('critical:length'));
  assert.ok(ids(L.lintTimeline({ ...tl, durationMs: 70000 })).includes('warning:length'));
});

test('rights: a photo with no record is critical; paid export needs paid rights', () => {
  const build = { photos: { b1: ['img:1'] }, assets: { 'img:1': { kind: 'photo', label: 'ES photo', rights: { source: 'ES image pool', licence: 'Editorial', organic: true, paid: false } } } };
  assert.equal(lintOf(GOOD, {}, build).res.issues.some(i => i.id === 'rights'), false, 'organic is fine');
  const paid = lintOf(GOOD, { target: 'paid' }, build).res;
  assert.ok(paid.issues.some(i => i.id === 'rights' && /paid/.test(i.message) && i.severity === 'critical'));
  const none = lintOf(GOOD, {}, { photos: { b1: ['img:1'] }, assets: { 'img:1': { kind: 'photo', label: 'Mystery photo' } } }).res;
  assert.ok(none.issues.some(i => i.id === 'rights' && /no rights record/.test(i.message)));
  // Music without a licence note blocks too.
  const music = lintOf(GOOD, {}, { music: { asset: 'music' }, assets: { music: { kind: 'music', label: 'Music: Track', rights: { source: 'Uploaded by you', licence: '', organic: false, paid: false } } } }).res;
  assert.ok(music.issues.some(i => i.id === 'rights' && /Music/.test(i.message)));
});

test('rights: generated music (organic only) blocks a paid export, not an organic one', () => {
  const V = require('../netlify/functions/_reel-voice.js');
  const build = { music: { asset: 'music' }, assets: { music: { kind: 'music', label: 'Music: Generated hype bed', rights: { ...V.MUSIC_RIGHTS } } } };
  assert.equal(lintOf(GOOD, { target: 'organic' }, build).res.issues.some(i => i.id === 'rights'), false);
  const paid = lintOf(GOOD, { target: 'paid' }, build).res;
  assert.ok(paid.issues.some(i => i.id === 'rights' && i.severity === 'critical' && /Generated/.test(i.message)));
});

test('style and ending: banned words warn; a reel without an end card warns', () => {
  const bad = structuredClone(GOOD);
  bad.beats[3].text = 'An insane throw';
  bad.beats.pop();
  const res = lintOf(bad).res;
  assert.ok(ids(res).includes('warning:style'));
  assert.ok(ids(res).includes('warning:ending'));
});

test('rightsSummary: one row per asset in use, with coverage for the target', () => {
  const { tl } = lintOf(GOOD, {}, { photos: { b1: ['img:1'] }, assets: { 'img:1': { kind: 'photo', label: 'ES photo', rights: { source: 'ES image pool', licence: 'Editorial', organic: true, paid: false } } } });
  const organic = L.rightsSummary(tl, 'organic');
  assert.ok(organic.every(r => r.covered));
  assert.ok(organic.some(r => r.id === 'img:1'));
  assert.equal(L.rightsSummary(tl, 'paid').find(r => r.id === 'img:1').covered, false);
});

test('server lintPlan: same rules on a plan, with its duration', () => {
  const res = serverLint.lintPlan(GOOD, { corpus: CORPUS });
  assert.equal(res.critical, 0);
  assert.ok(res.durationMs > 10000);
  assert.equal(typeof serverLint.lintTimeline, 'function');
});

test('numbers: every new component field and the plan strip / eyebrow are checked (blocking)', () => {
  const comp = (beat, extra = {}) => lintOf({ ...plan([GOOD.beats[0], { id: 'x', ...beat }, GOOD.beats[5]], 'explainer'), ...extra }, {}, { style: 'series' }).res;
  const cases = [
    { kind: 'bars', text: 'Bars', vo: 'Bars.', bars: [{ label: 'Allen', value: '9×' }, { label: 'X', value: '5,477' }] },
    { kind: 'versus', text: 'Versus', vo: 'Versus.', versus: [{ name: 'Allen', value: '+42%' }, { name: 'Y', value: '5,477' }] },
    { kind: 'dotrank', text: 'Dots', vo: 'Dots.', dotrank: { total: '714', rank: '5' } },
    { kind: 'chips', text: 'Chips', vo: 'Chips.', chips: { filled: '3', total: '7' } },
    { kind: 'tiles', text: 'Tiles', vo: 'Tiles.', tiles: [{ team: 'Bills', label: '13-4 season' }, { team: 'Jets', label: 'x' }] },
    { kind: 'roles', text: 'Roles', vo: 'Roles.', roles: [{ role: 'WR', value: '#31' }, { role: 'LB', value: 'FA' }] },
  ];
  cases.forEach(beat => assert.ok(comp(beat).issues.some(i => i.id === 'numbers' && i.severity === 'critical' && i.beat === 'x'), beat.kind));
  const steps = comp({ kind: 'steps', text: 'Step', vo: 'Step.', steps: { current: '2', total: '3', label: 'Plan' } });
  assert.ok(!steps.issues.some(i => i.id === 'numbers'), 'a step tracker counts the reel itself: no source needed');
  const strip = comp({ kind: 'point', text: 'P', vo: 'P.' }, { strip: { label: 'Cap', value: '$99M' } });
  assert.ok(strip.issues.some(i => i.id === 'numbers' && /strip/.test(i.message)));
  const ok = comp({ kind: 'point', text: 'P', vo: 'P.' }, { strip: { label: 'Yards', value: '5,477' } });
  assert.ok(!ok.issues.some(i => i.id === 'numbers'));
});

test('long-form styles: up to 120 s; classic stays 90', () => {
  const long = Array.from({ length: 14 }, (_, i) => ({ id: `l${i}`, kind: 'point', text: 'The arm talent shows', vo: 'Every week the arm talent shows up in the biggest moments for this team, again and again.' }));
  const p = plan([GOOD.beats[0], ...long, GOOD.beats[5]], 'explainer');
  const ex = lintOf(p, {}, { style: 'explainer' });
  assert.ok(ex.tl.durationMs > 90000 && ex.tl.durationMs <= 120000, `${ex.tl.durationMs}`);
  assert.ok(!ex.res.issues.some(i => i.id === 'length' && i.severity === 'critical'));
  const classic = L.lintTimeline(R.buildTimeline({ ...p, beats: p.beats }, { corpus: CORPUS, style: 'classic' }));
  assert.ok(classic.issues.every(i => i.id !== 'length' || i.severity !== 'critical'), 'classic caps at 12 beats so it stays short');
});

test('visuals: an empty slot warns (plain black); X clips are fine for paid (owner call) with a note; AI scenes get a label note', () => {
  const { res } = lintOf(GOOD);
  assert.ok(res.issues.some(i => i.id === 'visual' && i.severity === 'warning'));
  const assets = {
    'clip:x': { kind: 'clip', label: 'Official X post', durationMs: 6000, rights: { source: 'Official X post (https://x.com/Bills/status/1)', licence: 'Official X post; source link kept', organic: true, paid: true, x: true } },
    'scene:1': { kind: 'photo', label: 'AI scene', rights: { source: 'AI-generated', licence: 'AI', organic: true, paid: true, ai: true } },
  };
  const photos = Object.fromEntries(GOOD.beats.map((b, i) => [b.id, [i % 2 ? 'scene:1' : 'clip:x']]));
  const paid = lintOf(GOOD, { target: 'paid' }, { photos, assets }).res;
  assert.ok(!paid.issues.some(i => i.id === 'rights' && i.severity === 'critical'), JSON.stringify(paid.issues.filter(i => i.severity === 'critical')));
  assert.ok(paid.issues.some(i => i.id === 'rights' && i.severity === 'info' && /X posts/.test(i.message)));
  assert.ok(paid.issues.some(i => i.id === 'ai-label'));
  assert.ok(!paid.issues.some(i => i.id === 'visual'));
  const gone = lintOf(GOOD, {}, { photos: { b1: ['clip:x'] }, assets: {} }).res;
  assert.ok(!gone.issues.some(i => i.id === 'visual' && i.severity === 'critical'), 'unknown assets are filtered out before the timeline');
});

console.log(process.exitCode ? '\nReel lint tests failed.' : `\nAll ${passed} reel lint tests passed.`);
