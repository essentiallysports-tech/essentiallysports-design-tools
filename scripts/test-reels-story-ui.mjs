// Reels Studio Story step UI contract (reels-ui, 2026-11-18).
// Static checks: the markup, CSS and JS hooks the Story step depends on.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'reel-maker.html'), 'utf8');
const css = readFileSync(path.join(root, 'reel-maker.css'), 'utf8');
const js = readFileSync(path.join(root, 'reel-maker.js'), 'utf8');
let n = 0;
const t = (name, fn) => { fn(); n += 1; };

t('page title is visually hidden but still the h1', () => {
  assert.match(html, /<h1 class="es-sr-only" id="rm-title">Reels Studio<\/h1>/);
  assert.doesNotMatch(html, /class="rm-kicker"/);
  assert.match(html, /<nav class="rm-steps" id="rm-steps"/, 'tour target #rm-steps stays');
});

t('league filter is a sticky header inside the scrolling trend box', () => {
  assert.match(html, /id="rm-trendbox"[\s\S]*?class="rm-trendbox__head"[\s\S]*?id="rm-leagues"[\s\S]*?id="rm-trends"/);
  assert.match(css, /\.rm-trendbox \{[^}]*overflow-y: auto/);
  assert.match(css, /\.rm-trendbox__head \{[^}]*position: sticky; top: 0/);
  assert.match(css, /\.rm-trendbox\.is-scrolled \.rm-trendbox__head/);
  assert.match(js, /classList\.toggle\('is-scrolled', els\.trendbox\.scrollTop > 0\)/);
});

t('trend rows use a roving tabindex and keep focus after a pick', () => {
  assert.match(js, /tabindex="\$\{item\.id === tabId \? 0 : -1\}"/);
  assert.match(js, /if \(refocus\) els\.trends\.querySelector/);
  assert.match(js, /\['Home', 'End'\]\.includes\(event\.key\)/);
});

t('picked story is a summary card with Change and Clear', () => {
  assert.match(js, /id="rm-repick">Change<\/button>/);
  assert.match(js, /id="rm-unpick" aria-label="Clear the story">Clear<\/button>/);
});

t('one settings rail: Look, Size, Voice, Music, Captions, Sources, Cost; nothing is set in two places', () => {
  assert.match(html, /<aside class="rm-rail" id="rm-settings" aria-labelledby="rm-rail-title">/);
  const rail = html.slice(html.indexOf('id="rm-settings"'), html.indexOf('</aside>'));
  const order = ['rm-style-fold', 'rm-aspect-sec', 'rm-voice"', 'rm-music"', 'rm-captions"', 'rm-sources"', 'rm-costs', 'rm-more'].map(id => rail.indexOf(`id="${id}`));
  order.forEach((i, k) => assert.ok(i > 0, `rail section ${k}`));
  assert.deepEqual([...order].sort((x, y) => x - y), order, 'rail order');
  for (const id of ['rm-aspect', 'rm-voice-edit', 'rm-music-pick', 'rm-capstyle', 'rm-extra-source', 'rm-cost', 'rm-spend', 'rm-clips-on', 'rm-tier', 'rm-factcheck', 'ri-voice-panel']) assert.equal(html.split(`id="${id}"`).length, 2, `${id} once`);
  for (const gone of ['rm-autoline', 'rm-voice-topic', 'rm-set-style', 'rm-set-format', 'rm-formats', 'rm-stripwrap']) assert.ok(!html.includes(`id="${gone}"`), `${gone} is retired`);
  assert.match(js, /function renderRail\(\)/);
  assert.match(js, /function renderAutoline\(\) \{ renderRail\(\); \}/, 'the page context keeps renderAutoline');
  assert.match(js, /els\.looks\.hidden = !looks;\s+els\.styles\.hidden = Boolean\(looks\);/, 'one look picker shows');
});

t('Start: six tiles, a recipe row and one primary button; three steps', () => {
  assert.match(html, /class="rm-tiles" id="rm-fmt-entry" role="radiogroup"/);
  assert.match(js, /id: 'trend'[\s\S]*?id: 'words'[\s\S]*?id: 'game'[\s\S]*?id: 'clip'[\s\S]*?id: 'player'[\s\S]*?id: 'inspo'/);
  assert.match(html, /role="radiogroup" aria-labelledby="rm-recipes-label" id="rm-recipes"/);
  assert.equal((html.match(/es-btn--primary/g) || []).length, 2, 'Make my reel and Export MP4 (Next turns primary on the Storyboard step)');
  assert.deepEqual([...html.matchAll(/class="rm-step" type="button" data-step="([a-z]+)"/g)].map(m => m[1]), ['topic', 'edit', 'export']);
  assert.match(html, /<span>Start<\/span>[\s\S]*<span>Storyboard<\/span>[\s\S]*<span>Export<\/span>/);
  assert.match(js, /logEvent\('start', \{ source: startOf\(\)/);
  assert.match(js, /logEvent\('recipe', /);
  assert.match(js, /logEvent\('variant', /);
});

t('Make my reel stays a primary while busy (aria-disabled, never disabled)', () => {
  const fn = js.slice(js.indexOf('function setWriteBusy'), js.indexOf('const STATE_WORD'));
  assert.ok(fn.includes("setAttribute('aria-busy'"));
  assert.ok(fn.includes("'aria-disabled'"));
  assert.ok(!fn.includes('.disabled ='), 'must not set disabled');
  assert.match(js, /if \(state\.flow\.making\) return;/, 'double clicks are ignored');
  assert.match(html, /class="rm-spin rm-write__spin"/);
});

t('stepper replaces the list while running and announces progress', () => {
  assert.match(js, /classList\.toggle\('is-making', f\.making\)/);
  assert.match(css, /\.rm-pane\.is-making :is\(#rm-source-trend/);
  assert.match(html, /id="rm-making-live" aria-live="polite"/);
  assert.match(js, /aria-current="step"/);
});

t('empty pane footer is really hidden (direct children only)', () => {
  assert.match(css, /\.rm-pane-nav:not\(:has\(> :not\(\[hidden\]\)\)\) \{ display: none; \}/);
});

t('disclosure headers are inset rounded rows, never a full-bleed block', () => {
  const rule = css.match(/\.rm-fold > summary \{[^}]*\}/)[0];
  assert.match(rule, /margin: var\(--es-space-1/);
  assert.match(rule, /border-radius: var\(--es-radius-chip/);
  assert.doesNotMatch(rule, /border-radius: inherit/);
  assert.match(css, /\.rm-fold\[open\] > summary::after \{ transform: rotate\(225deg\)/);
  assert.match(css, /\.rm-fold > summary:focus-visible \{ outline: var\(--es-focus-outline/);
});

t('spinner motion respects reduced motion', () => {
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{ \.rm-spin \{ animation/);
});

console.log(`All ${n} Reels Story UI tests passed.`);
