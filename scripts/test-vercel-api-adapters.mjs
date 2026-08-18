import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const imageHandler = require('../api/es-image-search.js');
const designSubmitHandler = require('../api/design-request-submit.js');
const toolFeedbackHandler = require('../api/tool-feedback-submit.js');
const callbackHandler = require('../api/es-mcp-oauth-callback.js');
const videoIntelligenceHandler = require('../api/es-video-intelligence.js');
const tweetOembedHandler = require('../api/tweet-oembed.js');

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
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('cdn.syndication.twimg.com/tweet-result')) {
      return new Response(JSON.stringify({
        favorite_count: 514,
        retweet_count: 72,
        conversation_count: 13,
        created_at: '2021-11-11T11:38:41.000Z',
        text: 'FrameUp tweet card test https://t.co/example https://t.co/media',
        entities: {
          urls: [{ url: 'https://t.co/example', display_url: 'frameup.test' }],
          media: [{ url: 'https://t.co/media' }],
        },
        user: {
          name: 'Jim Raptis',
          screen_name: 'd__raptis',
          is_blue_verified: true,
          profile_image_url_https: 'https://pbs.twimg.com/profile_images/example_normal.jpg',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (value.includes('pbs.twimg.com/profile_images/example_400x400.jpg')) {
      return new Response(Buffer.from('avatar-image'), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }
    throw new Error(`Unexpected fetch: ${value}`);
  };

  const response = createResponse();
  await tweetOembedHandler({
    method: 'GET',
    headers: {},
    query: { url: 'https://twitter.com/d__raptis/status/1458761091195064325' },
  }, response);

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.payload);
  assert.equal(payload.ok, true);
  assert.equal(payload.authorName, 'Jim Raptis');
  assert.equal(payload.handle, 'd__raptis');
  assert.match(payload.text, /FrameUp tweet card test/);
  assert.match(payload.text, /frameup\.test/);
  assert.doesNotMatch(payload.text, /t\.co\/media/);
  assert.equal(payload.dateLabel, '11:38 AM · 11 Nov 2021');
  assert.equal(payload.metrics, '13 replies · 72 reposts · 514 likes');
  assert.equal(payload.verified, true);
  assert.match(payload.avatarDataUrl, /^data:image\/jpeg;base64,/);

  globalThis.fetch = originalFetch;
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

{
  const savedRows = [];
  const previousSheetsEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const previousSheetsKey = process.env.GOOGLE_PRIVATE_KEY;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_PRIVATE_KEY;

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
    if (String(url).includes('/rest/v1/es_designer_activity')) {
      assert.equal(options.headers?.Authorization, 'Bearer test-user-token');
      const row = JSON.parse(options.body);
      savedRows.push(row);
      return new Response(JSON.stringify([row]), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const response = createResponse();
  await toolFeedbackHandler({
    method: 'POST',
    headers: { Authorization: 'Bearer test-user-token' },
    query: {},
    body: {
      feedbackType: 'Bug',
      tool: 'Reels Studio',
      message: 'Caption animation preview is drifting.',
      pageUrl: 'https://frameup.essentiallysports.com/reels.html',
    },
  }, response);

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.payload);
  assert.equal(payload.ok, true);
  assert.equal(payload.integrations.supabase.ok, true);
  assert.equal(payload.integrations.googleSheets.skipped, true);
  assert.equal(savedRows.length, 1);
  assert.equal(savedRows[0].event_type, 'tool_feedback_submitted');
  assert.equal(savedRows[0].entity_type, 'tool_feedback');
  assert.equal(savedRows[0].actor_email, 'suhail.quraishi@essentiallysports.com');
  assert.equal(savedRows[0].meta.message, 'Caption animation preview is drifting.');

  if (previousSheetsEmail) process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = previousSheetsEmail;
  if (previousSheetsKey) process.env.GOOGLE_PRIVATE_KEY = previousSheetsKey;
  globalThis.fetch = originalFetch;
}

{
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
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const response = createResponse();
  await videoIntelligenceHandler({
    method: 'POST',
    headers: { Authorization: 'Bearer test-user-token' },
    query: {},
    body: {
      action: 'style',
      prompt: 'use Lakers colors and move lower',
      target: { kind: 'caption', text: 'Lakers win the opener' },
      brandKit: [{
        team: 'Los Angeles Lakers',
        primary: { background: '#552583', foreground: '#ffffff', mist: '#fdb927' },
      }],
    },
  }, response);

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.payload);
  assert.equal(payload.provider, 'Local rules fallback');
  assert.equal(payload.patch.position, 'lower');

  globalThis.fetch = originalFetch;
}

console.log('Vercel API adapter regression tests passed.');
