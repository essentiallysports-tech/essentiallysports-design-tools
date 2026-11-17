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
      // TODO(owner): placeholder claims for Us vs Them. Kept deliberately
      // conservative (true of any free email sign-up). Confirm or replace them
      // before running paid ads; add subscriber counts or send times only
      // once they are verified.
      verifiedClaims: ['Free to sign up', 'Unsubscribe anytime', 'Straight to your inbox', 'College football news in one email'],
      claimsApproved: false,
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
      // TODO(owner): placeholder claims for Us vs Them. Kept deliberately
      // conservative (true of any free email sign-up). Confirm or replace them
      // before running paid ads; add subscriber counts or send times only
      // once they are verified.
      verifiedClaims: ['Free to sign up', 'Unsubscribe anytime', 'Straight to your inbox', 'Baseball news in one email'],
      claimsApproved: false,
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
      // TODO(owner): placeholder claims for Us vs Them. Kept deliberately
      // conservative (true of any free email sign-up). Confirm or replace them
      // before running paid ads; add subscriber counts or send times only
      // once they are verified.
      verifiedClaims: ['Free to sign up', 'Unsubscribe anytime', 'Straight to your inbox', 'NFL news in one email'],
      claimsApproved: false,
    },
  ];

  // Sizes the ad exports in, with the area text may use (safe zones keep it
  // clear of platform UI: profile row on top, caption and buttons at the bottom).
  // logoTop: where the pinned logo sits (Figma: y 107 on the 9:16 NFL/CFB ads,
  // 55–63 on the 4:5 ads). side: the text margin (61–70 on the 9:16 ads, 60 on the
  // 4:5 ads). centerY: the 9:16 Figma ads centre their copy on the frame
  // (y ≈ 960); the copy still stays clear of the Reels/Stories profile row
  // (top 260) and the caption/CTA area (bottom 420).
  // safeMeta: Meta's Reels/Stories ad safe zone (top 14%, bottom 35%, sides
  // 6%, the action rail on the right below y 1000), so the copy band is
  // y 270–1250. Feed placements (4:5, 1:1) have no overlay on the media, so
  // their safe area is the same in both modes. See safeFor() below.
  const SIZES = {
    '9x16': { id: '9x16', label: '9:16 Story / Reel', width: 1080, height: 1920, logoTop: 107, centerY: 960, safe: { top: 260, bottom: 420, side: 62 }, safeMeta: { top: 270, bottom: 670, side: 65, rail: { width: 120, fromY: 1000 } } },
    '4x5': { id: '4x5', label: '4:5 Feed', width: 1080, height: 1350, logoTop: 58, safe: { top: 110, bottom: 90, side: 60 } },
    '1x1': { id: '1x1', label: '1:1 Square', width: 1080, height: 1080, logoTop: 50, safe: { top: 90, bottom: 70, side: 56 } },
  };

  // The safe area for a size: 'meta' (Meta Reels ad safe zone, the default
  // for new ads) or 'classic' (the original Figma margins). Returns a size
  // object the renderer can use as is (safe, centerY).
  const SAFE_ZONES = ['meta', 'classic'];
  function safeFor(size, zone = 'meta') {
    if (!size || zone === 'classic' || !size.safeMeta) return size;
    const { rail, ...safe } = size.safeMeta;
    // Copy centred in the band (y 270–1250 → 760), not on the frame.
    const centerY = size.centerY ? Math.round((safe.top + size.height - safe.bottom) / 2) : size.centerY;
    return { ...size, safe, centerY, rail: rail || null, zone: 'meta' };
  }

  // Copy styles. The first three are the ES ad templates (one centred block of
  // copy, designed over a clip). The rest carry the message with no footage
  // (project-docs/video-ad-styles-research.md, Phase 1): each has its own
  // fields, a layout per size and timed entrances (video-ads-render.js).
  //   needsFootage: false = works on the animated background or a photo too
  //   fields: what the Copy step asks for (video-ads-styles.js has the limits)
  //   prior: the research's pre-build rubric estimate (est.), used to rank
  //     suggestions until real ratings exist
  const STYLES = {
    simple: { id: 'simple', label: 'Simple', note: 'Plain paragraphs', classic: true, needsFootage: true, prior: 8.2, fields: ['headline', 'body', 'cta'] },
    condensed: { id: 'condensed', label: 'Condensed', note: 'Condensed headline + simple body', classic: true, needsFootage: true, prior: 8.4, fields: ['headline', 'body', 'cta'] },
    highlight: { id: 'highlight', label: 'Highlight', note: 'Condensed headline with a highlighted phrase', classic: true, needsFootage: true, prior: 8.5, fields: ['headline', 'highlight', 'body', 'cta'] },
    stat: { id: 'stat', label: 'Stat Card', note: 'One verified number', slug: 'stat', needsFootage: false, prior: 8.7, fields: ['stat', 'statLabel', 'statSource', 'offer', 'cta'] },
    today3: { id: 'today3', label: 'Today’s 3', note: 'Three headlines, one by one', slug: 'today3', needsFootage: false, prior: 8.6, fields: ['listTitle', 'items', 'offer', 'cta'] },
    versus: { id: 'versus', label: 'Us vs Them', note: 'Your feed vs the newsletter', slug: 'versus', needsFootage: false, prior: 8.6, fields: ['them', 'us', 'offer', 'cta'] },
    quote: { id: 'quote', label: 'Quote Card', note: 'A verbatim quote', slug: 'quote', needsFootage: false, prior: 8.5, fields: ['quote', 'speaker', 'quoteContext', 'offer', 'cta'] },
  };
  const CLASSIC_STYLES = Object.keys(STYLES).filter(id => STYLES[id].classic);
  const NEW_STYLES = Object.keys(STYLES).filter(id => !STYLES[id].classic);

  const byId = id => AD_BRANDS.find(brand => brand.id === id) || AD_BRANDS[0];
  const forSport = sport => AD_BRANDS.find(brand => brand.sport === sport) || AD_BRANDS[0];

  return { ES_LOGO, AD_BRANDS, SIZES, SAFE_ZONES, STYLES, CLASSIC_STYLES, NEW_STYLES, safeFor, byId, forSport };
}));
