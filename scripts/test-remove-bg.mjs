#!/usr/bin/env node
// remove-bg function: signed-in only, env-gated, 6 MB cap, rate limits,
// usage logging. fetch is mocked; nothing leaves the machine.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const JPEG_HEAD = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10]).toString('base64');

let calls = [];
let briaStatus = 200;
let briaPayload = { result: { image_url: 'https://results.bria.example/cut.png' } };
let user = { id: 'u1', email: 'designer@essentiallysports.com' };
let weeklySpend = 0;
let hourlyCalls = 0;

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  calls.push({ url: target, options });
  if (target.includes('/auth/v1/user')) {
    if (options.headers?.Authorization !== 'Bearer good-token') return new Response('{}', { status: 401 });
    return new Response(JSON.stringify(user), { status: 200 });
  }
  if (target.includes('/rpc/frameup_my_ai_spend')) return new Response(JSON.stringify([{ total_usd: weeklySpend }]), { status: 200 });
  if (target.includes('/rpc/frameup_my_ai_calls_last_hour')) return new Response(JSON.stringify(hourlyCalls), { status: 200 });
  if (target.includes('/rest/v1/frameup_ai_usage')) return new Response('', { status: 201 });
  if (target.includes('bria')) {
    if (target.startsWith('https://results.')) return new Response(Buffer.from(PNG_1PX, 'base64'), { status: 200, headers: { 'content-type': 'image/png' } });
    return new Response(JSON.stringify(briaPayload), { status: briaStatus });
  }
  throw new Error(`Unexpected fetch ${target}`);
};

const fn = require('../netlify/functions/remove-bg.js');
const { handler, _test } = fn;
const post = (body, token = 'good-token') => handler({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const get = (token = 'good-token') => handler({ httpMethod: 'GET', headers: { authorization: `Bearer ${token}` } });
const parse = result => ({ status: result.statusCode, body: JSON.parse(result.body || '{}') });
const pngData = `data:image/png;base64,${PNG_1PX}`;

// 1. Signed-in only.
delete process.env.BRIA_API_KEY;
assert.equal(parse(await handler({ httpMethod: 'POST', headers: {}, body: '{}' })).status, 401, 'no token');
assert.equal(parse(await post({ image: pngData }, 'bad-token')).status, 401, 'bad token');
assert.equal(parse(await handler({ httpMethod: 'DELETE', headers: {} })).status, 405);

// 2. Off without the key: GET says so, POST is a polite 503, Bria never called.
calls = [];
assert.deepEqual(parse(await get()).body, { configured: false, maxBytes: 6 * 1024 * 1024 });
const off = parse(await post({ image: pngData }));
assert.equal(off.status, 503);
assert.equal(off.body.reason, 'off');
assert.ok(!calls.some(call => call.url.includes('bria')), 'no Bria call when off');

process.env.BRIA_API_KEY = 'test-bria-key';
assert.equal(parse(await get()).body.configured, true);

// 3. Input checks: type, magic bytes, 6 MB cap.
assert.equal(parse(await post({ image: 'data:image/gif;base64,R0lGOD' })).status, 400);
assert.ok(_test.parseImage(`data:image/png;base64,${JPEG_HEAD}`).bytes, 'a mislabelled but real JPEG is still accepted');
assert.equal(_test.parseImage(`data:image/jpeg;base64,${JPEG_HEAD}`).mime, 'image/jpeg');
assert.equal(parse(await post({ image: 'data:image/png;base64,' + 'A'.repeat(4) })).status, 400, 'not an image');
const big = `data:image/jpeg;base64,${Buffer.alloc(6 * 1024 * 1024 + 10, 0xFF).toString('base64')}`;
const tooBig = parse(await post({ image: big }));
assert.equal(tooBig.status, 413);
assert.match(tooBig.body.error, /6 MB/);
assert.equal(parse(await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer good-token' }, body: '{nope' })).status, 400);

// 4. Success: Bria called with the key header and base64, result returned inline, usage logged.
calls = [];
const ok = parse(await post({ image: pngData }));
assert.equal(ok.status, 200);
assert.equal(ok.body.ok, true);
assert.match(ok.body.dataUrl, /^data:image\/png;base64,/);
const briaCall = calls.find(call => call.url === _test.DEFAULT_ENDPOINT);
assert.ok(briaCall, 'calls the default Bria endpoint');
assert.equal(briaCall.options.headers.api_token, 'test-bria-key');
assert.equal(JSON.parse(briaCall.options.body).image, PNG_1PX);
assert.equal(JSON.parse(briaCall.options.body).sync, true);
const usage = calls.find(call => call.url.includes('/rest/v1/frameup_ai_usage'));
assert.ok(usage, 'usage logged');
const logged = JSON.parse(usage.options.body);
assert.equal(logged.feature, 'remove-bg');
assert.equal(logged.user_email, 'designer@essentiallysports.com');
assert.equal(logged.cost_usd, 0.018);
assert.equal(logged.images, 1);
assert.equal(logged.ok, true);

// v1-style payload and a non-https URL.
assert.equal(_test.resultUrl({ result_url: 'https://x.example/a.png' }), 'https://x.example/a.png');
assert.equal(_test.resultUrl({ result: { image_url: 'http://x.example/a.png' } }), '');

// 5. Bria failure: 502, logged as failed with no cost.
briaStatus = 500;
calls = [];
const failed = parse(await post({ image: pngData }));
assert.equal(failed.status, 502);
const failLog = JSON.parse(calls.find(call => call.url.includes('/rest/v1/frameup_ai_usage')).options.body);
assert.equal(failLog.ok, false);
assert.equal(failLog.cost_usd, 0);
briaStatus = 200;

// 6. Limits: weekly cap, shared hourly cap, per-server hourly cap.
weeklySpend = 1000;
const weekly = parse(await post({ image: pngData }));
assert.equal(weekly.status, 429);
assert.equal(weekly.body.reason, 'weekly-limit');
weeklySpend = 0;
hourlyCalls = 10000;
assert.equal(parse(await post({ image: pngData })).body.reason, 'limit');
hourlyCalls = 0;
_test.recent.clear();
process.env.REMOVE_BG_HOURLY_LIMIT = '2';
assert.equal(parse(await post({ image: pngData })).status, 200);
assert.equal(parse(await post({ image: pngData })).status, 200);
const capped = parse(await post({ image: pngData }));
assert.equal(capped.status, 429);
assert.equal(capped.body.reason, 'limit');
assert.equal(_test.underLimit('other@essentiallysports.com', 2), true, 'limits are per person');
delete process.env.REMOVE_BG_HOURLY_LIMIT;
assert.equal(_test.hourlyLimit({}), 30);
assert.equal(_test.costPerImage({ REMOVE_BG_COST_USD: '0.02' }), 0.02);

// 7. The Vercel adapter forwards to the same handler.
const adapter = require('../api/remove-bg.js');
const response = { headers: {}, statusCode: 0, payload: null, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, status(code) { this.statusCode = code; return this; }, send(payload) { this.payload = payload; return this; }, json(payload) { this.payload = payload; return this; } };
await adapter({ method: 'GET', headers: { authorization: 'Bearer good-token' }, query: {} }, response);
assert.equal(response.statusCode, 200);
assert.equal(JSON.parse(response.payload).configured, true);

delete process.env.BRIA_API_KEY;
console.log('remove-bg tests passed.');
