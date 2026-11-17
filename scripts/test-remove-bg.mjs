#!/usr/bin/env node
// remove-bg function: signed-in only, provider choice (OpenAI by default,
// Gateway or Bria on request), env-gated, 6 MB cap, rate limits, cost from
// usage, logging. fetch is mocked; nothing leaves the machine.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const JPEG_HEAD = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10]).toString('base64');
const WEBP_B64 = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8L')]).toString('base64');

let calls = [];
let editStatus = 200;
let editPayload = null;
let briaStatus = 200;
let user = { id: 'u1', email: 'designer@essentiallysports.com' };
let weeklySpend = 0;
let hourlyCalls = 0;
let isAdmin = false;
const USAGE = { input_tokens: 400, input_tokens_details: { text_tokens: 60, image_tokens: 340 }, output_tokens: 272, total_tokens: 672 };
const okEdit = () => ({ created: 1, background: 'transparent', output_format: 'webp', data: [{ b64_json: WEBP_B64 }], usage: USAGE });

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
  if (target.includes('/rpc/is_es_designer_admin')) return new Response(JSON.stringify(isAdmin), { status: 200 });
  if (target.endsWith('/v1/images/edits')) {
    return new Response(JSON.stringify(editPayload || (editStatus === 200 ? okEdit() : { error: { message: 'Server error' } })), { status: editStatus });
  }
  if (target.includes('bria')) {
    if (target.startsWith('https://results.')) return new Response(Buffer.from(PNG_1PX, 'base64'), { status: 200, headers: { 'content-type': 'image/png' } });
    return new Response(JSON.stringify({ result: { image_url: 'https://results.bria.example/cut.png' } }), { status: briaStatus });
  }
  throw new Error(`Unexpected fetch ${target}`);
};

const { handler, _test } = require('../netlify/functions/remove-bg.js');
const post = (body, token = 'good-token') => handler({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const get = (token = 'good-token') => handler({ httpMethod: 'GET', headers: { authorization: `Bearer ${token}` } });
const parse = result => ({ status: result.statusCode, body: JSON.parse(result.body || '{}') });
const pngData = `data:image/png;base64,${PNG_1PX}`;
const jpegData = `data:image/jpeg;base64,${JPEG_HEAD}`;
const usageRows = () => calls.filter(call => call.url.includes('/rest/v1/frameup_ai_usage')).map(call => JSON.parse(call.options.body));
const reset = () => { for (const key of ['REMOVE_BG_PROVIDER', 'REMOVE_BG_MODEL', 'REMOVE_BG_QUALITY', 'OPENAI_API_KEY', 'AI_GATEWAY_API_KEY', 'BRIA_API_KEY', 'REMOVE_BG_HOURLY_LIMIT']) delete process.env[key]; _test.recent.clear(); };

// 1. Signed-in only.
reset();
assert.equal(parse(await handler({ httpMethod: 'POST', headers: {}, body: '{}' })).status, 401, 'no token');
assert.equal(parse(await post({ image: pngData }, 'bad-token')).status, 401, 'bad token');
assert.equal(parse(await handler({ httpMethod: 'DELETE', headers: {} })).status, 405);

// 2. Default provider is OpenAI, off without OPENAI_API_KEY (and says which var).
calls = [];
const status = parse(await get()).body;
assert.equal(status.configured, false);
assert.equal(status.provider, 'openai');
assert.equal(status.envVar, 'OPENAI_API_KEY');
assert.equal(status.model, 'gpt-image-1-mini');
const off = parse(await post({ image: pngData }));
assert.equal(off.status, 503);
assert.equal(off.body.reason, 'off');
assert.equal(off.body.envVar, 'OPENAI_API_KEY');
assert.ok(!calls.some(call => call.url.includes('images/edits')), 'no model call when off');
// A Gateway key alone never switches it on (Gateway is opt-in).
process.env.AI_GATEWAY_API_KEY = 'gw';
assert.equal(parse(await get()).body.configured, false);
reset();

// 3. Input checks: type, magic bytes, 6 MB cap.
process.env.OPENAI_API_KEY = 'sk-test';
assert.equal(parse(await get()).body.configured, true);
assert.equal(parse(await post({ image: 'data:image/gif;base64,R0lGOD' })).status, 400);
assert.equal(_test.parseImage(`data:image/png;base64,${JPEG_HEAD}`).mime, 'image/jpeg', 'type comes from the bytes');
assert.equal(parse(await post({ image: 'data:image/png;base64,AAAA' })).status, 400, 'not an image');
const big = `data:image/jpeg;base64,${Buffer.alloc(6 * 1024 * 1024 + 10, 0xFF).toString('base64')}`;
const tooBig = parse(await post({ image: big }));
assert.equal(tooBig.status, 413);
assert.match(tooBig.body.error, /6 MB/);
assert.equal(parse(await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer good-token' }, body: '{nope' })).status, 400);

// 4. OpenAI success: multipart edit, transparent, cheapest model, size passed
//    through, mask-only answer, cost from usage, logged as remove-bg.
calls = [];
const ok = parse(await post({ image: jpegData, size: '1024x1536' }));
assert.equal(ok.status, 200);
assert.equal(ok.body.ok, true);
assert.equal(ok.body.maskOnly, true, 'editor must use only the alpha');
assert.equal(ok.body.model, 'openai/gpt-image-1-mini');
assert.match(ok.body.dataUrl, /^data:image\/webp;base64,/);
const edit = calls.find(call => call.url === _test.OPENAI_EDITS);
assert.ok(edit, 'calls OpenAI directly');
assert.equal(edit.options.headers.Authorization, 'Bearer sk-test');
const form = edit.options.body;
assert.ok(form instanceof FormData);
assert.equal(form.get('model'), 'gpt-image-1-mini');
assert.equal(form.get('background'), 'transparent');
assert.equal(form.get('quality'), 'low');
assert.equal(form.get('size'), '1024x1536');
assert.equal(form.get('n'), '1');
assert.match(form.get('prompt'), /exactly where it is/);
assert.equal(form.get('image').type, 'image/jpeg');
const [logged] = usageRows();
assert.equal(logged.feature, 'remove-bg');
assert.equal(logged.model, 'openai/gpt-image-1-mini');
assert.equal(logged.user_email, 'designer@essentiallysports.com');
assert.equal(logged.images, 1);
assert.equal(logged.input_tokens, 400);
assert.equal(logged.output_tokens, 272);
// 60 text x $2 + 340 image x $2.5 + 272 out x $8, per 1M tokens.
assert.equal(logged.cost_usd, Math.round((60 * 2 + 340 * 2.5 + 272 * 8)) / 1e6);
// Unknown size falls back to square.
calls = [];
await post({ image: jpegData, size: '4000x4000' });
assert.equal(calls.find(call => call.url === _test.OPENAI_EDITS).options.body.get('size'), '1024x1024');

// Cost maths and fallbacks.
assert.equal(_test.openAiCost('gpt-image-1-mini', null, 'low'), 0.005, 'documented price without usage');
assert.equal(_test.openAiCost('gpt-image-1-mini', null, 'medium'), 0.011);
assert.equal(_test.openAiCost('gpt-image-1', { input_tokens: 100, output_tokens: 1000 }, 'low'), (100 * 5 + 1000 * 40) / 1e6, 'all input counted as text when details are missing');

// Model and quality overrides; bad model names are ignored.
process.env.REMOVE_BG_MODEL = 'gpt-image-1';
process.env.REMOVE_BG_QUALITY = 'medium';
calls = [];
assert.equal(parse(await post({ image: jpegData })).body.model, 'openai/gpt-image-1');
assert.equal(calls.find(call => call.url === _test.OPENAI_EDITS).options.body.get('quality'), 'medium');
process.env.REMOVE_BG_MODEL = 'evil model; drop';
assert.equal(_test.model(), 'gpt-image-1-mini');
delete process.env.REMOVE_BG_MODEL;
delete process.env.REMOVE_BG_QUALITY;

// 5. OpenAI failures: 502 logged with no cost; safety refusals are 422.
editStatus = 500;
calls = [];
assert.equal(parse(await post({ image: jpegData })).status, 502);
const [failed] = usageRows();
assert.equal(failed.ok, false);
assert.equal(failed.cost_usd, 0);
assert.equal(failed.model, 'openai/gpt-image-1-mini');
editStatus = 400;
editPayload = { error: { message: 'Your request was rejected by the safety system.' } };
assert.equal(parse(await post({ image: jpegData })).body.reason, 'moderation');
editStatus = 200;
editPayload = { data: [{}] };
assert.equal(parse(await post({ image: jpegData })).status, 502, 'no image in the answer');
editPayload = null;

// 6. Gateway provider (opt-in): same request, Gateway URL and key, openai/ prefix.
reset();
process.env.REMOVE_BG_PROVIDER = 'gateway';
assert.equal(parse(await get()).body.envVar, 'AI_GATEWAY_API_KEY');
process.env.AI_GATEWAY_API_KEY = 'gw-key';
calls = [];
assert.equal(parse(await post({ image: jpegData })).status, 200);
const gw = calls.find(call => call.url === _test.GATEWAY_EDITS);
assert.ok(gw, 'calls the Gateway');
assert.equal(gw.options.headers.Authorization, 'Bearer gw-key');
assert.equal(gw.options.headers['Content-Type'], 'application/json', 'documented JSON form of /v1/images/edits');
const gwBody = JSON.parse(gw.options.body);
assert.equal(gwBody.model, 'openai/gpt-image-1-mini');
assert.equal(gwBody.images.length, 1);
assert.equal(gwBody.images[0].image_url, jpegData, 'photo sent as a data URL');
assert.equal(gwBody.background, 'transparent');
assert.equal(gwBody.output_format, 'webp');
assert.equal(gwBody.quality, 'low');
assert.equal(gwBody.size, '1024x1024');
assert.deepEqual(gwBody.providerOptions.openai, { background: 'transparent', output_format: 'webp', output_compression: 90, quality: 'low' }, 'also passed through providerOptions.openai');
assert.ok(!calls.some(call => call.url === _test.OPENAI_EDITS), 'no direct OpenAI call on the gateway route');
assert.equal(usageRows()[0].model, 'openai/gpt-image-1-mini');
// The Gateway may answer PNG even when asked for WebP: the type comes from the bytes.
editPayload = { data: [{ b64_json: PNG_1PX }] };
assert.match(parse(await post({ image: jpegData })).body.dataUrl, /^data:image\/png;base64,/);
editPayload = null;
assert.equal(_test.base64ImageType('/9j/abc'), 'image/jpeg');
// Gateway error messages come back in the documented { error: { message } } shape.
editStatus = 400;
editPayload = { error: { message: 'Request blocked by content moderation' } };
assert.equal(parse(await post({ image: jpegData })).body.reason, 'moderation');
editStatus = 200;
editPayload = null;

// 7. Bria provider (optional, no longer default).
reset();
process.env.REMOVE_BG_PROVIDER = 'bria';
assert.equal(parse(await get()).body.envVar, 'BRIA_API_KEY');
process.env.BRIA_API_KEY = 'test-bria-key';
calls = [];
const bria = parse(await post({ image: pngData }));
assert.equal(bria.status, 200);
assert.equal(bria.body.maskOnly, true, 'Bria results are also applied as a mask on the original');
const briaCall = calls.find(call => call.url === _test.BRIA_ENDPOINT);
assert.equal(briaCall.options.headers.api_token, 'test-bria-key');
assert.equal(usageRows()[0].cost_usd, 0.018);
assert.equal(usageRows()[0].model, 'bria/rmbg-2.0');
assert.equal(_test.resultUrl({ result_url: 'https://x.example/a.png' }), 'https://x.example/a.png');
assert.equal(_test.resultUrl({ result: { image_url: 'http://x.example/a.png' } }), '');
assert.equal(_test.provider({ REMOVE_BG_PROVIDER: 'nonsense' }), 'openai');

// 8. Limits: weekly cap, shared hourly cap, per-server hourly cap.
reset();
process.env.OPENAI_API_KEY = 'sk-test';
weeklySpend = 1000;
const weekly = parse(await post({ image: jpegData }));
assert.equal(weekly.status, 429);
assert.equal(weekly.body.reason, 'weekly-limit');
weeklySpend = 0;
hourlyCalls = 10000;
assert.equal(parse(await post({ image: jpegData })).body.reason, 'limit');
hourlyCalls = 0;
_test.recent.clear();
process.env.REMOVE_BG_HOURLY_LIMIT = '2';
assert.equal(parse(await post({ image: jpegData })).status, 200);
assert.equal(parse(await post({ image: jpegData })).status, 200);
const capped = parse(await post({ image: jpegData }));
assert.equal(capped.status, 429);
assert.equal(capped.body.reason, 'limit');
assert.equal(_test.underLimit('other@essentiallysports.com', 2), true, 'limits are per person');
assert.equal(_test.hourlyLimit({}), 30);

// 9. Admin diagnostics: booleans only, admins only.
reset();
process.env.OPENAI_API_KEY = 'sk-very-secret';
process.env.AI_GATEWAY_API_KEY = 'gw-very-secret';
const diagGet = (query = { diag: '1' }) => handler({ httpMethod: 'GET', headers: { authorization: 'Bearer good-token' }, queryStringParameters: query });
isAdmin = false;
assert.equal(parse(await diagGet()).status, 403, 'not an admin');
assert.equal(parse(await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { diag: '1' } })).status, 401, 'signed out');
isAdmin = true;
const diag = parse(await diagGet());
assert.equal(diag.status, 200);
assert.deepEqual(diag.body.diag, {
  provider: 'openai', providerSetExplicitly: false, model: 'openai/gpt-image-1-mini', quality: 'low',
  endpoint: _test.OPENAI_EDITS, envVar: 'OPENAI_API_KEY', configured: true,
  keys: { OPENAI_API_KEY: true, AI_GATEWAY_API_KEY: true, BRIA_API_KEY: false }, hourlyLimit: 30,
});
const diagText = JSON.stringify(diag.body);
assert.ok(!diagText.includes('very-secret') && !diagText.includes('sk-'), 'never leaks a key');
process.env.REMOVE_BG_PROVIDER = 'gateway';
assert.equal(parse(await diagGet()).body.diag.endpoint, _test.GATEWAY_EDITS);
assert.equal(parse(await diagGet()).body.diag.providerSetExplicitly, true);
isAdmin = false;
process.env.REMOVE_BG_DIAG_EMAILS = 'someone@essentiallysports.com, designer@essentiallysports.com';
assert.equal(parse(await diagGet()).status, 200, 'extra diag emails allowed');
delete process.env.REMOVE_BG_DIAG_EMAILS;
assert.equal(parse(await diagGet({})).body.diag, undefined, 'plain GET is the normal status');
reset();
process.env.OPENAI_API_KEY = 'sk-test';

// 10. The Vercel adapter forwards to the same handler.
const adapter = require('../api/remove-bg.js');
const response = { headers: {}, statusCode: 0, payload: null, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, status(code) { this.statusCode = code; return this; }, send(payload) { this.payload = payload; return this; }, json(payload) { this.payload = payload; return this; } };
await adapter({ method: 'GET', headers: { authorization: 'Bearer good-token' }, query: {} }, response);
assert.equal(response.statusCode, 200);
assert.equal(JSON.parse(response.payload).configured, true);

reset();
console.log('remove-bg tests passed.');
