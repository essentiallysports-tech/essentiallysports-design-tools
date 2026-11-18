import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../ai-page/profile.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../ai-page/account-pages.css', import.meta.url), 'utf8');

// 2026-11-20 (account-polish): the page uses the shared account layout
// (account-pages.css, body.account-v2) on top of profile-page.css.
assert.match(html, /<body class="profile-page account-v2">/);
assert.match(html, /profile-page\.css\?v=/);
assert.match(html, /account-pages\.css\?v=/);
assert.match(html, /class="[^"]*\baccount-card profile-editor\b[^"]*"/);
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

assert.match(css, /\.profile-editor\.acc-profile\s*\{[\s\S]*grid-template-columns:\s*200px minmax\(0, 1fr\)/);
assert.match(css, /\.acc-profile \.large-avatar\s*\{[\s\S]*width:\s*112px !important;[\s\S]*height:\s*112px !important;/);
assert.match(css, /textarea \{ min-height: 112px;/);
assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.profile-editor\.acc-profile \{ grid-template-columns: 1fr !important; \}/);
assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.acc-fields \{ grid-template-columns: minmax\(0, 1fr\); \}/);
// Email is the sign-in, never edited here.
assert.match(html, /<input id="email" name="email" type="email" readonly/);

console.log('Profile layout regression checks passed.');
