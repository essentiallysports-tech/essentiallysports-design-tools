// Video Ads: the newsletters an ad can promote. One file for the browser
// (window.VideoAdsBrands) and the server (require), like frameup-rules.js.
//
// logo: the newsletter's wordmark, exported from the ES Design Team Figma file
// (the live NFL / CFB / MLB ads): ESSENTIALLY CFB 2, ESSENTIALLY DUGOUT, and
// The Huddle lockup (ES wordmark over THE HUDDLE) from NFL-ad-with-logo.
// If a file is missing, a pill is drawn from `wordmark`; a logo uploaded on the
// Video Ads page (saved per brand in the browser) beats both.
// accent: the mail icon on the white CTA (The Huddle's #CC3333 and Dugout's
// #BF0D3E are the Figma values). highlight: the flat box behind the phrase in the
// Highlight style (Figma: The Huddle #CC3333 with white text, Essentially CFB
// #D7A343 with black text; Dugout follows The Huddle's pattern in its own red).
(function (root, factory) {
  const brands = factory();
  if (typeof module === 'object' && module.exports) module.exports = brands;
  else root.VideoAdsBrands = brands;
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  const ES_LOGO = { light: 'brand-logo-white.svg', dark: 'brand-logo-blue.svg' };

  const AD_BRANDS = [
    {
      id: 'essentially-cfb',
      label: 'Essentially CFB',
      sport: 'cfb',
      league: 'College Football',
      accent: '#781A1D',
      highlight: { bg: '#D7A343', fg: '#000000' },
      logo: 'assets/video-ads/logos/essentially-cfb.svg',
      wordmark: { text: 'ESSENTIALLY CFB', bg: '#781A1D', fg: '#CDB286' },
      short: 'CFB',
      cta: 'SIGN UP ES CFB',
      audience: 'college football fans',
    },
    {
      id: 'es-dugout',
      label: 'ES Dugout',
      sport: 'mlb',
      league: 'MLB',
      accent: '#BF0D3E',
      highlight: { bg: '#BF0D3E', fg: '#FFFFFF' },
      logo: 'assets/video-ads/logos/essentially-dugout.svg',
      wordmark: { text: 'ESSENTIALLY DUGOUT', bg: '#BF0D3E', fg: '#FFFFFF' },
      short: 'Dugout',
      cta: 'SIGN UP ES DUGOUT',
      audience: 'baseball fans',
    },
    {
      id: 'the-huddle',
      label: 'The Huddle',
      sport: 'nfl',
      league: 'NFL',
      accent: '#CC3333',
      highlight: { bg: '#CC3333', fg: '#FFFFFF' },
      logo: 'assets/video-ads/logos/the-huddle.svg',
      wordmark: { text: 'THE HUDDLE', bg: '#252D47', fg: '#FFFFFF' },
      short: 'Huddle',
      cta: 'SIGN UP THE HUDDLE',
      audience: 'NFL fans',
    },
  ];

  // Sizes the ad exports in, with the area text may use (safe zones keep it
  // clear of platform UI: profile row on top, caption and buttons at the bottom).
  // logoTop: where the pinned logo sits (Figma: y 107 on the 9:16 NFL/CFB ads,
  // 55–63 on the 4:5 ads). side: the text margin (61–70 on the 9:16 ads, 60 on the
  // 4:5 ads). centerY: the 9:16 Figma ads centre their copy on the frame
  // (y ≈ 960); the copy still stays clear of the Reels/Stories profile row
  // (top 260) and the caption/CTA area (bottom 420).
  const SIZES = {
    '9x16': { id: '9x16', label: '9:16 Story / Reel', width: 1080, height: 1920, logoTop: 107, centerY: 960, safe: { top: 260, bottom: 420, side: 62 } },
    '4x5': { id: '4x5', label: '4:5 Feed', width: 1080, height: 1350, logoTop: 58, safe: { top: 110, bottom: 90, side: 60 } },
    '1x1': { id: '1x1', label: '1:1 Square', width: 1080, height: 1080, logoTop: 50, safe: { top: 90, bottom: 70, side: 56 } },
  };

  // The three copy styles from the ES ad templates.
  const STYLES = {
    simple: { id: 'simple', label: 'Simple', note: 'Plain paragraphs' },
    condensed: { id: 'condensed', label: 'Condensed', note: 'Condensed headline + simple body' },
    highlight: { id: 'highlight', label: 'Highlight', note: 'Condensed headline with a highlighted phrase' },
  };

  const byId = id => AD_BRANDS.find(brand => brand.id === id) || AD_BRANDS[0];
  const forSport = sport => AD_BRANDS.find(brand => brand.sport === sport) || AD_BRANDS[0];

  return { ES_LOGO, AD_BRANDS, SIZES, STYLES, byId, forSport };
}));
