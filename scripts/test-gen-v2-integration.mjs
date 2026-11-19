// Generate v2 integration (gen-brain + gen-styles + gen-ui, 2026-11-19):
//   - the server strips brief labels ("Story: Story: Bryson…") from stories;
//   - gen-styles' archetypes reach the director catalogue, the no-AI plan and
//     the multi-photo / cut-out rules in _composer.js;
//   - plan.directions[].input lets the page rebuild a design at another size;
//   - ONE history: the assistant (generate-assistant.js) changes a design only
//     through the page's setScene, so each change is one version in gen-ui's
//     History, and its undo / redo are the page's;
//   - Apply ids: the card, the focus view and the assistant share one critique;
//   - the count's cost estimate has one source (the assistant engine).
// No network: fetch is stubbed to fail.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
globalThis.fetch = async () => { throw new Error('no network in tests'); };

const K = require('../netlify/functions/_composer.js');
const COMPOSE = require('../frameup-compose.js');
const A = require('../generate-assistant.js');
const { util: U } = require('../generate-focus.js');

const BRYSON = 'Story: Story: Bryson DeChambeau takes his game to Europe after a $4 million season.\nSport: Golf';

// ── c. "Story:" labels never reach the story, the subject or the headline ──
{
  const read = K.readCreative(BRYSON);
  assert.equal(read.stories.length, 1);
  assert.ok(!/story\s*:/i.test(read.stories[0].text), `label stripped: ${read.stories[0].text}`);
  assert.equal(read.stories[0].subject, 'Bryson DeChambeau');
  assert.ok(!read.people.includes('Story'));
  K.planDeterministic(read, {}, { want: 4 }).forEach(d => assert.ok(!/^story\b/i.test(d.headline), `headline: ${d.headline}`));
  // Mid-text labels after a sentence; a colon in prose stays.
  assert.ok(!/summary:/i.test(K.readCreative('Joe Burrow threw for 409 yards. Summary: Bengals win.').stories.map(s => s.text).join(' ')));
  assert.match(K.readCreative('Bryson DeChambeau won his fourth title: a record 4 wins.').stories[0].text, /title: a record/);
}

// ── gen-styles → _composer.js ─────────────────────────────────────────────
{
  assert.equal(COMPOSE.ARCHETYPES.filter(a => !a.looks).length, 29, 'the 29 v1/v2 archetypes are all still there');
  assert.ok(!/Needs: undefined/.test(K.DIRECTOR_SYSTEM()), 'every archetype has a Needs line');
  const src = fs.readFileSync('netlify/functions/_composer.js', 'utf8');
  assert.match(src, /\['collage-strip', 'film-strip', 'photo-mosaic'\]\.includes\(archetype\) && photo/);
  assert.match(src, /'trading-card', 'sticker-collage', 'stat-tower'\]\.includes\(archetype\)/);
  // The no-AI plan reaches the new styles (PRIORITY derived from kinds).
  const briefs = [
    BRYSON,
    'Bengals rout Steelers 38-18 on Sunday Night Football and sit alone atop the AFC North at 7-2. Joe Burrow threw for 409 yards and 4 touchdowns.\nSport: NFL',
    'LPGA Tour season ends with $2 million prize and PGA Tour season ends with 100 players earning cards\nSport: Golf',
  ];
  const seen = new Set(briefs.flatMap(b => K.planDeterministic(K.readCreative(b), {}, { want: 8 }).map(d => d.archetype)));
  const fresh = [...seen].filter(id => !['hero-number', 'prize-poster', 'big-number', 'split-versus', 'magazine-cover', 'scoreboard', 'by-the-numbers', 'stat-bars', 'quote-portrait', 'typographic', 'collage-strip', 'duotone-hero', 'record-badge', 'unit-grid'].includes(id));
  assert.ok(fresh.length >= 1, `code plans use new archetypes (${[...seen].join(', ')})`);
  // defaultNote falls back to the archetype's own description.
  assert.equal(K.defaultNote({ archetype: 'swiss-grid' }, K.readCreative(BRYSON)), COMPOSE.BY_ID['swiss-grid'].about);
}

// ── d. input on every public direction; a size rebuild uses it ────────────
{
  const plan = await K.plan({ brief: BRYSON, director: false, cacheKey: `t-${Date.now()}` });
  assert.ok(plan.directions.length >= 1);
  plan.directions.forEach(d => {
    assert.ok(d.input && typeof d.input === 'object', `${d.id} has input`);
    assert.equal(d.input.headline, d.headline);
    const scene = d.candidates[0];
    const story = COMPOSE.build(scene.archetype, { ...d.input, size: 'story' }, scene.variant || 0);
    assert.deepEqual(story.size, { w: 1080, h: 1920 });
    assert.ok(COMPOSE.checkScene(story, { facts: d.input.facts }).ok, `${scene.archetype} rebuilt at 9:16 passes the ES gate`);
  });
}

// ── e. count + cost: one source of truth ───────────────────────────────────
{
  assert.deepEqual([0, 1, 4, 8, 99].map(n => K.budgetFor(n).want), [4, 1, 4, 8, 8]);
  [1, 2, 4, 6, 8].forEach(n => {
    const range = U.estimateRange(n, 'creative');
    assert.deepEqual(range, A.costEstimate(n));
    assert.equal(U.estimateCost(n, 'creative'), A.costEstimate(n).high);
    assert.equal(A.costEstimate(n).candidatesPerDesign, K.budgetFor(n).perDesign, 'client estimate mirrors the server budget');
  });
}

// ── a + b. ONE history; Apply ids shared (browser controller in a fake DOM) ─
{
  const listeners = {};
  const document = {
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter(f => f !== fn); },
    dispatchEvent: e => { (listeners[e.type] || []).forEach(fn => fn(e)); return true; },
    getElementById: () => null,
    head: { append() {} },
    createElement: () => ({}),
  };
  class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  const sandbox = { document, CustomEvent, console, JSON, Math, Number, String, Object, Array, Set, Map, Promise, Error, RegExp, Boolean };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.FrameUpCompose = COMPOSE;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('generate-assistant.js', 'utf8'), sandbox);
  const FA = sandbox.FrameUpAssistant;
  assert.equal(typeof FA.unmount, 'function');

  // gen-ui's card, as generate-creative.js design(id) exposes it.
  const plan = await K.plan({ brief: BRYSON, director: false, cacheKey: `t2-${Date.now()}` });
  const dir = plan.directions.find(d => d.candidates[0].layers.some(l => l.type === 'photo')) || plan.directions[0];
  const card = { scene: dir.candidates[0], history: new U.History(dir.candidates[0], 'Original') };
  const events = [];
  const designId = U.designIdFor('run1', dir.id);
  const commit = (scene, { label, source }) => {
    card.scene = scene;
    card.history.push(scene, label, source);
    events.push({ label, source });
    document.dispatchEvent(new CustomEvent('frameup:design-changed', { detail: { designId, scene, label, source, origin: 'generate' } }));
    return Promise.resolve(true);
  };
  const critique = A.designCritique({ strengths: ['Strong type'], improvements: [{ text: 'The palette fights the photo', fix: { op: 'palette', flip: true } }], nextTime: 'Lift dark photos.' }, null, card.scene);
  sandbox.FrameUpCreative = {
    state: { run: { plan: { runId: 'run1', directions: [dir], read: plan.read } } },
    design: id => (id !== designId ? null : {
      designId, history: card.history, getScene: () => card.scene,
      setScene: (scene, meta = {}) => commit(scene, { label: meta.label || 'AI assistant', source: meta.source || 'assistant' }),
      undo: () => (card.history.canUndo ? commit(card.history.undo(), { label: 'Undo', source: 'undo' }) : false),
      redo: () => (card.history.canRedo ? commit(card.history.redo(), { label: 'Redo', source: 'redo' }) : false),
      critique: () => critique,
    }),
  };
  FA.register(designId, { getScene: () => card.scene, setScene: (s, m) => sandbox.FrameUpCreative.design(designId).setScene(s, m), runId: 'run1', critique });
  assert.equal(FA._designs.get(designId).history, null, 'no private stack when the page owns the history');

  // A free local instruction: exactly one new version, labelled.
  const before = card.history.entries.length;
  const res = await FA.ask(designId, 'more drama');
  assert.ok(res.ok, res.reply);
  assert.equal(res.cost, 0);
  assert.equal(card.history.entries.length, before + 1, 'one version per assistant change');
  assert.equal(card.history.entries.at(-1).label, res.reply);
  assert.equal(events.length, 1);

  // The assistant's undo / redo are the page's (one step each).
  assert.ok(FA.undo(designId));
  assert.equal(card.history.index, before - 1);
  assert.ok(FA.redo(designId));
  assert.equal(card.history.index, before);
  assert.equal(FA.history(designId).length, card.history.entries.length);

  // Apply: the id the card shows (i1) is the id the assistant applies.
  assert.equal(critique.improvements[0].id, 'i1');
  const cardCrit = U.critiqueFor({ verdict: { critique }, dir: {}, scene: card.scene });
  assert.equal(cardCrit.improvements[0].id, 'i1');
  const n = card.history.entries.length;
  const applied = await FA.applyImprovement(designId, 'i1');
  assert.ok(applied.ok, applied.reply);
  assert.equal(card.history.entries.length, n + 1, 'Apply is one version');
  assert.match(card.history.entries.at(-1).label, /^Applied: /);

  // A quick-check item (bare fix name, from gen-ui's critiqueFor) applies too.
  const quick = sandbox.FrameUpCreative.design;
  sandbox.FrameUpCreative.design = id => { const d = quick(id); return d && { ...d, critique: () => ({ improvements: [{ id: 'q1', text: 'Bigger headline', fix: { op: 'bigger-headline' } }] }) }; };
  const q = await FA.applyImprovement(designId, 'q1');
  assert.ok(q.ok, q.reply);
  assert.equal(card.history.entries.length, n + 2);
}

// ── f. cache keys ──────────────────────────────────────────────────────────
{
  const html = fs.readFileSync('generate.html', 'utf8');
  ['generate-creative.css', 'frameup-compose.js', 'generate-focus.js', 'generate-assistant.js', 'generate-creative.js'].forEach(f => assert.ok(new RegExp(f.replace(/\./g,'\\.')+'\\?v=[\\w-]+').test(html), `${f} on a cache key`));
  const at = f => html.indexOf(`${f}?v=`);
  assert.ok(at('generate-focus.js') < at('generate-assistant.js') && at('generate-assistant.js') < at('generate-creative.js'), 'focus, assistant, then creative');
  assert.match(fs.readFileSync('generate-focus.js', 'utf8'), /generate-assistant\.js\?v=[\w-]+/, 'the lazy loader asks for the same file');
  const pkg = fs.readFileSync('package.json', 'utf8');
  assert.equal((pkg.match(/"test:generate"/g) || []).length, 1, 'one test:generate key');
  ['test-gen-brain', 'test-gen-ui', 'test-compose-styles', 'test-gen-v2-integration'].forEach(t => assert.ok(JSON.parse(pkg).scripts['test:generate'].includes(t), `test:generate runs ${t}`));
}

console.log('gen-v2 integration checks passed');
