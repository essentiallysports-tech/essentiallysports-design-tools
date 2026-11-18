#!/usr/bin/env node
// Account menu (site-chrome.js), theme preference (theme.js), tour progress
// (tours/tour-launcher.js) and the account pages. No network, no browser:
// markup contracts are read from source; theme.js runs in a VM sandbox.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); } catch (error) { failed += 1; console.error(`FAIL ${name}\n     ${error.message}`); }
}

const chrome = read('site-chrome.js');

test('menu button: aria-haspopup=menu, aria-expanded, aria-controls', () => {
  assert.match(chrome, /class="profile-trigger" type="button" id="\$\{triggerId\}" aria-haspopup="menu" aria-expanded="false" aria-controls="\$\{popoverId\}"/);
});

test('menu: role=menu labelled by its button, vertical, inert while closed', () => {
  assert.match(chrome, /class="profile-dropdown" id="\$\{popoverId\}" role="menu" aria-labelledby="\$\{triggerId\}" aria-orientation="vertical" aria-hidden="true" inert/);
});

test('items: menuitem with tabindex -1 (roving focus), grouped, separated', () => {
  assert.match(chrome, /class="profile-option" role="menuitem" tabindex="-1"/);
  assert.ok((chrome.match(/role="group" aria-label=/g) || []).length >= 2, 'labelled groups');
  assert.ok((chrome.match(/class="profile-sep" role="separator"/g) || []).length >= 4, 'separators');
  assert.match(chrome, /class="profile-identity" role="none"/);
});

test('items: Edit profile, Settings, Tours, What’s new, UI Library, Log out', () => {
  for (const label of ['Edit profile', 'Settings', 'Tours', 'What’s new', 'UI Library', 'Log out']) {
    assert.ok(chrome.includes(`'${label}'`), `missing ${label}`);
  }
  assert.match(chrome, /logout\.html\?from=menu/);
  assert.match(chrome, /data-tour-launch data-profile-action="tours" hidden/, 'Tours hidden until tours load');
  assert.match(chrome, /data-profile-action="whats-new" hidden/, 'What’s new hidden until the panel exists');
});

test('appearance: three menuitemradio choices incl. System', () => {
  assert.match(chrome, /role="menuitemradio" tabindex="-1" aria-checked="false" data-profile-theme-choice="\$\{value\}"/);
  assert.match(chrome, /choice\('light', 'Light'\)\}\$\{choice\('dark', 'Dark'\)\}\$\{choice\('system', 'System'\)\}/);
  assert.match(chrome, /button\.setAttribute\('aria-checked', String\(on\)\)/);
});

test('keyboard: arrows, Home/End, Tab, Enter/Space, type-ahead, Esc returns focus', () => {
  const handler = chrome.slice(chrome.indexOf('function onMenuKeydown'), chrome.indexOf('function setupInteractions'));
  for (const key of ["'ArrowDown'", "'ArrowUp'", "'ArrowRight'", "'ArrowLeft'", "'Home'", "'End'", "'Tab'", "'Enter'", "' '"]) {
    assert.ok(handler.includes(`case ${key}`), `handles ${key}`);
  }
  assert.match(handler, /startsWith\(letter\)/, 'type-ahead');
  assert.match(chrome, /event\.key === 'ArrowUp' \? \{ focusLast: true \} : \{ focusFirst: true \}/, '↑ opens on the last item');
  assert.match(chrome, /setProfileOpen\(openMenu, false, \{ returnFocus: true \}\)/, 'Esc gives focus back');
  assert.match(chrome, /focusItem\(menu, \(index \+ items\.length\)|items\[\(index \+ items\.length\) % items\.length\]/, 'wraps around');
});

test('logout: asks only when autosave or a page reports unsaved work', () => {
  assert.match(chrome, /FrameUpAutosave/);
  assert.match(chrome, /registerUnsaved/);
  assert.match(chrome, /if \(message && !await confirmLogout\(message\)\)/);
});

test('check-site-chrome contract strings are kept', () => {
  for (const s of ['FrameUpProfileMenu', 'frameup-profile-change', '.profile-menu [data-profile-name]', "event.key === 'ArrowDown'", '.profile-option, [data-profile-theme-choice]', "event.key !== 'Escape'", 'aria-controls']) {
    assert.ok(chrome.includes(s), s);
  }
});

// ─── theme.js: light / dark / system ──────────────────────────────────
function runTheme({ stored = null, prefersDark = false } = {}) {
  const store = new Map(stored ? [['frameup.theme.v1', stored]] : []);
  const listeners = {};
  const mql = { matches: prefersDark, addEventListener: (type, fn) => { mql.fn = fn; } };
  const root = { dataset: {}, style: {}, get offsetHeight() { return 0; } };
  const events = [];
  const window = {
    matchMedia: () => mql,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    dispatchEvent: event => events.push(event),
    requestAnimationFrame: fn => fn(),
  };
  const document = {
    documentElement: root,
    readyState: 'complete',
    head: { appendChild() {} },
    createElement: () => ({ remove() {} }),
    querySelector: () => null,
    addEventListener() {},
  };
  const context = {
    window, document, requestAnimationFrame: () => 0,
    localStorage: { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  };
  vm.runInNewContext(read('theme.js'), context);
  return { api: window.FrameUpTheme, root, store, mql, events };
}

test('theme: default light; stored dark stays dark', () => {
  assert.equal(runTheme().root.dataset.theme, 'light');
  assert.equal(runTheme({ stored: 'dark' }).root.dataset.theme, 'dark');
});

test('theme: system resolves from prefers-color-scheme and is remembered as "system"', () => {
  const t = runTheme({ prefersDark: true });
  assert.equal(t.api.apply('system'), 'dark');
  assert.equal(t.store.get('frameup.theme.v1'), 'system');
  assert.equal(t.api.preference(), 'system');
  assert.equal(t.root.dataset.theme, 'dark');
  assert.equal(t.events.at(-1).detail.preference, 'system');
});

test('theme: system follows a device change live', () => {
  const t = runTheme({ stored: 'system', prefersDark: false });
  assert.equal(t.root.dataset.theme, 'light');
  t.mql.matches = true;
  t.mql.fn();
  assert.equal(t.root.dataset.theme, 'dark');
  t.api.apply('light');
  t.mql.matches = false; t.mql.fn(); t.mql.matches = true; t.mql.fn();
  assert.equal(t.root.dataset.theme, 'light', 'an explicit choice ignores the device');
});

// ─── Tours progress ───────────────────────────────────────────────────
const launcher = read('tours/tour-launcher.js');
test('tours: progress recorded on tour-start / completed tour-end, exposed as progressSummary', () => {
  assert.match(launcher, /addEventListener\('frameup:tour-start'/);
  assert.match(launcher, /if \(completed\) recordTour\(id, \{ doneAt:/);
  assert.match(launcher, /progressSummary,/);
  assert.match(launcher, /actions\.closest\('\.profile-menu'\)\?\.querySelector\('\[data-tour-launch\]'\)/, 'no duplicate Tours item');
  assert.match(launcher, /dataset\.tours === 'off'/);
});

// ─── Pages ────────────────────────────────────────────────────────────
test('account pages load account-pages.css and the new cache keys', () => {
  for (const page of ['ai-page/profile.html', 'ai-page/settings.html', 'ai-page/logout.html']) {
    const html = read(page);
    assert.match(html, /account-pages\.css\?v=[\w-]+/, page);
    assert.match(html, /site-chrome\.js\?v=[\w-]+/, page);
    assert.match(html, /class="[^"]*\baccount-v2\b/, page);
  }
});

test('settings: real settings only (theme, start page, AI usage readout)', () => {
  const html = read('ai-page/settings.html');
  assert.match(html, /name="theme" value="system"/);
  assert.match(html, /id="start-page"/);
  assert.match(html, /role="switch"/);
  assert.match(html, /rpc\('frameup_my_ai_spend'/);
  assert.match(html, /es-error-state/);
  assert.match(html, /rememberLastWorkspace: false/, 'default matches index.html');
});

test('logout: from the menu signs out at once; otherwise asks; handles no session', () => {
  const html = read('ai-page/logout.html');
  assert.match(html, /get\('from'\) === 'menu'/);
  assert.match(html, /You’re signed out/);
  assert.match(html, /You’re already signed out/);
  assert.match(html, /result === 'no-session'/);
  assert.match(html, /window\.ESAuth\?\.logout\?\.\(\)/);
  assert.match(html, /data-tours="off"/);
});

if (failed) {
  console.error(`\n${failed} account menu check(s) failed.`);
  process.exit(1);
}
console.log('\nAccount menu checks passed.');
