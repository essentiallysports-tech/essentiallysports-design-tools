'use strict';

// Design Request lifecycle actions: status / assign / due / priority, comments,
// attaching delivered designs, and posting what changed to Slack.
//
// Every change runs as the signed-in person (their JWT) through the
// frameup_request_* RPCs, so the database decides who may do what. Slack
// messages are built from the database's own event rows (claimed once with
// frameup_request_claim_notifications), never from what the browser sends.
//
// POST /api/design-request-update
//   { action: 'update',  requestId, status?, assignedTo?, designDueAt?, clearDue?, priority?, reason? }
//   { action: 'comment', requestId, body }
//   { action: 'attach',  requestId, url?, label?, exportTaskId? }
//   { action: 'notify',  requestId }   (after a Dashboard edit made elsewhere)

const { verifyEsUser, bearerToken } = require('./_supabase-auth.js');
const rest = require('./_supabase-rest.js');
const slack = require('./_slack.js');
const lifecycle = require('../../request-lifecycle.js');

const MAX_BODY = 20000;
const ACTIONS = new Set(['update', 'comment', 'attach', 'notify']);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function taskIdFrom(value) {
  const id = String(value || '').trim();
  const taskId = id.startsWith('task-request-') ? id : lifecycle.taskIdFor(id);
  return /^task-request-[A-Za-z0-9._-]{3,80}$/.test(taskId) ? taskId : '';
}

function cleanText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function buildUpdateArgs(taskId, payload = {}) {
  const args = { p_request_id: taskId };
  if (payload.status != null && payload.status !== '') {
    const status = lifecycle.normalizeStatus(payload.status, '');
    if (!status) return { error: 'Unknown status.' };
    args.p_status = status;
  }
  if (payload.assignedTo !== undefined && payload.assignedTo !== null) {
    args.p_assigned_to = lifecycle.normalizeEmail(payload.assignedTo);
  }
  if (payload.clearDue) {
    args.p_clear_due = true;
  } else if (payload.designDueAt) {
    const due = isoOrNull(payload.designDueAt);
    if (due === undefined) return { error: 'That due date is not valid.' };
    args.p_design_due_at = due;
  }
  if (payload.priority) args.p_priority = lifecycle.normalizePriority(payload.priority);
  if (payload.reason) args.p_reason = cleanText(payload.reason, 4000);
  if (Object.keys(args).length === 1) return { error: 'Nothing to change.' };
  return { args };
}

// Claim pending events and post them. Never throws: Slack trouble must not
// undo or fail the change itself.
async function notifySlack(taskId, token, config = slack.slackConfig()) {
  if (config.mode === 'off') return { ok: false, skipped: true, mode: 'off' };
  try {
    const events = await rest.rpc('frameup_request_claim_notifications', { p_request_id: taskId }, { token });
    if (!Array.isArray(events) || !events.length) return { ok: true, mode: config.mode, posted: 0 };
    const rows = await rest.request(
      `es_designer_tasks?id=eq.${encodeURIComponent(taskId)}&select=id,source_id,title,status,assigned_to,slack_thread_ts:metadata->>slackThreadTs,slack_channel:metadata->>slackChannel&limit=1`,
      { token }
    );
    const request = Array.isArray(rows) ? rows[0] : null;
    if (!request) return { ok: false, mode: config.mode, error: 'Request not visible.' };
    const ordered = events.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const result = await slack.postRequestUpdate(request, ordered, config);
    if (result.newThread) {
      await rest.rpc('frameup_request_set_slack_thread', {
        p_request_id: taskId,
        p_channel: result.newThread.channel,
        p_ts: result.newThread.ts,
      }, { token }).catch(() => null);
    }
    return { ok: true, mode: result.mode, posted: result.posted || 0, threaded: Boolean(result.threaded) };
  } catch (error) {
    if (error?.code === 'not_installed') return { ok: false, skipped: true, mode: config.mode, reason: 'not_installed' };
    return { ok: false, mode: config.mode, error: error?.message || 'Slack update failed.' };
  }
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  if (String(event.body || '').length > MAX_BODY) return json(413, { ok: false, error: 'Too large.' });

  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error });
  const token = bearerToken(event.headers);

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { ok: false, error: 'Invalid JSON.' });
  }
  const action = String(payload.action || '');
  if (!ACTIONS.has(action)) return json(400, { ok: false, error: 'Unknown action.' });
  const taskId = taskIdFrom(payload.requestId);
  if (!taskId) return json(400, { ok: false, error: 'Missing or invalid request id.' });

  try {
    let result = null;
    if (action === 'update') {
      const built = buildUpdateArgs(taskId, payload);
      if (built.error) return json(400, { ok: false, error: built.error });
      result = await rest.rpc('frameup_request_update', built.args, { token });
    } else if (action === 'comment') {
      const body = cleanText(payload.body, 4000);
      if (!body) return json(400, { ok: false, error: 'Write a comment first.' });
      result = await rest.rpc('frameup_request_comment', { p_request_id: taskId, p_body: body }, { token });
    } else if (action === 'attach') {
      const url = cleanText(payload.url, 2000);
      const exportTaskId = cleanText(payload.exportTaskId, 120) || null;
      if (!url && !exportTaskId) return json(400, { ok: false, error: 'Pick an export or paste a link.' });
      if (url && !/^https?:\/\//i.test(url)) return json(400, { ok: false, error: 'Links must start with https://' });
      result = await rest.rpc('frameup_request_attach', {
        p_request_id: taskId,
        p_url: url,
        p_label: cleanText(payload.label, 200),
        p_export_task_id: exportTaskId,
      }, { token });
    }
    const slackResult = await notifySlack(taskId, token);
    return json(200, { ok: true, action, result, slack: slackResult });
  } catch (error) {
    const status = error instanceof rest.SupabaseRestError ? error.status : 500;
    return json(status, {
      ok: false,
      error: error?.message || 'Could not update the request.',
      reason: error?.code === 'not_installed' ? 'not_installed' : undefined,
    });
  }
};

exports._test = { taskIdFrom, buildUpdateArgs, notifySlack };
