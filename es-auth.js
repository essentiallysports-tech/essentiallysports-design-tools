(function () {
  'use strict';

  const AUTH_STORAGE_KEY = 'es.designerAuth.v1';
  const PROFILE_STORAGE_KEY = 'es.ai.profile';
  const ACCESS_REQUESTS_KEY = 'es.accessRequests.v1';
  const KNOWN_EMAILS_KEY = 'es.authKnownEmails.v1';
  const ACCESS_REQUESTS_TABLE = 'es_designer_access_requests';
  const AUTH_CALLBACK_PATH = '/auth-callback.html';
  const AUTH_CALLBACK_TYPES = new Set(['email', 'email_change', 'invite', 'magiclink', 'recovery', 'signup']);
  const SUPABASE_SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
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

  function readJson(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function getKnownEmails() {
    const emails = readJson(KNOWN_EMAILS_KEY, []);
    return Array.isArray(emails) ? emails.map(normalizeEmail).filter(Boolean) : [];
  }

  function rememberKnownEmail(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return [];
    const next = Array.from(new Set([normalized, ...getKnownEmails()]));
    writeJson(KNOWN_EMAILS_KEY, next.slice(0, 12));
    return next;
  }

  function normalizeAccessRequest(row = {}) {
    const email = normalizeEmail(row.email);
    if (!email) return null;
    return {
      email,
      name: String(row.name || '').trim(),
      status: String(row.status || 'Pending').trim() || 'Pending',
      reason: String(row.reason || '').trim(),
      source: String(row.source || 'login').trim() || 'login',
      requestedAt: String(row.requested_at || row.requestedAt || row.updated_at || new Date().toISOString()),
      reviewedAt: String(row.reviewed_at || row.reviewedAt || ''),
      reviewedBy: normalizeEmail(row.reviewed_by || row.reviewedBy || ''),
      updatedAt: String(row.updated_at || row.updatedAt || new Date().toISOString()),
    };
  }

  function getLocalAccessRequests() {
    const records = readJson(ACCESS_REQUESTS_KEY, []);
    return Array.isArray(records) ? records.map(normalizeAccessRequest).filter(Boolean) : [];
  }

  function saveLocalAccessRequest(record) {
    const normalized = normalizeAccessRequest(record);
    if (!normalized) return null;
    const next = [
      normalized,
      ...getLocalAccessRequests().filter(item => item.email !== normalized.email),
    ];
    writeJson(ACCESS_REQUESTS_KEY, next);
    return normalized;
  }

  function isLocallyApprovedEmail(email) {
    const normalized = normalizeEmail(email);
    return getLocalAccessRequests().some(request => request.email === normalized && request.status === 'Approved');
  }

  async function isAccessApprovedInSupabase(email) {
    const normalized = normalizeEmail(email);
    if (!normalized || !await ensureSupabaseReady(5000)) return false;
    const client = getSupabaseClient();
    if (!client) return false;
    const approvalCheck = await client
      .rpc('is_es_designer_email_approved', { candidate_email: normalized })
      .catch(() => ({ data: false, error: true }));
    if (!approvalCheck.error) return Boolean(approvalCheck.data);
    const { data, error } = await client
      .from(ACCESS_REQUESTS_TABLE)
      .select('email,status')
      .eq('email', normalized)
      .eq('status', 'Approved')
      .maybeSingle();
    return Boolean(!error && data?.email);
  }

  async function isAllowedEmailAsync(email) {
    const normalized = normalizeEmail(email);
    if (isAllowedEmail(normalized) || isLocallyApprovedEmail(normalized)) return true;
    return isAccessApprovedInSupabase(normalized);
  }

  async function recordAccessRequest({ email, name = '', reason = 'External email login attempt', source = 'login' } = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      throw new Error('Enter a valid email address before requesting access.');
    }
    if (isAllowedEmail(normalizedEmail)) {
      return { email: normalizedEmail, status: 'Approved', name: String(name || '').trim(), source };
    }

    const fallbackRecord = saveLocalAccessRequest({
      email: normalizedEmail,
      name,
      status: 'Pending',
      reason,
      source,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent || '' : '',
      requestedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    if (await ensureSupabaseReady(5000)) {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.rpc('upsert_es_designer_access_request', {
          request_email: normalizedEmail,
          request_name: String(name || '').trim(),
          request_reason: String(reason || '').trim(),
          request_source: String(source || 'login').trim(),
          request_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent || '' : '',
        });
        if (!error && data) {
          return saveLocalAccessRequest(data);
        }
      }
    }

    return fallbackRecord;
  }

  async function getAccessRequests() {
    let requests = getLocalAccessRequests();
    if (await ensureSupabaseReady(5000)) {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client
          .from(ACCESS_REQUESTS_TABLE)
          .select('*')
          .order('requested_at', { ascending: false });
        if (!error && Array.isArray(data)) {
          requests = data.map(normalizeAccessRequest).filter(Boolean);
          writeJson(ACCESS_REQUESTS_KEY, requests);
        }
      }
    }
    return requests;
  }

  async function reviewAccessRequest(email, status) {
    const normalizedEmail = normalizeEmail(email);
    const nextStatus = String(status || '').trim();
    if (!['Pending', 'Approved', 'Rejected'].includes(nextStatus)) {
      throw new Error('Choose Approved, Rejected, or Pending.');
    }

    let reviewed = saveLocalAccessRequest({
      ...(getLocalAccessRequests().find(request => request.email === normalizedEmail) || {}),
      email: normalizedEmail,
      status: nextStatus,
      reviewedAt: nextStatus === 'Pending' ? '' : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    if (await ensureSupabaseReady(5000)) {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client.rpc('review_es_designer_access_request', {
          request_email: normalizedEmail,
          next_status: nextStatus,
        });
        if (error) throw error;
        reviewed = saveLocalAccessRequest(data);
      }
    }
    return reviewed;
  }

  function accessPendingError(email) {
    const normalizedEmail = normalizeEmail(email);
    return new Error(`Access request sent for ${normalizedEmail}. A Frameup admin can approve or reject it from the dashboard.`);
  }

  function hasSupabaseSdk() {
    return Boolean(window.supabase?.createClient);
  }

  function hasSupabaseCredentials() {
    return Boolean(
      supabaseConfig.url
      && supabaseConfig.anonKey
    );
  }

  function isSupabaseConfigured() {
    return Boolean(hasSupabaseCredentials() && hasSupabaseSdk());
  }

  function authUnavailableError() {
    return new Error('Frameup login is temporarily unavailable. Please try again shortly.');
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
    if (
      normalized.includes('email address not authorized')
      || normalized.includes('email_address_not_authorized')
    ) {
      return new Error('Frameup cannot send confirmation emails to this address yet. Please contact suhail.quraishi@essentiallysports.com.');
    }
    if (
      normalized.includes('otp expired')
      || normalized.includes('token has expired')
      || normalized.includes('invalid token')
      || normalized.includes('invalid claim')
      || normalized.includes('invalid or expired')
      || normalized.includes('already been used')
    ) {
      return new Error('This confirmation link has already been used or has expired. Your account may already be confirmed—return to login and try signing in.');
    }
    return new Error(message || fallback);
  }

  function safeLocalReturnTo(returnTo) {
    const fallback = 'index.html';
    if (!String(returnTo || '').trim()) return fallback;
    try {
      const target = new URL(String(returnTo), window.location.origin);
      if (target.origin !== window.location.origin) return fallback;
      if (/\/(?:auth-callback|login)\.html$/i.test(target.pathname)) return fallback;
      const path = target.pathname.replace(/^\//, '') || fallback;
      return `${path}${target.search}${target.hash}`;
    } catch (error) {
      return fallback;
    }
  }

  function authCallbackUrl(returnTo) {
    const callback = new URL(AUTH_CALLBACK_PATH, window.location.origin);
    const safeReturnTo = safeLocalReturnTo(returnTo);
    if (safeReturnTo !== 'index.html') callback.searchParams.set('redirect', safeReturnTo);
    return callback.href;
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
  let supabaseSdkPromise = null;

  function loadSupabaseSdk(timeoutMs = 8000) {
    if (hasSupabaseSdk()) return Promise.resolve(true);
    if (!hasSupabaseCredentials()) return Promise.resolve(false);
    if (supabaseSdkPromise) return supabaseSdkPromise;

    supabaseSdkPromise = new Promise(resolve => {
      if (
        typeof document === 'undefined'
        || typeof document.createElement !== 'function'
        || !document.head
        || typeof document.head.appendChild !== 'function'
      ) {
        resolve(false);
        return;
      }
      const existingScript = typeof document.querySelector === 'function'
        ? document.querySelector(`script[src="${SUPABASE_SDK_URL}"]`)
        : null;
      let didFinish = false;
      const finish = value => {
        if (didFinish) return;
        didFinish = true;
        resolve(Boolean(value && hasSupabaseSdk()));
      };
      const timer = window.setTimeout(() => finish(false), timeoutMs);
      const complete = value => {
        window.clearTimeout(timer);
        finish(value);
      };

      const script = existingScript || document.createElement('script');
      script.src = SUPABASE_SDK_URL;
      script.async = true;
      script.onload = () => complete(true);
      script.onerror = () => complete(false);
      if (!existingScript) {
        document.head.appendChild(script);
      }
    }).finally(() => {
      if (!hasSupabaseSdk()) supabaseSdkPromise = null;
    });

    return supabaseSdkPromise;
  }

  async function ensureSupabaseReady(timeoutMs = 8000) {
    if (!hasSupabaseCredentials()) return false;
    if (hasSupabaseSdk()) return true;
    return loadSupabaseSdk(timeoutMs);
  }

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
        name: String(name || '').trim() || normalizeEmail(email).split('@')[0] || 'Frameup User',
        email: normalizeEmail(email),
      }));
    } catch (error) {
      // Profile sync is helpful but not required for auth.
    }
  }

  function syncSession(session) {
    if (!session?.user?.email) return session;
    try {
      const nextSession = JSON.stringify(session);
      const previousSession = window.sessionStorage.getItem(AUTH_STORAGE_KEY);
      window.sessionStorage.setItem(AUTH_STORAGE_KEY, nextSession);
      if (previousSession !== nextSession) {
        window.dispatchEvent(new CustomEvent('es:auth-updated', { detail: { email: session.user.email } }));
      }
    } catch (error) {
      // Session mirroring is only used by local UI gates; Supabase remains the source of truth.
    }
    return session;
  }

  async function createSupabaseAccount({ name, email, password, redirectTo }) {
    if (!await ensureSupabaseReady()) throw new Error('Supabase is not configured yet.');
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase is not configured yet.');

    const normalizedEmail = normalizeEmail(email);
    const { data, error } = await client.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: authCallbackUrl(redirectTo),
        data: {
          name: String(name || '').trim() || normalizedEmail.split('@')[0] || 'Frameup User',
          role: 'Designer',
        },
      },
    });

    if (error) throw friendlyAuthError(error, 'Unable to create account.');
    if (data?.session) await client.auth.signOut();
    return {
      email: normalizedEmail,
      name: data?.user?.user_metadata?.name || String(name || '').trim() || normalizedEmail.split('@')[0] || 'Frameup User',
      role: 'Designer',
      requiresEmailConfirmation: !data?.session,
    };
  }

  async function createAccount({ name, email, password, redirectTo }) {
    const normalizedEmail = normalizeEmail(email);
    if (!await isAllowedEmailAsync(normalizedEmail)) {
      await recordAccessRequest({
        email: normalizedEmail,
        name,
        reason: 'Signup attempt from a non-ES email.',
        source: 'signup',
      });
      throw accessPendingError(normalizedEmail);
    }
    validatePassword(password);

    if (await ensureSupabaseReady()) {
      const account = await createSupabaseAccount({ name, email: normalizedEmail, password, redirectTo });
      rememberKnownEmail(normalizedEmail);
      return account;
    }

    throw authUnavailableError();
  }

  async function loginWithSupabase({ email, password }) {
    if (!await ensureSupabaseReady()) throw new Error('Supabase is not configured yet.');
    const client = getSupabaseClient();
    if (!client) throw new Error('Supabase is not configured yet.');

    const normalizedEmail = normalizeEmail(email);
    const { data, error } = await client.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) throw friendlyAuthError(error, 'Unable to log in.');

    const user = data?.user;
    const displayName = user?.user_metadata?.name || normalizedEmail.split('@')[0] || 'Frameup User';
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
    if (!await isAllowedEmailAsync(normalizedEmail)) {
      await recordAccessRequest({
        email: normalizedEmail,
        reason: 'Login attempt from a non-ES email.',
        source: 'login',
      });
      throw accessPendingError(normalizedEmail);
    }

    if (await ensureSupabaseReady()) {
      const session = await loginWithSupabase({ email: normalizedEmail, password });
      rememberKnownEmail(normalizedEmail);
      return session;
    }

    throw authUnavailableError();
  }

  async function resendConfirmation({ email, redirectTo }) {
    const normalizedEmail = normalizeEmail(email);
    if (!await isAllowedEmailAsync(normalizedEmail)) {
      throw new Error('Confirmation links are available only for approved Frameup accounts.');
    }
    if (!await ensureSupabaseReady()) throw authUnavailableError();
    const client = getSupabaseClient();
    if (!client) throw authUnavailableError();

    const { error } = await client.auth.resend({
      type: 'signup',
      email: normalizedEmail,
      options: {
        emailRedirectTo: authCallbackUrl(redirectTo),
      },
    });
    if (error) throw friendlyAuthError(error, 'Unable to resend the confirmation email.');
    rememberKnownEmail(normalizedEmail);
    return true;
  }

  async function completeAuthCallback() {
    if (!await ensureSupabaseReady()) throw authUnavailableError();
    const client = getSupabaseClient();
    if (!client) throw authUnavailableError();

    const currentUrl = new URL(window.location.href);
    const hashParams = new URLSearchParams(currentUrl.hash.replace(/^#/, ''));
    const callbackError = currentUrl.searchParams.get('error_description')
      || currentUrl.searchParams.get('error')
      || hashParams.get('error_description')
      || hashParams.get('error');
    if (callbackError) throw friendlyAuthError(new Error(callbackError), 'Unable to confirm this email.');

    const code = currentUrl.searchParams.get('code');
    const tokenHash = currentUrl.searchParams.get('token_hash');
    const requestedCallbackType = currentUrl.searchParams.get('type') || 'signup';
    const callbackType = AUTH_CALLBACK_TYPES.has(requestedCallbackType) ? requestedCallbackType : 'signup';

    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw friendlyAuthError(error, 'Unable to confirm this email.');
    } else if (tokenHash) {
      const { error } = await client.auth.verifyOtp({
        token_hash: tokenHash,
        type: callbackType,
      });
      if (error) throw friendlyAuthError(error, 'Unable to confirm this email.');
    }

    const session = await getSession();
    if (!session?.token) {
      throw new Error('This confirmation link has already been used or has expired. Your account may already be confirmed—return to login and try signing in.');
    }
    rememberKnownEmail(session.user.email);
    return session;
  }

  async function requestPasswordReset({ email, redirectTo }) {
    const normalizedEmail = normalizeEmail(email);
    if (!await isAllowedEmailAsync(normalizedEmail)) {
      throw new Error('Password reset is available only for approved Frameup accounts.');
    }
    if (!await ensureSupabaseReady()) {
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
    if (!await ensureSupabaseReady()) {
      throw new Error('Password updates are available only when Supabase Auth is configured.');
    }

    const { data, error } = await getSupabaseClient().auth.updateUser({ password });
    if (error) throw friendlyAuthError(error, 'Unable to update the password.');
    return data?.user || null;
  }

  async function getSession() {
    if (await ensureSupabaseReady()) {
      const client = getSupabaseClient();
      const { data } = await client.auth.getSession();
      const session = data?.session;
      const email = normalizeEmail(session?.user?.email);
      if (!session || !await isAllowedEmailAsync(email)) return null;

      const name = session.user?.user_metadata?.name || email.split('@')[0] || 'Frameup User';
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
    if (!currentSession?.token || !await isAllowedEmailAsync(email)) return false;
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

    if (await ensureSupabaseReady(5000)) {
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
    authCallbackUrl,
    completeAuthCallback,
    createAccount,
    fetchWithAuth,
    getAccessRequests,
    getKnownEmails,
    getSession,
    getSupabaseClient,
    ensureSupabaseReady,
    isAllowedEmail,
    isAllowedEmailAsync,
    isSupabaseConfigured,
    isValidSession,
    login,
    loginUrl,
    logout,
    normalizeEmail,
    recordAccessRequest,
    resendConfirmation,
    requestPasswordReset,
    requireAuth,
    reviewAccessRequest,
    updatePassword,
  });
})();
