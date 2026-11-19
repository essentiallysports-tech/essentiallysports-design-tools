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
  // A Generate brief from a trend (gen v4): a real brief, never a raw headline
  // with "Sport: X" lines. Built only from the trend's own words (its headline,
  // the related headlines, the AI "why fans care" line), so nothing is invented:
  //   {Who}: {what happened}.          who = the team / person when the
  //                                     headline does not already name them
  //   Context: {related}. {related}.    key facts and numbers from the coverage
  //   Why fans care: {angle}.           the angle, when the feed has one
  // An editor's "Headline:" pick stays first (the server puts it on a cover).
  // The league travels beside the brief (sportForBrief / ?sport=), not in it.
  const SPORT_KEY = 'frameup.generate.briefSport.v1';
  const squash = text => String(text || '').replace(/\s+/g, ' ').trim();
  // A headline as a sentence: no " - Outlet" tail, ends with a full stop.
  function asSentence(text, source = '') {
    let t = squash(text);
    if (source && t.endsWith(` - ${source}`)) t = t.slice(0, -(source.length + 3));
    t = t.replace(/\s+[-–|]\s+[A-Z][\w.&' ]{1,30}$/, m => (/\d/.test(m) ? m : '')).trim();
    if (!t) return '';
    return /[.!?…"”')]$/.test(t) ? t : `${t}.`;
  }
  const words = text => squash(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(w => w.length > 2);
  // Two headlines saying the same thing (most of the words shared).
  function sameStory(a, b) {
    const x = new Set(words(a));
    const y = words(b);
    if (!x.size || !y.length) return false;
    const shared = y.filter(w => x.has(w)).length;
    return shared / Math.min(x.size, y.length) >= 0.7;
  }
  const mentions = (text, name) => {
    const n = squash(name).toLowerCase();
    if (!n) return true;
    const t = squash(text).toLowerCase();
    const last = n.split(' ').pop();
    return t.includes(n) || (last.length >= 4 && new RegExp(`\\b${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t));
  };
  function buildBrief({ headline = '', who = '', what = '', context = [], why = '', extra = [] } = {}) {
    const lines = [];
    if (headline) lines.push(`Headline: ${squash(headline)}`);
    const lead = asSentence(what);
    if (lead) lines.push(who && !mentions(lead, who) ? `${squash(who)}: ${lead}` : lead);
    const more = context.map(c => asSentence(c)).filter(Boolean);
    if (more.length) lines.push(`Context: ${more.join(' ')}`);
    const angle = asSentence(why);
    if (angle) lines.push(`Why fans care: ${angle}`);
    extra.forEach(line => { if (squash(line)) lines.push(squash(line)); });
    return lines.join('\n');
  }
  function briefFor(item, { headline = '', why = '', sportLabel = '' } = {}) {
    const title = squash(item && item.title);
    const related = ((item && item.related) || [])
      .map(r => ({ title: squash(typeof r === 'string' ? r : r && r.title), source: (r && r.source) || '' }))
      .filter(r => r.title && r.title.toLowerCase() !== title.toLowerCase());
    const team = (item && item.team && item.team.name) || '';
    let who = team;
    let what = title;
    // A search trend's title is the search ("Lebron James"): the news under it
    // says what happened, and the search names who.
    if (item && item.type === 'search' && related.length) {
      who = title;
      what = asSentence(related[0].title, related[0].source);
      related.shift();
    }
    const context = [];
    related.forEach(r => {
      if (context.length < 2 && !sameStory(what, r.title) && !context.some(c => sameStory(c, r.title))) context.push(asSentence(r.title, r.source));
    });
    const text = buildBrief({ headline, who, what, context, why }).slice(0, 1400);
    const sport = sportLabel || (item && item.category && item.category !== 'others' ? SHORT[item.category] || '' : '');
    if (sport) rememberSport(text, sport);
    return text;
  }
  // A brief in the old labelled shape ("Story: …\nTeam: …\nSport: NBA", from an
  // older link, a Recent item or ES MCP's trending tool) as a real brief, with
  // its league kept aside: { text, sport }. Any other text comes back as is.
  function tidyBrief(raw) {
    const text = String(raw || '').replace(/\r/g, '').trim();
    const lines = text.split('\n');
    const labelled = lines.filter(line => /^\s*(?:story|sport|team|context|why fans care|headline)\s*:/i.test(line));
    if (!labelled.some(line => /^\s*(?:story|sport|team)\s*:/i.test(line))) return { text, sport: '' };
    const parts = { headline: '', who: '', what: '', context: [], why: '', extra: [] };
    let sport = '';
    lines.forEach(line => {
      const m = line.match(/^\s*(story|sport|team|context|why fans care|headline)\s*:\s*(.*)$/i);
      if (!m) { if (squash(line)) { if (!parts.what) parts.what = line; else parts.extra.push(line); } return; }
      const [, label, value] = m;
      const key = label.toLowerCase();
      if (key === 'sport') sport = squash(value);
      else if (key === 'team') parts.who = squash(value);
      else if (key === 'story') parts.what = value.replace(/^\s*story\s*:\s*/i, '');
      else if (key === 'context') parts.context.push(value);
      else if (key === 'why fans care') parts.why = value;
      else parts.headline = value;
    });
    return { text: buildBrief(parts), sport };
  }
  // The league for a brief, kept beside it (keyed by its first line) so the
  // brief can read like a brief and Generate still knows the sport.
  const briefKey = text => squash(String(text || '').split('\n').find(line => squash(line) && !/^\s*headline\s*:/i.test(line)) || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
  function storage() { try { return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null; } catch (error) { return null; } }
  function rememberSport(text, sport) {
    const key = briefKey(text);
    const store = storage();
    if (!key || !sport || !store) return;
    try {
      const map = JSON.parse(store.getItem(SPORT_KEY) || '{}') || {};
      delete map[key];
      map[key] = squash(sport).slice(0, 30);
      const keys = Object.keys(map);
      keys.slice(0, Math.max(0, keys.length - 40)).forEach(k => delete map[k]);
      store.setItem(SPORT_KEY, JSON.stringify(map));
    } catch (error) { /* storage blocked */ }
  }
  function sportForBrief(text) {
    const key = briefKey(text);
    const store = storage();
    if (!key || !store) return '';
    try { return String((JSON.parse(store.getItem(SPORT_KEY) || '{}') || {})[key] || ''); } catch (error) { return ''; }
  }
  // What Generate sends: the brief as written, plus its league on a last
  // "Sport:" line (the server reads it) when the person did not write one.
  function withSport(text, sport = '') {
    const brief = String(text || '').trim();
    if (!brief || /^\s*sport\s*:/im.test(brief)) return brief;
    const league = squash(sport) || sportForBrief(brief);
    return league ? `${brief}\nSport: ${league}` : brief;
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
    briefFor, tidyBrief, rememberSport, sportForBrief, withSport, videoHandoff, reelHandoff,
    templateFor, photoFor, kitFor, kitText, shortlistText,
    readAiCache, writeAiCache, shortcut,
    ROW_ACTIONS, VIDEO_NA, rowActions, isLogoImage,
  };
});
