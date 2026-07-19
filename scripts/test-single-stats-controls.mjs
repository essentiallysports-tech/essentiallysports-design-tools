#!/usr/bin/env node

import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /id="stats-single-fields"[\s\S]*?data-stats-value="0"[\s\S]*?data-stats-label="0"[\s\S]*?data-stats-value="1"[\s\S]*?data-stats-label="1"[\s\S]*?data-stats-value="2"[\s\S]*?data-stats-label="2"/.test(html),
  'Single Stats must retain its three existing value/label data bindings.',
);

assert(
  /#stats-single-fields \.stats-entry\s*\{[\s\S]*?grid-template-columns:\s*minmax\(58px,\s*\.72fr\)\s+minmax\(0,\s*1fr\);[\s\S]*?gap:\s*0;[\s\S]*?overflow:\s*hidden;/.test(html),
  'Single Stats must render each value and label as one compound control.',
);

assert(
  /#stats-single-fields \.stats-entry \.stats-entry-label-input\s*\{[\s\S]*?border-left:\s*1px solid #E4EAF1;/.test(html),
  'Single Stats compound controls must use one internal divider.',
);

assert(
  /@container \(max-width:\s*560px\)[\s\S]*?#stats-single-fields \.stats-entry-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr;/.test(html),
  'Single Stats controls must stack cleanly in a narrow inspector.',
);

assert(
  /#stats-single-fields \.stats-entry-grid > \.stats-entry::after\s*\{[\s\S]*?display:\s*none;/.test(html),
  'Single Stats must remove the old leaking separators.',
);

console.log('Single Stats control tests passed.');
