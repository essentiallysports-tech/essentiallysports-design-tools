#!/usr/bin/env node
// Editor quick wins wired into the pages: link image size, P1 accessibility
// fixes, Reels phone Export, and the new scripts loaded in order.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html', 'utf8');

// Link uploads: 0.85 JPEG, newsletter capped at 1200 px; downloads stay 0.94.
assert.match(html, /const LINK_JPEG_QUALITY = 0\.85;/);
assert.match(html, /const exportQuality = workspace\.exportType === 'image\/jpeg' \? 0\.94 : undefined;/, 'downloads keep 0.94');
const planSource = html.match(/const LINK_JPEG_QUALITY[\s\S]*?\nfunction linkImagePlan[\s\S]*?\n}\n/)[0];
const sandbox = {};
vm.runInNewContext(`${planSource}; this.linkImagePlan = linkImagePlan;`, sandbox);
const { linkImagePlan } = sandbox;
assert.deepEqual({ ...linkImagePlan({ width: 1200, height: 675, type: 'image/jpeg', workspace: 'newsletter', quality: 0.94 }) }, { quality: 0.85, width: 1200, height: 675 });
assert.deepEqual({ ...linkImagePlan({ width: 2400, height: 1350, type: 'image/jpeg', workspace: 'newsletter', quality: 0.94 }) }, { quality: 0.85, width: 1200, height: 675 }, '2x newsletter capped');
assert.deepEqual({ ...linkImagePlan({ width: 2160, height: 2700, type: 'image/jpeg', workspace: 'instagram', quality: 0.94 }) }, { quality: 0.85, width: 2160, height: 2700 }, 'social not capped');
assert.deepEqual({ ...linkImagePlan({ width: 960, height: 70, type: 'image/png', workspace: 'newsletter', quality: undefined }) }, { quality: undefined, width: 960, height: 70 }, 'PNG untouched');
assert.match(html, /const plan = linkImagePlan\([\s\S]*?resizeCanvasForLink\(offscreen, plan\.width, plan\.height\)[\s\S]*?canvasToBlob\(linkCanvas, workspace\.exportType, plan\.quality\)/, 'copyImageLink uses the link plan');

// P1: labelled image searches, an h1 on editor routes kept in sync.
assert.match(html, /<input type="search" data-ai-image-query-input[^>]*aria-label="Search ES images"/);
assert.match(html, /<input type="search" data-canvas-ai-image-query-input[^>]*aria-label="Search ES images"/);
assert.match(html, /<h1 class="es-sr-only" id="studio-route-heading">/);
assert.match(html, /getElementById\('studio-route-heading'\)[\s\S]{0,80}textContent = `\$\{title\} editor`/);

// New scripts load before frameup-extras.js (which opens the size pack).
const order = ['frameup-zip.js', 'frameup-size-pack.js', 'frameup-cutout.js', 'frameup-extras.js'].map(file => html.indexOf(`${file}?v=`));
order.forEach((at, i) => assert.ok(at > -1, `loads #${i}`));
assert.deepEqual([...order].sort((a, b) => a - b), order, 'in order');
assert.match(html, /frameup-quick-wins\.css\?v=/);

// Reels: phone Export starts disabled and mirrors the desktop button.
const reelsHtml = fs.readFileSync('reels.html', 'utf8');
assert.match(reelsHtml, /data-reels-mobile-export disabled/);
const reelsJs = fs.readFileSync('reels.js', 'utf8');
assert.match(reelsJs, /button\.disabled = els\.exportBtn\.disabled/);
assert.match(reelsJs, /MutationObserver\(syncMobileExport\)\.observe\(els\.exportBtn, \{ attributes: true, attributeFilter: \['disabled'\] \}\)/);

// New API is registered for Vercel.
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
assert.ok(vercel.functions['api/remove-bg.js'], 'remove-bg has a vercel functions entry');

console.log('editor quick wins tests passed.');
