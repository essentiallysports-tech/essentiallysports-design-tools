#!/usr/bin/env node
// Reels Studio director (netlify/functions/_reel-director.js): the brief read
// in code, validation of the model's beats (never trusted), the Haiku ->
// Sonnet escalation, the grounded draft when AI is off or fails, revise and
// the capped fact check. The Gateway is mocked; no network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.AI_GATEWAY_API_KEY = 'gw-test';
const gateway = require('../netlify/functions/_ai-gateway.js');
const D = require('../netlify/functions/_reel-director.js');
const F = require('../reel-formats.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
const real = { aiText: gateway.aiText, aiWebResearch: gateway.aiWebResearch, gatewayConfigured: gateway.gatewayConfigured };
function mockAi(replies) {
  const calls = [];
  gateway.aiText = async opts => {
    calls.push(opts);
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return { text: typeof next === 'string' ? next : JSON.stringify(next), model: opts.tier === 'best' ? 'anthropic/claude-sonnet-5.5' : 'anthropic/claude-haiku-5.5', cost: opts.tier === 'best' ? 0.02 : 0.002 };
  };
  return calls;
}
const BRIEF = 'Josh Allen threw for 5,477 yards in 2025, the most in Buffalo Bills history. Buffalo clinched the AFC East with a 31-28 win over the Chiefs. "We are not done," Allen said.';
const read = D.readReelBrief({ brief: BRIEF, format: 'stat' });

const GOOD = {
  format: 'stat', title: 'Allen breaks the Bills record', angle: 'A record year', team: 'Buffalo Bills',
  hooks: ['5,477 yards. Nobody in Buffalo did more.', 'Allen made 9,999 yards'],
  beats: [
    { kind: 'hook', text: '5,477 yards. A Bills record.', vo: 'Josh Allen threw for 5,477 yards, the most in Bills history.', emphasis: 'record', photo: 'Josh Allen' },
    { kind: 'stat', text: 'Most in team history', vo: 'No Bills quarterback has thrown for more.', stat: { value: '5,477', label: 'pass yds' }, photo: 'Josh Allen' },
    { kind: 'context', text: 'The East is theirs', vo: 'Buffalo clinched the AFC East with a 31-28 win over the Chiefs.', photo: 'Buffalo Bills' },
    { kind: 'quote', text: '“We are not done”', vo: 'And Allen made it clear what comes next.', quote: { text: 'We are not done', by: 'Josh Allen' } },
    { kind: 'payoff', text: 'January is the test', vo: 'Now the record means something only if it carries into January.' },
    { kind: 'cta', text: 'Is this his MVP year?', vo: 'Is this his MVP year? Tell us below.' },
  ],
};

await test('readReelBrief: corpus, sport and team from the brief; the router picks Stat', () => {
  assert.match(read.corpus, /5,477/);
  assert.equal(read.sport, 'nfl');
  assert.equal(read.team?.name, 'Buffalo Bills');
  assert.equal(read.team.colors.length, 2);
  assert.match(read.team.logo, /^https:\/\/a\.espncdn\.com\//);
  assert.equal(D.readReelBrief({ brief: 'Top 5 quarterbacks this season' }).format, 'top5');
  const fromTrend = D.readReelBrief({ trend: { title: 'Scottie Scheffler wins again', sport: 'golf', related: [{ title: 'Scheffler shoots 64' }] } });
  assert.equal(fromTrend.sport, 'golf');
  assert.match(fromTrend.corpus, /64/);
});

await test('validatePlan: keeps sourced beats, drops invented numbers and quotes, guarantees hook and end card', () => {
  const parsed = structuredClone(GOOD);
  parsed.beats.splice(4, 0, { kind: 'stat', text: '41 TDs', vo: 'He also threw 41 touchdowns.', stat: { value: '41', label: 'TD' } });
  parsed.beats.splice(2, 0, { kind: 'quote', text: 'Made up', vo: 'He said.', quote: { text: 'Best team ever assembled', by: 'Josh Allen' } });
  const out = D.validatePlan(parsed, { read, format: 'stat' });
  const kinds = out.plan.beats.map(b => b.kind);
  assert.equal(kinds[0], 'hook');
  assert.equal(kinds.at(-1), 'cta');
  assert.equal(out.dropped, 2);
  assert.ok(out.issues.some(i => /41/.test(i)), 'the invented 41 is reported');
  assert.ok(out.issues.some(i => /word for word/.test(i)), 'the invented quote is reported');
  assert.ok(!out.plan.beats.some(b => /41|Best team/.test(JSON.stringify(b))));
  assert.deepEqual(out.plan.hooks, ['5,477 yards. Nobody in Buffalo did more.'], 'an alt hook with an invented number is dropped');
  assert.equal(out.plan.team.name, 'Buffalo Bills');
  const src = F.numberSet(read.corpus);
  out.plan.beats.forEach(b => assert.deepEqual(F.unsourcedNumbers(b, src, out.plan.format), []));
});

await test('validatePlan: kinds coerced to the format; an end card is added; numbers never on it', () => {
  const out = D.validatePlan({ beats: [
    { kind: 'context', text: 'Allen made history', vo: 'Josh Allen made Bills history this year with his arm.' },
    { kind: 'rank', rank: 1, text: 'Allen', vo: 'He is number one.' },
    { kind: 'payoff', text: 'What it means', vo: 'It puts him in the MVP race for real now.' },
  ] }, { read, format: 'explainer' });
  assert.equal(out.plan.beats[0].kind, 'hook');
  assert.ok(!out.plan.beats.some(b => b.kind === 'rank'), 'no rank beats in an explainer');
  assert.equal(out.plan.beats.at(-1).kind, 'cta');
  const withNumberCta = D.validatePlan({ beats: [...GOOD.beats.slice(0, 5), { kind: 'cta', text: 'Can he hit 5,477 again?', vo: 'Can he do 5,477 again?' }] }, { read, format: 'stat' });
  assert.equal(F.numbersIn(withNumberCta.plan.beats.at(-1).text).length, 0);
});

await test('validatePlan: Top 5 needs five distinct ranks, ordered 5 -> 1', () => {
  const corpus = 'Power rankings: 1 Allen, 2 Mahomes, 3 Jackson, 4 Burrow, 5 Hurts.';
  const r = D.readReelBrief({ brief: corpus, format: 'top5' });
  const ranks = [3, 1, 5, 2, 4].map(rank => ({ kind: 'rank', rank, name: ['Allen', 'Mahomes', 'Jackson', 'Burrow', 'Hurts'][rank - 1], text: 'x', vo: `At number ${rank}, a quarterback who has carried his team all season long.` }));
  const ok = D.validatePlan({ format: 'top5', beats: [{ kind: 'hook', text: 'Top 5 QBs now', vo: 'The top 5 quarterbacks right now.' }, ...ranks, { kind: 'cta', text: 'Who is your number one?', vo: 'Who is yours?' }] }, { read: r, format: 'top5' });
  assert.deepEqual(ok.plan.beats.filter(b => b.kind === 'rank').map(b => b.rank), [5, 4, 3, 2, 1]);
  assert.equal(ok.weak, false);
  const short = D.validatePlan({ format: 'top5', beats: [{ kind: 'hook', text: 'Top 5', vo: 'Top 5.' }, ...ranks.slice(0, 3)] }, { read: r, format: 'top5' });
  assert.equal(short.weak, true);
});

await test('runReelDirector: Haiku first; a good plan does not escalate; usage is tracked as reels-director', async () => {
  const calls = mockAi([GOOD]);
  const out = await D.runReelDirector({ brief: BRIEF, format: 'stat', tier: 'standard', track: { email: 'a@essentiallysports.com', token: 't' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tier, 'main');
  assert.equal(calls[0].track.feature, 'reels-director');
  assert.equal(calls[0].cacheSystem, true);
  assert.match(calls[0].messages[0].content, /SOURCES/);
  assert.equal(out.source, 'director');
  assert.equal(out.escalated, false);
  assert.equal(out.plan.format, 'stat');
  assert.ok(Math.abs(out.cost - 0.002) < 1e-9);
});

await test('runReelDirector: a weak Haiku plan escalates to Sonnet (standard), never on economy', async () => {
  const weak = { format: 'stat', beats: [{ kind: 'hook', text: 'Allen', vo: 'Allen threw for 9,000 yards.' }] };
  let calls = mockAi([weak, GOOD]);
  let out = await D.runReelDirector({ brief: BRIEF, format: 'stat', tier: 'standard', track: { email: 'a@essentiallysports.com', token: 't' } });
  assert.deepEqual(calls.map(c => c.tier), ['main', 'best']);
  assert.equal(calls[1].track.feature, 'reels-director-sonnet');
  assert.equal(out.escalated, true);
  assert.equal(out.source, 'director-sonnet');
  assert.ok(Math.abs(out.cost - 0.022) < 1e-9);
  calls = mockAi([weak]);
  out = await D.runReelDirector({ brief: BRIEF, format: 'stat', tier: 'economy' });
  assert.equal(calls.length, 1);
  assert.equal(out.source, 'draft', 'a still-weak plan becomes the grounded draft');
});

await test('runReelDirector: AI off, budget or a failure -> grounded draft, never throws', async () => {
  gateway.gatewayConfigured = () => false;
  let out = await D.runReelDirector({ brief: BRIEF, format: 'stat' });
  assert.equal(out.source, 'draft');
  assert.equal(out.reason, 'off');
  assert.equal(out.plan.beats[0].kind, 'hook');
  gateway.gatewayConfigured = real.gatewayConfigured;
  mockAi([Object.assign(new Error('Spending limit reached'), { status: 402 })]);
  out = await D.runReelDirector({ brief: BRIEF });
  assert.equal(out.reason, 'budget');
  mockAi([new Error('timeout')]);
  out = await D.runReelDirector({ brief: BRIEF });
  assert.equal(out.source, 'draft');
  mockAi(['not json at all']);
  out = await D.runReelDirector({ brief: BRIEF, tier: 'economy' });
  assert.equal(out.source, 'draft');
});

await test('revisePlan: presets map to instructions; output goes through the same checks', async () => {
  const calls = mockAi([{ ...GOOD, beats: GOOD.beats.slice(0, 4).concat([GOOD.beats[5]]) }]);
  const out = await D.revisePlan({ plan: { ...GOOD, format: 'stat' }, instruction: 'shorter', corpus: read.corpus, track: { email: 'a@essentiallysports.com', token: 't' } });
  assert.match(calls[0].messages[0].content, /25% shorter/);
  assert.equal(calls[0].track.feature, 'reels-revise');
  assert.equal(out.plan.beats.length, 5);
  await assert.rejects(D.revisePlan({ plan: GOOD, instruction: '' }), /what to change/);
});

await test('factCheck: two searches, $0.03 cap, tracked as reels-factcheck', async () => {
  let seen = null;
  gateway.aiWebResearch = async opts => { seen = opts; return { text: 'Allen: 5,477 yards (nfl.com).', urls: [{ url: 'https://nfl.com/x', title: 'NFL' }], cost: 0.021, capped: false }; };
  const out = await D.factCheck({ topic: 'Josh Allen record season', sport: 'nfl', track: { email: 'a@essentiallysports.com', token: 't' } });
  assert.equal(seen.maxUses, 2);
  assert.equal(seen.maxCostUsd, 0.03);
  assert.equal(seen.track.feature, 'reels-factcheck');
  assert.match(out.text, /5,477/);
  assert.equal(out.urls.length, 1);
  assert.deepEqual(await D.factCheck({ topic: 'x' }), { text: '', urls: [], cost: 0 });
});

Object.assign(gateway, real);
console.log(process.exitCode ? '\nReel director tests failed.' : `\nAll ${passed} reel director tests passed.`);
