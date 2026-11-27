'use strict';
// Reels v4: the confirmed-clip library (migration
// supabase/migrations/20261130090000_frameup_reel_clip_confirmed.sql).
//
// A clip the vision judge confirmed for a subject (player / person / team /
// game) is kept per subject key with its best segment, so the next reel about
// that subject gets it for free (no search, no judge call). People's choices
// rank it: kept / exported +1, swapped out -1 (ReelSourcing.rank).
//
//   keysFor(subject, { sport })        -> ['player:george kittle', 'team:…', 'game:…|2026-11-23']
//   read(keys, { kind, token, limit }) -> [{ key, url, kind, clip, relevance, moment, segment, rank }]
//   confirm(entries)                   -> { written, remote }
//   rank(url, keys, delta)             -> { ok, rank }
//
// Storage: Supabase with SUPABASE_SERVICE_ROLE_KEY (reads may use the
// caller's token: ES users read); memory per server instance always (the only
// store before the migration runs; a missing table is retried every 10 min).
// REELS_CLIP_LIBRARY=off switches it off. Never throws.
const { authConfig } = require('./_supabase-auth.js');
const { request, serviceRoleKey } = require('./_supabase-rest.js');

const TABLE = 'frameup_reel_clip_confirmed';
const MEMORY_MAX = 2000;
const RETRY_MS = 10 * 60e3;
const TIMEOUT_MS = 3000;
const MIN_RANK = -3; // swapped out three times more than kept: no longer offered
const KINDS = ['clip', 'presser'];
const memory = new Map(); // `${key}|${url}` -> row
const state = { installed: null, checkedAt: 0, lastError: '' };

const norm = v => String(v == null ? '' : v).toLowerCase().normalize('NFKD').replace(/[^\w\s|:-]/g, ' ').replace(/\s+/g, ' ').trim();
const isOff = v => /^(off|0|false|no|disabled)$/i.test(String(v ?? '').trim());
const enabled = (env = process.env) => !isOff(env.REELS_CLIP_LIBRARY);
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

function remoteReady() {
  if (!enabled()) return false;
  let url = '';
  try { url = authConfig().url; } catch { url = ''; }
  if (!url) return false;
  return !(state.installed === false && Date.now() - state.checkedAt < RETRY_MS);
}
async function rest(path, options, fetchImpl) {
  try {
    const data = await request(path, options, fetchImpl || ((u, init) => fetch(u, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })));
    state.installed = true; state.checkedAt = Date.now();
    return { ok: true, data };
  } catch (error) {
    if (error?.code === 'not_installed' || /PGRST205|42P01|does not exist/i.test(String(error?.message || error?.code || ''))) { state.installed = false; state.checkedAt = Date.now(); }
    state.lastError = String(error?.code || error?.status || error?.name || 'error').slice(0, 40);
    return { ok: false, error };
  }
}

// Subject -> its library keys, most specific first.
function keysFor(subject = {}, { sport = '' } = {}) {
  const out = [];
  const name = norm(subject.name).slice(0, 60);
  const team = norm(subject.team).slice(0, 60);
  const type = ['player', 'person', 'team', 'game', 'moment'].includes(subject.type) ? subject.type : 'player';
  const date = String(subject.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? subject.date : '';
  if ((type === 'player' || type === 'person') && name) out.push(`${type === 'person' ? 'person' : 'player'}:${name}`);
  if (type === 'game' && name) out.push(`game:${name}${date ? `|${date}` : ''}`);
  if (team && date) out.push(`game:${team}|${date}`);
  if (type === 'team' && name) out.push(`team:${name}`);
  else if (team) out.push(`team:${team}`);
  void sport;
  return [...new Set(out)].filter(k => k.length >= 3).slice(0, 4);
}

// The slim clip kept with a row (what the page needs to play it again).
const CLIP_FIELDS = ['url', 'handle', 'text', 'variants', 'durationMs', 'source', 'sourceKind', 'platform', 'teams', 'players', 'postedAt', 'shortSide', 'trust', 'thumb'];
function slimClip(c = {}) {
  const out = {};
  CLIP_FIELDS.forEach(k => { if (c[k] !== undefined) out[k] = c[k]; });
  out.variants = (Array.isArray(out.variants) ? out.variants : []).filter(v => v && /^https:\/\//.test(String(v.url || ''))).slice(0, 4)
    .map(v => ({ url: String(v.url).slice(0, 400), width: Number(v.width) || 0, height: Number(v.height) || 0 }));
  if (out.text) out.text = String(out.text).slice(0, 280);
  return out;
}
function rowOf(e) {
  const seg = e.segment && Number.isFinite(Number(e.segment.start)) && Number(e.segment.end) > Number(e.segment.start)
    ? { start: Number(e.segment.start), end: Number(e.segment.end) } : null;
  return {
    key: String(e.key).slice(0, 120), url: String(e.url).slice(0, 400), kind: KINDS.includes(e.kind) ? e.kind : 'clip', sport: String(e.sport || '').slice(0, 8),
    clip: slimClip({ ...e.clip, url: e.url }), relevance: clampInt(e.relevance, 0, 10), moment: e.moment == null ? null : clampInt(e.moment, 0, 10),
    segment: seg, rank: clampInt(e.rank, -20, 50), kept: clampInt(e.kept, 0, 1e6), swapped: clampInt(e.swapped, 0, 1e6),
    confirmed_at: e.confirmed_at || new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}
function memoryPut(row) {
  const id = `${row.key}|${row.url}`;
  const had = memory.get(id);
  memory.set(id, had ? { ...had, ...row, rank: had.rank, kept: had.kept, swapped: had.swapped } : row);
  if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
}
const out = r => ({ key: r.key, url: r.url, kind: r.kind, clip: r.clip, relevance: r.relevance, moment: r.moment, segment: r.segment || null, rank: r.rank || 0 });

async function read(keys = [], { kind = '', token = '', limit = 12, fetchImpl } = {}) {
  if (!enabled()) return [];
  const list = [...new Set((Array.isArray(keys) ? keys : []).map(k => String(k).slice(0, 120)).filter(Boolean))].slice(0, 12);
  if (!list.length) return [];
  const rows = new Map();
  memory.forEach(r => { if (list.includes(r.key) && (!kind || r.kind === kind)) rows.set(`${r.key}|${r.url}`, r); });
  const service = Boolean(serviceRoleKey());
  if (remoteReady() && (service || token)) {
    const params = new URLSearchParams({ select: '*', key: `in.(${list.map(k => `"${k.replace(/["\\]/g, '')}"`).join(',')})`, rank: `gt.${MIN_RANK}`, order: 'rank.desc,confirmed_at.desc', limit: String(Math.min(60, limit * list.length)) });
    if (kind) params.set('kind', `eq.${kind}`);
    const got = await rest(`${TABLE}?${params}`, service ? { service: true } : { token }, fetchImpl);
    if (got.ok && Array.isArray(got.data)) got.data.forEach(r => { const id = `${r.key}|${r.url}`; if (!rows.has(id)) rows.set(id, r); });
  }
  const order = k => list.indexOf(k);
  return [...rows.values()].filter(r => (r.rank || 0) > MIN_RANK)
    .sort((a, b) => order(a.key) - order(b.key) || (b.rank || 0) - (a.rank || 0) || b.relevance - a.relevance)
    .slice(0, limit).map(out);
}

// entries: [{ key, url, kind, sport, clip, relevance, moment, segment }]
async function confirm(entries = [], { fetchImpl } = {}) {
  if (!enabled()) return { written: 0, remote: false };
  const rows = (Array.isArray(entries) ? entries : []).filter(e => e && e.key && /^https:\/\//.test(String(e.url || '')) && Number(e.relevance) >= 7).slice(0, 40).map(rowOf)
    .filter(r => r.clip.variants.length);
  rows.forEach(memoryPut);
  if (!rows.length || !remoteReady() || !serviceRoleKey()) return { written: rows.length, remote: false };
  // rank / kept / swapped are never sent on a confirm (an upsert would reset them).
  const body = rows.map(({ rank, kept, swapped, ...r }) => r);
  const got = await rest(`${TABLE}?on_conflict=key,url`, { method: 'POST', service: true, body, prefer: 'resolution=merge-duplicates,return=minimal' }, fetchImpl);
  return { written: rows.length, remote: got.ok };
}

// A person kept (+1) or swapped out (-1) a clip: every row of that url for the keys.
async function rank(url, keys = [], delta = 0, { fetchImpl } = {}) {
  const d = Math.sign(Number(delta) || 0);
  if (!enabled() || !d || !/^https:\/\//.test(String(url || ''))) return { ok: false };
  const list = [...new Set((Array.isArray(keys) ? keys : []).map(k => String(k).slice(0, 120)).filter(Boolean))].slice(0, 6);
  let rankNow = null;
  memory.forEach(r => {
    if (r.url !== url || (list.length && !list.includes(r.key))) return;
    r.rank = clampInt((r.rank || 0) + d, -20, 50);
    if (d > 0) r.kept = (r.kept || 0) + 1; else r.swapped = (r.swapped || 0) + 1;
    rankNow = r.rank;
  });
  if (remoteReady() && serviceRoleKey()) {
    const params = new URLSearchParams({ select: 'key,url,rank,kept,swapped', url: `eq.${url}` });
    if (list.length) params.set('key', `in.(${list.map(k => `"${k.replace(/["\\]/g, '')}"`).join(',')})`);
    const got = await rest(`${TABLE}?${params}`, { service: true }, fetchImpl);
    if (got.ok && Array.isArray(got.data)) {
      await Promise.all(got.data.slice(0, 6).map(r => {
        const next = { rank: clampInt((r.rank || 0) + d, -20, 50), ...(d > 0 ? { kept: (r.kept || 0) + 1 } : { swapped: (r.swapped || 0) + 1 }), updated_at: new Date().toISOString() };
        rankNow = next.rank;
        const q = new URLSearchParams({ key: `eq.${r.key}`, url: `eq.${r.url}` });
        return rest(`${TABLE}?${q}`, { method: 'PATCH', service: true, body: next, prefer: 'return=minimal' }, fetchImpl);
      }));
    }
  }
  return { ok: true, rank: rankNow };
}

function status() {
  return { enabled: enabled(), remote: remoteReady() && Boolean(serviceRoleKey()), installed: state.installed, memory: memory.size, lastError: state.lastError };
}
function _reset() { memory.clear(); state.installed = null; state.checkedAt = 0; state.lastError = ''; }

module.exports = { TABLE, MIN_RANK, keysFor, read, confirm, rank, status, slimClip, _reset, _memory: memory };
