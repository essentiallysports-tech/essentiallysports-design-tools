const crypto = require('crypto');
const { verifyEsUser } = require('./_supabase-auth.js');

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const HEADERS = [
  'Request ID',
  'Created At',
  'Status',
  'Request Type',
  'Requester Name',
  'Requester Email',
  'Department',
  'Publication',
  'Social Channel',
  'Sport',
  'Team or League',
  'Title',
  'Entities',
  'Brief',
  'Design Copy',
  'Reference Links',
  'Reference Files',
  'Additional Notes',
  'Priority',
  'Design Needed By',
  'Publish At',
  'Source',
];

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
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    range: process.env.GOOGLE_SHEETS_RANGE || 'Sheet1!A:V',
  };
}

function slackConfig() {
  return {
    webhookUrl: process.env.SLACK_DESIGN_REQUEST_WEBHOOK_URL,
  };
}

function emailConfig() {
  return {
    endpointUrl: process.env.DESIGN_REQUEST_EMAIL_ENDPOINT || process.env.EMAIL_DESIGN_REQUEST_ENDPOINT,
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

function list(value) {
  if (Array.isArray(value)) return value.join('\n');
  return value || '';
}

function files(value) {
  if (!Array.isArray(value)) return '';
  return value.map(file => file?.name || '').filter(Boolean).join('\n');
}

function toSheetRow(record) {
  return [
    record.id,
    record.createdAt,
    record.status,
    record.requestType,
    record.requester?.name,
    record.requester?.email,
    record.requester?.department,
    record.publication,
    record.socialChannel,
    record.sport,
    record.teamOrLeague,
    record.title,
    record.entities,
    record.brief,
    record.designCopy,
    list(record.referenceLinks),
    files(record.referenceFiles),
    record.additionalNotes,
    record.priority,
    record.designDueAt,
    record.publishAt,
    record.source,
  ].map(value => value ?? '');
}

function slackText(value, fallback = 'Not provided') {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, 2800);
}

function slackDate(value) {
  if (!value) return 'Not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return slackText(value);
  return date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/New_York',
  }) + ' ET';
}

function requestTypeLabel(value) {
  return {
    newsletter: 'Newsletter Graphic',
    'web-feature': 'Web Feature Image',
    social: 'Social Media Graphic',
  }[value] || slackText(value);
}

function priorityPresentation(value) {
  const priority = String(value || 'Normal').toLowerCase();
  if (priority === 'urgent') return { label: '🔴 Urgent', color: '#D92D20' };
  if (priority === 'high') return { label: '🟠 High', color: '#F79009' };
  return { label: '🔵 Normal', color: '#0A7DFA' };
}

function slackLinks(values) {
  if (!Array.isArray(values) || !values.length) return 'None';
  return values
    .slice(0, 8)
    .map((value, index) => {
      const url = String(value || '').trim();
      return url ? `<${url.replace(/>/g, '%3E')}|Reference ${index + 1}>` : '';
    })
    .filter(Boolean)
    .join('  •  ') || 'None';
}

function buildSlackPayload(record) {
  const priority = priorityPresentation(record.priority);
  const requesterName = slackText(record.requester?.name);
  const requesterEmail = String(record.requester?.email || '').trim();
  const requester = requesterEmail
    ? `${requesterName}\n<mailto:${requesterEmail.replace(/>/g, '')}|${slackText(requesterEmail)}>`
    : requesterName;
  const title = record.title || record.entities || requestTypeLabel(record.requestType);
  const location = [
    record.publication,
    record.socialChannel,
    record.sport,
    record.teamOrLeague,
  ].filter(Boolean).map(value => slackText(value)).join(' • ') || 'Not provided';
  const referenceFiles = files(record.referenceFiles) || 'None';

  return {
    text: `New design request ${record.id}: ${slackText(title)}`,
    attachments: [
      {
        color: priority.color,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '🎨 New Design Request',
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Request ID*\n\`${slackText(record.id)}\`` },
              { type: 'mrkdwn', text: `*Priority*\n${priority.label}` },
              { type: 'mrkdwn', text: `*Request Type*\n${requestTypeLabel(record.requestType)}` },
              { type: 'mrkdwn', text: `*Requester*\n${requester}` },
              { type: 'mrkdwn', text: `*Publication / Channel*\n${location}` },
              { type: 'mrkdwn', text: `*Status*\n${slackText(record.status || 'New')}` },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Title / Entities*\n${slackText(title)}`,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Creative Brief*\n${slackText(record.brief)}`,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Design Copy*\n${slackText(record.designCopy)}` },
              { type: 'mrkdwn', text: `*Additional Notes*\n${slackText(record.additionalNotes)}` },
            ],
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Design Needed By*\n${slackDate(record.designDueAt)}` },
              { type: 'mrkdwn', text: `*Publish At*\n${slackDate(record.publishAt)}` },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*References*\n${slackLinks(record.referenceLinks)}\n*Files:* ${slackText(referenceFiles, 'None')}`,
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Submitted ${slackDate(record.createdAt)} via ${slackText(record.source || 'ES Designer')}`,
              },
            ],
          },
        ],
      },
    ],
  };
}

async function postToSlack(record, config) {
  const response = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSlackPayload(record)),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(responseText || `Slack webhook failed with status ${response.status}`);
  }
  return responseText;
}

function cleanString(value) {
  const result = String(value ?? '').trim();
  return result || undefined;
}

function cleanArray(values) {
  if (!Array.isArray(values)) return undefined;
  const result = values.map(cleanString).filter(Boolean);
  return result.length ? result : undefined;
}

function cleanRequester(requester = {}) {
  const result = {
    name: cleanString(requester.name),
    email: cleanString(requester.email),
  };
  return Object.values(result).some(Boolean) ? result : undefined;
}

function withoutEmptyValues(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === undefined || item === null || item === '') return false;
      if (Array.isArray(item)) return item.length > 0;
      if (typeof item === 'object') return Object.values(item).some(Boolean);
      return true;
    })
  );
}

function buildEmailPayload(record = {}) {
  return withoutEmptyValues({
    id: cleanString(record.id),
    priority: cleanString(record.priority),
    requestType: cleanString(record.requestType),
    status: cleanString(record.status),
    publication: cleanString(record.publication),
    socialChannel: cleanString(record.socialChannel),
    sport: cleanString(record.sport),
    teamOrLeague: cleanString(record.teamOrLeague),
    requester: cleanRequester(record.requester),
    title: cleanString(record.title),
    entities: cleanString(record.entities),
    brief: cleanString(record.brief),
    designCopy: cleanString(record.designCopy),
    additionalNotes: cleanString(record.additionalNotes),
    designDueAt: cleanString(record.designDueAt),
    publishAt: cleanString(record.publishAt),
    referenceLinks: cleanArray(record.referenceLinks),
    createdAt: cleanString(record.createdAt),
  });
}

async function postToEmail(record, config) {
  const response = await fetch(config.endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildEmailPayload(record)),
  });
  const responseText = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(responseText || `Email request failed with status ${response.status}`);
  }
  return responseText;
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
    if (!payload.record?.id) {
      return json(400, { ok: false, error: 'Missing design request record' });
    }

    const sheetConfig = requiredConfig();
    const slack = slackConfig();
    const email = emailConfig();
    const integrations = {
      googleSheets: {
        ok: false,
        skipped: !sheetConfig.spreadsheetId || !sheetConfig.clientEmail || !sheetConfig.privateKey,
      },
      slack: {
        ok: false,
        skipped: !slack.webhookUrl,
      },
      email: {
        ok: false,
        skipped: !email.endpointUrl,
      },
    };

    if (!integrations.googleSheets.skipped) {
      try {
        const result = await appendToSheet(payload.record, sheetConfig);
        integrations.googleSheets = {
          ok: true,
          skipped: false,
          updatedRange: result.updates?.updatedRange || null,
        };
      } catch (error) {
        integrations.googleSheets.error = error.message || 'Google Sheets append failed';
      }
    }

    if (!integrations.slack.skipped) {
      try {
        await postToSlack(payload.record, slack);
        integrations.slack = { ok: true, skipped: false };
      } catch (error) {
        integrations.slack.error = error.message || 'Slack webhook failed';
      }
    }

    if (!integrations.email.skipped) {
      try {
        await postToEmail(payload.record, email);
        integrations.email = { ok: true, skipped: false };
      } catch (error) {
        integrations.email.error = error.message || 'Email request failed';
      }
    }

    const configured = Object.values(integrations).filter(item => !item.skipped);
    const failed = configured.filter(item => !item.ok);
    const succeeded = configured.filter(item => item.ok);

    return json(200, {
      ok: failed.length === 0 && succeeded.length > 0,
      skipped: configured.length === 0,
      reason: configured.length === 0 ? 'missing_integration_config' : undefined,
      integrations,
      requiredHeaders: HEADERS,
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error.message || 'Unable to sync design request',
    });
  }
};
