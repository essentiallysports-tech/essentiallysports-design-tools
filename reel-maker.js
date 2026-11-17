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
//
// 2026-11-18 (reels-styles): one guided flow (Story -> Review -> Export) with
// a single "Make my reel" that writes the script, records the voice, finds
// clips and builds the reel; four styles (reel-styles.js) with live
// thumbnails; four voices with previews; the voiceover is made automatically
// and re-made for edited lines only; every beat gets a visual through the
// fill chain (official X clips about 80% of the time, then ES photos,
// headshots, team graphics, AI scenes or AI b-roll, then the style's designed
// background; nothing chosen yet shows plain black).
(() => {
  'use strict';

  const F = window.ReelFormats;
  const R = window.ReelRender;
  const L = window.ReelLint;
  const S = window.ReelStyles;
  const X = window.ReelExport;
  const FLOW = window.ReelFlow;
  const TEAMS = window.VideoAdsTeams;
  const LOGOS = window.LeagueLogos;
  const LOGOLIB = window.FrameUpLogos;
  const CUT = window.FrameUpCutout;
  if (!F || !R || !L || !S || !X || !FLOW) return;

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
    chevronRight: svg('<path d="m9 18 6-6-6-6"/>'),
    link: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
    refresh: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
    play: svg('<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>'),
    stop: svg('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
    film: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>'),
    upload: svg('<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>'),
    shield: svg('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'),
    scissors: svg('<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>'),
  };
  const KIND_NAME = { hook: 'Hook', context: 'Context', point: 'Point', stat: 'Stat', rank: 'Rank', quote: 'Quote', payoff: 'Why it matters', cta: 'End card', bars: 'Bars', versus: 'Versus', dotrank: 'Dot ranking', chips: 'Squares', steps: 'Steps', tiles: 'Team tiles', roles: 'Position cards', mystery: 'Mystery card' };
  // Where a beat's picture came from (the fill chain), in plain words.
  const SOURCE_NAME = { 'x-clip': 'Official X clip', upload: 'Your upload', 'upload-clip': 'Your clip', photo: 'ES photo', headshot: 'ES photo', tile: 'Team graphic', scene: 'AI scene', 'ai-clip': 'AI b-roll clip', design: 'Designed background', none: 'Nothing yet (plain black)' };
  const SPORT_LABEL = { nfl: 'NFL', cfb: 'College FB', mlb: 'MLB', golf: 'Golf' };
  const LOCAL_KEY = 'frameup.reels.projects.v1';
  const HANDOFF_KEY = 'frameup.reelMoment.v1';
  const MEDIABUNNY = 'https://cdn.jsdelivr.net/npm/mediabunny@1.62.1/+esm';

  const els = {
    steps: $('rm-steps'), canvas: $('rm-canvas'), emptyStage: $('rm-empty-stage'), safe: $('rm-safe'),
    play: $('rm-play'), scrub: $('rm-scrub'), time: $('rm-time'), mute: $('rm-mute'), safeToggle: $('rm-safe-toggle'), stageMeta: $('rm-stage-meta'),
    panes: { topic: $('rm-pane-topic'), edit: $('rm-pane-edit'), export: $('rm-pane-export') },
    source: $('rm-source'), sourceTrend: $('rm-source-trend'), sourceBrief: $('rm-source-brief'), leagues: $('rm-leagues'), trendbox: $('rm-trendbox'), trends: $('rm-trends'), trendsNote: $('rm-trends-note'), picked: $('rm-picked'),
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
    strip: $('rm-strip'), stripwrap: $('rm-stripwrap'), making: $('rm-making'), makingLive: $('rm-making-live'), autoline: $('rm-autoline'), settings: $('rm-settings'), settingsMeta: $('rm-settings-meta'),
    styles: $('rm-styles'), stylesEdit: $('rm-styles-edit'), styleWhy: $('rm-style-why'), styleMeta: $('rm-style-meta'),
    voiceTopic: $('rm-voice-topic'), voiceEdit: $('rm-voice-edit'), voiceState: $('rm-voice-state'),
    clipsOn: $('rm-clips-on'), aiclipsOn: $('rm-aiclips-on'), aiclipsRow: $('rm-aiclips-row'), aiclipsNote: $('rm-aiclips-note'),
    statusline: $('rm-statusline'), statuslineText: $('rm-statusline-text'), lint: $('rm-lint'), costEdit: $('rm-cost-edit'),
    musicMeta: $('rm-music-meta'), sourcesMeta: $('rm-sources-meta'), visualFile: $('rm-visual-file'), capstyleField: $('rm-capstyle-field'),
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
    spent: { director: 0, factCheck: 0, revise: 0, voice: 0, clipJudge: 0 },
    timeline: null, lint: null, t: 0, playing: false, busy: '',
    cloud: true,
    // reels-styles
    style: 'auto', styleSuggested: { id: 'classic', why: '' },
    voiceOn: true, voiceId: 'brian', voiceError: '', voiceMaking: false,
    useClips: true, aiClips: false, aiClipsUsed: 0, clipAudio: false,
    videos: {}, cutouts: {}, visualSrc: {}, clipPool: [], clipPoolKey: '', selected: '',
    flow: FLOW.initial(),
  };
  state.spent.clips = 0;
  state.spent.scenes = 0;
  const styleId = () => (state.plan && state.plan.style) || (state.style === 'auto' ? state.styleSuggested.id : state.style);

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
    videos: state.videos,
    cutouts: state.cutouts,
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
    els.nextText.textContent = step === 'topic' ? 'Back to your reel' : 'Next: Export';
    els.stripwrap.hidden = step === 'topic' || !state.plan;
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
    renderPicked();
    renderFormats();
    renderCost();
  });

  function leagueTile(sport, size = 20) {
    const logo = LOGOS ? LOGOS.logoFor(sport) : null;
    if (!logo) return size >= 32 ? `<span class="rm-league rm-league--none" style="--size:${size}px" aria-hidden="true">${esc((SPORT_LABEL[sport] || '?').slice(0, 3))}</span>` : '';
    return `<span class="rm-league" style="--tile:${esc(logo.bg)};--size:${size}px" title="${esc(logo.label)}"><img src="${esc(logo.src)}" alt="" loading="lazy"></span>`;
  }
  function renderLeagues() {
    const list = [['all', 'All'], ['nfl', 'NFL'], ['cfb', 'CFB'], ['mlb', 'MLB'], ['golf', 'Golf']];
    els.leagues.innerHTML = list.map(([id, label]) => `<button class="es-chip" type="button" role="radio" aria-checked="${state.league === id}" tabindex="${state.league === id ? 0 : -1}" data-league="${id}">${id === 'all' ? '' : leagueTile(id, 16)}${label}</button>`).join('');
  }
  els.leagues.addEventListener('click', event => {
    const btn = event.target.closest('[data-league]');
    if (!btn) return;
    const refocus = els.leagues.contains(document.activeElement);
    state.league = btn.dataset.league;
    renderLeagues();
    renderTrends();
    if (refocus) els.leagues.querySelector(`[data-league="${state.league}"]`)?.focus();
    els.trendbox.scrollTop = 0;
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
    // Roving tabindex: one Tab stop (the picked row, else the first); arrows move.
    const tabId = items.some(item => item.id === state.trend?.id) ? state.trend.id : items[0].id;
    els.trends.innerHTML = items.map(item => {
      const on = state.trend?.id === item.id;
      return `<li role="none"><button class="rm-trend" type="button" role="radio" aria-checked="${on}" tabindex="${item.id === tabId ? 0 : -1}" data-trend="${esc(item.id)}">
        ${leagueTile(item.sport, 40)}
        <span class="rm-trend__body"><span class="rm-trend__title">${esc(item.title)}</span>${trendMeta(item)}</span>
      </button></li>`;
    }).join('');
  }
  // "NFL · 2h ago" plus the format tag (Explainer, Top 5…).
  function trendMeta(item) {
    const fmt = F.FORMATS[item.format];
    const bits = [SPORT_LABEL[item.sport] || '', item.publishedAt ? ago(item.publishedAt) : ''].filter(Boolean).join(' · ');
    return `<span class="rm-trend__meta"><span>${esc(bits)}</span>${fmt ? `<span class="es-badge es-badge--brand rm-trend__fmt">${esc(fmt.short)}</span>` : ''}</span>`;
  }
  els.trends.setAttribute('role', 'radiogroup');
  els.trends.addEventListener('click', event => {
    const btn = event.target.closest('[data-trend]');
    if (!btn) return;
    const item = state.trends.find(t => t.id === btn.dataset.trend);
    if (!item) return;
    const refocus = els.trends.contains(document.activeElement);
    state.trend = state.trend?.id === item.id ? null : item;
    if (state.trend && !state.sport) els.sport.value = '';
    renderTrends();
    renderPicked();
    renderFormats();
    if (refocus) els.trends.querySelector(`[data-trend="${CSS.escape(item.id)}"]`)?.focus({ preventScroll: false });
  });
  // Home / End jump to the first / last story (arrows are handled for every radiogroup).
  els.trends.addEventListener('keydown', event => {
    if (!['Home', 'End'].includes(event.key) || !event.target.closest('[data-trend]')) return;
    const list = [...els.trends.querySelectorAll('[data-trend]')];
    event.preventDefault();
    (event.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
  });
  // A hairline + soft shadow under the sticky league filter once the list scrolls.
  els.trendbox.addEventListener('scroll', () => els.trendbox.classList.toggle('is-scrolled', els.trendbox.scrollTop > 0), { passive: true });
  function renderPicked() {
    const t = state.trend;
    els.picked.hidden = !t || state.source !== 'trend';
    if (!t) { els.picked.innerHTML = ''; return; }
    els.picked.innerHTML = `${leagueTile(t.sport, 40)}
      <div class="rm-picked__body"><p class="rm-picked__eyebrow">Reel about</p><p class="rm-picked__title">${esc(t.title)}</p>${trendMeta(t)}</div>
      <div class="rm-picked__actions">
        <button class="es-btn es-btn--tertiary es-btn--sm" type="button" id="rm-repick">Change</button>
        <button class="es-btn es-btn--tertiary es-btn--sm" type="button" id="rm-unpick" aria-label="Clear the story">Clear</button>
      </div>`;
    $('rm-unpick').addEventListener('click', () => {
      state.trend = null; renderTrends(); renderPicked(); renderFormats();
      els.trends.querySelector('[tabindex="0"]')?.focus();
    });
    $('rm-repick').addEventListener('click', () => {
      if (state.league !== 'all' && state.league !== t.sport) { state.league = 'all'; renderLeagues(); renderTrends(); }
      const row = els.trends.querySelector(`[data-trend="${CSS.escape(t.id)}"]`) || els.trends.querySelector('[data-trend]');
      row?.scrollIntoView({ block: 'nearest' });
      row?.focus({ preventScroll: true });
    });
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
    renderStyles();
  });

  // ─── Styles: picker with live thumbnails drawn by the renderer ──────────
  const SAMPLE = {
    classic: { beats: [{ id: 's1', kind: 'hook', text: 'Allen breaks the Bills record', vo: 'Josh Allen just broke the Bills record.', emphasis: 'record' }] },
    explainer: { eyebrow: 'Josh Allen · Every season', beats: [{ id: 's1', kind: 'stat', text: 'Average throw depth', vo: 'His average throw travels 8.4 yards.', stat: { value: '8.4', label: 'Yards per throw' }, visual: 'chart', chips: { filled: '1', total: '5', label: 'Deep shots' } }] },
    series: { series: { tag: 'ES Moneyball' }, strip: { label: 'Cap space', value: '-$12.3M', of: '$40M', tone: 'bad' }, beats: [{ id: 's1', kind: 'roles', text: 'Where the holes are', vo: 'Here is where the holes are.', roles: [{ role: 'WR', value: '#31', tone: 'bad' }, { role: 'LB', value: 'FA', tone: 'bad' }, { role: 'DB', value: '3 FAs', tone: 'bad' }, { role: 'DL', value: '#2', tone: 'good' }] }] },
    countdown: { beats: [{ id: 's1', kind: 'rank', rank: 1, name: 'Josh Allen', text: 'Josh Allen', vo: 'Number one is Josh Allen.', detail: 'MVP favourite' }, { id: 's0', kind: 'rank', rank: 2, name: 'Lamar', text: 'Lamar', vo: 'Two.' }] },
  };
  const thumbCache = new Map();
  function drawThumb(canvas, id) {
    const c = canvas.getContext('2d');
    const plan = { format: id === 'countdown' ? 'top5' : 'explainer', title: 'Sample', ...SAMPLE[id] };
    const team = state.plan?.team || { name: 'Sample', colors: ['#0A2342', '#0A6FDE'] };
    const assets = { 'design:bg': { kind: 'design', label: 'Designed background', rights: {} } };
    const photos = Object.fromEntries(plan.beats.map(b => [b.id, ['design:bg']]));
    const tl = R.buildTimeline(plan, { style: id, team, photos, assets });
    c.save();
    c.scale(canvas.width / 1080, canvas.height / 1920);
    R.drawFrame(c, tl, 1600, { measure, images: state.images, videos: {}, cutouts: {}, grain });
    c.restore();
  }
  function renderStyles() {
    const suggestion = S.suggestStyle({ format: state.format, text: topicText() });
    state.styleSuggested = suggestion;
    const current = state.plan ? state.plan.style || 'classic' : state.style;
    const items = [{ id: 'auto', label: 'Auto', blurb: `Suggested: ${S.get(suggestion.id).label}` }, ...S.STYLE_IDS.map(id => S.STYLES[id])];
    const html = (prefix, withAuto) => (withAuto ? items : items.slice(1)).map(st => {
      const on = current === st.id;
      const sug = st.id === suggestion.id && topicText().trim().length > 8;
      return `<button class="rm-style" type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-style="${st.id}">
        ${st.id === 'auto' ? `<span class="rm-style__auto" aria-hidden="true">${ICON.sparkles}</span>` : `<canvas class="rm-style__thumb" width="108" height="192" data-thumb="${st.id}" aria-hidden="true"></canvas>`}
        <span class="rm-style__name">${esc(st.label)}${sug ? '<span class="rm-format__dot" title="Suggested for this story"><span class="es-sr-only">, suggested</span></span>' : ''}</span>
        <span class="rm-style__blurb">${esc(st.blurb)}</span></button>`;
    }).join('');
    els.styles.innerHTML = html('t', true);
    els.stylesEdit.innerHTML = html('e', false);
    [els.styles, els.stylesEdit].forEach(root => root.querySelectorAll('[data-thumb]').forEach(cv => drawThumb(cv, cv.dataset.thumb)));
    els.styleWhy.textContent = topicText().trim().length > 8 ? `Suggested: ${S.get(suggestion.id).label}` : '';
    if (els.styleMeta) els.styleMeta.textContent = state.plan ? S.get(styleId()).label : '';
    renderAutoline();
  }
  function onStylePick(event) {
    const btn = event.target.closest('[data-style]');
    if (!btn) return;
    const id = btn.dataset.style;
    if (state.plan) {
      if (id === 'auto' || id === state.plan.style) return;
      state.plan.style = id;
      state.style = id;
      // A style that lacks a component shows it with its own layout; the
      // director is asked again only if the editor wants (Revise).
      if (S.get(id).caption.mode !== 'user') els.capstyleField.hidden = true; else els.capstyleField.hidden = false;
      rebuild();
      renderEdit();
      if (S.get(id).cutout) autoCutout();
      logEvent('edit', { what: 'style', style: id });
    } else state.style = id;
    renderStyles();
  }
  els.styles.addEventListener('click', onStylePick);
  els.stylesEdit.addEventListener('click', onStylePick);

  // The Settings summary above Make my reel: Style · Voice · Clips · Format.
  // Each tile opens All settings at that section.
  function renderAutoline() {
    const v = state.config.voice;
    const voice = v.ready && state.voiceOn ? ((v.voices || []).find(x => x.id === state.voiceId) || {}).name || 'House voice' : 'Captions only';
    const st = state.style === 'auto' ? `Auto · ${S.get(state.styleSuggested.id).label}` : S.get(state.style).label;
    const fmt = state.format === 'auto' ? 'Auto' : F.FORMATS[state.format].short;
    const rows = [['style', 'Style', st], ['voice', 'Voice', voice], ['clips', 'Clips', state.useClips ? 'On' : 'Stills only'], ['format', 'Format', fmt]];
    els.autoline.innerHTML = rows.map(([id, label, value]) => `<button class="rm-setsum__item" type="button" data-open="${id}" aria-label="${esc(label)}: ${esc(value)}. Change ${esc(label.toLowerCase())}"><span class="rm-setsum__label">${esc(label)}</span><span class="rm-setsum__value">${esc(value)}</span>${ICON.chevronRight}</button>`).join('');
    els.settingsMeta.textContent = `${state.tier === 'economy' ? 'Economy' : 'Standard'} script · fact check ${state.factCheck ? 'on' : 'off'}`;
  }
  const SETTING_SEC = { style: 'rm-set-style', voice: 'rm-voice-topic', clips: 'rm-set-clips', format: 'rm-set-format' };
  els.autoline.addEventListener('click', event => {
    const btn = event.target.closest('[data-open]');
    const sec = btn && $(SETTING_SEC[btn.dataset.open]);
    if (!sec) return;
    els.settings.open = true;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    sec.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
    sec.querySelector('[role="radio"][aria-checked="true"]:not(:disabled), input:not(:disabled), button:not(:disabled)')?.focus({ preventScroll: true });
  });

  // ─── Voice picker (Story settings and Review fold share it) ─────────────
  let sampleSource = null;
  function voicePickerHtml(where) {
    const v = state.config.voice;
    if (!v.ready) return `<h3 class="rm-sec__title">Voice</h3><p class="rm-hint">${esc(v.reason || 'No voice is set up. Reels export with captions.')}</p>`;
    const list = v.voices || [];
    const est = F.estimateCost({ voiceMode: v.mode, voiceModel: v.model, voChars: voChars(), tier: 'economy' }).lines.find(l => l.id === 'voice').usd;
    return `<div class="rm-sec__head"><h3 class="rm-sec__title">Voice</h3>
      <label class="rm-switch"><input type="checkbox" role="switch" data-voice-on ${state.voiceOn ? 'checked' : ''}><span>${state.voiceOn ? 'On' : 'Off'}</span></label></div>
      ${list.length ? `<div class="rm-voices" role="radiogroup" aria-label="Voice" ${state.voiceOn ? '' : 'aria-disabled="true"'}>${list.map(x => {
        const on = state.voiceId === x.id;
        return `<div class="rm-voice${on ? ' is-on' : ''}"><button class="rm-voice__pick" type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-voice="${x.id}" ${state.voiceOn ? '' : 'disabled'}><span class="rm-voice__name">${esc(x.name)}</span><span class="rm-voice__line">${esc(x.line)}</span></button><button class="rm-icon-btn rm-icon-btn--sm rm-voice__play" type="button" data-sample="${x.id}" aria-label="Hear ${esc(x.name)}" title="Hear a short sample">${ICON.play}</button></div>`;
      }).join('')}</div>` : ''}
      <p class="rm-hint">${state.voiceOn ? `Human-sounding AI voices (${esc(v.model.replace('elevenlabs/', 'ElevenLabs '))}), never a clone. About ${F.money(est)} for this reel; unchanged lines are reused for free.` : 'Off: the reel exports with captions only.'}</p>`;
  }
  function renderVoicePickers() {
    els.voiceTopic.innerHTML = voicePickerHtml('topic');
    els.voiceEdit.innerHTML = voicePickerHtml('edit');
    renderAutoline();
  }
  async function playSample(id, btn) {
    try { sampleSource?.stop(); } catch { /* ended */ }
    btn.disabled = true;
    try {
      const key = `sample|${state.config.voice.model}|${id}`;
      let rec = await VoiceCache.get(key);
      if (!rec) {
        const data = await api({ mode: 'voice-sample', voice: id });
        state.spent.voice += Number(data.cost) || 0;
        rec = { bytes: b64ToBytes(data.audio).buffer, mime: data.mime, words: [] };
        VoiceCache.set(key, rec);
      }
      const ac = audioContext();
      await ac.resume().catch(() => {});
      const buffer = await ac.decodeAudioData(rec.bytes.slice(0));
      sampleSource = ac.createBufferSource();
      sampleSource.buffer = buffer;
      sampleSource.connect(ac.destination);
      sampleSource.start();
    } catch (error) {
      toast(error.message || 'The sample could not play.', { tone: 'error' });
    } finally { btn.disabled = false; }
  }
  function onVoiceUi(event) {
    const sample = event.target.closest('[data-sample]');
    if (sample) { playSample(sample.dataset.sample, sample); return; }
    const pick = event.target.closest('[data-voice]');
    if (pick && pick.dataset.voice !== state.voiceId) {
      state.voiceId = pick.dataset.voice;
      renderVoicePickers();
      if (state.plan && state.voiceOn) { state.voice = {}; rebuild(); renderVoice(); voiceSoon(0); }
      logEvent('edit', { what: 'voice', voice: state.voiceId });
    }
  }
  function onVoiceToggle(event) {
    const box = event.target.closest('[data-voice-on]');
    if (!box) return;
    state.voiceOn = box.checked;
    renderVoicePickers();
    if (state.plan) { rebuild(); renderVoice(); if (state.voiceOn) voiceSoon(0); }
  }
  [els.voiceTopic, els.voiceEdit].forEach(root => { root.addEventListener('click', onVoiceUi); root.addEventListener('change', onVoiceToggle); });
  els.clipsOn.addEventListener('change', () => { state.useClips = els.clipsOn.checked; renderAutoline(); renderCost(); });
  els.aiclipsOn.addEventListener('change', () => { state.aiClips = els.aiclipsOn.checked; renderCost(); });
  // Original clip audio: off by default (clips are muted in preview and export).
  const clipAudioBox = document.getElementById('rm-clip-audio');
  if (clipAudioBox) {
    clipAudioBox.checked = false;
    clipAudioBox.addEventListener('change', async () => {
      state.clipAudio = clipAudioBox.checked;
      if (state.clipAudio) {
        const n = await clipSounds();
        if (!n) toast('These clips have no sound to add. They stay muted.');
      }
      rebuild();
    });
  }
  els.brief.addEventListener('input', debounce(() => { renderFormats(); renderStyles(); renderCost(); }, 250));
  els.sport.addEventListener('change', () => { state.sport = els.sport.value; });
  els.tier.addEventListener('click', event => {
    const btn = event.target.closest('[data-tier]');
    if (!btn) return;
    state.tier = btn.dataset.tier;
    radios(els.tier, 'tier', state.tier);
    renderCost();
    renderAutoline();
  });
  els.factcheck.addEventListener('change', () => { state.factCheck = els.factcheck.checked; renderCost(); renderAutoline(); });

  function voChars() {
    if (state.plan) return state.plan.beats.reduce((n, b) => n + (b.vo || '').length, 0);
    return 450;
  }
  function costEstimate() {
    const v = state.config.voice;
    const long = S.get(styleId()).seconds.max > 90;
    const ai = state.config.ai && !state.config.offline;
    const sceneBeats = state.plan ? state.plan.beats.filter(b => b.visual === 'scene').length : 1;
    return F.estimateCost({
      tier: state.tier, factCheck: state.factCheck, voiceMode: v.ready && state.voiceOn ? v.mode : 'off', voiceModel: v.model, voChars: voChars() || (long ? 1100 : 450),
      clipSearches: state.useClips && ai ? 1 : 0, aiClips: state.useClips && state.aiClips && state.config.aiClips?.ready ? Math.min(state.config.aiClips.max, Math.max(1, sceneBeats)) : 0,
      scenes: ai ? Math.min(2, sceneBeats) : 0, longForm: long,
      clipJudge: state.useClips && ai && CLIPS && state.config.clipJudge?.ready !== false ? CLIPS.reelJudgeEstimate(CLIPS.JUDGE.maxClips) : 0,
    });
  }
  function costHtml(title = 'Estimated cost for this reel') {
    const est = costEstimate();
    const ai = state.config.ai && !state.config.offline;
    return `<details class="rm-cost__fold"><summary><span>${esc(title)}</span><b>${ai ? `≈ ${F.money(est.total)}` : 'Free draft'}</b></summary>
      <ul>${est.lines.map(line => `<li><span>${esc(line.label)}</span><span>${F.money(line.usd)}</span></li>`).join('')}</ul>
      <p>Counts toward your weekly AI limit. Official X clips are free once found. ${ai ? '' : 'AI is off here, so you get a draft built from your words.'}</p></details>`;
  }
  function renderCost() {
    els.cost.innerHTML = costHtml();
    if (els.costEdit) els.costEdit.innerHTML = costHtml(`Spent ${F.money(totalSpent())} so far · estimate`);
  }

  // ─── Write the reel ──────────────────────────────────────────────────────
  function setBusy(button, textEl, busy, label) {
    button.disabled = busy;
    button.classList.toggle('is-busy', busy);
    button.setAttribute('aria-busy', String(busy));
    if (label) textEl.textContent = label;
  }
  // ─── Make my reel: script -> voice -> visuals -> build ───────────────────
  // The primary button stays a filled primary while busy (aria-disabled, not
  // disabled, so it never falls back to the outline look) and counts the steps.
  const writeLabel = () => (state.config.ai ? 'Make my reel' : 'Make a draft reel');
  function setWriteBusy(busy) {
    els.write.classList.toggle('is-busy', busy);
    els.write.setAttribute('aria-busy', String(busy));
    if (busy) els.write.setAttribute('aria-disabled', 'true'); else els.write.removeAttribute('aria-disabled');
    if (!busy) els.writeText.textContent = writeLabel();
  }
  const STATE_WORD = { done: 'done', active: 'in progress', todo: 'to do', failed: 'needs a look', skipped: 'skipped' };
  function renderMaking() {
    const f = state.flow;
    els.making.hidden = !f.making && !f.stages.some(x => x.state !== 'todo');
    // While it runs, the stepper takes the trend list's place so nothing clips.
    els.panes.topic.classList.toggle('is-making', f.making);
    els.brief.readOnly = f.making;
    const mark = { done: ICON.check, failed: ICON.warn, skipped: '<span class="rm-making__dash"></span>', active: '<span class="rm-spin"></span>', todo: '' };
    els.making.innerHTML = f.stages.map(x => `<li class="rm-making__step is-${x.state}"${x.state === 'active' ? ' aria-current="step"' : ''}><span class="rm-making__mark" aria-hidden="true">${mark[x.state]}</span><span class="rm-making__text"><span class="rm-making__label">${esc(x.label)}</span>${x.note ? `<small>${esc(x.note)}</small>` : ''}</span><span class="es-sr-only">, ${STATE_WORD[x.state] || x.state}</span></li>`).join('');
    const i = f.stages.findIndex(x => x.state === 'active');
    if (f.making && i >= 0) {
      els.writeText.textContent = `Making your reel · ${i + 1} of ${f.stages.length}`;
      if (els.makingLive) els.makingLive.textContent = `Step ${i + 1} of ${f.stages.length}: ${f.stages[i].label}`;
    }
  }
  const flowEvent = event => { state.flow = FLOW.reduce(state.flow, event); renderMaking(); };
  async function makeReel() {
    if (state.flow.making) return;
    const brief = state.source === 'brief' ? els.brief.value.trim() : '';
    const trend = state.source === 'trend' ? state.trend : null;
    if (!brief && !trend) {
      els.writeStatus.textContent = state.source === 'trend' ? 'Pick a trend first.' : 'Write a brief first.';
      (state.source === 'brief' ? els.brief : els.trends.querySelector('button'))?.focus();
      return;
    }
    if (state.source === 'brief' && brief.length < 20) { els.writeStatus.textContent = 'Add a little more: who, what happened, and the numbers.'; els.brief.focus(); return; }
    setWriteBusy(true);
    flowEvent({ type: 'make' });
    els.writeStatus.textContent = '';
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    els.making.scrollIntoView?.({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
    const started = Date.now();
    // 1. Script.
    const body = { mode: 'plan', brief, trend, format: state.format, sport: state.sport, tier: state.tier, factCheck: state.factCheck, style: state.style };
    try {
      const data = await api(body);
      state.spent.director += Number(data.costs?.director) || 0;
      state.spent.factCheck += Number(data.costs?.factCheck) || 0;
      if (data.suggestedStyle) state.styleSuggested = data.suggestedStyle;
      applyPlan(data, { brief, trend, go: false });
      logEvent('plan', { source: data.source, format: data.plan.format, style: data.plan.style, escalated: data.escalated, cost: data.cost, issues: (data.issues || []).length, beats: data.plan.beats.length });
      flowEvent({ type: 'stage-done', stage: 'script', note: `${data.plan.beats.length} beats · ${S.get(data.plan.style).label}` });
    } catch (error) {
      if (error.offline) {
        // No server (static preview): a draft from the words on the page.
        const corpus = [brief, trend?.title, ...(trend?.related || []).map(r => r.title)].filter(Boolean).join('\n');
        const plan = F.fallbackPlan({ brief: corpus, title: trend?.title || '', format: state.format, sport: state.sport || trend?.sport || '' });
        plan.style = state.style === 'auto' ? state.styleSuggested.id : state.style;
        applyPlan({ plan, source: 'draft', notice: 'The AI server is not reachable here, so this is a draft built from your words.', corpus, sources: trend ? [{ type: 'trend', title: trend.title, url: trend.url }] : [{ type: 'brief', title: 'Your brief' }] }, { brief, trend, go: false });
        flowEvent({ type: 'stage-done', stage: 'script', note: 'Draft from your words' });
      } else {
        flowEvent({ type: 'stage-done', stage: 'script', failed: true, note: error.message });
        els.writeStatus.textContent = error.message;
        toast(error.message, { tone: 'error' });
        setWriteBusy(false);
        return;
      }
    }
    // 2. Voice (automatic when it is set up and on).
    if (state.config.voice.ready && state.voiceOn) {
      const out = await makeVoice({ auto: true });
      flowEvent({ type: 'stage-done', stage: 'voice', failed: Boolean(out.failed), note: out.failed ? 'Captions only for now. Retry in Review.' : `${out.made + out.reused} lines` });
    } else flowEvent({ type: 'stage-done', stage: 'voice', skipped: true, note: state.config.voice.ready ? 'Voice is off' : 'Captions only' });
    // 3. Visuals: clips first, then the fill chain.
    try {
      const v = await fillVisuals();
      flowEvent({ type: 'stage-done', stage: 'visuals', note: v.note });
    } catch (error) {
      flowEvent({ type: 'stage-done', stage: 'visuals', failed: true, note: 'Some beats still need a picture' });
    }
    // 4. Build.
    rebuild();
    if (S.get(styleId()).cutout) autoCutout();
    flowEvent({ type: 'stage-done', stage: 'build', note: `${(state.timeline.durationMs / 1000).toFixed(0)} s` });
    setWriteBusy(false);
    if (els.makingLive) els.makingLive.textContent = 'Your reel is ready.';
    renderEdit();
    goStep('edit', { focus: false });
    toast('Your reel is ready. Tap a beat under the preview to change it.');
    logEvent('make', { ms: Date.now() - started, style: styleId(), seconds: Math.round(state.timeline.durationMs / 1000), clipShare: clipShare().share });
  }
  els.write.addEventListener('click', makeReel);

  function teamFor(plan) {
    const t = plan.team;
    if (t && t.name) return { name: t.name, colors: t.colors || [], logo: t.logo || '' };
    return null;
  }
  function applyPlan(data, { brief = '', trend = null, go = true } = {}) {
    stop();
    const plan = data.plan;
    plan.beats.forEach((beat, i) => { beat.id = beat.id || `b${i + 1}-${Math.random().toString(36).slice(2, 6)}`; });
    plan.team = teamFor(plan);
    plan.style = S.STYLES[plan.style] ? plan.style : (state.style === 'auto' ? state.styleSuggested.id : state.style);
    state.selected = plan.beats[0]?.id || '';
    state.visualSrc = {};
    state.aiClipsUsed = 0;
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
    if (go) { goStep('edit', { focus: false }); fillVisuals().then(() => rebuild()); }
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
  async function usePhoto(beatId, photo, { quiet = false } = {}) {
    if (!photo) { setVisual(beatId, [designAsset()], 'design'); rebuild(); renderBeats(); return; }
    state.assets[photo.id] = photoAsset(photo);
    setVisual(beatId, [photo.id], 'photo');
    if (!quiet) { rebuild(); renderBeats(); }
    if (!state.images[photo.id]) {
      const img = await loadImage(photo.src, !photo.src.startsWith('/'));
      if (img) { state.images[photo.id] = img; layoutCache = new Map(); draw(); if (!quiet) renderBeats(); } else {
        delete state.photos[beatId];
        delete state.visualSrc[beatId];
        if (!quiet) { rebuild(); renderBeats(); }
      }
    }
  }
  // ─── Visuals: the fill chain (no beat is left empty) ─────────────────────
  //   clip beats (about 80% of the time): an official X clip (Video Ads'
  //   verified search, cached 30 min) -> an AI b-roll clip for scene beats
  //   (when on, capped) -> the still chain below
  //   still beats: ES image pool (the director's query, then the team, then
  //   the league) -> the team graphic (logo on team colours) -> an AI scene
  //   (scene beats only, never people) -> the style's designed background.
  const slugOf = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  function setVisual(beatId, assetIds, source) {
    state.photos[beatId] = assetIds;
    state.visualSrc[beatId] = source;
  }
  function designAsset() {
    state.assets['design:bg'] = { kind: 'design', label: `${S.get(styleId()).label} designed background`, rights: { source: 'FrameUp renderer', licence: 'ES-owned graphic', organic: true, paid: true } };
    return 'design:bg';
  }
  function clipShare() {
    const tl = state.timeline;
    if (!tl) return { share: 0, clipMs: 0, totalMs: 0 };
    let clipMs = 0;
    tl.tracks.video.forEach(shot => { if (shot.clip) clipMs += shot.outMs - shot.inMs; });
    return { share: tl.durationMs ? clipMs / tl.durationMs : 0, clipMs, totalMs: tl.durationMs };
  }

  // Clips: one verified search per reel (team, else the story), via Video Ads.
  const CLIP_SPORTS = ['nfl', 'cfb', 'mlb'];
  async function clipPool(plan) {
    const sport = CLIP_SPORTS.includes(plan.sport) ? plan.sport : '';
    if (!sport || !state.useClips || state.config.offline || !window.ESAuth?.fetchWithAuth) return [];
    const team = plan.team?.name || '';
    const key = `${sport}|${team || plan.title}`;
    if (state.clipPoolKey === key) return state.clipPool;
    try {
      const response = await window.ESAuth.fetchWithAuth('/api/video-ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(team ? { mode: 'find-clips', sport, team } : { mode: 'find-clips', sport, query: F.trimWords(plan.title, 8) }) });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) return [];
      state.spent.clips += Number(data.cost) || 0;
      state.clipPool = (data.clips || []).filter(c => c.variants?.length);
      state.clipPoolKey = key;
      return state.clipPool;
    } catch { return []; }
  }
  // The variant to download: up to 720p on the short side, else the smallest.
  const pickVariant = variants => {
    const ok = variants.filter(v => v.url && /\.mp4(\?|$)/.test(v.url));
    const list = ok.length ? ok : variants;
    const side = v => Math.min(v.width || 0, v.height || 0) || 0;
    return [...list].sort((a, b) => (side(a) <= 720 ? 0 : 1) - (side(b) <= 720 ? 0 : 1) || side(b) - side(a))[0];
  };
  function videoFrom(src) {
    return new Promise(resolve => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.loop = false;
      const done = ok => { clearTimeout(timer); resolve(ok ? v : null); };
      const timer = setTimeout(() => done(v.readyState >= 2), 15000);
      v.addEventListener('loadeddata', () => done(true), { once: true });
      v.addEventListener('error', () => done(false), { once: true });
      v.src = src;
    });
  }
  const clipBlobs = new Map();
  // Decodes the sound of every clip in use (once), for "Original clip audio".
  // A clip with no audio track just stays muted.
  async function clipSounds() {
    let n = 0;
    for (const [id, asset] of Object.entries(state.assets)) {
      if (asset.kind !== 'clip' || !asset.src) continue;
      const key = `clipaudio:${id}`;
      if (!(key in state.buffers)) {
        try { state.buffers[key] = await audioContext().decodeAudioData(await (await fetch(asset.src)).arrayBuffer()); } catch { state.buffers[key] = null; }
      }
      if (state.buffers[key]) n += 1;
    }
    return n;
  }
  async function addClipAsset(id, { blob, url = '', label, rights, remote = '', post = '' }) {
    let src = url;
    if (blob) src = URL.createObjectURL(blob);
    const video = await videoFrom(src);
    if (!video) return false;
    const durationMs = Math.round((video.duration || 6) * 1000);
    state.videos[id] = video;
    // A poster for the strip and thumbnails.
    try { video.currentTime = Math.min(0.5, (video.duration || 1) / 3); await new Promise(r => video.addEventListener('seeked', r, { once: true })); } catch { /* keep going */ }
    const poster = document.createElement('canvas');
    poster.width = 160; poster.height = Math.round(160 * (video.videoHeight || 9) / (video.videoWidth || 16));
    try { poster.getContext('2d').drawImage(video, 0, 0, poster.width, poster.height); state.images[id] = poster; } catch { /* no poster */ }
    // Trim: skip the first moment (team intros, black frames); the beat plays from there.
    const clipIn = durationMs > 4000 ? 0.4 : 0;
    state.assets[id] = { kind: 'clip', label, src, remote, post, durationMs, clipIn, rights };
    return true;
  }
  async function useXClip(beatId, clip, segment = null) {
    const id = await loadClip(clip);
    if (!id) return false;
    let use = id;
    // The picker's best segment for this beat (the same clip on two beats plays two different parts).
    if (segment && segment.outSec > segment.inSec) {
      use = `${id}@${Math.round(segment.inSec * 10)}`;
      state.assets[use] = { ...state.assets[id], clipIn: segment.inSec, clipOut: segment.outSec };
      state.videos[use] = state.videos[id];
      if (state.images[id]) state.images[use] = state.images[id];
    }
    setVisual(beatId, [use], 'x-clip');
    return true;
  }
  // Downloads an X clip once (browser side, no referrer) -> its asset id.
  async function loadClip(clip) {
    const variant = pickVariant(clip.variants || []);
    if (!variant) return '';
    const id = `clip:${slugOf(clip.url || variant.url).slice(-24)}`;
    if (!state.assets[id]) {
      let blob = clipBlobs.get(variant.url);
      if (!blob) {
        try {
          const response = await fetch(variant.url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
          if (!response.ok) return '';
          blob = await response.blob();
          clipBlobs.set(variant.url, blob);
        } catch { return ''; }
      }
      const ok = await addClipAsset(id, {
        blob, remote: variant.url, post: clip.url, label: `Clip from @${clip.handle || 'x'}`,
        rights: { source: `Official X post (${clip.url})`, licence: 'Official team, league or network post on X. ES clears these for organic posts and Meta paid ads; keep the source link.', organic: true, paid: true, x: true, credit: clip.handle ? `@${clip.handle}` : '' },
      });
      if (!ok) return '';
    }
    return id;
  }
  // Best clip per beat (reel-clips.js): the strongest candidates are
  // downloaded and sampled here (frames + motion), a vision model rates them
  // when AI is on (capped per reel, cached per clip URL), then each beat gets
  // its best free clip and the best segment of it for the beat's length.
  const CLIPS = window.ReelClips || null;
  let judgeCache = null;
  async function pickClips(pool, beats, plan, used) {
    if (!CLIPS || !pool.length || !beats.length) return {};
    const cands = CLIPS.preselect(pool, beats, plan, CLIPS.JUDGE.maxClips);
    const samples = {};
    const judgeTimes = {};
    const frames = {};
    const loaded = [];
    for (let i = 0; i < cands.length; i += 3) {
      await Promise.all(cands.slice(i, i + 3).map(async clip => {
        const id = await loadClip(clip).catch(() => '');
        if (!id || !state.videos[id]) return;
        loaded.push(clip);
        const sm = await CLIPS.sampleClip(state.videos[id]).catch(() => null);
        if (!sm) return;
        samples[clip.url] = sm.samples;
        judgeTimes[clip.url] = sm.times;
        frames[clip.url] = sm.frames;
      }));
    }
    const subjects = [...new Map(beats.map(b => CLIPS.subjectFor(b, plan)).map(sub => [sub.key, { key: sub.key, label: sub.players[0] || sub.team || sub.key }])).values()];
    const judgements = {};
    try { judgeCache = judgeCache || CLIPS.makeCache(window.localStorage); } catch { judgeCache = CLIPS.makeCache(null); }
    loaded.forEach(c => { const j = judgeCache.get(c.url); if (j && subjects.every(sub => sub.key in j.relevance)) judgements[c.url] = j; });
    const ai = state.config.ai && !state.config.offline && state.config.clipJudge?.ready !== false;
    const todo = loaded.filter(c => !judgements[c.url] && frames[c.url]?.length);
    state.spent.clipJudge = Number(state.spent.clipJudge) || 0;
    for (let i = 0; ai && i < todo.length; i += CLIPS.JUDGE.perCall) {
      const left = CLIPS.JUDGE.maxUsdPerReel - state.spent.clipJudge;
      if (left <= 0) break;
      const batch = todo.slice(i, i + CLIPS.JUDGE.perCall);
      try {
        const data = await api({ mode: 'clip-judge', budgetUsd: left, subjects, clips: batch.map(c => ({ url: c.url, text: c.text, handle: c.handle, frames: frames[c.url], times: judgeTimes[c.url] })) });
        state.spent.clipJudge += Number(data.cost) || 0;
        Object.entries(data.judgements || {}).forEach(([url, raw]) => { const j = CLIPS.validateJudgement(raw); if (j) { judgements[url] = j; judgeCache.set(url, j); } });
        if (data.capped) break;
      } catch { break; } // AI off, over a cap or failing: the free ranking decides
    }
    state.clipPicks = CLIPS.assign(loaded, beats, plan, { judgements, samples, judgeTimes, used });
    return state.clipPicks;
  }
  function nextClip(pool, beat, used) {
    const words = String(`${beat.photo} ${beat.text}`).toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const free = pool.filter(c => !used.has(c.url));
    return free.find(c => words.some(w => String(c.text || '').toLowerCase().includes(w))) || free[0] || null;
  }

  // Stills.
  async function teamTile(beatId, team, { key = '' } = {}) {
    if (!team || !team.name) return '';
    const entry = LOGOLIB ? LOGOLIB.findTeam(team.name, state.plan?.sport || '') : null;
    const logoSrc = entry ? LOGOLIB.srcFor(entry) : (team.logo || '');
    const slug = slugOf(team.name);
    const logoId = `logo:lib:${slug}`;
    if (logoSrc && !state.images[logoId]) {
      const img = await loadImage(logoSrc, /^https?:/.test(logoSrc));
      if (img) state.images[logoId] = img;
    }
    if (logoSrc) state.assets[logoId] = { kind: 'logo', label: `${team.name} logo`, src: logoSrc, rights: { source: entry ? 'FrameUp logo library' : 'Team mark (ESPN logo CDN)', licence: 'Editorial use of a team mark', organic: true, paid: true } };
    const id = `tile:${slug}`;
    state.assets[id] = { kind: 'tile', label: `${team.name} team graphic`, colors: (team.colors && team.colors.length ? team.colors : (entry?.colors || [])).slice(0, 2), logo: state.images[logoId] ? logoId : '', rights: { source: 'FrameUp renderer + team mark', licence: 'ES-owned graphic with an editorial team mark', organic: true, paid: true } };
    if (key) state.photos[key] = [id]; else setVisual(beatId, [id], 'tile');
    return id;
  }
  async function aiScene(beat) {
    if (!state.config.ai || state.config.offline) return '';
    try {
      const data = await api({ mode: 'scene', scene: beat.scene || 'stadium', sport: state.plan.sport, colors: state.plan.team?.colors || [] });
      state.spent.scenes += Number(data.cost) || 0;
      const img = await loadImage(data.dataUrl);
      if (!img) return '';
      const id = `scene:${data.scene}:${slugOf((state.plan.team?.colors || []).join(''))}`;
      state.images[id] = img;
      state.assets[id] = { kind: 'scene', label: `AI scene (${data.scene})`, src: '', rights: { ...data.rights, credit: 'AI-generated' } };
      setVisual(beat.id, [id], 'scene');
      return id;
    } catch { return ''; }
  }
  async function stillChain(beat, used) {
    const plan = state.plan;
    const team = plan.team;
    if (beat.visual === 'logo-tile' && team && await teamTile(beat.id, team)) return 'tile';
    if (beat.visual === 'scene' && await aiScene(beat)) return 'scene';
    const queries = [beat.photo, team?.name, [F.SPORTS.find(x => x.id === plan.sport)?.label, team?.short || ''].join(' ').trim()].filter(Boolean);
    for (const q of [...new Set(queries)]) {
      const list = await searchPhotos(q);
      const pick = list.find(p => !used.has(p.id) && (!p.width || p.width >= 600)) || list.find(p => !used.has(p.id));
      if (pick) { used.add(pick.id); await usePhoto(beat.id, pick, { quiet: true }); state.visualSrc[beat.id] = beat.visual === 'headshot' ? 'headshot' : 'photo'; return 'photo'; }
    }
    if (team && await teamTile(beat.id, team)) return 'tile';
    if (beat.visual === 'scene' && await aiScene(beat)) return 'scene';
    setVisual(beat.id, [designAsset()], 'design');
    return 'design';
  }
  // Component pictures: versus headshots and tile logos.
  async function componentVisuals(beat) {
    for (const [i, v] of (beat.versus || []).entries()) {
      if (v.name === '?' || state.photos[`${beat.id}#v${i}`]) continue;
      const list = await searchPhotos(v.photo || v.name);
      const pick = list[0];
      if (pick) { state.assets[pick.id] = photoAsset(pick); const img = await loadImage(pick.src, !pick.src.startsWith('/')); if (img) { state.images[pick.id] = img; state.photos[`${beat.id}#v${i}`] = [pick.id]; } }
    }
    for (const [i, t] of (beat.tiles || []).entries()) {
      if (state.photos[`${beat.id}#t${i}`]) continue;
      const entry = LOGOLIB ? LOGOLIB.findTeam(t.name || t.team, state.plan.sport || '') : null;
      const src = entry ? LOGOLIB.srcFor(entry) : t.logo;
      if (!src) continue;
      const id = `logo:lib:${slugOf(t.name || t.team)}`;
      const img = state.images[id] || await loadImage(src, /^https?:/.test(src));
      if (!img) continue;
      state.images[id] = img;
      state.assets[id] = { kind: 'logo', label: `${t.team} logo`, src, rights: { source: entry ? 'FrameUp logo library' : 'Team mark', licence: 'Editorial use of a team mark', organic: true, paid: true } };
      state.photos[`${beat.id}#t${i}`] = [id];
      if (!t.colors?.length && entry?.colors) t.colors = entry.colors.slice(0, 2);
    }
  }
  // An AI b-roll clip (async job, polled). Shows the AI scene still while it renders.
  async function aiClip(beat, { wait = false } = {}) {
    const cfg = state.config.aiClips;
    if (!cfg?.ready || state.aiClipsUsed >= cfg.max) return false;
    if (!state.photos[beat.id]?.length) await aiScene(beat);
    let start;
    try {
      start = await api({ mode: 'ai-clip-start', scene: beat.scene || 'stadium', sport: state.plan.sport, colors: state.plan.team?.colors || [], used: state.aiClipsUsed });
    } catch (error) { toast(error.message, { tone: 'error' }); return false; }
    state.aiClipsUsed += 1;
    state.spent.clips += Number(start.cost) || 0;
    state.visualNote = { ...(state.visualNote || {}), [beat.id]: 'AI clip rendering…' };
    renderBeats();
    const poll = async () => {
      let st = start.status === 'completed' ? start : null;
      for (let i = 0; !st && i < 40; i += 1) {
        await new Promise(r => setTimeout(r, 5000));
        try { const s2 = await api({ mode: 'ai-clip-status', job: start.job, operation: start.operation }); if (s2.status !== 'pending') st = s2; } catch (error) { st = { ok: false, error: error.message }; }
      }
      delete state.visualNote[beat.id];
      if (!st || !st.ok) { toast(st?.error || 'The AI clip took too long. The scene still stays.', { tone: 'error' }); renderBeats(); return false; }
      let blob = null;
      try {
        if (st.data) blob = new Blob([b64ToBytes(st.data)], { type: st.mediaType || 'video/mp4' });
        else blob = await (await fetch(st.url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' })).blob();
      } catch { blob = null; }
      const id = `aiclip:${beat.id}`;
      if (!blob || !await addClipAsset(id, { blob, label: `AI b-roll (${st.scene || beat.scene || 'scene'})`, rights: { ...st.rights, credit: 'AI-generated' } })) { toast('The AI clip could not be loaded. The scene still stays.', { tone: 'error' }); renderBeats(); return false; }
      setVisual(beat.id, [id], 'ai-clip');
      rebuild(); renderBeats();
      return true;
    };
    if (wait) return poll();
    poll();
    return true;
  }

  async function fillVisuals({ only = null, force = false } = {}) {
    const plan = state.plan;
    if (!plan) return { note: '' };
    if (!state.timeline) rebuild();
    const beats = plan.beats.filter(b => !only || only.includes(b.id));
    const pool = await clipPool(plan);
    const aiLeft = state.aiClips && state.config.aiClips?.ready ? Math.max(0, state.config.aiClips.max - state.aiClipsUsed) : 0;
    const durs = plan.beats.map(b => { const t = state.timeline.beats.find(x => x.id === b.id); return { id: b.id, kind: b.kind, visual: b.visual, durMs: t ? t.outMs - t.inMs : 2000 }; });
    const mix = F.planVisualMix(durs, { target: 0.8, clipsAvailable: state.useClips ? pool.length + aiLeft : 0 });
    // Clips already on a beat of THIS reel (not every clip this tab has seen).
    const inUse = () => new Set(plan.beats.flatMap(b => state.photos[b.id] || []).map(id => state.assets[id]?.post).filter(Boolean));
    const usedClips = inUse();
    const usedPhotos = new Set(Object.values(state.photos).flat());
    const clipBeats = beats.filter(b => b.kind !== 'cta' && mix.mode[b.id] === 'clip' && (force || !state.photos[b.id]?.length)).map(b => ({ ...b, durMs: (durs.find(d => d.id === b.id) || {}).durMs || 2500 }));
    const picks = state.useClips && pool.length ? await pickClips(pool, clipBeats, plan, usedClips).catch(() => ({})) : {};
    let n = 0;
    for (const beat of beats) {
      if (state.plan !== plan) return { note: '' };
      await componentVisuals(beat).catch(() => {});
      if (!force && state.photos[beat.id]?.length) continue;
      if (beat.kind === 'cta') { setVisual(beat.id, [designAsset()], 'design'); continue; }
      let done = false;
      if (mix.mode[beat.id] === 'clip') {
        const pick = picks[beat.id];
        if (pick) { usedClips.add(pick.clip.url); done = await useXClip(beat.id, pick.clip, pick.segment); }
        const clip = done ? null : nextClip(pool, beat, usedClips);
        if (clip) { usedClips.add(clip.url); done = await useXClip(beat.id, clip); }
        if (!done && beat.visual === 'scene' && state.aiClips && state.config.aiClips?.ready && state.aiClipsUsed < state.config.aiClips.max) done = await aiClip(beat);
      }
      if (!done) await stillChain(beat, usedPhotos);
      n += 1;
      if (n % 2 === 0) { rebuild(); renderBeats(); }
    }
    rebuild();
    renderBeats();
    const share = clipShare();
    const empty = plan.beats.filter(b => b.kind !== 'cta' && !(state.photos[b.id] || []).length).length;
    return { note: `${Math.round(share.share * 100)}% clips${empty ? ` · ${empty} still need a picture` : ''}`, share: share.share };
  }

  // Cut-out player for styles that stand one over the frame (hook beat):
  // a free plain-backdrop cut first; the AI "Remove background" on request.
  async function autoCutout({ ai = false } = {}) {
    const plan = state.plan;
    const beat = plan?.beats[0];
    if (!beat || !CUT || !S.get(styleId()).cutout) return false;
    const key = `${beat.id}#cut`;
    if (state.photos[key] && state.cutouts[state.photos[key][0]] && !ai) return true;
    const list = await searchPhotos(beat.photo || plan.team?.name || '');
    for (const photo of list.slice(0, ai ? 1 : 4)) {
      const img = state.images[photo.id] || await loadImage(photo.src, !photo.src.startsWith('/'));
      if (!img) continue;
      try {
        let cut = null;
        if (ai) {
          const session = await window.ESAuth?.getSession?.();
          const out = await CUT.removeWithModel(img, session?.token);
          if (out.ok) cut = out.image;
          else { toast('That photo could not be cut out cleanly. The framed photo stays.', { tone: 'error' }); return false; }
        } else {
          const c = document.createElement('canvas');
          const k = Math.min(1, 1200 / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
          c.width = Math.round((img.naturalWidth || img.width) * k); c.height = Math.round((img.naturalHeight || img.height) * k);
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(img, 0, 0, c.width, c.height);
          const px = g.getImageData(0, 0, c.width, c.height);
          const mask = CUT.plainBackdropMask(px.data, c.width, c.height);
          if (!mask.ok) continue;
          for (let i = 0; i < mask.alpha.length; i += 1) px.data[i * 4 + 3] = Math.min(px.data[i * 4 + 3], mask.alpha[i]);
          g.putImageData(px, 0, 0);
          cut = c;
        }
        state.images[photo.id] = img;
        state.assets[photo.id] = photoAsset(photo);
        state.cutouts[photo.id] = cut;
        state.photos[key] = [photo.id];
        rebuild();
        renderBeats();
        return true;
      } catch { /* cross-site photo or no mask: keep the framed photo */ }
    }
    return false;
  }

  // Per-beat visual actions (Review).
  async function visualAction(beatId, action) {
    const beat = state.plan.beats.find(b => b.id === beatId);
    if (!beat) return;
    state.visualNote = { ...(state.visualNote || {}), [beatId]: 'Working…' };
    renderBeats();
    try {
      if (action === 'swap-clip') {
        const pool = await clipPool(state.plan);
        const current = (state.photos[beatId] || []).map(id => state.assets[id]?.post).filter(Boolean);
        const used = new Set([...current, ...state.plan.beats.flatMap(b => state.photos[b.id] || []).map(id => state.assets[id]?.post).filter(Boolean)]);
        const ranked = CLIPS ? pool.filter(c => !used.has(c.url)).sort((a, b) => CLIPS.heuristicScore(b, CLIPS.subjectFor(beat, state.plan)).score - CLIPS.heuristicScore(a, CLIPS.subjectFor(beat, state.plan)).score) : [];
        const clip = ranked[0] || nextClip(pool, beat, used) || pool.find(c => !current.includes(c.url));
        if (!clip || !await useXClip(beatId, clip)) toast(pool.length ? 'No other clip loaded. Try a photo or upload one.' : 'No official clips found for this story. Try a photo, a team graphic or an upload.', { tone: 'error' });
      } else if (action === 'ai-clip') {
        if (!await aiClip({ ...beat, scene: beat.scene || 'stadium' })) toast(state.config.aiClips?.ready ? `This reel already has ${state.config.aiClips.max} AI clips.` : 'AI b-roll is off for now.', { tone: 'error' });
      } else if (action === 'photo') {
        delete state.visualNote[beatId];
        openPhotos(beatId);
        return;
      } else if (action === 'tile') {
        if (!await teamTile(beatId, state.plan.team)) toast('This reel has no team for a team graphic.', { tone: 'error' });
      } else if (action === 'scene') {
        if (!await aiScene({ ...beat, scene: beat.scene || 'stadium' })) toast('The AI scene could not be made right now.', { tone: 'error' });
      } else if (action === 'upload') {
        uploadTarget = beatId;
        delete state.visualNote[beatId];
        els.visualFile.click();
        return;
      } else if (action === 'cutout') {
        await autoCutout({ ai: true });
      } else if (action === 'design') {
        setVisual(beatId, [designAsset()], 'design');
      }
    } finally {
      delete state.visualNote[beatId];
      rebuild();
      renderBeats();
      logEvent('visuals', { action, source: state.visualSrc[beatId] || '' });
    }
  }
  let uploadTarget = '';
  els.visualFile.addEventListener('change', async () => {
    const file = els.visualFile.files[0];
    els.visualFile.value = '';
    if (!file || !uploadTarget) return;
    if (file.size > 120 * 1024 * 1024) { toast('That file is too large (120 MB at most).', { tone: 'error' }); return; }
    const rights = { source: 'Uploaded by you', licence: 'You confirmed ES may use it', organic: true, paid: true, credit: '' };
    const id = `up:${Date.now().toString(36)}`;
    if (file.type.startsWith('video/')) {
      if (await addClipAsset(id, { blob: file, label: `Your clip: ${file.name.slice(0, 40)}`, rights })) setVisual(uploadTarget, [id], 'upload-clip');
      else toast('That clip could not be read. Try an MP4.', { tone: 'error' });
    } else {
      const url = URL.createObjectURL(file);
      const img = await loadImage(url);
      if (!img) { toast('That image could not be read.', { tone: 'error' }); return; }
      state.images[id] = img;
      state.assets[id] = { kind: 'upload', label: `Your image: ${file.name.slice(0, 40)}`, src: url, rights };
      setVisual(uploadTarget, [id], 'upload');
    }
    rebuild();
    renderBeats();
  });

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
  els.photos.addEventListener('close', () => { if (state.plan) { renderBeats(); } });

  // ─── Timeline + lint ─────────────────────────────────────────────────────
  function voiceFor() {
    // Only clips whose text (and voice) still match the beat's VO line are used.
    const out = {};
    if (!state.voiceOn) return out;
    (state.plan?.beats || []).forEach(beat => {
      const v = state.voice[beat.id];
      if (v && v.text === beat.vo && v.voiceId === state.voiceId) out[beat.id] = v;
    });
    return out;
  }
  function rebuild() {
    if (!state.plan) return;
    const voice = voiceFor();
    const voiceMode = Object.keys(voice).length ? state.config.voice.mode : 'off';
    state.timeline = R.buildTimeline(state.plan, {
      style: styleId(), voice, photos: state.photos, assets: { ...state.assets }, team: state.plan.team, captionStyle: state.captionStyle,
      voiceMode, music: state.music ? { asset: 'music' } : null, sources: state.sources, corpus: state.corpus,
      // Clip sound is muted unless "Original clip audio" is on (then only clips that have a sound track).
      clipAudio: state.clipAudio ? Object.keys(state.buffers).filter(k => k.startsWith('clipaudio:') && state.buffers[k]).map(k => k.slice(10)) : false,
    });
    layoutCache = new Map();
    captionCache = new Map();
    state.lint = L.lintTimeline(state.timeline, { boxes: R.textBoxes(measure, state.timeline), target: state.target, extraSources: els.extraSource.value });
    state.mix = null;
    // A clip added while "Original clip audio" is on gets its sound decoded, then the mix is rebuilt.
    if (state.clipAudio && Object.entries(state.assets).some(([id, a]) => a.kind === 'clip' && a.src && !(`clipaudio:${id}` in state.buffers))) clipSounds().then(n => { if (n) rebuild(); });
    els.emptyStage.hidden = true;
    els.play.disabled = false;
    els.scrub.disabled = false;
    state.t = Math.min(state.t, state.timeline.durationMs - 1);
    renderLint();
    renderMeta();
    renderCost();
    renderStrip();
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
    const tl = state.timeline;
    els.statuslineText.textContent = FLOW.statusLine({ critical: lint.critical, warnings: lint.warnings, seconds: tl ? tl.durationMs / 1000 : 0, usd: totalSpent(), money: F.money }) + (state.voiceError && state.voiceOn ? ' · voice failed, captions only' : '');
    els.statusline.dataset.tone = lint.critical ? 'bad' : (lint.warnings ? 'warn' : 'good');
    els.lintBadge.className = `es-badge ${lint.critical ? 'es-badge--bad' : (lint.warnings ? 'es-badge--warn' : 'es-badge--good')}`;
    els.lintBadge.textContent = lint.critical ? `${lint.critical} to fix` : (lint.warnings ? `${lint.warnings} to review` : 'All clear');
    els.issues.innerHTML = list.length ? list.map(issue => {
      const n = state.plan ? state.plan.beats.findIndex(b => b.id === issue.beat) : -1;
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
    selectBeat(btn.dataset.goto, { seek: true });
    els.beats.scrollIntoView({ behavior: 'smooth', block: 'start' });
    els.beats.querySelector('input, textarea')?.focus({ preventScroll: true });
  });
  els.statusline.addEventListener('click', () => {
    const open = els.lint.hidden;
    els.lint.hidden = !open;
    els.statusline.setAttribute('aria-expanded', String(open));
  });

  // ─── Step 2: Edit ────────────────────────────────────────────────────────
  function renderEdit() {
    const plan = state.plan;
    const fmt = F.FORMATS[plan.format];
    els.notice.hidden = !state.notice;
    els.notice.innerHTML = state.notice ? `${ICON.info}<p>${esc(state.notice)}</p>` : '';
    const teamChip = plan.team ? `<span class="rm-teamchip">${plan.team.logo ? `<span class="es-team-logo" style="--logo:20px"><img src="${esc(plan.team.logo)}" alt="" onerror="this.parentNode.classList.add('es-team-logo--dot')"></span>` : ''}${esc(plan.team.name)}</span>` : '';
    const share = clipShare();
    els.summary.innerHTML = `<p class="rm-summary__eyebrow">${esc(S.get(styleId()).label)} · ${esc(fmt.label)}${plan.sport ? ` · ${esc(SPORT_LABEL[plan.sport] || plan.sport)}` : ''}${state.planSource === 'director-sonnet' ? ' · <span class="ais-badge" title="Sonnet improved a weak first draft">Sonnet</span>' : ''}</p>
      <p class="rm-summary__title">${esc(plan.title || 'Untitled reel')}</p>
      ${plan.angle ? `<p class="rm-summary__angle">${esc(plan.angle)}</p>` : ''}${teamChip}
      <div class="rm-ratio" title="Share of the reel's time"><span class="rm-ratio__bar"><span style="width:${Math.round(share.share * 100)}%"></span></span><span>Clips ${Math.round(share.share * 100)}% · Stills ${100 - Math.round(share.share * 100)}%</span></div>
      ${plan.hooks?.length ? `<div class="rm-hooks"><span>Other hooks</span>${plan.hooks.map((h, i) => `<button class="es-chip" type="button" data-hook="${i}">${esc(h)}</button>`).join('')}</div>` : ''}`;
    renderBeats();
    renderVoice();
    renderVoicePickers();
    renderSources();
    renderStyles();
    els.capstyleField.hidden = S.get(styleId()).caption.mode !== 'user';
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
    // Data components: each row edits as "label = value" (numbers must be in a source).
    const rows = (list, a, b2) => (list || []).map(x => `${x[a] || ''} = ${x[b2] || ''}`).join('\n');
    if (beat.kind === 'bars') parts.push(f('rows.bars', 'Bars (label = value, one per line)', rows(beat.bars, 'label', 'value'), { area: true, maxlength: 200 }));
    if (beat.kind === 'versus') parts.push(f('rows.versus', 'Cards (name = value, "?" for a mystery card)', rows(beat.versus, 'name', 'value'), { area: true, maxlength: 200 }));
    if (beat.kind === 'roles') parts.push(f('rows.roles', 'Positions (role = value)', rows(beat.roles, 'role', 'value'), { area: true, maxlength: 200 }));
    if (beat.kind === 'tiles') parts.push(f('rows.tiles', 'Teams (team = line)', rows(beat.tiles, 'team', 'label'), { area: true, maxlength: 200 }));
    if (beat.kind === 'dotrank') parts.push(`<div class="rm-bf-pair">${f('dotrank.rank', 'Rank', beat.dotrank?.rank || '', { maxlength: 8 })}${f('dotrank.total', 'Out of', beat.dotrank?.total || '', { maxlength: 8 })}</div>`, f('dotrank.label', 'Callout', beat.dotrank?.label || '', { maxlength: 32 }));
    if (beat.kind === 'chips' || (beat.kind === 'stat' && beat.chips)) parts.push(`<div class="rm-bf-pair">${f('chips.filled', 'Filled', beat.chips?.filled || '', { maxlength: 6 })}${f('chips.total', 'Out of', beat.chips?.total || '', { maxlength: 6 })}</div>`, f('chips.label', 'Label', beat.chips?.label || '', { maxlength: 40 }));
    if (beat.kind === 'steps') parts.push(`<div class="rm-bf-pair">${f('steps.current', 'Step', beat.steps?.current || '', { maxlength: 2 })}${f('steps.total', 'Of', beat.steps?.total || '', { maxlength: 2 })}</div>`);
    if (['bars', 'stat', 'mystery', 'context', 'point', 'payoff', 'hook'].includes(beat.kind) && S.get(styleId()).engine !== 'classic') parts.push(f('detail', 'Small line', beat.detail || '', { maxlength: 110 }));
    return parts.join('');
  }
  function visualCard(beat) {
    const ids = state.photos[beat.id] || [];
    const asset = ids[0] ? state.assets[ids[0]] : null;
    const img = ids[0] && state.images[ids[0]];
    const src = state.visualSrc[beat.id] || (asset ? (asset.kind === 'clip' ? 'x-clip' : 'photo') : 'none');
    const note = state.visualNote?.[beat.id];
    const clip = asset && asset.kind === 'clip';
    const canAi = state.config.aiClips?.ready && state.aiClipsUsed < state.config.aiClips.max;
    const cutable = beat === state.plan.beats[0] && S.get(styleId()).cutout && CUT && state.config.ai;
    const btn = (action, label, icon, extra = '') => `<button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-visual="${action}" ${extra}>${icon}<span>${label}</span></button>`;
    return `<div class="rm-visual">
      <button class="rm-thumb${img ? '' : ' is-empty'}" type="button" data-photo aria-label="Choose a photo for this beat">${img ? (img.tagName === 'CANVAS' ? '<span class="rm-thumb__canvas" data-thumb-canvas></span>' : `<img src="${esc(img.src)}" alt="">`) : ICON.image}${clip ? `<span class="rm-thumb__badge">${ICON.film}</span>` : ''}</button>
      <div class="rm-visual__meta"><p class="rm-visual__src">${esc(SOURCE_NAME[src] || src)}${asset?.rights?.credit ? ` · ${esc(asset.rights.credit)}` : ''}</p>
        <p class="rm-hint">${note ? esc(note) : (src === 'none' ? 'Plain black until you pick something.' : esc(asset?.label || ''))}</p>
        <div class="rm-visual__actions">
          ${btn('swap-clip', clip ? 'Swap clip' : 'Use a clip', ICON.film)}
          ${btn('photo', 'Use photo', ICON.image)}
          ${state.plan.team ? btn('tile', 'Team graphic', ICON.shield) : ''}
          ${canAi ? btn('ai-clip', 'Use AI clip', ICON.sparkles) : (state.config.ai ? btn('scene', 'AI scene', ICON.sparkles) : '')}
          ${btn('upload', 'Upload', ICON.upload)}
          ${cutable ? btn('cutout', 'Cut out the player', ICON.scissors) : ''}
        </div></div></div>`;
  }
  function renderStrip() {
    const tl = state.timeline;
    if (!state.plan || !tl) { els.stripwrap.hidden = true; return; }
    els.stripwrap.hidden = state.step === 'topic';
    els.strip.innerHTML = state.plan.beats.map((beat, i) => {
      const b = tl.beats.find(x => x.id === beat.id);
      const id = (state.photos[beat.id] || [])[0];
      const img = id && state.images[id];
      const on = beat.id === state.selected;
      const issue = state.lint?.issues.find(x => x.beat === beat.id && x.severity !== 'info');
      const w = b ? Math.max(56, Math.min(140, (b.outMs - b.inMs) / 40)) : 64;
      return `<li><button class="rm-chipbeat${on ? ' is-on' : ''}${issue ? ` has-${issue.severity}` : ''}" type="button" data-pick="${esc(beat.id)}" aria-pressed="${on}" style="--w:${w}px" aria-label="Beat ${i + 1}, ${esc(KIND_NAME[beat.kind] || beat.kind)}${b ? `, ${fmtTime(b.inMs)}` : ''}">
        <span class="rm-chipbeat__img">${img && img.src ? `<img src="${esc(img.src)}" alt="">` : ''}${state.assets[id]?.kind === 'clip' ? `<span class="rm-chipbeat__clip">${ICON.film}</span>` : ''}</span>
        <span class="rm-chipbeat__n">${i + 1}</span><span class="rm-chipbeat__kind">${esc(KIND_NAME[beat.kind] || beat.kind)}</span></button></li>`;
    }).join('') + `<li><button class="rm-chipbeat rm-chipbeat--add" type="button" id="rm-add-beat" aria-label="Add a beat" ${state.plan.beats.length >= S.get(styleId()).beats.max ? 'disabled' : ''}>${ICON.plus}</button></li>`;
    // Canvas posters (clips) are drawn into the chips.
    els.strip.querySelectorAll('[data-pick]').forEach(btn => {
      const id = (state.photos[btn.dataset.pick] || [])[0];
      const img = id && state.images[id];
      if (img && img.tagName === 'CANVAS') { const c = document.createElement('canvas'); c.width = 80; c.height = 80; const g = c.getContext('2d'); const k = Math.max(80 / img.width, 80 / img.height); g.drawImage(img, (80 - img.width * k) / 2, (80 - img.height * k) / 2, img.width * k, img.height * k); btn.querySelector('.rm-chipbeat__img').prepend(c); }
    });
  }
  els.strip.addEventListener('click', event => {
    if (event.target.closest('#rm-add-beat')) { addBeat(); return; }
    const btn = event.target.closest('[data-pick]');
    if (!btn) return;
    selectBeat(btn.dataset.pick, { seek: true });
  });
  function selectBeat(id, { seek: doSeek = false, focus = false } = {}) {
    state.selected = id;
    renderBeats();
    if (doSeek) seekBeat(id);
    if (focus) els.beats.querySelector('input, textarea')?.focus();
  }
  function addBeat() {
    const at = Math.max(1, state.plan.beats.findIndex(b => b.id === state.selected) + 1 || state.plan.beats.length - 1);
    const beat = { id: `b${Date.now().toString(36)}`, kind: 'point', text: 'New point', vo: 'Say what this beat adds.', emphasis: '', photo: state.plan.team?.name || '' };
    state.plan.beats.splice(Math.min(at, state.plan.beats.length - 1), 0, beat);
    state.selected = beat.id;
    rebuild();
    renderBeats();
    fillVisuals({ only: [beat.id] }).then(() => { rebuild(); renderBeats(); });
    els.beats.querySelector('input')?.select();
  }
  function renderBeats() {
    if (!state.plan) return;
    const tl = state.timeline;
    const active = document.activeElement;
    const keepId = active && els.beats.contains(active) ? active.id : '';
    if (!state.plan.beats.some(b => b.id === state.selected)) state.selected = state.plan.beats[0]?.id || '';
    const i = state.plan.beats.findIndex(b => b.id === state.selected);
    const beat = state.plan.beats[i];
    const b = tl?.beats.find(x => x.id === beat.id);
    const voiced = state.voice[beat.id] && state.voice[beat.id].text === beat.vo;
    els.beats.innerHTML = `<li class="rm-beat" data-beat="${esc(beat.id)}" data-kind="${esc(beat.kind)}">
        <div class="rm-beat__head">
          <button class="rm-beat__seek" type="button" data-seek="${esc(beat.id)}" aria-label="Play from beat ${i + 1}"><span class="rm-beat__n">${i + 1}</span><span class="rm-beat__kind">${esc(KIND_NAME[beat.kind] || beat.kind)}${beat.kind === 'rank' ? ` #${beat.rank}` : ''}</span><span class="rm-beat__time">${b ? `${fmtTime(b.inMs)}–${fmtTime(b.outMs)}` : ''}</span>${voiced ? '<span class="rm-beat__vo" title="Voiceover ready">VO</span>' : ''}</button>
          <span class="rm-beat__tools">
            <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-move="-1" aria-label="Move beat ${i + 1} earlier" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
            <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-move="1" aria-label="Move beat ${i + 1} later" ${i === state.plan.beats.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
            <button class="rm-icon-btn rm-icon-btn--sm" type="button" data-remove aria-label="Delete beat ${i + 1}" ${state.plan.beats.length <= 2 ? 'disabled' : ''}>${ICON.trash}</button>
          </span>
        </div>
        ${beat.kind === 'cta' ? '' : visualCard(beat)}
        <div class="rm-beat__fields">${beatFields(beat, i)}</div>
        <p class="rm-beat__flag" aria-live="polite"></p>
      </li>`;
    const holder = els.beats.querySelector('[data-thumb-canvas]');
    const img = state.images[(state.photos[beat.id] || [])[0]];
    if (holder && img) { const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d'); const k = Math.max(128 / img.width, 128 / img.height); g.drawImage(img, (128 - img.width * k) / 2, (128 - img.height * k) / 2, img.width * k, img.height * k); holder.replaceWith(c); }
    els.beatsMeta.textContent = `Beat ${i + 1} of ${state.plan.beats.length}`;
    renderStrip();
    renderLint();
    if (keepId) { const el = $(keepId); if (el) { el.focus(); const len = el.value.length; try { el.setSelectionRange(len, len); } catch { /* not a text field */ } } }
  }
  function setField(beat, field, value) {
    if (field.startsWith('rows.')) {
      const kind = field.slice(5);
      const keys = { bars: ['label', 'value'], versus: ['name', 'value'], roles: ['role', 'value'], tiles: ['team', 'label'] }[kind];
      const old = beat[kind] || [];
      beat[kind] = String(value).split('\n').map((line, i) => { const [a, ...rest] = line.split('='); return { ...(old[i] || {}), [keys[0]]: a.trim(), [keys[1]]: rest.join('=').trim() }; }).filter(x => x[keys[0]]).slice(0, 4);
      return;
    }
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
    if (input.dataset.field === 'vo') voiceSoon();
    const counter = input.closest('.rm-bf')?.querySelector('.rm-count');
    if (counter) { const max = input.dataset.field === 'vo' ? F.PACE.voMaxWords : F.PACE.textMaxWords; const n = F.wordCount(input.value); counter.textContent = `${n}/${max}`; counter.classList.toggle('is-over', n > max); }
    rebuildSoon();
    editedSoon();
  });
  const editedSoon = debounce(() => logEvent('edit', { what: 'text' }), 4000);
  els.beats.addEventListener('click', event => {
    const li = event.target.closest('[data-beat]');
    if (!li) return;
    const vis = event.target.closest('[data-visual]');
    if (vis) { visualAction(li.dataset.beat, vis.dataset.visual); return; }
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
      els.beats.querySelector(`[data-move="${move.dataset.move}"]`)?.focus();
      return;
    }
    if (event.target.closest('[data-remove]')) {
      const [removed] = state.plan.beats.splice(i, 1);
      state.selected = (state.plan.beats[i] || state.plan.beats[i - 1]).id;
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
      data.plan.beats.forEach(beat => { const o = state.plan.beats.find(x => x.photo && x.photo === beat.photo && state.visualSrc[x.id]); if (o) beat._from = o.id; });
      state.spent.revise += Number(data.cost) || 0;
      const old = state.plan;
      data.plan.beats.forEach((beat, i) => {
        beat.id = `b${i + 1}-${Math.random().toString(36).slice(2, 6)}`;
        const same = beat._from ? old.beats.find(o => o.id === beat._from) : old.beats.find(o => o.photo && o.photo === beat.photo);
        delete beat._from;
        if (same && state.photos[same.id]) { state.photos[beat.id] = state.photos[same.id]; state.visualSrc[beat.id] = state.visualSrc[same.id]; }
      });
      data.plan.team = old.team;
      data.plan.style = old.style;
      state.plan = data.plan;
      state.selected = data.plan.beats[0]?.id || '';
      rebuild();
      renderEdit();
      pickPhotosMissing();
      voiceSoon(0);
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
  const pickPhotosMissing = () => fillVisuals();
  document.querySelectorAll('[data-revise]').forEach(btn => btn.addEventListener('click', () => revise(btn.dataset.revise)));
  els.askForm.addEventListener('submit', event => { event.preventDefault(); const v = els.askInput.value.trim(); if (v.length >= 3) { revise(v); els.askInput.value = ''; } });

  // ─── Voice ───────────────────────────────────────────────────────────────
  function voiceCounts() {
    const beats = state.plan?.beats || [];
    const withVo = beats.filter(b => (b.vo || '').trim()).length;
    const voiced = beats.filter(b => state.voice[b.id] && state.voice[b.id].text === b.vo && state.voice[b.id].voiceId === state.voiceId).length;
    return { withVo, voiced };
  }
  function renderVoice() {
    const v = state.config.voice;
    const { withVo, voiced } = voiceCounts();
    const on = v.ready && state.voiceOn;
    const all = voiced && voiced === withVo;
    els.voiceBadge.className = `es-badge ${on ? (all ? 'es-badge--good' : (state.voiceError ? 'es-badge--bad' : 'es-badge--brand')) : ''}`;
    els.voiceBadge.textContent = !on ? 'Captions only' : (state.voiceMaking ? 'Recording…' : (all ? 'Voice ready' : (state.voiceError ? 'Voice failed' : `${voiced} of ${withVo} voiced`)));
    els.voiceNote.textContent = on
      ? ((v.voices || []).length ? '' : `${v.label}. Edited lines are re-voiced automatically; unchanged ones are reused for free.`)
      : (v.ready ? 'Voice is off: the reel exports with captions only.' : (v.reason || `No voice is set up. The reel exports with captions${state.music ? ' and music' : ''}.`));
    // Failure: clear, non-blocking, with Retry. Captions-only export still works.
    els.voiceState.innerHTML = on && state.voiceError && !state.voiceMaking
      ? `<div class="rm-voicefail">${ICON.warn}<div><p><b>The voiceover didn't record.</b> ${esc(state.voiceError)}</p><span>You can still export with captions only.</span></div><button class="es-btn es-btn--sm" type="button" data-voice-retry>Retry</button></div>`
      : '';
    els.voiceBtn.hidden = !on || all || state.voiceMaking || Boolean(state.voiceError);
    els.voiceBtn.disabled = Boolean(state.busy) || !withVo || all;
    els.voiceBtn.textContent = voiced ? 'Voice the edited lines' : 'Make the voiceover';
  }
  els.voiceState.addEventListener('click', event => { if (event.target.closest('[data-voice-retry]')) { state.voiceError = ''; makeVoice({ auto: false }); } });
  function audioContext() {
    if (!state.ac) state.ac = new (window.AudioContext || window.webkitAudioContext)();
    return state.ac;
  }
  const b64ToBytes = b64 => { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i); return out; };
  // Voices every line that has no matching clip yet (the per-line cache makes
  // unchanged lines free). Returns { made, reused, failed }.
  let voiceRun = null;
  async function makeVoice({ auto = false } = {}) {
    if (!state.plan || !state.config.voice.ready || !state.voiceOn) return { made: 0, reused: 0, failed: '' };
    if (voiceRun) return voiceRun;
    voiceRun = (async () => {
      state.voiceMaking = true;
      state.voiceError = '';
      const voiceId = state.voiceId;
      const beats = state.plan.beats.filter(b => (b.vo || '').trim() && !(state.voice[b.id] && state.voice[b.id].text === b.vo && state.voice[b.id].voiceId === voiceId));
      const bar = els.voiceProgress.querySelector('span');
      els.voiceProgress.hidden = false;
      bar.style.width = '4%';
      renderVoice();
      let done = 0;
      let made = 0;
      let reused = 0;
      let failed = '';
      const ac = audioContext();
      for (const beat of beats) {
        const hook = state.plan.beats.indexOf(beat) === 0;
        const key = `${state.config.voice.mode}|${state.config.voice.model}|${voiceId}|${hook ? 'h' : ''}|${beat.vo}`;
        els.writeStatus.textContent = auto ? `Recording the voiceover… ${done + 1} of ${beats.length}` : '';
        try {
          let rec = await VoiceCache.get(key);
          if (!rec) {
            const data = await api({ mode: 'voice', text: beat.vo, beat: beat.id, voice: voiceId, hook });
            state.spent.voice += Number(data.cost) || 0;
            if (data.alignedBy) state.alignedBy = data.alignedBy;
            rec = { bytes: b64ToBytes(data.audio).buffer, mime: data.mime, words: data.words || [], model: data.model };
            VoiceCache.set(key, rec);
            made += 1;
          } else reused += 1;
          const buffer = await ac.decodeAudioData(rec.bytes.slice(0));
          const asset = `vo:${beat.id}`;
          state.buffers[asset] = buffer;
          const name = (state.config.voice.voices || []).find(x => x.id === voiceId)?.name || 'ES house voice';
          state.assets[asset] = {
            kind: 'vo', label: `Voiceover, beat ${state.plan.beats.indexOf(beat) + 1}`,
            rights: { source: state.config.voice.mode === 'elevenlabs' ? 'ElevenLabs direct (ES house voice)' : `Vercel AI Gateway, ${rec.model || state.config.voice.model} (${name}, an ElevenLabs library voice)`, licence: 'AI voice, not a clone of any person; commercial use under the provider terms', organic: true, paid: true },
          };
          state.voice[beat.id] = { text: beat.vo, voiceId, durationMs: Math.round(buffer.duration * 1000), words: rec.words, asset };
        } catch (error) {
          failed = error.message || 'The voiceover could not be made.';
          if (error.status === 429 || error.reason === 'budget' || error.status === 503 || error.offline) break;
        }
        done += 1;
        bar.style.width = `${Math.round((done / Math.max(1, beats.length)) * 100)}%`;
      }
      state.voiceMaking = false;
      state.voiceError = failed;
      setTimeout(() => { els.voiceProgress.hidden = true; }, 600);
      if (auto) els.writeStatus.textContent = '';
      rebuild();
      renderBeats();
      renderVoice();
      if (failed && !auto) toast(failed, { tone: 'error', action: { label: 'Retry', run: () => { state.voiceError = ''; makeVoice(); } } });
      else if (!failed && made && !auto) toast('Voiceover updated. Captions follow the voice word by word.');
      if (beats.length) logEvent('voice', { beats: beats.length, made, reused, failed: Boolean(failed), mode: state.config.voice.mode, voice: voiceId, model: state.config.voice.model });
      return { made, reused, failed };
    })();
    try { return await voiceRun; } finally { voiceRun = null; }
  }
  // Edited lines are re-voiced after a pause in typing; always before play and export.
  let voiceTimer = 0;
  function voiceSoon(ms = 1800) {
    clearTimeout(voiceTimer);
    if (!state.config.voice.ready || !state.voiceOn) return;
    voiceTimer = setTimeout(() => { makeVoice(); }, ms);
  }
  async function ensureVoice() {
    clearTimeout(voiceTimer);
    if (!state.config.voice.ready || !state.voiceOn || state.voiceError) return;
    const { withVo, voiced } = voiceCounts();
    if (voiced < withVo) await makeVoice();
  }
  els.voiceBtn.addEventListener('click', () => makeVoice());
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
    state.musicLibrary = [];
    for (const file of F.MUSIC_FILES || ['reels-music.json']) {
      try {
        const response = await fetch(file, { cache: 'no-cache' });
        if (!response.ok) continue;
        const tracks = F.musicTracks ? F.musicTracks(await response.json()) : [];
        if (tracks.length) { state.musicLibrary = tracks; break; }
      } catch { /* try the next file */ }
    }
    els.musicPick.innerHTML = `<option value="">No music</option>${state.musicLibrary.map(t => `<option value="${esc(t.id)}">${esc(t.title)}${t.artist ? ` · ${esc(t.artist)}` : ''}</option>`).join('')}${state.music?.source === 'upload' ? `<option value="__upload" selected>${esc(state.music.title)} (uploaded)</option>` : ''}`;
    els.musicPick.disabled = false;
    if (!state.musicLibrary.length) $('rm-music-hint').textContent = 'The ES music library is empty for now. Upload a track you have the rights to. It sits under the voice, 14 dB down.';
  }
  async function setMusic({ buffer, title, source, licence = '', paid = false }) {
    state.buffers.music = buffer;
    state.music = { title, source };
    state.assets.music = { kind: 'music', label: `Music: ${title}`, rights: { source: source === 'library' ? 'ES music library' : 'Uploaded by you', licence, organic: Boolean(licence), paid: Boolean(licence) && paid } };
    els.musicName.textContent = title;
    els.musicMeta.textContent = title;
    els.licence.hidden = source !== 'upload';
    if (source === 'upload') { els.licenceNote.value = licence; els.licencePaid.checked = paid; }
    rebuild();
    renderVoice();
  }
  els.musicPick.addEventListener('change', async () => {
    const id = els.musicPick.value;
    if (!id) { state.music = null; delete state.assets.music; delete state.buffers.music; els.musicName.textContent = ''; els.musicMeta.textContent = 'None'; els.licence.hidden = true; rebuild(); return; }
    if (id === '__upload') return;
    const track = state.musicLibrary.find(t => t.id === id);
    try {
      const bytes = await (await fetch(track.src)).arrayBuffer();
      const buffer = await audioContext().decodeAudioData(bytes);
      setMusic({ buffer, title: track.title, source: 'library', licence: track.licence, paid: track.paid === true });
      state.assets.music.rights.organic = track.organic === true;
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
    els.sourcesMeta.textContent = state.sources.length ? `${state.sources.length}` : '';
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
      if (clip.kind === 'music' || (clip.kind === 'clip' && clip.envelope)) {
        if (clip.kind === 'music') src.loop = src.buffer.duration < tl.durationMs / 1000;
        else if (clip.loopEndSec > (clip.offsetSec || 0) + 0.5 && clip.loopEndSec <= src.buffer.duration) { src.loop = true; src.loopStart = clip.offsetSec || 0; src.loopEnd = clip.loopEndSec; }
        const env = clip.envelope || [];
        gain.gain.setValueAtTime(R.dbToGain(env[0]?.db ?? -60), 0);
        env.forEach(p => gain.gain.linearRampToValueAtTime(R.dbToGain(p.db), p.t / 1000));
      } else {
        gain.gain.value = R.dbToGain(clip.gainDb || 0);
      }
      src.connect(gain).connect(off.destination);
      if (clip.kind === 'clip') src.start(clip.inMs / 1000, Math.min(clip.offsetSec || 0, Math.max(0, src.buffer.duration - 0.05)), (clip.durMs || 0) / 1000);
      else src.start(clip.inMs / 1000);
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
  // Clips follow the preview clock: playing, they run and are nudged back when
  // they drift; paused or scrubbing, they seek and the frame redraws.
  let redrawQueued = false;
  const redrawSoon = () => { if (redrawQueued) return; redrawQueued = true; requestAnimationFrame(() => { redrawQueued = false; draw(); }); };
  function syncClips(t, playing) {
    const want = state.timeline ? R.clipTimes(state.timeline, t) : [];
    const active = new Set(want.map(w => w.asset));
    Object.entries(state.videos).forEach(([id, v]) => { if (!active.has(id) && !v.paused) v.pause(); });
    want.forEach(({ asset, time }) => {
      const v = state.videos[asset];
      if (!v) return;
      if (playing) {
        if (v.paused) { try { v.currentTime = time; } catch { /* not ready */ } v.play().catch(() => {}); } else if (Math.abs(v.currentTime - time) > 0.35) v.currentTime = time;
      } else if (Math.abs(v.currentTime - time) > 0.04) {
        if (!v.paused) v.pause();
        v.currentTime = time;
        v.addEventListener('seeked', redrawSoon, { once: true });
      }
    });
  }
  // Export: every clip on screen shows exactly its frame before drawing.
  async function seekClipsExact(t) {
    const want = state.timeline ? R.clipTimes(state.timeline, t) : [];
    await Promise.all(want.map(({ asset, time }) => {
      const v = state.videos[asset];
      if (!v || Math.abs(v.currentTime - time) < 0.5 / 30) return null;
      return new Promise(resolve => {
        const timer = setTimeout(resolve, 1000);
        v.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
        v.currentTime = time;
      });
    }));
  }
  function draw() {
    if (!state.timeline) {
      ctx.fillStyle = '#101114';
      ctx.fillRect(0, 0, 1080, 1920);
      return;
    }
    if (!state.exporting) syncClips(state.t, state.playing);
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
    // The preview speaks: edited lines are voiced first.
    if (voiceCounts().voiced < voiceCounts().withVo && state.voiceOn && state.config.voice.ready && !state.voiceError) {
      els.stageMeta.textContent = 'Recording the voiceover for the edited lines…';
      await ensureVoice();
      renderMeta();
      if (!state.playing) return;
    }
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
    Object.values(state.videos).forEach(v => { try { v.pause(); } catch { /* fine */ } });
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
    const KIND_PLURAL = { photo: 'ES photos', vo: 'Voiceover clips', logo: 'Logos', graphic: 'Graphics', clip: 'Official X clips', scene: 'AI scenes', tile: 'Team graphics' };
    const groups = new Map();
    L.rightsSummary(state.timeline, state.target).forEach(row => {
      // X clips group into one row; each keeps its source link.
      const x = row.kind === 'clip' && /^Official X post/.test(row.source);
      const key = x ? `clip|x|${row.covered}` : [row.kind, row.source, row.licence, row.covered, row.paid].join('|');
      const g = groups.get(key);
      if (g) { g.n += 1; g.credits.add(row.credit); g.links.add(state.timeline.assets[row.id]?.post || ''); } else groups.set(key, { ...row, source: x ? 'Official X posts' : row.source, n: 1, credits: new Set([row.credit]), links: new Set([x ? state.timeline.assets[row.id]?.post || '' : '']) });
    });
    const rows = [...groups.values()].map(g => ({ ...g, label: g.n > 1 ? `${KIND_PLURAL[g.kind] || g.label} (${g.n})` : g.label, credit: [...g.credits].filter(Boolean).join(', '), links: [...g.links].filter(Boolean) }));
    els.rights.innerHTML = `<ul class="rm-rights__list">${rows.map(r => `<li class="${r.covered ? 'is-ok' : 'is-bad'}"><span class="rm-rights__mark">${r.covered ? ICON.check : ICON.x}<span class="es-sr-only">${r.covered ? 'Cleared' : 'Not cleared'}</span></span><div><p>${esc(r.label)}</p><span>${esc(r.source)} · ${esc(r.licence)}${r.credit ? ` · Credit: ${esc(r.credit)}` : ''}</span>${r.links.length ? `<span class="rm-rights__links">${r.links.map((u, k) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">Source ${k + 1}</a>`).join(' · ')}</span>` : ''}</div><span class="rm-rights__use">${r.paid ? 'Organic + paid' : (r.organic ? 'Organic only' : 'Not cleared')}</span></li>`).join('')}</ul>
      <p class="rm-hint">Clips come only from official team, league and network posts on X, or your uploads; ES clears X clips for organic posts and Meta paid ads (keep the source links). ES photos are editorial: confirm before paid use.</p>`;
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
    job.cancel = async () => { job.cancelled = true; };
    Object.values(state.videos).forEach(v => { try { v.pause(); } catch { /* fine */ } });
    const out = await X.encodeMediabunny({ MB, canvas, durationMs: tl.durationMs, mix, fps: 30, onProgress, job, prepare: seekClipsExact, draw: t => R.drawFrame(c, tl, t, env) });
    return { blob: new Blob([out.buffer], { type: 'video/mp4' }), ext: 'mp4', how: 'webcodecs', hasAudio: out.hasAudio };
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
    const src = X.attachAudio(stream, ac, mix);
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
        syncClips(Math.max(0, t), true);
        R.drawFrame(c, tl, Math.max(0, t), env);
        onProgress(t / tl.durationMs);
        requestAnimationFrame(tick);
      };
      tick();
    });
    try { src?.stop(); } catch { /* ended */ }
    Object.values(state.videos).forEach(v => { try { v.pause(); } catch { /* fine */ } });
    recorder.stop();
    await stopped;
    const hasAudio = stream.getAudioTracks().length > 0;
    stream.getTracks().forEach(t => t.stop());
    if (job.cancelled) throw new Error('cancelled');
    const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    return { blob: new Blob(chunks, { type: mimeType.split(';')[0] }), ext, how: 'realtime', hasAudio };
  }
  const slug = text => String(text || 'reel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'reel';
  let fileUrl = '';
  async function exportReel() {
    if (state.exporting) { state.exporting.cancel?.(); return; }
    // The voice is always brought up to date before export.
    if (state.voiceOn && state.config.voice.ready && !state.voiceError) {
      els.exportStatus.textContent = 'Recording the voiceover for the edited lines…';
      await ensureVoice();
    }
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
      const plan = X.mixPlan(tl, state.buffers);
      if (plan.missingVo && state.voiceOn && state.config.voice.ready) els.exportStatus.textContent = `${plan.missingVo} line${plan.missingVo > 1 ? 's have' : ' has'} no voice yet; exporting with captions for ${plan.missingVo > 1 ? 'them' : 'it'}.`;
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
      const hasAi = L.usedAssets(tl).some(id => tl.assets[id]?.rights?.ai);
      const voiced = X.mixPlan(tl, state.buffers).vo;
      els.exportStatus.textContent = `${result.ext === 'mp4' ? 'Exported' : 'Exported as WebM (this browser can’t make MP4; use Chrome or Edge)'}${result.hasAudio ? (voiced ? ' with the voiceover' : ' with music') : ' with captions only (no audio)'}. ${hasAi ? 'It has AI-generated scenes: turn on the platform’s AI label when you post.' : 'No AI-generated video in it.'}`;
      state.status = 'exported';
      autosave(true);
      toast('Reel exported', { tone: 'good' });
      logEvent('export', { audio: Boolean(result.hasAudio), clipShare: clipShare().share, style: tl.style, how: result.how, ext: result.ext, seconds: Math.round(tl.durationMs / 1000), format: tl.format, beats: tl.beats.length, voice: tl.voice.mode, music: Boolean(state.music), target: state.target, warnings: state.lint.warnings, cost: totalSpent() });
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
    // Photos, team tiles and clips with a remote source come back on reopen
    // (uploads and AI media live in this tab only).
    Object.entries(state.assets).forEach(([id, a]) => { if (a.kind === 'photo' || a.kind === 'tile' || a.kind === 'design' || (a.kind === 'logo' && id.startsWith('logo:lib:')) || (a.kind === 'clip' && a.remote)) assets[id] = { ...a, src: a.kind === 'clip' ? '' : a.src }; });
    return {
      id: state.projectId, title: state.plan?.title || 'Untitled reel', format: state.plan?.format || 'explainer', sport: state.plan?.sport || null,
      status: state.status, cost_usd: totalSpent(), updatedAt: Date.now(),
      timeline: {
        v: 1, plan: state.plan, corpus: state.corpus.slice(0, 12000), sources: state.sources, extraSource: els.extraSource.value,
        photos: state.photos, assets, captionStyle: state.captionStyle, target: state.target, spent: state.spent,
        style: state.plan?.style || '', voiceId: state.voiceId, voiceOn: state.voiceOn, visualSrc: state.visualSrc, useClips: state.useClips,
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
    state.visualSrc = t.visualSrc || {};
    if (t.voiceId) state.voiceId = t.voiceId;
    if (typeof t.voiceOn === 'boolean') state.voiceOn = t.voiceOn;
    if (t.style && S.STYLES[t.style]) state.plan.style = t.style;
    state.selected = state.plan.beats[0]?.id || '';
    // Drop picks whose media is gone (uploads, AI media): those beats refill.
    Object.keys(state.photos).forEach(k => { state.photos[k] = (state.photos[k] || []).filter(id => state.assets[id]); if (!state.photos[k].length) { delete state.photos[k]; delete state.visualSrc[k]; } });
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
      if (!a || state.images[id] || state.videos[id]) return;
      if (a.kind === 'clip' && a.remote) {
        fetch(a.remote, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }).then(r => (r.ok ? r.blob() : null)).then(blob => blob && addClipAsset(id, { blob, label: a.label, rights: a.rights, remote: a.remote, post: a.post })).then(() => { rebuild(); renderBeats(); }).catch(() => {});
      } else if (a.src) loadImage(a.src, !a.src.startsWith('/')).then(img => { if (img) { state.images[id] = img; draw(); renderBeats(); } });
    });
    Object.values(state.assets).filter(a => a.kind === 'logo' && a.src).forEach(a => { const id = Object.keys(state.assets).find(k => state.assets[k] === a); if (!state.images[id]) loadImage(a.src, /^https?:/.test(a.src)).then(img => { if (img) { state.images[id] = img; draw(); } }); });
    fillVisuals();
    if (state.config.voice.ready) restoreVoiceFromCache();
  }
  async function restoreVoiceFromCache() {
    let found = 0;
    const ac = audioContext();
    for (const beat of state.plan.beats) {
      const hook = state.plan.beats.indexOf(beat) === 0;
      const rec = await VoiceCache.get(`${state.config.voice.mode}|${state.config.voice.model}|${state.voiceId}|${hook ? 'h' : ''}|${beat.vo}`);
      if (!rec) continue;
      try {
        const buffer = await ac.decodeAudioData(rec.bytes.slice(0));
        const asset = `vo:${beat.id}`;
        state.buffers[asset] = buffer;
        state.assets[asset] = { kind: 'vo', label: `Voiceover, beat ${state.plan.beats.indexOf(beat) + 1}`, rights: { source: 'ES house voice (AI)', licence: 'AI voice, not a clone of any person; commercial use under the provider terms', organic: true, paid: true } };
        state.voice[beat.id] = { text: beat.vo, voiceId: state.voiceId, durationMs: Math.round(buffer.duration * 1000), words: rec.words, asset };
        found += 1;
      } catch { /* skip */ }
    }
    if (found) { rebuild(); renderBeats(); renderVoice(); }
    voiceSoon(0);
  }

  // ─── Boot ────────────────────────────────────────────────────────────────
  async function loadConfig() {
    try {
      const data = await api({ mode: 'config' });
      state.config = { ai: data.ai, voice: data.voice, music: data.music || null, aiClips: data.aiClips || null, offline: false };
      if (data.voice?.defaultVoice && !(data.voice.voices || []).some(v => v.id === state.voiceId)) state.voiceId = data.voice.defaultVoice;
    } catch (error) {
      state.config = { ai: false, voice: { mode: 'off', ready: false, label: 'Captions only', reason: 'The voice server is not reachable from here.' }, offline: Boolean(error.offline) };
    }
    els.factcheckRow.hidden = !state.config.ai;
    const gen = $('rm-music-gen-row');
    if (gen) {
      gen.hidden = !data_music(state.config);
      $('rm-music-gen').onclick = generateMusic;
    }
    els.aiclipsRow.hidden = !state.config.aiClips?.ready;
    if (state.config.aiClips?.ready) els.aiclipsNote.textContent = `Stadium, crowd or field shots, never people or logos. Up to ${state.config.aiClips.max} a reel, about ${F.money(state.config.aiClips.perClip)} each.`;
    if (!state.flow.making) els.writeText.textContent = writeLabel();
    renderCost();
    renderVoicePickers();
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
  renderStyles();
  renderVoicePickers();
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

  window.ReelMakerPage = { state, rebuild, applyPlan, draw, seek, play, stop, goStep, renderMix, exportReel, makeVoice, restore, loadConfig, loadTrends, makeReel, fillVisuals, selectBeat, renderEdit, renderStyles, visualAction, addClipAsset, setVisual, clipShare };
})();
