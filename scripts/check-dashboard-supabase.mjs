#!/usr/bin/env node

const SUPABASE_URL = 'https://xtdusejokbhtjlmijdca.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_1T9d9U0qXD5K-Ay-_43IVA_Qdd1dpHF';
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || process.env.ES_DASHBOARD_SUPABASE_ACCESS_TOKEN
  || '';

const TABLES = [
  'es_designer_profiles',
  'es_designer_presence',
  'es_designer_tasks',
  'es_designer_activity',
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

for (const result of results) {
  if (result.ok) {
    console.log(`✅ ${result.table}: reachable with ${SUPABASE_ACCESS_TOKEN ? 'authenticated' : 'anonymous'} token (HTTP ${result.status})`);
    continue;
  }

  failed = true;
  const code = result.body?.code ? ` ${result.body.code}` : '';
  const message = result.body?.message || result.body || 'Unknown Supabase error';
  console.error(`❌ ${result.table}: missing or unreachable (HTTP ${result.status}${code})`);
  console.error(`   ${message}`);
}

if (failed) {
  console.error('\nApply all Supabase migrations through 20260716150000_finalize_dashboard_sync.sql, then run this check again.');
  process.exit(1);
}

console.log('\nDashboard Supabase tables are reachable. Continue with signed-in admin dashboard QC.');
