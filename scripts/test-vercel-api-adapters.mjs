import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const imageHandler = require('../api/es-image-search.js');
const callbackHandler = require('../api/es-mcp-oauth-callback.js');

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

console.log('Vercel API adapter regression tests passed.');
