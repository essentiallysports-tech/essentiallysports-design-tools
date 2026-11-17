'use strict';
// The shared clip library for Video Ads (migration
// supabase/migrations/20261118121700_frameup_clip_library.sql).
//
// One row per verified clip (X, Reddit, Bluesky, Streamable, ...). Written by
// the prefetch cron (clips-prefetch.js) and by every live clip search; read
// first by find-clips, moments-with-clips and the Clip library tab, so a
// search is usually instant and free.
//
// Storage, best first:
//   1. Supabase, with SUPABASE_SERVICE_ROLE_KEY (server only, never sent to
//      the browser). Reads fall back to the caller's own token (RLS lets
//      signed-in ES users read) when the service key is missing; writes need
//      the service key.
//   2. Memory, per server instance: always written too, so the instance's own
//      finds stay available, and the only store before the migration is run
//      (a missing table is detected and retried every 10 minutes).
// CLIPS_LIBRARY=off switches the library off entirely (reads empty, writes
// dropped).
//
// Never throws: the library must never break a search.
const { authConfig } = require('./_supabase-auth.js');
const { request, serviceRoleKey } = require('./_supabase-rest.js');

const TABLE = 'frameup_clip_library';
const RUNS = 'frameup_clip_prefetch_runs';
const SPORTS = ['nfl', 'cfb', 'mlb'];
const KEEP_DAYS = 7;
const FRESH_HOURS = 120;
const MEMORY_MAX = 3000;
const RETRY_MS = 10 * 60e3;
const TIMEOUT_MS = 4000;
const SOURCE_KINDS = ['official', 'league', 'media', 'fan'];

const memory = new Map(); // url -> row
const memoryRuns = [];
const state = { installed: null, checkedAt: 0, lastError: '' };

const isOff = value => /^(off|0|false|no|disabled)$/i.test(String(value ?? '').trim());
const enabled = (env = process.env) => !isOff(env.CLIPS_LIBRARY);
const str = (value, max) => String(value ?? '').slice(0, max);
const int = value => (Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0);
const isoOf = value => {
  const at = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(at) ? new Date(at).toISOString() : '';
};
const hoursSince = (iso, now = Date.now()) => (now - new Date(iso).getTime()) / 3600e3;

function remoteReady(env = process.env) {
  if (!enabled(env)) return false;
  let url = '';
  try { url = authConfig().url; } catch { url = ''; }
  if (!url) return false;
  if (state.installed === false && Date.now() - state.checkedAt < RETRY_MS) return false;
  return true;
}
const canWrite = (env = process.env) => remoteReady(env) && Boolean(serviceRoleKey(env));

function timedFetch(url, init) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

// One PostgREST call; null on any problem (and remembers a missing table).
async function rest(path, options) {
  try {
    const data = await request(path, options, timedFetch);
    if (state.installed !== true) { state.installed = true; state.checkedAt = Date.now(); }
    return { ok: true, data };
  } catch (error) {
    if (error?.code === 'not_installed') { state.installed = false; state.checkedAt = Date.now(); }
    state.lastError = String(error?.code || error?.status || error?.name || 'error').slice(0, 40);
    return { ok: false, error };
  }
}

// ── Shapes ────────────────────────────────────────────────────────────────
// A clip from video-ads.js (assessClip shape + platform / sourceKind) -> row.
function toRow(clip, { sport, teams = [], players = [], foundBy = '' } = {}) {
  const variants = (Array.isArray(clip.variants) ? clip.variants : [])
    .filter(v => v && /^https:\/\//.test(String(v.url || '')))
    .slice(0, 6)
    .map(v => ({ url: str(v.url, 1200), width: int(v.width), height: int(v.height), bitrate: int(v.bitrate) }));
  const best = variants[0] || {};
  const kind = clip.sourceKind || (clip.source === 'other' ? 'fan' : clip.source);
  return {
    url: str(clip.url, 400),
    platform: str(clip.platform || 'x', 24),
    handle: str(String(clip.handle || '').replace(/^@/, ''), 80),
    sport,
    teams: [...new Set([...(clip.teams || []), ...teams].map(t => str(t, 80)).filter(Boolean))].slice(0, 8),
    players: [...new Set([...(clip.players || []), ...players].map(p => str(p, 80)).filter(Boolean))].slice(0, 8),
    title: str(clip.text || clip.title, 400),
    posted_at: isoOf(clip.postedAt),
    media_url: str(clip.mediaUrl || best.url || '', 1200),
    variants,
    thumb: str(clip.thumb || clip.thumbnail || '', 1200),
    duration_ms: int(clip.durationMs),
    width: int(clip.width || best.width),
    height: int(clip.height || best.height),
    has_audio: typeof clip.hasAudio === 'boolean' ? clip.hasAudio : null,
    source_kind: SOURCE_KINDS.includes(kind) ? kind : 'fan',
    found_by: str(clip.foundBy || foundBy, 24),
    media_key: str(clip.mediaKey || '', 300),
    score: Number(clip.score) || 0,
    likes: int(clip.likes),
    views: int(clip.views),
    last_checked: new Date().toISOString(),
    dead: false,
  };
}

// Row -> the clip shape the page and video-ads.js use.
function fromRow(row, now = Date.now()) {
  const variants = Array.isArray(row.variants) && row.variants.length
    ? row.variants
    : (row.media_url ? [{ url: row.media_url, width: row.width || 0, height: row.height || 0, bitrate: 0 }] : []);
  const side = row.width && row.height ? Math.min(row.width, row.height) : 0;
  const kind = SOURCE_KINDS.includes(row.source_kind) ? row.source_kind : 'fan';
  return {
    url: row.url,
    platform: row.platform || 'x',
    handle: row.handle || '',
    text: row.title || '',
    thumb: row.thumb || '',
    duration: Math.round((row.duration_ms || 0) / 100) / 10,
    durationMs: row.duration_ms || 0,
    postedAt: isoOf(row.posted_at),
    ageHours: Math.round(Math.max(0, hoursSince(row.posted_at, now))),
    variants,
    source: kind === 'fan' ? 'other' : kind,
    sourceKind: kind,
    quality: !side ? '' : side >= 1080 ? '1080p' : side >= 720 ? '720p' : `${side}p`,
    shortSide: side,
    likes: Number(row.likes || 0),
    views: Number(row.views || 0),
    teams: Array.isArray(row.teams) ? row.teams : [],
    players: Array.isArray(row.players) ? row.players : [],
    ...(typeof row.has_audio === 'boolean' ? { hasAudio: row.has_audio } : {}),
    foundBy: row.found_by || '',
    mediaKey: row.media_key || '',
    firstSeen: isoOf(row.first_seen),
    score: Number(row.score || 0),
    fromLibrary: true,
  };
}

// ── Memory store ──────────────────────────────────────────────────────────
function memoryPut(row) {
  const had = memory.get(row.url);
  memory.set(row.url, { ...had, ...row, first_seen: had?.first_seen || new Date().toISOString() });
  while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
}
function memoryQuery({ sport, teams, sinceIso, includeDead = false }) {
  const since = sinceIso ? new Date(sinceIso).getTime() : 0;
  const wanted = (teams || []).map(t => t.toLowerCase());
  return [...memory.values()].filter(row => (!sport || row.sport === sport)
    && (includeDead || !row.dead)
    && new Date(row.posted_at).getTime() >= since
    && (!wanted.length || (row.teams || []).some(t => wanted.includes(String(t).toLowerCase()))));
}

// PostgREST `in.(...)` filter, URL-encoded (signed media URLs carry ? and &).
const inList = list => encodeURIComponent(`in.(${list.map(u => `"${String(u).replace(/["\\]/g, '')}"`).join(',')})`);

// ── Public API ────────────────────────────────────────────────────────────
// Rows for a sport (optionally only these teams), posted after sinceHours
// ago, newest first, dead rows left out. -> clips (fromRow shape).
async function read({ sport, teams = [], sinceHours = KEEP_DAYS * 24, limit = 300, token = '' } = {}) {
  if (!enabled() || (sport && !SPORTS.includes(sport))) return [];
  const sinceIso = new Date(Date.now() - sinceHours * 3600e3).toISOString();
  const rows = new Map(memoryQuery({ sport, teams, sinceIso }).map(r => [r.url, r]));
  const service = Boolean(serviceRoleKey());
  if (remoteReady() && (service || token)) {
    const params = new URLSearchParams({
      select: '*', dead: 'is.false', posted_at: `gte.${sinceIso}`, order: 'posted_at.desc', limit: String(Math.min(1000, limit)),
    });
    if (sport) params.set('sport', `eq.${sport}`);
    if (teams.length) params.set('teams', `ov.{${teams.map(t => `"${String(t).replace(/["\\]/g, '')}"`).join(',')}}`);
    const got = await rest(`${TABLE}?${params}`, service ? { service: true } : { token });
    if (got.ok && Array.isArray(got.data)) got.data.forEach(r => { if (!rows.has(r.url)) rows.set(r.url, r); });
  }
  const now = Date.now();
  return [...rows.values()]
    .sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at))
    .slice(0, limit)
    .map(r => fromRow(r, now));
}

// Upserts verified clips. Each item: { clip, sport, teams, players, foundBy }.
// -> { written, remote }
async function write(items = []) {
  if (!enabled()) return { written: 0, remote: false };
  const rows = [];
  const seen = new Set();
  items.forEach(item => {
    if (!item?.clip?.url || !SPORTS.includes(item.sport)) return;
    const row = toRow(item.clip, item);
    if (!row.posted_at || !row.variants.length || seen.has(row.url)) return;
    // Merge the teams of an earlier row for the same url.
    const had = memory.get(row.url);
    if (had) row.teams = [...new Set([...(had.teams || []), ...row.teams])].slice(0, 8);
    seen.add(row.url);
    rows.push(row);
    memoryPut(row);
  });
  if (!rows.length || !canWrite()) return { written: rows.length, remote: false };
  const got = await rest(`${TABLE}?on_conflict=url`, {
    method: 'POST', service: true, body: rows, prefer: 'resolution=merge-duplicates,return=minimal',
  });
  return { written: rows.length, remote: got.ok };
}

// Marks links dead (the post or file is gone). -> count
async function markDead(urls = []) {
  const list = [...new Set(urls)].filter(Boolean).slice(0, 100);
  if (!enabled() || !list.length) return 0;
  list.forEach(url => { const row = memory.get(url); if (row) row.dead = true; });
  if (canWrite()) {
    await rest(`${TABLE}?url=${inList(list)}`, {
      method: 'PATCH', service: true, body: { dead: true, last_checked: new Date().toISOString() }, prefer: 'return=minimal',
    });
  }
  return list.length;
}

// Stamps last_checked on links that are still alive.
async function touch(urls = []) {
  const list = [...new Set(urls)].filter(Boolean).slice(0, 100);
  if (!enabled() || !list.length) return 0;
  const at = new Date().toISOString();
  list.forEach(url => { const row = memory.get(url); if (row) row.last_checked = at; });
  if (canWrite()) {
    await rest(`${TABLE}?url=${inList(list)}`, {
      method: 'PATCH', service: true, body: { last_checked: at }, prefer: 'return=minimal',
    });
  }
  return list.length;
}

// Rows not checked for `olderThanHours` (alive, still in the window), oldest check first.
async function staleRows({ olderThanHours = 6, limit = 20 } = {}) {
  if (!enabled()) return [];
  const before = Date.now() - olderThanHours * 3600e3;
  const fromMemory = [...memory.values()].filter(r => !r.dead && new Date(r.last_checked).getTime() < before);
  const rows = new Map(fromMemory.map(r => [r.url, r]));
  if (canWrite()) {
    const params = new URLSearchParams({
      select: 'url,platform,media_url,sport,last_checked', dead: 'is.false',
      last_checked: `lt.${new Date(before).toISOString()}`, order: 'last_checked.asc', limit: String(limit),
    });
    const got = await rest(`${TABLE}?${params}`, { service: true });
    if (got.ok && Array.isArray(got.data)) got.data.forEach(r => rows.set(r.url, r));
  }
  return [...rows.values()].sort((a, b) => new Date(a.last_checked) - new Date(b.last_checked)).slice(0, limit);
}

// Deletes rows whose post is older than `days`. -> { memory, remote }
async function purge({ days = KEEP_DAYS } = {}) {
  if (!enabled()) return { memory: 0, remote: false };
  const cut = Date.now() - days * 24 * 3600e3;
  let gone = 0;
  [...memory.values()].forEach(row => { if (new Date(row.posted_at).getTime() < cut) { memory.delete(row.url); gone += 1; } });
  let remote = false;
  if (canWrite()) {
    const got = await rest(`${TABLE}?posted_at=lt.${new Date(cut).toISOString()}`, { method: 'DELETE', service: true, prefer: 'return=minimal' });
    remote = got.ok;
  }
  return { memory: gone, remote };
}

// ── Prefetch run summaries ────────────────────────────────────────────────
async function recordRun(summary) {
  const row = { started_at: summary.startedAt || new Date().toISOString(), ms: int(summary.ms), cost_usd: Number(summary.cost || 0), summary };
  memoryRuns.unshift(row);
  memoryRuns.length = Math.min(memoryRuns.length, 50);
  if (canWrite()) await rest(RUNS, { method: 'POST', service: true, body: row, prefer: 'return=minimal' });
}

// Recent runs, newest first. The caller decides who may see them.
async function recentRuns({ hours = 24, limit = 60 } = {}) {
  const since = Date.now() - hours * 3600e3;
  const rows = new Map(memoryRuns.filter(r => new Date(r.started_at).getTime() >= since).map(r => [r.started_at, r]));
  if (remoteReady() && serviceRoleKey()) {
    const params = new URLSearchParams({ select: '*', started_at: `gte.${new Date(since).toISOString()}`, order: 'started_at.desc', limit: String(limit) });
    const got = await rest(`${RUNS}?${params}`, { service: true });
    if (got.ok && Array.isArray(got.data)) got.data.forEach(r => rows.set(r.started_at, r));
  }
  return [...rows.values()].sort((a, b) => new Date(b.started_at) - new Date(a.started_at)).slice(0, limit);
}

// AI spend of the prefetch runs today (UTC), for the daily cap.
async function spentToday() {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const runs = await recentRuns({ hours: (Date.now() - midnight.getTime()) / 3600e3, limit: 200 });
  return runs.reduce((sum, r) => sum + Number(r.cost_usd || 0), 0);
}

// Counts for the admin diagnostics: per sport, team, platform, source kind.
async function stats() {
  const rows = new Map([...memory.values()].map(r => [r.url, r]));
  if (remoteReady() && serviceRoleKey()) {
    const params = new URLSearchParams({ select: 'url,sport,teams,platform,source_kind,found_by,posted_at,dead,first_seen', limit: '5000' });
    const got = await rest(`${TABLE}?${params}`, { service: true });
    if (got.ok && Array.isArray(got.data)) got.data.forEach(r => rows.set(r.url, r));
  }
  const now = Date.now();
  const out = { total: 0, dead: 0, fresh: 0, older: 0, addedLast24h: 0, bySport: {}, byTeam: {}, byPlatform: {}, bySourceKind: {}, byFinder: {}, newestAt: '' };
  const bump = (bucket, key) => { if (key) bucket[key] = (bucket[key] || 0) + 1; };
  rows.forEach(r => {
    out.total += 1;
    if (r.dead) { out.dead += 1; return; }
    const age = hoursSince(r.posted_at, now);
    if (age <= FRESH_HOURS) out.fresh += 1; else out.older += 1;
    if (r.first_seen && hoursSince(r.first_seen, now) <= 24) out.addedLast24h += 1;
    bump(out.bySport, r.sport);
    (r.teams || []).forEach(t => bump(out.byTeam, `${r.sport}:${t}`));
    bump(out.byPlatform, r.platform);
    bump(out.bySourceKind, r.source_kind);
    bump(out.byFinder, r.found_by);
    if (!out.newestAt || new Date(r.posted_at) > new Date(out.newestAt)) out.newestAt = isoOf(r.posted_at);
  });
  return out;
}

// Where the library lives right now (no secrets: booleans and a store name).
function status(env = process.env) {
  if (!enabled(env)) return { store: 'off', installed: null, writes: false };
  return {
    store: remoteReady(env) && state.installed !== false ? 'supabase+memory' : 'memory',
    installed: state.installed,
    writes: canWrite(env),
    serviceKey: Boolean(serviceRoleKey(env)),
    memoryRows: memory.size,
    ...(state.lastError ? { lastError: state.lastError } : {}),
  };
}

function _reset() {
  memory.clear();
  memoryRuns.length = 0;
  state.installed = null;
  state.checkedAt = 0;
  state.lastError = '';
}

module.exports = {
  TABLE, RUNS, KEEP_DAYS, FRESH_HOURS,
  enabled, read, write, markDead, touch, staleRows, purge, recordRun, recentRuns, spentToday, stats, status,
  toRow, fromRow,
  _test: { memory, memoryRuns, state, reset: _reset },
};
