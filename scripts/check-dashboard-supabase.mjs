#!/usr/bin/env node

const SUPABASE_URL = 'https://xtdusejokbhtjlmijdca.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_1T9d9U0qXD5K-Ay-_43IVA_Qdd1dpHF';

const TABLES = [
  'es_designer_profiles',
  'es_designer_presence',
];

async function checkTable(table) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`;
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
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
    console.log(`✅ ${result.table}: table exists (HTTP ${result.status})`);
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

console.log('\nDashboard Supabase tables are reachable. Continue with signed-in admin dashboard QC.');
