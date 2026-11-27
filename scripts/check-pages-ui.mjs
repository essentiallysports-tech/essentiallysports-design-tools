// Pages UI sweep: Home (Today), Trends, Gallery, the account menu, Profile,
// Settings, Tours, What's new, the AI usage card, the search palette, the
// phone menu, the UI Library, How FrameUp works and the 404 page. Every state
// at 1440, 1024 and 375, light and dark, in real headless Chrome, with every
// API and Supabase call stubbed (no network writes, no AI).
//
// Fails on: doubled borders, empty bands, clipped / overflowing text,
// horizontal page scroll, misaligned card rows and button rows, non-ES fonts,
// purple in the UI, unlabelled controls, more than one primary button in view,
// console errors / uncaught exceptions, broken images and low contrast.
// Off-grid spacing (not a multiple of 4) is reported as a warning.
//
// Run: node scripts/check-pages-ui.mjs      (skips if Chrome isn't installed)
//   PAGES_ONLY=home,trends   only some pages
//   PAGES_SHOTS=<dir>        save a screenshot of every state
//   PAGES_JSON=<file>        write every finding as JSON
//   PAGES_WARN=1             print the off-grid spacing warnings
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find(p => fs.existsSync(p));
if (!CHROME) { console.log('pages ui: skipped (no Chrome found; set CHROME_PATH)'); process.exit(0); }
if (typeof WebSocket !== 'function') { console.log('pages ui: skipped (needs Node with WebSocket)'); process.exit(0); }
const STARTED = Date.now();

// ── Fixtures ───────────────────────────────────────────────────────────────
// NBA, WNBA and NASCAR are their own sports now (e472b86), so the LeBron story
// is NBA: the NHL story keeps an Others row in the feed for the sport-others state.
// The Trends feed is built by the real server code (trend-design.js) from
// synthetic RSS, so the page sees exactly the shape production sends.
const require = createRequire(import.meta.url);
async function trendsFixture() {
  const now = Date.now();
  const at = h => new Date(now - h * 3600e3).toUTCString();
  const news = list => `<rss><channel>${list.map(([title, source, h]) => `<item><title>${title} - ${source}</title><link>https://example.com/${encodeURIComponent(title.slice(0, 40))}</link><pubDate>${at(h)}</pubDate><source url="https://${source.toLowerCase().replace(/[^a-z]/g, '')}.com">${source}</source></item>`).join('')}</channel></rss>`;
  const FEEDS = {
    sports: news([['Patrick Mahomes throws 4 touchdowns as Chiefs beat Bills 31-17', 'ESPN', 2], ['LeBron James scores 40 in Lakers win over Warriors', 'ESPN', 3], ['Ohio State tops Michigan in College Football Playoff rankings update', 'CBS Sports', 4], ['Connor McDavid scores twice as Oilers beat Maple Leafs in NHL thriller', 'TSN', 3]]),
    nfl: news([['Mahomes, Chiefs top Bills in AFC thriller at Arrowhead', 'Yahoo Sports', 1], ['Andy Reid: "We have to clean up the turnovers before the playoffs start"', 'NFL.com', 2], ['NFL power rankings Week 12: Lions climb back to No. 1', 'CBS Sports', 5], ['Detroit Lions head coach Dan Campbell explains the decision to go for it on fourth down three times in the second half against the Green Bay Packers', 'The Athletic', 6], ['Chiefs beat Bills behind four Mahomes touchdowns', 'The Ringer', 3]]),
    cfb: news([['Heisman watch: Arch Manning throws for 412 yards in Texas win', 'On3', 3], ['College Football Playoff rankings: Ohio State, Oregon stay on top', 'ESPN', 7], ['Deion Sanders says Colorado will be ready for bowl season', 'Sports Illustrated', 9]]),
    mlb: news([['Shohei Ohtani wins third MVP award with Dodgers', 'MLB.com', 2], ['Yankees agree to a new deal with Juan Soto', 'New York Post', 8], ['MLB free agency tracker: every signing so far', 'The Athletic', 10]]),
    golf: news([['Scottie Scheffler wins PGA Tour Player of the Year again', 'Golf Channel', 4], ['LIV Golf announces 2027 schedule with three new events', 'Golf Digest', 11], ['Nelly Korda closes LPGA season with a win in Naples', 'LPGA', 5]]),
    tennis: news([['Jannik Sinner beats Carlos Alcaraz to win ATP Finals', 'Tennis.com', 3], ['WTA Finals: Aryna Sabalenka clinches year-end No. 1', 'WTA', 6], ['Coco Gauff names new coach ahead of the Australian Open', 'ESPN', 12]]),
    trends: `<rss><channel><item><title>chiefs vs bills</title><ht:approx_traffic>200K+</ht:approx_traffic><pubDate>${at(1)}</pubDate><ht:news_item><ht:news_item_title>Chiefs beat Bills in AFC showdown</ht:news_item_title><ht:news_item_url>https://example.com/chiefs-bills</ht:news_item_url><ht:news_item_source>ESPN</ht:news_item_source></ht:news_item></item><item><title>scottie scheffler</title><ht:approx_traffic>50K+</ht:approx_traffic><pubDate>${at(2)}</pubDate><ht:news_item><ht:news_item_title>Scheffler wins Player of the Year</ht:news_item_title><ht:news_item_url>https://example.com/scheffler</ht:news_item_url><ht:news_item_source>Golf Channel</ht:news_item_source></ht:news_item></item></channel></rss>`,
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const u = String(url);
    const id = u.includes('trends.google') ? 'trends' : u.includes('/topic/SPORTS') ? 'sports'
      : /NFL/.test(decodeURIComponent(u)) ? 'nfl' : /college/.test(decodeURIComponent(u)) ? 'cfb' : /MLB/.test(decodeURIComponent(u)) ? 'mlb'
      : /PGA/.test(decodeURIComponent(u)) ? 'golf' : /ATP/.test(decodeURIComponent(u)) ? 'tennis' : '';
    if (id) return new Response(FEEDS[id], { status: 200 });
    return new Response('{}', { status: 404 }); // Wikipedia images: none
  };
  try {
    const T = require(path.join(ROOT, 'netlify/functions/trend-design.js'))._test;
    T.reset();
    const data = await T.buildTrends(undefined, { window: '1d', now });
    // Local photos on most stories (one card per sport keeps the no-photo look).
    const photos = ['/how-step-content.webp', '/how-step-choose.webp', '/home-hero-banner.webp', '/social-media-guide-01.webp', '/login-social-media.webp'];
    data.items.forEach((item, i) => { item.image = i % 4 === 3 ? '' : photos[i % photos.length]; });
    return data;
  } finally { globalThis.fetch = realFetch; }
}
const TRENDS = await trendsFixture();
const TRENDS_EMPTY = { ...TRENDS, items: [], storylines: [], categories: TRENDS.categories.map(c => ({ ...c, count: 0 })) };
const GALLERY = Array.from({ length: 14 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  title: i === 3 ? 'Patrick Mahomes and the Kansas City Chiefs clinch the AFC West for the ninth straight season after beating the Bills' : ['Scheffler wins again', 'Ohtani MVP No. 3', 'Sinner takes the ATP Finals', 'Lions back on top', 'Arch Manning 412 yards'][i % 5],
  workspace: ['Social Media', 'Social Media', 'YouTube', 'Newsletter'][i % 4],
  workspace_variant: ['Cover', 'Quote', 'Player Stats', 'Listicle'][i % 4],
  team_or_league: ['PGA Tour', 'Dodgers', 'ATP', 'Lions', 'Texas'][i % 5],
  creator_name: ['Priya Shah', 'Alex Morgan', 'Sam Lee'][i % 3],
  exported_at: new Date(Date.now() - i * 5400e3).toISOString(),
  output_size: i % 4 === 2 ? '1280x720' : '1080x1350',
  has_design: i % 2 === 0,
}));
const SPEND = [{ total_usd: 3.42, by_feature: { generate: 2.1, 'trend-enrich': 0.42, 'video-ads': 0.9 } }];

// ── Static server with stubbed APIs ────────────────────────────────────────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.otf': 'font/otf', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webm': 'video/webm', '.mp4': 'video/mp4' };
let MODE = {}; // per-state switches: { trends: 'fail' | 'empty', gallery: 'fail' | 'empty', ai: 'free' }
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return; }
  if (url.pathname === '/api/trend-design') {
    if (req.method === 'POST') return json(res, 200, { ok: true, ai: false, items: {}, calls: 0 });
    if (MODE.trends === 'fail') return json(res, 502, { ok: false, error: 'Upstream timed out' });
    return json(res, 200, MODE.trends === 'empty' ? TRENDS_EMPTY : TRENDS);
  }
  if (url.pathname === '/api/ai-status') return json(res, 200, MODE.ai === 'free' ? { ok: true, mode: 'free', reason: 'user-limit', userLimitUsd: 50, userSpentUsd: 50 } : { ok: true, mode: 'ai', userLimitUsd: 50, userSpentUsd: 3.42 });
  if (url.pathname === '/api/version') return json(res, 200, { ok: true, version: 'qa' });
  if (url.pathname.startsWith('/api/')) return json(res, 200, { ok: true });
  let file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (!path.extname(file) || path.extname(file) === '.html') { res.writeHead(404, { 'content-type': 'text/html' }); fs.createReadStream(path.join(ROOT, '404.html')).pipe(res); return; }
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://localhost:${server.address().port}`;

// Supabase (never the real project): answered here through CDP Fetch.
function supabaseReply(url, method, headers) {
  const u = new URL(url);
  const p = u.pathname;
  const user = { id: '00000000-0000-0000-0000-000000000001', email: 'qa@essentiallysports.com', aud: 'authenticated', role: 'authenticated', user_metadata: { full_name: 'QA Tester' }, app_metadata: {} };
  if (p.startsWith('/auth/v1/user')) return [200, user];
  if (p.startsWith('/auth/v1/token')) { const exp = Math.floor(Date.now() / 1000) + 86400; return [200, { access_token: 'x', refresh_token: 'x', expires_in: 86400, expires_at: exp, token_type: 'bearer', user }]; }
  if (p.startsWith('/auth/v1/health')) return [200, { ok: true }];
  if (p.startsWith('/auth/v1/')) return [200, {}];
  if (p.startsWith('/storage/v1/object/sign')) return [200, []];
  if (p.startsWith('/storage/v1/')) return [400, { error: 'not found' }];
  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = p.split('/').pop();
    if (fn === 'list_frameup_gallery') return MODE.gallery === 'fail' ? [500, { message: 'canceling statement due to statement timeout', code: '57014' }] : [200, MODE.gallery === 'empty' ? [] : GALLERY];
    if (fn === 'get_frameup_gallery_preview') return [200, '/social-media-guide-02.webp'];
    if (fn === 'frameup_my_ai_spend') return [200, SPEND];
    if (fn.startsWith('list_')) return [200, []];
    return [200, null];
  }
  if (p.startsWith('/rest/v1/')) {
    if (method !== 'GET' && method !== 'HEAD') return [201, []];
    if (/vnd\.pgrst\.object/.test(headers.Accept || headers.accept || '')) return [406, { code: 'PGRST116', message: 'no rows' }];
    return [200, []];
  }
  return [404, {}];
}

// ── Chrome ────────────────────────────────────────────────────────────────
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fu-pages-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--window-size=1440,1000', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error('Chrome did not start')), 15000);
});
const port = new URL(wsUrl).port;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
const consoleLog = [];
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const external = u => { try { const h = new URL(u).hostname; return h !== 'localhost' && h !== '127.0.0.1'; } catch { return false; } };
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params;
    if (/supabase\.co/.test(request.url)) {
      const [status, body] = supabaseReply(request.url, request.method, request.headers || {});
      const headers = [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }, { name: 'access-control-allow-headers', value: '*' }, { name: 'access-control-allow-methods', value: '*' }, { name: 'content-range', value: '0-0/0' }];
      send('Fetch.fulfillRequest', { requestId, responseCode: request.method === 'OPTIONS' ? 204 : status, responseHeaders: headers, body: Buffer.from(request.method === 'OPTIONS' ? '' : JSON.stringify(body)).toString('base64') });
    } else if (external(request.url) && !/fonts\.(googleapis|gstatic)\.com/.test(request.url)) {
      // Nothing else leaves the machine (CDNs, images on other hosts, analytics).
      send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    } else send('Fetch.continueRequest', { requestId });
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') consoleLog.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleLog.push('console.error: ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    const en = m.params.entry;
    // Requests we block on purpose, and offline web fonts, are not page bugs.
    if (en.source === 'network' && (external(en.url || '') || /ERR_BLOCKED_BY_CLIENT/.test(en.text))) return;
    if (en.source === 'network' && MODE.expectHttpErrors) return;
    consoleLog.push(`${en.source}: ${en.text} ${en.url || ''}`.slice(0, 220));
  }
});
const evaluate = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '')); return r.result?.result?.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
await send('Page.navigate', { url: `${base}/__blank` });
for (let i = 0; i < 40 && (await evaluate('location.href')) !== `${base}/__blank`; i++) await sleep(150);
// A fake, unexpired, unsigned session: only the page's own gate reads it.
const SESSION = `(() => { const b64=o=>btoa(JSON.stringify(o)).replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_'); const exp=Math.floor(Date.now()/1000)+86400; const at=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:'00000000-0000-0000-0000-000000000001',email:'qa@essentiallysports.com',exp,role:'authenticated',aud:'authenticated'})+'.sig'; localStorage.setItem('sb-xtdusejokbhtjlmijdca-auth-token', JSON.stringify({access_token:at,refresh_token:'x',expires_at:exp,expires_in:86400,token_type:'bearer',user:{id:'00000000-0000-0000-0000-000000000001',email:'qa@essentiallysports.com',aud:'authenticated',role:'authenticated',user_metadata:{full_name:'QA Tester'}}})); localStorage.setItem('frameup-tour-offer-dismissed','1'); return true; })()`;
await evaluate(SESSION);

// ── The in-page scan ───────────────────────────────────────────────────────
const SCAN = fs.readFileSync(path.join(ROOT, 'scripts/lib/ui-scan.js'), 'utf8');

// ── States ────────────────────────────────────────────────────────────────
// Each page loads once per width; every state runs in light and dark.
const click = sel => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'); if (!el) return false; el.click(); return true; })()`;
const esc = `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.activeElement?.dispatchEvent?.(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`;
const closeDialogs = `document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.querySelectorAll('.fu-tour, .fu-tour-offer, [data-tour-root]').forEach(n => n.remove());`;
const PAGES = [
  {
    id: 'home', url: '/index.html#frames', ready: "document.querySelector('#home-today') && ![...document.querySelectorAll('#home-today [aria-busy=true]')].some(e => e.getClientRects().length)",
    states: [
      { id: 'default' },
      { id: 'account-menu', widths: [1440, 1024], run: click('.profile-trigger'), expect: "document.querySelector('.profile-trigger[aria-expanded=true]') && [...document.querySelectorAll('[data-account-menu] [role=menuitem], [data-account-menu] a')].filter(e => e.getClientRects().length).length >= 4", undo: esc },
      { id: 'whats-new', run: 'window.FrameUpWhatsNew?.open?.(); true', expect: "document.querySelector('dialog.whats-new-dialog[open] .whats-new-entry')", undo: closeDialogs },
      { id: 'tours-picker', run: 'window.FrameUpTours?.openPicker?.(); true', expect: "document.querySelector('dialog.fu-picker[open]')", undo: closeDialogs + esc },
      { id: 'tours-offer', run: 'window.FrameUpTours?.offerWelcome?.(); true', undo: closeDialogs + esc },
      { id: 'tour-step', run: 'window.FrameUpTours?.startWelcome?.(); true', undo: esc + closeDialogs },
      { id: 'search-palette', run: 'window.FrameUpShell?.openPalette?.(); true', expect: "document.querySelectorAll('.es-palette [role=option]').length > 5", undo: esc + closeDialogs },
      { id: 'usage-open', widths: [1440, 1024], run: click('button.es-usage__card'), expect: "document.querySelector('.es-usage__pop:not([hidden]) li') && /\\$50/.test(document.querySelector('.es-usage__amount').textContent)", undo: click('button.es-usage__card[aria-expanded=true]') },
      { id: 'phone-menu', widths: [375], run: click('.mobile-menu-toggle'), expect: "[...document.querySelectorAll('.es-mobile-nav__item')].filter(e => e.getClientRects().length).length > 8", undo: click('.mobile-menu-toggle[aria-expanded=true]') },
    ],
  },
  { id: 'home-trends-down', url: '/index.html#frames', mode: { trends: 'fail', expectHttpErrors: true, ai: 'free' }, ready: "document.querySelector('#home-today') && ![...document.querySelectorAll('#home-today [aria-busy=true]')].some(e => e.getClientRects().length)", states: [{ id: 'default' }] },
  {
    id: 'trends', url: '/generate.html?view=trends', ready: "document.querySelector('#trends-body .trend-row[data-id], #trends-empty:not([hidden])')",
    states: [
      { id: 'cards' },
      { id: 'list', run: click('#trends-density [data-density=list]'), expect: "document.querySelector('#ais-view-trends').dataset.density === 'list'", undo: click('#trends-density [data-density=cards]') },
      ...['nfl', 'golf', 'others'].map(s => ({ id: `sport-${s}`, expect: `(() => { const r = [...document.querySelectorAll('#trends-body .trend-row[data-id]')].filter(e => e.getClientRects().length); return r.length > 0 && r.every(e => e.dataset.sport === ${JSON.stringify(s)}); })()`, run: `(() => { const c = [...document.querySelectorAll('#trends-filters [data-sport], #trends-filters .es-chip')].find(b => (b.dataset.sport || b.dataset.category || b.dataset.id) === ${JSON.stringify(s)}); if (!c) return false; c.click(); return true; })()`, undo: `(() => { const c = [...document.querySelectorAll('#trends-filters [data-sport], #trends-filters .es-chip')].find(b => ['all', ''].includes(b.dataset.sport ?? b.dataset.category ?? b.dataset.id)); c?.click(); return true; })()` })),
      { id: 'kit-open', run: click('#trends-body [data-kit]'), expect: "document.querySelector('.trend-row.has-kit [id^=kit-]')", undo: click('#trends-body [data-kit][aria-expanded=true]') },
      { id: 'shortcuts', widths: [1440, 1024], run: click('#trends-keys'), expect: "!document.querySelector('#trends-keys-panel').hidden", undo: click('#trends-keys[aria-expanded=true]') },
      { id: 'brand', run: `(() => { const s = document.querySelector('#trends-brand'); if (!s || s.options.length < 2) return false; s.value = s.options[1].value; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`, undo: `(() => { const s = document.querySelector('#trends-brand'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()` },
    ],
  },
  { id: 'trends-error', url: '/generate.html?view=trends', mode: { trends: 'fail', expectHttpErrors: true }, ready: "document.querySelector('#trends-body .es-error-state')", states: [{ id: 'default' }] },
  { id: 'trends-empty', url: '/generate.html?view=trends', mode: { trends: 'empty' }, ready: "document.querySelector('#trends-empty:not([hidden])')", states: [{ id: 'default' }] },
  {
    id: 'gallery', url: '/gallery.html', ready: "document.querySelector('.gallery-card:not(.is-skeleton)') && document.querySelector('.gallery-card__thumb img')",
    states: [
      { id: 'default' },
      { id: 'youtube', run: click('[data-workspace="YouTube"]'), expect: "document.querySelectorAll('.gallery-card:not(.is-skeleton)').length === 3", undo: click('[data-workspace="All"]') },
      { id: 'type-quote', run: click('[data-type="Quote"]'), undo: click('[data-type="All"]') },
      { id: 'no-results', run: `(() => { const i = document.querySelector('input[type=search], #gallery-search'); if (!i) return false; i.value = 'zzzz nothing'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`, expect: "!document.querySelector('#gallery-empty').hidden && /No matching/.test(document.querySelector('#gallery-empty').textContent)", undo: `(() => { const i = document.querySelector('input[type=search], #gallery-search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()` },
      { id: 'viewer', run: click('.gallery-card:not(.is-skeleton)'), expect: "document.querySelector('#gallery-viewer[open] #gallery-viewer-title').textContent.trim().length > 3", undo: esc + closeDialogs },
    ],
  },
  { id: 'gallery-empty', url: '/gallery.html', mode: { gallery: 'empty' }, ready: "document.querySelector('#gallery-empty:not([hidden])')", states: [{ id: 'default' }] },
  { id: 'gallery-error', url: '/gallery.html', mode: { gallery: 'fail', expectHttpErrors: true }, ready: "document.querySelector('#gallery-error:not([hidden])')", states: [{ id: 'default' }] },
  { id: 'profile', url: '/ai-page/profile.html', ready: "document.querySelector('main')", states: [{ id: 'default' }] },
  { id: 'settings', url: '/ai-page/settings.html', ready: "document.querySelector('.acc-usage__amount')", states: [{ id: 'default', expect: "/of \\$50 this week/.test(document.querySelector('.acc-usage__amount').textContent)" }] },
  {
    id: 'ui-library', url: '/design-system.html', ready: "document.querySelector('main')", states: [{ id: 'default' }],
    // Video Ads components shown in the library: their colours live in video-ads.css
    // (owned by the Video Ads area). Listed, not failed, so they stay visible.
    known: [{ kind: 'contrast', sel: /\bva-/, why: 'Video Ads component colours (video-ads.css)' }],
  },
  { id: 'how', url: '/how-frameup-works.html', ready: "document.querySelector('main')", states: [{ id: 'default' }] },
  { id: '404', url: '/no-such-page.html', mode: { expectHttpErrors: true }, ready: "document.querySelector('.auth-state-card')", states: [{ id: 'default' }] },
];
const WIDTHS = process.env.PAGES_WIDTHS ? process.env.PAGES_WIDTHS.split(',').map(Number) : [1440, 1024, 375];
const only = (process.env.PAGES_ONLY || '').split(',').filter(Boolean);
const shots = process.env.PAGES_SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });

async function setWidth(w) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 600 ? 812 : 900, deviceScaleFactor: 1, mobile: w < 600 });
}
async function waitFor(expr, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await evaluate(`Boolean(${expr})`)) return true; } catch {} await sleep(200); }
  return false;
}

const findings = [];
const warnings = new Map();
const known = new Set();
let states = 0;
for (const pg of PAGES) {
  if (only.length && !only.some(o => pg.id === o || pg.id.startsWith(o + '-'))) continue;
  for (const w of WIDTHS) {
    MODE = pg.mode || {};
    await setWidth(w);
    consoleLog.length = 0;
    if (pg.mode) await evaluate(`(() => { try { Object.keys(localStorage).filter(k => /trend|gallery/i.test(k)).forEach(k => localStorage.removeItem(k)); Object.keys(sessionStorage).forEach(k => sessionStorage.removeItem(k)); } catch {} return true; })()`).catch(() => {});
    await send('Page.navigate', { url: base + pg.url });
    await sleep(400);
    await waitFor("document.readyState === 'complete'");
    const ok = await waitFor(pg.ready);
    await evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}'; document.head.appendChild(s); return true; })()`);
    // Scroll through once so lazy images and cards load, then back to the top.
    await evaluate(`(async () => { const h = document.scrollingElement.scrollHeight; for (let y = 0; y < h; y += innerHeight) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } scrollTo(0, 0); return true; })()`);
    await sleep(600);
    const where = await evaluate('location.pathname');
    if (/login/.test(where)) { findings.push({ page: pg.id, state: 'load', width: w, theme: '-', kind: 'gate', detail: 'went to ' + where }); continue; }
    if (!ok) findings.push({ page: pg.id, state: 'load', width: w, theme: '-', kind: 'not-ready', detail: `never reached: ${pg.ready}` });
    for (const theme of ['light', 'dark']) {
      await evaluate(`(() => { window.FrameUpTheme?.apply ? FrameUpTheme.apply(${JSON.stringify(theme)}) : document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); document.documentElement.style.colorScheme = ${JSON.stringify(theme)}; return true; })()`);
      for (const st of pg.states) {
        if (st.widths && !st.widths.includes(w)) continue;
        consoleLog.length = 0;
        if (st.run) {
          const did = await evaluate(st.run);
          if (did === false) { findings.push({ page: pg.id, state: st.id, width: w, theme, kind: 'state', detail: 'could not open this state (control missing)' }); continue; }
          await sleep(450);
        }
        if (st.expect && !(await waitFor(st.expect, 3000))) findings.push({ page: pg.id, state: st.id, width: w, theme, kind: 'behaviour', sel: '', detail: `did not do what it says: ${st.expect.slice(0, 120)}` });
        if (process.env.PAGES_DEBUG) console.log(`debug ${pg.id}/${st.id}@${w}/${theme}:`, JSON.stringify(await evaluate(process.env.PAGES_DEBUG)));
        let r = await evaluate(`(${SCAN})()`);
        if (r.issues.length) { await sleep(700); r = await evaluate(`(${SCAN})()`); } // settle once
        states++;
        for (const is of r.issues) {
          const kn = (pg.known || []).find(k => k.kind === is.kind && k.sel.test(is.sel));
          if (kn) { known.add(`${pg.id} | ${is.kind} | ${is.sel} | ${is.detail.replace(/ \[.*$/, '')} (${kn.why})`); continue; }
          findings.push({ page: pg.id, state: st.id, width: w, theme, ...is });
        }
        for (const wn of r.warnings) { const k = `${pg.id} · ${wn.sel} · ${wn.detail}`; warnings.set(k, (warnings.get(k) || 0) + 1); }
        for (const c of consoleLog) findings.push({ page: pg.id, state: st.id, width: w, theme, kind: 'console', sel: '', detail: c });
        if (shots) { const full = st.id === pg.states[0].id; const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full }); fs.writeFileSync(path.join(shots, `${pg.id}-${st.id}-${w}-${theme}.png`), Buffer.from(s.result.data, 'base64')); }
        if (st.undo) { await evaluate(`(() => { ${st.undo.startsWith('(') ? `return ${st.undo}` : st.undo} ; return true; })()`); await sleep(300); }
      }
    }
  }
}
ws.close(); chrome.kill(); server.close();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}

// Same problem in several states/themes/widths: one line, with where it shows.
const groups = new Map();
for (const f of findings) {
  const k = `${f.page} | ${f.kind} | ${f.sel || ''} | ${f.detail}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(`${f.state}@${f.width}/${f.theme}`);
}
if (process.env.PAGES_JSON) fs.writeFileSync(process.env.PAGES_JSON, JSON.stringify({ states, findings, warnings: Object.fromEntries(warnings) }, null, 2));
if (process.env.PAGES_WARN) for (const [k, n] of warnings) console.log(`warn ${k} (${n}x)`);
for (const k of known) console.log(`known ${k}`);
for (const [k, where] of groups) console.log(`FAIL ${k}  [${where.length > 4 ? where.slice(0, 4).join(', ') + ` +${where.length - 4}` : where.join(', ')}]`);
const secs = Math.round((Date.now() - STARTED) / 1000);
if (groups.size) { console.log(`pages ui: ${groups.size} problem(s) across ${states} states (${warnings.size} off-grid spacing warnings, ${secs}s)`); process.exit(1); }
console.log(`pages ui: ${states} states clean at ${WIDTHS.join(' / ')}, light + dark (${warnings.size} off-grid spacing warnings, ${secs}s)`);
