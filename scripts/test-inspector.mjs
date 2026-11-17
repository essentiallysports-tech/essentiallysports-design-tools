#!/usr/bin/env node
// Inspector (frameup-inspector.js + the redesign section of studio-inspector.css): the pure helpers (layer → section,
// the selection strip's words, panel width, keyboard resize, scrub, roving
// focus) and the wiring in index.html. Also checks that the inspector never
// draws on the canvas or touches export / state code, and that it leaves the
// Listicle Type 2 and infographic panels alone.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const I = require('../frameup-inspector.js');

// ─── layer → section ─────────────────────────────────────────────────────
assert.equal(I.targetForLayer('pills').section, 'content');
assert.equal(I.targetForLayer('logo').section, 'brand');
assert.equal(I.targetForLayer('swipeButton').focus, '#swipe-button-card');
assert.equal(I.targetForLayer('photo').block, 'photo');
assert.equal(I.targetForLayer('nope'), null);

// ─── selection strip ─────────────────────────────────────────────────────
let c = I.contextFor({ workspace: 'instagram', template: 'Cover Image', ids: [] });
assert.equal(c.title, 'Whole design · Cover Image');
assert.equal(c.selection, false);
assert.match(c.sub, /Select a layer/);
assert.equal(I.contextFor({}).title, 'Whole design');
c = I.contextFor({ workspace: 'instagram', ids: ['pills'], names: ['Headline'] });
assert.equal(c.title, 'Headline', 'a renamed layer keeps its own name');
assert.equal(c.kind, 'text');
assert.match(c.sub, /Content/);
assert.match(I.contextFor({ ids: ['logo'], names: [''] }).sub, /Brand & Colors/);
assert.equal(I.contextFor({ ids: ['logo'], names: [''] }).title, 'Logo', 'falls back to the default name');
assert.match(I.contextFor({ workspace: 'youtube', ids: ['photo'], names: ['Background Image'] }).sub, /Photos/);
assert.match(I.contextFor({ workspace: 'instagram', ids: ['photo'], names: ['Background Image'] }).sub, /in Photo$/);
c = I.contextFor({ ids: ['pills', 'logo', 'photo'], names: ['Text', 'Logo', 'Background Image'] });
assert.equal(c.title, '3 layers selected');
assert.equal(c.sub, 'Text, Logo… · each has its own section');
assert.equal(I.contextFor({ ids: ['pills', 'logo'], names: ['Text', 'Logo'] }).sub, 'Text, Logo · each has its own section');

// ─── width ───────────────────────────────────────────────────────────────
assert.equal(I.clampWidth(10), 300);
assert.equal(I.clampWidth(999), 440);
assert.equal(I.clampWidth('352.4'), 352);
assert.equal(I.clampWidth('abc'), null);
assert.equal(I.defaultWidth(1440), 370);
assert.equal(I.defaultWidth(1024), 320);
assert.equal(I.storedWidth(null, 1440), null);
assert.equal(I.storedWidth('', 1440), null);
assert.equal(I.storedWidth('junk', 1440), null);
assert.equal(I.storedWidth('370', 1440), null, 'the default follows the CSS');
assert.equal(I.storedWidth('400', 1440), 400);
assert.equal(I.storedWidth('9999', 1024), 440);
assert.equal(I.widthForKey(360, 'ArrowLeft'), 368, '← widens: the handle is on the left edge');
assert.equal(I.widthForKey(360, 'ArrowRight'), 352);
assert.equal(I.widthForKey(360, 'ArrowLeft', { shift: true }), 392);
assert.equal(I.widthForKey(436, 'ArrowLeft'), 440);
assert.equal(I.widthForKey(360, 'Home'), 300);
assert.equal(I.widthForKey(360, 'End'), 440);
assert.equal(I.widthForKey(360, 'a'), null);

// ─── scrub ───────────────────────────────────────────────────────────────
assert.equal(I.scrubValue(0, 10), 5, 'one step per 2px');
assert.equal(I.scrubValue(0, -11), -5);
assert.equal(I.scrubValue(0, 1), 0, 'less than 2px does nothing');
assert.equal(I.scrubValue(0, 10, { coarse: true }), 50);
assert.equal(I.scrubValue(95, 40, { min: -100, max: 100 }), 100);
assert.equal(I.scrubValue(100, 4, { step: 5, min: 10, max: 300 }), 110);
assert.equal(I.scrubValue(12, 4, { step: 5 }), 20, 'snaps to the step');
assert.equal(I.scrubValue('x', 4), 2, 'a blank field starts at 0');

// ─── roving focus ────────────────────────────────────────────────────────
assert.equal(I.nextIndex(0, 'ArrowDown', 3), 1);
assert.equal(I.nextIndex(2, 'ArrowDown', 3), 0);
assert.equal(I.nextIndex(0, 'ArrowUp', 3), 2);
assert.equal(I.nextIndex(1, 'Home', 3), 0);
assert.equal(I.nextIndex(1, 'End', 3), 2);
assert.equal(I.nextIndex(1, 'Tab', 3), -1);
assert.equal(I.nextIndex(0, 'ArrowDown', 0), -1);

// ─── wiring and boundaries ───────────────────────────────────────────────
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'frameup-inspector.js'), 'utf8');
const fullCss = fs.readFileSync(path.join(root, 'studio-inspector.css'), 'utf8');
const css = fullCss.slice(fullCss.indexOf('Inspector redesign (2026-11-20'));
assert.ok(css.length > 1000, 'the redesign section is in studio-inspector.css');
assert.match(html, /<link rel="stylesheet" href="studio-inspector\.css\?v=[^"]+">/, 'CSS is linked');
assert.doesNotMatch(html, /frameup-inspector\.css/, 'no extra stylesheet request before first paint');
assert.match(html, /<script src="frameup-inspector\.js\?v=[^"]+" defer><\/script>/, 'JS is deferred');
assert.ok(html.indexOf('frameup-inspector.js') > html.indexOf('frameup-editor-ui.js'), 'loads after the editor UI (it reads its selection)');
assert.ok(html.indexOf('studio-inspector.css') < html.indexOf('</head>'), 'CSS in the head: no restyle flash');
// Never draws, exports or writes design state.
assert.doesNotMatch(js, /getContext\(|toDataURL|toBlob|renderExportImage|drawCanvas/);
assert.doesNotMatch(js, /\bstate\.[a-zA-Z]+\s*=(?!=)/, 'no writes to editor state');
assert.doesNotMatch(js, /coverLayers|saveMediaContext|localStorage\.setItem\('frameup\.(?!inspector)/);
assert.doesNotMatch(js, /listicle|infographic/i, 'Listicle Type 2 / infographic code paths untouched');
// CSS: no purple, ES fonts only, WIP panels excluded.
assert.doesNotMatch(css, /#(?:8b5cf6|7c3aed|a855f7|9333ea|6d28d9)|purple|violet/i);
for (const m of css.matchAll(/font-family:\s*([^;]+);/g)) assert.match(m[1], /var\(--es-font-(ui|display|body)\)/, `font: ${m[1]}`);
assert.match(css, /:not\(:is\(#listicle-type2-fields, #infographic-fields\) \*\)/);
assert.doesNotMatch(css, /#listicle-type2-fields\s+[.#\w]|#infographic-fields\s+[.#\w]/, 'no rules inside the WIP panels');
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /html\[data-theme="dark"\]/);

console.log('test-inspector: ok');
