// FrameUp app shell: left sidebar, top bar with breadcrumbs, and a ⌘K command
// palette, built from one navigation config. Desktop only (> 900px); phones keep
// the existing mobile chrome. Styles live in es-ui.css.
(() => {
  'use strict';

  const base = window.location.pathname.includes('/ai-page/') ? '../' : '';
  const desktop = window.matchMedia('(min-width: 901px)');

  const icon = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    guideMap: icon('<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>'),
    home: icon('<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    social: icon('<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/>'),
    youtube: icon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z"/>'),
    newsletter: icon('<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/>'),
    reels: icon('<path d="m12.296 3.464 3.02 3.956"/><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m6.18 5.276 3.1 3.899"/>'),
    request: icon('<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>'),
    dashboard: icon('<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>'),
    feedback: icon('<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M7 11h10"/><path d="M7 15h6"/><path d="M7 7h8"/>'),
    logo: icon('<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><polyline points="3.29 7 12 12 20.71 7"/><path d="m7.5 4.27 9 5.15"/>'),
    guide: icon('<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>'),
    video: icon('<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>'),
    faq: icon('<circle cx="12" cy="12" r="10"/><path d="M9 9.5a3 2.5 0 016 0c0 2-2 2-3 3.5"/><path d="M12 17h.01"/>'),
    sparkle: icon('<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>'),
    gallery: icon('<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
    library: icon('<path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>'),
    trophy: icon('<path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"/><path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"/><path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3"/><path d="M4 22h16"/><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"/>'),
    search: icon('<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>'),
    collapse: icon('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>'),
    news: icon('<path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"/><path d="M8 6v8"/>'),
    template: icon('<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>'),
    download: icon('<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>'),
    link: icon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
    upload: icon('<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>'),
    clock: icon('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
    keyboard: icon('<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>'),
    trending: icon('<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>'),
    sliders: icon('<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>'),
  };

  // One source of truth for navigation, breadcrumbs and the command palette.
  // `short` is the label under the icon in the collapsed rail. `sidebar: false`
  // keeps a page out of the sidebar (still in breadcrumbs and search); `covers`
  // lets one sidebar item stay highlighted for several pages.
  const GUIDE_IDS = ['logo-guidelines', 'social-guidelines', 'video-guidelines', 'faq'];
  const NAV = [
    {
      label: '',
      items: [
        { id: 'frames', label: 'Home', href: 'index.html#frames', icon: 'home' },
        { id: 'how', label: 'How FrameUp works', short: 'How to', href: 'how-frameup-works.html', icon: 'guideMap' },
      ],
    },
    {
      // The AI features share one page family and one look (ai-studio.css):
      // Generate and Trends are two views of generate.html.
      id: 'ai',
      label: 'AI Studio',
      items: [
        { id: 'generate', label: 'Generate', href: 'generate.html', icon: 'sparkle', badge: 'New', desc: 'Turn a brief into on-brand, editable Social Media posts.' },
        { id: 'trends', label: 'Trends', href: 'generate.html?view=trends', icon: 'trending', badge: 'New', desc: 'What US sports fans are searching and reading now, by sport. Turn any trend into a design.' },
        { id: 'video-ads', label: 'Video Ads', short: 'Ads', href: 'video-ads.html', icon: 'video', badge: 'New', desc: 'Newsletter sign-up video ads: a trending clip, ES copy styles and a CTA, exported as MP4.' },
      ],
    },
    {
      id: 'create',
      label: 'Create',
      items: [
        { id: 'instagram', label: 'Social Media', short: 'Social', href: 'index.html#instagram', icon: 'social', editor: true },
        { id: 'youtube', label: 'YouTube', href: 'index.html#youtube', icon: 'youtube', editor: true },
        { id: 'newsletter', label: 'Newsletter', href: 'index.html#newsletter', icon: 'newsletter', editor: true },
        { id: 'reels', label: 'Reel Captions', short: 'Reels', href: 'reels.html', icon: 'reels', editor: true },
      ],
    },
    {
      id: 'work',
      label: 'Work',
      items: [
        { id: 'request', label: 'Design Request', short: 'Request', href: 'design-request.html', icon: 'request', desc: 'Send the design team one clear brief with context, copy, deadline and references.' },
        { id: 'gallery', label: 'Gallery', href: 'gallery.html', icon: 'gallery', badge: 'New', desc: 'Browse every Social Media post the team has exported.' },
        { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'dashboard', adminOnly: true },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        { id: 'guidelines', label: 'Guidelines', short: 'Guides', href: 'index.html#logo-guidelines', icon: 'guide', covers: GUIDE_IDS, palette: false },
        { id: 'logo-guidelines', label: 'Logo Guidelines', href: 'index.html#logo-guidelines', icon: 'logo', sidebar: false },
        { id: 'social-guidelines', label: 'Social Guidelines', href: 'index.html#social-guidelines', icon: 'guide', sidebar: false },
        { id: 'video-guidelines', label: 'Video Guidelines', href: 'index.html#video-guidelines', icon: 'video', sidebar: false },
        { id: 'faq', label: 'FAQ', href: 'index.html#faq', icon: 'faq', sidebar: false },
        { id: 'whats-new', label: "What's new", short: 'New', href: '#whats-new', icon: 'news', palette: false, action: 'whats-new' },
        { id: 'feedback', label: 'Tool Feedback', short: 'Feedback', href: 'tool-feedback.html', icon: 'feedback' },
        { id: 'library', label: 'UI Library', href: 'design-system.html', icon: 'library', sidebar: false },
      ],
    },
  ];

  const PAGE_IDS = {
    'reels.html': 'reels',
    'video-ads.html': 'video-ads',
    'design-request.html': 'request',
    'dashboard.html': 'dashboard',
    'gallery.html': 'gallery',
    'generate.html': 'generate',
    'tool-feedback.html': 'feedback',
    'design-system.html': 'library',
    'how-frameup-works.html': 'how',
    'trend-design.html': 'trends',
  };

  function currentId() {
    const file = window.location.pathname.split('/').pop() || 'index.html';
    // generate.html has two views; Trends is ?view=trends (a brief opens Generate).
    if (file === 'generate.html') {
      const query = new URLSearchParams(window.location.search);
      return query.get('view') === 'trends' && !query.get('brief') ? 'trends' : 'generate';
    }
    if (PAGE_IDS[file]) return PAGE_IDS[file];
    if (file === 'index.html' || file === '') {
      const hash = window.location.hash.replace('#', '');
      const all = NAV.flatMap(group => group.items);
      // "guidelines" is only a sidebar shortcut, not a page.
      return all.some(item => item.id === hash && !item.covers) ? hash : 'frames';
    }
    return null;
  }

  function findItem(id) {
    for (const group of NAV) {
      const item = group.items.find(entry => entry.id === id);
      if (item) return { group, item };
    }
    return null;
  }

  function isAdmin() {
    const link = document.querySelector('.navbar [data-admin-only]');
    return Boolean(link && !link.hidden);
  }

  // ─── Sidebar ───────────────────────────────────────────────────────────
  // The yellow NEW tag: one markup for the sidebar and the phone menu (the
  // phone menu is the sidebar on small screens). It shimmers once, the first
  // time it is seen (es-motion.js), keyed per item so it never repeats.
  function newBadgeMarkup(item) {
    return item.badge ? `<span class="es-badge es-badge--new es-new-shine" data-es-new-key="nav-${item.id}">${item.badge}</span>` : '';
  }

  // Only real nav links (built from NAV, so they carry data-shell-id) can be the
  // current page. Demo links without an id (the UI Library) are never marked:
  // undefined === undefined must not count as a match.
  function isCurrentLink(link, id, owner) {
    const shellId = link.dataset.shellId;
    return Boolean(shellId) && (shellId === id || shellId === owner?.id);
  }

  function navItemMarkup(item) {
    const badge = newBadgeMarkup(item);
    return `<a class="es-nav-item" href="${base}${item.href}" data-shell-id="${item.id}"${item.adminOnly ? ' data-shell-admin hidden' : ''} data-tip="${item.label}">${ICONS[item.icon]}<span class="es-nav-item__text">${item.label}</span><span class="es-nav-item__short" aria-hidden="true">${item.short || item.label}</span>${badge}</a>`;
  }

  function buildSidebar() {
    const aside = document.createElement('aside');
    aside.className = 'es-sidebar';
    aside.setAttribute('aria-label', 'FrameUp navigation');
    aside.innerHTML = `
      <div class="es-sidebar__brand">
        <a class="es-sidebar__logo" href="${base}index.html#frames" aria-label="FrameUp home">
          <img src="${base}brand-logo-blue.svg" alt="EssentiallySports">
          <img class="es-sidebar__logo-mark" src="${base}favicon.ico" alt="">
        </a>
      </div>
      <button type="button" class="es-search es-sidebar__search" data-shell-palette aria-label="Search FrameUp" title="Search (Ctrl/Cmd+K)">
        ${ICONS.search}<span>Search</span><kbd class="es-kbd">⌘K</kbd>
      </button>
      <nav class="es-sidebar__scroll" aria-label="Primary">
        ${NAV.map(group => `
          <div class="es-sidebar__section${group.id ? ` es-sidebar__section--${group.id}` : ''}">
            ${group.label ? `<span class="es-sidebar__label">${group.id === 'ai' ? '<span class="es-ai-mark" aria-hidden="true"></span>' : ''}${group.label}</span>` : ''}
            ${group.items.filter(item => item.sidebar !== false).map(navItemMarkup).join('')}
          </div>`).join('')}
      </nav>
      <div class="es-sidebar__foot">
        <div class="es-usage" data-shell-usage hidden></div>
        <div class="es-sidebar__account" data-shell-account></div>
      </div>`;
    document.body.prepend(aside);

    // Soft fade above the footer while there is more nav below.
    const scroller = aside.querySelector('.es-sidebar__scroll');
    const syncScrollEnd = () => {
      aside.classList.toggle('es-sidebar--at-end', scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2);
    };
    scroller.addEventListener('scroll', syncScrollEnd, { passive: true });
    window.addEventListener('resize', syncScrollEnd);
    syncScrollEnd();
    setTimeout(syncScrollEnd, 2600); // after the admin link may appear
    startUsage(aside.querySelector('[data-shell-usage]'));

    if (isAdmin()) aside.querySelectorAll('[data-shell-admin]').forEach(link => { link.hidden = false; });

    // Reuse the existing account menu (profile, settings, theme, logout).
    const profile = document.querySelector('.navbar .profile-menu');
    if (profile) aside.querySelector('[data-shell-account]').appendChild(profile);

    aside.querySelector('[data-shell-palette]').addEventListener('click', openPalette);
    const news = aside.querySelector('[data-shell-id="whats-new"]');
    if (news) {
      news.addEventListener('click', event => { event.preventDefault(); openWhatsNew(); });
      syncWhatsNewDot();
    }
    return aside;
  }

  // ─── Personal AI usage (sidebar footer) ────────────────────────────────
  // The signed-in person's AI spend this week (Monday 00:00 UTC onward), read
  // with the frameup_my_ai_spend() database function. The server enforces the
  // same cap (netlify/functions/_ai-gateway.js, AI_USER_WEEKLY_LIMIT_USD).
  // Until that function exists, or if it errors, the card stays hidden.
  const AI_WEEKLY_USER_LIMIT_USD = 20;
  const USAGE_CACHE_KEY = 'frameup.aiUsage.v1';
  const USAGE_CACHE_MS = 60 * 1000;
  const USAGE_REFRESH_MS = 5 * 60 * 1000;
  const USAGE_FEATURES = [
    [/^generate-scene-image/, 'Scene images'],
    [/^generate/, 'Generate'],
    [/^trend/, 'Trends'],
    [/^video-ads/, 'Video Ads'],
  ];
  let usageSlot = null;
  let usageLoading = false;

  function weekStartUtc(now = new Date()) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    return start;
  }

  // "Resets Mon" style text, relative so it is right in every time zone
  // (Monday 00:00 UTC is Sunday evening in the US).
  function resetText(now = new Date()) {
    const next = weekStartUtc(now);
    next.setUTCDate(next.getUTCDate() + 7);
    const hours = (next - now) / 3600e3;
    if (hours < 1) return 'in under an hour';
    if (hours < 24) return `in ${Math.floor(hours)}h`;
    const days = Math.ceil(hours / 24);
    return days === 1 ? 'tomorrow' : `in ${days} days`;
  }

  function featureLabel(key) {
    const match = USAGE_FEATURES.find(([pattern]) => pattern.test(key));
    if (match) return match[1];
    const words = String(key || 'Other').replace(/[-_]+/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  const money = value => `$${(Math.round(value * 100) / 100).toFixed(2)}`;
  const escapeText = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

  function readUsageCache(since) {
    try {
      const cached = JSON.parse(window.sessionStorage.getItem(USAGE_CACHE_KEY) || 'null');
      if (cached && cached.since === since && Date.now() - cached.at < USAGE_CACHE_MS) return cached;
    } catch (error) { /* storage blocked */ }
    return null;
  }

  function writeUsageCache(since, data) {
    try { window.sessionStorage.setItem(USAGE_CACHE_KEY, JSON.stringify({ at: Date.now(), since, data })); } catch (error) { /* storage blocked */ }
  }

  function hideUsage() {
    if (!usageSlot) return;
    usageSlot.hidden = true;
    usageSlot.innerHTML = '';
  }

  function renderUsage(data) {
    if (!usageSlot) return;
    const total = Number(data?.total_usd);
    if (!data || !Number.isFinite(total)) { hideUsage(); return; }
    const limit = AI_WEEKLY_USER_LIMIT_USD;
    const ratio = Math.max(0, total / limit);
    const state = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok';
    const reset = resetText();
    const nextReset = weekStartUtc();
    nextReset.setUTCDate(nextReset.getUTCDate() + 7);
    const resetTitle = `Resets ${nextReset.toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' })} (Monday 00:00 UTC)`;
    const features = Object.entries(data.by_feature || {})
      .reduce((sum, [key, usd]) => {
        const label = featureLabel(key);
        sum[label] = (sum[label] || 0) + (Number(usd) || 0);
        return sum;
      }, {});
    const rows = Object.entries(features).filter(([, usd]) => usd >= 0.005).sort((a, b) => b[1] - a[1]);
    const clickable = rows.length > 0;
    const wasOpen = usageSlot.querySelector('.es-usage__card[aria-expanded="true"]');
    const tag = clickable ? 'button' : 'div';
    const percent = Math.min(100, Math.round(ratio * 100));
    usageSlot.dataset.state = state;
    usageSlot.innerHTML = `
      <${tag} class="es-usage__card"${clickable ? ` type="button" aria-expanded="false" aria-controls="es-usage-pop" aria-label="AI usage: ${money(total)} of $${limit} this week. Show breakdown"` : ''} title="${escapeText(resetTitle)}">
        <span class="es-usage__row">
          <span class="es-usage__label">AI usage</span>
          <span class="es-usage__amount"><strong>${money(total)}</strong> of $${limit}</span>
        </span>
        <span class="es-usage__bar" role="progressbar" aria-label="AI usage this week" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${Math.min(limit, Math.round(total * 100) / 100)}" aria-valuetext="${money(total)} of $${limit}"><span class="es-usage__fill" style="width:${percent}%"></span></span>
        <span class="es-usage__reset">${state === 'over' ? `Limit reached · resets ${reset}` : `Resets ${reset}`}</span>
      </${tag}>
      ${clickable ? `<div class="es-usage__pop" id="es-usage-pop" role="group" aria-label="AI usage by feature" hidden>
        <p class="es-usage__pop-head"><span>This week</span><strong>${money(total)}</strong></p>
        <ul class="es-usage__list">${rows.map(([label, usd]) => `<li><span>${escapeText(label)}</span><span>${money(usd)}</span></li>`).join('')}</ul>
        <p class="es-usage__pop-note">${data.calls ? `${Number(data.calls)} AI ${Number(data.calls) === 1 ? 'call' : 'calls'} · ` : ''}$${limit} weekly limit</p>
      </div>` : ''}`;
    usageSlot.hidden = false;
    if (clickable && wasOpen) setUsageOpen(true);
  }

  function setUsageOpen(open) {
    const card = usageSlot?.querySelector('button.es-usage__card');
    const pop = usageSlot?.querySelector('.es-usage__pop');
    if (!card || !pop) return;
    card.setAttribute('aria-expanded', String(open));
    pop.hidden = !open;
  }

  async function loadUsage({ force = false } = {}) {
    if (!usageSlot || usageLoading) return;
    const since = weekStartUtc().toISOString();
    const cached = force ? null : readUsageCache(since);
    if (cached) { if (cached.data) renderUsage(cached.data); else hideUsage(); return; }
    let client = null;
    try { client = window.ESAuth?.getSupabaseClient?.(); } catch (error) { client = null; }
    if (!client || typeof client.rpc !== 'function') return; // auth not ready yet
    usageLoading = true;
    let data = null;
    try {
      const result = await client.rpc('frameup_my_ai_spend', { p_since: since });
      if (!result?.error) data = Array.isArray(result?.data) ? result.data[0] || null : result?.data || null;
    } catch (error) {
      data = null; // function missing or offline: keep the card hidden
    } finally {
      usageLoading = false;
    }
    writeUsageCache(since, data);
    if (data) renderUsage(data); else hideUsage();
  }

  function startUsage(slot) {
    usageSlot = slot;
    if (!slot) return;
    slot.addEventListener('click', event => {
      if (!event.target.closest('button.es-usage__card')) return;
      setUsageOpen(slot.querySelector('.es-usage__pop')?.hidden !== false);
    });
    document.addEventListener('click', event => { if (!slot.contains(event.target)) setUsageOpen(false); });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || slot.querySelector('.es-usage__pop')?.hidden !== false) return;
      setUsageOpen(false);
      slot.querySelector('button.es-usage__card')?.focus();
    });
    window.addEventListener('es:auth-ready', () => loadUsage());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadUsage(); });
    window.addEventListener('focus', () => loadUsage());
    setInterval(() => { if (document.visibilityState === 'visible') loadUsage({ force: true }); }, USAGE_REFRESH_MS);
    loadUsage();
  }
  window.FrameUpUsage = Object.freeze({ refresh: () => loadUsage({ force: true }), limit: AI_WEEKLY_USER_LIMIT_USD });

  // ─── What's new ────────────────────────────────────────────────────────
  // One source for release notes: tours/updates.json (newest first). The
  // same file drives the "What's new" tour (tours/updates.js). Entries:
  // { id, date, title, items: [{ title, text, page?, route?, target? }],
  //   templates?: [[workspace, dropdown value]] }; `templates` get a "New"
  // tag in the template dropdowns and picker for 30 days from `date`.
  const WHATS_NEW_URL = `${base}tours/updates.json`;
  const WHATS_NEW_SEEN_KEY = 'frameup.whatsNew.seen';
  const NEW_FOR_DAYS = 30;
  let WHATS_NEW = [];

  // Older notes stored items as [title, text]; accept both shapes.
  function normalizeWhatsNew(data) {
    const entries = Array.isArray(data) ? data : (data && Array.isArray(data.entries) ? data.entries : []);
    return entries
      .filter(entry => entry && entry.id && entry.date && !entry.draft)
      .map(entry => ({
        ...entry,
        items: (entry.items || []).map(item => (Array.isArray(item) ? { title: item[0], text: item[1] } : item)).filter(item => item && (item.title || item.text)),
      }));
  }

  // Fetched once per page; `no-cache` revalidates, so a new push shows up on
  // the next page load without a cache-busting query.
  const whatsNewReady = (typeof fetch === 'function'
    ? fetch(WHATS_NEW_URL, { cache: 'no-cache', headers: { Accept: 'application/json' } })
      .then(response => (response.ok ? response.json() : []))
      .catch(() => [])
    : Promise.resolve([]))
    .then(data => {
      WHATS_NEW = normalizeWhatsNew(data);
      const refresh = () => { syncWhatsNewDot(); tagNewTemplates(); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(refresh, 0), { once: true });
      else setTimeout(refresh, 0);
      return WHATS_NEW;
    });

  function newestWhatsNewId() {
    return WHATS_NEW[0]?.id || '';
  }

  function whatsNewSeen() {
    try { return window.localStorage.getItem(WHATS_NEW_SEEN_KEY) || ''; } catch (error) { return newestWhatsNewId(); }
  }

  function markWhatsNewSeen() {
    if (!newestWhatsNewId()) return;
    try { window.localStorage.setItem(WHATS_NEW_SEEN_KEY, newestWhatsNewId()); } catch (error) { /* per browser only */ }
    syncWhatsNewDot();
  }

  function syncWhatsNewDot() {
    const link = document.querySelector('[data-shell-id="whats-new"]');
    if (!link) return;
    const unread = Boolean(newestWhatsNewId()) && whatsNewSeen() !== newestWhatsNewId();
    link.classList.toggle('has-unread', unread);
    link.querySelector('.es-nav-item__dot')?.remove();
    if (unread) link.insertAdjacentHTML('beforeend', '<span class="es-nav-item__dot" aria-label="Unread"></span>');
  }

  function isNewTemplate(workspace, value) {
    const cutoff = Date.now() - NEW_FOR_DAYS * 24 * 60 * 60 * 1000;
    return WHATS_NEW.some(entry => new Date(`${entry.date}T12:00:00`).getTime() >= cutoff
      && (entry.templates || []).some(([ws, id]) => ws === workspace && id === value));
  }

  async function openWhatsNew() {
    await whatsNewReady;
    document.querySelectorAll('.whats-new-dialog').forEach(stale => stale.remove());
    const dialog = document.createElement('dialog');
    dialog.className = 'es-dialog whats-new-dialog';
    dialog.setAttribute('aria-labelledby', 'whats-new-title');
    const format = date => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
    dialog.innerHTML = `
      <div class="whats-new-head">
        <h2 id="whats-new-title">What's new</h2>
        <button class="whats-new-close" type="button" aria-label="Close">${'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'}</button>
      </div>
      <div class="whats-new-list"></div>`;
    const list = dialog.querySelector('.whats-new-list');
    const seen = whatsNewSeen();
    let reachedSeen = false;
    if (!WHATS_NEW.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Release notes could not load. Try again in a moment.';
      list.appendChild(empty);
    }
    WHATS_NEW.forEach(entry => {
      if (entry.id === seen) reachedSeen = true;
      const section = document.createElement('section');
      section.className = 'whats-new-entry';
      section.dataset.entryId = entry.id;
      if (!reachedSeen && seen) section.classList.add('is-unread');
      const date = document.createElement('h3');
      date.textContent = format(entry.date);
      if (section.classList.contains('is-unread')) date.insertAdjacentHTML('beforeend', '<span class="es-badge es-badge--new">New</span>');
      const items = document.createElement('ul');
      entry.items.forEach(({ title, text }) => {
        const item = document.createElement('li');
        const strong = document.createElement('strong');
        strong.textContent = title || '';
        const copy = document.createElement('span');
        copy.textContent = text || '';
        item.append(strong, copy);
        items.appendChild(item);
      });
      section.append(date, items);
      list.appendChild(section);
    });
    dialog.querySelector('.whats-new-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.appendChild(dialog);
    // Tours add "Show me" and "Take the tour" here (tours/tour-launcher.js).
    window.dispatchEvent(new CustomEvent('frameup:whatsnew-open', { detail: { dialog, entries: WHATS_NEW } }));
    dialog.showModal();
    markWhatsNewSeen();
  }

  // "New" tag on recently added templates in the editor's dropdowns.
  function tagNewTemplates() {
    [['instagram', 'instagram-post-type-select'], ['newsletter', 'newsletter-asset-select']].forEach(([workspace, id]) => {
      const select = document.getElementById(id);
      if (!select) return;
      [...select.options].forEach(option => {
        if (!option.dataset.tag && isNewTemplate(workspace, option.value)) option.dataset.tag = 'new';
      });
    });
    try { if (typeof window.syncAllCustomSelects === 'function') window.syncAllCustomSelects(); } catch (error) { /* labels only */ }
  }
  window.FrameUpWhatsNew = Object.freeze({
    open: openWhatsNew,
    isNewTemplate,
    ready: whatsNewReady,
    markSeen: markWhatsNewSeen,
    get entries() { return WHATS_NEW; },
  });

  // Collapsed state is remembered separately for editors and for other pages.
  function collapseKey() {
    const entry = findItem(currentId());
    return entry?.item.editor ? 'frameup-sidebar-editor' : 'frameup-sidebar-page';
  }

  // The sidebar no longer collapses (Suhail, 2026-11-15): it is always open,
  // in a narrower width. Old "collapsed" preferences are ignored.
  function readCollapsed() {
    return false;
  }

  function setCollapsed(collapsed, remember) {
    document.documentElement.classList.toggle('es-sidebar-collapsed', collapsed);
    const button = document.querySelector('.es-sidebar__collapse');
    if (button) {
      const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      button.setAttribute('aria-label', label);
      button.title = label;
      button.setAttribute('aria-expanded', String(!collapsed));
    }
    // Tooltips only help when the labels are hidden (icon-only sidebar).
    document.querySelectorAll('.es-nav-item[data-tip]').forEach(link => {
      if (collapsed) link.title = link.dataset.tip;
      else link.removeAttribute('title');
    });
    if (remember) {
      try { window.localStorage.setItem(collapseKey(), collapsed ? 'collapsed' : 'expanded'); } catch (error) { /* ignore */ }
    }
    window.dispatchEvent(new Event('resize'));
  }

  // ─── Phone menu (same list as the sidebar) ─────────────────────────────
  // Each page's old .navbar keeps the menu button and the account menu
  // (site-mobile-chrome.js); its links are replaced by NAV, so phones get the
  // same items, names and order as the sidebar.
  function buildMobileNav() {
    document.querySelectorAll('.navbar .navbar-menu').forEach(menu => {
      if (menu.querySelector('.es-mobile-nav')) return;
      const list = document.createElement('div');
      list.className = 'es-mobile-nav';
      list.innerHTML = NAV.map(group => {
        const items = group.items.filter(item => item.sidebar !== false);
        if (!items.length) return '';
        return `<div class="es-mobile-nav__group${group.id ? ` es-mobile-nav__group--${group.id}` : ''}">${group.label ? `<span class="es-mobile-nav__label">${group.label}</span>` : ''}${items.map(item => `<a class="es-mobile-nav__item" href="${item.action ? '#' : base + item.href}" data-shell-id="${item.id}"${item.adminOnly ? ' data-shell-admin hidden' : ''}>${ICONS[item.icon]}<span>${item.label}</span>${newBadgeMarkup(item)}</a>`).join('')}</div>`;
      }).join('');
      menu.prepend(list);
      menu.classList.add('has-es-mobile-nav');
      list.querySelector('[data-shell-id="whats-new"]')?.addEventListener('click', event => {
        event.preventDefault();
        menu.closest('.navbar')?.querySelector('.mobile-menu-toggle')?.click();
        openWhatsNew();
      });
      if (isAdmin()) list.querySelectorAll('[data-shell-admin]').forEach(link => { link.hidden = false; });
    });
    syncMobileNavCurrent();
  }

  function syncMobileNavCurrent() {
    const id = currentId();
    const owner = NAV.flatMap(group => group.items).find(item => item.covers?.includes(id));
    document.querySelectorAll('.es-mobile-nav__item').forEach(link => {
      if (isCurrentLink(link, id, owner)) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  // ─── Top bar ───────────────────────────────────────────────────────────
  function buildTopbar() {
    const bar = document.createElement('header');
    bar.className = 'es-topbar';
    bar.innerHTML = '<ol class="es-breadcrumbs" aria-label="Breadcrumb"></ol><div class="es-topbar__actions" data-shell-actions></div>';
    // Editors: undo/redo move next to the breadcrumbs, like a document editor.
    const history = document.querySelector('.studio-history-group');
    if (history) bar.querySelector('.es-breadcrumbs').after(history);
    const anchor = document.querySelector('.navbar');
    if (anchor) anchor.after(bar);
    else document.querySelector('.es-sidebar').after(bar);
    const ticker = document.querySelector('.es-ticker');
    if (ticker) bar.after(ticker);
    return bar;
  }

  function syncActive() {
    const id = currentId();
    document.documentElement.classList.toggle('es-editor', Boolean(findItem(id)?.item.editor));
    const owner = NAV.flatMap(group => group.items).find(item => item.covers?.includes(id));
    document.querySelectorAll('.es-nav-item').forEach(link => {
      if (isCurrentLink(link, id, owner)) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    const crumbs = document.querySelector('.es-breadcrumbs');
    if (!crumbs) return;
    const entry = findItem(id);
    const pageTitle = entry?.item.label || document.title.split('|')[0].trim();
    crumbs.innerHTML = `<li><a href="${base}index.html#frames">FrameUp</a></li>${entry?.group.label ? `<li>${entry.group.label}</li>` : ''}<li><span aria-current="page">${pageTitle}</span></li>`;
  }

  // Inside pages share one header pattern; pages without a title get one.
  function ensurePageHead() {
    const entry = findItem(currentId());
    const main = document.querySelector('.request-page');
    if (!entry || !main || main.querySelector('.es-page-head')) return;
    const head = document.createElement('header');
    head.className = 'es-page-head';
    const title = document.createElement('h1');
    title.textContent = entry.item.label;
    head.appendChild(title);
    if (entry.item.desc) {
      const copy = document.createElement('p');
      copy.textContent = entry.item.desc;
      head.appendChild(copy);
    }
    main.prepend(head);
  }

  // Dashboard sections become tabs under the page title (no second sidebar).
  function arrangeDashboard() {
    const tabs = document.querySelector('.dashboard-sidebar');
    const header = document.querySelector('.dashboard-topbar');
    if (tabs && header && header.nextElementSibling !== tabs) header.after(tabs);
  }

  // ─── Command palette ───────────────────────────────────────────────────
  let palette = null;
  function buildPalette() {
    palette = document.createElement('dialog');
    palette.className = 'es-palette';
    palette.setAttribute('aria-label', 'Search FrameUp');
    palette.innerHTML = `
      <div class="es-palette__search">${ICONS.search}<input type="text" placeholder="Search pages, templates and actions…" aria-label="Search" autocomplete="off" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="es-palette-list"><kbd class="es-kbd">Esc</kbd></div>
      <div class="es-palette__list" id="es-palette-list" role="listbox" aria-label="Results"></div>`;
    document.body.appendChild(palette);
    const input = palette.querySelector('input');
    input.addEventListener('input', () => renderPalette(input.value));
    input.addEventListener('keydown', event => {
      const items = [...palette.querySelectorAll('.es-menu__item')];
      const current = items.findIndex(item => item.classList.contains('is-active'));
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = event.key === 'ArrowDown' ? Math.min(items.length - 1, current + 1) : Math.max(0, current - 1);
        setActivePaletteItem(items, next);
        items[next]?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter') {
        event.preventDefault();
        (items[current] || items[0])?.click();
      }
    });
    palette.addEventListener('click', event => { if (event.target === palette) palette.close(); });
  }

  // Marks one option active for keyboard users and screen readers alike.
  function setActivePaletteItem(items, activeIndex) {
    items.forEach((item, index) => {
      const active = index === activeIndex;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
    const input = palette?.querySelector('input');
    const activeItem = items[activeIndex];
    if (!input) return;
    if (activeItem?.id) input.setAttribute('aria-activedescendant', activeItem.id);
    else input.removeAttribute('aria-activedescendant');
  }

  // Extra groups from the page (templates, actions, recent designs).
  const paletteSources = [];
  function addPaletteSource(source) {
    if (typeof source === 'function') paletteSources.push(source);
  }

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function renderPalette(query = '') {
    const list = palette.querySelector('.es-palette__list');
    const q = query.trim().toLowerCase();
    const admin = isAdmin();
    const matches = text => !q || String(text || '').toLowerCase().includes(q);
    const groups = NAV.map(group => ({
      label: group.label || 'Go to',
      items: group.items
        .filter(item => item.palette !== false && (!item.adminOnly || admin) && (matches(item.label) || matches(group.label)))
        .map(item => ({ label: item.label, icon: item.icon, href: `${base}${item.href}` })),
    }));
    paletteSources.forEach(source => {
      let extra = [];
      try { extra = source(q) || []; } catch (error) { extra = []; }
      extra.forEach(group => {
        if (!q && group.onlyWhenSearching) return;
        const items = (group.items || []).filter(item => matches(`${item.label} ${item.hint || ''} ${item.keywords || ''} ${group.label}`));
        const limited = items.slice(0, group.limit || 12);
        const existing = groups.find(entry => entry.label === group.label);
        if (existing) existing.items.push(...limited);
        else groups[group.first ? 'unshift' : 'push']({ label: group.label, items: limited });
      });
    });
    const shown = groups.filter(group => group.items.length);
    if (!shown.length) {
      list.innerHTML = '<p class="es-palette__empty">No matches</p>';
      setActivePaletteItem([], -1);
      return;
    }
    const runs = [];
    list.innerHTML = shown.map(group => `
      <div class="es-menu__label" role="presentation">${escapeHtml(group.label)}</div>
      ${group.items.map(item => {
        const iconMarkup = ICONS[item.icon] || (String(item.icon || '').startsWith('<svg') ? item.icon : ICONS.template);
        const text = `<span>${escapeHtml(item.label)}</span>${item.hint ? `<small class="es-palette__hint">${escapeHtml(item.hint)}</small>` : ''}`;
        if (item.run) {
          runs.push(item.run);
          return `<button class="es-menu__item" type="button" role="option" data-palette-run="${runs.length - 1}">${iconMarkup}${text}</button>`;
        }
        return `<a class="es-menu__item" role="option" href="${escapeHtml(item.href || '#')}">${iconMarkup}${text}</a>`;
      }).join('')}`).join('');
    const options = [...list.querySelectorAll('.es-menu__item')];
    options.forEach((option, index) => { option.id = `es-palette-option-${index}`; });
    setActivePaletteItem(options, 0);
    options.forEach(link => link.addEventListener('click', event => {
      palette.close();
      const index = link.dataset.paletteRun;
      if (index != null) {
        event.preventDefault();
        try { runs[Number(index)](); } catch (error) { console.warn('[palette] action failed:', error); }
      }
    }));
  }

  // Available on every page.
  addPaletteSource(() => [{
    label: 'Help',
    items: [{ label: "What's new", icon: 'news', keywords: 'changes updates release notes', run: () => openWhatsNew() }],
  }]);

  function openPalette() {
    if (!palette) buildPalette();
    const input = palette.querySelector('input');
    input.value = '';
    renderPalette();
    palette.showModal();
    input.focus();
  }

  function onKeydown(event) {
    const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    // The dashboard keeps Ctrl/Cmd+K for its own search; '/' still opens the palette there.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !document.querySelector('.dashboard-app')) {
      event.preventDefault();
      if (palette?.open) palette.close(); else openPalette();
    } else if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      openPalette();
    }
  }

  // ─── Stars of the week ticker (Home only, every screen size) ───────────
  const STAR_DAYS = 7;
  const STAR_CACHE_KEY = 'frameup.starUsers.v2';
  const STAR_CACHE_MS = 10 * 60 * 1000;
  // Each half of the loop must be wider than the widest viewport, or a gap shows.
  const STAR_HALF_MIN_PX = 2800;
  const STAR_ITEM_PX = 340;
  let tickerStarted = false;

  function starDisplayName(value) {
    return String(value || '').trim().replace(/[._]+/g, ' ').split(/\s+/).filter(Boolean)
      .map(word => (word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word))
      .join(' ');
  }

  async function fetchStarUsers() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(STAR_CACHE_KEY) || 'null');
      if (cached && Date.now() - cached.at < STAR_CACHE_MS) return cached.stars;
    } catch (error) { /* storage blocked: fetch fresh */ }
    const auth = window.ESAuth;
    if (!auth || !(await auth.ensureSupabaseReady())) return [];
    const client = auth.getSupabaseClient();
    if (!client) return [];
    const { data, error } = await client.rpc('get_frameup_star_user', { p_days: STAR_DAYS });
    if (error) return [];
    const stars = (Array.isArray(data) ? data : [])
      .filter(row => row && row.star_name && row.export_count > 0)
      .slice(0, 3)
      .map(row => ({ name: starDisplayName(row.star_name), count: Number(row.export_count) }));
    try { sessionStorage.setItem(STAR_CACHE_KEY, JSON.stringify({ at: Date.now(), stars })); } catch (error) { /* ignore */ }
    return stars;
  }

  function el(tag, className, textContent) {
    const node = document.createElement(tag);
    node.className = className;
    if (textContent != null) node.textContent = textContent;
    return node;
  }

  // Google-style avatar: the first name's initial on a solid colour picked
  // from the name, so each person always gets the same colour. Every colour
  // keeps white text at 4.5:1 or better; no purple (ES palette rule).
  const AVATAR_COLORS = ['#0A6FDE', '#0B8043', '#C5221F', '#B06000', '#00796B', '#5F6368', '#1A6B8A', '#A1361B'];
  function starInitials(name) {
    const first = name.trim().charAt(0);
    return first ? first.toUpperCase() : '★';
  }
  function avatarColor(name) {
    let hash = 0;
    for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }

  function tickerItem(star, rank) {
    const item = el('span', `es-ticker__item is-rank-${rank}`);
    const rankBadge = el('span', 'es-ticker__rank', String(rank));
    rankBadge.dataset.rank = String(rank);
    const avatar = el('span', 'es-ticker__avatar', starInitials(star.name));
    avatar.style.backgroundColor = avatarColor(star.name);
    const stat = el('span', 'es-ticker__stat');
    stat.append(el('b', '', String(star.count)), ` design${star.count === 1 ? '' : 's'}`);
    item.append(
      rankBadge,
      avatar,
      el('span', 'es-ticker__name', star.name),
      stat,
    );
    return item;
  }

  function tickerCycle(stars) {
    return stars.map((star, index) => tickerItem(star, index + 1));
  }

  // index.html hosts Home plus the editor routes; the ticker only shows on Home.
  function isMainIndexPage() {
    const file = window.location.pathname.split('/').pop() || 'index.html';
    return !base && file === 'index.html';
  }

  function isHomeRoute() {
    return isMainIndexPage() && currentId() === 'frames';
  }

  function syncTickerVisibility() {
    const bar = document.querySelector('.es-ticker');
    if (!bar) return;
    const show = isHomeRoute();
    bar.hidden = !show;
    document.documentElement.classList.toggle('es-has-ticker', show);
  }

  function buildTicker(stars) {
    if (document.querySelector('.es-ticker')) return;
    const bar = el('div', 'es-ticker');
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-label', `Stars of the week, last ${STAR_DAYS} days: ${stars.map((star, index) => `${index + 1}. ${star.name}, ${star.count} design${star.count === 1 ? '' : 's'}`).join('; ')}`);
    const label = el('span', 'es-ticker__label');
    label.setAttribute('aria-hidden', 'true');
    label.innerHTML = `${ICONS.trophy}<span>Stars <span class="es-ticker__label-long">of the week</span></span>`;
    const viewport = el('div', 'es-ticker__viewport');
    viewport.setAttribute('aria-hidden', 'true');
    const track = el('div', 'es-ticker__track');
    const cycles = Math.max(2, Math.ceil(STAR_HALF_MIN_PX / (stars.length * STAR_ITEM_PX)));
    // Two identical halves; the track slides by exactly one half, so the loop is seamless.
    for (let half = 0; half < 2; half += 1) {
      const group = el('div', 'es-ticker__group');
      for (let i = 0; i < cycles; i += 1) group.append(...tickerCycle(stars));
      track.appendChild(group);
    }
    viewport.appendChild(track);
    bar.append(label, viewport);
    const anchor = document.querySelector('.es-topbar') || document.querySelector('.navbar');
    if (anchor) anchor.after(bar);
    else document.body.prepend(bar);
    syncTickerVisibility();
    window.addEventListener('hashchange', syncTickerVisibility);
  }

  function startTicker() {
    if (tickerStarted || !isMainIndexPage()) return;
    tickerStarted = true;
    // Auth can confirm (from cache) while the page is still parsing; build only
    // once the body and the shell exist, after boot() has run.
    fetchStarUsers().then(stars => {
      if (!stars.length) return;
      const build = () => setTimeout(() => buildTicker(stars), 0);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true });
      else build();
    }).catch(() => { tickerStarted = false; });
  }

  window.addEventListener('es:auth-ready', startTicker);
  // requireAuth hides the page until the session is confirmed; if it's already
  // visible by DOM ready, auth-ready fired before this script was listening.
  function startTickerIfAuthed() {
    if (window.ESAuth && document.documentElement.style.visibility !== 'hidden') startTicker();
  }

  // ─── Boot ──────────────────────────────────────────────────────────────
  let built = false;
  function boot() {
    if (built || !desktop.matches) return;
    built = true;
    document.documentElement.classList.add('es-shell');
    setCollapsed(readCollapsed(), false);
    buildSidebar();
    buildTopbar();
    syncActive();
    ensurePageHead();
    arrangeDashboard();
    window.addEventListener('hashchange', () => { syncActive(); setCollapsed(readCollapsed(), false); });
    document.addEventListener('keydown', onKeydown);
    // Enable collapse/expand animation only after the first paint.
    setTimeout(() => document.documentElement.classList.add('es-shell-ready'), 400);
    // The admin link is revealed asynchronously after the role check.
    setTimeout(() => { if (isAdmin()) document.querySelectorAll('[data-shell-admin]').forEach(link => { link.hidden = false; }); }, 2500);
  }

  // Apply shell layout classes immediately (this script loads in <head>), so the
  // old navbar never flashes and content is already offset on first paint.
  if (desktop.matches) {
    document.documentElement.classList.add('es-shell');
    document.documentElement.classList.toggle('es-sidebar-collapsed', readCollapsed());
  }

  // site-chrome.js builds the account menu first; wait for it.
  function start() {
    setTimeout(boot, 0);
    setTimeout(startTickerIfAuthed, 0);
    setTimeout(tagNewTemplates, 0);
    setTimeout(buildMobileNav, 0);
    window.addEventListener('hashchange', syncMobileNavCurrent);
    // Pages that switch views in place (AI Studio) change the URL without a
    // reload: re-read it so the highlight and breadcrumbs follow.
    const syncRoute = () => { if (built) syncActive(); syncMobileNavCurrent(); };
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('frameup:routechange', syncRoute);
    // The admin link is revealed after the role check.
    setTimeout(() => { if (isAdmin()) document.querySelectorAll('.es-mobile-nav [data-shell-admin]').forEach(link => { link.hidden = false; }); }, 2500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  desktop.addEventListener?.('change', event => {
    if (!event.matches) return;
    boot();
    // Back on desktop: the account menu belongs in the sidebar.
    const slot = document.querySelector('.es-sidebar [data-shell-account]');
    const profile = document.querySelector('.profile-menu');
    if (slot && profile && profile.parentElement !== slot) slot.appendChild(profile);
  });

  window.FrameUpShell = { openPalette, setCollapsed, nav: NAV, addPaletteSource };
})();
