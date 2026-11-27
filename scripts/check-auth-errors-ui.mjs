// Auth + Dashboard UI sweep: every sign-in state (login, create account,
// magic link, reset, auth callback, logout, the loop-breaker panel, the
// in-page "couldn't confirm your login" panel) and every Dashboard view
// (with data, empty, and failed loads), at 1440, 1024 and 375, light and
// dark, in real headless Chrome. No npm deps: Node's WebSocket over CDP.
//
// Supabase is stubbed inside Chrome (CDP Fetch), so nothing reaches the
// real project; /api/* is stubbed by the local server, which also records
// what frameup-errors.js would have sent to /api/client-errors.
//
// Fails on (per state):
//   doubled borders, empty bands, clipped text, horizontal page scroll,
//   misaligned siblings (cards / buttons in a row), non-ES fonts, purple,
//   unlabelled controls, more than one primary button, console errors and
//   uncaught exceptions, broken images, low contrast, error reports that
//   would be sent to /api/client-errors, and broken flows.
// Reports (does not fail): off-grid spacing (not a multiple of 4).
//
// Run: node scripts/check-auth-errors-ui.mjs   (skips if Chrome isn't installed)
//   AUTH_UI_ONLY=dash      only states whose id contains "dash"
//   AUTH_UI_VERBOSE=1      print the off-grid list and every request stubbed
//   AUTH_UI_SHOTS=<dir>    save a full-page PNG of every state there
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Mirrors app-shell.js FEATURES.requests: while requests are paused the
// dashboard sends #board / #list to Overview.
const REQUESTS_PAUSED = /FEATURES = Object\.freeze\(\{ requests: false \}\)/.test(fs.readFileSync(new URL('../app-shell.js', import.meta.url), 'utf8'));
const dashView = view => (REQUESTS_PAUSED && (view === 'board' || view === 'list') ? 'overview' : view);

// AUTH_UI_ROOT=<dir> sweeps another copy of the site (e.g. a base commit for before/after counts).
const ROOT = path.resolve(process.env.AUTH_UI_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find(p => fs.existsSync(p));
if (!CHROME) { console.log('auth/errors UI: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('auth/errors UI: skipped (needs Node with WebSocket)'); process.exit(0); }
const VERBOSE = Boolean(process.env.AUTH_UI_VERBOSE);
const ONLY = process.env.AUTH_UI_ONLY || '';
const SHOTS = process.env.AUTH_UI_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const STARTED = Date.now();

// ─── Local server: the site + stubbed /api/* ────────────────────────────────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.otf': 'font/otf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.webm': 'video/webm', '.mp4': 'video/mp4' };
const reportedBy = new Map(); // host -> what /api/client-errors received (one tab per host)
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return; }
  if (url.pathname.startsWith('/api/')) {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      if (url.pathname === '/api/client-errors') {
        const list = reportedBy.get(req.headers.host) || [];
        reportedBy.set(req.headers.host, list);
        try { (JSON.parse(body).errors || []).forEach(e => list.push(e)); } catch { list.push({ message: 'unparseable report' }); }
        res.writeHead(202, { 'content-type': 'application/json' }); res.end('{"ok":true,"accepted":1,"stored":false}'); return;
      }
      if (url.pathname === '/api/auth-bounce') { res.writeHead(204); res.end(); return; }
      if (url.pathname === '/api/version') { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"ok":false}'); return; }
      // The shapes the pages read (as the real endpoints answer them).
      if (url.pathname === '/api/reel-maker' && /"config"/.test(body)) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, ai: false, voice: { mode: 'off', ready: false, label: 'Captions only', reason: '' }, music: null, aiClips: null, formatModes: {}, dataFormats: [] })); return; }
      if (url.pathname === '/api/impact-stats') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, sources: { beehiiv: { configured: false, label: 'Beehiiv API' }, meta: { configured: false, label: 'Meta Ads API' } } })); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<!doctype html><title>404</title>'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
// Pages run in parallel, each on its own origin (own storage, own error
// reports). Chrome resolves every *.localhost name to this machine.
const WORKERS = Math.max(1, Math.min(6, Number(process.env.AUTH_UI_WORKERS) || 4));
const ORIGINS = Array.from({ length: WORKERS }, (_, i) => (i === 0 ? `http://localhost:${PORT}` : `http://w${i}.localhost:${PORT}`));

// ─── Supabase stub (served inside Chrome via CDP Fetch) ─────────────────────
const USER_ID = '00000000-0000-0000-0000-000000000001';
const QA_EMAIL = 'qa@essentiallysports.com';
const nowIso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const H = 3600e3; const D = 24 * H;
function fakeJwt(exp) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, email: QA_EMAIL, exp, role: 'authenticated', aud: 'authenticated' })}.sig`;
}
const SESSION_EXP = Math.floor(Date.now() / 1000) + 86400;
const USER = { id: USER_ID, email: QA_EMAIL, aud: 'authenticated', role: 'authenticated', email_confirmed_at: nowIso(-30 * D), user_metadata: { name: 'QA Admin' }, app_metadata: {} };
const SESSION = { access_token: fakeJwt(SESSION_EXP), refresh_token: 'qa-refresh', expires_at: SESSION_EXP, expires_in: 86400, token_type: 'bearer', user: USER };

const PEOPLE = [
  ['qa@essentiallysports.com', 'QA Admin', 'Admin', 'Design Operations', 0],
  ['alex.morgan@essentiallysports.com', 'Alex Morgan', 'Designer', 'Senior Designer', 2 * 60e3],
  ['jordan.lee@essentiallysports.com', 'Jordan Lee', 'Associate', 'Editor', 3 * H],
  ['sam.patel@essentiallysports.com', 'Sam Patel With A Much Longer Display Name', 'Associate', 'Social Media Producer', 5 * D],
];
const TASKS = [
  { id: 'req-1', task_type: 'design_request', title: 'Week 12 NFL power rankings carousel', status: 'Backlog', priority: 'High', assigned_to: '', requester_name: 'Jordan Lee', requester_email: PEOPLE[2][0], request_type: 'Social', workspace: 'Social', sport: 'NFL', design_due_at: nowIso(-D), created_at: nowIso(-3 * D), updated_at: nowIso(-2 * D), brief: 'Ten teams, one per slide.' },
  { id: 'req-2', task_type: 'design_request', title: 'LeBron 50-point game quote card for Instagram and Threads with a very long title that should wrap', status: 'In Progress', priority: 'Medium', assigned_to: 'Alex Morgan', requester_name: 'Sam Patel', requester_email: PEOPLE[3][0], request_type: 'Social', workspace: 'Social', sport: 'NBA', design_due_at: nowIso(6 * H), created_at: nowIso(-D), updated_at: nowIso(-H) },
  { id: 'req-3', task_type: 'design_request', title: 'Newsletter header: Masters preview', status: 'Review', priority: 'Low', assigned_to: 'Alex Morgan', requester_name: 'Jordan Lee', requester_email: PEOPLE[2][0], request_type: 'Newsletter', workspace: 'Newsletter', sport: 'Golf', design_due_at: nowIso(3 * D), created_at: nowIso(-5 * D), updated_at: nowIso(-3 * D) },
  { id: 'req-4', task_type: 'design_request', title: 'YouTube thumbnail: F1 Vegas recap', status: 'Done', priority: 'Medium', assigned_to: 'Alex Morgan', requester_name: 'Sam Patel', requester_email: PEOPLE[3][0], request_type: 'YouTube', workspace: 'YouTube', sport: 'F1', design_due_at: nowIso(-2 * D), created_at: nowIso(-6 * D), updated_at: nowIso(-2 * D), completed_at: nowIso(-2 * D) },
  { id: 'exp-1', task_type: 'exported_design', title: 'Stat post: Mahomes 4 TD', status: 'Backlog', creator_name: 'Alex Morgan', creator_email: PEOPLE[1][0], workspace: 'Social', workspace_variant: 'stats-post', sport: 'NFL', filename: 'mahomes-4td.png', created_at: nowIso(-2 * H), updated_at: nowIso(-2 * H), meta_exported_at: nowIso(-2 * H), meta_output_size: '1080x1350', meta_mime_type: 'image/png' },
  { id: 'exp-2', task_type: 'exported_design', title: 'Quote: Caitlin Clark', status: 'Done', creator_name: 'Jordan Lee', creator_email: PEOPLE[2][0], workspace: 'Social', workspace_variant: 'quote-post', sport: 'WNBA', filename: 'clark-quote.png', created_at: nowIso(-26 * H), updated_at: nowIso(-26 * H), meta_exported_at: nowIso(-26 * H), meta_output_size: '1080x1080', meta_mime_type: 'image/png' },
];
const ACTIVITY = [
  { id: 'act-1', event_type: 'design_export', actor_name: 'Alex Morgan', actor_email: PEOPLE[1][0], title: 'Exported Stat post: Mahomes 4 TD', workspace: 'Social', created_at: nowIso(-2 * H), metadata: {} },
  { id: 'act-2', event_type: 'tool_feedback', actor_name: 'Jordan Lee', actor_email: PEOPLE[2][0], title: 'Bug: export button greyed out', workspace: 'Social', created_at: nowIso(-5 * H), metadata: { feedbackType: 'Bug', message: 'The export button stayed grey after picking a template.' } },
  { id: 'act-3', event_type: 'tool_feedback', actor_name: 'Sam Patel', actor_email: PEOPLE[3][0], title: 'Idea: saved colour sets', workspace: 'Newsletter', created_at: nowIso(-2 * D), metadata: { feedbackType: 'Idea', message: 'Let us save a colour set per sport.' } },
];
const ACCESS = [
  { id: 'ar-1', email: 'new.writer@essentiallysports.com', name: 'New Writer', status: 'Pending', reason: 'Writing for the NFL desk', source: 'login', created_at: nowIso(-4 * H), updated_at: nowIso(-4 * H) },
  { id: 'ar-2', email: 'old.intern@essentiallysports.com', name: 'Old Intern', status: 'Approved', reason: '', source: 'login', created_at: nowIso(-9 * D), updated_at: nowIso(-8 * D) },
];
const CLIENT_ERRORS = [
  { created_at: nowIso(-H), user_email: PEOPLE[1][0], kind: 'api', message: 'POST /api/es-generate returned 504', stack: '', page: '/generate.html', source: '/api/es-generate', line: null, col: null, status: 504, fingerprint: 'a1b2c3d4', occurrences: 3, release: 'abc123def456' },
  { created_at: nowIso(-2 * H), user_email: PEOPLE[1][0], kind: 'error', message: 'auth-bounce: check-failed on /index.html', stack: 'storageWritable=true\nonline=true\nsupabaseReachable=false', page: '/index.html', source: '', line: null, col: null, status: null, fingerprint: '0badc0de', occurrences: 1, release: 'abc123def456' },
  { created_at: nowIso(-3 * H), user_email: PEOPLE[2][0], kind: 'error', message: 'TypeError: Cannot read properties of null (reading \'getContext\')', stack: 'TypeError: Cannot read properties of null (reading \'getContext\')\n    at renderPreview (/frameup-editor-ui.js:120:18)\n    at HTMLButtonElement.<anonymous> (/frameup-editor-ui.js:300:5)', page: '/index.html', source: '/frameup-editor-ui.js', line: 120, col: 18, status: null, fingerprint: 'ffee0011', occurrences: 1, release: 'abc123def456' },
];
const AI_USAGE = [
  { created_at: nowIso(-H), user_email: PEOPLE[1][0], feature: 'generate', model: 'claude-haiku', cost_usd: 0.012, input_tokens: 1200, output_tokens: 300, ok: true },
];

// mode: 'full' | 'empty' | 'error' | 'bad-login'
function restRows(table, supaMode) {
  if (supaMode === 'empty') return table === 'es_designer_profiles' ? [rowForProfile(PEOPLE[0])] : [];
  switch (table) {
    case 'es_designer_profiles': return PEOPLE.map(rowForProfile);
    case 'es_designer_presence': return PEOPLE.map(p => ({ email: p[0], name: p[1], workspace: 'Social', page_path: '/index.html', last_seen_at: nowIso(-p[4]), updated_at: nowIso(-p[4]) }));
    case 'es_designer_tasks': return TASKS;
    case 'es_designer_activity': return ACTIVITY;
    case 'es_designer_access_requests': return ACCESS;
    case 'frameup_client_errors': return CLIENT_ERRORS;
    case 'frameup_ai_usage': return AI_USAGE;
    case 'es_designer_role_audit': return [{ created_at: nowIso(-D), actor_email: PEOPLE[0][0], target_email: PEOPLE[1][0], old_role: 'Associate', new_role: 'Designer' }];
    default: return [];
  }
}
function rowForProfile(p) { return { email: p[0], name: p[1], access_role: p[2], role: p[2], designation: p[3], avatar_url: '', updated_at: nowIso(-p[4]), created_at: nowIso(-60 * D), email_confirmed: true }; }
function rpcResult(fn, supaMode) {
  if (/^(is_es_designer_admin|can_manage_es_designer_roles|is_es_designer_approved|is_approved_es_email|is_frameup_approved)/.test(fn)) return true;
  if (supaMode === 'empty') return [];
  if (fn === 'admin_list_es_designer_people') return PEOPLE.map((p, i) => ({ ...rowForProfile(p), last_seen_at: nowIso(-p[4]), last_sign_in_at: nowIso(-p[4]), account_created_at: nowIso(-60 * D), has_account: true, email_confirmed_at: i === 3 ? '' : nowIso(-30 * D), invited_at: '' }));
  if (/access_request/.test(fn)) return ACCESS;
  if (fn === 'list_frameup_gallery') return [];
  return [];
}
const supaSeen = new Set();
function supabaseResponse(url, method, supaMode) {
  const u = new URL(url);
  const p = u.pathname;
  supaSeen.add(`${method} ${p}`);
  const ok = (body, status = 200, extra = {}) => ({ status, body: body === null ? '' : JSON.stringify(body), headers: { 'content-type': 'application/json', ...extra } });
  if (p.startsWith('/auth/v1/')) {
    if (p === '/auth/v1/health') return ok({ ok: true });
    if (p === '/auth/v1/user') return method === 'GET' ? ok(USER) : ok(USER);
    if (p === '/auth/v1/token') {
      if (supaMode === 'bad-login' && u.searchParams.get('grant_type') === 'password') return ok({ error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      return ok(SESSION);
    }
    if (p === '/auth/v1/logout') return ok(null, 204);
    if (p === '/auth/v1/otp' || p === '/auth/v1/recover' || p === '/auth/v1/resend') return ok({});
    if (p === '/auth/v1/signup') return ok({ id: USER_ID, email: QA_EMAIL, confirmation_sent_at: nowIso() });
    if (p === '/auth/v1/verify') return ok(SESSION);
    return ok({});
  }
  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = p.slice('/rest/v1/rpc/'.length);
    if (supaMode === 'error' && !/^(is_es_designer_admin|can_manage)/.test(fn)) return ok({ message: 'stub failure', code: 'XX000' }, 500);
    return ok(rpcResult(fn, supaMode));
  }
  if (p.startsWith('/rest/v1/')) {
    const table = p.slice('/rest/v1/'.length);
    if (supaMode === 'error' && method === 'GET') return ok({ message: 'stub failure', code: 'XX000' }, 500);
    if (method === 'GET' || method === 'HEAD') {
      const rows = restRows(table, supaMode);
      return ok(rows, 200, { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` });
    }
    return ok([], 201);
  }
  if (p.startsWith('/storage/v1/')) return { status: 404, body: '{"error":"not found"}', headers: { 'content-type': 'application/json' } };
  return ok({});
}

// ─── Chrome ─────────────────────────────────────────────────────────────────
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fu-auth-ui-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1440,1000', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error('Chrome did not start')), 15000);
});
const cdpPort = new URL(wsUrl).port;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=';

async function makeTab(base, debuggerUrl) {
  const ws = new WebSocket(debuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  const tab = { base, host: new URL(base).host, supaMode: 'full', consoleProblems: [] };
  let msgId = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise(r => { const i = ++msgId; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const corsHeaders = h => [
    ...Object.entries(h).map(([name, value]) => ({ name, value: String(value) })),
    { name: 'access-control-allow-origin', value: base },
    { name: 'access-control-allow-credentials', value: 'true' },
    { name: 'access-control-allow-headers', value: '*' },
    { name: 'access-control-allow-methods', value: 'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS' },
    { name: 'access-control-expose-headers', value: 'content-range' },
  ];
  async function onPaused(params) {
    const { requestId, request } = params;
    const url = request.url;
    try {
      if (url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')) { await send('Fetch.continueRequest', { requestId }); return; }
      if (/\.supabase\.co\//.test(url)) {
        if (request.method === 'OPTIONS') { await send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: corsHeaders({}), body: '' }); return; }
        const r = supabaseResponse(url, request.method, tab.supaMode);
        if (VERBOSE) console.log('  supabase', request.method, new URL(url).pathname, r.status);
        await send('Fetch.fulfillRequest', { requestId, responseCode: r.status, responseHeaders: corsHeaders(r.headers), body: Buffer.from(r.body).toString('base64') });
        return;
      }
      if (/fonts\.googleapis\.com/.test(url)) { await send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/css' }, { name: 'access-control-allow-origin', value: '*' }], body: '' }); return; }
      // Everything else off-site: answered offline so runs are deterministic
      // (images get a 1x1 placeholder, so live photos never read as broken).
      if (VERBOSE) console.log('  offline', url.slice(0, 120));
      if (params.resourceType === 'Image' || /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url)) {
        await send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'image/png' }, { name: 'access-control-allow-origin', value: '*' }], body: PIXEL });
        return;
      }
      await send('Fetch.fulfillRequest', { requestId, responseCode: 404, responseHeaders: [{ name: 'access-control-allow-origin', value: '*' }], body: '' });
    } catch { /* target navigated */ }
  }
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Fetch.requestPaused') { onPaused(m.params); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      const lines = String(d.exception?.description || d.text || '').split('\n');
      const frame = (lines.find(l => /^\s+at /.test(l)) || '').trim().replace(base, '');
      tab.consoleProblems.push(`uncaught: ${lines[0]}${frame ? ` (${frame})` : ''}`);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
      tab.consoleProblems.push(`console.error: ${String(text).split('\n')[0].slice(0, 200)}`);
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      const en = m.params.entry;
      // Network noise from requests this harness answers on purpose: every
      // off-site request is answered offline (or refused by CORS here).
      if (/supabase\.co\/storage|\/api\/version|favicon/.test(en.url || '')) return;
      if (en.url && !en.url.startsWith(base) && en.source === 'network') return;
      if (/^Access to fetch at 'https?:\/\/(?![a-z0-9.]*localhost|127\.0\.0\.1)/.test(en.text || '')) return;
      tab.consoleProblems.push(`log: ${String(en.text).slice(0, 160)}${en.url ? ` (${en.url.replace(base, '')})` : ''}`);
    }
  });
  tab.send = send;
  tab.evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || ''));
    return r.result?.result?.value;
  };
  tab.goto = async url => {
    await send('Page.navigate', { url });
    for (let i = 0; i < 80; i++) {
      await sleep(150);
      try { if ((await tab.evaluate('document.readyState')) === 'complete') break; } catch { /* navigating */ }
    }
  };
  // Storage is set on a blank same-origin page before each state.
  tab.prepareStorage = async ({ session, theme, extra = {} }) => {
    await tab.goto(`${base}/__blank`);
    const payload = { session: session ? SESSION : null, theme, extra };
    await tab.evaluate(`((p) => {
      localStorage.clear(); sessionStorage.clear();
      if (p.session) localStorage.setItem('sb-xtdusejokbhtjlmijdca-auth-token', JSON.stringify(p.session));
      localStorage.setItem('frameup.theme.v1', p.theme);
      localStorage.setItem('frameup-tour-offer-dismissed', '1');
      sessionStorage.setItem('frameup.tours.offered', '1'); // the tours offer card belongs to another sweep
      Object.entries(p.extra.local || {}).forEach(([k, v]) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
      Object.entries(p.extra.session || {}).forEach(([k, v]) => sessionStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
      return true;
    })(${JSON.stringify(payload)})`);
  };
  tab.close = () => ws.close();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['wss://*', 'ws://*supabase*'] });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  return tab;
}

const firstTarget = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).find(t => t.type === 'page');
// Every other page gets its own window: a background tab is "hidden" (no
// animation frames, paused CSS animations), which skews what it sees.
const browserWs = new WebSocket(wsUrl);
await new Promise(r => browserWs.addEventListener('open', r, { once: true }));
const created = new Map();
browserWs.addEventListener('message', e => { const m = JSON.parse(e.data); if (created.has(m.id)) created.get(m.id)(m.result?.targetId); });
const newWindow = id => new Promise(resolve => { created.set(id, resolve); browserWs.send(JSON.stringify({ id, method: 'Target.createTarget', params: { url: 'about:blank', newWindow: true } })); });
const extraIds = [];
for (let i = 1; i < ORIGINS.length; i++) extraIds.push(await newWindow(i));
browserWs.close();
const allTargets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
const tabs = [await makeTab(ORIGINS[0], firstTarget.webSocketDebuggerUrl)];
for (let i = 1; i < ORIGINS.length; i++) tabs.push(await makeTab(ORIGINS[i], allTargets.find(t => t.id === extraIds[i - 1]).webSocketDebuggerUrl));
for (const tab of tabs) {
  // Both pages behave as the focused, visible page.
  await tab.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await tab.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
}

// ─── In-page checks ─────────────────────────────────────────────────────────
const CHECKS = fs.readFileSync(new URL('./lib/ui-sweep-checks.js', import.meta.url), 'utf8');

// ─── States ─────────────────────────────────────────────────────────────────
const recentLogin = () => ({ 'es.authLoginAt.v1': JSON.stringify({ at: Date.now() - 5000, skew: 0, storage: 'local' }) });
const bounces = () => JSON.stringify([0, 1, 2].map(i => ({ id: `b${i}`, at: Date.now() - (i + 1) * 20000, reason: 'no-session', page: '/index.html', diag: {} })));
const waitFor = (sel, ms = 8000) => `(async () => { const t = Date.now(); while (Date.now() - t < ${ms}) { const e = document.querySelector(${JSON.stringify(sel)}); if (e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden') return true; await new Promise(r => setTimeout(r, 100)); } return false; })()`;
const STATES = [
  { id: 'login', url: '/login.html', expect: '#login-form' },
  { id: 'login-create', url: '/login.html?mode=create', expect: '#login-form', flow: `document.getElementById('create-account-tab').getAttribute('aria-selected') === 'true'` },
  { id: 'login-reason-expired', url: '/login.html?reason=session-expired', expect: '#login-error' },
  { id: 'login-not-approved', url: '/login.html?reason=not-approved', expect: '#login-error' },
  { id: 'login-check-failed', url: '/login.html?reason=check-failed', expect: '#login-error' },
  { id: 'login-confirm-failed', url: '/login.html?confirmation=failed', expect: '#login-error-actions' },
  { id: 'login-password-updated', url: '/login.html?password=updated', expect: '#login-error' },
  { id: 'login-bad-password', url: '/login.html', supa: 'bad-login', expect: '#login-form', allowConsole: /status of 400 .*grant_type=password/,
    act: `(async () => { const e = document.getElementById('login-email'); e.value = 'qa@essentiallysports.com'; e.dispatchEvent(new Event('input', { bubbles: true })); const p = document.getElementById('login-password'); p.value = 'wrong-password-1'; p.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#login-form [type=submit]').click(); await ${waitFor('#login-error:not(:empty)')}; await new Promise(r => setTimeout(r, 400)); return true; })()`,
    flow: `/password|credentials|match/i.test(document.getElementById('login-error').textContent)` },
  { id: 'login-magic-link', url: '/login.html', expect: '#login-form',
    act: `(async () => { const e = document.getElementById('login-email'); e.value = 'qa@essentiallysports.com'; e.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('magic-link').click(); return ${waitFor('#login-confirmation')}; })()`,
    flow: `!document.getElementById('login-confirmation').hidden` },
  { id: 'login-forgot', url: '/login.html', expect: '#login-form',
    act: `(async () => { const e = document.getElementById('login-email'); e.value = 'qa@essentiallysports.com'; e.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('forgot-password').click(); return ${waitFor('#login-confirmation')}; })()`,
    flow: `!document.getElementById('login-confirmation').hidden` },
  { id: 'login-diagnose', url: '/login.html?diagnose=1', expect: '#login-diagnose' },
  { id: 'login-loop-breaker', url: '/login.html?reason=no-session', local: () => ({ 'es.authBounces.v1': bounces() }), expect: '#login-diagnose' },
  { id: 'reset-password-no-link', url: '/reset-password.html', expect: 'main, form, .auth-card, body' },
  { id: 'auth-callback-error', url: '/auth-callback.html?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', expect: 'body' },
  { id: 'auth-callback-no-code', url: '/auth-callback.html', expect: 'body' },
  { id: 'logout', url: '/ai-page/logout.html', session: true, expect: 'body' },
  { id: 'auth-problem-panel', url: '/ai-page/settings.html', session: false, session2: recentLogin, expect: '#es-auth-problem', slow: true },
  // Design requests paused (app-shell.js FEATURES.requests false): #board and
  // #list open Overview instead (owner decision R4, 2026-11-28).
  ...['overview', 'impact', 'board', 'list', 'designs', 'feedback', 'people', 'access', 'activity'].map(view => ({ id: `dash-${view}`, url: `/dashboard.html#${view}`, session: true, expect: '.dashboard-app', dash: dashView(view) })),
  // Behaviour: the Errors card groups the reports; the role menu opens.
  { id: 'dash-errors-card', url: '/dashboard.html#overview', session: true, expect: '.dashboard-app', dash: 'overview',
    act: `(async () => { for (let i = 0; i < 40 && !document.querySelector('#dov-errors .dov-errors li'); i++) await new Promise(r => setTimeout(r, 100)); document.getElementById('dov-errors')?.scrollIntoView(); const d = document.querySelector('#dov-errors details'); if (d) d.open = true; return Boolean(d); })()`,
    flow: `document.querySelectorAll('#dov-errors .dov-errors > li').length === 3 && /Sign-in/.test(document.getElementById('dov-errors').textContent) && /2 people/.test(document.getElementById('dov-insights-list')?.textContent || '')` },
  { id: 'dash-people-role-menu', url: '/dashboard.html#people', session: true, expect: '.dashboard-app', dash: 'people',
    act: `(async () => { for (let i = 0; i < 40 && !document.querySelector('[data-pv-role-open]'); i++) await new Promise(r => setTimeout(r, 100)); const t = document.querySelector('[data-pv-role-open]'); if (!t) return false; t.scrollIntoView({ block: 'center' }); t.click(); await new Promise(r => setTimeout(r, 300)); return t.getAttribute('aria-expanded') === 'true'; })()`,
    flow: `[...document.querySelectorAll('.pv-menu .pv-menu-item')].filter(o => o.getClientRects().length).length >= 3` },
  ...['overview', 'board', 'people', 'access', 'feedback'].map(view => ({ id: `dash-empty-${view}`, url: `/dashboard.html#${view}`, session: true, supa: 'empty', expect: '.dashboard-app', dash: dashView(view) })),
  ...['overview', 'people'].map(view => ({ id: `dash-error-${view}`, url: `/dashboard.html#${view}`, session: true, supa: 'error', expect: '.dashboard-app', dash: view, allowConsole: /stub failure|\[client errors\]|read failed|failed to load resource.*500|status of 500/i })),
  // The error log: every main page, signed in, once (1440, light). Only
  // what would reach /api/client-errors and uncaught exceptions count here;
  // the look of these pages is swept by their own checks.
  ...['index.html', 'index.html#instagram', 'generate.html', 'gallery.html', 'reels.html', 'reel-maker.html', 'video-ads.html', 'trend-design.html', 'design-request.html', 'how-frameup-works.html', 'tool-feedback.html', 'ai-page/profile.html', 'ai-page/settings.html', 'design-system.html', '404.html']
    .map(page => ({ id: `crawl-${page.replace(/[^a-z0-9]+/gi, '-')}`, url: `/${page}`, session: true, expect: 'body', crawl: true })),
].filter(s => !ONLY || s.id.includes(ONLY));

const WIDTHS = [1440, 1024, 375];
const THEMES = ['light', 'dark'];

async function runState(tab, state, width, theme) {
  const { send, evaluate } = tab;
  tab.supaMode = state.supa || 'full';
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await tab.prepareStorage({ session: state.session, theme, extra: { local: (typeof state.local === 'function' ? state.local() : state.local) || {}, session: (typeof state.session2 === 'function' ? state.session2() : state.session2) || {} } });
  tab.consoleProblems = []; reportedBy.set(tab.host, []);
  const loadedAt = Date.now();
  await tab.goto(tab.base + state.url);
  const shown = await evaluate(waitFor(state.expect, state.slow ? 20000 : 10000));
  const problems = [];
  if (!shown) problems.push(`flow: ${state.expect} never appeared (at ${await evaluate('location.pathname + location.search')})`);
  if (state.dash) {
    const ok = await evaluate(`(async () => { for (let i = 0; i < 60; i++) { if (document.body.dataset.dashboardView === ${JSON.stringify(state.dash)} && !document.querySelector('.dov-kpi.is-loading, [aria-busy="true"] .es-skeleton')) break; await new Promise(r => setTimeout(r, 150)); } await new Promise(r => setTimeout(r, 700)); return document.body.dataset.dashboardView; })()`);
    if (ok !== state.dash) problems.push(`flow: dashboard view is "${ok}", expected "${state.dash}"`);
  } else {
    await sleep(600);
  }
  if (state.act) { const r = await evaluate(state.act); if (!r) problems.push('flow: action did not reach its state'); await sleep(400); }
  if (state.flow) { const r = await evaluate(state.flow).catch(e => String(e)); if (r !== true) problems.push(`flow: ${state.flow} -> ${r}`); }
  if (process.env.AUTH_UI_EVAL) console.log(`  [${state.id} ${theme} ${width}]`, JSON.stringify(await evaluate(process.env.AUTH_UI_EVAL).catch(e => String(e))));
  if (SHOTS) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.result?.data) fs.writeFileSync(path.join(SHOTS, `${state.id}-${theme}-${width}.png`), Buffer.from(shot.result.data, 'base64'));
  }
  let res = state.crawl ? { issues: [], offGrid: [] } : await evaluate(`(${CHECKS})()`);
  if (res.issues.length) { await sleep(900); res = await evaluate(`(${CHECKS})()`); }
  if (state.crawl) await sleep(1500); // pages keep loading data after first paint
  problems.push(...res.issues);
  // The reporter sends in a batch 2 s after its first capture. Reports and
  // console errors don't depend on the theme, so dark runs don't wait.
  if (theme === 'light') await sleep(Math.max(0, 2400 - (Date.now() - loadedAt)));
  const consoleIssues = tab.consoleProblems.filter(t => !(state.allowConsole && state.allowConsole.test(t)));
  problems.push(...[...new Set(consoleIssues)].map(t => `console: ${t}`));
  if (!state.allowReports) problems.push(...(reportedBy.get(tab.host) || []).map(r => `would report to /api/client-errors: [${r.kind}] ${String(r.message).slice(0, 160)}`));
  return { problems: [...new Set(problems)], offGrid: res.offGrid };
}

const jobs = [];
for (const state of STATES) {
  for (const theme of state.crawl ? ['light'] : THEMES) {
    for (const width of state.crawl ? [1440] : WIDTHS) jobs.push({ state, theme, width });
  }
}
let failures = 0;
const swept = jobs.length;
const offGridAll = new Map();
const failuresByKind = new Map();
const results = new Array(jobs.length);
let next = 0;
await Promise.all(tabs.map(async tab => {
  while (next < jobs.length) {
    const index = next++;
    const { state, theme, width } = jobs[index];
    let out;
    try { out = await runState(tab, state, width, theme); } catch (error) { out = { problems: [`harness: ${error.message.slice(0, 200)}`], offGrid: [] }; }
    results[index] = out;
  }
}));
results.forEach((out, index) => {
  const { state, theme, width } = jobs[index];
  (out.offGrid || []).forEach(o => offGridAll.set(o, (offGridAll.get(o) || 0) + 1));
  if (!out.problems.length) return;
  failures += 1;
  console.log(`FAIL ${state.id} ${theme} ${width}:`);
  out.problems.slice(0, 25).forEach(p => {
    console.log(`   - ${p}`);
    const kind = p.split(':')[0];
    failuresByKind.set(kind, (failuresByKind.get(kind) || 0) + 1);
  });
  if (out.problems.length > 25) console.log(`   … ${out.problems.length - 25} more`);
});
tabs.forEach(tab => tab.close());
chrome.kill(); server.close();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
if (VERBOSE) console.log('supabase calls stubbed:', [...supaSeen].sort().join('\n  '));
console.log(`off-grid spacing (reported, not failing): ${offGridAll.size} distinct`);
if (VERBOSE || offGridAll.size <= 30) [...offGridAll.keys()].sort().forEach(k => console.log(`   ~ ${k}`));
const secs = Math.round((Date.now() - STARTED) / 1000);
const shape = `${STATES.filter(s => !s.crawl).length} states x ${WIDTHS.length} widths x ${THEMES.length} themes + ${STATES.filter(s => s.crawl).length} pages crawled for error reports`;
if (failures) {
  console.log(`auth/errors UI: ${failures} of ${swept} runs with problems (${shape}, ${secs}s)`);
  console.log('by kind: ' + [...failuresByKind].map(([k, v]) => `${k} ${v}`).join(', '));
  process.exit(1);
}
console.log(`auth/errors UI: ${swept} runs clean (${shape}, ${secs}s)`);
