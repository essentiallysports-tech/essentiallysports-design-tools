// UX audit regressions (qa/ux-audit, 2026-11-27): one small flow per bug the
// audit found and fixed, in real headless Chrome with a fake session, every
// /api/* stubbed and Supabase answered locally (nothing leaves the machine,
// no AI, no Fourthwall).
//
// Run: node scripts/check-ux-audit.mjs   (skips if Chrome isn't installed)
//   UX_ONLY=gallery   only the checks whose id starts with this
import { startServer, startChrome, findChrome, FAKE_SESSION, sleep } from './_qa-chrome.mjs';

const CHROME = findChrome();
if (!CHROME) { console.log('ux audit: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('ux audit: skipped (needs Node with WebSocket)'); process.exit(0); }

// ── Stubs ──────────────────────────────────────────────────────────────────
let API = {}; // per-check overrides: { '/api/x': { status, body } }
const { server, base } = await startServer({
  api: async (req, url) => {
    for (const [k, v] of Object.entries(API)) if (url.pathname.startsWith(k)) return typeof v === 'function' ? v(req, url) : v;
    if (url.pathname === '/api/ai-status') return { status: 200, body: { ok: true, mode: 'ai', userLimitUsd: 20, userSpentUsd: 3.42 } };
    return null;
  },
});
let SB = {}; // per-check Supabase overrides by RPC / table name: { list_frameup_gallery: [status, body] }
function supabaseReply(url, method, headers) {
  const p = new URL(url).pathname;
  const user = { id: '00000000-0000-0000-0000-000000000001', email: 'qa@essentiallysports.com', aud: 'authenticated', role: 'authenticated', user_metadata: { full_name: 'QA Tester' }, app_metadata: {} };
  const name = p.split('/').pop();
  if (SB[name]) return SB[name];
  if (p.startsWith('/auth/v1/user')) return [200, user];
  if (p.startsWith('/auth/v1/token')) { const exp = Math.floor(Date.now() / 1000) + 86400; return [200, { access_token: 'x', refresh_token: 'x', expires_in: 86400, expires_at: exp, token_type: 'bearer', user }]; }
  if (p.startsWith('/auth/v1/')) return [200, {}];
  if (p.startsWith('/storage/v1/object/sign')) return [200, []];
  if (p.startsWith('/storage/v1/')) return [400, { error: 'not found' }];
  if (p.startsWith('/rest/v1/rpc/')) return [200, name.startsWith('list_') ? [] : null];
  if (p.startsWith('/rest/v1/')) {
    if (method !== 'GET' && method !== 'HEAD') return [201, []];
    if (/vnd\.pgrst\.object/.test(headers.Accept || headers.accept || '')) return [406, { code: 'PGRST116', message: 'no rows' }];
    return [200, []];
  }
  return [404, {}];
}

const c = await startChrome(CHROME);
const errors = [];
const external = u => { try { const h = new URL(u).hostname; return h !== 'localhost' && h !== '127.0.0.1'; } catch { return false; } };
c.on(m => {
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params;
    if (/supabase\.co/.test(request.url)) {
      const [status, body] = supabaseReply(request.url, request.method, request.headers || {});
      const headers = [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }, { name: 'access-control-allow-headers', value: '*' }, { name: 'access-control-allow-methods', value: '*' }, { name: 'content-range', value: '0-0/0' }];
      c.send('Fetch.fulfillRequest', { requestId, responseCode: request.method === 'OPTIONS' ? 204 : status, responseHeaders: headers, body: Buffer.from(request.method === 'OPTIONS' ? '' : JSON.stringify(body)).toString('base64') });
    } else if (external(request.url) && !/fonts\.(googleapis|gstatic)\.com/.test(request.url)) {
      c.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    } else c.send('Fetch.continueRequest', { requestId });
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
});
await c.send('Page.enable');
await c.send('Runtime.enable');
await c.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
await c.send('Page.navigate', { url: `${base}/__blank` });
await sleep(600);
await c.evaluate(FAKE_SESSION);

async function open(url, { width = 1440, ready = 'true', ms = 12000 } = {}) {
  await c.send('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 812 : 900, deviceScaleFactor: 1, mobile: width < 600 });
  errors.length = 0;
  await c.send('Page.navigate', { url: base + url });
  await sleep(300);
  return waitFor(ready, ms);
}
async function waitFor(expr, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await c.evaluate(`Boolean(${expr})`)) return true; } catch {} await sleep(150); }
  return false;
}

// ── Checks ────────────────────────────────────────────────────────────────
const GALLERY_ROWS = [
  { id: '00000000-0000-4000-8000-000000000001', title: 'Scheffler wins again', workspace: 'Social Media', workspace_variant: 'Cover', team_or_league: 'PGA Tour', creator_name: 'Priya Shah', exported_at: new Date(Date.now() - 3600e3).toISOString(), output_size: '1080x1350', has_design: true },
  { id: '00000000-0000-4000-8000-000000000002', title: 'Ohtani MVP', workspace: 'YouTube', workspace_variant: 'Player Stats', team_or_league: 'Dodgers', creator_name: 'Sam Lee', exported_at: new Date(Date.now() - 7200e3).toISOString(), output_size: '1280x720', has_design: false },
];
const CHECKS = [
  {
    // A post with no stored preview opened in the viewer: it used to show an
    // empty grey pane (a landscape <img> with no src is 0px tall), a stray
    // empty "Posted" pill, and dead prev / next arrows on a single result.
    id: 'gallery-viewer-no-preview',
    async run() {
      SB = { list_frameup_gallery: [200, GALLERY_ROWS], get_frameup_gallery_preview: [200, null] };
      if (!await open('/gallery.html?q=ohtani', { ready: "document.querySelector('.gallery-card:not(.is-skeleton)')" })) return 'gallery never showed a card';
      await c.evaluate("document.querySelector('.gallery-card:not(.is-skeleton)').click(); true");
      if (!await waitFor("document.querySelector('#gallery-viewer').open && document.querySelector('.gallery-viewer__media.is-missing')", 4000)) return 'no "No preview" state in the viewer for a post without a preview';
      const r = await c.evaluate(`(() => {
        const media = document.querySelector('.gallery-viewer__media');
        const pill = document.querySelector('#gallery-viewer-posted .fp-platform');
        const nav = [...document.querySelectorAll('.gallery-viewer__nav')].filter(e => e.getClientRects().length).length;
        return { msg: getComputedStyle(media, '::after').content, pill: pill ? getComputedStyle(pill).display : 'none', nav };
      })()`);
      if (!/No preview/.test(r.msg)) return 'viewer has no "No preview" message: ' + r.msg;
      if (r.pill !== 'none') return 'hidden "Posted" status pill is drawn (display ' + r.pill + ')';
      if (r.nav) return `${r.nav} prev / next arrow(s) shown for a single post`;
      // A post with a preview clears the message (state does not leak between posts).
      SB = { list_frameup_gallery: [200, GALLERY_ROWS], get_frameup_gallery_preview: [200, '/social-media-guide-02.webp'] };
      if (!await open('/gallery.html', { ready: "document.querySelectorAll('.gallery-card:not(.is-skeleton)').length === 2" })) return 'gallery never showed both cards';
      await c.evaluate("document.querySelector('.gallery-card:not(.is-skeleton)').click(); true");
      if (!await waitFor("document.querySelector('#gallery-viewer-image').getAttribute('src')", 4000)) return 'preview never loaded';
      const after = await c.evaluate("({ missing: document.querySelector('.gallery-viewer__media').classList.contains('is-missing'), nav: [...document.querySelectorAll('.gallery-viewer__nav')].filter(e => e.getClientRects().length).length })");
      if (after.missing) return '"No preview" shown over a post that has one';
      if (after.nav !== 2) return 'prev / next arrows missing with two posts';
      return '';
    },
  },
  {
    // Old Design Request links (requests are paused) used to jump Home with
    // ?paused=requests and no word of why.
    id: 'requests-paused-note',
    async run() {
      if (!await open('/design-request.html', { ready: "location.pathname.endsWith('/index.html') && document.querySelector('[data-shell-note=requests-paused]')", ms: 15000 })) return 'no "requests are paused" note after an old Design Request link';
      const r = await c.evaluate("({ text: document.querySelector('[data-shell-note=requests-paused]').textContent, live: document.querySelector('#es-toast-region').getAttribute('aria-live'), search: location.search })");
      if (!/paused/i.test(r.text)) return 'note does not say requests are paused: ' + r.text;
      if (r.live !== 'polite') return 'note is not announced (aria-live ' + r.live + ')';
      if (/paused=/.test(r.search)) return 'the ?paused= flag stays in the address (shows again on reload)';
      return '';
    },
  },
];

let failed = 0; let ran = 0;
const only = process.env.UX_ONLY || '';
for (const check of CHECKS) {
  if (only && !check.id.startsWith(only)) continue;
  API = {}; SB = {};
  ran++;
  let problem = '';
  try { problem = await check.run(); } catch (error) { problem = 'threw: ' + String(error.message || error).slice(0, 300); }
  if (!problem && errors.length) problem = 'page errors: ' + errors.slice(0, 3).join(' | ');
  if (problem) { failed++; console.log(`FAIL ${check.id}: ${problem}`); } else console.log(`ok   ${check.id}`);
}
c.close(); server.close();
console.log(`ux audit: ${ran - failed}/${ran} ok`);
process.exit(failed ? 1 : 0);
