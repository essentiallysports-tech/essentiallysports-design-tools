'use strict';
// Impact stats pull (groundwork). Admins only.
//
//   GET  /api/impact-stats          → { ok, sources: { beehiiv: { configured }, meta: { configured } } }
//   POST /api/impact-stats { source: 'beehiiv' | 'meta' }
//                                   → 503 when that source's key isn't set,
//                                     501 "not built yet" when it is.
//
// Env (server only, never sent to the browser):
//   BEEHIIV_API_KEY    Beehiiv API key (Settings → Integrations → API). Later:
//                      GET /v2/publications/{id}/posts?expand=stats for posts
//                      linked in frameup_post_links, written to
//                      frameup_post_results (source 'beehiiv').
//   META_ACCESS_TOKEN  Meta Marketing API token from a Business Manager system
//                      user with ads_read. Later: /act_{id}/insights at ad
//                      level, matched by ad id or ad name
//                      ({brand}_{style}_{angle}_{WxH}_{yyyymmdd}).
//   META_AD_ACCOUNT_ID Optional; the ad account (act_…) to read.
// Until the pull is built, admins import the same numbers from CSV on the
// Dashboard (Impact → Import results).
const { verifyEsUser, bearerToken, authConfig } = require('./_supabase-auth.js');

const SOURCES = Object.freeze({
  beehiiv: { env: 'BEEHIIV_API_KEY', label: 'Beehiiv' },
  meta: { env: 'META_ACCESS_TOKEN', label: 'Meta Ads' },
});

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

const configured = name => Boolean(String(process.env[SOURCES[name].env] || '').trim());

async function isAdmin(token) {
  const config = authConfig();
  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/is_es_designer_admin`, {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: '{}',
    });
    if (!response.ok) return false;
    return (await response.json().catch(() => false)) === true;
  } catch (error) {
    return false;
  }
}

exports.SOURCES = SOURCES;
exports.handler = async function handler(event = {}) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' };
  if (!['GET', 'POST'].includes(event.httpMethod)) return json(405, { ok: false, error: 'Method not allowed.' });

  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error });
  if (!(await isAdmin(bearerToken(event.headers)))) return json(403, { ok: false, error: 'Admins only.' });

  if (event.httpMethod === 'GET') {
    return json(200, {
      ok: true,
      sources: Object.fromEntries(Object.entries(SOURCES).map(([name, info]) => [name, { configured: configured(name), label: info.label }])),
    });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { ok: false, error: 'Invalid request.' }); }
  const source = String(body?.source || '');
  if (!SOURCES[source]) return json(400, { ok: false, error: 'Unknown source.' });
  if (!configured(source)) {
    return json(503, { ok: false, configured: false, error: `${SOURCES[source].label} isn't connected yet. Use the CSV import for now.` });
  }
  return json(501, { ok: false, configured: true, error: `${SOURCES[source].label} pull isn't built yet. Use the CSV import for now.` });
};
