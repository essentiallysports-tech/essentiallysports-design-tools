#!/usr/bin/env node

import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /\.swatch\.active\s*\{[^}]*border-color:\s*transparent\s*!important;[^}]*box-shadow:\s*none;/.test(html),
  'Selected color swatches must not retain the pale-blue outline or halo.',
);
assert(
  /\.swatch\.is-light,[\s\S]*?\.swatch\.is-light\.active\s*\{[^}]*border-color:\s*#D8DEE7\s*!important;/.test(html),
  'White and near-white swatches must retain a subtle neutral-grey boundary.',
);
assert(
  /classList\.toggle\('is-light', contrastRatio\(p\.background, '#FFFFFF'\) < 1\.2\)/.test(html)
    && /classList\.toggle\('is-light', contrastRatio\(pair\.background, '#FFFFFF'\) < 1\.2\)/.test(html),
  'All workspace palette renderers must identify light swatches consistently.',
);

console.log('Color swatch state tests passed.');
