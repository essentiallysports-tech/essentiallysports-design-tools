// FrameUp Generate: "Scene image" button. Makes ONE background image for a
// design (a place or objects: stadiums, crowds, courts, kitchens), only when a
// person clicks for it. Never real people, players, team logos or trademarks:
// those come from the ES Image Pool. Every image is logged to
// frameup_ai_usage (images: 1, cost) through _ai-gateway.js.
const { verifyEsUser } = require('./_supabase-auth.js');
const { gatewayConfigured, aiImage, isBudgetError } = require('./_ai-gateway.js');
const { _test: { sceneText } } = require('./es-generate.js');

// A soft per-user cap on each warm server (the weekly Gateway cap is the hard one).
const HOURLY_LIMIT = Number(process.env.GENERATE_IMAGE_HOURLY_LIMIT || 12);
const recent = new Map();

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

// The words the image model sees. The scene is already stripped of names.
function scenePrompt(scene) {
  return [
    `Editorial sports photograph used as a social media background: ${scene}.`,
    'Wide, cinematic, realistic, natural light, shallow depth of field, calm empty area for a headline.',
    'Strictly no people in focus, no faces, no players or athletes, no crowd close-ups,',
    'no logos, no brand marks, no team names, no jersey numbers, no text, no letters, no watermark.',
  ].join(' ');
}

function underLimit(email) {
  const now = Date.now();
  const times = (recent.get(email) || []).filter(at => now - at < 3600e3);
  if (times.length >= HOURLY_LIMIT) return false;
  times.push(now);
  recent.set(email, times);
  return true;
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { error: auth.error });
  if (!gatewayConfigured() || String(process.env.GENERATE_IMAGES || '').toLowerCase() === 'off') {
    return json(503, { error: 'Scene images are not available right now.', reason: 'off' });
  }
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { error: 'Bad request.' });
  }
  const scene = sceneText(body.scene) || sceneText(`empty ${String(body.sport || 'sports').toLowerCase().replace(/[^a-z ]/g, '')} stadium at night under bright floodlights`);
  if (!scene) return json(400, { error: 'Describe a scene first.' });
  const email = auth.user?.email || 'unknown';
  if (!underLimit(email)) return json(429, { error: 'That is a lot of scene images this hour. Try again later.', reason: 'limit' });
  const token = String(event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
  try {
    const image = await aiImage({ prompt: scenePrompt(scene), track: { feature: 'generate-scene-image', email, token } });
    return json(200, { ok: true, scene, dataUrl: image.dataUrl, model: image.model, cost: image.cost });
  } catch (error) {
    if (isBudgetError(error)) return json(503, { error: "This week's AI budget is used up, so scene images are paused until it resets. ES photos still work.", reason: 'budget' });
    return json(502, { error: 'The scene image could not be made. Try again in a moment.', detail: String(error.message || error).slice(0, 160) });
  }
};

exports._test = { scenePrompt, underLimit };
