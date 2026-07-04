#!/usr/bin/env node

const [, , baseUrlArg, queryArg = 'LeBron James'] = process.argv;

function usage() {
  console.error('Usage: npm run verify:es-images -- https://YOUR-SITE.netlify.app "LeBron James"');
  process.exit(1);
}

if (!baseUrlArg) usage();

let baseUrl;
try {
  baseUrl = new URL(baseUrlArg);
} catch (error) {
  usage();
}

baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, '');
baseUrl.search = '';
baseUrl.hash = '';

function endpoint(pathAndSearch) {
  return new URL(pathAndSearch, baseUrl).toString();
}

async function readJson(pathAndSearch) {
  const url = endpoint(pathAndSearch);
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`${url} did not return JSON. Status: ${response.status}. Body: ${text.slice(0, 160)}`);
  }
  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${body?.error || text.slice(0, 160)}`);
  }
  return body;
}

const health = await readJson('/api/es-image-search?health=1');
const probe = await readJson('/api/es-image-search?health=probe');
const search = await readJson(`/api/es-image-search?query=${encodeURIComponent(queryArg)}&per_page=4`);

const firstResult = Array.isArray(search.results) ? search.results[0] : null;
const pass = Boolean(health.mcpConfigured && probe.probe?.ok && search.source === 'mcp-agency' && firstResult?.sourceUrl);

const report = {
  checkedBaseUrl: baseUrl.toString().replace(/\/$/, ''),
  query: queryArg,
  health: {
    mcpConfigured: health.mcpConfigured,
    tokenMode: health.tokenMode,
    endpoint: health.endpoint,
    searchTool: health.searchTool,
    imageBucket: health.imageBucket,
  },
  probe: probe.probe || null,
  search: {
    source: search.source,
    resultCount: Array.isArray(search.results) ? search.results.length : 0,
    firstResult: firstResult ? {
      title: firstResult.title,
      source: firstResult.source,
      sourceUrl: firstResult.sourceUrl,
    } : null,
  },
  pass,
};

console.log(JSON.stringify(report, null, 2));

if (!pass) {
  console.error('ES image live verification failed: private ES Storage did not return an mcp-agency image result.');
  process.exitCode = 1;
}
