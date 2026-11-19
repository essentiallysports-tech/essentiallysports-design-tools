#!/usr/bin/env node

import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const polish = fs.readFileSync('editor-polish.css', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /\.canvas-bottom-actions\s*\{[\s\S]*?max-width:\s*min\(720px,[\s\S]*?height:\s*54px;[\s\S]*?flex-wrap:\s*nowrap;/.test(html),
  'Canvas dock must keep the compact 720px single-row base contract.',
);
assert(
  /body\[data-current-page="instagram"\] \.canvas-bottom-actions\s*\{[\s\S]*?width:\s*max-content;[\s\S]*?margin-left:\s*auto;[\s\S]*?margin-right:\s*auto;[\s\S]*?transform:\s*none;/.test(html),
  'The collapsed social canvas dock must hug its controls and remain centered.',
);
assert(
  /\.canvas-bottom-actions\.is-ai-search-expanded\s*\{[\s\S]*?width:\s*max-content;[\s\S]*?max-width:\s*min\(760px,[\s\S]*?height:\s*54px;[\s\S]*?max-height:\s*54px;/.test(html),
  'AI search must expand to its content width without changing dock height.',
);
assert(
  /\.canvas-bottom-actions\.is-ai-search-expanded \.canvas-ai-search-form\s*\{[\s\S]*?width:\s*clamp\(280px,\s*22vw,\s*340px\);[\s\S]*?max-width:\s*340px;/.test(html),
  'Desktop AI search must use the compact 340px search-field ceiling.',
);
assert(
  /\.canvas-bottom-actions\s*\{[\s\S]*?gap:\s*8px;[\s\S]*?padding:\s*7px 10px;/.test(html)
    && /\.canvas-ai-search-close\s*\{[\s\S]*?margin-right:\s*3px;/.test(html),
  'The expanded dock must keep balanced inner gaps and edge padding.',
);
assert(
  /\.studio-dock-actions \.canvas-bottom-actions\.is-ai-search-expanded,[\s\S]*?width:\s*max-content;[\s\S]*?display:\s*inline-flex;/.test(html),
  'The studio dock override must preserve content-fit horizontal expansion.',
);
assert(
  /@media \(max-width:\s*1023px\)[\s\S]*?\.canvas-bottom-actions\.is-ai-search-expanded[\s\S]*?height:\s*54px;[\s\S]*?overflow-x:\s*auto;[\s\S]*?overflow-y:\s*hidden;/.test(html),
  'Narrow screens must preserve dock height and use horizontal overflow only.',
);
assert(
  /actionDock\?\.classList\.toggle\('is-ai-search-expanded', expanded\)/.test(html),
  'Dock expansion must remain driven by the existing AI search state.',
);
assert(
  /form\?\.toggleAttribute\('inert', !expanded\)/.test(html),
  'Collapsed search must remain inert and keyboard-safe.',
);
assert(
  /content:\s*\['quote-logo-control',\s*'\.text-card',(?:\s*'[\w-]+',)*\s*'swipe-button-card'\]/.test(html),
  'Swipe Button must remain inside the Content panel.',
);
assert(
  /layout:\s*\['pill-position-card'\]/.test(html),
  'Layout panel must not retain the Swipe Button control.',
);

// QA 2026-11-21: at 1024 the dock was capped by a formula that assumed an open
// 240px Layers column, so Upload Image / ES Image Pool spilled out of the card.
// The cap now follows the real column, and the image buttons may wrap.
assert(
  /\.has-layers-panel\.layers-collapsed \{ --fu-dock-left: 48px; \}/.test(polish)
    && /\.canvas-stack > \.canvas-bottom-actions \{\s*max-width: min\(800px, calc\(100vw - var\(--es-shell-offset, 0px\) - var\(--fu-dock-left\) - var\(--fu-inspector-w/.test(polish),
  'The dock must be capped by the real canvas column (Layers rail or open column, plus the inspector).',
);
assert(
  /\.canvas-bottom-actions \.canvas-primary-actions \{\s*flex-wrap: wrap !important;/.test(polish),
  'Upload Image and ES Image Pool must wrap inside the dock instead of overflowing it.',
);
assert(
  /@media \(min-width: 1024px\) \{\s*html\[data-studio-shell="on"\]:root body \.canvas-stack > \.canvas-bottom-actions \{ margin-left: 0 !important; margin-right: 0 !important; \}/.test(polish),
  'The dock must not carry auto side margins on top of its left:50% centring.',
);

console.log('Canvas action dock tests passed. (The live overflow check is scripts/check-editor-ui.mjs.)');
