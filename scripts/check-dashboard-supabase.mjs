#!/usr/bin/env node

const SUPABASE_URL = 'https://xtdusejokbhtjlmijdca.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_1T9d9U0qXD5K-Ay-_43IVA_Qdd1dpHF';
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || process.env.ES_DASHBOARD_SUPABASE_ACCESS_TOKEN
  || '';

const TABLES = [
  'es_designer_profiles',
  'es_designer_presence',
];

async function checkTable(table) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`;
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN || SUPABASE_PUBLISHABLE_KEY}`,
    },
  });
  const bodyText = await response.text();
  let body = bodyText;
  try {
    body = JSON.parse(bodyText);
  } catch {
    // Keep plain text body when Supabase does not return JSON.
  }

  return {
    table,
    ok: response.ok || response.status === 401 || response.status === 403,
    status: response.status,
    body,
  };
}

const results = await Promise.all(TABLES.map(checkTable));
let failed = false;
let inconclusive = false;

for (const result of results) {
  if (result.ok) {
    console.log(`✅ ${result.table}: reachable with ${SUPABASE_ACCESS_TOKEN ? 'authenticated' : 'anonymous'} token (HTTP ${result.status})`);
    continue;
  }

  if (!SUPABASE_ACCESS_TOKEN && result.status === 404 && result.body?.code === 'PGRST205') {
    inconclusive = true;
    console.warn(`⚠️  ${result.table}: anonymous token cannot verify this authenticated-only table (HTTP ${result.status} ${result.body.code})`);
    console.warn('   Re-run with SUPABASE_ACCESS_TOKEN set to a logged-in ES admin/user access token.');
    continue;
  }

  failed = true;
  const code = result.body?.code ? ` ${result.body.code}` : '';
  const message = result.body?.message || result.body || 'Unknown Supabase error';
  console.error(`❌ ${result.table}: missing or unreachable (HTTP ${result.status}${code})`);
  console.error(`   ${message}`);
}

if (failed) {
  console.error('\nApply supabase/migrations/20260708123000_add_dashboard_profiles_presence.sql, then run this check again.');
  process.exit(1);
}

if (inconclusive) {
  console.warn('\nDashboard Supabase table check is inconclusive without an authenticated access token.');
  console.warn('Open the live dashboard as an admin, or run this script with SUPABASE_ACCESS_TOKEN to verify table access.');
  process.exit(2);
}

console.log('\nDashboard Supabase tables are reachable. Continue with signed-in admin dashboard QC.');
