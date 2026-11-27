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

await test('the thumbs migration: idempotent, nullable, bounded, RLS kept', () => {
  const sql = read('supabase/migrations/20261129120000_frameup_usage_thumbs.sql');
  assert.match(sql, /add column if not exists thumb text;/);
  assert.match(sql, /drop constraint if exists frameup_usage_events_thumb_ok/);
  assert.match(sql, /char_length\(thumb\) <= 20000/);
  assert.ok(sql.includes(`<= ${T.THUMB_MAX}`), 'same cap as the client');
  assert.match(sql, /create index if not exists/);
  assert.match(sql, /drop policy if exists "frameup usage: users log own"[\s\S]*for insert[\s\S]*lower\(user_email\) = lower\(\(select auth\.jwt\(\)\) ->> 'email'\)/);
  assert.match(sql, /for select[\s\S]*is_es_designer_admin\(\)/);
  assert.doesNotMatch(sql, /for (update|delete)/);
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

// ── 1b. Exports: exported(), thumbnails ─────────────────────────────────────
await test('exported(): one row per export with dest, size, bytes, count; category from the destination', () => {
  const { t } = tracker();
  const file = t.exported({ tool: 'video-ads', format: 'MP4', label: 'Chiefs hype', width: 1080, height: 1920, bytes: 5 * 1048576, seconds: 14.04, template: 'hype', meta: { file: 'es_hype_1080x1920.mp4' } });
  assert.equal(file.category, 'export');
  assert.equal(file.action, 'mp4');
  assert.deepEqual(file.meta, { out: true, dest: 'download', file: 'es_hype_1080x1920.mp4', size: '1080x1920', kb: 5120, sec: 14, template: 'hype' });
  assert.equal(t.exported({ tool: 'newsletter', format: 'widget-html', dest: 'clipboard' }).category, 'copy');
  assert.equal(t.exported({ tool: 'social', format: 'image-link', dest: 'link' }).category, 'share');
  const pub = t.exported({ tool: 'merch', format: 'product', dest: 'publish', label: 'Mahomes tee' });
  assert.equal(pub.category, 'export');
  assert.equal(pub.tool, 'merch', 'merch is a known tool (was stored as "other")');
  assert.equal(t.exported({ tool: 'generate', dest: 'nowhere' }).meta.dest, 'download', 'unknown destination -> download');
  // out / dest survive a full meta (12-key cap).
  const crowded = t.exported({ tool: 'social', meta: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i + 1])) });
  assert.equal(crowded.meta.out, true);
  assert.equal(crowded.meta.dest, 'download');
  assert.equal(t.exported(null).tool, 'other', 'never throws');
});

await test('thumbnails: small data URL or https only; attached to a waiting row; dropped before the migration', async () => {
  const jpeg = `data:image/jpeg;base64,${'A'.repeat(4000)}`;
  assert.equal(T.cleanThumb(jpeg), jpeg);
  assert.equal(T.cleanThumb(`data:image/jpeg;base64,${'A'.repeat(T.THUMB_MAX)}`), '', 'too big');
  assert.equal(T.cleanThumb('data:image/svg+xml;base64,AAAA'), '', 'no SVG');
  assert.equal(T.cleanThumb('https://cdn.fourthwall.com/p/1.png'), 'https://cdn.fourthwall.com/p/1.png');
  assert.equal(T.cleanThumb('http://x.test/a.png'), '');
  assert.equal(T.cleanThumb('javascript:alert(1)'), '');

  let fail = 'column';
  const { t, fake } = tracker({ reply: rows => {
    if (fail === 'column' && rows.some(row => 'thumb' in row)) return { error: { code: 'PGRST204', message: "Could not find the 'thumb' column of 'frameup_usage_events' in the schema cache" } };
    return { error: null };
  } });
  const row = t.exported({ tool: 'generate', format: 'png', thumb: jpeg });
  assert.equal(row.thumb, jpeg, 'a ready thumbnail goes on the row');
  const later = t.exported({ tool: 'video-ads', format: 'mp4' });
  assert.equal(t.attachThumb(later.id, jpeg), true, 'attached while still queued');
  assert.equal(t.attachThumb('nope', jpeg), false);
  await t.flush();
  assert.equal(t.status().thumbs, 'missing');
  assert.equal(t.status().table, 'ready', 'the rows still went up');
  assert.equal(t.pending().length, 0);
  const sent = fake.calls.at(-1).rows;
  assert.equal(sent.length, 2);
  assert.ok(sent.every(r => !('thumb' in r)), 'sent again without thumbnails');
  assert.ok(!('thumb' in t.exported({ tool: 'social', thumb: jpeg })), 'no more thumbnails this page');
  assert.equal(t.attachThumb(t.pending()[0].id, jpeg), false);

  // After the migration: thumbnails go up.
  fail = '';
  const next = tracker({ reply: () => ({ error: null }) });
  next.t.exported({ tool: 'social', thumb: jpeg });
  await next.t.flush();
  assert.equal(next.fake.calls[0].rows[0].thumb, jpeg);
  assert.equal(next.t.status().thumbs, 'ready');
});

await test('thumbnails are kept on the device only for the newest 10 waiting rows', () => {
  const storage = memoryStorage();
  const { t } = tracker({ storage, signedIn: false });
  const jpeg = `data:image/jpeg;base64,${'B'.repeat(3000)}`;
  for (let i = 0; i < 25; i++) t.exported({ tool: 'social', thumb: jpeg });
  const saved = JSON.parse(storage.data[T.QUEUE_KEY]);
  assert.equal(saved.length, 25);
  assert.equal(saved.filter(row => row.thumb).length, 10);
  assert.ok(saved.slice(-10).every(row => row.thumb), 'the newest keep theirs');
});

await test('install(): exported() makes the thumbnail after the export and attaches it', async () => {
  const drawn = [];
  const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage: (src, x, y, w, h) => drawn.push([w, h]), set fillStyle(v) {} }), toDataURL: () => `data:image/jpeg;base64,${'C'.repeat(500)}` };
  const timers = [];
  const win = {
    location: { pathname: '/video-ads.html' }, localStorage: memoryStorage(), matchMedia: () => ({ matches: false }),
    crypto: { randomUUID: () => '12345678-1234-4123-8123-123456789abc' }, addEventListener() {}, console,
    document: { createElement: () => canvas },
  };
  win.top = win;
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  try {
    const api = T.install(win);
    const source = { width: 1920, height: 1080 };
    const row = api.exported({ tool: 'video-ads', format: 'mp4', thumb: source });
    assert.ok(row && !row.thumb, 'logged at once, without waiting for the thumbnail');
    assert.equal(drawn.length, 0, 'nothing drawn on the click');
    for (const job of timers.filter(job => job.ms === 0)) job.fn();
    await new Promise(resolve => realTimeout(resolve, 0));
    assert.deepEqual(drawn[0], [160, 90], '160 px on the long side');
    assert.match(api.pending().find(r => r.id === row.id).thumb, /^data:image\/jpeg;base64,/);
    assert.equal(await api.makeThumb({ width: 0, height: 0 }), '');
    assert.equal(await api.makeThumb('https://x.test/a.jpg'), 'https://x.test/a.jpg');
    assert.equal(await api.makeThumb({ get width() { throw new Error('tainted'); } }), '', 'never throws');
  } finally {
    globalThis.setTimeout = realTimeout;
  }
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

await test('exports: every tool, per tool / format / destination / person; legacy rows link their preview', () => {
  const rows = U.combine({
    events: [
      ...events,
      { id: 'e1', created_at: at('2026-11-20T12:00:00'), user_email: 'raj@essentiallysports.com', category: 'export', tool: 'video-ads', action: 'mp4', label: 'Hype', meta: { out: true, dest: 'download', size: '1080x1920', kb: 4096, sec: 14 } },
      { id: 'e2', created_at: at('2026-11-20T12:05:00'), user_email: 'raj@essentiallysports.com', category: 'export', tool: 'merch', action: 'product', label: 'Tee', meta: { out: true, dest: 'publish' } },
      { id: 'e3', created_at: at('2026-11-20T12:06:00'), user_email: 'ana@essentiallysports.com', category: 'copy', tool: 'newsletter', action: 'widget-html', meta: { out: true, dest: 'clipboard' } },
      { id: 'e4', created_at: at('2026-11-20T12:07:00'), user_email: 'ana@essentiallysports.com', category: 'export', tool: 'generate', action: 'zip', meta: { out: true, dest: 'download', count: 5 } },
      { id: 'e5', created_at: at('2026-11-20T12:08:00'), user_email: 'ana@essentiallysports.com', category: 'export', tool: 'social', action: 'png', label: 'Win', meta: { out: true, dest: 'download', task: 'task-design-DES-1' } },
    ],
    tasks, impactEvents, firstEventAt: at('2026-11-18T09:00:00'),
  }).rows;
  const from = new Date('2026-11-14T00:00:00').getTime();
  const to = new Date('2026-11-20T23:59:59').getTime();
  const x = U.exportSummary(U.applyFilters(rows, { from, to }), { from, to, names: { 'ana@essentiallysports.com': 'Ana Lopez' } });
  // a (social jpg) + c (image-pool download) + e1..e5 + legacy t1 + evt-1; not b (headline copy) or d (plain share).
  assert.equal(x.total, 9);
  assert.equal(x.files, 13, 'a 5-file ZIP counts 5 files');
  assert.deepEqual(x.dests, { download: 7, publish: 1, clipboard: 1 });
  const merch = x.byTool.find(tool => tool.key === 'merch');
  assert.equal(merch.label, 'Merch Designs');
  assert.deepEqual(merch.formatList.map(f => f.label), ['Fourthwall product']);
  const social = x.byTool.find(tool => tool.key === 'social');
  assert.equal(social.count, 2);
  assert.equal(social.people, 1);
  assert.equal(x.recent[0].id, 'e5');
  assert.equal(x.recent[0].taskId, 'task-design-DES-1', 'editor export -> its stored preview');
  assert.equal(x.recent[0].name, 'Ana Lopez');
  assert.equal(x.recent.find(r => r.id === 'e1').formatLabel, 'MP4');
  assert.equal(x.recent.find(r => r.id === 'e1').size, '1080x1920');
  assert.equal(x.recent.find(r => r.id === 'e3').destLabel, 'Copied');
  assert.equal(x.recent.find(r => r.id === 'task-t1').taskId, 't1', 'older editor export -> its task preview');
  assert.ok(!x.recent.some(r => r.id === 'b' || r.id === 'd'), 'plain copies and links are not exports');
  assert.equal(U.exportSummary([], { from, to }).total, 0);
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
  ['dashboard-data.js', /tracker\.exported\(\{\s*tool: tracker\.toolForWorkspace\(record\.workspace\),[\s\S]{0,80}dest: 'download'/, 'editor exports (Social Media, YouTube, Newsletter, Generate renderer, design-request page)'],
  ['merch.js', /track\?\.\('copy', \{ tool: 'merch', action: 'description'/, 'Merch Designs copy description (text, not an export)'],
  ['merch.js', /FrameUpTrack\?\.exported\?\.\(\{ tool: 'merch', format: 'product', dest: 'publish'/, 'Merch: product created on Fourthwall (normal + quick publish)'],
  ['merch-ads.js', /FrameUpTrack\?\.exported\?\.\(\{ tool: 'merch', format: zip \? 'zip' : 'png', dest: 'download'/, 'Merch ad PNG / ZIP download'],
  ['frameup-size-pack.js', /FrameUpTrack\?\.exported\?\.\(\{ tool: 'social', format: 'zip', dest: 'download'/, 'size pack ZIP'],
  ['index.html', /FrameUpTrack\?\.exported\?\.\(\{ tool: window\.FrameUpTrack\.toolForWorkspace\(activeWorkspace\), format: 'image-link', dest: 'link'/, 'editor image link'],
  ['index.html', /FrameUpTrack\?\.exported\?\.\(\{ tool: 'newsletter', format: 'widget-html', dest: 'clipboard'/, 'newsletter widget HTML'],
  ['index.html', /recordDesignExport\?\.\(\{/, 'editor PNG / JPEG download (saveCanvasDownload -> recordDesignExport)'],
  ['generate.html', /track\?\.\('open', \{ tool: 'generate', action: 'open-in-editor'/, 'Generate open in editor'],
  ['generate.html', /FrameUpTrack\?\.exported\?\.\(\{ tool: 'generate', format: 'png', dest: 'download'/, 'Generate PNG download'],
  ['generate.html', /track\?\.\('open', \{ tool: 'generate', action: 'open-carousel'/, 'Generate open as carousel'],
  ['generate.html', /FrameUpTrack\?\.exported\?\.\(\{ tool: 'generate', format: 'zip', dest: 'download'/, 'Generate set ZIP'],
  ['generate-creative.js', /FrameUpTrack\?\.exported\?\.\(\{ tool: 'generate', format: type === 'image\/jpeg'/, 'Creative PNG/JPEG'],
  ['generate-creative.js', /track\?\.\('open', \{ tool: 'generate', action: 'open-in-editor'/, 'Creative open in editor'],
  ['frameup-posted.js', /track\?\.\('generate', \{ tool: 'generate'/, 'Generate runs'],
  ['video-ads.js', /FrameUpTrack\?\.exported\?\.\(\{ tool: 'video-ads', format: ext, dest: 'download'/, 'Video Ads MP4s, one row per file (incl. daily sets)'],
  ['video-ads.js', /track\?\.\('download', \{ tool: 'video-ads', action: 'download-again'/, 'Video Ads download again'],
  ['reels.js', /FrameUpTrack\.exported\(\{ tool: 'reels', format: format\.ext, dest: 'download'/, 'Reel Captions MP4'],
  ['reels.js', /FrameUpTrack\.exported\(\{ tool: 'reels', format: 'srt', dest: 'download'/, 'Reel Captions SRT'],
  ['reel-maker.js', /track\?\.\('export', \{ tool: 'reels-studio', action: result\.ext/, 'Reels Studio / explainer MP4'],
  ['reel-maker.js', /track\?\.\('export', \{ tool: 'reels-studio', action: 'zip'/, 'Reels Studio carousel ZIP'],
  ['reel-maker.js', /track\?\.\('download', \{ tool: 'reels-studio', action: 'download-again'/, 'Reels Studio download again'],
  ['reel-captions-export.js', /track\?\.\('download', \{ tool: 'reels-studio', action: kind/, 'Reels Studio caption files (SRT, VTT, transcript)'],
  ['image-pool.html', /FrameUpTrack\?\.exported\?\.\(\{ tool: 'image-pool', format: 'photo-link', dest: 'link'/, 'Image Pool copy link'],
  ['image-pool.html', /FrameUpTrack\?\.exported\?\.\(\{ tool: 'image-pool', format: 'photo', dest: 'download'/, 'Image Pool download'],
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

// Every place a file or a finished asset leaves FrameUp: a file download
// (a.download), a clipboard write, a save dialog, the share sheet. Each file's
// number of such sites is pinned here with where it is tracked, so a NEW
// download or copy anywhere fails this test until it is tracked (TAKES above,
// FrameUpTrack.exported) and listed. Reels Studio files are tracked on their
// own branch (release/reels3); see the reel-maker rows in TAKES.
const OUT_SITE = /\.download = |setAttribute\(['"]download['"]|navigator\.clipboard\.write(Text)?\(|execCommand\(['"]copy['"]\)|new ClipboardItem|showSaveFilePicker|navigator\.share\(/g;
const EXPORT_POINTS = {
  'index.html': [5, 'editor PNG/JPEG download (saveCanvasDownload, 1 site: recordDesignExport -> exported); copyTextToClipboard helper (2 sites: image link, tracked as exported dest link); widget HTML copy (2 sites: exported dest clipboard)'],
  'frameup-size-pack.js': [1, 'size pack ZIP (exported)'],
  'generate-creative.js': [1, 'Creative PNG / JPEG (exported)'],
  'frameup-spec.js': [1, 'Generate set ZIP inside the renderer frame; logged by generate.html (exported zip)'],
  'merch-ads.js': [1, 'Merch ad PNG / ZIP (save() -> exported)'],
  'merch.js': [1, 'product description copy: text, logged as copy (not an export)'],
  'video-ads.js': [1, 'Video Ads MP4 / WebM per file (exported); "Download again" links are logged as download'],
  'reels.js': [2, 'Reel Captions MP4 + SRT (exported)'],
  'reel-maker.js': [2, 'Reels Studio MP4 / carousel ZIP (track export; reels3 branch moves to exported)'],
  'reel-captions-export.js': [1, 'Reels Studio caption files (track download)'],
  'image-pool.html': [4, 'ES photo download (grid link + its dataset.download index + viewer, exported) and photo link copy (exported dest link)'],
  'design-request.html': [1, 'legacy editor copy; its export goes through recordDesignExport'],
  'trends-view.js': [2, 'headline / kit / shortlist text copies: logged as copy (not an export)'],
  'frameup-posted.js': [2, 're-copies the same link / HTML with UTM tags (already counted)'],
  'design-system.html': [1, 'UI Library token copy (copy, not an export)'],
  'login.html': [1, 'copies sign-in diagnostics for support (not an export)'],
};

await test('export inventory: every download / copy site in the app is listed and tracked', () => {
  const files = fs.readdirSync(ROOT).filter(f => /\.(js|html)$/.test(f) && !/^(frameup-track|frameup-usage|frameup-exports)/.test(f));
  for (const dir of ['tours', 'ai-page']) {
    if (fs.existsSync(path.join(ROOT, dir))) files.push(...fs.readdirSync(path.join(ROOT, dir)).filter(f => /\.(js|html)$/.test(f)).map(f => `${dir}/${f}`));
  }
  const found = {};
  files.forEach(f => { const n = (read(f).match(OUT_SITE) || []).length; if (n) found[f] = n; });
  const problems = [];
  for (const [file, n] of Object.entries(found)) {
    if (!EXPORT_POINTS[file]) problems.push(`${file}: ${n} new download/copy site(s), not in the export inventory. Track it with FrameUpTrack.exported(...) and list it in EXPORT_POINTS.`);
    else if (EXPORT_POINTS[file][0] !== n) problems.push(`${file}: ${n} download/copy sites, inventory says ${EXPORT_POINTS[file][0]}. Track the new one with FrameUpTrack.exported(...) and update EXPORT_POINTS.`);
  }
  for (const file of Object.keys(EXPORT_POINTS)) if (!found[file]) problems.push(`${file}: listed in EXPORT_POINTS but has no download/copy site any more; remove it.`);
  assert.deepEqual(problems, []);
  // Every file with an export site has its tracking call in TAKES.
  const tracked = new Set(TAKES.map(([file]) => file));
  const untracked = Object.keys(EXPORT_POINTS).filter(f => !tracked.has(f) && !['frameup-spec.js', 'design-request.html', 'frameup-posted.js', 'login.html'].includes(f));
  assert.deepEqual(untracked, []);
});

await test('exports leave through exported(): no tool logs a finished file with plain track()', () => {
  // Only Reels Studio (other branch) and download-again / caption-file
  // downloads still use track(); everything else carries dest/size/thumb.
  const allowed = { 'reel-maker.js': true, 'reel-captions-export.js': true, 'dashboard-data.js': true };
  const offenders = fs.readdirSync(ROOT).filter(f => /\.(js|html)$/.test(f) && !/^(frameup-track|frameup-usage|frameup-exports)/.test(f) && !allowed[f])
    .filter(f => /\btrack\s*(\?\.)?\(\s*'export'/.test(read(f)));
  assert.ok(/\btrack\s*(\?\.)?\(\s*'export'/.test(read('reel-maker.js')), 'the check sees track?.(\'export\'');
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
  // Exports tab: every tool's exports above the editor review list.
  assert.match(dash, /<script src="frameup-exports-view\.js\?v=/);
  assert.match(dash, /<link rel="stylesheet" href="frameup-exports\.css\?v=/);
  assert.match(dash, /id="exports-view" data-view-section="designs"[\s\S]*?class="panel export-review-shell" data-view-section="designs"/);
  // Needs attention stays the last overview section.
  const overview = dash.slice(dash.indexOf('<div class="dov" data-view-section="overview">'), dash.indexOf('data-view-section="board list"'));
  const sections = [...overview.matchAll(/<section class="dov-(?:section|insights)[^"]*"[^>]*aria-labelledby="([^"]+)"/g)].map(m => m[1]);
  assert.equal(sections.at(-1), 'dov-insights-title');
});

console.log(`\n${passed} usage tracking tests passed`);
