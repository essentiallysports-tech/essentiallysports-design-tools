'use strict';
// AI spend alerts to Slack (SLACK_AI_ALERTS_WEBHOOK_URL, a channel of its own,
// never the design-request webhook).
//
// Fires once per week per threshold:
//   * the team crosses 50%, 80% or 100% of AI_TEAM_WEEKLY_LIMIT_USD;
//   * one person crosses 80% of their weekly cap (AI_USER_WEEKLY_LIMIT_USD).
// Two paths send them:
//   * runBudgetWatch(), called by the daily cron (api/ai-budget-watch.js), and
//   * teamThresholdAlert(), called by aiSpendGate when a request sees the team
//     total cross a threshold (so 80% doesn't wait for the next cron).
// Both need SUPABASE_SERVICE_ROLE_KEY (server env only): it reads the week's
// totals with frameup_ai_budget_summary() and claims each alert once with
// frameup_ai_alert_claim(), so several servers never post the same alert
// twice. Without the webhook or the key, nothing is sent and nothing breaks.

const { authConfig } = require('./_supabase-auth.js');

const TEAM_THRESHOLDS = [50, 80, 100];
const USER_THRESHOLD = 80;

function alertsConfig(env = process.env) {
  return {
    webhook: String(env.SLACK_AI_ALERTS_WEBHOOK_URL || '').trim(),
    serviceKey: String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  };
}

function usd(value) {
  const n = Number(value) || 0;
  return `$${n.toFixed(2)}`;
}

// Calls a service-role-only RPC. Returns parsed JSON, or throws.
async function serviceRpc(name, args, serviceKey) {
  const config = authConfig();
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw Object.assign(new Error(`${name} failed: ${response.status}`), { status: response.status });
  return response.json();
}

// True the first time a key is claimed. Keys already claimed by this instance
// are remembered so a busy server doesn't ask the database on every request.
const claimedHere = new Set();
async function claimAlert(key, serviceKey) {
  if (claimedHere.has(key)) return false;
  const claimed = await serviceRpc('frameup_ai_alert_claim', { p_key: key }, serviceKey);
  claimedHere.add(key);
  return claimed === true || (Array.isArray(claimed) && claimed[0] === true);
}

async function postSlack(text, webhook) {
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Slack webhook failed: ${response.status}`);
  return true;
}

const weekKey = weekStart => String(weekStart || '').slice(0, 10);
const emailName = email => String(email || '').split('@')[0] || 'someone';

// The thresholds a total has reached, highest last.
function reachedThresholds(total, limit, thresholds = TEAM_THRESHOLDS) {
  if (!(limit > 0)) return [];
  const pct = Math.round((Number(total) || 0) / limit * 1e6) / 1e4; // no float noise at exactly 80%
  return thresholds.filter(threshold => pct >= threshold);
}

function teamMessage(threshold, total, limit) {
  if (threshold >= 100) return `:rotating_light: FrameUp AI: the team has used this week's ${usd(limit)} AI budget (${usd(total)} so far). AI features are paused until Monday 00:00 UTC (FrameUp runs in free mode); to resume sooner, raise POLICY in netlify/functions/_ai-gateway.js and the Gateway budget.`;
  return `:warning: FrameUp AI: the team has used ${threshold}% of this week's ${usd(limit)} AI budget (${usd(total)} so far). It resets Monday 00:00 UTC.`;
}

function userMessage(email, total, limit) {
  return `:warning: FrameUp AI: ${emailName(email)} has used ${Math.floor((Number(total) || 0) / limit * 100)}% of their ${usd(limit)} weekly AI limit (${usd(total)} so far).`;
}

// Claims every reached team threshold for the week and posts one message for
// the highest newly claimed one. Returns the keys that were sent.
async function sendTeamAlerts({ total, limit, weekStart }, config) {
  const sent = [];
  let highest = 0;
  for (const threshold of reachedThresholds(total, limit)) {
    const key = `team:${weekKey(weekStart)}:${threshold}`;
    if (await claimAlert(key, config.serviceKey)) { highest = threshold; sent.push(key); }
  }
  if (highest) await postSlack(teamMessage(highest, total, limit), config.webhook);
  return sent;
}

async function sendUserAlerts({ users, limit, weekStart }, config) {
  const sent = [];
  if (!(limit > 0)) return sent;
  for (const user of (Array.isArray(users) ? users : [])) {
    const total = Number(user?.total_usd) || 0;
    if (!user?.email || total * 100 < limit * USER_THRESHOLD - 1e-9) continue;
    const key = `user:${weekKey(weekStart)}:${String(user.email).toLowerCase()}:${USER_THRESHOLD}`;
    if (await claimAlert(key, config.serviceKey)) {
      await postSlack(userMessage(user.email, total, limit), config.webhook);
      sent.push(key);
    }
  }
  return sent;
}

// The cron job: reads the week's totals and sends any new alerts.
// Returns a summary (never throws).
async function runBudgetWatch({ teamLimit, userLimit, weekStart, env = process.env } = {}) {
  const config = alertsConfig(env);
  if (!config.webhook) return { ok: true, skipped: 'alerts-off', sent: [] };
  if (!config.serviceKey) return { ok: true, skipped: 'no-service-key', sent: [] };
  let summary;
  try {
    summary = await serviceRpc('frameup_ai_budget_summary', { p_since: weekStart }, config.serviceKey);
  } catch (error) {
    return { ok: false, skipped: 'summary-unreadable', error: error.message, sent: [] };
  }
  const row = Array.isArray(summary) ? summary[0] : summary;
  const total = Number(row?.total_usd) || 0;
  const users = Array.isArray(row?.users) ? row.users : [];
  try {
    const sent = [
      ...await sendTeamAlerts({ total, limit: teamLimit, weekStart }, config),
      ...await sendUserAlerts({ users, limit: userLimit, weekStart }, config),
    ];
    return { ok: true, sent, team: { totalUsd: Number(total.toFixed(4)), limitUsd: teamLimit || 0 }, usersOverThreshold: users.filter(u => userLimit > 0 && Number(u?.total_usd) >= userLimit * USER_THRESHOLD / 100).length };
  } catch (error) {
    return { ok: false, error: error.message, sent: [] };
  }
}

// Real-time path from aiSpendGate. Only acts when a threshold this instance
// hasn't seen yet is reached; never throws and gives up after 3s.
const seenHere = new Set();
async function teamThresholdAlert({ total, limit, weekStart, env = process.env }) {
  const config = alertsConfig(env);
  if (!config.webhook || !config.serviceKey) return [];
  const fresh = reachedThresholds(total, limit).filter(threshold => !seenHere.has(`${weekKey(weekStart)}:${threshold}`));
  if (!fresh.length) return [];
  fresh.forEach(threshold => seenHere.add(`${weekKey(weekStart)}:${threshold}`));
  try {
    return await Promise.race([
      sendTeamAlerts({ total, limit, weekStart }, config),
      new Promise(resolve => setTimeout(() => resolve([]), 3000).unref?.()),
    ]);
  } catch {
    return [];
  }
}

module.exports = {
  runBudgetWatch, teamThresholdAlert, reachedThresholds, teamMessage, userMessage, alertsConfig,
  TEAM_THRESHOLDS, USER_THRESHOLD,
  _reset() { claimedHere.clear(); seenHere.clear(); },
};
