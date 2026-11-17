'use strict';
// Video Ads learning events. POST { event: { type, brandId?, sport?, payload } }
// -> { ok: true } when saved, { ok: false } otherwise (no details leaked).
//
// The editor sends these fire-and-forget (copy generated, applied, edited,
// exported; clips that failed). _ad-learning.js saves them with the user's
// own session and later turns them into examples and rules for the copy
// writer. Needs a signed-in ES user; respects the per-person hourly limit.
const { verifyEsUser, bearerToken } = require('./_supabase-auth.js');
const { userOverHourlyLimit } = require('./_ai-gateway.js');
const { normalizeEvent, recordEvent } = require('./_ad-learning.js');

const MAX_BODY_CHARS = 20 * 1024;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });

  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error });

  if (String(event.body || '').length > MAX_BODY_CHARS) return json(413, { ok: false, error: 'Event is too large.' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Invalid request.' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { ok: false, error: 'Invalid request.' });

  const checked = normalizeEvent(body.event);
  if (checked.error) return json(400, { ok: false, error: checked.error });

  const token = bearerToken(event.headers);
  if (await userOverHourlyLimit(token)) return json(429, { ok: false, error: 'Too many requests this hour.' });

  const saved = await recordEvent({ token, email: auth.user.email, event: body.event });
  return json(200, { ok: Boolean(saved) });
};
