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

  function closeProfile(except = null) {
    document.querySelectorAll('.profile-menu.is-open').forEach(menu => {
      if (menu === except) return;
      menu.classList.remove('is-open');
      menu.querySelector(':scope > .profile-trigger')?.setAttribute('aria-expanded', 'false');
    });
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
        menu.classList.toggle('is-open', willOpen);
        profileTrigger.setAttribute('aria-expanded', String(willOpen));
        return;
      }

      if (!event.target.closest('.nav-dropdown')) closeMenus();
      if (!event.target.closest('.profile-menu')) closeProfile();
    }, true);

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      closeMenus();
      closeProfile();
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
    normalizeFooter();
    setupInteractions();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
