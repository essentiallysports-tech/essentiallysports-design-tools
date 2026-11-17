// Video Ads page: three steps (Clip → Copy → Export) around one big live preview.
//   Layout + drawing: video-ads-render.js (window.VideoAdsRender)
//   Brands, sizes, styles: video-ads-brands.js (window.VideoAdsBrands)
//   Style rules (fields, suggestion, grid names, safe zones): video-ads-styles.js (window.VideoAdsStyles)
//   Team colours: video-ads-teams.js (window.VideoAdsTeams)
//   AI + trends + X clips: POST /api/video-ads { mode: trends | find-clips | clip | copy | chat }
//   Learning events: POST /api/ad-learning { event } (fire-and-forget)
(() => {
  'use strict';
  const R = window.VideoAdsRender;
  const B = window.VideoAdsBrands;
  const S = window.VideoAdsStyles;
  // The colour data ships in video-ads-teams.js; without it the picker still
  // shows the colours (no team preview) and the server matches the teams.
  const T = window.VideoAdsTeams || {
    COLORS: [
      { id: 'red', label: 'Red', hex: '#C8102E' }, { id: 'blue', label: 'Blue', hex: '#0057B8' }, { id: 'green', label: 'Green', hex: '#0B7A3E' },
      { id: 'gold', label: 'Gold / Yellow', hex: '#FFB81C' }, { id: 'orange', label: 'Orange', hex: '#FA4616' }, { id: 'navy', label: 'Navy', hex: '#0B2265' },
      { id: 'black', label: 'Black', hex: '#101820' }, { id: 'silver', label: 'Silver / White', hex: '#A5ACAF' },
    ],
    TEAMS: [],
    teamsFor: () => [],
  };
  const hasTeamData = Boolean(window.VideoAdsTeams && Array.isArray(T.TEAMS) && T.TEAMS.length);
  const $ = id => document.getElementById(id);

  const els = {
    stage: $('va-stage'), canvas: $('va-canvas'), video: $('va-video'), drop: $('va-drop'), empty: $('va-empty'), fit: $('va-fit'),
    busy: $('va-busy'), busyArc: $('va-busy-arc'), busyPct: $('va-busy-pct'), busyText: $('va-busy-text'),
    play: $('va-play'), mute: $('va-mute'), seek: $('va-seek'), trimIn: $('va-in'), trimOut: $('va-out'), time: $('va-time'), trimText: $('va-trimtext'),
    track: $('va-track'), strip: $('va-strip'), sel: $('va-sel'), head: $('va-head'), dimL: $('va-dim-l'), dimR: $('va-dim-r'),
    sizes: $('va-sizes'), device: $('va-device'), metaHead: $('va-meta-head'), metaOver: $('va-meta-over'), metaFoot: $('va-meta-foot'), mini: $('va-mini'),
    steps: $('va-steps'), panelScroll: $('va-panel-scroll'), back: $('va-back'), next: $('va-next'), nextText: $('va-next-text'),
    clipTabs: $('va-clip-tabs'), teamSport: $('va-team-sport'), teamQ: $('va-team-q'), teamHint: $('va-team-hint'), teamList: $('va-team-list'), teamFind: $('va-team-find'), teamFindText: $('va-team-find-text'), colorSport: $('va-color-sport'), swatches: $('va-swatches'), find: $('va-find'), findText: $('va-find-text'), found: $('va-found'),
    trends: $('va-trends'), trendsStatus: $('va-trends-status'), refresh: $('va-refresh'), sports: $('va-sports'), boardBar: document.querySelector('.va-board-bar'),
    upload: $('va-upload'), file: $('va-file'), xform: $('va-xform'), xurl: $('va-xurl'), xget: $('va-xget'), qualities: $('va-qualities'), clipStatus: $('va-clip-status'),
    brands: $('va-brands'), styles: $('va-styles'), copySwatches: $('va-copy-swatches'), momentFold: $('va-moment-fold'), momentSum: $('va-moment-sum'), copyMoments: $('va-copy-moments'), notes: $('va-notes'),
    variants: $('va-variants'), editor: $('va-editor'), headlineCount: $('va-headline-count'), bodyCount: $('va-body-count'), ctaCount: $('va-cta-count'), stepsN: $('va-steps-n'), stepsName: $('va-steps-name'), stepsBar: $('va-steps-bar'),
    thread: $('va-thread'), compose: $('va-compose'), ask: $('va-ask'), send: $('va-send'),
    // Ask AI: the one place for everything AI (options, grammar, chat).
    ai: $('va-ai'), aiBtn: $('va-ask-ai'), aiClose: $('va-ai-close'), aiActions: $('va-ai-actions'), aiWriteText: $('va-ai-write-text'), aiContext: $('va-ai-context'), aiContextSum: $('va-ai-context-sum'),
    aiProgress: $('va-ai-progress'), aiProgressText: $('va-ai-progress-text'), aiOut: $('va-ai-out'), grammar: $('va-grammar'),
    headline: $('va-headline'), highlight: $('va-highlight'), highlightRow: $('va-highlight-row'), highlightWarn: $('va-highlight-warn'),
    bodies: [$('va-body-1'), $('va-body-2'), $('va-body-3')], addPara: $('va-add-para'), cta: $('va-cta'), unsub: $('va-unsub'),
    styleFields: $('va-style-fields'), classicFields: $('va-classic-fields'), suggest: $('va-suggest'), styleCount: $('va-style-count'), zone: $('va-zone'), zoneRow: $('va-zone-row'),
    safeToggle: $('va-safe-toggle'), safe: $('va-safe'), grid: $('va-grid'), gridStyles: $('va-grid-styles'), gridNames: $('va-grid-names'), rightsRow: $('va-rights-row'),
    exsizes: $('va-exsizes'), metaToggle: $('va-meta-toggle'), ready: $('va-ready'), rights: $('va-rights'), exportBtn: $('va-export'), exportProgress: $('va-export-progress'), exportStatus: $('va-export-status'), files: $('va-files'), again: $('va-again'),
    toasts: $('va-toasts'),
  };
  // The ad's media: the clip <video>, or a still source with no footage
  // (StillClip: an animated background or a photo with a slow zoom). Code that
  // plays, seeks or trims uses els.video either way; listeners that must hear
  // both are added with onMedia().
  const realVideo = els.video;
  let still = null;
  Object.defineProperty(els, 'video', { get: () => still || realVideo, configurable: true });
  const mediaHandlers = [];
  const onMedia = (type, fn) => { mediaHandlers.push([type, fn]); realVideo.addEventListener(type, fn); };
  const ctx = els.canvas.getContext('2d');
  const measureCtx = document.createElement('canvas').getContext('2d');
  const measure = (text, font) => { measureCtx.font = font; return measureCtx.measureText(text).width; };
  const blurCanvas = document.createElement('canvas');

  // A worked example (the Essentially CFB template) so the page never starts blank.
  const state = {
    step: 'copy',
    size: '9x16',
    brandId: 'essentially-cfb',
    brandChosen: false,
    style: 'highlight',
    headline: 'The college football team you were handed, from your dad to your son. Keep up with it, free.',
    highlight: 'Keep up with it, free.',
    body: ['Nobody picks their first team. A dad passes it to his son: the same seats, the same Saturdays. Keep up with the program you were handed, then all of college football. Free. Join 100,000+ fans today.', '', ''],
    cta: '',
    unsubscribe: true,
    // The no-footage styles' fields (video-ads-styles.js). Empty = the default
    // for the offer / title / "your feed" lines; `us` null = the brand's
    // first approved claims. Numbers and quotes are never filled in for you.
    offer: '', stat: '', statLabel: '', statSource: '', listTitle: '', items: ['', '', ''],
    them: ['', '', ''], us: null, quote: '', speaker: '', quoteContext: '',
    // 'meta' keeps the classic styles inside Meta's Reels safe zone (new ads);
    // 'classic' is the original Figma margins. The new styles always use 'meta'.
    safeZone: 'meta',
    // Paused preview: the finished frame while editing ('final'), or the
    // frame at the playhead after play / scrub ('playhead').
    previewAt: 'final',
    suggestion: null, // { style, why, text, alternatives } for this brief
    grid: { on: false, styles: [] }, // Export 3 styles
    align: 'auto', // 'auto' follows the style (see layoutFor); 'left' / 'center' force it
    anchor: 'center',
    scrim: 0.45, blur: 0, zoom: 1, panX: 0, panY: 0, fade: null, vignette: 0,
    // Frame + Tint rail: how the clip sits in the ad (FRAME_DEFAULTS below).
    fit: 'fill', tintId: 'black', tintAmount: 0.45, tintCustom: '#0B2265',
    trimIn: 0, trimOut: 0,
    clip: null, // { name, source: 'upload'|'x', url }
    // Clip step
    clipTab: 'team',
    clipTabPicked: false,
    teamSport: 'cfb',
    team: '', // full team name picked in By team
    teamQuery: '',
    colorSport: 'cfb',
    color: 'red',
    sport: 'all', // trend board filter
    trend: null,
    momentOpen: true, // the trend list (false once a moment is picked: just that one shows)
    trendsStatus: 'loading',
    // What the ad is about (from the last search): grounds the copy.
    context: { kind: '', sport: '', color: '', colorLabel: '', teams: [], trend: null },
    // Copy step
    variants: [], draftsStatus: 'idle', draftsError: '', appliedVariant: -1, copyEdited: false,
    copyColor: '', // optional team colour picked in Copy (feeds the copy, then the clip search)
    copyTrend: null, // optional trending moment picked in Copy
    clipPicked: false, // the clip colour/sport was changed by hand
    aiCopy: null, // the AI version last applied, to learn from edits
    chat: [], chatBusy: false,
    grammar: { status: 'idle', issues: [], error: '' }, // the last AI grammar check
    aiView: 'options', // which Ask AI result shows: options | grammar | chat
    // Export step
    exportIds: ['9x16'], exported: false,
    version: 0,
  };
  let railReady = false; // the Frame + Tint rail is wired up (near the end)
  let previewCopy = null; // a draft shown on hover / focus; never exported

  // ─── Small helpers ───────────────────────────────────────────────────────
  const esc = text => String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const safeUrl = url => (/^https:\/\//i.test(String(url || '')) ? String(url) : '');
  const plain = text => String(text || '').replace(/\*\*/g, '');
  const brand = () => B.byId(state.brandId);
  const size = () => B.SIZES[state.size];
  const hasClip = () => Boolean(els.video.videoWidth);
  const SPORT_LABEL = { nfl: 'NFL', cfb: 'CFB', mlb: 'MLB' };
  const STEPS = ['copy', 'clip', 'export'];
  // League logo tile (league-logos.js); text badge if the helper is missing.
  const leagueTile = (sport, cls = 'va-league') => {
    const l = window.LeagueLogos?.logoFor(sport);
    return l ? `<span class="${cls}" style="--league-bg:${esc(l.bg)}" role="img" aria-label="${esc(SPORT_LABEL[sport] || l.label)}"><img src="${esc(l.src)}" alt=""></span>` : `<span class="va-sport va-sport--${esc(sport)}">${esc(SPORT_LABEL[sport] || '')}</span>`;
  };
  const STEP_LABEL = { clip: 'Clip', copy: 'Copy', export: 'Export' };
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICON = {
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    alert: svg('<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>'),
    external: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
    sparkle: svg('<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>'),
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11.05-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4.2" height="15" rx="1.2"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2"/></svg>',
    x: svg('<path d="M4 4l11.733 16h4.267l-11.733 -16z"/><path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772"/>'),
    search: svg('<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>'),
    undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>'),
    download: svg('<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>'),
    retry: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
    film: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>'),
    link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
    chevron: svg('<path d="m9 18 6-6-6-6"/>'),
    soundOff: svg('<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>'),
    soundOn: svg('<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>'),
  };
  const fmt = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const fmtFine = seconds => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
  const ago = iso => {
    const hours = (Date.now() - new Date(iso).getTime()) / 3600e3;
    if (!iso || !Number.isFinite(hours)) return '';
    return hours < 1 ? 'Just now' : hours < 24 ? `${Math.round(hours)}h ago` : `${Math.round(hours / 24)}d ago`;
  };
  const dots = '<span class="va-dots" aria-hidden="true"><i></i><i></i><i></i></span>';

  function toast(text, { action, tone = '', timeout = 5200 } = {}) {
    const node = document.createElement('div');
    node.className = `va-toast${tone ? ` va-toast--${tone}` : ''}`;
    node.setAttribute('role', tone === 'bad' ? 'alert' : 'status');
    // Good news gets a check whose stroke draws in (es-motion.css).
    node.innerHTML = `${tone === 'good' && window.FrameUpMotion ? window.FrameUpMotion.check() : ''}<span>${esc(text)}</span>`;
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.addEventListener('click', () => { action.fn(); node.remove(); });
      node.append(button);
    }
    els.toasts.append(node);
    while (els.toasts.children.length > 3) els.toasts.firstElementChild.remove();
    setTimeout(() => { node.classList.add('is-leaving'); setTimeout(() => node.remove(), 260); }, timeout);
  }

  function friendlyError(status, data) {
    if (status === 429 || data?.reason === 'limit') return 'You’ve hit this hour’s AI limit. Try again in a little while.';
    if (data?.reason === 'budget') return 'The team’s AI budget is used up for now. Try again later.';
    if (data?.reason === 'off') return 'The AI tools are switched off right now.';
    if (status === 401) return 'Your sign-in expired. Refresh the page and try again.';
    return data?.error || `Something went wrong (${status}). Try again.`;
  }
  async function callApi(body) {
    if (!window.ESAuth?.fetchWithAuth) throw new Error('Sign-in is still loading. Try again in a moment.');
    const response = await window.ESAuth.fetchWithAuth('/api/video-ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.ok === false) {
      const error = new Error(friendlyError(response.status, data));
      error.status = response.status;
      error.reason = data?.reason;
      error.issues = Array.isArray(data?.issues) ? data.issues : [];
      error.data = data;
      throw error;
    }
    return data;
  }

  // Learning events: fire-and-forget, never blocks or surfaces anything.
  // /api/ad-learning stores them so the copy model learns what we ship and fix.
  function logEvent(type, payload = {}) {
    try {
      const fetcher = window.ESAuth?.fetchWithAuth;
      if (!fetcher) return;
      const event = { type, brandId: state.brandId, sport: brand().sport || state.context.sport || '', payload };
      const body = JSON.stringify({ event });
      if (body.length > 18000) return; // the endpoint caps bodies at 20KB
      Promise.resolve()
        .then(() => fetcher('/api/ad-learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }))
        .catch(() => {});
    } catch (error) { /* learning is best-effort */ }
  }
  // What an ad says, for the learning log: the classic fields always, the
  // no-footage style's own fields when it is one.
  const copyForLog = (src = state) => {
    const out = { style: src.style, headline: plain(src.headline), highlight: src.style === 'highlight' ? plain(src.highlight) : '', body: (src.body || []).map(s => plain(s).trim()).filter(Boolean), cta: src.cta || brand().cta };
    if (!S.isNew(src.style)) return out;
    const c = resolvedCopy(src);
    ({
      stat: ['stat', 'statLabel', 'statSource'], today3: ['listTitle', 'items'], versus: ['them', 'us'], quote: ['quote', 'speaker', 'quoteContext'],
    }[src.style] || []).concat('offer').forEach(k => { out[k] = Array.isArray(c[k]) ? c[k].filter(x => String(x).trim()) : String(c[k] || ''); });
    return out;
  };

  // ─── Logos: upload > brand file > drawn wordmark > ES logo ───────────────
  const LOGO_KEY = 'frameup.videoAds.logos.v1';
  const readLogos = () => { try { return JSON.parse(localStorage.getItem(LOGO_KEY) || '{}'); } catch (error) { return {}; } };
  const writeLogos = logos => { try { localStorage.setItem(LOGO_KEY, JSON.stringify(logos)); } catch (error) { /* storage full or blocked: this session only */ } };
  const imageCache = new Map();
  function loadImage(src) {
    if (imageCache.has(src)) return imageCache.get(src);
    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { imageCache.delete(src); reject(new Error('Logo could not load.')); };
      img.src = src;
    });
    imageCache.set(src, promise);
    return promise;
  }
  // A wordmark pill in the brand's colours, in the same face as the ES
  // wordmark files, for a brand whose logo file hasn't landed yet.
  function wordmarkCanvas(mark) {
    const face = `700 132px ${R.CONDENSED}`;
    const padX = 26;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(measure(mark.text, face) + padX * 2);
    canvas.height = 172;
    const c = canvas.getContext('2d');
    c.fillStyle = mark.bg;
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.font = face;
    c.fillStyle = mark.fg;
    c.textBaseline = 'alphabetic';
    c.fillText(mark.text, padX, 142);
    return canvas;
  }
  let logo = { img: null, width: 0, height: 0 };
  let logoToken = 0;
  async function refreshLogo() {
    const token = ++logoToken;
    const b = brand();
    const custom = readLogos()[b.id];
    let img = null;
    let name = '';
    if (custom?.src) { img = await loadImage(custom.src).catch(() => null); name = custom.name; }
    if (!img && b.logo) { img = await loadImage(b.logo).catch(() => null); name = `${b.label} wordmark`; }
    if (!img && b.wordmark) { img = wordmarkCanvas(b.wordmark); name = `${b.label} wordmark (drawn)`; }
    if (!img) { img = await loadImage(B.ES_LOGO.light).catch(() => null); name = 'EssentiallySports'; }
    if (token !== logoToken) return;
    logo = img ? { img, width: img.naturalWidth || img.width || 417, height: img.naturalHeight || img.height || 49 } : { img: null, width: 0, height: 0 };
    relayout();
  }

  // ─── Placeholder background (until a clip lands) ─────────────────────────
  const placeholder = document.createElement('canvas');
  function paintPlaceholder() {
    const b = brand();
    placeholder.width = 540;
    placeholder.height = 960;
    const c = placeholder.getContext('2d');
    const g = c.createLinearGradient(0, 0, 540, 960);
    g.addColorStop(0, b.wordmark?.bg || b.accent);
    g.addColorStop(0.55, '#0b0f17');
    g.addColorStop(1, '#05070b');
    c.fillStyle = g;
    c.fillRect(0, 0, 540, 960);
    const glow = c.createRadialGradient(420, 180, 10, 420, 180, 520);
    glow.addColorStop(0, 'rgba(255,255,255,0.16)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, 540, 960);
    // Faint yard lines, so the empty ad still reads as sport.
    c.strokeStyle = 'rgba(255,255,255,0.06)';
    c.lineWidth = 2;
    for (let y = 60; y < 1100; y += 80) { c.beginPath(); c.moveTo(0, y); c.lineTo(540, y - 120); c.stroke(); }
  }


  // ─── Layout + drawing ────────────────────────────────────────────────────
  const STYLE_KEYS = ['offer', 'stat', 'statLabel', 'statSource', 'listTitle', 'items', 'them', 'us', 'quote', 'speaker', 'quoteContext'];
  const copyOf = (src = state) => ({
    style: src.style, headline: src.headline, highlight: src.highlight, body: [...src.body], cta: src.cta, unsubscribe: src.unsubscribe,
    ...Object.fromEntries(STYLE_KEYS.map(k => [k, Array.isArray(src[k]) ? [...src[k]] : src[k]])),
  });
  // The copy with the style defaults filled in (offer, title, "your feed", claims).
  function resolvedCopy(src = state) {
    const d = S.defaultsFor(brand(), src.style);
    const filled = list => (list || []).map(x => String(x || '').trim()).filter(Boolean);
    return {
      ...src,
      offer: String(src.offer || '').trim() || d.offer,
      listTitle: String(src.listTitle || '').trim() || d.listTitle,
      themLabel: d.themLabel,
      items: filled(src.items),
      them: filled(src.them).length ? filled(src.them) : d.them,
      us: Array.isArray(src.us) ? filled(src.us) : d.us,
    };
  }
  const layoutFor = (sizeId, src = state) => {
    const c = resolvedCopy(src);
    return R.fitLayout(measure, {
      ...c,
      cta: src.cta || brand().cta,
      // As in the Figma ads: Simple and Condensed are centred, Highlight is set flush left.
      align: state.align === 'auto' ? (src.style === 'highlight' ? 'left' : 'center') : state.align,
      anchor: state.anchor,
      safeZone: state.safeZone,
    }, brand(), B.SIZES[sizeId], logo.img ? logo : null);
  };
  // The ad's own clock for the timed entrances: seconds since the trim start.
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const adDuration = () => Math.max(0.5, (state.trimOut - state.trimIn) || (still ? still.duration : 0) || R.STILL.defaultSeconds);
  // Preview only: reduced motion (or editing while paused) shows the finished
  // frame. Exports always run the full timeline.
  function previewClock() {
    if (reducedMotion() || !hasClip()) return {};
    if (!playing && state.previewAt !== 'playhead') return {};
    return { t: Math.max(0, els.video.currentTime - state.trimIn), duration: adDuration() };
  }
  const settlePreview = () => { state.previewAt = 'final'; };
  let current = null;
  // Everything the renderer needs to draw the clip; the preview and the MP4 export both use it.
  const bg = () => ({ scrim: state.scrim, blur: state.blur, zoom: state.zoom, panX: state.panX, panY: state.panY, fit: state.fit, tint: { color: tintColor(), amount: state.tintAmount }, fade: state.fade, vignette: state.vignette });

  // Shows the canvas as large as the stage allows, keeping its shape.
  let metaPreview = false;
  // ─── Meta preview (display only) ──────────────────────────────────
  // 9:16 shows as Reels/Stories (UI over the video, CTA bar at the bottom);
  // 4:5 and 1:1 show as a feed post (profile row above, CTA bar and caption
  // below). Generic icons only: it is a placement check, not a Meta mock-up.
  const META_ICON = {
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
    comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  };
  function renderMeta() {
    const mode = !metaPreview ? 'off' : state.size === '9x16' ? 'reel' : 'feed';
    els.device.dataset.meta = mode;
    if (mode === 'off') { els.metaHead.innerHTML = ''; els.metaOver.innerHTML = ''; els.metaFoot.innerHTML = ''; return; }
    // Ads run from the EssentiallySports page, whichever newsletter they promote.
    const name = 'EssentiallySports';
    const caption = esc(String(state.body?.find(text => String(text || '').trim()) || state.headline || '').replace(/\*\*/g, '').trim());
    const avatar = '<span class="va-meta-avatar"><img src="assets/brand-logos/essentiallysports-mark.svg" alt=""></span>';
    const who = `${avatar}<span class="va-meta-who"><b>${name}</b><small>Sponsored</small></span>`;
    const cta = `<span class="va-meta-cta"><span>Sign up</span>${META_ICON.chevron}</span>`;
    if (mode === 'reel') {
      els.metaHead.innerHTML = '';
      els.metaFoot.innerHTML = '';
      els.metaOver.innerHTML = `
        <div class="va-meta-rail">${['heart', 'comment', 'send', 'more'].map(k => `<span>${META_ICON[k]}</span>`).join('')}</div>
        <div class="va-meta-bottom">
          <div class="va-meta-row">${who}</div>
          <p class="va-meta-caption">${caption}</p>
          ${cta}
        </div>`;
      return;
    }
    els.metaOver.innerHTML = '';
    els.metaHead.innerHTML = `<div class="va-meta-row">${who}<span class="va-meta-more">${META_ICON.more}</span></div>`;
    els.metaFoot.innerHTML = `
      ${cta}
      <div class="va-meta-actions"><span>${META_ICON.heart}${META_ICON.comment}${META_ICON.send}</span>${META_ICON.save}</div>
      <p class="va-meta-caption"><b>${name}</b> ${caption}</p>`;
  }

  // ─── Safe zone overlay (display only) ──────────────────────────────
  // 9:16: Meta's Reels/Stories UI (profile row on top, caption + CTA in the
  // bottom 35%, the action rail on the right). Feed sizes: the copy margins.
  let safeOverlay = false;
  function renderSafe() {
    if (!els.safe) return;
    els.safe.hidden = !safeOverlay;
    els.safeToggle?.setAttribute('aria-pressed', String(safeOverlay));
    if (!safeOverlay) { els.safe.innerHTML = ''; return; }
    const sz = size();
    const z = S.safeZoneRects(sz, 'meta');
    const pct = (v, total) => `${(v / total) * 100}%`;
    const box = (r, cls, label = '') => `<div class="va-safe__area va-safe__area--${cls}" style="left:${pct(r.x, sz.width)};top:${pct(r.y, sz.height)};width:${pct(r.w, sz.width)};height:${pct(r.h, sz.height)}">${label ? `<span>${label}</span>` : ''}</div>`;
    const reel = Boolean(z.rects.rail);
    els.safe.innerHTML = [
      box(z.rects.top, 'top', reel ? 'Profile row' : ''),
      box(z.rects.bottom, 'bottom', reel ? `Caption + CTA · ${Math.round(z.share.bottom * 100)}%` : ''),
      box(z.rects.left, 'side'),
      box(z.rects.right, 'side'),
      reel ? box(z.rects.rail, 'rail', 'Buttons') : '',
      `<div class="va-safe__band" style="top:${pct(z.band.top, sz.height)};height:${pct(z.band.bottom - z.band.top, sz.height)}"><span>${reel ? `Copy band y ${z.band.top}–${z.band.bottom}` : 'Copy area'}</span></div>`,
    ].join('');
  }

  function fitCanvasDisplay() {
    const s = size();
    const cs = getComputedStyle(els.drop);
    const room = { width: els.drop.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), height: els.drop.clientHeight };
    const pad = room.width < 500 ? 24 : 48;
    // A feed post adds the profile row above and the CTA bar, actions and
    // caption below the media; leave room for them.
    const feed = els.device.dataset.meta === 'feed';
    const fitScale = chrome => Math.min((room.width - pad) / s.width, (room.height - pad - chrome) / s.height);
    let scale = fitScale(0);
    if (feed) {
      // Measure the post chrome at the media width, then fit once more.
      els.device.style.width = `${Math.floor(s.width * scale)}px`;
      scale = fitScale(els.metaHead.offsetHeight + els.metaFoot.offsetHeight);
    }
    if (!(scale > 0)) return;
    els.canvas.style.width = `${Math.floor(s.width * scale)}px`;
    els.canvas.style.height = `${Math.floor(s.height * scale)}px`;
    els.device.style.width = feed ? `${Math.floor(s.width * scale)}px` : '';
  }
  if (window.ResizeObserver) new ResizeObserver(fitCanvasDisplay).observe(els.drop);
  else window.addEventListener('resize', fitCanvasDisplay);

  function relayout() {
    const s = size();
    if (els.canvas.width !== s.width || els.canvas.height !== s.height) {
      els.canvas.width = s.width;
      els.canvas.height = s.height;
    }
    els.drop.dataset.size = state.size;
    renderMeta();
    fitCanvasDisplay();
    current = layoutFor(state.size, previewCopy ? { ...state, ...previewCopy } : state);
    // A no-footage style without its facts says what it needs, not "too long".
    const need = S.isNew(state.style) ? S.styleReady(state.style, resolvedCopy(previewCopy ? { ...state, ...previewCopy } : state)) : { ok: true };
    els.fit.textContent = !need.ok ? `${B.STYLES[state.style].label} needs ${need.missing}` : !current.fits ? 'Too much copy for this size' : current.scale < 0.72 ? 'Long copy: set smaller' : '';
    els.fit.classList.toggle('is-on', !need.ok || !current.fits || current.scale < 0.72);
    els.fit.classList.toggle('is-bad', !current.fits);
    els.highlightRow.hidden = state.style !== 'highlight';
    renderSafe();
    if (els.styles.childElementCount) { syncStyles(); renderThumbs(); }
    const lit = state.highlight.trim();
    els.highlightWarn.hidden = !lit || state.headline.toLowerCase().includes(lit.toLowerCase());
    els.highlight.setAttribute('aria-invalid', String(!els.highlightWarn.hidden));
    renderCounts();
    draw();
  }

  let glowAt = 0;
  const glowCtx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  function sampleGlow() {
    const now = performance.now();
    if (now - glowAt < 400) return;
    glowAt = now;
    try {
      glowCtx.drawImage(els.canvas, 0, 0, 1, 1);
      const [r, g, b] = glowCtx.getImageData(0, 0, 1, 1).data;
      // Lift dark frames so the glow still shows; keep the hue.
      const lift = Math.max(1, 110 / Math.max(1, r, g, b));
      els.stage.style.setProperty('--va-glow', `${Math.min(255, r * lift) | 0} ${Math.min(255, g * lift) | 0} ${Math.min(255, b * lift) | 0}`);
    } catch (error) { /* keep the last glow */ }
  }

  function draw() {
    if (!current) return;
    const s = size();
    R.drawFrame(ctx, { width: s.width, height: s.height, video: hasClip() ? els.video : placeholder, bg: bg(), ops: current.ops, logoImage: logo.img, blurCanvas, source: still ? still.source() : undefined, ...previewClock() });
    sampleGlow();
  }

  // ─── Playback + timeline ─────────────────────────────────────────────────
  let playing = false;
  function frameLoop() {
    if (!playing) return;
    if (els.video.currentTime >= state.trimOut - 0.03) els.video.currentTime = state.trimIn;
    draw();
    syncTime();
    if (els.video.requestVideoFrameCallback) els.video.requestVideoFrameCallback(frameLoop);
    else requestAnimationFrame(frameLoop);
  }
  function setPlaying(on) {
    playing = on && hasClip();
    if (playing) state.previewAt = 'playhead';
    if (playing) {
      if (els.video.currentTime < state.trimIn || els.video.currentTime >= state.trimOut) els.video.currentTime = state.trimIn;
      els.video.play().catch(() => { playing = false; renderPlay(); });
      frameLoop();
    } else {
      els.video.pause();
      draw();
    }
    renderPlay();
  }
  function renderPlay() {
    els.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    els.play.title = playing ? 'Pause (Space)' : 'Play (Space)';
    els.play.innerHTML = playing ? ICON.pause : ICON.play;
    els.stage.classList.toggle('is-playing', playing);
  }
  const clipDuration = () => (Number.isFinite(els.video.duration) ? els.video.duration : 0);
  const pct = t => { const d = clipDuration(); return d ? `${Math.max(0, Math.min(100, (t / d) * 100))}%` : '0%'; };
  function syncTime() {
    const d = clipDuration();
    const t = els.video.currentTime || 0;
    els.time.textContent = d ? `${fmtFine(t)} / ${fmt(d)}` : '0:00.0';
    if (d) els.seek.value = String(Math.round((t / d) * 1000));
    els.head.style.left = pct(t);
  }
  function syncTrim() {
    const d = clipDuration();
    const right = d ? `${100 - (state.trimOut / d) * 100}%` : '0%';
    els.sel.style.left = pct(state.trimIn);
    els.sel.style.right = right;
    els.dimL.style.width = pct(state.trimIn);
    els.dimR.style.width = right;
    els.trimIn.style.left = pct(state.trimIn);
    els.trimOut.style.left = pct(state.trimOut);
    [[els.trimIn, state.trimIn], [els.trimOut, state.trimOut]].forEach(([handle, value]) => {
      handle.setAttribute('aria-valuemax', d.toFixed(1));
      handle.setAttribute('aria-valuenow', value.toFixed(1));
      handle.setAttribute('aria-valuetext', `${value.toFixed(1)} seconds`);
    });
    const span = Math.max(0, state.trimOut - state.trimIn);
    els.trimText.textContent = d ? `Ad ${span.toFixed(1)}s · ${fmtFine(state.trimIn)} → ${fmtFine(state.trimOut)}` : 'Add a clip to trim it';
  }
  function setTrim(inT, outT, { seekTo: seekTarget } = {}) {
    const d = clipDuration();
    if (!d) return;
    const gap = Math.min(0.5, d);
    const a = Math.max(0, Math.min(inT, d - gap));
    const b = Math.max(a + gap, Math.min(outT, d));
    state.trimIn = Math.round(a * 10) / 10;
    state.trimOut = Math.round(Math.min(b, d) * 10) / 10;
    syncTrim();
    if (seekTarget != null) { state.previewAt = 'playhead'; els.video.currentTime = Math.max(0, Math.min(d, seekTarget)); }
    changed();
  }
  const timeAt = clientX => {
    const rect = els.track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * clipDuration();
  };
  [[els.trimIn, 'in'], [els.trimOut, 'out']].forEach(([handle, which]) => {
    handle.addEventListener('pointerdown', event => {
      if (handle.disabled) return;
      event.preventDefault();
      try { handle.setPointerCapture(event.pointerId); } catch {}
      handle.classList.add('is-drag');
      setPlaying(false);
      const move = e => {
        const t = timeAt(e.clientX);
        if (which === 'in') setTrim(t, state.trimOut, { seekTo: Math.min(t, state.trimOut - 0.5) });
        else setTrim(state.trimIn, t, { seekTo: Math.max(t - 0.05, state.trimIn) });
      };
      const up = () => { handle.classList.remove('is-drag'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
      handle.focus({ preventScroll: true });
    });
    handle.addEventListener('keydown', event => {
      const stepBy = event.shiftKey ? 1 : 0.1;
      const d = clipDuration();
      const value = which === 'in' ? state.trimIn : state.trimOut;
      let next = null;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = value - stepBy;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = value + stepBy;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = d;
      if (next == null) return;
      event.preventDefault();
      if (which === 'in') setTrim(next, state.trimOut, { seekTo: next });
      else setTrim(state.trimIn, next, { seekTo: Math.max(state.trimIn, Math.min(next, d) - 0.05) });
    });
  });
  els.seek.addEventListener('input', () => {
    state.previewAt = 'playhead';
    const d = clipDuration();
    els.video.currentTime = (Number(els.seek.value) / 1000) * d;
    syncTime();
  });

  // Filmstrip under the timeline: a second, silent video element seeks through
  // the same blob, so the preview never jumps.
  let stripToken = 0;
  async function buildFilmstrip(url, dur) {
    const token = ++stripToken;
    const rect = els.track.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(120, Math.round(rect.width * dpr));
    const H = Math.max(24, Math.round(rect.height * dpr));
    els.strip.width = W;
    els.strip.height = H;
    const c = els.strip.getContext('2d');
    c.clearRect(0, 0, W, H);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    const once = (type, ms = 2500) => new Promise(resolve => { const t = setTimeout(resolve, ms); v.addEventListener(type, () => { clearTimeout(t); resolve(); }, { once: true }); });
    await once('loadeddata', 4000);
    if (token !== stripToken || !v.videoWidth || !(dur > 0)) return;
    const tileW = Math.max(16, Math.round(H * Math.min(1.8, v.videoWidth / v.videoHeight)));
    const n = Math.ceil(W / tileW);
    for (let i = 0; i < n; i += 1) {
      v.currentTime = Math.min(dur - 0.05, ((i + 0.5) / n) * dur);
      await once('seeked');
      if (token !== stripToken) return;
      const scale = Math.max(tileW / v.videoWidth, H / v.videoHeight);
      const dw = v.videoWidth * scale;
      const dh = v.videoHeight * scale;
      c.save();
      c.beginPath();
      c.rect(i * tileW, 0, tileW, H);
      c.clip();
      c.drawImage(v, i * tileW + (tileW - dw) / 2, (H - dh) / 2, dw, dh);
      c.restore();
    }
    els.strip.classList.add('is-ready');
    v.removeAttribute('src');
    v.load();
  }


  // ─── Clip in ─────────────────────────────────────────────────────────────
  let clipUrl = '';
  function useClip(blob, meta) {
    setPlaying(false);
    dropStill();
    if (clipUrl) URL.revokeObjectURL(clipUrl);
    clipUrl = URL.createObjectURL(blob);
    state.clip = meta;
    els.strip.classList.remove('is-ready');
    els.video.src = clipUrl;
    els.video.load();
  }
  // ─── No clip: animated background or photo (StillClip) ───────────────────
  // A media clock with the parts of the <video> API the editor uses (play,
  // pause, currentTime, duration, seeked / timeupdate / ended), so preview,
  // trim and export work unchanged. Frames come from the renderer's
  // background sources (video-ads-render.js): 'animated' = generated
  // gradient, 'photo' = Ken Burns over the still.
  let stillSeconds = R.STILL.defaultSeconds;
  let grain = null;
  function grainTile() {
    if (grain) return grain;
    grain = document.createElement('canvas');
    grain.width = 128;
    grain.height = 128;
    const g = grain.getContext('2d');
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return grain;
  }
  class StillClip extends EventTarget {
    constructor(kind, { image = null, colors = [], duration = R.STILL.defaultSeconds } = {}) {
      super();
      this.kind = kind;
      this.image = image;
      this.colors = colors;
      this.duration = duration;
      this.paused = true;
      this.ended = false;
      this.muted = true;
      this.t0 = 0;
      this.at = 0;
      this.timer = 0;
    }
    get videoWidth() { return this.kind === 'photo' ? (this.image?.naturalWidth || this.image?.width || 0) : 1080; }
    get videoHeight() { return this.kind === 'photo' ? (this.image?.naturalHeight || this.image?.height || 0) : 1920; }
    get currentTime() { return this.paused ? this.t0 : Math.min(this.duration, this.t0 + (performance.now() - this.at) / 1000); }
    set currentTime(value) {
      this.t0 = Math.max(0, Math.min(this.duration, Number(value) || 0));
      this.at = performance.now();
      this.ended = false;
      setTimeout(() => { this.dispatchEvent(new Event('seeked')); this.dispatchEvent(new Event('timeupdate')); }, 0);
    }
    play() {
      if (this.t0 >= this.duration) this.t0 = 0;
      this.at = performance.now();
      this.paused = false;
      this.ended = false;
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), 100);
      return Promise.resolve();
    }
    tick() {
      this.dispatchEvent(new Event('timeupdate'));
      if (this.paused || this.currentTime < this.duration) return;
      this.t0 = this.duration;
      this.paused = true;
      this.ended = true;
      clearInterval(this.timer);
      this.dispatchEvent(new Event('ended'));
    }
    pause() {
      if (!this.paused) this.t0 = this.currentTime;
      this.paused = true;
      clearInterval(this.timer);
    }
    load() { setTimeout(() => this.dispatchEvent(new Event('loadedmetadata')), 0); }
    getAttribute() { return null; }
    source() {
      const t = this.currentTime;
      return this.kind === 'photo'
        ? { kind: 'image', image: this.image, t, duration: this.duration }
        : { kind: 'generated', colors: this.colors, t, duration: this.duration, grain: grainTile() };
    }
  }
  function dropStill() {
    if (!still) return;
    still.pause();
    still = null;
    renderNoClip();
  }
  // The team's two colours, else the colour searched, else the newsletter's.
  function stillColors() {
    const sport = state.context?.sport || brand().sport;
    const name = state.context?.teams?.[0];
    const team = name && typeof T.findTeam === 'function' ? (T.findTeam(name, sport) || T.findTeam(name)) : null;
    if (team?.colors?.length) return team.colors.slice(0, 2);
    const color = state.context?.color ? colorById(state.context.color) : null;
    if (color?.hex) return [color.hex, brand().accent];
    return [brand().wordmark?.bg || brand().accent, brand().highlight?.bg || brand().accent];
  }
  function stillWhat() {
    const name = state.context?.teams?.[0];
    if (name) return `${(T.findTeam?.(name) || {}).short || name} colours`;
    if (state.context?.color) return `${String(state.context.colorLabel || '').toLowerCase()} tones`;
    return `${brand().label} colours`;
  }
  function useStill(kind, { image = null, name = '' } = {}) {
    setPlaying(false);
    realVideo.pause();
    if (still) still.pause();
    still = new StillClip(kind, { image, colors: stillColors(), duration: stillSeconds });
    mediaHandlers.forEach(([type, fn]) => still.addEventListener(type, fn));
    state.clip = { name: name || (kind === 'animated' ? 'Animated background' : 'Photo'), source: kind === 'animated' ? 'animated' : 'photo' };
    els.strip.classList.remove('is-ready');
    setClipStatus(kind === 'animated'
      ? `Animated background in ${stillWhat()}, ${stillSeconds} s. It loops cleanly.`
      : `Photo with a slow zoom, ${stillSeconds} s. Check you may use it before publishing.`);
    still.load();
    renderNoClip();
  }
  // Photo: any still the browser can read; it stays on this device.
  const photoInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', hidden: true });
  photoInput.id = 'va-photo-file';
  document.body.append(photoInput);
  let photoUrl = '';
  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    photoInput.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('Choose an image (JPG, PNG or WebP).', { tone: 'bad' }); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      photoUrl = url;
      useStill('photo', { image: img, name: file.name });
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('That image could not be read. Try a JPG or PNG.', { tone: 'bad' }); };
    img.src = url;
  });
  // Filmstrip for a still source: frames drawn by the renderer.
  function buildStillStrip(dur) {
    const token = ++stripToken;
    const rect = els.track.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(120, Math.round(rect.width * dpr));
    const H = Math.max(24, Math.round(rect.height * dpr));
    els.strip.width = W;
    els.strip.height = H;
    const c = els.strip.getContext('2d');
    c.clearRect(0, 0, W, H);
    if (!still) return;
    const ratio = still.kind === 'photo' && still.videoHeight ? Math.min(1.8, still.videoWidth / still.videoHeight) : 0.5625;
    const tileW = Math.max(16, Math.round(H * ratio));
    const n = Math.ceil(W / tileW);
    const base = still.source();
    for (let i = 0; i < n; i += 1) {
      if (token !== stripToken) return;
      c.save();
      c.beginPath();
      c.rect(i * tileW, 0, tileW, H);
      c.clip();
      c.translate(i * tileW, 0);
      R.drawFrame(c, { width: tileW, height: H, video: null, bg: { scrim: 0 }, ops: [], source: { ...base, t: ((i + 0.5) / n) * dur, grain: null } });
      c.restore();
    }
    els.strip.classList.add('is-ready');
  }

  // "Make it without a clip": first-class choices in every empty clip state,
  // and on the Link tab (compact: only the two no-footage options).
  const NOCLIP_ICON = {
    photo: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
    upload: svg('<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>'),
  };
  function noClipBlock({ compact = false } = {}) {
    const [a, b] = stillColors().map(c => (/^#[0-9a-f]{6}$/i.test(String(c)) ? c : '#0A2342'));
    const on = kind => (still && still.kind === kind ? ' aria-pressed="true"' : ' aria-pressed="false"');
    const card = (act, art, name, desc, extra = '') => `<button class="va-make__card" type="button" data-act="${act}"${extra}>${art}<span class="va-make__name">${name}</span><span class="va-make__desc">${desc}</span></button>`;
    const cards = [
      card('make-animated', `<span class="va-make__art va-make__art--anim" style="--a:${esc(a)};--b:${esc(b)}" aria-hidden="true"></span>`, 'Animated background', `${esc(stillWhat())}, slow light. Loops.`, on('animated')),
      card('make-photo', `<span class="va-make__art" aria-hidden="true">${NOCLIP_ICON.photo}</span>`, 'Photo, slow zoom', 'Upload a still; it pushes in.', on('photo')),
      ...(compact ? [] : [
        card('make-upload', `<span class="va-make__art" aria-hidden="true">${NOCLIP_ICON.upload}</span>`, 'Upload a video', 'MP4 works best.'),
        card('to-link', `<span class="va-make__art" aria-hidden="true">${ICON.link}</span>`, 'Paste an X link', 'Any public post.'),
      ]),
    ].join('');
    const lens = [5, 8, 10, 15].map(n => `<button class="va-chip" type="button" data-act="still-len" data-len="${n}" aria-pressed="${n === stillSeconds}">${n} s</button>`).join('');
    return `<div class="va-make${compact ? ' va-make--compact' : ''}" role="group" aria-label="Make it without a clip">
      <p class="va-make__title">${compact ? 'No video? Make it without a clip' : 'Make it without a clip'}</p>
      <div class="va-make__grid">${cards}</div>
      <div class="va-make__len" role="group" aria-label="Length without a clip"><span class="va-hint">Length</span>${lens}</div>
    </div>`;
  }
  // Handles a no-clip action from any empty state. True when handled.
  function noClipAct(event) {
    const el = event.target.closest('[data-act]');
    const act = el?.dataset.act;
    if (act === 'make-animated') { useStill('animated'); return true; }
    if (act === 'make-photo') { photoInput.click(); return true; }
    if (act === 'make-upload') { els.file.click(); return true; }
    if (act === 'still-len') {
      stillSeconds = Math.max(R.STILL.minSeconds, Math.min(R.STILL.maxSeconds, Number(el.dataset.len) || R.STILL.defaultSeconds));
      if (still) useStill(still.kind, { image: still.image, name: still.kind === 'photo' ? state.clip?.name : '' });
      else renderNoClip();
      return true;
    }
    return false;
  }
  // Keeps every visible no-clip block in step (selected card, length).
  function renderNoClip() {
    const box = document.getElementById('va-noclip-link');
    if (box) box.innerHTML = noClipBlock({ compact: true });
    document.querySelectorAll('.va-make:not(.va-make--compact)').forEach(block => {
      block.querySelectorAll('[data-act="still-len"]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.len) === stillSeconds)));
      ['animated', 'photo'].forEach(kind => block.querySelector(`[data-act="make-${kind}"]`)?.setAttribute('aria-pressed', String(Boolean(still && still.kind === kind))));
    });
  }

  // Recorded WebM files often report an Infinity duration until the end is
  // seeked once; resolve the real length before setting up the trim.
  function finiteDuration(video) {
    if (Number.isFinite(video.duration)) return Promise.resolve(video.duration);
    return new Promise(resolve => {
      const done = () => { video.removeEventListener('durationchange', check); clearTimeout(timer); video.currentTime = 0; resolve(Number.isFinite(video.duration) ? video.duration : 0); };
      const check = () => { if (Number.isFinite(video.duration)) done(); };
      const timer = setTimeout(done, 3000);
      video.addEventListener('durationchange', check);
      video.currentTime = 1e7;
    });
  }
  onMedia('loadedmetadata', async () => {
    const d = await finiteDuration(els.video);
    if (!d) { setClipStatus('That video has no readable length. Try an MP4 (H.264).'); return; }
    state.trimIn = 0;
    state.trimOut = Math.min(Math.floor(d * 10) / 10, 30);
    [els.trimIn, els.trimOut, els.play, els.mute, els.seek].forEach(el => { el.disabled = false; });
    els.stage.classList.add('has-clip');
    els.empty.hidden = true;
    syncTrim();
    syncTime();
    // Seeking to exactly 0 can skip the first-frame event in some browsers.
    els.video.currentTime = Math.min(0.03, d);
    if (still) buildStillStrip(d);
    else buildFilmstrip(clipUrl, d);
    changed();
    renderFound();
    renderNoClip();
    if (state.clip) toast(still ? (still.kind === 'animated' ? 'Animated background ready' : 'Photo ready') : 'Clip ready', state.step === 'clip' ? { tone: 'good', action: { label: 'Next: Copy', fn: () => goStep('copy') } } : { tone: 'good' });
  });
  onMedia('seeked', () => { draw(); syncTime(); });
  realVideo.addEventListener('error', () => { if (!still && realVideo.getAttribute('src')) setClipStatus('That video could not be played. Try an MP4 (H.264).'); });
  const setClipStatus = text => { els.clipStatus.textContent = text; };

  function takeFile(file) {
    if (!file) return;
    if (!/^video\//.test(file.type)) { setClipStatus('Choose a video file (MP4 works best).'); toast('That isn’t a video file.', { tone: 'bad' }); return; }
    useClip(file, { name: file.name, source: 'upload' });
    setClipStatus(`Using ${file.name}`);
  }
  els.upload.addEventListener('click', () => els.file.click());
  $('va-empty-upload').addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', () => { takeFile(els.file.files?.[0]); els.file.value = ''; });
  [els.drop, $('va-dropbox')].forEach(zone => {
    ['dragenter', 'dragover'].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.add('is-drop'); }));
    ['dragleave', 'drop'].forEach(type => zone.addEventListener(type, event => { if (type === 'drop' || !zone.contains(event.relatedTarget)) zone.classList.remove('is-drop'); }));
    zone.addEventListener('drop', event => {
      event.preventDefault();
      const files = [...(event.dataTransfer?.files || [])];
      takeFile(files.find(f => /^video\//.test(f.type)) || files[0]);
    });
  });

  function setBusy(on, text = '', fraction = null) {
    els.busy.hidden = !on;
    if (!on) return;
    els.busyText.textContent = text;
    const circ = 2 * Math.PI * 19;
    els.busyArc.style.strokeDasharray = `${circ}`;
    els.busyArc.style.strokeDashoffset = fraction == null ? `${circ * 0.72}` : `${circ * (1 - fraction)}`;
    els.busy.classList.toggle('is-indeterminate', fraction == null);
    els.busyPct.textContent = fraction == null ? '' : `${Math.round(fraction * 100)}%`;
  }

  // Downloads a clip straight from X's video host into the browser (no server
  // in between), with progress on the preview.
  let loadingClip = '';
  async function downloadClip(variant, meta) {
    if (!variant?.url) { toast('That clip has no video file. Try another one.', { tone: 'bad' }); return; }
    loadingClip = meta.url || variant.url;
    renderFound();
    setBusy(true, 'Downloading the clip…', 0);
    setClipStatus('');
    let status = 0;
    try {
      // X's video host refuses requests that carry a Referer from our site (403),
      // so send none; no cookies either.
      const response = await fetch(variant.url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
      status = response.status;
      if (!response.ok || !response.body) throw new Error(`download failed (${response.status})`);
      const total = Number(response.headers.get('content-length') || 0);
      const reader = response.body.getReader();
      const parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        setBusy(true, 'Downloading the clip…', total ? got / total : null);
      }
      const who = meta.handle ? `@${String(meta.handle).replace(/^@/, '')}` : 'X';
      useClip(new Blob(parts, { type: 'video/mp4' }), { name: `X post by ${who}`, source: meta.from === 'search' ? 'search' : 'x', url: meta.url || '' });
      setClipStatus(`Clip from ${who}. Check you may use it before publishing.`);
    } catch (error) {
      logEvent('clip_failed', { height: Number(variant.height) || 0, status, post: safeUrl(meta.url) });
      setClipStatus('Couldn’t download that clip. Try another one, or save it from the post and upload it.');
      toast('Couldn’t download that clip. Try another one.', { tone: 'bad' });
    } finally {
      loadingClip = '';
      setBusy(false);
      renderFound();
    }
  }
  // The largest version up to 1280px on the long edge (fast, sharp enough at 1080 wide).
  const longEdge = v => Math.max(Number(v?.width) || 0, Number(v?.height) || 0);
  function bestVariant(variants) {
    const list = (variants || []).filter(v => v && v.url);
    if (!list.length) return null;
    const sized = list.filter(v => longEdge(v) > 0).sort((a, b) => longEdge(b) - longEdge(a));
    return sized.find(v => longEdge(v) <= 1280) || sized[sized.length - 1] || list[0];
  }

  async function loadXPost(url, button) {
    if (button) button.disabled = true;
    setClipStatus('Finding the video in that post…');
    els.qualities.hidden = true;
    try {
      const data = await callApi({ mode: 'clip', url });
      const best = bestVariant(data.variants);
      els.qualities.innerHTML = `<span class="va-hint">Quality</span>${data.variants.slice(0, 4).map((v, i) => `<button class="va-chip" type="button" data-q="${i}" aria-pressed="${v === best}">${v.height ? `${v.height}p` : `Version ${i + 1}`}</button>`).join('')}`;
      els.qualities.hidden = data.variants.length < 2;
      els.qualities.onclick = e => {
        const chip = e.target.closest('[data-q]');
        if (!chip) return;
        [...els.qualities.querySelectorAll('[data-q]')].forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
        downloadClip(data.variants[Number(chip.dataset.q)], data);
      };
      await downloadClip(best, data);
    } catch (error) {
      setClipStatus(error.message);
      toast(error.message, { tone: 'bad' });
    } finally {
      if (button) button.disabled = false;
    }
  }
  els.xform.addEventListener('submit', event => {
    event.preventDefault();
    const url = els.xurl.value.trim();
    if (!url) { els.xurl.focus(); setClipStatus('Paste a link to an X post first.'); return; }
    loadXPost(url, els.xget);
  });

  // ─── Steps ───────────────────────────────────────────────────────────────
  const stepButtons = [...els.steps.querySelectorAll('.va-step')];
  function stepDone(id) {
    if (id === 'clip') return hasClip();
    if (id === 'copy') return state.appliedVariant >= 0 || state.copyEdited;
    if (id === 'export') return state.exported;
    return false;
  }
  function stepSub(id) {
    if (id === 'clip') {
      if (hasClip()) return { upload: 'Your upload', animated: 'Animated background', photo: 'Photo, slow zoom' }[state.clip?.source] || 'Clip in';
      const f = finds[state.clipTab];
      return f?.status === 'loading' ? 'Searching…' : 'Find a video';
    }
    if (id === 'copy') {
      if (state.draftsStatus === 'loading') return 'Writing…';
      const need = S.isNew(state.style) ? S.styleReady(state.style, resolvedCopy()) : { ok: true };
      if (!need.ok) return `Needs ${need.missing}`;
      if (current && !current.fits) return 'Too long';
      return stepDone('copy') ? (B.STYLES[state.style]?.label || 'Done') : 'Write the words';
    }
    if (id === 'export') return state.exported ? 'Exported' : `${state.exportIds.length} size${state.exportIds.length === 1 ? '' : 's'} · MP4`;
    return '';
  }
  function renderSteps() {
    renderTint();
    stepButtons.forEach(button => {
      const id = button.dataset.step;
      if (id === state.step) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
      const done = stepDone(id);
      button.dataset.state = done ? 'done' : '';
      button.classList.toggle('is-busy', (id === 'clip' && (finds[state.clipTab]?.status === 'loading' || Boolean(loadingClip))) || (id === 'copy' && (state.draftsStatus === 'loading' || state.chatBusy)));
      const sub = button.querySelector('.va-step__sub');
      sub.textContent = stepSub(id);
      button.setAttribute('aria-label', `Step ${STEPS.indexOf(id) + 1}, ${STEP_LABEL[id]}: ${sub.textContent}${done ? ' (done)' : ''}`);
    });
    const i = STEPS.indexOf(state.step);
    stepButtons.forEach(b => b.closest('li').classList.toggle('is-done', stepDone(b.dataset.step)));
    els.stepsN.textContent = String(i + 1);
    els.stepsName.textContent = STEP_LABEL[state.step];
    els.stepsBar.style.width = `${((i + 1) / STEPS.length) * 100}%`;
    els.back.hidden = i === 0;
    els.next.hidden = i === STEPS.length - 1;
    if (i < STEPS.length - 1) els.nextText.textContent = `Next: ${STEP_LABEL[STEPS[i + 1]]}`;
    // The footer's Next is the primary action once this step is done.
    els.next.classList.toggle('es-btn--primary', stepDone(state.step));
  }
  function goStep(id, { focus = true } = {}) {
    if (!STEPS.includes(id)) return;
    const changedStep = id !== state.step;
    state.step = id;
    document.querySelectorAll('.va-pane').forEach(pane => { pane.hidden = pane.dataset.pane !== id; });
    els.panelScroll.scrollTop = 0;
    if (changedStep && window.matchMedia('(max-width: 900px)').matches) reveal($('va-panel'));
    renderSteps();
    if (id === 'clip') {
      // By colour starts from the Copy choices until changed by hand.
      if (!state.clipPicked) {
        state.colorSport = brand().sport || state.colorSport;
        state.teamSport = state.colorSport;
        if (state.copyColor) state.color = state.copyColor;
        markRadios(els.colorSport, 'sport', state.colorSport);
        markRadios(els.teamSport, 'sport', state.teamSport);
      }
      if (!state.clipTabPicked) selectClipTab(clipTab(state.copyColor ? 'color' : 'team'));
      renderTeamPicker();
      renderSwatches();
      renderFound();
    }
    if (id === 'copy') renderCopy();
    if (id === 'export') renderExport();
    if (focus && changedStep) document.getElementById(`va-h-${id}`)?.focus({ preventScroll: true });
  }
  els.steps.addEventListener('click', event => {
    const button = event.target.closest('.va-step');
    if (button) goStep(button.dataset.step);
  });
  els.back.addEventListener('click', () => goStep(STEPS[Math.max(0, STEPS.indexOf(state.step) - 1)]));
  els.next.addEventListener('click', () => goStep(STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(state.step) + 1)]));

  // Scrolls something into view inside the panel (desktop), or the page (phones).
  function reveal(el) {
    const sc = els.panelScroll;
    if (getComputedStyle(sc).overflowY === 'visible') {
      // Phones: the preview is sticky above the panel, so land just below it.
      const below = Math.max(0, els.stage.getBoundingClientRect().bottom);
      window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - below - 12), behavior: 'smooth' });
      return;
    }
    const top = sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 16;
    sc.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  // Anything that changes the ad.
  function changed() {
    state.version += 1;
    state.exported = false;
    renderSteps();
    if (state.step === 'export') renderExport();
  }

  // ─── 1 Clip ──────────────────────────────────────────────────────────────
  // Tabs: By colour / By moment / Link or upload.
  const clipTabs = [...els.clipTabs.querySelectorAll('[role="tab"]')];
  function selectClipTab(tab, focus) {
    clipTabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    });
    state.clipTab = tab.dataset.tab;
    if (focus) tab.focus();
    if (state.clipTab === 'team') renderTeamPicker();
    if (state.clipTab === 'moment') loadFreshMoments();
    renderFound();
    renderSteps();
  }
  const clipTab = name => clipTabs.find(t => t.dataset.tab === name);
  els.clipTabs.addEventListener('click', event => { const tab = event.target.closest('[role="tab"]'); if (tab) { state.clipTabPicked = true; selectClipTab(tab); } });
  els.clipTabs.addEventListener('keydown', event => {
    const i = clipTabs.indexOf(document.activeElement);
    if (i < 0) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); selectClipTab(clipTabs[(i + 1) % clipTabs.length], true); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); selectClipTab(clipTabs[(i - 1 + clipTabs.length) % clipTabs.length], true); }
  });

  // Colour picker: sport above, swatches below, then Find clips.
  const colorById = id => T.COLORS.find(c => c.id === id) || T.COLORS[0];
  const teamsFor = (sport, color) => { try { return T.teamsFor({ sport, color }) || []; } catch (error) { return []; } };
  const availableColors = sport => (hasTeamData ? T.COLORS.filter(c => teamsFor(sport, c.id).length) : T.COLORS);
  const swatchTeams = document.createElement('p');
  swatchTeams.className = 'va-hint va-swatch-teams';
  els.swatches.after(swatchTeams);
  function renderSwatches() {
    const colors = availableColors(state.colorSport);
    if (!colors.some(c => c.id === state.color)) state.color = colors[0]?.id || '';
    els.swatches.innerHTML = colors.map(c => {
      const on = c.id === state.color;
      return `<button class="va-swatch" type="button" role="radio" data-color="${esc(c.id)}" aria-checked="${on}" tabindex="${on ? 0 : -1}" style="--sw:${esc(c.hex)}"><span class="va-swatch__dot" aria-hidden="true"></span><span class="va-swatch__label">${esc(c.label)}</span></button>`;
    }).join('');
    const teams = teamsFor(state.colorSport, state.color);
    swatchTeams.innerHTML = teams.length ? `${teams.slice(0, 3).map(t => `<span class="va-swatch-team" title="${esc(t.name)}">${teamMark(t, 20)}<span>${esc(t.short || t.name)}</span></span>`).join('')}${teams.length > 3 ? `<span class="va-swatch-team va-swatch-team--more">+${teams.length - 3} more</span>` : ''}` : '';
    swatchTeams.hidden = !teams.length;
    renderFindButton();
  }
  const colorKey = () => JSON.stringify({ sport: state.colorSport, color: state.color });
  function renderFindButton() {
    const f = finds.color;
    // Once this exact search has results, the clips are the next action.
    const fresh = f && f.key === colorKey() && f.status !== 'error';
    const same = f && f.key === colorKey();
    els.find.classList.toggle('es-btn--primary', !same);
    // The result chips already name the teams.
    swatchTeams.hidden = Boolean(same) || !swatchTeams.textContent;
    els.find.disabled = f?.status === 'loading' || !state.color;
    els.findText.textContent = f?.status === 'loading' ? 'Finding clips…' : fresh ? 'Search again' : 'Find clips';
    els.find.toggleAttribute('aria-busy', f?.status === 'loading');
  }

  // Searches: one per tab, so switching tabs keeps each tab's results.
  const finds = { team: null, color: null, moment: null };
  const findTokens = { team: 0, color: 0, moment: 0 };
  async function findClips(kind, params, { label = '', teams: previewTeams = [] } = {}) {
    const key = kind === 'color' ? colorKey() : kind === 'team' ? teamKey() : JSON.stringify(params);
    const token = ++findTokens[kind];
    finds[kind] = { key, status: 'loading', teams: previewTeams, clips: [], error: '', label, params };
    // The search is what the ad is about: it grounds the copy.
    const color = kind === 'color' ? colorById(params.color) : null;
    state.context = {
      kind,
      sport: params.sport || '',
      color: color?.id || '',
      colorLabel: color?.label || '',
      teams: previewTeams.map(t => t.name).filter(Boolean),
      trend: kind === 'moment' ? state.trend : null,
    };
    renderFound();
    renderSteps();
    if (kind === 'color') renderFindButton();
    if (kind === 'team') renderTeamFind();
    try {
      const data = await callApi({ mode: 'find-clips', ...params });
      if (token !== findTokens[kind]) return;
      const clips = (Array.isArray(data.clips) ? data.clips : []).filter(c => c && Array.isArray(c.variants) && c.variants.some(v => v && v.url));
      const teams = Array.isArray(data.teams) && data.teams.length ? data.teams : previewTeams;
      finds[kind] = { ...finds[kind], status: clips.length ? 'done' : 'empty', clips, teams, cached: Boolean(data.cached), note: typeof data.note === 'string' ? data.note : '' };
      if (state.context.kind === kind) state.context.teams = teams.map(t => t.name).filter(Boolean);
    } catch (error) {
      if (token !== findTokens[kind]) return;
      finds[kind] = { ...finds[kind], status: 'error', error: error.message };
    }
    renderFound();
    renderSteps();
    if (kind === 'color') renderFindButton();
    if (kind === 'team') renderTeamFind();
    if (state.clipTab === kind && finds[kind]?.status !== 'loading') reveal(els.found);
  }
  function findByColor() {
    if (!state.color) return;
    findClips('color', { sport: state.colorSport, color: state.color }, { label: colorById(state.color).label, teams: teamsFor(state.colorSport, state.color) });
  }
  els.find.addEventListener('click', findByColor);

  // Team mark: the team logo (hot-linked, see video-ads-teams.js) in a fixed
  // square white tile, so layout never shifts and dark logos stay visible in
  // dark mode. Teams from the server may lack the logo field, so look it up by
  // name. No logo, or one that fails to load: the two-colour dot instead.
  const teamColors = t => {
    const c = (Array.isArray(t.colors) ? t.colors : []).filter(x => /^#[0-9a-f]{3,8}$/i.test(String(x)));
    return [c[0] || '#8490A6', c[1] || c[0] || '#8490A6'];
  };
  const teamLogo = t => {
    if (!t) return '';
    const own = safeUrl(t.logo);
    if (own) return own;
    try {
      const known = typeof T.findTeam === 'function' ? T.findTeam(t.name, t.sport) || T.findTeam(t.short, t.sport) : null;
      return safeUrl(typeof T.logoFor === 'function' ? T.logoFor(known) : known?.logo);
    } catch (error) { return ''; }
  };
  const teamMark = (t, size = 20) => {
    const [a, b] = teamColors(t);
    const logo = teamLogo(t);
    const img = logo ? `<img src="${esc(logo)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-team-logo>` : '';
    return `<span class="va-logo${logo ? '' : ' va-logo--dot'}" style="--a:${esc(a)};--b:${esc(b)};--logo:${size}px" aria-hidden="true">${img}</span>`;
  };
  // A logo that fails to load turns back into the dot (error doesn't bubble,
  // so listen in the capture phase). Never leave a broken image.
  document.addEventListener('error', event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-team-logo')) return;
    img.parentElement?.classList.add('va-logo--dot');
    img.remove();
  }, true);
  function clipCard(c, i) {
    const inAd = Boolean(state.clip?.url) && state.clip.url === c.url;
    const busy = Boolean(loadingClip) && loadingClip === c.url;
    const thumb = safeUrl(c.thumb || c.thumbnail);
    const handle = String(c.handle || '').replace(/^@/, '');
    const hours = Number.isFinite(Number(c.ageHours)) && c.ageHours !== null && c.ageHours !== '' ? Number(c.ageHours) : (c.postedAt ? (Date.now() - new Date(c.postedAt).getTime()) / 3600e3 : NaN);
    const age = Number.isFinite(hours) ? (hours < 1 ? 'Just now' : hours < 24 ? `${Math.round(hours)}h ago` : `${Math.round(hours / 24)} day${Math.round(hours / 24) === 1 ? '' : 's'} ago`) : '';
    const secs = Number(c.duration) > 600 ? Number(c.duration) / 1000 : Number(c.duration || (c.durationMs ? c.durationMs / 1000 : 0));
    // Verified sources (video-ads-sources.js on the server): the team's own
    // account is "Official"; league, conference and network accounts "Verified".
    const tag = c.source === 'official' ? 'Official' : (c.source === 'league' || c.source === 'media') ? 'Verified' : '';
    const quality = /^\d{3,4}p$/.test(String(c.quality || '')) ? c.quality : '';
    return `<article class="va-clip${inAd ? ' is-in' : ''}${busy ? ' is-busy' : ''}" style="--i:${i}">
      <span class="va-clip__thumb"${thumb ? ` style="background-image:url('${esc(thumb)}')"` : ''}>${tag && !inAd ? `<span class="va-clip__tag va-clip__tag--${c.source === 'official' ? 'official' : 'verified'}" title="${tag === 'Official' ? 'Posted by the team’s own account' : 'Posted by a league, conference or network account'}">${ICON.check}${tag}</span>` : ''}${quality ? `<span class="va-clip__q" title="Best version on X">${esc(quality)}</span>` : ''}${secs ? `<span class="va-clip__dur">${esc(fmt(secs))}</span>` : ''}${inAd ? `<span class="va-clip__in">${ICON.check}In the ad</span>` : ''}</span>
      <span class="va-clip__who"><span>${handle ? `@${esc(handle)}` : 'X post'}</span>${age ? `<span class="va-clip__age">${esc(age)}</span>` : ''}</span>
      ${c.text ? `<span class="va-clip__text">${esc(c.text)}</span>` : ''}
      <span class="va-clip__actions">
        <button class="es-btn es-btn--sm es-btn--still${inAd || busy ? '' : ' es-btn--primary'}" type="button" data-clip="${i}"${busy || inAd ? ' disabled' : ''}>${busy ? 'Loading…' : inAd ? 'Using it' : 'Use clip'}</button>
        ${safeUrl(c.url) ? `<a class="va-icon-btn va-icon-btn--sm" href="${esc(c.url)}" target="_blank" rel="noopener" aria-label="Open the post by ${esc(handle || 'X')}" title="Open the post">${ICON.external}</a>` : ''}
      </span>
    </article>`;
  }
  function renderFound() {
    const kind = state.clipTab;
    if (kind !== 'link') renderNoClip(); // its colours follow the current team / colour
    // By moment with the list open: no moment chosen, so no clips under it.
    if (kind === 'link' || (kind === 'moment' && state.momentOpen)) { els.found.hidden = true; return; }
    els.found.hidden = false;
    const f = finds[kind];
    if (!f) { els.found.innerHTML = ''; return; }
    const what = kind === 'color'
      ? `${String(f.label || '').toLowerCase()} ${SPORT_LABEL[f.params.sport] || ''} teams`
      : kind === 'team' ? (f.label || 'this team') : 'this moment';
    const allTeams = f.teams || [];
    const teams = allTeams.slice(0, 6);
    const more = allTeams.length - teams.length;
    const teamsHtml = teams.length ? `<ul class="va-teams" aria-label="Matched teams">${teams.map(t => `<li class="va-team" aria-label="${esc(t.name || t.short)}">${teamMark(t, 20)}<span>${esc(t.short || t.name)}</span></li>`).join('')}${more > 0 ? `<li class="va-team va-team--more" title="${esc(allTeams.slice(6).map(t => t.short || t.name).join(', '))}">+${more} more</li>` : ''}</ul>` : '';
    if (f.status === 'loading') {
      els.found.innerHTML = `${teamsHtml}<p class="va-working">${dots}Looking for clips from the last 5 days…</p>
        <div class="va-clipgrid" aria-hidden="true">${Array.from({ length: 4 }, (_, i) => `<div class="va-clip va-clip--skeleton" style="--i:${i}"><span class="va-clip__thumb va-shimmer"></span><span class="va-line va-shimmer" style="width:46%"></span><span class="va-line va-shimmer"></span></div>`).join('')}</div>`;
      els.found.setAttribute('aria-busy', 'true');
      return;
    }
    els.found.removeAttribute('aria-busy');
    if (f.status === 'error') {
      els.found.innerHTML = `${teamsHtml}<div class="va-empty-state va-empty-state--bad" role="alert">${ICON.alert}<strong>The search didn’t finish</strong><span>${esc(f.error)}</span><div class="va-empty-state__actions"><button class="es-btn es-btn--sm es-btn--primary es-btn--still" type="button" data-act="retry-find">${ICON.retry}Try again</button></div>${noClipBlock()}</div>`;
      return;
    }
    if (f.status === 'empty') {
      const another = { team: 'Try another team', color: 'Try another colour', moment: 'Try another moment' }[kind];
      const pick = { team: ['other-team', 'Pick a team'], color: ['other-color', 'Pick a colour'], moment: ['other-moment', 'Pick a moment'] }[kind];
      const title = { team: `No fresh ${esc(f.label || 'team')} clips yet`, color: `No fresh clips for ${esc(what)} yet`, moment: 'No fresh clips for this moment yet' }[kind];
      const where = kind === 'moment' ? 'We checked X for a video of it from the last 5 days.' : 'We checked the official team, league and network accounts on X, and everyone else, for the last 5 days.';
      els.found.innerHTML = `${kind === 'team' ? '' : teamsHtml}<div class="va-empty-state">${ICON.film}<strong>${title}</strong><span>${where} ${another}, or make the ad without a clip.</span><div class="va-empty-state__actions"><button class="es-btn es-btn--sm" type="button" data-act="${pick[0]}">${pick[1]}</button></div>${noClipBlock()}</div>`;
      return;
    }
    els.found.innerHTML = `${kind === 'team' ? '' : teamsHtml}
      <div class="va-found__head"><h3>${f.clips.length} clip${f.clips.length === 1 ? '' : 's'}</h3><span class="va-hint">Last 5 days</span></div>
      ${f.note ? `<p class="va-found__note">${esc(f.note)}</p>` : ''}
      <div class="va-clipgrid">${f.clips.map(clipCard).join('')}</div>`;
  }
  els.found.addEventListener('click', event => {
    const use = event.target.closest('[data-clip]');
    if (use) {
      const c = finds[state.clipTab]?.clips?.[Number(use.dataset.clip)];
      if (c) downloadClip(bestVariant(c.variants), { handle: c.handle, url: c.url, from: 'search' });
      return;
    }
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (noClipAct(event)) return;
    if (act === 'retry-find') {
      const f = finds[state.clipTab];
      if (state.clipTab === 'color') findByColor();
      else if (state.clipTab === 'team') findByTeam();
      else if (f) findClips('moment', f.params, { label: f.label });
    }
    if (act === 'to-link') { selectClipTab(clipTab('link')); els.xurl.focus(); }
    if (act === 'other-team') { els.teamQ.focus(); }
    if (act === 'other-color') els.swatches.querySelector('[aria-checked="true"]')?.focus();
    if (act === 'other-moment') { state.momentOpen = true; renderTrends(); renderFound(); els.trends.querySelector('.va-trend')?.focus(); }
  });

  // By team: every team for the sport, type to filter, then Find clips.
  const allTeams = sport => (Array.isArray(T.TEAMS) ? T.TEAMS : []).filter(t => t.sport === sport);
  const teamKey = () => JSON.stringify({ sport: state.teamSport, team: state.team });
  function renderTeamPicker() {
    const sport = state.teamSport;
    const q = state.teamQuery.trim().toLowerCase();
    let teams = allTeams(sport);
    // A colour picked in Copy: its teams come first.
    const fam = state.copyColor;
    const inColor = t => fam && Array.isArray(t.families) && t.families.includes(fam);
    teams = [...teams].sort((a, b) => (inColor(b) - inColor(a)) || a.name.localeCompare(b.name));
    const shown = q ? teams.filter(t => `${t.name} ${t.short || ''}`.toLowerCase().includes(q)) : teams;
    if (state.team && !teams.some(t => t.name === state.team)) state.team = '';
    const nColor = fam ? teams.filter(inColor).length : 0;
    els.teamHint.textContent = !teams.length ? '' : nColor && !q ? `${colorById(fam).label} teams first` : '';
    els.teamHint.hidden = !els.teamHint.textContent;
    if (!teams.length) {
      els.teamList.innerHTML = '<p class="va-hint">Team list is still loading. Try By colour, or paste a link.</p>';
    } else if (!shown.length) {
      els.teamList.innerHTML = `<p class="va-hint">No team matches “${esc(state.teamQuery)}”.</p>`;
    } else {
      const focusable = shown.some(t => t.name === state.team) ? state.team : shown[0].name;
      els.teamList.innerHTML = shown.map(t => {
        const on = t.name === state.team;
        return `<button class="va-teamchip${inColor(t) ? ' is-suggested' : ''}" type="button" role="radio" data-team="${esc(t.name)}" aria-checked="${on}" tabindex="${t.name === focusable ? 0 : -1}" title="${esc(t.name)}" aria-label="${esc(t.name)}">${teamMark(t, 24)}<span>${esc(t.short || t.name)}</span></button>`;
      }).join('');
    }
    renderTeamFind();
  }
  function renderTeamFind() {
    const f = finds.team;
    const loading = f?.status === 'loading';
    const same = f && f.key === teamKey();
    els.teamFind.disabled = loading || !state.team;
    els.teamFind.classList.toggle('es-btn--primary', !same);
    els.teamFind.toggleAttribute('aria-busy', loading);
    const t = allTeams(state.teamSport).find(x => x.name === state.team);
    els.teamFindText.textContent = loading ? 'Finding clips…' : !state.team ? 'Pick a team' : same && f.status !== 'error' ? 'Search again' : `Find ${t?.short || 'team'} clips`;
  }
  function findByTeam() {
    if (!state.team) { els.teamQ.focus(); return; }
    const t = allTeams(state.teamSport).find(x => x.name === state.team);
    findClips('team', { sport: state.teamSport, team: state.team }, { label: t?.short || state.team, teams: t ? [t] : [] });
  }
  els.teamFind.addEventListener('click', findByTeam);
  els.teamQ.addEventListener('input', () => { state.teamQuery = els.teamQ.value; renderTeamPicker(); });
  els.teamQ.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const first = els.teamList.querySelector('[data-team]');
      if (first) { state.team = first.dataset.team; state.clipPicked = true; renderTeamPicker(); els.teamList.querySelector(`[data-team="${CSS.escape(state.team)}"]`)?.focus(); }
    }
    if (event.key === 'ArrowDown') { event.preventDefault(); els.teamList.querySelector('[tabindex="0"]')?.focus(); }
  });

  // By moment: trending moments that already have fresh clips
  // (POST { mode: 'moments-with-clips', sport }). Picking one shows its clips
  // straight from that response. If the check fails (AI off, server error),
  // the full trends board comes back with a note, and picking a moment
  // searches X for it as before.
  let trendItems = [];
  let trendsError = '';
  state.trendsStatus = 'idle';
  // moments-with-clips, one entry per sport filter: { status, items, error }
  const fresh = {};
  let freshToken = 0;
  let freshFallback = false; // the check failed: show the old board
  const usableClips = list => (Array.isArray(list) ? list : []).filter(c => c && Array.isArray(c.variants) && c.variants.some(v => v && v.url));
  async function loadFreshMoments({ force = false } = {}) {
    const sport = state.sport;
    if (!force && fresh[sport] && fresh[sport].status !== 'error') { renderTrends(); return; }
    const token = ++freshToken;
    fresh[sport] = { status: 'loading', items: [] };
    freshFallback = false;
    els.refresh.classList.add('is-spinning');
    renderTrends();
    try {
      const data = await callApi({ mode: 'moments-with-clips', sport });
      if (token !== freshToken) return;
      const items = (Array.isArray(data.moments) ? data.moments : [])
        .map(m => ({ ...m, id: String(m.id || m.title || ''), clips: usableClips(m.clips) }))
        .filter(m => m.id && m.title && m.clips.length && (sport === 'all' || !m.sport || m.sport === sport));
      fresh[sport] = { status: items.length ? 'done' : 'empty', items };
    } catch (error) {
      if (token !== freshToken) return;
      fresh[sport] = { status: 'error', items: [], error: error.message || '' };
      freshFallback = true;
      if (state.trendsStatus !== 'done') { els.refresh.classList.remove('is-spinning'); loadTrends(); return; }
    }
    els.refresh.classList.remove('is-spinning');
    renderTrends();
  }
  const skeletonRows = () => Array.from({ length: 5 }, (_, i) => `<li class="va-trend-item" aria-hidden="true" style="--i:${i}"><div class="va-trend va-trend--skeleton"><span class="va-trend__img va-shimmer"></span><span class="va-trend__body"><span class="va-line va-shimmer" style="width:42%"></span><span class="va-line va-shimmer"></span><span class="va-line va-shimmer" style="width:72%"></span></span></div></li>`).join('');
  function trendRow(item, index, count = 0) {
    const firstThumb = count ? safeUrl(item.clips[0]?.thumb || item.clips[0]?.thumbnail) : '';
    const img = safeUrl(item.image) || firstThumb;
    const on = state.trend?.id === item.id;
    const meta = [ago(item.publishedAt), item.source].filter(Boolean).map(esc).join('<i aria-hidden="true">·</i>');
    const countHtml = count ? `<span class="va-trend__count">${count} clip${count === 1 ? '' : 's'}</span>` : '';
    return `<li class="va-trend-item" style="--i:${index}">
        <button class="va-trend${on ? ' is-on' : ''}" type="button" data-id="${esc(item.id)}" aria-pressed="${on}">
          ${img ? `<span class="va-trend__img" style="background-image:url('${esc(img)}')"></span>` : leagueTile(item.sport, 'va-trend__img is-league')}
          <span class="va-trend__body">
            <span class="va-trend__meta">${leagueTile(item.sport)}<span>${esc(SPORT_LABEL[item.sport] || '')}</span>${meta ? `<i aria-hidden="true">·</i>${meta}` : ''}${countHtml}</span>
            <span class="va-trend__title">${esc(item.title)}</span>
          </span>
          <span class="va-trend__go" aria-hidden="true">${on ? ICON.check : ICON.chevron}</span>
        </button>
      </li>`;
  }
  function renderTrends() {
    els.boardBar.hidden = !state.momentOpen;
    els.trendsStatus.classList.remove('is-error');
    // A picked moment: just that one, with Change.
    if (!state.momentOpen && state.trend) {
      const t = state.trend;
      els.trends.removeAttribute('aria-busy');
      els.trendsStatus.textContent = '';
      els.trends.innerHTML = `<li class="va-picked">${leagueTile(t.sport)}<p>${esc(t.title)}</p><button class="es-btn es-btn--sm es-btn--ghost" type="button" data-act="change-moment">Change</button></li>`;
      return;
    }
    const f = fresh[state.sport];
    if (f && !freshFallback) {
      if (f.status === 'loading') {
        els.trendsStatus.textContent = 'Finding moments with fresh clips…';
        els.trends.innerHTML = skeletonRows();
        els.trends.setAttribute('aria-busy', 'true');
        return;
      }
      els.trends.removeAttribute('aria-busy');
      if (f.status === 'empty' || !f.items.length) {
        els.trendsStatus.textContent = '';
        const all = state.sport === 'all' || !SPORT_LABEL[state.sport];
        const tries = all
          ? `${['nfl', 'cfb', 'mlb'].map(id => `<button class="es-btn es-btn--sm" type="button" data-act="sport-${id}">${SPORT_LABEL[id]}</button>`).join('')}<button class="es-btn es-btn--sm es-btn--ghost" type="button" data-act="to-team">By team</button>`
          : `<button class="es-btn es-btn--sm" type="button" data-act="sport-all">All sports</button><button class="es-btn es-btn--sm es-btn--ghost" type="button" data-act="to-team">By team</button>`;
        const why = all
          ? 'None of today’s top moments has a video from the last 5 days yet. Try one sport at a time, or search by team.'
          : `None of the top ${esc(SPORT_LABEL[state.sport])} moments has a video from the last 5 days yet. Try all sports, or search by team.`;
        els.trends.innerHTML = `<li class="va-empty-state">${ICON.film}<strong>No fresh clips for these moments yet</strong><span>${why}</span><div class="va-empty-state__actions">${tries}</div>${noClipBlock()}</li>`;
        return;
      }
      els.trends.innerHTML = f.items.map((item, i) => trendRow(item, i, item.clips.length)).join('');
      els.trendsStatus.innerHTML = `<span class="es-live-dot" aria-hidden="true"></span><span><b data-es-tick="va-moments">${f.items.length}</b> moment${f.items.length === 1 ? '' : 's'} with clips from the last 5 days</span>`;
      return;
    }
    // The old board: every trend (Copy step, or the clip check failed).
    if (state.trendsStatus === 'loading' || state.trendsStatus === 'idle') {
      els.trendsStatus.textContent = 'Loading the last 48 hours…';
      els.trends.innerHTML = skeletonRows();
      els.trends.setAttribute('aria-busy', 'true');
      return;
    }
    els.trends.removeAttribute('aria-busy');
    if (state.trendsStatus === 'error') {
      els.trendsStatus.textContent = '';
      els.trends.innerHTML = `<li class="va-empty-state va-empty-state--bad">${ICON.alert}<strong>Trends didn’t load</strong><span>${esc(trendsError)}</span><div class="va-empty-state__actions"><button class="es-btn es-btn--sm es-btn--primary es-btn--still" type="button" data-act="retry-trends">${ICON.retry}Try again</button><button class="es-btn es-btn--sm es-btn--ghost" type="button" data-act="to-color">Search by colour</button></div></li>`;
      return;
    }
    const list = trendItems.filter(item => state.sport === 'all' || item.sport === state.sport);
    if (!list.length) {
      els.trends.innerHTML = `<li class="va-empty-state">${ICON.search}<strong>Nothing for ${esc(SPORT_LABEL[state.sport] || 'this sport')} right now</strong><span>Try another sport, or search by colour.</span><div class="va-empty-state__actions"><button class="es-btn es-btn--sm" type="button" data-act="to-color">Search by colour</button></div></li>`;
      els.trendsStatus.textContent = '';
      return;
    }
    els.trends.innerHTML = list.map((item, i) => trendRow(item, i)).join('');
    els.trendsStatus.innerHTML = freshFallback
      ? `<span>Clips not checked; some moments may have no video</span>`
      : `<span class="es-live-dot" aria-hidden="true"></span><span><b data-es-tick="va-moments">${list.length}</b> trending in the last 48 hours</span>`;
  }
  async function loadTrends() {
    state.trendsStatus = 'loading';
    els.refresh.classList.add('is-spinning');
    renderTrends();
    try {
      const data = await callApi({ mode: 'trends' });
      trendItems = data.items || [];
      state.trendsStatus = 'done';
    } catch (error) {
      state.trendsStatus = 'error';
      trendsError = error.message || '';
      els.trendsStatus.textContent = '';
    }
    els.refresh.classList.remove('is-spinning');
    renderTrends();
    renderMoments();
  }
  els.sports.addEventListener('click', event => {
    const chip = event.target.closest('[data-sport]');
    if (!chip) return;
    state.sport = chip.dataset.sport;
    [...els.sports.children].forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
    if (freshFallback) renderTrends();
    else loadFreshMoments();
  });
  els.trends.addEventListener('click', event => {
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (noClipAct(event)) return;
    if (act && act.startsWith('sport-')) { els.sports.querySelector(`[data-sport="${act.slice(6)}"]`)?.click(); return; }
    if (act === 'retry-trends') { loadTrends(); return; }
    if (act === 'to-color') { selectClipTab(clipTab('color')); return; }
    if (act === 'to-team') { selectClipTab(clipTab('team')); return; }
    if (act === 'to-link') { selectClipTab(clipTab('link')); els.xurl.focus(); return; }
    if (act === 'change-moment') { state.momentOpen = true; renderTrends(); renderFound(); els.trends.querySelector('.va-trend.is-on, .va-trend')?.focus(); return; }
    const button = event.target.closest('.va-trend[data-id]');
    if (!button) return;
    const f = fresh[state.sport];
    const withClips = !freshFallback && f?.items?.find(t => t.id === button.dataset.id);
    if (withClips) { selectMoment(withClips, { clips: withClips.clips }); return; }
    const item = trendItems.find(t => t.id === button.dataset.id);
    if (item) selectMoment(item);
  });
  els.refresh.addEventListener('click', () => loadFreshMoments({ force: true }));
  // clips: the moment's clips from moments-with-clips (no extra search).
  function selectMoment(item, { clips = null } = {}) {
    state.trend = item;
    state.momentOpen = false;
    renderTrends();
    if (!clips) { findClips('moment', { sport: item.sport, query: item.title }, { label: item.title }); return; }
    const params = { sport: item.sport, query: item.title };
    ++findTokens.moment;
    const teams = item.team ? [typeof item.team === 'string' ? { name: item.team, short: item.team } : item.team] : [];
    finds.moment = { key: JSON.stringify(params), status: 'done', teams, clips, error: '', label: item.title, params, cached: true, note: '' };
    state.context = { kind: 'moment', sport: item.sport || '', color: '', colorLabel: '', teams: teams.map(t => t.name).filter(Boolean), trend: item };
    renderFound();
    renderSteps();
    if (state.clipTab === 'moment') reveal(els.found);
  }

  // ─── 2 Copy ──────────────────────────────────────────────────────────────
  const undoStack = [];
  function snapshot() { undoStack.push(copyOf()); if (undoStack.length > 30) undoStack.shift(); }
  function undo() {
    const prev = undoStack.pop();
    if (!prev) return;
    Object.assign(state, prev, { body: [...prev.body] });
    syncFields();
    relayout();
    changed();
    if (state.step === 'copy') renderVariants();
    toast('Undone.', { timeout: 2000 });
  }
  // ─── Style picker: one radio per style, each with a live thumbnail ──────
  const STYLE_IDS = Object.keys(B.STYLES);
  els.styles.innerHTML = STYLE_IDS.map(id => {
    const st = B.STYLES[id];
    return `<button type="button" role="radio" data-style="${esc(id)}" aria-checked="false" tabindex="-1">
      <span class="va-style-thumb"><canvas width="120" height="150" aria-hidden="true"></canvas>${st.needsFootage ? '' : '<span class="va-style-tag">No clip needed</span>'}</span>
      <span class="va-style-name">${esc(st.label)}</span>
      <span class="va-style-note">${esc(st.note)}</span>
    </button>`;
  }).join('');
  function syncStyles() {
    [...els.styles.querySelectorAll('[role="radio"]')].forEach(b => {
      const on = b.dataset.style === state.style;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      const ready = S.styleReady(b.dataset.style, resolvedCopy({ ...state, style: b.dataset.style }));
      b.classList.toggle('is-unready', !ready.ok);
      b.title = ready.ok ? B.STYLES[b.dataset.style].note : `${B.STYLES[b.dataset.style].note}. Needs ${ready.missing}.`;
    });
    els.styleCount.textContent = B.STYLES[state.style]?.needsFootage === false ? 'Works without a clip' : '';
    els.zoneRow.hidden = S.isNew(state.style);
    markRadios(els.zone, 'zone', state.safeZone);
  }
  // Thumbnails: each style drawn by the renderer at 4:5, small, over the
  // animated background. Real copy when the style is ready; else neutral
  // placeholder words (never a made-up number: "00").
  const THUMB_SAMPLE = {
    stat: { stat: '00', statLabel: 'What the number counts' },
    today3: { items: ['First headline here', 'Second headline here', 'Third headline here'] },
    versus: {},
    quote: { quote: 'Their words, exactly as they said them.', speaker: 'Speaker' },
  };
  let thumbTimer = 0;
  function renderThumbs() {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
      const size4x5 = B.SIZES['4x5'];
      const colors = stillColors();
      els.styles.querySelectorAll('[data-style]').forEach(b => {
        const id = b.dataset.style;
        const canvas = b.querySelector('canvas');
        if (!canvas) return;
        let src = { ...state, style: id };
        if (!S.styleReady(id, resolvedCopy(src)).ok) src = { ...src, ...(THUMB_SAMPLE[id] || {}) };
        if (B.STYLES[id].classic && !String(src.headline || '').trim()) src = { ...src, headline: 'Your headline here', body: ['A short line about the newsletter.'] };
        const layout = layoutFor('4x5', src);
        const c = canvas.getContext('2d');
        c.setTransform(canvas.width / size4x5.width, 0, 0, canvas.height / size4x5.height, 0, 0);
        try {
          R.drawFrame(c, { width: size4x5.width, height: size4x5.height, video: null, bg: { tint: { color: '#000000', amount: 0.25 } }, ops: layout.ops, logoImage: logo.img, source: { kind: 'generated', colors, t: 2, duration: 8 } });
        } catch (error) { /* a thumbnail never breaks the page */ }
        c.setTransform(1, 0, 0, 1, 0, 0);
      });
    }, 220);
  }

  // ─── Fields of the no-footage styles ─────────────────────────────────────
  const L = S.LIMITS;
  const words = text => String(text || '').split(/\s+/).filter(Boolean).length;
  const countText = (text, max) => { const n = words(text); return `${n} / ${max} word${max === 1 ? '' : 's'}`; };
  // One labelled input. data-f = the state key, data-i = the index in a list.
  function fieldHtml({ key, index, label, value, placeholder = '', max, area = false, chars = 0, hint = '' }) {
    const id = `va-f-${key}${index != null ? `-${index}` : ''}`;
    const attrs = `class="va-input" id="${id}" data-f="${esc(key)}"${index != null ? ` data-i="${index}"` : ''} placeholder="${esc(placeholder)}" spellcheck="true" lang="en-US"${chars ? ` maxlength="${chars}"` : ''} aria-describedby="${id}-count"`;
    const count = max ? `<span class="va-count" id="${id}-count" data-count="${max}">${countText(value, max)}</span>` : (chars ? `<span class="va-count" id="${id}-count">${String(value || '').length} / ${chars}</span>` : `<span class="va-count" id="${id}-count"></span>`);
    return `<div class="va-field va-field--tight">
      <div class="va-field__top"><label class="va-label" for="${id}">${esc(label)}</label>${count}</div>
      ${area ? `<textarea ${attrs} rows="3">${esc(value)}</textarea>` : `<input type="text" ${attrs} value="${esc(value)}">`}
      ${hint ? `<p class="va-hint">${hint}</p>` : ''}
    </div>`;
  }
  // Headlines Today's 3 can use: the moment's related stories, then other trending titles for this sport.
  function relatedTitles() {
    const sport = brand().sport;
    const own = (state.copyTrend?.related || []).map(r => (typeof r === 'string' ? r : r?.title)).filter(Boolean);
    const trending = trendItems.filter(t => t.sport === sport && t.id !== state.copyTrend?.id).flatMap(t => [t.title, ...(t.related || []).map(r => r.title)]);
    return [...new Set([...own, ...(state.copyTrend?.title ? [state.copyTrend.title] : []), ...trending].map(x => String(x || '').trim()).filter(Boolean))].slice(0, 12);
  }
  let renderedFields = '';
  function renderStyleFields({ force = false } = {}) {
    const isNew = S.isNew(state.style);
    els.classicFields.hidden = isNew;
    els.styleFields.hidden = !isNew;
    const key = `${state.style}|${state.brandId}`;
    if (!isNew) { renderedFields = ''; return; }
    if (!force && key === renderedFields) { renderStyleReady(); return; }
    renderedFields = key;
    const b = brand();
    const d = S.defaultsFor(b, state.style);
    const parts = [];
    if (state.style === 'stat') {
      parts.push(fieldHtml({ key: 'stat', label: 'The number', value: state.stat, placeholder: 'e.g. .412 or 6', chars: L.statChars, hint: 'Only a number from your notes, the moment or the clip. It shows exactly as typed.' }));
      parts.push(fieldHtml({ key: 'statLabel', label: 'What it counts', value: state.statLabel, placeholder: 'e.g. his on-base percentage this month', max: L.statLabelWords }));
      parts.push(fieldHtml({ key: 'statSource', label: 'Source (optional)', value: state.statSource, placeholder: 'e.g. MLB.com', max: L.statSourceWords }));
    } else if (state.style === 'today3') {
      parts.push(fieldHtml({ key: 'listTitle', label: 'Title', value: state.listTitle, placeholder: d.listTitle, max: L.listTitleWords }));
      parts.push(`<div class="va-field va-field--tight"><div class="va-field__top"><span class="va-label" id="va-items-label">Three headlines</span><button class="va-link" type="button" data-act="fill-items">${ICON.sparkle}Fill from trends</button></div>
        <div class="va-items" role="group" aria-labelledby="va-items-label">${[0, 1, 2].map(i => `<div class="va-item"><span class="va-item__n" aria-hidden="true">${i + 1}</span><input type="text" class="va-input" id="va-f-items-${i}" data-f="items" data-i="${i}" value="${esc(state.items[i] || '')}" placeholder="A real headline, plainly put" aria-label="Headline ${i + 1}" aria-describedby="va-items-hint" spellcheck="true" lang="en-US"></div>`).join('')}</div>
        <p class="va-hint" id="va-items-hint">Real stories only, ${L.itemWords} words or fewer each. No rumours as facts.</p></div>`);
    } else if (state.style === 'versus') {
      const them = [0, 1, 2].map(i => `<input type="text" class="va-input" id="va-f-them-${i}" data-f="them" data-i="${i}" value="${esc(state.them[i] || '')}" placeholder="${esc(d.them[i] || '')}" aria-label="Your feed, line ${i + 1}" spellcheck="true" lang="en-US">`).join('');
      const chosen = resolvedCopy().us;
      const claims = (b.verifiedClaims || []).map(c => `<button class="va-chip" type="button" data-claim="${esc(c)}" aria-pressed="${chosen.includes(c)}">${esc(c)}</button>`).join('');
      parts.push(`<div class="va-field va-field--tight"><div class="va-field__top"><span class="va-label" id="va-them-label">Your feed (crossed out)</span><span class="va-count">${L.themWords} words max, no names</span></div><div class="va-them" role="group" aria-labelledby="va-them-label">${them}</div></div>`);
      parts.push(`<div class="va-field va-field--tight"><div class="va-field__top"><span class="va-label" id="va-us-label">${esc(b.label)} (ticked)</span><span class="va-count">Pick 2–3</span></div>
        <div class="va-claims" role="group" aria-labelledby="va-us-label">${claims}</div>
        ${b.claimsApproved ? '<p class="va-hint">Only approved claims can appear here.</p>' : `<p class="va-warn va-claims__todo">${ICON.alert}<span>Placeholder claims: the owner still has to approve this list before paid use.</span></p>`}</div>`);
    } else if (state.style === 'quote') {
      parts.push(fieldHtml({ key: 'quote', label: 'Quote, word for word', value: state.quote, placeholder: 'Paste the exact words', max: L.quoteWords, area: true, hint: 'Never reword a quote. Say it was said “after…”, never that they read the newsletter.' }));
      parts.push(fieldHtml({ key: 'speaker', label: 'Who said it', value: state.speaker, placeholder: 'e.g. Andy Reid', max: L.speakerWords }));
      parts.push(fieldHtml({ key: 'quoteContext', label: 'When (optional)', value: state.quoteContext, placeholder: 'e.g. after Sunday’s win', max: L.quoteContextWords }));
    }
    parts.push(fieldHtml({ key: 'offer', label: 'Offer', value: state.offer, placeholder: d.offer, max: L.offerWords, hint: 'Say it’s free.' }));
    parts.push('<p class="va-warn va-style-ready" id="va-style-ready" role="status" hidden></p>');
    els.styleFields.innerHTML = parts.join('');
    renderStyleReady();
  }
  function renderStyleReady() {
    const box = document.getElementById('va-style-ready');
    if (!box) return;
    const r = S.styleReady(state.style, resolvedCopy());
    box.hidden = r.ok;
    box.innerHTML = r.ok ? '' : `${ICON.alert}<span>${esc(B.STYLES[state.style].label)} needs ${esc(r.missing)}.</span>`;
  }
  // Typing in a style field.
  els.styleFields.addEventListener('beforeinput', event => { if (event.target.closest('[data-f]')) snapOnFirstKey(); });
  els.styleFields.addEventListener('input', event => {
    const el = event.target.closest('[data-f]');
    if (!el) return;
    const k = el.dataset.f;
    if (el.dataset.i != null) {
      const list = Array.isArray(state[k]) ? [...state[k]] : ['', '', ''];
      list[Number(el.dataset.i)] = el.value;
      state[k] = list;
    } else state[k] = el.value;
    const count = document.getElementById(`${el.id}-count`);
    if (count?.dataset.count) {
      const max = Number(count.dataset.count);
      count.textContent = countText(el.value, max);
      count.classList.toggle('is-over', words(el.value) > max);
    } else if (count && el.maxLength > 0) count.textContent = `${el.value.length} / ${el.maxLength}`;
    state.copyEdited = true;
    settlePreview();
    relayout();
    changed();
    renderStyleReady();
    suggestSoon();
  });
  els.styleFields.addEventListener('click', event => {
    const claim = event.target.closest('[data-claim]');
    if (claim) {
      snapshot();
      const now = resolvedCopy().us;
      const c = claim.dataset.claim;
      let next = now.includes(c) ? now.filter(x => x !== c) : [...now, c];
      if (next.length > 3) { toast('Up to 3 claims.', { timeout: 2000 }); return; }
      // Keep the brand's order.
      next = (brand().verifiedClaims || []).filter(x => next.includes(x));
      state.us = next;
      claim.setAttribute('aria-pressed', String(next.includes(c)));
      state.copyEdited = true;
      settlePreview();
      relayout();
      changed();
      renderStyleReady();
      return;
    }
    if (event.target.closest('[data-act="fill-items"]')) fillItems();
  });
  // Today's 3 from Trends: the moment's related stories, then other trending titles.
  async function fillItems() {
    if (state.trendsStatus !== 'done') await loadTrends();
    const titles = relatedTitles();
    if (!titles.length) { toast('No trending headlines right now. Type three real ones.', { tone: 'bad' }); return; }
    snapshot();
    const empty = state.items.map((x, i) => (String(x || '').trim() ? -1 : i)).filter(i => i >= 0);
    const slots = empty.length ? empty : [0, 1, 2];
    const used = new Set(state.items.map(x => String(x || '').trim()));
    const fresh = titles.filter(t => !used.has(t));
    const items = [...state.items];
    slots.forEach((slot, i) => { if (fresh[i]) items[slot] = fresh[i]; });
    state.items = items;
    state.copyEdited = true;
    renderStyleFields({ force: true });
    settlePreview();
    relayout();
    changed();
    toast(`Added ${Math.min(slots.length, fresh.length)} trending headline${Math.min(slots.length, fresh.length) === 1 ? '' : 's'}. Shorten them to ${L.itemWords} words.`, { action: { label: 'Undo', fn: undo } });
  }

  // ─── Style suggestion: rules first (here, instantly), then the server's
  // version with this brand's export ranking (suggest-style, no AI cost). ──
  const ranking = {}; // brandId -> [{ style, score }]
  function localSuggestion() {
    const c = copyContext();
    const facts = S.briefFacts({
      notes: els.notes.value.trim(),
      clipText: clipText(),
      trendTitle: c.trend?.title || '',
      related: relatedTitles(),
      copy: state,
      brand: brand(),
      hasClip: Boolean(realVideo.videoWidth) && !still,
    });
    return S.suggestStyles(facts, { ranking: ranking[state.brandId] || [], brand: brand() });
  }
  function renderSuggest() {
    const sug = state.suggestion || localSuggestion();
    if (!sug) { els.suggest.hidden = true; return; }
    const here = sug.style === state.style;
    const alts = sug.alternatives.filter(a => a.style !== state.style).slice(0, 2);
    els.suggest.hidden = false;
    els.suggest.classList.toggle('is-current', here);
    els.suggest.innerHTML = `${ICON.sparkle}<span class="va-suggest__text">${here ? `${esc(sug.label)} fits this brief — ${esc(sug.why)}` : esc(sug.text)}</span>`
      + (here ? '' : `<button class="es-btn es-btn--sm es-btn--secondary" type="button" data-pick="${esc(sug.style)}">Use ${esc(sug.label)}</button>`)
      + (alts.length ? `<span class="va-suggest__alts">Also: ${alts.map(a => `<button class="va-link" type="button" data-pick="${esc(a.style)}" title="${esc(a.why)}">${esc(a.label)}</button>`).join(', ')}</span>` : '');
  }
  let suggestTimer = 0;
  let suggestKey = '';
  function suggestSoon() {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => {
      state.suggestion = localSuggestion();
      renderSuggest();
      // The brand's ranking: once per brand (and again when the brief changes a lot).
      const key = state.brandId;
      if (suggestKey === key || !window.ESAuth?.fetchWithAuth) return;
      suggestKey = key;
      callApi({ mode: 'suggest-style', brandId: state.brandId, sport: brand().sport })
        .then(data => {
          ranking[key] = Array.isArray(data.ranking) ? data.ranking : [];
          if (state.brandId === key) { state.suggestion = localSuggestion(); renderSuggest(); }
        })
        .catch(() => { suggestKey = ''; });
    }, 300);
  }
  els.suggest.addEventListener('click', event => {
    const b = event.target.closest('[data-pick]');
    if (b) pickStyle(b.dataset.pick, { from: 'suggestion' });
  });

  function syncFields() {
    els.headline.value = state.headline;
    els.highlight.value = state.highlight;
    els.bodies.forEach((box, i) => {
      box.value = state.body[i] || '';
      if (i > 0) box.hidden = !(state.body[i] || '').trim() && !box.dataset.open;
    });
    els.addPara.hidden = els.bodies.every(box => !box.hidden);
    els.cta.value = state.cta;
    els.cta.placeholder = brand().cta;
    els.unsub.checked = state.unsubscribe;
    syncStyles();
    renderStyleFields({ force: true });
    requestAnimationFrame(() => [els.headline, ...els.bodies].forEach(fitBox));
    lintAll();
  }
  // Editor textareas grow with their text.
  function fitBox(box) { if (box.hidden || !box.offsetParent) return; box.style.height = 'auto'; box.style.height = `${box.scrollHeight + 2}px`; }
  const hasValue = v => (Array.isArray(v) ? v.some(x => String(x || '').trim()) : typeof v === 'string' && v.trim() !== '');
  // Applies copy fields (from an option or the assistant) with undo. The
  // no-footage fields only replace what's there when they have a value.
  function applyCopy(fields, { label = 'Copy updated', silent = false } = {}) {
    snapshot();
    if (fields.style && B.STYLES[fields.style]) state.style = fields.style;
    if (typeof fields.headline === 'string') state.headline = fields.headline;
    if (typeof fields.highlight === 'string') state.highlight = fields.highlight;
    if (Array.isArray(fields.body)) state.body = [0, 1, 2].map(i => String(fields.body[i] || ''));
    if (typeof fields.cta === 'string') state.cta = fields.cta.trim().toUpperCase() === brand().cta ? '' : fields.cta;
    STYLE_KEYS.forEach(k => {
      if (!hasValue(fields[k])) return;
      state[k] = Array.isArray(fields[k]) ? (k === 'us' ? fields[k].map(String) : [0, 1, 2].map(i => String(fields[k][i] || ''))) : String(fields[k]);
    });
    state.copyEdited = true;
    previewCopy = null;
    els.stage.classList.remove('is-previewing');
    settlePreview();
    syncFields();
    relayout();
    changed();
    if (!silent) toast(label, { action: { label: 'Undo', fn: undo } });
  }
  const variantFields = v => {
    const style = v.style || state.style;
    const out = { style, headline: v.headline || '', highlight: style === 'highlight' ? (v.highlight || '') : '', body: Array.isArray(v.body) ? v.body : [], cta: v.cta || '' };
    STYLE_KEYS.forEach(k => { if (hasValue(v[k])) out[k] = v[k]; });
    return out;
  };

  function pickStyle(id, { from = 'picker' } = {}) {
    if (!B.STYLES[id] || id === state.style) return;
    snapshot();
    state.style = id;
    settlePreview();
    syncStyles();
    renderStyleFields();
    relayout();
    changed();
    renderCopyAction();
    lintField('highlight');
    renderSuggest();
    if (from === 'suggestion') toast(`Style: ${B.STYLES[id].label}`, { action: { label: 'Undo', fn: undo }, timeout: 3000 });
  }
  els.styles.addEventListener('click', event => {
    const button = event.target.closest('[data-style]');
    if (button) pickStyle(button.dataset.style);
  });
  els.styles.addEventListener('keydown', event => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const target = els.styles.querySelector(`[data-style="${STYLE_IDS[(STYLE_IDS.indexOf(state.style) + keys[event.key] + STYLE_IDS.length) % STYLE_IDS.length]}"]`);
    target.click();
    target.focus();
  });
  // Classic styles: Meta Reels safe zone or the original Figma margins (9:16).
  els.zone.addEventListener('click', event => {
    const b = event.target.closest('[data-zone]');
    if (!b || b.dataset.zone === state.safeZone) return;
    state.safeZone = b.dataset.zone === 'classic' ? 'classic' : 'meta';
    markRadios(els.zone, 'zone', state.safeZone);
    relayout();
    changed();
  });
  els.zone.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const next = els.zone.querySelector(`[data-zone="${state.safeZone === 'meta' ? 'classic' : 'meta'}"]`);
    next.click();
    next.focus();
  });

  function headlineHtml(v) {
    const text = v.style === 'highlight' ? plain(v.headline).toUpperCase() : plain(v.headline);
    const lit = v.style === 'highlight' ? plain(v.highlight).toUpperCase().trim() : '';
    const at = lit ? text.indexOf(lit) : -1;
    if (at < 0) return esc(text);
    return `${esc(text.slice(0, at))}<mark>${esc(text.slice(at, at + lit.length))}</mark>${esc(text.slice(at + lit.length))}`;
  }
  // An option card: the classic headline, or the style's own fields.
  function variantSummary(v, style) {
    const list = items => `<ol class="va-variant__list">${items.filter(Boolean).map(x => `<li>${esc(x)}</li>`).join('')}</ol>`;
    if (style === 'stat') return `<p class="va-variant__stat"><b>${esc(v.stat)}</b> ${esc(v.statLabel || '')}</p>`;
    if (style === 'today3') return `${v.listTitle ? `<p class="va-variant__headline va-variant__headline--condensed">${esc(v.listTitle)}</p>` : ''}${list(v.items || [])}`;
    if (style === 'versus') return `<p class="va-variant__vs"><s>${esc((v.them || []).join(' · '))}</s></p><p class="va-variant__vs">${ICON.check}${esc((v.us || []).join(' · '))}</p>`;
    if (style === 'quote') return `<p class="va-variant__headline va-variant__headline--condensed">“${esc(v.quote)}”</p><p class="va-variant__body">— ${esc([v.speaker, v.quoteContext].filter(Boolean).join(', '))}</p>`;
    return '';
  }
  function variantCard(v, i, { scope = 'drafts', applied = false } = {}) {
    const body = (v.body || []).filter(Boolean);
    const style = v.style || state.style;
    const own = S.isNew(style) ? variantSummary(v, style) : '';
    return `<article class="va-variant${applied ? ' is-applied' : ''}" data-scope="${scope}" data-v="${i}" style="--i:${i}">
      ${own || `<p class="va-variant__headline va-variant__headline--${esc(style)}">${headlineHtml({ ...v, style })}</p>`}
      ${own ? (v.offer ? `<p class="va-variant__body">${esc(v.offer)}</p>` : '') : (body.length ? `<p class="va-variant__body">${esc(plain(body[0]))}</p>` : '')}
      <div class="va-variant__foot">
        <span class="va-variant__style">${esc(B.STYLES[style]?.label || '')}</span>
        ${applied
          ? `<span class="va-variant__state">${ICON.check}In the ad</span>`
          : `<button class="es-btn es-btn--sm${state.appliedVariant < 0 ? ' es-btn--primary es-btn--still' : ''}" type="button" data-use="${i}">Use this</button>`}
      </div>
    </article>`;
  }
  // The context line under the Copy title: what the AI writes about.
  // What the copy is about: the colour / moment picked in Copy, else the last clip search.
  function copyContext() {
    const sport = brand().sport || '';
    const color = state.copyColor ? colorById(state.copyColor) : null;
    const fallback = state.context;
    return {
      kind: state.copyTrend ? 'moment' : color ? 'color' : fallback.kind,
      sport,
      color: color?.id || (state.copyTrend ? '' : fallback.color),
      colorLabel: color?.label || (state.copyTrend ? '' : fallback.colorLabel),
      teams: color ? teamsFor(sport, color.id).map(t => t.name) : (state.copyTrend ? [] : fallback.teams),
      trend: state.copyTrend || (color ? null : fallback.trend),
    };
  }
  // The clip's post text (grounds quotes and numbers), when the clip came from a search.
  function clipText() {
    const c = copyContext();
    return (finds[c.kind]?.clips || []).find(clip => clip.url && clip.url === state.clip?.url)?.text || '';
  }
  function contextLabel() {
    const c = copyContext();
    if (c.kind === 'moment' && c.trend) return c.trend.title;
    if (c.kind === 'color' && c.colorLabel) return `${c.colorLabel} ${SPORT_LABEL[c.sport] || ''} teams`;
    return '';
  }
  function renderCopy() {
    syncFields();
    suggestSoon();
    markRadios(els.brands, 'brand', state.brandId);
    renderCopySwatches();
    renderMoments();
    renderVariants();
    renderThread();
  }
  // ─── Ask AI: one panel for options, grammar and chat ────────────────────
  // Only the latest kind of result shows (options, grammar or the chat thread).
  const aiReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const aiOpen = () => !els.ai.hidden;
  function openAi({ focus = true } = {}) {
    if (!aiOpen()) {
      els.ai.hidden = false;
      els.aiBtn.setAttribute('aria-expanded', 'true');
      if (!aiReduced()) {
        els.ai.classList.remove('is-entering');
        void els.ai.offsetWidth;
        els.ai.classList.add('is-entering');
      }
      renderMoments();
    }
    if (focus) els.aiActions.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    reveal(els.aiBtn.closest('.va-editor__head') || els.ai);
  }
  function closeAi({ focus = true } = {}) {
    if (!aiOpen()) return;
    els.ai.hidden = true;
    els.ai.classList.remove('is-entering');
    els.aiBtn.setAttribute('aria-expanded', 'false');
    if (previewCopy) previewDraft(null);
    if (focus) els.aiBtn.focus();
  }
  els.aiBtn.addEventListener('click', () => (aiOpen() ? closeAi() : openAi()));
  els.aiClose.addEventListener('click', () => closeAi());
  els.ai.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    // Esc inside an open context fold closes the panel too: one key, one exit.
    event.preventDefault();
    closeAi();
  });
  // ⌘J / Ctrl+J opens Ask AI from anywhere in the Copy step (⌘K is search).
  document.addEventListener('keydown', event => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'j') return;
    event.preventDefault();
    if (state.step !== 'copy') goStep('copy', { focus: false });
    if (aiOpen() && els.ai.contains(document.activeElement)) closeAi(); else openAi();
  });

  function aiBusyText() {
    if (state.draftsStatus === 'loading') return 'Writing 3 options…';
    if (state.grammar.status === 'loading') return 'Checking grammar…';
    if (state.chatBusy) return 'Working on it…';
    return '';
  }
  function renderAi() {
    const busy = aiBusyText();
    els.aiProgress.hidden = !busy;
    els.aiProgressText.textContent = busy;
    els.ai.toggleAttribute('aria-busy', Boolean(busy));
    els.aiActions.querySelectorAll('button').forEach(b => {
      const mine = (b.dataset.ai === 'write' && state.draftsStatus === 'loading') || (b.dataset.ai === 'grammar' && state.grammar.status === 'loading');
      b.disabled = Boolean(busy);
      b.classList.toggle('is-busy', mine);
    });
    els.send.disabled = Boolean(busy);
    const view = state.aiView;
    els.variants.hidden = view !== 'options';
    els.grammar.hidden = view !== 'grammar';
    els.thread.hidden = view !== 'chat';
    // Context summary: what the AI will write about.
    const bits = [state.copyTrend?.title, els.notes.value.trim() ? 'note' : ''].filter(Boolean);
    els.aiContextSum.textContent = bits.length ? `Context: ${bits.join(' + ')}` : 'Add context';
  }
  function renderCopyAction() {
    const has = state.variants.length > 0;
    els.aiWriteText.textContent = has ? 'Write 3 more' : 'Write 3 options';
    renderAi();
  }
  const aiError = (text, act) => `<div class="va-ai-error" role="alert">${ICON.alert}<span>${esc(text)}</span><button class="va-link" type="button" data-act="${act}">${ICON.retry}Try again</button></div>`;
  function renderVariants() {
    renderCopyAction();
    if (state.draftsStatus === 'loading') {
      els.variants.innerHTML = Array.from({ length: 3 }, (_, i) => `<div class="va-variant va-variant--skeleton" style="--i:${i}" aria-hidden="true"><span class="va-line va-line--lg va-shimmer"></span><span class="va-line va-line--lg va-shimmer" style="width:70%"></span><span class="va-line va-shimmer"></span></div>`).join('');
      return;
    }
    if (state.draftsStatus === 'error') {
      const sug = state.suggestion;
      els.variants.innerHTML = aiError(state.draftsError, 'retry-drafts') + (sug && sug.style !== state.style ? `<p class="va-suggest va-suggest--ai">${ICON.sparkle}<span class="va-suggest__text">${esc(sug.text)}</span><button class="es-btn es-btn--sm es-btn--secondary" type="button" data-pick="${esc(sug.style)}">Use ${esc(sug.label)}</button></p>` : '');
      return;
    }
    if (!state.variants.length) { els.variants.innerHTML = ''; return; }
    const fixed = state.autoFixed || [];
    const sug = state.suggestion;
    const sugLine = sug && sug.style !== state.style ? `<p class="va-suggest va-suggest--ai">${ICON.sparkle}<span class="va-suggest__text">${esc(sug.text)}</span><button class="es-btn es-btn--sm es-btn--secondary" type="button" data-pick="${esc(sug.style)}">Use ${esc(sug.label)}</button></p>` : '';
    els.variants.innerHTML = sugLine + `<p class="va-ai__label">Pick one to use. Hover to preview.</p>`
      + state.variants.map((v, i) => variantCard(v, i, { applied: state.appliedVariant === i })).join('')
      + (fixed.length ? `<p class="va-hint va-autofixed">${ICON.check}<span>Auto-fixed: ${esc(fixed.slice(0, 2).join(' · '))}</span></p>` : '');
  }
  async function generateDrafts() {
    if (state.draftsStatus === 'loading' || aiBusyText()) return;
    openAi({ focus: false });
    state.aiView = 'options';
    state.draftsStatus = 'loading';
    state.autoFixed = [];
    renderVariants();
    renderSteps();
    const c = copyContext();
    const notes = els.notes.value.trim();
    const sport = c.sport || brand().sport || '';
    const body = {
      mode: 'copy',
      brandId: state.brandId,
      sport,
      style: state.style,
      color: c.color || undefined,
      colorLabel: c.colorLabel || undefined,
      teams: c.teams.length ? c.teams.slice(0, 12) : undefined,
      team: c.teams[0] || undefined,
      trend: c.trend ? { id: c.trend.id, title: c.trend.title, sport: c.trend.sport, url: c.trend.url || '', related: (c.trend.related || []).slice(0, 4).map(r => ({ title: typeof r === 'string' ? r : r?.title })) } : undefined,
      title: c.trend?.title || undefined,
      clip: clipText() ? { text: clipText() } : undefined,
      notes: notes || undefined,
      // Facts for the no-footage styles: other trending headlines, what the editor typed.
      headlines: relatedTitles().slice(0, 8),
      items: state.items.filter(x => String(x || '').trim()),
      stat: state.stat || undefined,
      quote: state.quote || undefined,
      hasClip: Boolean(realVideo.videoWidth) && !still,
    };
    try {
      const data = await callApi(body);
      if (data.suggestion) { state.suggestion = data.suggestion; renderSuggest(); }
      state.variants = (data.variants || []).filter(v => v && (v.headline || (S.isNew(v.style) && S.styleReady(v.style, resolvedCopy({ ...state, ...variantFields(v) })).ok))).slice(0, 3);
      state.appliedVariant = -1;
      state.autoFixed = (Array.isArray(data.autoFixed) ? data.autoFixed : []).map(f => (typeof f === 'string' ? f : f?.note)).filter(Boolean);
      state.draftsStatus = state.variants.length ? 'done' : 'error';
      if (!state.variants.length) state.draftsError = 'The AI came back empty.';
      logEvent('copy_generated', {
        style: state.style,
        context: { kind: c.kind, color: c.color, teams: c.teams.slice(0, 12), trend: c.trend?.title || '' },
        notes,
        variants: state.variants.map(v => copyForLog(variantFields(v))),
        issues: Array.isArray(data.issues) ? data.issues.slice(0, 10) : [],
        autoFixed: Array.isArray(data.autoFixed) ? data.autoFixed.slice(0, 10) : [],
      });
    } catch (error) {
      state.draftsStatus = 'error';
      state.draftsError = error.message;
      if (error.data?.suggestion) { state.suggestion = error.data.suggestion; renderSuggest(); }
    }
    renderVariants();
    renderSteps();
  }
  els.notes.addEventListener('input', () => { renderAi(); suggestSoon(); });
  els.notes.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); generateDrafts(); } });
  els.aiActions.addEventListener('click', event => {
    const b = event.target.closest('[data-ai]');
    if (!b || b.disabled) return;
    if (b.dataset.ai === 'write') generateDrafts();
    else if (b.dataset.ai === 'grammar') checkGrammar();
    else sendChat(b.dataset.say || b.textContent);
  });

  // Hover or focus an option: show it in the preview. "Use this" keeps it.
  function draftFrom(card) {
    if (card.dataset.scope === 'drafts') return state.variants[Number(card.dataset.v)];
    const [, m, j] = card.dataset.scope.split(':').map(Number);
    return state.chat[m]?.variants?.[j];
  }
  function previewDraft(card) {
    const v = card && draftFrom(card);
    previewCopy = v ? variantFields(v) : null;
    if (previewCopy) {
      const cta = previewCopy.cta && previewCopy.cta.toUpperCase() !== brand().cta ? previewCopy.cta : state.cta;
      previewCopy = { ...previewCopy, cta, unsubscribe: state.unsubscribe, body: [0, 1, 2].map(i => String(previewCopy.body[i] || '')) };
    }
    els.stage.classList.toggle('is-previewing', Boolean(previewCopy));
    relayout();
  }
  [els.variants, els.thread].forEach(root => {
    root.addEventListener('pointerover', event => {
      if (event.pointerType !== 'mouse') return;
      const card = event.target.closest('.va-variant[data-v]');
      if (card && !card.classList.contains('is-applied')) previewDraft(card);
      else if (!card && previewCopy) previewDraft(null);
    });
    root.addEventListener('pointerleave', () => { if (previewCopy) previewDraft(null); });
    root.addEventListener('focusin', event => { const card = event.target.closest('.va-variant[data-v]'); if (card && !card.classList.contains('is-applied')) previewDraft(card); });
    root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget) && previewCopy) previewDraft(null); });
    root.addEventListener('click', event => {
      const act = event.target.closest('[data-act]')?.dataset.act;
      if (act === 'retry-drafts') { generateDrafts(); return; }
      const pick = event.target.closest('[data-pick]');
      if (pick) { pickStyle(pick.dataset.pick, { from: 'suggestion' }); renderVariants(); return; }
      const use = event.target.closest('[data-use]');
      if (!use) return;
      const card = use.closest('.va-variant');
      const v = draftFrom(card);
      if (!v) return;
      const fields = variantFields(v);
      applyCopy(fields, { label: 'Copy in the ad' });
      state.appliedVariant = card.dataset.scope === 'drafts' ? Number(card.dataset.v) : -1;
      state.aiCopy = copyForLog({ ...state });
      logEvent('copy_applied', { index: state.appliedVariant, from: card.dataset.scope === 'drafts' ? 'options' : 'assistant', copy: state.aiCopy });
      renderVariants();
      renderSteps();
    });
  });

  // ─── Grammar: AI check (cheapest model), each fix one click ─────────────
  const FIELD_NAME = { headline: 'Headline', highlight: 'Highlight', body: 'Body', cta: 'Button' };
  const issueField = i => (i.field === 'body' ? `${FIELD_NAME.body}${state.body.filter(s => s.trim()).length > 1 ? ` ¶${i.index + 1}` : ''}` : FIELD_NAME[i.field] || i.field);
  const fieldText = (field, index) => (field === 'body' ? state.body[index] || '' : state[field] || '');
  // Writes one field and refreshes the preview, counts and checks (with undo).
  function setFieldText(field, index, text) {
    snapshot();
    if (field === 'body') state.body[index] = text; else state[field] = text;
    state.copyEdited = true;
    syncFields();
    relayout();
    changed();
  }
  function applyGrammarIssue(issue) {
    const now = fieldText(issue.field, issue.index);
    if (!now.includes(issue.original)) { issue.state = 'stale'; return false; }
    if (issue.field === 'body') state.body[issue.index] = now.replace(issue.original, issue.suggestion);
    else state[issue.field] = now.replace(issue.original, issue.suggestion);
    issue.state = 'fixed';
    return true;
  }
  function fixGrammar(indexes) {
    const before = copyForLog(state);
    snapshot();
    const fixed = indexes.map(i => state.grammar.issues[i]).filter(issue => issue && !issue.state && applyGrammarIssue(issue)).length;
    if (!fixed) { undoStack.pop(); renderGrammar(); return; }
    state.copyEdited = true;
    syncFields();
    relayout();
    changed();
    renderGrammar();
    lintAll();
    toast(fixed === 1 ? 'Fixed.' : `Fixed ${fixed} issues.`, { action: { label: 'Undo', fn: () => { undo(); state.grammar.issues.forEach(i => { if (i.state === 'fixed') i.state = ''; }); renderGrammar(); } } });
    logEvent('copy_edited', { before, after: copyForLog(state), from: 'grammar', fixes: fixed });
  }
  function renderGrammar() {
    const g = state.grammar;
    if (g.status === 'error') { els.grammar.innerHTML = aiError(g.error, 'retry-grammar'); return; }
    if (g.status !== 'done') { els.grammar.innerHTML = ''; return; }
    if (!g.issues.length) { els.grammar.innerHTML = `<p class="va-gram__clean">${ICON.check}<span>No grammar issues found</span></p>`; return; }
    const open = g.issues.filter(i => !i.state).length;
    els.grammar.innerHTML = `<div class="va-gram__head"><p class="va-ai__label">${open ? `${open} suggestion${open === 1 ? '' : 's'}` : `${ICON.check}All fixed`}</p>${open > 1 ? '<button class="es-btn es-btn--sm" type="button" data-gfix="all">Fix all</button>' : ''}</div>
      <ul class="va-gram__list">${g.issues.map((i, n) => `<li class="va-gram__item${i.state ? ` is-${i.state}` : ''}">
        <div class="va-gram__main">
          <span class="va-gram__field">${esc(issueField(i))}</span>
          <span class="va-gram__diff"><del>${esc(i.original)}</del><span aria-hidden="true">→</span><span class="va-sr">should be</span><ins>${esc(i.suggestion)}</ins></span>
          <span class="va-gram__why">${esc(i.reason)}</span>
        </div>
        ${i.state === 'fixed' ? `<span class="va-gram__done">${ICON.check}Fixed</span>` : i.state === 'stale' ? '<span class="va-gram__done is-stale">Text changed</span>' : `<button class="es-btn es-btn--sm" type="button" data-gfix="${n}" aria-label="Fix: ${esc(i.original)} to ${esc(i.suggestion)}">Fix</button>`}
      </li>`).join('')}</ul>`;
  }
  async function checkGrammar() {
    if (aiBusyText()) return;
    openAi({ focus: false });
    state.aiView = 'grammar';
    const copy = { headline: state.headline, highlight: state.style === 'highlight' ? state.highlight : '', body: state.body.filter(s => s.trim()), cta: state.cta || '' };
    if (![copy.headline, copy.highlight, ...copy.body, copy.cta].some(s => s.trim())) {
      state.grammar = { status: 'error', issues: [], error: 'Write some copy first, then check it.' };
      renderGrammar(); renderAi();
      return;
    }
    // Body indexes from the server refer to the non-empty paragraphs sent.
    const bodyMap = state.body.map((s, i) => (s.trim() ? i : -1)).filter(i => i >= 0);
    state.grammar = { status: 'loading', issues: [], error: '' };
    renderGrammar(); renderAi(); renderSteps();
    try {
      const data = await callApi({ mode: 'grammar', brandId: state.brandId, copy });
      const issues = (Array.isArray(data.issues) ? data.issues : [])
        .filter(i => i && typeof i.original === 'string' && typeof i.suggestion === 'string' && FIELD_NAME[i.field])
        .map(i => ({ field: i.field, index: i.field === 'body' ? bodyMap[Number(i.index) || 0] : undefined, original: i.original, suggestion: i.suggestion, reason: String(i.reason || ''), state: '' }))
        .filter(i => i.field !== 'body' || Number.isInteger(i.index))
        .slice(0, 8);
      issues.forEach(i => { if (!fieldText(i.field, i.index).includes(i.original)) i.state = 'stale'; });
      state.grammar = { status: 'done', issues, error: '' };
    } catch (error) {
      state.grammar = { status: 'error', issues: [], error: error.message };
    }
    renderGrammar(); renderAi(); renderSteps();
  }
  els.grammar.addEventListener('click', event => {
    if (event.target.closest('[data-act="retry-grammar"]')) { checkGrammar(); return; }
    const b = event.target.closest('[data-gfix]');
    if (!b) return;
    const which = b.dataset.gfix === 'all' ? state.grammar.issues.map((_, i) => i) : [Number(b.dataset.gfix)];
    fixGrammar(which);
    // Keep focus in the list: the next Fix, else Fix all's slot, else the panel.
    (els.grammar.querySelector('[data-gfix]') || els.aiActions.querySelector('[data-ai="grammar"]'))?.focus({ preventScroll: true });
  });

  // ─── Instant checks while typing (free, in the browser) ─────────────────
  // Conservative on purpose: each rule only fires on clear mistakes. ALL-CAPS
  // is fine (ad headlines), and the button is uppercase by design.
  const ABBREV = /(?:^|\s)(?:vs|etc|e\.g|i\.e|a\.m|p\.m|mr|mrs|ms|dr|jr|sr|st|no|approx)\.$/i;
  const A_EXCEPT = /^(?:u[bcfhklmnprstvz][aeiouy]|uni|use|usu|uti|eu|ewe|one|once|ufo|uk\b)/i;
  const AN_EXCEPT = /^(?:hour|honest|honor|honour|heir|herb)/i;
  const DOUBLE_OK = new Set(['that', 'had', 'is', 'do', 'bye', 'very', 'go', 'ha', 'no', 'so']);
  const caseLike = (src, word) => (src[0] === src[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word);
  function lintText(text, field) {
    const out = [];
    const add = (at, len, msg, fix) => out.push({ at, len, msg, fix });
    if (!text || !text.trim()) return out;
    let m;
    // Repeated words: "the the".
    const rep = /\b([A-Za-z']+)(\s+)\1\b/gi;
    while ((m = rep.exec(text))) {
      if (DOUBLE_OK.has(m[1].toLowerCase())) continue;
      add(m.index, m[0].length, `Repeated word “${m[1]}”`, m[1]);
    }
    // Double spaces.
    const dbl = / {2,}/g;
    while ((m = dbl.exec(text))) add(m.index, m[0].length, 'Double space', ' ');
    // Space before punctuation: "free ,".
    const before = /([^\s.])( +)([,.!?;:])(?=\s|$)/g;
    while ((m = before.exec(text))) add(m.index + 1, m[2].length + 1, `Space before “${m[3]}”`, m[3]);
    // Missing space after punctuation: "free,every" / "today.Sign".
    const after = /([,;!?])(?=[A-Za-z])|(?<=[a-z]{2})(\.)(?=[A-Z][a-z])/g;
    while ((m = after.exec(text))) add(m.index, 1, `Add a space after “${m[0]}”`, `${m[0]} `);
    if (field !== 'cta' && field !== 'highlight') {
      // Sentence start: lowercase after . ! ? (or at the very start).
      const cap = /(^|[.!?]["'”’)]?\s+)(["'“‘(]?)([a-z])(?=[a-z]*[\s,.!?;:'’]|[a-z]*$)/g;
      while ((m = cap.exec(text))) {
        const lead = text.slice(0, m.index + m[1].length).trimEnd();
        if (m[1] && ABBREV.test(lead)) continue;
        // Brand-style words with inner capitals ("iPhone") are left alone.
        const word = text.slice(m.index + m[1].length + m[2].length).match(/^[\p{L}']+/u)?.[0] || '';
        if (/\p{Lu}/u.test(word)) continue;
        add(m.index + m[1].length + m[2].length, 1, 'Start the sentence with a capital', m[3].toUpperCase());
      }
    }
    if (field !== 'cta') {
      // "i" as a pronoun.
      const pron = /(^|[\s"“(])(i)(?=$|[\s,.!?;:]|['’](?:m|ve|ll|d)\b)/g;
      while ((m = pron.exec(text))) add(m.index + m[1].length, 1, 'Capitalize “I”', 'I');
      // a / an before a vowel sound (conservative; acronyms and ALL-CAPS words are skipped).
      const art = /(^|[^\p{L}'’])(a|an|A|An)\s+([\p{L}][\p{L}'’-]*)/gu;
      while ((m = art.exec(text))) {
        const [, pre, article, word] = m;
        art.lastIndex = m.index + pre.length + article.length; // allow "a an apple" overlaps
        if (word.length > 1 && word === word.toUpperCase()) continue;
        if (/^A/.test(article) && pre && !/[.!?]\s*$/.test(text.slice(0, m.index + pre.length))) continue; // "Plan A ..."
        const vowel = /^[aeiou]/i.test(word);
        const at = m.index + pre.length;
        if (article.toLowerCase() === 'a' && vowel && !A_EXCEPT.test(word)) add(at, article.length, `Use “${caseLike(article, 'an')}” before “${word}”`, caseLike(article, 'an'));
        if (article.toLowerCase() === 'an' && !vowel && !AN_EXCEPT.test(word)) add(at, article.length, `Use “${caseLike(article, 'a')}” before “${word}”`, caseLike(article, 'a'));
      }
    }
    // Unmatched brackets and quotes (no automatic fix: the right spot is a judgement call).
    const pairs = [['(', ')', 'bracket'], ['[', ']', 'bracket'], ['“', '”', 'quote']];
    pairs.forEach(([o, c, kind]) => {
      const n = text.split(o).length - text.split(c).length;
      if (n) add(-1, 0, `Unmatched ${kind} “${n > 0 ? o : c}”`, null);
    });
    if ((text.match(/"/g) || []).length % 2) add(-1, 0, 'Unmatched quote “"”', null);
    // No duplicates, in reading order (bracket notes last), at most 3 per field.
    const seen = new Set();
    return out.filter(i => { const k = `${i.at}|${i.msg}`; return seen.has(k) ? false : Boolean(seen.add(k)); }).sort((a, b) => (a.at < 0) - (b.at < 0) || a.at - b.at).slice(0, 3);
  }
  const lintEls = { headline: $('va-lint-headline'), highlight: $('va-lint-highlight'), body: $('va-lint-body'), cta: $('va-lint-cta') };
  const lintSig = {};
  function lintField(field) {
    const box = lintEls[field];
    if (!box) return;
    const sources = field === 'body' ? state.body.map((t, i) => ({ text: t, index: i })) : [{ text: state[field] || '', index: undefined }];
    if (field === 'highlight' && state.style !== 'highlight') sources.length = 0;
    const multi = field === 'body' && state.body.filter(s => s.trim()).length > 1;
    const items = sources.flatMap(s => lintText(s.text, field).map(i => ({ ...i, index: s.index, multi })));
    const sig = JSON.stringify(items.map(i => [i.index, i.at, i.msg]));
    if (sig === lintSig[field]) return; // unchanged: don't re-announce
    lintSig[field] = sig;
    box.hidden = !items.length;
    box.innerHTML = items.map(i => `<li class="va-warn va-lint__item"><span>${i.multi ? `¶${i.index + 1} · ` : ''}${esc(i.msg)}</span>${i.fix != null ? `<button class="va-link" type="button" data-lfix="${esc(field)}" data-index="${i.index ?? ''}" data-at="${i.at}" data-len="${i.len}" data-with="${esc(i.fix)}" aria-label="Fix: ${esc(i.msg)}">Fix</button>` : ''}</li>`).join('');
  }
  function lintAll() { Object.keys(lintEls).forEach(lintField); }
  let lintTimer = 0;
  const lintSoon = field => { clearTimeout(lintTimer); lintTimer = setTimeout(() => (field ? lintField(field) : lintAll()), 350); };
  Object.values(lintEls).forEach(box => box?.addEventListener('click', event => {
    const b = event.target.closest('[data-lfix]');
    if (!b) return;
    const field = b.dataset.lfix;
    const index = b.dataset.index === '' ? undefined : Number(b.dataset.index);
    const text = fieldText(field, index);
    const at = Number(b.dataset.at);
    const len = Number(b.dataset.len);
    const next = text.slice(0, at) + b.dataset.with + text.slice(at + len);
    setFieldText(field, index, next);
    lintField(field);
    toast('Fixed.', { action: { label: 'Undo', fn: () => { undo(); lintAll(); } }, timeout: 2600 });
    const input = field === 'body' ? els.bodies[index] : els[field];
    (box.querySelector('[data-lfix]') || input)?.focus({ preventScroll: true });
  }));

  // Chat (inside Ask AI).
  const lastPatchIndex = () => { for (let i = state.chat.length - 1; i >= 0; i -= 1) if (state.chat[i].patch) return i; return -1; };
  function renderThread() {
    const last = lastPatchIndex();
    els.thread.innerHTML = state.chat.map((m, mi) => {
      if (m.pending) return `<li class="va-msg va-msg--assistant"><span class="va-msg__avatar" aria-hidden="true">${ICON.sparkle}</span><div class="va-msg__bubble va-msg__bubble--typing"><span class="va-sr">Ask AI is writing</span>${dots}</div></li>`;
      if (m.role === 'user') return `<li class="va-msg va-msg--user"><div class="va-msg__bubble"><p>${esc(m.content)}</p></div></li>`;
      const fields = m.patch ? Object.keys(m.patch).filter(k => m.patch[k] != null) : [];
      return `<li class="va-msg va-msg--assistant${m.error ? ' is-error' : ''}"><span class="va-msg__avatar" aria-hidden="true">${m.error ? ICON.alert : ICON.sparkle}</span><div class="va-msg__bubble">
        ${String(m.content || '').split(/\n{2,}/).map(p => `<p>${esc(p)}</p>`).join('')}
        ${fields.length ? `<p class="va-msg__applied">${ICON.check}<span>Changed ${esc(fields.join(', '))}${m.undone ? ' (undone)' : ''}</span>${!m.undone && mi === last ? `<button class="va-link" type="button" data-undo="${mi}">${ICON.undo}Undo</button>` : ''}</p>` : ''}
        ${m.retry ? `<button class="va-link" type="button" data-retry="${mi}">${ICON.retry}Try again</button>` : ''}
      </div></li>
      ${(m.variants || []).length ? `<li class="va-msg va-msg--cards">${m.variants.map((v, j) => variantCard(v, j, { scope: `chat:${mi}:${j}` })).join('')}</li>` : ''}`;
    }).join('');
    els.thread.scrollTop = els.thread.scrollHeight;
    renderAi();
  }
  async function sendChat(text) {
    const content = String(text || '').trim();
    if (!content || aiBusyText()) return null;
    openAi({ focus: false });
    state.aiView = 'chat';
    state.chat.push({ role: 'user', content });
    state.chat.push({ role: 'assistant', pending: true });
    state.chatBusy = true;
    renderThread();
    renderSteps();
    let result = null;
    try {
      const c = copyContext();
      const notes = els.notes.value.trim();
      const messages = state.chat.filter(m => !m.pending && !m.error).map(m => ({ role: m.role, content: m.content })).slice(-12);
      const data = await callApi({
        mode: 'chat', brandId: state.brandId, sport: c.sport || brand().sport || '',
        trend: c.trend ? { id: c.trend.id, title: c.trend.title, sport: c.trend.sport } : (contextLabel() ? { title: contextLabel(), sport: c.sport } : undefined),
        color: c.color || undefined, teams: c.teams.length ? c.teams.slice(0, 12) : undefined,
        notes: notes || undefined,
        layout: { ...copyForLog(), style: state.style, headline: state.headline, highlight: state.highlight, body: state.body.filter(s => s.trim()), cta: state.cta || brand().cta },
        messages,
      });
      const msg = { role: 'assistant', content: data.reply || 'Done.', variants: (data.variants || []).filter(v => v && v.headline) };
      const patch = data.patch && typeof data.patch === 'object' && Object.keys(data.patch).length ? data.patch : null;
      state.chat[state.chat.length - 1] = msg;
      if (patch) {
        msg.patch = patch;
        applyCopy(patch, { label: 'Ask AI changed the ad' });
      }
      result = msg;
    } catch (error) {
      state.chat[state.chat.length - 1] = { role: 'assistant', content: error.message, error: true, retry: content };
    }
    state.chatBusy = false;
    renderThread();
    renderSteps();
    return result;
  }
  const autoGrow = () => { els.ask.style.height = 'auto'; els.ask.style.height = `${Math.min(140, els.ask.scrollHeight)}px`; };
  els.compose.addEventListener('submit', event => {
    event.preventDefault();
    const text = els.ask.value;
    if (!text.trim() || aiBusyText()) return;
    els.ask.value = '';
    autoGrow();
    sendChat(text);
  });
  els.ask.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); els.compose.requestSubmit(); }
  });
  els.ask.addEventListener('input', autoGrow);
  els.thread.addEventListener('click', event => {
    const u = event.target.closest('[data-undo]');
    if (u) { const m = state.chat[Number(u.dataset.undo)]; undo(); if (m) m.undone = true; renderThread(); return; }
    const r = event.target.closest('[data-retry]');
    if (r) { const i = Number(r.dataset.retry); const text = state.chat[i]?.retry; state.chat.splice(i - 1, 2); sendChat(text); }
  });

  // Inline editor.
  let typingSnap = 0;
  const snapOnFirstKey = () => { if (Date.now() - typingSnap > 4000) snapshot(); typingSnap = Date.now(); };
  const editField = (el, fn) => {
    el.addEventListener('beforeinput', snapOnFirstKey);
    el.addEventListener('input', () => { fn(); state.copyEdited = true; settlePreview(); if (el.tagName === 'TEXTAREA') fitBox(el); relayout(); changed(); lintSoon(); });
  };
  editField(els.headline, () => { state.headline = els.headline.value; });
  editField(els.highlight, () => { state.highlight = els.highlight.value; });
  els.bodies.forEach((box, i) => editField(box, () => { state.body[i] = box.value; }));
  editField(els.cta, () => { state.cta = els.cta.value; });
  els.unsub.addEventListener('change', () => { snapshot(); state.unsubscribe = els.unsub.checked; relayout(); changed(); });
  els.addPara.addEventListener('click', () => {
    const box = els.bodies.find((b, i) => i > 0 && b.hidden);
    if (!box) return;
    box.hidden = false;
    box.dataset.open = '1';
    box.focus();
    els.addPara.hidden = els.bodies.every(b => !b.hidden);
  });

  // Copy step: optional team colour (an "Any" swatch clears it).
  function renderCopySwatches() {
    if (!els.copySwatches) return; // colour now lives only in the Clip step
    const sport = brand().sport || 'cfb';
    const colors = availableColors(sport);
    if (state.copyColor && !colors.some(c => c.id === state.copyColor)) state.copyColor = '';
    const any = !state.copyColor;
    els.copySwatches.innerHTML = `<button class="va-swatch va-swatch--any" type="button" role="radio" data-copycolor="" aria-checked="${any}" tabindex="${any ? 0 : -1}"><span class="va-swatch__dot" aria-hidden="true"></span><span class="va-swatch__label">Any</span></button>`
      + colors.map(c => {
        const on = c.id === state.copyColor;
        return `<button class="va-swatch" type="button" role="radio" data-copycolor="${esc(c.id)}" aria-checked="${on}" tabindex="${on ? 0 : -1}" style="--sw:${esc(c.hex)}"><span class="va-swatch__dot" aria-hidden="true"></span><span class="va-swatch__label">${esc(c.label)}</span></button>`;
      }).join('');
  }
  // Copy step: optional trending moment (inside a fold; loads on open).
  function renderMoments() {
    const t = state.copyTrend;
    els.momentSum.textContent = t ? `Moment: ${t.title}` : 'Trending moment';
    renderAi();
    if (!els.momentFold.open) return;
    if (state.trendsStatus === 'loading' || state.trendsStatus === 'idle') { els.copyMoments.innerHTML = `<li class="va-working">${dots}Loading trends…</li>`; return; }
    if (state.trendsStatus === 'error') { els.copyMoments.innerHTML = `<li class="va-moment-row va-moment-row--note">Trends didn’t load. <button class="va-link" type="button" data-act="retry-trends">Try again</button></li>`; return; }
    const sport = brand().sport;
    const list = [...trendItems].sort((a, b) => (b.sport === sport) - (a.sport === sport)).slice(0, 8);
    if (!list.length) { els.copyMoments.innerHTML = '<li class="va-moment-row va-moment-row--note">Nothing trending right now. A team colour works too.</li>'; return; }
    els.copyMoments.innerHTML = list.map(item => {
      const on = t?.id === item.id;
      return `<li><button class="va-moment-row${on ? ' is-on' : ''}" type="button" data-moment="${esc(item.id)}" aria-pressed="${on}">${leagueTile(item.sport)}<span class="va-moment-row__title">${esc(item.title)}</span>${on ? ICON.check : ''}</button></li>`;
    }).join('');
  }
  els.momentFold.addEventListener('toggle', () => {
    if (els.momentFold.open && state.trendsStatus === 'idle') loadTrends();
    renderMoments();
  });
  els.copyMoments.addEventListener('click', event => {
    if (event.target.closest('[data-act="retry-trends"]')) { loadTrends(); return; }
    const b = event.target.closest('[data-moment]');
    if (!b) return;
    const item = trendItems.find(x => x.id === b.dataset.moment);
    state.copyTrend = state.copyTrend?.id === item?.id ? null : item;
    renderMoments();
  });

  // Live hints under the editor fields.
  const wordCount = text => plain(text).trim().split(/\s+/).filter(Boolean).length;
  function renderCounts() {
    const hw = wordCount(state.headline);
    els.headlineCount.textContent = `${hw} word${hw === 1 ? '' : 's'}${hw > 22 ? ' · keep it under 22' : ''}`;
    els.headlineCount.classList.toggle('is-over', hw > 22);
    const bw = state.body.reduce((n, p) => n + wordCount(p), 0);
    els.bodyCount.textContent = `${bw} word${bw === 1 ? '' : 's'}${bw > 95 ? ' · keep it under 95' : ''}`;
    els.bodyCount.classList.toggle('is-over', bw > 95);
    const cl = (state.cta || '').length;
    els.ctaCount.textContent = cl ? `${cl} / 40` : `Default: ${brand().cta}`;
  }

  // ─── 3 Export ────────────────────────────────────────────────────────────
  let exporting = null;
  // The test set: the chosen copy in 2–3 styles (only styles it can fill).
  const gridReady = id => S.styleReady(id, resolvedCopy({ ...state, style: id }));
  function gridStyles() {
    if (!state.grid.on) return [state.style];
    const picked = state.grid.styles.filter(id => B.STYLES[id] && gridReady(id).ok);
    return picked.length ? picked : [state.style];
  }
  // Default set: this style, then the suggestion's picks, then any ready style.
  function defaultGrid() {
    const sug = state.suggestion || localSuggestion();
    const order = [state.style, sug?.style, ...(sug?.alternatives || []).map(a => a.style), ...STYLE_IDS].filter(Boolean);
    return [...new Set(order)].filter(id => gridReady(id).ok).slice(0, 3);
  }
  const angle = () => (state.appliedVariant >= 0 ? state.appliedVariant + 1 : 0);
  function renderGrid() {
    els.grid.checked = state.grid.on;
    els.gridStyles.hidden = !state.grid.on;
    if (!state.grid.on) { els.gridNames.textContent = ''; return; }
    els.gridStyles.innerHTML = STYLE_IDS.map(id => {
      const r = gridReady(id);
      const on = state.grid.styles.includes(id) && r.ok;
      return `<button class="va-chip" type="button" data-grid="${esc(id)}" aria-pressed="${on}"${r.ok ? '' : ` aria-disabled="true" title="Needs ${esc(r.missing)}"`}>${esc(B.STYLES[id].label)}${r.ok ? '' : `<span class="va-sr"> (needs ${esc(r.missing)})</span>`}</button>`;
    }).join('');
    const styles = gridStyles();
    const first = S.fileName({ brand: brand(), style: styles[0], angle: angle(), size: B.SIZES[state.exportIds[0]] });
    els.gridNames.innerHTML = `${styles.length} style${styles.length === 1 ? '' : 's'} × ${state.exportIds.length} size${state.exportIds.length === 1 ? '' : 's'} = ${styles.length * state.exportIds.length} files, named like <code>${esc(first)}</code>. Use the same name for the Meta ad.`;
  }
  function renderExport() {
    [...els.exsizes.querySelectorAll('[data-ex]')].forEach(b => b.setAttribute('aria-pressed', String(state.exportIds.includes(b.dataset.ex))));
    renderGrid();
    const styles = gridStyles();
    const n = state.exportIds.length * styles.length;
    // A style missing its facts says so below; "too long" is only for styles that are ready.
    const tooLong = styles.filter(st => gridReady(st).ok).flatMap(st => state.exportIds.filter(id => !layoutFor(id, { ...state, style: st }).fits).map(id => `${B.STYLES[st].label} ${id.replace('x', ':')}`));
    const notReady = styles.map(st => ({ st, r: gridReady(st) })).filter(x => !x.r.ok);
    const notes = [];
    if (!hasClip()) notes.push(`<div class="va-notice">${ICON.film}<span><b>No clip yet.</b> Add one, or use an animated background: ${S.isNew(state.style) ? 'this style needs no footage.' : 'no footage needed.'}</span><span class="va-notice__acts"><button class="es-btn es-btn--sm es-btn--primary es-btn--still" type="button" data-act="make-animated">Animated background</button><button class="es-btn es-btn--sm" type="button" data-act="to-clip">Find a clip</button></span></div>`);
    if (notReady.length) notes.push(`<div class="va-notice va-notice--warn">${ICON.alert}<span><b>${esc(B.STYLES[notReady[0].st].label)} needs ${esc(notReady[0].r.missing)}.</b></span><button class="es-btn es-btn--sm" type="button" data-act="to-copy">Add it</button></div>`);
    if (tooLong.length) notes.push(`<div class="va-notice va-notice--warn">${ICON.alert}<span><b>Copy is too long</b> for ${esc(tooLong.slice(0, 3).join(', '))}.</span><button class="es-btn es-btn--sm" type="button" data-act="to-copy">Shorten</button></div>`);
    if (n > 6) notes.push(`<div class="va-notice">${ICON.alert}<span>${n} files record at once. Keep this tab visible; a slower computer may drop frames, so export fewer sizes if it stutters.</span></div>`);
    els.ready.innerHTML = notes.join('');
    els.ready.hidden = !notes.length;
    // No footage, nothing to license: the rights box only shows for a clip or photo.
    els.rightsRow.hidden = state.clip?.source === 'animated';
    els.metaToggle.setAttribute('aria-pressed', String(metaPreview));
    if (!exporting) {
      els.exportBtn.disabled = !hasClip() || notReady.length > 0;
      els.exportBtn.innerHTML = `${ICON.download}<span>Export ${n === 1 ? 'MP4' : `${n} MP4s`}</span>`;
    }
  }
  els.grid.addEventListener('change', () => {
    state.grid.on = els.grid.checked;
    if (state.grid.on && !state.grid.styles.filter(id => gridReady(id).ok).length) state.grid.styles = defaultGrid();
    if (state.grid.on && state.grid.styles.length < 2) toast('Only one style can use this copy so far. Fill in another style’s fields to test more.', { timeout: 4200 });
    renderExport();
    renderSteps();
  });
  els.gridStyles.addEventListener('click', event => {
    const b = event.target.closest('[data-grid]');
    if (!b || exporting) return;
    const id = b.dataset.grid;
    const r = gridReady(id);
    if (!r.ok) { toast(`${B.STYLES[id].label} needs ${r.missing}. Add it in Copy.`, { timeout: 3000 }); return; }
    const now = state.grid.styles.filter(x => gridReady(x).ok);
    if (now.includes(id)) {
      if (now.length > 1) state.grid.styles = now.filter(x => x !== id);
      else toast('Keep at least one style.', { timeout: 2000 });
    } else if (now.length >= 3) toast('Up to 3 styles in a test set.', { timeout: 2200 });
    else state.grid.styles = STYLE_IDS.filter(x => x === id || now.includes(x));
    renderExport();
    renderSteps();
  });
  els.exsizes.addEventListener('click', event => {
    const b = event.target.closest('[data-ex]');
    if (!b || exporting) return;
    const id = b.dataset.ex;
    if (state.exportIds.includes(id)) {
      if (state.exportIds.length > 1) state.exportIds = state.exportIds.filter(x => x !== id);
      else toast('Keep at least one size.', { timeout: 2000 });
    } else state.exportIds = ['9x16', '4x5', '1x1'].filter(x => x === id || state.exportIds.includes(x));
    renderExport();
    renderSteps();
  });
  els.ready.addEventListener('click', event => {
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'to-clip') goStep('clip');
    if (act === 'make-animated') { useStill('animated'); return; }
    if (act === 'to-copy') {
      goStep('copy');
      reveal(els.editor);
      (S.isNew(state.style) ? els.styleFields.querySelector('input, textarea') : els.headline)?.focus({ preventScroll: true });
    }
  });
  els.again.addEventListener('click', () => {
    els.files.hidden = true;
    els.again.hidden = true;
    els.exportStatus.textContent = '';
    goStep('copy');
  });

  async function startExport() {
    if (exporting) { exporting.cancel(); return; }
    if (!hasClip()) { els.exportStatus.textContent = 'Add a clip first.'; return; }
    if (!els.rights.checked && state.clip?.source !== 'animated') {
      els.exportStatus.textContent = 'Tick the footage box first.';
      const box = els.rights.closest('.va-check');
      els.rights.focus();
      box.classList.remove('is-nudge');
      void box.offsetWidth;
      box.classList.add('is-nudge');
      return;
    }
    const styles = gridStyles();
    const gridId = styles.length > 1 ? Math.random().toString(36).slice(2, 6) : '';
    const files = await exportSizes(state.exportIds, { styles });
    if (state.exported) {
      // Learn from what shipped (one export event per style, with its style),
      // and from any edits to the AI's version.
      const final = copyForLog();
      const fields = ({ style, ...rest }) => rest;
      if (state.aiCopy && JSON.stringify(state.aiCopy) !== JSON.stringify(final)) logEvent('copy_edited', { style: final.style, before: fields(state.aiCopy), after: fields(final) });
      styles.forEach(st => {
        const copy = copyForLog({ ...state, style: st });
        logEvent('export', {
          copy, style: st, sizes: [...state.exportIds], angle: angle(), ...(gridId ? { gridId, gridStyles: styles } : {}),
          files: (files || []).filter(f => f.style === st).map(f => f.fileName),
          clipSource: state.clip?.source || '', clipUrl: safeUrl(state.clip?.url), safeZone: S.isNew(st) ? 'meta' : state.safeZone,
          context: { kind: state.context.kind, color: state.context.color, trend: state.context.trend?.title || '' },
        });
      });
      els.again.hidden = false;
      reveal(els.exportStatus);
    }
  }
  els.exportBtn.addEventListener('click', startExport);

  // MediaRecorder; the clip's audio goes through Web Audio.
  let audioCtx = null;
  let audioSource = null;
  let monitor = null;
  let previewMuted = true;
  function audioGraph() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioSource = audioCtx.createMediaElementSource(realVideo);
      monitor = audioCtx.createGain();
      monitor.gain.value = previewMuted ? 0 : 1;
      audioSource.connect(monitor).connect(audioCtx.destination);
      // A muted element sends silence into Web Audio too: unmute it and let the
      // monitor gain decide what the speaker hears.
      realVideo.muted = false;
    }
    return audioCtx;
  }
  function pickFormat() {
    const options = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
    return options.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  }
  let fileUrls = [];


  // Records every (style × size) target in one real-time pass over the clip.
  // Resolves to the files written: [{ style, sizeId, fileName, href, mb }].
  async function exportSizes(sizeIds, { styles = [state.style] } = {}) {
    if (exporting) { exporting.cancel(); return null; }
    if (!hasClip()) { els.exportStatus.textContent = 'Add a clip first.'; return null; }
    if (!els.rights.checked && state.clip?.source !== 'animated') { els.exportStatus.textContent = 'Tick the footage confirmation first.'; els.rights.focus(); return null; }
    const mimeType = pickFormat();
    if (!mimeType) { els.exportStatus.textContent = 'This browser cannot record video. Use Chrome or Edge.'; return null; }
    await document.fonts.ready;
    setPlaying(false);
    const ac = audioGraph();
    await ac.resume();
    const audioDest = ac.createMediaStreamDestination();
    audioSource.connect(audioDest);
    const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    const targets = styles.flatMap(style => sizeIds.map(id => ({ id, style }))).map(({ id, style }) => {
      const s = B.SIZES[id];
      const canvas = document.createElement('canvas');
      canvas.width = s.width;
      canvas.height = s.height;
      const stream = canvas.captureStream(30);
      audioDest.stream.getAudioTracks().forEach(track => stream.addTrack(track.clone()));
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: id === '9x16' ? 12e6 : 10e6, audioBitsPerSecond: 128000 });
      const chunks = [];
      recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      return { id, style, s, canvas, ctx: canvas.getContext('2d'), blur: document.createElement('canvas'), layout: layoutFor(id, { ...state, style }), recorder, chunks, stream };
    });
    const span = Math.max(0.5, state.trimOut - state.trimIn);
    const bar = els.exportProgress.querySelector('span');
    els.exportProgress.hidden = false;
    bar.style.width = '0%';
    els.exportBtn.disabled = false;
    els.exportBtn.innerHTML = '<span>Cancel export</span>';
    els.exportBtn.classList.add('es-btn--danger');
    els.stage.classList.add('is-recording');
    els.files.hidden = true;
    els.exportStatus.textContent = 'Recording in real time. Keep this tab open and visible.';
    let cancelled = false;
    let finished = false;

    const done = new Promise(resolve => {
      let stopped = 0;
      targets.forEach(t => { t.recorder.onstop = () => { stopped += 1; if (stopped === targets.length) resolve(); }; });
    });
    const stopAll = () => {
      if (finished) return;
      finished = true;
      els.video.pause();
      targets.forEach(t => { if (t.recorder.state !== 'inactive') t.recorder.stop(); });
    };
    exporting = { cancel: () => { cancelled = true; stopAll(); } };
    // The frame callback can miss the very end (no frame lands after the last
    // one shown, or the tab was hidden), so 'ended' / 'timeupdate' also stop it.
    const guard = () => { if (!finished && (els.video.ended || els.video.currentTime >= state.trimOut - 0.04)) stopAll(); };
    els.video.addEventListener('timeupdate', guard);
    els.video.addEventListener('ended', guard);

    // The export always runs the timeline (reduced motion only calms the preview).
    const drawAll = () => {
      const t = Math.max(0, els.video.currentTime - state.trimIn);
      targets.forEach(x => R.drawFrame(x.ctx, { width: x.s.width, height: x.s.height, video: els.video, bg: bg(), ops: x.layout.ops, logoImage: logo.img, blurCanvas: x.blur, source: still ? still.source() : undefined, t, duration: span }));
    };
    const onVisibility = () => {
      if (document.hidden && !finished) { els.video.pause(); targets.forEach(t => t.recorder.state === 'recording' && t.recorder.pause()); els.exportStatus.textContent = 'Paused: come back to this tab to keep recording.'; }
      else if (!finished) { targets.forEach(t => t.recorder.state === 'paused' && t.recorder.resume()); els.video.play(); els.exportStatus.textContent = 'Recording in real time. Keep this tab open and visible.'; }
    };
    document.addEventListener('visibilitychange', onVisibility);

    await new Promise(resolve => { els.video.addEventListener('seeked', resolve, { once: true }); els.video.currentTime = state.trimIn; });
    drawAll();
    targets.forEach(t => t.recorder.start(1000));
    const tick = () => {
      if (finished) return;
      drawAll();
      draw();
      syncTime();
      const progress = (els.video.currentTime - state.trimIn) / span;
      bar.style.width = `${Math.min(100, Math.round(progress * 100))}%`;
      if (els.video.currentTime >= state.trimOut - 0.04 || els.video.ended) { stopAll(); return; }
      if (els.video.requestVideoFrameCallback) els.video.requestVideoFrameCallback(tick);
      else requestAnimationFrame(tick);
    };
    await els.video.play();
    tick();
    await done;
    document.removeEventListener('visibilitychange', onVisibility);
    els.video.removeEventListener('timeupdate', guard);
    els.video.removeEventListener('ended', guard);
    audioSource.disconnect(audioDest);
    targets.forEach(t => t.stream.getTracks().forEach(track => track.stop()));
    exporting = null;
    els.exportBtn.classList.remove('es-btn--danger');
    els.stage.classList.remove('is-recording');
    els.exportProgress.hidden = true;
    renderExport();
    if (cancelled) { els.exportStatus.textContent = 'Export cancelled.'; draw(); return null; }
    // {brand}_{style}_{angle}_{WxH}_{yyyymmdd}: the Meta ad name, so results join back later.
    const when = new Date();
    fileUrls.forEach(url => URL.revokeObjectURL(url));
    fileUrls = [];
    const rows = targets.map(t => {
      const blob = new Blob(t.chunks, { type: mimeType.split(';')[0] });
      const href = URL.createObjectURL(blob);
      fileUrls.push(href);
      const fileName = S.fileName({ brand: brand(), style: t.style, angle: angle(), size: t.s, date: when, ext });
      const a = document.createElement('a');
      a.href = href;
      a.download = fileName;
      document.body.append(a);
      a.click();
      setTimeout(() => a.remove(), 1000);
      return { style: t.style, sizeId: t.id, fileName, href, mb: blob.size / 1048576 };
    });
    els.files.hidden = false;
    els.files.innerHTML = rows.map(r => `<li><span class="va-files__icon" aria-hidden="true">${window.FrameUpMotion ? window.FrameUpMotion.check() : ICON.check}</span><span class="va-files__name">${esc(r.fileName)}</span><span class="va-meta">${r.mb.toFixed(1)} MB</span><a class="va-link" href="${r.href}" download="${esc(r.fileName)}">Download again</a></li>`).join('');
    els.exportStatus.textContent = ext === 'mp4'
      ? `Downloaded ${targets.length} MP4${targets.length > 1 ? 's' : ''} (${span.toFixed(1)}s).`
      : 'Downloaded as WebM: this browser can’t record MP4. Use Chrome or Edge for MP4.';
    state.exported = true;
    renderSteps();
    toast(`Exported ${targets.length} ${ext.toUpperCase()}${targets.length > 1 ? 's' : ''}`, { tone: 'good' });
    draw();
    // "Posted it?" card with the Meta ad name of every exported file, plus the export event (frameup-posted.js).
    try {
      const sizes = targets.map(t => `${t.s.width}x${t.s.height}`);
      const adNames = rows.map(r => r.fileName.replace(/\.[a-z0-9]+$/i, ''));
      const styles = [...new Set(rows.map(r => r.style))];
      window.FrameUpPosted?.exported?.({ source: 'video-ads', title: plain(state.headline).slice(0, 120), template: styles.join(','), style: styles.join(','), angle: angle(), brand: brand().id, sizes, adNames, aiMade: state.aiCopy ? 'video-ads' : '', count: rows.length });
    } catch (error) { /* never block an export */ }
    return rows;
  }

  // ─── Brand, sizes, Meta preview ──────────────────────────────────────────
  els.brands.innerHTML = B.AD_BRANDS.map(b => `<button type="button" role="radio" data-brand="${esc(b.id)}" aria-checked="false" title="${esc(b.label)} (${esc(SPORT_LABEL[b.sport] || '')})" aria-label="${esc(b.label)}, ${esc(SPORT_LABEL[b.sport] || '')}"><span class="va-dot" style="--c:${esc(b.wordmark?.bg || b.accent)}" aria-hidden="true"></span><span>${esc(b.short || b.label)}</span></button>`).join('');
  const markRadios = (group, attr, value) => [...group.querySelectorAll('[role="radio"]')].forEach(b => { const on = b.dataset[attr] === value; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  function setBrand(id) {
    state.brandId = B.byId(id).id;
    markRadios(els.brands, 'brand', state.brandId);
    els.cta.placeholder = brand().cta;
    els.stage.style.setProperty('--va-brand', brand().wordmark?.bg || brand().accent);
    els.stage.closest('.va-page')?.style.setProperty('--va-mark', brand().highlight.bg);
    paintPlaceholder();
    refreshLogo();
    // Claims belong to a brand: back to the new brand's approved list.
    state.us = null;
    if (els.styles.childElementCount) { renderStyleFields({ force: true }); suggestSoon(); }
    changed();
    if (railReady) syncRail();
  }
  // Radiogroups share one pattern (click + arrow keys).
  function radioGroup(group, attr, onPick) {
    group.addEventListener('click', event => {
      const button = event.target.closest(`[data-${attr}]`);
      if (button) onPick(button.dataset[attr]);
    });
    group.addEventListener('keydown', event => {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!(event.key in keys)) return;
      const list = [...group.querySelectorAll('[role="radio"]')];
      const i = list.indexOf(document.activeElement);
      if (i < 0) return;
      event.preventDefault();
      const next = list[(i + keys[event.key] + list.length) % list.length];
      next.click();
      // Re-rendered groups (swatches) replace their buttons: focus the new one.
      (group.querySelector(`[data-${attr}="${CSS.escape(next.dataset[attr])}"]`) || next).focus();
    });
  }
  radioGroup(els.brands, 'brand', id => { state.brandChosen = true; setBrand(id); if (state.step === 'copy') { renderCopySwatches(); renderMoments(); } });
  if (els.copySwatches) radioGroup(els.copySwatches, 'copycolor', color => { state.copyColor = color; renderCopySwatches(); });
  radioGroup(els.sizes, 'size', id => {
    state.size = id;
    markRadios(els.sizes, 'size', id);
    if (state.exportIds.length === 1) state.exportIds = [id];
    relayout();
    renderSteps();
    if (state.step === 'export') renderExport();
  });
  radioGroup(els.colorSport, 'sport', sport => {
    state.colorSport = sport;
    state.clipPicked = true;
    markRadios(els.colorSport, 'sport', sport);
    renderSwatches();
  });
  radioGroup(els.swatches, 'color', color => {
    state.color = color;
    state.clipPicked = true;
    renderSwatches();
  });
  radioGroup(els.teamSport, 'sport', sport => {
    state.teamSport = sport;
    state.clipPicked = true;
    markRadios(els.teamSport, 'sport', sport);
    renderTeamPicker();
  });
  radioGroup(els.teamList, 'team', name => { state.team = name; state.clipPicked = true; renderTeamPicker(); });
  // Sport radios and chips: league logo before the text (not on "All").
  document.querySelectorAll('#va-team-sport [data-sport], #va-color-sport [data-sport], #va-sports [data-sport]').forEach(b => { if (b.dataset.sport !== 'all') b.insertAdjacentHTML('afterbegin', leagueTile(b.dataset.sport)); });
  markRadios(els.sizes, 'size', state.size);
  markRadios(els.colorSport, 'sport', state.colorSport);

  // Safe zone overlay: where Meta's UI covers the ad.
  els.safeToggle.addEventListener('click', () => { safeOverlay = !safeOverlay; renderSafe(); });

  // Meta preview: frames the canvas as the placement it will run in.
  els.metaToggle.addEventListener('click', () => {
    metaPreview = !metaPreview;
    els.metaToggle.setAttribute('aria-pressed', String(metaPreview));
    renderMeta();
    fitCanvasDisplay();
  });

  // Transport
  els.play.addEventListener('click', () => setPlaying(!playing));
  // Preview sound only: once Web Audio owns the clip (after the first export),
  // muting turns the speaker down but the recording keeps the clip's audio.
  els.mute.addEventListener('click', () => {
    previewMuted = !previewMuted;
    if (monitor) monitor.gain.value = previewMuted ? 0 : 1;
    else els.video.muted = previewMuted;
    els.mute.setAttribute('aria-pressed', String(previewMuted));
    els.mute.setAttribute('aria-label', previewMuted ? 'Unmute preview' : 'Mute preview');
    els.mute.innerHTML = previewMuted ? ICON.soundOff : ICON.soundOn;
  });
  els.mini.addEventListener('click', () => {
    const on = !els.stage.classList.contains('is-mini');
    els.stage.classList.toggle('is-mini', on);
    els.mini.setAttribute('aria-pressed', String(on));
    els.mini.setAttribute('aria-label', on ? 'Enlarge preview' : 'Shrink preview');
    els.mini.title = on ? 'Enlarge preview' : 'Shrink preview';
  });

  // Keyboard: Space plays, I / O set the trim at the playhead.
  document.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : document.body;
    if (/^(input|textarea|select)$/i.test(target.tagName) || target.isContentEditable) return;
    if (event.code === 'Space') {
      if (/^(button|a|summary)$/i.test(target.tagName) || target.getAttribute('role') === 'slider') return;
      event.preventDefault();
      if (hasClip()) setPlaying(!playing);
      return;
    }
    if (!hasClip()) return;
    const key = event.key.toLowerCase();
    if (key === 'i') { event.preventDefault(); setTrim(els.video.currentTime, state.trimOut); toast(`Trim starts at ${fmtFine(state.trimIn)}`, { timeout: 1600 }); }
    if (key === 'o') { event.preventDefault(); setTrim(state.trimIn, els.video.currentTime); toast(`Trim ends at ${fmtFine(state.trimOut)}`, { timeout: 1600 }); }
  });


  // ─── Frame + Tint rail ───────────────────────────────────────────────────
  // Zoom / pan / Fill-Fit move the clip only; the copy and logo keep their
  // safe-zone layout. Tint washes the clip under the copy (see tintLayers in
  // video-ads-render.js). The export reads the same bg(), so it matches.
  railReady = true;
  const FRAME_DEFAULTS = { fit: 'fill', zoom: 1, panX: 0, panY: 0, tintId: 'black', tintAmount: 0.45 };
  const rail = {
    root: $('va-rail'), fit: $('va-fitmode'), zoom: $('va-zoom'), zoomVal: $('va-zoom-val'), zoomIn: $('va-zoom-in'), zoomOut: $('va-zoom-out'), center: $('va-center'),
    hint: $('va-pan-hint'), tint: $('va-tint'), tintVal: $('va-tint-val'), colors: $('va-tint-colors'), custom: $('va-tint-custom'), chip: $('va-tint-chip'), reset: $('va-look-reset'),
  };
  const hex6 = c => {
    const m = String(c || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return '';
    const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1];
    return `#${h.toUpperCase()}`;
  };
  // The team behind the ad: the team picked in By team, else the first team of the last search.
  function tintTeam() {
    let t = state.team ? (Array.isArray(T.TEAMS) ? T.TEAMS : []).find(x => x.name === state.team && x.sport === state.teamSport) : null;
    if (!t && state.context?.teams?.length) {
      const name = state.context.teams[0];
      t = finds[state.context.kind]?.teams?.find(x => x.name === name) || (Array.isArray(T.TEAMS) ? T.TEAMS : []).find(x => x.name === name) || null;
    }
    if (!t) return null;
    const c = (Array.isArray(t.colors) ? t.colors : []).map(hex6).find(Boolean);
    return c ? { hex: c, label: t.short || t.name } : null;
  }
  function tintOptions() {
    const b = brand();
    const team = tintTeam();
    return [
      { id: 'black', label: 'Black', hex: '#000000' },
      { id: 'navy', label: 'Navy', hex: '#0B2265' },
      { id: 'brand', label: `${b.short || b.label} brand colour`, hex: hex6(b.wordmark?.bg || b.accent) || '#000000' },
      team ? { id: 'team', label: `${team.label} team colour`, hex: team.hex } : null,
      { id: 'es', label: 'ES Blue', hex: '#0A6FDE' },
      { id: 'custom', label: 'Custom colour', hex: hex6(state.tintCustom) || '#0B2265' },
    ].filter(Boolean);
  }
  function tintColor() {
    const o = tintOptions().find(x => x.id === state.tintId);
    return o ? o.hex : '#000000';
  }
  let tintSig = '';
  function renderTint() {
    if (!railReady) return;
    const options = tintOptions();
    if (!options.some(o => o.id === state.tintId)) state.tintId = 'black';
    const sig = JSON.stringify([options, state.tintId]);
    rail.chip.style.setProperty('--sw', tintColor());
    if (sig === tintSig) return;
    tintSig = sig;
    const hadFocus = rail.colors.contains(document.activeElement);
    rail.colors.innerHTML = options.map(o => {
      const on = o.id === state.tintId;
      const custom = o.id === 'custom';
      return `<button class="va-rail__sw${custom ? ' va-rail__sw--custom' : ''}" type="button" role="radio" data-tint="${o.id}" aria-checked="${on}" tabindex="${on ? 0 : -1}" aria-label="${esc(o.label)}${custom ? `, ${o.hex}` : ''}" title="${esc(o.label)}" style="--sw:${esc(o.hex)}">${custom ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>' : ''}</button>`;
    }).join('');
    if (hadFocus) rail.colors.querySelector('[aria-checked="true"]')?.focus();
  }
  // Pan room on the 1080-wide canvas for the current framing (0 = nothing to move).
  function panRoom() {
    const s = size();
    // An animated background fills the frame: nothing to move.
    if (still && still.kind === 'animated') return { roomX: 0, roomY: 0 };
    const src = still ? still.image : hasClip() ? els.video : placeholder;
    return R.videoRect(src.videoWidth || src.width, src.videoHeight || src.height, s.width, s.height, { zoom: state.zoom, fit: state.fit }) || { roomX: 0, roomY: 0 };
  }
  let lookTimer = 0;
  function lookChanged({ commit = true } = {}) {
    syncRail();
    draw();
    clearTimeout(lookTimer);
    if (commit) lookTimer = setTimeout(changed, 250);
  }
  function syncRail() {
    const z = Math.round(state.zoom * 100);
    rail.zoom.value = String(z);
    rail.zoom.setAttribute('aria-valuetext', `${z}%`);
    rail.zoomVal.textContent = `${z}%`;
    rail.zoomOut.disabled = z <= 100;
    rail.zoomIn.disabled = z >= R.ZOOM_MAX * 100;
    const t = Math.round(state.tintAmount * 100);
    rail.tint.value = String(t);
    const name = tintOptions().find(o => o.id === state.tintId)?.label || 'Black';
    rail.tint.setAttribute('aria-valuetext', `${t}%, ${name}`);
    rail.tintVal.textContent = `${t}%`;
    // Filled part of the custom slider tracks.
    rail.zoom.style.setProperty('--p', `${((z - 100) / (R.ZOOM_MAX * 100 - 100)) * 100}%`);
    rail.tint.style.setProperty('--p', `${t}%`);
    markRadios(rail.fit, 'fit', state.fit);
    const room = panRoom();
    const movable = room.roomX > 0.5 || room.roomY > 0.5;
    els.canvas.classList.toggle('is-pannable', movable);
    rail.center.disabled = !state.panX && !state.panY;
    rail.hint.textContent = still && still.kind === 'animated' ? 'Framing moves clips and photos; tint works here too'
      : movable ? `Drag the ad or use arrow keys to move the ${still ? 'photo' : 'clip'}` : `Zoom in to move the ${still ? 'photo' : 'clip'}`;
    els.canvas.setAttribute('aria-label', `Ad preview. Clip ${state.fit === 'fit' ? 'fitted' : 'fills the frame'}, zoom ${z}%, tint ${t}% ${name}.`);
    renderTint();
  }
  const setZoom = z => {
    state.zoom = Math.max(1, Math.min(R.ZOOM_MAX, Math.round(z * 100) / 100));
    // Keep pan inside the new room.
    const room = panRoom();
    if (room.roomX < 0.5) state.panX = 0;
    if (room.roomY < 0.5) state.panY = 0;
  };
  rail.zoom.addEventListener('input', () => { setZoom(Number(rail.zoom.value) / 100); lookChanged(); });
  rail.zoomIn.addEventListener('click', () => { setZoom(state.zoom + 0.1); lookChanged(); });
  rail.zoomOut.addEventListener('click', () => { setZoom(state.zoom - 0.1); lookChanged(); });
  rail.center.addEventListener('click', () => { state.panX = 0; state.panY = 0; lookChanged(); });
  rail.tint.addEventListener('input', () => { state.tintAmount = Number(rail.tint.value) / 100; lookChanged(); });
  radioGroup(rail.fit, 'fit', fit => { state.fit = fit === 'fit' ? 'fit' : 'fill'; setZoom(state.zoom); lookChanged(); });
  rail.colors.addEventListener('click', event => {
    const b = event.target.closest('[data-tint]');
    if (!b) return;
    if (b.dataset.tint === 'custom') {
      // Opens the picker; the swatch is selected once a colour is chosen.
      if (state.tintId === 'custom' || !hex6(state.tintCustom)) rail.custom.click();
      else { state.tintId = 'custom'; lookChanged(); rail.custom.click(); }
      return;
    }
    state.tintId = b.dataset.tint;
    lookChanged();
  });
  rail.colors.addEventListener('keydown', event => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const list = [...rail.colors.querySelectorAll('[role="radio"]')];
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    if (event.key === 'Enter' && list[i].dataset.tint === 'custom') { event.preventDefault(); rail.custom.click(); return; }
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = list[(i + keys[event.key] + list.length) % list.length];
    if (next.dataset.tint !== 'custom') { state.tintId = next.dataset.tint; lookChanged(); }
    else { state.tintId = 'custom'; lookChanged(); }
    rail.colors.querySelector(`[data-tint="${next.dataset.tint}"]`)?.focus();
  });
  rail.custom.addEventListener('input', () => { state.tintCustom = hex6(rail.custom.value) || state.tintCustom; state.tintId = 'custom'; lookChanged(); });
  rail.reset.addEventListener('click', () => { Object.assign(state, FRAME_DEFAULTS); lookChanged(); toast('Frame and tint reset', { timeout: 1600 }); });

  // Phones: Frame / Tint open as a sheet over the bottom of the preview.
  rail.root.querySelector('.va-rail__tabs').addEventListener('click', event => {
    const tab = event.target.closest('[data-rail]');
    if (!tab) return;
    const open = rail.root.dataset.open === tab.dataset.rail ? '' : tab.dataset.rail;
    rail.root.dataset.open = open;
    rail.root.querySelectorAll('[data-rail]').forEach(b => b.setAttribute('aria-expanded', String(b.dataset.rail === open)));
    // The sticky preview grows by the sheet's height, so the ad keeps its size.
    const body = rail.root.querySelector('.va-rail__body');
    els.stage.classList.toggle('has-sheet', Boolean(open));
    if (open) els.stage.style.setProperty('--va-sheet', `${body.offsetHeight + 8}px`);
  });
  rail.root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !rail.root.dataset.open) return;
    const tab = rail.root.querySelector(`[data-rail="${rail.root.dataset.open}"]`);
    tab?.click();
    tab?.focus();
  });

  // Pan: drag the preview, or arrow keys while it has focus.
  const panBy = (dx, dy) => {
    const room = panRoom();
    if (room.roomX > 0.5) state.panX = Math.max(-1, Math.min(1, state.panX + dx / room.roomX));
    if (room.roomY > 0.5) state.panY = Math.max(-1, Math.min(1, state.panY + dy / room.roomY));
  };
  let drag = null;
  els.canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !els.canvas.classList.contains('is-pannable')) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, k: els.canvas.width / Math.max(1, els.canvas.clientWidth) };
    try { els.canvas.setPointerCapture(event.pointerId); } catch {}
    els.canvas.classList.add('is-panning');
    event.preventDefault();
  });
  els.canvas.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    panBy((event.clientX - drag.x) * drag.k, (event.clientY - drag.y) * drag.k);
    drag.x = event.clientX;
    drag.y = event.clientY;
    lookChanged({ commit: false });
  });
  const endDrag = event => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    els.canvas.classList.remove('is-panning');
    lookChanged();
  };
  els.canvas.addEventListener('pointerup', endDrag);
  els.canvas.addEventListener('pointercancel', endDrag);
  els.canvas.addEventListener('keydown', event => {
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!dir || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    const step = event.shiftKey ? 120 : 30; // canvas px
    panBy(dir[0] * step, dir[1] * step);
    lookChanged();
  });
  onMedia('loadedmetadata', () => syncRail());
  syncRail();

  // ─── Start ───────────────────────────────────────────────────────────────
  renderNoClip();
  $('va-empty-animated')?.addEventListener('click', () => useStill('animated'));
  setBrand(state.brandId);
  syncFields();
  renderSwatches();
  goStep('copy', { focus: false });
  // Hand-off from Trends ("Video ad" on a trend card): preselect the moment.
  try {
    const q = new URLSearchParams(location.search);
    const h = JSON.parse(sessionStorage.getItem('frameup.videoAdMoment.v1') || 'null');
    const m = h && (!q.get('trend') || h.id === q.get('trend')) ? h
      : q.get('moment') ? { id: q.get('trend') || 'trend-link', title: q.get('moment'), sport: q.get('sport'), team: q.get('team') || '', related: [] } : null;
    if (m && ['nfl', 'cfb', 'mlb'].includes(m.sport)) {
      setBrand(B.forSport(m.sport).id);
      state.copyTrend = { id: m.id, sport: m.sport, title: String(m.title || '').slice(0, 200), url: m.url || '', image: m.image || '', related: Array.isArray(m.related) ? m.related : [] };
      if (m.team) { state.team = String(m.team).slice(0, 80); state.teamSport = m.sport; }
      els.momentFold.open = true;
      renderMoments();
      sessionStorage.removeItem('frameup.videoAdMoment.v1');
      history.replaceState(null, '', location.pathname);
    }
  } catch {}
  Promise.all([
    document.fonts.load(`700 80px ${R.CONDENSED}`),
    document.fonts.load('400 40px Roboto'),
    document.fonts.load('500 40px Roboto'),
    document.fonts.load('700 40px Roboto'),
  ]).catch(() => {}).finally(() => refreshLogo());
  relayout();
  window.VideoAdsPage = { state, syncRail, bg, finds, relayout, layoutFor, exportSizes, startExport, useClip, goStep, findClips, findByColor, selectMoment, sendChat, generateDrafts, checkGrammar, lintText, openAi, closeAi, applyCopy, undo, setTrim, logEvent, pickStyle, useStill, renderSafe, localSuggestion, resolvedCopy, renderExport };
})();
