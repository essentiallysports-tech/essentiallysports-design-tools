(() => {
  'use strict';

  const scriptUrl = document.currentScript?.src || new URL('site-chrome.js', window.location.href).href;
  const rootUrl = new URL('.', scriptUrl);
  const asset = path => new URL(path, rootUrl).href;

  function closeMenus(except = null) {
    document.querySelectorAll('.nav-dropdown.is-open').forEach(menu => {
      if (menu === except) return;
      menu.classList.remove('is-open');
      menu.querySelector(':scope > .nav-trigger')?.setAttribute('aria-expanded', 'false');
    });
  }

  const PROFILE_STORAGE_KEY = 'es.ai.profile';
  const THEME_STORAGE_KEY = 'frameup.theme.v1';

  function cleanProfileValue(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function titleCaseName(value) {
    const cleaned = cleanProfileValue(value).replace(/[._-]+/g, ' ');
    if (!cleaned) return 'Guest User';
    return cleaned
      .split(' ')
      .map(part => part ? part[0].toUpperCase() + part.slice(1) : '')
      .join(' ');
  }

  function nameFromEmail(email) {
    const localPart = cleanProfileValue(email).split('@')[0];
    return titleCaseName(localPart.replace(/[._-]+/g, ' '));
  }

  // Edit profile keeps its own copy (es.ai.profile.edits.v1, tied to the
  // signed-in address) because the sign-in check rewrites es.ai.profile with
  // only { name, email }; lay the edits back over it.
  const PROFILE_EDITS_KEY = 'es.ai.profile.edits.v1';
  function readStoredProfile() {
    let profile = {};
    let edits = null;
    try { profile = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || '{}') || {}; } catch { profile = {}; }
    try { edits = JSON.parse(localStorage.getItem(PROFILE_EDITS_KEY) || 'null'); } catch { edits = null; }
    if (!edits || typeof edits !== 'object') return profile;
    const owner = cleanProfileValue(profile.email).toLowerCase();
    const editsOwner = cleanProfileValue(edits.email).toLowerCase();
    if (owner && editsOwner && owner !== editsOwner) return profile;
    return { ...profile, ...edits, email: profile.email || edits.email };
  }

  function hasCustomAvatar(value) {
    const avatar = cleanProfileValue(value);
    return Boolean(avatar) && !/(?:^|\/)profile-avatar-default\.webp(?:$|\?)/.test(avatar);
  }

  function accountBase(menu) {
    if (menu?.dataset.accountBase) return menu.dataset.accountBase;
    return window.location.pathname.includes('/ai-page/') ? '' : 'ai-page/';
  }

  // ─── Account menu ──────────────────────────────────────────────────────
  // One menu button (WAI-ARIA menu pattern) on every page: the sidebar
  // footer on desktop, the phone menu on small screens, the old navbar
  // elsewhere. Keyboard: Enter / Space / ↓ open on the first item, ↑ on the
  // last; ↑ ↓ ← → move, Home / End jump, a letter jumps to the next item
  // starting with it, Esc closes and gives focus back to the button, Tab
  // closes and moves on.
  const ITEM_SELECTOR = '.profile-option, [data-profile-theme-choice]';
  const THEME_CHOICES = ['light', 'dark', 'system'];
  const unsavedChecks = new Set();

  function profileIcon(kind) {
    const icons = {
      profile: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
      library: '<path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
      tours: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
      news: '<path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"/><path d="M8 6v8"/>',
      logout: '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
      light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
      dark: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
      system: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[kind]}</svg>`;
  }

  function profileMarkup(menu, index) {
    const base = accountBase(menu);
    const root = window.location.pathname.includes('/ai-page/') ? '../' : '';
    const suffix = index ? `-${index + 1}` : '';
    const popoverId = `frameup-account-popover${suffix}`;
    const triggerId = `profile-trigger${suffix}`;
    const item = (kind, label, attrs) => `<${attrs.href ? 'a' : 'button'} class="profile-option" role="menuitem" tabindex="-1"${attrs.href ? ` href="${attrs.href}"` : ' type="button"'}${attrs.extra || ''}>${profileIcon(kind)}<span class="profile-option__label">${label}</span>${attrs.after || ''}</${attrs.href ? 'a' : 'button'}>`;
    const choice = (value, label) => `<button type="button" role="menuitemradio" tabindex="-1" aria-checked="false" data-profile-theme-choice="${value}" aria-pressed="false">${profileIcon(value)}<span>${label}</span></button>`;
    return `
      <button class="profile-trigger" type="button" id="${triggerId}" aria-haspopup="menu" aria-expanded="false" aria-controls="${popoverId}" aria-label="Account menu">
        <span class="profile-avatar" data-profile-initial aria-hidden="true"></span>
        <span class="profile-copy">
          <span class="profile-name" data-profile-name>Guest User</span>
          <span class="profile-sub" data-profile-sub hidden></span>
        </span>
        <svg class="profile-chevron" viewBox="4 7 16 10" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="profile-dropdown" id="${popoverId}" role="menu" aria-labelledby="${triggerId}" aria-orientation="vertical" aria-hidden="true" inert data-account-menu>
        <div class="profile-identity" role="none">
          <span class="profile-identity-avatar" data-profile-popover-avatar aria-hidden="true"></span>
          <span class="profile-identity-copy">
            <strong data-profile-popover-name>Guest User</strong>
            <span class="profile-identity-email" data-profile-popover-email hidden></span>
            <span class="profile-identity-role" data-profile-popover-role hidden></span>
          </span>
        </div>
        <div class="profile-sep" role="separator"></div>
        <div class="profile-actions" role="group" aria-label="Account">
          ${item('profile', 'Edit profile', { href: `${base}profile.html`, extra: ' data-profile-destination="profile"' })}
          ${item('settings', 'Settings', { href: `${base}settings.html`, extra: ' data-profile-destination="settings"' })}
        </div>
        <div class="profile-sep" role="separator"></div>
        <div class="profile-actions profile-actions--help" role="group" aria-label="Help and resources">
          ${item('tours', 'Tours', { extra: ' data-tour-launch data-profile-action="tours" hidden', after: '<span class="profile-option__meta" data-profile-tours-progress hidden></span>' })}
          ${item('news', 'What’s new', { extra: ' data-profile-action="whats-new" hidden', after: '<span class="profile-option__dot" data-profile-news-dot hidden></span>' })}
          ${item('library', 'UI Library', { href: `${root}design-system.html`, extra: ' data-profile-destination="design-system"' })}
        </div>
        <div class="profile-sep" role="separator"></div>
        <div class="profile-appearance" role="group" aria-labelledby="${popoverId}-appearance">
          <span class="profile-appearance-label" id="${popoverId}-appearance">Appearance</span>
          <div class="profile-theme-segment">
            ${choice('light', 'Light')}${choice('dark', 'Dark')}${choice('system', 'System')}
          </div>
        </div>
        <div class="profile-sep" role="separator"></div>
        ${item('logout', 'Log out', { href: `${base}logout.html?from=menu`, extra: ' data-profile-destination="logout" data-profile-action="logout"' }).replace('class="profile-option"', 'class="profile-option profile-option--logout"')}
      </div>`;
  }

  function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function themePreference() {
    const preference = window.FrameUpTheme?.preference?.();
    return THEME_CHOICES.includes(preference) ? preference : currentTheme();
  }

  function syncThemeControls() {
    const preference = themePreference();
    document.querySelectorAll('[data-profile-theme-choice]').forEach(button => {
      const on = button.dataset.profileThemeChoice === preference;
      button.setAttribute('aria-checked', String(on));
      button.setAttribute('aria-pressed', String(on));
    });
  }

  function refreshProfileMenu(profile = readStoredProfile()) {
    const email = cleanProfileValue(profile.email);
    const name = titleCaseName(profile.name || nameFromEmail(email));
    const role = cleanProfileValue(profile.role);
    const team = cleanProfileValue(profile.team);
    const roleLine = [role, team && team !== role ? team : ''].filter(Boolean).join(' · ');
    const avatar = hasCustomAvatar(profile.avatar) ? cleanProfileValue(profile.avatar) : '';

    document.querySelectorAll('.profile-menu [data-profile-name], .profile-menu [data-profile-popover-name]').forEach(element => {
      element.textContent = name;
    });
    document.querySelectorAll('.profile-menu [data-profile-popover-email]').forEach(element => {
      element.textContent = email;
      element.title = email;
      element.hidden = !email;
    });
    document.querySelectorAll('.profile-menu [data-profile-popover-role]').forEach(element => {
      element.textContent = roleLine;
      element.hidden = !roleLine;
    });
    document.querySelectorAll('.profile-menu [data-profile-sub]').forEach(element => {
      element.textContent = email || role;
      element.hidden = !(email || role);
    });
    document.querySelectorAll('.profile-menu .profile-trigger').forEach(trigger => {
      trigger.setAttribute('aria-label', `Account menu: ${name}`);
    });
    const initial = (name.match(/\p{L}|\p{N}/u) || ['?'])[0].toUpperCase();
    document.querySelectorAll('.profile-menu [data-profile-initial], .profile-menu [data-profile-popover-avatar]').forEach(element => {
      // Drawn with CSS (attr(data-initial)), so page scripts that clear the
      // avatar's text don't remove it.
      element.dataset.initial = initial;
      element.style.setProperty('--profile-avatar-bg', avatarColor(name));
      element.classList.toggle('has-image', Boolean(avatar));
      if (avatar) element.style.backgroundImage = `url("${avatar.replace(/"/g, '%22')}")`;
      else element.style.removeProperty('background-image');
    });
  }

  // Google-style avatar: the first letter on a colour picked from the name.
  // Every colour keeps white text at 4.5:1 or more.
  const AVATAR_COLORS = ['#0A6BD8', '#00796B', '#2E7D32', '#C2410C', '#0E7490', '#475569', '#B91C1C'];
  function avatarColor(name) {
    let hash = 0;
    for (const ch of String(name || '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }

  // Items that only work when their feature loaded on this page (tours, the
  // What's new panel) show up when the menu opens.
  function syncOptionalItems(menu) {
    const tours = window.FrameUpTours;
    const news = window.FrameUpWhatsNew;
    menu.querySelectorAll('[data-profile-action="tours"]').forEach(button => {
      button.hidden = !tours?.openPicker;
      const meta = button.querySelector('[data-profile-tours-progress]');
      if (!meta || button.hidden || !tours.progressSummary) return;
      Promise.resolve(tours.progressSummary()).then(summary => {
        const total = Number(summary?.total) || 0;
        const done = Number(summary?.done) || 0;
        meta.hidden = !total;
        meta.textContent = total ? `${done}/${total}` : '';
        button.setAttribute('aria-label', total ? `Tours, ${done} of ${total} done` : 'Tours');
      }).catch(() => { meta.hidden = true; });
    });
    menu.querySelectorAll('[data-profile-action="whats-new"]').forEach(button => {
      button.hidden = !news?.open;
      const dot = button.querySelector('[data-profile-news-dot]');
      if (!dot || button.hidden) return;
      let seen = '';
      try { seen = localStorage.getItem('frameup.whatsNew.seen') || ''; } catch { seen = ''; }
      const newest = news.entries?.[0]?.id || '';
      dot.hidden = !(newest && newest !== seen);
      button.setAttribute('aria-label', dot.hidden ? 'What’s new' : 'What’s new, unread updates');
    });
  }

  function menuItems(menu) {
    return [...(menu?.querySelectorAll(`:scope > .profile-dropdown :is(${ITEM_SELECTOR})`) || [])]
      .filter(item => !item.hidden && !item.closest('[hidden]') && !item.disabled);
  }

  function focusItem(menu, index) {
    const items = menuItems(menu);
    if (!items.length) return;
    const next = items[(index + items.length) % items.length];
    next.focus({ preventScroll: true });
    // A menu that is still fading in can refuse focus for a frame.
    if (document.activeElement !== next) {
      requestAnimationFrame(() => { if (menu.classList.contains('is-open')) next.focus({ preventScroll: true }); });
    }
  }

  function setProfileOpen(menu, open, options = {}) {
    if (!menu) return;
    const trigger = menu.querySelector(':scope > .profile-trigger');
    const popover = menu.querySelector(':scope > .profile-dropdown');
    if (open) {
      syncOptionalItems(menu);
      syncThemeControls();
    }
    menu.classList.toggle('is-open', open);
    trigger?.setAttribute('aria-expanded', String(open));
    popover?.setAttribute('aria-hidden', String(!open));
    if (popover) popover.inert = !open;
    if (open && options.focusFirst) focusItem(menu, 0);
    if (open && options.focusLast) focusItem(menu, -1);
    // Phones: the menu opens inline at the bottom of the navigation panel.
    if (open && menu.closest('.mobile-menu-account')) {
      requestAnimationFrame(() => popover?.scrollIntoView?.({ block: 'nearest' }));
    }
    if (!open && options.returnFocus) trigger?.focus();
  }

  function closeProfile(except = null, options = {}) {
    document.querySelectorAll('.profile-menu.is-open').forEach(menu => {
      if (menu === except) return;
      setProfileOpen(menu, false, options);
    });
  }

  function normalizeProfileMenus() {
    document.querySelectorAll('.profile-menu').forEach((menu, index) => {
      menu.dataset.profilePopoverVersion = '2';
      menu.dataset.accountMenu = '3';
      menu.innerHTML = profileMarkup(menu, index);
      const currentPage = (window.location.pathname.split('/').pop() || 'index.html').replace('.html', '');
      menu.querySelectorAll('[data-profile-destination]').forEach(link => {
        if (link.dataset.profileDestination === currentPage) link.setAttribute('aria-current', 'page');
      });
    });
    refreshProfileMenu();
    syncThemeControls();
  }

  function applyThemeChoice(choice) {
    const theme = THEME_CHOICES.includes(choice) ? choice : 'light';
    if (window.FrameUpTheme?.apply) window.FrameUpTheme.apply(theme);
    else {
      const resolved = theme === 'system'
        ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {}
      window.dispatchEvent(new CustomEvent('frameup-theme-change', { detail: { theme: resolved, preference: theme } }));
    }
    syncThemeControls();
  }

  // ─── Log out: ask first only when work would be lost ──────────────────
  // The editor autosaves to this device (frameup-autosave.js); give it one
  // chance to finish. Pages with their own forms register a check with
  // FrameUpProfileMenu.registerUnsaved(() => 'message' | '').
  async function unsavedWorkMessage() {
    const autosave = window.FrameUpAutosave;
    try {
      const before = autosave?.status?.();
      if (before?.enabled && (before.dirty || before.saving)) await autosave.saveNow?.();
      const after = autosave?.status?.();
      if (after?.enabled && (after.failed || after.dirty)) return 'Your latest editor changes aren’t saved on this device yet.';
    } catch {
      return 'Your latest editor changes couldn’t be saved on this device.';
    }
    for (const check of unsavedChecks) {
      try {
        const message = check();
        if (message) return typeof message === 'string' ? message : 'You have unsaved changes on this page.';
      } catch { /* a broken check never blocks logging out */ }
    }
    return '';
  }

  function confirmLogout(message) {
    return new Promise(resolve => {
      document.querySelectorAll('.profile-logout-confirm').forEach(node => node.remove());
      const dialog = document.createElement('dialog');
      dialog.className = 'es-dialog profile-logout-confirm';
      dialog.setAttribute('aria-labelledby', 'profile-logout-title');
      dialog.setAttribute('aria-describedby', 'profile-logout-text');
      dialog.innerHTML = `
        <h2 id="profile-logout-title">Log out with unsaved changes?</h2>
        <p id="profile-logout-text"></p>
        <div class="profile-logout-confirm__actions">
          <button class="es-btn" type="button" data-logout-choice="stay">Stay signed in</button>
          <button class="es-btn es-btn--danger" type="button" data-logout-choice="leave">Log out anyway</button>
        </div>`;
      dialog.querySelector('#profile-logout-text').textContent = `${message} If you log out now, they may be lost.`;
      let choice = 'stay';
      dialog.querySelectorAll('[data-logout-choice]').forEach(button => button.addEventListener('click', () => {
        choice = button.dataset.logoutChoice;
        dialog.close();
      }));
      dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
      dialog.addEventListener('close', () => { dialog.remove(); resolve(choice === 'leave'); });
      document.body.appendChild(dialog);
      dialog.showModal();
      dialog.querySelector('[data-logout-choice="stay"]').focus();
    });
  }

  async function startLogout(link) {
    const href = link.getAttribute('href') || `${accountBase(link.closest('.profile-menu'))}logout.html?from=menu`;
    const trigger = link.closest('.profile-menu')?.querySelector(':scope > .profile-trigger');
    closeProfile();
    const message = await unsavedWorkMessage();
    if (message && !await confirmLogout(message)) {
      trigger?.focus();
      return;
    }
    window.location.assign(href);
  }

  function runAction(option) {
    const action = option.dataset.profileAction;
    if (action === 'tours') {
      closeProfile();
      window.FrameUpTours?.openPicker?.();
      return true;
    }
    if (action === 'whats-new') {
      closeProfile();
      window.FrameUpWhatsNew?.open?.();
      return true;
    }
    if (action === 'logout') {
      startLogout(option);
      return true;
    }
    return false;
  }

  function onMenuKeydown(event, menu) {
    const items = menuItems(menu);
    const index = items.indexOf(document.activeElement);
    const radio = document.activeElement?.closest?.('[data-profile-theme-choice]');
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); focusItem(menu, index + 1); return;
      case 'ArrowUp': event.preventDefault(); focusItem(menu, index - 1); return;
      case 'ArrowRight':
      case 'ArrowLeft':
        // Left / right move along the Appearance row; elsewhere they act
        // like down / up.
        event.preventDefault();
        focusItem(menu, index + (event.key === 'ArrowRight' ? 1 : -1));
        return;
      case 'Home': event.preventDefault(); focusItem(menu, 0); return;
      case 'End': event.preventDefault(); focusItem(menu, -1); return;
      case 'Tab':
        // Leave the menu like any menu button: close it and carry on from
        // the button.
        setProfileOpen(menu, false);
        menu.querySelector(':scope > .profile-trigger')?.focus({ preventScroll: true });
        return;
      case 'Enter':
      case ' ':
        if (radio) { event.preventDefault(); applyThemeChoice(radio.dataset.profileThemeChoice); return; }
        if (event.key === ' ' && index > -1) { event.preventDefault(); items[index].click(); }
        return;
      default:
        if (event.key.length === 1 && /\S/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const letter = event.key.toLowerCase();
          const order = [...items.slice(index + 1), ...items.slice(0, index + 1)];
          const match = order.find(item => item.textContent.trim().toLowerCase().startsWith(letter));
          if (match) { event.preventDefault(); match.focus({ preventScroll: true }); }
        }
    }
  }

  function setupInteractions() {
    document.addEventListener('click', event => {
      const navTrigger = event.target.closest('.nav-trigger');
      if (navTrigger && navTrigger.closest('.navbar')) {
        const menu = navTrigger.closest('.nav-dropdown');
        if (menu) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const willOpen = !menu.classList.contains('is-open');
          closeMenus(menu);
          closeProfile();
          menu.classList.toggle('is-open', willOpen);
          navTrigger.setAttribute('aria-expanded', String(willOpen));
        }
        return;
      }

      const profileTrigger = event.target.closest('.profile-trigger');
      if (profileTrigger && profileTrigger.closest('.navbar, .es-sidebar')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const menu = profileTrigger.closest('.profile-menu');
        const willOpen = !menu.classList.contains('is-open');
        closeProfile(menu);
        closeMenus();
        // Focus moves into the menu so the arrow keys work straight away;
        // after a mouse click the browser shows no focus ring.
        setProfileOpen(menu, willOpen, { focusFirst: willOpen });
        return;
      }

      const themeChoice = event.target.closest('[data-profile-theme-choice]');
      if (themeChoice) {
        event.preventDefault();
        applyThemeChoice(themeChoice.dataset.profileThemeChoice);
        return;
      }

      const action = event.target.closest('.profile-menu [data-profile-action]');
      if (action && runAction(action)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (!event.target.closest('.nav-dropdown')) closeMenus();
      if (!event.target.closest('.profile-menu')) closeProfile();
    }, true);

    document.addEventListener('keydown', event => {
      const trigger = event.target.closest?.('.profile-trigger');
      if (trigger && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        closeMenus();
        setProfileOpen(trigger.closest('.profile-menu'), true, event.key === 'ArrowUp' ? { focusLast: true } : { focusFirst: true });
        return;
      }
      const openMenu = document.querySelector('.profile-menu.is-open');
      if (openMenu && event.key !== 'Escape' && openMenu.querySelector(':scope > .profile-dropdown')?.contains(event.target)) {
        onMenuKeydown(event, openMenu);
        return;
      }
      if (event.key !== 'Escape') return;
      closeMenus();
      if (openMenu) {
        event.preventDefault();
        event.stopPropagation();
        setProfileOpen(openMenu, false, { returnFocus: true });
      }
    });

    // Hovering an item moves the highlight there, so mouse and keyboard
    // never show two highlighted rows.
    document.addEventListener('pointermove', event => {
      const item = event.target.closest?.(`.profile-menu.is-open > .profile-dropdown :is(${ITEM_SELECTOR})`);
      if (item && document.activeElement !== item && event.pointerType === 'mouse') item.focus({ preventScroll: true });
    }, { passive: true });

    document.addEventListener('focusin', event => {
      const openMenu = document.querySelector('.profile-menu.is-open');
      if (openMenu && !openMenu.contains(event.target)) setProfileOpen(openMenu, false);
    });

    window.addEventListener('frameup-theme-change', syncThemeControls);
    window.addEventListener('frameup-profile-change', event => refreshProfileMenu(event.detail?.profile));
    window.addEventListener('storage', event => {
      if (event.key === PROFILE_STORAGE_KEY || event.key === PROFILE_EDITS_KEY) refreshProfileMenu();
      if (event.key === THEME_STORAGE_KEY) syncThemeControls();
    });
  }

  function footerMarkup() {
    const social = name => asset(`social-icons/footer-${name}.svg`);
    return `
      <div class="footer-hero">
        <a class="footer-logo-link" href="https://www.essentiallysports.com/"><img class="footer-logo-img" src="${asset('brand-logo-white.svg')}" alt="EssentiallySports" loading="lazy" decoding="async"></a>
        <p class="footer-blurb">EssentiallySports is the home for the underserved fan, delivering storytelling that goes beyond the headlines. As a media platform, we combine deep audience insights with cultural trends, to meet fandom where it lives and where it goes next. Founded in 2014, EssentiallySports now engages with an audience of over 30m+ American sports fan on its website and 1m+ readers on its newsletters daily.</p>
        <div class="footer-socials" aria-label="Social links">
          <a href="https://www.facebook.com/essentiallysports" aria-label="Facebook"><img src="${social('facebook')}" alt="" loading="lazy" decoding="async"></a>
          <a href="https://twitter.com/es_sportsnews" aria-label="X"><img src="${social('x')}" alt="" loading="lazy" decoding="async"></a>
          <a href="https://www.linkedin.com/company/essentiallysports" aria-label="LinkedIn"><img src="${social('linkedin')}" alt="" loading="lazy" decoding="async"></a>
          <a href="https://www.instagram.com/essentiallysports" aria-label="Instagram"><img src="${social('instagram')}" alt="" loading="lazy" decoding="async"></a>
          <a href="https://www.youtube.com/essentiallysports" aria-label="YouTube"><img src="${social('youtube')}" alt="" loading="lazy" decoding="async"></a>
          <a href="https://news.google.com/publications/CAAqBwgKMJqW_gwwkoGBAw" aria-label="Google News"><img src="${social('google-news')}" alt="" loading="lazy" decoding="async"></a>
        </div>
        <div class="footer-copy">EssentiallySports Media, Inc. © 2026 | All Rights Reserved</div>
      </div>
      <div class="footer-links">
        <div class="footer-col">
          <span>EssentiallySports</span>
          <a href="https://www.essentiallysports.com/about-us/">About Us</a>
          <a href="https://www.essentiallysports.com/advertise-with-us/">Advertise With Us</a>
          <a href="https://www.essentiallysports.com/authors/">Authors</a>
          <a href="https://www.essentiallysports.com/editorial-team/">Editorial Team</a>
          <a href="https://www.essentiallysports.com/editorial-policies/">Behind The Scenes</a>
          <a href="https://www.essentiallysports.com/contact-us/">Contact Us</a>
          <a href="https://www.essentiallysports.com/press/">Press</a>
          <a href="${asset('index.html#faq')}">FAQ</a>
        </div>
        <div class="footer-col">
          <span>Newsletters</span>
          <a href="https://essentiallysports.beehiiv.com/">Lucky Dog on Track</a>
          <a href="https://essentiallygolf.beehiiv.com/">Essentially Golf</a>
          <a href="https://shegotgame.beehiiv.com/">Essentially W</a>
          <a href="https://essentially-basketball.beehiiv.com/">Essentially Dunk</a>
          <a href="https://essentiallyathletics.beehiiv.com/">Essentially Athletics</a>
          <a href="https://the-nfl-huddle.beehiiv.com/">The Huddle</a>
          <a href="https://chiefs-huddle.beehiiv.com/">Chiefs Huddle</a>
          <a href="https://cowboys-huddle.beehiiv.com/">Cowboys Huddle</a>
          <a href="https://steelers-huddle.beehiiv.com/">Steelers Huddle</a>
          <a href="https://es-college-football.beehiiv.com/">Essentially CFB</a>
          <a href="https://buckeye-daily.beehiiv.com/">Buckeye Daily</a>
          <a href="https://www.essentiallysports.com/think-tank/">ES Think Tank</a>
        </div>
        <div class="footer-col">
          <span>Podcasts</span>
          <a href="https://www.essentiallysports.com/think-tank/">ES Think Tank</a>
          <a href="https://www.essentiallysports.com/es-fancast/">ES Fancast</a>
          <br>
          <span>Events</span>
          <a href="https://www.essentiallysports.com/wnba-all-star-2025/">WNBA All-Star 2025</a>
          <a href="https://www.essentiallysports.com/us-open-2025/">US Open 2025</a>
          <a href="https://www.essentiallysports.com/archive/">Archive</a>
        </div>
        <div class="footer-col sports">
          <span>Sports</span><span></span>
          <a href="https://www.essentiallysports.com/category/all/">All</a><a href="https://www.essentiallysports.com/category/college-football/">College Football</a>
          <a href="https://www.essentiallysports.com/category/boxing/">Boxing</a><a href="https://www.essentiallysports.com/category/track-and-field/">Track And Field</a>
          <a href="https://www.essentiallysports.com/category/golf/">Golf</a><a href="https://www.essentiallysports.com/category/gymnastics/">Gymnastics</a>
          <a href="https://www.essentiallysports.com/category/nascar/">NASCAR</a><a href="https://www.essentiallysports.com/category/olympics/">Olympics</a>
          <a href="https://www.essentiallysports.com/category/nba/">NBA</a><a href="https://www.essentiallysports.com/category/mlb/">MLB</a>
          <a href="https://www.essentiallysports.com/category/nfl/">NFL</a><a href="https://www.essentiallysports.com/category/soccer/">Soccer</a>
          <a href="https://www.essentiallysports.com/category/tennis/">Tennis</a><a href="https://www.essentiallysports.com/category/swimming/">Swimming</a>
          <a href="https://www.essentiallysports.com/category/ufc/">UFC</a><a href="https://www.essentiallysports.com/category/nhl/">NHL</a>
          <a href="https://www.essentiallysports.com/category/wnba/">WNBA</a><span></span>
        </div>
      </div>
      <div class="footer-bottom">
        <a href="https://www.essentiallysports.com/privacy-policy/">Privacy Policy</a>
        <a href="https://www.essentiallysports.com/press/">ES Pressroom</a>
        <a href="https://www.essentiallysports.com/ethics-policy/">Ethics Policy</a>
        <a href="https://www.essentiallysports.com/fact-checking-policy/">Fact-Checking Policy</a>
        <a href="https://www.essentiallysports.com/corrections-policy/">Corrections Policy</a>
        <a href="https://www.essentiallysports.com/cookies-policy/">Cookies Policy</a>
        <a href="https://www.essentiallysports.com/gdpr-compliance/">GDPR Compliance</a>
        <a href="https://www.essentiallysports.com/terms-of-use/">Terms of Use</a>
        <a href="https://www.essentiallysports.com/editorial-policies/">Editorial Guidelines</a>
        <a href="https://www.essentiallysports.com/ownership-and-funding-information/">Ownership and funding Information</a>
      </div>`;
  }

  function normalizeFooter() {
    document.querySelectorAll('.site-footer').forEach(footer => {
      footer.innerHTML = footerMarkup();
      footer.dataset.sharedChrome = 'true';
    });
  }

  function normalizeNavbar() {
    document.querySelectorAll('.navbar').forEach(navbar => {
      navbar.dataset.sharedChrome = 'true';
      navbar.setAttribute('aria-label', navbar.getAttribute('aria-label') || 'Global navigation');

      const navbarRight = navbar.querySelector('.navbar-right');
      const profileMenu = navbarRight?.querySelector('.profile-menu');
      if (navbarRight && profileMenu && navbarRight.firstElementChild !== profileMenu) {
        navbarRight.prepend(profileMenu);
      }
    });
  }

  function boot() {
    normalizeNavbar();
    normalizeProfileMenus();
    normalizeFooter();
    setupInteractions();
  }

  window.FrameUpProfileMenu = {
    refresh: refreshProfileMenu,
    close: () => closeProfile(),
    // registerUnsaved(fn): fn() returns a message (or true) while the page
    // has changes that logging out would lose. Returns an unregister function.
    registerUnsaved: check => {
      if (typeof check !== 'function') return () => {};
      unsavedChecks.add(check);
      return () => unsavedChecks.delete(check);
    },
    unsavedWorkMessage,
    avatarColor,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
