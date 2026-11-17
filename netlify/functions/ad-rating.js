'use strict';
// Video Ads rating endpoint. POST { frames: [dataUrl, ...], context: {...} }
// -> { ok, score, verdict, caps, factors, flags, fixes, confidence, model, cost, ... }
//
// A vision model rates sampled frames of the ad; the score, caps and verdict
// are computed here (see _ad-rating.js), never taken from the model.
// Needs a signed-in ES user; counts toward the per-person hourly AI limit.
const { verifyEsUser, bearerToken } = require('./_supabase-auth.js');
const { gatewayConfigured, isBudgetError, userOverHourlyLimit, aiSpendGate } = require('./_ai-gateway.js');
const { rateCreative, parseDataUrl } = require('./_ad-rating.js');
const { SIZES } = require('../../video-ads-brands.js');

const MAX_FRAMES = 4;
const MAX_FRAME_BYTES = 600 * 1024;
const MAX_BODY_CHARS = 3.5 * 1024 * 1024; // under Vercel's 4.5 MB request cap
// First bytes of each format, base64-encoded, so a mislabeled upload is refused.
const MAGIC = { 'image/jpeg': '/9j/', 'image/png': 'iVBORw0KGgo', 'image/webp': 'UklGR' };

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

// Returns an error message, or '' when the frames are fine.
function checkFrames(frames) {
  if (!Array.isArray(frames) || !frames.length) return 'Send at least one frame of the ad to rate.';
  if (frames.length > MAX_FRAMES) return `Send at most ${MAX_FRAMES} frames.`;
  for (let i = 0; i < frames.length; i += 1) {
    const parsed = typeof frames[i] === 'string' ? parseDataUrl(frames[i]) : null;
    if (!parsed) return `Frame ${i + 1} must be a JPEG, PNG or WebP image.`;
    if (!parsed.data.startsWith(MAGIC[parsed.mediaType])) return `Frame ${i + 1} is not a valid ${parsed.mediaType.slice(6).toUpperCase()} image.`;
    const bytes = Math.floor((parsed.data.length * 3) / 4);
    if (bytes > MAX_FRAME_BYTES) return `Frame ${i + 1} is too large. Export frames at 540px wide or smaller.`;
  }
  return '';
}

function checkContext(context) {
  if (context == null) return '';
  if (typeof context !== 'object' || Array.isArray(context)) return 'The ad details are not in the right format.';
  if (context.placement != null && !SIZES[context.placement]) return 'Placement must be 9x16, 4x5 or 1x1.';
  if (context.objective != null && context.objective !== 'newsletter_signup') return 'Only newsletter signup ads can be rated.';
  if (context.body != null && !Array.isArray(context.body)) return 'The body copy must be a list of paragraphs.';
  if (context.verifiedClaims != null && !Array.isArray(context.verifiedClaims)) return 'Verified claims must be a list.';
  if (context.style != null && typeof context.style !== 'string') return 'The style must be a style id.';
  if (context.background != null && !['clip', 'animated', 'photo'].includes(context.background)) return 'Background must be clip, animated or photo.';
  if (context.styleCopy != null && (typeof context.styleCopy !== 'object' || Array.isArray(context.styleCopy))) return 'The style copy is not in the right format.';
  return '';
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });

  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error });

  if (String(event.body || '').length > MAX_BODY_CHARS) {
    return json(413, { ok: false, error: 'The frames are too large to send. Use up to 4 frames at 540px wide.' });
  }
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (error) { return json(400, { ok: false, error: 'Invalid request.' }); }
  if (!body || typeof body !== 'object') return json(400, { ok: false, error: 'Invalid request.' });

  const frameError = checkFrames(body.frames);
  if (frameError) return json(400, { ok: false, error: frameError });
  const contextError = checkContext(body.context);
  if (contextError) return json(400, { ok: false, error: contextError });

  if (!gatewayConfigured()) return json(503, { ok: false, error: 'Ad rating is not available right now.', reason: 'off' });
  const token = bearerToken(event.headers);
  const [gate, overHour] = await Promise.all([aiSpendGate(token, { feature: 'video-ads-rating' }), userOverHourlyLimit(token)]);
  if (gate) return json(gate.status, { ok: false, error: gate.error, reason: gate.reason });
  if (overHour) {
    return json(429, { ok: false, error: "You've used a lot of AI this hour. Take a short break and rate again soon.", reason: 'limit' });
  }

  try {
    const result = await rateCreative({
      frames: body.frames,
      context: body.context || {},
      track: { feature: 'video-ads-rating', email: auth.user.email, token },
    });
    return json(200, result);
  } catch (error) {
    if (isBudgetError(error)) {
      return json(503, { ok: false, error: "This week's AI budget is used up, so ad ratings are paused until it resets.", reason: 'budget' });
    }
    if (error.code === 'invalid_review') {
      console.error('ad-rating: invalid model reply:', error.errors);
      return json(502, { ok: false, error: error.message, reason: 'invalid', cost: error.cost || 0 });
    }
    if (error.code === 'bad_frame') return json(400, { ok: false, error: error.message });
    console.error('ad-rating failed:', error);
    return json(502, { ok: false, error: 'Ad rating is unavailable right now. Try again in a moment.' });
  }
};

exports._test = { checkFrames, checkContext, MAX_FRAMES, MAX_FRAME_BYTES, MAX_BODY_CHARS };
