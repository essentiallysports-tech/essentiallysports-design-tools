#!/usr/bin/env node

import fs from 'node:fs';

const navbarPages = [
  'index.html',
  'design-request.html',
  'how-it-works.html',
  'dashboard.html',
  'ai-page/index.html',
  'ai-page/profile.html',
  'ai-page/settings.html',
  'ai-page/logout.html',
];

const footerPages = [
  'index.html',
  'design-request.html',
  'how-it-works.html',
  'login.html',
  'ai-page/index.html',
  'ai-page/profile.html',
  'ai-page/settings.html',
  'ai-page/logout.html',
];

const noFooterPages = ['dashboard.html', 'reset-password.html'];
const sharedChromeVersion = '20260723-profile2';
const sharedChromeCssVersion = '20260723-profile3';

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
  assert(
    new RegExp(`${prefix.replace('../', '\\\.\\\./')}site-chrome\\.css\\?v=[^\"']+`).test(html),
    `${file} is missing the shared site chrome stylesheet`,
    `${file} uses the shared site chrome stylesheet`,
  );
  assert(
    html.includes(`${prefix}site-chrome.js?v=${sharedChromeVersion}`),
    `${file} is missing the shared site chrome behavior`,
    `${file} uses the shared site chrome behavior`,
  );
  assert(
    html.includes(`${prefix}site-mobile-chrome.js?v=${sharedChromeVersion}`)
      && html.includes(`${prefix}site-mobile-chrome.css?v=${sharedChromeVersion}`)
      && html.includes(`${prefix}site-chrome.css?v=${sharedChromeCssVersion}`),
    `${file} has stale shared chrome assets`,
    `${file} uses the current shared chrome assets`,
  );
  assert(html.includes('class="navbar"'), `${file} has no global navbar`, `${file} has the global navbar`);
  assert(html.includes('class="navbar-logo"'), `${file} has no navbar logo`, `${file} has a navbar logo`);
  assert(html.includes('class="navbar-menu"'), `${file} has no navbar menu`, `${file} has a navbar menu`);
  assert(html.includes('class="navbar-right"'), `${file} has no navbar utilities`, `${file} has navbar utilities`);
  const howItWorksHref = file.startsWith('ai-page/') ? '../how-it-works.html' : 'how-it-works.html';
  assert(
    html.includes('>Resources</a>') && html.includes('aria-label="Resources"'),
    `${file} is missing the unified Resources dropdown`,
    `${file} includes the unified Resources dropdown`,
  );
  assert(
    new RegExp(`href="${howItWorksHref.replace('.', '\\.')}"[^>]*>How It Works</a>`).test(html),
    `${file} is missing the How It Works navigation item`,
    `${file} includes the How It Works navigation item`,
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

  const socialCount = (html.match(/class="navbar-icon-btn"/g) || []).length;
  assert(
    socialCount === 6,
    `${file} has ${socialCount} social icons instead of 6`,
    `${file} has the complete six-icon social set`,
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

const howItWorks = read('how-it-works.html');
for (const anchor of ['overview', 'create', 'workspaces', 'request', 'help']) {
  assert(
    howItWorks.includes(`id="${anchor}"`),
    `How It Works is missing the #${anchor} section anchor`,
    `How It Works includes the #${anchor} section anchor`,
  );
}
assert(
  howItWorks.includes('requireAuth(`how-it-works.html')
    && howItWorks.includes('workspace-card-social-media.webp')
    && howItWorks.includes('workspace-card-youtube-thumbnail.webp')
    && howItWorks.includes('workspace-card-newsletter-assets.webp'),
  'How It Works is missing its auth guard or real workspace imagery',
  'How It Works uses the auth guard and real workspace imagery',
);
assert(
  howItWorks.includes('data-workflow')
    && howItWorks.includes('data-journey')
    && howItWorks.includes('aria-current="step"')
    && howItWorks.includes('how-it-works.js'),
  'How It Works is missing the editorial workflow, sticky journey, or motion layer',
  'How It Works includes the editorial workflow, sticky journey, and motion layer',
);
assert(
  howItWorks.includes('class="profile-menu" id="profile-menu"')
    && howItWorks.includes('<footer class="site-footer"'),
  'How It Works is not using the shared profile mount and footer',
  'How It Works uses the shared profile mount and footer',
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
  /\.navbar-menu\s*>\s*a\[aria-current="page"\][\s\S]*?color:\s*#111111\s*!important;/.test(siteChromeCss),
  'Current navbar item still uses the blue selected state',
  'Current navbar item uses the neutral black state',
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

const homeSource = read('index.html');
assert(
  /\.home-showcase-heading h2\s*\{[\s\S]*?font-family:\s*'Acumin Pro Condensed Local'[\s\S]*?font-size:\s*clamp\(38px,\s*4\.2vw,\s*62px\);[\s\S]*?font-weight:\s*700;[\s\S]*?letter-spacing:\s*-\.035em;/.test(homeSource),
  'Homepage workspace heading does not match login typography',
  'Homepage workspace heading matches login typography',
);

if (process.exitCode) {
  console.error('\nShared chrome guard failed.');
  process.exit(process.exitCode);
}

console.log('\nShared chrome guard passed.');
