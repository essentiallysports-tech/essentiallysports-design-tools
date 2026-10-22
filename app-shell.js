// FrameUp app shell: left sidebar, top bar with breadcrumbs, and a ⌘K command
// palette, built from one navigation config. Desktop only (> 900px); phones keep
// the existing mobile chrome. Styles live in es-ui.css.
(() => {
  'use strict';

  const base = window.location.pathname.includes('/ai-page/') ? '../' : '';
  const desktop = window.matchMedia('(min-width: 901px)');

  const icon = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
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
    library: icon('<rect x="4" y="4" width="7" height="7" rx="2"/><circle cx="16.5" cy="7.5" r="3.5"/><path d="M4 20l3.5-6 3.5 6z"/><rect x="13" y="13" width="7" height="7" rx="2"/>'),
    trophy: icon('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M9 20h6"/>'),
    search: icon('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>'),
    collapse: icon('<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M9 4v16"/><path d="m15 10-2 2 2 2"/>'),
  };

  // One source of truth for navigation, breadcrumbs and the command palette.
  const NAV = [
    {
      label: 'Create',
      items: [
        { id: 'frames', label: 'Home', href: 'index.html#frames', icon: 'home' },
        { id: 'instagram', label: 'Social Media', href: 'index.html#instagram', icon: 'social', editor: true },
        { id: 'youtube', label: 'YouTube', href: 'index.html#youtube', icon: 'youtube', editor: true },
        { id: 'newsletter', label: 'Newsletter', href: 'index.html#newsletter', icon: 'newsletter', editor: true },
        { id: 'reels', label: 'Reel Captions', href: 'reels.html', icon: 'reels', editor: true },
      ],
    },
    {
      label: 'Work',
      items: [
        { id: 'request', label: 'Design Request', href: 'design-request.html', icon: 'request', desc: 'Send the design team one clear brief with context, copy, deadline and references.' },
        { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'dashboard', adminOnly: true },
        { id: 'feedback', label: 'Tool Feedback', href: 'tool-feedback.html', icon: 'feedback' },
      ],
    },
    {
      label: 'Resources',
      items: [
        { id: 'logo-guidelines', label: 'Logo Guidelines', href: 'index.html#logo-guidelines', icon: 'logo' },
        { id: 'social-guidelines', label: 'Social Guidelines', href: 'index.html#social-guidelines', icon: 'guide' },
        { id: 'video-guidelines', label: 'Video Guidelines', href: 'index.html#video-guidelines', icon: 'video' },
        { id: 'faq', label: 'FAQ', href: 'index.html#faq', icon: 'faq' },
        { id: 'library', label: 'UI Library', href: 'design-system.html', icon: 'library', badge: 'New' },
      ],
    },
    {
      label: 'Extras',
      items: [
        { id: 'pickem', label: "NFL Pick'em", href: 'pickem.html', icon: 'trophy' },
      ],
    },
  ];

  const PAGE_IDS = {
    'reels.html': 'reels',
    'design-request.html': 'request',
    'dashboard.html': 'dashboard',
    'tool-feedback.html': 'feedback',
    'design-system.html': 'library',
    'pickem.html': 'pickem',
  };

  function currentId() {
    const file = window.location.pathname.split('/').pop() || 'index.html';
    if (PAGE_IDS[file]) return PAGE_IDS[file];
    if (file === 'index.html' || file === '') {
      const hash = window.location.hash.replace('#', '');
      const all = NAV.flatMap(group => group.items);
      return all.some(item => item.id === hash) ? hash : 'frames';
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
    return `<a class="es-nav-item" href="${base}${item.href}" data-shell-id="${item.id}"${item.adminOnly ? ' data-shell-admin hidden' : ''} title="${item.label}">${ICONS[item.icon]}<span class="es-nav-item__text">${item.label}</span>${badge}</a>`;
  }

  function buildSidebar() {
    const aside = document.createElement('aside');
    aside.className = 'es-sidebar';
    aside.setAttribute('aria-label', 'FrameUp navigation');
    aside.innerHTML = `
      <div class="es-sidebar__brand">
        <a class="es-sidebar__logo" href="${base}index.html#frames" aria-label="FrameUp home">
          <img src="${base}brand-logo-blue.svg" alt="EssentiallySports">
          <img class="es-sidebar__logo-mark" src="${base}favicon.svg" alt="">
        </a>
        <button type="button" class="es-icon-btn es-icon-btn--plain es-sidebar__collapse" aria-label="Collapse sidebar" title="Collapse sidebar">${ICONS.collapse}</button>
      </div>
      <button type="button" class="es-search es-sidebar__search" data-shell-palette aria-label="Search FrameUp" title="Search (Ctrl/Cmd+K)">
        ${ICONS.search}<span>Search</span><kbd class="es-kbd">⌘K</kbd>
      </button>
      <nav class="es-sidebar__scroll" aria-label="Primary">
        ${NAV.map(group => `
          <div class="es-sidebar__section">
            <span class="es-sidebar__label">${group.label}</span>
            ${group.items.map(navItemMarkup).join('')}
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
    return aside;
  }

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
    return bar;
  }

  function syncActive() {
    const id = currentId();
    document.documentElement.classList.toggle('es-editor', Boolean(findItem(id)?.item.editor));
    document.querySelectorAll('.es-nav-item').forEach(link => {
      if (link.dataset.shellId === id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    const crumbs = document.querySelector('.es-breadcrumbs');
    if (!crumbs) return;
    const entry = findItem(id);
    const pageTitle = entry?.item.label || document.title.split('|')[0].trim();
    crumbs.innerHTML = `<li><a href="${base}index.html#frames">FrameUp</a></li>${entry ? `<li>${entry.group.label}</li>` : ''}<li><span aria-current="page">${pageTitle}</span></li>`;
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
      label: group.label,
      items: group.items.filter(item => (!item.adminOnly || admin) && (!q || item.label.toLowerCase().includes(q) || group.label.toLowerCase().includes(q))),
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
  function start() { setTimeout(boot, 0); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  desktop.addEventListener?.('change', event => { if (event.matches) boot(); });

  window.FrameUpShell = { openPalette, setCollapsed, nav: NAV };
})();
