'use strict';
// Merch Brainstorm boards (migration 20261127090000_frameup_merch_brainstorm.sql).
// Server-only: writes use the service role (SUPABASE_SERVICE_ROLE_KEY). ES
// users may read the table through RLS; only this server writes.
//
// Before the migration runs (or without the service key) boards live in this
// instance's memory: same API, `storage: 'memory'`, not shared, lost on a
// cold start. A missing table switches to memory for 10 minutes, then the
// database is tried again.
//
// Concurrency: mutate(id, fn) reads the row, applies fn to a copy, and PATCHes
// with `updated_at=eq.<the value read>`. When someone else wrote in between
// (0 rows updated) it re-reads and applies fn again, once; a second clash
// throws { code: 'busy' }.
//
// Rows are returned as plain board objects:
//   { id, key, trendId, title, sport, team, context, lines, turns, createdBy, createdAt, updatedAt, storage }

const crypto = require('node:crypto');
const rest = require('./_supabase-rest.js');

const TABLE = 'frameup_merch_brainstorm';
const MEMORY_MAX = 200;
const RETRY_DB_MS = 10 * 60 * 1000;
const enc = encodeURIComponent;

const MEMORY = new Map(); // id -> board
let dbOffUntil = 0;
let fetchImpl = null; // tests

const hasKey = (env = process.env) => Boolean(rest.serviceRoleKey(env));
const useDb = () => hasKey() && Date.now() >= dbOffUntil;
const mode = () => (useDb() ? 'db' : 'memory');

function storeError(message, code, status = 500) {
  return Object.assign(new Error(message), { code, status });
}
// A missing table / function (the migration hasn't run) or no key: memory.
const missing = error => error && (error.code === 'not_installed' || error.status === 503);

function req(path, options = {}) {
  return fetchImpl ? rest.request(path, { ...options, service: true }, fetchImpl) : rest.request(path, { ...options, service: true });
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id, key: row.key, trendId: row.trend_id || null, title: row.title || '', sport: row.sport || '', team: row.team || null,
    context: row.context && typeof row.context === 'object' ? row.context : {},
    lines: Array.isArray(row.lines) ? row.lines : [], turns: Array.isArray(row.turns) ? row.turns : [],
    createdBy: row.created_by || '', createdAt: row.created_at, updatedAt: row.updated_at, storage: 'db',
  };
}
function toRow(board) {
  return {
    key: board.key, trend_id: board.trendId || null, title: String(board.title || '').slice(0, 300), sport: String(board.sport || '').slice(0, 20),
    team: board.team || null, context: board.context || {}, lines: board.lines || [], turns: board.turns || [], created_by: String(board.createdBy || '').slice(0, 200),
  };
}
const copy = board => JSON.parse(JSON.stringify(board));

// Run a database step; on a missing table fall back to memory (and stay there for a while).
async function withDb(dbFn, memFn) {
  if (!useDb()) return memFn();
  try { return await dbFn(); } catch (error) {
    if (missing(error)) {
      dbOffUntil = Date.now() + RETRY_DB_MS;
      console.warn(`merch brainstorm: ${TABLE} unavailable (${error.code || error.status}); boards kept in memory`);
      return memFn();
    }
    throw error;
  }
}

// ─── Memory ─────────────────────────────────────────────────────────────────
// Strictly increasing times, so "newest first" and the updated_at guard never tie.
let lastStamp = 0;
const stamp = () => { lastStamp = Math.max(Date.now(), lastStamp + 1); return new Date(lastStamp).toISOString(); };
const memByKey = key => [...MEMORY.values()].find(b => b.key === key) || null;
function memPut(board) {
  MEMORY.set(board.id, board);
  if (MEMORY.size > MEMORY_MAX) {
    const oldest = [...MEMORY.values()].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))[0];
    if (oldest) MEMORY.delete(oldest.id);
  }
  return copy(board);
}

// ─── API ────────────────────────────────────────────────────────────────────
async function getByKey(key) {
  return withDb(async () => {
    const rows = await req(`${TABLE}?key=eq.${enc(key)}&select=*&limit=1`);
    return fromRow(Array.isArray(rows) ? rows[0] : null);
  }, () => { const b = memByKey(key); return b ? copy(b) : null; });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function get(id) {
  const sid = String(id || '');
  if (!UUID.test(sid) && !/^bs-[0-9a-f]{8,32}$/.test(sid)) return null;
  // A memory id never hits the database (and vice versa).
  if (sid.startsWith('bs-')) { const b = MEMORY.get(sid); return b ? copy(b) : null; }
  return withDb(async () => {
    const rows = await req(`${TABLE}?id=eq.${enc(sid)}&select=*&limit=1`);
    return fromRow(Array.isArray(rows) ? rows[0] : null);
  }, () => null);
}

// Creates the board for `key`, or returns the one a teammate created first.
// -> { board, created }
async function create(board) {
  return withDb(async () => {
    const rows = await req(`${TABLE}?on_conflict=key`, { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: toRow(board) });
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row) return { board: fromRow(row), created: true };
    const have = await getByKey(board.key);
    if (!have) throw storeError('The board could not be saved.', 'store');
    return { board: have, created: false };
  }, () => {
    const have = memByKey(board.key);
    if (have) return { board: copy(have), created: false };
    const now = stamp();
    return { board: memPut({ ...copy(board), id: `bs-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, createdAt: now, updatedAt: now, storage: 'memory' }), created: true };
  });
}

// fn(board) -> the changed board, or null for "nothing to change".
// -> the saved board (or the unchanged one).
async function mutate(id, fn) {
  const sid = String(id || '');
  if (sid.startsWith('bs-')) {
    const have = MEMORY.get(sid);
    if (!have) throw storeError('That brainstorm board is gone. Open it again from the moment.', 'not-found', 404);
    const next = await fn(copy(have));
    if (!next) return copy(have);
    return memPut({ ...next, id: have.id, key: have.key, createdAt: have.createdAt, updatedAt: stamp(), storage: 'memory' });
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const have = await get(sid);
    if (!have) throw storeError('That brainstorm board is gone. Open it again from the moment.', 'not-found', 404);
    const next = await fn(copy(have));
    if (!next) return have;
    const row = { ...toRow(next), updated_at: new Date().toISOString() };
    delete row.key; delete row.created_by;
    const rows = await req(`${TABLE}?id=eq.${enc(sid)}&updated_at=eq.${enc(have.updatedAt)}`, { method: 'PATCH', prefer: 'return=representation', body: row });
    if (Array.isArray(rows) && rows[0]) return fromRow(rows[0]);
  }
  throw storeError('Someone else just changed this board. Try again.', 'busy', 409);
}

async function recent(limit = 20) {
  const n = Math.max(1, Math.min(50, Math.round(Number(limit) || 20)));
  return withDb(async () => {
    const rows = await req(`${TABLE}?select=id,key,trend_id,title,sport,lines,turns,created_by,updated_at&order=updated_at.desc&limit=${n}`);
    return (Array.isArray(rows) ? rows : []).map(fromRow);
  }, () => [...MEMORY.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, n).map(copy));
}

module.exports = {
  TABLE, mode, get, getByKey, create, mutate, recent, fromRow, toRow,
  _test: {
    MEMORY,
    reset() { MEMORY.clear(); dbOffUntil = 0; fetchImpl = null; },
    setFetch(fn) { fetchImpl = fn; },
    dbOff() { return dbOffUntil > Date.now(); },
  },
};
