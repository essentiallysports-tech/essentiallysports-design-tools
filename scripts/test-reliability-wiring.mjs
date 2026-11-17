#!/usr/bin/env node
// Wiring for the reliability pass (cloud drafts, error reporting, health,
// shell-first loading):
//   1. every signed-in page loads frameup-errors.js first; sign-in pages don't
//   2. Generate, Video Ads and Gallery load frameup-shell-first.js right after
//      requireAuth; the editor loads cloud drafts after autosave + designs
//   3. shell-first in a fake DOM: shell + skeleton at once, #main hidden until
//      es:auth-ready, no-op when the page isn't being held by requireAuth
//   4. API adapters, vercel.json entries, migrations (idempotent, RLS, Undo)
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

// ── 1. Error reporter on every signed-in page ───────────────────────────────
const SIGNED_IN = ['index.html', 'generate.html', 'video-ads.html', 'gallery.html', 'dashboard.html', 'design-request.html', 'design-system.html', 'how-frameup-works.html', 'reels.html', 'tool-feedback.html', 'trend-design.html', 'ai-page/settings.html', 'ai-page/profile.html', 'ai-page/index.html'];
for (const page of SIGNED_IN) {
  const html = read(page);
  const prefix = page.startsWith('ai-page/') ? '../' : '';
  const reporter = html.indexOf(`src="${prefix}frameup-errors.js?v=`);
  const config = html.indexOf(`src="${prefix}es-auth-config.js`);
  assert.ok(reporter > 0, `${page} loads the error reporter`);
  assert.ok(reporter < config, `${page}: reporter loads before everything else`);
}
for (const page of ['login.html', 'auth-callback.html', 'reset-password.html']) {
  assert.ok(!read(page).includes('frameup-errors.js'), `${page} (signed out) has no reporter`);
}

// ── 2. Shell-first and cloud drafts includes ────────────────────────────────
for (const [page, variant] of [['generate.html', 'studio'], ['video-ads.html', 'studio'], ['gallery.html', 'grid']]) {
  const html = read(page);
  const guard = html.indexOf('window.ESAuth?.requireAuth(');
  const shell = html.indexOf('src="frameup-shell-first.js?v=');
  assert.ok(guard > 0 && shell > guard, `${page}: shell-first runs after the auth guard`);
  assert.ok(shell - guard < 200, `${page}: immediately after it`);
  assert.ok(html.includes(`data-skeleton="${variant}"`), `${page}: ${variant} skeleton`);
}
{
  const html = read('index.html');
  const autosave = html.indexOf('src="frameup-autosave.js?v=');
  const designs = html.indexOf('src="frameup-designs.js?v=');
  const cloud = html.indexOf('src="frameup-cloud-drafts.js?v=');
  assert.ok(autosave > 0 && designs > autosave && cloud > designs, 'editor: autosave → designs → cloud drafts');
}

// ── 3. Shell-first in a fake DOM ────────────────────────────────────────────
function fakeDom({ hidden = true, mainReady = true } = {}) {
  const listeners = {};
  const classes = new Set();
  const head = [];
  let main = null;
  const makeEl = tag => ({
    tagName: tag.toUpperCase(), className: '', style: {}, dataset: {}, attrs: {}, removed: false,
    setAttribute(name, value) { this.attrs[name] = value; },
    remove() { this.removed = true; if (main) main.children = main.children.filter(child => child !== this); },
    set innerHTML(value) { this._html = value; }, get innerHTML() { return this._html || ''; },
    set textContent(value) { this._text = value; }, get textContent() { return this._text || ''; },
  });
  const createMain = () => ({ id: 'main', children: [], prepend(...nodes) { this.children.unshift(...nodes); } });
  if (mainReady) main = createMain();
  let observerCallback = null;
  const document = {
    documentElement: { style: { visibility: hidden ? 'hidden' : '' }, classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) } },
    currentScript: { dataset: { skeleton: 'grid' } },
    head: { appendChild: el => head.push(el) },
    createElement: makeEl,
    getElementById: id => (id === 'main' ? main : null),
  };
  const window = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatch(type) { (listeners[type] || []).forEach(fn => fn({})); },
  };
  const context = {
    window, document, performance: { now: () => 0, measure() {} },
    MutationObserver: class { constructor(fn) { observerCallback = fn; } observe() {} disconnect() { observerCallback = null; } },
  };
  return {
    context, classes, head, window,
    get main() { return main; },
    addMain() { main = createMain(); observerCallback?.(); },
  };
}
const shellFirst = read('frameup-shell-first.js');
{
  const dom = fakeDom();
  vm.runInNewContext(shellFirst, dom.context);
  assert.ok(dom.classes.has('es-auth-pending'), 'page held by requireAuth: shell shows at once');
  const css = dom.head[0].textContent;
  assert.match(css, /html\.es-auth-pending \{ visibility: visible !important; \}/, 'overrides the whole-page hide');
  assert.match(css, /#main > :not\(\.es-auth-skeleton, \.es-auth-live\),[\s\S]*visibility: hidden !important;[\s\S]*opacity: 0 !important;[\s\S]*pointer-events: none !important;/, 'page content stays hidden and unclickable');
  assert.match(css, /\[data-profile-name\]/, 'the account name waits for the check');
  assert.match(css, /\.es-usage/, 'AI usage waits for the check');
  assert.equal(dom.main.children[0].className, 'es-auth-skeleton is-grid', 'skeleton placed in #main');
  assert.equal(dom.main.children[1].attrs.role, 'status', 'screen readers hear "Loading…"');
  dom.window.dispatch('es:auth-ready');
  assert.ok(!dom.classes.has('es-auth-pending'), 'revealed only after es:auth-ready');
  assert.equal(dom.main.children.length, 0, 'skeleton removed');
}
{
  const dom = fakeDom({ mainReady: false });
  vm.runInNewContext(shellFirst, dom.context);
  assert.equal(dom.main, null);
  dom.addMain();
  assert.equal(dom.main.children[0].className, 'es-auth-skeleton is-grid', 'placed as soon as #main is parsed');
}
{
  const dom = fakeDom({ hidden: false });
  vm.runInNewContext(shellFirst, dom.context);
  assert.ok(!dom.classes.has('es-auth-pending'), 'not held by requireAuth: does nothing');
  assert.equal(dom.head.length, 0);
}

// ── 4. Endpoints and migrations ─────────────────────────────────────────────
{
  const vercel = JSON.parse(read('vercel.json'));
  assert.ok(vercel.functions['api/client-errors.js'], 'vercel.json: client-errors');
  assert.ok(vercel.functions['api/health.js'], 'vercel.json: health');
  for (const name of ['client-errors', 'health']) {
    assert.ok(existsSync(new URL(`../api/${name}.js`, import.meta.url)), `api/${name}.js`);
    assert.match(read(`api/${name}.js`), /toNetlifyEvent/, `api/${name}.js uses the adapter pattern`);
  }
}
for (const [file, table] of [['supabase/migrations/20261118120000_frameup_drafts.sql', 'frameup_drafts'], ['supabase/migrations/20261118120100_frameup_client_errors.sql', 'frameup_client_errors']]) {
  const sql = read(file);
  assert.match(sql, /-- Undo:/, `${file}: Undo note`);
  assert.match(sql, new RegExp(`create table if not exists public\\.${table}`), `${file}: idempotent table`);
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), `${file}: RLS on`);
  const policies = sql.match(/create policy "([^"]+)"/g) || [];
  assert.ok(policies.length >= 2, `${file}: policies`);
  policies.forEach(policy => assert.ok(sql.includes(`drop policy if exists ${policy.slice('create policy '.length)}`), `${file}: ${policy} is re-runnable`));
  assert.match(sql, /is_es_designer_admin\(\)/, `${file}: admins read`);
  assert.ok(!/default[^,\n]*\(select /i.test(sql), `${file}: no subqueries in DEFAULT`);
}
{
  const sql = read('supabase/migrations/20261118120000_frameup_drafts.sql');
  assert.match(sql, /owner_id = \(select auth\.uid\(\)\)/, 'drafts: own rows only');
  assert.match(sql, /octet_length\(design::text\) <= 524288/, 'drafts: size cap in the database');
  assert.match(sql, /interval '30 days'/, 'drafts: 30-day retention');
}

console.log('reliability wiring: ok');
