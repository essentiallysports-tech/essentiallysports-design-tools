function closeProfileMenu() {
  const profileMenu = document.getElementById('profile-menu');
  const profileTrigger = document.getElementById('profile-trigger');
  profileMenu?.classList.remove('is-open');
  profileTrigger?.setAttribute('aria-expanded', 'false');
}

function closeNavMenus(exceptMenu = null) {
  document.querySelectorAll('.nav-dropdown').forEach(menu => {
    if (menu === exceptMenu) return;
    menu.classList.remove('is-open');
    menu.querySelector('.nav-trigger')?.setAttribute('aria-expanded', 'false');
  });
}

function setupHeaderMenus() {
  const profileMenu = document.getElementById('profile-menu');
  const profileTrigger = document.getElementById('profile-trigger');

  profileTrigger?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    closeNavMenus();
    const isOpen = profileMenu.classList.toggle('is-open');
    profileTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  document.querySelectorAll('.nav-dropdown').forEach(menu => {
    const trigger = menu.querySelector('.nav-trigger');
    if (!trigger) return;

    menu.addEventListener('mouseenter', () => {
      if (window.matchMedia('(max-width: 820px)').matches) return;
      closeProfileMenu();
      closeNavMenus(menu);
      menu.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
    });

    trigger.addEventListener('click', event => {
      if (!window.matchMedia('(max-width: 820px)').matches) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeProfileMenu();
      const isOpen = menu.classList.contains('is-open');
      closeNavMenus();
      menu.classList.toggle('is-open', !isOpen);
      trigger.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    });
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.nav-dropdown')) closeNavMenus();
    if (!event.target.closest('.profile-menu')) closeProfileMenu();
  });
}

function setupPageTransitions() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const showPageBody = () => {
    document.body.classList.remove('is-page-leaving');
    document.body.classList.add('is-page-ready');
  };

  requestAnimationFrame(showPageBody);
  window.addEventListener('pageshow', showPageBody);

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== '_self') return;
    if (link.hasAttribute('download')) return;

    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || /^(?:mailto:|tel:|javascript:)/i.test(href)) return;

    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;

    event.preventDefault();
    if (prefersReducedMotion) {
      window.location.href = url.href;
      return;
    }

    document.body.classList.remove('is-page-ready');
    document.body.classList.add('is-page-leaving');
    setTimeout(() => {
      window.location.href = url.href;
    }, 220);
  });
}

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem('es.ai.profile') || '{}');
  } catch (error) {
    return {};
  }
}

function saveProfile(profile) {
  localStorage.setItem('es.ai.profile', JSON.stringify(sanitizeProfile(profile)));
}

function cleanVisitorName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanProfileValue(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isDefaultProfileAvatar(value) {
  return /(?:^|\/)profile-avatar-default\.webp(?:$|\?)/.test(String(value || ''));
}

function hasCustomProfileAvatar(value) {
  const avatar = cleanProfileValue(value);
  return Boolean(avatar) && !isDefaultProfileAvatar(avatar);
}

function initialsFromName(name) {
  const cleaned = cleanProfileValue(name);
  if (!cleaned || cleaned === 'Guest User') return 'ES';
  return cleaned
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

function sanitizeProfile(profile = {}) {
  const sanitized = {};
  ['name', 'email', 'role', 'team', 'bio'].forEach(key => {
    const value = key === 'bio' ? String(profile[key] || '').trim() : cleanProfileValue(profile[key]);
    if (value) sanitized[key] = value;
  });
  if (hasCustomProfileAvatar(profile.avatar)) {
    sanitized.avatar = String(profile.avatar).trim();
  }
  return sanitized;
}

function nameFromEmail(email) {
  const localPart = String(email || '').split('@')[0];
  if (!localPart) return '';
  return localPart.replace(/[._-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()).trim();
}

function isDemoProfileName(name) {
  return /^suhail(?:\s+quraishi)?$/i.test(cleanVisitorName(name));
}

function getNetlifyIdentityUser() {
  try {
    return window.netlifyIdentity?.currentUser?.() || null;
  } catch (error) {
    return null;
  }
}

function inferVisitorProfile() {
  const stored = loadProfile();
  const params = new URLSearchParams(window.location.search);
  const queryName = cleanVisitorName(params.get('name') || params.get('full_name') || params.get('fullName') || params.get('user'));
  const queryEmail = cleanVisitorName(params.get('email'));
  const identityUser = getNetlifyIdentityUser();
  const metadata = identityUser?.user_metadata || identityUser?.app_metadata || {};
  const identityName = cleanVisitorName(metadata.full_name || metadata.fullName || metadata.name || identityUser?.user_metadata?.name);
  const identityEmail = cleanVisitorName(identityUser?.email);
  const storedName = cleanVisitorName(stored.name);
  const storedEmail = cleanVisitorName(stored.email);
  const name = queryName ||
    identityName ||
    (storedName && !isDemoProfileName(storedName) ? storedName : '') ||
    nameFromEmail(queryEmail || identityEmail || storedEmail) ||
    'Guest User';
  if ((queryName || identityName || queryEmail || identityEmail) && name !== stored.name) {
    try {
      saveProfile({ ...stored, name, email: queryEmail || identityEmail || storedEmail });
    } catch (error) {}
  }
  return { ...stored, name };
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('es.ai.settings') || '{}');
  } catch (error) {
    return {};
  }
}

function saveSettings(settings) {
  localStorage.setItem('es.ai.settings', JSON.stringify(settings));
}

function syncProfileChrome() {
  const profile = inferVisitorProfile();
  const name = profile.name;
  const role = cleanProfileValue(profile.role);
  const avatar = profile.avatar;
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('[data-profile-name]').forEach(el => {
    el.textContent = name;
    if (role) {
      el.dataset.profileRole = role;
      el.classList.add('has-role');
    } else {
      delete el.dataset.profileRole;
      el.classList.remove('has-role');
    }
  });
  document.querySelectorAll('[data-profile-initial]').forEach(el => {
    if (hasCustomProfileAvatar(avatar)) {
      el.textContent = '';
      el.classList.add('has-image');
      el.style.backgroundImage = `url("${avatar}")`;
    } else {
      el.classList.remove('has-image');
      el.style.removeProperty('background-image');
      el.textContent = '';
    }
  });
  document.querySelectorAll('.profile-option').forEach(link => {
    const targetPage = (link.getAttribute('href') || '').split('/').pop();
    if (targetPage && targetPage === currentPage && currentPage !== 'index.html') {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function renderSharedFooter() {
  const footer = document.querySelector('.site-footer');
  if (!footer) return;
  footer.innerHTML = `
    <div class="footer-hero">
      <a class="footer-logo-link" href="https://www.essentiallysports.com/"><img class="footer-logo-img" src="assets/brand-logo-white.svg" alt="EssentiallySports" loading="lazy" decoding="async"></a>
      <p class="footer-blurb">EssentiallySports is the home for the underserved fan, delivering storytelling that goes beyond the headlines. As a media platform, we combine deep audience insights with cultural trends, to meet fandom where it lives and where it goes next. Founded in 2014, EssentiallySports now engages with an audience of over 30m+ American sports fan on its website and 1m+ readers on its newsletters daily.</p>
      <div class="footer-socials" aria-label="Social links">
        <a href="https://www.facebook.com/essentiallysports" aria-label="Facebook"><img src="../social-icons/footer-facebook.svg" alt="" loading="lazy" decoding="async"></a>
        <a href="https://twitter.com/es_sportsnews" aria-label="X"><img src="../social-icons/footer-x.svg" alt="" loading="lazy" decoding="async"></a>
        <a href="https://www.linkedin.com/company/essentiallysports" aria-label="LinkedIn"><img src="../social-icons/footer-linkedin.svg" alt="" loading="lazy" decoding="async"></a>
        <a href="https://www.instagram.com/essentiallysports" aria-label="Instagram"><img src="../social-icons/footer-instagram.svg" alt="" loading="lazy" decoding="async"></a>
        <a href="https://www.youtube.com/essentiallysports" aria-label="YouTube"><img src="../social-icons/footer-youtube.svg" alt="" loading="lazy" decoding="async"></a>
        <a href="https://news.google.com/publications/CAAqBwgKMJqW_gwwkoGBAw" aria-label="Google News"><img src="../social-icons/footer-google-news.svg" alt="" loading="lazy" decoding="async"></a>
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
        <a href="../index.html#faq">FAQ</a>
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

renderSharedFooter();
setupPageTransitions();
setupHeaderMenus();
syncProfileChrome();
