// AI Studio · Trends view (generate.html?view=trends): the social editor's
// morning board, "what should we post right now?".
//   - Feed: /api/trend-design (Google Trends + Google News, US), ranked by the
//     server (recency × momentum × ES relevance), with storylines, hot /
//     rising signals, ES fit per newsletter, a suggested template and a photo
//     query per story. Pure logic: trends-logic.js (window.TrendsLogic).
//   - "Post now": the top picks across sports, one per storyline. Then each
//     sport, with a storyline's other stories folded under its lead.
//   - Post kit (one click): 3 headlines, the template, the photo, the reel hook
//     and the video ad moment, with hand-offs to Generate, Reels Studio and
//     Video Ads, and "Copy kit".
//   - Instant first paint from the last feed (localStorage), then fresh.
//   - AI: never on load and never on hover. Only when a post kit opens, a
//     card's "AI angles", or the toolbar's "AI angles" (the picks on screen,
//     6 per call). Angles are cached 6 h in this browser and on the server.
//   - Shortlist (was "Saved"): kept per browser, copyable for the team.
//   - Cards or a compact list; keyboard shortcuts (? lists them).
(() => {
  const L = window.TrendsLogic;
  const root = document.getElementById('ais-view-trends');
  if (!L || !root) return;
  const REFRESH_MS = 5 * 60 * 1000; // poll while the view is open (the CDN answers most)
  const STALE_AFTER_MS = 20 * 60 * 1000; // amber dot past this
  const FEED_MAX_AGE_MS = 6 * 60 * 60 * 1000; // a stored feed older than this is not shown
  const AI_BATCH = 6;
  const PER_GROUP = 4;
  const PICKS = 5;
  const MAX_SAVED = 50;
  const KEY = L.KEYS;
  // Lucide icons (ISC licence).
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICON = {
    news: svg('<path d="M15 18h-5"/><path d="M18 14h-8"/><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="10" y="6" rx="1"/>'),
    external: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
    wand: svg('<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>'),
    sparkles: svg('<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>'),
    chevron: svg('<path d="m9 18 6-6-6-6"/>'),
    video: svg('<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>'),
    film: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>'),
    bookmark: svg('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>'),
    copy: svg('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    refresh: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
    alert: svg('<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>'),
    flame: svg('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'),
    trending: svg('<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>'),
    layers: svg('<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>'),
    image: svg('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
    layout: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>'),
    kit: svg('<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>'),
    clipboard: svg('<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'),
    trash: svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
  };
  const $ = id => document.getElementById(id);
  const els = {
    filters: $('trends-filters'), body: $('trends-body'), empty: $('trends-empty'), notice: $('trends-notice'),
    updated: $('trends-updated'), live: $('trends-live'), refresh: $('trends-refresh'), aiAll: $('trends-ai'),
    stats: $('td-stats'), announce: $('trends-announce'), brand: $('trends-brand'), density: $('trends-density'),
    keysBtn: $('trends-keys'), keys: $('trends-keys-panel'),
  };
  const isOpen = () => document.documentElement.dataset.aisView === 'trends';
  const store = {
    get(key, fallback, area = 'localStorage') { try { const raw = window[area].getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (error) { return fallback; } },
    set(key, value, area = 'localStorage') { try { window[area].setItem(key, JSON.stringify(value)); } catch (error) { /* private mode or full */ } },
  };

  let data = null;
  let active = new URLSearchParams(location.search).get('sport') || 'all';
  let loadedAt = 0;
  let loading = false;
  let failed = false;
  let entered = false;
  let shownCount = -1;
  const prefs = Object.assign({ density: 'cards', brand: '' }, store.get(KEY.prefs, {}));
  // AI angles: this browser, 6 h (the server also shares them across users).
  const aiCache = L.readAiCache(store.get(KEY.ai, {}));
  const saveAi = () => store.set(KEY.ai, L.writeAiCache(aiCache));
  const aiState = new Map(); // id -> 'loading' | 'limited' | 'error' | 'off'
  const openKits = new Set();
  let saved = store.get(KEY.saved, []);
  if (!Array.isArray(saved)) saved = [];

  // ── Small helpers ──────────────────────────────────────────────────────
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '#';
  const ms = iso => Date.parse(iso || '');
  const brands = () => L.brandList(data);
  const labelOf = id => data?.categories?.find(c => c.id === id)?.label || L.SHORT[id] || id;
  const favicon = domain => domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : '';
  const iconImg = (domain, size) => domain ? `<img src="${esc(favicon(domain))}" alt="" width="${size}" height="${size}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  // League marks (league-logos.js): a flat tile with the logo, never the
  // league name as text. The name is the tile's aria-label.
  const league = id => window.LeagueLogos?.logoFor(id) || { id: 'sports', label: L.SHORT[id] || 'Sports', src: 'assets/league-logos/sports.svg', bg: '#F2F4F7' };
  const leagueName = id => L.SHORT[id] || league(id).label;
  const leagueImg = id => `<img src="${esc(league(id).src)}" alt="" decoding="async">`;
  const leagueTile = (id, cls) => `<span class="td-league ${cls}" style="--league-bg:${esc(league(id).bg)}" aria-hidden="true">${leagueImg(id)}</span>`;
  const leagueVisual = id => `<div class="trend-visual is-league" data-sport="${esc(id)}" role="img" aria-label="${esc(leagueName(id))}" style="--league-bg:${esc(league(id).bg)}"><span class="td-fallback">${leagueImg(id)}</span></div>`;
  // A photo or team logo that fails to load falls back to the league tile.
  window.AIStudioTrendPhotoError = img => { const visual = img.closest('.trend-visual'); if (visual) visual.outerHTML = leagueVisual(visual.dataset.sport); };

  const fresh = item => L.isFresh(item, data?.freshness);
  const liveItems = () => (data?.items || []).filter(fresh);
  const boardItems = () => liveItems().filter(item => L.matchesBrand(item, prefs.brand, brands()));
  const isSaved = id => saved.some(s => s.id === id);
  const findItem = id => data?.items?.find(item => item.id === id) || saved.find(item => item.id === id);
  const aiFor = item => aiCache.get(item.id) || (item.ai?.titles?.length || item.ai?.why ? { ...item.ai, ai: true } : null);
  const announce = text => { els.announce.textContent = ''; setTimeout(() => { els.announce.textContent = text; }, 30); };

  let toastRegion = null;
  function toast(text, action) {
    if (!toastRegion) {
      toastRegion = document.querySelector('.es-toast-region') || Object.assign(document.createElement('div'), { className: 'es-toast-region' });
      if (!toastRegion.isConnected) { toastRegion.setAttribute('aria-live', 'polite'); document.body.append(toastRegion); }
    }
    const el = document.createElement('div');
    el.className = `es-toast${action ? ' es-toast--action' : ''}`;
    el.innerHTML = `<span>${esc(text)}</span>${action ? `<button class="es-toast-action" type="button">${esc(action.label)}</button>` : ''}`;
    if (action) el.querySelector('button').addEventListener('click', () => { action.run(); el.remove(); });
    toastRegion.append(el);
    setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 260); }, action ? 5000 : 3000);
  }

  // ── Hand-offs ──────────────────────────────────────────────────────────
  const briefFor = (item, headline) => L.briefFor(item, { headline, why: aiFor(item)?.why || '', sportLabel: labelOf(item.category) });
  const designUrl = (item, headline) => `generate.html?brief=${encodeURIComponent(briefFor(item, headline))}`;
  const videoOf = item => L.videoHandoff(item, { why: aiFor(item)?.why || '' });
  const reelOf = item => { const ai = aiFor(item); return L.reelHandoff(item, { why: ai?.why || '', hook: ai?.hook || '' }); };
  const handOff = h => store.set(h.key, h.payload, 'sessionStorage');
  // Design in the Generate view (this page). A template from the kit selects
  // Generate's format card first (the format picker is Generate's own UI).
  function designHere(brief, id, template) {
    if (template) document.querySelector(`#gen-formats [data-type="${CSS.escape(template)}"]`)?.click();
    document.dispatchEvent(new CustomEvent('ais:design', { detail: { brief, source: 'trends', trendId: id, format: template || '' } }));
  }

  // ── Cards ──────────────────────────────────────────────────────────────
  function visualHtml(item) {
    const team = item.team?.logo ? `<span class="td-team-badge" title="${esc(item.team.name)}"><img src="${esc(item.team.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></span>` : '';
    if (item.image) {
      const badge = item.sourceDomain ? `<span class="td-src-badge" title="${esc(item.source)}">${iconImg(item.sourceDomain, 16)}</span>` : '';
      return `<div class="trend-visual${item.imageKind === 'logo' ? ' is-logo' : ''}" data-sport="${esc(item.category)}"><img class="td-photo" src="${esc(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" ${item.imageCredit ? `title="${esc(item.imageCredit)}"` : ''} onerror="window.AIStudioTrendPhotoError?.(this)">${badge}${team}</div>`;
    }
    if (item.team?.logo) {
      return `<div class="trend-visual is-logo" data-sport="${esc(item.category)}" role="img" aria-label="${esc(item.team.name)}"><img class="td-photo" src="${esc(item.team.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="window.AIStudioTrendPhotoError?.(this)"></div>`;
    }
    return leagueVisual(item.category);
  }

  function whyHtml(item, isNew) {
    const why = aiFor(item)?.why;
    return why ? `<p class="trend-why${isNew ? ' is-new' : ''}">${ICON.sparkles}<span><span class="es-sr-only">Why fans care: </span>${esc(why)}</span></p>` : '';
  }

  function ideasHtml(item, isNew) {
    const ai = aiFor(item);
    const state = aiState.get(item.id);
    const titles = (ai?.titles?.length ? ai.titles : item.titles || []).slice(0, 3);
    const canAsk = data?.aiEnrich && !ai && state !== 'loading' && state !== 'limited' && state !== 'off';
    const side = ai ? '<span class="ais-badge" title="Written by AI from the story">AI</span>'
      : canAsk ? `<button class="td-icon-btn trend-ideas__ai" type="button" data-ai aria-label="AI angles for this trend">${ICON.sparkles}<span>${state === 'error' ? 'Try AI again' : 'AI angles'}</span></button>` : '';
    const head = `<div class="trend-ideas__head"><span class="trend-ideas__label">${ICON.sparkles}<span>Headline ideas</span></span>${side}</div>`;
    if (state === 'loading') return `${head}<div class="trend-ideas__list" aria-busy="true">${'<span class="trend-idea is-skeleton es-skeleton"></span>'.repeat(3)}</div>`;
    const note = state === 'limited' ? '<p class="trend-ideas__note">AI limit reached for now, so these are quick ideas.</p>'
      : (state === 'off' || (data?.aiOff && !ai)) ? '<p class="trend-ideas__note">AI angles are switched off for now, so these are quick ideas.</p>' : '';
    // No quick idea (a long headline with no clean clause): just the AI
    // button, or nothing at all, never an empty box.
    if (!titles.length) return canAsk || note ? `${head}${note}` : '';
    return `${head}<div class="trend-ideas__list${isNew ? ' is-new' : ''}">${titles.map(t => `<div class="trend-idea"><a class="trend-idea__go" href="${esc(designUrl(item, t))}" data-design title="Design a post with this headline">${esc(t)}</a><button class="trend-idea__copy" type="button" data-copy="${esc(t)}" aria-label="Copy headline: ${esc(t)}" title="Copy">${ICON.copy}</button></div>`).join('')}</div>${note}`;
  }

  function saveBtn(item) {
    const on = isSaved(item.id);
    return `<button class="td-icon-btn td-save" type="button" data-save aria-pressed="${on}" title="${on ? 'Remove from the shortlist (S)' : 'Add to the shortlist (S)'}">${ICON.bookmark}<span>${on ? 'Shortlisted' : 'Shortlist'}</span></button>`;
  }

  const SIGNAL = { hot: ['Hot', ICON.flame, 'Big search volume or many outlets on this story right now'], rising: ['Rising', ICON.trending, 'More outlets or searches than an hour ago'] };
  function signalHtml(item) {
    const s = SIGNAL[item.signal];
    return s ? `<span class="td-signal is-${esc(item.signal)}" title="${esc(s[2])}">${s[1]}${s[0]}</span>` : '';
  }

  function storyHtml(item, more) {
    if (!more?.length) return '';
    const label = item.storyline?.label || 'this story';
    return `<details class="td-story" data-story="${esc(item.storyline?.id || '')}"><summary>${ICON.layers}<span>${esc(label)}: ${more.length} more ${more.length === 1 ? 'story' : 'stories'}</span>${ICON.chevron}</summary><ul class="td-story__list">${more.map(m => `<li><a href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener noreferrer">${iconImg(m.sourceDomain, 14)}<span class="td-story__title">${esc(m.title)}</span><span class="es-sr-only"> (opens in a new tab)</span></a><span class="td-story__meta">${esc(m.source || '')} · ${esc(L.ago(m.publishedAt))}</span><a class="td-story__use" href="${esc(designUrl(m))}" data-design data-for="${esc(m.id)}">Design this one</a></li>`).join('')}</ul></details>`;
  }

  function row(item, index, { more = [], pick = false } = {}) {
    const isSearch = item.type === 'search';
    const tag = isSearch
      ? `<span class="trend-tag is-search"><span class="es-live-dot" aria-hidden="true"></span>Trending on Google${item.traffic ? ` · ${esc(item.traffic)} searches` : ''}</span>`
      : `<span class="trend-tag">${ICON.news}News</span>`;
    const related = isSearch && item.related?.length
      ? `<ul class="trend-related">${item.related.slice(0, 2).map(r => `<li><a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">${iconImg(r.domain, 14)}<span>${esc(r.title)}</span><span class="es-sr-only"> (opens in a new tab)</span></a></li>`).join('')}</ul>`
      : '';
    const outlets = item.coverage > 1 ? `<span class="trend-meta__sep" aria-hidden="true">·</span><span title="Covered by ${item.coverage} publications">${item.coverage} sources</span>` : '';
    const age = L.freshness(item.publishedAt);
    const why = pick ? L.whyNow(item, { brands: brands() }) : '';
    const kitOpen = openKits.has(item.id);
    const canVideo = L.AD_SPORTS.includes(item.category);
    return `<article class="trend-row ais-card${isSearch ? ' is-search' : ''}${pick ? ' is-pick' : ''}${kitOpen ? ' has-kit' : ''}" style="--i:${index}" tabindex="-1" data-id="${esc(item.id)}" data-sport="${esc(item.category)}" aria-labelledby="tt-${esc(item.id)}">
      ${visualHtml(item)}
      <div class="trend-body">
        <div class="trend-meta">${signalHtml(item)}${tag}<span class="td-source">${iconImg(item.sourceDomain, 16)}${esc(item.source || 'Google')}</span><span class="trend-meta__sep" aria-hidden="true">·</span><time datetime="${esc(item.publishedAt)}" class="td-age is-${age}">${L.ago(item.publishedAt)}</time>${outlets}</div>
        <h3 class="trend-title es-type-card-title" id="tt-${esc(item.id)}">${esc(item.title)}</h3>
        ${why ? `<p class="td-why-now"><span class="es-sr-only">Why now: </span>${esc(why)}</p>` : ''}
        <div data-why="${esc(item.id)}">${whyHtml(item)}</div>
        ${related}
        ${storyHtml(item, more)}
        <div class="trend-ideas" data-ideas="${esc(item.id)}">${ideasHtml(item)}</div>
      </div>
      <div class="trend-actions">
        <a class="es-btn es-btn--sm td-design" href="${esc(designUrl(item))}" data-design title="Design a post (D)">${ICON.wand}Design post</a>
        <button class="es-btn es-btn--sm es-btn--tertiary td-kit-btn" type="button" data-kit aria-expanded="${kitOpen}" aria-controls="kit-${esc(item.id)}" title="Headlines, template, photo, reel hook and video ad (P)">${ICON.kit}<span>Post kit</span></button>
        <div class="trend-actions__row">
          <a class="td-icon-btn" href="${esc(reelOf(item).url)}" data-reel title="Make a reel (R)">${ICON.film}<span>Reel</span></a>
          ${canVideo ? `<a class="td-icon-btn" href="${esc(videoOf(item).url)}" data-video title="Make a video ad (V)">${ICON.video}<span>Video ad</span></a>` : ''}
          ${saveBtn(item)}
          <a class="td-icon-btn" href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer" data-open title="Read the story (O)">${ICON.external}<span>Read</span><span class="es-sr-only"> the story (opens in a new tab)</span></a>
        </div>
      </div>
      <div class="td-kit" id="kit-${esc(item.id)}" data-kit-for="${esc(item.id)}" role="region" aria-label="Post kit: ${esc(item.title)}"${kitOpen ? '' : ' hidden'}>${kitOpen ? kitHtml(item) : ''}</div>
    </article>`;
  }

  // ── Post kit ───────────────────────────────────────────────────────────
  function kitHtml(item, isNew) {
    const ai = aiFor(item);
    const state = aiState.get(item.id);
    const kit = L.kitFor(item, ai, { brands: brands() });
    const busy = state === 'loading';
    const copyBtn = (text, label) => `<button class="es-icon-btn td-kit__copy" type="button" data-copy="${esc(text)}" aria-label="Copy ${esc(label)}" title="Copy">${ICON.copy}</button>`;
    const sk = n => `<span class="td-sk es-skeleton" style="height:${n}px"></span>`;
    const heads = busy ? `<div class="td-kit__heads" aria-busy="true">${sk(36)}${sk(36)}${sk(36)}</div>`
      : kit.headlines.length ? `<ol class="td-kit__heads${isNew ? ' is-new' : ''}">${kit.headlines.map((h, i) => `<li><span class="td-kit__n" aria-hidden="true">${i + 1}</span><span class="td-kit__text">${esc(h)}</span>${copyBtn(h, `headline: ${h}`)}<a class="es-btn es-btn--sm es-btn--tertiary" href="${esc(designUrl(item, h))}" data-design>Use</a></li>`).join('')}</ol>`
      : '<p class="td-kit__empty">No quick headline for this one. Ask for AI angles, or write your own in Generate.</p>';
    const aiNote = kit.headlinesAi ? '<span class="ais-badge" title="Written by AI from the story">AI</span>'
      : busy ? '<span class="td-kit__state">Writing…</span>'
      : state === 'limited' ? '<span class="td-kit__state">AI limit reached: quick ideas</span>'
      : (state === 'off' || data?.aiOff) ? '<span class="td-kit__state">AI is off: quick ideas</span>'
      : data?.aiEnrich ? `<button class="td-icon-btn" type="button" data-ai>${ICON.sparkles}<span>${state === 'error' ? 'Try AI again' : 'AI angles'}</span></button>` : '<span class="td-kit__state">Quick ideas</span>';
    const hook = busy ? sk(40)
      : kit.hook ? `<p class="td-kit__quote${isNew ? ' is-new' : ''}">${esc(kit.hook)}</p>`
      : `<p class="td-kit__empty">${data?.aiEnrich && state !== 'off' && state !== 'limited' ? 'The hook comes with AI angles.' : 'Write the first line in Reels Studio.'}</p>`;
    const team = kit.team ? `<span class="td-kit__team"><span class="es-team-logo" style="--logo:24px">${kit.team.logo ? `<img src="${esc(kit.team.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('es-team-logo--dot')">` : ''}</span>${esc(kit.team.name)} logo</span>` : '';
    const brand = brands().find(b => b.label === kit.video?.brand);
    return `<div class="td-kit__grid">
      <section class="td-kit__sec td-kit__sec--heads" aria-labelledby="kh-${esc(item.id)}">
        <div class="td-kit__head"><h4 class="td-kit__label" id="kh-${esc(item.id)}">${ICON.sparkles}Headlines</h4>${aiNote}</div>
        ${heads}
      </section>
      <section class="td-kit__sec" aria-labelledby="kt-${esc(item.id)}">
        <div class="td-kit__head"><h4 class="td-kit__label" id="kt-${esc(item.id)}">${ICON.layout}Template</h4></div>
        <div class="td-kit__tpl"><img src="${esc(kit.template.thumb)}" alt="" width="56" height="70" loading="lazy"><div><p class="td-kit__strong">${esc(kit.template.label)}</p><p class="td-kit__meta">${esc(kit.template.why)}</p></div></div>
        <button class="es-btn es-btn--sm" type="button" data-design-template="${esc(kit.template.id)}">${ICON.wand}Design as ${esc(kit.template.label)}</button>
      </section>
      <section class="td-kit__sec" aria-labelledby="kp-${esc(item.id)}">
        <div class="td-kit__head"><h4 class="td-kit__label" id="kp-${esc(item.id)}">${ICON.image}Photo</h4></div>
        <p class="td-kit__row"><span class="td-kit__strong">${esc(kit.photo.query)}</span>${copyBtn(kit.photo.query, 'photo search')}</p>
        <p class="td-kit__meta">${kit.photo.kind === 'person' ? 'Search this name' : 'Search this'} in the editor’s photo library.</p>
        ${team}
      </section>
      <section class="td-kit__sec" aria-labelledby="kr-${esc(item.id)}">
        <div class="td-kit__head"><h4 class="td-kit__label" id="kr-${esc(item.id)}">${ICON.film}Reel hook</h4>${kit.hook && !busy ? copyBtn(kit.hook, 'reel hook') : ''}</div>
        ${hook}
        <a class="es-btn es-btn--sm" href="${esc(reelOf(item).url)}" data-reel>${ICON.film}Make a reel</a>
      </section>
      ${kit.video ? `<section class="td-kit__sec" aria-labelledby="kv-${esc(item.id)}">
        <div class="td-kit__head"><h4 class="td-kit__label" id="kv-${esc(item.id)}">${ICON.video}Video ad</h4></div>
        ${kit.video.brand ? `<p class="td-kit__row"><span class="td-kit__brand" style="--brand:${esc(brand?.accent || '#5C6373')}" aria-hidden="true"></span><span class="td-kit__strong">${esc(kit.video.brand)}</span></p>` : ''}
        <p class="td-kit__meta">The moment: this story, with its team and sport.</p>
        <a class="es-btn es-btn--sm" href="${esc(videoOf(item).url)}" data-video>${ICON.video}Make a video ad</a>
      </section>` : ''}
    </div>
    <div class="td-kit__foot"><p class="td-kit__meta">${kit.headlinesAi ? 'AI wrote these from the story only. ' : ''}Check facts before you post.</p><button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-copy-kit>${ICON.clipboard}Copy kit</button></div>`;
  }

  function toggleKit(id, open = !openKits.has(id), { focus = false } = {}) {
    const item = findItem(id);
    if (!item) return;
    if (open) openKits.add(id); else openKits.delete(id);
    document.querySelectorAll(`.trend-row[data-id="${CSS.escape(id)}"]`).forEach(rowEl => {
      const box = rowEl.querySelector('.td-kit');
      rowEl.classList.toggle('has-kit', open);
      rowEl.querySelector('[data-kit]')?.setAttribute('aria-expanded', String(open));
      box.hidden = !open;
      box.innerHTML = open ? kitHtml(item) : '';
      if (open && focus) box.querySelector('a, button')?.focus();
    });
    // Opening a kit is the request for its AI angles (one story, cached).
    if (open && needsAi(id)) wantAi([id], 0);
  }

  function skeleton(n) {
    return `<div class="trends-list" aria-hidden="true">${Array.from({ length: n }, () => `<div class="trend-row is-skeleton"><span class="td-sk es-skeleton" style="width:100%;aspect-ratio:1;border-radius:14px"></span><div class="trend-body"><span class="td-sk es-skeleton" style="width:min(220px,100%);height:22px"></span><span class="td-sk es-skeleton" style="height:18px"></span><span class="td-sk es-skeleton" style="width:60%;height:18px"></span><span class="td-sk es-skeleton" style="width:80%;height:34px;margin-top:8px"></span></div><span class="td-sk trend-actions" style="height:40px"></span></div>`).join('')}</div>`;
  }

  // ── Toolbar: brand, density, filters, stats ────────────────────────────
  function renderBrands() {
    const list = brands();
    const options = [['', 'All of ES'], ...list.map(b => [b.id, b.label])];
    if (!list.some(b => b.id === prefs.brand)) prefs.brand = '';
    els.brand.innerHTML = options.map(([id, label]) => `<option value="${esc(id)}"${id === prefs.brand ? ' selected' : ''}>${esc(label)}</option>`).join('');
  }
  function renderDensity() {
    root.dataset.density = prefs.density === 'list' ? 'list' : 'cards';
    els.density.querySelectorAll('[data-density]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.density === root.dataset.density)));
  }
  function categoriesNow() {
    const live = boardItems();
    return (data?.categories || []).map(c => ({ ...c, count: live.filter(i => i.category === c.id).length }));
  }
  const focusActiveChip = () => els.filters.querySelector(`[data-sport="${CSS.escape(active)}"]`)?.focus();
  function renderFilters() {
    const cats = categoriesNow().filter(c => c.count || c.id === active);
    const chips = [{ id: 'all', label: 'All', count: boardItems().length }, ...cats];
    const hadFocus = els.filters.contains(document.activeElement);
    els.filters.innerHTML = chips.map(c => `<button type="button" class="es-chip" data-sport="${esc(c.id)}" aria-pressed="${c.id === active}">${c.id === 'all' ? '' : leagueTile(c.id, 'td-league--chip')}<span>${esc(c.label)}</span><span class="template-filter__count">${c.count}</span></button>`).join('')
      + `<span class="td-chip-sep" aria-hidden="true"></span><button type="button" class="es-chip" data-sport="saved" aria-pressed="${active === 'saved'}">${ICON.bookmark}<span>Shortlist</span><span class="template-filter__count">${saved.length}</span></button>`;
    if (hadFocus) focusActiveChip();
  }

  function renderStats() {
    if (!data) { els.stats.innerHTML = ''; return; }
    const live = boardItems();
    const searches = live.filter(i => i.type === 'search').length;
    const stories = new Set(live.map(i => i.storyline?.id || i.id)).size;
    const hot = live.filter(i => i.signal === 'hot' || i.signal === 'rising').length;
    els.stats.innerHTML = `<span><b data-es-tick="td-stories">${stories}</b> stories</span>${hot ? `<span title="${searches ? `${searches} trending on Google` : ''}"><b data-es-tick="td-moving">${hot}</b> moving now</span>` : ''}`;
  }

  function setEmpty(kind) {
    if (!kind) { els.empty.hidden = true; els.empty.innerHTML = ''; return; }
    const brand = brands().find(b => b.id === prefs.brand);
    const copy = {
      saved: ['Your shortlist is empty', 'Press Shortlist (or S) on a story to keep it here, even after it drops off the board. Copy the list to share it with your team.', '<button class="es-btn es-btn--sm" type="button" data-filter="all">Browse trends</button>'],
      brand: [`No ${esc(leagueName(active))} stories for ${esc(brand?.label || 'this newsletter')}`, `${esc(brand?.label || 'This newsletter')} covers ${esc(leagueName(brand?.sport || ''))}.`, '<button class="es-btn es-btn--sm" type="button" data-brand-all>Show all of ES</button>'],
      sport: [`No ${esc(leagueName(active))} trends in the last 48 hours`, 'New stories land every few minutes.', '<button class="es-btn es-btn--sm" type="button" data-filter="all">See all sports</button><button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-refresh>Refresh</button>'],
      all: ['No sports trends right now', 'Google had nothing new for US sports fans. Refresh in a few minutes, or start from your own brief.', '<button class="es-btn es-btn--sm" type="button" data-refresh>Refresh</button><a class="es-btn es-btn--sm es-btn--tertiary" href="generate.html">Write a brief</a>'],
    }[kind];
    els.empty.innerHTML = `<p class="es-empty__title">${copy[0]}</p><p class="es-empty__copy">${copy[1]}</p><div class="trends-empty__actions">${copy[2]}</div>`;
    els.empty.hidden = false;
  }

  function renderError() {
    els.filters.innerHTML = '';
    els.stats.innerHTML = '';
    setEmpty(null);
    els.body.innerHTML = `<div class="es-error-state" role="alert"><span class="es-error-state__icon">${ICON.alert}</span><p class="es-empty__title">Trends couldn’t load</p><p class="es-empty__copy">Google didn’t answer in time. Try again, or start from your own brief.</p><div class="trends-empty__actions"><button class="es-btn es-btn--sm" type="button" data-refresh>${ICON.refresh}Try again</button><a class="es-btn es-btn--sm es-btn--tertiary" href="generate.html">Write a brief</a></div></div>`;
  }

  const listHtml = (entries, cls, opts = {}) => `<div class="${cls}">${entries.map((e, i) => row(e.item, i, { more: e.more, ...opts })).join('')}</div>`;
  function render() {
    if (!data) { if (failed) renderError(); else { els.body.innerHTML = skeleton(4); setEmpty(null); } return; }
    renderFilters();
    renderStats();
    const live = boardItems();
    shownCount = liveItems().length;
    const listClass = `trends-list${entered ? '' : ' is-entering'}`;
    if (active === 'saved') {
      const list = saved.map(s => data.items.find(i => i.id === s.id) || s);
      els.body.innerHTML = list.length ? `<div class="td-shortlist-bar"><p>Kept on this browser. Copy the list to share it in Slack or a doc.</p><div class="td-shortlist-bar__actions"><button class="es-btn es-btn--sm" type="button" data-copy-list>${ICON.clipboard}Copy list</button><button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-clear-list>${ICON.trash}Clear</button></div></div>${listHtml(list.map(item => ({ item, more: [] })), listClass)}` : '';
      setEmpty(list.length ? null : 'saved');
    } else if (active === 'all') {
      const picks = L.topPicks(live, { n: PICKS });
      const pickStories = new Set(picks.map(p => p.storyline?.id || p.id));
      const inPick = item => pickStories.has(item.storyline?.id || item.id);
      const pickEntries = picks.map(p => ({ item: p, more: live.filter(i => i !== p && p.storyline && i.storyline?.id === p.storyline.id) }));
      const cats = categoriesNow().filter(c => c.count);
      const picksHtml = picks.length ? `<section class="trends-group trends-picks"${entered ? '' : ' data-ais-reveal'} aria-labelledby="tg-picks">
        <div class="trends-group__head"><h2 id="tg-picks">${ICON.flame}Post now <span class="template-picker__count">${picks.length}</span></h2><p class="trends-group__sub">Ranked by freshness, momentum and ES fit${prefs.brand ? ` for ${esc(brands().find(b => b.id === prefs.brand)?.label || '')}` : ''}.</p></div>
        ${listHtml(pickEntries, listClass, { pick: true })}
      </section>` : '';
      const groups = cats.map(c => {
        const entries = L.foldStorylines(live.filter(i => i.category === c.id && !inPick(i)));
        if (!entries.length) return '';
        return `<section class="trends-group" data-sport="${esc(c.id)}"${entered ? '' : ' data-ais-reveal'} aria-labelledby="tg-${esc(c.id)}">
          <div class="trends-group__head"><h2 id="tg-${esc(c.id)}">${leagueTile(c.id, 'td-league--head')}${esc(c.label)} <span class="template-picker__count">${c.count}</span></h2>${entries.length > PER_GROUP ? `<button class="trends-group__more" type="button" data-sport="${esc(c.id)}">See all ${c.count}${ICON.chevron}</button>` : ''}</div>
          ${listHtml(entries.slice(0, PER_GROUP), listClass)}
        </section>`;
      }).join('');
      els.body.innerHTML = picksHtml + groups;
      setEmpty(live.length ? null : prefs.brand ? 'brand' : 'all');
    } else {
      const entries = L.foldStorylines(live.filter(i => i.category === active));
      els.body.innerHTML = entries.length ? listHtml(entries, listClass) : '';
      setEmpty(entries.length ? null : prefs.brand && liveItems().some(i => i.category === active) ? 'brand' : 'sport');
    }
    entered = true;
    els.aiAll.hidden = !data.aiEnrich || active === 'saved';
    rove();
    window.AIStudio?.reveal(els.body);
  }

  // Repaint one card's AI parts (why line, ideas, open kit) in place.
  function paintAi(id, isNew) {
    const item = findItem(id);
    if (!item) return;
    document.querySelectorAll(`[data-why="${CSS.escape(id)}"]`).forEach(box => { box.innerHTML = whyHtml(item, isNew); });
    document.querySelectorAll(`[data-ideas="${CSS.escape(id)}"], [data-kit-for="${CSS.escape(id)}"]:not([hidden])`).forEach(box => {
      const hadFocus = box.contains(document.activeElement);
      box.innerHTML = box.matches('.td-kit') ? kitHtml(item, isNew) : ideasHtml(item, isNew);
      if (hadFocus) box.querySelector('a, button')?.focus();
    });
  }

  // ── AI angles: on request only, batched, cached ────────────────────────
  const aiQueue = new Set();
  let aiTimer = 0;
  let aiRunning = false;
  const needsAi = id => data?.aiEnrich && !aiCache.has(id) && !findItem(id)?.ai && !aiState.has(id);
  function wantAi(ids, delay = 200) {
    ids.filter(needsAi).forEach(id => aiQueue.add(id));
    if (!aiQueue.size) return;
    clearTimeout(aiTimer);
    aiTimer = setTimeout(flushAi, delay);
  }
  const authFetch = (url, init) => (window.ESAuth?.fetchWithAuth ? window.ESAuth.fetchWithAuth(url, init) : fetch(url, init));
  async function flushAi() {
    if (aiRunning || !aiQueue.size) return;
    aiRunning = true;
    const ids = [...aiQueue].slice(0, AI_BATCH);
    ids.forEach(id => { aiQueue.delete(id); aiState.set(id, 'loading'); paintAi(id); });
    let limited = false;
    let message = '';
    try {
      const items = ids.map(id => { const item = findItem(id); return { id, title: item.title, related: (item.related || []).slice(0, 2).map(r => r.title), sport: labelOf(item.category) }; });
      const response = await authFetch('/api/trend-design', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'enrich', items }) });
      const json = await response.json().catch(() => null);
      limited = response.status === 429 || Boolean(json?.limited);
      const off = json?.limited === 'off';
      message = json?.error || '';
      const got = json?.items || {};
      ids.forEach(id => {
        const value = got[id];
        if (value?.ai) { aiCache.set(id, { why: value.why || '', titles: value.titles || [], hook: value.hook || '', ai: true, at: Date.now() }); aiState.delete(id); }
        else aiState.set(id, off ? 'off' : limited ? 'limited' : 'error');
      });
    } catch (error) {
      ids.forEach(id => aiState.set(id, 'error'));
    }
    aiRunning = false;
    saveAi();
    ids.forEach(id => paintAi(id, true));
    const done = ids.filter(id => aiCache.has(id)).length;
    if (done) announce(`AI angles ready for ${done} trend${done === 1 ? '' : 's'}.`);
    if (limited) toast(message || 'AI limit reached for now. Quick headline ideas still work.');
    else if (!done) toast('AI angles didn’t load. Quick headline ideas still work.');
    if (aiQueue.size) flushAi();
  }

  function visibleIds() {
    return [...els.body.querySelectorAll('.trend-row[data-id]')].filter(rowEl => {
      const box = rowEl.getBoundingClientRect();
      return box.height && box.bottom > 0 && box.top < window.innerHeight;
    }).map(rowEl => rowEl.dataset.id);
  }
  els.aiAll.addEventListener('click', () => {
    // The picks first (the stories most likely to be posted), then what's on screen.
    const picks = [...els.body.querySelectorAll('.trend-row.is-pick[data-id]')].map(r => r.dataset.id);
    const ids = [...new Set([...picks, ...visibleIds()])].filter(needsAi).slice(0, AI_BATCH);
    if (!ids.length) { toast('AI angles are already showing for these stories.'); return; }
    wantAi(ids, 0);
  });

  // ── Shortlist ──────────────────────────────────────────────────────────
  function toggleSave(id, button) {
    const item = findItem(id);
    if (!item) return;
    if (isSaved(id)) {
      saved = saved.filter(s => s.id !== id);
      announce('Removed from the shortlist.');
    } else {
      const { ai, rank, ...snapshot } = item;
      saved = [{ ...snapshot, savedAt: Date.now() }, ...saved].slice(0, MAX_SAVED);
      toast('Added to the shortlist', active === 'saved' ? null : { label: 'View shortlist', run: () => setActive('saved', true) });
    }
    store.set(KEY.saved, saved);
    if (active === 'saved') { render(); return; }
    document.querySelectorAll(`.trend-row[data-id="${CSS.escape(id)}"] [data-save]`).forEach(b => { b.outerHTML = saveBtn(item); });
    renderFilters();
    if (button) document.querySelector(`.trend-row[data-id="${CSS.escape(id)}"] [data-save]`)?.focus();
  }

  async function copyText(text, button, what = 'Headline') {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (error) {
      const area = Object.assign(document.createElement('textarea'), { value: text });
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;opacity:0';
      document.body.append(area);
      area.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      area.remove();
    }
    if (!ok) { toast(`Couldn’t copy. Select the text and copy it by hand.`); return; }
    announce(`${what} copied.`);
    if (!button) { toast(`${what} copied`); return; }
    const before = button.innerHTML;
    button.classList.add('is-done');
    button.innerHTML = button.matches('.trend-idea__copy, .td-kit__copy') ? ICON.check : `${ICON.check}Copied`;
    setTimeout(() => { button.classList.remove('is-done'); button.innerHTML = before; }, 1500);
  }

  // ── Status + loading (instant from the last feed, then fresh) ──────────
  function setLive() {
    if (!data) {
      els.updated.textContent = failed && !loading ? 'Not loaded' : 'Loading live trends…';
      els.live.classList.toggle('is-error', failed && !loading);
      return;
    }
    const age = Date.now() - ms(data.updatedAt);
    let text = `Updated ${L.agoLong(data.updatedAt)}`;
    if (loading) text += ' · updating…';
    else if (failed) text = `Couldn’t refresh · updated ${L.agoLong(data.updatedAt)}`;
    els.updated.textContent = text;
    els.live.title = `Rebuilt every ${Math.round((data.refreshSeconds || 600) / 60)} minutes. News older than ${data.freshness?.newsMaxHours || 48} h and searches older than ${data.freshness?.searchMaxHours || 24} h are hidden.`;
    els.live.classList.toggle('is-stale', !failed && (age > STALE_AFTER_MS || Boolean(data.stale)));
    els.live.classList.toggle('is-error', failed);
    document.querySelectorAll('.trend-meta time').forEach(t => {
      const iso = t.getAttribute('datetime');
      t.textContent = L.ago(iso);
      t.className = `td-age is-${L.freshness(iso)}`;
    });
    // A story that just passed its cutoff leaves the board (unless
    // someone is working in it).
    if (active !== 'saved' && liveItems().length !== shownCount && !els.body.contains(document.activeElement)) render();
  }

  function adopt(json) {
    data = json;
    (json.items || []).forEach(item => { if (item.ai && !aiCache.has(item.id)) aiCache.set(item.id, { why: item.ai.why || '', titles: item.ai.titles || [], hook: item.ai.hook || '', ai: true, at: Date.now() }); });
    renderBrands();
  }

  async function load(force) {
    if (loading) return;
    loading = true;
    setLive();
    els.refresh.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`/api/trend-design${force ? `?fresh=1&t=${Date.now()}` : ''}`, { headers: { Accept: 'application/json' } });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || `HTTP ${response.status}`);
      const first = !data;
      adopt(json);
      loadedAt = Date.now();
      failed = false;
      store.set(KEY.feed, json);
      els.notice.hidden = !(json.sourcesFailed?.length);
      if (json.sourcesFailed?.length) els.notice.textContent = 'Some sources didn’t respond this time, so a few trends may be missing. They’ll be back on the next refresh.';
      // A background refresh must not wipe the cards while someone is
      // working in them: keep the list, update counts and status.
      if (!first && !force && els.body.contains(document.activeElement)) { renderFilters(); renderStats(); } else render();
      if (force) announce(`Trends updated: ${liveItems().length} stories.`);
    } catch (error) {
      failed = true;
      if (!data) render();
    } finally {
      loading = false;
      els.refresh.removeAttribute('aria-busy');
      setLive();
    }
  }

  function sportUrl() {
    const url = new URL(location.href);
    url.searchParams.set('view', 'trends');
    if (active === 'all') url.searchParams.delete('sport'); else url.searchParams.set('sport', active);
    return url;
  }
  function setActive(next, focusChip) {
    active = next;
    history.replaceState(history.state, '', sportUrl());
    entered = false;
    render();
    if (focusChip) focusActiveChip();
  }
  const savePrefs = () => store.set(KEY.prefs, { density: prefs.density, brand: prefs.brand });

  // ── Keyboard: roving focus across cards + single-key shortcuts ─────────
  const cards = () => [...els.body.querySelectorAll('.trend-row[data-id]')];
  let current = '';
  function rove(id = current) {
    const list = cards();
    const target = list.find(c => c.dataset.id === id) || list[0];
    list.forEach(c => { c.tabIndex = c === target ? 0 : -1; });
    current = target?.dataset.id || '';
    return target;
  }
  function moveCard(step) {
    const list = cards();
    if (!list.length) return;
    const at = list.findIndex(c => c.contains(document.activeElement));
    const next = list[Math.max(0, Math.min(list.length - 1, at < 0 ? 0 : at + step))];
    rove(next.dataset.id).focus({ preventScroll: false });
    next.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function toggleKeys(open = els.keys.hidden) {
    els.keys.hidden = !open;
    els.keysBtn.setAttribute('aria-expanded', String(open));
    if (open) els.keys.querySelector('button')?.focus(); else els.keysBtn.focus();
  }
  els.keys.innerHTML = `<div class="td-keys__head"><p class="td-keys__title">Keyboard shortcuts</p><button class="es-icon-btn" type="button" data-keys-close aria-label="Close shortcuts">${svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>')}</button></div><dl class="td-keys__list">${L.SHORTCUTS.map(([key, , label]) => `<div><dt><kbd class="es-kbd">${esc(key.toUpperCase())}</kbd></dt><dd>${esc(label)}</dd></div>`).join('')}<div><dt><kbd class="es-kbd">↑</kbd> <kbd class="es-kbd">↓</kbd></dt><dd>Move between stories</dd></div><div><dt><kbd class="es-kbd">Esc</kbd></dt><dd>Close the post kit</dd></div></dl>`;
  els.keysBtn.addEventListener('click', () => toggleKeys());
  els.keys.addEventListener('click', event => { if (event.target.closest('[data-keys-close]')) toggleKeys(false); });

  document.addEventListener('keydown', event => {
    if (!isOpen()) return;
    const inView = root.contains(event.target) || event.target === document.body;
    if (!inView) return;
    const action = L.shortcut(event);
    if (!action) return;
    if (action === 'help') { event.preventDefault(); toggleKeys(); return; }
    if (action === 'close') {
      if (!els.keys.hidden) { toggleKeys(false); return; }
      const rowEl = event.target.closest?.('.trend-row');
      if (rowEl && openKits.has(rowEl.dataset.id)) { toggleKit(rowEl.dataset.id, false); rowEl.focus(); }
      return;
    }
    if (action === 'next' || action === 'prev') { event.preventDefault(); moveCard(action === 'next' ? 1 : -1); return; }
    // The rest act on the focused card (or the first one).
    const rowEl = event.target.closest?.('.trend-row[data-id]') || (event.target === document.body ? rove() : null);
    if (!rowEl) return;
    // Inside a card, Enter on a button / link keeps its own meaning.
    if (action === 'kit' && event.key === 'Enter' && event.target !== rowEl) return;
    const id = rowEl.dataset.id;
    const item = findItem(id);
    if (!item) return;
    event.preventDefault();
    if (action === 'kit') { toggleKit(id); return; }
    if (action === 'design') { designHere(briefFor(item), id); return; }
    if (action === 'reel') { const h = reelOf(item); handOff(h); location.href = h.url; return; }
    if (action === 'video') { if (!L.AD_SPORTS.includes(item.category)) { toast('Video ads are made for NFL, College Football and MLB.'); return; } const h = videoOf(item); handOff(h); location.href = h.url; return; }
    if (action === 'shortlist') { toggleSave(id); rove(id)?.focus(); return; }
    if (action === 'copy') { const t = L.kitFor(item, aiFor(item)).headlines[0]; if (t) copyText(t, null); else toast('No headline idea for this one yet. Open the post kit for AI angles.'); return; }
    if (action === 'open') window.open(safeUrl(item.url), '_blank', 'noopener');
  });
  els.body.addEventListener('focusin', event => { const rowEl = event.target.closest('.trend-row[data-id]'); if (rowEl && rowEl.dataset.id !== current) rove(rowEl.dataset.id); });

  // ── Events ─────────────────────────────────────────────────────────────
  els.filters.addEventListener('click', event => {
    const chip = event.target.closest('[data-sport]');
    if (chip) setActive(chip.dataset.sport);
  });
  els.brand.addEventListener('change', () => { prefs.brand = els.brand.value; savePrefs(); entered = false; render(); announce(prefs.brand ? `Showing stories for ${els.brand.selectedOptions[0].text}.` : 'Showing all of ES.'); });
  els.density.addEventListener('click', event => {
    const b = event.target.closest('[data-density]');
    if (!b) return;
    prefs.density = b.dataset.density;
    savePrefs();
    renderDensity();
  });
  els.density.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    prefs.density = prefs.density === 'list' ? 'cards' : 'list';
    savePrefs();
    renderDensity();
    els.density.querySelector(`[data-density="${prefs.density}"]`)?.focus();
  });
  els.empty.addEventListener('click', event => {
    if (event.target.closest('[data-refresh]')) { load(true); return; }
    if (event.target.closest('[data-brand-all]')) { prefs.brand = ''; savePrefs(); renderBrands(); render(); return; }
    const to = event.target.closest('[data-filter]');
    if (to) setActive(to.dataset.filter, true);
  });
  els.body.addEventListener('click', event => {
    if (event.target.closest('[data-refresh]')) { failed = false; render(); load(true); return; }
    if (event.target.closest('[data-copy-list]')) { copyText(L.shortlistText(saved.map(s => findItem(s.id) || s)), event.target.closest('button'), 'Shortlist'); return; }
    if (event.target.closest('[data-clear-list]')) {
      const before = saved;
      saved = [];
      store.set(KEY.saved, saved);
      render();
      toast('Shortlist cleared', { label: 'Undo', run: () => { saved = before; store.set(KEY.saved, saved); render(); } });
      return;
    }
    const rowEl = event.target.closest('.trend-row[data-id]');
    const id = rowEl?.dataset.id;
    const plainClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    // Design post / a headline idea: design it here, in the Generate view.
    // Ctrl/⌘/Shift/middle clicks keep the link (Generate in a new tab).
    const design = event.target.closest('a[data-design]');
    if (design) {
      if (!plainClick) return;
      const brief = new URL(design.href, location.href).searchParams.get('brief');
      if (!brief) return;
      event.preventDefault();
      designHere(brief, design.dataset.for || id);
      return;
    }
    const tpl = event.target.closest('[data-design-template]');
    if (tpl) { const item = findItem(id); if (item) designHere(briefFor(item), id, tpl.dataset.designTemplate); return; }
    if (event.target.closest('a[data-video]')) { const item = findItem(id); if (item) handOff(videoOf(item)); return; }
    if (event.target.closest('a[data-reel]')) { const item = findItem(id); if (item) handOff(reelOf(item)); return; }
    const copyKit = event.target.closest('[data-copy-kit]');
    if (copyKit) { const item = findItem(id); if (item) copyText(L.kitText(item, L.kitFor(item, aiFor(item), { brands: brands() }), { sportLabel: labelOf(item.category) }), copyKit, 'Post kit'); return; }
    const copy = event.target.closest('[data-copy]');
    if (copy) { copyText(copy.dataset.copy, copy, copy.closest('.td-kit') && !copy.closest('.td-kit__heads') ? 'Text' : 'Headline'); return; }
    const save = event.target.closest('[data-save]');
    if (save) { toggleSave(id, save); return; }
    if (event.target.closest('[data-kit]')) { toggleKit(id); return; }
    if (event.target.closest('[data-ai]')) { aiState.delete(id); wantAi([id], 0); return; }
    const more = event.target.closest('.trends-group__more');
    if (more) setActive(more.dataset.sport, true);
  });
  // Middle-click / new-tab on "Video ad" or "Reel" still hands the moment over.
  els.body.addEventListener('auxclick', event => {
    const link = event.target.closest('a[data-video], a[data-reel]');
    const item = link && findItem(link.closest('.trend-row')?.dataset.id);
    if (item) handOff(link.matches('[data-reel]') ? reelOf(item) : videoOf(item));
  });
  els.refresh.addEventListener('click', () => load(true));

  // Live while the view is open; catches up when it is opened again.
  setInterval(() => { if (!document.hidden && isOpen()) load(false); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && isOpen() && Date.now() - loadedAt > REFRESH_MS) load(false); });
  setInterval(() => { if (isOpen()) setLive(); }, 30000);

  // First paint: the last feed this browser saw, with its real age.
  renderBrands();
  renderDensity();
  const last = store.get(KEY.feed, null);
  if (last?.ok && Array.isArray(last.items) && Date.now() - ms(last.updatedAt) < FEED_MAX_AGE_MS) { adopt(last); setLive(); }
  render();
  window.AIStudioTrends = Object.freeze({
    // Called by the page when the Trends view opens.
    activate() {
      if (!loadedAt || Date.now() - loadedAt > REFRESH_MS) load(false);
      else setLive();
    },
    sport: () => (active === 'saved' ? 'all' : active),
    // Back/forward between sports.
    setSport(sport) {
      const next = sport || 'all';
      if (next === active) return;
      active = next;
      entered = false;
      if (data) render();
    },
  });
})();
