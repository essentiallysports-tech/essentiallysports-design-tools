/*
 * Shared mobile navigation controller.
 *
 * Every page already owns the same desktop navbar markup. This small adapter
 * gives that markup one mobile behavior: compact logo + menu button, an
 * accessible navigation panel, and the same shared account popover moved into
 * that panel. It deliberately does not touch workspace controls or page content.
 */
(() => {
  'use strict';

  const MENU_ID_PREFIX = 'site-mobile-menu';

  function createMenuId(index) {
    return `${MENU_ID_PREFIX}-${index + 1}`;
  }

  function setupProfilePlacement(navbar, menu) {
    const navbarRight = navbar.querySelector('.navbar-right');
    const profileMenu = navbarRight?.querySelector('.profile-menu') || menu.querySelector('.profile-menu');
    if (!navbarRight || !profileMenu) return () => {};

    let account = menu.querySelector('.mobile-menu-account');
    if (!account) {
      account = document.createElement('div');
      account.className = 'mobile-menu-account';
      account.setAttribute('role', 'group');
      account.setAttribute('aria-label', 'Account');
      menu.append(account);
    }

    const place = () => {
      const isMobile = window.matchMedia('(max-width: 900px)').matches;
      const destination = isMobile ? account : navbarRight;
      if (profileMenu.parentElement !== destination) destination.prepend(profileMenu);
      if (!isMobile) window.FrameUpProfileMenu?.close?.();
    };

    place();
    return place;
  }

  function initNavbar(navbar, index) {
    if (navbar.dataset.mobileChromeReady === 'true') return;
    const menu = navbar.querySelector('.navbar-menu');
    if (!menu) return;

    navbar.dataset.mobileChromeReady = 'true';
    if (!menu.id) menu.id = createMenuId(index);
    menu.setAttribute('aria-label', 'Site navigation');
    const placeProfile = setupProfilePlacement(navbar, menu);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mobile-menu-toggle';
    toggle.setAttribute('aria-controls', menu.id);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation menu');
    toggle.innerHTML = '<span></span><span></span><span></span>';
    navbar.append(toggle);

    const close = () => {
      navbar.classList.remove('is-mobile-menu-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open navigation menu');
    };

    toggle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = navbar.classList.toggle('is-mobile-menu-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
    });

    menu.addEventListener('click', event => {
      const link = event.target.closest('a');
      const isDropdownTrigger = link
        && link.classList.contains('nav-trigger')
        && link.closest('.nav-dropdown')
        && !link.closest('.nav-dropdown-menu');
      if (link && link.getAttribute('href') && !isDropdownTrigger) close();
    });

    document.addEventListener('click', event => {
      if (!navbar.contains(event.target)) close();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') close();
    });

    window.addEventListener('resize', () => {
      placeProfile();
      if (window.matchMedia('(min-width: 901px)').matches) close();
    }, { passive: true });
  }

  function init() {
    document.querySelectorAll('.navbar').forEach(initNavbar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
