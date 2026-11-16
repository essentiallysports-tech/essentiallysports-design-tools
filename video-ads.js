// Video Ads page: a guided pipeline (Moment → Research & clip → Copy → Rate →
// Export) around one big live preview.
//   Layout + drawing: video-ads-render.js (window.VideoAdsRender)
//   Brands, sizes, styles: video-ads-brands.js (window.VideoAdsBrands)
//   Rating helpers: video-ads-rating.js (window.VideoAdsRating, /api/ad-rating)
//   AI + trends + X clips: POST /api/video-ads { mode: trends | clip | research | copy | chat }
(() => {
  'use strict';
  const R = window.VideoAdsRender;
  const B = window.VideoAdsBrands;
  const RT = window.VideoAdsRating;
  const $ = id => document.getElementById(id);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const els = {
    stage: $('va-stage'), canvas: $('va-canvas'), video: $('va-video'), drop: $('va-drop'), empty: $('va-empty'), fit: $('va-fit'),
    busy: $('va-busy'), busyArc: $('va-busy-arc'), busyPct: $('va-busy-pct'), busyText: $('va-busy-text'),
    play: $('va-play'), mute: $('va-mute'), seek: $('va-seek'), trimIn: $('va-in'), trimOut: $('va-out'), time: $('va-time'), trimText: $('va-trimtext'),
    track: $('va-track'), strip: $('va-strip'), sel: $('va-sel'), head: $('va-head'), dimL: $('va-dim-l'), dimR: $('va-dim-r'),
    brands: $('va-brands'), sizes: $('va-sizes'), metaToggle: $('va-meta-toggle'), device: $('va-device'), metaHead: $('va-meta-head'), metaOver: $('va-meta-over'), metaFoot: $('va-meta-foot'), mini: $('va-mini'),
    steps: $('va-steps'), panelScroll: $('va-panel-scroll'), back: $('va-back'), next: $('va-next'), nextText: $('va-next-text'),
    trends: $('va-trends'), trendsStatus: $('va-trends-status'), refresh: $('va-refresh'), sports: $('va-sports'), own: $('va-own'), ownText: $('va-own-text'), ownSport: $('va-own-sport'),
    moment: $('va-moment'), researchBody: $('va-research-body'), researchMore: $('va-research-more'), researchMoreCard: $('va-research-more-card'), researchRun: $('va-research-run'), clips: $('va-clips'), clipsCount: $('va-clips-count'),
    upload: $('va-upload'), file: $('va-file'), xform: $('va-xform'), xurl: $('va-xurl'), xget: $('va-xget'), qualities: $('va-qualities'), clipStatus: $('va-clip-status'),
    styles: $('va-styles'), copyTabs: $('va-copy-tabs'), notesForm: $('va-notes-form'), notes: $('va-notes'), draftsRun: $('va-drafts-run'), angles: $('va-angles'), variants: $('va-variants'),
    thread: $('va-thread'), suggest: $('va-suggest'), compose: $('va-compose'), ask: $('va-ask'), send: $('va-send'),
    headline: $('va-headline'), highlight: $('va-highlight'), highlightRow: $('va-highlight-row'), highlightWarn: $('va-highlight-warn'),
    bodies: [$('va-body-1'), $('va-body-2'), $('va-body-3')], addPara: $('va-add-para'), cta: $('va-cta'), unsub: $('va-unsub'),
    rate: $('va-rate'),
    exsizes: $('va-exsizes'), checklist: $('va-checklist'), rights: $('va-rights'), exportBtn: $('va-export'), exportProgress: $('va-export-progress'), exportStatus: $('va-export-status'), files: $('va-files'),
    confirm: $('va-confirm'), confirmText: $('va-confirm-text'), toasts: $('va-toasts'),
  };
  const ctx = els.canvas.getContext('2d');
  const measureCtx = document.createElement('canvas').getContext('2d');
  const measure = (text, font) => { measureCtx.font = font; return measureCtx.measureText(text).width; };
  const blurCanvas = document.createElement('canvas');

  // A worked example (the Essentially CFB template) so the page never starts blank.
  const state = {
    step: 'moment',
    size: '9x16',
    brandId: 'essentially-cfb',
    style: 'highlight',
    headline: 'The college football team you were handed, from your dad to your son. Keep up with it, free.',
    highlight: 'Keep up with it, free.',
    body: ['Nobody picks their first team. A dad passes it to his son: the same seats, the same Saturdays. Keep up with the program you were handed, then all of college football. Free. Join 100,000+ fans today.', '', ''],
    cta: '',
    unsubscribe: true,
    align: 'auto', // 'auto' follows the style (see layoutFor); 'left' / 'center' force it
    anchor: 'center',
    scrim: 0.45, blur: 0, zoom: 1, panX: 0, panY: 0, fade: null, vignette: 0, preset: 'darken',
    trimIn: 0, trimOut: 0,
    clip: null, // { name, source: 'upload'|'x', url }
    trend: null,
    sport: 'all',
    trendsStatus: 'loading',
    research: null, researchStatus: 'idle', researchError: '',
    angles: new Set(),
    variants: [], draftsStatus: 'idle', draftsError: '', draftsIssues: [], draftsFor: '', appliedVariant: -1, styleChosen: false, copyEdited: false,
    chat: [], chatBusy: false,
    rating: null, ratingSig: '', ratingStatus: 'idle', ratingError: '', ratingFrames: [], fixState: {},
    exportIds: ['9x16'], exported: false,
    version: 0,
  };
  let previewCopy = null; // a draft shown on hover / focus; never exported

  // ─── Small helpers ───────────────────────────────────────────────────────
  const esc = text => String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const safeUrl = url => (/^https:\/\//i.test(String(url || '')) ? String(url) : '');
  const domainOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (error) { return ''; } };
  const plain = text => String(text || '').replace(/\*\*/g, '');
  const brand = () => B.byId(state.brandId);
  const size = () => B.SIZES[state.size];
  const hasClip = () => Boolean(els.video.videoWidth);
  const SPORT_LABEL = { nfl: 'NFL', cfb: 'CFB', mlb: 'MLB' };
  const STEPS = ['moment', 'research', 'copy', 'rate', 'export'];
  const STEP_LABEL = { moment: 'Moment', research: 'Research & clip', copy: 'Copy', rate: 'Rate', export: 'Export' };
  const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICON = {
    check: svg('<path d="M20 6 9 17l-5-5"/>'),
    alert: svg('<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>'),
    external: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
    sparkle: svg('<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>'),
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11.05-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4.2" height="15" rx="1.2"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2"/></svg>',
    x: svg('<path d="M4 4l11.733 16h4.267l-11.733 -16z"/><path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772"/>'),
    youtube: svg('<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/>'),
    search: svg('<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>'),
    undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>'),
    download: svg('<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>'),
    retry: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
    film: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>'),
    gauge: svg('<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>'),
    wand: svg('<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>'),
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
    if (data?.reason === 'budget') return 'The team’s AI budget is used up for now. Ask an admin, or try later.';
    if (data?.reason === 'off') return 'The AI tools are switched off right now.';
    return data?.error || `Request failed (${status}).`;
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
      throw error;
    }
    return data;
  }

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
  const copyOf = (src = state) => ({ style: src.style, headline: src.headline, highlight: src.highlight, body: [...src.body], cta: src.cta, unsubscribe: src.unsubscribe });
  const layoutFor = (sizeId, src = state) => R.fitLayout(measure, {
    style: src.style,
    headline: src.headline,
    highlight: src.highlight,
    body: src.body,
    cta: src.cta || brand().cta,
    unsubscribe: src.unsubscribe,
    // As in the Figma ads: Simple and Condensed are centred, Highlight is set flush left.
    align: state.align === 'auto' ? (src.style === 'highlight' ? 'left' : 'center') : state.align,
    anchor: state.anchor,
  }, brand(), B.SIZES[sizeId], logo.img ? logo : null);
  let current = null;
  const bg = () => ({ scrim: state.scrim, blur: state.blur, zoom: state.zoom, panX: state.panX, panY: state.panY, fade: state.fade, vignette: state.vignette });
  // Background presets. "Black bottom" / "Navy bottom" follow the rated ES ads
  // in the Figma file (AD1 Brick Black Bottom, AD5 Brick Navy Bottom): a bright
  // clip on top that melts into a solid colour behind bottom-anchored copy:
  // no flat scrim, the 0.87 vignette, and a fade from just above the copy
  // (56% of the 4:5 frame) to solid at 83%.
  const PRESETS = {
    darken: { scrim: 0.45, blur: 0, fade: null, vignette: 0, anchor: 'center' },
    'black-bottom': { scrim: 0, blur: 0, fade: { color: '#000000', height: 0.44 }, vignette: 0.87, anchor: 'bottom' },
    'navy-bottom': { scrim: 0, blur: 0, fade: { color: '#0B1B3A', height: 0.44 }, vignette: 0.87, anchor: 'bottom' },
    blur: { scrim: 0.38, blur: 0.45, fade: null, vignette: 0, anchor: 'center' },
  };

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
    els.metaToggle?.setAttribute('aria-pressed', String(metaPreview));
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
    els.fit.textContent = !current.fits ? 'Too much copy for this size' : current.scale < 0.72 ? 'Long copy: set smaller' : '';
    els.fit.classList.toggle('is-on', !current.fits || current.scale < 0.72);
    els.fit.classList.toggle('is-bad', !current.fits);
    els.highlightRow.hidden = state.style !== 'highlight';
    const lit = state.highlight.trim();
    els.highlightWarn.hidden = !lit || state.headline.toLowerCase().includes(lit.toLowerCase());
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
    R.drawFrame(ctx, { width: s.width, height: s.height, video: hasClip() ? els.video : placeholder, bg: bg(), ops: current.ops, logoImage: logo.img, blurCanvas });
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
    if (seekTarget != null) els.video.currentTime = Math.max(0, Math.min(d, seekTarget));
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
      handle.setPointerCapture(event.pointerId);
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
    if (clipUrl) URL.revokeObjectURL(clipUrl);
    clipUrl = URL.createObjectURL(blob);
    state.clip = meta;
    els.strip.classList.remove('is-ready');
    els.video.src = clipUrl;
    els.video.load();
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
  els.video.addEventListener('loadedmetadata', async () => {
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
    buildFilmstrip(clipUrl, d);
    changed();
    renderClips();
    if (state.clip) toast(`Clip ready: ${state.clip.name}`, state.step === 'research' ? { action: { label: 'Next: Copy', fn: () => goStep('copy') } } : {});
  });
  els.video.addEventListener('seeked', () => { draw(); syncTime(); });
  els.video.addEventListener('error', () => { if (els.video.getAttribute('src')) setClipStatus('That video could not be played. Try an MP4 (H.264).'); });
  const setClipStatus = text => { els.clipStatus.textContent = text; els.clipStatus.title = text || ''; };

  function takeFile(file) {
    if (!file) return;
    if (!/^video\//.test(file.type)) { setClipStatus('Drop a video file (MP4 works best).'); toast('That isn’t a video file.', { tone: 'bad' }); return; }
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
    loadingClip = meta.url || variant.url;
    renderClips();
    setBusy(true, 'Downloading the clip…', 0);
    setClipStatus('Downloading the clip…');
    try {
      // X's video host refuses requests that carry a Referer from our site (403),
      // so send none; no cookies either.
      const response = await fetch(variant.url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
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
      useClip(new Blob(parts, { type: 'video/mp4' }), { name: `X post by ${who}`, source: 'x', url: meta.url || '' });
      setClipStatus(`Clip from ${who} (${variant.height || '?'}p). Check you may use it before publishing.`);
    } catch (error) {
      setClipStatus("FrameUp couldn't download that clip. Open the post, save the video, and drop it here.");
      toast('Couldn’t download that clip. Save it from the post and drop it on the preview.', { tone: 'bad' });
    } finally {
      loadingClip = '';
      setBusy(false);
      renderClips();
    }
  }
  const bestVariant = variants => (variants || []).find(v => Math.max(v.width, v.height) <= 1280) || (variants || [])[variants.length - 1];

  async function loadXPost(url, button) {
    if (button) button.disabled = true;
    setClipStatus('Finding the video in that post…');
    els.qualities.hidden = true;
    try {
      const data = await callApi({ mode: 'clip', url });
      // Default: the largest version up to 1280px on the long edge (fast, sharp enough at 1080 wide).
      const best = bestVariant(data.variants);
      els.qualities.innerHTML = `<span class="va-hint">Quality</span>${data.variants.slice(0, 4).map((v, i) => `<button class="va-chip" type="button" data-q="${i}" aria-pressed="${v === best}">${v.height ? `${v.height}p` : `Version ${i + 1}`}</button>`).join('')}`;
      els.qualities.hidden = false;
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
    if (!url) { els.xurl.focus(); return; }
    loadXPost(url, els.xget);
  });

  // ─── Steps ───────────────────────────────────────────────────────────────
  const stepButtons = [...els.steps.querySelectorAll('.va-step')];
  function stepDone(id) {
    if (id === 'moment') return Boolean(state.trend);
    if (id === 'research') return state.researchStatus === 'done' || Boolean(state.clip);
    if (id === 'copy') return state.appliedVariant >= 0 || state.copyEdited;
    if (id === 'rate') return Boolean(state.rating) && !ratingStale();
    if (id === 'export') return state.exported;
    return false;
  }
  function stepSub(id) {
    if (id === 'moment') return state.trend ? state.trend.title : 'Pick a trend';
    if (id === 'research') {
      if (state.researchStatus === 'loading') return 'Researching…';
      const facts = state.research?.keyFacts?.length || 0;
      const bits = [];
      if (state.researchStatus === 'done') bits.push(`${facts} fact${facts === 1 ? '' : 's'}`);
      bits.push(state.clip ? 'clip in' : 'no clip yet');
      return bits.join(' · ');
    }
    if (id === 'copy') {
      if (state.draftsStatus === 'loading') return 'Writing drafts…';
      return `${B.STYLES[state.style]?.label || ''}${current && !current.fits ? ' · too long' : ''}`;
    }
    if (id === 'rate') {
      if (state.ratingStatus === 'loading') return 'Rating…';
      if (!state.rating) return 'Score and fixes';
      return `${Number(state.rating.score).toFixed(1)} · ${ratingStale() ? 'changed since' : state.rating.verdict}`;
    }
    if (id === 'export') return state.exported ? 'Exported' : `${state.exportIds.length} size${state.exportIds.length === 1 ? '' : 's'} · MP4`;
    return '';
  }
  function renderSteps() {
    stepButtons.forEach(button => {
      const id = button.dataset.step;
      if (id === state.step) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
      const done = stepDone(id);
      button.dataset.state = done ? 'done' : '';
      button.classList.toggle('is-busy', (id === 'research' && state.researchStatus === 'loading') || (id === 'rate' && state.ratingStatus === 'loading') || (id === 'copy' && (state.draftsStatus === 'loading' || state.chatBusy)));
      const sub = button.querySelector('.va-step__sub');
      sub.textContent = stepSub(id);
      button.setAttribute('aria-label', `Step ${STEPS.indexOf(id) + 1}, ${STEP_LABEL[id]}: ${sub.textContent}${done ? ' (done)' : ''}`);
    });
    const i = STEPS.indexOf(state.step);
    els.back.hidden = i === 0;
    els.next.hidden = i === STEPS.length - 1;
    if (i < STEPS.length - 1) els.nextText.textContent = `Next: ${STEP_LABEL[STEPS[i + 1]]}`;
  }
  function goStep(id, { focus = true } = {}) {
    if (!STEPS.includes(id)) return;
    const changedStep = id !== state.step;
    state.step = id;
    document.querySelectorAll('.va-pane').forEach(pane => { pane.hidden = pane.dataset.pane !== id; });
    els.panelScroll.scrollTop = 0;
    renderSteps();
    if (id === 'research') { renderResearch(); renderClips(); }
    if (id === 'copy') {
      renderCopy();
      if (state.trend && state.draftsFor !== state.trend.id && state.draftsStatus !== 'loading') generateDrafts();
    }
    if (id === 'rate') renderRate();
    if (id === 'export') renderExport();
    if (focus && changedStep) document.getElementById(`va-h-${id}`)?.focus({ preventScroll: true });
  }
  els.steps.addEventListener('click', event => {
    const button = event.target.closest('.va-step');
    if (button) goStep(button.dataset.step);
  });
  els.back.addEventListener('click', () => goStep(STEPS[Math.max(0, STEPS.indexOf(state.step) - 1)]));
  els.next.addEventListener('click', () => goStep(STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(state.step) + 1)]));

  // Anything that changes the ad: re-check rating freshness and step labels.
  function changed() {
    state.version += 1;
    state.exported = false;
    renderSteps();
    if (state.step === 'rate') renderRateStale();
    if (state.step === 'export') renderExport();
  }

  // ─── 1 Moment ────────────────────────────────────────────────────────────
  let trendItems = [];
  let trendsError = '';
  function renderTrends() {
    if (state.trendsStatus === 'loading') {
      els.trends.innerHTML = Array.from({ length: 5 }, (_, i) => `<li class="va-trend-item" aria-hidden="true" style="--i:${i}"><div class="va-trend va-trend--skeleton"><span class="va-trend__img va-shimmer"></span><span class="va-trend__body"><span class="va-line va-shimmer" style="width:42%"></span><span class="va-line va-shimmer"></span><span class="va-line va-shimmer" style="width:72%"></span></span></div></li>`).join('');
      els.trends.setAttribute('aria-busy', 'true');
      return;
    }
    els.trends.removeAttribute('aria-busy');
    if (state.trendsStatus === 'error') {
      els.trends.innerHTML = `<li class="va-empty-state">${ICON.alert}<strong>Trends didn’t load</strong><span>${esc(trendsError)}</span><button class="va-btn va-btn--sm" type="button" data-act="retry-trends">${ICON.retry}Try again</button></li>`;
      return;
    }
    const list = trendItems.filter(item => state.sport === 'all' || item.sport === state.sport);
    if (!list.length) {
      els.trends.innerHTML = `<li class="va-empty-state">${ICON.search}<strong>Nothing for ${esc(SPORT_LABEL[state.sport] || 'this sport')} right now</strong><span>Try another sport, or describe your own moment above.</span></li>`;
      els.trendsStatus.textContent = '';
      return;
    }
    els.trends.innerHTML = list.map((item, index) => {
      const img = safeUrl(item.image);
      const story = safeUrl(item.url);
      const on = state.trend?.id === item.id;
      const meta = [ago(item.publishedAt), item.traffic ? `${item.traffic} searches` : '', item.source].filter(Boolean).map(esc).join('<i aria-hidden="true">·</i>');
      return `<li class="va-trend-item" style="--i:${index}">
        <button class="va-trend${on ? ' is-on' : ''}" type="button" data-id="${esc(item.id)}" aria-pressed="${on}">
          <span class="va-trend__img va-sport-bg--${esc(item.sport)}"${img ? ` style="background-image:url('${esc(img)}')"` : ''}>${img ? '' : `<b>${esc(SPORT_LABEL[item.sport] || '')}</b>`}</span>
          <span class="va-trend__body">
            <span class="va-trend__meta"><span class="va-sport va-sport--${esc(item.sport)}">${esc(SPORT_LABEL[item.sport] || '')}</span>${meta}</span>
            <span class="va-trend__title">${esc(item.title)}</span>
          </span>
          <span class="va-trend__go" aria-hidden="true">${on ? ICON.check : ICON.chevron}</span>
        </button>
        ${story ? `<a class="va-trend__story" href="${esc(story)}" target="_blank" rel="noopener" aria-label="Open the story: ${esc(item.title)}" title="Open the story">${ICON.external}</a>` : ''}
      </li>`;
    }).join('');
    // Live dot + count (the count ticks when a refresh changes it).
    els.trendsStatus.classList.remove('is-error');
    els.trendsStatus.innerHTML = `<span class="es-live-dot" aria-hidden="true"></span><span><b data-es-tick="va-moments">${list.length}</b> moment${list.length === 1 ? '' : 's'} from the last 48 hours</span>`;
  }
  async function loadTrends() {
    state.trendsStatus = 'loading';
    els.trendsStatus.textContent = 'Loading the last 48 hours…';
    els.refresh.classList.add('is-spinning');
    renderTrends();
    try {
      const data = await callApi({ mode: 'trends' });
      trendItems = data.items || [];
      state.trendsStatus = 'done';
    } catch (error) {
      state.trendsStatus = 'error';
      trendsError = error.message || '';
      els.trendsStatus.classList.add('is-error');
      els.trendsStatus.textContent = 'Trends are unavailable right now.';
    }
    els.refresh.classList.remove('is-spinning');
    renderTrends();
  }
  els.sports.addEventListener('click', event => {
    const chip = event.target.closest('[data-sport]');
    if (!chip) return;
    state.sport = chip.dataset.sport;
    [...els.sports.children].forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
    renderTrends();
  });
  els.trends.addEventListener('click', event => {
    if (event.target.closest('[data-act="retry-trends"]')) { loadTrends(); return; }
    const button = event.target.closest('.va-trend[data-id]');
    if (!button) return;
    const item = trendItems.find(t => t.id === button.dataset.id);
    if (item) selectMoment(item);
  });
  els.refresh.addEventListener('click', loadTrends);
  let ownSport = 'cfb';
  els.own.addEventListener('submit', event => {
    event.preventDefault();
    const title = els.ownText.value.trim();
    if (!title) { els.ownText.focus(); toast('Describe the moment first.'); return; }
    selectMoment({ id: `own-${Date.now()}`, title, sport: ownSport, url: '', related: [], own: true });
    els.ownText.value = '';
  });
  function selectMoment(item) {
    if (state.trend?.id === item.id) { goStep('research'); return; }
    state.trend = item;
    state.research = null;
    state.researchStatus = 'idle';
    state.angles = new Set();
    state.variants = [];
    state.draftsStatus = 'idle';
    state.draftsFor = '';
    state.appliedVariant = -1;
    setBrand(B.forSport(item.sport).id);
    renderTrends();
    goStep('research');
    runResearch();
  }

  // ─── 2 Research & clip ───────────────────────────────────────────────────
  let researchToken = 0;
  const RESEARCH_STAGES = ['Reading the coverage', 'Checking the facts', 'Finding what fans care about', 'Looking for clips on X and YouTube'];
  async function runResearch() {
    if (!state.trend) return;
    const token = ++researchToken;
    state.researchStatus = 'loading';
    state.researchError = '';
    renderResearch();
    renderClips();
    renderSteps();
    const { id, title, sport, url, related } = state.trend;
    try {
      const data = await callApi({ mode: 'research', trend: { id, title, sport, url: url || '', related: (related || []).map(r => ({ title: r.title, url: r.url })) } });
      if (token !== researchToken) return;
      state.research = data;
      state.researchStatus = 'done';
    } catch (error) {
      if (token !== researchToken) return;
      state.researchStatus = 'error';
      state.researchError = error.message;
    }
    renderResearch();
    renderClips();
    renderSteps();
    if (state.step === 'copy') renderCopy();
  }
  els.researchRun.addEventListener('click', runResearch);

  function renderMomentCard() {
    const t = state.trend;
    els.moment.innerHTML = t
      ? `<div class="va-moment__card"><span class="va-sport va-sport--${esc(t.sport)}">${esc(SPORT_LABEL[t.sport] || '')}</span><p>${esc(t.title)}</p><button class="va-btn va-btn--sm va-btn--ghost" type="button" data-act="change-moment">Change</button></div>`
      : `<div class="va-moment__card is-empty"><p>No moment yet. Research needs one, but you can still add a clip below.</p><button class="va-btn va-btn--sm" type="button" data-act="change-moment">Pick a moment</button></div>`;
  }
  els.moment.addEventListener('click', event => { if (event.target.closest('[data-act="change-moment"]')) goStep('moment'); });

  let stageTimer = 0;
  function renderResearch() {
    renderMomentCard();
    clearInterval(stageTimer);
    els.researchRun.hidden = !(state.trend && (state.researchStatus === 'done' || state.researchStatus === 'error'));
    els.researchMoreCard.hidden = true;
    const body = els.researchBody;
    if (!state.trend) {
      body.innerHTML = '<p class="va-hint">Pick a moment and the AI pulls the key facts, why fans care, and angles for the ad.</p>';
      return;
    }
    if (state.researchStatus === 'loading') {
      body.innerHTML = `<ol class="va-stages">${RESEARCH_STAGES.map((s, i) => `<li data-i="${i}"${i === 0 ? ' class="is-on"' : ''}><span class="va-stages__dot" aria-hidden="true"></span>${esc(s)}</li>`).join('')}</ol>
        <div class="va-skel" aria-hidden="true"><span class="va-line va-shimmer"></span><span class="va-line va-shimmer"></span><span class="va-line va-shimmer" style="width:62%"></span></div>`;
      let at = 0;
      stageTimer = setInterval(() => {
        at = Math.min(RESEARCH_STAGES.length - 1, at + 1);
        body.querySelectorAll('.va-stages li').forEach(li => {
          const i = Number(li.dataset.i);
          li.classList.toggle('is-done', i < at);
          li.classList.toggle('is-on', i === at);
        });
        if (at === RESEARCH_STAGES.length - 1) clearInterval(stageTimer);
      }, 1800);
      return;
    }
    if (state.researchStatus === 'error') {
      body.innerHTML = `<div class="va-alert" role="alert">${ICON.alert}<div><strong>Research didn’t finish</strong><span>${esc(state.researchError)}</span></div><button class="va-btn va-btn--sm" type="button" data-act="retry-research">${ICON.retry}Try again</button></div>
        <p class="va-hint">You can still add a clip below and write the copy yourself.</p>`;
      return;
    }
    const r = state.research;
    if (!r) { body.innerHTML = '<p class="va-hint">Research starts when you pick a moment.</p>'; return; }
    const facts = (r.keyFacts || []).filter(f => f && f.fact);
    const angles = (r.angles || []).filter(Boolean);
    const phrases = (r.searchPhrases || []).filter(Boolean).slice(0, 4);
    body.innerHTML = `
      ${r.webSearch === false ? `<p class="va-soft-note">${ICON.alert}<span>Based on the headline only: web search wasn’t available for this one, so check the facts.</span></p>` : ''}
      ${r.summary ? `<p class="va-summary">${esc(r.summary)}</p>` : ''}
      ${r.whyFansCare ? `<div class="va-why"><span class="va-why__label">Why fans care</span><p>${esc(r.whyFansCare)}</p></div>` : ''}
      <p class="va-meta">${r.cached ? 'From the last 30 minutes · free' : r.cost != null ? `Research cost $${Number(r.cost).toFixed(3)}` : ''}${facts.length || angles.length ? ' · facts and angles are below the clips' : ''}</p>`;
    els.researchMoreCard.hidden = !(facts.length || angles.length || phrases.length);
    els.researchMore.innerHTML = `
      ${facts.length ? `<div class="va-block"><h4>Key facts</h4><ol class="va-facts">${facts.map(f => {
        const src = safeUrl(f.sourceUrl);
        return `<li><span>${esc(f.fact)}</span>${src ? `<a href="${esc(src)}" target="_blank" rel="noopener" class="va-source">${esc(domainOf(src))}${ICON.external}</a>` : ''}</li>`;
      }).join('')}</ol></div>` : ''}
      ${angles.length ? `<div class="va-block"><h4>Ad angles <span class="va-optional">Tap to steer the drafts</span></h4><div class="va-chips va-chips--wrap">${angles.map((a, i) => `<button class="va-chip va-chip--angle" type="button" data-angle="${i}" aria-pressed="${state.angles.has(a)}">${esc(a)}</button>`).join('')}</div></div>` : ''}
      ${phrases.length ? `<div class="va-block"><h4>Search X yourself</h4><div class="va-chips va-chips--wrap">${phrases.map(p => `<a class="va-chip va-chip--link" href="https://x.com/search?q=${encodeURIComponent(p)}&amp;f=live" target="_blank" rel="noopener">${ICON.search}${esc(p)}</a>`).join('')}</div></div>` : ''}
`;
  }
  function toggleAngle(chip) {
    const angle = (state.research?.angles || [])[Number(chip.dataset.angle)];
    if (!angle) return;
    if (state.angles.has(angle)) state.angles.delete(angle); else state.angles.add(angle);
    document.querySelectorAll(`[data-angle="${chip.dataset.angle}"]`).forEach(c => c.setAttribute('aria-pressed', String(state.angles.has(angle))));
  }
  [els.researchBody, els.researchMore].forEach(root => root.addEventListener('click', event => {
    if (event.target.closest('[data-act="retry-research"]')) { runResearch(); return; }
    const chip = event.target.closest('[data-angle]');
    if (chip) toggleAngle(chip);
  }));

  const verifiedClips = () => (state.research?.verifiedClips || []).filter(c => c && Array.isArray(c.variants) && c.variants.length);
  function renderClips() {
    const r = state.research;
    const verified = verifiedClips();
    const verifiedUrls = new Set(verified.map(c => c.url));
    const xPosts = (r?.xPosts || []).filter(u => safeUrl(u) && !verifiedUrls.has(u)).slice(0, 4);
    const youtube = (r?.youtube || []).filter(safeUrl).slice(0, 3);
    const count = verified.length + xPosts.length + youtube.length;
    els.clipsCount.textContent = count ? `${count} found` : '';
    if (state.researchStatus === 'loading') {
      els.clips.innerHTML = `<div class="va-clipgrid" aria-hidden="true">${Array.from({ length: 2 }, () => '<div class="va-clip va-clip--skeleton"><span class="va-clip__thumb va-shimmer"></span><span class="va-line va-shimmer"></span><span class="va-line va-shimmer" style="width:60%"></span></div>').join('')}</div>`;
      return;
    }
    if (!r || state.researchStatus !== 'done') { els.clips.innerHTML = ''; return; }
    const parts = [];
    if (verified.length) {
      parts.push(`<div class="va-clipgrid">${verified.map((c, i) => {
        const inAd = Boolean(state.clip?.url) && state.clip.url === c.url;
        const busy = Boolean(loadingClip) && loadingClip === c.url;
        const thumb = safeUrl(c.thumbnail);
        const handle = String(c.handle || '').replace(/^@/, '');
        return `<article class="va-clip${inAd ? ' is-in' : ''}${busy ? ' is-busy' : ''}">
          <span class="va-clip__thumb"${thumb ? ` style="background-image:url('${esc(thumb)}')"` : ''}>${c.durationMs ? `<span class="va-clip__dur">${esc(fmt(c.durationMs / 1000))}</span>` : ''}<span class="va-clip__x">${ICON.x}</span></span>
          <span class="va-clip__who">${handle ? `@${esc(handle)}` : 'X post'}</span>
          ${c.text ? `<span class="va-clip__text">${esc(c.text)}</span>` : ''}
          <span class="va-clip__actions">
            <button class="va-btn va-btn--sm${inAd ? '' : ' va-btn--primary'}" type="button" data-clip="${i}"${busy || inAd ? ' disabled' : ''}>${busy ? 'Loading…' : inAd ? `${ICON.check}In the ad` : 'Use clip'}</button>
            ${safeUrl(c.url) ? `<a class="va-icon-btn va-icon-btn--sm" href="${esc(c.url)}" target="_blank" rel="noopener" aria-label="Open the post by ${esc(handle || 'X')}" title="Open the post">${ICON.external}</a>` : ''}
          </span>
        </article>`;
      }).join('')}</div>`);
    }
    if (xPosts.length || youtube.length) {
      parts.push(`<ul class="va-links">
        ${xPosts.map(u => `<li><span class="va-links__icon">${ICON.x}</span><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https:\/\/(www\.)?/, '').slice(0, 46))}</a><button class="va-btn va-btn--sm" type="button" data-xpost="${esc(u)}">Get video</button></li>`).join('')}
        ${youtube.map(u => `<li><span class="va-links__icon va-links__icon--yt">${ICON.youtube}</span><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https:\/\/(www\.)?/, '').slice(0, 46))}</a><span class="va-tag">Open only</span></li>`).join('')}
      </ul>${youtube.length ? '<p class="va-hint">YouTube clips can’t load here: save the clip, then drop it on the preview.</p>' : ''}`);
    }
    if (!parts.length) parts.push('<p class="va-hint">No downloadable clips turned up for this moment. Paste an X post below or upload your own.</p>');
    els.clips.innerHTML = parts.join('');
  }
  els.clips.addEventListener('click', event => {
    const use = event.target.closest('[data-clip]');
    if (use) {
      const c = verifiedClips()[Number(use.dataset.clip)];
      if (c) downloadClip(bestVariant(c.variants), { handle: c.handle, url: c.url });
      return;
    }
    const x = event.target.closest('[data-xpost]');
    if (x) loadXPost(x.dataset.xpost, x);
  });

  // ─── 3 Copy ──────────────────────────────────────────────────────────────
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
  function syncStyles() {
    [...els.styles.querySelectorAll('[role="radio"]')].forEach(b => {
      const on = b.dataset.style === state.style;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }
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
  }
  // Applies copy fields (from a draft, the assistant or a fix) with undo.
  function applyCopy(fields, { label = 'Copy updated', silent = false } = {}) {
    snapshot();
    if (fields.style && B.STYLES[fields.style]) state.style = fields.style;
    if (typeof fields.headline === 'string') state.headline = fields.headline;
    if (typeof fields.highlight === 'string') state.highlight = fields.highlight;
    if (Array.isArray(fields.body)) state.body = [0, 1, 2].map(i => String(fields.body[i] || ''));
    if (typeof fields.cta === 'string') state.cta = fields.cta.trim().toUpperCase() === brand().cta ? '' : fields.cta;
    state.copyEdited = true;
    previewCopy = null;
    els.stage.classList.remove('is-previewing');
    syncFields();
    relayout();
    changed();
    if (!silent) toast(label, { action: { label: 'Undo', fn: undo } });
  }
  const variantFields = v => ({ style: v.style, headline: v.headline || '', highlight: v.style === 'highlight' ? (v.highlight || '') : '', body: Array.isArray(v.body) ? v.body : [], cta: v.cta || '' });

  els.styles.addEventListener('click', event => {
    const button = event.target.closest('[data-style]');
    if (!button || button.dataset.style === state.style) return;
    snapshot();
    state.style = button.dataset.style;
    state.styleChosen = true;
    syncStyles();
    relayout();
    changed();
  });
  els.styles.addEventListener('keydown', event => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const ids = Object.keys(B.STYLES);
    const target = els.styles.querySelector(`[data-style="${ids[(ids.indexOf(state.style) + keys[event.key] + ids.length) % ids.length]}"]`);
    target.click();
    target.focus();
  });

  // Tabs inside Copy.
  const copyTabs = [...els.copyTabs.querySelectorAll('[role="tab"]')];
  function selectTab(tab, focus) {
    copyTabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
    if (tab.id === 'va-tab-chat') renderThread();
  }
  els.copyTabs.addEventListener('click', event => { const tab = event.target.closest('[role="tab"]'); if (tab) selectTab(tab); });
  els.copyTabs.addEventListener('keydown', event => {
    const i = copyTabs.indexOf(document.activeElement);
    if (i < 0) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); selectTab(copyTabs[(i + 1) % copyTabs.length], true); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); selectTab(copyTabs[(i - 1 + copyTabs.length) % copyTabs.length], true); }
  });

  function headlineHtml(v) {
    const text = v.style === 'highlight' ? plain(v.headline).toUpperCase() : plain(v.headline);
    const lit = v.style === 'highlight' ? plain(v.highlight).toUpperCase().trim() : '';
    const at = lit ? text.indexOf(lit) : -1;
    if (at < 0) return esc(text);
    return `${esc(text.slice(0, at))}<mark>${esc(text.slice(at, at + lit.length))}</mark>${esc(text.slice(at + lit.length))}`;
  }
  function variantCard(v, i, { scope = 'drafts', applied = false } = {}) {
    const body = (v.body || []).filter(Boolean);
    return `<article class="va-variant${applied ? ' is-applied' : ''}" data-scope="${scope}" data-v="${i}" style="--i:${i}">
      <div class="va-variant__top"><span class="va-tag va-tag--${esc(v.style)}">${esc(B.STYLES[v.style]?.label || v.style)}</span>${applied ? `<span class="va-variant__state">${ICON.check}In the preview</span>` : ''}</div>
      <p class="va-variant__headline va-variant__headline--${esc(v.style)}">${headlineHtml(v)}</p>
      ${body.length ? `<p class="va-variant__body">${esc(plain(body[0]))}${body.length > 1 ? ` <span class="va-optional">+${body.length - 1} more</span>` : ''}</p>` : ''}
      ${v.why ? `<p class="va-variant__why">${ICON.sparkle}<span>${esc(v.why)}</span></p>` : ''}
      <button class="va-btn va-btn--sm${applied ? '' : ' va-btn--primary'}" type="button" data-use="${i}"${applied ? ' disabled' : ''}>${applied ? 'Using this draft' : 'Use this draft'}</button>
    </article>`;
  }
  function renderCopy() {
    syncFields();
    const angles = (state.research?.angles || []).filter(Boolean);
    els.angles.hidden = !angles.length;
    els.angles.innerHTML = angles.length ? `<span class="va-label">Angles from the research</span><div class="va-chips va-chips--wrap">${angles.map((a, i) => `<button class="va-chip va-chip--angle" type="button" data-angle="${i}" aria-pressed="${state.angles.has(a)}">${esc(a)}</button>`).join('')}</div>` : '';
    renderVariants();
    renderThread();
  }
  function renderVariants() {
    els.draftsRun.disabled = state.draftsStatus === 'loading';
    els.draftsRun.innerHTML = `${ICON.sparkle}<span>${state.variants.length ? 'New drafts' : 'Write drafts'}</span>`;
    if (state.draftsStatus === 'loading') {
      els.variants.innerHTML = `<p class="va-working">${dots}Writing three drafts in the ES styles…</p>${Array.from({ length: 3 }, (_, i) => `<div class="va-variant va-variant--skeleton" style="--i:${i}" aria-hidden="true"><span class="va-line va-shimmer" style="width:28%"></span><span class="va-line va-line--lg va-shimmer"></span><span class="va-line va-line--lg va-shimmer" style="width:70%"></span><span class="va-line va-shimmer"></span></div>`).join('')}`;
      return;
    }
    if (state.draftsStatus === 'error') {
      els.variants.innerHTML = `<div class="va-alert" role="alert">${ICON.alert}<div><strong>No drafts this time</strong><span>${esc(state.draftsError)}</span>${state.draftsIssues.length ? `<ul>${state.draftsIssues.slice(0, 4).map(i => `<li>${esc(typeof i === 'string' ? i : i.message || i.issue || JSON.stringify(i))}</li>`).join('')}</ul>` : ''}</div><button class="va-btn va-btn--sm" type="button" data-act="retry-drafts">${ICON.retry}Try again</button></div>`;
      return;
    }
    if (!state.variants.length) {
      els.variants.innerHTML = state.trend
        ? `<div class="va-empty-state va-empty-state--soft">${ICON.sparkle}<strong>Drafts appear here</strong><span>Three takes on the moment. Hover one to try it in the preview.</span></div>`
        : `<div class="va-empty-state va-empty-state--soft">${ICON.sparkle}<strong>Pick a moment for AI drafts</strong><span>Or edit the example in Edit text, or ask the assistant.</span><button class="va-btn va-btn--sm" type="button" data-act="to-moment">Pick a moment</button></div>`;
      return;
    }
    els.variants.innerHTML = state.variants.map((v, i) => variantCard(v, i, { applied: state.appliedVariant === i })).join('');
  }
  async function generateDrafts() {
    if (!state.trend) { toast('Pick a moment first, or edit the copy yourself.'); return; }
    state.draftsStatus = 'loading';
    state.draftsFor = state.trend.id;
    renderVariants();
    renderSteps();
    const notes = [els.notes.value.trim(), ...[...state.angles].map(a => `Angle: ${a}`)].filter(Boolean).join('\n');
    try {
      const data = await callApi({ mode: 'copy', brandId: state.brandId, trend: state.trend, research: state.research, style: state.styleChosen ? state.style : undefined, notes: notes || undefined });
      state.variants = (data.variants || []).filter(v => v && v.headline);
      state.appliedVariant = -1;
      state.draftsStatus = 'done';
    } catch (error) {
      state.draftsStatus = 'error';
      state.draftsError = error.message;
      state.draftsIssues = error.issues || [];
    }
    renderVariants();
    renderSteps();
  }
  els.notesForm.addEventListener('submit', event => { event.preventDefault(); generateDrafts(); });
  els.angles.addEventListener('click', event => { const chip = event.target.closest('[data-angle]'); if (chip) toggleAngle(chip); });

  // Hover or focus a draft: show it in the preview. "Use this draft" keeps it.
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
      if (event.target.closest('[data-act="retry-drafts"]')) { generateDrafts(); return; }
      if (event.target.closest('[data-act="to-moment"]')) { goStep('moment'); return; }
      const use = event.target.closest('[data-use]');
      if (!use) return;
      const card = use.closest('.va-variant');
      const v = draftFrom(card);
      if (!v) return;
      applyCopy(variantFields(v), { label: 'Draft in the preview' });
      state.appliedVariant = card.dataset.scope === 'drafts' ? Number(card.dataset.v) : -1;
      renderVariants();
      renderSteps();
    });
  });

  // Assistant chat.
  const lastPatchIndex = () => { for (let i = state.chat.length - 1; i >= 0; i -= 1) if (state.chat[i].patch) return i; return -1; };
  function renderThread() {
    const intro = `<li class="va-msg va-msg--assistant"><span class="va-msg__avatar" aria-hidden="true">${ICON.sparkle}</span><div class="va-msg__bubble"><p>I know ${state.trend ? `the moment (“${esc(state.trend.title)}”)` : 'your ad'}${state.research ? ', the research' : ''} and what’s in the preview. Ask me to rewrite, shorten, switch style or split the paragraphs, and I’ll change the ad for you.</p></div></li>`;
    const last = lastPatchIndex();
    els.thread.innerHTML = intro + state.chat.map((m, mi) => {
      if (m.pending) return `<li class="va-msg va-msg--assistant"><span class="va-msg__avatar" aria-hidden="true">${ICON.sparkle}</span><div class="va-msg__bubble va-msg__bubble--typing"><span class="va-sr">The assistant is writing</span>${dots}</div></li>`;
      if (m.role === 'user') return `<li class="va-msg va-msg--user"><div class="va-msg__bubble"><p>${esc(m.content)}</p></div></li>`;
      const fields = m.patch ? Object.keys(m.patch).filter(k => m.patch[k] != null) : [];
      return `<li class="va-msg va-msg--assistant${m.error ? ' is-error' : ''}"><span class="va-msg__avatar" aria-hidden="true">${m.error ? ICON.alert : ICON.sparkle}</span><div class="va-msg__bubble">
        ${String(m.content || '').split(/\n{2,}/).map(p => `<p>${esc(p)}</p>`).join('')}
        ${fields.length ? `<p class="va-msg__applied">${ICON.check}<span>Changed ${esc(fields.join(', '))}${m.undone ? ' (undone)' : ''}</span>${!m.undone && mi === last ? `<button class="va-link" type="button" data-undo="${mi}">${ICON.undo}Undo</button>` : ''}</p>` : ''}
        ${m.retry ? `<button class="va-btn va-btn--sm" type="button" data-retry="${mi}">${ICON.retry}Try again</button>` : ''}
      </div></li>
      ${(m.variants || []).length ? `<li class="va-msg va-msg--cards">${m.variants.map((v, j) => variantCard(v, j, { scope: `chat:${mi}:${j}` })).join('')}</li>` : ''}`;
    }).join('');
    els.thread.scrollTop = els.thread.scrollHeight;
    els.send.disabled = state.chatBusy;
    els.suggest.hidden = state.chat.length > 4;
  }
  async function sendChat(text, { fromFix } = {}) {
    const content = String(text || '').trim();
    if (!content || state.chatBusy) return null;
    state.chat.push({ role: 'user', content });
    state.chat.push({ role: 'assistant', pending: true });
    state.chatBusy = true;
    renderThread();
    renderSteps();
    let result = null;
    try {
      const messages = state.chat.filter(m => !m.pending && !m.error).map(m => ({ role: m.role, content: m.content })).slice(-12);
      const data = await callApi({ mode: 'chat', brandId: state.brandId, trend: state.trend, research: state.research, layout: { style: state.style, headline: state.headline, highlight: state.highlight, body: state.body.filter(s => s.trim()), cta: state.cta || brand().cta }, messages });
      const msg = { role: 'assistant', content: data.reply || 'Done.', variants: (data.variants || []).filter(v => v && v.headline) };
      const patch = data.patch && typeof data.patch === 'object' && Object.keys(data.patch).length ? data.patch : null;
      state.chat[state.chat.length - 1] = msg;
      if (patch) {
        msg.patch = patch;
        applyCopy(patch, { label: fromFix ? 'Fix applied to the ad' : 'The assistant changed the ad' });
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
    els.ask.value = '';
    autoGrow();
    sendChat(text);
  });
  els.ask.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); els.compose.requestSubmit(); }
  });
  els.ask.addEventListener('input', autoGrow);
  els.suggest.addEventListener('click', event => { const chip = event.target.closest('.va-chip'); if (chip) sendChat(chip.textContent); });
  els.thread.addEventListener('click', event => {
    const u = event.target.closest('[data-undo]');
    if (u) { const m = state.chat[Number(u.dataset.undo)]; undo(); if (m) m.undone = true; renderThread(); return; }
    const r = event.target.closest('[data-retry]');
    if (r) { const i = Number(r.dataset.retry); const text = state.chat[i]?.retry; state.chat.splice(i - 1, 2); sendChat(text); }
  });

  // Edit text fields.
  let typingSnap = 0;
  const snapOnFirstKey = () => { if (Date.now() - typingSnap > 4000) snapshot(); typingSnap = Date.now(); };
  const editField = (el, fn) => {
    el.addEventListener('beforeinput', snapOnFirstKey);
    el.addEventListener('input', () => { fn(); state.copyEdited = true; state.appliedVariant = -1; relayout(); changed(); });
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

  // ─── 4 Rate ──────────────────────────────────────────────────────────────
  const adSignature = () => JSON.stringify([state.brandId, state.style, state.headline, state.highlight, state.body, state.cta, state.unsubscribe, state.align, state.anchor,
    state.scrim, state.blur, state.zoom, state.panX, state.panY, state.fade?.color || '', state.vignette, state.trimIn, state.trimOut, state.clip?.name || '', clipUrl, els.logoThumb.src.length]);
  const ratingStale = () => Boolean(state.rating) && state.ratingSig !== adSignature();
  const isRedesign = verdict => /redesign/i.test(String(verdict || ''));
  const toneOf = verdict => RT.VERDICT_TONES[verdict] || (isRedesign(verdict) ? 'bad' : 'warn');

  function seekTo(t) {
    return new Promise(resolve => {
      if (Math.abs(els.video.currentTime - t) < 0.01) { resolve(); return; }
      const timer = setTimeout(resolve, 2000);
      els.video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
      els.video.currentTime = t;
    });
  }
  function ratingContext() {
    const b = brand();
    return {
      brandId: b.id,
      brandLabel: b.label,
      sport: state.trend?.sport || b.sport,
      objective: 'newsletter_signup',
      placement: state.size,
      headline: plain(state.headline),
      body: state.body.map(s => plain(s).trim()).filter(Boolean),
      cta: (state.cta || b.cta).toUpperCase(),
    };
  }
  let ratingRun = null;
  // Draws the ad full size at the hook / middle / end of the trim (seeking the
  // hidden video) and asks /api/ad-rating for a score.
  function rateAd() {
    if (ratingRun) return ratingRun;
    if (!hasClip()) return Promise.reject(new Error('Add a clip first: the reviewer needs to see the footage.'));
    ratingRun = (async () => {
      state.ratingStatus = 'loading';
      state.ratingError = '';
      state.ratingFrames = [];
      renderRate();
      renderSteps();
      if (state.step === 'export') renderExport();
      const sig = adSignature();
      try {
        setPlaying(false);
        const restore = els.video.currentTime;
        const s = size();
        const off = document.createElement('canvas');
        off.width = s.width;
        off.height = s.height;
        const octx = off.getContext('2d');
        const offBlur = document.createElement('canvas');
        const lay = layoutFor(state.size);
        const span = Math.max(0.5, state.trimOut - state.trimIn);
        const times = RT.pickFrameTimes(span, 3).map(t => Math.min(state.trimOut - 0.05, state.trimIn + t));
        const frames = await RT.captureFrames(async t => {
          await seekTo(t);
          R.drawFrame(octx, { width: s.width, height: s.height, video: els.video, bg: bg(), ops: lay.ops, logoImage: logo.img, blurCanvas: offBlur });
          return off;
        }, times);
        await seekTo(restore);
        state.ratingFrames = frames;
        renderRate();
        const result = await RT.requestRating({ frames, context: ratingContext() });
        state.rating = result;
        state.ratingSig = sig;
        state.ratingStatus = 'done';
        state.fixState = {};
        return result;
      } catch (error) {
        state.ratingStatus = 'error';
        state.ratingError = error.status === 429 || error.reason === 'limit' ? friendlyError(429, {}) : error.message;
        throw error;
      } finally {
        ratingRun = null;
        renderRate();
        renderSteps();
        if (state.step === 'export') renderExport();
      }
    })();
    return ratingRun;
  }

  function gauge(score, tone) {
    const r = 46;
    const circ = 2 * Math.PI * r;
    const frac = Math.max(0, Math.min(1, score / 10));
    return `<div class="va-gauge va-gauge--${tone}" style="--circ:${circ.toFixed(1)};--off:${(circ * (1 - frac)).toFixed(1)}">
      <svg viewBox="0 0 108 108" aria-hidden="true"><circle class="va-gauge__track" cx="54" cy="54" r="${r}"/><circle class="va-gauge__arc" cx="54" cy="54" r="${r}" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - frac)).toFixed(1)}"/></svg>
      <span class="va-gauge__num"><strong>${esc(score.toFixed(1))}</strong><small>out of 10</small></span>
    </div>`;
  }
  function framesRow(frames, scanning) {
    const labels = ['Hook', 'Middle', 'End'];
    return `<div class="va-frames va-frames--${state.size}${scanning ? ' is-scanning' : ''}">${[0, 1, 2].map(i => `<figure class="va-frame"><span class="va-frame__pic">${frames[i] ? `<img src="${frames[i]}" alt="${labels[i]} frame">` : '<span class="va-frame__empty"></span>'}</span><figcaption>${labels[i]}</figcaption></figure>`).join('')}</div>`;
  }
  function renderRateStale() {
    const banner = els.rate.querySelector('.va-stale');
    if (banner) banner.hidden = !ratingStale();
  }
  function renderRate() {
    const area = els.rate;
    if (state.ratingStatus === 'loading') {
      area.innerHTML = `<div class="va-card va-card--ai va-rate-loading">${framesRow(state.ratingFrames, true)}<p class="va-working">${dots}${state.ratingFrames.length ? 'Reviewing the hook, the middle and the end…' : 'Capturing three frames from your trim…'}</p></div>`;
      return;
    }
    if (!hasClip() && !state.rating) {
      area.innerHTML = `<div class="va-empty-state">${ICON.film}<strong>Add a clip first</strong><span>The reviewer scores the whole ad, footage included.</span><button class="va-btn va-btn--sm va-btn--primary" type="button" data-act="to-research">Find a clip</button></div>`;
      return;
    }
    const errorHtml = state.ratingStatus === 'error' ? `<div class="va-alert" role="alert">${ICON.alert}<div><strong>Rating didn’t finish</strong><span>${esc(state.ratingError)}</span></div></div>` : '';
    if (!state.rating) {
      area.innerHTML = `${errorHtml}<div class="va-card va-card--ai va-rate-intro">
        ${framesRow([], false)}
        <ul class="va-rate-what"><li>${ICON.check}Headline and offer clarity</li><li>${ICON.check}CTA visibility</li><li>${ICON.check}Readability for fans 55+</li><li>${ICON.check}Stop-scroll hook and placement fit</li></ul>
        <button class="va-btn va-btn--ai va-btn--lg va-btn--block" type="button" data-act="rate">${ICON.gauge}<span>Rate this ad</span></button>
        <p class="va-meta va-center">About 10 seconds · roughly $0.001 · it rates again by itself before export if you change the ad</p>
      </div>`;
      return;
    }
    const r = state.rating;
    const score = Math.min(10, Math.max(1, Number(r.score) || 1));
    const tone = toneOf(r.verdict);
    const fixes = (Array.isArray(r.fixes) ? r.fixes : []).slice(0, 3);
    const caps = Array.isArray(r.caps) ? r.caps : [];
    const factors = r.factors || {};
    const fixRow = (f, i) => {
      const st = state.fixState[i] || '';
      let actions = `<button class="va-btn va-btn--sm va-btn--ai" type="button" data-fix-apply="${i}">${ICON.wand}<span>Fix it</span></button><button class="va-btn va-btn--sm va-btn--ghost" type="button" data-fix-ignore="${i}">Ignore</button>`;
      if (st === 'applied') actions = `<span class="va-fix__state">${ICON.check}Applied</span><button class="va-link" type="button" data-fix-undo="${i}">${ICON.undo}Undo</button>`;
      if (st === 'ignored') actions = `<span class="va-fix__state">Ignored</span><button class="va-link" type="button" data-fix-restore="${i}">Restore</button>`;
      if (st === 'fixing') actions = `<span class="va-working">${dots}Fixing…</span>`;
      if (st === 'manual') actions = `<span class="va-fix__state">The assistant replied in Copy</span><button class="va-link" type="button" data-fix-open="${i}">Open</button>`;
      return `<li class="va-fix${st ? ` is-${st}` : ''}">
        <div class="va-fix__head">${f.priority ? `<span class="va-tag va-tag--${esc(String(f.priority).toLowerCase())}">${esc(f.priority)}</span>` : ''}<p class="va-fix__change">${esc(f.change)}</p></div>
        ${f.performanceHypothesis && st !== 'ignored' ? `<p class="va-fix__why">${esc(f.performanceHypothesis)}</p>` : ''}
        <div class="va-fix__actions">${actions}</div>
      </li>`;
    };
    area.innerHTML = `${errorHtml}
      <div class="va-stale" role="status"${ratingStale() ? '' : ' hidden'}>${ICON.alert}<span>You’ve changed the ad since this rating.</span><button class="va-btn va-btn--sm" type="button" data-act="rate">Rate again</button></div>
      <div class="va-card va-score va-score--${tone}">
        <div class="va-score__top">
          ${gauge(score, tone)}
          <div class="va-score__text">
            <span class="va-verdict va-verdict--${tone}">${esc(r.verdict || '')}</span>
            <p>${tone === 'good' ? 'Strong enough to put a test budget behind.' : tone === 'bad' ? 'The reviewer would rework this before spending on it.' : 'Close. Apply a fix or two, then rate again.'}</p>
            ${r.confidence ? `<span class="va-meta">Confidence: ${esc(r.confidence)}</span>` : ''}
          </div>
        </div>
        ${state.ratingFrames.length ? framesRow(state.ratingFrames, false) : ''}
      </div>
      ${caps.length ? `<div class="va-caps">${caps.map(c => `<p>${ICON.alert}<span>${esc(c.reason)} <b>Capped at ${esc(Number(c.cap).toFixed(1))}</b></span></p>`).join('')}</div>` : ''}
      ${fixes.length ? `<div class="va-block"><h4>Top fixes</h4><ol class="va-fixes">${fixes.map(fixRow).join('')}</ol></div>` : ''}
      <details class="va-factors"><summary>All factors</summary><ul>${RT.FACTOR_ORDER.filter(k => factors[k]).map(k => {
        const f = factors[k];
        const rating = Math.min(10, Math.max(1, Number(f.rating) || 1));
        const label = f.label || RT.FACTOR_LABELS[k] || k;
        return `<li><div class="va-factor__head"><span>${esc(label)}</span><b>${esc(rating.toFixed(1))}</b></div><div class="va-bar va-bar--${rating >= 7 ? 'good' : rating >= 5 ? 'warn' : 'bad'}" role="meter" aria-valuemin="1" aria-valuemax="10" aria-valuenow="${rating}" aria-label="${esc(`${label}: ${rating.toFixed(1)} out of 10`)}"><span style="width:${rating * 10}%"></span></div>${f.evidence?.[0] ? `<p>${esc(f.evidence[0])}</p>` : ''}</li>`;
      }).join('')}</ul></details>
      <div class="va-rate-foot"><button class="va-btn va-btn--sm va-btn--ghost" type="button" data-act="rate">${ICON.retry}<span>Rate again</span></button><span class="va-meta">${esc(RT.NOTE)}${r.cost != null ? ` Cost ${esc(RT.formatCost(r.cost))}.` : ''}</span></div>`;
  }
  els.rate.addEventListener('click', async event => {
    const t = event.target;
    if (t.closest('[data-act="to-research"]')) { goStep('research'); return; }
    if (t.closest('[data-act="rate"]')) { rateAd().catch(() => {}); return; }
    const fixes = state.rating?.fixes || [];
    const apply = t.closest('[data-fix-apply]');
    if (apply) {
      const i = Number(apply.dataset.fixApply);
      state.fixState[i] = 'fixing';
      renderRate();
      const msg = await sendChat(`Apply this fix from the ad rating and keep everything else the same: ${fixes[i]?.change || ''}`, { fromFix: true });
      state.fixState[i] = msg?.patch ? 'applied' : msg ? 'manual' : '';
      if (!msg) toast('The assistant couldn’t apply that. Try again, or edit the text yourself.', { tone: 'bad' });
      renderRate();
      return;
    }
    const ignore = t.closest('[data-fix-ignore]');
    if (ignore) { state.fixState[Number(ignore.dataset.fixIgnore)] = 'ignored'; renderRate(); return; }
    const restore = t.closest('[data-fix-restore]');
    if (restore) { delete state.fixState[Number(restore.dataset.fixRestore)]; renderRate(); return; }
    const fixUndo = t.closest('[data-fix-undo]');
    if (fixUndo) { undo(); delete state.fixState[Number(fixUndo.dataset.fixUndo)]; renderRate(); return; }
    if (t.closest('[data-fix-open]')) { goStep('copy'); selectTab($('va-tab-chat')); }
  });

  // ─── 5 Export ────────────────────────────────────────────────────────────
  let exporting = null;
  function renderExport() {
    [...els.exsizes.querySelectorAll('[data-ex]')].forEach(b => b.setAttribute('aria-pressed', String(state.exportIds.includes(b.dataset.ex))));
    const n = state.exportIds.length;
    const span = Math.max(0, state.trimOut - state.trimIn);
    const tooLong = state.exportIds.filter(id => !layoutFor(id).fits).map(id => id.replace('x', ':'));
    const items = [];
    items.push(hasClip()
      ? { tone: 'ok', text: `<b>Clip</b> ${esc(state.clip?.name || 'Loaded')} · ${span.toFixed(1)}s` }
      : { tone: 'todo', text: '<b>Clip</b> None yet', act: '<button class="va-link" type="button" data-act="to-research">Add one</button>' });
    items.push(tooLong.length
      ? { tone: 'warn', text: `<b>Copy</b> Too long for ${esc(tooLong.join(', '))}`, act: '<button class="va-link" type="button" data-act="to-copy">Shorten</button>' }
      : { tone: 'ok', text: '<b>Copy</b> Fits every size you picked' });
    if (state.ratingStatus === 'loading') items.push({ tone: 'busy', text: '<b>Rating</b> Rating the ad…' });
    else if (!state.rating) items.push({ tone: 'warn', text: '<b>Rating</b> Not rated yet: FrameUp rates it first' });
    else if (ratingStale()) items.push({ tone: 'warn', text: `<b>Rating</b> ${esc(Number(state.rating.score).toFixed(1))} before your last change: rates again first` });
    else items.push({ tone: toneOf(state.rating.verdict) === 'bad' ? 'warn' : 'ok', text: `<b>Rating</b> ${esc(Number(state.rating.score).toFixed(1))} · ${esc(state.rating.verdict)}`, act: '<button class="va-link" type="button" data-act="to-rate">See it</button>' });
    els.checklist.innerHTML = items.map(item => `<li class="is-${item.tone}"><span class="va-checklist__icon" aria-hidden="true">${item.tone === 'ok' ? ICON.check : item.tone === 'busy' ? '<span class="va-spin"></span>' : ICON.alert}</span><span class="va-checklist__text">${item.text}</span>${item.act || ''}</li>`).join('');
    if (!exporting) {
      els.exportBtn.disabled = !hasClip() || state.ratingStatus === 'loading';
      els.exportBtn.innerHTML = `${ICON.download}<span>Export ${n} MP4${n === 1 ? '' : 's'}</span>`;
    }
  }
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
  els.checklist.addEventListener('click', event => {
    if (event.target.closest('[data-act="to-research"]')) goStep('research');
    if (event.target.closest('[data-act="to-copy"]')) { goStep('copy'); selectTab($('va-tab-edit')); }
    if (event.target.closest('[data-act="to-rate"]')) goStep('rate');
  });

  function confirmRedesign(result) {
    return new Promise(resolve => {
      if (typeof els.confirm.showModal !== 'function') { resolve(window.confirm('The rating says this ad needs a redesign. Export anyway?') ? 'export' : 'fix'); return; }
      const top = result.fixes?.[0]?.change;
      els.confirmText.textContent = `The reviewer scored it ${Number(result.score).toFixed(1)} out of 10 (${result.verdict}).${top ? ` Top fix: ${top}` : ''} Export anyway?`;
      els.confirm.returnValue = '';
      els.confirm.addEventListener('close', () => resolve(els.confirm.returnValue || 'fix'), { once: true });
      els.confirm.showModal();
    });
  }

  // Rate → (confirm) → export. The rating never blocks: if it fails, export goes ahead.
  async function startExport() {
    if (exporting) { exporting.cancel(); return; }
    if (!hasClip()) { els.exportStatus.textContent = 'Add a clip first.'; return; }
    if (!els.rights.checked) {
      els.exportStatus.textContent = 'Tick the footage confirmation first.';
      const box = els.rights.closest('.va-check');
      els.rights.focus();
      box.classList.remove('is-nudge');
      void box.offsetWidth;
      box.classList.add('is-nudge');
      return;
    }
    let note = '';
    if (!state.rating || ratingStale()) {
      els.exportStatus.textContent = 'Rating the ad before export…';
      try { await rateAd(); els.exportStatus.textContent = ''; } catch (error) { note = ' Rating was unavailable, so it exported without one.'; }
    }
    if (state.rating && !ratingStale() && isRedesign(state.rating.verdict)) {
      const choice = await confirmRedesign(state.rating);
      if (choice !== 'export') { els.exportStatus.textContent = ''; goStep('rate'); return; }
    }
    await exportSizes(state.exportIds);
    if (note && state.exported) els.exportStatus.textContent += note;
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
      audioSource = audioCtx.createMediaElementSource(els.video);
      monitor = audioCtx.createGain();
      monitor.gain.value = previewMuted ? 0 : 1;
      audioSource.connect(monitor).connect(audioCtx.destination);
      // A muted element sends silence into Web Audio too: unmute it and let the
      // monitor gain decide what the speaker hears.
      els.video.muted = false;
    }
    return audioCtx;
  }
  function pickFormat() {
    const options = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
    return options.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  }
  const slug = text => String(text || 'ad').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ad';
  let fileUrls = [];

  async function exportSizes(sizeIds) {
    if (exporting) { exporting.cancel(); return; }
    if (!hasClip()) { els.exportStatus.textContent = 'Add a clip first.'; return; }
    if (!els.rights.checked) { els.exportStatus.textContent = 'Tick the footage confirmation first.'; els.rights.focus(); return; }
    const mimeType = pickFormat();
    if (!mimeType) { els.exportStatus.textContent = 'This browser cannot record video. Use Chrome or Edge.'; return; }
    await document.fonts.ready;
    setPlaying(false);
    const ac = audioGraph();
    await ac.resume();
    const audioDest = ac.createMediaStreamDestination();
    audioSource.connect(audioDest);
    const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
    const targets = sizeIds.map(id => {
      const s = B.SIZES[id];
      const canvas = document.createElement('canvas');
      canvas.width = s.width;
      canvas.height = s.height;
      const stream = canvas.captureStream(30);
      audioDest.stream.getAudioTracks().forEach(track => stream.addTrack(track.clone()));
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: id === '9x16' ? 12e6 : 10e6, audioBitsPerSecond: 128000 });
      const chunks = [];
      recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      return { id, s, canvas, ctx: canvas.getContext('2d'), blur: document.createElement('canvas'), layout: layoutFor(id), recorder, chunks, stream };
    });
    const span = Math.max(0.5, state.trimOut - state.trimIn);
    const bar = els.exportProgress.querySelector('span');
    els.exportProgress.hidden = false;
    bar.style.width = '0%';
    els.exportBtn.disabled = false;
    els.exportBtn.innerHTML = '<span>Cancel export</span>';
    els.exportBtn.classList.add('is-cancel');
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

    const drawAll = () => targets.forEach(t => R.drawFrame(t.ctx, { width: t.s.width, height: t.s.height, video: els.video, bg: bg(), ops: t.layout.ops, logoImage: logo.img, blurCanvas: t.blur }));
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
    els.exportBtn.classList.remove('is-cancel');
    els.stage.classList.remove('is-recording');
    els.exportProgress.hidden = true;
    renderExport();
    if (cancelled) { els.exportStatus.textContent = 'Export cancelled.'; draw(); return; }
    const name = `${brand().id}-${slug(state.trend?.title || state.headline)}`;
    fileUrls.forEach(url => URL.revokeObjectURL(url));
    fileUrls = [];
    const rows = targets.map(t => {
      const blob = new Blob(t.chunks, { type: mimeType.split(';')[0] });
      const href = URL.createObjectURL(blob);
      fileUrls.push(href);
      const fileName = `${name}-${t.s.width}x${t.s.height}.${ext}`;
      const a = document.createElement('a');
      a.href = href;
      a.download = fileName;
      document.body.append(a);
      a.click();
      setTimeout(() => a.remove(), 1000);
      return { fileName, href, mb: blob.size / 1048576 };
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
  }

  // ─── Stage toolbar: brand, size, Look ────────────────────────────────────
  els.brands.innerHTML = B.AD_BRANDS.map(b => `<button type="button" role="radio" data-brand="${esc(b.id)}" aria-checked="false" title="${esc(b.label)}" aria-label="${esc(b.label)}"><span class="va-dot" style="--c:${esc(b.wordmark?.bg || b.accent)}" aria-hidden="true"></span><span>${esc(b.short || b.label)}</span></button>`).join('');
  const markRadios = (group, attr, value) => [...group.querySelectorAll('[role="radio"]')].forEach(b => { const on = b.dataset[attr] === value; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  function setBrand(id) {
    state.brandId = B.byId(id).id;
    markRadios(els.brands, 'brand', state.brandId);
    els.cta.placeholder = brand().cta;
    els.stage.style.setProperty('--va-brand', brand().wordmark?.bg || brand().accent);
    els.stage.closest('.va-page')?.style.setProperty('--va-mark', brand().highlight.bg);
    paintPlaceholder();
    refreshLogo();
    changed();
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
      next.focus();
      next.click();
    });
  }
  radioGroup(els.brands, 'brand', id => setBrand(id));
  radioGroup(els.sizes, 'size', id => {
    state.size = id;
    markRadios(els.sizes, 'size', id);
    if (state.exportIds.length === 1) state.exportIds = [id];
    relayout();
    renderSteps();
    if (state.step === 'export') renderExport();
  });
  radioGroup(els.ownSport, 'sport', v => { ownSport = v; markRadios(els.ownSport, 'sport', v); });
  markRadios(els.sizes, 'size', state.size);
  markRadios(els.ownSport, 'sport', ownSport);

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

  // ─── Start ───────────────────────────────────────────────────────────────
  setBrand(state.brandId);
  syncFields();
  goStep('moment', { focus: false });
  Promise.all([
    document.fonts.load(`700 80px ${R.CONDENSED}`),
    document.fonts.load('400 40px Roboto'),
    document.fonts.load('500 40px Roboto'),
    document.fonts.load('700 40px Roboto'),
  ]).catch(() => {}).finally(() => refreshLogo());
  relayout();
  loadTrends();
  window.VideoAdsPage = { state, relayout, layoutFor, exportSizes, startExport, useClip, goStep, rateAd, selectMoment, sendChat, generateDrafts, applyCopy, undo, setTrim, adSignature, ratingStale };
})();
