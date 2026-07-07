'use strict';

const DEFAULT_SUPABASE_URL = 'https://xtdusejokbhtjlmijdca.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_1T9d9U0qXD5K-Ay-_43IVA_Qdd1dpHF';
const ES_EMAIL_DOMAIN = 'essentiallysports.com';

function authConfig() {
  return {
    url: String(
      process.env.SUPABASE_URL
      || process.env.NEXT_PUBLIC_SUPABASE_URL
      || DEFAULT_SUPABASE_URL
    ).replace(/\/+$/, ''),
    publishableKey: String(
      process.env.SUPABASE_PUBLISHABLE_KEY
      || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      || DEFAULT_SUPABASE_PUBLISHABLE_KEY
    ),
  };
}

function readHeader(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const target = String(name || '').toLowerCase();
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === target);
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function bearerToken(headers) {
  const authorization = readHeader(headers, 'authorization').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isEsEmail(email) {
  const normalized = normalizeEmail(email);
  return normalized.endsWith(`@${ES_EMAIL_DOMAIN}`)
    && normalized.split('@').length === 2;
}

async function verifyEsUser(event = {}) {
  const token = bearerToken(event.headers);
  if (!token) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Authentication required.',
    };
  }

  const config = authConfig();
  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    const user = await response.json().catch(() => null);

    if (!response.ok || !user?.id || !isEsEmail(user.email)) {
      return {
        ok: false,
        statusCode: response.status === 403 ? 403 : 401,
        error: 'Invalid or expired ES Designer session.',
      };
    }

    return {
      ok: true,
      user: {
        id: String(user.id),
        email: normalizeEmail(user.email),
      },
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 503,
      error: 'Authentication service is temporarily unavailable.',
    };
  }
}

module.exports = {
  ES_EMAIL_DOMAIN,
  bearerToken,
  isEsEmail,
  verifyEsUser,
};
