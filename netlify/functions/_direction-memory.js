'use strict';
// Generate's creative-director memory. Two jobs, no model calls:
//   recordEvent({ token, email, event })  saves one event to
//     frameup_generate_direction_events with the user's own session (RLS checks it).
//   signalsFor({ token })  -> { exportedRuns, exportedAngles, chosenAngles,
//     lessAngles, hookStats, lines }
//     what the team picked, edited, exported and pushed back on lately. The
//     director reads `lines`; the corpus ranking (pickPastPosts) boosts past
//     posts whose run or angle was chosen or exported.
//
// Both never throw. Until the migration has run (table missing) or when
// Supabase is down, recordEvent quietly does nothing and signalsFor returns
// empties, so Generate works exactly as before.
// Signals are team-wide through frameup_generate_direction_signals() (security
// definer, no user ids or emails); without it they fall back to own rows (RLS).
const { authConfig } = require('./_supabase-auth.js');

const TABLE = 'frameup_generate_direction_events';
const RPC = 'frameup_generate_direction_signals';
const EVENT_TYPES = [
  'directions_shown', // the director's directions for a brief (server or page)
  'direction_chosen', // an editor made designs from this direction
  'direction_edited', // an editor changed its angle or hook first (before/after)
  'direction_skipped', // the editor skipped the directions (Auto)
  'more_like_this', // on a direction or a design
  'less_like_this', // on a direction or a design
  'fix_applied', // the director's one-click fix on a design
  'design_opened', // opened in the editor
  'design_exported', // downloaded (PNG) from Generate
];
const POST_TYPES = ['cover', 'quote', 'long-quote', 'double-entity-quote', 'stats-single-ent', 'stats-double-ent', 'listicle-type-1', 'listicle-type-2', 'player-stat-line', 'team-record'];
const HOOKS = ['question', 'claim', 'reaction', 'quote', 'numbers', 'ranking'];
const MAX_PAYLOAD_CHARS = 16 * 1024;
const WINDOW = 400;
const CACHE_MS = 10 * 60 * 1000;
const FAIL_CACHE_MS = 60 * 1000;

const EMPTY = Object.freeze({
  exportedRuns: new Set(), exportedAngles: [], chosenAngles: [], lessAngles: [], hookStats: {}, lines: [], rows: 0,
});

let cache = { at: 0, ttl: 0, value: null };
let tableMissingUntil = 0;

const clean = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
const squash = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function headers(token, extra = {}) {
  const config = authConfig();
  return { apikey: config.publishableKey, Authorization: `Bearer ${token}`, Accept: 'application/json', ...extra };
}

// Drops any key that could identify a person (emails, user ids), at any depth.
function scrub(value, depth = 0) {
  if (depth > 4) return null;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => scrub(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/email|user_?id/i.test(key))
      .map(([key, item]) => [key, scrub(item, depth + 1)]));
  }
  return typeof value === 'string' ? value.slice(0, 600) : value;
}

// Validates and normalises an event; returns { row } or { error }.
function normalizeEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return { error: 'Invalid event.' };
  const type = String(event.type || '');
  if (!EVENT_TYPES.includes(type)) return { error: 'Unknown event type.' };
  const payloadRaw = event.payload == null ? {} : event.payload;
  if (typeof payloadRaw !== 'object' || Array.isArray(payloadRaw)) return { error: 'Invalid event payload.' };
  const payload = scrub(payloadRaw);
  let text;
  try { text = JSON.stringify(payload); } catch { return { error: 'Invalid event payload.' }; }
  if (text.length > MAX_PAYLOAD_CHARS) return { error: 'Event payload is too large.' };
  const postType = event.postType == null || event.postType === '' ? null : String(event.postType);
  if (postType != null && !POST_TYPES.includes(postType)) return { error: 'Invalid post type.' };
  const hook = event.hook == null || event.hook === '' ? null : String(event.hook);
  if (hook != null && !HOOKS.includes(hook)) return { error: 'Invalid hook.' };
  const runId = clean(event.runId, 64) || null;
  if (runId && !/^[\w-]{1,64}$/.test(runId)) return { error: 'Invalid run.' };
  const directionId = clean(event.directionId, 24) || null;
  if (directionId && !/^[\w-]{1,24}$/.test(directionId)) return { error: 'Invalid direction.' };
  return {
    row: {
      type,
      run_id: runId,
      direction_id: directionId,
      post_type: postType,
      hook,
      sport: clean(event.sport, 20) || null,
      angle: clean(event.angle, 160) || null,
      payload,
    },
  };
}

// Saves one event. Resolves true when saved, false otherwise. Never throws.
async function recordEvent({ token, email, event } = {}) {
  try {
    if (!token || !email) return false;
    if (Date.now() < tableMissingUntil) return false;
    const { row } = normalizeEvent(event);
    if (!row) return false;
    const response = await fetch(`${authConfig().url}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: headers(token, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ user_email: String(email).trim().toLowerCase(), ...row }),
      signal: AbortSignal.timeout(3000),
    });
    if (response.status === 404) tableMissingUntil = Date.now() + CACHE_MS;
    return response.ok;
  } catch {
    return false;
  }
}

// ─── Signals (deterministic, newest rows first) ────────────────────────────
const HOOK_LABEL = { question: 'question', claim: 'bold-claim', reaction: 'reaction', quote: 'quote', numbers: 'numbers-first', ranking: 'ranking' };

function deriveSignals(rows = []) {
  const recent = (Array.isArray(rows) ? rows : []).slice(0, WINDOW);
  const exportedRuns = new Set();
  const exportedAngles = [];
  const chosenAngles = [];
  const lessAngles = [];
  const hookStats = {};
  const bump = (hook, key) => {
    if (!HOOKS.includes(hook)) return;
    hookStats[hook] = hookStats[hook] || { shown: 0, chosen: 0, exported: 0, less: 0 };
    hookStats[hook][key] += 1;
  };
  const addAngle = (list, angle, hook, postType) => {
    const text = clean(angle, 120);
    if (text.length < 6 || list.some(item => squash(item.angle) === squash(text))) return;
    list.push({ angle: text, hook: hook || '', postType: postType || '' });
  };
  for (const row of recent) {
    if (!row || typeof row !== 'object') continue;
    const hook = row.hook || row.payload?.hook || '';
    const angle = row.angle || row.payload?.angle || '';
    const postType = row.post_type || row.payload?.postType || '';
    if (row.type === 'directions_shown') {
      (Array.isArray(row.payload?.directions) ? row.payload.directions : []).forEach(d => bump(d?.hook, 'shown'));
    } else if (row.type === 'direction_chosen' || row.type === 'direction_edited' || row.type === 'more_like_this') {
      if (row.type !== 'direction_edited') bump(hook, 'chosen');
      addAngle(chosenAngles, row.type === 'direction_edited' ? row.payload?.after?.angle || angle : angle, hook, postType);
    } else if (row.type === 'design_exported' || row.type === 'design_opened') {
      if (row.run_id) exportedRuns.add(row.run_id);
      if (row.type === 'design_exported') bump(hook, 'exported');
      addAngle(exportedAngles, angle, hook, postType);
    } else if (row.type === 'less_like_this') {
      bump(hook, 'less');
      addAngle(lessAngles, angle, hook, postType);
    }
  }
  // Plain lines for the director (at most 5, each short).
  const lines = [];
  const ranked = Object.entries(hookStats)
    .map(([hook, s]) => ({ hook, wins: s.chosen + 2 * s.exported - s.less, s }))
    .filter(item => item.s.chosen + item.s.exported >= 3)
    .sort((a, b) => b.wins - a.wins);
  if (ranked[0] && ranked[0].wins > 0) lines.push(`Editors pick ${HOOK_LABEL[ranked[0].hook]} hooks most (${ranked[0].s.chosen} picks, ${ranked[0].s.exported} exports).`);
  const shunned = Object.entries(hookStats).filter(([, s]) => s.less >= 3 && s.less > s.chosen).map(([hook]) => HOOK_LABEL[hook]);
  if (shunned.length) lines.push(`Editors often push back on ${shunned.join(' and ')} hooks; use them only when the story is strong.`);
  exportedAngles.slice(0, 2).forEach(item => lines.push(`Shipped lately: ${JSON.stringify(item.angle)}${item.hook ? ` (${item.hook})` : ''}.`));
  lessAngles.slice(0, 1).forEach(item => lines.push(`Asked for less of: ${JSON.stringify(item.angle)}.`));
  return {
    exportedRuns,
    exportedAngles: exportedAngles.slice(0, 20),
    chosenAngles: chosenAngles.slice(0, 20),
    lessAngles: lessAngles.slice(0, 20),
    hookStats,
    lines: lines.slice(0, 5).map(line => line.slice(0, 160)),
    rows: recent.length,
  };
}

async function fetchTeamRows(token) {
  const response = await fetch(`${authConfig().url}/rest/v1/rpc/${RPC}`, {
    method: 'POST',
    headers: headers(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ p_limit: WINDOW }),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw Object.assign(new Error(`signals rpc failed (${response.status})`), { status: response.status });
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('signals rpc returned no rows');
  return rows;
}

async function fetchOwnRows(token) {
  const query = `select=created_at,type,run_id,post_type,hook,angle,payload&order=created_at.desc&limit=${WINDOW}`;
  const response = await fetch(`${authConfig().url}/rest/v1/${TABLE}?${query}`, { headers: headers(token), signal: AbortSignal.timeout(3000) });
  if (response.status === 404) tableMissingUntil = Date.now() + CACHE_MS;
  if (!response.ok) throw new Error(`own rows failed (${response.status})`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

// Team-wide signals (cached 10 minutes per server instance). Never throws.
async function signalsFor({ token } = {}) {
  if (cache.value && Date.now() - cache.at < cache.ttl) return cache.value;
  let value = EMPTY;
  let ttl = FAIL_CACHE_MS;
  try {
    if (token && Date.now() >= tableMissingUntil && typeof authConfig === 'function') {
      let rows;
      ttl = CACHE_MS;
      try {
        rows = await fetchTeamRows(token);
      } catch (error) {
        // One person's own rows: kept briefly, since the cache is shared.
        rows = await fetchOwnRows(token);
        ttl = FAIL_CACHE_MS;
      }
      value = deriveSignals(rows);
    }
  } catch {
    value = EMPTY;
  }
  cache = { at: Date.now(), ttl, value };
  return value;
}

// ─── Variety: what THIS person was just shown ──────────────────────────────
// Creative runs log a directions_shown row with payload { look: 'creative',
// looks: [{ archetype, tone }] } (es-generate creative()); the templates look
// logs its directions ({ postType, hook }) from the page. recentFor reads the
// person's own latest rows (filtered by their email: admins can read every
// row) so the next run picks different looks. Never throws; empty without a
// token, without the table or when Supabase is slow.
const ID_RE = /^[a-z0-9-]{2,40}$/;
function deriveRecent(rows = [], { runs = 3, looks = 12 } = {}) {
  const creativeRuns = [];
  const classic = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || (row.type && row.type !== 'directions_shown')) continue;
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    if (payload.look === 'creative' && Array.isArray(payload.looks)) {
      if (creativeRuns.length >= runs) continue;
      const set = payload.looks.slice(0, 8)
        .map(l => ({ archetype: String(l?.archetype || '').toLowerCase(), tone: String(l?.tone || '').toLowerCase() }))
        .filter(l => ID_RE.test(l.archetype))
        .map(l => ({ archetype: l.archetype, tone: /^[a-z]{2,12}$/.test(l.tone) ? l.tone : '' }));
      if (set.length) creativeRuns.push(set);
    } else if (Array.isArray(payload.directions) && classic.length < looks) {
      payload.directions.slice(0, 6).forEach(d => {
        const postType = String(d?.postType || '');
        if (POST_TYPES.includes(postType) && classic.length < looks) classic.push({ postType, hook: HOOKS.includes(d?.hook) ? d.hook : '' });
      });
    }
  }
  return { creative: creativeRuns.flat().slice(0, looks), creativeRuns, classic };
}
const EMPTY_RECENT = Object.freeze({ creative: [], creativeRuns: [], classic: [] });

async function recentFor({ token, email, runs = 3, looks = 12, timeoutMs = 2000 } = {}) {
  try {
    if (!token || !email || Date.now() < tableMissingUntil || typeof authConfig !== 'function') return EMPTY_RECENT;
    const who = encodeURIComponent(String(email).trim().toLowerCase());
    const query = `select=created_at,type,payload&type=eq.directions_shown&user_email=eq.${who}&order=created_at.desc&limit=${Math.max(runs * 2, 8)}`;
    const response = await fetch(`${authConfig().url}/rest/v1/${TABLE}?${query}`, { headers: headers(token), signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 404) tableMissingUntil = Date.now() + CACHE_MS;
    if (!response.ok) return EMPTY_RECENT;
    return deriveRecent(await response.json(), { runs, looks });
  } catch {
    return EMPTY_RECENT;
  }
}

module.exports = {
  EVENT_TYPES,
  normalizeEvent,
  recordEvent,
  deriveSignals,
  signalsFor,
  deriveRecent,
  recentFor,
  EMPTY_RECENT,
  EMPTY,
  _test: { scrub, reset: () => { cache = { at: 0, ttl: 0, value: null }; tableMissingUntil = 0; } },
};
