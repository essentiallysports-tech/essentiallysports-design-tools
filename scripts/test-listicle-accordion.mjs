import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  source,
  /let activeListicleRowIndex = 0;/,
  'the first listicle row must be expanded by default',
);
assert.match(
  source,
  /summary\.setAttribute\('aria-expanded', String\(expanded\)\)/,
  'row summaries must expose their expanded state',
);
assert.match(
  source,
  /summary\.setAttribute\('aria-controls', `listicle-row-panel-\$\{rowIndex\}`\)/,
  'row summaries must reference their editor panel',
);
assert.match(
  source,
  /panel\.inert = !expanded/,
  'collapsed editors must be removed from keyboard navigation',
);
assert.match(
  source,
  /function setListicleRowExpanded[\s\S]*?index === rowIndex[\s\S]*?classList\.toggle\('is-expanded', expanded\)/,
  'opening a row must close every other row',
);
assert.match(
  source,
  /blockLabel\.textContent = `Block \$\{rowIndex \+ 1\}`;[\s\S]*?summary\.append\(blockLabel, chevron\);/,
  'collapsed listicle rows must use the simplified Block 1–5 labels',
);
assert.match(
  source,
  /\.listicle-row-card\.is-expanded \.listicle-row-panel/,
  'accordion animation styles must stay scoped to listicle rows',
);
assert.match(
  source,
  /\.listicle-row-summary \{[\s\S]*?min-height: 52px;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 18px;/,
  'collapsed listicle rows must remain compact with a label and chevron only',
);
assert.match(
  source,
  /\.listicle-row-card\.is-expanded \{[\s\S]*?border-color: #C9D0D9;/,
  'expanded listicle rows must use a neutral border instead of another blue treatment',
);
assert.doesNotMatch(
  source,
  /@container listicle-rows \(max-width: 520px\)[\s\S]*?\.listicle-row-primary-grid[\s\S]*?grid-template-columns: 1fr;/,
  'rank, entity, and metrics must remain compact horizontal groups inside the properties panel',
);

console.log('Listicle accordion UI tests passed.');
