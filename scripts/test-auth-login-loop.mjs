#!/usr/bin/env node
// Login-loop fixes: storage that can't silently drop the session, post-login
// verification, stale-key cleanup, clock skew, robust requireAuth, loop
// breaker records, SDK self-hosting with CDN fallback, /api/auth-bounce.
// Everything mocked: no network, no real Supabase, no real passwords.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url));
const authSource = read('es-auth.js').toString('utf8');
const loginHtml = read('login.html').toString('utf8');
const bounce = require('../netlify/functions/auth-bounce.js');

const TEST_PASSWORD = ['loop', 'test', 'only', '7'].join('-');
const ES = 'designer@essentiallysports.com';
const KEY = 'sb-exampleref-auth-token';

function storage({ full = false } = {}) {
  const values = new Map();
  const api = {
    full,
    get length() { return values.size; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (api.full) {
        const error = new Error('The quota has been exceeded.');
        error.name = 'QuotaExceededError';
        throw error;
      }
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
    _values: values,
  };
  return api;
}

function makeSession({ token = 'access-1', skew = 0 } = {}) {
  const now = Math.round(Date.now() / 1000) - skew;
  return {
    access_token: token,
    refresh_token: `refresh-${token}`,
    expires_in: 3600,
    expires_at: now + 3600,
    user: { id: 'user-1', email: ES, user_metadata: { name: 'Designer' } },
  };
}

function env({ localFull = false, sessionFull = false, href = 'https://frameup.essentiallysports.com/login.html', signIn, getSession, sdk = 'present', scriptBehaviour = {}, timers = 'real' } = {}) {
  const localStorage = storage({ full: localFull });
  const sessionStorage = storage({ full: sessionFull });
  const beacons = [];
  const appended = [];
  const url = new URL(href);
  const location = {
    href: url.href, origin: url.origin, pathname: url.pathname, search: url.search, hash: url.hash,
    replaceTarget: '', replace(value) { this.replaceTarget = value; }, reload() { this.reloaded = true; },
  };
  let authStorage = null;
  let current = null;
  const client = {
    rpc: async () => ({ data: true, error: null }),
    auth: {
      // Behaves like supabase-js: saves through the storage it was given.
      async signInWithPassword() {
        const session = signIn ? signIn() : makeSession();
        if (session) authStorage.setItem(KEY, JSON.stringify(session));
        current = session;
        return { data: { session, user: session?.user }, error: null };
      },
      async getSession() {
        if (getSession) return getSession(authStorage);
        const raw = authStorage.getItem(KEY);
        return { data: { session: raw ? JSON.parse(raw) : null }, error: null };
      },
      async signOut() { current = null; return { error: null }; },
    },
  };
  const window = {
    ES_AUTH_CONFIG: { supabase: { url: 'https://exampleref.supabase.co', anonKey: 'public-test-key' }, allowedDomains: ['essentiallysports.com'], allowedEmails: [] },
    localStorage, sessionStorage, location,
    supabase: sdk === 'present' ? { createClient: (u, k, options) => { authStorage = options.auth.storage; assert.equal(options.auth.storageKey, KEY); return client; } } : undefined,
    dispatchEvent(event) { (window.events ||= []).push(event.type); },
    addEventListener() {},
    setTimeout: timers === 'real' ? (fn, ms) => setTimeout(fn, Math.min(ms, 5)) : () => undefined,
    clearTimeout: id => clearTimeout(id),
    fetch: async () => ({ ok: true, status: 200 }),
  };
  const head = {
    appendChild(script) {
      appended.push(script.src);
      const behaviour = scriptBehaviour[script.src.includes('/vendor/') ? 'local' : 'cdn'] || 'load';
      setTimeout(() => {
        if (behaviour === 'load') {
          window.supabase = { createClient: (u, k, options) => { authStorage = options.auth.storage; return client; } };
          script.listeners.load?.();
        } else {
          script.listeners.error?.();
        }
      }, 1);
    },
  };
  const body = { children: [], append(node) { this.children.push(node); } };
  const document = {
    documentElement: { style: {}, dataset: {}, classList: { toggle() {} } },
    readyState: 'complete',
    head,
    body,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    getElementById: id => body.children.find(node => node.id === id) || null,
    createElement: tag => ({
      tag, style: {}, listeners: {}, children: [], dataset: {},
      setAttribute(name, value) { this[name] = value; },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      append(...nodes) { this.children.push(...nodes); },
      focus() {},
    }),
  };
  const navigator = {
    onLine: true,
    userAgent: 'TestAgent/1.0',
    locks: { request() {}, query: async () => ({ held: [] }) },
    sendBeacon(endpoint, blob) { beacons.push({ endpoint, blob }); return true; },
  };
  const context = vm.createContext({
    window, document, navigator, TextEncoder, URL, URLSearchParams, Date, Math, JSON, Object, Array, String, Boolean, Number, Map, Set, Promise,
    Blob, AbortController, Headers: globalThis.Headers,
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  });
  vm.runInContext(authSource, context, { filename: 'es-auth.js' });
  return { window, document, localStorage, sessionStorage, location, beacons, appended, getAuthStorage: () => authStorage };
}

const passed = [];
async function test(name, fn) { await fn(); passed.push(name); }

await test('full localStorage: login still saves the session (sessionStorage) and verifies it', async () => {
  const e = env({ localFull: true });
  const session = await e.window.ESAuth.login({ email: ES, password: TEST_PASSWORD });
  assert.equal(session.user.email, ES);
  assert.equal(JSON.parse(e.sessionStorage.getItem(KEY)).access_token, 'access-1');
  assert.equal(e.localStorage.getItem(KEY), null);
  assert.equal(e.window.ESAuth.verifyStoredSession(makeSession()).reason, 'session');
});

await test('storage that refuses everything: login says so (storage_failed), no silent loop', async () => {
  const e = env({ localFull: true, sessionFull: true });
  await assert.rejects(e.window.ESAuth.login({ email: ES, password: TEST_PASSWORD }), error => error.code === 'storage_failed' && !error.message.includes(TEST_PASSWORD));
});

await test('a stale copy from an older session does not pass the check', async () => {
  const e = env({ signIn: () => makeSession({ token: 'new-token' }) });
  e.window.ESAuth.getSupabaseClient();
  // The SDK "saves" but the write is lost; an older token is left behind.
  e.localStorage.setItem(KEY, JSON.stringify(makeSession({ token: 'old-token' })));
  const realSet = e.localStorage.setItem;
  e.localStorage.setItem = (key, value) => (key === KEY ? undefined : realSet(key, value));
  await assert.rejects(e.window.ESAuth.login({ email: ES, password: TEST_PASSWORD }), error => error.code === 'storage_failed' && error.storage === 'stale-copy');
  assert.equal(e.window.ESAuth.recentAuthBounces().at(-1).reason, 'login-not-saved');
});

await test('stale auth keys from other projects / pre-v2 are cleared before sign-in; drafts kept', async () => {
  const e = env();
  e.localStorage.setItem('sb-otherproject-auth-token', '{"access_token":"x"}');
  e.localStorage.setItem('supabase.auth.token', '{"currentSession":{}}');
  e.localStorage.setItem('frameup.drafts.v1', '[{"id":"keep"}]');
  await e.window.ESAuth.login({ email: ES, password: TEST_PASSWORD });
  assert.equal(e.localStorage.getItem('sb-otherproject-auth-token'), null);
  assert.equal(e.localStorage.getItem('supabase.auth.token'), null);
  assert.equal(e.localStorage.getItem('frameup.drafts.v1'), '[{"id":"keep"}]');
});

await test('a clock an hour off is named as the cause', async () => {
  const e = env({ signIn: () => makeSession({ skew: 65 * 60 }) });
  await assert.rejects(e.window.ESAuth.login({ email: ES, password: TEST_PASSWORD }), error => error.code === 'clock_skew' && /ahead/.test(error.message));
});

await test('requireAuth: check keeps failing but the saved session is fine → page opens (degraded), recorded', async () => {
  const e = env({ href: 'https://frameup.essentiallysports.com/index.html', getSession: () => ({ data: { session: null }, error: new Error('lock timeout') }) });
  e.window.ESAuth.getSupabaseClient();
  e.localStorage.setItem(KEY, JSON.stringify(makeSession()));
  assert.equal(await e.window.ESAuth.requireAuth('index.html'), true);
  assert.equal(e.document.documentElement.style.visibility, '');
  assert.equal(e.location.replaceTarget, '');
  assert.equal(e.window.ESAuth.recentAuthBounces().at(-1).reason, 'check-failed-used-stored');
});

await test('requireAuth: no session seconds after a login → in-page Retry panel, not another bounce', async () => {
  const e = env({ href: 'https://frameup.essentiallysports.com/index.html', getSession: () => ({ data: { session: null }, error: null }) });
  e.sessionStorage.setItem('es.authLoginAt.v1', JSON.stringify({ at: Date.now() - 5000, skew: 0 }));
  assert.equal(await e.window.ESAuth.requireAuth('index.html'), false);
  assert.equal(e.location.replaceTarget, '');
  const panel = e.document.body.children.find(node => node.id === 'es-auth-problem');
  assert.ok(panel, 'panel shown');
  assert.equal(e.beacons.length, 1, 'reported');
  const report = await e.beacons[0].blob.text();
  assert.doesNotMatch(report, /access-1|refresh-|designer@/);
  assert.match(report, /"reason":"no-session"/);
});

await test('requireAuth: ordinary no-session still redirects with the reason and is recorded locally', async () => {
  const e = env({ href: 'https://frameup.essentiallysports.com/gallery.html', getSession: () => ({ data: { session: null }, error: null }) });
  await e.window.ESAuth.requireAuth('gallery.html');
  assert.equal(e.location.replaceTarget, 'login.html?redirect=gallery.html&reason=no-session');
  assert.equal(e.beacons.length, 0, 'a plain signed-out visit is not reported');
  assert.equal(e.window.ESAuth.recentAuthBounces().length, 1);
});

await test('loop breaker data: 3 bounces in 2 min are visible to login.html; clearing removes only sign-in keys', async () => {
  const e = env();
  ['no-session', 'check-failed', 'no-session'].forEach(reason => e.window.ESAuth.recordAuthEvent(reason));
  assert.equal(e.window.ESAuth.recentAuthBounces().length, 3);
  e.localStorage.setItem(KEY, '{}');
  e.localStorage.setItem('es.designerAuth.v1', '{}');
  e.localStorage.setItem('frameup.drafts.v1', 'keep');
  e.localStorage.setItem('es.dashboard.designs.v1', 'keep');
  e.window.ESAuth.clearSignInData();
  assert.equal(e.localStorage.getItem(KEY), null);
  assert.equal(e.localStorage.getItem('es.designerAuth.v1'), null);
  assert.equal(e.window.ESAuth.recentAuthBounces().length, 0);
  assert.equal(e.localStorage.getItem('frameup.drafts.v1'), 'keep');
  assert.equal(e.localStorage.getItem('es.dashboard.designs.v1'), 'keep');
});

await test('diagnostics: storage full, SDK source, reachability, locks', async () => {
  const e = env({ localFull: true });
  const diag = await e.window.ESAuth.authDiagnostics();
  assert.equal(diag.storageWritable, false);
  assert.equal(diag.supabaseReachable, true);
  assert.equal(diag.locks, true);
  assert.equal(diag.heldAuthLocks, 0);
  assert.equal(typeof diag.storageUsedKb, 'number');
});

await test('SDK: same-origin copy first, CDN as fallback', async () => {
  const local = env({ sdk: 'absent' });
  assert.equal(await local.window.ESAuth.ensureSupabaseReady(), true);
  assert.deepEqual(local.appended, ['https://frameup.essentiallysports.com/vendor/supabase-js-2.118.0.min.js']);
  assert.equal(local.window.ESAuth.quickDiagnostics().sdkSource, 'local');
  const fallback = env({ sdk: 'absent', scriptBehaviour: { local: 'error' } });
  assert.equal(await fallback.window.ESAuth.ensureSupabaseReady(), true);
  assert.equal(fallback.appended.length, 2);
  assert.match(fallback.appended[1], /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.118\.0/);
  assert.equal(fallback.window.ESAuth.quickDiagnostics().sdkSource, 'cdn');
});

await test('vendored SDK matches the pinned SRI hash; pages preload it', async () => {
  const sri = `sha384-${createHash('sha384').update(read('vendor/supabase-js-2.118.0.min.js')).digest('base64')}`;
  assert.match(authSource, new RegExp(sri.replace(/[+/]/g, '\\$&')));
  assert.match(loginHtml, /<link rel="preload" href="\/vendor\/supabase-js-2\.118\.0\.min\.js"/);
  assert.match(read('index.html').toString('utf8'), /href="\/vendor\/supabase-js-2\.118\.0\.min\.js"/);
});

await test('login.html wires the loop breaker', async () => {
  assert.match(loginHtml, /recentAuthBounces/);
  assert.match(loginHtml, /bounces\.length > 2/);
  assert.match(loginHtml, /clearSignInData/);
  assert.match(loginHtml, /authDiagnostics/);
  assert.match(loginHtml, /id="login-diagnose"/);
});

await test('/api/auth-bounce: whitelists fields, drops tokens and addresses, limits, stores only with the env key', async () => {
  bounce._resetLimits();
  const cleaned = bounce.cleanBounce({
    reason: 'no-session',
    page: '/index.html?token=secret#x',
    diag: { storageWritable: false, storageUsedKb: 5100.4, emailDomain: 'gmail.com', access_token: 'secret', email: 'person@example.com', sdkSource: 'evil' },
    token: 'secret',
  });
  assert.deepEqual(cleaned, { reason: 'no-session', page: '/index.html', diag: { storageWritable: false, storageUsedKb: 5100, emailDomain: 'other' } });
  assert.equal(bounce.cleanBounce({ reason: 'made-up' }).reason, 'unknown');
  const ok = await bounce.handler({ httpMethod: 'POST', headers: { 'x-forwarded-for': '1.1.1.1' }, body: JSON.stringify({ reason: 'check-failed', page: '/', diag: {} }) }, {});
  assert.equal(ok.statusCode, 202);
  assert.equal(JSON.parse(ok.body).stored, false);
  assert.equal((await bounce.handler({ httpMethod: 'POST', headers: {}, body: 'x'.repeat(3000) }, {})).statusCode, 413);
  assert.equal((await bounce.handler({ httpMethod: 'GET' }, {})).statusCode, 405);
  for (let index = 0; index < 9; index += 1) await bounce.handler({ httpMethod: 'POST', headers: { 'x-forwarded-for': '2.2.2.2' }, body: '{}' }, {});
  assert.equal((await bounce.handler({ httpMethod: 'POST', headers: { 'x-forwarded-for': '2.2.2.2' }, body: '{}' }, {})).statusCode, 202);
  assert.equal((await bounce.handler({ httpMethod: 'POST', headers: { 'x-forwarded-for': '2.2.2.2' }, body: '{}' }, {})).statusCode, 429);
  const originalFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => { sent.push({ url, init }); return { ok: true }; };
  try {
    assert.equal(await bounce.store(cleaned, 'UA', { SUPABASE_SERVICE_ROLE_KEY: 'service-test-key' }), true);
    assert.equal(await bounce.store(cleaned, 'UA', {}), true === false);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(sent.length, 1);
  const row = JSON.parse(sent[0].init.body)[0];
  assert.equal(row.user_email, 'auth-bounce (other)');
  assert.match(row.message, /^auth-bounce: no-session on \/index\.html/);
  assert.doesNotMatch(sent[0].init.body, /secret|person@/);
});

console.log(`Login-loop tests passed (${passed.length}).`);
