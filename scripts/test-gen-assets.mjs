#!/usr/bin/env node
// Asset service (Generate Creative mode): prompt sanitising, the never-people
// guard, model routing and cost caps, caching (memory, in-flight, storage),
// cost logging, the cut-out (mask only) path, ES photo de-duplication and
// ranking, the HTTP handler and the browser client's session cache.
// fetch is mocked; nothing leaves the machine.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// A tiny JPEG header with a SOF0 frame: 912 x 1136.
const jpeg = (w = 912, h = 1136) => Buffer.from([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xFF, 0xD9]);
const JPEG_B64 = jpeg().toString('base64');
const PNG_B64 = (() => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(b);
  b.writeUInt32BE(1024, 16);
  b.writeUInt32BE(1280, 20);
  return b.toString('base64');
})();

let calls = [];
let guardReplies = [];
let imageStatus = 200;
let imageError = null;
let storageHas = new Set();
let uploadStatus = 200;
let firstImage400 = false;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  const method = options.method || 'GET';
  const body = typeof options.body === 'string' ? (() => { try { return JSON.parse(options.body); } catch { return options.body; } })() : options.body;
  calls.push({ url: target, method, body, headers: options.headers || {} });
  if (target.includes('/auth/v1/user')) {
    return String(options.headers?.Authorization || options.headers?.authorization) === 'Bearer good-token'
      ? json({ id: 'u1', email: 'designer@essentiallysports.com' }) : json({}, 401);
  }
  if (target.includes('/rpc/frameup_my_ai_spend') || target.includes('/rpc/frameup_team_ai_spend')) return json([{ total_usd: 0 }]);
  if (target.includes('/rpc/frameup_my_ai_calls_last_hour')) return json(0);
  if (target.includes('/rest/v1/frameup_ai_usage')) return new Response('', { status: 201 });
  if (target.includes('/storage/v1/object/public/')) {
    const path = target.split('/storage/v1/object/public/')[1];
    return new Response(null, { status: storageHas.has(path) ? 200 : 400 });
  }
  if (target.includes('/storage/v1/object/')) {
    if (uploadStatus === 200) storageHas.add(target.split('/storage/v1/object/')[1]);
    return new Response(uploadStatus === 200 ? '{"Key":"ok"}' : '{"message":"denied"}', { status: uploadStatus });
  }
  if (target.endsWith('/v1/messages')) {
    const text = guardReplies.length ? guardReplies.shift() : '{"people":false,"text":false,"logo":false,"note":"empty green at dusk"}';
    return json({ content: [{ type: 'text', text }], usage: { input_tokens: 1600, output_tokens: 40 }, stop_reason: 'end_turn' });
  }
  if (target.endsWith('/v1/images/generations') || target.endsWith('/v1/images/edits')) {
    if (firstImage400) { firstImage400 = false; return json({ error: { message: 'Unknown parameter: seed' } }, 400); }
    if (imageError) return json({ error: { message: imageError } }, imageStatus);
    return json({ data: [{ b64_json: JPEG_B64 }] }, imageStatus);
  }
  if (target.endsWith('/v1/chat/completions')) {
    return json({ choices: [{ message: { content: 'here', images: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_B64}` } }] } }] });
  }
  throw new Error(`Unexpected fetch ${method} ${target}`);
};

const assets = require('../netlify/functions/_asset-service.js');
const { handler, _test: handlerTest } = require('../netlify/functions/gen-assets.js');
const T = assets._test;
const modelCalls = () => calls.filter(c => /\/v1\/(images\/(generations|edits)|chat\/completions)$/.test(c.url));
const guardCalls = () => calls.filter(c => c.url.endsWith('/v1/messages'));
const usageRows = () => calls.filter(c => c.url.includes('/rest/v1/frameup_ai_usage')).map(c => c.body);
const ctx = { email: 'designer@essentiallysports.com', token: 'good-token' };
const resetAll = () => {
  calls = []; guardReplies = []; imageStatus = 200; imageError = null; storageHas = new Set(); uploadStatus = 200; firstImage400 = false;
  T.CACHE.clear(); T.INFLIGHT.clear(); T.MASK_CACHE.clear(); T.PHOTO_CACHE.clear(); T.RANK_CACHE.clear(); handlerTest.recent.clear();
  for (const key of ['AI_GATEWAY_API_KEY', 'GENERATE_IMAGES', 'GEN_ASSETS_STORAGE', 'GEN_ASSETS_ECONOMY', 'AI_ECONOMY', 'GEN_ASSETS_GUARD', 'GEN_ASSETS_GUARD_STRICT', 'AI_DISABLE', 'GEN_ASSETS_MODEL_PHOTO', 'OPENAI_API_KEY', 'GENERATE_AI']) delete process.env[key];
};

// ─── 1. Sanitising: never names, teams, leagues, brands, numbers or people ──
{
  const cases = [
    ['LeBron James dunking on a Lakers court', ['lebron', 'james', 'lakers', 'dunking']],
    ['Nelly Korda holding the LPGA trophy with $2 million prize', ['nelly', 'korda', 'lpga', '$2', 'million', 'holding']],
    ['scottie scheffler at the pga tour championship 2026', ['pga', '2026']],
    ['golfer celebrating with fans in a nike jersey', ['golfer', 'celebrating', 'fans', 'nike', 'jersey']],
    ['the patriots logo on a stadium banner with text', ['patriots', 'logo', 'banner', 'text']],
  ];
  for (const [input, gone] of cases) {
    const { text, removed } = T.sanitizePrompt(input, { avoid: ['Scottie Scheffler'] });
    for (const word of gone) assert.ok(!text.includes(word.replace('$', '')), `"${word}" stays out of "${text}"`);
    assert.ok(gone.every(word => removed.includes(word) || removed.some(r => r.includes(word))), `removed list for ${input}: ${removed}`);
    assert.ok(T.subjectIsClean(text), `clean: ${text}`);
    assert.ok(!/[A-Z0-9$]/.test(text));
  }
  // The avoid list catches lower-case names the capital rule cannot see.
  assert.ok(!T.sanitizePrompt('scottie scheffler on the green', { avoid: ['Scottie Scheffler'] }).text.includes('scheffler'));
  // A common capitalised first word is kept; a name is not.
  assert.equal(T.sanitizePrompt('Empty stadium at night').text, 'empty stadium at night');
  assert.ok(!T.sanitizePrompt('Caitlin at the arena').text.includes('caitlin'));
  // Crowds and money are rephrased into safe, face-free, figure-free art.
  assert.match(T.sanitizePrompt('crowd under the lights').text, /out-of-focus stadium crowd reduced to soft bokeh lights/);
  assert.match(T.sanitizePrompt('money falling on the green').text, /blank unmarked banknotes/);
  // Action verbs imply a person, so they go too.
  assert.ok(!/blocks|dunk|celebrat/.test(T.sanitizePrompt('someone blocks a shot then dunks and celebrates by the rim').text));
  assert.equal(T.subjectIsClean('a player on court'), false);
  assert.equal(T.subjectIsClean('LeBron court'), false);
}

// ─── 2. Templates per style and concept art ──────────────────────────────
{
  for (const style of assets.STYLES) {
    const built = T.buildBackgroundPrompt({ prompt: 'Victor Wembanyama blocks a shot on the Spurs court', style, palette: ['#0A7DFA', '#000000'], sport: 'NBA', size: '1080x1920', space: 'bottom' });
    assert.equal(built.style, style);
    assert.ok(!/wembanyama|spurs|victor/i.test(built.prompt), `${style}: no names`);
    assert.ok(built.prompt.includes(T.NO_PEOPLE) && built.prompt.includes(T.NO_MARKS), `${style}: guard clauses`);
    assert.match(built.prompt, /electric blue \(#0A7DFA\)/);
    if (style !== 'texture') assert.match(built.prompt, /bottom third calm/);
    assert.match(built.prompt, /9:16/);
  }
  // Nothing usable left: the sport's default scene.
  assert.match(T.buildBackgroundPrompt({ prompt: 'Scottie Scheffler at the PGA Tour Championship', style: 'photo', sport: 'Golf' }).subject, /golf green at golden hour/);
  assert.match(T.buildBackgroundPrompt({ prompt: '', style: 'texture', sport: 'golf' }).subject, /fairway grass/);
  // Unknown style falls back to photo; no palette falls back to ES colours.
  const fallback = T.buildBackgroundPrompt({ prompt: 'empty arena at night', style: 'oil' });
  assert.equal(fallback.style, 'photo');
  assert.match(fallback.prompt, /deep navy \(#033162\)/);
  // Concept art: the idea is kept, the names are not.
  const concept = T.buildConceptPrompt({ concept: 'LPGA season ends with a $2 million prize for Jeeno Thitikul', sport: 'Golf', palette: ['#D4AF37'], avoid: ['Jeeno Thitikul'] });
  assert.ok(!/lpga|jeeno|thitikul|\$|2 million/i.test(concept.prompt.replace(/\(#D4AF37\)/, '')), concept.prompt);
  assert.match(concept.prompt, /banknotes/);
  assert.match(concept.prompt, /golf world/);
  assert.ok(concept.prompt.includes(T.NO_PEOPLE));
  assert.equal(T.colourName('#D4AF37'), 'gold');
  assert.deepEqual(T.cleanPalette(['nope', '#123']), ['#0A7DFA', '#033162', '#000000', '#FFFFFF']);
}

// ─── 3. Models, sizes, prices, request shapes ────────────────────────────
{
  resetAll();
  assert.equal(T.modelForStyle('photo'), 'bfl/flux-3-image');
  assert.equal(T.modelForStyle('illustration'), 'recraft/recraft-v4.1');
  assert.equal(T.modelForStyle('concept'), 'google/gemini-nano-banana-2.1');
  process.env.GEN_ASSETS_ECONOMY = '1';
  assert.equal(T.modelForStyle('photo'), 'bfl/flux-3-image-klein');
  delete process.env.GEN_ASSETS_ECONOMY;
  process.env.GEN_ASSETS_MODEL_PHOTO = 'bytedance/seedream-4.5';
  assert.equal(T.modelForStyle('photo'), 'bytedance/seedream-4.5');
  delete process.env.GEN_ASSETS_MODEL_PHOTO;
  assert.equal(T.modelSize('bfl/flux-3-image', '1080x1350'), '912x1136');
  assert.equal(T.modelSize('bfl/flux-3-image', '1080x1350', 'high'), '1232x1536');
  assert.equal(T.modelSize('recraft/recraft-v4.1', '1080x1920'), '1024x1820');
  assert.equal(T.priceFor('bfl/flux-3-image', '912x1136'), 0.048);
  assert.equal(T.priceFor('bfl/flux-3-image', '1232x1536'), 0.07);
  assert.equal(T.priceFor('bfl/flux-3-image-klein', '912x1136'), 0.009);
  assert.equal(T.priceFor('google/gemini-nano-banana-2.1', '1K', 'high'), 0.0504);
  assert.equal(T.priceFor('mystery/model'), 0.07);

  const bfl = T.imageRequest({ model: 'bfl/flux-3-image', prompt: 'p', size: '912x1136', aspect: '4:5', seed: 7 });
  assert.match(bfl.url, /\/v1\/images\/generations$/);
  assert.deepEqual(bfl.body.providerOptions, { blackForestLabs: { outputFormat: 'jpeg', safetyTolerance: 2 } });
  assert.equal(bfl.body.response_format, 'b64_json');
  assert.equal(bfl.body.seed, 7);
  assert.equal(T.imageRequest({ model: 'bfl/flux-3-image', prompt: 'p', size: 's', seed: 7, plain: true }).body.seed, undefined);
  const recraft = T.imageRequest({ model: 'recraft/recraft-v4.1', prompt: 'p', size: '1024x1280' });
  assert.equal(recraft.body.providerOptions, undefined);
  const gem = T.imageRequest({ model: 'google/gemini-nano-banana-2.1', prompt: 'p', aspect: '4:5', quality: 'high' });
  assert.match(gem.url, /\/v1\/chat\/completions$/);
  assert.deepEqual(gem.body.modalities, ['text', 'image']);
  assert.deepEqual(gem.body.providerOptions.google.imageConfig, { aspectRatio: '4:5', imageSize: '2K' });
  assert.equal(T.imageRequest({ model: 'google/gemini-nano-banana-2.1', prompt: 'p', plain: true }).body.providerOptions, undefined);
  const edit = T.imageRequest({ model: 'bfl/flux-3-image', prompt: 'p', size: 's', referenceUrl: 'https://x/y.jpg' });
  assert.match(edit.url, /\/v1\/images\/edits$/);
  assert.deepEqual(edit.body.images, [{ image_url: 'https://x/y.jpg' }]);
  assert.deepEqual(T.imageSize(jpeg(912, 1136)), { width: 912, height: 1136 });
  assert.deepEqual(T.imageSize(Buffer.from(PNG_B64, 'base64')), { width: 1024, height: 1280 });
}

// ─── 4. Off without a key; feature switch ───────────────────────────────
{
  resetAll();
  const off = await assets.generateBackground({ prompt: 'empty stadium', style: 'photo' }, ctx);
  assert.equal(off.ok, false);
  assert.equal(off.reason, 'off');
  assert.equal(modelCalls().length, 0);
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  process.env.AI_DISABLE = 'generate-asset';
  const switched = await assets.generateBackground({ prompt: 'empty stadium', style: 'photo' }, ctx);
  assert.equal(switched.reason, 'feature-off');
  assert.equal(modelCalls().length, 0);
}

// ─── 5. Generate, guard, log, upload, cache ─────────────────────────────
{
  resetAll();
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  const args = { prompt: 'empty golf green at dusk', style: 'photo', palette: ['#0A7DFA'], size: '1080x1350', seed: 3 };
  const first = await assets.generateBackground(args, { ...ctx, runId: 'run-1' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.model, 'bfl/flux-3-image');
  assert.equal(first.cached, false);
  assert.equal(first.width, 912);
  assert.equal(first.height, 1136);
  assert.equal(first.rights.aiGenerated, true);
  assert.equal(first.guard.checked, true);
  assert.ok(first.url.includes('/storage/v1/object/public/frameup-links/gen-assets/') && first.url.endsWith('.jpg'), first.url);
  assert.ok(first.cost > 0.048 && first.cost < 0.05, `image + guard cost ${first.cost}`);
  const sent = modelCalls()[0].body;
  assert.equal(sent.size, '912x1136');
  assert.ok(sent.prompt.includes('Strictly no people'));
  // Guard sees the image itself (base64), on the cheap tier.
  const guard = guardCalls()[0].body;
  assert.equal(guard.model, 'anthropic/claude-haiku-5.5');
  assert.equal(guard.messages[0].content[0].source.type, 'base64');
  // Logged: the image (feature, images: 1, cost, run id) and the guard call.
  const rows = usageRows();
  const imageRow = rows.find(row => row.images === 1);
  assert.equal(imageRow.feature, 'generate-asset-background');
  assert.equal(imageRow.model, 'bfl/flux-3-image');
  assert.equal(imageRow.cost_usd, 0.048);
  assert.equal(imageRow.run_id, 'run-1');
  assert.ok(rows.some(row => row.feature === 'generate-asset-guard' && row.ok === true));
  // Uploaded once with the person's session, immutable cache header.
  const upload = calls.find(c => c.method === 'POST' && c.url.includes('/storage/v1/object/frameup-links/gen-assets/'));
  assert.equal(upload.headers.Authorization, 'Bearer good-token');
  assert.match(upload.headers['cache-control'], /immutable/);
  assert.equal(upload.headers['x-upsert'], 'false');

  // Same inputs again: memory cache, no spend.
  calls = [];
  const again = await assets.generateBackground(args, ctx);
  assert.equal(again.cached, true);
  assert.equal(again.cost, 0);
  assert.equal(again.url, first.url);
  assert.equal(calls.length, 0);

  // A cold server: the storage HEAD finds it, still no model call.
  T.CACHE.clear();
  calls = [];
  const cold = await assets.generateBackground(args, ctx);
  assert.equal(cold.cached, true);
  assert.equal(cold.url, first.url);
  assert.equal(modelCalls().length, 0);
  assert.ok(calls.every(c => c.method === 'HEAD'));

  // A different seed is a different image.
  calls = [];
  const other = await assets.generateBackground({ ...args, seed: 4 }, ctx);
  assert.equal(other.cached, false);
  assert.notEqual(other.url, first.url);

  // Parallel identical asks share one model call.
  resetAll();
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  const [a, b] = await Promise.all([assets.generateBackground(args, ctx), assets.generateBackground(args, ctx)]);
  assert.equal(modelCalls().length, 1);
  assert.equal(a.url, b.url);

  // Storage off (or upload refused): a data URL, memory cache only.
  resetAll();
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  process.env.GEN_ASSETS_STORAGE = 'off';
  const inline = await assets.generateBackground(args, ctx);
  assert.match(inline.dataUrl, /^data:image\/jpeg;base64,/);
  assert.ok(!calls.some(c => c.url.includes('/storage/')));
  resetAll();
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  uploadStatus = 403;
  const refused = await assets.generateBackground(args, ctx);
  assert.match(refused.dataUrl, /^data:image\/jpeg;base64,/);
}

// ─── 6. The never-people guard: retry once, then refuse ──────────────────
{
  resetAll();
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  guardReplies = ['{"people":true,"text":false,"logo":false,"note":"a golfer in the distance"}'];
  const retried = await assets.generateBackground({ prompt: 'empty fairway at dawn', style: 'photo' }, ctx);
  assert.equal(retried.ok, true);
  assert.equal(modelCalls().length, 2);
  assert.match(modelCalls()[1].body.prompt, /Absolutely no human figures/);
  assert.ok(retried.cost > 0.096, 'both images are paid for');

  resetAll();
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  guardReplies = ['{"people":true}', '{"logo":true,"people":false}'];
  const refused = await assets.generateBackground({ prompt: 'empty fairway at dawn', style: 'photo' }, ctx);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'guard');
  assert.ok(refused.cost > 0.096);
  assert.ok(!calls.some(c => c.method === 'POST' && c.url.includes('/storage/v1/object/frameup-links')), 'a flagged image is never uploaded');

  // Guard unreadable: fail open by default, closed with GEN_ASSETS_GUARD_STRICT=1.
  resetAll();
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  guardReplies = ['no idea'];
  assert.equal((await assets.generateBackground({ prompt: 'empty fairway at dawn', style: 'photo' }, ctx)).ok, true);
  resetAll();
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  process.env.GEN_ASSETS_GUARD_STRICT = '1';
  guardReplies = ['no idea'];
  const strict = await assets.generateBackground({ prompt: 'empty fairway at dawn', style: 'photo' }, ctx);
  assert.equal(strict.reason, 'guard');
}

// ─── 7. Cost cap, fallback model, 400 retry, policy refusal, image-to-image ──
{
  resetAll();
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  const cheap = await assets.generateBackground({ prompt: 'empty fairway at dawn', style: 'photo' }, { ...ctx, maxCostUsd: 0.02 });
  assert.equal(cheap.model, 'bfl/flux-3-image-klein', 'steps down to economy under the cap');
  calls = [];
  const none = await assets.generateBackground({ prompt: 'empty fairway at dawn', style: 'photo' }, { ...ctx, maxCostUsd: 0.001 });
  assert.equal(none.reason, 'budget');
  assert.equal(calls.length, 0);

  resetAll();
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  firstImage400 = true;
  const retry = await assets.generateBackground({ prompt: 'empty fairway at dawn', style: 'photo', seed: 9 }, ctx);
  assert.equal(retry.ok, true);
  assert.equal(modelCalls()[0].body.seed, 9);
  assert.equal(modelCalls()[1].body.seed, undefined, 'extras dropped after a 400');

  resetAll();
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  imageStatus = 500; imageError = 'upstream exploded';
  const failed = await assets.generateBackground({ prompt: 'empty fairway at dawn', style: 'illustration' }, ctx);
  assert.equal(failed.ok, false);
  assert.deepEqual(modelCalls().map(c => c.body.model), ['recraft/recraft-v4.1', 'bfl/flux-3-image-klein']);
  assert.ok(usageRows().filter(row => row.ok === false).length === 2, 'failures are logged too');

  resetAll();
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  imageStatus = 400; imageError = 'Request blocked by content moderation';
  const policy = await assets.generateBackground({ prompt: 'empty fairway at dawn', style: 'photo' }, ctx);
  assert.equal(policy.reason, 'unsafe');
  assert.equal(modelCalls().length, 1);

  // Image-to-image: never from an ES (athlete) photo; yes from our own backgrounds.
  resetAll();
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  const athlete = await assets.generateBackground({ prompt: 'same scene in blue', style: 'photo', referenceUrl: 'https://image-cdn.essentiallysports.com/wp-content/uploads/player.jpg' }, ctx);
  assert.equal(athlete.reason, 'reference');
  assert.equal(calls.length, 0);
  const ours = T.publicUrl('gen-assets/abc.jpg');
  const styled = await assets.generateBackground({ prompt: 'same scene in blue', style: 'photo', referenceUrl: ours }, ctx);
  assert.equal(styled.ok, true);
  assert.match(modelCalls()[0].url, /images\/edits$/);
  assert.equal(T.referenceAllowed(`${ours.replace('abc.jpg', '../x.jpg')}`), false);
  assert.equal(T.referenceAllowed('data:image/jpeg;base64,AAAA'), false);

  // Concept art goes to Gemini through chat completions.
  resetAll();
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  const art = await assets.generateConceptArt({ concept: 'a giant trophy for the season finale', sport: 'golf', palette: ['#D4AF37'] }, ctx);
  assert.equal(art.ok, true);
  assert.equal(art.model, 'google/gemini-nano-banana-2.1');
  assert.equal(art.width, 1024);
  assert.equal(art.height, 1280);
  assert.ok(art.url.endsWith('.png'));
  assert.ok(Math.abs(art.cost - 0.0336) < 0.002);
  assert.equal(usageRows().find(row => row.images === 1).feature, 'generate-asset-concept');
}

// ─── 8. Cut-out: mask only, cached, never from a bare URL on the server ──
{
  resetAll();
  let maskCalls = 0;
  const removeBg = {
    _test: {
      parseImage: url => (String(url).startsWith('data:image/jpeg;base64,') ? { mime: 'image/jpeg', base64: 'x', bytes: Buffer.from(String(url)) } : { error: 'Send a PNG, JPG or WebP image.' }),
      configured: () => true, envVar: () => 'OPENAI_API_KEY', model: () => 'gpt-image-1-mini',
    },
    removeBackgroundMask: async (dataUrl, size) => {
      maskCalls++;
      assert.equal(size, '1024x1536');
      return { dataUrl: `data:image/png;base64,${PNG_B64}`, cost: 0.0061, model: 'openai/gpt-image-1-mini', usage: { input_tokens: 400, output_tokens: 272 } };
    },
  };
  const c = { ...ctx, gated: true, deps: { removeBg } };
  const padded = `data:image/jpeg;base64,${JPEG_B64}`;
  const first = await assets.cutout({ image: padded, size: '1024x1536' }, c);
  assert.equal(first.ok, true);
  assert.equal(first.maskOnly, true);
  assert.equal(first.rights.aiGenerated, false);
  assert.equal(first.cost, 0.0061);
  assert.equal(usageRows().find(row => row.images === 1).feature, 'remove-bg');
  const second = await assets.cutout({ image: padded, size: '1024x1536' }, c);
  assert.equal(second.cached, true);
  assert.equal(second.cost, 0);
  assert.equal(maskCalls, 1);
  assert.ok(!calls.some(call => call.url.includes('/storage/')), 'masks are never uploaded');
  assert.equal((await assets.cutout({ imageUrl: 'https://image-cdn.essentiallysports.com/a.jpg' }, c)).reason, 'client');
  assert.equal((await assets.cutout({ image: 'data:image/gif;base64,R0lG' }, c)).reason, 'bad-image');
  const off = await assets.cutout({ image: padded }, { ...c, deps: { removeBg: { ...removeBg, _test: { ...removeBg._test, configured: () => false } } } });
  assert.equal(off.reason, 'off');
  assert.equal(off.envVar, 'OPENAI_API_KEY');
  // The real remove-bg module exposes the shared mask call.
  assert.equal(typeof require('../netlify/functions/remove-bg.js').removeBackgroundMask, 'function');
}

// ─── 9. ES photos: different candidates, ranked, varied ──────────────────
{
  resetAll();
  const base = 'https://image-cdn.essentiallysports.com/wp-content/uploads';
  let rankedWith = null;
  const deps = {
    allowed: url => url.startsWith('https://image-cdn.essentiallysports.com/'),
    agency: async q => (q === 'Nelly Korda' ? [
      { id: 'a1', sourceUrl: `${base}/korda-swing-1536x1024.jpg`, caption: 'Nelly Korda tees off on the 1st hole during round one', credit: 'Imagn' },
      { id: 'a2', sourceUrl: `${base}/korda-swing.jpg`, caption: 'Nelly Korda tees off on the 1st hole during round one', credit: 'Imagn' },
      { id: 'a3', sourceUrl: `${base}/korda-trophy.jpg`, caption: 'Nelly Korda lifts the trophy', credit: 'Imagn' },
      { id: 'a4', sourceUrl: `${base}/korda-swing-2.jpg`, caption: 'Nelly Korda tees off on the 1st hole during round one', credit: 'Imagn' },
      { id: 'a5', sourceUrl: 'https://evil.example.com/korda.jpg', caption: 'not ES' },
    ] : []),
    articles: async () => [
      { url: 'https://www.essentiallysports.com/lpga-1', title: 'LPGA story', image: `${base}/korda-trophy-scaled.jpg` },
      { url: 'https://www.essentiallysports.com/lpga-2', title: 'Korda interview', image: `${base}/korda-presser.jpg` },
    ],
    media: async () => [
      { id: 9, sourceUrl: `${base}/korda-collage.jpg`, title: 'collage' },
      { id: 10, sourceUrl: `${base}/korda-fist-pump.jpg`, title: 'fist pump', width: 1600, height: 1067 },
      { id: 11, sourceUrl: `${base}/used-already-1024x683.jpg`, title: 'used' },
    ],
    rank: async ({ person, photos }) => {
      rankedWith = { person, urls: photos.map(p => p.sourceUrl) };
      return { ranked: true, cost: 0.0031, scores: photos.map((p, i) => ({
        n: i + 1,
        subject: true,
        score: p.sourceUrl.includes('presser') ? 2 : 4,
        kind: p.sourceUrl.includes('swing') ? 'action' : p.sourceUrl.includes('trophy') ? 'celebration' : p.sourceUrl.includes('fist') ? 'action' : 'portrait',
        graphic: p.sourceUrl.includes('collage'),
      })) };
    },
  };
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  const found = await assets.findPhotos({ person: 'Nelly Korda', sport: 'Golf', count: 4, exclude: [`${base}/used-already.jpg`] }, { ...ctx, gated: true, deps });
  assert.equal(found.ok, true);
  const urls = found.photos.map(p => p.sourceUrl);
  assert.equal(new Set(urls.map(T.photoStem)).size, urls.length, 'no two versions of one photo');
  assert.ok(!urls.some(u => u.includes('korda-swing-1536x1024') && urls.includes(`${base}/korda-swing.jpg`)));
  assert.ok(!urls.includes(`${base}/korda-swing-2.jpg`), 'same caption + credit (a burst) counts once');
  assert.ok(!urls.some(u => u.includes('trophy-scaled')), 'scaled copy of the agency trophy photo removed');
  assert.ok(!urls.some(u => u.includes('evil.example')), 'only ES hosts');
  assert.ok(!urls.some(u => u.includes('used-already')), 'excluded photo stays out');
  assert.ok(!urls.some(u => u.includes('collage')), 'graphics dropped after ranking');
  assert.equal(rankedWith.person, 'Nelly Korda');
  assert.equal(found.ranked, true);
  assert.equal(found.cost, 0.0031);
  // Variety: the first two are different kinds of picture.
  assert.notEqual(found.photos[0].detail, found.photos[1].detail);
  assert.ok(found.photos.every(p => ['action', 'portrait', 'crowd', 'venue', 'object'].includes(p.kind)), 'contract kinds');
  found.photos.forEach(photo => {
    assert.equal(photo.rights.aiGenerated, false);
    assert.ok(photo.url.startsWith('/api/es-image-search?image='));
    assert.ok(['es-agency', 'es-article', 'es-media'].includes(photo.source));
  });
  assert.equal(found.url, found.photos[0].url);
  // Cached for the next design in the set.
  const again = await assets.findPhotos({ person: 'Nelly Korda', sport: 'Golf', count: 4, exclude: [`${base}/used-already.jpg`] }, { ...ctx, gated: true, deps });
  assert.equal(again.cached, true);
  assert.equal(again.cost, 0);
  // Nothing to search for.
  assert.equal((await assets.findPhotos({}, { ...ctx, deps })).reason, 'empty');
  // Stems
  assert.equal(T.photoStem(`${base}/a-b-1536x1024.jpg`), T.photoStem(`${base}/a-b.jpg?w=800`));
  assert.equal(T.photoStem(`${base}/a-b-scaled.jpeg`), 'a-b');
}

// ─── 10. HTTP handler ───────────────────────────────────────────────────
{
  resetAll();
  const call = (method, body, token = 'good-token') => handler({ httpMethod: method, headers: { authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : '' });
  const parse = r => ({ status: r.statusCode, body: JSON.parse(r.body || '{}') });
  assert.equal(parse(await handler({ httpMethod: 'POST', headers: {}, body: '{}' })).status, 401);
  assert.equal(parse(await call('DELETE')).status, 405);
  const status = parse(await call('GET')).body;
  assert.equal(status.images, false);
  assert.equal(status.models.photo.model, 'bfl/flux-3-image');
  assert.equal(status.storage, 'supabase:frameup-links/gen-assets');
  assert.equal(parse(await call('POST', { op: 'nope' })).status, 400);
  const off = parse(await call('POST', { op: 'background', prompt: 'empty court' }));
  assert.equal(off.status, 503);
  assert.equal(off.body.reason, 'off');
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  const made = parse(await call('POST', { op: 'concept', concept: 'a trophy under one spotlight', sport: 'golf', maxCostUsd: 5 }));
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.ok, true);
  // The requested cap is clamped to the server's per-image maximum.
  assert.ok(handlerTest.MAX_USD_PER_IMAGE() <= 0.12);
  const cap = parse(await call('POST', { op: 'background', prompt: 'empty court', style: 'photo', maxCostUsd: 0.0001 }));
  assert.equal(cap.status, 503);
  assert.equal(cap.body.reason, 'budget');
  const guarded = (guardReplies = ['{"people":true}', '{"people":true}'], parse(await call('POST', { op: 'background', prompt: 'quiet arena', style: 'abstract' })));
  assert.equal(guarded.status, 422);
  assert.equal(parse(await call('POST', { op: 'cutout', image: 'https://image-cdn.essentiallysports.com/a.jpg' })).body.reason, 'bad-image');
}

// ─── 11. Browser client: proxying and the session cache ─────────────────
{
  resetAll();
  const client = require('../frameup-assets.js');
  assert.equal(client._test.toProxied('https://image-cdn.essentiallysports.com/x.jpg'), '/api/es-image-search?image=https%3A%2F%2Fimage-cdn.essentiallysports.com%2Fx.jpg');
  assert.equal(client._test.toProxied('https://xtdusejokbhtjlmijdca.supabase.co/storage/v1/object/public/frameup-links/gen-assets/a.jpg').startsWith('https://xtdusejokbhtjlmijdca'), true);
  assert.equal(client._test.stableKey('b', { b: 1, a: 2 }), client._test.stableKey('b', { a: 2, b: 1 }));
  const saved = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = async (url, options) => {
    posts++;
    const body = JSON.parse(options.body);
    assert.equal(url, '/api/gen-assets');
    if (body.op === 'photos') return json({ ok: false, reason: 'error', error: 'nope' }, 502);
    return json({ ok: true, url: 'https://cdn/x.jpg', width: 912, height: 1136, cost: 0.05, cached: false, rights: { aiGenerated: true } });
  };
  const one = await client.generateBackground({ prompt: 'empty court', style: 'photo' });
  const two = await client.generateBackground({ style: 'photo', prompt: 'empty court' });
  assert.equal(one.cost, 0.05);
  assert.equal(two.cached, true);
  assert.equal(two.cost, 0);
  assert.equal(posts, 1);
  const bad1 = await client.findPhotos({ person: 'x' });
  const bad2 = await client.findPhotos({ person: 'x' });
  assert.equal(bad1.ok, false);
  assert.equal(bad2.ok, false);
  assert.equal(posts, 3, 'failures are not cached');
  const noBrowser = await client.cutout({ imageUrl: 'https://image-cdn.essentiallysports.com/x.jpg' });
  assert.equal(noBrowser.reason, 'client');
  globalThis.fetch = saved;
}

console.log('test-gen-assets: all passed');
