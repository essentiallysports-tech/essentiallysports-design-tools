import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const imageHandler = require('../api/es-image-search.js');
const designSubmitHandler = require('../api/design-request-submit.js');
const callbackHandler = require('../api/es-mcp-oauth-callback.js');

const originalFetch = globalThis.fetch;

function createResponse() {
  return {
    headers: {},
    statusCode: 0,
    payload: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

{
  const response = createResponse();
  await imageHandler({
    method: 'GET',
    headers: {},
    query: { health: '1' },
  }, response);

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.payload);
  assert.equal(payload.endpoint, 'https://mcp.essentiallysports.com/mcp');
  assert.equal(typeof payload.mcpConfigured, 'boolean');
}

{
  const response = createResponse();
  await callbackHandler({
    method: 'GET',
    headers: {},
    query: { error: 'access_denied' },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.match(response.payload, /access_denied/i);
  assert.match(response.headers['content-type'], /text\/html/i);
}

{
  const response = createResponse();
  await designSubmitHandler({
    method: 'OPTIONS',
    headers: {},
    query: {},
  }, response);

  assert.equal(response.statusCode, 204);
  assert.match(response.headers['access-control-allow-headers'], /Authorization/i);
}

{
  const response = createResponse();
  await designSubmitHandler({
    method: 'POST',
    headers: {},
    query: {},
    body: { record: { id: 'REQ-TEST-1' } },
  }, response);

  assert.equal(response.statusCode, 401);
  const payload = JSON.parse(response.payload);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /Authentication required/i);
}

{
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/auth/v1/user')) {
      assert.equal(options.headers?.Authorization, 'Bearer non-es-token');
      return new Response(JSON.stringify({
        id: 'user-2',
        email: 'someone@gmail.com',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const response = createResponse();
  await designSubmitHandler({
    method: 'POST',
    headers: { Authorization: 'Bearer non-es-token' },
    query: {},
    body: { record: { id: 'REQ-NON-ES-1' } },
  }, response);

  assert.equal(response.statusCode, 401);
  const payload = JSON.parse(response.payload);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /Invalid or expired/i);

  globalThis.fetch = originalFetch;
}

{
  const emailCalls = [];
  process.env.DESIGN_REQUEST_EMAIL_ENDPOINT = 'https://email.example.test/design-request';
  globalThis.fetch = async (url, options = {}) => {
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
    if (String(url) === process.env.DESIGN_REQUEST_EMAIL_ENDPOINT) {
      emailCalls.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const response = createResponse();
  await designSubmitHandler({
    method: 'POST',
    headers: { Authorization: 'Bearer test-user-token' },
    query: {},
    body: {
      record: {
        id: 'REQ-EMAIL-1',
        priority: 'High',
        requestType: 'newsletter',
        requester: { name: 'Suhail Quraishi', email: 'suhail.quraishi@essentiallysports.com' },
        title: 'Server-side email test',
      },
    },
  }, response);

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.payload);
  assert.equal(payload.ok, true);
  assert.equal(payload.integrations.email.ok, true);
  assert.equal(emailCalls.length, 1);
  assert.equal(emailCalls[0].id, 'REQ-EMAIL-1');
  assert.equal(emailCalls[0].requester.email, 'suhail.quraishi@essentiallysports.com');

  delete process.env.DESIGN_REQUEST_EMAIL_ENDPOINT;
  globalThis.fetch = originalFetch;
}

console.log('Vercel API adapter regression tests passed.');
