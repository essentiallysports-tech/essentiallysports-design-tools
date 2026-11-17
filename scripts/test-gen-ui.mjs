// Generate v2 UI (gen-ui, 2026-11-19): the focus view's pure helpers
// (generate-focus.js: History, reframe, cleanStory, estimateCost, critiqueFor,
// relTime), reframed scenes against the ES gate, and the page wiring the
// assistant branch relies on (#gen-assistant-slot, FrameUpAssistant.mount /
// applyImprovement, 'frameup:design-changed', count). No network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { util: U } = require(path.resolve('generate-focus.js'));
const COMPOSE = require(path.resolve('frameup-compose.js'));

// ── cleanStory: the "Story: Story:" bug ──────────────────────────────────
assert.equal(U.cleanStory('Story: Bryson DeChambeau among ex-LIV group headed for DP World Tour'), 'Bryson DeChambeau among ex-LIV group headed for DP World Tour');
assert.equal(U.cleanStory('Story: Lakers win\nTeam: Lakers\nSport: NBA'), 'Lakers win Lakers NBA');
assert.equal(U.cleanStory('Joe Burrow threw for 409 yards'), 'Joe Burrow threw for 409 yards');
assert.equal(U.cleanStory('History: a record'), 'History: a record', 'only whole labels are removed');
assert.equal(U.cleanStory(''), '');

// ── estimateCost: per choice, monotonic, templates stop at 4 ─────────────
const costs = [1, 2, 4, 6, 8].map(n => U.estimateCost(n, 'creative'));
costs.slice(1).forEach((c, i) => assert.ok(c > costs[i], 'more designs cost more'));
assert.ok(costs[2] > 0.07 && costs[2] < 0.23, `4 creative designs within the logged range ($0.07-0.23): ${costs[2]}`);
assert.equal(U.estimateCost(8, 'templates'), U.estimateCost(4, 'templates'));
assert.equal(U.estimateCost(99), U.estimateCost(8), 'clamped to 8');
assert.equal(U.estimateCost(0), U.estimateCost(4), 'bad input = the default 4');

// ── relTime ──────────────────────────────────────────────────────────────
const now = Date.parse('2026-11-19T12:00:00Z');
assert.equal(U.relTime(now - 20e3, now), 'now');
assert.equal(U.relTime(now - 12 * 60e3, now), '12m');
assert.equal(U.relTime(new Date(now - 2 * 3600e3).toISOString(), now), '2h');
assert.equal(U.relTime(now - 3 * 86400e3, now), '3d');
assert.equal(U.relTime('', now), '');

// ── History: undo / redo / restore / coalesce / cap ──────────────────────
{
  const s = n => ({ size: { w: 1080, h: 1350 }, layers: [{ type: 'text', text: `v${n}` }] });
  const h = new U.History(s(0));
  assert.equal(h.canUndo, false);
  assert.equal(h.push(s(0), 'same'), false, 'an identical scene is not a version');
  h.push(s(1), 'One');
  h.push(s(2), 'Two');
  assert.equal(h.entries.length, 3);
  assert.deepEqual(h.undo(), s(1));
  assert.equal(h.canRedo, true);
  assert.deepEqual(h.redo(), s(2));
  h.undo();
  h.push(s(3), 'Three');
  assert.equal(h.canRedo, false, 'a new edit drops the redo branch');
  assert.deepEqual(h.entries.map(e => e.label), ['Original', 'One', 'Three']);
  h.restore(0);
  assert.equal(h.entries.length, 4, 'restore adds a version');
  assert.equal(h.current.layers[0].text, 'v0');
  assert.match(h.entries[3].label, /^Restored: Original/);
  // Typing folds into one version.
  const t = new U.History(s(0));
  t.push(s(1), 'Edited text', 'text', { coalesce: true, now: 1000 });
  t.push(s(2), 'Edited text', 'text', { coalesce: true, now: 1800 });
  t.push(s(3), 'Edited text', 'text', { coalesce: true, now: 5000 });
  assert.equal(t.entries.length, 3);
  // The cap keeps the original.
  const c = new U.History(s(0), 'Original', { max: 5 });
  for (let i = 1; i < 12; i += 1) c.push(s(i), `E${i}`);
  assert.equal(c.entries.length, 5);
  assert.equal(c.entries[0].label, 'Original');
  assert.equal(c.current.layers[0].text, 'v11');
  // Stored scenes are copies.
  const live = s(9);
  const d = new U.History(live);
  live.layers[0].text = 'mutated';
  assert.equal(d.current.layers[0].text, 'v9');
}

// ── reframe: other sizes still pass the ES gate ──────────────────────────
{
  const photo = { src: 'https://example.com/p.jpg' };
  const inputs = [
    { headline: 'Burrow torches Steelers', number: { value: '409', label: 'passing yards', factId: 'f1' }, numbers: [{ value: '409', display: '409', label: 'YDS', factId: 'f1' }, { value: '4', display: '4', label: 'TD', factId: 'f2' }, { value: '231', display: '231', label: 'REC YDS', factId: 'f3' }], photo, cutout: { src: 'https://example.com/c.png' }, kicker: 'NFL', sport: 'NFL',
      quote: { text: 'We are not done yet', by: 'Patrick Mahomes' }, record: { value: '7-2', label: 'record', factId: 'f4' },
      score: { a: { name: 'Bengals', value: '38' }, b: { name: 'Steelers', value: '18' }, factId: 'f5' }, compare: { title: 'Total yards', a: { label: 'CIN', value: '484', display: '484' }, b: { label: 'PIT', value: '222', display: '222' }, factId: 'f6' },
      facts: [{ id: 'f1', text: '409 yards' }, { id: 'f2', text: '4 touchdowns' }, { id: 'f3', text: '231 yards' }, { id: 'f4', text: '7-2' }, { id: 'f5', text: '38-18' }, { id: 'f6', text: '484-222' }] },
  ];
  let tried = 0;
  let passed = 0;
  const fails = [];
  inputs.forEach(input => COMPOSE.fitting(input).forEach(id => [0, 1, 2].forEach(v => {
    let scene;
    try { scene = COMPOSE.build(id, input, v); } catch (error) { return; }
    if (!COMPOSE.checkScene(scene, { facts: scene.facts }).ok) return; // only scenes that pass at 4:5
    ['story', 'square'].forEach(key => {
      tried += 1;
      const next = U.reframe(scene, key);
      assert.deepEqual(next.size, U.SIZE_KEYS[key]);
      assert.equal(next.layers.length, scene.layers.length, 'no layer lost');
      const res = COMPOSE.checkScene(next, { facts: scene.facts });
      if (res.ok) passed += 1; else fails.push(`${id}/${v}/${key}: ${res.errors[0]?.msg}`);
    });
    assert.equal(U.sizeKeyOf(U.reframe(scene, 'story')), 'story');
  })));
  assert.ok(tried >= 20, `reframed ${tried} scenes`);
  // A reframe that fails the gate is refused in the UI (the size stays); most pass.
  assert.ok(passed / tried >= 0.8, `reframes passing the ES gate: ${passed}/${tried}\n${fails.join('\n')}`);
  // Square keeps every boxed, non-full-bleed layer inside the safe area and shrinks type.
  const base = COMPOSE.build('big-number', inputs[0], 0);
  const sq = U.reframe(base, 'square');
  base.layers.forEach((l, i) => {
    const m = sq.layers[i];
    if (typeof l.y !== 'number' || l.type === 'background' || (l.h || 0) >= 1350 * 0.6) return;
    assert.ok(m.y >= 49, `${l.type} stays below the top safe line (${m.y})`);
    if (typeof l.size === 'number') assert.ok(m.size < l.size, 'type scales with the layout');
  });
  // Story: the bottom-anchored headline moves with the bottom edge.
  const st = U.reframe(base, 'story');
  const hi = base.layers.findIndex(l => l.role === 'headline');
  assert.equal(st.layers[hi].y, base.layers[hi].y + 570);
  assert.equal(U.reframe(base, 'portrait').layers[hi].y, base.layers[hi].y, 'same size = a copy');
  assert.equal(U.reframe(base, 'nope'), null);
}

// ── critiqueFor: the director's critique, else the quick check ───────────
{
  const director = U.critiqueFor({ verdict: { critique: { strengths: ['Clear order'], improvements: [{ id: 'i1', text: 'Photo too dark behind headline', fix: { op: 'more-contrast' } }, { text: 'Number lacks unit' }, { id: 'x' }], nextTime: 'Lead with the photo' } } });
  assert.equal(director.source, 'director');
  assert.deepEqual(director.improvements.map(i => i.id), ['i1', 'i2']);
  assert.equal(director.nextTime, 'Lead with the photo');
  const fromDir = U.critiqueFor({ dir: { critique: { improvements: [{ id: 'a', text: 'x' }] } } });
  assert.equal(fromDir.improvements[0].id, 'a');
  const quick = U.critiqueFor({ report: { heuristic: { issues: [{ fix: 'more-contrast', what: 'headline contrast 2.1:1' }, { fix: 'more-contrast', what: 'label contrast 1.9:1' }, { fix: '', what: 'missing image (1)' }] } } });
  assert.equal(quick.source, 'quick');
  assert.equal(quick.improvements.length, 2, 'one improvement per fix');
  assert.equal(quick.improvements[0].text, 'Headline contrast 2.1:1');
  assert.deepEqual(quick.improvements[0].fix, { op: 'more-contrast' });
  assert.equal(quick.improvements[1].fix, null);
  assert.deepEqual(U.critiqueFor({}).improvements, []);
  assert.equal(U.designIdFor('run 1/x', 'd2'), 'run1x-d2');
  assert.equal(U.designIdFor('', 'd1'), 'run-d1');
}

// ── Page wiring (the B/C contract) ───────────────────────────────────────
{
  const html = fs.readFileSync('generate.html', 'utf8');
  const focusAt = html.indexOf('generate-focus.js?v=');
  const creativeAt = html.indexOf('generate-creative.js?v=');
  assert.ok(focusAt > 0 && creativeAt > focusAt, 'generate-focus.js loads before generate-creative.js');
  assert.match(html, /generate-creative\.css\?v=20261119-gen-v2/);
  assert.match(html, /count: window\.FrameUpCreative\?\.count\?\.\(\) \|\| 4/, 'ES templates runs send the chosen count');
  assert.ok(!/gen-quick__group|grid-template-columns: 72px/.test(html), 'no fixed label column (the clipped TRENDING label)');
  ['Trending now', 'Try a format', 'gen-recent__run', 'gen-tchip__rising', 'gen-tchip__age', 'template-thumbs/instagram-'].forEach(t => assert.ok(html.includes(t), `quick rows have ${t}`));
  assert.match(html, /frameup\.generate\.recent\.v2/);
  const focus = fs.readFileSync('generate-focus.js', 'utf8');
  assert.match(focus, /<section id="gen-assistant-slot"[^>]*data-design-id=/, 'the assistant slot');
  assert.match(focus, /FrameUpAssistant\.mount\(slot, \{ getScene: d\.getScene, setScene: d\.setScene, designId: d\.designId, runId: d\.runId \}\)/);
  assert.match(focus, /aria-keyshortcuts/);
  ['portrait', 'story', 'square'].forEach(k => assert.ok(focus.includes(`data-size="\${key}"`) && focus.includes(`'${k}'`)));
  const js = fs.readFileSync('generate-creative.js', 'utf8');
  assert.match(js, /mode: 'creative', brief, count: n/, 'Creative runs send count');
  assert.match(js, /FrameUpAssistant\.applyImprovement\(card\._designId, id\)/);
  assert.match(js, /'frameup:design-changed'/);
  assert.match(js, /cleanStory\(dir\.storyText\)/, 'the story label is stripped');
  assert.ok(!/textEl\('strong', '', 'Story: '\)/.test(js), 'no "Story:" prefix on the card');
  assert.match(js, /checkScene\?\.\(scene/, 'setScene goes through the ES gate');
  const css = fs.readFileSync('generate-creative.css', 'utf8');
  assert.ok(!/#(?:7B2CBF|8B5CF6|A855F7|9333EA|6D28D9|800080)/i.test(css + html), 'no purple');
  assert.match(css, /html\[data-theme="dark"\] \.gfx \{/, 'focus view has a dark theme');
  assert.match(css, /prefers-reduced-motion/);
}

console.log('gen-ui checks passed');
