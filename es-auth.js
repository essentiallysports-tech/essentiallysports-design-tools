(function () {
  'use strict';

  const AUTH_STORAGE_KEY = 'es.designerAuth.v1';
  const PROFILE_STORAGE_KEY = 'es.ai.profile';
  const ACCESS_REQUESTS_KEY = 'es.accessRequests.v1';
  const KNOWN_EMAILS_KEY = 'es.authKnownEmails.v1';
  const ACCESS_REQUESTS_TABLE = 'es_designer_access_requests';
  const AUTH_CALLBACK_PATH = '/auth-callback.html';
  const AUTH_CALLBACK_TYPES = new Set(['email', 'email_change', 'invite', 'magiclink', 'recovery', 'signup']);
  // Pinned (same bytes the @2 alias served) so browsers can cache it for a year.
  const SUPABASE_SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.min.js';
  // Subresource integrity for exactly that file (update both together).
  const SUPABASE_SDK_INTEGRITY = 'sha384-UagCvVPT5XXA0Hx+nJYUAGBFseHT9zBgpJMSebsAxl9lciTwbT+39j5VfRjdP5Tp';
  const config = window.ES_AUTH_CONFIG || {};
  // The SDK clears auth tokens from the address bar as soon as it starts, so
  // the callback reads the link type (signup / magiclink / invite / recovery)
  // from the URL as it was when this file loaded.
  let initialHref = '';
  try { initialHref = String(window.location.href || ''); } catch (error) { initialHref = ''; }
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
    // client.rpc(...) returns a PostgREST builder that is thenable (supports
    // await) but does not implement .catch()/.finally() as a real Promise
    // does -- chaining .catch() on it throws "is not a function" instead of
    // ever catching anything, silently breaking every non-ES approved
    // email's login/signup. Use try/catch around the await instead.
    let approvalCheck;
    try {
      approvalCheck = await client.rpc('is_es_designer_email_approved', { candidate_email: normalized });
    } catch {
      approvalCheck = { data: false, error: true };
    }
    if (!approvalCheck.error) return Boolean(approvalCheck.data);
    let fallback;
    try {
      fallback = await client
        .from(ACCESS_REQUESTS_TABLE)
        .select('email,status')
        .eq('email', normalized)
        .eq('status', 'Approved')
        .maybeSingle();
    } catch {
      fallback = { data: null, error: true };
    }
    // null = "could not check" (both lookups failed). Callers treat it as
    // not approved, but requireAuth never signs anyone out because of it.
    if (fallback.error) return null;
    return Boolean(fallback.data?.email);
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
    return authError(
      'access_requested',
      `Access request sent for ${normalizedEmail}. A FrameUp admin can approve or reject it from the dashboard.`,
      { friendly: true },
    );
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
    return new Error('FrameUp login is temporarily unavailable. Please try again shortly.');
  }

  // Supabase's per-address email limit says "you can only request this after
  // 37 seconds". Returns that number, or 0.
  function retryAfterSeconds(message) {
    const match = /after\s+(\d+)\s+second/i.exec(String(message || ''));
    return match ? Math.max(1, Number(match[1]) || 0) : 0;
  }

  // An Error with a stable `code` the pages switch on (offer Resend, start a
  // cooldown, switch to Log in). Messages never echo passwords or tokens.
  function authError(code, message, extra = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, extra);
    return error;
  }

  const EMAIL_LIMIT_HELP = 'FrameUp\'s email sender only allows a few emails per hour for the whole team.';

  function friendlyAuthError(error, fallback = 'Unable to complete authentication right now.') {
    if (error && typeof error === 'object' && error.code && error.friendly === true) return error;
    const message = String(error?.message || error || '').trim();
    const normalized = message.toLowerCase();
    const code = String(error?.code || error?.error_code || '').toLowerCase();
    const status = Number(error?.status || 0);
    const make = (friendlyCode, friendlyMessage, extra = {}) => authError(friendlyCode, friendlyMessage, { friendly: true, ...extra });

    if (code === 'email_not_confirmed' || normalized.includes('email not confirmed') || normalized.includes('not confirmed')) {
      return make('email_not_confirmed', 'Please verify your ES email before logging in. Use the link we emailed you, or send a new one.');
    }
    if (code === 'invalid_credentials' || normalized.includes('invalid login credentials')) {
      return make('invalid_credentials', 'Invalid email or password. If this is your first time, create an account first.');
    }
    if (code === 'user_already_exists' || code === 'email_exists' || normalized.includes('user already registered') || normalized.includes('already registered')) {
      return make('account_exists', 'An account already exists for this email. Please log in or use Forgot password.');
    }
    if (code === 'same_password' || normalized.includes('should be different from the old password')) {
      return make('same_password', 'Choose a password you haven\'t used for FrameUp before.');
    }
    if (code === 'weak_password' || normalized.includes('password should be at least') || normalized.includes('weak password')) {
      return make('weak_password', 'Password must be at least 8 characters.');
    }
    const waitSeconds = retryAfterSeconds(message);
    if (code === 'over_email_send_rate_limit' || normalized.includes('email rate limit') || waitSeconds) {
      return make(
        'email_rate_limited',
        waitSeconds
          ? `An email was sent to this address moments ago. You can ask for another in ${waitSeconds} seconds.`
          : `We couldn't send that email right now: ${EMAIL_LIMIT_HELP} Wait a few minutes and try again, or ask a FrameUp admin to confirm your account from the Dashboard.`,
        { retryAfterSeconds: waitSeconds || 60 },
      );
    }
    if (code === 'over_request_rate_limit' || status === 429 || normalized.includes('rate limit') || normalized.includes('too many')) {
      return make('rate_limited', 'Too many attempts. Please wait a moment and try again.', { retryAfterSeconds: 60 });
    }
    if (
      code === 'email_address_not_authorized'
      || normalized.includes('email address not authorized')
      || normalized.includes('email_address_not_authorized')
    ) {
      return make('email_not_authorized', 'FrameUp cannot send confirmation emails to this address yet. Please contact suhail.quraishi@essentiallysports.com.');
    }
    if (normalized.includes('needs es designer admin approval') || normalized.includes('only @essentiallysports.com')) {
      return make('signup_blocked', 'This email needs approval from a FrameUp admin before it can create an account.');
    }
    if (code === 'signup_disabled' || normalized.includes('signups not allowed')) {
      return make('signup_disabled', 'New accounts are switched off right now. Ask a FrameUp admin for help.');
    }
    if (code === 'user_banned' || normalized.includes('banned')) {
      return make('user_banned', 'This account is paused. Ask a FrameUp admin for help.');
    }
    if (code === 'email_address_invalid' || /email address .* is invalid/.test(normalized)) {
      return make('email_invalid', 'Enter a valid email address.');
    }
    if (code === 'flow_state_expired' || code === 'flow_state_not_found' || code === 'bad_code_verifier' || normalized.includes('code verifier')) {
      return make('link_other_browser', 'Open the link in the same browser you used to ask for it, or ask for a new link here.');
    }
    if (
      code === 'otp_expired'
      || normalized.includes('otp expired')
      || normalized.includes('token has expired')
      || normalized.includes('invalid token')
      || normalized.includes('invalid claim')
      || normalized.includes('invalid or expired')
      || normalized.includes('is invalid or has expired')
      || normalized.includes('already been used')
    ) {
      return make('link_expired', 'This confirmation link has already been used or has expired. Your account may already be confirmed—return to login and try signing in.');
    }
    if (code === 'session_expired' || code === 'session_not_found' || code === 'refresh_token_not_found' || normalized.includes('refresh token')) {
      return make('session_expired', 'Your session has ended. Log in again to continue.');
    }
    if (normalized.includes('failed to fetch') || normalized.includes('networkerror') || normalized.includes('network request failed') || normalized.includes('load failed')) {
      return make('network', 'FrameUp couldn\'t reach the login service. Check your connection and try again.');
    }
    if (code === 'hook_timeout' || code === 'request_timeout' || code === 'unexpected_failure' || status >= 500) {
      return make('service_unavailable', 'The login service had a hiccup. Please try again in a moment.');
    }
    return make(code || 'unknown', message || fallback);
  }

  function safeLocalReturnTo(returnTo) {
    const fallback = 'index.html';
    if (!String(returnTo || '').trim()) return fallback;
    try {
      const target = new URL(String(returnTo), window.location.origin);
      if (target.origin !== window.location.origin) return fallback;
      if (/\/(?:auth-callback|login)\.html$/i.test(target.pathname)) return fallback;
      // Strip every leading slash: "//evil.example" would leave the site.
      const path = target.pathname.replace(/^[/\\]+/, '') || fallback;
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
      if (!existingScript) {
        // The browser refuses the file if the CDN ever serves different bytes.
        script.integrity = SUPABASE_SDK_INTEGRITY;
        script.crossOrigin = 'anonymous';
      }
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

  const PASSWORD_MIN = 8;
  // bcrypt (Supabase's hash) only reads the first 72 bytes.
  const PASSWORD_MAX_BYTES = 72;

  function passwordByteLength(password) {
    try {
      return new TextEncoder().encode(String(password || '')).length;
    } catch (error) {
      return String(password || '').length;
    }
  }

  // Rules shown live under the password field. Never logs the password.
  function passwordChecks(password) {
    const value = String(password || '');
    return {
      minLength: value.length >= PASSWORD_MIN,
      maxLength: passwordByteLength(value) <= PASSWORD_MAX_BYTES,
      noEdgeSpaces: value === value.trim(),
    };
  }

  function validatePassword(password) {
    const checks = passwordChecks(password);
    if (!checks.minLength) {
      throw authError('weak_password', 'Password must be at least 8 characters.', { friendly: true });
    }
    if (!checks.maxLength) {
      throw authError('weak_password', 'Password must be 72 characters or fewer.', { friendly: true });
    }
    if (!checks.noEdgeSpaces) {
      throw authError('weak_password', 'Password can\'t start or end with a space.', { friendly: true });
    }
  }

  // Per-address cooldown for auth emails, so a reload doesn't reset the timer
  // and the button can't fire into Supabase's per-address limit (60 s).
  const EMAIL_COOLDOWN_KEY = 'es.authEmailCooldown.v1';
  const EMAIL_COOLDOWN_SECONDS = 60;

  function readCooldowns() {
    try {
      const parsed = JSON.parse(window.sessionStorage.getItem(EMAIL_COOLDOWN_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function startEmailCooldown(email, seconds = EMAIL_COOLDOWN_SECONDS) {
    const normalized = normalizeEmail(email);
    if (!normalized) return 0;
    const until = Date.now() + Math.max(1, seconds) * 1000;
    try {
      const all = readCooldowns();
      Object.keys(all).forEach(key => { if (Number(all[key]) < Date.now()) delete all[key]; });
      all[normalized] = until;
      window.sessionStorage.setItem(EMAIL_COOLDOWN_KEY, JSON.stringify(all));
    } catch (error) {
      // Cooldown display is a nicety; Supabase still enforces its own limit.
    }
    return seconds;
  }

  function emailCooldownRemaining(email) {
    const until = Number(readCooldowns()[normalizeEmail(email)] || 0);
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  }

  function guardEmailCooldown(email) {
    const remaining = emailCooldownRemaining(email);
    if (remaining > 0) {
      throw authError(
        'email_rate_limited',
        `An email was sent to this address moments ago. You can ask for another in ${remaining} seconds.`,
        { friendly: true, retryAfterSeconds: remaining },
      );
    }
  }

  function rememberRateLimit(email, error) {
    if (error?.code === 'email_rate_limited' && error.retryAfterSeconds) {
      startEmailCooldown(email, error.retryAfterSeconds);
    }
    return error;
  }

  // Keeps es.ai.profile in step with the signed-in account WITHOUT dropping
  // what the person saved in Edit profile (role, team, note, photo, avatar…).
  // Same email: merge, and a name they typed wins over the account metadata.
  // Different email (another person on this browser): start fresh.
  function syncProfile({ name, email }) {
    const normalizedEmail = normalizeEmail(email);
    const accountName = String(name || '').trim();
    const fallbackName = normalizedEmail.split('@')[0] || 'Frameup User';
    try {
      const existing = readJson(PROFILE_STORAGE_KEY, null);
      const sameAccount = existing && typeof existing === 'object' && !Array.isArray(existing)
        && normalizeEmail(existing.email) === normalizedEmail;
      const base = sameAccount ? existing : {};
      const keptName = sameAccount ? String(existing.name || '').trim() : '';
      const next = {
        ...base,
        name: keptName || accountName || fallbackName,
        email: normalizedEmail,
      };
      const serialized = JSON.stringify(next);
      if (window.localStorage.getItem(PROFILE_STORAGE_KEY) !== serialized) {
        window.localStorage.setItem(PROFILE_STORAGE_KEY, serialized);
      }
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

    if (error) throw rememberRateLimit(normalizedEmail, friendlyAuthError(error, 'Unable to create account.'));
    // With email confirmation on, Supabase answers a sign-up for an address
    // that already has a confirmed account with a stand-in user that has no
    // identities, and sends NO email. Say so instead of leaving the person
    // waiting for a confirmation that never comes.
    if (data?.user && !data?.session && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw authError(
        'account_exists',
        'You already have a FrameUp account for this email. Log in, or reset your password if you’ve forgotten it.',
        { friendly: true },
      );
    }
    if (data?.session) await client.auth.signOut();
    if (!data?.session) startEmailCooldown(normalizedEmail);
    return {
      email: normalizedEmail,
      name: data?.user?.user_metadata?.name || String(name || '').trim() || normalizedEmail.split('@')[0] || 'Frameup User',
      role: 'Designer',
      requiresEmailConfirmation: !data?.session,
      cooldownSeconds: data?.session ? 0 : emailCooldownRemaining(normalizedEmail),
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
    // Signed in, but if the browser could not save the session every next page
    // would bounce back here with no message. Say so instead.
    if (data?.session && !hasStoredSupabaseSession()) {
      throw new Error('You were signed in, but this browser could not save the login (its storage for FrameUp is full or blocked). Clear this site\'s data in your browser settings, or use a private window, then log in again.');
    }

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
      throw new Error('Confirmation links are available only for approved FrameUp accounts.');
    }
    guardEmailCooldown(normalizedEmail);
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
    if (error) throw rememberRateLimit(normalizedEmail, friendlyAuthError(error, 'Unable to resend the confirmation email.'));
    rememberKnownEmail(normalizedEmail);
    startEmailCooldown(normalizedEmail);
    return true;
  }

  // Passwordless sign-in for EXISTING accounts (shouldCreateUser: false, so it
  // never creates one). Uses the same email sender and limits as confirmation.
  // Supabase answers "Signups not allowed for otp" when there's no account;
  // that is reported the same way as a sent link so this can't be used to
  // test which addresses have accounts.
  async function requestMagicLink({ email, redirectTo } = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      throw authError('email_invalid', 'Enter a valid email address.', { friendly: true });
    }
    if (!await isAllowedEmailAsync(normalizedEmail)) {
      throw authError('not_approved', 'Sign-in links are available only for approved FrameUp accounts.', { friendly: true });
    }
    guardEmailCooldown(normalizedEmail);
    if (!await ensureSupabaseReady()) throw authUnavailableError();
    const client = getSupabaseClient();
    if (!client) throw authUnavailableError();
    const { error } = await client.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: authCallbackUrl(redirectTo),
      },
    });
    if (error) {
      const message = String(error.message || '').toLowerCase();
      const noAccount = String(error.code || '') === 'otp_disabled' || message.includes('signups not allowed');
      if (!noAccount) throw rememberRateLimit(normalizedEmail, friendlyAuthError(error, 'Unable to send a sign-in link.'));
    }
    startEmailCooldown(normalizedEmail);
    return true;
  }

  async function completeAuthCallback() {
    if (!await ensureSupabaseReady()) throw authUnavailableError();
    const client = getSupabaseClient();
    if (!client) throw authUnavailableError();

    const liveUrl = new URL(window.location.href);
    const loadedUrl = initialHref ? new URL(initialHref) : liveUrl;
    // Same page, so prefer what was in the address bar when the page loaded.
    const currentUrl = loadedUrl.pathname === liveUrl.pathname ? loadedUrl : liveUrl;
    const hashParams = new URLSearchParams(currentUrl.hash.replace(/^#/, ''));
    const callbackError = currentUrl.searchParams.get('error_description')
      || currentUrl.searchParams.get('error')
      || hashParams.get('error_description')
      || hashParams.get('error');
    if (callbackError) {
      // Supabase sends e.g. #error=access_denied&error_code=otp_expired.
      const callbackErrorCode = currentUrl.searchParams.get('error_code') || hashParams.get('error_code') || '';
      throw friendlyAuthError({ message: callbackError, code: callbackErrorCode }, 'Unable to confirm this email.');
    }

    const code = currentUrl.searchParams.get('code');
    const tokenHash = currentUrl.searchParams.get('token_hash');
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    const requestedCallbackType = currentUrl.searchParams.get('type') || hashParams.get('type') || 'signup';
    const callbackType = AUTH_CALLBACK_TYPES.has(requestedCallbackType) ? requestedCallbackType : 'signup';
    let didProcessCredential = false;

    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw friendlyAuthError(error, 'Unable to confirm this email.');
      didProcessCredential = true;
    } else if (tokenHash) {
      const { error } = await client.auth.verifyOtp({
        token_hash: tokenHash,
        type: callbackType,
      });
      if (error) throw friendlyAuthError(error, 'Unable to confirm this email.');
      didProcessCredential = true;
    } else if (accessToken && refreshToken) {
      const { error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw friendlyAuthError(error, 'Unable to start your confirmed session.');
      didProcessCredential = true;
    }

    const session = await getSession();
    if (!session?.token) {
      if (didProcessCredential) {
        return {
          token: '',
          user: null,
          callbackType,
          requiresLogin: true,
        };
      }
      throw authError('link_expired', 'This confirmation link has already been used or has expired. Your account may already be confirmed—return to login and try signing in.', { friendly: true });
    }
    rememberKnownEmail(session.user.email);
    return { ...session, callbackType, processedCredential: didProcessCredential };
  }

  async function requestPasswordReset({ email, redirectTo }) {
    const normalizedEmail = normalizeEmail(email);
    if (!await isAllowedEmailAsync(normalizedEmail)) {
      throw new Error('Password reset is available only for approved FrameUp accounts.');
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

    guardEmailCooldown(normalizedEmail);
    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: safeRedirectTo,
    });
    if (error) throw rememberRateLimit(normalizedEmail, friendlyAuthError(error, 'Unable to send the password reset email.'));
    startEmailCooldown(normalizedEmail);
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
      // Personal details shouldn't outlive the session on a shared machine.
      [PROFILE_STORAGE_KEY, ACCESS_REQUESTS_KEY, KNOWN_EMAILS_KEY].forEach(key => window.localStorage.removeItem(key));
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

  async function deleteAccount({ confirmationEmail } = {}) {
    if (!await ensureSupabaseReady()) throw authUnavailableError();

    const session = await getSession();
    const accountEmail = normalizeEmail(session?.user?.email);
    const confirmedEmail = normalizeEmail(confirmationEmail);
    if (!session?.token || !accountEmail) {
      throw new Error('Please log in again before deleting your account.');
    }
    if (confirmedEmail !== accountEmail) {
      throw new Error('Enter your signed-in ES email exactly to confirm deletion.');
    }

    const client = getSupabaseClient();
    const { data, error } = await client.rpc('delete_own_frameup_account');
    if (error) {
      const message = String(error.message || '').toLowerCase();
      if (message.includes('could not find the function') || message.includes('schema cache')) {
        throw new Error('Account deletion is being configured. Please try again shortly.');
      }
      throw friendlyAuthError(error, 'Unable to delete your account right now.');
    }
    if (data !== true) throw new Error('Unable to confirm that your account was deleted.');

    try {
      window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
      window.localStorage.removeItem(PROFILE_STORAGE_KEY);
      const remainingKnownEmails = getKnownEmails().filter(email => email !== accountEmail);
      writeJson(KNOWN_EMAILS_KEY, remainingKnownEmails);
    } catch (storageError) {
      // The server-side account deletion has already succeeded. Storage cleanup
      // is best-effort for browsers that block local storage.
    }

    try {
      await client.auth.signOut({ scope: 'local' });
    } catch (signOutError) {
      // Deleting auth.users invalidates the session server-side even when the
      // local SDK cannot complete its normal sign-out request.
    }
    return true;
  }

  // The page to come back to after logging in: the caller's choice, else the
  // page the person is on now (path + query + hash), never login itself.
  function currentReturnTo() {
    try {
      const path = String(window.location.pathname || '').replace(/^[/\\]+/, '');
      if (!path || /(?:^|\/)(?:login|auth-callback|reset-password)\.html$/i.test(path)) return 'index.html';
      return `${path}${window.location.search || ''}${window.location.hash || ''}`;
    } catch (error) {
      return 'index.html';
    }
  }

  function loginUrl(returnTo) {
    const loginPath = window.location.pathname.includes('/ai-page/') ? '../login.html' : 'login.html';
    return `${loginPath}?redirect=${encodeURIComponent(returnTo || currentReturnTo())}`;
  }

  // True when this tab had a signed-in session earlier (mirrored copy in
  // sessionStorage) — so "no session" now means it expired or was ended.
  function hadSessionInThisTab() {
    try {
      return Boolean(window.sessionStorage.getItem(AUTH_STORAGE_KEY));
    } catch (error) {
      return false;
    }
  }

  // What the page guard knows about the current visitor:
  //   'valid'        signed in and approved
  //   'no-session'   no saved login in this browser
  //   'not-approved' signed in, but the email is not approved for FrameUp
  // It throws when it cannot tell (login service not loaded, lookups failed):
  // that is never a reason to sign anyone out.
  async function sessionStatus() {
    if (!await ensureSupabaseReady()) throw authUnavailableError();
    const client = getSupabaseClient();
    if (!client) throw authUnavailableError();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const supabaseSession = data?.session;
    if (!supabaseSession?.access_token) return 'no-session';
    const allowed = await isAllowedEmailAsync(supabaseSession.user?.email);
    if (allowed === null) throw new Error('The approval check could not be completed.');
    if (!allowed) return 'not-approved';
    await getSession(); // keep the mirrored session and profile in sync
    return 'valid';
  }

  function requireAuth(returnTo) {
    document.documentElement.style.visibility = 'hidden';
    return (async () => {
      // A slow network, a slow CDN or a failed lookup must not sign people
      // out. The check gets a second, longer try; the session is only cleared
      // when the account is definitely not approved. Every trip back to the
      // login page carries a reason so the page can explain what happened.
      let reason = 'check-failed';
      for (const timeoutMs of [10000, 20000]) {
        try {
          const status = await withTimeout(sessionStatus(), timeoutMs, 'Authentication check timed out.');
          if (status === 'valid') {
            document.documentElement.style.visibility = '';
            window.dispatchEvent(new CustomEvent('es:auth-ready'));
            return true;
          }
          reason = status;
          break;
        } catch (error) {
          reason = 'check-failed';
        }
      }
      if (reason === 'not-approved') await logout();
      if (reason === 'no-session' && hadSessionInThisTab()) {
        reason = 'session-expired';
        try { window.sessionStorage.removeItem(AUTH_STORAGE_KEY); } catch (error) { /* ignore */ }
      }
      window.location.replace(`${loginUrl(returnTo)}&reason=${reason}`);
      return false;
    })();
  }

  // True when the browser actually stored the Supabase session (it can fail
  // silently when this site's storage is full or blocked).
  function hasStoredSupabaseSession() {
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index) || '';
        if (key.startsWith('sb-') && key.endsWith('-auth-token') && window.localStorage.getItem(key)) return true;
      }
    } catch (error) {
      return false;
    }
    return false;
  }

  window.ESAuth = Object.freeze({
    AUTH_STORAGE_KEY,
    approvedEmails,
    approvedDomains,
    authCallbackUrl,
    completeAuthCallback,
    createAccount,
    deleteAccount,
    emailCooldownRemaining,
    friendlyAuthError,
    passwordChecks,
    requestMagicLink,
    PASSWORD_MIN,
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
    sessionStatus,
    updatePassword,
  });
})();
