#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.ES_MCP_ACCESS_TOKEN = 'expired-token';

const wpImageUrl = 'https://www.essentiallysports.com/wp-content/uploads/fallback-athlete.jpg';
const calls = [];

globalThis.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({ url: String(url), body, headers: options.headers || {} });

  if (String(url).includes('/auth/v1/user')) {
    assert.equal(options.headers?.Authorization, 'Bearer test-user-token');
    return new Response(JSON.stringify({
      id: 'user-1',
      email: 'suhail.quraishi@essentiallysports.com',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (String(url).includes('/wp-json/wp/v2/media')) {
    return new Response(JSON.stringify([{
      id: 99,
      title: { rendered: 'Fallback athlete' },
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

  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: body?.id || null,
    error: { code: -32001, message: 'Missing or invalid token.' },
  }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
};

const require = createRequire(import.meta.url);
const { handler } = require('../netlify/functions/es-image-search.js');

const response = await handler({
  httpMethod: 'GET',
  headers: { Authorization: 'Bearer test-user-token' },
  queryStringParameters: {
    query: 'Fallback Athlete',
    per_page: '4',
  },
});

const payload = JSON.parse(response.body);
assert.equal(response.statusCode, 200);
assert.equal(payload.source, 'wordpress-media');
assert.deepEqual(payload.meta, {
  mcpConfigured: true,
  mcpAttempted: true,
  mcpError: 'Missing or invalid token.',
  fallbackUsed: true,
});
assert.equal(payload.results.length, 1);
assert.equal(payload.results[0].sourceUrl, wpImageUrl);
assert.equal(JSON.stringify(payload).includes('expired-token'), false);
assert.ok(calls.some(call => call.body?.method === 'tools/call'));
assert.ok(calls.some(call => String(call.url).includes('/wp-json/wp/v2/media')));

console.log('ES image search fallback diagnostics regression test passed.');
