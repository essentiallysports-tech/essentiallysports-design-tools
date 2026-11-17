// GET /api/version: which commit is live, so the app can notice a new deploy
// and say "FrameUp was updated" even when nobody wrote a release note
// (tours/tour-launcher.js). Only public build info from the host's system
// env vars; no secrets. Signed-in ES users only, like the other endpoints,
// because commit messages come from a private repo.
//   Vercel:  VERCEL_GIT_COMMIT_SHA, VERCEL_GIT_COMMIT_MESSAGE (system env vars)
//   Netlify: COMMIT_REF (no commit message is exposed there)
// deployedAt comes from FRAMEUP_DEPLOYED_AT when a build sets it, else null.
const { verifyEsUser } = require('./_supabase-auth.js');

const MAX_MESSAGE = 140;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      // Short per-browser cache; the app asks once per tab session anyway.
      'Cache-Control': 'private, max-age=60',
    },
    body: JSON.stringify(body),
  };
}

function versionInfo(env = process.env) {
  const sha = String(env.VERCEL_GIT_COMMIT_SHA || env.COMMIT_REF || '').trim();
  const firstLine = String(env.VERCEL_GIT_COMMIT_MESSAGE || '').split('\n')[0].trim();
  const message = firstLine.length > MAX_MESSAGE ? `${firstLine.slice(0, MAX_MESSAGE - 1).trimEnd()}…` : firstLine;
  return {
    sha: sha ? sha.slice(0, 12) : '',
    message,
    deployedAt: env.FRAMEUP_DEPLOYED_AT || null,
  };
}

async function handler(event = {}) {
  if (event.httpMethod && event.httpMethod !== 'GET') return json(405, { ok: false, error: 'GET only.' });
  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error });
  const info = versionInfo();
  if (!info.sha) return json(404, { ok: false, error: 'No deploy info on this host.' });
  return json(200, { ok: true, ...info });
}

module.exports = { handler, versionInfo };
