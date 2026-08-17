const crypto = require('crypto');
const { verifyEsUser } = require('./_supabase-auth.js');

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_SHEET_ID = '10YG34yp-Ox2fRfVZ5Yl0kz8fSZo-sBQJB62aeGpu0jU';

const HEADERS = [
  'Feedback ID',
  'Submitted At',
  'Submitter Email',
  'Feedback Type',
  'Related Tool',
  'Message',
  'Page URL',
  'Source',
];

const FEEDBACK_TYPES = new Set(['Bug', 'Idea', 'Praise', 'Other']);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin',
    },
    body: JSON.stringify(body),
  };
}

function requiredConfig() {
  return {
    spreadsheetId: process.env.GOOGLE_FEEDBACK_SHEETS_ID || DEFAULT_SHEET_ID,
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    range: process.env.GOOGLE_FEEDBACK_SHEETS_RANGE || 'Sheet1!A:H',
  };
}

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt({ clientEmail, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey);
  return `${unsigned}.${base64Url(signature)}`;
}

async function getAccessToken(config) {
  const assertion = signJwt(config);
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Google token request failed');
  }
  return data.access_token;
}

function cleanString(value, maxLength) {
  const result = String(value ?? '').trim();
  return maxLength ? result.slice(0, maxLength) : result;
}

function generateFeedbackId(createdAt) {
  const date = new Date(createdAt);
  const stamp = Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
  return `FB-${stamp.toString(36).toUpperCase()}`;
}

function toSheetRow(record) {
  return [
    record.id,
    record.createdAt,
    record.email,
    record.feedbackType,
    record.tool,
    record.message,
    record.pageUrl,
    record.source,
  ].map(value => value ?? '');
}

async function appendToSheet(record, config) {
  const accessToken = await getAccessToken(config);
  const encodedRange = encodeURIComponent(config.range);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodedRange}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: [toSheetRow(record)],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'Google Sheets append failed');
  }
  return data;
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Cache-Control': 'no-store',
        Vary: 'Origin',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  try {
    const auth = await verifyEsUser(event);
    if (!auth.ok) {
      return json(auth.statusCode, { ok: false, error: auth.error });
    }

    const payload = JSON.parse(event.body || '{}');
    const message = cleanString(payload.message, 4000);
    if (!message) {
      return json(400, { ok: false, error: 'Feedback message is required.' });
    }

    const feedbackType = FEEDBACK_TYPES.has(payload.feedbackType) ? payload.feedbackType : 'Other';
    const createdAt = new Date().toISOString();
    const record = {
      id: generateFeedbackId(createdAt),
      createdAt,
      email: auth.user.email,
      feedbackType,
      tool: cleanString(payload.tool, 120) || 'General',
      message,
      pageUrl: cleanString(payload.pageUrl, 300),
      source: 'FrameUp Tool Feedback',
    };

    const sheetConfig = requiredConfig();
    if (!sheetConfig.clientEmail || !sheetConfig.privateKey) {
      return json(200, {
        ok: false,
        skipped: true,
        reason: 'missing_integration_config',
      });
    }

    try {
      const result = await appendToSheet(record, sheetConfig);
      return json(200, {
        ok: true,
        id: record.id,
        updatedRange: result.updates?.updatedRange || null,
      });
    } catch (error) {
      return json(502, {
        ok: false,
        error: error.message || 'Google Sheets append failed',
      });
    }
  } catch (error) {
    return json(500, {
      ok: false,
      error: error.message || 'Unable to record feedback',
    });
  }
};

exports.HEADERS = HEADERS;
