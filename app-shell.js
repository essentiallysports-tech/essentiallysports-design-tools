// FrameUp app shell: left sidebar, top bar with breadcrumbs, and a ⌘K command
// palette, built from one navigation config. Desktop only (> 900px); phones keep
// the existing mobile chrome. Styles live in es-ui.css.
(() => {
  'use strict';

  const base = window.location.pathname.includes('/ai-page/') ? '../' : '';
  const desktop = window.matchMedia('(min-width: 901px)');

  const icon = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    guideMap: icon('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
    home: icon('<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>'),
    social: icon('<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3.5"/><path d="M16.5 7.5h.01"/>'),
    youtube: icon('<rect x="3" y="6" width="18" height="12" rx="4"/><path d="m10.5 9.5 4 2.5-4 2.5z"/>'),
    newsletter: icon('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>'),
    reels: icon('<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 15h8M8 18h5"/><path d="m11 7.5 3 2-3 2z"/>'),
    request: icon('<path d="M4 20 20 12 4 4l2.5 8z"/><path d="M6.5 12H12"/>'),
    dashboard: icon('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>'),
    feedback: icon('<path d="M5 18.5V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8z"/><path d="M9 9h6M9 12h4"/>'),
    logo: icon('<path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="m4 7 8 4 8-4M12 11v10"/>'),
    guide: icon('<path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h9"/>'),
    video: icon('<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3"/>'),
    faq: icon('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4"/><path d="M12 17h.01"/>'),
    sparkle: icon('<path d="M12 3.5 13.9 9 19.5 11l-5.6 2-1.9 5.5-1.9-5.5L4.5 11l5.6-2z"/><path d="M18.5 3.5v3M17 5h3"/>'),
    gallery: icon('<rect x="3.5" y="4" width="17" height="16" rx="3"/><circle cx="9" cy="9.5" r="1.8"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4.5 3.5"/>'),
    library: icon('<rect x="4" y="4" width="7" height="7" rx="2"/><circle cx="16.5" cy="7.5" r="3.5"/><path d="M4 20l3.5-6 3.5 6z"/><rect x="13" y="13" width="7" height="7" rx="2"/>'),
    trophy: icon('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M9 20h6"/>'),
    search: icon('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>'),
    collapse: icon('<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M9 4v16"/><path d="m15 10-2 2 2 2"/>'),
    news: icon('<path d="M4 10.5v3a1 1 0 0 0 1 1h2.5l5.5 4V5.5l-5.5 4H5a1 1 0 0 0-1 1z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>'),
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
      ['Financial Ticker and List widgets', 'Three new HTML widgets for newsletters: Financial Ticker, List Widget and List Widget V2.'],
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
        <button class="whats-new-close" type="button" aria-label="Close">${'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'}</button>
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
      <div class="es-palette__search">${ICONS.search}<input type="text" placeholder="Jump to a workspace, page or guide…" aria-label="Search" autocomplete="off"><kbd class="es-kbd">Esc</kbd></div>
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

  function renderPalette(query = '') {
    const list = palette.querySelector('.es-palette__list');
    const q = query.trim().toLowerCase();
    const admin = isAdmin();
    const groups = NAV.map(group => ({
      label: group.label || 'Go to',
      items: group.items.filter(item => item.palette !== false && (!item.adminOnly || admin) && (!q || item.label.toLowerCase().includes(q) || group.label.toLowerCase().includes(q))),
    })).filter(group => group.items.length);
    if (!groups.length) {
      list.innerHTML = '<p class="es-palette__empty">No matches</p>';
      return;
    }
    list.innerHTML = groups.map(group => `
      <div class="es-menu__label">${group.label}</div>
      ${group.items.map(item => `<a class="es-menu__item" role="option" href="${base}${item.href}">${ICONS[item.icon]}<span>${item.label}</span></a>`).join('')}`).join('');
    list.querySelector('.es-menu__item')?.classList.add('is-active');
    list.querySelectorAll('.es-menu__item').forEach(link => link.addEventListener('click', () => palette.close()));
  }

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
  function start() { setTimeout(boot, 0); setTimeout(startTickerIfAuthed, 0); setTimeout(tagNewTemplates, 0); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  desktop.addEventListener?.('change', event => { if (event.matches) boot(); });

  window.FrameUpShell = { openPalette, setCollapsed, nav: NAV };
})();
