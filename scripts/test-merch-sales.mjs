#!/usr/bin/env node
// Merch sales: the Fourthwall webhook (netlify/functions/fourthwall-webhook.js
// + api/fourthwall-webhook.js), order aggregation (_fourthwall.normalizeOrder,
// _merch-store.aggregateSales) and the daily merch-sync cron. Every network
// call is mocked: no Fourthwall, no Supabase.
//   webhook: no secret -> 503; signature valid / invalid / missing / body
//   changed; replayed event ignored (memory and database); unknown types
//   ignored; orders kept only for our products, never buyer data; stale
//   updates ignored; product updates refresh our row; store down -> 503.
//   sync: CRON_SECRET gate, pages of orders since the last update, products
//   refreshed, gone products archived, the run recorded.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { createFakeDb } from './fixtures/fake-merch-db.mjs';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const P = {
  hook: path.join(fnDir, 'fourthwall-webhook.js'),
  sync: path.join(fnDir, 'merch-sync.js'),
  store: path.join(fnDir, '_merch-store.js'),
  fw: path.join(fnDir, '_fourthwall.js'),
  rest: path.join(fnDir, '_supabase-rest.js'),
  auth: path.join(fnDir, '_supabase-auth.js'),
  apiHook: path.resolve('api/fourthwall-webhook.js'),
  apiSync: path.resolve('api/merch-sync.js'),
};
const SECRET = 'whsec-test-SECRET-xyz';
const CRON = 'cron-test-SECRET-abc';
const logs = [];
for (const k of ['log', 'warn', 'error', 'info']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { logs.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); if (process.env.MERCH_TEST_VERBOSE) orig(...a); };
}

// ─── Mocks ─────────────────────────────────────────────────────────────────
const reply = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: k => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => (body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body)) });
const db = createFakeDb();
let fw = {};
let fwCalls = [];
let dbDown = false;
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.startsWith('https://db.example.supabase.co/')) {
    if (dbDown) throw new Error('connect ECONNREFUSED');
    return db.handle(href, options);
  }
  if (href.startsWith('https://api.fourthwall.com/open-api/v1.0')) {
    const u = new URL(href);
    const p = u.pathname.slice('/open-api/v1.0'.length);
    const method = options.method || 'GET';
    fwCalls.push({ method, path: p, query: Object.fromEntries(u.searchParams), headers: options.headers || {} });
    const h = fw[`${method} ${p}`];
    return h ? h(u, options) : reply(404, { code: 'NOT_MOCKED' });
  }
  throw new Error(`unexpected fetch ${href}`);
};
Object.values(P).forEach(p => delete require.cache[p]);
require.cache[P.auth] = { id: P.auth, filename: P.auth, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: () => '', verifyEsUser: async () => ({ ok: false, statusCode: 401 }),
} };
for (const k of ['FOURTHWALL_WEBHOOK_SECRET', 'CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'FOURTHWALL_API_USERNAME', 'FOURTHWALL_API_PASSWORD']) delete process.env[k];
const FW = require(P.fw);
const store = require(P.store);
const { handler: hook, _test: H } = require(P.hook);
const { handler: sync, _test: S } = require(P.sync);
const apiHook = require(P.apiHook);
S.setClientFactory(() => FW.createClient({ sleep: async () => {}, random: () => 0.5, queue: FW.createQueue() }));

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed += 1; } catch (error) { process.stderr.write(`FAIL ${name}\n`); throw error; }
};
const daysAgo = d => new Date(Date.now() - d * 86400000).toISOString();
const sign = (body, secret = SECRET) => crypto.createHmac('sha256', secret).update(body).digest('base64');
const deliver = async (payload, { secret = SECRET, signature, base64 = false, method = 'POST' } = {}) => {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const res = await hook({ httpMethod: method, headers: { 'X-Fourthwall-Hmac-SHA256': signature ?? sign(body, secret), 'content-type': 'application/json' }, body: base64 ? Buffer.from(body).toString('base64') : body, isBase64Encoded: base64 });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};
const BUYER = { email: 'fan@example.com', username: 'FanUser42', message: 'Happy birthday Sam', billing: { address: { name: 'Sam Fan', address1: '1 Main St', city: 'Springfield', zip: '12345' } }, shipping: { address: { name: 'Sam Fan', address1: '1 Main St' } } };
const orderData = (id, lines, extra = {}) => ({
  id, shopId: 'sh_1', friendlyId: `F${id}`, checkoutId: 'ch_1', status: 'CONFIRMED', emailMarketingOptIn: true, ...BUYER,
  amounts: { subtotal: { value: 59.98, currency: 'USD' }, total: { value: 70.5, currency: 'USD' }, shipping: { value: 5, currency: 'USD' }, tax: { value: 5.52, currency: 'USD' }, discount: { value: 0, currency: 'USD' }, donation: { value: 0, currency: 'USD' }, giftCards: [] },
  offers: lines.map(([productId, quantity, unit], i) => ({ id: productId, name: `Product ${productId}`, slug: productId, description: '', variant: { id: `var_${productId}_${i}`, name: 'White, L', sku: 'S', quantity, unitPrice: { value: unit, currency: 'USD' }, unitCost: { value: 15.85, currency: 'USD' }, price: { value: unit * quantity, currency: 'USD' }, attributes: {}, weight: {}, dimensions: {} } })),
  source: { type: 'ORDER' }, createdAt: daysAgo(1), updatedAt: daysAgo(1), ...extra,
});
const event = (id, type, data, extra = {}) => ({ testMode: false, id, webhookId: 'wcon_1', shopId: 'sh_1', type, apiVersion: 'V1', createdAt: new Date().toISOString(), data, ...extra });
const seedOurs = () => {
  db.table('frameup_merch_products').push(
    { product_id: 'prod_1', title: 'Showtime Tee', state: 'PUBLIC', blank: 'tee', created_at: daysAgo(10), product_url: 'https://shop/p/1' },
    { product_id: 'prod_2', title: 'Showtime Mug', state: 'HIDDEN', blank: 'mug', created_at: daysAgo(5) },
  );
};
const fresh = () => { db.reset(); H.reset(); dbDown = false; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-test'; process.env.FOURTHWALL_WEBHOOK_SECRET = SECRET; seedOurs(); };

// ─── Webhook: signature ───────────────────────────────────────────────────
await test('webhook: no secret configured -> 503, nothing stored', async () => {
  fresh(); delete process.env.FOURTHWALL_WEBHOOK_SECRET;
  const r = await deliver(event('wev_1', 'ORDER_PLACED', orderData('ord_1', [['prod_1', 1, 29.99]])), { secret: 'anything' });
  assert.equal(r.status, 503);
  assert.equal(r.body.reason, 'not-configured');
  assert.equal(db.calls.length, 0);
});
await test('webhook: valid signature stores the order (our lines only, no buyer data)', async () => {
  fresh();
  const r = await deliver(event('wev_1', 'ORDER_PLACED', orderData('ord_1', [['prod_1', 2, 29.99], ['someone_elses', 1, 40]])));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.ok, r.body.stored, r.body.type], [true, true, 'ORDER_PLACED']);
  const [o] = db.table('frameup_merch_orders');
  assert.equal(o.order_id, 'ord_1');
  assert.equal(o.status, 'CONFIRMED');
  assert.equal(o.source, 'webhook');
  assert.deepEqual(o.product_ids, ['prod_1']);
  assert.deepEqual(o.lines.map(l => [l.productId, l.quantity, l.revenue, l.cost]), [['prod_1', 2, 59.98, 31.7]]);
  const [e] = db.table('frameup_merch_events');
  assert.deepEqual([e.id, e.source, e.type, e.order_id], ['wev_1', 'fourthwall', 'ORDER_PLACED', 'ord_1']);
  const everything = JSON.stringify([...db.tables.values()]);
  for (const pii of ['fan@example.com', 'FanUser42', 'Happy birthday', 'Sam Fan', '1 Main St', 'Springfield']) assert.ok(!everything.includes(pii), `no buyer data stored (${pii})`);
});
await test('webhook: invalid, missing, wrong-secret and tampered signatures -> 401', async () => {
  fresh();
  const p = event('wev_2', 'ORDER_PLACED', orderData('ord_2', [['prod_1', 1, 29.99]]));
  const body = JSON.stringify(p);
  assert.equal((await deliver(p, { signature: 'bm90IGEgc2lnbmF0dXJl' })).status, 401);
  assert.equal((await deliver(p, { signature: '' })).status, 401);
  assert.equal((await deliver(p, { secret: 'other-secret' })).status, 401);
  // Same signature, one byte changed (a doubled quantity).
  const tampered = body.replace('"quantity":1', '"quantity":9');
  assert.notEqual(tampered, body);
  assert.equal((await deliver(tampered, { signature: sign(body) })).status, 401);
  // The signature is over the raw bytes: re-serialised JSON with other spacing fails.
  assert.equal((await deliver(JSON.stringify(p, null, 2), { signature: sign(body) })).status, 401);
  assert.equal(db.calls.length, 0, 'nothing read or written before the signature check');
  assert.equal((await deliver(p, { method: 'GET' })).status, 405);
});
await test('webhook: a replayed event changes nothing (memory and database de-dup)', async () => {
  fresh();
  const first = event('wev_3', 'ORDER_PLACED', orderData('ord_3', [['prod_1', 1, 29.99]]));
  assert.equal((await deliver(first)).body.stored, true);
  const writes = () => db.calls.filter(c => c.method !== 'GET').length;
  const n = writes();
  let r = await deliver(first);
  assert.deepEqual([r.status, r.body.duplicate], [200, true]);
  assert.equal(writes(), n, 'in-memory replay: no writes');
  H.reset(); // a cold start: only the database knows
  r = await deliver(first);
  assert.deepEqual([r.status, r.body.duplicate], [200, true]);
  assert.equal(writes(), n, 'database replay: no writes');
  // A replay of an old update can't roll the status back either.
  const shipped = event('wev_4', 'ORDER_UPDATED', orderData('ord_3', [['prod_1', 1, 29.99]], { status: 'SHIPPED', updatedAt: daysAgo(0.5) }));
  await deliver(shipped);
  H.reset();
  r = await deliver(first);
  assert.equal(r.body.duplicate, true);
  assert.equal(db.table('frameup_merch_orders')[0].status, 'SHIPPED');
  assert.equal(db.table('frameup_merch_events').length, 2);
});
await test('webhook: base64 bodies (the Vercel adapter) verify on the decoded bytes', async () => {
  fresh();
  const r = await deliver(event('wev_5', 'ORDER_PLACED', orderData('ord_5', [['prod_2', 1, 17.99]])), { base64: true });
  assert.equal(r.status, 200);
  assert.equal(db.table('frameup_merch_orders')[0].order_id, 'ord_5');
});
await test('webhook: api adapter reads the raw stream and passes the exact bytes', async () => {
  fresh();
  const body = JSON.stringify(event('wev_6', 'ORDER_PLACED', orderData('ord_6', [['prod_1', 1, 29.99]])));
  const request = {
    method: 'POST', headers: { 'x-fourthwall-hmac-sha256': sign(body) }, query: {}, readableEnded: false,
    async *[Symbol.asyncIterator]() { yield Buffer.from(body.slice(0, 50)); yield Buffer.from(body.slice(50)); },
  };
  const out = { headers: {}, code: 0, sent: '' };
  const response = { setHeader: (k, v) => { out.headers[k] = v; }, status(c) { out.code = c; return this; }, send(b) { out.sent = b; return this; }, json(b) { out.sent = JSON.stringify(b); return this; } };
  await apiHook(request, response);
  assert.equal(out.code, 200, out.sent);
  assert.equal(JSON.parse(out.sent).stored, true);
  assert.deepEqual(apiHook.config, { api: { bodyParser: false } });
  // A body Vercel already parsed into an object is not re-encoded: it fails the check.
  const parsed = { method: 'POST', headers: { 'x-fourthwall-hmac-sha256': sign(body) }, query: {}, readableEnded: true, body: JSON.parse(body) };
  await apiHook(parsed, response);
  assert.equal(out.code, 401);
});
await test('webhook: other event types are ignored; orders without our products are not kept', async () => {
  fresh();
  let r = await deliver(event('wev_7', 'DONATION', { id: 'don_1', email: 'fan@example.com' }));
  assert.deepEqual([r.status, r.body.ignored], [200, true]);
  assert.equal(db.calls.length, 0);
  r = await deliver(event('wev_8', 'ORDER_PLACED', orderData('ord_8', [['someone_elses', 3, 40]])));
  assert.deepEqual([r.status, r.body.stored], [200, false]);
  assert.equal(db.table('frameup_merch_orders').length, 0);
  assert.equal(db.table('frameup_merch_events')[0].payload.reason, 'not-ours', 'still recorded, so a replay is a duplicate');
  assert.equal((await deliver(event('x', 'ORDER_PLACED', {}))).status, 400, 'event id required');
  assert.equal((await deliver('not json')).status, 400);
});
await test('webhook: ORDER_UPDATED updates the status; an older update is ignored', async () => {
  fresh();
  await deliver(event('wev_9', 'ORDER_PLACED', orderData('ord_9', [['prod_1', 1, 29.99]], { updatedAt: daysAgo(2) })));
  await deliver(event('wev_10', 'ORDER_UPDATED', orderData('ord_9', [['prod_1', 1, 29.99]], { status: 'DELIVERED', updatedAt: daysAgo(0.2) })));
  assert.equal(db.table('frameup_merch_orders')[0].status, 'DELIVERED');
  const r = await deliver(event('wev_11', 'ORDER_UPDATED', orderData('ord_9', [['prod_1', 1, 29.99]], { status: 'IN_PRODUCTION', updatedAt: daysAgo(1) })));
  assert.equal(r.body.stored, false);
  assert.equal(db.table('frameup_merch_orders')[0].status, 'DELIVERED');
  await deliver(event('wev_12', 'ORDER_UPDATED', orderData('ord_9', [['prod_1', 1, 29.99]], { status: 'CANCELLED', updatedAt: daysAgo(0.1) })));
  assert.equal(db.table('frameup_merch_orders')[0].status, 'CANCELLED');
});
await test('webhook: PRODUCT_UPDATED refreshes our product only', async () => {
  fresh();
  const offer = { id: 'prod_2', name: 'Showtime Mug', slug: 'showtime-mug', access: { type: 'PUBLIC' }, state: { type: 'AVAILABLE' }, thumbnailImage: { url: 'https://cdn/m.png' }, images: [{ url: 'https://cdn/m.png', width: 10, height: 10 }], variants: [{ id: 'v1', name: '11oz', unitPrice: { value: 17.99, currency: 'USD' }, unitCost: { value: 5.95, currency: 'USD' } }] };
  let r = await deliver(event('wev_13', 'PRODUCT_UPDATED', offer));
  assert.equal(r.body.stored, true);
  const row = db.table('frameup_merch_products').find(p => p.product_id === 'prod_2');
  assert.equal(row.state, 'PUBLIC');
  assert.equal(row.thumb, 'https://cdn/m.png');
  assert.deepEqual(row.price, { retail: 17.99, base: 5.95, margin: 12.04 });
  r = await deliver(event('wev_14', 'PRODUCT_CREATED', { ...offer, id: 'made_elsewhere' }));
  assert.equal(r.body.stored, false);
  assert.ok(!db.table('frameup_merch_products').some(p => p.product_id === 'made_elsewhere'));
});
await test('webhook: history unavailable -> 503, and the retry is stored later', async () => {
  fresh(); delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const p = event('wev_15', 'ORDER_PLACED', orderData('ord_15', [['prod_1', 1, 29.99]]));
  assert.equal((await deliver(p)).status, 503);
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-test';
  dbDown = true;
  assert.equal((await deliver(p)).status, 503);
  dbDown = false;
  db.setMissing(true);
  assert.equal((await deliver(p)).status, 503, 'migration not run');
  db.setMissing(false);
  const r = await deliver(p);
  assert.deepEqual([r.status, r.body.stored], [200, true], 'Fourthwall retry succeeds');
});

// ─── Order aggregation ────────────────────────────────────────────────────
await test('orders: normalised without buyer data; revenue = unit price x units', () => {
  const o = FW.normalizeOrder(orderData('ord_x', [['prod_1', 3, 29.99]]));
  assert.deepEqual(Object.keys(o).sort(), ['currency', 'friendlyId', 'lines', 'orderId', 'placedAt', 'status', 'subtotal', 'updatedAt']);
  assert.deepEqual(o.lines[0], { productId: 'prod_1', variantId: 'var_prod_1_0', name: 'Product prod_1', variant: 'White, L', quantity: 3, revenue: 89.97, cost: 47.55, currency: 'USD' });
  assert.ok(!JSON.stringify(o).includes('fan@example.com'));
  // No unit price: the line price is used.
  const noUnit = orderData('ord_y', [['prod_1', 2, 10]]);
  delete noUnit.offers[0].variant.unitPrice;
  assert.equal(FW.normalizeOrder(noUnit).lines[0].revenue, 20);
});
await test('sales: 7 / 30 / all-time windows, cancelled and test orders excluded', () => {
  const orders = [
    { order_id: 'a', status: 'CONFIRMED', placed_at: daysAgo(1), lines: [{ productId: 'p1', quantity: 2, revenue: 59.98 }, { productId: 'p2', quantity: 1, revenue: 17.99 }] },
    { order_id: 'b', status: 'SHIPPED', placed_at: daysAgo(8), lines: [{ productId: 'p1', quantity: 1, revenue: 29.99 }] },
    { order_id: 'c', status: 'DELIVERED', placed_at: daysAgo(31), lines: [{ productId: 'p1', quantity: 4, revenue: 119.96 }] },
    { order_id: 'd', status: 'CANCELLED', placed_at: daysAgo(1), lines: [{ productId: 'p1', quantity: 50, revenue: 1499.5 }] },
    { order_id: 'e', status: 'CONFIRMED', test_mode: true, placed_at: daysAgo(1), lines: [{ productId: 'p1', quantity: 9, revenue: 9 }] },
  ];
  const all = Object.fromEntries(store.aggregateSales(orders).map(r => [r.productId, r]));
  assert.deepEqual(all.p1, { productId: 'p1', units7: 2, revenue7: 59.98, units30: 3, revenue30: 89.97, unitsAll: 7, revenueAll: 209.93 });
  assert.deepEqual(all.p2, { productId: 'p2', units7: 1, revenue7: 17.99, units30: 1, revenue30: 17.99, unitsAll: 1, revenueAll: 17.99 });
  const some = store.aggregateSales(orders, { productIds: ['p2', 'p3'] });
  assert.deepEqual(some.map(r => [r.productId, r.unitsAll]), [['p2', 1], ['p3', 0]], 'asked-for products with no sales show zeros');
  // Float sums stay at cents.
  const many = Array.from({ length: 30 }, (_, i) => ({ status: 'CONFIRMED', placed_at: daysAgo(0), lines: [{ productId: 'p', quantity: 1, revenue: 0.1 }] }));
  assert.equal(store.aggregateSales(many)[0].revenueAll, 3);
});

// ─── merch-sync cron ──────────────────────────────────────────────────────
const cronCall = async (headers = {}, query = {}) => {
  const res = await sync({ httpMethod: 'GET', headers, queryStringParameters: query });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};
const bearer = { authorization: `Bearer ${CRON}` };
const fwOn = () => { process.env.FOURTHWALL_API_USERNAME = 'u'; process.env.FOURTHWALL_API_PASSWORD = 'p'; };
const offerFull = (id, access) => ({ id, name: `Name ${id}`, slug: `slug-${id}`, access: { type: access }, state: { type: 'AVAILABLE' }, images: [{ url: `https://cdn/${id}.png` }], variants: [{ id: 'v', name: 'S', unitPrice: { value: 29.99, currency: 'USD' }, unitCost: { value: 15.85, currency: 'USD' } }] });
await test('sync: CRON_SECRET gate (503 without it, 401 wrong, Bearer or x-cron-secret)', async () => {
  fresh(); fwCalls = []; fw = {};
  assert.equal((await cronCall(bearer)).status, 503);
  process.env.CRON_SECRET = CRON;
  assert.equal((await cronCall()).status, 401);
  assert.equal((await cronCall({ authorization: 'Bearer nope' })).status, 401);
  assert.equal((await cronCall({ authorization: `Bearer ${CRON}x` })).status, 401);
  assert.equal((await sync({ httpMethod: 'DELETE', headers: bearer })).statusCode, 405);
  // Authorised but Fourthwall not set up: a calm skip.
  delete process.env.FOURTHWALL_API_USERNAME; delete process.env.FOURTHWALL_API_PASSWORD;
  let r = await cronCall(bearer);
  assert.deepEqual([r.status, r.body.skipped], [200, 'fourthwall-not-set-up']);
  fwOn(); delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  r = await cronCall({ 'x-cron-secret': CRON });
  assert.deepEqual([r.status, r.body.skipped], [200, 'history-not-set-up']);
  assert.equal(fwCalls.length, 0);
  assert.ok(S.cronAuthorized(bearer, CRON) && !S.cronAuthorized(bearer, ''));
});
await test('sync: orders since the last update, ours only; products refreshed; gone ones archived; run recorded', async () => {
  fresh(); fwOn(); process.env.CRON_SECRET = CRON; fwCalls = [];
  db.table('frameup_merch_products').push({ product_id: 'prod_3', title: 'Old', state: 'ARCHIVED', blank: 'tee', created_at: daysAgo(40) });
  const lastUpdate = daysAgo(3);
  db.table('frameup_merch_orders').push({ order_id: 'ord_old', status: 'DELIVERED', placed_at: daysAgo(20), fw_updated_at: lastUpdate, lines: [], product_ids: [] });
  const page0 = Array.from({ length: 100 }, (_, i) => orderData(`o${i}`, [[i % 2 ? 'prod_1' : 'someone_elses', 1, 29.99]]));
  const page1 = [orderData('o100', [['prod_3', 2, 29.99], ['someone_elses', 1, 5]], { status: 'SHIPPED' })];
  fw = {
    'GET /shops/current': () => reply(200, { publicDomain: 'shop.essentiallysports.com' }),
    'GET /order': u => reply(200, { results: u.searchParams.get('page') === '0' ? page0 : page1, total: 101, page: Number(u.searchParams.get('page')), size: 100, totalPages: 2 }),
    'GET /products/prod_1': () => reply(200, offerFull('prod_1', 'PUBLIC')),
    'GET /products/prod_2': () => reply(404, { code: 'OFFER_NOT_FOUND_BY_SHOP_ID_AND_ID_ERROR' }),
  };
  const r = await cronCall(bearer);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const orderCalls = fwCalls.filter(c => c.path === '/order');
  assert.equal(orderCalls.length, 2, 'stops after the last page');
  assert.equal(orderCalls[0].query['updatedAt[gt]'], new Date(Date.parse(lastUpdate) - 3600000).toISOString(), 'since = last stored update minus an hour');
  assert.equal(orderCalls[0].query.size, '100');
  assert.deepEqual([r.body.orders.seen, r.body.orders.stored], [101, 51]);
  const stored = db.table('frameup_merch_orders').filter(o => o.source === 'sync');
  assert.equal(stored.length, 51, '50 orders with prod_1 + the archived prod_3 order');
  assert.ok(stored.every(o => o.lines.every(l => l.productId !== 'someone_elses')), 'only our lines');
  assert.ok(!JSON.stringify(stored).includes('fan@example.com'));
  // Products: archived ones are not re-read; prod_1 refreshed; prod_2 gone -> ARCHIVED.
  assert.deepEqual(fwCalls.filter(c => c.path.startsWith('/products/')).map(c => c.path).sort(), ['/products/prod_1', '/products/prod_2']);
  const P1 = db.table('frameup_merch_products').find(p => p.product_id === 'prod_1');
  assert.equal(P1.product_url, 'https://shop.essentiallysports.com/products/slug-prod_1');
  assert.equal(P1.thumb, 'https://cdn/prod_1.png');
  assert.ok(P1.refreshed_at);
  assert.equal(db.table('frameup_merch_products').find(p => p.product_id === 'prod_2').state, 'ARCHIVED');
  assert.deepEqual([r.body.products.updated, r.body.products.archived], [1, 1]);
  const run = db.table('frameup_merch_events').find(e => e.type === 'SYNC');
  assert.equal(run.source, 'sync');
  assert.equal(run.payload.orders.stored, 51);
  assert.ok(fwCalls.every(c => c.method === 'GET'), 'the sync only reads Fourthwall');
});
await test('sync: first run looks 30 days back; ?since is capped at 90 days', async () => {
  fresh(); fwOn(); process.env.CRON_SECRET = CRON; fwCalls = [];
  fw = { 'GET /order': () => reply(200, { results: [], totalPages: 0 }), 'GET /shops/current': () => reply(200, {}), 'GET /products/prod_1': () => reply(200, offerFull('prod_1', 'PUBLIC')), 'GET /products/prod_2': () => reply(200, offerFull('prod_2', 'HIDDEN')) };
  const near = (iso, days) => Math.abs(Date.parse(iso) - (Date.now() - days * 86400000)) < 60000;
  let r = await cronCall(bearer);
  assert.ok(near(r.body.since, 30), r.body.since);
  r = await cronCall(bearer, { since: '2020-01-01T00:00:00Z' });
  assert.ok(near(r.body.since, 90), r.body.since);
  r = await cronCall(bearer, { since: daysAgo(2) });
  assert.ok(near(r.body.since, 2));
  // No products of ours: orders are not read at all.
  db.reset();
  fwCalls = [];
  r = await cronCall(bearer);
  assert.equal(r.body.orders.skipped, 'no-products');
  assert.ok(!fwCalls.some(c => c.path === '/order'));
});
await test('sync: a failure answers 502 without secrets', async () => {
  fresh(); fwOn(); process.env.CRON_SECRET = CRON;
  dbDown = true;
  const r = await cronCall(bearer);
  assert.equal(r.status, 502);
  assert.ok(!JSON.stringify(r.body).includes(CRON));
  dbDown = false;
});

// ─── Wiring ───────────────────────────────────────────────────────────────
await test('vercel.json: functions for the webhook and the sync; the sync cron runs daily', () => {
  const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  assert.ok(v.functions['api/fourthwall-webhook.js']?.maxDuration > 0);
  assert.ok(v.functions['api/merch-sync.js']?.maxDuration >= 30);
  const cron = (v.crons || []).filter(c => c.path.startsWith('/api/merch-sync'));
  assert.equal(cron.length, 1, 'one merch-sync cron');
  assert.match(cron[0].schedule, /^\d+ \d+ \* \* \*$/, 'once a day');
  assert.equal(cron[0].schedule, S.CRON_SCHEDULE);
  const adapter = fs.readFileSync('api/merch-sync.js', 'utf8');
  assert.match(adapter, /netlify\/functions\/merch-sync\.js/);
});
await test('no secret reached a log line', () => {
  const all = logs.join('\n');
  for (const s of [SECRET, CRON, 'service-key-test', 'fan@example.com']) assert.ok(!all.includes(s), s);
});

process.stdout.write(`test-merch-sales: ${passed} tests passed\n`);
