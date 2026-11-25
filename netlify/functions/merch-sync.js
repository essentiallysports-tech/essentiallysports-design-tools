'use strict';
// Daily Merch Designs reconciliation (Vercel cron, vercel.json "crons").
// The webhook keeps sales current; this catches anything it missed.
//
// 1. Orders: GET /order?updatedAt[gt]=<since> page by page. Only orders that
//    include a product FrameUp made are stored, only their lines for those
//    products, and never buyer data. <since> = the newest stored order update
//    minus an hour, or 30 days back on the first run (?since=<ISO> overrides,
//    at most 90 days back).
// 2. Products: GET /products/{id} for each of ours that isn't archived; the
//    stored state, mockups, variants and prices are refreshed. A product that
//    Fourthwall no longer has is marked ARCHIVED.
// 3. A SYNC event records the run (the "updated" time sales show).
//
// Protected by CRON_SECRET like clips-prefetch: Vercel sends
// "Authorization: Bearer <CRON_SECRET>"; "x-cron-secret" also works. Compared
// in constant time. Without CRON_SECRET every run answers 503.

const crypto = require('node:crypto');
const fourthwall = require('./_fourthwall.js');
const store = require('./_merch-store.js');

const CRON_SCHEDULE = '30 9 * * *';
const LIMITS = Object.freeze({ orderPages: 20, pageSize: 100, products: 200, concurrency: 4, budgetMs: 45000, firstRunDays: 30, maxDays: 90 });
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
function header(headers, name) {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers || {})) if (k.toLowerCase() === want) return String(v ?? '');
  return '';
}
function cronAuthorized(headers, secret = process.env.CRON_SECRET) {
  const expected = String(secret || '').trim();
  if (!expected) return false;
  const bearer = (header(headers, 'authorization').match(/^Bearer\s+(.+)$/i) || [])[1]?.trim() || '';
  const given = bearer || header(headers, 'x-cron-secret').trim();
  if (!given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

let clientFactory = () => fourthwall.createClient();

async function sinceFor(query, now) {
  const floor = now - LIMITS.maxDays * DAY;
  const asked = Date.parse(String(query.since || ''));
  if (Number.isFinite(asked)) return new Date(Math.max(asked, floor)).toISOString();
  const latest = Date.parse(await store.latestOrderUpdate() || '');
  if (Number.isFinite(latest)) return new Date(Math.max(latest - HOUR, floor)).toISOString();
  return new Date(now - LIMITS.firstRunDays * DAY).toISOString();
}

async function syncOrders(fw, since, ours, deadline) {
  const out = { pages: 0, seen: 0, stored: 0, complete: true };
  for (let page = 0; page < LIMITS.orderPages; page += 1) {
    if (Date.now() > deadline) { out.complete = false; break; }
    const res = await fw.orders({ updatedAfter: since, page, size: LIMITS.pageSize });
    const results = Array.isArray(res?.results) ? res.results : [];
    out.pages += 1; out.seen += results.length;
    const mine = results.map(o => store.onlyOurs(fourthwall.normalizeOrder(o), ours)).filter(Boolean);
    if (mine.length) out.stored += await store.upsertOrders(mine, { source: 'sync' });
    const total = Number(res?.totalPages);
    if (results.length < LIMITS.pageSize || (Number.isFinite(total) && page + 1 >= total)) return out;
  }
  if (out.pages >= LIMITS.orderPages) out.complete = false;
  return out;
}

async function syncProducts(fw, ids, deadline) {
  const out = { checked: 0, updated: 0, archived: 0, failed: 0, complete: true };
  let domain = '';
  try { domain = String((await fw.shop())?.publicDomain || ''); } catch { /* links stay as stored */ }
  const queue = ids.slice(0, LIMITS.products);
  if (ids.length > LIMITS.products) out.complete = false;
  async function worker() {
    while (queue.length) {
      if (Date.now() > deadline) { out.complete = false; return; }
      const id = queue.shift();
      out.checked += 1;
      try {
        const product = fourthwall.normalizeProduct(await fw.product(id), domain);
        const patch = store.patchFromProduct(product);
        if (!product.url) delete patch.productUrl;
        await store.updateProduct(id, patch);
        out.updated += 1;
      } catch (error) {
        if (error instanceof fourthwall.FourthwallError && error.reason === 'not-found') {
          await store.updateProduct(id, { state: 'ARCHIVED', archivedAt: new Date().toISOString(), refreshedAt: new Date().toISOString() }).catch(() => null);
          out.archived += 1;
        } else out.failed += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: LIMITS.concurrency }, worker));
  return out;
}

async function runSync(query = {}, { now = Date.now() } = {}) {
  const started = Date.now();
  const deadline = started + LIMITS.budgetMs;
  const fw = clientFactory();
  const [ourIds, liveIds, since] = await Promise.all([store.ourProductIds(), store.liveProductIds(LIMITS.products + 1), sinceFor(query, now)]);
  const ours = new Set(ourIds);
  const orders = ours.size ? await syncOrders(fw, since, ours, deadline) : { pages: 0, seen: 0, stored: 0, complete: true, skipped: 'no-products' };
  const products = await syncProducts(fw, liveIds, deadline);
  const summary = { since, orders, products, ms: Date.now() - started };
  await store.recordEvent({ id: `sync_${new Date().toISOString()}_${crypto.randomUUID().slice(0, 6)}`, source: 'sync', type: 'SYNC', payload: summary });
  return summary;
}

exports.handler = async function handler(event = {}) {
  if (!['GET', 'POST'].includes(event.httpMethod)) return json(405, { ok: false, error: 'Method not allowed.' });
  if (!String(process.env.CRON_SECRET || '').trim()) return json(503, { ok: false, reason: 'not-configured', error: 'The merch sync is not set up (CRON_SECRET is missing).' });
  if (!cronAuthorized(event.headers)) return json(401, { ok: false, error: 'Unauthorized.' });
  if (!fourthwall.configured()) return json(200, { ok: true, skipped: 'fourthwall-not-set-up' });
  if (!store.available()) return json(200, { ok: true, skipped: 'history-not-set-up' });
  try {
    const summary = await runSync(event.queryStringParameters || {});
    console.log(JSON.stringify({ event: 'merch-sync', since: summary.since, orders: summary.orders.stored, seen: summary.orders.seen, products: summary.products.updated, archived: summary.products.archived, ms: summary.ms }));
    return json(200, { ok: true, ...summary });
  } catch (error) {
    console.error('merch-sync failed:', error?.code || error?.status || '', error?.message || error);
    return json(502, { ok: false, error: 'The merch sync failed.' });
  }
};

exports._test = { cronAuthorized, runSync, sinceFor, LIMITS, CRON_SCHEDULE, setClientFactory(fn) { clientFactory = fn; } };
