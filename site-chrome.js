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

  function readStoredProfile() {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function hasCustomAvatar(value) {
    const avatar = cleanProfileValue(value);
    return Boolean(avatar) && !/(?:^|\/)profile-avatar-default\.webp(?:$|\?)/.test(avatar);
  }

  function accountBase(menu) {
    if (menu?.dataset.accountBase) return menu.dataset.accountBase;
    return window.location.pathname.includes('/ai-page/') ? '' : 'ai-page/';
  }

  function profileIcon(kind) {
    const icons = {
      profile: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" stroke-width="1.8"/><path d="M4 20a8 8 0 0 1 16 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      settings: '<path d="M12 15.25A3.25 3.25 0 1 0 12 8.75a3.25 3.25 0 0 0 0 6.5Z" stroke="currentColor" stroke-width="1.7"/><path d="M19.2 14.8a1.55 1.55 0 0 0 .31 1.7l.05.05a1.9 1.9 0 1 1-2.69 2.69l-.05-.05a1.55 1.55 0 0 0-1.7-.31 1.55 1.55 0 0 0-.94 1.42v.08a1.9 1.9 0 1 1-3.8 0v-.08a1.55 1.55 0 0 0-.94-1.42 1.55 1.55 0 0 0-1.7.31l-.05.05A1.9 1.9 0 1 1 5 16.55l.05-.05a1.55 1.55 0 0 0 .31-1.7 1.55 1.55 0 0 0-1.42-.94h-.08a1.9 1.9 0 1 1 0-3.8h.08a1.55 1.55 0 0 0 1.42-.94 1.55 1.55 0 0 0-.31-1.7L5 7.37a1.9 1.9 0 1 1 2.69-2.69l.05.05a1.55 1.55 0 0 0 1.7.31 1.55 1.55 0 0 0 .94-1.42v-.08a1.9 1.9 0 1 1 3.8 0v.08a1.55 1.55 0 0 0 .94 1.42 1.55 1.55 0 0 0 1.7-.31l.05-.05a1.9 1.9 0 1 1 2.69 2.69l-.05.05a1.55 1.55 0 0 0-.31 1.7c.12.31.18.63.18.94h.08a1.9 1.9 0 1 1 0 3.8h-.08c0 .31-.06.63-.18.94Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>',
      logout: '<path d="M10 6H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m14 8 4 4-4 4M18 12H9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    };
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">${icons[kind]}</svg>`;
  }

  function profileMarkup(menu, index) {
    const base = accountBase(menu);
    const popoverId = index ? `frameup-account-popover-${index + 1}` : 'frameup-account-popover';
    return `
      <button class="profile-trigger" type="button" id="profile-trigger" aria-expanded="false" aria-controls="${popoverId}" aria-label="Open account options">
        <span class="profile-avatar" data-profile-initial aria-hidden="true"></span>
        <span class="profile-name" data-profile-name>Guest User</span>
        <svg class="profile-chevron" viewBox="0 0 16 10" fill="none" aria-hidden="true"><path d="M14.98 1.14 7.98 7.14.98 1.14" stroke="currentColor" stroke-width="3"/></svg>
      </button>
      <section class="profile-dropdown" id="${popoverId}" aria-label="Account options" aria-hidden="true" inert>
        <header class="profile-identity">
          <span class="profile-identity-avatar" data-profile-popover-avatar aria-hidden="true"></span>
          <span class="profile-identity-copy">
            <strong data-profile-popover-name>Guest User</strong>
            <span data-profile-popover-role hidden></span>
          </span>
        </header>
        <nav class="profile-actions" aria-label="Account">
          <a class="profile-option" href="${base}profile.html" data-profile-destination="profile">${profileIcon('profile')}<span>Edit Profile</span></a>
          <a class="profile-option" href="${base}settings.html" data-profile-destination="settings">${profileIcon('settings')}<span>Settings</span></a>
        </nav>
        <div class="profile-appearance">
          <span class="profile-appearance-label">Appearance</span>
          <div class="profile-theme-segment" role="group" aria-label="Appearance">
            <button type="button" data-profile-theme-choice="light" aria-pressed="false">Light</button>
            <button type="button" data-profile-theme-choice="dark" aria-pressed="false">Dark</button>
          </div>
        </div>
        <a class="profile-option profile-option--logout" href="${base}logout.html" data-profile-destination="logout">${profileIcon('logout')}<span>Logout</span></a>
      </section>`;
  }

  function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function syncThemeControls() {
    const theme = currentTheme();
    document.querySelectorAll('[data-profile-theme-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.profileThemeChoice === theme));
    });
  }

  function refreshProfileMenu(profile = readStoredProfile()) {
    const email = cleanProfileValue(profile.email);
    const name = titleCaseName(profile.name || nameFromEmail(email));
    const role = cleanProfileValue(profile.role);
    const avatar = hasCustomAvatar(profile.avatar) ? cleanProfileValue(profile.avatar) : '';

    document.querySelectorAll('.profile-menu [data-profile-name], .profile-menu [data-profile-popover-name]').forEach(element => {
      element.textContent = name;
    });
    document.querySelectorAll('.profile-menu [data-profile-popover-role]').forEach(element => {
      element.textContent = role;
      element.hidden = !role;
    });
    document.querySelectorAll('.profile-menu [data-profile-initial], .profile-menu [data-profile-popover-avatar]').forEach(element => {
      element.classList.toggle('has-image', Boolean(avatar));
      if (avatar) element.style.backgroundImage = `url("${avatar.replace(/"/g, '%22')}")`;
      else element.style.removeProperty('background-image');
    });
  }

  function setProfileOpen(menu, open, options = {}) {
    if (!menu) return;
    const trigger = menu.querySelector(':scope > .profile-trigger');
    const popover = menu.querySelector(':scope > .profile-dropdown');
    menu.classList.toggle('is-open', open);
    trigger?.setAttribute('aria-expanded', String(open));
    popover?.setAttribute('aria-hidden', String(!open));
    if (popover) popover.inert = !open;
    if (open && options.focusFirst) {
      popover?.querySelector('.profile-option, [data-profile-theme-choice]')?.focus({ preventScroll: true });
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
      menu.innerHTML = profileMarkup(menu, index);
      const currentPage = (window.location.pathname.split('/').pop() || 'index.html').replace('.html', '');
      menu.querySelectorAll('[data-profile-destination]').forEach(link => {
        if (link.dataset.profileDestination === currentPage) link.setAttribute('aria-current', 'page');
      });
    });
    refreshProfileMenu();
    syncThemeControls();
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
      if (profileTrigger && profileTrigger.closest('.navbar')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const menu = profileTrigger.closest('.profile-menu');
        const willOpen = !menu.classList.contains('is-open');
        closeProfile(menu);
        closeMenus();
        setProfileOpen(menu, willOpen);
        return;
      }

      const themeChoice = event.target.closest('[data-profile-theme-choice]');
      if (themeChoice) {
        event.preventDefault();
        const theme = themeChoice.dataset.profileThemeChoice === 'dark' ? 'dark' : 'light';
        if (window.FrameUpTheme?.apply) window.FrameUpTheme.apply(theme);
        else {
          document.documentElement.dataset.theme = theme;
          document.documentElement.style.colorScheme = theme;
          try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {}
          window.dispatchEvent(new CustomEvent('frameup-theme-change', { detail: { theme } }));
        }
        syncThemeControls();
        return;
      }

      if (!event.target.closest('.nav-dropdown')) closeMenus();
      if (!event.target.closest('.profile-menu')) closeProfile();
    }, true);

    document.addEventListener('keydown', event => {
      const trigger = event.target.closest?.('.profile-trigger');
      if (trigger && event.key === 'ArrowDown') {
        event.preventDefault();
        closeMenus();
        setProfileOpen(trigger.closest('.profile-menu'), true, { focusFirst: true });
        return;
      }
      if (event.key !== 'Escape') return;
      closeMenus();
      const openMenu = document.querySelector('.profile-menu.is-open');
      if (openMenu) {
        event.preventDefault();
        setProfileOpen(openMenu, false, { returnFocus: true });
      }
    });

    document.addEventListener('focusin', event => {
      const openMenu = document.querySelector('.profile-menu.is-open');
      if (openMenu && !openMenu.contains(event.target)) setProfileOpen(openMenu, false);
    });

    window.addEventListener('frameup-theme-change', syncThemeControls);
    window.addEventListener('frameup-profile-change', event => refreshProfileMenu(event.detail?.profile));
    window.addEventListener('storage', event => {
      if (event.key === PROFILE_STORAGE_KEY) refreshProfileMenu();
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
          <a href="https://shegotgame.beehiiv.com/">She Got Game</a>
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
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
