#!/usr/bin/env node

import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /\.canvas-bottom-actions\s*\{[\s\S]*?max-width:\s*min\(720px,[\s\S]*?height:\s*54px;[\s\S]*?flex-wrap:\s*nowrap;/.test(html),
  'Canvas dock must keep the compact 720px single-row base contract.',
);
assert(
  /\.canvas-bottom-actions\.is-ai-search-expanded\s*\{[\s\S]*?width:\s*min\(920px,[\s\S]*?height:\s*54px;[\s\S]*?max-height:\s*54px;/.test(html),
  'AI search must expand the dock horizontally to 920px without changing height.',
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

console.log('Canvas action dock tests passed.');
