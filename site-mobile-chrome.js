/*
 * Shared mobile navigation controller.
 *
 * Every page already owns the same desktop navbar markup. This small adapter
 * gives that markup one mobile behavior: compact logo + menu button, an
 * accessible navigation panel, and the existing profile actions inside the
 * panel. It deliberately does not touch workspace controls or page content.
 */
(() => {
  'use strict';

  const MENU_ID_PREFIX = 'site-mobile-menu';

  function createMenuId(index) {
    return `${MENU_ID_PREFIX}-${index + 1}`;
  }

  function copyProfileActions(navbar, menu) {
    if (menu.querySelector('.mobile-menu-account')) return;
    const profileDropdown = navbar.querySelector('.profile-dropdown');
    if (!profileDropdown) return;

    const actions = Array.from(profileDropdown.querySelectorAll('a, button'))
      .filter(action => !action.disabled && action.getAttribute('aria-hidden') !== 'true');
    if (!actions.length) return;

    const account = document.createElement('div');
    account.className = 'mobile-menu-account';
    account.setAttribute('role', 'group');

    const label = document.createElement('span');
    label.className = 'mobile-menu-account-label';
    label.textContent = 'Account';
    account.append(label);

    const actionList = document.createElement('div');
    actionList.className = 'mobile-menu-account-actions';
    actions.forEach(action => {
      const clone = action.cloneNode(true);
      clone.removeAttribute('id');
      clone.classList.add('mobile-menu-account-action');
      actionList.append(clone);
    });
    account.append(actionList);
    menu.append(account);
  }

  function initNavbar(navbar, index) {
    if (navbar.dataset.mobileChromeReady === 'true') return;
    const menu = navbar.querySelector('.navbar-menu');
    if (!menu) return;

    navbar.dataset.mobileChromeReady = 'true';
    if (!menu.id) menu.id = createMenuId(index);
    menu.setAttribute('aria-label', 'Site navigation');
    copyProfileActions(navbar, menu);

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
