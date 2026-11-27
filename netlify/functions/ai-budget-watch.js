'use strict';
// GET /api/ai-budget-watch: the daily AI budget check (Vercel cron, vercel.json
// "crons"). Sends Slack alerts when the team passes 50/80/100% of
// AI_TEAM_WEEKLY_LIMIT_USD or a person passes 80% of their weekly cap
// (netlify/functions/_ai-alerts.js).
//
// Protected by CRON_SECRET: Vercel sends "Authorization: Bearer <CRON_SECRET>"
// on cron calls when that env var is set. Without CRON_SECRET the endpoint
// refuses every call, so it can never be triggered from outside.
const crypto = require('node:crypto');
const { runBudgetWatch } = require('./_ai-alerts.js');
const { teamWeeklyLimitUsd, weekStartUtc, userWeeklyLimitUsd } = require('./_ai-gateway.js');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function header(headers, name) {
  const key = Object.keys(headers || {}).find(k => k.toLowerCase() === name);
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

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

exports.handler = async function handler(event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) return json(405, { ok: false, error: 'Method not allowed.' });
  if (!String(process.env.CRON_SECRET || '').trim()) return json(503, { ok: false, reason: 'not-configured', error: 'The budget watch is not set up (CRON_SECRET is missing).' });
  if (!cronAuthorized(event.headers)) return json(401, { ok: false, error: 'Unauthorized.' });
  const result = await runBudgetWatch({
    teamLimit: teamWeeklyLimitUsd(),
    userLimit: userWeeklyLimitUsd(),
    weekStart: weekStartUtc().toISOString(),
  });
  if (result.error) console.warn(JSON.stringify({ event: 'ai-budget-watch', ...result }));
  // The daily Merch sales sync rides this cron (the project keeps to two
  // crons). Soft-fail: a sync problem never changes the budget answer.
  let merch = null;
  try {
    const sync = require('./merch-sync.js');
    if (sync._test?.runSync) merch = await sync._test.runSync({});
  } catch (error) {
    merch = { ok: false, error: String(error?.message || error).slice(0, 200) };
    console.warn(JSON.stringify({ event: 'merch-sync-in-budget-watch', error: merch.error }));
  }
  if (merch && merch.ok === false) console.warn(JSON.stringify({ event: 'merch-sync-in-budget-watch', ok: false }));
  // Reels v4: the daily house lessons ride this cron too (same two-cron rule).
  // Soft-fail and $0 when nothing changed; never changes the budget answer.
  try {
    const lessons = await require('./_reel-lessons.js').runLessonsJob({ service: true });
    if (lessons && lessons.ok === false) console.warn(JSON.stringify({ event: 'reel-lessons-in-budget-watch', reason: lessons.reason }));
  } catch (error) {
    console.warn(JSON.stringify({ event: 'reel-lessons-in-budget-watch', error: String(error?.message || error).slice(0, 200) }));
  }
  return json(result.ok ? 200 : 502, result); // the budget answer's shape is unchanged
};

exports._test = { cronAuthorized };
