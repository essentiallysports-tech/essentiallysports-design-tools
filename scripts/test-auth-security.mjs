#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const authSource = readFileSync(new URL('../es-auth.js', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../dashboard-data.js', import.meta.url), 'utf8');

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

function createEnvironment({ session = null, supabaseAvailable = true } = {}) {
  const localStorage = storage();
  const sessionStorage = storage();
  const documentElement = {
    style: {},
    classList: { toggle() {} },
  };
  const location = {
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
        return { data: { session, user: session?.user || null }, error: null };
      },
      async signUp() {
        return { data: { session: null, user: null }, error: null };
      },
      async signOut() {
        session = null;
        return { error: null };
      },
      async resetPasswordForEmail() {
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
      allowLocalFallback: false,
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
      querySelectorAll: () => [],
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
  return { context, window, location, documentElement, sessionStorage };
}

{
  const { window, sessionStorage } = createEnvironment({ supabaseAvailable: false });
  sessionStorage.setItem('es.designerAuth.v1', JSON.stringify({
    token: 'fabricated-local-token',
    user: { email: 'suhail.quraishi@essentiallysports.com' },
  }));

  assert.equal(window.ESAuth.isLocalFallbackEnabled(), false);
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

console.log('Authentication and dashboard authorization regression tests passed.');
