'use strict';
// GET /api/ai-status: the AI guardrail settings for signed-in ES users: the
// weekly caps, which features are switched off (AI_DISABLE), economy mode and
// whether Slack alerts are set up, plus this week's budget state:
//   mode 'ai' | 'free', reason 'user-limit' | 'team-limit' | 'gateway-budget' | null,
//   userLimitUsd, userSpentUsd, teamLimitUsd, teamSpentUsd (aggregate only),
//   resetsAt (next Monday 00:00 UTC), notice, admin.
// No secrets. frameup-ai-mode.js reads it (cached ~60 s) so pages can show
// free mode before anyone clicks; the sidebar "AI usage" card shows it.
//
// GET /api/ai-status?diag=1 (dashboard admins only, checked in the database
// with is_es_designer_admin()): for every AI job, which provider and model
// would run and whether its key is present. Booleans only, never a key.
const { authConfig, bearerToken, verifyEsUser } = require('./_supabase-auth.js');
const { aiGuardConfig, aiBudgetStatus, gatewayConfigured, featureDisabled, modelFor, transcriptionPlan, MODELS, TRANSCRIPTION_MODEL } = require('./_ai-gateway.js');
const { directorTier } = require('./_creative-director.js');

function json(statusCode, body, cache = 'private, max-age=60') {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache }, body: JSON.stringify(body) };
}

// The database decides who is an admin (the function the RLS policies use).
// Any failure means "not an admin".
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

// Per AI job: provider, model, keyPresent (boolean), plus the backup where there is one.
function diagnostics(env = process.env) {
  const gateway = gatewayConfigured();
  const groq = Boolean(env.GROQ_API_KEY);
  const viaGateway = (tier, feature) => ({ provider: 'gateway', model: modelFor(tier), keyPresent: gateway, switchedOff: featureDisabled(feature) });
  const gatewayBackup = { provider: 'gateway', model: MODELS.backup, keyPresent: gateway };
  const plan = transcriptionPlan(env);
  const first = plan.find(step => step.keyPresent) || null;
  return {
    gatewayKeyPresent: Boolean(env.AI_GATEWAY_API_KEY),
    generateAi: String(env.GENERATE_AI || 'auto').toLowerCase(),
    economy: aiGuardConfig().economy,
    jobs: {
      text: { ...viaGateway('main', 'generate'), backup: groq ? { provider: 'groq', model: env.GROQ_GENERATE_MODEL || 'openai/gpt-oss-120b', keyPresent: true } : gatewayBackup },
      trends: { ...viaGateway('light', 'trend'), backup: groq ? { provider: 'groq', model: env.GROQ_TITLES_MODEL || 'openai/gpt-oss-20b', keyPresent: true } : gatewayBackup },
      // 'auto' = Haiku first, Sonnet once on escalation.
      director: (() => {
        const tier = directorTier(env.GENERATE_DIRECTOR_MODEL || env.GENERATE_DIRECTOR_TIER || '');
        return tier === 'auto'
          ? { ...viaGateway('main', 'generate-director'), mode: 'auto', escalation: modelFor('best') }
          : viaGateway(tier, 'generate-director');
      })(),
      review: viaGateway('review', 'generate-review'),
      escalation: viaGateway('best', 'generate-escalate'),
      search: { ...viaGateway('search', 'video-ads-find-clips'), xApiKeyPresent: Boolean(env.X_BEARER_TOKEN) },
      transcription: {
        willUse: first ? { provider: first.provider, model: first.model } : null,
        order: plan.map(({ provider, model, keyPresent, billed, perMinuteUsd }) => ({ provider, model, keyPresent, billed, perMinuteUsd })),
        preferred: String(env.REELS_TRANSCRIBE || '').trim().toLowerCase() || 'default (groq, gateway, openai)',
        gatewayModel: env.AI_TRANSCRIPTION_MODEL || TRANSCRIPTION_MODEL,
        switchedOff: featureDisabled('reels-transcription'),
      },
      tts: { provider: 'none', model: '', keyPresent: gateway, note: 'No text-to-speech feature in FrameUp yet; the Gateway key would cover it.' },
      image: { provider: 'gateway', model: MODELS.image, keyPresent: gateway, enabled: String(env.GENERATE_IMAGES || '').toLowerCase() !== 'off', switchedOff: featureDisabled('generate-scene-image') },
      directOpenAi: { keyPresent: Boolean(env.OPENAI_API_KEY), usedFor: 'Reels transcription last resort; Generate only with GENERATE_USE_OPENAI=true' },
    },
  };
}

async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Method not allowed.' });
  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error });
  const params = event.queryStringParameters || {};
  if (params.diag === '1' || params.diag === 'true') {
    if (!(await isAdmin(bearerToken(event.headers)))) return json(403, { ok: false, error: 'Admins only.' }, 'no-store');
    return json(200, { ok: true, ...aiGuardConfig(), diagnostics: diagnostics() }, 'no-store');
  }
  const token = bearerToken(event.headers);
  const [budget, admin] = await Promise.all([aiBudgetStatus(token), isAdmin(token)]);
  return json(200, { ok: true, gateway: gatewayConfigured(), ...aiGuardConfig(), ...budget, admin }, 'private, max-age=30');
}

// Not wrapped in withAiMode: the status itself is not a free-mode reply.
exports.handler = handler;

exports._test = { diagnostics, isAdmin };
