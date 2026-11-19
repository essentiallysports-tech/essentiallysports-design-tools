'use strict';
// GET /api/clips-prefetch: keeps the shared Video Ads clip library
// (_clip-library.js) warm, so "Find a clip" is usually instant and free.
// See project-docs/clips-library.md.
//
// Once a day (owner decision, 2026-11-18). One daily run refreshes every NFL,
// CFB and MLB team. A Vercel function has 60 s, so the run is split into
// batches: the team list (stable order) is dealt round-robin into
// CLIPS_PREFETCH_BATCHES (default 10) shares, and each call does one share:
//   GET /api/clips-prefetch?batch=K        (K = 1..N; no batch = 1)
// vercel.json has one daily cron per batch, five minutes apart from 10:00 UTC
// (about 5-6am ET). Batch 1 also does today's trending teams first. Each batch
// also re-checks a few stored links (marking dead ones) and deletes clips
// older than 7 days.
// Alternative to one cron per batch: `?batch=1&chain=1` makes each batch call
// the next one when it finishes (needs CLIPS_PREFETCH_BASE_URL or Vercel's
// VERCEL_PROJECT_PRODUCTION_URL; the secret is only ever sent there).
//
// Per team: free sources first (X API when X_BEARER_TOKEN is set, the public
// sources), then AI sources (the capped Haiku x.com web search, Grok) only
// while the day's AI budget lasts (CLIPS_PREFETCH_MAX_USD, default $0.75 for
// the whole daily run, all batches) and only for teams the free pass left
// with fewer than 9 fresh clips. Trending teams get the budget first.
//
// Protected by CRON_SECRET (Vercel sends "Authorization: Bearer <CRON_SECRET>";
// external schedulers can send the same header or "x-cron-secret"), compared
// in constant time. Without CRON_SECRET every run is refused.
//
// GET /api/clips-prefetch?diag=1 with a signed-in dashboard admin's token
// (is_es_designer_admin() in the database): library counts per sport, team,
// platform and source, the last daily run and recent batch summaries. No
// secrets, only booleans for what is configured.
const crypto = require('node:crypto');
const { authConfig, bearerToken } = require('./_supabase-auth.js');
const { request, serviceRoleKey } = require('./_supabase-rest.js');
const { gatewayConfigured, featureDisabled, cronSpendGate, freeModeGate, withAiMode } = require('./_ai-gateway.js');
const TEAMS = require('../../video-ads-teams.js');
const { clipPipeline: P } = require('./video-ads.js');

const LIB = P.CLIP_LIBRARY;
const FEATURE = 'clips-prefetch';
const CRON_SCHEDULE = '0 10 * * *';
const CONFIG = {
  deadlineMs: 50000, // stop starting work after this (Vercel limit is 60 s)
  startCutoffMs: 30000, // no new team after this
  teamMs: 22000,
  concurrency: 8,
  maxTrending: 8,
  aiEstimateUsd: 0.06, // reserve per AI team before spending
  webUses: 2, webCostUsd: 0.03,
  recheck: 15, recheckAfterHours: 20,
  // Engagement: re-read likes / views of the newest X clips (free, fxtwitter /
  // syndication), so By moment ranks by views per hour with no extra calls.
  engagement: 24, engagementMaxAgeHours: 72, engagementAfterHours: 3,
  // AI "is it game action?" verdicts for unclassified fresh clips, per batch.
  classifyPerBatch: 48, classifyMs: 30000,
};
const CLASSIFY_FEATURE = 'clips-classify';

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
function header(headers, name) {
  const key = Object.keys(headers || {}).find(k => k.toLowerCase() === name);
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}
const isOff = value => /^(off|0|false|no|disabled)$/i.test(String(value ?? '').trim());

// Today's classification spend (summary.classify.cost of today's runs).
const classifySpentToday = () => LIB.spentToday({ pick: r => r.summary?.classify?.cost || 0 });

// Constant-time comparison of the presented secret with CRON_SECRET.
function cronAuthorized(headers, secret = process.env.CRON_SECRET) {
  const expected = String(secret || '').trim();
  if (!expected) return false;
  const bearer = (header(headers, 'authorization').match(/^Bearer\s+(.+)$/i) || [])[1]?.trim() || '';
  const given = bearer || header(headers, 'x-cron-secret').trim();
  if (!given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// The database decides who is an admin (the function the RLS policies use).
async function isAdmin(token) {
  if (!token) return false;
  try {
    const config = authConfig();
    const response = await fetch(`${config.url}/rest/v1/rpc/is_es_designer_admin`, {
      method: 'POST',
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return false;
    return (await response.json()) === true;
  } catch {
    return false;
  }
}

const usdEnv = (value, fallback) => (Number.isFinite(Number(value)) && value !== '' && value != null ? Math.max(0, Number(value)) : fallback);
const settings = (env = process.env) => {
  const batches = Math.max(1, Math.min(24, Math.floor(Number(env.CLIPS_PREFETCH_BATCHES) || 10)));
  const maxUsd = usdEnv(env.CLIPS_PREFETCH_MAX_USD, 0.75);
  // Classification has its own daily cap (owner: <= $0.30/day).
  const classifyUsd = usdEnv(env.CLIPS_CLASSIFY_MAX_USD, 0.3);
  return { batches, maxUsd, classifyUsd };
};

// Every team, in a stable order (sport, then name).
function allTeams() {
  const order = { nfl: 0, cfb: 1, mlb: 2 };
  return TEAMS.TEAMS.filter(t => P.AD_SPORTS.includes(t.sport))
    .slice().sort((a, b) => order[a.sport] - order[b.sport] || a.name.localeCompare(b.name));
}

// Batch K of N: teams i with i % N === K - 1; batch 1 does the trending teams
// first. Over the N daily batches every team is covered once.
function planBatch({ batch, batches, trending = [], teams = allTeams() }) {
  const share = teams.filter((t, i) => i % batches === batch - 1);
  if (batch !== 1) return share.map(team => ({ team, trending: false }));
  const keys = new Set(trending.map(t => `${t.sport}|${t.name}`));
  return [
    ...trending.map(team => ({ team, trending: true })),
    ...share.filter(t => !keys.has(`${t.sport}|${t.name}`)).map(team => ({ team, trending: false })),
  ];
}

// Teams named by the last 48 h of trends, most trending first.
async function trendingTeams(max = CONFIG.maxTrending) {
  try {
    const data = await P.trends();
    const out = [];
    const seen = new Set();
    (data.items || []).forEach(item => {
      const team = P.teamInTitle(item.title, item.sport);
      const key = team ? `${team.sport}|${team.name}` : '';
      if (team && !seen.has(key) && out.length < max) { seen.add(key); out.push(team); }
    });
    return out;
  } catch {
    return [];
  }
}

// AI spend by the cron, logged like any other AI call (service role, as the
// cron has no user session). Best effort.
async function logAiUsage(cost, { model = 'clips-prefetch', ok = true, ms = 0, feature = FEATURE } = {}) {
  if (!(cost > 0) || !serviceRoleKey()) return;
  try {
    await request('frameup_ai_usage', {
      method: 'POST', service: true, prefer: 'return=minimal',
      body: { user_email: 'clips-prefetch@essentiallysports.com', feature, model, ok, cost_usd: Number(cost.toFixed(6)), duration_ms: ms },
    }, (u, init) => fetch(u, { ...init, signal: AbortSignal.timeout(3000) }));
  } catch { /* tracking is best effort */ }
}

const withTimeout = (promise, ms, fallback) => Promise.race([
  Promise.resolve(promise).catch(() => fallback),
  new Promise(resolve => setTimeout(() => resolve(fallback), ms)),
]);

// A shared budget for one batch: what is left of today's cap.
function makeBudget(capUsd) {
  const budget = {
    cap: capUsd, spent: 0,
    left: () => Math.max(0, budget.cap - budget.spent),
    // Reserve before an AI call; refund the unspent part after.
    reserve(estimate) { if (budget.left() < estimate) return false; budget.spent += estimate; return true; },
    settle(estimate, actual) { budget.spent += (Number(actual) || 0) - estimate; },
  };
  return budget;
}

// One team: free sources, then AI while the budget lasts. -> per-team summary
async function refreshTeam({ team, trending }, { budget, aiOn, runId }) {
  const sport = team.sport;
  const out = { team: team.name, sport, trending, free: 0, ai: 0, saved: 0, cost: 0, sources: {} };
  const track = { feature: FEATURE, runId };
  const t = P.teamOut(team);
  const libBefore = (await withTimeout(LIB.read({ sport, teams: [team.name], sinceHours: P.FIND_CLIPS.maxAgeHours }), 3500, [])).length;
  // 1. Free: X API (when configured) + the free extra sources.
  const plan = P.searchPlan({ sport, team });
  const [xRound, freeRun] = await Promise.all([
    P.xApiOn() ? P.searchRound(plan, { sport, track, feature: FEATURE, freeOnly: true, maxUses: 0, maxCostUsd: 0, timeoutMs: 10000 }).catch(() => null) : null,
    P.runSources({ sport, team: t, teams: [t] }, { track, freeOnly: true, timeoutMs: 15000 }),
  ]);
  const freeClips = [...(xRound?.clips || []), ...freeRun.clips];
  if (xRound) out.sources.xapi = xRound.clips.length;
  Object.entries(freeRun.diag).forEach(([id, d]) => { out.sources[id] = d.kept || 0; });
  out.free = freeClips.length;
  let found = freeClips;
  // 2. AI, only when still thin and the budget allows (trending teams first).
  if (aiOn && libBefore + P.rankClips(freeClips).length < P.LIBRARY.enough && budget.reserve(CONFIG.aiEstimateUsd)) {
    const started = Date.now();
    const [webRound, paidRun] = await Promise.all([
      P.xApiOn() ? null : P.searchRound(plan, {
        sport, track, feature: FEATURE, maxUses: CONFIG.webUses, maxCostUsd: CONFIG.webCostUsd, timeoutMs: 18000,
      }).catch(() => null),
      P.runSources({ sport, team: t, teams: [t] }, { track, only: 'paid', timeoutMs: 18000 }),
    ]);
    const aiCost = (webRound?.cost || 0) + paidRun.cost;
    budget.settle(CONFIG.aiEstimateUsd, aiCost);
    out.cost = Number(aiCost.toFixed(5));
    await logAiUsage(aiCost, { ms: Date.now() - started });
    const aiClips = [...(webRound?.clips || []), ...paidRun.clips];
    if (webRound) out.sources.web = webRound.clips.length;
    Object.entries(paidRun.diag).forEach(([id, d]) => { out.sources[id] = (out.sources[id] || 0) + (d.kept || 0); });
    out.ai = aiClips.length;
    found = [...found, ...aiClips];
  }
  out.saved = await P.saveToLibrary(P.rankClips(found).map(c => ({ ...c, via: 'search' })), { sport, team });
  return out;
}

// Re-checks the oldest-checked links: dead ones are marked, live ones stamped.
async function recheckLinks(limit = CONFIG.recheck) {
  const rows = await withTimeout(LIB.staleRows({ olderThanHours: CONFIG.recheckAfterHours, limit }), 4000, []);
  const dead = [];
  const alive = [];
  const counts = [];
  await Promise.all(rows.map(async row => {
    if (row.platform === 'x' || P.isXPost(row.url)) {
      const result = await withTimeout(P.clipFromPost(row.url), 6000, { ok: false, reason: 'timeout' });
      if (result.ok) { alive.push(row.url); counts.push({ url: row.url, likes: result.likes, views: result.views }); }
      else if (result.reason === 'no-video' || result.status === 400) dead.push(row.url);
      return;
    }
    const media = await withTimeout(P.checkMedia(row.media_url || row.url), 6000, { ok: false, dead: false });
    if (media.ok) alive.push(row.url);
    else if (media.dead) dead.push(row.url);
  }));
  await LIB.markDead(dead);
  await LIB.touch(alive);
  if (counts.length) await LIB.setEngagement(counts);
  return { checked: rows.length, dead: dead.length, alive: alive.length };
}

// Fresh likes / views for the newest X clips (posted in the last 72 h, not
// read for 3 h), newest first. Free: fxtwitter, then X syndication. -> summary
async function refreshEngagement({ limit = CONFIG.engagement, now = Date.now() } = {}) {
  const rows = (await Promise.all(P.AD_SPORTS.map(sport => withTimeout(LIB.read({ sport, sinceHours: CONFIG.engagementMaxAgeHours }), 3500, []))))
    .flat()
    .filter(c => (c.platform === 'x' || P.isXPost(c.url)) && (!c.checkedAt || now - new Date(c.checkedAt).getTime() >= CONFIG.engagementAfterHours * 3600e3))
    .sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt))
    .slice(0, limit);
  const counts = [];
  await Promise.all(rows.map(async c => {
    const result = await withTimeout(P.clipFromPost(c.url), 6000, { ok: false });
    if (result.ok) counts.push({ url: c.url, likes: result.likes, views: result.views });
  }));
  const updated = counts.length ? await withTimeout(LIB.setEngagement(counts), 6000, 0) : 0;
  return { checked: rows.length, updated };
}

// AI verdicts (game action? quality 1-5) for fresh library clips that have
// none yet, newest first, within today's classification budget. -> summary
async function classifyPass({ capUsd, runId, limit = CONFIG.classifyPerBatch }) {
  const out = { candidates: 0, classified: 0, notGame: 0, cost: 0, skipped: 0, calls: 0, stored: 0 };
  if (!(capUsd > 0) || !gatewayConfigured() || featureDisabled(CLASSIFY_FEATURE)) { out.off = true; return out; }
  // No user session in a cron: the team's week is read with the service role.
  // At or over the team cap the AI pass is skipped;
  // the rules still label clips and the job succeeds (ai-free-mode).
  const gate = await withTimeout(cronSpendGate({ feature: CLASSIFY_FEATURE }), 3000, null);
  if (gate) { out.off = gate.free || gate.reason || true; return out; }
  // Read without the game-action filter: rows the rules would hide still get an AI verdict.
  const rows = (await Promise.all(P.AD_SPORTS.map(sport => withTimeout(LIB.read({ sport, sinceHours: P.FIND_CLIPS.maxAgeHours }), 3500, []))))
    .flat()
    .filter(c => !(c.ai && typeof c.ai.isGameAction === 'boolean') && !P.CLASSIFY._test.MEMO.has(c.url))
    .sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt))
    .slice(0, limit);
  out.candidates = rows.length;
  if (!rows.length) return out;
  const started = Date.now();
  const result = await withTimeout(P.CLASSIFY.classifyClips(rows, {
    maxUsd: capUsd, track: { feature: CLASSIFY_FEATURE, runId },
    onCost: (cost, model) => logAiUsage(cost, { model, feature: CLASSIFY_FEATURE, ms: Date.now() - started }),
  }), CONFIG.classifyMs, null);
  if (!result) { out.timeout = true; return out; }
  out.classified = result.verdicts.size;
  out.notGame = [...result.verdicts.values()].filter(v => !v.isGameAction).length;
  out.cost = result.cost;
  out.skipped = result.skipped;
  out.calls = result.calls;
  out.stored = await withTimeout(LIB.setAi(result.verdicts), 6000, 0);
  return out;
}

// Runs `jobs` with a concurrency limit; no job starts after `cutoffAt`.
async function runPool(jobs, worker, { concurrency, cutoffAt }) {
  const results = [];
  const skipped = [];
  let next = 0;
  async function lane() {
    while (next < jobs.length) {
      const job = jobs[next];
      next += 1;
      if (Date.now() > cutoffAt) { skipped.push(job); continue; }
      results.push(await worker(job));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, lane));
  return { results, skipped };
}

async function runBatch({ batch, env = process.env, now = Date.now() } = {}) {
  const started = Date.now();
  const { batches, maxUsd, classifyUsd } = settings(env);
  const runId = `cp-${new Date(now).toISOString().slice(0, 10)}-${batch}`;
  const trending = batch === 1 ? await trendingTeams() : [];
  const jobs = planBatch({ batch, batches, trending });
  // Today's AI budget: what earlier batches left. If run summaries can't be
  // stored (migration not run), each batch gets an equal share instead.
  const persisted = LIB.status(env).writes;
  const spent = persisted ? await withTimeout(LIB.spentToday(), 4000, maxUsd) : 0;
  const cap = persisted ? Math.max(0, maxUsd - spent) : maxUsd / batches;
  const budget = makeBudget(cap);
  const aiOn = gatewayConfigured() && !featureDisabled(FEATURE) && cap > 0;
  // Classification budget: today's cap minus what earlier batches spent on it.
  const classifySpent = persisted ? await withTimeout(classifySpentToday(), 4000, classifyUsd) : 0;
  const classifyCap = persisted ? Math.max(0, classifyUsd - classifySpent) : classifyUsd / batches;
  // Engagement and classification of clips already in the library run
  // alongside the team refresh (new finds are judged by the next batch).
  const sidePasses = Promise.all([
    withTimeout(refreshEngagement({ now }), 15000, { checked: 0, updated: 0, timeout: true }),
    classifyPass({ capUsd: classifyCap, runId }),
  ]);
  const { results, skipped } = await runPool(jobs, job => withTimeout(
    refreshTeam(job, { budget, aiOn, runId }),
    CONFIG.teamMs,
    { team: job.team.name, sport: job.team.sport, trending: job.trending, timeout: true, free: 0, ai: 0, saved: 0, cost: 0, sources: {} },
  ), { concurrency: CONFIG.concurrency, cutoffAt: started + CONFIG.startCutoffMs });
  const [engagement, classify] = await sidePasses;
  const recheck = Date.now() - started < CONFIG.deadlineMs - 8000 ? await recheckLinks() : { checked: 0, dead: 0, alive: 0 };
  const purged = await withTimeout(LIB.purge(), 4000, { memory: 0, remote: false });
  const cost = results.reduce((sum, r) => sum + (r.cost || 0), 0);
  const sources = {};
  results.forEach(r => Object.entries(r.sources || {}).forEach(([id, n]) => { sources[id] = (sources[id] || 0) + n; }));
  const summary = {
    startedAt: new Date(started).toISOString(),
    day: new Date(now).toISOString().slice(0, 10),
    batch, batches, schedule: CRON_SCHEDULE,
    teams: jobs.length,
    done: results.filter(r => !r.timeout).length,
    timedOut: results.filter(r => r.timeout).map(r => r.team),
    skipped: skipped.map(j => j.team.name),
    trending: trending.map(t => t.name),
    aiTeams: results.filter(r => r.cost > 0).map(r => r.team),
    aiOn,
    found: results.reduce((n, r) => n + (r.free || 0) + (r.ai || 0), 0),
    saved: results.reduce((n, r) => n + (r.saved || 0), 0),
    sources,
    budget: { capToday: maxUsd, availableThisBatch: Number(cap.toFixed(4)), spent: Number(cost.toFixed(5)) },
    // Search + classification: what this batch spent in all (the run's cost_usd).
    cost: Number((cost + (classify.cost || 0)).toFixed(5)),
    searchCost: Number(cost.toFixed(5)),
    classify: { ...classify, capToday: classifyUsd, availableThisBatch: Number(classifyCap.toFixed(4)) },
    engagement,
    recheck,
    purged,
    store: LIB.status(env).store,
    ms: Date.now() - started,
  };
  await withTimeout(LIB.recordRun(summary), 4000, null);
  return summary;
}

// The next batch, when chaining instead of one cron per batch.
async function chainNext(batch, env = process.env) {
  const { batches } = settings(env);
  if (batch >= batches) return { chained: false };
  const base = String(env.CLIPS_PREFETCH_BASE_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) return { chained: false, reason: 'no-base-url' };
  try {
    // Wait only for the next call to start; it carries on by itself.
    await withTimeout(fetch(`${base}/api/clips-prefetch?batch=${batch + 1}&chain=1`, {
      headers: { Authorization: `Bearer ${String(env.CRON_SECRET || '').trim()}` },
    }), 2500, null);
    return { chained: true, next: batch + 1 };
  } catch {
    return { chained: false, reason: 'error' };
  }
}

// Admin diagnostics. Runs of the most recent day are summed as "lastDaily".
async function diagnostics(env = process.env) {
  const { batches, maxUsd } = settings(env);
  const [library, runs] = await Promise.all([LIB.stats(), LIB.recentRuns({ hours: 48, limit: 100 })]);
  const summaries = runs.map(r => ({ ...(r.summary || {}), startedAt: r.started_at, cost: Number(r.cost_usd || 0) }));
  const lastDay = summaries[0]?.day || '';
  const today = summaries.filter(s => s.day && s.day === lastDay);
  const lastDaily = today.length ? {
    day: lastDay,
    batchesRun: [...new Set(today.map(s => s.batch))].sort((a, b) => a - b),
    batchesExpected: batches,
    teams: today.reduce((n, s) => n + (s.teams || 0), 0),
    done: today.reduce((n, s) => n + (s.done || 0), 0),
    skipped: today.flatMap(s => s.skipped || []),
    timedOut: today.flatMap(s => s.timedOut || []),
    found: today.reduce((n, s) => n + (s.found || 0), 0),
    saved: today.reduce((n, s) => n + (s.saved || 0), 0),
    cost: Number(today.reduce((n, s) => n + (s.cost || 0), 0).toFixed(5)),
    deadMarked: today.reduce((n, s) => n + (s.recheck?.dead || 0), 0),
    firstStartedAt: today[today.length - 1].startedAt,
    lastStartedAt: today[0].startedAt,
  } : null;
  const sources = P.clipSources().map(s => {
    let configured = false;
    try { configured = Boolean(s.configured(env)); } catch { configured = false; }
    return { id: s.id, configured, paid: P.isPaidSource(s) };
  });
  return {
    ok: true,
    library,
    store: LIB.status(env),
    schedule: { cron: CRON_SCHEDULE, batches, everyMinutes: 5, timezone: 'UTC' },
    config: {
      cronSecret: Boolean(String(env.CRON_SECRET || '').trim()),
      serviceKey: Boolean(serviceRoleKey(env)),
      xApi: P.xApiOn(),
      aiGateway: gatewayConfigured(),
      aiOff: featureDisabled(FEATURE),
      maxUsdPerDay: maxUsd,
      sources,
    },
    lastDaily,
    runs: summaries.slice(0, 30),
  };
}

exports.handler = withAiMode(async function handler(event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) return json(405, { ok: false, error: 'Method not allowed.' });
  const query = event.queryStringParameters || {};
  if (String(query.diag || '') === '1') {
    if (!(await isAdmin(bearerToken(event.headers)))) return json(403, { ok: false, error: 'Admins only.' });
    try { return json(200, await diagnostics()); } catch (error) {
      console.error('clips-prefetch diag failed:', error);
      return json(502, { ok: false, error: 'Diagnostics are unavailable right now.' });
    }
  }
  if (!String(process.env.CRON_SECRET || '').trim()) return json(503, { ok: false, reason: 'not-configured', error: 'The clip prefetch is not set up (CRON_SECRET is missing).' });
  if (!cronAuthorized(event.headers)) return json(401, { ok: false, error: 'Unauthorized.' });
  if (isOff(process.env.CLIPS_PREFETCH) || !LIB.enabled()) return json(200, { ok: true, skipped: 'off' });
  const { batches } = settings();
  const batch = query.batch === undefined || query.batch === '' ? 1 : Number(query.batch);
  if (!Number.isInteger(batch) || batch < 1 || batch > batches) return json(400, { ok: false, error: `batch must be 1..${batches}.` });
  // ai-free-mode: team over this week's budget -> free sources and rules only (the job still succeeds).
  freeModeGate(await withTimeout(cronSpendGate({ feature: FEATURE }), 3000, null));
  try {
    const summary = await runBatch({ batch });
    console.log(JSON.stringify({ event: 'clips-prefetch', batch, teams: summary.teams, done: summary.done, saved: summary.saved, cost: summary.cost, ms: summary.ms }));
    const chain = String(query.chain || '') === '1' ? await chainNext(batch) : null;
    return json(200, { ok: true, ...summary, ...(chain ? { chain } : {}) });
  } catch (error) {
    console.error('clips-prefetch failed:', error);
    return json(502, { ok: false, error: 'The clip prefetch failed.' });
  }
});

exports._test = { refreshEngagement, classifyPass, classifySpentToday, cronAuthorized, planBatch, allTeams, settings, makeBudget, refreshTeam, runBatch, recheckLinks, diagnostics, trendingTeams, chainNext, CONFIG, CRON_SCHEDULE };
