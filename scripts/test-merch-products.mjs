#!/usr/bin/env node
// Merch7 products (netlify/functions/merch.js + _merch-templates.js + merch-rules.js),
// every network call mocked (no Fourthwall, no AI, no Supabase):
//   the five new blanks (long sleeve, crewneck, tank, youth tee, tote): curated
//   ids, print areas, logo rule, minDpi / apparel, suggested prices, snapshots that
//   match the saved public replies; every blank photo per colour labelled by angle
//   (known template order, fallback for unknown templates, strings accepted);
//   multiColor; per-colour base; ONE product with several colours (create and
//   preview send `colors`, validated against the template, deduped, capped; the
//   price base is the dearest chosen colour); optional sizes; search fallback
//   only takes DTG blanks of the right kind; template reads never carry auth.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const modPath = path.join(fnDir, 'merch.js');
const fwPath = path.join(fnDir, '_fourthwall.js');
const authPath = path.join(fnDir, '_supabase-auth.js');
const LIVE = JSON.parse(fs.readFileSync('scripts/fixtures/fourthwall-blank-templates.json', 'utf8')).templates;
const USER = 'fw-user-test';
const PASS = 'fw-pass-SECRET-123';

const logs = [];
for (const k of ['log', 'warn', 'error', 'info']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { logs.push(a.map(String).join(' ')); if (process.env.MERCH_TEST_VERBOSE) orig(...a); };
}

const reply = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: k => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => (body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body)) });
let fw = {};
let fwCalls = [];
const LIVE_IDS = { tee: 'pro_Vv1XdaPMSdm6jZ5pj24NCQ', hoodie: 'pro_380', poster: 'pro_15bc29bc8a324d449d', sticker: 'pro_358', mug: 'pro_4v5OfYhyRx62KW5b7Oj6Uw', longsleeve: 'pro_6ae602fcb22447bfbc', crewneck: 'pro_14kNy0EJQkqopY-Z9Pm41A', tank: 'pro_xPL7YjOBRQWVL50Im8eKAA', youth: 'pro_ODh_gv0ESl6jIcRfvSww0w', tote: 'pro_367' };
const NEW = ['longsleeve', 'crewneck', 'tank', 'youth', 'tote'];
function resetFw() {
  fwCalls = [];
  fw = {
    'GET /shops/current': () => reply(200, { id: 'sh_1', name: 'ES Shop', publicDomain: 'shop.essentiallysports.com', status: 'LIVE' }),
    'POST /customizations': (u, o) => { const b = JSON.parse(o.body); return reply(201, { customizationId: 'cus_1', images: (b.colors || ['White']).map((c, i) => ({ url: `https://cdn/m${i}.png`, width: 1000, height: 1000, color: c })) }); },
    'POST /products': (u, o) => { const b = JSON.parse(o.body); return reply(201, { productId: 'prod_7', images: (b.colors || []).map((c, i) => ({ url: `https://cdn/p${i}.png`, color: c })) }); },
    'GET /products/prod_7': () => reply(200, { id: 'prod_7', slug: 'showtime-ls', access: { type: 'HIDDEN' }, variants: [] }),
  };
  Object.entries(LIVE_IDS).forEach(([k, id]) => { fw[`GET /product-templates/${id}`] = () => reply(200, LIVE[k]); });
}
resetFw();
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.startsWith('https://api.fourthwall.com/open-api/v1.0')) {
    const p = href.slice('https://api.fourthwall.com/open-api/v1.0'.length).split('?')[0];
    const method = options.method || 'GET';
    fwCalls.push({ method, path: p, headers: options.headers || {}, body: options.body ? JSON.parse(options.body) : undefined });
    const h = fw[`${method} ${p}`];
    return h ? h(href, options) : reply(404, { code: 'NOT_MOCKED' });
  }
  if (href.includes('/rest/v1/rpc/is_es_designer_admin')) return reply(200, false);
  if (href.includes('/rest/v1/frameup_ai_usage')) return reply(201, {});
  if (href.includes('/rest/v1/rpc/')) return reply(200, [{ total_usd: 0 }]);
  throw new Error(`unexpected fetch ${href}`);
};
[modPath, fwPath, authPath].forEach(p => delete require.cache[p]);
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: () => 'tok',
  verifyEsUser: async () => ({ ok: true, user: { id: 'u1', email: 'designer@essentiallysports.com' } }),
} };
for (const k of ['MERCH_TEMPLATES', 'AI_DISABLE', 'SUPABASE_SERVICE_ROLE_KEY', 'MERCH_RIGHTS_POLICY']) delete process.env[k];
process.env.FOURTHWALL_API_USERNAME = USER;
process.env.FOURTHWALL_API_PASSWORD = PASS;
process.env.MERCH_PUSHERS = 'designer@essentiallysports.com';
process.env.AI_GATEWAY_API_KEY = 'test-gateway-key';
const FW = require(fwPath);
const { handler, _test: M } = require(modPath);
const T = require(path.join(fnDir, '_merch-templates.js'));
const R = require(path.resolve('merch-rules.js'));
M.setClientFactory(() => FW.createClient({ sleep: async () => {}, random: () => 0.5, queue: FW.createQueue() }));
const call = async body => {
  const res = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) });
  assert.ok(!String(res.body).includes(PASS), 'secret in a reply');
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};
let passed = 0;
const test = async (name, fn) => { try { await fn(); passed += 1; } catch (error) { process.stderr.write(`FAIL ${name}\n`); throw error; } };

const SOURCE = 'Magic Johnson won 5 titles with the Lakers. Fans still call that era Showtime.';
const good = {
  collection: 'replay', title: 'Showtime', team: { id: 'lal', name: 'Lakers' },
  palette: { a: '#552583', b: '#FDB927', ink: '#ffffff' }, garment: { color: '#ffffff', name: 'White' },
  stack: [{ text: 'SHOWTIME', size: 'big', fill: 'a', ink: 'white' }, { text: '5 TITLES', size: 'small', fill: 'b', ink: 'a' }],
  align: 'left', rights: [{ kind: 'team', text: 'Lakers' }], why: 'The era every Lakers fan replays.',
};
const createBody = extra => ({ mode: 'create', blank: 'longsleeve', concept: good, content: SOURCE, imageId: 'img_2250', logo: { region: 'sleeve_left', imageId: 'img_450' }, title: 'Showtime Long Sleeve', description: 'For fans.', retail: 34.99, ack: { accepted: true, items: [{ kind: 'team', text: 'Lakers' }] }, ...extra });
const posted = () => fwCalls.filter(c => c.method === 'POST' && c.path === '/products');

// ─── New blanks ────────────────────────────────────────────────────────────
await test('templates: the five new blanks (curated DTG ids, areas, logo rule, prices)', async () => {
  M.reset(); resetFw();
  const r = await call({ mode: 'templates' });
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.templates.map(t => [t.blank, t]));
  for (const k of NEW) {
    assert.equal(by[k].templateId, LIVE_IDS[k], k);
    assert.equal(by[k].source, 'curated', k);
    assert.equal(by[k].productionMethod, 'DTG', k);
    assert.equal(by[k].printSpec.kind, k);
    assert.equal(by[k].minDpi, 150, k);
    assert.equal(by[k].printSpec.dpi, 150, k);
    assert.equal(by[k].multiColor, true, k);
    assert.ok(by[k].colors.length >= 2, k);
  }
  const spec = k => [by[k].printSpec.regionId, by[k].printSpec.pixelsWidth, by[k].printSpec.pixelsHeight, by[k].printSpec.placementId || by[k].printSpec.placementStrategy];
  assert.deepEqual(spec('longsleeve'), ['front_large', 2250, 2700, 'largeCenter']);
  assert.deepEqual(spec('crewneck'), ['front_large', 2250, 2700, 'largeCenter']);
  assert.deepEqual(spec('tank'), ['front', 1800, 2400, 'largeCenter']);
  assert.deepEqual(spec('youth'), ['front', 1500, 1800, 'largeCenter']);
  assert.deepEqual(spec('tote'), ['front', 1500, 1500, 'FULL_REGION']);
  // Sleeves carry the ES logo where the blank has them; the others print it inside.
  for (const k of ['longsleeve', 'crewneck']) {
    assert.equal(by[k].logo, 'area', k);
    assert.deepEqual(by[k].areas.filter(a => a.suitsLogo).map(a => a.regionId).sort(), ['sleeve_left', 'sleeve_right'], k);
    assert.ok(!by[k].areas.some(a => /embroidery/.test(a.regionId)), k);
  }
  for (const k of ['tank', 'youth', 'tote']) { assert.equal(by[k].logo, 'inside', k); assert.ok(!by[k].areas.some(a => a.suitsLogo), k); }
  assert.deepEqual([by.longsleeve.apparel, by.crewneck.apparel, by.tank.apparel, by.youth.apparel, by.tote.apparel], [true, true, true, true, false]);
  assert.deepEqual(NEW.map(k => by[k].basePrice), [14.79, 18.79, 14.2, 9.69, 15.56]);
  assert.deepEqual(NEW.map(k => by[k].pricing.suggested), [34.99, 44.99, 27.99, 22.99, 24.99]);
  assert.deepEqual(by.tote.colors.map(c => c.name), ['Black', 'Oyster']);
  assert.equal(by.tote.sizes.join(), 'One size');
  // Template reads are public: never an Authorization header.
  assert.ok(fwCalls.filter(c => c.path.startsWith('/product-templates')).every(c => !c.headers.Authorization));
  // Every template GET only: nothing created or changed on Fourthwall.
  assert.ok(fwCalls.every(c => c.method === 'GET'));
});
await test('snapshots of the new blanks match the saved public replies', async () => {
  M.reset(); resetFw();
  NEW.forEach(k => { delete fw[`GET /product-templates/${LIVE_IDS[k]}`]; });
  for (const k of NEW) {
    const t = LIVE[k];
    const snap = M.snapshotTemplate(k);
    const area = M.pickArea(t, M.BLANKS[k].regionPrefer);
    assert.equal(snap.printSpec.regionId, area.regionId, k);
    assert.deepEqual([snap.printSpec.pixelsWidth, snap.printSpec.pixelsHeight, snap.printSpec.dpi], [area.dimensions.pixelsWidth, area.dimensions.pixelsHeight, area.dimensions.dpi], k);
    assert.equal(snap.basePrice, t.priceFrom.amount, k);
    assert.ok(M.qualifies(t, M.BLANKS[k]), `${k} qualifies`);
    // Snapshot colours exist live with the same hex, and carry every photo.
    for (const c of snap.colors) {
      const live = t.colorVariants.find(v => v.color.name === c.name);
      if (!live) continue; // the fixture keeps 5 colours
      assert.equal(c.hex, live.color.hex.toLowerCase(), `${k} ${c.name}`);
      assert.deepEqual(c.photos.map(p => p.url), live.photos.map(p => p.url), `${k} ${c.name} photos`);
    }
    assert.ok(snap.colors.every(c => c.photos.length >= 1 && c.base === t.priceFrom.amount), k);
    assert.equal(snap.multiColor, true);
    // The snapshot's areas match the live renderable ones.
    const liveAreas = M.listAreas(t, area.regionId).filter(a => a.renderable && a.available).map(a => a.regionId).sort();
    assert.deepEqual(snap.areas.filter(a => a.renderable && a.available).map(a => a.regionId).sort(), liveAreas, k);
  }
  const r = await call({ mode: 'templates', blank: 'crewneck' });
  assert.equal(r.body.templates[0].source, 'snapshot');
  assert.equal(r.body.templates[0].colors.length, 10);
});

// ─── Photos by angle ───────────────────────────────────────────────────────
await test('photos: every photo per colour, labelled by angle in Fourthwall order', async () => {
  M.reset(); resetFw();
  const r = await call({ mode: 'templates' });
  const by = Object.fromEntries(r.body.templates.map(t => [t.blank, t]));
  const angles = (k, name) => by[k].colors.find(c => c.name === name).photos.map(p => p.angle);
  assert.deepEqual(angles('tee', 'Black'), ['front', 'side', 'side', 'back']);
  assert.deepEqual(angles('hoodie', 'Black'), ['front', 'back', 'front', 'back']);
  assert.deepEqual(angles('longsleeve', 'Black'), ['front', 'side', 'front', 'back', 'detail', 'detail']);
  assert.deepEqual(angles('crewneck', 'Black'), ['front', 'back', 'side', 'side']);
  assert.deepEqual(angles('tank', 'Red'), ['front', 'back', 'front', 'back', 'detail', 'detail']);
  assert.deepEqual(angles('youth', 'Navy'), ['flat', 'flat']);
  assert.deepEqual(by.youth.colors[0].photos.map(p => p.view), ['front', 'back']);
  assert.deepEqual(angles('tote', 'Oyster'), ['front']);
  assert.deepEqual(angles('poster', 'White'), ['flat', 'side', 'side', 'flat']);
  assert.deepEqual(angles('mug', 'White'), ['front', 'side', 'side', 'back']);
  assert.ok(by.sticker.colors[0].photos.every(p => p.sampleArt === true), 'sticker photos carry Fourthwall sample art');
  for (const t of r.body.templates) {
    for (const c of t.colors) {
      const live = LIVE[t.blank].colorVariants.find(v => v.color.name === c.name);
      assert.deepEqual(c.photos.map(p => p.url), live.photos.map(p => p.url).slice(0, 8), `${t.blank} ${c.name}`);
      c.photos.forEach((p, i) => { assert.equal(p.index, i); assert.ok(T.ANGLES.includes(p.angle)); });
      // Each colour's base: its cheapest available size.
      assert.equal(c.base, Math.min(...live.sizeVariants.filter(s => s.available && s.price.amount > 0).map(s => s.price.amount)), `${t.blank} ${c.name} base`);
    }
  }
  assert.equal(by.poster.multiColor, false);
});
await test('photos: unknown templates get front for photo 0 and unknown after; strings and objects both work', () => {
  assert.deepEqual(T.labelPhotos('pro_not_checked', ['https://a/1.jpg', { url: 'https://a/2.jpg' }]), [
    { url: 'https://a/1.jpg', angle: 'front', index: 0, view: 'front' },
    { url: 'https://a/2.jpg', angle: 'unknown', index: 1 },
  ]);
  // Photos beyond the known order are 'unknown', never guessed.
  const extra = T.labelPhotos('pro_367', ['https://a/1.jpg', 'https://a/2.jpg']);
  assert.deepEqual(extra.map(p => p.angle), ['front', 'unknown']);
  // Duplicates and non-https dropped; capped at 8; index stays Fourthwall's.
  const list = ['http://x/1.jpg', ...Array.from({ length: 10 }, (_, i) => ({ url: `https://cdn.example/p${i}.jpg` })), { url: 'https://cdn.example/p0.jpg' }];
  const out = M.photosOf(list, 'pro_6ae602fcb22447bfbc');
  assert.equal(out.length, 8);
  assert.deepEqual(out.slice(0, 3).map(p => [p.index, p.angle]), [[1, 'side'], [2, 'front'], [3, 'back']]);
  // Every known template's order covers the photos Fourthwall gives per colour.
  for (const [k, id] of Object.entries(LIVE_IDS)) {
    const n = Math.max(...LIVE[k].colorVariants.map(c => (c.photos || []).length));
    assert.equal(T.PHOTO_ANGLES[id].length, n, `${k} angle list length`);
  }
  // Legacy PHOTOS shape still has the first photo per colour.
  assert.equal(T.PHOTOS.tee.White, T.BLANKS.tee.snapshot.colors[0].photos[0].url);
});

// ─── Several colours in one product ───────────────────────────────────────
await test('create: one product with several colours, validated, priced on the dearest colour', async () => {
  M.reset(); resetFw();
  // A colour with dearer sizes: the base is the dearest chosen colour's cheapest size.
  const ls = JSON.parse(JSON.stringify(LIVE.longsleeve));
  ls.colorVariants.find(c => c.color.name === 'Red').sizeVariants.forEach(s => { s.price.amount += 1.5; });
  fw[`GET /product-templates/${LIVE_IDS.longsleeve}`] = () => reply(200, ls);
  const r = await call(createBody({ colors: ['white', 'Black', 'Red', 'Black'] }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(posted().length, 1, 'one product');
  const sent = posted()[0].body;
  assert.deepEqual(sent.colors, ['White', 'Black', 'Red']);
  assert.equal(sent.sizes, undefined, 'no sizes = Fourthwall default');
  assert.equal(sent.productTemplateId, LIVE_IDS.longsleeve);
  assert.equal(sent.publishOnCreate, false);
  assert.deepEqual(sent.regions.map(x => x.region), ['front_large', 'sleeve_left']);
  assert.equal(sent.profitMargin, 18.7); // 34.99 - (14.79 + 1.5)
  assert.deepEqual(r.body.price, { retail: 34.99, base: 16.29, margin: 18.7 });
  assert.deepEqual(r.body.colors, ['White', 'Black', 'Red']);
  assert.equal(r.body.images.length, 3);
  assert.equal(M.HISTORY[0].color, 'White, Black, Red');
  assert.deepEqual(M.HISTORY[0].colors, ['White', 'Black', 'Red']);
  // One cheap colour only: priced on its own base.
  resetFw(); fw[`GET /product-templates/${LIVE_IDS.longsleeve}`] = () => reply(200, ls); M.reset();
  const one = await call(createBody({ colors: ['Navy'] }));
  assert.equal(one.status, 200);
  assert.equal(posted()[0].body.profitMargin, 20.2);
});
await test('create: bad colour lists are refused before Fourthwall is called', async () => {
  for (const [colors, re] of [[['Black', 'Neon Plaid'], /doesn't come in "Neon Plaid"/], [[], /at least one/], ['Black', /at least one/], [Array.from({ length: 13 }, () => 'Black'), /up to 12/]]) {
    M.reset(); resetFw();
    const r = await call(createBody({ colors }));
    assert.equal(r.status, 400, JSON.stringify(colors));
    assert.equal(r.body.reason, 'colors');
    assert.match(r.body.error, re);
    assert.equal(posted().length, 0);
  }
  // A price under the dearest colour's base + $1 is refused.
  M.reset(); resetFw();
  const low = await call(createBody({ colors: ['White', 'Black'], retail: 15.5 }));
  assert.equal(low.body.reason, 'price');
  assert.equal(posted().length, 0);
});
await test('create: optional sizes are checked and sent; legacy single colour still works', async () => {
  M.reset(); resetFw();
  const r = await call(createBody({ colors: ['Black'], sizes: ['s', 'M', 'XL'] }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(posted()[0].body.sizes, ['S', 'M', 'XL']);
  M.reset(); resetFw();
  const bad = await call(createBody({ colors: ['Black'], sizes: ['9XL'] }));
  assert.equal(bad.body.reason, 'sizes');
  assert.equal(posted().length, 0);
  // The merch6 body (color, no colors): one colour; unknown colour falls back as before.
  M.reset(); resetFw();
  const legacy = await call(createBody({ blank: 'tank', logo: undefined, retail: 27.99, color: 'Red', imageId: 'img_1800' }));
  assert.equal(legacy.status, 200, JSON.stringify(legacy.body));
  assert.deepEqual(posted()[0].body.colors, ['Red']);
  assert.deepEqual(legacy.body.colors, ['Red']);
  M.reset(); resetFw();
  await call(createBody({ blank: 'tote', logo: undefined, retail: 24.99, color: 'White', imageId: 'img_1500' }));
  assert.deepEqual(posted()[0].body.colors, ['Oyster'], 'tote default colour');
});
await test('preview: mockups for several colours in one customization', async () => {
  M.reset(); resetFw();
  const r = await call({ mode: 'preview', blank: 'crewneck', imageId: 'img_2250', logo: { region: 'sleeve_right', imageId: 'img_450' }, colors: ['Navy', 'maroon'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const sent = fwCalls.find(c => c.method === 'POST' && c.path === '/customizations').body;
  assert.deepEqual(sent.colors, ['Navy', 'Maroon']);
  assert.deepEqual(r.body.colors, ['Navy', 'Maroon']);
  assert.equal(r.body.color, 'Navy');
  assert.deepEqual(r.body.images.map(i => i.color), ['Navy', 'Maroon']);
  const bad = await call({ mode: 'preview', blank: 'crewneck', imageId: 'img_2250', colors: ['Plaid'] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.reason, 'colors');
});

// ─── Search fallback, rules ────────────────────────────────────────────────
await test('search fallback only takes DTG blanks of the right kind', async () => {
  M.reset(); resetFw();
  M.BLANKS.youth.ids.forEach(id => { fw[`GET /product-templates/${id}`] = () => reply(404, { code: 'PRODUCT_CATALOG_PRODUCT_ID_NOT_FOUND' }); });
  const dtfx = { ...LIVE.youth, productId: 'pro_dtfx', productionMethod: 'DTFX' };
  const ls = { ...LIVE.youth, productId: 'pro_youth_ls', name: 'Bella+Canvas Youth Long Sleeve T-Shirt' };
  const ok = { ...LIVE.youth, productId: 'pro_youth_ok', name: 'AS Colour Youth Classic Tee' };
  fw['GET /product-templates/search/youth%20tee'] = () => reply(200, { results: [
    { productId: 'pro_youth_ls', name: ls.name, category: 'Apparel/Kids Clothing', productionMethod: 'DTG', supportsBackendRendering: true },
    { productId: 'pro_dtfx', name: 'Gildan Youth Classic Tee', category: 'Apparel/Kids Clothing', productionMethod: 'DTFX', supportsBackendRendering: true },
    { productId: 'pro_youth_ok', name: ok.name, category: 'Apparel/Kids Clothing', productionMethod: 'DTG', supportsBackendRendering: true },
  ] });
  fw['GET /product-templates/pro_dtfx'] = () => reply(200, dtfx);
  fw['GET /product-templates/pro_youth_ls'] = () => reply(200, ls);
  fw['GET /product-templates/pro_youth_ok'] = () => reply(200, ok);
  const t = await M.templateFor('youth');
  assert.equal(t.source, 'search');
  assert.equal(t.templateId, 'pro_youth_ok');
  assert.ok(!fwCalls.some(c => c.path === '/product-templates/pro_dtfx' || c.path === '/product-templates/pro_youth_ls'));
  // Its photos are labelled by the fallback rule (not a checked order).
  assert.deepEqual(t.colors[0].photos.map(p => p.angle), ['front', 'unknown']);
  assert.equal(M.qualifies(dtfx, M.BLANKS.youth), false);
  assert.equal(M.qualifies(dtfx, M.BLANKS.tee), true, 'blanks without `methods` keep the old rule');
});
await test('MerchRules: new BLANKS entries, several-colour pricing helpers', () => {
  for (const k of NEW) {
    assert.ok(R.BLANKS[k], k);
    assert.equal(R.BLANKS[k].label, M.BLANKS[k].label, `${k} label matches the server`);
    assert.equal(R.BLANKS[k].apparel, M.BLANKS[k].apparel, `${k} apparel matches`);
    assert.equal(R.BLANKS[k].minDpi, M.BLANKS[k].minDpi, `${k} minDpi matches`);
  }
  assert.deepEqual(R.BLANK_IDS, T.BLANK_IDS);
  const colors = [{ name: 'White', base: 14.79 }, { name: 'Red', base: 16.29 }, { name: 'Odd' }];
  assert.equal(R.baseForColors(colors, ['white'], 14.79), 14.79);
  assert.equal(R.baseForColors(colors, ['White', 'red'], 14.79), 16.29);
  assert.equal(R.baseForColors(colors, ['Odd'], 14.79), 14.79, 'no base -> fallback');
  assert.equal(R.baseForColors(colors, [], null), null);
  assert.deepEqual(R.priceForColors(34.99, colors, ['White', 'Red'], 14.79), { ok: true, retail: 34.99, base: 16.29, margin: 18.7, earnText: 'You earn about $18.70 per sale (before Fourthwall fees).' });
  assert.equal(R.priceForColors(16.5, colors, ['Red'], 14.79).ok, false);
  assert.equal(R.MAX_COLORS, M.LIMITS.colors);
  assert.equal(M.baseFor({ colors, basePrice: 14.79 }, ['White', 'Red']), 16.29);
});
await test('copy: suggestion priced on the dearest chosen colour (free mode, no AI)', async () => {
  M.reset(); resetFw();
  process.env.AI_DISABLE = '1';
  const ls = JSON.parse(JSON.stringify(LIVE.longsleeve));
  ls.colorVariants.find(c => c.color.name === 'Red').sizeVariants.forEach(s => { s.price.amount += 30; });
  fw[`GET /product-templates/${LIVE_IDS.longsleeve}`] = () => reply(200, ls);
  const r = await call({ mode: 'copy', blank: 'longsleeve', concept: good, content: SOURCE, colors: ['White', 'Red'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.copy.base, 44.79);
  assert.ok(r.body.copy.retail - 44.79 >= 1);
  const plain = await call({ mode: 'copy', blank: 'longsleeve', concept: good, content: SOURCE });
  assert.equal(plain.body.copy.base, 14.79);
  assert.equal(plain.body.copy.retail, 34.99);
  delete process.env.AI_DISABLE;
});

assert.ok(!logs.some(l => l.includes(PASS)), 'secret in logs');
process.stdout.write(`test-merch-products: ${passed} tests passed\n`);
