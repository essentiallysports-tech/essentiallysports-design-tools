#!/usr/bin/env node
// Merch Designs server (netlify/functions/merch.js + _fourthwall.js), every
// network call mocked (no Fourthwall, no AI, no Supabase). Core path, tee only:
//   the adapter (Basic auth never in logs, replies or errors; 429 retry with
//   backoff; the 5-a-minute queue; plain-English errors), status (not set up,
//   shop, canPush via admin or MERCH_PUSHERS, caps), templates (curated tee,
//   print areas + logo areas, snapshot fallback, search fallback), concepts
//   (strict shape, exact quotes, no invented numbers, league marks dropped,
//   free mode), copy (price -> margin, code copy in free mode), upload-url,
//   register (print size), preview + create with a design and a logo region,
//   hidden-first, the rights acknowledgement, price -> profitMargin, daily caps,
//   publish / hide, product (shop URL).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const modPath = path.join(fnDir, 'merch.js');
const fwPath = path.join(fnDir, '_fourthwall.js');
const authPath = path.join(fnDir, '_supabase-auth.js');
const gwPath = path.join(fnDir, '_ai-gateway.js');
const TEE = JSON.parse(fs.readFileSync('scripts/fixtures/fourthwall-tee-template.json', 'utf8')).template;
const USER = 'fw-user-test';
const PASS = 'fw-pass-SECRET-123';
const BASIC = `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`;

// ─── Capture every log line (the secret must never appear) ────────────────
const logs = [];
for (const k of ['log', 'warn', 'error', 'info']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { logs.push(a.map(x => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); if (process.env.MERCH_TEST_VERBOSE) orig(...a); };
}

// ─── Mocks ────────────────────────────────────────────────────────────────
const reply = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: k => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => (body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body)) });
let signedIn = true;
let admin = false;
let weeklySpend = 0;
let fw = {};        // path-prefix -> (url, options) => reply
let fwCalls = [];
let usageRows = [];
let messagesHandler = () => { throw new Error('unexpected AI call'); };
function resetFw() {
  fwCalls = [];
  fw = {
    'GET /shops/current': () => reply(200, { id: 'sh_1', name: 'ES Shop', domain: 'es.fourthwall.com', publicDomain: 'shop.essentiallysports.com', status: 'LIVE' }),
    'GET /product-templates/pro_e4677535402b4eeb81': () => reply(200, TEE),
    'POST /media/upload-url': () => reply(201, { uploadUrl: 'https://storage.googleapis.com/fw-upload/abc?sig=1', fileUrl: 'https://storage.googleapis.com/fw-upload/abc.png', expiresAt: '2026-11-25T13:00:00Z' }),
    'POST /media/images': (u, o) => { const b = JSON.parse(o.body); return reply(201, { id: `img_${b.width}`, uri: b.fileUrl, width: b.width, height: b.height, thumbnail: 'https://cdn/t.png', preview: 'https://cdn/p.png' }); },
    'POST /customizations': () => reply(201, { customizationId: 'cus_1', pipelineId: 'pl_1', images: [{ url: 'https://cdn/m1.png', width: 1000, height: 1000, style: 'flat', color: 'White', region: 'front_large' }] }),
    'POST /products': () => reply(201, { productId: 'prod_1', images: [{ url: 'https://cdn/m1.png', width: 1000, height: 1000, style: 'flat', color: 'White' }] }),
    'GET /products/prod_1': () => reply(200, offer('HIDDEN')),
    'PUT /products/prod_1/state': (u, o) => reply(200, offer(JSON.parse(o.body).state)),
  };
}
const offer = access => ({ id: 'prod_1', name: 'Showtime Tee', slug: 'showtime-tee', description: 'd', type: 'STANDARD', state: { type: 'AVAILABLE' }, access: { type: access }, images: [{ id: 'i', url: 'https://cdn/a.png', transformedUrl: 'https://cdn/a-t.png', width: 10, height: 10 }], variants: [{ id: 'v', name: 'S', sku: 's', unitPrice: { value: 21.99, currency: 'USD' }, unitCost: { value: 9.5, currency: 'USD' }, attributes: { description: 'S' }, stock: { type: 'UNLIMITED' }, weight: { value: 1, unit: 'kg' }, dimensions: { length: 1, width: 1, height: 1, unit: 'cm' }, images: [] }], createdAt: '2026-11-25T00:00:00Z', updatedAt: '2026-11-25T00:00:00Z' });
resetFw();
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.startsWith('https://api.fourthwall.com/open-api/v1.0')) {
    const p = href.slice('https://api.fourthwall.com/open-api/v1.0'.length).split('?')[0];
    const method = options.method || 'GET';
    fwCalls.push({ method, path: p, href, headers: options.headers || {}, body: options.body ? JSON.parse(options.body) : undefined });
    const key = `${method} ${p}`;
    const h = fw[key];
    if (!h) return reply(404, { code: 'NOT_MOCKED' });
    return h(href, options);
  }
  if (href.includes('/rest/v1/rpc/is_es_designer_admin')) return reply(200, admin);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, 0);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_spend') || href.includes('/rest/v1/rpc/frameup_team_ai_spend')) return reply(200, [{ total_usd: weeklySpend }]);
  if (href.includes('/rest/v1/frameup_ai_usage')) { usageRows.push(JSON.parse(options.body)); return reply(201, {}); }
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) return messagesHandler(JSON.parse(options.body));
  throw new Error(`unexpected fetch ${href}`);
};
[modPath, fwPath, authPath, gwPath].forEach(p => delete require.cache[p]);
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: () => 'tok',
  verifyEsUser: async () => (signedIn ? { ok: true, user: { email: currentEmail } } : { ok: false, statusCode: 401, error: 'Authentication required.' }),
} };
let currentEmail = 'designer@essentiallysports.com';
for (const k of ['FOURTHWALL_API_USERNAME', 'FOURTHWALL_API_PASSWORD', 'MERCH_PUSHERS', 'MERCH_RIGHTS_POLICY', 'MERCH_TEMPLATES', 'AI_DISABLE', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];
process.env.AI_GATEWAY_API_KEY = 'test-gateway-key';
const FW = require(fwPath);
const { handler, _test: M } = require(modPath);
const sleeps = [];
const fakeSleep = async ms => { sleeps.push(ms); };
let clock = Date.parse('2026-11-25T12:00:00Z');
const testQueue = () => FW.createQueue();
let queue = testQueue();
M.setClientFactory(() => FW.createClient({ sleep: fakeSleep, now: () => clock, random: () => 0.5, queue }));
const setUp = (on = true) => { if (on) { process.env.FOURTHWALL_API_USERNAME = USER; process.env.FOURTHWALL_API_PASSWORD = PASS; } else { delete process.env.FOURTHWALL_API_USERNAME; delete process.env.FOURTHWALL_API_PASSWORD; } };
const call = async body => {
  const res = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) });
  assert.ok(!String(res.body).includes(PASS) && !String(res.body).includes(BASIC), 'secret in a reply');
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};
let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed += 1; } catch (error) { process.stderr.write(`FAIL ${name}\n`); throw error; }
};
const aiJson = obj => () => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 600 }, content: [{ type: 'text', text: '```json\n' + JSON.stringify(obj) + '\n```' }] });

const SOURCE = 'Magic Johnson won 5 titles with the Lakers. After Game 6 he said "We just played Showtime basketball." Fans still call that era Showtime.';
const good = {
  collection: 'replay', title: 'Showtime', team: { id: 'lal', name: 'Lakers' },
  palette: { a: '#552583', b: '#FDB927', ink: '#ffffff' }, garment: { color: '#ffffff', name: 'White' },
  stack: [{ text: 'SHOWTIME', size: 'big', fill: 'a', ink: 'white' }, { text: '5 TITLES', size: 'small', fill: 'b', ink: 'a' }],
  align: 'left', rights: [{ kind: 'team', text: 'Lakers' }], why: 'The era every Lakers fan replays.',
};
const quote = { ...good, collection: 'quote', title: 'Own words', stack: [{ text: 'WE JUST PLAYED', size: 'big', fill: 'a', ink: 'white' }, { text: 'SHOWTIME BASKETBALL', size: 'big', fill: 'b', ink: 'a' }, { text: '— Magic Johnson', size: 'small', fill: 'ink', ink: 'a' }], rights: [{ kind: 'quote', text: 'We just played Showtime basketball.' }, { kind: 'name', text: 'Magic Johnson' }] };
const fakeQuote = { ...quote, stack: [{ text: 'BEST EVER', size: 'big', fill: 'a', ink: 'white' }, { text: '— Magic Johnson', size: 'small', fill: 'ink', ink: 'a' }] };
const invented = { ...good, stack: [{ text: '7 TITLES', size: 'big', fill: 'a', ink: 'white' }] };
const league = { ...good, stack: [{ text: 'NBA CHAMPS', size: 'big', fill: 'a', ink: 'white' }] };
const badShape = { ...good, palette: { a: 'purple', b: '#FDB927', ink: '#fff' } };

// ─── Adapter ───────────────────────────────────────────────────────────────
await test('adapter: Basic auth header sent, never in errors or logs', async () => {
  setUp(true);
  const c = FW.createClient({ sleep: fakeSleep, queue: testQueue() });
  await c.shop();
  assert.equal(fwCalls.at(-1).headers.Authorization, BASIC);
  assert.equal(fwCalls.at(-1).headers['User-Agent'], 'FrameUp-merch/1.0');
  fw['GET /shops/current'] = () => reply(401, { code: 'UNAUTHORIZED' });
  const err = await c.shop().catch(e => e);
  assert.ok(err instanceof FW.FourthwallError);
  assert.match(err.message, /refused FrameUp's login/);
  assert.ok(!JSON.stringify({ ...err, m: err.message, s: err.stack }).includes(PASS));
  resetFw();
});
await test('adapter: public template reads send no auth', async () => {
  setUp(false);
  const t = await FW.createClient({ sleep: fakeSleep }).template('pro_e4677535402b4eeb81');
  assert.equal(t.productId, 'pro_e4677535402b4eeb81');
  assert.equal(fwCalls.at(-1).headers.Authorization, undefined);
  await assert.rejects(FW.createClient().shop(), e => e.reason === 'not-set-up');
  setUp(true);
});
await test('adapter: 429 retried with jittered backoff, then succeeds; gives up after 3', async () => {
  sleeps.length = 0;
  let n = 0;
  fw['POST /products'] = () => (++n <= 2 ? reply(429, { code: 'OPEN_API_TOO_MANY_REQUESTS' }) : reply(201, { productId: 'prod_9', images: [] }));
  const c = FW.createClient({ sleep: fakeSleep, random: () => 0.5, queue: testQueue() });
  const r = await c.createProduct({ productTemplateId: 't', name: 'x', regions: [] });
  assert.equal(r.productId, 'prod_9');
  assert.equal(n, 3);
  assert.deepEqual(sleeps, [600, 1200]); // equal jitter: base 800 * 2^n, half fixed + half random(0.5)
  fw['POST /products'] = () => reply(429, { code: 'OPEN_API_TOO_MANY_REQUESTS' }, { 'retry-after': '2' });
  sleeps.length = 0;
  const err = await c.createProduct({}).catch(e => e);
  assert.equal(err.status, 429);
  assert.match(err.message, /busy/);
  assert.deepEqual(sleeps, [2000, 2000, 2000], 'Retry-After honoured');
  resetFw();
});
await test('adapter: create always hidden (publishOnCreate false, type design)', async () => {
  const c = FW.createClient({ sleep: fakeSleep, queue: testQueue() });
  await c.createProduct({ productTemplateId: 't', name: 'x', regions: [], publishOnCreate: true });
  const sent = fwCalls.at(-1).body;
  assert.equal(sent.publishOnCreate, false);
  assert.equal(sent.type, 'design');
});
await test('adapter: 5-a-minute queue waits, then refuses long waits', async () => {
  let t = 0;
  const waits = [];
  const q = FW.createQueue({ perWindow: 5, windowMs: 60000, maxWaitMs: 25000 });
  const run = () => q.run(async () => 'ok', { now: () => t, sleep: async ms => { waits.push(ms); t += ms; } });
  for (let i = 0; i < 5; i += 1) { t = i * 1000; assert.equal(await run(), 'ok'); }
  assert.deepEqual(waits, []);
  t = 40000; // oldest start at 0 frees at 60000: a 20 s wait is allowed
  assert.equal(await run(), 'ok');
  assert.deepEqual(waits, [20000]);
  t = 30000; // starts now 1000..4000 and 60000: the next slot frees at 61000, a 31 s wait -> refused
  const err = await q.run(async () => 'no', { now: () => t, sleep: async () => {} }).catch(e => e);
  assert.equal(err.reason, 'queue');
  assert.match(err.message, /5 new products or mockups a minute/);
  assert.ok(err.retryAfterS > 25);
});
await test('adapter: error mapping is plain English', () => {
  assert.match(FW.mapError(404, { code: 'MEDIA_FILE_DO_NOT_EXISTS' }).message, /Upload the design again/);
  assert.match(FW.mapError(409, { code: 'OFFER_SLUG_DUPLICATION_ERROR' }).message, /Change the title/);
  assert.match(FW.mapError(403, { code: 'SAAS_OPERATION_NOT_ALLOWED_ERROR' }).message, /plan/);
  assert.match(FW.mapError(400, { code: 'WEIRD' }).message, /didn't accept/);
  assert.match(FW.mapError(503, null).message, /right now/);
  assert.equal(FW.productUrl('shop.essentiallysports.com', 'showtime-tee'), 'https://shop.essentiallysports.com/products/showtime-tee');
});

// ─── status / auth ─────────────────────────────────────────────────────────
await test('auth required', async () => {
  signedIn = false;
  assert.equal((await call({ mode: 'status' })).status, 401);
  signedIn = true;
});
await test('status: not set up', async () => {
  setUp(false); M.reset();
  const r = await call({ mode: 'status' });
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, false);
  assert.equal(r.body.shop, null);
  assert.match(r.body.notice, /isn't connected/);
  assert.equal(r.body.rightsPolicy, 'acknowledge');
  const p = await call({ mode: 'create' });
  assert.equal(p.status, 503);
  assert.equal(p.body.reason, 'not-set-up');
});
await test('status: shop, canPush (admin / MERCH_PUSHERS), caps', async () => {
  setUp(true); M.reset();
  let r = await call({ mode: 'status' });
  assert.deepEqual(r.body.shop, { name: 'ES Shop', publicDomain: 'shop.essentiallysports.com', status: 'LIVE' });
  assert.equal(r.body.canPush, false);
  assert.deepEqual(r.body.caps.person, { used: 0, limit: 10, left: 10 });
  assert.deepEqual(r.body.caps.team, { used: 0, limit: 30, left: 30 });
  admin = true; r = await call({ mode: 'status' }); assert.equal(r.body.canPush, true); admin = false;
  process.env.MERCH_PUSHERS = 'someone@x.com, Designer@EssentiallySports.com';
  r = await call({ mode: 'status' }); assert.equal(r.body.canPush, true);
  delete process.env.MERCH_PUSHERS;
  process.env.MERCH_RIGHTS_POLICY = 'strict';
  r = await call({ mode: 'status' }); assert.equal(r.body.rightsPolicy, 'strict');
  delete process.env.MERCH_RIGHTS_POLICY;
});
await test('push modes need canPush', async () => {
  for (const mode of ['upload-url', 'register', 'preview', 'create', 'publish', 'hide']) {
    const r = await call({ mode });
    assert.equal(r.status, 403, mode);
    assert.equal(r.body.reason, 'no-push');
  }
});

// ─── templates ─────────────────────────────────────────────────────────────
await test('templates: curated tee with print spec, colours and areas', async () => {
  M.reset();
  const r = await call({ mode: 'templates' });
  const t = r.body.templates[0];
  assert.equal(r.body.templates.length, 1);
  assert.equal(t.blank, 'tee');
  assert.equal(t.templateId, 'pro_e4677535402b4eeb81');
  assert.equal(t.source, 'curated');
  assert.equal(t.basePrice, 9.5);
  assert.deepEqual({ ...t.printSpec }, { templateId: 'pro_e4677535402b4eeb81', region: 'front', regionId: 'front_large', pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150, inchesWidth: 15, inchesHeight: 18, placementStrategy: 'FULL_REGION', garmentColor: '#ffffff' });
  assert.deepEqual(t.colors.map(c => c.name).sort(), ['Black', 'Cardinal', 'Royal', 'White']);
  const ids = t.areas.map(a => a.regionId);
  assert.ok(!ids.some(id => /embroidery/.test(id)));
  assert.equal(new Set(ids).size, ids.length, 'deduped');
  assert.deepEqual(t.areas.filter(a => a.suitsLogo).map(a => a.regionId).sort(), ['sleeve_left', 'sleeve_right']);
  assert.ok(t.areas.find(a => a.regionId === 'front_large').suitsDesign);
  assert.equal(t.areas.find(a => a.regionId === 'label_inside').renderable, false);
  const n = fwCalls.length;
  await call({ mode: 'templates' });
  assert.equal(fwCalls.length, n, 'cached');
});
await test('templates: fallback search, then snapshot', async () => {
  M.reset();
  delete fw['GET /product-templates/pro_e4677535402b4eeb81'];
  fw['GET /product-templates/search/t-shirt'] = () => reply(200, { total: 1, results: [{ productId: 'pro_alt', name: 'Alt', category: 'Apparel/T-Shirts', brand: 'X', productionMethod: 'DTG', supportsBackendRendering: true, basePrice: { amount: 11, currency: 'USD' } }] });
  fw['GET /product-templates/pro_alt'] = () => reply(200, { ...TEE, productId: 'pro_alt' });
  let r = await call({ mode: 'templates' });
  assert.equal(r.body.templates[0].templateId, 'pro_alt');
  assert.equal(r.body.templates[0].source, 'search');
  M.reset(); resetFw();
  fw['GET /product-templates/pro_e4677535402b4eeb81'] = () => reply(503, {});
  fw['GET /product-templates/pro_EJBSRKhJSd2unv4ZnGKwdQ'] = () => reply(503, {});
  fw['GET /product-templates/search/t-shirt'] = () => reply(503, {});
  r = await call({ mode: 'templates' });
  assert.equal(r.body.templates[0].source, 'snapshot');
  assert.equal(r.body.templates[0].printSpec.pixelsWidth, 2250);
  assert.ok(r.body.templates[0].areas.some(a => a.suitsLogo));
  M.reset(); resetFw();
  // An embroidery-only or min-order template does not qualify.
  assert.equal(M.qualifies({ ...TEE, minimumOrdersNumber: 12 }, M.BLANKS.tee), false);
  assert.equal(M.qualifies({ ...TEE, supportsBackendRendering: false }, M.BLANKS.tee), false);
});

// ─── concepts ──────────────────────────────────────────────────────────────
await test('concepts: strict shape, exact quotes, no invented numbers, no league marks', async () => {
  M.reset();
  let sent;
  messagesHandler = b => { sent = b; return aiJson({ concepts: [good, quote, fakeQuote, invented, league, badShape] })(); };
  const r = await call({ mode: 'concepts', content: SOURCE, count: 6 });
  assert.equal(r.status, 200);
  assert.equal(r.body.ai, true);
  assert.equal(r.body.concepts.length, 2);
  assert.equal(r.body.dropped, 4);
  const [a, q] = r.body.concepts;
  assert.match(a.id, /^mc-/);
  assert.deepEqual(a.blanks, ['tee']);
  assert.equal(a.palette.a, '#552583');
  assert.ok(a.rights.some(x => x.kind === 'team' && x.text === 'Lakers'));
  assert.equal(q.collection, 'quote');
  assert.ok(sent.model.includes('haiku'), sent.model);
  assert.match(JSON.stringify(sent.system), /word for word/);
  assert.match(JSON.stringify(sent.system), /No emojis/, 'ES VOICE included');
  assert.ok(usageRows.some(u => u.feature === 'merch-concepts'));
  assert.ok(r.body.cost.usd > 0);
  const again = await call({ mode: 'concepts', content: SOURCE, count: 6 });
  assert.equal(again.body.cost.cached, true);
  assert.equal(again.body.cost.usd, 0);
});
await test('concepts: garbage and empty answers', async () => {
  M.reset();
  messagesHandler = () => reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: 'nope' }] });
  assert.equal((await call({ mode: 'concepts', content: SOURCE })).status, 502);
  messagesHandler = aiJson({ concepts: [invented] });
  const r = await call({ mode: 'concepts', content: SOURCE + ' ' });
  assert.equal(r.body.free, true);
  assert.equal(r.body.concepts, null);
  assert.equal((await call({ mode: 'concepts', content: 'short' })).status, 400);
});
await test('concepts: free mode -> { free: true, concepts: null }', async () => {
  M.reset();
  weeklySpend = 999;
  messagesHandler = () => { throw new Error('AI must not run in free mode'); };
  const r = await call({ mode: 'concepts', content: SOURCE });
  assert.equal(r.status, 200);
  assert.equal(r.body.free, true);
  assert.equal(r.body.concepts, null);
  weeklySpend = 0;
});

// ─── copy ──────────────────────────────────────────────────────────────────
await test('copy: AI title/description, price and margin in code', async () => {
  M.reset();
  messagesHandler = aiJson({ title: 'Showtime Replay Tee', description: 'For fans who still replay the Showtime era.' });
  const r = await call({ mode: 'copy', concept: good, content: SOURCE });
  assert.equal(r.body.copy.title, 'Showtime Replay Tee');
  assert.equal(r.body.copy.base, 9.5);
  assert.equal(r.body.copy.retail, 21.99);
  assert.equal(r.body.copy.margin, 12.49);
  assert.ok(usageRows.some(u => u.feature === 'merch-copy'));
  messagesHandler = aiJson({ title: 'Official 9 Rings Tee', description: 'x' });
  const bad = await call({ mode: 'copy', concept: good, content: SOURCE + '.' });
  assert.equal(bad.body.ai, false);
  assert.match(bad.body.copy.title, /Showtime/);
  weeklySpend = 999;
  const free = await call({ mode: 'copy', concept: good, content: SOURCE + '..' });
  assert.equal(free.body.free, true);
  assert.equal(free.body.copy.retail, 21.99);
  weeklySpend = 0;
});

// ─── upload, register, preview, create, publish, hide, product ────────────
process.env.MERCH_PUSHERS = 'designer@essentiallysports.com';
await test('upload-url and register (once per image, print size checked)', async () => {
  M.reset();
  let r = await call({ mode: 'upload-url', fileName: 'Showtime front!.png', size: 400000, contentType: 'image/png' });
  assert.equal(r.status, 200);
  assert.equal(r.body.method, 'PUT');
  assert.match(r.body.uploadUrl, /^https:\/\/storage\.googleapis\.com/);
  assert.deepEqual(fwCalls.at(-1).body, { fileName: 'Showtime-front-.png', contentType: 'image/png', size: 400000 });
  assert.equal((await call({ mode: 'upload-url', size: 30 * 1024 * 1024 })).status, 400);
  assert.equal((await call({ mode: 'upload-url', size: 10, contentType: 'image/jpeg' })).status, 400);
  r = await call({ mode: 'register', fileUrl: 'https://storage.googleapis.com/fw-upload/abc.png', width: 2250, height: 2700, blank: 'tee' });
  assert.equal(r.body.imageId, 'img_2250');
  r = await call({ mode: 'register', fileUrl: 'https://storage.googleapis.com/fw-upload/logo.png', width: 600, height: 525, blank: 'tee', region: 'sleeve_left' });
  assert.equal(r.body.imageId, 'img_600');
  r = await call({ mode: 'register', fileUrl: 'https://storage.googleapis.com/fw-upload/abc.png', width: 1000, height: 1000, blank: 'tee' });
  assert.equal(r.body.reason, 'print-size');
  assert.match(r.body.error, /2250 x 2700/);
});
await test('preview: design + logo regions, queue-limited customization', async () => {
  const r = await call({ mode: 'preview', blank: 'tee', imageId: 'img_2250', logo: { region: 'sleeve_left', imageId: 'img_600' }, color: 'royal' });
  assert.equal(r.status, 200);
  assert.equal(r.body.customizationId, 'cus_1');
  const sent = fwCalls.find(c => c.path === '/customizations').body;
  assert.deepEqual(sent, { productTemplateId: 'pro_e4677535402b4eeb81', regions: [{ region: 'front_large', imageId: 'img_2250', placementStrategy: 'FULL_REGION' }, { region: 'sleeve_left', imageId: 'img_600', placementStrategy: 'FULL_REGION' }], colors: ['Royal'] });
  assert.equal((await call({ mode: 'preview', imageId: 'img_2250', logo: { region: 'label_inside', imageId: 'img_1' } })).status, 400, 'non-renderable area refused');
  assert.equal((await call({ mode: 'preview', imageId: 'img_2250', logo: { region: 'front_large', imageId: 'img_1' } })).status, 400, 'same area refused');
});
const createBody = extra => ({ mode: 'create', blank: 'tee', concept: good, content: SOURCE, imageId: 'img_2250', logo: { region: 'sleeve_right', imageId: 'img_600' }, title: 'Showtime Replay Tee', description: 'For fans.', retail: 21.99, color: 'White', ack: { accepted: true, items: [{ kind: 'team', text: 'Lakers' }] }, ...extra });
await test('create: rights acknowledgement required', async () => {
  M.reset();
  let r = await call(createBody({ ack: undefined }));
  assert.equal(r.status, 400);
  assert.equal(r.body.reason, 'rights-ack');
  assert.deepEqual(r.body.items.map(i => i.text), ['Lakers']);
  r = await call(createBody({ ack: { accepted: true, items: [] } }));
  assert.equal(r.body.reason, 'rights-ack');
  r = await call(createBody({ concept: league }));
  assert.equal(r.body.reason, 'concept');
  assert.ok(!fwCalls.some(c => c.path === '/products' && c.method === 'POST'));
});
await test('create: hidden, price -> profitMargin, ack recorded, product URL', async () => {
  M.reset();
  const r = await call(createBody());
  assert.equal(r.status, 200);
  assert.equal(r.body.state, 'HIDDEN');
  assert.equal(r.body.productId, 'prod_1');
  const sent = fwCalls.find(c => c.path === '/products' && c.method === 'POST').body;
  assert.equal(sent.publishOnCreate, false);
  assert.equal(sent.type, 'design');
  assert.equal(sent.productTemplateId, 'pro_e4677535402b4eeb81');
  assert.equal(sent.profitMargin, 12.49);
  assert.equal(sent.description, 'For fans.', 'description is an optional field in both specs');
  assert.equal(r.body.description, 'For fans.');
  assert.deepEqual(sent.colors, ['White']);
  assert.deepEqual(sent.regions.map(x => x.region), ['front_large', 'sleeve_right']);
  assert.deepEqual(r.body.price, { retail: 21.99, base: 9.5, margin: 12.49 });
  assert.equal(r.body.ack.by, 'designer@essentiallysports.com');
  assert.ok(r.body.ack.at);
  assert.deepEqual(r.body.ack.items, [{ kind: 'team', text: 'Lakers' }]);
  assert.equal(r.body.productUrl, 'https://shop.essentiallysports.com/products/showtime-tee');
  assert.equal(r.body.caps.person.used, 1);
  assert.equal(M.HISTORY[0].productId, 'prod_1');
  const low = await call(createBody({ retail: 10 }));
  assert.equal(low.body.reason, 'price');
});
await test('create: daily caps, 10 per person and 30 per team', async () => {
  M.reset();
  for (let i = 0; i < 10; i += 1) M.countCreate('designer@essentiallysports.com');
  let r = await call(createBody());
  assert.equal(r.status, 429);
  assert.equal(r.body.reason, 'daily-cap');
  assert.match(r.body.error, /10 products/);
  M.reset();
  for (let i = 0; i < 30; i += 1) M.countCreate(`p${i}@essentiallysports.com`);
  r = await call(createBody());
  assert.match(r.body.error, /team has sent 30/);
});
await test('create: Fourthwall errors are plain English', async () => {
  M.reset();
  fw['POST /products'] = () => reply(409, { code: 'OFFER_SLUG_DUPLICATION_ERROR', shopId: 's', offerSlug: 'x' });
  const r = await call(createBody());
  assert.equal(r.status, 409);
  assert.match(r.body.error, /already in the shop/);
  assert.equal(M.caps('designer@essentiallysports.com').person.used, 0, 'a failed create is not counted');
  resetFw();
});
await test('publish / hide / product', async () => {
  M.reset();
  let r = await call({ mode: 'publish', productId: 'prod_1' });
  assert.equal(r.body.product.state, 'PUBLIC');
  assert.deepEqual(fwCalls.find(c => c.path === '/products/prod_1/state' && c.method === 'PUT').body, { state: 'PUBLIC' });
  r = await call({ mode: 'hide', productId: 'prod_1' });
  assert.equal(r.body.product.state, 'HIDDEN');
  r = await call({ mode: 'product', productId: 'prod_1' });
  assert.equal(r.body.product.url, 'https://shop.essentiallysports.com/products/showtime-tee');
  assert.equal(r.body.product.price, 21.99);
  assert.equal(r.body.product.thumbnail, 'https://cdn/a-t.png');
  assert.equal((await call({ mode: 'publish', productId: '../x' })).status, 400);
});
await test('not yet: archive, list, upload-relay', async () => {
  for (const mode of ['archive', 'list', 'upload-relay']) assert.equal((await call({ mode })).status, 501);
});
await test('rights: inline fallback used until merch-rules.js lands', () => {
  const R = M.InlineRules;
  const scan = R.scanConcept(quote, { source: SOURCE });
  assert.equal(scan.blocked.length, 0);
  assert.ok(scan.warnings.some(w => w.kind === 'quote'));
  assert.ok(R.scanConcept(fakeQuote, { source: SOURCE }).blocked.some(b => b.kind === 'quote-source'));
  assert.ok(R.scanConcept(good, { source: SOURCE, policy: 'strict' }).blocked.length > 0, 'strict blocks warnings');
  assert.deepEqual(R.marginFor(21.99, 9.5), { ok: true, retail: 21.99, base: 9.5, margin: 12.49 });
});
await test('the secret never reached a log line', () => {
  const all = logs.join('\n');
  assert.ok(!all.includes(PASS));
  assert.ok(!all.includes(BASIC));
  assert.ok(!all.includes(Buffer.from(`${USER}:${PASS}`).toString('base64')));
});

process.stdout.write(`test-merch: ${passed} tests passed\n`);
