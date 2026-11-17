'use strict';

// /frameup slash command: file or look up a design request from Slack.
//
//   /frameup request <brief> [priority:urgent|high|normal] [due:YYYY-MM-DD]
//   /frameup status DR-20261118-AB12
//   /frameup help
//
// Every request must carry a valid Slack signature (SLACK_SIGNING_SECRET).
// Without the secret the endpoint refuses everything. Filing straight into
// FrameUp also needs SLACK_BOT_TOKEN + SLACK_DESIGN_REQUEST_CHANNEL (to post
// the thread and read the person's email, scope users:read.email) and
// SUPABASE_SERVICE_ROLE_KEY (to save the request with no FrameUp session).
// When those are missing, the command answers with a pre-filled form link.
// See project-docs/slack-app-setup.md.

const slack = require('./_slack.js');
const rest = require('./_supabase-rest.js');
const lifecycle = require('../../request-lifecycle.js');
const { isEsEmail } = require('./_supabase-auth.js');
const { buildSlackPayload } = require('./design-request-submit.js');

function readHeader(headers = {}, name) {
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === name);
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function reply(text, { inChannel = false, statusCode = 200 } = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ response_type: inChannel ? 'in_channel' : 'ephemeral', text }),
  };
}

function refuse(statusCode, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    body: message,
  };
}

const HELP = [
  '*FrameUp design requests*',
  '• `/frameup request <what you need>` files a request. Add `priority:urgent` or `due:2026-11-20` anywhere.',
  '• `/frameup status DR-20261118-AB12` shows where a request is.',
  '• Track all of yours at <{APP}/requests.html|My requests>.',
].join('\n');

// Pull `priority:` and `due:` tokens out of the text; the rest is the brief.
function parseRequestText(text = '') {
  let priority = 'Normal';
  let designDueAt = '';
  const brief = String(text)
    .replace(/\bpriority:(\w+)/i, (match, value) => { priority = lifecycle.normalizePriority(value); return ''; })
    .replace(/\bdue:(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/i, (match, day, time) => {
      const date = new Date(`${day}T${time || '17:00'}:00-05:00`);
      if (!Number.isNaN(date.getTime())) designDueAt = date.toISOString();
      return '';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { brief, priority, designDueAt };
}

function parseCommand(text = '') {
  const trimmed = String(text || '').trim();
  const [first = '', ...rest] = trimmed.split(/\s+/);
  const sub = first.toLowerCase();
  if (!trimmed || sub === 'help') return { kind: 'help' };
  if (sub === 'status') return { kind: 'status', id: (rest[0] || '').toUpperCase() };
  if (sub === 'request' || sub === 'new') return { kind: 'request', ...parseRequestText(rest.join(' ')) };
  return { kind: 'request', ...parseRequestText(trimmed) };
}

function formLink(appUrl, parsed) {
  const params = new URLSearchParams();
  if (parsed.brief) params.set('brief', parsed.brief.slice(0, 1500));
  if (parsed.priority && parsed.priority !== 'Normal') params.set('priority', parsed.priority);
  if (parsed.designDueAt) params.set('due', parsed.designDueAt);
  params.set('source', 'slack');
  return `${appUrl}/design-request.html?${params.toString()}`;
}

function rowFor(record) {
  const now = new Date().toISOString();
  return {
    id: lifecycle.taskIdFor(record.id),
    source_id: record.id,
    task_type: 'design_request',
    title: record.title,
    status: 'Backlog',
    priority: record.priority,
    requester_name: record.requester.name,
    requester_email: record.requester.email,
    creator_name: record.requester.name,
    creator_email: record.requester.email,
    workspace: 'Design Request',
    design_due_at: record.designDueAt || null,
    brief: record.brief,
    metadata: { source: 'Slack', slackUser: record.slackUser || '' },
    created_at: now,
    updated_at: now,
  };
}

async function fileRequest(parsed, params, config) {
  const appUrl = config.appUrl;
  if (parsed.brief.length < 8) {
    return reply(`Tell us a bit more, for example: \`/frameup request Cowboys win graphic for IG, final score 31-17 priority:high\`\n\n${HELP.replace(/\{APP\}/g, appUrl)}`);
  }
  if (config.mode !== 'bot' || !rest.serviceRoleKey()) {
    return reply(`Almost there: <${formLink(appUrl, parsed)}|open the request form> (your brief is filled in) and press Submit.`);
  }
  const person = await slack.lookupUserEmail(params.get('user_id'), config);
  if (!person?.email || !isEsEmail(person.email)) {
    return reply('Only EssentiallySports accounts can file FrameUp requests. Use your @essentiallysports.com Slack account.');
  }
  const record = {
    id: lifecycle.makeRequestId(),
    createdAt: new Date().toISOString(),
    source: 'Slack',
    status: 'New',
    title: parsed.brief.slice(0, 90),
    entities: parsed.brief.slice(0, 90),
    brief: parsed.brief,
    priority: parsed.priority,
    designDueAt: parsed.designDueAt,
    requester: { name: person.name || person.email.split('@')[0], email: person.email },
    slackUser: params.get('user_id') || '',
  };
  await rest.request('es_designer_tasks', { method: 'POST', service: true, body: rowFor(record), prefer: 'return=minimal' });
  const posted = await slack.postMessage(buildSlackPayload(record), config).catch(() => null);
  if (posted?.ts) {
    await rest.rpc('frameup_request_set_slack_thread', {
      p_request_id: lifecycle.taskIdFor(record.id),
      p_channel: posted.channel,
      p_ts: posted.ts,
    }, { service: true }).catch(() => null);
  }
  return reply(`:white_check_mark: Filed *${record.id}*. The design team has it${posted?.ts ? ' and updates will reply in its thread' : ''}. <${slack.trackUrl(config, record.id)}|Track it in FrameUp>.`);
}

async function lookupStatus(id, config) {
  if (!lifecycle.isRequestId(id)) return reply('Use a request id like `DR-20261118-AB12`.');
  if (!rest.serviceRoleKey()) return reply(`<${slack.trackUrl(config, id)}|Open ${id} in FrameUp>`);
  const rows = await rest.request(
    `es_designer_tasks?id=eq.${encodeURIComponent(lifecycle.taskIdFor(id))}&task_type=eq.design_request&select=source_id,title,status,assigned_to,design_due_at&limit=1`,
    { service: true }
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return reply(`No request called ${id}.`);
  const who = row.assigned_to ? row.assigned_to.split('@')[0] : 'not assigned yet';
  return reply(`*${slack.escapeText(row.source_id)}* · ${slack.escapeText(row.title)}\nStatus: *${lifecycle.statusLabel(row.status)}* · ${slack.escapeText(who)}\n<${slack.trackUrl(config, id)}|Open in FrameUp>`);
}

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return refuse(405, 'Method not allowed');
  const signingSecret = String(process.env.SLACK_SIGNING_SECRET || '').trim();
  if (!signingSecret) return refuse(503, 'Slack commands are not configured.');

  const rawBody = typeof event.body === 'string' ? event.body : '';
  const check = slack.verifySlackSignature({
    signingSecret,
    timestamp: readHeader(event.headers, 'x-slack-request-timestamp'),
    signature: readHeader(event.headers, 'x-slack-signature'),
    rawBody,
  });
  if (!check.ok) return refuse(401, 'Invalid Slack signature.');

  const params = new URLSearchParams(rawBody);
  if (params.get('ssl_check') === '1') return { statusCode: 200, headers: {}, body: '' };

  const config = slack.slackConfig();
  const parsed = parseCommand(params.get('text') || '');
  try {
    if (parsed.kind === 'help') return reply(HELP.replace(/\{APP\}/g, config.appUrl));
    if (parsed.kind === 'status') return await lookupStatus(parsed.id, config);
    return await fileRequest(parsed, params, config);
  } catch (error) {
    return reply('Something went wrong filing that. Please use the form in FrameUp for now.');
  }
};

exports._test = { parseCommand, parseRequestText, formLink, rowFor };
