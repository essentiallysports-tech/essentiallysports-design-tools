// Reels Studio recipes (Reels 2.0, lane D): reel-recipes.js.
// Every recipe uses only the ES blocks and their exact fields; the director
// hint fits the server's limit; applyRecipe reshapes a script plan by code
// and never changes, adds or drops a spoken word.
// Run: node scripts/test-reel-recipes.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ES = require(path.join(root, 'reel-es.js'));
const RC = require(path.join(root, 'reel-recipes.js'));
const F = require(path.join(root, 'reel-formats.js'));
let n = 0;
const t = (name, fn) => { try { fn(); n += 1; } catch (error) { console.error(`FAIL ${name}`); throw error; } };

const SCRIPT = 'The Cubs lost on Sunday. But one bar in Chicago got *paid.* Kalshi says 1 in 2,500 bets was insurance. Bettors put $692M on the games, compared to $0.3M as insurance. Fans are still arguing about it.';
const vo = plan => plan.beats.map(b => b.vo).filter(Boolean).join(' ');
const types = plan => plan.beats.map(b => ES.blockOf(b).type);
// Every block carries only the fields the ES system lists for its type.
const exactFields = block => {
  const allowed = new Set(['type', ...ES.BLOCKS[block.type].fields, ...(block.type === 'number' ? ['display'] : [])]);
  return Object.keys(block).every(k => allowed.has(k));
};

t('the eight recipes, in the order the Start screen shows them', () => {
  assert.deepEqual(RC.RECIPE_IDS, ['stat-drop', 'quote-reaction', 'explainer', 'countdown', 'versus', 'fan-pulse', 'verdict', 'money-story']);
  assert.deepEqual(RC.list().map(r => r.label), ['Stat drop', 'Quote reaction', 'Explainer', 'Countdown', 'Versus', 'Fan pulse', 'Verdict', 'Money story']);
  assert.equal(RC.get('nope'), null);
});

t('each recipe: id, label, blurb, ES blocks only, hook first, end card last, a real look, a steer, a beat range', () => {
  RC.list().forEach(r => {
    assert.deepEqual(RC.validate(r), [], `${r.id}: ${RC.validate(r).join('; ')}`);
    assert.deepEqual(Object.keys(r).filter(k => !['id', 'label', 'blurb', 'format', 'look', 'blocks', 'beats', 'steer', 'stamp', 'cta', 'style', 'retired'].includes(k)), [], `${r.id}: unknown keys`);
    r.blocks.forEach(b => assert.ok(ES.BLOCK_TYPES.includes(b), `${r.id}: ${b}`));
    assert.ok(r.blocks.length - 1 <= r.beats.max + 1 && r.blocks.length >= 4, `${r.id}: block list fits the beat range`);
    assert.ok(r.blurb.length <= 64, `${r.id}: blurb fits its card`);
    assert.doesNotMatch(`${r.label} ${r.blurb} ${r.steer}`, /[—–]/, `${r.id}: no dashes in copy`);
    assert.ok(F.FORMATS[r.format], `${r.id}: format ${r.format}`);
  });
  assert.ok(new Set(RC.list().map(r => r.blocks.join())).size >= 7, 'the recipes are different shapes');
});

t('validate catches a recipe that breaks the ES rules', () => {
  const ok = RC.get('explainer');
  assert.match(RC.validate({ ...ok, blocks: ['hook', 'chart', 'endcard'] }).join(), /unknown block: chart/);
  assert.match(RC.validate({ ...ok, blocks: ['statement', 'hook', 'endcard'] }).join(), /open on one hook/);
  assert.match(RC.validate({ ...ok, blocks: ['hook', 'endcard', 'statement'] }).join(), /end on the end card/);
  assert.match(RC.validate({ ...ok, look: 'neon' }).join(), /unknown look/);
  assert.match(RC.validate({ ...ok, beats: { min: 2, max: 12 } }).join(), /beats/);
  assert.match(RC.validate({ ...ok, steer: 'x'.repeat(320) }).join(), /300 characters/);
  assert.match(RC.validate({ ...ok, cta: ['A LINE THAT IS MUCH TOO LONG FOR THE END CARD', 'B'] }).join(), /cta/);
});

t('the director hint: steer, block order and length, inside the server limit', () => {
  RC.list().forEach(r => {
    const s = RC.directorSteer(r);
    assert.ok(s.length <= 300, `${r.id}: ${s.length}`);
    assert.ok(s.includes(`Blocks in order: ${r.blocks.join(', ')}.`), `${r.id}: block order`);
    assert.ok(s.endsWith(`${r.beats.min} to ${r.beats.max} beats.`), `${r.id}: length`);
  });
  assert.equal(RC.directorSteer(''), '');
  assert.equal(RC.directorSteer('', 'Lead with the score'), 'Lead with the score');
  assert.ok(RC.directorSteer('versus', 'Lead with the score').startsWith('Lead with the score Versus:'));
  assert.deepEqual(RC.planRequest('', { format: 'auto' }), { format: 'auto', steer: '' });
  assert.deepEqual(RC.planRequest('countdown'), { format: 'top5', steer: RC.directorSteer('countdown'), recipe: 'countdown' });
  assert.equal(RC.planRequest('countdown', { format: 'quote' }).format, 'quote', 'a format the person picked wins');
});

t('suggest: the recipe that fits a story, from its words', () => {
  assert.equal(RC.suggest(''), '');
  assert.equal(RC.suggest('Dak Prescott signs a four-year, $240 million extension with the Cowboys'), 'money-story');
  assert.equal(RC.suggest('Josh Allen vs Patrick Mahomes: who has the edge on Sunday'), 'versus');
  assert.equal(RC.suggest('The top 5 quarterbacks of the season so far, ranked'), 'countdown');
  assert.equal(RC.suggest('Cowboys fans turn against Jerry Jones after another early exit'), 'fan-pulse');
  assert.equal(RC.suggest('“Absolutely a bad decision”: Troy Aikman, the Cowboys legend, blasts the trade'), 'verdict');
  assert.equal(RC.suggest('“I did not see a false start,” Andy Reid said after the loss'), 'quote-reaction');
  assert.equal(RC.suggest('Josh Allen threw for 412 yards and 4 touchdowns against the Chiefs'), 'stat-drop');
  assert.equal(RC.suggest('Ohio State stays on top after a comfortable win at home'), 'explainer');
});

t('applyRecipe: every recipe keeps the script word for word, in order', () => {
  const base = ES.scriptToPlan(SCRIPT, { sourceLine: 'Source: Kalshi' });
  const before = JSON.stringify(base);
  RC.RECIPE_IDS.forEach(id => {
    const { plan } = RC.applyRecipe(base, id);
    assert.equal(vo(plan), SCRIPT, `${id}: voiceover changed`);
    assert.ok(ES.voMatchesScript(plan), `${id}: script lock`);
    assert.equal(plan.beats.length, base.beats.length, `${id}: scene count`);
    assert.deepEqual(plan.beats.map(b => b.id), base.beats.map(b => b.id), `${id}: scene order`);
    assert.equal(types(plan)[0], 'hook', `${id}: opens on the hook`);
    assert.equal(types(plan).at(-1), 'endcard', `${id}: ends on the end card`);
    assert.equal(types(plan).filter(x => x === 'endcard').length, 1);
    plan.beats.forEach(b => {
      assert.deepEqual(ES.cleanBlock(b.block), b.block, `${id}/${b.id}: a clean ES block`);
      assert.ok(exactFields(b.block), `${id}/${b.id}: only the block's fields (${Object.keys(b.block)})`);
      assert.equal(b.kind, ES.KIND_FOR[b.block.type], `${id}/${b.id}: kind follows the block`);
    });
    assert.equal(plan.recipe, id);
    assert.equal(plan.look, RC.get(id).look);
    assert.equal(plan.script.locked, true);
    assert.equal(plan.sourceLine, 'Source: Kalshi');
  });
  assert.equal(JSON.stringify(base), before, 'the plan passed in is not changed');
});

t('applyRecipe: nothing is invented (every number and quote on screen is in the script)', () => {
  const plain = SCRIPT.replace(/\*/g, '').toLowerCase();
  RC.RECIPE_IDS.forEach(id => {
    const { plan } = RC.applyRecipe(ES.scriptToPlan(SCRIPT), id);
    plan.beats.forEach(b => {
      const block = b.block;
      if (block.type === 'endcard') return;
      ES.blockStrings(block).forEach(text => {
        (String(text).match(/\d[\d,.]*\d|\d/g) || []).forEach(num => {
          if (/^#\d+$/.test(String(text).trim())) return; // a rank the line itself opens with
          assert.ok(plain.includes(num.toLowerCase().replace(/\.$/, '')), `${id}/${b.id}: “${num}” is not in the script`);
        });
      });
      if (block.type === 'quote') assert.ok(plain.includes(block.text.toLowerCase()), `${id}: quote text is the person's`);
    });
  });
});

t('applyRecipe: a data block is never flattened, and a recipe only gets blocks the lines can fill', () => {
  const base = ES.scriptToPlan(SCRIPT);
  assert.deepEqual(types(base), ['hook', 'statement', 'dots', 'compare', 'statement', 'endcard']);
  // Quote reaction has no room for dots or compare: they stay as they are.
  const q = RC.applyRecipe(base, 'quote-reaction');
  assert.deepEqual(types(q.plan), types(base));
  assert.match(q.notes.join(' '), /quote block needs.*Nothing was made up/);
  // Money story wants a number and has one compare slot: the compare stays a compare.
  assert.deepEqual(types(RC.applyRecipe(base, 'money-story').plan), types(base));
  // Two comparisons, a recipe with one compare slot and a number slot: the second shows its first figure.
  const two = ES.scriptToPlan('Here is the gap in plain numbers today. The Bills scored 31 points compared to 28 for the Chiefs. Allen threw for 412 yards compared to 291 for Mahomes. That is the whole story.');
  assert.deepEqual(types(two), ['hook', 'compare', 'compare', 'statement', 'endcard']);
  const m = RC.applyRecipe(two, 'money-story').plan;
  assert.deepEqual(types(m), ['hook', 'compare', 'number', 'statement', 'endcard']);
  assert.equal(m.beats[2].block.value, 412);
  assert.equal(m.beats[2].block.display, '412');
  assert.equal(m.beats[2].stat.value, '412');
  assert.equal(m.beats[2].bars, undefined, 'the old compare fields are cleared');
  assert.equal(vo(m), vo(two));
});

t('applyRecipe: the stamp is the person\'s own emphasised word, on recipes that stamp', () => {
  const plan = ES.scriptToPlan('This bar in Chicago got *paid* on Sunday night. Nobody saw it coming at all.');
  const stamped = RC.applyRecipe(plan, 'stat-drop').plan;
  assert.deepEqual(stamped.beats[0].block.stamp, { text: 'PAID' });
  assert.equal(RC.applyRecipe(plan, 'explainer').plan.beats[0].block.stamp, undefined, 'Explainer does not stamp');
  assert.equal(RC.applyRecipe(ES.scriptToPlan('No emphasis in this opening line at all. Nobody saw it coming.'), 'stat-drop').plan.beats[0].block.stamp, undefined, 'no marked word, no stamp');
  assert.equal(RC.markedWord('The Cubs lost. This bar got *paid.*'), 'PAID');
  assert.equal(RC.markedWord('Nothing marked'), '');
});

t('applyRecipe: Countdown shows a rank only when the line opens with one', () => {
  assert.equal(RC.rankOf('Number 3, Josh Allen keeps climbing.'), 3);
  assert.equal(RC.rankOf('#2 Lamar Jackson is right behind.'), 2);
  assert.equal(RC.rankOf('1. Patrick Mahomes still leads.'), 1);
  assert.equal(RC.rankOf('Josh Allen threw 3 touchdowns.'), 0);
  const plan = ES.scriptToPlan('These are the best three passers right now. Number 3, Josh Allen keeps climbing the list. Number 2, Lamar Jackson is right behind him. Number 1, Patrick Mahomes still leads them all.');
  const out = RC.applyRecipe(plan, 'countdown').plan;
  const ranks = out.beats.slice(1, -1).map(b => b.block.lines[0]);
  assert.deepEqual(ranks, [{ text: '#3', color: 'blue' }, { text: '#2', color: 'blue' }, { text: '#1', color: 'blue' }]);
  out.beats.slice(1, -1).forEach(b => { assert.ok(b.block.lines.length <= 3); b.block.lines.forEach(l => assert.ok(l.text.length <= 18, l.text)); });
  assert.equal(vo(out), vo(plan));
  const noRanks = RC.applyRecipe(ES.scriptToPlan(SCRIPT), 'countdown').plan;
  assert.ok(noRanks.beats.every(b => !(b.block.lines || []).some(l => /^#\d/.test(l.text))), 'no rank is made up');
});

t('applyRecipe: Fan pulse changes the end card call to action, nothing else does', () => {
  const base = ES.scriptToPlan(SCRIPT);
  assert.deepEqual(RC.applyRecipe(base, 'fan-pulse').plan.beats.at(-1).block.cta, ['YOUR CALL.', 'TELL US BELOW.']);
  RC.RECIPE_IDS.filter(id => id !== 'fan-pulse').forEach(id => assert.deepEqual(RC.applyRecipe(base, id).plan.beats.at(-1).block.cta, ES.DEFAULT_CTA, id));
});

t('applyRecipe: works on a free-mode draft (no blocks yet) and keeps a look the person picked', () => {
  const draft = F.fallbackPlan({ brief: 'Shohei Ohtani hit 54 home runs and stole 59 bases this season. It is the first 50-50 season in MLB history. He did it in 159 games.', title: 'Ohtani makes history', format: 'stat' });
  draft.beats.forEach((b, i) => { b.id = `d${i + 1}`; });
  const words = draft.beats.map(b => b.vo).join(' | ');
  const { plan } = RC.applyRecipe({ ...draft, look: 'ink' }, 'stat-drop', { keepLook: true });
  assert.equal(plan.beats.map(b => b.vo).join(' | '), words, 'the draft lines are not rewritten');
  assert.equal(plan.look, 'ink', 'the picked look stays');
  assert.equal(RC.applyRecipe(draft, 'stat-drop', { keepLook: true }).plan.look, 'data', 'no look picked: the recipe sets it');
  plan.beats.forEach(b => assert.deepEqual(ES.cleanBlock(b.block), b.block));
  assert.equal(types(plan)[0], 'hook');
});

t('applyRecipe: scene-count notes are plain, and an unknown recipe changes nothing', () => {
  const short = ES.scriptToPlan('The Cubs lost on Sunday afternoon at home. This bar got paid anyway.');
  assert.match(RC.applyRecipe(short, 'explainer').notes.join(' '), /Explainer works best with 5 to 7 scenes\. This reel has 3: add a line or two\./);
  const long = ES.scriptToPlan(Array.from({ length: 11 }, (_, i) => `This is sentence number ${i + 20} of the long script here.`).join(' '));
  assert.match(RC.applyRecipe(long, 'quote-reaction').notes.join(' '), /it may run long/);
  const plan = ES.scriptToPlan(SCRIPT);
  const same = RC.applyRecipe(plan, 'unknown');
  assert.equal(same.plan, plan);
  assert.deepEqual(same.notes, []);
  assert.deepEqual(RC.applyRecipe(null, 'explainer').changed, []);
});

t('the page loads the recipes after the ES engine and before the page script', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(path.join(root, 'reel-maker.html'), 'utf8');
  const at = s => html.indexOf(`src="${s}`);
  assert.ok(at('reel-es.js') > 0 && at('reel-es.js') < at('reel-recipes.js') && at('reel-recipes.js') < at('reel-maker.js'), 'script order');
});

// Reels Studio v3: recipes are retired; each opens in a style, and a style is a preset.
t('v4: every retired recipe names its v4 style; applyStyle reshapes by code and keeps every word', () => {
  assert.deepEqual(Object.fromEntries(RC.RECIPE_IDS.map(id => [id, RC.RECIPES[id].style])), { 'stat-drop': 'breakdown', 'quote-reaction': 'breakdown', explainer: 'breakdown', countdown: 'breakdown', versus: 'breakdown', 'fan-pulse': 'breakdown', verdict: 'breakdown', 'money-story': 'breakdown' });
  assert.ok(RC.RECIPE_IDS.every(id => RC.RECIPES[id].retired));
  assert.equal(RC.styleFor('explainer', { beats: [{ clip: 'c' }] }), 'breakdown');
  assert.equal(RC.styleFor('stat-drop', { beats: [{ block: { type: 'dotGrid', total: 9 } }] }), 'outlier');
  const plan = ES.scriptToPlan(SCRIPT);
  ES.STYLE_IDS.forEach(id => {
    const { plan: out } = RC.applyStyle(plan, id);
    assert.equal(vo(out), vo(plan), `${id}: words unchanged`);
    assert.equal(out.esStyle, id);
    const allowed = new Set([...ES.STYLES[id].blocks, 'endcard']);
    const { notes } = RC.applyStyle(plan, id);
    types(out).forEach((ty, i) => assert.ok(allowed.has(ty) || notes.some(x => x.startsWith(`Scene ${i + 1}`)), `${id} scene ${i + 1} ${ty}`));
  });
});

console.log(`All ${n} reel recipe tests passed.`);
