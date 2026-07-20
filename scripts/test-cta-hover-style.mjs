#!/usr/bin/env node

import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const rootPages = ['index.html', 'design-request.html', 'dashboard.html', 'login.html', 'reset-password.html', 'auth-callback.html'];
const nestedPages = ['ai-page/index.html', 'ai-page/profile.html', 'ai-page/settings.html', 'ai-page/logout.html'];

for (const page of rootPages) {
  const html = fs.readFileSync(page, 'utf8');
  assert(/href="cta-hover\.css\?v=20260720-stroke1"/.test(html), `${page} must load the shared CTA hover stylesheet.`);
}

for (const page of nestedPages) {
  const html = fs.readFileSync(page, 'utf8');
  assert(/href="\.\.\/cta-hover\.css\?v=20260720-stroke1"/.test(html), `${page} must load the shared CTA hover stylesheet.`);
}

const css = fs.readFileSync('cta-hover.css', 'utf8');

assert(
  /:not\(:disabled\):not\(\.is-disabled\):hover\s*\{[\s\S]*?transform:\s*none\s*!important;[\s\S]*?box-shadow:\s*none\s*!important;[\s\S]*?filter:\s*none\s*!important;/.test(css),
  'Shared CTA hover must remove lift, glow, and filter effects.',
);
assert(
  /\.canvas-upload-button-secondary[\s\S]*?:hover\s*\{[\s\S]*?border-color:\s*#0A7DFA\s*!important;[\s\S]*?background-color:\s*#FFFFFF\s*!important;[\s\S]*?color:\s*#111827\s*!important;/.test(css),
  'Secondary canvas CTA hover must change only to the blue stroke treatment.',
);
for (const selector of [
  '.image-context-upload',
  '.image-context-ai',
  '.canvas-ai-search-submit',
  '.quick-action',
  '.avatar-upload-label',
  '.profile-back-link',
]) {
  assert(css.includes(selector), `${selector} must use the shared stroke-only CTA interaction system.`);
}
assert(
  /transition-property:\s*border-color,\s*outline-color\s*!important;/.test(css),
  'CTA motion must be limited to the stroke instead of moving, glowing, or recoloring the surface.',
);
assert(
  /\.danger-btn:not\(:disabled\):hover\s*\{[\s\S]*?border-color:\s*#A62932\s*!important;[\s\S]*?background-color:\s*#FFFFFF\s*!important;[\s\S]*?color:\s*#A62932\s*!important;/.test(css),
  'Danger CTA hover must retain its surface and text while highlighting its stroke.',
);

console.log('Shared CTA hover tests passed.');
