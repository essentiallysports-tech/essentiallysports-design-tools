// UX audit regressions (qa/ux-audit, 2026-11-27): one small flow per bug the
// audit found and fixed, in real headless Chrome with a fake session, every
// /api/* stubbed and Supabase answered locally (nothing leaves the machine,
// no AI, no Fourthwall).
//
// Run: node scripts/check-ux-audit.mjs   (skips if Chrome isn't installed)
//   UX_ONLY=gallery   only the checks whose id starts with this
import { startServer, startChrome, findChrome, FAKE_SESSION, sleep, ROOT as ROOT_DIR } from './_qa-chrome.mjs';

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
    // Newsletter's longer "Copy image link" squeezed Export to "Exp…" in the
    // 320px panel (1024-1279px).
    id: 'editor-export-label',
    async run() {
      for (const [hash, width] of [['newsletter', 1024], ['newsletter', 1279], ['instagram', 1024], ['youtube', 1280]]) {
        if (!await open(`/index.html#${hash}`, { width, ready: "document.querySelector('.studio-export-section #studio-export-btn')?.getClientRects().length", ms: 15000 })) return `${hash} ${width}: no Export button`;
        await sleep(600);
        const cut = await c.evaluate(`[...document.querySelectorAll('.studio-export-section .studio-topbar-right > button')].filter(b => b.getClientRects().length).filter(b => { const s = b.querySelector('span') || b; return s.scrollWidth > s.clientWidth + 1; }).map(b => b.id)`);
        if (cut.length) return `${hash} at ${width}px: label cut on ${cut.join(', ')}`;
      }
      return '';
    },
  },
  {
    // Editor load layout shift was ~0.25-0.4 (canvas animated through each
    // fit, the Layers column folded after paint, the panel strip arrived on
    // window load). Median of three loads must stay low.
    id: 'editor-load-shift',
    async run() {
      await c.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__uxCls=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__uxCls.push(e.value)}).observe({type:'layout-shift',buffered:true})}catch(e){}" });
      const out = [];
      for (const [hash, width] of [['youtube', 1280], ['instagram', 1440], ['newsletter', 1440]]) {
        const vals = [];
        for (let i = 0; i < 3; i++) {
          await c.send('Page.navigate', { url: `${base}/__blank` }); await sleep(150);
          if (!await open(`/index.html#${hash}`, { width, ready: "document.readyState === 'complete'", ms: 15000 })) return `${hash}: never loaded`;
          await sleep(2500);
          vals.push(await c.evaluate('(window.__uxCls || []).reduce((a, b) => a + b, 0)'));
        }
        vals.sort((a, b) => a - b);
        out.push(`${hash}@${width} ${vals[1].toFixed(3)}`);
        if (vals[1] > 0.15) return `layout shift on load too high: ${out.join(', ')}`;
      }
      return '';
    },
  },
  {
    // Undo across a Newsletter asset switch restored the old asset's state
    // under the other asset's canvas (activeNewsletterAsset was not synced).
    id: 'newsletter-undo-asset',
    async run() {
      if (!await open('/index.html#newsletter', { ready: "window.FrameUpEditorBridge && document.querySelector('#newsletter-asset-select') && document.readyState === 'complete'", ms: 15000 })) return 'newsletter never loaded';
      await sleep(1200);
      const r = await c.evaluate(`(async () => {
        const sl = ms => new Promise(res => setTimeout(res, ms));
        const B = window.FrameUpEditorBridge;
        const sel = document.getElementById('newsletter-asset-select');
        const ta = document.getElementById('pill-text');
        const pick = v => { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); };
        const type = v => { ta.value = v; ta.dispatchEvent(new Event('input', { bubbles: true })); };
        const snap = () => ({ active: B.activeNewsletterAsset, state: B.state.newsletterAsset, select: sel.value, label: document.querySelector('.canvas-label').textContent, text: ta.value, ratio: +(document.getElementById('preview').width / document.getElementById('preview').height).toFixed(2) });
        pick('feature-image'); await sl(700); type('FEATURE TEXT'); await sl(900);
        const a = snap();
        pick('section-header'); await sl(900); type('HEADER TEXT'); await sl(900);
        const b = snap();
        const undo = document.querySelector('[data-history="undo"]');
        for (let i = 0; i < 6 && B.state.newsletterAsset !== 'feature-image'; i++) { undo.click(); await sl(700); }
        const u = snap();
        const redo = document.querySelector('[data-history="redo"]');
        for (let i = 0; i < 6 && B.state.newsletterAsset !== 'section-header'; i++) { redo.click(); await sl(700); }
        return { a, b, u, r: snap() };
      })()`);
      const same = (x, y) => x.active === y.active && x.state === y.state && x.select === y.select && x.label === y.label && x.ratio === y.ratio;
      if (r.u.state !== 'feature-image') return 'Undo never got back to the Feature Image step';
      if (!same(r.u, r.a)) return `after Undo the editor shows ${JSON.stringify(r.u)}, expected ${JSON.stringify(r.a)}`;
      if (!/FEATURE TEXT/.test(r.u.text)) return 'after Undo the text box does not hold the Feature Image text: ' + r.u.text;
      if (!same(r.r, r.b)) return `after Redo the editor shows ${JSON.stringify(r.r)}, expected ${JSON.stringify(r.b)}`;
      return '';
    },
  },
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
  {
    // Owner decision R5: a live trend card fills the brief and asks first;
    // nothing is generated (no AI spend) until "Generate designs".
    id: 'generate-trend-confirm',
    async run() {
      const posts = [];
      API = {
        '/api/trend-design': { status: 200, body: { ok: true, categories: [{ id: 'nba', label: 'NBA' }], items: [{ title: 'LeBron James scores 40 in Lakers win', category: 'nba' }, { title: 'Chiefs clinch AFC West', category: 'nfl' }] } },
        '/api/es-generate': req => { if (req.method === 'POST') posts.push(1); return { status: 500, body: { ok: false, error: 'stub' } }; },
      };
      if (!await open('/generate.html', { ready: "document.querySelector('#gen-live .gen-trend:not(.is-skeleton)')", ms: 15000 })) return 'no live trend cards';
      await sleep(500);
      await c.evaluate("(() => { const b = document.querySelector('#gen-live .gen-trend'); b.focus(); b.click(); return true; })()");
      if (!await waitFor("document.querySelector('dialog.gen-trend-confirm[open]')", 3000)) return 'clicking a trend card did not ask first';
      await sleep(400);
      if (posts.length) return 'a generate request fired before the confirm';
      const d = await c.evaluate("(() => { const d = document.querySelector('dialog.gen-trend-confirm'); return { text: d.innerText, label: document.getElementById(d.getAttribute('aria-labelledby'))?.textContent, focusIn: d.contains(document.activeElement), brief: document.querySelector('#gen-brief').value }; })()");
      if (!/AI budget/.test(d.text)) return 'the confirm does not mention the AI budget: ' + d.text;
      if (!/Generate designs for this trend/.test(d.label || '')) return 'the dialog has no accessible title';
      if (!d.focusIn) return 'focus is not inside the confirm';
      if (!/LeBron/.test(d.brief)) return 'the brief was not prefilled';
      const back = await key('Escape');
      if (await c.evaluate("Boolean(document.querySelector('dialog.gen-trend-confirm'))")) return 'Esc did not close the confirm';
      if (!/gen-trend/.test(back.cls)) return `Esc left focus on ${back.tag}.${back.cls}, not the trend card`;
      await sleep(400);
      if (posts.length) return 'Esc still generated';
      await c.evaluate("document.querySelector('#gen-live .gen-trend').click(); true");
      await waitFor("document.querySelector('dialog.gen-trend-confirm [data-trend-confirm]')", 3000);
      await c.evaluate("document.querySelector('dialog.gen-trend-confirm [data-trend-confirm]').click(); true");
      if (!await waitFor('false', 1)) { /* settle */ }
      for (let i = 0; i < 30 && !posts.length; i++) await sleep(150);
      if (!posts.length) return '"Generate designs" did not generate';
      errors.length = 0;
      return '';
    },
  },
  {
    // R6: Generate showed the server's raw error text ("Internal error:
    // TypeError: …"). Also: no live trends left a heading over nothing.
    id: 'generate-friendly-error',
    async run() {
      API = {
        '/api/trend-design': { status: 500, body: { ok: false } },
        '/api/es-generate': req => req.method === 'POST' ? { status: 500, body: { error: 'Internal error: TypeError: cannot read properties of undefined (reading map)' } } : { status: 200, body: { ok: true } },
      };
      if (!await open('/generate.html', { ready: "document.querySelector('#gen-brief') && document.querySelector('#gen-submit') && window.ESAuth?.fetchWithAuth && !document.querySelector('#gen-live').hasAttribute('aria-busy')", ms: 15000 })) return 'Generate never loaded';
      const note = await c.evaluate("(() => { const n = document.getElementById('gen-live-note'); return n && !n.hidden && n.getClientRects().length > 0; })()");
      if (!note) return 'no line under "Start from a live trend" when there are no trends';
      await c.evaluate("(() => { document.querySelector('[data-look=\"templates\"], [data-look=templates]')?.click(); const t = document.querySelector('#gen-brief'); t.value = 'Josh Allen runs for 3 TDs as the Bills beat the Chiefs 30-21'; t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#gen-submit').click(); return true; })()");
      if (!await waitFor("/Could not generate|went wrong/i.test(document.querySelector('#gen-notice')?.innerText || '')", 10000)) return 'no error notice';
      const text = await c.evaluate("document.querySelector('#gen-notice').innerText");
      if (/TypeError|Internal error|undefined/.test(text)) return 'raw server error shown: ' + text.replace(/\s+/g, ' ').slice(0, 160);
      errors.length = 0;
      return '';
    },
  },
  {
    // R7: with no trends, Home said "nothing trending" twice (top story and
    // Trending now). Also no "brief the design team" copy while paused.
    id: 'home-no-trends-once',
    async run() {
      API = { '/api/trend-design': { status: 200, body: { ok: true, items: [], categories: [] } } };
      await c.evaluate('sessionStorage.clear(); true');
      if (!await open('/index.html#frames', { ready: "document.querySelector('[data-today=spotlight] .home-today__body:not([aria-busy=true])') && /trending/i.test(document.querySelector('[data-today=spotlight]').innerText)", ms: 15000 })) return 'Home top story never settled';
      await sleep(500);
      const r = await c.evaluate("({ cards: [...document.querySelectorAll('.home-today__card')].filter(e => e.getClientRects().length && /nothing trending|nothing else trending|no sports trends|quiet right now/i.test(e.innerText)).map(e => e.dataset.today), how: document.querySelector('.home-start').innerText })");
      if (r.cards.length !== 1) return `${r.cards.length} cards say nothing is trending: ${r.cards.join(', ')}`;
      if (/design team/i.test(r.how)) return 'Home still tells people to brief the design team while requests are paused';
      // With stories the Trending now card is back.
      API = { '/api/trend-design': { status: 200, body: { ok: true, categories: [{ id: 'nba', label: 'NBA' }], items: [1, 2, 3, 4].map(i => ({ id: 't' + i, title: `Story ${i} about the Lakers`, category: 'nba', publishedAt: new Date().toISOString() })) } } };
      await c.evaluate('sessionStorage.clear(); true'); // Home caches each source for a few minutes
      await c.send('Page.navigate', { url: `${base}/__blank` }); await sleep(200);
      if (!await open('/index.html#frames', { ready: "document.querySelector('[data-today=trends]') && !document.querySelector('[data-today=trends]').hidden && document.querySelector('[data-today=trends] .home-today__trend')", ms: 15000 })) return 'Trending now card did not come back with stories';
      return '';
    },
  },
  {
    // P2: the YouTube template chip read "Thum…" at 1024-1440 (measured once,
    // before the Layers column settled); Help was 32px beside 36px buttons.
    id: 'editor-topbar-fit',
    async run() {
      for (const width of [1440, 1280, 1024]) {
        await c.send('Page.navigate', { url: `${base}/__blank` }); await sleep(150);
        if (!await open('/index.html#youtube', { width, ready: "document.querySelector('.fu-format-chip__label')?.textContent", ms: 15000 })) return `no template chip at ${width}`;
        await sleep(1500);
        const r = await c.evaluate("(() => { const l = document.querySelector('.fu-format-chip__label'); const h = document.querySelector('.es-topbar .fu-tour-help')?.getBoundingClientRect(); return { text: l.textContent, cut: l.scrollWidth > l.clientWidth + 1, help: h ? Math.round(h.height) : 0, aria: document.querySelector('.fu-format-chip').getAttribute('aria-label') }; })()");
        if (r.cut) return `template chip cut at ${width}px ("${r.text}")`;
        if (!/Thumbnail · One image/.test(r.aria)) return `chip lost its full name in aria-label at ${width}: ${r.aria}`;
        if (r.help && r.help !== 36) return `Help button is ${r.help}px tall at ${width}, not 36`;
      }
      return '';
    },
  },
  {
    // P2 polish across pages: Video Ads (Move text on phones, Play / Mute,
    // Frame before a clip), Reel Captions (one Upload Clip on desktop, labelled
    // swatches), login (session expired is not green), guidelines kicker.
    id: 'polish-p2',
    async run() {
      if (!await open('/video-ads.html', { width: 375, ready: "document.querySelector('#va-move-text-toggle')", ms: 15000 })) return 'Video Ads never loaded at 375';
      await sleep(800);
      const va = await c.evaluate("(() => { const m = document.querySelector('#va-move-text-toggle').getBoundingClientRect(); const p = document.querySelector('#va-play').getBoundingClientRect(); const u = document.querySelector('#va-mute').getBoundingClientRect(); return { moveW: Math.round(m.width), play: Math.round(p.height), mute: Math.round(u.height) }; })()");
      if (va.moveW > 60) return `Move text is a ${va.moveW}px icon-only bar at 375`;
      if (va.play !== va.mute) return `Play is ${va.play}px, Mute ${va.mute}px`;
      if (!await open('/video-ads.html', { width: 1440, ready: "document.querySelector('#va-rail-frame')", ms: 15000 })) return 'Video Ads never loaded';
      await sleep(600);
      const frame = await c.evaluate("({ zoom: document.querySelector('#va-zoom').getClientRects().length, note: document.querySelector('.va-rail__noclip')?.getClientRects().length || 0 })");
      if (frame.zoom || !frame.note) return 'Frame shows zoom controls before a clip exists';
      if (!await open('/reels.html', { width: 1440, ready: "document.querySelector('#reels-palette-row .reels-swatch')", ms: 15000 })) return 'Reel Captions never showed its swatches';
      const reels = await c.evaluate("({ uploads: [...document.querySelectorAll('[data-reels-upload-trigger]')].filter(b => b.getClientRects().length).length, labels: [...document.querySelectorAll('#reels-palette-row [role=img]')].map(e => e.getAttribute('aria-label')), captions: [...document.querySelectorAll('#reels-palette-row .reels-swatch-label')].map(e => e.textContent) })");
      if (reels.uploads !== 1) return `${reels.uploads} Upload Clip buttons on Reel Captions at 1440`;
      if (reels.labels.length !== 2 || !/Pill/.test(reels.labels[0]) || reels.captions.join() !== 'Pill,Text') return 'Reel Captions swatches are not labelled: ' + JSON.stringify(reels);
      await c.evaluate("localStorage.removeItem('sb-xtdusejokbhtjlmijdca-auth-token'); true");
      try {
        if (!await open('/login.html?reason=session-expired', { ready: "document.querySelector('.login-error.is-visible')", ms: 15000 })) return 'login never showed the session note';
        const note = await c.evaluate("(() => { const e = document.querySelector('.login-error'); return { cls: e.className, role: e.getAttribute('role') }; })()");
        if (/is-success/.test(note.cls) || !/is-info/.test(note.cls)) return '"Session expired" is styled as ' + note.cls;
        if (note.role !== 'status') return '"Session expired" is announced as ' + note.role;
      } finally {
        await c.evaluate(FAKE_SESSION);
      }
      if (!await open('/index.html#social-guidelines', { ready: "[...document.querySelectorAll('.guidelines-kicker')].some(e => e.getClientRects().length)", ms: 15000 })) return 'guidelines never loaded';
      await c.evaluate("document.documentElement.setAttribute('data-theme', 'dark'); true");
      const kicker = await c.evaluate("getComputedStyle([...document.querySelectorAll('.guidelines-kicker')].find(e => e.getClientRects().length)).color");
      await c.evaluate("document.documentElement.removeAttribute('data-theme'); true");
      if (kicker === 'rgb(10, 111, 222)') return 'guidelines kicker keeps the 3.9:1 brand blue in dark mode';
      return '';
    },
  },
  {
    // P2: the tour offer card opened under the Gallery viewer's backdrop.
    id: 'tour-toast-under-modal',
    async run() {
      SB = { list_frameup_gallery: [200, GALLERY_ROWS.slice(0, 1)] };
      if (!await open('/gallery.html', { ready: "document.querySelector('.gallery-card:not(.is-skeleton)')", ms: 15000 })) return 'gallery never showed a card';
      const r = await c.evaluate(`(async () => {
        const toast = document.createElement('section'); toast.className = 'fu-tour-toast'; toast.textContent = 'Take a tour?'; document.body.appendChild(toast);
        document.querySelector('.gallery-card:not(.is-skeleton)').click();
        await new Promise(res => setTimeout(res, 600));
        const open = getComputedStyle(toast).visibility;
        document.querySelector('#gallery-viewer').close();
        await new Promise(res => setTimeout(res, 200));
        const closed = getComputedStyle(toast).visibility; toast.remove();
        return { open, closed };
      })()`);
      if (r.open !== 'hidden') return 'a tour card stays visible under the open Gallery viewer';
      if (r.closed !== 'visible') return 'the tour card does not come back after the viewer closes';
      return '';
    },
  },
  // ── Slice 3 (2026-11-29) ───────────────────────────────────────────────
  {
    // P1: a reload in Merch lost the line and every design. A draft in this
    // tab's sessionStorage comes back after a reload (not on a fresh visit),
    // Start over clears it, and leaving with unpublished designs asks first.
    id: 'merch-draft-restore',
    async run() {
      await c.send('Page.navigate', { url: `${base}/__blank` }); await sleep(150);
      await c.evaluate("Object.keys(sessionStorage).filter(k => k.startsWith('frameup.merch.draft')).forEach(k => sessionStorage.removeItem(k)); true");
      if (!await open('/merch.html', { ready: "window.MerchUI && document.querySelector('#mx-text')", ms: 15000 })) return 'Merch never loaded';
      const made = await c.evaluate(`(async () => {
        const sl = ms => new Promise(r => setTimeout(r, ms));
        const t = document.querySelector('#mx-text'); t.focus(); document.execCommand('insertText', false, 'Logo three');
        await sl(200); document.querySelector('#mx-create').click();
        for (let i = 0; i < 80 && !(MerchUI.state.concepts.length && !MerchUI.state.making); i++) await sl(250);
        const third = MerchUI.state.concepts[2]?.id;
        document.querySelector('#mx-strip [data-pick="' + third + '"]')?.click();
        await sl(900);
        return { n: MerchUI.state.concepts.length, sel: MerchUI.state.selected, third };
      })()`);
      if (!made.n) return 'no designs were made';
      if (made.sel !== made.third) return 'could not pick the third design';
      await c.evaluate('window.__beforeReload = true; true');
      await c.send('Page.reload');
      if (!await waitFor("!window.__beforeReload && document.readyState === 'complete' && window.MerchUI && MerchUI.state.step === 'designs' && MerchUI.state.concepts.length", 15000)) return 'after a reload the designs did not come back';
      const back = await c.evaluate("({ n: MerchUI.state.concepts.length, sel: MerchUI.state.selected, text: document.querySelector('#mx-text').value, note: document.querySelector('#mx-banner').innerText, hidden: document.querySelector('#mx-banner').hidden })");
      if (back.n !== made.n || back.sel !== made.sel) return `restored ${back.n} designs / picked ${back.sel}, expected ${made.n} / ${made.sel}`;
      if (back.text !== 'Logo three') return 'the line was not restored: ' + back.text;
      if (back.hidden || !/Restored your line/.test(back.note)) return 'no "Restored your line" note';
      // Leaving with designs not in the shop asks first (after a real gesture).
      await c.evaluate("document.documentElement.setAttribute('data-mx-leave-warn', ''); true");
      await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1 });
      await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 5, button: 'left', clickCount: 1 });
      const warns = await c.evaluate("(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()");
      if (!warns) return 'leaving with unpublished designs does not ask first';
      // Start over clears the draft.
      await c.evaluate("document.querySelector('#mx-banner [data-start-over]').click(); true");
      await sleep(500);
      const cleared = await c.evaluate("({ step: MerchUI.state.step, left: Object.keys(sessionStorage).filter(k => k.startsWith('frameup.merch.draft')).length, warns: (() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })() })");
      if (cleared.step !== 'content' || cleared.left) return 'Start over did not clear the draft: ' + JSON.stringify(cleared);
      if (cleared.warns) return 'after Start over leaving still asks';
      await c.evaluate("document.documentElement.removeAttribute('data-mx-leave-warn'); true");
      // A fresh visit starts clean even with a draft stored.
      await c.evaluate(`sessionStorage.setItem(Object.keys(sessionStorage).find(k => k.startsWith('frameup.merch.draft')) || 'frameup.merch.draft.v1:00000000-0000-0000-0000-000000000001', JSON.stringify({ v: 1, at: Date.now(), step: 'designs', text: 'Old line', concepts: [{ id: 'x1', stack: [{ text: 'OLD' }] }], selected: 'x1' })); true`);
      await c.send('Page.navigate', { url: `${base}/__blank` }); await sleep(150);
      if (!await open('/merch.html', { ready: "window.MerchUI", ms: 15000 })) return 'Merch never loaded again';
      await sleep(500);
      const fresh = await c.evaluate("({ step: MerchUI.state.step, n: MerchUI.state.concepts.length })");
      if (fresh.step !== 'content' || fresh.n) return 'a fresh visit restored an old draft';
      await c.evaluate("Object.keys(sessionStorage).filter(k => k.startsWith('frameup.merch.draft')).forEach(k => sessionStorage.removeItem(k)); true");
      errors.length = 0;
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
