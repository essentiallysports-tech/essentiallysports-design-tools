'use strict';
// Curated Fourthwall blanks for Merch Designs: tee, hoodie, poster, sticker, mug.
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
const colors = list => list.map(([name, hex]) => ({ name, hex }));
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
      colors: colors(TEE_COLORS),
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
      colors: colors(HOODIE_COLORS),
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
      colors: colors([['White', '#ffffff']]),
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
      colors: colors([['White', '#ffffff']]),
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
      colors: colors([['White', '#ffffff']]),
      sizes: ['11oz', '15oz', '20 oz'],
    },
  },
});

module.exports = { BLANKS, BLANK_IDS: Object.keys(BLANKS) };
