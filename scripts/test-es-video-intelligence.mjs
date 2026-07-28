#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.ES_MCP_ACCESS_TOKEN = 'test-mcp-token';
delete process.env.ES_MCP_REFRESH_TOKEN;
delete process.env.ES_MCP_CLIENT_ID;
delete process.env.GROQ_API_KEY;
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

  if (String(url) === 'https://mcp.essentiallysports.com/mcp') {
    assert.equal(options.headers?.Authorization, 'Bearer test-mcp-token');
    const body = JSON.parse(options.body);

    if (body.method === 'initialize') {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: { protocolVersion: '2025-06-18', capabilities: {} },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' },
      });
    }

    if (body.method === 'notifications/initialized') {
      return new Response('', { status: 202 });
    }

    if (body.method === 'tools/list') {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          tools: [{ name: 'mcp__es__transcribe_video' }],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' },
      });
    }

    if (body.method === 'tools/call') {
      assert.equal(body.params.name, 'mcp__es__transcribe_video');
      assert.equal(body.params.arguments.mime_type, 'video/mp4');
      assert.ok(body.params.arguments.base64);
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          provider: 'ES MCP speech',
          language: 'en',
          segments: [
            { start: 0, end: 1.8, text: 'LeBron James opens the segment', confidence: 0.96 },
            { start: 1.8, end: 3.4, text: 'with a Lakers update', confidence: 0.94 },
          ],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' },
      });
    }
  }

  if (String(url) === 'https://api.groq.com/openai/v1/audio/transcriptions') {
    assert.equal(options.headers?.Authorization, 'Bearer test-groq-key');
    const form = options.body;
    assert.equal(form.get('model'), 'whisper-large-v3-turbo');
    assert.equal(form.get('response_format'), 'verbose_json');
    assert.equal(form.get('timestamp_granularities[]'), 'segment');
    assert.ok(form.get('file'));
    return new Response(JSON.stringify({
      text: 'Caitlin Clark hits another deep three',
      language: 'en',
      segments: [
        { start: 0, end: 1.4, text: 'Caitlin Clark hits another' },
        { start: 1.4, end: 2.8, text: 'deep three' },
      ],
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
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { health: '1' },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.mcpConfigured, true);
  assert.equal(payload.transcribeTool, 'auto-discover');
  assert.equal(payload.groqFallbackConfigured, false);
  assert.equal(payload.openAiFallbackConfigured, false);
}

{
  const response = await handler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { health: 'public-probe' },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.probe.ok, true);
  assert.equal(payload.probe.transcribeToolFound, true);
  assert.equal(payload.probe.intelligenceToolFound, false);
  assert.equal(Array.isArray(payload.probe.candidateTools), false);
  assert.equal(Array.isArray(payload.probe.toolNames), false);
}

{
  const response = await handler({
    httpMethod: 'GET',
    headers: { Authorization: 'Bearer test-user-token' },
    queryStringParameters: { health: 'probe' },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.probe.ok, true);
  assert.equal(payload.probe.transcribeTool, 'mcp__es__transcribe_video');
  assert.deepEqual(payload.probe.candidateTools, ['mcp__es__transcribe_video']);
}

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

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.provider, 'ES MCP speech');
  assert.equal(payload.language, 'en');
  assert.equal(payload.segments.length, 2);
  assert.equal(payload.segments[0].text, 'LeBron James opens the segment');
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

delete require.cache[require.resolve('../netlify/functions/es-video-intelligence.js')];
delete process.env.ES_MCP_ACCESS_TOKEN;
process.env.GROQ_API_KEY = 'test-groq-key';
const { handler: groqHandler } = require('../netlify/functions/es-video-intelligence.js');

{
  const response = await groqHandler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { health: '1' },
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.mcpConfigured, false);
  assert.equal(payload.groqFallbackConfigured, true);
  assert.equal(payload.groqTranscriptionModel, 'whisper-large-v3-turbo');
}

{
  const response = await groqHandler({
    httpMethod: 'POST',
    headers: { Authorization: 'Bearer test-user-token' },
    body: JSON.stringify({
      action: 'transcribe',
      fileName: 'clip.webm',
      mimeType: 'video/webm',
      data: Buffer.from('fake-webm-video').toString('base64'),
    }),
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.provider, 'Groq whisper-large-v3-turbo');
  assert.equal(payload.language, 'en');
  assert.equal(payload.segments.length, 2);
  assert.equal(payload.segments[1].text, 'deep three');
}

assert.ok(fetchCalls.every(call => (
  String(call.url).includes('/auth/v1/user')
  || String(call.url) === 'https://mcp.essentiallysports.com/mcp'
  || String(call.url) === 'https://api.groq.com/openai/v1/audio/transcriptions'
)));
console.log('ES video intelligence regression tests passed.');
