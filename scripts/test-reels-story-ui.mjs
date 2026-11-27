// Reels Studio v4: the page's static contract (QA lane, 2026-11-27).
// The markup the journey depends on (Create → Review → Export, contract ids),
// what was removed, and the few behaviours that can be read from the source:
// the 4 v4 style cards come from ReelES.STYLES, the length toggle, the chapter
// strip, the per-beat actions (Swap media / Edit / Change module / Ask AI),
// the Ready to post gate (motion rule, clips, critic, Find clips) and the
// feedback log calls. The real-browser walk is scripts/check-reels-ui.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'reel-maker.html'), 'utf8');
const css = readFileSync(path.join(root, 'reel-maker.css'), 'utf8');
const js = readFileSync(path.join(root, 'reel-maker.js'), 'utf8');
let n = 0;
const fails = [];
const t = (name, fn) => { try { fn(); n += 1; } catch (error) { fails.push(`${name}: ${error.message}`); } };
const once = id => assert.equal(html.split(`id="${id}"`).length, 2, `#${id} exactly once`);
const between = (from, to) => { const a = html.indexOf(from); const b = html.indexOf(to, a + 1); assert.ok(a > 0 && b > a, `${from} … ${to}`); return html.slice(a, b); };

t('page title is visually hidden but still the h1', () => {
  assert.match(html, /<h1 class="es-sr-only" id="rm-title">Reels Studio<\/h1>/);
});

t('three steps: Create, Review, Export (tour target #rm-steps stays)', () => {
  assert.match(html, /<nav class="rm-steps" id="rm-steps"/);
  assert.deepEqual([...html.matchAll(/class="rm-step" type="button" data-step="([a-z]+)"/g)].map(m => m[1]), ['topic', 'edit', 'export']);
  assert.match(html, /<span>Create<\/span>[\s\S]*<span>Review<\/span>[\s\S]*<span>Export<\/span>/);
});

t('the kept ids: canvas, play, scrub, export', () => {
  ['rm-steps', 'rm-canvas', 'rm-play', 'rm-scrub', 'rm-export'].forEach(once);
});

t('Create: one prompt, four style cards, Make my reel, trends, Need an idea?', () => {
  ['rm-pane-topic', 'rm-prompt', 'rm-styles4', 'rm-make', 'rm-inspire-link', 'rm-trends'].forEach(once);
  assert.match(html, /id="rm-styles4"[^>]*role="radiogroup"/, 'the style cards are a radio group');
  assert.match(html, /<textarea[^>]*id="rm-prompt"/, 'the prompt is a textarea');
  assert.match(html, /id="rm-make"[^>]*>[\s\S]*?Make my reel/, 'the button says Make my reel');
  assert.match(html, /class="[^"]*es-btn--primary[^"]*"[^>]*id="rm-make"|id="rm-make"[^>]*class="[^"]*es-btn--primary/, 'Make my reel is the primary button');
  assert.match(html, /id="rm-inspire-link"[^>]*>Need an idea\?</);
  assert.match(html, /Start from a trend/);
});

t('Create: the length toggle (Full / Short) is one radio group', () => {
  once('rm-length');
  const at = html.indexOf('id="rm-length"');
  const tag = html.slice(html.lastIndexOf('<', at), html.indexOf('>', at) + 1);
  assert.match(tag, /role="radiogroup"|<fieldset/, `#rm-length is a radiogroup or fieldset: ${tag}`);
  const block = html.slice(at, html.indexOf('</', html.indexOf('data-length="short"', at)) + 200);
  assert.match(block, /data-length="full"/, 'a Full option');
  assert.match(block, /data-length="short"/, 'a Short option');
  assert.match(block, /Full[\s\S]{0,80}\b(8\d|9\d|100)\s?s/, 'Full says its length (~90 s)');
  assert.match(block, /Short[\s\S]{0,80}\b[34]\d\s?s/, 'Short says its length (~40 s)');
});

t('Create: the four v4 styles; the retired v3 ids are not offered as cards', () => {
  for (const id of ['gametape', 'statcard', 'receipts', 'hypecut']) assert.ok(!new RegExp(`data-style4="${id}"`).test(html), `${id} is not a card in the markup`);
  assert.match(js, /previewPlan/, 'the cards preview with the engine previewPlan');
});

t('Review: the chapter strip groups beats by chapter', () => {
  assert.match(js, /data-chapter/, 'chapter groups carry data-chapter');
  assert.match(js, /data-beat/, 'beat cards carry data-beat');
  assert.match(js, /\.chapters\b/, 'the strip reads plan.chapters');
});

t('Review: every beat offers Swap media, Edit, Change module and Ask AI', () => {
  assert.match(js, /Swap( media)?/, 'Swap media');
  assert.match(js, />\s*Edit\b|'Edit'|"Edit"|`Edit/, 'Edit');
  assert.match(js, /Change module/, 'Change module');
  assert.match(js, /Ask AI/, 'Ask AI');
});

t('Review: Ready to post needs the motion rule, a clip and the critic; offers Find clips', () => {
  assert.match(js, /Ready to post/, 'the badge says Ready to post');
  assert.match(js, /motionOk/, 'the gate reads motionOk');
  assert.match(js, /clipCount|needsClips/, 'the gate reads clipCount / needsClips');
  assert.match(js, /critique/, 'the critic runs (mode critique)');
  assert.match(js, /Find clips/, 'the Find clips action');
});

t('Learning: the page logs feedback for swap, edit, module, regenerate and export', () => {
  const src = js + readFileSync(path.join(root, 'reel-storyboard.js'), 'utf8');
  assert.match(src, /ReelFeedback\.log/, 'ReelFeedback.log is called');
  for (const ev of ['swap_media', 'edit_text', 'change_module', 'regenerate', 'export']) assert.ok(src.includes(`'${ev}'`) || src.includes(`"${ev}"`), `logs ${ev}`);
});

t('Create: the style cards come from the engine (ReelES.STYLES), not a second list', () => {
  assert.match(js, /\bSTYLES\b/, 'the page reads ReelES.STYLES');
  assert.ok(!/LOOK_IDS\.map|lookList\(\)\.map/.test(js), 'the old look picker is not drawn');
});

t('no settings rail, no looks, no recipes, no Start tiles, no "Soon" tiles', () => {
  for (const gone of ['rm-settings', 'rm-fmt-entry', 'rm-recipes', 'rm-looks', 'rm-style-fold', 'rm-costs', 'rm-more', 'rm-export-all', 'rm-versions', 'rm-statusline']) assert.ok(!html.includes(`id="${gone}"`), `#${gone} is retired`);
  assert.ok(!/<aside class="rm-rail"/.test(html), 'no rail');
  assert.ok(!/>\s*Soon\s*</.test(html), 'no "Soon" label in the markup');
});

t('Making: the step checklist with a live region', () => {
  once('rm-making');
  assert.match(html, /id="rm-making-live" aria-live="polite"/);
});

t('Review: chapter strip, Ready to post badge, Ask AI and three folds', () => {
  ['rm-pane-edit', 'rm-scenes', 'rm-beats', 'rm-ready', 'rm-panel', 'rm-revise', 'rm-ask', 'rm-ask-input', 'rm-voice', 'rm-captions', 'rm-details', 'rm-checklist', 'rm-lint'].forEach(once);
  assert.match(html, /id="rm-ready"[^>]*aria-controls="rm-lint"/, 'the badge controls the checklist');
  const review = between('id="rm-pane-edit"', 'id="rm-pane-export"');
  const folds = [...review.matchAll(/<details class="rm-fold" id="([\w-]+)"/g)].map(m => m[1]);
  assert.deepEqual(folds, ['rm-voice', 'rm-captions', 'rm-details'], `Review folds: ${folds}`);
  assert.match(review, /Voice &amp; music/);
  assert.match(js, /Ready to post/, 'the badge says Ready to post');
  assert.match(js, /[Ss]wap/, 'scenes offer Swap');
});

t('Details holds size, sources and the admin-only controls', () => {
  const details = between('id="rm-details"', 'id="rm-admin"');
  ['rm-aspect', 'rm-sources-list', 'rm-extra-source'].forEach(id => assert.ok(details.includes(`id="${id}"`), `#${id} in Details`));
  assert.match(html, /id="rm-admin"[^>]*data-admin[^>]*hidden/, 'admin controls are hidden by default');
  const admin = html.slice(html.indexOf('id="rm-admin"'), html.indexOf('id="rm-pane-export"'));
  ['rm-cost', 'rm-tier', 'rm-factcheck'].forEach(id => assert.ok(admin.includes(`id="${id}"`), `#${id} is admin-only`));
});

t('Export: one Export button plus Also export, Organic / Paid and rights', () => {
  ['rm-pane-export', 'rm-also', 'rm-export-45', 'rm-export-captions', 'rm-target'].forEach(once);
  const exp = html.slice(html.indexOf('id="rm-pane-export"'));
  assert.match(exp, /Also export/);
  assert.equal((html.match(/es-btn--primary/g) || []).length, 2, 'Make my reel and Export MP4 are the only primaries in the markup');
  assert.match(exp, /id="rm-rights/, 'rights summary');
});

t('Make my reel stays a primary while busy (aria-disabled, never disabled)', () => {
  const at = js.indexOf('function setWriteBusy');
  assert.ok(at > 0, 'setWriteBusy');
  const fn = js.slice(at, js.indexOf('\n  }\n', at));
  assert.ok(fn.includes("'aria-busy'"));
  assert.ok(fn.includes("'aria-disabled'"));
  assert.ok(!fn.includes('.disabled ='), 'must not set disabled');
  assert.match(html, /class="rm-spin rm-write__spin"/);
});

t('the page calls the sourcing module, not the old clip pickers', () => {
  assert.match(html, /src="reel-sourcing\.js\?v=[\w-]+"/, 'reel-sourcing.js is loaded');
  assert.match(js, /ReelSourcing/);
  for (const gone of ['function pickClips', 'function nextClip', 'function stillChain']) assert.ok(!js.includes(gone), `${gone} is removed (sourcing owns media)`);
});

t('disclosure headers are inset rounded rows; focus ring; reduced motion', () => {
  const rule = (css.match(/\.rm-fold > summary \{[^}]*\}/) || [''])[0];
  assert.match(rule, /border-radius: var\(--es-radius/);
  assert.match(css, /\.rm-fold > summary:focus-visible \{ outline: var\(--es-focus-outline/);
  assert.match(css, /prefers-reduced-motion/);
});

for (const f of fails) console.log(`FAIL ${f}`);
console.log(fails.length ? `reels story ui: ${n}/${n + fails.length} passed` : `All ${n} Reels Studio v4 page tests passed.`);
process.exit(fails.length ? 1 : 0);
