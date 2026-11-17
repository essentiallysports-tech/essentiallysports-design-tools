// Video Ads styles: the rules shared by the page and the server for the ad
// styles that work without footage (Stat Card, Today's 3, Us vs Them, Quote
// Card), plus the style suggestion, the variant-grid file names and the
// safe-zone maths. Pure functions, no DOM. One file for the browser
// (window.VideoAdsStyles) and the server (require), like video-ads-brands.js.
//
//   LIMITS                         word / character limits per field
//   defaultsFor(brand, styleId)    starter copy for a style's fields
//   styleReady(styleId, copy)      { ok, missing } can this style render?
//   briefFacts(input)              what the brief supports (numbers, quotes, headlines…)
//   suggestStyles(facts, opts)     { style, why, text, alternatives, scores }
//   fileName({...}) / parseFileName(name)
//                                  {brand}_{style}_{angle}_{WxH}_{yyyymmdd}
//   safeZoneRects(size, zone)      Meta UI areas on the canvas, for the overlay
//
// Facts rule (research §4.0): numbers, quotes and headlines come from the
// editor's input or the brief, never from the model. Claims about the
// newsletter come only from the brand's `verifiedClaims`.
(function (root, factory) {
  const brands = typeof module === 'object' && module.exports ? require('./video-ads-brands.js') : root.VideoAdsBrands;
  const api = factory(brands);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VideoAdsStyles = api;
}(typeof self !== 'undefined' ? self : this, B => {
  'use strict';

  const LIMITS = {
    statChars: 10, statLabelWords: 10, statSourceWords: 6, offerWords: 16,
    listTitleWords: 9, itemWords: 9, items: 3,
    themWords: 5, usWords: 6, sideItems: 3, themLabelWords: 3,
    quoteWords: 22, speakerWords: 6, quoteContextWords: 8,
  };

  const words = text => String(text || '').split(/\s+/).filter(Boolean).length;
  const numberTokens = text => (String(text || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map(n => n.replace(/,/g, ''));
  const list = (value, max = 3) => (Array.isArray(value) ? value : []).map(v => String(v || '').trim()).filter(Boolean).slice(0, max);
  const styleOf = id => (B && B.STYLES && B.STYLES[id]) || null;
  const isNew = id => Boolean(styleOf(id) && !styleOf(id).classic);

  // Starter copy (the editor can change all of it). No numbers, no claims
  // beyond "free": a default must never put an unverified fact in an ad.
  function defaultsFor(brand = {}, styleId = '') {
    const name = brand.label || 'the newsletter';
    const offers = {
      stat: `Get numbers like this in ${name}. Free.`,
      today3: `${name} brings you the stories that matter. Free.`,
      versus: `Switch to ${name}. It’s free.`,
      quote: `Every word that matters, in ${name}. Free.`,
    };
    return {
      offer: offers[styleId] || `Sign up for ${name}. Free.`,
      statEyebrow: 'By the numbers',
      listTitle: `What ${brand.audience || 'fans'} need to know today`,
      themLabel: 'Your feed',
      them: ['Endless hot takes', 'Rumours dressed as news', 'Too many apps'],
      us: list(brand.verifiedClaims, 3),
    };
  }

  // Can this style render with this copy? missing: what to add, in words.
  function styleReady(styleId, copy = {}) {
    const has = value => String(value || '').trim().length > 0;
    if (styleId === 'stat') {
      if (!has(copy.stat) || !numberTokens(copy.stat).length) return { ok: false, missing: 'a number' };
      if (!has(copy.statLabel)) return { ok: false, missing: 'what the number counts' };
      return { ok: true, missing: '' };
    }
    if (styleId === 'today3') return list(copy.items).length >= 2 ? { ok: true, missing: '' } : { ok: false, missing: 'at least 2 headlines' };
    if (styleId === 'versus') {
      if (list(copy.them).length < 2) return { ok: false, missing: '2 “your feed” lines' };
      if (list(copy.us).length < 2) return { ok: false, missing: '2 approved claims' };
      return { ok: true, missing: '' };
    }
    if (styleId === 'quote') {
      if (!has(copy.quote)) return { ok: false, missing: 'a quote' };
      if (!has(copy.speaker)) return { ok: false, missing: 'who said it' };
      return { ok: true, missing: '' };
    }
    return has(copy.headline) || list(copy.body).length ? { ok: true, missing: '' } : { ok: false, missing: 'a headline' };
  }

  // Quoted passages in a text: “…”, "…" or ‘…’ with at least 3 words.
  function extractQuotes(text) {
    const out = [];
    const re = /[“"‘]([^“”"‘’]{8,400})[”"’]/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const q = m[1].trim();
      if (words(q) >= 3 && !out.includes(q)) out.push(q);
    }
    return out;
  }

  // Comparison form for verbatim checks: quotes, dashes, spaces and case folded.
  const fold = text => String(text || '').toLowerCase()
    .replace(/[“”«»„]/g, '"').replace(/[‘’`]/g, "'").replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ').trim();
  const trimEnds = text => fold(text).replace(/^[\s"'(\[.,;:!?-]+|[\s"')\].,;:!?-]+$/g, '');
  function isVerbatim(quote, sources) {
    const q = trimEnds(quote);
    if (!q) return false;
    return (Array.isArray(sources) ? sources : [sources]).some(src => fold(src).includes(q));
  }

  // Words that carry meaning (for "this headline restates a real story").
  const STOP = new Set(('a an and are as at be but by for from has have he her his i if in into is it its me my of on or our '
    + 'she so that the their them they this to was we were what when who will with you your after over new than just more').split(' '));
  const contentWords = text => (fold(text).match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []).filter(w => w.length >= 3 && !STOP.has(w));
  // An item is grounded when it shares 2+ meaningful words with one source
  // (or all of them, for a very short item).
  function groundedIn(item, sources) {
    const mine = [...new Set(contentWords(item))];
    if (!mine.length) return false;
    return (Array.isArray(sources) ? sources : [sources]).some(src => {
      const theirs = new Set(contentWords(src));
      const shared = mine.filter(w => theirs.has(w)).length;
      return shared >= Math.min(2, mine.length);
    });
  }

  // "Them" lines stay generic: no named outlet, person or brand (a capital
  // letter after the first word gives a name away).
  const namesSomeone = text => String(text || '').trim().split(/\s+/).slice(1).some(w => /^[“"‘(]?\p{Lu}/u.test(w) && !/^I(['’]|$)/.test(w));
  // A claim counts only when it is one of the brand's approved claims.
  const claimKey = text => trimEnds(text);
  function approvedClaim(text, claims) {
    const key = claimKey(text);
    return (Array.isArray(claims) ? claims : []).find(c => claimKey(c) === key) || '';
  }

  // What the brief supports. Every input is optional.
  //   notes, clipText, trendTitle: free text from the brief
  //   related: headline strings (Trends `related`, other trending titles)
  //   copy: what the editor has typed (stat, quote, items count as facts)
  function briefFacts({ notes = '', clipText = '', trendTitle = '', related = [], copy = {}, brand = null, hasClip = false } = {}) {
    const factsText = [trendTitle, ...list(related, 12), notes, clipText].filter(Boolean).join(' ');
    const typedStat = numberTokens(copy.stat).length ? String(copy.stat).trim() : '';
    const numbers = [...new Set([...(typedStat ? [typedStat] : []), ...numberTokens([notes, clipText, trendTitle].join(' '))])];
    const quotes = [...(String(copy.quote || '').trim() ? [String(copy.quote).trim()] : []), ...extractQuotes([notes, clipText].join(' '))];
    const headlines = [...new Set([...list(copy.items, 3), ...list(related, 12)])];
    const claims = list(brand?.verifiedClaims, 12);
    return { numbers, quotes, headlines, relatedCount: headlines.length, claims: claims.length, hasClip: Boolean(hasClip), factsText };
  }

  // Ranks the styles for a brief. Rule-based first (eligibility from facts,
  // then the research prior); the learned ranking (export share and edits,
  // _ad-learning.js) and the AI's pick only break near-ties:
  //   score = prior − footage penalty + 0.06 × learned (0..1) + 0.03 × AI pick
  // Together they add at most 0.09, so they reorder near-ties (styles whose
  // priors differ by less than 0.1) but never lift an ineligible style or
  // overturn a prior gap of 0.1 or more.
  const LEARNED_WEIGHT = 0.06;
  const AI_WEIGHT = 0.03;
  const NO_CLIP_PENALTY = 0.4;
  function suggestStyles(facts = {}, { ranking = [], aiPick = '', brand = null } = {}) {
    const learned = new Map((Array.isArray(ranking) ? ranking : []).map(r => [r?.style, Math.max(0, Math.min(1, Number(r?.score) || 0))]));
    const name = brand?.short || brand?.label || '';
    const why = {
      stat: () => `your brief has a number (${facts.numbers[0]})`,
      quote: () => 'your brief has a quote',
      today3: () => `there are ${facts.relatedCount} headlines to work with`,
      versus: () => 'no footage needed, it runs all season',
      highlight: () => (facts.hasClip ? 'your clip carries it, one phrase stands out' : 'a classic layout'),
      condensed: () => (facts.hasClip ? 'your clip carries it' : 'a classic layout'),
      simple: () => (facts.hasClip ? 'plain words over your clip' : 'a classic layout'),
    };
    const eligible = {
      stat: (facts.numbers || []).length > 0,
      quote: (facts.quotes || []).length > 0,
      today3: (facts.relatedCount || 0) >= 3,
      versus: (facts.claims || 0) >= 2,
      simple: true, condensed: true, highlight: true,
    };
    const scores = Object.keys(eligible).filter(id => eligible[id] && styleOf(id)).map(id => {
      const s = styleOf(id);
      const penalty = s.needsFootage && !facts.hasClip ? NO_CLIP_PENALTY : 0;
      const l = learned.get(id) || 0;
      const score = s.prior - penalty + LEARNED_WEIGHT * l + (aiPick === id ? AI_WEIGHT : 0);
      return { style: id, label: s.label, score: Math.round(score * 1000) / 1000, learned: l, why: why[id]() };
    }).sort((a, b) => b.score - a.score || a.style.localeCompare(b.style));
    const [top, ...rest] = scores;
    if (!top) return null;
    // Say so when this brand's exports favour the suggested style.
    const maxLearned = Math.max(...scores.map(x => x.learned));
    const learnedNote = name && top.learned > 0 && top.learned === maxLearned ? `, and it’s ${name}’s most-used style` : '';
    const reason = top.why + learnedNote;
    return {
      style: top.style,
      label: top.label,
      why: reason,
      text: `Suggested: ${top.label} — ${reason}`,
      alternatives: rest.slice(0, 2).map(({ style, label, why: w }) => ({ style, label, why: w })),
      scores,
    };
  }

  // ─── Variant grid file names ────────────────────────────────────────────
  // {brand}_{style}_{angle}_{WxH}_{yyyymmdd}, e.g. huddle_stat_a1_1080x1920_20261118.
  // Meta ad names use the same string, so results can be joined back later.
  const brandSlug = brand => String(brand?.short || brand?.label || brand?.id || 'ad').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'ad';
  const styleSlug = id => String(styleOf(id)?.slug || id || 'style').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'style';
  const ymd = (date = new Date()) => {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  };
  function fileName({ brand, style, angle = 0, size, date = new Date(), ext = 'mp4' } = {}) {
    const a = `a${Math.max(0, Math.floor(Number(angle) || 0))}`;
    const wh = size ? `${size.width}x${size.height}` : '0x0';
    return `${brandSlug(brand)}_${styleSlug(style)}_${a}_${wh}_${ymd(date)}${ext ? `.${ext}` : ''}`;
  }
  function parseFileName(name) {
    const m = String(name || '').match(/^([a-z0-9]+)_([a-z0-9]+)_a(\d+)_(\d+)x(\d+)_(\d{8})(?:\.([a-z0-9]+))?$/);
    if (!m) return null;
    const style = Object.keys((B && B.STYLES) || {}).find(id => styleSlug(id) === m[2]) || m[2];
    return { brand: m[1], style, angle: Number(m[3]), width: Number(m[4]), height: Number(m[5]), date: m[6], ext: m[7] || '' };
  }

  // ─── Safe zones ─────────────────────────────────────────────────────────
  // Where Meta's UI sits over the ad, on the 1080-wide canvas. 9:16 uses the
  // Reels/Stories ad safe zone (top 14%, bottom 35%, sides 6%, action rail
  // 120px wide below y 1000); feed sizes show the size's own margins.
  // Returns rects { x, y, w, h } plus the content band { top, bottom }.
  function safeZoneRects(size, zone = 'meta') {
    if (!size) return null;
    const s = B.safeFor(size, zone);
    const { width: W, height: H } = s;
    const rects = {
      top: { x: 0, y: 0, w: W, h: s.safe.top },
      bottom: { x: 0, y: H - s.safe.bottom, w: W, h: s.safe.bottom },
      left: { x: 0, y: s.safe.top, w: s.safe.side, h: H - s.safe.top - s.safe.bottom },
      right: { x: W - s.safe.side, y: s.safe.top, w: s.safe.side, h: H - s.safe.top - s.safe.bottom },
    };
    if (s.rail) rects.rail = { x: W - s.rail.width, y: s.rail.fromY, w: s.rail.width, h: H - s.safe.bottom - s.rail.fromY };
    return { rects, band: { top: s.safe.top, bottom: H - s.safe.bottom }, share: { top: s.safe.top / H, bottom: s.safe.bottom / H, side: s.safe.side / W } };
  }
  // True when a rect stays clear of the platform UI (inside the band, off the rail).
  function insideSafe(rect, size, zone = 'meta') {
    const z = safeZoneRects(size, zone);
    if (!z) return false;
    const s = B.safeFor(size, zone);
    const inBand = rect.y >= z.band.top - 0.5 && rect.y + rect.h <= z.band.bottom + 0.5 && rect.x >= s.safe.side - 0.5 && rect.x + rect.w <= s.width - s.safe.side + 0.5;
    const r = z.rects.rail;
    const onRail = r && rect.x + rect.w > r.x + 0.5 && rect.y + rect.h > r.y + 0.5;
    return inBand && !onRail;
  }

  return {
    LIMITS, LEARNED_WEIGHT, AI_WEIGHT, NO_CLIP_PENALTY,
    words, numberTokens, isNew, defaultsFor, styleReady, extractQuotes, isVerbatim, groundedIn, contentWords, namesSomeone, approvedClaim,
    briefFacts, suggestStyles, brandSlug, styleSlug, ymd, fileName, parseFileName, safeZoneRects, insideSafe,
  };
}));
