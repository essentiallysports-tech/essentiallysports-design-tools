// Dashboard → Newsletter (2026-11-21): what Newsletter exports record and the
// view's maths.
//   1. frameup-newsletter-stats.js: rows from tasks and usage events (new and
//      older metadata), aggregation (this week, 7 / 30 / 90 days, top asset,
//      top person, by asset / person / newsletter, daily and weekly series),
//      filters, search and empty data.
//   2. index.html: the export metadata Newsletter exports send
//      (newsletterExportInfo run against stubbed editor state), and that only
//      tracking calls use it.
//   3. Wiring: dashboard-data.js reads the new fields and the usage log,
//      dashboard.html has the tab, the section and the scripts.
// Offline: mocked data only, nothing touches the network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = require(path.join(ROOT, 'frameup-newsletter-stats.js'));
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const INDEX = read('index.html');
const DATA = read('dashboard-data.js');
const DASH = read('dashboard.html');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`ok   ${name}`); } catch (error) { console.error(`FAIL ${name}`); throw error; }
}

// A fixed "now": Saturday 21 Nov 2026, 15:00 local time.
const NOW = new Date(2026, 10, 21, 15, 0, 0).getTime();
const DAY = 86400000;
const ago = (days, hours = 0) => new Date(NOW - days * DAY - hours * 3600000).toISOString();

function task(i, { days, email = 'ana@essentiallysports.com', name = 'Ana Ruiz', asset, label, brand, brandLabel, legacyBrand = '', size = '1200 × 675px', mime = 'image/jpeg', workspace = 'Newsletter' }) {
  return {
    id: `task-design-${i}`,
    type: 'exported_design',
    title: `Design ${i}`,
    workspace,
    workspaceVariant: label,
    teamOrLeague: legacyBrand,
    creatorEmail: email,
    creatorName: name,
    filename: `es-newsletter-${i}.${mime.includes('png') ? 'png' : 'jpeg'}`,
    createdAt: ago(days),
    metadata: {
      exportedAt: ago(days),
      outputSize: size,
      mimeType: mime,
      previewPath: `previews/task-design-${i}`,
      ...(asset ? { newsletterAsset: asset, newsletterAssetLabel: label, newsletterBrand: brand, newsletterBrandLabel: brandLabel, format: mime.includes('png') ? 'PNG' : 'JPEG' } : {}),
    },
  };
}

const TASKS = [
  task(1, { days: 0, asset: 'feature-image', label: 'Feature Image', brand: 'essentially-golf', brandLabel: 'Essentially Golf' }),
  task(2, { days: 1, asset: 'feature-image', label: 'Feature Image', brand: 'essentially-golf', brandLabel: 'Essentially Golf', email: 'ben@essentiallysports.com', name: 'Ben Ito' }),
  task(3, { days: 2, asset: 'section-header', label: 'Section Header (Left)', brand: 'the-huddle', brandLabel: 'The Huddle', size: '960 × 71px', mime: 'image/png' }),
  task(4, { days: 10, asset: 'archive-page-fi', label: 'Archive Page FI', brand: 'essentiallysports', brandLabel: 'EssentiallySports', size: '834 × 555px' }),
  // Older rows: no newsletter fields; asset from the label, brand from team_or_league when it is a newsletter id.
  task(5, { days: 20, label: 'Tag FI (Corner Label)', legacyBrand: 'essentially-dunk' }),
  task(6, { days: 45, label: 'Video FI (Play Button)', legacyBrand: 'Kansas City Chiefs', email: 'ben@essentiallysports.com', name: 'Ben Ito' }),
  task(7, { days: 100, label: 'Feature Image' }),
  // Not newsletter: ignored.
  task(8, { days: 0, label: 'Cover', workspace: 'Social Media' }),
];
const EVENTS = [
  { id: 'e1', created_at: ago(0, 2), user_email: 'cleo@essentiallysports.com', category: 'copy', tool: 'newsletter', action: 'widget-html', label: 'ticker', meta: { asset: 'ticker', template: 'Financial Ticker', brand: 'the-huddle', brandLabel: 'The Huddle', format: 'HTML' } },
  // Older widget copy: the label was the asset id, brand from the UTM context.
  { id: 'e2', created_at: ago(3), user_email: 'cleo@essentiallysports.com', category: 'copy', tool: 'newsletter', action: 'widget-html', label: 'trivia', meta: { brand: 'she-got-game' } },
  { id: 'e3', created_at: ago(4), user_email: 'ana@essentiallysports.com', category: 'share', tool: 'newsletter', action: 'image-link', label: 'golf-header', meta: { size: '1200x675', asset: 'feature-image', brand: 'essentially-golf' } },
  // Same export as a task row: skipped. Other tools: skipped.
  { id: 'e4', created_at: ago(0), user_email: 'ana@essentiallysports.com', category: 'export', tool: 'newsletter', action: 'jpg', label: 'Design 1', meta: {} },
  { id: 'e5', created_at: ago(0), user_email: 'ana@essentiallysports.com', category: 'copy', tool: 'social', action: 'headline', label: 'x', meta: {} },
];
const NAMES = { 'cleo@essentiallysports.com': 'Cleo Park' };
const ROWS = S.combine({ tasks: TASKS, events: EVENTS, names: NAMES });

// ── 1. Rows ─────────────────────────────────────────────────────────────────
test('only Newsletter tasks and newsletter copy/share events become rows', () => {
  assert.equal(ROWS.length, 10);
  assert.ok(!ROWS.some(row => row.id === 'task-design-8'));
  assert.ok(!ROWS.some(row => row.id === 'evt-e4' || row.id === 'evt-e5'));
  assert.deepEqual(ROWS.map(row => row.at), [...ROWS.map(row => row.at)].sort((a, b) => b - a), 'newest first');
});

test('new export metadata: asset id + label, brand, size, format, preview', () => {
  const row = ROWS.find(r => r.id === 'task-design-3');
  assert.equal(row.kind, 'image');
  assert.equal(row.asset, 'section-header');
  assert.equal(row.assetLabel, 'Section Header (Left)');
  assert.equal(row.brand, 'the-huddle');
  assert.equal(row.brandLabel, 'The Huddle');
  assert.equal(row.size, '960 × 71');
  assert.equal(row.format, 'PNG');
  assert.equal(row.hasPreview, true);
  assert.equal(row.detailed, true);
  assert.equal(row.name, 'Ana Ruiz');
});

test('older rows: asset from the template label, brand only when it is a newsletter id', () => {
  const tag = ROWS.find(r => r.id === 'task-design-5');
  assert.equal(tag.asset, 'tag-fi');
  assert.equal(tag.brand, 'essentially-dunk');
  assert.equal(tag.brandLabel, 'Essentially Dunk');
  assert.equal(tag.detailed, false);
  const video = ROWS.find(r => r.id === 'task-design-6');
  assert.equal(video.asset, 'youtube-fi');
  assert.equal(video.brandRecorded, false, 'a team name is not a newsletter');
  assert.equal(S.fromTask(task(9, { days: 0, label: 'Something new' })).asset, 'other');
});

test('usage events: copied HTML and image links, old and new metadata', () => {
  const ticker = ROWS.find(r => r.id === 'evt-e1');
  assert.deepEqual([ticker.kind, ticker.asset, ticker.brandLabel, ticker.format, ticker.name], ['html', 'ticker', 'The Huddle', 'HTML', 'Cleo Park']);
  const trivia = ROWS.find(r => r.id === 'evt-e2');
  assert.deepEqual([trivia.asset, trivia.assetLabel, trivia.brandLabel], ['trivia', 'Trivia', 'Essentially W']);
  const link = ROWS.find(r => r.id === 'evt-e3');
  assert.deepEqual([link.kind, link.asset, link.size], ['link', 'feature-image', '1200 × 675']);
  assert.equal(ROWS.find(r => r.email === 'ben@essentiallysports.com').name, 'Ben Ito');
  assert.equal(S.nameFromEmail('dana.cruz@essentiallysports.com'), 'Dana Cruz');
});

test('formats and sizes are normalised', () => {
  assert.equal(S.formatFrom('image/jpeg'), 'JPEG');
  assert.equal(S.formatFrom('', 'x.png'), 'PNG');
  assert.equal(S.formatFrom('image/png', '', 'jpg'), 'JPEG');
  assert.equal(S.normSize('1200 × 675px'), '1200 × 675');
  assert.equal(S.normSize('640x47'), '640 × 47');
  assert.equal(S.normSize(''), '');
});

// ── Aggregation ─────────────────────────────────────────────────────────────
test('summary strip: this week, 7 / 30 / 90 days, top asset and person', () => {
  const s = S.summarize(ROWS, { days: 30, now: NOW });
  // Monday 16 Nov .. Sat 21 Nov: tasks 1-3, events e1, e2, e3.
  assert.equal(s.thisWeek, 6);
  assert.equal(s.last7, 6);
  assert.equal(s.last30, 8);
  assert.equal(s.last90, 9);
  assert.equal(s.total, 8);
  assert.deepEqual([s.topAsset.key, s.topAsset.count], ['feature-image', 3]);
  assert.deepEqual([s.topPerson.key, s.topPerson.count], ['ana@essentiallysports.com', 5]);
  assert.equal(s.people, 3);
});

test('breakdowns by asset, person, newsletter and kind', () => {
  const s = S.summarize(ROWS, { days: 30, now: NOW });
  assert.deepEqual([s.byAsset[0].key, s.byAsset[0].count], ['feature-image', 3]);
  assert.deepEqual(s.byAsset.map(a => a.key).sort(), ['archive-page-fi', 'feature-image', 'section-header', 'tag-fi', 'ticker', 'trivia']);
  assert.equal(s.byAsset.reduce((sum, a) => sum + a.count, 0), s.total);
  assert.equal(s.byPerson.reduce((sum, p) => sum + p.count, 0), s.total);
  assert.deepEqual(s.byBrand.map(b => [b.label, b.count]).slice(0, 2), [['Essentially Golf', 3], ['The Huddle', 2]]);
  assert.equal(s.byBrand.reduce((sum, b) => sum + b.count, 0) + s.brandMissing, s.total);
  assert.equal(s.brandMissing, 0);
  assert.deepEqual(Object.fromEntries(s.byKind.map(k => [k.key, k.count])), { image: 5, html: 2, link: 1 });
});

test('series: daily up to 30 days, weekly above; totals match', () => {
  const d30 = S.summarize(ROWS, { days: 30, now: NOW }).series;
  assert.equal(d30.weekly, false);
  assert.equal(d30.buckets.length, 30);
  assert.equal(d30.buckets.reduce((sum, b) => sum + b.count, 0), 8);
  assert.equal(d30.buckets.at(-1).count, 2, 'today: task 1 and the ticker copy');
  const d7 = S.summarize(ROWS, { days: 7, now: NOW }).series;
  assert.equal(d7.buckets.length, 7);
  const d90 = S.summarize(ROWS, { days: 90, now: NOW }).series;
  assert.equal(d90.weekly, true);
  assert.equal(d90.buckets.length, 13);
  assert.equal(d90.buckets.reduce((sum, b) => sum + b.count, 0), 9);
  assert.ok(d90.buckets.every(b => b.weekly));
});

test('week starts on Monday; ranges include today', () => {
  assert.equal(new Date(S.weekStart(NOW)).getDay(), 1);
  assert.equal(new Date(S.weekStart(NOW)).getDate(), 16);
  const r = S.rangeFor(7, NOW);
  assert.equal(new Date(r.from).getDate(), 15);
  assert.equal(new Date(r.to).getDate(), 21);
});

// ── Filters ─────────────────────────────────────────────────────────────────
test('filters: person, asset, newsletter, not recorded, date range', () => {
  assert.equal(S.applyFilters(ROWS, { person: 'BEN@essentiallysports.com' }).length, 2);
  assert.equal(S.applyFilters(ROWS, { asset: 'feature-image' }).length, 4);
  assert.equal(S.applyFilters(ROWS, { brand: 'essentially-golf' }).length, 3);
  assert.deepEqual(S.applyFilters(ROWS, { brand: '__none' }).map(r => r.id).sort(), ['task-design-6', 'task-design-7']);
  const r7 = S.rangeFor(7, NOW);
  assert.equal(S.applyFilters(ROWS, { from: r7.from, to: r7.to }).length, 6);
  assert.equal(S.applyFilters(ROWS, { person: 'ana@essentiallysports.com', asset: 'feature-image', from: r7.from, to: r7.to }).length, 2);
});

test('search: headline, file, person, asset, newsletter, format', () => {
  assert.deepEqual(S.applyFilters(ROWS, { search: 'design 3' }).map(r => r.id), ['task-design-3']);
  assert.equal(S.applyFilters(ROWS, { search: 'es-newsletter-4' }).length, 1);
  assert.equal(S.applyFilters(ROWS, { search: 'cleo' }).length, 2);
  assert.equal(S.applyFilters(ROWS, { search: 'archive page' }).length, 1);
  assert.equal(S.applyFilters(ROWS, { search: 'huddle' }).length, 2);
  assert.equal(S.applyFilters(ROWS, { search: 'html' }).length, 2);
  assert.equal(S.applyFilters(ROWS, { search: 'nothing like this' }).length, 0);
});

test('empty data: zeros, no top asset or person, flat series', () => {
  const s = S.summarize([], { days: 30, now: NOW });
  assert.deepEqual([s.thisWeek, s.last7, s.last30, s.last90, s.total, s.people], [0, 0, 0, 0, 0, 0]);
  assert.equal(s.topAsset, null);
  assert.equal(s.topPerson, null);
  assert.deepEqual([s.byAsset.length, s.byPerson.length, s.byBrand.length], [0, 0, 0]);
  assert.equal(s.series.buckets.length, 30);
  assert.ok(s.series.buckets.every(b => b.count === 0));
  assert.deepEqual(S.combine({}), []);
  const opts = S.filterOptions([]);
  assert.equal(opts.people.length, 0);
  assert.equal(opts.assets.length, Object.keys(S.ASSETS).length, 'every known asset is offered');
});

test('filter options list people, assets and recorded newsletters', () => {
  const opts = S.filterOptions(ROWS);
  assert.deepEqual(opts.people.map(p => p.label), ['Ana Ruiz', 'Ben Ito', 'Cleo Park']);
  assert.ok(opts.brands.some(b => b.key === 'essentially-golf' && b.label === 'Essentially Golf'));
  assert.ok(opts.assets.some(a => a.key === 'archive-page-fi'));
});

// ── 2. index.html: export metadata ──────────────────────────────────────────
function block(source, start) {
  const at = source.indexOf(start);
  assert.ok(at >= 0, `missing ${start}`);
  let depth = 0;
  const open = source.slice(at).search(/[{[]/) + at;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{' || source[i] === '[') depth += 1;
    if (source[i] === '}' || source[i] === ']') depth -= 1;
    if (depth === 0) return source.slice(at, i + 1);
  }
  throw new Error(`unclosed ${start}`);
}

test('the stats module knows every Newsletter asset and its label', () => {
  const assets = block(INDEX, 'const NEWSLETTER_ASSET_TYPES = {');
  const found = {};
  for (const m of assets.matchAll(/^ {2}'?([a-z0-9-]+)'?: \{\n {4}label: '([^']+)'/gm)) found[m[1]] = m[2];
  assert.ok(Object.keys(found).length >= 11, 'asset list parsed');
  assert.deepEqual(found, S.ASSETS);
});

test('the stats module knows every newsletter brand id and label', () => {
  const brands = {};
  for (const m of block(INDEX, 'const NEWSLETTER_BRANDS = [').matchAll(/\bid: '([a-z0-9-]+)',\s*label: '([^']+)'/g)) brands[m[1]] = m[2];
  assert.ok(Object.keys(brands).length >= 15, 'brand list parsed');
  assert.deepEqual(brands, S.BRANDS);
  ['const TICKER_BRANDS = [', 'const TRIVIA_BRANDS = ['].forEach(start => {
    for (const m of block(INDEX, start).matchAll(/\bid: '([a-z0-9-]+)'/g)) assert.ok(S.BRANDS[m[1]], `brand ${m[1]} has a label`);
  });
});

function runInfo(context) {
  const fnSource = block(INDEX, 'function newsletterExportInfo() {');
  const metaSource = block(INDEX, 'function newsletterTrackMeta() {');
  const sandbox = {
    DEFAULT_NEWSLETTER_ASSET: 'youtube-fi',
    NEWSLETTER_ASSET_TYPES: { 'feature-image': { label: 'Feature Image' }, ticker: { label: 'Financial Ticker' }, widgets: { label: 'Desktop News Layout' }, trivia: { label: 'Trivia' } },
    NEWSLETTER_BRANDS: [{ id: 'essentiallysports', label: 'EssentiallySports' }, { id: 'essentially-golf', label: 'Essentially Golf' }, { id: 'the-huddle', label: 'The Huddle' }],
    TICKER_BRANDS: [{ id: 'essentiallysports', label: 'EssentiallySports' }, { id: 'es-golf-evening', label: 'Essentially Golf (Evening)' }],
    TRIVIA_BRANDS: [{ id: 'she-got-game', label: 'Essentially W' }],
    WIDGET_BRAND_IDS: ['she-got-game'],
    triviaBuilderState: null,
    tickerBuilderState: null,
    widgetBuilderState: null,
    activeWorkspace: 'newsletter',
    state: { newsletterBrand: 'essentiallysports' },
    workspaceStates: { newsletter: { newsletterBrand: 'essentiallysports' } },
    ...context,
  };
  vm.runInNewContext(`${fnSource}\n${metaSource}\nresult = { info: newsletterExportInfo(), meta: newsletterTrackMeta() };`, sandbox);
  return sandbox.result;
}

test('newsletterExportInfo: image assets use the workspace brand', () => {
  const { info, meta } = runInfo({ activeNewsletterAsset: 'feature-image', state: { newsletterBrand: 'essentially-golf' } });
  assert.deepEqual({ ...info }, { newsletterAsset: 'feature-image', newsletterAssetLabel: 'Feature Image', newsletterBrand: 'essentially-golf', newsletterBrandLabel: 'Essentially Golf' });
  assert.deepEqual({ ...meta }, { asset: 'feature-image', template: 'Feature Image', brand: 'essentially-golf', brandLabel: 'Essentially Golf' });
});

test('newsletterExportInfo: the HTML builders use their own brand', () => {
  assert.equal(runInfo({ activeNewsletterAsset: 'ticker', tickerBuilderState: { brandId: 'es-golf-evening' } }).info.newsletterBrandLabel, 'Essentially Golf (Evening)');
  assert.equal(runInfo({ activeNewsletterAsset: 'trivia' }).info.newsletterBrand, 'she-got-game');
  assert.equal(runInfo({ activeNewsletterAsset: 'widgets', widgetBuilderState: { brandId: 'the-huddle' } }).info.newsletterBrandLabel, 'The Huddle');
});

test('newsletterExportInfo never throws and sends nothing personal', () => {
  const { info } = runInfo({ activeNewsletterAsset: 'feature-image', NEWSLETTER_BRANDS: null });
  assert.deepEqual({ ...info }, {});
  const keys = Object.keys(runInfo({ activeNewsletterAsset: 'feature-image' }).info);
  assert.deepEqual(keys.sort(), ['newsletterAsset', 'newsletterAssetLabel', 'newsletterBrand', 'newsletterBrandLabel']);
});

test('Newsletter exports send the new metadata; only tracking calls use it', () => {
  const download = block(INDEX, 'function downloadImage() {');
  assert.match(download, /\.\.\.\(activeWorkspace === 'newsletter' \? \{\s*\.\.\.newsletterExportInfo\(\),\s*format: \/png\/i\.test\(workspace\.exportType\) \? 'PNG' : 'JPEG',\s*\} : \{\}\)/);
  // Both go through FrameUpTrack.exported (Dashboard -> Exports): size from width / height.
  assert.match(INDEX, /format: 'image-link', dest: 'link', label: name, width: plan\.width, height: plan\.height,[^\n]*meta: \{ \.\.\.\(activeWorkspace === 'newsletter' \? newsletterTrackMeta\(\) : \{\}\)/);
  assert.match(INDEX, /format: 'widget-html', dest: 'clipboard', label: NEWSLETTER_ASSET_TYPES\?\.\[activeNewsletterAsset\]\?\.label \|\| activeNewsletterAsset \|\| 'widget',[^\n]*meta: \{ brand: utmContext\.brand, \.\.\.newsletterTrackMeta\(\), format: 'HTML' \}/);
  // Used nowhere else: drawing, file names and copied HTML are untouched.
  const uses = [...INDEX.matchAll(/newsletter(ExportInfo|TrackMeta)\(\)/g)].length;
  assert.equal(uses, 6, 'two definitions, newsletterTrackMeta calling newsletterExportInfo, and the three tracking calls');
  // The UTM context (it decorates copied links) still uses the old brand.
  assert.match(INDEX, /const utmContext = \{ brand: state\.newsletterBrand \|\| 'essentiallysports', designId: activeNewsletterAsset \|\| 'widget', workspace: 'newsletter' \};/);
});

// ── 3. Wiring ───────────────────────────────────────────────────────────────
test('dashboard-data.js reads the new fields and the usage log', () => {
  ['meta_nl_asset:metadata->>newsletterAsset', 'meta_nl_brand:metadata->>newsletterBrand', 'meta_nl_brand_label:metadata->>newsletterBrandLabel', 'meta_format:metadata->>format']
    .forEach(column => assert.ok(DATA.includes(`'${column}'`), column));
  assert.match(DATA, /newsletterAsset: row\.meta_nl_asset/);
  assert.match(DATA, /async function fetchUsageEvents\(/);
  assert.match(DATA, /\n {4}fetchUsageEvents,\n/);
  assert.match(DATA, /asset: record\.metadata\?\.newsletterAsset \|\| ''/);
  assert.ok(!/fetchUsageEvents[\s\S]{0,1200}\.(insert|upsert|update|delete)\(/.test(DATA.slice(DATA.indexOf('async function fetchUsageEvents'))), 'read only');
});

test('dashboard.html: Newsletter tab, section, scripts and preview hook', () => {
  assert.match(DASH, /<button type="button" data-dashboard-view="newsletter">[\s\S]*?<span>Newsletter<\/span><\/button>/);
  assert.match(DASH, /<section class="dov newsletter-view" id="newsletter-view" data-view-section="newsletter" aria-labelledby="newsletter-title" hidden><\/section>/);
  assert.match(DASH, /DASHBOARD_VIEWS = new Set\(\[[^\]]*'newsletter'/);
  ['frameup-newsletter-view.css', 'frameup-newsletter-stats.js', 'frameup-newsletter-view.js'].forEach(file => assert.match(DASH, new RegExp(`${file.replace('.', '\\.')}\\?v=[^"]+"`)));
  assert.ok(DASH.indexOf('frameup-newsletter-stats.js') < DASH.indexOf('frameup-newsletter-view.js'));
  assert.match(DASH, /window\.FrameUpDashboardPreviews = Object\.freeze\(\{ hydrate: \(\) => hydrateExportPreviews\(\) \}\)/);
  assert.match(DASH, /window\.FrameUpNewsletterView\?\.render\?\.\(\);/);
});

test('the view escapes text, uses tokens and no purple', () => {
  const view = read('frameup-newsletter-view.js');
  const css = read('frameup-newsletter-view.css');
  assert.match(view, /const esc = value =>/);
  assert.ok(!/innerHTML\s*=\s*[^`]*\+\s*row\./.test(view));
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(css), 'no hard-coded colours');
  assert.ok(!/purple|violet|#8b5cf6|#7c3aed/i.test(css + view));
  assert.ok(!/font-family:\s*(?!var)/.test(css), 'fonts come from tokens');
});

console.log(`\n${passed} newsletter dashboard tests passed`);
