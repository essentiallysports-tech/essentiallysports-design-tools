#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const authSource = readFileSync(new URL('../es-auth.js', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../dashboard-data.js', import.meta.url), 'utf8');
const supabaseSignupHookMigration = readFileSync(new URL('../supabase/migrations/20260706162500_restrict_signup_to_es_domain.sql', import.meta.url), 'utf8');

function storage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function createAdminNavElement() {
  const classes = new Set();
  return {
    hidden: true,
    attributes: {},
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
}

function createEnvironment({
  session = null,
  supabaseAvailable = true,
  adminElements = [],
  signInError = null,
  signUpError = null,
} = {}) {
  const localStorage = storage();
  const sessionStorage = storage();
  const authCalls = {
    resetPasswordRedirectTo: null,
  };
  const documentElement = {
    style: {},
    classList: { toggle() {} },
  };
  const location = {
    href: 'https://frameup.essentiallysports.com/index.html',
    origin: 'https://frameup.essentiallysports.com',
    hostname: 'frameup.essentiallysports.com',
    pathname: '/index.html',
    search: '',
    hash: '',
    replaceTarget: '',
    replace(value) {
      this.replaceTarget = value;
    },
  };
  const client = {
    auth: {
      async getSession() {
        return { data: { session } };
      },
      async signInWithPassword() {
        if (signInError) return { data: null, error: signInError };
        return { data: { session, user: session?.user || null }, error: null };
      },
      async signUp() {
        if (signUpError) return { data: null, error: signUpError };
        return { data: { session: null, user: null }, error: null };
      },
      async signOut() {
        session = null;
        return { error: null };
      },
      async resetPasswordForEmail() {
        authCalls.resetPasswordRedirectTo = arguments[1]?.redirectTo || null;
        return { error: null };
      },
      async updateUser() {
        return { data: { user: session?.user || null }, error: null };
      },
    },
  };

  const window = {
    ES_AUTH_CONFIG: {
      supabase: {
        url: 'https://xtdusejokbhtjlmijdca.supabase.co',
        anonKey: 'public-test-key',
      },
      allowedDomains: ['essentiallysports.com'],
      allowedEmails: [],
    },
    crypto: webcrypto,
    localStorage,
    sessionStorage,
    location,
    supabase: supabaseAvailable ? { createClient: () => client } : undefined,
    dispatchEvent() {},
    addEventListener() {},
    setTimeout() {},
  };

  const context = vm.createContext({
    window,
    document: {
      documentElement,
      readyState: 'complete',
      querySelectorAll: selector => (selector === '[data-admin-only]' ? adminElements : []),
      addEventListener() {},
    },
    TextEncoder,
    Uint8Array,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    URL,
    URLSearchParams,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Boolean,
    Map,
    Set,
    Promise,
  });

  vm.runInContext(authSource, context, { filename: 'es-auth.js' });
  return { authCalls, context, window, location, documentElement, localStorage, sessionStorage };
}

{
  const { window, sessionStorage } = createEnvironment({ supabaseAvailable: false });
  sessionStorage.setItem('es.designerAuth.v1', JSON.stringify({
    token: 'fabricated-local-token',
    user: { email: 'suhail.quraishi@essentiallysports.com' },
  }));

  assert.equal(
    window.ESAuth.isLocalFallbackEnabled,
    undefined,
    'browser-local auth fallback must not be exposed',
  );
  assert.equal(await window.ESAuth.getSession(), null);
  assert.equal(await window.ESAuth.isValidSession(), false);
  await assert.rejects(
    window.ESAuth.login({
      email: 'suhail.quraishi@essentiallysports.com',
      password: 'password123',
    }),
    /temporarily unavailable/i,
  );
}

{
  const { window } = createEnvironment({
    signInError: { message: 'Invalid login credentials' },
  });
  await assert.rejects(
    window.ESAuth.login({
      email: 'suhail.quraishi@essentiallysports.com',
      password: 'wrong-password',
    }),
    /create an account first/i,
  );
}

{
  const { window } = createEnvironment({
    signInError: { message: 'Email not confirmed' },
  });
  await assert.rejects(
    window.ESAuth.login({
      email: 'suhail.quraishi@essentiallysports.com',
      password: 'password123',
    }),
    /verify your ES email/i,
  );
}

{
  const { documentElement, location, window } = createEnvironment({ session: null });
  assert.equal(documentElement.style.visibility, undefined);
  await window.ESAuth.requireAuth('dashboard.html');
  assert.match(location.replaceTarget, /^login\.html\?redirect=dashboard\.html$/);
  assert.equal(documentElement.style.visibility, 'hidden');
}

assert.match(supabaseSignupHookMigration, /signup_domain\s+<>\s+'essentiallysports\.com'/i);
assert.match(supabaseSignupHookMigration, /return\s+event\s*;/i);
assert.doesNotMatch(supabaseSignupHookMigration, /return\s+'\{\}'::jsonb\s*;/i);

{
  const session = {
    access_token: 'verified-token',
    user: {
      email: 'suhail.quraishi@essentiallysports.com',
      created_at: '2026-07-06T00:00:00.000Z',
      user_metadata: { name: 'Suhail Quraishi', role: 'Designer' },
    },
  };
  const { context, window, documentElement } = createEnvironment({ session });
  vm.runInContext(dashboardSource, context, { filename: 'dashboard-data.js' });

  assert.equal(await window.ESAuth.isValidSession(), true);
  assert.equal(await window.ESDashboardData.isCurrentUserAdmin(), true);
  await window.ESAuth.requireAuth('index.html');
  assert.equal(documentElement.style.visibility, '');
}

{
  const { authCalls, window } = createEnvironment();
  await window.ESAuth.requestPasswordReset({
    email: 'suhail.quraishi@essentiallysports.com',
    redirectTo: 'https://evil.example/reset-password.html',
  });
  assert.equal(authCalls.resetPasswordRedirectTo, 'https://frameup.essentiallysports.com/reset-password.html');
}

{
  const session = {
    access_token: 'verified-token',
    user: {
      email: 'manish.kalsi@essentiallysports.com',
      user_metadata: { name: 'Manish Kalsi', role: 'Designer' },
    },
  };
  const { context, window } = createEnvironment({ session });
  vm.runInContext(dashboardSource, context, { filename: 'dashboard-data.js' });
  assert.equal(await window.ESDashboardData.isCurrentUserAdmin(), true);
}

{
  const adminElement = createAdminNavElement();
  const session = {
    access_token: 'verified-token',
    user: {
      email: 'suhail.quraishi@essentiallysports.com',
      user_metadata: { name: 'Suhail Quraishi', role: 'Designer' },
    },
  };
  const { context, window } = createEnvironment({ session, adminElements: [adminElement] });
  vm.runInContext(dashboardSource, context, { filename: 'dashboard-data.js' });
  assert.equal(await window.ESDashboardData.showAdminNavigation(), true);
  assert.equal(adminElement.hidden, false);
  assert.equal(adminElement.attributes['aria-hidden'], 'false');
  assert.equal(adminElement.classList.contains('is-admin-visible'), true);
}

{
  const session = {
    access_token: 'verified-token',
    user: {
      email: 'designer@essentiallysports.com',
      user_metadata: { name: 'ES Designer', role: 'Designer' },
    },
  };
  const { context, window } = createEnvironment({ session });
  vm.runInContext(dashboardSource, context, { filename: 'dashboard-data.js' });
  assert.equal(await window.ESDashboardData.isCurrentUserAdmin(), false);
}

{
  const adminElement = createAdminNavElement();
  const session = {
    access_token: 'verified-token',
    user: {
      email: 'designer@essentiallysports.com',
      user_metadata: { name: 'ES Designer', role: 'Designer' },
    },
  };
  const { context, window } = createEnvironment({ session, adminElements: [adminElement] });
  vm.runInContext(dashboardSource, context, { filename: 'dashboard-data.js' });
  assert.equal(await window.ESDashboardData.showAdminNavigation(), false);
  assert.equal(adminElement.hidden, true);
  assert.equal(adminElement.attributes['aria-hidden'], 'true');
  assert.equal(adminElement.classList.contains('is-admin-visible'), false);
}

{
  const session = {
    access_token: 'verified-token',
    user: {
      email: 'designer@essentiallysports.com',
      user_metadata: { name: 'ES Designer', role: 'Designer' },
    },
  };
  const { context, localStorage, window } = createEnvironment({ session });
  localStorage.setItem('es.dashboard.adminConfig.v1', JSON.stringify({
    adminEmails: ['designer@essentiallysports.com', 'someone@gmail.com'],
    ownerEmails: ['designer@essentiallysports.com'],
  }));
  vm.runInContext(dashboardSource, context, { filename: 'dashboard-data.js' });
  assert.deepEqual(Array.from(window.ESDashboardData.getAdminConfig().adminEmails), [
    'suhail.quraishi@essentiallysports.com',
    'manish.kalsi@essentiallysports.com',
  ]);
  assert.equal(await window.ESDashboardData.isCurrentUserAdmin(), false);
}

console.log('Authentication and dashboard authorization regression tests passed.');
