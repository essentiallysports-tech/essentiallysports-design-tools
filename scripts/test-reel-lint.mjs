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

console.log(process.exitCode ? '\nReel lint tests failed.' : `\nAll ${passed} reel lint tests passed.`);
