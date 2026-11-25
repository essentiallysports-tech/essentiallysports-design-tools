/* Merch Designs sample data (local preview and tests only). merch.js uses it
   on localhost, or with ?demo=merch off production, instead of /api/merch;
   ?demo=off turns it off. Everything here is made up and labelled "Sample
   data". scripts/check-merch-ui.mjs serves the same replies as a mocked
   /api/merch, so the shapes follow feature/merch-server (netlify/functions/merch.js). */
(function (root) {
  'use strict';
  const MOCK = 'how-step-review.webp';
  const area = (regionId, name, w, h, design, logo, dpi = 150) => ({ regionId, name, pixelsWidth: w, pixelsHeight: h, dpi, renderable: true, available: true, suitsDesign: design, suitsLogo: logo });
  const spec = (id, regionId, w, h, dpi) => ({ templateId: id, region: 'front', regionId, pixelsWidth: w, pixelsHeight: h, dpi, placementStrategy: 'CENTER', garmentColor: '#FFFFFF' });
  const WHITE = [{ name: 'White', hex: '#FFFFFF' }];
  // One sample template per blank (merch v2: templates with no `blank` = all blanks).
  const TEMPLATES = [
    { blank: 'tee', kind: 'tee', label: 'T-shirt', templateId: 'tpl-tee-sample', name: 'Classic tee (sample)', basePrice: 13.5, suggestedPrice: 25.99, source: 'sample', defaultColor: 'White',
      printSpec: spec('tpl-tee-sample', 'front_large', 2250, 2700, 150),
      colors: [{ name: 'White', hex: '#FFFFFF' }, { name: 'Black', hex: '#101114' }, { name: 'Navy', hex: '#0B1F3A' }, { name: 'Red', hex: '#B0102A' }, { name: 'Royal', hex: '#1257B8' }],
      sizes: ['S', 'M', 'L', 'XL', '2XL'],
      areas: [area('front_large', 'Front', 2250, 2700, true, false), area('back_large', 'Back', 2250, 2700, true, false), area('sleeve_left', 'Left sleeve', 600, 525, false, true), area('sleeve_right', 'Right sleeve', 600, 525, false, true)] },
    { blank: 'hoodie', kind: 'hoodie', label: 'Hoodie', templateId: 'tpl-hoodie-sample', name: 'Pullover hoodie (sample)', basePrice: 29.5, suggestedPrice: 47.99, source: 'sample', defaultColor: 'Black',
      printSpec: spec('tpl-hoodie-sample', 'front_large', 1800, 1650, 150),
      colors: [{ name: 'Black', hex: '#101114' }, { name: 'White', hex: '#FFFFFF' }, { name: 'Navy', hex: '#0B1F3A' }, { name: 'Grey', hex: '#8A8D8F' }],
      sizes: ['S', 'M', 'L', 'XL', '2XL'],
      areas: [area('front_large', 'Front', 1800, 1650, true, false), area('back_large', 'Back', 2250, 2700, true, false), area('sleeve_left', 'Left sleeve', 600, 525, false, true), area('back_neck', 'Back neck', 750, 300, false, true)] },
    { blank: 'poster', kind: 'poster', label: 'Poster', templateId: 'tpl-poster-sample', name: 'Matte poster 18×24 (sample)', basePrice: 11.2, suggestedPrice: 21.99, source: 'sample', defaultColor: 'White',
      printSpec: spec('tpl-poster-sample', 'default', 5400, 7200, 300), colors: WHITE, sizes: ['18×24'],
      areas: [area('default', 'Print', 5400, 7200, true, false, 300)] },
    { blank: 'sticker', kind: 'sticker', label: 'Sticker', templateId: 'tpl-sticker-sample', name: 'Kiss-cut sticker 4×4 (sample)', basePrice: 2.6, suggestedPrice: 6.99, source: 'sample', defaultColor: 'White',
      printSpec: spec('tpl-sticker-sample', 'default', 1200, 1200, 300), colors: WHITE, sizes: ['4×4'],
      areas: [area('default', 'Print', 1200, 1200, true, false, 300)] },
    { blank: 'mug', kind: 'mug', label: 'Mug', templateId: 'tpl-mug-sample', name: 'Ceramic mug 11 oz (sample)', basePrice: 7.9, suggestedPrice: 15.99, source: 'sample', defaultColor: 'White',
      printSpec: spec('tpl-mug-sample', 'default', 2550, 1050, 300), colors: WHITE, sizes: ['11 oz'],
      areas: [area('default', 'Wrap', 2550, 1050, true, false, 300)] },
  ];
  const CONCEPTS = [
    { id: 's1', collection: 'replay', title: 'Sample Lakers bench era', team: { id: 'lal', name: 'Los Angeles Lakers' }, palette: { a: '#552583', b: '#FDB927', ink: '#FFFFFF' }, garment: { color: '#FFFFFF', name: 'White' },
      stack: [{ text: 'Kobe', size: 'big', fill: 'a', ink: 'ink' }, { text: 'Smush', size: 'big', fill: 'b', ink: 'ink' }, { text: 'Luke', size: 'big', fill: 'a', ink: 'ink' }, { text: 'Kwame', size: 'big', fill: 'b', ink: 'ink' }, { text: 'Mihm', size: 'big', fill: 'a', ink: 'ink' }],
      align: 'center', blanks: ['tee'], rights: [{ kind: 'name', text: 'Kobe, Smush, Luke, Kwame, Mihm' }, { kind: 'team', text: 'Lakers colours' }], why: 'A roster only real fans remember.' },
    { id: 's2', collection: 'quote', title: 'Ball don’t lie', team: null, palette: { a: '#FFFFFF', b: '#033162', ink: '#1257B8' }, garment: { color: '#B0102A', name: 'Red' },
      stack: [{ text: 'Ball don’t lie', size: 'big', fill: 'white', ink: 'ink' }], align: 'center', blanks: ['tee'], rights: [{ kind: 'quote', text: 'Ball don’t lie' }], why: 'Short, exact and instantly known.' },
    { id: 's3', collection: 'nickname', title: 'Megatron', team: { id: 'det', name: 'Detroit Lions' }, palette: { a: '#B0B7BC', b: '#0076B6', ink: '#0076B6' }, garment: { color: '#0076B6', name: 'Royal' },
      stack: [{ text: 'Megatron', size: 'big', fill: 'a', ink: 'ink' }], align: 'center', blanks: ['tee'], rights: [{ kind: 'nickname', text: 'Megatron' }, { kind: 'team', text: 'Lions colours' }], why: 'Almost famous: one word, one era.' },
    { id: 's4', collection: 'core', title: 'We center fans', team: null, palette: { a: '#0A7DFA', b: '#033162', ink: '#FFFFFF' }, garment: { color: '#FFFFFF', name: 'White' },
      stack: [{ text: 'We center', size: 'big', fill: 'a', ink: 'ink' }, { text: 'fans', size: 'big', fill: 'b', ink: 'ink' }], align: 'left', blanks: ['tee'], rights: [], why: 'An ES line, ours to sell.' },
  ];
  const TRENDS = [
    { id: 't1', title: 'Sample: a rookie’s 50-point night', category: 'nba', rank: 90 },
    { id: 't2', title: 'Sample: the comeback nobody saw coming', category: 'nfl', rank: 80 },
    { id: 't3', title: 'Sample: a walk-off in extra innings', category: 'mlb', rank: 70 },
  ];
  const IMAGES = [{ url: MOCK, width: 1000, height: 1000 }, { url: MOCK, width: 1000, height: 1000 }];
  let product = null;
  const SHOP = 'https://sample-shop.example/products/';
  const COLLECTIONS = [{ id: 'col_fan', name: 'Fan favourites (sample)', count: 4 }, { id: 'col_replay', name: 'Replay era (sample)', count: 2 }, { id: 'col_core', name: 'Core ES (sample)', count: 3 }];
  const memberOf = {}; // productId -> collection ids
  const day = n => new Date(Date.UTC(2026, 10, 25 - n, 15)).toISOString();
  const LIST = [
    { productId: 'prod_s1', title: 'Ball don’t lie Tee (sample)', url: SHOP + 'ball-dont-lie-tee', state: 'PUBLIC', thumb: MOCK, blank: 'tee', color: 'Red', createdAt: day(2), createdBy: 'qa@essentiallysports.com', units30: 14, revenue30: 364 },
    { productId: 'prod_s2', title: 'Megatron Hoodie (sample)', url: SHOP + 'megatron-hoodie', state: 'HIDDEN', thumb: MOCK, blank: 'hoodie', color: 'Black', createdAt: day(5), createdBy: 'qa@essentiallysports.com', units30: 0, revenue30: 0 },
    { productId: 'prod_s3', title: 'We center fans Mug (sample)', url: SHOP + 'we-center-fans-mug', state: 'PUBLIC', thumb: MOCK, blank: 'mug', color: 'White', createdAt: day(9), createdBy: 'designer@essentiallysports.com', units30: 6, revenue30: 95.94 },
    { productId: 'prod_s4', title: 'Sample Lakers bench era Poster (sample)', url: '', state: 'ARCHIVED', thumb: '', blank: 'poster', color: 'White', createdAt: day(21), createdBy: 'designer@essentiallysports.com', units30: 1, revenue30: 21.99 },
  ];
  const listNow = () => LIST.map(p => ({ ...p }));
  // reply(body, scenario) -> [httpStatus, json]. Shapes follow netlify/functions/merch.js.
  function reply(body = {}, scenario = 'ok') {
    const m = body.mode;
    const pushModes = ['upload-url', 'upload-relay', 'register', 'preview', 'create', 'publish', 'hide', 'archive', 'collection-create', 'collection-set'];
    if (scenario === 'not-set-up' && (pushModes.includes(m) || m === 'templates' || m === 'product')) return [503, { ok: false, reason: 'not-set-up', error: 'Fourthwall isn’t set up yet. Ask an admin to add FOURTHWALL_API_USERNAME / PASSWORD in Vercel.' }];
    if (scenario === 'error' && m !== 'status') return [502, { ok: false, reason: 'fourthwall', error: 'Fourthwall didn’t answer. Try again in a moment.' }];
    if (scenario === 'cant-push' && pushModes.includes(m)) return [403, { ok: false, reason: 'cant-push', error: 'Only admins can put merch on Fourthwall. Ask an admin to publish this.' }];
    if (scenario === 'cap' && m === 'create') return [429, { ok: false, reason: 'daily-cap', error: 'You’ve sent 10 products to the shop today, the daily limit. More tomorrow.' }];
    switch (m) {
      case 'status': return [200, { ok: true, configured: scenario !== 'not-set-up', shop: scenario === 'not-set-up' ? null : { name: 'Sample shop', publicDomain: 'sample-shop.example', status: 'ACTIVE' }, canPush: scenario !== 'cant-push', caps: { person: { used: 0, limit: 10, left: 10 }, team: { used: 0, limit: 30, left: 30 } }, rightsPolicy: 'acknowledge', blanks: ['tee', 'hoodie', 'poster', 'sticker', 'mug'], notice: '' }];
      case 'templates': return [200, { ok: true, templates: body.blank ? TEMPLATES.filter(t => t.blank === body.blank) : TEMPLATES }];
      case 'concepts': return scenario === 'free' ? [200, { ok: true, concepts: null, free: true }] : [200, { ok: true, concepts: CONCEPTS }];
      case 'copy': {
        const t = TEMPLATES.find(x => x.blank === body.blank) || TEMPLATES[0];
        const name = { tee: 'Tee', hoodie: 'Hoodie', poster: 'Poster', sticker: 'Sticker', mug: 'Mug' }[t.blank];
        return [200, { ok: true, copy: { title: `${body.concept?.title || 'ES'} ${name}`, description: `The ES stacked-pill design on a ${t.label.toLowerCase()}. Made to order.`, retail: t.suggestedPrice, base: t.basePrice, margin: Math.round((t.suggestedPrice - t.basePrice) * 100) / 100 } }];
      }
      case 'upload-url': return [200, { ok: true, uploadUrl: '/__qa/upload', fileUrl: 'https://storage.example/sample.png', expiresAt: null, method: 'PUT' }];
      case 'upload-relay': return /^merch-art\/|^[\w-]+\/[\w.-]+\.png$/.test(String(body.path || '')) && body.uploadUrl && Number(body.size) > 0 ? [200, { ok: true }] : [400, { ok: false, error: 'Missing the uploaded file.' }];
      case 'register': return [200, { ok: true, imageId: 'img_' + Math.random().toString(36).slice(2, 9) }];
      case 'preview': return [200, { ok: true, customizationId: 'cus_sample', images: IMAGES, color: body.color }];
      case 'create': {
        product = { id: 'prod_' + Date.now().toString(36), state: 'HIDDEN' };
        const retail = Number(body.retail) || 30;
        const base = (TEMPLATES.find(x => x.blank === body.blank) || TEMPLATES[0]).basePrice;
        if (Array.isArray(body.collectionIds)) memberOf[product.id] = body.collectionIds.slice();
        LIST.unshift({ productId: product.id, title: body.title, url: SHOP + 'sample-product', state: 'HIDDEN', thumb: MOCK, blank: body.blank || 'tee', color: body.color || 'White', createdAt: new Date().toISOString(), createdBy: 'qa@essentiallysports.com', units30: 0, revenue30: 0 });
        return [200, { ok: true, productId: product.id, state: 'HIDDEN', title: body.title, description: body.description, images: IMAGES, price: { retail, base, margin: Math.round((retail - base) * 100) / 100 }, ack: body.ack, productUrl: SHOP + 'sample-product', collectionIds: memberOf[product.id] || [], caps: { person: { used: 1, limit: 10, left: 9 }, team: { used: 1, limit: 30, left: 29 } } }];
      }
      case 'publish': case 'hide': {
        const state = m === 'publish' ? 'PUBLIC' : 'HIDDEN';
        if (product) product.state = state;
        return [200, { ok: true, state, product: { id: body.productId, state, url: 'https://sample-shop.example/products/sample-product', images: IMAGES } }];
      }
      case 'product': {
        const row = LIST.find(p => p.productId === body.productId);
        const state = product?.id === body.productId ? product.state : row?.state || 'HIDDEN';
        return [200, { ok: true, product: { id: body.productId, productId: body.productId, state, url: row?.url || SHOP + 'sample-product', images: IMAGES, thumb: MOCK, refreshed: Boolean(body.refresh), collectionIds: memberOf[body.productId] || [] } }];
      }
      case 'archive': {
        if (body.confirm !== true) return [400, { ok: false, reason: 'confirm', error: 'Archiving is permanent. Confirm it first.' }];
        const row = LIST.find(p => p.productId === body.productId);
        if (row) row.state = 'ARCHIVED';
        if (product?.id === body.productId) product.state = 'ARCHIVED';
        return [200, { ok: true, product: { id: body.productId, state: 'archived' } }];
      }
      case 'list': return scenario === 'empty-list' ? [200, { ok: true, products: [], source: 'db' }] : [200, { ok: true, products: listNow(), source: scenario === 'no-db' ? 'fourthwall' : 'db' }];
      case 'collections': return [200, { ok: true, collections: COLLECTIONS.map(c => ({ ...c })) }];
      case 'collection-create': {
        const name = String(body.name || '').trim().slice(0, 60);
        if (name.length < 2) return [400, { ok: false, error: 'Give the collection a name.' }];
        const collection = { id: 'col_' + name.toLowerCase().replace(/\W+/g, '-').slice(0, 24) + '_' + COLLECTIONS.length, name, count: 0 };
        COLLECTIONS.push(collection);
        return [200, { ok: true, collection }];
      }
      case 'collection-set': {
        const ids = (Array.isArray(body.collectionIds) ? body.collectionIds : []).filter(id => COLLECTIONS.some(c => c.id === id));
        memberOf[body.productId] = ids;
        return [200, { ok: true, collections: COLLECTIONS.filter(c => ids.includes(c.id)).map(c => ({ ...c })) }];
      }
      case 'sales': {
        const rows = LIST.filter(p => !body.productId || p.productId === body.productId).map(p => ({ productId: p.productId, units7: Math.round(p.units30 / 3), revenue7: Math.round(p.revenue30 / 3 * 100) / 100, units30: p.units30, revenue30: p.revenue30, unitsAll: p.units30 + 2, revenueAll: Math.round((p.revenue30 * 1.2) * 100) / 100 }));
        return [200, { ok: true, products: rows, updatedAt: new Date().toISOString() }];
      }
      default: return [200, { ok: true }];
    }
  }
  // Sample stand-in for Supabase Storage (merch-art/<user>/<file>.png): records the path only.
  const stored = [];
  async function storageUpload(path, blob) { stored.push({ path, size: blob?.size || 0 }); return { path }; }
  root.MerchDemo = { TEMPLATES, CONCEPTS, TRENDS, COLLECTIONS, LIST, stored, storageUpload, reply };
}(typeof self !== 'undefined' ? self : this));
