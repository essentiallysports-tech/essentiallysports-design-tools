import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('design-tokens.css', 'utf8');
const docs = fs.readFileSync('project-docs/frameup-design-system.md', 'utf8');

const requiredRoles = [
  'display',
  'page-title',
  'workspace-title',
  'panel-title',
  'section-title',
  'field-label',
  'control',
  'body',
  'helper',
  'meta',
];

requiredRoles.forEach(role => {
  assert.match(css, new RegExp(`--es-type-${role}-size\\s*:`), `Missing ${role} size token`);
  assert.match(css, new RegExp(`\\.es-type-${role}(?:\\s|,|\\{)`), `Missing ${role} utility class`);
});

[
  'html[data-studio-shell="on"] .studio-accordion-trigger',
  'body.reels-page .reels-panel-head h2',
  '#ai-workspace .workspace-section-title',
  'body.dashboard-page .dashboard-app .panel-title',
].forEach(selector => {
  assert.ok(css.includes(selector), `Missing workspace mapping: ${selector}`);
});

[
  'index.html',
  'reels.html',
  'dashboard.html',
  'design-request.html',
  'tool-feedback.html',
  'login.html',
].forEach(file => {
  assert.match(fs.readFileSync(file, 'utf8'), /design-tokens\.css\?v=/, `${file} must load design-tokens.css`);
});

[
  'ai-page/index.html',
  'ai-page/profile.html',
  'ai-page/settings.html',
  'ai-page/logout.html',
].forEach(file => {
  assert.match(fs.readFileSync(file, 'utf8'), /\.\.\/design-tokens\.css\?v=/, `${file} must load design-tokens.css`);
});

assert.match(docs, /## Semantic Roles/);
assert.match(docs, /## Usage Rules/);

const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
let braceDepth = 0;
for (const char of cssWithoutComments) {
  if (char === '{') braceDepth += 1;
  if (char === '}') braceDepth -= 1;
  assert.ok(braceDepth >= 0, 'design-tokens.css has an extra closing brace');
}
assert.equal(braceDepth, 0, 'design-tokens.css has an unclosed block');

console.log('FrameUp design token contract passed.');
