/* Merch Designs sample data (local preview and tests only). merch.js uses it
   on localhost, or with ?demo=merch off production, instead of /api/merch;
   ?demo=off turns it off. Everything here is made up and labelled "Sample
   data". scripts/check-merch-ui.mjs serves the same replies as a mocked
   /api/merch, so the shapes follow feature/merch-server (netlify/functions/merch.js). */
(function (root) {
  'use strict';
  const MOCK = 'how-step-review.webp';
  const area = (regionId, name, w, h, design, logo) => ({ regionId, name, pixelsWidth: w, pixelsHeight: h, dpi: 150, renderable: true, available: true, suitsDesign: design, suitsLogo: logo });
  const TEMPLATES = [
    { templateId: 'tpl-tee-sample', name: 'Classic tee (sample)', basePrice: 13.5, source: 'sample', defaultColor: 'White',
      printSpec: { templateId: 'tpl-tee-sample', region: 'front', regionId: 'front_large', pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150, placementStrategy: 'CENTER', garmentColor: '#FFFFFF' },
      colors: [{ name: 'White', hex: '#FFFFFF' }, { name: 'Black', hex: '#101114' }, { name: 'Navy', hex: '#0B1F3A' }, { name: 'Red', hex: '#B0102A' }, { name: 'Royal', hex: '#1257B8' }],
      sizes: ['S', 'M', 'L', 'XL', '2XL'],
      areas: [area('front_large', 'Front', 2250, 2700, true, false), area('back_large', 'Back', 2250, 2700, true, false), area('sleeve_left', 'Left sleeve', 600, 525, false, true), area('sleeve_right', 'Right sleeve', 600, 525, false, true)] },
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
  // reply(body, scenario) -> [httpStatus, json]. Shapes follow netlify/functions/merch.js.
  function reply(body = {}, scenario = 'ok') {
    const m = body.mode;
    const pushModes = ['upload-url', 'register', 'preview', 'create', 'publish', 'hide'];
    if (scenario === 'not-set-up' && (pushModes.includes(m) || m === 'templates' || m === 'product')) return [503, { ok: false, reason: 'not-set-up', error: 'Fourthwall isn’t set up yet. Ask an admin to add FOURTHWALL_API_USERNAME / PASSWORD in Vercel.' }];
    if (scenario === 'error' && m !== 'status') return [502, { ok: false, reason: 'fourthwall', error: 'Fourthwall didn’t answer. Try again in a moment.' }];
    if (scenario === 'cant-push' && pushModes.includes(m)) return [403, { ok: false, reason: 'cant-push', error: 'Only admins can put merch on Fourthwall. Ask an admin to publish this.' }];
    if (scenario === 'cap' && m === 'create') return [429, { ok: false, reason: 'daily-cap', error: 'You’ve sent 10 products to the shop today, the daily limit. More tomorrow.' }];
    switch (m) {
      case 'status': return [200, { ok: true, configured: scenario !== 'not-set-up', shop: scenario === 'not-set-up' ? null : { name: 'Sample shop', publicDomain: 'sample-shop.example', status: 'ACTIVE' }, canPush: scenario !== 'cant-push', caps: { person: { used: 0, limit: 10, left: 10 }, team: { used: 0, limit: 30, left: 30 } }, rightsPolicy: 'acknowledge', blanks: ['tee'], notice: '' }];
      case 'templates': return [200, { ok: true, templates: TEMPLATES }];
      case 'concepts': return scenario === 'free' ? [200, { ok: true, concepts: null, free: true }] : [200, { ok: true, concepts: CONCEPTS }];
      case 'copy': return [200, { ok: true, copy: { title: `${body.concept?.title || 'ES'} Tee`, description: 'Soft cotton tee with the ES stacked-pill design. Made to order.', retail: 32, base: 13.5, margin: 18.5 } }];
      case 'upload-url': return [200, { ok: true, uploadUrl: '/__qa/upload', fileUrl: 'https://storage.example/sample.png', expiresAt: null, method: 'PUT' }];
      case 'upload-relay': return [501, { ok: false, reason: 'not-ready', error: 'Not available yet.' }];
      case 'register': return [200, { ok: true, imageId: 'img_' + Math.random().toString(36).slice(2, 9) }];
      case 'preview': return [200, { ok: true, customizationId: 'cus_sample', images: IMAGES, color: body.color }];
      case 'create': {
        product = { id: 'prod_' + Date.now().toString(36), state: 'HIDDEN' };
        const retail = Number(body.retail) || 30;
        return [200, { ok: true, productId: product.id, state: 'HIDDEN', title: body.title, description: body.description, images: IMAGES, price: { retail, base: 13.5, margin: Math.round((retail - 13.5) * 100) / 100 }, ack: body.ack, productUrl: 'https://sample-shop.example/products/sample-product', caps: { person: { used: 1, limit: 10, left: 9 }, team: { used: 1, limit: 30, left: 29 } } }];
      }
      case 'publish': case 'hide': {
        const state = m === 'publish' ? 'PUBLIC' : 'HIDDEN';
        if (product) product.state = state;
        return [200, { ok: true, state, product: { id: body.productId, state, url: 'https://sample-shop.example/products/sample-product', images: IMAGES } }];
      }
      case 'product': return [200, { ok: true, product: { id: body.productId, state: product?.state || 'HIDDEN', images: IMAGES } }];
      case 'archive': case 'list': return [501, { ok: false, reason: 'not-ready', error: 'Not available yet.' }];
      default: return [200, { ok: true }];
    }
  }
  root.MerchDemo = { TEMPLATES, CONCEPTS, TRENDS, reply };
}(typeof self !== 'undefined' ? self : this));
