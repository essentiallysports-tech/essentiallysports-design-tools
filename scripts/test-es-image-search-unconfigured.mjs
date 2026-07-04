#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

delete process.env.ES_MCP_ACCESS_TOKEN;
delete process.env.ES_MCP_REFRESH_TOKEN;
delete process.env.ES_MCP_CLIENT_ID;

const wpImageUrl = 'https://www.essentiallysports.com/wp-content/uploads/unconfigured-athlete.jpg';
const calls = [];

globalThis.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({ url: String(url), body, headers: options.headers || {} });

  if (String(url).includes('/wp-json/wp/v2/media')) {
    return new Response(JSON.stringify([{
      id: 100,
      title: { rendered: 'Unconfigured fallback athlete' },
      source_url: wpImageUrl,
      media_details: {
        width: 1200,
        height: 800,
        sizes: {},
        image_meta: {},
      },
    }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  throw new Error(`MCP should not be called when credentials are unconfigured: ${url}`);
};

const require = createRequire(import.meta.url);
const { handler } = require('../netlify/functions/es-image-search.js');

const response = await handler({
  httpMethod: 'GET',
  queryStringParameters: {
    query: 'Unconfigured Athlete',
    per_page: '4',
  },
});

const payload = JSON.parse(response.body);
assert.equal(response.statusCode, 200);
assert.equal(payload.source, 'wordpress-media');
assert.deepEqual(payload.meta, {
  mcpConfigured: false,
  mcpAttempted: false,
  mcpError: 'MCP credentials are not configured.',
  fallbackUsed: true,
});
assert.equal(payload.results.length, 1);
assert.equal(payload.results[0].sourceUrl, wpImageUrl);
assert.ok(calls.every(call => String(call.url).includes('/wp-json/wp/v2/media')));

console.log('ES image search unconfigured diagnostics regression test passed.');
