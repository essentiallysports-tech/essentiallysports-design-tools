#!/usr/bin/env node
// Error monitoring, every network call mocked:
//   1. frameup-errors.js scrubbing: emails, tokens, keys, passwords, query strings
//   2. reporter: dedupe, 5/min and 20/page limits, batching, 8 KB body cap
//   3. browser wiring on a fake window: error / rejection / failed /api fetch,
//      only same-site /api, never its own endpoint, needs a signed-in session
//   4. /api/client-errors: 405, 401 (no token, bad token), 413, 400, 202 stored,
//      table missing, server-side scrubbing, per-user limit, Sentry forwarding
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const reporterLib = require('../frameup-errors.js');
const { createReporter, scrub, scrubUrl, fingerprintOf, install, MAX_BODY } = reporterLib;

// ── 1. Scrubbing ────────────────────────────────────────────────────────────
{
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJhQGIuY29tIn0.abcDEF123_-xyz';
  const dirty = `Failed for jane.doe@essentiallysports.com at https://frameup.essentiallysports.com/generate.html?brief=secret+plan&token=abc#frag with Bearer ${jwt} and password=hunter2 key sb_publishable_1T9d9U0qXD5K-Ay-_43IVA token: "tok_live_123" apikey=AIzaSyD-1234567890abcdef`;
  const clean = scrub(dirty);
  assert.ok(!clean.includes('jane.doe'), 'emails removed');
  assert.ok(clean.includes('[email]'));
  assert.ok(!clean.includes('brief=secret'), 'query strings removed');
  assert.ok(!clean.includes('#frag'), 'fragments removed');
  assert.ok(clean.includes('https://frameup.essentiallysports.com/generate.html'), 'path kept');
  assert.ok(!clean.includes(jwt) && !clean.includes('eyJhbGci'), 'JWT removed');
  assert.ok(!clean.includes('hunter2'), 'password removed');
  assert.ok(!clean.includes('sb_publishable_1T9d'), 'API key removed');
  assert.ok(!clean.includes('tok_live_123'), 'token values removed');
  assert.ok(!clean.includes('AIzaSyD-1234567890abcdef'), 'apikey= values removed');
  assert.ok(scrub('x'.repeat(2000)).length <= 500, 'messages are capped');
  assert.equal(scrubUrl('https://frameup.essentiallysports.com/gallery.html?id=42#top', 'https://frameup.essentiallysports.com'), '/gallery.html');
  assert.equal(scrubUrl('https://cdn.example.com/lib.js?v=1', 'https://frameup.essentiallysports.com'), 'https://cdn.example.com/lib.js');
  assert.equal(scrubUrl('/api/es-generate?brief=private', 'https://frameup.essentiallysports.com'), '/api/es-generate');
  assert.equal(scrubUrl('blob:https://frameup.essentiallysports.com/123', 'https://frameup.essentiallysports.com'), 'blob:');
  const stack = 'TypeError: x is undefined\n    at render (https://frameup.essentiallysports.com/index.html?open=abc:120:5)';
  assert.ok(!reporterLib.scrubStack(stack).includes('open=abc'), 'stacks lose query strings too');
  assert.equal(fingerprintOf({ kind: 'error', message: 'Item 12 missing', stack: '', source: '' }), fingerprintOf({ kind: 'error', message: 'Item 99 missing', stack: '', source: '' }), 'numbers do not split a group');
}

// ── 2. Reporter: dedupe, limits, batching, size ─────────────────────────────
function harness(options = {}) {
  const sent = [];
  const timers = [];
  let clock = 0;
  const reporter = createReporter({
    send: async body => { sent.push(JSON.parse(body)); assert.ok(body.length <= MAX_BODY, 'body under the cap'); },
    now: () => clock,
    setTimer: fn => { timers.push(fn); return timers.length; },
    origin: 'https://frameup.essentiallysports.com',
    page: () => '/generate.html',
    ...options,
  });
  return {
    reporter, sent,
    advance(ms) { clock += ms; },
    async run() { while (timers.length) { await timers.shift()(); } },
  };
}
{
  const h = harness();
  assert.equal(h.reporter.capture({ message: 'TypeError: boom', stack: 'at a (x.js:1:1)' }), true);
  assert.equal(h.reporter.capture({ message: 'TypeError: boom', stack: 'at a (x.js:1:1)' }), false, 'same error is not sent twice');
  h.reporter.capture({ message: 'TypeError: boom', stack: 'at a (x.js:1:1)' });
  assert.equal(h.reporter.pending()[0].occurrences, 3, 'repeats are counted');
  await h.run();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].errors[0].occurrences, 3);
  assert.equal(h.sent[0].errors[0].page, '/generate.html');
  h.reporter.capture({ message: 'TypeError: boom', stack: 'at a (x.js:1:1)' });
  assert.equal(h.reporter.pending().length, 0, 'after sending, repeats are ignored');
}
{
  const h = harness();
  for (let i = 0; i < 8; i += 1) h.reporter.capture({ message: `Distinct problem ${'abcdefgh'[i]}` });
  assert.equal(h.reporter.pending().length, 5, 'at most 5 a minute');
  await h.run();
  assert.equal(h.sent.length, 1, 'batched into one request');
  assert.equal(h.sent[0].errors.length, 5);
  for (let minute = 1; minute <= 6; minute += 1) {
    h.advance(61000);
    for (let i = 0; i < 5; i += 1) h.reporter.capture({ message: `Minute ${'abcdefg'[minute]} problem ${'vwxyz'[i]}` });
    await h.run();
  }
  const total = h.sent.reduce((sum, body) => sum + body.errors.length, 0);
  assert.equal(total, 20, 'at most 20 a page load');
}
{
  const h = harness();
  const bigStack = Array.from({ length: 15 }, (_, i) => `    at fn${'abcdefghijklmno'[i]} (https://frameup.essentiallysports.com/index.html:${i}:1) ${'y'.repeat(180)}`).join('\n');
  for (let i = 0; i < 5; i += 1) h.reporter.capture({ message: `Large ${'abcde'[i]}`, stack: bigStack });
  await h.run();
  const total = h.sent.reduce((sum, body) => sum + body.errors.length, 0);
  assert.equal(total, 5, 'large reports are trimmed to fit, not dropped');
}
{
  const h = harness({ send: async () => { throw new Error('network down'); } });
  h.reporter.capture({ message: 'Will fail to send' });
  await h.run(); // must not throw
}

// ── 3. Browser wiring on a fake window ──────────────────────────────────────
function fakeWindow({ session = { token: 'user-token' } } = {}) {
  const listeners = {};
  const requests = [];
  const win = {
    document: {},
    location: { origin: 'https://frameup.essentiallysports.com', href: 'https://frameup.essentiallysports.com/generate.html?brief=x', pathname: '/generate.html' },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    fetch: async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input).includes('/api/broken')) return { status: 500, ok: false };
      if (String(input).includes('/api/missing')) return { status: 404, ok: false };
      if (String(input).includes('/api/offline')) throw new TypeError('Failed to fetch');
      return { status: 200, ok: true };
    },
    ESAuth: { getSession: async () => session },
  };
  win.top = win;
  return { win, listeners, requests, fire: (type, event) => (listeners[type] || []).forEach(fn => fn(event)) };
}
const flushTimers = () => new Promise(resolve => setTimeout(resolve, 2200));
{
  const w = fakeWindow();
  install(w.win);
  assert.ok(w.win.FrameUpErrors, 'installed');
  w.fire('error', { error: Object.assign(new TypeError('Cannot read properties of undefined (reading \'x\')'), { stack: 'TypeError: ...\n    at go (https://frameup.essentiallysports.com/generate.html?brief=private:10:2)' }), filename: 'https://frameup.essentiallysports.com/generate.html?brief=private', lineno: 10, colno: 2, target: w.win });
  w.fire('error', { message: 'Script error.', error: null, target: w.win });
  w.fire('unhandledrejection', { reason: new Error('Supabase timed out') });
  w.fire('unhandledrejection', { reason: Object.assign(new Error('aborted'), { name: 'AbortError' }) });
  await w.win.fetch('/api/broken', { method: 'POST', body: JSON.stringify({ brief: 'secret brief' }) });
  await w.win.fetch('/api/missing');
  await assert.rejects(w.win.fetch('/api/offline'));
  await w.win.fetch('/api/fine');
  await w.win.fetch('https://other.example.com/api/broken');
  await flushTimers();
  const posts = w.requests.filter(request => request.url === '/api/client-errors');
  assert.equal(posts.length, 1, 'one batched report');
  assert.equal(posts[0].init.headers.Authorization, 'Bearer user-token', 'sent with the signed-in session');
  const errors = JSON.parse(posts[0].init.body).errors;
  assert.deepEqual(errors.map(error => error.kind), ['error', 'rejection', 'api', 'api', 'api'], 'cross-origin "Script error." and AbortError are ignored');
  assert.equal(errors[0].source, '/generate.html', 'script URL scrubbed to its path');
  assert.ok(!JSON.stringify(errors).includes('brief'), 'no query strings or request bodies');
  assert.deepEqual(errors.slice(2).map(error => error.status), [500, 404, 0]);
  assert.ok(!errors.some(error => error.source.includes('other.example.com')), 'other sites are not watched');
}
{
  const w = fakeWindow({ session: null });
  install(w.win);
  w.fire('unhandledrejection', { reason: new Error('signed out error') });
  await flushTimers();
  assert.equal(w.requests.filter(request => request.url === '/api/client-errors').length, 0, 'signed out: nothing is sent');
}
{
  // A failing report endpoint never reports itself.
  const w = fakeWindow();
  w.win.fetch = async (input) => { w.requests.push({ url: String(input) }); return { status: 500, ok: false }; };
  install(w.win);
  w.fire('unhandledrejection', { reason: new Error('first') });
  await flushTimers();
  await flushTimers();
  assert.equal(w.requests.filter(request => request.url === '/api/client-errors').length, 1, 'no loop when /api/client-errors fails');
}

// ── 4. /api/client-errors ───────────────────────────────────────────────────
const fnPath = require.resolve('../netlify/functions/client-errors.js');
let authStatus = 200;
let insertResponse = { status: 201, body: '' };
let inserts = [];
let sentry = [];
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.endsWith('/auth/v1/user')) {
    const ok = options.headers.Authorization === 'Bearer good-token' && authStatus === 200;
    return { ok, status: ok ? 200 : 401, json: async () => (ok ? { id: 'user-1', email: 'Designer@EssentiallySports.com' } : { msg: 'bad jwt' }) };
  }
  if (href.includes('/rest/v1/frameup_client_errors')) {
    inserts.push({ headers: options.headers, rows: JSON.parse(options.body) });
    return { ok: insertResponse.status < 300, status: insertResponse.status, text: async () => insertResponse.body };
  }
  if (href.startsWith('https://o123.ingest.sentry.io/')) {
    sentry.push({ url: href, headers: options.headers, body: options.body });
    return { ok: true, status: 200 };
  }
  throw new Error(`unexpected fetch ${href}`);
};
delete process.env.SENTRY_DSN;
process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef1234567890';
const { handler, parseDsn, _resetLimits } = require(fnPath);
const adapter = require('../api/client-errors.js');
const call = (body, headers = { authorization: 'Bearer good-token' }, method = 'POST') => handler({ httpMethod: method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const goodReport = { errors: [{ kind: 'error', message: 'TypeError: failed for a@b.com at https://x.test/p?q=1', stack: 'at f (https://frameup.essentiallysports.com/index.html?open=1:1:1)', page: '/index.html?open=secret', fingerprint: 'abc123', occurrences: 2, line: 1, col: 1 }] };

{
  assert.equal((await call(goodReport, {}, 'GET')).statusCode, 405);
  assert.equal((await call(goodReport, {})).statusCode, 401, 'no token: 401');
  assert.equal((await call(goodReport, { authorization: 'Bearer wrong' })).statusCode, 401, 'bad token: 401');
  const big = { errors: [{ message: 'x'.repeat(9000) }] };
  assert.equal((await call(big)).statusCode, 413, 'over 8 KB: 413');
  assert.equal((await call(big, {})).statusCode, 401, 'auth is checked before size');
  assert.equal((await call('{nope')).statusCode, 400);
  assert.equal((await call({ errors: [{ message: '' }] })).statusCode, 400);
  assert.equal(inserts.length, 0, 'nothing stored for refused requests');
}
{
  inserts = [];
  const result = await call(goodReport, { authorization: 'Bearer good-token', 'user-agent': 'Mozilla/5.0 test' });
  assert.equal(result.statusCode, 202);
  const body = JSON.parse(result.body);
  assert.equal(body.ok, true);
  assert.equal(body.stored, true);
  assert.equal(body.forwarded, 0, 'no Sentry without SENTRY_DSN');
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].headers.Authorization, 'Bearer good-token', 'written with the person\'s own session (RLS)');
  const row = inserts[0].rows[0];
  assert.equal(row.user_email, 'designer@essentiallysports.com', 'email comes from the verified session, not the body');
  assert.ok(!row.message.includes('a@b.com') && !row.message.includes('?q=1'), 'server scrubs again');
  assert.equal(row.page, '/index.html');
  assert.ok(!row.stack.includes('open=1'));
  assert.equal(row.release, 'abcdef123456');
  assert.equal(row.occurrences, 2);
  assert.equal(row.user_agent, 'Mozilla/5.0 test');
}
{
  inserts = [];
  insertResponse = { status: 404, body: '{"code":"PGRST205","message":"Could not find the table"}' };
  const result = await call(goodReport);
  assert.equal(result.statusCode, 202, 'table missing: accepted, nothing breaks');
  assert.equal(JSON.parse(result.body).stored, false);
  insertResponse = { status: 201, body: '' };
}
{
  _resetLimits();
  let last;
  for (let i = 0; i < 21; i += 1) last = await call(goodReport);
  assert.equal(last.statusCode, 429, 'per-person backstop limit');
  _resetLimits();
}
{
  assert.equal(parseDsn('not a dsn'), null);
  const dsn = parseDsn('https://publickey123@o123.ingest.sentry.io/4501234');
  assert.equal(dsn.envelopeUrl, 'https://o123.ingest.sentry.io/api/4501234/envelope/');
  process.env.SENTRY_DSN = 'https://publickey123@o123.ingest.sentry.io/4501234';
  sentry = [];
  const result = await call(goodReport);
  assert.equal(JSON.parse(result.body).forwarded, 1, 'forwarded to Sentry');
  assert.equal(sentry.length, 1);
  assert.match(sentry[0].headers['X-Sentry-Auth'], /sentry_key=publickey123/);
  assert.ok(!sentry[0].body.toLowerCase().includes('designer@essentiallysports.com'), 'Sentry never gets the email');
  const [, , event] = sentry[0].body.split('\n').map(line => JSON.parse(line));
  assert.match(event.user.id, /^[a-f0-9]{16}$/, 'hashed person id');
  assert.equal(event.release, 'abcdef123456');
  assert.equal(event.tags.kind, 'error');
  delete process.env.SENTRY_DSN;
}
{
  // Vercel adapter: same answers.
  const response = { headers: {}, statusCode: 0, payload: null, setHeader(n, v) { this.headers[n.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, send(p) { this.payload = p; return this; }, json(p) { this.payload = p; return this; } };
  await adapter({ method: 'POST', headers: {}, body: goodReport }, response);
  assert.equal(response.statusCode, 401);
  await adapter({ method: 'POST', headers: { authorization: 'Bearer good-token' }, body: goodReport }, response);
  assert.equal(response.statusCode, 202);
}

console.log('client errors: ok');
