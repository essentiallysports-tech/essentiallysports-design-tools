(function () {
  'use strict';

  const AUTH_STORAGE_KEY = 'es.designerAuth.v1';
  const ACCOUNT_STORAGE_KEY = 'es.designerAccounts.v1';
  const PROFILE_STORAGE_KEY = 'es.ai.profile';
  const config = window.ES_AUTH_CONFIG || {};
  const supabaseConfig = config.supabase || {};

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function approvedEmails() {
    return Array.isArray(config.allowedEmails)
      ? config.allowedEmails.map(normalizeEmail).filter(Boolean)
      : [];
  }

  function approvedDomains() {
    return Array.isArray(config.allowedDomains)
      ? config.allowedDomains
        .map(domain => String(domain || '').trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean)
      : [];
  }

  function isAllowedEmail(email) {
    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes('@')) return false;
    if (approvedEmails().includes(normalized)) return true;
    const domain = normalized.split('@').pop();
    return approvedDomains().includes(domain);
  }

  function isSupabaseConfigured() {
    return Boolean(
      supabaseConfig.url
      && supabaseConfig.anonKey
      && window.supabase?.createClient
    );
  }

  let supabaseClient = null;

  function getSupabaseClient() {
    if (!isSupabaseConfigured()) return null;
    if (!supabaseClient) {
      supabaseClient = window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    }
    return supabaseClient;
  }

  function readAccounts() {
    try {
      return JSON.parse(window.localStorage.getItem(ACCOUNT_STORAGE_KEY) || '{}') || {};
    } catch (error) {
      return {};
    }
  }

  function writeAccounts(accounts) {
    window.localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(accounts));
  }

  function accountExists(email) {
    return Boolean(readAccounts()[normalizeEmail(email)]);
  }

  function randomSalt() {
    const values = new Uint8Array(16);
    window.crypto.getRandomValues(values);
    return Array.from(values, value => value.toString(16).padStart(2, '0')).join('');
  }

  async function sha256(value) {
    const encoded = new TextEncoder().encode(value);
    const hash = await window.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function hashPassword(password, salt) {
    return sha256(`${salt}:${password}`);
  }

  function safeCompare(a, b) {
    const left = String(a || '');
    const right = String(b || '');
    if (left.length !== right.length) return false;
    let mismatch = 0;
    for (let index = 0; index < left.length; index += 1) {
      mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return mismatch === 0;
  }

  function validatePassword(password) {
    if (String(password || '').length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }
  }

  function syncProfile({ name, email }) {
    try {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({
        name: String(name || '').trim() || normalizeEmail(email).split('@')[0] || 'ES Designer',
        email: normalizeEmail(email),
      }));
    } catch (error) {
      // Profile sync is helpful but not required for auth.
    }
  }

  function syncSession(session) {
    if (!session?.user?.email) return session;
    try {
      window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
      window.dispatchEvent(new CustomEvent('es:auth-updated', { detail: { email: session.user.email } }));
    } catch (error) {
      // Session mirroring is only used by local UI gates; Supabase remains the source of truth.
    }
    return session;
  }

  function localSessionFromAccount(account) {
    return {
      token: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      user: {
        email: account.email,
        name: account.name,
        role: account.role || 'Designer',
      },
      createdAt: new Date().toISOString(),
      mode: 'local-account',
    };
  }

  async function createLocalAccount({ name, email, password }) {
    const normalizedEmail = normalizeEmail(email);
    const accounts = readAccounts();
    if (accounts[normalizedEmail]) {
      throw new Error('An account already exists for this email. Please log in.');
    }

    const salt = randomSalt();
    accounts[normalizedEmail] = {
      email: normalizedEmail,
      name: String(name || '').trim() || normalizedEmail.split('@')[0] || 'ES Designer',
      role: 'Designer',
      salt,
      passwordHash: await hashPassword(password, salt),
      createdAt: new Date().toISOString(),
    };
    writeAccounts(accounts);
    return { email: normalizedEmail, name: accounts[normalizedEmail].name, role: 'Designer' };
  }

  async function createSupabaseAccount({ name, email, password }) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase is not configured yet.');

    const normalizedEmail = normalizeEmail(email);
    const { data, error } = await client.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          name: String(name || '').trim() || normalizedEmail.split('@')[0] || 'ES Designer',
          role: 'Designer',
        },
      },
    });

    if (error) throw new Error(error.message || 'Unable to create account.');
    if (data?.session) await client.auth.signOut();
    return {
      email: normalizedEmail,
      name: data?.user?.user_metadata?.name || String(name || '').trim() || normalizedEmail.split('@')[0] || 'ES Designer',
      role: 'Designer',
    };
  }

  async function createAccount({ name, email, password }) {
    const normalizedEmail = normalizeEmail(email);
    if (!isAllowedEmail(normalizedEmail)) {
      throw new Error('This email is not approved for ES Designer access.');
    }
    validatePassword(password);

    if (isSupabaseConfigured()) {
      return createSupabaseAccount({ name, email: normalizedEmail, password });
    }

    return createLocalAccount({ name, email: normalizedEmail, password });
  }

  async function loginWithLocalAccount({ email, password }) {
    const normalizedEmail = normalizeEmail(email);
    const account = readAccounts()[normalizedEmail];
    if (!account) {
      throw new Error('No account found for this email. Please create an account first.');
    }

    const candidateHash = await hashPassword(password, account.salt);
    if (!safeCompare(candidateHash, account.passwordHash)) {
      throw new Error('Incorrect password.');
    }

    const session = localSessionFromAccount(account);
    syncProfile({ name: account.name, email: normalizedEmail });
    return syncSession(session);
  }

  async function loginWithSupabase({ email, password }) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase is not configured yet.');

    const normalizedEmail = normalizeEmail(email);
    const { data, error } = await client.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) throw new Error(error.message || 'Unable to log in.');

    const user = data?.user;
    const displayName = user?.user_metadata?.name || normalizedEmail.split('@')[0] || 'ES Designer';
    const session = {
      token: data?.session?.access_token,
      user: {
        email: normalizedEmail,
        name: displayName,
        role: user?.user_metadata?.role || 'Designer',
      },
      createdAt: new Date().toISOString(),
      mode: 'supabase',
    };
    syncProfile({ name: displayName, email: normalizedEmail });
    return syncSession(session);
  }

  async function login({ email, password }) {
    const normalizedEmail = normalizeEmail(email);
    if (!isAllowedEmail(normalizedEmail)) {
      throw new Error('This email is not approved for ES Designer access.');
    }

    if (isSupabaseConfigured()) {
      return loginWithSupabase({ email: normalizedEmail, password });
    }

    return loginWithLocalAccount({ email: normalizedEmail, password });
  }

  async function requestPasswordReset({ email, redirectTo }) {
    const normalizedEmail = normalizeEmail(email);
    if (!isAllowedEmail(normalizedEmail)) {
      throw new Error('Password reset is limited to @essentiallysports.com email addresses.');
    }
    if (!isSupabaseConfigured()) {
      throw new Error('Password reset is available only when Supabase Auth is configured.');
    }

    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: String(redirectTo || '').trim() || undefined,
    });
    if (error) throw new Error(error.message || 'Unable to send the password reset email.');
    return true;
  }

  async function updatePassword(password) {
    validatePassword(password);
    if (!isSupabaseConfigured()) {
      throw new Error('Password updates are available only when Supabase Auth is configured.');
    }

    const { data, error } = await getSupabaseClient().auth.updateUser({ password });
    if (error) throw new Error(error.message || 'Unable to update the password.');
    return data?.user || null;
  }

  async function getSession() {
    if (isSupabaseConfigured()) {
      const client = getSupabaseClient();
      const { data } = await client.auth.getSession();
      const session = data?.session;
      const email = normalizeEmail(session?.user?.email);
      if (!session || !isAllowedEmail(email)) return null;

      const name = session.user?.user_metadata?.name || email.split('@')[0] || 'ES Designer';
      const mirroredSession = {
        token: session.access_token,
        user: {
          email,
          name,
          role: session.user?.user_metadata?.role || 'Designer',
        },
        createdAt: session.user?.created_at,
        mode: 'supabase',
      };
      syncProfile({ name, email });
      return syncSession(mirroredSession);
    }

    try {
      return JSON.parse(window.sessionStorage.getItem(AUTH_STORAGE_KEY) || 'null');
    } catch (error) {
      return null;
    }
  }

  async function isValidSession(session) {
    const currentSession = session || await getSession();
    const email = normalizeEmail(currentSession?.user?.email);
    if (!currentSession?.token || !isAllowedEmail(email)) return false;
    if (isSupabaseConfigured()) return true;
    return accountExists(email);
  }

  async function logout() {
    try {
      window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
    } catch (error) {
      // Ignore storage failures.
    }

    if (isSupabaseConfigured()) {
      try {
        await getSupabaseClient()?.auth.signOut();
      } catch (error) {
        // Ignore sign-out failures; the guard will still reject invalid sessions.
      }
    }
  }

  function loginUrl(returnTo) {
    const loginPath = window.location.pathname.includes('/ai-page/') ? '../login.html' : 'login.html';
    return `${loginPath}?redirect=${encodeURIComponent(returnTo || 'index.html#frames')}`;
  }

  function requireAuth(returnTo) {
    (async () => {
      if (await isValidSession()) return;
      await logout();
      window.location.replace(loginUrl(returnTo));
    })();
    return true;
  }

  window.ESAuth = Object.freeze({
    AUTH_STORAGE_KEY,
    ACCOUNT_STORAGE_KEY,
    approvedEmails,
    approvedDomains,
    accountExists,
    createAccount,
    getSession,
    getSupabaseClient,
    isAllowedEmail,
    isSupabaseConfigured,
    isValidSession,
    login,
    loginUrl,
    logout,
    normalizeEmail,
    requestPasswordReset,
    requireAuth,
    updatePassword,
  });
})();
