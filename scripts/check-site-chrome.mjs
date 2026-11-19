#!/usr/bin/env node

import fs from 'node:fs';

// The standalone How It Works page (how-it-works.html) was folded into the
// homepage and retired in d01fc8e; its successor is how-frameup-works.html.
const navbarPages = [
  'index.html',
  'design-request.html',
  'how-frameup-works.html',
  'dashboard.html',
  'ai-page/index.html',
  'ai-page/profile.html',
  'ai-page/settings.html',
  'ai-page/logout.html',
];

const footerPages = [
  'index.html',
  'design-request.html',
  'ai-page/index.html',
  'ai-page/profile.html',
  'ai-page/settings.html',
  'ai-page/logout.html',
];

// login.html dropped the footer on purpose ("lighter login page", e7def29).
const noFooterPages = ['dashboard.html', 'reset-password.html', 'login.html'];
// Cache keys change with every release, so the guard checks that every page
// loads the SAME key for each shared chrome file (a stale copy on one page
// is the bug), not one fixed key.
const sharedChromeFiles = ['site-chrome.css', 'site-chrome.js', 'site-mobile-chrome.css', 'site-mobile-chrome.js'];
const chromeKeys = new Map(sharedChromeFiles.map(name => [name, new Map()]));
const socialLabels = ['Facebook', 'X', 'LinkedIn', 'Instagram', 'YouTube', 'Google News'];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`✅ ${message}`);
}

function assert(condition, failure, success = failure) {
  if (!condition) fail(failure);
  else pass(success);
}

for (const file of navbarPages) {
  const html = read(file);
  const prefix = file.startsWith('ai-page/') ? '../' : '';
  for (const name of sharedChromeFiles) {
    const match = html.match(new RegExp(`${prefix.replace(/\./g, '\\.')}${name.replace('.', '\\.')}\\?v=([^"']+)`));
    assert(Boolean(match), `${file} is missing the shared ${name}`, `${file} loads the shared ${name}`);
    if (match) chromeKeys.get(name).set(file, match[1]);
  }
  assert(html.includes('class="navbar"'), `${file} has no global navbar`, `${file} has the global navbar`);
  assert(html.includes('class="navbar-logo"'), `${file} has no navbar logo`, `${file} has a navbar logo`);
  assert(html.includes('class="navbar-menu"'), `${file} has no navbar menu`, `${file} has a navbar menu`);
  assert(html.includes('class="navbar-right"'), `${file} has no navbar utilities`, `${file} has navbar utilities`);
  assert(
    html.includes('>Resources</a>') && html.includes('aria-label="Resources"'),
    `${file} is missing the unified Resources dropdown`,
    `${file} includes the unified Resources dropdown`,
  );
  // The retired standalone page must not be linked anywhere (a dead link).
  assert(
    !/href="(?:\.\.\/)?how-it-works\.html/.test(html),
    `${file} still links the retired how-it-works.html page`,
    `${file} does not link the retired How It Works page`,
  );
  // Dashboard is for admins: any link to it starts hidden and admin-only.
  const dashboardLinks = html.match(/<a[^>]*href="(?:\.\.\/)?dashboard\.html"[^>]*>/g) || [];
  assert(
    file === 'dashboard.html' || dashboardLinks.every(tag => tag.includes('data-admin-only') && /\shidden[\s>]/.test(tag)),
    `${file} exposes a Dashboard link to everyone`,
    `${file} keeps any Dashboard link admin-only and hidden`,
  );
  assert(
    !/<a[^>]*class="[^"]*\bnav-trigger\b[^"]*"[^>]*>\s*Brand Guidelines\s*<\/a>/.test(html),
    `${file} still has Brand Guidelines as an independent navigation trigger`,
    `${file} keeps brand guidance inside Resources`,
  );
  const profileMounts = (html.match(/<div class="profile-menu" id="profile-menu"><\/div>/g) || []).length;
  assert(profileMounts === 1, `${file} does not have exactly one lightweight profile mount`, `${file} has one lightweight profile mount`);
  assert(
    !html.includes('class="profile-trigger"') && !html.includes('class="profile-dropdown"'),
    `${file} still owns duplicated profile popover markup`,
    `${file} delegates profile markup to shared chrome`,
  );
  assert(
    !/profileMenu\??\.addEventListener\s*\(\s*['"]click['"]/.test(html)
      && !/profileTrigger\??\.addEventListener\s*\(\s*['"]click['"]/.test(html),
    `${file} still binds a page-local profile toggle`,
    `${file} has no page-local profile toggle`,
  );

  // The navbar's social set, when a page has one, is the complete six.
  const navbar = (html.match(/<nav class="navbar"[\s\S]*?<\/nav>/) || [''])[0];
  const navSocial = socialLabels.filter(label => new RegExp(`class="navbar-icon-btn"[^>]*aria-label="${label}"|aria-label="${label}"[^>]*class="navbar-icon-btn"`).test(navbar));
  const navSocialCount = (navbar.match(/class="navbar-icon-btn"/g) || []).length;
  assert(
    navSocialCount === 0 || (navSocialCount === 6 && navSocial.length === 6),
    `${file} has ${navSocialCount} navbar social icons instead of the six`,
    `${file} has the complete six-icon social set (or none)`,
  );
}

for (const [name, byPage] of chromeKeys) {
  const keys = new Set(byPage.values());
  assert(
    keys.size <= 1,
    `pages load different ${name} cache keys: ${[...byPage].map(([page, key]) => `${page}=${key}`).join(', ')}`,
    `every page loads the same ${name} cache key`,
  );
}

for (const file of footerPages) {
  const html = read(file);
  assert(html.includes('class="site-footer'), `${file} is missing the shared footer mount`, `${file} has the shared footer mount`);
}

for (const file of noFooterPages) {
  const html = read(file);
  assert(!html.includes('class="site-footer'), `${file} should not render the shared footer`, `${file} correctly omits the shared footer`);
}

const themeCss = read('theme.css');
assert(
  !/html\[data-theme\]\s+\.site-footer\s+:is\(/.test(themeCss),
  'Theme CSS globally forces light footer content to the dark footer color',
  'Footer text color overrides are scoped to dark mode',
);
assert(
  /html\[data-theme="dark"\]\s+\.site-footer\s+:is\(/.test(themeCss),
  'Theme CSS is missing the dark-mode footer readability rule',
  'Dark-mode footer readability rule remains available',
);

const index = read('index.html');
assert(
  !index.includes('aria-label="Brand guideline options"')
    && !index.includes('id="frame-creative-guidelines"')
    && !index.includes('id="frame-video-guidelines-card"')
    && !index.includes('id="frame-logo-guidelines-card"'),
  'Homepage still renders the removed guideline card section',
  'Homepage guideline card section remains removed',
);

// how-frameup-works.html (successor of the retired How It Works page).
const howItWorks = read('how-frameup-works.html');
assert(
  howItWorks.includes('requireAuth(`how-frameup-works.html'),
  'How FrameUp works is missing its auth guard',
  'How FrameUp works uses the auth guard',
);
assert(
  howItWorks.includes('class="profile-menu" id="profile-menu"'),
  'How FrameUp works is not using the shared profile mount',
  'How FrameUp works uses the shared profile mount',
);
assert(
  (howItWorks.match(/<a[^>]*href="dashboard\.html"[^>]*>/g) || []).every(tag => tag.includes('data-admin-only') && /\shidden[\s>]/.test(tag)),
  'How FrameUp works exposes a Dashboard destination to everyone',
  'How FrameUp works keeps Dashboard admin-only',
);
assert(
  /'section-header':\s*\{[\s\S]*?workspace:\s*\{\s*width:\s*640,\s*height:\s*47,/.test(index),
  'Header Option 1 dimensions changed from the established 640×47 contract',
  'Header Option 1 retains the established 640×47 dimensions',
);
assert(
  /'section-header-2':\s*\{[\s\S]*?workspace:\s*\{\s*width:\s*640,\s*height:\s*47,/.test(index),
  'Header Option 2 does not use the established 640×47 contract',
  'Header Option 2 uses the established 640×47 dimensions',
);

const eveningBrandMatch = index.match(/\{\s*id:\s*'es-daily-evening-send',[\s\S]*?\},/);
assert(Boolean(eveningBrandMatch), 'ES Daily Evening Send is missing', 'ES Daily Evening Send is available');
if (eveningBrandMatch) {
  assert(
    eveningBrandMatch[0].includes("background: '#404060'") && eveningBrandMatch[0].includes("foreground: '#FFF5EF'"),
    'ES Daily Evening Send does not use the approved JSON colors',
    'ES Daily Evening Send uses the approved JSON colors',
  );
  assert(
    !/\b(?:width|height|fontSize)\s*:/.test(eveningBrandMatch[0]),
    'ES Daily Evening Send incorrectly overrides Section Header sizing',
    'ES Daily Evening Send only supplies branding colors',
  );
}

const siteChromeCss = read('site-chrome.css');
assert(
  /\.navbar-menu\s*>\s*a\[aria-current="page"\]\s*\{[^}]*color:\s*var\(--es-ink\)\s*!important;/.test(siteChromeCss),
  'Current navbar item still uses the blue selected state',
  'Current navbar item uses the neutral ink state',
);
assert(
  siteChromeCss.includes("stroke='%230A7DFA'"),
  'Shared navbar chevron is not using ES blue',
  'Shared navbar chevron uses ES blue',
);
assert(
  siteChromeCss.includes('.profile-menu[data-profile-popover-version="2"]')
    && siteChromeCss.includes('max-width: calc(100vw - 24px)')
    && siteChromeCss.includes('prefers-reduced-motion: reduce'),
  'Shared profile popover CSS contract is incomplete',
  'Shared profile popover CSS includes responsive and reduced-motion guards',
);

const siteChromeJs = read('site-chrome.js');
assert(
  siteChromeJs.includes('FrameUpProfileMenu')
    && siteChromeJs.includes('frameup-profile-change')
    && siteChromeJs.includes(".profile-menu [data-profile-name]")
    && siteChromeJs.includes("event.key === 'ArrowDown'")
    && siteChromeJs.includes(".profile-option, [data-profile-theme-choice]")
    && siteChromeJs.includes("event.key !== 'Escape'")
    && siteChromeJs.includes('aria-controls'),
  'Shared profile behavior contract is incomplete',
  'Shared profile behavior includes refresh, profile events, and keyboard disclosure support',
);

const mobileChromeJs = read('site-mobile-chrome.js');
assert(
  mobileChromeJs.includes('setupProfilePlacement') && !mobileChromeJs.includes('cloneNode'),
  'Mobile chrome clones or duplicates the profile menu',
  'Mobile chrome moves the single shared profile menu without cloning it',
);

const accountJs = read('ai-page/account.js');
assert(
  accountJs.includes('FrameUpProfileMenu?.refresh') && accountJs.includes('frameup-profile-change'),
  'Profile saves do not refresh the shared account popover',
  'Profile saves refresh and broadcast to the shared account popover',
);

// The homepage workspace heading (.home-showcase-heading) that had to match
// the login typography left with the old homepage in d01fc8e; the home view
// is now frameup-home-today.*, which has its own tests (test-home-today).
const homeSource = read('index.html');
assert(
  !homeSource.includes('home-showcase-heading') || /\.home-showcase-heading h2\s*\{[\s\S]*?font-family:\s*'Acumin Pro Condensed Local'/.test(homeSource),
  'Homepage workspace heading does not match login typography',
  'Homepage workspace heading (if present) matches login typography',
);

if (process.exitCode) {
  console.error('\nShared chrome guard failed.');
  process.exit(process.exitCode);
}

console.log('\nShared chrome guard passed.');
