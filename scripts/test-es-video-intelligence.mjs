#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

delete process.env.ES_MCP_ACCESS_TOKEN;
delete process.env.ES_MCP_REFRESH_TOKEN;
delete process.env.ES_MCP_CLIENT_ID;
delete process.env.OPENAI_API_KEY;

const fetchCalls = [];
globalThis.fetch = async (url, options = {}) => {
  fetchCalls.push({ url: String(url), options });
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
  throw new Error(`Unexpected external call: ${url}`);
};

const require = createRequire(import.meta.url);
const { handler } = require('../netlify/functions/es-video-intelligence.js');

{
  const response = await handler({
    httpMethod: 'POST',
    headers: { Authorization: 'Bearer test-user-token' },
    body: JSON.stringify({
      action: 'transcribe',
      fileName: 'clip.mp4',
      mimeType: 'video/mp4',
      data: Buffer.from('fake-video').toString('base64'),
    }),
  });

  assert.equal(response.statusCode, 501);
  const payload = JSON.parse(response.body);
  assert.match(payload.error, /OPENAI_API_KEY is not configured/);
  assert.equal(payload.provider, 'not-configured');
}

{
  const response = await handler({
    httpMethod: 'POST',
    headers: { Authorization: 'Bearer test-user-token' },
    body: JSON.stringify({
      action: 'style',
      prompt: 'make it punchy and lower with Lakers colors',
      target: {
        kind: 'caption',
        text: 'LeBron James explains why the Lakers need to start faster tonight',
        position: 'center',
      },
      brandKit: [{
        team: 'Los Angeles Lakers',
        primary: {
          background: '#552583',
          foreground: '#ffffff',
          mist: '#fdb927',
        },
      }],
    }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.provider, 'Local rules fallback');
  assert.equal(payload.patch.position, 'lower');
  assert.equal(payload.patch.style.background, '#552583');
  assert.equal(payload.patch.style.accent, '#fdb927');
  assert.equal(payload.patch.text, 'LeBron James explains why the Lakers need to start');
}

assert.ok(fetchCalls.every(call => String(call.url).includes('/auth/v1/user')));
console.log('ES video intelligence regression tests passed.');
