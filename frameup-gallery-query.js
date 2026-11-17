// Gallery search and filters (gallery.html): what matches, what the link
// says, and "Make another like this". No DOM here, so Node tests can load it.
//
// The filters live in the address bar (?q=&ws=&type=&by=&posted=), so a
// filtered view survives a reload and can be shared ("every Masters post
// Priya made that hasn't been posted").
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpGalleryQuery = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const POSTED_VALUES = ['all', 'posted', 'not'];
  const DEFAULTS = Object.freeze({ query: '', workspace: 'All', type: 'All', person: '', posted: 'all' });
  const KEYS = { query: 'q', workspace: 'ws', type: 'type', person: 'by', posted: 'posted' };
  const MAX_BRIEF = 600;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

  function readState(search = '') {
    const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const posted = clean(params.get(KEYS.posted)).toLowerCase();
    return {
      query: clean(params.get(KEYS.query)).slice(0, 120),
      workspace: clean(params.get(KEYS.workspace)) || DEFAULTS.workspace,
      type: clean(params.get(KEYS.type)) || DEFAULTS.type,
      person: clean(params.get(KEYS.person)).slice(0, 120),
      posted: POSTED_VALUES.includes(posted) ? posted : DEFAULTS.posted,
    };
  }

  // Only non-default values go in the link; other params (e.g. ?open=) stay.
  function writeState(state = {}, search = '') {
    const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    Object.entries(KEYS).forEach(([key, param]) => {
      const value = clean(state[key]);
      if (!value || value === DEFAULTS[key]) params.delete(param);
      else params.set(param, value);
    });
    const text = params.toString();
    return text ? `?${text}` : '';
  }

  function activeCount(state = {}) {
    return Object.keys(DEFAULTS).filter(key => clean(state[key]) && clean(state[key]) !== DEFAULTS[key]).length;
  }

  // Every word must appear somewhere (title, team, sport, creator, template,
  // file name): "masters scheffler" finds a post with both.
  function matches(item = {}, state = {}, posted = null) {
    if (state.workspace && state.workspace !== 'All' && item.workspace !== state.workspace) return false;
    if (state.type && state.type !== 'All' && item.variant !== state.type) return false;
    if (state.person && clean(item.creator).toLowerCase() !== clean(state.person).toLowerCase()) return false;
    if (state.posted === 'posted' || state.posted === 'not') {
      const isPosted = Boolean(posted && typeof posted.has === 'function' && posted.has(item.id));
      if ((state.posted === 'posted') !== isPosted) return false;
    }
    const words = clean(state.query).toLowerCase().split(' ').filter(Boolean);
    if (!words.length) return true;
    const haystack = [item.title, item.team, item.sport, item.creator, item.variant, item.filename, item.workspace]
      .map(value => clean(value).toLowerCase()).join(' ');
    return words.every(word => haystack.includes(word));
  }

  // Creators with their post counts, busiest first.
  function people(items = []) {
    const counts = new Map();
    items.forEach(item => {
      const name = clean(item.creator);
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    });
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  // "Make another like this": Social Media posts open Generate with a brief
  // built only from the post's own fields (no invented facts) and
  // autorun=0, so nothing is spent until the editor presses Generate.
  // Other workspaces open their editor.
  const WORKSPACE_ROUTES = { 'Social Media': 'instagram', YouTube: 'youtube', Newsletter: 'newsletter' };
  function makeAnother(item = {}) {
    const workspace = clean(item.workspace) || 'Social Media';
    if (workspace !== 'Social Media') {
      const route = WORKSPACE_ROUTES[workspace];
      return route ? { href: `index.html#${route}`, label: `New ${workspace} design`, kind: 'editor' } : null;
    }
    const title = clean(item.title);
    const lines = [
      `Another ${clean(item.variant) || 'Social Media'} post like "${title || 'this one'}".`,
      clean(item.team) ? `Team: ${clean(item.team)}` : '',
      clean(item.sport) ? `Sport: ${clean(item.sport)}` : '',
      clean(item.variant) ? `Template: ${clean(item.variant)}` : '',
    ].filter(Boolean);
    const brief = lines.join('\n').slice(0, MAX_BRIEF);
    return { href: `generate.html?brief=${encodeURIComponent(brief)}&autorun=0`, label: 'Make another like this', kind: 'generate', brief };
  }

  return Object.freeze({ DEFAULTS, readState, writeState, activeCount, matches, people, makeAnother });
}));
