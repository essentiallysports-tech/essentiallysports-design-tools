'use strict';
// Curated Fourthwall blanks for Merch Designs: tee, hoodie, poster, sticker, mug,
// and (merch7) long sleeve tee, crewneck sweatshirt, tank, youth tee, tote bag.
//
// Every id below was re-checked on 2026-11-25 with the public, no-key
// GET /open-api/v1.0/product-templates/{id} (supportsBackendRendering: true,
// minimumOrdersNumber: 0, not embroidery). Trimmed copies of those replies are
// in scripts/fixtures/fourthwall-blank-templates.json.
//
//   tee     pro_Vv1XdaPMSdm6jZ5pj24NCQ  Stanley/Stella Organic Ribbed Neck Tee, DTG, $15.85
//           (proven end to end on a real shop, owner's ~/fourthwall-merch).
//           front_large 2250 x 2700 @150 (15 x 18 in), placement largeCenter;
//           sleeves 600 x 525 suit the ES logo.
//           Alternates: pro_e4677535402b4eeb81 (Gildan Heavyweight, $9.50),
//           pro_EJBSRKhJSd2unv4ZnGKwdQ (AS Colour Premium, $16.32).
//   hoodie  pro_380  Cotton Heritage Unisex Premium Hoodie, DTG, $27.29, 21 colours.
//           front 1650 x 1650 @150 (11 x 11 in), placement largeCenter;
//           back_large 2250 x 2700; sleeves 450 x 1800 suit the ES logo.
//   poster  pro_15bc29bc8a324d449d  Enhanced Matte Paper Poster, PRINTED, from $5.50 (5 x 7 in).
//           One area "default" 1500 x 2100 @300 (5 x 7 in); bigger sizes are
//           priced per size. No second area, so the ES logo sits inside the print.
//   sticker pro_358  Kiss Cut Stickers, from $2.29 (3 x 3 in).
//           One area "default" 900 x 900 @300, placement fullSize. Logo inside the print.
//   mug     pro_4v5OfYhyRx62KW5b7Oj6Uw  White Glossy Mug 11oz, SUBLIMATION, $5.95.
//           One area "default" 2700 x 1050 @300 (9 x 3.5 in): a full wrap
//           (placements front / back exist; FrameUp prints the whole wrap).
//
// merch7 blanks, picked on 2026-11-26 from the public, no-key
// GET /open-api/v1.0/product-templates/search/{q} and checked one by one with
// GET /product-templates/{id}: productionMethod DTG, supportsBackendRendering
// true, minimumOrdersNumber 0, the main area available + rendered. The cheapest
// DTG blank of each kind that has enough colours and a real model / product
// photo set; sleeves wherever the blank has them (the ES logo goes there).
//   longsleeve pro_6ae602fcb22447bfbc  Gildan Ultra Cotton Long Sleeve T-Shirt, DTG, $14.79, 15 colours.
//           front_large 2250 x 2700 @150 (15 x 18 in), placement largeCenter; back_large;
//           sleeves 450 x 1800 suit the ES logo. 6 photos per colour. 5XL is out of stock
//           in every colour (Fourthwall shows the sizes per colour).
//           Alternate: pro_dYdJWPXgROCj0IaEHR8VPA (Comfort Colors Garment-Dyed LS, $19.62, sleeves).
//   crewneck pro_14kNy0EJQkqopY-Z9Pm41A  Gildan Classic Crewneck Sweatshirt, DTG, $18.79, 25 colours.
//           front_large 2250 x 2700 @150, placement largeCenter; back_large; sleeves 450 x 1800.
//           Alternate: pro_EYvD6dHZRNO4QdKC9cRf0Q (Lane Seven Premium Crewneck, $21.75).
//   tank    pro_xPL7YjOBRQWVL50Im8eKAA  Bella+Canvas Jersey Tank, DTG, $14.20, 6 colours.
//           front 1800 x 2400 @150 (12 x 16 in), placement largeCenter; back. No sleeves,
//           so the ES logo sits inside the print. Alternate: pro_606c3460ee07410a83
//           (Cotton Heritage Men's Premium Tank, $16.16, 13 colours).
//   youth   pro_ODh_gv0ESl6jIcRfvSww0w  Gildan Youth Classic Tee, DTG, $9.69, 13 colours, XS-XL.
//           front 1500 x 1800 @150 (10 x 12 in), placement largeCenter; back. No sleeves:
//           logo inside. Photos are flat lays (front, back). Alternate:
//           pro_87a51e0a16ab42f9ae (Bella+Canvas Youth Short Sleeve, $13.50, 17 colours).
//   tote    pro_367  Econscious Eco-Friendly Tote Bag, DTG, $15.56, Oyster + Black, one size.
//           front 1500 x 1500 @150 (10 x 10 in), no placements (FULL_REGION); back. Logo
//           inside. Alternate: pro_5a05131dbedf41a39b (Econscious Organic Cotton Tote, $18.31).
// Skipped: embroidery-only and DTFX twins of the same garments, all-over-print
// blanks (supportsBackendRendering false) and the clear UV tote.
//
// Photos and angles. Fourthwall's colorVariants[].photos[] is { url,
// designOverlay: null } with no angle label, and the URL is an encrypted
// imgproxy link, so the angle can't be read from it. The ORDER is fixed per
// template: the same index shows the same view in every colour (checked by eye on
// two colours of every curated template, 2026-11-26). PHOTO_ANGLES below records
// that order per template id. A template not listed (a pinned id, an alternate,
// a search result) gets photo 0 = 'front' (true for every template checked) and
// 'unknown' for the rest, so nothing is drawn on a guessed angle.
// Snapshot photos (every photo of each snapshot colour) are in
// _merch-template-photos.js.
//
// MERCH_TEMPLATES="tee=<id>,mug=<id>" pins other ids. If every id stops
// qualifying, the server searches `search` and takes the first blank in
// `category` that qualifies. `snapshot` is used only when Fourthwall can't be
// reached, so the designer can still draw at the right size.
//
// Pricing per blank lives in merch-rules.js (BLANKS[kind].retail / margin).

const TEE_COLORS = [
  ['White', '#ffffff'], ['Black', '#020202'], ['French Navy', '#020718'], ['Red', '#ed0739'], ['Burgundy', '#801f24'],
  ['Heather Grey', '#cfcbc8'], ['Dark Heather Grey', '#2b2928'], ['Stargazer', '#3d737d'], ['Khaki', '#6e6b4d'], ['Desert Dust', '#cab9aa'],
];
const HOODIE_COLORS = [
  ['White', '#fefefe'], ['Black', '#080808'], ['Navy Blazer', '#292d3b'], ['Team Royal', '#2d407d'], ['Team Red', '#ff2d41'],
  ['Maroon', '#7d263a'], ['Forest Green', '#335231'], ['Team Gold', '#ffa912'], ['Carbon Grey', '#c7c3be'], ['Charcoal Heather', '#463e3d'],
];
const LONGSLEEVE_COLORS = [
  ['White', '#f1f0f5'], ['Black', '#14191e'], ['Navy', '#191c25'], ['Red', '#af011f'], ['Royal', '#295293'],
  ['Forest Green', '#213b21'], ['Maroon', '#471924'], ['Sport Grey', '#9b969c'], ['Military Green', '#565543'], ['Sand', '#d4cab4'],
];
const CREWNECK_COLORS = [
  ['White', '#ffffff'], ['Black', '#000000'], ['Navy', '#050c1d'], ['Red', '#da0a1a'], ['Royal', '#1d50a4'],
  ['Forest Green', '#1a3626'], ['Maroon', '#47171c'], ['Sport Grey', '#9b969c'], ['Dark Heather', '#46484d'], ['Gold', '#ffaf24'],
];
const TANK_COLORS = [['White', '#ffffff'], ['Black', '#000000'], ['Navy', '#202b45'], ['True Royal', '#104184'], ['Red', '#a22432'], ['Athletic Heather', '#b5b4b4']];
const YOUTH_COLORS = [
  ['White', '#e4e4e4'], ['Black', '#272727'], ['Navy', '#2c2f40'], ['Royal', '#224d8f'], ['Red', '#da0a1a'],
  ['Sport Grey', '#c7c7cf'], ['Gold', '#eead1b'], ['Charcoal', '#66676c'], ['Light Blue', '#c1d5e6'], ['Light Pink', '#ffd4d5'],
];
const TOTE_COLORS = [['Oyster', '#f6ebcd'], ['Black', '#060606']];

// Photo order per template id (see the header). view: which face of the blank
// the photo shows, so a 'flat' or 'lifestyle' photo still says front or back.
// sampleArt: Fourthwall's own example print is on the photo (never a FrameUp mockup).
const A = (angle, view = angle === 'back' ? 'back' : angle === 'detail' || angle === 'lifestyle' ? '' : 'front', extra = {}) => ({ angle, view, ...extra });
const PHOTO_ANGLES = Object.freeze({
  // Stanley/Stella tee: waist-up front, waist-up three-quarter, full-body back three-quarter, full-body back.
  pro_Vv1XdaPMSdm6jZ5pj24NCQ: [A('front'), A('side'), A('side', 'back'), A('back')],
  // Cotton Heritage hoodie: close front, close back three-quarter, full-body front, full-body back three-quarter.
  pro_380: [A('front'), A('back'), A('front'), A('back')],
  // Poster: straight on, two angled, straight on (lighter).
  pro_15bc29bc8a324d449d: [A('flat'), A('side'), A('side'), A('flat')],
  // Stickers: three scenes and a close-up, all with Fourthwall's sample stickers on them.
  pro_358: [A('lifestyle', '', { sampleArt: true }), A('lifestyle', '', { sampleArt: true }), A('lifestyle', '', { sampleArt: true }), A('detail', '', { sampleArt: true })],
  // Mug: handle right (the print's front), tilted, tilted, handle left (the other side).
  pro_4v5OfYhyRx62KW5b7Oj6Uw: [A('front'), A('side'), A('side'), A('back')],
  // Gildan long sleeve: close front, close side, full-body front, full-body back, neck close-up, cuff close-up.
  pro_6ae602fcb22447bfbc: [A('front'), A('side'), A('front'), A('back'), A('detail'), A('detail')],
  // Gildan crewneck: close front, close back, full-body back three-quarter, full-body front three-quarter.
  'pro_14kNy0EJQkqopY-Z9Pm41A': [A('front'), A('back'), A('side', 'back'), A('side')],
  // Bella+Canvas tank: close front, close back, full-body front, full-body back three-quarter, two fabric close-ups.
  pro_xPL7YjOBRQWVL50Im8eKAA: [A('front'), A('back'), A('front'), A('back'), A('detail'), A('detail')],
  // Gildan youth tee: flat lay front, flat lay back.
  pro_ODh_gv0ESl6jIcRfvSww0w: [A('flat'), A('flat', 'back')],
  // Econscious tote: one angled product shot of the front.
  pro_367: [A('front')],
});
const ANGLES = ['front', 'side', 'back', 'lifestyle', 'flat', 'detail', 'unknown'];
// [url | { url }] -> [{ url, angle, view?, index, sampleArt? }] (index = Fourthwall's order).
function labelPhotos(templateId, list) {
  const known = PHOTO_ANGLES[templateId];
  return (Array.isArray(list) ? list : []).map((p, index) => {
    const url = String(typeof p === 'string' ? p : p?.url || '');
    const a = known ? known[index] : (index === 0 ? A('front') : null);
    const out = { url, angle: a && ANGLES.includes(a.angle) ? a.angle : 'unknown', index };
    if (a?.view) out.view = a.view;
    if (a?.sampleArt) out.sampleArt = true;
    return out;
  });
}

const SNAPSHOT_PHOTOS = require('./_merch-template-photos.js');
// [name, hex] -> { name, hex, base, photos } for one snapshot.
const colors = (list, templateId, base) => list.map(([name, hex]) => ({ name, hex, base, photos: labelPhotos(templateId, SNAPSHOT_PHOTOS[templateId]?.[name] || []) }));
const area = (regionId, w, h, dpi, inW, inH, { name, logo = false, design = true, renderable = true, available = true, method = 'DTG' } = {}) => ({
  regionId, name: name || regionId, type: regionId, available, renderable, productionMethod: method,
  pixelsWidth: w, pixelsHeight: h, dpi, inchesWidth: inW, inchesHeight: inH, suitsLogo: logo, suitsDesign: design,
});

const BLANKS = Object.freeze({
  tee: {
    label: 'T-shirt',
    ids: ['pro_Vv1XdaPMSdm6jZ5pj24NCQ', 'pro_e4677535402b4eeb81', 'pro_EJBSRKhJSd2unv4ZnGKwdQ'],
    search: 't-shirt',
    category: 'Apparel/T-Shirts',
    regionPrefer: ['front_large', 'front'],
    placementPrefer: ['largeCenter'], // verified on a real shop: PLACEMENT_ID + largeCenter
    placementStrategy: 'FULL_REGION',
    apparel: true, minDpi: 150, wrap: false,
    logo: 'area', // the ES logo goes in its own small area (sleeves)
    defaultColor: 'White',
    snapshot: {
      templateId: 'pro_Vv1XdaPMSdm6jZ5pj24NCQ', name: 'Stanley/Stella Unisex Organic Ribbed Neck T-Shirt', brand: 'Stanley/Stella',
      productionMethod: 'DTG', basePrice: 15.85, currency: 'USD',
      regionId: 'front_large', pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150, inchesWidth: 15, inchesHeight: 18,
      placementId: 'largeCenter',
      areas: [
        area('front_large', 2250, 2700, 150, 15, 18, { name: 'Front Large' }),
        area('back_large', 2250, 2700, 150, 15, 18, { name: 'Back Large' }),
        area('sleeve_left', 600, 525, 150, 4, 3.5, { name: 'Left Sleeve', logo: true, design: false }),
        area('sleeve_right', 600, 525, 150, 4, 3.5, { name: 'Right Sleeve', logo: true, design: false }),
        area('label_inside', 450, 450, 150, 3, 3, { name: 'Inside Label', design: false, renderable: false }),
      ],
      colors: colors(TEE_COLORS, 'pro_Vv1XdaPMSdm6jZ5pj24NCQ', 15.85),
      sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
    },
  },
  hoodie: {
    label: 'Hoodie',
    ids: ['pro_380'],
    search: 'hoodie',
    category: 'Apparel/Hoodies',
    regionPrefer: ['front', 'front_large'],
    placementPrefer: ['largeCenter'],
    placementStrategy: 'FULL_REGION',
    apparel: true, minDpi: 150, wrap: false,
    logo: 'area',
    defaultColor: 'White',
    snapshot: {
      templateId: 'pro_380', name: 'Cotton Heritage Unisex Premium Hoodie', brand: 'Cotton Heritage',
      productionMethod: 'DTG', basePrice: 27.29, currency: 'USD',
      regionId: 'front', pixelsWidth: 1650, pixelsHeight: 1650, dpi: 150, inchesWidth: 11, inchesHeight: 11,
      placementId: 'largeCenter',
      areas: [
        area('front', 1650, 1650, 150, 11, 11, { name: 'Front' }),
        area('back_large', 2250, 2700, 150, 15, 18, { name: 'Back Large' }),
        area('sleeve_left', 450, 1800, 150, 3, 12, { name: 'Left Sleeve', logo: true, design: false }),
        area('sleeve_right', 450, 1800, 150, 3, 12, { name: 'Right Sleeve', logo: true, design: false }),
        area('label_inside', 450, 450, 150, 3, 3, { name: 'Inside Label', design: false, renderable: false }),
      ],
      colors: colors(HOODIE_COLORS, 'pro_380', 27.29),
      sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    },
  },
  poster: {
    label: 'Poster',
    ids: ['pro_15bc29bc8a324d449d'],
    search: 'poster',
    category: 'Home & Living/Wall Art',
    regionPrefer: ['default'],
    placementPrefer: [],
    placementStrategy: 'FULL_REGION',
    apparel: false, minDpi: 300, wrap: false,
    logo: 'inside', // one area only: the ES logo is drawn inside the print
    defaultColor: 'White',
    snapshot: {
      templateId: 'pro_15bc29bc8a324d449d', name: 'Enhanced Matte Paper Poster', brand: 'Allcolor',
      productionMethod: 'PRINTED', basePrice: 5.5, currency: 'USD',
      regionId: 'default', pixelsWidth: 1500, pixelsHeight: 2100, dpi: 300, inchesWidth: 5, inchesHeight: 7,
      areas: [area('default', 1500, 2100, 300, 5, 7, { name: 'Print', method: 'PRINTED' })],
      colors: colors([['White', '#ffffff']], 'pro_15bc29bc8a324d449d', 5.5),
      sizes: ['5" x 7"', '8" x 10"', '11" x 14"', '12" x 18"', '16" x 20"', '18" x 24"', '24" x 36"'],
    },
  },
  sticker: {
    label: 'Sticker',
    ids: ['pro_358'],
    search: 'sticker',
    category: 'Accessories/Stickers',
    regionPrefer: ['default'],
    placementPrefer: ['fullSize'],
    placementStrategy: 'FULL_REGION',
    apparel: false, minDpi: 300, wrap: false,
    logo: 'inside',
    defaultColor: 'White',
    snapshot: {
      templateId: 'pro_358', name: 'Kiss Cut Stickers', brand: 'Allcolor',
      productionMethod: 'STICKER', basePrice: 2.29, currency: 'USD',
      regionId: 'default', pixelsWidth: 900, pixelsHeight: 900, dpi: 300, inchesWidth: 3, inchesHeight: 3,
      placementId: 'fullSize',
      areas: [area('default', 900, 900, 300, 3, 3, { name: 'Sticker', method: 'STICKER' })],
      colors: colors([['White', '#ffffff']], 'pro_358', 2.29),
      sizes: ['3" x 3"', '4" x 4"', '5.5" x 5.5"', '15" x 3.75"'],
    },
  },
  mug: {
    label: 'Mug',
    ids: ['pro_4v5OfYhyRx62KW5b7Oj6Uw'],
    search: 'mug',
    category: 'Drinkware/Coffee Mugs',
    regionPrefer: ['default'],
    placementPrefer: [], // the print is the whole wrap
    placementStrategy: 'FULL_REGION',
    apparel: false, minDpi: 300, wrap: true,
    logo: 'inside',
    defaultColor: 'White',
    snapshot: {
      templateId: 'pro_4v5OfYhyRx62KW5b7Oj6Uw', name: 'White Glossy Mug', brand: 'Mugz',
      productionMethod: 'SUBLIMATION', basePrice: 5.95, currency: 'USD',
      regionId: 'default', pixelsWidth: 2700, pixelsHeight: 1050, dpi: 300, inchesWidth: 9, inchesHeight: 3.5,
      areas: [area('default', 2700, 1050, 300, 9, 3.5, { name: 'Wrap', method: 'SUBLIMATION' })],
      colors: colors([['White', '#ffffff']], 'pro_4v5OfYhyRx62KW5b7Oj6Uw', 5.95),
      sizes: ['11oz', '15oz', '20 oz'],
    },
  },
  longsleeve: {
    label: 'Long sleeve tee',
    ids: ['pro_6ae602fcb22447bfbc', 'pro_dYdJWPXgROCj0IaEHR8VPA'],
    search: 'long sleeve tee',
    category: 'Apparel/Long Sleeve Tees',
    methods: ['DTG'],
    regionPrefer: ['front_large', 'front'],
    placementPrefer: ['largeCenter'],
    placementStrategy: 'FULL_REGION',
    apparel: true, minDpi: 150, wrap: false,
    logo: 'area',
    defaultColor: 'White',
    snapshot: {
      templateId: 'pro_6ae602fcb22447bfbc', name: 'Gildan Ultra Cotton Long Sleeve T-Shirt', brand: 'Gildan',
      productionMethod: 'DTG', basePrice: 14.79, currency: 'USD',
      regionId: 'front_large', pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150, inchesWidth: 15, inchesHeight: 18,
      placementId: 'largeCenter',
      areas: [
        area('front_large', 2250, 2700, 150, 15, 18, { name: 'Front Large' }),
        area('back_large', 2250, 2700, 150, 15, 18, { name: 'Back Large' }),
        area('sleeve_left', 450, 1800, 150, 3, 12, { name: 'Left Sleeve', logo: true, design: false }),
        area('sleeve_right', 450, 1800, 150, 3, 12, { name: 'Right Sleeve', logo: true, design: false }),
        area('label_inside', 450, 450, 150, 3, 3, { name: 'Inside Label', design: false, renderable: false }),
      ],
      colors: colors(LONGSLEEVE_COLORS, 'pro_6ae602fcb22447bfbc', 14.79),
      sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
    },
  },
  crewneck: {
    label: 'Crewneck sweatshirt',
    ids: ['pro_14kNy0EJQkqopY-Z9Pm41A', 'pro_EYvD6dHZRNO4QdKC9cRf0Q'],
    search: 'crewneck sweatshirt',
    category: 'Apparel/Sweatshirts',
    methods: ['DTG'],
    regionPrefer: ['front_large', 'front'],
    placementPrefer: ['largeCenter'],
    placementStrategy: 'FULL_REGION',
    apparel: true, minDpi: 150, wrap: false,
    logo: 'area',
    defaultColor: 'White',
    snapshot: {
      templateId: 'pro_14kNy0EJQkqopY-Z9Pm41A', name: 'Gildan Classic Crewneck Sweatshirt', brand: 'Gildan',
      productionMethod: 'DTG', basePrice: 18.79, currency: 'USD',
      regionId: 'front_large', pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150, inchesWidth: 15, inchesHeight: 18,
      placementId: 'largeCenter',
      areas: [
        area('front_large', 2250, 2700, 150, 15, 18, { name: 'Front Large' }),
        area('back_large', 2250, 2700, 150, 15, 18, { name: 'Back Large' }),
        area('sleeve_left', 450, 1800, 150, 3, 12, { name: 'Left Sleeve', logo: true, design: false }),
        area('sleeve_right', 450, 1800, 150, 3, 12, { name: 'Right Sleeve', logo: true, design: false }),
      ],
      colors: colors(CREWNECK_COLORS, 'pro_14kNy0EJQkqopY-Z9Pm41A', 18.79),
      sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
    },
  },
  tank: {
    label: 'Tank top',
    ids: ['pro_xPL7YjOBRQWVL50Im8eKAA', 'pro_606c3460ee07410a83'],
    search: 'tank',
    category: 'Apparel/Tank Tops',
    methods: ['DTG'],
    regionPrefer: ['front', 'front_large'],
    placementPrefer: ['largeCenter'],
    placementStrategy: 'FULL_REGION',
    apparel: true, minDpi: 150, wrap: false,
    logo: 'inside', // no sleeves: the ES logo is drawn inside the print
    defaultColor: 'Black', // White is out of stock in L
    snapshot: {
      templateId: 'pro_xPL7YjOBRQWVL50Im8eKAA', name: 'Bella+Canvas Jersey Tank', brand: 'Bella+Canvas',
      productionMethod: 'DTG', basePrice: 14.2, currency: 'USD',
      regionId: 'front', pixelsWidth: 1800, pixelsHeight: 2400, dpi: 150, inchesWidth: 12, inchesHeight: 16,
      placementId: 'largeCenter',
      areas: [
        area('front', 1800, 2400, 150, 12, 16, { name: 'Front' }),
        area('back', 1800, 2400, 150, 12, 16, { name: 'Back' }),
        area('label_inside', 450, 450, 150, 3, 3, { name: 'Inside Label', design: false, renderable: false }),
      ],
      colors: colors(TANK_COLORS, 'pro_xPL7YjOBRQWVL50Im8eKAA', 14.2),
      sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL'],
    },
  },
  youth: {
    label: 'Youth tee',
    ids: ['pro_ODh_gv0ESl6jIcRfvSww0w', 'pro_87a51e0a16ab42f9ae'],
    search: 'youth tee',
    category: 'Apparel/Kids Clothing',
    methods: ['DTG'],
    exclude: /long sleeve|hood|sweat|legging|short|swim|jersey/i,
    regionPrefer: ['front', 'front_large'],
    placementPrefer: ['largeCenter'],
    placementStrategy: 'FULL_REGION',
    apparel: true, minDpi: 150, wrap: false,
    logo: 'inside',
    defaultColor: 'White',
    snapshot: {
      templateId: 'pro_ODh_gv0ESl6jIcRfvSww0w', name: 'Gildan Youth Classic Tee', brand: 'Gildan',
      productionMethod: 'DTG', basePrice: 9.69, currency: 'USD',
      regionId: 'front', pixelsWidth: 1500, pixelsHeight: 1800, dpi: 150, inchesWidth: 10, inchesHeight: 12,
      placementId: 'largeCenter',
      areas: [
        area('front', 1500, 1800, 150, 10, 12, { name: 'Front' }),
        area('back', 1500, 1800, 150, 10, 12, { name: 'Back' }),
        area('label_inside', 450, 450, 150, 3, 3, { name: 'Inside Label', design: false, renderable: false }),
      ],
      colors: colors(YOUTH_COLORS, 'pro_ODh_gv0ESl6jIcRfvSww0w', 9.69),
      sizes: ['XS', 'S', 'M', 'L', 'XL'],
    },
  },
  tote: {
    label: 'Tote bag',
    ids: ['pro_367', 'pro_5a05131dbedf41a39b'],
    search: 'tote',
    category: 'Accessories/Bags',
    methods: ['DTG'],
    regionPrefer: ['front'],
    placementPrefer: [], // no placements on the tote: the print fills the area
    placementStrategy: 'FULL_REGION',
    apparel: false, minDpi: 150, wrap: false,
    logo: 'inside',
    defaultColor: 'Oyster',
    snapshot: {
      templateId: 'pro_367', name: 'Econscious Eco-Friendly Tote Bag', brand: 'Econscious',
      productionMethod: 'DTG', basePrice: 15.56, currency: 'USD',
      regionId: 'front', pixelsWidth: 1500, pixelsHeight: 1500, dpi: 150, inchesWidth: 10, inchesHeight: 10,
      areas: [
        area('front', 1500, 1500, 150, 10, 10, { name: 'Front' }),
        area('back', 1500, 1500, 150, 10, 10, { name: 'Back' }),
      ],
      colors: colors(TOTE_COLORS, 'pro_367', 15.56),
      sizes: ['One size'],
    },
  },
});

// Legacy: kind -> colour -> first photo url (the merch4 shape).
const PHOTOS = Object.fromEntries(Object.entries(BLANKS).map(([kind, b]) => [kind, Object.fromEntries(b.snapshot.colors.filter(c => c.photos[0]).map(c => [c.name, c.photos[0].url]))]));

module.exports = { BLANKS, BLANK_IDS: Object.keys(BLANKS), PHOTOS, PHOTO_ANGLES, ANGLES, labelPhotos };
