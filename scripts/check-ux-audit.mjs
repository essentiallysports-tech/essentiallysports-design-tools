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

// Per-check rewrites of local files as Chrome loads them: { 'app-shell.js': text => text' }.
let REWRITE = {};
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
    } else if (!external(request.url) && Object.keys(REWRITE).some(k => new URL(request.url).pathname.endsWith('/' + k))) {
      const k = Object.keys(REWRITE).find(name => new URL(request.url).pathname.endsWith('/' + name));
      fetch(request.url).then(r => r.text()).then(text => c.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/javascript' }, { name: 'cache-control', value: 'no-store' }], body: Buffer.from(REWRITE[k](text)).toString('base64') }));
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

async function key(name) {
  const k = { Tab: [9, 'Tab'], Enter: [13, 'Enter'], Escape: [27, 'Escape'] }[name];
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: k[1], windowsVirtualKeyCode: k[0], text: name === 'Enter' ? '\r' : undefined });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: k[1], windowsVirtualKeyCode: k[0] });
  await sleep(150);
  return c.evaluate("(() => { const a = document.activeElement; return { tag: a.tagName, cls: String(a.className || ''), text: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 60) }; })()");
}
const focusStart = "(() => { document.body.setAttribute('tabindex', '-1'); document.body.focus(); document.body.removeAttribute('tabindex'); return true; })()";

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
  {
    // Offline: Generate showed the browser's "Failed to fetch". fetchWithAuth
    // (es-auth.js) now turns a network failure into a plain sentence.
    id: 'offline-plain-error',
    async run() {
      if (!await open('/generate.html', { ready: "document.querySelector('#gen-brief') && document.querySelector('#gen-submit') && window.ESAuth?.fetchWithAuth" })) return 'Generate never loaded';
      await sleep(800);
      await c.send('Network.enable');
      await c.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      try {
        await c.evaluate("(() => { const t = document.querySelector('#gen-brief'); t.value = 'Josh Allen runs for 3 TDs as the Bills beat the Chiefs 30-21'; t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#gen-submit').click(); return true; })()");
        if (!await waitFor("/Could not generate/.test(document.querySelector('#gen-notice')?.innerText || '')", 8000)) return 'no error notice when offline';
        const text = await c.evaluate("document.querySelector('#gen-notice').innerText");
        if (/Failed to fetch|NetworkError|Load failed/i.test(text)) return 'raw browser error shown: ' + text.replace(/\s+/g, ' ').slice(0, 160);
        if (!/offline|connection/i.test(text)) return 'offline notice does not mention the connection: ' + text.replace(/\s+/g, ' ').slice(0, 160);
        // The type survives (callers check error.name), aborts pass through.
        const kinds = await c.evaluate("(async () => { const out = {}; try { await window.ESAuth.fetchWithAuth('/api/x'); } catch (e) { out.offline = e.name; } const ac = new AbortController(); ac.abort(); try { await window.ESAuth.fetchWithAuth('/api/x', { signal: ac.signal }); } catch (e) { out.abort = e.name; } return out; })()");
        if (kinds.offline !== 'TypeError') return 'network failure is no longer a TypeError: ' + kinds.offline;
        if (kinds.abort !== 'AbortError') return 'an abort is reported as ' + kinds.abort;
      } finally {
        await c.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      }
      return '';
    },
  },
  {
    // Video Ads "Make my daily set" with the trends check failing (500) said
    // "No trending moment for this sport right now": an outage read as no news.
    id: 'video-ads-daily-set-trends-down',
    async run() {
      API = { '/api/video-ads': { status: 500, body: { ok: false, error: 'boom' } } };
      if (!await open('/video-ads.html', { ready: "[...document.querySelectorAll('button')].some(b => /Make my daily set/.test(b.textContent))", ms: 15000 })) return 'Video Ads never showed Make my daily set';
      await sleep(600);
      await c.evaluate("[...document.querySelectorAll('button')].find(b => /Make my daily set/.test(b.textContent)).click(); true");
      if (!await waitFor("/load today|trending moment/i.test(document.body.innerText)", 6000)) return 'no message after the daily set failed';
      const text = await c.evaluate("document.body.innerText");
      if (/No trending moment for this sport/.test(text)) return 'a failed trends check is reported as "No trending moment"';
      if (!/Couldn’t load today’s trending moments/.test(text)) return 'no "couldn’t load" message';
      // With trends up but nothing for the sport, the "no moment" message stays.
      API = { '/api/video-ads': (req, url) => ({ status: 200, body: { ok: true, items: [] } }) };
      await c.evaluate("[...document.querySelectorAll('button')].find(b => /^\\s*Try again\\s*$/.test(b.textContent) && b.closest('[id*=set], [class*=set]'))?.click(); true");
      await waitFor("/No trending moment for this sport/.test(document.body.innerText)", 6000);
      const after = await c.evaluate("document.body.innerText");
      if (!/No trending moment for this sport/.test(after)) return 'empty trends no longer say "No trending moment"';
      return '';
    },
  },
  {
    // Design requests are paused, so their buttons are hidden, but How FrameUp
    // works still said "hand a clear brief to the design team" and kept a
    // "Need something custom? ... send the design team one clear brief" block
    // with no way to do it (a dead end).
    id: 'how-no-paused-requests',
    async run() {
      if (!await open('/how-frameup-works.html', { ready: "document.documentElement.classList.contains('fu-requests-off') && document.querySelector('.how-help')" })) return 'How FrameUp works never loaded';
      const text = await c.evaluate("document.querySelector('main').innerText");
      if (/design team/i.test(text)) return 'still tells people to brief the design team while requests are paused';
      if (/Request a design/i.test(text)) return 'a "Request a design" button is visible';
      const help = await c.evaluate("[...document.querySelectorAll('.how-help a')].filter(a => a.getClientRects().length).length");
      if (help < 3) return 'the Help links went missing';
      const toc = await c.evaluate("[...document.querySelectorAll('.how-toc a')].filter(a => a.getClientRects().length).map(a => a.innerText.trim())");
      if (toc.includes('Custom designs')) return 'the page menu still offers "Custom designs"';
      return '';
    },
  },
  {
    // Merch's Create button showed a "⌘ ↵" shortcut hint on phones.
    id: 'merch-no-kbd-on-phone',
    async run() {
      for (const [width, want] of [[375, false], [1440, true]]) {
        if (!await open('/merch.html', { width, ready: "document.querySelector('#mx-create-kbd')", ms: 15000 })) return `merch never loaded at ${width}`;
        const shown = await c.evaluate("Boolean(document.querySelector('#mx-create-kbd').getClientRects().length)");
        if (shown !== want) return `at ${width}px the ⌘ ↵ hint is ${shown ? 'shown' : 'hidden'}`;
      }
      return '';
    },
  },
  {
    // Keyboard users tabbed through ~20 sidebar links before the work on every
    // page. The first Tab stop is now "Skip to main content".
    id: 'skip-link',
    async run() {
      for (const [url, expectTag] of [['/generate.html', 'MAIN'], ['/gallery.html', 'MAIN'], ['/index.html#instagram', 'DIV']]) {
        if (!await open(url, { ready: "document.querySelector('.es-skip-link') && document.querySelector('.es-sidebar')", ms: 15000 })) return `${url}: no skip link`;
        await sleep(500);
        await c.evaluate(focusStart);
        const first = await key('Tab');
        if (!/es-skip-link/.test(first.cls)) return `${url}: first Tab stop is ${first.tag}.${first.cls} "${first.text}", not the skip link`;
        const shown = await c.evaluate("(() => { const r = document.querySelector('.es-skip-link').getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight; })()");
        if (!shown) return `${url}: the focused skip link is off screen`;
        const before = await c.evaluate("document.querySelector('.app')?.className || ''");
        const landed = await key('Enter');
        if (landed.tag !== expectTag) return `${url}: Enter on the skip link went to ${landed.tag}.${landed.cls} "${landed.text}"`;
        const after = await c.evaluate("document.querySelector('.app')?.className || ''");
        if (before !== after) return `${url}: the Enter that followed the skip link also pressed a control (${before} -> ${after})`;
        const next = await key('Tab');
        if (/es-sidebar|es-skip-link/.test(next.cls)) return `${url}: Tab after skipping went back into the navigation`;
      }
      return '';
    },
  },
  // ── Slice 2 (qa/ux-audit-2, 2026-11-28) ────────────────────────────────
  {
    // Owner decision R4: while Design Requests are paused the admin dashboard
    // hides the Open requests KPI, the Board and Requests tabs and request
    // activity; switching requests back on brings them back.
    id: 'dashboard-requests-paused',
    async run() {
      const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
      const REQ = '00000000-0000-4000-8000-0000000000a1';
      SB = {
        is_es_designer_admin: [200, true],
        es_designer_tasks: [200, [
          { id: REQ, source_id: 'REQ-1', task_type: 'design_request', title: 'Lakers playoff poster', status: 'In Progress', priority: 'Urgent', requester_email: 'ana@essentiallysports.com', design_due_at: ago(30), created_at: ago(50), updated_at: ago(2) },
          { id: '00000000-0000-4000-8000-0000000000b1', task_type: 'exported_design', title: 'Scheffler wins', status: 'Backlog', creator_email: 'priya@essentiallysports.com', workspace: 'Social Media', created_at: ago(3), updated_at: ago(3), meta_exported_at: ago(3) },
        ]],
        es_designer_activity: [200, [
          { id: 'a1', created_at: ago(1), type: 'request_submitted', label: 'New request: Lakers playoff poster', entity_type: 'request', entity_id: 'REQ-1' },
          { id: 'a2', created_at: ago(2), type: 'task_updated', label: 'Updated Lakers playoff poster', entity_type: 'task', entity_id: REQ },
          { id: 'a3', created_at: ago(3), type: 'design_exported', label: 'Exported Scheffler wins', entity_type: 'task', entity_id: '00000000-0000-4000-8000-0000000000b1' },
        ]],
      };
      await c.send('Network.enable');
      await c.send('Network.setCacheDisabled', { cacheDisabled: true });
      const read = `(() => ({
        kpis: [...document.querySelectorAll('.dov-kpi')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.dataset.kpi),
        tabs: [...document.querySelectorAll('.sidebar-nav [data-dashboard-view]')].filter(e => e.getClientRects().length).map(e => e.dataset.dashboardView),
        feed: document.querySelector('#dov-activity-feed').innerText,
        log: document.querySelector('#activity-list').innerText,
        queue: document.querySelector('#dov-queue').closest('.dov-card').innerText,
        view: document.body.dataset.dashboardView,
      }))()`;
      try {
        for (const on of [false, true]) {
          REWRITE = on ? { 'app-shell.js': t => t.replace('Object.freeze({ requests: false })', 'Object.freeze({ requests: true })') } : {};
          await c.send('Page.navigate', { url: `${base}/__blank` }); await sleep(200); // a full load, not a hash change
          if (!await open('/dashboard.html#board', { ready: "document.querySelector('#dov-activity-feed .dov-feed')", ms: 20000 })) return `dashboard never showed the activity feed (requests ${on ? 'on' : 'off'})`;
          await sleep(800);
          const r = await c.evaluate(read);
          const hasReq = r.kpis.includes('requests') && r.tabs.includes('board') && r.tabs.includes('list') && /Lakers/.test(r.feed) && /Lakers/.test(r.log) && /Open requests/.test(r.queue);
          const noReq = !r.kpis.includes('requests') && !r.tabs.includes('board') && !r.tabs.includes('list') && !/Lakers|request/i.test(r.feed) && !/Lakers/.test(r.log) && !/Lakers|Open board|Design requests/i.test(r.queue) && /Scheffler/.test(r.feed);
          if (on && !hasReq) return 'requests switched on but the dashboard does not show them: ' + JSON.stringify(r).slice(0, 400);
          if (!on && !noReq) return 'requests paused but the dashboard still shows them: ' + JSON.stringify(r).slice(0, 400);
          if (!on && r.view !== 'overview') return '#board while paused opened ' + r.view;
          if (on && r.view !== 'board') return '#board with requests on opened ' + r.view;
        }
      } finally {
        await c.send('Network.setCacheDisabled', { cacheDisabled: false });
      }
      return '';
    },
  },
];

let failed = 0; let ran = 0;
const only = process.env.UX_ONLY || '';
for (const check of CHECKS) {
  if (only && !check.id.startsWith(only)) continue;
  API = {}; SB = {}; REWRITE = {};
  ran++;
  let problem = '';
  try { problem = await check.run(); } catch (error) { problem = 'threw: ' + String(error.message || error).slice(0, 300); }
  if (!problem && errors.length) problem = 'page errors: ' + errors.slice(0, 3).join(' | ');
  if (problem) { failed++; console.log(`FAIL ${check.id}: ${problem}`); } else console.log(`ok   ${check.id}`);
}
c.close(); server.close();
console.log(`ux audit: ${ran - failed}/${ran} ok`);
process.exit(failed ? 1 : 0);
