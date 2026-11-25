/* Merch Designs sample data (local preview and tests only). merch.js uses it
   on localhost, or with ?demo=merch off production, instead of /api/merch;
   ?demo=off turns it off. Everything here is made up and labelled "Sample
   data". scripts/check-merch-ui.mjs serves the same replies as a mocked
   /api/merch, so the shapes below are the ones the UI expects:
     status    { configured, canPush, free, capLeft, shop:{ name, publicDomain }, collections:[{ id, name }] }
     templates { templates:[{ id, name, blank, priceFrom, colors:[{ name, hex }], sizes, areas:[{ region, label?, logo?, pixelsWidth, pixelsHeight, dpi, placements }] }] }
     concepts  { concepts: Concept[] } | { concepts: null, free: true }
     copy      { title, description, price }
     upload-url { uploadUrl, fileUrl }      register { imageId }
     preview   { mockups:[{ color, url }] }
     create / product / publish / hide { product }    archive { ok }
     list      { products:[product] }
   product = { id, name, url, state: 'HIDDEN'|'AVAILABLE'|'ARCHIVED', price, mockups:[{ color, url }], variants:[{ sku, color, size, price, stock }], createdAt } */
(function (root) {
  'use strict';
  const MOCK = 'how-step-review.webp';
  const TEMPLATES = [
    { id: 'tpl-tee-classic', name: 'Classic tee (sample)', blank: 'tee', priceFrom: 13.5, thumbnail: '',
      colors: [{ name: 'White', hex: '#FFFFFF' }, { name: 'Black', hex: '#101114' }, { name: 'Navy', hex: '#0B1F3A' }, { name: 'Red', hex: '#B0102A' }, { name: 'Royal', hex: '#1257B8' }],
      sizes: ['S', 'M', 'L', 'XL', '2XL'],
      areas: [{ region: 'front', pixelsWidth: 3600, pixelsHeight: 4800, dpi: 300, placements: ['center', 'left-chest'] }, { region: 'back', pixelsWidth: 3600, pixelsHeight: 4800, dpi: 300, placements: ['center'] },
        { region: 'sleeve-left', label: 'Left sleeve', logo: true, pixelsWidth: 1200, pixelsHeight: 1200, dpi: 300, placements: ['center'] }, { region: 'sleeve-right', label: 'Right sleeve', logo: true, pixelsWidth: 1200, pixelsHeight: 1200, dpi: 300, placements: ['center'] },
        { region: 'back-neck', label: 'Back neck', logo: true, pixelsWidth: 1500, pixelsHeight: 600, dpi: 300, placements: ['center'] }, { region: 'neck-label', label: 'Neck label', logo: true, pixelsWidth: 900, pixelsHeight: 900, dpi: 300, placements: ['center'] }] },
    { id: 'tpl-tee-heavy', name: 'Heavyweight tee (sample)', blank: 'tee', priceFrom: 17.25, thumbnail: '',
      colors: [{ name: 'White', hex: '#FFFFFF' }, { name: 'Black', hex: '#101114' }, { name: 'Forest', hex: '#123D2A' }],
      sizes: ['S', 'M', 'L', 'XL'],
      areas: [{ region: 'front', pixelsWidth: 3000, pixelsHeight: 4000, dpi: 300, placements: ['center'] }, { region: 'back-neck', label: 'Back neck', logo: true, pixelsWidth: 1500, pixelsHeight: 600, dpi: 300, placements: ['center'] }] },
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
  let product = null;
  const products = [
    { id: 'p-old-1', name: 'We center fans tee (sample)', url: 'https://sample-shop.example/products/we-center-fans', state: 'AVAILABLE', price: 32, createdAt: '2026-11-20T10:00:00Z', mockups: [{ color: 'White', url: MOCK }], variants: [] },
  ];
  function makeProduct(body) {
    const tpl = TEMPLATES.find(t => t.id === body.templateId) || TEMPLATES[0];
    const colors = (body.colors && body.colors.length ? body.colors : ['White']);
    const sizes = tpl.sizes.slice(0, 4);
    return {
      id: 'p-' + Date.now().toString(36), name: body.title || 'Sample product', url: 'https://sample-shop.example/products/sample-product',
      state: 'HIDDEN', price: Number(body.price) || 30, createdAt: new Date().toISOString(),
      mockups: colors.map(c => ({ color: c, url: MOCK })),
      variants: colors.flatMap(c => sizes.map(s => ({ sku: `ES-${String(c).slice(0, 3).toUpperCase()}-${s}`, color: c, size: s, price: Number(body.price) || 30, stock: 'Made to order' }))),
    };
  }
  // reply(body, scenario) -> [httpStatus, json]
  function reply(body = {}, scenario = 'ok') {
    const m = body.mode;
    if (scenario === 'not-set-up' && m !== 'concepts' && m !== 'copy') return m === 'status' ? [200, { ok: true, configured: false, canPush: false }] : [503, { ok: false, reason: 'not-set-up', error: 'Fourthwall isn’t set up yet. Ask an admin to add FOURTHWALL_API_USERNAME / PASSWORD in Vercel.' }];
    if (scenario === 'error' && m !== 'status') return [502, { ok: false, reason: 'fourthwall', error: 'Fourthwall didn’t answer. Try again in a moment.' }];
    const pushModes = ['upload-url', 'upload-relay', 'register', 'create', 'publish', 'hide', 'archive'];
    if (scenario === 'cant-push' && pushModes.includes(m)) return [403, { ok: false, reason: 'cant-push', error: 'Only admins can put merch on Fourthwall. Ask an admin to publish this.' }];
    switch (m) {
      case 'status': return [200, { ok: true, configured: true, canPush: scenario !== 'cant-push', free: scenario === 'free', capLeft: 10, shop: { name: 'Sample shop', publicDomain: 'sample-shop.example' }, collections: [{ id: 'c-replay', name: 'Replay' }, { id: 'c-core', name: 'Core ES' }] }];
      case 'templates': return [200, { ok: true, templates: TEMPLATES }];
      case 'concepts': return scenario === 'free' ? [200, { ok: true, concepts: null, free: true }] : [200, { ok: true, concepts: CONCEPTS, cost: { usd: 0.002 } }];
      case 'copy': return [200, { ok: true, title: `${body.concept?.title || 'ES'} tee`, description: 'Soft cotton tee with the ES stacked-pill design. Made to order by Fourthwall.', price: 32 }];
      case 'upload-url': return [200, { ok: true, uploadUrl: '/__qa/upload', fileUrl: 'https://storage.example/sample.png' }];
      case 'upload-relay': return [200, { ok: true, imageId: 'img-relay-1' }];
      case 'register': return [200, { ok: true, imageId: 'img-sample-' + Math.random().toString(36).slice(2, 7) }];
      case 'preview': return [200, { ok: true, mockups: (body.colors || ['White']).slice(0, 4).map(c => ({ color: c, url: MOCK })) }];
      case 'create': product = makeProduct(body); products.unshift(product); return [200, { ok: true, product }];
      case 'publish': case 'hide': {
        const p = products.find(x => x.id === body.productId) || product;
        if (p) p.state = m === 'publish' ? 'AVAILABLE' : 'HIDDEN';
        return [200, { ok: true, product: p }];
      }
      case 'archive': { const i = products.findIndex(x => x.id === body.productId); if (i >= 0) products.splice(i, 1); return [200, { ok: true }]; }
      case 'product': return [200, { ok: true, product: products.find(x => x.id === body.productId) || product }];
      case 'list': return [200, { ok: true, products }];
      default: return [200, { ok: true }];
    }
  }
  root.MerchDemo = { TEMPLATES, CONCEPTS, TRENDS, reply };
}(typeof self !== 'undefined' ? self : this));
