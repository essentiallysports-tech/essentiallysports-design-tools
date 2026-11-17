'use strict';

// Slack for Design Requests. Two modes, chosen by env, both optional:
//
//   bot      SLACK_BOT_TOKEN (xoxb-…) + SLACK_DESIGN_REQUEST_CHANNEL (channel id).
//            Posts with chat.postMessage, so we get the message ts back and
//            every later update replies in the request's thread.
//   webhook  SLACK_DESIGN_REQUEST_WEBHOOK_URL (the existing integration).
//            Incoming webhooks can't thread or return a ts, so updates are
//            separate messages that name the request.
//   off      neither set: nothing is posted, callers report "skipped".
//
// Bot mode wins when both are set. Tests pass their own fetch; nothing here
// ever runs against Slack in tests.

const crypto = require('crypto');

const SLACK_API = 'https://slack.com/api';
const SIGNATURE_MAX_AGE_SECONDS = 60 * 5;

function slackConfig(env = process.env) {
  const botToken = String(env.SLACK_BOT_TOKEN || '').trim();
  const channel = String(env.SLACK_DESIGN_REQUEST_CHANNEL || '').trim();
  const webhookUrl = String(env.SLACK_DESIGN_REQUEST_WEBHOOK_URL || '').trim();
  const mode = botToken && channel ? 'bot' : (webhookUrl ? 'webhook' : 'off');
  return {
    mode,
    botToken,
    channel,
    webhookUrl,
    appUrl: String(env.FRAMEUP_APP_URL || 'https://frameup.essentiallysports.com').replace(/\/+$/, ''),
    // Comments go to the thread in bot mode unless turned off. Webhook mode
    // never posts comments (each would be a new channel message).
    threadComments: String(env.SLACK_THREAD_COMMENTS || '1') !== '0',
  };
}

function escapeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 2800);
}

function trackUrl(config, requestId) {
  return `${config.appUrl}/requests.html?id=${encodeURIComponent(requestId || '')}`;
}

// ── Signature verification (slash commands, interactivity) ──────────────────
// https://api.slack.com/authentication/verifying-requests-from-slack
function verifySlackSignature({ signingSecret, timestamp, signature, rawBody, now = Date.now() }) {
  if (!signingSecret) return { ok: false, reason: 'not_configured' };
  if (!timestamp || !signature || typeof rawBody !== 'string') return { ok: false, reason: 'missing_signature' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(now / 1000) - ts) > SIGNATURE_MAX_AGE_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }
  const expected = `v0=${crypto.createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  return { ok: true };
}

// ── Transport ─────────────────────────────────────────────────────────────
async function callSlackApi(method, body, config, fetchImpl = fetch) {
  const response = await fetchImpl(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(`Slack ${method} failed: ${data.error || response.status}`);
  }
  return data;
}

async function postWebhook(payload, config, fetchImpl = fetch) {
  const response = await fetchImpl(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(text || `Slack webhook failed with status ${response.status}`);
  return text;
}

// Post a message. In bot mode returns { channel, ts } for threading.
async function postMessage(payload, config, { threadTs = '', channel = '' } = {}, fetchImpl = fetch) {
  if (config.mode === 'bot') {
    const body = { channel: channel || config.channel, unfurl_links: false, unfurl_media: false, ...payload };
    if (threadTs) body.thread_ts = threadTs;
    const data = await callSlackApi('chat.postMessage', body, config, fetchImpl);
    return { mode: 'bot', channel: data.channel || body.channel, ts: data.ts || '', threaded: Boolean(threadTs) };
  }
  if (config.mode === 'webhook') {
    await postWebhook(payload, config, fetchImpl);
    return { mode: 'webhook', channel: '', ts: '', threaded: false };
  }
  return { mode: 'off', skipped: true };
}

// Bot mode only: the email behind a Slack user (needs users:read.email).
async function lookupUserEmail(userId, config, fetchImpl = fetch) {
  if (config.mode !== 'bot' || !userId) return null;
  const response = await fetchImpl(`${SLACK_API}/users.info?user=${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${config.botToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!data.ok) return null;
  return {
    email: String(data.user?.profile?.email || '').trim().toLowerCase(),
    name: String(data.user?.real_name || data.user?.profile?.real_name || data.user?.name || '').trim(),
  };
}

// ── Messages for request events ─────────────────────────────────────────────
const STATUS_LABELS = {
  Backlog: 'New', Assigned: 'Assigned', Doing: 'In progress', Review: 'In review', Done: 'Done', Declined: 'Declined',
};
const STATUS_ICONS = {
  Backlog: ':new:', Assigned: ':bust_in_silhouette:', Doing: ':art:', Review: ':eyes:', Done: ':white_check_mark:', Declined: ':no_entry_sign:',
};

function labelStatus(value) {
  return STATUS_LABELS[value] || escapeText(value, 'New');
}

function personLabel(email) {
  const value = String(email || '').trim();
  if (!value) return 'nobody';
  if (value === 'system' || value === 'slack') return 'FrameUp';
  return escapeText(value.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
}

function formatDue(value) {
  if (!value) return 'no due date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeText(value);
  return `${date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' })} ET`;
}

// One line per event. Returns '' for events that should not be posted.
function eventLine(event = {}, config = {}) {
  const who = personLabel(event.actor_email);
  switch (event.kind) {
    case 'status': {
      const icon = STATUS_ICONS[event.to_value] || ':arrows_counterclockwise:';
      const reason = event.body ? `\n>${escapeText(event.body).replace(/\n/g, '\n>')}` : '';
      return `${icon} *${labelStatus(event.to_value)}*: ${who} moved it from ${labelStatus(event.from_value)}.${reason}`;
    }
    case 'assign':
      return event.to_value
        ? `:bust_in_silhouette: Assigned to *${personLabel(event.to_value)}* by ${who}.`
        : `:bust_in_silhouette: Unassigned by ${who}.`;
    case 'due':
      return `:calendar: Due date set to *${formatDue(event.to_value)}* by ${who}.`;
    case 'priority':
      return `:triangular_flag_on_post: Priority set to *${escapeText(event.to_value)}* by ${who}.`;
    case 'delivery': {
      const url = String(event.meta?.url || '').trim();
      const label = escapeText(event.to_value, 'Design');
      const link = /^https?:\/\//i.test(url) ? `<${url.replace(/[<>|]/g, '')}|${label}>` : `*${label}*`;
      return `:frame_with_picture: ${who} attached ${link}.`;
    }
    case 'comment':
      if (config.mode !== 'bot' || !config.threadComments) return '';
      return `:speech_balloon: *${personLabel(event.actor_email)}*: ${escapeText(event.body)}`;
    default:
      return '';
  }
}

function buildUpdatePayload(request = {}, events = [], config = {}, { threaded = false } = {}) {
  const lines = events.map(event => eventLine(event, config)).filter(Boolean);
  if (!lines.length) return null;
  const requestId = request.source_id || request.sourceId || '';
  const title = escapeText(request.title, requestId || 'Design request');
  const link = `<${trackUrl(config, requestId)}|Open in FrameUp>`;
  // In a thread the parent already names the request.
  const header = threaded ? '' : `*${escapeText(requestId)}* · ${title}\n`;
  const text = `${header}${lines.join('\n')}\n${link}`;
  return {
    text: threaded ? lines.join('\n') : `Update on ${requestId}: ${lines[0].replace(/[*:]/g, '')}`,
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
  };
}

// Post claimed events for one request. Starts a thread in bot mode when the
// request has none yet and returns it so the caller can store it.
async function postRequestUpdate(request = {}, events = [], config = slackConfig(), fetchImpl = fetch) {
  if (config.mode === 'off') return { ok: false, skipped: true, mode: 'off' };
  const metadata = request.metadata && typeof request.metadata === 'object' ? request.metadata : {};
  const threadTs = String(request.slack_thread_ts || metadata.slackThreadTs || '').trim();
  const channel = String(request.slack_channel || metadata.slackChannel || '').trim();
  const threaded = config.mode === 'bot' && Boolean(threadTs);
  const payload = buildUpdatePayload(request, events, config, { threaded });
  if (!payload) return { ok: true, skipped: true, mode: config.mode, posted: 0 };
  const result = await postMessage(payload, config, { threadTs: threaded ? threadTs : '', channel: threaded ? channel : '' }, fetchImpl);
  return {
    ok: true,
    mode: result.mode,
    posted: 1,
    threaded: result.threaded,
    // A new top-level bot message becomes the request's thread from now on.
    newThread: config.mode === 'bot' && !threaded && result.ts ? { channel: result.channel, ts: result.ts } : null,
  };
}

module.exports = {
  SIGNATURE_MAX_AGE_SECONDS,
  slackConfig,
  escapeText,
  trackUrl,
  verifySlackSignature,
  callSlackApi,
  postWebhook,
  postMessage,
  lookupUserEmail,
  eventLine,
  buildUpdatePayload,
  postRequestUpdate,
};
