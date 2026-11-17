#!/usr/bin/env node
// Cloud drafts sync engine (frameup-cloud-drafts.js createDraftSync), with an
// in-memory mock of the supabase-js query builder. No network.
//   1. debounce: many saves → one upsert, with the right row
//   2. size cap, offline, signed out, network error + retry, table missing
//   3. conflicts: newer draft from another device → prompt; mine / theirs
//   4. no prompt for own device, for older remote, or for exported designs
//   5. newerRemote (opening the editor elsewhere), list, remove
//   6. the editor wiring (fake window): the "newer version on another device"
//      prompt, both answers, and an empty editor opening the draft directly
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDraftSync, isMissingTable, DEBOUNCE_MS, MAX_BYTES } = require('../frameup-cloud-drafts.js');

// ── Mock Supabase ───────────────────────────────────────────────────────────
function createMockDb() {
  const rows = new Map(); // `${owner}|${key}` -> row
  let clock = Date.parse('2026-11-18T10:00:00Z');
  const db = {
    rows,
    calls: [],
    failNext: null, // { error } to fail the next query
    missing: false,
    tick(ms = 1000) { clock += ms; return new Date(clock).toISOString(); },
    // Another device writes directly.
    writeAs(owner, key, fields) {
      const iso = db.tick(5000);
      rows.set(`${owner}|${key}`, { owner_id: owner, draft_key: key, kind: 'editor', workspace: '', variant: '', title: '', local_photos: 0, deleted_at: null, ...fields, updated_at: iso });
      return iso;
    },
  };
  function builder(table) {
    const q = { table, op: 'select', filters: [], cols: '', payload: null, limit: null };
    const api = {
      select(cols) { if (q.op !== 'upsert') q.op = 'select'; q.cols = cols; return api; },
      upsert(payload, options) { q.op = 'upsert'; q.payload = payload; q.options = options; return api; },
      delete() { q.op = 'delete'; return api; },
      eq(col, value) { q.filters.push([col, value]); return api; },
      is(col, value) { q.filters.push([col, value]); return api; },
      gte(col, value) { q.gte = [col, value]; return api; },
      order() { return api; },
      limit(n) { q.limit = n; return api; },
      maybeSingle() { return run('maybe'); },
      single() { return run('single'); },
      then(resolve, reject) { return run('many').then(resolve, reject); },
    };
    async function run(mode) {
      db.calls.push({ ...q, mode });
      if (db.missing) return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.frameup_drafts' in the schema cache" } };
      if (db.failNext) { const error = db.failNext; db.failNext = null; return { data: null, error }; }
      const match = row => q.filters.every(([col, value]) => row[col] === value);
      if (q.op === 'upsert') {
        const key = `${q.payload.owner_id}|${q.payload.draft_key}`;
        const updated_at = db.tick(1000);
        rows.set(key, { ...(rows.get(key) || {}), ...q.payload, updated_at });
        return { data: { updated_at }, error: null };
      }
      if (q.op === 'delete') {
        Array.from(rows.entries()).forEach(([key, row]) => { if (match(row)) rows.delete(key); });
        return { data: null, error: null };
      }
      let list = Array.from(rows.values()).filter(match);
      if (q.gte) list = list.filter(row => row[q.gte[0]] >= q.gte[1]);
      list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      if (mode === 'maybe') return { data: list[0] ? { ...list[0] } : null, error: null };
      return { data: list.map(row => ({ ...row })), error: null };
    }
    return api;
  }
  db.client = { from: table => builder(table) };
  db.now = () => clock;
  return db;
}

function createTimers() {
  const timers = new Map();
  let id = 0;
  return {
    set(fn, ms) { id += 1; timers.set(id, { fn, ms }); return id; },
    clear(handle) { timers.delete(handle); },
    pending() { return Array.from(timers.values()); },
    async runAll() {
      const list = Array.from(timers.entries());
      timers.clear();
      for (const [, timer] of list) await timer.fn();
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

const USER = { id: 'user-1', email: 'designer@essentiallysports.com' };
function setup(overrides = {}) {
  const db = createMockDb();
  const timers = createTimers();
  const statuses = [];
  const conflicts = [];
  const applied = [];
  let online = true;
  let user = USER;
  const sync = createDraftSync({
    getClient: async () => db.client,
    getUser: async () => user,
    deviceId: 'laptop-A',
    isOnline: () => online,
    now: () => db.now(),
    setTimer: (fn, ms) => timers.set(fn, ms),
    clearTimer: handle => timers.clear(handle),
    onStatus: status => statuses.push(status),
    onConflict: async args => { conflicts.push(args); return overrides.choice || 'mine'; },
    onApplyRemote: row => { applied.push(row); },
    ...overrides.options,
  });
  return {
    db, timers, statuses, conflicts, applied, sync,
    setOnline(value) { online = value; },
    setUser(value) { user = value; },
  };
}
const design = text => ({ format: 1, cloud: true, editor: { states: { instagram: [{ lines: [text] }] } } });
const record = (text, savedAt) => ({ kind: 'editor', workspace: 'instagram', title: 'Work in progress', design: design(text), localPhotos: 1, savedAt });
const upserts = db => db.calls.filter(call => call.op === 'upsert');

// ── 1. Debounce and the row ─────────────────────────────────────────────────
{
  const t = setup();
  assert.equal(DEBOUNCE_MS, 20000, 'about 20 s after the last change');
  assert.equal(t.sync.queue('editor', record('a', t.db.now())), true);
  t.sync.queue('editor', record('ab', t.db.now()));
  t.sync.queue('editor', record('abc', t.db.now()));
  assert.equal(t.timers.pending().length, 1, 'one timer for a burst of saves');
  assert.equal(t.timers.pending()[0].ms, 20000);
  assert.equal(upserts(t.db).length, 0, 'nothing sent before the debounce');
  await t.timers.runAll();
  assert.equal(upserts(t.db).length, 1, 'one upsert for three saves');
  const row = t.db.rows.get('user-1|editor');
  assert.deepEqual(row.design, design('abc'), 'the latest save wins');
  assert.equal(row.device_id, 'laptop-A');
  assert.equal(row.owner_id, 'user-1');
  assert.equal(row.owner_email, 'designer@essentiallysports.com');
  assert.equal(row.kind, 'editor');
  assert.equal(row.local_photos, 1);
  assert.equal(upserts(t.db)[0].options.onConflict, 'owner_id,draft_key');
  assert.equal(t.sync.status().status, 'synced');
  assert.equal(t.sync.status().pending, 0);
}

// ── 2. Size cap, offline, signed out, errors, table missing ─────────────────
{
  const t = setup();
  const huge = { kind: 'editor', design: { blob: 'x'.repeat(MAX_BYTES + 10) }, savedAt: t.db.now() };
  assert.equal(t.sync.queue('editor', huge), false, 'over 400 KB is not synced');
  assert.equal(t.statuses.at(-1), 'too-large');
  await t.timers.runAll();
  assert.equal(upserts(t.db).length, 0);
}
{
  const t = setup();
  t.setOnline(false);
  t.sync.queue('editor', record('offline work', t.db.now()));
  await t.sync.flush();
  assert.equal(t.statuses.at(-1), 'offline');
  assert.equal(upserts(t.db).length, 0, 'nothing sent offline');
  assert.equal(t.sync.status().pending, 1, 'kept for later');
  t.setOnline(true);
  await t.sync.flush();
  assert.equal(upserts(t.db).length, 1, 'sent when back online');
  assert.deepEqual(t.db.rows.get('user-1|editor').design, design('offline work'));
}
{
  const t = setup();
  t.setUser(null);
  t.sync.queue('editor', record('x', t.db.now()));
  await t.sync.flush();
  assert.equal(t.statuses.at(-1), 'signed-out');
  assert.equal(t.sync.status().pending, 1);
}
{
  const t = setup();
  t.sync.queue('editor', record('x', t.db.now()));
  t.db.failNext = { code: '08006', message: 'network down' };
  await t.sync.flush();
  assert.equal(t.statuses.at(-1), 'error');
  assert.equal(t.sync.status().pending, 1, 'kept after a failed write');
  assert.equal(t.timers.pending().at(-1).ms, 30000, 'retries in 30 s');
  await t.timers.runAll();
  assert.equal(upserts(t.db).length, 1, 'retried and saved');
  assert.equal(t.sync.status().status, 'synced');
}
{
  const t = setup();
  t.db.missing = true;
  t.sync.queue('editor', record('x', t.db.now()));
  await t.sync.flush();
  assert.equal(t.statuses.at(-1), 'off', 'table missing: switched off quietly');
  assert.equal(t.sync.isDisabled(), true);
  assert.equal(t.sync.queue('editor', record('y', t.db.now())), false, 'stops trying for this page load');
  assert.deepEqual(await t.sync.list(), { ready: false, rows: [] });
  assert.equal(await t.sync.newerRemote('editor', 0), null);
  assert.equal(isMissingTable({ code: '42P01', message: 'relation "frameup_drafts" does not exist' }), true);
  assert.equal(isMissingTable({ code: '08006', message: 'timeout' }), false);
}

// ── 3. Conflicts ────────────────────────────────────────────────────────────
for (const choice of ['mine', 'theirs']) {
  const t = setup({ choice });
  const localSavedAt = t.db.now();
  t.db.writeAs('user-1', 'editor', { device_id: 'laptop-B', design: design('from B'), local_photos: 2 });
  t.sync.queue('editor', record('from A', localSavedAt));
  await t.sync.flush();
  assert.equal(t.conflicts.length, 1, `${choice}: newer draft from another device asks first`);
  assert.equal(t.conflicts[0].remote.device_id, 'laptop-B');
  assert.deepEqual(t.conflicts[0].remote.design, design('from B'), 'the prompt gets the full remote draft');
  assert.deepEqual(t.conflicts[0].local.design, design('from A'));
  if (choice === 'mine') {
    assert.deepEqual(t.db.rows.get('user-1|editor').design, design('from A'), 'keep this one: ours is written');
    assert.equal(t.applied.length, 0);
  } else {
    assert.deepEqual(t.db.rows.get('user-1|editor').design, design('from B'), 'open the newer one: nothing overwritten');
    assert.equal(t.applied.length, 1, 'the newer draft is opened');
    assert.equal(upserts(t.db).length, 0);
  }
  assert.equal(t.sync.status().pending, 0);
}
{
  // Synced once, then laptop B saves: the next save from A asks.
  const t = setup();
  t.sync.queue('editor', record('v1', t.db.now()));
  await t.sync.flush();
  t.db.writeAs('user-1', 'editor', { device_id: 'laptop-B', design: design('B edit') });
  t.sync.queue('editor', record('v2 from A', t.db.now() - 60000));
  await t.sync.flush();
  assert.equal(t.conflicts.length, 1, 'B saved since A last synced → prompt');
}

// ── 4. No prompt when it isn't a real conflict ──────────────────────────────
{
  const t = setup();
  t.db.writeAs('user-1', 'editor', { device_id: 'laptop-A', design: design('earlier from A') });
  t.sync.queue('editor', record('A again', t.db.now() - 600000));
  await t.sync.flush();
  assert.equal(t.conflicts.length, 0, 'own device: last write wins');
}
{
  const t = setup();
  t.db.writeAs('user-1', 'editor', { device_id: 'laptop-B', design: design('old B') });
  t.sync.queue('editor', record('newer A', t.db.now() + 60000));
  await t.sync.flush();
  assert.equal(t.conflicts.length, 0, 'remote older than this save: newest wins, no prompt');
  assert.deepEqual(t.db.rows.get('user-1|editor').design, design('newer A'));
}
{
  const t = setup();
  t.db.writeAs('user-1', 'design:abc', { kind: 'design', device_id: 'laptop-B', design: design('export') });
  t.sync.queue('design:abc', { kind: 'design', title: 'Export', design: design('export again'), savedAt: 0 });
  await t.sync.flush();
  assert.equal(t.conflicts.length, 0, 'exported designs never prompt');
  assert.equal(t.db.calls.filter(call => call.op === 'select').length, 0, 'and skip the conflict read');
}
{
  // While a prompt is open, later saves wait instead of opening a second one.
  let release;
  const t = setup({ options: { onConflict: () => new Promise(resolve => { release = resolve; }) } });
  t.db.writeAs('user-1', 'editor', { device_id: 'laptop-B', design: design('B') });
  t.sync.queue('editor', record('A1', t.db.now() - 100000));
  const first = t.sync.flush();
  await new Promise(resolve => setImmediate(resolve));
  t.sync.queue('editor', record('A2', t.db.now() - 100000));
  const second = t.sync.flush();
  release('mine');
  await first; await second;
  assert.deepEqual(t.db.rows.get('user-1|editor').design, design('A2'), 'the latest local save is written after the answer');
}

// ── 5. Opening the editor elsewhere, list, remove ───────────────────────────
{
  const t = setup();
  const local = t.db.now();
  t.db.writeAs('user-1', 'editor', { device_id: 'laptop-B', design: design('B work') });
  const newer = await t.sync.newerRemote('editor', local);
  assert.ok(newer, 'newer draft from another device is offered');
  assert.deepEqual(newer.design, design('B work'));
  t.sync.markSeen('editor', newer.updated_at);
  assert.equal(await t.sync.newerRemote('editor', local), null, 'not offered twice');
}
{
  const t = setup();
  t.db.writeAs('user-1', 'editor', { device_id: 'laptop-A', design: design('mine') });
  assert.equal(await t.sync.newerRemote('editor', 0), null, 'own device: nothing to offer');
  const t2 = setup();
  t2.db.writeAs('user-1', 'editor', { device_id: 'laptop-B', design: design('old') });
  assert.equal(await t2.sync.newerRemote('editor', t2.db.now() + 60000), null, 'older than local: nothing to offer');
}
{
  const t = setup();
  t.db.writeAs('user-1', 'editor', { device_id: 'laptop-B', design: design('w') });
  t.db.writeAs('user-1', 'design:1', { kind: 'design', device_id: 'laptop-B', title: 'Final score', design: design('d') });
  t.db.writeAs('someone-else', 'editor', { device_id: 'x', design: design('not mine') });
  const { ready, rows } = await t.sync.list();
  assert.equal(ready, true);
  assert.deepEqual(rows.map(row => row.draft_key), ['design:1', 'editor'], 'own drafts only, newest first');
  const listCall = t.db.calls.filter(call => call.op === 'select' && call.mode === 'many').at(-1);
  assert.ok(!listCall.cols.split(',').includes('design'), 'the list does not download the drafts themselves');
  assert.equal(await t.sync.remove('design:1'), true);
  assert.equal(t.db.rows.has('user-1|design:1'), false);
  assert.equal(t.db.rows.has('someone-else|editor'), true);
}

// ── 6. Editor wiring and the conflict prompt ───────────────────────────────
const { install } = require('../frameup-cloud-drafts.js');
async function editorWith({ hasLocalWork, answer }) {
  const db = createMockDb();
  db.writeAs('user-1', 'editor', { device_id: 'laptop-B', design: design('started on laptop B'), local_photos: 1, updated_at: undefined });
  const dialogs = [];
  const applied = [];
  const toasts = [];
  const listeners = {};
  const win = {
    document: { addEventListener() {}, visibilityState: 'visible' },
    navigator: { onLine: true },
    localStorage: { store: {}, getItem(k) { return this.store[k] || null; }, setItem(k, v) { this.store[k] = v; } },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    ESAuth: {
      ensureSupabaseReady: async () => true,
      getSupabaseClient: () => ({ ...db.client, auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1', email: 'designer@essentiallysports.com' } } } }) } }),
    },
    FrameUpAutosave: {
      restored: Promise.resolve({ savedAt: Date.parse('2026-11-18T09:00:00Z') }),
      hasLocalWork: () => hasLocalWork,
      cloudSnapshot: () => ({ payload: design('local work on A'), workspace: 'instagram', localPhotos: 0 }),
      applyCloudPayload: async payload => { applied.push(payload); },
    },
    showEsDialog(options) {
      dialogs.push(options);
      const action = options.actions.find(item => item.label === answer);
      setTimeout(() => action.onClick(), 0);
    },
    showToast: (message, tone) => toasts.push({ message, tone }),
  };
  win.top = win;
  install(win);
  await new Promise(resolve => setTimeout(resolve, 30));
  return { db, dialogs, applied, toasts, win };
}
{
  const e = await editorWith({ hasLocalWork: true, answer: 'Open the newer one' });
  assert.equal(e.dialogs.length, 1, 'work in both places: asks');
  assert.equal(e.dialogs[0].title, 'A newer version is on another device');
  assert.match(e.dialogs[0].body, /saved on another device/);
  assert.match(e.dialogs[0].body, /1 photo/, 'mentions photos that stayed on the other device');
  assert.deepEqual(e.dialogs[0].actions.map(action => action.label), ['Keep this one', 'Open the newer one']);
  assert.deepEqual(e.applied, [design('started on laptop B')], 'opens the newer draft');
  assert.match(e.toasts.at(-1).message, /from another device/);
}
{
  const e = await editorWith({ hasLocalWork: true, answer: 'Keep this one' });
  assert.equal(e.dialogs.length, 1);
  assert.equal(e.applied.length, 0, 'keeps this browser\'s work');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(e.db.rows.get('user-1|editor').design, design('local work on A'), 'and makes it the newest copy everywhere');
}
{
  const e = await editorWith({ hasLocalWork: false, answer: 'unused' });
  assert.equal(e.dialogs.length, 0, 'empty editor: no question');
  assert.deepEqual(e.applied, [design('started on laptop B')], 'the draft from laptop B just opens');
  assert.ok(e.win.FrameUpCloudDrafts, 'API exposed for Recent designs');
}

console.log('cloud drafts: ok');
