import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../ai-page/profile.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../ai-page/profile-page.css', import.meta.url), 'utf8');

assert.match(html, /<body class="profile-page">/);
assert.match(html, /profile-page\.css\?v=/);
assert.match(html, /class="account-card profile-editor"/);
assert.doesNotMatch(html, /class="account-grid"/);

for (const id of [
  'profile-form',
  'avatar',
  'avatar-upload',
  'profile-avatar-large',
  'summary-name',
  'summary-role',
  'name',
  'role',
  'email',
  'team',
  'bio',
  'reset-profile',
  'profile-status',
  'open-delete-account',
  'delete-account-dialog',
  'delete-account-form',
  'delete-account-confirmation',
  'confirm-delete-account',
]) {
  assert.match(html, new RegExp(`id="${id}"`), `Missing preserved profile control #${id}`);
}

assert.match(css, /\.profile-editor\s*\{[\s\S]*grid-template-columns:\s*220px minmax\(0, 1fr\)/);
assert.match(css, /\.profile-page \.large-avatar\s*\{[\s\S]*width:\s*112px;[\s\S]*height:\s*112px;/);
assert.match(css, /\.profile-page \.field textarea\s*\{[\s\S]*min-height:\s*120px;/);
assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.profile-editor\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
assert.match(css, /@media \(max-width:\s*520px\)[\s\S]*\.profile-page \.primary-btn,[\s\S]*width:\s*100%;/);

console.log('Profile layout regression checks passed.');
