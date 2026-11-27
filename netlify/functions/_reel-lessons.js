'use strict';
// Reels v4 learning loop (reels4-contract.md "AI"): what editors change in a
// reel becomes "house lessons" that the director and the critic read.
//
//   cleanFeedback / saveFeedback   one row per change (swap_media, edit_text,
//       change_module, regenerate, delete_beat, export, posted), written with
//       the person's own session (RLS: users insert their own rows).
//   summarize                      code ($0): the last 30 days -> counts and
//       before -> after pairs per style (what keeps changing, what survives).
//   runLessonsJob                  daily (rides the ai-budget-watch cron) or an
//       admin's button: summary -> one Haiku call -> frameup_reel_lessons.
//       Skipped ($0) when the summary has not changed since the last run or
//       there is too little feedback. Cost logged as reels-lessons.
//   loadLessons / topLessons       the top lessons for a style (+ 'all'),
//       cached for an hour per server, for the director and critic prompts.
// Before the migration runs every call soft-fails ({ cloud: false } / []).
const crypto = require('node:crypto');
const { authConfig } = require('./_supabase-auth.js');
const gateway = () => require('./_ai-gateway.js');

const FEEDBACK = 'frameup_reel_feedback';
const LESSONS = 'frameup_reel_lessons';
const FEATURE = 'reels-lessons';
const EVENTS = ['swap_media', 'edit_text', 'change_module', 'regenerate', 'delete_beat', 'export', 'posted', 'find_clips'];
// Events added after the first migration: the live check constraint may not
// allow them until 20261130130000_frameup_reel_feedback_find_clips.sql runs.
const LATE_EVENTS = ['find_clips'];
const STYLES = ['breakdown', 'casefile', 'outlier', 'hotseat'];
const LIMITS = { batch: 20, json: 2000, days: 30, rows: 5000, minRows: 15, perStyle: 6, lessonChars: 180 };
const CRON_EMAIL = 'reel-lessons@essentiallysports.com';

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const id = (v, n = 64) => str(v, n).replace(/[^A-Za-z0-9_.:-]/g, '');
// A small JSON value: objects and arrays kept when they fit, strings capped.
function small(v) {
  if (v == null) return null;
  if (typeof v === 'string') return str(v, 400);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  try {
    const text = JSON.stringify(v);
    return text.length <= LIMITS.json ? JSON.parse(text) : { truncated: true, text: text.slice(0, 400) };
  } catch { return null; }
}

function cleanFeedback(evt) {
  const e = evt && typeof evt === 'object' ? evt : {};
  if (!EVENTS.includes(e.event)) return null;
  return {
    reel_id: id(e.reelId || e.reel_id) || null,
    chapter_id: id(e.chapterId || e.chapter_id, 16) || null,
    beat_id: id(e.beatId || e.beat_id, 16) || null,
    event: e.event,
    style: STYLES.includes(e.style) ? e.style : null,
    field: id(e.field, 24) || null,
    before: small(e.before),
    after: small(e.after),
  };
}

function rest(token, { service = false } = {}) {
  const config = authConfig();
  const key = service ? String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() : config.publishableKey;
  return {
    url: `${config.url}/rest/v1`,
    headers: extra => ({ apikey: key, Authorization: `Bearer ${service ? key : token}`, Accept: 'application/json', 'Content-Type': 'application/json', ...extra }),
  };
}

// events: one or a list (<= 20). Fire-and-forget from the page.
async function saveFeedback(events, { auth, token, fetchImpl = fetch } = {}) {
  const list = (Array.isArray(events) ? events : [events]).slice(0, LIMITS.batch);
  const rows = list.map(cleanFeedback).filter(Boolean);
  const ignored = list.length - rows.length;
  // Unknown events are a no-op (fire-and-forget logging never errors).
  if (!rows.length) return { ok: true, cloud: false, saved: 0, ignored };
  const api = rest(token);
  const send = batch => fetchImpl(`${api.url}/${FEEDBACK}`, {
    method: 'POST', headers: api.headers({ Prefer: 'return=minimal' }), signal: AbortSignal.timeout(4000),
    body: JSON.stringify(batch.map(r => ({ ...r, user_email: auth.user.email }))),
  });
  try {
    let response = await send(rows);
    let saved = rows;
    // Before the find_clips migration runs, the check constraint (23514)
    // rejects the whole batch: save the rest without the late events.
    if (!response.ok && rows.some(r => LATE_EVENTS.includes(r.event))) {
      const rest2 = rows.filter(r => !LATE_EVENTS.includes(r.event));
      saved = rest2;
      response = rest2.length ? await send(rest2) : { ok: false };
    }
    return { ok: true, cloud: Boolean(response.ok), saved: response.ok ? saved.length : 0, ignored: ignored + (rows.length - saved.length) };
  } catch { return { ok: true, cloud: false, saved: 0, ignored }; }
}

// ─── Summary (code, $0) ──────────────────────────────────────────────────
const kindOf = v => (v && typeof v === 'object' ? str(v.kind || v.type || '', 20) : str(v, 20));
const top = (counts, n = 8) => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => `${k} x${c}`);
function summarize(rows) {
  const by = {};
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  (rows || []).forEach(r => {
    const s = STYLES.includes(r.style) ? r.style : 'all';
    const g = by[s] || (by[s] = { events: {}, moduleSwaps: {}, mediaSwaps: {}, edits: {}, deleted: {}, samples: [], reels: new Set(), exported: new Set(), posted: new Set() });
    bump(g.events, r.event);
    if (r.reel_id) g.reels.add(r.reel_id);
    if (r.event === 'change_module') bump(g.moduleSwaps, `${kindOf(r.before) || 'none'} -> ${kindOf(r.after) || 'none'}`);
    if (r.event === 'swap_media') bump(g.mediaSwaps, `${kindOf(r.before) || 'none'} -> ${kindOf(r.after) || 'none'}${r.before && r.before.reason ? ` (${str(r.before.reason, 30)})` : ''}`);
    if (r.event === 'edit_text') {
      bump(g.edits, r.field || 'text');
      const b = typeof r.before === 'string' ? r.before : (r.before && r.before.text);
      const a = typeof r.after === 'string' ? r.after : (r.after && r.after.text);
      if (b && a && g.samples.length < 6) g.samples.push(`${r.field || 'text'}: "${str(b, 70)}" -> "${str(a, 70)}"`);
    }
    if (r.event === 'delete_beat') bump(g.deleted, kindOf(r.before) || 'beat');
    if (r.event === 'export' && r.reel_id) g.exported.add(r.reel_id);
    if (r.event === 'posted' && r.reel_id) g.posted.add(r.reel_id);
  });
  const out = {};
  Object.entries(by).forEach(([s, g]) => {
    out[s] = {
      reels: g.reels.size, exported: g.exported.size, posted: g.posted.size,
      events: g.events, moduleSwaps: top(g.moduleSwaps), mediaSwaps: top(g.mediaSwaps), edits: top(g.edits), deleted: top(g.deleted), samples: g.samples,
    };
  });
  return out;
}
const hashOf = summary => crypto.createHash('sha256').update(JSON.stringify(summary)).digest('hex').slice(0, 32);

// ─── Distil (one Haiku call) ─────────────────────────────────────────────
const LESSONS_SYSTEM = [
  'You turn editing data from the ES reels team into short house lessons for the AI that plans reels (the director) and the AI that checks them (the critic).',
  'The data: per style, what editors changed in AI-planned reels in the last 30 days (module swaps, media swaps, text edits with samples, deleted beats) and how many reels were exported and posted.',
  'A change editors keep making means the AI should do it from the start; what survives into posted reels is working.',
  'Return JSON only: {"lessons":[{"style":"breakdown|casefile|outlier|hotseat|all","lesson":"one imperative sentence, <= 160 characters","evidence":12}]}',
  'At most 6 lessons per style. evidence = how many events back it (from the data). Only lessons the data supports; no generic advice. Never name a person or quote a script.',
].join('\n');
function cleanLessons(parsed, summary) {
  const max = Object.values(summary).reduce((n, g) => n + Object.values(g.events).reduce((a, b) => a + b, 0), 0);
  const per = {};
  return (Array.isArray(parsed && parsed.lessons) ? parsed.lessons : []).map(l => ({
    style: [...STYLES, 'all'].includes(l && l.style) ? l.style : 'all',
    lesson: str(l && l.lesson, LIMITS.lessonChars).replace(/^[-•]\s*/, ''),
    evidence: Math.max(1, Math.min(max || 1, Math.round(Number(l && l.evidence)) || 1)),
  })).filter(l => l.lesson.length >= 12 && !/https?:|@/.test(l.lesson))
    .filter(l => { per[l.style] = (per[l.style] || 0) + 1; return per[l.style] <= LIMITS.perStyle; });
}

async function readFeedback({ api, since, fetchImpl }) {
  const response = await fetchImpl(`${api.url}/${FEEDBACK}?select=event,style,field,before,after,reel_id,created_at&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=${LIMITS.rows}`, { headers: api.headers(), signal: AbortSignal.timeout(6000) });
  if (!response.ok) return null;
  return response.json();
}
async function lastHash({ api, fetchImpl }) {
  try {
    const response = await fetchImpl(`${api.url}/${LESSONS}?select=source_hash&order=created_at.desc&limit=1`, { headers: api.headers(), signal: AbortSignal.timeout(4000) });
    if (!response.ok) return '';
    const rows = await response.json();
    return rows[0] ? String(rows[0].source_hash || '') : '';
  } catch { return ''; }
}
// Spend by the cron, logged like any AI call (service role, no user session).
async function logCronUsage(cost, model, fetchImpl) {
  if (!(cost > 0) || !String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) return;
  const api = rest('', { service: true });
  try {
    await fetchImpl(`${api.url}/frameup_ai_usage`, { method: 'POST', headers: api.headers({ Prefer: 'return=minimal' }), signal: AbortSignal.timeout(3000), body: JSON.stringify({ user_email: CRON_EMAIL, feature: FEATURE, model, ok: true, cost_usd: Number(cost.toFixed(6)) }) });
  } catch { /* best effort */ }
}

// service: true for the cron (service role); else an admin's own token (RLS:
// admins read feedback and write lessons). track: the admin's, for the usage log.
async function runLessonsJob({ service = false, token = '', track = null, force = false, now = new Date(), fetchImpl = fetch } = {}) {
  const api = rest(token, { service });
  if (service && !String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) return { ok: false, reason: 'no-service-key' };
  const since = new Date(now.getTime() - LIMITS.days * 864e5).toISOString();
  let rows;
  try { rows = await readFeedback({ api, since, fetchImpl }); } catch { rows = null; }
  if (!rows) return { ok: false, reason: 'not-installed', error: 'The reel feedback table is not there yet (run the migration).' };
  if (rows.length < LIMITS.minRows) return { ok: true, skipped: 'not-enough-feedback', rows: rows.length, cost: 0 };
  const summary = summarize(rows);
  const hash = hashOf(summary);
  if (!force && hash === await lastHash({ api, fetchImpl })) return { ok: true, skipped: 'unchanged', rows: rows.length, cost: 0 };
  const ai = gateway();
  if (service) {
    const gate = await ai.cronSpendGate({ feature: FEATURE }).catch(() => null);
    if (gate) return { ok: true, skipped: gate.reason || 'budget', rows: rows.length, cost: 0 };
  }
  if (!ai.gatewayConfigured()) return { ok: true, skipped: 'ai-off', rows: rows.length, cost: 0 };
  const reply = await ai.aiText({
    tier: 'main', system: LESSONS_SYSTEM, cacheSystem: false, json: true, effort: 'low', maxTokens: 1200, timeoutMs: 25000,
    messages: [{ role: 'user', content: `LAST ${LIMITS.days} DAYS (${rows.length} events):\n${JSON.stringify(summary)}` }],
    track: track ? { ...track, feature: FEATURE } : undefined,
  });
  const cost = Number(reply.cost) || 0;
  if (service) await logCronUsage(cost, reply.model || '', fetchImpl);
  let parsed = null;
  try { parsed = require('./_reel-director.js')._test.extractJson(reply.text); } catch { parsed = null; }
  const lessons = cleanLessons(parsed, summary);
  if (!lessons.length) return { ok: true, skipped: 'no-lessons', rows: rows.length, cost };
  // Replace the set: the new lessons go in, then the older rows go.
  const stamp = now.toISOString();
  const insert = await fetchImpl(`${api.url}/${LESSONS}`, {
    method: 'POST', headers: api.headers({ Prefer: 'return=minimal' }), signal: AbortSignal.timeout(5000),
    body: JSON.stringify(lessons.map((l, i) => ({ ...l, rank: i + 1, source_hash: hash, model: str(reply.model, 60), created_at: stamp }))),
  }).catch(() => null);
  if (!insert || !insert.ok) return { ok: false, reason: 'write-failed', rows: rows.length, cost };
  await fetchImpl(`${api.url}/${LESSONS}?created_at=lt.${encodeURIComponent(stamp)}`, { method: 'DELETE', headers: api.headers({ Prefer: 'return=minimal' }), signal: AbortSignal.timeout(5000) }).catch(() => null);
  CACHE.clear();
  return { ok: true, lessons: lessons.length, rows: rows.length, cost, model: reply.model || '', hash };
}

// ─── Read (cached per server for an hour) ────────────────────────────────
const CACHE = new Map();
const TTL_MS = 60 * 60 * 1000;
async function loadLessons({ style = '', token = '', fetchImpl = fetch, now = Date.now() } = {}) {
  const s = STYLES.includes(style) ? style : 'breakdown';
  const hit = CACHE.get(s);
  if (hit && now - hit.at < TTL_MS) return hit.items;
  let items = [];
  if (token || String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) {
    const api = rest(token, { service: !token });
    try {
      const response = await fetchImpl(`${api.url}/${LESSONS}?select=style,lesson,evidence&style=in.(all,${s})&order=evidence.desc&limit=8`, { headers: api.headers(), signal: AbortSignal.timeout(2500) });
      if (response.ok) items = (await response.json()).map(r => ({ style: r.style, lesson: str(r.lesson, LIMITS.lessonChars), evidence: Number(r.evidence) || 0 })).filter(r => r.lesson);
    } catch { items = []; }
  }
  items = topLessons(items, s);
  CACHE.set(s, { at: now, items });
  return items;
}
// Style lessons first, then house-wide ones; the strongest evidence first; 6 at most.
function topLessons(items, style, n = 6) {
  return (items || []).slice().sort((a, b) => (a.style === style ? 0 : 1) - (b.style === style ? 0 : 1) || b.evidence - a.evidence).slice(0, n);
}

module.exports = { FEEDBACK, LESSONS, FEATURE, EVENTS, LATE_EVENTS, STYLES, LIMITS, CRON_EMAIL, LESSONS_SYSTEM, cleanFeedback, saveFeedback, summarize, hashOf, cleanLessons, runLessonsJob, loadLessons, topLessons, CACHE };
