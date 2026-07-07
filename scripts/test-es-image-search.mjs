#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.ES_MCP_ACCESS_TOKEN = 'test-token';

const calls = [];
const imageUrl = 'https://image-cdn.essentiallysports.com/wp-content/uploads/mock-athlete.jpg';
const s3HttpsUrl = 'https://essentiallysports-images-v2prod.s3.amazonaws.com/social/mock-athlete-2.jpg';
const s3BucketKeyHttpsUrl = 'https://essentiallysports-images-v2prod.s3.amazonaws.com/social/mock-athlete-3.jpg';
const markdownImageUrl = 'https://image-cdn.essentiallysports.com/wp-content/uploads/mock-markdown-athlete.jpg';

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

  if (body?.method === 'tools/call' && !options.headers?.['Mcp-Session-Id']) {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32000, message: 'initialize required' },
    }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (body?.method === 'initialize') {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: { protocolVersion: '2025-06-18' },
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': 'session-1',
      },
    });
  }

  if (body?.method === 'notifications/initialized') {
    return new Response('', {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (body?.method === 'tools/list') {
    if (!options.headers?.['Mcp-Session-Id']) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32000, message: 'initialize required' },
      }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: { tools: [{ name: 'mcp__es__search_images' }] },
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': 'session-1',
      },
    });
  }

  if (body?.method === 'tools/call') {
    assert.equal(body.params.name, 'mcp__es__search_images');
    assert.equal(body.params.arguments.type, 'agency');
    assert.ok(body.params.arguments.per_page >= 10);
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            results: [
              { title: 'Mock athlete', url: imageUrl, agency: 'Getty' },
              { title: 'Mock S3 athlete', s3_url: 's3://essentiallysports-images-v2prod/social/mock-athlete-2.jpg', agency: 'Getty' },
              { title: 'Mock bucket key athlete', bucket: 'essentiallysports-images-v2prod', key: 'social/mock-athlete-3.jpg', agency: 'Getty' },
            ],
          }),
        }, {
          type: 'text',
          text: `**Mock Markdown Athlete**
Type: AGENCY · Full-resolution URL (use this — the inline preview is a low-res thumbnail): ${markdownImageUrl}
Caption: Mock athlete celebrates after the game.
Credit: Mock Photographer via IMAGO
Alt: Mock Markdown Athlete
Folders: Imago`,
        }],
      },
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': 'session-1',
      },
    });
  }

  throw new Error(`Unexpected fetch: ${url}`);
};

const require = createRequire(import.meta.url);
const { handler } = require('../netlify/functions/es-image-search.js');

const healthResponse = await handler({
  httpMethod: 'GET',
  queryStringParameters: { health: '1' },
});
const healthPayload = JSON.parse(healthResponse.body);
assert.equal(healthResponse.statusCode, 200);
assert.equal(healthPayload.mcpConfigured, true);
assert.equal(healthPayload.tokenMode, 'access-token');
assert.equal(healthPayload.endpoint, 'https://mcp.essentiallysports.com/mcp');
assert.equal(healthPayload.searchTool, 'search_images');
assert.equal(healthPayload.imageBucket, 'essentiallysports-images-v2prod');
assert.equal(JSON.stringify(healthPayload).includes('test-token'), false);

const probeHealthResponse = await handler({
  httpMethod: 'GET',
  headers: { Authorization: 'Bearer test-user-token' },
  queryStringParameters: { health: 'probe' },
});
const probeHealthPayload = JSON.parse(probeHealthResponse.body);
assert.equal(probeHealthResponse.statusCode, 200);
assert.equal(probeHealthPayload.mcpConfigured, true);
assert.equal(probeHealthPayload.tokenMode, 'access-token');
assert.equal(probeHealthPayload.probe.attempted, true);
assert.equal(probeHealthPayload.probe.ok, true);
assert.equal(probeHealthPayload.probe.toolCount, 1);
assert.equal(probeHealthPayload.probe.imageSearchTool, 'mcp__es__search_images');
assert.equal(JSON.stringify(probeHealthPayload).includes('test-token'), false);

const response = await handler({
  httpMethod: 'GET',
  headers: { Authorization: 'Bearer test-user-token' },
  queryStringParameters: {
    query: 'Mock Athlete NBA',
    per_page: '4',
  },
});

const payload = JSON.parse(response.body);
assert.equal(response.statusCode, 200);
assert.equal(payload.source, 'mcp-agency');
assert.deepEqual(payload.meta, {
  mcpConfigured: true,
  mcpAttempted: true,
  mcpError: '',
  fallbackUsed: false,
});
assert.equal(payload.results.length, 4);
assert.equal(payload.results[0].title, 'Mock athlete');
assert.equal(payload.results[0].sourceUrl, imageUrl);
assert.ok(payload.results[0].proxyUrl.startsWith('/api/es-image-search?image='));
assert.equal(payload.results[1].sourceUrl, s3HttpsUrl);
assert.equal(payload.results[2].sourceUrl, s3BucketKeyHttpsUrl);
assert.equal(payload.results[3].title, 'Mock Markdown Athlete');
assert.equal(payload.results[3].sourceUrl, markdownImageUrl);
assert.equal(payload.results[3].caption, 'Mock athlete celebrates after the game.');
assert.equal(payload.results[3].credit, 'Mock Photographer via IMAGO');

const methods = calls.map(call => call.body?.method).filter(Boolean);
assert.deepEqual(methods, [
  'tools/list',
  'initialize',
  'notifications/initialized',
  'tools/list',
  'tools/list',
  'tools/call',
  'initialize',
  'notifications/initialized',
  'tools/list',
  'tools/call',
]);

const unauthorizedSearch = await handler({
  httpMethod: 'GET',
  queryStringParameters: {
    query: 'Mock Athlete NBA',
    per_page: '4',
  },
});
assert.equal(unauthorizedSearch.statusCode, 401);

console.log('ES image search MCP regression test passed.');
