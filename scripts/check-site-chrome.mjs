#!/usr/bin/env node

import fs from 'node:fs';

const navbarPages = [
  'index.html',
  'design-request.html',
  'dashboard.html',
  'ai-page/index.html',
  'ai-page/profile.html',
  'ai-page/settings.html',
  'ai-page/logout.html',
];

const footerPages = [
  'index.html',
  'design-request.html',
  'login.html',
  'ai-page/index.html',
  'ai-page/profile.html',
  'ai-page/settings.html',
  'ai-page/logout.html',
];

const noFooterPages = ['dashboard.html', 'reset-password.html'];

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
    html.includes(`${prefix}site-chrome.css?v=20260713-chrome1`),
    `${file} is missing the shared site chrome stylesheet`,
    `${file} uses the shared site chrome stylesheet`,
  );
  assert(
    html.includes(`${prefix}site-chrome.js?v=20260713-chrome1`),
    `${file} is missing the shared site chrome behavior`,
    `${file} uses the shared site chrome behavior`,
  );
  assert(html.includes('class="navbar"'), `${file} has no global navbar`, `${file} has the global navbar`);
  assert(html.includes('class="navbar-logo"'), `${file} has no navbar logo`, `${file} has a navbar logo`);
  assert(html.includes('class="navbar-menu"'), `${file} has no navbar menu`, `${file} has a navbar menu`);
  assert(html.includes('class="navbar-right"'), `${file} has no navbar utilities`, `${file} has navbar utilities`);
  assert(html.includes('class="profile-menu"'), `${file} has no profile menu`, `${file} has a profile menu`);

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

const index = read('index.html');
assert(
  /'section-header':\s*\{[\s\S]*?workspace:\s*\{\s*width:\s*640,\s*height:\s*47,/.test(index),
  'Section Header dimensions changed from the established 640×47 contract',
  'Section Header retains the established 640×47 dimensions',
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

if (process.exitCode) {
  console.error('\nShared chrome guard failed.');
  process.exit(process.exitCode);
}

console.log('\nShared chrome guard passed.');
