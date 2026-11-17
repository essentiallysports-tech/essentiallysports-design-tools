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

t('settings summary has four consistent tiles that open their section', () => {
  assert.match(js, /\['style', 'Style', st\], \['voice', 'Voice', voice\], \['clips', 'Clips', [^\]]+\], \['format', 'Format', fmt\]/);
  assert.doesNotMatch(js, /'format auto'/);
  for (const id of ['rm-set-style', 'rm-set-format', 'rm-set-clips', 'rm-voice-topic']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(js, /els\.settings\.open = true/);
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
