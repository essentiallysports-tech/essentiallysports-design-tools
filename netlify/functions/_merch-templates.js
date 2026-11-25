'use strict';
// Curated Fourthwall blanks for Merch Designs. Tee only for the first release
// (owner, 2026-11-25); hoodie / poster / sticker / mug come later.
//
// Chosen 2026-11-25 from Fourthwall's public template search
// (GET /open-api/v1.0/product-templates/search/t-shirt, then GET /{id}):
//   primary   pro_e4677535402b4eeb81  Gildan Heavyweight T-Shirt, DTG, from $9.50,
//             35 colours (white + team colours: Royal, Cardinal, Red, Navy, Gold...),
//             supportsBackendRendering, no minimum orders,
//             print area "front_large" 2250 x 2700 px @ 150 dpi (15 x 18 in).
//   alternate pro_EJBSRKhJSd2unv4ZnGKwdQ  AS Colour Unisex Premium T-Shirt, DTG, from $16.32,
//             10 neutral colours, same front_large area.
// MERCH_TEMPLATES="tee=<id>" pins another id. If both ids stop qualifying, the
// server searches `t-shirt` and takes the first blank that qualifies.
// `snapshot` is what the API returned on that day: used only when Fourthwall
// can't be reached, so the designer can still draw at the right size.

const TEE_COLORS = [
  ['White', '#ffffff'], ['Black', '#141313'], ['Navy', '#1a2330'], ['Royal', '#175ac7'], ['Sapphire', '#007ab3'],
  ['Carolina Blue', '#96bbff'], ['Red', '#d80019'], ['Cardinal', '#c21b3a'], ['Maroon', '#47001b'], ['Orange', '#ff5f2e'],
  ['Gold', '#ffb22d'], ['Daisy', '#ffc946'], ['Forest Green', '#1a3b23'], ['Irish Green', '#00ba69'], ['Purple', '#48197d'],
  ['Sport Grey', '#c4c0be'], ['Charcoal', '#6a6967'], ['Dark Heather', '#595959'], ['Ash', '#f3f3f3'], ['Natural', '#e8dacd'],
];

const BLANKS = Object.freeze({
  tee: {
    label: 'T-shirt',
    ids: ['pro_e4677535402b4eeb81', 'pro_EJBSRKhJSd2unv4ZnGKwdQ'],
    search: 't-shirt',
    category: 'Apparel/T-Shirts',
    regionPrefer: ['front_large', 'front'],
    placementStrategy: 'FULL_REGION', // the print PNG is drawn for the whole area (collar wordmark included)
    defaultColor: 'White',
    margin: 12, // suggested retail = base + margin, rounded to .99
    snapshot: {
      templateId: 'pro_e4677535402b4eeb81',
      name: 'Gildan Heavyweight T-Shirt',
      brand: 'Gildan',
      productionMethod: 'DTG',
      basePrice: 9.5,
      currency: 'USD',
      regionId: 'front_large',
      pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150, inchesWidth: 15, inchesHeight: 18,
      // Non-embroidery areas on that day (label_inside is not backend-rendered).
      areas: [
        { regionId: 'front_large', name: 'Front Large', type: 'front_large', available: true, renderable: true, productionMethod: 'DTG', pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150, inchesWidth: 15, inchesHeight: 18, suitsLogo: false, suitsDesign: true },
        { regionId: 'back_large', name: 'Back Large', type: 'back_large', available: true, renderable: true, productionMethod: 'DTG', pixelsWidth: 2250, pixelsHeight: 2700, dpi: 150, inchesWidth: 15, inchesHeight: 18, suitsLogo: false, suitsDesign: true },
        { regionId: 'sleeve_left', name: 'Left Sleeve', type: 'sleeve_left', available: true, renderable: true, productionMethod: 'DTG', pixelsWidth: 600, pixelsHeight: 525, dpi: 150, inchesWidth: 4, inchesHeight: 3.5, suitsLogo: true, suitsDesign: false },
        { regionId: 'sleeve_right', name: 'Right Sleeve', type: 'sleeve_right', available: true, renderable: true, productionMethod: 'DTG', pixelsWidth: 600, pixelsHeight: 525, dpi: 150, inchesWidth: 4, inchesHeight: 3.5, suitsLogo: true, suitsDesign: false },
        { regionId: 'label_inside', name: 'Inside Label', type: 'label_inside', available: true, renderable: false, productionMethod: 'DTG', pixelsWidth: 450, pixelsHeight: 450, dpi: 150, inchesWidth: 3, inchesHeight: 3, suitsLogo: false, suitsDesign: false },
      ],
      colors: TEE_COLORS.map(([name, hex]) => ({ name, hex })),
      sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
    },
  },
});

module.exports = { BLANKS, BLANK_IDS: Object.keys(BLANKS) };
