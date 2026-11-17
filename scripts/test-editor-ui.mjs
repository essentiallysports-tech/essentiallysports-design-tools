#!/usr/bin/env node
// Editor UI (frameup-editor-ui.js): layer reorder / visibility / lock /
// selection / filter helpers, safe zones, the canvas bar's words, slide
// helpers. Plus the wiring in index.html (loaded, bridged, layers delegated,
// export nudge, slide actions) and that no design is drawn by this file.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI = require('../frameup-editor-ui.js');

const layers = () => [
  { id: 'photo', label: 'Background Image', visible: true, locked: false },
  { id: 'pills', label: 'Text', visible: true, locked: false },
  { id: 'swipeButton', label: 'Swipe Button', visible: true, locked: false },
  { id: 'logo', label: 'Logo', visible: true, locked: false },
];
const order = ['photo', 'pills', 'swipeButton', 'logo']; // bottom-most first

// ─── names ───────────────────────────────────────────────────────────────
assert.equal(UI.normalizeName('  Headline   pills ', 'Text'), 'Headline pills');
assert.equal(UI.normalizeName('   ', 'Text'), 'Text', 'empty goes back to the default');
assert.equal(UI.normalizeName(null, 'Logo'), 'Logo');
assert.equal(UI.normalizeName('x'.repeat(80), 'T').length, UI.NAME_MAX);
assert.equal(UI.layerType('pills').kind, 'Text');
assert.equal(UI.layerType('unknown').kind, 'Layer');

// ─── order ───────────────────────────────────────────────────────────────
assert.deepEqual(UI.ids(UI.panelOrder(layers())), ['logo', 'swipeButton', 'pills', 'photo'], 'panel shows front first');
assert.deepEqual(UI.moveBy(order, ['pills'], 1), ['photo', 'swipeButton', 'pills', 'logo'], 'forward one step');
assert.deepEqual(UI.moveBy(order, ['pills'], -1), ['pills', 'photo', 'swipeButton', 'logo'], 'backward one step');
assert.deepEqual(UI.moveBy(order, ['logo'], 1), order, 'already in front: stays');
assert.deepEqual(UI.moveBy(order, ['photo'], -1), order, 'already at the back: stays');
assert.deepEqual(UI.moveBy(order, ['photo', 'pills'], 1), ['swipeButton', 'photo', 'pills', 'logo'], 'a block moves together');
assert.deepEqual(UI.moveBy(order, ['swipeButton', 'logo'], 1), order, 'block at the front stays');
assert.deepEqual(UI.moveBy(order, ['photo', 'logo'], 1), ['pills', 'photo', 'swipeButton', 'logo'], 'front one stays, the other moves');
assert.deepEqual(UI.moveBy(order, [], 1), order);
assert.deepEqual(UI.moveToEdge(order, ['photo'], 'front'), ['pills', 'swipeButton', 'logo', 'photo']);
assert.deepEqual(UI.moveToEdge(order, ['logo', 'pills'], 'back'), ['pills', 'logo', 'photo', 'swipeButton'], 'keeps their order');
assert.deepEqual(UI.dropOrder(order, ['photo'], 'logo', 'above'), ['pills', 'swipeButton', 'logo', 'photo'], 'drop above = in front of');
assert.deepEqual(UI.dropOrder(order, ['photo'], 'logo', 'below'), ['pills', 'swipeButton', 'photo', 'logo']);
assert.deepEqual(UI.dropOrder(order, ['logo'], 'photo', 'below'), ['logo', 'photo', 'pills', 'swipeButton'], 'drop below the bottom one');
assert.deepEqual(UI.dropOrder(order, ['pills', 'logo'], 'photo', 'below'), ['pills', 'logo', 'photo', 'swipeButton'], 'multi drop');
assert.deepEqual(UI.dropOrder(order, ['pills'], 'pills', 'above'), order, 'drop on itself does nothing');
assert.deepEqual(UI.mergeOrder(order, ['logo', 'pills', 'photo']), ['logo', 'pills', 'swipeButton', 'photo'], 'left-out layer keeps its slot');
assert.deepEqual(UI.mergeOrder(order, order), order);

// applyOrder keeps the same array and objects (state.coverLayers identity).
const arr = layers();
const objects = arr.slice();
assert.equal(UI.applyOrder(arr, ['logo', 'photo', 'pills', 'swipeButton']), true);
assert.deepEqual(UI.ids(arr), ['logo', 'photo', 'pills', 'swipeButton']);
assert.ok(arr.every(layer => objects.includes(layer)), 'same layer objects');
assert.equal(UI.applyOrder(arr, ['logo', 'photo', 'pills', 'swipeButton']), false, 'no change, no write');
const partial = layers();
UI.applyOrder(partial, ['logo', 'nope']);
assert.deepEqual(UI.ids(partial), ['logo', 'photo', 'pills', 'swipeButton'], 'unknown ids ignored, the rest keep order');

// ─── visibility and lock ────────────────────────────────────────────────
const v = layers();
assert.equal(UI.toggleFlag(v, ['pills'], 'visible'), false);
assert.equal(v[1].visible, false);
assert.equal(UI.toggleFlag(v, ['pills', 'logo'], 'visible'), false, 'any visible: hide all');
assert.equal(v[3].visible, false);
assert.equal(UI.toggleFlag(v, ['pills', 'logo'], 'visible'), true, 'all hidden: show all');
assert.equal(UI.toggleFlag(v, ['photo'], 'locked'), true);
assert.equal(v[0].locked, true);
assert.equal(UI.toggleFlag(v, ['photo', 'pills'], 'locked'), true, 'any unlocked: lock all');
assert.equal(UI.toggleFlag(v, ['photo', 'pills'], 'locked'), false);
assert.equal(UI.toggleFlag(v, [], 'locked'), null);
assert.deepEqual(Object.keys(v[0]).sort(), ['id', 'label', 'locked', 'visible'], 'no new fields on saved layers');

// ─── selection and filter ───────────────────────────────────────────────
const panelIds = ['logo', 'swipeButton', 'pills', 'photo'];
assert.deepEqual(UI.rangeSelect(panelIds, 'logo', 'pills'), ['logo', 'swipeButton', 'pills']);
assert.deepEqual(UI.rangeSelect(panelIds, 'photo', 'swipeButton'), ['swipeButton', 'pills', 'photo'], 'either direction');
assert.deepEqual(UI.rangeSelect(panelIds, 'gone', 'pills'), ['pills']);
const f = layers();
f[1].visible = false;
assert.deepEqual(UI.ids(UI.filterLayers(f, 'te')), ['pills'], 'word prefix on name');
assert.deepEqual(UI.ids(UI.filterLayers(f, 'image')), ['photo']);
assert.deepEqual(UI.ids(UI.filterLayers(f, 'hidden')), ['pills'], 'state words match');
assert.deepEqual(UI.ids(UI.filterLayers(f, 'butt swipe')), ['swipeButton'], 'every word must match');
assert.deepEqual(UI.filterLayers(f, 'ton'), [], 'no substring matches');
assert.equal(UI.filterLayers(f, '  ').length, 4);

// ─── width, hit testing, safe zones ─────────────────────────────────────
assert.equal(UI.clampWidth(100), UI.WIDTH_MIN);
assert.equal(UI.clampWidth(999), UI.WIDTH_MAX);
assert.equal(UI.clampWidth('260'), 260);
assert.equal(UI.clampWidth('nope'), UI.WIDTH_DEFAULT);
const boxes = [
  { id: 'photo', rect: { x: 0, y: 0, w: 1080, h: 1350 } },
  { id: 'logo', rect: { x: 908, y: 50, w: 122, h: 104 } },
];
assert.equal(UI.layerAtPoint(layers(), boxes, { x: 950, y: 90 }), 'logo', 'top-most wins');
assert.equal(UI.layerAtPoint(layers(), boxes, { x: 10, y: 10 }), 'photo');
const hiddenLogo = layers();
hiddenLogo[3].visible = false;
assert.equal(UI.layerAtPoint(hiddenLogo, boxes, { x: 950, y: 90 }), 'photo', 'hidden layers are skipped');
assert.equal(UI.layerAtPoint(layers(), boxes, { x: 2000, y: 10 }), null);
const zone = UI.youtubeTimestampZone(1280, 720);
assert.deepEqual(zone, { x: 1088, y: 626, w: 192, h: 94 });
assert.equal(UI.rectsOverlap({ x: 1000, y: 600, w: 200, h: 60 }, zone), true);
assert.equal(UI.rectsOverlap({ x: 100, y: 500, w: 900, h: 100 }, zone), false);
assert.equal(UI.rectsOverlap(null, zone), false);
assert.deepEqual(UI.profileGridCrop(1080, 1350), { left: 34, right: 34, width: 1013 }, '4:5 shown as 3:4');
assert.equal(UI.profileGridCrop(1080, 1440), null, '3:4 already: nothing cut');
assert.deepEqual(UI.profileGridCrop(1080, 1080), { left: 135, right: 135, width: 810 }, 'square loses its sides too');

// ─── canvas bar words, slides ───────────────────────────────────────────
assert.deepEqual(UI.describeDesign({ workspace: 'instagram', template: 'Cover Image', width: 1080, height: 1350 }), { label: 'Cover Image', size: '1080 × 1350' });
assert.deepEqual(UI.describeDesign({ workspace: 'instagram', template: 'Cover Image', width: 1080, height: 1350, slide: 1, slides: 5 }).label, 'Cover Image · Slide 2 of 5');
assert.deepEqual(UI.describeDesign({ workspace: 'newsletter', template: 'Trivia', isHtml: true }), { label: 'Trivia', size: 'HTML' });
assert.equal(UI.nextEmptySlide([true, false, true, false, false], 0), 1);
assert.equal(UI.nextEmptySlide([true, true, true, false, true], 4), 3, 'wraps around');
assert.equal(UI.nextEmptySlide([true, true, true, true, true], 2), -1);

// ─── wiring ──────────────────────────────────────────────────────────────
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'frameup-editor-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frameup-editor-ui.css'), 'utf8');
assert.match(html, /<script src="frameup-editor-ui\.js\?v=[^"]+"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="frameup-editor-ui\.css\?v=[^"]+">/);
assert.match(html, /window\.FrameUpEditorBridge = \{/);
assert.match(html, /function renderLayersPanelRows\(\) \{\s*\/\/[^\n]*\n\s*if \(window\.FrameUpEditorUI\?\.ready\)/, 'layers panel delegates to the module');
assert.match(html, /if \(activeWorkspace === 'youtube'\) return !state\.youtubeQuote;/, 'YouTube thumbnails get the layers panel');
assert.match(html, /window\.dispatchEvent\(new Event\('frameup:rendered'\)\)/);
assert.match(html, /window\.FrameUpEditorUI\?\.exportIssues\?\.\(\)/, 'safe-zone nudge joins Before you export');
for (const fn of ['moveInstagramSlide', 'duplicateInstagramSlide', 'clearInstagramSlide']) assert.match(html, new RegExp(`function ${fn}\\(`));
assert.doesNotMatch(js, /\beval\(|new Function\(/, 'no eval (CSP)');
assert.doesNotMatch(js, /getElementById\('preview'\)\.getContext|drawCanvas\(|renderExportImage/, 'never draws on the design canvas');
assert.doesNotMatch(css + js, /purple|#8b5cf6|#7c3aed|violet/i, 'no purple');
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /html\[data-theme="dark"\]/);

console.log('test-editor-ui: ok');
