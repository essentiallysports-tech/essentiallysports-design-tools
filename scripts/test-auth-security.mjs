#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const authSource = readFileSync(new URL('../es-auth.js', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../dashboard-data.js', import.meta.url), 'utf8');
const dashboardHtmlSource = readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8');
const loginHtmlSource = readFileSync(new URL('../login.html', import.meta.url), 'utf8');
const authCallbackHtmlSource = readFileSync(new URL('../auth-callback.html', import.meta.url), 'utf8');
const resetPasswordHtmlSource = readFileSync(new URL('../reset-password.html', import.meta.url), 'utf8');
const profileHtmlSource = readFileSync(new URL('../ai-page/profile.html', import.meta.url), 'utf8');
const netlifyConfigSource = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
const supabaseSignupHookMigration = readFileSync(new URL('../supabase/migrations/20260706162500_restrict_signup_to_es_domain.sql', import.meta.url), 'utf8');
const deleteOwnAccountMigration = readFileSync(new URL('../supabase/migrations/20260714173000_delete_own_frameup_account.sql', import.meta.url), 'utf8');

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
  locationHref = 'https://frameup.essentiallysports.com/index.html',
} = {}) {
  const localStorage = storage();
  const sessionStorage = storage();
  const authCalls = {
    exchangeCode: null,
    resendOptions: null,
    resetPasswordRedirectTo: null,
    signUpOptions: null,
    setSession: null,
    verifyOtp: null,
    rpc: null,
  };
  const documentElement = {
    style: {},
    classList: { toggle() {} },
  };
  const parsedLocation = new URL(locationHref);
  const location = {
    href: parsedLocation.href,
    origin: parsedLocation.origin,
    hostname: parsedLocation.hostname,
    pathname: parsedLocation.pathname,
    search: parsedLocation.search,
    hash: parsedLocation.hash,
    replaceTarget: '',
    replace(value) {
      this.replaceTarget = value;
    },
  };
  const client = {
    async rpc(name, payload) {
      authCalls.rpc = { name, payload: payload || null };
      return { data: true, error: null };
    },
    auth: {
      async getSession() {
        return { data: { session } };
      },
      async signInWithPassword() {
        if (signInError) return { data: null, error: signInError };
        return { data: { session, user: session?.user || null }, error: null };
      },
      async signUp() {
        authCalls.signUpOptions = arguments[0]?.options || null;
        if (signUpError) return { data: null, error: signUpError };
        return { data: { session: null, user: null }, error: null };
      },
      async resend() {
        authCalls.resendOptions = arguments[0] || null;
        return { data: {}, error: null };
      },
      async exchangeCodeForSession(code) {
        authCalls.exchangeCode = code;
        return { data: { session }, error: null };
      },
      async verifyOtp(payload) {
        authCalls.verifyOtp = payload;
        return { data: { session }, error: null };
      },
      async setSession(payload) {
        authCalls.setSession = payload;
        return { data: { session }, error: null };
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
  const { window } = createEnvironment({
    signUpError: { message: 'Email address not authorized' },
  });
  await assert.rejects(
    window.ESAuth.createAccount({
      name: '',
      email: 'designer@essentiallysports.com',
      password: 'password123',
    }),
    /contact suhail\.quraishi@essentiallysports\.com/i,
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
assert.match(dashboardHtmlSource, /const\s+hasValidSession\s*=\s*await\s+withBootTimeout\(\s*window\.ESAuth\?\.isValidSession\?\.\(\),/);
assert.match(dashboardHtmlSource, /if\s*\(!hasValidSession\)\s*\{[\s\S]*?loginUrl\?\.\('dashboard\.html'\)/);
assert.match(dashboardHtmlSource, /showDashboardBootError\(error\);/);
assert.doesNotMatch(loginHtmlSource, /id="login-name"|name="name"/);
assert.doesNotMatch(loginHtmlSource, /login-confirm-password|confirmPassword/);
assert.doesNotMatch(loginHtmlSource, /authMode\s*===\s*'create'\s*&&\s*!name/);
assert.match(loginHtmlSource, /id="login-confirmation"/);
assert.match(loginHtmlSource, /ESAuth\.resendConfirmation/);
assert.match(authCallbackHtmlSource, /ESAuth\.completeAuthCallback/);
assert.match(authCallbackHtmlSource, /Email confirmed/);
assert.match(authCallbackHtmlSource, /target\.origin\s*!==\s*window\.location\.origin/);
assert.match(authCallbackHtmlSource, /window\.location\.replace\(redirectTarget\)/);
assert.match(authCallbackHtmlSource, /result\?\.requiresLogin/);
assert.match(loginHtmlSource, /confirmation'\)\s*===\s*'success'/);
assert.match(resetPasswordHtmlSource, /ESAuth\?\.completeAuthCallback/);
assert.match(resetPasswordHtmlSource, /Request a new password reset link from the FrameUp login page\./);
assert.match(resetPasswordHtmlSource, /normalizedMessage\.includes\('confirmation link'\)/);
assert.match(profileHtmlSource, /id="open-delete-account"/);
assert.match(profileHtmlSource, /id="delete-account-confirmation"/);
assert.match(profileHtmlSource, /ESAuth\.deleteAccount/);
assert.match(loginHtmlSource, /account'\)\s*===\s*'deleted'/);
assert.match(deleteOwnAccountMigration, /security definer/i);
assert.match(deleteOwnAccountMigration, /requester_id uuid := auth\.uid\(\)/i);
assert.match(deleteOwnAccountMigration, /delete from auth\.users[\s\S]*?where id = requester_id/i);
assert.match(deleteOwnAccountMigration, /grant execute on function public\.delete_own_frameup_account\(\) to authenticated/i);
assert.doesNotMatch(deleteOwnAccountMigration, /grant execute[\s\S]*?\bto anon\b/i);
assert.match(netlifyConfigSource, /for\s*=\s*"\/\*\.woff2"[\s\S]*?Cache-Control\s*=\s*"public, max-age=31536000, immutable"/);

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
  assert.equal(
    window.ESAuth.authCallbackUrl(),
    'https://frameup.essentiallysports.com/auth-callback.html',
  );
  assert.equal(
    window.ESAuth.authCallbackUrl('dashboard.html?view=board'),
    'https://frameup.essentiallysports.com/auth-callback.html?redirect=dashboard.html%3Fview%3Dboard',
  );
  assert.equal(
    window.ESAuth.authCallbackUrl('https://malicious.example/steal'),
    'https://frameup.essentiallysports.com/auth-callback.html',
  );
  await window.ESAuth.createAccount({
    name: '',
    email: 'designer@essentiallysports.com',
    password: 'password123',
    redirectTo: 'dashboard.html',
  });
  assert.equal(
    authCalls.signUpOptions.emailRedirectTo,
    'https://frameup.essentiallysports.com/auth-callback.html?redirect=dashboard.html',
  );
}

{
  const { authCalls, window } = createEnvironment();
  await window.ESAuth.resendConfirmation({
    email: 'designer@essentiallysports.com',
    redirectTo: 'design-request.html',
  });
  assert.equal(authCalls.resendOptions.type, 'signup');
  assert.equal(
    authCalls.resendOptions.options.emailRedirectTo,
    'https://frameup.essentiallysports.com/auth-callback.html?redirect=design-request.html',
  );
}

{
  const session = {
    access_token: 'confirmed-token',
    user: {
      email: 'designer@essentiallysports.com',
      user_metadata: { name: 'ES Designer', role: 'Designer' },
    },
  };
  const { authCalls, window } = createEnvironment({
    session,
    locationHref: 'https://frameup.essentiallysports.com/auth-callback.html?code=confirmation-code',
  });
  const confirmedSession = await window.ESAuth.completeAuthCallback();
  assert.equal(authCalls.exchangeCode, 'confirmation-code');
  assert.equal(confirmedSession.user.email, 'designer@essentiallysports.com');
}

{
  const session = {
    access_token: 'confirmed-token',
    user: {
      email: 'designer@essentiallysports.com',
      user_metadata: { name: 'ES Designer', role: 'Designer' },
    },
  };
  const { authCalls, window } = createEnvironment({
    session,
    locationHref: 'https://frameup.essentiallysports.com/auth-callback.html?token_hash=confirmation-token&type=unexpected',
  });
  await window.ESAuth.completeAuthCallback();
  assert.equal(authCalls.verifyOtp.token_hash, 'confirmation-token');
  assert.equal(authCalls.verifyOtp.type, 'signup');
}

{
  const session = {
    access_token: 'confirmed-token',
    user: {
      email: 'designer@essentiallysports.com',
      user_metadata: { name: 'ES Designer', role: 'Designer' },
    },
  };
  const { authCalls, window } = createEnvironment({
    session,
    locationHref: 'https://frameup.essentiallysports.com/auth-callback.html#access_token=confirmed-token&refresh_token=refresh-token&type=signup',
  });
  const confirmedSession = await window.ESAuth.completeAuthCallback();
  assert.equal(authCalls.setSession.access_token, 'confirmed-token');
  assert.equal(authCalls.setSession.refresh_token, 'refresh-token');
  assert.equal(confirmedSession.user.email, 'designer@essentiallysports.com');
}

{
  const { window } = createEnvironment({
    session: null,
    locationHref: 'https://frameup.essentiallysports.com/auth-callback.html?code=confirmation-code',
  });
  const confirmationResult = await window.ESAuth.completeAuthCallback();
  assert.equal(confirmationResult.requiresLogin, true);
  assert.equal(confirmationResult.callbackType, 'signup');
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
    access_token: 'delete-account-token',
    user: {
      email: 'designer@essentiallysports.com',
      user_metadata: { name: 'ES Designer', role: 'Designer' },
    },
  };
  const { authCalls, localStorage, sessionStorage, window } = createEnvironment({ session });
  localStorage.setItem('es.ai.profile', JSON.stringify({ email: session.user.email, name: 'ES Designer' }));
  localStorage.setItem('es.authKnownEmails.v1', JSON.stringify([session.user.email, 'other@essentiallysports.com']));
  sessionStorage.setItem('es.designerAuth.v1', JSON.stringify({ token: session.access_token }));

  await assert.rejects(
    window.ESAuth.deleteAccount({ confirmationEmail: 'other@essentiallysports.com' }),
    /signed-in ES email exactly/i,
  );
  assert.equal(authCalls.rpc, null, 'mismatched confirmation must not call the deletion RPC');

  assert.equal(await window.ESAuth.deleteAccount({ confirmationEmail: session.user.email }), true);
  assert.equal(authCalls.rpc.name, 'delete_own_frameup_account');
  assert.equal(localStorage.getItem('es.ai.profile'), null);
  assert.deepEqual(JSON.parse(localStorage.getItem('es.authKnownEmails.v1')), ['other@essentiallysports.com']);
  assert.equal(sessionStorage.getItem('es.designerAuth.v1'), null);
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
