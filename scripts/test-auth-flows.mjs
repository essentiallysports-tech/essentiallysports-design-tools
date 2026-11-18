#!/usr/bin/env node
// Auth flows (sign-up, repeated sign-up, resend + cooldown, magic link,
// expired links, reset, session expiry, profile merge) and the People/roles
// admin (guards, statuses, RPC fallbacks, migration static checks).
// Supabase is a mock: no network, no real emails, no real passwords.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const authSource = read('es-auth.js');
const dashboardSource = read('dashboard-data.js');
const Flow = require('../auth-flow.js');
const People = require('../dashboard-people.js');
const migration = read('supabase/migrations/20261120120000_people_roles_admin.sql');
const loginHtml = read('login.html');
const callbackHtml = read('auth-callback.html');
const resetHtml = read('reset-password.html');
const dashboardHtml = read('dashboard.html');

const TEST_PASSWORD = ['test', 'only', 'pw', '42'].join('-'); // not a real password

function storage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function env({ session = null, href = 'https://frameup.essentiallysports.com/index.html', auth = {}, rpc = {} } = {}) {
  const calls = [];
  const localStorage = storage();
  const sessionStorage = storage();
  const url = new URL(href);
  const location = {
    href: url.href, origin: url.origin, hostname: url.hostname, pathname: url.pathname,
    search: url.search, hash: url.hash, replaceTarget: '',
    replace(value) { this.replaceTarget = value; },
  };
  let current = session;
  const answer = async (name, payload, fallback) => {
    calls.push({ name, payload });
    return auth[name] ? auth[name](payload) : fallback;
  };
  const client = {
    async rpc(name, payload) {
      calls.push({ name: `rpc:${name}`, payload });
      if (rpc[name]) return rpc[name](payload);
      if (name === 'is_es_designer_email_approved') return { data: true, error: null };
      return { data: false, error: null };
    },
    from(table) {
      const builder = {
        select() { return builder; }, order() { return builder; }, limit() { return builder; },
        eq() { return builder; }, maybeSingle() { return builder; },
        then(resolve) { resolve(rpc[`table:${table}`] ? rpc[`table:${table}`]() : { data: [], error: null }); },
      };
      return builder;
    },
    auth: {
      getSession: async () => ({ data: { session: current }, error: null }),
      signUp: payload => answer('signUp', payload, { data: { user: { identities: [{ id: '1' }] }, session: null }, error: null }),
      signInWithPassword: payload => answer('signInWithPassword', payload, { data: { session: current, user: current?.user }, error: null }),
      signInWithOtp: payload => answer('signInWithOtp', payload, { data: {}, error: null }),
      resend: payload => answer('resend', payload, { data: {}, error: null }),
      resetPasswordForEmail: (email, options) => answer('resetPasswordForEmail', { email, options }, { data: {}, error: null }),
      exchangeCodeForSession: code => answer('exchangeCodeForSession', code, { data: { session: current }, error: null }),
      verifyOtp: payload => answer('verifyOtp', payload, { data: { session: current }, error: null }),
      setSession: payload => answer('setSession', payload, { data: { session: current }, error: null }),
      updateUser: payload => answer('updateUser', payload, { data: { user: current?.user }, error: null }),
      signOut: async () => { current = null; return { error: null }; },
    },
  };
  const window = {
    ES_AUTH_CONFIG: { supabase: { url: 'https://example.supabase.co', anonKey: 'public-test-key' }, allowedDomains: ['essentiallysports.com'], allowedEmails: [] },
    localStorage, sessionStorage, location,
    supabase: { createClient: () => client },
    dispatchEvent() {}, addEventListener() {},
    setTimeout(fn, ms) { return 0; }, clearTimeout() {},
  };
  const context = vm.createContext({
    window,
    document: { documentElement: { style: {}, classList: { toggle() {} } }, readyState: 'complete', querySelectorAll: () => [], addEventListener() {}, body: { dataset: {} } },
    TextEncoder, URL, URLSearchParams, Date, Math, JSON, Object, Array, String, Boolean, Number, Map, Set, Promise, Headers: globalThis.Headers,
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  });
  vm.runInContext(authSource, context, { filename: 'es-auth.js' });
  return { window, context, calls, location, localStorage, sessionStorage };
}

const ES = 'designer@essentiallysports.com';
const results = [];
async function test(name, fn) {
  await fn();
  results.push(name);
}

// --- Sign-up ----------------------------------------------------------------

await test('repeated sign-up of a confirmed account is detected (identities: [])', async () => {
  const { window, calls } = env({ auth: { signUp: () => ({ data: { user: { id: 'obfuscated', identities: [] }, session: null }, error: null }) } });
  await assert.rejects(
    window.ESAuth.createAccount({ email: ES, password: TEST_PASSWORD }),
    error => error.code === 'account_exists' && /already have a FrameUp account/.test(error.message),
  );
  assert.equal(calls.filter(call => call.name === 'signUp').length, 1);
  assert.equal(window.ESAuth.emailCooldownRemaining(ES), 0, 'no email was sent, so no cooldown');
});

await test('new sign-up starts a 60 s cooldown and asks for confirmation', async () => {
  const { window } = env();
  const account = await window.ESAuth.createAccount({ email: ES, password: TEST_PASSWORD });
  assert.equal(account.requiresEmailConfirmation, true);
  assert.ok(account.cooldownSeconds > 50 && account.cooldownSeconds <= 60);
});

await test('sign-up checks the domain before calling Supabase sign-up', async () => {
  const { window, calls } = env({ rpc: { is_es_designer_email_approved: () => ({ data: false, error: null }), upsert_es_designer_access_request: () => ({ data: null, error: null }) } });
  await assert.rejects(window.ESAuth.createAccount({ email: 'someone@example.com', password: TEST_PASSWORD }), error => error.code === 'access_requested');
  assert.equal(calls.some(call => call.name === 'signUp'), false);
});

await test('password rules: min 8, max 72 bytes, no edge spaces; never echoed', async () => {
  const { window } = env();
  await assert.rejects(window.ESAuth.createAccount({ email: ES, password: 'short' }), error => error.code === 'weak_password' && !error.message.includes('short'));
  await assert.rejects(window.ESAuth.createAccount({ email: ES, password: 'x'.repeat(73) }), /72 characters/);
  await assert.rejects(window.ESAuth.createAccount({ email: ES, password: ` ${TEST_PASSWORD}` }), /start or end with a space/);
  assert.deepEqual({ ...window.ESAuth.passwordChecks(TEST_PASSWORD) }, { minLength: true, maxLength: true, noEdgeSpaces: true });
});

// --- Resend + rate limits -----------------------------------------------------

await test('resend honours the cooldown without calling Supabase again', async () => {
  const { window, calls } = env();
  await window.ESAuth.resendConfirmation({ email: ES });
  await assert.rejects(window.ESAuth.resendConfirmation({ email: ES }), error => error.code === 'email_rate_limited' && error.retryAfterSeconds > 0);
  assert.equal(calls.filter(call => call.name === 'resend').length, 1);
});

await test('Supabase per-address limit ("after 37 seconds") becomes a 37 s cooldown', async () => {
  const { window } = env({ auth: { resend: () => ({ error: { message: 'For security purposes, you can only request this after 37 seconds.', status: 429, code: 'over_email_send_rate_limit' } }) } });
  await assert.rejects(window.ESAuth.resendConfirmation({ email: ES }), error => error.code === 'email_rate_limited' && error.retryAfterSeconds === 37);
  const remaining = window.ESAuth.emailCooldownRemaining(ES);
  assert.ok(remaining > 30 && remaining <= 37);
});

await test('project-wide email limit gives an honest message', async () => {
  const { window } = env({ auth: { resend: () => ({ error: { message: 'email rate limit exceeded', status: 429, code: 'over_email_send_rate_limit' } }) } });
  await assert.rejects(window.ESAuth.resendConfirmation({ email: ES }), error => /few emails per hour/.test(error.message) && /admin can confirm|admin to confirm/.test(error.message));
});

// --- Login --------------------------------------------------------------------

await test('unconfirmed login → email_not_confirmed (page offers Resend)', async () => {
  const { window } = env({ auth: { signInWithPassword: () => ({ data: null, error: { message: 'Email not confirmed', code: 'email_not_confirmed', status: 400 } }) } });
  await assert.rejects(window.ESAuth.login({ email: ES, password: TEST_PASSWORD }), error => error.code === 'email_not_confirmed');
  assert.deepEqual(Flow.outcomeForError({ code: 'email_not_confirmed', message: 'x' }).actions, ['resend']);
});

await test('wrong password → invalid_credentials with reset + magic link offered', async () => {
  const { window } = env({ auth: { signInWithPassword: () => ({ data: null, error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 } }) } });
  const error = await window.ESAuth.login({ email: ES, password: TEST_PASSWORD }).catch(err => err);
  assert.equal(error.code, 'invalid_credentials');
  assert.ok(!error.message.includes(TEST_PASSWORD));
  assert.deepEqual(Flow.outcomeForError(error, { mode: 'login' }).actions, ['reset', 'magic']);
});

await test('friendly mapping covers the Supabase error codes', async () => {
  const { window } = env();
  const map = (error) => window.ESAuth.friendlyAuthError(error).code;
  assert.equal(map({ code: 'user_already_exists', message: 'User already registered' }), 'account_exists');
  assert.equal(map({ code: 'same_password', message: 'x' }), 'same_password');
  assert.equal(map({ code: 'otp_expired', message: 'Email link is invalid or has expired' }), 'link_expired');
  assert.equal(map({ code: 'flow_state_expired', message: 'x' }), 'link_other_browser');
  assert.equal(map({ code: 'over_request_rate_limit', message: 'x', status: 429 }), 'rate_limited');
  assert.equal(map({ code: 'user_banned', message: 'x' }), 'user_banned');
  assert.equal(map({ code: 'signup_disabled', message: 'Signups not allowed for this instance' }), 'signup_disabled');
  assert.equal(map({ message: 'This email needs ES Designer admin approval before signup.' }), 'signup_blocked');
  assert.equal(map({ code: 'refresh_token_not_found', message: 'Invalid Refresh Token' }), 'session_expired');
  assert.equal(map({ message: 'Failed to fetch' }), 'network');
  assert.equal(map({ code: 'unexpected_failure', message: 'x', status: 500 }), 'service_unavailable');
  assert.equal(map({ code: 'email_address_not_authorized', message: 'Email address not authorized' }), 'email_not_authorized');
});

// --- Magic link ---------------------------------------------------------------

await test('magic link never creates accounts and hides whether one exists', async () => {
  const { window, calls } = env({ auth: { signInWithOtp: () => ({ data: null, error: { message: 'Signups not allowed for otp', code: 'otp_disabled', status: 422 } }) } });
  assert.equal(await window.ESAuth.requestMagicLink({ email: ES, redirectTo: 'gallery.html' }), true);
  const call = calls.find(item => item.name === 'signInWithOtp');
  assert.equal(call.payload.options.shouldCreateUser, false);
  assert.equal(call.payload.options.emailRedirectTo, 'https://frameup.essentiallysports.com/auth-callback.html?redirect=gallery.html');
});

// --- Callback / reset -----------------------------------------------------------

await test('expired confirmation link (#error_code=otp_expired) → link_expired', async () => {
  const { window } = env({ href: 'https://frameup.essentiallysports.com/auth-callback.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired' });
  await assert.rejects(window.ESAuth.completeAuthCallback(), error => error.code === 'link_expired');
});

await test('callback reports the link type (magiclink) from the URL at load time', async () => {
  const session = { access_token: 't', refresh_token: 'r', user: { email: ES, user_metadata: {} } };
  const { window, location } = env({ session, href: 'https://frameup.essentiallysports.com/auth-callback.html#access_token=t&refresh_token=r&type=magiclink' });
  location.href = 'https://frameup.essentiallysports.com/auth-callback.html'; // SDK tidied the bar
  location.hash = '';
  const result = await window.ESAuth.completeAuthCallback();
  assert.equal(result.callbackType, 'magiclink');
  assert.equal(Flow.callbackSuccessCopy('magiclink').title, 'You’re signed in');
  assert.equal(Flow.callbackSuccessCopy('invite').next, 'password');
  assert.equal(Flow.callbackSuccessCopy('signup', { requiresLogin: true }).next, 'login');
});

await test('password reset keeps the redirect allowlist and starts a cooldown', async () => {
  const { window, calls } = env();
  await window.ESAuth.requestPasswordReset({ email: ES, redirectTo: 'https://evil.example/reset-password.html' });
  assert.equal(calls.find(call => call.name === 'resetPasswordForEmail').payload.options.redirectTo, 'https://frameup.essentiallysports.com/reset-password.html');
  await assert.rejects(window.ESAuth.requestPasswordReset({ email: ES }), error => error.code === 'email_rate_limited');
});

// --- Session expiry / redirect back --------------------------------------------

await test('expired session sends people back to login with reason=session-expired and the page they were on', async () => {
  const { window, location, sessionStorage } = env({ href: 'https://frameup.essentiallysports.com/gallery.html?tab=mine#top' });
  sessionStorage.setItem('es.designerAuth.v1', JSON.stringify({ token: 'old' }));
  await window.ESAuth.requireAuth();
  assert.equal(location.replaceTarget, `login.html?redirect=${encodeURIComponent('gallery.html?tab=mine#top')}&reason=session-expired`);
  assert.equal(sessionStorage.getItem('es.designerAuth.v1'), null);
});

await test('no earlier session → reason=no-session (unchanged)', async () => {
  const { window, location } = env();
  await window.ESAuth.requireAuth('index.html');
  assert.match(location.replaceTarget, /reason=no-session$/);
});

// --- Profile sync merge (integrator item) ----------------------------------------

await test('syncProfile merges: Edit-profile fields survive a session read', async () => {
  const session = { access_token: 't', user: { email: ES, user_metadata: { name: 'Account Name' } } };
  const { window, localStorage } = env({ session });
  localStorage.setItem('es.ai.profile', JSON.stringify({ email: ES, name: 'Chosen Name', role: 'Motion designer', team: 'Social', note: 'Hi', photo: 'data:image/png;base64,AAA', avatar: 'data:image/png;base64,AAA' }));
  await window.ESAuth.getSession();
  const stored = JSON.parse(localStorage.getItem('es.ai.profile'));
  assert.equal(stored.name, 'Chosen Name');
  assert.equal(stored.role, 'Motion designer');
  assert.equal(stored.team, 'Social');
  assert.equal(stored.note, 'Hi');
  assert.equal(stored.photo, 'data:image/png;base64,AAA');
  assert.equal(stored.email, ES);
});

await test('syncProfile starts fresh for a different account on the same browser', async () => {
  const session = { access_token: 't', user: { email: ES, user_metadata: { name: 'Account Name' } } };
  const { window, localStorage } = env({ session });
  localStorage.setItem('es.ai.profile', JSON.stringify({ email: 'previous@essentiallysports.com', name: 'Previous', team: 'Video' }));
  await window.ESAuth.getSession();
  assert.deepEqual(JSON.parse(localStorage.getItem('es.ai.profile')), { name: 'Account Name', email: ES });
});

await test('dashboard presence reads the merged profile + es.ai.profile.edits.v1 overlay', async () => {
  const session = { access_token: 't', user: { email: ES, user_metadata: { name: 'Account Name' } } };
  const upserts = [];
  const { window, context, localStorage } = env({ session });
  localStorage.setItem('es.ai.profile', JSON.stringify({ email: ES, name: 'Account Name', avatar: '' }));
  localStorage.setItem('es.ai.profile.edits.v1', JSON.stringify({ email: ES, name: 'Edited Name', photo: 'https://cdn.example/p.png', designation: 'Art lead' }));
  const client = window.supabase.createClient();
  client.from = table => ({ upsert: async row => { upserts.push({ table, row }); return { error: null }; } });
  vm.runInContext(dashboardSource, context, { filename: 'dashboard-data.js' });
  await window.ESDashboardData.upsertSupabaseProfileAndPresence();
  const profileRow = upserts.find(item => item.table === 'es_designer_profiles').row;
  assert.equal(profileRow.name, 'Edited Name');
  assert.equal(profileRow.avatar_url, 'https://cdn.example/p.png');
  assert.equal(profileRow.designation, 'Art lead');
  // Edits for someone else are ignored.
  localStorage.setItem('es.ai.profile.edits.v1', JSON.stringify({ email: 'other@essentiallysports.com', name: 'Nope' }));
  upserts.length = 0;
  await window.ESDashboardData.upsertSupabaseProfileAndPresence();
  assert.equal(upserts.find(item => item.table === 'es_designer_profiles').row.name, 'Account Name');
});

// --- Role assignment (client + RPC) ------------------------------------------------

function dashboardEnv(email, rpc = {}) {
  const session = { access_token: 't', user: { email, user_metadata: { name: 'Admin' } } };
  const e = env({ session, rpc });
  vm.runInContext(dashboardSource, e.context, { filename: 'dashboard-data.js' });
  return e;
}

await test('role change goes through the guarded RPC and maps HINT → code', async () => {
  const { window, calls } = dashboardEnv('suhail.quraishi@essentiallysports.com', {
    admin_set_es_designer_role: () => ({ data: null, error: { message: 'FrameUp needs at least one admin. Promote someone else first.', hint: 'last_admin', code: 'P0001' } }),
  });
  await assert.rejects(window.ESDashboardData.updatePersonAccessRole('ana@essentiallysports.com', 'Associate'), error => error.code === 'last_admin');
  assert.ok(calls.some(call => call.name === 'rpc:admin_set_es_designer_role'));
});

await test('role change falls back to the older RPC before the migration', async () => {
  const { window, calls } = dashboardEnv('suhail.quraishi@essentiallysports.com', {
    admin_set_es_designer_role: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_set_es_designer_role' } }),
    set_es_designer_access_role: () => ({ data: { email: 'ana@essentiallysports.com', access_role: 'Admin' }, error: null }),
  });
  const person = await window.ESDashboardData.updatePersonAccessRole('ana@essentiallysports.com', 'Admin');
  assert.equal(person.accessRole, 'Admin');
  assert.ok(calls.some(call => call.name === 'rpc:set_es_designer_access_role'));
});

await test('client refuses self-change and non-owners before calling the server', async () => {
  const owner = dashboardEnv('designteam@essentiallysports.com');
  await assert.rejects(owner.window.ESDashboardData.updatePersonAccessRole('designteam@essentiallysports.com', 'Admin'), error => ['self_change', 'protected'].includes(error.code));
  const designer = dashboardEnv('ana@essentiallysports.com');
  await assert.rejects(designer.window.ESDashboardData.updatePersonAccessRole('bo@essentiallysports.com', 'Admin'), error => error.code === 'not_allowed');
  assert.equal(designer.calls.some(call => call.name === 'rpc:admin_set_es_designer_role'), false);
});

await test('admin status comes from the database for role-based admins', async () => {
  const yes = dashboardEnv('ana@essentiallysports.com', { is_es_designer_admin: () => ({ data: true, error: null }) });
  assert.equal(await yes.window.ESDashboardData.isCurrentUserAdmin(), true);
  const no = dashboardEnv('ana@essentiallysports.com');
  assert.equal(await no.window.ESDashboardData.isCurrentUserAdmin(), false);
});

await test('directory + manual confirm RPCs, with graceful "migration not run"', async () => {
  const ready = dashboardEnv('suhail.quraishi@essentiallysports.com', {
    admin_list_es_designer_people: () => ({ data: [{ email: 'Ana@essentiallysports.com', name: 'Ana', access_role: 'Admin', has_account: true, email_confirmed_at: null }], error: null }),
    admin_confirm_es_designer_email: payload => ({ data: { email: payload.target_email, confirmed: true, changed: true }, error: null }),
  });
  const directory = await ready.window.ESDashboardData.fetchPeopleDirectory();
  assert.equal(directory.source, 'directory');
  assert.equal(directory.people[0].email, 'ana@essentiallysports.com');
  assert.equal((await ready.window.ESDashboardData.confirmPersonEmail('ana@essentiallysports.com')).confirmed, true);
  const missing = dashboardEnv('suhail.quraishi@essentiallysports.com', {
    admin_list_es_designer_people: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_list_es_designer_people' } }),
    admin_confirm_es_designer_email: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_confirm_es_designer_email' } }),
  });
  assert.equal((await missing.window.ESDashboardData.fetchPeopleDirectory()).source, 'unavailable');
  await assert.rejects(missing.window.ESDashboardData.confirmPersonEmail('ana@essentiallysports.com'), error => error.code === 'unavailable');
});

// --- People view helpers -------------------------------------------------------------

await test('statuses: active / pending confirmation / invited / access request', async () => {
  const people = People.mergePeople({
    directory: [
      { email: 'a@essentiallysports.com', source: 'directory', hasAccount: true, emailConfirmedAt: '2026-11-01' },
      { email: 'b@essentiallysports.com', source: 'directory', hasAccount: true, emailConfirmedAt: '' },
      { email: 'c@essentiallysports.com', source: 'directory', hasAccount: true, invitedAt: '2026-11-02' },
      { email: 'd@essentiallysports.com', source: 'directory', hasAccount: false },
    ],
    accessRequests: [
      { email: 'guest@example.com', status: 'Pending', name: 'Guest' },
      { email: 'gone@example.com', status: 'Rejected' },
    ],
  });
  const byEmail = Object.fromEntries(people.map(person => [person.email, person.status]));
  assert.deepEqual(byEmail, {
    'a@essentiallysports.com': 'active',
    'b@essentiallysports.com': 'pending-confirmation',
    'c@essentiallysports.com': 'invited',
    'd@essentiallysports.com': 'invited',
    'guest@example.com': 'pending-request',
  });
  assert.equal(People.filterPeople(people, { query: 'guest' }).length, 1);
  assert.equal(People.filterPeople(people, { status: 'pending-confirmation' }).length, 1);
  assert.equal(People.statusCounts(people).all, 5);
});

await test('role guards: self, fixed, owner-only, last admin, confirm on admin boundary', async () => {
  const people = [
    { email: 'owner@essentiallysports.com', accessRole: 'Server Owner', status: 'active' },
    { email: 'ana@essentiallysports.com', accessRole: 'Admin', status: 'active' },
    { email: 'bo@essentiallysports.com', accessRole: 'Associate', status: 'active' },
  ];
  const fixedRoles = { 'owner@essentiallysports.com': 'Server Owner' };
  const plan = (actorEmail, email, nextRole, list = people, fixed = fixedRoles) => People.planRoleChange({
    actorEmail, canManage: true, person: list.find(item => item.email === email) || { email }, nextRole, people: list, fixedRoles: fixed,
  });
  assert.equal(plan('owner@essentiallysports.com', 'owner@essentiallysports.com', 'Admin').reason, 'self_change');
  assert.equal(plan('ana@essentiallysports.com', 'owner@essentiallysports.com', 'Admin').reason, 'protected');
  assert.equal(plan('ana@essentiallysports.com', 'bo@essentiallysports.com', 'Server Owner').reason, 'owner_only');
  assert.equal(plan('owner@essentiallysports.com', 'guest@example.com', 'Admin').reason, 'invalid_email');
  assert.equal(plan('owner@essentiallysports.com', 'bo@essentiallysports.com', 'Associate').reason, 'no_change');
  const promote = plan('owner@essentiallysports.com', 'bo@essentiallysports.com', 'Admin');
  assert.equal(promote.allowed, true);
  assert.equal(promote.needsConfirm, true);
  assert.equal(promote.direction, 'promote');
  assert.equal(plan('owner@essentiallysports.com', 'ana@essentiallysports.com', 'Super Admin').needsConfirm, false);
  // Last admin: no fixed identities and Ana is the only admin left.
  const solo = [{ email: 'ana@essentiallysports.com', accessRole: 'Admin', status: 'active' }, { email: 'bo@essentiallysports.com', accessRole: 'Server Owner', status: 'active' }];
  const soloPlan = People.planRoleChange({ actorEmail: 'bo@essentiallysports.com', canManage: true, person: solo[0], nextRole: 'Associate', people: [solo[0]], fixedRoles: {} });
  assert.equal(soloPlan.reason, 'last_admin');
  assert.equal(People.planRoleChange({ canManage: false, person: solo[0], nextRole: 'Associate' }).reason, 'not_allowed');
  assert.equal(People.initials('Ana María Ruiz', ''), 'AR');
  assert.equal(People.initials('', 'jo.smith@essentiallysports.com'), 'JS');
});

// --- Pure flow helpers -----------------------------------------------------------------

await test('auth-flow helpers', async () => {
  assert.equal(Flow.classifyEmail('A@EssentiallySports.com', { domains: ['essentiallysports.com'] }), 'es');
  assert.equal(Flow.classifyEmail('x@gmail.com', { domains: ['essentiallysports.com'], emails: ['x@gmail.com'] }), 'listed');
  assert.equal(Flow.classifyEmail('x@gmail.com', { domains: ['essentiallysports.com'] }), 'other');
  assert.equal(Flow.classifyEmail('nope', {}), 'invalid');
  assert.equal(Flow.formatCountdown(61), '1:01');
  assert.equal(Flow.formatCountdown(0), '0:00');
  assert.equal(Flow.outcomeForError({ code: 'account_exists' }).panel, 'exists');
  assert.equal(Flow.outcomeForError({ code: 'email_rate_limited', retryAfterSeconds: 20 }).cooldown, 20);
  assert.match(Flow.inboxCopy('confirm', ES).spamHelp, /noreply@mail\.app\.supabase\.io/);
  assert.equal(Flow.passwordOk({ minLength: true, maxLength: true, noEdgeSpaces: true }), true);
  assert.equal(Flow.passwordOk({ minLength: false }), false);
});

// --- Pages wiring ------------------------------------------------------------------------

await test('pages wire the new flows', async () => {
  assert.match(loginHtml, /id="password-toggle"/);
  assert.match(loginHtml, /ESAuth\.requestMagicLink/);
  assert.match(loginHtml, /reason === 'session-expired'/);
  assert.match(loginHtml, /auth-flow\.js\?v=[\w-]+/);
  assert.doesNotMatch(loginHtml, /console\.(log|info|debug)\([^)]*password/i);
  assert.match(callbackHtml, /resendConfirmation/);
  assert.match(callbackHtml, /reset-password\.html\?mode=/);
  assert.match(resetHtml, /id="new-link-form"/);
  assert.match(dashboardHtml, /ESPeopleAdmin\?\.mount/);
  assert.match(dashboardHtml, /dashboard-people\.js\?v=[\w-]+/);
});

// --- Migration static checks ------------------------------------------------------------

await test('migration: idempotent, RLS, guards, no anon, security definer + search_path', async () => {
  assert.match(migration, /Undo/);
  assert.match(migration, /create table if not exists public\.es_designer_role_audit/);
  assert.match(migration, /alter table public\.es_designer_role_audit enable row level security/);
  assert.match(migration, /revoke all on public\.es_designer_role_audit from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*es_designer_role_audit/i);
  for (const fn of ['admin_set_es_designer_role(text, text)', 'admin_list_es_designer_people()', 'admin_confirm_es_designer_email(text)', 'can_manage_es_designer_roles()', 'set_es_designer_access_role(text, text)']) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn.replace(/[()]/g, '\\$&')} from public, anon;`), fn);
  }
  assert.doesNotMatch(migration, /grant [^;]*\bto anon\b/i);
  for (const hint of ['not_allowed', 'self_change', 'protected', 'owner_only', 'last_admin', 'invalid_email']) {
    assert.match(migration, new RegExp(`hint = '${hint}'`), hint);
  }
  assert.match(migration, /for update;/);
  assert.match(migration, /set_config\('frameup\.role_change', 'allowed', true\)/);
  assert.match(migration, /before insert on public\.es_designer_profiles/);
  // every security definer function pins search_path
  const definers = migration.split(/create or replace function/).slice(1).filter(body => /security definer/.test(body));
  assert.ok(definers.length >= 7);
  definers.forEach(body => assert.match(body, /set search_path = public/));
  // only CREATE OR REPLACE / IF NOT EXISTS / DROP IF EXISTS for objects
  assert.doesNotMatch(migration, /create (table|index|policy|trigger) (?!if not exists)(?!"|es_designer|protect_|on_)/i);
  assert.doesNotMatch(migration, /^\s*create function/im);
  // manual confirm only for approved, unconfirmed accounts, admin-gated
  const confirmFn = migration.slice(migration.indexOf('function public.admin_confirm_es_designer_email'));
  assert.match(confirmFn, /is_es_designer_admin\(\)/);
  assert.match(confirmFn, /is_es_designer_email_approved\(normalized_email\)/);
  assert.match(confirmFn, /email_confirmed_at = now\(\)/);
});

console.log(`Auth flow + People/roles tests passed (${results.length}).`);
