// One segmented-control language and one chip language (ui-unify, 2026-11-20).
// Static checks: every segmented control on Generate, Trends, Video Ads, Reels
// Studio and Home is the UI Library's .es-segmented, every filter/choice chip
// is .es-chip, the old page-local components are gone, and Generate's trend
// sections share one heading style. No network, no browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(f, 'utf8');
const ui = read('es-ui.css');
const tokens = read('design-tokens.css');

// ── Library: states for the ARIA every page already uses ────────────────
for (const attr of ['aria-selected', 'aria-checked', 'aria-pressed']) {
  assert.ok(ui.includes(`.es-segmented__item[${attr}="true"]`), `es-segmented styles ${attr}`);
}
assert.match(ui, /\.es-segmented__item \{[^}]*min-height: 36px/, 'standard segment is 36px');
assert.match(ui, /\.es-segmented \{[^}]*padding: 4px/, 'in a 4px track (44px)');
assert.match(ui, /\.es-segmented--sm \.es-segmented__item \{[^}]*min-height: 32px/, 'documented compact variant');
assert.ok(ui.includes('.es-segmented__item--icon'), 'icon segment');
assert.match(ui, /\.es-chip:is\(\[aria-pressed="true"\], \[aria-checked="true"\]\)/, 'chip pressed + checked');
assert.ok(ui.includes('.es-chip__count'), 'chip count');
assert.match(ui, /@media \(pointer: coarse\) \{ \.es-chip \{ min-height: var\(--es-tap/, 'one touch height for chips');
assert.match(tokens, /html\[data-theme="dark"\] \.es-chip:is\(\[aria-pressed="true"\], \[aria-checked="true"\]\)/, 'dark selected chip');

// ── Old page-local components are gone ───────────────────────────────────
const pages = {
  generate: read('generate.html') + read('generate-creative.js') + read('generate-focus.js') + read('generate-creative.css'),
  videoAds: read('video-ads.html') + read('video-ads.js') + read('video-ads.css') + read('ai-studio.css'),
  trends: read('trends.css') + read('trends-view.js'),
  reels: read('reel-maker.css'),
  home: read('frameup-home-today.js') + read('frameup-home-today.css'),
  library: read('design-system.html'),
};
assert.doesNotMatch(pages.generate, /class="gen-chips?"|'gen-chip'|\.gen-chips? \{|\.gen-count \{|\.gfx-seg \{/, 'Generate: no gen-chips / gen-count / gfx-seg components');
assert.doesNotMatch(pages.videoAds, /va-seg\b|va-chip\b(?!s)/, 'Video Ads: no va-seg / va-chip');
assert.doesNotMatch(pages.library, /va-seg\b/, 'UI Library: no va-seg specimen');
assert.doesNotMatch(pages.trends, /td-density \.es-segmented__item|\.td-count \{[^}]*\}\s*\.es-chip/, 'Trends: no local density sizes');
assert.doesNotMatch(pages.reels, /\.es-segmented__item\[aria-checked="true"\] \{|\.es-chip\[aria-checked="true"\] \{/, 'Reels: no local selected states');
assert.doesNotMatch(pages.home, /es-chip--sm|min-height: 32px; padding: 0 12px/, 'Home: library chip, no local size');

// ── Every segmented control is .es-segmented ─────────────────────────────
const gen = read('generate.html');
for (const id of ['gen-tone', 'gen-audience', 'trends-density']) assert.match(gen, new RegExp(`class="es-segmented[^"]*" id="${id}"`), `${id} is .es-segmented`);
const creative = read('generate-creative.js');
assert.match(creative, /class="es-segmented" id="gen-look"/);
assert.match(creative, /class="es-segmented gen-count" id="gen-count"/);
assert.match(creative, /class="es-segmented__item gen-count__item"/);
assert.match(read('generate-focus.js'), /class="es-segmented gfx-seg"[^>]*id="gfx-sizes"/);
assert.match(gen, /chip\.className = 'es-segmented__item'/, 'Tone/Audience items');
const va = read('video-ads.html');
for (const id of ['va-brands', 'va-sizes', 'va-zone', 'va-team-sport', 'va-color-sport', 'va-lib-sport', 'va-exmode', 'va-sound-mode', 'va-fitmode']) {
  const m = va.match(new RegExp(`<div class="([^"]*)"[^>]*id="${id}"`));
  assert.ok(m && m[1].split(' ').includes('es-segmented'), `${id} is .es-segmented`);
}
const vaRadios = [...va.matchAll(/<div class="es-segmented[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].flatMap(m => [...m[1].matchAll(/<button([^>]*)>/g)].map(b => b[1]));
assert.ok(vaRadios.length >= 20 && vaRadios.every(b => b.includes('class="es-segmented__item"') && b.includes('role="radio"')), 'every VA segment is an es-segmented__item radio');
const vaJs = read('video-ads.js');
assert.match(vaJs, /<button class="es-segmented__item" type="button" role="radio" data-brand=/, 'brand segments');
assert.match(vaJs, /class="es-chip va-teamchip/, 'team choices are chips');
assert.equal((vaJs.match(/class="es-chip"/g) || []).length, 5, 'still / quality / sort / claims / style-set chips');
assert.equal((va.match(/class="es-chip" type="button" data-sport=/g) || []).length, 4, 'By moment sport chips');

// ── Chips ────────────────────────────────────────────────────────────────
assert.match(gen, /button\.className = 'es-chip gen-tchip'/, 'Generate Trending now chips');
assert.match(read('trends-view.js'), /class="es-chip__count"/, 'Trends chip counts use the library');

// ── Generate: one heading style for the trend sections ───────────────────
const label = gen.match(/\.gen-qs__label \{[^}]*\}/)[0];
const title = gen.match(/\.gen-empty__title \{[^}]*\}/)[0];
for (const part of ['--es-type-panel-title-weight', '--es-type-panel-title-size', '--es-font-display', 'text-transform: uppercase', 'color: var(--es-ink)']) {
  assert.ok(label.includes(part) && title.includes(part), `heading style shares ${part}`);
}
assert.doesNotMatch(label, /eyebrow/, 'no eyebrow heading');

console.log('ui-unify: ok');
