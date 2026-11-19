// Home "Today" (frameup-home-today.js): the pure helpers behind the mission
// control layout, and the markup contract in index.html. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const H = require('../frameup-home-today.js');
const TL = require('../trends-logic.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; } catch (error) { console.error(`FAIL ${name}`); throw error; }
}

const NOW = new Date(2026, 10, 18, 15, 0, 0).getTime();
const HOUR = 3600000;
const DAY = 24 * HOUR;
const iso = ms => new Date(ms).toISOString();

test('greeting uses the first name', () => {
  assert.equal(H.firstName('Suhail Quraishi'), 'Suhail');
  assert.equal(H.firstName('', 'suhail.quraishi@essentiallysports.com'), 'Suhail');
  assert.equal(H.firstName('', ''), '');
  assert.equal(H.firstName('123'), '');
  assert.equal(H.greeting(new Date(2026, 10, 18, 3)), 'Working late');
  assert.equal(H.greeting(new Date(2026, 10, 18, 14)), 'Good afternoon');
});

const trend = (id, category, extra = {}) => ({ id, category, title: `Story ${id}`, publishedAt: iso(NOW - HOUR), rank: 1, fit: { score: 50 }, ...extra });
test('the spotlight is the best story and is never repeated below', () => {
  const items = [trend('a', 'golf', { rank: 1 }), trend('b', 'nfl', { rank: 3, signal: 'hot' }), trend('c', 'nfl', { rank: 2 }), trend('d', 'nfl', { rank: 1.5 }), trend('e', 'mlb', { rank: 0.5 })];
  const plan = H.planTrends(items, 'all', { n: 5, logic: TL });
  assert.equal(plan.spotlight.id, 'b');
  assert.ok(!plan.rows.some(item => item.id === 'b'));
  // All sports: at most two per sport.
  assert.ok(plan.rows.filter(item => item.category === 'nfl').length <= 2);
  const nfl = H.planTrends(items, 'nfl', { n: 5, logic: TL });
  assert.deepEqual(nfl.rows.map(item => item.id), ['c', 'd']);
  assert.equal(H.planTrends([], 'all', { logic: TL }).spotlight, null);
  // Works without TrendsLogic too.
  assert.ok(H.planTrends(items, 'all', { logic: null }).spotlight);
});

test('Generate links carry only the story (autorun off)', () => {
  const href = H.trendHref({ title: 'Mahomes says knee "feels great"', category: 'nfl', related: [] }, 'NFL', { logic: TL });
  assert.match(href, /^generate\.html\?brief=/);
  assert.match(href, /&autorun=0$/);
  const brief = decodeURIComponent(href.split('brief=')[1].split('&')[0]);
  assert.ok(brief.includes('Mahomes says knee "feels great"'));
  assert.ok(!/Sport:/.test(brief), 'gen v4: no Sport line in the brief');
  assert.match(href, /&league=NFL&/, 'the league rides beside the brief');
});

test('team pulse counts the last 7 days from the Gallery list only', () => {
  const me = { name: 'Suhail Quraishi', email: 'suhail@essentiallysports.com' };
  const items = [
    { creator: 'Suhail Quraishi', variant: 'Cover Image', exportedAt: iso(NOW - HOUR) },
    { creator: 'Ana Ruiz', variant: 'Cover Image', exportedAt: iso(NOW - 2 * HOUR) },
    { creator: 'Suhail Quraishi', variant: 'Quote Post', exportedAt: iso(NOW - DAY) },
    { creator: 'suhail', variant: 'Quote Post', exportedAt: iso(NOW - 2 * DAY) },
    { creator: 'Ben Cole', variant: 'Cover Image', exportedAt: iso(NOW - 10 * DAY) },
  ];
  const p = H.teamPulse(items, { now: NOW, me });
  assert.equal(p.total, 4);
  assert.equal(p.today, 2);
  assert.equal(p.days.length, 7);
  assert.equal(p.days.reduce((sum, d) => sum + d.count, 0), 4);
  assert.equal(p.mine, 3);
  assert.equal(p.streak, 3);
  assert.deepEqual(p.formats[0], { label: 'Cover Image', count: 2 });
  assert.equal(p.atLeast, false);
  // A full page that is all inside the week is a floor ("48+").
  const full = Array.from({ length: 48 }, (_, i) => ({ creator: 'Ana Ruiz', exportedAt: iso(NOW - i * HOUR) }));
  assert.equal(H.teamPulse(full, { now: NOW, limit: 48 }).atLeast, true);
  assert.equal(H.teamPulse([], { now: NOW }).total, 0);
  assert.equal(H.teamPulse(items, { now: NOW }).mine, 0);
});

test('continue merges tools, newest first, without duplicates', () => {
  const list = H.continueItems({
    now: NOW,
    local: [{ id: 'x1', title: 'Exported here', workspace: 'instagram', savedAt: NOW - 3 * HOUR, thumb: 'data:image/webp;base64,AA' }],
    cloud: [
      { draft_key: 'design:x1', title: 'Exported here', workspace: 'instagram', updated_at: iso(NOW - 3 * HOUR) },
      { draft_key: 'editor', workspace: 'newsletter', updated_at: iso(NOW - HOUR) },
      { draft_key: 'design:y', title: 'From my laptop', workspace: 'youtube', updated_at: iso(NOW - 5 * HOUR) },
    ],
    reels: [{ id: 'r1', title: 'Bills defense', status: 'draft', updatedAt: NOW - 2 * HOUR, timeline: { durationMs: 41000 } }],
  });
  assert.deepEqual(list.map(item => item.kind), ['cloud-editor', 'reel', 'local', 'cloud']);
  assert.equal(list[0].title, 'Work in progress');
  assert.equal(list[1].meta, 'Reels Studio · Draft · 41 s');
  assert.ok(list[2].thumb.startsWith('data:'));
  assert.equal(H.continueItems({}, 5).length, 0);
});

test('tool hints come from this browser only', () => {
  const hints = H.toolHints({
    now: NOW,
    briefs: ['Caitlin Clark scores 30 PTS 9 AST 6 REB against the Sky in a long game'],
    reels: [{ id: 'r', title: 'Exported one', status: 'exported', updatedAt: NOW }, { id: 's', title: 'Draft reel', status: 'draft', updatedAt: NOW - HOUR }],
    videoDefaults: { last: 'the-huddle' },
    recent: [{ tool: 'reels', title: 'x', at: NOW }, { tool: 'editor', title: 'Chiefs 9-2', at: NOW - 2 * HOUR, workspace: 'instagram' }],
  });
  assert.ok(hints.generate.text.startsWith('Last brief: Caitlin Clark'));
  assert.ok(hints.generate.text.length <= 'Last brief: '.length + 44);
  assert.equal(hints.reels.text, 'Continue: Draft reel');
  assert.equal(hints.video.text, 'Last newsletter: The Huddle');
  assert.equal(hints.editor.workspace, 'instagram');
  assert.deepEqual(H.toolHints({}), {});
});

test('summary line uses real counts only', () => {
  assert.equal(H.summaryLine({ trends: 12, today: 1, inProgress: 3 }), '12 stories trending · 1 post shipped by the team today · 3 things to pick up');
  assert.match(H.summaryLine({}), /What’s hot/);
});

test('index.html: Today markup, no request entry points, cache keys', () => {
  const html = read('index.html');
  const start = html.indexOf('<section class="home-today"');
  const section = html.slice(start, html.indexOf('</section>', start));
  ['spotlight', 'trends', 'continue', 'exports', 'pulse', 'requests'].forEach(id => assert.ok(section.includes(`data-today="${id}"`), id));
  ['generate', 'reels', 'video', 'editor'].forEach(id => assert.ok(section.includes(`data-today-tool="${id}"`), id));
  assert.ok(!section.includes('design-request.html'), 'no Request a design launcher');
  assert.match(section, /data-today="requests"[^>]*hidden/);
  assert.ok(!html.includes('id="home-recent"'), 'Jump back in is folded into Continue');
  assert.match(html, /trends-logic\.js\?v=[\w-]+" defer><\/script>\s*<script src="frameup-home-today\.js\?v=[\w-]+" defer>/);
  assert.match(html, /frameup-home-today\.css\?v=[\w-]+/);
  const js = read('frameup-home-today.js');
  assert.match(js, /FrameUpFeatures\?\.requests !== true\) return/);
});

test('CSS: no purple, dark mode, reduced motion', () => {
  const css = read('frameup-home-today.css');
  assert.ok(!/purple|#(?:8b5cf6|7c3aed|a855f7|6d28d9)/i.test(css));
  assert.match(css, /html\[data-theme="dark"\] \.home-today \{/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

console.log(`home-today: ${passed} tests passed`);
