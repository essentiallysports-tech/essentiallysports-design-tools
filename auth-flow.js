/* FrameUp auth flow helpers (login, auth-callback, reset-password).
 * Pure functions, no DOM and no network: what to say and which next step to
 * offer for each auth outcome. UMD: window.FrameUpAuthFlow / module.exports.
 * Never receives or logs passwords (password rules take a checks object).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrameUpAuthFlow = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUPABASE_SENDER = 'noreply@mail.app.supabase.io';
  const SPAM_HELP = `Not there after a couple of minutes? Check Spam, Junk and your company's email quarantine for a message from “Supabase Auth” (${SUPABASE_SENDER}).`;
  const LIMIT_HELP = 'Our email sender only allows a few emails per hour for the whole team, so a resend can fail for a few minutes. If you’re stuck, a FrameUp admin can confirm your account from the Dashboard.';

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // 'invalid' | 'es' (allowed domain) | 'listed' (named exception) | 'other'.
  function classifyEmail(email, { domains = [], emails = [] } = {}) {
    const normalized = normalizeEmail(email);
    if (!EMAIL_PATTERN.test(normalized)) return 'invalid';
    if (emails.map(normalizeEmail).includes(normalized)) return 'listed';
    const domain = normalized.split('@').pop();
    if (domains.map(item => String(item || '').toLowerCase().replace(/^@/, '')).includes(domain)) return 'es';
    return 'other';
  }

  function formatCountdown(seconds) {
    const total = Math.max(0, Math.ceil(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const rest = String(total % 60).padStart(2, '0');
    return `${minutes}:${rest}`;
  }

  // Password rules for the live checklist. `checks` comes from
  // ESAuth.passwordChecks(password): { minLength, maxLength, noEdgeSpaces }.
  function passwordRules(checks = {}) {
    return [
      { id: 'min', label: 'At least 8 characters', met: Boolean(checks.minLength) },
      { id: 'max', label: 'No more than 72 characters', met: checks.maxLength !== false },
      { id: 'spaces', label: 'No space at the start or end', met: checks.noEdgeSpaces !== false },
    ];
  }

  function passwordOk(checks = {}) {
    return passwordRules(checks).every(rule => rule.met);
  }

  // What the login page should show for a failed action.
  //   message   text for the alert
  //   actions   next steps to offer: 'resend' | 'login' | 'reset' | 'create' | 'magic'
  //   cooldown  seconds before another email can be asked for (0 = none)
  //   panel     a full panel to switch to instead of an inline error
  function outcomeForError(error, { mode = 'login' } = {}) {
    const code = String(error?.code || '');
    const message = String(error?.message || 'Something went wrong. Please try again.');
    const cooldown = Number(error?.retryAfterSeconds || 0);
    switch (code) {
      case 'account_exists':
        return { panel: 'exists', message, actions: ['login', 'reset'], cooldown: 0 };
      case 'email_not_confirmed':
        return { message, actions: ['resend'], cooldown: 0 };
      case 'invalid_credentials':
        return { message, actions: mode === 'login' ? ['reset', 'magic'] : [], cooldown: 0 };
      case 'email_rate_limited':
        return { message: `${message} ${cooldown ? '' : LIMIT_HELP}`.trim(), actions: [], cooldown: cooldown || 60 };
      case 'rate_limited':
        return { message, actions: [], cooldown: cooldown || 60 };
      case 'storage_failed':
      case 'clock_skew':
        return { message, actions: ['fix'], cooldown: 0 };
      case 'access_requested':
        return { panel: 'requested', message, actions: [], cooldown: 0 };
      case 'link_expired':
      case 'link_other_browser':
        return { message, actions: ['resend', 'login'], cooldown: 0 };
      default:
        return { message, actions: [], cooldown: 0 };
    }
  }

  // Copy for the "check your inbox" panel by what was sent.
  function inboxCopy(kind, email) {
    const who = normalizeEmail(email);
    const copy = {
      confirm: {
        title: 'Check your inbox',
        body: `We sent a confirmation link to ${who}. Click it once to activate your account. There’s no code to enter.`,
        resend: 'Resend link',
      },
      reset: {
        title: 'Reset link sent',
        body: `If ${who} has a FrameUp account, a password reset link is on its way. It works once and expires after an hour.`,
        resend: 'Send again',
      },
      magic: {
        title: 'Check your inbox',
        body: `If ${who} has a FrameUp account, a one-time sign-in link is on its way. Open it in this browser. No account yet? Create one first.`,
        resend: 'Send again',
      },
    };
    return { ...(copy[kind] || copy.confirm), spamHelp: SPAM_HELP, limitHelp: LIMIT_HELP };
  }

  // Copy for auth-callback.html after a link was used successfully.
  function callbackSuccessCopy(type, { requiresLogin = false } = {}) {
    if (type === 'magiclink') {
      return { title: 'You’re signed in', body: 'Taking you to FrameUp now.', next: 'continue' };
    }
    if (type === 'email_change' || type === 'email') {
      return { title: 'Email updated', body: 'Your FrameUp email address is confirmed.', next: requiresLogin ? 'login' : 'continue' };
    }
    if (type === 'invite' || type === 'recovery') {
      return { title: 'Choose a password', body: 'One more step: set a password for your account.', next: 'password' };
    }
    return {
      title: 'Email confirmed',
      body: requiresLogin
        ? 'Your FrameUp account is ready. Log in with your password to continue.'
        : 'Your FrameUp account is ready. Taking you to the workspace now.',
      next: requiresLogin ? 'login' : 'continue',
    };
  }

  return {
    SUPABASE_SENDER,
    SPAM_HELP,
    LIMIT_HELP,
    classifyEmail,
    formatCountdown,
    passwordRules,
    passwordOk,
    outcomeForError,
    inboxCopy,
    callbackSuccessCopy,
  };
});
