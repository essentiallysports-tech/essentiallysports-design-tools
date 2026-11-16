#!/usr/bin/env node
// Login guard (es-auth): nobody is signed out because a check failed, and
// every trip back to the login page says why.
//   valid session          → page shows
//   no saved session       → login.html?…&reason=no-session (no sign-out needed)
//   approval lookup failed → login.html?…&reason=check-failed, NOT signed out
//   definitely not approved→ signed out, login.html?…&reason=not-approved
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const authSource = readFileSync(new URL('../es-auth.js', import.meta.url), 'utf8');

function setup({ email = 'designer@essentiallysports.com', hasSession = true, rpc = 'true', table = 'ok-none' } = {}) {
  const calls = { signOut: 0 };
  let session = hasSession ? { access_token: 'token-1', user: { email, user_metadata: {} } } : null;
  const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i] ?? null, get length() { return m.size; } }; };
  const chain = {
    select() { return chain; }, eq() { return chain; },
    async maybeSingle() {
      if (table === 'error') return { data: null, error: { message: 'down' } };
      if (table === 'approved') return { data: { email, status: 'Approved' }, error: null };
      return { data: null, error: null };
    },
  };
  const client = {
    async rpc() {
      if (rpc === 'error') return { data: null, error: { message: 'rpc down' } };
      return { data: rpc === 'true', error: null };
    },
    from() { return chain; },
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      async signOut() { calls.signOut += 1; session = null; return { error: null }; },
    },
  };
  const location = { href: 'https://frameup.essentiallysports.com/dashboard.html', origin: 'https://frameup.essentiallysports.com', hostname: 'frameup.essentiallysports.com', pathname: '/dashboard.html', search: '', hash: '', replaceTarget: '', replace(v) { this.replaceTarget = v; } };
  const documentElement = { style: {}, classList: { toggle() {} } };
  const window = {
    ES_AUTH_CONFIG: { supabase: { url: 'https://example.supabase.co', anonKey: 'k' }, allowedDomains: ['essentiallysports.com'], allowedEmails: [] },
    localStorage: store(), sessionStorage: store(), location,
    supabase: { createClient: () => client },
    dispatchEvent() {}, addEventListener() {}, setTimeout, clearTimeout,
  };
  const context = vm.createContext({
    window, document: { documentElement, readyState: 'complete', querySelectorAll: () => [], addEventListener() {} },
    CustomEvent: class { constructor(type) { this.type = type; } },
    URL, URLSearchParams, Date, Math, JSON, Object, Array, String, Boolean, Map, Set, Promise, setTimeout, clearTimeout,
  });
  vm.runInContext(authSource, context, { filename: 'es-auth' });
  return { window, location, documentElement, calls };
}

// 1. ES email with a session: the page shows.
{
  const env = setup();
  assert.equal(await env.window.ESAuth.sessionStatus(), 'valid');
  assert.equal(await env.window.ESAuth.requireAuth('dashboard.html'), true);
  assert.equal(env.location.replaceTarget, '');
  assert.equal(env.documentElement.style.visibility, '');
}

// 2. No saved session: back to login with a reason, nothing to sign out.
{
  const env = setup({ hasSession: false });
  assert.equal(await env.window.ESAuth.sessionStatus(), 'no-session');
  await env.window.ESAuth.requireAuth('dashboard.html');
  assert.equal(env.location.replaceTarget, 'login.html?redirect=dashboard.html&reason=no-session');
  assert.equal(env.calls.signOut, 0);
}

// 3. Individually approved (non-ES) email, both approval lookups fail: never
//    signed out; the login page explains the check failed.
{
  const env = setup({ email: 'guest@gmail.com', rpc: 'error', table: 'error' });
  await assert.rejects(env.window.ESAuth.sessionStatus(), /approval check/i);
  await env.window.ESAuth.requireAuth('dashboard.html');
  assert.equal(env.location.replaceTarget, 'login.html?redirect=dashboard.html&reason=check-failed');
  assert.equal(env.calls.signOut, 0, 'a failed check must not sign anyone out');
}

// 4. Non-ES email whose approval RPC fails but the table says approved: valid.
{
  const env = setup({ email: 'guest@gmail.com', rpc: 'error', table: 'approved' });
  assert.equal(await env.window.ESAuth.sessionStatus(), 'valid');
}

// 5. Definitely not approved: signed out, with the reason.
{
  const env = setup({ email: 'guest@gmail.com', rpc: 'false' });
  assert.equal(await env.window.ESAuth.sessionStatus(), 'not-approved');
  await env.window.ESAuth.requireAuth('dashboard.html');
  assert.equal(env.location.replaceTarget, 'login.html?redirect=dashboard.html&reason=not-approved');
  assert.equal(env.calls.signOut, 1);
}

// 6. The login page double-checks the session before leaving and explains
//    every reason instead of bouncing.
{
  const login = readFileSync(new URL('../login.html', import.meta.url), 'utf8');
  assert.match(login, /ESAuth\.sessionStatus\?\.\(\)/);
  assert.match(login, /if \(!reason && await window\.ESAuth\?\.isValidSession\?\.\(\)\)/);
  assert.match(login, /reason === 'not-approved'/);
  assert.match(login, /status === 'no-session'/);
}

console.log('Auth session-status tests passed.');
