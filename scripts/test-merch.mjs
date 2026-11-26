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
// v2: all five blanks (per-blank print spec, logo areas, prices), history in
//   Supabase (fake PostgREST), archive (admin, confirm, ours only), list (db and
//   Fourthwall fallback), collections (read-modify-write), sales, upload relay
//   (SSRF guard, own folder, size + PNG check), product refresh.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { createFakeDb } from './fixtures/fake-merch-db.mjs';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const modPath = path.join(fnDir, 'merch.js');
const fwPath = path.join(fnDir, '_fourthwall.js');
const authPath = path.join(fnDir, '_supabase-auth.js');
const gwPath = path.join(fnDir, '_ai-gateway.js');
const TEE = JSON.parse(fs.readFileSync('scripts/fixtures/fourthwall-tee-template.json', 'utf8')).template;
const LIVE = JSON.parse(fs.readFileSync('scripts/fixtures/fourthwall-blank-templates.json', 'utf8')).templates;
const db = createFakeDb();
const gcsPuts = [];
const USER_ID = '0b4f6a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b';
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
  if (href.startsWith('https://db.example.supabase.co/rest/v1/frameup_merch_') || href.startsWith('https://db.example.supabase.co/storage/v1/')) return db.handle(href, options);
  if (href.startsWith('https://storage.googleapis.com/')) { gcsPuts.push({ href, headers: options.headers, size: options.body?.length }); return reply(200, ''); }
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
  verifyEsUser: async () => (signedIn ? { ok: true, user: { id: USER_ID, email: currentEmail } } : { ok: false, statusCode: 401, error: 'Authentication required.' }),
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
  const r = await call({ mode: 'templates', blank: 'tee' });
  const t = r.body.templates[0];
  assert.equal(r.body.templates.length, 1);
  assert.equal(t.blank, 'tee');
  assert.equal(t.kind, 'tee');
  assert.equal(t.templateId, 'pro_e4677535402b4eeb81');
  assert.equal(t.source, 'curated');
  assert.equal(t.basePrice, 9.5);
  assert.deepEqual({ ...t.printSpec }, { templateId: 'pro_e4677535402b4eeb81', region: 'front', regionId: 'front_large', pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150, inchesWidth: 15, inchesHeight: 18, placementStrategy: 'PLACEMENT_ID', placementId: 'largeCenter', garmentColor: '#ffffff', kind: 'tee', minDpi: 150, wrap: false });
  assert.deepEqual(t.colors.map(c => c.name).sort(), ['Black', 'Cardinal', 'Royal', 'White']);
  const ids = t.areas.map(a => a.regionId);
  assert.ok(!ids.some(id => /embroidery/.test(id)));
  assert.equal(new Set(ids).size, ids.length, 'deduped');
  assert.deepEqual(t.areas.filter(a => a.suitsLogo).map(a => a.regionId).sort(), ['sleeve_left', 'sleeve_right']);
  assert.ok(t.areas.find(a => a.regionId === 'front_large').suitsDesign);
  assert.equal(t.areas.find(a => a.regionId === 'label_inside').renderable, false);
  const n = fwCalls.length;
  await call({ mode: 'templates', blank: 'tee' });
  assert.equal(fwCalls.length, n, 'cached');
});
await test('templates: fallback search, then snapshot', async () => {
  M.reset();
  delete fw['GET /product-templates/pro_e4677535402b4eeb81'];
  fw['GET /product-templates/search/t-shirt'] = () => reply(200, { total: 1, results: [{ productId: 'pro_alt', name: 'Alt', category: 'Apparel/T-Shirts', brand: 'X', productionMethod: 'DTG', supportsBackendRendering: true, basePrice: { amount: 11, currency: 'USD' } }] });
  fw['GET /product-templates/pro_alt'] = () => reply(200, { ...TEE, productId: 'pro_alt' });
  let r = await call({ mode: 'templates', blank: 'tee' });
  assert.equal(r.body.templates[0].templateId, 'pro_alt');
  assert.equal(r.body.templates[0].source, 'search');
  M.reset(); resetFw();
  fw['GET /product-templates/pro_e4677535402b4eeb81'] = () => reply(503, {});
  fw['GET /product-templates/pro_EJBSRKhJSd2unv4ZnGKwdQ'] = () => reply(503, {});
  fw['GET /product-templates/search/t-shirt'] = () => reply(503, {});
  r = await call({ mode: 'templates', blank: 'tee' });
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
  assert.equal(r.body.copy.retail, 29.99, 'per-blank suggested price (tee $29.99)');
  assert.equal(r.body.copy.margin, 20.49);
  assert.ok(usageRows.some(u => u.feature === 'merch-copy'));
  messagesHandler = aiJson({ title: 'Official 9 Rings Tee', description: 'x' });
  const bad = await call({ mode: 'copy', concept: good, content: SOURCE + '.' });
  assert.equal(bad.body.ai, false);
  assert.match(bad.body.copy.title, /Showtime/);
  weeklySpend = 999;
  const free = await call({ mode: 'copy', concept: good, content: SOURCE + '..' });
  assert.equal(free.body.free, true);
  assert.equal(free.body.copy.retail, 29.99);
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
  assert.deepEqual(sent, { productTemplateId: 'pro_e4677535402b4eeb81', regions: [{ region: 'front_large', imageId: 'img_2250', placementStrategy: 'PLACEMENT_ID', placementId: 'largeCenter' }, { region: 'sleeve_left', imageId: 'img_600', placementStrategy: 'FULL_REGION' }], colors: ['Royal'] });
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
// ─── v2: all five blanks ───────────────────────────────────────────────────
const LIVE_IDS = { tee: 'pro_Vv1XdaPMSdm6jZ5pj24NCQ', hoodie: 'pro_380', poster: 'pro_15bc29bc8a324d449d', sticker: 'pro_358', mug: 'pro_4v5OfYhyRx62KW5b7Oj6Uw' };
const liveTemplates = () => Object.entries(LIVE_IDS).forEach(([k, id]) => { fw[`GET /product-templates/${id}`] = () => reply(200, LIVE[k]); });
const serviceOn = (on = true) => { if (on) process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-test'; else delete process.env.SUPABASE_SERVICE_ROLE_KEY; };
await test('templates: all five blanks with per-blank print spec, logo rule and price', async () => {
  M.reset(); resetFw(); liveTemplates();
  const r = await call({ mode: 'templates' });
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.templates.map(t => [t.blank, t]));
  assert.deepEqual(Object.keys(by), ['tee', 'hoodie', 'poster', 'sticker', 'mug']);
  for (const t of r.body.templates) { assert.equal(t.kind, t.blank); assert.equal(t.printSpec.kind, t.blank); assert.equal(t.source, 'curated'); }
  // tee: the owner-verified Stanley/Stella blank, $29.99 on a $15.85 base.
  assert.equal(by.tee.templateId, LIVE_IDS.tee);
  assert.equal(by.tee.basePrice, 15.85);
  assert.deepEqual(by.tee.pricing, { suggested: 29.99, margin: 14.14, base: 15.85 });
  assert.equal(by.tee.printSpec.placementId, 'largeCenter');
  // hoodie: 1650 x 1650 front, largeCenter, sleeves for the logo.
  assert.equal(by.hoodie.printSpec.regionId, 'front');
  assert.deepEqual([by.hoodie.printSpec.pixelsWidth, by.hoodie.printSpec.pixelsHeight, by.hoodie.printSpec.dpi], [1650, 1650, 150]);
  assert.equal(by.hoodie.printSpec.placementStrategy, 'PLACEMENT_ID');
  assert.deepEqual(by.hoodie.areas.filter(a => a.suitsLogo).map(a => a.regionId).sort(), ['sleeve_left', 'sleeve_right']);
  assert.ok(!by.hoodie.areas.some(a => /embroidery/.test(a.regionId)));
  assert.equal(by.hoodie.logo, 'area');
  assert.equal(by.hoodie.pricing.suggested, 49.99);
  // poster: 300 DPI hard good, one area, logo inside the print.
  assert.deepEqual([by.poster.printSpec.regionId, by.poster.printSpec.pixelsWidth, by.poster.printSpec.pixelsHeight, by.poster.printSpec.dpi], ['default', 1500, 2100, 300]);
  assert.equal(by.poster.printSpec.placementStrategy, 'FULL_REGION');
  assert.equal(by.poster.minDpi, 300);
  assert.equal(by.poster.apparel, false);
  assert.equal(by.poster.logo, 'inside');
  assert.deepEqual(by.poster.areas.map(a => [a.regionId, a.suitsDesign, a.suitsLogo]), [['default', true, false]]);
  // sticker: 900 x 900 is small but is the design area.
  assert.deepEqual(by.sticker.areas.map(a => [a.regionId, a.suitsDesign, a.suitsLogo]), [['default', true, false]]);
  assert.deepEqual([by.sticker.printSpec.placementStrategy, by.sticker.printSpec.placementId], ['PLACEMENT_ID', 'fullSize']);
  assert.ok(by.sticker.pricing.suggested >= 5.99);
  // mug: a 2700 x 1050 full wrap at 300 DPI.
  assert.deepEqual([by.mug.printSpec.pixelsWidth, by.mug.printSpec.pixelsHeight, by.mug.printSpec.dpi, by.mug.printSpec.wrap], [2700, 1050, 300, true]);
  assert.equal(by.mug.printSpec.placementStrategy, 'FULL_REGION');
  assert.equal(by.mug.wrap, true);
  // One blank only.
  const one = await call({ mode: 'templates', blank: 'mug' });
  assert.deepEqual(one.body.templates.map(t => t.blank), ['mug']);
});
await test('templates: every blank has a snapshot with the same print size', async () => {
  M.reset(); resetFw(); delete fw['GET /product-templates/pro_e4677535402b4eeb81'];
  const r = await call({ mode: 'templates' });
  const by = Object.fromEntries(r.body.templates.map(t => [t.blank, t]));
  assert.ok(r.body.templates.every(t => t.source === 'snapshot'));
  assert.deepEqual([by.tee.printSpec.pixelsWidth, by.hoodie.printSpec.pixelsWidth, by.poster.printSpec.pixelsWidth, by.sticker.printSpec.pixelsWidth, by.mug.printSpec.pixelsWidth], [2250, 1650, 1500, 900, 2700]);
  assert.equal(by.mug.printSpec.wrap, true);
  assert.deepEqual(by.tee.pricing, { suggested: 29.99, margin: 14.14, base: 15.85 });
  // Snapshots match the live replies saved on 2026-11-25.
  for (const [k, t] of Object.entries(LIVE)) {
    const area = M.pickArea(t, M.BLANKS[k].regionPrefer);
    assert.equal(by[k].printSpec.regionId, area.regionId, k);
    assert.equal(by[k].printSpec.pixelsWidth, area.dimensions.pixelsWidth, k);
    assert.equal(by[k].printSpec.pixelsHeight, area.dimensions.pixelsHeight, k);
    assert.equal(by[k].basePrice, t.priceFrom.amount, k);
    assert.ok(M.qualifies(t, M.BLANKS[k]), `${k} qualifies`);
  }
  M.reset();
});
await test('concepts keep the blanks they name', () => {
  const c = M.shapeConcept({ ...good, blanks: ['mug', 'poster', 'nope'] }, { content: SOURCE }).concept;
  assert.deepEqual(c.blanks, ['mug', 'poster']);
  assert.deepEqual(M.shapeConcept(good, { content: SOURCE }).concept.blanks, ['tee']);
});

// ─── merch5: black and hex pill colours, paletteFrom ─────────────────────
const hexRow = { text: 'SHOWTIME', size: 'big', fill: '#e4002b', ink: '#FFFFFF' };
await test('shapeConcept accepts black and hex rows (hex stored uppercase) and rejects bad colours', () => {
  const c = M.shapeConcept({ ...good, stack: [hexRow, { text: '5 TITLES', size: 'small', fill: 'black', ink: 'white' }] }, { content: SOURCE }).concept;
  assert.deepEqual(c.stack.map(r => [r.fill, r.ink]), [['#E4002B', '#FFFFFF'], ['black', 'white']]);
  for (const bad of ['#12345', 'red', '#GGGGGG', 'navy', '']) assert.equal(M.shapeConcept({ ...good, stack: [{ ...hexRow, fill: bad }] }, { content: SOURCE }).error, 'row', bad);
  assert.equal(M.shapeConcept({ ...good, stack: [{ ...hexRow, fill: '#FFFFFF', ink: 'white' }] }, { content: SOURCE }).error, 'row', 'hex fill equal to its ink (resolved)');
  assert.equal(M.shapeConcept({ ...good, stack: [{ ...hexRow, fill: 'a', ink: '#552583' }] }, { content: SOURCE }).error, 'row', 'hex ink equal to the a key');
});
await test('repair keeps a person\'s hex (even low contrast); keys are still repaired', () => {
  const dark = { ...good, garment: { color: '#020202', name: 'Black' }, palette: { a: '#552583', b: '#0c2340', ink: '#ffffff' } };
  const c = M.shapeConcept({ ...dark, stack: [{ text: 'SHOWTIME', size: 'big', fill: '#0C2340', ink: '#FFFFFF' }, { text: 'LAKERS', size: 'big', fill: 'b', ink: 'ink' }] }, { content: SOURCE }).concept;
  assert.equal(c.stack[0].fill, '#0C2340', 'hex kept');
  assert.notEqual(c.stack[1].fill, 'b', 'navy key on black repaired');
  const kept = M.shapeConcept({ ...dark, stack: [{ text: 'SHOWTIME', size: 'big', fill: '#0C2340', ink: '#FFFFFF' }] }, { content: SOURCE, repair: false }).concept;
  assert.equal(kept.stack[0].fill, '#0C2340');
});
await test('paletteFrom: valid shapes kept and clipped, anything else dropped', () => {
  const from = pf => M.shapeConcept({ ...good, paletteFrom: pf }, { content: SOURCE }).concept.paletteFrom;
  assert.deepEqual(from({ kind: 'team', sport: 'NBA', team: 'Los Angeles Lakers', index: 1 }), { kind: 'team', sport: 'NBA', team: 'Los Angeles Lakers', index: 1 });
  assert.deepEqual(from({ kind: 'es', index: 0 }), { kind: 'es', index: 0 });
  assert.deepEqual(from({ kind: 'custom', sport: 5, team: { x: 1 }, index: -1 }), { kind: 'custom' });
  assert.equal(from({ kind: 'team', team: 'x'.repeat(200) }).team.length, 80);
  assert.equal(from({ kind: 'logo' }), undefined);
  assert.equal(from('team'), undefined);
  assert.equal(from(null), undefined);
});
// ─── v2: history in Supabase ───────────────────────────────────────────────
const mugBody = extra => createBody({ blank: 'mug', logo: undefined, retail: 17.99, color: 'White', title: 'Showtime Mug', ...extra });
await test('create (mug) writes the design, the product and an event', async () => {
  M.reset(); resetFw(); liveTemplates(); db.reset(); serviceOn(true);
  const r = await call(mugBody());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.history, 'db');
  const sent = fwCalls.find(c => c.path === '/products' && c.method === 'POST').body;
  assert.equal(sent.productTemplateId, LIVE_IDS.mug);
  assert.deepEqual(sent.regions, [{ region: 'default', imageId: 'img_2250', placementStrategy: 'FULL_REGION' }]);
  assert.equal(sent.profitMargin, 12.04);
  const [design] = db.table('frameup_merch_designs');
  assert.equal(design.blank, 'mug');
  assert.equal(design.created_by, 'designer@essentiallysports.com');
  assert.equal(design.concept.collection, 'replay');
  const [prod] = db.table('frameup_merch_products');
  assert.equal(prod.product_id, 'prod_1');
  assert.equal(prod.design_id, design.id);
  assert.equal(prod.state, 'HIDDEN');
  assert.equal(prod.blank, 'mug');
  assert.deepEqual(prod.price, { retail: 17.99, base: 5.95, margin: 12.04 });
  assert.equal(prod.product_url, 'https://shop.essentiallysports.com/products/showtime-tee');
  assert.deepEqual(db.table('frameup_merch_events').map(e => [e.type, e.product_id, e.source]), [['CREATED', 'prod_1', 'frameup']]);
  // A logo area on a one-area blank is refused.
  const logo = await call(mugBody({ logo: { region: 'sleeve_left', imageId: 'img_600' } }));
  assert.equal(logo.status, 400);
});
await test('daily caps count the history table (survive a cold start)', async () => {
  M.reset(); db.reset(); serviceOn(true);
  for (let i = 0; i < 10; i += 1) db.table('frameup_merch_products').push({ product_id: `p${i}`, created_by: 'designer@essentiallysports.com', created_at: new Date().toISOString(), state: 'HIDDEN' });
  const s = await call({ mode: 'status' });
  assert.equal(s.body.history, 'db');
  assert.equal(s.body.caps.person.used, 10);
  assert.equal(s.body.caps.team.used, 10);
  const r = await call(createBody());
  assert.equal(r.status, 429);
  assert.equal(r.body.reason, 'daily-cap');
});
await test('a missing table falls back to memory', async () => {
  M.reset(); resetFw(); db.reset(); serviceOn(true); db.setMissing(true);
  const r = await call(createBody());
  assert.equal(r.status, 200);
  assert.equal(r.body.history, 'memory');
  assert.equal(M.HISTORY[0].productId, 'prod_1');
  db.setMissing(false);
});
await test('publish / hide are recorded', async () => {
  M.reset(); resetFw(); db.reset(); serviceOn(true);
  db.table('frameup_merch_products').push({ product_id: 'prod_1', title: 'Showtime Replay Tee', state: 'HIDDEN', created_by: 'designer@essentiallysports.com', created_at: new Date().toISOString() });
  await call({ mode: 'publish', productId: 'prod_1' });
  let row = db.table('frameup_merch_products')[0];
  assert.equal(row.state, 'PUBLIC');
  assert.ok(row.published_at);
  await call({ mode: 'hide', productId: 'prod_1' });
  row = db.table('frameup_merch_products')[0];
  assert.equal(row.state, 'HIDDEN');
  assert.deepEqual(db.table('frameup_merch_events').map(e => e.type), ['PUBLISHED', 'HIDDEN']);
  assert.equal(db.table('frameup_merch_events')[0].actor, 'designer@essentiallysports.com');
});

// ─── v2: archive (permanent, admins, ours only) ────────────────────────────
await test('archive: admins only, confirm, typed name, FrameUp products only', async () => {
  M.reset(); resetFw(); db.reset(); serviceOn(true);
  fw['DELETE /products/prod_1'] = () => reply(204, null);
  db.table('frameup_merch_products').push({ product_id: 'prod_1', title: 'Showtime Replay Tee', state: 'PUBLIC', created_by: 'designer@essentiallysports.com', created_at: new Date().toISOString() });
  let r = await call({ mode: 'archive', productId: 'prod_1', confirm: true });
  assert.equal(r.status, 403, 'MERCH_PUSHERS is not enough: admins only');
  assert.equal(r.body.reason, 'admin-only');
  admin = true;
  r = await call({ mode: 'archive', productId: 'prod_1' });
  assert.equal(r.body.reason, 'confirm');
  r = await call({ mode: 'archive', productId: 'prod_someone_else', confirm: true });
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, 'not-ours');
  r = await call({ mode: 'archive', productId: 'prod_1', confirm: true, confirmName: 'Showtime' });
  assert.equal(r.body.reason, 'confirm');
  assert.ok(!fwCalls.some(c => c.method === 'DELETE'), 'nothing deleted yet');
  r = await call({ mode: 'archive', productId: 'prod_1', confirm: true, confirmName: 'showtime replay tee' });
  assert.equal(r.status, 200);
  assert.equal(r.body.product.state, 'archived');
  assert.equal(fwCalls.filter(c => c.method === 'DELETE' && c.path === '/products/prod_1').length, 1);
  const row = db.table('frameup_merch_products')[0];
  assert.equal(row.state, 'ARCHIVED');
  assert.ok(row.archived_at);
  assert.equal(db.table('frameup_merch_events').at(-1).type, 'ARCHIVED');
  // Already gone from Fourthwall: still recorded as archived.
  db.table('frameup_merch_products').push({ product_id: 'prod_2', title: 'Gone', state: 'HIDDEN', created_at: new Date().toISOString() });
  fw['DELETE /products/prod_2'] = () => reply(404, { code: 'OFFER_NOT_FOUND_BY_SHOP_ID_AND_ID_ERROR' });
  r = await call({ mode: 'archive', productId: 'prod_2', confirm: true });
  assert.equal(r.status, 200);
  // Without the table: only products this server made (memory).
  serviceOn(false); M.reset();
  r = await call({ mode: 'archive', productId: 'prod_1', confirm: true });
  assert.equal(r.body.reason, 'not-ours');
  M.HISTORY.push({ productId: 'prod_1', title: 'Showtime Replay Tee' });
  r = await call({ mode: 'archive', productId: 'prod_1', confirm: true });
  assert.equal(r.status, 200);
  admin = false;
});

// ─── v2: list ──────────────────────────────────────────────────────────────
const daysAgo = d => new Date(Date.now() - d * 86400000).toISOString();
await test('list: from the history table with 30-day units and revenue', async () => {
  M.reset(); resetFw(); db.reset(); serviceOn(true);
  const P = db.table('frameup_merch_products');
  P.push({ product_id: 'prod_1', title: 'Showtime Replay Tee', state: 'PUBLIC', blank: 'tee', color: 'White', thumb: 'https://cdn/a.png', product_url: 'https://shop/p/1', created_by: 'designer@essentiallysports.com', created_at: daysAgo(3), price: { retail: 29.99 }, collection_ids: ['col_a'] });
  P.push({ product_id: 'prod_2', title: 'Mug', state: 'HIDDEN', blank: 'mug', created_by: 'x@essentiallysports.com', created_at: daysAgo(1) });
  P.push({ product_id: 'prod_3', title: 'Gone', state: 'ARCHIVED', blank: 'tee', created_at: daysAgo(0) });
  db.table('frameup_merch_orders').push({ order_id: 'o1', status: 'CONFIRMED', placed_at: daysAgo(2), test_mode: false, product_ids: ['prod_1'], lines: [{ productId: 'prod_1', quantity: 2, revenue: 59.98 }] });
  db.table('frameup_merch_orders').push({ order_id: 'o2', status: 'CONFIRMED', placed_at: daysAgo(45), test_mode: false, product_ids: ['prod_1'], lines: [{ productId: 'prod_1', quantity: 1, revenue: 29.99 }] });
  const r = await call({ mode: 'list' });
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'db');
  assert.deepEqual(r.body.products.map(p => p.productId), ['prod_2', 'prod_1'], 'newest first, archived hidden');
  const p1 = r.body.products[1];
  assert.deepEqual({ ...p1 }, { productId: 'prod_1', title: 'Showtime Replay Tee', url: 'https://shop/p/1', state: 'public', thumb: 'https://cdn/a.png', blank: 'tee', color: 'White', createdAt: p1.createdAt, createdBy: 'designer@essentiallysports.com', units30: 2, revenue30: 59.98, price: 29.99, collectionIds: ['col_a'] });
  assert.equal(r.body.products[0].units30, 0);
  // Anyone signed in can list (no push rights needed).
  process.env.MERCH_PUSHERS = '';
  assert.equal((await call({ mode: 'list' })).status, 200);
  process.env.MERCH_PUSHERS = 'designer@essentiallysports.com';
});
await test('list: falls back to Fourthwall, only products this server made', async () => {
  M.reset(); resetFw(); serviceOn(false);
  fw['GET /products'] = () => reply(200, { results: [offer('PUBLIC'), { ...offer('HIDDEN'), id: 'not_ours', slug: 'other' }], total: 2, page: 0, size: 100, totalPages: 1 });
  M.HISTORY.push({ productId: 'prod_1', title: 'Showtime Replay Tee', blank: 'tee', color: 'White', by: 'designer@essentiallysports.com', at: '2026-11-25T00:00:00Z' });
  const r = await call({ mode: 'list' });
  assert.equal(r.body.source, 'fourthwall');
  assert.deepEqual(r.body.products.map(p => [p.productId, p.state, p.blank, p.url]), [['prod_1', 'public', 'tee', 'https://shop.essentiallysports.com/products/showtime-tee']]);
  assert.match(r.body.note, /migration/);
});

// ─── v2: collections ───────────────────────────────────────────────────────
await test('collections: list with counts, create, set (read-modify-write)', async () => {
  M.reset(); resetFw(); db.reset(); serviceOn(true);
  const cols = { col_a: ['p_other'], col_b: ['prod_1', 'p2'] };
  fw['GET /collections'] = () => reply(200, { results: [{ id: 'col_a', name: 'Replay', slug: 'replay' }, { id: 'col_b', name: 'Core', slug: 'core' }], total: 2 });
  fw['GET /collections/col_a'] = () => reply(200, { id: 'col_a', name: 'Replay', slug: 'replay', offerIds: cols.col_a.slice() });
  fw['GET /collections/col_b'] = () => reply(200, { id: 'col_b', name: 'Core', slug: 'core', offerIds: cols.col_b.slice() });
  for (const id of ['col_a', 'col_b']) fw[`PUT /collections/${id}/products`] = (u, o) => { cols[id] = JSON.parse(o.body).offerIds; return reply(200, { id, offerIds: cols[id] }); };
  fw['POST /collections'] = (u, o) => reply(200, { id: 'col_new', name: JSON.parse(o.body).name, slug: 'new-drop', offerIds: [] });
  db.table('frameup_merch_products').push({ product_id: 'prod_1', title: 'T', state: 'HIDDEN', created_at: daysAgo(0) });
  let r = await call({ mode: 'collections' });
  assert.deepEqual(r.body.collections, [{ id: 'col_a', name: 'Replay', slug: 'replay', count: 1 }, { id: 'col_b', name: 'Core', slug: 'core', count: 2 }]);
  r = await call({ mode: 'collection-set', productId: 'prod_1', collectionIds: ['col_a'] });
  assert.equal(r.status, 200);
  assert.deepEqual(cols, { col_a: ['p_other', 'prod_1'], col_b: ['p2'] }, 'other products kept');
  assert.deepEqual(r.body.changed.sort(), ['col_a', 'col_b']);
  assert.deepEqual(r.body.collections.map(c => [c.id, c.count, c.has]), [['col_a', 2, true], ['col_b', 1, false]]);
  const puts = fwCalls.filter(c => c.method === 'PUT' && c.path.startsWith('/collections/'));
  puts.forEach(p => { const at = fwCalls.indexOf(p); assert.ok(fwCalls.slice(0, at).some(c => c.method === 'GET' && c.path === p.path.replace('/products', '')), 'read before write'); });
  assert.deepEqual(db.table('frameup_merch_products')[0].collection_ids, ['col_a']);
  assert.equal(db.table('frameup_merch_events').at(-1).type, 'COLLECTIONS_SET');
  // No change: no writes.
  const n = fwCalls.filter(c => c.method === 'PUT').length;
  await call({ mode: 'collection-set', productId: 'prod_1', collectionIds: ['col_a'] });
  assert.equal(fwCalls.filter(c => c.method === 'PUT').length, n);
  assert.equal((await call({ mode: 'collection-set', productId: 'prod_1', collectionIds: ['col_zzz'] })).status, 400);
  assert.equal((await call({ mode: 'collection-set', productId: 'prod_1', collectionIds: 'col_a' })).status, 400);
  r = await call({ mode: 'collection-create', name: 'New Drop' });
  assert.deepEqual(r.body.collection, { id: 'col_new', name: 'New Drop', slug: 'new-drop', count: 0 });
  assert.deepEqual(fwCalls.find(c => c.method === 'POST' && c.path === '/collections').body, { name: 'New Drop', description: '', offerIds: [] });
  r = await call({ mode: 'collection-create', name: 'replay' });
  assert.equal(r.body.existed, true);
  assert.equal(r.body.collection.id, 'col_a');
  assert.equal((await call({ mode: 'collection-create', name: 'x' })).status, 400);
  process.env.MERCH_PUSHERS = '';
  assert.equal((await call({ mode: 'collection-set', productId: 'prod_1', collectionIds: [] })).status, 403);
  assert.equal((await call({ mode: 'collections' })).status, 200, 'anyone can read collections');
  process.env.MERCH_PUSHERS = 'designer@essentiallysports.com';
});

// ─── v2: sales ─────────────────────────────────────────────────────────────
await test('sales: 7 / 30 days / all time; cancelled and test orders excluded', async () => {
  M.reset(); resetFw(); db.reset(); serviceOn(true);
  db.table('frameup_merch_products').push({ product_id: 'prod_1', title: 'T', state: 'PUBLIC', created_at: daysAgo(100) }, { product_id: 'prod_2', title: 'M', state: 'ARCHIVED', created_at: daysAgo(100) });
  const O = db.table('frameup_merch_orders');
  O.push({ order_id: 'o1', status: 'CONFIRMED', placed_at: daysAgo(2), updated_at: daysAgo(2), test_mode: false, product_ids: ['prod_1'], lines: [{ productId: 'prod_1', quantity: 2, revenue: 59.98 }] });
  O.push({ order_id: 'o2', status: 'SHIPPED', placed_at: daysAgo(20), updated_at: daysAgo(1), test_mode: false, product_ids: ['prod_1', 'prod_2'], lines: [{ productId: 'prod_1', quantity: 1, revenue: 29.99 }, { productId: 'prod_2', quantity: 3, revenue: 53.97 }, { productId: 'not_ours', quantity: 9, revenue: 99 }] });
  O.push({ order_id: 'o3', status: 'DELIVERED', placed_at: daysAgo(90), updated_at: daysAgo(80), test_mode: false, product_ids: ['prod_1'], lines: [{ productId: 'prod_1', quantity: 1, revenue: 29.99 }] });
  O.push({ order_id: 'o4', status: 'CANCELLED', placed_at: daysAgo(1), updated_at: daysAgo(1), test_mode: false, product_ids: ['prod_1'], lines: [{ productId: 'prod_1', quantity: 5, revenue: 149.95 }] });
  O.push({ order_id: 'o5', status: 'CONFIRMED', placed_at: daysAgo(1), updated_at: daysAgo(1), test_mode: true, product_ids: ['prod_1'], lines: [{ productId: 'prod_1', quantity: 7, revenue: 1 }] });
  db.table('frameup_merch_events').push({ id: 'sync_1', source: 'sync', type: 'SYNC', created_at: daysAgo(0.5), payload: {} });
  let r = await call({ mode: 'sales' });
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'db');
  const by = Object.fromEntries(r.body.products.map(p => [p.productId, p]));
  assert.deepEqual(by.prod_1, { productId: 'prod_1', units7: 2, revenue7: 59.98, units30: 3, revenue30: 89.97, unitsAll: 4, revenueAll: 119.96 });
  assert.deepEqual(by.prod_2, { productId: 'prod_2', units7: 0, revenue7: 0, units30: 3, revenue30: 53.97, unitsAll: 3, revenueAll: 53.97 });
  assert.ok(!by.not_ours, 'only our products');
  assert.equal(r.body.updatedAt, db.table('frameup_merch_events')[0].created_at, 'the last sync is newer than any order');
  r = await call({ mode: 'sales', productId: 'prod_2' });
  assert.deepEqual(r.body.products.map(p => p.productId), ['prod_2']);
  serviceOn(false);
  r = await call({ mode: 'sales' });
  assert.deepEqual([r.body.source, r.body.products.length], ['none', 0]);
});

// ─── v2: upload relay ──────────────────────────────────────────────────────
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 7)]);
const GCS = 'https://storage.googleapis.com/fw-upload/abc?X-Goog-Signature=1';
await test('upload-relay: own folder, Google storage only, size and PNG checked, copy deleted', async () => {
  M.reset(); resetFw(); db.reset(); serviceOn(true); gcsPuts.length = 0;
  const path = `${USER_ID}/showtime.png`;
  db.objects.set(`merch-art/${path}`, PNG);
  const relay = extra => call({ mode: 'upload-relay', path, uploadUrl: GCS, size: PNG.length, ...extra });
  for (const bad of ['https://evil.example.com/x', 'http://storage.googleapis.com/x', 'https://storage.googleapis.com.evil.com/x', 'https://user:pw@storage.googleapis.com/x', 'https://169.254.169.254/latest']) {
    const r = await relay({ uploadUrl: bad });
    assert.equal(r.status, 400, bad);
  }
  assert.equal((await relay({ path: '0b4f6a2e-1c3d-4e5f-8a9b-ffffffffffff/showtime.png' })).status, 403, 'another person\'s folder');
  assert.equal((await relay({ path: `${USER_ID}/../x.png` })).status, 400);
  assert.equal((await relay({ size: PNG.length + 1 })).body.reason, 'size');
  db.objects.set(`merch-art/${USER_ID}/fake.png`, Buffer.from('GIF89a not a png at all'));
  assert.equal((await relay({ path: `${USER_ID}/fake.png`, size: 23 })).status, 400);
  assert.equal((await relay({ path: `${USER_ID}/missing.png` })).status, 404);
  assert.equal(gcsPuts.length, 0, 'nothing sent on a refused relay');
  const r = await relay();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, size: PNG.length });
  assert.equal(gcsPuts.length, 1);
  assert.equal(gcsPuts[0].href, GCS);
  assert.equal(gcsPuts[0].headers['x-goog-content-length-range'], `0,${PNG.length}`);
  assert.equal(gcsPuts[0].headers['Content-Type'], 'image/png');
  assert.equal(gcsPuts[0].headers.Authorization, undefined, 'no Fourthwall credentials to Google storage');
  assert.ok(!db.objects.has(`merch-art/${path}`), 'the relay copy is deleted');
  serviceOn(false);
  assert.equal((await relay()).status, 503);
  process.env.MERCH_PUSHERS = '';
  assert.equal((await relay()).status, 403);
  process.env.MERCH_PUSHERS = 'designer@essentiallysports.com';
});

// ─── v2: product refresh ───────────────────────────────────────────────────
await test('product refresh stores the latest mockups, variants, price and state', async () => {
  M.reset(); resetFw(); db.reset(); serviceOn(true);
  db.table('frameup_merch_products').push({ product_id: 'prod_1', title: 'Old', state: 'HIDDEN', blank: 'tee', color: 'White', created_by: 'designer@essentiallysports.com', created_at: daysAgo(1), thumb: '' });
  fw['GET /products/prod_1'] = () => reply(200, offer('PUBLIC'));
  const r = await call({ mode: 'product', productId: 'prod_1', refresh: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.refreshed, true);
  assert.equal(r.body.history, 'db');
  assert.equal(r.body.product.state, 'PUBLIC');
  assert.equal(r.body.product.blank, 'tee');
  const row = db.table('frameup_merch_products')[0];
  assert.equal(row.state, 'PUBLIC');
  assert.equal(row.thumb, 'https://cdn/a-t.png');
  assert.equal(row.title, 'Showtime Tee');
  assert.deepEqual(row.price, { retail: 21.99, base: 9.5, margin: 12.49 });
  assert.equal(row.variants[0].price, 21.99);
  assert.ok(row.refreshed_at);
  assert.equal(db.table('frameup_merch_events').at(-1).type, 'REFRESHED');
  // Without refresh nothing is written.
  const n = db.calls.length;
  await call({ mode: 'product', productId: 'prod_1' });
  assert.equal(db.calls.length, n);
  serviceOn(false);
});

// ─── v2: migration ─────────────────────────────────────────────────────────
await test('migration: four tables with RLS, read-only for ES users, private merch-art bucket', () => {
  const sql = fs.readFileSync('supabase/migrations/20261126120000_frameup_merch.sql', 'utf8');
  for (const t of ['frameup_merch_designs', 'frameup_merch_products', 'frameup_merch_orders', 'frameup_merch_events']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${t}`));
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(sql, new RegExp(`grant select on table public\\.${t} to authenticated`));
    assert.ok(!new RegExp(`grant (insert|update|delete|all)[^;]*public\\.${t}`, 'i').test(sql), `${t}: browser cannot write`);
  }
  assert.match(sql, /'merch-art', 'merch-art', false/);
  assert.match(sql, /storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/);
  assert.ok(!/\b(email|username|billing|shipping|address)\b\s+text/i.test(sql), 'no buyer personal data columns');
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

await test('create keeps an explicit hex row as drawn', async () => {
  M.reset(); resetFw(); liveTemplates(); db.reset(); serviceOn(true); queue = testQueue();
  const r = await call(mugBody({ concept: { ...good, stack: [hexRow, good.stack[1]], paletteFrom: { kind: 'custom' } } }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [design] = db.table('frameup_merch_designs');
  assert.equal(design.concept.stack[0].fill, '#E4002B');
  assert.deepEqual(design.concept.paletteFrom, { kind: 'custom' });
});

process.stdout.write(`test-merch: ${passed} tests passed\n`);
