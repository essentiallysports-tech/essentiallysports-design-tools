'use strict';
// Fourthwall webhook for Merch Designs sales.
// URL to give the owner: https://frameup.essentiallysports.com/api/fourthwall-webhook
//
// - POST only. FOURTHWALL_WEBHOOK_SECRET missing -> 503 (nothing is accepted).
// - Fourthwall signs the exact raw body: HMAC-SHA256 with the secret, base64,
//   in X-Fourthwall-Hmac-SHA256. Checked in constant time before anything is
//   parsed; a bad or missing signature -> 401.
// - De-duplicated by the event id (frameup_merch_events primary key): a replay
//   of a delivered event changes nothing and answers 200 { duplicate: true }.
// - ORDER_PLACED / ORDER_UPDATED: the order is stored WITHOUT buyer data (no
//   email, name, username, message or address), only when it includes a
//   product FrameUp made, and only its lines for those products. An update
//   older than what is stored is ignored.
// - PRODUCT_CREATED / PRODUCT_UPDATED: refreshes the stored product (state,
//   mockups, variants, prices) when it is one of ours.
// - Any other type: 200 { ignored: true }.
// - History store unavailable (no service key / migration not run / Supabase
//   down) -> 503, so Fourthwall delivers again later.

const fourthwall = require('./_fourthwall.js');
const store = require('./_merch-store.js');

const HANDLED = new Set(['ORDER_PLACED', 'ORDER_UPDATED', 'PRODUCT_CREATED', 'PRODUCT_UPDATED']);
const MAX_BODY = 256 * 1024;
const RECENT = new Set(); // this instance's delivered ids, a first de-dup layer
const remember = id => { RECENT.add(id); if (RECENT.size > 1000) RECENT.delete(RECENT.values().next().value); };

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
function header(headers, name) {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers || {})) if (k.toLowerCase() === want) return Array.isArray(v) ? String(v[0]) : String(v ?? '');
  return '';
}
function rawBody(event) {
  const body = event.body == null ? '' : event.body;
  if (Buffer.isBuffer(body)) return body;
  return event.isBase64Encoded ? Buffer.from(String(body), 'base64') : Buffer.from(String(body), 'utf8');
}

async function handleOrder(type, data, testMode) {
  const order = fourthwall.normalizeOrder(data?.order || data || {});
  if (!order.orderId) return { stored: false, reason: 'no-order-id' };
  const ours = new Set(await store.ourProductIds());
  const mine = store.onlyOurs(order, ours);
  if (!mine) return { stored: false, reason: 'not-ours', orderId: order.orderId };
  if (type === 'ORDER_UPDATED') {
    const have = await store.getOrder(order.orderId);
    if (have?.fw_updated_at && order.updatedAt && Date.parse(have.fw_updated_at) > Date.parse(order.updatedAt)) {
      return { stored: false, reason: 'stale', orderId: order.orderId };
    }
  }
  await store.upsertOrders([mine], { source: 'webhook', testMode });
  return { stored: true, orderId: order.orderId, order: mine };
}
async function handleProduct(data) {
  const raw = data?.product || data || {};
  const id = String(raw.id || '');
  if (!id) return { stored: false, reason: 'no-product-id' };
  const row = await store.getProduct(id);
  if (!row) return { stored: false, reason: 'not-ours', productId: id };
  const product = fourthwall.normalizeProduct(raw, '');
  const patch = store.patchFromProduct(product);
  if (!product.url) delete patch.productUrl; // no shop domain here; keep the stored link
  await store.updateProduct(id, patch);
  return { stored: true, productId: id, state: product.state };
}

exports.handler = async function handler(event = {}) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });
  const secret = String(process.env.FOURTHWALL_WEBHOOK_SECRET || '').trim();
  if (!secret) return json(503, { ok: false, reason: 'not-configured', error: 'The Fourthwall webhook is not set up (FOURTHWALL_WEBHOOK_SECRET is missing).' });
  const raw = rawBody(event);
  if (raw.length > MAX_BODY) return json(413, { ok: false, error: 'Too large.' });
  if (!fourthwall.verifyWebhook(raw, header(event.headers, fourthwall.WEBHOOK_HEADER), secret)) {
    return json(401, { ok: false, error: 'Invalid signature.' });
  }
  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { return json(400, { ok: false, error: 'Invalid JSON.' }); }
  const id = String(payload?.id || '').slice(0, 120);
  const type = String(payload?.type || '').toUpperCase();
  if (id.length < 3) return json(400, { ok: false, error: 'Missing event id.' });
  if (!HANDLED.has(type)) return json(200, { ok: true, ignored: true, type });
  if (RECENT.has(id)) return json(200, { ok: true, duplicate: true });
  if (!store.available()) return json(503, { ok: false, reason: 'not-configured', error: 'Merch history is not set up.' });
  const testMode = payload.testMode === true;
  try {
    if (await store.hasEvent(id)) { remember(id); return json(200, { ok: true, duplicate: true }); }
    const result = type.startsWith('ORDER_') ? await handleOrder(type, payload.data, testMode) : await handleProduct(payload.data);
    // Only what we kept goes in the event log (never the raw body: it has buyer data).
    const slim = { stored: result.stored, reason: result.reason || null, state: result.state || null, lines: result.order?.lines || undefined, status: result.order?.status || undefined };
    const { inserted } = await store.recordEvent({ id, source: 'fourthwall', type, productId: result.productId || null, orderId: result.orderId || null, payload: slim, testMode, at: payload.createdAt });
    remember(id);
    return json(200, { ok: true, type, stored: result.stored, ...(inserted ? {} : { duplicate: true }) });
  } catch (error) {
    console.error('fourthwall webhook failed:', error?.code || error?.status || '', error?.message || error);
    return json(503, { ok: false, error: 'Could not store the event. Fourthwall will try again.' });
  }
};

exports._test = { HANDLED, RECENT, rawBody, header, reset() { RECENT.clear(); } };
