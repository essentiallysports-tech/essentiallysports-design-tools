// Design Request workflow: lifecycle rules, permissions, Slack signature
// verification, thread posting (mocked fetch, never real Slack), the
// /frameup slash command and the update endpoint.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = require('../request-lifecycle.js');
const slack = require('../netlify/functions/_slack.js');

const originalFetch = globalThis.fetch;
const ENV_KEYS = ['SLACK_BOT_TOKEN', 'SLACK_DESIGN_REQUEST_CHANNEL', 'SLACK_DESIGN_REQUEST_WEBHOOK_URL', 'SLACK_SIGNING_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'SLACK_THREAD_COMMENTS', 'GOOGLE_SHEETS_ID', 'DESIGN_REQUEST_EMAIL_ENDPOINT', 'EMAIL_DESIGN_REQUEST_ENDPOINT'];
const savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
function resetEnv() {
  ENV_KEYS.forEach(key => { delete process.env[key]; });
}

let passed = 0;
async function test(name, fn) {
  try {
    resetEnv();
    await fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// A fetch mock that records calls and refuses anything unexpected, so a test
// can never reach the real Slack or Supabase.
function mockFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    calls.push({ url: href, options, body: options.body ? (() => { try { return JSON.parse(options.body); } catch (e) { return options.body; } })() : undefined });
    for (const [match, handler] of routes) {
      if (typeof match === 'string' ? href.includes(match) : match.test(href)) {
        const result = await handler(href, options, calls);
        if (result instanceof Response) return result;
        return new Response(JSON.stringify(result ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    throw new Error(`Unexpected fetch in test: ${href}`);
  };
  return calls;
}
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const authOk = email => ['/auth/v1/user', () => ({ id: 'u1', email })];

const admin = { email: 'boss@essentiallysports.com', isAdmin: true, isDesigner: true };
const designer = { email: 'dee@essentiallysports.com', isDesigner: true };
const otherDesigner = { email: 'other@essentiallysports.com', isDesigner: true };
const requester = { email: 'rae@essentiallysports.com' };
const stranger = { email: 'sam@essentiallysports.com' };
const request = (fields = {}) => ({ id: 'task-request-DR-20261118-AB12', status: 'Backlog', requesterEmail: requester.email, creatorEmail: requester.email, assignedTo: '', ...fields });

// ── Lifecycle: statuses and transitions ─────────────────────────────────────
await test('normalizeStatus maps labels and aliases', () => {
  assert.equal(L.normalizeStatus('New'), 'Backlog');
  assert.equal(L.normalizeStatus('in progress'), 'Doing');
  assert.equal(L.normalizeStatus('In review'), 'Review');
  assert.equal(L.normalizeStatus('withdrawn'), 'Declined');
  assert.equal(L.normalizeStatus('nonsense', ''), '');
  assert.equal(L.statusLabel('Doing'), 'In progress');
  assert.equal(L.isOpen('Review'), true);
  assert.equal(L.isOpen('Declined'), false);
  assert.equal(L.stepIndex('Assigned'), 0);
  assert.equal(L.stepIndex('Done'), 3);
});

await test('designers move their own requests one step at a time', () => {
  const mine = request({ status: 'Doing', assignedTo: designer.email });
  assert.equal(L.checkStatusChange(mine, designer, 'Review').ok, true);
  assert.equal(L.checkStatusChange(mine, designer, 'Assigned').ok, true);
  assert.equal(L.checkStatusChange(mine, designer, 'Done').ok, false, 'Doing → Done skips review');
  assert.equal(L.checkStatusChange(request({ status: 'Review', assignedTo: designer.email }), designer, 'Done').ok, true);
  assert.equal(L.checkStatusChange(request({ status: 'Done', assignedTo: designer.email }), designer, 'Doing').ok, true, 'reopen');
  assert.equal(L.checkStatusChange(request({ status: 'Done', assignedTo: designer.email }), designer, 'Backlog').ok, false);
  assert.equal(L.checkStatusChange(request({ status: 'Declined', assignedTo: designer.email }), designer, 'Backlog').ok, true);
  assert.equal(L.checkStatusChange(mine, designer, 'Doing').ok, false, 'no-op');
});

await test('designers cannot move unassigned or someone else’s requests', () => {
  assert.match(L.checkStatusChange(request(), designer, 'Doing').reason, /yourself/);
  assert.equal(L.checkStatusChange(request({ status: 'Doing', assignedTo: otherDesigner.email }), designer, 'Review').ok, false);
});

await test('admins may make any move', () => {
  assert.equal(L.checkStatusChange(request(), admin, 'Done').ok, true);
  assert.equal(L.checkStatusChange(request({ status: 'Declined' }), admin, 'Review').ok, true);
  assert.deepEqual(L.allowedStatuses(request(), admin), ['Assigned', 'Doing', 'Review', 'Done', 'Declined']);
});

await test('requesters can only withdraw before work starts', () => {
  const result = L.checkStatusChange(request(), requester, 'Declined');
  assert.equal(result.ok, true);
  assert.equal(result.withdraw, true);
  assert.equal(L.checkStatusChange(request({ status: 'Assigned' }), requester, 'Declined').ok, true);
  assert.equal(L.checkStatusChange(request({ status: 'Doing' }), requester, 'Declined').ok, false);
  assert.equal(L.checkStatusChange(request(), requester, 'Doing').ok, false);
  assert.equal(L.checkStatusChange(request(), stranger, 'Declined').ok, false);
  assert.deepEqual(L.allowedStatuses(request(), requester), ['Declined']);
});

// ── Permissions ─────────────────────────────────────────────────────────────
await test('who can see a request', () => {
  assert.equal(L.canView(request(), requester), true);
  assert.equal(L.canView(request(), stranger), false);
  assert.equal(L.canView(request(), designer), true);
  assert.equal(L.canView(request(), admin), true);
  assert.equal(L.canView(request({ requesterEmail: 'RAE@essentiallysports.com', creatorEmail: '' }), requester), true, 'case-insensitive');
});

await test('assignment rules', () => {
  assert.equal(L.checkAssign(request(), admin, designer.email).ok, true);
  assert.equal(L.checkAssign(request({ assignedTo: designer.email }), admin, otherDesigner.email).ok, true);
  assert.equal(L.checkAssign(request(), designer, designer.email).ok, true, 'claim');
  assert.equal(L.checkAssign(request(), designer, otherDesigner.email).ok, false, 'cannot assign others');
  assert.equal(L.checkAssign(request({ assignedTo: designer.email }), designer, '').ok, true, 'hand back');
  assert.equal(L.checkAssign(request({ assignedTo: otherDesigner.email }), designer, designer.email).ok, false, 'no stealing');
  assert.equal(L.checkAssign(request(), requester, requester.email).ok, false);
});

await test('plan edits, comments, queue and badge count', () => {
  assert.equal(L.canEditPlan(request({ assignedTo: designer.email }), designer), true);
  assert.equal(L.canEditPlan(request({ assignedTo: otherDesigner.email }), designer), false);
  assert.equal(L.canEditPlan(request(), admin), true);
  assert.equal(L.canEditPlan(request(), requester), false);
  assert.equal(L.canComment(request(), requester), true);
  assert.equal(L.canComment(request(), stranger), false);
  const list = [
    request({ id: 'a' }),
    request({ id: 'b', assignedTo: designer.email, status: 'Doing' }),
    request({ id: 'c', assignedTo: designer.email, status: 'Done' }),
    request({ id: 'd', assignedTo: otherDesigner.email, status: 'Review' }),
  ];
  assert.equal(L.openCount(list, designer), 1, 'designer: my open queue');
  assert.equal(L.openCount(list, admin), 1, 'admin: unassigned open');
  assert.equal(L.openCount(list, requester), 3, 'requester: own open');
  assert.equal(L.openCount(list, stranger), 0);
  assert.equal(L.inQueue(list[1], designer), true);
  assert.equal(L.inQueue(list[2], designer), false, 'done is out of the queue');
});

await test('due state', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  assert.equal(L.dueState({ status: 'Doing', designDueAt: '2026-11-17T12:00:00Z' }, now), 'overdue');
  assert.equal(L.dueState({ status: 'Doing', designDueAt: '2026-11-18T20:00:00Z' }, now), 'soon');
  assert.equal(L.dueState({ status: 'Done', designDueAt: '2026-11-17T12:00:00Z' }, now), 'none');
});

await test('request ids are unique-ish and well-formed', () => {
  const ids = new Set(Array.from({ length: 300 }, () => L.makeRequestId(new Date('2026-11-18T10:00:00Z'))));
  assert.ok(ids.size > 290);
  ids.forEach(id => assert.match(id, /^DR-20261118-[2-9A-HJ-NP-Z]{4}$/));
  assert.equal(L.isRequestId('DR-20261118-001'), true, 'old ids still valid');
  assert.equal(L.isRequestId('DR-1-<script>'), false);
  assert.equal(L.taskIdFor('DR-20261118-AB12'), 'task-request-DR-20261118-AB12');
});

// ── Slack signature verification ────────────────────────────────────────────
function sign(secret, timestamp, body) {
  return `v0=${crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
}
const SECRET = 'test-signing-secret';
const NOW = Date.parse('2026-11-18T12:00:00Z');
const TS = String(Math.floor(NOW / 1000));

await test('signature: valid, tampered, stale, missing', () => {
  const body = 'command=%2Fframeup&text=help';
  assert.equal(slack.verifySlackSignature({ signingSecret: SECRET, timestamp: TS, signature: sign(SECRET, TS, body), rawBody: body, now: NOW }).ok, true);
  assert.equal(slack.verifySlackSignature({ signingSecret: SECRET, timestamp: TS, signature: sign(SECRET, TS, body), rawBody: `${body}x`, now: NOW }).reason, 'bad_signature');
  assert.equal(slack.verifySlackSignature({ signingSecret: SECRET, timestamp: TS, signature: sign('wrong', TS, body), rawBody: body, now: NOW }).reason, 'bad_signature');
  assert.equal(slack.verifySlackSignature({ signingSecret: SECRET, timestamp: TS, signature: 'v0=short', rawBody: body, now: NOW }).reason, 'bad_signature');
  const old = String(Math.floor(NOW / 1000) - 600);
  assert.equal(slack.verifySlackSignature({ signingSecret: SECRET, timestamp: old, signature: sign(SECRET, old, body), rawBody: body, now: NOW }).reason, 'stale_timestamp');
  assert.equal(slack.verifySlackSignature({ signingSecret: '', timestamp: TS, signature: sign(SECRET, TS, body), rawBody: body, now: NOW }).reason, 'not_configured');
  assert.equal(slack.verifySlackSignature({ signingSecret: SECRET, timestamp: '', signature: '', rawBody: body, now: NOW }).reason, 'missing_signature');
});

// ── Slack modes and thread posting (mocked) ────────────────────────────────
await test('mode selection is env-gated; bot wins over webhook', () => {
  assert.equal(slack.slackConfig({}).mode, 'off');
  assert.equal(slack.slackConfig({ SLACK_DESIGN_REQUEST_WEBHOOK_URL: 'https://hooks.example.test/x' }).mode, 'webhook');
  assert.equal(slack.slackConfig({ SLACK_BOT_TOKEN: 'xoxb-test' }).mode, 'off', 'bot needs a channel');
  assert.equal(slack.slackConfig({ SLACK_BOT_TOKEN: 'xoxb-test', SLACK_DESIGN_REQUEST_CHANNEL: 'C123456', SLACK_DESIGN_REQUEST_WEBHOOK_URL: 'https://hooks.example.test/x' }).mode, 'bot');
});

const statusEvent = { kind: 'status', actor_email: 'dee.smith@essentiallysports.com', from_value: 'Assigned', to_value: 'Doing', body: '', created_at: '2026-11-18T12:00:00Z' };
const row = { id: 'task-request-DR-20261118-AB12', source_id: 'DR-20261118-AB12', title: 'Cowboys <win> card', status: 'Doing' };

await test('bot mode replies in the stored thread', async () => {
  const config = slack.slackConfig({ SLACK_BOT_TOKEN: 'xoxb-test', SLACK_DESIGN_REQUEST_CHANNEL: 'CDESIGN01' });
  const calls = mockFetch([['slack.com/api/chat.postMessage', () => ({ ok: true, channel: 'CDESIGN01', ts: '1731931200.000300' })]]);
  const result = await slack.postRequestUpdate({ ...row, slack_thread_ts: '1731931100.000100', slack_channel: 'CDESIGN01' }, [statusEvent], config);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.thread_ts, '1731931100.000100');
  assert.equal(calls[0].body.channel, 'CDESIGN01');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer xoxb-test');
  assert.match(calls[0].body.text, /In progress/);
  assert.equal(result.threaded, true);
  assert.equal(result.newThread, null);
});

await test('bot mode without a thread starts one and reports it', async () => {
  const config = slack.slackConfig({ SLACK_BOT_TOKEN: 'xoxb-test', SLACK_DESIGN_REQUEST_CHANNEL: 'CDESIGN01' });
  const calls = mockFetch([['slack.com/api/chat.postMessage', () => ({ ok: true, channel: 'CDESIGN01', ts: '1731931200.000300' })]]);
  const result = await slack.postRequestUpdate(row, [statusEvent], config);
  assert.equal(calls[0].body.thread_ts, undefined);
  assert.match(calls[0].body.blocks[0].text.text, /DR-20261118-AB12/);
  assert.match(calls[0].body.blocks[0].text.text, /Cowboys &lt;win&gt; card/, 'escaped');
  assert.deepEqual(result.newThread, { channel: 'CDESIGN01', ts: '1731931200.000300' });
});

await test('webhook mode posts a standalone update and never comments', async () => {
  const config = slack.slackConfig({ SLACK_DESIGN_REQUEST_WEBHOOK_URL: 'https://hooks.example.test/T/B/x' });
  const calls = mockFetch([['hooks.example.test', () => new Response('ok', { status: 200 })]]);
  const comment = { kind: 'comment', actor_email: requester.email, body: 'Can we use the blue kit?' };
  const result = await slack.postRequestUpdate({ ...row, slack_thread_ts: '1.2' }, [statusEvent, comment], config);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.thread_ts, undefined);
  assert.doesNotMatch(JSON.stringify(calls[0].body), /blue kit/);
  assert.equal(result.mode, 'webhook');
  assert.equal(result.newThread, null);
  // Only a comment: nothing to post in webhook mode.
  const none = await slack.postRequestUpdate(row, [comment], config);
  assert.equal(none.skipped, true);
  assert.equal(calls.length, 1);
});

await test('off mode posts nothing', async () => {
  const calls = mockFetch([]);
  const result = await slack.postRequestUpdate(row, [statusEvent], slack.slackConfig({}));
  assert.equal(result.skipped, true);
  assert.equal(calls.length, 0);
});

await test('event lines: declined reason, delivery link sanitised', () => {
  const config = { mode: 'bot', threadComments: true, appUrl: 'https://frameup.test' };
  assert.match(slack.eventLine({ kind: 'status', to_value: 'Declined', from_value: 'Backlog', actor_email: 'a@essentiallysports.com', body: 'Out of scope' }, config), /Declined[\s\S]*>Out of scope/);
  const line = slack.eventLine({ kind: 'delivery', to_value: 'Final', actor_email: 'a@essentiallysports.com', meta: { url: 'https://x.test/a|b>c' } }, config);
  assert.match(line, /<https:\/\/x\.test\/abc\|Final>/);
  assert.equal(slack.eventLine({ kind: 'delivery', to_value: 'Bad', meta: { url: 'javascript:alert(1)' } }, config).includes('javascript:'), false);
  assert.equal(slack.eventLine({ kind: 'comment', body: 'hi' }, { ...config, threadComments: false }), '');
});

// ── /api/design-request-update ─────────────────────────────────────────────
const updateFn = require('../netlify/functions/design-request-update.js');
const supabaseUrl = 'https://xtdusejokbhtjlmijdca.supabase.co';

await test('update endpoint: auth required', async () => {
  const response = await updateFn.handler({ httpMethod: 'POST', headers: {}, body: '{}' });
  assert.equal(response.statusCode, 401);
});

await test('update endpoint: runs the RPC as the user, then posts the claimed events in-thread', async () => {
  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  process.env.SLACK_DESIGN_REQUEST_CHANNEL = 'CDESIGN01';
  const calls = mockFetch([
    authOk(designer.email),
    ['/rest/v1/rpc/frameup_request_update', () => ({ id: row.id, status: 'Doing' })],
    ['/rest/v1/rpc/frameup_request_claim_notifications', () => [statusEvent]],
    ['/rest/v1/es_designer_tasks', () => [{ ...row, slack_thread_ts: '1731931100.000100', slack_channel: 'CDESIGN01' }]],
    ['slack.com/api/chat.postMessage', () => ({ ok: true, channel: 'CDESIGN01', ts: '1731931300.000400' })],
  ]);
  const response = await updateFn.handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer user-jwt' },
    body: JSON.stringify({ action: 'update', requestId: 'DR-20261118-AB12', status: 'In progress', reason: 'Starting now' }),
  });
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.slack.posted, 1);
  assert.equal(payload.slack.threaded, true);
  const rpcCall = calls.find(call => call.url.endsWith('/rpc/frameup_request_update'));
  assert.equal(rpcCall.url, `${supabaseUrl}/rest/v1/rpc/frameup_request_update`);
  assert.equal(rpcCall.options.headers.Authorization, 'Bearer user-jwt', 'runs as the signed-in user');
  assert.deepEqual(rpcCall.body, { p_request_id: 'task-request-DR-20261118-AB12', p_status: 'Doing', p_reason: 'Starting now' });
  const post = calls.find(call => call.url.includes('chat.postMessage'));
  assert.equal(post.body.thread_ts, '1731931100.000100');
  assert.ok(!calls.some(call => call.url.includes('set_slack_thread')), 'thread already stored');
});

await test('update endpoint: first bot update stores its ts as the thread', async () => {
  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  process.env.SLACK_DESIGN_REQUEST_CHANNEL = 'CDESIGN01';
  const calls = mockFetch([
    authOk(admin.email),
    ['/rest/v1/rpc/frameup_request_claim_notifications', () => [{ ...statusEvent, kind: 'assign', to_value: designer.email }]],
    ['/rest/v1/es_designer_tasks', () => [{ ...row, slack_thread_ts: null }]],
    ['slack.com/api/chat.postMessage', () => ({ ok: true, channel: 'CDESIGN01', ts: '1731931300.000400' })],
    ['/rest/v1/rpc/frameup_request_set_slack_thread', () => true],
  ]);
  const response = await updateFn.handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer admin-jwt' }, body: JSON.stringify({ action: 'notify', requestId: 'task-request-DR-20261118-AB12' }) });
  assert.equal(response.statusCode, 200);
  const store = calls.find(call => call.url.includes('set_slack_thread'));
  assert.deepEqual(store.body, { p_request_id: 'task-request-DR-20261118-AB12', p_channel: 'CDESIGN01', p_ts: '1731931300.000400' });
});

await test('update endpoint: Slack off means no claim and no post', async () => {
  const calls = mockFetch([authOk(designer.email), ['/rest/v1/rpc/frameup_request_comment', () => ({ id: 'e1' })]]);
  const response = await updateFn.handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ action: 'comment', requestId: 'DR-20261118-AB12', body: 'Looks great' }) });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).slack.mode, 'off');
  assert.ok(!calls.some(call => call.url.includes('claim_notifications')));
});

await test('update endpoint: database refusals and a missing migration map to clear errors', async () => {
  mockFetch([authOk(requester.email), ['/rpc/frameup_request_update', () => jsonResponse({ code: '42501', message: 'Only the design team can change the status.' }, 400)]]);
  let response = await updateFn.handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ action: 'update', requestId: 'DR-20261118-AB12', status: 'Done' }) });
  assert.equal(response.statusCode, 403);
  assert.match(JSON.parse(response.body).error, /design team/);

  mockFetch([authOk(requester.email), ['/rpc/frameup_request_update', () => jsonResponse({ code: 'PGRST202', message: 'Could not find the function' }, 404)]]);
  response = await updateFn.handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ action: 'update', requestId: 'DR-20261118-AB12', status: 'Done' }) });
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).reason, 'not_installed');
});

await test('update endpoint: input validation', async () => {
  mockFetch([authOk(designer.email)]);
  const send = body => updateFn.handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify(body) });
  assert.equal((await send({ action: 'drop', requestId: 'DR-20261118-AB12' })).statusCode, 400);
  assert.equal((await send({ action: 'update', requestId: '../../etc' })).statusCode, 400);
  assert.equal((await send({ action: 'update', requestId: 'DR-20261118-AB12' })).statusCode, 400, 'nothing to change');
  assert.equal((await send({ action: 'update', requestId: 'DR-20261118-AB12', status: 'Bogus' })).statusCode, 400);
  assert.equal((await send({ action: 'attach', requestId: 'DR-20261118-AB12', url: 'javascript:alert(1)' })).statusCode, 400);
  assert.equal((await send({ action: 'comment', requestId: 'DR-20261118-AB12', body: '   ' })).statusCode, 400);
});

// ── /frameup slash command ──────────────────────────────────────────────────
const commandFn = require('../netlify/functions/slack-command.js');
function slackEvent(text, { secret = SECRET, tamper = false, userId = 'U123' } = {}) {
  const body = new URLSearchParams({ command: '/frameup', text, user_id: userId, team_id: 'T1', channel_id: 'C1' }).toString();
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    httpMethod: 'POST',
    headers: { 'X-Slack-Request-Timestamp': ts, 'X-Slack-Signature': sign(secret, ts, body) },
    body: tamper ? `${body}&text=evil` : body,
  };
}

await test('slash command refuses everything without the signing secret', async () => {
  const calls = mockFetch([]);
  const response = await commandFn.handler(slackEvent('help'));
  assert.equal(response.statusCode, 503);
  assert.equal(calls.length, 0);
});

await test('slash command rejects bad signatures', async () => {
  process.env.SLACK_SIGNING_SECRET = SECRET;
  mockFetch([]);
  assert.equal((await commandFn.handler(slackEvent('help', { tamper: true }))).statusCode, 401);
  assert.equal((await commandFn.handler(slackEvent('help', { secret: 'other' }))).statusCode, 401);
  assert.equal((await commandFn.handler({ httpMethod: 'POST', headers: {}, body: 'text=help' })).statusCode, 401);
  assert.equal((await commandFn.handler({ httpMethod: 'GET', headers: {}, body: '' })).statusCode, 405);
});

await test('slash command help and pre-filled form fallback', async () => {
  process.env.SLACK_SIGNING_SECRET = SECRET;
  const calls = mockFetch([]);
  const help = JSON.parse((await commandFn.handler(slackEvent(''))).body);
  assert.equal(help.response_type, 'ephemeral');
  assert.match(help.text, /\/frameup request/);
  const fallback = JSON.parse((await commandFn.handler(slackEvent('request Cowboys win card for IG priority:urgent due:2026-11-20'))).body);
  assert.match(fallback.text, /design-request\.html\?brief=Cowboys\+win\+card\+for\+IG&priority=Urgent&due=2026-11-20T22%3A00%3A00\.000Z&source=slack/);
  assert.equal(calls.length, 0, 'no Slack or database calls without bot token + service key');
});

await test('slash command files a request with bot token + service key', async () => {
  process.env.SLACK_SIGNING_SECRET = SECRET;
  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  process.env.SLACK_DESIGN_REQUEST_CHANNEL = 'CDESIGN01';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-test';
  const calls = mockFetch([
    ['slack.com/api/users.info', () => ({ ok: true, user: { real_name: 'Rae Writer', profile: { email: 'Rae@EssentiallySports.com' } } })],
    [/\/rest\/v1\/es_designer_tasks$/, () => new Response(null, { status: 201 })],
    ['slack.com/api/chat.postMessage', () => ({ ok: true, channel: 'CDESIGN01', ts: '1731931400.000500' })],
    ['/rpc/frameup_request_set_slack_thread', () => true],
  ]);
  const response = await commandFn.handler(slackEvent('request Steelers playoff odds graphic for newsletter priority:high'));
  const payload = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.match(payload.text, /Filed \*DR-\d{8}-[A-Z0-9]{4}\*/);
  const insert = calls.find(call => /es_designer_tasks$/.test(call.url));
  assert.equal(insert.options.headers.apikey, 'service-key-test');
  assert.equal(insert.body.requester_email, 'rae@essentiallysports.com');
  assert.equal(insert.body.creator_email, 'rae@essentiallysports.com', 'requester can see it under RLS');
  assert.equal(insert.body.priority, 'High');
  assert.equal(insert.body.task_type, 'design_request');
  assert.equal(insert.body.brief, 'Steelers playoff odds graphic for newsletter');
  const thread = calls.find(call => call.url.includes('set_slack_thread'));
  assert.equal(thread.body.p_ts, '1731931400.000500');
});

await test('slash command refuses non-ES Slack accounts', async () => {
  process.env.SLACK_SIGNING_SECRET = SECRET;
  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  process.env.SLACK_DESIGN_REQUEST_CHANNEL = 'CDESIGN01';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-test';
  const calls = mockFetch([['slack.com/api/users.info', () => ({ ok: true, user: { profile: { email: 'guest@gmail.com' } } })]]);
  const payload = JSON.parse((await commandFn.handler(slackEvent('request a long enough brief here'))).body);
  assert.match(payload.text, /Only EssentiallySports accounts/);
  assert.ok(!calls.some(call => call.url.includes('/rest/v1/')));
});

await test('slash command parsing', () => {
  const { parseCommand } = commandFn._test;
  assert.deepEqual(parseCommand('status dr-20261118-ab12'), { kind: 'status', id: 'DR-20261118-AB12' });
  assert.equal(parseCommand('help').kind, 'help');
  const parsed = parseCommand('Need a quote card priority:URGENT');
  assert.equal(parsed.kind, 'request');
  assert.equal(parsed.priority, 'Urgent');
  assert.equal(parsed.brief, 'Need a quote card');
});

await test('Vercel adapter hands the handler the raw signed body', async () => {
  process.env.SLACK_SIGNING_SECRET = SECRET;
  const adapter = require('../api/slack-command.js');
  const body = 'command=%2Fframeup&text=help+me&user_id=U1';
  const ts = String(Math.floor(Date.now() / 1000));
  const stream = Readable.from([Buffer.from(body)]);
  stream.method = 'POST';
  stream.headers = { 'x-slack-request-timestamp': ts, 'x-slack-signature': sign(SECRET, ts, body) };
  const response = { headers: {}, statusCode: 0, payload: '', setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, send(p) { this.payload = p; return this; } };
  mockFetch([]);
  await adapter(stream, response);
  assert.equal(response.statusCode, 200);
  assert.equal(adapter.config.api.bodyParser, false);
});

// ── Submit endpoint: bot mode returns the thread ts ────────────────────────
await test('design-request-submit returns channel + ts in bot mode', async () => {
  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  process.env.SLACK_DESIGN_REQUEST_CHANNEL = 'CDESIGN01';
  const submit = require('../netlify/functions/design-request-submit.js');
  const calls = mockFetch([authOk(requester.email), ['slack.com/api/chat.postMessage', () => ({ ok: true, channel: 'CDESIGN01', ts: '1731931500.000600' })]]);
  const response = await submit.handler({ httpMethod: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ record: { id: 'DR-20261118-ZZ99', requester: { name: 'Rae' }, brief: 'x' } }) });
  const payload = JSON.parse(response.body);
  assert.equal(payload.integrations.slack.ok, true);
  assert.equal(payload.integrations.slack.ts, '1731931500.000600');
  assert.equal(payload.integrations.slack.channel, 'CDESIGN01');
  const post = calls.find(call => call.url.includes('chat.postMessage'));
  assert.match(JSON.stringify(post.body), /requests\.html\?id=DR-20261118-ZZ99/, 'track link in the message');
});

// ── Static checks: migration, page shell, nav ──────────────────────────────
await test('migration: RLS on every new table, undo notes, role helpers', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261118120030_request_workflow.sql'), 'utf8');
  ['frameup_request_designers', 'frameup_request_events', 'frameup_request_deliveries'].forEach(table => {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`drop table if exists public\\.${table}`), `${table} in Undo`);
  });
  assert.match(sql, /is_es_designer_admin\(\)/);
  assert.match(sql, /is_es_designer_domain_user\(\)/);
  assert.match(sql, /'Declined'/);
  assert.match(sql, /revoke all on function public\.frameup_request_update/);
  assert.doesNotMatch(sql, /grant [^;]* to anon/i);
  // Transition table in SQL mirrors the JS one.
  Object.entries(L.TRANSITIONS).forEach(([from, tos]) => {
    assert.match(sql, new RegExp(`when '${from}' then array\\[${tos.map(t => `'${t}'`).join(', ')}\\]`), `SQL transitions for ${from}`);
  });
});

await test('requests.html uses the shared shell and is in NAV under Work', () => {
  const html = fs.readFileSync(path.join(ROOT, 'requests.html'), 'utf8');
  const order = ['request-lifecycle.js', 'design-requests.js', 'app-shell.js', 'frameup-tour.css', 'frameup-tour.js', 'tours/updates.js', 'tours/tours.js', 'tours/tour-launcher.js'].map(file => html.indexOf(`${file}?v=`));
  order.forEach(index => assert.ok(index > -1));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(html, /requireAuth\(`requests\.html/);
  assert.match(html, /design-tokens\.css\?v=/);
  const shell = fs.readFileSync(path.join(ROOT, 'app-shell.js'), 'utf8');
  const work = shell.slice(shell.indexOf("label: 'Work'"), shell.indexOf("label: 'Help'"));
  assert.match(work, /id: 'my-requests'[^}]*href: 'requests\.html'/);
  assert.match(shell, /'requests\.html': 'my-requests'/);
  assert.match(shell, /frameup_my_open_request_count/);
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(vercel.functions['api/slack-command.js']);
  assert.ok(vercel.functions['api/design-request-update.js']);
});

ENV_KEYS.forEach(key => { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; });
console.log(`Request workflow tests passed (${passed}).`);
