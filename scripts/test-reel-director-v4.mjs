#!/usr/bin/env node
// Reels v4 AI lane: the script-first director (_reel-director4.js), the
// critic, the "Need a script?" helper, the learning loop (_reel-lessons.js,
// reel-feedback.js) and the reel-maker modes (plan v4, critique, feedback,
// lessons). Owner rule under test everywhere: the voiceover IS the person's
// script, word for word; neither the director nor the critic rewrites it.
// The Gateway and every fetch are mocked; no network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.AI_GATEWAY_API_KEY = 'gw-test';
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const gateway = require('../netlify/functions/_ai-gateway.js');
const D = require('../netlify/functions/_reel-director.js');
const L = require('../netlify/functions/_reel-lessons.js');
const maker = require('../netlify/functions/reel-maker.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}
const real = { aiText: gateway.aiText, gatewayConfigured: gateway.gatewayConfigured, cronSpendGate: gateway.cronSpendGate };
function mockAi(replies) {
  const calls = [];
  gateway.aiText = async opts => {
    calls.push(opts);
    const next = typeof replies === 'function' ? replies(opts) : replies.shift();
    if (next instanceof Error) throw next;
    return { text: typeof next === 'string' ? next : JSON.stringify(next), model: opts.tier === 'best' ? 'anthropic/claude-sonnet-5.5' : 'anthropic/claude-haiku-5.5', cost: opts.tier === 'best' ? 0.03 : 0.002 };
  };
  return calls;
}
const restore = () => Object.assign(gateway, real);
const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const allVo = plan => plan.chapters.flatMap(c => c.beats).map(b => b.vo).join(' ');

// The person's script (Dallas, reference reel 2), written for the voice.
const SCRIPT = [
  'Dallas blew a 21-point lead to the Eagles, and everyone blamed the fourth down.',
  'But the fourth down is not what lost this game.',
  'Start with the run.',
  'The Cowboys ran it 35 times in the first half and just 8 times after it, while the Eagles kept coming.',
  'Then the throw.',
  'On fourth and one, Dak Prescott dropped back, held it, and got sacked for minus nine yards.',
  'Dallas went from a 47% chance to win to 57% for Philadelphia in one snap.',
  'And then the choice.',
  'Mike McCarthy kicked on 4th down with the lead instead of trusting his offense, and Jake Elliott hit a 59-yard field goal with two seconds left.',
  '"We had them," Prescott said after the game.',
  'So who do you blame, McCarthy or Prescott?',
].join(' ');
const TOPIC = 'Eagles beat Cowboys 24-21 after Dallas led 21-0. Jake Elliott 59-yard field goal, 0:02 left.';

// A drafted copy of QA's reference plans (scripts/fixtures/reels4/reference-plans.json
// is QA's; until it lands the director's tests use this). Words in it must
// never reach the prompt: structure only.
const REFERENCE = [
  { name: 'Dallas 21-point lead', esStyle: 'breakdown', chapters: [
    { headline: 'DALLAS BLEW A *21-POINT* LEAD', beats: [{ vo: 'SECRETWORD Dallas led.', media: { kind: 'clip' }, module: { type: 'scoreboard' }, tag: { text: '59-YD FG' } }] },
    { headline: 'THE *RUN*', beats: [{ vo: 'x', media: { kind: 'clip' }, module: { type: 'numberLine' }, stamp: { text: 'BAD CALL' } }, { vo: 'y', media: { kind: 'none' }, module: { type: 'compare' } }] },
  ], close: { kind: 'yourCall' } },
  { name: 'Ravens perfect cover', esStyle: 'hotseat', chapters: [
    { headline: 'X', beats: [{ vo: 'z', media: { kind: 'presser' }, stamp: { text: 'SPIKED' } }] },
    { headline: 'Y', beats: [{ vo: 'w', media: { kind: 'none' }, module: { type: 'timeline' } }] },
  ], close: { kind: 'yourCall' } },
];

// A good model reply: beats only point at segment starts; it even tries to
// smuggle in its own vo, which must be ignored.
const segs = D.segmentScript(SCRIPT);
const startOf = re => segs.findIndex(s => re.test(s));
function goodReply() {
  return {
    title: 'Dallas blew it', team: 'Dallas Cowboys',
    chapters: [
      { headline: 'DALLAS BLEW A *21-POINT* LEAD', tone: 'red', beats: [{ start: 0, vo: 'THE MODEL REWROTE THIS', media: { kind: 'clip', subject: { type: 'team', name: 'Dallas Cowboys' }, label: 'COWBOYS BALL' }, module: { type: 'scoreboard', rows: [{ team: 'Cowboys', value: '21' }, { team: 'Eagles', value: '0' }] }, tag: { text: '59-YD FG · 0:02 LEFT', tone: 'red' } }] },
      { label: 'THE RUN', headline: 'THE *RUN* DISAPPEARED', beats: [
        { start: startOf(/^But the fourth/), media: { kind: 'clip', subject: { type: 'team', name: 'Dallas Cowboys' } } },
        { start: startOf(/ran it 35/), media: { kind: 'none' }, module: { type: 'bars', title: 'RUNS', rows: [{ label: '1ST HALF', value: 35 }, { label: '2ND HALF', value: 8, tone: 'red' }] }, stamp: { text: 'NOT THE 4TH DOWN', tone: 'red' } },
      ] },
      { label: 'THE THROW', headline: 'THE *THROW*', beats: [
        { start: startOf(/^Then the throw/), media: { kind: 'clip', subject: { type: 'player', name: 'Dak Prescott', moment: 'the fourth-down sack' } }, module: { type: 'statTiles', tiles: [{ value: '-9', label: 'YARDS' }] }, stamp: { text: 'BAD CALL' } },
        { start: startOf(/47% chance/), media: { kind: 'none' }, module: { type: 'compare', from: { value: '47%', label: 'DALLAS' }, to: { value: '57%', label: 'PHILLY' } }, stamp: { text: 'SECOND STAMP' } },
      ] },
      { label: 'THE CHOICE', headline: 'THE *CHOICE*', beats: [
        { start: startOf(/^And then the choice/), media: { kind: 'presser', subject: { type: 'player', name: 'Mike McCarthy' } } },
        { start: startOf(/^"We had them/), media: { kind: 'clip', subject: { type: 'player', name: 'Jake Elliott' } }, module: { type: 'quote', text: 'We had them', who: 'Dak Prescott' } },
      ] },
    ],
    close: { prompt: 'COWBOYS FANS: YOUR CALL', options: [{ text: 'BLAME MCCARTHY' }, { text: 'BLAME DAK' }], comment: 'COMMENT: WHO LOST IT?' },
    scriptNotes: ['Consider naming the score in the hook.'],
  };
}
const read = D.readV4({ script: SCRIPT, topic: TOPIC });

await test('segmentScript: segments joined with spaces ARE the script; long sentences cut at a clause; tiny pieces ride along', () => {
  const messy = `  ${SCRIPT.replace(/ /g, '  \n')}  `;
  assert.equal(D.segmentScript(messy).join(' '), D.normScript(messy));
  assert.equal(segs.join(' '), SCRIPT);
  assert.ok(segs.every(s => s.split(' ').length <= 24), 'no segment runs over 24 words');
  const short = D.segmentScript('Wait. On fourth and one he got sacked for minus nine yards.');
  assert.equal(short.length, 1, '"Wait." rides with the next sentence');
  const many = D.segmentScript(Array.from({ length: 120 }, (_, i) => `Line ${i} is here now.`).join(' '));
  assert.ok(many.length <= 48);
  assert.equal(many.join(' '), Array.from({ length: 120 }, (_, i) => `Line ${i} is here now.`).join(' '));
});

await test('pacing: ~160 wpm against Full (80-100 s) and Short (30-45 s)', () => {
  const p = D.pacingOf(SCRIPT, 'short');
  assert.equal(p.wpm, 160);
  assert.equal(p.targetSec, 40);
  assert.deepEqual(p.range, [30, 45]);
  assert.equal(p.words, 130);
  assert.equal(p.estSec, 49);
  assert.equal(p.fit, 'long');
  assert.equal(D.pacingOf(SCRIPT, 'full').fit, 'short');
  assert.equal(D.pacingOf(`${SCRIPT} ${SCRIPT}`, 'full').fit, 'ok');
  assert.deepEqual(D.pacingOf('', 'full').wordsRange, [213, 267]);
});

await test('scriptToV4 ($0, code only): vo is the script word for word; chapters, markers, motion rule, a clip, the yourCall close', () => {
  for (const esStyle of D.V4_IDS) {
    for (const length of ['full', 'short']) {
      const plan = D.scriptToV4(SCRIPT, { esStyle, length, read });
      assert.equal(plan.v, 4);
      assert.equal(plan.esStyle, esStyle);
      assert.equal(plan.style, 'es');
      assert.equal(allVo(plan), SCRIPT, `${esStyle}/${length}: vo identical`);
      assert.ok(D.voMatchesScript(plan));
      assert.equal(plan.script.locked, true);
      assert.ok(plan.chapters.length >= 2 && plan.chapters.length <= D.LENGTHS[length].chapters[1] + 1);
      assert.equal(plan.chapters[0].marker, undefined, 'the hook chapter has no marker');
      plan.chapters.forEach(c => assert.equal((c.headline.match(/\*[^*]+\*/g) || []).length, 1, `one marked word: ${c.headline}`));
      plan.chapters.flatMap(c => c.beats).forEach(b => assert.ok((b.media && b.media.kind !== 'none') || b.module, `beat ${b.id} moves`));
      assert.ok(plan.chapters.flatMap(c => c.beats).some(b => ['clip', 'presser'].includes(b.media.kind)));
      assert.equal(plan.close.kind, 'yourCall');
      assert.equal(plan.close.options.length, 2);
      assert.deepEqual(plan.close.options.map(o => o.tone), ['red', 'blue']);
      assert.equal(plan.skin, esStyle === 'casefile' ? 'scrapbook' : 'clean');
    }
  }
  const cf = D.scriptToV4(SCRIPT, { esStyle: 'casefile', read });
  assert.equal(cf.chapters[1].marker.kind, 'countdown');
  assert.equal(cf.chapters[1].marker.n, cf.chapters.length - 1, 'counts down 3·2·1');
  const hs = D.scriptToV4(SCRIPT, { esStyle: 'hotseat', read });
  assert.equal(hs.chapters[1].marker.kind, 'progress');
  const bd = D.scriptToV4(SCRIPT, { esStyle: 'breakdown', read });
  assert.match(String(bd.chapters[1].marker), /^1/);
  // Numbers in code-built modules come from the script.
  const src = D.sourceNumbers(SCRIPT);
  bd.chapters.flatMap(c => c.beats).filter(b => b.module).forEach(b => D.moduleClaims(b.module).forEach(f => require('../reel-formats.js').numbersIn(f).forEach(n => assert.ok(src.has(n), `${n} sourced`))));
  assert.ok(bd.chapters.flatMap(c => c.beats).some(b => b.module && b.module.type === 'statTiles'), 'a sentence with numbers becomes stat tiles');
  assert.match(bd.close.comment, /WHO DO YOU BLAME/, 'a closing question becomes the comment prompt');
});

await test('legacy ids map to the new styles; spelled numbers count as sources', () => {
  assert.equal(D.v4StyleOf('gametape'), 'breakdown');
  assert.equal(D.v4StyleOf('hypecut'), 'breakdown');
  assert.equal(D.v4StyleOf('receipts', { beats: [{ block: { type: 'dotGrid' } }] }), 'outlier');
  assert.equal(D.v4StyleOf('statcard', { beats: [] }), 'breakdown');
  assert.equal(D.v4StyleOf('nonsense'), 'breakdown');
  assert.equal(D.v4StyleOf('casefile'), 'casefile');
  const set = D.sourceNumbers('They blew a twenty-one point lead and lost by three hundred.');
  assert.ok(set.has('21') && set.has('300'));
});

await test('validateV4: the model only picks starts; vo rebuilt from the script even when it sends its own; bad starts repaired', () => {
  const reply = goodReply();
  reply.chapters[1].beats.push({ start: 2, media: { kind: 'clip' } }); // overlaps the one before
  reply.chapters[3].beats.push({ start: 999 });                        // out of range
  reply.chapters[0].beats[0].start = 1;                                // must start at 0
  const out = D.validateV4(reply, { script: SCRIPT, read, esStyle: 'breakdown', length: 'full' });
  assert.equal(allVo(out.plan), SCRIPT);
  assert.ok(!JSON.stringify(out.plan).includes('THE MODEL REWROTE THIS'));
  assert.ok(out.dropped >= 2);
  assert.ok(out.issues.some(i => /overlapped/.test(i)));
  const ids = out.plan.chapters.flatMap(c => c.beats).map(b => b.id);
  assert.deepEqual(ids, ids.map((_, i) => `b${i + 1}`));
});

await test('validateV4: modules shaped and number-checked, quotes verbatim, one stamp per chapter, sourced close, subjects from sources', () => {
  const reply = goodReply();
  reply.chapters[1].beats[1].module.rows[1].value = 9; // 9 is not "8"... but "nine" is spoken in the script
  reply.chapters[2].beats[0].module = { type: 'statTiles', tiles: [{ value: '412', label: 'YARDS' }] }; // invented
  reply.chapters[3].beats[1].module = { type: 'quote', text: 'We gave it away', who: 'Dak Prescott' };   // not said
  reply.chapters[0].beats[0].media.subject = { type: 'player', name: 'Tom Brady' };                  // not in sources
  reply.close.options = [{ text: 'BLAME 99 PEOPLE' }, { text: 'BLAME DAK' }];
  const out = D.validateV4(reply, { script: SCRIPT, read, esStyle: 'breakdown' });
  const beats = out.plan.chapters.flatMap(c => c.beats);
  assert.ok(out.issues.some(i => /412/.test(i)), 'an invented number is reported');
  assert.ok(!JSON.stringify(out.plan).includes('412'));
  assert.ok(out.issues.some(i => /word for word/.test(i)));
  assert.ok(!beats.some(b => b.module && b.module.type === 'quote'));
  assert.ok(beats.some(b => b.module && b.module.type === 'bars'), 'nine (spoken) backs a 9 on screen');
  out.plan.chapters.forEach(c => assert.ok(c.beats.filter(b => b.stamp).length <= 1, 'one stamp per chapter'));
  assert.notEqual(beats[0].media.subject.name, 'Tom Brady');
  assert.equal(out.plan.close.options[0].text, 'AGREE', 'an unsourced number never reaches the close');
  assert.equal(out.plan.close.prompt, 'COWBOYS FANS: YOUR CALL');
  assert.equal(out.plan.team.name, 'Dallas Cowboys');
  assert.equal(allVo(out.plan), SCRIPT);
  assert.deepEqual(out.scriptNotes, ['Consider naming the score in the hook.']);
  assert.equal(out.weak, false);
});

await test('shapeModule: every contract module type is accepted with its data and rejected without it', () => {
  const good = {
    scoreboard: { rows: [{ team: 'A', value: '1' }, { team: 'B', value: '2' }] },
    bars: { rows: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }] },
    numberLine: { min: -10, max: 10, marks: [{ label: 'X', value: 5 }] },
    dotGrid: { total: 67, groups: [{ n: 26, label: 'A' }, { n: 50, label: 'over' }] },
    scatter: { points: 1000, highlight: { label: 'RAMS', x: 0.9, y: 0.2 }, diagonal: true, axes: { x: 'A', y: 'B' } },
    wl: { items: 'WWLx' },
    rankList: { title: 'T', rows: [{ rank: 1, label: 'A', value: '1' }, { rank: 2, label: 'B', value: '2' }] },
    statTiles: { tiles: [{ value: '82-38', label: 'SINCE' }] },
    reveal: { to: '35', label: 'RUNS' },
    compare: { from: { value: '47%' }, to: { value: '57%' } },
    tally: { n: 4, label: 'TDS' },
    calendar: { month: 'November', year: 1960 },
    timeline: { slots: [{ label: '2019', filled: true }, { label: '2020' }] },
    playDiagram: { offense: [[0.5, 0.6]], defense: [[0.5, 0.4]], route: [[0.5, 0.6], [0.7, 0.3]] },
    flow: { nodes: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], edges: [['a', 'b'], ['a', 'zz']] },
    checklist: { rows: [{ text: 'A', checked: true }, { text: 'B' }] },
    quote: { text: 'We had them', who: 'Dak' },
    lineChart: { points: [[1, 90], [2, 70]], label: 'ODDS' },
  };
  assert.deepEqual(Object.keys(good).sort(), [...D.MODULE_TYPES].sort());
  for (const [type, data] of Object.entries(good)) {
    const m = D.shapeModule({ type, ...data });
    assert.ok(m && m.type === type, `${type} kept`);
    assert.equal(D.shapeModule({ type }), null, `${type} without data dropped`);
  }
  assert.equal(D.shapeModule({ type: 'dotGrid', ...good.dotGrid }).groups.length, 1, 'groups never exceed the total');
  assert.equal(D.shapeModule({ type: 'wl', items: 'WWLx' }).items, 'WWL');
  assert.deepEqual(D.shapeModule({ type: 'flow', ...good.flow }).edges, [['a', 'b']]);
  assert.equal(D.shapeModule({ type: 'nope' }), null);
});

await test('reference reels: QA plans reach the prompt as structure only (no words); built-in shapes until the file lands', () => {
  D.setReferencePlans([]);
  const builtin = D.v4System();
  assert.match(builtin, /REFERENCE SHAPES/);
  assert.ok(D.referenceShapes().length === 6, 'six built-in shapes');
  D.setReferencePlans(REFERENCE);
  const sys = D.v4System();
  assert.match(sys, /breakdown: ch0\[clip\+scoreboard\+tag\] ch1\[clip\+numberLine\+stamp, none\+compare\]/);
  assert.match(sys, /hotseat: ch0\[presser\+stamp\]/);
  for (const word of ['SECRETWORD', 'Dallas led', 'Dallas 21-point lead', 'Ravens perfect cover', 'SPIKED']) assert.ok(!sys.includes(word), `${word} never reaches the prompt`);
  assert.match(sys, /never write, rewrite, shorten or reorder the script/);
});

await test('runDirectorV4: one Haiku call, lessons in the prompt, vo identical, cost and feature logged', async () => {
  const calls = mockAi([goodReply()]);
  const lessons = [{ style: 'breakdown', lesson: 'Editors swap photo beats to clips when the words name a play.', evidence: 14 }];
  const out = await D.runDirectorV4({ script: SCRIPT, topic: TOPIC, esStyle: 'breakdown', length: 'short', lessons, track: { email: 'e@x.com', token: 't' } });
  restore();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tier, 'main');
  assert.equal(calls[0].cacheSystem, true);
  assert.equal(calls[0].track.feature, 'reels-director');
  assert.match(calls[0].messages[0].content, /HOUSE LESSONS[\s\S]*swap photo beats to clips/);
  assert.match(calls[0].messages[0].content, /s0: Dallas blew a 21-point lead/);
  assert.match(calls[0].messages[0].content, /Eagles beat Cowboys 24-21/, 'the topic rides as a source');
  assert.equal(out.source, 'director');
  assert.equal(out.cost, 0.002);
  assert.equal(allVo(out.plan), SCRIPT);
  assert.equal(out.escalated, false);
});

await test('runDirectorV4: a weak Haiku plan escalates to Sonnet; economy never does; AI off / errors fall back to code ($0)', async () => {
  let calls = mockAi([{ chapters: [{ headline: 'X', beats: [{ start: 0 }] }] }, goodReply()]);
  let out = await D.runDirectorV4({ script: SCRIPT, esStyle: 'breakdown', tier: 'standard' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].tier, 'best');
  assert.equal(calls[1].track, undefined);
  assert.equal(out.escalated, true);
  assert.equal(out.source, 'director-sonnet');
  assert.equal(allVo(out.plan), SCRIPT);
  calls = mockAi([{ chapters: [{ headline: 'X', beats: [{ start: 0 }] }] }]);
  out = await D.runDirectorV4({ script: SCRIPT, tier: 'economy' });
  assert.equal(calls.length, 1);
  assert.equal(allVo(out.plan), SCRIPT);
  mockAi([new Error('boom')]);
  out = await D.runDirectorV4({ script: SCRIPT });
  assert.equal(out.source, 'code');
  assert.equal(out.reason, 'error');
  assert.equal(allVo(out.plan), SCRIPT);
  gateway.gatewayConfigured = () => false;
  calls = mockAi([]);
  out = await D.runDirectorV4({ script: SCRIPT });
  assert.equal(calls.length, 0);
  assert.equal(out.reason, 'off');
  assert.equal(out.cost, 0);
  assert.equal(allVo(out.plan), SCRIPT);
  restore();
});

await test('reviseV4: a note re-plans the visuals; the vo stays the script', async () => {
  const plan = D.validateV4(goodReply(), { script: SCRIPT, read, esStyle: 'breakdown' }).plan;
  const calls = mockAi([goodReply()]);
  const out = await D.reviseV4({ plan, instruction: 'punchier', corpus: TOPIC });
  restore();
  assert.match(calls[0].messages[0].content, /EDITOR NOTE: Make every headline, stamp and tag punchier/);
  assert.match(calls[0].messages[0].content, /CURRENT PLAN/);
  assert.equal(calls[0].tier, 'main');
  assert.equal(allVo(out.plan), SCRIPT);
});

await test('critiqueV4: scores, safe fixes applied, unsafe ones become suggestions, never the vo; script notes only noted', async () => {
  const plan = D.validateV4(goodReply(), { script: SCRIPT, read, esStyle: 'breakdown' }).plan;
  const before = JSON.stringify(plan);
  const calls = mockAi([{
    scores: { hook: 4, oneIdea: 4, mediaWords: 3, moduleClaim: 4, pacing: 4, close: 4 },
    fixes: [
      { op: 'headline', chapter: 'c2', value: 'THE RUN *VANISHED*', why: 'sharper' },
      { op: 'stamp', beat: 'b1', value: { text: 'BLOWN', tone: 'red' } },
      { op: 'headline', chapter: 'c3', value: 'A *412-YARD* MESS' },  // invented number
      { op: 'mediaSubject', beat: 'b2', value: 'Tom Brady' },        // not in the script
      { op: 'vo', beat: 'b1', value: 'A new voiceover line' },       // never allowed
      { op: 'closeOptions', value: ['FIRE MCCARTHY', 'BENCH DAK'] },
    ],
    scriptNotes: ['The hook could say the final score.'],
  }]);
  const out = await D.critiqueV4({ plan, corpus: TOPIC, aiAllowed: true, track: { email: 'e@x.com', token: 't' } });
  restore();
  assert.equal(JSON.stringify(plan), before, 'the input plan is not mutated');
  assert.equal(calls[0].track.feature, 'reels-critique');
  assert.equal(calls[0].tier, 'main');
  assert.deepEqual(out.applied.map(f => f.op), ['headline', 'stamp', 'closeOptions']);
  assert.deepEqual(out.suggestions.map(f => f.op), ['headline', 'mediaSubject', 'vo']);
  assert.equal(out.plan.chapters[1].headline, 'THE RUN *VANISHED*');
  assert.equal(out.plan.chapters[0].beats[0].stamp.text, 'BLOWN');
  assert.deepEqual(out.plan.close.options.map(o => o.text), ['FIRE MCCARTHY', 'BENCH DAK']);
  assert.equal(allVo(out.plan), SCRIPT, 'the critic never rewrites the vo');
  assert.deepEqual(out.scriptNotes, ['The hook could say the final score.']);
  assert.equal(out.aiChecked, true);
  assert.equal(out.pass, true);
  assert.equal(out.cost, 0.002);
  // Same reel again: cached, $0.
  const again = mockAi([]);
  const cached = await D.critiqueV4({ plan, corpus: TOPIC, aiAllowed: true });
  restore();
  assert.equal(again.length, 0);
  assert.equal(cached.cached, true);
  assert.equal(cached.cost, 0);
});

await test('critiqueV4: low scores fail Ready to post; AI paused = code checks only ($0); a static beat is a blocker', async () => {
  const plan = D.validateV4(goodReply(), { script: SCRIPT, read, esStyle: 'breakdown' }).plan;
  plan.chapters[0].headline = 'DALLAS *LOST*';
  mockAi([{ scores: { hook: 2, oneIdea: 4, mediaWords: 4, moduleClaim: 4, pacing: 4, close: 4 }, fixes: [] }]);
  const low = await D.critiqueV4({ plan, aiAllowed: true });
  restore();
  assert.equal(low.pass, false);
  const calls = mockAi([]);
  const free = await D.critiqueV4({ plan, aiAllowed: false });
  restore();
  assert.equal(calls.length, 0);
  assert.equal(free.aiChecked, false);
  assert.equal(free.cost, 0);
  assert.equal(free.pass, true);
  const stat = structuredClone(plan);
  stat.chapters[1].beats[0].media = { kind: 'none' };
  delete stat.chapters[1].beats[0].module;
  const blocked = await D.critiqueV4({ plan: stat, aiAllowed: false });
  assert.equal(blocked.pass, false);
  assert.ok(blocked.issues.some(i => i.key === 'motion' && i.blocker));
  const edited = structuredClone(plan);
  edited.chapters[0].beats[0].vo = 'Someone changed the words.';
  assert.ok((await D.critiqueV4({ plan: edited, aiAllowed: false })).issues.some(i => i.key === 'script' && i.blocker));
});

await test('draftScript ("Need a script?"): one Haiku call; lines with unsourced numbers are left out', async () => {
  const calls = mockAi([{ script: 'Dallas led 21-0 at the half. Then they gave up 412 yards. Who do you blame?' }]);
  const out = await D.draftScript({ topic: TOPIC, length: 'short', track: { email: 'e@x.com', token: 't' } });
  restore();
  assert.equal(calls[0].track.feature, 'reels-script-draft');
  assert.equal(out.script, 'Dallas led 21-0 at the half. Who do you blame?');
  assert.ok(out.issues.some(i => /412/.test(i)));
});

// ─── The code path ($0) on real scripts (integration review, 2026-11-27) ──
const RODGERS = "Aaron Rodgers' 2011 season still has no twin: 45 touchdowns, 6 interceptions, a 122.5 passer rating and a 15-1 record. Source: Pro Football Reference";
const CODE_SCRIPTS = {
  rodgers: RODGERS,
  golf: 'Scottie Scheffler wins the Masters by 4 strokes for his 3rd major title, shooting 11 under par on Sunday. Only the 4th player to win 3 majors before turning 30 since 1980.\nSport: Golf',
  f1: 'Max Verstappen takes pole in Brazil after starting the weekend 17th in practice. McLaren had been fastest in every session. He beat Lando Norris by 0.084 seconds.',
  rumour: "Rumour: Real Madrid are preparing a January bid for Liverpool's Ibrahima Konaté, whose contract runs out in June. Three clubs have asked about him. Liverpool have offered a new deal twice and he has not signed. Sources: The Athletic, Marca (unconfirmed).",
  presser: "Press conference: Jets head coach asked three times whether he will call plays after a 2-8 start. He said 'we'll evaluate everything' each time. The Jets have scored under 20 points in 7 of 10 games. Owner meets with the GM on Tuesday.",
  wemby: 'Victor Wembanyama has 5+ blocks in 9 straight games, the longest streak since 1985-86. The Spurs are 7-2 in those games. No other player has more than 4 such games this season.',
  clark: 'Caitlin Clark set the WNBA single-season assist record with 337 assists, passing the old mark of 316. She did it in 40 games. The Fever went from 13 wins to 20.',
  dallas: "Dallas was up 21. They lost on a 59-yard field goal with two seconds left. Everyone blames the fourth down. It wasn't the fourth down. Chapter one: the run. Dallas stopped running with the lead. Their pass rate went from 47 to 57 percent. Chapter two: the throw. Fourth and one, they dropped back, sacked for minus nine. Chapter three: the choice. Backing off is a choice. Cowboys fans, your call.",
  liberty: 'Three reasons the Liberty win it all again. Number three: the bench, best net rating in the league. Number two: Sabrina Ionescu in the fourth quarter. Number one: Breanna Stewart. Check, check, check. Liberty fans, your call.',
};
const ESR = require('../reel-es.js');
const lastWord = h => String(h).replace(/\*/g, '').trim().split(/\s+/).pop().toLowerCase().replace(/[^a-z0-9%'-]/g, '');
const BAD_END = new Set([...ESR.DANGLE, 'he', 'she', 'they', 'whether', 'no', 'not']);
const tilesOf = plan => plan.chapters.flatMap(c => c.beats).filter(b => b.module && b.module.type === 'statTiles').flatMap(b => b.module.tiles);

await test('code path: the Rodgers script -> hook + payoff + close; whole-phrase headline; credit is the source line; noun-phrase tiles, no year', () => {
  const plan = D.scriptToV4(RODGERS, { esStyle: 'breakdown', length: 'short' });
  const spoken = "Aaron Rodgers' 2011 season still has no twin: 45 touchdowns, 6 interceptions, a 122.5 passer rating and a 15-1 record.";
  assert.equal(allVo(plan), spoken, 'vo identical to the spoken script');
  assert.equal(plan.script.text, spoken);
  assert.deepEqual(plan.script.credits, ['Pro Football Reference']);
  assert.equal(plan.sourceLine, 'SOURCE: PRO FOOTBALL REFERENCE');
  assert.equal(plan.chapters.length, 2, 'hook chapter + payoff chapter');
  assert.equal(plan.chapters[0].headline, "AARON RODGERS' 2011 SEASON STILL HAS NO *TWIN*");
  assert.ok(!plan.chapters.some(c => /SOURCE|REFERENCE/.test(c.headline)));
  assert.deepEqual(tilesOf(plan).map(t => `${t.value} ${t.label}`), ['45 TOUCHDOWNS', '122.5 PASSER RATING', '15-1 RECORD']);
  assert.equal(plan.chapters[0].beats[0].media.kind, 'clip');
  assert.equal(plan.chapters[0].beats[0].media.subject.name, 'Aaron Rodgers');
  assert.deepEqual(plan.close.options.map(o => o.text), ['STILL HAS NO TWIN', 'NOT BUYING IT']);
  assert.equal(plan.close.prompt, 'YOUR CALL');
  // Spoken on request: the credit stays in the vo, never a headline or a beat of its own.
  const spokenToo = D.scriptToV4(RODGERS, { length: 'short', speakSources: true });
  assert.equal(allVo(spokenToo), RODGERS);
  assert.ok(!spokenToo.chapters.some(c => /SOURCE|REFERENCE/.test(c.headline)));
  assert.ok(!spokenToo.chapters.flatMap(c => c.beats).some(b => /^Source:/.test(b.vo)));
});

await test('splitCredits: "Source(s):", "Via", URLs and metadata lines are not spoken', () => {
  assert.deepEqual(D.splitCredits('Big night for Lamar. Via ESPN Stats & Info.\nhttps://x.com/a/1'), { spoken: 'Big night for Lamar.', credits: ['ESPN Stats & Info'], links: ['https://x.com/a/1'] });
  assert.equal(D.splitCredits('He signed. Sources: The Athletic, Marca.\nSport: Soccer').spoken, 'He signed.');
  assert.equal(D.splitCredits('Via a trade, the Jets got him.').spoken, 'Via a trade, the Jets got him.', 'a sentence starting "Via a trade," is speech');
});

await test('code path on real scripts: no dangling headline end, no credit chapter, no year tiles, noun-phrase labels, motion, vo identical', () => {
  for (const [id, script] of Object.entries(CODE_SCRIPTS)) {
    for (const esStyle of D.V4_IDS) {
      const plan = D.scriptToV4(script, { esStyle, length: id === 'rodgers' || id === 'f1' ? 'short' : 'full' });
      const where = `${id}/${esStyle}`;
      assert.equal(allVo(plan), D.splitCredits(script).spoken, `${where}: vo identical`);
      plan.chapters.forEach(c => {
        assert.ok(!BAD_END.has(lastWord(c.headline)), `${where}: "${c.headline}" ends on a lead-in word`);
        assert.ok(!/^\s*(?:SOURCES?|VIA|CREDIT)/.test(c.headline.replace(/\*/g, '')), `${where}: a credit headline`);
        assert.equal((c.headline.match(/\*[^*]+\*/g) || []).length, 1, `${where}: one marked word in ${c.headline}`);
        assert.ok(c.headline.replace(/\*/g, '').length <= 60, `${where}: ${c.headline} fits`);
      });
      plan.chapters.flatMap(c => c.beats).forEach(b => {
        assert.ok((b.media && b.media.kind !== 'none') || b.module, `${where}: ${b.id} moves`);
        assert.ok(!/^(?:Sources?|Via)\b/.test(b.vo), `${where}: a credit beat`);
      });
      tilesOf(plan).forEach(t => {
        assert.ok(!/^(?:19|20)\d\d(?:-\d\d)?$/.test(t.value), `${where}: year tile ${t.value}`);
        const lw = t.label.toLowerCase().split(/\s+/);
        assert.ok(t.label && !BAD_END.has(lw[lw.length - 1]), `${where}: label "${t.label}"`);
        assert.ok(!lw.some(x => /^(?:still|season|he|she|they|whether|total|chapter|number)$/.test(x)), `${where}: label "${t.label}" is not a noun phrase`);
      });
      assert.equal(plan.close.kind, 'yourCall');
      assert.equal(plan.close.options.length, 2);
    }
  }
});

await test('code path: chapter cues, fans prompt, change modules, framing labels', () => {
  const dallas = D.scriptToV4(CODE_SCRIPTS.dallas, { esStyle: 'breakdown' });
  assert.deepEqual(dallas.chapters.slice(1).map(c => c.marker), ['1 · THE RUN', '2 · THE THROW', '3 · THE CHOICE']);
  assert.equal(dallas.close.prompt, 'COWBOYS FANS: YOUR CALL');
  const cmp = dallas.chapters[1].beats.find(b => b.module && b.module.type === 'compare');
  assert.deepEqual(cmp.module.from, { value: '47%', label: 'PASS RATE' });
  assert.equal(cmp.module.to.value, '57%');
  const liberty = D.scriptToV4(CODE_SCRIPTS.liberty, { esStyle: 'casefile' });
  assert.deepEqual(liberty.chapters.slice(1).map(c => c.marker.n), [3, 2, 1]);
  assert.equal(liberty.close.prompt, 'LIBERTY FANS: YOUR CALL');
  const clark = D.scriptToV4(CODE_SCRIPTS.clark, { length: 'short' });
  const c2 = clark.chapters.flatMap(c => c.beats).find(b => b.module && b.module.type === 'compare').module;
  assert.deepEqual([c2.from.value, c2.to.value, c2.to.label], ['13', '20', 'WINS']);
  const presser = D.scriptToV4(CODE_SCRIPTS.presser, { esStyle: 'hotseat' });
  assert.equal(presser.chapters[0].beats[0].media.kind, 'presser');
  assert.deepEqual(presser.chapters[0].beats[0].tag, { text: 'PRESS CONFERENCE', tone: 'ink' });
  assert.ok(!/PRESS CONFERENCE/.test(presser.chapters[0].headline));
  const rumour = D.scriptToV4(CODE_SCRIPTS.rumour, { esStyle: 'casefile' });
  assert.equal(rumour.chapters[0].beats[0].tag.tone, 'red');
  assert.match(rumour.sourceLine, /THE ATHLETIC/);
  const wemby = D.figuresOf(CODE_SCRIPTS.wemby);
  assert.ok(!wemby.some(f => /1985/.test(f.value)));
  assert.deepEqual(wemby.map(f => `${f.value} ${f.label}`).slice(0, 2), ['5+ BLOCKS', '9 GAMES']);
  assert.deepEqual(D.figuresOf('Their win probability was 97%.').map(f => f.label), ['WIN PROBABILITY']);
  assert.deepEqual(D.figuresOf('He lost 7-6, 3-6, 7-6 after the quote ended."').map(f => f.label), [], 'no label across a clause end');
});

// ─── Learning loop ───────────────────────────────────────────────────────
function feedbackRows(n, style = 'breakdown') {
  return Array.from({ length: n }, (_, i) => ({
    event: ['swap_media', 'change_module', 'edit_text', 'export'][i % 4], style, reel_id: `r${i % 5}`,
    field: i % 4 === 2 ? 'headline' : null,
    before: i % 4 === 0 ? { kind: 'photo', reason: 'wrong player' } : i % 4 === 1 ? { type: 'statTiles' } : i % 4 === 2 ? 'DALLAS *LOST*' : null,
    after: i % 4 === 0 ? { kind: 'clip' } : i % 4 === 1 ? { type: 'bars' } : i % 4 === 2 ? 'DALLAS *BLEW IT*' : null,
  }));
}

await test('cleanFeedback / summarize: only known events; small JSON; counts and before -> after pairs per style ($0)', () => {
  assert.equal(L.cleanFeedback({ event: 'hack' }), null);
  const row = L.cleanFeedback({ event: 'swap_media', reelId: 'abc-123', beatId: 'b2<script>', style: 'nope', before: { kind: 'photo', big: 'x'.repeat(5000) }, after: { kind: 'clip' } });
  assert.equal(row.beat_id, 'b2script');
  assert.equal(row.style, null);
  assert.equal(row.before.truncated, true);
  const sum = L.summarize(feedbackRows(20));
  assert.equal(sum.breakdown.reels, 5);
  assert.match(sum.breakdown.mediaSwaps[0], /photo -> clip \(wrong player\) x5/);
  assert.match(sum.breakdown.moduleSwaps[0], /statTiles -> bars x5/);
  assert.match(sum.breakdown.samples[0], /DALLAS \*LOST\*" -> "DALLAS \*BLEW IT\*/);
  assert.equal(sum.breakdown.exported, 5);
});

function tableFetch(state) {
  return async (url, opts = {}) => {
    const u = String(url);
    state.seen.push({ u, method: opts.method || 'GET', body: opts.body });
    if (u.includes('/frameup_reel_feedback')) {
      if (opts.method === 'POST') return state.table ? new Response('', { status: 201 }) : jsonResponse(404, { code: 'PGRST205' });
      return state.table ? jsonResponse(200, state.rows) : jsonResponse(404, { code: 'PGRST205' });
    }
    if (u.includes('/frameup_reel_lessons')) {
      if (opts.method === 'POST') { state.lessons = JSON.parse(opts.body); return new Response('', { status: 201 }); }
      if (opts.method === 'DELETE') return new Response('', { status: 204 });
      if (u.includes('select=source_hash')) return jsonResponse(200, state.lastHash ? [{ source_hash: state.lastHash }] : []);
      return jsonResponse(200, state.read || []);
    }
    if (u.includes('/frameup_ai_usage')) { state.usage.push(JSON.parse(opts.body)); return new Response('', { status: 201 }); }
    throw new Error(`unexpected fetch ${u}`);
  };
}

await test('runLessonsJob: too little feedback or an unchanged summary costs $0; otherwise one Haiku call writes the lessons', async () => {
  const state = { seen: [], usage: [], table: true, rows: feedbackRows(8) };
  const fetchImpl = tableFetch(state);
  let calls = mockAi([]);
  let out = await L.runLessonsJob({ token: 'admin', fetchImpl });
  assert.equal(out.skipped, 'not-enough-feedback');
  state.rows = feedbackRows(40);
  state.lastHash = L.hashOf(L.summarize(state.rows));
  out = await L.runLessonsJob({ token: 'admin', fetchImpl });
  assert.equal(out.skipped, 'unchanged');
  assert.equal(calls.length, 0);
  state.lastHash = 'old';
  calls = mockAi([{ lessons: [
    { style: 'breakdown', lesson: 'Use a clip, not a photo, when the words name a play.', evidence: 10 },
    { style: 'breakdown', lesson: 'Prefer bars over stat tiles for a before/after split.', evidence: 999 },
    { style: 'nope', lesson: 'Keep headlines to five words with one coloured word.', evidence: 3 },
    { style: 'all', lesson: 'x' },
  ] }]);
  out = await L.runLessonsJob({ token: 'admin', track: { email: 'a@x.com', token: 'admin' }, fetchImpl });
  restore();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tier, 'main');
  assert.equal(calls[0].track.feature, 'reels-lessons');
  assert.ok(!calls[0].messages[0].content.includes('@'), 'no emails in the prompt');
  assert.equal(out.lessons, 3);
  assert.equal(out.cost, 0.002);
  assert.equal(state.lessons[1].evidence, 40, 'evidence capped at the events seen');
  assert.equal(state.lessons[2].style, 'all');
  assert.ok(state.seen.some(x => x.method === 'DELETE' && /created_at=lt\./.test(x.u)), 'older lessons replaced');
  state.table = false;
  out = await L.runLessonsJob({ token: 'admin', fetchImpl });
  assert.equal(out.reason, 'not-installed');
});

await test('runLessonsJob (cron): service role, the team cap gate, and its cost logged to frameup_ai_usage', async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  const state = { seen: [], usage: [], table: true, rows: feedbackRows(30, 'outlier') };
  gateway.cronSpendGate = async () => ({ reason: 'team-limit' });
  let out = await L.runLessonsJob({ service: true, fetchImpl: tableFetch(state) });
  assert.equal(out.skipped, 'team-limit');
  gateway.cronSpendGate = async () => null;
  mockAi([{ lessons: [{ style: 'outlier', lesson: 'Lead with the dot grid; editors move it first.', evidence: 9 }] }]);
  out = await L.runLessonsJob({ service: true, fetchImpl: tableFetch(state) });
  restore();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal(out.lessons, 1);
  assert.equal(state.usage[0].feature, 'reels-lessons');
  assert.equal(state.usage[0].user_email, L.CRON_EMAIL);
  assert.equal(state.usage[0].cost_usd, 0.002);
});

await test('loadLessons: style lessons first, cached an hour; topLessons caps at 6; failures give []', async () => {
  L.CACHE.clear();
  const state = { seen: [], usage: [], read: [
    { style: 'all', lesson: 'House rule one is here.', evidence: 50 },
    { style: 'hotseat', lesson: 'Open on the press conference.', evidence: 5 },
  ] };
  const first = await L.loadLessons({ style: 'hotseat', token: 't', fetchImpl: tableFetch(state) });
  assert.deepEqual(first.map(l => l.style), ['hotseat', 'all']);
  await L.loadLessons({ style: 'hotseat', token: 't', fetchImpl: tableFetch(state) });
  assert.equal(state.seen.length, 1, 'cached');
  L.CACHE.clear();
  assert.deepEqual(await L.loadLessons({ style: 'outlier', token: 't', fetchImpl: async () => { throw new Error('down'); } }), []);
  assert.equal(L.topLessons(Array.from({ length: 9 }, (_, i) => ({ style: 'all', lesson: `l${i}`, evidence: i })), 'breakdown').length, 6);
  L.CACHE.clear();
});

await test('saveFeedback: up to 20 rows with the person\'s email; before the migration { cloud: false }', async () => {
  const state = { seen: [], usage: [], table: true };
  const auth = { user: { email: 'editor@essentiallysports.com' } };
  const evts = Array.from({ length: 25 }, () => ({ event: 'edit_text', reelId: 'r1', field: 'headline', before: 'A', after: 'B' }));
  let out = await L.saveFeedback([...evts, { event: 'bogus' }], { auth, token: 't', fetchImpl: tableFetch(state) });
  assert.equal(out.saved, 20);
  const body = JSON.parse(state.seen[0].body);
  assert.equal(body.length, 20);
  assert.equal(body[0].user_email, 'editor@essentiallysports.com');
  state.table = false;
  out = await L.saveFeedback(evts.slice(0, 1), { auth, token: 't', fetchImpl: tableFetch(state) });
  assert.deepEqual(out, { ok: true, cloud: false, saved: 0 });
  assert.equal((await L.saveFeedback([{ event: 'bogus' }], { auth, token: 't' })).status, 400);
});

await test('reel-feedback.js: log() never throws, batches up to 20, sends mode feedback, drops unknown events', async () => {
  const sent = [];
  const fakeWin = { ESAuth: { fetchWithAuth: async (url, init) => { sent.push({ url, body: JSON.parse(init.body), keepalive: init.keepalive }); return { ok: true }; } } };
  const prev = globalThis.ESAuth;
  globalThis.ESAuth = fakeWin.ESAuth;
  const RF = require('../reel-feedback.js');
  assert.equal(RF.log({ event: 'nope' }), false);
  assert.equal(RF.log(null), false);
  for (let i = 0; i < 21; i += 1) assert.equal(RF.log({ event: 'swap_media', reelId: 'r', beatId: `b${i}`, before: { kind: 'photo' }, after: { kind: 'clip' } }), true);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/reel-maker');
  assert.equal(sent[0].body.mode, 'feedback');
  assert.equal(sent[0].body.events.length, 20);
  await RF.flush({ keepalive: true });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].keepalive, true);
  globalThis.ESAuth = prev;
});

await test('Gateway: the new Reels features have readable names (caps untouched)', () => {
  assert.match(gateway.featureOffMessage('reels-critique'), /^The Reels critic is switched off/);
  assert.match(gateway.featureOffMessage('reels-director-sonnet'), /^The Reels director is switched off/);
  assert.match(gateway.featureOffMessage('reels-lessons'), /^Reels house lessons/);
  assert.match(gateway.featureOffMessage('reels-script-draft'), /^The Reels script helper/);
  assert.equal(gateway.POLICY.userWeeklyUsd, 20);
  assert.equal(gateway.POLICY.teamWeeklyUsd, 45);
  // The daily lessons job rides the ai-budget-watch cron (the project keeps to two crons).
  const fs = require('node:fs');
  assert.match(fs.readFileSync('netlify/functions/ai-budget-watch.js', 'utf8'), /require\('\.\/_reel-lessons\.js'\)\.runLessonsJob\(\{ service: true \}\)/);
  assert.ok(JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons.length <= 2);
});

// ─── reel-maker modes ────────────────────────────────────────────────────
const T = maker._test;
const noLessons = { loadLessons: async () => [] };
const track = { email: 'e@x.com', token: 't' };

await test('plan v4: needs a script; free mode lays it out by code ($0) with the vo identical; links ride as sources', async () => {
  const none = await T.planV4({ v: 4, topic: TOPIC }, track, {}, noLessons);
  assert.equal(none.reason, 'need-script');
  assert.equal(none.status, 400);
  const calls = mockAi([]);
  const out = await T.planV4({ v: 4, script: SCRIPT, topic: TOPIC, esStyle: 'gametape', length: 'short', links: ['https://www.espn.com/nfl/story', 'javascript:alert(1)'] }, track, { free: true }, noLessons);
  restore();
  assert.equal(calls.length, 0);
  assert.equal(out.ok, true);
  assert.equal(out.v, 4);
  assert.equal(out.source, 'code');
  assert.equal(out.cost, 0);
  assert.equal(out.esStyle, 'breakdown', 'a legacy id opens in the closest new style');
  assert.equal(out.voMatchesScript, true);
  assert.equal(allVo(out.plan), SCRIPT);
  assert.deepEqual(out.sources.filter(s => s.type === 'link').map(s => s.url), ['https://www.espn.com/nfl/story']);
  assert.equal(out.sources[0].type, 'script');
  assert.equal(out.pacing.targetSec, 40);
  assert.equal((await T.planV4({ v: 4, script: 'word '.repeat(800) }, track, {}, noLessons)).reason, 'too-long');
});

await test('plan v4: the director with the house lessons, cached; Haiku cost reported', async () => {
  maker._test.PLAN_CACHE.clear();
  const calls = mockAi([goodReply()]);
  const lessons = { loadLessons: async ({ style }) => [{ style, lesson: 'Hotseat reels open on the presser.', evidence: 7 }] };
  const out = await T.planV4({ v: 4, script: SCRIPT, topic: TOPIC, esStyle: 'hotseat' }, track, {}, lessons);
  const again = await T.planV4({ v: 4, script: SCRIPT, topic: TOPIC, esStyle: 'hotseat' }, track, {}, lessons);
  restore();
  assert.equal(calls.length, 1);
  assert.match(calls[0].messages[0].content, /Hotseat reels open on the presser/);
  assert.equal(out.source, 'director');
  assert.equal(out.lessons, 1);
  assert.equal(out.cost, 0.002);
  assert.equal(allVo(out.plan), SCRIPT);
  assert.equal(again.cached, true);
  assert.equal(again.cost, 0);
});

await test('revise v4 and critique modes through reel-maker keep the vo; lessons mode is admins only', async () => {
  const plan = D.validateV4(goodReply(), { script: SCRIPT, read, esStyle: 'breakdown' }).plan;
  mockAi([goodReply()]);
  const rev = await T.reviseV4({ plan, instruction: 'visual', corpus: TOPIC }, track, noLessons);
  assert.equal(rev.ok, true);
  assert.equal(allVo(rev.plan), SCRIPT);
  mockAi([{ scores: { hook: 4, oneIdea: 4, mediaWords: 4, moduleClaim: 4, pacing: 4, close: 4 }, fixes: [{ op: 'headline', chapter: 'c1', value: 'DALLAS *FOLDED*' }] }]);
  D.CRITIQUE_CACHE.clear();
  const cr = await T.critique({ plan, corpus: TOPIC }, { track, aiAllowed: true }, noLessons);
  restore();
  assert.equal(cr.ok, true);
  assert.equal(cr.plan.chapters[0].headline, 'DALLAS *FOLDED*');
  assert.equal(allVo(cr.plan), SCRIPT);
  assert.equal((await T.critique({ plan: { beats: [] } }, { track, aiAllowed: false })).status, 400);
  const denied = await T.lessonsMode({ action: 'refresh' }, { user: { email: 'e@x.com' } }, 't', { admin: async () => false });
  assert.equal(denied.status, 403);
  assert.ok(maker._test.EVENT_TYPES.includes('critique'));
});

console.log(`\n${passed} Reels v4 AI tests passed.`);
