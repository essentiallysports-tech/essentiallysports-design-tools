#!/usr/bin/env node

import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /<option value="section-header">Header Option 1<\/option>[\s\S]*?<option value="section-header-2">Header Option 2<\/option>/.test(html),
  'Newsletter asset menu must expose Header Option 1 and Header Option 2 in order.',
);
assert(
  /'section-header':\s*\{[\s\S]*?label:\s*'Header Option 1'[\s\S]*?width:\s*640,[\s\S]*?height:\s*47,/.test(html),
  'Header Option 1 must retain the existing 640 × 47 workspace contract.',
);
assert(
  /'section-header-2':\s*\{[\s\S]*?label:\s*'Header Option 2'[\s\S]*?width:\s*640,[\s\S]*?height:\s*47,[\s\S]*?exportScale:\s*1\.5,/.test(html),
  'Header Option 2 must use the same 640 × 47 PNG export contract.',
);
assert(
  /activeNewsletterAsset === 'section-header-2'[\s\S]*?drawNewsletterSectionHeaderOption2/.test(html),
  'Header Option 2 must route to its dedicated renderer.',
);
assert(
  /function drawNewsletterSectionHeaderOption2\(ctx, W, H, scale\)[\s\S]*?applyNewsletterBrandPalette\(\);[\s\S]*?const brand = getNewsletterBrand\(state\.newsletterBrand\);[\s\S]*?const navy = brand\.background \|\| '#033162';[\s\S]*?const cream = brand\.foreground \|\| '#FFF9EB';/.test(html),
  'Header Option 2 must use the selected newsletter brand colors.',
);
assert(
  /data-newsletter-asset="section-header-2"\] #newsletter-brand-card/.test(html),
  'Header Option 2 must expose the newsletter brand color selector.',
);
assert(
  /const frameWidth = Math\.min\(maxFrameWidth, Math\.max\(minFrameWidth, textWidth \+ horizontalPadding \* 2\)\);/.test(html),
  'Header Option 2 pill must hug its text content.',
);
assert(
  /const sideLineWidth = Math\.max\(0, frameX - lineGap\);[\s\S]*?ctx\.lineTo\(sideLineWidth, frameCenterY\);[\s\S]*?ctx\.moveTo\(W - sideLineWidth, frameCenterY\);/.test(html),
  'Header Option 2 side lines must rebalance around the dynamic pill.',
);
assert(
  /fontSize = Math\.max\(minimumFontSize, fontSize \* \(maxTextWidth \/ textWidth\)\);/.test(html),
  'Header Option 2 must reduce font size safely for long text.',
);
assert(
  /data-newsletter-asset="section-header-2"\] \.advanced-card[\s\S]*?data-newsletter-asset="section-header-2"\] #pill-position-card/.test(html),
  'Header Option 2 must hide unrelated advanced pill controls.',
);

console.log('Newsletter header option tests passed.');
