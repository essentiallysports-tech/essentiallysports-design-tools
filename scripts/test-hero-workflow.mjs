// Team workflow heroes: request "Next step", Gallery filters and "Make
// another like this", Dashboard "Needs attention", Home "Today" helpers,
// date-driven sidebar NEW tags and the presence-heartbeat throttle.
// No network: everything here is pure or read from source.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const L = require('../request-lifecycle.js');
const Q = require('../frameup-gallery-query.js');
const I = require('../dashboard-insights.js');
const H = require('../frameup-home-today.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; } catch (error) { console.error(`FAIL ${name}`); throw error; }
}

const NOW = Date.parse('2026-11-18T12:00:00Z');
const DAY = 86400000;
const designer = { email: 'd@essentiallysports.com', isDesigner: true };
const admin = { email: 'a@essentiallysports.com', isAdmin: true };
const requester = { email: 'r@essentiallysports.com' };
const req = extra => ({ status: 'Backlog', requesterEmail: requester.email, assignedTo: '', ...extra });

// ── Request next step ───────────────────────────────────────────────────
test('designer sees claim on an unassigned request', () => {
  const step = L.nextStep(req(), designer, { now: NOW });
  assert.equal(step.key, 'unassigned');
  assert.equal(step.action, 'claim');
  assert.equal(step.tone, 'act');
});
test('admin is asked to assign, not claim', () => {
  assert.equal(L.nextStep(req(), admin, { now: NOW }).action, 'assign');
});
test('assignee walks start → attach → send → done', () => {
  const mine = { assignedTo: designer.email };
  assert.deepEqual(pick(L.nextStep(req({ ...mine, status: 'Assigned' }), designer, { now: NOW })), ['mine-start', 'start', 'Doing']);
  assert.deepEqual(pick(L.nextStep(req({ ...mine, status: 'Doing' }), designer, { now: NOW })), ['mine-attach', 'attach', '']);
  assert.deepEqual(pick(L.nextStep(req({ ...mine, status: 'Doing' }), designer, { now: NOW, deliveries: 1 })), ['mine-send', 'review', 'Review']);
  assert.deepEqual(pick(L.nextStep(req({ ...mine, status: 'Review' }), designer, { now: NOW })), ['mine-review', 'done', 'Done']);
});
test('every offered status move is one the rules allow', () => {
  const statuses = L.STATUSES;
  [designer, admin].forEach(user => statuses.forEach(status => [0, 2].forEach(deliveries => {
    const request = req({ status, assignedTo: user.email });
    const step = L.nextStep(request, user, { now: NOW, deliveries });
    if (step.status) assert.ok(L.checkStatusChange(request, user, step.status).ok, `${user.email} ${status} → ${step.status}`);
  })));
});
test('someone else’s request: nothing to do', () => {
  const step = L.nextStep(req({ status: 'Doing', assignedTo: 'x@essentiallysports.com' }), designer, { now: NOW });
  assert.equal(step.key, 'with-someone');
  assert.equal(step.action, '');
});
test('requester waits, then is asked to check the review', () => {
  assert.equal(L.nextStep(req(), requester, { now: NOW }).key, 'requester-new');
  assert.equal(L.nextStep(req({ status: 'Assigned', assignedTo: designer.email }), requester, { now: NOW }).key, 'requester-assigned');
  const review = L.nextStep(req({ status: 'Review', assignedTo: designer.email }), requester, { now: NOW });
  assert.equal(review.key, 'requester-review');
  assert.equal(review.action, 'comment');
});
test('overdue turns the tone to warn; closed requests are calm', () => {
  const late = L.nextStep(req({ designDueAt: new Date(NOW - DAY).toISOString() }), designer, { now: NOW });
  assert.equal(late.tone, 'warn');
  assert.equal(late.overdue, true);
  assert.equal(L.nextStep(req({ status: 'Done', designDueAt: new Date(NOW - DAY).toISOString() }), designer, { now: NOW }).tone, 'good');
  assert.equal(L.nextStep(req({ status: 'Declined' }), requester, { now: NOW }).tone, 'muted');
});
test('staff who filed a request are asked to check its review', () => {
  const own = req({ status: 'Review', requesterEmail: admin.email, assignedTo: designer.email });
  assert.equal(L.nextStep(own, admin, { now: NOW }).key, 'requester-review');
});
function pick(step) { return [step.key, step.action, step.status]; }

// ── Gallery query ───────────────────────────────────────────────────────
const items = [
  { id: '1', title: 'Scheffler wins the Masters', team: 'PGA Tour', sport: 'Golf', creator: 'Priya', variant: 'Quote', workspace: 'Social Media', filename: 'a.png' },
  { id: '2', title: 'Chiefs clinch', team: 'Kansas City Chiefs', sport: 'NFL', creator: 'Sam', variant: 'Player Stats', workspace: 'Social Media' },
  { id: '3', title: 'Weekly header', creator: 'Priya', variant: 'Header', workspace: 'Newsletter' },
];
test('URL state round-trips and keeps other params', () => {
  const state = { query: 'masters', workspace: 'Social Media', type: 'Quote', person: 'Priya', posted: 'not' };
  const search = Q.writeState(state, '?open=abc');
  assert.match(search, /open=abc/);
  assert.deepEqual(Q.readState(search), state);
  assert.equal(Q.writeState(Q.DEFAULTS, ''), '');
  assert.equal(Q.readState('?posted=nonsense').posted, 'all');
  assert.equal(Q.activeCount(state), 5);
});
test('search needs every word, across fields', () => {
  const hits = q => items.filter(item => Q.matches(item, { ...Q.DEFAULTS, query: q })).map(item => item.id);
  assert.deepEqual(hits('masters priya'), ['1']);
  assert.deepEqual(hits('golf quote'), ['1']);
  assert.deepEqual(hits('priya'), ['1', '3']);
  assert.deepEqual(hits('masters sam'), []);
});
test('person, workspace, type and posted filters', () => {
  const posted = new Map([['2', { platform: 'instagram' }]]);
  const ids = state => items.filter(item => Q.matches(item, { ...Q.DEFAULTS, ...state }, posted)).map(item => item.id);
  assert.deepEqual(ids({ person: 'priya' }), ['1', '3']);
  assert.deepEqual(ids({ workspace: 'Newsletter' }), ['3']);
  assert.deepEqual(ids({ type: 'Player Stats' }), ['2']);
  assert.deepEqual(ids({ posted: 'posted' }), ['2']);
  assert.deepEqual(ids({ posted: 'not' }), ['1', '3']);
});
test('people are counted, busiest first', () => {
  assert.deepEqual(Q.people(items), [{ name: 'Priya', count: 2 }, { name: 'Sam', count: 1 }]);
});
test('make another: Generate with the post’s own fields, never autorun', () => {
  const again = Q.makeAnother(items[0]);
  assert.equal(again.kind, 'generate');
  assert.match(again.href, /^generate\.html\?brief=/);
  assert.match(again.href, /autorun=0$/);
  const brief = new URL(again.href, 'http://x/').searchParams.get('brief');
  assert.match(brief, /Quote post like "Scheffler wins the Masters"/);
  assert.match(brief, /Team: PGA Tour/);
  assert.ok(!/\d{2,}/.test(brief.replace(/Masters|PGA/g, '')), 'no invented numbers');
  assert.deepEqual(Q.makeAnother(items[2]), { href: 'index.html#newsletter', label: 'New Newsletter design', kind: 'editor' });
});

// ── Dashboard insights ──────────────────────────────────────────────────
test('overdue, unassigned and access come first, worst first', () => {
  const tasks = [
    { type: 'design_request', status: 'Doing', title: 'Late one', assignedTo: 'x', designDueAt: new Date(NOW - 2 * DAY).toISOString() },
    { type: 'design_request', status: 'Backlog', title: 'Nobody', designDueAt: new Date(NOW + 3600000).toISOString() },
    { type: 'design_request', status: 'Done', title: 'Closed', designDueAt: new Date(NOW - 9 * DAY).toISOString() },
  ];
  const { items: list, needsAction } = I.computeInsights({ tasks, accessRequests: [{ status: 'Pending' }, { status: 'Approved' }] }, { now: NOW });
  assert.deepEqual(list.map(item => item.id), ['overdue', 'unassigned', 'access', 'due-soon']);
  assert.equal(needsAction, 3);
  assert.match(list[0].title, /^1 request is overdue/);
  assert.match(list[0].detail, /due 2 days ago/);
  assert.equal(list[0].action.view, 'board');
});
test('all clear when nothing needs action', () => {
  const { items: list } = I.computeInsights({ tasks: [] }, { now: NOW });
  assert.equal(list[0].id, 'clear');
  assert.equal(list[0].action, null);
});
test('export swings need volume, and quote real counts', () => {
  const ex = (daysAgo, who = 'A') => ({ type: 'exported_design', createdAt: new Date(NOW - daysAgo * DAY).toISOString(), creatorName: who });
  const few = I.computeInsights({ tasks: [ex(1), ex(8)], rangeDays: 7 }, { now: NOW });
  assert.ok(!few.items.some(item => item.id.startsWith('exports')));
  const tasks = [ex(1), ...Array.from({ length: 6 }, () => ex(9))];
  const down = I.computeInsights({ tasks, rangeDays: 7 }, { now: NOW }).items.find(item => item.id === 'exports-down');
  assert.equal(down.title, 'Exports down 83% on the previous 7 days');
  assert.equal(down.detail, '1 now, 6 before.');
});
test('quiet regulars and error spikes', () => {
  const ex = (daysAgo, who) => ({ type: 'exported_design', createdAt: new Date(NOW - daysAgo * DAY).toISOString(), creatorName: who });
  const tasks = [ex(9, 'Priya'), ex(10, 'Priya'), ex(12, 'Priya'), ex(2, 'Sam'), ex(9, 'Sam'), ex(10, 'Sam'), ex(11, 'Sam')];
  const errorRows = [
    { created_at: new Date(NOW - 3600000).toISOString(), user_email: 'a@x', occurrences: 3 },
    { created_at: new Date(NOW - 7200000).toISOString(), user_email: 'b@x' },
    { created_at: new Date(NOW - 3 * DAY).toISOString(), user_email: 'c@x', occurrences: 50 },
  ];
  const { items: list } = I.computeInsights({ tasks, errorRows }, { now: NOW, limit: 10 });
  const quiet = list.find(item => item.id === 'quiet');
  assert.equal(quiet.title, '1 regular hasn’t exported this week');
  assert.equal(quiet.detail, 'Priya');
  const errors = list.find(item => item.id === 'errors');
  assert.equal(errors.title, '4 errors in the last 24 hours');
  assert.equal(errors.action.anchor, 'dov-errors-title');
  assert.ok(!I.computeInsights({ tasks, errorRows: null }, { now: NOW, limit: 10 }).items.some(item => item.id === 'errors'));
});

// ── Home today ──────────────────────────────────────────────────────────
test('trends: one per sport for All, filtered for one sport', () => {
  const trends = [
    { title: 'a', category: 'nfl' }, { title: 'b', category: 'nfl' }, { title: 'c', category: 'golf' },
    { title: 'd', category: 'mlb' }, { title: '', category: 'mlb' },
  ];
  assert.deepEqual(H.pickTrends(trends, 'all', 3).map(t => t.title), ['a', 'c', 'd']);
  assert.deepEqual(H.pickTrends(trends, 'all', 4).map(t => t.title), ['a', 'c', 'd', 'b']);
  assert.deepEqual(H.pickTrends(trends, 'nfl', 4).map(t => t.title), ['a', 'b']);
  const href = H.trendHref({ title: 'Chiefs clinch the West' }, 'NFL');
  assert.match(href, /autorun=0$/);
  assert.equal(new URL(href, 'http://x/').searchParams.get('brief'), 'Chiefs clinch the West\nSport: NFL');
});
test('requests: overdue first, then soonest due', () => {
  const rows = [
    { id: 'later', design_due_at: new Date(NOW + 3 * DAY).toISOString() },
    { id: 'none', updated_at: '2026-11-18' },
    { id: 'late', design_due_at: new Date(NOW - DAY).toISOString() },
    { id: 'soon', design_due_at: new Date(NOW + 3600000 * 5).toISOString() },
  ];
  assert.deepEqual(H.sortRequests(rows, NOW).map(row => row.id), ['late', 'soon', 'later', 'none']);
  assert.equal(H.dueLabel(new Date(NOW - 1).toISOString(), NOW), 'Overdue');
  assert.equal(H.dueLabel(new Date(NOW + 5 * 3600000).toISOString(), NOW), 'Due in 5h');
  assert.equal(H.dueLabel(new Date(NOW + 3 * DAY).toISOString(), NOW), 'Due in 3d');
  assert.equal(H.greeting(new Date(2026, 10, 18, 9)), 'Good morning');
});
test('index.html loads Today inside Home only', () => {
  const html = read('index.html');
  const home = html.slice(html.indexOf('<main class="frame-home"'), html.indexOf('</main>', html.indexOf('<main class="frame-home"')));
  assert.ok(home.includes('id="home-today"'));
  ['trends', 'requests', 'exports', 'drafts'].forEach(id => assert.ok(home.includes(`data-today="${id}"`), id));
  assert.match(html, /frameup-home-today\.js\?v=[\w-]+" defer/);
});

// ── Sidebar NEW tags ────────────────────────────────────────────────────
test('NEW tags come from dates and expire after 14 days', () => {
  const src = read('app-shell.js');
  assert.ok(!/badge:\s*'New'/.test(src), 'no hand-set NEW badges left');
  const fn = src.match(/function isNavItemNew\(item, now = Date\.now\(\)\) \{[\s\S]*?\n  \}/)[0];
  const isNew = vm.runInNewContext(`const NAV_NEW_DAYS = ${src.match(/const NAV_NEW_DAYS = (\d+);/)[1]}; ${fn}; isNavItemNew`);
  const now = Date.parse('2026-11-18T12:00:00Z');
  assert.equal(isNew({ added: '2026-11-17' }, now), true);
  assert.equal(isNew({ added: '2026-11-05' }, now), true);
  assert.equal(isNew({ added: '2026-11-04' }, now), false);
  assert.equal(isNew({ added: '2026-10-22' }, now), false);
  assert.equal(isNew({}, now), false);
  assert.equal(isNew({ added: '2026-12-01' }, now), false);
  const added = [...src.matchAll(/id: '([\w-]+)'[^\n]*added: '(\d{4}-\d\d-\d\d)'/g)].map(m => m[1]);
  ['generate', 'trends', 'video-ads', 'reel-maker', 'my-requests', 'gallery'].forEach(id => assert.ok(added.includes(id), id));
});

// ── Presence heartbeat throttle ─────────────────────────────────────────
test('presence beats are throttled and one at a time', () => {
  const src = read('dashboard-data.js');
  assert.match(src, /const PRESENCE_MIN_GAP_MS = 10 \* 1000;/);
  assert.match(src, /if \(document\.visibilityState === 'hidden' \|\| beatInFlight\) return;/);
  assert.match(src, /if \(!wrote\) return false;/);
  assert.match(read('dashboard.html'), /presence: false/);
});

console.log(`hero-workflow: ${passed} tests passed`);
