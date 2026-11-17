'use strict';
// GET /api/ai-status: the AI guardrail settings for signed-in ES users: the
// weekly caps, which features are switched off (AI_DISABLE), economy mode and
// whether Slack alerts are set up. No secrets and no spend; the Dashboard's AI
// panel reads it to show the team cap, and pages can use it to show a feature
// as switched off before anyone clicks.
const { verifyEsUser } = require('./_supabase-auth.js');
const { aiGuardConfig, gatewayConfigured } = require('./_ai-gateway.js');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=60' }, body: JSON.stringify(body) };
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed.' });
  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error });
  return json(200, { ok: true, gateway: gatewayConfigured(), ...aiGuardConfig() });
};
