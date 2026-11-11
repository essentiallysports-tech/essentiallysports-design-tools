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
      label: 'Create',
      items: [
        { id: 'generate', label: 'Generate', href: 'generate.html', icon: 'sparkle', badge: 'New', desc: 'Turn a brief into on-brand, editable Social Media posts.' },
        { id: 'instagram', label: 'Social Media', short: 'Social', href: 'index.html#instagram', icon: 'social', editor: true },
        { id: 'youtube', label: 'YouTube', href: 'index.html#youtube', icon: 'youtube', editor: true },
        { id: 'newsletter', label: 'Newsletter', href: 'index.html#newsletter', icon: 'newsletter', editor: true },
        { id: 'reels', label: 'Reel Captions', short: 'Reels', href: 'reels.html', icon: 'reels', editor: true },
      ],
    },
    {
      label: 'Work',
      items: [
        { id: 'request', label: 'Design Request', short: 'Request', href: 'design-request.html', icon: 'request', desc: 'Send the design team one clear brief with context, copy, deadline and references.' },
        { id: 'gallery', label: 'Gallery', href: 'gallery.html', icon: 'gallery', badge: 'New', desc: 'Browse every Social Media post the team has exported.' },
        { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'dashboard', adminOnly: true },
      ],
    },
    {
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
    'design-request.html': 'request',
    'dashboard.html': 'dashboard',
    'gallery.html': 'gallery',
    'generate.html': 'generate',
    'tool-feedback.html': 'feedback',
    'design-system.html': 'library',
    'how-frameup-works.html': 'how',
  };

  function currentId() {
    const file = window.location.pathname.split('/').pop() || 'index.html';
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
  function navItemMarkup(item) {
    const badge = item.badge ? `<span class="es-badge es-badge--new">${item.badge}</span>` : '';
    return `<a class="es-nav-item" href="${base}${item.href}" data-shell-id="${item.id}"${item.adminOnly ? ' data-shell-admin hidden' : ''} title="${item.label}">${ICONS[item.icon]}<span class="es-nav-item__text">${item.label}</span><span class="es-nav-item__short" aria-hidden="true">${item.short || item.label}</span>${badge}</a>`;
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
        <button type="button" class="es-icon-btn es-icon-btn--plain es-sidebar__collapse" aria-label="Collapse sidebar" title="Collapse sidebar">${ICONS.collapse}</button>
      </div>
      <button type="button" class="es-search es-sidebar__search" data-shell-palette aria-label="Search FrameUp" title="Search (Ctrl/Cmd+K)">
        ${ICONS.search}<span>Search</span><kbd class="es-kbd">⌘K</kbd>
      </button>
      <nav class="es-sidebar__scroll" aria-label="Primary">
        ${NAV.map(group => `
          <div class="es-sidebar__section">
            ${group.label ? `<span class="es-sidebar__label">${group.label}</span>` : ''}
            ${group.items.filter(item => item.sidebar !== false).map(navItemMarkup).join('')}
          </div>`).join('')}
      </nav>
      <div class="es-sidebar__foot">
        <div class="es-sidebar__account" data-shell-account></div>
      </div>`;
    document.body.prepend(aside);

    if (isAdmin()) aside.querySelectorAll('[data-shell-admin]').forEach(link => { link.hidden = false; });

    // Reuse the existing account menu (profile, settings, theme, logout).
    const profile = document.querySelector('.navbar .profile-menu');
    if (profile) aside.querySelector('[data-shell-account]').appendChild(profile);

    aside.querySelector('.es-sidebar__collapse').addEventListener('click', () => setCollapsed(!document.documentElement.classList.contains('es-sidebar-collapsed'), true));
    aside.querySelector('[data-shell-palette]').addEventListener('click', openPalette);
    const news = aside.querySelector('[data-shell-id="whats-new"]');
    if (news) {
      news.addEventListener('click', event => { event.preventDefault(); openWhatsNew(); });
      syncWhatsNewDot();
    }
    return aside;
  }

  // ─── What's new ────────────────────────────────────────────────────────
  // Newest first. `templates` (workspace + dropdown value) get a "New" tag in
  // the template dropdowns and picker for 30 days from `date`.
  const WHATS_NEW = [
    { id: '2026-11-11-round2', date: '2026-11-11', items: [
      ['Content · Photos · Style', 'The right panel has three tabs: text in Content, photos and the ES Image Pool together in Photos, placement and colours in Style. Tabs with nothing in them hide.'],
      ['Search finds templates and actions', 'Press ⌘K / Ctrl+K and type: jump to any template, reopen a recent design, or Export, Copy link, Upload a photo.'],
      ['Jump back in', 'Home shows your last four designs; one click reopens them.'],
      ['Clearer template names', 'Section Header (Left / Centred), Video FI (Play Button), Tag FI (Corner Label), Headline List (Big Numbers / Simple), Trivia.'],
      ['One look for icons and controls', 'Every icon shares one style, and fields and buttons in the right panel line up at the same sizes.'],
      ['Phone menu', 'On phones the menu now matches the sidebar.'],
    ] },
    { id: '2026-11-11-basics', date: '2026-11-11', items: [
      ['Your work is saved as you go', 'Refresh or close the tab and everything comes back: every slide, layout and newsletter asset, with photos. "Start fresh" clears it.'],
      ['Reopen past designs', 'The clock button next to Undo lists your last 30 exports. In Gallery, "Open in editor" opens a copy of posts you exported on this browser.'],
      ['Browse templates with previews', '"Browse" next to Post Type and Newsletter Asset shows every template as a picture, with search.'],
      ['Check before export', 'Export warns when sample photos, sample text or an empty headline are still in the design.'],
      ['Spell check', 'Headlines, quotes and names are now spell checked. Numbers, stats and links are not.'],
      ['Keyboard shortcuts', 'Ctrl/⌘ + E exports, Ctrl/⌘ + Shift + L copies the link. Press ? to see them all.'],
      ['Newsletter brand colours', 'Infographic FIs use each newsletter\'s colours from the Newsletter Hub, on one light grey background.'],
    ] },
    { id: '2026-11-10-golf-fis', date: '2026-11-10', items: [
      ['7 golf infographic FIs', 'Player Season Stats, Weekend Winners, Tournament Fields, Defending Champion, Player Quote and two collages, in Newsletter.'],
    ], templates: [
      ['newsletter', 'ig-player-season-stats'], ['newsletter', 'ig-weekend-winners'], ['newsletter', 'ig-tournament-fields'],
      ['newsletter', 'ig-defending-champion'], ['newsletter', 'ig-player-quote'], ['newsletter', 'ig-three-panel-collage'], ['newsletter', 'ig-two-up-collage'],
    ] },
    { id: '2026-11-09-social', date: '2026-11-09', items: [
      ['Multiple Tweets', 'Up to three tweets on one Social post, over your photo.'],
      ['Golf and Neutral colours', 'Golf is a Social sport with its own colour sets, plus a Neutral option.'],
      ['Essentially W NCAA', 'New brand in Video FI, Trivia and the widgets.'],
    ], templates: [['instagram', 'twitter-multi']] },
    { id: '2026-11-07-widgets', date: '2026-11-07', items: [
      ['Financial Ticker and Headline Lists', 'Three new HTML widgets for newsletters: Financial Ticker and two Headline Lists (big numbers or simple).'],
    ], templates: [['newsletter', 'ticker'], ['newsletter', 'list'], ['newsletter', 'list2']] },
  ];
  const WHATS_NEW_SEEN_KEY = 'frameup.whatsNew.seen';
  const NEW_FOR_DAYS = 30;

  function whatsNewSeen() {
    try { return window.localStorage.getItem(WHATS_NEW_SEEN_KEY) || ''; } catch (error) { return WHATS_NEW[0].id; }
  }

  function syncWhatsNewDot() {
    const link = document.querySelector('[data-shell-id="whats-new"]');
    if (!link) return;
    const unread = whatsNewSeen() !== WHATS_NEW[0].id;
    link.classList.toggle('has-unread', unread);
    link.querySelector('.es-nav-item__dot')?.remove();
    if (unread) link.insertAdjacentHTML('beforeend', '<span class="es-nav-item__dot" aria-label="Unread"></span>');
  }

  function isNewTemplate(workspace, value) {
    const cutoff = Date.now() - NEW_FOR_DAYS * 24 * 60 * 60 * 1000;
    return WHATS_NEW.some(entry => new Date(`${entry.date}T12:00:00`).getTime() >= cutoff
      && (entry.templates || []).some(([ws, id]) => ws === workspace && id === value));
  }

  function openWhatsNew() {
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
    WHATS_NEW.forEach(entry => {
      if (entry.id === seen) reachedSeen = true;
      const section = document.createElement('section');
      section.className = 'whats-new-entry';
      if (!reachedSeen && seen) section.classList.add('is-unread');
      const date = document.createElement('h3');
      date.textContent = format(entry.date);
      if (section.classList.contains('is-unread')) date.insertAdjacentHTML('beforeend', '<span class="es-badge es-badge--new">New</span>');
      const items = document.createElement('ul');
      entry.items.forEach(([title, text]) => {
        const item = document.createElement('li');
        const strong = document.createElement('strong');
        strong.textContent = title;
        const copy = document.createElement('span');
        copy.textContent = text;
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
    dialog.showModal();
    try { window.localStorage.setItem(WHATS_NEW_SEEN_KEY, WHATS_NEW[0].id); } catch (error) { /* per browser only */ }
    syncWhatsNewDot();
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
  window.FrameUpWhatsNew = Object.freeze({ open: openWhatsNew, isNewTemplate, entries: WHATS_NEW });

  // Collapsed state is remembered separately for editors and for other pages.
  function collapseKey() {
    const entry = findItem(currentId());
    return entry?.item.editor ? 'frameup-sidebar-editor' : 'frameup-sidebar-page';
  }

  function readCollapsed() {
    try {
      const stored = window.localStorage.getItem(collapseKey());
      if (stored) return stored === 'collapsed';
    } catch (error) { /* storage unavailable */ }
    return Boolean(findItem(currentId())?.item.editor);
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
        return `<div class="es-mobile-nav__group">${group.label ? `<span class="es-mobile-nav__label">${group.label}</span>` : ''}${items.map(item => `<a class="es-mobile-nav__item" href="${item.action ? '#' : base + item.href}" data-shell-id="${item.id}"${item.adminOnly ? ' data-shell-admin hidden' : ''}>${ICONS[item.icon]}<span>${item.label}</span>${item.badge ? `<span class="es-badge es-badge--new">${item.badge}</span>` : ''}</a>`).join('')}</div>`;
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
      if (link.dataset.shellId === id || link.dataset.shellId === owner?.id) link.setAttribute('aria-current', 'page');
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
      if (link.dataset.shellId === id || link.dataset.shellId === owner?.id) link.setAttribute('aria-current', 'page');
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
      <div class="es-palette__search">${ICONS.search}<input type="text" placeholder="Search pages, templates and actions…" aria-label="Search" autocomplete="off"><kbd class="es-kbd">Esc</kbd></div>
      <div class="es-palette__list" role="listbox"></div>`;
    document.body.appendChild(palette);
    const input = palette.querySelector('input');
    input.addEventListener('input', () => renderPalette(input.value));
    input.addEventListener('keydown', event => {
      const items = [...palette.querySelectorAll('.es-menu__item')];
      const current = items.findIndex(item => item.classList.contains('is-active'));
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = event.key === 'ArrowDown' ? Math.min(items.length - 1, current + 1) : Math.max(0, current - 1);
        items.forEach((item, index) => item.classList.toggle('is-active', index === next));
        items[next]?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter') {
        event.preventDefault();
        (items[current] || items[0])?.click();
      }
    });
    palette.addEventListener('click', event => { if (event.target === palette) palette.close(); });
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
      return;
    }
    const runs = [];
    list.innerHTML = shown.map(group => `
      <div class="es-menu__label">${escapeHtml(group.label)}</div>
      ${group.items.map(item => {
        const iconMarkup = ICONS[item.icon] || (String(item.icon || '').startsWith('<svg') ? item.icon : ICONS.template);
        const text = `<span>${escapeHtml(item.label)}</span>${item.hint ? `<small class="es-palette__hint">${escapeHtml(item.hint)}</small>` : ''}`;
        if (item.run) {
          runs.push(item.run);
          return `<button class="es-menu__item" type="button" role="option" data-palette-run="${runs.length - 1}">${iconMarkup}${text}</button>`;
        }
        return `<a class="es-menu__item" role="option" href="${escapeHtml(item.href || '#')}">${iconMarkup}${text}</a>`;
      }).join('')}`).join('');
    list.querySelector('.es-menu__item')?.classList.add('is-active');
    list.querySelectorAll('.es-menu__item').forEach(link => link.addEventListener('click', event => {
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

  function starInitials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '★';
  }

  function tickerItem(star, rank) {
    const item = el('span', `es-ticker__item is-rank-${rank}`);
    const stat = el('span', 'es-ticker__stat');
    stat.append(el('b', '', String(star.count)), ` design${star.count === 1 ? '' : 's'}`);
    item.append(
      el('span', 'es-ticker__rank', `#${rank}`),
      el('span', 'es-ticker__avatar', starInitials(star.name)),
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
    fetchStarUsers().then(stars => { if (stars.length) buildTicker(stars); }).catch(() => {});
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
    // The admin link is revealed after the role check.
    setTimeout(() => { if (isAdmin()) document.querySelectorAll('.es-mobile-nav [data-shell-admin]').forEach(link => { link.hidden = false; }); }, 2500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  desktop.addEventListener?.('change', event => { if (event.matches) boot(); });

  window.FrameUpShell = { openPalette, setCollapsed, nav: NAV, addPaletteSource };
})();
