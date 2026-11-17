/*
 * League logos: one place that maps a sport id or label to its logo.
 *
 *   LeagueLogos.logoFor('nfl')              -> { id, label, src, bg }
 *   LeagueLogos.logoFor('College Football') -> the CFB entry (NCAA mark)
 *   LeagueLogos.logoFor('curling')          -> neutral trophy tile, label kept
 *
 * `src` is relative to the site root (assets/league-logos/<id>.svg).
 * `bg` is a flat tile colour picked so the mark reads; it stays the same in
 * dark mode, so the logos keep their official colours.
 *
 * Sources for every file: assets/league-logos/SOURCES.md.
 * UMD: window.LeagueLogos in the browser, module.exports under Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LeagueLogos = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIR = 'assets/league-logos/';
  const WHITE = '#FFFFFF';
  const SUNK = '#F2F4F7';

  // The sport ids the trends API (netlify/functions/trend-design.js) and
  // Video Ads use, plus the neutral fallback.
  const LOGOS = {
    nfl: { label: 'NFL', file: 'nfl.svg', bg: WHITE, aliases: ['national football league'] },
    cfb: { label: 'College Football', file: 'cfb.svg', bg: WHITE, aliases: ['college fb', 'college football', 'ncaa', 'ncaaf', 'ncaa football', 'cfp'] },
    mlb: { label: 'MLB', file: 'mlb.svg', bg: WHITE, aliases: ['major league baseball', 'baseball'] },
    golf: { label: 'Golf', file: 'golf.svg', bg: WHITE, aliases: ['pga', 'pga tour', 'liv', 'liv golf', 'lpga'] },
    tennis: { label: 'Tennis', file: 'tennis.svg', bg: SUNK, aliases: ['atp', 'wta'] },
    sports: { label: 'Sports', file: 'sports.svg', bg: SUNK, aliases: ['others', 'other', 'all'] },
  };

  const LOOKUP = new Map();
  Object.entries(LOGOS).forEach(([id, entry]) => {
    LOOKUP.set(id, id);
    LOOKUP.set(entry.label.toLowerCase(), id);
    entry.aliases.forEach(alias => LOOKUP.set(alias, id));
  });

  const make = (id, label) => {
    const entry = LOGOS[id];
    return { id, label: label || entry.label, src: DIR + entry.file, bg: entry.bg };
  };

  function idFor(value) {
    const key = String(value == null ? '' : value).trim().toLowerCase();
    return LOOKUP.get(key) || '';
  }

  // Unknown sports get the neutral tile but keep their own name as the label.
  function logoFor(value) {
    const id = idFor(value);
    if (id) return make(id);
    const label = String(value == null ? '' : value).trim();
    return make('sports', label || undefined);
  }

  const ids = () => Object.keys(LOGOS);

  return { logoFor, idFor, ids };
}));
