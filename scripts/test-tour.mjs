#!/usr/bin/env node
// Tours: release-manifest comparison, generated What's new tours, step
// skipping when a target is missing (stubbed DOM), tour data sanity, page
// wiring, the version endpoint and the release-note CLI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}\n   ${error.message}`);
    process.exitCode = 1;
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}\n   ${error.message}`);
    process.exitCode = 1;
  }
}

// ─── Stubbed DOM: just enough for the engine's target lookup ─────────────
function fakeElement({ width = 100, height = 40, hidden = false, display = 'block', visibility = 'visible', connected = true } = {}) {
  return {
    isConnected: connected,
    hidden,
    style: { display, visibility },
    getBoundingClientRect: () => ({ top: 10, left: 10, width, height, right: 10 + width, bottom: 10 + height }),
    closest: selector => (hidden && /\[hidden\]/.test(selector) ? {} : null),
  };
}
function fakeRoot(map) {
  return { querySelectorAll: selector => (map[selector] || []) };
}
globalThis.getComputedStyle = el => el.style;
globalThis.matchMedia = query => ({ matches: query === '(min-width: 901px)' });

const Tour = require('../frameup-tour.js');
const Updates = require('../tours/updates.js');
const { resolveTarget, isVisible, stepApplies, findStep, samePage } = Tour._internals;

// ─── Engine ──────────────────────────────────────────────────────────────
test('isVisible: rendered element yes; zero size, display none, hidden ancestor no', () => {
  assert.equal(isVisible(fakeElement()), true);
  assert.equal(isVisible(fakeElement({ width: 0 })), false);
  assert.equal(isVisible(fakeElement({ display: 'none' })), false);
  assert.equal(isVisible(fakeElement({ visibility: 'hidden' })), false);
  assert.equal(isVisible(fakeElement({ hidden: true })), false);
  assert.equal(isVisible(fakeElement({ connected: false })), false);
  assert.equal(isVisible(null), false);
});

test('resolveTarget: first visible match across a selector list', () => {
  const visible = fakeElement();
  const root = fakeRoot({ '.gone': [], '.hidden': [fakeElement({ display: 'none' })], '.here': [fakeElement({ width: 0 }), visible] });
  assert.equal(resolveTarget(['.gone', '.hidden', '.here'], root), visible);
  assert.equal(resolveTarget('.gone', root), null);
  assert.equal(resolveTarget(null, root), null);
  // A broken selector is treated as missing, not a crash.
  const throwing = { querySelectorAll: () => { throw new Error('bad selector'); } };
  assert.equal(resolveTarget('::nope', throwing), null);
});

test('step skipping: missing targets, media and when() are passed over in both directions', () => {
  const root = fakeRoot({ '#a': [fakeElement()], '#c': [fakeElement()] });
  const steps = [
    { target: '#a' },
    { target: '#missing' },              // target not on the page
    { target: '#c', media: '(max-width: 900px)' }, // phone only (we're "desktop")
    { target: '#c', when: () => false }, // admin-only style condition
    { target: '#c' },
    { title: 'centred, no target' },
  ];
  const usable = step => stepApplies(step) && (!step.target || Boolean(resolveTarget(step.target, root)));
  assert.equal(findStep(steps, 1, +1, usable), 4, 'next from #a skips the missing, phone-only and when=false steps');
  assert.equal(findStep(steps, 3, -1, usable), 0, 'back from the end also skips them');
  assert.equal(findStep(steps, 5, +1, usable), 5, 'a step without a target always shows');
  assert.equal(findStep(steps, 6, +1, usable), -1, 'running off the end ends the tour');
  assert.equal(stepApplies({ when: () => { throw new Error('x'); } }), false, 'a throwing when() skips the step');
});

test('samePage / pageFile: steps match by file, query and hash ignored', () => {
  const loc = { pathname: '/generate.html' };
  assert.equal(Tour.pageFile(loc), 'generate.html');
  assert.equal(Tour.pageFile({ pathname: '/' }), 'index.html');
  assert.equal(Tour.pageFile({ pathname: '/ai-page/profile.html' }), 'ai-page/profile.html');
  assert.equal(samePage('generate.html?view=trends', loc), true);
  assert.equal(samePage('video-ads.html', loc), false);
  assert.equal(samePage(undefined, loc), true, 'no page = any page');
});

test('register / get / list', () => {
  Tour.register({ id: 'unit', label: 'Unit', steps: [{ title: 'x' }] });
  assert.equal(Tour.get('unit').label, 'Unit');
  assert.ok(Tour.list().some(tour => tour.id === 'unit'));
  assert.equal(Tour.register({ steps: [] }), null, 'a tour needs an id');
});

// ─── Release manifest comparison ─────────────────────────────────────────
const entries = [
  { id: '2026-11-17-tours', date: '2026-11-17', title: 'Tours', items: [] },
  { id: '2026-11-15-ai-studio', date: '2026-11-15', title: 'AI Studio', items: [] },
  { id: '2026-11-12-trends', date: '2026-11-12', title: 'Trends', items: [] },
];

test('isNewer: first visit, same id, older seen id, unknown seen id', () => {
  assert.equal(Updates.isNewer('2026-11-17-tours', '', entries), false, 'never saw anything: Welcome tour instead');
  assert.equal(Updates.isNewer('2026-11-17-tours', '2026-11-17-tours', entries), false);
  assert.equal(Updates.isNewer('2026-11-17-tours', '2026-11-12-trends', entries), true);
  assert.equal(Updates.isNewer('2026-11-15-ai-studio', '2026-11-17-tours', entries), false, 'seen something newer');
  assert.equal(Updates.isNewer('2026-11-17-tours', '2026-10-01-removed-note', entries), true, 'removed id: compare dates');
  assert.equal(Updates.isNewer('2026-11-17-tours', '2026-12-01-future', entries), false);
});

test('pendingEntry: newest unseen and fresh only; drafts ignored', () => {
  const now = new Date('2026-11-18T12:00:00').getTime();
  assert.equal(Updates.pendingEntry({ entries }, '2026-11-15-ai-studio', now).id, '2026-11-17-tours');
  assert.equal(Updates.pendingEntry({ entries }, '2026-11-17-tours', now), null);
  assert.equal(Updates.pendingEntry({ entries }, '', now), null);
  const later = new Date('2027-01-30T12:00:00').getTime();
  assert.equal(Updates.pendingEntry({ entries }, '2026-11-15-ai-studio', later), null, 'older than 30 days: no toast');
  const withDraft = [{ id: '2026-11-18-draft', date: '2026-11-18', draft: true, items: [] }, ...entries];
  assert.equal(Updates.pendingEntry({ entries: withDraft }, '2026-11-15-ai-studio', now).id, '2026-11-17-tours');
  assert.equal(Updates.pendingEntry([...entries].reverse(), '2026-11-15-ai-studio', now).id, '2026-11-17-tours', 'order in the file does not matter');
});

test('buildUpdateTour: one step per item, this page first, centred fallback, nav target', () => {
  const tour = Updates.buildUpdateTour({
    id: 'x', title: 'Release', items: [
      { title: 'On Generate', text: 'a', page: 'generate.html', target: '#gen-form' },
      { title: 'Anywhere', text: 'b' },
      { title: 'Here', text: 'c', page: 'index.html', target: '#frame-instagram' },
      { title: 'Page but no target', text: 'd', page: 'video-ads.html' },
      ['Legacy', 'old [title, text] shape'],
    ],
  }, 'index.html');
  assert.equal(tour.kicker, "What's new");
  assert.deepEqual(tour.steps.map(step => step.title), ['Anywhere', 'Here', 'Page but no target', 'Legacy', 'On Generate']);
  assert.ok(tour.steps.every(step => step.fallback === 'center'), 'missing targets still show, centred');
  const generate = tour.steps.find(step => step.title === 'On Generate');
  assert.equal(generate.page, 'generate.html');
  assert.equal(generate.pageLabel, 'Generate');
  assert.match(generate.navTarget, /generate\.html/);
  assert.equal(tour.steps.find(step => step.title === 'Page but no target').page, undefined, 'no target: never navigates');
});

test('commitHeadline: first line, trimmed', () => {
  assert.equal(Updates.commitHeadline('Video Ads: faster export\n\nlong body'), 'Video Ads: faster export');
  assert.equal(Updates.commitHeadline('x'.repeat(200)).length, 120);
});

// ─── The real manifest and tour data ────────────────────────────────────
test('tours/updates.json: valid, unique ids, newest first, every item has copy', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'tours/updates.json'), 'utf8'));
  const list = manifest.entries;
  assert.ok(list.length > 0);
  assert.equal(new Set(list.map(entry => entry.id)).size, list.length, 'ids are unique');
  list.forEach(entry => {
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/, `${entry.id} date`);
    assert.ok(entry.id.startsWith(entry.date), `${entry.id} starts with its date`);
    assert.ok(entry.title, `${entry.id} has a title`);
    assert.ok(entry.items.length, `${entry.id} has items`);
    entry.items.forEach(item => assert.ok(item.title && item.text, `${entry.id} item has title and text`));
  });
  const dates = list.map(entry => entry.date);
  assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
  assert.equal(list.filter(entry => entry.draft).length, 0, 'no draft notes committed');
});

test('tours/tours.js: Welcome + page tours register; copy stays short', () => {
  const registered = [];
  globalThis.window = { FrameUpTour: { register: def => registered.push(def) }, location: { hash: '' } };
  require('../tours/tours.js');
  delete globalThis.window;
  const ids = registered.map(def => def.id);
  ['welcome', 'generate', 'trends', 'video-ads', 'editor'].forEach(id => assert.ok(ids.includes(id), `${id} registered`));
  registered.forEach(def => def.steps.forEach(step => {
    assert.ok(step.title, `${def.id}: every step has a title`);
    assert.ok(!step.text || step.text.length <= 90, `${def.id} "${step.title}": text is one short line (${step.text?.length})`);
  }));
  const welcome = registered.find(def => def.id === 'welcome');
  const pages = [...new Set(welcome.steps.map(step => step.page).filter(Boolean))];
  assert.deepEqual(pages, ['index.html', 'generate.html', 'video-ads.html'], 'Welcome visits Home, Generate, Video Ads in order');
});

test('every app-shell page loads the tour CSS + scripts right after app-shell.js', () => {
  const pages = ['index.html', 'generate.html', 'video-ads.html', 'reels.html', 'gallery.html', 'dashboard.html',
    'design-request.html', 'tool-feedback.html', 'how-frameup-works.html', 'design-system.html',
    'ai-page/profile.html', 'ai-page/settings.html', 'ai-page/logout.html'];
  pages.forEach(page => {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const pre = page.startsWith('ai-page/') ? '../' : '';
    const order = ['app-shell.js', 'frameup-tour.css', 'frameup-tour.js', 'tours/updates.js', 'tours/tours.js', 'tours/tour-launcher.js']
      .map(file => html.indexOf(`${pre}${file}?v=`));
    order.forEach((at, i) => assert.ok(at > -1, `${page} loads #${i}`));
    assert.deepEqual([...order].sort((a, b) => a - b), order, `${page}: in order`);
  });
});

test('app-shell.js reads release notes from tours/updates.json (no inline list)', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'app-shell.js'), 'utf8');
  assert.match(shell, /tours\/updates\.json/);
  assert.doesNotMatch(shell, /const WHATS_NEW = \[/);
  assert.match(shell, /frameup:whatsnew-open/);
});

// ─── Version endpoint ───────────────────────────────────────────────────
test('version.js: public build info only, short sha, first message line', () => {
  const { versionInfo } = require('../netlify/functions/version.js');
  const info = versionInfo({ VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890', VERCEL_GIT_COMMIT_MESSAGE: 'Gallery: filters\n\nbody', SECRET: 'x' });
  assert.deepEqual(info, { sha: 'abcdef123456', message: 'Gallery: filters', deployedAt: null });
  assert.equal(versionInfo({ COMMIT_REF: 'fff000' }).sha, 'fff000', 'Netlify fallback');
  assert.equal(versionInfo({}).sha, '');
});

await testAsync('version.js: signed-out requests are refused', async () => {
  const { handler } = require('../netlify/functions/version.js');
  const result = await handler({ httpMethod: 'GET', headers: {} });
  assert.ok(result.statusCode >= 400, `status ${result.statusCode}`);
  assert.doesNotMatch(result.body, /sha/);
});

// ─── Release-note CLI ───────────────────────────────────────────────────
const cli = await import('./add-release-note.mjs');

test('CLI: commit subjects become grouped, readable items', () => {
  const items = cli.itemsFromCommits([
    { sha: 'a1', subject: 'Video Ads: download X clips without a Referer' },
    { sha: 'a2', subject: 'Video Ads: space the research error hint' },
    { sha: 'a3', subject: 'Merge branch main' },
    { sha: 'a4', subject: 'Bump cache keys' },
    { sha: 'a5', subject: 'Gallery filters by workspace' },
  ]);
  assert.deepEqual(items, [
    { title: 'Video Ads', text: 'Download X clips without a Referer. Space the research error hint.', page: 'video-ads.html' },
    { title: 'Gallery filters by workspace', text: '' },
  ]);
});

test('CLI: entry is a draft with a unique id and the HEAD commit', () => {
  const entry = cli.buildEntry({ commits: [{ subject: 'Generate: faster' }], date: '2026-11-20', head: 'abc1234', existingIds: ['2026-11-20-generate'] });
  assert.equal(entry.id, '2026-11-20-generate-2');
  assert.equal(entry.draft, true);
  assert.equal(entry.commit, 'abc1234');
  assert.equal(entry.items[0].page, 'generate.html');
  assert.equal(cli.buildEntry({ commits: [], date: '2026-11-20', publish: true, title: 'Hello' }).draft, undefined);
  assert.throws(() => cli.parseArgs(['--nope']), /Unknown option/);
});

test('CLI end to end: appends a draft from git log since the last note', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frameup-notes-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(dir, 'a.txt'), '1');
    git('add', '.');
    git('commit', '-qm', 'Start');
    const start = git('rev-parse', '--short', 'HEAD');
    const file = path.join(dir, 'updates.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [{ id: '2026-11-01-old', date: '2026-11-01', title: 'Old', commit: start, items: [{ title: 'Old', text: 'Old.' }] }] }));
    for (const subject of ['Gallery: workspace filter', 'Gallery: landscape thumbs', 'Fix typo in docs']) {
      fs.appendFileSync(path.join(dir, 'a.txt'), subject);
      git('commit', '-qam', subject);
    }
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/add-release-note.mjs'), '--file', file, '--cwd', dir, '--date', '2026-11-20'], { encoding: 'utf8' });
    assert.match(out, /from 3 commits since/);
    const written = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(written.entries.length, 2);
    const entry = written.entries[0];
    assert.equal(entry.id, '2026-11-20-gallery');
    assert.equal(entry.draft, true);
    assert.equal(entry.commit, git('rev-parse', '--short', 'HEAD'));
    assert.deepEqual(entry.items[0], { title: 'Gallery', text: 'Workspace filter. Landscape thumbs.', page: 'gallery.html' });
    assert.equal(entry.items[1].title, 'Fix typo in docs');
    assert.equal(written.entries[1].id, '2026-11-01-old', 'older notes kept, newest first');
    // A dry run prints and leaves the file alone.
    const before = fs.readFileSync(file, 'utf8');
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/add-release-note.mjs'), '--file', file, '--cwd', dir, '--dry-run'], { encoding: 'utf8' });
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(process.exitCode ? `\nTour tests failed (${passed} passed).` : `\nAll ${passed} tour tests passed.`);
