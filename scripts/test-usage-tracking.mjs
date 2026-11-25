// Usage tracking (2026-11-25): everything people take from FrameUp.
//   1. frameup-track.js: taxonomy validation, cleaning (no emails, no image
//      data, small meta), batching / debounce, never blocking or throwing,
//      failure tolerance (network error, missing table, rejected rows),
//      the local queue (cap, age, survives a reload), iframes do not log.
//   2. frameup-usage.js: combining usage events with the older export rows
//      (no double counting), filters, the summary (by type, tool, person, day).
//   3. Wiring: every inventoried take action calls FrameUpTrack.track, every
//      page that has one loads frameup-track.js, the dashboard loads the view.
// Offline: Supabase is a stub, nothing touches the network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');
const T = require(path.join(ROOT, 'frameup-track.js'));
const U = require(path.join(ROOT, 'frameup-usage.js'));
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`ok   ${name}`); } catch (error) { console.error(`FAIL ${name}`); throw error; }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: key => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: key => { delete data[key]; },
  };
}

// A manual clock + scheduler so batching is deterministic.
function scheduler() {
  let id = 0;
  const jobs = new Map();
  return {
    jobs,
    schedule: (fn, ms) => { id += 1; jobs.set(id, { fn, ms }); return id; },
    cancel: key => { jobs.delete(key); },
    async runAll() { const list = [...jobs.values()]; jobs.clear(); for (const job of list) await job.fn(); },
  };
}

// Supabase stub: records upserts; `reply` decides each call's result.
function fakeClient(reply = () => ({ error: null })) {
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        return {
          upsert: async (rows, options) => { calls.push({ table, rows, options }); return reply(rows, calls.length); },
        };
      },
    },
  };
}

function tracker({ reply, storage = memoryStorage(), signedIn = true, ...rest } = {}) {
  const fake = fakeClient(reply);
  const sched = scheduler();
  const warnings = [];
  const t = T.createTracker({
    getClient: async () => (signedIn ? { client: fake.client, email: 'ana@essentiallysports.com' } : null),
    storage,
    schedule: sched.schedule,
    cancel: sched.cancel,
    page: 'index',
    device: 'desktop',
    sessionId: 'sess-1',
    warn: message => warnings.push(message),
    ...rest,
  });
  return { t, fake, sched, storage, warnings };
}

// ── 1. Tracker ──────────────────────────────────────────────────────────────
await test('taxonomy: unknown category is refused (and warned once), unknown tool becomes "other"', () => {
  const { t, warnings } = tracker();
  assert.equal(t.track('exported', { tool: 'social' }), null);
  assert.equal(t.track('exported', { tool: 'social' }), null);
  assert.equal(warnings.length, 1);
  const row = t.track('export', { tool: 'made-up-tool', action: 'PNG File!' });
  assert.equal(row.tool, 'other');
  assert.equal(row.action, 'png-file');
  assert.equal(t.track('copy', {}).action, 'copy', 'action defaults to the category');
  for (const key of Object.keys(T.CATEGORIES)) assert.ok(t.track(key, { tool: 'social' }), key);
});

await test('rows: no emails, no data URLs, small flat meta, page/device/session set', () => {
  const { t } = tracker();
  const row = t.track('share', {
    tool: 'social',
    action: 'image-link',
    label: 'Sent to bob@essentiallysports.com data:image/png;base64,AAAA' + 'x'.repeat(400),
    meta: { note: 'mail ana@x.com', preview: 'data:image/jpeg;base64,/9j/AAAA', count: 3.14159, ok: true, list: ['a', 'b'], nested: { a: 1 }, fn: () => 1, '': 'x' },
  });
  assert.ok(!/@/.test(JSON.stringify(row)), 'no emails anywhere in the row');
  assert.ok(!/data:image/.test(JSON.stringify(row)), 'no image data');
  assert.ok(row.label.length <= 160);
  assert.equal(row.meta.count, 3.14);
  assert.equal(row.meta.ok, true);
  assert.deepEqual(row.meta.list, ['a', 'b']);
  assert.equal(row.meta.nested, undefined);
  assert.equal(row.meta.fn, undefined);
  assert.equal(row.meta.preview, undefined, 'a field that was only image data is dropped');
  assert.equal(row.page, 'index');
  assert.equal(row.device, 'desktop');
  assert.equal(row.session_id, 'sess-1');
  assert.match(row.id, /^[0-9a-f-]{36}$/);
  assert.equal(row.user_email, undefined, 'the email is only added when sending');
  const big = T.cleanMeta(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, 'y'.repeat(120)])));
  assert.ok(Object.keys(big).length <= 12 && JSON.stringify(big).length <= 1800);
});

await test('track() returns at once and never throws, even with broken storage or client', async () => {
  const brokenStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('x'); } };
  const t = T.createTracker({ getClient: async () => { throw new Error('boom'); }, storage: brokenStorage, schedule: () => 0, cancel: () => {} });
  assert.ok(t.track('export', { tool: 'social' }));
  assert.equal(await t.flush(), 0);
  assert.equal(t.track(null), null);
  assert.equal(t.track('export', 'not an object').tool, 'other');
});

await test('batching: one debounced send for several takes; 20 at once sends without waiting', async () => {
  const { t, fake, sched } = tracker();
  t.track('copy', { tool: 'trends', action: 'headline' });
  t.track('copy', { tool: 'trends', action: 'headline' });
  t.track('download', { tool: 'image-pool', action: 'photo' });
  assert.equal(fake.calls.length, 0, 'nothing sent synchronously');
  assert.equal(sched.jobs.size, 1, 'one pending flush (debounced)');
  assert.equal([...sched.jobs.values()][0].ms, 1500);
  await sched.runAll();
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].table, 'frameup_usage_events');
  assert.equal(fake.calls[0].rows.length, 3);
  assert.ok(fake.calls[0].rows.every(row => row.user_email === 'ana@essentiallysports.com'));
  assert.deepEqual(fake.calls[0].options, { onConflict: 'id', ignoreDuplicates: true });
  assert.equal(t.pending().length, 0);

  for (let i = 0; i < 20; i++) t.track('export', { tool: 'social' });
  assert.equal([...sched.jobs.values()][0].ms, 0, 'a full batch flushes immediately');
  for (let i = 0; i < 5; i++) t.track('export', { tool: 'social' });
  await t.flush();
  assert.deepEqual(fake.calls.slice(1).map(call => call.rows.length), [20, 5], 'sent in batches of 20');
});

await test('failure: a network error keeps the rows and retries later; the same ids are re-sent', async () => {
  let fail = true;
  const { t, fake, sched } = tracker({ reply: () => (fail ? { error: { message: 'Failed to fetch' } } : { error: null }) });
  const row = t.track('export', { tool: 'video-ads', action: 'mp4' });
  await t.flush();
  assert.equal(t.pending().length, 1, 'kept after a network error');
  assert.equal([...sched.jobs.values()].at(-1).ms, 30000, 'retry scheduled');
  fail = false;
  await t.flush();
  assert.equal(t.pending().length, 0);
  assert.equal(fake.calls[1].rows[0].id, row.id, 'same id, so the server ignores a duplicate');
});

await test('failure: a thrown client error is tolerated', async () => {
  const { t } = tracker({ reply: () => { throw new Error('socket hang up'); } });
  t.track('export', { tool: 'social' });
  assert.equal(await t.flush(), 0);
  assert.equal(t.pending().length, 1);
});

await test('before the migration: missing table -> rows wait on the device, no more calls this page', async () => {
  const storage = memoryStorage();
  const { t, fake } = tracker({ storage, reply: () => ({ error: { code: 'PGRST205', message: "Could not find the table 'public.frameup_usage_events' in the schema cache" } }) });
  t.track('copy', { tool: 'newsletter', action: 'widget-html' });
  await t.flush();
  assert.equal(t.status().table, 'missing');
  t.track('copy', { tool: 'newsletter', action: 'widget-html' });
  await t.flush();
  assert.equal(fake.calls.length, 1, 'no further calls once the table is known to be missing');
  assert.equal(JSON.parse(storage.data[T.QUEUE_KEY]).length, 2, 'kept on the device');

  // Next page load, after the migration ran: the saved rows go up.
  const next = tracker({ storage });
  assert.equal(next.t.pending().length, 2);
  await next.t.flush();
  assert.equal(next.fake.calls[0].rows.length, 2);
  assert.equal(storage.data[T.QUEUE_KEY], undefined, 'queue cleared');
});

await test('rejected rows (check constraint) are dropped, not retried forever', async () => {
  const { t } = tracker({ reply: () => ({ error: { code: '23514', message: 'new row violates check constraint' } }) });
  t.track('export', { tool: 'social' });
  await t.flush();
  assert.equal(t.pending().length, 0);
  assert.equal(t.status().dropped, 1);
});

await test('signed out: nothing is sent, rows wait', async () => {
  const { t, fake } = tracker({ signedIn: false });
  t.track('export', { tool: 'social' });
  await t.flush();
  assert.equal(fake.calls.length, 0);
  assert.equal(t.pending().length, 1);
});

await test('queue: capped at 200, rows older than 14 days dropped', () => {
  let now = Date.parse('2026-11-25T12:00:00Z');
  const storage = memoryStorage();
  const { t } = tracker({ storage, signedIn: false, now: () => now });
  for (let i = 0; i < 230; i++) t.track('export', { tool: 'social' });
  assert.equal(t.pending().length, 200);
  now += 15 * 86400000;
  const later = tracker({ storage, signedIn: false, now: () => now });
  assert.equal(later.t.pending().length, 0, 'stale rows are dropped on load');
});

await test('install(): an iframe does not log; the top page does', () => {
  const makeWin = top => {
    const win = { location: { pathname: '/generate.html' }, localStorage: memoryStorage(), matchMedia: () => ({ matches: false }), crypto: { randomUUID: () => '12345678-1234-4123-8123-123456789abc' }, addEventListener() {}, console };
    win.top = top ? win : {};
    return win;
  };
  const inFrame = T.install(makeWin(false));
  assert.equal(inFrame.track('export', { tool: 'social' }), null);
  const topWin = makeWin(true);
  const onTop = T.install(topWin);
  const row = onTop.track('export', { tool: 'generate' });
  assert.equal(row.page, 'generate');
  assert.equal(row.device, 'desktop');
  assert.equal(onTop.toolForWorkspace('Social Media'), 'social');
  assert.equal(onTop.toolForWorkspace('Newsletter'), 'newsletter');
  assert.equal(onTop.toolForWorkspace('Reel Captions'), 'reels');
  assert.equal(onTop.toolForWorkspace('Something'), 'other');
});

await test('the migration matches the client taxonomy and RLS shape', () => {
  const sql = read('supabase/migrations/20261125120000_frameup_usage_events.sql');
  const listed = sql.match(/category in \(([^)]*)\)/)[1].match(/'([a-z]+)'/g).map(s => s.replace(/'/g, ''));
  assert.deepEqual(listed.sort(), Object.keys(T.CATEGORIES).sort());
  assert.match(sql, /enable row level security/);
  assert.match(sql, /for insert[\s\S]*lower\(user_email\) = lower\(\(select auth\.jwt\(\)\) ->> 'email'\)/);
  assert.match(sql, /for select[\s\S]*is_es_designer_admin\(\)/);
  assert.doesNotMatch(sql, /for (update|delete)/, 'a log: no updates or deletes');
  for (const tool of Object.keys(T.TOOLS)) assert.match(tool, /^[a-z0-9-]{1,32}$/, `tool key ${tool} fits the database check`);
  assert.deepEqual(Object.keys(U.CATEGORY_LABELS), Object.keys(T.CATEGORIES));
  assert.deepEqual(Object.keys(U.TOOL_LABELS), Object.keys(T.TOOLS));
});

// ── 2. Dashboard maths ──────────────────────────────────────────────────────
const at = iso => new Date(iso).toISOString();
const events = [
  { id: 'a', created_at: at('2026-11-20T10:00:00'), user_email: 'Ana@essentiallysports.com', category: 'export', tool: 'social', action: 'jpg', label: 'Chiefs win' },
  { id: 'b', created_at: at('2026-11-20T11:00:00'), user_email: 'ana@essentiallysports.com', category: 'copy', tool: 'trends', action: 'headline', label: 'x' },
  { id: 'c', created_at: at('2026-11-19T09:00:00'), user_email: 'raj@essentiallysports.com', category: 'download', tool: 'image-pool', action: 'photo' },
  { id: 'd', created_at: at('2026-11-18T09:00:00'), user_email: 'raj@essentiallysports.com', category: 'share', tool: 'social', action: 'image-link' },
  { id: 'bad', created_at: at('2026-11-18T09:00:00'), user_email: 'raj@essentiallysports.com', category: 'nonsense', tool: 'social' },
];
const tasks = [
  { id: 't1', created_at: at('2026-11-17T09:00:00'), creator_email: 'sam@essentiallysports.com', creator_name: 'Sam Cole', workspace: 'YouTube', workspace_variant: 'Thumbnail' },
  { id: 't2', created_at: at('2026-11-19T12:00:00'), creator_email: 'ana@essentiallysports.com', workspace: 'Social Media' },
];
const impactEvents = [
  { id: 1, created_at: at('2026-11-16T09:00:00'), user_email: 'raj@essentiallysports.com', event: 'export_done', source: 'video-ads', meta: { template: 'hype' } },
  { id: 2, created_at: at('2026-11-16T10:00:00'), user_email: 'raj@essentiallysports.com', event: 'export_done', source: 'editor' },
  { id: 3, created_at: at('2026-11-16T11:00:00'), user_email: 'raj@essentiallysports.com', event: 'design_started', source: 'generate' },
];

await test('combine: older export rows only before the first usage event (no double counting)', () => {
  const out = U.combine({ events, tasks, impactEvents, firstEventAt: at('2026-11-18T09:00:00') });
  assert.equal(out.rows.filter(row => !row.legacy).length, 4, 'unknown category dropped');
  assert.deepEqual(out.rows.filter(row => row.legacy).map(row => row.id).sort(), ['evt-1', 'task-t1'], 't2 is after tracking started; editor export_done and design_started are skipped');
  assert.equal(out.rows[0].id, 'b', 'newest first');
  assert.equal(out.rows.find(row => row.id === 'task-t1').tool, 'youtube');
  assert.equal(out.rows.find(row => row.id === 'evt-1').tool, 'video-ads');
  assert.equal(out.rows.find(row => row.id === 'a').email, 'ana@essentiallysports.com', 'emails lower-cased');
  // No usage events yet (migration not run): all older exports count.
  assert.equal(U.combine({ events: [], tasks, impactEvents }).rows.length, 3);
  assert.equal(U.combine({ events: [], tasks }).trackingSince, null);
});

await test('filters and summary: by type, tool, person, day; recent feed', () => {
  const { rows } = U.combine({ events, tasks, impactEvents, firstEventAt: at('2026-11-18T09:00:00') });
  const from = new Date('2026-11-14T00:00:00').getTime();
  const to = new Date('2026-11-20T23:59:59').getTime();
  const s = U.summarize(rows, { from, to, names: { 'ana@essentiallysports.com': 'Ana Lopez' } });
  assert.equal(s.total, 6);
  assert.equal(s.people, 3);
  assert.deepEqual(s.byCategory.map(c => [c.key, c.count]), [['export', 3], ['download', 1], ['copy', 1], ['share', 1], ['open', 0], ['generate', 0]]);
  assert.equal(s.byTool[0].key, 'social');
  assert.deepEqual(s.byTool[0].categories, { export: 1, share: 1 });
  assert.equal(s.topPeople[0].email, 'raj@essentiallysports.com');
  assert.equal(s.topPeople[0].count, 3);
  assert.equal(s.topPeople.find(p => p.email === 'ana@essentiallysports.com').name, 'Ana Lopez');
  assert.equal(s.topPeople.find(p => p.email === 'sam@essentiallysports.com').name, 'Sam Cole', 'name from the task row');
  assert.equal(s.series.length, 7, 'one bucket per day, empty days included');
  assert.equal(s.series.at(-1).total, 2);
  assert.deepEqual(s.series.at(-1).categories, { export: 1, copy: 1 });
  assert.equal(s.series.reduce((n, d) => n + d.total, 0), 6);
  assert.equal(s.recent[0].id, 'b');
  assert.equal(s.recent[0].toolLabel, 'Trends');
  assert.equal(s.recent[0].actionLabel, 'Headline');

  assert.equal(U.applyFilters(rows, { tool: 'social' }).length, 2);
  assert.equal(U.applyFilters(rows, { category: 'export' }).length, 3);
  assert.equal(U.applyFilters(rows, { person: 'RAJ@essentiallysports.com' }).length, 3);
  assert.equal(U.applyFilters(rows, { from: new Date('2026-11-19T00:00:00').getTime(), to }).length, 3);
  const empty = U.summarize([], { from, to });
  assert.equal(empty.total, 0);
  assert.equal(empty.series.length, 7);
  assert.equal(empty.topPeople.length, 0);
});

await test('rangeFor covers whole days; filterOptions lists tools, types and people', () => {
  const now = new Date('2026-11-20T15:30:00').getTime();
  const r = U.rangeFor(7, now);
  assert.equal(new Date(r.from).getDate(), 14);
  assert.equal(new Date(r.from).getHours(), 0);
  assert.equal(new Date(r.to).getDate(), 20);
  const { rows } = U.combine({ events });
  const opts = U.filterOptions(rows, { 'ana@essentiallysports.com': 'Ana Lopez' });
  assert.equal(opts.categories.length, 6);
  assert.ok(opts.tools.some(t => t.key === 'image-pool'));
  assert.deepEqual(opts.people.map(p => p.label), ['Ana Lopez', 'Raj']);
  assert.equal(U.nameFromEmail('priya.nair@essentiallysports.com'), 'Priya Nair');
});

// ── 3. Wiring (grep) ────────────────────────────────────────────────────────
// Every action where someone takes something from FrameUp, and the call that logs it.
const TAKES = [
  ['dashboard-data.js', /tracker\.track\('export'/, 'editor exports (all workspaces, design-request page)'],
  ['merch.js', /track\?\.\('copy', \{ tool: 'merch', action: 'description'/, 'Merch Designs copy description'],
  ['frameup-size-pack.js', /FrameUpTrack\?\.track\?\.\('export', \{ tool: 'social', action: 'zip'/, 'size pack ZIP'],
  ['index.html', /track\?\.\('share', \{ tool: window\.FrameUpTrack\.toolForWorkspace\(activeWorkspace\), action: 'image-link'/, 'editor image link'],
  ['index.html', /track\?\.\('copy', \{ tool: 'newsletter', action: 'widget-html'/, 'newsletter widget HTML'],
  ['generate.html', /track\?\.\('open', \{ tool: 'generate', action: 'open-in-editor'/, 'Generate open in editor'],
  ['generate.html', /track\?\.\('export', \{ tool: 'generate', action: 'image'/, 'Generate PNG download'],
  ['generate.html', /track\?\.\('open', \{ tool: 'generate', action: 'open-carousel'/, 'Generate open as carousel'],
  ['generate.html', /track\?\.\('export', \{ tool: 'generate', action: 'zip'/, 'Generate set ZIP'],
  ['generate-creative.js', /track\?\.\('export', \{ tool: 'generate', action: type === 'image\/jpeg'/, 'Creative PNG/JPEG'],
  ['generate-creative.js', /track\?\.\('open', \{ tool: 'generate', action: 'open-in-editor'/, 'Creative open in editor'],
  ['frameup-posted.js', /track\?\.\('generate', \{ tool: 'generate'/, 'Generate runs'],
  ['video-ads.js', /track\?\.\('export', \{ tool: 'video-ads', action: ext/, 'Video Ads MP4s (incl. daily sets)'],
  ['video-ads.js', /track\?\.\('download', \{ tool: 'video-ads', action: 'download-again'/, 'Video Ads download again'],
  ['reels.js', /FrameUpTrack\.track\('export', \{ tool: 'reels'/, 'Reel Captions MP4'],
  ['reels.js', /FrameUpTrack\.track\('download', \{ tool: 'reels', action: 'srt'/, 'Reel Captions SRT'],
  ['reel-maker.js', /track\?\.\('export', \{ tool: 'reels-studio', action: result\.ext/, 'Reels Studio / explainer MP4'],
  ['reel-maker.js', /track\?\.\('export', \{ tool: 'reels-studio', action: 'zip'/, 'Reels Studio carousel ZIP'],
  ['reel-maker.js', /track\?\.\('download', \{ tool: 'reels-studio', action: 'download-again'/, 'Reels Studio download again'],
  ['reel-captions-export.js', /track\?\.\('download', \{ tool: 'reels-studio', action: kind/, 'Reels Studio caption files (SRT, VTT, transcript)'],
  ['image-pool.html', /track\?\.\('share', \{ tool: 'image-pool', action: 'photo-link'/, 'Image Pool copy link'],
  ['image-pool.html', /track\?\.\('download', \{ tool: 'image-pool', action: 'photo'/, 'Image Pool download'],
  ['gallery.html', /track\?\.\('open', \{ tool: 'gallery', action: 'open-in-editor'/, 'Gallery open in editor'],
  ['gallery.html', /track\?\.\('open', \{ tool: 'gallery', action: 'make-another'/, 'Gallery make another'],
  ['trends-view.js', /track\?\.\('copy', \{ tool: 'trends'/, 'Trends copy headline / kit / shortlist'],
  ['trends-view.js', /track\?\.\('open', \{ tool: 'trends', action: 'design-post'/, 'Trends design post'],
  ['frameup-home-today.js', /track\?\.\('open', \{ tool: 'home'/, 'Home trend hand-offs'],
  ['design-system.html', /track\?\.\('copy', \{ tool: 'design-system', action: 'token'/, 'UI Library token copy'],
];

await test('every inventoried take action calls FrameUpTrack.track', () => {
  for (const [file, pattern, what] of TAKES) assert.match(read(file), pattern, `${what} (${file})`);
});

await test('every clipboard write and file download in the app is covered', () => {
  // Files that copy or download something must be in the inventory above
  // (or be listed here with the reason they are not a take).
  const NOT_TAKES = {
    'frameup-posted.js': 're-copies the same link with UTM tags (already counted as share)',
    'login.html': 'copies sign-in diagnostics for support',
    'frameup-spec.js': 'Generate set ZIP inside the renderer frame (counted on generate.html)',
    'design-request.html': 'legacy editor copy; its export goes through recordDesignExport',
  };
  const covered = new Set(TAKES.map(([file]) => file));
  const files = fs.readdirSync(ROOT).filter(f => /\.(js|html)$/.test(f) && !/^(frameup-track|frameup-usage)/.test(f));
  const offenders = files.filter(f => /navigator\.clipboard\.writeText|\.download = |execCommand\('copy'\)/.test(read(f)) && !covered.has(f) && !NOT_TAKES[f]);
  assert.deepEqual(offenders, []);
});

await test('pages with take actions load frameup-track.js; the dashboard loads the Usage view', () => {
  for (const page of ['index.html', 'generate.html', 'video-ads.html', 'reels.html', 'reel-maker.html', 'image-pool.html', 'gallery.html', 'design-request.html', 'design-system.html', 'dashboard.html']) {
    assert.match(read(page), /<script src="frameup-track\.js\?v=[^"]+"><\/script>/, page);
  }
  const dash = read('dashboard.html');
  assert.match(dash, /<script src="frameup-usage\.js\?v=/);
  assert.match(dash, /<script src="frameup-usage-view\.js\?v=/);
  assert.match(dash, /<link rel="stylesheet" href="frameup-usage\.css\?v=/);
  assert.match(dash, /id="usage-view" data-view-section="usage"/);
  assert.match(dash, /data-dashboard-view="usage"/);
  assert.match(dash, /DASHBOARD_VIEWS = new Set\(\['overview', 'usage'/);
});

console.log(`\n${passed} usage tracking tests passed`);
