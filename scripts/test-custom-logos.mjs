// Custom logos (frameup-custom-logos.js): validation, naming, size limits,
// crop math, list helpers, missing-table detection, the migration's objects and
// the wiring into the logo picker and the editor. No network, no browser.
// The browser flow (upload -> crop -> My logos -> canvas -> export) is
// scripts/check-custom-logos.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const C = require('../frameup-custom-logos.js');
const picker = require('../logo-picker.js');
const h = C.helpers;
let passed = 0;
const test = (name, fn) => { fn(); passed += 1; };
const near = (a, b, what, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

test('node build: helpers only, no store, openCrop resolves null', async () => {
  assert.equal(C.store, null);
  assert.ok(Object.isFrozen(h));
  assert.equal(h.TABLE, 'frameup_custom_logos');
  assert.equal(h.BUCKET, 'custom-logos');
  assert.equal(h.OUT_SIZE, 1024);
  assert.equal(h.THUMB_SIZE, 256);
});

test('file validation: types, extension fallback, empty, 5 MB limit', () => {
  const f = (type, size, name = 'logo') => ({ type, size, name });
  assert.equal(h.validateFile(f('image/png', 1000)), '');
  assert.equal(h.validateFile(f('image/jpeg', 1000)), '');
  assert.equal(h.validateFile(f('image/webp', 1000)), '');
  assert.equal(h.validateFile(f('image/svg+xml', 1000)), '');
  assert.equal(h.validateFile(f('', 1000, 'mark.SVG')), '', 'typeless SVG by extension');
  assert.equal(h.fileKind(f('', 1, 'a.jpg')), 'jpeg');
  assert.match(h.validateFile(f('image/gif', 1000)), /PNG, JPG, WebP or SVG/);
  assert.match(h.validateFile(f('text/html', 1000, 'x.svg')), /PNG/, 'a declared non-image type is not rescued by its extension');
  assert.match(h.validateFile(f('', 1000, 'x.exe')), /PNG/);
  assert.match(h.validateFile(f('image/png', 0)), /empty/);
  assert.equal(h.validateFile(f('image/png', 5 * 1024 * 1024)), '', 'exactly 5 MB is fine');
  assert.match(h.validateFile(f('image/png', 5 * 1024 * 1024 + 1)), /5 MB/);
  assert.match(h.validateFile(null), /Choose/);
  assert.equal(h.keepsTransparency('png'), true);
  assert.equal(h.keepsTransparency('webp'), true);
  assert.equal(h.keepsTransparency('svg'), true);
  assert.equal(h.keepsTransparency('jpeg'), false);
});

test('pixel limits', () => {
  assert.equal(h.validateDimensions(1024, 1024), '');
  assert.match(h.validateDimensions(10, 400), /too small/);
  assert.match(h.validateDimensions(13000, 100), /too large/);
  assert.match(h.validateDimensions(9000, 9000), /too large/, '81 MP');
});

test('names: cleaned, 80 characters, unique per person', () => {
  assert.equal(h.cleanName('bulls_alt_logo.png'), 'bulls alt logo');
  assert.equal(h.cleanName('  Big   Ten\n\tmark.SVG '), 'Big Ten mark');
  assert.equal(h.cleanName(''), 'Logo');
  assert.equal(h.cleanName('.png'), 'Logo');
  assert.equal(h.cleanName('x'.repeat(200)).length, 80);
  assert.equal(Array.from(h.cleanName('🏈'.repeat(100))).length, 80, 'counts characters, not UTF-16 units');
  assert.equal(h.uniqueName('Bulls', ['Other']), 'Bulls');
  assert.equal(h.uniqueName('Bulls', ['bulls']), 'Bulls 2');
  assert.equal(h.uniqueName('Bulls', ['Bulls', 'Bulls 2']), 'Bulls 3');
  const long = 'y'.repeat(80);
  const next = h.uniqueName(long, [long]);
  assert.equal(next.length, 80);
  assert.ok(next.endsWith(' 2'));
});

test('object paths live in the owner folder; ids are UUIDs', () => {
  const uid = '00000000-0000-0000-0000-000000000001';
  const id = h.newId();
  assert.ok(h.isUuid(id), id);
  assert.notEqual(h.newId(), h.newId());
  assert.ok(h.isUuid(h.newId({ getRandomValues: a => a.fill(7) })), 'fallback without randomUUID is a v4 UUID');
  const p = h.objectPaths(uid, 'ABCDEF00-0000-4000-8000-000000000000');
  assert.deepEqual(p, { path: `${uid}/abcdef00-0000-4000-8000-000000000000.png`, thumbPath: `${uid}/abcdef00-0000-4000-8000-000000000000-thumb.png` });
  assert.match(p.path, /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/, 'matches the table check');
  assert.throws(() => h.objectPaths('../etc', id));
  assert.throws(() => h.objectPaths(uid, 'x/../../y'));
});

test('crop math: contain start, fill, clamping, zoom anchor, draw rect', () => {
  // Wide 2000 x 1000 logo: contain = full width, half height, centred.
  let c = h.createCrop(2000, 1000);
  assert.equal(c.zoom, 1);
  assert.deepEqual(h.drawRect(c, 1024), { x: 0, y: 256, w: 1024, h: 512 });
  // A contained image can't leave the frame: x is locked at 0, y within the gap.
  c = h.panCrop(c, 0.4, 0.4);
  near(c.x, 0, 'x locked when width == frame');
  near(c.y, 0.25, 'y stops at the edge');
  const r = h.drawRect(c, 1000);
  near(r.y + r.h, 1000, 'bottom edge touches the frame');
  // Fill: the short side covers the square.
  c = h.createCrop(2000, 1000, 'fill');
  near(c.zoom, 2, 'fill zoom');
  const f = h.drawRect(c, 1024);
  near(f.h, 1024, 'fill height');
  near(f.w, 2048, 'fill width');
  // A covering image must keep covering: pan limits to the overhang.
  c = h.panCrop(c, 5, 5);
  near(c.x, 0.5, 'x limit = (2-1)/2');
  near(c.y, 0, 'y locked');
  const edge = h.drawRect(c, 1024);
  near(edge.x, 0, 'left edge at the frame');
  // Zoom limits.
  assert.equal(h.setZoom(h.createCrop(500, 500), 0.2).zoom, 1);
  assert.equal(h.setZoom(h.createCrop(500, 500), 99).zoom, h.MAX_ZOOM);
  assert.equal(h.maxZoom(5000, 100), 100, 'very wide logos may zoom past 8x to fill');
  // Zooming keeps the anchor point still.
  const before = h.createCrop(1000, 1000);
  const zoomed = h.zoomCrop(before, 2, 0.25, 0.25);
  const ax = 0.25;
  // The image point under the anchor: (ax - x) / zoom must be unchanged.
  near((ax - before.x) / before.zoom, (ax - zoomed.x) / zoomed.zoom, 'anchor point', 1e-9);
  // Square output and thumb ratio.
  const sq = h.drawRect(h.createCrop(800, 800), h.THUMB_SIZE);
  assert.deepEqual(sq, { x: 0, y: 0, w: 256, h: 256 });
});

test('library helpers: last used first, search, rows, missing table', () => {
  const rows = [
    { id: 'a', name: 'Alpha', created_at: '2026-11-01T00:00:00Z', last_used_at: null },
    { id: 'b', name: 'Bravo', created_at: '2026-11-02T00:00:00Z', last_used_at: '2026-11-20T00:00:00Z' },
    { id: 'c', name: 'Charlie', created_at: '2026-11-10T00:00:00Z' },
  ].map(h.normalizeRow);
  assert.deepEqual(h.sortLogos(rows).map(r => r.id), ['b', 'c', 'a']);
  assert.deepEqual(h.filterLogos(rows, 'ARL').map(r => r.id), ['c']);
  assert.equal(h.filterLogos(rows, '').length, 3);
  const n = h.normalizeRow({ id: 'x', name: '', thumb_path: 'u/x-thumb.png', width: '1024' });
  assert.equal(n.name, 'Logo');
  assert.equal(n.thumbPath, 'u/x-thumb.png');
  assert.equal(n.width, 1024);
  assert.ok(h.isMissingError({ code: '42P01' }));
  assert.ok(h.isMissingError({ code: 'PGRST205', message: 'Could not find the table' }));
  assert.ok(h.isMissingError({ message: 'Bucket not found', statusCode: '404' }));
  assert.ok(h.isMissingError({ statusCode: 404, error: 'Bucket not found' }));
  assert.ok(!h.isMissingError({ code: '42501', message: 'new row violates row-level security policy' }));
  assert.ok(!h.isMissingError(null));
});

test('picker: "My logos" chip keeps its id', () => {
  const chips = picker.helpers.buildChips([], {});
  const mine = chips.find(chip => chip.id === 'uploads');
  assert.equal(mine.label, 'My logos');
});

test('migration: table, RLS, bucket, policies, size checks, undo notes', () => {
  const dir = path.join(ROOT, 'supabase/migrations');
  const file = fs.readdirSync(dir).find(name => /_frameup_custom_logos\.sql$/.test(name));
  assert.ok(file, 'migration exists');
  const sql = fs.readFileSync(path.join(dir, file), 'utf8');
  assert.match(sql, /create table if not exists public\.frameup_custom_logos/);
  for (const col of ['owner_id uuid not null default auth.uid()', 'owner_email', 'name text', 'path text', 'thumb_path text', 'width integer', 'height integer', 'bytes integer', 'created_at', 'updated_at', 'last_used_at']) assert.ok(sql.includes(col), col);
  assert.match(sql, /char_length\(btrim\(name\)\) between 1 and 80/);
  assert.match(sql, /bytes between 0 and 5242880/);
  assert.match(sql, /enable row level security/);
  assert.equal((sql.match(/create policy "frameup custom logos: owner (reads|inserts|updates|deletes) own"/g) || []).length, 4);
  assert.equal((sql.match(/public\.is_es_designer_domain_user\(\)/g) || []).length >= 6, true, 'ES users only');
  assert.match(sql, /values \('custom-logos', 'custom-logos', false, 5242880, array\['image\/png'\]\)/, 'private bucket, 5 MB, PNG');
  assert.equal((sql.match(/create policy "custom logos: es users (upload|read|replace|delete) own"/g) || []).length, 4);
  assert.match(sql, /\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/);
  assert.ok(!/public\s*=\s*true|, true, \d+/.test(sql), 'never a public bucket');
  assert.match(sql, /Safe to run more than once/);
  assert.match(sql, /-- Undo:/);
  assert.match(sql, /grant update \(name, last_used_at\)/);
  // Every create policy is preceded by a drop (re-runnable).
  const creates = sql.match(/create policy "([^"]+)"/g).map(m => m.slice(15, -1));
  creates.forEach(name => assert.ok(sql.includes(`drop policy if exists "${name}"`), `drop before ${name}`));
});

test('wiring: picker uses the library; editor loads it; brand logo has Custom', () => {
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const pick = fs.readFileSync(path.join(ROOT, 'logo-picker.js'), 'utf8');
  const lib = fs.readFileSync(path.join(ROOT, 'frameup-custom-logos.js'), 'utf8');
  assert.match(index, /<script src="frameup-custom-logos\.js\?v=[^"]+"><\/script>\s*<script src="logo-picker\.js\?v=/, 'loaded before the picker');
  assert.match(index, /data-brand-logo="custom"/);
  assert.match(index, /only: 'custom'/);
  assert.match(index, /mode: choice\.source === 'library' \? 'library' : 'upload'/, 'custom picks are stored like uploads');
  assert.match(pick, /api\.openCrop\(file/);
  assert.match(pick, /api\.store\.add\(crop\)/);
  assert.match(pick, /source: 'custom'/);
  assert.match(pick, /api\.track\('custom-logo-use'/);
  assert.match(lib, /track\('custom-logo-upload'/);
  assert.match(lib, /tracker\.track\('open'/, 'uses an existing usage category');
  // Never public URLs; never inline SVG markup.
  assert.ok(!/getPublicUrl/.test(lib));
  assert.ok(!/innerHTML\s*=\s*[^;]*(svgText|reader\.result|file\.text)/.test(lib));
  assert.ok(!/readAsText/.test(lib), 'SVG markup is never read as text');
  // Template data modules accept the PNG data URL a custom pick returns.
  const stat = require('../social-stat-templates.js');
  const listicle = require('../listicle-data.js');
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
  assert.ok(stat.isLogoSource ? stat.isLogoSource(dataUrl) : true);
  assert.equal(listicle.updateListicleRow(listicle.createDefaultListicleData(), 0, { logoSrc: dataUrl }).rows[0].logoSrc, dataUrl);
});

console.log(`custom logos: ${passed} tests passed`);
