// Reels Studio (reel-maker.html): trend or brief -> script of beats -> ES
// photos, logos and stat cards -> voiceover (or captions only) -> music ->
// JSON timeline -> live preview -> lint -> MP4 in the browser.
// project-docs/ai-reels-research.md (MVP). The renderer, timeline and lint are
// pure modules shared with the server and the tests:
//   reel-formats.js (formats, router, pacing, costs), reel-render.js
//   (timeline + drawing), reel-lint.js (quality checks).
// Server: /api/reel-maker (netlify/functions/reel-maker.js).
// Export: WebCodecs + Mediabunny (frame-exact, faster than real time), else
// the Video Ads path (canvas.captureStream + MediaRecorder, real time).
(() => {
  'use strict';

  const F = window.ReelFormats;
  const R = window.ReelRender;
  const L = window.ReelLint;
  const TEAMS = window.VideoAdsTeams;
  const LOGOS = window.LeagueLogos;
  if (!F || !R || !L) return;

  const $ = id => document.getElementById(id);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  // Lucide icons (ISC licence).
  const ICON = {
    sparkles: svg('<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>'),
    explainer: svg('<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>'),
    stat: svg('<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>'),
    top5: svg('<path d="M10 12h11"/><path d="M10 18h11"/><path d="M10 6h11"/><path d="M4 10h2"/><path d="M4 6h1v4"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>'),
    quote: svg('<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>'),
    up: svg('<path d="m18 15-6-6-6 6"/>'),
    down: svg('<path d="m6 9 6 6 6-6"/>'),
    trash: svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
    plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
    image: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
    alert: svg('<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>'),
    warn: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    link: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
    refresh: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
  };
  const KIND_NAME = { hook: 'Hook', context: 'Context', point: 'Point', stat: 'Stat', rank: 'Rank', quote: 'Quote', payoff: 'Why it matters', cta: 'End card' };
  const SPORT_LABEL = { nfl: 'NFL', cfb: 'College FB', mlb: 'MLB', golf: 'Golf' };
  const LOCAL_KEY = 'frameup.reels.projects.v1';
  const HANDOFF_KEY = 'frameup.reelMoment.v1';
  const MEDIABUNNY = 'https://cdn.jsdelivr.net/npm/mediabunny@1.62.1/+esm';

  const els = {
    steps: $('rm-steps'), canvas: $('rm-canvas'), emptyStage: $('rm-empty-stage'), safe: $('rm-safe'),
    play: $('rm-play'), scrub: $('rm-scrub'), time: $('rm-time'), mute: $('rm-mute'), safeToggle: $('rm-safe-toggle'), stageMeta: $('rm-stage-meta'),
    panes: { topic: $('rm-pane-topic'), edit: $('rm-pane-edit'), export: $('rm-pane-export') },
    source: $('rm-source'), sourceTrend: $('rm-source-trend'), sourceBrief: $('rm-source-brief'), leagues: $('rm-leagues'), trends: $('rm-trends'), trendsNote: $('rm-trends-note'), picked: $('rm-picked'),
    brief: $('rm-brief'), formats: $('rm-formats'), sport: $('rm-sport'), tier: $('rm-tier'), factcheck: $('rm-factcheck'), factcheckRow: $('rm-factcheck-row'),
    cost: $('rm-cost'), write: $('rm-write'), writeText: $('rm-write-text'), writeStatus: $('rm-write-status'), recent: $('rm-recent'), recentList: $('rm-recent-list'),
    notice: $('rm-notice'), summary: $('rm-summary'), askForm: $('rm-ask'), askInput: $('rm-ask-input'), beats: $('rm-beats'), beatsMeta: $('rm-beats-meta'),
    voiceBadge: $('rm-voice-badge'), voiceNote: $('rm-voice-note'), voiceBtn: $('rm-voice-btn'), voiceProgress: $('rm-voice-progress'), capstyle: $('rm-capstyle'),
    musicPick: $('rm-music-pick'), musicFile: $('rm-music-file'), musicName: $('rm-music-name'), licence: $('rm-licence'), licenceNote: $('rm-licence-note'), licencePaid: $('rm-licence-paid'),
    sourcesList: $('rm-sources-list'), extraSource: $('rm-extra-source'), issues: $('rm-issues'), lintBadge: $('rm-lint-badge'),
    target: $('rm-target'), rights: $('rm-rights-table'), gate: $('rm-gate'), spend: $('rm-spend'), exportBtn: $('rm-export'), exportText: $('rm-export-text'), exportProgress: $('rm-export-progress'), exportStatus: $('rm-export-status'), files: $('rm-files'),
    back: $('rm-back'), next: $('rm-next'), nextText: $('rm-next-text'),
    photos: $('rm-photos'), photosForm: $('rm-photos-search'), photosQ: $('rm-photos-q'), photosGrid: $('rm-photos-grid'), photosNone: $('rm-photos-none'),
    toasts: $('rm-toasts'),
  };
  const ctx = els.canvas.getContext('2d');

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));
  const state = {
    step: 'topic', source: 'trend', league: 'all', trends: [], trendsState: 'loading', trend: null,
    format: 'auto', sport: '', tier: 'standard', factCheck: false,
    config: { ai: true, voice: { mode: 'off', ready: false, label: 'Captions only', reason: '' }, offline: false },
    projectId: uuid(), status: 'draft',
    plan: null, planSource: '', notice: '', corpus: '', sources: [], extraSource: '',
    photos: {}, assets: {}, images: {}, voice: {}, buffers: {},
    music: null, musicLibrary: [], captionStyle: 'highlight', target: 'organic',
    spent: { director: 0, factCheck: 0, revise: 0, voice: 0 },
    timeline: null, lint: null, t: 0, playing: false, busy: '',
    cloud: true,
  };

  // ─── Small helpers ───────────────────────────────────────────────────────
  function toast(text, { tone = '', action = null } = {}) {
    const el = document.createElement('div');
    el.className = `es-toast rm-toast${tone === 'error' ? ' is-error' : ''}`;
    el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span>${esc(text)}</span>${action ? `<button class="es-toast-action" type="button">${esc(action.label)}</button>` : ''}`;
    if (action) el.querySelector('button').addEventListener('click', () => { action.run(); el.remove(); });
    els.toasts.append(el);
    setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 260); }, action ? 5000 : 3200);
  }
  const fmtTime = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const debounce = (fn, ms) => { let t = 0; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };
  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } },
  };
  const totalSpent = () => Object.values(state.spent).reduce((a, b) => a + (Number(b) || 0), 0);

  function friendlyError(status, data) {
    if (data?.reason === 'weekly-limit') return data.error || 'You have reached this week’s AI limit. It resets Monday.';
    if (status === 429 || data?.reason === 'limit') return 'You’ve hit this hour’s AI limit. Try again in a little while.';
    if (data?.reason === 'budget') return 'The team’s AI budget is used up for now. Try again later.';
    if (status === 401) return 'Your sign-in expired. Refresh the page and try again.';
    return data?.error || `Something went wrong (${status}). Try again.`;
  }
  async function api(body) {
    if (!window.ESAuth?.fetchWithAuth) throw Object.assign(new Error('Sign-in is still loading. Try again in a moment.'), { offline: true });
    let response;
    try {
      response = await window.ESAuth.fetchWithAuth('/api/reel-maker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (error) {
      throw Object.assign(new Error('Reels Studio’s server is not reachable.'), { offline: true });
    }
    const data = await response.json().catch(() => null);
    if (response.status === 404 && !data) throw Object.assign(new Error('Reels Studio’s server is not reachable.'), { offline: true, status: 404 });
    if (!response.ok || data?.ok === false) throw Object.assign(new Error(friendlyError(response.status, data)), { status: response.status, reason: data?.reason, data });
    return data;
  }
  function logEvent(type, payload = {}) {
    if (state.config.offline || !state.cloud) return;
    api({ mode: 'event', type, projectId: state.projectId, format: state.plan?.format, payload }).catch(() => {});
  }

  // Text measuring with the real fonts, cached (layouts run every frame).
  const measureCtx = document.createElement('canvas').getContext('2d');
  const measureCache = new Map();
  function measure(text, fontStr) {
    const key = `${fontStr}|${text}`;
    let w = measureCache.get(key);
    if (w === undefined) {
      measureCtx.font = fontStr;
      w = measureCtx.measureText(text).width;
      if (measureCache.size > 6000) measureCache.clear();
      measureCache.set(key, w);
    }
    return w;
  }
  // A small noise tile for film grain on the animated backgrounds.
  const grain = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    return c;
  })();
  let layoutCache = new Map();
  let captionCache = new Map();
  const env = {
    measure,
    images: state.images,
    grain,
    layoutCache: g => { const key = `${g.id}|${g.inMs}`; let v = layoutCache.get(key); if (!v) { v = R.layoutGraphic(measure, g, state.timeline); layoutCache.set(key, v); } return v; },
    captionCache: card => { const key = `${card.s}`; let v = captionCache.get(key); if (!v) { v = R.layoutCaption(measure, card, state.timeline); captionCache.set(key, v); } return v; },
  };

  function loadImage(src, cors = false) {
    return new Promise(resolve => {
      const img = new Image();
      if (cors) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  loadImage('assets/brand-logos/essentiallysports-mark.svg').then(img => { if (img) { state.images['logo:es'] = img; draw(); } });
  // Text is measured with the real artwork fonts: when a font finishes
  // loading, cached widths and layouts are thrown away and the frame redrawn.
  const fontsChanged = () => { measureCache.clear(); layoutCache = new Map(); captionCache = new Map(); if (state.timeline) rebuild(); };
  document.fonts?.addEventListener?.('loadingdone', fontsChanged);
  Promise.all([`700 120px "Acumin Pro Condensed Local"`, '700 50px Roboto', '600 48px Roboto', '500 44px Roboto'].map(f => document.fonts.load(f).catch(() => {}))).then(fontsChanged);

  // ─── Voice cache (IndexedDB): re-renders and reopened reels never re-bill ─
  const VoiceCache = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('frameup-reels', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('vo');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
    return {
      async get(key) { try { const db = await open(); return await new Promise(res => { const q = db.transaction('vo').objectStore('vo').get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch { return null; } },
      async set(key, value) { try { const db = await open(); db.transaction('vo', 'readwrite').objectStore('vo').put(value, key); } catch { /* best effort */ } },
    };
  })();

  // ─── Steps ───────────────────────────────────────────────────────────────
  function goStep(step, { focus = true } = {}) {
    if (step !== 'topic' && !state.plan) return;
    state.step = step;
    Object.entries(els.panes).forEach(([id, pane]) => { pane.hidden = id !== step; });
    els.steps.querySelectorAll('.rm-step').forEach(btn => {
      const id = btn.dataset.step;
      const order = ['topic', 'edit', 'export'];
      btn.toggleAttribute('aria-current', id === step);
      if (id === step) btn.setAttribute('aria-current', 'step');
      btn.disabled = id !== 'topic' && !state.plan;
      btn.classList.toggle('is-done', order.indexOf(id) < order.indexOf(step) && Boolean(state.plan));
    });
    els.back.hidden = step === 'topic';
    els.next.hidden = step !== 'edit' && !(step === 'topic' && state.plan);
    els.nextText.textContent = step === 'topic' ? 'Back to editing' : 'Next: Export';
    els.next.classList.toggle('es-btn--primary', step === 'edit');
    if (step === 'export') renderExport();
    if (focus) els.panes[step].querySelector('h3, button, input, textarea')?.focus({ preventScroll: true });
    document.querySelector('.rm-panel')?.scrollTo?.({ top: 0 });
  }
  els.steps.addEventListener('click', event => { const btn = event.target.closest('.rm-step'); if (btn && !btn.disabled) goStep(btn.dataset.step); });
  els.back.addEventListener('click', () => goStep(state.step === 'export' ? 'edit' : 'topic'));
  els.next.addEventListener('click', () => goStep(state.step === 'topic' ? 'edit' : 'export'));

  function radios(group, attr, value) {
    group.querySelectorAll('[role="radio"]').forEach(btn => {
      const on = btn.dataset[attr] === value;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on ? 0 : -1;
    });
  }
  // Arrow keys move between radios in a group.
  document.addEventListener('keydown', event => {
    const radio = event.target.closest?.('[role="radio"]');
    if (!radio || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const group = radio.closest('[role="radiogroup"]');
    const list = [...group.querySelectorAll('[role="radio"]:not([disabled])')];
    const i = list.indexOf(radio);
    const next = list[(i + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + list.length) % list.length];
    event.preventDefault();
    next.focus();
    next.click();
  });

  // ─── Step 1: Topic ───────────────────────────────────────────────────────
  els.source.addEventListener('click', event => {
    const btn = event.target.closest('[data-source]');
    if (!btn) return;
    state.source = btn.dataset.source;
    radios(els.source, 'source', state.source);
    els.sourceTrend.hidden = state.source !== 'trend';
    els.sourceBrief.hidden = state.source !== 'brief';
    renderFormats();
    renderCost();
  });

  function leagueTile(sport, size = 20) {
    const logo = LOGOS ? LOGOS.logoFor(sport) : null;
    if (!logo) return '';
    return `<span class="rm-league" style="--tile:${esc(logo.bg)};--size:${size}px" title="${esc(logo.label)}"><img src="${esc(logo.src)}" alt="" loading="lazy"></span>`;
  }
  function renderLeagues() {
    const list = [['all', 'All'], ['nfl', 'NFL'], ['cfb', 'CFB'], ['mlb', 'MLB'], ['golf', 'Golf']];
    els.leagues.innerHTML = list.map(([id, label]) => `<button class="es-chip" type="button" role="radio" aria-checked="${state.league === id}" tabindex="${state.league === id ? 0 : -1}" data-league="${id}">${id === 'all' ? '' : leagueTile(id, 16)}${label}</button>`).join('');
  }
  els.leagues.addEventListener('click', event => {
    const btn = event.target.closest('[data-league]');
    if (!btn) return;
    state.league = btn.dataset.league;
    renderLeagues();
    renderTrends();
  });
  const ago = iso => {
    const t = new Date(iso).getTime();
    if (!t) return '';
    const h = Math.round((Date.now() - t) / 3600e3);
    return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  };
  function renderTrends() {
    els.trends.setAttribute('aria-busy', String(state.trendsState === 'loading'));
    if (state.trendsState === 'loading') {
      els.trends.innerHTML = Array.from({ length: 4 }, () => '<li class="rm-trend is-skeleton"><span class="es-skeleton rm-sk-a"></span><span class="es-skeleton rm-sk-b"></span></li>').join('');
      return;
    }
    if (state.trendsState === 'error') {
      els.trends.innerHTML = `<li class="es-error-state rm-trends-state" role="alert"><span class="es-error-state__icon">${ICON.alert}</span><p class="es-error-state__title">Trends did not load</p><p class="es-error-state__copy">Write a brief instead, or try again.</p><button class="es-btn es-btn--sm" type="button" id="rm-trends-retry">Try again</button></li>`;
      $('rm-trends-retry')?.addEventListener('click', loadTrends);
      return;
    }
    const items = state.trends.filter(item => state.league === 'all' || item.sport === state.league).slice(0, 12);
    if (!items.length) {
      els.trends.innerHTML = '<li class="es-empty rm-trends-state"><p class="es-empty__title">No fresh stories here</p><p class="es-empty__copy">Try another league, or write a brief.</p></li>';
      return;
    }
    els.trends.innerHTML = items.map(item => {
      const on = state.trend?.id === item.id;
      const fmt = F.FORMATS[item.format];
      return `<li><button class="rm-trend" type="button" role="radio" aria-checked="${on}" data-trend="${esc(item.id)}">
        ${leagueTile(item.sport, 28)}
        <span class="rm-trend__body"><span class="rm-trend__title">${esc(item.title)}</span>
        <span class="rm-trend__meta">${esc(SPORT_LABEL[item.sport] || '')}${item.publishedAt ? ` · ${esc(ago(item.publishedAt))}` : ''}${fmt ? ` · <span class="rm-trend__fmt">${esc(fmt.short)}</span>` : ''}</span></span>
      </button></li>`;
    }).join('');
  }
  els.trends.setAttribute('role', 'radiogroup');
  els.trends.addEventListener('click', event => {
    const btn = event.target.closest('[data-trend]');
    if (!btn) return;
    const item = state.trends.find(t => t.id === btn.dataset.trend);
    if (!item) return;
    state.trend = state.trend?.id === item.id ? null : item;
    if (state.trend && !state.sport) els.sport.value = '';
    renderTrends();
    renderPicked();
    renderFormats();
  });
  function renderPicked() {
    const t = state.trend;
    els.picked.hidden = !t || state.source !== 'trend';
    if (!t) { els.picked.innerHTML = ''; return; }
    els.picked.innerHTML = `${leagueTile(t.sport, 20)}<span><b>Reel about:</b> ${esc(t.title)}</span><button class="rm-icon-btn rm-icon-btn--sm" type="button" id="rm-unpick" aria-label="Clear the trend">${ICON.x}</button>`;
    $('rm-unpick').addEventListener('click', () => { state.trend = null; renderTrends(); renderPicked(); renderFormats(); });
  }
  async function loadTrends() {
    state.trendsState = 'loading';
    renderTrends();
    try {
      const data = await api({ mode: 'trends' });
      state.trends = data.items || [];
      state.trendsState = 'ready';
    } catch (error) {
      // Static previews have no API: the public trends endpoint is tried too.
      try {
        const response = await fetch('/api/trend-design');
        const data = await response.json();
        state.trends = (data.items || []).filter(i => ['nfl', 'cfb', 'mlb', 'golf'].includes(i.category)).map(i => ({ id: i.id, sport: i.category, title: i.title, url: i.url, publishedAt: i.publishedAt, team: i.team?.name || '', format: F.routeFormat(i.title).format, related: (i.related || []).slice(0, 4) }));
        state.trendsState = 'ready';
      } catch {
        state.trendsState = 'error';
      }
    }
    renderTrends();
  }

  const topicText = () => (state.source === 'trend' ? [state.trend?.title, ...(state.trend?.related || []).map(r => r.title)].filter(Boolean).join(' ') : els.brief.value);
  function renderFormats() {
    const suggestion = F.routeFormat(topicText()).format;
    const list = [{ id: 'auto', label: 'Auto', blurb: 'FrameUp picks the format that fits the story.' }, ...F.FORMAT_IDS.map(id => F.FORMATS[id])];
    els.formats.innerHTML = list.map(fmt => {
      const on = state.format === fmt.id;
      const suggested = fmt.id === suggestion && topicText().trim().length > 8;
      return `<button class="rm-format" type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-format="${fmt.id}">
        <span class="rm-format__icon">${ICON[fmt.id === 'auto' ? 'sparkles' : fmt.id]}</span>
        <span class="rm-format__name">${esc(fmt.label)}${suggested ? '<span class="rm-format__dot" title="Fits this story"><span class="es-sr-only">, fits this story</span></span>' : ''}</span>
        <span class="rm-format__blurb">${esc(fmt.blurb)}</span>
      </button>`;
    }).join('');
  }
  els.formats.addEventListener('click', event => {
    const btn = event.target.closest('[data-format]');
    if (!btn) return;
    state.format = btn.dataset.format;
    renderFormats();
  });
  els.brief.addEventListener('input', debounce(() => { renderFormats(); renderCost(); }, 250));
  els.sport.addEventListener('change', () => { state.sport = els.sport.value; });
  els.tier.addEventListener('click', event => {
    const btn = event.target.closest('[data-tier]');
    if (!btn) return;
    state.tier = btn.dataset.tier;
    radios(els.tier, 'tier', state.tier);
    renderCost();
  });
  els.factcheck.addEventListener('change', () => { state.factCheck = els.factcheck.checked; renderCost(); });

  function voChars() {
    if (state.plan) return state.plan.beats.reduce((n, b) => n + (b.vo || '').length, 0);
    return 450;
  }
  function renderCost() {
    const est = F.estimateCost({ tier: state.tier, factCheck: state.factCheck, voiceMode: state.config.voice.ready ? state.config.voice.mode : 'off', voChars: voChars() });
    const ai = state.config.ai && !state.config.offline;
    els.cost.innerHTML = `<details class="rm-cost__fold"><summary><span>Estimated cost for this reel</span><b>${ai ? `≈ ${F.money(est.total)}` : 'Free draft'}</b></summary>
      <ul>${est.lines.map(line => `<li><span>${esc(line.label)}</span><span>${F.money(line.usd)}</span></li>`).join('')}</ul>
      <p>Counts toward your weekly AI limit. ${ai ? '' : 'AI is off here, so you get a draft built from your words.'}</p></details>`;
  }

  // ─── Write the reel ──────────────────────────────────────────────────────
  function setBusy(button, textEl, busy, label) {
    button.disabled = busy;
    button.classList.toggle('is-busy', busy);
    button.setAttribute('aria-busy', String(busy));
    if (label) textEl.textContent = label;
  }
  async function writeReel() {
    const brief = state.source === 'brief' ? els.brief.value.trim() : '';
    const trend = state.source === 'trend' ? state.trend : null;
    if (!brief && !trend) {
      els.writeStatus.textContent = state.source === 'trend' ? 'Pick a trend first.' : 'Write a brief first.';
      (state.source === 'brief' ? els.brief : els.trends.querySelector('button'))?.focus();
      return;
    }
    if (state.source === 'brief' && brief.length < 20) { els.writeStatus.textContent = 'Add a little more: who, what happened, and the numbers.'; els.brief.focus(); return; }
    setBusy(els.write, els.writeText, true, state.factCheck ? 'Checking facts and writing…' : 'Writing the reel…');
    els.writeStatus.textContent = '';
    const body = { mode: 'plan', brief, trend, format: state.format, sport: state.sport, tier: state.tier, factCheck: state.factCheck };
    try {
      const data = await api(body);
      state.spent.director += Number(data.costs?.director) || 0;
      state.spent.factCheck += Number(data.costs?.factCheck) || 0;
      applyPlan(data, { brief, trend });
      logEvent('plan', { source: data.source, format: data.plan.format, escalated: data.escalated, cost: data.cost, issues: (data.issues || []).length, beats: data.plan.beats.length });
    } catch (error) {
      if (error.offline) {
        // No server (static preview): a draft from the words on the page.
        const corpus = [brief, trend?.title, ...(trend?.related || []).map(r => r.title)].filter(Boolean).join('\n');
        const plan = F.fallbackPlan({ brief: corpus, title: trend?.title || '', format: state.format, sport: state.sport || trend?.sport || '' });
        applyPlan({ plan, source: 'draft', notice: 'The AI server is not reachable here, so this is a draft built from your words.', corpus, sources: trend ? [{ type: 'trend', title: trend.title, url: trend.url }] : [{ type: 'brief', title: 'Your brief' }] }, { brief, trend });
      } else {
        els.writeStatus.textContent = error.message;
        toast(error.message, { tone: 'error' });
      }
    } finally {
      setBusy(els.write, els.writeText, false, 'Write the reel');
    }
  }
  els.write.addEventListener('click', writeReel);

  function teamFor(plan) {
    const t = plan.team;
    if (t && t.name) return { name: t.name, colors: t.colors || [], logo: t.logo || '' };
    return null;
  }
  function applyPlan(data, { brief = '', trend = null } = {}) {
    stop();
    const plan = data.plan;
    plan.beats.forEach((beat, i) => { beat.id = beat.id || `b${i + 1}-${Math.random().toString(36).slice(2, 6)}`; });
    plan.team = teamFor(plan);
    state.plan = plan;
    state.planSource = data.source || '';
    state.notice = data.notice || (data.source === 'draft' ? 'This is a draft built from your words. Edit the beats, or write again when AI is available.' : '');
    state.corpus = data.corpus || [brief, trend?.title].filter(Boolean).join('\n');
    state.sources = data.sources || [];
    state.brief = brief;
    state.trendRef = trend ? { id: trend.id, title: trend.title, sport: trend.sport, url: trend.url } : null;
    state.photos = {};
    state.voice = {};
    state.status = 'draft';
    state.t = 0;
    loadTeamLogo();
    rebuild();
    renderEdit();
    goStep('edit', { focus: false });
    pickPhotos();
    if (data.issues?.length) els.writeStatus.textContent = '';
  }
  async function loadTeamLogo() {
    delete state.images['logo:team'];
    const logo = state.plan?.team?.logo;
    if (!logo) return;
    const img = await loadImage(logo, true);
    if (img && state.plan?.team?.logo === logo) { state.images['logo:team'] = img; draw(); }
  }

  // ─── Photos (ES image pool, like the editor's ES Image Pool search) ──────
  const photoCache = new Map();
  async function searchPhotos(query) {
    const q = String(query || '').trim().slice(0, 120);
    if (!q) return [];
    if (photoCache.has(q)) return photoCache.get(q);
    let results = [];
    let source = '';
    try {
      if (!window.ESAuth?.fetchWithAuth) throw new Error('no auth');
      const response = await window.ESAuth.fetchWithAuth(`/api/es-image-search?query=${encodeURIComponent(q)}&per_page=18`);
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      results = Array.isArray(data.results) ? data.results : [];
      source = data.source || '';
    } catch {
      results = [];
    }
    const list = results.filter(r => r.proxyUrl || r.sourceUrl).map(r => ({
      id: `img:${r.id || r.sourceUrl}`, src: r.proxyUrl || r.sourceUrl, title: r.title || q, credit: r.credit || '', width: r.width, height: r.height, source,
    }));
    photoCache.set(q, list);
    return list;
  }
  function photoAsset(photo) {
    return {
      kind: 'photo', label: photo.title || 'ES photo', src: photo.src,
      rights: {
        source: photo.source === 'mcp-agency' ? 'ES image pool (agency photo)' : 'ES image pool',
        licence: 'Editorial licence via ES. Fine for organic posts; confirm social-video and paid scope before paid use.',
        credit: photo.credit || '', organic: true, paid: false,
      },
    };
  }
  async function usePhoto(beatId, photo) {
    if (!photo) { delete state.photos[beatId]; rebuild(); renderBeats(); return; }
    state.assets[photo.id] = photoAsset(photo);
    state.photos[beatId] = [photo.id];
    rebuild();
    renderBeats();
    if (!state.images[photo.id]) {
      const img = await loadImage(photo.src, !photo.src.startsWith('/'));
      if (img) { state.images[photo.id] = img; layoutCache = new Map(); draw(); renderBeats(); } else {
        delete state.photos[beatId];
        rebuild();
        renderBeats();
      }
    }
  }
  async function pickPhotos() {
    const plan = state.plan;
    if (!plan) return;
    const used = new Set();
    const fallbackQuery = plan.team?.name || F.trimWords(plan.title, 4);
    for (const beat of plan.beats) {
      if (state.plan !== plan) return;
      if (beat.kind === 'cta') continue;
      const list = await searchPhotos(beat.photo || fallbackQuery);
      const pick = list.find(p => !used.has(p.id) && (!p.width || p.width >= 600)) || list.find(p => !used.has(p.id));
      if (!pick) continue;
      used.add(pick.id);
      // A long beat gets a second photo for the second shot.
      const second = list.find(p => !used.has(p.id) && p.id !== pick.id);
      await usePhoto(beat.id, pick);
      const beatTl = state.timeline?.beats.find(b => b.id === beat.id);
      if (second && beatTl && beatTl.outMs - beatTl.inMs > F.PACE.shotMaxMs) {
        used.add(second.id);
        state.assets[second.id] = photoAsset(second);
        const img = await loadImage(second.src, !second.src.startsWith('/'));
        if (img) { state.images[second.id] = img; state.photos[beat.id] = [pick.id, second.id]; rebuild(); }
      }
    }
    renderBeats();
  }

  let photoTarget = null;
  async function openPhotos(beatId) {
    photoTarget = beatId;
    const beat = state.plan.beats.find(b => b.id === beatId);
    els.photosQ.value = beat?.photo || state.plan.team?.name || '';
    els.photos.showModal();
    els.photosQ.focus();
    runPhotoSearch();
  }
  async function runPhotoSearch() {
    els.photosGrid.innerHTML = Array.from({ length: 6 }, () => '<li><span class="es-skeleton rm-photo-sk"></span></li>').join('');
    const list = await searchPhotos(els.photosQ.value);
    if (!list.length) {
      els.photosGrid.innerHTML = '<li class="es-empty rm-photos__empty"><p class="es-empty__title">No photos found</p><p class="es-empty__copy">Try a full name or a team name.</p></li>';
      return;
    }
    els.photosGrid.innerHTML = list.map((p, i) => `<li><button class="rm-photo" type="button" data-photo-i="${i}" aria-label="${esc(p.title)}"><img src="${esc(p.src)}" alt="" loading="lazy"></button></li>`).join('');
    els.photosGrid.dataset.query = els.photosQ.value;
  }
  els.photosForm.addEventListener('submit', event => { event.preventDefault(); runPhotoSearch(); });
  els.photosGrid.addEventListener('click', event => {
    const btn = event.target.closest('[data-photo-i]');
    if (!btn) return;
    const list = photoCache.get(els.photosGrid.dataset.query) || [];
    const photo = list[Number(btn.dataset.photoI)];
    const beat = state.plan.beats.find(b => b.id === photoTarget);
    if (beat) beat.photo = els.photosQ.value.trim().slice(0, 60);
    els.photos.close();
    usePhoto(photoTarget, photo);
    logEvent('edit', { what: 'photo' });
  });
  els.photosNone.addEventListener('click', () => { els.photos.close(); usePhoto(photoTarget, null); });

  // ─── Timeline + lint ─────────────────────────────────────────────────────
  function voiceFor() {
    // Only clips whose text still matches the beat's VO line are used.
    const out = {};
    (state.plan?.beats || []).forEach(beat => {
      const v = state.voice[beat.id];
      if (v && v.text === beat.vo) out[beat.id] = v;
    });
    return out;
  }
  function rebuild() {
    if (!state.plan) return;
    const voice = voiceFor();
    const voiceMode = Object.keys(voice).length ? state.config.voice.mode : 'off';
    state.timeline = R.buildTimeline(state.plan, {
      voice, photos: state.photos, assets: { ...state.assets }, team: state.plan.team, captionStyle: state.captionStyle,
      voiceMode, music: state.music ? { asset: 'music' } : null, sources: state.sources, corpus: state.corpus,
    });
    layoutCache = new Map();
    captionCache = new Map();
    state.lint = L.lintTimeline(state.timeline, { boxes: R.textBoxes(measure, state.timeline), target: state.target, extraSources: els.extraSource.value });
    state.mix = null;
    els.emptyStage.hidden = true;
    els.play.disabled = false;
    els.scrub.disabled = false;
    state.t = Math.min(state.t, state.timeline.durationMs - 1);
    renderLint();
    renderMeta();
    renderCost();
    if (state.step === 'export') renderExport();
    draw();
    autosave();
  }
  const rebuildSoon = debounce(rebuild, 220);

  function renderMeta() {
    const tl = state.timeline;
    if (!tl) return;
    const sec = tl.durationMs / 1000;
    els.beatsMeta.textContent = `${tl.beats.length} beats · ${sec.toFixed(0)} s`;
    els.stageMeta.textContent = `${F.FORMATS[tl.format].label} · ${sec.toFixed(1)} s · 1080×1920`;
    els.time.textContent = `${fmtTime(state.t)} / ${fmtTime(tl.durationMs)}`;
    // Beat times in the list.
    els.beats.querySelectorAll('[data-beat]').forEach(li => {
      const b = tl.beats.find(x => x.id === li.dataset.beat);
      const time = li.querySelector('.rm-beat__time');
      if (b && time) time.textContent = `${fmtTime(b.inMs)}–${fmtTime(b.outMs)}`;
    });
  }

  function renderLint() {
    const lint = state.lint;
    if (!lint) return;
    const sevIcon = { critical: ICON.alert, warning: ICON.warn, info: ICON.info };
    const order = { critical: 0, warning: 1, info: 2 };
    const list = [...lint.issues].sort((a, b) => order[a.severity] - order[b.severity]);
    els.lintBadge.className = `es-badge ${lint.critical ? 'es-badge--bad' : (lint.warnings ? 'es-badge--warn' : 'es-badge--good')}`;
    els.lintBadge.textContent = lint.critical ? `${lint.critical} to fix` : (lint.warnings ? `${lint.warnings} to review` : 'All clear');
    els.issues.innerHTML = list.length ? list.map(issue => {
      const n = state.plan.beats.findIndex(b => b.id === issue.beat);
      return `<li class="rm-issue is-${issue.severity}">${sevIcon[issue.severity]}<div><p>${esc(issue.message)}</p>${issue.fix ? `<span>${esc(issue.fix)}</span>` : ''}</div>${n >= 0 ? `<button class="es-btn es-btn--tertiary es-btn--sm" type="button" data-goto="${esc(issue.beat)}">Beat ${n + 1}</button>` : ''}</li>`;
    }).join('') : `<li class="rm-issue is-good">${ICON.check}<div><p>Hook, safe zones, captions, sources and rights all check out.</p></div></li>`;
    // Flags on beat cards.
    els.beats.querySelectorAll('[data-beat]').forEach(li => {
      const own = lint.issues.filter(i => i.beat === li.dataset.beat && i.severity !== 'info');
      li.classList.toggle('has-critical', own.some(i => i.severity === 'critical'));
      const flag = li.querySelector('.rm-beat__flag');
      if (flag) flag.textContent = own.length ? own[0].message : '';
    });
  }
  els.issues.addEventListener('click', event => {
    const btn = event.target.closest('[data-goto]');
    if (!btn) return;
    const li = els.beats.querySelector(`[data-beat="${CSS.escape(btn.dataset.goto)}"]`);
    seekBeat(btn.dataset.goto);
    li?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    li?.querySelector('input, textarea')?.focus({ preventScroll: true });
  });

  // ─── Step 2: Edit ────────────────────────────────────────────────────────
  function renderEdit() {
    const plan = state.plan;
    const fmt = F.FORMATS[plan.format];
    els.notice.hidden = !state.notice;
    els.notice.innerHTML = state.notice ? `${ICON.info}<p>${esc(state.notice)}</p>` : '';
    const teamChip = plan.team ? `<span class="rm-teamchip">${plan.team.logo ? `<span class="es-team-logo" style="--logo:20px"><img src="${esc(plan.team.logo)}" alt="" onerror="this.parentNode.classList.add('es-team-logo--dot')"></span>` : ''}${esc(plan.team.name)}</span>` : '';
    els.summary.innerHTML = `<p class="rm-summary__eyebrow">${esc(fmt.label)}${plan.sport ? ` · ${esc(SPORT_LABEL[plan.sport] || plan.sport)}` : ''}${state.planSource === 'director-sonnet' ? ' · <span class="ais-badge" title="Sonnet improved a weak first draft">Sonnet</span>' : ''}</p>
      <p class="rm-summary__title">${esc(plan.title || 'Untitled reel')}</p>
      ${plan.angle ? `<p class="rm-summary__angle">${esc(plan.angle)}</p>` : ''}${teamChip}
      ${plan.hooks?.length ? `<div class="rm-hooks"><span>Other hooks</span>${plan.hooks.map((h, i) => `<button class="es-chip" type="button" data-hook="${i}">${esc(h)}</button>`).join('')}</div>` : ''}`;
    renderBeats();
    renderVoice();
    renderSources();
    $('rm-revise').hidden = !state.config.ai || state.config.offline;
  }
  els.summary.addEventListener('click', event => {
    const btn = event.target.closest('[data-hook]');
    if (!btn) return;
    const hook = state.plan.beats[0];
    const alt = state.plan.hooks[Number(btn.dataset.hook)];
    state.plan.hooks[Number(btn.dataset.hook)] = hook.text;
    hook.text = alt;
    rebuild();
    renderEdit();
    logEvent('edit', { what: 'hook-swap' });
  });

  const count = (text, max) => { const n = F.wordCount(text); return `<span class="rm-count${n > max ? ' is-over' : ''}">${n}/${max}</span>`; };
  function beatFields(beat, i) {
    const id = beat.id;
    const f = (field, label, value, { max = 0, area = false, maxlength = 120, placeholder = '' } = {}) => `
      <div class="rm-bf"><div class="rm-bf__row"><label class="rm-bf__label" for="rm-${field}-${esc(id)}">${label}</label>${max ? count(value, max) : ''}</div>
      ${area ? `<textarea class="es-input rm-bf__input" id="rm-${field}-${esc(id)}" data-field="${field}" rows="2" maxlength="${maxlength}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="es-input rm-bf__input" id="rm-${field}-${esc(id)}" data-field="${field}" type="text" maxlength="${maxlength}" value="${esc(value)}" placeholder="${esc(placeholder)}">`}</div>`;
    const parts = [f('text', 'On screen', beat.text, { max: F.PACE.textMaxWords, maxlength: 90 }), f('vo', 'Voiceover', beat.vo, { max: F.PACE.voMaxWords, area: true, maxlength: 300 })];
    if (beat.kind === 'stat') parts.push(`<div class="rm-bf-pair">${f('stat.value', 'Number', beat.stat?.value || '', { maxlength: 16 })}${f('stat.label', 'Label', beat.stat?.label || '', { maxlength: 24 })}</div>`);
    if (beat.kind === 'rank') parts.push(`<div class="rm-bf-pair">${f('name', `#${beat.rank} name`, beat.name || '', { maxlength: 60 })}${f('detail', 'Detail', beat.detail || '', { maxlength: 110 })}</div>`);
    if (beat.kind === 'quote') parts.push(f('quote.text', 'Quote (exact words)', beat.quote?.text || '', { area: true, maxlength: 220 }), f('quote.by', 'Said by', beat.quote?.by || '', { maxlength: 60 }));
    if (beat.kind !== 'cta') parts.push(f('emphasis', 'Highlight word', beat.emphasis || '', { maxlength: 30, placeholder: 'One word from the line' }));
    return parts.join('');
  }
  function renderBeats() {
    if (!state.plan) return;
    const tl = state.timeline;
    const active = document.activeElement;
    const keepId = active && els.beats.contains(active) ? active.id : '';
    els.beats.innerHTML = state.plan.beats.map((beat, i) => {
      const b = tl?.beats.find(x => x.id === beat.id);
      const photoId = (state.photos[beat.id] || [])[0];
      const img = photoId && state.images[photoId];
      const voiced = state.voice[beat.id] && state.voice[beat.id].text === beat.vo;
      return `<li class="rm-beat" data-beat="${esc(beat.id)}" data-kind="${esc(beat.kind)}">
        <div class="rm-beat__head">
          <button class="rm-beat__seek" type="button" data-seek="${esc(beat.id)}" aria-label="Play from beat ${i + 1}"><span class="rm-beat__n">${i + 1}</span><span class="rm-beat__kind">${esc(KIND_NAME[beat.kind] || beat.kind)}${beat.kind === 'rank' ? ` #${beat.rank}` : ''}</span><span class="rm-beat__time">${b ? `${fmtTime(b.inMs)}–${fmtTime(b.outMs)}` : ''}</span>${voiced ? '<span class="rm-beat__vo" title="Voiceover ready">VO</span>' : ''}</button>
          <span class="rm-beat__tools">
            <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-move="-1" aria-label="Move beat ${i + 1} up" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
            <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-move="1" aria-label="Move beat ${i + 1} down" ${i === state.plan.beats.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
            <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-remove aria-label="Delete beat ${i + 1}" ${state.plan.beats.length <= 2 ? 'disabled' : ''}>${ICON.trash}</button>
          </span>
        </div>
        <div class="rm-beat__body">
          <button class="rm-thumb${img ? '' : ' is-empty'}" type="button" data-photo aria-label="${img ? 'Change' : 'Add'} the photo for beat ${i + 1}" ${beat.kind === 'cta' ? 'hidden' : ''}>${img ? `<img src="${esc(img.src)}" alt="">` : ICON.image}<span>${img ? 'Change' : 'Photo'}</span></button>
          <div class="rm-beat__fields">${beatFields(beat, i)}</div>
        </div>
        <p class="rm-beat__flag" aria-live="polite"></p>
      </li>`;
    }).join('') + `<li class="rm-beats__add"><button class="es-btn es-btn--sm es-btn--tertiary" type="button" id="rm-add-beat" ${state.plan.beats.length >= 12 ? 'disabled' : ''}>${ICON.plus}<span>Add a beat</span></button></li>`;
    renderLint();
    if (keepId) { const el = $(keepId); if (el) { el.focus(); const len = el.value.length; try { el.setSelectionRange(len, len); } catch { /* not a text field */ } } }
  }
  function setField(beat, field, value) {
    if (field.includes('.')) {
      const [a, b] = field.split('.');
      beat[a] = { ...(beat[a] || {}), [b]: value };
    } else beat[field] = value;
  }
  els.beats.addEventListener('input', event => {
    const input = event.target.closest('[data-field]');
    if (!input) return;
    const li = input.closest('[data-beat]');
    const beat = state.plan.beats.find(b => b.id === li.dataset.beat);
    if (!beat) return;
    setField(beat, input.dataset.field, input.value);
    if (beat.kind === 'rank' && input.dataset.field === 'name') beat.text = input.value;
    const counter = input.closest('.rm-bf')?.querySelector('.rm-count');
    if (counter) { const max = input.dataset.field === 'vo' ? F.PACE.voMaxWords : F.PACE.textMaxWords; const n = F.wordCount(input.value); counter.textContent = `${n}/${max}`; counter.classList.toggle('is-over', n > max); }
    rebuildSoon();
    editedSoon();
  });
  const editedSoon = debounce(() => logEvent('edit', { what: 'text' }), 4000);
  els.beats.addEventListener('click', event => {
    const li = event.target.closest('[data-beat]');
    if (event.target.closest('#rm-add-beat')) {
      const at = Math.max(1, state.plan.beats.length - 1);
      state.plan.beats.splice(at, 0, { id: `b${Date.now().toString(36)}`, kind: 'point', text: 'New point', vo: 'Say what this beat adds.', emphasis: '', photo: state.plan.team?.name || '' });
      rebuild();
      renderBeats();
      els.beats.querySelectorAll('[data-beat]')[at]?.querySelector('input')?.select();
      return;
    }
    if (!li) return;
    const i = state.plan.beats.findIndex(b => b.id === li.dataset.beat);
    if (event.target.closest('[data-seek]')) { seekBeat(li.dataset.beat); return; }
    if (event.target.closest('[data-photo]')) { openPhotos(li.dataset.beat); return; }
    const move = event.target.closest('[data-move]');
    if (move) {
      const j = i + Number(move.dataset.move);
      if (j < 0 || j >= state.plan.beats.length) return;
      const [beat] = state.plan.beats.splice(i, 1);
      state.plan.beats.splice(j, 0, beat);
      rebuild();
      renderBeats();
      els.beats.querySelectorAll('[data-beat]')[j]?.querySelector(`[data-move="${move.dataset.move}"]`)?.focus();
      return;
    }
    if (event.target.closest('[data-remove]')) {
      const [removed] = state.plan.beats.splice(i, 1);
      rebuild();
      renderBeats();
      toast(`Beat ${i + 1} deleted`, { action: { label: 'Undo', run: () => { state.plan.beats.splice(i, 0, removed); rebuild(); renderBeats(); } } });
    }
  });
  function seekBeat(id) {
    const b = state.timeline?.beats.find(x => x.id === id);
    if (!b) return;
    seek(b.inMs + 1);
  }

  // Revise.
  async function revise(instruction) {
    if (!state.plan || state.busy) return;
    state.busy = 'revise';
    const chips = [...document.querySelectorAll('[data-revise], #rm-ask button')];
    chips.forEach(c => { c.disabled = true; });
    els.askForm.setAttribute('aria-busy', 'true');
    try {
      const data = await api({ mode: 'revise', plan: state.plan, instruction, corpus: `${state.corpus}\n${els.extraSource.value}` });
      state.spent.revise += Number(data.cost) || 0;
      const old = state.plan;
      data.plan.beats.forEach((beat, i) => { beat.id = `b${i + 1}-${Math.random().toString(36).slice(2, 6)}`; const same = old.beats.find(o => o.photo && o.photo === beat.photo); if (same && state.photos[same.id]) state.photos[beat.id] = state.photos[same.id]; });
      data.plan.team = old.team;
      state.plan = data.plan;
      rebuild();
      renderEdit();
      pickPhotosMissing();
      toast('Revised. Your photos were kept where the beat still matches.');
      logEvent('revise', { instruction: String(instruction).slice(0, 80), cost: data.cost });
    } catch (error) {
      toast(error.message, { tone: 'error' });
    } finally {
      state.busy = '';
      chips.forEach(c => { c.disabled = false; });
      els.askForm.removeAttribute('aria-busy');
    }
  }
  async function pickPhotosMissing() {
    const plan = state.plan;
    for (const beat of plan.beats) {
      if (state.plan !== plan || beat.kind === 'cta' || state.photos[beat.id]) continue;
      const list = await searchPhotos(beat.photo || plan.team?.name || '');
      const taken = new Set(Object.values(state.photos).flat());
      const pick = list.find(p => !taken.has(p.id)) || list[0];
      if (pick) await usePhoto(beat.id, pick);
    }
  }
  document.querySelectorAll('[data-revise]').forEach(btn => btn.addEventListener('click', () => revise(btn.dataset.revise)));
  els.askForm.addEventListener('submit', event => { event.preventDefault(); const v = els.askInput.value.trim(); if (v.length >= 3) { revise(v); els.askInput.value = ''; } });

  // ─── Voice ───────────────────────────────────────────────────────────────
  function renderVoice() {
    const v = state.config.voice;
    const beats = state.plan?.beats || [];
    const voiced = beats.filter(b => state.voice[b.id] && state.voice[b.id].text === b.vo).length;
    const withVo = beats.filter(b => (b.vo || '').trim()).length;
    els.voiceBadge.className = `es-badge ${v.ready ? (voiced && voiced === withVo ? 'es-badge--good' : 'es-badge--brand') : ''}`;
    els.voiceBadge.textContent = v.ready ? (voiced && voiced === withVo ? 'Voice ready' : (voiced ? `${voiced} of ${withVo} voiced` : 'House voice')) : 'Captions only';
    els.voiceNote.textContent = v.ready
      ? `${v.label}. One AI voice for every reel, never a cloned voice. Edited lines are re-voiced; unchanged ones are reused for free.`
      : (v.reason || `No voice is set up. The reel exports with captions${state.music ? ' and music' : ''}.`);
    els.voiceBtn.hidden = !v.ready;
    els.voiceBtn.disabled = Boolean(state.busy) || !withVo || voiced === withVo;
    els.voiceBtn.textContent = voiced && voiced < withVo ? 'Voice the edited lines' : (voiced === withVo && withVo ? 'Voiceover is up to date' : 'Make the voiceover');
  }
  function audioContext() {
    if (!state.ac) state.ac = new (window.AudioContext || window.webkitAudioContext)();
    return state.ac;
  }
  const b64ToBytes = b64 => { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i); return out; };
  async function makeVoice() {
    if (!state.plan || state.busy) return;
    state.busy = 'voice';
    const beats = state.plan.beats.filter(b => (b.vo || '').trim() && !(state.voice[b.id] && state.voice[b.id].text === b.vo));
    const bar = els.voiceProgress.querySelector('span');
    els.voiceProgress.hidden = false;
    bar.style.width = '4%';
    setBusy(els.voiceBtn, els.voiceBtn, true);
    let done = 0;
    let failed = '';
    const ac = audioContext();
    for (const beat of beats) {
      const key = `${state.config.voice.mode}|${state.config.voice.model}|${beat.vo}`;
      try {
        let rec = await VoiceCache.get(key);
        if (!rec) {
          const data = await api({ mode: 'voice', text: beat.vo, beat: beat.id });
          state.spent.voice += Number(data.cost) || 0;
          if (data.alignedBy) state.alignedBy = data.alignedBy;
          rec = { bytes: b64ToBytes(data.audio).buffer, mime: data.mime, words: data.words || [] };
          VoiceCache.set(key, rec);
        }
        const buffer = await ac.decodeAudioData(rec.bytes.slice(0));
        const asset = `vo:${beat.id}`;
        state.buffers[asset] = buffer;
        state.assets[asset] = {
          kind: 'vo', label: `Voiceover, beat ${state.plan.beats.indexOf(beat) + 1}`,
          rights: { source: state.config.voice.mode === 'elevenlabs' ? 'ElevenLabs direct (ES house voice)' : `Vercel AI Gateway, ${state.config.voice.model || 'TTS'} (ES house voice, a public library voice)`, licence: 'AI voice, not a clone of any person; commercial use under the provider terms', organic: true, paid: true },
        };
        state.voice[beat.id] = { text: beat.vo, durationMs: Math.round(buffer.duration * 1000), words: rec.words, asset };
      } catch (error) {
        failed = error.message || 'The voiceover could not be made.';
        if (error.status === 429 || error.reason === 'budget' || error.status === 503) break;
      }
      done += 1;
      bar.style.width = `${Math.round((done / beats.length) * 100)}%`;
    }
    state.busy = '';
    setBusy(els.voiceBtn, els.voiceBtn, false);
    setTimeout(() => { els.voiceProgress.hidden = true; }, 600);
    rebuild();
    renderBeats();
    renderVoice();
    if (failed) toast(failed, { tone: 'error' });
    else toast('Voiceover ready. Captions now follow the voice word by word.');
    logEvent('voice', { beats: beats.length, failed: Boolean(failed), mode: state.config.voice.mode });
  }
  els.voiceBtn.addEventListener('click', makeVoice);
  els.capstyle.addEventListener('click', event => {
    const btn = event.target.closest('[data-cap]');
    if (!btn) return;
    state.captionStyle = btn.dataset.cap;
    radios(els.capstyle, 'cap', state.captionStyle);
    rebuild();
  });

  // ─── Music ───────────────────────────────────────────────────────────────
  // Optional generated bed (REELS_MUSIC=gateway): organic-only rights.
  async function generateMusic() {
    if (!state.timeline || state.busy) return;
    const btn = $('rm-music-gen');
    state.busy = 'music';
    setBusy(btn, btn.querySelector('span'), true, 'Making the music…');
    try {
      const seconds = Math.min(60, Math.ceil(state.timeline.durationMs / 1000) + 1);
      const data = await api({ mode: 'music', mood: $('rm-music-mood').value, seconds });
      state.spent.music = (state.spent.music || 0) + (Number(data.cost) || 0);
      const bytes = b64ToBytes(data.audio).buffer;
      const buffer = await audioContext().decodeAudioData(bytes);
      await setMusic({ buffer, title: `Generated ${data.mood} bed`, source: 'generated' });
      state.assets.music.rights = { ...data.rights };
      els.licence.hidden = true;
      rebuild();
      toast('Music bed ready. It is cleared for organic posts only.');
    } catch (error) {
      toast(error.message, { tone: 'error' });
    } finally {
      state.busy = '';
      setBusy(btn, btn.querySelector('span'), false, 'Generate a music bed');
    }
  }

  async function loadMusicLibrary() {
    try {
      const response = await fetch('reels-music.json', { cache: 'no-cache' });
      const data = await response.json();
      state.musicLibrary = (data.tracks || []).filter(t => t && t.id && t.src && t.licence);
    } catch { state.musicLibrary = []; }
    els.musicPick.innerHTML = `<option value="">No music</option>${state.musicLibrary.map(t => `<option value="${esc(t.id)}">${esc(t.title)}${t.artist ? ` · ${esc(t.artist)}` : ''}</option>`).join('')}${state.music?.source === 'upload' ? `<option value="__upload" selected>${esc(state.music.title)} (uploaded)</option>` : ''}`;
    els.musicPick.disabled = false;
    if (!state.musicLibrary.length) $('rm-music-hint').textContent = 'The ES music library is empty for now. Upload a track you have the rights to. It sits under the voice, 14 dB down.';
  }
  async function setMusic({ buffer, title, source, licence = '', paid = false }) {
    state.buffers.music = buffer;
    state.music = { title, source };
    state.assets.music = { kind: 'music', label: `Music: ${title}`, rights: { source: source === 'library' ? 'ES music library' : 'Uploaded by you', licence, organic: Boolean(licence), paid: Boolean(licence) && paid } };
    els.musicName.textContent = title;
    els.licence.hidden = source !== 'upload';
    if (source === 'upload') { els.licenceNote.value = licence; els.licencePaid.checked = paid; }
    rebuild();
    renderVoice();
  }
  els.musicPick.addEventListener('change', async () => {
    const id = els.musicPick.value;
    if (!id) { state.music = null; delete state.assets.music; delete state.buffers.music; els.musicName.textContent = ''; els.licence.hidden = true; rebuild(); return; }
    if (id === '__upload') return;
    const track = state.musicLibrary.find(t => t.id === id);
    try {
      const bytes = await (await fetch(track.src)).arrayBuffer();
      const buffer = await audioContext().decodeAudioData(bytes);
      setMusic({ buffer, title: track.title, source: 'library', licence: track.licence, paid: track.paid === true });
      state.assets.music.rights.organic = track.organic !== false;
      rebuild();
    } catch { toast('That track could not be loaded.', { tone: 'error' }); }
  });
  els.musicFile.addEventListener('change', async () => {
    const file = els.musicFile.files[0];
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) { toast('That file is too large. Keep it under 40 MB.', { tone: 'error' }); return; }
    try {
      const buffer = await audioContext().decodeAudioData(await file.arrayBuffer());
      await setMusic({ buffer, title: file.name.replace(/\.[^.]+$/, '').slice(0, 60), source: 'upload' });
      loadMusicLibrary();
      els.licenceNote.focus();
      toast('Add the track’s licence to export with it.');
    } catch { toast('That audio file could not be read.', { tone: 'error' }); }
    els.musicFile.value = '';
  });
  const updateLicence = () => {
    if (!state.assets.music || state.music?.source === 'library') return;
    const licence = els.licenceNote.value.trim();
    state.assets.music.rights = { ...state.assets.music.rights, licence, organic: Boolean(licence), paid: Boolean(licence) && els.licencePaid.checked };
    rebuildSoon();
  };
  els.licenceNote.addEventListener('input', updateLicence);
  els.licencePaid.addEventListener('change', updateLicence);

  // ─── Sources ─────────────────────────────────────────────────────────────
  function renderSources() {
    els.sourcesList.innerHTML = state.sources.length ? state.sources.map(s => `<li><span class="rm-src__type">${esc({ brief: 'Brief', trend: 'Trend', news: 'News', 'fact-check': 'Fact check' }[s.type] || 'Source')}</span>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}${ICON.link}</a>` : `<span>${esc(s.title)}</span>`}</li>`).join('') : '<li class="rm-hint">No sources yet.</li>';
  }
  els.extraSource.addEventListener('input', debounce(() => { state.extraSource = els.extraSource.value; rebuild(); }, 300));

  // ─── Audio mix (Web Audio, offline: the same mix for preview and export) ─
  async function renderMix() {
    const tl = state.timeline;
    const clips = tl.tracks.audio.filter(a => state.buffers[a.asset]);
    if (!clips.length) return null;
    if (state.mix && state.mixFor === tl) return state.mix;
    const rate = 48000;
    const off = new OfflineAudioContext(2, Math.ceil((tl.durationMs / 1000) * rate), rate);
    clips.forEach(clip => {
      const src = off.createBufferSource();
      src.buffer = state.buffers[clip.asset];
      const gain = off.createGain();
      if (clip.kind === 'music') {
        src.loop = src.buffer.duration < tl.durationMs / 1000;
        const env = clip.envelope || [];
        gain.gain.setValueAtTime(R.dbToGain(env[0]?.db ?? -60), 0);
        env.forEach(p => gain.gain.linearRampToValueAtTime(R.dbToGain(p.db), p.t / 1000));
      } else {
        gain.gain.value = R.dbToGain(clip.gainDb || 0);
      }
      src.connect(gain).connect(off.destination);
      src.start(clip.inMs / 1000);
    });
    // A gentle limiter so VO peaks stay under -1 dBTP.
    const mix = await off.startRendering();
    let peak = 0;
    for (let c = 0; c < mix.numberOfChannels; c += 1) { const d = mix.getChannelData(c); for (let i = 0; i < d.length; i += 64) peak = Math.max(peak, Math.abs(d[i])); }
    const ceiling = 0.89; // -1 dBFS
    if (peak > ceiling) for (let c = 0; c < mix.numberOfChannels; c += 1) { const d = mix.getChannelData(c); for (let i = 0; i < d.length; i += 1) d[i] *= ceiling / peak; }
    state.mix = mix;
    state.mixFor = tl;
    return mix;
  }

  // ─── Preview ─────────────────────────────────────────────────────────────
  function draw() {
    if (!state.timeline) {
      ctx.fillStyle = '#101114';
      ctx.fillRect(0, 0, 1080, 1920);
      return;
    }
    R.drawFrame(ctx, state.timeline, state.t, env);
    const d = state.timeline.durationMs;
    els.scrub.value = String(Math.round((state.t / d) * 1000));
    els.scrub.setAttribute('aria-valuetext', fmtTime(state.t));
    els.time.textContent = `${fmtTime(state.t)} / ${fmtTime(d)}`;
  }
  let raf = 0;
  let playSource = null;
  let playGain = null;
  let clock = null;
  async function play() {
    if (!state.timeline) return;
    if (state.t >= state.timeline.durationMs - 40) state.t = 0;
    state.playing = true;
    els.play.classList.add('is-playing');
    els.play.setAttribute('aria-label', 'Pause');
    const mix = await renderMix().catch(() => null);
    if (!state.playing) return;
    const ac = audioContext();
    await ac.resume().catch(() => {});
    const offset = state.t / 1000;
    if (mix) {
      playSource = ac.createBufferSource();
      playSource.buffer = mix;
      playGain = ac.createGain();
      playGain.gain.value = els.mute.getAttribute('aria-pressed') === 'true' ? 0 : 1;
      playSource.connect(playGain).connect(ac.destination);
      playSource.start(0, offset);
      clock = { audio: true, start: ac.currentTime - offset };
    } else {
      clock = { audio: false, start: performance.now() - state.t };
    }
    const tick = () => {
      if (!state.playing) return;
      state.t = clock.audio ? (audioContext().currentTime - clock.start) * 1000 : performance.now() - clock.start;
      if (state.t >= state.timeline.durationMs) { state.t = state.timeline.durationMs - 1; draw(); stop(); return; }
      draw();
      raf = requestAnimationFrame(tick);
    };
    tick();
  }
  function stop() {
    state.playing = false;
    cancelAnimationFrame(raf);
    try { playSource?.stop(); } catch { /* already stopped */ }
    playSource = null;
    els.play.classList.remove('is-playing');
    els.play.setAttribute('aria-label', 'Play');
  }
  function seek(t) {
    const was = state.playing;
    stop();
    state.t = Math.max(0, Math.min((state.timeline?.durationMs || 1) - 1, t));
    draw();
    if (was) play();
  }
  els.play.addEventListener('click', () => (state.playing ? stop() : play()));
  els.scrub.addEventListener('input', () => { if (state.timeline) seek((Number(els.scrub.value) / 1000) * state.timeline.durationMs); });
  els.mute.addEventListener('click', () => {
    const on = els.mute.getAttribute('aria-pressed') !== 'true';
    els.mute.setAttribute('aria-pressed', String(on));
    els.mute.setAttribute('aria-label', on ? 'Unmute preview' : 'Mute preview');
    if (playGain) playGain.gain.value = on ? 0 : 1;
  });
  els.safeToggle.addEventListener('click', () => {
    const on = els.safeToggle.getAttribute('aria-pressed') !== 'true';
    els.safeToggle.setAttribute('aria-pressed', String(on));
    els.safe.hidden = !on;
  });
  document.addEventListener('keydown', event => {
    if (event.key !== ' ' || event.target.closest('input, textarea, select, button, [contenteditable], dialog')) return;
    if (!state.timeline) return;
    event.preventDefault();
    if (state.playing) stop(); else play();
  });

  // ─── Step 3: Export ──────────────────────────────────────────────────────
  els.target.addEventListener('click', event => {
    const btn = event.target.closest('[data-target]');
    if (!btn) return;
    state.target = btn.dataset.target;
    radios(els.target, 'target', state.target);
    rebuild();
  });
  function renderExport() {
    if (!state.timeline) return;
    // One row per kind of asset with the same rights (6 voiceover clips = 1 row).
    const KIND_PLURAL = { photo: 'ES photos', vo: 'Voiceover clips', logo: 'Logos', graphic: 'Graphics' };
    const groups = new Map();
    L.rightsSummary(state.timeline, state.target).forEach(row => {
      const key = [row.kind, row.source, row.licence, row.covered, row.paid].join('|');
      const g = groups.get(key);
      if (g) { g.n += 1; g.credits.add(row.credit); } else groups.set(key, { ...row, n: 1, credits: new Set([row.credit]) });
    });
    const rows = [...groups.values()].map(g => ({ ...g, label: g.n > 1 ? `${KIND_PLURAL[g.kind] || g.label} (${g.n})` : g.label, credit: [...g.credits].filter(Boolean).join(', ') }));
    els.rights.innerHTML = `<ul class="rm-rights__list">${rows.map(r => `<li class="${r.covered ? 'is-ok' : 'is-bad'}"><span class="rm-rights__mark">${r.covered ? ICON.check : ICON.x}<span class="es-sr-only">${r.covered ? 'Cleared' : 'Not cleared'}</span></span><div><p>${esc(r.label)}</p><span>${esc(r.source)} · ${esc(r.licence)}${r.credit ? ` · Credit: ${esc(r.credit)}` : ''}</span></div><span class="rm-rights__use">${r.paid ? 'Organic + paid' : (r.organic ? 'Organic only' : 'Not cleared')}</span></li>`).join('')}</ul>
      <p class="rm-hint">No league or broadcast footage is used. Photos and team marks are editorial: they are not cleared for paid ads until ES confirms the licence.</p>`;
    const lint = state.lint;
    const critical = lint.issues.filter(i => i.severity === 'critical');
    els.gate.innerHTML = critical.length
      ? `<div class="rm-gate__bad">${ICON.alert}<div><p><b>${critical.length} ${critical.length > 1 ? 'things block' : 'thing blocks'} the export</b></p><ul>${critical.map(i => `<li>${esc(i.message)}</li>`).join('')}</ul><button class="es-btn es-btn--sm" type="button" id="rm-fix">Fix in Edit</button></div></div>`
      : `<div class="rm-gate__ok">${ICON.check}<p><b>Ready to export.</b> ${lint.warnings ? `${lint.warnings} suggestion${lint.warnings > 1 ? 's' : ''} in Quality checks.` : 'Every check passes.'}</p></div>`;
    $('rm-fix')?.addEventListener('click', () => { goStep('edit'); $('rm-lint').scrollIntoView({ behavior: 'smooth' }); });
    const est = F.estimateCost({ tier: state.tier, voiceMode: state.config.voice.ready ? state.config.voice.mode : 'off', voChars: voChars() });
    const voiceLeft = state.config.voice.ready && !state.spent.voice && !Object.keys(voiceFor()).length ? est.lines.find(l => l.id === 'voice').usd : 0;
    els.spend.innerHTML = `<ul class="rm-spend__list">
      <li><span>Script</span><span>${F.money(state.spent.director)}</span></li>
      ${state.spent.factCheck ? `<li><span>Fact check</span><span>${F.money(state.spent.factCheck)}</span></li>` : ''}
      ${state.spent.revise ? `<li><span>Revisions</span><span>${F.money(state.spent.revise)}</span></li>` : ''}
      ${state.spent.music ? `<li><span>Generated music</span><span>${F.money(state.spent.music)}</span></li>` : ''}
      <li><span>Voiceover</span><span>${state.spent.voice ? F.money(state.spent.voice) : (voiceLeft ? `≈ ${F.money(voiceLeft)} if you add it` : '$0')}</span></li>
      <li><span>Render and export</span><span>$0 (in your browser)</span></li>
      <li class="rm-spend__total"><span>Spent on this reel</span><span>${F.money(totalSpent())}</span></li></ul>`;
    els.exportBtn.disabled = Boolean(critical.length) || Boolean(state.exporting && !state.exporting.cancel);
  }

  function pickRecorderFormat() {
    const options = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
    return options.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  }
  async function ensureImages() {
    await document.fonts.ready;
    await Promise.all([
      document.fonts.load(`700 120px ${R.CONDENSED}`).catch(() => {}),
      document.fonts.load('700 50px Roboto').catch(() => {}),
      document.fonts.load('600 48px Roboto').catch(() => {}),
      document.fonts.load('500 44px Roboto').catch(() => {}),
    ]);
    measureCache.clear();
    layoutCache = new Map();
    captionCache = new Map();
  }
  // Frame-exact export: WebCodecs (H.264 + AAC) muxed by Mediabunny.
  async function encodeWebCodecs(tl, mix, onProgress, job) {
    if (typeof window.VideoEncoder !== 'function') throw new Error('no-webcodecs');
    const MB = await import(MEDIABUNNY);
    if (!(await MB.canEncodeVideo('avc', { width: 1080, height: 1920 }))) throw new Error('no-avc');
    if (mix && !(await MB.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000 }))) throw new Error('no-aac');
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1920;
    const c = canvas.getContext('2d');
    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
    const video = new MB.CanvasSource(canvas, { codec: 'avc', bitrate: 8e6, keyFrameInterval: 2 });
    output.addVideoTrack(video, { frameRate: 30 });
    let audio = null;
    if (mix) { audio = new MB.AudioBufferSource({ codec: 'aac', bitrate: 192e3 }); output.addAudioTrack(audio); }
    job.cancel = async () => { job.cancelled = true; };
    await output.start();
    const fps = 30;
    const frames = Math.ceil((tl.durationMs / 1000) * fps);
    const slice = sec => {
      // One second of the mix at a time, interleaved with the video.
      const start = Math.floor(sec * mix.sampleRate);
      const end = Math.min(mix.length, Math.floor((sec + 1) * mix.sampleRate));
      if (end <= start) return null;
      const buf = new AudioBuffer({ length: end - start, numberOfChannels: mix.numberOfChannels, sampleRate: mix.sampleRate });
      for (let ch = 0; ch < mix.numberOfChannels; ch += 1) buf.copyToChannel(mix.getChannelData(ch).subarray(start, end), ch);
      return buf;
    };
    for (let i = 0; i < frames; i += 1) {
      if (job.cancelled) { await output.cancel(); throw new Error('cancelled'); }
      if (audio && i % fps === 0) { const s = slice(i / fps); if (s) await audio.add(s); }
      R.drawFrame(c, tl, (i * 1000) / fps, env);
      await video.add(i / fps, 1 / fps);
      if (i % 6 === 0) { onProgress(i / frames); await new Promise(r => setTimeout(r, 0)); }
    }
    await output.finalize();
    return { blob: new Blob([output.target.buffer], { type: 'video/mp4' }), ext: 'mp4', how: 'webcodecs' };
  }
  // Fallback: the Video Ads path, real time (MediaRecorder).
  async function recordRealtime(tl, mix, onProgress, job) {
    const mimeType = pickRecorderFormat();
    if (!mimeType) throw new Error('This browser cannot record video. Use Chrome or Edge.');
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1920;
    const c = canvas.getContext('2d');
    const stream = canvas.captureStream(30);
    const ac = audioContext();
    await ac.resume();
    const dest = ac.createMediaStreamDestination();
    let src = null;
    if (mix) { src = ac.createBufferSource(); src.buffer = mix; src.connect(dest); dest.stream.getAudioTracks().forEach(t => stream.addTrack(t)); }
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12e6, audioBitsPerSecond: 192000 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    R.drawFrame(c, tl, 0, env);
    recorder.start(500);
    const t0 = ac.currentTime + 0.06;
    if (src) src.start(t0);
    job.cancel = () => { job.cancelled = true; };
    await new Promise(resolve => {
      const tick = () => {
        const t = (ac.currentTime - t0) * 1000;
        if (job.cancelled || t >= tl.durationMs) { resolve(); return; }
        R.drawFrame(c, tl, Math.max(0, t), env);
        onProgress(t / tl.durationMs);
        requestAnimationFrame(tick);
      };
      tick();
    });
    try { src?.stop(); } catch { /* ended */ }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach(t => t.stop());
    if (job.cancelled) throw new Error('cancelled');
    const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    return { blob: new Blob(chunks, { type: mimeType.split(';')[0] }), ext, how: 'realtime' };
  }
  const slug = text => String(text || 'reel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'reel';
  let fileUrl = '';
  async function exportReel() {
    if (state.exporting) { state.exporting.cancel?.(); return; }
    rebuild();
    if (!state.lint.ok) { renderExport(); logEvent('lint_blocked', { issues: state.lint.issues.filter(i => i.severity === 'critical').map(i => i.id) }); return; }
    stop();
    const job = { cancelled: false };
    state.exporting = job;
    const tl = state.timeline;
    const bar = els.exportProgress.querySelector('span');
    els.exportProgress.hidden = false;
    bar.style.width = '0%';
    els.files.hidden = true;
    els.exportText.textContent = 'Cancel export';
    els.exportBtn.classList.add('es-btn--danger');
    els.exportStatus.textContent = 'Preparing fonts, photos and audio…';
    const progress = p => { bar.style.width = `${Math.min(100, Math.round(p * 100))}%`; };
    let result = null;
    try {
      await ensureImages();
      const mix = await renderMix();
      try {
        els.exportStatus.textContent = 'Encoding MP4 (frame by frame)…';
        result = await encodeWebCodecs(tl, mix, progress, job);
      } catch (error) {
        if (error.message === 'cancelled') throw error;
        els.exportStatus.textContent = 'Recording in real time. Keep this tab open and visible.';
        result = await recordRealtime(tl, mix, progress, job);
      }
      progress(1);
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      fileUrl = URL.createObjectURL(result.blob);
      const name = `es-reel-${slug(state.plan.title)}-1080x1920.${result.ext}`;
      const a = document.createElement('a');
      a.href = fileUrl; a.download = name;
      document.body.append(a); a.click(); setTimeout(() => a.remove(), 1000);
      els.files.hidden = false;
      els.files.innerHTML = `<li><span class="rm-files__icon">${window.FrameUpMotion ? window.FrameUpMotion.check() : ICON.check}</span><span class="rm-files__name">${esc(name)}</span><span class="rm-meta">${(result.blob.size / 1048576).toFixed(1)} MB · ${(tl.durationMs / 1000).toFixed(1)} s</span><a class="rm-link" href="${fileUrl}" download="${esc(name)}">Download again</a></li>`;
      els.exportStatus.textContent = result.ext === 'mp4' ? 'Exported. Post it with a disclosure only if you added AI-generated video (this reel has none).' : 'Exported as WebM: this browser can’t make MP4. Use Chrome or Edge for MP4.';
      state.status = 'exported';
      autosave(true);
      toast('Reel exported', { tone: 'good' });
      logEvent('export', { how: result.how, ext: result.ext, seconds: Math.round(tl.durationMs / 1000), format: tl.format, beats: tl.beats.length, voice: tl.voice.mode, music: Boolean(state.music), target: state.target, warnings: state.lint.warnings, cost: totalSpent() });
    } catch (error) {
      els.exportStatus.textContent = error.message === 'cancelled' ? 'Export cancelled.' : (error.message || 'The export failed. Try again.');
    } finally {
      state.exporting = null;
      els.exportText.textContent = 'Export MP4';
      els.exportBtn.classList.remove('es-btn--danger');
      setTimeout(() => { els.exportProgress.hidden = true; }, 800);
      draw();
    }
  }
  els.exportBtn.addEventListener('click', exportReel);

  // ─── Projects: local first, cloud when the table exists ─────────────────
  function snapshot() {
    const assets = {};
    Object.entries(state.assets).forEach(([id, a]) => { if (a.kind === 'photo') assets[id] = a; });
    return {
      id: state.projectId, title: state.plan?.title || 'Untitled reel', format: state.plan?.format || 'explainer', sport: state.plan?.sport || null,
      status: state.status, cost_usd: totalSpent(), updatedAt: Date.now(),
      timeline: {
        v: 1, plan: state.plan, corpus: state.corpus.slice(0, 12000), sources: state.sources, extraSource: els.extraSource.value,
        photos: state.photos, assets, captionStyle: state.captionStyle, target: state.target, spent: state.spent,
        trend: state.trendRef || null, brief: state.brief || '', planSource: state.planSource,
        music: state.music ? { title: state.music.title, source: state.music.source } : null,
        durationMs: state.timeline?.durationMs || 0,
      },
    };
  }
  const saveCloud = debounce(project => {
    if (!state.cloud || state.config.offline) return;
    api({ mode: 'project-save', project: { ...project, updatedAt: undefined } }).then(data => { if (data.cloud === false) state.cloud = false; }).catch(() => { state.cloud = false; });
  }, 4000);
  const autosave = debounce(() => {
    if (!state.plan) return;
    const project = snapshot();
    const list = store.get(LOCAL_KEY, []).filter(p => p.id !== project.id);
    list.unshift(project);
    store.set(LOCAL_KEY, list.slice(0, 12));
    saveCloud(project);
  }, 600);
  function renderRecent() {
    const list = store.get(LOCAL_KEY, []);
    els.recent.hidden = !list.length;
    els.recentList.innerHTML = list.slice(0, 5).map(p => `<li><button class="rm-recent__item" type="button" data-project="${esc(p.id)}"><span class="rm-recent__title">${esc(p.title)}</span><span class="rm-meta">${esc(F.FORMATS[p.format]?.short || '')} · ${p.timeline?.durationMs ? `${Math.round(p.timeline.durationMs / 1000)} s · ` : ''}${p.status === 'exported' ? 'Exported' : 'Draft'}</span></button></li>`).join('');
  }
  els.recentList.addEventListener('click', event => {
    const btn = event.target.closest('[data-project]');
    if (!btn) return;
    const p = store.get(LOCAL_KEY, []).find(x => x.id === btn.dataset.project);
    if (p) restore(p);
  });
  async function restore(p) {
    const t = p.timeline || {};
    if (!t.plan) return;
    stop();
    state.projectId = p.id;
    state.status = p.status || 'draft';
    state.plan = t.plan;
    state.corpus = t.corpus || '';
    state.sources = t.sources || [];
    els.extraSource.value = t.extraSource || '';
    state.photos = t.photos || {};
    Object.assign(state.assets, t.assets || {});
    state.captionStyle = t.captionStyle === 'box' ? 'box' : 'highlight';
    radios(els.capstyle, 'cap', state.captionStyle);
    state.target = t.target === 'paid' ? 'paid' : 'organic';
    radios(els.target, 'target', state.target);
    state.spent = { director: 0, factCheck: 0, revise: 0, voice: 0, ...(t.spent || {}) };
    state.trendRef = t.trend;
    state.brief = t.brief;
    state.planSource = t.planSource || '';
    state.notice = t.music ? `Re-add the music track “${t.music.title}” to export with it.` : '';
    state.voice = {};
    loadTeamLogo();
    rebuild();
    renderEdit();
    goStep('edit', { focus: false });
    // Photos load again; the voiceover comes back from this browser's cache for free.
    Object.values(state.photos).flat().forEach(id => {
      const a = state.assets[id];
      if (a && !state.images[id]) loadImage(a.src, !a.src.startsWith('/')).then(img => { if (img) { state.images[id] = img; draw(); renderBeats(); } });
    });
    if (state.config.voice.ready) restoreVoiceFromCache();
  }
  async function restoreVoiceFromCache() {
    let found = 0;
    const ac = audioContext();
    for (const beat of state.plan.beats) {
      const rec = await VoiceCache.get(`${state.config.voice.mode}|${state.config.voice.model}|${beat.vo}`);
      if (!rec) continue;
      try {
        const buffer = await ac.decodeAudioData(rec.bytes.slice(0));
        const asset = `vo:${beat.id}`;
        state.buffers[asset] = buffer;
        state.assets[asset] = { kind: 'vo', label: `Voiceover, beat ${state.plan.beats.indexOf(beat) + 1}`, rights: { source: 'ES house voice (AI)', licence: 'AI voice, not a clone of any person; commercial use under the provider terms', organic: true, paid: true } };
        state.voice[beat.id] = { text: beat.vo, durationMs: Math.round(buffer.duration * 1000), words: rec.words, asset };
        found += 1;
      } catch { /* skip */ }
    }
    if (found) { rebuild(); renderBeats(); renderVoice(); }
  }

  // ─── Boot ────────────────────────────────────────────────────────────────
  async function loadConfig() {
    try {
      const data = await api({ mode: 'config' });
      state.config = { ai: data.ai, voice: data.voice, music: data.music || null, offline: false };
    } catch (error) {
      state.config = { ai: false, voice: { mode: 'off', ready: false, label: 'Captions only', reason: 'The voice server is not reachable from here.' }, offline: Boolean(error.offline) };
    }
    els.factcheckRow.hidden = !state.config.ai;
    const gen = $('rm-music-gen-row');
    if (gen) {
      gen.hidden = !data_music(state.config);
      $('rm-music-gen').onclick = generateMusic;
    }
    if (!state.config.ai) els.writeText.textContent = 'Write a draft';
    renderCost();
    if (state.plan) { renderVoice(); renderEdit(); }
  }
  const data_music = config => Boolean(config.music && config.music.ready);
  function readHandoff() {
    try {
      const q = new URLSearchParams(location.search);
      const h = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || 'null');
      const m = h && (!q.get('trend') || h.id === q.get('trend')) ? h
        : q.get('moment') ? { id: q.get('trend') || 'trend-link', title: q.get('moment'), sport: q.get('sport') || '', team: q.get('team') || '', related: [] } : null;
      if (q.get('brief')) {
        state.source = 'brief';
        els.brief.value = q.get('brief').slice(0, 2400);
      } else if (m && m.title) {
        state.trend = { id: String(m.id || 'trend-link'), title: String(m.title).slice(0, 300), sport: ['nfl', 'cfb', 'mlb', 'golf'].includes(m.sport) ? m.sport : '', team: m.team || '', url: m.url || '', why: m.why || '', related: Array.isArray(m.related) ? m.related.slice(0, 4) : [] };
        if (!state.trends.some(t => t.id === state.trend.id)) state.trends.unshift({ ...state.trend, format: F.routeFormat(state.trend.title).format });
      }
      sessionStorage.removeItem(HANDOFF_KEY);
      if (m || q.get('brief')) history.replaceState(null, '', location.pathname);
    } catch { /* no hand-off */ }
    radios(els.source, 'source', state.source);
    els.sourceTrend.hidden = state.source !== 'trend';
    els.sourceBrief.hidden = state.source !== 'brief';
  }

  renderLeagues();
  readHandoff();
  renderTrends();
  renderPicked();
  renderFormats();
  renderCost();
  renderRecent();
  draw();
  goStep('topic', { focus: false });
  loadConfig();
  loadMusicLibrary();
  loadTrends().then(() => {
    if (state.trend && !state.trends.some(t => t.id === state.trend.id)) state.trends.unshift({ ...state.trend, format: F.routeFormat(state.trend.title).format });
    renderTrends();
    renderPicked();
  });
  window.addEventListener('beforeunload', () => { if (state.plan) store.set(LOCAL_KEY, [snapshot(), ...store.get(LOCAL_KEY, []).filter(p => p.id !== state.projectId)].slice(0, 12)); });

  window.ReelMakerPage = { state, rebuild, applyPlan, draw, seek, play, stop, goStep, renderMix, exportReel, makeVoice, restore };
})();
