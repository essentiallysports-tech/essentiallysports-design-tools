// Trends: the pure logic behind the board (generate.html?view=trends).
// No DOM, no network: ranking the "Post now" picks, folding storylines,
// building hand-offs (Generate, Video Ads, Reels Studio), the post kit and its
// clipboard text, the shortlist text, freshness labels and keyboard shortcuts.
// UMD: the page uses window.TrendsLogic; tests require() it.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrendsLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SHORT = { golf: 'Golf', tennis: 'Tennis', nfl: 'NFL', cfb: 'College FB', mlb: 'MLB', others: 'Sports' };
  const AD_SPORTS = ['nfl', 'cfb', 'mlb']; // Video Ads makes ads for these
  const REEL_SPORTS = ['nfl', 'cfb', 'mlb', 'golf']; // Reels Studio's sport list ('' = any)
  const KEYS = {
    feed: 'frameup.trends.v3',
    saved: 'frameup.savedTrends.v1', // the shortlist (kept: same key and shape as "Saved")
    ai: 'frameup.trendAi.v2',
    prefs: 'frameup.trends.prefs.v1',
    video: 'frameup.videoAdMoment.v1',
    reel: 'frameup.reelMoment.v1',
  };
  // The newsletters (video-ads-brands.js); the feed sends the same list.
  const BRANDS = [
    { id: 'the-huddle', label: 'The Huddle', sport: 'nfl' },
    { id: 'essentially-cfb', label: 'Essentially CFB', sport: 'cfb' },
    { id: 'es-dugout', label: 'ES Dugout', sport: 'mlb' },
  ];
  // Generate's formats (generate.html FORMATS) the kit can suggest.
  const TEMPLATES = {
    cover: { label: 'Cover', thumb: 'assets/template-thumbs/instagram-cover.webp' },
    quote: { label: 'Quote', thumb: 'assets/template-thumbs/instagram-quote.webp' },
    'long-quote': { label: 'Long Quote', thumb: 'assets/template-thumbs/instagram-long-quote.webp' },
    'stats-single-ent': { label: 'Player Stats', thumb: 'assets/template-thumbs/instagram-stats-single-ent.webp' },
    'listicle-type-2': { label: 'Ranked List', thumb: 'assets/template-thumbs/instagram-listicle-type-2.webp' },
  };
  const AI_TTL_MS = 6 * 60 * 60 * 1000;

  const ms = iso => Date.parse(iso || '');
  const clip = (s, n) => String(s || '').slice(0, n);

  // ── Freshness ──────────────────────────────────────────────────────────
  function isFresh(item, freshness = {}, now = Date.now()) {
    const limits = { news: freshness.newsMaxHours || 48, search: freshness.searchMaxHours || 24 };
    const age = (now - ms(item && item.publishedAt)) / 3600e3;
    return Number.isFinite(age) && age <= (limits[item.type] || limits.news);
  }
  // Card age: "12m ago", "2h ago", "1d ago".
  function ago(iso, now = Date.now()) {
    const s = Math.max(0, (now - ms(iso)) / 1000);
    if (!Number.isFinite(s)) return '';
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }
  // Status line: "4 min ago", "2 h ago".
  function agoLong(iso, now = Date.now()) {
    const s = Math.max(0, (now - ms(iso)) / 1000);
    if (!Number.isFinite(s)) return '';
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    return `${Math.floor(s / 3600)} h ago`;
  }
  // 'new' (under an hour), 'today' (under 6 h), 'older'.
  function freshness(iso, now = Date.now()) {
    const h = (now - ms(iso)) / 3600e3;
    if (!Number.isFinite(h)) return 'older';
    return h < 1 ? 'new' : h < 6 ? 'today' : 'older';
  }

  // ── Brands ─────────────────────────────────────────────────────────────
  const brandList = data => (Array.isArray(data && data.brands) && data.brands.length ? data.brands : BRANDS);
  function brandOf(item, brands = BRANDS) {
    const id = item && item.fit && item.fit.brand;
    return brands.find(b => b.id === id) || brands.find(b => b.sport === (item && item.category)) || null;
  }
  const matchesBrand = (item, brandId, brands = BRANDS) => !brandId || (brandOf(item, brands) || {}).id === brandId;

  // ── Ranking: "Post now" ────────────────────────────────────────────────
  // The server's rank (recency × momentum × relevance, storyline leads
  // boosted) weighed by ES fit, with a nudge for hot / rising stories.
  function pickScore(item) {
    const fit = item.fit && Number.isFinite(item.fit.score) ? item.fit.score : 50;
    const signal = item.signal === 'hot' ? 1.25 : item.signal === 'rising' ? 1.12 : 1;
    return (Number(item.rank) || 0) * (0.5 + fit / 100) * signal;
  }
  // One story per storyline, at most maxPerSport per sport, best first.
  function topPicks(items, { n = 5, maxPerSport = 2 } = {}) {
    const seen = new Set();
    const perSport = {};
    const out = [];
    for (const item of [...items].sort((a, b) => pickScore(b) - pickScore(a))) {
      const story = item.storyline && item.storyline.id;
      if (story && seen.has(story)) continue;
      if ((perSport[item.category] || 0) >= maxPerSport) continue;
      if (story) seen.add(story);
      perSport[item.category] = (perSport[item.category] || 0) + 1;
      out.push(item);
      if (out.length >= n) break;
    }
    return out;
  }
  // A list (best first) → one entry per storyline: the first member is the
  // lead, the others fold under it. Order of leads is kept.
  function foldStorylines(list) {
    const leads = new Map();
    const out = [];
    for (const item of list) {
      const story = item.storyline && item.storyline.id;
      if (story && leads.has(story)) { leads.get(story).more.push(item); continue; }
      const entry = { item, more: [] };
      if (story) leads.set(story, entry);
      out.push(entry);
    }
    return out;
  }
  // "Why now" for a pick: the signal, outlets, searches, the brand it fits.
  function whyNow(item, { brands = BRANDS, reach = true } = {}) {
    // The signal itself is the badge next to it, so it is not repeated here.
    // reach:false leaves out searches and outlets (a row whose meta line
    // already shows them, like the Trends board).
    const parts = [];
    const size = item.storyline ? item.storyline.size : 1;
    if (reach && item.type === 'search' && item.traffic) parts.push(`${item.traffic} searches`);
    if (size > 1) parts.push(`${size} stories on this`);
    if (reach && (item.coverage || 1) > 1) parts.push(`${item.coverage} outlets`);
    const brand = brandOf(item, brands);
    if (brand) parts.push(`fits ${brand.label}`);
    return parts.join(' · ');
  }

  // ── Hand-offs ──────────────────────────────────────────────────────────
  function briefFor(item, { headline = '', why = '', sportLabel = '' } = {}) {
    const lines = [];
    if (headline) lines.push(`Headline: ${headline}`);
    lines.push(headline ? `Story: ${item.title}` : item.title);
    const context = item.related && item.related[0] && item.related[0].title;
    if (context && context.toLowerCase() !== String(item.title).toLowerCase()) lines.push(`Context: ${context}`);
    if (why) lines.push(`Why fans care: ${why}`);
    if (item.team && item.team.name) lines.push(`Team: ${item.team.name}`);
    lines.push(`Sport: ${sportLabel || SHORT[item.category] || item.category}`);
    return lines.join('\n').slice(0, 1400);
  }
  const relatedOut = item => (item.related || []).slice(0, 3).map(r => ({ title: r.title, url: r.url, source: r.source }));
  // Video Ads: sessionStorage carries the full story; the URL works in a new tab.
  function videoHandoff(item, { why = '' } = {}) {
    const params = new URLSearchParams({ from: 'trends', sport: item.category, moment: clip(item.title, 200) });
    if (item.team && item.team.name) params.set('team', item.team.name);
    if (item.id) params.set('trend', item.id);
    return {
      key: KEYS.video,
      url: `video-ads.html?${params}`,
      payload: {
        id: item.id, title: item.title, sport: item.category, url: item.url, image: item.image || '',
        team: (item.team && item.team.name) || '', teamShort: (item.team && item.team.short) || '', publishedAt: item.publishedAt,
        related: relatedOut(item), why, from: 'trends', at: Date.now(),
      },
    };
  }
  // Reels Studio (reel-maker.js readHandoff): frameup.reelMoment.v1 or
  // ?moment=&sport=&team=&trend=. No ?brief= here: a brief would switch Reels
  // to its brief source and drop the trend.
  function reelHandoff(item, { why = '', hook = '' } = {}) {
    const sport = REEL_SPORTS.includes(item.category) ? item.category : '';
    const params = new URLSearchParams({ moment: clip(item.title, 200) });
    if (sport) params.set('sport', sport);
    if (item.team && item.team.name) params.set('team', item.team.name);
    if (item.id) params.set('trend', item.id);
    return {
      key: KEYS.reel,
      url: `reel-maker.html?${params}`,
      payload: {
        id: item.id, title: clip(item.title, 300), sport, team: (item.team && item.team.name) || '', url: item.url || '',
        why: why || hook || '', hook, related: relatedOut(item), from: 'trends', at: Date.now(),
      },
    };
  }

  // ── Post kit ───────────────────────────────────────────────────────────
  function templateFor(item) {
    const id = item.template && TEMPLATES[item.template.id] ? item.template.id : 'cover';
    return { id, label: TEMPLATES[id].label, thumb: TEMPLATES[id].thumb, why: (item.template && item.template.why) || 'A bold headline over a photo fits a news story.' };
  }
  function photoFor(item) {
    if (item.photo && item.photo.query) return { query: clip(item.photo.query, 80), kind: item.photo.kind || 'person' };
    if (item.team && item.team.name) return { query: item.team.name, kind: 'team' };
    return { query: SHORT[item.category] || 'Sports', kind: 'league' };
  }
  // ai: { why, titles, hook, ai } | null (rule ideas live on the item).
  function kitFor(item, ai, { brands = BRANDS } = {}) {
    const aiTitles = ai && Array.isArray(ai.titles) ? ai.titles.filter(Boolean) : [];
    const headlines = (aiTitles.length ? aiTitles : item.titles || []).slice(0, 3);
    const brand = brandOf(item, brands);
    return {
      headlines,
      headlinesAi: aiTitles.length > 0,
      why: (ai && ai.why) || '',
      template: templateFor(item),
      photo: photoFor(item),
      team: item.team && item.team.name ? { name: item.team.name, logo: item.team.logo || '' } : null,
      hook: (ai && ai.hook) || '',
      video: AD_SPORTS.includes(item.category) ? { brand: brand ? brand.label : '', moment: item.title } : null,
      reel: { sport: REEL_SPORTS.includes(item.category) ? item.category : '' },
    };
  }
  // The whole kit as plain text, for Slack or a doc.
  function kitText(item, kit, { sportLabel = '' } = {}) {
    const lines = [`${item.title}`, `${sportLabel || SHORT[item.category] || ''} · ${item.source || 'Google'} · ${item.url || ''}`.trim(), ''];
    if (kit.why) lines.push(`Why fans care: ${kit.why}`, '');
    if (kit.headlines.length) { lines.push(kit.headlinesAi ? 'Headlines (AI, check facts):' : 'Headline ideas:'); kit.headlines.forEach(h => lines.push(`- ${h}`)); lines.push(''); }
    lines.push(`Template: ${kit.template.label} (${kit.template.why})`);
    lines.push(`Photo: ${kit.photo.query}${kit.team ? ` · team graphic: ${kit.team.name} logo` : ''}`);
    if (kit.hook) lines.push(`Reel hook: ${kit.hook}`);
    if (kit.video) lines.push(`Video ad: ${kit.video.brand ? `${kit.video.brand} · ` : ''}${kit.video.moment}`);
    return lines.join('\n').trim();
  }
  function shortlistText(list, { now = Date.now() } = {}) {
    if (!list.length) return '';
    return [`Trends shortlist (${list.length})`, ...list.map((item, i) => `${i + 1}. ${item.title} (${SHORT[item.category] || item.category}, ${ago(item.publishedAt, now)})${item.url ? ` ${item.url}` : ''}`)].join('\n');
  }

  // ── AI angles cache (browser) ──────────────────────────────────────────
  // { id: { why, titles, hook, at } } → a Map of the entries still fresh.
  function readAiCache(raw, now = Date.now()) {
    const out = new Map();
    if (!raw || typeof raw !== 'object') return out;
    for (const [id, value] of Object.entries(raw)) {
      if (!value || !Number.isFinite(value.at) || now - value.at > AI_TTL_MS) continue;
      out.set(id, { why: String(value.why || ''), titles: Array.isArray(value.titles) ? value.titles.map(String).slice(0, 3) : [], hook: String(value.hook || ''), ai: true, at: value.at });
    }
    return out;
  }
  const writeAiCache = (map, max = 200) => Object.fromEntries([...map].slice(-max));

  // ── Keyboard ───────────────────────────────────────────────────────────
  // Single keys while the Trends board has focus (never while typing).
  const SHORTCUTS = [
    ['j', 'next', 'Next story'], ['k', 'prev', 'Previous story'],
    ['p', 'kit', 'Open or close the post kit'], ['d', 'design', 'Design a post'],
    ['r', 'reel', 'Make a reel'], ['v', 'video', 'Make a video ad'],
    ['s', 'shortlist', 'Add to or remove from the shortlist'], ['c', 'copy', 'Copy the top headline'],
    ['o', 'open', 'Read the story'], ['?', 'help', 'Show these shortcuts'],
  ];
  function shortcut(event) {
    if (!event || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return null;
    const target = event.target || {};
    const tag = String(target.tagName || '').toLowerCase();
    if (target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select') return null;
    const onCard = Boolean(target.classList && target.classList.contains('trend-row'));
    if (event.key === 'ArrowDown' && onCard) return 'next';
    if (event.key === 'ArrowUp' && onCard) return 'prev';
    if (event.key === 'Enter' && onCard) return 'kit';
    if (event.key === 'Escape') return 'close';
    const key = String(event.key || '');
    const hit = SHORTCUTS.find(([k]) => k === (key.length === 1 ? key.toLowerCase() : key));
    if (!hit) return null;
    // Shift is allowed only for "?".
    if (event.shiftKey && hit[0] !== '?') return null;
    return hit[1];
  }

  // ── Row actions (UI): one fixed set, in one order, on every card and list
  // row, in both layouts. An action that doesn't apply stays in its slot,
  // disabled, with the reason, so the columns never shift.
  const ROW_ACTIONS = [
    { id: 'kit', label: 'Post kit', key: 'p', tip: 'Headlines, template, photo, reel hook' },
    { id: 'reel', label: 'Reel', key: 'r', tip: 'Make a reel' },
    { id: 'video', label: 'Video ad', key: 'v', tip: 'Make a video ad' },
    { id: 'shortlist', label: 'Shortlist', key: 's', tip: 'Add to the shortlist' },
    { id: 'open', label: 'Read', key: 'o', tip: 'Read the story' },
  ];
  const VIDEO_NA = 'Video ads are made for NFL, College Football and MLB.';
  function rowActions(item, { saved = false } = {}) {
    return ROW_ACTIONS.map(a => {
      const out = { ...a, available: true, reason: '' };
      if (a.id === 'video' && !AD_SPORTS.includes(item && item.category)) { out.available = false; out.reason = VIDEO_NA; }
      if (a.id === 'shortlist' && saved) { out.label = 'Shortlisted'; out.tip = 'Remove from the shortlist'; }
      if (a.id === 'open' && !/^https?:\/\//i.test(String((item && item.url) || ''))) { out.available = false; out.reason = 'No link for this story.'; }
      return out;
    });
  }
  // A Wikipedia "photo" that is really a crest or wordmark (an SVG render, or
  // "logo" in the file name) is shown whole on a light tile, never cropped.
  function isLogoImage(item) {
    if (!item || !item.image) return false;
    if (item.imageKind === 'logo') return true;
    if (item.imageKind === 'photo') return /(?:^|[\/_.-])(?:logo|crest|wordmark|emblem)s?(?:[_.-]|$)|\.svg(?:\.png)?(?:[?#]|$)/i.test(String(item.image).split('?')[0]);
    return false;
  }

  return {
    SHORT, AD_SPORTS, REEL_SPORTS, KEYS, BRANDS, TEMPLATES, AI_TTL_MS, SHORTCUTS,
    isFresh, ago, agoLong, freshness, brandList, brandOf, matchesBrand,
    pickScore, topPicks, foldStorylines, whyNow,
    briefFor, videoHandoff, reelHandoff,
    templateFor, photoFor, kitFor, kitText, shortlistText,
    readAiCache, writeAiCache, shortcut,
    ROW_ACTIONS, VIDEO_NA, rowActions, isLogoImage,
  };
});
