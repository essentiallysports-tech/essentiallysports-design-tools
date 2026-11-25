'use strict';
// Merch Designs history and sales, in Supabase (migration
// 20261126120000_frameup_merch.sql). Server-only: every call uses the service
// role (SUPABASE_SERVICE_ROLE_KEY), which never reaches the browser. ES users
// read the tables directly through RLS; only this server writes.
//
// Every call can fail (key missing, migration not run, network). Callers treat
// a failure as "no history yet" and carry on; `soft()` wraps that.
//
// Tables:
//   frameup_merch_designs   one row per design sent to the shop (concept, rights tick)
//   frameup_merch_products  one row per Fourthwall product FrameUp created
//   frameup_merch_orders    orders that include any product, WITHOUT buyer data
//   frameup_merch_events    every create / publish / hide / archive / collection
//                           change by FrameUp, every Fourthwall webhook (id = the
//                           event id, so a replay is ignored) and every sync run
// Storage: bucket merch-art (private), <user id>/<file>.png, for the upload relay.

const crypto = require('node:crypto');
const rest = require('./_supabase-rest.js');
const { authConfig } = require('./_supabase-auth.js');

const T = Object.freeze({
  designs: 'frameup_merch_designs',
  products: 'frameup_merch_products',
  orders: 'frameup_merch_orders',
  events: 'frameup_merch_events',
});
const BUCKET = 'merch-art';
const STATES = new Set(['HIDDEN', 'PUBLIC', 'PRIVATE', 'ARCHIVED']);
const enc = encodeURIComponent;

const available = (env = process.env) => Boolean(rest.serviceRoleKey(env));

function req(path, options = {}) {
  if (!available()) {
    const e = new rest.SupabaseRestError('Merch history is not set up (no service key).', { status: 503, code: 'not_installed' });
    return Promise.reject(e);
  }
  return rest.request(path, { ...options, service: true });
}

// Runs fn; on any failure returns `fallback` and (once per reason) logs why.
const warned = new Set();
async function soft(fn, fallback = null, label = 'merch store') {
  try { return await fn(); } catch (error) {
    const why = `${label}: ${error?.code || error?.status || ''} ${error?.message || error}`;
    if (!warned.has(why)) { warned.add(why); console.warn(why); }
    return fallback;
  }
}

const clip = (v, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const iso = v => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

// ─── Designs and products ─────────────────────────────────────────────────
async function recordDesign({ concept, blank, title, by, ack, printPath }) {
  const id = crypto.randomUUID();
  await req(T.designs, {
    method: 'POST', prefer: 'return=minimal',
    body: {
      id, created_by: clip(by, 200), blank: clip(blank, 20), title: clip(title, 120),
      collection: clip(concept?.collection, 20), concept: concept || {}, rights_ack: ack || {}, print_path: printPath ? clip(printPath, 300) : null,
    },
  });
  return id;
}

function productRow(p) {
  const row = {};
  const set = (k, v) => { if (v !== undefined) row[k] = v; };
  set('product_id', p.productId);
  set('design_id', p.designId);
  set('title', p.title === undefined ? undefined : clip(p.title, 120));
  set('blank', p.blank);
  set('template_id', p.templateId);
  set('color', p.color);
  set('regions', p.regions);
  if (p.state !== undefined) set('state', STATES.has(String(p.state).toUpperCase()) ? String(p.state).toUpperCase() : 'HIDDEN');
  set('price', p.price);
  set('product_url', p.productUrl);
  set('slug', p.slug);
  set('thumb', p.thumb);
  set('images', p.images);
  set('variants', p.variants);
  set('collection_ids', p.collectionIds);
  set('ack', p.ack);
  set('created_by', p.createdBy);
  set('published_at', p.publishedAt);
  set('archived_at', p.archivedAt);
  set('refreshed_at', p.refreshedAt);
  row.updated_at = new Date().toISOString();
  return row;
}
async function upsertProduct(p) {
  await req(`${T.products}?on_conflict=product_id`, { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: productRow(p) });
  return true;
}
async function updateProduct(productId, patch) {
  const rows = await req(`${T.products}?product_id=eq.${enc(productId)}`, { method: 'PATCH', prefer: 'return=representation', body: productRow(patch) });
  return Array.isArray(rows) ? rows[0] || null : null;
}
async function getProduct(productId) {
  const rows = await req(`${T.products}?product_id=eq.${enc(productId)}&select=*&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}
async function listProducts({ page = 0, size = 50, includeArchived = false } = {}) {
  const p = Math.max(0, Math.round(Number(page) || 0));
  const n = Math.max(1, Math.min(100, Math.round(Number(size) || 50)));
  const filter = includeArchived ? '' : '&state=neq.ARCHIVED';
  return req(`${T.products}?select=*${filter}&order=created_at.desc&limit=${n}&offset=${p * n}`);
}
// Product ids FrameUp made that are not archived (for the daily sync).
async function liveProductIds(limit = 200) {
  const rows = await req(`${T.products}?select=product_id&state=neq.ARCHIVED&order=created_at.desc&limit=${Math.min(500, limit)}`);
  return (rows || []).map(r => r.product_id);
}
// Every product id FrameUp made (archived too): orders are kept only when
// they include one of these.
async function ourProductIds(limit = 2000) {
  const rows = await req(`${T.products}?select=product_id&order=created_at.desc&limit=${Math.min(5000, limit)}`);
  return (rows || []).map(r => r.product_id);
}
// The stored fields a fresh Fourthwall product read updates (refresh, sync,
// PRODUCT_UPDATED webhooks). `product` is _fourthwall.normalizeProduct().
function patchFromProduct(product, now = new Date().toISOString()) {
  const round2 = n => Math.round(Number(n) * 100) / 100;
  return {
    state: product.state, title: product.name || undefined, slug: product.slug || undefined, productUrl: product.url || undefined,
    thumb: product.thumbnail || undefined, images: product.images, variants: product.variants,
    ...(product.price != null ? { price: { retail: product.price, base: product.cost, margin: product.cost != null ? round2(product.price - product.cost) : null } } : {}),
    ...(product.state === 'ARCHIVED' ? { archivedAt: now } : {}),
    refreshedAt: now,
  };
}
// Products this person created since `sinceIso` (daily caps that survive cold starts).
async function createdSince(sinceIso, email) {
  const who = email ? `&created_by=eq.${enc(String(email).toLowerCase())}` : '';
  const rows = await req(`${T.products}?select=product_id&created_at=gte.${enc(sinceIso)}${who}&limit=500`);
  return Array.isArray(rows) ? rows.length : 0;
}

// ─── Events (de-duplicated by id) ─────────────────────────────────────────
// Returns { inserted: true } for a new id, { inserted: false } for a replay.
async function recordEvent({ id, source = 'frameup', type, productId = null, orderId = null, actor = null, payload = {}, testMode = false, at }) {
  const rows = await req(`${T.events}?on_conflict=id`, {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: {
      id: clip(id || `fu_${crypto.randomUUID()}`, 120), source, type: clip(type, 40), product_id: productId, order_id: orderId,
      actor: actor ? clip(actor, 200) : null, payload, test_mode: Boolean(testMode), created_at: iso(at) || new Date().toISOString(),
    },
  });
  return { inserted: Array.isArray(rows) ? rows.length > 0 : true };
}
async function hasEvent(id) {
  const rows = await req(`${T.events}?select=id&id=eq.${enc(id)}&limit=1`);
  return Array.isArray(rows) && rows.length > 0;
}
async function lastEvent(type) {
  const rows = await req(`${T.events}?select=id,created_at,payload&type=eq.${enc(type)}&order=created_at.desc&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

// ─── Orders (no buyer data) ───────────────────────────────────────────────
function orderRow(order, { source = 'webhook', testMode = false } = {}) {
  return {
    order_id: order.orderId, friendly_id: order.friendlyId || null, status: order.status || 'CONFIRMED',
    placed_at: iso(order.placedAt) || new Date().toISOString(), fw_updated_at: iso(order.updatedAt),
    currency: order.currency || 'USD', subtotal: order.subtotal, lines: order.lines || [],
    product_ids: [...new Set((order.lines || []).map(l => l.productId))],
    test_mode: Boolean(testMode), source, updated_at: new Date().toISOString(),
  };
}
async function upsertOrders(orders, opts = {}) {
  const rows = (orders || []).filter(o => o && o.orderId).map(o => orderRow(o, opts));
  if (!rows.length) return 0;
  await req(`${T.orders}?on_conflict=order_id`, { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: rows });
  return rows.length;
}
// Orders that include any of `productIds` (or all orders), newest first.
async function ordersFor(productIds = null, { limit = 5000 } = {}) {
  const filter = Array.isArray(productIds) && productIds.length
    ? `&product_ids=ov.${enc(`{${productIds.map(id => `"${String(id).replace(/"/g, '')}"`).join(',')}}`)}`
    : '';
  return req(`${T.orders}?select=order_id,status,placed_at,lines,test_mode,updated_at${filter}&test_mode=is.false&order=placed_at.desc&limit=${Math.min(10000, limit)}`);
}
async function getOrder(orderId) {
  const rows = await req(`${T.orders}?select=order_id,status,fw_updated_at&order_id=eq.${enc(orderId)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}
// Keep only the lines for FrameUp's products; null when none are ours.
function onlyOurs(order, ours) {
  const lines = (order?.lines || []).filter(l => ours.has(l.productId));
  return lines.length ? { ...order, lines } : null;
}
async function latestOrderUpdate() {
  const rows = await req(`${T.orders}?select=fw_updated_at,updated_at&order=fw_updated_at.desc.nullslast&limit=1`);
  return Array.isArray(rows) && rows[0] ? (rows[0].fw_updated_at || rows[0].updated_at) : null;
}

// Units and revenue per product over 7 / 30 days and all time.
// Cancelled and test orders do not count.
const DAY = 24 * 60 * 60 * 1000;
function aggregateSales(orders, { now = Date.now(), productIds = null } = {}) {
  const want = productIds ? new Set(productIds) : null;
  const out = new Map();
  const blank = id => ({ productId: id, units7: 0, revenue7: 0, units30: 0, revenue30: 0, unitsAll: 0, revenueAll: 0 });
  (want ? [...want] : []).forEach(id => out.set(id, blank(id)));
  for (const o of orders || []) {
    if (!o || o.test_mode || String(o.status || '').toUpperCase() === 'CANCELLED') continue;
    const t = Date.parse(o.placed_at);
    const age = Number.isFinite(t) ? now - t : Infinity;
    for (const l of Array.isArray(o.lines) ? o.lines : []) {
      const id = String(l?.productId || '');
      if (!id || (want && !want.has(id))) continue;
      if (!out.has(id)) out.set(id, blank(id));
      const r = out.get(id);
      const units = Math.max(0, Number(l.quantity) || 0);
      const money = Number(l.revenue) || 0;
      r.unitsAll += units; r.revenueAll += money;
      if (age <= 30 * DAY) { r.units30 += units; r.revenue30 += money; }
      if (age <= 7 * DAY) { r.units7 += units; r.revenue7 += money; }
    }
  }
  const round = n => Math.round(n * 100) / 100;
  return [...out.values()].map(r => ({ ...r, revenue7: round(r.revenue7), revenue30: round(r.revenue30), revenueAll: round(r.revenueAll) }));
}

// ─── Storage (upload relay) ───────────────────────────────────────────────
function storageHeaders() {
  const key = rest.serviceRoleKey();
  return { apikey: key, Authorization: `Bearer ${key}` };
}
const objectPath = path => String(path).split('/').map(enc).join('/');
async function downloadArt(path, { maxBytes = 25 * 1024 * 1024 } = {}) {
  if (!available()) throw new rest.SupabaseRestError('Merch storage is not set up.', { status: 503, code: 'not_installed' });
  const { url } = authConfig();
  const response = await fetch(`${url}/storage/v1/object/${BUCKET}/${objectPath(path)}`, { headers: storageHeaders(), signal: AbortSignal.timeout(30000) });
  if (response.status === 404 || response.status === 400) throw new rest.SupabaseRestError('The uploaded file was not found.', { status: 404, code: 'missing' });
  if (!response.ok) throw new rest.SupabaseRestError('Merch storage is unavailable.', { status: 502, code: 'storage' });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new rest.SupabaseRestError('The file is too large.', { status: 413, code: 'too-large' });
  return { bytes, contentType: response.headers?.get?.('content-type') || 'image/png' };
}
async function removeArt(path) {
  if (!available()) return false;
  const { url } = authConfig();
  const response = await fetch(`${url}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE', headers: { ...storageHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [String(path)] }),
    signal: AbortSignal.timeout(10000),
  });
  return response.ok;
}

module.exports = {
  T, BUCKET, available, soft,
  recordDesign, upsertProduct, updateProduct, getProduct, listProducts, liveProductIds, ourProductIds, createdSince, patchFromProduct,
  recordEvent, hasEvent, lastEvent, upsertOrders, getOrder, onlyOurs, ordersFor, latestOrderUpdate, aggregateSales,
  downloadArt, removeArt, orderRow, productRow,
};
