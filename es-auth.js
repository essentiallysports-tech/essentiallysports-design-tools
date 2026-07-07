(function () {
  'use strict';

  const AUTH_STORAGE_KEY = 'es.designerAuth.v1';
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

  function authUnavailableError() {
    return new Error('ES Designer login is temporarily unavailable. Please try again shortly.');
  }

  function friendlyAuthError(error, fallback = 'Unable to complete authentication right now.') {
    const message = String(error?.message || error || '').trim();
    const normalized = message.toLowerCase();
    if (normalized.includes('email not confirmed') || normalized.includes('not confirmed')) {
      return new Error('Please verify your ES email before logging in.');
    }
    if (normalized.includes('invalid login credentials')) {
      return new Error('Invalid email or password. If this is your first time, create an account first.');
    }
    if (normalized.includes('user already registered') || normalized.includes('already registered')) {
      return new Error('An account already exists for this email. Please log in or use Forgot password.');
    }
    if (normalized.includes('password should be at least') || normalized.includes('weak password')) {
      return new Error('Password must be at least 8 characters.');
    }
    if (normalized.includes('rate limit') || normalized.includes('too many')) {
      return new Error('Too many attempts. Please wait a moment and try again.');
    }
    return new Error(message || fallback);
  }

  function withTimeout(promise, timeoutMs, message) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
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

    if (error) throw friendlyAuthError(error, 'Unable to create account.');
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

    throw authUnavailableError();
  }

  async function loginWithSupabase({ email, password }) {
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase is not configured yet.');

    const normalizedEmail = normalizeEmail(email);
    const { data, error } = await client.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) throw friendlyAuthError(error, 'Unable to log in.');

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

    throw authUnavailableError();
  }

  async function requestPasswordReset({ email, redirectTo }) {
    const normalizedEmail = normalizeEmail(email);
    if (!isAllowedEmail(normalizedEmail)) {
      throw new Error('Password reset is limited to @essentiallysports.com email addresses.');
    }
    if (!isSupabaseConfigured()) {
      throw new Error('Password reset is available only when Supabase Auth is configured.');
    }

    let safeRedirectTo;
    try {
      const candidate = new URL(String(redirectTo || 'reset-password.html').trim(), window.location.href);
      const isSameOrigin = candidate.origin === window.location.origin;
      const isResetPage = /\/reset-password\.html$/i.test(candidate.pathname);
      safeRedirectTo = isSameOrigin && isResetPage
        ? candidate.href
        : new URL('reset-password.html', window.location.href).href;
    } catch (error) {
      safeRedirectTo = new URL('reset-password.html', window.location.href).href;
    }

    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: safeRedirectTo,
    });
    if (error) throw friendlyAuthError(error, 'Unable to send the password reset email.');
    return true;
  }

  async function updatePassword(password) {
    validatePassword(password);
    if (!isSupabaseConfigured()) {
      throw new Error('Password updates are available only when Supabase Auth is configured.');
    }

    const { data, error } = await getSupabaseClient().auth.updateUser({ password });
    if (error) throw friendlyAuthError(error, 'Unable to update the password.');
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

    return null;
  }

  async function isValidSession(session) {
    const currentSession = session || await getSession();
    const email = normalizeEmail(currentSession?.user?.email);
    if (!currentSession?.token || !isAllowedEmail(email)) return false;
    return isSupabaseConfigured();
  }

  async function fetchWithAuth(input, init = {}) {
    const session = await getSession();
    if (!await isValidSession(session)) {
      throw new Error('Please log in again to continue.');
    }
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${session.token}`);
    return window.fetch(input, {
      ...init,
      headers,
    });
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
    return `${loginPath}?redirect=${encodeURIComponent(returnTo || 'index.html')}`;
  }

  function requireAuth(returnTo) {
    document.documentElement.style.visibility = 'hidden';
    return (async () => {
      try {
        if (await withTimeout(isValidSession(), 8000, 'Authentication check timed out.')) {
          document.documentElement.style.visibility = '';
          window.dispatchEvent(new CustomEvent('es:auth-ready'));
          return true;
        }
      } catch (error) {
        // Treat auth service failures as signed-out rather than exposing a
        // protected page with an unverified session.
      }
      await logout();
      window.location.replace(loginUrl(returnTo));
      return false;
    })();
  }

  window.ESAuth = Object.freeze({
    AUTH_STORAGE_KEY,
    approvedEmails,
    approvedDomains,
    createAccount,
    fetchWithAuth,
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
