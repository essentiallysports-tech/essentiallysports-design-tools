'use strict';
// Fourthwall Open API adapter for Merch Designs. The API is Beta, so every call
// FrameUp makes goes through this one file: if Fourthwall changes a shape, fix
// it here.
//
// - Auth: HTTP Basic from FOURTHWALL_API_USERNAME / FOURTHWALL_API_PASSWORD
//   (server env only). The header is built per request and never logged,
//   returned, or attached to an error.
// - Product-template reads are public (no auth), so blanks load even before
//   the shop is connected.
// - Every call has a timeout. 429 (OPEN_API_TOO_MANY_REQUESTS) and, for reads,
//   network errors / 5xx are retried with jittered exponential backoff
//   (Retry-After is honoured, capped).
// - Creates and customizations are limited by Fourthwall to 5 a minute per
//   shop. A sliding-window queue keeps this server under that; a caller that
//   would wait too long gets a plain "try again in N seconds".
// - Errors become FourthwallError with a plain-English message, an HTTP status
//   for our reply, and Fourthwall's error code (never the request headers).
//
// Spec: Fourthwall open-api.json / platform.json (2026-11). Shapes used:
//   GET  /open-api/v1.0/shops/current -> { id, name, domain, publicDomain, status }
//   GET  /open-api/v1.0/product-templates/{id} | /search/{q} (public)
//   POST /open-api/v1.0/media/upload-url { fileName, contentType, size } -> { uploadUrl, fileUrl, expiresAt }
//   PUT  uploadUrl (signed Google Cloud Storage URL, raw bytes)
//   POST /open-api/v1.0/media/images { fileUrl, width, height } -> { id, uri, width, height, thumbnail, preview }
//   POST /open-api/v1.0/customizations { productTemplateId, regions[], colors?, sizes? } -> { customizationId, pipelineId, images[] }
//   POST /open-api/v1.0/products { type:'design', productTemplateId, name, description, regions[], colors?, sizes?, profitMargin, publishOnCreate } -> { productId, images[] }
//   PUT  /open-api/v1.0/products/{id}/state { state: 'PUBLIC'|'HIDDEN' } -> OfferFullV1
//   DELETE /open-api/v1.0/products/{id} -> 204 (archive; permanent through the API)
//   GET  /open-api/v1.0/products/{id} -> OfferFullV1; GET /products?page&size -> { results, total, page, size, totalPages }
//   GET  /open-api/v1.0/collections?page&size -> { results: CollectionSlimV1[] } (no offerIds)
//   GET  /open-api/v1.0/collections/{idOrSlug} -> CollectionV1 { id, name, slug, offerIds[] }
//   POST /open-api/v1.0/collections { name, description, offerIds[] } -> CollectionV1
//   PUT  /open-api/v1.0/collections/{id}/products { offerIds[] } -> CollectionV1 (REPLACES the whole list)
//   GET  /open-api/v1.0/order?updatedAt[gt]&page&size -> { results: OrderV1[] }
// Webhooks: Fourthwall signs the raw request body with HMAC-SHA256 and the
// webhook secret, base64, in the X-Fourthwall-Hmac-SHA256 header.

const BASE_URL = 'https://api.fourthwall.com';
const API = '/open-api/v1.0';
const USER_AGENT = 'FrameUp-merch/1.0';
const TIMEOUTS = Object.freeze({ read: 15000, write: 45000, upload: 60000 });
const RETRY = Object.freeze({ max: 3, baseMs: 800, capMs: 8000 });
const CREATE_LIMIT = Object.freeze({ perWindow: 5, windowMs: 60000, maxWaitMs: 25000 });

class FourthwallError extends Error {
  constructor(message, { status = 502, code = '', reason = 'fourthwall', retryAfterS } = {}) {
    super(message);
    this.name = 'FourthwallError';
    this.status = status;
    this.code = code;
    this.reason = reason;
    if (retryAfterS != null) this.retryAfterS = retryAfterS;
  }
}

function credentials(env = process.env) {
  const user = String(env.FOURTHWALL_API_USERNAME || '').trim();
  const pass = String(env.FOURTHWALL_API_PASSWORD || '').trim();
  return user && pass ? { user, pass } : null;
}
const configured = (env = process.env) => Boolean(credentials(env));
function authHeader(env = process.env) {
  const c = credentials(env);
  return c ? `Basic ${Buffer.from(`${c.user}:${c.pass}`).toString('base64')}` : '';
}

// Plain-English messages for Fourthwall's error codes. Unknown codes fall back
// on the HTTP status.
const CODE_MESSAGES = {
  OPEN_API_TOO_MANY_REQUESTS: ['Fourthwall is busy with other requests from ES. Wait a minute and try again.', 429, 'rate-limit'],
  SAAS_OPERATION_NOT_ALLOWED_ERROR: ["The Fourthwall shop's plan doesn't allow this. Ask an admin to check the Fourthwall plan.", 403, 'plan'],
  MEDIA_FILE_DO_NOT_EXISTS: ["Fourthwall can't find the print file. Upload the design again.", 409, 'media-missing'],
  PRODUCT_CATALOG_PRODUCT_ID_NOT_FOUND: ['That blank is no longer offered by Fourthwall. Pick another blank.', 409, 'template-gone'],
  GENERATOR_ID_NOT_FOUND: ['That blank is no longer offered by Fourthwall. Pick another blank.', 409, 'template-gone'],
  OFFER_SLUG_DUPLICATION_ERROR: ['A product with this name is already in the shop. Change the title and try again.', 409, 'duplicate'],
  OFFER_NOT_FOUND_BY_SHOP_ID_AND_ID_ERROR: ["That product isn't in the shop any more.", 404, 'not-found'],
  OFFER_INVALID_STATE_ERROR: ["That product can't change state now (it may be archived).", 409, 'state'],
  CUSTOMIZATION_ALREADY_USED_ERROR: ['This mockup was already turned into a product. Make a new preview.', 409, 'customization-used'],
  PRICING_CALCULATION_NOT_SUPPORTED: ["Fourthwall can't price this blank. Pick another blank.", 409, 'pricing'],
  SHOP_TEAM_MEMBER_SHOP_NOT_FOUND_ERROR: ["FrameUp's Fourthwall login isn't linked to a shop. Ask an admin to check the Fourthwall API user.", 502, 'shop'],
};
function mapError(status, data, { action = 'reach Fourthwall' } = {}) {
  const code = String(data?.code || '').slice(0, 80);
  if (CODE_MESSAGES[code]) {
    const [message, s, reason] = CODE_MESSAGES[code];
    return new FourthwallError(message, { status: s, code, reason });
  }
  if (status === 401) return new FourthwallError("Fourthwall refused FrameUp's login. Ask an admin to check FOURTHWALL_API_USERNAME and FOURTHWALL_API_PASSWORD in Vercel.", { status: 502, code, reason: 'auth' });
  if (status === 403) return new FourthwallError("FrameUp's Fourthwall login isn't allowed to do this. Ask an admin to check the API user's permissions.", { status: 502, code, reason: 'forbidden' });
  if (status === 404) return new FourthwallError("Fourthwall couldn't find that. It may have been removed.", { status: 404, code, reason: 'not-found' });
  if (status === 429) return new FourthwallError(CODE_MESSAGES.OPEN_API_TOO_MANY_REQUESTS[0], { status: 429, code, reason: 'rate-limit' });
  if (status === 400 || status === 406 || status === 409 || status === 422) {
    return new FourthwallError(`Fourthwall didn't accept this request${code ? ` (${code})` : ''}. Check the design and try again.`, { status: 400, code, reason: 'rejected' });
  }
  return new FourthwallError(`Couldn't ${action} right now. Try again in a moment.`, { status: 502, code, reason: 'unavailable' });
}

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Sliding window: at most `perWindow` starts in any `windowMs`. Shared by every
// client in this server instance (Fourthwall's limit is per shop).
function createQueue({ perWindow = CREATE_LIMIT.perWindow, windowMs = CREATE_LIMIT.windowMs, maxWaitMs = CREATE_LIMIT.maxWaitMs } = {}) {
  const starts = [];
  let chain = Promise.resolve();
  function waitFor(now) {
    while (starts.length && now - starts[0] >= windowMs) starts.shift();
    if (starts.length < perWindow) return 0;
    return starts[0] + windowMs - now;
  }
  return {
    starts,
    // Reserves a slot (waiting if allowed), then runs fn.
    run(fn, { now = () => Date.now(), sleep = defaultSleep } = {}) {
      const turn = chain.then(async () => {
        const wait = waitFor(now());
        if (wait > maxWaitMs) {
          const s = Math.ceil(wait / 1000);
          throw new FourthwallError(`Fourthwall takes 5 new products or mockups a minute. Try again in ${s} seconds.`, { status: 429, reason: 'queue', retryAfterS: s });
        }
        if (wait > 0) await sleep(wait);
        starts.push(now());
      });
      chain = turn.catch(() => {});
      return turn.then(fn);
    },
    reset() { starts.length = 0; chain = Promise.resolve(); },
  };
}
const CREATE_QUEUE = createQueue();

function retryDelay(attempt, retryAfterHeader, random = Math.random) {
  const ra = Number(retryAfterHeader);
  if (Number.isFinite(ra) && ra > 0) return Math.min(RETRY.capMs, ra * 1000);
  const exp = Math.min(RETRY.capMs, RETRY.baseMs * 2 ** attempt);
  return Math.round(exp / 2 + random() * (exp / 2)); // "equal jitter"
}

function createClient({ env = process.env, fetchImpl = (...a) => fetch(...a), sleep = defaultSleep, now = () => Date.now(), random = Math.random, queue = CREATE_QUEUE, baseUrl = BASE_URL } = {}) {
  async function call(method, path, { body, auth = true, timeoutMs, retryOn = 'read', action } = {}) {
    if (auth && !configured(env)) throw new FourthwallError("Merch isn't connected to Fourthwall yet. Ask an admin to add the Fourthwall API login in Vercel.", { status: 503, reason: 'not-set-up' });
    const idempotent = retryOn === 'read';
    for (let attempt = 0; ; attempt += 1) {
      const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (auth) headers.Authorization = authHeader(env);
      let response;
      try {
        response = await fetchImpl(`${baseUrl}${API}${path}`, {
          method, headers, body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs || (method === 'GET' ? TIMEOUTS.read : TIMEOUTS.write)),
        });
      } catch (error) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        if (idempotent && attempt < RETRY.max) { await sleep(retryDelay(attempt, null, random)); continue; }
        throw new FourthwallError(timedOut ? 'Fourthwall took too long to answer. Try again in a moment.' : `Couldn't ${action || 'reach Fourthwall'} right now. Try again in a moment.`, { status: 504, reason: timedOut ? 'timeout' : 'network' });
      }
      if (response.status === 429 && attempt < RETRY.max) {
        await sleep(retryDelay(attempt, response.headers?.get?.('retry-after'), random));
        continue;
      }
      if (response.status >= 500 && idempotent && attempt < RETRY.max) { await sleep(retryDelay(attempt, null, random)); continue; }
      const text = response.status === 204 ? '' : await response.text().catch(() => '');
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!response.ok) throw mapError(response.status, data, { action });
      return data;
    }
  }
  const enc = encodeURIComponent;
  const queued = fn => queue.run(fn, { now, sleep });

  return {
    configured: () => configured(env),
    shop: () => call('GET', '/shops/current', { action: 'read the Fourthwall shop' }),
    template: id => call('GET', `/product-templates/${enc(id)}`, { auth: false, action: 'read the blank' }),
    searchTemplates: (query, page = 1) => call('GET', `/product-templates/search/${enc(query)}${page > 1 ? `/page/${Number(page)}` : ''}`, { auth: false, action: 'search blanks' }),
    uploadUrl: ({ fileName, contentType, size }) => call('POST', '/media/upload-url', { body: { fileName, contentType, size }, retryOn: '429', action: 'get an upload link' }),
    registerImage: ({ fileUrl, width, height }) => call('POST', '/media/images', { body: { fileUrl, width, height }, retryOn: '429', action: 'save the print file' }),
    customize: body => queued(() => call('POST', '/customizations', { body, retryOn: '429', action: 'make the mockups' })),
    createProduct: body => queued(() => call('POST', '/products', { body: { ...body, type: 'design', publishOnCreate: false }, retryOn: '429', action: 'create the product' })),
    setState: (id, state) => call('PUT', `/products/${enc(id)}/state`, { body: { state }, retryOn: '429', action: 'change the product' }),
    archive: id => call('DELETE', `/products/${enc(id)}`, { retryOn: '429', action: 'archive the product' }),
    product: id => call('GET', `/products/${enc(id)}`, { action: 'read the product' }),
    listProducts: ({ page = 0, size = 20, search } = {}) => call('GET', `/products?page=${Number(page) || 0}&size=${Math.min(100, Number(size) || 20)}${search ? `&search=${enc(search)}` : ''}`, { action: 'list products' }),
    collections: ({ page = 0, size = 100 } = {}) => call('GET', `/collections?page=${Number(page) || 0}&size=${Math.min(100, Number(size) || 100)}`, { action: 'list collections' }),
    collection: id => call('GET', `/collections/${enc(id)}`, { action: 'read the collection' }),
    createCollection: ({ name, description = '' }) => call('POST', '/collections', { body: { name, description, offerIds: [] }, retryOn: '429', action: 'create the collection' }),
    // Replaces the whole product list of the collection: read it first.
    setCollectionProducts: (id, offerIds) => call('PUT', `/collections/${enc(id)}/products`, { body: { offerIds }, retryOn: '429', action: 'update the collection' }),
    orders: ({ updatedAfter, page = 0, size = 100 } = {}) => call('GET', `/order?page=${Number(page) || 0}&size=${Math.min(100, Number(size) || 100)}${updatedAfter ? `&${enc('updatedAt[gt]')}=${enc(updatedAfter)}` : ''}`, { action: 'read orders' }),
    // Server-side PUT to the signed upload URL (the upload-relay fallback).
    async putUpload(uploadUrl, bytes, contentType) {
      let response;
      try {
        response = await fetchImpl(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType, 'x-goog-content-length-range': `0,${bytes.length || bytes.byteLength || 0}` }, body: bytes, signal: AbortSignal.timeout(TIMEOUTS.upload) });
      } catch {
        throw new FourthwallError("The print file didn't upload. Try again in a moment.", { status: 504, reason: 'upload' });
      }
      if (!response.ok) throw new FourthwallError("Fourthwall's storage refused the print file (the upload link may have expired). Try again.", { status: 502, reason: 'upload' });
      return true;
    },
  };
}

// Normalized product (OfferFullV1) for the UI.
function productUrl(publicDomain, slug) {
  const host = String(publicDomain || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return host && slug ? `https://${host}/products/${encodeURIComponent(slug)}` : '';
}
function normalizeProduct(p = {}, publicDomain = '') {
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const prices = variants.map(v => Number(v?.unitPrice?.value)).filter(Number.isFinite);
  const costs = variants.map(v => Number(v?.unitCost?.value)).filter(Number.isFinite);
  // Every mockup: the product's own images, then each variant's (labelled by
  // colour), without repeats. The page shows them all in a gallery.
  const seen = new Set();
  const pick = (i, color = '') => ({ url: i?.transformedUrl || i?.url, width: i?.width, height: i?.height, color: String(i?.color || color || '').slice(0, 40) });
  const images = [
    ...(Array.isArray(p.images) ? p.images : []).map(i => pick(i)),
    ...variants.flatMap(v => (Array.isArray(v?.images) ? v.images : []).map(i => pick(i, v?.attributes?.color?.name))),
  ].filter(i => i.url && !seen.has(i.url) && seen.add(i.url));
  return {
    id: String(p.id || ''),
    name: String(p.name || ''),
    slug: String(p.slug || ''),
    description: String(p.description || ''),
    state: String(p.access?.type || '').toUpperCase() || 'UNKNOWN', // PUBLIC | HIDDEN | PRIVATE | ARCHIVED
    available: p.state?.type !== 'SOLD_OUT',
    price: prices.length ? Math.min(...prices) : null,
    cost: costs.length ? Math.min(...costs) : null,
    currency: variants[0]?.unitPrice?.currency || 'USD',
    thumbnail: p.thumbnailImage ? (p.thumbnailImage.transformedUrl || p.thumbnailImage.url) : (images[0]?.url || ''),
    images: images.slice(0, 40),
    variants: variants.slice(0, 60).map(v => ({
      id: String(v.id || ''), name: String(v.name || '').slice(0, 120), sku: String(v.sku || '').slice(0, 60),
      color: String(v?.attributes?.color?.name || '').slice(0, 40), size: String(v?.attributes?.size?.name || '').slice(0, 20),
      price: Number.isFinite(Number(v?.unitPrice?.value)) ? Number(v.unitPrice.value) : null,
      cost: Number.isFinite(Number(v?.unitCost?.value)) ? Number(v.unitCost.value) : null,
    })),
    url: productUrl(publicDomain, p.slug),
    createdAt: p.createdAt || null,
    updatedAt: p.updatedAt || null,
  };
}

// ─── Webhooks ───────────────────────────────────────────────────────────────
// HMAC-SHA256 of the exact raw body bytes with the webhook secret, base64.
// Constant-time compare; any missing piece = not verified.
const WEBHOOK_HEADER = 'x-fourthwall-hmac-sha256';
function webhookSignature(rawBody, secret) {
  return require('node:crypto').createHmac('sha256', String(secret)).update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8')).digest('base64');
}
function verifyWebhook(rawBody, signature, secret) {
  const crypto = require('node:crypto');
  const key = String(secret || '').trim();
  const given = String(signature || '').trim();
  if (!key || !given || rawBody == null) return false;
  const expected = Buffer.from(webhookSignature(rawBody, key));
  const got = Buffer.from(given);
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(got, expected);
}

// An order without buyer personal data (no email, name, username, message,
// addresses). Lines are per product variant: units and money.
function money(m) { const v = Number(m?.value ?? m?.amount); return Number.isFinite(v) ? Math.round(v * 100) / 100 : null; }
function normalizeOrder(o = {}) {
  const offers = Array.isArray(o.offers) ? o.offers : [];
  const lines = offers.map(of => {
    const v = of?.variant || {};
    const quantity = Math.max(0, Math.round(Number(v.quantity) || 0)) || 1;
    const unit = money(v.unitPrice);
    const total = money(v.price);
    // Prefer unitPrice x quantity; `price` is used when the unit price is missing.
    const revenue = unit != null ? Math.round(unit * quantity * 100) / 100 : (total != null ? total : 0);
    const unitCost = money(v.unitCost);
    return {
      productId: String(of?.id || ''), variantId: String(v.id || ''), name: String(of?.name || '').slice(0, 120),
      variant: String(v.name || '').slice(0, 120), quantity, revenue,
      cost: unitCost != null ? Math.round(unitCost * quantity * 100) / 100 : null,
      currency: String(v.unitPrice?.currency || v.price?.currency || o.amounts?.total?.currency || 'USD'),
    };
  }).filter(l => l.productId);
  return {
    orderId: String(o.id || ''),
    friendlyId: String(o.friendlyId || '').slice(0, 40),
    status: String(o.status || '').toUpperCase().slice(0, 40),
    placedAt: o.createdAt || null,
    updatedAt: o.updatedAt || o.createdAt || null,
    currency: String(o.amounts?.total?.currency || lines[0]?.currency || 'USD'),
    subtotal: money(o.amounts?.subtotal),
    lines,
  };
}

module.exports = {
  BASE_URL, API, TIMEOUTS, RETRY, CREATE_LIMIT, CODE_MESSAGES, WEBHOOK_HEADER,
  FourthwallError, configured, createClient, createQueue, CREATE_QUEUE, mapError, retryDelay, normalizeProduct, productUrl,
  webhookSignature, verifyWebhook, normalizeOrder,
};
