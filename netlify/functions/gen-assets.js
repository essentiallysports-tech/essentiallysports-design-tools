// FrameUp Generate (Creative mode): the asset service over HTTP.
//   GET  /api/gen-assets            what is set up (models, prices, storage; no secrets)
//   POST /api/gen-assets {op, ...}  op: background | concept | cutout | photos
// Signed-in ES staff only. AI ops pass aiSpendGate (inside _asset-service.js),
// the per-person hourly cap, and a per-image cost cap; every model call is
// logged to frameup_ai_usage. See project-docs/gen-assets.md.
const { verifyEsUser } = require('./_supabase-auth.js');
const { userOverHourlyLimit } = require('./_ai-gateway.js');
const assets = require('./_asset-service.js');

const HOURLY_LIMIT = () => Math.max(1, Number(process.env.GEN_ASSETS_HOURLY_LIMIT) || 40);
// Most one image may cost unless the caller asks for less (owner OK'd more spend for Creative).
const MAX_USD_PER_IMAGE = () => {
  const value = Number(process.env.GEN_ASSETS_MAX_USD_PER_IMAGE);
  return Number.isFinite(value) && value > 0 ? value : 0.12;
};
const recent = new Map();

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function underLimit(email, now = Date.now()) {
  const times = (recent.get(email) || []).filter(at => now - at < 3600e3);
  if (times.length >= HOURLY_LIMIT()) { recent.set(email, times); return false; }
  times.push(now);
  recent.set(email, times);
  return true;
}

const STATUS_BY_REASON = {
  off: 503, 'feature-off': 503, budget: 503, 'limit-unknown': 503,
  'weekly-limit': 429, 'team-limit': 429,
  unsafe: 422, guard: 422, moderation: 422,
  reference: 400, 'bad-image': 400, empty: 400, client: 400,
  'too-large': 413, error: 502,
};

const pickString = (value, max) => String(value ?? '').slice(0, max);
const pickList = (value, max, each) => (Array.isArray(value) ? value.slice(0, max).map(item => pickString(item, each)) : []);

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { error: auth.error });
  if (event.httpMethod === 'GET') return json(200, assets.status());

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { error: 'Bad request.' });
  }
  const email = auth.user?.email || 'unknown';
  const token = String(event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
  const requested = Number(body.maxCostUsd);
  const ctx = {
    email, token,
    runId: pickString(body.runId, 80) || undefined,
    maxCostUsd: Number.isFinite(requested) && requested >= 0 ? Math.min(requested, MAX_USD_PER_IMAGE()) : MAX_USD_PER_IMAGE(),
  };
  const op = String(body.op || '');
  const paid = ['background', 'concept', 'cutout'].includes(op);
  if (!paid && op !== 'photos') return json(400, { error: 'Unknown op. Use background, concept, cutout or photos.' });
  if (paid && (!underLimit(email) || await userOverHourlyLimit(token))) {
    return json(429, { error: 'That is a lot of AI images this hour. Try again later.', reason: 'limit' });
  }

  const seed = Number.isInteger(body.seed) ? body.seed : undefined;
  let result;
  try {
    if (op === 'background') {
      result = await assets.generateBackground({
        prompt: pickString(body.prompt, 400), style: pickString(body.style, 20), palette: pickList(body.palette, 4, 9),
        size: pickString(body.size, 12), seed, quality: body.quality === 'high' ? 'high' : 'standard',
        space: pickString(body.space, 10) || undefined, sport: pickString(body.sport, 40), avoid: pickList(body.avoid, 30, 60),
        referenceUrl: pickString(body.referenceUrl, 4000000) || undefined,
      }, ctx);
    } else if (op === 'concept') {
      result = await assets.generateConceptArt({
        concept: pickString(body.concept, 400), sport: pickString(body.sport, 40), palette: pickList(body.palette, 4, 9),
        avoid: pickList(body.avoid, 30, 60), size: pickString(body.size, 12), seed, quality: body.quality === 'high' ? 'high' : 'standard',
        space: pickString(body.space, 10) || undefined,
      }, ctx);
    } else if (op === 'cutout') {
      result = await assets.cutout({ image: pickString(body.image, 6000000), size: pickString(body.size, 12), source: pickString(body.source, 120) || undefined }, ctx);
    } else {
      result = await assets.findPhotos({
        person: body.person, team: body.team, sport: body.sport, query: body.query,
        count: Number(body.count) || 6, exclude: pickList(body.exclude, 50, 600),
      }, ctx);
    }
  } catch (error) {
    console.error('gen-assets failed:', error);
    return json(502, { ok: false, error: 'The asset could not be made. Try again in a moment.', reason: 'error' });
  }
  if (!result?.ok) return json(result?.status || STATUS_BY_REASON[result?.reason] || 502, result || { ok: false, reason: 'error' });
  return json(200, result);
};

exports._test = { underLimit, recent, STATUS_BY_REASON, MAX_USD_PER_IMAGE };
